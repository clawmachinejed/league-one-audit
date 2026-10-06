import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { Pool } from '@neondatabase/serverless';
import { assertSafeIntegrationDatabase, createPinnedIntegrationDatabase, integrationEnvironment, prepareIntegrationDatabase } from './neon-integration-harness';
import { readAccountInfrastructureIdentity } from '../lib/accounts/infrastructure-identity';
import { setSyntheticAccountReceipt } from './account-authority-fixture';
import { writeIntegrationArtifact } from './integration-artifacts';
import { createAccountAuthorityDatabase } from '../lib/accounts/neon/database';
import { createAccountStore, accountRevisionExpectation } from '../lib/accounts/neon/store';
import { readAuthReceiptV2 } from '../lib/accounts/session-authority';
// This is the actual installer, not a second SQL migration implementation.
// @ts-expect-error The operational ESM helper deliberately has no TypeScript declaration.
import { accountTransitionState, installAccountTransition } from '../scripts/account-transition-preflight.mjs';

const names = ['034_account_session_authority.sql', '035_account_follow_intent.sql', '036_account_infrastructure_transition.sql'];
type Query = (sql: string, parameters?: readonly unknown[]) => Promise<readonly Record<string, unknown>[]>;

/** Runs ONLY inside the existing guarded disposable global setup. Its output
 * is separate from Vitest case totals. This is not a release drain rehearsal:
 * no deployed service or external maintenance boundary is exercised. */
