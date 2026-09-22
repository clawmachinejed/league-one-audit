import 'server-only';
import { neon } from '@neondatabase/serverless';
import type { DatabaseRow, DatabaseStatement } from '../../database';
import { accountUuid } from '../validation';

export class AccountStoreUnavailableError extends Error {
  constructor() { super('Account storage is unavailable.'); this.name = 'AccountStoreUnavailableError'; }
}
export class AccountWriteRateLimitError extends Error {
  constructor() { super('Too many account changes.'); this.name = 'AccountWriteRateLimitError'; }
}
export type AccountDatabase = {
  transaction: (statements: readonly DatabaseStatement[], context?: { actorUserId: string; requestId: string }) => Promise<readonly (readonly DatabaseRow[])[]>;
};

// A URL alone is not a privilege check. Verify the actual authenticated role and
// physical RLS boundary inside every transaction, before accessing private data.
export const ACCOUNT_DATABASE_GUARD = `DO $guard$ BEGIN
  IF current_user<>'league_one_account' OR session_user<>'league_one_account'
    OR EXISTS(SELECT 1 FROM pg_roles WHERE rolname=current_user AND
      (rolsuper OR rolbypassrls OR rolcreatedb OR rolcreaterole OR rolreplication OR rolinherit))
    OR EXISTS(SELECT 1 FROM pg_auth_members WHERE member=current_user::regrole)
    OR EXISTS(SELECT 1 FROM pg_class WHERE relowner=current_user::regrole)
    OR EXISTS(SELECT 1 FROM pg_proc WHERE proowner=current_user::regrole)
    OR (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='public' AND c.relrowsecurity AND c.relname IN
      ('app_users','app_login_identities','app_provider_account_links','app_user_leagues',
       'app_league_groups','app_league_group_memberships','app_identity_audit_events'))<>7 THEN
    RAISE EXCEPTION 'account database security boundary is unavailable';
  END IF;
END $guard$;`;

export function accountDatabaseUrl(environment: Readonly<Record<string, string | undefined>>): string | null {
  // The existing projection preview guard is untouched. This independent private
  // credential is also never used in previews, even if production env was copied.
  if (environment.ACCOUNTS_ENABLED !== 'true' || environment.VERCEL_ENV === 'preview') return null;
  try {
    const url = new URL(environment.ACCOUNT_DATABASE_URL ?? '');
    if (!['postgres:', 'postgresql:'].includes(url.protocol) || !url.hostname || !url.password
      || decodeURIComponent(url.username) !== 'league_one_account'
      || !['require', 'verify-full', 'verify-ca'].includes(url.searchParams.get('sslmode') ?? '')) return null;
    return url.toString();
  } catch { return null; }
}

export function createAccountDatabase(environment: Readonly<Record<string, string | undefined>> = process.env): AccountDatabase {
  const url = accountDatabaseUrl(environment);
  if (!url) throw new AccountStoreUnavailableError();
  const sql = neon(url);
  return {
    async transaction(statements, context) {
      const actor = context ? accountUuid(context.actorUserId) : '';
      const requestId = context ? accountUuid(context.requestId) : '';
      if (statements.length < 1 || statements.length > 8) throw new AccountStoreUnavailableError();
      try {
        const results = await sql.transaction(tx => [
          tx.query(ACCOUNT_DATABASE_GUARD, []),
          tx.query(`SELECT set_config('app.actor_user_id',$1,true),set_config('app.request_id',$2,true),
            set_config('statement_timeout','8000',true),set_config('lock_timeout','3000',true)`, [actor, requestId]),
          ...statements.map(query => tx.query(query.statement, [...query.parameters])),
        ], { isolationLevel: 'ReadCommitted', fetchOptions: { signal: AbortSignal.timeout(12_000) } });
        if (results.length !== statements.length + 2) throw new AccountStoreUnavailableError();
        return results.slice(2) as readonly (readonly DatabaseRow[])[];
      } catch (error) {
        if (error && typeof error === 'object' && 'code' in error && error.code === 'P4290') throw new AccountWriteRateLimitError();
        // Driver errors can contain SQL/connection metadata. They must never reach
        // response bodies or routine logs; durable database constraints still apply.
        throw new AccountStoreUnavailableError();
      }
    },
  };
}
