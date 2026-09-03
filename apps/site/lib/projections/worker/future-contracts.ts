import type { LeaguePeriod, ProjectionSlate, SourceScoringSettings } from '../domain/contracts';
import type { ClockPort } from '../ports/clock';
import type { FutureRefreshFailureCode, FutureRefreshRepositoryPort } from '../ports/future-refresh-repository';
import type { GameStateFeedPort } from '../ports/game-state-feed';
import type { IdGeneratorPort } from '../ports/id-generator';
import type { IdentityCrosswalkPort } from '../ports/identity-crosswalk';
import type { LeagueRegistryPort } from '../ports/league-registry';
import type { LeagueSourcePort } from '../ports/league-source';
import type { LineupWatchRepositoryPort } from '../ports/lineup-watch-repository';
import type { ProjectionLoggerPort } from '../ports/logger';
import type { PeriodAuthorityReaderPort } from '../ports/period-authority-reader';
import type { ProjectionFeedPort } from '../ports/projection-feed';
import type { ProjectionRepositoryPort } from '../ports/projection-repository';
import type { ScoringProfileNormalization } from './contracts';

export type FuturePersistence = Readonly<{
  repository: ProjectionRepositoryPort & FutureRefreshRepositoryPort;
  identityCrosswalk: IdentityCrosswalkPort;
  lineupRepository: LineupWatchRepositoryPort;
  periodAuthorityReader: PeriodAuthorityReaderPort;
}>;

/** Future work reads persisted authority; it cannot fetch or write the NFL calendar. */
export type FutureProjectionWorkerDependencies = FuturePersistence & Readonly<{
  futurePersistence: Readonly<{ scope: (signal: AbortSignal) => FuturePersistence }>;
  leagueRegistry: LeagueRegistryPort;
  leagueSource: LeagueSourcePort;
  projectionFeed: ProjectionFeedPort;
  gameStateFeed: GameStateFeedPort;
  projectionStorage: Readonly<{ source: ProjectionSlate['source']; normalizerVersion: string }>;
  normalizeScoringProfile: (source: SourceScoringSettings) => ScoringProfileNormalization;
  clock: ClockPort;
  idGenerator: IdGeneratorPort;
  logger: ProjectionLoggerPort;
}>;

export type FutureProjectionSyncResult =
  | Readonly<{ status: 'disabled' }>
  | Readonly<{ status: 'failed' }>
  | Readonly<{ status: 'skipped'; reason: 'idle' | 'busy' | 'deadline' }>
  | Readonly<{
      status: 'completed';
      action: 'projection-ingest' | 'materialize';
      period: LeaguePeriod;
      publishedLeagues: number;
      unchangedLeagues: number;
      failedLeagues: number;
    }>;

/** Only the existing authenticated current-worker force path supplies this handoff. */
export type ForcedFuturePeriod = Readonly<{
  period: LeaguePeriod;
  leagueKeys: readonly string[];
  execution?: Readonly<{
    now: Date;
    runId: string;
    timing: Readonly<{ wallStartedAtMs: number; monotonicStartedAt: number }>;
  }>;
}>;

export type FutureMaterializationStageResult =
  | Readonly<{
      status: 'completed';
      publishedLeagues: number;
      unchangedLeagues: number;
      failedLeagues: number;
      providerGroups: 1;
    }>
  | Readonly<{ status: 'skipped' }>
  | Readonly<{
      status: 'failed';
      failureCode: FutureRefreshFailureCode;
      failedLeagues: number;
    }>;

