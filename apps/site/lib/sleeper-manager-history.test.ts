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
let olderId: string | null;
let olderSeason: string;
let olderStatus: string;
let failedWeek: number | null;
let malformedWeek: number | null;
let playoffStart: number;
let median: number;
let inflight: number;
let maxInflight: number;
let coOwned: boolean;
let coOwnerOverride: { historical: boolean; value: unknown } | null;
const pastId = '1188632688331706368';
const past2024Id = '1118614856996909056';

beforeEach(() => {
  state.generation++;
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-09-20T14:00:00Z'));
  historicalStatus = 'complete'; historicalSeason = '2025'; previousId = pastId;
  olderId = past2024Id; olderSeason = '2024'; olderStatus = 'complete';
  failedWeek = null; malformedWeek = null; playoffStart = 15; median = 0;
  inflight = 0; maxInflight = 0;
  coOwned = false;
  coOwnerOverride = null;
  vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    const path = url.pathname.replace(/^\/v1/u, '');
    if (path === '/state/nfl') return Response.json({ season: '2026', season_type: 'regular', week: 2, leg: 2, display_week: 2 });
    if (path === '/schedule/nfl/regular/2026') return Response.json(seasonEvidence.body);
    const match = /^\/league\/(\d+)(?:\/(.*))?$/u.exec(path);
    if (!match) throw new Error('Unexpected provider request');
    const id = match[1]; const suffix = match[2]; const oldest = id === past2024Id;
    const past = id === pastId || oldest;
    if (!past && !Object.values(LEAGUE_IDS).some(value => value === id)) throw new Error('Unknown league');
    if (!suffix) return Response.json({ league_id: id, name: 'League', season: oldest ? olderSeason : past ? historicalSeason : '2026',
      status: oldest ? olderStatus : past ? historicalStatus : 'in_season', total_rosters: 2, roster_positions: ['QB'],
      previous_league_id: oldest ? null : past ? olderId : previousId,
      settings: { last_scored_leg: past ? 18 : 1, start_week: 1, best_ball: 0,
        league_average_match: median, playoff_week_start: playoffStart } });
    if (suffix === 'rosters') return Response.json([1, 2].map(roster_id => ({
      roster_id, owner_id: past ? (roster_id === 1 ? 'A' : 'B') : (roster_id === 1 ? 'C' : 'A'),
      co_owners: roster_id === 1 && coOwnerOverride?.historical === past ? coOwnerOverride.value
        : coOwned && roster_id === 1 ? ['862177751849877504'] : null,
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
  const malformedCoOwners = [
    { label: 'scalar account', value: '862177751849877504' },
    { label: 'object', value: { owner_id: '862177751849877504' } },
    { label: 'mixed array', value: ['862177751849877504', 7] },
    { label: 'empty account', value: [''] },
    { label: 'whitespace account', value: [' 862177751849877504 '] },
    { label: 'duplicate account', value: ['862177751849877504', '862177751849877504'] },
  ];
  it.each(malformedCoOwners)('rejects malformed current co-owners: $label', async ({ value }) => {
    coOwnerOverride = { historical: false, value };
    await expect(getManagersHistory(LEAGUE_IDS.league2, 'league2')).rejects.toThrow('invalid response');
  });
  it.each(malformedCoOwners)('leaves historical records unavailable for malformed co-owners: $label', async ({ value }) => {
    coOwnerOverride = { historical: true, value };
    const data = await getManagersHistory(LEAGUE_IDS.league2, 'league2');
    expect(data.history?.warning).toContain('2025 manager history is unavailable');
    expect(data.history?.managers).toHaveLength(2);
    expect(data.history?.managers.every(manager => manager.wins === null && manager.losses === null && manager.ties === null)).toBe(true);
    expect(data.history?.managers.some(manager => manager.ownerId === '862177751849877504')).toBe(false);
  });
  it.each([
    { label: 'omitted', value: undefined }, { label: 'null', value: null }, { label: 'empty list', value: [] },
  ])('preserves valid $label co-owner behavior in either source season', async ({ value }) => {
    coOwnerOverride = { historical: true, value };
    const historical = await getManagersHistory(LEAGUE_IDS.league2, 'league2');
    expect(historical.history?.warning).toBeUndefined();
    state.generation++;
    coOwnerOverride = { historical: false, value };
    const current = await getManagersHistory(LEAGUE_IDS.league2, 'league2');
    expect(current.history).toEqual(historical.history);
  });
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
      .toEqual([['A current', key === 'league1' ? 28 : 14, 1, 2], ['B old', 0, key === 'league1' ? 28 : 14, null], ['C current', 1, 0, 1]]);
    expect(data.history?.label).toBe(`${key === 'league1' ? 2024 : 2025}–2026 · Regular season · Weeks 1–14`);
    expect(data.teams.every(team => team.wins === 18)).toBe(true); // season tab remains unchanged
    const calls = vi.mocked(fetch).mock.calls.map(([url]) => String(url));
    expect(calls.filter(url => url.includes('/matchups/'))).toHaveLength(key === 'league1' ? 29 : 15);
    expect(calls.filter(url => url.includes(pastId + '/matchups/')).map(url => Number(url.split('/').at(-1))).sort((a,b) => a-b))
      .toEqual(Array.from({ length: 14 }, (_, index) => index + 1));
    expect(calls.filter(url => url.includes(past2024Id + '/matchups/')).map(url => Number(url.split('/').at(-1))).sort((a,b) => a-b))
      .toEqual(key === 'league1' ? Array.from({ length: 14 }, (_, index) => index + 1) : []);
    expect(calls.some(url => /\/matchups\/(15|16|17|18)$/u.test(url))).toBe(false);
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
    expect(data.history?.managers.find(manager => manager.ownerId === 'A')).toMatchObject({ wins: 26, losses: 1 });
    expect(vi.mocked(fetch).mock.calls.some(([url]) => String(url).endsWith('/matchups/14'))).toBe(false);
  });
  it.each(['missing-link', 'wrong-year', 'unfinished', 'circular-link'] as const)(
    'does not present an incomplete combined record when 2024 has a %s', async reason => {
      if (reason === 'missing-link') olderId = null;
      if (reason === 'wrong-year') olderSeason = '2023';
      if (reason === 'unfinished') olderStatus = 'in_season';
      if (reason === 'circular-link') olderId = pastId;
      const data = await getManagersHistory(LEAGUE_IDS.league1, 'league1');
      expect(data.history?.warning).toContain('2024');
      expect(data.history?.warning).toMatch(/unavailable|invalid/);
      expect(data.history?.managers.every(manager => manager.wins === null && manager.losses === null)).toBe(true);
      expect(data.teams).toHaveLength(2);
    });
});
