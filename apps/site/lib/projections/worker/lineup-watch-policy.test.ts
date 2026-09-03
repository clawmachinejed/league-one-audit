import { createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { describe, expect, it } from 'vitest';
import {
  allocateLineupWatchPhases, assessLineupWatchCapacity, initialLineupCheckAt,
  lineupFailureRetryDelaysSeconds,
  nextLineupCheckAt,
  type LineupPhaseTarget,
} from './lineup-watch-policy';

function targets(count: number): LineupPhaseTarget[] {
  return Array.from({ length: count }, (_, index) => {
    const targetKey = `league-${Math.floor(index / 17)}:2026:regular:${index % 17 + 2}`;
    return { targetKey, stableHash: createHash('sha256').update(targetKey).digest('hex') };
  });
}

const minute = new Date('2026-09-03T12:00:00Z');
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
    const phase = 0;
    expect(nextLineupCheckAt('future', phase, new Date('2026-09-03T12:00:45.999Z'))).toBe('2026-09-03T12:03:00.000Z');
    expect(nextLineupCheckAt('future', phase, new Date('2026-09-03T12:03:55Z'))).toBe('2026-09-03T12:06:00.000Z');
  });
  it('aligns current checks with the next minute rather than adding response latency', () => {
    expect(nextLineupCheckAt('current', 0, new Date('2026-09-03T12:00:59.999Z'))).toBe('2026-09-03T12:01:00.000Z');
    expect(nextLineupCheckAt('current', 0, new Date('2026-09-03T12:00:00.000Z'))).toBe('2026-09-03T12:01:00.000Z');
  });
  it('handles hour and day transitions without phase drift', () => {
    const phase = 0;
    expect(nextLineupCheckAt('future', phase, new Date('2026-09-03T23:57:30Z'))).toBe('2026-09-04T00:00:00.000Z');
  });
  it('seeds the active phase immediately and future phases at their next absolute bucket', () => {
    const currentPhase = 0;
    expect(initialLineupCheckAt('future', currentPhase, new Date('2026-09-03T12:00:30Z'))).toBe(minute.toISOString());
    expect(initialLineupCheckAt('current', 0, new Date('2026-09-03T12:00:30Z'))).toBe(minute.toISOString());
    expect(initialLineupCheckAt('future', ((currentPhase + 1) % 3) as 0 | 1 | 2, minute)).toBe('2026-09-03T12:01:00.000Z');
  });
  it('never schedules a completed period', () => {
    expect(nextLineupCheckAt('completed', 0, minute)).toBeNull();
    expect(initialLineupCheckAt('completed', 0, minute)).toBeNull();
  });
  it('rejects invalid scheduling input', () => {
    expect(() => nextLineupCheckAt('future', 3 as 0, minute)).toThrow('phase');
    expect(() => nextLineupCheckAt('current', 0, new Date('invalid'))).toThrow('time');
  });
});

describe('durable watcher retry policy', () => {
  it('shares exact current and future backoff steps with every observation path', () => {
    expect(lineupFailureRetryDelaysSeconds('current')).toEqual([60, 300, 900, 3600]);
    expect(lineupFailureRetryDelaysSeconds('future')).toEqual([180, 300, 900, 3600]);
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
    expect(Number.isFinite(performance.now() - started)).toBe(true);
    // This test plans work only. It makes zero provider/database calls and claims no fleet throughput.
  });
  it('reports the exact two-league envelope without claiming capacity for larger fleets', () => {
    expect(assessLineupWatchCapacity(2, 34)).toMatchObject({ status: 'supported', maximumFuturePhase: 12, requiredMatchupRequestsPerMinute: 14, maximumFutureChecks: 18, maximumTotalChecks: 20 });
    expect(assessLineupWatchCapacity(50, 850)).toMatchObject({ status: 'capacity-exceeded', requiredMatchupRequestsPerMinute: 334 });
    expect(assessLineupWatchCapacity(300, 5100)).toMatchObject({ status: 'capacity-exceeded', requiredMatchupRequestsPerMinute: 2000 });
  });
});
