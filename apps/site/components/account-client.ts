import type { AccountView } from '@/lib/accounts/contracts';
import type { AccountAccessState } from './account-access';

export const ACCOUNT_SESSION_EVENT = 'league-one:account-session-change';
export type AccountRead = { status: 'ready'; data: AccountView } | { status: AccountAccessState };

export async function accountResponseState(response: Response): Promise<AccountAccessState | null> {
  if (response.status === 401) return 'guest';
  if (response.status === 403) return 'denied';
  if (response.ok) return null;
  if (response.status === 503) {
    const body: unknown = await response.clone().json().catch(() => null);
    if (body && typeof body === 'object' && 'error' in body && body.error === 'accounts_disabled') return 'disabled';
  }
  return 'unavailable';
}

export async function readAccount(signal: AbortSignal, request: typeof fetch = fetch): Promise<AccountRead> {
  const response = await request('/api/me', { signal, cache: 'no-store', credentials: 'same-origin', headers: { Accept: 'application/json' } });
  const status = await accountResponseState(response);
  if (status) return { status };
  const data = await response.json() as AccountView;
  if (!data?.profile || typeof data.profile.id !== 'string' || typeof data.profile.displayName !== 'string'
    || !Array.isArray(data.links) || !Array.isArray(data.library?.leagues) || !Array.isArray(data.library?.availableProviderAccounts)) {
    return { status: 'unavailable' };
  }
  return { status: 'ready', data };
}

/** Signal only a session change; no account identity or private state is persisted. */
export function announceAccountSessionChange() {
  window.dispatchEvent(new Event(ACCOUNT_SESSION_EVENT));
  if (typeof BroadcastChannel !== 'undefined') {
    try {
      const channel = new BroadcastChannel(ACCOUNT_SESSION_EVENT);
      channel.postMessage('changed');
      channel.close();
    } catch { /* Restricted browsers still revalidate when a tab becomes visible. */ }
  }
}
