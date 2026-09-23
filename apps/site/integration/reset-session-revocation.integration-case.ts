import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { Pool, type PoolClient } from '@neondatabase/serverless';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { handleAccountAuth, type AccountAuthConfiguration } from '../lib/accounts/auth-runtime';
import { sendAccountEmail } from '../lib/accounts/auth-email';
import { assertSafeIntegrationDatabase, integrationEnvironment, ownerQuery } from './neon-integration-harness';

vi.mock('../lib/accounts/auth-email', () => ({ sendAccountEmail: vi.fn() }));

const origin = 'https://reset-integration.example.test';
const oldPassword = 'Synthetic-integration-old-password-123!';
const newPassword = 'Synthetic-integration-new-password-456!';
const otherPassword = 'Synthetic-integration-other-password-789!';
const deliver = vi.mocked(sendAccountEmail);
let databaseUrl: string;
let requestNumber = 0;
const fixtureEmails: string[] = [];

type SessionResult = {
  session: { id: string; userId: string; expiresAt: string };
  user: { id: string; email: string };
} | null;

function safeSession(value: unknown): SessionResult {
  if (value === null) return null;
  if (!value || typeof value !== 'object') throw new Error('Invalid synthetic session response.');
  const { session, user } = value as { session?: Record<string, unknown>; user?: Record<string, unknown> };
  if (!session || !user || typeof session.id !== 'string' || typeof session.userId !== 'string'
    || typeof session.expiresAt !== 'string' || typeof user.id !== 'string' || typeof user.email !== 'string') {
    throw new Error('Invalid synthetic session response.');
  }
  return { session: { id: session.id, userId: session.userId, expiresAt: session.expiresAt },
    user: { id: user.id, email: user.email } };
}

function safeDatabaseError(error: unknown): Error & { code?: string } {
  const code = error && typeof error === 'object' && 'code' in error ? error.code : undefined;
  return Object.assign(new Error('Isolated auth database operation failed.'),
    typeof code === 'string' && /^[0-9A-Z]{5}$/u.test(code) ? { code } : {});
}

function normalizedHost(url: URL) {
  return url.hostname.toLowerCase().replace(/-pooler(?=\.)/u, '');
}

/** No fallback to owner credentials. Missing transport evidence fails this case,
 * rather than allowing a successful generic integration run to qualify auth. */
async function guardedAuthUrl() {
  const env = integrationEnvironment();
  await assertSafeIntegrationDatabase(env);
  const value = process.env.AUTH_RESET_INTEGRATION_DATABASE_URL;
  if (!value) throw new Error('Auth reset integration remains unverified: a guarded ephemeral auth-role URL is required.');
  let auth: URL, owner: URL;
  try { auth = new URL(value); owner = new URL(env.ownerDatabaseUrl); }
  catch { throw new Error('Invalid isolated auth integration URL.'); }
  if (!['postgres:', 'postgresql:'].includes(auth.protocol)
    || decodeURIComponent(auth.username) !== 'league_one_auth' || !auth.password
    || normalizedHost(auth) !== normalizedHost(owner) || auth.pathname !== owner.pathname
    || decodeURIComponent(auth.pathname.slice(1)) !== env.expectedDatabase
    || !['require', 'verify-ca', 'verify-full'].includes(auth.searchParams.get('sslmode') ?? '')
    || auth.hash || (auth.port && auth.port !== '5432')) {
    throw new Error('Auth integration URL must use the restricted role on the fully guarded database.');
  }
  const pool = new Pool({ connectionString: value, max: 1, connectionTimeoutMillis: 5_000, query_timeout: 10_000 });
  pool.on('error', () => {});
  try {
    const result = await pool.query(`SELECT current_database()=$1 AS database_matches,
      current_user='league_one_auth' AND session_user='league_one_auth' AS role_matches`, [env.expectedDatabase]);
    if (result.rows.length !== 1 || result.rows[0].database_matches !== true || result.rows[0].role_matches !== true) {
      throw new Error('Auth integration connection identity mismatch.');
    }
  } catch { throw new Error('Auth integration connection identity could not be verified.'); }
  finally { await pool.end(); }
  return value;
}

function cookies(response: Response) {
  return response.headers.getSetCookie().map(value => value.split(';', 1)[0])
    .filter(value => !value.endsWith('=')).join('; ');
}

