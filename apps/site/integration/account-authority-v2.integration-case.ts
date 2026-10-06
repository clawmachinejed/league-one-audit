import { createHash, randomUUID } from 'node:crypto';
import { Pool } from '@neondatabase/serverless';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ACCOUNT_DATABASE_GUARD } from '../lib/accounts/neon/database';
import { accountQuery, createPinnedIntegrationDatabase, ownerQuery, runtimeQuery,
  withAccountActor, withAuthRole, assertSafeIntegrationDatabase,
  type AccountIntegrationQuery } from './neon-integration-harness';

const issuer = 'https://bc-m1-authority.example.test/api/auth';
const configHash = createHash('sha256').update('synthetic admission config').digest('hex');
const digest = (value: string) => createHash('sha256').update(value, 'utf8').digest('hex');
const subject = `authority-${randomUUID()}`;
const sessionId = `session-${randomUUID()}`;
const email = `${subject}@example.test`;
const token = `synthetic-${randomUUID()}`;
const expiry = new Date(Date.now() + 3_600_000).toISOString();
const receipt = { sessionId, subject, expiresAt: expiry, issuer, admissionEpochRevision: '1',
  configHash, clockDomain: 'isolated-postgresql', admittedEmailDigest: digest(email), sessionTokenDigest: digest(token) };
const authoritySql = 'SELECT * FROM public.lock_account_session_authority_v2($1::jsonb)';
let actorId: string;
let accountPool: Pool;

function safeAccountDatabaseError(error: unknown) {
  const code = error && typeof error === 'object' && 'code' in error ? error.code : undefined;
  return Object.assign(new Error('Isolated account authority database operation failed.'),
    typeof code === 'string' && /^[0-9A-Z]{5}$/u.test(code) ? { code } : {});
}

async function withRealAccount<Result>(context: { actorUserId?: string; receipt?: unknown },
  run: (query: AccountIntegrationQuery) => Promise<Result>): Promise<Result> {
  const client = await accountPool.connect().catch(error => { throw safeAccountDatabaseError(error); });
  try {
    await client.query('BEGIN ISOLATION LEVEL READ COMMITTED');
    // This is the actual application guard, unmocked, under an authenticated
    // restricted LOGIN. An owner session with SET ROLE cannot satisfy it.
    await client.query(ACCOUNT_DATABASE_GUARD);
    await client.query(`SELECT set_config('app.actor_user_id',$1,true),set_config('app.request_id',$2,true),
      set_config('app.session_receipt_v2',$3,true)`,
    [context.actorUserId ?? '', randomUUID(), context.receipt === undefined ? '' : JSON.stringify(context.receipt)]);
    const query: AccountIntegrationQuery = async (statement, parameters = []) => {
      const result = await client.query(statement, [...parameters]);
      return result.rows;
    };
    const value = await run(query);
    await client.query('COMMIT');
    return value;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw safeAccountDatabaseError(error);
  } finally { client.release(); }
}

