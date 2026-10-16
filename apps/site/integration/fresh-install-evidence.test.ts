import { readFileSync } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { FRESH_INSTALL_PROFILE, qualificationDigest, type QualificationBinding } from './qualification-profile';
import { readFreshInstallSources, type FreshInstallCatalog, type FreshInstallSources } from './fresh-install-catalog';
import * as catalogModule from './fresh-install-catalog';
import { assertFreshInstallEmptyEvidence, assertFreshInstallInitialEvidence, assertFreshInstallInstalledEvidence,
  createFreshInstallEmptyEvidence, readFreshInstallEvidence, writeFreshInstallInitialEvidence, writeFreshInstallInstalledEvidence,
  FRESH_INSTALL_FILES, FRESH_INSTALL_ROLES, FRESH_INSTALL_INITIAL_DIGEST_ENV, FRESH_INSTALL_DIAGNOSTIC_FILE,
  FRESH_INSTALL_DIAGNOSTIC_MAX_BYTES, type FreshInstallDiagnostic, type FreshInstallInstalledEvidence, type FreshInstallRole } from './fresh-install-evidence';

const directories: string[] = [];
type ComparisonDiagnostic = Extract<FreshInstallDiagnostic, { phase: 'comparison' }>;
type PlatformDiagnostic = Extract<FreshInstallDiagnostic, { phase: 'platform-witness' }>;
afterEach(async () => {
  vi.restoreAllMocks(); vi.unstubAllEnvs();
  await Promise.all(directories.splice(0).map(directory => rm(directory, { recursive: true, force: true })));
});
const target = { databaseName: 'fixture_test', branchId: 'br-fixture' };
const roles: FreshInstallRole[] = FRESH_INSTALL_ROLES.map((name, index) => ({ name, oid: String(17000 + index),
  rolcanlogin: true, rolsuper: false, rolcreatedb: false, rolcreaterole: false, rolreplication: false,
  rolinherit: false, rolbypassrls: false, has_memberships: false }));
