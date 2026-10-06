import { describe,it,expect,vi } from 'vitest';
import { migrationChecksum } from './migration-text.mjs';
import { accountTransitionApproval, accountTransitionState, installAccountTransition, migrationOwnerUrl,
  migrationDatabaseIdentity, verifyMigrationDatabaseIdentity } from './account-transition-preflight.mjs';
const checksums={'034_account.sql':'a'.repeat(64),'035_follow.sql':'b'.repeat(64),'036_identity.sql':'c'.repeat(64)};
const identity={projectId:'synthetic-project-123',branchId:'br-synthetic',tenantId:'a'.repeat(32),timelineId:'b'.repeat(32),
  databaseName:'integration_test',databaseOid:'123',clockDomain:`neon:${'a'.repeat(32)}:${'b'.repeat(32)}:123`};
const rawIdentity={databaseName:identity.databaseName,databaseOid:identity.databaseOid,
  settings:Object.fromEntries(Object.entries({projectId:'neon.project_id',branchId:'neon.branch_id',tenantId:'neon.tenant_id',timelineId:'neon.timeline_id'})
    .map(([key,name])=>[name,{setting:identity[key],context:'postmaster',pendingRestart:false}]))};
const approval={reviewedSha:'a'.repeat(40),compatibleRecoverySha:'b'.repeat(40),maintenanceEvidenceHash:'c'.repeat(64),drainEvidenceHash:'d'.repeat(64),migrationChecksums:checksums,databaseIdentity:identity};
describe('strict owner URL parsing before connection',()=>{
  const url='postgresql://owner:synthetic@ep-synthetic.us-east-1.aws.neon.tech/integration_test?sslmode=require';
  it('allows explicit TLS owner credentials without exposing them in errors',()=>expect(migrationOwnerUrl(url)).toBe(url));
  it.each([undefined,'not-a-url',url+'&sslmode=disable',url+'&sslmode=require',url+'&options=-crole=owner',
    url+'&sslcert=attacker',url+'&channel_binding=require&channel_binding=require',url+'&channel_binding=disable',
    url.replace('sslmode=require','sslmode=disable'),url.replace('neon.tech','neon.tech.evil.test'),
    url.replace('/integration_test','/%2Fintegration_test'),url.replace('.tech/', '.tech:6543/'),url+'#fragment'])('rejects ambiguous or overriding owner URL %#',value=>{
    expect(()=>migrationOwnerUrl(value)).toThrow('Explicit owner database credential is invalid or unavailable.');
  });
  it('permits local developer migration only with explicit local support; activation requires Neon',()=>{
    const local='postgresql://owner:synthetic@localhost/integration_test';
    expect(()=>migrationOwnerUrl(local)).toThrow();
    expect(migrationOwnerUrl(local,{allowLocal:true})).toBe(local);
  });
});

