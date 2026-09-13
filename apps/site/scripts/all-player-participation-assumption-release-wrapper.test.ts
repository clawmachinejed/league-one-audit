import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { ALL_PLAYER_PARTICIPATION_CHECKSUM, buildAllPlayerParticipationAssumptionReleaseWrapper,
  releaseWrapperSha256, type AllPlayerRepairManifest } from './all-player-migration-release-wrapper.mjs';

const migrationSql = (await readFile(new URL('../migrations/013_all_player_participation_assumption.sql', import.meta.url), 'utf8'))
  .replace(/\r\n?/gu, '\n');
const previousManifest = JSON.parse(await readFile(new URL('../release/012-catalog.integration.json', import.meta.url), 'utf8')) as AllPlayerRepairManifest;
function input() {
  return { migrationSql, expectedDatabase: 'projection_refactor_test', expectedOwner: 'neondb_owner', previousManifest,
    // Synthetic generator expectation only; production requires a fresh,
    // independently reviewed catalog from the actual PostgreSQL 18 wrapper run.
    manifest: { ...previousManifest, migrationName: '013_all_player_participation_assumption.sql',
      migrationChecksum: releaseWrapperSha256(migrationSql) } };
}

describe('013 exact participation assumption release wrapper', () => {
  it('binds installed 001–012, reviewed PostgreSQL 18 objects, ownership and unchanged history', () => {
    const wrapper = buildAllPlayerParticipationAssumptionReleaseWrapper(input());
    for (const value of [ALL_PLAYER_PARTICIPATION_CHECKSUM, 'expected exactly migrations 001-012',
      'exact migration 012 function set', 'exact migration 013 function set', 'exact migration 013 trigger set',
      'exact migration 013 table set', 'LOCK TABLE public.projection_jobs IN SHARE ROW EXCLUSIVE MODE',
      "job_type = 'all-player-ingestion'", 'history count changed', 'unrelated memberships changed',
      'MAINTAIN WITH GRANT OPTION', 'PostgreSQL 18 required']) expect(wrapper).toContain(value);
    expect(wrapper).toContain(`ALL_PLAYER_PARTICIPATION_ASSUMPTION_APPLIED:013_all_player_participation_assumption.sql:${releaseWrapperSha256(migrationSql)}`);
  });

  it('requires exact independently reviewed before and after manifests', () => {
    for (const side of ['manifest','previousManifest'] as const) {
      for (const delta of [{ reviewed: false }, { migrationChecksum: '0'.repeat(64) }, { postgresMajor: 17 }]) {
        const candidate = input();
        expect(() => buildAllPlayerParticipationAssumptionReleaseWrapper({ ...candidate,
          [side]: { ...candidate[side], ...delta } })).toThrow(/independently reviewed/);
      }
    }
  });

  it('changes only the named raw count constraint and existing evidence functions', () => {
    expect(migrationSql).toContain('DROP CONSTRAINT all_player_stat_entries_check');
    expect(migrationSql).toContain('ADD CONSTRAINT all_player_stat_entries_eligibility_counts');
    expect(migrationSql).toContain("eligibility_evidence->>'kind' IS NOT DISTINCT FROM 'assumed-nonparticipation'");
    expect(migrationSql).toContain("normalizer_version NOT LIKE '%-weekly-stats-v4'");
    expect(migrationSql).not.toMatch(/CREATE TABLE|CREATE TRIGGER|UPDATE public\.|DELETE FROM|DROP TABLE|GRANT |REVOKE /iu);
    expect(migrationSql.match(/CREATE OR REPLACE FUNCTION/gu)).toHaveLength(2);
  });
});
