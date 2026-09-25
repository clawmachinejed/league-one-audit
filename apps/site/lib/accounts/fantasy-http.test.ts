import { afterEach, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
vi.mock('next/headers', () => ({ headers: vi.fn() }));
import { accountFantasyResponse } from './fantasy';
import type { AccountView } from './contracts';
const actor = '11111111-1111-4111-8111-111111111111';
const principal = { issuer: 'https://example.test/api/auth', subject: 'member', displayName: 'Member' };
function dependencies() {
  const view: AccountView = { profile: { id: actor, displayName: 'Member', revision: 1 }, links: [], library: { leagues: [], availableProviderAccounts: [] } };
  const store = { resolve: vi.fn(async () => actor), read: vi.fn(async () => view), mutate: vi.fn(async () => undefined), readDiscoveryProfiles: vi.fn(async () => []) };
  return { principal: vi.fn(async () => principal as typeof principal | null), store: () => store, load: vi.fn(async () => []) };
}
function request(search = '', expected = actor) {
  return new Request(`https://example.test/api/me/fantasy${search}`, { headers: { 'X-Expected-Account-ID': expected } });
}
afterEach(() => vi.unstubAllEnvs());
it('keeps personalized exact-week results private', async () => {
  const deps = dependencies();
  const response = await accountFantasyResponse(request('?week=4'), deps);
  expect(response.status).toBe(200);
  expect(response.headers.get('cache-control')).toContain('private, no-store');
  expect(response.headers.get('vary')).toBe('Cookie');
  expect(deps.load).toHaveBeenCalledWith(await deps.store().read(), 4);
  expect(await response.json()).toMatchObject({ accountId: actor, memberships: [] });
});
it('requires a session and rejects stale actor preconditions before league loads', async () => {
  const deps = dependencies(); deps.principal.mockResolvedValue(null);
  expect((await accountFantasyResponse(request(), deps)).status).toBe(401);
  deps.principal.mockResolvedValue(principal);
  expect((await accountFantasyResponse(request('', '22222222-2222-4222-8222-222222222222'), deps)).status).toBe(409);
  expect(deps.load).not.toHaveBeenCalled();
});
it.each(['?week=0', '?week=1&week=2', '?userId=someone'])('rejects invalid private queries %s', async search => {
  const deps = dependencies();
  expect((await accountFantasyResponse(request(search), deps)).status).toBe(400);
  expect(deps.load).not.toHaveBeenCalled();
});
it('rejects a cross-site request', async () => {
  vi.stubEnv('ACCOUNTS_APP_ORIGIN', 'https://example.test');
  const input = request(); input.headers.set('Origin', 'https://untrusted.test');
  expect((await accountFantasyResponse(input, dependencies())).status).toBe(403);
});
it('discards a result after logout or removal of an association', async () => {
  const deps = dependencies();
  deps.principal.mockResolvedValueOnce(principal).mockResolvedValueOnce(null);
  expect((await accountFantasyResponse(request(), deps)).status).toBe(409);
  const changed = dependencies(); const initial = await changed.store().read();
  changed.store().read.mockResolvedValueOnce({ ...initial, links: [{ id: actor, sourceManagerAccountId: actor, displayName: 'Member', provider: 'sleeper', assurance: 'user_asserted', revision: 1 }] });
  expect((await accountFantasyResponse(request(), changed)).status).toBe(409);
});
