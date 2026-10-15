import assert from 'node:assert/strict';
import { lstat, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  FRESH_INSTALL_PROFILE, QUALIFICATION_MAX_BYTES, qualificationBinding, qualificationDigest,
  type QualificationBinding,
} from './qualification-profile';
import {
  assertFreshInstallCatalog, assertFreshInstallPrivileges, assertFreshInstallInstalledCatalog,
  assertFreshInstallDatabasePlatformBranch, FreshInstallDatabasePlatformError,
  readFreshInstallCatalog, readFreshInstallSources,
  FRESH_INSTALL_MANIFEST_SHA256, FreshInstallCatalogMismatchError, type FreshInstallCatalogDiagnostic, type FreshInstallCatalogMismatch,
  type FreshInstallCatalog, type FreshInstallDatabasePlatformDiagnostic,
} from './fresh-install-catalog';

export const FRESH_INSTALL_INITIAL_DIGEST_ENV = 'PROJECTION_INTEGRATION_FRESH_INSTALL_INITIAL_DIGEST';
export const FRESH_INSTALL_FILES = { initial: 'fresh-install-initial.json', installed: 'fresh-install-installed.json' } as const;
export const FRESH_INSTALL_DIAGNOSTIC_FILE = 'fresh-install-diagnostic.json';
export const FRESH_INSTALL_DIAGNOSTIC_MAX_BYTES = 64 * 1024;
export const FRESH_INSTALL_ROLES = ['league_one_account', 'league_one_auth', 'league_one_runtime'] as const;
type Query = (statement: string, parameters?: readonly unknown[]) => Promise<readonly Record<string, unknown>[]>;
type Target = { databaseName: string; branchId: string };
type Bound = Target & { contextDigest: string; runId: string; gitSha: string; profile: typeof FRESH_INSTALL_PROFILE; observedAt: string; installerRole: string };
export type FreshInstallEmptyRow = { database: string; owner: string; session: string; branch: string;
  schemas: number; relations: number; functions: number; types: number; roles: number; sessions: number };
export type FreshInstallEmptyEvidence = Bound & { kind: 'fresh-install-empty-v1'; empty: FreshInstallEmptyRow };
export type FreshInstallRole = { name: string; oid: string; rolcanlogin: boolean; rolsuper: boolean;
  rolcreatedb: boolean; rolcreaterole: boolean; rolreplication: boolean; rolinherit: boolean; rolbypassrls: boolean; has_memberships: boolean };
export type FreshInstallInitialEvidence = Bound & { kind: 'fresh-install-initial-v1'; emptyObservedAt: string;
  empty: FreshInstallEmptyRow; roles: FreshInstallRole[] };
export type FreshInstallInstalledEvidence = Bound & { kind: 'fresh-install-installed-v1'; initialEvidenceDigest: string;
  sources: Awaited<ReturnType<typeof readFreshInstallSources>>; migrationLedger: readonly { name: string; checksum: string }[];
  catalog: Awaited<ReturnType<typeof readFreshInstallCatalog>> };
export type FreshInstallDiagnostic = Bound & { kind: 'fresh-install-diagnostic-v2'; status: 'unverified';
  initialEvidenceDigest: string; frozenManifestDigest: string; sourcesDigest: string; migrationLedgerDigest: string } & (
  { phase: 'comparison'; postgresVersion: string; snapshotComplete: true; catalogDigest: string;
    mismatch: FreshInstallCatalogMismatch; comparison: FreshInstallCatalogDiagnostic }
  | { phase: 'platform-witness'; postgresVersion: string | null; snapshotComplete: boolean; catalogDigest: string | null;
    platformWitness: FreshInstallDatabasePlatformDiagnostic });
