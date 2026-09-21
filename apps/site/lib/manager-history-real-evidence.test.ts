import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import fixture from '../test-support/fixtures/manager-history-2025-2026.json';
import leagueOne2024 from '../test-support/fixtures/manager-history-league-one-2024.json';
import { buildManagerHistory, type ManagerHistoryEntry, type ManagerHistorySeason } from './manager-history';
import type { LeagueKey } from './leagues';

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
      .toEqual([['league1', 13], ['league2', 14], ['dynasty', 10]]);
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
        const result = buildManagerHistory(seasons, 2026, league.leagueKey as LeagueKey);
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

  it('preserves raw League Two ownership while applying the approved co-owner attribution in both seasons', () => {
    const league = fixture.leagues.find(value => value.leagueKey === 'league2')!;
    for (const season of league.seasons) {
      expect(season.rosters.find(roster => roster.roster_id === 1)).toEqual({
        roster_id: 1, owner_id: '95628446075863040', co_owners: ['862177751849877504'],
      });
    }
    expect(league.expected.managers.find(manager => manager.ownerId === '95628446075863040')).toBeUndefined();
    expect(league.expected.managers.find(manager => manager.ownerId === '862177751849877504')).toMatchObject({
      managerName: 'tylerawildman', currentTeamId: 1, seasons: [2025, 2026], wins: 8 + 1, losses: 6 + 0, ties: 0,
    });
    // The independent oracle produced 8–6 for the 2025 roster and 1–0 for 2026.
    // The confirmed attribution changes their owner, not either game's outcome.
  });
});

