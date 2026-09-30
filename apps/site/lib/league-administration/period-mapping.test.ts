import { describe, expect, it } from 'vitest';
import capture from '../../test-support/fixtures/sleeper-2026-season-schedule.json';
import { sleeperRegularSeasonPeriod } from '../projections/adapters/sleeper/schedule';
import { resolveSiteWeek, SITE_WEEK_POLICY_VERSION } from '../site-week';
import { createSleeperCalendarEvidence, validateSleeperCalendarEvidence } from './period-mapping';

const input = {
  season: '2026', seasonSchedule: capture.body, evaluatedAt: '2026-09-15T17:30:00.000Z',
  retrievalStartedAt: '2026-09-15T17:33:43.000Z', retrievalCompletedAt: '2026-09-15T17:33:44.000Z',
};

describe('retained Sleeper calendar evidence', () => {
  it('retains canonical source rows and the existing calendar revision with unknown provider acquisition age', () => {
    const evidence = createSleeperCalendarEvidence(input)!;
    expect(evidence).toMatchObject({
      schemaVersion: 'sleeper-calendar-evidence-v1', mappingPolicyVersion: 'sleeper-native-week-to-nfl-regular-v1',
      source: { provider: 'sleeper', resource: 'schedule/nfl/regular', season: '2026' },
      policyVersion: SITE_WEEK_POLICY_VERSION, sourceObservedAt: null,
      evaluatedAt: input.evaluatedAt, retrievalStartedAt: input.retrievalStartedAt, retrievalCompletedAt: input.retrievalCompletedAt,
      scheduleRevision: resolveSiteWeek(input).scheduleRevision,
    });
    expect(evidence.schedule).toHaveLength(272); // The existing normalizer excludes one canceled source row.
    expect(Object.keys(evidence.schedule[0]).sort()).toEqual(['away', 'date', 'game_id', 'home', 'status', 'week']);
    expect(evidence.schedule[0]).not.toBe(capture.body[0]);
    expect(validateSleeperCalendarEvidence(JSON.parse(JSON.stringify(evidence)), '2026')).toEqual(evidence);
  });

  it('keeps the semantic revision stable across source order, retrieval times and noon evaluation changes', () => {
    const before = createSleeperCalendarEvidence({ ...input, evaluatedAt: '2026-09-15T15:59:59.999Z' })!;
    const after = createSleeperCalendarEvidence({ ...input, seasonSchedule: [...capture.body].reverse(),
      evaluatedAt: '2026-09-15T16:00:00.000Z', retrievalStartedAt: '2026-09-16T12:00:00.000Z',
      retrievalCompletedAt: '2026-09-16T12:00:01.000Z' })!;
    expect(before.scheduleRevision).toBe(after.scheduleRevision);
    expect(before.schedule).toEqual(after.schedule);
    expect(resolveSiteWeek({ season: '2026', seasonSchedule: before.schedule, evaluatedAt: before.evaluatedAt }).week).toBe(1);
    expect(resolveSiteWeek({ season: '2026', seasonSchedule: after.schedule, evaluatedAt: after.evaluatedAt }).week).toBe(2);
    expect(before.sourceObservedAt).toBeNull();
    expect(after.sourceObservedAt).toBeNull();
  });

  it('retains a completed past season without replacing its year or requested exact week with today', () => {
    const evidence = createSleeperCalendarEvidence({ ...input,
      seasonSchedule: capture.body.filter(row => row.status !== 'canceled').map(row => ({ ...row, status: 'complete' })),
      evaluatedAt: '2027-02-15T12:00:00.000Z', retrievalStartedAt: '2027-02-15T12:01:00.000Z',
      retrievalCompletedAt: '2027-02-15T12:01:01.000Z' })!;
    expect(validateSleeperCalendarEvidence(evidence, '2026')).toEqual(evidence);
    expect(resolveSiteWeek({ season: '2026', seasonSchedule: evidence.schedule, evaluatedAt: evidence.evaluatedAt }))
      .toMatchObject({ week: 18, lastCompletedWeek: 18, nextRolloverAt: null });
    for (const week of [1, 3, 18]) {
      expect(evidence.schedule.some(game => game.week === week)).toBe(true);
      expect(sleeperRegularSeasonPeriod(evidence.source.season, week)).toEqual({ season: 2026, seasonType: 'regular', week });
    }
    expect(validateSleeperCalendarEvidence(evidence, '2027')).toBeNull();
  });

  it('retains postponed-game evidence without declaring the calendar advanced or games final', () => {
    const seasonSchedule = capture.body.map(row => row.game_id === '202610116'
      ? { ...row, status: 'postponed', date: '2026-09-16' } : row);
    const evidence = createSleeperCalendarEvidence({ ...input, seasonSchedule })!;
    expect(evidence.scheduleRevision).not.toBe(createSleeperCalendarEvidence(input)!.scheduleRevision);
    expect(resolveSiteWeek({ season: '2026', seasonSchedule: evidence.schedule, evaluatedAt: evidence.evaluatedAt }))
      .toMatchObject({ week: 1, nextRolloverAt: '2026-09-17T16:00:00.000Z' });
    expect(evidence.schedule.find(row => row.game_id === '202610116')?.status).toBe('postponed');
  });

  it.each([
    ['missing', undefined],
    ['partial', capture.body.slice(1)],
    ['duplicate identity', [...capture.body, capture.body[0]]],
    ['invalid actual date', capture.body.map((row, index) => index === 0 ? { ...row, date: '2026-02-30' } : row)],
    ['wrong season date', capture.body.map((row, index) => index === 0 ? { ...row, date: '2025-09-13' } : row)],
  ])('withholds %s schedule evidence', (_label, seasonSchedule) => {
    expect(createSleeperCalendarEvidence({ ...input, seasonSchedule })).toBeNull();
  });

  it.each([
    { evaluatedAt: '2026-02-30T12:00:00.000Z' },
    { retrievalStartedAt: '2026-09-15T24:00:00.000Z' },
    { retrievalCompletedAt: '2026-09-15T17:33:44+00:00' },
    { retrievalStartedAt: '2026-09-15T17:33:45.000Z' },
    { evaluatedAt: '2026-09-15T17:33:45.000Z' },
  ])('withholds malformed or reversed source intervals %j', changes => {
    expect(createSleeperCalendarEvidence({ ...input, ...changes })).toBeNull();
  });

  it.each([
    { schemaVersion: 'calendar-v2' },
    { mappingPolicyVersion: 'numeric-equality' },
    { policyVersion: 'different-rollover' },
    { scheduleRevision: 'invented-revision' },
    { sourceObservedAt: input.retrievalCompletedAt },
    { source: { provider: 'other', resource: 'schedule/nfl/regular', season: '2026' } },
    { source: { provider: 'sleeper', resource: 'state/nfl', season: '2026' } },
    { source: { provider: 'sleeper', resource: 'schedule/nfl/regular', season: '2025' } },
  ])('rejects mismatched retained identity, policy or age %j', changes => {
    expect(validateSleeperCalendarEvidence({ ...createSleeperCalendarEvidence(input), ...changes }, '2026')).toBeNull();
  });

  it('recomputes a retained schedule revision and rejects malformed rows without borrowing a current authority', () => {
    const evidence = createSleeperCalendarEvidence(input)!;
    const changed = evidence.schedule.map((row, index) => index === 0 ? { ...row, status: 'postponed' } : row);
    expect(validateSleeperCalendarEvidence({ ...evidence, schedule: changed }, '2026')).toBeNull();
    expect(validateSleeperCalendarEvidence({ ...evidence, schedule: [null, ...evidence.schedule.slice(1)] }, '2026')).toBeNull();
    expect(validateSleeperCalendarEvidence(null, '2026')).toBeNull();
  });
});
