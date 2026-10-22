import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { Socket } from 'node:net';
import { join } from 'node:path';
import { vi } from 'vitest';
import type { PoolConfig } from '@neondatabase/serverless';
import type { IndependentDatabase } from './neon-integration-harness';

/** Only the owned local diagnostic loads this setup file. The hosted harness,
 * case bodies, SQL, pinned session/savepoints and installed driver stay intact. */
type LocalContext = { authorization: string; database: string; port: number; sentinel: string; version: string;
  ownerUrl: string; runtimeUrl: string; site: string; directory: string; baseMigrationNames: string[] };
const local = JSON.parse(process.env.L1_LOCAL_CANONICAL_CONTEXT ?? 'null') as LocalContext | null;
assert(local?.authorization === 'I_AUTHORIZE_OWNED_LOOPBACK_CANONICAL_SUITE');
assert(/^l1_setup_fresh_[0-9a-f]{8}$/u.test(local.database));
assert(Number.isInteger(local.port) && local.port > 0 && local.port < 65536);
assert(/^[0-9a-f]{8}-[0-9a-f-]{27}$/u.test(local.sentinel));
assert(/^180\d{3}$/u.test(local.version));
for (const [url, role] of [[local.ownerUrl, 'l1_setup_owner'], [local.runtimeUrl, 'league_one_runtime']]) {
  const parsed = new URL(url);
  assert.equal(parsed.protocol, 'postgresql:'); assert.equal(parsed.hostname, '127.0.0.1');
  assert.equal(parsed.port, String(local.port)); assert.equal(parsed.pathname, '/' + local.database);
  assert.equal(parsed.username, role); assert(/^[0-9a-f]{64}$/u.test(parsed.password));
  assert.equal(parsed.search, ''); assert.equal(parsed.hash, '');
}
const sockets: Socket[] = [], identities: object[] = [];
let roleGrants: readonly object[] = [];
let prepared = false, forbiddenFetches = 0;
const receipt = () => writeFileSync(join(local.directory, 'local-session-evidence.json'), JSON.stringify({
  kind: 'canonical-local-sessions-v1', transport: 'owned-loopback-postgresql', hostedQualification: false,
  identities, roleGrants, prepared, forbiddenFetches,
}, null, 2));
// The case's retained Neon fetch exception can only reach this denial, never a network.
globalThis.fetch = async () => { forbiddenFetches++; receipt(); throw new Error('Local canonical suite forbids actual HTTP.'); };

// Loopback uses the actual pinned PostgreSQL stream, so there is no permitted
// database HTTP request. Keep the case's fixture/provider tripwire in control.
vi.mock('./backend-controls-fetch', () => ({
  createBackendControlsDatabaseFetchGuard: (url: string) => {
    assert(local); assert.equal(url, local.runtimeUrl); return () => false;
  },
}));

vi.mock('@neondatabase/serverless', async importOriginal => {
  const original = await importOriginal<typeof import('@neondatabase/serverless')>();
  return { ...original, Pool: class extends original.Pool {
    constructor(config?: PoolConfig) {
      assert(local && config && [local.ownerUrl, local.runtimeUrl].includes(config.connectionString ?? ''),
        'Local transport rejects every unowned URL before connecting.');
      assert.equal(config.max, 1);
      const socket = new Socket(); sockets.push(socket);
      super({ ...config, ssl: false, connectionTimeoutMillis: 5000, statement_timeout: 10_000,
        query_timeout: 15_000, idle_in_transaction_session_timeout: 30_000,
        // Installed Neon accepts a Socket (as in the existing local diagnostic),
        // although its inherited declaration describes only a stream factory.
        stream: socket as unknown as NonNullable<PoolConfig['stream']> });
    }
  } };
});

