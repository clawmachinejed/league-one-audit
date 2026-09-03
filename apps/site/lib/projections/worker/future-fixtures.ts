import { vi, type Mock } from 'vitest';
import { cadenceInput, source, type FakeStore, type WorkerTestDependencies } from '../../live-projection-worker.fixtures';
import type { LineupWatchState, LineupWatchTarget, LineupWatchRepositoryPort } from '../ports/lineup-watch-repository';
import type { PeriodAuthorityReadResult } from '../ports/period-authority-reader';
import type { FuturePersistence, FutureProjectionWorkerDependencies } from './future-contracts';

export function watchState(target: LineupWatchTarget, overrides: Partial<LineupWatchState> = {}): LineupWatchState {
  return { ...target, watchId: `${target.configuration.key}-watch-${target.period.week}`, watchGeneration: 1,
    nextCheckAt: target.initialNextCheckAt, observedVersion: 0, latestLineupRevision: null,
    acceptedRequestStartedAt: null, acceptedRequestCompletedAt: null, lastCheckedAt: null,
    lastCompleteObservationAt: null, lastMaterializedLineupRevision: null, lastMaterializedSnapshotRevision: null,
    lastMaterializedVerifiedAt: null, pendingSince: null, activeAttemptId: null, claimGeneration: 0,
    leaseOwner: null, attemptStartedAt: null, leaseExpiresAt: null, attemptCount: 0,
    consecutiveFailures: 0, lastFailureCode: null, retiredAt: null, retirementReason: null, ...overrides };
}

export function futureDependencies(base: WorkerTestDependencies, store: FakeStore) {
  const acknowledge = store.completeFutureMaterialization as Mock<LineupWatchRepositoryPort['completeFutureMaterializationAndAcknowledgeLineup']>;
  const scope = base.futureScopeMock as Mock<(signal: AbortSignal) => FuturePersistence>;
  const states = new Map<string, LineupWatchState>();
  const leagueRegistry = { listActiveLeagues: () => base.leagueRegistry.listActiveLeagues().map((configuration) => ({
    ...configuration, matchupWeekRange: configuration.matchupWeekRange ?? { firstWeek: 1, lastWeek: 18 },
  })) };
  const authorityMock = vi.fn(async (): Promise<readonly PeriodAuthorityReadResult[]> => {
    const configurations = leagueRegistry.listActiveLeagues();
    return configurations.map((configuration) => {
      const cadence = cadenceInput(String(configuration.leagueRef.externalId));
      const fixture = source(String(configuration.leagueRef.externalId));
      const at = base.clock.now().toISOString();
      return { kind: 'present', leagueKey: configuration.key, value: {
        configuration, authorityGeneration: 1,
        shape: { expectedRosterCount: fixture.participants.length, expectedStarterSlotCount: fixture.matchups[0].sides[0].starters.length,
          expectedRosterRefs: fixture.participants.map((roster) => ({ ...roster.rosterRef, league: configuration.leagueRef })) },
        defaultPeriodCadence: { isCurrentRegularPeriod: true, games: [] },
        authority: { ...cadence.periodAuthority, configuration, observedAt: at, verifiedAt: at },
      } };
    });
  });
  const lineupRepository = {
    enabled: true,
    synchronizeLineupWatchStates: vi.fn(async (input: Parameters<LineupWatchRepositoryPort['synchronizeLineupWatchStates']>[0]) => {
      for (const target of input.targets) {
        const id = `${target.configuration.key}-watch-${target.period.week}`;
        const existing = states.get(id);
        states.set(id, existing ?? watchState(target));
      }
      return { kind: 'stored' as const, states: [...states.values()] };
    }),
    claimDueLineupObservations: vi.fn(async () => []),
    reserveFullLineupObservation: vi.fn(async (input: Parameters<LineupWatchRepositoryPort['reserveFullLineupObservation']>[0]) => {
      const original = states.get(input.fence.watchId);
      if (!original) return { kind: 'stale' as const };
      const state = { ...original, activeAttemptId: `observation-${input.fence.runId}`, claimGeneration: original.claimGeneration + 1,
        leaseOwner: input.fence.runId, leaseExpiresAt: new Date(base.clock.now().getTime() + 55_000).toISOString() };
      states.set(state.watchId, state);
      return { kind: 'stored' as const, state };
    }),
    completeLineupObservation: vi.fn(async (input: Parameters<LineupWatchRepositoryPort['completeLineupObservation']>[0]) => {
      const original = states.get(input.claim.watchId)!;
      const state = { ...original, latestLineupRevision: input.actualLineup.lineupRevision,
        observedVersion: original.observedVersion + 1, activeAttemptId: null, leaseOwner: null, leaseExpiresAt: null };
      states.set(state.watchId, state);
      return { kind: 'stored' as const, state };
    }),
    recordLineupObservationNotReady: vi.fn(async () => ({ kind: 'stored' as const })),
    failLineupObservation: vi.fn(async () => ({ kind: 'stored' as const })),
    readPendingCurrentLineups: vi.fn(async () => []),
    readPendingFutureLineups: vi.fn(async () => []),
    readLineupWatchStates: vi.fn(async () => [...states.values()]),
    readLineupWatchSchedule: vi.fn(async () => []),
    wakeFutureProjectionAndMaterialization: vi.fn(async () => ({ kind: 'stored' as const })),
    acknowledgeCurrentLineup: vi.fn(async () => ({ kind: 'updated' as const })),
    completeFutureMaterializationAndAcknowledgeLineup: async (input) => acknowledge(input),
  } satisfies LineupWatchRepositoryPort;
  const periodAuthorityReader = { readAuthorities: authorityMock };
  scope.mockImplementation(() => ({ repository: store.repository, identityCrosswalk: store.identityCrosswalk,
    lineupRepository, periodAuthorityReader }));
  const result = { ...base, repository: store.repository, identityCrosswalk: store.identityCrosswalk,
    leagueRegistry, lineupRepository, periodAuthorityReader, states, authorityMock,
    futurePersistence: { scope: (signal: AbortSignal) => scope(signal) },
  };
  return result satisfies FutureProjectionWorkerDependencies;
}
