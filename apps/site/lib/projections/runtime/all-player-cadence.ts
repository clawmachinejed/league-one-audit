import type { AllPlayerJobState, StoredLeagueAuthorityRead } from '../adapters/neon/contracts';
import type { LeaguePeriod } from '../domain/contracts';
import { isAllPlayerRefreshOpportunity } from '../../all-player-refresh-schedule';

const DAY_MS = 86_400_000;

function recordedPeriod(value: unknown): Readonly<{ season: number; seasonType: 'reg'; week: number }> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const period = value as Record<string, unknown>;
  return typeof period.season === 'number' && Number.isInteger(period.season)
    && period.season >= 2026 && period.season <= 2200 && period.seasonType === 'reg'
    && typeof period.week === 'number' && Number.isInteger(period.week) && period.week >= 1 && period.week <= 18
    ? { season: period.season, seasonType: 'reg', week: period.week } : null;
}

function lastAllPlayerPeriod(job: AllPlayerJobState | null) {
  const outcome = job?.payload.lastOutcome;
  const fromOutcome = outcome && typeof outcome === 'object' && !Array.isArray(outcome)
    && 'outcome' in outcome && typeof outcome.outcome === 'string'
    && ['published', 'captured', 'partial', 'no-statistics-yet', 'validation-failed', 'provider-failed', 'timeout', 'lease-lost'].includes(outcome.outcome)
    && 'period' in outcome ? recordedPeriod(outcome.period) : null;
  // Minute-level live captures share the job, but do not advance hourly history.
  // Older job payloads lack lastOutcome; retain their validated requested period.
  return fromOutcome ?? (job?.payload.mode === 'live-defense' ? null : recordedPeriod(job?.payload.period));
}

/** A cheap opportunity gate; SQL remains the cross-invocation budget authority. */
export function isAllPlayerPollingOpportunity(now: Date): boolean {
  return isAllPlayerRefreshOpportunity(now);
}

type PeriodSelection =
  | Readonly<{ kind: 'selected'; period: LeaguePeriod; requireFinalCoverage: boolean;
      diagnostics?: readonly string[] }>
  | Readonly<{ kind: 'unavailable'; reason: string; period?: LeaguePeriod;
      diagnostics?: readonly string[] }>;

type Selection = PeriodSelection & Readonly<{
  eligibleLeagueKeys: readonly string[];
  unavailableLeagueKeys: readonly string[];
  deferredLeagueKeys: readonly string[];
}>;

function selectCoherentPeriod(
  authorities: readonly StoredLeagueAuthorityRead[],
  job: AllPlayerJobState | null,
  now: Date,
  expectedLeagueKeys: readonly string[],
): PeriodSelection {
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
  if (season === null || !Number.isInteger(season) || season < 2026 || season > 2200
    || seasonType !== 'reg' || week === null || !Number.isInteger(week)
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
  const selected = (target: LeaguePeriod, requireFinalCoverage: boolean): PeriodSelection => ({
    kind: 'selected', period: target, requireFinalCoverage,
    ...(diagnostics.length ? { diagnostics } : {}),
  });
  const unavailable = (reason: string): PeriodSelection => ({
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
  const last = lastAllPlayerPeriod(job);
  const lastWasPrior = last?.season === season && last.week === prior.week;
  // Previous final capture gets the first opportunity at rollover. Alternation
  // then provides corrections without starving the current period.
  return lastWasPrior ? selected(period, false) : selected(prior, true);
}

export function selectAllPlayerRecurringPeriod(
  authorities: readonly StoredLeagueAuthorityRead[],
  job: AllPlayerJobState | null,
  now: Date,
  expectedLeagueKeys: readonly string[],
): Selection {
  const expected = new Set(expectedLeagueKeys);
  const keys = [...expected].sort();
  // An invalid inventory or a result outside the requested inventory cannot be
  // attributed safely to one league. Keep those shared-store failures closed.
  if (!Number.isFinite(now.getTime()) || expected.size === 0
    || expected.size !== expectedLeagueKeys.length
    || expectedLeagueKeys.some((key) => !key.trim() || key !== key.trim())
    || authorities.some((row) => !expected.has(row.leagueKey))) {
    return { kind: 'unavailable', reason: 'authority-missing',
      eligibleLeagueKeys: [], unavailableLeagueKeys: keys, deferredLeagueKeys: [] };
  }

  const byLeague = new Map<string, StoredLeagueAuthorityRead[]>();
  for (const row of authorities) {
    const rows = byLeague.get(row.leagueKey) ?? [];
    rows.push(row);
    byLeague.set(row.leagueKey, rows);
  }
  const unavailableLeagueKeys: string[] = [];
  const rejected: Extract<PeriodSelection, { kind: 'unavailable' }>[] = [];
  const candidates = new Map<string, {
    period: LeaguePeriod;
    requireFinalCoverage: boolean;
    leagueKeys: string[];
  }>();
  const diagnostics = new Set<string>();
  for (const leagueKey of keys) {
    // Resolve each authority independently. Duplicate, absent, malformed or stale
    // rows affect only their own league; a peer's finite correction policy holds.
    const selection = selectCoherentPeriod(byLeague.get(leagueKey) ?? [], job, now, [leagueKey]);
    for (const diagnostic of selection.diagnostics ?? []) diagnostics.add(diagnostic);
    if (selection.kind === 'unavailable') {
      unavailableLeagueKeys.push(leagueKey);
      rejected.push(selection);
      continue;
    }
    const key = `${selection.period.season}:${selection.period.week}`;
    const candidate = candidates.get(key);
    if (candidate) {
      candidate.leagueKeys.push(leagueKey);
      candidate.requireFinalCoverage &&= selection.requireFinalCoverage;
    } else {
      candidates.set(key, { period: selection.period,
        requireFinalCoverage: selection.requireFinalCoverage, leagueKeys: [leagueKey] });
    }
  }
  const diagnosticFields = diagnostics.size ? { diagnostics: [...diagnostics] } : {};
  if (!candidates.size) {
    return { ...(rejected[0] ?? { kind: 'unavailable' as const, reason: 'authority-missing' }),
      ...diagnosticFields, eligibleLeagueKeys: [], unavailableLeagueKeys, deferredLeagueKeys: [] };
  }

  const ordered = [...candidates.values()].sort((left, right) => (
    left.period.season - right.period.season || left.period.week - right.period.week
  ));
  const last = lastAllPlayerPeriod(job);
  // Rotate exact periods in stable order rather than favoring the first league.
  // The existing job outcome is the cursor, including failed provider attempts.
  const selected = (last && ordered.find(({ period }) => period.season > last.season
    || (period.season === last.season && period.week > last.week))) || ordered[0];
  const eligible = new Set(selected.leagueKeys);
  const unavailable = new Set(unavailableLeagueKeys);
  return { kind: 'selected', period: selected.period,
    requireFinalCoverage: selected.requireFinalCoverage, ...diagnosticFields,
    eligibleLeagueKeys: selected.leagueKeys, unavailableLeagueKeys,
    deferredLeagueKeys: keys.filter((key) => !eligible.has(key) && !unavailable.has(key)) };
}
