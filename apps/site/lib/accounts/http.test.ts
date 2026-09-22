import { afterEach, describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
import { AccountAdmissionDeniedError, AccountAuthUnavailableError } from './auth';
import { AccountStoreUnavailableError, AccountWriteRateLimitError } from './database';
import { accountResponse, readAccountJson, requireAccountOrigin } from './http';
import { AccountConflictError } from './store';
import type { AccountView } from './contracts';

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
