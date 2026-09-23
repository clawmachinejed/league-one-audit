import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Pool, type PoolClient } from '@neondatabase/serverless';

export const INTEGRATION_MUTEX = 'league-one-auth-integration-credential';
export const INTEGRATION_OWNER_ENV = 'PROJECTION_INTEGRATION_OWNER_PROOF';
type Row = Readonly<Record<string, unknown>>;
export type IntegrationQuery = (statement: string, parameters?: readonly unknown[]) => Promise<readonly Row[]>;
export type IntegrationTarget = Readonly<{ database: string; branch: string }>;
export type IntegrationOwnerProof = IntegrationTarget & Readonly<{
  pid: number; backendStart: string; applicationName: string; lockMode: 'ExclusiveLock' | 'ShareLock';
}>;
export type IntegrationSession = Readonly<{
  query: PoolClient['query'];
  connect: () => Promise<Pick<PoolClient, 'query' | 'release'>>;
}>;
type Environment = Readonly<{ ownerDatabaseUrl: string; expectedDatabase: string; expectedBranchId: string }>;

/** A delegated reset must identify the exact live session that owns the mutex.
 * Merely finding somebody else's lock never authorizes a reset. */
export async function assertIntegrationOwner(query: IntegrationQuery, target: IntegrationTarget,
  serialized: string | undefined, requiredMode?: IntegrationOwnerProof['lockMode']): Promise<void> {
  if (!serialized) throw new Error('Integration reset requires its live supervisor ownership proof.');
  const proof: IntegrationOwnerProof = JSON.parse(serialized);
  assert.equal(proof.database, target.database); assert.equal(proof.branch, target.branch);
  assert.ok(Number.isSafeInteger(proof.pid) && proof.pid > 0);
  assert.ok(/^(?:capacity|integration)-owner-[a-f0-9-]{36}$/u.test(proof.applicationName));
  assert.ok(Number.isFinite(Date.parse(proof.backendStart)));
  assert.ok(proof.lockMode === 'ExclusiveLock' || proof.lockMode === 'ShareLock');
  if (requiredMode !== undefined) assert.equal(proof.lockMode, requiredMode);
  const rows = await query(`SELECT EXISTS (
    SELECT 1 FROM pg_stat_activity activity JOIN pg_locks lock ON lock.pid=activity.pid
    WHERE activity.pid=$1::integer AND activity.datname=current_database() AND activity.usename=current_user
      AND activity.application_name=$2::text AND activity.backend_start=$3::timestamptz
      AND lock.locktype='advisory' AND lock.granted AND lock.mode=$7::text
      AND lock.objsubid=1
      AND lock.classid=((hashtextextended($4::text,0) >> 32) & 4294967295)::oid
      AND lock.objid=(hashtextextended($4::text,0) & 4294967295)::oid
  ) AND current_database()=$5::text AND current_setting('neon.branch_id',true)=$6::text AS owned`,
  [proof.pid, proof.applicationName, proof.backendStart, INTEGRATION_MUTEX, target.database, target.branch, proof.lockMode]);
  assert.deepEqual(rows, [{ owned: true }]);
}

export function assertDirectIntegrationOwnerUrl(databaseUrl: string): void {
  if (new URL(databaseUrl).hostname.toLowerCase().split('.')[0]?.endsWith('-pooler')) {
    throw new Error('Integration ownership requires a direct owner endpoint; the runtime endpoint may remain pooled.');
  }
}

/** One controller per harness process. Its pinned session survives prepare,
 * the test body and repeated migration preparations until explicit cleanup. */
