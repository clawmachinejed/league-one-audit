import type { LeaguePeriod, LeaguePeriodAuthority } from './contracts';
import { sameExternalReference, type ExternalLeagueRef } from '../shared/provider-identity';

export type LineupWatchPeriodClass = 'current' | 'future' | 'completed';
export type MatchupWeekRange = Readonly<{ firstWeek: number; lastWeek: number }>;
export const LINEUP_AUTHORITY_MAX_AGE_MS = 10 * 60_000;

export type LineupPeriodClassification =
  | Readonly<{
      kind: 'classified';
      watchClass: LineupWatchPeriodClass;
      materializationLane: 'current' | 'future' | null;
    }>
  | Readonly<{
      kind: 'unavailable';
      reason: 'missing' | 'stale' | 'malformed' | 'provider-mismatch' | 'regressing' | 'out-of-horizon';
    }>;

export function validMatchupWeekRange(range: MatchupWeekRange): boolean {
  return Number.isInteger(range.firstWeek) && Number.isInteger(range.lastWeek)
    && range.firstWeek >= 1 && range.lastWeek <= 18 && range.firstWeek <= range.lastWeek;
}

function validPeriod(period: LeaguePeriod): boolean {
  return Number.isInteger(period.season) && period.season >= 1920 && period.season <= 2200
    && ['preseason', 'regular', 'postseason'].includes(period.seasonType)
    && Number.isInteger(period.week) && period.week >= 1 && period.week <= 18;
}

function regresses(next: LeaguePeriodAuthority, previous: LeaguePeriodAuthority): boolean {
  const current = next.defaultDisplayPeriod;
  const prior = previous.defaultDisplayPeriod;
  if (current.season !== prior.season) return current.season < prior.season;
  if (current.seasonType !== prior.seasonType) return true;
  if (current.week < prior.week) return true;
  const lifecycleRank = { preseason: 0, active: 1, complete: 2 } as const;
  if (lifecycleRank[next.lifecycle] < lifecycleRank[previous.lifecycle]) return true;
  return next.activeScoringPeriod !== null && previous.activeScoringPeriod !== null
    && next.activeScoringPeriod.week < previous.activeScoringPeriod.week;
}

/** Operational ownership is deliberately separate from website past/active/future display. */
export function classifyLineupWatchPeriod(
  authority: LeaguePeriodAuthority | null,
  period: LeaguePeriod,
  options: Readonly<{
    now: Date;
    range: MatchupWeekRange;
    expectedLeagueRef: ExternalLeagueRef;
    maxAuthorityAgeMs?: number;
    previousAuthority?: LeaguePeriodAuthority;
  }>,
): LineupPeriodClassification {
  const unavailable = (reason: Extract<LineupPeriodClassification, { kind: 'unavailable' }>['reason']): LineupPeriodClassification => ({ kind: 'unavailable', reason });
  if (!authority) return unavailable('missing');
  if (!validPeriod(period) || !validMatchupWeekRange(options.range)) return unavailable('malformed');
  if (authority.source !== options.expectedLeagueRef.provider
    || !sameExternalReference(authority.configuration.leagueRef, options.expectedLeagueRef)) {
    return unavailable('provider-mismatch');
  }
  const defaultPeriod = authority.defaultDisplayPeriod;
  const active = authority.activeScoringPeriod;
  const now = options.now.getTime();
  const observed = Date.parse(authority.observedAt);
  const verified = Date.parse(authority.verifiedAt);
  const maxAge = options.maxAuthorityAgeMs ?? LINEUP_AUTHORITY_MAX_AGE_MS;
  if (!Number.isFinite(now) || !Number.isFinite(observed) || !Number.isFinite(verified)
    || !Number.isFinite(maxAge) || maxAge < 0 || verified < observed || observed > now
    || verified > now || !validPeriod(defaultPeriod)
    || !['preseason', 'active', 'complete'].includes(authority.lifecycle)
    || (authority.lifecycle === 'active') !== (active !== null)
    || (active !== null && (!validPeriod(active) || active.season !== defaultPeriod.season
      || active.seasonType !== defaultPeriod.seasonType || active.week > defaultPeriod.week))) {
    return unavailable('malformed');
  }
  if (now - observed > maxAge || now - verified > maxAge) return unavailable('stale');
  if (options.previousAuthority && regresses(authority, options.previousAuthority)) return unavailable('regressing');
  if (period.week < options.range.firstWeek || period.week > options.range.lastWeek
    || period.season > defaultPeriod.season || period.seasonType !== defaultPeriod.seasonType) {
    return unavailable('out-of-horizon');
  }
  if (authority.lifecycle === 'complete' || period.season < defaultPeriod.season) {
    return { kind: 'classified', watchClass: 'completed', materializationLane: null };
  }
  const anchor = active ?? defaultPeriod;
  if (period.week < anchor.week) return { kind: 'classified', watchClass: 'completed', materializationLane: null };
  if (period.week > anchor.week) return { kind: 'classified', watchClass: 'future', materializationLane: 'future' };
  return {
    kind: 'classified', watchClass: 'current',
    materializationLane: authority.lifecycle === 'preseason' ? 'future' : 'current',
  };
}
