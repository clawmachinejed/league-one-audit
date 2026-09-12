import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const nextCacheEntries = vi.hoisted(() => [] as Array<{
  keys: string[];
  options: { revalidate?: number };
}>);
const reactCacheControl = vi.hoisted(() => ({ enabled: false, generation: 0 }));

vi.mock('server-only', () => ({}));
vi.mock('react', () => ({
  cache: <Arguments extends unknown[], Result>(fn: (...args: Arguments) => Result) => {
    const values = new Map<string, Result>();
    return (...args: Arguments): Result => {
      if (!reactCacheControl.enabled) return fn(...args);
      const key = JSON.stringify([reactCacheControl.generation, args]);
      if (values.has(key)) return values.get(key)!;
      const value = fn(...args);
      values.set(key, value);
      return value;
    };
  },
}));
vi.mock('next/cache', () => ({
  unstable_cache: <T,>(fn: T, _keys: string[], options: { revalidate?: number }) => {
    nextCacheEntries.push({ keys: _keys, options });
    return fn;
  },
}));
import { LEAGUE_IDS } from './config';
import {
  getCurrentLeagueWeek,
  getFantasyPlayerCatalog,
  getOfficialMatchups,
  getOverview,
  getManager,
  getProjectionCadenceInput,
  getProjectionSyncInput,
  getRawLineupMatchups,
  getStandings,
  getLeagueTransactions,
  getRosters,
  getTransactions,
} from './sleeper';

const leagueOneId = LEAGUE_IDS.league1;
const leagueTwoId = LEAGUE_IDS.league2;
const leaguePath = `/league/${leagueOneId}`;
const leagueTwoPath = `/league/${leagueTwoId}`;
let failures: Set<string>;
let seasonType: string;
let invalidLeague: boolean;
let activeTransactionRequests: number;
let maxTransactionRequests: number;
let playerInjury: unknown;
let expectedRosterCount: number;
let leagueStatus: string;
let leagueLeg: number;
let lastScoredLeg: number | undefined;
let stateSeason: string;
let rosterPositions: string[];
let rawRosters: unknown[];
let rawUsers: unknown[];
let rawMatchups: unknown[];
let playerCatalog: unknown | undefined;
let testNow = 0;

const rosterSettings = {
  wins: 0,
  losses: 0,
  ties: 0,
  fpts: 0,
  fpts_against: 0,
  waiver_budget_used: 0,
  waiver_position: 1,
};

const leagueOneScoringSettings = {
  sack: 1,
  pass_int: -2,
  pts_allow_0: 10,
  pass_2pt: 2,
  rec_td: 6,
  rush_td: 6,
  pass_td_40p: 1,
  rec_2pt: 2,
  rec: 0.5,
  pts_allow_14_20: 1,
  int: 2,
  def_st_fum_rec: 2,
  fum_lost: -2,
  pts_allow_1_6: 7,
  pts_allow_21_27: 0,
  rush_2pt: 2,
  fum_rec: 2,
  def_st_td: 6,
  def_td: 6,
  rec_td_40p: 1,
  safe: 2,
  pass_yd: 0.04,
  blk_kick: 2,
  pass_td: 6,
  rush_yd: 0.1,
  pts_allow_28_34: -1,
  pts_allow_35p: -4,
  fum_rec_td: 6,
  rec_yd: 0.1,
  rush_td_40p: 1,
  pts_allow_7_13: 4,
};
let activeScoringSettings: Record<string, unknown>;

const schedulePairs = [
  ['CAR', 'KC'], ['LAC', 'ARI'], ['IND', 'HOU'], ['ATL', 'BAL'],
  ['BUF', 'CHI'], ['CIN', 'CLE'], ['DAL', 'DEN'], ['DET', 'GB'],
  ['JAX', 'LAR'], ['LV', 'MIA'], ['MIN', 'NE'], ['NO', 'NYG'],
  ['NYJ', 'PHI'], ['PIT', 'SEA'], ['SF', 'TB'], ['TEN', 'WAS'],
] as const;

function schedulePairsForWeek(week: number) {
  return week >= 3 ? schedulePairs.filter((_, index) => index !== week - 3) : schedulePairs;
}

function seasonSchedule() {
  return Array.from({ length: 18 }, (_, index) => index + 1)
    .flatMap((week) => schedulePairsForWeek(week).map(([home, away]) => ({
      status: 'pre_game', date: '2026-09-13', home, away, week, game_id: `${week}-${home}-${away}`,
    })));
}

function requestPath(input: string | URL | Request): string {
  return new URL(input instanceof Request ? input.url : String(input)).pathname.replace(/^\/v1/, '');
}

function valueFor(path: string): unknown {
  if (path === leaguePath) return invalidLeague ? null : {
    league_id: leagueOneId, name: 'League One', season: '2026', status: leagueStatus,
    total_rosters: expectedRosterCount,
    roster_positions: rosterPositions,
    settings: { waiver_budget: 100, leg: leagueLeg, ...(lastScoredLeg === undefined ? {} : { last_scored_leg: lastScoredLeg }) },
    scoring_settings: activeScoringSettings,
  };
  if (path === `${leaguePath}/rosters`) return rawRosters;
  if (path === `${leaguePath}/users`) return rawUsers;
  if (path === '/state/nfl') return { season: stateSeason, season_type: seasonType, leg: 3, week: 3, display_week: 3 };
  if (path === '/players/nfl') return playerCatalog ?? {
    qb: { full_name: 'Quarter Back', position: 'QB', team: 'IND', injury_status: playerInjury, status: 'Active' },
  };
  if (path === '/schedule/nfl/regular/2026') return seasonSchedule();
  if (path.startsWith('/scores/nfl/regular/2026/')) {
    const week = Number(path.split('/').at(-1));
    return schedulePairsForWeek(week).map(([home, away]) => ({
      status: 'pre_game', date: '2026-09-13', metadata: { home_team: home, away_team: away, canceled: false },
      start_time: Date.parse('2026-09-13T17:00:00Z'), week, season_type: 'regular', season: '2026',
    }));
  }
  if (path.startsWith(`${leaguePath}/matchups/`)) return rawMatchups;
  if (path.startsWith(`${leaguePath}/transactions/`)) {
    const week = Number(path.split('/').at(-1));
    return week === 0 ? [{ transaction_id: 'week-zero', type: 'waiver', status: 'failed', roster_ids: [1], adds: { qb: 1 }, settings: { waiver_bid: 7 } }] : [];
  }
  if (path === leagueTwoPath) return {
    league_id: leagueTwoId, name: 'League 2', season: '2026', status: 'in_season',
    total_rosters: 1,
    roster_positions: ['QB', 'BN'],
    settings: { waiver_budget: 250, leg: 3 },
    scoring_settings: activeScoringSettings,
  };
  if (path === `${leagueTwoPath}/rosters`) return [{
    roster_id: 1, owner_id: 'member-2', players: ['qb'], starters: ['qb'], settings: { ...rosterSettings, waiver_budget_used: 30, waiver_position: 4 },
  }];
  if (path === `${leagueTwoPath}/users`) return [{ user_id: 'member-2', display_name: 'Jordan' }];
  if (path.startsWith(`${leagueTwoPath}/matchups/`)) return [
    { roster_id: 1, matchup_id: null, points: 9.5, starters: ['qb'], starters_points: [9.5] },
  ];
  if (path.startsWith(`${leagueTwoPath}/transactions/`)) {
    const week = Number(path.split('/').at(-1));
    return week === 0 ? [{
      transaction_id: 'league-two-week-zero', type: 'waiver', status: 'complete', roster_ids: [1], adds: { qb: 1 }, settings: { waiver_bid: 4 },
    }] : [];
  }
  throw new Error(`Unexpected test endpoint: ${path}`);
}

