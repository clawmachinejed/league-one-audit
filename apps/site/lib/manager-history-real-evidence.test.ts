import { describe, expect, it, vi } from 'vitest';
import fixture from '../test-support/fixtures/manager-history-2025-2026.json';
import { buildManagerHistory, type ManagerHistoryEntry, type ManagerHistorySeason } from './manager-history';

vi.mock('server-only', () => ({}));

function comparable(value: ManagerHistoryEntry) {
  return { ownerId: value.ownerId, managerName: value.managerName, currentTeamId: value.currentTeamId,
    seasons: value.seasons, wins: value.wins, losses: value.losses, ties: value.ties };
}

describe('manager history independently captured public evidence', () => {
  it('pins the bounded capture and independently calculated period policy', () => {
    expect(fixture.provenance).toMatchObject({ publicProvider: 'Sleeper', sourceRequests: 60, maxConcurrency: 4,
      historicalSeason: 2025, historicalWeeks: [1, 14], currentSeason: 2026, completedCurrentWeeks: [1, 1] });
    expect(fixture.leagues.map(league => [league.leagueKey, league.expected.unionCount]))
      .toEqual([['league1', 13], ['league2', 15], ['dynasty', 10]]);
  });

  for (const league of fixture.leagues) {
    it(`${league.leagueKey}: covers every roster and pairing in exactly the allowed weeks`, () => {
      for (const season of league.seasons) {
        const expectedWeeks = season.season === 2025 ? 14 : 1;
        expect(season.externalLeagueId).toBe(season.season === 2025 ? league.previousExternalLeagueId : league.currentExternalLeagueId);
        expect(season.throughWeek).toBe(expectedWeeks);
        expect(season.rows).toHaveLength(expectedWeeks);
        const rosterIds = season.rosters.map(row => row.roster_id).sort((left, right) => left - right);
        expect(new Set(rosterIds).size).toBe(rosterIds.length);
        expect(new Set(season.rosters.map(row => row.owner_id)).size).toBe(rosterIds.length);
        expect(season.teams.map(team => team.id).sort((left, right) => left - right)).toEqual(rosterIds);
        for (const week of season.rows) {
          expect(week.map(row => row.roster_id).sort((left, right) => left - right)).toEqual(rosterIds);
          expect(week.every(row => Number.isFinite(row.points))).toBe(true);
          const matchups = new Map<number, number>();
          for (const row of week) matchups.set(row.matchup_id, (matchups.get(row.matchup_id) ?? 0) + 1);
          expect([...matchups.values()]).toEqual(Array.from({ length: rosterIds.length / 2 }, () => 2));
        }
      }
    });

    it(`${league.leagueKey}: matches every independent owner record and membership without a source request`, () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(() => { throw new Error('Evidence regression must stay offline.'); });
      try {
        const seasons: ManagerHistorySeason[] = league.seasons.map(season => ({ ...season,
          teams: season.teams.map(team => ({ ...team, name: '', avatar: null,
            wins: 0, losses: 0, ties: 0, pointsFor: 0, pointsAgainst: 0 })),
        }));
        const result = buildManagerHistory(seasons, 2026);
        expect(result.warning).toBeUndefined();
        expect(result.managers).toHaveLength(league.expected.unionCount);
        const byOwner = (left: { ownerId: string }, right: { ownerId: string }) => left.ownerId.localeCompare(right.ownerId);
        expect(result.managers.map(comparable).sort(byOwner)).toEqual([...league.expected.managers].sort(byOwner));
        const expectedPairs = league.seasons.reduce((sum, season) => sum + season.throughWeek * season.rosters.length / 2, 0);
        expect(result.managers.reduce((sum, manager) => sum + manager.wins!, 0)).toBe(expectedPairs);
        expect(result.managers.reduce((sum, manager) => sum + manager.losses!, 0)).toBe(expectedPairs);
        expect(result.managers.every(manager => manager.ties === 0)).toBe(true);
        expect(fetchSpy).not.toHaveBeenCalled();
      } finally {
        fetchSpy.mockRestore();
      }
    });
  }

  it('preserves the evidenced League Two co-owner relationship without silently extending the 2026 correction', () => {
    const league = fixture.leagues.find(value => value.leagueKey === 'league2')!;
    for (const season of league.seasons) {
      expect(season.rosters.find(roster => roster.roster_id === 1)).toEqual({
        roster_id: 1, owner_id: '95628446075863040', co_owners: ['862177751849877504'],
      });
    }
    expect(league.expected.managers.find(manager => manager.ownerId === '95628446075863040')).toMatchObject({
      managerName: 'eneerg', currentTeamId: null, seasons: [2025], wins: 8, losses: 6, ties: 0,
    });
    expect(league.expected.managers.find(manager => manager.ownerId === '862177751849877504')).toMatchObject({
      managerName: 'tylerawildman', currentTeamId: 1, seasons: [2026], wins: 1, losses: 0, ties: 0,
    });
  });
});
