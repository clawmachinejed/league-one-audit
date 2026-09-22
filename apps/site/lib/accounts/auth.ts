import 'server-only';

import { createNeonAuth } from '@neondatabase/auth/next/server';

export type AccountPrincipal = {
  issuer: string;
  subject: string;
  displayName: string;
};

export class AccountAuthUnavailableError extends Error {
  constructor(readonly reason: 'disabled' | 'configuration' | 'provider') {
    super('Account authentication is unavailable.');
    this.name = 'AccountAuthUnavailableError';
  }
}

export class AccountAdmissionDeniedError extends Error {
  constructor(readonly reason: 'email_unverified' | 'not_invited') {
    super('This account is not admitted to the account pilot.');
    this.name = 'AccountAdmissionDeniedError';
  }
}

export function accountsEnabled(): boolean {
  // Preview credentials must never turn a Vercel preview into a production
  // account writer. Full auth proofs run in an explicitly isolated local setup.
  return process.env.ACCOUNTS_ENABLED === 'true' && process.env.VERCEL_ENV !== 'preview';
}

function accountAuthConfiguration() {
  if (!accountsEnabled()) throw new AccountAuthUnavailableError('disabled');

  const secret = process.env.NEON_AUTH_COOKIE_SECRET;
  const configuredUrl = process.env.NEON_AUTH_BASE_URL;
  const configuredOrigin = process.env.ACCOUNTS_APP_ORIGIN;
  const invitedEmails = new Set((process.env.ACCOUNTS_INVITED_EMAILS ?? '')
    .split(/[,\n]/).map(email => email.trim().toLowerCase()).filter(Boolean));
  let issuer: string;
  let appOrigin: string;
  try {
    const url = new URL((configuredUrl ?? '').replace(/\/+$/, ''));
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash
      || !url.hostname.endsWith('.neon.tech') || !url.pathname.endsWith('/auth')) {
      throw new Error('Invalid auth endpoint.');
    }
    issuer = url.toString().replace(/\/$/, '');
    const origin = new URL(configuredOrigin ?? '');
    const localDevelopment = process.env.NODE_ENV !== 'production' && !process.env.VERCEL_ENV
      && ['localhost', '127.0.0.1', '[::1]'].includes(origin.hostname);
    if ((origin.protocol !== 'https:' && !(localDevelopment && origin.protocol === 'http:'))
      || origin.username || origin.password || origin.pathname !== '/' || origin.search || origin.hash) {
      throw new Error('Invalid application origin.');
    }
    appOrigin = origin.origin;
  } catch {
    throw new AccountAuthUnavailableError('configuration');
  }
  if (!secret || secret.length < 32 || invitedEmails.size === 0
    || [...invitedEmails].some(email => !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))) {
    throw new AccountAuthUnavailableError('configuration');
  }
  return { issuer, secret, invitedEmails, appOrigin };
}

export function getAccountAuthAvailability(): 'disabled' | 'unavailable' | 'available' {
  if (!accountsEnabled()) return 'disabled';
  try {
    accountAuthConfiguration();
    return 'available';
  } catch {
    return 'unavailable';
  }
}

function accountAuth(config: ReturnType<typeof accountAuthConfiguration>) {
  return createNeonAuth({
    baseUrl: config.issuer,
    cookies: { secret: config.secret, sameSite: 'lax' },
    // Upstream diagnostics can contain provider response details. The app returns
    // safe typed failures; credentials and session data never enter its logs.
    logLevel: 'silent',
  });
}

export async function getAccountPrincipal(): Promise<AccountPrincipal | null> {
  const config = accountAuthConfiguration();
  let result;
  try {
    // The pinned SDK's server cache bypass reads the serialized string "true".
    // Keep this authoritative on every private request, including after revocation.
    result = await accountAuth(config).getSession({ query: { disableCookieCache: 'true' } });
  } catch {
    throw new AccountAuthUnavailableError('provider');
  }
  if (result.error) {
    if (result.error.status === 401 || result.error.status === 403) return null;
    throw new AccountAuthUnavailableError('provider');
  }
  if (!result.data?.session || !result.data.user) return null;

  const { user, session } = result.data;
  if (typeof user.id !== 'string' || !user.id || session.userId !== user.id
    || !Number.isFinite(Date.parse(String(session.expiresAt)))
    || Date.parse(String(session.expiresAt)) <= Date.now()) return null;
  if (user.emailVerified !== true) throw new AccountAdmissionDeniedError('email_unverified');
  if (typeof user.email !== 'string' || !config.invitedEmails.has(user.email.trim().toLowerCase())) {
    throw new AccountAdmissionDeniedError('not_invited');
  }
  return {
    issuer: config.issuer,
    subject: user.id,
    displayName: typeof user.name === 'string' ? user.name.trim().slice(0, 100) || 'Member' : 'Member',
  };
}

