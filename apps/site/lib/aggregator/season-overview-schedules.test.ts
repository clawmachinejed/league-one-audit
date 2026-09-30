import { describe, expect, it, vi } from 'vitest';
import { buildMyTeamScheduleWeeks, selectTeamSchedule } from '../my-team-schedule';
import { buildSeasonOverviewSchedule, seasonOverviewHistory, type SeasonOverviewScheduleInput } from './season-overview-schedules';
import { seasonOverviewCapture, seasonOverviewFixture } from './season-overview-schedules.fixtures';
import { b1RetainedEvidence, b1RetainedSelection, b1CompatibilityFixture } from './b1-acceptance.fixtures';
import { projectRetainedMatchups } from './retained-matchups';
import { createSleeperCalendarEvidence } from '../league-administration/period-mapping';
vi.mock('server-only', () => ({}));

async function fixture(): Promise<SeasonOverviewScheduleInput> {
  const source = await seasonOverviewFixture();
  return { ...source, captures: [...source.captures, source.compatibility!.official], seasonTeamId: source.teams[0].seasonTeamId, range: 'my-team' };
}
function available(input: SeasonOverviewScheduleInput) {
  const result = buildSeasonOverviewSchedule(input);
  if (result.status !== 'available') throw new Error(result.reason);
  return result;
}

