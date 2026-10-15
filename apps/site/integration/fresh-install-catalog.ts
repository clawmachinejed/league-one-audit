import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import { isDeepStrictEqual } from 'node:util';

/** Reviewed before CP21 implementation from accepted CP20 d000161d. The
 * complete oracle is immutable source, never learned from the tested database.
 * See docs/aggregator-backend/data-backend-cp21-plan.md for the frozen inventory,
 * role-first installation order and offline-only provenance. */
/** SHA-256 of the frozen manifest after LF normalization, independent of checkout CRLF. */
export const FRESH_INSTALL_MANIFEST_SHA256 = 'a2dfba7e7c048fe4246cb653785084658d5fafd8ae0dae0a63b907e7ba706f50';
export const FRESH_INSTALL_BASELINE_SHA256 = '80fe613fcf0fe336698e9b9c971b9c71b14c9b30fae25586509b59967db52b5c';
export const FRESH_INSTALL_NONSUPER_BASELINE_SHA256 = '324f4a3d4a32ffd91ecbe70fe43e242e40bab9aa35673d1f811a7f98bd7d046b';
const APPLICATION_ROLES = ['league_one_account', 'league_one_auth', 'league_one_runtime'] as const;
type CatalogRow = Record<string, unknown>;
export type FreshInstallCatalogValueDiagnostic = Readonly<{ type: string; sha256: string | null; length?: number }>;
const POLICY_FIELDS = ['schema', 'relation', 'name', 'command', 'permissive', 'roles', 'using_expression', 'check_expression'] as const;
export type FreshInstallCatalogMismatch = Readonly<{
  section: string; expectedRows: number; observedRows: number; firstDifferingRow: number;
  expectedRowDigest: string | null; observedRowDigest: string | null;
  policyFields?: readonly Readonly<{ field: typeof POLICY_FIELDS[number];
    expected: FreshInstallCatalogValueDiagnostic; observed: FreshInstallCatalogValueDiagnostic }>[];
}>;
type SafeScalar = string | number | boolean | null;
export type FreshInstallCatalogSafeRow = Readonly<{ digest: string;
  fields: readonly (FreshInstallCatalogValueDiagnostic & Readonly<{ name: string; value?: SafeScalar | readonly SafeScalar[] }>)[];
  omittedFields: number }>;
type SafeChange = Readonly<{ expected: FreshInstallCatalogSafeRow; observed: FreshInstallCatalogSafeRow;
  differingFields: readonly string[]; omittedDifferingFields: number }>;
export type FreshInstallCatalogSectionDiagnostic = Readonly<{
  section: string; status: 'matched' | 'different'; expectedRows: number; observedRows: number;
  expectedDigest: string; observedDigest: string;
  missingRows: number; extraRows: number; changedRows: number; firstDifference?: FreshInstallCatalogMismatch;
  details: Readonly<{ missing: readonly FreshInstallCatalogSafeRow[]; extra: readonly FreshInstallCatalogSafeRow[];
    changed: readonly SafeChange[] }>;
  omitted: Readonly<{ missing: number; extra: number; changed: number }>;
}>;
export type FreshInstallCatalogDiagnostic = Readonly<{ format: 'fresh-install-catalog-comparison-v2';
  sections: readonly FreshInstallCatalogSectionDiagnostic[]; truncated: boolean }>;
type CatalogComparison = { section: string; expected: readonly CatalogRow[]; observed: readonly CatalogRow[] };
export const FRESH_INSTALL_COMPARISON_MAX_BYTES = 60 * 1024;
export class FreshInstallCatalogMismatchError extends Error {
  readonly mismatch: FreshInstallCatalogMismatch;
  readonly diagnostic: FreshInstallCatalogDiagnostic;
  constructor(section: string, expected: readonly CatalogRow[], observed: readonly CatalogRow[], firstDifferingRow: number,
    comparisons?: readonly CatalogComparison[]) {
    const mismatch = mismatchSummary(section, expected, observed, firstDifferingRow);
    super('Fresh-install catalog: ' + mismatch.section + ' differs from frozen inventory; expected '
      + mismatch.expectedRows + ' rows, observed ' + mismatch.observedRows + ', first differing row ' + mismatch.firstDifferingRow + '.');
    this.name = 'FreshInstallCatalogMismatchError';
    this.mismatch = mismatch;
    this.diagnostic = comparisonDiagnostic(comparisons ?? [{ section, expected, observed }]);
  }
}
export type FreshInstallCatalogQuery = (statement: string, parameters?: readonly unknown[]) => Promise<readonly CatalogRow[]>;
export type FreshInstallSources = Readonly<{
  migrations: readonly Readonly<{ name: string; checksum: string; lfSha256: string }>[];
  provisioners: readonly Readonly<{ name: string; lfSha256: string }>[];
}>;
export type FreshInstallDatabasePlatform = Readonly<{
  kind: 'neon'; branchId: string; databaseOwner: string;
  role: Readonly<{ name: string; superuser: boolean; inherit: boolean; createDb: boolean;
    createRole: boolean; login: boolean; replication: boolean; bypassRls: boolean }>;
  installer: Readonly<{ member: boolean; usage: boolean }>;
  applicationRoles: readonly Readonly<{ role: string; member: boolean; usage: boolean }>[];
}>;
type PlatformRequirement = 'equals' | 'required' | 'neon-branch-id' | 'paired-presence' | 'exact-fields';
type PlatformIssueInput = { field: string; requirement: PlatformRequirement; expected: unknown; observed: unknown };
export type FreshInstallDatabasePlatformDiagnostic = Readonly<{ format: 'fresh-install-platform-witness-v1';
  issues: readonly Readonly<{ field: string; requirement: PlatformRequirement;
    expected: FreshInstallCatalogValueDiagnostic & Readonly<{ value?: SafeScalar }>;
    observed: FreshInstallCatalogValueDiagnostic & Readonly<{ value?: SafeScalar }> }>[];
  omittedUnknownFields: number }>;
const PLATFORM_FIELDS = new Set(['databasePlatform', 'observationRows', 'kind', 'branchId', 'databaseOwner', 'installerSuperuser',
  'role', 'role.name', 'role.superuser', 'role.inherit', 'role.createDb', 'role.createRole', 'role.login',
  'role.replication', 'role.bypassRls', 'installer', 'installer.member', 'installer.usage', 'applicationRoles',
  ...[0, 1, 2].flatMap((index) => [`applicationRoles[${index}]`, ...['role', 'member', 'usage']
    .map((key) => `applicationRoles[${index}].${key}`)])]);
