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

// Cleanup has independent local wait limits. An aborted work phase must still
// roll back/release its own session; timeout is not proof of remote cancellation.
async function boundedOwnershipCleanup<T>(action: () => Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([action(), new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error('Integration ownership cleanup deadline exceeded.')), 10_000);
    })]);
  } finally { clearTimeout(timer); }
}

/** One controller per harness process. Its pinned session survives prepare,
 * the test body and repeated migration preparations until explicit cleanup. */
export function createIntegrationDatabaseOwnership() {
  type Lease = { pool: Pool; client: PoolClient; environment: Environment; delegated: string | undefined;
    session: IntegrationSession; sessionFor: (signal?: AbortSignal) => IntegrationSession;
    verify: (signal?: AbortSignal) => Promise<void>; onLoss: () => void };
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
        const result = await boundedOwnershipCleanup(() => current.client.query(`SELECT ${unlock}(hashtextextended($1::text,0)) AS unlocked`, [INTEGRATION_MUTEX]));
        assert.equal(result.rows[0]?.unlocked, true);
      }
    } finally {
      current.client.off('error', current.onLoss); current.client.off('end', current.onLoss);
      current.pool.off('error', current.onLoss);
      current.client.release(true); await boundedOwnershipCleanup(() => current.pool.end());
    }
  };
  return {
    async acquire(environment: Environment, delegated?: string, signal?: AbortSignal): Promise<IntegrationSession> {
      healthy(); signal?.throwIfAborted();
      assertDirectIntegrationOwnerUrl(environment.ownerDatabaseUrl);
      if (acquiring) throw new Error('Concurrent preparation in one integration harness is not supported.');
      if (lease) {
        if (lease.environment.ownerDatabaseUrl !== environment.ownerDatabaseUrl
          || lease.environment.expectedDatabase !== environment.expectedDatabase
          || lease.environment.expectedBranchId !== environment.expectedBranchId) {
          throw new Error('Integration ownership target changed during the run.');
        }
        if (lease.delegated !== delegated) throw new Error('Integration ownership delegation changed during the run.');
        await lease.verify(signal);
        healthy(); signal?.throwIfAborted();
        return signal ? lease.sessionFor(signal) : lease.session;
      }
      acquiring = true;
      // Bound admission, migrations and cleanup below the integration hook
      // deadline so a stalled owner cannot indefinitely delay branch deletion.
      const pool = new Pool({ connectionString: environment.ownerDatabaseUrl, max: 1,
        connectionTimeoutMillis: 10_000, statement_timeout: 60_000, query_timeout: 75_000 });
      const onLoss = () => { lost = true; };
      pool.on('error', onLoss);
      let client: PoolClient | undefined;
      try {
        client = await pool.connect();
        signal?.throwIfAborted(); healthy();
        client.on('error', onLoss); client.on('end', onLoss);
        const pinned = client;
        const guardedRaw = (phaseSignal?: AbortSignal): IntegrationQuery => async (statement, parameters = []) => {
          healthy(); phaseSignal?.throwIfAborted();
          const result = await pinned.query(statement, [...parameters]);
          healthy(); phaseSignal?.throwIfAborted();
          return result.rows;
        };
        const raw = guardedRaw(signal);
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
        const verify = async (phaseSignal?: AbortSignal) => {
          healthy(); phaseSignal?.throwIfAborted();
          try { await assertIntegrationOwner(guardedRaw(phaseSignal), target, verifiedProof,
            delegated === undefined ? 'ExclusiveLock' : 'ShareLock'); }
          catch (error) { if (!phaseSignal?.aborted) lost = true; throw error; }
          healthy(); phaseSignal?.throwIfAborted();
        };
        await verify(signal);
        signal?.throwIfAborted();
        const sessionFor = (phaseSignal?: AbortSignal): IntegrationSession => {
          const query = new Proxy(pinned.query.bind(pinned), {
            apply(fn, thisArgument, args) {
              healthy();
              // Exact local rollback remains available after work cancellation;
              // variants must pass the ordinary ownership and phase guards.
              if (args.length === 1 && args[0] === 'ROLLBACK') {
                return boundedOwnershipCleanup(() => Reflect.apply(fn, thisArgument, args));
              }
              phaseSignal?.throwIfAborted();
              const dispatch = () => {
                // verify() can yield while the cleanup phase expires. This fence
                // belongs immediately before driver IO, inside this abstraction.
                healthy(); phaseSignal?.throwIfAborted();
                return Reflect.apply(fn, thisArgument, args);
              };
              const result = delegated !== undefined ? verify(phaseSignal).then(dispatch) : dispatch();
              if (!phaseSignal) return result;
              return Promise.resolve(result).then(value => {
                healthy(); phaseSignal.throwIfAborted(); return value;
              });
            },
          });
          return { query, connect: async () => {
            healthy(); phaseSignal?.throwIfAborted();
            return { query, release: () => undefined };
          } };
        };
        const session = sessionFor();
        lease = { pool, client: pinned, environment: { ...environment }, delegated, session, sessionFor, verify, onLoss };
        return signal ? sessionFor(signal) : session;
      } catch (error) {
        // This process has not started a test body. Closing its own pinned
        // connection releases any just-acquired lock; never release another owner.
        client?.off('error', onLoss); client?.off('end', onLoss); pool.off('error', onLoss);
        client?.release(true); await boundedOwnershipCleanup(() => pool.end()); throw error;
      } finally { acquiring = false; }
    },
    release: close,
  };
}
