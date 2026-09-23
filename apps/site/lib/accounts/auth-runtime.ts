import 'server-only';

import { Pool } from '@neondatabase/serverless';
import { betterAuth, type BetterAuthOptions } from 'better-auth';
import { APIError } from 'better-auth/api';
import { emailOTP } from 'better-auth/plugins';
import { Kysely, PostgresDialect, sql } from 'kysely';
import { sendAccountEmail } from './auth-email';

export type AccountAuthConfiguration = {
  issuer: string;
  appOrigin: string;
  secret: string;
  databaseUrl: string;
  invitedEmails: ReadonlySet<string>;
  emailApiKey: string;
  emailFrom: string;
};

/** The same maintained configuration is used by the runtime and adapter proofs.
 * Password hashing, recovery tokens, cookies and revocation stay in Better Auth. */
export function createAccountAuth(config: AccountAuthConfiguration, database: BetterAuthOptions['database']) {
  const invited = (email: string) => config.invitedEmails.has(email.trim().toLowerCase());
  return betterAuth({
    appName: 'League One',
    baseURL: config.appOrigin,
    basePath: '/api/auth',
    secret: config.secret,
    database,
    trustedOrigins: [config.appOrigin],
    telemetry: { enabled: false },
    logger: { disabled: true },
    // Better Call otherwise prints untyped errors even with logger disabled.
    // Declared API errors remain HTTP responses; unexpected failures escape to
    // our transaction rollback and safe unavailable response without logging.
    onAPIError: { throw: true },
    advanced: {
      cookiePrefix: 'league-one-auth',
      useSecureCookies: new URL(config.appOrigin).protocol === 'https:',
      defaultCookieAttributes: { httpOnly: true, sameSite: 'lax', path: '/' },
      // Vercel overwrites X-Forwarded-For. Local requests have no trusted proxy
      // and share the library's fallback bucket rather than trusting spoofed IPs.
      ipAddress: { ipAddressHeaders: process.env.VERCEL === '1' ? ['x-forwarded-for'] : [] },
    },
    session: { cookieCache: { enabled: false } },
    account: { accountLinking: { enabled: false } },
    rateLimit: {
      enabled: true,
      storage: 'database',
      window: 60,
      max: 100,
    },
    emailAndPassword: {
      enabled: true,
      requireEmailVerification: true,
      autoSignIn: false,
      revokeSessionsOnPasswordReset: true,
      async sendResetPassword({ user, token }) {
        if (!invited(user.email)) return;
        // Use the maintained token directly on our existing recovery page. This
        // avoids placing a secret in a callback route path or widening the API.
        const url = new URL('/sign-in', config.appOrigin);
        url.searchParams.set('token', token);
        await sendAccountEmail(config, {
          to: user.email,
          subject: 'Reset your League One website password',
          text: `Open this link to reset your website password:\n\n${url.href}\n\nIf you did not request this, you can ignore this email.`,
        });
      },
    },
    emailVerification: { sendOnSignUp: true, autoSignInAfterVerification: false },
    plugins: [emailOTP({
      overrideDefaultEmailVerification: true,
      disableSignUp: true,
      storeOTP: 'hashed',
      expiresIn: 300,
      allowedAttempts: 3,
      async sendVerificationOTP({ email, otp, type }) {
        if (type !== 'email-verification' || !invited(email)) return;
        await sendAccountEmail(config, {
          to: email,
          subject: 'Verify your League One website email',
          text: `Your verification code is: ${otp}\n\nEnter it in Verification code on the League One sign-in page. This code expires in 5 minutes.`,
        });
      },
    })],
    databaseHooks: {
      user: {
        create: { async before(user) {
          if (!invited(user.email)) throw new APIError('FORBIDDEN', { code: 'ADMISSION_DENIED', message: 'Account creation is unavailable.' });
          return { data: user };
        } },
      },
    },
  });
}

type AuthDatabase = Kysely<Record<string, Record<string, unknown>>>;

/** Neon WebSocket connections cannot survive a serverless request boundary. */
async function withAuthDatabase<T>(config: AccountAuthConfiguration, operation: (database: AuthDatabase) => Promise<T>): Promise<T> {
  const pool = new Pool({
    connectionString: config.databaseUrl,
    max: 2,
    connectionTimeoutMillis: 5_000,
    query_timeout: 10_000,
    statement_timeout: 10_000,
    idleTimeoutMillis: 5_000,
  });
  pool.on('error', () => { /* Request failures are handled without logging credential-bearing driver errors. */ });
  try {
    // Kysely needs the pool protocol, not node-postgres's Client constructor.
    // Neon exposes compatible acquired clients through its maintained Pool.
    const postgresPool = { connect: () => pool.connect(), end: () => pool.end(), options: pool.options };
    const database = new Kysely<Record<string, Record<string, unknown>>>({ dialect: new PostgresDialect({ pool: postgresPool }) }).withSchema('website_auth');
    return await operation(database);
  } finally {
    await pool.end();
  }
}

export async function withAccountAuth<T>(config: AccountAuthConfiguration, operation: (auth: ReturnType<typeof createAccountAuth>) => Promise<T>): Promise<T> {
  return withAuthDatabase(config, database => operation(createAccountAuth(config, { db: database, type: 'postgres', transaction: true })));
}

const SECURITY_MUTATIONS = new Set([
  '/api/auth/sign-up/email', '/api/auth/sign-in/email', '/api/auth/reset-password',
  '/api/auth/change-password', '/api/auth/sign-out', '/api/auth/email-otp/verify-email',
  '/api/auth/revoke-session', '/api/auth/revoke-sessions', '/api/auth/revoke-other-sessions',
]);

class AuthTransactionFailure extends Error {
  constructor(readonly response: Response) { super('Account authentication transaction failed.'); }
}

/** Serialize credential/session changes using one database transaction lock.
 * This finite pilot boundary lets the maintained library finish reset token
 * consumption, password replacement and session deletion atomically, and stops
 * an in-flight old-password sign-in from issuing a session after reset commits.
 * Ordinary rejected requests commit their rate-limit and OTP-attempt counters. */
export async function handleAccountAuth(config: AccountAuthConfiguration, request: Request): Promise<Response> {
  try {
    return await withAuthDatabase(config, database => database.transaction().execute(async transaction => {
      await sql`select set_config('lock_timeout', '5000', true)`.execute(transaction);
      if (request.method === 'POST' && SECURITY_MUTATIONS.has(new URL(request.url).pathname)) {
        await sql`select pg_advisory_xact_lock(19740517, 1)`.execute(transaction);
      }
      // The outer transaction owns rollback. Nested adapter transactions are
      // disabled; every maintained adapter operation uses this same connection.
      const auth = createAccountAuth(config, { db: transaction, type: 'postgres', transaction: false });
      const response = await auth.handler(request);
      if (response.status >= 500) throw new AuthTransactionFailure(response);
      // A maintained endpoint can catch a driver error (notably sign-out).
      // PostgreSQL then marks the transaction aborted: prove it is still usable
      // before COMMIT, which otherwise silently rolls an aborted transaction back.
      await sql`select 1`.execute(transaction);
      return response;
    }));
  } catch (error) {
    if (error instanceof AuthTransactionFailure) return error.response;
    throw error;
  }
}
