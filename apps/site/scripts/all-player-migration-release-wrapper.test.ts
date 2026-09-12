import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  ALL_PLAYER_MIGRATION_CHECKSUM,
  ALL_PLAYER_MIGRATION_SENTINEL,
  buildAllPlayerMigrationReleaseWrapper,
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
