import { afterEach, describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
import { AccountAdmissionDeniedError, AccountAuthUnavailableError } from './auth';
import { AccountStoreUnavailableError, AccountWriteRateLimitError } from './database';
import { accountResponse, readAccountJson, requireAccountOrigin, sleeperLeagueDiscoveryResponse, sleeperLinkPreviewResponse } from './http';
import { AccountConflictError } from './store';
import type { AccountView, LinkedSleeperProfile, SleeperLeagueDiscovery, SleeperLinkPreview } from './contracts';

const actor = '10000000-0000-4000-8000-000000000001';
const principal = { issuer: 'https://test.neon.tech/auth', subject: 'provider-subject', displayName: 'Member' };
function dependencies() {
  const view: AccountView = { profile: { id: actor, displayName: 'Member', revision: 1 }, links: [], library: { leagues: [], availableProviderAccounts: [] } };
  const store = { resolve: vi.fn(async () => actor), read: vi.fn(async () => view), mutate: vi.fn(async () => {}) };
  return { principal: vi.fn(async () => principal as typeof principal | null), store: vi.fn(() => store) };
}
function request(body: unknown = { displayName: 'New name', revision: 1 }, origin = 'https://www.league1fantasy.com'): Request {
  return new Request('https://www.league1fantasy.com/api/me/profile', { method: 'PATCH', headers: { origin, 'content-type': 'application/json', 'x-expected-account-id': actor }, body: JSON.stringify(body) });
}
afterEach(() => vi.unstubAllEnvs());
describe('Sleeper account-link recognition boundary', () => {
  const sourceId = '40000000-0000-4000-8000-000000000004';
  const provider = { id: sourceId, provider: 'sleeper' as const, externalId: '123456789012345678',
    displayName: 'Sleeper Member', username: 'sleepermember' };
  const preview: SleeperLinkPreview = { sourceManagerAccountId: sourceId, userId: provider.externalId,
    username: provider.username, displayName: provider.displayName, avatarUrl: null, season: '2026',
    leagues: [{ id: '987654321', name: 'League One' }],
    teams: [{ leagueId: '987654321', leagueName: 'League One', rosterId: 1, teamName: 'My Team', players: ['Josh Allen'] }] };
  function previewDeps() {
    const view: AccountView = { profile: { id: actor, displayName: 'Member', revision: 1 }, links: [],
      library: { leagues: [], availableProviderAccounts: [provider] } };
    const store = { resolve: vi.fn(async () => actor), read: vi.fn(async () => view) };
    return { principal: vi.fn(async () => principal as typeof principal | null), store: vi.fn(() => store),
      preview: vi.fn(async () => preview) };
  }
  function previewRequest(source = sourceId, expected = actor) {
    return new Request(`https://www.league1fantasy.com/api/me/provider-link-preview?sourceManagerAccountId=${source}`,
      { headers: { 'x-expected-account-id': expected } });
  }
  it('previews only an available profile under the signed-in account and rechecks it after the provider call', async () => {
    const deps = previewDeps();
    const input = previewRequest();
    const response = await sleeperLinkPreviewResponse(input, deps);
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toContain('private, no-store');
    expect(await response.json()).toEqual(preview);
    expect(deps.preview).toHaveBeenCalledWith(provider, input.signal);
    expect(deps.store().read).toHaveBeenCalledTimes(2);
  });
  it('never previews an arbitrary, already linked, logged-out, or stale-account candidate', async () => {
    const arbitrary = previewDeps();
    expect((await sleeperLinkPreviewResponse(previewRequest('50000000-0000-4000-8000-000000000005'), arbitrary)).status).toBe(400);
    expect(arbitrary.preview).not.toHaveBeenCalled();
    const linked = previewDeps();
    linked.store().read.mockResolvedValue({ profile: { id: actor, displayName: 'Member', revision: 1 },
      links: [{ id: '60000000-0000-4000-8000-000000000006', sourceManagerAccountId: sourceId,
        displayName: 'Sleeper Member', provider: 'sleeper', assurance: 'user_asserted', revision: 1 }],
      library: { leagues: [], availableProviderAccounts: [provider] } });
    expect((await sleeperLinkPreviewResponse(previewRequest(), linked)).status).toBe(400);
    const loggedOut = previewDeps(); loggedOut.principal.mockResolvedValue(null);
    expect((await sleeperLinkPreviewResponse(previewRequest(), loggedOut)).status).toBe(401);
    const changed = previewDeps();
    expect((await sleeperLinkPreviewResponse(previewRequest(sourceId, '70000000-0000-4000-8000-000000000007'), changed)).status).toBe(409);
  });
  it('withholds a result when session or profile availability changes during lookup', async () => {
    const session = previewDeps();
    session.principal.mockResolvedValueOnce(principal).mockResolvedValueOnce(null);
    expect((await sleeperLinkPreviewResponse(previewRequest(), session)).status).toBe(409);
    const association = previewDeps();
    association.store().read.mockResolvedValueOnce({ profile: { id: actor, displayName: 'Member', revision: 1 },
      links: [], library: { leagues: [], availableProviderAccounts: [provider] } })
      .mockResolvedValueOnce({ profile: { id: actor, displayName: 'Member', revision: 1 }, links: [],
        library: { leagues: [], availableProviderAccounts: [] } });
    expect((await sleeperLinkPreviewResponse(previewRequest(), association)).status).toBe(409);
  });
});
describe('private account HTTP boundary', () => {
  it('returns private/no-store data and derives the actor from a verified identity only', async () => {
    const deps = dependencies();
    const response = await accountResponse(new Request('https://www.league1fantasy.com/api/me?userId=someone-else'), { kind: 'read' }, deps);
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toContain('private, no-store');
    expect(response.headers.get('vary')).toBe('Cookie');
    expect(deps.store().resolve).toHaveBeenCalledWith(principal);
    expect(deps.store().read).toHaveBeenCalledWith(actor);
  });
  it('does no database work for a logged-out or uninvited caller', async () => {
    const deps = dependencies();
    deps.principal.mockResolvedValue(null);
    expect((await accountResponse(request(), { kind: 'read' }, deps)).status).toBe(401);
    expect(deps.store).not.toHaveBeenCalled();
    deps.principal.mockRejectedValue(new AccountAdmissionDeniedError('not_invited'));
    expect((await accountResponse(request(), { kind: 'read' }, deps)).status).toBe(403);
    expect(deps.store).not.toHaveBeenCalled();
  });
  it.each(['disabled', 'configuration', 'provider'] as const)('keeps %s auth failures private and avoids account storage', async reason => {
    const deps = dependencies();
    deps.principal.mockRejectedValue(new AccountAuthUnavailableError(reason));
    const response = await accountResponse(request(), { kind: 'read' }, deps);
    expect(response.status).toBe(503);
    expect(response.headers.get('cache-control')).toContain('no-store');
    expect(await response.json()).toEqual({ error: reason === 'disabled' ? 'accounts_disabled' : 'account_unavailable' });
    expect(deps.store).not.toHaveBeenCalled();
  });
  it('requires configured exact same-origin JSON mutations before resolving an identity', async () => {
    vi.stubEnv('ACCOUNTS_APP_ORIGIN', 'https://www.league1fantasy.com');
    const deps = dependencies();
    const response = await accountResponse(request({}, 'https://other.example'), { kind: 'profile' }, deps);
    expect(response.status).toBe(403);
    expect(deps.principal).not.toHaveBeenCalled();
    expect(deps.store).not.toHaveBeenCalled();
    expect(() => requireAccountOrigin(new Request('https://www.league1fantasy.com', { method: 'POST' }))).toThrow();
  });
  it('rejects unconfigured or unsafe canonical origins', () => {
    for (const origin of [undefined, 'not-url', 'http://www.league1fantasy.com', 'https://user:secret@www.league1fantasy.com', 'https://www.league1fantasy.com/path']) {
      expect(() => requireAccountOrigin(request(), origin)).toThrow();
    }
  });
  it('uses session actor for writes and reports stale changes as a conflict', async () => {
    vi.stubEnv('ACCOUNTS_APP_ORIGIN', 'https://www.league1fantasy.com');
    const deps = dependencies();
    const body = { displayName: 'New name', revision: 1 };
    expect((await accountResponse(request(body), { kind: 'profile' }, deps)).status).toBe(200);
    expect(deps.store().mutate).toHaveBeenCalledWith(actor, { kind: 'profile', body });
    deps.store().mutate.mockRejectedValue(new AccountConflictError());
    const conflict = await accountResponse(request(body), { kind: 'profile' }, deps);
    expect(conflict.status).toBe(409);
    expect(await conflict.json()).toEqual({ error: 'revision_conflict' });
  });
  it('does not expose database failures or private data in errors', async () => {
    const deps = dependencies();
    deps.store().read.mockRejectedValue(new AccountStoreUnavailableError());
    const response = await accountResponse(request(), { kind: 'read' }, deps);
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: 'account_unavailable' });
  });
  it('rejects a form from an earlier account when the current session has changed', async () => {
    vi.stubEnv('ACCOUNTS_APP_ORIGIN', 'https://www.league1fantasy.com');
    const deps = dependencies();
    deps.store().resolve.mockResolvedValue('10000000-0000-4000-8000-000000000002');
    const response = await accountResponse(request(), { kind: 'profile' }, deps);
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: 'account_changed' });
    expect(deps.store().mutate).not.toHaveBeenCalled();
  });
  it('returns a private rate limit with a bounded retry disposition', async () => {
    vi.stubEnv('ACCOUNTS_APP_ORIGIN', 'https://www.league1fantasy.com');
    const deps = dependencies();
    deps.store().mutate.mockRejectedValue(new AccountWriteRateLimitError());
    const response = await accountResponse(request(), { kind: 'profile' }, deps);
    expect(response.status).toBe(429);
    expect(response.headers.get('retry-after')).toBe('60');
    expect(response.headers.get('cache-control')).toContain('no-store');
    expect(await response.json()).toEqual({ error: 'too_many_changes' });
  });
  it('bounds actual streamed body size even with a misleading content length', async () => {
    vi.stubEnv('ACCOUNTS_APP_ORIGIN', 'https://www.league1fantasy.com');
    const deps = dependencies();
    const oversized = new Request('https://www.league1fantasy.com/api/me/profile', { method: 'PATCH',
      headers: { origin: 'https://www.league1fantasy.com', 'content-type': 'application/json', 'content-length': '5', 'x-expected-account-id': actor }, body: JSON.stringify({ value: 'a'.repeat(5000) }) });
    expect((await accountResponse(oversized, { kind: 'profile' }, deps)).status).toBe(413);
    expect(deps.principal).not.toHaveBeenCalled();
  });
  it('rejects malformed JSON and form posts', async () => {
    await expect(readAccountJson(new Request('https://example.test', { method: 'POST', body: '{', headers: { 'content-type': 'application/json' } }))).rejects.toThrow('Invalid JSON');
    await expect(readAccountJson(new Request('https://example.test', { method: 'POST', body: 'name=bad', headers: { 'content-type': 'application/x-www-form-urlencoded' } }))).rejects.toThrow();
  });
});

