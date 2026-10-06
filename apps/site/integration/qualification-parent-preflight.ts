import assert from 'node:assert/strict';
import { Pool } from '@neondatabase/serverless';
import { DisposableNeonApi } from './disposable-neon-api';
// @ts-expect-error Operational ESM shared URL validator has no declaration.
import { migrationOwnerUrl } from '../scripts/account-transition-preflight.mjs';

export const QUALIFICATION_PARENT = Object.freeze({ projectId: 'steep-glitter-44680287',
  projectName: 'league-one-integration-tests', parentBranchId: 'br-plain-bread-b7sgfdl8',
  parentBranchName: 'integration-test-base', databaseName: 'integration_test', ownerRoleName: 'neondb_owner' });
export type ParentApproval = Readonly<{ reviewedSha: string; authorization: string;
  credentialProvenanceEvidenceHash: string; quiescenceEvidenceHash: string;
  expectedDatabaseNames: readonly string[]; expectedRoles: readonly Record<string, unknown>[];
  expectedRoleMemberships: readonly Record<string, unknown>[] }>;
type Query = (sql: string) => Promise<{ rows: Record<string, unknown>[] }>;

export function validateParentApproval(value: unknown): ParentApproval {
  const input = value as ParentApproval;
  if (!input || typeof input !== 'object' || Array.isArray(input)
    || input.authorization !== 'I_AUTHORIZE_ONE_READ_ONLY_TEST_PARENT_PREFLIGHT'
    || !/^[a-f0-9]{40}$/u.test(input.reviewedSha)
    || !/^[a-f0-9]{64}$/u.test(input.credentialProvenanceEvidenceHash)
    || !/^[a-f0-9]{64}$/u.test(input.quiescenceEvidenceHash)
    || !Array.isArray(input.expectedDatabaseNames) || input.expectedDatabaseNames.length < 1
    || input.expectedDatabaseNames.length > 10
    || new Set(input.expectedDatabaseNames).size !== input.expectedDatabaseNames.length
    || input.expectedDatabaseNames.some(name => !/^[a-z][a-z0-9_]{0,62}$/u.test(name)
      || ['projection_refactor_test','account_reset_integration_test'].includes(name))
    || !input.expectedDatabaseNames.includes('integration_test')
    || !Array.isArray(input.expectedRoles) || !input.expectedRoles.length
    || !Array.isArray(input.expectedRoleMemberships)) throw new Error('Explicit reviewed parent inspection approval required.');
  // The hashes reference independently reviewed evidence. They cannot prove
  // which secret GitHub stored, or enforce an external service boundary drain.
  return input;
}

export async function inspectParentCatalog(query: Query, database: string, approval: ParentApproval) {
  const identity = (await query(`SELECT current_database() AS database,session_user AS login,current_user AS actor,
    (SELECT jsonb_object_agg(name,jsonb_build_object('value',setting,'context',context,'pending',pending_restart))
    FROM pg_settings WHERE name IN ('neon.project_id','neon.branch_id')) AS settings,
    (SELECT ssl FROM pg_stat_ssl WHERE pid=pg_backend_pid()) AS tls`)).rows;
  assert.deepEqual(identity, [{ database, login: 'neondb_owner', actor: 'neondb_owner', tls: true,
    settings: { 'neon.project_id': { value: QUALIFICATION_PARENT.projectId, context: 'postmaster', pending: false },
      'neon.branch_id': { value: QUALIFICATION_PARENT.parentBranchId, context: 'postmaster', pending: false } } }]);
  const databases = (await query(`SELECT datname AS name,datistemplate AS template,datallowconn AS connectable
    FROM pg_database ORDER BY datname`)).rows;
  assert.deepEqual(databases.filter(row => row.template === false).map(row => row.name), [...approval.expectedDatabaseNames].sort());
  // Never alter a non-connectable database to inspect it. Any nonstandard
  // inaccessible database prevents a complete proof. The immutable platform
  // template0 remains an explicit separately reviewed limitation in the receipt.
  assert.ok(databases.every(row => row.connectable === true || (row.name === 'template0' && row.template === true)));
  const roles = (await query(`SELECT rolname AS name,rolcanlogin AS login,rolsuper AS superuser,
    rolcreatedb AS createdb,rolcreaterole AS createrole,rolreplication AS replication,
    rolinherit AS inherit,rolbypassrls AS bypassrls FROM pg_roles ORDER BY rolname`)).rows;
  assert.ok(!roles.some(role => ['league_one_account','league_one_auth','league_one_runtime'].includes(String(role.name))));
  assert.deepEqual(roles, approval.expectedRoles);
  const memberships = (await query(`SELECT role.rolname AS role,member.rolname AS member,
    membership.admin_option AS admin,membership.inherit_option AS inherit,membership.set_option AS "set",
    grantor.rolname AS grantor FROM pg_auth_members membership
    JOIN pg_roles role ON role.oid=membership.roleid JOIN pg_roles member ON member.oid=membership.member
    JOIN pg_roles grantor ON grantor.oid=membership.grantor
    ORDER BY role.rolname,member.rolname`)).rows;
  assert.deepEqual(memberships, approval.expectedRoleMemberships);
  const counts = (await query(`SELECT
    (SELECT count(*)::int FROM pg_namespace WHERE nspname NOT IN ('public','information_schema') AND left(nspname,3)<>'pg_') AS schemas,
    (SELECT count(*)::int FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public') AS relations,
    (SELECT count(*)::int FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public') AS functions,
    (SELECT count(*)::int FROM pg_type t JOIN pg_namespace n ON n.oid=t.typnamespace WHERE n.nspname='public') AS types,
    (SELECT count(*)::int FROM pg_stat_activity WHERE pid<>pg_backend_pid() AND backend_type='client backend') AS sessions,
    (SELECT count(*)::int FROM pg_extension WHERE extname<>'plpgsql') AS extensions,
    (SELECT count(*)::int FROM pg_largeobject_metadata) AS largeobjects,
    (SELECT count(*)::int FROM pg_foreign_server) AS foreignservers,
    (SELECT count(*)::int FROM pg_publication) AS publications,
    (SELECT count(*)::int FROM pg_subscription) AS subscriptions,
    (SELECT count(*)::int FROM pg_event_trigger) AS eventtriggers,
    (SELECT count(*)::int FROM pg_default_acl) AS defaultacls`)).rows;
  assert.deepEqual(counts, [{schemas:0,relations:0,functions:0,types:0,sessions:0,extensions:0,
    largeobjects:0,foreignservers:0,publications:0,subscriptions:0,eventtriggers:0,defaultacls:0}]);
  return { database, databases, counts: counts[0] };
}

