import 'server-only';
import type { PublicIntakeWork } from './contracts';
import type { AdministrationSourceMapping } from './source-mapping';
import { assertCanonicalSourceMapping, type CanonicalSourceMappingV1, type RegistryProviderKey } from './canonical-source-contracts';
import { CANONICAL_DELIVERY_VERSION, CANONICAL_STANDINGS_VERSION, CANONICAL_HASH_VERSION,
  canonicalEqual, canonicalKeys, canonicalObject, type CanonicalStandingsPolicy } from './canonical-standings-contracts';

/** Deployment code owns this manifest. Isolated qualification installs a separate, source-pinned manifest. */
export function sleeperCanonicalStandingsPolicy(mapping: CanonicalSourceMappingV1): CanonicalStandingsPolicy {
  assertCanonicalSourceMapping(mapping);
  if (mapping.scope.provider !== 'sleeper' || mapping.scope.nativeNamespace !== 'nfl' || mapping.scope.season !== 2026
    || mapping.sourceNamespace !== 'nfl:2026') throw new Error('Unregistered canonical standings source.');
  return Object.freeze({ contractVersion: CANONICAL_DELIVERY_VERSION, canonicalSchemaVersion: CANONICAL_STANDINGS_VERSION,
    hashVersion: CANONICAL_HASH_VERSION, adapterVersion: 'sleeper-standings-adapter-v1',
    nativeVerifierVersion: 'sleeper-standings-sql-v1', canonicalNormalizerVersion: 'sleeper-standings-canonical-v1',
    validationVersion: 'canonical-standings-acceptance-v1', audienceId: 'public', coverageSpecId: 'official-season-standings-v1',
    provider: 'sleeper', nativeKind: 'sleeper-rosters',
    teamNamespace: JSON.stringify(['nfl', mapping.scope.season, mapping.scope.externalLeagueId]), originPolicy: 'network-bridge-v1' });
}
export type CanonicalStandingsPolicyResolver = (mapping: CanonicalSourceMappingV1, recordedPolicy?: unknown) => CanonicalStandingsPolicy;
export const resolveCanonicalStandingsPolicy: CanonicalStandingsPolicyResolver = (mapping, recordedPolicy) => {
  const expected = sleeperCanonicalStandingsPolicy(mapping);
  if (recordedPolicy !== undefined && !canonicalEqual(recordedPolicy, expected)) throw new Error('Unknown canonical standings policy.');
  return expected;
};
export function parseRegisteredProviderKey(provider: unknown, mapping: CanonicalSourceMappingV1,
  policy: unknown): RegistryProviderKey {
  const selected = resolveCanonicalStandingsPolicy(mapping, policy);
  if (provider !== selected.provider) throw new Error('Provider does not match registered standings tuple.');
  return selected.provider as RegistryProviderKey;
}

/** Validate every extra field before projecting the unchanged native mapping. */
export function legacyStandingsMapping(mapping: CanonicalSourceMappingV1): AdministrationSourceMapping {
  sleeperCanonicalStandingsPolicy(mapping);
  const scope = mapping.scope;
  return { connectionId: mapping.connectionId, leagueSeasonId: mapping.leagueSeasonId, revisionId: mapping.revisionId,
    generation: mapping.generation, scope: { provider: 'sleeper', leagueKey: scope.leagueKey,
      externalLeagueId: scope.externalLeagueId, season: scope.season } };
}

/** Explicit code-owned selection seam. Release/qualification gates have not enabled production admission.
 * It is deliberately not an environment, request, route or caller-provided trust flag. */
export function selectCanonicalStandingsCapture(mapping: AdministrationSourceMapping,
  work: PublicIntakeWork): CanonicalStandingsPolicy | null {
  void mapping; void work;
  return null;
}

export function canonicalStandingsVersions(policy: CanonicalStandingsPolicy) {
  return { contractVersion: policy.contractVersion, canonicalSchemaVersion: policy.canonicalSchemaVersion,
    hashVersion: policy.hashVersion, adapterVersion: policy.adapterVersion,
    nativeVerifierVersion: policy.nativeVerifierVersion, canonicalNormalizerVersion: policy.canonicalNormalizerVersion };
}

/** A stored policy must remain a closed data object; it never selects executable code. */
export function assertCanonicalPolicyShape(value: unknown): asserts value is CanonicalStandingsPolicy {
  const policy = canonicalObject(value);
  canonicalKeys(policy, ['contractVersion', 'canonicalSchemaVersion', 'hashVersion', 'adapterVersion', 'nativeVerifierVersion',
    'canonicalNormalizerVersion', 'validationVersion', 'audienceId', 'coverageSpecId', 'provider', 'nativeKind', 'teamNamespace', 'originPolicy']);
  if (policy.contractVersion !== CANONICAL_DELIVERY_VERSION || policy.canonicalSchemaVersion !== CANONICAL_STANDINGS_VERSION
    || policy.hashVersion !== CANONICAL_HASH_VERSION || policy.validationVersion !== 'canonical-standings-acceptance-v1'
    || policy.audienceId !== 'public' || policy.coverageSpecId !== 'official-season-standings-v1'
    || !['network-bridge-v1', 'fixture-v1'].includes(String(policy.originPolicy))) throw new Error('Invalid canonical policy shape.');
  for (const key of ['adapterVersion', 'nativeVerifierVersion', 'canonicalNormalizerVersion', 'provider', 'nativeKind', 'teamNamespace']) {
    if (typeof policy[key] !== 'string' || !policy[key]) throw new Error('Invalid canonical policy value.');
  }
}
