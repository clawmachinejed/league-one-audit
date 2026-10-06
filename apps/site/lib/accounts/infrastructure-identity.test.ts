import { describe, expect, it, vi } from 'vitest';
vi.mock('server-only',()=>({}));
import { accountInfrastructureIdentity, readAccountInfrastructureIdentity } from './infrastructure-identity';
const valid = {projectId:'synthetic-project-123',branchId:'br-synthetic',tenantId:'a'.repeat(32),timelineId:'b'.repeat(32),
  databaseName:'test',databaseOid:'123',clockDomain:`neon:${'a'.repeat(32)}:${'b'.repeat(32)}:123`};
describe('approved infrastructure manifest',()=>{
  it('binds clock domain to tenant, timeline and exact database OID',()=>{
    expect(readAccountInfrastructureIdentity(valid)).toEqual(valid);
    expect(Object.isFrozen(readAccountInfrastructureIdentity(valid))).toBe(true);
  });
  it.each([undefined,{}, {...valid,extra:true}, {...valid,clockDomain:'echoed'}, {...valid,databaseOid:'4294967296'},
    {...valid,tenantId:'arbitrary'}, {...valid,timelineId:'c'.repeat(32)}, {...valid,databaseName:'\n'}])('denies absent or inconsistent identity %#',value=>{
    expect(()=>readAccountInfrastructureIdentity(value)).toThrow('unavailable');
  });
  it('does not derive approval from connection URLs',()=>{
    expect(()=>accountInfrastructureIdentity({ACCOUNT_DATABASE_URL:'postgresql://anything'})).toThrow('unavailable');
  });
});
