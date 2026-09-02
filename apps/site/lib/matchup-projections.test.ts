import { describe, expect, it } from 'vitest';
import type { Matchup, Player, Team } from './types';
import {
  addProjectedPoints,
  scoreTank01PregamePointMap,
  scoreTank01PlayersPointMap,
} from './matchup-projections';
import type { Tank01AvailableResult } from './tank01';

const team: Team = {
  id: 1,
  managerName: 'Manager',
  name: 'Team',
  avatar: null,
  wins: 0,
  losses: 0,
  ties: 0,
  pointsFor: 0,
  pointsAgainst: null,
};

function player(id: string): Player {
  return {
    id,
    name: id,
    position: 'RB',
    nflTeam: 'IND',
    injuryStatus: null,
    game: null,
    slot: 'FLEX',
    points: null,
    projectedPoints: null,
  };
}

function matchup(starters: Player[]): Matchup {
  return {
    id: '1',
    status: 'upcoming',
    sides: [{ team, points: null, projectedPoints: null, starters }],
  };
}

describe('matchup projections', () => {
  it('adds player projections and sums unrounded starter values', () => {
    const [result] = addProjectedPoints([matchup([player('one'), player('two')])], {
      one: 10.125,
      two: -0.025,
    });
    expect(result.sides[0].starters.map((starter) => starter.projectedPoints)).toEqual([10.125, -0.025]);
    expect(result.sides[0].projectedPoints).toBeCloseTo(10.1, 10);
  });

  it('preserves a genuine zero projection', () => {
    const [result] = addProjectedPoints([matchup([player('zero')])], { zero: 0 });
    expect(result.sides[0].starters[0].projectedPoints).toBe(0);
    expect(result.sides[0].projectedPoints).toBe(0);
  });

  it('does not present a partial team total when a real starter is missing', () => {
    const [result] = addProjectedPoints([matchup([player('known'), player('missing')])], { known: 12 });
    expect(result.sides[0].starters[0].projectedPoints).toBe(12);
    expect(result.sides[0].starters[1].projectedPoints).toBeNull();
    expect(result.sides[0].projectedPoints).toBeNull();
  });

  it('does not inflate a team total when malformed lineup data repeats a starter', () => {
    const [result] = addProjectedPoints([matchup([player('repeat'), player('repeat')])], { repeat: 12 });
    expect(result.sides[0].starters.map((starter) => starter.projectedPoints)).toEqual([12, 12]);
    expect(result.sides[0].projectedPoints).toBeNull();
  });

  it('ignores empty lineup slots for completeness without inventing a player score', () => {
    const [result] = addProjectedPoints([matchup([player('known'), player('empty-FLEX-1')])], { known: 8 });
    expect(result.sides[0].starters[1].projectedPoints).toBeNull();
    expect(result.sides[0].projectedPoints).toBe(8);
  });

  it('leaves a team with no real starters unavailable', () => {
    const [result] = addProjectedPoints([matchup([player('empty-QB-0')])], {});
    expect(result.sides[0].projectedPoints).toBeNull();
  });

  it('exposes full-precision pregame points and source quality independently of UI decoration', () => {
    const sourcePlayer = player('sleeper-running-back');
    const result = scoreTank01PregamePointMap(
      [matchup([sourcePlayer, player('missing-from-slate')])],
      availableTank01Result({
        'sleeper-running-back': {
          tank01PlayerId: 'tank-running-back',
          sleeperPlayerId: 'sleeper-running-back',
          team: 'IND',
          position: 'RB',
          stats: emptyPlayerStats,
          scoringProjection: { kind: 'offense', rushingYards: 101.25 },
          missingFields: [],
        },
      }),
      { rush_yd: 0.1 },
    );

    expect(result.status).toBe('available');
    expect({ ...result.pointsByPlayer }).toEqual({
      'sleeper-running-back': 10.125,
      'missing-from-slate': 0,
    });
    expect({ ...result.qualityByPlayer }).toEqual({
      'sleeper-running-back': 'complete',
      'missing-from-slate': 'missing',
    });
  });

  it('withholds an unsafe identity match from the reusable pregame map', () => {
    const result = scoreTank01PregamePointMap(
      [matchup([player('sleeper-running-back')])],
      availableTank01Result({
        'sleeper-running-back': {
          tank01PlayerId: 'tank-wide-receiver',
          sleeperPlayerId: 'sleeper-running-back',
          team: 'IND',
          position: 'WR',
          stats: emptyPlayerStats,
          scoringProjection: { kind: 'offense', rushingYards: 100 },
          missingFields: [],
        },
      }),
      { rush_yd: 0.1 },
    );

    expect(result.status).toBe('available');
    expect(Object.keys(result.pointsByPlayer)).toEqual([]);
    expect(Object.keys(result.qualityByPlayer)).toEqual([]);
  });

  it('scores rostered bench players without fabricating matchup rows', () => {
    const bench = player('bench-running-back');
    const result = scoreTank01PlayersPointMap(
      [bench],
      availableTank01Result({
        'bench-running-back': {
          tank01PlayerId: 'tank-bench-running-back',
          sleeperPlayerId: 'bench-running-back',
          team: 'IND',
          position: 'RB',
          stats: emptyPlayerStats,
          scoringProjection: { kind: 'offense', rushingYards: 55.5 },
          missingFields: [],
        },
      }),
      { rush_yd: 0.1 },
    );
    expect(result.status).toBe('available');
    expect(result.pointsByPlayer['bench-running-back']).toBeCloseTo(5.55, 10);
    expect(result.qualityByPlayer['bench-running-back']).toBe('complete');
  });
});

const emptyPlayerStats = {
  passing: { attempts: null, completions: null, yards: null, touchdowns: null, interceptions: null },
  rushing: { carries: null, yards: null, touchdowns: null },
  receiving: { targets: null, receptions: null, yards: null, touchdowns: null },
  kicking: {
    fieldGoalsMade: null, fieldGoalsMissed: null, extraPointsMade: null, extraPointsMissed: null,
  },
  twoPointConversions: null,
  fumblesLost: null,
} as const;

function availableTank01Result(
  bySleeperId: Tank01AvailableResult['projections']['bySleeperId'],
): Tank01AvailableResult {
  return {
    status: 'available',
    season: '2026',
    week: 1,
    fetchedAt: '2026-09-01T12:00:00.000Z',
    projections: { bySleeperId, byDefenseTeam: {} },
    coverage: {
      playerListRows: 0,
      crosswalkEntries: 0,
      malformedPlayerListRows: 0,
      ambiguousPlayerListRows: 0,
      playerProjectionRows: 0,
      matchedPlayerProjections: 0,
      unmatchedPlayerProjections: 0,
      malformedPlayerProjections: 0,
      incompletePlayerProjections: 0,
      defenseProjectionRows: 0,
      usableDefenseProjections: 0,
      malformedDefenseProjections: 0,
      incompleteDefenseProjections: 0,
    },
    warnings: [],
  };
}
