import type { ClockPort } from '../ports/clock';
import type { IdGeneratorPort } from '../ports/id-generator';
import type { LeagueRegistryPort } from '../ports/league-registry';
import type { LineupSourcePort } from '../ports/lineup-source';
import type { LineupWatchRepositoryPort } from '../ports/lineup-watch-repository';
import type { ProjectionLoggerPort } from '../ports/logger';
import type { PeriodAuthorityReaderPort } from '../ports/period-authority-reader';
import type { ProjectionRepositoryPort } from '../ports/projection-repository';

export type LineupJobRepository = Pick<ProjectionRepositoryPort, 'acquireJob' | 'completeJob' | 'failJob'>;
export type LineupObservationRepository = Pick<LineupWatchRepositoryPort,
  'enabled' | 'synchronizeLineupWatchStates' | 'claimDueLineupObservations' | 'completeLineupObservation'
  | 'recordLineupObservationNotReady' | 'failLineupObservation' | 'wakeFutureProjectionAndMaterialization'
  | 'readPendingFutureLineups' | 'readLineupWatchSchedule'>;
export type LineupObservationScope = Readonly<{
  repository: LineupJobRepository;
  lineupRepository: LineupObservationRepository;
  periodAuthorityReader: PeriodAuthorityReaderPort;
}>;
export type LineupObservationWorkerDependencies = LineupObservationScope & Readonly<{
  leagueRegistry: LeagueRegistryPort;
  lineupSource: LineupSourcePort;
  clock: ClockPort;
  idGenerator: IdGeneratorPort;
  logger: ProjectionLoggerPort;
  persistence: Readonly<{ scope(signal: AbortSignal): LineupObservationScope }>;
}>;
export type LineupObservationCounts = {
  checked: number; changed: number; unchanged: number; notReady: number; skipped: number; failed: number; pending: number;
};
export type LineupObservationSyncResult =
  | Readonly<{ status: 'unavailable' }>
  | Readonly<{ status: 'skipped'; reason: 'idle' | 'busy' }>
  | Readonly<{ status: 'completed' | 'partial' } & LineupObservationCounts>
  | Readonly<{ status: 'failed' }>;

export function emptyLineupObservationCounts(): LineupObservationCounts {
  return { checked: 0, changed: 0, unchanged: 0, notReady: 0, skipped: 0, failed: 0, pending: 0 };
}
