import type { LeaguePeriod } from '../domain/contracts';
import type { LineupMaterializationTarget } from '../domain/lineup-publication';
import type { ProviderKey } from '../shared/provider-identity';
import type { RepositoryId, RepositoryOutcome } from './projection-repository';

export type FutureRefreshAttemptId = RepositoryId<'future-refresh-attempt'>;
export type FutureProjectionSlateContentId = RepositoryId<'projection-slate-content'>;
export type FutureProjectionSlateObservationId = RepositoryId<'projection-slate-observation'>;

/** Stable operational classifications only; raw provider or database errors are never persisted. */
export type FutureRefreshFailureCode =
  | 'provider-unavailable'
  | 'projection-slate-incomplete'
  | 'projection-slate-invalid'
  | 'projection-slate-persistence-failed'
  | 'projection-slate-unavailable'
  | 'game-state-unavailable'
  | 'game-state-incomplete'
  | 'league-source-unavailable'
  | 'league-period-mismatch'
  | 'lineup-not-ready'
  | 'identity-conflict'
  | 'scoring-failed'
  | 'baseline-freeze-incomplete'
  | 'official-observation-incomplete'
  | 'snapshot-rejected'
  | 'snapshot-publication-failed'
  | 'deadline-exceeded'
  | 'unexpected';

export type FutureProjectionSlateLineage = Readonly<{
  observationId: FutureProjectionSlateObservationId;
  contentId: FutureProjectionSlateContentId;
}>;

export type FutureRefreshTarget = Readonly<{
  period: LeaguePeriod;
  weekDistance: number;
  projectionWeekDistance?: number;
}>;

export type FutureProjectionRefreshState = Readonly<{
  nextRefreshAt: string;
  lastAttemptedAt: string | null;
  lastSucceededAt: string | null;
  consecutiveFailures: number;
  lastFailureCode: FutureRefreshFailureCode | null;
  activeAttemptExpiresAt: string | null;
  lastSlate: FutureProjectionSlateLineage | null;
  currentSlate: FutureProjectionSlateLineage | null;
  due: boolean;
}>;

export type FutureMaterializationRefreshState = Readonly<{
  leagueKey: string;
  nextRefreshAt: string;
  lastAttemptedAt: string | null;
  lastSucceededAt: string | null;
  lastSourceRevision: string | null;
  lastSlate: FutureProjectionSlateLineage | null;
  lastSnapshotRevision: string | null;
  consecutiveFailures: number;
  lastFailureCode: FutureRefreshFailureCode | null;
  activeAttemptExpiresAt: string | null;
  due: boolean;
}>;

export type FutureRefreshPlanPeriod = Readonly<{
  period: LeaguePeriod;
  weekDistance: number;
  projection: FutureProjectionRefreshState;
  materializations: readonly FutureMaterializationRefreshState[];
  successfulMaterializations: number;
  expectedMaterializations: number;
}>;

export type FutureRefreshClaim =
  | Readonly<{
      kind: 'acquired';
      attempt: number;
      attemptId: FutureRefreshAttemptId;
      leaseUntil: string;
    }>
  | Readonly<{
      kind: 'backed-off';
      consecutiveFailures: number;
      nextRefreshAt: string;
    }>
  | Readonly<{ kind: 'unavailable' | 'disabled' }>;

export type FutureRefreshTransition =
  | Readonly<{
      kind: 'updated';
      consecutiveFailures: number;
      nextRefreshAt: string;
      materializationsWoken: number;
    }>
  | Readonly<{ kind: 'stale' | 'disabled' }>;

export type FutureRefreshRepositoryPort = Readonly<{
  ensureFutureRefreshStates: (input: Readonly<{
    projectionSource: ProviderKey;
    normalizerVersion: string;
    modelVersion: string;
    targets: readonly FutureRefreshTarget[];
    leagueKeys: readonly string[];
    seededAt: string;
  }>) => Promise<RepositoryOutcome<Readonly<{
    projectionPeriodsInserted: number;
    materializationsInserted: number;
  }>>>;
  readFutureRefreshPlan: (input: Readonly<{
    projectionSource: ProviderKey;
    normalizerVersion: string;
    modelVersion: string;
    targets: readonly FutureRefreshTarget[];
    leagueKeys: readonly string[];
    asOf: string;
  }>) => Promise<readonly FutureRefreshPlanPeriod[]>;
  beginFutureProjectionRefresh: (input: Readonly<{
    projectionSource: ProviderKey;
    normalizerVersion: string;
    period: LeaguePeriod;
    attemptId: FutureRefreshAttemptId;
    attemptedAt: string;
    leaseSeconds: number;
    force?: true;
  }>) => Promise<FutureRefreshClaim>;
  completeFutureProjectionRefresh: (input: Readonly<{
    projectionSource: ProviderKey;
    normalizerVersion: string;
    period: LeaguePeriod;
    attemptId: FutureRefreshAttemptId;
    completedAt: string;
    nextRefreshAt: string;
    slate: FutureProjectionSlateLineage;
  }>) => Promise<FutureRefreshTransition>;
  failFutureProjectionRefresh: (input: Readonly<{
    projectionSource: ProviderKey;
    normalizerVersion: string;
    period: LeaguePeriod;
    attemptId: FutureRefreshAttemptId;
    failedAt: string;
    failureCode: FutureRefreshFailureCode;
  }>) => Promise<FutureRefreshTransition>;
  beginFutureMaterializationRefresh: (input: Readonly<{
    leagueKey: string;
    projectionSource: ProviderKey;
    normalizerVersion: string;
    modelVersion: string;
    period: LeaguePeriod;
    attemptId: FutureRefreshAttemptId;
    attemptedAt: string;
    leaseSeconds: number;
    target: LineupMaterializationTarget;
    force?: true;
  }>) => Promise<FutureRefreshClaim>;
  failFutureMaterializationRefresh: (input: Readonly<{
    leagueKey: string;
    projectionSource: ProviderKey;
    normalizerVersion: string;
    modelVersion: string;
    period: LeaguePeriod;
    attemptId: FutureRefreshAttemptId;
    failedAt: string;
    failureCode: FutureRefreshFailureCode;
  }>) => Promise<FutureRefreshTransition>;
}>;
