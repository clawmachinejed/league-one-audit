import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('next/cache', () => ({ unstable_cache: <Value,>(value: Value) => value }));

import { createLiveProjectionWorker } from '../../live-projection-worker';
import {
  PROJECTION_PROVIDER,
  cadenceInput,
  fakeStore,
  fullWeekSchedule,
  gameState,
  gameStates,
  projectionResult,
  source,
  workerDependencies,
  type FakeStore,
  type WorkerTestDependencies,
} from '../../live-projection-worker.fixtures';
import type {
  GameStateObservation,
  LeagueConfiguration,
  LeaguePeriod,
  LeagueWeekState,
} from '../domain/contracts';
import type {
  FutureProjectionSlateContentId,
  FutureProjectionSlateLineage,
  FutureProjectionSlateObservationId,
  FutureRefreshPlanPeriod,
} from '../ports/future-refresh-repository';
import type { StoredProjectionSnapshot } from '../ports/projection-repository';

const FUTURE_PERIOD: LeaguePeriod = { season: 2026, seasonType: 'regular', week: 2 };
const FUTURE_NOW = new Date('2026-09-13T18:10:10.000Z');
const FUTURE_KICKOFF = '2026-09-20T17:00:00.000Z';
const FUTURE_SCHEDULE = fullWeekSchedule(FUTURE_KICKOFF);
const STORED_LINEAGE: FutureProjectionSlateLineage = {
  observationId: 'projection-slate-observation' as FutureProjectionSlateObservationId,
  contentId: 'projection-slate-content' as FutureProjectionSlateContentId,
};

function planForWeek(week: number): FutureRefreshPlanPeriod {
  const neverDue = '2026-10-01T00:00:00.000Z';
  return {
    period: { season: 2026, seasonType: 'regular', week },
    weekDistance: week - 1,
    projection: {
      nextRefreshAt: neverDue,
      lastAttemptedAt: null,
      lastSucceededAt: null,
      consecutiveFailures: 0,
      lastFailureCode: null,
      activeAttemptExpiresAt: null,
      lastSlate: null,
      currentSlate: null,
      due: false,
    },
    materializations: ['league1', 'league2'].map((leagueKey) => ({
      leagueKey,
      nextRefreshAt: neverDue,
      lastAttemptedAt: null,
      lastSucceededAt: null,
      lastSourceRevision: null,
      lastSlate: null,
      lastSnapshotRevision: null,
      consecutiveFailures: 0,
      lastFailureCode: null,
      activeAttemptExpiresAt: null,
      due: false,
    })),
    successfulMaterializations: 0,
    expectedMaterializations: 2,
  };
}

function plansWithWeekTwo(
  projection: Partial<FutureRefreshPlanPeriod['projection']>,
  materialization: Partial<FutureRefreshPlanPeriod['materializations'][number]> = {},
): FutureRefreshPlanPeriod[] {
  return Array.from({ length: 17 }, (_, index) => {
    const base = planForWeek(index + 2);
    if (index !== 0) return base;
    const materializations = base.materializations.map((state) => ({
      ...state,
      ...materialization,
    }));
    return {
      ...base,
      projection: { ...base.projection, ...projection },
      materializations,
      successfulMaterializations: materializations.filter(
        (state) => state.lastSucceededAt !== null,
      ).length,
    };
  });
}

function futureSource(configuration: LeagueConfiguration): LeagueWeekState {
  const base = source(String(configuration.leagueRef.externalId));
  return {
    ...base,
    configuration,
    period: FUTURE_PERIOD,
    schedule: FUTURE_SCHEDULE,
    requestStartedAt: '2026-09-13T18:10:05.000Z',
    requestCompletedAt: '2026-09-13T18:10:06.000Z',
    observedAt: '2026-09-13T18:10:06.000Z',
    sourceRevision: `future-source-${configuration.key}`,
  };
}

function futureGame(): GameStateObservation {
  const base = gameState(FUTURE_PERIOD);
  return {
    ...base,
    period: FUTURE_PERIOD,
    statusCode: 0,
    statusText: 'Scheduled',
    sourcePeriod: null,
    gameClock: null,
    phase: 'pregame',
    clockSeconds: null,
    remainingFraction: 1,
    requestStartedAt: '2026-09-13T18:10:06.000Z',
    requestCompletedAt: '2026-09-13T18:10:07.000Z',
    observedAt: '2026-09-13T18:10:07.000Z',
    sourceRevision: 'future-game-source',
  };
}

