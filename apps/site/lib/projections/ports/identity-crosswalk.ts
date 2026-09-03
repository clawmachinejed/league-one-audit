import type {
  ExternalGameRef,
  ExternalScoringEntityRef,
} from '../shared/provider-identity';
import type {
  LeaguePeriod,
  NflTeam,
  ScoringEntity,
} from '../domain/contracts';

declare const canonicalIdentityIdBrand: unique symbol;

export type CanonicalIdentityId<Resource extends string> = string & Readonly<{
  [canonicalIdentityIdBrand]: Resource;
}>;

export type ScoringEntityId = CanonicalIdentityId<'scoring-entity'>;
export type NflGameId = CanonicalIdentityId<'nfl-game'>;

export type IdentityResolutionOutcome<Value> =
  | Readonly<{ kind: 'resolved'; value: Value }>
  | Readonly<{ kind: 'disabled' }>;

export type ScoringEntityIdentityInput = Readonly<{
  key: string;
  entity: ScoringEntity;
  /** Primary and alias references that must resolve to one canonical entity. */
  providerRefs: readonly ExternalScoringEntityRef[];
}>;

export type ResolvedScoringEntity =
  | Readonly<{ key: string; status: 'known'; entityId: ScoringEntityId }>
  | Readonly<{ key: string; status: 'unknown' | 'conflict' | 'ambiguous'; entityId: null }>;

export type NflGameIdentityInput = Readonly<{
  key: string;
  primaryRef: ExternalGameRef;
  aliasRefs: readonly ExternalGameRef[];
  period: LeaguePeriod;
  homeTeam: NflTeam;
  awayTeam: NflTeam;
  kickoffAt: string | null;
}>;

export type ResolvedNflGame =
  | Readonly<{ key: string; status: 'known'; gameId: NflGameId }>
  | Readonly<{ key: string; status: 'unknown' | 'conflict' | 'ambiguous'; gameId: null }>;

/** Neon-backed canonical identity boundary; provider feeds never own canonical IDs. */
export type IdentityCrosswalkPort = Readonly<{
  enabled: boolean;
  resolveScoringEntities: (
    inputs: readonly ScoringEntityIdentityInput[],
  ) => Promise<IdentityResolutionOutcome<readonly ResolvedScoringEntity[]>>;
  resolveNflGames: (
    inputs: readonly NflGameIdentityInput[],
  ) => Promise<IdentityResolutionOutcome<readonly ResolvedNflGame[]>>;
}>;
