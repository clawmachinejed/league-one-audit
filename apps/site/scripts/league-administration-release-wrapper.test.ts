import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ADMINISTRATION_POSTGRES_VERSION, ADMINISTRATION_TABLES, ADMINISTRATION_NEW_FUNCTIONS,
  ADMINISTRATION_REPLACED_FUNCTIONS, ADMINISTRATION_EXISTING_TABLE_TRIGGERS,
  leagueAdministrationCatalogSql } from './league-administration-catalog.mjs';
import { ADMINISTRATION_MIGRATIONS, ADMINISTRATION_INSTALLED_LEDGER, administrationMigrationChecksum,
  buildLeagueAdministrationReleaseWrapper, requireAdministrationReleaseSentinel, administrationReleaseSentinel,
  type AdministrationCatalog, type AdministrationCatalogFunction, type AdministrationReleaseManifest } from './league-administration-release-wrapper.mjs';

const migrations = await Promise.all(ADMINISTRATION_MIGRATIONS.map(async (name) => ({ name,
  sql: await readFile(new URL(`../migrations/${name}`, import.meta.url), 'utf8') })));
const owner = 'neondb_owner';

function functionRow(signature: string): AdministrationCatalogFunction {
  return { signature, definitionHash: 'a'.repeat(32), owner, securityDefiner: true,
    configuration: ['search_path=pg_catalog, public, pg_temp'], acl: '', publicExecute: false,
    runtimeExecute: signature.startsWith('record_league_administration_observation(') || signature.startsWith('advance_current_all_player_score_set(') };
}

function syntheticInput() {
  // Only a generator fixture. Never write this synthetic catalog as DB evidence.
  const before: AdministrationCatalog = { tables: [], constraintTypes: [], triggers: [], functions: ADMINISTRATION_REPLACED_FUNCTIONS.map(functionRow) };
  const after: AdministrationCatalog = {
    tables: ADMINISTRATION_TABLES.map((name) => ({ name, kind: 'r', owner, acl: '', rls: false, forceRls: false,
      runtimePrivileges: ['SELECT'], publicPrivileges: [], columns: 1, columnHash: 'a'.repeat(32),
      constraints: 1, notNullConstraints: 1, constraintHash: 'b'.repeat(32), indexes: 1, indexHash: 'c'.repeat(32), policyHash: 'd'.repeat(32) })),
    constraintTypes: [['n', 15]],
    functions: [...ADMINISTRATION_NEW_FUNCTIONS, ...ADMINISTRATION_REPLACED_FUNCTIONS].map(functionRow),
    triggers: ADMINISTRATION_EXISTING_TABLE_TRIGGERS.map((key) => ({ key, function: 'guard', enabled: 'O', definitionHash: 'a'.repeat(32) })),
  };
  const manifest: AdministrationReleaseManifest = { format: 'league-administration-release-v1', expectedOwner: owner,
    postgresVersion: ADMINISTRATION_POSTGRES_VERSION, reviewed: true, observedAt: 'synthetic-generator-fixture', before, after,
    migrations: migrations.map(({ name, sql }) => ({ name, checksum: administrationMigrationChecksum(sql) })) };
  return { migrations, expectedDatabase: 'projection_refactor_test', expectedOwner: owner, manifest };
}

