import type { StandingsTeam } from '../lib/types';

export type StandingsViewName = 'standings' | 'waivers' | 'transactions' | 'rosters';
export type StandingsTableViewName = Exclude<StandingsViewName, 'transactions' | 'rosters'>;
export type StandingsSortKey = 'rank' | 'team' | 'record' | 'pointsFor' | 'pointsAgainst' | 'waiverOrder' | 'waiverBudget';
export type SortDirection = 'ascending' | 'descending';

export interface RankedStandingsTeam extends StandingsTeam {
  rank: number;
}

export interface StandingsSort {
  key: StandingsSortKey;
  direction: SortDirection;
}

const ascendingFirst = new Set<StandingsSortKey>(['rank', 'team', 'waiverOrder']);

export function rankStandingsTeams(teams: StandingsTeam[]): RankedStandingsTeam[] {
  return teams.map((team, index) => ({ ...team, rank: index + 1 }));
}

export function nextStandingsSort(current: StandingsSort | null, key: StandingsSortKey): StandingsSort {
  if (current?.key === key) {
    return { key, direction: current.direction === 'ascending' ? 'descending' : 'ascending' };
  }
  return { key, direction: ascendingFirst.has(key) ? 'ascending' : 'descending' };
}

function compareRecord(a: RankedStandingsTeam, b: RankedStandingsTeam): number {
  return a.wins - b.wins || b.losses - a.losses || a.ties - b.ties;
}

function compareNullable(a: number | null, b: number | null, direction: SortDirection): number {
  if (a === null) return b === null ? 0 : 1;
  if (b === null) return -1;
  const comparison = a - b;
  return direction === 'ascending' ? comparison : -comparison;
}

export function sortStandingsTeams(
  teams: RankedStandingsTeam[],
  sort: StandingsSort | null,
): RankedStandingsTeam[] {
  if (!sort) return [...teams].sort((a, b) => a.rank - b.rank);
  return [...teams].sort((a, b) => {
    let comparison = 0;
    switch (sort.key) {
      case 'rank':
        comparison = sort.direction === 'ascending' ? a.rank - b.rank : b.rank - a.rank;
        break;
      case 'team': {
        const alphabetical = a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
        comparison = sort.direction === 'ascending' ? alphabetical : -alphabetical;
        break;
      }
      case 'record': {
        const record = compareRecord(a, b);
        comparison = sort.direction === 'ascending' ? record : -record;
        break;
      }
      case 'pointsFor':
        comparison = compareNullable(a.pointsFor, b.pointsFor, sort.direction);
        break;
      case 'pointsAgainst':
        comparison = compareNullable(a.pointsAgainst, b.pointsAgainst, sort.direction);
        break;
      case 'waiverOrder':
        comparison = compareNullable(a.waiverOrder, b.waiverOrder, sort.direction);
        break;
      case 'waiverBudget':
        comparison = compareNullable(a.waiverBudgetRemaining, b.waiverBudgetRemaining, sort.direction);
        break;
    }
    return comparison || a.rank - b.rank;
  });
}
