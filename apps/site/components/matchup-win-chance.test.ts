import { describe, expect, it } from 'vitest';
import { matchupWithTeamOnLeft } from '../lib/my-team-matchup';
import { snapshotFixture } from '../test-support/matchup-snapshot-fixtures';
import { matchupWinChance } from './matchup-win-chance';

function matchup(probability = 0.505, modelVersion: 'normal-v1' | 'normal-v2' = 'normal-v1') {
  const value = snapshotFixture().matchups[0];
  value.winProbability = { modelVersion, status: 'estimated', teams: [
    { teamId: 2, probability: 1 - probability }, { teamId: 1, probability },
  ] };
  return value;
}

describe('matchup win chance presentation', () => {
  it.each(['normal-v1', 'normal-v2'] as const)('shows stored %s estimates with the same orientation and rounding', modelVersion => {
    const source = matchup(0.654321, modelVersion);
    expect(matchupWinChance(source)).toMatchObject({ status: 'estimated', values: ['65%', '35%'] });
    expect(matchupWinChance(matchupWithTeamOnLeft(source, 2)).values).toEqual(['35%', '65%']);
  });

  it.each(['normal-v3', 'other-v1', '', 'NORMAL-V2'])('withholds an estimate from an unsupported model %j', modelVersion => {
    for (const status of ['upcoming', 'live'] as const) {
      const source = matchup();
      source.status = status;
      Object.assign(source.winProbability!, { modelVersion });
      expect(matchupWinChance(source)).toMatchObject({ status: 'unavailable', values: ['—', '—'] });
    }
  });

  it.each(['normal-v1', 'normal-v2'] as const)('retains an explicit %s unavailable state', modelVersion => {
    const source = matchup();
    source.winProbability = { modelVersion, status: 'unavailable', reason: 'missing-projection' };
    expect(matchupWinChance(source).status).toBe('unavailable');
  });

  it('rounds a complementary pair once and keeps probabilities attached to team identities when sides swap', () => {
    const source = matchup();
    const original = JSON.stringify(source);
    expect(matchupWinChance(source).values).toEqual(['51%', '49%']);
    expect(matchupWinChance(matchupWithTeamOnLeft(source, 2)).values).toEqual(['49%', '51%']);
    expect(JSON.stringify(source)).toBe(original);
  });

  it.each([0, 0.00001, 0.0099])('shows nonfinal probability %s as small tails rather than a certain outcome', probability => {
    const display = matchupWinChance(matchup(probability));
    expect(display.values).toEqual(['<1%', '>99%']);
    expect(display.description).toContain('Fixture Alpha less than 1%; Fixture Beta greater than 99%');
  });

  it.each([0.01, 0.5, 0.99])('uses whole percentages at the normal boundaries: %s', probability => {
    expect(matchupWinChance(matchup(probability)).values).toEqual([`${Math.round(probability * 100)}%`, `${100 - Math.round(probability * 100)}%`]);
  });

  it.each(['live', 'upcoming', 'unknown'] as const)('does not reconstruct %s estimates from scores or public projections', status => {
    const source = matchup();
    source.status = status;
    delete source.winProbability;
    source.sides[0].points = 150;
    source.sides[0].projectedPoints = 200;
    source.sides[1].points = 0;
    source.sides[1].projectedPoints = 1;
    expect(matchupWinChance(source)).toMatchObject({ status: 'unavailable', values: ['—', '—'] });
  });

  it('retains an explicit unavailable result even with apparently usable projections', () => {
    const source = matchup();
    source.winProbability = { modelVersion: 'normal-v1', status: 'unavailable', reason: 'missing-baseline' };
    expect(matchupWinChance(source).status).toBe('unavailable');
  });

  it.each([0, -12.5])('derives a legacy final result from finite official scores, including %s', points => {
    const source = matchup(0.01);
    delete source.winProbability;
    source.status = 'final';
    source.sides[0].points = points;
    source.sides[1].points = points - 1;
    expect(matchupWinChance(source)).toMatchObject({ status: 'final', values: ['100%', '0%'] });
    expect(matchupWinChance(matchupWithTeamOnLeft(source, 2)).values).toEqual(['0%', '100%']);
  });

  it('reports a final tie without inventing a 50% chance for either team', () => {
    const source = matchup();
    source.status = 'final';
    expect(matchupWinChance(source)).toEqual({ status: 'tie', label: 'Final', values: ['Tie', 'Tie'], description: 'Final result: tied.' });
  });

  it.each([null, Number.NaN, Number.POSITIVE_INFINITY])('requires both final official scores; invalid score %s remains unavailable', points => {
    const source = matchup();
    source.status = 'final';
    source.sides[1].points = points;
    expect(matchupWinChance(source).status).toBe('unavailable');
  });

  it('does not award a certain win when the opponent is missing', () => {
    const source = matchup();
    source.status = 'final';
    source.sides.pop();
    expect(matchupWinChance(source).status).toBe('unavailable');
  });

  it('rejects conflicting identity or probability metadata instead of showing it under another team', () => {
    const source = matchup();
    for (const teams of [
      [{ teamId: 1, probability: 0.3 }, { teamId: 1, probability: 0.7 }],
      [{ teamId: 1, probability: 0.3 }, { teamId: 3, probability: 0.7 }],
      [{ teamId: 1, probability: 0.3 }, { teamId: 2, probability: 0.8 }],
      [{ teamId: 1, probability: -0.3 }, { teamId: 2, probability: 1.3 }],
    ] as const) {
      source.winProbability = { modelVersion: 'normal-v1', status: 'estimated', teams };
      expect(matchupWinChance(source).status).toBe('unavailable');
    }
  });
});
