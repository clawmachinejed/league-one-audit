'use client';

import { createAuthClient } from 'better-auth/react';
import { emailOTPClient } from 'better-auth/client/plugins';

export function createAccountAuthClient(baseURL?: string) {
  return createAuthClient({ ...(baseURL ? { baseURL } : {}), plugins: [emailOTPClient()] });
}
export const accountAuthClient = createAccountAuthClient();

/** Only definite client failures may consume the form's one-time reset token.
 * Native Better Auth returns HTTP failures; transport failures remain thrown. */
export async function accountAuthRequest<T extends { error?: unknown }>(request: () => Promise<T>): Promise<T> {
  const result = await request();
  if (result.error) {
    const status = typeof result.error === 'object' && result.error !== null && 'status' in result.error
      ? result.error.status : undefined;
    if (typeof status !== 'number' || !Number.isInteger(status) || status < 400 || status >= 500
      || status === 408 || status === 429) throw new Error('Account access is temporarily unavailable.');
  }
  return result;
}

export function isAccountEmailUnverified(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && 'status' in error
    && error.code === 'EMAIL_NOT_VERIFIED' && error.status === 403;
}
