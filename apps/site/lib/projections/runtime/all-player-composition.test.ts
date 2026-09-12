import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
const { store, canonicalOperation, logger } = vi.hoisted(() => ({
  store: { enabled: true, readLeagueLineupAuthorities: vi.fn(), readAllPlayerJobState: vi.fn(),
    recordAllPlayerPreclaimOutcome: vi.fn(async () => 'recorded' as 'recorded' | 'unchanged' | 'throttled' | 'disabled') },
  canonicalOperation: vi.fn(),
  logger: { write: vi.fn() },
}));
const catalogLoaders = vi.hoisted(() => ({
  cached: vi.fn(),
  neutral: vi.fn(),
  cachedProjectionInput: vi.fn(),
  neutralProjectionInput: vi.fn(),
}));
vi.mock('../../projection-store', () => ({ getProjectionStore: () => store, createProjectionStore: () => store }));
vi.mock('./all-player-operation', async (original) => ({
  ...await original<typeof import('./all-player-operation')>(),
  runAllPlayerIngestion: canonicalOperation,
}));
vi.mock('../adapters/neon/repository', () => ({ createNeonProjectionRepository: () => ({}) }));
vi.mock('../../sleeper', () => ({
  getFantasyPlayerCatalog: catalogLoaders.cached,
  getProjectionSyncInput: catalogLoaders.cachedProjectionInput,
  getOperatorProjectionSyncInput: catalogLoaders.neutralProjectionInput,
}));
vi.mock('../../sleeper-player-catalog', () => ({
  loadCompletePlayerCatalog: catalogLoaders.neutral,
}));
vi.mock('./shared-services', async (original) => {
  const actual = await original<typeof import('./shared-services')>();
  return { ...actual, createProductionSharedServices: (service: string) => ({
    ...actual.createProductionSharedServices(service), logger,
  }) };
});

import {
  createProductionAllPlayerDependencies,
  runProductionAllPlayerRecurring,
} from './all-player-composition';
import * as databaseModule from '../../database';

