import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
vi.mock('next/headers', () => ({ headers: vi.fn() }));
import { onboardingResponse } from './onboarding-http';
import type { AccountView } from './contracts';
import { AccountRevisionConflictError } from './database';
const timing = { dbSampleAt: '2026-10-06T00:00:00.000Z', minimumAuthorityExpiresAt: '2026-10-06T00:01:00.000Z', remainingLifetimeMs: '60000' };
const sameAuthority = (left: { issuer: string; subject: string }, right: { issuer: string; subject: string }) => left.issuer === right.issuer && left.subject === right.subject;
const actor = '11111111-1111-4111-8111-111111111111';
const manager = '22222222-2222-4222-8222-222222222222';
const principal = { issuer: 'https://example.test/api/auth', subject: 'member', displayName: 'Member' };
const state = { profile: { id: actor, displayName: 'Member', revision: 1 }, links: [], library: {
  leagues: [], availableProviderAccounts: [{ id: manager, provider: 'sleeper', externalId: '123', displayName: 'Member', username: 'member' }],
} } as AccountView;
function dependencies() {
  const store = { resolve: vi.fn(async () => actor), read: vi.fn(async () => state), mutate: vi.fn(async () => timing),
    readDiscoveryProfiles: vi.fn(async () => []) };
  return { sameAuthority, principal: vi.fn(async () => principal as typeof principal | null), store: () => Object.assign(store, { readFinal: async () => ({ value: await store.read(), decisionTiming: timing }), readDiscoveryProfilesFinal: async () => ({ value: await store.readDiscoveryProfiles(), decisionTiming: timing }) }),
    preview: vi.fn(async () => ({ userId: '123', username: 'member', displayName: 'Member', avatarUrl: null, season: '2026', teams: [] })),
    importTeam: vi.fn(async () => undefined) };
}
function request(body: unknown, expected = actor, origin = 'https://example.test') {
  return new Request('https://example.test/api/me/sleeper-onboarding', { method: 'POST',
    headers: { Origin: origin, 'Content-Type': 'application/json', 'X-Expected-Account-ID': expected }, body: JSON.stringify(body) });
}
const confirmation = { action: 'confirm', userId: '123', leagueId: '456', rosterId: 1 };
beforeEach(() => vi.stubEnv('ACCOUNTS_APP_ORIGIN', 'https://example.test'));
describe('private onboarding HTTP boundary', () => {
  it('rebinds the post-import read and final mutation to a fresh receipt-owned store', async () => {
    const deps = dependencies();
    const old = deps.store();
    const freshPrincipal = { ...principal };
    const fresh = { ...old, mutate: vi.fn(async () => timing) };
    deps.principal.mockResolvedValueOnce(principal).mockResolvedValueOnce(freshPrincipal);
    const store = vi.fn((bound: typeof principal) => bound === freshPrincipal ? fresh : old);
    const response = await onboardingResponse(request(confirmation), { ...deps, store });
    expect(response.status).toBe(200);
    expect(old.mutate).not.toHaveBeenCalled();
    expect(fresh.mutate).toHaveBeenCalledExactlyOnceWith(actor, { kind: 'link', body: { sourceManagerAccountId: manager } },
      { profileRevision: 1, links: [] });
    expect(store.mock.calls.map(call => call[0])).toEqual([principal, freshPrincipal]);
  });
  it('withholds an import when account revisions change while provider work runs', async () => {
    const deps = dependencies();
    deps.store().read.mockResolvedValueOnce(state).mockResolvedValueOnce({ ...state, profile: { ...state.profile, revision: 2 } });
    const response = await onboardingResponse(request(confirmation), deps);
    expect(response.status).toBe(409);
    expect(deps.store().mutate).not.toHaveBeenCalled();
  });
  it('rejects a revision race inside the final mutation without repeating the import or write', async () => {
    const deps = dependencies();
    deps.store().mutate.mockRejectedValue(new AccountRevisionConflictError());
    const response = await onboardingResponse(request(confirmation), deps);
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: 'revision_conflict' });
    expect(deps.importTeam).toHaveBeenCalledTimes(1);
    expect(deps.store().mutate).toHaveBeenCalledTimes(1);
  });
  it('withholds a committed import acknowledgement when the final authority expires in transit', async () => {
    let now = 0;
    const clock = vi.spyOn(performance, 'now').mockImplementation(() => now);
    try {
      const deps = dependencies();
      deps.importTeam.mockImplementation(async () => { now = 20_000; });
      deps.store().mutate.mockImplementation(async () => {
        now += 1000;
        return { ...timing, minimumAuthorityExpiresAt: '2026-10-06T00:00:01.000Z', remainingLifetimeMs: '1000' };
      });
      const response = await onboardingResponse(request(confirmation), deps);
      expect(response.status).toBe(503);
      expect(await response.json()).toEqual({ error: 'account_unavailable' });
      expect(deps.importTeam).toHaveBeenCalledTimes(1);
      expect(deps.store().mutate).toHaveBeenCalledTimes(1);
    } finally { clock.mockRestore(); }
  });
  it('preserves the existing provider budget and starts the final 12-second decision after import', async () => {
    let now = 0;
    const clock = vi.spyOn(performance, 'now').mockImplementation(() => now);
    try {
      const deps = dependencies();
      deps.importTeam.mockImplementation(async () => { now = 20_000; });
      expect((await onboardingResponse(request(confirmation), deps)).status).toBe(200);
      expect(deps.store().mutate).toHaveBeenCalledTimes(1);
    } finally { clock.mockRestore(); }
  });
  it('keeps preview read-only and private', async () => {
    const deps = dependencies();
    const response = await onboardingResponse(request({ action: 'preview', username: 'member' }), deps);
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toContain('private, no-store');
    expect(response.headers.get('vary')).toBe('Cookie');
    expect(deps.importTeam).not.toHaveBeenCalled();
    expect(deps.store().mutate).not.toHaveBeenCalled();
  });
  it('rejects an old account form before provider work', async () => {
    const deps = dependencies();
    const response = await onboardingResponse(request(confirmation, manager), deps);
    expect(response.status).toBe(409); expect(deps.importTeam).not.toHaveBeenCalled();
  });
  it('requires a session and exact origin', async () => {
    const deps = dependencies(); deps.principal.mockResolvedValue(null);
    expect((await onboardingResponse(request(confirmation), deps)).status).toBe(401);
    expect((await onboardingResponse(request(confirmation, actor, 'https://evil.test'), deps)).status).toBe(403);
    expect(deps.importTeam).not.toHaveBeenCalled();
  });
  it.each([{ ...confirmation, actorId: manager }, { ...confirmation, leagueId: '../456' },
    { ...confirmation, rosterId: 0 }, { action: 'preview', username: 'name/path' }])('rejects malformed or actor-selecting input', async body => {
    const deps = dependencies();
    expect((await onboardingResponse(request(body), deps)).status).toBe(400);
    expect(deps.importTeam).not.toHaveBeenCalled();
  });
  it('associates only the source profile produced by accepted evidence', async () => {
    const deps = dependencies();
    expect((await onboardingResponse(request(confirmation), deps)).status).toBe(200);
    expect(deps.store().mutate).toHaveBeenCalledWith(actor, { kind: 'link', body: { sourceManagerAccountId: manager } }, { profileRevision: 1, links: [] });
  });
  it('does not associate to a replacement session after a slow import', async () => {
    const deps = dependencies();
    deps.principal.mockResolvedValueOnce(principal).mockResolvedValueOnce({ ...principal, subject: 'replacement' });
    expect((await onboardingResponse(request(confirmation), deps)).status).toBe(409);
    expect(deps.store().mutate).not.toHaveBeenCalled();
  });
  it('discards a preview if the session changes during discovery', async () => {
    const deps = dependencies();
    deps.principal.mockResolvedValueOnce(principal).mockResolvedValueOnce(null);
    expect((await onboardingResponse(request({ action: 'preview', username: 'member' }), deps)).status).toBe(409);
  });
  it('never leaks transport errors or connection details', async () => {
    const deps = dependencies(); deps.importTeam.mockRejectedValue(new Error('postgresql://secret@host'));
    const response = await onboardingResponse(request(confirmation), deps);
    expect(response.status).toBe(503); expect(await response.text()).not.toContain('secret');
  });
});
