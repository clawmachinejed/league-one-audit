import type { LeaguePeriod } from '../domain/contracts';
import type { FutureRefreshFailureCode } from '../ports/future-refresh-repository';
import type { ProjectionLogContext } from './contracts';
import type { FutureProjectionWorkerDependencies } from './future-contracts';
import {
  FUTURE_WORK_DEADLINE_MS,
  futureWorkMayStart,
  futureRefreshIntervalMs,
  type FutureRefreshKind,
  type FutureWorkSelection,
} from './future-work-policy';

export const FUTURE_ATTEMPT_LEASE_SECONDS = 55;
export const FUTURE_DEADLINE_CLEANUP_MS = 4_000;

export type FutureWorkTiming = Readonly<{
  wallStartedAtMs: number;
  monotonicStartedAt: number;
}>;

export class FutureWorkError extends Error {
  constructor(readonly failureCode: FutureRefreshFailureCode) {
    super(failureCode);
    this.name = 'FutureWorkError';
  }
}

export function futureProviderGroup(period: LeaguePeriod): string {
  return `${period.season}:${period.seasonType}:${period.week}`;
}

export function logFuture(
  dependencies: Pick<FutureProjectionWorkerDependencies, 'logger'>,
  level: 'info' | 'warn' | 'error',
  context: ProjectionLogContext,
): void {
  try {
    dependencies.logger.write(level, context);
  } catch {
    // Operational logging must never change projection behavior.
  }
}

export type FutureWorkDeadline = Readonly<{
  signal: AbortSignal;
  run: <Value>(operation: Promise<Value>) => Promise<Value>;
  dispose: () => void;
}>;

/**
 * Enforces the whole future-work budget. Aborting the signal cancels every
 * scoped persistence query; racing the operation also bounds providers that do not
 * expose cancellation through their cached interface.
 */
export function createFutureWorkDeadline(
  dependencies: Pick<FutureProjectionWorkerDependencies, 'clock'>,
  timing: FutureWorkTiming,
): FutureWorkDeadline {
  const controller = new AbortController();
  const remainingMs = Math.max(0, FUTURE_WORK_DEADLINE_MS - futureElapsedMs(
    dependencies,
    timing,
  ));
  let rejectDeadline: ((reason: FutureWorkError) => void) | null = null;
  const deadline = new Promise<never>((_resolve, reject) => {
    rejectDeadline = reject;
  });
  const expire = () => {
    if (controller.signal.aborted) return;
    controller.abort(new FutureWorkError('deadline-exceeded'));
    rejectDeadline?.(new FutureWorkError('deadline-exceeded'));
  };
  const timer = setTimeout(expire, remainingMs);
  timer.unref?.();
  return {
    signal: controller.signal,
    run: <Value>(operation: Promise<Value>) => Promise.race([operation, deadline]),
    dispose: () => clearTimeout(timer),
  };
}

export function sameFuturePeriod(left: LeaguePeriod, right: LeaguePeriod): boolean {
  return left.season === right.season
    && left.seasonType === right.seasonType
    && left.week === right.week;
}

export function futureElapsedMs(
  dependencies: Pick<FutureProjectionWorkerDependencies, 'clock'>,
  timing: FutureWorkTiming,
): number {
  return Math.max(0, dependencies.clock.monotonicNow() - timing.monotonicStartedAt);
}

export function futureTimestamp(
  dependencies: Pick<FutureProjectionWorkerDependencies, 'clock'>,
  timing: FutureWorkTiming,
): string {
  return new Date(timing.wallStartedAtMs + futureElapsedMs(dependencies, timing)).toISOString();
}

export function futureMayStart(
  dependencies: Pick<FutureProjectionWorkerDependencies, 'clock'>,
  timing: FutureWorkTiming,
): boolean {
  return futureWorkMayStart(timing.monotonicStartedAt, dependencies.clock.monotonicNow());
}

export function assertFutureMayStart(
  dependencies: Pick<FutureProjectionWorkerDependencies, 'clock'>,
  timing: FutureWorkTiming,
): void {
  if (!futureMayStart(dependencies, timing)) {
    throw new FutureWorkError('deadline-exceeded');
  }
}

export function assertFutureWithinDeadline(
  dependencies: Pick<FutureProjectionWorkerDependencies, 'clock'>,
  timing: FutureWorkTiming,
): void {
  if (futureElapsedMs(dependencies, timing) >= FUTURE_WORK_DEADLINE_MS) {
    throw new FutureWorkError('deadline-exceeded');
  }
}

export function nextFutureRefreshAt(
  completedAt: string,
  kind: FutureRefreshKind,
  weekDistance: number,
  selection?: Pick<FutureWorkSelection, 'defaultPeriod' | 'cadence'>,
): string {
  const timestamp = Date.parse(completedAt);
  if (!Number.isFinite(timestamp)) throw new FutureWorkError('unexpected');
  if (selection?.defaultPeriod) {
    const bucket = kind === 'materialization' && selection.cadence === 'live-window' ? 60_000 : 3_600_000;
    return new Date((Math.floor(timestamp / bucket) + 1) * bucket).toISOString();
  }
  return new Date(timestamp + futureRefreshIntervalMs(kind, weekDistance)).toISOString();
}

export function futureFailureCode(error: unknown): FutureRefreshFailureCode {
  return error instanceof FutureWorkError ? error.failureCode : 'unexpected';
}

export async function mapFutureWithConcurrency<Input, Output>(
  values: readonly Input[],
  concurrency: number,
  transform: (value: Input) => Promise<Output>,
): Promise<Output[]> {
  const results = new Array<Output>(values.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(concurrency, values.length) }, async () => {
    while (cursor < values.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await transform(values[index]);
    }
  });
  await Promise.all(workers);
  return results;
}
