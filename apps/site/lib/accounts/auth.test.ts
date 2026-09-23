import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const requestContext = vi.hoisted(() => ({ headers: new Headers(), setCookie: vi.fn() }));
vi.mock('server-only', () => ({}));
vi.mock('next/headers', () => ({
  headers: async () => requestContext.headers,
  cookies: async () => ({ set: requestContext.setCookie }),
}));

// The principal/route boundary is isolated from connections here. The real
// maintained adapter reset and cookie behavior has separate regression coverage.
vi.mock('./auth-runtime', () => ({
  withAccountAuth: async (config: { issuer: string }, operation: (auth: unknown) => Promise<unknown>) => operation({
    api: { getSession: async (options: unknown) => {
      expect(options).toEqual({ headers: requestContext.headers, query: { disableCookieCache: true, disableRefresh: true } });
      const response = await fetch(config.issuer + '/get-session?disableCookieCache=true', { method: 'GET' });
      if (!response.ok) throw new Error('Synthetic runtime failure');
      return response.json();
    } },
  }),
  handleAccountAuth: async (config: { issuer: string }, request: Request) => fetch(
    config.issuer + new URL(request.url).pathname.slice('/api/auth'.length),
    { method: request.method, headers: request.headers, body: request.method === 'POST' ? await request.text() : undefined },
  ),
}));

import {
  AccountAdmissionDeniedError,
  AccountAuthUnavailableError,
  accountsEnabled,
  getAccountAuthAvailability,
  getAccountPrincipal,
  handleAccountAuthRequest,
} from './auth';

const issuer = 'https://app.example.test/api/auth';
const secret = 'synthetic-test-secret-not-used-in-any-environment';
const tokenCookie = '__Secure-league-one-auth.session_token=synthetic-session';
const fetchMock = vi.fn<typeof fetch>();

function sessionFixture(overrides: { email?: string; emailVerified?: boolean; id?: string; name?: string } = {}) {
  const id = overrides.id ?? 'synthetic-user';
  return {
    session: {
      id: 'synthetic-session-id', userId: id, token: 'synthetic-session',
      createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
      expiresAt: '2030-01-01T00:00:00.000Z',
    },
    user: {
      id, email: 'invited@example.test', emailVerified: true, name: 'Invited member',
      createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
      ...overrides,
    },
  };
}