describe('migration command pinned-connection preflight',()=>{
  async function runCommand({wrongIdentity=false,reconcile=false,disconnect=false,heldAcquisition=false}={}) {
    const names=Array.from({length:heldAcquisition?37:36},(_,index)=>`${String(index+1).padStart(3,'0')}_synthetic.sql`);
    const rows=names.map(name=>({name,checksum:migrationChecksum(`-- ${name}`)}));
    const query=vi.fn(async(statement,parameters=[])=>{
      if (statement.includes('FROM pg_catalog.pg_settings')) return {rows:[wrongIdentity?{...rawIdentity,databaseOid:'999'}:rawIdentity]};
      if (disconnect) throw new Error('synthetic lost connection');
      if (statement.includes("to_regclass('public.app_schema_migrations')")) return {rows:[{present:true}]};
      if (statement==='SELECT name, checksum FROM public.app_schema_migrations') return {rows};
      if (statement==='SELECT checksum FROM app_schema_migrations WHERE name = $1') return {rows:[rows.find(row=>row.name===parameters[0])]};
      return {rows:[]};
    });
    const client={query,on:vi.fn(),release:vi.fn()};
    const connect=vi.fn(async()=>client), pooledQuery=vi.fn(()=>{throw new Error('Unpinned query forbidden');});
    vi.resetModules();
    const constructed=vi.fn();
    vi.doMock('@neondatabase/serverless',()=>({Pool:class { constructor(){constructed();} connect=connect; query=pooledQuery; on(){} async end(){} }}));
    vi.doMock('node:fs/promises',()=>({readdir:async()=>names,readFile:async path=>`-- ${String(path).split(/[\\/]/u).at(-1)}`}));
    const originalArgv=process.argv,originalExitCode=process.exitCode;
    vi.stubEnv('MIGRATION_DATABASE_URL','postgresql://owner:synthetic@ep-synthetic.example.neon.tech/integration_test?sslmode=require');
    vi.stubEnv('ACCOUNTS_MIGRATION_DATABASE_IDENTITY',JSON.stringify(identity));
    process.argv=['node','migrate.mjs',...(reconcile?['--reconcile-account-transition']:[])];
    const stdout=vi.spyOn(process.stdout,'write').mockReturnValue(true);
    const stderr=vi.spyOn(process.stderr,'write').mockReturnValue(true);
    try {
      process.exitCode=0;
      let importError;
      try { await import('./migrate.mjs'); } catch(error) { if(!heldAcquisition) throw error; importError=error; }
      return {client,connect,pooledQuery,constructed,importError,output:stdout.mock.calls.map(([value])=>value).join(''),exitCode:process.exitCode};
    } finally {
      process.argv=originalArgv;process.exitCode=originalExitCode;
      stdout.mockRestore();stderr.mockRestore();vi.unstubAllEnvs();
      vi.doUnmock('@neondatabase/serverless');vi.doUnmock('node:fs/promises');vi.resetModules();
    }
  }
  it('keeps one connection from raw destination proof through every migration without pooled query/reacquisition',async()=>{
    const result=await runCommand();
    expect(result.exitCode).toBe(0);
    expect(result.connect).toHaveBeenCalledOnce();expect(result.pooledQuery).not.toHaveBeenCalled();
    expect(result.client.query.mock.calls[0][0]).toContain('FROM pg_catalog.pg_settings');
    expect(result.client.release).toHaveBeenCalledExactlyOnceWith(true);
  });
  it('blocks automatically discovered037 before constructing a driver or connecting, even with valid034–036 identity configuration',async()=>{
    const result=await runCommand({heldAcquisition:true});
    expect(result.importError?.message).toContain('Migration 037 installation is held');
    expect(result.constructed).not.toHaveBeenCalled(); expect(result.connect).not.toHaveBeenCalled();
    expect(result.client.query).not.toHaveBeenCalled();
  });
  it('reports the037 hold during explicit read-only reconciliation without installing it',async()=>{
    const result=await runCommand({heldAcquisition:true,reconcile:true});
    expect(result.importError).toBeUndefined(); expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.output)).toMatchObject({heldMigrations:['037_synthetic.sql'],installationAuthorized:false});
    expect(result.client.query.mock.calls.some(([statement])=>/CREATE|INSERT|ALTER|DROP/u.test(statement))).toBe(false);
  });
  it.each([{wrongIdentity:true},{disconnect:true}])('fails without any DDL or reconnect on destination failure %#',async options=>{
    const result=await runCommand(options);
    expect(result.exitCode).toBe(1);expect(result.connect).toHaveBeenCalledOnce();
    expect(result.pooledQuery).not.toHaveBeenCalled();
    expect(result.client.query.mock.calls.some(([statement])=>/CREATE|INSERT|ALTER|DROP/u.test(statement))).toBe(false);
  });
  it('proves destination for read-only reconciliation without DDL',async()=>{
    const result=await runCommand({reconcile:true});
    expect(result.exitCode).toBe(0);expect(result.connect).toHaveBeenCalledOnce();
    expect(result.client.query.mock.calls[0][0]).toContain('FROM pg_catalog.pg_settings');
    expect(result.client.query.mock.calls.some(([statement])=>/CREATE|INSERT|ALTER|DROP/u.test(statement))).toBe(false);
  });
});
describe('coordinated install approval',()=>{
  it('accepts exact reviewed source/checksum and recovery evidence',()=>expect(accountTransitionApproval(JSON.stringify(approval),checksums)).toEqual(approval));
  it.each([undefined,'{}',JSON.stringify({...approval,extra:true}),JSON.stringify({...approval,reviewedSha:'main'}),
    JSON.stringify({...approval,databaseIdentity:undefined}),JSON.stringify({...approval,databaseIdentity:{databaseName:'same-name'}}),
    JSON.stringify({...approval,drainEvidenceHash:''}),JSON.stringify({...approval,migrationChecksums:{}}),
    JSON.stringify({...approval,migrationChecksums:{...checksums,'036_identity.sql':'d'.repeat(64)}})])('blocks missing or drifted prerequisites %#',value=>{
    expect(()=>accountTransitionApproval(value,checksums)).toThrow();
  });
});

