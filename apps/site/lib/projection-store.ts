import 'server-only';

import { getDatabase, type Database } from './database';
import type { ProjectionStore } from './projections/adapters/neon/contracts';
import { connected } from './projections/adapters/neon/database-values';
import { createDisabledProjectionStore } from './projections/adapters/neon/disabled-store';
import { createFutureRefreshMethods } from './projections/adapters/neon/future-refresh';
import { createIdentityMethods } from './projections/adapters/neon/identities';
import { createJobMethods } from './projections/adapters/neon/jobs';
import { createObservationMethods } from './projections/adapters/neon/observations';
import { createPeriodMethods } from './projections/adapters/neon/periods';
import { createAuthorityReadMethods } from './projections/adapters/neon/authority-reader';
import { createSnapshotRevisionMethods } from './projections/adapters/neon/snapshot-revision';
import { createLineupAcknowledgmentMethods } from './projections/adapters/neon/lineup-acknowledgment';
import { createLineupWatchSyncMethods } from './projections/adapters/neon/lineup-watch-sync';
import { createLineupWatchClaimMethods } from './projections/adapters/neon/lineup-watch-claims';
import { createLineupWatchObservationMethods } from './projections/adapters/neon/lineup-watch-observations';
import { createLineupWatchReadMethods } from './projections/adapters/neon/lineup-watch-read';
import { createFullLineupObservationMethods } from './projections/adapters/neon/lineup-full-observation';
import { createProjectionMethods } from './projections/adapters/neon/projections';
import { createProjectionSlateMethods } from './projections/adapters/neon/projection-slates';
import { createRetentionMethods } from './projections/adapters/neon/retention';
import { createSnapshotMethods } from './projections/adapters/neon/snapshots';

export type {
  ExternalIdentity,
  FutureRefreshFailureCode,
  GameStateInput,
  HistoryRetentionResult,
  JobClaim,
  LeagueSeasonReference,
  LeagueLifecycle,
  LeaguePeriodAuthorityInput,
  LeagueWeekObservationInput,
  NflGameIdentityInput,
  ObservationQuality,
  NflPhase,
  OfficialPlayerPointInput,
  OfficialRosterPointInput,
  PersistenceOutcome,
  PeriodAuthorityWriteOutcome,
  PlayerProjectionRecord,
  ProjectionActivityWindow,
  ProjectionCandidateInput,
  ProjectionQuality,
  ProjectionRunInput,
  ProjectionSlateEntryInput,
  ProjectionSlateInput,
  ProjectionSlatePointerOutcome,
  ProjectionStore,
  PublishSnapshotInput,
  PublishSnapshotOutcome,
  ResolvedNflGame,
  ResolvedScoringEntity,
  ScoringEntityIdentityInput,
  ScoringEntityKind,
  SeasonType,
  StoredGameState,
  StoredFutureMaterializationFreshness,
  StoredLeagueWeekObservation,
  StoredLeaguePeriodAuthority,
  StoredMatchupSnapshotContext,
  StoredMatchupRevisionContext,
  StoredMatchupRevisionSnapshot,
  StoredLeagueLineupAuthority,
  StoredLeagueAuthorityRead,
  StoreFutureMaterializationRefreshState,
  StoreFutureProjectionRefreshState,
  StoreFutureProjectionSlateLineage,
  StoreFutureRefreshClaim,
  StoreFutureRefreshPeriod,
  StoreFutureRefreshPlanPeriod,
  StoreFutureRefreshTarget,
  StoreFutureRefreshTransition,
  StoredProjectionRun,
  StoredProjectionSlate,
  StoredProjectionSlateObservation,
  StoredProjectionSnapshot,
  StoredProjectionSnapshotSelection,
} from './projections/adapters/neon/contracts';
export { InvalidStoredProjectionSnapshotError } from './projections/adapters/neon/snapshot-codec';
export type {
  StoreLineupPublicationFence, StoreLineupMaterializationTarget,
  StoreCompleteFutureLineupInput, StoreAcknowledgeCurrentLineupInput,
} from './projections/adapters/neon/lineup-publication-contracts';
export type {
  LineupWatchTarget, StoredLineupWatchState, StoredLineupWatchSchedule, LineupWatchFence, LineupObservationClaim,
  CompleteLineupObservationInput, FullLineupObservationInput, LineupObservationWriteOutcome,
  LineupWatchTransition, LineupWatchSyncInput, ClaimDueLineupObservationsInput, WakeFutureLineupInput,
} from './projections/adapters/neon/lineup-watch-contracts';

