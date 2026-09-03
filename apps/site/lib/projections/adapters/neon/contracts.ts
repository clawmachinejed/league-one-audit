import type { MatchupsData } from '../../../types';
import type {
  FutureRefreshFailureCode as CanonicalFutureRefreshFailureCode,
} from '../../ports/future-refresh-repository';

export type FutureRefreshFailureCode = CanonicalFutureRefreshFailureCode;

export type SeasonType = 'pre' | 'reg' | 'post';
export type ScoringEntityKind = 'player' | 'team_defense';
export type ProjectionQuality = 'complete' | 'missing' | 'invalid';
export type ObservationQuality = 'complete' | 'partial' | 'invalid';

export type PersistenceOutcome<Value> =
  | Readonly<{ kind: 'stored'; value: Value }>
  | Readonly<{ kind: 'disabled' }>;

export type LeagueSeasonReference = Readonly<{
  leagueId: string;
  leagueSeasonId: string;
  scoringProfileId: string;
}>;

export type ExternalIdentity = Readonly<{
  provider: string;
  externalId: string;
}>;

export type ScoringEntityIdentityInput = Readonly<{
  key: string;
  kind: ScoringEntityKind;
  displayName: string;
  nflTeam: string | null;
  providerIds: readonly ExternalIdentity[];
}>;

export type ResolvedScoringEntity = Readonly<{
  key: string;
  entityId: string | null;
  conflict: boolean;
}>;

export type NflGameIdentityInput = Readonly<{
  key: string;
  provider: string;
  externalGameId: string;
  season: number;
  seasonType: SeasonType;
  week: number;
  homeTeam: string;
  awayTeam: string;
  kickoffAt: string | null;
}>;

export type ResolvedNflGame = Readonly<{
  key: string;
  gameId: string;
}>;

export type ProjectionCandidateInput = Readonly<{
  gameId: string;
  entityId: string;
  scoringProfileId: string;
  projectionPoints: number;
  projectedStats: Readonly<Record<string, unknown>>;
  quality: ProjectionQuality;
}>;

export type ProjectionSlateEntryInput = Readonly<{
  entityKind: ScoringEntityKind;
  providerExternalId: string;
  aliases: readonly ExternalIdentity[];
  nflTeam: string | null;
  position: string | null;
  stats: Readonly<Record<string, unknown>>;
  scoringStats: Readonly<Record<string, unknown>>;
  missingFields: readonly string[];
}>;

export type ProjectionSlateInput = Readonly<{
  provider: string;
  season: number;
  seasonType: SeasonType;
  week: number;
  normalizerVersion: string;
  sourceRevision: string;
  requestStartedAt: string;
  requestCompletedAt: string;
  observedAt: string;
  quality: ObservationQuality;
  coverage: Readonly<Record<string, unknown>>;
  warnings: readonly string[];
  entries: readonly ProjectionSlateEntryInput[];
}>;

export type ProjectionSlatePointerOutcome =
  | 'advanced'
  | 'verified'
  | 'superseded'
  | 'ineligible';

export type StoredProjectionSlateObservation = Readonly<{
  observationId: string;
  contentId: string;
  semanticHash: string;
  entriesStored: number;
  entryCount: number;
  pointerOutcome: ProjectionSlatePointerOutcome;
}>;

export type StoredProjectionSlate = Readonly<{
  observationId: string;
  contentId: string;
  provider: string;
  season: number;
  seasonType: SeasonType;
  week: number;
  normalizerVersion: string;
  semanticHash: string;
  sourceRevision: string;
  requestStartedAt: string;
  requestCompletedAt: string;
  observedAt: string;
  quality: ObservationQuality;
  coverage: Readonly<Record<string, unknown>>;
  warnings: readonly string[];
  entries: readonly ProjectionSlateEntryInput[];
  verifiedAt: string;
  materialChangedAt: string;
}>;

