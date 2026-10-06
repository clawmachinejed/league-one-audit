import 'server-only';
import { randomUUID } from 'node:crypto';
import { getAccountAuthorizedPrincipalV2 } from './auth';
import { createAccountDiscoveryService } from './discovery-service';
import { accountErrorResponse, readAccountJson, requireAccountOrigin } from './http';
import { AccountInputError, accountUuid } from './validation';
import { createDecisionDelivery } from './decision-timing';
import type { AcquisitionCommand } from './discovery-contracts';
import { storedSleeperDiscovery } from './stored-discovery';

type Operation = 'admit' | 'activate' | 'progress' | 'identify-result' | 'stored-discovery';
const defaults = { principal: getAccountAuthorizedPrincipalV2, service: createAccountDiscoveryService };
const headers = { 'Cache-Control': 'private, no-store, max-age=0', Vary: 'Cookie', 'X-Content-Type-Options': 'nosniff' };

function object(value: unknown, keys: string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).some(key => !keys.includes(key))) throw new AccountInputError();
  return value as Record<string, unknown>;
}

function revision(value: unknown): string {
  if (typeof value !== 'string' || !/^[1-9]\d{0,18}$/.test(value)
    || BigInt(value) > 9_223_372_036_854_775_807n) throw new AccountInputError();
  return value;
}

export function acquisitionCommand(value: unknown): AcquisitionCommand {
  const input = object(value, ['kind', 'commandId', 'username', 'associationId', 'associationRevision', 'leagueId']);
  const commandId = accountUuid(input.commandId);
  if (input.kind === 'identify') {
    object(input, ['kind', 'commandId', 'username']);
    if (typeof input.username !== 'string' || !/^[a-zA-Z0-9_]{1,100}$/.test(input.username)) throw new AccountInputError();
    return { kind: 'identify', commandId, username: input.username };
  }
  if (input.kind === 'discover' || input.kind === 'recover') {
    object(input, input.kind === 'discover' ? ['kind', 'commandId', 'associationId', 'associationRevision']
      : ['kind', 'commandId', 'associationId', 'associationRevision', 'leagueId']);
    const associationId = accountUuid(input.associationId), associationRevision = revision(input.associationRevision);
    return input.kind === 'discover' ? { kind: 'discover', commandId, associationId, associationRevision }
      : { kind: 'recover', commandId, associationId, associationRevision, leagueId: accountUuid(input.leagueId) };
  }
  throw new AccountInputError();
}

/** Callable internal HTTP composition, deliberately not mounted to a public
 * route before migration/policy qualification and separate activation. The
 * existing site routes retain their current behavior. */
