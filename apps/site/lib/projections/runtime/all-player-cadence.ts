import type { AllPlayerJobState, StoredLeagueAuthorityRead } from '../adapters/neon/contracts';
import type { LeaguePeriod } from '../domain/contracts';
import { isAllPlayerRefreshOpportunity } from '../../all-player-refresh-schedule';

const DAY_MS = 86_400_000;

/** A cheap opportunity gate; SQL remains the cross-invocation budget authority. */
export function isAllPlayerPollingOpportunity(now: Date): boolean {
  return isAllPlayerRefreshOpportunity(now);
}

type Selection =
  | Readonly<{ kind: 'selected'; period: LeaguePeriod; requireFinalCoverage: boolean;
      diagnostics?: readonly string[] }>
  | Readonly<{ kind: 'unavailable'; reason: string; period?: LeaguePeriod;
      diagnostics?: readonly string[] }>;

export function selectAllPlayerRecurringPeriod(
  authorities: readonly StoredLeagueAuthorityRead[],
  job: AllPlayerJobState | null,
  now: Date,
  expectedLeagueKeys: readonly string[],
): Selection {
  const expected = new Set(expectedLeagueKeys);
  if (expected.size === 0 || expected.size !== expectedLeagueKeys.length
    || expectedLeagueKeys.some((key) => !key.trim() || key !== key.trim())
    || authorities.length !== expected.size
    || new Set(authorities.map((row) => row.leagueKey)).size !== expected.size
    || authorities.some((row) => row.kind !== 'available' || !expected.has(row.leagueKey)
      || row.authority.leagueKey !== row.leagueKey)) {
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
  const diagnostics: string[] = [];
  const selected = (target: LeaguePeriod, requireFinalCoverage: boolean): Selection => ({
    kind: 'selected', period: target, requireFinalCoverage,
    ...(diagnostics.length ? { diagnostics } : {}),
  });
  const unavailable = (reason: string): Selection => ({
    kind: 'unavailable', reason, period: diagnostics.length
      ? { ...period, week: Number(diagnostics[0].split(':').at(-1)) } : period,
    ...(diagnostics.length ? { diagnostics } : {}),
  });
  // Retain overdue complete-score obligations without stopping accepted current
  // raw evidence. The finite correction window prevents unbounded old polling.
  for (let targetWeek = 1; targetWeek < week - (completed ? 0 : 1); targetWeek += 1) {
    if (!capturedFinal(targetWeek)) diagnostics.push(`final-capture-overdue:${season}:regular:${targetWeek}`);
  }
  if (!completed && week === 1) return selected(period, false);
  // A league can advance its display period while its active scoring period is
  // unchanged. Default-period timing never establishes the correction deadline
  // for a different active week. Exact current game context is checked in ingestion.
  if (!completed && available.some(({ authority }) => authority.defaultSeason !== season
    || authority.defaultSeasonType !== seasonType || authority.defaultWeek !== week)) {
    diagnostics.push(`correction-window-period-unavailable:${season}:regular:${week - 1}`);
    return selected(period, false);
  }
  const kickoffTimes = available.flatMap(({ authority }) => authority.defaultPeriodCadence.games)
    .map((game) => game.kickoffAt ? Date.parse(game.kickoffAt) : NaN);
  if (!kickoffTimes.length || kickoffTimes.some((time) => !Number.isFinite(time))) {
    if (completed) return unavailable('correction-window-schedule-unavailable');
    diagnostics.push(`correction-window-schedule-unavailable:${season}:regular:${week - 1}`);
    return selected(period, false);
  }
  // End after the new week's normal Monday, based on its actual first kickoff.
  // This is a finite correction policy, not evidence that any game is final.
  const correctionEndsAt = (completed ? Math.max(...kickoffTimes) : Math.min(...kickoffTimes)) + 5 * DAY_MS;
  if (completed) {
    if (now.getTime() <= correctionEndsAt) return selected(period, true);
    if (!capturedFinal(week)) diagnostics.push(`final-capture-overdue:${season}:regular:${week}`);
    return unavailable('season-correction-window-closed');
  }
  const prior: LeaguePeriod = { ...period, week: week - 1 };
  const priorFinal = capturedFinal(prior.week);
  if (now.getTime() > correctionEndsAt) {
    if (!priorFinal) diagnostics.push(`final-capture-overdue:${season}:regular:${prior.week}`);
    return selected(period, false);
  }
  const last = job?.payload.period;
  const lastWasPrior = last && typeof last === 'object'
    && 'season' in last && last.season === season
    && 'week' in last && last.week === prior.week;
  // Previous final capture gets the first opportunity at rollover. Alternation
  // then provides corrections without starving the current period.
  return lastWasPrior ? selected(period, false) : selected(prior, true);
}