describe('B2 schedules over exact B1 captures', () => {
  it('matches the existing schedule from the same capture and keeps current record/name overlays on historical weeks', async () => {
    const input = await fixture(), result = available(input);
    const history = seasonOverviewHistory(input.mapping, input.teams, input.captures);
    const old = selectTeamSchedule({ league: input.league, updatedAt: input.updatedAt, teams: input.teams.map(team => team.team),
      weeks: buildMyTeamScheduleWeeks(input.teams.map(team => team.team), history.weeks.map(item => item.rows),
        { completedWeeks: [1, 2, 3], activeWeek: 4, preseason: false }) }, 1);
    expect(result.weeks.map(({ week, points, opponentPoints, status, result }) => ({ week, points, opponentPoints, status, result })))
      .toEqual(old.weeks.map(({ week, points, opponentPoints, status, result }) => ({ week, points, opponentPoints, status, result })));
    expect(result.currentTeam).toMatchObject({ currentRecord: { ties: 3 }, leagueOneRank: 1, display: { name: 'Current Team 1' } });
    expect(result.weeks[0].currentOpponent).toMatchObject({ currentRecord: { ties: 3 }, display: { name: 'Current Team 2' } });
    expect(result.weeks[3]).toMatchObject({ result: null, exactOfficialPoints: { raw: '8.25', custom: '0', effective: '0' },
      finality: { provider: 'unknown', local: 'unknown' } });
    expect(result.weeks).toHaveLength(15);
    expect(available({ ...input, range: 'manager' }).weeks).toHaveLength(14);
  });

  it('preserves exact unrounded W-L-T, custom zero, corrections and negative scores without mutating the capture', async () => {
    const input = await fixture(), base = await seasonOverviewFixture();
    const rows = [{ roster_id: 1, matchup_id: 1, points: 1.004 }, { roster_id: 2, matchup_id: 1, points: 1.003 }];
    const capture = seasonOverviewCapture(base, 1, rows), before = structuredClone(capture);
    expect(available({ ...input, captures: [capture] }).weeks[0]).toMatchObject({ points: 1.004, opponentPoints: 1.003, result: 'W' });
    const corrected = seasonOverviewCapture(base, 1, [{ ...rows[0], custom_points: 0 }, rows[1]]);
    expect(available({ ...input, captures: [corrected] }).weeks[0]).toMatchObject({ points: 0, result: 'L', exactOfficialPoints: { raw: '1.004', custom: '0' } });
    const tie = seasonOverviewCapture(base, 1, rows.map(row => ({ ...row, points: -1.005 })));
    expect(available({ ...input, captures: [tie] }).weeks[0]).toMatchObject({ points: -1.005, result: 'T' });
    expect(capture).toEqual(before);
  });

  it('withholds result for missing score or calendar and never invents a bye or empty successful week', async () => {
    const input = await fixture(), base = await seasonOverviewFixture();
    const missing = seasonOverviewCapture(base, 1, [{ roster_id: 1, matchup_id: 1 }, { roster_id: 2, matchup_id: 1, points: 0 }]);
    expect(available({ ...input, captures: [missing] }).weeks[0]).toMatchObject({ points: null, result: null, coverage: { status: 'partial' } });
    const unpaired = seasonOverviewCapture(base, 1, [{ roster_id: 1, matchup_id: null, points: 1 }, { roster_id: 2, matchup_id: null, points: 2 }]);
    expect(available({ ...input, captures: [unpaired] }).weeks[0]).toMatchObject({ opponentSeasonTeamId: null, result: null,
      exactOfficialPoints: { effective: '1' }, coverage: { status: 'limited' } });
    expect(available({ ...input, calendar: null }).weeks[0]).toMatchObject({ points: 0, result: null, finality: { local: 'unknown' } });
    expect(available({ ...input, captures: [] }).weeks[0]).toMatchObject({ source: null, coverage: { status: 'missing' }, result: null });
  });

  it('keeps retained input lineage/limitations and retries deterministic without claiming durable replay', async () => {
    const input = await fixture();
    const retained = projectRetainedMatchups(b1RetainedSelection, b1RetainedEvidence(b1CompatibilityFixture()));
    const first = available({ ...input, captures: [retained] });
    expect(available({ ...input, captures: [retained] })).toEqual(first);
    expect(first.weeks[3].source).toMatchObject({ kind: 'retained', limitations: expect.arrayContaining(['finality_unproved', 'configuration_applicability_unproved']) });
    expect(first.weeks[3].exactOfficialPoints).toMatchObject({ custom: '0' });
  });

  it('rejects mixed seasons, mapping revisions, foreign/duplicate team joins and ambiguous corrected capture selection', async () => {
    const input = await fixture();
    expect(buildSeasonOverviewSchedule({ ...input, league: { ...input.league, season: '2025' } }).status).toBe('unavailable');
    expect(buildSeasonOverviewSchedule({ ...input, teams: [...input.teams, input.teams[0]] }).status).toBe('unavailable');
    expect(available({ ...input, mapping: { ...input.mapping, revisionId: '00000000-0000-4000-8000-000000000999' } }).weeks[0].coverage.status).toBe('missing');
    const capture = input.captures[0];
    expect(available({ ...input, captures: [capture, capture] }).weeks[0]).toMatchObject({ coverage: { status: 'missing', reason: 'multiple_captures_require_selection' } });
    expect(available({ ...input, teams: input.teams.map((team, index) => index ? team : { ...team, seasonTeamId: 'foreign' }),
      seasonTeamId: 'foreign' }).weeks[0].coverage.status).toBe('missing');
  });

  it('does not turn a current missing record into a genuine zero through the legacy schedule bridge', async () => {
    const input = await fixture();
    const result = available({ ...input, teams: input.teams.map(team => ({ ...team, currentRecord: null, leagueOneRank: null })) });
    expect(result.currentTeam).toMatchObject({ currentRecord: null, leagueOneRank: null });
    expect(result.weeks[0].result).toBe('T');
  });

  it('matches preseason Week 1 and keeps completion independent of the noon rollover', async () => {
    const input = await fixture();
    const preseason = createSleeperCalendarEvidence({ season: '2026',
      seasonSchedule: input.calendar!.evidence.schedule.map(game => ({ ...game, status: null })),
      evaluatedAt: '2026-09-01T12:00:00.000Z', retrievalStartedAt: '2026-09-01T12:00:00.000Z', retrievalCompletedAt: '2026-09-01T12:00:01.000Z' })!;
    const before = available({ ...input, calendar: { ...input.calendar!, evidence: preseason },
      context: { ...input.context, lifecycle: 'preseason', activeWeek: null, activeSeason: null, defaultWeek: 1, temporalState: 'future' } });
    expect(before.weeks.every(week => week.status === 'upcoming' && week.result === null)).toBe(true);
    const completedBeforeNoon = createSleeperCalendarEvidence({ season: '2026', seasonSchedule: input.calendar!.evidence.schedule,
      evaluatedAt: '2026-09-29T08:00:00.000Z', retrievalStartedAt: '2026-09-29T08:00:00.000Z', retrievalCompletedAt: '2026-09-29T08:00:01.000Z' })!;
    const prior = available({ ...input, calendar: { ...input.calendar!, evidence: completedBeforeNoon },
      context: { ...input.context, activeWeek: 3, defaultWeek: 3 } });
    expect(prior.weeks[2]).toMatchObject({ status: 'final', result: 'T' });
    expect(prior.weeks[3]).toMatchObject({ status: 'upcoming', result: null });
  });
});