async function fixture(provider = true, nonsuper = provider) {
  const frozen = JSON.parse(readFileSync(new URL('./fresh-install-catalog.json', import.meta.url), 'utf8'));
  const historicalSources: FreshInstallSources = { migrations: frozen.migrations, provisioners: frozen.provisioners };
  vi.spyOn(catalogModule, 'readFreshInstallSources').mockImplementation(async () => structuredClone(historicalSources));
  const installer = nonsuper ? 'neondb_owner' : 'postgres';
  const directory = await mkdtemp(join(tmpdir(), 'cp21-evidence-')); directories.push(directory);
  const binding: QualificationBinding = { directory, context: { kind: 'integration-qualification-context-v1',
    runId: '00000000-0000-4000-8000-000000000001', nonce: '00000000-0000-4000-8000-000000000002',
    gitSha: 'a'.repeat(40), profile: FRESH_INSTALL_PROFILE, profileDigest: 'b'.repeat(64),
    modules: [{ path: 'integration/fresh-install.qualification-case.ts', sourceDigest: 'c'.repeat(64) }] } };
  const empty = createFreshInstallEmptyEvidence(binding, { database: target.databaseName, branch: target.branchId,
    owner: installer, session: installer, schemas: 0, relations: 0, functions: 0, types: 0, roles: 0, sessions: 0 }, target, installer);
  const digest = await writeFreshInstallInitialEvidence(binding, empty, roles);
  const initial = JSON.parse(await readFile(join(directory, FRESH_INSTALL_FILES.initial), 'utf8'));
  const sections = frozen.catalog as Record<string, Record<string, unknown>[]>;
  if (nonsuper) {
    const extensions = new Set(sections.functions.filter(row => row.extension === 'pgcrypto').map(row => row.signature));
    for (const row of sections.functions) if (extensions.has(row.signature)) row.owner = '$BOOTSTRAP';
    for (const row of sections.functionAcl) if (extensions.has(row.signature)) {
      if (row.grantee === '$INSTALLER') row.grantee = '$BOOTSTRAP';
      if (row.grantor === '$INSTALLER') row.grantor = '$BOOTSTRAP';
    }
    sections.memberships.push(...FRESH_INSTALL_ROLES.map(role => ({ role, member: '$INSTALLER', grantor: '$BOOTSTRAP',
      admin_option: true, inherit_option: false, set_option: false })));
  }
  if (provider) {
    sections.databaseAcl.push(...['CONNECT', 'CREATE', 'TEMPORARY'].map(privilege => ({ database: '$DATABASE',
      owner: '$INSTALLER', grantee: 'neon_superuser', grantor: '$INSTALLER', privilege, grantable: false })));
  }
  const catalog: FreshInstallCatalog = { format: 'cp21-installed-catalog-v1', postgresVersion: '180003',
    installer: { name: installer, superuser: !nonsuper, inherit: true, createRole: true },
    bootstrap: { name: 'postgres', oid: 10, superuser: true }, sections,
    databasePlatform: provider ? { kind: 'neon', branchId: target.branchId, databaseOwner: installer,
      role: { name: 'neon_superuser', superuser: false, inherit: true, createDb: true, createRole: true,
        login: false, replication: true, bypassRls: true }, installer: { member: true, usage: true },
      applicationRoles: FRESH_INSTALL_ROLES.map(role => ({ role, member: false, usage: false })) } : null,
    membershipEvidence: sections.memberships.map(row => Object.fromEntries(
      Object.entries(row).map(([key, value]) => [key, value === '$INSTALLER' ? installer : value === '$BOOTSTRAP' ? 'postgres' : value]))) };
  const sources = await readFreshInstallSources();
  const installed: FreshInstallInstalledEvidence = { kind: 'fresh-install-installed-v1',
    contextDigest: qualificationDigest(binding.context), runId: binding.context.runId, gitSha: binding.context.gitSha,
    profile: FRESH_INSTALL_PROFILE, ...target, observedAt: new Date().toISOString(), installerRole: installer,
    initialEvidenceDigest: digest, sources, migrationLedger: sources.migrations.map(({ name, checksum }) => ({ name, checksum })), catalog };
  return { binding, empty, initial, installed, digest };
}
async function installationFixture(provider = true, nonsuper = provider) {
  const f = await fixture(provider, nonsuper);
  vi.stubEnv('PROJECTION_INTEGRATION_EXPECTED_DATABASE', target.databaseName);
  vi.stubEnv('PROJECTION_INTEGRATION_EXPECTED_BRANCH_ID', target.branchId);
  vi.stubEnv(FRESH_INSTALL_INITIAL_DIGEST_ENV, f.digest);
  const readCatalog = vi.spyOn(catalogModule, 'readFreshInstallCatalog').mockResolvedValue(f.installed.catalog);
  const query = vi.fn(async (statement: string) => {
    if (statement.startsWith('SELECT current_database()')) return [{ database: target.databaseName,
      owner: f.initial.installerRole, session: f.initial.installerRole, branch: target.branchId }];
    expect(statement).toBe('SELECT name, checksum FROM public.app_schema_migrations ORDER BY name');
    return f.installed.migrationLedger;
  });
  return { ...f, query, readCatalog };
}
it('rejects current installation drift before selecting historical CP21 fixture sources', async () => {
  expect(vi.isMockFunction(catalogModule.readFreshInstallSources)).toBe(false);
  await expect(catalogModule.readFreshInstallSources()).rejects.toThrow('migration file inventory changed');
});
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

