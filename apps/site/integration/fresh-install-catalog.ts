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
export class FreshInstallCatalogMismatchError extends Error {
  readonly mismatch: FreshInstallCatalogMismatch;
  constructor(section: string, expected: readonly CatalogRow[], observed: readonly CatalogRow[], firstDifferingRow: number) {
    if (section !== 'membershipEvidence' && !Object.hasOwn(frozen.catalog, section)) throw new Error('Fresh-install catalog: unknown mismatch section.');
    const expectedRow = expected[firstDifferingRow], observedRow = observed[firstDifferingRow];
    const mismatch: FreshInstallCatalogMismatch = Object.freeze({ section, expectedRows: expected.length, observedRows: observed.length,
      firstDifferingRow, expectedRowDigest: valueDiagnostic(expectedRow).sha256, observedRowDigest: valueDiagnostic(observedRow).sha256,
      ...(section === 'policies' ? { policyFields: Object.freeze(POLICY_FIELDS
        .filter((field) => !isDeepStrictEqual(expectedRow?.[field], observedRow?.[field]))
        .map((field) => Object.freeze({ field, expected: valueDiagnostic(expectedRow?.[field]), observed: valueDiagnostic(observedRow?.[field]) }))) } : {}) });
    super(`Fresh-install catalog: ${mismatch.section} differs from frozen inventory; expected ${mismatch.expectedRows} rows, observed ${mismatch.observedRows}, first differing row ${mismatch.firstDifferingRow}.`);
    this.name = 'FreshInstallCatalogMismatchError';
    this.mismatch = mismatch;
  }
}
export type FreshInstallCatalogQuery = (statement: string, parameters?: readonly unknown[]) => Promise<readonly CatalogRow[]>;
export type FreshInstallSources = Readonly<{
  migrations: readonly Readonly<{ name: string; checksum: string; lfSha256: string }>[];
  provisioners: readonly Readonly<{ name: string; lfSha256: string }>[];
}>;
export type FreshInstallCatalog = Readonly<{
  format: 'cp21-installed-catalog-v1';
  postgresVersion: string;
  installer: Readonly<{ name: string; superuser: boolean; inherit: boolean; createRole: boolean }>;
  bootstrap: Readonly<{ name: string; oid: number; superuser: boolean }>;
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
  // Retain types and hashes for a bounded unverified diagnostic, never row values,
  // function bodies, expressions or the complete 3.7 MiB catalog.
  throw new FreshInstallCatalogMismatchError(section, sortedExpected, sortedActual, firstDifferingRow);
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
  invariant(isDeepStrictEqual(Object.keys(catalog.sections).sort(), Object.keys(frozen.catalog).sort()),
    'section inventory is not exact.');
}

/** Only the two preimplementation PostgreSQL 18 creator variants are accepted.
 * A trusted pgcrypto install by a nonsuperuser is owned by the bootstrap
 * superuser. Its exact 37 signatures and 74 ACL rows were separately installed
 * and compared before implementation; no application function owner changes. */
function expectedRows(catalog: FreshInstallCatalog, section: string): readonly CatalogRow[] {
  const original = frozen.catalog[section];
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

export function assertFreshInstallPrivileges(catalog: FreshInstallCatalog): void {
  assertCatalogEnvelope(catalog);
  for (const section of PRIVILEGE_SECTIONS) assertRows(catalog.sections[section], expectedRows(catalog, section), section);
  const expectedMemberships: CatalogRow[] = APPLICATION_ROLES.map((role) => ({ role,
    member: '$INSTALLER', grantor: '$INSTALLER', admin_option: false, inherit_option: true, set_option: true }));
  if (!catalog.installer.superuser) {
    expectedMemberships.push(...APPLICATION_ROLES.map((role) => ({ role,
      member: '$INSTALLER', grantor: '$BOOTSTRAP', admin_option: true, inherit_option: false, set_option: false })));
  }
  assertRows(catalog.sections.memberships, expectedMemberships, 'memberships');
  const rawExpected = expectedMemberships.map((row) => Object.fromEntries(Object.entries(row).map(([key, value]) =>
    [key, value === '$INSTALLER' ? catalog.installer.name : value === '$BOOTSTRAP' ? catalog.bootstrap.name : value])));
  assertRows(catalog.membershipEvidence, rawExpected, 'membershipEvidence');
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
    const catalog: FreshInstallCatalog = {
      format: 'cp21-installed-catalog-v1', postgresVersion: String(identity.version),
      installer: { name: String(identity.installer_name), superuser: identity.installer_superuser === true,
        inherit: identity.installer_inherit === true, createRole: identity.installer_create_role === true },
      bootstrap: { name: String(identity.bootstrap_name), oid: Number(identity.bootstrap_oid),
        superuser: identity.bootstrap_superuser === true },
      membershipEvidence: [], sections: {},
    };
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
