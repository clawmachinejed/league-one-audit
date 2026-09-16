import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ADMINISTRATION_POSTGRES_VERSION } from './league-administration-catalog.mjs';
import { ADMINISTRATION_MIGRATIONS, administrationMigrationChecksum, buildLeagueAdministrationReleaseWrapper,
  type AdministrationCatalogFunction, type AdministrationReleaseManifest } from './league-administration-release-wrapper.mjs';
import { PARTIAL_CONTEXT_FUNCTIONS, PARTIAL_CONTEXT_INSTALLED_LEDGER, PARTIAL_CONTEXT_MIGRATIONS,
  buildAllPlayerPartialContextReleaseWrapper, partialContextCatalogSql, partialContextReleaseSentinel,
  requirePartialContextReleaseSentinel, type PartialContextReleaseManifest } from './all-player-partial-context-release-wrapper.mjs';

const migrations = await Promise.all(PARTIAL_CONTEXT_MIGRATIONS.map(async name => ({ name,
  sql: await readFile(new URL('../migrations/' + name, import.meta.url), 'utf8') })));
const owner = 'neondb_owner';
function functionRow(signature: string, hash: string): AdministrationCatalogFunction {
  return { signature, definitionHash: hash.repeat(32), owner, securityDefiner: true,
    configuration: ['search_path=pg_catalog, public, pg_temp'], acl: 'synthetic-acl',
    publicExecute: false, runtimeExecute: signature.startsWith('finish_all_player_job(') };
}
function syntheticInput() {
  const manifest: PartialContextReleaseManifest = {
    format: 'all-player-partial-context-release-v1', postgresVersion: ADMINISTRATION_POSTGRES_VERSION,
    expectedOwner: owner, reviewed: true, observedAt: 'synthetic-unit-fixture-only',
    migrations: migrations.map(({ name, sql }) => ({ name, checksum: administrationMigrationChecksum(sql) })),
    before: { tables: [], triggers: [], constraintTypes: [], functions: PARTIAL_CONTEXT_FUNCTIONS.map(s => functionRow(s, 'a')) },
    after: { tables: [], triggers: [], constraintTypes: [], functions: PARTIAL_CONTEXT_FUNCTIONS.map(s => functionRow(s, 'b')) },
    protectedTables: ['all_player_stat_entries', 'current_all_player_score_sets', 'league_administration_heads', 'projection_jobs',
      ...Array.from({ length: 24 }, (_, i) => 'fixture_' + i)],
    unaffectedConstraintTypes: [['c', 5], ['n', 100]],
  };
  return { migrations, expectedDatabase: 'projection_refactor_test', expectedOwner: owner, manifest };
}

