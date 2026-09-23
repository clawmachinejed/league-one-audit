import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { memoryAdapter } from 'better-auth/adapters/memory';
import type { BetterAuthOptions, DBAdapter } from 'better-auth';
import { sendAccountEmail } from './auth-email';
import { createAccountAuth } from './auth-runtime';

vi.mock('server-only', () => ({}));
vi.mock('./auth-email', () => ({ sendAccountEmail: vi.fn() }));

const origin = 'https://reset-regression.example.test';
const emailA = 'member-a@example.test';
const emailB = 'member-b@example.test';
const oldPassword = 'Synthetic-only-old-password-123!';
const newPassword = 'Synthetic-only-new-password-456!';
const otherPassword = 'Synthetic-only-other-password-789!';
const network = vi.fn<typeof fetch>();
const deliver = vi.mocked(sendAccountEmail);

type Operation = 'create' | 'updateMany' | 'deleteMany';
type Interceptor = (operation: Operation, model: string) => Promise<void>;
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

function barrier() {
  let release!: () => void;
  const promise = new Promise<void>(resolve => { release = resolve; });
  return { promise, release };
}

/** Wrap adapter calls only to inject a failure or a deterministic interleaving.
 * All credentials, tokens, hashing, cookies and reset behavior remain maintained. */
function interceptAdapter(adapter: DBAdapter, before: Interceptor): DBAdapter {
  return new Proxy(adapter, {
    get(target, property, receiver) {
      if (property === 'create' || property === 'updateMany' || property === 'deleteMany') {
        return async (input: { model: string }) => {
          await before(property, input.model);
          return Reflect.apply(target[property], target, [input]);
        };
      }
      return Reflect.get(target, property, receiver);
    },
  });
}

function frozenCookies(response: Response): string {
  // getSetCookie preserves Expires commas and wire encoding. Do not decode,
  // re-sign, or apply cookies subsequently returned by session probes.
  return response.headers.getSetCookie().map(header => header.split(';', 1)[0])
    .filter(pair => !pair.endsWith('=')).join('; ');
}

function fixture() {
  const database = { user: [], account: [], session: [], verification: [], rateLimit: [] };
  let interceptor: Interceptor = async () => {};
  const adapter = memoryAdapter(database);
  const auth = createAccountAuth({
    appOrigin: origin,
    issuer: `${origin}/api/auth`,
    secret: 'Synthetic-test-secret-used-only-in-this-offline-suite-123!',
    databaseUrl: 'postgresql://unused:unused@invalid.example.test/unused',
    invitedEmails: new Set([emailA, emailB]),
    emailApiKey: 'synthetic-not-a-provider-key',
    emailFrom: 'unused@example.test',
  }, (options: BetterAuthOptions) => interceptAdapter(adapter(options), (operation, model) => interceptor(operation, model)));
  let ip = 0;
  async function request(path: string, body?: Record<string, unknown>, cookie?: string) {
    const headers = new Headers({ origin, 'x-forwarded-for': `192.0.2.${++ip}` });
    if (body) headers.set('content-type', 'application/json');
    if (cookie) headers.set('cookie', cookie);
    try {
      return await auth.handler(new Request(`${origin}/api/auth/${path}`, {
        method: body ? 'POST' : 'GET', headers,
        ...(body ? { body: JSON.stringify(body) } : {}),
      }));
    } catch { throw new Error('Offline account request failed.'); }
  }
  async function register(email: string, password = oldPassword) {
    const response = await request('sign-up/email', { email, password, name: 'Synthetic member' });
    expect(response.status).toBe(200);
    const message = deliver.mock.calls.map(([, value]) => value)
      .findLast(value => value.to === email && value.subject.startsWith('Verify'));
    const otp = message?.text.match(/verification code is: (\d+)/)?.[1];
    expect(Boolean(otp)).toBe(true);
    const verified = await request('email-otp/verify-email', { email, otp });
    expect(verified.status).toBe(200);
  }
  async function signIn(email = emailA, password = oldPassword) {
    const response = await request('sign-in/email', { email, password });
    return { response, cookie: frozenCookies(response) };
  }
  async function session(cookie: string): Promise<SessionResult> {
    // Deliberately omit disableCookieCache: actual runtime disables cookie cache.
    const response = await request('get-session', undefined, cookie);
    expect(response.status).toBe(200);
    return safeSession(await response.json());
  }
  async function resetToken(email = emailA) {
    const response = await request('request-password-reset', { email, redirectTo: `${origin}/sign-in` });
    expect(response.status).toBe(200);
    const message = deliver.mock.calls.map(([, value]) => value)
      .findLast(value => value.to === email && value.subject.startsWith('Reset'));
    const link = message?.text.split(/\s+/).find(value => value.startsWith(`${origin}/sign-in?`));
    const token = link ? new URL(link).searchParams.get('token') : null;
    expect(Boolean(token)).toBe(true);
    return token!;
  }
  return { request, register, signIn, session, resetToken,
    intercept(value: Interceptor) { interceptor = value; } };
}