describe('production all-player recurring composition', () => {
  afterEach(() => {
    delete process.env.ALL_PLAYER_RECURRING_ENABLED;
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  it('is dormant by default without reading database or provider state', async () => {
    await expect(runProductionAllPlayerRecurring()).resolves.toEqual({
      status: 'disabled', mode: 'recurring',
    });
    expect(store.readLeagueLineupAuthorities).not.toHaveBeenCalled();
    expect(store.readAllPlayerJobState).not.toHaveBeenCalled();
    expect(canonicalOperation).not.toHaveBeenCalled();
    expect(logger.write).not.toHaveBeenCalled();
    expect(store.recordAllPlayerPreclaimOutcome).not.toHaveBeenCalled();
  });

  it('shares the complete authoritative catalog with recurring league-week loads', async () => {
    catalogLoaders.neutral.mockResolvedValue({ catalog: {}, complete: true, sourceRevision: 'revision' });
    const dependencies = createProductionAllPlayerDependencies();
    await dependencies.loadCatalog();
    await dependencies.loadCatalog();
    expect(catalogLoaders.neutral).toHaveBeenCalledOnce();
    await expect(dependencies.loadLeagueWeek(
      { leagueRef: { externalId: 'league' } } as never,
      {} as never,
    )).rejects.toThrow();
    expect(catalogLoaders.neutralProjectionInput).toHaveBeenCalledOnce();
    expect(catalogLoaders.neutralProjectionInput.mock.calls[0]?.[2]).toBe(dependencies.loadCatalog);
    expect(catalogLoaders.cachedProjectionInput).not.toHaveBeenCalled();
  });

  it('gives cleanup queries their own bounded cancellation signal beyond the execution deadline', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-12T12:00:00.000Z'));
    const execution = new AbortController();
    const cleanup = new AbortController();
    const scope = vi.spyOn(databaseModule, 'withDatabaseAbortSignal');
    const timeout = vi.spyOn(AbortSignal, 'timeout').mockReturnValue(cleanup.signal);
    try {
      createProductionAllPlayerDependencies({ signal: execution.signal, deadlineAt: '2026-09-12T12:00:50.000Z' });
      expect(scope.mock.calls.map((call) => call[1])).toEqual([execution.signal, cleanup.signal]);
      expect(timeout).toHaveBeenCalledExactlyOnceWith(54_000);
      execution.abort();
      expect(cleanup.signal.aborted).toBe(false);
    } finally { scope.mockRestore(); timeout.mockRestore(); }
  });

  it('uses only remaining cleanup time and immediately aborts an exhausted cleanup scope', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-12T12:00:52.000Z'));
    const scope = vi.spyOn(databaseModule, 'withDatabaseAbortSignal');
    const timeout = vi.spyOn(AbortSignal, 'timeout').mockReturnValue(new AbortController().signal);
    try {
      createProductionAllPlayerDependencies({ signal: new AbortController().signal, deadlineAt: '2026-09-12T12:00:50.000Z' });
      expect(timeout).toHaveBeenCalledExactlyOnceWith(2_000);
      vi.setSystemTime(new Date('2026-09-12T12:00:54.000Z'));
      createProductionAllPlayerDependencies({ signal: new AbortController().signal, deadlineAt: '2026-09-12T12:00:50.000Z' });
      expect(timeout).toHaveBeenCalledTimes(1);
      expect(scope.mock.calls[3][1].aborted).toBe(true);
    } finally { scope.mockRestore(); timeout.mockRestore(); }
  });

  it('wires every explicit operator catalog read to the cache-neutral path', async () => {
    catalogLoaders.neutral.mockResolvedValue({
      catalog: {}, complete: true, sourceRevision: 'revision',
    });
    const dependencies = createProductionAllPlayerDependencies();
    void dependencies.loadCatalog();
    void dependencies.loadCatalog();
    expect(catalogLoaders.neutral).toHaveBeenCalledOnce();
    await expect(dependencies.loadLeagueWeek(
      { leagueRef: { externalId: 'league' } } as never,
      {} as never,
    )).rejects.toThrow();
    expect(catalogLoaders.neutralProjectionInput).toHaveBeenCalledOnce();
    expect(catalogLoaders.neutralProjectionInput.mock.calls[0]?.[2])
      .toBe(dependencies.loadCatalog);
    expect(catalogLoaders.cachedProjectionInput).not.toHaveBeenCalled();
  });

  it('derives one shared active period and invokes the canonical operation in recurring mode', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-12T12:00:00Z'));
    process.env.ALL_PLAYER_RECURRING_ENABLED = 'true';
    store.readLeagueLineupAuthorities.mockResolvedValueOnce(['league1', 'league2'].map((leagueKey) => ({
      kind: 'available', leagueKey, authority: {
        leagueLifecycle: 'active', activeSeason: 2026, activeSeasonType: 'reg', activeWeek: 1,
        sourceProvider: 'sleeper', verifiedAt: '2026-09-12T12:00:00Z',
        defaultPeriodCadence: { games: [{ kickoffAt: '2026-09-10T00:00:00Z' }] },
      },
    })));
    canonicalOperation.mockResolvedValueOnce({ status: 'completed', mode: 'recurring' });
    await expect(runProductionAllPlayerRecurring()).resolves.toMatchObject({ status: 'completed' });
    expect(canonicalOperation).toHaveBeenCalledOnce();
    expect(canonicalOperation.mock.calls[0][1]).toEqual({
      mode: 'recurring', period: { season: 2026, seasonType: 'regular', week: 1 },
      requireFinalCoverage: false,
    });
    expect(logger.write).not.toHaveBeenCalled();
    expect(store.recordAllPlayerPreclaimOutcome).not.toHaveBeenCalled();
  });

  it('skips between polling opportunities before any all-player database reads', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-12T12:01:00Z'));
    process.env.ALL_PLAYER_RECURRING_ENABLED = 'true';
    await expect(runProductionAllPlayerRecurring()).resolves.toMatchObject({
      status: 'skipped', reason: 'not-due',
    });
    expect(store.readAllPlayerJobState).not.toHaveBeenCalled();
    expect(store.readLeagueLineupAuthorities).not.toHaveBeenCalled();
    expect(logger.write).toHaveBeenCalledExactlyOnceWith('info', expect.objectContaining({
      stage: 'all-player-recurring-preclaim', outcome: 'skipped',
      allPlayerFailureStage: 'polling-opportunity', allPlayerReason: 'not-due', upstreamRequests: 0,
      allPlayerPersistedObservation: false,
      allPlayerDiagnostics: ['preclaim-durability:nonpoll-log-only'],
    }));
    expect(store.recordAllPlayerPreclaimOutcome).not.toHaveBeenCalled();
  });

  it('reads only compact budget state when the global request is not due', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-12T12:00:00Z'));
    process.env.ALL_PLAYER_RECURRING_ENABLED = 'true';
    store.readAllPlayerJobState.mockResolvedValueOnce({ payload: {}, nextRequestAt: '2026-09-13T00:00:00Z' });
    await expect(runProductionAllPlayerRecurring()).resolves.toMatchObject({ status: 'skipped', reason: 'not-due' });
    expect(store.readLeagueLineupAuthorities).not.toHaveBeenCalled();
    expect(canonicalOperation).not.toHaveBeenCalled();
    expect(logger.write).toHaveBeenCalledExactlyOnceWith('info', expect.objectContaining({
      stage: 'all-player-recurring-preclaim', allPlayerFailureStage: 'global-budget', allPlayerReason: 'not-due',
      allPlayerDiagnostics: ['preclaim-durability:recorded'],
    }));
    expect(store.recordAllPlayerPreclaimOutcome).toHaveBeenCalledExactlyOnceWith({
      outcome: 'not-due', stage: 'global-budget', reason: 'not-due',
      retryAt: '2026-09-13T00:00:00.000Z', retryDisposition: 'after-cooldown',
    });
  });

  it('reserves cleanup time after work sharing the current cron invocation', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-12T12:00:00Z'));
    process.env.ALL_PLAYER_RECURRING_ENABLED = 'true';
    await expect(runProductionAllPlayerRecurring(Date.now() - 45_000)).resolves.toMatchObject({
      status: 'unavailable', reason: 'insufficient-invocation-budget',
    });
    expect(store.readAllPlayerJobState).not.toHaveBeenCalled();
    expect(logger.write).toHaveBeenCalledExactlyOnceWith('warn', expect.objectContaining({
      stage: 'all-player-recurring-preclaim', outcome: 'failed',
      allPlayerFailureStage: 'invocation-budget', allPlayerReason: 'insufficient-invocation-budget',
    }));
    expect(store.recordAllPlayerPreclaimOutcome).toHaveBeenCalledExactlyOnceWith({
      outcome: 'timeout', stage: 'invocation-budget', reason: 'insufficient-invocation-budget', retryDisposition: 'next-poll',
    });
  });

  it.each(['busy', 'cooldown'] as const)('logs %s with the validated relevant period and no new claim', async (variant) => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-12T12:00:00Z'));
    process.env.ALL_PLAYER_RECURRING_ENABLED = 'true';
    store.readAllPlayerJobState.mockResolvedValueOnce({
      state: 'running', leaseUntil: '2026-09-12T12:00:55Z', nextRequestAt: null,
      payload: { period: { season: 2026, seasonType: 'reg', week: 1 },
        ...(variant === 'cooldown' ? { nextAttemptAt: '2026-09-12T13:00:00Z' } : {}),
        ignoredPrivateMetadata: 'postgresql://credential.invalid/private',
      },
    });
    await expect(runProductionAllPlayerRecurring()).resolves.toMatchObject({
      status: 'skipped', reason: variant === 'busy' ? 'busy' : 'not-due',
    });
    expect(logger.write).toHaveBeenCalledExactlyOnceWith('info', expect.objectContaining({
      stage: 'all-player-recurring-preclaim', allPlayerFailureStage: variant === 'busy' ? 'ownership' : 'failure-cooldown',
      period: { season: 2026, seasonType: 'regular', week: 1 },
    }));
    expect(JSON.stringify(logger.write.mock.calls)).not.toContain('credential.invalid');
    expect(canonicalOperation).not.toHaveBeenCalled();
    expect(catalogLoaders.neutral).not.toHaveBeenCalled();
    expect(store.recordAllPlayerPreclaimOutcome).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      outcome: variant === 'busy' ? 'busy' : 'not-due',
      period: { season: 2026, seasonType: 'reg', week: 1 }, retryDisposition: 'after-cooldown',
    }));
  });

  it('logs unavailable period selection and database errors without raw payloads', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-12T12:00:00Z'));
    process.env.ALL_PLAYER_RECURRING_ENABLED = 'true';
    store.readLeagueLineupAuthorities.mockResolvedValueOnce([]);
    await expect(runProductionAllPlayerRecurring()).resolves.toMatchObject({ reason: 'authority-missing' });
    expect(logger.write).toHaveBeenLastCalledWith('warn', expect.objectContaining({
      stage: 'all-player-recurring-preclaim', allPlayerFailureStage: 'period-selection', allPlayerReason: 'authority-missing',
    }));
    store.readAllPlayerJobState.mockRejectedValueOnce(new Error('postgresql://credential.invalid/private\nraw payload'));
    await expect(runProductionAllPlayerRecurring()).resolves.toMatchObject({ reason: 'recurring-preflight-failed' });
    expect(logger.write).toHaveBeenLastCalledWith('warn', expect.objectContaining({
      stage: 'all-player-recurring-preclaim', allPlayerFailureStage: 'global-budget', allPlayerReason: 'recurring-preflight-failed',
    }));
    expect(logger.write).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(logger.write.mock.calls)).not.toMatch(/credential|raw payload/u);
    expect(canonicalOperation).not.toHaveBeenCalled();
    expect(store.recordAllPlayerPreclaimOutcome).toHaveBeenCalledTimes(2);
  });

  it('logs an overdue final-capture period without claiming that it was selected', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-25T12:00:00Z'));
    process.env.ALL_PLAYER_RECURRING_ENABLED = 'true';
    store.readLeagueLineupAuthorities.mockResolvedValueOnce(['league1', 'league2'].map((leagueKey) => ({
      kind: 'available', leagueKey, authority: {
        leagueLifecycle: 'active', activeSeason: 2026, activeSeasonType: 'reg', activeWeek: 3,
        sourceProvider: 'sleeper', verifiedAt: '2026-09-25T12:00:00Z',
      },
    })));
    await expect(runProductionAllPlayerRecurring()).resolves.toMatchObject({ reason: 'final-capture-overdue:2026:regular:1' });
    expect(logger.write).toHaveBeenCalledExactlyOnceWith('warn', expect.objectContaining({
      stage: 'all-player-recurring-preclaim', allPlayerReason: 'final-capture-overdue:2026:regular:1',
      period: { season: 2026, seasonType: 'regular', week: 1 },
    }));
    expect(canonicalOperation).not.toHaveBeenCalled();
    expect(store.recordAllPlayerPreclaimOutcome).toHaveBeenCalledExactlyOnceWith({
      outcome: 'validation-failed', stage: 'period-selection', reason: 'final-capture-overdue:2026:regular:1',
      period: { season: 2026, seasonType: 'reg', week: 1 }, retryDisposition: 'manual-review',
    });
  });

  it('sanitizes malformed stored period metadata and composition exceptions', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-12T12:00:00Z'));
    process.env.ALL_PLAYER_RECURRING_ENABLED = 'true';
    store.readAllPlayerJobState.mockResolvedValueOnce({ state: 'running', leaseUntil: '2026-09-12T12:00:55Z',
      payload: { period: { season: 'credential.invalid', seasonType: 'reg', week: 1 } } });
    await runProductionAllPlayerRecurring();
    expect(logger.write.mock.calls[0][1]).not.toHaveProperty('period');
    await expect(runProductionAllPlayerRecurring(NaN)).resolves.toMatchObject({ reason: 'recurring-preflight-failed' });
    expect(logger.write).toHaveBeenLastCalledWith('warn', expect.objectContaining({ allPlayerFailureStage: 'recurring-composition' }));
    expect(JSON.stringify(logger.write.mock.calls)).not.toContain('credential.invalid');
    expect(canonicalOperation).not.toHaveBeenCalled();
    expect(store.recordAllPlayerPreclaimOutcome).toHaveBeenCalledTimes(1);
  });

  it.each(['unchanged', 'throttled', 'disabled'] as const)('logs durable diagnostic disposition %s without implying a new write', async (disposition) => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-12T12:00:00Z'));
    process.env.ALL_PLAYER_RECURRING_ENABLED = 'true';
    store.readAllPlayerJobState.mockResolvedValueOnce({ payload: {}, nextRequestAt: '2026-09-13T00:00:00Z' });
    store.recordAllPlayerPreclaimOutcome.mockResolvedValueOnce(disposition);
    await runProductionAllPlayerRecurring();
    expect(logger.write).toHaveBeenCalledExactlyOnceWith('info', expect.objectContaining({
      allPlayerDiagnostics: [`preclaim-durability:${disposition}`],
    }));
  });

  it('bounds failed durable handling and never logs the database error text', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-12T12:00:00Z'));
    process.env.ALL_PLAYER_RECURRING_ENABLED = 'true';
    store.readAllPlayerJobState.mockResolvedValue({ payload: {}, nextRequestAt: '2026-09-13T00:00:00Z' });
    store.recordAllPlayerPreclaimOutcome.mockRejectedValueOnce(new Error('postgresql://credential.invalid/private'));
    await expect(runProductionAllPlayerRecurring()).resolves.toMatchObject({ status: 'skipped', reason: 'not-due' });
    expect(logger.write).toHaveBeenLastCalledWith('warn', expect.objectContaining({
      allPlayerDiagnostics: ['preclaim-durability:persistence-failed'],
    }));
    store.recordAllPlayerPreclaimOutcome.mockImplementationOnce(() => new Promise(() => {}));
    const pending = runProductionAllPlayerRecurring();
    await vi.advanceTimersByTimeAsync(3_000);
    await expect(pending).resolves.toMatchObject({ status: 'skipped', reason: 'not-due' });
    expect(store.recordAllPlayerPreclaimOutcome).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(logger.write.mock.calls)).not.toContain('credential.invalid');
    store.readAllPlayerJobState.mockReset();
  });

  it('does not attempt durable work after the invocation cleanup reserve is exhausted', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-12T12:00:00Z'));
    process.env.ALL_PLAYER_RECURRING_ENABLED = 'true';
    await runProductionAllPlayerRecurring(Date.now() - 55_000);
    expect(store.recordAllPlayerPreclaimOutcome).not.toHaveBeenCalled();
    expect(logger.write).toHaveBeenCalledExactlyOnceWith('warn', expect.objectContaining({
      allPlayerReason: 'insufficient-invocation-budget',
      allPlayerDiagnostics: ['preclaim-durability:deadline-unavailable'],
    }));
  });
});
