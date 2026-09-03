import type { ProviderKey } from '../shared/provider-identity';

/** Internal durable work identity. Provider identities remain separately scoped. */
export type LineupMaterializationTarget = Readonly<{
  watchId: string;
  watchGeneration: number;
  authorityGeneration: number;
  observedVersion: number;
  lineupRevision: string | null;
}>;

export type LineupPublicationFence = Readonly<{
  watchId: string;
  watchGeneration: number;
  authorityGeneration: number;
  runId: string;
}> & (
  | Readonly<{ ownerLane: 'current' }>
  | Readonly<{
      ownerLane: 'future';
      materializationAttemptId: string;
      projectionSource: ProviderKey;
      normalizerVersion: string;
    }>
);
