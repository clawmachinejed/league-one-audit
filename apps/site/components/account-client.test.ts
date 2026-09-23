import { describe, expect, it, vi } from 'vitest';
import { accountResponseState, readAccount, readSleeperLeagues } from './account-client';

describe('private account browser transport', () => {
  it('uses an abortable same-origin no-store request and returns only the current response', async () => {
    const data = { profile: { id: 'user-a', displayName: 'Member', revision: 1 }, links: [], library: { leagues: [], availableProviderAccounts: [] } };
    const request = vi.fn<typeof fetch>(async () => Response.json(data));
    const controller = new AbortController();
    expect(await readAccount(controller.signal, request)).toEqual({ status: 'ready', data });
    expect(request).toHaveBeenCalledWith('/api/me', {
      signal: controller.signal, cache: 'no-store', credentials: 'same-origin', headers: { Accept: 'application/json' },
    });
  });

  it.each([
    [401, 'unauthenticated', 'guest'],
    [403, 'admission_denied', 'denied'],
    [503, 'accounts_disabled', 'disabled'],
    [503, 'account_unavailable', 'unavailable'],
    [500, 'unexpected', 'unavailable'],
  ] as const)('drops private data for HTTP %i / %s', async (status, error, expected) => {
    const request = vi.fn<typeof fetch>(async () => Response.json({ error }, { status }));
    expect(await readAccount(new AbortController().signal, request)).toEqual({ status: expected });
  });

  it('does not accept an incomplete private response as a signed-in profile', async () => {
    const request = vi.fn<typeof fetch>(async () => Response.json({ profile: { id: 'user-a' } }));
    expect(await readAccount(new AbortController().signal, request)).toEqual({ status: 'unavailable' });
  });

  it('does not retry aborted requests or fall back to a cached account', async () => {
    const request = vi.fn<typeof fetch>(async () => { throw new DOMException('Aborted', 'AbortError'); });
    await expect(readAccount(new AbortController().signal, request)).rejects.toMatchObject({ name: 'AbortError' });
    expect(request).toHaveBeenCalledOnce();
  });

  it('classifies an unavailable non-JSON response safely', async () => {
    expect(await accountResponseState(new Response('unavailable', { status: 503 }))).toBe('unavailable');
  });
});

describe('private Sleeper league browser transport', () => {
  const data = { accountId: 'user-a', season: '2026', status: 'complete',
    profiles: [{ sourceManagerAccountId: 'source-a', displayName: 'Member', status: 'complete' }],
    leagues: [{ id: '1234567890123456789', name: 'A Sleeper league', season: '2026',
      url: 'https://sleeper.com/leagues/1234567890123456789', sourceManagerAccountIds: ['source-a'] }] };

  it('binds an abortable private request to the displayed account without accepting a provider identity from the browser', async () => {
    const request = vi.fn<typeof fetch>(async () => Response.json(data));
    const controller = new AbortController();
    expect(await readSleeperLeagues('user-a', controller.signal, request)).toEqual({ status: 'ready', data });
    expect(request).toHaveBeenCalledWith('/api/me/sleeper-leagues', {
      signal: controller.signal, cache: 'no-store', credentials: 'same-origin',
      headers: { Accept: 'application/json', 'X-Expected-Account-ID': 'user-a' },
    });
  });

  it.each([401, 403, 409, 503])('drops discovery data when access fails with %i', async status => {
    const request = vi.fn<typeof fetch>(async () => Response.json(data, { status }));
    expect(await readSleeperLeagues('user-a', new AbortController().signal, request)).toEqual({ status: 'unavailable' });
  });

  it.each([
    { ...data, accountId: 'user-b' },
    { ...data, leagues: [{ ...data.leagues[0], url: 'https://untrusted.example' }] },
    { ...data, leagues: [{ ...data.leagues[0], id: 1234567890123456789 }] },
    { ...data, leagues: [{ ...data.leagues[0], sourceManagerAccountIds: ['source-b'] }] },
    { ...data, leagues: [{ ...data.leagues[0], season: '2025' }] },
    { ...data, profiles: null },
  ])('rejects a response from another account or outside the validated league contract', async body => {
    const request = vi.fn<typeof fetch>(async () => Response.json(body));
    expect(await readSleeperLeagues('user-a', new AbortController().signal, request)).toEqual({ status: 'unavailable' });
  });

  it('does not retry an aborted discovery request', async () => {
    const request = vi.fn<typeof fetch>(async () => { throw new DOMException('Aborted', 'AbortError'); });
    await expect(readSleeperLeagues('user-a', new AbortController().signal, request)).rejects.toMatchObject({ name: 'AbortError' });
    expect(request).toHaveBeenCalledOnce();
  });
});
