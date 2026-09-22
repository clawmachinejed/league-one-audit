import 'server-only';
import { AccountAdmissionDeniedError, AccountAuthUnavailableError, getAccountPrincipal } from './auth';
import { AccountStoreUnavailableError, AccountWriteRateLimitError, createAccountDatabase } from './database';
import { accountTeams } from './library';
import { AccountConflictError, createAccountStore, type AccountMutation } from './store';
import { AccountInputError, accountUuid } from './validation';

const PRIVATE_HEADERS = { 'Cache-Control': 'private, no-store, max-age=0', Vary: 'Cookie', 'X-Content-Type-Options': 'nosniff' };
class AccountRequestError extends Error {
  constructor(readonly status: number, readonly code: string) { super(code); }
}

export function requireAccountOrigin(request: Request, configuredOrigin = process.env.ACCOUNTS_APP_ORIGIN): void {
  let origin: URL;
  try { origin = new URL(configuredOrigin ?? ''); } catch { throw new AccountRequestError(503, 'account_unavailable'); }
  const local = process.env.NODE_ENV !== 'production' && ['localhost', '127.0.0.1'].includes(origin.hostname);
  if ((origin.protocol !== 'https:' && !(local && origin.protocol === 'http:')) || origin.username || origin.password
    || origin.search || origin.hash || origin.pathname !== '/') throw new AccountRequestError(503, 'account_unavailable');
  if (request.headers.get('origin') !== origin.origin || request.headers.get('sec-fetch-site') === 'cross-site') {
    throw new AccountRequestError(403, 'invalid_origin');
  }
}

export async function readAccountJson(request: Request): Promise<unknown> {
  if (request.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/json') throw new AccountRequestError(415, 'json_required');
  if (Number(request.headers.get('content-length')) > 4096) throw new AccountRequestError(413, 'request_too_large');
  if (!request.body) throw new AccountInputError();
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > 4096) { await reader.cancel(); throw new AccountRequestError(413, 'request_too_large'); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
  catch { throw new AccountInputError('Invalid JSON.'); }
}

type Operation = { kind: 'read' | 'teams' } | { kind: AccountMutation['kind']; id?: string };
const defaultDependencies = { principal: getAccountPrincipal, store: () => createAccountStore(createAccountDatabase()) };

/** Actor identity only comes from the verified session, never from the request body/path. */
export async function accountResponse(request: Request, operation: Operation, dependencies = defaultDependencies): Promise<Response> {
  try {
    let body: unknown;
    let expectedActor: string | undefined;
    if (operation.kind !== 'read' && operation.kind !== 'teams') {
      requireAccountOrigin(request);
      expectedActor = accountUuid(request.headers.get('x-expected-account-id'));
      body = await readAccountJson(request);
    }
    const principal = await dependencies.principal();
    if (!principal) return Response.json({ error: 'unauthenticated' }, { status: 401, headers: PRIVATE_HEADERS });
    const store = dependencies.store();
    const actor = await store.resolve(principal);
    // A form rendered for a prior session cannot mutate the newly signed-in
    // account even if both rows happen to have the same revision. This header is
    // a precondition only; it never selects or authorizes the actor.
    if (expectedActor && expectedActor !== actor) throw new AccountRequestError(409, 'account_changed');
    if (operation.kind === 'read' || operation.kind === 'teams') {
      const view = await store.read(actor);
      return Response.json(operation.kind === 'teams' ? { teams: accountTeams(view) } : view, { headers: PRIVATE_HEADERS });
    }
    let mutation: AccountMutation;
    if (operation.kind === 'profile' || operation.kind === 'link') mutation = { kind: operation.kind, body };
    else mutation = { kind: operation.kind, id: ('id' in operation ? operation.id : '') ?? '', body };
    await store.mutate(actor, mutation);
    return Response.json({ ok: true }, { headers: PRIVATE_HEADERS });
  } catch (error) {
    let status = 503;
    let code = 'account_unavailable';
    if (error instanceof AccountAuthUnavailableError && error.reason === 'disabled') code = 'accounts_disabled';
    else if (error instanceof AccountAdmissionDeniedError) { status = 403; code = 'admission_denied'; }
    else if (error instanceof AccountInputError) { status = 400; code = 'invalid_request'; }
    else if (error instanceof AccountConflictError) { status = 409; code = 'revision_conflict'; }
    else if (error instanceof AccountWriteRateLimitError) { status = 429; code = 'too_many_changes'; }
    else if (error instanceof AccountRequestError) { status = error.status; code = error.code; }
    else if (!(error instanceof AccountAuthUnavailableError || error instanceof AccountStoreUnavailableError)) {
      // No raw exception, SQL or provider data is logged. Operators can identify
      // this route's failure class without leaking personal account information.
      console.error('[accounts] unexpected_request_failure');
    }
    return Response.json({ error: code }, { status, headers: { ...PRIVATE_HEADERS, ...(status === 429 ? { 'Retry-After': '60' } : {}) } });
  }
}
