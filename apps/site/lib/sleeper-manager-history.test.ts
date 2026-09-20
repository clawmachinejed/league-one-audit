import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LEAGUE_IDS } from './config';
import seasonEvidence from '../test-support/fixtures/sleeper-2026-season-schedule.json';

const state = vi.hoisted(() => ({ generation: 0 }));
vi.mock('server-only', () => ({}));
vi.mock('./league-administration/store', () => ({ getLeagueAdministrationStore: () => ({
  readSourceByConnection: async () => ({ status: 'disabled' }),
  readSource: async () => ({ status: 'disabled' }),
}) }));
vi.mock('react', () => ({ cache: <A extends unknown[], R>(fn: (...args: A) => R) => {
  const values = new Map<string, R>();
  return (...args: A): R => {
    const key = JSON.stringify([state.generation, args]);
    if (!values.has(key)) values.set(key, fn(...args));
    return values.get(key)!;
  };
} }));
vi.mock('next/cache', () => ({ unstable_cache: <T,>(fn: T) => fn }));
vi.mock('./site-calendar-authority', () => ({
  assertSiteCalendarNotRegressed: vi.fn().mockResolvedValue(undefined),
  getRetainedSiteCalendar: vi.fn().mockResolvedValue({ week: 2, lifecycle: 'active' }),
}));
import { getManagers, getManagersHistory } from './sleeper';

let historicalStatus: string;
let historicalSeason: string;
let previousId: string | null;
let failedWeek: number | null;
let malformedWeek: number | null;
let playoffStart: number;
let median: number;
let inflight: number;
let maxInflight: number;
let coOwned: boolean;
const pastId = '1188632688331706368';

