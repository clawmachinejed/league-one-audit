import type {
  LeaguePeriod,
  LeaguePeriodAuthority,
} from '../domain/contracts';

export const FINAL_REGULAR_SEASON_WEEK = 18;
export const FUTURE_WORK_START_DEADLINE_MS = 45_000;
export const FUTURE_WORK_DEADLINE_MS = 50_000;

const MINUTE_MS = 60 * 1_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

export type FutureRefreshKind = 'projection' | 'materialization';

export type FutureMaterializationState = Readonly<{
  leagueKey: string;
  nextRefreshAt: string;
  lastSucceededAt: string | null;
  lastProjectionSlateContentId: string | null;
  consecutiveFailures: number;
}>;

export type FutureRefreshPlan = Readonly<{
  period: LeaguePeriod;
  projectionNextRefreshAt: string;
  projectionLastSucceededAt: string | null;
  projectionConsecutiveFailures: number;
  currentProjectionSlateContentId: string | null;
  materializations: readonly FutureMaterializationState[];
}>;

export type FutureWorkSelection = Readonly<{
  kind: 'projection-ingest' | 'materialize';
  period: LeaguePeriod;
  weekDistance: number;
}>;

function samePeriod(left: LeaguePeriod | null, right: LeaguePeriod | null): boolean {
  if (left === null || right === null) return left === right;
  return left.season === right.season
    && left.seasonType === right.seasonType
    && left.week === right.week;
}

function sameAuthorityPeriod(
  left: LeaguePeriodAuthority,
  right: LeaguePeriodAuthority,
): boolean {
  return samePeriod(left.defaultDisplayPeriod, right.defaultDisplayPeriod)
    && samePeriod(left.activeScoringPeriod, right.activeScoringPeriod)
    && left.lifecycle === right.lifecycle
    && left.nflPhase === right.nflPhase;
}

/**
 * Returns the regular-season periods that are genuinely future for every
 * configured league. A disagreement between league authorities fails closed.
 */
export function futurePeriodsForAuthorities(
  authorities: readonly LeaguePeriodAuthority[],
  expectedLeagueKeys: readonly string[],
): LeaguePeriod[] | null {
  const expected = [...new Set(expectedLeagueKeys)].sort();
  const received = [...new Set(authorities.map((authority) => authority.configuration.key))].sort();
  if (expected.length === 0 || authorities.length !== expected.length
    || received.length !== expected.length
    || expected.some((key, index) => key !== received[index])) return null;

  const first = authorities[0];
  if (!first || authorities.slice(1).some((authority) => !sameAuthorityPeriod(first, authority))) {
    return null;
  }
  if (first.lifecycle === 'complete') return [];
  const anchor = first.activeScoringPeriod ?? first.defaultDisplayPeriod;
  if (anchor.seasonType !== 'regular' || first.defaultDisplayPeriod.seasonType !== 'regular') {
    return [];
  }
  const firstFutureWeek = first.lifecycle === 'preseason'
    ? first.defaultDisplayPeriod.week
    : anchor.week + 1;
  const periods: LeaguePeriod[] = [];
  for (let week = firstFutureWeek; week <= FINAL_REGULAR_SEASON_WEEK; week += 1) {
    periods.push({ season: anchor.season, seasonType: 'regular', week });
  }
  return periods;
}

export function futureWeekDistance(
  period: LeaguePeriod,
  futurePeriods: readonly LeaguePeriod[],
): number {
  const index = futurePeriods.findIndex((candidate) => samePeriod(candidate, period));
  if (index < 0) throw new Error('Future refresh period is outside the authoritative horizon.');
  return index + 1;
}

export function futureRefreshIntervalMs(
  kind: FutureRefreshKind,
  weekDistance: number,
): number {
  if (!Number.isInteger(weekDistance) || weekDistance < 1) {
    throw new Error('Future-week distance must be a positive whole number.');
  }
  if (weekDistance === 1) return kind === 'materialization' ? HOUR_MS : 6 * HOUR_MS;
  if (weekDistance <= 4) return DAY_MS;
  return 7 * DAY_MS;
}

