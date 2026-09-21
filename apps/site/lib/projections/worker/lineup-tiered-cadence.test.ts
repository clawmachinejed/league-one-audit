import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { lineupCadencePolicy, parseLineupCadencePolicy } from '../shared/lineup-cadence';
import { assessLineupWatchCapacity, initialLineupCheckAt, nextLineupCheckAt } from './lineup-watch-policy';

const hash = (key: string) => createHash('sha256').update(key).digest('hex');
const policy = (distance: number, key = 'one:2026:regular:2') => lineupCadencePolicy(distance === 0 ? 'current' : 'future', distance, hash(key));

describe('persisted tiered lineup cadence', () => {
  it.each([[0, 1], [1, 15], [2, 60], [4, 60], [5, 360], [17, 360]])('uses the approved tier at distance %i', (distance, minutes) => {
    expect(parseLineupCadencePolicy(policy(distance), distance === 0 ? 'current' : 'future', 0).minutes).toBe(minutes);
  });
  it.each(['lineup-cadence-v2:3:0', 'lineup-cadence-v2:15:15', 'lineup-cadence-v2:15:-1',
    'lineup-cadence-v2:60:01', 'lineup-cadence-v2:360:360', 'lineup-cadence-v2', 'unknown'])('rejects malformed persisted policy %s', (value) => {
    expect(() => parseLineupCadencePolicy(value, 'future', 0)).toThrow('cadence');
  });
  it('rejects current/future tier mismatches and retains exact legacy cadence', () => {
    expect(() => parseLineupCadencePolicy('lineup-cadence-v2:1:0', 'future', 0)).toThrow();
    expect(() => parseLineupCadencePolicy('lineup-cadence-v2:15:0', 'current', 0)).toThrow();
    expect(parseLineupCadencePolicy('lineup-cadence-v1', 'future', 2)).toEqual({ minutes: 3, offset: 2 });
  });
  it.each([15, 60, 360])('keeps absolute %i-minute slots through delayed responses and day rollover', (minutes) => {
    const version = `lineup-cadence-v2:${minutes}:0`;
    const checked = new Date('2026-09-03T23:59:59.999Z');
    const next = nextLineupCheckAt('future', 0, checked, version)!;
    expect(next).toBe('2026-09-04T00:00:00.000Z');
    expect(nextLineupCheckAt('future', 0, new Date(Date.parse(next) + 59_999), version))
      .toBe(new Date(Date.parse(next) + minutes * 60_000).toISOString());
  });
  it('never schedules completed periods', () => {
    expect(initialLineupCheckAt('completed', 0, new Date(), 'lineup-cadence-v2:1:0')).toBeNull();
    expect(nextLineupCheckAt('completed', 0, new Date(), 'lineup-cadence-v2:1:0')).toBeNull();
  });
  it('stably staggers a full day of three-league Week 2 checks with exact tier totals', () => {
    const start = new Date('2026-09-03T00:00:00Z');
    const end = start.getTime() + 24 * 60 * 60_000;
    const buckets = new Array<number>(1440).fill(3); // Current stays once/minute/league.
    const counts = new Map<number, number>();
    const schedules = [];
    for (let league = 0; league < 3; league += 1) for (let distance = 1; distance <= 16; distance += 1) {
      const cadencePolicyVersion = policy(distance, `league-${league}:2026:regular:${distance + 2}`);
      const schedule = parseLineupCadencePolicy(cadencePolicyVersion, 'future', 0);
      schedules.push({ cadencePolicyVersion, phase: 0 as const });
      let next = initialLineupCheckAt('future', 0, start, cadencePolicyVersion)!;
      while (Date.parse(next) < end) {
        buckets[(Date.parse(next) - start.getTime()) / 60_000] += 1;
        counts.set(schedule.minutes, (counts.get(schedule.minutes) ?? 0) + 1);
        next = nextLineupCheckAt('future', 0, new Date(Date.parse(next) + 10_000), cadencePolicyVersion)!;
      }
    }
    expect(Object.fromEntries(counts)).toEqual({ 15: 288, 60: 216, 360: 144 });
    expect(buckets.reduce((sum, count) => sum + count, 0)).toBe(4968);
    expect(Math.max(...buckets)).toBeLessThanOrEqual(20);
    expect(new Set(buckets).size).toBeGreaterThan(1);
    expect(assessLineupWatchCapacity(3, 48, schedules).requiredMatchupRequestsPerMinute).toBe(Math.max(...buckets));
  });
  it('reserves future progress under current overload without pretending every target fits', () => {
    expect(assessLineupWatchCapacity(25, 425)).toMatchObject({ status: 'capacity-exceeded', maximumCurrentChecks: 19, maximumFutureChecks: 1 });
    expect(assessLineupWatchCapacity(25, 0)).toMatchObject({ maximumCurrentChecks: 20, maximumFutureChecks: 0 });
    expect(assessLineupWatchCapacity(4, 68).maximumCurrentChecks).toBe(4);
  });
  it.each([
    [40, 10, 18, 1], [4, 1, 3, 16], [3, 0, 3, 17], [20, 20, 0, 1], [2, 2, 0, 18],
  ])('shares the nominal budget for %i current targets including %i observer defaults', (current, defaults, activeLimit, futureLimit) => {
    const capacity = assessLineupWatchCapacity(current, current * 17, undefined, defaults);
    expect(capacity).toMatchObject({ maximumCurrentChecks: activeLimit, maximumFutureChecks: futureLimit });
    expect(capacity.maximumCurrentChecks + capacity.maximumFutureChecks).toBeLessThanOrEqual(defaults > 0 ? 19 : 20);
  });
});
