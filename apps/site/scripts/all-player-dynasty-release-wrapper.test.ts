import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { ALL_PLAYER_HOURLY_CHECKSUM, buildAllPlayerDynastyReleaseWrapper,
  releaseWrapperSha256, type AllPlayerRepairManifest } from './all-player-migration-release-wrapper.mjs';

const migrationSql = (await readFile(new URL(
  '../migrations/015_all_player_dynasty_publication.sql', import.meta.url), 'utf8')).replace(/\r\n?/gu, '\n');
const previousManifest = JSON.parse(await readFile(new URL(
  '../release/014-catalog.integration.json', import.meta.url), 'utf8')) as AllPlayerRepairManifest;

function syntheticInput() {
  // Generator-only fixture; never saved as a reviewed PostgreSQL capture.
  return { migrationSql, expectedDatabase: 'projection_refactor_test', expectedOwner: 'neondb_owner',
    previousManifest, manifest: { ...structuredClone(previousManifest),
      migrationName: '015_all_player_dynasty_publication.sql', migrationChecksum: releaseWrapperSha256(migrationSql) } };
}

describe('015 Dynasty publication release wrapper', () => {
  it('binds the rendered production artifact to the exact independently reviewed catalog and migration', async () => {
    const manifest = JSON.parse(await readFile(new URL(
      '../release/015-catalog.integration.json', import.meta.url), 'utf8')) as AllPlayerRepairManifest;
    const rendered = await readFile(new URL(
      '../release/015_all_player_dynasty_publication.production.sql', import.meta.url), 'utf8');
    expect(manifest.reviewed).toBe(true);
    expect(manifest.migrationChecksum).toBe(releaseWrapperSha256(migrationSql));
    expect(rendered.replace(/\r\n?/gu, '\n')).toBe(buildAllPlayerDynastyReleaseWrapper({
      migrationSql, expectedDatabase: 'neondb', expectedOwner: 'neondb_owner',
      runtimeRole: 'league_one_runtime', previousManifest, manifest,
    }));
  });

  it('requires the exact reviewed installed 014 catalog and an exact reviewed PG18 015 capture', () => {
    const input = syntheticInput();
    for (const previous of [{ ...previousManifest, reviewed: false },
      { ...previousManifest, migrationChecksum: '0'.repeat(64) }, { ...previousManifest, postgresMajor: 17 }]) {
      expect(() => buildAllPlayerDynastyReleaseWrapper({ ...input, previousManifest: previous }))
        .toThrow('reviewed installed 014');
    }
    for (const manifest of [{ ...input.manifest, reviewed: false },
      { ...input.manifest, migrationChecksum: '0'.repeat(64) }, { ...input.manifest, postgresMajor: 17 }]) {
      expect(() => buildAllPlayerDynastyReleaseWrapper({ ...input, manifest }))
        .toThrow('reviewed PostgreSQL 18');
    }
  });

  it('preserves ownership, migration ledger, physical protection and unaffected catalog assertions', () => {
    const wrapper = buildAllPlayerDynastyReleaseWrapper(syntheticInput());
    for (const fragment of ['expected exactly migrations 001-014', ALL_PLAYER_HOURLY_CHECKSUM,
      'exact migration 014 function set', 'exact migration 015 function set', 'history count changed',
      'unrelated memberships changed', 'runtime role can assume another role', 'all-player owner is active',
      'LOCK TABLE public.projection_jobs IN SHARE ROW EXCLUSIVE MODE',
      'PostgreSQL 18 constraint type n', 'migration ledger count', '015 checksum',
      'ALL_PLAYER_DYNASTY_APPLIED:015_all_player_dynasty_publication.sql:']) expect(wrapper).toContain(fragment);
    expect(wrapper.indexOf('all-player owner is active')).toBeLessThan(wrapper.indexOf(migrationSql.trimEnd()));
    expect(wrapper.indexOf('COMMIT;')).toBeGreaterThan(wrapper.indexOf('history count changed'));
  });

  it('changes only the installed publication functions while retaining physical, scoring and fence checks', async () => {
    const installed = (await readFile(new URL(
      '../migrations/011_all_player_foundation_guards.sql', import.meta.url), 'utf8')).replace(/\r\n?/gu, '\n');
    expect([...migrationSql.matchAll(/CREATE OR REPLACE FUNCTION public\.([a-z_]+)/gu)].map((match) => match[1]))
      .toEqual(['all_player_score_set_is_publication_ready', 'advance_current_all_player_score_set']);
    expect(migrationSql).not.toMatch(/\b(?:DROP|ALTER|DELETE|TRUNCATE)\b/u);
    expect(migrationSql.match(/league_key IN \('league1', 'league2', 'dynasty'\)/gu)).toHaveLength(5);
    expect(migrationSql).toContain("WHERE league_key IN ('league1', 'league2')");
    expect(migrationSql).toContain('required_original_league_count <> 2');
    expect(migrationSql).toContain('LOCK TABLE public.league_seasons IN SHARE MODE');
    for (const fragment of ['all_player_scoring_contract_supported', 'assert_all_player_job_fence',
      'matched_parity_league_count <> expected_parity_league_count', 'coordinated_score_set_count <> expected_profile_count',
      'mapping.valid_from <= clock_timestamp()', 'mapping.valid_to > clock_timestamp()',
      "'all-player score set is not publication eligible'"]) {
      expect(installed).toContain(fragment);
      expect(migrationSql).toContain(fragment);
    }
  });
});
