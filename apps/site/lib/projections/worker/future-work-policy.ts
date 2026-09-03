import type { Cadence, LeaguePeriod } from '../domain/contracts';
import type { PeriodCadenceTiming } from '../domain/period-cadence-timing';
import type { FutureMaterializationRefreshState, FutureRefreshPlanPeriod } from '../ports/future-refresh-repository';
import type { LineupWatchState } from '../ports/lineup-watch-repository';
import { periodTimingCadence } from './cadence';

export const FUTURE_WORK_START_DEADLINE_MS = 45_000;
export const FUTURE_WORK_DEADLINE_MS = 50_000;
const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;
export type FutureRefreshKind = 'projection' | 'materialization';

export type FuturePolicyLeague = Readonly<{
  watch: LineupWatchState;
  weekDistance: number;
  defaultPeriodCadence: PeriodCadenceTiming | null;
  canaryComplete: boolean;
}>;
export type FutureRefreshPlan = Readonly<{
  state: FutureRefreshPlanPeriod;
  leagues: readonly FuturePolicyLeague[];
}>;
export type FutureWorkSelection = Readonly<{
  kind: 'projection-ingest' | 'materialize';
  period: LeaguePeriod;
  weekDistance: number;
  leagueKeys: readonly string[];
  leagueRefresh: readonly Readonly<{ leagueKey: string; weekDistance: number; defaultPeriod: boolean; cadence: Cadence }>[];
  dirty: boolean;
  defaultPeriod: boolean;
  cadence: Cadence;
}>;

