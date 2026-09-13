import { beforeEach, describe, expect, it, vi } from 'vitest';

const getRostersWithMetricContext = vi.hoisted(() => vi.fn());
vi.mock('server-only', () => ({}));
vi.mock('./sleeper', () => ({ getRostersWithMetricContext }));

import { LEAGUE_IDS } from './config';
import { handleLeagueRostersRequest } from './league-rosters-http';
import type { StoredAllPlayerMetricRead } from './projection-store';
import type { RostersLoad } from './sleeper';
import type { RosterPlayer, RostersData } from './types';

function player(id: string, name: string): RosterPlayer {
  return {
    id, name, position: 'WR', nflTeam: 'PHI', injuryStatus: null, game: null,
    slot: 'WR', byeWeek: 9, positionRank: null, ppg: null,
  };
}

function load(): RostersLoad {
  const data: RostersData = {
    league: { season: '2026', rosterPositions: ['WR'], week: 1, maxWeek: 18 },
    week: 1, currentWeek: 1, rostersAvailable: true,
    playerMetrics: { status: 'unavailable', observedAt: null, throughWeek: null },
    updatedAt: '2026-09-12T03:30:00.000Z',
    teams: [{
      id: 1, name: 'Current roster', managerName: 'Manager', avatar: null,
      wins: 0, losses: 0, ties: 0, pointsFor: 0,
      waiverOrder: null, waiverBudgetRemaining: null, standingsRank: null,
      averagePpg: null, averagePpgRank: null, rosterAvailable: true,
      sections: [{ name: 'Starters', players: [
        player('5859', 'A.J. Brown'), player('7527', 'Mac Jones'),
        player('12529', 'TreVeyon Henderson'), player('not-played', 'Not Played'),
      ] }],
    }],
  };
  return {
    data,
    metricContext: { season: 2026, seasonType: 'reg', throughWeek: 1, provisionalWeek: 1 },
  };
}

function metrics(): StoredAllPlayerMetricRead {
  return {
    status: 'provisional', observedAt: '2026-09-12T03:30:00.000Z', throughWeek: 1,
    rowsRead: 87,
    metrics: [{
      scoringProfileId: 'profile', scoringEntityId: 'brown', providerExternalId: '5859',
      entityKind: 'player', position: 'WR', totalFantasyPoints: 4.1,
      appearanceGameCount: 1, publishedWeekCount: 0, pointsPerGame: 4.1, positionRank: 1,
    }],
  };
}

describe('league rosters HTTP boundary', () => {
  beforeEach(() => getRostersWithMetricContext.mockReset());

  it('maps one league/week request through the canonical registry and decorates players server-side', async () => {
    getRostersWithMetricContext.mockResolvedValue(load());
    const readMetrics = vi.fn().mockResolvedValue(metrics());
    const response = await handleLeagueRostersRequest(
      new Request('https://example.test/api/rosters/league2?week=1'),
      'league2', getRostersWithMetricContext, readMetrics,
    );
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(getRostersWithMetricContext).toHaveBeenCalledWith(LEAGUE_IDS.league2, 1);
    expect(readMetrics).toHaveBeenCalledOnce();
    expect(readMetrics).toHaveBeenCalledWith({
      leagueKey: 'league2', season: 2026, throughWeek: 1, provisionalWeek: 1,
    });
    const body = await response.json() as RostersData;
    expect(body.playerMetrics).toEqual({
      status: 'provisional', observedAt: '2026-09-12T03:30:00.000Z', throughWeek: 1,
    });
    expect(body.teams[0].sections[0].players.map(({ name, positionRank, ppg }) => (
      { name, positionRank, ppg }
    ))).toEqual([
      { name: 'A.J. Brown', positionRank: 1, ppg: 4.1 },
      { name: 'Mac Jones', positionRank: null, ppg: null },
      { name: 'TreVeyon Henderson', positionRank: null, ppg: null },
      { name: 'Not Played', positionRank: null, ppg: null },
    ]);
    expect(JSON.stringify(body)).not.toContain('rowsRead');
  });

  it('leaves the Rosters response usable when the metric reader is unavailable', async () => {
    getRostersWithMetricContext.mockResolvedValue(load());
    const response = await handleLeagueRostersRequest(
      new Request('https://example.test/api/rosters/league1?week=1'),
      'league1', getRostersWithMetricContext, async () => { throw new Error('database unavailable'); },
    );
    expect(response.status).toBe(200);
    const body = await response.json() as RostersData;
    expect(body.rostersAvailable).toBe(true);
    expect(body.playerMetrics.status).toBe('unavailable');
    expect(body.teams[0].sections[0].players.every((value) => value.ppg === null)).toBe(true);
  });

  it('does not read metrics when no scoring-period boundary can be proved', async () => {
    const unavailable = load();
    getRostersWithMetricContext.mockResolvedValue({
      ...unavailable,
      metricContext: { ...unavailable.metricContext, throughWeek: null, provisionalWeek: null },
    });
    const readMetrics = vi.fn();
    const response = await handleLeagueRostersRequest(
      new Request('https://example.test/api/rosters/league1?week=1'),
      'league1', getRostersWithMetricContext, readMetrics,
    );
    expect(response.status).toBe(200);
    expect(readMetrics).not.toHaveBeenCalled();
  });

  it.each(['', '0', '19', '1.5', 'abc', '2<script>'])('rejects malformed week %s without provider work', async (week) => {
    const response = await handleLeagueRostersRequest(
      new Request(`https://example.test/api/rosters/league1?week=${encodeURIComponent(week)}`), 'league1',
    );
    expect(response.status).toBe(400);
    expect(getRostersWithMetricContext).not.toHaveBeenCalled();
  });

  it('rejects arbitrary league identifiers without provider work', async () => {
    const response = await handleLeagueRostersRequest(
      new Request('https://example.test/api/rosters/raw-id?week=1'), 'raw-id',
    );
    expect(response.status).toBe(404);
    expect(getRostersWithMetricContext).not.toHaveBeenCalled();
  });

  it('returns a bounded error when the roster provider itself fails', async () => {
    const response = await handleLeagueRostersRequest(
      new Request('https://example.test/api/rosters/league1?week=1'), 'league1',
      async () => { throw new Error('secret provider detail'); },
    );
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: 'League rosters are temporarily unavailable. Please try again.' });
  });
});
