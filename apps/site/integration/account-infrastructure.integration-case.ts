import { randomUUID } from 'node:crypto';
import { Pool } from '@neondatabase/serverless';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { assertSafeIntegrationDatabase, createPinnedIntegrationDatabase, ownerQuery } from './neon-integration-harness';
import { readAccountInfrastructureIdentity, type AccountInfrastructureIdentity } from '../lib/accounts/infrastructure-identity';

// AUTHORED ONLY until a separately authorized disposable run. Actual LOGINs,
// never SET ROLE, prove session_user. Each activation schedule rolls back.
let auth: Pool; let account: Pool; let identity: AccountInfrastructureIdentity;
const activate = 'SELECT website_auth.activate_admission_epoch_v1($1::bigint,$2::bigint,$3,$4,$5::jsonb,$6::uuid,$7) AS revision';
const safe = (error: unknown) => Object.assign(new Error('Isolated infrastructure qualification failed.'),
  error && typeof error==='object' && 'code' in error && typeof error.code==='string' ? {code:error.code} : {});
const query = async (pool: Pool, statement: string, parameters: unknown[]=[]) => {
  try { return (await pool.query(statement,parameters)).rows; } catch(error) { throw safe(error); }
};

describe.sequential('migration 036 infrastructure and checked owner activation',()=>{
  beforeAll(async()=>{
    await assertSafeIntegrationDatabase();
    const authUrl=process.env.AUTH_RESET_INTEGRATION_DATABASE_URL;
    const accountUrl=process.env.ACCOUNT_AUTHORITY_INTEGRATION_DATABASE_URL;
    if (!authUrl || !accountUrl) throw new Error('Genuine restricted LOGIN credentials are required.');
    auth=new Pool({connectionString:authUrl,max:1,connectionTimeoutMillis:5000,query_timeout:12000,statement_timeout:8000});
    account=new Pool({connectionString:accountUrl,max:1,connectionTimeoutMillis:5000,query_timeout:12000,statement_timeout:8000});
    auth.on('error',()=>{}); account.on('error',()=>{});
    const rows=await ownerQuery<{identity:unknown}>('SELECT website_auth.account_server_identity_v1() AS identity');
    identity=readAccountInfrastructureIdentity(rows[0].identity);
    // Sampled identity is a synthetic fixture, not deployment approval evidence.
    expect(identity.projectId).toBe(process.env.NEON_TEST_PROJECT_ID);
  });
  afterAll(async()=>{await Promise.all([auth?.end(),account?.end()]);});

  it('checks both actual restricted LOGINS against the same server and clock domain',async()=>{
    expect((await query(auth,'SELECT session_user AS role'))[0].role).toBe('league_one_auth');
    expect((await query(account,'SELECT session_user AS role'))[0].role).toBe('league_one_account');
    await query(auth,'SELECT website_auth.require_auth_infrastructure_v1($1::jsonb)',[JSON.stringify(identity)]);
    await query(account,'SELECT public.require_account_infrastructure_v1($1::jsonb)',[JSON.stringify(identity)]);
  });
  it.each(['projectId','branchId','tenantId','timelineId','databaseName','databaseOid','clockDomain'])('denies a wrong %s before private work',async field=>{
    await expect(query(account,'SELECT public.require_account_infrastructure_v1($1::jsonb)',
      [JSON.stringify({...identity,[field]:'wrong'})])).rejects.toMatchObject({code:'P4101'});
  });
  it('denies owner SET ROLE as a substitute for the genuine account LOGIN',async()=>{
    const owner=await createPinnedIntegrationDatabase('owner');
    try {
      await owner.database.query('BEGIN');
      await owner.database.query('SET LOCAL ROLE league_one_account');
      await expect(owner.database.query('SELECT public.require_account_infrastructure_v1($1::jsonb)',[JSON.stringify(identity)])).rejects.toThrow();
    } finally {await owner.database.query('ROLLBACK');await owner.close();}
  });
  it('rejects legacy receiptless resolver calls even with a disabled target',async()=>{
    await expect(query(account,'SELECT public.resolve_app_login_identity($1,$2,$3,$4::uuid)',
      ['https://legacy.example.test/api/auth','legacy','Legacy',randomUUID()])).rejects.toMatchObject({code:'P4101'});
  });
  it.each(['auth','account'])('denies %s LOGIN raw epoch access and owner activation',async role=>{
    const pool=role==='auth'?auth:account;
    await expect(query(pool,'SELECT * FROM website_auth.admission_epoch')).rejects.toMatchObject({code:'42501'});
    await expect(query(pool,activate,['0','1','a'.repeat(64),'https://test.example.test/api/auth',JSON.stringify(identity),randomUUID(),'b'.repeat(64)])).rejects.toMatchObject({code:'42501'});
  });
  it('atomically records exact revision/config/identity and rolls epoch and receipt back together',async()=>{
    const owner=await createPinnedIntegrationDatabase('owner');
    const requestId=randomUUID();
    try {
      await owner.database.query('BEGIN');
      const previous=(await owner.database.query<{revision:string}>('SELECT coalesce((SELECT revision FROM website_auth.admission_epoch WHERE slot=1),0)::text AS revision'))[0].revision;
      const max=(await owner.database.query<{revision:string}>('SELECT coalesce(max(revision),0)::text AS revision FROM website_auth.admission_epoch_activations'))[0].revision;
      const next=(BigInt(previous)>BigInt(max)?BigInt(previous)+1n:BigInt(max)+1n).toString();
      await owner.database.query(activate,[previous,next,'a'.repeat(64),'https://epoch.example.test/api/auth',JSON.stringify(identity),requestId,'b'.repeat(64)]);
      const evidence=await owner.database.query<{revision:string;infrastructure:unknown}>('SELECT revision::text,infrastructure FROM website_auth.admission_epoch_activations WHERE request_id=$1::uuid',[requestId]);
      expect(evidence).toEqual([{revision:next,infrastructure:identity}]);
      for (const statement of [
        'UPDATE website_auth.admission_epoch_activations SET issuer=issuer',
        'DELETE FROM website_auth.admission_epoch_activations',
        'TRUNCATE website_auth.admission_epoch_activations',
      ]) {
        await owner.database.query('SAVEPOINT immutable_history');
        await expect(owner.database.query(statement)).rejects.toThrow();
        await owner.database.query('ROLLBACK TO SAVEPOINT immutable_history');
      }
      await owner.database.query('SAVEPOINT stale');
      await expect(owner.database.query(activate,[previous,next,'a'.repeat(64),'https://epoch.example.test/api/auth',JSON.stringify(identity),randomUUID(),'b'.repeat(64)])).rejects.toThrow();
      await owner.database.query('ROLLBACK TO SAVEPOINT stale');
      // An owner mistake must not resurrect an earlier epoch: retained history
      // fences even a reset epoch row. This deliberately invalid fixture rolls back.
      await owner.database.query('SAVEPOINT reset_epoch');
      await owner.database.query('DELETE FROM website_auth.admission_epoch');
      await expect(owner.database.query(activate,['0',(BigInt(next)+1n).toString(),'a'.repeat(64),
        'https://epoch.example.test/api/auth',JSON.stringify(identity),randomUUID(),'b'.repeat(64)])).rejects.toThrow();
      await owner.database.query('ROLLBACK TO SAVEPOINT reset_epoch');
    } finally {await owner.database.query('ROLLBACK');await owner.close();}
    expect(await ownerQuery('SELECT revision FROM website_auth.admission_epoch_activations WHERE request_id=$1::uuid',[requestId])).toEqual([]);
  });
});