export type ProjectionRunInput = Readonly<{
  provider: string;
  season: number;
  seasonType: SeasonType;
  week: number;
  modelVersion: string;
  sourceRevision: string;
  requestStartedAt: string;
  requestCompletedAt: string;
  fetchedAt: string;
  quality: ObservationQuality;
  /** Exact provider observation used to create this scored run. */
  projectionSlateObservationId?: string;
  candidates: readonly ProjectionCandidateInput[];
}>;

export type StoredProjectionRun = Readonly<{
  runId: string;
  candidatesStored: number;
  candidateCount: number;
}>;

export type PlayerProjectionRecord = Readonly<{
  sleeperPlayerId: string;
  entityId: string;
  entityKind: ScoringEntityKind;
  displayName: string;
  nflTeam: string | null;
  gameId: string;
  tank01GameId: string | null;
  projectionPoints: number;
  projectedStats: Readonly<Record<string, unknown>>;
  quality: ProjectionQuality;
  sourceProjectionRunId: string;
  projectionProvider: string;
  modelVersion: string;
  fetchedAt: string;
  frozenAt: string | null;
}>;

export type GameStateInput = Readonly<{
  externalGameId: string;
  sourceRevision: string;
  requestStartedAt: string;
  requestCompletedAt: string;
  observedAt: string;
  statusCode: 0 | 1 | 2 | 3 | 4;
  period: string | null;
  gameClock: string | null;
  homeScore: number | null;
  awayScore: number | null;
  sourceData: Readonly<Record<string, unknown>>;
}>;

export type StoredGameState = Readonly<{
  externalGameId: string;
  sourceRevision: string;
  observationId: string;
}>;

export type OfficialPlayerPointInput = Readonly<{
  sleeperPlayerId: string;
  entityKind: ScoringEntityKind;
  externalRosterId: string;
  points: number | null;
  isStarter: boolean;
  lineupSlot: string | null;
}>;

export type OfficialRosterPointInput = Readonly<{
  externalRosterId: string;
  points: number | null;
}>;

export type LeagueWeekObservationInput = Readonly<{
  leagueSeasonId: string;
  week: number;
  sourceRevision: string;
  requestStartedAt: string;
  requestCompletedAt: string;
  observedAt: string;
  quality: ObservationQuality;
  sourceData: Readonly<Record<string, unknown>>;
  /** Complete Tank01 game-ID set expected for the league's scheduled starters. */
  expectedTank01GameIds: readonly string[];
  playerPoints: readonly OfficialPlayerPointInput[];
  rosterPoints: readonly OfficialRosterPointInput[];
}>;

export type StoredLeagueWeekObservation = Readonly<{
  observationId: string;
  playerPointsStored: number;
  rosterPointsStored: number;
  unmappedSleeperPlayerIds: readonly string[];
  expectedGamesStored: number;
  unmappedTank01GameIds: readonly string[];
}>;

export type ProjectionActivityWindow = Readonly<{
  /** Two hours before one full-slate kickoff. */
  startsAt: string;
  /** Seven hours after the same full-slate kickoff. */
  endsAt: string;
}>;

export type JobClaim =
  | Readonly<{ kind: 'acquired'; attempt: number; leaseUntil: string }>
  | Readonly<{ kind: 'busy' | 'completed' | 'disabled' }>;

export type StoredProjectionSnapshot = Readonly<{
  snapshotId: string;
  leagueSeasonId: string;
  week: number;
  modelVersion: string;
  revisionKey: string;
  calculatedAt: string;
  publishedAt: string | null;
  /** Latest successful source validation, even when material content did not change. */
  verifiedAt: string;
  /** Compact kickoff-derived refresh windows for every game in the NFL week. */
  activityWindows: readonly ProjectionActivityWindow[];
  isCurrent: boolean;
  payload: MatchupsData;
}>;

