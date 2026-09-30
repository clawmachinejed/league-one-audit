import { describe, expect, it, vi } from 'vitest';
import { buildSeasonOverviewProjection, type SeasonOverviewProjectionInput } from './season-overview-projections';
import { buildCompletedStandingsBasis, reconcileStandingsBasis, projectStandings } from '../projected-standings';
import { buildSeasonOverviewSchedule, seasonOverviewHistory } from './season-overview-schedules';
import { seasonOverviewCapture, seasonOverviewFixture } from './season-overview-schedules.fixtures';
import { normalizeTeams } from '../transform';
vi.mock('server-only', () => ({}));

function available(input: SeasonOverviewProjectionInput) {
  const result = buildSeasonOverviewProjection(input);
  if (result.status !== 'available') throw new Error(result.reason);
  return result;
}

describe('B2 existing projected standings composition', () => {
  it('uses the qualified B1 totals and existing completed/reconciled projector unchanged', async () => {
    const input = await seasonOverviewFixture(), before = structuredClone(input);
    const result = available(input), history = seasonOverviewHistory(input.mapping, input.teams, input.captures);
    const officialTeams = input.teams.map(team => ({ ...team.team, waiverOrder: null, waiverBudgetRemaining: null }));
    const basis = reconcileStandingsBasis(buildCompletedStandingsBasis(officialTeams, 4, history.weeks.map(week => week.rows)), officialTeams);
    const existing = projectStandings({ league: input.league, teams: officialTeams, updatedAt: input.updatedAt, projectionBasis: basis },
      { league: input.league, updatedAt: input.updatedAt, teams: officialTeams, week: 4,
        matchups: [{ id: '4', status: 'upcoming', sides: officialTeams.map(team => ({ team, points: team.id === 1 ? 0 : 4,
          projectedPoints: 10, starters: [] })) }] }, input.context);
    expect(existing.kind).toBe('projected');
    if (existing.kind === 'projected') expect(result.teams.map(team => team.projected)).toEqual(existing.teams);
    expect(result.teams.map(team => team.projected.ties)).toEqual([4, 4]);
    expect(result.reference.modelVersion).toBe('clock-v1');
    expect(result.basis).toMatchObject({ authority: 'existing-projector-derived', policy: 'display-hundredths-compatibility' });
    expect(buildSeasonOverviewProjection(input)).toEqual(result);
    expect(input).toEqual(before);
  });

  it('does not double count an active week already included in official aggregates', async () => {
    const input = await seasonOverviewFixture();
    if (input.source.status !== 'available') throw new Error('Expected source.');
    const source = { ...input.source, teams: input.source.teams.map((team, index) => ({ ...team,
      record: { ...team.record, wins: { ...team.record.wins, value: index ? 1 : 0 }, losses: { ...team.record.losses, value: index ? 0 : 1 } },
      pointsFor: { ...team.pointsFor, value: index ? '4' : '0' }, pointsAgainst: { ...team.pointsAgainst, value: index ? '0' : '4' } })) };
    const teams = input.teams.map((team, index) => ({ ...team, team: { ...team.team,
      wins: index ? 1 : 0, losses: index ? 0 : 1, pointsFor: index ? 4 : 0, pointsAgainst: index ? 0 : 4 } }));
    const result = available({ ...input, source, teams });
    expect(result.teams.map(team => [team.projected.wins, team.projected.losses, team.projected.ties])).toEqual([[0, 0, 4], [0, 0, 4]]);
  });

  it('keeps exact narrow-margin results separate from unchanged rounded projection arithmetic', async () => {
    const input = await seasonOverviewFixture();
    if (input.source.status !== 'available') throw new Error('Expected source.');
    const narrow = seasonOverviewCapture(input, 1, [{ roster_id: 1, matchup_id: 1, points: 1.004 }, { roster_id: 2, matchup_id: 1, points: 1.003 }]);
    const source = { ...input.source, teams: input.source.teams.map(team => ({ ...team,
      pointsFor: { ...team.pointsFor, value: '1' }, pointsAgainst: { ...team.pointsAgainst, value: '1' } })) };
    const captures = [narrow, ...input.captures.slice(1)];
    const teams = input.teams.map(team => ({ ...team, team: { ...team.team, pointsFor: 1, pointsAgainst: 1 } }));
    const projected = available({ ...input, source, captures, teams });
    const schedule = buildSeasonOverviewSchedule({ ...input, captures, seasonTeamId: input.teams[0].seasonTeamId, range: 'my-team' });
    expect(schedule.status === 'available' && schedule.weeks[0].result).toBe('W');
    expect(projected.basis.teams[0].ties).toBe(3);
    expect(projected.limitations).toContain('projection_baseline_uses_existing_hundredths_not_exact_official_records');
  });

  it('withholds projection for incomplete history, unproved completion, wrong mapping and rollover', async () => {
    const input = await seasonOverviewFixture();
    for (const change of [{ captures: input.captures.slice(1) }, { calendar: null },
      { context: { ...input.context, activeWeek: 5 } }, { context: { ...input.context, refreshDue: true } },
      { mapping: { ...input.mapping, generation: 2 } }]) {
      expect(buildSeasonOverviewProjection({ ...input, ...change })).toMatchObject({ status: 'unavailable', officialFactsPreserved: true });
    }
  });

  it('preserves normalizeTeams midpoint rounding before the projector instead of converting exact facts again', async () => {
    const input = await seasonOverviewFixture();
    if (input.source.status !== 'available') throw new Error('Expected source.');
    const source = { ...input.source, teams: input.source.teams.map(team => ({ ...team,
      pointsFor: { ...team.pointsFor, value: '1.005' }, pointsAgainst: { ...team.pointsAgainst, value: '1.005' } })) };
    const teams = input.teams.map(team => ({ ...team, team: { ...team.team, pointsFor: 1.01, pointsAgainst: 1.01 } }));
    const weekOne = seasonOverviewCapture(input, 1, [{ roster_id: 1, matchup_id: 1, points: 1.01 }, { roster_id: 2, matchup_id: 1, points: 1.01 }]);
    expect(available({ ...input, source, teams, captures: [weekOne, ...input.captures.slice(1)] }).basis.teams[0].pointsFor).toBe(1.01);
    expect(source.teams[0].pointsFor.value).toBe('1.005');
  });

  it('retains the existing unavailable baseline when legacy roster and history midpoint rounding disagree', async () => {
    const input = await seasonOverviewFixture();
    if (input.source.status !== 'available') throw new Error('Expected source.');
    const raw = [1, 2].map(roster_id => ({ roster_id, settings: { wins: 0, losses: 0, ties: 3,
      fpts: 0.105, fpts_against: 0.105 } }));
    const normalized = normalizeTeams(raw, []);
    const teams = input.teams.map(team => ({ ...team, team: { ...team.team,
      pointsFor: normalized.find(candidate => candidate.id === team.team.id)!.pointsFor,
      pointsAgainst: normalized.find(candidate => candidate.id === team.team.id)!.pointsAgainst } }));
    const source = { ...input.source, teams: input.source.teams.map(team => ({ ...team,
      pointsFor: { ...team.pointsFor, value: '0.105' }, pointsAgainst: { ...team.pointsAgainst, value: '0.105' } })) };
    const weekOne = seasonOverviewCapture(input, 1, raw.map(team => ({ roster_id: team.roster_id, matchup_id: 1, points: 0.105 })));
    const captures = [weekOne, ...input.captures.slice(1)];
    const history = seasonOverviewHistory(input.mapping, teams, captures);
    const oldTeams = teams.map(team => ({ ...team.team, waiverOrder: null, waiverBudgetRemaining: null }));
    expect(reconcileStandingsBasis(buildCompletedStandingsBasis(oldTeams, 4, history.weeks.map(item => item.rows)), oldTeams))
      .toMatchObject({ kind: 'unavailable' });
    expect(buildSeasonOverviewProjection({ ...input, teams, source, captures }))
      .toMatchObject({ status: 'unavailable', reason: 'Official standings and completed matchup history do not agree.' });
  });

  it.each(['additionalMatch', 'bestBall', 'divisionCount', 'startPeriod', 'playoffStartPeriod'] as const)(
    'derives the %s unsupported gate from accepted settings', async field => {
      const input = await seasonOverviewFixture();
      if (input.settings.status !== 'available') throw new Error('Expected settings.');
      const settings = { ...input.settings, value: { ...input.settings.value, competition: { ...input.settings.value.competition,
        [field]: { state: 'known' as const, sourcePath: 'fixture', value: field === 'startPeriod' ? 2 : field === 'playoffStartPeriod' ? 4 : 1 } } } };
      expect(buildSeasonOverviewProjection({ ...input, settings })).toMatchObject({ status: 'unavailable', reason: 'projected_standings_format_unsupported' });
    });

  it('withholds cross-league projected ranks when a pair has a missing total, without replacing it with zero', async () => {
    const input = await seasonOverviewFixture();
    if (input.compatibility?.forecast.status !== 'available') throw new Error('Expected forecast.');
    const compatibility = { ...input.compatibility, forecast: { ...input.compatibility.forecast,
      teams: input.compatibility.forecast.teams.map((team, index) => index ? team : { ...team, projectedPoints: null }) } };
    const result = available({ ...input, compatibility });
    expect(result.coverage).toEqual({ includedMatchups: 0, totalMatchups: 1, unresolvedTeamIds: [1, 2] });
    expect(result.teams.map(team => [team.projectedRank, team.rankMovement, team.projected.ties])).toEqual([[null, null, 3], [null, null, 3]]);
  });

  it('rejects stale/reference/team mismatches and leaves reliable official standings available separately', async () => {
    const input = await seasonOverviewFixture();
    if (!input.compatibility || input.compatibility.forecast.status !== 'available') throw new Error('Expected forecast.');
    const original = input.compatibility;
    const qualified = input.compatibility.forecast;
    for (const forecast of [{ ...qualified, reference: { ...qualified.reference, refreshDue: true } },
      { ...qualified, reference: { ...qualified.reference, snapshotId: 'foreign' } },
      { ...qualified, teams: qualified.teams.map(team => ({ ...team, seasonTeamId: 'foreign' })) }]) {
      expect(buildSeasonOverviewProjection({ ...input, compatibility: { ...original, forecast } }))
        .toMatchObject({ status: 'unavailable', officialFactsPreserved: true });
    }
  });
});