beforeEach(() => {
  vi.stubEnv('ACCOUNTS_ENABLED', 'true');
  vi.stubEnv('VERCEL_ENV', 'development');
  vi.stubEnv('ACCOUNTS_AUTH_ISSUER', issuer);
  vi.stubEnv('ACCOUNTS_AUTH_SECRET', secret);
  vi.stubEnv('ACCOUNTS_AUTH_DATABASE_URL', 'postgresql://league_one_auth:synthetic@ep-synthetic.us-east-1.aws.neon.tech/pilot?sslmode=require');
  vi.stubEnv('ACCOUNTS_EMAIL_API_KEY', 'synthetic-email-key');
  vi.stubEnv('ACCOUNTS_EMAIL_FROM', 'accounts@example.test');
  vi.stubEnv('ACCOUNTS_INVITED_EMAILS', 'invited@example.test');
  vi.stubEnv('ACCOUNTS_APP_ORIGIN', 'https://app.example.test');
  requestContext.headers = new Headers({ cookie: tokenCookie, origin: 'https://app.example.test' });
  requestContext.setCookie.mockReset();
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('account authentication admission', () => {
  it.each([undefined, 'false', 'TRUE', '1'])('requires explicit true feature configuration (%s)', async flag => {
    vi.stubEnv('ACCOUNTS_ENABLED', flag);
    expect(accountsEnabled()).toBe(false);
    expect(getAccountAuthAvailability()).toBe('disabled');
    await expect(getAccountPrincipal()).rejects.toMatchObject({ reason: 'disabled' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('keeps Vercel previews disabled even when auth credentials and the flag are present', async () => {
    vi.stubEnv('VERCEL_ENV', 'preview');
    expect(getAccountAuthAvailability()).toBe('disabled');
    await expect(getAccountPrincipal()).rejects.toMatchObject({ reason: 'disabled' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    ['ACCOUNTS_AUTH_ISSUER', ''],
    ['ACCOUNTS_AUTH_ISSUER', 'http://ep-synthetic.neonauth.us-east-1.aws.neon.tech/neondb/auth'],
    ['ACCOUNTS_AUTH_ISSUER', 'https://unexpected.example.test/auth'],
    ['ACCOUNTS_AUTH_ISSUER', `${issuer}?secret=do-not-return`],
    ['ACCOUNTS_AUTH_SECRET', 'short'],
    ['ACCOUNTS_AUTH_DATABASE_URL', ''],
    ['ACCOUNTS_AUTH_DATABASE_URL', 'postgresql://neondb_owner:synthetic@ep-synthetic.us-east-1.aws.neon.tech/pilot?sslmode=require'],
    ['ACCOUNTS_AUTH_DATABASE_URL', 'postgresql://league_one_auth:synthetic@ep-synthetic.us-east-1.aws.neon.tech/pilot?sslmode=disable'],
    ['ACCOUNTS_AUTH_DATABASE_URL', 'postgresql://league_one_auth:synthetic@ep-synthetic.us-east-1.aws.neon.tech/pilot?sslmode=require&options=unsafe'],
    ['ACCOUNTS_EMAIL_API_KEY', ''],
    ['ACCOUNTS_EMAIL_API_KEY', 'synthetic\r\nInjected: value'],
    ['ACCOUNTS_EMAIL_FROM', 'invalid'],
    ['ACCOUNTS_INVITED_EMAILS', ''],
    ['ACCOUNTS_INVITED_EMAILS', 'invalid'],
    ['ACCOUNTS_APP_ORIGIN', 'https://app.example.test/unexpected-path'],
    ['ACCOUNTS_APP_ORIGIN', 'http://app.example.test'],
  ])('fails closed for invalid %s', async (key, value) => {
    vi.stubEnv(key, value);
    expect(getAccountAuthAvailability()).toBe('unavailable');
    await expect(getAccountPrincipal()).rejects.toMatchObject({
      reason: 'configuration', message: 'Account authentication is unavailable.',
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns only stable configured issuer, subject, and display name after verified invite admission', async () => {
    vi.stubEnv('ACCOUNTS_AUTH_ISSUER', issuer);
    vi.stubEnv('ACCOUNTS_INVITED_EMAILS', ' Other@example.test, INVITED@example.test\n');
    requestContext.headers.set('host', 'untrusted.example.test');
    fetchMock.mockResolvedValueOnce(Response.json(sessionFixture()));
    expect(getAccountAuthAvailability()).toBe('available');
    await expect(getAccountPrincipal()).resolves.toEqual({
      issuer, subject: 'synthetic-user', displayName: 'Invited member',
    });
    expect(fetchMock).toHaveBeenCalledExactlyOnceWith(
      `${issuer}/get-session?disableCookieCache=true`,
      expect.objectContaining({ method: 'GET' }),
    );
  });

  it('fails closed when the stored session cannot be read', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('synthetic database error'));
    await expect(getAccountPrincipal()).rejects.toBeInstanceOf(AccountAuthUnavailableError);
  });

  it('requires verified email even for an invited email address', async () => {
    fetchMock.mockResolvedValueOnce(Response.json(sessionFixture({ emailVerified: false })));
    await expect(getAccountPrincipal()).rejects.toMatchObject({ reason: 'email_unverified' });
  });

  it('denies verified identities that are not invited', async () => {
    fetchMock.mockResolvedValueOnce(Response.json(sessionFixture({ email: 'outsider@example.test' })));
    await expect(getAccountPrincipal()).rejects.toBeInstanceOf(AccountAdmissionDeniedError);
  });

  it('rejects a missing or expired session and mismatched session ownership', async () => {
    for (const data of [null, { ...sessionFixture(), session: null }, {
      ...sessionFixture(), session: { ...sessionFixture().session, expiresAt: '2020-01-01T00:00:00Z' },
    }, { ...sessionFixture(), session: { ...sessionFixture().session, userId: 'another-user' } }]) {
      fetchMock.mockResolvedValueOnce(Response.json(data));
      await expect(getAccountPrincipal()).resolves.toBeNull();
    }
  });

  it.each([401, 403])('fails closed if the runtime unexpectedly rejects with %s', async status => {
    fetchMock.mockResolvedValueOnce(Response.json({ message: 'Not authenticated' }, { status }));
    await expect(getAccountPrincipal()).rejects.toBeInstanceOf(AccountAuthUnavailableError);
  });
});

describe('feature-gated maintained auth handler', () => {
  it('returns a non-cacheable 404 without contacting auth when disabled', async () => {
    vi.stubEnv('ACCOUNTS_ENABLED', 'false');
    const response = await handleAccountAuthRequest(new Request('https://app.example.test/api/auth/get-session'), {
      params: Promise.resolve({ path: ['get-session'] }),
    });
    expect(response.status).toBe(404);
    expect(response.headers.get('Cache-Control')).toBe('private, no-store');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([null, 'https://foreign.example.test'])('rejects origin %s before the maintained provider check', async origin => {
    const request = new Request('https://app.example.test/api/auth/sign-in/email', {
      method: 'POST', headers: { ...(origin ? { origin } : {}), 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'invited@example.test', password: 'synthetic-password' }),
    });
    const response = await handleAccountAuthRequest(request, { params: Promise.resolve({ path: ['sign-in', 'email'] }) });
    expect(response.status).toBe(403);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(response.headers.get('Cache-Control')).toBe('private, no-store');
  });

  it.each([
    { declared: '20000', body: '{}' },
    { declared: '2', body: JSON.stringify({ padding: 'x'.repeat(16 * 1_024) }) },
    { declared: null, body: JSON.stringify({ padding: 'x'.repeat(16 * 1_024) }) },
  ])('bounds actual body bytes as well as declared length ($declared)', async ({ declared, body }) => {
    const response = await handleAccountAuthRequest(new Request('https://app.example.test/api/auth/sign-in/email', {
      method: 'POST',
      headers: {
        origin: 'https://app.example.test', 'Content-Type': 'application/json',
        ...(declared === null ? {} : { 'Content-Length': declared }),
      },
      body,
    }), { params: Promise.resolve({ path: ['sign-in', 'email'] }) });
    expect(response.status).toBe(413);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects form posts and provider/admin routes outside the email account pilot', async () => {
    for (const [path, contentType, expectedStatus] of [
      ['sign-in/email', 'application/x-www-form-urlencoded', 415],
      ['admin/set-role', 'application/json', 404],
      ['delete-user', 'application/json', 404],
      ['sign-in/social', 'application/json', 404],
      ['sign-in/email-otp', 'application/json', 404],
      ['email-otp/reset-password', 'application/json', 404],
    ] as const) {
      const response = await handleAccountAuthRequest(new Request(`https://app.example.test/api/auth/${path}`, {
        method: 'POST', headers: { origin: 'https://app.example.test', 'Content-Type': contentType }, body: '{}',
      }), { params: Promise.resolve({ path: path.split('/') }) });
      expect(response.status).toBe(expectedStatus);
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects alternate OTP purposes and encoded endpoint aliases before opening auth', async () => {
    for (const [path, requestedPath, body] of [
      ['email-otp/send-verification-otp', ['email-otp', 'send-verification-otp'], { type: 'sign-in' }],
      ['sign-in%2Femail', ['sign-in', 'email'], {}],
    ] as const) {
      const response = await handleAccountAuthRequest(new Request(`https://app.example.test/api/auth/${path}`, {
        method: 'POST', headers: { origin: 'https://app.example.test', 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      }), { params: Promise.resolve({ path: [...requestedPath] }) });
      expect(response.status).toBe(400);
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each(['', '{', 'null', '[]', '"string"', '1', 'true'])('rejects invalid or nonobject JSON (%s) before the provider', async body => {
    const response = await handleAccountAuthRequest(new Request('https://app.example.test/api/auth/sign-up/email', {
      method: 'POST', headers: { origin: 'https://app.example.test', 'Content-Type': 'application/json' }, body,
    }), { params: Promise.resolve({ path: ['sign-up', 'email'] }) });
    expect(response.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects invalid UTF-8 instead of replacing bytes before JSON validation', async () => {
    const response = await handleAccountAuthRequest(new Request('https://app.example.test/api/auth/sign-out', {
      method: 'POST', headers: { origin: 'https://app.example.test', 'Content-Type': 'application/json' },
      body: new Uint8Array([123, 34, 120, 34, 58, 34, 255, 34, 125]),
    }), { params: Promise.resolve({ path: ['sign-out'] }) });
    expect(response.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([undefined, null, 42, 'outsider@example.test'])('denies uninvited signup (%s) before account creation or email delivery', async email => {
    const response = await handleAccountAuthRequest(new Request('https://app.example.test/api/auth/sign-up/email', {
      method: 'POST', headers: { origin: 'https://app.example.test', 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, name: 'Synthetic member', password: 'synthetic-password' }),
    }), { params: Promise.resolve({ path: ['sign-up', 'email'] }) });
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ status: 'admission_denied' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('forwards invited signup through the maintained SDK using case-insensitive invite matching', async () => {
    fetchMock.mockResolvedValueOnce(Response.json({ user: sessionFixture().user }));
    const response = await handleAccountAuthRequest(new Request('https://app.example.test/api/auth/sign-up/email', {
      method: 'POST', headers: { origin: 'https://app.example.test', 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'INVITED@example.test', name: 'Synthetic member', password: 'synthetic-password',
        callbackURL: 'https://app.example.test/sign-in' }),
    }), { params: Promise.resolve({ path: ['sign-up', 'email'] }) });
    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledExactlyOnceWith(`${issuer}/sign-up/email`, expect.objectContaining({ method: 'POST' }));
  });

  it.each([
    'https://foreign.example.test/sign-in',
    'http://app.example.test/sign-in',
    'https://app.example.test:8443/sign-in',
    'https://app.example.test/account',
    'https://app.example.test/sign-in?redirectTo=https://foreign.example.test',
    'https://app.example.test/sign-in#destination',
    'https://user:password@app.example.test/sign-in',
    '//foreign.example.test/sign-in',
    '/sign-in',
    'javascript:alert(1)',
    null,
    ['https://app.example.test/sign-in'],
  ])('rejects unsafe callback and recovery destinations (%j) before sending email', async destination => {
    for (const [path, field] of [['send-verification-email', 'callbackURL'], ['request-password-reset', 'redirectTo']] as const) {
      const response = await handleAccountAuthRequest(new Request(`https://app.example.test/api/auth/${path}`, {
        method: 'POST', headers: { origin: 'https://app.example.test', 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'invited@example.test', [field]: destination }),
      }), { params: Promise.resolve({ path: [path] }) });
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ status: 'invalid_callback' });
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([['send-verification-email', 'callbackURL'], ['request-password-reset', 'redirectTo']])(
    'allows the configured sign-in destination for %s', async (path, field) => {
      fetchMock.mockResolvedValueOnce(Response.json({ success: true }));
      const response = await handleAccountAuthRequest(new Request(`https://app.example.test/api/auth/${path}`, {
        method: 'POST', headers: { origin: 'https://app.example.test', 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'invited@example.test', [field]: 'https://app.example.test/sign-in' }),
      }), { params: Promise.resolve({ path: [path] }) });
      expect(response.status).toBe(200);
      expect(fetchMock).toHaveBeenCalledExactlyOnceWith(`${issuer}/${path}`, expect.objectContaining({ method: 'POST' }));
    },
  );

  it.each(['callbackURL', 'redirectTo'])('rejects alternate %s query transport before the SDK forwards it', async field => {
    const url = new URL('https://app.example.test/api/auth/request-password-reset');
    url.searchParams.set(field, 'https://app.example.test/sign-in');
    const response = await handleAccountAuthRequest(new Request(url, {
      method: 'POST', headers: { origin: 'https://app.example.test', 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'invited@example.test' }),
    }), { params: Promise.resolve({ path: ['request-password-reset'] }) });
    expect(response.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('allows the exact configured origin without treating the incoming Host as authority', async () => {
    fetchMock.mockResolvedValueOnce(Response.json({ error: 'synthetic invalid password' }, { status: 401 }));
    const response = await handleAccountAuthRequest(new Request('https://internal-proxy.example.test/api/auth/sign-in/email', {
      method: 'POST',
      headers: { origin: 'https://app.example.test', 'Content-Type': 'application/json', host: 'untrusted.example.test' },
      body: JSON.stringify({ email: 'invited@example.test', password: 'synthetic-password' }),
    }), { params: Promise.resolve({ path: ['sign-in', 'email'] }) });
    expect(response.status).toBe(401);
    expect(new Headers(fetchMock.mock.calls[0][1]?.headers).get('Origin')).toBe('https://app.example.test');
    expect(fetchMock).toHaveBeenCalledOnce();
  });
});
