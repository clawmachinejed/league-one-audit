import 'server-only';
import { AccountAdmissionDeniedError, AccountAuthUnavailableError, getAccountPrincipal } from './auth';
import { AccountStoreUnavailableError, AccountWriteRateLimitError, createAccountDatabase } from './database';
import { accountTeams } from './library';
import { AccountConflictError, createAccountStore, type AccountMutation } from './store';
import { AccountInputError, accountUuid } from './validation';
import type { AccountView, LinkedSleeperProfile, SleeperLinkPreview } from './contracts';
import { discoverSleeperLeagues } from './sleeper-discovery';
import { previewSleeperLink } from './sleeper-link-preview';
import { getLeagueSite } from '../league-sites';

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
type AccountHttpStore = Pick<ReturnType<typeof createAccountStore>, 'resolve' | 'read' | 'mutate'>;
const defaultDependencies: { principal: typeof getAccountPrincipal; store: () => AccountHttpStore;
  present?: (view: AccountView) => Promise<AccountView> } = {
  principal: getAccountPrincipal, store: () => createAccountStore(createAccountDatabase()),
  present: async view => ({ ...view, library: { ...view.library, leagues: await Promise.all(view.library.leagues.map(async league => {
    const site = await getLeagueSite(league.key).catch(() => null);
    return site ? { ...league, logo: site.logo, name: site.name } : league;
  })) } }),
};
const discoveryDependencies = { principal: getAccountPrincipal,
  store: () => createAccountStore(createAccountDatabase()), discover: discoverSleeperLeagues };
const previewDependencies = { principal: getAccountPrincipal,
  store: () => createAccountStore(createAccountDatabase()), preview: previewSleeperLink };
type PreviewDependencies = Omit<typeof previewDependencies, 'store'> & {
  store: () => Pick<ReturnType<typeof createAccountStore>, 'resolve' | 'read'>;
};
type DiscoveryDependencies = Omit<typeof discoveryDependencies, 'store'> & {
  store: () => Pick<ReturnType<typeof createAccountStore>, 'resolve' | 'readDiscoveryProfiles'>;
};

function associationFingerprint(profiles: readonly LinkedSleeperProfile[]): string {
  return JSON.stringify(profiles.map(({ linkId, revision, sourceManagerAccountId, externalId }) =>
    [linkId, revision, sourceManagerAccountId, externalId]).sort((a, b) => String(a[0]).localeCompare(String(b[0]))));
}

function availablePreviewAccount(view: AccountView, sourceManagerAccountId: string) {
  if (view.links.some(link => link.sourceManagerAccountId === sourceManagerAccountId)) return null;
  return view.library.availableProviderAccounts.find(account => account.id === sourceManagerAccountId) ?? null;
}

/** Preview only a currently selectable public profile for the authenticated website actor. */
export async function sleeperLinkPreviewResponse(request: Request, dependencies: PreviewDependencies = previewDependencies): Promise<Response> {
  try {
    request.signal.throwIfAborted();
    const expectedActor = accountUuid(request.headers.get('x-expected-account-id'));
    const url = new URL(request.url);
    if (url.searchParams.size !== 1) throw new AccountInputError();
    const sourceManagerAccountId = accountUuid(url.searchParams.get('sourceManagerAccountId'));
    if (request.headers.get('origin') || request.headers.get('sec-fetch-site') === 'cross-site') requireAccountOrigin(request);
    const principal = await dependencies.principal();
    if (!principal) return Response.json({ error: 'unauthenticated' }, { status: 401, headers: PRIVATE_HEADERS });
    const store = dependencies.store();
    const actor = await store.resolve(principal);
    if (actor !== expectedActor) throw new AccountRequestError(409, 'account_changed');
    const account = availablePreviewAccount(await store.read(actor), sourceManagerAccountId);
    if (!account) throw new AccountInputError();
    const preview: SleeperLinkPreview = await dependencies.preview(account, request.signal);
    request.signal.throwIfAborted();
    const latestPrincipal = await dependencies.principal();
    if (!latestPrincipal || latestPrincipal.issuer !== principal.issuer || latestPrincipal.subject !== principal.subject
      || await store.resolve(latestPrincipal) !== actor) throw new AccountRequestError(409, 'account_changed');
    const latestAccount = availablePreviewAccount(await store.read(actor), sourceManagerAccountId);
    if (!latestAccount || latestAccount.externalId !== account.externalId) throw new AccountRequestError(409, 'associations_changed');
    return Response.json(preview, { headers: PRIVATE_HEADERS });
  } catch (error) { return accountErrorResponse(error); }
}

