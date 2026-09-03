import 'server-only';
import type { ProjectionStore } from './contracts';
import type { StoredLineupWatchState } from './lineup-watch-contracts';
import type { LeagueRegistryPort } from '../../ports/league-registry';
import type { LineupObservationWriteOutcome, LineupWatchRepositoryPort, LineupWatchState } from '../../ports/lineup-watch-repository';
import { externalLeagueRef, externalRosterRef, sameExternalReference, type ProviderKey } from '../../shared/provider-identity';
import { storedLineupPeriod, storedLineupPublicationFence } from './lineup-repository-values';

type LineupStore = Pick<ProjectionStore, 'enabled' | 'synchronizeLineupWatchStates'
  | 'claimDueLineupObservations' | 'reserveFullLineupObservation' | 'completeLineupObservation'
  | 'recordLineupObservationNotReady' | 'failLineupObservation' | 'readPendingCurrentLineups'
  | 'readPendingFutureLineups' | 'readLineupWatchStates' | 'readLineupWatchSchedule' | 'wakeFutureProjectionAndMaterialization'
  | 'acknowledgeCurrentLineup' | 'completeFutureMaterializationAndAcknowledgeLineup'>;

function disabledLineupRepository(): LineupWatchRepositoryPort {
  return {
    enabled: false,
    synchronizeLineupWatchStates: async () => ({ kind: 'disabled' }),
    claimDueLineupObservations: async () => [],
    reserveFullLineupObservation: async () => ({ kind: 'disabled' }),
    completeLineupObservation: async () => ({ kind: 'disabled' }),
    recordLineupObservationNotReady: async () => ({ kind: 'disabled' }),
    failLineupObservation: async () => ({ kind: 'disabled' }),
    readPendingCurrentLineups: async () => [],
    readPendingFutureLineups: async () => [],
    readLineupWatchStates: async () => [],
    readLineupWatchSchedule: async () => [],
    wakeFutureProjectionAndMaterialization: async () => ({ kind: 'disabled' }),
    acknowledgeCurrentLineup: async () => ({ kind: 'disabled' }),
    completeFutureMaterializationAndAcknowledgeLineup: async () => ({ kind: 'disabled' }),
  };
}

