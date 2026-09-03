import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import type { GameStateSlate, ProjectionSlate } from './projections/domain/contracts';
import { createLiveProjectionWorker } from './live-projection-worker';
import {
  GAME_STATE_PROVIDER,
  NOW,
  PERIOD,
  PROJECTION_PROVIDER,
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

function externalId(reference: Readonly<{ externalId: unknown }>): string {
  return String(reference.externalId);
}

describe('live projection worker canonical parity characterization', () => {
  afterEach(() => vi.restoreAllMocks());

  it('starts projection and game-state provider requests before either request resolves', async () => {
    const fake = fakeStore();
    const dependencies = workerDependencies(fake);
    const projections = deferred<ProjectionSlate>();
    const games = deferred<GameStateSlate>();
    dependencies.projectionMock.mockImplementation(async () => ({
      status: 'available',
      slate: await projections.promise,
    }));
    dependencies.gamesMock.mockImplementation(async () => ({
      status: 'available',
      slate: await games.promise,
    }));

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
    dependencies.sourceMock.mockImplementation(async (configuration) => {
      await release.promise;
      return source(externalId(configuration.leagueRef));
    });

    const running = createLiveProjectionWorker(dependencies).run();
    let startFailure: unknown;
    try {
      await waitForCallCount(dependencies.sourceMock, 2);
      expect(dependencies.sourceMock.mock.calls.map(([configuration]) => (
        externalId(configuration.leagueRef)
      )).toSorted()).toEqual(['l1', 'l2']);
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
    const originalRegister = fake.repository.registerLeagueSeason.bind(fake.repository);
    const register = vi.spyOn(fake.repository, 'registerLeagueSeason');
    register.mockImplementation(async (input) => {
      await release.promise;
      return originalRegister(input);
    });

    const running = createLiveProjectionWorker(dependencies).run();
    let startFailure: unknown;
    try {
      await waitForCallCount(register, 2);
      expect(register.mock.calls.map(([input]) => input.configuration.key).toSorted())
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

    const result = await createLiveProjectionWorker({
      ...base,
      clock: { ...base.clock, now },
      idGenerator: { generate: workerId },
    }).run();

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
    vi.spyOn(console, 'info').mockImplementation(() => undefined);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const fake = fakeStore();
    const originalPublish = fake.repository.publishSnapshot;
    vi.spyOn(fake.repository, 'publishSnapshot').mockImplementation(async (input) => {
      if (String(input.leagueSeasonId) === 'season-league1') {
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
    expect(dependencies.loggerMock.mock.calls.map(([level, entry]) => [
      level,
      entry.stage,
      entry.outcome,
    ])).toEqual([
      ['info', 'lease', 'started'],
      ['info', 'league-load', 'completed'],
      ['info', 'provider-load', 'completed'],
      ['info', 'provider-persist', 'completed'],
      ['warn', 'league-publish', 'failed'],
      ['info', 'league-publish', 'completed'],
      ['info', 'run', 'completed'],
    ]);
    const publicationFailure = dependencies.loggerMock.mock.calls[4][1];
    expect(publicationFailure).toMatchObject({
      runId: 'worker-1',
      leagueKey: 'league1',
      period: PERIOD,
      publicationOutcome: 'rejected',
      failureCode: 'snapshot-rejected',
    });
    const completed = dependencies.loggerMock.mock.calls[6][1];
    expect(completed).toMatchObject({
      runId: 'worker-1',
      publishedLeagues: 1,
      failedLeagues: 1,
    });
    expect(fake.completed).toHaveBeenCalledOnce();
    expect(fake.failed).not.toHaveBeenCalled();
  });

  it('keeps credentials, authorization, database URLs, and raw provider payloads out of captured logs', async () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const fake = fakeStore();
    const dependencies = workerDependencies(fake);
    const sensitive = {
      providerCredential: 'tank01-private-api-key',
      databaseUrl: 'postgresql://runtime:private-password@example.neon.tech/production',
      authorization: 'Bearer private-cron-authorization',
      rawPayload: '{"body":{"private-player-data":"must-not-be-logged"}}',
    };
    const providerFailure = new Error(JSON.stringify(sensitive));
    dependencies.projectionMock.mockRejectedValue(providerFailure);
    dependencies.gamesMock.mockRejectedValue(providerFailure);

    await expect(createLiveProjectionWorker(dependencies).run()).resolves.toEqual({
      status: 'failed',
    });
    expect(dependencies.loggerMock.mock.calls.map(([level, entry]) => [
      level,
      entry.stage,
      entry.outcome,
    ])).toEqual([
      ['info', 'lease', 'started'],
      ['info', 'league-load', 'completed'],
      ['warn', 'provider-load', 'failed'],
      ['error', 'league-publish', 'failed'],
    ]);
    const captured = JSON.stringify({
      structured: dependencies.loggerMock.mock.calls,
      console: [...info.mock.calls, ...warning.mock.calls, ...error.mock.calls],
    });
    for (const value of Object.values(sensitive)) expect(captured).not.toContain(value);
  });

  it('keeps projection caching in the feed while requesting uncached game state on every run', async () => {
    const projectionCalls = vi.fn();
    const gameCalls = vi.fn();
    let cachedProjection: ProjectionSlate | undefined;
    const getProjectionSlate = async () => {
      if (!cachedProjection) {
        projectionCalls();
        cachedProjection = projectionResult();
      }
      return { status: 'available' as const, slate: cachedProjection };
    };
    const getGameStateSlate = async () => {
      gameCalls();
      return { status: 'available' as const, slate: gameStates() };
    };

    for (let run = 0; run < 2; run += 1) {
      const fake = fakeStore();
      const base = workerDependencies(fake);
      await expect(createLiveProjectionWorker({
        ...base,
        projectionFeed: { ...base.projectionFeed, getProjectionSlate },
        gameStateFeed: { getGameStateSlate },
      }).run()).resolves.toMatchObject({ status: 'completed' });
    }

    expect(projectionCalls).toHaveBeenCalledOnce();
    expect(gameCalls).toHaveBeenCalledTimes(2);
  });

  it('pins every persistence-bound source revision and observation metadata field', async () => {
    const fake = fakeStore();
    const gameStatesSpy = vi.spyOn(fake.repository, 'recordGameStates');
    const candidatesSpy = vi.spyOn(fake.repository, 'recordProjectionCandidates');
    const observationsSpy = vi.spyOn(fake.repository, 'recordLeagueWeekObservation');
    const dependencies = workerDependencies(fake);

    await expect(createLiveProjectionWorker(dependencies).run()).resolves.toMatchObject({
      status: 'completed',
    });

    const capturedGameStates = gameStatesSpy.mock.calls.map(([input]) => ({
      source: String(input.source),
      states: input.states.map((state) => ({
        gameId: externalId(state.gameRef),
        sourceRevision: state.sourceRevision,
        requestStartedAt: state.requestStartedAt,
        requestCompletedAt: state.requestCompletedAt,
        observedAt: state.observedAt,
        statusCode: state.statusCode,
        sourcePeriod: state.sourcePeriod,
        gameClock: state.gameClock,
        homeScore: state.homeScore,
        awayScore: state.awayScore,
        statusText: state.statusText,
        phase: state.phase,
        clockSeconds: state.clockSeconds,
        remainingFraction: state.remainingFraction,
      })),
    }));
    expect(capturedGameStates).toEqual([{
      source: String(GAME_STATE_PROVIDER),
      states: [{
        gameId: 'game-1',
        sourceRevision: '448be1f64c4fe89b075678410679c3d2095db9fbf0aacc7c54ef53c6e9395cb9',
        requestStartedAt: '2026-09-13T18:00:01.000Z',
        requestCompletedAt: '2026-09-13T18:00:02.000Z',
        observedAt: '2026-09-13T18:00:02.000Z',
        statusCode: 1,
        sourcePeriod: 'Halftime',
        gameClock: null,
        homeScore: null,
        awayScore: null,
        statusText: 'Halftime',
        phase: 'halftime',
        clockSeconds: null,
        remainingFraction: 0.5,
      }],
    }]);

    const projectionRuns = candidatesSpy.mock.calls.map(([input]) => ({
      source: String(input.source),
      period: input.period,
      modelVersion: input.modelVersion,
      sourceRevision: input.sourceRevision,
      requestStartedAt: input.requestStartedAt,
      requestCompletedAt: input.requestCompletedAt,
      observedAt: input.observedAt,
      quality: input.quality,
      candidateCount: input.candidates.length,
    }));
    const expectedProjectionRun = {
      source: String(PROJECTION_PROVIDER),
      period: PERIOD,
      modelVersion: 'clock-v1',
      sourceRevision: '7c9136b166b67d9cda4c0658cd98bdc621ea150ac96c8ccf4b129a6a1f6a015e',
      requestStartedAt: '2026-09-13T16:59:59.000Z',
      requestCompletedAt: '2026-09-13T16:59:59.000Z',
      observedAt: '2026-09-13T16:59:59.000Z',
      quality: 'complete',
      candidateCount: 3,
    };
    expect(projectionRuns).toEqual([expectedProjectionRun, expectedProjectionRun]);

    const leagueObservations = observationsSpy.mock.calls.map(([input]) => ({
      leagueSeasonId: String(input.leagueSeasonId),
      period: input.period,
      sourceRevision: input.sourceRevision,
      requestStartedAt: input.requestStartedAt,
      requestCompletedAt: input.requestCompletedAt,
      observedAt: input.observedAt,
      quality: input.quality,
      sourceData: input.sourceData,
      expectedGameIds: input.expectedGameRefs.map(externalId),
      entityPoints: input.entityPoints.map((point) => ({
        entityId: externalId(point.entityRef),
        entityKind: point.entityRef.entityKind,
        rosterId: externalId(point.rosterRef),
        points: point.points,
        isStarter: point.isStarter,
        lineupSlot: point.lineupSlot,
      })),
      rosterPoints: input.rosterPoints.map((point) => ({
        rosterId: externalId(point.rosterRef),
        points: point.points,
      })),
    }));
    const expectedEntityPoints = [{
      entityId: 'p1', entityKind: 'player', rosterId: '1',
      points: 8, isStarter: true, lineupSlot: 'QB',
    }, {
      entityId: 'p2', entityKind: 'player', rosterId: '1',
      points: 2, isStarter: true, lineupSlot: 'RB',
    }, {
      entityId: 'p3', entityKind: 'player', rosterId: '2',
      points: 6, isStarter: true, lineupSlot: 'QB',
    }];
    const expectedRosterPoints = [
      { rosterId: '1', points: 10 },
      { rosterId: '2', points: 6 },
    ];
    expect(leagueObservations).toEqual(['league1', 'league2'].map((leagueKey) => ({
      leagueSeasonId: `season-${leagueKey}`,
      period: PERIOD,
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
      expectedGameIds: ['game-1'],
      entityPoints: expectedEntityPoints,
      rosterPoints: expectedRosterPoints,
    })));
  });
});