function configureFutureDependencies(
  store: FakeStore,
  now = FUTURE_NOW,
): WorkerTestDependencies {
  const dependencies = workerDependencies(store, { now });
  dependencies.cadenceMock.mockImplementation(async (configuration: LeagueConfiguration) => {
    const value = cadenceInput(String(configuration.leagueRef.externalId), FUTURE_SCHEDULE);
    return {
      ...value,
      configuration,
      periodAuthority: { ...value.periodAuthority, configuration },
    };
  });
  dependencies.sourceMock.mockImplementation(async (configuration: LeagueConfiguration) => (
    futureSource(configuration)
  ));
  dependencies.projectionMock.mockResolvedValue({
    status: 'available',
    slate: projectionResult(FUTURE_PERIOD),
  });
  dependencies.gamesMock.mockResolvedValue({
    status: 'available',
    slate: gameStates(futureGame()),
  });
  return dependencies;
}

async function primeStoredProjection(store: FakeStore): Promise<void> {
  await store.repository.recordProjectionSlate(projectionResult(FUTURE_PERIOD));
  store.operations.splice(0);
}

describe('future projection orchestration', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('gives live current-period work priority over all durable future work', async () => {
    const store = fakeStore();
    store.readFuturePlan.mockResolvedValue(plansWithWeekTwo({ due: true }));
    const dependencies = workerDependencies(store, { now: FUTURE_NOW });
    dependencies.cadenceMock.mockImplementation(async (configuration: LeagueConfiguration) => {
      const value = cadenceInput(
        String(configuration.leagueRef.externalId),
        configuration.key === 'league1' ? FUTURE_SCHEDULE : fullWeekSchedule(),
      );
      return {
        ...value,
        configuration,
        periodAuthority: { ...value.periodAuthority, configuration },
      };
    });

    await expect(createLiveProjectionWorker(dependencies).run()).resolves.toMatchObject({
      status: 'completed', cadence: 'live-window', publishedLeagues: 2,
    });
    expect(store.ensureFuture).not.toHaveBeenCalled();
    expect(store.readFuturePlan).not.toHaveBeenCalled();
    expect(dependencies.projectionMock).toHaveBeenCalledOnce();
    expect(dependencies.gamesMock).toHaveBeenCalledOnce();
  });

  it('ingests one future canary with a minute-scoped claim and no other provider calls', async () => {
    const store = fakeStore();
    store.readFuturePlan.mockResolvedValue(plansWithWeekTwo({ due: true }));
    const dependencies = configureFutureDependencies(store);

    await expect(createLiveProjectionWorker(dependencies).run()).resolves.toEqual({
      status: 'completed', cadence: 'hourly', publishedLeagues: 0,
      failedLeagues: 0, providerGroups: 1,
    });
    expect(store.acquired).toHaveBeenCalledOnce();
    expect(store.acquired).toHaveBeenCalledWith(expect.objectContaining({
      jobKey: 'future-projection-sync',
      jobType: 'future-projection-sync',
      scheduledFor: '2026-09-13T18:10:00.000Z',
    }));
    expect(store.ensureFuture).toHaveBeenCalledWith(expect.objectContaining({
      leagueKeys: ['league1', 'league2'],
      targets: expect.arrayContaining([
        { period: FUTURE_PERIOD, weekDistance: 1 },
        {
          period: { season: 2026, seasonType: 'regular', week: 18 },
          weekDistance: 17,
        },
      ]),
    }));
    expect(store.beginFutureProjection).toHaveBeenCalledOnce();
    expect(store.completeFutureProjection).toHaveBeenCalledWith(expect.objectContaining({
      period: FUTURE_PERIOD,
      slate: STORED_LINEAGE,
    }));
    expect(dependencies.projectionMock).toHaveBeenCalledOnce();
    expect(dependencies.gamesMock).not.toHaveBeenCalled();
    expect(dependencies.sourceMock).not.toHaveBeenCalled();
    expect(store.completed).toHaveBeenCalledWith('future-projection-sync', 'worker-1');
    expect(dependencies.loggerMock).toHaveBeenCalledWith('info', expect.objectContaining({
      stage: 'future-projection-feed', outcome: 'completed', futureAction: 'projection-ingest',
      weekDistance: 1, providerOutcome: 'available', projectionRows: expect.any(Number),
    }));
    expect(dependencies.loggerMock).toHaveBeenCalledWith('info', expect.objectContaining({
      stage: 'future-projection-persist', outcome: 'completed', projectionRows: expect.any(Number),
    }));
  });

  it('falls through from an already-completed hourly current job to future work', async () => {
    const store = fakeStore();
    store.acquired
      .mockResolvedValueOnce({ kind: 'completed' })
      .mockResolvedValueOnce({
        kind: 'acquired', attempt: 1, leaseUntil: '2026-09-13T18:02:00.000Z',
      });
    store.readFuturePlan.mockResolvedValue(plansWithWeekTwo({ due: true }));
    const dependencies = configureFutureDependencies(
      store,
      new Date('2026-09-13T18:00:10.000Z'),
    );

    await expect(createLiveProjectionWorker(dependencies).run()).resolves.toMatchObject({
      status: 'completed', cadence: 'hourly', providerGroups: 1,
    });
    expect(store.acquired).toHaveBeenCalledTimes(2);
    expect(store.acquired.mock.calls.map(([input]) => input.jobKey)).toEqual([
      'live-projection-sync', 'future-projection-sync',
    ]);
    expect(dependencies.projectionMock).toHaveBeenCalledOnce();
  });

  it('completes a future projection refresh when unchanged content verifies the current slate', async () => {
    const store = fakeStore();
    store.readFuturePlan.mockResolvedValue(plansWithWeekTwo({ due: true }));
    const dependencies = configureFutureDependencies(store);
    const record = store.repository.recordProjectionSlate;
    vi.spyOn(store.repository, 'recordProjectionSlate').mockImplementation(async (slate) => {
      const outcome = await record(slate);
      if (outcome.kind !== 'stored') return outcome;
      return {
        kind: 'stored',
        value: { ...outcome.value, entriesStored: 0, pointerOutcome: 'verified' },
      };
    });

    await expect(createLiveProjectionWorker(dependencies).run()).resolves.toMatchObject({
      status: 'completed', providerGroups: 1,
    });
    expect(store.completeFutureProjection).toHaveBeenCalledWith(expect.objectContaining({
      slate: STORED_LINEAGE,
    }));
    expect(store.failFutureProjection).not.toHaveBeenCalled();
  });

  it('materializes both leagues from one stored slate without calling the projection endpoint', async () => {
    const store = fakeStore();
    await primeStoredProjection(store);
    store.readFuturePlan.mockResolvedValue(plansWithWeekTwo(
      { currentSlate: STORED_LINEAGE, due: false },
      { due: true },
    ));
    const dependencies = configureFutureDependencies(store);

    await expect(createLiveProjectionWorker(dependencies).run()).resolves.toEqual({
      status: 'completed', cadence: 'hourly', publishedLeagues: 2,
      failedLeagues: 0, providerGroups: 1,
    });
    expect(dependencies.projectionMock).not.toHaveBeenCalled();
    expect(dependencies.gamesMock).toHaveBeenCalledOnce();
    expect(dependencies.sourceMock).toHaveBeenCalledTimes(2);
    expect(dependencies.assessmentMock).toHaveBeenCalledTimes(2);
    expect(dependencies.sourceMock.mock.calls.every(([, period]) => (
      period.season === 2026 && period.seasonType === 'regular' && period.week === 2
    ))).toBe(true);
    expect(store.operations.filter((operation) => operation === 'record-game-states')).toHaveLength(1);
    expect(store.operations.filter((operation) => operation === 'record-projection-slate')).toHaveLength(0);
    expect(store.completeFutureMaterialization).toHaveBeenCalledTimes(2);
    expect(dependencies.loggerMock).toHaveBeenCalledWith('info', expect.objectContaining({
      stage: 'future-game-state-feed', outcome: 'completed', providerOutcome: 'available',
      gameCount: expect.any(Number),
    }));
    expect(dependencies.loggerMock).toHaveBeenCalledWith('info', expect.objectContaining({
      stage: 'future-provider-persist', outcome: 'completed', identityConflictCount: 0,
    }));
    expect(dependencies.loggerMock).toHaveBeenCalledWith('info', expect.objectContaining({
      stage: 'future-league-publish', outcome: 'completed', leagueKey: 'league1',
      starterCount: expect.any(Number), candidateCount: expect.any(Number),
      snapshotRevision: expect.any(String), publicationOutcome: 'published',
    }));
  });

  it('records the actual stored snapshot revision when unchanged content has a new source revision', async () => {
    const store = fakeStore();
    await primeStoredProjection(store);
    store.readFuturePlan.mockResolvedValue(plansWithWeekTwo(
      { currentSlate: STORED_LINEAGE, due: false },
      { due: true, lastSourceRevision: 'old-source-revision' },
    ));
    const dependencies = configureFutureDependencies(store);
    const publish = store.repository.publishSnapshot;
    vi.spyOn(store.repository, 'publishSnapshot').mockImplementation(async (input) => {
      const result = await publish(input);
      if (result.kind !== 'published' && result.kind !== 'unchanged') return result;
      const snapshot: StoredProjectionSnapshot = {
        ...result.snapshot,
        revisionKey: 'stored-current-revision',
      };
      return { kind: 'unchanged', snapshot };
    });

    await expect(createLiveProjectionWorker(dependencies).run()).resolves.toMatchObject({
      status: 'completed', publishedLeagues: 2,
    });
    expect(store.completeFutureMaterialization.mock.calls.map(([input]) => ({
      sourceRevision: input.sourceRevision,
      snapshotRevision: input.snapshotRevision,
    }))).toEqual([
      { sourceRevision: 'future-source-league1', snapshotRevision: 'stored-current-revision' },
      { sourceRevision: 'future-source-league2', snapshotRevision: 'stored-current-revision' },
    ]);
  });

  it('fails an incomplete future slate without publishing it or touching other providers', async () => {
    const store = fakeStore();
    store.readFuturePlan.mockResolvedValue(plansWithWeekTwo({ due: true }));
    const dependencies = configureFutureDependencies(store);
    dependencies.projectionMock.mockResolvedValue({
      status: 'available',
      slate: { ...projectionResult(FUTURE_PERIOD), quality: 'partial' },
    });

    await expect(createLiveProjectionWorker(dependencies).run()).resolves.toEqual({ status: 'failed' });
    expect(store.failFutureProjection).toHaveBeenCalledWith(expect.objectContaining({
      failureCode: 'projection-slate-incomplete',
    }));
    expect(store.operations).not.toContain('record-projection-slate');
    expect(dependencies.gamesMock).not.toHaveBeenCalled();
    expect(dependencies.sourceMock).not.toHaveBeenCalled();
  });

  it('rejects a projection response for any period other than the selected future week', async () => {
    const store = fakeStore();
    store.readFuturePlan.mockResolvedValue(plansWithWeekTwo({ due: true }));
    const dependencies = configureFutureDependencies(store);
    dependencies.projectionMock.mockResolvedValue({
      status: 'available',
      slate: projectionResult({ ...FUTURE_PERIOD, week: 3 }),
    });

    await expect(createLiveProjectionWorker(dependencies).run()).resolves.toEqual({ status: 'failed' });
    expect(store.failFutureProjection).toHaveBeenCalledWith(expect.objectContaining({
      failureCode: 'projection-slate-invalid',
    }));
    expect(store.operations).not.toContain('record-projection-slate');
  });

  it('isolates one future league-source failure and completes the healthy league', async () => {
    const store = fakeStore();
    await primeStoredProjection(store);
    store.readFuturePlan.mockResolvedValue(plansWithWeekTwo(
      { currentSlate: STORED_LINEAGE, due: false },
      { due: true },
    ));
    const dependencies = configureFutureDependencies(store);
    dependencies.sourceMock.mockImplementation(async (configuration: LeagueConfiguration) => {
      if (configuration.key === 'league2') throw new Error('provider details must not persist');
      return futureSource(configuration);
    });

    await expect(createLiveProjectionWorker(dependencies).run()).resolves.toEqual({
      status: 'completed', cadence: 'hourly', publishedLeagues: 1,
      failedLeagues: 1, providerGroups: 1,
    });
    expect(store.completeFutureMaterialization).toHaveBeenCalledOnce();
    expect(store.failFutureMaterialization).toHaveBeenCalledWith(expect.objectContaining({
      leagueKey: 'league2', failureCode: 'league-source-unavailable',
    }));
  });

  it('reports the actual failure when every loaded league has a period mismatch', async () => {
    const store = fakeStore();
    await primeStoredProjection(store);
    store.readFuturePlan.mockResolvedValue(plansWithWeekTwo(
      { currentSlate: STORED_LINEAGE, due: false },
      { due: true },
    ));
    const dependencies = configureFutureDependencies(store);
    dependencies.sourceMock.mockImplementation(async (configuration: LeagueConfiguration) => ({
      ...futureSource(configuration),
      period: { ...FUTURE_PERIOD, week: 3 },
    }));

    await expect(createLiveProjectionWorker(dependencies).run()).resolves.toEqual({ status: 'failed' });
    expect(store.failFutureMaterialization).toHaveBeenCalledTimes(2);
    expect(store.failFutureMaterialization).toHaveBeenCalledWith(expect.objectContaining({
      failureCode: 'league-period-mismatch',
    }));
    expect(dependencies.loggerMock).toHaveBeenCalledWith('warn', expect.objectContaining({
      stage: 'future-materialization', failureCode: 'league-period-mismatch',
    }));
  });

  it('fails claimed materializations when durable and current slate lineage disagree', async () => {
    const store = fakeStore();
    await primeStoredProjection(store);
    const staleLineage = {
      ...STORED_LINEAGE,
      contentId: 'different-content' as FutureProjectionSlateContentId,
    };
    store.readFuturePlan.mockResolvedValue(plansWithWeekTwo(
      { currentSlate: staleLineage, due: false },
      { due: true },
    ));
    const dependencies = configureFutureDependencies(store);

    await expect(createLiveProjectionWorker(dependencies).run()).resolves.toEqual({ status: 'failed' });
    expect(store.failFutureMaterialization).toHaveBeenCalledTimes(2);
    expect(store.failFutureMaterialization).toHaveBeenCalledWith(expect.objectContaining({
      failureCode: 'projection-slate-unavailable',
    }));
    expect(dependencies.sourceMock).not.toHaveBeenCalled();
    expect(dependencies.gamesMock).not.toHaveBeenCalled();
  });

  it('preserves the 90-second official-score and game-state skew safeguard', async () => {
    const store = fakeStore();
    await primeStoredProjection(store);
    store.readFuturePlan.mockResolvedValue(plansWithWeekTwo(
      { currentSlate: STORED_LINEAGE, due: false },
      { due: true },
    ));
    const dependencies = configureFutureDependencies(store);
    const stale = {
      ...futureGame(),
      requestStartedAt: '2026-09-13T18:00:00.000Z',
      requestCompletedAt: '2026-09-13T18:00:01.000Z',
      observedAt: '2026-09-13T18:00:01.000Z',
    };
    dependencies.gamesMock.mockResolvedValue({
      status: 'available',
      slate: gameStates(stale),
    });

    await expect(createLiveProjectionWorker(dependencies).run()).resolves.toEqual({ status: 'failed' });
    expect(store.failFutureMaterialization).toHaveBeenCalledTimes(2);
    expect(store.failFutureMaterialization).toHaveBeenCalledWith(expect.objectContaining({
      failureCode: 'game-state-incomplete',
    }));
    expect(store.operations).not.toContain('record-game-states');
  });

  it('does no future work while the canary is incomplete and its durable rows are not due', async () => {
    const store = fakeStore();
    const plans = plansWithWeekTwo(
      { currentSlate: STORED_LINEAGE, due: false },
      { due: false },
    );
    plans[1] = {
      ...plans[1],
      projection: { ...plans[1].projection, due: true },
    };
    store.readFuturePlan.mockResolvedValue(plans);
    const dependencies = configureFutureDependencies(store);

    await expect(createLiveProjectionWorker(dependencies).run()).resolves.toEqual({
      status: 'skipped', reason: 'idle', cadence: 'idle',
    });
    expect(store.acquired).not.toHaveBeenCalled();
    expect(dependencies.projectionMock).not.toHaveBeenCalled();
  });

  it('honors a durable retry claim and does not call a provider after losing the race', async () => {
    const store = fakeStore();
    store.readFuturePlan.mockResolvedValue(plansWithWeekTwo({ due: true }));
    store.beginFutureProjection.mockResolvedValueOnce({
      kind: 'backed-off', consecutiveFailures: 1,
      nextRefreshAt: '2026-09-13T18:15:00.000Z',
    });
    const dependencies = configureFutureDependencies(store);

    await expect(createLiveProjectionWorker(dependencies).run()).resolves.toEqual({
      status: 'skipped', reason: 'busy', cadence: null,
    });
    expect(dependencies.projectionMock).not.toHaveBeenCalled();
    expect(store.completed).toHaveBeenCalledWith('future-projection-sync', 'worker-1');
  });

  it('does not start a provider call after the 45-second safety boundary', async () => {
    const store = fakeStore();
    store.readFuturePlan.mockResolvedValue(plansWithWeekTwo({ due: true }));
    const dependencies = configureFutureDependencies(store);
    let claimCompleted = false;
    store.beginFutureProjection.mockImplementationOnce(async () => {
      claimCompleted = true;
      return {
        kind: 'acquired', attempt: 1, attemptId: 'worker-1',
        leaseUntil: '2026-09-13T18:11:05.000Z',
      };
    });
    dependencies.monotonicMock.mockImplementation(() => claimCompleted ? 46_000 : 0);

    await expect(createLiveProjectionWorker(dependencies).run()).resolves.toEqual({ status: 'failed' });
    expect(dependencies.projectionMock).not.toHaveBeenCalled();
    expect(store.failFutureProjection).toHaveBeenCalledWith(expect.objectContaining({
      failureCode: 'deadline-exceeded',
    }));
  });

  it('fails safely when a provider response crosses the 50-second hard deadline', async () => {
    const store = fakeStore();
    store.readFuturePlan.mockResolvedValue(plansWithWeekTwo({ due: true }));
    const dependencies = configureFutureDependencies(store);
    let providerCompleted = false;
    dependencies.projectionMock.mockImplementationOnce(async () => {
      providerCompleted = true;
      return { status: 'available', slate: projectionResult(FUTURE_PERIOD) };
    });
    dependencies.monotonicMock.mockImplementation(() => providerCompleted ? 51_000 : 0);

    await expect(createLiveProjectionWorker(dependencies).run()).resolves.toEqual({ status: 'failed' });
    expect(dependencies.projectionMock).toHaveBeenCalledOnce();
    expect(store.operations).not.toContain('record-projection-slate');
    expect(store.failFutureProjection).toHaveBeenCalledWith(expect.objectContaining({
      failureCode: 'deadline-exceeded',
    }));
  });

  it('aborts scoped persistence and returns while a provider promise remains pending', async () => {
    vi.useFakeTimers();
    try {
      const store = fakeStore();
      store.readFuturePlan.mockResolvedValue(plansWithWeekTwo({ due: true }));
      const dependencies = configureFutureDependencies(store);
      dependencies.projectionMock.mockImplementation(() => new Promise(() => undefined));

      const result = createLiveProjectionWorker(dependencies).run();
      for (let index = 0; index < 50 && dependencies.projectionMock.mock.calls.length === 0;
        index += 1) {
        await Promise.resolve();
      }
      expect(dependencies.projectionMock).toHaveBeenCalledOnce();
      const operationSignal = dependencies.futureScopeMock.mock.calls[0]?.[0] as AbortSignal;
      expect(operationSignal.aborted).toBe(false);

      await vi.advanceTimersByTimeAsync(50_000);

      await expect(result).resolves.toEqual({ status: 'failed' });
      expect(operationSignal.aborted).toBe(true);
      expect(store.failed).toHaveBeenCalledWith(
        'future-projection-sync',
        'worker-1',
        'future-refresh:deadline-exceeded',
      );
      expect(store.operations).not.toContain('record-projection-slate');
    } finally {
      vi.useRealTimers();
    }
  });

  it('never persists provider-specific error details as a future failure code', async () => {
    const store = fakeStore();
    store.readFuturePlan.mockResolvedValue(plansWithWeekTwo({ due: true }));
    const dependencies = configureFutureDependencies(store);
    dependencies.projectionMock.mockRejectedValue(new Error('secret raw provider failure'));

    await expect(createLiveProjectionWorker(dependencies).run()).resolves.toEqual({ status: 'failed' });
    expect(store.failFutureProjection).toHaveBeenCalledWith(expect.objectContaining({
      failureCode: 'provider-unavailable',
      projectionSource: PROJECTION_PROVIDER,
    }));
    expect(store.failFutureProjection.mock.calls[0][0].failureCode)
      .not.toContain('secret');
  });
});