describe('portable administration release bundle safety', () => {
  it('binds every installed 001-015 migration to its accepted checksum without editing historical artifacts', async () => {
    expect(ADMINISTRATION_INSTALLED_LEDGER).toHaveLength(15);
    for (const [name, checksum] of ADMINISTRATION_INSTALLED_LEDGER) {
      expect(administrationMigrationChecksum(await readFile(new URL(`../migrations/${name}`, import.meta.url), 'utf8'))).toBe(checksum);
    }
  });

  it('requires independent review and exact PostgreSQL minor version, owner, migration order and contents', () => {
    const input = syntheticInput();
    for (const manifest of [
      { ...input.manifest, reviewed: false }, { ...input.manifest, postgresVersion: 180005 },
      { ...input.manifest, postgresVersion: 180000 }, { ...input.manifest, expectedOwner: 'wrong_owner' },
    ]) expect(() => buildLeagueAdministrationReleaseWrapper({ ...input, manifest })).toThrow('reviewed PostgreSQL 180006');
    expect(() => buildLeagueAdministrationReleaseWrapper({ ...input, migrations: [...input.migrations].reverse() })).toThrow('name, order, or checksum');
    expect(() => buildLeagueAdministrationReleaseWrapper({ ...input,
      migrations: input.migrations.map((migration, index) => index === 0 ? { ...migration, sql: `${migration.sql}\n-- changed after review` } : migration),
    })).toThrow('name, order, or checksum');
  });

  it('normalizes checkout line endings without accepting changed SQL', () => {
    const input = syntheticInput();
    expect(buildLeagueAdministrationReleaseWrapper({ ...input, migrations: input.migrations.map((migration) => ({ ...migration,
      sql: migration.sql.replace(/\r\n?/gu, '\n').replaceAll('\n', '\r\n') })) }))
      .toBe(buildLeagueAdministrationReleaseWrapper(input));
  });

  it('refuses extra or missing scope in the affected catalog and missing PG18 NOT NULL constraints', () => {
    for (const mutate of [
      (manifest: AdministrationReleaseManifest) => manifest.after.functions.pop(),
      (manifest: AdministrationReleaseManifest) => manifest.after.functions.push(functionRow('unexpected_privileged_function()')),
      (manifest: AdministrationReleaseManifest) => manifest.after.tables.pop(),
      (manifest: AdministrationReleaseManifest) => manifest.after.triggers.pop(),
      (manifest: AdministrationReleaseManifest) => { manifest.after.constraintTypes = [['c', 1]]; },
      (manifest: AdministrationReleaseManifest) => manifest.before.tables.push(manifest.after.tables[0]),
    ]) {
      const input = syntheticInput(); mutate(input.manifest);
      expect(() => buildLeagueAdministrationReleaseWrapper(input)).toThrow('unexpected table, function, trigger, or PostgreSQL 18 constraint');
    }
  });

  it('refuses runtime writes, public access, owner-only function execution, and unsafe definer search paths', () => {
    for (const mutate of [
      (manifest: AdministrationReleaseManifest) => manifest.after.tables[0].runtimePrivileges?.push('INSERT'),
      (manifest: AdministrationReleaseManifest) => manifest.after.tables[0].publicPrivileges.push('SELECT'),
      (manifest: AdministrationReleaseManifest) => { manifest.after.functions[0].publicExecute = true; },
      (manifest: AdministrationReleaseManifest) => { manifest.after.functions[0].runtimeExecute = true; },
      (manifest: AdministrationReleaseManifest) => { manifest.after.functions[0].configuration = ['search_path=public, pg_temp']; },
    ]) {
      const input = syntheticInput(); mutate(input.manifest);
      expect(() => buildLeagueAdministrationReleaseWrapper(input)).toThrow('least-privilege');
    }
  });

  it('places worker barriers and exact baseline checks before SQL, and verifies catalog/history before COMMIT', () => {
    const wrapper = buildLeagueAdministrationReleaseWrapper(syntheticInput());
    const firstMigration = wrapper.indexOf(migrations[0].sql.replace(/\r\n?/gu, '\n').trimEnd());
    expect(firstMigration).toBeGreaterThan(0);
    for (const fragment of ['pg_advisory_xact_lock', 'LOCK TABLE public.projection_jobs',
      'active worker owner', 'expected exactly migrations 001-015', 'installed 015 catalog']) {
      expect(wrapper.indexOf(fragment)).toBeLessThan(firstMigration);
    }
    for (const fragment of ['final migration ledger mismatch', 'final catalog, NOT NULL constraints',
      'changed unaffected functions, triggers, tables, policies, ACLs, roles, or defaults', 'altered historical row counts']) {
      expect(wrapper.indexOf(fragment)).toBeGreaterThan(firstMigration);
      expect(wrapper.indexOf(fragment)).toBeLessThan(wrapper.lastIndexOf('COMMIT;'));
    }
    expect(wrapper).toContain('pregame_projection_baselines');
    expect(wrapper).not.toContain('FROM public.projection_baselines');
    expect(wrapper.indexOf('AS success_sentinel')).toBeGreaterThan(wrapper.lastIndexOf('COMMIT;'));
  });

  it('requires the exact commit sentinel and refuses an ambiguous response', () => {
    const sentinel = administrationReleaseSentinel(migrations);
    expect(requireAdministrationReleaseSentinel([{ success_sentinel: sentinel }], migrations)).toBe(sentinel);
    for (const result of [[], [{ success_sentinel: 'almost' }], [{ outcome: 'committed' }]]) {
      expect(() => requireAdministrationReleaseSentinel(result, migrations)).toThrow('inspect ledger and catalog before retrying');
    }
  });

  it('rejects missing isolated-test authority before loading a database client or touching the harness', () => {
    const result = spawnSync(process.execPath, [fileURLToPath(new URL('./run-league-administration-release-wrapper-integration.mjs', import.meta.url))],
      { env: { NODE_ENV: 'test' }, encoding: 'utf8' });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('exact destructive-test authorization');
    expect(result.stderr).not.toContain('connection');
  });

  it('compares exact function signatures and qualified existing-table trigger keys', () => {
    const unaffected = leagueAdministrationCatalogSql({ affected: false });
    expect(unaffected).toContain('p.proname');
    expect(unaffected).toContain('oidvectortypes(p.proargtypes)');
    expect(unaffected).toContain("t.relname||'.'||tr.tgname");
    expect(unaffected).toContain("c.contype='n'");
    expect(unaffected).toContain('a.attacl');
    expect(unaffected).toContain('p.polwithcheck');
    expect(unaffected).toContain('defaultPrivileges');
  });
});