it('writes accepted installation evidence without a diagnostic for a strictly matched Neon catalog', async () => {
  const f = await installationFixture();
  const digest = await writeFreshInstallInstalledEvidence(f.query, f.binding);
  const result = await readFreshInstallEvidence(f.binding, target, f.digest);
  expect(qualificationDigest(result.installed)).toBe(digest);
  expect(result.installed.catalog).toEqual(f.installed.catalog);
  await expect(readFile(join(f.binding.directory, FRESH_INSTALL_DIAGNOSTIC_FILE))).rejects.toMatchObject({ code: 'ENOENT' });
});

it('rejects replay of an otherwise exact standalone eight-row ACL catalog against the bound Neon child', async () => {
  const f = await installationFixture(false, true);
  expect(f.installed.catalog.databasePlatform).toBeNull();
  expect(f.installed.catalog.sections.databaseAcl).toHaveLength(8);
  expect(() => catalogModule.assertFreshInstallInstalledCatalog(f.installed.catalog)).not.toThrow();
  await expect(writeFreshInstallInstalledEvidence(f.query, f.binding)).rejects.toBeInstanceOf(catalogModule.FreshInstallDatabasePlatformError);
  const diagnostic: PlatformDiagnostic = JSON.parse(await readFile(join(f.binding.directory, FRESH_INSTALL_DIAGNOSTIC_FILE), 'utf8'));
  expect(diagnostic).toMatchObject({ phase: 'platform-witness', snapshotComplete: true,
    platformWitness: { issues: [{ field: 'databasePlatform', requirement: 'required', observed: { value: null } }] } });
  await expect(readFile(join(f.binding.directory, FRESH_INSTALL_FILES.installed))).rejects.toMatchObject({ code: 'ENOENT' });
  await writeFile(join(f.binding.directory, FRESH_INSTALL_FILES.installed), JSON.stringify(f.installed), { flag: 'wx' });
  await expect(readFreshInstallEvidence(f.binding, target, f.digest)).rejects.toBeInstanceOf(catalogModule.FreshInstallDatabasePlatformError);
});

it('rejects a valid provider witness for a foreign branch before writing or accepting installed evidence', async () => {
  const f = await installationFixture(true);
  (f.installed.catalog.databasePlatform as { branchId: string }).branchId = 'br-different-child';
  expect(() => catalogModule.assertFreshInstallInstalledCatalog(f.installed.catalog)).not.toThrow();
  await expect(writeFreshInstallInstalledEvidence(f.query, f.binding)).rejects.toBeInstanceOf(catalogModule.FreshInstallDatabasePlatformError);
  const diagnostic: PlatformDiagnostic = JSON.parse(await readFile(join(f.binding.directory, FRESH_INSTALL_DIAGNOSTIC_FILE), 'utf8'));
  expect(diagnostic).toMatchObject({ phase: 'platform-witness', status: 'unverified', snapshotComplete: true,
    catalogDigest: qualificationDigest(f.installed.catalog), branchId: target.branchId,
    platformWitness: { issues: [{ field: 'branchId', requirement: 'equals',
      expected: { value: target.branchId }, observed: { value: 'br-different-child' } }] } });
  expect(diagnostic).not.toHaveProperty('comparison'); expect(diagnostic).not.toHaveProperty('mismatch');
  await expect(readFile(join(f.binding.directory, FRESH_INSTALL_FILES.installed))).rejects.toMatchObject({ code: 'ENOENT' });
  await writeFile(join(f.binding.directory, FRESH_INSTALL_FILES.installed), JSON.stringify(f.installed), { flag: 'wx' });
  await expect(readFreshInstallEvidence(f.binding, target, f.digest)).rejects.toThrow();
});

