import { readFileSync } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { FRESH_INSTALL_PROFILE, qualificationDigest, type QualificationBinding } from './qualification-profile';
import { readFreshInstallSources, type FreshInstallCatalog } from './fresh-install-catalog';
import { assertFreshInstallEmptyEvidence, assertFreshInstallInitialEvidence, assertFreshInstallInstalledEvidence,
  createFreshInstallEmptyEvidence, readFreshInstallEvidence, writeFreshInstallInitialEvidence,
  FRESH_INSTALL_FILES, FRESH_INSTALL_ROLES, type FreshInstallInstalledEvidence, type FreshInstallRole } from './fresh-install-evidence';

const directories: string[] = [];
afterEach(async () => { await Promise.all(directories.splice(0).map(directory => rm(directory, { recursive: true, force: true }))); });
const target = { databaseName: 'fixture_test', branchId: 'br-fixture' };
const roles: FreshInstallRole[] = FRESH_INSTALL_ROLES.map((name, index) => ({ name, oid: String(17000 + index),
  rolcanlogin: true, rolsuper: false, rolcreatedb: false, rolcreaterole: false, rolreplication: false,
  rolinherit: false, rolbypassrls: false, has_memberships: false }));
async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'cp21-evidence-')); directories.push(directory);
  const binding: QualificationBinding = { directory, context: { kind: 'integration-qualification-context-v1',
    runId: '00000000-0000-4000-8000-000000000001', nonce: '00000000-0000-4000-8000-000000000002',
    gitSha: 'a'.repeat(40), profile: FRESH_INSTALL_PROFILE, profileDigest: 'b'.repeat(64),
    modules: [{ path: 'integration/fresh-install.qualification-case.ts', sourceDigest: 'c'.repeat(64) }] } };
  const empty = createFreshInstallEmptyEvidence(binding, { database: target.databaseName, branch: target.branchId,
    owner: 'postgres', session: 'postgres', schemas: 0, relations: 0, functions: 0, types: 0, roles: 0, sessions: 0 }, target, 'postgres');
  const digest = await writeFreshInstallInitialEvidence(binding, empty, roles);
  const initial = JSON.parse(await readFile(join(directory, FRESH_INSTALL_FILES.initial), 'utf8'));
  const frozen = JSON.parse(readFileSync(new URL('./fresh-install-catalog.json', import.meta.url), 'utf8'));
  const catalog: FreshInstallCatalog = { format: 'cp21-installed-catalog-v1', postgresVersion: '180003',
    installer: { name: 'postgres', superuser: true, inherit: true, createRole: true },
    bootstrap: { name: 'postgres', oid: 10, superuser: true }, sections: frozen.catalog,
    membershipEvidence: frozen.catalog.memberships.map((row: Record<string, unknown>) => Object.fromEntries(
      Object.entries(row).map(([key, value]) => [key, value === '$INSTALLER' ? 'postgres' : value]))) };
  const sources = await readFreshInstallSources();
  const installed: FreshInstallInstalledEvidence = { kind: 'fresh-install-installed-v1',
    contextDigest: qualificationDigest(binding.context), runId: binding.context.runId, gitSha: binding.context.gitSha,
    profile: FRESH_INSTALL_PROFILE, ...target, observedAt: new Date().toISOString(), installerRole: 'postgres',
    initialEvidenceDigest: digest, sources, migrationLedger: sources.migrations.map(({ name, checksum }) => ({ name, checksum })), catalog };
  return { binding, empty, initial, installed, digest };
}
it('retains bounded immutable source/run-bound original-empty, new-role and installed artifacts', async () => {
  const f = await fixture();
  await writeFile(join(f.binding.directory, FRESH_INSTALL_FILES.installed), JSON.stringify(f.installed), { flag: 'wx' });
  expect(Buffer.byteLength(JSON.stringify(f.installed))).toBeLessThan(4 * 1024 * 1024);
  await expect(readFreshInstallEvidence(f.binding, target, f.digest)).resolves.toEqual({ initial: f.initial, installed: f.installed });
  await expect(writeFreshInstallInitialEvidence(f.binding, f.empty, roles)).rejects.toThrow();
  await expect(readFreshInstallEvidence(f.binding, target, 'f'.repeat(64))).rejects.toThrow();
});
it('rejects malformed, nonempty, foreign and elevated initial observations', async () => {
  const f = await fixture();
  for (const mutate of [
    (v: typeof f.empty) => { v.empty.roles = 1; }, (v: typeof f.empty) => { v.empty.functions = 1; },
    (v: typeof f.empty) => { v.empty.session = 'another_owner'; }, (v: typeof f.empty) => { v.gitSha = 'f'.repeat(40); },
    (v: typeof f.empty) => { v.runId = '00000000-0000-4000-8000-000000000099'; },
    (v: typeof f.empty) => { v.contextDigest = 'f'.repeat(64); }, (v: typeof f.empty) => { v.branchId = 'br-parent'; },
    (v: typeof f.empty) => { v.observedAt = '2099-01-01T00:00:00.000Z'; },
  ]) { const value = structuredClone(f.empty); mutate(value); expect(() => assertFreshInstallEmptyEvidence(value, f.binding, target)).toThrow(); }
  for (const change of [(v: typeof f.initial) => { v.roles.pop(); }, (v: typeof f.initial) => { v.roles.reverse(); },
    (v: typeof f.initial) => { v.roles[0].oid = v.roles[1].oid; }, (v: typeof f.initial) => { v.roles[0].has_memberships = true; },
    (v: typeof f.initial) => { v.roles[0].rolcanlogin = false; }, (v: typeof f.initial) => { v.roles[0].rolsuper = true; },
    (v: typeof f.initial) => { v.emptyObservedAt = '2099-01-01T00:00:00.000Z'; },
    (v: typeof f.initial) => { v.password = 'must-not-be-retained'; },
  ]) { const value = structuredClone(f.initial); change(value); expect(() => assertFreshInstallInitialEvidence(value, f.binding, target)).toThrow(); }
});
it.each(['missing', 'initial-digest', 'catalog-owner', 'catalog-drift', 'source-drift', 'ledger-drift', 'stale-order', 'future', 'foreign-context'])(
  'rejects %s installed evidence before qualification', async fault => {
    const f = await fixture(), value = structuredClone(f.installed);
    if (fault === 'missing') delete (value as Partial<typeof value>).catalog;
    if (fault === 'initial-digest') value.initialEvidenceDigest = 'e'.repeat(64);
    if (fault === 'catalog-owner') (value.catalog.installer as { name: string }).name = 'different_owner';
    if (fault === 'catalog-drift') (value.catalog.sections.relations as unknown[]).pop();
    if (fault === 'source-drift') (value.sources.migrations[0] as { checksum: string }).checksum = 'f'.repeat(64);
    if (fault === 'ledger-drift') (value.migrationLedger[0] as { checksum: string }).checksum = 'f'.repeat(64);
    if (fault === 'stale-order') value.observedAt = '2020-01-01T00:00:00.000Z';
    if (fault === 'future') value.observedAt = '2099-01-01T00:00:00.000Z';
    if (fault === 'foreign-context') value.contextDigest = 'e'.repeat(64);
    await expect(assertFreshInstallInstalledEvidence(value, f.initial, f.binding, target)).rejects.toThrow();
  });
