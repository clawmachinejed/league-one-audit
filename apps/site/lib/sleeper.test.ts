import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const nextCacheOptions = vi.hoisted(() => [] as Array<{ revalidate?: number }>);
const getTank01WeeklyProjectionsMock = vi.hoisted(() => vi.fn());
const afterMock = vi.hoisted(() => vi.fn());
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
    nextCacheOptions.push(options);
    return fn;
  },
}));
vi.mock('next/server', () => ({ after: afterMock }));
vi.mock('./tank01', () => ({ getTank01WeeklyProjections: getTank01WeeklyProjectionsMock }));

import { LEAGUE_IDS } from './config';
import {
  getCurrentLeagueWeek,
  getMatchups,
  getOfficialMatchups,
  getOverview,
  getOwner,
  getProjectionCadenceInput,
  getProjectionSyncInput,
  getTransactions,
} from './sleeper';
import type { NormalizedTank01OffenseProjection } from './projection-scoring';

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

const zeroOffenseProjection: NormalizedTank01OffenseProjection = {
  kind: 'offense',
  passingYards: 0,
  passingTouchdowns: 0,
  passingInterceptions: 0,
  rushingYards: 0,
  rushingTouchdowns: 0,
  receptions: 0,
  receivingYards: 0,
  receivingTouchdowns: 0,
  twoPointConversions: 0,
  fumblesLost: 0,
};