function validBranchId(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 128 && /^br-[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(value);
}
function platformValue(field: string, value: unknown) {
  const retain = value === null || typeof value === 'boolean' || (typeof value === 'number' && Number.isSafeInteger(value))
    || (field === 'branchId' ? validBranchId(value) : identifierValue(value));
  return Object.freeze({ ...valueDiagnostic(value), ...(retain ? { value: value as SafeScalar } : {}) });
}
export class FreshInstallDatabasePlatformError extends Error {
  readonly diagnostic: FreshInstallDatabasePlatformDiagnostic;
  readonly postgresVersion: string | null;
  constructor(issues: readonly PlatformIssueInput[], postgresVersion: unknown, omittedUnknownFields = 0) {
    super('Fresh-install catalog: database platform witness differs from the reviewed variant.');
    this.name = 'FreshInstallDatabasePlatformError';
    this.postgresVersion = typeof postgresVersion === 'string' && /^18\d{4}$/u.test(postgresVersion) ? postgresVersion : null;
    const allowed = issues.filter((issue) => PLATFORM_FIELDS.has(issue.field)
      && ['equals', 'required', 'neon-branch-id', 'paired-presence', 'exact-fields'].includes(issue.requirement));
    // Only fixed paths and sanitized scalar metadata cross the error boundary.
    this.diagnostic = Object.freeze({ format: 'fresh-install-platform-witness-v1',
      issues: Object.freeze(allowed.slice(0, PLATFORM_FIELDS.size).map((issue) => Object.freeze({ field: issue.field,
        requirement: issue.requirement, expected: platformValue(issue.field, issue.expected), observed: platformValue(issue.field, issue.observed) }))),
      omittedUnknownFields: Math.max(0, Number.isSafeInteger(omittedUnknownFields) ? omittedUnknownFields : 0)
        + issues.length - Math.min(allowed.length, PLATFORM_FIELDS.size) });
  }
}
export type FreshInstallCatalog = Readonly<{
  format: 'cp21-installed-catalog-v1';
  postgresVersion: string;
  installer: Readonly<{ name: string; superuser: boolean; inherit: boolean; createRole: boolean }>;
  bootstrap: Readonly<{ name: string; oid: number; superuser: boolean }>;
  databasePlatform: FreshInstallDatabasePlatform | null;
  membershipEvidence: readonly CatalogRow[];
  sections: Readonly<Record<string, readonly CatalogRow[]>>;
}>;
type FrozenManifest = FreshInstallSources & Readonly<{
  format: 'cp21-installed-catalog-v1'; sourceHead: string;
  catalog: Readonly<Record<string, readonly CatalogRow[]>>;
}>;
const sha256 = (value: string): string => createHash('sha256').update(value).digest('hex');
const lf = (value: string): string => value.replace(/\r\n?/gu, '\n');
const manifestBytes = readFileSync(new URL('./fresh-install-catalog.json', import.meta.url), 'utf8');
if (sha256(lf(manifestBytes)) !== FRESH_INSTALL_MANIFEST_SHA256) throw new Error('Fresh-install frozen manifest digest mismatch.');
const frozen = JSON.parse(manifestBytes) as FrozenManifest;
const STRUCTURE_SECTIONS = ['schemas', 'extensions', 'relations', 'columns', 'types', 'enums',
  'constraints', 'indexes', 'triggers', 'functions', 'sequences', 'policies'] as const;
const PRIVILEGE_SECTIONS = ['roles', 'defaultAcl', 'schemaAcl', 'relationAcl', 'columnAcl', 'functionAcl',
  'typeAcl', 'databaseAcl', 'databasePrivileges', 'schemaPrivileges', 'tablePrivileges', 'columnPrivileges',
  'sequencePrivileges', 'functionPrivileges', 'typePrivileges'] as const;
const identityKeys = new Set(['owner', 'grantor', 'grantee', 'member', 'role']);
function ordered(rows: readonly CatalogRow[]): CatalogRow[] {
  return [...rows].sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right), 'en'));
}
function invariant(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`Fresh-install catalog: ${message}`);
}
function valueDiagnostic(value: unknown): FreshInstallCatalogValueDiagnostic {
  const serialized = JSON.stringify(value);
  return Object.freeze({ type: value === undefined ? 'missing' : value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value,
    sha256: serialized === undefined ? null : sha256(serialized),
    ...(typeof value === 'string' || Array.isArray(value) ? { length: value.length } : {}) });
}
function assertRows(actual: readonly CatalogRow[], expected: readonly CatalogRow[], section: string): void {
  invariant(Array.isArray(actual), `${section} is missing.`);
  const sortedActual = ordered(actual), sortedExpected = ordered(expected);
  if (isDeepStrictEqual(sortedActual, sortedExpected)) return;
  const mismatch = sortedActual.findIndex((row, index) => !isDeepStrictEqual(row, sortedExpected[index]));
  const firstDifferingRow = mismatch < 0 ? actual.length : mismatch;
  // Retain bounded safe catalog metadata and hash-only opaque values. Never
  // serialize function bodies, expressions or the complete installed catalog.
  throw new FreshInstallCatalogMismatchError(section, sortedExpected, sortedActual, firstDifferingRow);
}

function mismatchSummary(section: string, expected: readonly CatalogRow[], observed: readonly CatalogRow[],
  firstDifferingRow: number): FreshInstallCatalogMismatch {
  invariant(section === 'membershipEvidence' || Object.hasOwn(frozen.catalog, section), 'unknown mismatch section.');
  const expectedRow = expected[firstDifferingRow], observedRow = observed[firstDifferingRow];
  return Object.freeze({ section, expectedRows: expected.length, observedRows: observed.length, firstDifferingRow,
    expectedRowDigest: valueDiagnostic(expectedRow).sha256, observedRowDigest: valueDiagnostic(observedRow).sha256,
    ...(section === 'policies' ? { policyFields: Object.freeze(POLICY_FIELDS
      .filter((field) => !isDeepStrictEqual(expectedRow?.[field], observedRow?.[field]))
      .map((field) => Object.freeze({ field, expected: valueDiagnostic(expectedRow?.[field]), observed: valueDiagnostic(observedRow?.[field]) }))) } : {}) });
}
const ROW_IDENTITIES: Readonly<Record<string, readonly string[]>> = {
  schemas: ['schema'], extensions: ['schema', 'name'], relations: ['schema', 'name'],
  columns: ['schema', 'relation', 'ordinal'], types: ['schema', 'name'], enums: ['schema', 'type', 'ordinal'],
  constraints: ['schema', 'relation', 'type', 'name'], indexes: ['schema', 'name'],
  triggers: ['schema', 'relation', 'name', 'internal', 'constraint', 'function', 'type'],
  functions: ['schema', 'signature'], sequences: ['schema', 'name'], policies: ['schema', 'relation', 'name'],
  roles: ['role'], memberships: ['role', 'member', 'grantor'], membershipEvidence: ['role', 'member', 'grantor'],
  defaultAcl: ['owner', 'schema', 'object_type', 'grantee', 'privilege'], schemaAcl: ['schema', 'grantee', 'privilege'],
  relationAcl: ['schema', 'name', 'grantee', 'privilege'], columnAcl: ['schema', 'relation', 'column', 'grantee', 'privilege'],
  functionAcl: ['schema', 'signature', 'grantee', 'privilege'], typeAcl: ['schema', 'name', 'grantee', 'privilege'],
  databaseAcl: ['database', 'grantee', 'privilege'], databasePrivileges: ['role'], schemaPrivileges: ['role', 'schema'],
  tablePrivileges: ['role', 'schema', 'relation'], columnPrivileges: ['role', 'schema', 'relation', 'column'],
  sequencePrivileges: ['role', 'schema', 'sequence'], functionPrivileges: ['role', 'schema', 'signature'],
  typePrivileges: ['role', 'schema', 'type'],
};
const EMPTY_SECTION_FIELDS: Readonly<Record<string, readonly string[]>> = {
  enums: ['schema', 'type', 'ordinal', 'label'],
  sequences: ['schema', 'name', 'type', 'start', 'increment', 'max', 'min', 'cache', 'cycle'],
  sequencePrivileges: ['role', 'schema', 'sequence', 'privileges'],
  defaultAcl: ['owner', 'schema', 'object_type', 'grantee', 'grantor', 'privilege', 'grantable'],
};
const IDENTIFIER_FIELDS = new Set(['schema', 'name', 'relation', 'owner', 'grantee', 'grantor', 'member', 'role',
  'database', 'column', 'constraint', 'index', 'referenced_relation', 'old_table', 'new_table', 'extension', 'language', 'sequence']);