class FreshInstallDiagnosticPersistenceError extends Error {
  constructor(cause: FreshInstallCatalogMismatchError | FreshInstallDatabasePlatformError) {
    super('Fresh installation catalog mismatch; diagnostic persistence failed.', { cause });
  }
}
const boundKeys = ['contextDigest', 'runId', 'gitSha', 'profile', 'databaseName', 'branchId', 'observedAt', 'installerRole'];
function keys(value: unknown, expected: readonly string[]): asserts value is Record<string, unknown> {
  assert(value && typeof value === 'object' && !Array.isArray(value), 'Malformed fresh installation evidence.');
  assert.deepEqual(Object.keys(value).sort(), [...expected].sort(), 'Malformed fresh installation evidence keys.');
}
function timestamp(value: string): void {
  assert.equal(new Date(value).toISOString(), value, 'Invalid fresh installation observation time.');
  assert(value <= new Date().toISOString(), 'Fresh installation observation cannot be in the future.');
}
function bind(binding: QualificationBinding, target: Target, installerRole: string): Bound {
  assert.equal(binding.context.profile, FRESH_INSTALL_PROFILE, 'Closed fresh installation profile required.');
  return { contextDigest: qualificationDigest(binding.context), runId: binding.context.runId,
    gitSha: binding.context.gitSha, profile: FRESH_INSTALL_PROFILE, ...target,
    observedAt: new Date().toISOString(), installerRole };
}
function assertBinding(value: Bound, binding: QualificationBinding, target: Target): void {
  assert.equal(binding.context.profile, FRESH_INSTALL_PROFILE);
  assert.equal(value.contextDigest, qualificationDigest(binding.context));
  assert.equal(value.runId, binding.context.runId); assert.equal(value.gitSha, binding.context.gitSha);
  assert.equal(value.profile, FRESH_INSTALL_PROFILE);
  assert.equal(value.databaseName, target.databaseName); assert.equal(value.branchId, target.branchId);
  assert.match(value.installerRole, /^[a-zA-Z_][a-zA-Z0-9_]{0,62}$/u);
  assert(!FRESH_INSTALL_ROLES.includes(value.installerRole as typeof FRESH_INSTALL_ROLES[number]));
  timestamp(value.observedAt);
}
function assertEmpty(empty: FreshInstallEmptyRow, target: Target, installerRole: string): void {
  assert.deepEqual(empty, { database: target.databaseName, owner: installerRole, session: installerRole,
    branch: target.branchId, schemas: 0, relations: 0, functions: 0, types: 0, roles: 0, sessions: 0 });
}
export function createFreshInstallEmptyEvidence(binding: QualificationBinding, empty: FreshInstallEmptyRow,
  target: Target, installerRole: string): FreshInstallEmptyEvidence {
  assertEmpty(empty, target, installerRole);
  const evidence = { ...bind(binding, target, installerRole), kind: 'fresh-install-empty-v1' as const, empty };
  assertFreshInstallEmptyEvidence(evidence, binding, target); return evidence;
}
export function assertFreshInstallEmptyEvidence(value: FreshInstallEmptyEvidence, binding: QualificationBinding, target: Target): void {
  keys(value, [...boundKeys, 'kind', 'empty']); assert.equal(value.kind, 'fresh-install-empty-v1');
  assertBinding(value, binding, target); assertEmpty(value.empty, target, value.installerRole);
}
export function assertFreshInstallInitialEvidence(value: FreshInstallInitialEvidence, binding: QualificationBinding, target: Target): void {
  keys(value, [...boundKeys, 'kind', 'empty', 'emptyObservedAt', 'roles']); assert.equal(value.kind, 'fresh-install-initial-v1');
  assertBinding(value, binding, target); assertEmpty(value.empty, target, value.installerRole);
  timestamp(value.emptyObservedAt); assert(value.emptyObservedAt <= value.observedAt);
  assert(Array.isArray(value.roles)); assert.deepEqual(value.roles.map(role => role.name), FRESH_INSTALL_ROLES);
  assert.equal(new Set(value.roles.map(role => role.oid)).size, 3);
  for (const role of value.roles) {
    keys(role, ['name', 'oid', 'rolcanlogin', 'rolsuper', 'rolcreatedb', 'rolcreaterole', 'rolreplication', 'rolinherit', 'rolbypassrls', 'has_memberships']);
    assert.match(role.oid, /^[1-9][0-9]{0,9}$/u); assert.equal(role.rolcanlogin, true);
    for (const flag of ['rolsuper', 'rolcreatedb', 'rolcreaterole', 'rolreplication', 'rolinherit', 'rolbypassrls', 'has_memberships'] as const) assert.equal(role[flag], false);
  }
}
async function writeArtifact(binding: QualificationBinding, key: keyof typeof FRESH_INSTALL_FILES, value: unknown): Promise<string> {
  const serialized = JSON.stringify(value);
  assert(Buffer.byteLength(serialized) <= QUALIFICATION_MAX_BYTES, 'Fresh installation artifact exceeds the bounded allowance.');
  await writeFile(join(binding.directory, FRESH_INSTALL_FILES[key]), serialized, { flag: 'wx', mode: 0o600 });
  return qualificationDigest(value);
}
async function readArtifact(binding: QualificationBinding, key: keyof typeof FRESH_INSTALL_FILES): Promise<unknown> {
  const path = join(binding.directory, FRESH_INSTALL_FILES[key]), stat = await lstat(path);
  assert(stat.isFile() && !stat.isSymbolicLink() && stat.size > 0 && stat.size <= QUALIFICATION_MAX_BYTES,
    'Fresh installation artifact must be a bounded regular file.');
  const serialized = await readFile(path, 'utf8'); assert(Buffer.byteLength(serialized) <= QUALIFICATION_MAX_BYTES);
  return JSON.parse(serialized);
}
export async function writeFreshInstallInitialEvidence(binding: QualificationBinding, empty: FreshInstallEmptyEvidence,
  roles: FreshInstallRole[]): Promise<string> {
  assertFreshInstallEmptyEvidence(empty, binding, empty);
  await readFreshInstallSources(); // Refuse a different migration/provisioner sequence before child installation.
  const initial: FreshInstallInitialEvidence = { ...bind(binding, { databaseName: empty.databaseName, branchId: empty.branchId }, empty.installerRole),
    kind: 'fresh-install-initial-v1', emptyObservedAt: empty.observedAt, empty: empty.empty, roles };
  assertFreshInstallInitialEvidence(initial, binding, empty); return writeArtifact(binding, 'initial', initial);
}
function environmentTarget(): Target {
  const databaseName = process.env.PROJECTION_INTEGRATION_EXPECTED_DATABASE, branchId = process.env.PROJECTION_INTEGRATION_EXPECTED_BRANCH_ID;
  assert(databaseName && branchId, 'Fresh installation target binding is required.'); return { databaseName, branchId };
}
export async function readFreshInstallInitialEvidence(binding: QualificationBinding, target = environmentTarget(),
  digest = process.env[FRESH_INSTALL_INITIAL_DIGEST_ENV]): Promise<FreshInstallInitialEvidence> {
  assert(digest && /^[0-9a-f]{64}$/u.test(digest), 'Fresh installation initial digest is required.');
  const initial = await readArtifact(binding, 'initial') as FreshInstallInitialEvidence;
  assertFreshInstallInitialEvidence(initial, binding, target); assert.equal(qualificationDigest(initial), digest); return initial;
}
export async function writeFreshInstallInstalledEvidence(query: Query, binding: QualificationBinding): Promise<string> {
  let phase = 'initial-evidence';
  try {
    const initial = await readFreshInstallInitialEvidence(binding);
    phase = 'installation-sources';
    const sources = await readFreshInstallSources();
    phase = 'connection-identity';
    assert.deepEqual(await query(`SELECT current_database() AS database, current_user AS owner, session_user AS session,
      current_setting('neon.branch_id',true) AS branch`), [{ database: initial.databaseName,
      owner: initial.installerRole, session: initial.installerRole, branch: initial.branchId }]);
    phase = 'migration-ledger';
    const migrationLedger = await query('SELECT name, checksum FROM public.app_schema_migrations ORDER BY name') as { name: string; checksum: string }[];
    assert.deepEqual(migrationLedger, sources.migrations.map(({ name, checksum }) => ({ name, checksum })));
    let catalog: FreshInstallCatalog | undefined;
    try {
      phase = 'catalog-read';
      catalog = await readFreshInstallCatalog(query, initial.installerRole);
      phase = 'platform-binding';
      assertFreshInstallDatabasePlatformBranch(catalog, initial.branchId);
      phase = 'catalog-comparison';
      assertFreshInstallInstalledCatalog(catalog);
    } catch (error) {
      if (error instanceof FreshInstallCatalogMismatchError || error instanceof FreshInstallDatabasePlatformError) {
        try {
          // Every comparison runs against the same captured snapshot. Only the
          // collector's bounded, sanitized details enter this unverified artifact.
          const common = {
            ...bind(binding, { databaseName: initial.databaseName, branchId: initial.branchId }, initial.installerRole),
            kind: 'fresh-install-diagnostic-v2' as const, status: 'unverified' as const, initialEvidenceDigest: qualificationDigest(initial),
            frozenManifestDigest: FRESH_INSTALL_MANIFEST_SHA256,
            sourcesDigest: qualificationDigest(sources), migrationLedgerDigest: qualificationDigest(migrationLedger),
          };
          let diagnostic: FreshInstallDiagnostic;
          if (error instanceof FreshInstallDatabasePlatformError) {
            diagnostic = { ...common, phase: 'platform-witness', postgresVersion: error.postgresVersion,
              snapshotComplete: catalog !== undefined, catalogDigest: catalog ? qualificationDigest(catalog) : null,
              platformWitness: error.diagnostic };
          } else {
            assert(catalog);
            diagnostic = { ...common, phase: 'comparison', postgresVersion: catalog.postgresVersion,
              snapshotComplete: true, catalogDigest: qualificationDigest(catalog),
              mismatch: error.mismatch, comparison: error.diagnostic };
          }
          const serialized = JSON.stringify(diagnostic);
          assert(Buffer.byteLength(serialized) <= FRESH_INSTALL_DIAGNOSTIC_MAX_BYTES, 'Fresh installation diagnostic exceeds the bounded allowance.');
          await writeFile(join(binding.directory, FRESH_INSTALL_DIAGNOSTIC_FILE), serialized, { flag: 'wx', mode: 0o600 });
        } catch {
          throw new FreshInstallDiagnosticPersistenceError(error);
        }
      }
      throw error;
    }
    phase = 'installed-artifact';
    const installed: FreshInstallInstalledEvidence = { ...bind(binding, { databaseName: initial.databaseName, branchId: initial.branchId }, initial.installerRole),
      kind: 'fresh-install-installed-v1', initialEvidenceDigest: qualificationDigest(initial), sources, migrationLedger, catalog };
    return await writeArtifact(binding, 'installed', installed);
  } catch (error) {
    if (error instanceof FreshInstallCatalogMismatchError || error instanceof FreshInstallDatabasePlatformError
      || error instanceof FreshInstallDiagnosticPersistenceError) throw error;
    // Driver/assertion/filesystem messages can contain query text or values.
    // Preserve a fixed local phase, never the original message, stack or cause.
    throw Object.assign(new Error(`Fresh installation evidence capture failed during ${phase}.`),
      { code: 'FRESH_INSTALL_EVIDENCE_CAPTURE_FAILED', phase });
  }
}
export async function assertFreshInstallInstalledEvidence(installed: FreshInstallInstalledEvidence,
  initial: FreshInstallInitialEvidence, binding: QualificationBinding, target: Target): Promise<void> {
  keys(installed, [...boundKeys, 'kind', 'initialEvidenceDigest', 'sources', 'migrationLedger', 'catalog']);
  assert.equal(installed.kind, 'fresh-install-installed-v1'); assertBinding(installed, binding, target);
  assert.equal(installed.installerRole, initial.installerRole); assert(initial.observedAt <= installed.observedAt);
  assert.equal(installed.catalog.installer.name, initial.installerRole);
  assertFreshInstallDatabasePlatformBranch(installed.catalog, initial.branchId);
  assert.equal(installed.initialEvidenceDigest, qualificationDigest(initial));
  assert.deepEqual(installed.sources, await readFreshInstallSources());
  assert.deepEqual(installed.migrationLedger, installed.sources.migrations.map(({ name, checksum }) => ({ name, checksum })));
  await assertFreshInstallCatalog(installed.catalog); await assertFreshInstallPrivileges(installed.catalog);
}
export async function readFreshInstallEvidence(binding = qualificationBinding(), target = environmentTarget(),
  initialDigest = process.env[FRESH_INSTALL_INITIAL_DIGEST_ENV]): Promise<{ initial: FreshInstallInitialEvidence; installed: FreshInstallInstalledEvidence }> {
  assert(binding, 'Fresh installation requires the supervised qualification context.');
  const initial = await readFreshInstallInitialEvidence(binding, target, initialDigest);
  const installed = await readArtifact(binding, 'installed') as FreshInstallInstalledEvidence;
  await assertFreshInstallInstalledEvidence(installed, initial, binding, target); return { initial, installed };
}
