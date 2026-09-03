import { describe, expect, it, vi } from 'vitest';
import type { LeagueConfiguration, LeaguePeriod } from '../../domain/contracts';
import type { LineupPublicationFence } from '../../domain/lineup-publication';
import type { LineupObservationClaim, LineupWatchRepositoryPort } from '../../ports/lineup-watch-repository';
import type { ProjectionStore } from './contracts';
import type { StoredLineupWatchState } from './lineup-watch-contracts';
import { externalLeagueRef, externalRosterRef, providerKey } from '../../shared/provider-identity';
vi.mock('server-only', () => ({}));
import { createNeonLineupRepository } from './lineup-repository';

const timestamp = '2026-09-03T12:00:00.000Z';
const period: LeaguePeriod = { season: 2026, seasonType: 'regular', week: 5 };
const configuration: LeagueConfiguration = { key: 'alpha', displayName: 'Alpha',
  leagueRef: externalLeagueRef('sleeper', 'source-alpha'), matchupWeekRange: { firstWeek: 1, lastWeek: 18 } };
const options = { projectionSource: providerKey('tank01'), normalizerVersion: 'tank01-normalized-v1', modelVersion: 'clock-v1' };
const actualLineup = { revisionVersion: 'lineup-v1' as const, lineupRevision: 'c'.repeat(64) };
const currentFence: Extract<LineupPublicationFence, { ownerLane: 'current' }> = {
  ownerLane: 'current', watchId: 'watch-alpha', watchGeneration: 3, authorityGeneration: 7, runId: 'current-run',
};
const futureFence: Extract<LineupPublicationFence, { ownerLane: 'future' }> = {
  ...currentFence, ownerLane: 'future', runId: 'future-run', materializationAttemptId: 'materialization-attempt',
  projectionSource: options.projectionSource, normalizerVersion: options.normalizerVersion,
};
const claim: LineupObservationClaim = { watchId: 'watch-alpha', watchGeneration: 3, authorityGeneration: 7,
  watchClass: 'future', materializationLane: 'future', attemptId: 'thin-attempt', claimGeneration: 9,
  workerId: 'observer-run', targetObservedVersion: 11 };
function stored(overrides: Partial<StoredLineupWatchState> = {}): StoredLineupWatchState {
  return {
    id: 'watch-alpha', leagueKey: 'alpha', sourceProvider: 'sleeper', externalLeagueId: 'source-alpha',
    period: { season: 2026, seasonType: 'reg', week: 5 }, lineupRevisionVersion: 'lineup-v1',
    cadencePolicyVersion: 'cadence-v1', authorityGeneration: 7, watchClass: 'future', materializationLane: 'future', phase: 2,
    expectedRosterCount: 2, expectedStarterSlotCount: 3, expectedRosterIds: ['roster-a', 'roster-b'],
    watchGeneration: 3, nextCheckAt: '2026-09-03T12:03:00.000Z', observedVersion: 12,
    latestLineupRevision: actualLineup.lineupRevision, acceptedRequestStartedAt: timestamp,
    acceptedRequestCompletedAt: '2026-09-03T12:00:01.000Z', lastCheckedAt: timestamp,
    lastCompleteObservationAt: timestamp, lastMaterializedLineupRevision: 'a'.repeat(64),
    lastMaterializedSnapshotRevision: 'd'.repeat(64), lastMaterializedVerifiedAt: '2026-09-03T11:50:00.000Z',
    pendingSince: '2026-09-03T11:57:00.000Z', activeAttemptId: null, claimGeneration: 9, leaseOwner: null,
    attemptStartedAt: null, leaseExpiresAt: null, attemptCount: 10, consecutiveFailures: 0,
    lastFailureCode: null, retiredAt: null, retirementReason: null, ...overrides,
  };
}
function fixture(row = stored(), enabled = true) {
  const store = {
    enabled,
    synchronizeLineupWatchStates: vi.fn(async () => ({ kind: 'stored' as const, states: [row] })),
    claimDueLineupObservations: vi.fn(async () => [row]),
    reserveFullLineupObservation: vi.fn(async () => ({ kind: 'stored' as const, state: row })),
    completeLineupObservation: vi.fn(async () => ({ kind: 'stored' as const, state: row })),
    recordLineupObservationNotReady: vi.fn(async () => ({ kind: 'stored' as const })),
    failLineupObservation: vi.fn(async () => ({ kind: 'stored' as const })),
    readPendingFutureLineups: vi.fn(async () => [row]),
    readLineupWatchSchedule: vi.fn(async () => [{ leagueKey: row.leagueKey, sourceProvider: row.sourceProvider,
      externalLeagueId: row.externalLeagueId, period: row.period, phase: row.phase, watchClass: 'future' as const }]),
    wakeFutureProjectionAndMaterialization: vi.fn(async () => ({ kind: 'stored' as const })),
    acknowledgeCurrentLineup: vi.fn(async () => ({ kind: 'updated' as const })),
    completeFutureMaterializationAndAcknowledgeLineup: vi.fn(async () => ({ kind: 'updated' as const,
      consecutiveFailures: 0, nextRefreshAt: timestamp, materializationsWoken: 0 })),
  } satisfies Pick<ProjectionStore, 'enabled' | 'synchronizeLineupWatchStates' | 'claimDueLineupObservations'
    | 'reserveFullLineupObservation' | 'completeLineupObservation' | 'recordLineupObservationNotReady'
    | 'failLineupObservation' | 'readPendingFutureLineups'
    | 'readLineupWatchSchedule' | 'wakeFutureProjectionAndMaterialization' | 'acknowledgeCurrentLineup'
    | 'completeFutureMaterializationAndAcknowledgeLineup'>;
  const listActiveLeagues = vi.fn(() => [configuration]);
  return { store, listActiveLeagues, adapter: createNeonLineupRepository(store, { listActiveLeagues }, options) };
}