describe.sequential('BC-M1 strict session authority groundwork on guarded PostgreSQL', () => {
  beforeAll(async () => {
    await assertSafeIntegrationDatabase();
    const accountUrl = process.env.ACCOUNT_AUTHORITY_INTEGRATION_DATABASE_URL;
    if (!accountUrl) throw new Error('Actual account LOGIN qualification requires the guarded disposable account credential.');
    accountPool = new Pool({ connectionString: accountUrl, max: 2, connectionTimeoutMillis: 5_000,
      statement_timeout: 8_000, query_timeout: 12_000 });
    accountPool.on('error', () => {});
    // No runtime path activates admission. This synthetic epoch belongs only to
    // this suite, after the existing global destructive-harness safety checks.
    await ownerQuery(`INSERT INTO website_auth.admission_epoch(slot,revision,config_hash,issuer,clock_domain)
      VALUES(1,1,$1,$2,'isolated-postgresql') ON CONFLICT(slot) DO UPDATE SET revision=1,
      config_hash=excluded.config_hash,issuer=excluded.issuer,clock_domain=excluded.clock_domain,activated_at=clock_timestamp()`, [configHash, issuer]);
    await ownerQuery(`INSERT INTO website_auth."user"(id,name,email,"emailVerified") VALUES($1,'Synthetic',$2,true)`, [subject, email]);
    await ownerQuery(`INSERT INTO website_auth.session(id,"userId",token,"expiresAt","updatedAt")
      VALUES($1,$2,$3,$4::timestamptz,clock_timestamp())`, [sessionId, subject, token, expiry]);
    actorId = await withAccountActor({}, async query => {
      await query("SELECT set_config('app.session_receipt_v2',$1,true)", [JSON.stringify(receipt)]);
      const rows = await query<{ id: string }>('SELECT public.resolve_app_login_identity($1,$2,$3,$4::uuid) AS id',
        [issuer, subject, 'Synthetic operator target', randomUUID()]);
      return rows[0].id;
    });
  });
  afterAll(async () => {
    await accountPool?.end();
    await ownerQuery('DELETE FROM website_auth."user" WHERE id=$1', [subject]);
    await ownerQuery('DELETE FROM website_auth.admission_epoch WHERE slot=1 AND issuer=$1', [issuer]);
  });

  it('returns only locked safe timing metadata through the account role', async () => {
    const rows = await accountQuery(authoritySql, [JSON.stringify(receipt)]);
    expect(rows).toHaveLength(1);
    expect(Object.keys(rows[0]).sort()).toEqual(['admission_epoch_revision', 'db_sample_at', 'session_created_at', 'session_expires_at']);
    expect(String(rows[0].admission_epoch_revision)).toBe('1');
  });

  it.each([
    ['SQL NULL', null], ['JSON null', 'null'], ['array', '[]'],
    ['missing field', JSON.stringify({ ...receipt, sessionId: undefined })],
    ['extra field', JSON.stringify({ ...receipt, actorId: randomUUID() })],
    ['wrong type', JSON.stringify({ ...receipt, admissionEpochRevision: 1 })],
    ['NULL field', JSON.stringify({ ...receipt, sessionId: null })],
    ['overflow revision', JSON.stringify({ ...receipt, admissionEpochRevision: '9999999999999999999' })],
    ['invalid date', JSON.stringify({ ...receipt, expiresAt: '2026-99-99T00:00:00Z' })],
    ['epoch mismatch', JSON.stringify({ ...receipt, admissionEpochRevision: '2' })],
    ['config mismatch', JSON.stringify({ ...receipt, configHash: '0'.repeat(64) })],
    ['clock mismatch', JSON.stringify({ ...receipt, clockDomain: 'other' })],
    ['issuer mismatch', JSON.stringify({ ...receipt, issuer: 'other' })],
    ['subject mismatch', JSON.stringify({ ...receipt, subject: 'other' })],
    ['email mismatch', JSON.stringify({ ...receipt, admittedEmailDigest: '0'.repeat(64) })],
    ['token mismatch', JSON.stringify({ ...receipt, sessionTokenDigest: '0'.repeat(64) })],
    ['session mismatch', JSON.stringify({ ...receipt, sessionId: 'other' })],
    ['expiry mismatch', JSON.stringify({ ...receipt, expiresAt: '2000-01-01T00:00:00Z' })],
  ])('rejects %s with a fixed safe authority error', async (_name, value) => {
    await expect(accountQuery(authoritySql, [value])).rejects.toMatchObject({ code: 'P4101', message: 'account authority unavailable' });
  });

  it('rejects recreated session tokens and changed email or verification immediately', async () => {
    const connection = await createPinnedIntegrationDatabase('owner');
    try {
      for (const change of [
        { sql: 'UPDATE website_auth.session SET token=$1 WHERE id=$2', args: [`${token}-replaced`, sessionId] },
        { sql: 'UPDATE website_auth."user" SET email=$1 WHERE id=$2', args: [`changed-${email}`, subject] },
        { sql: 'UPDATE website_auth."user" SET "emailVerified"=false WHERE id=$1', args: [subject] },
        { sql: 'UPDATE website_auth.session SET "expiresAt"=clock_timestamp()-interval \'1 second\' WHERE id=$1', args: [sessionId] },
      ]) {
        await connection.database.query('BEGIN');
        await connection.database.query(change.sql, change.args);
        await expect(connection.database.query(authoritySql, [JSON.stringify(receipt)])).rejects.toMatchObject({ code: 'P4101' });
        await connection.database.query('ROLLBACK');
      }
    } finally { await connection.close(); }
  });

  it('auth role reads only exact configured epoch and cannot read/update its storage', async () => {
    const rows = await withAuthRole(query => query('SELECT * FROM website_auth.read_admission_epoch_locked_v1($1,$2)', [configHash, issuer]));
    expect(rows).toHaveLength(1);
    await expect(withAuthRole(query => query('SELECT * FROM website_auth.admission_epoch'))).rejects.toMatchObject({ code: '42501' });
    await expect(withAuthRole(query => query("UPDATE website_auth.admission_epoch SET revision=2"))).rejects.toMatchObject({ code: '42501' });
    await expect(withAuthRole(query => query('SELECT * FROM website_auth.read_admission_epoch_locked_v1($1,$2)', ['0'.repeat(64), issuer])))
      .rejects.toMatchObject({ code: 'P4101' });
  });

  it('denies raw auth data and authority/operator helpers outside exact role manifest', async () => {
    await expect(accountQuery('SELECT * FROM website_auth.session')).rejects.toMatchObject({ code: '42501' });
    await expect(runtimeQuery(authoritySql, [JSON.stringify(receipt)])).rejects.toMatchObject({ code: '42501' });
    for (const name of ['disable_app_actor_v1', 'revoke_app_login_identity_v1']) {
      await expect(accountQuery(`SELECT public.${name}($1::uuid,$2::uuid)`, [randomUUID(), randomUUID()])).rejects.toMatchObject({ code: '42501' });
      await expect(runtimeQuery(`SELECT public.${name}($1::uuid,$2::uuid)`, [randomUUID(), randomUUID()])).rejects.toMatchObject({ code: '42501' });
    }
  });

  it('requires receipt on existing commands even in the owner-session SET ROLE fixture', async () => {
    await expect(accountQuery('UPDATE public.app_users SET display_name=$1 WHERE id=$2',
      ['Denied missing authority', actorId], { actorUserId: actorId, requestId: randomUUID() }))
      .rejects.toMatchObject({ code: 'P4101' });
    await expect(accountQuery('SELECT public.resolve_app_login_identity($1,$2,$3,$4::uuid)',
      [issuer, subject, 'Denied resolver', randomUUID()])).rejects.toMatchObject({ code: 'P4101' });
  });

  it('binds exact actor/login and returns only finite final internal timing', async () => {
    await expect(accountQuery('SELECT public.lock_account_actor_authority_v2($1::jsonb,false)',
      [JSON.stringify(receipt)], { actorUserId: randomUUID(), requestId: randomUUID() })).rejects.toMatchObject({ code: 'P4101' });
    const rows = await accountQuery<{ timing: Record<string, unknown> }>('SELECT public.read_account_authority_timing_v2($1::jsonb) AS timing',
      [JSON.stringify(receipt)], { actorUserId: actorId, requestId: randomUUID() });
    expect(Object.keys(rows[0].timing).sort()).toEqual(['dbSampleAt', 'minimumAuthorityExpiresAt', 'remainingLifetimeMs']);
    expect(typeof rows[0].timing.remainingLifetimeMs).toBe('string');
    expect(BigInt(rows[0].timing.remainingLifetimeMs as string)).toBeGreaterThan(0n);
    expect(rows[0].timing.minimumAuthorityExpiresAt).toBe(expiry);
  });

  it('rolls back a protected mutation whose authority expires before final SQL', async () => {
    const connection = await createPinnedIntegrationDatabase('owner');
    const requestId = randomUUID();
    try {
      await connection.database.query('BEGIN');
      const rows = await connection.database.query<{ expires: Date }>(`UPDATE website_auth.session
        SET "expiresAt"=date_trunc('milliseconds',clock_timestamp()+interval '1 second') WHERE id=$1 RETURNING "expiresAt" AS expires`, [sessionId]);
      const shortReceipt = { ...receipt, expiresAt: rows[0].expires.toISOString() };
      await connection.database.query(`SELECT set_config('app.session_receipt_v2',$1,true),
        set_config('app.actor_user_id',$2,true),set_config('app.request_id',$3,true)`, [JSON.stringify(shortReceipt), actorId, requestId]);
      await connection.database.query('SET LOCAL ROLE league_one_account');
      await connection.database.query("UPDATE public.app_users SET display_name='Expired mutation' WHERE id=$1", [actorId]);
      await connection.database.query('SELECT pg_sleep(1.05)');
      await expect(connection.database.query('SELECT public.read_account_authority_timing_v2($1::jsonb)', [JSON.stringify(shortReceipt)]))
        .rejects.toMatchObject({ code: 'P4101' });
      await connection.database.query('ROLLBACK');
      expect(await ownerQuery('SELECT display_name FROM public.app_users WHERE id=$1', [actorId])).toEqual([{ display_name: 'Synthetic operator target' }]);
      expect(await ownerQuery('SELECT count(*)::int AS count FROM public.app_identity_audit_events WHERE request_id=$1', [requestId])).toEqual([{ count: 0 }]);
    } finally { await connection.close(); }
  });

  it('holds the shared auth gate until account rollback and allows mutation afterward', async () => {
    const mutation = await createPinnedIntegrationDatabase('owner');
    try {
      await expect(withAccountActor({}, async query => {
        await query(authoritySql, [JSON.stringify(receipt)]);
        await mutation.database.query('BEGIN');
        await mutation.database.query("SET LOCAL lock_timeout='150ms'");
        await expect(mutation.database.query('UPDATE website_auth.session SET "updatedAt"=clock_timestamp() WHERE id=$1', [sessionId]))
          .rejects.toMatchObject({ code: '55P03' });
        await mutation.database.query('ROLLBACK');
        throw new Error('rollback authority holder');
      })).rejects.toThrow('rollback authority holder');
      await mutation.database.query('BEGIN');
      await mutation.database.query("SET LOCAL lock_timeout='150ms'");
      await mutation.database.query('UPDATE website_auth.session SET "updatedAt"=clock_timestamp() WHERE id=$1', [sessionId]);
      await mutation.database.query('ROLLBACK');
    } finally { await mutation.close(); }
  });

  it('executes the real account database guard and valid stored authority under actual LOGIN', async () => {
    const rows = await withRealAccount({ actorUserId: actorId, receipt }, async query => {
      expect(await query(`SELECT current_user AS current_role,session_user AS session_role`))
        .toEqual([{ current_role: 'league_one_account', session_role: 'league_one_account' }]);
      await query('SELECT public.lock_account_actor_authority_v2($1::jsonb,false)', [JSON.stringify(receipt)]);
      return query<{ id: string }>('SELECT id FROM public.app_users');
    });
    expect(rows).toEqual([{ id: actorId }]);
  });

  it.each(['missing receipt', 'forged subject', 'forged actor'] as const)(
    'actual account LOGIN denies %s before mutation', async kind => {
      const selectedReceipt = kind === 'missing receipt' ? undefined
        : kind === 'forged subject' ? { ...receipt, subject: 'unrelated-subject' } : receipt;
      await expect(withRealAccount({ actorUserId: kind === 'forged actor' ? randomUUID() : actorId,
        receipt: selectedReceipt }, query => query('UPDATE public.app_users SET display_name=$1 WHERE id=$2',
      ['Must not change', actorId]))).rejects.toMatchObject({ code: 'P4101' });
      expect(await ownerQuery('SELECT display_name FROM public.app_users WHERE id=$1', [actorId]))
        .toEqual([{ display_name: 'Synthetic operator target' }]);
    });

  it('actual account LOGIN cannot enter owner maintenance or claim its session identity through role settings', async () => {
    for (const name of ['disable_app_actor_v1', 'revoke_app_login_identity_v1']) {
      await expect(withRealAccount({ actorUserId: actorId, receipt },
        query => query(`SELECT public.${name}($1::uuid,$2::uuid)`, [actorId, randomUUID()])))
        .rejects.toMatchObject({ code: '42501' });
    }
    await expect(withRealAccount({ actorUserId: actorId }, async query => {
      await query("SELECT set_config('role','none',true)");
      return query("UPDATE public.app_users SET display_name='Denied owner impersonation' WHERE id=$1", [actorId]);
    })).rejects.toMatchObject({ code: 'P4101' });
  });

  it('operator revoke/disable are idempotent audited actions and rollback with their audit', async () => {
    const identities = await ownerQuery<{ id: string }>('SELECT id FROM public.app_login_identities WHERE app_user_id=$1', [actorId]);
    const requestId = randomUUID();
    const connection = await createPinnedIntegrationDatabase('owner');
    try {
      await connection.database.query('BEGIN');
      await connection.database.query('SELECT public.disable_app_actor_v1($1,$2)', [actorId, requestId]);
      await connection.database.query('ROLLBACK');
      expect(await ownerQuery('SELECT status FROM public.app_users WHERE id=$1', [actorId])).toEqual([{ status: 'active' }]);
      expect(await ownerQuery('SELECT count(*)::int AS count FROM public.app_identity_audit_events WHERE request_id=$1', [requestId])).toEqual([{ count: 0 }]);
      for (const [name, id] of [['disable_app_actor_v1', actorId], ['revoke_app_login_identity_v1', identities[0].id]]) {
        const operationRequest = randomUUID();
        for (let repeat = 0; repeat < 2; repeat += 1) {
          expect(await ownerQuery(`SELECT public.${name}($1,$2) AS changed`, [id, operationRequest])).toEqual([{ changed: true }]);
        }
        expect(await ownerQuery('SELECT actor_kind FROM public.app_identity_audit_events WHERE request_id=$1', [operationRequest]))
          .toEqual([{ actor_kind: 'operator' }]);
      }
    } finally { await connection.close(); }
  });

  it('enforces singleton and NULL/format constraints without changing the epoch', async () => {
    for (const update of ['revision=NULL', 'revision=0', 'config_hash=NULL', "config_hash='invalid'", 'issuer=NULL', "issuer=' '",
      'clock_domain=NULL', "clock_domain=' '", "activated_at='infinity'::timestamptz", 'slot=2']) {
      await expect(ownerQuery(`UPDATE website_auth.admission_epoch SET ${update} WHERE slot=1`)).rejects.toThrow();
    }
    expect(await ownerQuery('SELECT revision::text AS revision FROM website_auth.admission_epoch WHERE slot=1')).toEqual([{ revision: '1' }]);
  });
});