export function futureRetryDelayMs(consecutiveFailures: number): number {
  if (!Number.isInteger(consecutiveFailures) || consecutiveFailures < 1) {
    throw new Error('Failure count must be a positive whole number.');
  }
  if (consecutiveFailures === 1) return 5 * MINUTE_MS;
  if (consecutiveFailures === 2) return 15 * MINUTE_MS;
  if (consecutiveFailures === 3) return HOUR_MS;
  return 6 * HOUR_MS;
}

export function initialFutureRefreshAt(
  seededAt: Date,
  weekDistance: number,
): string {
  const seededAtMs = seededAt.getTime();
  if (!Number.isFinite(seededAtMs) || !Number.isInteger(weekDistance) || weekDistance < 1) {
    throw new Error('Future refresh seed input is invalid.');
  }
  // Week + 1 is the canary. Later periods are staggered to avoid a provider burst.
  return new Date(seededAtMs + Math.max(0, weekDistance - 1) * 15 * MINUTE_MS).toISOString();
}

function parsedTime(value: string): number | null {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function allExpectedMaterializations(
  plan: FutureRefreshPlan,
  expectedLeagueKeys: readonly string[],
): boolean {
  const expected = [...new Set(expectedLeagueKeys)].sort();
  const actual = [...new Set(plan.materializations.map((state) => state.leagueKey))].sort();
  return plan.materializations.length === expected.length
    && actual.length === expected.length
    && expected.every((key, index) => key === actual[index]);
}

function projectionDue(plan: FutureRefreshPlan, nowMs: number): boolean {
  const next = parsedTime(plan.projectionNextRefreshAt);
  return plan.currentProjectionSlateContentId === null || next === null || next <= nowMs;
}

function materializationDue(plan: FutureRefreshPlan, nowMs: number): boolean {
  if (plan.currentProjectionSlateContentId === null) return false;
  return plan.materializations.some((state) => {
    const next = parsedTime(state.nextRefreshAt);
    return state.lastProjectionSlateContentId !== plan.currentProjectionSlateContentId
      || next === null || next <= nowMs;
  });
}

/**
 * Selects one future action. Week + 1 remains a canary until every active
 * league has published it at least once. Projection ingestion always precedes
 * materialization when both are due for the selected period.
 */
export function selectFutureWork(
  plans: readonly FutureRefreshPlan[],
  authoritativeFuturePeriods: readonly LeaguePeriod[],
  expectedLeagueKeys: readonly string[],
  now: Date,
): FutureWorkSelection | null {
  const nowMs = now.getTime();
  if (!Number.isFinite(nowMs) || authoritativeFuturePeriods.length === 0) return null;
  const ordered = authoritativeFuturePeriods.map((period) => (
    plans.find((candidate) => samePeriod(candidate.period, period)) ?? null
  ));
  if (ordered.some((plan) => plan === null)) return null;
  const completePlans = ordered as FutureRefreshPlan[];
  if (completePlans.some((plan) => !allExpectedMaterializations(plan, expectedLeagueKeys))) {
    return null;
  }

  const canary = completePlans[0];
  const canaryComplete = canary.materializations.every((state) => state.lastSucceededAt !== null);
  const eligible = canaryComplete ? completePlans : [canary];
  for (const plan of eligible) {
    const weekDistance = futureWeekDistance(plan.period, authoritativeFuturePeriods);
    if (projectionDue(plan, nowMs)) {
      return { kind: 'projection-ingest', period: plan.period, weekDistance };
    }
    if (materializationDue(plan, nowMs)) {
      return { kind: 'materialize', period: plan.period, weekDistance };
    }
  }
  return null;
}

export function futureWorkMayStart(startedAtMs: number, nowMs: number): boolean {
  return Number.isFinite(startedAtMs) && Number.isFinite(nowMs)
    && nowMs - startedAtMs < FUTURE_WORK_START_DEADLINE_MS;
}
