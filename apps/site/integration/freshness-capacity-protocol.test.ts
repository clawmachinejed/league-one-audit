import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { fleetSupervisedWorkDeadline, fleetEnvironment, fleetFetch, parseFleetCommand, parseFleetConfig, parseFleetMessage, FLEET_VERSION, type FleetConfig, type FleetMessage } from './freshness-capacity-protocol';
const config: FleetConfig={profile:'data-freshness-capacity-healthy-v1',nonce:'11111111-1111-4111-8111-111111111111',fixtureId:'22222222-2222-4222-8222-222222222222',contextNonce:'33333333-3333-4333-8333-333333333333',gitSha:'a'.repeat(40),profileDigest:'b'.repeat(64),fixtureDigest:'c'.repeat(64),manifestDigest:'d'.repeat(64),workDeadlineAt:Date.now()+60_000,plannedPostgresqlVersion:'18.6',evidenceDirectory:resolve('test-results/protocol-unit/fleet-raw-11111111-1111-4111-8111-111111111111'),expectedDatabase:'league_one_integration_test',expectedBranch:'br-test'};
const runtimeUrl='postgresql://league_one_runtime:fixture@ep-test.us-east-1.aws.neon.tech/league_one_integration_test?sslmode=require';
const span={startedAt:'2026-10-17T00:00:00.000Z',endedAt:'2026-10-17T00:00:00.001Z',monotonicStartMs:1,monotonicEndMs:2};
function ready():FleetMessage{return {...config,version:FLEET_VERSION,pid:10,backendPid:20,backendStart:span.startedAt,database:config.expectedDatabase,branch:config.expectedBranch,
  sessionUser:'league_one_runtime',currentUser:'league_one_runtime',httpSessionUser:'league_one_runtime',httpCurrentUser:'league_one_runtime',type:'ready',sequence:0,action:null,span,inventory:null,result:null,error:false} as FleetMessage;}
// fixtureId belongs only to config; it must not silently appear in the message contract.
function message(){const row=ready();Reflect.deleteProperty(row,'fixtureId');Reflect.deleteProperty(row,'evidenceDirectory');Reflect.deleteProperty(row,'expectedDatabase');Reflect.deleteProperty(row,'expectedBranch');return row;}
describe('closed healthy worker protocol',()=>{
  it('binds exact source fixture workload context and runtime LOGIN while scrubbing ambient credentials',()=>{
    expect(parseFleetConfig(config)).toEqual(config);
    expect(fleetSupervisedWorkDeadline({INTEGRATION_SUPERVISED_WORK_DEADLINE_AT:String(config.workDeadlineAt)})).toBe(config.workDeadlineAt);
    expect(()=>fleetSupervisedWorkDeadline({})).toThrow();
    expect(()=>parseFleetConfig({...config,workDeadlineAt:Date.now()+241*60_000})).toThrow();const env=fleetEnvironment({PATH:'fixture',EVIL:'secret',NEON_TEST_API_KEY:'secret',INTEGRATION_SUPERVISED_WORK_DEADLINE_AT:String(config.workDeadlineAt),PROJECTION_INTEGRATION_ARTIFACT_DIRECTORY:resolve('test-results/protocol-unit')},runtimeUrl,config);
    expect(env).not.toHaveProperty('EVIL');expect(env).not.toHaveProperty('NEON_TEST_API_KEY');expect(env.DATABASE_URL).toBe(runtimeUrl);
    expect(()=>fleetEnvironment({},runtimeUrl.replace('league_one_runtime','neondb_owner'),config)).toThrow();
    expect(()=>fleetEnvironment({},runtimeUrl.replace('sslmode=require','sslmode=disable'),config)).toThrow();
    expect(()=>parseFleetConfig({...config,deadlineMs:999})).toThrow();
    expect(()=>parseFleetConfig({...config,evidenceDirectory:'../outside'})).toThrow();
    expect(()=>fleetEnvironment({INTEGRATION_SUPERVISED_WORK_DEADLINE_AT:String(config.workDeadlineAt),PROJECTION_INTEGRATION_ARTIFACT_DIRECTORY:resolve('test-results/another-run')},runtimeUrl,config)).toThrow('escaped');expect(()=>parseFleetConfig({...config,manifestDigest:''})).toThrow();
  });
  it('rejects foreign commands replays arbitrary operations and source drift',()=>{
    const command={version:FLEET_VERSION,nonce:config.nonce,sequence:1,action:'prepare' as const};expect(parseFleetCommand(command,config,1)).toEqual(command);
    for(const changed of [{sequence:2},{nonce:config.fixtureId},{action:'eval'},{module:'unexpected'}])expect(()=>parseFleetCommand({...command,...changed},config,1)).toThrow();
    expect(parseFleetMessage(message(),config,10).type).toBe('ready');
    for(const changed of [{currentUser:'neondb_owner'},{manifestDigest:'e'.repeat(64)},{database:'production'},{pid:11},{span:{...span,monotonicEndMs:0}}])expect(()=>parseFleetMessage({...message(),...changed},config,10)).toThrow();
  });
  it('requires a complete chunk inventory for successful healthy result rather than accepting a summary alone',()=>{
    expect(()=>parseFleetMessage({...message(),type:'result',action:'run-healthy',sequence:4,result:{passed:true}},config,10)).toThrow('inventory');
  });
  it('never delegates foreign requests or connections to real fetch',async()=>{
    const original=vi.fn<typeof fetch>(async()=>new Response('{}')),provider=vi.fn<typeof fetch>(async()=>{throw new Error('nonfixture');});
    const transport=fleetFetch({runtimeUrl,originalFetch:original,providerFetch:provider,onSql:()=>{}});
    await expect(transport('https://unrelated.invalid/sql',{method:'POST'})).rejects.toThrow('nonfixture');
    await expect(transport('https://ep-test.us-east-1.aws.neon.tech/sql',{method:'POST',headers:{'Neon-Connection-String':runtimeUrl.replace('league_one_runtime','neondb_owner')},body:'{}'})).rejects.toThrow('nonfixture');
    expect(original).not.toHaveBeenCalled();expect(provider).toHaveBeenCalledTimes(2);
  });
});


