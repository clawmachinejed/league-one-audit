import type { LeaguePeriod } from '../domain/contracts';

export type LogLevel = 'info' | 'warn' | 'error';
export type ProjectionLogOutcome = 'started' | 'completed' | 'skipped' | 'failed';

export type ProjectionFailureCode =
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
  | 'unexpected-worker-failure';

export type ProjectionLogEntry = Readonly<{
  stage: string;
  outcome: ProjectionLogOutcome;
  runId?: string;
  cadence?: string;
  leagueKey?: string;
  period?: LeaguePeriod;
  providerGroup?: string;
  modelVersion?: string;
  stageDurationMs?: number;
  totalDurationMs?: number;
  providerDurationMs?: number;
  providerOutcome?: 'available' | 'unavailable' | 'invalid';
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