const PRIVILEGES = new Set(['CONNECT', 'CREATE', 'TEMPORARY', 'TEMP', 'USAGE', 'SELECT', 'INSERT', 'UPDATE',
  'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER', 'MAINTAIN', 'EXECUTE']);
function identifierValue(value: unknown): value is string {
  if (typeof value !== 'string' || Buffer.byteLength(value) > 131) return false;
  return /^(?:\$[A-Z_]+|[A-Za-z_][A-Za-z0-9_$]{0,62}|"[A-Za-z_][A-Za-z0-9_$]{0,62}")(?:\.(?:[A-Za-z_][A-Za-z0-9_$]{0,62}|"[A-Za-z_][A-Za-z0-9_$]{0,62}"))?$/u.test(value);
}
function safeValue(key: string, value: unknown): SafeScalar | readonly SafeScalar[] | undefined {
  if (value === null || typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value))) return value;
  if (IDENTIFIER_FIELDS.has(key) && identifierValue(value)) return value;
  if ((key === 'signature' || key === 'function') && typeof value === 'string' && Buffer.byteLength(value) <= 512
    && /^[A-Za-z_][A-Za-z0-9_$."(),[\] ]*$/u.test(value)) return value;
  if (key === 'privilege' && typeof value === 'string' && PRIVILEGES.has(value)) return value;
  if (['bodyLfSha256', 'definitionLfSha256'].includes(key) && typeof value === 'string' && /^[0-9a-f]{64}$/u.test(value)) return value;
  if (['kind', 'object_type', 'command', 'persistence', 'replica_identity', 'identity', 'generated', 'storage',
    'compression', 'category', 'fk_update', 'fk_delete', 'fk_match', 'enabled', 'volatility', 'parallel'].includes(key)
    && typeof value === 'string' && /^[A-Za-z*? -]{0,2}$/u.test(value)) return value;
  if (['privileges', 'grantable', 'roles'].includes(key) && Array.isArray(value) && value.length <= 32
    && value.every((entry) => key === 'roles' ? identifierValue(entry) : typeof entry === 'string' && PRIVILEGES.has(entry))) {
    return Object.freeze([...value]) as readonly SafeScalar[];
  }
  return undefined;
}
function sectionFields(section: string): readonly string[] {
  const sectionName = section === 'membershipEvidence' ? 'memberships' : section;
  return Object.keys(frozen.catalog[sectionName]?.[0] ?? Object.fromEntries(
    (EMPTY_SECTION_FIELDS[sectionName] ?? []).map((key) => [key, null])));
}
function safeRow(section: string, row: CatalogRow): FreshInstallCatalogSafeRow {
  const allowed = sectionFields(section);
  const fields = allowed.filter((key) => Object.hasOwn(row, key)).map((name) => {
    const value = safeValue(name, row[name]);
    return Object.freeze({ name, ...valueDiagnostic(row[name]), ...(value !== undefined ? { value } : {}) });
  });
  return Object.freeze({ digest: sha256(JSON.stringify(row)), fields: Object.freeze(fields),
    omittedFields: Object.keys(row).filter((key) => !allowed.includes(key)).length });
}
function safeChange(section: string, row: { expected: CatalogRow; observed: CatalogRow }): SafeChange {
  const allowed = sectionFields(section);
  const differing = [...new Set([...Object.keys(row.expected), ...Object.keys(row.observed)])]
    .filter((key) => !isDeepStrictEqual(row.expected[key], row.observed[key])
      || Object.hasOwn(row.expected, key) !== Object.hasOwn(row.observed, key));
  return Object.freeze({ expected: safeRow(section, row.expected), observed: safeRow(section, row.observed),
    differingFields: Object.freeze(allowed.filter((key) => differing.includes(key))),
    omittedDifferingFields: differing.filter((key) => !allowed.includes(key)).length });
}
function canonical(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value && typeof value === 'object') return '{' + Object.keys(value).sort()
    .map((key) => JSON.stringify(key) + ':' + canonical((value as Record<string, unknown>)[key])).join(',') + '}';
  return JSON.stringify(value) ?? 'undefined';
}
function differenceRows(expected: readonly CatalogRow[], observed: readonly CatalogRow[], section: string) {
  // Remove exact multiset matches first, so one inserted row never cascades into
  // false changes at every following sort position. Hashes are diagnostics only.
  const remaining = new Map<string, CatalogRow[]>();
  for (const row of expected) { const key = canonical(row); remaining.set(key, [...(remaining.get(key) ?? []), row]); }
  const extra: CatalogRow[] = [];
  for (const row of observed) {
    const bucket = remaining.get(canonical(row)), index = bucket?.findIndex((candidate) => isDeepStrictEqual(candidate, row)) ?? -1;
    if (bucket && index >= 0) bucket.splice(index, 1); else extra.push(row);
  }
  const missing = [...remaining.values()].flat();
  const identity = (row: CatalogRow) => {
    const fields = ROW_IDENTITIES[section];
    return fields?.every((field) => Object.hasOwn(row, field)) ? canonical(fields.map((field) => row[field])) : null;
  };
  const groups = (rows: readonly CatalogRow[]) => {
    const result = new Map<string, CatalogRow[]>();
    for (const row of rows) { const key = identity(row); if (key !== null) result.set(key, [...(result.get(key) ?? []), row]); }
    return result;
  };
  const missingGroups = groups(missing), extraGroups = groups(extra), paired = new Set<CatalogRow>();
  const allExpectedGroups = groups(expected), allObservedGroups = groups(observed);
  const changed: { expected: CatalogRow; observed: CatalogRow }[] = [];
  for (const [key, rows] of missingGroups) {
    const candidates = extraGroups.get(key);
    if (rows.length === 1 && candidates?.length === 1
      && allExpectedGroups.get(key)?.length === 1 && allObservedGroups.get(key)?.length === 1) {
      changed.push({ expected: rows[0], observed: candidates[0] }); paired.add(rows[0]); paired.add(candidates[0]);
    }
  }
  return { missing: missing.filter((row) => !paired.has(row)), extra: extra.filter((row) => !paired.has(row)), changed };
}
function comparisonDiagnostic(comparisons: readonly CatalogComparison[]): FreshInstallCatalogDiagnostic {
  const pending: { missing: CatalogRow[]; extra: CatalogRow[]; changed: { expected: CatalogRow; observed: CatalogRow }[] }[] = [];
  const sections = comparisons.map(({ section, expected, observed }) => {
    invariant(Object.hasOwn(ROW_IDENTITIES, section), 'unknown comparison section.');
    invariant(Array.isArray(observed), section + ' is missing.');
    const sortedExpected = ordered(expected), sortedObserved = ordered(observed), matched = isDeepStrictEqual(sortedExpected, sortedObserved);
    const changes = matched ? { missing: [], extra: [], changed: [] } : differenceRows(sortedExpected, sortedObserved, section);
    pending.push(changes);
    const index = sortedObserved.findIndex((row, at) => !isDeepStrictEqual(row, sortedExpected[at]));
    return { section, status: matched ? 'matched' as const : 'different' as const, expectedRows: expected.length, observedRows: observed.length,
      expectedDigest: sha256(JSON.stringify(sortedExpected)), observedDigest: sha256(JSON.stringify(sortedObserved)),
      missingRows: changes.missing.length, extraRows: changes.extra.length, changedRows: changes.changed.length,
      ...(matched ? {} : { firstDifference: mismatchSummary(section, sortedExpected, sortedObserved, index < 0 ? observed.length : index) }),
      details: { missing: [] as FreshInstallCatalogSafeRow[], extra: [] as FreshInstallCatalogSafeRow[],
        changed: [] as SafeChange[] },
      omitted: { missing: changes.missing.length, extra: changes.extra.length, changed: changes.changed.length } };
  });
  const diagnostic = { format: 'fresh-install-catalog-comparison-v2' as const, sections, truncated: true };
  invariant(Buffer.byteLength(JSON.stringify(diagnostic)) <= FRESH_INSTALL_COMPARISON_MAX_BYTES, 'comparison headers exceed diagnostic budget.');
  // Offer one row of each kind to each section per round. Every section header
  // and full counts survive even when individual row details exceed the budget.
  for (let round = 0; ; round++) {
    let retained = false;
    for (let index = 0; index < sections.length; index++) {
      const section = sections[index], rows = pending[index];
      for (const kind of ['changed', 'missing', 'extra'] as const) {
        const row = rows[kind][round];
        if (!row) continue;
        const detail = kind === 'changed'
          ? safeChange(section.section, row as { expected: CatalogRow; observed: CatalogRow })
          : safeRow(section.section, row as CatalogRow);
        const target = section.details[kind] as (FreshInstallCatalogSafeRow | SafeChange)[];
        target.push(detail); section.omitted[kind]--;
        if (Buffer.byteLength(JSON.stringify(diagnostic)) > FRESH_INSTALL_COMPARISON_MAX_BYTES) {
          target.pop(); section.omitted[kind]++;
        } else retained = true;
      }
    }
    if (!retained) break;
  }
  diagnostic.truncated = sections.some((section) => Object.values(section.omitted).some((count) => count > 0));
  for (const section of sections) {
    for (const row of section.details.changed) Object.freeze(row);
    Object.freeze(section.details.missing); Object.freeze(section.details.extra); Object.freeze(section.details.changed);
    Object.freeze(section.details); Object.freeze(section.omitted); Object.freeze(section);
  }
  return Object.freeze({ ...diagnostic, sections: Object.freeze(sections) });
}