/** Explicitly paid-capable and credential-bearing when executed. No calls run
 * on import. GET-only API, existing fixed parent endpoint, readonly catalogs;
 * no child creation, role/password mutation, schema reset or test dispatch. */
export async function runParentPreflight(apiKey: string, approvalValue: unknown, signal: AbortSignal) {
  const approval = validateParentApproval(approvalValue);
  const api = new DisposableNeonApi({apiKey, signal, requestTimeoutMs: 15000});
  await api.validateTarget(QUALIFICATION_PARENT);
  const prefix = `/projects/${QUALIFICATION_PARENT.projectId}`;
  const inventory = async () => {
    const reply = await api.request<{databases:{name:string;owner_name:string}[]}>('GET', `${prefix}/branches/${QUALIFICATION_PARENT.parentBranchId}/databases`);
    assert.deepEqual(reply.databases.map(db => db.name).sort(), [...approval.expectedDatabaseNames].sort());
    assert.ok(reply.databases.every(db => db.owner_name === 'neondb_owner'));
    return reply.databases.map(db => db.name).sort();
  };
  const before = await inventory();
  const endpoints = await api.request<{endpoints:Record<string,unknown>[]}>('GET', `${prefix}/endpoints`);
  const targets = endpoints.endpoints.filter(endpoint => endpoint.branch_id === QUALIFICATION_PARENT.parentBranchId);
  assert.equal(targets.length,1);
  const endpoint = targets[0];
  assert.equal(endpoint.project_id,QUALIFICATION_PARENT.projectId);
  assert.match(String(endpoint.id),/^ep-[a-z0-9-]+$/u);
  assert.ok(typeof endpoint.host === 'string' && endpoint.host.startsWith(`${endpoint.id}.`) && endpoint.host.endsWith('.neon.tech'));
  assert.equal(endpoint.autoscaling_limit_min_cu,0.25); assert.equal(endpoint.autoscaling_limit_max_cu,0.25);
  assert.equal(endpoint.suspend_timeout_seconds,300); assert.equal(endpoint.type,'read_write');
  const params = new URLSearchParams({branch_id:QUALIFICATION_PARENT.parentBranchId,endpoint_id:String(endpoint.id),
    database_name:'integration_test',role_name:'neondb_owner',pooled:'false'});
  const response = await api.request<{uri:string}>('GET',`${prefix}/connection_uri?${params}`);
  const ownerUrl = new URL(migrationOwnerUrl(response.uri));
  assert.equal(ownerUrl.hostname,endpoint.host); assert.equal(decodeURIComponent(ownerUrl.username),'neondb_owner');
  assert.equal(decodeURIComponent(ownerUrl.pathname.slice(1)),'integration_test');
  const results: Awaited<ReturnType<typeof inspectParentCatalog>>[] = [];
  // Inspect every API database plus connectable platform template1. Recheck
  // catalogs after each connection; never read rows from application tables.
  for (const database of [...before, 'template1']) {
    signal.throwIfAborted();
    const url = new URL(ownerUrl); url.pathname=`/${database}`;
    const pool = new Pool({connectionString:url.toString(),max:1,connectionTimeoutMillis:5000,
      query_timeout:10000,statement_timeout:8000});
    pool.on('error',()=>{});
    try {
      const client = await pool.connect();
      try {
        await client.query('BEGIN READ ONLY');
        await client.query('SET LOCAL search_path=pg_catalog');
        results.push(await inspectParentCatalog(client.query.bind(client), database, approval));
        await client.query('ROLLBACK');
      } finally { client.release(true); }
    } finally { await pool.end(); }
  }
  assert.deepEqual(await inventory(),before);
  await api.validateTarget(QUALIFICATION_PARENT);
  signal.throwIfAborted();
  return { kind:'test-parent-inspection-v1', reviewedSha:approval.reviewedSha, projectId:QUALIFICATION_PARENT.projectId,
    parentBranchId:QUALIFICATION_PARENT.parentBranchId, databases:results,
    credentialProvenanceEvidenceHash:approval.credentialProvenanceEvidenceHash,
    quiescenceEvidenceHash:approval.quiescenceEvidenceHash,
    credentialBindingProvenByThisCommand:false, template0Inspected:false,
    quiescenceEnforcedByThisCommand:false, parentRaceExcluded:false, qualification:'unverified' };
}
