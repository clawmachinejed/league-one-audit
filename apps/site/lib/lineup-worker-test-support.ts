import { vi } from 'vitest';
import type { ClockPort } from './projections/ports/clock';
import type { LineupWatchRepositoryPort, LineupWatchState } from './projections/ports/lineup-watch-repository';
import type { PeriodAuthorityReaderPort, LineupPeriodAuthority } from './projections/ports/period-authority-reader';
import type { ProjectionRepositoryPort } from './projections/ports/projection-repository';

/** In-memory worker ports; database ordering and leases have separate real Neon tests. */
export function createLineupWorkerTestPorts(clock: Pick<ClockPort, 'now'>, persistence: ProjectionRepositoryPort) {
  const authorities = new Map<string, LineupPeriodAuthority>();
  const states = new Map<string, LineupWatchState>();
  const originalUpsert = persistence.upsertPeriodAuthority.bind(persistence);
  Object.assign(persistence, { upsertPeriodAuthority: vi.fn<ProjectionRepositoryPort['upsertPeriodAuthority']>(async (authority, metadata) => {
    const result = await originalUpsert(authority, metadata);
    if (result.kind === 'stored' || result.kind === 'verified') authorities.set(authority.configuration.key, {
      configuration: authority.configuration, authority, authorityGeneration: 1,
      shape: metadata.shape, defaultPeriodCadence: metadata.defaultPeriodCadence,
    });
    return result;
  }) });
  const periodAuthorityReader: PeriodAuthorityReaderPort = {
    readAuthorities: vi.fn<PeriodAuthorityReaderPort['readAuthorities']>(async (keys) => keys.map((key) => authorities.has(key)
      ? { kind: 'present' as const, leagueKey: key, value: authorities.get(key)! }
      : { kind: 'missing' as const, leagueKey: key })),
  };
  function reserve(state: LineupWatchState, workerId: string) {
    const value: LineupWatchState = { ...state, activeAttemptId: `attempt-${state.claimGeneration + 1}`,
      claimGeneration: state.claimGeneration + 1, leaseOwner: workerId,
      attemptStartedAt: clock.now().toISOString(), leaseExpiresAt: new Date(clock.now().getTime() + 120_000).toISOString() };
    states.set(value.watchId, value);
    return value;
  }
  const lineupRepository: LineupWatchRepositoryPort = {
    enabled: true,
    readLineupWatchSchedule: vi.fn<LineupWatchRepositoryPort['readLineupWatchSchedule']>(async () => []),
    synchronizeLineupWatchStates: vi.fn<LineupWatchRepositoryPort['synchronizeLineupWatchStates']>(async ({ targets }) => {
      for (const target of targets) {
        const watchId = `watch:${target.configuration.key}:${target.period.week}`;
        const prior = states.get(watchId);
        states.set(watchId, { ...target, watchId, watchGeneration: 1, nextCheckAt: target.initialNextCheckAt,
          observedVersion: 1, latestLineupRevision: 'a'.repeat(64), acceptedRequestStartedAt: null, acceptedRequestCompletedAt: null,
          lastCheckedAt: null, lastCompleteObservationAt: null, lastMaterializedLineupRevision: 'a'.repeat(64),
          lastMaterializedSnapshotRevision: null, lastMaterializedVerifiedAt: null, pendingSince: null,
          activeAttemptId: null, claimGeneration: 0, leaseOwner: null, attemptStartedAt: null,
          leaseExpiresAt: null, attemptCount: 0, consecutiveFailures: 0, lastFailureCode: null,
          retiredAt: null, retirementReason: null, ...prior,
          watchClass: target.watchClass, materializationLane: target.materializationLane, phase: target.phase });
      }
      return { kind: 'stored', states: [...states.values()] };
    }),
    claimDueLineupObservations: vi.fn<LineupWatchRepositoryPort['claimDueLineupObservations']>(async (input) => [...states.values()]
      .filter((state) => input.leagueKeys.includes(state.configuration.key) && state.materializationLane === input.materializationLane
        && state.watchClass !== 'completed' && state.activeAttemptId === null)
      .slice(0, input.limit).map((state) => reserve(state, input.workerId))),
    reserveFullLineupObservation: vi.fn<LineupWatchRepositoryPort['reserveFullLineupObservation']>(async ({ fence }) => {
      const state = states.get(fence.watchId);
      return state ? { kind: 'stored', state: reserve(state, fence.runId) } : { kind: 'stale' };
    }),
    completeLineupObservation: vi.fn<LineupWatchRepositoryPort['completeLineupObservation']>(async (input) => {
      const previous = states.get(input.claim.watchId);
      if (!previous) return { kind: 'stale' };
      const state = { ...previous, latestLineupRevision: input.actualLineup.lineupRevision,
        observedVersion: previous.observedVersion + Number(previous.latestLineupRevision !== input.actualLineup.lineupRevision),
        pendingSince: previous.lastMaterializedLineupRevision !== input.actualLineup.lineupRevision ? clock.now().toISOString() : null,
        activeAttemptId: null, leaseOwner: null, nextCheckAt: input.nextCheckAt };
      states.set(state.watchId, state);
      return { kind: 'stored', state };
    }),
    recordLineupObservationNotReady: vi.fn<LineupWatchRepositoryPort['recordLineupObservationNotReady']>(async () => ({ kind: 'stored' })),
    failLineupObservation: vi.fn<LineupWatchRepositoryPort['failLineupObservation']>(async () => ({ kind: 'stored' })),
    readPendingCurrentLineups: vi.fn<LineupWatchRepositoryPort['readPendingCurrentLineups']>(async (keys) => [...states.values()].filter((state) => keys.includes(state.configuration.key)
      && state.materializationLane === 'current' && state.pendingSince !== null)),
    readPendingFutureLineups: vi.fn<LineupWatchRepositoryPort['readPendingFutureLineups']>(async (keys) => [...states.values()].filter((state) => keys.includes(state.configuration.key)
      && state.materializationLane === 'future' && state.pendingSince !== null)),
    readLineupWatchStates: vi.fn<LineupWatchRepositoryPort['readLineupWatchStates']>(async (keys) => [...states.values()].filter((state) => keys.includes(state.configuration.key))),
    wakeFutureProjectionAndMaterialization: vi.fn<LineupWatchRepositoryPort['wakeFutureProjectionAndMaterialization']>(async () => ({ kind: 'stored' })),
    acknowledgeCurrentLineup: vi.fn<LineupWatchRepositoryPort['acknowledgeCurrentLineup']>(async () => ({ kind: 'updated' })),
    completeFutureMaterializationAndAcknowledgeLineup: vi.fn<LineupWatchRepositoryPort['completeFutureMaterializationAndAcknowledgeLineup']>(async () => ({ kind: 'updated',
      consecutiveFailures: 0, nextRefreshAt: clock.now().toISOString(), materializationsWoken: 0 })),
  };
  return { repository: persistence, lineupRepository, periodAuthorityReader, states, authorities };
}