export async function rehearseAccountTransition(): Promise<void> {
  const completed: string[] = [];
  let account: Pool | undefined;
  let owner: Awaited<ReturnType<typeof createPinnedIntegrationDatabase>> | undefined;
  try {
    await assertSafeIntegrationDatabase();
    if (!process.env.ACCOUNT_AUTHORITY_INTEGRATION_DATABASE_URL) throw new Error('Restricted LOGIN required');
    await prepareIntegrationDatabase({ throughMigration: '033_transaction_capture_acceptance.sql' });
    owner = await createPinnedIntegrationDatabase('owner');
    const query: Query = owner.database.query;
    const migrations = await Promise.all(names.map(async name => {
      const statement = (await readFile(new URL(`../migrations/${name}`, import.meta.url), 'utf8')).replace(/\r\n?/gu, '\n');
      return { name, statement, checksum: createHash('sha256').update(statement).digest('hex') };
    }));
    // Built-in catalogs independently identify the guarded synthetic child;
    // this sampled identity is never represented as deployment approval.
    const rows = await query(`SELECT current_database() AS "databaseName",
      (SELECT oid::text FROM pg_database WHERE datname=current_database()) AS "databaseOid",
      current_setting('neon.project_id') AS "projectId",current_setting('neon.branch_id') AS "branchId",
      current_setting('neon.tenant_id') AS "tenantId",current_setting('neon.timeline_id') AS "timelineId"`);
    const identity = readAccountInfrastructureIdentity({ ...rows[0],
      clockDomain: `neon:${rows[0].tenantId}:${rows[0].timelineId}:${rows[0].databaseOid}` });
    const adapter = { query: async (sql: string, args?: readonly unknown[]) => ({ rows: await query(sql, args) }) };
    const ledger = async () => accountTransitionState(migrations, await query('SELECT name,checksum FROM public.app_schema_migrations'));
    const issuer = 'https://transition-rehearsal.example.test/api/auth';
    const subject = `transition-${randomUUID()}`;
    const resolveSql = 'SELECT public.resolve_app_login_identity($1,$2,$3,$4::uuid) AS id';
    const resolveArgs = [issuer, subject, 'Preserved legacy manager', randomUUID()];
    account = new Pool({ connectionString: process.env.ACCOUNT_AUTHORITY_INTEGRATION_DATABASE_URL,
      max: 1, connectionTimeoutMillis: 5000, query_timeout: 12000, statement_timeout: 8000 });
    account.on('error', () => {});
    assert.equal((await account.query('SELECT session_user AS role')).rows[0].role, 'league_one_account');
    const oldId = (await account.query(resolveSql, resolveArgs)).rows[0].id;
    completed.push('legacy-actual-login-resolver');
    await account.end(); account = undefined;

    // Real DDL followed by a deliberately interrupted second statement. The
    // normal installer's rollback must preserve the old resolver and ledger.
    await assert.rejects(installAccountTransition({ query: async (sql: string, args?: readonly unknown[]) => {
      if (sql === migrations[1].statement) throw new Error('Injected interruption');
      return adapter.query(sql, args);
    } }, migrations, identity), { outcome: 'rolled-back' });
    assert.equal(await ledger(), 'absent');
    assert.equal((await query("SELECT to_regclass('website_auth.admission_epoch') AS epoch"))[0].epoch, null);
    completed.push('ddl-interruption-atomic-rollback');

    const disconnected = new Pool({ connectionString: integrationEnvironment().ownerDatabaseUrl,
      max: 1, connectionTimeoutMillis: 5000, query_timeout: 12000, statement_timeout: 8000 });
    disconnected.on('error', () => {});
    const lostClient = await disconnected.connect();
    let released = false;
    try {
      await assert.rejects(installAccountTransition({ query: async (sql: string, args?: readonly unknown[]) => {
        if (sql === migrations[1].statement) {
          released = true; lostClient.release(true);
          throw new Error('Injected coordinator connection loss');
        }
        return lostClient.query(sql, args ? [...args] : undefined);
      } }, migrations, identity), { outcome: 'unknown' });
    } finally { if (!released) lostClient.release(true); await disconnected.end(); }
    await query("SET lock_timeout='5s'");
    await query('SELECT pg_advisory_xact_lock(19740517,1)');
    assert.equal(await ledger(), 'absent');
    assert.equal((await query("SELECT to_regclass('website_auth.admission_epoch') AS epoch"))[0].epoch, null);
    completed.push('coordinator-socket-loss-rollback-reconciled');

    // Simulate server rollback before the client loses acknowledgement. The
    // production installer must still classify the outcome as UNKNOWN.
    await assert.rejects(installAccountTransition({ query: async (sql: string, args?: readonly unknown[]) => {
      if (sql === 'COMMIT') { await query('ROLLBACK'); throw new Error('Injected lost acknowledgement'); }
      return adapter.query(sql, args);
    } }, migrations, identity), { outcome: 'unknown' });
    assert.equal(await ledger(), 'absent');
    completed.push('unknown-commit-reconciled-absent');

    let commits = 0;
    await assert.rejects(installAccountTransition({ query: async (sql: string, args?: readonly unknown[]) => {
      const result = await adapter.query(sql, args);
      if (sql === 'COMMIT') { commits++; throw new Error('Injected lost acknowledgement'); }
      return result;
    } }, migrations, identity), { outcome: 'unknown' });
    assert.equal(commits, 1);
    assert.equal(await ledger(), 'applied');
    assert.equal((await query('SELECT count(*)::int AS count FROM website_auth.admission_epoch'))[0].count, 0);
    completed.push('unknown-commit-reconciled-applied-unseeded');
    assert.equal(await installAccountTransition(adapter, migrations, identity), 'already-applied');
    completed.push('explicit-idempotent-reconciliation');

    // Grant only through the existing manifests, then test an actual LOGIN.
    await query(await readFile(new URL('../scripts/provision-account-role.sql', import.meta.url), 'utf8'));
    await query(await readFile(new URL('../scripts/provision-auth-role.sql', import.meta.url), 'utf8'));
    account = new Pool({ connectionString: process.env.ACCOUNT_AUTHORITY_INTEGRATION_DATABASE_URL,
      max: 1, connectionTimeoutMillis: 5000, query_timeout: 12000, statement_timeout: 8000 });
    account.on('error', () => {});
    await assert.rejects(account.query(resolveSql, resolveArgs), { code: 'P4101' });
    await query(`INSERT INTO website_auth."user"(id,name,email,"emailVerified") VALUES($1,'Preserved legacy manager',$2,true)`, [subject, `${subject}@example.test`]);
    await query(`INSERT INTO website_auth.session(id,"userId",token,"expiresAt","updatedAt")
      VALUES($1,$2,$3,date_trunc('milliseconds',clock_timestamp()+interval '1 hour'),clock_timestamp())`,
    [randomUUID(), subject, randomUUID()]);
    await query('SELECT website_auth.activate_admission_epoch_v1(0,1,$1,$2,$3::jsonb,$4::uuid,$5)',
      ['a'.repeat(64), issuer, JSON.stringify(identity), randomUUID(), 'b'.repeat(64)]);
    const receipt = await setSyntheticAccountReceipt(owner.database.query, issuer, subject);
    const client = await account.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT public.require_account_infrastructure_v1($1::jsonb)', [JSON.stringify(identity)]);
      await client.query("SELECT set_config('app.session_receipt_v2',$1,true)", [JSON.stringify(receipt)]);
      assert.equal((await client.query(resolveSql, resolveArgs)).rows[0].id, oldId);
      await client.query('COMMIT');
    } finally { await client.query('ROLLBACK'); client.release(); }
    await assert.rejects(account.query(resolveSql, resolveArgs), { code: 'P4101' });
    completed.push('owner-activation-new-login-preserves-actor-old-caller-denied');

    // Exercise the actual current Neon transport/store source after cutover,
    // including final authority timing and a CAS-protected profile mutation.
    const store = createAccountStore(createAccountAuthorityDatabase(readAuthReceiptV2(receipt), {
      ACCOUNTS_ENABLED: 'true', ACCOUNT_DATABASE_URL: process.env.ACCOUNT_AUTHORITY_INTEGRATION_DATABASE_URL,
      ACCOUNTS_DATABASE_IDENTITY: JSON.stringify(identity),
    }));
    assert.equal(await store.resolve({issuer,subject,displayName:'Preserved legacy manager'}),oldId);
    const view = await store.readFinal(oldId);
    assert.equal(view.value.profile.displayName,'Preserved legacy manager');
    assert.ok(view.decisionTiming);
    await store.mutate(oldId,{kind:'profile',body:{displayName:'Updated qualified caller',revision:view.value.profile.revision}},
      accountRevisionExpectation(view.value));
    assert.equal((await store.readFinal(oldId)).value.profile.displayName,'Updated qualified caller');
    await query('UPDATE website_auth.session SET "expiresAt"=clock_timestamp()-interval \'1 second\' WHERE "userId"=$1',[subject]);
    await assert.rejects(store.readFinal(oldId));
    completed.push('current-store-resolve-final-read-cas-write-and-revocation');
    await writeIntegrationArtifact('account-transition-rehearsal.json', { status: 'passed', completed,
      migrationChecksums: migrations.map(({name,checksum}) => ({name,checksum})),
      serviceDrainQualified: false, realNetworkInterruptionQualified: true, lostCommitAcknowledgementInjected: true });
  } catch {
    await writeIntegrationArtifact('account-transition-rehearsal-failure.json', { status: 'failed', completed,
      serviceDrainQualified: false, realNetworkInterruptionQualified: false }).catch(() => undefined);
    throw new Error('Guarded account transition rehearsal failed; inspect sanitized stage evidence.');
  } finally {
    await account?.end();
    await owner?.close();
  }
}
