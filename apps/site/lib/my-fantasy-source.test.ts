import { beforeEach, describe, expect, it, vi } from 'vitest';
import { LEAGUE_IDS } from './config';
import { LEAGUE_SITES, type LeagueKey } from './leagues';
import type { MatchupPeriodContext } from './matchup-period';
import type { MatchupsData, StandingsData } from './types';

vi.mock('server-only', () => ({}));

const mocks = vi.hoisted(() => ({
  resolveCurrentLeagueId: vi.fn(),
  readStoredMatchups: vi.fn(),
  getSiteWeekRollover: vi.fn(),
  getCurrentStandings: vi.fn(),
  getCurrentMatchupPeriodContext: vi.fn(),
  getOfficialMatchups: vi.fn(),
  getStandings: vi.fn(),
  getManagerHonors: vi.fn(),
}));

vi.mock('./league-administration/registry', () => ({ resolveCurrentLeagueId: mocks.resolveCurrentLeagueId }));
vi.mock('./projection-reader', () => ({ readStoredMatchups: mocks.readStoredMatchups }));
vi.mock('./sleeper', () => ({
  getSiteWeekRollover: mocks.getSiteWeekRollover,
  getCurrentStandings: mocks.getCurrentStandings,
  getCurrentMatchupPeriodContext: mocks.getCurrentMatchupPeriodContext,
  getOfficialMatchups: mocks.getOfficialMatchups,
  getStandings: mocks.getStandings,
  getManagerHonors: mocks.getManagerHonors,
}));

import { loadMyFantasyLeagues } from './my-fantasy-source';

const currentIds: Record<LeagueKey, string> = {
  league1: 'current-league1', league2: 'current-league2', dynasty: 'current-dynasty',
};
const context: MatchupPeriodContext = {
  defaultSeason: 2026, defaultWeek: 3, activeSeason: 2026, activeWeek: 3,
  lifecycle: 'active', nflPhase: 'regular', temporalState: 'active', refreshDue: false,
};
const verifiedAt = '2026-09-22T16:00:00.000Z';

function matchups(key: LeagueKey, week = 3): MatchupsData {
  return {
    league: { season: '2026', rosterPositions: ['QB'], week, maxWeek: 18 },
    teams: [{ id: 1, name: `${key} Team`, managerName: `${key} Owner`, avatar: null,
      wins: 1, losses: 1, ties: 0, pointsFor: 20, pointsAgainst: 20 }],
    updatedAt: verifiedAt, week, matchups: [],
  };
}

function stored(key: LeagueKey, week = 3, period = context) {
  return { kind: 'usable', historical: false, payload: matchups(key, week),
    context: period, snapshotRevision: key.padEnd(64, '0'), verifiedAt };
}

function standings(leagueId: string): StandingsData {
  const key = (Object.keys(currentIds) as LeagueKey[]).find(candidate => currentIds[candidate] === leagueId)!;
  const data = matchups(key);
  return { ...data, teams: data.teams.map(team => ({ ...team, waiverOrder: 1, waiverBudgetRemaining: 50 })),
    projectionBasis: { kind: 'unavailable', reason: 'Fixture baseline unavailable.' } };
}

