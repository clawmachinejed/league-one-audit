import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
import { loadFantasyPlayerCatalog } from '../../sleeper-player-catalog';
import { loadFoundationFixtureCatalogPosition } from '../../../test-support/all-player-foundation-fixture';
import { officialPlayerIdentityInventory } from '../shared/official-catalog-identity';
import { externalPlayerRef, externalTeamDefenseRef, externalReferenceKey, providerKey } from '../shared/provider-identity';
import type { NflTeam, ProjectionObservation, ProjectionSlate } from '../domain/contracts';
import { projectionEntityForObservation, scoringIdentityInputs } from './roster-context';
import { analyzeFullSlateProjectionCoverage } from './provider-stage';

const official = providerKey('sleeper');
const tank = providerKey('tank01');
function fixture<T>(name: string): T {
  return JSON.parse(readFileSync(new URL(`../../../test-support/fixtures/all-player-foundation/${name}`, import.meta.url), 'utf8')) as T;
}
const captured = fixture<{ entries: readonly { providerExternalId: string; entityKind: 'player' | 'team_defense';
  nflTeam: NflTeam; position: string; aliases: readonly { provider: string; externalId: string }[] }[] }>('projection-identities.json');
const projections: ProjectionObservation[] = captured.entries.map((entry) => ({
  identity: {
    primary: entry.entityKind === 'player' ? externalPlayerRef(tank, entry.providerExternalId)
      : externalTeamDefenseRef(tank, entry.providerExternalId),
    aliases: entry.aliases.map((alias) => externalPlayerRef(providerKey(alias.provider), alias.externalId)),
  },
  nflTeam: entry.nflTeam, position: entry.position,
  // This retained identity-only capture proves no statistics arithmetic.
  stats: {}, scoringStats: entry.entityKind === 'player' ? { kind: 'offense' } : { kind: 'defense' }, missingFields: [],
}));
function identityOnlySlate(rows: readonly ProjectionObservation[]): ProjectionSlate {
  return { projections: rows } as unknown as ProjectionSlate;
}

describe('retained production projection identity evidence', () => {
  it('preserves all 488 source rows and eight FB identities while quarantining only the proven wrong pairing', async () => {
    const catalog = await loadFantasyPlayerCatalog(loadFoundationFixtureCatalogPosition);
    const inventory = officialPlayerIdentityInventory(catalog.catalog, official);
    const resolved = projections.map((projection) => projectionEntityForObservation(projection, official, inventory));
    expect(projections).toHaveLength(488);
    expect(resolved.filter(Boolean)).toHaveLength(487);
    expect(resolved.filter((entity) => entity?.kind === 'team-defense')).toHaveLength(32);
    const fb = projections.filter((projection) => projection.position === 'FB');
    expect(fb).toHaveLength(8);
    expect(fb.map((projection) => projectionEntityForObservation(projection, official, inventory)?.externalRef.externalId))
      .toEqual(['1379', '4353', '6109', '7204', '8181', '11510', '13433', '13516']);
    expect(resolved[253]).toBeNull();
    expect(projections[253].identity.primary.externalId).toBe('4429835');
  });

  it('does not equate the real verified wrong map or an absent-map proposal with semantic identity proof', async () => {
    const catalog = await loadFantasyPlayerCatalog(loadFoundationFixtureCatalogPosition);
    const inventory = officialPlayerIdentityInventory(catalog.catalog, official);
    const mappings = fixture<{ mappings: readonly { provider: string; entityKind: 'player' | 'team_defense';
      externalId: string; mappingStatus: string; scoringEntityId: string }[] }>('mapping-evidence.json').mappings;
    const wrong = mappings.filter((row) => row.externalId === '8063' || row.externalId === '4429835');
    expect(wrong).toHaveLength(2);
    expect(wrong.every((row) => row.mappingStatus === 'verified'
      && row.scoringEntityId === '10ae356b-990f-5ed1-8b31-2fd98dd5acbd')).toBe(true);
    const map = new Map(wrong.map((row) => [externalReferenceKey(externalPlayerRef(providerKey(row.provider), row.externalId)), row.scoringEntityId]));
    const wrongSlate = identityOnlySlate([projections[253]]);
    for (const evidence of [map, new Map<string, string>()]) {
      expect(analyzeFullSlateProjectionCoverage(wrongSlate, official, evidence, inventory)).toMatchObject({
        identityComplete: false, rankEligibleProjectionCount: 1, resolvedIdentityCount: 0, skippedIdentityCount: 1,
      });
    }
    const group = { period: { season: 2026, seasonType: 'regular' as const, week: 1 }, leagues: [{
      configuration: { leagueRef: { provider: official } },
      source: { officialIdentityInventory: inventory, rosteredEntities: [], matchups: [] },
    }] } as unknown as Parameters<typeof scoringIdentityInputs>[0];
    expect(scoringIdentityInputs(group, wrongSlate)).toEqual([]);
    expect(inventory.some((entity) => entity.externalRef.externalId === '12048')).toBe(true);
  });

  it.each(['missing', 'unverified', 'retired', 'expired', 'wrong-kind', 'conflicting'])(
    'marks optional %s aliases unresolved despite an otherwise mapped official target', async () => {
      const catalog = await loadFantasyPlayerCatalog(loadFoundationFixtureCatalogPosition);
      const inventory = officialPlayerIdentityInventory(catalog.catalog, official);
      const projection = projections[0];
      const officialRef = projection.identity.aliases[0];
      const map = new Map([[externalReferenceKey(officialRef), 'existing-canonical']]);
      expect(analyzeFullSlateProjectionCoverage(identityOnlySlate([projection]),
        official, map, inventory, new Set([externalReferenceKey(projection.identity.primary)])))
        .toMatchObject({ identityComplete: false, skippedIdentityCount: 1, rankUnavailablePositions: ['K'] });
    },
  );
});
