import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LEAGUE_IDS } from './config';
import seasonEvidence from '../test-support/fixtures/sleeper-2026-season-schedule.json';
import { selectMyTeamSchedule } from './my-team-schedule';
import type { SleeperMatchup } from './transform';

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
  getRetainedSiteCalendar: vi.fn().mockResolvedValue({ week: 2, lifecycle: 'active' }),
}));
import { getMyTeamSchedule, getOverview } from './sleeper';

let history: Record<number, unknown>;
let failedWeeks: Set<number>;
let scheduleUnavailable: boolean;
let seasonSchedule: unknown;
let status: string;
let activeRequests: number;
let maxRequests: number;
const rows = (left: number | null = 100, right: number | null = 80): SleeperMatchup[] => [
  { roster_id: 1, matchup_id: 1, points: left, starters: [] },
  { roster_id: 2, matchup_id: 1, points: right, starters: null },
];

beforeEach(() => {
  cacheState.generation += 1;
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-09-16T00:00:00Z'));
  history = { 1: rows() };
  failedWeeks = new Set();
  scheduleUnavailable = false;
  seasonSchedule = seasonEvidence.body;
  status = 'in_season';
  activeRequests = 0;
  maxRequests = 0;
  vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    const path = url.pathname.replace(/^\/v1/u, '');
    if (path === '/state/nfl') return Response.json({ season: '2026', season_type: 'regular', week: 1, leg: 1, display_week: 1 });
    if (path === '/schedule/nfl/regular/2026') {
      return scheduleUnavailable ? new Response(null, { status: 503 }) : Response.json(seasonSchedule);
    }
    const match = /^\/league\/(\d+)(?:\/(.*))?$/u.exec(path);
    if (!match || !Object.values(LEAGUE_IDS).some(id => id === match[1])) throw new Error(`Unexpected source request: ${url.origin}${path}`);
    const leagueId = match[1];
    const second = leagueId === LEAGUE_IDS.league2;
    const suffix = match[2];
    if (!suffix) return Response.json({ league_id: leagueId, name: second ? 'League Two' : 'League One', season: '2026',
      status, total_rosters: 2, roster_positions: ['QB'], settings: { last_scored_leg: 1 } });
    if (suffix === 'rosters') return Response.json([1, 2].map(id => ({ roster_id: id, owner_id: String(id), players: [], starters: [],
      settings: { wins: id === 1 ? 1 : 0, losses: id === 1 ? 0 : 1, ties: 0, fpts: id === 1 ? 100 : 80, fpts_against: id === 1 ? 80 : 100 } })));
    if (suffix === 'users') return Response.json([1, 2].map(id => ({ user_id: String(id), display_name: `${second ? 'Second' : 'First'} ${id}` })));
    if (suffix.startsWith('matchups/')) {
      const week = Number(suffix.split('/')[1]);
      activeRequests += 1;
      maxRequests = Math.max(maxRequests, activeRequests);
      await new Promise(resolve => setTimeout(resolve, 1));
      activeRequests -= 1;
      return failedWeeks.has(week) ? new Response(null, { status: 503 })
        : Response.json(history[week] ?? rows(second ? 200 : 0, second ? 180 : 0));
    }
    throw new Error(`Unexpected source request: ${url.origin}${path}`);
  }));
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('shared official My Team schedule loader', () => {
  it('loads exactly15 shared cached weekly requests with bounded concurrency and no player/game/projection requests', async () => {
    const [data, overview] = await Promise.all([getMyTeamSchedule(LEAGUE_IDS.league1), getOverview(LEAGUE_IDS.league1)]);
    expect(data.teams).toEqual(overview.teams);
    expect(data.weeks).toHaveLength(15);
    expect(data.weeks[0].status).toBe('final');
    expect(data.weeks[1].status).toBe('unknown');
    expect(data.weeks[2].status).toBe('upcoming');
    const calls = vi.mocked(fetch).mock.calls;
    const weekly = calls.filter(([url]) => String(url).includes('/matchups/'));
    expect(weekly).toHaveLength(15);
    expect(weekly.map(([url]) => Number(String(url).split('/').at(-1))).sort((a, b) => a - b))
      .toEqual(Array.from({ length: 15 }, (_, index) => index + 1));
    expect(weekly.every(([, options]) => (options as RequestInit & { next: { revalidate: number } }).next.revalidate === 60)).toBe(true);
    expect(maxRequests).toBe(4);
    expect(calls.filter(([url]) => String(url).includes('/schedule/'))).toHaveLength(1);
    expect(calls).toHaveLength(20); // League, rosters, users, state, shared season schedule, 15 matchup weeks.
    expect(calls.some(([url]) => /players|scores\/nfl|tank|rapidapi/iu.test(String(url)))).toBe(false);
  });

  it('uses completed exact-game evidence before the next-day noon display rollover', async () => {
    vi.setSystemTime(new Date('2026-09-15T14:00:00Z'));
    const data = await getMyTeamSchedule(LEAGUE_IDS.league1);
    expect(data.league.week).toBe(1);
    expect(selectMyTeamSchedule(data, 1).weeks[0]).toMatchObject({ status: 'final', result: 'W', points: 100 });
  });

  it('does not treat last_scored_leg or a retained display as game-completion proof during a calendar outage', async () => {
    scheduleUnavailable = true;
    const data = await getMyTeamSchedule(LEAGUE_IDS.league1);
    expect(data.league.week).toBe(2);
    expect(selectMyTeamSchedule(data, 1).weeks[0]).toMatchObject({ status: 'unknown', points: 100, result: null });
    expect(data.warning).toContain('calendar is temporarily unavailable');
  });

  it('does not label unplayed weeks final merely because the fantasy league status is complete', async () => {
    status = 'complete';
    const data = await getMyTeamSchedule(LEAGUE_IDS.league1);
    expect(selectMyTeamSchedule(data, 1).weeks[0].result).toBe('W');
    expect(selectMyTeamSchedule(data, 1).weeks[14].result).toBeNull();
  });

  it('withholds a result when even one scheduled NFL game is not confirmed complete after the rollover time', async () => {
    seasonSchedule = seasonEvidence.body.map((game, index) => index === 0 ? { ...game, status: 'in_progress' } : game);
    const data = await getMyTeamSchedule(LEAGUE_IDS.league1);
    expect(data.league.week).toBe(1);
    expect(selectMyTeamSchedule(data, 1).weeks[0]).toMatchObject({ status: 'unknown', result: null });
  });

  it('preserves custom zero and null official scores without assuming missing starters mean zero points', async () => {
    history[1] = [{ ...rows()[0], custom_points: 0 }, rows(99, 0)[1]];
    history[2] = rows(null, 80);
    const selected = selectMyTeamSchedule(await getMyTeamSchedule(LEAGUE_IDS.league1), 1);
    expect(selected.weeks[0]).toMatchObject({ points: 0, opponentPoints: 0, result: 'T' });
    expect(selected.weeks[1]).toMatchObject({ points: null, opponentPoints: 80, result: null });
  });

  it('isolates provider failures and duplicate/malformed identities to affected weeks', async () => {
    failedWeeks.add(2);
    history[3] = [...rows(), rows()[0]];
    history[4] = [{ ...rows()[0], points: 'invalid' }, rows()[1]];
    const data = await getMyTeamSchedule(LEAGUE_IDS.league1);
    const selected = selectMyTeamSchedule(data, 1);
    expect(selected.weeks[0].result).toBe('W');
    expect(selected.weeks.slice(1, 4).every(week => week.opponent === null && week.result === null)).toBe(true);
    expect(selected.weeks[4].opponent).not.toBeNull();
    expect(data.warning).toContain('Some weekly schedule or result data');
  });

  it('does not infer a valid two-team pairing after the tolerant parser omits a malformed third row', async () => {
    history[1] = [...rows(), { roster_id: 3, matchup_id: 1, points: 'invalid' }];
    const data = await getMyTeamSchedule(LEAGUE_IDS.league1);
    expect(selectMyTeamSchedule(data, 1).weeks[0]).toMatchObject({ opponent: null, points: null, result: null });
    expect(selectMyTeamSchedule(data, 1).weeks[1].opponent).not.toBeNull();
  });

  it('accepts subsequent official corrections on the next shared-cache retrieval', async () => {
    expect(selectMyTeamSchedule(await getMyTeamSchedule(LEAGUE_IDS.league1), 1).weeks[0].result).toBe('W');
    cacheState.generation += 1;
    history[1] = [{ ...rows()[0], custom_points: 70 }, rows()[1]];
    expect(selectMyTeamSchedule(await getMyTeamSchedule(LEAGUE_IDS.league1), 1).weeks[0])
      .toMatchObject({ points: 70, opponentPoints: 80, result: 'L' });
  });

  it('keeps league names and official scores isolated when roster IDs overlap', async () => {
    const [one, two] = await Promise.all([getMyTeamSchedule(LEAGUE_IDS.league1), getMyTeamSchedule(LEAGUE_IDS.league2)]);
    expect(one.teams[0].name).toBe('First 1');
    expect(two.teams[0].name).toBe('Second 1');
    expect(one.weeks[1].matchups[0].sides[0].points).toBe(0);
    expect(two.weeks[1].matchups[0].sides[0].points).toBe(200);
    expect(vi.mocked(fetch).mock.calls.filter(([url]) => String(url).includes('/matchups/'))).toHaveLength(30);
  });
});
