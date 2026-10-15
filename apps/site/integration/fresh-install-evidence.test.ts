import { readFileSync } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { FRESH_INSTALL_PROFILE, qualificationDigest, type QualificationBinding } from './qualification-profile';
import { readFreshInstallSources, type FreshInstallCatalog } from './fresh-install-catalog';
import * as catalogModule from './fresh-install-catalog';
import { assertFreshInstallEmptyEvidence, assertFreshInstallInitialEvidence, assertFreshInstallInstalledEvidence,
  createFreshInstallEmptyEvidence, readFreshInstallEvidence, writeFreshInstallInitialEvidence, writeFreshInstallInstalledEvidence,
  FRESH_INSTALL_FILES, FRESH_INSTALL_ROLES, FRESH_INSTALL_INITIAL_DIGEST_ENV, FRESH_INSTALL_DIAGNOSTIC_FILE,
  FRESH_INSTALL_DIAGNOSTIC_MAX_BYTES, type FreshInstallDiagnostic, type FreshInstallInstalledEvidence, type FreshInstallRole } from './fresh-install-evidence';

const directories: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks(); vi.unstubAllEnvs();
  await Promise.all(directories.splice(0).map(directory => rm(directory, { recursive: true, force: true })));
});
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
async function installationFixture() {
  const f = await fixture();
  vi.stubEnv('PROJECTION_INTEGRATION_EXPECTED_DATABASE', target.databaseName);
  vi.stubEnv('PROJECTION_INTEGRATION_EXPECTED_BRANCH_ID', target.branchId);
  vi.stubEnv(FRESH_INSTALL_INITIAL_DIGEST_ENV, f.digest);
  const readCatalog = vi.spyOn(catalogModule, 'readFreshInstallCatalog').mockResolvedValue(f.installed.catalog);
  const query = vi.fn(async (statement: string) => {
    if (statement.startsWith('SELECT current_database()')) return [{ database: target.databaseName,
      owner: 'postgres', session: 'postgres', branch: target.branchId }];
    expect(statement).toBe('SELECT name, checksum FROM public.app_schema_migrations ORDER BY name');
    return f.installed.migrationLedger;
  });
  return { ...f, query, readCatalog };
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

it('writes accepted installation evidence without a failure diagnostic when both frozen comparisons pass', async () => {
  const f = await installationFixture();
  const digest = await writeFreshInstallInstalledEvidence(f.query, f.binding);
  const result = await readFreshInstallEvidence(f.binding, target, f.digest);
  expect(qualificationDigest(result.installed)).toBe(digest);
  expect(result.installed.catalog).toEqual(f.installed.catalog);
  await expect(readFile(join(f.binding.directory, FRESH_INSTALL_DIAGNOSTIC_FILE))).rejects.toMatchObject({ code: 'ENOENT' });
});

it.each(['catalog', 'privileges'] as const)('retains a bound unverified %s mismatch before rejecting installation', async phase => {
  const f = await installationFixture();
  if (phase === 'catalog') f.installed.catalog.sections.policies[0].roles = '{league_one_account}';
  else (f.installed.catalog.sections.tablePrivileges as unknown[]).pop();
  let failure: unknown;
  try { await writeFreshInstallInstalledEvidence(f.query, f.binding); } catch (error) { failure = error; }
  expect(failure).toBeInstanceOf(catalogModule.FreshInstallCatalogMismatchError);
  const serialized = await readFile(join(f.binding.directory, FRESH_INSTALL_DIAGNOSTIC_FILE), 'utf8');
  const diagnostic = JSON.parse(serialized) as FreshInstallDiagnostic;
  expect(diagnostic).toEqual({ kind: 'fresh-install-diagnostic-v1', status: 'unverified',
    contextDigest: qualificationDigest(f.binding.context), runId: f.binding.context.runId, gitSha: f.binding.context.gitSha,
    profile: FRESH_INSTALL_PROFILE, ...target, installerRole: 'postgres', observedAt: expect.any(String),
    initialEvidenceDigest: f.digest, postgresVersion: f.installed.catalog.postgresVersion,
    frozenManifestDigest: catalogModule.FRESH_INSTALL_MANIFEST_SHA256, sourcesDigest: qualificationDigest(f.installed.sources),
    migrationLedgerDigest: qualificationDigest(f.installed.migrationLedger), catalogDigest: qualificationDigest(f.installed.catalog),
    phase, mismatch: (failure as catalogModule.FreshInstallCatalogMismatchError).mismatch });
  expect(diagnostic.observedAt >= f.initial.observedAt && diagnostic.observedAt <= new Date().toISOString()).toBe(true);
  expect(Buffer.byteLength(serialized)).toBeLessThanOrEqual(FRESH_INSTALL_DIAGNOSTIC_MAX_BYTES);
  if (phase === 'catalog') expect(diagnostic.mismatch.policyFields).toContainEqual({ field: 'roles',
    expected: { type: 'array', sha256: expect.stringMatching(/^[a-f0-9]{64}$/u), length: 1 },
    observed: { type: 'string', sha256: expect.stringMatching(/^[a-f0-9]{64}$/u), length: 20 } });
  await expect(readFile(join(f.binding.directory, FRESH_INSTALL_FILES.installed))).rejects.toMatchObject({ code: 'ENOENT' });
  await expect(readFreshInstallEvidence(f.binding, target, f.digest)).rejects.toMatchObject({ code: 'ENOENT' });
  // A diagnostic renamed as installed evidence is still rejected by the accepted-proof validator.
  await writeFile(join(f.binding.directory, FRESH_INSTALL_FILES.installed), serialized, { flag: 'wx' });
  await expect(readFreshInstallEvidence(f.binding, target, f.digest)).rejects.toThrow();
});

it('hashes secret-bearing mismatched policy values without retaining text or error stacks', async () => {
  const f = await installationFixture();
  const secret = `postgresql://private_role:private_password@private-host/db?token=private_token ${'private_function_body '.repeat(10000)}`;
  for (const row of f.installed.catalog.sections.policies) {
    row.roles = secret; row.using_expression = secret; row.check_expression = secret;
    row.unexpected_secret = secret;
  }
  await expect(writeFreshInstallInstalledEvidence(f.query, f.binding)).rejects.toBeInstanceOf(catalogModule.FreshInstallCatalogMismatchError);
  const serialized = await readFile(join(f.binding.directory, FRESH_INSTALL_DIAGNOSTIC_FILE), 'utf8');
  for (const marker of ['postgresql:', 'private_role', 'private_password', 'private-host', 'private_token',
    'private_function_body', 'unexpected_secret', 'stack', 'message']) expect(serialized).not.toContain(marker);
  expect(Buffer.byteLength(serialized)).toBeLessThan(FRESH_INSTALL_DIAGNOSTIC_MAX_BYTES);
  expect(JSON.parse(serialized).mismatch.policyFields.map((field: { field: string }) => field.field))
    .toEqual(['roles', 'using_expression', 'check_expression']);
});

it('preserves an existing diagnostic and fails closed if exclusive diagnostic persistence fails', async () => {
  const f = await installationFixture();
  (f.installed.catalog.sections.relations as unknown[]).pop();
  const path = join(f.binding.directory, FRESH_INSTALL_DIAGNOSTIC_FILE);
  const original = '{"original":"immutable diagnostic"}';
  await writeFile(path, original, { flag: 'wx' });
  await expect(writeFreshInstallInstalledEvidence(f.query, f.binding)).rejects.toMatchObject({
    message: 'Fresh installation catalog mismatch; diagnostic persistence failed.',
    cause: expect.any(catalogModule.FreshInstallCatalogMismatchError),
  });
  expect(await readFile(path, 'utf8')).toBe(original);
  await expect(readFile(join(f.binding.directory, FRESH_INSTALL_FILES.installed))).rejects.toMatchObject({ code: 'ENOENT' });
});

it('preserves an unrelated catalog-read error without inventing a mismatch diagnostic', async () => {
  const f = await installationFixture();
  const failure = new Error('catalog reader failed'); f.readCatalog.mockRejectedValue(failure);
  await expect(writeFreshInstallInstalledEvidence(f.query, f.binding)).rejects.toBe(failure);
  await expect(readFile(join(f.binding.directory, FRESH_INSTALL_DIAGNOSTIC_FILE))).rejects.toMatchObject({ code: 'ENOENT' });
  await expect(readFile(join(f.binding.directory, FRESH_INSTALL_FILES.installed))).rejects.toMatchObject({ code: 'ENOENT' });
});
