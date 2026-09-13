import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { ALL_PLAYER_REPAIR_CHECKSUM, buildAllPlayerParticipationReleaseWrapper,
  releaseWrapperSha256, type AllPlayerRepairManifest } from './all-player-migration-release-wrapper.mjs';

const migrationSql = (await readFile(new URL('../migrations/012_all_player_provider_participation.sql', import.meta.url), 'utf8'))
  .replace(/\r\n?/gu, '\n');
const previousManifest = JSON.parse(await readFile(new URL('../release/011-catalog.integration.json', import.meta.url), 'utf8')) as AllPlayerRepairManifest;
// This synthetic generator fixture does not stand in for the actual 012 PG18
// catalog. The isolated wrapper command captures the real catalog separately.
function input() {
  return { migrationSql, expectedDatabase: 'projection_refactor_test', expectedOwner: 'neondb_owner', previousManifest,
    manifest: { ...previousManifest, migrationName: '012_all_player_provider_participation.sql',
      migrationChecksum: releaseWrapperSha256(migrationSql) } };
}

describe('012 exact additive release wrapper', () => {
  it('binds the immutable 011 ledger and reviewed pre/post PostgreSQL 18 catalog', () => {
    const wrapper = buildAllPlayerParticipationReleaseWrapper(input());
    expect(wrapper).toContain(ALL_PLAYER_REPAIR_CHECKSUM);
    expect(wrapper).toContain("expected exactly migrations 001-011");
    expect(wrapper).toContain('exact migration 011 function set');
    expect(wrapper).toContain('exact migration 012 function set');
    expect(wrapper).toContain('exact migration 012 trigger set');
    expect(wrapper).toContain('exact migration 012 table set');
    expect(wrapper).toContain('LOCK TABLE public.projection_jobs IN SHARE ROW EXCLUSIVE MODE');
    expect(wrapper).toContain("job_type = 'all-player-ingestion'");
    expect(wrapper).toContain('SELECT \'all_player_score_verifications\',count(*) FROM all_player_score_verifications');
    expect(wrapper).toContain('history count changed');
    expect(wrapper).toContain('unrelated memberships changed');
    expect(wrapper).toContain('MAINTAIN WITH GRANT OPTION');
    expect(wrapper).toContain(`ALL_PLAYER_PARTICIPATION_APPLIED:012_all_player_provider_participation.sql:${releaseWrapperSha256(migrationSql)}`);
  });

  it('rejects unreviewed, mismatched, and wrong-version catalogs on either side', () => {
    for (const side of ['manifest','previousManifest'] as const) {
      for (const delta of [{ reviewed: false }, { migrationChecksum: '0'.repeat(64) }, { postgresMajor: 17 }]) {
        const candidate = input();
        expect(() => buildAllPlayerParticipationReleaseWrapper({ ...candidate,
          [side]: { ...candidate[side], ...delta } })).toThrow(/independently reviewed/);
      }
    }
  });

  it('does not rewrite installed migrations or add eligibility to context', () => {
    expect(migrationSql).not.toMatch(/UPDATE public\.all_player|DELETE FROM|DROP TABLE|ALTER.*010/iu);
    expect(migrationSql).toContain("context->>'role' IS DISTINCT FROM 'context-only'");
    expect(migrationSql).toContain("context->'effectivePeriod' IS DISTINCT FROM 'null'::jsonb");
    expect(migrationSql).toContain('ADD COLUMN provider_context jsonb');
    expect(migrationSql).toContain('1200000');
    expect(migrationSql).toContain("LIKE '%-weekly-stats-v3'");
  });
});
