import type {
  ExternalGameRef,
  ExternalLeagueRef,
  ExternalRosterRef,
  ExternalScoringEntityRef,
  ProviderKey,
} from '../shared/provider-identity';
import type { NflGameId, ScoringEntityId } from './identity-crosswalk';
import type {
  GameStateObservation,
  LeagueConfiguration,
  LeaguePeriod,
  NflTeam,
  ProjectionStats,
  CanonicalScoringProfile,
} from '../domain/contracts';
import type { MatchupsData } from '../../types';

declare const repositoryIdBrand: unique symbol;

export type RepositoryId<Resource extends string> = string & Readonly<{
  [repositoryIdBrand]: Resource;
}>;

export type LeagueSeasonId = RepositoryId<'league-season'>;
export type ScoringProfileId = RepositoryId<'scoring-profile'>;
export type ObservationId = RepositoryId<'observation'>;
export type ProjectionRunId = RepositoryId<'projection-run'>;

export type RepositoryOutcome<Value> =
  | Readonly<{ kind: 'stored'; value: Value }>
  | Readonly<{ kind: 'disabled' }>;

export type LeagueSeasonReference = Readonly<{
  leagueSeasonId: LeagueSeasonId;
  scoringProfileId: ScoringProfileId;
  leagueRef: ExternalLeagueRef;
}>;

export type ProjectionCandidateInput = Readonly<{
  gameId: NflGameId;
  entityId: ScoringEntityId;
  scoringProfileId: ScoringProfileId;
  projectionPoints: number;
  projectedStats: ProjectionStats | Readonly<Record<string, unknown>>;
  quality: 'complete' | 'missing' | 'invalid';
}>;

export type ProjectionRunInput = Readonly<{
  source: ProviderKey;
  period: LeaguePeriod;
  modelVersion: string;
  sourceRevision: string;
  requestStartedAt: string;
  requestCompletedAt: string;
  observedAt: string;
  quality: 'complete' | 'partial' | 'invalid';
  candidates: readonly ProjectionCandidateInput[];
}>;

export type StoredProjectionRun = Readonly<{
  runId: ProjectionRunId;
  candidatesStored: number;
  candidateCount: number;
}>;

export type ProjectionBaselineRecord = Readonly<{
  officialEntityRef: ExternalScoringEntityRef;
  entityId: ScoringEntityId;
  entityKind: 'player' | 'team-defense';
  displayName: string;
  nflTeam: NflTeam | null;
  gameId: NflGameId;
  projectionGameRef: ExternalGameRef | null;
  projectionPoints: number;
  projectedStats: Readonly<Record<string, unknown>>;
  quality: 'complete' | 'missing' | 'invalid';
  sourceProjectionRunId: ProjectionRunId;
  projectionSource: ProviderKey;
  modelVersion: string;
  observedAt: string;
  frozenAt: string | null;
}>;

export type StoredGameState = Readonly<{
  gameRef: ExternalGameRef;
  sourceRevision: string;
  observationId: ObservationId;
}>;

export type OfficialEntityPointInput = Readonly<{
  entityRef: ExternalScoringEntityRef;
  rosterRef: ExternalRosterRef;
  points: number | null;
  isStarter: boolean;
  lineupSlot: string | null;
}>;

export type OfficialRosterPointInput = Readonly<{
  rosterRef: ExternalRosterRef;
  points: number | null;
}>;

export type LeagueWeekObservationInput = Readonly<{
  leagueSeasonId: LeagueSeasonId;
  period: LeaguePeriod;
  sourceRevision: string;
  requestStartedAt: string;
  requestCompletedAt: string;
  observedAt: string;
  quality: 'complete' | 'partial' | 'invalid';
  sourceData: Readonly<Record<string, unknown>>;
  expectedGameRefs: readonly ExternalGameRef[];
  entityPoints: readonly OfficialEntityPointInput[];
  rosterPoints: readonly OfficialRosterPointInput[];
}>;

export type StoredLeagueWeekObservation = Readonly<{
  observationId: ObservationId;
  entityPointsStored: number;
  rosterPointsStored: number;
  unmappedEntityRefs: readonly ExternalScoringEntityRef[];
  expectedGamesStored: number;
  unmappedGameRefs: readonly ExternalGameRef[];
}>;

export type ProjectionActivityWindow = Readonly<{
  startsAt: string;
  endsAt: string;
}>;

export type JobClaim =
  | Readonly<{ kind: 'acquired'; attempt: number; leaseUntil: string }>
  | Readonly<{ kind: 'busy' | 'completed' | 'disabled' }>;

