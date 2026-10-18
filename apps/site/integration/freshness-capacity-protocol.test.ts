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

describe('closed local daily protocol',()=>{
  it('binds the daily action to its original supervisor deadline without extending another lane',()=>{
    const daily={...config,profile:'data-freshness-capacity-daily-v1' as const,workDeadlineAt:Date.now()+25*60*60_000};
    expect(parseFleetConfig(daily)).toEqual(daily);
    expect(fleetSupervisedWorkDeadline({INTEGRATION_SUPERVISED_WORK_DEADLINE_AT:String(daily.workDeadlineAt)},daily.profile)).toBe(daily.workDeadlineAt);
    expect(()=>parseFleetConfig({...daily,workDeadlineAt:Date.now()+26*60*60_000+1000})).toThrow('deadline');
    expect(()=>parseFleetConfig({...daily,profile:config.profile})).toThrow('deadline');
    const command={version:FLEET_VERSION,nonce:daily.nonce,sequence:1,action:'run-daily' as const};
    expect(parseFleetCommand(command,daily,1)).toEqual(command);expect(()=>parseFleetCommand(command,config,1)).toThrow('mismatch');
    for(const action of ['run-healthy','run-recovery'] as const)expect(()=>parseFleetCommand({...command,action},daily,1)).toThrow('mismatch');
    expect(()=>parseFleetMessage({...message(),profile:daily.profile,workDeadlineAt:daily.workDeadlineAt,type:'result',action:'run-daily',sequence:4,result:{passed:true}},daily,10)).toThrow('inventory');
  });
  it('rejects a daily CI child before secrets or provider credentials are forwarded',()=>{
    const daily={...config,profile:'data-freshness-capacity-daily-v1' as const};
    const env={CI:'1',INTEGRATION_SUPERVISED_WORK_DEADLINE_AT:String(daily.workDeadlineAt),PROJECTION_INTEGRATION_ARTIFACT_DIRECTORY:resolve('test-results/protocol-unit')};
    expect(()=>fleetEnvironment(env,runtimeUrl,daily)).toThrow('local-only');
  });
});

describe('closed current batch ownership and live protocols',()=>{
  const ownership={...config,profile:'data-freshness-capacity-ownership-v1' as const};
  const live={...config,profile:'data-live-public-batch-v1' as const};
  it('keeps the existing default work envelope and rejects a long-lane deadline',()=>{
    expect(parseFleetConfig({...ownership,workDeadlineAt:Date.now()+29*60_000}).profile).toBe(ownership.profile);
    expect(parseFleetConfig({...live,workDeadlineAt:Date.now()+29*60_000}).profile).toBe(live.profile);
    for(const profile of [ownership.profile,live.profile])expect(()=>parseFleetConfig({...config,profile,workDeadlineAt:Date.now()+31*60_000})).toThrow('deadline');
  });
  it('binds original ownership slots and closed role/scenario commands without supplied work',()=>{
    const command={version:FLEET_VERSION,nonce:config.nonce,sequence:1,action:'ownership-turn' as const,scenario:'selection-competition-death' as const,role:'owner' as const,slot:2,invocationStartedAt:config.workDeadlineAt-25_000};
    expect(parseFleetCommand(command,ownership,1)).toEqual(command);
    for(const change of [{slot:15},{slot:-1},{role:'fixture'},{scenario:'unknown'},{work:{}},{invocationStartedAt:config.workDeadlineAt-19_999},{sequence:2}])expect(()=>parseFleetCommand({...command,...change},ownership,1)).toThrow();
    expect(()=>parseFleetCommand({...command,scenario:'accepted-before-checkpoint-death',role:'competitor'},ownership,1)).toThrow();
    expect(()=>parseFleetCommand(command,live,1)).toThrow('mismatch');
    expect(()=>parseFleetCommand({version:FLEET_VERSION,nonce:config.nonce,sequence:1,action:'run-live'},ownership,1)).toThrow();
    expect(()=>parseFleetCommand({version:FLEET_VERSION,nonce:config.nonce,sequence:1,action:'prepare'},live,1)).toThrow('closed');
  });
  it('preserves the exact SQL result and lock assertion while rejecting foreign identities or altered bytes',async()=>{
    const {createHash}=await import('node:crypto');const {parseFleetShortEvent}=await import('./freshness-capacity-protocol');
    const {type: _type,sequence: _sequence,action: _action,inventory: _inventory,result: _result,error: _error,...identity}=message();
    void _type;void _sequence;void _action;void _inventory;void _result;void _error;
    const query='SELECT 1 AS n';const event={...identity,profile:ownership.profile,type:'short-event',eventSequence:1,commandSequence:1,event:{kind:'sql',transport:'pinned',query,querySha256:createHash('sha256').update(query).digest('hex'),params:[],lock:{sql:'SELECT 1',params:[],verifyAfter:{sql:'SELECT true',params:[]}},rows:[{n:1}],outcome:'success',errorCode:null}};
    expect(parseFleetShortEvent(event,ownership,10,1)).toEqual(event);
    for(const change of [{eventSequence:2},{pid:11},{backendPid:0},{currentUser:'neondb_owner'},{manifestDigest:'0'.repeat(64)}])expect(()=>parseFleetShortEvent({...event,...change},ownership,10,1)).toThrow();
    for(const change of [{query:'SELECT 2'},{rows:null},{lock:{sql:'SELECT 1',params:[]}},{errorCode:'secret error'}])expect(()=>parseFleetShortEvent({...event,event:{...event.event,...change}},ownership,10,1)).toThrow();
  });
  it('keeps original HTTP bytes and failed attempts distinct from a synthetic successful response',async()=>{
    const {createHash}=await import('node:crypto');const {parseFleetShortEvent}=await import('./freshness-capacity-protocol');
    const {type: _type,sequence: _sequence,action: _action,inventory: _inventory,result: _result,error: _error,...identity}=message();
    void _type;void _sequence;void _action;void _inventory;void _result;void _error;
    const rawUtf8='{"user_id":"862823517857697792"}';const event={...identity,profile:live.profile,type:'short-event',eventSequence:1,commandSequence:2,event:{kind:'http',ordinal:1,method:'GET',url:'https://api.sleeper.app/v1/user/ClawMachineJedi',status:200,rawUtf8,rawSha256:createHash('sha256').update(rawUtf8).digest('hex'),errorCode:null}};
    expect(parseFleetShortEvent(event,live,10,1)).toEqual(event);
    expect(()=>parseFleetShortEvent({...event,event:{...event.event,rawUtf8:rawUtf8+' '}},live,10,1)).toThrow();
    expect(()=>parseFleetShortEvent({...event,event:{...event.event,url:'https://example.com/v1/user/ClawMachineJedi'}},live,10,1)).toThrow();
    const failed={...event,event:{...event.event,status:null,rawUtf8:null,rawSha256:null,errorCode:'request'}};expect(parseFleetShortEvent(failed,live,10,1).event).toEqual(failed.event);
    expect(()=>parseFleetShortEvent({...event,event:{...event.event,headers:{authorization:'forbidden'}}},live,10,1)).toThrow();
  });
});
