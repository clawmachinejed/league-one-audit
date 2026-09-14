import { describe, expect, it } from 'vitest';
import type { MatchupPeriodContext } from './matchup-period';
import { buildCompletedStandingsBasis, projectStandings, reconcileStandingsBasis, standingsTotalsMatch } from './projected-standings';
import type { SleeperMatchup } from './transform';
import type { MatchupsData, ProjectedStandingsBasis, StandingsData, StandingsTeam } from './types';

const context: MatchupPeriodContext = {
  defaultSeason: 2026, defaultWeek: 2, activeSeason: 2026, activeWeek: 2,
  lifecycle: 'active', nflPhase: 'regular', temporalState: 'active', refreshDue: false,
};

function team(id: number, fields: Partial<StandingsTeam> = {}): StandingsTeam {
  return {
    id, name: `Team ${id}`, managerName: `Manager ${id}`, avatar: null,
    wins: 0, losses: 0, ties: 0, pointsFor: 0, pointsAgainst: 0,
    waiverOrder: id, waiverBudgetRemaining: 100 - id, ...fields,
  };
}

function officialWeek(scores: number[]): SleeperMatchup[] {
  return scores.map((points, index) => ({ roster_id: index + 1, matchup_id: Math.floor(index / 2) + 1, points }));
}

function ready(basis: ProjectedStandingsBasis): Extract<ProjectedStandingsBasis, { kind: 'ready' }> {
  expect(basis.kind).toBe('ready');
  if (basis.kind !== 'ready') throw new Error(basis.reason);
  return basis;
}

function fixtures(scores = [110, 120, 100, 100]) {
  const basis = ready(buildCompletedStandingsBasis([team(1), team(2), team(3), team(4)], 2, [officialWeek([100, 80, 70, 90])]));
  const data: StandingsData = {
    league: { season: '2026', week: 2, maxWeek: 18, rosterPositions: ['QB'] },
    teams: basis.teams.map((value) => ({ ...value })), updatedAt: '2026-09-20T18:00:00Z', projectionBasis: basis,
  };
  const matchups: MatchupsData = {
    league: data.league, teams: data.teams, updatedAt: data.updatedAt, week: 2,
    matchups: [0, 1].map((index) => ({
      id: String(index + 1), status: 'live',
      sides: [index * 2 + 1, index * 2 + 2].map((id) => ({
        team: data.teams.find((value) => value.id === id)!, points: 10,
        projectedPoints: scores[id - 1], starters: [],
      })),
    })),
  };
  return { data, matchups, basis };
}

