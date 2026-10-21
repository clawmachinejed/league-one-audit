import type { ProviderReference } from '../aggregator/contracts';
import type { AdministrationWriteFence, JsonValue } from './contracts';

/** Constructed by a deployment registry after its complete source/version tuple matches.
 * Syntax validation or a retained mapping alone is never source admission. */
declare const registeredProvider: unique symbol;
export type RegistryProviderKey = string & { readonly [registeredProvider]: true };
export type CanonicalSourceReference = ProviderReference<RegistryProviderKey>;
export type StructuralSourceReference = ProviderReference<string>;
export type CanonicalSourceMappingV1 = Readonly<{
  connectionId: string; leagueSeasonId: string; revisionId: string; generation: number;
  scope: Readonly<{ provider: string; leagueKey: string; externalLeagueId: string;
    season: number; nativeNamespace: string }>;
  /** Season context from the immutable mapping revision, not the league keyspace. */
  sourceNamespace: string;
}>;

export type CanonicalRegistrationCapture = Readonly<{
  version: string; nativeKind: string; origin: 'network' | 'fixture'; payload: JsonValue;
  sourceDigest: string; requestStartedAt: string | null; requestCompletedAt: string | null;
  acquisition: JsonValue;
}>;
export type CanonicalLeagueSeasonInput = Readonly<{
  mode: 'official-data'; leagueKey: string; leagueName: string; season: number;
  sourceLeague: CanonicalSourceReference; scoringRules?: Readonly<Record<string, number>> | null;
}>;
export type CanonicalRegistrationAuthorization = Readonly<{
  work: JsonValue; fence: AdministrationWriteFence; registrationCapture: CanonicalRegistrationCapture;
}>;
export type CanonicalLeagueSeasonReference = Readonly<{
  leagueId: string; leagueSeasonId: string; scoringProfileId: string | null; mapping: CanonicalSourceMappingV1;
}>;
export type CanonicalSourceMappingSelection = Readonly<{
  sourceLeague: CanonicalSourceReference; leagueSeasonId?: string;
}>;
export type CanonicalSourceMappingRead = Readonly<{ status: 'available'; mapping: CanonicalSourceMappingV1 }>
  | Readonly<{ status: 'missing' | 'conflict' | 'disabled' | 'unavailable'; reason: string }>;

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid canonical identity object.');
  return value as Record<string, unknown>;
}
function exact(value: Record<string, unknown>, keys: readonly string[]): void {
  if (Object.keys(value).length !== keys.length || keys.some(key => !Object.hasOwn(value, key))) {
    throw new Error('Unexpected canonical identity fields.');
  }
}
export function assertCanonicalIdentityUuid(value: unknown): asserts value is string {
  if (typeof value !== 'string' || !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/u.test(value)) {
    throw new Error('Invalid canonical identity UUID.');
  }
}
/** Validate exact text without changing opaque IDs, including significant whitespace. */
function text(value: unknown): asserts value is string {
  if (typeof value !== 'string' || !value.trim() || /[\x00-\x1f\x7f]/u.test(value)) {
    throw new Error('Invalid canonical identity text.');
  }
}
/** Structural validation only. Caller must select the deployment registry policy before use. */
export function assertCanonicalSourceReference(value: unknown, kind?: string): asserts value is StructuralSourceReference {
  const source = object(value);
  exact(source, ['provider', 'resourceKind', 'nativeNamespace', 'nativeId']);
  if (typeof source.provider !== 'string' || !/^[a-z][a-z0-9-]{0,63}$/u.test(source.provider)
    || kind !== undefined && source.resourceKind !== kind) throw new Error('Invalid canonical source provider or resource.');
  text(source.resourceKind); text(source.nativeNamespace); text(source.nativeId);
}
/** A retained mapping shape is not admission. Registry equality and stored lineage are separate checks. */
export function assertCanonicalSourceMapping(value: unknown): asserts value is CanonicalSourceMappingV1 {
  const mapping = object(value), scope = object(mapping.scope);
  exact(mapping, ['connectionId', 'leagueSeasonId', 'revisionId', 'generation', 'scope', 'sourceNamespace']);
  exact(scope, ['provider', 'leagueKey', 'externalLeagueId', 'season', 'nativeNamespace']);
  assertCanonicalIdentityUuid(mapping.connectionId); assertCanonicalIdentityUuid(mapping.leagueSeasonId);
  assertCanonicalIdentityUuid(mapping.revisionId);
  if (!Number.isSafeInteger(mapping.generation) || Number(mapping.generation) < 1
    || !Number.isInteger(scope.season) || Number(scope.season) < 1920 || Number(scope.season) > 2200) {
    throw new Error('Invalid canonical mapping generation or season.');
  }
  text(scope.leagueKey); text(mapping.sourceNamespace);
  assertCanonicalSourceReference({ provider: scope.provider, resourceKind: 'league',
    nativeNamespace: scope.nativeNamespace, nativeId: scope.externalLeagueId }, 'league');
}

/** Framed opaque identity, used only after registry validation by its caller. */
export function canonicalSourceReferenceKey(source: StructuralSourceReference): string {
  assertCanonicalSourceReference(source);
  return JSON.stringify([source.provider, source.resourceKind, source.nativeNamespace, source.nativeId]);
}
