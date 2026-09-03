import 'server-only';

import { isMatchupsData } from './matchups-response';
import {
  matchupTemporalState,
  type MatchupPeriodContext,
} from './matchup-period';
import { selectStoredMatchups } from './projection-freshness';
import { ACTIVE_PROJECTION_SOURCE } from './projection-source-config';
import {
  getProjectionStore,
  InvalidStoredProjectionSnapshotError,
  type ProjectionStore,
  type StoredFutureMaterializationFreshness,
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
  kind: 'missing' | 'disabled' | 'malformed' | 'database-error' | 'authority-stale';
  context?: MatchupPeriodContext;
}>;

const PERIOD_AUTHORITY_MAX_AGE_MS = 10 * 60 * 1_000;
const MAX_FUTURE_TIMESTAMP_SKEW_MS = 5 * 60 * 1_000;

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

function futureRefreshDue(
  refresh: StoredFutureMaterializationFreshness | null,
  snapshot: StoredProjectionSnapshot,
  now: Date,
): boolean {
  if (!refresh) return true;
  const nowMs = now.getTime();
  if (!Number.isFinite(nowMs)) return true;
  if (refresh.activeAttemptExpiresAt !== null) {
    const attemptExpiresMs = Date.parse(refresh.activeAttemptExpiresAt);
    if (Number.isFinite(attemptExpiresMs) && attemptExpiresMs > nowMs) return false;
  }
  if (refresh.lastSucceededAt === null
    || refresh.lastSnapshotRevision !== snapshot.revisionKey
    || refresh.lastProjectionSlateContentId === null
    || refresh.currentProjectionSlateContentId === null
    || refresh.lastProjectionSlateContentId !== refresh.currentProjectionSlateContentId) {
    return true;
  }
  const nextRefreshMs = Date.parse(refresh.nextRefreshAt);
  const lastSucceededMs = Date.parse(refresh.lastSucceededAt);
  if (!Number.isFinite(nowMs) || !Number.isFinite(nextRefreshMs)
    || !Number.isFinite(lastSucceededMs)) return true;
  if (lastSucceededMs > nowMs + MAX_FUTURE_TIMESTAMP_SKEW_MS) return true;
  if (nextRefreshMs > nowMs) return false;
  return true;
}

function periodAuthorityIsFresh(authority: StoredLeaguePeriodAuthority, now: Date): boolean {
  const nowMs = now.getTime();
  const verifiedAtMs = Date.parse(authority.verifiedAt);
  return Number.isFinite(nowMs) && Number.isFinite(verifiedAtMs)
    && verifiedAtMs <= nowMs + MAX_FUTURE_TIMESTAMP_SKEW_MS
    && nowMs - verifiedAtMs <= PERIOD_AUTHORITY_MAX_AGE_MS;
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
    const stored = await store.readMatchupSnapshotByLeagueKey(leagueKey, requestedWeek, {
      projectionProvider: ACTIVE_PROJECTION_SOURCE.provider,
      normalizerVersion: ACTIVE_PROJECTION_SOURCE.normalizerVersion,
      modelVersion: ACTIVE_PROJECTION_SOURCE.modelVersion,
    });
    if (!stored) return { kind: 'missing' };
    const now = options.now ?? new Date();
    const targetWeek = requestedWeek ?? stored.authority.defaultWeek;
    const context = contextFor(stored.authority, targetWeek);
    if (!stored.snapshot) {
      return periodAuthorityIsFresh(stored.authority, now)
        ? { kind: 'missing', context }
        : { kind: 'missing' };
    }
    if (!periodAuthorityIsFresh(stored.authority, now)) return { kind: 'authority-stale' };
    if (!validSnapshot(stored.snapshot, stored.authority, targetWeek)) {
      return { kind: 'malformed', context };
    }
    return selectStoredMatchups(stored.snapshot, context, now, {
      ...(context.temporalState === 'future'
        ? { futureRefreshDue: futureRefreshDue(stored.futureRefresh, stored.snapshot, now) }
        : {}),
    });
  } catch (error) {
    return error instanceof InvalidStoredProjectionSnapshotError
      ? { kind: 'malformed' }
      : { kind: 'database-error' };
  }
}
