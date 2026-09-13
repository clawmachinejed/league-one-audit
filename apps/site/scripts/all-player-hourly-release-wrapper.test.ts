import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { ALL_PLAYER_PARTICIPATION_ASSUMPTION_CHECKSUM, buildAllPlayerHourlyReleaseWrapper,
  releaseWrapperSha256, type AllPlayerRepairManifest } from './all-player-migration-release-wrapper.mjs';

const migrationSql = (await readFile(new URL(
  '../migrations/014_all_player_hourly_collection.sql', import.meta.url), 'utf8')).replace(/\r\n?/gu, '\n');
const previousManifest = JSON.parse(await readFile(new URL(
  '../release/013-catalog.integration.json', import.meta.url), 'utf8')) as AllPlayerRepairManifest;

function syntheticInput() {
  // Generator-only fixture. Never saved as a reviewed 014 catalog. The guarded
  // PG18 wrapper test supplies actual function and constraint fingerprints.
  return { migrationSql, expectedDatabase: 'projection_refactor_test', expectedOwner: 'neondb_owner',
    previousManifest, manifest: { ...structuredClone(previousManifest),
      migrationName: '014_all_player_hourly_collection.sql', migrationChecksum: releaseWrapperSha256(migrationSql) } };
}

describe('014 hourly release wrapper', () => {
  it('binds the production executable to the independently reviewed PostgreSQL 18 capture', async () => {
    const manifest = JSON.parse(await readFile(new URL(
      '../release/014-catalog.integration.json', import.meta.url), 'utf8')) as AllPlayerRepairManifest;
    const expected = buildAllPlayerHourlyReleaseWrapper({ migrationSql,
      expectedDatabase: 'neondb', expectedOwner: 'neondb_owner',
      runtimeRole: 'league_one_runtime', previousManifest, manifest });
    expect(await readFile(new URL(
      '../release/014_all_player_hourly_collection.production.sql', import.meta.url), 'utf8')).toBe(expected);
    expect(manifest.catalog.tables).toEqual(previousManifest.catalog.tables);
    expect(manifest.catalog.triggers).toEqual(previousManifest.catalog.triggers);
    expect(manifest.catalog.constraintTypes).toEqual(previousManifest.catalog.constraintTypes);
    expect(manifest.catalog.functions).toHaveLength(previousManifest.catalog.functions.length + 2);
    for (const name of ['all_player_request_clock', 'all_player_hourly_request_at']) {
      expect(manifest.catalog.functions.find(([functionName]) => functionName === name)?.[3]).toBe(false);
    }
  });

  it('requires the exact reviewed installed 013 catalog and a reviewed exact PG18 014 capture', () => {
    const input = syntheticInput();
    for (const previous of [{ ...previousManifest, reviewed: false },
      { ...previousManifest, migrationChecksum: '0'.repeat(64) }, { ...previousManifest, postgresMajor: 17 }]) {
      expect(() => buildAllPlayerHourlyReleaseWrapper({ ...input, previousManifest: previous }))
        .toThrow('reviewed installed 013');
    }
    for (const manifest of [{ ...input.manifest, reviewed: false },
      { ...input.manifest, migrationChecksum: '0'.repeat(64) }, { ...input.manifest, postgresMajor: 17 }]) {
      expect(() => buildAllPlayerHourlyReleaseWrapper({ ...input, manifest }))
        .toThrow('reviewed PostgreSQL 18');
    }
  });

  it('preserves all checksummed migration, ownership, history, constraint and least-privilege assertions', () => {
    const wrapper = buildAllPlayerHourlyReleaseWrapper(syntheticInput());
    for (const fragment of ['expected exactly migrations 001-013', ALL_PLAYER_PARTICIPATION_ASSUMPTION_CHECKSUM,
      'exact migration 013 function set', 'exact migration 014 function set', 'history count changed',
      'unrelated memberships changed', 'runtime role can assume another role', 'all-player owner is active',
      'LOCK TABLE public.projection_jobs IN SHARE ROW EXCLUSIVE MODE',
      'PostgreSQL 18 constraint type n', 'migration ledger count', '014 checksum',
      'ALL_PLAYER_HOURLY_APPLIED:014_all_player_hourly_collection.sql:']) expect(wrapper).toContain(fragment);
    expect(wrapper.indexOf('all-player owner is active')).toBeLessThan(wrapper.indexOf(migrationSql.trimEnd()));
    expect(wrapper.indexOf('COMMIT;')).toBeGreaterThan(wrapper.indexOf('history count changed'));
  });
});