export function createProjectionStore(database: Database = getDatabase()): ProjectionStore {
  const client = connected(database);
  if (!client) return createDisabledProjectionStore();

  const identities = createIdentityMethods(client);
  const futureRefresh = createFutureRefreshMethods(client);
  const projections = createProjectionMethods(client);
  const projectionSlates = createProjectionSlateMethods(client);
  const observations = createObservationMethods(client);
  const periods = createPeriodMethods(client);
  const authorityReads = createAuthorityReadMethods(client);
  const snapshotRevisions = createSnapshotRevisionMethods(client);
  const lineupAcknowledgments = createLineupAcknowledgmentMethods(client);
  const lineupSync = createLineupWatchSyncMethods(client);
  const lineupClaims = createLineupWatchClaimMethods(client);
  const lineupObservations = createLineupWatchObservationMethods(client);
  const lineupReads = createLineupWatchReadMethods(client);
  const fullLineupObservations = createFullLineupObservationMethods(client);
  const jobs = createJobMethods(client);
  const snapshots = createSnapshotMethods(client);
  const retention = createRetentionMethods(client);

  return {
    enabled: true,
    upsertLeaguePeriodAuthority: periods.upsertLeaguePeriodAuthority,
    readMatchupSnapshotByLeagueKey: periods.readMatchupSnapshotByLeagueKey,
    readLeagueLineupAuthorities: authorityReads.readLeagueLineupAuthorities,
    readMatchupSnapshotRevisionByLeagueKey: snapshotRevisions.readMatchupSnapshotRevisionByLeagueKey,
    acknowledgeCurrentLineup: lineupAcknowledgments.acknowledgeCurrentLineup,
    completeFutureMaterializationAndAcknowledgeLineup: lineupAcknowledgments.completeFutureMaterializationAndAcknowledgeLineup,
    synchronizeLineupWatchStates: lineupSync.synchronizeLineupWatchStates,
    claimDueLineupObservations: lineupClaims.claimDueLineupObservations,
    reserveFullLineupObservation: fullLineupObservations.reserveFullLineupObservation,
    completeLineupObservation: lineupObservations.completeLineupObservation,
    recordLineupObservationNotReady: lineupObservations.recordLineupObservationNotReady,
    failLineupObservation: lineupObservations.failLineupObservation,
    supersedeLineupClaimWithFullObservation: lineupObservations.supersedeLineupClaimWithFullObservation,
    readPendingCurrentLineups: lineupReads.readPendingCurrentLineups,
    readPendingFutureLineups: lineupReads.readPendingFutureLineups,
    readLineupWatchStates: lineupReads.readLineupWatchStates,
    readLineupWatchSchedule: lineupReads.readLineupWatchSchedule,
    wakeFutureProjectionAndMaterialization: lineupReads.wakeFutureProjectionAndMaterialization,
    registerLeagueSeason: identities.registerLeagueSeason,
    upsertScoringEntities: identities.upsertScoringEntities,
    upsertNflGames: identities.upsertNflGames,
    recordProjectionSlate: projectionSlates.recordProjectionSlate,
    readCurrentProjectionSlate: projectionSlates.readCurrentProjectionSlate,
    ensureFutureRefreshStates: futureRefresh.ensureFutureRefreshStates,
    readFutureRefreshPlan: futureRefresh.readFutureRefreshPlan,
    beginFutureProjectionRefresh: futureRefresh.beginFutureProjectionRefresh,
    completeFutureProjectionRefresh: futureRefresh.completeFutureProjectionRefresh,
    failFutureProjectionRefresh: futureRefresh.failFutureProjectionRefresh,
    beginFutureMaterializationRefresh: futureRefresh.beginFutureMaterializationRefresh,
    completeFutureMaterializationRefresh: futureRefresh.completeFutureMaterializationRefresh,
    failFutureMaterializationRefresh: futureRefresh.failFutureMaterializationRefresh,
    recordProjectionCandidates: projections.recordProjectionCandidates,
    readLatestCandidatesBySleeperIds: projections.readLatestCandidatesBySleeperIds,
    freezeLatestBaselines: projections.freezeLatestBaselines,
    readFrozenBaselinesBySleeperIds: projections.readFrozenBaselinesBySleeperIds,
    recordGameStates: observations.recordGameStates,
    recordLeagueWeekObservation: observations.recordLeagueWeekObservation,
    acquireJob: jobs.acquireJob,
    completeJob: jobs.completeJob,
    failJob: jobs.failJob,
    publishSnapshot: snapshots.publishSnapshot,
    pruneHistory: retention.pruneHistory,
    readCurrentSnapshot: snapshots.readCurrentSnapshot,
    readSnapshotSelectionBySleeperLeagueId: snapshots.readSnapshotSelectionBySleeperLeagueId,
  } satisfies ProjectionStore;
}

let cachedDatabase: Database | undefined;
let cachedStore: ProjectionStore | undefined;

export function getProjectionStore(): ProjectionStore {
  const database = getDatabase();
  if (!cachedStore || cachedDatabase !== database) {
    cachedDatabase = database;
    cachedStore = createProjectionStore(database);
  }
  return cachedStore;
}
