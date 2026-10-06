import 'server-only';
import { neon } from '@neondatabase/serverless';
import type { DatabaseRow, DatabaseStatement } from '../../database';
import { accountUuid } from '../validation';
import { readAuthReceiptV2, type AuthReceiptV2 } from '../session-authority';

export class AccountStoreUnavailableError extends Error {
  constructor() { super('Account storage is unavailable.'); this.name = 'AccountStoreUnavailableError'; }
}
export class AccountWriteRateLimitError extends Error {
  constructor() { super('Too many account changes.'); this.name = 'AccountWriteRateLimitError'; }
}
type AccountContext = { actorUserId: string; requestId: string; access?: 'read' | 'write' };
type AccountResults = readonly (readonly DatabaseRow[])[];
export type AccountDatabase = {
  transaction: (statements: readonly DatabaseStatement[], context?: AccountContext) => Promise<AccountResults>;
};
export type AccountAuthorityDatabase = AccountDatabase & {
  /** Server-only envelope; caller must validate and enforce monotonic delivery
   * timing. This covers account/session authority, not league eligibility. */
  finalTransaction: (statements: readonly DatabaseStatement[], context: AccountContext) => Promise<{
    results: AccountResults; decisionTiming: unknown;
  }>;
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
  return buildAccountDatabase(environment);
}

/** Internal transport only: target helpers still must bind actor/login and own
 * domain locks. A receipt is never an actor authorization or a public payload. */
export function createAccountAuthorityDatabase(receipt: AuthReceiptV2,
  environment: Readonly<Record<string, string | undefined>> = process.env): AccountAuthorityDatabase {
  let validated: AuthReceiptV2;
  try { validated = readAuthReceiptV2(receipt); } catch { throw new AccountStoreUnavailableError(); }
  return buildAccountDatabase(environment, validated);
}

function buildAccountDatabase(environment: Readonly<Record<string, string | undefined>>, receipt?: AuthReceiptV2): AccountAuthorityDatabase {
  const url = accountDatabaseUrl(environment);
  if (!url) throw new AccountStoreUnavailableError();
  const sql = neon(url);
  async function execute(statements: readonly DatabaseStatement[], context: AccountContext | undefined, final: boolean) {
      const actor = context ? accountUuid(context.actorUserId) : '';
      const requestId = context ? accountUuid(context.requestId) : '';
      if (statements.length < 1 || statements.length > 8) throw new AccountStoreUnavailableError();
      if (final && (!receipt || !context)) throw new AccountStoreUnavailableError();
      try {
        const results = await sql.transaction(tx => [
          tx.query(ACCOUNT_DATABASE_GUARD, []),
          tx.query(`SELECT set_config('app.actor_user_id',$1,true),set_config('app.request_id',$2,true),
            set_config('statement_timeout','8000',true),set_config('lock_timeout','3000',true)`, [actor, requestId]),
          ...(receipt ? [
            tx.query(`SELECT set_config('app.session_receipt_v2',$1,true)`, [JSON.stringify(receipt)]),
            context ? tx.query('SELECT public.lock_account_actor_authority_v2($1::jsonb,$2::boolean)',
              [JSON.stringify(receipt), context.access === 'write'])
              : tx.query('SELECT * FROM public.lock_account_session_authority_v2($1::jsonb)', [JSON.stringify(receipt)]),
          ] : []),
          ...statements.map(query => tx.query(query.statement, [...query.parameters])),
          ...(final ? [tx.query('SELECT public.read_account_authority_timing_v2($1::jsonb) AS timing', [JSON.stringify(receipt)])] : []),
        ], { isolationLevel: 'ReadCommitted', fetchOptions: { signal: AbortSignal.timeout(12_000) } });
        const prefix = receipt ? 4 : 2;
        if (results.length !== statements.length + prefix + Number(final) || (receipt && results[3]?.length !== 1)) throw new AccountStoreUnavailableError();
        const finalRows = final ? results.at(-1) as readonly DatabaseRow[] : undefined;
        if (final && (finalRows?.length !== 1 || !finalRows[0].timing)) throw new AccountStoreUnavailableError();
        return { results: results.slice(prefix, prefix + statements.length) as AccountResults,
          decisionTiming: finalRows?.[0].timing ?? null };
      } catch (error) {
        if (error && typeof error === 'object' && 'code' in error && error.code === 'P4290') throw new AccountWriteRateLimitError();
        // Driver errors can contain SQL/connection metadata. They must never reach
        // response bodies or routine logs; durable database constraints still apply.
        throw new AccountStoreUnavailableError();
      }
  }
  return {
    async transaction(statements, context) { return (await execute(statements, context, false)).results; },
    async finalTransaction(statements, context) { return execute(statements, context, true); },
  };
}
