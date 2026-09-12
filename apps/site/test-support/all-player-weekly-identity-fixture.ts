import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import type { PlayerCatalog } from '../lib/transform';
import { foundationFixture } from './all-player-foundation-fixture';

type IdentitySupplement = Readonly<{
  observedAt: string; source: string; rawSha256: string; rawCatalogCount: number;
  scope: string; weeklyRequestCount: number; tank01RequestCount: number; missingIds: readonly string[];
  catalog: Readonly<Record<string, PlayerCatalog[string] & { id: string; player_id: string }>>;
}>;

/** Later official classification metadata supplements absent identities only.
 * Original catalog values and the original incomplete weekly response remain
 * untouched. This helper supplies no historical membership/eligibility proof. */
export function loadFoundationWeeklyIdentityCatalog() {
  const bytes = readFileSync(new URL('./fixtures/all-player-foundation/weekly-identity-supplement.json', import.meta.url));
  const supplement = JSON.parse(bytes.toString('utf8')) as IdentitySupplement;
  const provenance = JSON.parse(readFileSync(new URL('./fixtures/all-player-foundation/provenance.json', import.meta.url), 'utf8')) as {
    weeklyIdentitySupplement: {
      canonicalJsonSha256: string; observedAt: string; rawCatalogSha256: string;
      supplementIdentityCount: number; overlappingIdentityCount: number; addedIdentityCount: number;
      overlapMetadataDifferences: readonly unknown[];
    };
  };
  const evidence = provenance.weeklyIdentitySupplement;
  const byteSha256 = createHash('sha256').update(bytes).digest('hex');
  const canonicalJsonSha256 = createHash('sha256').update(JSON.stringify(supplement)).digest('hex');
  if (canonicalJsonSha256 !== evidence.canonicalJsonSha256 || supplement.observedAt !== evidence.observedAt
    || supplement.rawSha256 !== evidence.rawCatalogSha256 || supplement.source !== 'https://api.sleeper.app/v1/players/nfl'
    || supplement.weeklyRequestCount !== 0 || supplement.tank01RequestCount !== 0 || supplement.missingIds.length !== 0) {
    throw new Error('Weekly identity supplement is not the reviewed current-catalog capture.');
  }
  const original: PlayerCatalog = Object.fromEntries([
    ...Object.values(foundationFixture.catalogs).flat(), ...foundationFixture.selectedUnfilteredIdentities,
  ].map(({ id, ...player }) => [id, player]));
  const catalog: PlayerCatalog = { ...original };
  const addedIdentityIds: string[] = [];
  const overlappingIdentityIds: string[] = [];
  const overlapMetadataDifferences: unknown[] = [];
  for (const [id, { id: recordedId, ...player }] of Object.entries(supplement.catalog)) {
    if (id !== recordedId || id !== player.player_id) throw new Error('Weekly identity supplement has mismatched IDs.');
    if (!Object.hasOwn(original, id)) {
      addedIdentityIds.push(id);
      catalog[id] = player;
      continue;
    }
    overlappingIdentityIds.push(id);
    for (const field of [...new Set([...Object.keys(original[id]), ...Object.keys(player)])].sort()) {
      const retained = (original[id] as Record<string, unknown>)[field];
      const observed = (player as Record<string, unknown>)[field];
      if (JSON.stringify(retained) !== JSON.stringify(observed)) {
        overlapMetadataDifferences.push({ id, field, retained: retained ?? null, observed: observed ?? null });
      }
    }
  }
  if (Object.keys(supplement.catalog).length !== evidence.supplementIdentityCount
    || addedIdentityIds.length !== evidence.addedIdentityCount || overlappingIdentityIds.length !== evidence.overlappingIdentityCount
    || JSON.stringify(overlapMetadataDifferences) !== JSON.stringify(evidence.overlapMetadataDifferences)) {
    throw new Error('Weekly identity supplement scope or overlap differs from its reviewed provenance.');
  }
  return { catalog, original, supplement, addedIdentityIds: addedIdentityIds.sort(), overlappingIdentityIds: overlappingIdentityIds.sort(),
    overlapMetadataDifferences, byteSha256, canonicalJsonSha256 };
}
