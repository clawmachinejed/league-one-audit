import { describe, expect, it } from 'vitest';
import type { RosterTeam } from './types';
import { calculateTeamPpg, compareRosterStandings, orderRosterTeams, rosterHistoryBoundary } from './roster-metrics';
import type { SleeperMatchup } from './transform';

function row(rosterId: number, points: number | null): SleeperMatchup {
  return { roster_id: rosterId, matchup_id: rosterId, points };
}

function team(id: number, name: string, standingsRank: number | null): RosterTeam {
  return {
    id, name, managerName: name, avatar: null, wins: 1, losses: 0, ties: 0,
    pointsFor: 10, waiverOrder: null, waiverBudgetRemaining: null,
    standingsRank, averagePpg: 10, averagePpgRank: standingsRank,
    rosterAvailable: true, sections: [],
  };
}

describe('roster history boundary', () => {
  it('stops historical, current, and future calculations before later-week results', () => {
    expect(rosterHistoryBoundary({ selectedWeek: 2, activeWeek: 5, lastScoredWeek: 4, lifecycle: 'active' })).toBe(2);
    expect(rosterHistoryBoundary({ selectedWeek: 5, activeWeek: 5, lastScoredWeek: 4, lifecycle: 'active' })).toBe(4);
    expect(rosterHistoryBoundary({ selectedWeek: 18, activeWeek: 5, lastScoredWeek: 4, lifecycle: 'active' })).toBe(4);
  });

  it('uses last_scored_leg for completed leagues and refuses an unproved boundary', () => {
    expect(rosterHistoryBoundary({ selectedWeek: 18, activeWeek: null, lastScoredWeek: 17, lifecycle: 'complete' })).toBe(17);
    expect(rosterHistoryBoundary({ selectedWeek: 18, activeWeek: null, lastScoredWeek: null, lifecycle: 'complete' })).toBeNull();
    expect(rosterHistoryBoundary({ selectedWeek: 7, activeWeek: null, lastScoredWeek: null, lifecycle: 'preseason' })).toBe(0);
  });
});

describe('official team averages', () => {
  it('counts zero and ranks complete official history', () => {
    const metrics = calculateTeamPpg([
      [row(1, 0), row(2, 20)],
      [row(1, 10), row(2, 10)],
    ], 2, [1, 2]);
    expect(metrics.get(1)).toEqual({ ppg: 5, rank: 2 });
    expect(metrics.get(2)).toEqual({ ppg: 15, rank: 1 });
  });

  it('does not create a partial-looking average when a required week is absent', () => {
    expect(calculateTeamPpg([[row(1, 12)], null], 2, [1]).has(1)).toBe(false);
  });

  it('isolates malformed team rows and withholds unprovable league-wide ranks', () => {
    const metrics = calculateTeamPpg([
      [row(1, 10), row(2, 20)],
      [row(1, 14), row(2, null)],
    ], 2, [1, 2]);
    expect(metrics.get(1)).toEqual({ ppg: 12, rank: null });
    expect(metrics.has(2)).toBe(false);
  });

  it('preserves exact hundredth-point ties across differently composed weekly totals', () => {
    const metrics = calculateTeamPpg([
      [row(1, 10.1), row(2, 10.15)],
      [row(1, 10.2), row(2, 10.15)],
    ], 2, [1, 2]);
    expect(metrics.get(1)).toEqual({ ppg: 10.15, rank: 1 });
    expect(metrics.get(2)).toEqual({ ppg: 10.15, rank: 1 });
  });
});

describe('roster team order', () => {
  it('orders standings by winning percentage, Points For, name, then roster ID', () => {
    const candidates = [
      { id: 4, name: 'Same', wins: 4, losses: 4, ties: 2, pointsFor: 110 },
      { id: 3, name: 'Same', wins: 4, losses: 4, ties: 2, pointsFor: 110 },
      { id: 2, name: 'Zulu', wins: 5, losses: 5, ties: 0, pointsFor: 100 },
      { id: 1, name: 'Alpha', wins: 6, losses: 4, ties: 0, pointsFor: 90 },
    ];
    expect(candidates.sort(compareRosterStandings).map((value) => value.id)).toEqual([1, 3, 4, 2]);
  });

  it('puts My Team first without changing either rank', () => {
    const ordered = orderRosterTeams([team(1, 'Alpha', 1), team(2, 'Beta', 2), team(3, 'Gamma', 3)], 3);
    expect(ordered.map((value) => value.id)).toEqual([3, 1, 2]);
    expect(ordered[0]).toMatchObject({ standingsRank: 3, averagePpgRank: 3 });
  });

  it('uses alphabetical fallback only when standings are incomplete', () => {
    expect(orderRosterTeams([team(1, 'Zulu', null), team(2, 'Alpha', null), team(3, 'Beta', null)], null)
      .map((value) => value.name)).toEqual(['Alpha', 'Beta', 'Zulu']);
  });
});
