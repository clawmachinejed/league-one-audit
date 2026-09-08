import { describe, expect, it } from 'vitest';
import type { RosterTeam } from './types';
import { calculatePlayerPpg, calculateTeamPpg, orderRosterTeams, rosterHistoryBoundary } from './roster-metrics';
import type { PlayerCatalog, SleeperMatchup } from './transform';

function row(rosterId: number, points: number | null, playersPoints: Record<string, number | null>): SleeperMatchup {
  return { roster_id: rosterId, matchup_id: rosterId, points, players_points: playersPoints };
}

function team(id: number, name: string, standingsRank: number | null, averagePpg = 10): RosterTeam {
  return {
    id, name, managerName: name, avatar: null, wins: 1, losses: 0, ties: 0,
    pointsFor: 10, pointsAgainst: 5, waiverOrder: null, waiverBudgetRemaining: null,
    standingsRank, averagePpg, averagePpgRank: standingsRank, sections: [],
  };
}

describe('roster history boundary', () => {
  it('stops historical, current, and future calculations before later-week results', () => {
    expect(rosterHistoryBoundary({ selectedWeek: 2, currentWeek: 5, activeWeek: 5, lastScoredWeek: 4, lifecycle: 'active' })).toBe(2);
    expect(rosterHistoryBoundary({ selectedWeek: 5, currentWeek: 5, activeWeek: 5, lastScoredWeek: 4, lifecycle: 'active' })).toBe(4);
    expect(rosterHistoryBoundary({ selectedWeek: 18, currentWeek: 5, activeWeek: 5, lastScoredWeek: 4, lifecycle: 'active' })).toBe(4);
    expect(rosterHistoryBoundary({ selectedWeek: 7, currentWeek: 1, activeWeek: null, lastScoredWeek: null, lifecycle: 'preseason' })).toBe(0);
  });
});

describe('official roster PPG metrics', () => {
  const catalog: PlayerCatalog = {
    qb1: { position: 'QB' }, qb2: { position: 'QB' }, rb1: { position: 'RB' }, unknown: {},
  };
  const history = [
    [row(1, 0, { qb1: 0, rb1: 5, unknown: 20 }), row(2, 20, { qb2: 12 })],
    [row(1, 10, { qb1: 20, rb1: 5 }), row(2, null, { qb2: 8 })],
  ];

  it('averages official weekly team totals, retains zero, and omits unavailable values', () => {
    const metrics = calculateTeamPpg(history);
    expect(metrics.get(1)).toEqual({ ppg: 5, rank: 2 });
    expect(metrics.get(2)).toEqual({ ppg: 20, rank: 1 });
    expect(metrics.has(3)).toBe(false);
  });

  it('ranks player averages only against position peers and never converts missing data to zero', () => {
    const metrics = calculatePlayerPpg(history, catalog);
    expect(metrics.get('qb1')).toEqual({ ppg: 10, positionRank: 1 });
    expect(metrics.get('qb2')).toEqual({ ppg: 10, positionRank: 1 });
    expect(metrics.get('rb1')).toEqual({ ppg: 5, positionRank: 1 });
    expect(metrics.has('unknown')).toBe(false);
  });
});

describe('roster team order', () => {
  it('puts My Team first without changing its standings rank', () => {
    const ordered = orderRosterTeams([team(1, 'Alpha', 1), team(2, 'Beta', 2), team(3, 'Gamma', 3)], 3);
    expect(ordered.map(value => value.id)).toEqual([3, 1, 2]);
    expect(ordered[0].standingsRank).toBe(3);
  });

  it('uses alphabetical fallback only when the standings order is incomplete', () => {
    expect(orderRosterTeams([team(1, 'Zulu', null), team(2, 'Alpha', null), team(3, 'Beta', null)], null)
      .map(value => value.name)).toEqual(['Alpha', 'Beta', 'Zulu']);
  });
});