export type StoredProjectionSnapshotSelection = Readonly<{
  selected: StoredProjectionSnapshot | null;
  latest: StoredProjectionSnapshot | null;
}>;

export type LeagueLifecycle = 'preseason' | 'active' | 'complete';
export type NflPhase = 'preseason' | 'regular' | 'postseason' | 'unknown';

export type LeaguePeriodAuthorityInput = Readonly<{
  leagueKey: string;
  defaultSeason: number;
  defaultSeasonType: SeasonType;
  defaultWeek: number;
  activeSeason: number | null;
  activeSeasonType: SeasonType | null;
  activeWeek: number | null;
  leagueLifecycle: LeagueLifecycle;
  nflPhase: NflPhase;
  sourceProvider: string;
  sourceRevision: string;
  sourceObservedAt: string;
  verifiedAt: string;
}>;

export type StoredLeaguePeriodAuthority = LeaguePeriodAuthorityInput;

export type PeriodAuthorityWriteOutcome =
  | Readonly<{ kind: 'stored' | 'verified' | 'ignored'; value: StoredLeaguePeriodAuthority }>
  | Readonly<{ kind: 'conflict' }>
  | Readonly<{ kind: 'disabled' }>;

export type StoredFutureMaterializationFreshness = Readonly<{
  nextRefreshAt: string;
  lastSucceededAt: string | null;
  activeAttemptExpiresAt: string | null;
  lastProjectionSlateContentId: string | null;
  currentProjectionSlateContentId: string | null;
  lastSnapshotRevision: string | null;
}>;

export type StoredMatchupSnapshotContext = Readonly<{
  authority: StoredLeaguePeriodAuthority;
  snapshot: StoredProjectionSnapshot | null;
  futureRefresh: StoredFutureMaterializationFreshness | null;
}>;

export type StoreFutureRefreshPeriod = Readonly<{
  season: number;
  seasonType: SeasonType;
  week: number;
}>;

export type StoreFutureRefreshTarget = Readonly<{
  period: StoreFutureRefreshPeriod;
  weekDistance: number;
}>;

export type StoreFutureProjectionSlateLineage = Readonly<{
  observationId: string;
  contentId: string;
}>;

export type StoreFutureProjectionRefreshState = Readonly<{
  nextRefreshAt: string;
  lastAttemptedAt: string | null;
  lastSucceededAt: string | null;
  consecutiveFailures: number;
  lastFailureCode: FutureRefreshFailureCode | null;
  activeAttemptExpiresAt: string | null;
  lastSlate: StoreFutureProjectionSlateLineage | null;
  currentSlate: StoreFutureProjectionSlateLineage | null;
  due: boolean;
}>;

export type StoreFutureMaterializationRefreshState = Readonly<{
  leagueKey: string;
  nextRefreshAt: string;
  lastAttemptedAt: string | null;
  lastSucceededAt: string | null;
  lastSourceRevision: string | null;
  lastSlate: StoreFutureProjectionSlateLineage | null;
  lastSnapshotRevision: string | null;
  consecutiveFailures: number;
  lastFailureCode: FutureRefreshFailureCode | null;
  activeAttemptExpiresAt: string | null;
  due: boolean;
}>;

export type StoreFutureRefreshPlanPeriod = Readonly<{
  period: StoreFutureRefreshPeriod;
  weekDistance: number;
  projection: StoreFutureProjectionRefreshState;
  materializations: readonly StoreFutureMaterializationRefreshState[];
  successfulMaterializations: number;
  expectedMaterializations: number;
}>;

export type StoreFutureRefreshClaim =
  | Readonly<{
      kind: 'acquired';
      attempt: number;
      attemptId: string;
      leaseUntil: string;
    }>
  | Readonly<{
      kind: 'backed-off';
      consecutiveFailures: number;
      nextRefreshAt: string;
    }>
  | Readonly<{ kind: 'unavailable' | 'disabled' }>;

