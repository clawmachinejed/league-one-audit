import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('next/cache', () => ({ unstable_cache: <Value,>(value: Value) => value }));

import { createLiveProjectionWorker } from './live-projection-worker';
import {
  NOW,
  fakeStore,
  gameStates,
  projectionResult,
  source,
  workerDependencies,
} from './live-projection-worker.fixtures';

type Deferred<Value> = Readonly<{
  promise: Promise<Value>;
  resolve: (value: Value) => void;
}>;

function deferred<Value>(): Deferred<Value> {
  let resolve!: (value: Value) => void;
  const promise = new Promise<Value>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}

async function waitForCallCount(mock: ReturnType<typeof vi.fn>, count: number): Promise<void> {
  await vi.waitFor(() => expect(mock).toHaveBeenCalledTimes(count), { timeout: 1_000 });
}

describe('live projection worker mechanical parity characterization', () => {
  afterEach(() => vi.restoreAllMocks());

  it('starts projection and game-state provider requests before either request resolves', async () => {
    const fake = fakeStore();
    const dependencies = workerDependencies(fake);
    const projections = deferred<ReturnType<typeof projectionResult>>();
    const games = deferred<ReturnType<typeof gameStates>>();
    dependencies.projectionMock.mockImplementation(() => projections.promise);
    dependencies.gamesMock.mockImplementation(() => games.promise);

    const running = createLiveProjectionWorker(dependencies).run();
    let startFailure: unknown;
    try {
      await Promise.all([
        waitForCallCount(dependencies.projectionMock, 1),
        waitForCallCount(dependencies.gamesMock, 1),
      ]);
      expect(fake.operations).toEqual(['acquire-job']);
    } catch (error) {
      startFailure = error;
    } finally {
      projections.resolve(projectionResult());
      games.resolve(gameStates());
    }
    await expect(running).resolves.toMatchObject({ status: 'completed' });
    if (startFailure) throw startFailure;
  });

  it('starts both configured league loads before either league load resolves', async () => {
    const fake = fakeStore();
    const dependencies = workerDependencies(fake);
    const release = deferred<void>();
    dependencies.sourceMock.mockImplementation(async (leagueId: string) => {
      await release.promise;
      return source(leagueId);
    });

    const running = createLiveProjectionWorker(dependencies).run();
    let startFailure: unknown;
    try {
      await waitForCallCount(dependencies.sourceMock, 2);
      expect(dependencies.sourceMock.mock.calls.map(([leagueId]) => leagueId).toSorted())
        .toEqual(['l1', 'l2']);
      expect(dependencies.projectionMock).not.toHaveBeenCalled();
      expect(dependencies.gamesMock).not.toHaveBeenCalled();
    } catch (error) {
      startFailure = error;
    } finally {
      release.resolve();
    }
    await expect(running).resolves.toMatchObject({ status: 'completed' });
    if (startFailure) throw startFailure;
  });

  it('starts both same-group league processors before either registration resolves', async () => {
    const fake = fakeStore();
    const dependencies = workerDependencies(fake);
    const release = deferred<void>();
    const originalRegister = fake.store.registerLeagueSeason.bind(fake.store);
    const register = vi.spyOn(fake.store, 'registerLeagueSeason');
    register.mockImplementation(async (input) => {
      await release.promise;
      return originalRegister(input);
    });

    const running = createLiveProjectionWorker(dependencies).run();
    let startFailure: unknown;
    try {
      await waitForCallCount(register, 2);
      expect(register.mock.calls.map(([input]) => input.leagueKey).toSorted())
        .toEqual(['league1', 'league2']);
      expect(fake.publishInputs).toEqual([]);
    } catch (error) {
      startFailure = error;
    } finally {
      release.resolve();
    }
    await expect(running).resolves.toMatchObject({ status: 'completed' });
    if (startFailure) throw startFailure;
  });

  it('captures the calculation clock and worker identity once and reuses both across the run', async () => {
    const fake = fakeStore();
    const base = workerDependencies(fake);
    const now = vi.fn()
      .mockReturnValueOnce(new Date(NOW))
      .mockReturnValue(new Date('2026-09-13T19:00:10.000Z'));
    const workerId = vi.fn()
      .mockReturnValueOnce('characterized-worker')
      .mockReturnValue('unexpected-second-worker');

    const result = await createLiveProjectionWorker({ ...base, now, workerId }).run();

    expect(result).toMatchObject({ status: 'completed' });
    expect(now).toHaveBeenCalledOnce();
    expect(workerId).toHaveBeenCalledOnce();
    expect(fake.acquired).toHaveBeenCalledWith(expect.objectContaining({
      workerId: 'characterized-worker',
    }));
    expect(fake.completed).toHaveBeenCalledWith('live-projection-sync', 'characterized-worker');
    expect(fake.publishInputs.map((input) => input.calculatedAt))
      .toEqual([NOW.toISOString(), NOW.toISOString()]);
    expect(fake.frozen.mock.calls.map(([input]) => input.frozenAt))
      .toEqual([NOW.toISOString(), NOW.toISOString()]);
  });

  it('counts unchanged snapshots as accepted and preserves the complete mixed-result log sequence', async () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const fake = fakeStore();
    const originalPublish = fake.store.publishSnapshot;
    vi.spyOn(fake.store, 'publishSnapshot').mockImplementation(async (input) => {
      if (input.leagueSeasonId === 'season-league1') {
        throw new Error('controlled League One publication failure');
      }
      const published = await originalPublish(input);
      if (published.kind !== 'published') throw new Error('The fixture did not publish.');
      return { kind: 'unchanged', snapshot: published.snapshot };
    });
    const dependencies = workerDependencies(fake);

    await expect(createLiveProjectionWorker(dependencies).run()).resolves.toEqual({
      status: 'completed',
      cadence: 'live-window',
      publishedLeagues: 1,
      failedLeagues: 1,
      providerGroups: 1,
    });
    expect(warning.mock.calls.map(([entry]) => JSON.parse(String(entry)))).toEqual([{
      service: 'live-projection-sync',
      stage: 'league-publish',
      outcome: 'failed',
      leagueKey: 'league1',
      season: '2026',
      week: 1,
    }]);
    expect(info.mock.calls.map(([entry]) => JSON.parse(String(entry)))).toEqual([{
      service: 'live-projection-sync', stage: 'lease', outcome: 'started',
    }, {
      service: 'live-projection-sync', stage: 'run', outcome: 'completed',
      publishedLeagues: 1, failedLeagues: 1,
    }]);
    expect(error).not.toHaveBeenCalled();
    expect(fake.completed).toHaveBeenCalledOnce();
    expect(fake.failed).not.toHaveBeenCalled();
  });

  it('keeps projection caching in the provider while requesting uncached game state on every run', async () => {
    const projectionCalls = vi.fn();
    const gameCalls = vi.fn();
    let cachedProjection: ReturnType<typeof projectionResult> | undefined;
    const getWeeklyProjections = async () => {
      if (!cachedProjection) {
        projectionCalls();
        cachedProjection = projectionResult();
      }
      return cachedProjection;
    };
    const getWeeklyGameStates = async () => {
      gameCalls();
      return gameStates();
    };

    for (let run = 0; run < 2; run += 1) {
      const fake = fakeStore();
      const base = workerDependencies(fake);
      await expect(createLiveProjectionWorker({
        ...base,
        getWeeklyProjections,
        getWeeklyGameStates,
      }).run()).resolves.toMatchObject({ status: 'completed' });
    }

    expect(projectionCalls).toHaveBeenCalledOnce();
    expect(gameCalls).toHaveBeenCalledTimes(2);
  });

  it('pins every persistence-bound source revision and observation metadata field', async () => {
    const fake = fakeStore();
    const gameStatesSpy = vi.spyOn(fake.store, 'recordGameStates');
    const candidatesSpy = vi.spyOn(fake.store, 'recordProjectionCandidates');
    const observationsSpy = vi.spyOn(fake.store, 'recordLeagueWeekObservation');
    const dependencies = workerDependencies(fake);

    await expect(createLiveProjectionWorker(dependencies).run()).resolves.toMatchObject({
      status: 'completed',
    });

    const captured = {
      gameStates: gameStatesSpy.mock.calls.map(([input]) => input),
      projectionRuns: candidatesSpy.mock.calls.map(([input]) => ({
        provider: input.provider,
        season: input.season,
        seasonType: input.seasonType,
        week: input.week,
        modelVersion: input.modelVersion,
        sourceRevision: input.sourceRevision,
        requestStartedAt: input.requestStartedAt,
        requestCompletedAt: input.requestCompletedAt,
        fetchedAt: input.fetchedAt,
        quality: input.quality,
        candidateCount: input.candidates.length,
      })),
      leagueObservations: observationsSpy.mock.calls.map(([input]) => ({
        leagueSeasonId: input.leagueSeasonId,
        week: input.week,
        sourceRevision: input.sourceRevision,
        requestStartedAt: input.requestStartedAt,
        requestCompletedAt: input.requestCompletedAt,
        observedAt: input.observedAt,
        quality: input.quality,
        sourceData: input.sourceData,
        expectedTank01GameIds: input.expectedTank01GameIds,
        playerPoints: input.playerPoints,
        rosterPoints: input.rosterPoints,
      })),
    };
    expect(captured.gameStates).toEqual([{
      provider: 'tank01',
      states: [{
        externalGameId: 'game-1',
        sourceRevision: '448be1f64c4fe89b075678410679c3d2095db9fbf0aacc7c54ef53c6e9395cb9',
        requestStartedAt: '2026-09-13T18:00:01.000Z',
        requestCompletedAt: '2026-09-13T18:00:02.000Z',
        observedAt: '2026-09-13T18:00:02.000Z',
        statusCode: 1,
        period: 'Halftime',
        gameClock: null,
        homeScore: null,
        awayScore: null,
        sourceData: {
          statusText: 'Halftime',
          phase: 'halftime',
          clockSeconds: null,
          remainingFraction: 0.5,
        },
      }],
    }]);

    const expectedProjectionRun = {
      provider: 'tank01',
      season: 2026,
      seasonType: 'reg',
      week: 1,
      modelVersion: 'clock-v1',
      sourceRevision: '7c9136b166b67d9cda4c0658cd98bdc621ea150ac96c8ccf4b129a6a1f6a015e',
      requestStartedAt: '2026-09-13T16:59:59.000Z',
      requestCompletedAt: '2026-09-13T16:59:59.000Z',
      fetchedAt: '2026-09-13T16:59:59.000Z',
      quality: 'complete',
      candidateCount: 3,
    };
    expect(captured.projectionRuns).toEqual([expectedProjectionRun, expectedProjectionRun]);

    const expectedPlayerPoints = [{
      sleeperPlayerId: 'p1', entityKind: 'player', externalRosterId: '1',
      points: 8, isStarter: true, lineupSlot: 'QB',
    }, {
      sleeperPlayerId: 'p2', entityKind: 'player', externalRosterId: '1',
      points: 2, isStarter: true, lineupSlot: 'RB',
    }, {
      sleeperPlayerId: 'p3', entityKind: 'player', externalRosterId: '2',
      points: 6, isStarter: true, lineupSlot: 'QB',
    }];
    const expectedRosterPoints = [
      { externalRosterId: '1', points: 10 },
      { externalRosterId: '2', points: 6 },
    ];
    expect(captured.leagueObservations).toEqual(['league1', 'league2'].map((leagueKey) => ({
      leagueSeasonId: `season-${leagueKey}`,
      week: 1,
      sourceRevision: '5c5f5b7cdd91c86471babb1aa3b71d65fdee84f90462fb001b9d645aa3e6bd8f',
      requestStartedAt: '2026-09-13T18:00:00.000Z',
      requestCompletedAt: '2026-09-13T18:00:01.000Z',
      observedAt: '2026-09-13T18:00:01.000Z',
      quality: 'complete',
      sourceData: {
        leagueKey,
        season: '2026',
        week: 1,
        updatedAt: '2026-09-13T18:00:01.000Z',
        matchupCount: 1,
        rosteredPlayerCount: 3,
        missingFrozenBaselineCount: 0,
        missingBaselinePolicy: 'zero',
        rosterIds: ['1', '2'],
        warning: null,
      },
      expectedTank01GameIds: ['game-1'],
      playerPoints: expectedPlayerPoints,
      rosterPoints: expectedRosterPoints,
    })));
  });
});