/** Only active associations belonging to the verified session can trigger discovery. */
export async function sleeperLeagueDiscoveryResponse(
  request: Request, dependencies: DiscoveryDependencies = discoveryDependencies,
): Promise<Response> {
  try {
    request.signal.throwIfAborted();
    const expectedActor = accountUuid(request.headers.get('x-expected-account-id'));
    if (new URL(request.url).search) throw new AccountInputError();
    if (request.headers.get('origin') || request.headers.get('sec-fetch-site') === 'cross-site') requireAccountOrigin(request);
    const principal = await dependencies.principal();
    if (!principal) return Response.json({ error: 'unauthenticated' }, { status: 401, headers: PRIVATE_HEADERS });
    const store = dependencies.store();
    const actor = await store.resolve(principal);
    if (expectedActor !== actor) throw new AccountRequestError(409, 'account_changed');
    const profiles = await store.readDiscoveryProfiles(actor);
    const discovery = await dependencies.discover(profiles, request.signal);
    request.signal.throwIfAborted();
    // Public provider requests may be slow. Recheck revocation and associations
    // before returning any private association-to-league mapping.
    const latestPrincipal = await dependencies.principal();
    if (!latestPrincipal) return Response.json({ error: 'unauthenticated' }, { status: 401, headers: PRIVATE_HEADERS });
    if (latestPrincipal.issuer !== principal.issuer || latestPrincipal.subject !== principal.subject
      || await store.resolve(latestPrincipal) !== actor) throw new AccountRequestError(409, 'account_changed');
    if (associationFingerprint(await store.readDiscoveryProfiles(actor)) !== associationFingerprint(profiles)) {
      throw new AccountRequestError(409, 'associations_changed');
    }
    return Response.json({ ...discovery, accountId: actor }, { headers: PRIVATE_HEADERS });
  } catch (error) { return accountErrorResponse(error); }
}

export function accountErrorResponse(error: unknown): Response {
  let status = 503;
  let code = 'account_unavailable';
  if (error instanceof AccountAuthUnavailableError && error.reason === 'disabled') code = 'accounts_disabled';
  else if (error instanceof AccountAdmissionDeniedError) { status = 403; code = 'admission_denied'; }
  else if (error instanceof AccountInputError) { status = 400; code = 'invalid_request'; }
  else if (error instanceof AccountConflictError) { status = 409; code = 'revision_conflict'; }
  else if (error instanceof AccountWriteRateLimitError) { status = 429; code = 'too_many_changes'; }
  else if (error instanceof AccountRequestError) { status = error.status; code = error.code; }
  else if (!(error instanceof AccountAuthUnavailableError || error instanceof AccountStoreUnavailableError)
    && !(error instanceof Error && error.name === 'AbortError')) {
    console.error('[accounts] unexpected_request_failure');
  }
  return Response.json({ error: code }, { status, headers: { ...PRIVATE_HEADERS, ...(status === 429 ? { 'Retry-After': '60' } : {}) } });
}

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
      const storedView = await store.read(actor);
      const view = operation.kind === 'read' && dependencies.present ? await dependencies.present(storedView) : storedView;
      if (dependencies.present) {
        request.signal.throwIfAborted();
        const latest = await dependencies.principal();
        if (!latest || latest.issuer !== principal.issuer || latest.subject !== principal.subject) {
          throw new AccountRequestError(409, 'account_changed');
        }
      }
      return Response.json(operation.kind === 'teams' ? { teams: accountTeams(view) } : view, { headers: PRIVATE_HEADERS });
    }
    let mutation: AccountMutation;
    if (operation.kind === 'profile' || operation.kind === 'link') mutation = { kind: operation.kind, body };
    else mutation = { kind: operation.kind, id: ('id' in operation ? operation.id : '') ?? '', body };
    await store.mutate(actor, mutation);
    return Response.json({ ok: true }, { headers: PRIVATE_HEADERS });
  } catch (error) { return accountErrorResponse(error); }
}