export function createNeonLineupRepository(
  store: LineupStore,
  registry: LeagueRegistryPort,
  options: Readonly<{ projectionSource: ProviderKey; normalizerVersion: string; modelVersion: string }>,
): LineupWatchRepositoryPort {
  if (!store.enabled) return disabledLineupRepository();
  function state(row: StoredLineupWatchState): LineupWatchState {
    const configuration = registry.listActiveLeagues().find((league) => league.key === row.leagueKey);
    const leagueRef = externalLeagueRef(row.sourceProvider, row.externalLeagueId);
    if (!configuration || !sameExternalReference(configuration.leagueRef, leagueRef)
      || row.lineupRevisionVersion !== 'lineup-v1') throw new Error('Stored lineup identity does not match its registry.');
    return {
      watchId: row.id, configuration, lineupRevisionVersion: 'lineup-v1',
      cadencePolicyVersion: row.cadencePolicyVersion, authorityGeneration: row.authorityGeneration,
      watchClass: row.watchClass, materializationLane: row.materializationLane, phase: row.phase,
      watchGeneration: row.watchGeneration, nextCheckAt: row.nextCheckAt, observedVersion: row.observedVersion,
      latestLineupRevision: row.latestLineupRevision, acceptedRequestStartedAt: row.acceptedRequestStartedAt,
      acceptedRequestCompletedAt: row.acceptedRequestCompletedAt, lastCheckedAt: row.lastCheckedAt,
      lastCompleteObservationAt: row.lastCompleteObservationAt,
      lastMaterializedLineupRevision: row.lastMaterializedLineupRevision,
      lastMaterializedSnapshotRevision: row.lastMaterializedSnapshotRevision,
      lastMaterializedVerifiedAt: row.lastMaterializedVerifiedAt, pendingSince: row.pendingSince,
      activeAttemptId: row.activeAttemptId, claimGeneration: row.claimGeneration, leaseOwner: row.leaseOwner,
      attemptStartedAt: row.attemptStartedAt, leaseExpiresAt: row.leaseExpiresAt,
      attemptCount: row.attemptCount, consecutiveFailures: row.consecutiveFailures,
      lastFailureCode: row.lastFailureCode, retiredAt: row.retiredAt, retirementReason: row.retirementReason,
      period: { ...row.period, seasonType: row.period.seasonType === 'pre' ? 'preseason'
        : row.period.seasonType === 'post' ? 'postseason' : 'regular' },
      shape: { expectedRosterCount: row.expectedRosterCount, expectedStarterSlotCount: row.expectedStarterSlotCount,
        expectedRosterRefs: row.expectedRosterIds.map((id) => externalRosterRef(leagueRef, id)) },
    };
  }
  function observation(outcome: Awaited<ReturnType<ProjectionStore['completeLineupObservation']>>): LineupObservationWriteOutcome {
    return outcome.kind === 'stored' ? { kind: 'stored', state: state(outcome.state) } : outcome;
  }
  return {
    enabled: store.enabled,
    async synchronizeLineupWatchStates(input) {
      const result = await store.synchronizeLineupWatchStates({
        registeredLeagueKeys: input.registeredLeagueKeys,
        targets: input.targets.map((target) => {
          if (target.shape.expectedRosterRefs.some((ref) => !sameExternalReference(ref.league, target.configuration.leagueRef))) {
            throw new Error('Lineup roster shape belongs to a different league.');
          }
          return {
            leagueKey: target.configuration.key, sourceProvider: target.configuration.leagueRef.provider,
            externalLeagueId: String(target.configuration.leagueRef.externalId), period: storedLineupPeriod(target.period),
            lineupRevisionVersion: target.lineupRevisionVersion, cadencePolicyVersion: target.cadencePolicyVersion,
            authorityGeneration: target.authorityGeneration, watchClass: target.watchClass,
            materializationLane: target.materializationLane, phase: target.phase,
            expectedRosterCount: target.shape.expectedRosterCount,
            expectedStarterSlotCount: target.shape.expectedStarterSlotCount,
            expectedRosterIds: target.shape.expectedRosterRefs.map((ref) => String(ref.externalId)),
            initialNextCheckAt: target.initialNextCheckAt,
          };
        }),
      });
      return result.kind === 'stored' ? { kind: 'stored', states: result.states.map(state) } : result;
    },
    async claimDueLineupObservations(input) { return (await store.claimDueLineupObservations(input)).map(state); },
    async reserveFullLineupObservation(input) {
      return observation(await store.reserveFullLineupObservation({ ...input, fence: storedLineupPublicationFence(input.fence) }));
    },
    async completeLineupObservation({ actualLineup, ...input }) {
      return observation(await store.completeLineupObservation({ ...input, lineupRevision: actualLineup.lineupRevision }));
    },
    recordLineupObservationNotReady: (input) => store.recordLineupObservationNotReady(input),
    failLineupObservation: (input) => store.failLineupObservation(input),
    async readPendingCurrentLineups(keys) { return (await store.readPendingCurrentLineups(keys)).map(state); },
    async readPendingFutureLineups(keys) { return (await store.readPendingFutureLineups(keys)).map(state); },
    async readLineupWatchStates(keys) { return (await store.readLineupWatchStates(keys)).map(state); },
    async readLineupWatchSchedule(keys) {
      return (await store.readLineupWatchSchedule(keys)).map((row) => ({ leagueKey: row.leagueKey,
        leagueRef: externalLeagueRef(row.sourceProvider, row.externalLeagueId), phase: row.phase, watchClass: row.watchClass,
        period: { ...row.period, seasonType: row.period.seasonType === 'pre' ? 'preseason' as const
          : row.period.seasonType === 'post' ? 'postseason' as const : 'regular' as const } }));
    },
    wakeFutureProjectionAndMaterialization: (input) => store.wakeFutureProjectionAndMaterialization({
      ...input, projectionProvider: options.projectionSource,
      normalizerVersion: options.normalizerVersion, modelVersion: options.modelVersion,
    }),
    acknowledgeCurrentLineup({ actualLineup, ...input }) {
      return store.acknowledgeCurrentLineup({ ...input, period: storedLineupPeriod(input.period),
        lineupRevisionVersion: actualLineup.revisionVersion, lineupRevision: actualLineup.lineupRevision });
    },
    completeFutureMaterializationAndAcknowledgeLineup({ actualLineup, projectionSource, ...input }) {
      return store.completeFutureMaterializationAndAcknowledgeLineup({ ...input,
        projectionProvider: projectionSource, period: storedLineupPeriod(input.period),
        lineupRevisionVersion: actualLineup.revisionVersion, lineupRevision: actualLineup.lineupRevision });
    },
  };
}
