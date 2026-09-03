import type { LeaguePeriod } from '../domain/contracts';
import type { FutureRefreshFailureCode } from '../ports/future-refresh-repository';
import type { LiveProjectionWorkerDependencies } from './contracts';
import {
  FUTURE_WORK_DEADLINE_MS,
  FUTURE_WORK_START_DEADLINE_MS,
  futureRefreshIntervalMs,
  type FutureRefreshKind,
} from './future-work-policy';

export const FUTURE_ATTEMPT_LEASE_SECONDS = 55;

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

export function sameFuturePeriod(left: LeaguePeriod, right: LeaguePeriod): boolean {
  return left.season === right.season
    && left.seasonType === right.seasonType
    && left.week === right.week;
}

export function futureElapsedMs(
  dependencies: Pick<LiveProjectionWorkerDependencies, 'clock'>,
  timing: FutureWorkTiming,
): number {
  return Math.max(0, dependencies.clock.monotonicNow() - timing.monotonicStartedAt);
}

export function futureTimestamp(
  dependencies: Pick<LiveProjectionWorkerDependencies, 'clock'>,
  timing: FutureWorkTiming,
): string {
  return new Date(timing.wallStartedAtMs + futureElapsedMs(dependencies, timing)).toISOString();
}

export function futureMayStart(
  dependencies: Pick<LiveProjectionWorkerDependencies, 'clock'>,
  timing: FutureWorkTiming,
): boolean {
  return futureElapsedMs(dependencies, timing) < FUTURE_WORK_START_DEADLINE_MS;
}

export function assertFutureMayStart(
  dependencies: Pick<LiveProjectionWorkerDependencies, 'clock'>,
  timing: FutureWorkTiming,
): void {
  if (!futureMayStart(dependencies, timing)) {
    throw new FutureWorkError('deadline-exceeded');
  }
}

export function assertFutureWithinDeadline(
  dependencies: Pick<LiveProjectionWorkerDependencies, 'clock'>,
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
): string {
  const timestamp = Date.parse(completedAt);
  if (!Number.isFinite(timestamp)) throw new FutureWorkError('unexpected');
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
