import 'server-only';

import { getDatabase, type Database } from './database';
import type { ProjectionStore } from './projections/adapters/neon/contracts';
import { connected } from './projections/adapters/neon/database-values';
import { createDisabledProjectionStore } from './projections/adapters/neon/disabled-store';
import { createIdentityMethods } from './projections/adapters/neon/identities';
import { createJobMethods } from './projections/adapters/neon/jobs';
import { createObservationMethods } from './projections/adapters/neon/observations';
import { createProjectionMethods } from './projections/adapters/neon/projections';
import { createRetentionMethods } from './projections/adapters/neon/retention';
import { createSnapshotMethods } from './projections/adapters/neon/snapshots';

export type {
  ExternalIdentity,
  GameStateInput,
  HistoryRetentionResult,
  JobClaim,
  LeagueSeasonReference,
  LeagueWeekObservationInput,
  NflGameIdentityInput,
  ObservationQuality,
  OfficialPlayerPointInput,
  OfficialRosterPointInput,
  PersistenceOutcome,
  PlayerProjectionRecord,
  ProjectionActivityWindow,
  ProjectionCandidateInput,
  ProjectionQuality,
  ProjectionRunInput,
  ProjectionStore,
  PublishSnapshotInput,
  PublishSnapshotOutcome,
  ResolvedNflGame,
  ResolvedScoringEntity,
  ScoringEntityIdentityInput,
  ScoringEntityKind,
  SeasonType,
  StoredGameState,
  StoredLeagueWeekObservation,
  StoredProjectionRun,
  StoredProjectionSnapshot,
  StoredProjectionSnapshotSelection,
} from './projections/adapters/neon/contracts';
export { InvalidStoredProjectionSnapshotError } from './projections/adapters/neon/snapshot-codec';

export function createProjectionStore(database: Database = getDatabase()): ProjectionStore {
  const client = connected(database);
  if (!client) return createDisabledProjectionStore();

  const identities = createIdentityMethods(client);
  const projections = createProjectionMethods(client);
  const observations = createObservationMethods(client);
  const jobs = createJobMethods(client);
  const snapshots = createSnapshotMethods(client);
  const retention = createRetentionMethods(client);

  return {
    enabled: true,
    registerLeagueSeason: identities.registerLeagueSeason,
    upsertScoringEntities: identities.upsertScoringEntities,
    upsertNflGames: identities.upsertNflGames,
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
