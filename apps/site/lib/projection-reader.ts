import 'server-only';

import { isMatchupsData } from './matchups-response';
import {
  matchupTemporalState,
  type MatchupPeriodContext,
} from './matchup-period';
import { selectStoredMatchups } from './projection-freshness';
import {
  getProjectionStore,
  InvalidStoredProjectionSnapshotError,
  type ProjectionStore,
  type StoredLeaguePeriodAuthority,
  type StoredProjectionSnapshot,
} from './projection-store';
import type { LeaguePeriod, SeasonType } from './projections/domain/contracts';
import type { MatchupsData } from './types';

export type StoredMatchupsReadResult = Readonly<{
  kind: 'usable';
  payload: MatchupsData;
  historical: boolean;
  context: MatchupPeriodContext;
}> | Readonly<{
  kind: 'stale';
  context: MatchupPeriodContext;
}> | Readonly<{
  kind: 'missing' | 'disabled' | 'malformed' | 'database-error';
  context?: MatchupPeriodContext;
}>;

function canonicalSeasonType(value: 'pre' | 'reg' | 'post'): SeasonType {
  return value === 'pre' ? 'preseason' : value === 'post' ? 'postseason' : 'regular';
}

function contextFor(
  authority: StoredLeaguePeriodAuthority,
  targetWeek: number,
): MatchupPeriodContext {
  const defaultDisplayPeriod: LeaguePeriod = {
    season: authority.defaultSeason,
    seasonType: canonicalSeasonType(authority.defaultSeasonType),
    week: authority.defaultWeek,
  };
  const activeScoringPeriod: LeaguePeriod | null = authority.activeSeason === null
    || authority.activeSeasonType === null || authority.activeWeek === null
    ? null
    : {
        season: authority.activeSeason,
        seasonType: canonicalSeasonType(authority.activeSeasonType),
        week: authority.activeWeek,
      };
  return {
    defaultSeason: authority.defaultSeason,
    defaultWeek: authority.defaultWeek,
    activeSeason: authority.activeSeason,
    activeWeek: authority.activeWeek,
    lifecycle: authority.leagueLifecycle,
    nflPhase: authority.nflPhase,
    temporalState: matchupTemporalState({
      defaultDisplayPeriod,
      activeScoringPeriod,
      lifecycle: authority.leagueLifecycle,
    }, targetWeek),
    refreshDue: false,
  };
}

function validSnapshot(
  snapshot: StoredProjectionSnapshot,
  authority: StoredLeaguePeriodAuthority,
  expectedWeek: number,
): boolean {
  return snapshot.week === expectedWeek
    && isMatchupsData(snapshot.payload)
    && snapshot.payload.week === expectedWeek
    && snapshot.payload.league.week === expectedWeek
    && Number(snapshot.payload.league.season) === authority.defaultSeason;
}

/**
 * Resolves the exact requested/default week by stable internal league key.
 * It never substitutes the numerically latest stored week.
 */
export async function readStoredMatchups(
  leagueKey: string,
  requestedWeek?: number,
  options: Readonly<{ store?: ProjectionStore; now?: Date }> = {},
): Promise<StoredMatchupsReadResult> {
  const store = options.store ?? getProjectionStore();
  if (!store.enabled) return { kind: 'disabled' };

  try {
    const stored = await store.readMatchupSnapshotByLeagueKey(leagueKey, requestedWeek);
    if (!stored) return { kind: 'missing' };
    const targetWeek = requestedWeek ?? stored.authority.defaultWeek;
    const context = contextFor(stored.authority, targetWeek);
    if (!stored.snapshot) return { kind: 'missing', context };
    if (!validSnapshot(stored.snapshot, stored.authority, targetWeek)) {
      return { kind: 'malformed', context };
    }
    return selectStoredMatchups(stored.snapshot, context, options.now ?? new Date());
  } catch (error) {
    return error instanceof InvalidStoredProjectionSnapshotError
      ? { kind: 'malformed' }
      : { kind: 'database-error' };
  }
}
