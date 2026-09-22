import { afterEach, describe, expect, it, vi } from 'vitest';
import { accountAuthClient, accountAuthRequest } from './auth-client';

afterEach(() => { vi.unstubAllGlobals(); });

describe('maintained auth client error boundary', () => {
  it('handles the real SDK rejection for an invalid or expired reset token', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ code: 'INVALID_TOKEN', message: 'Synthetic token failure' }, { status: 400 })));
    const result = await accountAuthRequest(() => accountAuthClient.resetPassword({ newPassword: 'synthetic-new-password', token: 'synthetic-expired-token' }));
    expect(result.error).toMatchObject({ name: 'AuthApiError', code: 'bad_jwt' });
  });

  it('keeps declared recovery failures available for a generic email-eligibility response', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ code: 'USER_NOT_FOUND', message: 'Synthetic absent account' }, { status: 400 })));
    const result = await accountAuthRequest(() => accountAuthClient.requestPasswordReset({ email: 'absent@example.test', redirectTo: 'https://app.example.test/sign-in' }));
    expect(result.error).toMatchObject({ name: 'AuthApiError' });
  });

  it('preserves transport failure separately from an invalid reset link', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Synthetic offline request'); }));
    await expect(accountAuthRequest(() => accountAuthClient.resetPassword({ newPassword: 'synthetic-new-password', token: 'synthetic-offline-token' })))
      .rejects.toThrow('Synthetic offline request');
  });

  it('preserves successful SDK results', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ status: true })));
    const result = await accountAuthRequest(() => accountAuthClient.resetPassword({ newPassword: 'synthetic-new-password', token: 'synthetic-success-token' }));
    expect(result).toMatchObject({ data: { status: true }, error: null });
  });

  it.each([408, 429, 500, 503])('preserves actual SDK HTTP %s failures for retry instead of consuming a reset token', async status => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ message: 'Synthetic temporary provider failure' }, { status })));
    await expect(accountAuthRequest(() => accountAuthClient.resetPassword({ newPassword: 'synthetic-new-password', token: `synthetic-retry-token-${status}` })))
      .rejects.toMatchObject({ __isAuthError: true });
    await expect(accountAuthRequest(() => accountAuthClient.requestPasswordReset({ email: `synthetic-${status}@example.test`, redirectTo: 'https://app.example.test/sign-in' })))
      .rejects.toMatchObject({ __isAuthError: true });
  });

  it.each([undefined, '503', Number.NaN])('does not classify an auth error with malformed status %s as a definitive rejection', async status => {
    const error = Object.assign(new Error('Synthetic unknown auth failure'), { __isAuthError: true, status });
    await expect(accountAuthRequest(async () => { throw error; })).rejects.toBe(error);
  });
});
