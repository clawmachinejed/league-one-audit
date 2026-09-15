import { describe, expect, it } from 'vitest';
import capture from '../test-support/fixtures/sleeper-2026-season-schedule.json';
import { resolveSiteWeek, SITE_WEEK_POLICY_VERSION } from './site-week';

const teamPairs = [
  ['CAR', 'KC'], ['LAC', 'ARI'], ['IND', 'HOU'], ['ATL', 'BAL'],
  ['BUF', 'CHI'], ['CIN', 'CLE'], ['DAL', 'DEN'], ['DET', 'GB'],
  ['JAX', 'LAR'], ['LV', 'MIA'], ['MIN', 'NE'], ['NO', 'NYG'],
  ['NYJ', 'PHI'], ['PIT', 'SEA'], ['SF', 'TB'], ['TEN', 'WAS'],
] as const;

function addDays(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
}

/** Synthetic complete 272-game inventory with 16-game and 15-game weeks. */
function schedule(completeThrough = 1, firstLastGameDate = '2026-09-14') {
  return Array.from({ length: 18 }, (_, index) => index + 1).flatMap((week) => (
    teamPairs.filter((_, index) => week < 3 || index !== week - 3).map(([home, away], index) => ({
      game_id: `${week}-${home}-${away}`, home, away, week,
      date: addDays(firstLastGameDate, (week - 1) * 7 - (index === 0 ? 0 : 1)),
      status: week <= completeThrough ? 'complete' : 'pre_game',
    }))
  ));
}

function resolve(evaluatedAt: string, seasonSchedule: unknown = schedule(), season = '2026') {
  return resolveSiteWeek({ season, seasonSchedule, evaluatedAt });
}

