import type { StoreLineupPublicationFence } from './lineup-publication-contracts';

export type LineupWatchPeriod = Readonly<{ season: number; seasonType: 'pre' | 'reg' | 'post'; week: number }>;
export type LineupWatchClass = 'current' | 'future';
export type LineupMaterializationLane = 'current' | 'future';
export type LineupWatchTarget = Readonly<{
  leagueKey: string;
  sourceProvider: string;
  externalLeagueId: string;
  period: LineupWatchPeriod;
  lineupRevisionVersion: string;
  cadencePolicyVersion: string;
  authorityGeneration: number;
  watchClass: LineupWatchClass | 'completed';
  materializationLane: LineupMaterializationLane | null;
  phase: 0 | 1 | 2;
  expectedRosterCount: number;
  expectedStarterSlotCount: number;
  expectedRosterIds: readonly string[];
  initialNextCheckAt: string | null;
}>;
export type StoredLineupWatchState = Omit<LineupWatchTarget, 'initialNextCheckAt'> & Readonly<{
  id: string;
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
  watchClass: LineupWatchClass;
  materializationLane: LineupMaterializationLane;
}>;
export type LineupObservationClaim = LineupWatchFence & Readonly<{
  attemptId: string;
  claimGeneration: number;
  workerId: string;
  targetObservedVersion: number;
}>;
export type CompleteLineupObservationInput = Readonly<{
  claim: LineupObservationClaim;
  lineupRevision: string;
  requestStartedAt: string;
  requestCompletedAt: string;
  nextCheckAt: string;
}>;
export type FullLineupObservationInput = Omit<CompleteLineupObservationInput, 'claim'> & Readonly<{ fence: LineupWatchFence }>;
export type LineupObservationWriteOutcome =
  | Readonly<{ kind: 'stored'; state: StoredLineupWatchState }>
  | Readonly<{ kind: 'stale' | 'disabled' }>;
export type LineupWatchTransition = Readonly<{ kind: 'stored' | 'stale' | 'disabled' }>;
export type LineupWatchSyncInput = Readonly<{
  /** Full registry membership: an unhealthy authority must not look like a deleted league. */
  registeredLeagueKeys: readonly string[];
  /** Each healthy league supplies its complete configured horizon, including completed rows. */
  targets: readonly LineupWatchTarget[];
}>;
export type ClaimDueLineupObservationsInput = Readonly<{
  leagueKeys: readonly string[];
  materializationLane: LineupMaterializationLane;
  workerId: string;
  leaseSeconds: number;
  limit: number;
  futureLimit: number;
  catchUp: boolean;
}>;
export type WakeFutureLineupInput = Readonly<{
  watchId: string;
  watchGeneration: number;
  authorityGeneration: number;
  projectionProvider: string;
  normalizerVersion: string;
  modelVersion: string;
  weekDistance: number;
  wakeProjection: boolean;
}>;
export type LineupWatchMethods = {
  readLineupWatchSchedule(leagueKeys: readonly string[]): Promise<readonly StoredLineupWatchSchedule[]>;
  reserveFullLineupObservation(input: Readonly<{
    fence: StoreLineupPublicationFence; modelVersion: string; leaseSeconds: number;
  }>): Promise<LineupObservationWriteOutcome>;
  synchronizeLineupWatchStates(input: LineupWatchSyncInput): Promise<Readonly<{ kind: 'stored'; states: readonly StoredLineupWatchState[] }> | Readonly<{ kind: 'disabled' }>>;
  claimDueLineupObservations(input: ClaimDueLineupObservationsInput): Promise<readonly StoredLineupWatchState[]>;
  completeLineupObservation(input: CompleteLineupObservationInput): Promise<LineupObservationWriteOutcome>;
  recordLineupObservationNotReady(input: Readonly<{ claim: LineupObservationClaim; checkedAt: string; nextCheckAt: string }>): Promise<LineupWatchTransition>;
  failLineupObservation(input: Readonly<{ claim: LineupObservationClaim; failureCode: string; retryDelaysSeconds: readonly [number, number, number, number] }>): Promise<LineupWatchTransition>;
  supersedeLineupClaimWithFullObservation(input: FullLineupObservationInput): Promise<LineupObservationWriteOutcome>;
  readPendingCurrentLineups(leagueKeys: readonly string[]): Promise<readonly StoredLineupWatchState[]>;
  readPendingFutureLineups(leagueKeys: readonly string[]): Promise<readonly StoredLineupWatchState[]>;
  readLineupWatchStates(leagueKeys: readonly string[]): Promise<readonly StoredLineupWatchState[]>;
  wakeFutureProjectionAndMaterialization(input: WakeFutureLineupInput): Promise<LineupWatchTransition>;
};

/** Planning-only identities. Fresh authority is still required by every claim/read/publication path. */
export type StoredLineupWatchSchedule = Pick<StoredLineupWatchState,
  'leagueKey' | 'sourceProvider' | 'externalLeagueId' | 'period' | 'phase'> & Readonly<{ watchClass: LineupWatchClass }>;