/** Compare every frozen section from one already-read snapshot before failing.
 * This changes diagnostic completeness only; it does not accept any mismatch. */
export function assertFreshInstallInstalledCatalog(catalog: FreshInstallCatalog): void {
  assertCatalogEnvelope(catalog);
  const expectedMemberships = membershipRows(catalog);
  const comparisons: CatalogComparison[] = [...STRUCTURE_SECTIONS, ...PRIVILEGE_SECTIONS].map((section) => ({
    section, expected: expectedRows(catalog, section), observed: catalog.sections[section],
  }));
  comparisons.push({ section: 'memberships', expected: expectedMemberships, observed: catalog.sections.memberships },
    { section: 'membershipEvidence', expected: rawMembershipRows(catalog, expectedMemberships), observed: catalog.membershipEvidence });
  let first: { comparison: CatalogComparison; index: number } | undefined;
  for (const comparison of comparisons) {
    invariant(Array.isArray(comparison.observed), comparison.section + ' is missing.');
    const expected = ordered(comparison.expected), observed = ordered(comparison.observed);
    if (!isDeepStrictEqual(observed, expected) && !first) {
      const index = observed.findIndex((row, at) => !isDeepStrictEqual(row, expected[at]));
      first = { comparison: { ...comparison, expected, observed }, index: index < 0 ? observed.length : index };
    }
  }
  if (first) throw new FreshInstallCatalogMismatchError(first.comparison.section, first.comparison.expected,
    first.comparison.observed, first.index, comparisons);
}

