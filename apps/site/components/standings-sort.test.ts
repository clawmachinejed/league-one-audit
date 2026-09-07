import { describe, expect, it } from 'vitest';
import type { StandingsTeam } from '../lib/types';
import { nextStandingsSort, rankStandingsTeams, sortStandingsTeams, type StandingsSortKey } from './standings-sort';

const teams: StandingsTeam[] = [
  { id: 11, name: 'Zulu', managerName: 'One', avatar: null, wins: 2, losses: 1, ties: 0, pointsFor: 90, pointsAgainst: 70, waiverOrder: 3, waiverBudgetRemaining: 40 },
  { id: 12, name: 'Alpha', managerName: 'Two', avatar: null, wins: 3, losses: 2, ties: 0, pointsFor: 110, pointsAgainst: null, waiverOrder: 1, waiverBudgetRemaining: 80 },
  { id: 13, name: 'Echo', managerName: 'Three', avatar: null, wins: 3, losses: 1, ties: 1, pointsFor: 110, pointsAgainst: 95, waiverOrder: null, waiverBudgetRemaining: null },
  { id: 14, name: 'Bravo', managerName: 'Four', avatar: null, wins: 3, losses: 1, ties: 0, pointsFor: 75, pointsAgainst: 95, waiverOrder: 2, waiverBudgetRemaining: 0 },
];
const ranked = rankStandingsTeams(teams);

function ids(key: StandingsSortKey, clickCount = 1) {
  let sort = null;
  for (let index = 0; index < clickCount; index += 1) sort = nextStandingsSort(sort, key);
  return sortStandingsTeams(ranked, sort).map(team => team.id);
}

describe('Standings table sorting', () => {
  it('attaches immutable official ranks and defaults both views to standings order', () => {
    expect(ranked.map(team => ({ id: team.id, rank: team.rank }))).toEqual([
      { id: 11, rank: 1 }, { id: 12, rank: 2 }, { id: 13, rank: 3 }, { id: 14, rank: 4 },
    ]);
    expect(sortStandingsTeams(ranked, null).map(team => team.id)).toEqual([11, 12, 13, 14]);
  });

  it.each([
    ['rank', [11, 12, 13, 14], [14, 13, 12, 11]],
    ['team', [12, 14, 13, 11], [11, 13, 14, 12]],
    ['record', [13, 14, 12, 11], [11, 12, 14, 13]],
    ['pointsFor', [12, 13, 11, 14], [14, 11, 12, 13]],
    ['pointsAgainst', [13, 14, 11, 12], [11, 13, 14, 12]],
    ['waiverOrder', [12, 14, 11, 13], [11, 14, 12, 13]],
    ['waiverBudget', [12, 11, 14, 13], [14, 11, 12, 13]],
  ] satisfies Array<[StandingsSortKey, number[], number[]]>)('sorts %s in both directions', (key, first, second) => {
    expect(ids(key)).toEqual(first);
    expect(ids(key, 2)).toEqual(second);
  });

  it('keeps missing values last in either direction and uses rank for equal values', () => {
    expect(ids('pointsAgainst')).toEqual([13, 14, 11, 12]);
    expect(ids('pointsAgainst', 2)).toEqual([11, 13, 14, 12]);
    expect(ids('waiverOrder').at(-1)).toBe(13);
    expect(ids('waiverOrder', 2).at(-1)).toBe(13);
    expect(ids('waiverBudget').at(-1)).toBe(13);
    expect(ids('waiverBudget', 2).at(-1)).toBe(13);
  });

  it('keeps each original rank attached after sorting', () => {
    expect(sortStandingsTeams(ranked, nextStandingsSort(null, 'team')).map(team => [team.name, team.rank])).toEqual([
      ['Alpha', 2], ['Bravo', 4], ['Echo', 3], ['Zulu', 1],
    ]);
  });
});