it.each(['catalog', 'privileges'] as const)('retains a bound unverified %s mismatch before rejecting installation', async phase => {
  const f = await installationFixture();
  if (phase === 'catalog') f.installed.catalog.sections.policies[0].roles = '{league_one_account}';
  else (f.installed.catalog.sections.tablePrivileges as unknown[]).pop();
  let failure: unknown;
  try { await writeFreshInstallInstalledEvidence(f.query, f.binding); } catch (error) { failure = error; }
  expect(failure).toBeInstanceOf(catalogModule.FreshInstallCatalogMismatchError);
  const serialized = await readFile(join(f.binding.directory, FRESH_INSTALL_DIAGNOSTIC_FILE), 'utf8');
  const diagnostic = JSON.parse(serialized) as ComparisonDiagnostic;
  expect(diagnostic).toEqual({ kind: 'fresh-install-diagnostic-v2', status: 'unverified',
    contextDigest: qualificationDigest(f.binding.context), runId: f.binding.context.runId, gitSha: f.binding.context.gitSha,
    profile: FRESH_INSTALL_PROFILE, ...target, installerRole: f.initial.installerRole, observedAt: expect.any(String),
    initialEvidenceDigest: f.digest, postgresVersion: f.installed.catalog.postgresVersion,
    frozenManifestDigest: catalogModule.FRESH_INSTALL_MANIFEST_SHA256, sourcesDigest: qualificationDigest(f.installed.sources),
    migrationLedgerDigest: qualificationDigest(f.installed.migrationLedger), catalogDigest: qualificationDigest(f.installed.catalog),
    phase: 'comparison', snapshotComplete: true, mismatch: (failure as catalogModule.FreshInstallCatalogMismatchError).mismatch,
    comparison: (failure as catalogModule.FreshInstallCatalogMismatchError).diagnostic });
  expect(diagnostic.observedAt >= f.initial.observedAt && diagnostic.observedAt <= new Date().toISOString()).toBe(true);
  expect(Buffer.byteLength(serialized)).toBeLessThanOrEqual(FRESH_INSTALL_DIAGNOSTIC_MAX_BYTES);
  expect(diagnostic.comparison.sections).toHaveLength(29);
  expect(diagnostic.comparison.sections.filter(section => section.status === 'different').map(section => section.section))
    .toEqual([phase === 'catalog' ? 'policies' : 'tablePrivileges']);
  if (phase === 'catalog') expect(diagnostic.comparison.sections.find(section => section.section === 'policies')?.firstDifference?.policyFields).toContainEqual({ field: 'roles',
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
  expect(JSON.parse(serialized).comparison.sections.find((section: { section: string }) => section.section === 'policies')
    .firstDifference.policyFields.map((field: { field: string }) => field.field))
    .toEqual(['roles', 'using_expression', 'check_expression']);
});

it('retains exact ACL differences alongside simultaneous structural privilege and membership mismatches', async () => {
  const f = await installationFixture();
  const acl = f.installed.catalog.sections.databaseAcl as Record<string, unknown>[];
  const missing = acl.shift()!;
  const before = { ...acl[0] }; acl[0] = { ...before, grantable: !before.grantable };
  const extra = { ...before, grantee: 'cp21_unfamiliar_reader', grantor: '$INSTALLER', privilege: 'CONNECT', grantable: false };
  acl.push(extra);
  f.installed.catalog.sections.relations[0].rls = !f.installed.catalog.sections.relations[0].rls;
  f.installed.catalog.sections.schemaPrivileges[0].create = !f.installed.catalog.sections.schemaPrivileges[0].create;
  f.installed.catalog.membershipEvidence[0].set_option = false;
  await expect(writeFreshInstallInstalledEvidence(f.query, f.binding)).rejects.toBeInstanceOf(catalogModule.FreshInstallCatalogMismatchError);
  const diagnostic: ComparisonDiagnostic = JSON.parse(await readFile(join(f.binding.directory, FRESH_INSTALL_DIAGNOSTIC_FILE), 'utf8'));
  expect(diagnostic.comparison.truncated).toBe(false);
  expect(diagnostic.comparison.sections.filter(section => section.status === 'different').map(section => section.section))
    .toEqual(['relations', 'databaseAcl', 'schemaPrivileges', 'membershipEvidence']);
  const section = diagnostic.comparison.sections.find(section => section.section === 'databaseAcl')!;
  expect(section).toMatchObject({ missingRows: 1, extraRows: 1, changedRows: 1, omitted: { missing: 0, extra: 0, changed: 0 } });
  expect(section.details.missing[0].digest).toBe(qualificationDigest(missing));
  expect(section.details.extra[0].digest).toBe(qualificationDigest(extra));
  expect(Object.fromEntries(section.details.extra[0].fields.map(field => [field.name, field.value]))).toEqual(extra);
  expect(section.details.changed[0].expected.digest).toBe(qualificationDigest(before));
  expect(section.details.changed[0].observed.fields.find(field => field.name === 'grantable')?.value).toBe(!before.grantable);
  await expect(readFile(join(f.binding.directory, FRESH_INSTALL_FILES.installed))).rejects.toMatchObject({ code: 'ENOENT' });
});

it('retains all section summaries with explicit omissions under the final 64KiB artifact limit', async () => {
  const f = await installationFixture();
  for (const rows of [...Object.values(f.installed.catalog.sections), f.installed.catalog.membershipEvidence]) {
    for (let index = 0; index < 40; index++) (rows as Record<string, unknown>[]).push({ ...rows[0], unrecognized_field: index });
  }
  await expect(writeFreshInstallInstalledEvidence(f.query, f.binding)).rejects.toBeInstanceOf(catalogModule.FreshInstallCatalogMismatchError);
  const serialized = await readFile(join(f.binding.directory, FRESH_INSTALL_DIAGNOSTIC_FILE), 'utf8');
  const diagnostic: ComparisonDiagnostic = JSON.parse(serialized);
  expect(Buffer.byteLength(serialized)).toBeLessThanOrEqual(FRESH_INSTALL_DIAGNOSTIC_MAX_BYTES);
  expect(diagnostic.comparison.sections).toHaveLength(29);
  expect(diagnostic.comparison.truncated).toBe(true);
  expect(diagnostic.comparison.sections.every(section => section.status === 'different')).toBe(true);
  expect(diagnostic.comparison.sections.some(section => section.omitted.extra > 0)).toBe(true);
  for (const section of diagnostic.comparison.sections) {
    expect(section.extraRows).toBe(40);
    expect(section.details.extra.length + section.omitted.extra).toBe(section.extraRows);
    expect(section.details.missing.length + section.omitted.missing).toBe(section.missingRows);
    expect(section.details.changed.length + section.omitted.changed).toBe(section.changedRows);
  }
  expect(serialized).not.toContain('unrecognized_field');
  await expect(readFile(join(f.binding.directory, FRESH_INSTALL_FILES.installed))).rejects.toMatchObject({ code: 'ENOENT' });
});

it.each(['comparison', 'platform-witness'] as const)('preserves an existing diagnostic and fails closed on %s diagnostic persistence failure', async phase => {
  const f = await installationFixture();
  if (phase === 'comparison') (f.installed.catalog.sections.relations as unknown[]).pop();
  else (f.installed.catalog.databasePlatform!.role as { login: boolean }).login = true;
  const path = join(f.binding.directory, FRESH_INSTALL_DIAGNOSTIC_FILE);
  const original = '{"original":"immutable diagnostic"}';
  await writeFile(path, original, { flag: 'wx' });
  await expect(writeFreshInstallInstalledEvidence(f.query, f.binding)).rejects.toMatchObject({
    message: 'Fresh installation catalog mismatch; diagnostic persistence failed.',
    cause: expect.any(phase === 'comparison' ? catalogModule.FreshInstallCatalogMismatchError : catalogModule.FreshInstallDatabasePlatformError),
  });
  expect(await readFile(path, 'utf8')).toBe(original);
  await expect(readFile(join(f.binding.directory, FRESH_INSTALL_FILES.installed))).rejects.toMatchObject({ code: 'ENOENT' });
});

it.each(['reader', 'snapshot'] as const)('retains typed platform issues with accurate %s availability and no invented comparison', async stage => {
  const f = await installationFixture(true);
  const platform = f.installed.catalog.databasePlatform!;
  (platform.role as { login: boolean }).login = true;
  (platform as { databaseOwner: string }).databaseOwner = 'different_owner';
  (platform.applicationRoles[0] as { usage: boolean }).usage = true;
  let failure: unknown;
  try { catalogModule.assertFreshInstallInstalledCatalog(f.installed.catalog); } catch (error) { failure = error; }
  expect(failure).toBeInstanceOf(catalogModule.FreshInstallDatabasePlatformError);
  if (stage === 'reader') f.readCatalog.mockRejectedValue(failure);
  await expect(writeFreshInstallInstalledEvidence(f.query, f.binding)).rejects.toBeInstanceOf(catalogModule.FreshInstallDatabasePlatformError);
  const serialized = await readFile(join(f.binding.directory, FRESH_INSTALL_DIAGNOSTIC_FILE), 'utf8');
  const diagnostic: PlatformDiagnostic = JSON.parse(serialized);
  expect(diagnostic).toEqual({ kind: 'fresh-install-diagnostic-v2', status: 'unverified',
    contextDigest: qualificationDigest(f.binding.context), runId: f.binding.context.runId, gitSha: f.binding.context.gitSha,
    profile: FRESH_INSTALL_PROFILE, ...target, installerRole: 'neondb_owner', observedAt: expect.any(String),
    initialEvidenceDigest: f.digest, postgresVersion: f.installed.catalog.postgresVersion,
    frozenManifestDigest: catalogModule.FRESH_INSTALL_MANIFEST_SHA256, sourcesDigest: qualificationDigest(f.installed.sources),
    migrationLedgerDigest: qualificationDigest(f.installed.migrationLedger),
    phase: 'platform-witness', snapshotComplete: stage === 'snapshot',
    catalogDigest: stage === 'snapshot' ? qualificationDigest(f.installed.catalog) : null,
    platformWitness: (failure as catalogModule.FreshInstallDatabasePlatformError).diagnostic });
  expect(diagnostic.platformWitness.issues.map(issue => [issue.field, issue.expected.value, issue.observed.value]))
    .toEqual([['databaseOwner', 'neondb_owner', 'different_owner'], ['role.login', false, true], ['applicationRoles[0].usage', false, true]]);
  expect(diagnostic).not.toHaveProperty('comparison'); expect(diagnostic).not.toHaveProperty('mismatch');
  expect(Buffer.byteLength(serialized)).toBeLessThanOrEqual(FRESH_INSTALL_DIAGNOSTIC_MAX_BYTES);
  expect(diagnostic.observedAt >= f.initial.observedAt && diagnostic.observedAt <= new Date().toISOString()).toBe(true);
  await expect(readFile(join(f.binding.directory, FRESH_INSTALL_FILES.installed))).rejects.toMatchObject({ code: 'ENOENT' });
  await writeFile(join(f.binding.directory, FRESH_INSTALL_FILES.installed), serialized, { flag: 'wx' });
  await expect(readFreshInstallEvidence(f.binding, target, f.digest)).rejects.toThrow();
});

it('hashes unsafe platform values and reports unavailable version without forwarding raw error data', async () => {
  const f = await installationFixture(true);
  const secret = 'postgresql://private_role:private_password@private-host/db?token=private_token';
  (f.installed.catalog.databasePlatform!.role as { name: string }).name = secret;
  (f.installed.catalog as { postgresVersion: string }).postgresVersion = secret;
  let failure: unknown;
  try { catalogModule.assertFreshInstallDatabasePlatformBranch(f.installed.catalog, target.branchId); } catch (error) { failure = error; }
  expect(failure).toBeInstanceOf(catalogModule.FreshInstallDatabasePlatformError);
  f.readCatalog.mockRejectedValue(failure);
  await expect(writeFreshInstallInstalledEvidence(f.query, f.binding)).rejects.toBe(failure);
  const serialized = await readFile(join(f.binding.directory, FRESH_INSTALL_DIAGNOSTIC_FILE), 'utf8');
  const diagnostic: PlatformDiagnostic = JSON.parse(serialized);
  expect(diagnostic).toMatchObject({ phase: 'platform-witness', postgresVersion: null, snapshotComplete: false, catalogDigest: null });
  expect(diagnostic.platformWitness.issues).toEqual([{ field: 'role.name', requirement: 'equals',
    expected: { type: 'string', length: 14, sha256: expect.any(String), value: 'neon_superuser' },
    observed: { type: 'string', length: secret.length, sha256: qualificationDigest(secret) } }]);
  for (const marker of ['postgresql:', 'private_role', 'private_password', 'private-host', 'private_token', 'stack', 'message']) {
    expect(serialized).not.toContain(marker); expect(String(failure)).not.toContain(marker);
  }
  await expect(readFile(join(f.binding.directory, FRESH_INSTALL_FILES.installed))).rejects.toMatchObject({ code: 'ENOENT' });
});

it.each(['initial-evidence', 'installation-sources', 'connection-identity', 'migration-ledger',
  'catalog-read', 'catalog-comparison', 'installed-artifact'])(
  'redacts generic errors during %s without inventing a mismatch diagnostic', async phase => {
  const f = await installationFixture();
  const secret = 'postgresql://private_role:private_password@private-host/db?token=private_token';
  const failure = new Error(secret, { cause: new Error('private_driver_cause') });
  failure.stack = 'private_driver_stack';
  if (phase === 'initial-evidence') await writeFile(join(f.binding.directory, FRESH_INSTALL_FILES.initial), secret);
  if (phase === 'installation-sources') vi.spyOn(catalogModule, 'readFreshInstallSources').mockRejectedValue(failure);
  if (phase === 'connection-identity') f.query.mockRejectedValue(failure);
  if (phase === 'migration-ledger') f.query.mockImplementation(async statement => {
    if (statement.startsWith('SELECT current_database()')) return [{ database: target.databaseName,
      owner: f.initial.installerRole, session: f.initial.installerRole, branch: target.branchId }];
    throw failure;
  });
  if (phase === 'catalog-read') f.readCatalog.mockRejectedValue(failure);
  if (phase === 'catalog-comparison') (f.installed.catalog as { format: string }).format = secret;
  if (phase === 'installed-artifact') await writeFile(join(f.binding.directory, FRESH_INSTALL_FILES.installed), secret, { flag: 'wx' });
  let outward: unknown;
  try { await writeFreshInstallInstalledEvidence(f.query, f.binding); } catch (error) { outward = error; }
  expect(outward).toMatchObject({ message: `Fresh installation evidence capture failed during ${phase}.`,
    code: 'FRESH_INSTALL_EVIDENCE_CAPTURE_FAILED', phase });
  expect((outward as Error).cause).toBeUndefined(); expect(outward).not.toBe(failure);
  for (const marker of [secret, 'private_driver_cause', 'private_driver_stack']) {
    expect(String(outward)).not.toContain(marker); expect((outward as Error).stack).not.toContain(marker);
    expect(JSON.stringify(outward)).not.toContain(marker);
  }
  await expect(readFile(join(f.binding.directory, FRESH_INSTALL_DIAGNOSTIC_FILE))).rejects.toMatchObject({ code: 'ENOENT' });
  if (phase === 'installed-artifact') expect(await readFile(join(f.binding.directory, FRESH_INSTALL_FILES.installed), 'utf8')).toBe(secret);
  else await expect(readFile(join(f.binding.directory, FRESH_INSTALL_FILES.installed))).rejects.toMatchObject({ code: 'ENOENT' });
});