export type StoreFutureRefreshTransition =
  | Readonly<{
      kind: 'updated';
      consecutiveFailures: number;
      nextRefreshAt: string;
      materializationsWoken: number;
    }>
  | Readonly<{ kind: 'stale' | 'disabled' }>;

export type PublishSnapshotInput = Readonly<{
  leagueSeasonId: string;
  week: number;
  modelVersion: string;
  revisionKey: string;
  leagueWeekObservationId: string;
  gameStateObservationIds: readonly string[];
  calculatedAt: string;
  payload: MatchupsData;
  /** Full NFL slate, represented as kickoff - 2h through kickoff + 7h windows. */
  activityWindows: readonly ProjectionActivityWindow[];
  /** Maximum age difference among Sleeper and Tank01 observations. Defaults to 90 seconds. */
  maxSourceSkewSeconds?: number;
}>;

export type PublishSnapshotOutcome =
  | Readonly<{ kind: 'published'; snapshot: StoredProjectionSnapshot }>
  | Readonly<{ kind: 'unchanged'; snapshot: StoredProjectionSnapshot }>
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
  projectionSlateObservationsDeleted: number;
  projectionSlateContentsDeleted: number;
  jobsDeleted: number;
}>;

export type ProjectionStore = Readonly<{
  enabled: boolean;
  upsertLeaguePeriodAuthority: (
    input: LeaguePeriodAuthorityInput,
  ) => Promise<PeriodAuthorityWriteOutcome>;
  readMatchupSnapshotByLeagueKey: (
    leagueKey: string,
    requestedWeek?: number,
  ) => Promise<StoredMatchupSnapshotContext | null>;
  registerLeagueSeason: (input: Readonly<{
    leagueKey: string;
    leagueName: string;
    season: number;
    sleeperLeagueId: string;
    scoringRules: Readonly<Record<string, number>>;
  }>) => Promise<PersistenceOutcome<LeagueSeasonReference>>;
  upsertScoringEntities: (
    inputs: readonly ScoringEntityIdentityInput[],
  ) => Promise<PersistenceOutcome<readonly ResolvedScoringEntity[]>>;
  upsertNflGames: (
    inputs: readonly NflGameIdentityInput[],
  ) => Promise<PersistenceOutcome<readonly ResolvedNflGame[]>>;
  recordProjectionSlate: (
    input: ProjectionSlateInput,
  ) => Promise<PersistenceOutcome<StoredProjectionSlateObservation>>;
  readCurrentProjectionSlate: (input: Readonly<{
    provider: string;
    season: number;
    seasonType: SeasonType;
    week: number;
    normalizerVersion: string;
  }>) => Promise<StoredProjectionSlate | null>;
  ensureFutureRefreshStates: (input: Readonly<{
    projectionProvider: string;
    normalizerVersion: string;
    modelVersion: string;
    targets: readonly StoreFutureRefreshTarget[];
    leagueKeys: readonly string[];
    seededAt: string;
  }>) => Promise<PersistenceOutcome<Readonly<{
    projectionPeriodsInserted: number;
    materializationsInserted: number;
  }>>>;
  readFutureRefreshPlan: (input: Readonly<{
    projectionProvider: string;
    normalizerVersion: string;
    modelVersion: string;
    targets: readonly StoreFutureRefreshTarget[];
    leagueKeys: readonly string[];
    asOf: string;
  }>) => Promise<readonly StoreFutureRefreshPlanPeriod[]>;
  beginFutureProjectionRefresh: (input: Readonly<{
    projectionProvider: string;
    normalizerVersion: string;
    period: StoreFutureRefreshPeriod;
    attemptId: string;
    attemptedAt: string;
    leaseSeconds: number;
  }>) => Promise<StoreFutureRefreshClaim>;
  completeFutureProjectionRefresh: (input: Readonly<{
    projectionProvider: string;
    normalizerVersion: string;
    period: StoreFutureRefreshPeriod;
    attemptId: string;
    completedAt: string;
    nextRefreshAt: string;
    slate: StoreFutureProjectionSlateLineage;
  }>) => Promise<StoreFutureRefreshTransition>;
  failFutureProjectionRefresh: (input: Readonly<{
    projectionProvider: string;
    normalizerVersion: string;
    period: StoreFutureRefreshPeriod;
    attemptId: string;
    failedAt: string;
    failureCode: FutureRefreshFailureCode;
  }>) => Promise<StoreFutureRefreshTransition>;
  beginFutureMaterializationRefresh: (input: Readonly<{
    leagueKey: string;
    projectionProvider: string;
    normalizerVersion: string;
    modelVersion: string;
    period: StoreFutureRefreshPeriod;
    attemptId: string;
    attemptedAt: string;
    leaseSeconds: number;
  }>) => Promise<StoreFutureRefreshClaim>;
  completeFutureMaterializationRefresh: (input: Readonly<{
    leagueKey: string;
    projectionProvider: string;
    normalizerVersion: string;
    modelVersion: string;
    period: StoreFutureRefreshPeriod;
    attemptId: string;
    completedAt: string;
    nextRefreshAt: string;
    sourceRevision: string;
    slate: StoreFutureProjectionSlateLineage;
    snapshotRevision: string;
  }>) => Promise<StoreFutureRefreshTransition>;
  failFutureMaterializationRefresh: (input: Readonly<{
    leagueKey: string;
    projectionProvider: string;
    normalizerVersion: string;
    modelVersion: string;
    period: StoreFutureRefreshPeriod;
    attemptId: string;
    failedAt: string;
    failureCode: FutureRefreshFailureCode;
  }>) => Promise<StoreFutureRefreshTransition>;
  recordProjectionCandidates: (
    input: ProjectionRunInput,
  ) => Promise<PersistenceOutcome<StoredProjectionRun>>;
  readLatestCandidatesBySleeperIds: (input: Readonly<{
    leagueSeasonId: string;
    season: number;
    seasonType: SeasonType;
    week: number;
    provider: string;
    modelVersion: string;
    sleeperPlayerIds: readonly string[];
  }>) => Promise<readonly PlayerProjectionRecord[]>;
  freezeLatestBaselines: (input: Readonly<{
    leagueSeasonId: string;
    season: number;
    seasonType: SeasonType;
    week: number;
    modelVersion: string;
    projectionProvider: string;
    gameProvider: string;
    externalGameIds: readonly string[];
    frozenAt: string;
  }>) => Promise<PersistenceOutcome<readonly PlayerProjectionRecord[]>>;
  readFrozenBaselinesBySleeperIds: (input: Readonly<{
    leagueSeasonId: string;
    season: number;
    seasonType: SeasonType;
    week: number;
    provider: string;
    modelVersion: string;
    sleeperPlayerIds: readonly string[];
  }>) => Promise<readonly PlayerProjectionRecord[]>;
  recordGameStates: (input: Readonly<{
    provider: string;
    states: readonly GameStateInput[];
  }>) => Promise<PersistenceOutcome<readonly StoredGameState[]>>;
  recordLeagueWeekObservation: (
    input: LeagueWeekObservationInput,
  ) => Promise<PersistenceOutcome<StoredLeagueWeekObservation>>;
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
    /** Always retains at least one recent snapshot for each league/week/model. */
    keepRecentSnapshotsPerLeagueWeek?: number;
  }>) => Promise<PersistenceOutcome<HistoryRetentionResult>>;
  readCurrentSnapshot: (
    leagueSeasonId: string,
    week: number,
  ) => Promise<StoredProjectionSnapshot | null>;
  readSnapshotSelectionBySleeperLeagueId: (
    sleeperLeagueId: string,
    requestedWeek?: number,
  ) => Promise<StoredProjectionSnapshotSelection>;
}>;
