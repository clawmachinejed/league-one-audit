import 'server-only';

import type { ProjectionStore } from './contracts';
import type {
  IdentityCrosswalkPort,
  NflGameId,
  NflGameIdentityInput,
  ResolvedNflGame,
  ResolvedScoringEntity,
  ScoringEntityId,
  ScoringEntityIdentityInput,
} from '../../ports/identity-crosswalk';
import {
  externalReferenceKey,
  type ExternalGameRef,
  type ExternalScoringEntityRef,
} from '../../shared/provider-identity';

type IdentityStore = Pick<ProjectionStore,
  | 'enabled'
  | 'upsertScoringEntities'
  | 'upsertNflGames'
>;

function scoringKind(input: ScoringEntityIdentityInput): 'player' | 'team_defense' {
  return input.entity.kind === 'team-defense' ? 'team_defense' : 'player';
}

function legacyScoringKey(input: ScoringEntityIdentityInput): string {
  return `${scoringKind(input)}:${String(input.entity.externalRef.externalId)}`;
}

function ambiguousScoringKeys(inputs: readonly ScoringEntityIdentityInput[]): Set<string> {
  const ownership = new Map<string, string>();
  const ambiguous = new Set<string>();
  for (const input of inputs) {
    for (const reference of input.providerRefs) {
      const referenceKey = externalReferenceKey(reference);
      const previous = ownership.get(referenceKey);
      if (previous && previous !== input.key) {
        ambiguous.add(previous);
        ambiguous.add(input.key);
      } else {
        ownership.set(referenceKey, input.key);
      }
    }
  }
  return ambiguous;
}

function ambiguousGameKeys(inputs: readonly NflGameIdentityInput[]): Set<string> {
  const ownership = new Map<string, string>();
  const ambiguous = new Set<string>();
  for (const input of inputs) {
    for (const reference of [input.primaryRef, ...input.aliasRefs]) {
      const referenceKey = externalReferenceKey(reference);
      const previous = ownership.get(referenceKey);
      if (previous && previous !== input.key) {
        ambiguous.add(previous);
        ambiguous.add(input.key);
      } else {
        ownership.set(referenceKey, input.key);
      }
    }
  }
  return ambiguous;
}