describe('all-player partial-context guarded release', () => {
  it('pins every installed migration 001 through 017', async () => {
    expect(PARTIAL_CONTEXT_INSTALLED_LEDGER).toHaveLength(17);
    for (const [name, checksum] of PARTIAL_CONTEXT_INSTALLED_LEDGER) {
      expect(administrationMigrationChecksum(await readFile(new URL('../migrations/' + name, import.meta.url), 'utf8'))).toBe(checksum);
    }
  });

  it('requires exact review, owner, PostgreSQL version, migration name and checksum', () => {
    const input = syntheticInput();
    for (const manifest of [
      { ...input.manifest, reviewed: false }, { ...input.manifest, postgresVersion: 180005 },
      { ...input.manifest, expectedOwner: 'different_owner' },
    ]) expect(() => buildAllPlayerPartialContextReleaseWrapper({ ...input, manifest })).toThrow('reviewed PostgreSQL 180006');
    expect(() => buildAllPlayerPartialContextReleaseWrapper({ ...input, migrations: [] })).toThrow('Exactly migration 018');
    expect(() => buildAllPlayerPartialContextReleaseWrapper({ ...input,
      migrations: [{ ...input.migrations[0], sql: input.migrations[0].sql + '\n-- changed' }],
    })).toThrow('captured checksum');
  });

  it('requires the protected physical-table and PG18 NOT NULL inventories', () => {
    for (const mutate of [
      (m: PartialContextReleaseManifest) => { m.protectedTables = []; },
      (m: PartialContextReleaseManifest) => { m.protectedTables[0] = 'unsafe; DROP'; },
      (m: PartialContextReleaseManifest) => { m.protectedTables.push(m.protectedTables[0]); },
      (m: PartialContextReleaseManifest) => { m.unaffectedConstraintTypes = [['c', 4]]; },
    ]) {
      const input = syntheticInput(); mutate(input.manifest);
      expect(() => buildAllPlayerPartialContextReleaseWrapper(input)).toThrow('complete protected table');
    }
  });

  it('restricts changes to exactly two existing function bodies and preserves permissions', () => {
    for (const mutate of [
      (m: PartialContextReleaseManifest) => { m.after.functions.pop(); },
      (m: PartialContextReleaseManifest) => { m.after.functions.push(functionRow('unreviewed_function()', 'b')); },
      (m: PartialContextReleaseManifest) => { m.after.constraintTypes = [['n', 1]]; },
    ]) {
      const input = syntheticInput(); mutate(input.manifest);
      expect(() => buildAllPlayerPartialContextReleaseWrapper(input)).toThrow('exactly its two existing functions');
    }
    for (const mutate of [
      (m: PartialContextReleaseManifest) => { m.after.functions[0].publicExecute = true; },
      (m: PartialContextReleaseManifest) => { m.after.functions[0].runtimeExecute = true; },
      (m: PartialContextReleaseManifest) => { m.after.functions[0].securityDefiner = false; },
      (m: PartialContextReleaseManifest) => { m.after.functions[0].configuration = ['search_path=public']; },
    ]) {
      const input = syntheticInput(); mutate(input.manifest);
      expect(() => buildAllPlayerPartialContextReleaseWrapper(input)).toThrow('least-privilege');
    }
    const input = syntheticInput(); input.manifest.after.functions[0].acl = 'changed';
    expect(() => buildAllPlayerPartialContextReleaseWrapper(input)).toThrow('function bodies only');
  });

  it('reuses exact ownership barriers, full unaffected catalogs and transactionally checked history counts', () => {
    const input = syntheticInput(), wrapper = buildAllPlayerPartialContextReleaseWrapper(input);
    const start = wrapper.indexOf(migrations[0].sql.replace(/\r\n?/gu, '\n').trimEnd());
    expect(start).toBeGreaterThan(0);
    for (const text of ['LOCK TABLE public.projection_jobs', 'active worker owner',
      'expected exactly migrations 001-017', 'installed 017 catalog', 'protected physical-table inventory mismatch']) {
      expect(wrapper.indexOf(text)).toBeGreaterThan(0);
      expect(wrapper.indexOf(text)).toBeLessThan(start);
    }
    for (const text of ['constraint manifest mismatch', 'changed unaffected functions, triggers, tables, policies, ACLs, roles, or defaults',
      'altered historical row counts']) {
      expect(wrapper.indexOf(text)).toBeGreaterThan(start);
      expect(wrapper.indexOf(text)).toBeLessThan(wrapper.lastIndexOf('COMMIT;'));
    }
    expect(wrapper).toContain('DO $partial_context_before$');
    expect(wrapper).toContain('END; $partial_context_after$;');
    expect(wrapper).not.toMatch(/[\t ]+$/mu);
    const catalog = partialContextCatalogSql({ affected: false });
    for (const text of ["c.contype='n'", 'a.attacl', 'p.polwithcheck', 'defaultPrivileges', 'memberships', 'sequences']) {
      expect(catalog).toContain(text);
    }
  });

  it('clears same-session markers before the transaction and requires the committed exact sentinel', () => {
    const input = syntheticInput(), wrapper = buildAllPlayerPartialContextReleaseWrapper(input);
    const reset = wrapper.indexOf("SELECT set_config('league_one.partial_context_release_committed','',false)");
    expect(reset).toBeGreaterThan(0);
    expect(wrapper.indexOf('\nCOMMIT;', reset)).toBeLessThan(wrapper.indexOf('\nBEGIN;'));
    expect(wrapper.indexOf("PERFORM set_config('league_one.partial_context_release_committed'"))
      .toBeGreaterThan(wrapper.indexOf('altered historical row counts'));
    expect(wrapper.lastIndexOf('AS success_sentinel')).toBeGreaterThan(wrapper.lastIndexOf('COMMIT;'));
    expect(requirePartialContextReleaseSentinel([{ success_sentinel: partialContextReleaseSentinel(migrations) }], migrations))
      .toBe(partialContextReleaseSentinel(migrations));
    expect(() => requirePartialContextReleaseSentinel([{ outcome: 'committed' }], migrations)).toThrow('inspect ledger');
  });

  it('preserves the exact historical 016/017 production wrapper after extracting shared internals', async () => {
    const historical = await readFile(new URL('../release/league-administration/016-017.production.sql', import.meta.url), 'utf8');
    const manifest = JSON.parse(await readFile(new URL('../release/league-administration/catalog.integration.json', import.meta.url), 'utf8')) as AdministrationReleaseManifest;
    const oldMigrations = await Promise.all(ADMINISTRATION_MIGRATIONS.map(async name => ({ name,
      sql: await readFile(new URL('../migrations/' + name, import.meta.url), 'utf8') })));
    expect(buildLeagueAdministrationReleaseWrapper({ migrations: oldMigrations, manifest,
      expectedDatabase: 'neondb', expectedOwner: owner })).toBe(historical.replace(/\r\n?/gu, '\n'));
  });

  it('refuses isolated capture before importing the harness without exact authorization', () => {
    const result = spawnSync(process.execPath, [fileURLToPath(new URL('./run-all-player-partial-context-release-wrapper-integration.mjs', import.meta.url))],
      { env: { NODE_ENV: 'test' }, encoding: 'utf8' });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('exact destructive-test authorization');
  });
});