describe('My Fantasy league source composition', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.resolveCurrentLeagueId.mockImplementation(async (bootstrapId: string) => {
      const key = (Object.keys(LEAGUE_IDS) as LeagueKey[]).find(candidate => LEAGUE_IDS[candidate] === bootstrapId)!;
      return currentIds[key];
    });
    mocks.readStoredMatchups.mockImplementation(async (key: LeagueKey) => stored(key));
    mocks.getSiteWeekRollover.mockResolvedValue({ week: 3, nextRolloverAt: null, evaluatedAt: verifiedAt });
    mocks.getCurrentStandings.mockImplementation(async (leagueId: string) => ({ leagueId, season: '2026',
      playoffTeams: 6, places: { 1: 1 } }));
    mocks.getStandings.mockImplementation(async (leagueId: string) => standings(leagueId));
    mocks.getManagerHonors.mockImplementation(async (leagueId: string) => ({ leagueId, season: '2026', managers: {} }));
  });

  it('loads only the three site leagues with resolved IDs, independent records and exact snapshot lineage', async () => {
    const result = await loadMyFantasyLeagues();

    expect(result.map(entry => entry.site)).toEqual(Object.values(LEAGUE_SITES));
    expect(mocks.resolveCurrentLeagueId.mock.calls).toEqual(Object.values(LEAGUE_IDS).map(id => [id]));
    expect(mocks.readStoredMatchups.mock.calls).toEqual(Object.keys(LEAGUE_SITES).map(key => [key, undefined]));
    for (const entry of result) {
      expect(entry.status).toBe('available');
      if (entry.status !== 'available') throw new Error('Expected a supported league.');
      expect(entry.leagueId).toBe(currentIds[entry.site.key]);
      expect(entry.source).toMatchObject({ leagueId: entry.leagueId, snapshotRevision: entry.site.key.padEnd(64, '0'),
        verifiedAt, periodContext: context, standings: { leagueId: entry.leagueId } });
      expect(entry.standingsData?.teams[0].managerName).toBe(`${entry.site.key} Owner`);
      expect(entry.honors?.leagueId).toBe(entry.leagueId);
      expect(mocks.getStandings).toHaveBeenCalledWith(entry.leagueId);
      expect(mocks.getManagerHonors).toHaveBeenCalledWith(entry.leagueId);
    }
    expect(mocks.getOfficialMatchups).not.toHaveBeenCalled();
  });

  it('keeps both healthy leagues available when another registration cannot be resolved', async () => {
    mocks.resolveCurrentLeagueId.mockImplementation(async (bootstrapId: string) => {
      if (bootstrapId === LEAGUE_IDS.league2) throw new Error('Private registration error details');
      return bootstrapId === LEAGUE_IDS.league1 ? currentIds.league1 : currentIds.dynasty;
    });

    const result = await loadMyFantasyLeagues();

    expect(result.map(entry => entry.status)).toEqual(['available', 'unavailable', 'available']);
    expect(result[1]).toEqual({ status: 'unavailable', site: LEAGUE_SITES.league2 });
    expect(mocks.readStoredMatchups).not.toHaveBeenCalledWith('league2', undefined);
    expect(mocks.getStandings).toHaveBeenCalledTimes(2);
  });

  it('isolates a current matchup failure without returning an older week or suppressing peers', async () => {
    mocks.readStoredMatchups.mockImplementation(async (key: LeagueKey, week?: number) => key === 'league2'
      ? week === undefined ? stored(key, 2, { ...context, defaultWeek: 2 }) : { kind: 'missing', context }
      : stored(key));
    mocks.getOfficialMatchups.mockRejectedValue(new Error('Official Week 3 unavailable'));

    const result = await loadMyFantasyLeagues();

    expect(result.map(entry => entry.status)).toEqual(['available', 'unavailable', 'available']);
    expect(mocks.getOfficialMatchups).toHaveBeenCalledExactlyOnceWith(currentIds.league2, 3);
    expect(result[1]).toEqual({ status: 'unavailable', site: LEAGUE_SITES.league2 });
  });

  it('preserves a valid matchup when optional standings history and honors cannot load', async () => {
    mocks.getStandings.mockRejectedValue(new Error('History unavailable'));
    mocks.getManagerHonors.mockRejectedValue(new Error('Ownership unavailable'));

    const result = await loadMyFantasyLeagues();

    expect(result).toHaveLength(3);
    for (const entry of result) {
      expect(entry).toMatchObject({ status: 'available', standingsData: null, honors: null,
        source: { snapshotRevision: entry.site.key.padEnd(64, '0'), data: { week: 3 } } });
    }
    expect(mocks.getOfficialMatchups).not.toHaveBeenCalled();
  });

  it('follows the current rollover separately for each league without reusing another league’s source', async () => {
    mocks.readStoredMatchups.mockImplementation(async (key: LeagueKey, week?: number) => key === 'league1'
      ? week === undefined ? stored(key, 2, { ...context, defaultWeek: 2 }) : stored(key)
      : stored(key));

    const result = await loadMyFantasyLeagues();

    expect(mocks.readStoredMatchups).toHaveBeenCalledWith('league1', 3);
    expect(mocks.readStoredMatchups).toHaveBeenCalledTimes(4);
    for (const entry of result) {
      expect(entry).toMatchObject({ status: 'available', source: {
        leagueId: currentIds[entry.site.key], data: { week: 3, teams: [{ name: `${entry.site.key} Team` }] },
      } });
    }
    expect(mocks.getOfficialMatchups).not.toHaveBeenCalled();
  });
});
