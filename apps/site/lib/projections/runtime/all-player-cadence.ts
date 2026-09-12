import type { AllPlayerJobState, StoredLeagueAuthorityRead } from '../adapters/neon/contracts';
import type { LeaguePeriod } from '../domain/contracts';

export const ALL_PLAYER_POLL_MINUTES = 15;
const DAY_MS = 86_400_000;

/** A cheap opportunity gate; SQL remains the cross-invocation budget authority. */
export function isAllPlayerPollingOpportunity(now: Date): boolean {
  return Number.isFinite(now.getTime()) && now.getUTCMinutes() % ALL_PLAYER_POLL_MINUTES === 0;
}

type Selection =
  | Readonly<{ kind: 'selected'; period: LeaguePeriod; requireFinalCoverage: boolean }>
  | Readonly<{ kind: 'unavailable'; reason: string }>;

export function selectAllPlayerRecurringPeriod(
  authorities: readonly StoredLeagueAuthorityRead[],
  job: AllPlayerJobState | null,
  now: Date,
): Selection {
  if (authorities.length !== 2 || authorities.some((row) => row.kind !== 'available')) {
    return { kind: 'unavailable', reason: 'authority-missing' };
  }
  const available = authorities.filter((row) => row.kind === 'available');
  const first = available[0].authority;
  const completed = first.leagueLifecycle === 'complete';
  const season = completed ? first.defaultSeason : first.activeSeason;
  const seasonType = completed ? first.defaultSeasonType : first.activeSeasonType;
  const week = completed ? first.defaultWeek : first.activeWeek;
  if (season === null || season < 2026 || seasonType !== 'reg' || week === null
    || week < 1 || week > 18 || (!completed && first.leagueLifecycle !== 'active')) {
    return { kind: 'unavailable', reason: 'authority-period-unavailable' };
  }
  if (available.some(({ authority }) => authority.leagueLifecycle !== first.leagueLifecycle
    || (completed ? authority.defaultSeason : authority.activeSeason) !== season
    || (completed ? authority.defaultSeasonType : authority.activeSeasonType) !== seasonType
    || (completed ? authority.defaultWeek : authority.activeWeek) !== week
    || authority.sourceProvider !== 'sleeper'
    || !Number.isFinite(Date.parse(authority.verifiedAt))
    || now.getTime() - Date.parse(authority.verifiedAt) > 600_000
    || Date.parse(authority.verifiedAt) > now.getTime() + 30_000)) {
    return { kind: 'unavailable', reason: 'authority-inconsistent-or-stale' };
  }
  const period: LeaguePeriod = { season, seasonType: 'regular', week };
  const history = Array.isArray(job?.payload.periodHistory) ? job.payload.periodHistory : [];
  const capturedFinal = (targetWeek: number) => history.some((entry) => entry && typeof entry === 'object'
    && 'period' in entry && entry.period && typeof entry.period === 'object'
    && 'season' in entry.period && entry.period.season === season
    && 'seasonType' in entry.period && entry.period.seasonType === 'reg'
    && 'week' in entry.period && entry.period.week === targetWeek
    && 'finalCoverage' in entry && entry.finalCoverage === true);
  // Final capture is a season obligation, not a moving current-week-minus-one
  // query. A missed older period remains visible after any later rollover.
  for (let targetWeek = 1; targetWeek < week - (completed ? 0 : 1); targetWeek += 1) {
    if (!capturedFinal(targetWeek)) return {
      kind: 'unavailable', reason: `final-capture-overdue:${season}:regular:${targetWeek}`,
    };
  }
  const kickoffTimes = available.flatMap(({ authority }) => authority.defaultPeriodCadence.games)
    .map((game) => game.kickoffAt ? Date.parse(game.kickoffAt) : NaN);
  if (!kickoffTimes.length || kickoffTimes.some((time) => !Number.isFinite(time))) {
    return { kind: 'unavailable', reason: 'correction-window-schedule-unavailable' };
  }
  // End after the new week's normal Monday, based on its actual first kickoff.
  // This is a finite correction policy, not evidence that any game is final.
  const correctionEndsAt = (completed ? Math.max(...kickoffTimes) : Math.min(...kickoffTimes)) + 5 * DAY_MS;
  if (completed) return now.getTime() <= correctionEndsAt
    ? { kind: 'selected', period, requireFinalCoverage: true }
    : { kind: 'unavailable', reason: 'season-correction-window-closed' };
  if (week === 1) return { kind: 'selected', period, requireFinalCoverage: false };
  const prior: LeaguePeriod = { ...period, week: week - 1 };
  const priorFinal = capturedFinal(prior.week);
  if (now.getTime() > correctionEndsAt) {
    return priorFinal ? { kind: 'selected', period, requireFinalCoverage: false }
      : { kind: 'unavailable', reason: 'previous-week-final-capture-overdue' };
  }
  const last = job?.payload.period;
  const lastWasPrior = last && typeof last === 'object'
    && 'season' in last && last.season === season
    && 'week' in last && last.week === prior.week;
  // Previous final capture gets the first opportunity at rollover. Alternation
  // then provides corrections without starving the current period.
  return lastWasPrior ? { kind: 'selected', period, requireFinalCoverage: false }
    : { kind: 'selected', period: prior, requireFinalCoverage: true };
}
