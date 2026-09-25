import type { AccountView, SleeperLeagueDiscovery, SleeperLinkPreview } from '@/lib/accounts/contracts';
import type { CapabilityStatus, LeagueCapabilityReport } from '@/lib/league-capability-contracts';
import type { AccountAccessState } from './account-access';

export const ACCOUNT_SESSION_EVENT = 'league-one:account-session-change';
export type AccountRead = { status: 'ready'; data: AccountView } | { status: AccountAccessState };
export type SleeperLeagueRead = { status: 'ready'; data: SleeperLeagueDiscovery } | { status: 'unavailable' };

export async function readSleeperLinkPreview(accountId: string, sourceManagerAccountId: string,
  signal: AbortSignal, request: typeof fetch = fetch): Promise<SleeperLinkPreview> {
  const params = new URLSearchParams({ sourceManagerAccountId });
  const response = await request(`/api/me/provider-link-preview?${params}`, { signal, cache: 'no-store', credentials: 'same-origin',
    headers: { Accept: 'application/json', 'X-Expected-Account-ID': accountId } });
  if (!response.ok) throw new Error('Sleeper profile preview unavailable.');
  const value: unknown = await response.json();
  if (!value || typeof value !== 'object') throw new Error('Invalid Sleeper profile preview.');
  const data = value as SleeperLinkPreview;
  if (data.sourceManagerAccountId !== sourceManagerAccountId || !/^[1-9]\d{0,31}$/.test(data.userId)
    || typeof data.username !== 'string' || !data.username || typeof data.displayName !== 'string' || !data.displayName
    || !(data.avatarUrl === null || typeof data.avatarUrl === 'string' && data.avatarUrl.startsWith('https://sleepercdn.com/avatars/thumbs/'))
    || !/^\d{4}$/.test(data.season) || !Array.isArray(data.leagues) || !Array.isArray(data.teams)
    || !data.leagues.every(league => /^[1-9]\d{0,31}$/.test(league.id) && typeof league.name === 'string' && league.name)
    || !data.teams.every(team => data.leagues.some(league => league.id === team.leagueId)
      && typeof team.teamName === 'string' && Number.isSafeInteger(team.rosterId) && team.rosterId > 0
      && Array.isArray(team.players) && team.players.every(player => typeof player === 'string'))) {
    throw new Error('Invalid Sleeper profile preview.');
  }
  return data;
}

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

function isLeagueCapabilityReport(value: unknown): value is LeagueCapabilityReport {
  if (!value || typeof value !== 'object') return false;
  const report = value as LeagueCapabilityReport;
  const statuses: CapabilityStatus[] = ['supported', 'limited', 'unverified', 'unsupported'];
  const featureIds = ['roster', 'actual_scoring', 'projections', 'standings', 'schedule_history', 'substitutions'];
  const hash = (candidate: unknown) => candidate === null || typeof candidate === 'string' && /^[a-f0-9]{64}$/i.test(candidate);
  if (report.version !== 'league-capabilities-v1' || !statuses.includes(report.status)
    || !hash(report.configurationRevision) || !hash(report.scoringRulesHash)
    || typeof report.assessedAt !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(report.assessedAt)
    || !Number.isFinite(Date.parse(report.assessedAt)) || !Array.isArray(report.features) || report.features.length !== featureIds.length) return false;
  if (new Date(report.assessedAt).toISOString() !== (report.assessedAt.includes('.') ? report.assessedAt : report.assessedAt.replace('Z', '.000Z'))) return false;
  if (!report.features.every(feature => feature && featureIds.includes(feature.id) && typeof feature.label === 'string'
    && feature.label.length > 0 && feature.label.length <= 100 && statuses.includes(feature.status)
    && Array.isArray(feature.reasons) && feature.reasons.length <= 8
    && feature.reasons.every(reason => typeof reason === 'string' && reason.length > 0 && reason.length <= 400)
    && (feature.ruleKeys === undefined || Array.isArray(feature.ruleKeys) && feature.ruleKeys.length <= 512
      && feature.ruleKeys.every(key => typeof key === 'string' && key.length > 0 && key.length <= 80)))) return false;
  return new Set(report.features.map(feature => feature.id)).size === featureIds.length
    && statuses.indexOf(report.status) === Math.max(...report.features.map(feature => statuses.indexOf(feature.status)));
}

export async function readSleeperLeagues(accountId: string, signal: AbortSignal, request: typeof fetch = fetch): Promise<SleeperLeagueRead> {
  const response = await request('/api/me/sleeper-leagues', { signal, cache: 'no-store', credentials: 'same-origin',
    headers: { Accept: 'application/json', 'X-Expected-Account-ID': accountId } });
  if (!response.ok) return { status: 'unavailable' };
  const data: unknown = await response.json();
  if (!isSleeperLeagueDiscovery(data, accountId)) return { status: 'unavailable' };
  return { status: 'ready', data: { ...data, leagues: data.leagues.map(league => ({ ...league,
    capabilities: isLeagueCapabilityReport(league.capabilities) ? league.capabilities : undefined,
  })) } };
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
