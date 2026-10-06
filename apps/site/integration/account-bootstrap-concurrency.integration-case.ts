import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createRealAccountLoginFixture, prepareSyntheticAccountSession } from './account-authority-fixture';
import { createPinnedIntegrationDatabase, ownerQuery, type AccountIntegrationQuery } from './neon-integration-harness';

// ENG01 / BS-O07. Every auth fixture commits before any contender begins.
// These cases require the disposable harness's real restricted account LOGIN.
const issuer = 'https://isolated-bootstrap-race.example.test';
const resolveSql = 'SELECT public.resolve_app_login_identity($1,$2,$3,$4::uuid) AS id';
const registrationLock = 'SELECT pg_advisory_xact_lock(hashtextextended(jsonb_build_array($1::text,$2::text)::text,0))';
function latch<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(accept => { resolve = accept; });
  return { promise, resolve };
}
async function bounded<T>(promise: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  try {
    return await Promise.race([promise, new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error('Account race barrier was not reached.')), 5_000);
    })]);
  } finally { clearTimeout(timer!); }
}
async function waitForLock(query: AccountIntegrationQuery, statement: string, parameters: readonly unknown[]) {
  const end = performance.now() + 2_000;
  do {
    const rows = await query<{ observed: boolean }>(statement, parameters);
    if (rows[0]?.observed === true) return;
    await new Promise(resolve => setTimeout(resolve, 20));
  } while (performance.now() < end);
  throw new Error('Required PostgreSQL lock overlap was not observed.');
}
// Match the exact bigint registration lock held by the blocker, not merely any
// wait or wall-clock delay. Also require each contender's shared auth gate.
const registrationWait = `SELECT count(DISTINCT waiting.pid)=$3::integer AS observed
  FROM pg_locks waiting JOIN pg_locks held ON held.pid=$2 AND held.granted
    AND held.locktype='advisory' AND held.objsubid=1 AND waiting.locktype=held.locktype
    AND waiting.database=held.database AND waiting.classid=held.classid
    AND waiting.objid=held.objid AND waiting.objsubid=held.objsubid
  WHERE waiting.pid=ANY($1::integer[]) AND NOT waiting.granted
    AND $2=ANY(pg_blocking_pids(waiting.pid))
    AND EXISTS(SELECT 1 FROM pg_locks gate WHERE gate.pid=waiting.pid
      AND gate.locktype='advisory' AND gate.classid=19740517 AND gate.objid=1
      AND gate.objsubid=2 AND gate.mode='ShareLock' AND gate.granted)`;
const authWriterWait = `SELECT EXISTS(SELECT 1 FROM pg_locks
  WHERE pid=$1 AND locktype='advisory' AND classid=19740517 AND objid=1
    AND objsubid=2 AND mode='ExclusiveLock' AND NOT granted
    AND $2=ANY(pg_blocking_pids(pid))) AS observed`;

