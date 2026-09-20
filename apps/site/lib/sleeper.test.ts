import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { StoredLeagueAuthorityRead } from './projection-store';
import type { AdministrationFamily } from './league-administration/contracts';
import type { LeagueAdministrationStoreRead, AdministrationReadInput } from './league-administration/store-contracts';

const nextCacheEntries = vi.hoisted(() => [] as Array<{
  keys: string[];
  options: { revalidate?: number };
}>);
const reactCacheControl = vi.hoisted(() => ({ enabled: false, generation: 0 }));
const calendarStore = vi.hoisted(() => ({ enabled: false,
  read: vi.fn<(keys: readonly string[]) => Promise<readonly StoredLeagueAuthorityRead[]>>() }));
const administrationStore = vi.hoisted(() => ({
  connection: vi.fn<() => Promise<LeagueAdministrationStoreRead>>(),
  read: vi.fn<(input: AdministrationReadInput) => Promise<LeagueAdministrationStoreRead>>(),
}));

vi.mock('server-only', () => ({}));
vi.mock('./league-administration/store', () => ({ getLeagueAdministrationStore: () => ({
  readSourceByConnection: administrationStore.connection, readSource: administrationStore.read,
}) }));
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
vi.mock('./projection-store', async (original) => ({
  ...await original<typeof import('./projection-store')>(),
  getProjectionStore: () => ({ enabled: calendarStore.enabled, readLeagueLineupAuthorities: calendarStore.read }),
}));
import { LEAGUE_IDS } from './config';
import seasonEvidence from '../test-support/fixtures/sleeper-2026-season-schedule.json';
import { addWaiverBalances, normalizeTeams, type SleeperRoster, type SleeperUser } from './transform';
import {
  getOfficialAdministrationObservation,
  getCurrentLeagueWeek,
  getCurrentMatchupPeriodContext,
  getSiteWeekRollover,
  getFantasyPlayerCatalog,
  getOfficialMatchups,
  getOverview,
  getManagers,
  getManagerHonors,
  getManager,
  getMyTeamSchedule,
  getProjectionCadenceInput,
  getProjectionSyncInput,
  getOperatorProjectionSyncInput,
  getRawLineupMatchups,
  getStandings,
  getLeagueTransactions,
  getRosters,
  getRostersWithMetricContext,
  getTransactions,
  getOfficialLeagueAdministration,
  getOfficialMatchupObservation,
  getOfficialTransactionWeek,
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
// Calendar evidence is independent of raw Sleeper display/leg fields.
let siteScheduleWeek: number;
let siteSeasonEvidence: unknown | undefined;

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
      status: week < siteScheduleWeek || leagueStatus === 'complete' || stateSeason > '2026' ? 'complete' : 'pre_game',
      date: new Date(Date.parse('2026-09-13T00:00:00Z') + (week - siteScheduleWeek) * 7 * 86_400_000).toISOString().slice(0, 10),
      home, away, week, game_id: `${week}-${home}-${away}`,
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
  if (path === '/schedule/nfl/regular/2026') return siteSeasonEvidence ?? seasonSchedule();
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

function retainedCalendar(leagueKey: 'league1' | 'league2', week = 2,
  lifecycle: 'active' | 'complete' = 'active'): StoredLeagueAuthorityRead {
  return { kind: 'available', leagueKey, authority: {
    leagueKey, defaultSeason: 2026, defaultSeasonType: 'reg', defaultWeek: week,
    activeSeason: lifecycle === 'active' ? 2026 : null, activeSeasonType: lifecycle === 'active' ? 'reg' : null,
    activeWeek: lifecycle === 'active' ? week : null, leagueLifecycle: lifecycle,
    nflPhase: 'regular', sourceProvider: 'sleeper', sourceRevision: 'retained-fixture-policy',
    sourceObservedAt: '2026-09-01T16:00:00.000Z', verifiedAt: '2026-09-01T16:00:00.000Z', authorityGeneration: 2,
    lineupShape: { sourceExternalLeagueId: LEAGUE_IDS[leagueKey], expectedRosterCount: 1,
      expectedStarterSlotCount: 1, expectedRosterIds: ['1'] },
    defaultPeriodCadence: { isCurrentRegularPeriod: true, games: [] },
  } };
}

beforeEach(() => {
  administrationStore.connection.mockReset().mockResolvedValue({ status: 'disabled' });
  administrationStore.read.mockReset().mockResolvedValue({ status: 'disabled' });
  calendarStore.enabled = false;
  calendarStore.read.mockReset().mockResolvedValue([]);
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-09-13T16:00:00Z'));
  siteScheduleWeek = 3;
  siteSeasonEvidence = undefined;
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
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function standingsSource(
  week: number,
  official: Array<Record<string, unknown>>,
  history: Record<number, unknown>,
  settings: Record<string, unknown> = {},
) {
  siteScheduleWeek = week;
  expectedRosterCount = official.length;
  rawRosters = official.map((record, index) => ({
    roster_id: index + 1, owner_id: `member-${index + 1}`, players: ['qb'], starters: ['qb'],
    settings: { ...rosterSettings, ...record },
  }));
  rawUsers = official.map((_, index) => ({ user_id: `member-${index + 1}`, display_name: `Manager ${index + 1}` }));
  const concurrency = { active: 0, maximum: 0 };
  vi.mocked(fetch).mockImplementation(async (input) => {
    const path = requestPath(input);
    if (path === '/state/nfl') return Response.json({ season: stateSeason, season_type: seasonType, leg: week, week, display_week: week });
    if (path === leaguePath) {
      const league = valueFor(path) as Record<string, unknown>;
      return Response.json({ ...league, settings: {
        ...(league.settings as Record<string, unknown>), start_week: 1,
        playoff_week_start: 0, league_average_match: 0, best_ball: 0, ...settings,
      } });
    }
    if (path.startsWith(`${leaguePath}/matchups/`)) {
      concurrency.active += 1;
      concurrency.maximum = Math.max(concurrency.maximum, concurrency.active);
      await new Promise((resolve) => setTimeout(resolve, 1));
      concurrency.active -= 1;
      if (failures.has(path)) return new Response('Unavailable', { status: 503 });
      return Response.json(history[Number(path.split('/').at(-1))] ?? []);
    }
    return Response.json(valueFor(path));
  });
  return concurrency;
}

function storedAdministration(family: AdministrationFamily, week: number | null): LeagueAdministrationStoreRead {
  const path = `${leaguePath}${family === 'league' ? '' : `/${family}${week === null ? '' : `/${week}`}`}`;
  return { status: 'available', observationId: `fixture-${family}-${week}`, versionId: 'version', generation: 1,
    checkedAt: new Date(Date.now()).toISOString(), verifiedAt: new Date(Date.now()).toISOString(), envelope: {
      schemaVersion: 'league-administration-v1', normalizerVersion: 'sleeper-administration-v1', dialect: 'sleeper-nfl-v1',
      scope: { leagueKey: 'league1', provider: 'sleeper', externalLeagueId: leagueOneId, season: 2026 },
      family, week, completeness: 'complete', payload: valueFor(path) as never,
      provenance: { origin: 'network', requestStartedAt: '2026-09-12T11:59:59.000Z',
        requestCompletedAt: '2026-09-12T12:00:00.000Z', sourceObservedAt: '2026-09-12T12:00:00.000Z',
        checkedAt: '2026-09-12T12:00:00.000Z' },
    } };
}

describe('stored administration page reads and independent official collection', () => {
  function useStoredAdministration() {
    administrationStore.connection.mockImplementation(async () => storedAdministration('league', null));
    administrationStore.read.mockImplementation(async ({ family, week }) => storedAdministration(family, week));
  }

  it('serves available page administration from storage while retaining the shared NFL/player sources', async () => {
    useStoredAdministration();
    rawMatchups = [{ roster_id: 1, matchup_id: null, points: 12, players: ['qb'], starters: ['qb'], players_points: { qb: 12 } }];
    const [overview, manager, matchups, transactions, rosters] = await Promise.all([
      getOverview(leagueOneId), getManager(leagueOneId, 1), getOfficialMatchups(leagueOneId, 2),
      getLeagueTransactions(leagueOneId, 'league1'), getRosters(leagueOneId, 2),
    ]);
    expect(overview.teams[0].managerName).toBe('Alex');
    expect(manager?.starters[0].id).toBe('qb');
    expect(matchups.week).toBe(2);
    expect(matchups.updatedAt).toBe('2026-09-12T12:00:00.000Z');
    expect(transactions.activities).toHaveLength(1);
    expect(rosters.week).toBe(2);
    expect(vi.mocked(fetch).mock.calls.map(([input]) => requestPath(input)).filter(path => path.startsWith('/league/'))).toEqual([]);
    expect(administrationStore.read).toHaveBeenCalledWith(expect.objectContaining({ family: 'matchups', season: 2026, week: 2 }));
  });

  it('fails a stored connection conflict without requesting replacement league administration', async () => {
    administrationStore.connection.mockResolvedValue({ status: 'conflict', reason: 'identity' });
    await expect(getOverview(leagueOneId)).rejects.toThrow('conflicting');
    expect(vi.mocked(fetch).mock.calls.map(([input]) => requestPath(input)).filter(path => path.startsWith('/league/'))).toEqual([]);
  });

  it('uses the existing read-only official path when accepted administration exceeds the caller TTL', async () => {
    useStoredAdministration();
    administrationStore.read.mockImplementation(async ({ family, week }) => {
      const result = storedAdministration(family, week);
      return result.status === 'available' ? { ...result, verifiedAt: '2026-09-12T12:00:00.000Z' } : result;
    });
    const result = await getLeagueTransactions(leagueOneId, 'league1');
    expect(result.activities).toHaveLength(1);
    expect(vi.mocked(fetch).mock.calls.map(([url]) => requestPath(url))).toContain(`${leaguePath}/transactions/3`);
  });

  it('keeps cadence and full projection collection official even when stored page administration is available', async () => {
    useStoredAdministration();
    makeProjectionWeekReady();
    const cadence = await getProjectionCadenceInput(leagueOneId, new Date().toISOString());
    expect(cadence.administrationObservations?.map(document => document.family)).toEqual(['league', 'rosters']);
    expect(vi.mocked(fetch).mock.calls.map(([input]) => requestPath(input))).not.toContain(`${leaguePath}/users`);
    const input = await getProjectionSyncInput(leagueOneId, { season: 2026, seasonType: 'regular', week: 3 });
    expect(input.administrationObservations?.map(document => document.family)).toEqual(['league', 'rosters', 'users', 'matchups']);
    expect(input.administrationObservations?.find(document => document.family === 'matchups')).toMatchObject({
      origin: 'network', sourceObservedAt: input.requestCompletedAt,
    });
    expect(input.administrationObservations?.find(document => document.family === 'league')).toMatchObject({ origin: 'cache', sourceObservedAt: null });
    expect(administrationStore.connection).not.toHaveBeenCalled();
    expect(administrationStore.read).not.toHaveBeenCalled();
  });

  it('exposes bounded official capture without loading unrelated families', async () => {
    const administration = await getOfficialLeagueAdministration(leagueOneId, { revalidate: 0 });
    expect(administration.map(document => document.family)).toEqual(['league', 'rosters', 'users']);
    expect(administration.every(document => document.origin === 'network' && document.sourceObservedAt === document.requestCompletedAt)).toBe(true);
    expect((await getOfficialTransactionWeek(leagueOneId, 0)).payload).toEqual(valueFor(`${leaguePath}/transactions/0`));
    expect((await getOfficialMatchupObservation(leagueOneId, 2)).week).toBe(2);
    const paths = vi.mocked(fetch).mock.calls.map(([input]) => requestPath(input));
    expect(paths).toEqual([leaguePath, `${leaguePath}/rosters`, `${leaguePath}/users`, `${leaguePath}/transactions/0`, `${leaguePath}/matchups/2`]);
    await expect(getOfficialTransactionWeek(leagueOneId, 19)).rejects.toThrow('target');
    await expect(getOfficialMatchupObservation(leagueOneId, 0)).rejects.toThrow('target');
    expect(fetch).toHaveBeenCalledTimes(5);
  });

  it('honors an expired collection deadline before any administration request', async () => {
    const signal = AbortSignal.abort(new Error('Collection deadline'));
    await expect(getOfficialLeagueAdministration(leagueOneId, { revalidate: 0, signal })).rejects.toThrow('deadline');
    await expect(getOfficialMatchupObservation(leagueOneId, 2, 0, signal)).rejects.toThrow('deadline');
    await expect(getOfficialTransactionWeek(leagueOneId, 0, 0, signal)).rejects.toThrow('deadline');
    await expect(getOfficialAdministrationObservation(leagueOneId, 'league', null, 0, signal)).rejects.toThrow('deadline');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('freshly verifies only the requested changed administration family', async () => {
    const observed = await getOfficialAdministrationObservation(leagueOneId, 'rosters', null);
    expect(observed).toMatchObject({ family: 'rosters', week: null, origin: 'network', sourceObservedAt: observed.requestCompletedAt });
    expect(vi.mocked(fetch).mock.calls.map(([url]) => requestPath(url))).toEqual([`${leaguePath}/rosters`]);
    await expect(getOfficialAdministrationObservation(leagueOneId, 'league', 1)).rejects.toThrow('family');
    await expect(getOfficialAdministrationObservation(leagueOneId, 'matchups', null)).rejects.toThrow('week');
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('propagates the collection deadline signal to the existing HTTP transport', async () => {
    const controller = new AbortController();
    await getOfficialTransactionWeek(leagueOneId, 0, 0, controller.signal);
    const signal = vi.mocked(fetch).mock.calls[0][1]?.signal;
    expect(signal?.aborted).toBe(false);
    controller.abort();
    expect(signal?.aborted).toBe(true);
  });
});

describe('shared schedule-based site calendar', () => {
  it.each([
    ['2026-09-15T15:59:59.999Z', 1],
    ['2026-09-15T16:00:00.000Z', 2],
  ] as const)('uses the same week across both leagues and every loader at %s', async (at, expectedWeek) => {
    vi.setSystemTime(new Date(at));
    siteSeasonEvidence = seasonEvidence.body;
    rawMatchups = [{ roster_id: 1, matchup_id: null, points: null, players: ['qb'], starters: ['qb'] }];
    for (const id of [leagueOneId, leagueTwoId]) {
      const [overview, standings, matchups, rosterLoad, context, cadence, rollover] = await Promise.all([
        getOverview(id), getStandings(id), getOfficialMatchups(id), getRostersWithMetricContext(id),
        getCurrentMatchupPeriodContext(id), getProjectionCadenceInput(id, at), getSiteWeekRollover(id),
      ]);
      expect([overview.league.week, standings.league.week, matchups.week, rosterLoad.data.currentWeek,
        rosterLoad.data.week, context.defaultWeek, context.activeWeek, cadence.week,
        cadence.defaultDisplayWeek, cadence.activeScoringWeek, cadence.currentNflWeek, rollover.week])
        .toEqual(Array(12).fill(expectedWeek));
      expect(cadence.sourceNflWeek).toBe(3); // Raw Sleeper data was not rewritten.
      expect(cadence.siteWeekPolicy).toMatchObject({ evaluatedAt: at });
      expect(rosterLoad.metricContext).toMatchObject({ throughWeek: expectedWeek, provisionalWeek: expectedWeek });
      expect((await getOfficialMatchups(id, 1)).week).toBe(1);
      expect((await getOfficialMatchups(id, 3)).week).toBe(3);
    }
    expect(vi.mocked(fetch).mock.calls.every(([input]) => new URL(String(input)).hostname.startsWith('api.sleeper.'))).toBe(true);
  });

  it('reevaluates unchanged cached schedule evidence when a new request crosses noon', async () => {
    siteSeasonEvidence = seasonEvidence.body;
    reactCacheControl.enabled = true;
    vi.setSystemTime(new Date('2026-09-15T15:59:59.999Z'));
    const before = await getProjectionCadenceInput(leagueOneId);
    reactCacheControl.generation += 1;
    vi.setSystemTime(new Date('2026-09-15T16:00:00.000Z'));
    const after = await getProjectionCadenceInput(leagueOneId);
    expect(before.week).toBe(1);
    expect(after.week).toBe(2);
    expect(before.siteWeekPolicy?.scheduleRevision).toBe(after.siteWeekPolicy?.scheduleRevision);
    expect(before.siteWeekPolicy?.nextRolloverAt).not.toBe(after.siteWeekPolicy?.nextRolloverAt);
  });

  it('shares a single season request with both league calendars and exact-week schedule loads', async () => {
    reactCacheControl.enabled = true;
    await Promise.all([getProjectionCadenceInput(leagueOneId), getProjectionCadenceInput(leagueTwoId),
      getOfficialMatchups(leagueOneId), getOfficialMatchups(leagueTwoId)]);
    expect(vi.mocked(fetch).mock.calls.filter(([input]) => requestPath(input) === '/schedule/nfl/regular/2026')).toHaveLength(1);
  });

  it('does not advance an unfinished game after the scheduled noon boundary', async () => {
    vi.setSystemTime(new Date('2026-09-15T17:00:00Z'));
    siteSeasonEvidence = seasonEvidence.body.map((game) => game.game_id === '202610116'
      ? { ...game, status: 'in_progress' } : game);
    expect(await getCurrentMatchupPeriodContext(leagueOneId)).toMatchObject({ defaultWeek: 1, activeWeek: 1 });
    expect(await getSiteWeekRollover(leagueOneId)).toMatchObject({ week: 1, nextRolloverAt: '2026-09-15T16:00:00.000Z' });
  });

  it('keeps ordinary source data readable while rejecting unavailable calendar authority for workers', async () => {
    failures.add('/schedule/nfl/regular/2026');
    expect(await getCurrentLeagueWeek(leagueOneId)).toBe(3);
    expect(await getOverview(leagueOneId)).toMatchObject({ league: { week: 3 }, warning: expect.stringContaining('calendar is temporarily unavailable') });
    expect(await getCurrentMatchupPeriodContext(leagueOneId)).toMatchObject({ defaultWeek: 3, activeWeek: null });
    expect(await getSiteWeekRollover(leagueOneId)).toMatchObject({ week: 3, nextRolloverAt: null });
    for (const evaluatedAt of [undefined, '2026-09-13T16:00:00.000Z']) {
      await expect(getProjectionCadenceInput(leagueOneId, evaluatedAt)).rejects.toThrow('calendar authority is unavailable for worker cadence');
    }
    const period = { season: 2026, seasonType: 'regular' as const, week: 1 };
    const catalog = vi.fn();
    await expect(getProjectionSyncInput(leagueOneId, period)).rejects.toThrow('calendar authority is unavailable for projection or statistics ingestion');
    await expect(getOperatorProjectionSyncInput(leagueOneId, period, catalog)).rejects.toThrow('calendar authority is unavailable for projection or statistics ingestion');
    expect(catalog).not.toHaveBeenCalled();
    expect(vi.mocked(fetch).mock.calls.some(([input]) => requestPath(input).startsWith('/scores/'))).toBe(false);
  });

  it.each(['http', 'malformed'] as const)('retains both leagues and their official data through a %s schedule outage', async (failure) => {
    if (failure === 'http') failures.add('/schedule/nfl/regular/2026');
    else siteSeasonEvidence = [];
    reactCacheControl.enabled = true;
    calendarStore.enabled = true;
    calendarStore.read.mockImplementation(async (keys) => keys.map((key) => retainedCalendar(key as 'league1' | 'league2')));
    for (const key of ['league1', 'league2'] as const) {
      const id = LEAGUE_IDS[key];
      const pages = await Promise.all([getOverview(id), getStandings(id), getManager(id, 1), getRosters(id),
        getOfficialMatchups(id), getTransactions(id, 1), getLeagueTransactions(id, key)]);
      for (const page of pages) expect(page).toMatchObject({ league: { week: 2 },
        warning: expect.stringContaining('calendar is temporarily unavailable') });
      expect((await getStandings(id)).projectionBasis?.kind).toBe('unavailable');
      expect(await getCurrentMatchupPeriodContext(id)).toMatchObject({ defaultWeek: 2, activeWeek: null });
      expect(await getSiteWeekRollover(id)).toMatchObject({ week: 2, nextRolloverAt: null });
    }
    expect(calendarStore.read.mock.calls).toEqual([[['league1']], [['league2']]]);
    const original = await getOfficialMatchups(leagueOneId);
    expect(original.matchups[0].sides[0]).toMatchObject({ points: null, projectedPoints: null,
      starters: [expect.objectContaining({ points: 12.34 })] });
  });

  it('retains a completed season display when its schedule is unavailable', async () => {
    failures.add('/schedule/nfl/regular/2026');
    leagueStatus = 'complete';
    lastScoredLeg = 17;
    calendarStore.enabled = true;
    calendarStore.read.mockResolvedValue([retainedCalendar('league1', 18, 'complete')]);
    expect(await getOverview(leagueOneId)).toMatchObject({ league: { week: 18 },
      warning: expect.stringContaining('calendar is temporarily unavailable') });
    expect(await getCurrentMatchupPeriodContext(leagueOneId)).toMatchObject({ defaultWeek: 18,
      activeWeek: null, lifecycle: 'complete' });
    await expect(getProjectionCadenceInput(leagueOneId)).rejects.toThrow('calendar authority is unavailable');
  });

  it('does not attach current injury, IR or taxi metadata to a retained fallback week', async () => {
    failures.add('/schedule/nfl/regular/2026');
    calendarStore.enabled = true;
    calendarStore.read.mockResolvedValue([retainedCalendar('league1')]);
    playerInjury = 'Questionable';
    rawRosters = [{ roster_id: 1, owner_id: 'member-1', players: ['qb', 'ir', 'taxi'], starters: ['qb'],
      reserve: ['ir'], taxi: ['taxi'], settings: { ...rosterSettings } }];
    rawMatchups = [{ roster_id: 1, matchup_id: 1, points: 12.34,
      players: ['qb', 'ir', 'taxi'], starters: ['qb'], starters_points: [12.34] }];
    const result = await getRosters(leagueOneId);
    expect(result).toMatchObject({ week: 2, currentWeek: 2 });
    expect(result.teams[0].sections.map((section) => section.name)).toEqual(['Starters', 'Bench']);
    expect(result.teams[0].sections.flatMap((section) => section.players).every((player) => player.injuryStatus === null)).toBe(true);
    expect(result.teams[0].sections[1].players.map((player) => player.id)).toEqual(['ir', 'taxi']);
  });

  it('keeps durable identity conflicts and proved regressions outside the outage fallback', async () => {
    calendarStore.enabled = true;
    const row = retainedCalendar('league1');
    if (row.kind !== 'available') throw new Error('Expected retained authority.');
    calendarStore.read.mockResolvedValue([{ ...row, authority: { ...row.authority, sourceProvider: 'tank01' } }]);
    failures.add('/schedule/nfl/regular/2026');
    await expect(getOverview(leagueOneId)).rejects.toThrow('selected league identity');
    failures.clear();
    calendarStore.read.mockResolvedValue([retainedCalendar('league1', 4)]);
    await expect(getOverview(leagueOneId)).rejects.toThrow('backward week change was rejected');
  });

  it('resumes the validated site calendar after a later request recovers its schedule', async () => {
    calendarStore.enabled = true;
    calendarStore.read.mockResolvedValue([retainedCalendar('league1')]);
    failures.add('/schedule/nfl/regular/2026');
    expect(await getCurrentMatchupPeriodContext(leagueOneId)).toMatchObject({ defaultWeek: 2, activeWeek: null });
    failures.clear();
    expect(await getCurrentMatchupPeriodContext(leagueOneId)).toMatchObject({ defaultWeek: 3, activeWeek: 3 });
    expect((await getOverview(leagueOneId)).warning ?? '').not.toContain('calendar is temporarily unavailable');
  });

  it('includes new-week transactions when every raw Sleeper week field is behind', async () => {
    siteScheduleWeek = 2;
    leagueLeg = 1;
    const originalFetch = vi.mocked(fetch).getMockImplementation()!;
    vi.mocked(fetch).mockImplementation((input, init) => requestPath(input) === '/state/nfl'
      ? Promise.resolve(Response.json({ season: '2026', season_type: 'regular', week: 1, leg: 1, display_week: 1 }))
      : originalFetch(input, init));
    await getLeagueTransactions(leagueOneId, 'league1');
    expect(vi.mocked(fetch).mock.calls.some(([input]) => requestPath(input) === `${leaguePath}/transactions/2`)).toBe(true);
  });

  it('keeps completed Week 18 and its correction schedule when Sleeper later changes phase', async () => {
    vi.setSystemTime(new Date('2027-02-01T17:00:00Z'));
    siteSeasonEvidence = seasonEvidence.body.map((game) => game.status === 'canceled' ? game : { ...game, status: 'complete' });
    lastScoredLeg = 17;
    for (const phase of ['regular', 'post']) {
      seasonType = phase;
      const input = await getProjectionCadenceInput(leagueOneId);
      expect(input).toMatchObject({ week: 18, defaultDisplayWeek: 18, activeScoringWeek: null, leagueLifecycle: 'complete' });
      expect(Object.keys(input.schedule).length).toBe(32);
    }
  });

  it.each([17, 18])('retains exact Week %i schedule for final/correction operators without decorating historical players', async (week) => {
    vi.setSystemTime(new Date('2027-02-01T17:00:00Z'));
    leagueStatus = 'complete';
    makeProjectionWeekReady();
    const source = await getProjectionSyncInput(leagueOneId, { season: 2026, seasonType: 'regular', week });
    expect(source.data.week).toBe(week);
    expect(Object.keys(source.schedule)).toHaveLength(32);
    expect(Object.values(source.schedule).filter((game) => game.kind === 'bye')).toHaveLength(2);
    expect(source.rosteredPlayers.every((player) => player.game === null)).toBe(true);
    expect(source.data.matchups.flatMap((matchup) => matchup.sides)
      .flatMap((side) => side.starters).every((player) => player.game === null)).toBe(true);
  });
});

describe('official basis for projected standings', () => {
  const weekRows = (left: number, right: number) => [
    { roster_id: 1, matchup_id: 1, points: left, players: ['qb'], starters: ['qb'] },
    { roster_id: 2, matchup_id: 1, points: right, players: ['qb'], starters: ['qb'] },
  ];

  it('uses actual Week 1 zero aggregates without fetching matchup history, players, or another provider', async () => {
    standingsSource(1, [{ fpts_against: undefined }, { fpts_against: undefined }], {});
    const original = addWaiverBalances(normalizeTeams(rawRosters as SleeperRoster[], rawUsers as SleeperUser[]), rawRosters as SleeperRoster[], 100);
    const data = await getStandings(leagueOneId);
    expect(data.teams).toEqual(original);
    expect(data.teams.every((team) => team.pointsAgainst === null)).toBe(true);
    expect(data.projectionBasis).toMatchObject({ kind: 'ready', week: 1, teams: [
      { id: 1, wins: 0, losses: 0, ties: 0, pointsFor: 0, pointsAgainst: 0 },
      { id: 2, wins: 0, losses: 0, ties: 0, pointsFor: 0, pointsAgainst: 0 },
    ] });
    expect(vi.mocked(fetch).mock.calls.map(([input]) => requestPath(input)).sort()).toEqual([
      leaguePath, `${leaguePath}/rosters`, `${leaguePath}/users`, '/state/nfl', '/schedule/nfl/regular/2026',
    ].sort());
  });

  it('reuses completed-week history with at most four concurrent cached calls and preserves official OFF values exactly', async () => {
    const concurrency = standingsSource(7, [
      { wins: 6, fpts: 60, fpts_against: 30 }, { losses: 6, fpts: 30, fpts_against: 60 },
    ], Object.fromEntries(Array.from({ length: 6 }, (_, index) => [index + 1, weekRows(10, 5)])));
    const original = addWaiverBalances(normalizeTeams(rawRosters as SleeperRoster[], rawUsers as SleeperUser[]), rawRosters as SleeperRoster[], 100);
    const data = await getStandings(leagueOneId);
    expect(data.teams).toEqual(original);
    expect(data.projectionBasis).toEqual({ kind: 'ready', week: 7, teams: original });
    expect(concurrency.maximum).toBe(4);
    const historyCalls = vi.mocked(fetch).mock.calls.filter(([input]) => requestPath(input).includes('/matchups/'));
    expect(historyCalls).toHaveLength(6);
    expect(historyCalls.map(([input]) => requestPath(input)).sort()).toEqual(Array.from({ length: 6 }, (_, index) => `${leaguePath}/matchups/${index + 1}`));
    expect(historyCalls.every(([, options]) => (options as RequestInit & { next?: { revalidate: number } }).next?.revalidate === 60)).toBe(true);
  });

  it('shares existing cached history with the roster reader without adding a standings cache or provider feed', async () => {
    reactCacheControl.enabled = true;
    standingsSource(3, [
      { wins: 2, fpts: 20, fpts_against: 10 }, { losses: 2, fpts: 10, fpts_against: 20 },
    ], { 1: weekRows(10, 5), 2: weekRows(10, 5), 3: weekRows(2, 1) });
    const [standings, rosters] = await Promise.all([getStandings(leagueOneId), getRosters(leagueOneId, 3)]);
    expect(standings.projectionBasis?.kind).toBe('ready');
    expect(rosters.teams.find((team) => team.id === 1)?.averagePpg).toBe(10);
    for (const week of [1, 2]) expect(vi.mocked(fetch).mock.calls.filter(([input]) => requestPath(input) === `${leaguePath}/matchups/${week}`)).toHaveLength(1);
    expect(vi.mocked(fetch).mock.calls.every(([input]) => new URL(String(input)).hostname.startsWith('api.sleeper.'))).toBe(true);
  });

  it('reconciles official aggregates that already include the active week without including it in the baseline', async () => {
    const previous = weekRows(100, 80);
    previous[0] = { ...previous[0], points: 99, custom_points: 100 } as typeof previous[number];
    standingsSource(2, [
      { wins: 2, fpts: 230, fpts_against: 190 }, { losses: 2, fpts: 190, fpts_against: 230 },
    ], { 1: previous, 2: weekRows(130, 110) }, { last_scored_leg: 2 });
    const data = await getStandings(leagueOneId);
    expect(data.teams[0]).toMatchObject({ wins: 2, pointsFor: 230, pointsAgainst: 190 });
    expect(data.projectionBasis).toMatchObject({ kind: 'ready', week: 2, teams: [
      { id: 1, wins: 1, pointsFor: 100, pointsAgainst: 80 }, { id: 2, losses: 1, pointsFor: 80, pointsAgainst: 100 },
    ] });
    expect(vi.mocked(fetch).mock.calls.filter(([input]) => requestPath(input).includes('/matchups/'))).toHaveLength(2);
  });

  it.each(['failed', 'malformed', 'missing', 'unpaired', 'duplicate'])('retains OFF standings when completed history is %s', async (failure) => {
    let rows: unknown = weekRows(10, 5);
    if (failure === 'malformed') rows = [{ roster_id: 1, matchup_id: 1, points: 'bad' }, weekRows(10, 5)[1]];
    if (failure === 'missing') rows = weekRows(10, 5).slice(1);
    if (failure === 'unpaired') rows = weekRows(10, 5).map((row) => ({ ...row, matchup_id: null }));
    if (failure === 'duplicate') rows = [weekRows(10, 5)[0], weekRows(10, 5)[0], weekRows(10, 5)[1]];
    standingsSource(2, [{ wins: 1, fpts: 10, fpts_against: 5 }, { losses: 1, fpts: 5, fpts_against: 10 }], { 1: rows });
    if (failure === 'failed') failures.add(`${leaguePath}/matchups/1`);
    const original = addWaiverBalances(normalizeTeams(rawRosters as SleeperRoster[], rawUsers as SleeperUser[]), rawRosters as SleeperRoster[], 100);
    const data = await getStandings(leagueOneId);
    expect(data.teams).toEqual(original);
    expect(data.projectionBasis?.kind).toBe('unavailable');
  });

  it('retains OFF manual adjustments when the complete official history cannot explain them', async () => {
    standingsSource(2, [{ wins: 1, fpts: 11, fpts_against: 5 }, { losses: 1, fpts: 5, fpts_against: 10 }], { 1: weekRows(10, 5), 2: weekRows(8, 9) });
    const data = await getStandings(leagueOneId);
    expect(data.teams[0].pointsFor).toBe(11);
    expect(data.projectionBasis).toEqual({ kind: 'unavailable', reason: 'Official standings and completed matchup history do not agree.' });
  });

  it.each([
    { league_average_match: 1 }, { best_ball: 1 }, { divisions: 2 }, { start_week: 2 },
    { playoff_week_start: 2 }, { playoff_week_start: undefined }, { best_ball: undefined },
  ])('does not fetch history for unsupported or unproved settings: %j', async (settings) => {
    standingsSource(2, [{}, {}], {}, settings);
    const data = await getStandings(leagueOneId);
    expect(data.projectionBasis?.kind).toBe('unavailable');
    expect(vi.mocked(fetch).mock.calls.some(([input]) => requestPath(input).includes('/matchups/'))).toBe(false);
  });

  it.each(['pre', 'post'])('does not construct an active-week basis in the %s season phase', async (phase) => {
    standingsSource(2, [{}, {}], {});
    seasonType = phase;
    expect((await getStandings(leagueOneId)).projectionBasis?.kind).toBe('unavailable');
    expect(vi.mocked(fetch).mock.calls.some(([input]) => requestPath(input).includes('/matchups/'))).toBe(false);
  });
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

  it('loads the current league week from cached league, NFL phase and the shared season schedule', async () => {
    await expect(getCurrentLeagueWeek(leagueOneId)).resolves.toBe(3);

    const calls = vi.mocked(fetch).mock.calls;
    expect(calls.map(([input]) => requestPath(input)).sort()).toEqual([leaguePath, '/state/nfl', '/schedule/nfl/regular/2026'].sort());
    expect(calls.map(([, init]) => init)).toEqual([
      expect.objectContaining({ next: { revalidate: 60 } }),
      expect.objectContaining({ next: { revalidate: 60 } }),
      expect.objectContaining({ next: { revalidate: 3600 } }),
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

  it.each([2, 3, 4])('scopes current player status to the active period when loading Week %i', async (week) => {
    makeProjectionWeekReady();
    playerInjury = 'Out';
    const source = await getProjectionSyncInput(leagueOneId, { season: 2026, seasonType: 'regular', week });
    expect(source.currentPlayerStatusPeriod).toEqual(week === 3
      ? { season: 2026, seasonType: 'regular', week: 3 } : null);
    // Carrying period evidence neither changes official points nor rewrites the catalog.
    expect(source.officialPlayerCatalog?.catalog.qb.injury_status).toBe('Out');
    expect(source.rawMatchups).toEqual(rawMatchups);
    const paths = vi.mocked(fetch).mock.calls.map(([request]) => requestPath(request));
    expect(paths.filter(path => path === '/state/nfl')).toHaveLength(1);
    expect(paths.filter(path => path === '/schedule/nfl/regular/2026')).toHaveLength(2);
    expect(paths.filter(path => path === '/players/nfl')).toHaveLength(6);
  });

  it.each(['preseason', 'completed', 'different-season', 'unknown-state'] as const)(
    'does not grant current player-status authority from %s context', async (context) => {
      makeProjectionWeekReady();
      playerInjury = 'Out';
      if (context === 'preseason') seasonType = 'pre';
      if (context === 'completed') leagueStatus = 'complete';
      if (context === 'different-season') stateSeason = '2027';
      if (context === 'unknown-state') failures.add('/state/nfl');
      const source = await getProjectionSyncInput(leagueOneId, { season: 2026, seasonType: 'regular', week: 3 });
      expect(source.currentPlayerStatusPeriod).toBeNull();
      expect(source.officialPlayerCatalog?.catalog.qb.injury_status).toBe('Out');
    },
  );

  it('uses the site rollover instead of Sleeper leg to scope current player status', async () => {
    makeProjectionWeekReady();
    playerInjury = 'Out';
    siteScheduleWeek = 2;
    const source = await getOperatorProjectionSyncInput(leagueOneId,
      { season: 2026, seasonType: 'regular', week: 2 }, async () => ({
        catalog: { qb: { full_name: 'Quarter Back', position: 'QB', team: 'IND', injury_status: 'Out' } },
        complete: true, sourceRevision: 'fixture-status',
      }));
    expect(source.currentPlayerStatusPeriod).toEqual({ season: 2026, seasonType: 'regular', week: 2 });
    expect(source.officialPlayerCatalog?.catalog.qb.injury_status).toBe('Out');
    expect(vi.mocked(fetch).mock.calls.some(([request]) => requestPath(request) === '/players/nfl')).toBe(false);
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

  it.each([null, []])('keeps a missing target-week lineup unknown beside healthy starters (%j)', async (starters) => {
    rosterPositions = ['QB', 'FLEX', 'BN'];
    makeProjectionWeekReady(['qb', '0'], ['rb', '0']);
    rawMatchups[0] = { ...(rawMatchups[0] as Record<string, unknown>), starters };
    const input = await getProjectionSyncInput(leagueOneId, { season: 2026, seasonType: 'regular', week: 18 });
    const sides = input.data.matchups.flatMap((matchup) => matchup.sides);
    expect(sides.find((side) => side.team.id === 1)).toMatchObject({ starters: [], projectedPoints: null });
    expect(sides.find((side) => side.team.id === 2)?.starters.map((player) => player.id)).toEqual(['rb', 'empty-FLEX-1']);
    expect(input.rawMatchups[0].starters).toEqual(starters);
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

  it('keeps championships with the verified owner after renaming and changing teams', async () => {
    const championId = '1119176673112563712';
    expectedRosterCount = 3;
    rawUsers = [
      { user_id: championId, display_name: 'Renamed champion', metadata: { team_name: 'New team name' } },
      { user_id: 'different-owner', display_name: 'jwbaute', metadata: { team_name: '★ ★ ★ ★ ⋆ ⋆' } },
    ];
    rawRosters = [
      { roster_id: 1, owner_id: championId, settings: { ...rosterSettings } },
      { roster_id: 2, owner_id: 'different-owner', settings: { ...rosterSettings } },
      { roster_id: 3, owner_id: null, metadata: { team_name: 'jwbaute' }, settings: { ...rosterSettings } },
    ];
    const before = await getManagers(leagueOneId);
    expect(before.teams.find((team) => team.id === 1)).toMatchObject({
      managerName: 'Renamed champion', name: 'New team name', championshipYears: [2008, 2009, 2014, 2025],
    });
    expect(before.teams.find((team) => team.id === 2)?.championshipYears).toEqual([]);
    expect(before.teams.find((team) => team.id === 3)?.championshipYears).toEqual([]);

    rawRosters = [
      { roster_id: 1, owner_id: 'different-owner', settings: { ...rosterSettings } },
      { roster_id: 2, owner_id: championId, settings: { ...rosterSettings } },
      { roster_id: 3, owner_id: null, settings: { ...rosterSettings } },
    ];
    const after = await getManagers(leagueOneId);
    expect(after.teams.find((team) => team.id === 1)?.championshipYears).toEqual([]);
    expect(after.teams.find((team) => team.id === 2)?.championshipYears).toEqual([2008, 2009, 2014, 2025]);
  });

  it.each(Object.values(LEAGUE_IDS))('decorates only the managers directory for %s without another provider request', async (leagueId) => {
    reactCacheControl.enabled = true;
    const selectedPath = `/league/${leagueId}`;
    vi.mocked(fetch).mockImplementation(async (input) => {
      const path = requestPath(input);
      if (path === selectedPath) return Response.json({
        ...(valueFor(leaguePath) as Record<string, unknown>), league_id: leagueId,
      });
      if (path === `${selectedPath}/rosters`) return Response.json([
        { roster_id: 1, owner_id: '862413379120263168', settings: { ...rosterSettings } },
      ]);
      if (path === `${selectedPath}/users`) return Response.json([
        { user_id: '862413379120263168', display_name: 'Renamed league manager' },
      ]);
      return Response.json(valueFor(path));
    });
    const overview = await getOverview(leagueId);
    const requestsBefore = vi.mocked(fetch).mock.calls.length;
    const managers = await getManagers(leagueId);

    expect(managers.teams[0]).toMatchObject({
      id: 1, managerName: 'Renamed league manager', championshipYears: [2018],
    });
    expect(overview.teams[0]).not.toHaveProperty('championshipYears');
    expect(managers.teams[0]).not.toHaveProperty('ownerId');
    expect(vi.mocked(fetch).mock.calls).toHaveLength(requestsBefore);
    expect(vi.mocked(fetch).mock.calls.map(([input]) => requestPath(input))).toEqual(expect.arrayContaining([
      selectedPath, `${selectedPath}/rosters`, `${selectedPath}/users`,
    ]));
  });

  it('does not transfer honors to another league through matching roster IDs or display names', async () => {
    rawRosters = [{ roster_id: 1, owner_id: '1119176673112563712', settings: { ...rosterSettings } }];
    rawUsers = [{ user_id: '1119176673112563712', display_name: 'Jordan' }];
    const [leagueOne, leagueTwo] = await Promise.all([
      getManagers(leagueOneId), getManagers(leagueTwoId),
    ]);
    expect(leagueOne.teams[0]).toMatchObject({
      id: 1, managerName: 'Jordan', championshipYears: [2008, 2009, 2014, 2025],
    });
    expect(leagueTwo.teams[0]).toMatchObject({
      id: 1, managerName: 'Jordan', championshipYears: [],
    });
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
    expect(paths).toHaveLength(10);
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

  it('retains other roster cards but withholds ambiguous ownership instead of coercing malformed co-owners to null', async () => {
    expectedRosterCount = 2;
    rawRosters = [
      { roster_id: 1, owner_id: 'member-1', co_owners: '862177751849877504', players: ['qb'], starters: ['qb'], settings: { ...rosterSettings } },
      { roster_id: 2, owner_id: 'member-2', co_owners: null, players: [], starters: [], settings: { ...rosterSettings } },
    ];
    rawUsers.push({ user_id: 'member-2', display_name: 'Valid manager' });
    const rosters = await getRosters(leagueOneId);
    expect(rosters.teams.map(team => team.id)).toEqual([2]);
    expect(rosters.warning).toContain('incomplete or malformed data for 1 roster');
    const honors = await getManagerHonors(leagueOneId);
    expect(Object.keys(honors.managers)).toEqual(['2']);
    await expect(getManagers(leagueOneId)).rejects.toThrow(`invalid response for ${leaguePath}/rosters`);
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

describe('Sleeper manager honors presentation', () => {
  const championId = '1119176673112563712';
  const sourceOwnerId = '95628446075863040';

  function serveLeague(leagueId: string) {
    const selectedPath = `/league/${leagueId}`;
    const originalFetch = vi.mocked(fetch).getMockImplementation()!;
    vi.mocked(fetch).mockImplementation(async (input, init) => {
      const path = requestPath(input);
      if (path === selectedPath) return Response.json({
        ...(valueFor(leaguePath) as Record<string, unknown>), league_id: leagueId,
      });
      if (path.startsWith(`${selectedPath}/`)) {
        return Response.json(valueFor(`${leaguePath}${path.slice(selectedPath.length)}`));
      }
      return originalFetch(input, init);
    });
  }

  it('builds separately scoped presentation metadata for every supplied championship owner', async () => {
    const history: Array<[string, number[], number[]]> = [
      [championId, [2008, 2009, 2014, 2025], [2020, 2022]],
      [sourceOwnerId, [2010, 2012, 2017], []],
      ['79628519873069056', [2013, 2016], []],
      ['862413572871917568', [2011, 2024], []],
      ['862823517857697792', [2020], []],
      ['1118641954104934400', [2022], [2017, 2018]],
      ['862775527184920576', [2015], []],
      ['869668648841846784', [2023], [2019]],
      ['862417088369782784', [2019], []],
      ['862413379120263168', [2018], []],
      ['862429971266834432', [2021], []],
    ];
    rawRosters = history.map(([ownerId], index) => ({
      roster_id: index + 1, owner_id: ownerId, settings: { ...rosterSettings },
    }));
    rawUsers = history.map(([ownerId], index) => ({ user_id: ownerId, display_name: `Renamed champion ${index + 1}` }));
    expectedRosterCount = history.length;
    const honors = await getManagerHonors(leagueOneId);
    expect(honors).toEqual({
      leagueId: leagueOneId, season: '2026',
      managers: Object.fromEntries(history.map(([, championshipYears, promotionChampionshipYears], index) => [index + 1, {
        managerName: `Renamed champion ${index + 1}`, championshipYears, promotionChampionshipYears,
      }])),
    });
    expect(JSON.stringify(honors)).not.toContain(championId);
  });

  it.each(Object.values(LEAGUE_IDS))('keeps both title histories with their owner in league %s without new provider requests', async leagueId => {
    const history: Array<[string, number[], number[]]> = [
      [championId, [2008, 2009, 2014, 2025], [2020, 2022]],
      ['1118641954104934400', [2022], [2017, 2018]],
      ['869668648841846784', [2023], [2019]],
      ['1119007388759166976', [], [2024]],
      ['463049625700397056', [], [2021]],
      ['1126328056865566720', [], [2016]],
      ['1119064522163093504', [], [2025]],
      ['unrelated-owner', [], []],
      ['490631449741881344', [], [2023]], // Hsueh / rhsueh2, confirmed by the owner.
    ];
    expectedRosterCount = history.length;
    rawRosters = history.map(([ownerId], index) => ({
      roster_id: index + 1, owner_id: ownerId, settings: { ...rosterSettings },
    }));
    rawUsers = history.map(([ownerId], index) => ({
      user_id: ownerId, display_name: index === 7 ? 'evleath' : `Renamed manager ${index + 1}`,
    }));
    serveLeague(leagueId);
    reactCacheControl.enabled = true;
    const source = JSON.stringify({ rawRosters, rawUsers });
    const overview = await getOverview(leagueId);
    const requestsBefore = vi.mocked(fetch).mock.calls.length;
    const [honors, directory] = await Promise.all([getManagerHonors(leagueId), getManagers(leagueId)]);
    expect(honors.leagueId).toBe(leagueId);
    for (const [index, [, championshipYears, promotionChampionshipYears]] of history.entries()) {
      const expected = {
        managerName: index === 7 ? 'evleath' : `Renamed manager ${index + 1}`,
        championshipYears, promotionChampionshipYears,
      };
      expect(honors.managers[index + 1]).toEqual(expected);
      expect(directory.teams.find(team => team.id === index + 1)).toMatchObject(expected);
    }
    expect(vi.mocked(fetch).mock.calls).toHaveLength(requestsBefore);
    expect(JSON.stringify({ rawRosters, rawUsers })).toBe(source);
    for (const team of overview.teams) {
      expect(team).not.toHaveProperty('championshipYears');
      expect(team).not.toHaveProperty('promotionChampionshipYears');
    }
  });

  it('joins honors to stable ownership after names and roster assignments change', async () => {
    rawUsers = [
      { user_id: championId, display_name: 'Renamed champion' },
      { user_id: 'different-owner', display_name: 'jwbaute' },
    ];
    rawRosters = [
      { roster_id: 1, owner_id: championId, settings: { ...rosterSettings } },
      { roster_id: 2, owner_id: 'different-owner', settings: { ...rosterSettings } },
    ];
    expectedRosterCount = 2;
    const before = await getManagerHonors(leagueOneId);
    expect(before.managers[1]).toEqual({ managerName: 'Renamed champion', championshipYears: [2008, 2009, 2014, 2025], promotionChampionshipYears: [2020, 2022] });
    expect(before.managers[2].championshipYears).toEqual([]);
    (rawRosters[0] as SleeperRoster).owner_id = 'different-owner';
    (rawRosters[1] as SleeperRoster).owner_id = championId;
    const after = await getManagerHonors(leagueOneId);
    expect(after.managers[1]).toEqual({ managerName: 'jwbaute', championshipYears: [], promotionChampionshipYears: [] });
    expect(after.managers[2]).toEqual({ managerName: 'Renamed champion', championshipYears: [2008, 2009, 2014, 2025], promotionChampionshipYears: [2020, 2022] });
  });

  it('does not infer honors from a matching manager or team name or an unassigned owner', async () => {
    rawUsers = [{ user_id: 'different-owner', display_name: 'jwbaute' }];
    rawRosters = [
      { roster_id: 1, owner_id: 'different-owner', settings: { ...rosterSettings } },
      { roster_id: 2, owner_id: null, metadata: { team_name: 'jwbaute' }, settings: { ...rosterSettings } },
    ];
    expectedRosterCount = 2;
    const honors = await getManagerHonors(leagueOneId);
    expect(honors.managers[1].championshipYears).toEqual([]);
    expect(honors.managers[2]?.championshipYears ?? []).toEqual([]);
    expect(honors.managers[1].promotionChampionshipYears).toEqual([]);
    expect(honors.managers[2]?.promotionChampionshipYears ?? []).toEqual([]);
  });

  it.each(Object.values(LEAGUE_IDS))('keeps the League Two correction isolated in honors for %s', async leagueId => {
    rawRosters = [{ roster_id: 1, owner_id: sourceOwnerId, settings: { ...rosterSettings } }];
    rawUsers = [{ user_id: sourceOwnerId, display_name: 'eneerg' }];
    serveLeague(leagueId);
    const honors = await getManagerHonors(leagueId);
    expect(honors.leagueId).toBe(leagueId);
    expect(honors.season).toBe('2026');
    expect(honors.managers[1]).toEqual(leagueId === leagueTwoId
      ? { managerName: 'tylerawildman', championshipYears: [], promotionChampionshipYears: [] }
      : { managerName: 'eneerg', championshipYears: [2010, 2012, 2017], promotionChampionshipYears: [] });
  });

  it('shares accepted page administration reads and leaves original official worker evidence unchanged', async () => {
    rawRosters[0] = {
      roster_id: 1, owner_id: sourceOwnerId, players: ['qb'], starters: ['qb'], settings: { ...rosterSettings },
    };
    rawUsers[0] = { user_id: sourceOwnerId, display_name: 'eneerg' };
    makeProjectionWeekReady();
    serveLeague(leagueTwoId);
    reactCacheControl.enabled = true;
    const overview = await getOverview(leagueTwoId);
    const requestsBefore = vi.mocked(fetch).mock.calls.length;
    const honors = await getManagerHonors(leagueTwoId);
    expect(honors.managers[1]).toEqual({ managerName: 'tylerawildman', championshipYears: [], promotionChampionshipYears: [] });
    expect(vi.mocked(fetch).mock.calls).toHaveLength(requestsBefore);
    expect(overview.teams[0]).not.toHaveProperty('championshipYears');
    expect(overview.teams[0]).not.toHaveProperty('promotionChampionshipYears');
    const input = await getProjectionSyncInput(leagueTwoId, { season: 2026, seasonType: 'regular', week: 3 });
    const originalTeam = normalizeTeams(rawRosters as SleeperRoster[], rawUsers as SleeperUser[])
      .find(team => team.id === 1)!;
    expect(input.data.teams.find(team => team.id === 1)).toEqual(originalTeam);
    expect(input.data.matchups[0].sides.find(side => side.team.id === 1)?.team).toEqual(originalTeam);
    for (const team of input.data.teams) {
      expect(team).not.toHaveProperty('championshipYears');
      expect(team).not.toHaveProperty('promotionChampionshipYears');
    }
    expect(input.administrationObservations?.find(observation => observation.family === 'rosters')?.payload).toEqual(rawRosters);
    expect(input.administrationObservations?.find(observation => observation.family === 'users')?.payload).toEqual(rawUsers);
    expect((rawRosters[0] as SleeperRoster).owner_id).toBe(sourceOwnerId);
    expect((rawUsers[0] as SleeperUser).display_name).toBe('eneerg');
  });

  it('retains valid honors when a different roster is missing or malformed', async () => {
    expectedRosterCount = 3;
    rawRosters = [
      { roster_id: 1, owner_id: championId, settings: { ...rosterSettings } },
      { roster_id: 'malformed', owner_id: sourceOwnerId },
    ];
    rawUsers = [{ user_id: championId, display_name: 'Champion' }, { user_id: sourceOwnerId, display_name: 'eneerg' }];
    const honors = await getManagerHonors(leagueOneId);
    expect(honors.managers).toEqual({ 1: { managerName: 'Champion', championshipYears: [2008, 2009, 2014, 2025], promotionChampionshipYears: [2020, 2022] } });
  });

  it('withholds honors when the assigned champion has no validated user identity', async () => {
    rawRosters = [{ roster_id: 1, owner_id: championId, settings: { ...rosterSettings } }];
    rawUsers = [{ user_id: 'different-owner', display_name: 'jwbaute' }];
    const honors = await getManagerHonors(leagueOneId);
    expect(honors.managers).toEqual({});
  });

  it('withholds honors for conflicting duplicate roster ownership while retaining other valid owners', async () => {
    expectedRosterCount = 2;
    rawRosters = [
      { roster_id: 1, owner_id: championId, settings: { ...rosterSettings } },
      { roster_id: 1, owner_id: 'different-owner', settings: { ...rosterSettings } },
      { roster_id: 2, owner_id: sourceOwnerId, settings: { ...rosterSettings } },
    ];
    rawUsers = [
      { user_id: championId, display_name: 'Champion' },
      { user_id: 'different-owner', display_name: 'Not champion' },
      { user_id: sourceOwnerId, display_name: 'eneerg' },
    ];
    const honors = await getManagerHonors(leagueOneId);
    expect(honors.managers[1]?.championshipYears ?? []).toEqual([]);
    expect(honors.managers[1]?.promotionChampionshipYears ?? []).toEqual([]);
    expect(honors.managers[2]).toEqual({ managerName: 'eneerg', championshipYears: [2010, 2012, 2017], promotionChampionshipYears: [] });
  });
});

describe('Sleeper League Two manager correction', () => {
  const sourceOwnerId = '95628446075863040';

  function useCorrectedOwnerSource(leagueId: string = leagueTwoId) {
    rawRosters[0] = {
      roster_id: 1, owner_id: sourceOwnerId, players: ['qb'], starters: ['qb'],
      settings: { ...rosterSettings, wins: 1, fpts: 105, fpts_decimal: 25 },
    };
    rawUsers[0] = {
      user_id: sourceOwnerId, username: 'eneerg', display_name: 'eneerg', avatar: 'source-avatar',
      metadata: { team_name: 'Official team name' },
    };
    makeProjectionWeekReady();
    rawMatchups = [
      { roster_id: 1, matchup_id: 1, points: 12.34, players: ['qb'], starters: ['qb'], starters_points: [12.34] },
      { roster_id: 2, matchup_id: 1, points: 0, players: [], starters: ['0'], starters_points: [0] },
    ];
    const originalFetch = vi.mocked(fetch).getMockImplementation()!;
    const selectedPath = `/league/${leagueId}`;
    vi.mocked(fetch).mockImplementation(async (input, init) => {
      const path = requestPath(input);
      if (path === selectedPath) return Response.json({
        ...(valueFor(leaguePath) as Record<string, unknown>), league_id: leagueId,
      });
      if (path.startsWith(`${selectedPath}/`)) {
        return Response.json(valueFor(`${leaguePath}${path.slice(selectedPath.length)}`));
      }
      return originalFetch(input, init);
    });
  }

  it('shares the corrected owner across page loaders while preserving team data and cached core reads', async () => {
    useCorrectedOwnerSource();
    reactCacheControl.enabled = true;
    const originalTeam = normalizeTeams(rawRosters as SleeperRoster[], rawUsers as SleeperUser[])
      .find(team => team.id === 1)!;
    const expectedTeam = { ...originalTeam, managerName: 'tylerawildman' };
    const overview = await getOverview(leagueTwoId);
    const coreRequests = vi.mocked(fetch).mock.calls.length;
    const managers = await getManagers(leagueTwoId);
    expect(vi.mocked(fetch).mock.calls).toHaveLength(coreRequests);
    expect(overview.teams.find(team => team.id === 1)).toEqual(expectedTeam);
    expect(managers.teams.find(team => team.id === 1)).toEqual({ ...expectedTeam, championshipYears: [], promotionChampionshipYears: [] });

    const [manager, transactions, standings, matchups, rosters, schedule] = await Promise.all([
      getManager(leagueTwoId, 1), getTransactions(leagueTwoId, 1), getStandings(leagueTwoId),
      getOfficialMatchups(leagueTwoId, 3), getRosters(leagueTwoId, 3), getMyTeamSchedule(leagueTwoId, 14),
    ]);
    expect(manager?.team).toEqual(expectedTeam);
    expect(transactions?.team).toEqual(expectedTeam);
    expect(standings.teams.find(team => team.id === 1)).toMatchObject(expectedTeam);
    expect(rosters.teams.find(team => team.id === 1)).toMatchObject({
      id: expectedTeam.id, managerName: expectedTeam.managerName, name: expectedTeam.name,
      avatar: expectedTeam.avatar, pointsFor: expectedTeam.pointsFor,
      wins: expectedTeam.wins, losses: expectedTeam.losses, ties: expectedTeam.ties,
    });
    expect(matchups.matchups[0].sides.find(side => side.team.id === 1)).toMatchObject({
      team: expectedTeam, points: 12.34, projectedPoints: null,
    });
    expect(schedule.weeks).toHaveLength(14);
    expect(schedule.weeks[0].matchups[0].sides.find(side => side.team.id === 1)?.team).toEqual(expectedTeam);
    for (const suffix of ['/users', '/rosters']) {
      expect(vi.mocked(fetch).mock.calls.filter(([input]) => requestPath(input) === `${leagueTwoPath}${suffix}`))
        .toHaveLength(1);
    }
  });

  it('follows the confirmed source owner after a display-name change, including a partial roster response', async () => {
    useCorrectedOwnerSource();
    (rawUsers[0] as SleeperUser).display_name = 'Renamed Sleeper account';
    expectedRosterCount = 3;
    const rosters = await getRosters(leagueTwoId, 3);
    expect(rosters.teams.find(team => team.id === 1)).toMatchObject({
      id: 1, managerName: 'tylerawildman', name: 'Official team name', pointsFor: 105.25,
    });
    expect(rosters.warning).toContain('incomplete or malformed data');
  });

  it('retains original owner evidence and team presentation in the official worker input', async () => {
    useCorrectedOwnerSource();
    reactCacheControl.enabled = true;
    await getOverview(leagueTwoId);
    const originalTeam = normalizeTeams(rawRosters as SleeperRoster[], rawUsers as SleeperUser[])
      .find(team => team.id === 1)!;
    const input = await getProjectionSyncInput(leagueTwoId, { season: 2026, seasonType: 'regular', week: 3 });
    expect(input.data.teams.find(team => team.id === 1)).toEqual(originalTeam);
    expect(input.data.matchups[0].sides.find(side => side.team.id === 1)?.team).toEqual(originalTeam);
    expect(input.rawMatchups).toEqual(rawMatchups);
    expect(input.administrationObservations?.find(observation => observation.family === 'rosters')?.payload)
      .toEqual(rawRosters);
    expect(input.administrationObservations?.find(observation => observation.family === 'users')?.payload)
      .toEqual(rawUsers);
    expect((rawRosters[0] as SleeperRoster).owner_id).toBe(sourceOwnerId);
    expect((rawUsers[0] as SleeperUser).display_name).toBe('eneerg');
  });

  it.each([LEAGUE_IDS.league1, LEAGUE_IDS.dynasty])('preserves eneerg and his championships in %s', async leagueId => {
    useCorrectedOwnerSource(leagueId);
    const managers = await getManagers(leagueId);
    expect(managers.teams.find(team => team.id === 1)).toMatchObject({
      managerName: 'eneerg', championshipYears: [2010, 2012, 2017],
    });
  });

  it.each(['different-owner', null])('does not transfer the correction to a matching display name with owner %s', async ownerId => {
    useCorrectedOwnerSource();
    (rawRosters[0] as SleeperRoster).owner_id = ownerId;
    (rawUsers[0] as SleeperUser).user_id = ownerId ?? sourceOwnerId;
    const managers = await getManagers(leagueTwoId);
    expect(managers.teams.find(team => team.id === 1)).toMatchObject({
      managerName: ownerId ? 'eneerg' : 'Unassigned manager', championshipYears: [],
    });
  });

  it('does not apply the correction when the source owner moves to another League Two roster', async () => {
    useCorrectedOwnerSource();
    (rawRosters[0] as SleeperRoster).owner_id = 'member-2';
    (rawRosters[1] as SleeperRoster).owner_id = sourceOwnerId;
    const managers = await getManagers(leagueTwoId);
    expect(managers.teams.find(team => team.id === 1)?.managerName).toBe('Sam');
    expect(managers.teams.find(team => team.id === 2)).toMatchObject({
      managerName: 'eneerg', championshipYears: [2010, 2012, 2017],
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

  it('retains the completed NFL calendar week without decorating completed-season history', async () => {
    vi.setSystemTime(new Date('2027-02-01T17:00:00Z'));
    leagueStatus = 'complete';
    leagueLeg = 18;
    lastScoredLeg = 17;
    stateSeason = '2027';
    const latest = await getOfficialMatchups(leagueOneId);
    const week18 = await getOfficialMatchups(leagueOneId, 18);
    expect(latest.week).toBe(18);
    expect(latest.matchups[0].sides[0].starters[0].game).toBeNull();
    expect(week18.matchups[0].sides[0].starters[0].game).toBeNull();
    expect(vi.mocked(fetch).mock.calls.some(([url]) => String(url).includes('/schedule/nfl/regular/2026'))).toBe(true);
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
  it.each([1, 3])('defaults page data to active Week 2 with display Week %i', async (displayWeek) => {
    siteScheduleWeek = 2;
    const originalFetch = vi.mocked(fetch).getMockImplementation()!;
    vi.mocked(fetch).mockImplementation((input, init) => requestPath(input) === '/state/nfl'
      ? Promise.resolve(Response.json({ season: '2026', season_type: 'regular', week: 2, leg: 2, display_week: displayWeek }))
      : originalFetch(input, init));

    expect((await getOfficialMatchups(leagueOneId)).week).toBe(2);
    expect((await getOfficialMatchups(leagueOneId, 1)).week).toBe(1);
    expect((await getStandings(leagueOneId)).league.week).toBe(2);
    expect((await getOverview(leagueOneId)).league.week).toBe(2);
    expect(await getCurrentMatchupPeriodContext(leagueOneId)).toMatchObject({
      defaultWeek: 2, activeWeek: 2, temporalState: 'active',
    });
    expect(await getCurrentMatchupPeriodContext(leagueOneId, 1)).toMatchObject({
      defaultWeek: 2, activeWeek: 2, temporalState: 'past',
    });
  });

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
  it('uses the active scoring week when display week lags, isolating a null starter list', async () => {
    siteScheduleWeek = 2;
    expectedRosterCount = 2;
    playerInjury = 'Questionable';
    rawRosters = [
      { roster_id: 1, owner_id: 'member-1', players: ['qb', 'ir', 'taxi'], starters: ['qb'],
        reserve: ['ir'], taxi: ['taxi'], settings: { ...rosterSettings } },
      { roster_id: 2, owner_id: 'member-2', players: ['rb'], starters: ['rb'], settings: { ...rosterSettings } },
    ];
    rawUsers.push({ user_id: 'member-2', display_name: 'Beta' });
    rawMatchups = [
      { roster_id: 1, matchup_id: 1, points: null, players: ['qb', 'ir', 'taxi'], starters: ['qb'] },
      { roster_id: 2, matchup_id: 1, points: null, players: ['rb'], starters: null },
    ];
    const originalFetch = vi.mocked(fetch).getMockImplementation()!;
    vi.mocked(fetch).mockImplementation((input, init) => requestPath(input) === '/state/nfl'
      ? Promise.resolve(Response.json({ season: '2026', season_type: 'regular', week: 2, leg: 2, display_week: 1 }))
      : originalFetch(input, init));

    const { data, metricContext } = await getRostersWithMetricContext(leagueOneId);
    expect(data).toMatchObject({ week: 2, currentWeek: 2, rostersAvailable: true, league: { week: 2 } });
    expect(metricContext).toMatchObject({ throughWeek: 2, provisionalWeek: 2, activeWeekKnown: true });
    const ready = data.teams.find((team) => team.id === 1)!;
    expect(ready.rosterAvailable).toBe(true);
    expect(ready.sections.map((section) => section.name)).toEqual(['Starters', 'Bench', 'IR', 'Taxi']);
    expect(ready.sections[0].players[0]).toMatchObject({ id: 'qb', injuryStatus: 'Questionable' });
    expect(data.teams.find((team) => team.id === 2)).toMatchObject({ rosterAvailable: false, sections: [] });
    expect(data.warning ?? '').not.toContain('future week');
    expect((rawMatchups[1] as { starters: null }).starters).toBeNull();

    const future = await getRosters(leagueOneId, 4);
    expect(future.rostersAvailable).toBe(true);
    expect(future.teams.find((team) => team.id === 1)?.rosterAvailable).toBe(true);
    expect(future.teams.find((team) => team.id === 2)).toMatchObject({ rosterAvailable: false, sections: [] });

    const historical = await getRosters(leagueOneId, 1);
    expect(historical).toMatchObject({ week: 1, currentWeek: 2, league: { week: 2 } });
    expect(historical.teams.find((team) => team.id === 1)!.sections.map((section) => section.name))
      .toEqual(['Starters', 'Bench']);
    expect(historical.teams.flatMap((team) => team.sections.flatMap((section) => section.players))
      .every((player) => player.injuryStatus === null)).toBe(true);
    expect(vi.mocked(fetch).mock.calls.every(([input]) => new URL(String(input)).hostname.startsWith('api.sleeper.'))).toBe(true);
  });

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

  it.each([
    { name: 'advanced display week', state: { season: '2026', season_type: 'regular', leg: 1, week: 1, display_week: 2 }, selectedWeek: 2, displayWeek: 1 },
    { name: 'preseason', state: { season: '2026', season_type: 'pre', leg: 2, week: 2, display_week: 2 }, selectedWeek: 2, displayWeek: 1 },
    { name: 'missing NFL state', state: null, selectedWeek: 4, displayWeek: 3 },
  ])('keeps future lineup readiness strict with $name', async ({ state, selectedWeek, displayWeek }) => {
    siteScheduleWeek = displayWeek;
    rawMatchups = [{ roster_id: 1, matchup_id: null, points: null, players: ['qb'], starters: ['qb'] }];
    const originalFetch = vi.mocked(fetch).getMockImplementation()!;
    vi.mocked(fetch).mockImplementation((input, init) => requestPath(input) === '/state/nfl'
      ? Promise.resolve(state === null ? new Response('Unavailable', { status: 503 }) : Response.json(state))
      : originalFetch(input, init));

    const data = await getRosters(leagueOneId, selectedWeek);
    expect(data).toMatchObject({ week: selectedWeek, currentWeek: displayWeek, rostersAvailable: false });
    expect(data.teams[0]).toMatchObject({ rosterAvailable: false, sections: [] });
    expect(data.warning).toContain('has not established complete lineups for this future week');
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
    vi.setSystemTime(new Date('2027-02-01T17:00:00Z'));
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
