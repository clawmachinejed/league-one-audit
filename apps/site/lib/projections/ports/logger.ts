import type { LeaguePeriod } from '../domain/contracts';
import type { FutureRefreshFailureCode } from './future-refresh-repository';

export type LogLevel = 'info' | 'warn' | 'error';
export type ProjectionLogOutcome = 'started' | 'completed' | 'skipped' | 'failed';

export type ProjectionFailureCode =
  | FutureRefreshFailureCode
  | 'cadence-source-unavailable'
  | 'lease-lost'
  | 'projection-slate-incomplete'
  | 'game-coverage-incomplete'
  | 'source-skew-exceeded'
  | 'identity-conflict'
  | 'baseline-freeze-incomplete'
  | 'official-observation-incomplete'
  | 'snapshot-rejected'
  | 'league-source-unavailable'
  | 'projection-provider-unavailable'
  | 'provider-persistence-failed'
  | 'period-authority-conflict'
  | 'period-authority-unavailable'
  | 'unexpected-worker-failure'
  | 'authority-missing' | 'authority-stale' | 'authority-provider-mismatch'
  | 'lineup-source-unavailable' | 'lineup-response-invalid' | 'lineup-not-ready' | 'lineup-shape-unavailable'
  | 'claim-superseded' | 'claim-stale' | 'capacity-exceeded' | 'snapshot-publication-failed'
  | 'current-projection-failed';

export type ProjectionLogEntry = Readonly<{
  stage: string;
  lane?: 'current' | 'future' | 'lineup-observation';
  cadencePolicyVersion?: string;
  lineupRevisionVersion?: string;
  watchClass?: 'current' | 'future' | 'completed';
  phase?: number;
  batchSize?: number;
  attemptGeneration?: number;
  checked?: number;
  changed?: number;
  unchanged?: number;
  notReady?: number;
  pending?: number;
  skipped?: number;
  failed?: number;
  providerAdapterInvocations?: number;
  upstreamRequests?: number | null;
  cacheHits?: number | null;
  cacheMisses?: number | null;
  fetchInvocations?: number;
  requestMetric?: 'adapter' | 'cache' | 'http';
  provider?: string;
  endpointFamily?: string;
  cacheStatus?: 'hit' | 'miss' | 'bypass' | 'framework-managed';
  authorityAgeMs?: number;
  backlogAgeMs?: number;
  capacityStatus?: 'supported' | 'capacity-exceeded';
  outcome: ProjectionLogOutcome;
  runId?: string;
  cadence?: string;
  futureAction?: 'projection-ingest' | 'materialize';
  weekDistance?: number;
  leagueKey?: string;
  period?: LeaguePeriod;
  providerGroup?: string;
  modelVersion?: string;
  stageDurationMs?: number;
  totalDurationMs?: number;
  providerDurationMs?: number;
  providerOutcome?: 'available' | 'unavailable' | 'invalid' | 'not-ready';
  projectionRows?: number;
  matchedProjectionRows?: number;
  gameCount?: number;
  applicableSourceSkewSeconds?: number;
  loadedLeagues?: number;
  eligibleLeagues?: number;
  publishedLeagues?: number;
  unchangedLeagues?: number;
  skippedLeagues?: number;
  failedLeagues?: number;
  starterCount?: number;
  candidateCount?: number;
  frozenBaselineCount?: number;
  missingBaselineCount?: number;
  identityConflictCount?: number;
  snapshotRevision?: string;
  publicationOutcome?: 'published' | 'unchanged' | 'rejected' | 'disabled';
  leaseOutcome?: 'acquired' | 'busy' | 'completed' | 'disabled' | 'lost';
  failureCode?: ProjectionFailureCode;
}>;

export type ProjectionLoggerPort = Readonly<{
  write: (level: LogLevel, entry: ProjectionLogEntry) => void;
}>;
