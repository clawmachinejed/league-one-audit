import type { LineupWatchPeriodClass } from '../domain/period-classification';
import { LEGACY_LINEUP_CADENCE_POLICY_VERSION, parseLineupCadencePolicy } from '../shared/lineup-cadence';
export { LINEUP_CADENCE_POLICY_VERSION } from '../shared/lineup-cadence';

export const CURRENT_LINEUP_INTERVAL_MS = 60_000;
export const FUTURE_LINEUP_INTERVAL_MS = 180_000;
export const FUTURE_LINEUP_CATCHUP_LIMIT = 18;
export const LINEUP_MATCHUP_REQUEST_LIMIT = 20;
export type LineupWatchPhase = 0 | 1 | 2;

export type LineupPhaseTarget = Readonly<{
  /** Complete logical target key, including league and period, never an unexplained provider ID. */
  targetKey: string;
  stableHash: string;
}>;
export type LineupPhaseAssignment = LineupPhaseTarget & Readonly<{ phase: LineupWatchPhase }>;

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

/** Persist these results on target-set changes; collisions cannot imbalance the buckets. */
export function allocateLineupWatchPhases(targets: readonly LineupPhaseTarget[]): LineupPhaseAssignment[] {
  const keys = new Set<string>();
  for (const target of targets) {
    if (!target.targetKey.trim() || !target.stableHash.trim() || keys.has(target.targetKey)) {
      throw new Error('Lineup phase targets must have unique nonblank logical keys and hashes.');
    }
    keys.add(target.targetKey);
  }
  return [...targets].sort((left, right) => compareText(left.stableHash, right.stableHash)
    || compareText(left.targetKey, right.targetKey))
    .map((target, index) => ({ ...target, phase: (index % 3) as LineupWatchPhase }));
}

function epochMinute(now: Date): number {
  const timestamp = now.getTime();
  if (!Number.isFinite(timestamp)) throw new Error('Lineup schedule time is invalid.');
  return Math.floor(timestamp / CURRENT_LINEUP_INTERVAL_MS);
}

function checkedPhase(phase: number): LineupWatchPhase {
  if (!Number.isInteger(phase) || phase < 0 || phase > 2) throw new Error('Lineup phase is invalid.');
  return phase as LineupWatchPhase;
}

/** Schedules absolute buckets, never completion + interval (which can skip a phase). */
export function nextLineupCheckAt(
  watchClass: LineupWatchPeriodClass,
  phase: LineupWatchPhase,
  completedAt: Date,
  cadencePolicyVersion = LEGACY_LINEUP_CADENCE_POLICY_VERSION as string,
): string | null {
  if (watchClass === 'completed') return null;
  const { minutes, offset } = parseLineupCadencePolicy(cadencePolicyVersion, watchClass, checkedPhase(phase));
  let nextMinute = epochMinute(completedAt) + 1;
  nextMinute += (offset - (nextMinute % minutes + minutes) % minutes + minutes) % minutes;
  return new Date(nextMinute * CURRENT_LINEUP_INTERVAL_MS).toISOString();
}

export function initialLineupCheckAt(
  watchClass: LineupWatchPeriodClass,
  phase: LineupWatchPhase,
  synchronizedAt: Date,
  cadencePolicyVersion = LEGACY_LINEUP_CADENCE_POLICY_VERSION as string,
): string | null {
  if (watchClass === 'completed') return null;
  const { minutes, offset } = parseLineupCadencePolicy(cadencePolicyVersion, watchClass, checkedPhase(phase));
  const minute = epochMinute(synchronizedAt);
  const wait = (offset - (minute % minutes + minutes) % minutes + minutes) % minutes;
  return new Date((minute + wait) * CURRENT_LINEUP_INTERVAL_MS).toISOString();
}

/** PostgreSQL indexes this retry schedule; claims separately exclude completed targets. */
export function lineupFailureRetryDelaysSeconds(
  watchClass: LineupWatchPeriodClass,
): readonly [number, number, number, number] {
  const firstDelay = watchClass === 'current' ? CURRENT_LINEUP_INTERVAL_MS : FUTURE_LINEUP_INTERVAL_MS;
  return [firstDelay / 1000, 300, 900, 3600];
}

export type LineupWatchCapacity = Readonly<{
  status: 'supported' | 'capacity-exceeded';
  currentTargets: number;
  observerCurrentTargets: number;
  futureTargets: number;
  maximumFuturePhase: number;
  requiredMatchupRequestsPerMinute: number;
  maximumFutureChecks: number;
  maximumCurrentChecks: number;
  maximumTotalChecks: number;
}>;

export function assessLineupWatchCapacity(
  currentTargets: number,
  futureTargets: number,
  futureSchedules?: readonly Readonly<{ cadencePolicyVersion: string; phase: LineupWatchPhase }>[],
  observerCurrentTargets = 0,
): LineupWatchCapacity {
  if (![currentTargets, futureTargets, observerCurrentTargets].every((value) => Number.isSafeInteger(value) && value >= 0)
    || observerCurrentTargets > currentTargets) {
    throw new Error('Lineup target counts must be nonnegative whole numbers.');
  }
  if (futureSchedules && futureSchedules.length !== futureTargets) throw new Error('Lineup schedule count mismatch.');
  const buckets = new Array<number>(360).fill(0);
  for (const schedule of futureSchedules ?? []) {
    const { minutes, offset } = parseLineupCadencePolicy(schedule.cadencePolicyVersion, 'future', schedule.phase);
    for (let minute = offset; minute < 360; minute += minutes) buckets[minute] += 1;
  }
  const maximumFuturePhase = futureSchedules ? Math.max(...buckets) : Math.ceil(futureTargets / 3);
  const demand = currentTargets + maximumFuturePhase;
  // Share one allowance across both lanes: protect a preseason default and future work.
  // Missing-authority current rows remain conservatively assigned to the active lane.
  const totalCurrentAllowance = Math.min(currentTargets, LINEUP_MATCHUP_REQUEST_LIMIT - (futureTargets > 0 ? 1 : 0));
  const maximumCurrentChecks = Math.min(currentTargets - observerCurrentTargets,
    totalCurrentAllowance - (observerCurrentTargets > 0 ? 1 : 0));
  return {
    status: demand <= LINEUP_MATCHUP_REQUEST_LIMIT && maximumFuturePhase <= FUTURE_LINEUP_CATCHUP_LIMIT
      ? 'supported' : 'capacity-exceeded',
    currentTargets,
    observerCurrentTargets,
    futureTargets,
    maximumFuturePhase,
    requiredMatchupRequestsPerMinute: demand,
    maximumFutureChecks: Math.min(FUTURE_LINEUP_CATCHUP_LIMIT, LINEUP_MATCHUP_REQUEST_LIMIT - totalCurrentAllowance),
    maximumCurrentChecks,
    maximumTotalChecks: LINEUP_MATCHUP_REQUEST_LIMIT,
  };
}