describe.sequential('ENG01 genuine account LOGIN bootstrap and revocation ordering', () => {
  let account: Awaited<ReturnType<typeof createRealAccountLoginFixture>>;
  beforeAll(async () => { account = await createRealAccountLoginFixture(); });
  afterAll(async () => { await account?.close(); });

  async function fixture() {
    const subject = randomUUID();
    return { subject, receipt: await prepareSyntheticAccountSession(issuer, subject), name: `race-${randomUUID()}` };
  }
  async function cardinality(subject: string, name: string, requests: string[], query: AccountIntegrationQuery = ownerQuery) {
    return query(`SELECT
      (SELECT count(*)::int FROM public.app_users WHERE display_name=$2) AS users,
      (SELECT count(*)::int FROM public.app_login_identities WHERE issuer=$1 AND subject=$3) AS logins,
      (SELECT count(*)::int FROM public.app_identity_audit_events WHERE request_id=ANY($4::uuid[])) AS audits`,
    [issuer, name, subject, requests]);
  }

  it('observes two actual LOGIN resolvers overlapping at one registration lock and committing one identity', async () => {
    const f = await fixture(); const requests = [randomUUID(), randomUUID()];
    const blocker = await createPinnedIntegrationDatabase('owner');
    const ready = [latch<number>(), latch<number>()]; const start = latch<void>();
    let outcomes: Promise<PromiseSettledResult<readonly { id: string }[]>[]> | undefined;
    try {
      await blocker.database.query('BEGIN');
      const [{ pid }] = await blocker.database.query<{ pid: number }>('SELECT pg_backend_pid() AS pid');
      await blocker.database.query(registrationLock, [issuer, f.subject]);
      outcomes = Promise.allSettled(requests.map((requestId, index) => account.transaction({ receipt: f.receipt, requestId }, async (query, accountPid) => {
        ready[index].resolve(accountPid);
        await start.promise;
        return query<{ id: string }>(resolveSql, [issuer, f.subject, f.name, requestId]);
      })));
      const pids = await bounded(Promise.all(ready.map(item => item.promise)));
      expect(new Set(pids).size).toBe(2);
      start.resolve();
      await waitForLock(blocker.database.query, registrationWait, [pids, pid, 2]);
      // No account row can exist before either contender acquires this lock.
      expect(await cardinality(f.subject, f.name, requests, blocker.database.query)).toEqual([{ users: 0, logins: 0, audits: 0 }]);
      await blocker.database.query('COMMIT');
      const result = await outcomes;
      expect(result[0].status).toBe('fulfilled'); expect(result[1].status).toBe('fulfilled');
      if (result[0].status !== 'fulfilled' || result[1].status !== 'fulfilled') throw new Error('Bootstrap race failed.');
      expect(result[0].value[0].id).toBe(result[1].value[0].id);
      expect(await cardinality(f.subject, f.name, requests)).toEqual([{ users: 1, logins: 1, audits: 2 }]);
      expect(await ownerQuery(`SELECT subject_type,subject_user_id FROM public.app_identity_audit_events
        WHERE request_id=ANY($1::uuid[]) ORDER BY subject_type`, [requests])).toEqual([
        { subject_type: 'app_login_identities', subject_user_id: result[0].value[0].id },
        { subject_type: 'app_users', subject_user_id: result[0].value[0].id },
      ]);
    } finally {
      start.resolve();
      await blocker.database.query('ROLLBACK').catch(() => undefined);
      await outcomes;
      await blocker.close();
    }
  });

  it('rolls back the first LOGIN bootstrap and lets its observed waiting contender create the sole committed identity', async () => {
    const f = await fixture(); const requests = [randomUUID(), randomUUID()];
    const held = latch<{ pid: number; id: string }>(); const release = latch<void>(); const secondReady = latch<number>();
    const observer = await createPinnedIntegrationDatabase('owner');
    const first = account.transaction({ receipt: f.receipt, requestId: requests[0] }, async (query, pid) => {
      const rows = await query<{ id: string }>(resolveSql, [issuer, f.subject, f.name, requests[0]]);
      held.resolve({ pid, id: rows[0].id });
      await release.promise;
      await query('SELECT 1/0');
    });
    const firstOutcome = Promise.allSettled([first]);
    let secondOutcome: Promise<PromiseSettledResult<readonly { id: string }[]>[]> | undefined;
    try {
      const firstIdentity = await bounded(held.promise);
      secondOutcome = Promise.allSettled([account.transaction({ receipt: f.receipt, requestId: requests[1] }, async (query, pid) => {
        secondReady.resolve(pid);
        return query<{ id: string }>(resolveSql, [issuer, f.subject, f.name, requests[1]]);
      })]);
      const secondPid = await bounded(secondReady.promise);
      expect(secondPid).not.toBe(firstIdentity.pid);
      await waitForLock(observer.database.query, registrationWait, [[secondPid], firstIdentity.pid, 1]);
      expect(await cardinality(f.subject, f.name, requests, observer.database.query)).toEqual([{ users: 0, logins: 0, audits: 0 }]);
      release.resolve();
      expect(await firstOutcome).toMatchObject([{ status: 'rejected', reason: { code: '22012' } }]);
      const [result] = await secondOutcome;
      expect(result.status).toBe('fulfilled');
      if (result.status !== 'fulfilled') throw new Error('Waiting bootstrap did not commit.');
      expect(result.value[0].id).not.toBe(firstIdentity.id);
      expect(await cardinality(f.subject, f.name, [requests[0]])).toEqual([{ users: 1, logins: 1, audits: 0 }]);
      expect(await cardinality(f.subject, f.name, [requests[1]])).toEqual([{ users: 1, logins: 1, audits: 2 }]);
    } finally { release.resolve(); await firstOutcome; await secondOutcome; await observer.close(); }
  });

  it('holds bootstrap authority through rollback, then commits the waiting session revoke and denies replay', async () => {
    const f = await fixture(); const requestId = randomUUID(); const replayRequest = randomUUID();
    const held = latch<number>(); const release = latch<void>();
    const writer = await createPinnedIntegrationDatabase('owner');
    const observer = await createPinnedIntegrationDatabase('owner');
    const holder = account.transaction({ receipt: f.receipt, requestId }, async (query, pid) => {
      await query(resolveSql, [issuer, f.subject, f.name, requestId]);
      held.resolve(pid); await release.promise; await query('SELECT 1/0');
    });
    const holderOutcome = Promise.allSettled([holder]);
    let writerOutcome: Promise<PromiseSettledResult<readonly Record<string, unknown>[]>[]> | undefined;
    try {
      const accountPid = await bounded(held.promise);
      await writer.database.query('BEGIN');
      await writer.database.query("SET LOCAL lock_timeout='3000ms'");
      const [{ pid }] = await writer.database.query<{ pid: number }>('SELECT pg_backend_pid() AS pid');
      writerOutcome = Promise.allSettled([writer.database.query('DELETE FROM website_auth.session WHERE "userId"=$1 RETURNING id', [f.subject])]);
      await waitForLock(observer.database.query, authWriterWait, [pid, accountPid]);
      release.resolve();
      expect(await holderOutcome).toMatchObject([{ status: 'rejected', reason: { code: '22012' } }]);
      const [deleted] = await writerOutcome;
      expect(deleted.status).toBe('fulfilled');
      if (deleted.status !== 'fulfilled') throw new Error('Session revoke did not complete.');
      expect(deleted.value).toHaveLength(1);
      await writer.database.query('COMMIT');
      await expect(account.transaction({ receipt: f.receipt, requestId: replayRequest }, query =>
        query(resolveSql, [issuer, f.subject, f.name, replayRequest]))).rejects.toMatchObject({ code: 'P4101' });
      expect(await cardinality(f.subject, f.name, [requestId, replayRequest])).toEqual([{ users: 0, logins: 0, audits: 0 }]);
    } finally {
      release.resolve(); await holderOutcome; await writerOutcome;
      await writer.database.query('ROLLBACK').catch(() => undefined);
      await writer.close(); await observer.close();
    }
  });

  it('commits a protected LOGIN mutation before its waiting operator revoke and denies every later mutation', async () => {
    const f = await fixture(); const bootstrapRequest = randomUUID();
    const [created] = await account.transaction({ receipt: f.receipt }, query =>
      query<{ id: string }>(resolveSql, [issuer, f.subject, f.name, bootstrapRequest]));
    const [{ id: loginId }] = await ownerQuery<{ id: string }>('SELECT id FROM public.app_login_identities WHERE app_user_id=$1', [created.id]);
    const requestId = randomUUID(); const revokeRequest = randomUUID(); const deniedRequest = randomUUID();
    const held = latch<number>(); const release = latch<void>();
    const writer = await createPinnedIntegrationDatabase('owner'); const observer = await createPinnedIntegrationDatabase('owner');
    const mutation = account.transaction({ receipt: f.receipt, actorUserId: created.id, requestId }, async (query, pid) => {
      await query('UPDATE public.app_users SET display_name=$1 WHERE id=$2', [`committed-${f.name}`, created.id]);
      held.resolve(pid); await release.promise;
      return query('SELECT public.read_account_authority_timing_v2($1::jsonb)', [JSON.stringify(f.receipt)]);
    });
    const mutationOutcome = Promise.allSettled([mutation]);
    let revokeOutcome: Promise<PromiseSettledResult<readonly Record<string, unknown>[]>[]> | undefined;
    try {
      const accountPid = await bounded(held.promise);
      await writer.database.query('BEGIN'); await writer.database.query("SET LOCAL lock_timeout='3000ms'");
      const [{ pid }] = await writer.database.query<{ pid: number }>('SELECT pg_backend_pid() AS pid');
      revokeOutcome = Promise.allSettled([writer.database.query('SELECT public.revoke_app_login_identity_v1($1,$2)', [loginId, revokeRequest])]);
      await waitForLock(observer.database.query, authWriterWait, [pid, accountPid]);
      release.resolve();
      expect(await mutationOutcome).toMatchObject([{ status: 'fulfilled' }]);
      expect(await revokeOutcome).toMatchObject([{ status: 'fulfilled' }]);
      await writer.database.query('COMMIT');
      await expect(account.transaction({ receipt: f.receipt, actorUserId: created.id, requestId: deniedRequest }, query =>
        query('UPDATE public.app_users SET display_name=$1 WHERE id=$2', ['must-not-commit', created.id])))
        .rejects.toMatchObject({ code: 'P4101' });
      expect(await ownerQuery('SELECT display_name,revision FROM public.app_users WHERE id=$1', [created.id]))
        .toEqual([{ display_name: `committed-${f.name}`, revision: '2' }]);
      expect(await ownerQuery(`SELECT request_id,actor_kind FROM public.app_identity_audit_events
        WHERE request_id=ANY($1::uuid[]) ORDER BY actor_kind`, [[requestId, revokeRequest, deniedRequest]]))
        .toEqual([{ request_id: revokeRequest, actor_kind: 'operator' }, { request_id: requestId, actor_kind: 'user' }]);
    } finally {
      release.resolve(); await mutationOutcome; await revokeOutcome;
      await writer.database.query('ROLLBACK').catch(() => undefined);
      await writer.close(); await observer.close();
    }
  });
});
