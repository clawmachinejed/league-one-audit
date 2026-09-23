import { afterEach, describe, expect, it, vi } from 'vitest';
import { createAccountAuthClient, accountAuthRequest, isAccountEmailUnverified } from './auth-client';

// Browsers resolve the SDK's relative /api/auth URL. Node tests supply their
// synthetic origin and create the real client after installing mock transport.
const client = () => createAccountAuthClient('https://app.example.test');

afterEach(() => { vi.unstubAllGlobals(); });

describe('maintained auth client error boundary', () => {
  it('recognizes the maintained SDK normalized email-verification failure', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ code: 'EMAIL_NOT_VERIFIED', message: 'Synthetic verification required' }, { status: 403 })));
    const result = await accountAuthRequest(() => client().signIn.email({ email: 'invited@example.test', password: 'synthetic-password' }));
    expect(result.error).toMatchObject({ code: 'EMAIL_NOT_VERIFIED', status: 403 });
    expect(isAccountEmailUnverified(result.error)).toBe(true);
  });

  it('does not infer verification eligibility from a message or an untyped error', () => {
    expect(isAccountEmailUnverified(new Error('Email verification required'))).toBe(false);
    expect(isAccountEmailUnverified({ code: 'email_not_confirmed', status: 422 })).toBe(false);
    expect(isAccountEmailUnverified({ __isAuthError: true, code: 'invalid_credentials', status: 401 })).toBe(false);
  });

  it('handles the real SDK rejection for an invalid or expired reset token', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ code: 'INVALID_TOKEN', message: 'Synthetic token failure' }, { status: 400 })));
    const result = await accountAuthRequest(() => client().resetPassword({ newPassword: 'synthetic-new-password', token: 'synthetic-expired-token' }));
    expect(result.error).toMatchObject({ code: 'INVALID_TOKEN', status: 400 });
  });

  it('keeps declared recovery failures available for a generic email-eligibility response', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ code: 'USER_NOT_FOUND', message: 'Synthetic absent account' }, { status: 400 })));
    const result = await accountAuthRequest(() => client().requestPasswordReset({ email: 'absent@example.test', redirectTo: 'https://app.example.test/sign-in' }));
    expect(result.error).toMatchObject({ code: 'USER_NOT_FOUND', status: 400 });
  });

  it('preserves transport failure separately from an invalid reset link', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Synthetic offline request'); }));
    await expect(accountAuthRequest(() => client().resetPassword({ newPassword: 'synthetic-new-password', token: 'synthetic-offline-token' })))
      .rejects.toThrow('Synthetic offline request');
  });

  it('preserves successful SDK results', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ status: true })));
    const result = await accountAuthRequest(() => client().resetPassword({ newPassword: 'synthetic-new-password', token: 'synthetic-success-token' }));
    expect(result).toMatchObject({ data: { status: true }, error: null });
  });

  it.each([408, 429, 500, 503])('preserves actual SDK HTTP %s failures for retry instead of consuming a reset token', async status => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ message: 'Synthetic temporary provider failure' }, { status })));
    await expect(accountAuthRequest(() => client().resetPassword({ newPassword: 'synthetic-new-password', token: `synthetic-retry-token-${status}` })))
      .rejects.toThrow('Account access is temporarily unavailable.');
    await expect(accountAuthRequest(() => client().requestPasswordReset({ email: `synthetic-${status}@example.test`, redirectTo: 'https://app.example.test/sign-in' })))
      .rejects.toThrow('Account access is temporarily unavailable.');
  });

  it.each([undefined, '503', Number.NaN])('does not classify an auth error with malformed status %s as a definitive rejection', async status => {
    const error = Object.assign(new Error('Synthetic unknown auth failure'), { __isAuthError: true, status });
    await expect(accountAuthRequest(async () => { throw error; })).rejects.toBe(error);
  });
});
