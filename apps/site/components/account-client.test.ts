import { describe, expect, it, vi } from 'vitest';
import { accountResponseState, readAccount } from './account-client';

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
