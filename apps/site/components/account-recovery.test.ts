import { describe, expect, it } from 'vitest';
import { accountRecovery } from './account-recovery';

describe('managed account recovery callback', () => {
  it('ignores ordinary sign-in navigation', () => {
    expect(accountRecovery('')).toEqual({ kind: 'none' });
    expect(accountRecovery('?returnTo=/account')).toEqual({ kind: 'none' });
  });

  it('keeps a single managed token opaque and ignores unrelated destinations', () => {
    expect(accountRecovery('?token=synthetic.opaque_token-123&returnTo=https://example.test')).toEqual({ kind: 'reset', token: 'synthetic.opaque_token-123' });
  });

  it.each(['?token=', '?token=one&token=two', '?token=has%20space', '?token=line%0Abreak', `?token=${'x'.repeat(2049)}`])('rejects malformed token callbacks', search => {
    expect(accountRecovery(search)).toEqual({ kind: 'invalid' });
  });

  it('does not display provider errors or use a token accompanying an error', () => {
    expect(accountRecovery('?error=INVALID_TOKEN')).toEqual({ kind: 'invalid' });
    expect(accountRecovery('?error=private-provider-detail&token=synthetic')).toEqual({ kind: 'invalid' });
  });
});