function assertCanonicalState(state: Awaited<ReturnType<LineupWatchRepositoryPort['readPendingFutureLineups']>>[number]) {
  expect(state.configuration).toBe(configuration);
  expect(state.configuration.matchupWeekRange).toEqual({ firstWeek: 1, lastWeek: 18 });
  expect(state).toMatchObject({ watchId: 'watch-alpha', period, latestLineupRevision: actualLineup.lineupRevision,
    observedVersion: 12, watchGeneration: 3, authorityGeneration: 7, claimGeneration: 9,
    pendingSince: '2026-09-03T11:57:00.000Z', lastMaterializedLineupRevision: 'a'.repeat(64) });
  expect(state.shape).toEqual({ expectedRosterCount: 2, expectedStarterSlotCount: 3,
    expectedRosterRefs: ['roster-a', 'roster-b'].map((id) => externalRosterRef(configuration.leagueRef, id)) });
  for (const field of ['id', 'leagueKey', 'sourceProvider', 'externalLeagueId', 'expectedRosterIds', 'expectedRosterCount', 'expectedStarterSlotCount']) {
    expect(state).not.toHaveProperty(field);
  }
}

describe('canonical Neon lineup repository boundary', () => {
  it('translates thin acceptance using the actual complete revision and scoped roster identities', async () => {
    const { adapter, store } = fixture();
    const input = { claim, actualLineup, requestStartedAt: timestamp,
      requestCompletedAt: '2026-09-03T12:00:01.000Z', nextCheckAt: '2026-09-03T12:03:00.000Z' };
    const result = await adapter.completeLineupObservation(input);
    expect(store.completeLineupObservation).toHaveBeenCalledExactlyOnceWith({ claim,
      lineupRevision: actualLineup.lineupRevision, requestStartedAt: input.requestStartedAt,
      requestCompletedAt: input.requestCompletedAt, nextCheckAt: input.nextCheckAt });
    if (result.kind !== 'stored') throw new Error('Expected stored fixture.');
    assertCanonicalState(result.state);
  });
  it.each([currentFence, futureFence])('translates the $ownerLane full reservation fence without changing ownership generations', async (fence) => {
    const { adapter, store } = fixture();
    const result = await adapter.reserveFullLineupObservation({ fence, modelVersion: 'clock-v1', leaseSeconds: 55 });
    expect(store.reserveFullLineupObservation).toHaveBeenCalledExactlyOnceWith({ modelVersion: 'clock-v1', leaseSeconds: 55,
      fence: fence.ownerLane === 'current' ? currentFence : {
        ownerLane: 'future', watchId: 'watch-alpha', watchGeneration: 3, authorityGeneration: 7,
        runId: 'future-run', materializationAttemptId: 'materialization-attempt', projectionProvider: 'tank01',
        normalizerVersion: options.normalizerVersion,
      } });
    if (result.kind !== 'stored') throw new Error('Expected stored fixture.');
    assertCanonicalState(result.state);
  });
  it('preserves canonical state on all complete-state reads', async () => {
    const { adapter, store } = fixture();
    for (const method of ['readPendingFutureLineups'] as const) {
      assertCanonicalState((await adapter[method](['alpha']))[0]);
      expect(store[method]).toHaveBeenCalledExactlyOnceWith(['alpha']);
    }
    const input = { leagueKeys: ['alpha'], materializationLane: 'future' as const, workerId: 'run',
      leaseSeconds: 55, limit: 20, futureLimit: 18, catchUp: false };
    assertCanonicalState((await adapter.claimDueLineupObservations(input))[0]);
    expect(store.claimDueLineupObservations).toHaveBeenCalledExactlyOnceWith(input);
  });
  it.each([['pre', 'preseason'], ['reg', 'regular'], ['post', 'postseason']] as const)(
    'translates %s periods in both state and planning-only schedule reads', async (storedType, canonicalType) => {
      const { adapter, store } = fixture(stored({ period: { season: 2026, seasonType: storedType, week: 5 },
        lastCompleteObservationAt: '2026-01-01T00:00:00.000Z' }));
      expect((await adapter.readPendingFutureLineups(['alpha']))[0].period.seasonType).toBe(canonicalType);
      expect(await adapter.readLineupWatchSchedule(['alpha'])).toEqual([{ leagueKey: 'alpha', leagueRef: configuration.leagueRef,
        period: { ...period, seasonType: canonicalType }, phase: 2, watchClass: 'future' }]);
      expect(store.readLineupWatchSchedule).toHaveBeenCalledExactlyOnceWith(['alpha']);
    });
  it('leaves stale schedule identities visible only for planning so the authority layer can match or discard them', async () => {
    const { adapter, listActiveLeagues } = fixture(stored({ externalLeagueId: 'replaced-source', sourceProvider: 'retired-provider' }));
    expect(await adapter.readLineupWatchSchedule(['alpha'])).toEqual([{ leagueKey: 'alpha',
      leagueRef: externalLeagueRef('retired-provider', 'replaced-source'), period, phase: 2, watchClass: 'future' }]);
    expect(listActiveLeagues).not.toHaveBeenCalled();
  });
  it.each([{ leagueKey: 'unregistered' }, { sourceProvider: 'replacement' }, { externalLeagueId: 'replacement' },
    { lineupRevisionVersion: 'lineup-v2' }])('rejects complete-state identity mismatch %j', async (overrides) => {
    const { adapter } = fixture(stored(overrides));
    await expect(adapter.readPendingFutureLineups(['alpha'])).rejects.toThrow('Stored lineup identity does not match its registry.');
  });
  it('translates the complete synchronization target and keeps the configured horizon', async () => {
    const { adapter, store } = fixture();
    const input = { registeredLeagueKeys: ['alpha'], targets: [{ configuration, period,
      shape: { expectedRosterCount: 2, expectedStarterSlotCount: 3,
        expectedRosterRefs: ['roster-a', 'roster-b'].map((id) => externalRosterRef(configuration.leagueRef, id)) },
      authorityGeneration: 7, lineupRevisionVersion: 'lineup-v1' as const, cadencePolicyVersion: 'cadence-v1',
      watchClass: 'future' as const, materializationLane: 'future' as const, phase: 2 as const, initialNextCheckAt: timestamp }] };
    const result = await adapter.synchronizeLineupWatchStates(input);
    expect(store.synchronizeLineupWatchStates).toHaveBeenCalledExactlyOnceWith({ registeredLeagueKeys: ['alpha'], targets: [{
      leagueKey: 'alpha', sourceProvider: 'sleeper', externalLeagueId: 'source-alpha',
      period: { season: 2026, seasonType: 'reg', week: 5 }, authorityGeneration: 7,
      lineupRevisionVersion: 'lineup-v1', cadencePolicyVersion: 'cadence-v1', watchClass: 'future', materializationLane: 'future',
      phase: 2, expectedRosterCount: 2, expectedStarterSlotCount: 3, expectedRosterIds: ['roster-a', 'roster-b'], initialNextCheckAt: timestamp,
    }] });
    if (result.kind !== 'stored') throw new Error('Expected stored fixture.');
    assertCanonicalState(result.states[0]);
  });
  it('rejects roster identities scoped to another league before synchronization', async () => {
    const { adapter, store } = fixture();
    await expect(adapter.synchronizeLineupWatchStates({ registeredLeagueKeys: ['alpha'], targets: [{ configuration, period,
      shape: { expectedRosterCount: 1, expectedStarterSlotCount: 1,
        expectedRosterRefs: [externalRosterRef(externalLeagueRef('sleeper', 'other-league'), 'roster-a')] },
      authorityGeneration: 7, lineupRevisionVersion: 'lineup-v1', cadencePolicyVersion: 'cadence-v1',
      watchClass: 'future', materializationLane: 'future', phase: 2, initialNextCheckAt: timestamp }] }))
      .rejects.toThrow('Lineup roster shape belongs to a different league.');
    expect(store.synchronizeLineupWatchStates).not.toHaveBeenCalled();
  });
  it('acknowledges current publication with actual full-source lineage and unchanged snapshot revision', async () => {
    const { adapter, store } = fixture();
    await adapter.acknowledgeCurrentLineup({ leagueKey: 'alpha', period, fence: currentFence, modelVersion: 'clock-v1',
      sourceRevision: 'full-source-C', actualLineup, snapshotRevision: 'd'.repeat(64) });
    expect(store.acknowledgeCurrentLineup).toHaveBeenCalledExactlyOnceWith({ leagueKey: 'alpha',
      period: { season: 2026, seasonType: 'reg', week: 5 }, fence: currentFence, modelVersion: 'clock-v1',
      sourceRevision: 'full-source-C', lineupRevisionVersion: 'lineup-v1', lineupRevision: 'c'.repeat(64), snapshotRevision: 'd'.repeat(64) });
  });
  it('forwards actual full C separately from claimed B when atomically completing a future publication', async () => {
    const { adapter, store } = fixture();
    const input: Parameters<LineupWatchRepositoryPort['completeFutureMaterializationAndAcknowledgeLineup']>[0] = {
      leagueKey: 'alpha', projectionSource: options.projectionSource, normalizerVersion: options.normalizerVersion,
      modelVersion: 'clock-v1', period, attemptId: 'materialization-attempt' as never,
      completedAt: timestamp, nextRefreshAt: '2026-09-03T13:00:00.000Z',
      target: { watchId: 'watch-alpha', watchGeneration: 3, authorityGeneration: 7, observedVersion: 11, lineupRevision: 'b'.repeat(64) },
      sourceRevision: 'full-source-C', actualLineup,
      slate: { observationId: 'slate-observation' as never, contentId: 'slate-content' as never },
      snapshotRevision: 'd'.repeat(64), runId: 'future-run',
    };
    await adapter.completeFutureMaterializationAndAcknowledgeLineup(input);
    const { actualLineup: revision, projectionSource, ...rest } = input;
    expect(store.completeFutureMaterializationAndAcknowledgeLineup).toHaveBeenCalledExactlyOnceWith({ ...rest,
      projectionProvider: projectionSource, period: { season: 2026, seasonType: 'reg', week: 5 },
      lineupRevisionVersion: revision.revisionVersion, lineupRevision: revision.lineupRevision });
  });
  it('adds configured projection identity to wake-up requests without changing observation watermarks', async () => {
    const { adapter, store } = fixture();
    const input = { watchId: 'watch-alpha', watchGeneration: 3, authorityGeneration: 7, weekDistance: 4, wakeProjection: false };
    await adapter.wakeFutureProjectionAndMaterialization(input);
    expect(store.wakeFutureProjectionAndMaterialization).toHaveBeenCalledExactlyOnceWith({ ...input,
      projectionProvider: 'tank01', normalizerVersion: options.normalizerVersion, modelVersion: 'clock-v1' });
  });
  it('passes not-ready and failure transitions through without inventing a revision', async () => {
    const { adapter, store } = fixture();
    const notReady = { claim, checkedAt: timestamp, nextCheckAt: '2026-09-03T12:03:00.000Z' };
    const failure = { claim, failureCode: 'source-unavailable', retryDelaysSeconds: [180, 300, 900, 3600] as const };
    expect(await adapter.recordLineupObservationNotReady(notReady)).toEqual({ kind: 'stored' });
    expect(await adapter.failLineupObservation(failure)).toEqual({ kind: 'stored' });
    expect(store.recordLineupObservationNotReady).toHaveBeenCalledExactlyOnceWith(notReady);
    expect(store.failLineupObservation).toHaveBeenCalledExactlyOnceWith(failure);
  });
  it('exits every disabled method before inspecting inputs, configuration, or low-level store operations', async () => {
    const { adapter, store, listActiveLeagues } = fixture(stored(), false);
    expect(adapter.enabled).toBe(false);
    const reads = new Set(['claimDueLineupObservations', 'readPendingFutureLineups',
      'readLineupWatchSchedule']);
    for (const [name, method] of Object.entries(adapter)) {
      if (typeof method !== 'function') continue;
      expect(await method(undefined as never)).toEqual(reads.has(name) ? [] : { kind: 'disabled' });
    }
    for (const method of Object.values(store)) if (typeof method === 'function') expect(method).not.toHaveBeenCalled();
    expect(listActiveLeagues).not.toHaveBeenCalled();
  });
});