const migrations=Object.entries(checksums).map(([name,checksum])=>({name,checksum,statement:`install ${name}`}));
// Stateful fake transaction checks acknowledgement semantics and statement
// ordering only; PostgreSQL atomicity and catalogs remain SQL qualification.
function fixture(fault, initial=[], actualIdentity=rawIdentity) {
  let committed=[...initial]; let pending=[]; const calls=[];
  return { calls, rows:()=>committed, async query(statement,parameters=[]) {
    calls.push(statement);
    if (statement.includes('FROM pg_catalog.pg_settings')) return {rows:[actualIdentity]};
    if (statement==='BEGIN') pending=[...committed];
    if (statement==='ROLLBACK') pending=[];
    if (statement==='SELECT name, checksum FROM public.app_schema_migrations') return {rows:pending};
    if (statement.startsWith('INSERT INTO')) pending.push({name:parameters[0],checksum:parameters[1]});
    if (statement==='COMMIT') committed=[...pending];
    if (fault===statement) throw new Error('synthetic credential-bearing driver failure');
    return {rows:[]};
  }};
}
describe('atomic transition interruption and reconciliation',()=>{
  it.each([
    {...rawIdentity,databaseName:'another_database'},
    {...rawIdentity,databaseOid:'124'},
    {...rawIdentity,settings:{...rawIdentity.settings,'neon.project_id':{setting:'another-project-123',context:'postmaster',pendingRestart:false}}},
    {...rawIdentity,settings:{...rawIdentity.settings,'neon.branch_id':{setting:'br-other',context:'postmaster',pendingRestart:false}}},
    {...rawIdentity,settings:{...rawIdentity.settings,'neon.tenant_id':{setting:'c'.repeat(32),context:'postmaster',pendingRestart:false}}},
    {...rawIdentity,settings:{...rawIdentity.settings,'neon.timeline_id':{setting:'c'.repeat(32),context:'postmaster',pendingRestart:false}}},
    {...rawIdentity,settings:{}},
    {...rawIdentity,settings:{...rawIdentity.settings,'neon.project_id':{setting:identity.projectId,context:'user',pendingRestart:false}}},
    {...rawIdentity,settings:{...rawIdentity.settings,'neon.timeline_id':{setting:identity.timelineId,context:'postmaster',pendingRestart:true}}},
  ])('rejects wrong or mutable destination before any DDL or ledger write %#',async actual=>{
    const client=fixture(undefined,[],actual);
    await expect(installAccountTransition(client,migrations,identity)).rejects.toMatchObject({outcome:'rolled-back'});
    expect(client.calls.some(value=>value.startsWith('install ') || value.startsWith('INSERT INTO'))).toBe(false);
    expect(client.calls).not.toContain('COMMIT');
  });
  it('requires a complete independently supplied identity instead of deriving approval from the destination',async()=>{
    expect(()=>migrationDatabaseIdentity({databaseName:'integration_test'})).toThrow();
    const client=fixture();
    await expect(installAccountTransition(client,migrations)).rejects.toThrow();
    expect(client.calls.some(value=>value.startsWith('install '))).toBe(false);
  });
  it('verifies the raw pre-036 catalog before allowing the outer installer to do any work',async()=>{
    const client=fixture();
    await expect(verifyMigrationDatabaseIdentity(client,identity)).resolves.toEqual(identity);
    expect(client.calls).toHaveLength(1);
    expect(client.calls[0]).not.toContain('website_auth');
    expect(client.calls[0]).toContain('pg_catalog.pg_settings');
  });
  it('still verifies destination when the transition ledger already contains every exact checksum',async()=>{
    const client=fixture(undefined,migrations,{...rawIdentity,databaseOid:'124'});
    await expect(installAccountTransition(client,migrations,identity)).rejects.toThrow();
    expect(client.calls).not.toContain('SELECT name, checksum FROM public.app_schema_migrations');
    expect(client.calls).not.toContain('COMMIT');
  });
  it('commits every migration and checksum together without epoch activation',async()=>{
    const client=fixture();
    await expect(installAccountTransition(client,migrations,identity)).resolves.toBe('committed');
    expect(accountTransitionState(migrations,client.rows())).toBe('applied');
    expect(client.calls.filter(value=>value==='COMMIT')).toHaveLength(1);
    expect(client.calls.some(value=>value.includes('activate_admission'))).toBe(false);
  });
  it('rolls back all prior statements when a later migration fails, with no retry',async()=>{
    const client=fixture(migrations[1].statement);
    await expect(installAccountTransition(client,migrations,identity)).rejects.toMatchObject({outcome:'rolled-back'});
    expect(client.rows()).toEqual([]);
    expect(client.calls.filter(value=>value===migrations[0].statement)).toHaveLength(1);
    expect(client.calls).not.toContain('COMMIT');
  });
  it('treats lost COMMIT acknowledgement as unknown even after successful ROLLBACK acknowledgement',async()=>{
    const client=fixture('COMMIT');
    await expect(installAccountTransition(client,migrations,identity)).rejects.toMatchObject({outcome:'unknown'});
    expect(accountTransitionState(migrations,client.rows())).toBe('applied');
    expect(client.calls.filter(value=>value==='COMMIT')).toHaveLength(1);
  });
  it('reconciles absent, exact, partial and checksum drift without promoting catalog qualification',()=>{
    expect(accountTransitionState(migrations,[])).toBe('absent');
    expect(accountTransitionState(migrations,migrations)).toBe('applied');
    expect(accountTransitionState(migrations,[migrations[0]])).toBe('partial');
    expect(accountTransitionState(migrations,[{...migrations[0],checksum:'wrong'}])).toBe('drift');
  });
  it.each([[migrations[0]],[{...migrations[0],checksum:'wrong'}]])('blocks partial or drifted installs without filling gaps %#',async row=>{
    const client=fixture(undefined,[row]);
    await expect(installAccountTransition(client,migrations,identity)).rejects.toMatchObject({outcome:'rolled-back'});
    expect(client.calls.some(value=>value.startsWith('install '))).toBe(false);
    expect(client.calls).not.toContain('COMMIT');
  });
  it('does not rerun the SQL when exact reviewed ledger is already installed',async()=>{
    const client=fixture(undefined,migrations);
    await expect(installAccountTransition(client,migrations,identity)).resolves.toBe('already-applied');
    expect(client.calls.some(value=>value.startsWith('install '))).toBe(false);
  });
});