const CATALOG_QUERIES: Readonly<Record<string, string>> = {
  "schemas": "SELECT n.nspname AS schema,pg_get_userbyid(n.nspowner) AS owner FROM pg_namespace n WHERE n.nspname IN ('public','website_auth')",
  "extensions": "SELECT e.extname AS name,e.extversion AS version,n.nspname AS schema,pg_get_userbyid(e.extowner) AS owner,e.extrelocatable AS relocatable FROM pg_extension e JOIN pg_namespace n ON n.oid=e.extnamespace WHERE n.nspname IN ('public','website_auth')",
  "relations": "SELECT n.nspname AS schema,c.relname AS name,c.relkind::text AS kind,pg_get_userbyid(c.relowner) AS owner,c.relpersistence::text AS persistence,c.relrowsecurity AS rls,c.relforcerowsecurity AS force_rls,c.relreplident::text AS replica_identity,c.relispartition AS is_partition,c.reloptions AS options,CASE WHEN c.relkind IN ('v','m') THEN pg_get_viewdef(c.oid,false) ELSE NULL END AS view_definition FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN ('public','website_auth')",
  "columns": "SELECT n.nspname AS schema,c.relname AS relation,a.attnum AS ordinal,a.attname AS name,format_type(a.atttypid,a.atttypmod) AS type,a.attnotnull AS not_null,pg_get_expr(d.adbin,d.adrelid,false) AS default_expression,a.attidentity::text AS identity,a.attgenerated::text AS generated,CASE WHEN a.attcollation=0 THEN NULL ELSE a.attcollation::regcollation::text END AS collation,a.attstorage::text AS storage,a.attcompression::text AS compression,a.attisdropped AS dropped FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum WHERE n.nspname IN ('public','website_auth') AND c.relkind NOT IN ('i','I') AND a.attnum>0",
  "types": "SELECT n.nspname AS schema,t.typname AS name,t.typtype::text AS kind,t.typcategory::text AS category,pg_get_userbyid(t.typowner) AS owner,CASE WHEN t.typrelid=0 THEN NULL ELSE t.typrelid::regclass::text END AS relation,CASE WHEN t.typelem=0 THEN NULL ELSE format_type(t.typelem,NULL) END AS element,CASE WHEN t.typbasetype=0 THEN NULL ELSE format_type(t.typbasetype,t.typtypmod) END AS base_type,t.typnotnull AS not_null,t.typdefault AS default_expression FROM pg_type t JOIN pg_namespace n ON n.oid=t.typnamespace WHERE n.nspname IN ('public','website_auth')",
  "enums": "SELECT n.nspname AS schema,t.typname AS type,e.enumsortorder AS ordinal,e.enumlabel AS label FROM pg_enum e JOIN pg_type t ON t.oid=e.enumtypid JOIN pg_namespace n ON n.oid=t.typnamespace WHERE n.nspname IN ('public','website_auth')",
  "constraints": "SELECT n.nspname AS schema,c.conname AS name,CASE WHEN c.conrelid=0 THEN NULL ELSE c.conrelid::regclass::text END AS relation,CASE WHEN c.contypid=0 THEN NULL ELSE c.contypid::regtype::text END AS type,c.contype::text AS kind,pg_get_constraintdef(c.oid,false) AS definition,c.condeferrable AS deferrable,c.condeferred AS initially_deferred,c.convalidated AS validated,c.conislocal AS local,c.coninhcount AS inherited_count,c.connoinherit AS no_inherit,CASE WHEN c.conindid=0 THEN NULL ELSE c.conindid::regclass::text END AS index,CASE WHEN c.confrelid=0 THEN NULL ELSE c.confrelid::regclass::text END AS referenced_relation,c.conkey::int[] AS columns,c.confkey::int[] AS referenced_columns,c.confupdtype::text AS fk_update,c.confdeltype::text AS fk_delete,c.confmatchtype::text AS fk_match FROM pg_constraint c JOIN pg_namespace n ON n.oid=c.connamespace WHERE n.nspname IN ('public','website_auth')",
  "indexes": "SELECT n.nspname AS schema,c.relname AS name,i.indrelid::regclass::text AS relation,pg_get_indexdef(i.indexrelid,0,false) AS definition,i.indisunique AS unique,i.indnullsnotdistinct AS nulls_not_distinct,i.indisprimary AS primary,i.indisexclusion AS exclusion,i.indimmediate AS immediate,i.indisvalid AS valid,i.indisready AS ready,i.indislive AS live,i.indnkeyatts AS key_columns,i.indnatts AS all_columns,pg_get_expr(i.indpred,i.indrelid,false) AS predicate,pg_get_expr(i.indexprs,i.indrelid,false) AS expressions FROM pg_index i JOIN pg_class c ON c.oid=i.indexrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN ('public','website_auth')",
  "triggers": "SELECT n.nspname AS schema,t.tgrelid::regclass::text AS relation,CASE WHEN t.tgisinternal THEN NULL ELSE t.tgname END AS name,t.tgisinternal AS internal,c.conname AS constraint,t.tgfoid::regprocedure::text AS function,t.tgtype AS type,t.tgenabled::text AS enabled,t.tgdeferrable AS deferrable,t.tginitdeferred AS initially_deferred,t.tgnargs AS argument_count,encode(t.tgargs,'hex') AS arguments,t.tgattr::int[] AS columns,CASE WHEN t.tgisinternal THEN NULL ELSE pg_get_triggerdef(t.oid,false) END AS definition,t.tgoldtable AS old_table,t.tgnewtable AS new_table FROM pg_trigger t JOIN pg_class r ON r.oid=t.tgrelid JOIN pg_namespace n ON n.oid=r.relnamespace LEFT JOIN pg_constraint c ON c.oid=t.tgconstraint WHERE n.nspname IN ('public','website_auth')",
  "functions": "SELECT n.nspname AS schema,p.oid::regprocedure::text AS signature,p.proname AS name,pg_get_userbyid(p.proowner) AS owner,l.lanname AS language,p.prokind::text AS kind,p.prosecdef AS security_definer,p.proleakproof AS leakproof,p.proisstrict AS strict,p.proretset AS returns_set,p.provolatile::text AS volatility,p.proparallel::text AS parallel,p.proconfig AS configuration,pg_get_function_result(p.oid) AS result,pg_get_function_arguments(p.oid) AS arguments,p.procost AS cost,p.prorows AS rows,p.prosrc AS body,p.probin AS binary,pg_get_functiondef(p.oid) AS definition,(SELECT e.extname FROM pg_depend d JOIN pg_extension e ON e.oid=d.refobjid WHERE d.classid='pg_proc'::regclass AND d.objid=p.oid AND d.deptype='e') AS extension FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace JOIN pg_language l ON l.oid=p.prolang WHERE n.nspname IN ('public','website_auth')",
  "sequences": "SELECT n.nspname AS schema,c.relname AS name,format_type(s.seqtypid,NULL) AS type,s.seqstart::text AS start,s.seqincrement::text AS increment,s.seqmax::text AS max,s.seqmin::text AS min,s.seqcache::text AS cache,s.seqcycle AS cycle FROM pg_sequence s JOIN pg_class c ON c.oid=s.seqrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN ('public','website_auth')",
  "policies": "SELECT n.nspname AS schema,c.relname AS relation,p.polname AS name,p.polcmd::text AS command,p.polpermissive AS permissive,ARRAY(SELECT CASE WHEN x=0 THEN 'PUBLIC' ELSE pg_get_userbyid(x) END FROM unnest(p.polroles) x ORDER BY 1)::text[] AS roles,pg_get_expr(p.polqual,p.polrelid,false) AS using_expression,pg_get_expr(p.polwithcheck,p.polrelid,false) AS check_expression FROM pg_policy p JOIN pg_class c ON c.oid=p.polrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN ('public','website_auth')",
  "roles": "SELECT rolname AS role,rolsuper AS superuser,rolinherit AS inherit,rolcreaterole AS create_role,rolcreatedb AS create_db,rolcanlogin AS login,rolreplication AS replication,rolbypassrls AS bypass_rls,rolconnlimit AS connection_limit,rolconfig AS configuration FROM pg_roles WHERE rolname IN ('league_one_runtime','league_one_account','league_one_auth')",
  "memberships": "SELECT pg_get_userbyid(roleid) AS role,pg_get_userbyid(member) AS member,pg_get_userbyid(grantor) AS grantor,admin_option,inherit_option,set_option FROM pg_auth_members WHERE roleid IN (SELECT oid FROM pg_roles WHERE rolname IN ('league_one_runtime','league_one_account','league_one_auth')) OR member IN (SELECT oid FROM pg_roles WHERE rolname IN ('league_one_runtime','league_one_account','league_one_auth'))",
  "defaultAcl": "SELECT pg_get_userbyid(d.defaclrole) AS owner,COALESCE(n.nspname,'$GLOBAL') AS schema,d.defaclobjtype::text AS object_type,CASE WHEN a.grantee=0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END AS grantee,pg_get_userbyid(a.grantor) AS grantor,a.privilege_type AS privilege,a.is_grantable AS grantable FROM pg_default_acl d LEFT JOIN pg_namespace n ON n.oid=d.defaclnamespace LEFT JOIN LATERAL aclexplode(CASE WHEN cardinality(d.defaclacl)>0 THEN d.defaclacl ELSE NULL END) a ON true WHERE n.nspname IN ('public','website_auth') OR d.defaclnamespace=0",
  "schemaAcl": "SELECT n.nspname AS schema,CASE WHEN a.grantee=0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END AS grantee,pg_get_userbyid(a.grantor) AS grantor,a.privilege_type AS privilege,a.is_grantable AS grantable FROM pg_namespace n CROSS JOIN LATERAL aclexplode(COALESCE(n.nspacl,acldefault('n',n.nspowner))) a WHERE n.nspname IN ('public','website_auth')",
  "relationAcl": "SELECT n.nspname AS schema,c.relname AS name,c.relkind::text AS kind,CASE WHEN a.grantee=0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END AS grantee,pg_get_userbyid(a.grantor) AS grantor,a.privilege_type AS privilege,a.is_grantable AS grantable FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace CROSS JOIN LATERAL aclexplode(COALESCE(c.relacl,acldefault(CASE WHEN c.relkind='S' THEN 's'::\"char\" ELSE 'r'::\"char\" END,c.relowner))) a WHERE n.nspname IN ('public','website_auth') AND c.relkind NOT IN ('i','I')",
  "columnAcl": "SELECT n.nspname AS schema,c.relname AS relation,at.attname AS column,CASE WHEN a.grantee=0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END AS grantee,pg_get_userbyid(a.grantor) AS grantor,a.privilege_type AS privilege,a.is_grantable AS grantable FROM pg_attribute at JOIN pg_class c ON c.oid=at.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace CROSS JOIN LATERAL aclexplode(CASE WHEN cardinality(at.attacl)>0 THEN at.attacl ELSE NULL END) a WHERE n.nspname IN ('public','website_auth') AND at.attnum>0 AND NOT at.attisdropped",
  "functionAcl": "SELECT n.nspname AS schema,p.oid::regprocedure::text AS signature,CASE WHEN a.grantee=0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END AS grantee,pg_get_userbyid(a.grantor) AS grantor,a.privilege_type AS privilege,a.is_grantable AS grantable FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace CROSS JOIN LATERAL aclexplode(COALESCE(p.proacl,acldefault('f',p.proowner))) a WHERE n.nspname IN ('public','website_auth')",
  "typeAcl": "SELECT n.nspname AS schema,t.typname AS name,CASE WHEN a.grantee=0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END AS grantee,pg_get_userbyid(a.grantor) AS grantor,a.privilege_type AS privilege,a.is_grantable AS grantable FROM pg_type t JOIN pg_namespace n ON n.oid=t.typnamespace CROSS JOIN LATERAL aclexplode(COALESCE(t.typacl,acldefault('T',t.typowner))) a WHERE n.nspname IN ('public','website_auth')",
  "databaseAcl": "SELECT CASE WHEN d.datname=current_database() THEN '$DATABASE' ELSE d.datname END AS database,pg_get_userbyid(d.datdba) AS owner,CASE WHEN a.grantee=0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END AS grantee,pg_get_userbyid(a.grantor) AS grantor,a.privilege_type AS privilege,a.is_grantable AS grantable FROM pg_database d CROSS JOIN LATERAL aclexplode(COALESCE(d.datacl,acldefault('d',d.datdba))) a WHERE d.datname=current_database()",
  "databasePrivileges": "SELECT r.rolname AS role,has_database_privilege(r.oid,current_database(),'CONNECT') AS connect,has_database_privilege(r.oid,current_database(),'CREATE') AS create,has_database_privilege(r.oid,current_database(),'TEMP') AS temporary FROM pg_roles r WHERE r.rolname IN ('league_one_runtime','league_one_account','league_one_auth')",
  "schemaPrivileges": "SELECT r.rolname AS role,n.nspname AS schema,has_schema_privilege(r.oid,n.oid,'USAGE') AS usage,has_schema_privilege(r.oid,n.oid,'CREATE') AS create FROM pg_roles r CROSS JOIN pg_namespace n WHERE r.rolname IN ('league_one_runtime','league_one_account','league_one_auth') AND n.nspname IN ('public','website_auth')",
  "tablePrivileges": "SELECT r.rolname AS role,n.nspname AS schema,c.relname AS relation,ARRAY(SELECT p FROM unnest(ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER','MAINTAIN']) p WHERE has_table_privilege(r.oid,c.oid,p) ORDER BY 1) AS privileges,ARRAY(SELECT p FROM unnest(ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER','MAINTAIN']) p WHERE has_table_privilege(r.oid,c.oid,p||' WITH GRANT OPTION') ORDER BY 1) AS grantable FROM pg_roles r CROSS JOIN pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE r.rolname IN ('league_one_runtime','league_one_account','league_one_auth') AND n.nspname IN ('public','website_auth') AND c.relkind IN ('r','p','v','m','f')",
  "columnPrivileges": "SELECT r.rolname AS role,n.nspname AS schema,c.relname AS relation,at.attname AS column,ARRAY(SELECT p FROM unnest(ARRAY['SELECT','INSERT','UPDATE','REFERENCES']) p WHERE has_column_privilege(r.oid,c.oid,at.attnum,p) ORDER BY 1) AS privileges,ARRAY(SELECT p FROM unnest(ARRAY['SELECT','INSERT','UPDATE','REFERENCES']) p WHERE has_column_privilege(r.oid,c.oid,at.attnum,p||' WITH GRANT OPTION') ORDER BY 1) AS grantable FROM pg_roles r CROSS JOIN pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace JOIN pg_attribute at ON at.attrelid=c.oid WHERE r.rolname IN ('league_one_runtime','league_one_account','league_one_auth') AND n.nspname IN ('public','website_auth') AND c.relkind IN ('r','p','v','m','f') AND at.attnum>0 AND NOT at.attisdropped",
  "sequencePrivileges": "SELECT r.rolname AS role,n.nspname AS schema,c.relname AS sequence,ARRAY(SELECT p FROM unnest(ARRAY['SELECT','UPDATE','USAGE']) p WHERE has_sequence_privilege(r.oid,c.oid,p) ORDER BY 1) AS privileges FROM pg_roles r CROSS JOIN pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE r.rolname IN ('league_one_runtime','league_one_account','league_one_auth') AND n.nspname IN ('public','website_auth') AND c.relkind='S'",
  "functionPrivileges": "SELECT r.rolname AS role,n.nspname AS schema,p.oid::regprocedure::text AS signature,has_function_privilege(r.oid,p.oid,'EXECUTE') AS execute,has_function_privilege(r.oid,p.oid,'EXECUTE WITH GRANT OPTION') AS grantable FROM pg_roles r CROSS JOIN pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE r.rolname IN ('league_one_runtime','league_one_account','league_one_auth') AND n.nspname IN ('public','website_auth')",
  "typePrivileges": "SELECT r.rolname AS role,n.nspname AS schema,t.typname AS type,has_type_privilege(r.oid,t.oid,'USAGE') AS usage,has_type_privilege(r.oid,t.oid,'USAGE WITH GRANT OPTION') AS grantable FROM pg_roles r CROSS JOIN pg_type t JOIN pg_namespace n ON n.oid=t.typnamespace WHERE r.rolname IN ('league_one_runtime','league_one_account','league_one_auth') AND n.nspname IN ('public','website_auth')"
};