function uniqueScoringReferences(
  references: readonly ExternalScoringEntityRef[],
): readonly ExternalScoringEntityRef[] {
  const seen = new Set<string>();
  return references.filter((reference) => {
    const key = externalReferenceKey(reference);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function uniqueGameAliases(input: NflGameIdentityInput): readonly ExternalGameRef[] {
  const seen = new Set([externalReferenceKey(input.primaryRef)]);
  return input.aliasRefs.filter((reference) => {
    const key = externalReferenceKey(reference);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function isGameIdentityConflict(error: unknown): boolean {
  return error instanceof Error
    && error.message.includes('conflicts with its scheduled game identity');
}

function lowLevelGameInput(input: NflGameIdentityInput, reference: NflGameIdentityInput['primaryRef']) {
  return {
    key: String(reference.externalId),
    provider: String(reference.provider),
    externalGameId: String(reference.externalId),
    season: input.period.season,
    seasonType: input.period.seasonType === 'preseason'
      ? 'pre' as const
      : input.period.seasonType === 'postseason' ? 'post' as const : 'reg' as const,
    week: input.period.week,
    homeTeam: input.homeTeam,
    awayTeam: input.awayTeam,
    kickoffAt: input.kickoffAt,
  };
}

/**
 * Translates resource-scoped canonical identities into the existing Neon store
 * contract. The adapter owns no SQL and performs no environment reads.
 */
export function createNeonIdentityCrosswalk(store: IdentityStore): IdentityCrosswalkPort {
  return {
    enabled: store.enabled,

    async resolveScoringEntities(inputs) {
      if (!store.enabled) return { kind: 'disabled' };
      if (inputs.length === 0) return { kind: 'resolved', value: [] };

      const ambiguous = ambiguousScoringKeys(inputs);
      const mismatchedKinds = new Set(inputs
        .filter((input) => input.providerRefs.some((reference) => (
          reference.entityKind !== input.entity.kind
        )))
        .map((input) => input.key));
      const eligible = inputs.filter((input) => (
        !ambiguous.has(input.key) && !mismatchedKinds.has(input.key)
      ));
      if (eligible.length === 0) {
        return {
          kind: 'resolved',
          value: inputs.map((input): ResolvedScoringEntity => ({
            key: input.key,
            status: ambiguous.has(input.key) ? 'ambiguous' : 'conflict',
            entityId: null,
          })),
        };
      }
      const result = await store.upsertScoringEntities(eligible.map((input) => ({
        key: legacyScoringKey(input),
        kind: scoringKind(input),
        displayName: input.entity.displayName,
        nflTeam: input.entity.nflTeam,
        providerIds: uniqueScoringReferences(input.providerRefs).map((reference) => ({
          provider: String(reference.provider),
          externalId: String(reference.externalId),
        })),
      })));
      if (result.kind === 'disabled') return result;

      const resolved = new Map(result.value.map((value) => [value.key, value]));

      return {
        kind: 'resolved',
        value: inputs.map((input): ResolvedScoringEntity => {
          if (ambiguous.has(input.key)) {
            return { key: input.key, status: 'ambiguous', entityId: null };
          }
          if (mismatchedKinds.has(input.key)) {
            return { key: input.key, status: 'conflict', entityId: null };
          }
          const value = resolved.get(legacyScoringKey(input));
          if (!value?.entityId || value.conflict) {
            return {
              key: input.key,
              status: value?.conflict ? 'conflict' : 'unknown',
              entityId: null,
            };
          }
          return {
            key: input.key,
            status: 'known',
            entityId: value.entityId as ScoringEntityId,
          };
        }),
      };
    },

    async resolveNflGames(inputs) {
      if (!store.enabled) return { kind: 'disabled' };
      if (inputs.length === 0) return { kind: 'resolved', value: [] };

      const ambiguous = ambiguousGameKeys(inputs);
      const eligible = inputs.filter((input) => !ambiguous.has(input.key));
      if (eligible.length === 0) {
        return {
          kind: 'resolved',
          value: inputs.map((input): ResolvedNflGame => ({
            key: input.key,
            status: 'ambiguous',
            gameId: null,
          })),
        };
      }
      const aliasesByKey = new Map(eligible.map((input) => [
        input.key,
        uniqueGameAliases(input),
      ]));
      const conflicts = new Set<string>();

      try {
        const primaryInputs = eligible.map((input) => lowLevelGameInput(input, input.primaryRef));
        const primary = await store.upsertNflGames(primaryInputs);
        if (primary.kind === 'disabled') return primary;

        const gameIds = new Map<string, string>();
        for (const [index, input] of eligible.entries()) {
          const value = primary.value[index];
          if (value?.key === primaryInputs[index].key) gameIds.set(input.key, value.gameId);
        }
        const maxAliases = Math.max(0, ...eligible.map((input) => (
          aliasesByKey.get(input.key)?.length ?? 0
        )));
        for (let aliasIndex = 0; aliasIndex < maxAliases; aliasIndex += 1) {
          const preparedAliases = eligible.flatMap((input) => {
            const alias = aliasesByKey.get(input.key)?.[aliasIndex];
            return alias ? [{ canonicalKey: input.key, value: lowLevelGameInput(input, alias) }] : [];
          });
          if (preparedAliases.length === 0) continue;
          let aliases;
          try {
            aliases = await store.upsertNflGames(preparedAliases.map((alias) => alias.value));
          } catch (error) {
            if (!isGameIdentityConflict(error)) throw error;
            for (const alias of preparedAliases) conflicts.add(alias.canonicalKey);
            continue;
          }
          if (aliases.kind === 'disabled') return aliases;
          for (const [index, prepared] of preparedAliases.entries()) {
            const alias = aliases.value[index];
            if (
              !alias
              || alias.key !== prepared.value.key
              || gameIds.get(prepared.canonicalKey) !== alias.gameId
            ) {
              conflicts.add(prepared.canonicalKey);
            }
          }
        }

        return {
          kind: 'resolved',
          value: inputs.map((input): ResolvedNflGame => {
            if (ambiguous.has(input.key)) {
              return { key: input.key, status: 'ambiguous', gameId: null };
            }
            if (conflicts.has(input.key)) {
              return { key: input.key, status: 'conflict', gameId: null };
            }
            const gameId = gameIds.get(input.key);
            return gameId
              ? { key: input.key, status: 'known', gameId: gameId as NflGameId }
              : { key: input.key, status: 'unknown', gameId: null };
          }),
        };
      } catch (error) {
        if (isGameIdentityConflict(error)) {
          return {
            kind: 'resolved',
            value: inputs.map((input): ResolvedNflGame => ({
              key: input.key,
              status: ambiguous.has(input.key) ? 'ambiguous' : 'conflict',
              gameId: null,
            })),
          };
        }
        throw error;
      }
    },
  };
}