beforeEach(() => {
  reactCacheControl.enabled = false;
  reactCacheControl.generation += 1;
  testNow += 301_000;
  vi.spyOn(Date, 'now').mockReturnValue(testNow);
  failures = new Set();
  seasonType = 'regular';
  invalidLeague = false;
  activeTransactionRequests = 0;
  maxTransactionRequests = 0;
  playerInjury = null;
  expectedRosterCount = 1;
  leagueStatus = 'in_season';
  leagueLeg = 3;
  lastScoredLeg = undefined;
  stateSeason = '2026';
  rosterPositions = ['QB', 'BN'];
  activeScoringSettings = { ...leagueOneScoringSettings };
  rawRosters = [{ roster_id: 1, owner_id: 'member-1', players: ['qb'], starters: ['qb'], settings: { ...rosterSettings } }];
  rawUsers = [{ user_id: 'member-1', display_name: 'Alex' }];
  rawMatchups = [{ roster_id: 1, matchup_id: null, points: null, starters: ['qb'], starters_points: [12.34] }];
  playerCatalog = undefined;
  vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) => {
    const path = requestPath(input);
    const transactionRequest = path.includes('/transactions/');
    if (transactionRequest) {
      activeTransactionRequests += 1;
      maxTransactionRequests = Math.max(maxTransactionRequests, activeTransactionRequests);
      await new Promise((resolve) => setTimeout(resolve, 1));
      activeTransactionRequests -= 1;
    }
    if (failures.has(path) || (transactionRequest && failures.has('all-transactions'))) return new Response('Unavailable', { status: 503 });
    return Response.json(valueFor(path));
  }));
});