function assertCatalogEnvelope(catalog: FreshInstallCatalog): void {
  invariant(catalog?.format === frozen.format, 'unknown catalog format.');
  invariant(/^18\d{4}$/u.test(catalog.postgresVersion), 'the frozen PostgreSQL 18 catalog requires PostgreSQL 18.');
  invariant(catalog.installer && typeof catalog.installer.name === 'string'
    && !APPLICATION_ROLES.some((role) => role === catalog.installer.name)
    && catalog.installer.inherit === true && catalog.installer.createRole === true,
  'installer identity or creator attributes are invalid.');
  invariant(catalog.bootstrap && catalog.bootstrap.oid === 10 && catalog.bootstrap.superuser === true
    && typeof catalog.bootstrap.name === 'string'
    && !APPLICATION_ROLES.some((role) => role === catalog.bootstrap.name), 'bootstrap grantor is not the verified bootstrap superuser.');
  invariant(catalog.installer.superuser === (catalog.installer.name === catalog.bootstrap.name),
    'installer does not match a frozen creator variant.');
  assertDatabasePlatform(catalog);
  invariant(isDeepStrictEqual(Object.keys(catalog.sections).sort(), Object.keys(frozen.catalog).sort()),
    'section inventory is not exact.');
}

function assertDatabasePlatform(catalog: FreshInstallCatalog): void {
  const observed = catalog.databasePlatform;
  if (Object.hasOwn(catalog, 'databasePlatform') && observed === null) return;
  const issues: PlatformIssueInput[] = [];
  if (!observed || typeof observed !== 'object' || Array.isArray(observed)) {
    throw new FreshInstallDatabasePlatformError([{ field: 'databasePlatform', requirement: 'required',
      expected: { kind: 'neon' }, observed }], catalog.postgresVersion);
  }
  if (!validBranchId(observed.branchId)) issues.push({ field: 'branchId', requirement: 'neon-branch-id', expected: undefined, observed: observed.branchId });
  if (catalog.installer.superuser !== false) issues.push({ field: 'installerSuperuser', requirement: 'equals', expected: false, observed: catalog.installer.superuser });
  const expected = { kind: 'neon', branchId: observed.branchId, databaseOwner: catalog.installer.name,
    role: { name: 'neon_superuser', superuser: false, inherit: true, createDb: true, createRole: true,
      login: false, replication: true, bypassRls: true }, installer: { member: true, usage: true },
    applicationRoles: APPLICATION_ROLES.map((role) => ({ role, member: false, usage: false })) };
  let unknownFields = 0;
  const compare = (wanted: unknown, actual: unknown, path: string): void => {
    if (Array.isArray(wanted)) {
      if (!Array.isArray(actual)) { issues.push({ field: path, requirement: 'required', expected: wanted, observed: actual }); return; }
      if (wanted.length !== actual.length) issues.push({ field: path, requirement: 'equals', expected: wanted.length, observed: actual.length });
      unknownFields += Math.max(0, actual.length - wanted.length);
      wanted.forEach((entry, index) => compare(entry, actual[index], `${path}[${index}]`)); return;
    }
    if (wanted && typeof wanted === 'object') {
      if (!actual || typeof actual !== 'object' || Array.isArray(actual)) {
        issues.push({ field: path || 'databasePlatform', requirement: 'required', expected: wanted, observed: actual }); return;
      }
      const keys = Object.keys(wanted), actualKeys = Object.keys(actual), unknown = actualKeys.filter((key) => !keys.includes(key));
      unknownFields += unknown.length;
      if (unknown.length || keys.some((key) => !Object.hasOwn(actual, key))) issues.push({ field: path || 'databasePlatform',
        requirement: 'exact-fields', expected: keys.length, observed: actualKeys.length });
      for (const key of keys) compare((wanted as RowObject)[key], (actual as RowObject)[key], path ? `${path}.${key}` : key);
      return;
    }
    if (!isDeepStrictEqual(wanted, actual)) issues.push({ field: path, requirement: 'equals', expected: wanted, observed: actual });
  };
  compare(expected, observed, '');
  if (issues.length) throw new FreshInstallDatabasePlatformError(issues, catalog.postgresVersion, unknownFields);
}
type RowObject = Record<string, unknown>;

