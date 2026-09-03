import type {
  Cadence,
  CanonicalScoringProfile,
  GameStateSlate,
  LeagueConfiguration,
  LeaguePeriod,
  LeagueWeekState,
  OccupiedLineupSlot,
  ProjectionSlate,
  SourceScoringSettings,
} from '../domain/contracts';
import type { ClockPort } from '../ports/clock';
import type { GameStateFeedPort } from '../ports/game-state-feed';
import type { IdGeneratorPort } from '../ports/id-generator';
import type { IdentityCrosswalkPort, NflGameId, ScoringEntityId } from '../ports/identity-crosswalk';
import type { LeagueRegistryPort } from '../ports/league-registry';
import type { LeagueSourcePort } from '../ports/league-source';
import type { ProjectionLogEntry, ProjectionLoggerPort } from '../ports/logger';
import type { NflCalendarPort } from '../ports/nfl-calendar';
import type { ProjectionFeedPort } from '../ports/projection-feed';
import type { FutureRefreshRepositoryPort } from '../ports/future-refresh-repository';
import type {
  ObservationId,
  ProjectionRepositoryPort,
  ProjectionSlateContentId,
  ProjectionSlateObservationId,
} from '../ports/projection-repository';
import type { ExternalRosterRef, ExternalScoringEntityRef } from '../shared/provider-identity';
export { LIVE_PROJECTION_MODEL_VERSION } from '../shared/projection-versions';

/** Public worker configuration is the provider-neutral league registry entry. */
export type ProjectionLeagueConfiguration = LeagueConfiguration;

export type ScoringProfileNormalization =
  | Readonly<{ status: 'available'; profile: CanonicalScoringProfile }>
  | Readonly<{
      status: 'unavailable';
      reason: 'missing' | 'invalid';
      invalidSourceKeys: readonly string[];
    }>;

export type LiveProjectionWorkerDependencies = Readonly<{
  repository: ProjectionRepositoryPort & FutureRefreshRepositoryPort;
  identityCrosswalk: IdentityCrosswalkPort;
  futurePersistence: Readonly<{
    scope: (signal: AbortSignal) => Readonly<{
      repository: ProjectionRepositoryPort & FutureRefreshRepositoryPort;
      identityCrosswalk: IdentityCrosswalkPort;
    }>;
  }>;
  leagueRegistry: LeagueRegistryPort;
  nflCalendar: NflCalendarPort;
  leagueSource: LeagueSourcePort;
  projectionFeed: ProjectionFeedPort;
  gameStateFeed: GameStateFeedPort;
  projectionStorage: Readonly<{
    source: ProjectionSlate['source'];
    normalizerVersion: string;
  }>;
  normalizeScoringProfile: (source: SourceScoringSettings) => ScoringProfileNormalization;
  clock: ClockPort;
  idGenerator: IdGeneratorPort;
  logger: ProjectionLoggerPort;
}>;

export type LiveProjectionSyncResult =
  | Readonly<{ status: 'disabled' }>
  | Readonly<{ status: 'skipped'; reason: 'busy' | 'completed' | 'idle'; cadence: Cadence | null }>
  | Readonly<{
      status: 'completed';
      cadence: Cadence;
      publishedLeagues: number;
      failedLeagues: number;
      providerGroups: number;
    }>
  | Readonly<{ status: 'failed' }>;

export type LoadedLeague = Readonly<{
  configuration: ProjectionLeagueConfiguration;
  source: LeagueWeekState;
  cadence: Cadence;
}>;

export type ProviderGroup = Readonly<{
  period: LeaguePeriod;
  leagues: readonly LoadedLeague[];
}>;

export type ActiveStarter = Readonly<{
  rosterRef: ExternalRosterRef;
  starter: OccupiedLineupSlot;
}>;

export type PregameProjectionPoint = Readonly<{
  entityRef: ExternalScoringEntityRef;
  points: number;
  quality: 'complete' | 'missing';
}>;

export type PregameProjectionSet = Readonly<{
  status: 'available' | 'unavailable' | 'empty';
  projections: readonly PregameProjectionPoint[];
  warning?: string;
}>;

export type PersistedGroup = Readonly<{
  games: GameStateSlate;
  projections: ProjectionSlate;
  gameIdsByReferenceKey: ReadonlyMap<string, NflGameId>;
  gameObservationIdsByReferenceKey: ReadonlyMap<string, ObservationId>;
  entityIdsByReferenceKey: ReadonlyMap<string, ScoringEntityId>;
  identityConflictCount: number;
  projectionSourceRevision: string;
  projectionSlateObservationId: ProjectionSlateObservationId;
  projectionSlateContentId: ProjectionSlateContentId;
}>;

export type LeagueStageResult = Readonly<{
  publicationOutcome: 'published' | 'unchanged';
  starterCount: number;
  candidateCount: number;
  frozenBaselineCount: number;
  missingBaselineCount: number;
  applicableSourceSkewSeconds: number | null;
  snapshotRevision: string;
}>;

export type ProjectionLogContext = ProjectionLogEntry;