function makeProjectionWeekReady(
  firstStarters: string[] = ['qb'],
  secondStarters: string[] = ['0'],
): void {
  expectedRosterCount = 2;
  rawRosters.push({
    roster_id: 2,
    owner_id: 'member-2',
    players: secondStarters.filter((id) => id !== '0'),
    starters: secondStarters,
    settings: { ...rosterSettings },
  });
  rawUsers.push({ user_id: 'member-2', display_name: 'Sam' });
  rawMatchups = [
    { roster_id: 1, matchup_id: 1, points: null, starters: firstStarters },
    { roster_id: 2, matchup_id: 1, points: null, starters: secondStarters },
  ];
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('Sleeper service error handling', () => {
  it('performs one uncached thin matchup request with no ancillary league or player work', async () => {
    const result = await getRawLineupMatchups(leagueOneId, 5);
    expect(result.rows).toEqual(rawMatchups);
    expect(vi.mocked(fetch).mock.calls.map(([input]) => requestPath(input))).toEqual([`${leaguePath}/matchups/5`]);
    expect(vi.mocked(fetch).mock.calls[0][1]).toEqual(expect.objectContaining({ cache: 'no-store' }));
    expect(Date.parse(result.requestCompletedAt)).toBeGreaterThanOrEqual(Date.parse(result.requestStartedAt));
  });
  it('caches Sleeper player catalogs for the recommended daily interval', () => {
    expect(nextCacheEntries).toContainEqual({
      keys: ['league-one-player-position-catalog-v1'],
      options: { revalidate: 86_400 },
    });
  });

  it('keeps the website catalog on the six-position Next.js-cached path', async () => {
    await expect(getFantasyPlayerCatalog()).resolves.toMatchObject({
      complete: true,
      sourceRevision: expect.stringMatching(/^sha256:[0-9a-f]{64}$/u),
    });
    const catalogRequests = vi.mocked(fetch).mock.calls
      .map(([input]) => new URL(input instanceof Request ? input.url : String(input)))
      .filter((url) => url.pathname.endsWith('/players/nfl'));
    expect(catalogRequests.map((url) => url.searchParams.get('position')).sort())
      .toEqual(['DEF', 'K', 'QB', 'RB', 'TE', 'WR']);
    expect(catalogRequests.every((url) => url.origin === 'https://api.sleeper.app')).toBe(true);
  });

  it('loads authoritative roster shape without managers, players, or matchup scores', async () => {
    const preflight = await getProjectionCadenceInput(leagueOneId);
    expect(preflight).toMatchObject({
      sleeperLeagueId: leagueOneId,
      season: '2026',
      week: 3,
      currentNflSeason: '2026',
      currentNflWeek: 3,
      currentNflSeasonType: 'regular',
    });
    expect(Object.keys(preflight.schedule).length).toBeGreaterThan(0);
    const paths = vi.mocked(fetch).mock.calls.map(([input]) => requestPath(input));
    expect(paths).toContain(leaguePath);
    expect(paths).toContain('/state/nfl');
    expect(paths.filter((path) => path.includes('/rosters'))).toHaveLength(1);
    const rosterCall = vi.mocked(fetch).mock.calls.find(([input]) => requestPath(input).includes('/rosters'));
    expect(rosterCall?.[1]).toEqual(expect.objectContaining({ next: { revalidate: 60 } }));
    expect(paths.some((path) => path.includes('/users')
      || path.includes('/players/nfl') || path.includes('/matchups/'))).toBe(false);
  });

  it('loads the current league week from only cached league and NFL-state inputs', async () => {
    await expect(getCurrentLeagueWeek(leagueOneId)).resolves.toBe(3);

    const calls = vi.mocked(fetch).mock.calls;
    expect(calls.map(([input]) => requestPath(input))).toEqual([leaguePath, '/state/nfl']);
    expect(calls.map(([, init]) => init)).toEqual([
      expect.objectContaining({ next: { revalidate: 60 } }),
      expect.objectContaining({ next: { revalidate: 60 } }),
    ]);
  });

  it('includes every rostered player once in projection sync input', async () => {
    rawRosters = [{
      roster_id: 1,
      owner_id: 'member-1',
      players: ['qb', 'rb'],
      starters: ['qb'],
      reserve: ['ir'],
      taxi: ['taxi'],
      settings: { ...rosterSettings },
    }];
    playerCatalog = {
      qb: { full_name: 'Quarter Back', position: 'QB', team: 'IND' },
      rb: { full_name: 'Bench Back', position: 'RB', team: 'IND' },
      ir: { full_name: 'Reserve Back', position: 'RB', team: 'IND' },
      taxi: { full_name: 'Taxi Back', position: 'RB', team: 'IND' },
    };
    makeProjectionWeekReady();

    const input = await getProjectionSyncInput(leagueOneId, {
      season: 2026,
      seasonType: 'regular',
      week: 3,
    });

    expect(input.rosteredPlayers.map((player) => player.id)).toEqual(['qb', 'rb', 'ir', 'taxi']);
    expect(input.rosteredPlayers.map((player) => player.game)).toEqual([
      input.schedule.IND,
      input.schedule.IND,
      input.schedule.IND,
      input.schedule.IND,
    ]);
    const matchupRequest = vi.mocked(fetch).mock.calls.find(([request]) => (
      requestPath(request) === `${leaguePath}/matchups/3`
    ));
    expect(matchupRequest?.[1]).toMatchObject({ cache: 'no-store' });
    expect(Date.parse(input.requestStartedAt)).not.toBeNaN();
    expect(Date.parse(input.requestCompletedAt)).toBeGreaterThanOrEqual(Date.parse(input.requestStartedAt));
  });

  it('loads the exact requested projection week instead of falling back to the current week', async () => {
    makeProjectionWeekReady();

    const input = await getProjectionSyncInput(leagueOneId, {
      season: 2026,
      seasonType: 'regular',
      week: 18,
    });

    expect(input.data.week).toBe(18);
    const matchupPaths = vi.mocked(fetch).mock.calls
      .map(([request]) => requestPath(request))
      .filter((path) => path.includes('/matchups/'));
    expect(matchupPaths).toEqual([`${leaguePath}/matchups/18`]);
  });

  it.each([
    [{ season: 2025, seasonType: 'regular' as const, week: 3 }, 'does not match'],
    [{ season: 2026, seasonType: 'postseason' as const, week: 3 }, 'regular-season'],
    [{ season: 2026, seasonType: 'regular' as const, week: 0 }, 'is invalid'],
    [{ season: 2026, seasonType: 'regular' as const, week: 19 }, 'is invalid'],
  ])('rejects invalid projection target %j without requesting a fallback matchup week', async (target, message) => {
    await expect(getProjectionSyncInput(leagueOneId, target)).rejects.toThrow(message);

    expect(vi.mocked(fetch).mock.calls
      .map(([request]) => requestPath(request))
      .some((path) => path.includes('/matchups/'))).toBe(false);
  });

  it('rejects an unresolved future playoff slate instead of publishing unpaired teams', async () => {
    makeProjectionWeekReady();
    rawMatchups = rawMatchups.map((row) => ({
      ...(row as Record<string, unknown>),
      matchup_id: null,
    }));

    await expect(getProjectionSyncInput(leagueOneId, {
      season: 2026,
      seasonType: 'regular',
      week: 18,
    })).rejects.toThrow('has not resolved every matchup pairing');
  });

  it('rejects a target week that omits any league roster', async () => {
    makeProjectionWeekReady();
    rawMatchups.pop();

    await expect(getProjectionSyncInput(leagueOneId, {
      season: 2026,
      seasonType: 'regular',
      week: 18,
    })).rejects.toThrow('incomplete matchup slate');
  });

  it.each([
    { caseName: 'missing', starters: null },
    { caseName: 'shortened', starters: ['qb'] },
    { caseName: 'overfilled', starters: ['qb', '0', '0'] },
  ])('rejects a $caseName target-week lineup instead of inventing or discarding slots', async ({ starters }) => {
    rosterPositions = ['QB', 'FLEX', 'BN'];
    makeProjectionWeekReady(['qb', '0'], ['0', '0']);
    rawMatchups[0] = {
      roster_id: 1,
      matchup_id: 1,
      points: null,
      starters,
    };

    await expect(getProjectionSyncInput(leagueOneId, {
      season: 2026,
      seasonType: 'regular',
      week: 18,
    })).rejects.toThrow('has not published complete lineups');
  });

  it('accepts explicit empty starter IDs when every target-week lineup slot is present', async () => {
    rosterPositions = ['QB', 'FLEX', 'BN'];
    rawRosters[0] = {
      roster_id: 1,
      owner_id: 'member-1',
      players: ['qb'],
      starters: ['qb', '0'],
      settings: { ...rosterSettings },
    };
    makeProjectionWeekReady(['qb', '0'], ['0', '0']);

    const input = await getProjectionSyncInput(leagueOneId, {
      season: 2026,
      seasonType: 'regular',
      week: 18,
    });

    expect(input.data.matchups[0].sides.map((side) => (
      side.starters.map((starter) => starter.id.startsWith('empty-'))
    ))).toEqual([
      [false, true],
      [true, true],
    ]);
  });

  it('loads League 2 core and matchup data from its own Sleeper endpoints', async () => {
    const [overview, matchups] = await Promise.all([
      getOverview(leagueTwoId),
      getOfficialMatchups(leagueTwoId, 3),
    ]);

    expect(overview.teams[0]).toMatchObject({ id: 1, managerName: 'Jordan' });
    expect(matchups.matchups[0].sides[0]).toMatchObject({
      team: { id: 1, managerName: 'Jordan' },
      points: 9.5,
    });
    const paths = vi.mocked(fetch).mock.calls.map(([input]) => requestPath(input));
    expect(paths).toEqual(expect.arrayContaining([
      leagueTwoPath,
      `${leagueTwoPath}/rosters`,
      `${leagueTwoPath}/users`,
      `${leagueTwoPath}/matchups/3`,
    ]));
  });

  it('uses each league and roster response to calculate isolated waiver balances without another request', async () => {
    rawRosters = [{
      roster_id: 1,
      owner_id: 'member-1',
      players: ['qb'],
      starters: ['qb'],
      settings: { ...rosterSettings, waiver_budget_used: 28, waiver_position: 7 },
    }];

    const [leagueOne, leagueTwo] = await Promise.all([
      getStandings(leagueOneId),
      getStandings(leagueTwoId),
    ]);

    expect(leagueOne.teams[0].waiverBudgetRemaining).toBe(72);
    expect(leagueOne.teams[0].waiverOrder).toBe(7);
    expect(leagueTwo.teams[0].waiverBudgetRemaining).toBe(220);
    expect(leagueTwo.teams[0].waiverOrder).toBe(4);
    const paths = vi.mocked(fetch).mock.calls.map(([input]) => requestPath(input));
    expect(paths).toHaveLength(8);
    expect(paths).toEqual(expect.arrayContaining([
      leaguePath,
      `${leaguePath}/rosters`,
      `${leaguePath}/users`,
      leagueTwoPath,
      `${leagueTwoPath}/rosters`,
      `${leagueTwoPath}/users`,
    ]));
    expect(paths.some((path) => path.includes('/transactions/') || path.includes('/matchups/'))).toBe(false);
  });

  it('isolates cached transaction history when leagues share roster IDs and week horizons', async () => {
    reactCacheControl.enabled = true;

    const [leagueOne, leagueTwo] = await Promise.all([
      getTransactions(leagueOneId, 1),
      getTransactions(leagueTwoId, 1),
    ]);

    expect(leagueOne).toMatchObject({
      team: { id: 1, managerName: 'Alex' },
      transactions: [{ id: 'week-zero', result: 'Lost', bid: 7 }],
    });
    expect(leagueTwo).toMatchObject({
      team: { id: 1, managerName: 'Jordan' },
      transactions: [{ id: 'league-two-week-zero', result: 'Won', bid: 4 }],
    });
    const paths = vi.mocked(fetch).mock.calls.map(([input]) => requestPath(input));
    expect(paths).toEqual(expect.arrayContaining([
      `${leaguePath}/transactions/0`,
      `${leagueTwoPath}/transactions/0`,
    ]));
  });

  it('uses documented position filters instead of the oversized all-player response', async () => {
    await getManager(leagueOneId, 1);
    const playerUrls = vi.mocked(fetch).mock.calls
      .map(([url]) => new URL(String(url)))
      .filter((url) => url.pathname.endsWith('/players/nfl'));
    expect(playerUrls).toHaveLength(6);
    expect(playerUrls.map((url) => url.searchParams.get('position')).sort())
      .toEqual(['DEF', 'K', 'QB', 'RB', 'TE', 'WR']);
    expect(playerUrls.every((url) => url.searchParams.has('position'))).toBe(true);
  });

  it('keeps successfully loaded player names when one position feed fails', async () => {
    const original = valueFor;
    vi.mocked(fetch).mockImplementation(async (input) => {
      const url = new URL(input instanceof Request ? input.url : String(input));
      if (url.pathname.endsWith('/players/nfl') && url.searchParams.get('position') === 'WR') {
        return new Response('Unavailable', { status: 503 });
      }
      return Response.json(original(requestPath(input)));
    });
    const data = await getManager(leagueOneId, 1);
    expect(data?.starters[0].name).toBe('Quarter Back');
    expect(data?.warning).toContain('(WR)');
  });

  it('briefly backs off a failed position feed before retrying it', async () => {
    const original = valueFor;
    vi.mocked(fetch).mockImplementation(async (input) => {
      const url = new URL(input instanceof Request ? input.url : String(input));
      if (url.pathname.endsWith('/players/nfl') && url.searchParams.get('position') === 'WR') {
        return new Response('Unavailable', { status: 503 });
      }
      return Response.json(original(requestPath(input)));
    });

    await getManager(leagueOneId, 1);
    await getManager(leagueOneId, 1);
    const playerCalls = () => vi.mocked(fetch).mock.calls.filter(([url]) => {
      const parsed = new URL(String(url));
      return parsed.pathname.endsWith('/players/nfl') && parsed.searchParams.get('position') === 'WR';
    });
    expect(playerCalls()).toHaveLength(1);

    vi.mocked(Date.now).mockReturnValue(testNow + 301_000);
    await getManager(leagueOneId, 1);
    expect(playerCalls()).toHaveLength(2);
  });

  it('loads preseason week zero transactions and makes partial history visible', async () => {
    failures.add(`${leaguePath}/transactions/1`);
    const data = await getTransactions(leagueOneId, 1);
    expect(data?.warning).toContain('weeks 1');
    expect(data?.transactions).toHaveLength(1);
    expect(data?.transactions[0]).toMatchObject({ id: 'week-zero', result: 'Lost', bid: 7 });
  });

  it('returns available finalized league activity with the existing partial-history warning', async () => {
    failures.add(`${leaguePath}/transactions/1`);
    const data = await getLeagueTransactions(leagueOneId, 'league1');
    expect(data.warning).toContain('weeks 1');
    expect(data.activities).toHaveLength(1);
    expect(data.activities[0]).toMatchObject({ kind: 'waiver', claims: [{ id: 'week-zero', result: 'Lost', bid: 7 }] });
  });

  it('fails the league-wide request when every transaction week fails', async () => {
    failures.add('all-transactions');
    await expect(getLeagueTransactions(leagueOneId, 'league1')).rejects.toThrow('transaction history is temporarily unavailable');
  });

  it('loads only the requested league once with the established four-request concurrency cap', async () => {
    const data = await getLeagueTransactions(leagueTwoId, 'league2');
    const transactionPaths = vi.mocked(fetch).mock.calls.map(([input]) => requestPath(input))
      .filter(path => path.includes('/transactions/'));
    expect(data.activities[0].id).toContain('league2:');
    expect(transactionPaths).toHaveLength(4);
    expect(transactionPaths.every(path => path.startsWith(leagueTwoPath))).toBe(true);
    expect(maxTransactionRequests).toBeLessThanOrEqual(4);
  });

  it('fails visibly instead of returning an empty activity feed when every history request fails', async () => {
    failures.add('all-transactions');
    await expect(getTransactions(leagueOneId, 1)).rejects.toThrow('transaction history is temporarily unavailable');
  });

  it('caps concurrent history calls and stops at the league\'s last active week', async () => {
    seasonType = 'post';
    const data = await getTransactions(leagueOneId, 1);
    const calls = vi.mocked(fetch).mock.calls.filter(([url]) => String(url).includes('/transactions/'));
    expect(calls).toHaveLength(4);
    expect(maxTransactionRequests).toBeLessThanOrEqual(4);
    expect(data?.warning).toBeUndefined();
  });

  it('retains the roster with a visible player-catalog warning', async () => {
    failures.add('/players/nfl');
    const data = await getManager(leagueOneId, 1);
    expect(data?.warning).toContain('Player names and injury designations are temporarily unavailable');
    expect(data?.starters[0]).toMatchObject({ id: 'qb', name: 'Player qb', slot: 'QB', injuryStatus: null });
  });

  it('does not fall back to invented teams when the configured league is invalid', async () => {
    invalidLeague = true;
    await expect(getOverview(leagueOneId)).rejects.toThrow('valid league');
  });

  it('rejects an unknown league status instead of treating its matchup data as unpublished', async () => {
    leagueStatus = 'unknown_status';
    await expect(getOverview(leagueOneId)).rejects.toThrow('valid league');
  });

  it('rejects a partial roster response instead of presenting it as the complete league', async () => {
    expectedRosterCount = 2;
    await expect(getOverview(leagueOneId)).rejects.toThrow('1 of 2 league rosters');
  });

  it('rejects malformed nested roster standings instead of converting them to zero', async () => {
    rawRosters = [{
      roster_id: 1,
      owner_id: 'member-1',
      players: ['qb'],
      starters: ['qb'],
      settings: { ...rosterSettings, wins: 'not-a-number' },
    }];
    await expect(getOverview(leagueOneId)).rejects.toThrow(`invalid response for ${leaguePath}/rosters`);
  });

  it.each([
    { wins: -1 },
    { ties: 0.5 },
  ])('rejects impossible roster record counts', async (invalidCount) => {
    rawRosters = [{
      roster_id: 1,
      owner_id: 'member-1',
      players: ['qb'],
      starters: ['qb'],
      settings: { ...rosterSettings, ...invalidCount },
    }];
    await expect(getOverview(leagueOneId)).rejects.toThrow(`invalid response for ${leaguePath}/rosters`);
  });

  it('requires points against once a roster has a played game', async () => {
    rawRosters = [{
      roster_id: 1,
      owner_id: 'member-1',
      players: ['qb'],
      starters: ['qb'],
      settings: { wins: 1, losses: 0, ties: 0, fpts: 100 },
    }];
    await expect(getOverview(leagueOneId)).rejects.toThrow(`invalid response for ${leaguePath}/rosters`);
  });

  it('rejects an empty roster settings object instead of presenting a fabricated 0–0 record', async () => {
    rawRosters = [{ roster_id: 1, owner_id: 'member-1', players: ['qb'], starters: ['qb'], settings: {} }];
    await expect(getOverview(leagueOneId)).rejects.toThrow(`invalid response for ${leaguePath}/rosters`);
  });

  it('rejects incomplete manager data for assigned rosters', async () => {
    rawUsers = [];
    await expect(getOverview(leagueOneId)).rejects.toThrow('incomplete manager information');
  });

  it('rejects a partial matchup slate after Sleeper has returned matchup rows', async () => {
    expectedRosterCount = 2;
    rawRosters.push({
      roster_id: 2,
      owner_id: 'member-2',
      players: [],
      starters: [],
      settings: { ...rosterSettings },
    });
    rawUsers.push({ user_id: 'member-2', display_name: 'Sam' });
    await expect(getOfficialMatchups(leagueOneId)).rejects.toThrow('incomplete matchup slate');
  });

  it('rejects an empty matchup response for the current active week', async () => {
    rawMatchups = [];
    await expect(getOfficialMatchups(leagueOneId)).rejects.toThrow('incomplete matchup slate');
  });

  it('allows an empty matchup response for a future week that has not been posted', async () => {
    rawMatchups = [];
    await expect(getOfficialMatchups(leagueOneId, 18)).resolves.toMatchObject({ week: 18, matchups: [] });
  });

  it('requires each posted matchup ID to identify exactly two teams', async () => {
    expectedRosterCount = 2;
    rawRosters.push({
      roster_id: 2,
      owner_id: 'member-2',
      players: [],
      starters: [],
      settings: { ...rosterSettings },
    });
    rawUsers.push({ user_id: 'member-2', display_name: 'Sam' });
    rawMatchups = [
      { roster_id: 1, matchup_id: 1, starters: ['qb'] },
      { roster_id: 2, matchup_id: null, starters: [] },
    ];
    await expect(getOfficialMatchups(leagueOneId)).rejects.toThrow('invalid matchup grouping');
  });

  it('rejects a matchup row whose matchup ID field is missing', async () => {
    rawMatchups = [{ roster_id: 1, starters: ['qb'] }];
    await expect(getOfficialMatchups(leagueOneId)).rejects.toThrow(`invalid response for ${leaguePath}/matchups/3`);
  });

  it('treats malformed nested transaction assets as a visibly partial history week', async () => {
    rawMatchups = [];
    const original = valueFor;
    vi.mocked(fetch).mockImplementation(async (input) => {
      const path = requestPath(input);
      if (path === `${leaguePath}/transactions/0`) {
        return Response.json([{ transaction_id: 'bad', adds: { qb: 'wrong-roster-type' } }]);
      }
      return Response.json(original(path));
    });
    const data = await getTransactions(leagueOneId, 1);
    expect(data?.warning).toContain('weeks 0');
  });

  it.each([
    { transaction_id: 'bad-pick', draft_picks: [{}] },
    { transaction_id: 'bad-budget', waiver_budget: [{ amount: 5 }] },
  ])('rejects incomplete nested transaction moves as partial history', async (malformed) => {
    const original = valueFor;
    vi.mocked(fetch).mockImplementation(async (input) => {
      const path = requestPath(input);
      if (path === `${leaguePath}/transactions/0`) return Response.json([malformed]);
      return Response.json(original(path));
    });
    const data = await getTransactions(leagueOneId, 1);
    expect(data?.warning).toContain('weeks 0');
  });

  it('rejects invalid roster IDs without network requests and returns null for absent managers', async () => {
    expect(await getManager(leagueOneId, 0)).toBeNull();
    expect(await getTransactions(leagueOneId, NaN)).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
    expect(await getManager(leagueOneId, 999)).toBeNull();
  });

  it('falls back to a bounded display week when a query contains an invalid week', async () => {
    const data = await getOfficialMatchups(leagueOneId, Infinity);
    expect(data.week).toBe(3);
    expect(data.matchups[0].sides[0].points).toBeNull();
    expect(vi.mocked(fetch).mock.calls.some(([url]) => String(url).endsWith('/matchups/3'))).toBe(true);
  });

  it('warns when state is missing and avoids asserting a live or final matchup', async () => {
    failures.add('/state/nfl');
    const data = await getOfficialMatchups(leagueOneId, 1);
    expect(data.warning).toContain('NFL week information is temporarily unavailable');
    expect(data.matchups[0].status).toBe('unknown');
  });

  it('preserves matchup data and warns when NFL kickoff details are unavailable', async () => {
    failures.add('/scores/nfl/regular/2026/3');
    const data = await getOfficialMatchups(leagueOneId, 3);
    expect(data.warning).toContain('Some NFL opponent or kickoff information is temporarily unavailable');
    expect(data.matchups[0].sides[0].starters[0]).toMatchObject({
      name: 'Quarter Back',
      game: { kind: 'scheduled', opponent: 'HOU', location: 'home', kickoffAt: null },
    });
  });
});

describe('Sleeper NFL game details', () => {
  it('adds the requested week opponent, location, and kickoff to each starter', async () => {
    const data = await getOfficialMatchups(leagueOneId, 3);
    expect(data.matchups[0].sides[0].starters[0].game).toEqual({
      kind: 'scheduled', opponent: 'HOU', location: 'home', date: '2026-09-13', kickoffAt: '2026-09-13T17:00:00.000Z',
    });
    expect(vi.mocked(fetch).mock.calls.some(([url]) => String(url).endsWith('/scores/nfl/regular/2026/3'))).toBe(true);
    expect(vi.mocked(fetch).mock.calls.some(([url]) => String(url).endsWith('/schedule/nfl/regular/2026'))).toBe(true);
  });

  it('does not apply the current player-team catalog to historical NFL weeks', async () => {
    const data = await getOfficialMatchups(leagueOneId, 1);
    expect(data.matchups[0].sides[0].starters[0].game).toBeNull();
    expect(vi.mocked(fetch).mock.calls.some(([url]) => String(url).includes('/scores/nfl/regular/2026/1'))).toBe(false);
  });

  it('uses a completed league\'s last scored week and never decorates its Week 18 history', async () => {
    leagueStatus = 'complete';
    leagueLeg = 18;
    lastScoredLeg = 17;
    stateSeason = '2027';
    const latest = await getOfficialMatchups(leagueOneId);
    const week18 = await getOfficialMatchups(leagueOneId, 18);
    expect(latest.week).toBe(17);
    expect(latest.matchups[0].sides[0].starters[0].game).toBeNull();
    expect(week18.matchups[0].sides[0].starters[0].game).toBeNull();
    expect(vi.mocked(fetch).mock.calls.some(([url]) => String(url).includes('/schedule/nfl/regular/'))).toBe(false);
    expect(vi.mocked(fetch).mock.calls.some(([url]) => String(url).includes('/scores/nfl/regular/'))).toBe(false);
  });

  it('allows an empty Week 18 when a completed league last scored in Week 17', async () => {
    leagueStatus = 'complete';
    leagueLeg = 18;
    lastScoredLeg = 17;
    stateSeason = '2027';
    rawMatchups = [];
    await expect(getOfficialMatchups(leagueOneId, 18)).resolves.toMatchObject({ week: 18, matchups: [] });
  });
});

describe('Sleeper current injury metadata', () => {
  it('retains the injury field in the cached catalog for current and earlier matchup weeks', async () => {
    playerInjury = ' Questionable ';
    const current = await getOfficialMatchups(leagueOneId, 3);
    const earlier = await getOfficialMatchups(leagueOneId, 1);
    for (const data of [current, earlier]) {
      expect(data.matchups[0].sides[0].starters[0]).toMatchObject({
        id: 'qb', name: 'Quarter Back', position: 'QB', nflTeam: 'IND', slot: 'QB', points: 12.34, injuryStatus: 'Questionable',
      });
    }
    expect(earlier.week).toBe(1);
  });

  it('shares current injury metadata with manager rosters', async () => {
    playerInjury = 'Out';
    const manager = await getManager(leagueOneId, 1);
    expect(manager?.starters[0]).toMatchObject({ name: 'Quarter Back', injuryStatus: 'Out', points: null });
  });

  it.each([null, undefined, '', false, 7, { status: 'Out' }])(
    'does not substitute general player status for an absent or malformed injury_status (%j)', async (value) => {
      playerInjury = value;
      const data = await getOfficialMatchups(leagueOneId);
      expect(data.matchups[0].sides[0].starters[0]).toMatchObject({ name: 'Quarter Back', injuryStatus: null });
    },
  );

  it('warns when a successful catalog response omits a shown player', async () => {
    playerCatalog = { other: { full_name: 'Other Player', position: 'RB', team: 'SEA' } };
    const manager = await getManager(leagueOneId, 1);
    expect(manager?.warning).toContain('did not provide details for 1 player');
    expect(manager?.starters[0].name).toBe('Player qb');
  });

  it('treats a catalog with no usable player identities as unavailable', async () => {
    playerCatalog = { qb: {} };
    const manager = await getManager(leagueOneId, 1);
    expect(manager?.warning).toContain('Player names and injury designations are temporarily unavailable');
    expect(manager?.starters[0].name).toBe('Player qb');
  });
});

describe('Sleeper official matchup fallback', () => {
  it('loads current official scores without a static projection on the degraded fallback path', async () => {
    const data = await getOfficialMatchups(leagueOneId, 3);

    expect(data.matchups[0].sides[0]).toMatchObject({
      points: null,
      projectedPoints: null,
      starters: [{ points: 12.34, projectedPoints: null }],
    });
    const matchupRequest = vi.mocked(fetch).mock.calls.find(([request]) => (
      requestPath(request) === `${leaguePath}/matchups/3`
    ));
    expect(matchupRequest?.[1]).toMatchObject({ next: { revalidate: 60 } });
  });
});

describe('Sleeper league rosters view', () => {
  it('uses exact-week membership and limits current-only injury, IR, and taxi metadata', async () => {
    playerInjury = 'Questionable';
    rawRosters = [{
      roster_id: 1, owner_id: 'member-1', players: ['qb', 'bench', 'ir', 'taxi'], starters: ['qb'],
      reserve: ['ir'], taxi: ['taxi'], settings: { ...rosterSettings },
    }];
    rawMatchups = [{
      roster_id: 1, matchup_id: null, points: 10, players: ['qb', 'bench', 'ir', 'taxi'], starters: ['qb'],
    }];
    playerCatalog = {
      qb: { full_name: 'Current Quarterback', position: 'QB', team: 'IND', injury_status: 'Questionable' },
      bench: { full_name: 'Bench Player', position: 'RB', team: 'HOU' },
      ir: { full_name: 'Reserve Player', position: 'WR', team: 'KC' },
      taxi: { full_name: 'Taxi Player', position: 'TE', team: 'BAL' },
    };

    const current = await getRosters(leagueOneId, 3);
    expect(current.rostersAvailable).toBe(true);
    expect(current.teams[0].sections.map((section) => section.name)).toEqual(['Starters', 'Bench', 'IR', 'Taxi']);
    expect(current.teams[0].sections[0].players[0].injuryStatus).toBe('Questionable');

    const historical = await getRosters(leagueOneId, 1);
    expect(historical.teams[0].sections.map((section) => section.name)).toEqual(['Starters', 'Bench']);
    expect(historical.teams[0].sections.flatMap((section) => section.players).every((player) => player.injuryStatus === null)).toBe(true);
    expect(historical.teams[0].sections[0].players[0].game).toBeNull();
  });

  it('fails a future week honestly until Sleeper establishes a complete exact-week slate', async () => {
    rawMatchups = [{ roster_id: 1, matchup_id: null, points: null, players: ['qb'], starters: ['qb'] }];
    const data = await getRosters(leagueOneId, 4);
    expect(data.rostersAvailable).toBe(false);
    expect(data.teams[0].rosterAvailable).toBe(false);
    expect(data.warning).toContain('has not established complete lineups');
  });

  it('uses record then Points For standings order while preserving independent average ranks', async () => {
    expectedRosterCount = 2;
    rawRosters = [
      { roster_id: 1, owner_id: 'member-1', players: ['qb'], starters: ['qb'], settings: { ...rosterSettings, wins: 1, losses: 1, fpts: 100 } },
      { roster_id: 2, owner_id: 'member-2', players: ['rb'], starters: ['rb'], settings: { ...rosterSettings, wins: 2, fpts: 90 } },
    ];
    rawUsers = [{ user_id: 'member-1', display_name: 'Alpha' }, { user_id: 'member-2', display_name: 'Beta' }];
    rosterPositions = ['FLEX', 'BN'];
    rawMatchups = [
      { roster_id: 1, matchup_id: 1, points: 10, players: ['qb'], starters: ['qb'] },
      { roster_id: 2, matchup_id: 1, points: 20, players: ['rb'], starters: ['rb'] },
    ];
    const data = await getRosters(leagueOneId, 3);
    expect(data.teams.map((team) => team.id)).toEqual([2, 1]);
    expect(data.teams.map((team) => [team.standingsRank, team.averagePpg, team.averagePpgRank]))
      .toEqual([[1, 20, 1], [2, 10, 2]]);
  });

  it('ranks complete standings when Points Against is absent and keeps average ranks independent', async () => {
    expectedRosterCount = 2;
    rawRosters = [
      { roster_id: 1, owner_id: 'member-1', players: ['qb'], starters: ['qb'], settings: { ...rosterSettings, wins: 1, losses: 1, fpts: 100, fpts_against: undefined } },
      { roster_id: 2, owner_id: 'member-2', players: ['rb'], starters: ['rb'], settings: { ...rosterSettings, wins: 2, fpts: 90, fpts_against: undefined } },
    ];
    rawUsers = [{ user_id: 'member-1', display_name: 'Alpha' }, { user_id: 'member-2', display_name: 'Beta' }];
    rawMatchups = [
      { roster_id: 1, matchup_id: 1, points: 10, players: ['qb'], starters: ['qb'] },
      { roster_id: 2, matchup_id: 1, points: 20, players: ['rb'], starters: ['rb'] },
    ];
    const data = await getRosters(leagueOneId, 3);
    expect(data.teams.map((team) => [team.id, team.standingsRank, team.averagePpgRank]))
      .toEqual([[2, 1, 1], [1, 2, 2]]);
    expect(data.teams.every((team) => !('pointsAgainst' in team))).toBe(true);
    expect(data.warning ?? '').not.toContain('incomplete or malformed');
  });

  it('ignores contradictory Points Against when record and Points For are tied', async () => {
    expectedRosterCount = 2;
    rawRosters = [
      { roster_id: 1, owner_id: 'member-1', players: ['qb'], starters: ['qb'], settings: { ...rosterSettings, wins: 1, fpts: 100, fpts_against: 1 } },
      { roster_id: 2, owner_id: 'member-2', players: ['rb'], starters: ['rb'], settings: { ...rosterSettings, wins: 1, fpts: 100, fpts_against: 999 } },
    ];
    rawUsers = [{ user_id: 'member-1', display_name: 'Alpha' }, { user_id: 'member-2', display_name: 'Beta' }];
    rawMatchups = [
      { roster_id: 1, matchup_id: 1, points: 10, players: ['qb'], starters: ['qb'] },
      { roster_id: 2, matchup_id: 1, points: 20, players: ['rb'], starters: ['rb'] },
    ];
    const data = await getRosters(leagueOneId, 3);
    expect(data.teams.map((team) => [team.id, team.standingsRank])).toEqual([[1, 1], [2, 2]]);
  });

  it('withholds all standings ranks and falls back alphabetically when Points For is missing', async () => {
    expectedRosterCount = 2;
    rawRosters = [
      { roster_id: 1, owner_id: 'member-1', players: ['qb'], starters: ['qb'], settings: { ...rosterSettings, wins: 1, fpts: 100 } },
      { roster_id: 2, owner_id: 'member-2', players: ['rb'], starters: ['rb'], settings: { ...rosterSettings, wins: 1, fpts: undefined } },
    ];
    rawUsers = [{ user_id: 'member-1', display_name: 'Zulu' }, { user_id: 'member-2', display_name: 'Alpha' }];
    rawMatchups = [
      { roster_id: 1, matchup_id: 1, points: 10, players: ['qb'], starters: ['qb'] },
      { roster_id: 2, matchup_id: 1, points: 20, players: ['rb'], starters: ['rb'] },
    ];
    const data = await getRosters(leagueOneId, 3);
    expect(data.teams.map((team) => [team.name, team.standingsRank]))
      .toEqual([['Alpha', null], ['Zulu', null]]);
  });

  it('withholds all standings ranks and falls back alphabetically when a record is invalid', async () => {
    expectedRosterCount = 2;
    rawRosters = [
      { roster_id: 1, owner_id: 'member-1', players: ['qb'], starters: ['qb'], settings: { ...rosterSettings, wins: 'bad', fpts: 100 } },
      { roster_id: 2, owner_id: 'member-2', players: ['rb'], starters: ['rb'], settings: { ...rosterSettings, wins: 1, fpts: 90 } },
    ];
    rawUsers = [{ user_id: 'member-1', display_name: 'Zulu' }, { user_id: 'member-2', display_name: 'Alpha' }];
    rawMatchups = [
      { roster_id: 1, matchup_id: 1, points: 10, players: ['qb'], starters: ['qb'] },
      { roster_id: 2, matchup_id: 1, points: 20, players: ['rb'], starters: ['rb'] },
    ];
    const data = await getRosters(leagueOneId, 3);
    expect(data.teams.map((team) => [team.name, team.standingsRank]))
      .toEqual([['Alpha', null], ['Zulu', null]]);
  });

  it('does not calculate partial averages when a required week request fails', async () => {
    lastScoredLeg = 2;
    rawMatchups = [{ roster_id: 1, matchup_id: null, points: 0, players: ['qb'], starters: ['qb'] }];
    failures.add(`${leaguePath}/matchups/2`);
    const data = await getRosters(leagueOneId, 3);
    expect(data.teams[0]).toMatchObject({ averagePpg: null, averagePpgRank: null });
    expect(data.warning).toContain('week 2');
  });

  it('withholds league-wide average ranks when the roster identity set is incomplete', async () => {
    expectedRosterCount = 2;
    rawMatchups = [{ roster_id: 1, matchup_id: null, points: 10, players: ['qb'], starters: ['qb'] }];
    const data = await getRosters(leagueOneId, 3);
    expect(data.teams[0]).toMatchObject({ standingsRank: null, averagePpg: 10, averagePpgRank: null });
    expect(data.warning).toContain('incomplete or malformed data for 1 roster');
  });

  it('uses last_scored_leg for completed leagues and excludes an unplayed final week', async () => {
    leagueStatus = 'complete';
    leagueLeg = 18;
    lastScoredLeg = 17;
    stateSeason = '2027';
    rawMatchups = [{ roster_id: 1, matchup_id: null, points: 7, players: ['qb'], starters: ['qb'] }];
    const data = await getRosters(leagueOneId, 18);
    expect(data.teams[0].averagePpg).toBe(7);
    expect(vi.mocked(fetch).mock.calls.some(([input]) => requestPath(input) === `${leaguePath}/matchups/18`)).toBe(true);
  });

  it('never treats current injury, IR, or taxi fields as completed-season history', async () => {
    leagueStatus = 'complete';
    leagueLeg = 18;
    lastScoredLeg = 17;
    stateSeason = '2027';
    playerInjury = 'Out';
    rawRosters = [{
      roster_id: 1, owner_id: 'member-1', players: ['qb', 'ir', 'taxi'], starters: ['qb'],
      reserve: ['ir'], taxi: ['taxi'], settings: { ...rosterSettings },
    }];
    rawMatchups = [{
      roster_id: 1, matchup_id: null, points: 7, players: ['qb', 'ir', 'taxi'], starters: ['qb'],
    }];
    const data = await getRosters(leagueOneId, 17);
    expect(data.teams[0].sections.map((section) => section.name)).toEqual(['Starters', 'Bench']);
    expect(data.teams[0].sections.flatMap((section) => section.players).every((player) => player.injuryStatus === null)).toBe(true);
  });

  it('isolates a malformed weekly row instead of hiding other teams', async () => {
    expectedRosterCount = 2;
    rawRosters.push({ roster_id: 2, owner_id: 'member-2', players: ['rb'], starters: ['rb'], settings: { ...rosterSettings } });
    rawUsers.push({ user_id: 'member-2', display_name: 'Beta' });
    rawMatchups = [
      { roster_id: 1, matchup_id: 1, points: 10, players: ['qb'], starters: ['qb'] },
      { roster_id: 2, matchup_id: 1, points: 'bad', players: ['rb'], starters: ['rb'] },
    ];
    const data = await getRosters(leagueOneId, 3);
    expect(data.teams.find((team) => team.id === 1)).toMatchObject({ rosterAvailable: true, averagePpg: 10 });
    expect(data.teams.find((team) => team.id === 2)).toMatchObject({ rosterAvailable: false, averagePpg: null });
  });

  it('rejects blank or duplicate exact-week player membership for only the malformed teams', async () => {
    expectedRosterCount = 3;
    rawRosters.push(
      { roster_id: 2, owner_id: 'member-2', players: ['rb'], starters: ['rb'], settings: { ...rosterSettings } },
      { roster_id: 3, owner_id: 'member-3', players: ['wr'], starters: ['wr'], settings: { ...rosterSettings } },
    );
    rawUsers.push(
      { user_id: 'member-2', display_name: 'Beta' },
      { user_id: 'member-3', display_name: 'Gamma' },
    );
    rawMatchups = [
      { roster_id: 1, matchup_id: null, points: 10, players: ['qb'], starters: ['qb'] },
      { roster_id: 2, matchup_id: null, points: 11, players: ['rb', 'rb'], starters: ['rb'] },
      { roster_id: 3, matchup_id: null, points: 12, players: ['wr', ''], starters: ['wr'] },
    ];
    const data = await getRosters(leagueOneId, 3);
    expect(data.teams.find((team) => team.id === 1)?.rosterAvailable).toBe(true);
    expect(data.teams.find((team) => team.id === 2)?.rosterAvailable).toBe(false);
    expect(data.teams.find((team) => team.id === 3)?.rosterAvailable).toBe(false);
  });

  it('keeps League One and League Two responses isolated', async () => {
    rawMatchups = [{ roster_id: 1, matchup_id: null, points: 5, players: ['qb'], starters: ['qb'] }];
    const [one, two] = await Promise.all([getRosters(leagueOneId, 3), getRosters(leagueTwoId, 3)]);
    expect(one.teams[0].managerName).toBe('Alex');
    expect(two.teams[0].managerName).toBe('Jordan');
    expect(one.teams[0].averagePpg).toBe(5);
    expect(two.teams[0].averagePpg).toBe(9.5);
  });
});