/** Branch identity comes from the independently verified initial child target. */
export function assertFreshInstallDatabasePlatformBranch(catalog: FreshInstallCatalog, expectedBranchId: string): void {
  if (!validBranchId(expectedBranchId)) throw new FreshInstallDatabasePlatformError([{ field: 'branchId',
    requirement: 'neon-branch-id', expected: undefined, observed: expectedBranchId }], catalog.postgresVersion);
  assertDatabasePlatform(catalog);
  if (catalog.databasePlatform === null) throw new FreshInstallDatabasePlatformError([{ field: 'databasePlatform',
    requirement: 'required', expected: { kind: 'neon', branchId: expectedBranchId }, observed: null }], catalog.postgresVersion);
  if (catalog.databasePlatform.branchId !== expectedBranchId) {
    throw new FreshInstallDatabasePlatformError([{ field: 'branchId', requirement: 'equals',
      expected: expectedBranchId, observed: catalog.databasePlatform.branchId }], catalog.postgresVersion);
  }
}

/** Only the two preimplementation PostgreSQL 18 creator variants are accepted.
 * A trusted pgcrypto install by a nonsuperuser is owned by the bootstrap
 * superuser. Its exact 37 signatures and 74 ACL rows were separately installed
 * and compared before implementation; no application function owner changes. */
function expectedRows(catalog: FreshInstallCatalog, section: string): readonly CatalogRow[] {
  const original = frozen.catalog[section];
  // Neon compute_ctl fa504217c61bbcaf5c512d75830564541f917f8f grants
  // CONNECT/CREATE/TEMPORARY without grant option to its fixed admin role.
  // The witness is independently bound to the authorized child by the evidence
  // envelope; neither these rows nor their expected values are learned from ACLs.
  if (section === 'databaseAcl' && catalog.databasePlatform !== null) return [...original,
    ...['CONNECT', 'CREATE', 'TEMPORARY'].map((privilege) => ({ database: '$DATABASE', owner: '$INSTALLER',
      grantee: 'neon_superuser', grantor: '$INSTALLER', privilege, grantable: false }))];
  if (catalog.installer.superuser || !['functions', 'functionAcl'].includes(section)) return original;
  const extensionFunctions = new Set(frozen.catalog.functions.filter((row) => row.extension === 'pgcrypto').map((row) => row.signature));
  return original.map((row) => {
    if (!extensionFunctions.has(row.signature)) return row;
    return Object.fromEntries(Object.entries(row).map(([key, value]) =>
      [key, ['owner', 'grantor', 'grantee'].includes(key) && value === '$INSTALLER' ? '$BOOTSTRAP' : value]));
  });
}

export function assertFreshInstallCatalog(catalog: FreshInstallCatalog): void {
  assertCatalogEnvelope(catalog);
  for (const section of STRUCTURE_SECTIONS) assertRows(catalog.sections[section], expectedRows(catalog, section), section);
}

function membershipRows(catalog: FreshInstallCatalog): CatalogRow[] {
  const expectedMemberships: CatalogRow[] = APPLICATION_ROLES.map((role) => ({ role,
    member: '$INSTALLER', grantor: '$INSTALLER', admin_option: false, inherit_option: true, set_option: true }));
  if (!catalog.installer.superuser) {
    expectedMemberships.push(...APPLICATION_ROLES.map((role) => ({ role,
      member: '$INSTALLER', grantor: '$BOOTSTRAP', admin_option: true, inherit_option: false, set_option: false })));
  }
  return expectedMemberships;
}
function rawMembershipRows(catalog: FreshInstallCatalog, expected: readonly CatalogRow[]): CatalogRow[] {
  return expected.map((row) => Object.fromEntries(Object.entries(row).map(([key, value]) =>
    [key, value === '$INSTALLER' ? catalog.installer.name : value === '$BOOTSTRAP' ? catalog.bootstrap.name : value])));
}
export function assertFreshInstallPrivileges(catalog: FreshInstallCatalog): void {
  assertCatalogEnvelope(catalog);
  for (const section of PRIVILEGE_SECTIONS) assertRows(catalog.sections[section], expectedRows(catalog, section), section);
  const expectedMemberships = membershipRows(catalog);
  assertRows(catalog.sections.memberships, expectedMemberships, 'memberships');
  assertRows(catalog.membershipEvidence, rawMembershipRows(catalog, expectedMemberships), 'membershipEvidence');
}

