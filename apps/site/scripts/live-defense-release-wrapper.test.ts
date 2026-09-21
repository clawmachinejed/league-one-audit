import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ADMINISTRATION_POSTGRES_VERSION } from './league-administration-catalog.mjs';
import { administrationMigrationChecksum, type AdministrationCatalogFunction } from './league-administration-release-wrapper.mjs';
import { LIVE_DEFENSE_FUNCTIONS, LIVE_DEFENSE_REPLACED_FUNCTIONS, LIVE_DEFENSE_RUNTIME_FUNCTIONS,
  LIVE_DEFENSE_INSTALLED_LEDGER, LIVE_DEFENSE_MIGRATIONS, buildLiveDefenseReleaseWrapper,
  liveDefenseCatalogSql, liveDefenseReleaseSentinel, requireLiveDefenseReleaseSentinel,
  type LiveDefenseReleaseManifest } from './live-defense-release-wrapper.mjs';

const migrations = await Promise.all(LIVE_DEFENSE_MIGRATIONS.map(async name => ({ name,
  sql: await readFile(new URL('../migrations/' + name, import.meta.url), 'utf8') })));
const owner = 'neondb_owner';
function functionRow(signature: string, hash: string): AdministrationCatalogFunction {
  const runtime = LIVE_DEFENSE_RUNTIME_FUNCTIONS.includes(signature);
  return { signature, definitionHash: hash.repeat(32), owner, securityDefiner: runtime,
    configuration: ['search_path=pg_catalog, public, pg_temp'], acl: 'synthetic-acl',
    publicExecute: false, runtimeExecute: runtime };
}
function syntheticInput() {
  const manifest: LiveDefenseReleaseManifest = {
    format: 'live-defense-release-v1', postgresVersion: ADMINISTRATION_POSTGRES_VERSION,
    expectedOwner: owner, reviewed: true, observedAt: 'synthetic-unit-fixture-only',
    migrations: migrations.map(({ name, sql }) => ({ name, checksum: administrationMigrationChecksum(sql) })),
    before: { tables: [], triggers: [], constraintTypes: [], functions: LIVE_DEFENSE_REPLACED_FUNCTIONS.map(s => functionRow(s, 'a')) },
    after: { tables: [], triggers: [], constraintTypes: [], functions: LIVE_DEFENSE_FUNCTIONS.map(s => functionRow(s, 'b')) },
    protectedTables: ['all_player_stat_entries', 'current_all_player_score_sets', 'league_administration_heads', 'projection_jobs',
      ...Array.from({ length: 24 }, (_, i) => 'fixture_' + i)], unaffectedConstraintTypes: [['c', 5], ['n', 100]],
  };
  return { migrations, expectedDatabase: 'projection_refactor_test', expectedOwner: owner, manifest };
}

