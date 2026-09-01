import { describe, expect, it } from 'vitest';
import type { Matchup, Player, Team } from './types';
import { addProjectedPoints } from './matchup-projections';

const team: Team = {
  id: 1,
  ownerName: 'Owner',
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
});