function fixture() {
  const suffix = randomUUID();
  const emailA = `reset-a-${suffix}@example.test`, emailB = `reset-b-${suffix}@example.test`;
  fixtureEmails.push(emailA, emailB);
  const config: AccountAuthConfiguration = {
    appOrigin: origin, issuer: `${origin}/api/auth`,
    secret: 'Synthetic-integration-secret-only-not-a-deployed-credential-123!',
    databaseUrl, invitedEmails: new Set([emailA, emailB]),
    emailApiKey: 'synthetic-not-a-mail-key', emailFrom: 'unused@example.test',
  };
  async function request(path: string, body?: Record<string, unknown>, cookie?: string, ipOverride?: string) {
    // Each call uses the real production request transaction and an independent
    // restricted-login connection. Only email delivery is replaced in memory.
    const count = ++requestNumber;
    const headers = new Headers({ origin, 'x-forwarded-for': ipOverride ?? `198.51.100.${count % 250 + 1}` });
    if (body) headers.set('content-type', 'application/json');
    if (cookie) headers.set('cookie', cookie);
    try {
      return await handleAccountAuth(config, new Request(`${origin}/api/auth/${path}`, {
        method: body ? 'POST' : 'GET', headers, ...(body ? { body: JSON.stringify(body) } : {}),
      }));
    } catch (error) { throw safeDatabaseError(error); }
  }
  async function register(email = emailA, password = oldPassword) {
    expect((await request('sign-up/email', { email, password, name: 'Synthetic integration member' })).status).toBe(200);
    const text = deliver.mock.calls.map(([, message]) => message)
      .findLast(message => message.to === email && message.subject.startsWith('Verify'))?.text;
    const otp = text?.match(/verification code is: (\d+)/)?.[1];
    expect(Boolean(otp)).toBe(true);
    expect((await request('email-otp/verify-email', { email, otp })).status).toBe(200);
  }
  async function signIn(email = emailA, password = oldPassword) {
    const response = await request('sign-in/email', { email, password });
    return { response, cookie: cookies(response) };
  }
  async function session(cookie: string): Promise<SessionResult> {
    const response = await request('get-session', undefined, cookie);
    expect(response.status).toBe(200);
    return safeSession(await response.json());
  }
  async function resetToken() {
    expect((await request('request-password-reset', { email: emailA, redirectTo: `${origin}/sign-in` })).status).toBe(200);
    const text = deliver.mock.calls.map(([, message]) => message)
      .findLast(message => message.to === emailA && message.subject.startsWith('Reset'))?.text;
    const link = text?.split(/\s+/).find(value => value.startsWith(`${origin}/sign-in?`));
    const token = link ? new URL(link).searchParams.get('token') : null;
    expect(Boolean(token)).toBe(true);
    return token!;
  }
  return { emailA, emailB, request, register, signIn, session, resetToken };
}

async function waitForBlocked(client: PoolClient, blockingPid: number, operation: 'session-insert' | 'session-delete' | 'mutation-lock') {
  const queryFragment = operation === 'session-insert' ? 'insert into "website_auth"."session"%'
    : operation === 'session-delete' ? 'delete from "website_auth"."session"%' : '%pg_advisory_xact_lock%';
  const deadline = Date.now() + 3_000;
  while (Date.now() < deadline) {
    await client.query('SELECT pg_stat_clear_snapshot()');
    const result = await client.query(`SELECT pid FROM pg_stat_activity WHERE datname=current_database()
      AND usename='league_one_auth' AND $1=ANY(pg_blocking_pids(pid)) AND query ILIKE $2`, [blockingPid, queryFragment]);
    if (result.rows.length === 1) return result.rows[0].pid as number;
    if (result.rows.length > 1) throw new Error('Unexpected concurrent auth requests in the isolated reset barrier.');
    await delay(25);
  }
  throw new Error('The expected production auth transaction did not reach the bounded database barrier.');
}

async function withRowBarrier<T>(table: 'user' | 'session', id: string,
  run: (barrier: { pid: number; release: () => Promise<void>; blocked: (pid: number, operation: Parameters<typeof waitForBlocked>[2]) => Promise<number> }) => Promise<T>) {
  await assertSafeIntegrationDatabase();
  const pool = new Pool({ connectionString: integrationEnvironment().ownerDatabaseUrl, max: 1,
    connectionTimeoutMillis: 5_000, query_timeout: 10_000, statement_timeout: 10_000 });
  pool.on('error', () => {});
  const client = await pool.connect().catch(async () => {
    await pool.end();
    throw new Error('The isolated owner barrier connection could not be established.');
  });
  let released = false;
  async function release() { if (!released) { await client.query('ROLLBACK'); released = true; } }
  try {
    await client.query('BEGIN');
    const locked = await client.query(`SELECT id FROM website_auth."${table}" WHERE id=$1 FOR UPDATE`, [id]);
    if (locked.rows.length !== 1) throw new Error('Synthetic auth barrier row is missing.');
    const pid = (await client.query('SELECT pg_backend_pid() AS pid')).rows[0].pid as number;
    return await run({ pid, release, blocked: (blockingPid, operation) => waitForBlocked(client, blockingPid, operation) });
  } finally {
    try { await release(); } finally { client.release(true); await pool.end(); }
  }
}

