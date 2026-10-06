import { createHash, randomUUID } from 'node:crypto';
import { withAccountActor as withGuardedAccountActor, type AccountIntegrationContext,
  type AccountIntegrationQuery } from './neon-integration-harness';

const digest = (value: string) => createHash('sha256').update(value, 'utf8').digest('hex');

/** Owner-only synthetic fixture setup inside the already guarded isolated harness.
 * This is not authentication and never runs from application code. Fixtures install
 * real auth rows and exact receipt evidence instead of disabling SQL guards. */
export async function installSyntheticAccountSession(query: AccountIntegrationQuery, issuer: string, subject: string) {
  const configHash = digest(`isolated-admission:${issuer}`);
  await query(`INSERT INTO website_auth.admission_epoch(slot,revision,config_hash,issuer,clock_domain)
    VALUES(1,1,$1,$2,'isolated-postgresql') ON CONFLICT(slot) DO UPDATE
    SET revision=website_auth.admission_epoch.revision+1,config_hash=excluded.config_hash,
      issuer=excluded.issuer,activated_at=clock_timestamp()
    WHERE website_auth.admission_epoch.issuer<>excluded.issuer OR website_auth.admission_epoch.config_hash<>excluded.config_hash`,
  [configHash, issuer]);
  const email = `${digest(subject)}@example.test`;
  await query(`INSERT INTO website_auth."user"(id,name,email,"emailVerified") VALUES($1,'Synthetic account',$2,true)
    ON CONFLICT(id) DO NOTHING`, [subject, email]);
  await query(`INSERT INTO website_auth.session(id,"userId",token,"expiresAt","updatedAt")
    VALUES($1,$2,$3,date_trunc('milliseconds',clock_timestamp()+interval '1 hour'),clock_timestamp())`,
  [`isolated-${randomUUID()}`, subject, `synthetic-${randomUUID()}`]);
  return setSyntheticAccountReceipt(query, issuer, subject);
}

export async function setSyntheticAccountReceipt(query: AccountIntegrationQuery, issuer: string, subject: string) {
  const rows = await query<{ receipt: unknown }>(`SELECT jsonb_build_object(
    'sessionId',s.id,'subject',u.id,
    'expiresAt',to_char(s."expiresAt" AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'issuer',e.issuer,'admissionEpochRevision',e.revision::text,'configHash',e.config_hash,'clockDomain',e.clock_domain,
    'admittedEmailDigest',encode(public.digest(convert_to(u.email,'UTF8'),'sha256'),'hex'),
    'sessionTokenDigest',encode(public.digest(convert_to(s.token,'UTF8'),'sha256'),'hex')) AS receipt
    FROM website_auth."user" u JOIN website_auth.session s ON s."userId"=u.id
    JOIN website_auth.admission_epoch e ON e.slot=1 AND e.issuer=$1
    WHERE u.id=$2 ORDER BY s."createdAt" DESC,s.id LIMIT 1`, [issuer, subject]);
  if (rows.length !== 1) throw new Error('Synthetic account authority fixture is absent.');
  await query("SELECT set_config('app.session_receipt_v2',$1,true)", [JSON.stringify(rows[0].receipt)]);
  return rows[0].receipt;
}

export async function setSyntheticActorReceipt(query: AccountIntegrationQuery, actorUserId: string) {
  const rows = await query<{ issuer: string; subject: string }>(`SELECT issuer,subject FROM public.app_login_identities
    WHERE app_user_id=$1 ORDER BY id LIMIT 1`, [actorUserId]);
  if (rows.length !== 1) throw new Error('Synthetic actor identity fixture is absent.');
  return setSyntheticAccountReceipt(query, rows[0].issuer, rows[0].subject);
}

export function withSyntheticAccountActor<Result>(context: AccountIntegrationContext,
  run: (query: AccountIntegrationQuery) => Promise<Result>): Promise<Result> {
  return withGuardedAccountActor(context, async query => {
    if (context.actorUserId && /^[0-9a-f-]{36}$/iu.test(context.actorUserId)) {
      await query('RESET ROLE');
      await setSyntheticActorReceipt(query, context.actorUserId);
      await query('SET LOCAL ROLE league_one_account');
    }
    return run(query);
  });
}

export function syntheticAccountQuery<Row extends Readonly<Record<string, unknown>> = Readonly<Record<string, unknown>>>(
  statement: string, parameters: readonly unknown[] = [], context: AccountIntegrationContext = {},
): Promise<readonly Row[]> {
  return withSyntheticAccountActor(context, query => query<Row>(statement, parameters));
}