vi.mock('./neon-integration-harness', async importOriginal => {
  const original = await importOriginal<typeof import('./neon-integration-harness')>();
  async function pin(role: 'owner' | 'runtime' = 'runtime'): Promise<IndependentDatabase> {
    assert(local); assert(role === 'owner' || role === 'runtime');
    const session = await original.createIndependentPinnedDatabase(role === 'owner' ? local.ownerUrl : local.runtimeUrl);
    try {
      const [identity] = await session.database.query(`SELECT current_database() AS database,current_user,session_user,
        host(inet_server_addr()) AS host,inet_server_port() AS port,current_setting('server_version_num') AS version,
        shobj_description(d.oid,'pg_database') AS sentinel,r.rolsuper,r.rolcreatedb,r.rolcreaterole,r.rolreplication,
        r.rolbypassrls,r.rolcanlogin,EXISTS(SELECT 1 FROM pg_auth_members m WHERE m.member=r.oid) AS memberships
        FROM pg_database d JOIN pg_roles r ON r.rolname=current_user WHERE d.datname=current_database()`);
      const name = role === 'owner' ? 'l1_setup_owner' : 'league_one_runtime';
      assert.deepEqual(identity, { database: local.database, current_user: name, session_user: name,
        host: '127.0.0.1', port: local.port, version: local.version, sentinel: local.sentinel,
        rolsuper: false, rolcreatedb: role === 'owner', rolcreaterole: role === 'owner', rolreplication: false,
        rolbypassrls: false, rolcanlogin: true, memberships: role === 'owner' });
      for (const socket of sockets.filter(value => !value.destroyed)) {
        assert.equal(socket.remoteAddress, '127.0.0.1'); assert.equal(socket.remotePort, local.port);
      }
      identities.push({ role, ...identity }); receipt(); return session;
    } catch (error) { await session.close(); throw error; }
  }
  return { ...original,
    createPinnedIntegrationDatabase: pin,
    integrationEnvironment: () => {
      assert(local); return { ownerDatabaseUrl: local.ownerUrl, runtimeDatabaseUrl: local.runtimeUrl,
        expectedDatabase: local.database, expectedBranchId: 'local-owned-only', expectedBranchName: 'local-owned-only',
        databaseSentinel: local.sentinel, productionDenylist: new Set<string>() };
    },
    prepareIntegrationDatabase: async (options: unknown) => {
      assert(local); assert.equal(prepared, false);
      assert.deepEqual(options, { throughMigration: '065_roster_provenance_contents.sql' });
      const session = await pin('owner');
      try {
        const names = readdirSync(join(local.site, 'migrations')).filter(name => /^\d+_[a-z0-9_]+\.sql$/u.test(name)).sort().slice(0, 65);
        assert.deepEqual(local.baseMigrationNames, names); assert.equal(names.length, 65);
        const ledger = await session.database.query('SELECT name,checksum FROM app_schema_migrations ORDER BY name');
        assert.deepEqual(ledger, names.map(name => ({ name, checksum: createHash('sha256')
          .update(readFileSync(join(local.site, 'migrations', name), 'utf8').replace(/\r\n/g, '\n')).digest('hex') })));
        // Reapply the exact three maintained provisioners, then inspect creator
        // ADMIN and explicit SET-only grants. Restricted roles gain no owner membership.
        for (const role of ['runtime', 'account', 'auth']) await session.database.query(
          readFileSync(join(local.site, 'scripts', `provision-${role}-role.sql`), 'utf8'));
        const grants = await session.database.query(`SELECT granted.rolname AS role,grantor.rolname AS grantor,m.admin_option,m.inherit_option,m.set_option
          FROM pg_auth_members m JOIN pg_roles granted ON granted.oid=m.roleid JOIN pg_roles member ON member.oid=m.member
          JOIN pg_roles grantor ON grantor.oid=m.grantor
          WHERE member.rolname='l1_setup_owner' ORDER BY granted.rolname,grantor.rolname`);
        roleGrants = grants; receipt();
        assert.deepEqual(grants, ['league_one_account', 'league_one_auth', 'league_one_runtime'].flatMap(role => [
          { role, grantor: 'l1_setup_cluster_admin', admin_option: true, inherit_option: false, set_option: false },
          { role, grantor: 'l1_setup_owner', admin_option: false, inherit_option: false, set_option: true },
        ]));
        const restricted = await session.database.query(`SELECT rolname,rolsuper,rolcreatedb,rolcreaterole,rolreplication,rolbypassrls,
          EXISTS(SELECT 1 FROM pg_auth_members m WHERE m.member=r.oid) AS memberships
          FROM pg_roles r WHERE rolname=ANY($1::text[]) ORDER BY rolname`, [['league_one_account', 'league_one_auth', 'league_one_runtime']]);
        assert.deepEqual(restricted, ['league_one_account', 'league_one_auth', 'league_one_runtime'].map(rolname => ({ rolname,
          rolsuper: false, rolcreatedb: false, rolcreaterole: false, rolreplication: false, rolbypassrls: false, memberships: false })));
        prepared = true; receipt();
      } finally { await session.close(); }
    },
  };
});
