import type { MatchupsData } from '../../../types';

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
  jobsDeleted: number;
}>;

export type ProjectionStore = Readonly<{
  enabled: boolean;
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
