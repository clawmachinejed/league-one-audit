import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  availability: 'available' as 'available' | 'disabled' | 'unavailable',
  principal: vi.fn(),
  redirect: vi.fn((destination: string): never => { throw new Error(`redirect:${destination}`); }),
}));

vi.mock('next/navigation', () => ({ redirect: mocks.redirect }));
vi.mock('@/lib/accounts/auth', () => ({
  AccountAdmissionDeniedError: class extends Error {},
  AccountAuthUnavailableError: class extends Error {},
  getAccountAuthAvailability: () => mocks.availability,
  getAccountPrincipal: mocks.principal,
}));

import Home from './page';
import { AccountAdmissionDeniedError, AccountAuthUnavailableError } from '@/lib/accounts/auth';

beforeEach(() => {
  vi.clearAllMocks();
  mocks.availability = 'available';
});

describe('site entry', () => {
  it('sends guests to sign in and returning account members to My Fantasy', async () => {
    mocks.principal.mockResolvedValueOnce(null).mockResolvedValueOnce({ subject: 'member' });
    await expect(Home()).rejects.toThrow('redirect:/sign-in');
    await expect(Home()).rejects.toThrow('redirect:/my-fantasy');
    expect(mocks.principal).toHaveBeenCalledTimes(2);
  });

  it('keeps public My Fantasy available when the account pilot is disabled', async () => {
    mocks.availability = 'disabled';
    await expect(Home()).rejects.toThrow('redirect:/my-fantasy');
    expect(mocks.principal).not.toHaveBeenCalled();
  });

  it('keeps public My Fantasy available during a session provider outage', async () => {
    mocks.principal.mockRejectedValueOnce(new AccountAuthUnavailableError('provider'));
    await expect(Home()).rejects.toThrow('redirect:/my-fantasy');
  });

  it('sends an inadmissible session to sign in', async () => {
    mocks.principal.mockRejectedValueOnce(new AccountAdmissionDeniedError('not_invited'));
    await expect(Home()).rejects.toThrow('redirect:/sign-in');
  });
});