export function createIntegrationDatabaseOwnership() {
  type Lease = { pool: Pool; client: PoolClient; environment: Environment; delegated: string | undefined;
    session: IntegrationSession; verify: () => Promise<void>; onLoss: () => void };
  let lease: Lease | undefined;
  let lost = false;
  let acquiring = false;
  const healthy = () => { if (lost) throw new Error('Integration ownership session was lost; restart the supervised run.'); };
  const close = async () => {
    const current = lease;
    if (!current) return;
    lease = undefined;
    try {
      if (!lost) {
        const unlock = current.delegated === undefined ? 'pg_advisory_unlock' : 'pg_advisory_unlock_shared';
        const result = await current.client.query(`SELECT ${unlock}(hashtextextended($1::text,0)) AS unlocked`, [INTEGRATION_MUTEX]);
        assert.equal(result.rows[0]?.unlocked, true);
      }
    } finally {
      current.client.off('error', current.onLoss); current.client.off('end', current.onLoss);
      current.pool.off('error', current.onLoss);
      current.client.release(); await current.pool.end();
    }
  };
  return {
    async acquire(environment: Environment, delegated?: string): Promise<IntegrationSession> {
      healthy();
      assertDirectIntegrationOwnerUrl(environment.ownerDatabaseUrl);
      if (acquiring) throw new Error('Concurrent preparation in one integration harness is not supported.');
      if (lease) {
        if (lease.environment.ownerDatabaseUrl !== environment.ownerDatabaseUrl
          || lease.environment.expectedDatabase !== environment.expectedDatabase
          || lease.environment.expectedBranchId !== environment.expectedBranchId) {
          throw new Error('Integration ownership target changed during the run.');
        }
        if (lease.delegated !== delegated) throw new Error('Integration ownership delegation changed during the run.');
        await lease.verify(); return lease.session;
      }
      acquiring = true;
      const pool = new Pool({ connectionString: environment.ownerDatabaseUrl, max: 1 });
      const onLoss = () => { lost = true; };
      pool.on('error', onLoss);
      let client: PoolClient | undefined;
      try {
        client = await pool.connect(); client.on('error', onLoss); client.on('end', onLoss);
        const pinned = client;
        const raw: IntegrationQuery = async (statement, parameters = []) => (await pinned.query(statement, [...parameters])).rows;
        const target = { database: environment.expectedDatabase, branch: environment.expectedBranchId };
        let proof = delegated;
        if (proof === undefined) {
          const result = await raw('SELECT pg_try_advisory_lock(hashtextextended($1::text,0)) AS owned', [INTEGRATION_MUTEX]);
          if (result[0]?.owned !== true) {
            throw Object.assign(new Error('Isolated integration database is already owned by another run.'),
              { code: 'INTEGRATION_DATABASE_BUSY' });
          }
          const applicationName = `integration-owner-${randomUUID()}`;
          await raw("SELECT set_config('application_name',$1::text,false)", [applicationName]);
          const identity = await raw('SELECT pid,backend_start::text AS "backendStart" FROM pg_stat_activity WHERE pid=pg_backend_pid()');
          proof = JSON.stringify({ ...target, ...identity[0], applicationName, lockMode: 'ExclusiveLock' });
        } else {
          await assertIntegrationOwner(raw, target, proof, 'ShareLock');
          const result = await raw('SELECT pg_try_advisory_lock_shared(hashtextextended($1::text,0)) AS owned', [INTEGRATION_MUTEX]);
          if (result[0]?.owned !== true) throw new Error('Integration delegated ownership could not pin the shared mutex.');
        }
        const verifiedProof = proof;
        const verify = async () => {
          healthy();
          try { await assertIntegrationOwner(raw, target, verifiedProof, delegated === undefined ? 'ExclusiveLock' : 'ShareLock'); }
          catch (error) { lost = true; throw error; }
        };
        await verify();
        const query = new Proxy(pinned.query.bind(pinned), {
          apply(fn, thisArgument, args) {
            healthy();
            // Delegated ownership can disappear independently of this connection.
            // Revalidate before each schema/migration operation, never reacquire.
            if (delegated !== undefined) return verify().then(() => Reflect.apply(fn, thisArgument, args));
            return Reflect.apply(fn, thisArgument, args);
          },
        });
        const session: IntegrationSession = { query, connect: async () => ({ query, release: () => undefined }) };
        lease = { pool, client: pinned, environment: { ...environment }, delegated, session, verify, onLoss };
        return session;
      } catch (error) {
        // This process has not started a test body. Closing its own pinned
        // connection releases any just-acquired lock; never release another owner.
        client?.off('error', onLoss); client?.off('end', onLoss); pool.off('error', onLoss);
        client?.release(); await pool.end(); throw error;
      } finally { acquiring = false; }
    },
    release: close,
  };
}
