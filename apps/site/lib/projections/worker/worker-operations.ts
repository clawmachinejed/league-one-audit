import type { ClockPort } from '../ports/clock';
import type { ProjectionLogEntry, ProjectionLoggerPort } from '../ports/logger';

export function safeProjectionLog(
  dependencies: Readonly<{ logger: ProjectionLoggerPort }>,
  level: 'info' | 'warn' | 'error', context: ProjectionLogEntry,
): void {
  try { dependencies.logger.write(level, context); } catch { /* Logging cannot change worker behavior. */ }
}

export function elapsed(dependencies: Readonly<{ clock: ClockPort }>, startedAt: number): number {
  return Math.max(0, dependencies.clock.monotonicNow() - startedAt);
}

/** A fixed worker pool; fleet size never creates an unbounded promise list. */
export async function mapWithConcurrency<Input, Output>(
  values: readonly Input[], concurrency: number, transform: (value: Input) => Promise<Output>,
): Promise<Output[]> {
  if (!Number.isSafeInteger(concurrency) || concurrency < 1) throw new Error('Invalid worker concurrency.');
  const results = new Array<Output>(values.length);
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, values.length) }, async () => {
    while (cursor < values.length) {
      const index = cursor++;
      results[index] = await transform(values[index]);
    }
  }));
  return results;
}