function availableTank01Projection(playerIds: string[] = ['qb']) {
  return {
    status: 'available' as const,
    season: '2026',
    week: 3,
    fetchedAt: '2026-09-01T12:00:00.000Z',
    projections: {
      bySleeperId: Object.fromEntries(playerIds.map((id) => [id, {
        tank01PlayerId: `tank-${id}`,
        sleeperPlayerId: id,
        team: 'IND',
        position: id === 'rb' ? 'RB' : 'QB',
        stats: {},
        scoringProjection: zeroOffenseProjection,
        missingFields: [],
      }])),
      byDefenseTeam: {},
    },
    coverage: {
      playerListRows: playerIds.length,
      crosswalkEntries: playerIds.length,
      malformedPlayerListRows: 0,
      ambiguousPlayerListRows: 0,
      playerProjectionRows: playerIds.length,
      matchedPlayerProjections: playerIds.length,
      unmatchedPlayerProjections: 0,
      malformedPlayerProjections: 0,
      incompletePlayerProjections: 0,
      defenseProjectionRows: 0,
      usableDefenseProjections: 0,
      malformedDefenseProjections: 0,
      incompleteDefenseProjections: 0,
    },
    warnings: [],
  };
}

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
    roster_positions: ['QB', 'BN'],
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
    settings: { waiver_budget: 100, leg: 3 },
    scoring_settings: activeScoringSettings,
  };
  if (path === `${leagueTwoPath}/rosters`) return [{
    roster_id: 1, owner_id: 'member-2', players: ['qb'], starters: ['qb'], settings: { ...rosterSettings },
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
  activeScoringSettings = { ...leagueOneScoringSettings };
  rawRosters = [{ roster_id: 1, owner_id: 'member-1', players: ['qb'], starters: ['qb'], settings: { ...rosterSettings } }];
  rawUsers = [{ user_id: 'member-1', display_name: 'Alex' }];
  rawMatchups = [{ roster_id: 1, matchup_id: null, points: null, starters: ['qb'], starters_points: [12.34] }];
  playerCatalog = undefined;
  getTank01WeeklyProjectionsMock.mockReset();
  getTank01WeeklyProjectionsMock.mockResolvedValue(availableTank01Projection());
  afterMock.mockReset();
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

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('Sleeper service error handling', () => {
  it('caches Sleeper player catalogs for the recommended daily interval', () => {
    expect(nextCacheOptions.some((options) => options.revalidate === 86_400)).toBe(true);
  });

  it('loads the cadence preflight without rosters, owners, players, or matchup scores', async () => {
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
    expect(paths.some((path) => path.includes('/rosters') || path.includes('/users')
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

    const input = await getProjectionSyncInput(leagueOneId);

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

  it('loads League 2 core and matchup data from its own Sleeper endpoints', async () => {
    const [overview, matchups] = await Promise.all([
      getOverview(leagueTwoId),
      getMatchups(3, leagueTwoId),
    ]);

    expect(overview.teams[0]).toMatchObject({ id: 1, ownerName: 'Jordan' });
    expect(matchups.matchups[0].sides[0]).toMatchObject({
      team: { id: 1, ownerName: 'Jordan' },
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

  it('isolates cached transaction history when leagues share roster IDs and week horizons', async () => {
    reactCacheControl.enabled = true;

    const [leagueOne, leagueTwo] = await Promise.all([
      getTransactions(1, leagueOneId),
      getTransactions(1, leagueTwoId),
    ]);

    expect(leagueOne).toMatchObject({
      team: { id: 1, ownerName: 'Alex' },
      transactions: [{ id: 'week-zero', result: 'Lost', bid: 7 }],
    });
    expect(leagueTwo).toMatchObject({
      team: { id: 1, ownerName: 'Jordan' },
      transactions: [{ id: 'league-two-week-zero', result: 'Won', bid: 4 }],
    });
    const paths = vi.mocked(fetch).mock.calls.map(([input]) => requestPath(input));
    expect(paths).toEqual(expect.arrayContaining([
      `${leaguePath}/transactions/0`,
      `${leagueTwoPath}/transactions/0`,
    ]));
  });

  it('uses documented position filters instead of the oversized all-player response', async () => {
    await getOwner(1);
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
    const data = await getOwner(1);
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

    await getOwner(1);
    await getOwner(1);
    const playerCalls = () => vi.mocked(fetch).mock.calls.filter(([url]) => {
      const parsed = new URL(String(url));
      return parsed.pathname.endsWith('/players/nfl') && parsed.searchParams.get('position') === 'WR';
    });
    expect(playerCalls()).toHaveLength(1);

    vi.mocked(Date.now).mockReturnValue(testNow + 301_000);
    await getOwner(1);
    expect(playerCalls()).toHaveLength(2);
  });

  it('loads preseason week zero transactions and makes partial history visible', async () => {
    failures.add(`${leaguePath}/transactions/1`);
    const data = await getTransactions(1);
    expect(data?.warning).toContain('weeks 1');
    expect(data?.transactions).toHaveLength(1);
    expect(data?.transactions[0]).toMatchObject({ id: 'week-zero', result: 'Lost', bid: 7 });
  });

  it('fails visibly instead of returning an empty activity feed when every history request fails', async () => {
    failures.add('all-transactions');
    await expect(getTransactions(1)).rejects.toThrow('transaction history is temporarily unavailable');
  });

  it('caps concurrent history calls and stops at the league\'s last active week', async () => {
    seasonType = 'post';
    const data = await getTransactions(1);
    const calls = vi.mocked(fetch).mock.calls.filter(([url]) => String(url).includes('/transactions/'));
    expect(calls).toHaveLength(4);
    expect(maxTransactionRequests).toBeLessThanOrEqual(4);
    expect(data?.warning).toBeUndefined();
  });

  it('retains the roster with a visible player-catalog warning', async () => {
    failures.add('/players/nfl');
    const data = await getOwner(1);
    expect(data?.warning).toContain('Player names and injury designations are temporarily unavailable');
    expect(data?.starters[0]).toMatchObject({ id: 'qb', name: 'Player qb', slot: 'QB', injuryStatus: null });
  });

  it('does not fall back to invented teams when the configured league is invalid', async () => {
    invalidLeague = true;
    await expect(getOverview()).rejects.toThrow('valid league');
  });

  it('rejects an unknown league status instead of treating its matchup data as unpublished', async () => {
    leagueStatus = 'unknown_status';
    await expect(getOverview()).rejects.toThrow('valid league');
  });

  it('rejects a partial roster response instead of presenting it as the complete league', async () => {
    expectedRosterCount = 2;
    await expect(getOverview()).rejects.toThrow('1 of 2 league rosters');
  });

  it('rejects malformed nested roster standings instead of converting them to zero', async () => {
    rawRosters = [{
      roster_id: 1,
      owner_id: 'member-1',
      players: ['qb'],
      starters: ['qb'],
      settings: { ...rosterSettings, wins: 'not-a-number' },
    }];
    await expect(getOverview()).rejects.toThrow(`invalid response for ${leaguePath}/rosters`);
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
    await expect(getOverview()).rejects.toThrow(`invalid response for ${leaguePath}/rosters`);
  });

  it('requires points against once a roster has a played game', async () => {
    rawRosters = [{
      roster_id: 1,
      owner_id: 'member-1',
      players: ['qb'],
      starters: ['qb'],
      settings: { wins: 1, losses: 0, ties: 0, fpts: 100 },
    }];
    await expect(getOverview()).rejects.toThrow(`invalid response for ${leaguePath}/rosters`);
  });

  it('rejects an empty roster settings object instead of presenting a fabricated 0–0 record', async () => {
    rawRosters = [{ roster_id: 1, owner_id: 'member-1', players: ['qb'], starters: ['qb'], settings: {} }];
    await expect(getOverview()).rejects.toThrow(`invalid response for ${leaguePath}/rosters`);
  });

  it('rejects incomplete owner data for assigned rosters', async () => {
    rawUsers = [];
    await expect(getOverview()).rejects.toThrow('incomplete owner information');
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
    await expect(getMatchups()).rejects.toThrow('incomplete matchup slate');
  });

  it('rejects an empty matchup response for the current active week', async () => {
    rawMatchups = [];
    await expect(getMatchups()).rejects.toThrow('incomplete matchup slate');
  });

  it('allows an empty matchup response for a future week that has not been posted', async () => {
    rawMatchups = [];
    await expect(getMatchups(18)).resolves.toMatchObject({ week: 18, matchups: [] });
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
    await expect(getMatchups()).rejects.toThrow('invalid matchup grouping');
  });

  it('rejects a matchup row whose matchup ID field is missing', async () => {
    rawMatchups = [{ roster_id: 1, starters: ['qb'] }];
    await expect(getMatchups()).rejects.toThrow(`invalid response for ${leaguePath}/matchups/3`);
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
    const data = await getTransactions(1);
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
    const data = await getTransactions(1);
    expect(data?.warning).toContain('weeks 0');
  });

  it('rejects invalid owner IDs without network requests and returns null for absent owners', async () => {
    expect(await getOwner(0)).toBeNull();
    expect(await getTransactions(NaN)).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
    expect(await getOwner(999)).toBeNull();
  });

  it('falls back to a bounded display week when a query contains an invalid week', async () => {
    const data = await getMatchups(Infinity);
    expect(data.week).toBe(3);
    expect(data.matchups[0].sides[0].points).toBeNull();
    expect(vi.mocked(fetch).mock.calls.some(([url]) => String(url).endsWith('/matchups/3'))).toBe(true);
  });

  it('warns when state is missing and avoids asserting a live or final matchup', async () => {
    failures.add('/state/nfl');
    const data = await getMatchups(1);
    expect(data.warning).toContain('NFL week information is temporarily unavailable');
    expect(data.matchups[0].status).toBe('unknown');
  });

  it('preserves matchup data and warns when NFL kickoff details are unavailable', async () => {
    failures.add('/scores/nfl/regular/2026/3');
    const data = await getMatchups(3);
    expect(data.warning).toContain('Some NFL opponent or kickoff information is temporarily unavailable');
    expect(data.matchups[0].sides[0].starters[0]).toMatchObject({
      name: 'Quarter Back',
      game: { kind: 'scheduled', opponent: 'HOU', location: 'home', kickoffAt: null },
    });
  });
});

describe('Sleeper NFL game details', () => {
  it('adds the requested week opponent, location, and kickoff to each starter', async () => {
    const data = await getMatchups(3);
    expect(data.matchups[0].sides[0].starters[0].game).toEqual({
      kind: 'scheduled', opponent: 'HOU', location: 'home', date: '2026-09-13', kickoffAt: '2026-09-13T17:00:00.000Z',
    });
    expect(vi.mocked(fetch).mock.calls.some(([url]) => String(url).endsWith('/scores/nfl/regular/2026/3'))).toBe(true);
    expect(vi.mocked(fetch).mock.calls.some(([url]) => String(url).endsWith('/schedule/nfl/regular/2026'))).toBe(true);
  });

  it('does not apply the current player-team catalog to historical NFL weeks', async () => {
    const data = await getMatchups(1);
    expect(data.matchups[0].sides[0].starters[0].game).toBeNull();
    expect(vi.mocked(fetch).mock.calls.some(([url]) => String(url).includes('/scores/nfl/regular/2026/1'))).toBe(false);
  });

  it('uses a completed league\'s last scored week and never decorates its Week 18 history', async () => {
    leagueStatus = 'complete';
    leagueLeg = 18;
    lastScoredLeg = 17;
    stateSeason = '2027';
    const latest = await getMatchups();
    const week18 = await getMatchups(18);
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
    await expect(getMatchups(18)).resolves.toMatchObject({ week: 18, matchups: [] });
  });
});

describe('Sleeper current injury metadata', () => {
  it('retains the injury field in the cached catalog for current and earlier matchup weeks', async () => {
    playerInjury = ' Questionable ';
    const current = await getMatchups(3);
    const earlier = await getMatchups(1);
    for (const data of [current, earlier]) {
      expect(data.matchups[0].sides[0].starters[0]).toMatchObject({
        id: 'qb', name: 'Quarter Back', position: 'QB', nflTeam: 'IND', slot: 'QB', points: 12.34, injuryStatus: 'Questionable',
      });
    }
    expect(earlier.week).toBe(1);
  });

  it('shares current injury metadata with owner rosters', async () => {
    playerInjury = 'Out';
    const owner = await getOwner(1);
    expect(owner?.starters[0]).toMatchObject({ name: 'Quarter Back', injuryStatus: 'Out', points: null });
  });

  it.each([null, undefined, '', false, 7, { status: 'Out' }])(
    'does not substitute general player status for an absent or malformed injury_status (%j)', async (value) => {
      playerInjury = value;
      const data = await getMatchups();
      expect(data.matchups[0].sides[0].starters[0]).toMatchObject({ name: 'Quarter Back', injuryStatus: null });
    },
  );

  it('warns when a successful catalog response omits a shown player', async () => {
    playerCatalog = { other: { full_name: 'Other Player', position: 'RB', team: 'SEA' } };
    const owner = await getOwner(1);
    expect(owner?.warning).toContain('did not provide details for 1 player');
    expect(owner?.starters[0].name).toBe('Player qb');
  });

  it('treats a catalog with no usable player identities as unavailable', async () => {
    playerCatalog = { qb: {} };
    const owner = await getOwner(1);
    expect(owner?.warning).toContain('Player names and injury designations are temporarily unavailable');
    expect(owner?.starters[0].name).toBe('Player qb');
  });
});

describe('Sleeper matchup projection integration', () => {
  it('loads current official scores without a static projection on the degraded fallback path', async () => {
    const data = await getOfficialMatchups(3);

    expect(getTank01WeeklyProjectionsMock).not.toHaveBeenCalled();
    expect(data.matchups[0].sides[0]).toMatchObject({
      points: null,
      projectedPoints: null,
      starters: [{ points: 12.34, projectedPoints: null }],
    });
  });

  it('maps an available true-zero offense projection to the starter and team total', async () => {
    getTank01WeeklyProjectionsMock.mockResolvedValueOnce(availableTank01Projection());

    const data = await getMatchups(3);

    expect(getTank01WeeklyProjectionsMock).toHaveBeenCalledWith('2026', 3);
    expect(data.matchups[0].sides[0].starters[0]).toMatchObject({
      id: 'qb', points: 12.34, projectedPoints: 0,
    });
    expect(data.matchups[0].sides[0].projectedPoints).toBe(0);
  });

  it('uses zero for a starter missing from an available Tank01 slate and completes the team total', async () => {
    rawRosters = [{
      roster_id: 1,
      owner_id: 'member-1',
      players: ['qb', 'rb'],
      starters: ['qb', 'rb'],
      settings: { ...rosterSettings },
    }];
    rawMatchups = [{
      roster_id: 1, matchup_id: null, points: 20.34, starters: ['qb', 'rb'], starters_points: [12.34, 8],
    }];
    playerCatalog = {
      qb: { full_name: 'Quarter Back', position: 'QB', team: 'IND' },
      rb: { full_name: 'Running Back', position: 'RB', team: 'IND' },
    };
    const result = availableTank01Projection(['qb']);
    result.projections.bySleeperId.qb.scoringProjection = {
      ...zeroOffenseProjection,
      passingYards: 100,
    };
    getTank01WeeklyProjectionsMock.mockResolvedValueOnce(result);

    const data = await getMatchups(3);
    const side = data.matchups[0].sides[0];

    expect(side.starters.map((player) => [player.id, player.projectedPoints])).toEqual([
      ['qb', 4],
      ['rb', 0],
    ]);
    expect(side.projectedPoints).toBe(4);
    expect(data.warning).toBeUndefined();
  });

  it('uses zero when Tank01 supplies incomplete projected statistics for a starter', async () => {
    const result = availableTank01Projection();
    result.projections.bySleeperId.qb.scoringProjection = {
      ...zeroOffenseProjection,
      passingYards: 100,
      rushingYards: null,
    };
    getTank01WeeklyProjectionsMock.mockResolvedValueOnce(result);

    const data = await getMatchups(3);

    expect(data.matchups[0].sides[0].starters[0].projectedPoints).toBe(0);
    expect(data.matchups[0].sides[0].projectedPoints).toBe(0);
    expect(data.warning).toBeUndefined();
  });

  it('uses zero when an available Tank01 slate has no defense projection', async () => {
    rawRosters = [{
      roster_id: 1,
      owner_id: 'member-1',
      players: ['IND'],
      starters: ['IND'],
      settings: { ...rosterSettings },
    }];
    rawMatchups = [{
      roster_id: 1, matchup_id: null, points: 6, starters: ['IND'], starters_points: [6],
    }];
    playerCatalog = {
      IND: { full_name: 'Indianapolis Colts', position: 'DEF', team: 'IND' },
    };
    getTank01WeeklyProjectionsMock.mockResolvedValueOnce(availableTank01Projection([]));

    const data = await getMatchups(3);

    expect(data.matchups[0].sides[0].starters[0].projectedPoints).toBe(0);
    expect(data.matchups[0].sides[0].projectedPoints).toBe(0);
    expect(data.warning).toBeUndefined();
  });

  it('validates scoring settings before zero-filling a missing defense projection', async () => {
    activeScoringSettings.def_td = 'invalid';
    rawRosters = [{
      roster_id: 1,
      owner_id: 'member-1',
      players: ['IND'],
      starters: ['IND'],
      settings: { ...rosterSettings },
    }];
    rawMatchups = [{
      roster_id: 1, matchup_id: null, points: 6, starters: ['IND'], starters_points: [6],
    }];
    playerCatalog = {
      IND: { full_name: 'Indianapolis Colts', position: 'DEF', team: 'IND' },
    };
    getTank01WeeklyProjectionsMock.mockResolvedValueOnce(availableTank01Projection([]));

    const data = await getMatchups(3);

    expect(data.matchups[0].sides[0].starters[0].projectedPoints).toBeNull();
    expect(data.matchups[0].sides[0].projectedPoints).toBeNull();
    expect(data.warning).toContain('Sleeper league scoring settings were invalid.');
  });

  it('preserves official matchup data and warns when the projection provider fails', async () => {
    rawMatchups = [{
      roster_id: 1, matchup_id: null, points: 55.5, starters: ['qb'], starters_points: [12.34],
    }];
    getTank01WeeklyProjectionsMock.mockResolvedValueOnce({
      status: 'unavailable',
      season: '2026',
      week: 3,
      reason: 'provider-error',
      message: 'Player projections are temporarily unavailable.',
    });

    const data = await getMatchups(3);

    expect(data.matchups[0].sides[0]).toMatchObject({
      points: 55.5,
      projectedPoints: null,
      starters: [{ points: 12.34, projectedPoints: null }],
    });
    expect(data.warning).toContain('Projected scores are temporarily unavailable.');
  });

  it('returns at one second and retains the original projection work with Next after', async () => {
    vi.useFakeTimers();
    let activeProviderWork = 0;
    let providerCompleted = false;
    getTank01WeeklyProjectionsMock.mockImplementationOnce(() => {
      activeProviderWork += 1;
      return new Promise((resolve) => {
        setTimeout(() => {
          activeProviderWork -= 1;
          providerCompleted = true;
          resolve(availableTank01Projection());
        }, 15_000);
      });
    });

    try {
      let pageResolved = false;
      const page = getMatchups(3);
      void page.then(() => { pageResolved = true; });
      await vi.advanceTimersByTimeAsync(0);
      expect(getTank01WeeklyProjectionsMock).toHaveBeenCalledWith('2026', 3);

      await vi.advanceTimersByTimeAsync(999);
      expect(pageResolved).toBe(false);
      expect(afterMock).not.toHaveBeenCalled();
      expect(activeProviderWork).toBe(1);

      await vi.advanceTimersByTimeAsync(1);
      const data = await page;
      expect(data.matchups[0].sides[0]).toMatchObject({
        projectedPoints: null,
        starters: [{ points: 12.34, projectedPoints: null }],
      });
      expect(data.warning).toContain('Projected scores are temporarily unavailable.');
      expect(afterMock).toHaveBeenCalledTimes(1);
      expect(activeProviderWork).toBe(1);

      const afterCallback = afterMock.mock.calls[0]?.[0] as () => Promise<unknown>;
      expect(afterCallback).toEqual(expect.any(Function));
      const afterTask = afterCallback();
      let afterTaskCompleted = false;
      void afterTask.then(() => { afterTaskCompleted = true; });
      await vi.advanceTimersByTimeAsync(13_999);
      expect(afterTaskCompleted).toBe(false);
      expect(activeProviderWork).toBe(1);

      await vi.advanceTimersByTimeAsync(1);
      await afterTask;
      expect(afterTaskCompleted).toBe(true);
      expect(providerCompleted).toBe(true);
      expect(activeProviderWork).toBe(0);
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      await vi.runOnlyPendingTimersAsync();
      vi.useRealTimers();
    }
  });

  it('treats an unexpected projection rejection as optional decoration', async () => {
    getTank01WeeklyProjectionsMock.mockRejectedValueOnce(new Error('Tank01 rejected unexpectedly'));

    const data = await getMatchups(3);

    expect(getTank01WeeklyProjectionsMock).toHaveBeenCalledWith('2026', 3);
    expect(data.matchups[0].sides[0].starters[0]).toMatchObject({ points: 12.34, projectedPoints: null });
    expect(data.warning).toContain('Projected scores are temporarily unavailable.');
  });

  it('keeps a stale player-ID crosswalk unavailable when it does not match Sleeper', async () => {
    const result = availableTank01Projection();
    result.projections.bySleeperId.qb.team = 'SEA';
    getTank01WeeklyProjectionsMock.mockResolvedValueOnce(result);

    const data = await getMatchups(3);

    expect(data.matchups[0].sides[0].starters[0].projectedPoints).toBeNull();
    expect(data.matchups[0].sides[0].projectedPoints).toBeNull();
    expect(data.warning).toBeUndefined();
  });

  it('does not request current projections for a historical matchup week', async () => {
    const data = await getMatchups(1);

    expect(getTank01WeeklyProjectionsMock).not.toHaveBeenCalled();
    expect(data.matchups[0].sides[0]).toMatchObject({
      projectedPoints: null,
      starters: [{ points: 12.34, projectedPoints: null }],
    });
  });
});
