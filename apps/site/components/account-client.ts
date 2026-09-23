import type { AccountView, SleeperLeagueDiscovery } from '@/lib/accounts/contracts';
import type { AccountAccessState } from './account-access';

export const ACCOUNT_SESSION_EVENT = 'league-one:account-session-change';
export type AccountRead = { status: 'ready'; data: AccountView } | { status: AccountAccessState };
export type SleeperLeagueRead = { status: 'ready'; data: SleeperLeagueDiscovery } | { status: 'unavailable' };

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

function isSleeperLeagueDiscovery(value: unknown, accountId: string): value is SleeperLeagueDiscovery {
  if (!value || typeof value !== 'object') return false;
  const data = value as SleeperLeagueDiscovery;
  if (data.accountId !== accountId || !['complete', 'partial', 'unavailable'].includes(data.status)
    || !(data.season === null || typeof data.season === 'string' && /^\d{4}$/.test(data.season))
    || !Array.isArray(data.profiles) || !Array.isArray(data.leagues)) return false;
  if (!data.profiles.every(profile => profile && typeof profile.sourceManagerAccountId === 'string'
    && typeof profile.displayName === 'string' && ['complete', 'unavailable'].includes(profile.status))) return false;
  const profileIds = new Set(data.profiles.map(profile => profile.sourceManagerAccountId));
  return data.leagues.every(league => league && typeof league.id === 'string' && /^[1-9]\d{0,31}$/.test(league.id)
    && typeof league.name === 'string' && typeof league.season === 'string' && league.season === data.season
    && league.url === `https://sleeper.com/leagues/${league.id}`
    && Array.isArray(league.sourceManagerAccountIds) && league.sourceManagerAccountIds.length > 0
    && league.sourceManagerAccountIds.every(id => typeof id === 'string' && profileIds.has(id)));
}

export async function readSleeperLeagues(accountId: string, signal: AbortSignal, request: typeof fetch = fetch): Promise<SleeperLeagueRead> {
  const response = await request('/api/me/sleeper-leagues', { signal, cache: 'no-store', credentials: 'same-origin',
    headers: { Accept: 'application/json', 'X-Expected-Account-ID': accountId } });
  if (!response.ok) return { status: 'unavailable' };
  const data: unknown = await response.json();
  return isSleeperLeagueDiscovery(data, accountId) ? { status: 'ready', data } : { status: 'unavailable' };
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
