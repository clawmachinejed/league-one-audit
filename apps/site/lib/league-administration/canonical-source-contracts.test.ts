import { describe, expect, expectTypeOf, it } from 'vitest';
import type { ProviderReference } from '../aggregator/contracts';
import { assertCanonicalSourceMapping, assertCanonicalSourceReference, canonicalSourceReferenceKey,
  type CanonicalSourceMappingV1, type StructuralSourceReference } from './canonical-source-contracts';

const mapping: CanonicalSourceMappingV1 = { connectionId: '00000000-0000-4000-8000-000000000001',
  leagueSeasonId: '00000000-0000-4000-8000-000000000002', revisionId: '00000000-0000-4000-8000-000000000003', generation: 1,
  scope: { provider: 'sleeper', leagueKey: 'opaque-source', externalLeagueId: ' club:ABC-7 ', season: 2026, nativeNamespace: 'nfl' },
  sourceNamespace: 'nfl:2026' };

describe('canonical identity structure', () => {
  it('preserves the legacy ProviderReference default and never brands a syntax-only source', () => {
    expectTypeOf<ProviderReference['provider']>().toEqualTypeOf<'sleeper' | 'yahoo'>();
    const source: unknown = { provider: 'unregistered-fixture', resourceKind: 'league', nativeNamespace: 'Case: One', nativeId: ' club:ABC-7 ' };
    assertCanonicalSourceReference(source, 'league');
    expectTypeOf(source).toEqualTypeOf<StructuralSourceReference>();
    expectTypeOf(source.provider).toEqualTypeOf<string>();
    expect(source.nativeId).toBe(' club:ABC-7 ');
  });
  it('frames provider, kind, namespace and native ID without delimiter collisions or normalization', () => {
    const source = { provider: 'fixture', resourceKind: 'team', nativeNamespace: 'A:B', nativeId: 'C' };
    const variants = [source, { ...source, nativeNamespace: 'A', nativeId: 'B:C' }, { ...source, provider: 'fixture-2' },
      { ...source, resourceKind: 'league' }, { ...source, nativeId: 'c' }, { ...source, nativeId: ' C ' }];
    expect(new Set(variants.map(canonicalSourceReferenceKey)).size).toBe(variants.length);
    expect(JSON.parse(canonicalSourceReferenceKey(source))).toEqual(['fixture', 'team', 'A:B', 'C']);
  });
  it('rejects ambiguous or malformed reference structure without trimming values into an identity', () => {
    const source = { provider: 'sleeper', resourceKind: 'league', nativeNamespace: 'nfl', nativeId: 'opaque' };
    for (const invalid of [{ ...source, extra: true }, { ...source, provider: 'Sleeper' }, { ...source, nativeId: 123 },
      { ...source, nativeId: '' }, { ...source, nativeNamespace: ' ' }, { ...source, nativeId: 'x\ny' }]) {
      expect(() => assertCanonicalSourceReference(invalid, 'league')).toThrow();
    }
    expect(() => assertCanonicalSourceReference(source, 'team')).toThrow();
  });
  it('keeps the league keyspace and recorded season context distinct while rejecting extra mapping authority', () => {
    expect(() => assertCanonicalSourceMapping(mapping)).not.toThrow();
    expect(mapping.scope.nativeNamespace).not.toBe(mapping.sourceNamespace);
    for (const invalid of [{ ...mapping, verified: true }, { ...mapping, generation: 0 }, { ...mapping, generation: 2 ** 53 },
      { ...mapping, connectionId: 'not-a-uuid' }, { ...mapping, scope: { ...mapping.scope, verified: true } },
      { ...mapping, sourceNamespace: '' }]) expect(() => assertCanonicalSourceMapping(invalid)).toThrow();
  });
});