type AuthRouteContext = { params: Promise<{ path: string[] }> };

const AUTH_BODY_LIMIT = 16 * 1_024;
const AUTH_GET_PATHS = new Set(['get-session', 'list-sessions']);
const AUTH_POST_PATHS = new Set([
  'sign-in/email', 'sign-up/email', 'sign-out', 'send-verification-email',
  'email-otp/verify-email', 'email-otp/send-verification-otp',
  'request-password-reset', 'reset-password', 'change-password',
  'revoke-session', 'revoke-sessions', 'revoke-other-sessions',
]);

function authFailure(status: number, name: string): Response {
  return Response.json({ status: name }, { status, headers: { 'Cache-Control': 'private, no-store' } });
}

async function boundedAuthRequest(request: Request): Promise<{ request: Request; body: Record<string, unknown> } | Response> {
  if (request.headers.get('Content-Type')?.split(';')[0].trim().toLowerCase() !== 'application/json') {
    return authFailure(415, 'unsupported_media_type');
  }
  const length = request.headers.get('Content-Length');
  if (length !== null && (!/^\d+$/.test(length) || Number(length) > AUTH_BODY_LIMIT)) {
    return authFailure(413, 'request_too_large');
  }
  const chunks: Uint8Array[] = [];
  let total = 0;
  const reader = request.body?.getReader();
  try {
    if (reader) {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.byteLength;
        if (total > AUTH_BODY_LIMIT) {
          await reader.cancel();
          return authFailure(413, 'request_too_large');
        }
        chunks.push(value);
      }
    }
  } catch {
    return authFailure(400, 'invalid_request');
  } finally {
    reader?.releaseLock();
  }
  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(body));
  } catch {
    return authFailure(400, 'invalid_request');
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return authFailure(400, 'invalid_request');
  return {
    request: new Request(request.url, { method: 'POST', headers: request.headers, body: body.buffer }),
    body: parsed as Record<string, unknown>,
  };
}

function allowedAuthCallback(value: unknown, appOrigin: string): boolean {
  if (typeof value !== 'string') return false;
  try {
    // The pilot returns to one app page. Requiring an absolute, exact destination
    // also avoids accepting a nested redirect, protocol-relative URL or fragment.
    const callback = new URL(value);
    return callback.origin === appOrigin && callback.pathname === '/sign-in'
      && !callback.username && !callback.password && !callback.search && !callback.hash;
  } catch {
    return false;
  }
}

export async function handleAccountAuthRequest(request: Request, context: AuthRouteContext): Promise<Response> {
  try {
    const config = accountAuthConfiguration();
    const path = (await context.params).path.join('/');
    if (request.method !== 'GET' && request.method !== 'POST') return authFailure(405, 'method_not_allowed');
    if (!(request.method === 'GET' ? AUTH_GET_PATHS : AUTH_POST_PATHS).has(path)) {
      return authFailure(404, 'not_found');
    }
    // The maintained proxy forwards search parameters unchanged. Pilot callback
    // destinations belong in the validated JSON body, never an alternate query.
    const search = new URL(request.url).searchParams;
    if (search.has('callbackURL') || search.has('redirectTo')) return authFailure(400, 'invalid_callback');
    let proxyRequest = request;
    if (request.method === 'POST') {
      if (request.headers.get('Origin') !== config.appOrigin) return authFailure(403, 'invalid_origin');
      const bounded = await boundedAuthRequest(request);
      if (bounded instanceof Response) return bounded;
      for (const field of ['callbackURL', 'redirectTo']) {
        if (Object.hasOwn(bounded.body, field) && !allowedAuthCallback(bounded.body[field], config.appOrigin)) {
          return authFailure(400, 'invalid_callback');
        }
      }
      if (path === 'sign-up/email' && (typeof bounded.body.email !== 'string'
        || !config.invitedEmails.has(bounded.body.email.trim().toLowerCase()))) {
        return authFailure(403, 'admission_denied');
      }
      proxyRequest = bounded.request;
    }
    const handler = accountAuth(config).handler();
    const response = request.method === 'GET'
      ? await handler.GET(proxyRequest, context)
      : await handler.POST(proxyRequest, context);
    response.headers.set('Cache-Control', 'private, no-store');
    return response;
  } catch (error) {
    const status = error instanceof AccountAuthUnavailableError && error.reason === 'disabled' ? 404 : 503;
    return authFailure(status, 'unavailable');
  }
}