describe('closed recovery protocol',()=>{
  it('binds the separate recovery profile and forbids cross-lane commands',()=>{
    const recovery={...config,profile:'data-freshness-capacity-recovery-v1' as const,workDeadlineAt:Date.now()+339*60_000};
    expect(parseFleetConfig(recovery)).toEqual(recovery);
    const deadlineEnvironment={INTEGRATION_SUPERVISED_WORK_DEADLINE_AT:String(recovery.workDeadlineAt)};
    expect(fleetSupervisedWorkDeadline(deadlineEnvironment,recovery.profile)).toBe(recovery.workDeadlineAt);
    expect(()=>fleetSupervisedWorkDeadline(deadlineEnvironment)).toThrow('invalid supervised deadline');
    expect(()=>parseFleetConfig({...recovery,profile:config.profile})).toThrow('deadline');
    expect(()=>parseFleetConfig({...recovery,workDeadlineAt:Date.now()+341*60_000})).toThrow('deadline');
    expect(()=>parseFleetConfig({...recovery,profile:'data-freshness-capacity-recovery-v2'})).toThrow('closed');
    const command={version:FLEET_VERSION,nonce:config.nonce,sequence:1,action:'run-recovery' as const};
    expect(parseFleetCommand(command,recovery,1)).toEqual(command);
    expect(()=>parseFleetCommand(command,config,1)).toThrow('mismatch');
    expect(()=>parseFleetCommand({...command,action:'run-healthy'},recovery,1)).toThrow('mismatch');
    expect(()=>parseFleetMessage({...message(),profile:recovery.profile},config,10)).toThrow();
  });
  it('requires the unchanged complete evidence inventory in recovery results',()=>{
    const recovery={...config,profile:'data-freshness-capacity-recovery-v1' as const};
    expect(()=>parseFleetMessage({...message(),profile:recovery.profile,type:'result',action:'run-recovery',sequence:4,result:{passed:true}},recovery,10)).toThrow('inventory');
  });
});
