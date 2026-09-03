import type {
  LeagueLifecycle,
  LeaguePeriod,
  LeaguePeriodAuthority,
  MatchupTemporalState,
  NflPhase,
} from './projections/domain/contracts';

export const MATCHUP_PERIOD_HEADERS = {
  defaultSeason: 'X-League-Default-Season',
  defaultWeek: 'X-League-Default-Week',
  activeSeason: 'X-League-Active-Season',
  activeWeek: 'X-League-Active-Week',
  temporalState: 'X-Matchup-Temporal-State',
  refreshDue: 'X-Projection-Refresh-Due',
} as const;

export type MatchupPeriodContext = Readonly<{
  defaultSeason: number;
  defaultWeek: number;
  activeSeason: number | null;
  activeWeek: number | null;
  lifecycle: LeagueLifecycle;
  nflPhase: NflPhase;
  temporalState: MatchupTemporalState;
  refreshDue: boolean;
}>;

function comparePeriod(left: LeaguePeriod, right: LeaguePeriod): number {
  return left.season - right.season || left.week - right.week;
}

export function matchupTemporalState(
  authority: Pick<LeaguePeriodAuthority,
    'defaultDisplayPeriod' | 'activeScoringPeriod' | 'lifecycle'
  >,
  targetWeek: number,
): MatchupTemporalState {
  if (!Number.isInteger(targetWeek) || targetWeek < 1 || targetWeek > 18) {
    throw new Error('Matchup target week is invalid.');
  }
  if (authority.lifecycle === 'preseason') return 'future';
  if (authority.lifecycle === 'complete') return 'past';
  if (!authority.activeScoringPeriod) {
    throw new Error('An active league requires an active scoring period.');
  }
  const target: LeaguePeriod = {
    season: authority.defaultDisplayPeriod.season,
    seasonType: authority.defaultDisplayPeriod.seasonType,
    week: targetWeek,
  };
  const comparison = comparePeriod(target, authority.activeScoringPeriod);
  return comparison < 0 ? 'past' : comparison > 0 ? 'future' : 'active';
}

export function matchupPeriodContext(
  authority: LeaguePeriodAuthority,
  targetWeek: number,
  refreshDue = false,
): MatchupPeriodContext {
  return {
    defaultSeason: authority.defaultDisplayPeriod.season,
    defaultWeek: authority.defaultDisplayPeriod.week,
    activeSeason: authority.activeScoringPeriod?.season ?? null,
    activeWeek: authority.activeScoringPeriod?.week ?? null,
    lifecycle: authority.lifecycle,
    nflPhase: authority.nflPhase,
    temporalState: matchupTemporalState(authority, targetWeek),
    refreshDue,
  };
}

export function matchupPeriodHeaders(context: MatchupPeriodContext): Headers {
  const headers = new Headers({
    [MATCHUP_PERIOD_HEADERS.defaultSeason]: String(context.defaultSeason),
    [MATCHUP_PERIOD_HEADERS.defaultWeek]: String(context.defaultWeek),
    [MATCHUP_PERIOD_HEADERS.temporalState]: context.temporalState,
    [MATCHUP_PERIOD_HEADERS.refreshDue]: String(context.refreshDue),
  });
  if (context.activeSeason !== null && context.activeWeek !== null) {
    headers.set(MATCHUP_PERIOD_HEADERS.activeSeason, String(context.activeSeason));
    headers.set(MATCHUP_PERIOD_HEADERS.activeWeek, String(context.activeWeek));
  }
  return headers;
}

function headerInteger(headers: Headers, name: string, minimum: number, maximum: number): number | null {
  const value = headers.get(name);
  if (!value || !/^\d+$/u.test(value)) return null;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= minimum && parsed <= maximum ? parsed : null;
}

/** Reads the public subset returned by the compact API without changing its JSON body. */
export function matchupPeriodContextFromHeaders(
  headers: Headers,
  fallback: MatchupPeriodContext,
): MatchupPeriodContext {
  const defaultSeason = headerInteger(headers, MATCHUP_PERIOD_HEADERS.defaultSeason, 1920, 2200);
  const defaultWeek = headerInteger(headers, MATCHUP_PERIOD_HEADERS.defaultWeek, 1, 18);
  const activeSeason = headerInteger(headers, MATCHUP_PERIOD_HEADERS.activeSeason, 1920, 2200);
  const activeWeek = headerInteger(headers, MATCHUP_PERIOD_HEADERS.activeWeek, 1, 18);
  const temporalState = headers.get(MATCHUP_PERIOD_HEADERS.temporalState);
  const refreshDue = headers.get(MATCHUP_PERIOD_HEADERS.refreshDue);
  if (defaultSeason === null || defaultWeek === null
    || !['past', 'active', 'future'].includes(temporalState ?? '')
    || !['true', 'false'].includes(refreshDue ?? '')
    || ((activeSeason === null) !== (activeWeek === null))) return fallback;
  return {
    ...fallback,
    defaultSeason,
    defaultWeek,
    activeSeason,
    activeWeek,
    temporalState: temporalState as MatchupTemporalState,
    refreshDue: refreshDue === 'true',
  };
}