describe('completed official standings basis', () => {
  it('uses a zero Week 1 baseline, accepting omitted PA only with zero official games and points', () => {
    const official = [team(1, { pointsAgainst: null }), team(2, { pointsAgainst: null })];
    const basis = ready(buildCompletedStandingsBasis(official, 1, []));
    expect(basis.teams.map((value) => value.pointsAgainst)).toEqual([0, 0]);
    expect(reconcileStandingsBasis(basis, official)).toEqual(basis);
    expect(buildCompletedStandingsBasis([team(1, { wins: 1, pointsAgainst: null }), team(2)], 2, [officialWeek([10, 0])]).kind)
      .toBe('unavailable');
    expect(buildCompletedStandingsBasis([team(1, { pointsFor: 1, pointsAgainst: null }), team(2)], 1, []).kind)
      .toBe('unavailable');
  });

  it('reconstructs every prior week and honors commissioner custom_points, including zero', () => {
    const weekOne = officialWeek([100.25, 90.5]);
    weekOne[0].custom_points = 0;
    const basis = ready(buildCompletedStandingsBasis([team(1), team(2)], 3, [weekOne, officialWeek([-1.5, -1.5])]));
    expect(basis.teams).toEqual([
      team(2, { wins: 1, ties: 1, pointsFor: 89, pointsAgainst: -1.5 }),
      team(1, { losses: 1, ties: 1, pointsFor: -1.5, pointsAgainst: 89 }),
    ]);
  });

  it.each([
    ['missing week', [null]],
    ['missing roster', [[{ roster_id: 1, matchup_id: 1, points: 10 }]]],
    ['duplicate roster', [[{ roster_id: 1, matchup_id: 1, points: 10 }, { roster_id: 1, matchup_id: 1, points: 20 }]]],
    ['unpaired roster', [[{ roster_id: 1, matchup_id: null, points: 10 }, { roster_id: 2, matchup_id: null, points: 20 }]]],
    ['different pairing IDs', [[{ roster_id: 1, matchup_id: 1, points: 10 }, { roster_id: 2, matchup_id: 2, points: 20 }]]],
    ['missing score', [[{ roster_id: 1, matchup_id: 1, points: null }, { roster_id: 2, matchup_id: 1, points: 20 }]]],
    ['malformed override', [[{ roster_id: 1, matchup_id: 1, points: 10, custom_points: Number.NaN }, { roster_id: 2, matchup_id: 1, points: 20 }]]],
  ] satisfies Array<[string, Array<SleeperMatchup[] | null>]>)('rejects %s across the entire league', (_name, history) => {
    expect(buildCompletedStandingsBasis([team(1), team(2)], 2, history)).toEqual({
      kind: 'unavailable', reason: 'Official matchup results for Week 1 are incomplete.',
    });
  });

  it('rejects incomplete horizons and invalid or conflicting official roster identity', () => {
    expect(buildCompletedStandingsBasis([team(1), team(2)], 3, [officialWeek([1, 2])]).kind).toBe('unavailable');
    expect(buildCompletedStandingsBasis([team(1), team(1)], 1, []).kind).toBe('unavailable');
    expect(buildCompletedStandingsBasis([team(1)], 1, []).kind).toBe('unavailable');
    expect(buildCompletedStandingsBasis([team(1), team(2)], 0, []).kind).toBe('unavailable');
  });

  it('accepts already-updated official aggregates while retaining only prior weeks as the projection basis', () => {
    const official = [team(1, { wins: 2, pointsFor: 230, pointsAgainst: 190 }), team(2, { losses: 2, pointsFor: 190, pointsAgainst: 230 })];
    const basis = ready(buildCompletedStandingsBasis(official, 2, [officialWeek([100, 80])]));
    expect(standingsTotalsMatch(official, basis.teams)).toBe(false);
    expect(reconcileStandingsBasis(basis, official, officialWeek([130, 110]))).toEqual(basis);
    expect(basis.teams[0]).toMatchObject({ wins: 1, pointsFor: 100, pointsAgainst: 80 });
  });

  it('does not conceal unexplained record/point adjustments or partially updated aggregate groups', () => {
    const basis = ready(buildCompletedStandingsBasis([team(1), team(2)], 2, [officialWeek([100, 80])]));
    for (const official of [
      [team(1, { wins: 1, pointsFor: 101, pointsAgainst: 80 }), team(2, { losses: 1, pointsFor: 80, pointsAgainst: 100 })],
      [team(1, { wins: 2, pointsFor: 230, pointsAgainst: 190 }), team(2, { losses: 1, pointsFor: 80, pointsAgainst: 100 })],
      [team(1, { losses: 1, pointsFor: 100, pointsAgainst: 80 }), team(2, { wins: 1, pointsFor: 80, pointsAgainst: 100 })],
    ]) {
      expect(reconcileStandingsBasis(basis, official, officialWeek([130, 110])).kind).toBe('unavailable');
    }
  });
});