beforeEach(() => {
  // Exercise the factory's production proxy trust setting using synthetic IPs,
  // without changing its persisted rate-limit policy or any other auth option.
  vi.stubEnv('VERCEL', '1');
  network.mockReset().mockRejectedValue(new Error('Offline auth test forbids network access.'));
  vi.stubGlobal('fetch', network);
  deliver.mockReset().mockResolvedValue(undefined);
});

afterEach(() => {
  expect(network).not.toHaveBeenCalled();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('maintained account reset policy with an in-memory adapter', () => {
  it('revokes both unchanged original cookies, preserves another user, and accepts only the new password', async () => {
    const f = fixture();
    await f.register(emailA);
    await f.register(emailB, otherPassword);
    const first = await f.signIn();
    const second = await f.signIn();
    const unrelated = await f.signIn(emailB, otherPassword);
    expect([first.response.status, second.response.status, unrelated.response.status]).toEqual([200, 200, 200]);
    const originals = Object.freeze([first.cookie, second.cookie]);
    expect(Boolean(originals[0]) && originals[0] !== originals[1]).toBe(true);
    const before = await Promise.all(originals.map(f.session));
    expect(before.every(value => value?.user.email === emailA
      && value.session.userId === value.user.id
      && Date.parse(value.session.expiresAt) > Date.now() + 60_000)).toBe(true);
    expect(before[0]?.session.id !== before[1]?.session.id).toBe(true);
    const unrelatedBefore = await f.session(unrelated.cookie);
    expect(unrelatedBefore?.user.email).toBe(emailB);
    expect(unrelatedBefore?.user.id !== before[0]?.user.id).toBe(true);

    const token = await f.resetToken();
    const reset = await f.request('reset-password', { token, newPassword });
    expect(reset.status).toBe(200);
    expect(await reset.json()).toEqual({ status: true });
    expect(await Promise.all(originals.map(f.session))).toEqual([null, null]);
    expect((await f.session(unrelated.cookie))?.session.id).toBe(unrelatedBefore?.session.id);
    expect((await f.signIn(emailA, oldPassword)).response.status).toBe(401);
    const replacement = await f.signIn(emailA, newPassword);
    expect(replacement.response.status).toBe(200);
    expect((await f.session(replacement.cookie))?.user.id).toBe(before[0]?.user.id);
    expect(await Promise.all(originals.map(f.session))).toEqual([null, null]);

    const reuse = await f.request('reset-password', { token, newPassword: otherPassword });
    expect(reuse.status).toBe(400);
    expect((await reuse.json()).code).toBe('INVALID_TOKEN');
    expect((await f.session(replacement.cookie))?.user.id).toBe(before[0]?.user.id);
    expect((await f.session(unrelated.cookie))?.session.id).toBe(unrelatedBefore?.session.id);
  }, 15_000);

  it('does not report success before maintained session deletion completes', async () => {
    const f = fixture();
    await f.register(emailA);
    const original = await f.signIn();
    const token = await f.resetToken();
    const reached = barrier(), resume = barrier();
    f.intercept(async (operation, model) => {
      if (operation === 'deleteMany' && model === 'session') { reached.release(); await resume.promise; }
    });
    let settled = false;
    const pending = f.request('reset-password', { token, newPassword }).then(response => { settled = true; return response; });
    try {
      await reached.promise;
      expect(settled).toBe(false);
    } finally { resume.release(); }
    expect((await pending).status).toBe(200);
    expect(await f.session(original.cookie)).toBeNull();
  }, 15_000);

  it.each(['updateMany', 'deleteMany'] as const)('never reports reset success when %s fails', async operation => {
    const f = fixture();
    await f.register(emailA);
    const original = await f.signIn();
    expect((await f.session(original.cookie))?.user.email).toBe(emailA);
    const token = await f.resetToken();
    let injected = false;
    f.intercept(async (actual, model) => {
      if (actual === operation && model === (operation === 'updateMany' ? 'account' : 'session')) {
        injected = true;
        throw new Error('Synthetic adapter failure.');
      }
    });
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      await expect(f.request('reset-password', { token, newPassword })).rejects.toThrow('Offline account request failed.');
      expect(injected).toBe(true);
      expect(errors).not.toHaveBeenCalled();
    } finally { errors.mockRestore(); }
    // The factory's reset route does not promise a transaction spanning password
    // and session writes. Production rollback is a PostgreSQL orchestration gate.
  }, 15_000);

  it('allows only one concurrent reset with the same token in this process', async () => {
    const f = fixture();
    await f.register(emailA);
    const original = await f.signIn();
    const token = await f.resetToken();
    const results = await Promise.all([newPassword, otherPassword].map(password =>
      f.request('reset-password', { token, newPassword: password })));
    expect(results.map(response => response.status).sort()).toEqual([200, 400]);
    const rejected = results.find(response => response.status === 400)!;
    expect((await rejected.json()).code).toBe('INVALID_TOKEN');
    expect(await f.session(original.cookie)).toBeNull();
    const winner = results[0].status === 200 ? newPassword : otherPassword;
    const loser = results[0].status === 200 ? otherPassword : newPassword;
    expect((await f.signIn(emailA, winner)).response.status).toBe(200);
    expect((await f.signIn(emailA, loser)).response.status).toBe(401);
    // This tests the maintained in-process token-consumption boundary, not
    // isolation between production processes or independent PostgreSQL clients.
  }, 15_000);

  it('demonstrates why a sign-in already past password verification needs the production transaction guard', async () => {
    const f = fixture();
    await f.register(emailA);
    const original = await f.signIn();
    const token = await f.resetToken();
    const reached = barrier(), resume = barrier();
    let blockOnce = true;
    f.intercept(async (operation, model) => {
      // The maintained sign-in route verifies the password before creating its
      // session. Pause that INSERT until the concurrent reset has finished.
      if (operation === 'create' && model === 'session' && blockOnce) {
        blockOnce = false; reached.release(); await resume.promise;
      }
    });
    const pendingSignIn = f.signIn();
    let reset: Response;
    try {
      await reached.promise;
      reset = await f.request('reset-password', { token, newPassword });
      expect(reset.status).toBe(200);
      expect(await f.session(original.cookie)).toBeNull();
    } finally { resume.release(); }
    const late = await pendingSignIn;
    expect(late.response.status).toBe(200);
    expect((await f.session(late.cookie))?.user.email).toBe(emailA);
    // Intentionally characterize the unwrapped factory limitation. This is not
    // a production concurrency pass: withAccountAuth must serialize these
    // requests, and the real PostgreSQL regression must reject this late cookie.
  }, 15_000);
});
