import 'server-only';
import { randomUUID } from 'node:crypto';
import { decodeAcquisitionAdmission, decodeAcquisitionProgress, decodeAcquisitionActivation, decodeStoredDiscovery } from '../discovery-results';
import type { DatabaseClient } from '../../database';
import type { AccountAuthorityDatabase } from './database';
import type { AuthReceiptV2 } from '../session-authority';
import type { DiscoveryScanPort } from '../discovery-scan';
import type { PermitJobFence, SleeperPermitPort, SleeperPermitRequest } from '../../projections/adapters/sleeper/permit-transport';
import type { AcquisitionCommand, AcquisitionAdmission, AcquisitionProgress, ProviderActivation, StoredDiscoveryResult } from '../discovery-contracts';
export type { AcquisitionCommand, AcquisitionAdmission, AcquisitionProgress, ProviderActivation, StoredDiscoveryResult } from '../discovery-contracts';

/** Actor and ephemeral receipt come from the verified server bridge only. No
 * method opens a provider connection or accepts authority from HTTP payloads. */
export function createNeonAccountAcquisitionPort(database: AccountAuthorityDatabase, actorUserId: string, receipt: AuthReceiptV2) {
  async function run<Result>(statement: string, parameters: readonly unknown[], requestId: string, write: boolean, decode: (value: unknown) => Result) {
    const completed = await database.finalTransaction([{ statement, parameters }],
      { actorUserId, requestId, access: write ? 'write' : 'read' });
    const envelope = completed.results[0]?.[0]?.value;
    if (!envelope || typeof envelope !== 'object' || !('result' in envelope)) throw new Error('Acquisition unavailable.');
    if (!('decisionTiming' in envelope)) throw new Error('Acquisition unavailable.');
    return { result: decode(envelope.result), decisionTiming: envelope.decisionTiming };
  }
  return {
    admit: (command: AcquisitionCommand) => run<AcquisitionAdmission>(
      'SELECT public.admit_account_acquisition_v1($1::jsonb,$2::jsonb) AS value',
      [JSON.stringify(command), JSON.stringify(receipt)], command.commandId, true, decodeAcquisitionAdmission),
    read: (demandId: string, requestId: string, expectedKind: 'identify' | null = null) => run<AcquisitionProgress>(
      'SELECT public.read_account_acquisition_v1($1::uuid,$2::jsonb,$3::text) AS value',
      [demandId, JSON.stringify(receipt), expectedKind], requestId, false, decodeAcquisitionProgress),
    readDiscovery: (demandId: string, requestId: string) => run<StoredDiscoveryResult>(
      'SELECT public.read_account_discovery_v1($1::uuid,$2::jsonb) AS value',
      [demandId, JSON.stringify(receipt)], requestId, false, decodeStoredDiscovery),
    activate: (input: { providerAccountId: string; lookupCaptureId: string; expectedActorRevision: string; commandId: string }) => run<ProviderActivation>(
      'SELECT public.activate_provider_account_v2($1::uuid,$2::uuid,$3::bigint,$4::uuid,$5::jsonb) AS value',
      [input.providerAccountId, input.lookupCaptureId, input.expectedActorRevision, input.commandId, JSON.stringify(receipt)], input.commandId, true, decodeAcquisitionActivation),
  };
}

async function one(database: DatabaseClient, statement: string, parameters: readonly unknown[]) {
  const rows = await database.query(statement, parameters);
  if (rows.length !== 1) throw new Error('Acquisition unavailable.');
  return rows[0].value;
}

export function createNeonSleeperPermitPort(database: DatabaseClient): SleeperPermitPort {
  return {
    async reserveCommitted(request) {
      try {
        const value = await one(database, 'SELECT public.reserve_account_provider_http_v1($1::jsonb) AS value', [JSON.stringify(request)]);
        if (!value || typeof value !== 'object' || !('result' in value) || !('endpoint' in value)) return { commit: 'unknown' };
        return { commit: 'confirmed', result: value.result, endpoint: value.endpoint };
      } catch { return { commit: 'unknown' }; }
    },
    async finish(id, outcome, retry) {
      return await one(database, 'SELECT public.finish_provider_http_v1($1::uuid,$2,$3::integer) AS value', [id, outcome, retry]) === true;
    },
  };
}

type TargetRequest = Extract<SleeperPermitRequest, { kind: 'target' }>;
export function createNeonDiscoveryScanPort(database: DatabaseClient, fence: PermitJobFence): DiscoveryScanPort {
  return {
    async load(scanId) {
      return await one(database, 'SELECT public.account_discovery_work_v1($1::uuid,$2::jsonb) AS value',
        [scanId, JSON.stringify(fence)]) as Awaited<ReturnType<DiscoveryScanPort['load']>>;
    },
    async reserve(scope) {
      return await one(database, 'SELECT public.prepare_account_acquisition_attempt_v1($1::jsonb) AS value',
        [JSON.stringify({ kind: 'league-list', scanId: scope.scan.scanId, season: scope.season, attemptId: randomUUID(),
          requestId: randomUUID(), fence })]) as TargetRequest | null;
    },
    async recordCapture(input) {
      try {
        const value = await one(database, 'SELECT public.capture_account_acquisition_v1($1::jsonb) AS value',
          [JSON.stringify({ kind: 'league-list', request: input.request, permitId: input.permitId,
            rawValue: input.rawValue, normalizedValue: input.candidates.map(({ id, name, season, avatar }) => ({ id, name, season, avatar: avatar ?? null })), normalizedAt: new Date().toISOString(),
            requestStartedAt: input.requestStartedAt, requestCompletedAt: input.requestCompletedAt })]);
        if (!value || typeof value !== 'object' || !('captureId' in value) || typeof value.captureId !== 'string') return { commit: 'unknown' };
        return { commit: 'confirmed', captureId: value.captureId };
      } catch { return { commit: 'unknown' }; }
    },
  };
}

export function createNeonAcquisitionSourcePort(database: DatabaseClient, fence: PermitJobFence) {
  async function record(kind: 'identity-lookup' | 'nfl-state', input: { request: TargetRequest; permitId: string; rawValue: unknown; normalizedValue: unknown; requestStartedAt: string; requestCompletedAt: string }) {
    try {
      const value = await one(database, 'SELECT public.capture_account_acquisition_v1($1::jsonb) AS value', [JSON.stringify({ kind, ...input, normalizedAt: new Date().toISOString() })]);
      if (!value || typeof value !== 'object' || !('captureId' in value) || typeof value.captureId !== 'string') return { commit: 'unknown' as const };
      return { commit: 'confirmed' as const, captureId: value.captureId };
    } catch { return { commit: 'unknown' as const }; }
  }
  return {
    reserve: async (demandId: string) => await one(database, 'SELECT public.prepare_account_acquisition_attempt_v1($1::jsonb) AS value',
      [JSON.stringify({ kind: 'demand', demandId, attemptId: randomUUID(), requestId: randomUUID(), fence })]) as TargetRequest | null,
    recordIdentity: (input: Parameters<typeof record>[1]) => record('identity-lookup', input),
    recordCalendar: (input: Parameters<typeof record>[1]) => record('nfl-state', input),
    fail: async (demandId: string, reason: 'invalid_source' | 'transport') => await one(database,
      'SELECT public.fail_account_acquisition_v1($1::uuid,$2::jsonb,$3) AS value', [demandId, JSON.stringify(fence), reason]) === true,
  };
}
