import type { LeagueConfiguration, LeaguePeriod } from '../domain/contracts';
import type { LineupShape } from '../domain/lineup-observation';
import type { LineupRevision } from '../domain/lineup-revision';
import type { FutureProjectionSlateLineage, FutureRefreshAttemptId, FutureRefreshTransition } from './future-refresh-repository';
import type { ProviderKey, ExternalLeagueRef } from '../shared/provider-identity';
import type { LineupMaterializationTarget, LineupPublicationFence } from '../domain/lineup-publication';
export type { LineupMaterializationTarget, LineupPublicationFence } from '../domain/lineup-publication';

export type LineupMaterializationLane = 'current' | 'future';
export type LineupWatchClass = 'current' | 'future' | 'completed';
export type LineupWatchTarget = Readonly<{
  configuration: LeagueConfiguration;
  period: LeaguePeriod;
  shape: LineupShape;
  authorityGeneration: number;
  lineupRevisionVersion: 'lineup-v1';
  cadencePolicyVersion: string;
  watchClass: LineupWatchClass;
  materializationLane: LineupMaterializationLane | null;
  phase: 0 | 1 | 2;
  initialNextCheckAt: string | null;
}>;

export type LineupWatchState = Omit<LineupWatchTarget, 'initialNextCheckAt'> & Readonly<{
  /** These are internal repository identities, not provider identifiers. */
  watchId: string;
  watchGeneration: number;
  nextCheckAt: string | null;
  observedVersion: number;
  latestLineupRevision: string | null;
  acceptedRequestStartedAt: string | null;
  acceptedRequestCompletedAt: string | null;
  lastCheckedAt: string | null;
  lastCompleteObservationAt: string | null;
  lastMaterializedLineupRevision: string | null;
  lastMaterializedSnapshotRevision: string | null;
  lastMaterializedVerifiedAt: string | null;
  pendingSince: string | null;
  activeAttemptId: string | null;
  claimGeneration: number;
  leaseOwner: string | null;
  attemptStartedAt: string | null;
  leaseExpiresAt: string | null;
  attemptCount: number;
  consecutiveFailures: number;
  lastFailureCode: string | null;
  retiredAt: string | null;
  retirementReason: string | null;
}>;

export type LineupWatchFence = Readonly<{
  watchId: string;
  watchGeneration: number;
  authorityGeneration: number;
  watchClass: Exclude<LineupWatchClass, 'completed'>;
  materializationLane: LineupMaterializationLane;
}>;
export type LineupObservationClaim = LineupWatchFence & Readonly<{
  attemptId: string;
  claimGeneration: number;
  workerId: string;
  targetObservedVersion: number;
}>;
export type LineupWatchTransition = Readonly<{ kind: 'stored' | 'stale' | 'disabled' }>;
export type LineupObservationWriteOutcome =
  | Readonly<{ kind: 'stored'; state: LineupWatchState }>
  | Readonly<{ kind: 'stale' | 'disabled' }>;

export type LineupWatchRepositoryPort = Readonly<{
  readLineupWatchSchedule(leagueKeys: readonly string[]): Promise<readonly LineupWatchScheduleEntry[]>;
  enabled: boolean;
  synchronizeLineupWatchStates(input: Readonly<{
    registeredLeagueKeys: readonly string[];
    targets: readonly LineupWatchTarget[];
  }>): Promise<Readonly<{ kind: 'stored'; states: readonly LineupWatchState[] }> | Readonly<{ kind: 'disabled' }>>;
  claimDueLineupObservations(input: Readonly<{
    leagueKeys: readonly string[];
    materializationLane: LineupMaterializationLane;
    workerId: string;
    leaseSeconds: number;
    limit: number;
    futureLimit: number;
    catchUp: boolean;
  }>): Promise<readonly LineupWatchState[]>;
  reserveFullLineupObservation(input: Readonly<{
    fence: LineupPublicationFence;
    modelVersion: string;
    leaseSeconds: number;
  }>): Promise<LineupObservationWriteOutcome>;
  completeLineupObservation(input: Readonly<{
    claim: LineupObservationClaim;
    actualLineup: LineupRevision;
    requestStartedAt: string;
    requestCompletedAt: string;
    nextCheckAt: string;
  }>): Promise<LineupObservationWriteOutcome>;
  recordLineupObservationNotReady(input: Readonly<{
    claim: LineupObservationClaim; checkedAt: string; nextCheckAt: string;
  }>): Promise<LineupWatchTransition>;
  failLineupObservation(input: Readonly<{
    claim: LineupObservationClaim;
    failureCode: string;
    retryDelaysSeconds: readonly [number, number, number, number];
  }>): Promise<LineupWatchTransition>;
  readPendingCurrentLineups(leagueKeys: readonly string[]): Promise<readonly LineupWatchState[]>;
  readPendingFutureLineups(leagueKeys: readonly string[]): Promise<readonly LineupWatchState[]>;
  readLineupWatchStates(leagueKeys: readonly string[]): Promise<readonly LineupWatchState[]>;
  wakeFutureProjectionAndMaterialization(input: Readonly<{
    watchId: string;
    watchGeneration: number;
    authorityGeneration: number;
    weekDistance: number;
    wakeProjection: boolean;
  }>): Promise<LineupWatchTransition>;
  acknowledgeCurrentLineup(input: Readonly<{
    leagueKey: string;
    period: LeaguePeriod;
    fence: Extract<LineupPublicationFence, { ownerLane: 'current' }>;
    modelVersion: string;
    sourceRevision: string;
    actualLineup: LineupRevision;
    snapshotRevision: string;
  }>): Promise<Readonly<{ kind: 'updated' | 'stale' | 'disabled' }>>;
  completeFutureMaterializationAndAcknowledgeLineup(input: Readonly<{
    leagueKey: string;
    projectionSource: ProviderKey;
    normalizerVersion: string;
    modelVersion: string;
    period: LeaguePeriod;
    attemptId: FutureRefreshAttemptId;
    completedAt: string;
    nextRefreshAt: string;
    target: LineupMaterializationTarget;
    sourceRevision: string;
    actualLineup: LineupRevision;
    slate: FutureProjectionSlateLineage;
    snapshotRevision: string;
    runId: string;
  }>): Promise<FutureRefreshTransition>;
}>;

export type LineupWatchScheduleEntry = Readonly<{
  leagueKey: string; leagueRef: ExternalLeagueRef; period: LeaguePeriod; watchClass: 'current' | 'future'; phase: 0 | 1 | 2;
}>;