describe('live projected standings', () => {
  it('adds exactly one current result, PF and opposing PA, then reuses win rate/PF/PA ranking', () => {
    const { data, matchups } = fixtures();
    const result = projectStandings(data, matchups, context);
    expect(result).toEqual({ kind: 'projected', week: 2, teams: [
      team(4, { wins: 1, ties: 1, pointsFor: 190, pointsAgainst: 170 }),
      team(1, { wins: 1, losses: 1, pointsFor: 210, pointsAgainst: 200 }),
      team(2, { wins: 1, losses: 1, pointsFor: 200, pointsAgainst: 210 }),
      team(3, { losses: 1, ties: 1, pointsFor: 170, pointsAgainst: 190 }),
    ] });
  });

  it('keeps OFF data intact and recomputes from the same baseline on refresh without compounding results', () => {
    const { data, matchups } = fixtures();
    const before = structuredClone({ data, matchups });
    const first = projectStandings(data, matchups, context);
    expect(projectStandings(data, matchups, context)).toEqual(first);
    expect({ data, matchups }).toEqual(before);
    matchups.matchups[0].sides[0].projectedPoints = 150;
    const refreshed = projectStandings(data, matchups, context);
    expect(refreshed.kind).toBe('projected');
    if (refreshed.kind === 'projected') expect(refreshed.teams.find((value) => value.id === 1))
      .toMatchObject({ wins: 2, losses: 0, pointsFor: 250, pointsAgainst: 200 });
  });

  it('does not double count the active week when official cumulative data already contains it', () => {
    const { data, matchups } = fixtures();
    data.teams = data.teams.map((value) => ({ ...value, wins: value.wins + 1, pointsFor: value.pointsFor + 999 }));
    const result = projectStandings(data, matchups, context);
    if (result.kind !== 'projected') throw new Error(result.reason);
    expect(result.teams.find((value) => value.id === 1)).toMatchObject({ wins: 1, losses: 1, pointsFor: 210 });
  });

  it('ranks equal records and PF by higher PA, then the existing stable name and roster tie breakers', () => {
    const { data, matchups, basis } = fixtures([100, 100, 100, 100]);
    basis.teams = [team(1, { pointsAgainst: 2 }), team(2, { pointsAgainst: 8 }), team(3, { name: 'A' }), team(4, { name: 'A' })];
    const result = projectStandings(data, matchups, context);
    if (result.kind !== 'projected') throw new Error(result.reason);
    expect(result.teams.map((value) => value.id)).toEqual([2, 1, 3, 4]);
  });

  it('accepts zero and negative projections and avoids floating-point false tie breaks', () => {
    const { data, matchups } = fixtures([0, -1, 0.1 + 0.2, 0.3]);
    const result = projectStandings(data, matchups, context);
    if (result.kind !== 'projected') throw new Error(result.reason);
    expect(result.teams.find((value) => value.id === 1)).toMatchObject({ wins: 2, pointsFor: 100, pointsAgainst: 79 });
    expect(result.teams.find((value) => value.id === 3)).toMatchObject({ ties: 1, pointsFor: 70.3, pointsAgainst: 90.3 });
  });

  it.each([
    { left: 1.005, right: 1.004, record: { wins: 1, losses: 0, ties: 1 }, pointsFor: 101, pointsAgainst: 81 },
    { left: 1.335, right: 1.334, record: { wins: 1, losses: 0, ties: 1 }, pointsFor: 101.33, pointsAgainst: 81.33 },
    { left: 1.125, right: 1.124, record: { wins: 2, losses: 0, ties: 0 }, pointsFor: 101.13, pointsAgainst: 81.12 },
    { left: -1.125, right: -1.124, record: { wins: 1, losses: 1, ties: 0 }, pointsFor: 98.87, pointsAgainst: 78.88 },
    { left: -1.005, right: -1.004, record: { wins: 1, losses: 0, ties: 1 }, pointsFor: 99, pointsAgainst: 79 },
  ])('matches Matchups two-decimal results for $left versus $right, including signed midpoints', ({ left, right, record, pointsFor, pointsAgainst }) => {
    const { data, matchups } = fixtures([left, right, 100, 100]);
    const result = projectStandings(data, matchups, context);
    if (result.kind !== 'projected') throw new Error(result.reason);
    expect(result.teams.find((value) => value.id === 1)).toMatchObject({ ...record, pointsFor, pointsAgainst });
    expect(result.teams.find((value) => value.id === 2)).toMatchObject({
      pointsFor: pointsAgainst, pointsAgainst: pointsFor,
    });
  });

  it('accepts active scoring week when the default display period has advanced', () => {
    const { data, matchups } = fixtures();
    data.league.week = 3;
    expect(projectStandings(data, matchups, { ...context, defaultWeek: 3 }).kind).toBe('projected');
  });

  it.each([
    { activeWeek: 3 }, { activeSeason: 2025 }, { lifecycle: 'complete' },
    { lifecycle: 'preseason' }, { temporalState: 'future' }, { temporalState: 'past' }, { refreshDue: true },
  ] satisfies Array<Partial<MatchupPeriodContext>>)('rejects an unusable or different period: %j', (change) => {
    const { data, matchups } = fixtures();
    expect(projectStandings(data, matchups, { ...context, ...change }).kind).toBe('unavailable');
  });

  it('rejects a wrong snapshot season or week and a missing or unavailable baseline', () => {
    const { data, matchups } = fixtures();
    expect(projectStandings(data, { ...matchups, week: 1 }, context).kind).toBe('unavailable');
    expect(projectStandings(data, { ...matchups, league: { ...matchups.league, season: '2025' } }, context).kind).toBe('unavailable');
    expect(projectStandings({ ...data, projectionBasis: undefined }, matchups, context).kind).toBe('unavailable');
    expect(projectStandings({ ...data, projectionBasis: { kind: 'unavailable', reason: 'History unavailable.' } }, matchups, context))
      .toEqual({ kind: 'unavailable', reason: 'History unavailable.' });
  });

  it.each(['missing team', 'duplicate team', 'missing side', 'duplicate side', 'unknown side', 'duplicate matchup', 'unknown status', 'null projection', 'NaN projection'])
    ('rejects %s instead of publishing a partially projected league', (failure) => {
      const { data, matchups } = fixtures();
      if (failure === 'missing team') matchups.teams = matchups.teams.slice(1);
      if (failure === 'duplicate team') matchups.teams = [matchups.teams[0], ...matchups.teams.slice(0, 3)];
      if (failure === 'missing side') matchups.matchups[0].sides.pop();
      if (failure === 'duplicate side') matchups.matchups[1].sides[0].team = matchups.matchups[0].sides[0].team;
      if (failure === 'unknown side') matchups.matchups[0].sides[0].team = team(99);
      if (failure === 'duplicate matchup') matchups.matchups[1].id = matchups.matchups[0].id;
      if (failure === 'unknown status') matchups.matchups[0].status = 'unknown';
      if (failure === 'null projection') matchups.matchups[0].sides[0].projectedPoints = null;
      if (failure === 'NaN projection') matchups.matchups[0].sides[0].projectedPoints = Number.NaN;
      expect(projectStandings(data, matchups, context).kind).toBe('unavailable');
    });
});