export type StoredProjectionSnapshot = Readonly<{
  snapshotId: RepositoryId<'projection-snapshot'>;
  leagueSeasonId: LeagueSeasonId;
  period: LeaguePeriod;
  modelVersion: string;
  revisionKey: string;
  calculatedAt: string;
  publishedAt: string | null;
  verifiedAt: string;
  activityWindows: readonly ProjectionActivityWindow[];
  isCurrent: boolean;
  payload: MatchupsData;
}>;

export type StoredProjectionSnapshotSelection = Readonly<{
  selected: StoredProjectionSnapshot | null;
  latest: StoredProjectionSnapshot | null;
}>;

export type PublishSnapshotInput = Readonly<{
  leagueSeasonId: LeagueSeasonId;
  period: LeaguePeriod;
  modelVersion: string;
  revisionKey: string;
  leagueWeekObservationId: ObservationId;
  gameStateObservationIds: readonly ObservationId[];
  calculatedAt: string;
  payload: MatchupsData;
  activityWindows: readonly ProjectionActivityWindow[];
  maxSourceSkewSeconds?: number;
}>;

export type PublishSnapshotOutcome =
  | Readonly<{ kind: 'published' | 'unchanged'; snapshot: StoredProjectionSnapshot }>
  | Readonly<{
      kind: 'rejected';
      reason: 'incomplete-or-mismatched-sources' | 'payload-context-mismatch';
    }>
  | Readonly<{ kind: 'disabled' }>;

export type HistoryRetentionResult = Readonly<{
  snapshotsDeleted: number;
  leagueObservationsDeleted: number;
  gameObservationsDeleted: number;
  projectionRunsDeleted: number;
  jobsDeleted: number;
}>;

export type ProjectionRepositoryPort = Readonly<{
  enabled: boolean;
  registerLeagueSeason: (input: Readonly<{
    configuration: LeagueConfiguration;
    leagueName: string;
    period: LeaguePeriod;
    scoringProfile: CanonicalScoringProfile;
  }>) => Promise<RepositoryOutcome<LeagueSeasonReference>>;
  recordProjectionCandidates: (
    input: ProjectionRunInput,
  ) => Promise<RepositoryOutcome<StoredProjectionRun>>;
  readLatestCandidates: (input: Readonly<{
    leagueSeasonId: LeagueSeasonId;
    period: LeaguePeriod;
    source: ProviderKey;
    modelVersion: string;
    officialEntityRefs: readonly ExternalScoringEntityRef[];
  }>) => Promise<readonly ProjectionBaselineRecord[]>;
  freezeLatestBaselines: (input: Readonly<{
    leagueSeasonId: LeagueSeasonId;
    period: LeaguePeriod;
    modelVersion: string;
    projectionSource: ProviderKey;
    gameStateSource: ProviderKey;
    gameRefs: readonly ExternalGameRef[];
    frozenAt: string;
  }>) => Promise<RepositoryOutcome<readonly ProjectionBaselineRecord[]>>;
  readFrozenBaselines: (input: Readonly<{
    leagueSeasonId: LeagueSeasonId;
    period: LeaguePeriod;
    source: ProviderKey;
    modelVersion: string;
    officialEntityRefs: readonly ExternalScoringEntityRef[];
  }>) => Promise<readonly ProjectionBaselineRecord[]>;
  recordGameStates: (input: Readonly<{
    source: ProviderKey;
    states: readonly GameStateObservation[];
  }>) => Promise<RepositoryOutcome<readonly StoredGameState[]>>;
  recordLeagueWeekObservation: (
    input: LeagueWeekObservationInput,
  ) => Promise<RepositoryOutcome<StoredLeagueWeekObservation>>;
  acquireJob: (input: Readonly<{
    jobKey: string;
    jobType: string;
    scheduledFor: string;
    payload: Readonly<Record<string, unknown>>;
    workerId: string;
    leaseSeconds: number;
  }>) => Promise<JobClaim>;
  completeJob: (jobKey: string, workerId: string) => Promise<boolean>;
  failJob: (jobKey: string, workerId: string, message: string) => Promise<boolean>;
  publishSnapshot: (input: PublishSnapshotInput) => Promise<PublishSnapshotOutcome>;
  pruneHistory: (input: Readonly<{
    before: string;
    keepRecentSnapshotsPerLeagueWeek?: number;
  }>) => Promise<RepositoryOutcome<HistoryRetentionResult>>;
  readCurrentSnapshot: (
    leagueSeasonId: LeagueSeasonId,
    period: LeaguePeriod,
  ) => Promise<StoredProjectionSnapshot | null>;
  readSnapshotSelection: (
    leagueRef: ExternalLeagueRef,
    requestedWeek?: number,
  ) => Promise<StoredProjectionSnapshotSelection>;
}>;
