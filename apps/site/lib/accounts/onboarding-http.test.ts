import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
vi.mock('next/headers', () => ({ headers: vi.fn() }));
import { onboardingResponse } from './onboarding-http';
import type { AccountView } from './contracts';
const actor = '11111111-1111-4111-8111-111111111111';
const manager = '22222222-2222-4222-8222-222222222222';
const principal = { issuer: 'https://example.test/api/auth', subject: 'member', displayName: 'Member' };
const state = { profile: { id: actor, displayName: 'Member', revision: 1 }, links: [], library: {
  leagues: [], availableProviderAccounts: [{ id: manager, provider: 'sleeper', externalId: '123', displayName: 'Member', username: 'member' }],
} } as AccountView;
function dependencies() {
  const store = { resolve: vi.fn(async () => actor), read: vi.fn(async () => state), mutate: vi.fn(async () => undefined),
    readDiscoveryProfiles: vi.fn(async () => []) };
  return { principal: vi.fn(async () => principal as typeof principal | null), store: () => store,
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
    expect(deps.store().mutate).toHaveBeenCalledWith(actor, { kind: 'link', body: { sourceManagerAccountId: manager } });
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