export async function accountAcquisitionResponse(request: Request, operation: Operation, dependencies = defaults): Promise<Response> {
  let expected: unknown;
  let protectedResult = true;
  const delivery = createDecisionDelivery({ decodeResult: value => {
    if (value !== expected) throw new Error('Acquisition unavailable.');
    return { value, protected: protectedResult };
  } });
  try {
    request.signal.throwIfAborted();
    const expectedActor = accountUuid(request.headers.get('x-expected-account-id'));
    const url = new URL(request.url);
    let command: AcquisitionCommand | undefined;
    let activation: { providerAccountId: string; lookupCaptureId: string; expectedActorRevision: string; commandId: string } | undefined;
    let demandId: string | undefined;
    if (operation === 'progress' || operation === 'identify-result' || operation === 'stored-discovery') {
      if (request.method !== 'GET' || url.searchParams.size !== 1 || !url.searchParams.has('demandId')) throw new AccountInputError();
      if (request.headers.get('origin') || request.headers.get('sec-fetch-site') === 'cross-site') requireAccountOrigin(request);
      demandId = accountUuid(url.searchParams.get('demandId'));
    } else {
      if (request.method !== 'POST' || url.search) throw new AccountInputError();
      requireAccountOrigin(request);
      const body = await readAccountJson(request);
      if (operation === 'admit') command = acquisitionCommand(body);
      else {
        const input = object(body, ['providerAccountId', 'lookupCaptureId', 'expectedActorRevision', 'commandId']);
        activation = { providerAccountId: accountUuid(input.providerAccountId), lookupCaptureId: accountUuid(input.lookupCaptureId),
          expectedActorRevision: revision(input.expectedActorRevision), commandId: accountUuid(input.commandId) };
      }
    }
    const principal = await dependencies.principal();
    if (!principal) return Response.json({ error: 'unauthenticated' }, { status: 401, headers });
    const service = dependencies.service(principal);
    const actor = await service.resolve();
    if (actor !== expectedActor) return Response.json({ error: 'account_changed' }, { status: 409, headers });
    const port = service.forActor(actor);
    request.signal.throwIfAborted();
    const final = delivery.beginFinalSql();
    const deliver = (dto: unknown, decisionTiming: unknown, isProtected = true) => {
      request.signal.throwIfAborted();
      expected = dto; protectedResult = isProtected;
      const response = final.deliver({ result: dto, decisionTiming }, 'confirmed');
      Object.entries(headers).forEach(([name, value]) => response.headers.set(name, value));
      return response;
    };
    if (operation === 'stored-discovery') {
      const completed = await port.readDiscovery(demandId!, randomUUID());
      return deliver(storedSleeperDiscovery(actor, completed.result), completed.decisionTiming);
    }
    const completed = command ? await port.admit(command) : activation ? await port.activate(activation)
      : operation === 'identify-result' ? await port.read(demandId!, randomUUID(), 'identify') : await port.read(demandId!, randomUUID());
    // Explicit projection prevents SQL envelopes, receipts and internal
    // dependencies from becoming response fields. No await follows this read.
    const result = completed.result;
    let dto: unknown;
    if ('reason' in result) dto = { status: result.status, reason: result.reason };
    else if ('associationId' in result) dto = { status: result.status, associationId: result.associationId,
      associationRevision: result.associationRevision, assurance: result.assurance };
    else if ('lookupCaptureId' in result) {
      const account = result.providerAccount;
      dto = { status: result.status, lookupRequestId: result.demandId, evidenceRef: result.lookupCaptureId, reason: null,
        account: { id: account.id, provider: account.provider, namespace: account.namespace,
          nativeAccountId: account.nativeAccountId, displayName: account.displayName, username: account.username,
          avatar: account.avatar, identityEvidenceKind: account.identityEvidenceKind, identityEvidenceRef: account.identityEvidenceRef } };
    } else if ('scanId' in result) dto = { status: result.status, demandId: result.demandId, scanId: result.scanId,
      requiredSeasons: result.requiredSeasons, completedSeasons: result.completedSeasons, coverage: result.coverage };
    else dto = { status: result.status, demandId: result.demandId, retryAfterSeconds: result.retryAfterSeconds };
    if ((command?.kind === 'identify' || operation === 'identify-result')
      && (result.status === 'pending' || result.status === 'joined')) {
      dto = { lookupRequestId: result.demandId, status: 'pending', account: null, evidenceRef: null, reason: 'queued' };
    }
    if (operation === 'identify-result' && 'reason' in result) {
      dto = { lookupRequestId: demandId, status: 'unavailable', account: null, evidenceRef: null, reason: result.reason };
    }
    if (command?.kind === 'identify' && 'reason' in result) {
      // Admission failed before a durable lookup handle exists. Return an HTTP
      // error, not a fabricated IdentifyProviderAccountResult/lookup UUID.
      const response = deliver({ error: 'acquisition_unavailable' }, completed.decisionTiming, false);
      return new Response(response.body, { status: 503, headers: response.headers });
    }
    return deliver(dto, completed.decisionTiming, !('reason' in result));
  } catch (error) { return accountErrorResponse(error); }
}