describe('live defense guarded additive release', () => {
  it('pins every installed migration 001 through 018 without modifying it', async () => {
    expect(LIVE_DEFENSE_INSTALLED_LEDGER).toHaveLength(18);
    for (const [name, checksum] of LIVE_DEFENSE_INSTALLED_LEDGER) {
      expect(administrationMigrationChecksum(await readFile(new URL('../migrations/' + name, import.meta.url), 'utf8'))).toBe(checksum);
    }
  });
  it('requires reviewed exact owner, PostgreSQL version and migration checksum', () => {
    const input = syntheticInput();
    for (const manifest of [{ ...input.manifest, reviewed: false }, { ...input.manifest, postgresVersion: 180005 },
      { ...input.manifest, expectedOwner: 'different_owner' }]) {
      expect(() => buildLiveDefenseReleaseWrapper({ ...input, manifest })).toThrow('reviewed PostgreSQL 180006');
    }
    expect(() => buildLiveDefenseReleaseWrapper({ ...input, migrations: [] })).toThrow('Exactly migration 019');
    expect(() => buildLiveDefenseReleaseWrapper({ ...input, migrations: [{ ...migrations[0], sql: migrations[0].sql + '\n-- changed' }] }))
      .toThrow('captured checksum');
  });
  it('keeps the private budget helpers inaccessible and preserves every old function permission', () => {
    for (const mutate of [
      (m: LiveDefenseReleaseManifest) => { m.after.functions.pop(); },
      (m: LiveDefenseReleaseManifest) => { m.before.functions.push(functionRow('unreviewed()', 'b')); },
      (m: LiveDefenseReleaseManifest) => { m.after.constraintTypes = [['n', 1]]; },
    ]) {
      const input = syntheticInput(); mutate(input.manifest);
      expect(() => buildLiveDefenseReleaseWrapper(input)).toThrow('exactly four existing and seven new functions');
    }
    for (const mutate of [
      (m: LiveDefenseReleaseManifest) => { m.after.functions[0].publicExecute = true; },
      (m: LiveDefenseReleaseManifest) => { m.after.functions.find(fn => !fn.runtimeExecute)!.runtimeExecute = true; },
      (m: LiveDefenseReleaseManifest) => { m.after.functions.find(fn => !fn.securityDefiner)!.securityDefiner = true; },
      (m: LiveDefenseReleaseManifest) => { m.after.functions[0].configuration = ['search_path=public']; },
    ]) {
      const input = syntheticInput(); mutate(input.manifest);
      expect(() => buildLiveDefenseReleaseWrapper(input)).toThrow('least-privilege');
    }
    const input = syntheticInput(); input.manifest.after.functions[0].acl = 'changed';
    expect(() => buildLiveDefenseReleaseWrapper(input)).toThrow('preserve existing function metadata');
  });
  it('requires all existing physical tables and PG18 NOT NULL constraints to remain protected', () => {
    for (const mutate of [
      (m: LiveDefenseReleaseManifest) => { m.protectedTables = []; },
      (m: LiveDefenseReleaseManifest) => { m.protectedTables[0] = 'unsafe; DROP'; },
      (m: LiveDefenseReleaseManifest) => { m.protectedTables.push(m.protectedTables[0]); },
      (m: LiveDefenseReleaseManifest) => { m.unaffectedConstraintTypes = [['c', 4]]; },
    ]) {
      const input = syntheticInput(); mutate(input.manifest);
      expect(() => buildLiveDefenseReleaseWrapper(input)).toThrow('complete protected table');
    }
  });
  it('checks ownership before installation and atomically verifies unchanged history and collateral catalogs', () => {
    const wrapper = buildLiveDefenseReleaseWrapper(syntheticInput());
    const start = wrapper.indexOf(migrations[0].sql.replace(/\r\n?/gu, '\n').trimEnd());
    expect(start).toBeGreaterThan(0);
    for (const text of ['LOCK TABLE public.projection_jobs', 'active worker owner', 'expected exactly migrations 001-018',
      'installed 018 catalog', 'protected physical-table inventory mismatch']) {
      expect(wrapper.indexOf(text)).toBeGreaterThan(0); expect(wrapper.indexOf(text)).toBeLessThan(start);
    }
    for (const text of ['constraint manifest mismatch', 'changed unaffected functions, triggers, tables, policies, ACLs, roles, or defaults',
      'altered historical row counts']) {
      expect(wrapper.indexOf(text)).toBeGreaterThan(start); expect(wrapper.indexOf(text)).toBeLessThan(wrapper.lastIndexOf('COMMIT;'));
    }
    expect(wrapper).not.toMatch(/[\t ]+$/mu);
    for (const text of ["c.contype='n'", 'a.attacl', 'p.polwithcheck', 'defaultPrivileges', 'memberships', 'sequences']) {
      expect(liveDefenseCatalogSql({ affected: false })).toContain(text);
    }
  });
  it('emits success only after the committed exact catalog and ledger pass, including same-session retries', () => {
    const wrapper = buildLiveDefenseReleaseWrapper(syntheticInput());
    const reset = wrapper.indexOf("SELECT set_config('league_one.live_defense_release_committed','',false)");
    expect(reset).toBeGreaterThan(0);
    expect(wrapper.indexOf('\nCOMMIT;', reset)).toBeLessThan(wrapper.indexOf('\nBEGIN;'));
    expect(wrapper.lastIndexOf('AS success_sentinel')).toBeGreaterThan(wrapper.lastIndexOf('COMMIT;'));
    expect(requireLiveDefenseReleaseSentinel([{ success_sentinel: liveDefenseReleaseSentinel(migrations) }], migrations))
      .toBe(liveDefenseReleaseSentinel(migrations));
    expect(() => requireLiveDefenseReleaseSentinel([{ outcome: 'committed' }], migrations)).toThrow('inspect ledger');
  });
  it('refuses isolated capture before importing the harness without explicit reset authorization', () => {
    const result = spawnSync(process.execPath, [fileURLToPath(new URL('./run-live-defense-release-wrapper-integration.mjs', import.meta.url))],
      { env: { NODE_ENV: 'test' }, encoding: 'utf8' });
    expect(result.status).not.toBe(0); expect(result.stderr).toContain('exact destructive-test authorization');
  });
});
