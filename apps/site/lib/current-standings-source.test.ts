import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import seasonEvidence from '../test-support/fixtures/sleeper-2026-season-schedule.json';
import { LEAGUE_IDS } from './config';

const cacheState = vi.hoisted(() => ({ generation: 0 }));
vi.mock('server-only', () => ({}));
vi.mock('./league-administration/store', () => ({ getLeagueAdministrationStore: () => ({
  readSourceByConnection: async () => ({ status: 'disabled' }),
  readSource: async () => ({ status: 'disabled' }),
}) }));
vi.mock('react', () => ({ cache: <A extends unknown[], R>(fn: (...args: A) => R) => {
  const values = new Map<string, R>();
  return (...args: A): R => {
    const key = JSON.stringify([cacheState.generation, args]);
    if (values.has(key)) return values.get(key)!;
    const value = fn(...args);
    values.set(key, value);
    return value;
  };
} }));
vi.mock('next/cache', () => ({ unstable_cache: <T,>(fn: T) => fn }));
vi.mock('./site-calendar-authority', () => ({
  assertSiteCalendarNotRegressed: vi.fn().mockResolvedValue(undefined),
  getRetainedSiteCalendar: vi.fn().mockResolvedValue(null),
}));

import { getCurrentStandings, getOverview } from './sleeper';

let playoffTeams: unknown;
let incomplete: boolean;
beforeEach(() => {
  cacheState.generation += 1;
  playoffTeams = 2;
  incomplete = false;
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-09-18T00:00:00Z'));
  vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    const path = url.pathname.replace(/^\/v1/u, '');
    if (path === '/state/nfl') return Response.json({ season: '2026', season_type: 'regular', leg: 2, week: 2 });
    if (path === '/schedule/nfl/regular/2026') return Response.json(seasonEvidence.body);
    if (path === `/league/${LEAGUE_IDS.league2}`) return Response.json({
      league_id: LEAGUE_IDS.league2, name: 'League Two', season: '2026', status: 'in_season',
      total_rosters: 4, roster_positions: ['QB'], settings: { playoff_teams: playoffTeams },
    });
    if (path === `/league/${LEAGUE_IDS.league2}/rosters`) {
      // Same win percentage and PF for teams 1/2: higher PA puts team 2 ahead,
      // despite its later alphabetical name. Team 3 leads on win percentage.
      const records = [
        { wins: 1, losses: 1, fpts: 100, fpts_against: 80 },
        { wins: 1, losses: 1, fpts: 100, fpts_against: 90 },
        { wins: 2, losses: 1, fpts: 70, fpts_against: 100 },
        { wins: 1, losses: 1, fpts: 90, fpts_against: 200 },
      ];
      return Response.json(records.slice(0, incomplete ? 3 : 4).map((record, index) => ({
        roster_id: index + 1, owner_id: String(index + 1), players: [], starters: [],
        settings: { ...record, ties: 0 },
      })));
    }
    if (path === `/league/${LEAGUE_IDS.league2}/users`) return Response.json(['Alpha', 'Zulu', 'Third', 'Fourth']
      .map((name, index) => ({ user_id: String(index + 1), display_name: name })));
    throw new Error(`Unexpected standings source request: ${url.origin}${path}`);
  }));
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('current official standings metadata', () => {
  it('shares the current official Standings order and core load, including PA tiebreaks', async () => {
    const [standings, overview] = await Promise.all([
      getCurrentStandings(LEAGUE_IDS.league2), getOverview(LEAGUE_IDS.league2),
    ]);
    expect(overview.teams.map(team => team.id)).toEqual([3, 2, 1, 4]);
    expect(standings).toEqual({ leagueId: LEAGUE_IDS.league2, season: '2026', playoffTeams: 2,
      places: { 3: 1, 2: 2, 1: 3, 4: 4 } });
    const requests = vi.mocked(fetch).mock.calls.map(([url]) => String(url));
    expect(requests).toHaveLength(5); // League, state, shared NFL schedule, rosters, users.
    expect(requests.filter(url => url.endsWith('/rosters'))).toHaveLength(1);
    expect(requests.some(url => /matchups|players|scores\/nfl|tank|rapidapi/iu.test(url))).toBe(false);
  });

  it.each([0, 1, 4])('retains the source playoff cutoff %s', async cutoff => {
    playoffTeams = cutoff;
    expect((await getCurrentStandings(LEAGUE_IDS.league2)).playoffTeams).toBe(cutoff);
  });

  it.each([undefined, null, '2', -1, 1.5, 5])('does not guess an invalid or missing playoff cutoff %s', async cutoff => {
    playoffTeams = cutoff;
    expect((await getCurrentStandings(LEAGUE_IDS.league2)).playoffTeams).toBeNull();
  });

  it('refuses to assign complete league places from an incomplete official population', async () => {
    incomplete = true;
    await expect(getCurrentStandings(LEAGUE_IDS.league2)).rejects.toThrow('3 of 4 league rosters');
  });
});