/** Defaults use the former current-worker cadence without shifting future-week tiers. */
export function futureRefreshIntervalMs(kind: FutureRefreshKind, weekDistance: number): number {
  if (!Number.isInteger(weekDistance) || weekDistance < 1) throw new Error('Future-week distance must be a positive whole number.');
  if (weekDistance === 1) return kind === 'materialization' ? HOUR_MS : 6 * HOUR_MS;
  return weekDistance <= 4 ? DAY_MS : 7 * DAY_MS;
}
export function futureRetryDelayMs(consecutiveFailures: number): number {
  if (!Number.isInteger(consecutiveFailures) || consecutiveFailures < 1) throw new Error('Failure count must be a positive whole number.');
  return [5 * MINUTE_MS, 15 * MINUTE_MS, HOUR_MS, 6 * HOUR_MS][Math.min(3, consecutiveFailures - 1)];
}
function leased(expiry: string | null, now: number): boolean {
  return expiry !== null && (!Number.isFinite(Date.parse(expiry)) || Date.parse(expiry) > now);
}
export function hasPendingLineup(watch: LineupWatchState): boolean {
  return watch.latestLineupRevision !== null && watch.latestLineupRevision !== watch.lastMaterializedLineupRevision;
}
/** A previously rejected slate stays ineligible until a newer ingestion succeeds. */
export function eligibleStoredSlate(plan: FutureRefreshPlanPeriod): boolean {
  if (plan.projection.currentSlate === null) return false;
  return !plan.materializations.some((state) => (
    ['projection-slate-unavailable', 'projection-slate-incomplete', 'projection-slate-invalid'].includes(state.lastFailureCode ?? '')
    && state.lastAttemptedAt !== null
    && (plan.projection.lastSucceededAt === null || Date.parse(state.lastAttemptedAt) >= Date.parse(plan.projection.lastSucceededAt))
  ));
}
function materializationReady(state: FutureMaterializationRefreshState, now: number): boolean {
  return state.due && !leased(state.activeAttemptExpiresAt, now);
}
function selectPlan(plan: FutureRefreshPlan, now: Date, dirtyOnly: boolean): FutureWorkSelection | null {
  const nowMs = now.getTime();
  const states = new Map(plan.state.materializations.map((state) => [state.leagueKey, state]));
  const eligible = plan.leagues.filter((league) => {
    const state = states.get(league.watch.configuration.key);
    if (!state || league.watch.retiredAt !== null || league.watch.materializationLane !== 'future') return false;
    if (dirtyOnly) return hasPendingLineup(league.watch);
    if (league.defaultPeriodCadence !== null) return periodTimingCadence(league.defaultPeriodCadence, now) !== 'idle';
    return league.weekDistance === 1 || league.canaryComplete;
  });
  if (eligible.length === 0) return null;
  const usable = eligibleStoredSlate(plan.state);
  const ready = eligible.filter((league) => materializationReady(states.get(league.watch.configuration.key)!, nowMs)
    && !(league.watch.consecutiveFailures > 0 && league.watch.nextCheckAt !== null
      && Date.parse(league.watch.nextCheckAt) > nowMs));
  const projectionReady = plan.state.projection.due && !leased(plan.state.projection.activeAttemptExpiresAt, nowMs);
  // Dirty lineups consume an already stored valid slate before routine provider work.
  const kind = dirtyOnly
    ? usable ? ready.length > 0 ? 'materialize' : null : projectionReady ? 'projection-ingest' : null
    : projectionReady ? 'projection-ingest' : usable && ready.length > 0 ? 'materialize' : null;
  if (kind === null) return null;
  const selected = kind === 'materialize' ? ready : eligible;
  const defaultLeague = plan.leagues.find((league) => league.defaultPeriodCadence !== null);
  const defaultCadence = defaultLeague?.defaultPeriodCadence
    ? periodTimingCadence(defaultLeague.defaultPeriodCadence, now) : null;
  return {
    kind, period: plan.state.period,
    weekDistance: plan.state.weekDistance,
    leagueKeys: selected.map((league) => league.watch.configuration.key),
    leagueRefresh: selected.map((league) => ({
      leagueKey: league.watch.configuration.key, weekDistance: league.weekDistance,
      defaultPeriod: league.defaultPeriodCadence !== null,
      cadence: league.defaultPeriodCadence ? periodTimingCadence(league.defaultPeriodCadence, now) : 'hourly',
    })),
    dirty: dirtyOnly,
    defaultPeriod: defaultLeague !== undefined,
    cadence: defaultCadence && defaultCadence !== 'idle' ? defaultCadence : 'hourly',
  };
}
/** One independently selected period action. Backed-off dirty groups never block later work. */
export function selectFutureWork(plans: readonly FutureRefreshPlan[], now: Date): FutureWorkSelection | null {
  if (!Number.isFinite(now.getTime())) return null;
  const ordered = [...plans].sort((left, right) => left.state.period.season - right.state.period.season
    || left.state.period.week - right.state.period.week);
  const dirty = ordered.flatMap((plan) => {
    const selection = selectPlan(plan, now, true);
    if (!selection) return [];
    const selected = plan.leagues.filter((league) => selection.leagueKeys.includes(league.watch.configuration.key));
    const oldest = Math.min(...selected.map((league) => Date.parse(league.watch.pendingSince
      ?? league.watch.lastCompleteObservationAt ?? now.toISOString())));
    return [{ selection, oldest }];
  }).sort((left, right) => Number(left.selection.kind === 'projection-ingest') - Number(right.selection.kind === 'projection-ingest')
    || left.oldest - right.oldest
    || left.selection.period.season - right.selection.period.season
    || left.selection.period.seasonType.localeCompare(right.selection.period.seasonType)
    || left.selection.period.week - right.selection.period.week
    || [...left.selection.leagueKeys].sort()[0].localeCompare([...right.selection.leagueKeys].sort()[0]));
  if (dirty[0]) return dirty[0].selection;
  for (const plan of ordered) {
    const selection = selectPlan(plan, now, false);
    if (selection) return selection;
  }
  return null;
}
export function futureWorkMayStart(startedAtMs: number, nowMs: number): boolean {
  return Number.isFinite(startedAtMs) && Number.isFinite(nowMs) && nowMs - startedAtMs < FUTURE_WORK_START_DEADLINE_MS;
}