/** The caller must supply an idle, exclusively pinned owner connection. This
 * bounded read-only transaction fixes deparser search_path and one snapshot.
 * It never opens a connection, mutates grants or creates an expected oracle. */
export async function readFreshInstallCatalog(
  query: FreshInstallCatalogQuery, installerRole: string,
): Promise<FreshInstallCatalog> {
  invariant(typeof installerRole === 'string' && installerRole.length > 0
    && !APPLICATION_ROLES.some((role) => role === installerRole), 'a verified installer identity is required.');
  await query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  try {
    await query("SET LOCAL search_path = pg_catalog");
    await query("SET LOCAL statement_timeout = '10s'");
    const identity = (await query(`SELECT current_user AS current_user, session_user AS session_user,
      current_setting('server_version_num') AS version, i.rolname AS installer_name,
      i.rolsuper AS installer_superuser, i.rolinherit AS installer_inherit, i.rolcreaterole AS installer_create_role,
      b.rolname AS bootstrap_name, b.oid::integer AS bootstrap_oid, b.rolsuper AS bootstrap_superuser
      FROM pg_roles i CROSS JOIN pg_roles b WHERE i.rolname=current_user AND b.oid=10`))[0];
    invariant(identity && identity.current_user === installerRole && identity.session_user === installerRole,
      'catalog connection does not match the verified installer LOGIN identity.');
    const platformRows = await query(`SELECT current_setting('neon.branch_id',true) AS branch_id,
      pg_get_userbyid(d.datdba) AS database_owner, p.rolname AS platform_name,
      p.rolsuper AS superuser, p.rolinherit AS inherit, p.rolcreatedb AS create_db, p.rolcreaterole AS create_role,
      p.rolcanlogin AS login, p.rolreplication AS replication, p.rolbypassrls AS bypass_rls,
      pg_has_role(current_user,p.oid,'MEMBER') AS installer_member,
      pg_has_role(current_user,p.oid,'USAGE') AS installer_usage
      FROM pg_database d LEFT JOIN pg_roles p ON p.rolname='neon_superuser' WHERE d.datname=current_database()`);
    if (platformRows.length !== 1) throw new FreshInstallDatabasePlatformError([{ field: 'observationRows',
      requirement: 'equals', expected: 1, observed: platformRows.length }], identity.version);
    const platform = platformRows[0];
    const noBranch = platform.branch_id === null || platform.branch_id === '';
    if (!((noBranch && platform.platform_name === null) || (!noBranch && platform.platform_name === 'neon_superuser'))) {
      throw new FreshInstallDatabasePlatformError([
        { field: 'branchId', requirement: 'paired-presence', expected: undefined, observed: platform.branch_id },
        { field: 'role.name', requirement: 'paired-presence', expected: noBranch ? null : 'neon_superuser', observed: platform.platform_name },
      ], identity.version);
    }
    let databasePlatform: FreshInstallDatabasePlatform | null = null;
    if (!noBranch) {
      const applicationRoles = await query(`SELECT r.rolname AS role,
        pg_has_role(r.oid,p.oid,'MEMBER') AS member, pg_has_role(r.oid,p.oid,'USAGE') AS usage
        FROM pg_roles r CROSS JOIN pg_roles p WHERE p.rolname='neon_superuser'
        AND r.rolname IN ('league_one_account','league_one_auth','league_one_runtime') ORDER BY r.rolname`);
      databasePlatform = { kind: 'neon', branchId: platform.branch_id as string, databaseOwner: platform.database_owner as string,
        role: { name: platform.platform_name as string, superuser: platform.superuser as boolean,
          inherit: platform.inherit as boolean, createDb: platform.create_db as boolean, createRole: platform.create_role as boolean,
          login: platform.login as boolean, replication: platform.replication as boolean, bypassRls: platform.bypass_rls as boolean },
        installer: { member: platform.installer_member as boolean, usage: platform.installer_usage as boolean },
        applicationRoles: applicationRoles as FreshInstallDatabasePlatform['applicationRoles'] };
    }
    const catalog: FreshInstallCatalog = {
      format: 'cp21-installed-catalog-v1', postgresVersion: String(identity.version),
      installer: { name: String(identity.installer_name), superuser: identity.installer_superuser === true,
        inherit: identity.installer_inherit === true, createRole: identity.installer_create_role === true },
      bootstrap: { name: String(identity.bootstrap_name), oid: Number(identity.bootstrap_oid),
        superuser: identity.bootstrap_superuser === true },
      databasePlatform, membershipEvidence: [], sections: {},
    };
    // Reject an incomplete or invalid witness before reading application
    // sections; a reader-side platform failure is not a completed snapshot.
    assertDatabasePlatform(catalog);
    const sections: Record<string, readonly CatalogRow[]> = {};
    let membershipEvidence: readonly CatalogRow[] = [];
    for (const [section, statement] of Object.entries(CATALOG_QUERIES)) {
      const rawRows = await query(statement);
      if (section === 'memberships') membershipEvidence = ordered(rawRows);
      let normalized = rawRows.map((row) => Object.fromEntries(Object.entries(row).map(([key, value]) => [key,
        identityKeys.has(key) && value === catalog.installer.name ? '$INSTALLER'
          : identityKeys.has(key) && value === catalog.bootstrap.name ? '$BOOTSTRAP' : value])));
      if (section === 'functions') normalized = normalized.map(({ body, definition, ...row }) => {
        invariant(typeof body === 'string' && typeof definition === 'string', 'function source is missing.');
        return { ...row, bodyLfSha256: sha256(lf(body)), definitionLfSha256: sha256(lf(definition)) };
      });
      sections[section] = ordered(normalized);
    }
    const result = { ...catalog, membershipEvidence, sections };
    assertCatalogEnvelope(result);
    await query('COMMIT');
    return result;
  } catch (error) {
    await query('ROLLBACK').catch(() => undefined);
    throw error;
  }
}

/** Re-read the current installation inputs and require the exact frozen ordered
 * names and LF digests. A matching current-source hash alone cannot qualify SQL. */
export async function readFreshInstallSources(): Promise<FreshInstallSources> {
  const directory = new URL('../migrations/', import.meta.url);
  const names = (await readdir(directory)).filter((name) => /^\d+_[a-z0-9_]+\.sql$/u.test(name)).sort();
  invariant(isDeepStrictEqual(names, frozen.migrations.map((entry) => entry.name)), 'migration file inventory changed.');
  const migrations: { name: string; checksum: string; lfSha256: string }[] = [];
  for (const name of names) {
    const checksum = sha256(lf(await readFile(new URL(name, directory), 'utf8')));
    migrations.push({ name, checksum, lfSha256: checksum });
  }
  const provisioners: { name: string; lfSha256: string }[] = [];
  for (const { name } of frozen.provisioners) {
    provisioners.push({ name, lfSha256: sha256(lf(await readFile(new URL(`../scripts/${name}`, import.meta.url), 'utf8'))) });
  }
  const sources = { migrations, provisioners };
  invariant(isDeepStrictEqual(sources, { migrations: frozen.migrations, provisioners: frozen.provisioners }),
    'migration or provisioner bytes changed from the frozen source.');
  return sources;
}
