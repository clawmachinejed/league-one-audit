'use client';

import { createAuthClient, isAuthError } from '@neondatabase/auth/next';

export const accountAuthClient = createAuthClient();

/** The pinned Neon adapter throws declared auth failures before Better Auth can
 * return its error envelope. Keep those distinct from transport/module failures. */
export async function accountAuthRequest<T>(request: () => Promise<T>): Promise<T | { error: unknown }> {
  try { return await request(); }
  catch (error) {
    if (isAuthError(error)) {
      const status = error.status;
      // The SDK also normalizes provider outages/rate limits as AuthError. Only
      // definite non-transient client failures may consume a recovery token.
      if (typeof status === 'number' && Number.isInteger(status) && status >= 400 && status < 500
        && status !== 408 && status !== 429) return { error };
    }
    throw error;
  }
}

// The pinned SDK normalizes Better Auth's EMAIL_NOT_VERIFIED to this typed code.
export function isAccountEmailUnverified(error: unknown): boolean {
  return isAuthError(error) && error.code === 'email_not_confirmed';
}
