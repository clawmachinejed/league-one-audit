import type { SleeperLeague } from './transform';

export const MANAGER_HISTORY_MAX_SEASONS = 20;

/** Display scope is curated per permanent league, never inferred from its name. */
export function managerHistoryFirstSeason(leagueKey: string): number {
  return leagueKey === 'league1' ? 2024 : 2025;
}

/** Preserve the established Weeks 1–14 policy, narrowed by an earlier playoff. */
export function managerHistoryRegularEnd(league: Pick<SleeperLeague, 'settings'>): number {
  const start = league.settings?.playoff_week_start;
  return typeof start === 'number' && Number.isInteger(start) && start > 0
    ? Math.max(0, Math.min(14, start - 1)) : 14;
}

export function managerHistoryUnsupported(league: Pick<SleeperLeague, 'settings'>): boolean {
  return Number(league.settings?.league_average_match ?? 0) !== 0
    || Number(league.settings?.best_ball ?? 0) !== 0
    || Number(league.settings?.start_week ?? 1) !== 1;
}

/** This is the source's explicit predecessor key, not a roster or name match. */
export function managerHistoryPreviousLeagueId(value: unknown, seen: ReadonlySet<string>): string {
  if (seen.size >= MANAGER_HISTORY_MAX_SEASONS || typeof value !== 'string' || !/^\d+$/u.test(value)
    || seen.has(value)) throw new Error('The prior-season league connection is missing or invalid.');
  return value;
}

/** Call only after the caller's source-envelope and league-shape validation. */
export function assertManagerHistoryPreviousSeasonIdentity(value: unknown, externalLeagueId: string, season: number): void {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || !('league_id' in value) || value.league_id !== externalLeagueId
    || !('season' in value) || value.season !== String(season)
    || !('status' in value) || value.status !== 'complete') {
    throw new Error('The prior-season league identity or completed status could not be verified.');
  }
}