beforeAll(async () => {
  databaseUrl = await guardedAuthUrl();
  vi.stubEnv('VERCEL', '1');
  deliver.mockResolvedValue(undefined);
}, 30_000);

afterAll(async () => {
  try {
    if (databaseUrl && fixtureEmails.length) {
      await assertSafeIntegrationDatabase();
      // Only this file's random synthetic users and their reset values; the
      // existing harness owns any complete isolated-schema cleanup.
      await ownerQuery(`DELETE FROM website_auth.verification WHERE value IN
        (SELECT id FROM website_auth."user" WHERE email=ANY($1::text[]))`, [fixtureEmails]);
      await ownerQuery('DELETE FROM website_auth."user" WHERE email=ANY($1::text[])', [fixtureEmails]);
    }
  } finally { vi.unstubAllEnvs(); }
}, 30_000);

describe('real restricted PostgreSQL password-reset transactions', () => {
  it('commits rejected sign-in counters and rate-limits the fourth attempt from the same trusted IP', async () => {
    const f = fixture(); await f.register();
    const ip = '198.51.100.251';
    // Better Auth's maintained storage key is normalized IP + "|" + route.
    // This reserved fixture IP is never used by the per-request IP allocator.
    const key = `${ip}|/sign-in/email`;
    expect(await ownerQuery('SELECT count FROM website_auth."rateLimit" WHERE key=$1', [key])).toEqual([]);
    const statuses: number[] = [];
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const response = await f.request('sign-in/email', { email: f.emailA, password: otherPassword }, undefined, ip);
      statuses.push(response.status);
    }
    expect(statuses).toEqual([401, 401, 401, 429]);
    const counters = await ownerQuery<{ count: number }>('SELECT count FROM website_auth."rateLimit" WHERE key=$1', [key]);
    expect(counters.length === 1 && counters[0].count >= 3).toBe(true);
  });

  it('revokes both frozen cookies without affecting another user, enforces new password and single-use reset', async () => {
    const f = fixture();
    await f.register(); await f.register(f.emailB, otherPassword);
    const a = await f.signIn(), b = await f.signIn(), unrelated = await f.signIn(f.emailB, otherPassword);
    expect([a.response.status, b.response.status, unrelated.response.status]).toEqual([200, 200, 200]);
    const originals = Object.freeze([a.cookie, b.cookie]);
    expect(Boolean(a.cookie) && a.cookie !== b.cookie).toBe(true);
    const before = await Promise.all(originals.map(f.session));
    expect(before.every(value => value?.user.email === f.emailA
      && value.session.userId === value.user.id && Date.parse(value.session.expiresAt) > Date.now() + 60_000)).toBe(true);
    expect(before[0]?.session.id !== before[1]?.session.id).toBe(true);
    const otherBefore = await f.session(unrelated.cookie);
    expect(otherBefore?.user.email).toBe(f.emailB);
    expect(otherBefore?.user.id !== before[0]?.user.id).toBe(true);
    const token = await f.resetToken();
    const reset = await f.request('reset-password', { token, newPassword });
    expect(reset.status).toBe(200); expect(await reset.json()).toEqual({ status: true });
    expect(await Promise.all(originals.map(f.session))).toEqual([null, null]);
    expect((await f.session(unrelated.cookie))?.session.id).toBe(otherBefore?.session.id);
    expect((await f.signIn(f.emailA, oldPassword)).response.status).toBe(401);
    const fresh = await f.signIn(f.emailA, newPassword);
    expect(fresh.response.status).toBe(200);
    expect((await f.session(fresh.cookie))?.user.id).toBe(before[0]?.user.id);
    expect(await Promise.all(originals.map(f.session))).toEqual([null, null]);
    const reuse = await f.request('reset-password', { token, newPassword: otherPassword });
    expect(reuse.status).toBe(400); expect((await reuse.json()).code).toBe('INVALID_TOKEN');
  });

  it('rolls back password, reset-token consumption and sessions when database session deletion fails', async () => {
    const f = fixture(); await f.register();
    const original = await f.signIn(), before = await f.session(original.cookie);
    const userId = before?.user.id;
    if (!userId || !/^[A-Za-z0-9_-]{1,128}$/u.test(userId)) throw new Error('Unsupported synthetic auth user identifier.');
    const token = await f.resetToken();
    await assertSafeIntegrationDatabase();
    const suffix = randomUUID().replaceAll('-', '');
    const name = `reset_failure_${suffix}`;
    try {
      // The owner adds an isolated fixture trigger scoped to this synthetic user.
      // A fixed SQLSTATE proves this fault, rather than an unrelated outage, fired.
      await ownerQuery(`CREATE FUNCTION website_auth.${name}() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN IF OLD."userId"='${userId}' THEN RAISE EXCEPTION 'Synthetic reset deletion failure' USING ERRCODE='P0099'; END IF;
        RETURN OLD; END; $$`);
      await ownerQuery(`CREATE TRIGGER ${name} BEFORE DELETE ON website_auth.session FOR EACH ROW EXECUTE FUNCTION website_auth.${name}()`);
      const failure = await f.request('reset-password', { token, newPassword })
        .then(response => ({ status: response.status, code: '' }), error => ({ status: 0, code: String(error?.code ?? '') }));
      expect(failure).toEqual({ status: 0, code: 'P0099' });
      expect((await f.session(original.cookie))?.session.id).toBe(before?.session.id);
      expect((await f.signIn()).response.status).toBe(200);
      expect((await f.signIn(f.emailA, newPassword)).response.status).toBe(401);
    } finally {
      await ownerQuery(`DROP TRIGGER IF EXISTS ${name} ON website_auth.session`);
      await ownerQuery(`DROP FUNCTION IF EXISTS website_auth.${name}()`);
    }
    const retry = await f.request('reset-password', { token, newPassword });
    expect(retry.status).toBe(200); expect(await retry.json()).toEqual({ status: true });
    expect(await f.session(original.cookie)).toBeNull();
  });

  it('gives concurrent independent reset requests only one successful token consumption', async () => {
    const f = fixture(); await f.register();
    const original = await f.signIn(), token = await f.resetToken();
    const results = await Promise.all([newPassword, otherPassword].map(password =>
      f.request('reset-password', { token, newPassword: password })));
    expect(results.map(response => response.status).sort()).toEqual([200, 400]);
    expect((await results.find(response => response.status === 400)!.json()).code).toBe('INVALID_TOKEN');
    expect(await f.session(original.cookie)).toBeNull();
    const winner = results[0].status === 200 ? newPassword : otherPassword;
    const loser = results[0].status === 200 ? otherPassword : newPassword;
    expect((await f.signIn(f.emailA, winner)).response.status).toBe(200);
    expect((await f.signIn(f.emailA, loser)).response.status).toBe(401);
  });

  it('makes reset wait for an old-password sign-in already inserting its session, then revokes that cookie', async () => {
    const f = fixture(); await f.register();
    const original = await f.signIn(), before = await f.session(original.cookie), token = await f.resetToken();
    if (!before) throw new Error('Synthetic authenticated baseline is missing.');
    await withRowBarrier('user', before.user.id, async barrier => {
      const signIn = f.signIn();
      void signIn.catch(() => {}); // Observed below, including barrier-failure cleanup.
      const pending: Promise<unknown>[] = [signIn];
      try {
        const signInPid = await barrier.blocked(barrier.pid, 'session-insert');
        const reset = f.request('reset-password', { token, newPassword }); pending.push(reset);
        void reset.catch(() => {});
        await barrier.blocked(signInPid, 'mutation-lock');
        await barrier.release();
        const [late, resetResponse] = await Promise.all([signIn, reset]);
        expect(late.response.status).toBe(200); expect(resetResponse.status).toBe(200);
        expect(await f.session(original.cookie)).toBeNull();
        expect(await f.session(late.cookie)).toBeNull();
      } finally { await barrier.release(); await Promise.allSettled(pending); }
    });
  });

  it('makes old-password sign-in wait for a reset already deleting sessions, then rejects it', async () => {
    const f = fixture(); await f.register();
    const original = await f.signIn(), before = await f.session(original.cookie), token = await f.resetToken();
    if (!before) throw new Error('Synthetic authenticated baseline is missing.');
    await withRowBarrier('session', before.session.id, async barrier => {
      const reset = f.request('reset-password', { token, newPassword });
      void reset.catch(() => {});
      const pending: Promise<unknown>[] = [reset];
      try {
        const resetPid = await barrier.blocked(barrier.pid, 'session-delete');
        const signIn = f.signIn(); pending.push(signIn);
        void signIn.catch(() => {});
        await barrier.blocked(resetPid, 'mutation-lock');
        await barrier.release();
        const [resetResponse, late] = await Promise.all([reset, signIn]);
        expect(resetResponse.status).toBe(200); expect(late.response.status).toBe(401);
        expect(await f.session(original.cookie)).toBeNull();
        expect((await f.signIn(f.emailA, newPassword)).response.status).toBe(200);
      } finally { await barrier.release(); await Promise.allSettled(pending); }
    });
  });
});
