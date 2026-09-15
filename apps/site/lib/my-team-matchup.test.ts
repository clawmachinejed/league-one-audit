import { describe, expect, it } from 'vitest';
import { matchupWithTeamOnLeft, selectMyTeamMatchup } from './my-team-matchup';
import type { Matchup, MatchupSide, Team } from './types';

function team(id: number, name: string, values: Partial<Team> = {}): Team {
  return { id, name, managerName: name, avatar: null, wins: 1, losses: 0, ties: 0,
    pointsFor: 100, pointsAgainst: 80, ...values };
}
const alpha = team(1, 'Alpha');
const bravo = team(2, 'Bravo', { pointsFor: 150 });
const charlie = team(3, 'Charlie');
function side(team: Team, points: number | null = 0): MatchupSide {
  return { team, points, projectedPoints: points === null ? null : 120, starters: [] };
}
const matchup: Matchup = { id: 'one', status: 'live', sides: [side(alpha, 12), side(bravo, null)] };

describe('My Team matchup display selection', () => {
  it.each([null, 999, alpha.id])('preserves the source side order when %s needs no reorientation', selected => {
    expect(matchupWithTeamOnLeft(matchup, selected)).toBe(matchup);
  });

  it('honors the saved team and moves its intact side left without changing source order or scores', () => {
    const original = JSON.stringify(matchup);
    const result = selectMyTeamMatchup([alpha, bravo], [matchup], bravo.id);
    expect(result.team).toBe(bravo);
    expect(result.matchup?.sides).toEqual([matchup.sides[1], matchup.sides[0]]);
    expect(result.matchup?.sides[0]).toBe(matchup.sides[1]);
    expect(result.matchup?.sides[0].points).toBeNull();
    expect(JSON.stringify(matchup)).toBe(original);
  });

  it.each([null, 999])('uses official first place with %s as an absent or stale preference', selected => {
    expect(selectMyTeamMatchup([alpha, bravo], [matchup], selected).team).toBe(bravo);
  });

  it('uses the official standings tiebreakers before alphabetical team name and roster ID', () => {
    const leader = team(4, 'Zulu', { pointsAgainst: 90 });
    expect(selectMyTeamMatchup([charlie, alpha, leader], [], null).team).toBe(leader);
    expect(selectMyTeamMatchup([charlie, alpha], [], null).team).toBe(alpha);
    const duplicateName = team(5, 'Alpha');
    expect(selectMyTeamMatchup([duplicateName, alpha], [], null).team).toBe(alpha);
  });

  it('does not substitute another matchup when the selected team has none posted', () => {
    expect(selectMyTeamMatchup([alpha, bravo, charlie], [matchup], charlie.id))
      .toEqual({ team: charlie, matchup: null });
  });

  it('retains an unknown lineup and handles a pending opponent without inventing a side', () => {
    const pending: Matchup = { id: 'pending', status: 'unknown', sides: [side(bravo, null)] };
    expect(selectMyTeamMatchup([bravo], [pending], bravo.id).matchup).toEqual(pending);
    expect(selectMyTeamMatchup([], [matchup], null)).toEqual({ team: null, matchup: null });
  });
});