describe('site week from completed NFL schedule and Eastern noon', () => {
  it('applies the cutoff to the complete captured 2026 schedule without altering the source rows', () => {
    expect(capture.source).toBe('https://api.sleeper.com/schedule/nfl/regular/2026');
    expect(capture.observedAt).toBe('2026-09-15T17:33:44.1032175Z');
    expect(capture.body).toHaveLength(273);
    expect(capture.body.filter((row) => row.status === 'canceled')).toHaveLength(1);
    expect(capture.body.filter((row) => row.week === 1 && row.status === 'complete')).toHaveLength(16);
    expect(resolve('2026-09-15T15:59:59.999Z', capture.body)).toMatchObject({
      week: 1, lastCompletedWeek: 0, nextRolloverAt: '2026-09-15T16:00:00.000Z',
    });
    expect(resolve('2026-09-15T16:00:00.000Z', capture.body)).toMatchObject({
      week: 2, lastCompletedWeek: 1, nextRolloverAt: '2026-09-22T16:00:00.000Z',
    });
  });

  it.each([
    ['2026-09-15T15:59:59.999Z', 1, 0, '2026-09-15T16:00:00.000Z'],
    ['2026-09-15T16:00:00.000Z', 2, 1, '2026-09-22T16:00:00.000Z'],
    ['2026-09-15T16:00:00.001Z', 2, 1, '2026-09-22T16:00:00.000Z'],
  ])('resolves the user Monday-to-Tuesday example at %s', (at, week, lastCompletedWeek, nextRolloverAt) => {
    expect(resolve(at)).toMatchObject({ week, lastCompletedWeek, nextRolloverAt,
      policyVersion: SITE_WEEK_POLICY_VERSION });
  });

  it('holds Week 1 before its noon boundary even if every game already reports complete', () => {
    expect(resolve('2026-09-15T10:00:00Z')).toMatchObject({ week: 1,
      lastCompletedWeek: 0, holdReason: 'rollover-time-pending' });
  });

  it.each([
    ['2026-09-13', '2026-09-14T16:00:00.000Z'],
    ['2026-09-16', '2026-09-17T16:00:00.000Z'],
    ['2026-10-31', '2026-11-01T17:00:00.000Z'],
    ['2026-03-07', '2026-03-08T16:00:00.000Z'],
  ])('uses the actual last schedule day %s with the Eastern offset at next noon', (lastDate, cutoff) => {
    const rows = schedule(1, lastDate);
    expect(resolve(new Date(Date.parse(cutoff) - 1).toISOString(), rows)).toMatchObject({
      week: 1, lastCompletedWeek: 0, nextRolloverAt: cutoff,
    });
    expect(resolve(cutoff, rows)).toMatchObject({ week: 2, lastCompletedWeek: 1 });
  });

  it.each(['pre_game', 'in_progress', 'postponed', 'suspended', 'unknown', 'final', '', null, 1])(
    'holds the week after noon when any non-canceled game status is %s', (status) => {
      const rows: Record<string, unknown>[] = schedule();
      rows[15] = { ...rows[15], status };
      expect(resolve('2026-09-15T20:00:00Z', rows)).toMatchObject({
        week: 1, lastCompletedWeek: 0, nextRolloverAt: '2026-09-15T16:00:00.000Z',
        holdReason: 'week-1-game-completion-unconfirmed',
      });
    },
  );

  it('holds a missing game status rather than inferring completion from its date', () => {
    const rows: Record<string, unknown>[] = schedule();
    delete rows[0].status;
    expect(resolve('2026-09-30T20:00:00Z', rows)).toMatchObject({
      week: 1, lastCompletedWeek: 0, nextRolloverAt: '2026-09-15T16:00:00.000Z',
      holdReason: 'week-1-game-completion-unconfirmed',
    });
  });

  it('follows an authoritative rescheduled date and still requires its completion', () => {
    const rows = schedule();
    rows[0] = { ...rows[0], date: '2026-09-16', status: 'postponed' };
    expect(resolve('2026-09-15T16:00:00Z', rows)).toMatchObject({ week: 1,
      nextRolloverAt: '2026-09-17T16:00:00.000Z' });
    expect(resolve('2026-09-17T16:00:00Z', rows)).toMatchObject({ week: 1,
      nextRolloverAt: '2026-09-17T16:00:00.000Z', holdReason: 'week-1-game-completion-unconfirmed' });
    rows[0].status = 'complete';
    expect(resolve('2026-09-17T16:00:00Z', rows)).toMatchObject({ week: 2, lastCompletedWeek: 1 });
  });

  it('ignores an extra canceled entry after the complete replacement inventory validates', () => {
    const rows = schedule();
    expect(resolve('2026-09-15T16:00:00Z', [...rows, { status: 'canceled' }])).toEqual(
      resolve('2026-09-15T16:00:00Z', rows),
    );
  });

  it('does not skip an unfinished earlier week because later weeks have complete games', () => {
    const rows = schedule(5);
    rows[0].status = 'postponed';
    expect(resolve('2026-10-20T17:00:00Z', rows)).toMatchObject({ week: 1, lastCompletedWeek: 0 });
  });

  it('advances a 15-game bye week without assuming every week has 16 games', () => {
    const rows = schedule(3);
    expect(rows.filter((row) => row.week === 3)).toHaveLength(15);
    expect(resolve('2026-09-29T16:00:00Z', rows)).toMatchObject({ week: 4, lastCompletedWeek: 3 });
  });

  it('stops at Week 18 and reports the completed horizon after the final noon boundary', () => {
    const rows = schedule(18);
    expect(resolve('2027-01-12T16:59:59.999Z', rows)).toMatchObject({
      week: 18, lastCompletedWeek: 17, nextRolloverAt: '2027-01-12T17:00:00.000Z',
    });
    expect(resolve('2027-01-12T17:00:00Z', rows)).toMatchObject({
      week: 18, lastCompletedWeek: 18, nextRolloverAt: null, holdReason: null,
    });
  });

  it('keeps schedule provenance stable across time, cutoff and response order', () => {
    const rows = schedule();
    const before = resolve('2026-09-15T15:59:59Z', rows);
    const after = resolve('2026-09-15T16:00:00Z', [...rows].reverse());
    expect(after.scheduleRevision).toBe(before.scheduleRevision);
    expect(after.scheduleRevision).toMatch(/^[a-f0-9]{64}$/u);
    const changedDate = rows.map((row, index) => index === 0 ? { ...row, date: '2026-09-16' } : row);
    const changedStatus = rows.map((row, index) => index === 0 ? { ...row, status: 'postponed' } : row);
    expect(resolve('2026-09-15T16:00:00Z', changedDate).scheduleRevision).not.toBe(before.scheduleRevision);
    expect(resolve('2026-09-15T16:00:00Z', changedStatus).scheduleRevision).not.toBe(before.scheduleRevision);
  });

  it.each(['2026-02-30', '2026-13-01', '2026-00-01', '2026-09-00', '2026-9-14', 'not-a-date']) (
    'rejects an invalid authoritative calendar date %s', (date) => {
      const rows = schedule();
      rows[0].date = date;
      expect(() => resolve('2026-09-15T16:00:00Z', rows)).toThrow(/schedule/u);
    },
  );

  it.each([
    (rows: ReturnType<typeof schedule>) => rows.slice(1),
    (rows: ReturnType<typeof schedule>) => [...rows, rows[0]],
    (rows: ReturnType<typeof schedule>) => rows.map((row, index) => index === 0 ? { ...row, game_id: rows[1].game_id } : row),
    (rows: ReturnType<typeof schedule>) => rows.map((row, index) => index === 0 ? { ...row, away: row.home } : row),
    (rows: ReturnType<typeof schedule>) => rows.map((row, index) => index === 0 ? { ...row, status: 'canceled' } : row),
  ])('rejects missing or conflicting schedule identity instead of selecting a week', (alter) => {
    expect(() => resolve('2026-09-15T16:00:00Z', alter(schedule()))).toThrow('complete, nonconflicting NFL season schedule');
  });

  it.each(['2025-09-14', '2027-03-01', '2028-01-01'])('rejects a game date outside the requested season: %s', (date) => {
    const rows = schedule();
    rows[0].date = date;
    expect(() => resolve('2026-09-15T16:00:00Z', rows)).toThrow('outside the requested season');
  });

  it.each(['', '26', '2026.5', '1999', '2100'])('rejects unsupported season identity %s', (season) => {
    expect(() => resolve('2026-09-15T16:00:00Z', schedule(), season)).toThrow('regular-season year');
  });

  it.each(['not-a-date', '2026-02-30T12:00:00Z', '2026-09-15', '2026-09-15T12:00:00'])('rejects an invalid or unzoned evaluation time %s', (at) => {
    expect(() => resolve(at)).toThrow('timestamp with a time zone');
  });
});