describe('authenticated Sleeper league discovery HTTP boundary', () => {
  const linked: LinkedSleeperProfile = { linkId: '30000000-0000-4000-8000-000000000003', revision: 1,
    sourceManagerAccountId: '40000000-0000-4000-8000-000000000004', externalId: '123456789012345678',
    displayName: 'Associated Sleeper profile' };
  function discoveryRequest(expected: string | null = actor, suffix = '') {
    return new Request(`https://www.league1fantasy.com/api/me/sleeper-leagues${suffix}`,
      { headers: expected === null ? {} : { 'x-expected-account-id': expected } });
  }
  function discoveryDependencies() {
    const store = { resolve: vi.fn(async () => actor), readDiscoveryProfiles: vi.fn(async () => [linked]) };
    const result: Omit<SleeperLeagueDiscovery, 'accountId'> = { season: '2026', status: 'complete',
      profiles: [{ sourceManagerAccountId: linked.sourceManagerAccountId, displayName: linked.displayName, status: 'complete' }],
      leagues: [{ id: '123', name: 'Discovered', season: '2026', url: 'https://sleeper.com/leagues/123',
        sourceManagerAccountIds: [linked.sourceManagerAccountId] }] };
    return { principal: vi.fn(async () => principal as typeof principal | null),
      store: vi.fn(() => store), discover: vi.fn(async () => result) };
  }
  it('uses only the authenticated actor and active stable associations with private uncached responses', async () => {
    const deps = discoveryDependencies(); const input = discoveryRequest();
    const response = await sleeperLeagueDiscoveryResponse(input, deps);
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toContain('private, no-store');
    expect(response.headers.get('vary')).toBe('Cookie');
    expect(await response.json()).toMatchObject({ accountId: actor, season: '2026', status: 'complete' });
    expect(deps.discover).toHaveBeenCalledWith([linked], input.signal);
    expect(deps.store().readDiscoveryProfiles).toHaveBeenCalledTimes(2);
    expect(deps.principal).toHaveBeenCalledTimes(2);
  });
  it('performs no provider or storage work for logged-out, denied or disabled callers', async () => {
    for (const failure of [null, new AccountAdmissionDeniedError('not_invited'), new AccountAuthUnavailableError('disabled')]) {
      const deps = discoveryDependencies();
      if (failure === null) deps.principal.mockResolvedValue(null); else deps.principal.mockRejectedValue(failure);
      const response = await sleeperLeagueDiscoveryResponse(discoveryRequest(), deps);
      expect([401, 403, 503]).toContain(response.status);
      expect(deps.store).not.toHaveBeenCalled();
      expect(deps.discover).not.toHaveBeenCalled();
    }
  });
  it('requires the expected-account precondition and rejects alternate user targeting', async () => {
    for (const input of [discoveryRequest(null), discoveryRequest('not-a-uuid'), discoveryRequest(actor, '?userId=someone')]) {
      const deps = discoveryDependencies();
      expect((await sleeperLeagueDiscoveryResponse(input, deps)).status).toBe(400);
      expect(deps.store).not.toHaveBeenCalled();
      expect(deps.discover).not.toHaveBeenCalled();
    }
    const deps = discoveryDependencies();
    expect((await sleeperLeagueDiscoveryResponse(discoveryRequest('90000000-0000-4000-8000-000000000009'), deps)).status).toBe(409);
    expect(deps.store().readDiscoveryProfiles).not.toHaveBeenCalled();
    expect(deps.discover).not.toHaveBeenCalled();
  });
  it('rejects cross-site discovery before contacting the provider', async () => {
    vi.stubEnv('ACCOUNTS_APP_ORIGIN', 'https://www.league1fantasy.com');
    const deps = discoveryDependencies();
    const input = new Request(discoveryRequest(), { headers: { 'x-expected-account-id': actor,
      origin: 'https://untrusted.example', 'sec-fetch-site': 'cross-site' } });
    expect((await sleeperLeagueDiscoveryResponse(input, deps)).status).toBe(403);
    expect(deps.discover).not.toHaveBeenCalled();
  });
  it('withholds results when a session is revoked or changes during discovery', async () => {
    const revoked = discoveryDependencies();
    revoked.principal.mockResolvedValueOnce(principal).mockResolvedValueOnce(null);
    const loggedOut = await sleeperLeagueDiscoveryResponse(discoveryRequest(), revoked);
    expect(loggedOut.status).toBe(401); expect(await loggedOut.json()).toEqual({ error: 'unauthenticated' });
    const changed = discoveryDependencies();
    changed.principal.mockResolvedValueOnce(principal).mockResolvedValueOnce({ ...principal, subject: 'different' });
    const conflict = await sleeperLeagueDiscoveryResponse(discoveryRequest(), changed);
    expect(conflict.status).toBe(409); expect(await conflict.json()).toEqual({ error: 'account_changed' });
  });
  it('withholds discoveries if an association was removed or replaced while the provider was loading', async () => {
    const deps = discoveryDependencies();
    deps.store().readDiscoveryProfiles.mockResolvedValueOnce([linked]).mockResolvedValueOnce([]);
    const response = await sleeperLeagueDiscoveryResponse(discoveryRequest(), deps);
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: 'associations_changed' });
  });
  it('sanitizes storage failure and never invokes discovery', async () => {
    const deps = discoveryDependencies();
    deps.store().readDiscoveryProfiles.mockRejectedValue(new AccountStoreUnavailableError());
    const response = await sleeperLeagueDiscoveryResponse(discoveryRequest(), deps);
    expect(response.status).toBe(503); expect(await response.json()).toEqual({ error: 'account_unavailable' });
    expect(deps.discover).not.toHaveBeenCalled();
  });
});
