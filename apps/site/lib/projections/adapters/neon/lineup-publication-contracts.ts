import type { FutureRefreshTransition } from '../../ports/future-refresh-repository';

/** Low-level persistence fence; canonical adapters translate scoped worker identities here. */
export type StoreLineupPublicationFence = Readonly<{
  watchId: string;
  watchGeneration: number;
  authorityGeneration: number;
  ownerLane: 'current' | 'future';
  runId: string;
}> & (
  | Readonly<{ ownerLane: 'current' }>
  | Readonly<{
      ownerLane: 'future';
      materializationAttemptId: string;
      projectionProvider: string;
      normalizerVersion: string;
    }>
);

export type StoreLineupMaterializationTarget = Readonly<{
  watchId: string;
  watchGeneration: number;
  authorityGeneration: number;
  observedVersion: number;
  lineupRevision: string | null;
}>;

export type StoreCompleteFutureLineupInput = Readonly<{
  leagueKey: string;
  projectionProvider: string;
  normalizerVersion: string;
  modelVersion: string;
  period: Readonly<{ season: number; seasonType: 'pre' | 'reg' | 'post'; week: number }>;
  attemptId: string;
  completedAt: string;
  nextRefreshAt: string;
  target: StoreLineupMaterializationTarget;
  sourceRevision: string;
  /** Actual full-source lineage; this may differ from the thin observation that triggered the attempt. */
  lineupRevisionVersion: string;
  lineupRevision: string;
  slate: Readonly<{ observationId: string; contentId: string }>;
  snapshotRevision: string;
  runId: string;
}>;

export type StoreAcknowledgeCurrentLineupInput = Readonly<{
  leagueKey: string;
  period: Readonly<{ season: number; seasonType: 'pre' | 'reg' | 'post'; week: number }>;
  fence: Extract<StoreLineupPublicationFence, { ownerLane: 'current' }>;
  modelVersion: string;
  sourceRevision: string;
  lineupRevisionVersion: string;
  lineupRevision: string;
  snapshotRevision: string;
}>;

export type LineupAcknowledgmentMethods = {
  acknowledgeCurrentLineup(input: StoreAcknowledgeCurrentLineupInput): Promise<Readonly<{ kind: 'updated' | 'stale' | 'disabled' }>>;
  completeFutureMaterializationAndAcknowledgeLineup(input: StoreCompleteFutureLineupInput): Promise<FutureRefreshTransition>;
};
