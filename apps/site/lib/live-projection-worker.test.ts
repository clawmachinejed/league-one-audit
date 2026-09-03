import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('next/cache', () => ({ unstable_cache: <Value,>(value: Value) => value }));

import type { WeekSchedule } from './nfl-schedule';
import { createLiveProjectionWorker, LIVE_PROJECTION_MODEL_VERSION } from './live-projection-worker';
import type { Tank01GameState } from './tank01-game-state';
import type { Player } from './types';
import {
  NOW,
  cadenceInput,
  fakeStore,
  fullWeekSchedule,
  gameState,
  gameStates,
  matchupData,
  player,
  projectionResult,
  schedule,
  source,
  workerDependencies,
} from './live-projection-worker.fixtures';

describe('live projection worker', () => {
  afterEach(() => vi.restoreAllMocks());

  it('returns disabled without loading cadence, claiming a job, or calling providers', async () => {
    const store = fakeStore(true, false);
    const dependencies = workerDependencies(store);

    await expect(createLiveProjectionWorker(dependencies).run()).resolves.toEqual({ status: 'disabled' });
    expect(dependencies.cadenceMock).not.toHaveBeenCalled();
    expect(dependencies.sourceMock).not.toHaveBeenCalled();
    expect(dependencies.projectionMock).not.toHaveBeenCalled();
    expect(dependencies.gamesMock).not.toHaveBeenCalled();
    expect(store.acquired).not.toHaveBeenCalled();
    expect(store.operations).toEqual([]);
  });

  it.each(['busy', 'completed'] as const)(
    'returns the lease %s outcome without loading league or provider data',
    async (kind) => {
      const store = fakeStore();
      store.acquired.mockResolvedValueOnce({ kind });
      const dependencies = workerDependencies(store);

      await expect(createLiveProjectionWorker(dependencies).run()).resolves.toEqual({
        status: 'skipped', reason: kind, cadence: null,
      });
      expect(dependencies.cadenceMock).toHaveBeenCalledOnce();
      expect(dependencies.sourceMock).not.toHaveBeenCalled();
      expect(dependencies.projectionMock).not.toHaveBeenCalled();
      expect(dependencies.gamesMock).not.toHaveBeenCalled();
      expect(store.completed).not.toHaveBeenCalled();
      expect(store.failed).not.toHaveBeenCalled();
    },
  );

  it('preflights one seed league and makes no Neon or provider calls while idle', async () => {
    const store = fakeStore();
    const idleSchedule = fullWeekSchedule('2026-09-20T17:00:00.000Z');
    const dependencies = workerDependencies(store, {
      cadence: cadenceInput('l1', idleSchedule),
      now: new Date('2026-09-13T18:10:10.000Z'),
    });

    await expect(createLiveProjectionWorker(dependencies).run()).resolves.toEqual({
      status: 'skipped', reason: 'idle', cadence: 'idle',
    });
    expect(dependencies.cadenceMock).toHaveBeenCalledOnce();
    expect(dependencies.cadenceMock).toHaveBeenCalledWith('l1');
    expect(store.acquired).not.toHaveBeenCalled();
    expect(dependencies.sourceMock).not.toHaveBeenCalled();
    expect(dependencies.projectionMock).not.toHaveBeenCalled();
    expect(dependencies.gamesMock).not.toHaveBeenCalled();
  });

  it('does not use the hourly fallback throughout the offseason', async () => {
    const store = fakeStore();
    const distantWeekOneSchedule: WeekSchedule = {
      LAC: {
        kind: 'scheduled', opponent: 'KC', location: 'away', date: '2026-09-13',
        kickoffAt: '2026-09-13T17:00:00.000Z',
      },
    };
    const dependencies = workerDependencies(store, {
      cadence: {
        ...cadenceInput('l1', distantWeekOneSchedule),
        currentNflSeasonType: 'off',
      },
      now: new Date('2026-03-01T18:00:10.000Z'),
    });

    await expect(createLiveProjectionWorker(dependencies).run()).resolves.toEqual({
      status: 'skipped', reason: 'idle', cadence: 'idle',
    });
    expect(store.acquired).not.toHaveBeenCalled();
    expect(dependencies.sourceMock).not.toHaveBeenCalled();
    expect(dependencies.projectionMock).not.toHaveBeenCalled();
    expect(dependencies.gamesMock).not.toHaveBeenCalled();
  });

  it('does not use a stale rolled-over league as an offseason hourly fallback', async () => {
    const store = fakeStore();
    const staleSchedule: WeekSchedule = {
      LAC: {
        kind: 'scheduled', opponent: 'KC', location: 'away', date: '2025-12-28',
        kickoffAt: '2025-12-28T18:00:00.000Z',
      },
    };
    const dependencies = workerDependencies(store, { now: new Date('2026-03-01T18:00:10.000Z') });
    dependencies.cadenceMock.mockImplementation(async (leagueId: string) => ({
      sleeperLeagueId: leagueId,
      season: '2025',
      week: 18,
      schedule: staleSchedule,
      currentNflSeason: '2026',
      currentNflWeek: 1,
      currentNflSeasonType: 'pre',
    }));

    await expect(createLiveProjectionWorker(dependencies).run()).resolves.toEqual({
      status: 'skipped', reason: 'idle', cadence: 'idle',
    });
    expect(dependencies.cadenceMock).toHaveBeenCalledTimes(2);
    expect(store.acquired).not.toHaveBeenCalled();
    expect(dependencies.sourceMock).not.toHaveBeenCalled();
    expect(dependencies.projectionMock).not.toHaveBeenCalled();
    expect(dependencies.gamesMock).not.toHaveBeenCalled();
  });

  it('refuses a forced run when no configured league matches the current NFL period', async () => {
    const store = fakeStore();
    const dependencies = workerDependencies(store);
    dependencies.cadenceMock.mockImplementation(async (leagueId: string) => ({
      sleeperLeagueId: leagueId,
      season: '2025',
      week: 18,
      schedule: {},
      currentNflSeason: '2026',
      currentNflWeek: 1,
      currentNflSeasonType: 'pre',
    }));

    await expect(createLiveProjectionWorker(dependencies).run({ force: true }))
      .resolves.toEqual({ status: 'failed' });
    expect(dependencies.cadenceMock).toHaveBeenCalledTimes(2);
    expect(store.acquired).not.toHaveBeenCalled();
    expect(dependencies.sourceMock).not.toHaveBeenCalled();
    expect(dependencies.projectionMock).not.toHaveBeenCalled();
    expect(dependencies.gamesMock).not.toHaveBeenCalled();
  });

  it('shares Tank01 calls, accepts halftime without a raw clock, and publishes one coherent two-league run', async () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const store = fakeStore();
    const dependencies = workerDependencies(store);
    const result = await createLiveProjectionWorker(dependencies).run();

    expect(result).toEqual({
      status: 'completed', cadence: 'live-window', publishedLeagues: 2, failedLeagues: 0, providerGroups: 1,
    });
    expect(store.acquired).toHaveBeenCalledWith({
      jobKey: 'live-projection-sync',
      jobType: 'live-projection-sync',
      scheduledFor: '2026-09-13T18:00:00.000Z',
      payload: { modelVersion: 'clock-v1', forced: false },
      workerId: 'worker-1',
      leaseSeconds: 120,
    });
    expect(dependencies.sourceMock).toHaveBeenCalledTimes(2);
    expect(dependencies.projectionMock).toHaveBeenCalledOnce();
    expect(dependencies.gamesMock).toHaveBeenCalledOnce();
    expect(store.frozen).toHaveBeenCalledTimes(2);
    expect(store.published).toHaveLength(2);
    expect(store.publishInputs.map((input) => ({
      leagueSeasonId: input.leagueSeasonId,
      week: input.week,
      modelVersion: input.modelVersion,
      calculatedAt: input.calculatedAt,
      revisionKey: input.revisionKey,
    }))).toEqual([
      {
        leagueSeasonId: 'season-league1',
        week: 1,
        modelVersion: 'clock-v1',
        calculatedAt: NOW.toISOString(),
        revisionKey: '085f88d9c1d808d29099dc4b7c013f4946fde0bddd56dc1a4429a3e16752fdb1',
      },
      {
        leagueSeasonId: 'season-league2',
        week: 1,
        modelVersion: 'clock-v1',
        calculatedAt: NOW.toISOString(),
        revisionKey: '085f88d9c1d808d29099dc4b7c013f4946fde0bddd56dc1a4429a3e16752fdb1',
      },
    ]);
    expect(store.activityWindows).toEqual([
      [{ startsAt: '2026-09-13T15:00:00.000Z', endsAt: '2026-09-14T00:00:00.000Z' }],
      [{ startsAt: '2026-09-13T15:00:00.000Z', endsAt: '2026-09-14T00:00:00.000Z' }],
    ]);
    for (const payload of store.published) {
      const [left, right] = payload.matchups[0].sides;
      expect(payload.matchups[0].status).toBe('live');
      expect(left.starters.map((starter) => starter.projectedPoints)).toEqual([13, 4.5]);
      expect(left.projectedPoints).toBe(17.5);
      expect(right.starters[0].projectedPoints).toBe(11);
      expect(right.projectedPoints).toBe(11);
      expect(payload.updatedAt).toBe(NOW.toISOString());
    }
    expect(store.completed).toHaveBeenCalledOnce();
    expect(store.failed).not.toHaveBeenCalled();
    expect(store.operations).toEqual([
      'acquire-job',
      'upsert-nfl-games',
      'record-game-states',
      'upsert-scoring-entities',
      'register-league-season',
      'register-league-season',
      'record-projection-candidates',
      'record-projection-candidates',
      'freeze-latest-baselines',
      'freeze-latest-baselines',
      'read-latest-candidates',
      'read-frozen-baselines',
      'read-current-snapshot',
      'read-latest-candidates',
      'read-frozen-baselines',
      'read-current-snapshot',
      'record-league-week-observation',
      'record-league-week-observation',
      'publish-snapshot',
      'publish-snapshot',
      'complete-job',
    ]);
    expect(info.mock.calls.map(([entry]) => JSON.parse(String(entry)))).toEqual([
      { service: 'live-projection-sync', stage: 'lease', outcome: 'started' },
      {
        service: 'live-projection-sync', stage: 'run', outcome: 'completed',
        publishedLeagues: 2, failedLeagues: 0,
      },
    ]);
    expect(LIVE_PROJECTION_MODEL_VERSION).toBe('clock-v1');
  });

  it('fails closed before persistence when Tank01 returns a broadly truncated projection slate', async () => {
    const store = fakeStore();
    const dependencies = workerDependencies(store);
    const partial = projectionResult();
    dependencies.projectionMock.mockResolvedValue({
      ...partial,
      projections: {
        ...partial.projections,
        bySleeperId: { p1: partial.projections.bySleeperId.p1 },
      },
      coverage: {
        ...partial.coverage,
        playerProjectionRows: 1,
        matchedPlayerProjections: 1,
      },
    });

    await expect(createLiveProjectionWorker(dependencies).run()).resolves.toEqual({ status: 'failed' });
    expect(store.gamesUpserted).toHaveLength(0);
    expect(store.published).toHaveLength(0);
    expect(store.completed).not.toHaveBeenCalled();
    expect(store.failed).toHaveBeenCalledOnce();
  });

  it('fails closed before persistence when broad player identities have unusable stat lines', async () => {
    const store = fakeStore();
    const dependencies = workerDependencies(store);
    const partial = projectionResult();
    dependencies.projectionMock.mockResolvedValue({
      ...partial,
      projections: {
        ...partial.projections,
        bySleeperId: Object.fromEntries(Object.entries(partial.projections.bySleeperId).map(
          ([id, projection]) => [id, {
            ...projection,
            scoringProjection: { ...projection.scoringProjection, passingTouchdowns: null },
          }],
        )),
      },
    });

    await expect(createLiveProjectionWorker(dependencies).run()).resolves.toEqual({ status: 'failed' });
    expect(store.gamesUpserted).toHaveLength(0);
    expect(store.published).toHaveLength(0);
    expect(store.completed).not.toHaveBeenCalled();
    expect(store.failed).toHaveBeenCalledOnce();
  });

  it('calls both shared providers once and fails the whole provider group when both are unavailable', async () => {
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const store = fakeStore();
    const dependencies = workerDependencies(store);
    dependencies.projectionMock.mockResolvedValue({
      status: 'unavailable', season: '2026', week: 1,
      reason: 'provider-error', message: 'projection provider unavailable',
    });
    dependencies.gamesMock.mockResolvedValue({
      status: 'unavailable', season: '2026', week: 1,
      reason: 'provider-error', message: 'game provider unavailable',
    });

    await expect(createLiveProjectionWorker(dependencies).run()).resolves.toEqual({ status: 'failed' });
    expect(dependencies.projectionMock).toHaveBeenCalledOnce();
    expect(dependencies.projectionMock).toHaveBeenCalledWith('2026', 1);
    expect(dependencies.gamesMock).toHaveBeenCalledOnce();
    expect(dependencies.gamesMock).toHaveBeenCalledWith('2026', 1);
    expect(store.gamesUpserted).toEqual([]);
    expect(store.published).toEqual([]);
    expect(store.completed).not.toHaveBeenCalled();
    expect(store.failed).toHaveBeenCalledOnce();
    expect(warning.mock.calls.map(([entry]) => JSON.parse(String(entry)))).toEqual([{
      service: 'live-projection-sync', stage: 'provider-load', outcome: 'failed', season: '2026', week: 1,
    }]);
    expect(error.mock.calls.map(([entry]) => JSON.parse(String(entry)))).toEqual([{
      service: 'live-projection-sync', stage: 'league-publish', outcome: 'failed',
    }]);
  });

  it('persists kickoff time for a game represented only by a rostered bench player', async () => {
    const store = fakeStore();
    const dependencies = workerDependencies(store);
    const benchKickoff = '2026-09-13T20:25:00.000Z';
    const bench: Player = {
      ...player('bench', 'Bench Player', 'RB', 'LAC', 0),
      nflTeam: 'BUF',
      game: {
        kind: 'scheduled', opponent: 'MIA', location: 'home', date: '2026-09-13', kickoffAt: benchKickoff,
      },
    };
    const extendedSchedule: WeekSchedule = {
      ...schedule,
      BUF: bench.game!,
      MIA: {
        kind: 'scheduled', opponent: 'BUF', location: 'away', date: '2026-09-13', kickoffAt: benchKickoff,
      },
    };
    dependencies.sourceMock.mockImplementation(async (leagueId: string) => {
      const value = source(leagueId);
      return { ...value, schedule: extendedSchedule, rosteredPlayers: [...value.rosteredPlayers, bench] };
    });
    const secondGame: Tank01GameState = {
      ...gameState(),
      gameId: 'game-2',
      homeTeam: 'BUF',
      awayTeam: 'MIA',
      statusCode: 0,
      statusText: 'Scheduled',
      period: null,
      clock: null,
      phase: 'pregame',
      clockSeconds: null,
      remainingFraction: 1,
    };
    const firstGame = gameState();
    dependencies.gamesMock.mockResolvedValue({
      ...gameStates(firstGame),
      games: [firstGame, secondGame],
      byTeam: { KC: firstGame, LAC: firstGame, BUF: secondGame, MIA: secondGame },
    });

    await expect(createLiveProjectionWorker(dependencies).run()).resolves.toMatchObject({ status: 'completed' });
    expect(store.gamesUpserted).toContainEqual(expect.objectContaining({
      key: 'game-2', kickoffAt: benchKickoff,
    }));
  });

  it('fails closed and retains the prior snapshot when Tank01 omits a starter game', async () => {
    const store = fakeStore();
    const unrelated: Tank01GameState = {
      ...gameState(), gameId: 'unrelated', homeTeam: 'BUF', awayTeam: 'MIA',
    };
    const dependencies = workerDependencies(store, { games: gameStates(unrelated) });

    await expect(createLiveProjectionWorker(dependencies).run()).resolves.toEqual({ status: 'failed' });
    expect(store.published).toHaveLength(0);
    expect(store.completed).not.toHaveBeenCalled();
    expect(store.failed).toHaveBeenCalledOnce();
  });

  it('rejects a live game without a normalized phase or remaining fraction after shared provider persistence', async () => {
    const store = fakeStore();
    const invalidLiveState: Tank01GameState = {
      ...gameState(),
      statusText: 'In Progress',
      period: null,
      phase: 'unknown',
      remainingFraction: null,
    };
    const dependencies = workerDependencies(store, { games: gameStates(invalidLiveState) });

    await expect(createLiveProjectionWorker(dependencies).run()).resolves.toEqual({ status: 'failed' });
    expect(dependencies.projectionMock).toHaveBeenCalledOnce();
    expect(dependencies.gamesMock).toHaveBeenCalledOnce();
    expect(store.gamesUpserted).toHaveLength(1);
    expect(store.recordedStates).toHaveBeenCalledOnce();
    expect(store.published).toEqual([]);
    expect(store.completed).not.toHaveBeenCalled();
    expect(store.failed).toHaveBeenCalledOnce();
  });

  it('does not publish a final matchup when Sleeper omits one starter official score', async () => {
    const store = fakeStore();
    const finalGame: Tank01GameState = {
      ...gameState(),
      statusCode: 2,
      statusText: 'Final',
      period: 'Final',
      phase: 'final',
      remainingFraction: 0,
    };
    const dependencies = workerDependencies(store, { games: gameStates(finalGame) });
    dependencies.sourceMock.mockImplementation(async (leagueId: string) => {
      const data = matchupData();
      return source(leagueId, {
        ...data,
        matchups: data.matchups.map((matchup) => ({
          ...matchup,
          sides: matchup.sides.map((side) => ({
            ...side,
            starters: side.starters.map((starter) => (
              starter.id === 'p1' ? { ...starter, points: null } : starter
            )),
          })),
        })),
      });
    });

    await expect(createLiveProjectionWorker(dependencies).run()).resolves.toEqual({ status: 'failed' });
    expect(store.published).toEqual([]);
    expect(store.completed).not.toHaveBeenCalled();
    expect(store.failed).toHaveBeenCalledOnce();
  });

  it('retains prior snapshots when persisted game-state transition validation rejects a regression', async () => {
    const store = fakeStore();
    store.recordedStates.mockRejectedValueOnce(new Error('Tank01 game state regressed.'));
    const dependencies = workerDependencies(store);

    await expect(createLiveProjectionWorker(dependencies).run()).resolves.toEqual({ status: 'failed' });
    expect(store.published).toHaveLength(0);
    expect(store.completed).not.toHaveBeenCalled();
    expect(store.failed).toHaveBeenCalledOnce();
  });

  it('does not let a stale idle first league hide the active current NFL period', async () => {
    const store = fakeStore();
    const staleSchedule: WeekSchedule = {
      LAC: {
        kind: 'scheduled', opponent: 'KC', location: 'away', date: '2025-12-28',
        kickoffAt: '2025-12-28T18:00:00.000Z',
      },
    };
    const dependencies = workerDependencies(store);
    dependencies.cadenceMock.mockImplementation(async (leagueId: string) => leagueId === 'l1'
      ? {
          sleeperLeagueId: leagueId,
          season: '2025',
          week: 18,
          schedule: staleSchedule,
          currentNflSeason: '2026',
          currentNflWeek: 1,
          currentNflSeasonType: 'regular',
        }
      : cadenceInput(leagueId));

    await expect(createLiveProjectionWorker(dependencies).run()).resolves.toMatchObject({
      status: 'completed', cadence: 'live-window', publishedLeagues: 2,
    });
    expect(dependencies.cadenceMock).toHaveBeenNthCalledWith(1, 'l1');
    expect(dependencies.cadenceMock).toHaveBeenNthCalledWith(2, 'l2');
    expect(store.acquired).toHaveBeenCalledOnce();
  });

  it('does not call Tank01 for a secondary league that still points to the prior season', async () => {
    const store = fakeStore();
    const dependencies = workerDependencies(store);
    dependencies.sourceMock.mockImplementation(async (leagueId: string) => {
      const value = source(leagueId);
      return leagueId === 'l2'
        ? {
            ...value,
            data: {
              ...value.data,
              league: { ...value.data.league, season: '2025', week: 18 },
              week: 18,
            },
          }
        : value;
    });

    await expect(createLiveProjectionWorker(dependencies).run()).resolves.toEqual({
      status: 'completed', cadence: 'live-window', publishedLeagues: 1,
      failedLeagues: 1, providerGroups: 1,
    });
    expect(dependencies.projectionMock).toHaveBeenCalledOnce();
    expect(dependencies.projectionMock).toHaveBeenCalledWith('2026', 1);
    expect(dependencies.gamesMock).toHaveBeenCalledOnce();
    expect(dependencies.gamesMock).toHaveBeenCalledWith('2026', 1);
    expect(store.published).toHaveLength(1);
  });

  it('publishes a healthy league when another Sleeper league is temporarily unavailable', async () => {
    const store = fakeStore();
    const dependencies = workerDependencies(store);
    dependencies.cadenceMock.mockImplementation(async (leagueId: string) => {
      if (leagueId === 'l1') throw new Error('temporary Sleeper failure');
      return cadenceInput(leagueId);
    });
    dependencies.sourceMock.mockImplementation(async (leagueId: string) => {
      if (leagueId === 'l1') throw new Error('temporary Sleeper failure');
      return source(leagueId);
    });

    await expect(createLiveProjectionWorker(dependencies).run()).resolves.toEqual({
      status: 'completed', cadence: 'live-window', publishedLeagues: 1, failedLeagues: 1, providerGroups: 1,
    });
    expect(dependencies.cadenceMock).toHaveBeenNthCalledWith(1, 'l1');
    expect(dependencies.cadenceMock).toHaveBeenNthCalledWith(2, 'l2');
    expect(store.published).toHaveLength(1);
    expect(store.completed).toHaveBeenCalledOnce();
    expect(store.failed).not.toHaveBeenCalled();
  });

  it('fails the acquired job before provider work when every league source load fails', async () => {
    const store = fakeStore();
    const dependencies = workerDependencies(store);
    dependencies.sourceMock.mockRejectedValue(new Error('Sleeper unavailable'));

    await expect(createLiveProjectionWorker(dependencies).run()).resolves.toEqual({ status: 'failed' });
    expect(dependencies.sourceMock).toHaveBeenCalledTimes(2);
    expect(dependencies.projectionMock).not.toHaveBeenCalled();
    expect(dependencies.gamesMock).not.toHaveBeenCalled();
    expect(store.published).toEqual([]);
    expect(store.completed).not.toHaveBeenCalled();
    expect(store.failed).toHaveBeenCalledOnce();
  });

  it('isolates a mismatched Sleeper source identity and publishes the valid configured league', async () => {
    const store = fakeStore();
    const dependencies = workerDependencies(store);
    dependencies.sourceMock.mockImplementation(async (leagueId: string) => (
      leagueId === 'l1' ? { ...source(leagueId), sleeperLeagueId: 'unexpected-league' } : source(leagueId)
    ));

    await expect(createLiveProjectionWorker(dependencies).run()).resolves.toEqual({
      status: 'completed', cadence: 'live-window', publishedLeagues: 1, failedLeagues: 1, providerGroups: 1,
    });
    expect(dependencies.sourceMock).toHaveBeenCalledTimes(2);
    expect(dependencies.projectionMock).toHaveBeenCalledOnce();
    expect(dependencies.gamesMock).toHaveBeenCalledOnce();
    expect(store.publishInputs.map((input) => input.leagueSeasonId)).toEqual(['season-league2']);
    expect(store.completed).toHaveBeenCalledOnce();
    expect(store.failed).not.toHaveBeenCalled();
  });

  it('isolates one league publication failure and reports persisted provider-group semantics', async () => {
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const store = fakeStore();
    const publishSnapshot = store.store.publishSnapshot;
    vi.spyOn(store.store, 'publishSnapshot').mockImplementation(async (input) => {
      if (input.leagueSeasonId === 'season-league1') throw new Error('publication unavailable');
      return publishSnapshot(input);
    });
    const dependencies = workerDependencies(store);

    await expect(createLiveProjectionWorker(dependencies).run()).resolves.toEqual({
      status: 'completed', cadence: 'live-window', publishedLeagues: 1, failedLeagues: 1, providerGroups: 1,
    });
    expect(dependencies.projectionMock).toHaveBeenCalledOnce();
    expect(dependencies.gamesMock).toHaveBeenCalledOnce();
    expect(store.publishInputs.map((input) => input.leagueSeasonId)).toEqual(['season-league2']);
    expect(store.completed).toHaveBeenCalledOnce();
    expect(store.failed).not.toHaveBeenCalled();
    expect(warning.mock.calls.map(([entry]) => JSON.parse(String(entry)))).toContainEqual({
      service: 'live-projection-sync', stage: 'league-publish', outcome: 'failed',
      leagueKey: 'league1', season: '2026', week: 1,
    });
  });

  it('records an isolated missing starter candidate as zero without rejecting a complete weekly slate', async () => {
    const store = fakeStore();
    const dependencies = workerDependencies(store);
    const complete = projectionResult();
    dependencies.projectionMock.mockResolvedValue({
      ...complete,
      projections: {
        ...complete.projections,
        bySleeperId: Object.fromEntries(
          Object.entries(complete.projections.bySleeperId).filter(([id]) => id !== 'p1'),
        ),
      },
    });

    await expect(createLiveProjectionWorker(dependencies).run()).resolves.toEqual({
      status: 'completed', cadence: 'live-window', publishedLeagues: 2, failedLeagues: 0, providerGroups: 1,
    });
    expect(store.candidateBatches).toHaveLength(2);
    for (const candidates of store.candidateBatches) {
      expect(candidates).toContainEqual({
        entityId: 'entity-player:p1', projectionPoints: 0, quality: 'missing',
      });
    }
    for (const payload of store.published) {
      const left = payload.matchups[0].sides[0];
      expect(left.starters.find((starter) => starter.id === 'p1')?.projectedPoints).toBe(8);
      expect(left.projectedPoints).toBe(12.5);
    }
  });

  it('uses the explicit zero baseline after kickoff when no eligible pregame candidate was frozen', async () => {
    const store = fakeStore(false);
    const dependencies = workerDependencies(store);

    const result = await createLiveProjectionWorker(dependencies).run();

    expect(result.status).toBe('completed');
    const [left, right] = store.published[0].matchups[0].sides;
    expect(left.starters.map((starter) => starter.projectedPoints)).toEqual([8, 2]);
    expect(left.projectedPoints).toBe(10);
    expect(right.projectedPoints).toBe(6);
  });

  it('uses one hourly job bucket throughout the startup window and treats pruning as noncritical', async () => {
    const store = fakeStore();
    store.pruned.mockRejectedValueOnce(new Error('maintenance unavailable'));
    const idleSchedule = fullWeekSchedule('2026-09-20T17:00:00.000Z');
    const dependencies = workerDependencies(store, {
      cadence: cadenceInput('l1', idleSchedule),
      now: new Date('2026-09-13T18:03:10.000Z'),
    });
    dependencies.sourceMock.mockImplementation(async (leagueId: string) => ({
      ...source(leagueId), schedule: idleSchedule,
    }));

    const result = await createLiveProjectionWorker(dependencies).run();

    expect(result).toEqual({
      status: 'completed', cadence: 'hourly', publishedLeagues: 2, failedLeagues: 0, providerGroups: 1,
    });
    expect(store.acquired).toHaveBeenCalledWith(expect.objectContaining({
      jobKey: 'live-projection-sync', scheduledFor: '2026-09-13T18:00:00.000Z',
    }));
    expect(store.pruned).toHaveBeenCalledWith({
      before: '2026-09-11T18:03:10.000Z', keepRecentSnapshotsPerLeagueWeek: 3,
    });
    expect(store.completed).toHaveBeenCalledOnce();
  });

  it('marks the run failed when the acquired lease is lost or expires before completion', async () => {
    const store = fakeStore();
    store.completed.mockResolvedValueOnce(false);
    const dependencies = workerDependencies(store);

    await expect(createLiveProjectionWorker(dependencies).run()).resolves.toEqual({ status: 'failed' });
    expect(store.published).toHaveLength(2);
    expect(store.completed).toHaveBeenCalledWith('live-projection-sync', 'worker-1');
    expect(store.failed).toHaveBeenCalledWith(
      'live-projection-sync', 'worker-1', 'Projection job lease was lost.',
    );
  });

  it('allows hourly preparation when a regular-season kickoff is within one week', async () => {
    const store = fakeStore();
    const upcomingSchedule = fullWeekSchedule('2026-09-20T17:00:00.000Z');
    const dependencies = workerDependencies(store, {
      cadence: {
        ...cadenceInput('l1', upcomingSchedule),
        currentNflSeasonType: 'pre',
      },
      now: new Date('2026-09-13T18:03:10.000Z'),
    });
    dependencies.sourceMock.mockImplementation(async (leagueId: string) => ({
      ...source(leagueId), schedule: upcomingSchedule,
    }));

    await expect(createLiveProjectionWorker(dependencies).run()).resolves.toMatchObject({
      status: 'completed', cadence: 'hourly', publishedLeagues: 2,
    });
    expect(dependencies.projectionMock).toHaveBeenCalledOnce();
    expect(dependencies.gamesMock).toHaveBeenCalledOnce();
  });

  it('keeps a forced run on the selected current season and excludes stale loaded leagues', async () => {
    const store = fakeStore();
    const dependencies = workerDependencies(store);
    dependencies.cadenceMock.mockImplementation(async (leagueId: string) => leagueId === 'l1'
      ? {
          sleeperLeagueId: leagueId,
          season: '2025',
          week: 18,
          schedule: {},
          currentNflSeason: '2026',
          currentNflWeek: 1,
          currentNflSeasonType: 'regular',
        }
      : cadenceInput(leagueId));
    dependencies.sourceMock.mockImplementation(async (leagueId: string) => {
      const value = source(leagueId);
      return leagueId === 'l1'
        ? {
            ...value,
            data: {
              ...value.data,
              league: { ...value.data.league, season: '2025', week: 18 },
              week: 18,
            },
          }
        : value;
    });
    await expect(createLiveProjectionWorker(dependencies).run({ force: true })).resolves.toEqual({
      status: 'completed', cadence: 'forced', publishedLeagues: 1,
      failedLeagues: 1, providerGroups: 1,
    });
    expect(dependencies.projectionMock).toHaveBeenCalledOnce();
    expect(dependencies.projectionMock).toHaveBeenCalledWith('2026', 1);
    expect(dependencies.gamesMock).toHaveBeenCalledOnce();
    expect(dependencies.gamesMock).toHaveBeenCalledWith('2026', 1);
    expect(dependencies.cadenceMock).toHaveBeenCalledTimes(2);
    expect(store.published).toHaveLength(1);
    expect(store.completed).toHaveBeenCalledOnce();
  });
});