describe('League One 2024 manager history from saved official evidence', () => {
  const leagueOne = fixture.leagues.find(league => league.leagueKey === 'league1')!;
  const byOwner = (left: { ownerId: string }, right: { ownerId: string }) => left.ownerId.localeCompare(right.ownerId);
  const seasons = (): ManagerHistorySeason[] => [leagueOne2024.season, ...leagueOne.seasons].map(season => ({ ...season,
    teams: season.teams.map(team => ({ ...team, name: '', avatar: null,
      wins: 0, losses: 0, ties: 0, pointsFor: 0, pointsAgainst: 0 })),
  }));

  it('retains exactly fourteen complete weeks, with source fingerprints and no playoff scores', () => {
    expect(leagueOne2024.provenance).toMatchObject({ publicProvider: 'Sleeper', season: 2024,
      sourceLeagueId: '1118614856996909056', sourceDocumentCount: 44, sourceRequestsInSavedCapture: 47,
      fixtureGenerationRequests: 0, currentSeason: 2026, completedCurrentWeeks: [1, 1],
      includedMatchupWeeks: Array.from({ length: 14 }, (_, index) => index + 1),
      excludedMatchupWeeks: [15, 16, 17, 18],
    });
    expect(leagueOne2024.provenance.sourceDocumentsSha256).toMatch(/^[a-f0-9]{64}$/u);
    const existingText = readFileSync(new URL('../test-support/fixtures/manager-history-2025-2026.json', import.meta.url), 'utf8');
    expect(createHash('sha256').update(existingText.replace(/\r\n/g, '\n')).digest('hex'))
      .toBe(leagueOne2024.provenance.existingCombinedFixtureLfSha256);
    const source = leagueOne2024.season;
    expect(source.throughWeek).toBe(14);
    expect(source.rows).toHaveLength(14);
    expect(source.rosters).toHaveLength(12);
    expect(new Set(source.rosters.map(roster => roster.owner_id)).size).toBe(12);
    const rosterIds = source.rosters.map(roster => roster.roster_id).sort((left, right) => left - right);
    expect(source.teams.map(team => team.id)).toEqual(rosterIds);
    for (const week of source.rows) {
      expect(week.map(row => row.roster_id)).toEqual(rosterIds);
      expect(week.every(row => Number.isFinite(row.points))).toBe(true);
      const pairCounts = new Map<number, number>();
      for (const row of week) pairCounts.set(row.matchup_id, (pairCounts.get(row.matchup_id) ?? 0) + 1);
      expect([...pairCounts.values()]).toEqual([2, 2, 2, 2, 2, 2]);
    }
    expect(leagueOne2024.expected.season2024Managers.every(manager => manager.wins + manager.losses + manager.ties === 14)).toBe(true);
    expect(leagueOne2024.expected.season2024Managers.reduce((sum, manager) => sum + manager.wins, 0)).toBe(84);
  });

  it('matches every independently calculated 2024–2026 owner record with no provider call', () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(() => { throw new Error('Saved-evidence regression must stay offline.'); });
    try {
      const result = buildManagerHistory(seasons(), 2026, 'league1');
      expect(result.warning).toBeUndefined();
      expect(result.managers).toHaveLength(14);
      expect(result.managers.map(comparable).sort(byOwner))
        .toEqual([...leagueOne2024.expected.combinedManagers].sort(byOwner));
      expect(result.managers.reduce((sum, manager) => sum + manager.wins!, 0)).toBe(174);
      expect(result.managers.reduce((sum, manager) => sum + manager.losses!, 0)).toBe(174);
      expect(result.managers.every(manager => manager.ties === 0)).toBe(true);
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally { fetchSpy.mockRestore(); }
  });

  it('adds the 2024-only owner without combining records for different owners of roster eleven', () => {
    expect(leagueOne2024.expected.addedOwnerIds).toEqual(['1119002178124910592']);
    expect(leagueOne2024.season.rosters.find(roster => roster.roster_id === 11)?.owner_id).toBe('1119002178124910592');
    expect(leagueOne.seasons.find(season => season.season === 2025)?.rosters.find(roster => roster.roster_id === 11)?.owner_id)
      .toBe('1119007388759166976');
    const result = buildManagerHistory(seasons(), 2026, 'league1');
    expect(result.managers.find(manager => manager.ownerId === '1119002178124910592')).toMatchObject({
      managerName: 'mentalmenagerie', currentTeamId: null, seasons: [2024], wins: 2, losses: 12, ties: 0,
    });
    expect(result.managers.find(manager => manager.ownerId === '1119007388759166976')).toMatchObject({
      managerName: 'evleath', currentTeamId: 11, seasons: [2025, 2026], wins: 10, losses: 5, ties: 0,
    });
    expect(result.managers.filter(manager => manager.currentTeamId === null).map(manager => manager.managerName).sort())
      .toEqual(['mentalmenagerie', 'tbaute69']);
  });

  it('keeps the current name for the same owner when a historical display name differs', () => {
    // Synthetic name perturbation layered on real roster/account evidence;
    // the source fixture itself remains an unchanged sanitized capture.
    const inputs = seasons().reverse().map(season => season.season === 2024 ? { ...season,
      teams: season.teams.map(team => ({ ...team, managerName: `Older ${team.managerName}` })),
    } : season);
    const result = buildManagerHistory(inputs, 2026, 'league1');
    expect(result.warning).toBeUndefined();
    expect(result.managers.filter(manager => manager.currentTeamId !== null).map(comparable).sort(byOwner))
      .toEqual(leagueOne2024.expected.combinedManagers.filter(manager => manager.currentTeamId !== null).sort(byOwner));
  });

  it('cannot count appended postseason rows when an upstream season advertises more than fourteen weeks', () => {
    // Deliberately synthetic sentinel scores: these must never affect the
    // independently computed official regular-season records above.
    const inputs = seasons().map(season => season.season === 2024 ? { ...season, throughWeek: 18,
      rows: [...season.rows, ...Array.from({ length: 4 }, () => leagueOne2024.season.rows[0]
        .map(row => ({ ...row, points: row.roster_id * 1000 })))],
    } : season);
    const result = buildManagerHistory(inputs, 2026, 'league1');
    expect(result.warning).toBeUndefined();
    expect(result.managers.map(comparable).sort(byOwner))
      .toEqual([...leagueOne2024.expected.combinedManagers].sort(byOwner));
  });
});
