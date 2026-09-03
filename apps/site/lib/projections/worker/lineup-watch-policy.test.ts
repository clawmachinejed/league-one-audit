import { createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { describe, expect, it } from 'vitest';
import {
  allocateLineupWatchPhases, assessLineupWatchCapacity, initialLineupCheckAt,
  lineupFailureRetryDelayMs, lineupObservationIntervalMs, lineupPhaseAt,
  nextLineupCheckAt, selectDueLineupTargets,
  type DueLineupTarget, type LineupPhaseTarget,
} from './lineup-watch-policy';

function targets(count: number): LineupPhaseTarget[] {
  return Array.from({ length: count }, (_, index) => {
    const targetKey = `league-${Math.floor(index / 17)}:2026:regular:${index % 17 + 2}`;
    return { targetKey, stableHash: createHash('sha256').update(targetKey).digest('hex') };
  });
}

const minute = new Date('2026-09-03T12:00:00Z');
function dueTarget(key: string, overrides: Partial<DueLineupTarget> = {}): DueLineupTarget {
  return { targetKey: key, watchClass: 'future', phase: lineupPhaseAt(minute), nextCheckAt: minute.toISOString(), leaseExpiresAt: null, ...overrides };
}

describe('balanced three-minute phase planning', () => {
  it('allocates 34 future periods into deterministic 12/11/11 buckets regardless of input order', () => {
    const input = targets(34);
    const assignments = allocateLineupWatchPhases(input);
    expect([0, 1, 2].map((phase) => assignments.filter((item) => item.phase === phase).length)).toEqual([12, 11, 11]);
    expect(allocateLineupWatchPhases([...input].reverse())).toEqual(assignments);
    expect(allocateLineupWatchPhases(input)).toEqual(assignments);
  });
  it('balances even when all stable hashes collide, using the logical key to break ties', () => {
    const input = targets(34).map((target) => ({ ...target, stableHash: 'collision' }));
    const assignments = allocateLineupWatchPhases(input);
    expect([0, 1, 2].map((phase) => assignments.filter((item) => item.phase === phase).length)).toEqual([12, 11, 11]);
    expect(allocateLineupWatchPhases([...input].reverse())).toEqual(assignments);
  });
  it('rejects duplicate target keys rather than scheduling the same period twice', () => {
    const input = targets(1);
    expect(() => allocateLineupWatchPhases([input[0], input[0]])).toThrow('unique nonblank');
  });
  it('keeps target-set replacement deterministic and does not retain removed periods', () => {
    const input = targets(34).slice(1);
    input.push({ targetKey: 'replacement:2027:regular:2', stableHash: 'new-provider-hash' });
    const assignments = allocateLineupWatchPhases(input);
    expect(allocateLineupWatchPhases([...input].reverse())).toEqual(assignments);
    expect(assignments.some((value) => value.targetKey === targets(1)[0].targetKey)).toBe(false);
  });
});

describe('absolute healthy cadence', () => {
  it('does not turn a three-minute cadence into six minutes after a delayed response', () => {
    const phase = lineupPhaseAt(minute);
    expect(nextLineupCheckAt('future', phase, new Date('2026-09-03T12:00:45.999Z'))).toBe('2026-09-03T12:03:00.000Z');
    expect(nextLineupCheckAt('future', phase, new Date('2026-09-03T12:03:55Z'))).toBe('2026-09-03T12:06:00.000Z');
  });
  it('aligns current checks with the next minute rather than adding response latency', () => {
    expect(nextLineupCheckAt('current', 0, new Date('2026-09-03T12:00:59.999Z'))).toBe('2026-09-03T12:01:00.000Z');
    expect(nextLineupCheckAt('current', 0, new Date('2026-09-03T12:00:00.000Z'))).toBe('2026-09-03T12:01:00.000Z');
  });
  it('handles hour and day transitions without phase drift', () => {
    const phase = lineupPhaseAt(new Date('2026-09-03T23:57:00Z'));
    expect(nextLineupCheckAt('future', phase, new Date('2026-09-03T23:57:30Z'))).toBe('2026-09-04T00:00:00.000Z');
  });
  it('seeds the active phase immediately and future phases at their next absolute bucket', () => {
    const currentPhase = lineupPhaseAt(minute);
    expect(initialLineupCheckAt('future', currentPhase, new Date('2026-09-03T12:00:30Z'))).toBe(minute.toISOString());
    expect(initialLineupCheckAt('current', 0, new Date('2026-09-03T12:00:30Z'))).toBe(minute.toISOString());
    expect(initialLineupCheckAt('future', ((currentPhase + 1) % 3) as 0 | 1 | 2, minute)).toBe('2026-09-03T12:01:00.000Z');
  });
  it('never schedules a completed period', () => {
    expect(lineupObservationIntervalMs('completed')).toBeNull();
    expect(nextLineupCheckAt('completed', 0, minute)).toBeNull();
    expect(initialLineupCheckAt('completed', 0, minute)).toBeNull();
  });
  it('checks every future target exactly once across three healthy minute buckets', () => {
    const input = allocateLineupWatchPhases(targets(34)).map((target) => dueTarget(target.targetKey, {
      phase: target.phase,
      nextCheckAt: initialLineupCheckAt('future', target.phase, minute),
    }));
    const seen: string[] = [];
    for (let offset = 0; offset < 3; offset += 1) {
      const now = new Date(minute.getTime() + offset * 60_000 + 45_000);
      const batch = selectDueLineupTargets(input, now, { currentRequestReservations: 2 });
      expect(batch.length).toBeGreaterThanOrEqual(11);
      expect(batch.length).toBeLessThanOrEqual(12);
      seen.push(...batch.map((target) => target.targetKey));
    }
    expect(seen).toHaveLength(34);
    expect(new Set(seen).size).toBe(34);
  });
  it('rejects invalid scheduling input', () => {
    expect(() => nextLineupCheckAt('future', 3 as 0, minute)).toThrow('phase');
    expect(() => nextLineupCheckAt('current', 0, new Date('invalid'))).toThrow('time');
  });
});

describe('watcher failure and bounded planning', () => {
  it('uses normal cadence for the first failure, then bounded failure backoff', () => {
    expect([1, 2, 3, 4, 100].map((count) => lineupFailureRetryDelayMs('future', count))).toEqual([180_000, 300_000, 900_000, 3_600_000, 3_600_000]);
    expect(lineupFailureRetryDelayMs('current', 1)).toBe(60_000);
    expect(() => lineupFailureRetryDelayMs('current', 0)).toThrow('positive integer');
  });
  it('ignores completed, not-yet-due, invalid-time, and actively leased targets', () => {
    const input = [
      dueTarget('completed', { watchClass: 'completed' }),
      dueTarget('future-time', { nextCheckAt: '2026-09-03T12:03:00Z' }),
      dueTarget('invalid-time', { nextCheckAt: 'invalid' }),
      dueTarget('leased', { leaseExpiresAt: '2026-09-03T12:01:00Z' }),
      dueTarget('healthy'),
    ];
    expect(selectDueLineupTargets(input, minute).map((target) => target.targetKey)).toEqual(['healthy']);
  });
  it('lets later eligible work proceed past backed-off or leased oldest work', () => {
    const input = [
      dueTarget('oldest-backoff', { nextCheckAt: '2026-09-03T12:03:00Z' }),
      dueTarget('oldest-lease', { nextCheckAt: '2026-09-03T11:00:00Z', leaseExpiresAt: '2026-09-03T12:01:00Z' }),
      dueTarget('next-ready'),
    ];
    expect(selectDueLineupTargets(input, minute).map((target) => target.targetKey)).toEqual(['next-ready']);
  });
  it('reserves two current requests and caps overdue catch-up at 18 future requests', () => {
    const input = allocateLineupWatchPhases(targets(340)).map((target) => dueTarget(target.targetKey, { phase: target.phase, nextCheckAt: '2026-09-03T11:00:00Z' }));
    expect(selectDueLineupTargets(input, minute, { catchUp: true, currentRequestReservations: 2 })).toHaveLength(18);
  });
  it('caps the entire batch even if current demand exceeds capacity', () => {
    const input = Array.from({ length: 50 }, (_, index) => dueTarget(`current-${index}`, { watchClass: 'current' }));
    expect(selectDueLineupTargets(input, minute)).toHaveLength(20);
  });
});

describe('lineup-watch scale readiness, not production capacity', () => {
  it.each([2, 3, 50, 300])('keeps planning deterministic and bounded for %i leagues', (leagues) => {
    const started = performance.now();
    const input = targets(leagues * 17);
    const assignments = allocateLineupWatchPhases(input);
    const repeated = allocateLineupWatchPhases([...input].reverse());
    const stableOutput = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
    expect(stableOutput(assignments)).toBe(stableOutput(repeated));
    const buckets = [0, 1, 2].map((phase) => assignments.filter((target) => target.phase === phase).length);
    expect(Math.max(...buckets) - Math.min(...buckets)).toBeLessThanOrEqual(1);
    const capacity = assessLineupWatchCapacity(leagues, input.length);
    expect(capacity.status).toBe(leagues <= 3 ? 'supported' : 'capacity-exceeded');
    expect(capacity.requiredMatchupRequestsPerMinute).toBe(leagues + Math.ceil(leagues * 17 / 3));
    const batch = selectDueLineupTargets(assignments.map((target) => dueTarget(target.targetKey, { phase: target.phase, nextCheckAt: '2026-09-03T11:00:00Z' })), minute, { catchUp: true, currentRequestReservations: Math.min(20, leagues) });
    expect(batch.length + Math.min(20, leagues)).toBeLessThanOrEqual(20);
    expect(batch.length).toBeLessThanOrEqual(18);
    expect(Number.isFinite(performance.now() - started)).toBe(true);
    // This test plans work only. It makes zero provider/database calls and claims no fleet throughput.
  });
  it('reports the exact two-league envelope without claiming capacity for larger fleets', () => {
    expect(assessLineupWatchCapacity(2, 34)).toMatchObject({ status: 'supported', maximumFuturePhase: 12, requiredMatchupRequestsPerMinute: 14, maximumFutureChecks: 18, maximumTotalChecks: 20 });
    expect(assessLineupWatchCapacity(50, 850)).toMatchObject({ status: 'capacity-exceeded', requiredMatchupRequestsPerMinute: 334 });
    expect(assessLineupWatchCapacity(300, 5100)).toMatchObject({ status: 'capacity-exceeded', requiredMatchupRequestsPerMinute: 2000 });
  });
});