beforeEach(() => {
  state.generation++;
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-09-20T14:00:00Z'));
  historicalStatus = 'complete'; historicalSeason = '2025'; previousId = pastId;
  failedWeek = null; malformedWeek = null; playoffStart = 15; median = 0;
  inflight = 0; maxInflight = 0;
  coOwned = false;
  vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    const path = url.pathname.replace(/^\/v1/u, '');
    if (path === '/state/nfl') return Response.json({ season: '2026', season_type: 'regular', week: 2, leg: 2, display_week: 2 });
    if (path === '/schedule/nfl/regular/2026') return Response.json(seasonEvidence.body);
    const match = /^\/league\/(\d+)(?:\/(.*))?$/u.exec(path);
    if (!match) throw new Error('Unexpected provider request');
    const id = match[1]; const suffix = match[2]; const past = id === pastId;
    if (!past && !Object.values(LEAGUE_IDS).some(value => value === id)) throw new Error('Unknown league');
    if (!suffix) return Response.json({ league_id: id, name: 'League', season: past ? historicalSeason : '2026',
      status: past ? historicalStatus : 'in_season', total_rosters: 2, roster_positions: ['QB'],
      previous_league_id: past ? null : previousId,
      settings: { last_scored_leg: past ? 18 : 1, start_week: 1, best_ball: 0,
        league_average_match: median, playoff_week_start: playoffStart } });
    if (suffix === 'rosters') return Response.json([1, 2].map(roster_id => ({
      roster_id, owner_id: past ? (roster_id === 1 ? 'A' : 'B') : (roster_id === 1 ? 'C' : 'A'),
      co_owners: coOwned && roster_id === 1 ? ['862177751849877504'] : null,
      settings: { wins: 18, losses: 0, ties: 0, fpts: 900, fpts_against: 800 }, players: [], starters: [],
    })));
    if (suffix === 'users') return Response.json((past ? ['A', 'B'] : ['C', 'A']).map(user_id => ({
      user_id, display_name: user_id + (past ? ' old' : ' current'), metadata: { team_name: 'Team ' + user_id },
    })));
    if (suffix.startsWith('matchups/')) {
      const week = Number(suffix.split('/')[1]);
      inflight++; maxInflight = Math.max(maxInflight, inflight);
      await new Promise(resolve => setTimeout(resolve, 1));
      inflight--;
      if (past && week === failedWeek) return new Response(null, { status: 503 });
      return Response.json([1, 2].map(roster_id => ({
        roster_id, matchup_id: past && week === malformedWeek ? null : 1,
        points: roster_id === 1 ? 100 : 80, starters: null,
      })));
    }
    throw new Error('Unexpected administration family');
  }));
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('manager history source composition', () => {
  it.each(['league1', 'league2', 'dynasty'] as const)('preserves co-owner evidence and applies approved ownership only in %s', async key => {
    coOwned = true;
    const data = await getManagersHistory(LEAGUE_IDS[key], key);
    expect(data.history?.warning).toBeUndefined();
    const tyler = data.history?.managers.find(manager => manager.ownerId === '862177751849877504');
    if (key === 'league2') {
      expect(tyler).toMatchObject({ managerName: 'tylerawildman', seasons: [2025, 2026], wins: 15, losses: 0, currentTeamId: 1 });
      expect(data.teams.find(team => team.id === 1)?.managerName).toBe('tylerawildman');
    } else {
      expect(tyler).toBeUndefined();
      expect(data.teams.find(team => team.id === 1)?.managerName).toBe('C current');
    }
  });
  it.each(['league1', 'league2', 'dynasty'] as const)('uses prior annual links and exact completed weeks in %s without player/projection loads', async key => {
    const data = await getManagersHistory(LEAGUE_IDS[key], key);
    expect(data.history?.warning).toBeUndefined();
    expect(data.history?.managers.map(manager => [manager.managerName, manager.wins, manager.losses, manager.currentTeamId]))
      .toEqual([['A current', 14, 1, 2], ['B old', 0, 14, null], ['C current', 1, 0, 1]]);
    expect(data.teams.every(team => team.wins === 18)).toBe(true); // season tab remains unchanged
    const calls = vi.mocked(fetch).mock.calls.map(([url]) => String(url));
    expect(calls.filter(url => url.includes('/matchups/'))).toHaveLength(15);
    expect(calls.filter(url => url.includes(pastId + '/matchups/')).map(url => Number(url.split('/').at(-1))).sort((a,b) => a-b))
      .toEqual(Array.from({ length: 14 }, (_, index) => index + 1));
    expect(calls.some(url => /players|scores\/nfl|tank|rapidapi/iu.test(url))).toBe(false);
    expect(maxInflight).toBeLessThanOrEqual(4);
  });
  it('does not load history for the default season directory', async () => {
    expect((await getManagers(LEAGUE_IDS.league1)).history).toBeUndefined();
    expect(vi.mocked(fetch).mock.calls.some(([url]) => /matchups|118863/iu.test(String(url)))).toBe(false);
  });
  it.each(['missing-link', 'wrong-year', 'unfinished', 'missing-week', 'malformed-week', 'median'] as const)(
    'keeps current managers visible with unknown combined records for %s', async reason => {
      if (reason === 'missing-link') previousId = null;
      if (reason === 'wrong-year') historicalSeason = '2024';
      if (reason === 'unfinished') historicalStatus = 'in_season';
      if (reason === 'missing-week') failedWeek = 7;
      if (reason === 'malformed-week') malformedWeek = 7;
      if (reason === 'median') median = 1;
      const data = await getManagersHistory(LEAGUE_IDS.league1, 'league1');
      expect(data.history?.warning).toBeTruthy();
      expect(data.history?.managers.length).toBeGreaterThanOrEqual(2);
      expect(data.history?.managers.every(manager => manager.wins === null)).toBe(true);
      expect(data.teams).toHaveLength(2);
    });
  it('also excludes a playoff week earlier than Week 15', async () => {
    playoffStart = 14;
    const data = await getManagersHistory(LEAGUE_IDS.league1, 'league1');
    expect(data.history?.managers.find(manager => manager.ownerId === 'A')).toMatchObject({ wins: 13, losses: 1 });
    expect(vi.mocked(fetch).mock.calls.some(([url]) => String(url).endsWith('/matchups/14'))).toBe(false);
  });
});
