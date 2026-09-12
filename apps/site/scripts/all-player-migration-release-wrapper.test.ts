import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  ALL_PLAYER_MIGRATION_CHECKSUM,
  ALL_PLAYER_MIGRATION_SENTINEL,
  buildAllPlayerMigrationReleaseWrapper,
  buildAllPlayerRepairReleaseWrapper,
  cloneReviewedCatalog,
  releaseWrapperSha256,
  requireAllPlayerMigrationSentinel,
} from './all-player-migration-release-wrapper.mjs';

const migrationPath = fileURLToPath(
  new URL('../migrations/010_all_player_statistics.sql', import.meta.url),
);
const migrationSql = await readFile(migrationPath, 'utf8');
const productionWrapperPath = fileURLToPath(
  new URL('../release/010_all_player_statistics.production.sql', import.meta.url),
);

function build() {
  return buildAllPlayerMigrationReleaseWrapper({
    migrationSql,
    expectedDatabase: 'projection_refactor_test',
    expectedOwner: 'neondb_owner',
  });
}

describe('all-player migration release wrapper', () => {
  it('refuses an unreviewed or wrong-checksum additive repair manifest', async () => {
    const sql = (await readFile(new URL('../migrations/011_all_player_foundation_guards.sql', import.meta.url), 'utf8'))
      .replace(/\r\n?/gu, '\n');
    const input = { migrationSql: sql, expectedDatabase: 'projection_refactor_test',
      expectedOwner: 'neondb_owner', manifest: { migrationName: '011_all_player_foundation_guards.sql',
        migrationChecksum: releaseWrapperSha256(sql), postgresMajor: 18, reviewed: false,
        catalog: cloneReviewedCatalog() } };
    expect(() => buildAllPlayerRepairReleaseWrapper(input)).toThrow('independently reviewed');
    expect(() => buildAllPlayerRepairReleaseWrapper({ ...input,
      manifest: { ...input.manifest, reviewed: true, migrationChecksum: '0'.repeat(64) },
    })).toThrow('independently reviewed');
    expect(() => buildAllPlayerRepairReleaseWrapper({ ...input,
      manifest: { ...input.manifest, reviewed: true, postgresMajor: 17 },
    })).toThrow('PostgreSQL 18');
  });

  it('uses the same strong catalog/ACL assertions for an additive release', async () => {
    const sql = (await readFile(new URL('../migrations/011_all_player_foundation_guards.sql', import.meta.url), 'utf8'))
      .replace(/\r\n?/gu, '\n');
    // A cloned old catalog is a synthetic generator fixture, not a reviewed 011
    // catalog. The real PG18 capture/rollback suite supplies actual fingerprints.
    const wrapper = buildAllPlayerRepairReleaseWrapper({ migrationSql: sql,
      expectedDatabase: 'projection_refactor_test', expectedOwner: 'neondb_owner',
      manifest: { migrationName: '011_all_player_foundation_guards.sql',
        migrationChecksum: releaseWrapperSha256(sql), postgresMajor: 18, reviewed: true,
        catalog: cloneReviewedCatalog() },
    });
    expect(wrapper).toContain("current_setting('server_version_num')::integer NOT BETWEEN 180000 AND 189999");
    expect(wrapper).toContain('history count changed');
    expect(wrapper).toContain('unrelated memberships changed');
    expect(wrapper).toContain('MAINTAIN WITH GRANT OPTION');
    expect(wrapper).toContain('LOCK TABLE public.projection_jobs IN SHARE ROW EXCLUSIVE MODE');
    expect(wrapper).toContain("WHERE job_type = 'all-player-ingestion'");
    expect(wrapper).toContain('exact migration 010 function set');
    expect(wrapper).toContain('exact migration 011 function set');
    expect(wrapper).toContain('exact migration 011 trigger set');
    expect(wrapper).toContain('exact migration 011 table set');
    expect(wrapper).toContain(ALL_PLAYER_MIGRATION_CHECKSUM);
    expect(wrapper).toContain('ALL_PLAYER_REPAIR_APPLIED:011_all_player_foundation_guards.sql:');
  });

  it('is deterministic and pins the exact reviewed migration and success sentinel', () => {
    const first = build();
    const second = build();
    expect(first).toBe(second);
    expect(first).toContain(ALL_PLAYER_MIGRATION_CHECKSUM);
    expect(first).toContain(ALL_PLAYER_MIGRATION_SENTINEL);
    expect(releaseWrapperSha256(first)).toMatch(/^[0-9a-f]{64}$/u);
  });

  it('keeps the reviewed Production executable byte-identical to deterministic output', async () => {
    const expected = buildAllPlayerMigrationReleaseWrapper({
      migrationSql,
      expectedDatabase: 'neondb',
      expectedOwner: 'neondb_owner',
    });
    expect(await readFile(productionWrapperPath, 'utf8')).toBe(expected);
  });

  it('binds the prepared additive production executable to the reviewed PG18 capture', async () => {
    const manifest = JSON.parse(await readFile(
      new URL('../release/011-catalog.integration.json', import.meta.url), 'utf8',
    ));
    const expected = buildAllPlayerRepairReleaseWrapper({
      migrationSql: await readFile(
        new URL('../migrations/011_all_player_foundation_guards.sql', import.meta.url), 'utf8',
      ),
      expectedDatabase: 'neondb', expectedOwner: 'neondb_owner',
      runtimeRole: 'league_one_runtime', manifest,
    });
    expect(await readFile(new URL(
      '../release/011_all_player_foundation_guards.production.sql', import.meta.url,
    ), 'utf8')).toBe(expected);
    expect(manifest.catalog.tables).toHaveLength(7);
    expect(manifest.catalog.functions).toHaveLength(21);
    expect(manifest.catalog.triggers).toHaveLength(16);
    expect(manifest.catalog.constraintTypes).toContainEqual(['n', 79]);
  });

  it('rejects any byte change to migration 010', () => {
    expect(() => buildAllPlayerMigrationReleaseWrapper({
      migrationSql: `${migrationSql}\n-- changed`,
      expectedDatabase: 'projection_refactor_test',
      expectedOwner: 'neondb_owner',
    })).toThrow(/Migration 010 checksum mismatch/u);
  });

  it('emits individually identifiable table, owner, column, constraint, index, trigger, function, and ACL assertions', () => {
    const wrapper = build();
    for (const message of [
      'release assertion failed: table all_player_stat_contents',
      'release assertion failed: owner all_player_stat_contents',
      'release assertion failed: columns all_player_stat_contents',
      'release assertion failed: constraints all_player_stat_contents',
      'release assertion failed: indexes all_player_stat_contents',
      'release assertion failed: trigger all_player_stat_contents_immutable',
      'release assertion failed: function prevent_all_player_history_change()',
      'release assertion failed: ACL all_player_stat_contents',
      'release assertion failed: function ACL advance_current_all_player_score_set(',
    ]) expect(wrapper).toContain(message);
  });

  it('keeps PostgreSQL 18 NOT NULL constraints in the reviewed constraint manifest', () => {
    const catalog = cloneReviewedCatalog();
    expect(catalog.constraintTypes).toContainEqual(['n', 74]);
    expect(catalog.tables.reduce((total, table) => total + Number(table[3]), 0)).toBe(151);
    expect(catalog.tables.reduce((total, table) => total + Number(table[4]), 0)).toBe(74);
  });

  it('checks destructive, inherited, column, and grant-option access', () => {
    const wrapper = build();
    expect(wrapper).toContain('TRUNCATE,REFERENCES,TRIGGER,MAINTAIN');
    expect(wrapper).toContain('MAINTAIN WITH GRANT OPTION');
    expect(wrapper).toContain('has_any_column_privilege');
    expect(wrapper).toContain("'EXECUTE WITH GRANT OPTION'");
    expect(wrapper).toContain("pg_has_role('league_one_runtime', role.oid, 'SET')");
    expect(wrapper).toContain('membership.inherit_option');
    expect(wrapper).toContain('membership.set_option');
  });

  it('requires the exact success sentinel', () => {
    expect(requireAllPlayerMigrationSentinel([
      { success_sentinel: ALL_PLAYER_MIGRATION_SENTINEL },
    ])).toBe(ALL_PLAYER_MIGRATION_SENTINEL);
    expect(() => requireAllPlayerMigrationSentinel([])).toThrow(/success sentinel is absent/u);
    expect(() => requireAllPlayerMigrationSentinel([
      { success_sentinel: 'wrong' },
    ])).toThrow(/success sentinel is absent/u);
  });
});
