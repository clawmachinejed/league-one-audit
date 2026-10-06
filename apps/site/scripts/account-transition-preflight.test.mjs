import { describe,it,expect } from 'vitest';
import { accountTransitionApproval, accountTransitionState, installAccountTransition, migrationOwnerUrl } from './account-transition-preflight.mjs';
const checksums={'034_account.sql':'a'.repeat(64),'035_follow.sql':'b'.repeat(64),'036_identity.sql':'c'.repeat(64)};
const approval={reviewedSha:'a'.repeat(40),compatibleRecoverySha:'b'.repeat(40),maintenanceEvidenceHash:'c'.repeat(64),drainEvidenceHash:'d'.repeat(64),migrationChecksums:checksums};
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
describe('coordinated install approval',()=>{
  it('accepts exact reviewed source/checksum and recovery evidence',()=>expect(accountTransitionApproval(JSON.stringify(approval),checksums)).toEqual(approval));
  it.each([undefined,'{}',JSON.stringify({...approval,extra:true}),JSON.stringify({...approval,reviewedSha:'main'}),
    JSON.stringify({...approval,drainEvidenceHash:''}),JSON.stringify({...approval,migrationChecksums:{}}),
    JSON.stringify({...approval,migrationChecksums:{...checksums,'036_identity.sql':'d'.repeat(64)}})])('blocks missing or drifted prerequisites %#',value=>{
    expect(()=>accountTransitionApproval(value,checksums)).toThrow();
  });
});

const migrations=Object.entries(checksums).map(([name,checksum])=>({name,checksum,statement:`install ${name}`}));
// Stateful fake transaction checks acknowledgement semantics and statement
// ordering only; PostgreSQL atomicity and catalogs remain SQL qualification.
function fixture(fault, initial=[]) {
  let committed=[...initial]; let pending=[]; const calls=[];
  return { calls, rows:()=>committed, async query(statement,parameters=[]) {
    calls.push(statement);
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
  it('commits every migration and checksum together without epoch activation',async()=>{
    const client=fixture();
    await expect(installAccountTransition(client,migrations)).resolves.toBe('committed');
    expect(accountTransitionState(migrations,client.rows())).toBe('applied');
    expect(client.calls.filter(value=>value==='COMMIT')).toHaveLength(1);
    expect(client.calls.some(value=>value.includes('activate_admission'))).toBe(false);
  });
  it('rolls back all prior statements when a later migration fails, with no retry',async()=>{
    const client=fixture(migrations[1].statement);
    await expect(installAccountTransition(client,migrations)).rejects.toMatchObject({outcome:'rolled-back'});
    expect(client.rows()).toEqual([]);
    expect(client.calls.filter(value=>value===migrations[0].statement)).toHaveLength(1);
    expect(client.calls).not.toContain('COMMIT');
  });
  it('treats lost COMMIT acknowledgement as unknown even after successful ROLLBACK acknowledgement',async()=>{
    const client=fixture('COMMIT');
    await expect(installAccountTransition(client,migrations)).rejects.toMatchObject({outcome:'unknown'});
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
    await expect(installAccountTransition(client,migrations)).rejects.toMatchObject({outcome:'rolled-back'});
    expect(client.calls.some(value=>value.startsWith('install '))).toBe(false);
    expect(client.calls).not.toContain('COMMIT');
  });
  it('does not rerun the SQL when exact reviewed ledger is already installed',async()=>{
    const client=fixture(undefined,migrations);
    await expect(installAccountTransition(client,migrations)).resolves.toBe('already-applied');
    expect(client.calls.some(value=>value.startsWith('install '))).toBe(false);
  });
});
