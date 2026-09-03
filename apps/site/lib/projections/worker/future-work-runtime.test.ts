import { describe, expect, it, vi } from 'vitest';

import type { LiveProjectionWorkerDependencies } from './contracts';
import {
  FUTURE_WORK_DEADLINE_MS,
} from './future-work-policy';
import {
  createFutureWorkDeadline,
} from './future-work-runtime';

describe('future work runtime deadline', () => {
  it('uses elapsed monotonic time and cannot be extended by a wall-clock adjustment', async () => {
    vi.useFakeTimers();
    try {
      let wallNow = new Date('2026-09-03T12:00:00.000Z');
      const dependencies = {
        clock: {
          now: () => wallNow,
          monotonicNow: () => 1_000,
        },
      } satisfies Pick<LiveProjectionWorkerDependencies, 'clock'>;
      const deadline = createFutureWorkDeadline(dependencies, {
        wallStartedAtMs: wallNow.getTime(),
        monotonicStartedAt: 1_000,
      });
      const pending = deadline.run(new Promise<never>(() => undefined));
      const rejected = expect(pending).rejects.toMatchObject({
        name: 'FutureWorkError',
        failureCode: 'deadline-exceeded',
      });

      wallNow = new Date('2020-01-01T00:00:00.000Z');
      await vi.advanceTimersByTimeAsync(FUTURE_WORK_DEADLINE_MS - 1);
      expect(deadline.signal.aborted).toBe(false);
      await vi.advanceTimersByTimeAsync(1);

      await rejected;
      expect(deadline.signal.aborted).toBe(true);
      deadline.dispose();
    } finally {
      vi.useRealTimers();
    }
  });
});
