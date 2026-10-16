import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { DatabaseClient, DatabaseRow } from '../lib/database';
const routing=vi.hoisted(()=>({database:undefined as unknown}));
// Only dependency selection is replaced. The selected client is the real Neon
// HTTP client, including its original AbortSignal handling and every store SQL.
vi.mock('../lib/database',async importOriginal=>({...await importOriginal<typeof import('../lib/database')>(),getDatabase:()=>routing.database}));
import { createDatabase } from '../lib/database';
import { submitPublicSleeperIntake, configurePublicSleeperRefresh } from '../lib/league-administration/public-intake-runtime';
import { createLeagueAdministrationStore, createPublicDataRefreshStore, createPublicIntakeStore } from '../lib/league-administration/store';
import { runPublicIntakeStep, runPublicDataRefreshStep } from '../lib/league-administration/public-intake';
import { readPublicSleeperIntake } from '../lib/league-administration/public-intake-reader';
import { readPublicDataRefresh } from '../lib/league-administration/public-refresh-reader';
import { PUBLIC_INTAKE_JOB, type PublicIntakeInput } from '../lib/league-administration/public-intake-contracts';
import type { PublicDataRefreshConfiguration } from '../lib/league-administration/public-refresh-contracts';
import { createProjectionStore } from '../lib/projection-store';
import { capturePublicSleeperIdentity } from '../lib/sleeper';
import { assertOriginalPublicCapture, validateRequestedPublicCaptureWitness } from '../lib/league-administration/public-capture-witness';
import { createIndependentDatabase, createPinnedIntegrationDatabase, integrationEnvironment, ownerQuery, type IndependentDatabase } from './neon-integration-harness';
import { assertBackendControlsSupportSources, BACKEND_CONTROLS_PROFILE, BACKEND_CONTROLS_TESTS, qualificationBinding, qualificationDigest, type QualificationBinding } from './qualification-profile';
import { BACKEND_CONTROLS_LIMITS, BACKEND_CONTROLS_ORACLES, writeBackendControlsEvidence, type ControlCase, type ControlEvent } from './backend-controls-evidence';
import { createBackendControlsDatabaseFetchGuard } from './backend-controls-fetch';

const enabled={enabled:true} as const;
const siteRoot=fileURLToPath(new URL('..',import.meta.url));
const native=`8${BigInt('0x'+randomUUID().replaceAll('-','').slice(0,15))}`;
const username='cp24_'+randomUUID().replaceAll('-','');
const identityId=randomUUID(),targetId=randomUUID(),pendingId=randomUUID();
const now=()=>new Date().toISOString();
const selectors={exactPeriods:[{season:2026,nativeWeek:1}],playoffBrackets:'sleeper-2026-playoff-brackets-v1',
  weeklyReports:[{season:2026,nativeWeek:2},{season:2026,nativeWeek:1}],transactionHistory:'sleeper-2026-transaction-history-v1',draftPicks:'sleeper-2026-draft-picks-v1'} as const;
const canonicalSelectors={...selectors,weeklyReports:[{season:2026,nativeWeek:1},{season:2026,nativeWeek:2}]} as const;

/** DATA-CP24-2026-10-15-QUALIFICATION-SCOPE. Source candidate, not SQL proof.
 * Nine closed cases. No provider, scheduler, role, clock or cleanup substitution.
 * Account permission proof is catalog/effective-role evidence, not account LOGIN.
 */
describe.sequential('controlled DATA submission configuration pause and stored status',()=>{
  let binding:QualificationBinding,connection:IndependentDatabase,http:DatabaseClient;
  let serverVersion='',serverVersionNum='',index=-1,revision=0,cycleRequest='',capacityId='',headroomId='',recordedRetryAt='';
  let configuration:PublicDataRefreshConfiguration;
  let prerequisiteGets=0,measuredGets=0,providerMode:'none'|'prerequisite'|'identity'|'failure'='none';
  let fetchSpy:ReturnType<typeof vi.spyOn>,signalQueries=0,forbiddenGets=0;
  const actualLogins=new Set<string>(),sessions=new Set<IndependentDatabase>();
  const cases:ControlCase[]=BACKEND_CONTROLS_TESTS.map((name,n)=>({name,limitMs:BACKEND_CONTROLS_LIMITS[n],state:'unserved',startedAt:null,endedAt:null,events:[]}));
  const query=<R extends DatabaseRow=DatabaseRow>(sql:string,args:readonly unknown[]=[])=>connection.database.query<R>(sql,args);
  const event=(type:ControlEvent['type'],data:ControlEvent['data'])=>cases[index].events.push({type,at:now(),data});
  const complete=()=>{const {type,...data}=BACKEND_CONTROLS_ORACLES[index];event(type,data);};
  const submit=(input:PublicIntakeInput)=>submitPublicSleeperIntake(input,{enabled:true,requestId:input.id});
  const status=(id:string)=>readPublicSleeperIntake(connection.database,createLeagueAdministrationStore(connection.database),id);
  async function request(id:string){const read=await status(id);if(read.status==='missing')throw new Error('Expected stored control request absent.');return read.request;}
  const refreshStatus=()=>readPublicDataRefresh(connection.database,createLeagueAdministrationStore(connection.database),targetId);
  async function pin(role:'owner'|'runtime'|'auth'='runtime'){const value=await createPinnedIntegrationDatabase(role);sessions.add(value);return value;}
  async function close(value:IndependentDatabase){await value.close();sessions.delete(value);}
  async function rejectSql(promise:Promise<unknown>,message:RegExp,code='P0001'){try{await promise;throw new Error('Expected SQL rejection absent.');}catch(error){expect(error).toMatchObject({code});expect((error as Error).message).toMatch(message);}}
  async function configure(changes:Partial<PublicDataRefreshConfiguration>={}){
    const input={...configuration,expectedRevision:revision,...changes};const result=await configurePublicSleeperRefresh(input,enabled);
    expect(result.status).toBe('configured');if(result.status==='disabled')throw new Error('Controls database disabled.');
    configuration=input;revision=result.configurationRevision;return result;
  }
  async function claim(database:DatabaseClient=connection.database){
    const jobs=createProjectionStore(database),workerId=randomUUID(),until=Date.now()+75_000;
    while(Date.now()<until){const result=await jobs.acquireJob({jobKey:PUBLIC_INTAKE_JOB,jobType:PUBLIC_INTAKE_JOB,workerId,
      scheduledFor:new Date(Math.floor(Date.now()/60_000)*60_000).toISOString(),leaseSeconds:25,minimumIntervalSeconds:60,payload:{policy:'public-data-refresh-v1',mode:'recurring'}});
      if(result.kind==='acquired')return{jobs,fence:{jobKey:PUBLIC_INTAKE_JOB,workerId,generation:result.attempt,deadlineAt:new Date(Date.now()+20_000).toISOString()}};
      await delay(250);
    }throw new Error('Control claim exceeded its fixed allowance.');
  }
  async function release(owner:Awaited<ReturnType<typeof claim>>){expect(await owner.jobs.failJob(PUBLIC_INTAKE_JOB,owner.fence.workerId,'cp24 bounded fixture owner finished')).toBe(true);}
  async function admissionWindow(){const [row]=await query("SELECT greatest(0,extract(epoch FROM max(admitted_at)+interval '60 seconds'-clock_timestamp())) AS seconds FROM public_data_dispatches");
    const wait=Number(row.seconds);expect(wait).toBeLessThanOrEqual(60);if(wait>0)await delay(wait*1000+50);}
  async function progress(id:string,expected:'identity'|'leagues',limit=150_000,recurring=false){
    const until=Date.now()+limit;
    while(Date.now()<until){const dependencies={intake:createPublicIntakeStore(connection.database),administration:createLeagueAdministrationStore(connection.database),jobs:createProjectionStore(connection.database)};
      const result=recurring?await runPublicDataRefreshStep({...dependencies,refresh:createPublicDataRefreshStore(connection.database)},AbortSignal.timeout(20_000))
        :await runPublicIntakeStep(id,dependencies,AbortSignal.timeout(20_000));
      if(['busy','backoff'].includes(result.status)){await delay(500);continue;}expect(result).toMatchObject({status:providerMode==='failure'?'unavailable':'progress',resource:expected,providerRequests:1});return result;}
    throw new Error('Control acquisition exceeded its fixed allowance.');
  }
  async function blocked(waiter:number,blocker:number){const until=Date.now()+2000;
    while(Date.now()<until){const [row]=await ownerQuery('SELECT $1::int=ANY(pg_blocking_pids($2::int)) AS blocked',[blocker,waiter]);if(row.blocked)return;await delay(20);}throw new Error('Required control lock not observed.');}
  async function httpWaiters(blocker:number,count:number){const until=Date.now()+1800;
    while(Date.now()<until){const rows=await ownerQuery("SELECT pid,usename FROM pg_stat_activity WHERE $1::int=ANY(pg_blocking_pids(pid)) AND usename='league_one_runtime'",[blocker]);
      if(rows.length===count)return rows.map(row=>Number(row.pid));await delay(20);}throw new Error('Required HTTP lock waiters not observed.');}
  async function guarded(n:number,body:()=>Promise<void>){index=n;cases[n].state='running';cases[n].startedAt=now();
    try{await body();complete();cases[n].state='passed';}catch(error){cases[n].state='failed';throw error;}finally{providerMode='none';cases[n].endedAt=now();}}
  async function invariant(){return query(`SELECT
    (SELECT jsonb_agg(to_jsonb(r) ORDER BY id) FROM public_data_intakes r) AS requests,
    (SELECT jsonb_agg(to_jsonb(r) ORDER BY id) FROM public_data_refresh_targets r) AS targets,
    (SELECT jsonb_agg(to_jsonb(r) ORDER BY target_id,revision) FROM public_data_refresh_configurations r) AS configurations,
    (SELECT jsonb_agg(to_jsonb(r) ORDER BY target_id,cycle) FROM public_data_refresh_cycles r) AS cycles,
    (SELECT jsonb_agg(to_jsonb(r) ORDER BY target_id,cycle) FROM public_data_refresh_cycle_outcomes r) AS cycle_outcomes,
    (SELECT jsonb_agg(to_jsonb(r) ORDER BY worker_id,generation) FROM public_data_refresh_selection_failures r) AS selection_failures,
    (SELECT jsonb_agg(to_jsonb(r) ORDER BY job_key) FROM projection_jobs r) AS jobs,
    (SELECT jsonb_agg(to_jsonb(r) ORDER BY intake_id) FROM public_data_identity_observations r) AS identities,
    (SELECT jsonb_agg(to_jsonb(r) ORDER BY intake_id,season) FROM public_data_league_lists r) AS lists,
    (SELECT jsonb_agg(to_jsonb(r) ORDER BY admitted_at,worker_id) FROM public_data_dispatches r) AS dispatches,
    (SELECT jsonb_agg(to_jsonb(r) ORDER BY worker_id,generation) FROM public_data_dispatch_outcomes r) AS outcomes`);}

  beforeAll(async()=>{
    const selected=qualificationBinding();if(selected?.context.profile!==BACKEND_CONTROLS_PROFILE)throw new Error('CP24 requires its closed guarded profile.');binding=selected;
    await assertBackendControlsSupportSources(siteRoot);connection=createIndependentDatabase();
    const real=createDatabase(integrationEnvironment().runtimeDatabaseUrl);if(!real.enabled)throw new Error('Control HTTP database unavailable.');
    http={...real,async query(statement,parameters=[],options={}){if(options.signal){expect(options.signal.aborted).toBe(false);signalQueries++;}return real.query(statement,parameters,options);}};routing.database=http;
    for(const database of [connection.database,http])expect((await database.query('SELECT session_user,current_user'))[0]).toEqual({session_user:'league_one_runtime',current_user:'league_one_runtime'});
    actualLogins.add('league_one_runtime');const [version]=await query("SELECT current_setting('server_version') AS version,current_setting('server_version_num') AS version_num");serverVersion=String(version.version);serverVersionNum=String(version.version_num);
    const originalFetch=globalThis.fetch;const isDatabaseFetch=createBackendControlsDatabaseFetchGuard(integrationEnvironment().runtimeDatabaseUrl);
    fetchSpy=vi.spyOn(globalThis,'fetch').mockImplementation(async(input,init)=>{
      const url=new URL(input instanceof Request?input.url:String(input));
      if(isDatabaseFetch(input,init))return originalFetch(input,init);
      if(url.hostname!=='api.sleeper.app'||providerMode==='none'){forbiddenGets++;throw new Error('Unapproved control fixture acquisition.');}
      if(providerMode==='prerequisite')prerequisiteGets++;else measuredGets++;
      if(url.pathname===`/v1/user/${username}`||url.pathname===`/v1/user/${native}`)return new Response(JSON.stringify({user_id:native,username,display_name:'CP24 synthetic manager'}));
      if(url.pathname===`/v1/user/${native}/leagues/nfl/2026`)return providerMode==='failure'?new Response('{}',{status:503}):new Response('[]');
      throw new Error('Unapproved control fixture source scope.');
    });
    expect(await submit({id:identityId,username,seasons:[2026]})).toEqual({status:'retained',requestId:identityId});
    providerMode='prerequisite';await progress(identityId,'identity');await progress(identityId,'leagues');providerMode='none';
    expect(prerequisiteGets).toBe(2);expect((await status(identityId)).status).toBe('available');
    configuration={id:targetId,expectedRevision:0,identityRequestId:identityId,seasons:[2026],...selectors,cadenceSeconds:3600,expiresAt:new Date(Date.now()+3_600_000).toISOString(),paused:true};
  },240_000);
  afterAll(async()=>{let cleanupComplete=true;try{for(const session of sessions){try{await session.close();}catch{cleanupComplete=false;}}sessions.clear();
    if(connection)try{await connection.close();}catch{cleanupComplete=false;}fetchSpy?.mockRestore();routing.database=undefined;
    if(binding)await writeBackendControlsEvidence(binding,{kind:'data-backend-controls-evidence-v1',contextDigest:qualificationDigest(binding.context),gitSha:binding.context.gitSha,
      serverVersion,serverVersionNum,actualLogins:[...actualLogins],accountLoginExecuted:false,prerequisiteGets,measuredGets,cleanupComplete,cases});
    expect(cleanupComplete).toBe(true);expect(forbiddenGets).toBe(0);
  }finally{vi.restoreAllMocks();}},90_000);

  it('validates controlled submissions and retains canonical replay and conflict outcomes',()=>guarded(0,async()=>{
    const before=await invariant();
    for(const value of [123,true,false,null,undefined,['name'],{},'', 'not valid'])await expect(submit({id:randomUUID(),username:value as never,seasons:[2026]})).rejects.toThrow();
    for(const seasons of [[2026,2026],['2026'],[],[1919]])await expect(submit({id:randomUUID(),username,seasons:seasons as number[]})).rejects.toThrow();
    const base={id:randomUUID(),username,seasons:[2026]};
    for(const input of [null,true,[],{...base,username:123},{...base,username:true},{...base,username:null},{...base,seasons:['2026']},{...base,seasons:[2026,2026]},{...base,id:123}])
      await rejectSql(query('SELECT public.submit_public_data_intake($1::jsonb,true)',[JSON.stringify(input)]),/invalid public/u);
    await rejectSql(query('SELECT public.submit_public_data_intake($1::jsonb,NULL::boolean)',[JSON.stringify(base)]),/invalid public/u);
    await expect(submitPublicSleeperIntake(base,{enabled:false} as never)).rejects.toThrow();
    await expect(submitPublicSleeperIntake(base,{enabled:true,requestId:randomUUID()})).rejects.toThrow();
    expect(await invariant()).toEqual(before);
    const input={id:pendingId.toUpperCase(),username:'cp24_pending',seasons:[2026]};const started=performance.now();
    expect(await submitPublicSleeperIntake(input,{enabled:true,requestId:pendingId})).toEqual({status:'retained',requestId:pendingId});
    const durationMs=performance.now()-started;const retained=await status(pendingId);
    expect(retained).toMatchObject({status:'pending',request:{id:pendingId,requested_username:'cp24_pending',seasons:[2026],revision:0,terminal:false}});
    expect(await submit({...input,id:pendingId})).toEqual({status:'retained',requestId:pendingId});
    await rejectSql(submit({...input,id:pendingId,username:'cp24_conflict'}),/replay mismatch/u);
    if(retained.status==='missing')throw new Error('Missing retained submission.');expect(await request(pendingId)).toEqual(retained.request);expect(signalQueries).toBeGreaterThan(0);
    event('latency',{operation:'submit',durationMs,benchmarkQualified:false});event('submission',{requestId:pendingId,readerDigest:qualificationDigest(retained),prerequisiteRequestId:identityId});
  }),90_000);

  it('validates refresh identity and scope while preserving exact configuration replay',()=>guarded(1,async()=>{
    const beforeInvalid=await invariant();
    for(const change of [{transactionPeriod:{season:2026,nativeWeek:1}},{cadenceSeconds:59},{expectedRevision:-1},{paused:'true'},{seasons:['2026']}])await expect(configurePublicSleeperRefresh({...configuration,...change} as never,enabled)).rejects.toThrow();
    for(const value of [null,true,[],123])await rejectSql(query('SELECT public.configure_public_data_refresh($1::jsonb)',[JSON.stringify(value)]),/invalid public refresh configuration/u);
    for(const key of ['id','identityRequestId','expiresAt'])for(const value of [null,true,[],123])await rejectSql(query('SELECT public.configure_public_data_refresh($1::jsonb)',[JSON.stringify({...configuration,[key]:value})]),/invalid public refresh configuration/u);
    // Raw text preserves the exact 32-digit JSON number; JavaScript must not round it first.
    for(const key of ['id','identityRequestId'])await rejectSql(query('SELECT public.configure_public_data_refresh($1::jsonb)',[JSON.stringify({...configuration,[key]:'numeric-uuid-probe'}).replace('"numeric-uuid-probe"','12345678123412341234123456789012')]),/invalid public refresh configuration/u);
    await rejectSql(configurePublicSleeperRefresh({...configuration,identityRequestId:randomUUID()},enabled),/query returned no rows/u,'P0002');
    await rejectSql(query('SELECT public.configure_public_data_refresh($1::jsonb)',[JSON.stringify({...configuration,transactionPeriod:{season:2026,nativeWeek:1}})]),/transactionPeriod|transaction|selector/u);
    expect(await invariant()).toEqual(beforeInvalid);
    const original={...configuration};await configure();expect(await configurePublicSleeperRefresh(original,enabled)).toEqual({status:'replayed',targetId,configurationRevision:1});
    expect(await refreshStatus()).toMatchObject({status:'available',target:{...canonicalSelectors,configurationRevision:1}});
    await rejectSql(configurePublicSleeperRefresh({...configuration,expectedRevision:0,cadenceSeconds:61},enabled),/revision changed/u);
    await rejectSql(configurePublicSleeperRefresh({...configuration,id:randomUUID(),expectedRevision:0},enabled),/identity|target|manager/u);
    const owner=await claim();try{expect(await createPublicDataRefreshStore(connection.database).select(owner.fence)).toMatchObject({status:'idle'});await configure({paused:false});
      const selection=await createPublicDataRefreshStore(connection.database).select(owner.fence);expect(selection.status).toBe('selected');if(selection.status!=='selected')throw new Error('Missing control cycle.');cycleRequest=selection.requestId;
      const beforeScope=await invariant();await rejectSql(configurePublicSleeperRefresh({...configuration,expectedRevision:revision,exactPeriods:[{season:2026,nativeWeek:2}]},enabled),/unfinished refresh cycle/u);expect(await invariant()).toEqual(beforeScope);
      const read=await refreshStatus();expect(read).toMatchObject({status:'available',target:canonicalSelectors,cycle:{...canonicalSelectors,requestId:cycleRequest,configurationRevision:revision},intake:{request:{...canonicalSelectors,id:cycleRequest}}});
      event('configuration',{targetId,requestId:cycleRequest,revision,readerDigest:qualificationDigest(read)});
    }finally{await release(owner);await configure({paused:true});}
  }),90_000);

  it('serializes competing configuration CAS calls and retains only one immutable revision',()=>guarded(2,async()=>{
    const blocker=await pin('owner');let open=false;const outcomes:PromiseSettledResult<Awaited<ReturnType<typeof configurePublicSleeperRefresh>>>[]=[];
    const before=await query('SELECT * FROM public_data_refresh_configurations WHERE target_id=$1 ORDER BY revision',[targetId]);
    const inputs=[3601,3602].map(cadenceSeconds=>({...configuration,expectedRevision:revision,cadenceSeconds}));
    let pending:Promise<PromiseSettledResult<Awaited<ReturnType<typeof configurePublicSleeperRefresh>>>[]>|undefined;
    try{const [session]=await blocker.database.query('SELECT pg_backend_pid() AS pid');await blocker.database.query('BEGIN');open=true;
      await blocker.database.query("SELECT pg_advisory_xact_lock(hashtextextended('public-data-refresh-configuration',0))");
      pending=Promise.allSettled(inputs.map(input=>configurePublicSleeperRefresh(input,enabled)));const waiters=await httpWaiters(Number(session.pid),2);expect(new Set(waiters).size).toBe(2);
      await blocker.database.query('COMMIT');open=false;outcomes.push(...await pending);
      expect(outcomes.filter(outcome=>outcome.status==='fulfilled')).toHaveLength(1);const winner=outcomes.findIndex(outcome=>outcome.status==='fulfilled');const result=outcomes[winner];
      if(result.status!=='fulfilled'||result.value.status==='disabled')throw new Error('Missing configuration winner.');
      const loser=outcomes[1-winner];expect(loser).toMatchObject({status:'rejected',reason:{code:'P0001'}});if(loser.status==='rejected')expect(String(loser.reason.message)).toContain('revision changed');
      configuration=inputs[winner];revision=result.value.configurationRevision;
      const after=await query('SELECT * FROM public_data_refresh_configurations WHERE target_id=$1 ORDER BY revision',[targetId]);expect(after).toHaveLength(before.length+1);expect(after.slice(0,-1)).toEqual(before);
      event('lock',{waiterPids:waiters,blockerPid:Number(session.pid),revision,beforeDigest:qualificationDigest(before),afterDigest:qualificationDigest(after)});
    }finally{if(open)await blocker.database.query('ROLLBACK');await pending;await close(blocker);}
  }),120_000);

  it('honors pause and expiry before admission and resumes the same immutable cycle after unpause',()=>guarded(3,async()=>{
    await admissionWindow();const runtime=await pin(),pauser=await pin(),blocker=await pin('owner');let owner=await claim();let open=false;const pendingQueries:Promise<boolean>[]=[];
    try{const refresh=createPublicDataRefreshStore(connection.database);expect(await refresh.select(owner.fence)).toMatchObject({status:'idle'});await configure({paused:false});
      const selected=await refresh.select(owner.fence);expect(selected).toMatchObject({status:'selected',requestId:cycleRequest});if(selected.status!=='selected')throw new Error('Missing selected cycle.');
      const intake=createPublicIntakeStore(runtime.database),work=await intake.next(cycleRequest);if(typeof work==='string')throw new Error('Missing control work.');
      const [admitting]=await runtime.database.query('SELECT pg_backend_pid() AS pid,session_user,current_user');expect(admitting.session_user).toBe('league_one_runtime');expect(admitting.current_user).toBe('league_one_runtime');
      const [pauseSession]=await pauser.database.query('SELECT pg_backend_pid() AS pid');await pauser.database.query('BEGIN');open=true;
      const changed=await createPublicDataRefreshStore(pauser.database).configure({...configuration,expectedRevision:revision,paused:true});
      const pending=intake.admit(work,owner.fence);pendingQueries.push(pending);void pending.catch(()=>undefined);await blocked(Number(admitting.pid),Number(pauseSession.pid));await pauser.database.query('COMMIT');open=false;
      revision=changed.configurationRevision;configuration={...configuration,paused:true};expect(await pending).toBe(false);
      await configure({paused:false});expect(await intake.admit(work,owner.fence)).toBe(false); // Stale revision token cannot survive unpause.
      await release(owner);owner=await claim();
      await configure({expiresAt:new Date(Date.now()+4_000).toISOString()});const fresh=await refresh.select(owner.fence);expect(fresh).toMatchObject({status:'selected',requestId:cycleRequest,configurationRevision:revision});
      const expiryDeadline=owner.fence.deadlineAt;
      const current=await intake.next(cycleRequest);if(typeof current==='string')throw new Error('Missing current work.');
      const [blockerSession]=await blocker.database.query('SELECT pg_backend_pid() AS pid');await blocker.database.query('BEGIN');open=true;
      await blocker.database.query('SELECT id FROM public_data_refresh_targets WHERE id=$1 FOR UPDATE',[targetId]);
      const expires=intake.admit(current,owner.fence);pendingQueries.push(expires);void expires.catch(()=>undefined);await blocked(Number(admitting.pid),Number(blockerSession.pid));await delay(Math.max(0,Date.parse(configuration.expiresAt)-Date.now())+50);
      expect((await query('SELECT clock_timestamp()<$1::timestamptz AS live',[owner.fence.deadlineAt]))[0].live).toBe(true);
      await blocker.database.query('ROLLBACK');open=false;expect(await expires).toBe(false);
      expect(await query('SELECT * FROM public_data_dispatches WHERE worker_id=$1 AND generation=$2',[owner.fence.workerId,owner.fence.generation])).toEqual([]);
      await release(owner);await configure({expiresAt:new Date(Date.now()+3_600_000).toISOString(),paused:false});owner=await claim();
      expect(await refresh.select(owner.fence)).toMatchObject({status:'selected',requestId:cycleRequest,cycle:1,configurationRevision:revision,cycleConfigurationRevision:2});
      event('lock',{requestId:cycleRequest,originalDeadline:expiryDeadline,revision,dispatches:0});
    }finally{if(open){await pauser.database.query('ROLLBACK');await blocker.database.query('ROLLBACK');}await Promise.allSettled(pendingQueries);await release(owner);await close(runtime);await close(pauser);await close(blocker);}
  }),180_000);

  it('preserves an admitted real capture and checkpoint when pause commits afterward',()=>guarded(4,async()=>{
    await admissionWindow();const admitting=await pin(),owner=await claim();let open=false;let pending:ReturnType<typeof configurePublicSleeperRefresh>|undefined;
    try{const selection=await createPublicDataRefreshStore(connection.database).select(owner.fence);expect(selection).toMatchObject({status:'selected',requestId:cycleRequest});
      const intake=createPublicIntakeStore(admitting.database),work=await intake.next(cycleRequest);if(typeof work==='string'||work.kind!=='identity')throw new Error('Identity work required.');
      const [session]=await admitting.database.query('SELECT pg_backend_pid() AS pid,session_user,current_user');expect(session.session_user).toBe('league_one_runtime');expect(session.current_user).toBe('league_one_runtime');
      await admitting.database.query('BEGIN');open=true;expect(await intake.admit(work,owner.fence)).toBe(true);
      const input={...configuration,expectedRevision:revision,paused:true};pending=configurePublicSleeperRefresh(input,enabled);void pending.catch(()=>undefined);await httpWaiters(Number(session.pid),1);
      await admitting.database.query('COMMIT');open=false;const configured=await pending;if(configured.status==='disabled')throw new Error('Paused configuration unavailable.');revision=configured.configurationRevision;configuration=input;
      const witness=validateRequestedPublicCaptureWitness(await intake.captureWitness!(work,null,owner.fence),work,null,owner.fence);providerMode='identity';
      const capture=await capturePublicSleeperIdentity(work.username,AbortSignal.timeout(Math.max(1,Date.parse(owner.fence.deadlineAt)-Date.now())),witness);assertOriginalPublicCapture(capture,witness);
      await intake.recordIdentity(work,capture,owner.fence);providerMode='none';
      const [checkpoint]=await query(`SELECT outcome, capture_acquisition=$3::jsonb AS exact FROM public_data_dispatch_outcomes WHERE worker_id=$1 AND generation=$2`,[owner.fence.workerId,owner.fence.generation,JSON.stringify(witness)]);
      expect(checkpoint).toEqual({outcome:'checkpoint-committed',exact:true});const next=await intake.next(cycleRequest);if(typeof next==='string')throw new Error('Missing next work.');expect(await intake.admit(next,owner.fence)).toBe(false);
      event('capture',{requestId:cycleRequest,workerId:owner.fence.workerId,generation:owner.fence.generation,checkpointDigest:qualificationDigest(checkpoint)});
    }finally{if(open)await admitting.database.query('ROLLBACK');await pending;await release(owner);await close(admitting);}
    const identityBefore=await query('SELECT * FROM public_data_identity_observations WHERE intake_id=$1',[cycleRequest]);await configure({paused:false});
    providerMode='failure';await progress(cycleRequest,'leagues',110_000,true);providerMode='none';
    const [failed]=await query('SELECT failure_count,revision,terminal,next_attempt_at::text AS retry_at,next_attempt_at>clock_timestamp() AS retry_future FROM public_data_intakes WHERE id=$1',[cycleRequest]);
    expect(failed).toMatchObject({failure_count:1,revision:2,terminal:false,retry_future:true});expect(await query('SELECT * FROM public_data_identity_observations WHERE intake_id=$1',[cycleRequest])).toEqual(identityBefore);
    recordedRetryAt=new Date(String(failed.retry_at)).toISOString();
    expect(measuredGets).toBe(2);await configure({paused:true});event('capture',{requestId:cycleRequest,failureCount:1,nextWork:'leagues',identityDigest:qualificationDigest(identityBefore)});
  }),240_000);

  it('counts paused configurations toward the sixteen target limit without mutating a rejected seventeenth',()=>guarded(5,async()=>{
    const identities:string[]=[];
    for(let n=0;n<16;n++){const id=randomUUID(),manager=`9${BigInt('0x'+randomUUID().replaceAll('-','').slice(0,15))}`;identities.push(id);
      // Disclosed prerequisite ONLY. No target/configuration/dispatch/accepted resource is seeded.
      await ownerQuery("INSERT INTO public_data_intakes(id,username,seasons,terminal) VALUES($1,$2,ARRAY[2026],true)",[id,'cp24_identity_'+n]);
      await ownerQuery("INSERT INTO league_source_manager_accounts(provider,external_manager_id) VALUES('sleeper',$1)",[manager]);
      await ownerQuery(`INSERT INTO public_data_identity_observations(intake_id,source_manager_account_id,username,display_name,payload,request_started_at,request_completed_at)
        SELECT $1,id,$2,$2,jsonb_build_object('user_id',$3::text,'fixture','CP24 control capacity prerequisite'),clock_timestamp(),clock_timestamp()
        FROM league_source_manager_accounts WHERE provider='sleeper' AND external_manager_id=$3`,[id,'cp24_identity_'+n,manager]);
      if(n<15)expect(await configurePublicSleeperRefresh({...configuration,id:randomUUID(),expectedRevision:0,identityRequestId:id,paused:true},enabled)).toMatchObject({status:'configured',configurationRevision:1});
    }
    const before=await invariant();await rejectSql(configurePublicSleeperRefresh({...configuration,id:randomUUID(),expectedRevision:0,identityRequestId:identities[15],paused:true},enabled),/target capacity reached/u);expect(await invariant()).toEqual(before);
    expect((await query(`SELECT count(*)::int AS count,count(*) FILTER(WHERE config.paused)::int AS paused FROM public_data_refresh_targets target JOIN public_data_refresh_configurations config ON config.target_id=target.id AND config.revision=target.configuration_revision`))[0]).toEqual({count:16,paused:16});
    event('prerequisite',{identityIds:identities,identitySeedCount:16,sourceCredit:0,configurationCalls:16});
  }),90_000);

  it('retains one winner and one immutable capacity receipt under concurrent sixteen request admission',()=>guarded(6,async()=>{
    const existing=await query('SELECT id FROM public_data_intakes WHERE NOT terminal ORDER BY id');expect(existing.length).toBeLessThan(15);
    const fillers:string[]=[];for(let n=existing.length;n<15;n++){const id=randomUUID();fillers.push(id);expect(await submit({id,username:'cp24_filler_'+n,seasons:[2026]})).toEqual({status:'retained',requestId:id});}
    expect((await query('SELECT count(*)::int AS count FROM public_data_intakes WHERE NOT terminal'))[0].count).toBe(15);
    const blocker=await pin('owner'),inputs=[0,1].map(n=>({id:randomUUID(),username:'cp24_race_'+n,seasons:[2026],...selectors}));let open=false;let pending:Promise<Awaited<ReturnType<typeof submit>>[]>|undefined;
    try{const [session]=await blocker.database.query('SELECT pg_backend_pid() AS pid');await blocker.database.query('BEGIN');open=true;await blocker.database.query("SELECT pg_advisory_xact_lock(hashtextextended('public-data-intake-admission',0))");
      pending=Promise.all(inputs.map(submit));void pending.catch(()=>undefined);const waiters=await httpWaiters(Number(session.pid),2);await blocker.database.query('COMMIT');open=false;
      const outcomes=await pending;expect(outcomes.map(row=>row.status).sort()).toEqual(['capacity','retained']);const rejected=outcomes.find(row=>row.status==='capacity');if(!rejected||rejected.status==='disabled')throw new Error('Missing capacity receipt.');capacityId=rejected.requestId;
      event('lock',{waiterPids:waiters,blockerPid:Number(session.pid),requestIds:inputs.map(input=>input.id)});
    }finally{if(open)await blocker.database.query('ROLLBACK');await pending;await close(blocker);}
    expect((await query('SELECT count(*)::int AS count FROM public_data_intakes WHERE NOT terminal'))[0].count).toBe(16);
    const capacityInput=inputs.find(input=>input.id===capacityId)!;const before=await status(capacityId);
    if(before.status==='missing')throw new Error('Missing durable capacity request.');
    expect(before).toMatchObject({status:'unavailable',reason:'submission-capacity',request:{...canonicalSelectors,id:capacityId,submissionCapacity:'pending-request-limit',terminal:true,revision:0,failure_count:0}});
    expect((await query('SELECT exact_periods,playoff_brackets,weekly_reports,transaction_history,draft_picks FROM public_data_intakes WHERE id=$1',[capacityId]))[0]).toEqual({exact_periods:canonicalSelectors.exactPeriods,playoff_brackets:canonicalSelectors.playoffBrackets,weekly_reports:canonicalSelectors.weeklyReports,transaction_history:canonicalSelectors.transactionHistory,draft_picks:canonicalSelectors.draftPicks});
    const retainedInput=inputs.find(input=>input.id!==capacityId)!;expect(await request(retainedInput.id)).toMatchObject(canonicalSelectors);
    await rejectSql(createPublicIntakeStore(connection.database).submit({id:randomUUID(),username:'cp24_legacy_limit',seasons:[2026]}),/capacity reached/u);
    expect(await createPublicIntakeStore(connection.database).next(capacityId)).toBe('unavailable');
    expect(await query('SELECT * FROM public_data_dispatches WHERE intake_id=$1',[capacityId])).toEqual([]);expect(await query('SELECT * FROM public_data_identity_observations WHERE intake_id=$1',[capacityId])).toEqual([]);
    // Headroom prerequisite only: never count this unused synthetic request as acquired/completed.
    expect(fillers.length).toBeGreaterThan(0);headroomId=fillers[0];await ownerQuery('UPDATE public_data_intakes SET terminal=true WHERE id=$1',[headroomId]);
    expect(await submit(capacityInput)).toEqual({status:'capacity',requestId:capacityId});expect(await request(capacityId)).toEqual(before.request);
    await rejectSql(createPublicIntakeStore(connection.database).submit(capacityInput),/capacity reached/u);expect(await request(capacityId)).toEqual(before.request);
    expect(await submit({...capacityInput,id:randomUUID()})).toMatchObject({status:'retained'});
    await rejectSql(submit({...capacityInput,username:'cp24_capacity_conflict'}),/replay mismatch/u);expect(await request(capacityId)).toEqual(before.request);
    await rejectSql(submit({...capacityInput,exactPeriods:[{season:2026,nativeWeek:2}]}),/replay mismatch/u);expect(await request(capacityId)).toEqual(before.request);
    expect((await query('SELECT count(*)::int AS count FROM public_data_intakes WHERE NOT terminal'))[0].count).toBe(16);expect(measuredGets).toBe(2);
    event('capacity',{requestId:capacityId,receiptDigest:qualificationDigest(before.request),headroomFixtureId:fillers[0],headroomSourceCredit:0});
  }),180_000);

  it('reads missing pending available unavailable and capacity status without acquisition or scheduling writes',()=>guarded(7,async()=>{
    const before=await invariant(),gets=measuredGets+prerequisiteGets,forbiddenBefore=forbiddenGets;const missing=await status(randomUUID()),pending=await status(pendingId),available=await status(identityId),capacity=await status(capacityId),unavailable=await status(headroomId),progressRead=await status(cycleRequest),refresh=await refreshStatus();
    expect(missing).toEqual({status:'missing'});expect(pending.status).toBe('pending');expect(available).toMatchObject({status:'available',leagues:[]});expect(capacity).toMatchObject({status:'unavailable',reason:'submission-capacity'});
    expect(unavailable).toMatchObject({status:'unavailable',request:{terminal:true,failure_count:0,revision:0}});expect(unavailable).not.toHaveProperty('reason','submission-capacity');
    expect(progressRead).toMatchObject({status:'pending',request:{revision:2,failure_count:1,terminal:false,external_manager_id:native}});
    expect(refresh).toMatchObject({status:'available',target:{configurationRevision:revision,paused:true},cycle:{requestId:cycleRequest,configurationRevision:2}});
    if(progressRead.status==='missing')throw new Error('Missing actual retry status.');expect(new Date(String(progressRead.request.next_attempt_at)).toISOString()).toBe(recordedRetryAt);
    expect(await invariant()).toEqual(before);expect(measuredGets+prerequisiteGets).toBe(gets);expect(forbiddenGets).toBe(forbiddenBefore);
    event('status',{identityRequestId:identityId,requestId:cycleRequest,capacityRequestId:capacityId,unavailableHeadroomFixtureId:headroomId,unavailableSourceCredit:0,beforeDigest:qualificationDigest(before),readerDigest:qualificationDigest({missing,pending,available,capacity,unavailable,progressRead,refresh}),failureCount:1});
  }),90_000);

  it('enforces restricted control permissions and immutable receipt and configuration history',()=>guarded(8,async()=>{
    const auth=await pin('auth');const [actual]=await auth.database.query('SELECT session_user,current_user');expect(actual).toEqual({session_user:'league_one_auth',current_user:'league_one_auth'});actualLogins.add('league_one_auth');
    const signatures=['public.submit_public_data_intake(jsonb)','public.submit_public_data_intake(jsonb,boolean)','public.configure_public_data_refresh(jsonb)'];
    for(const signature of signatures){const [acl]=await query(`SELECT has_function_privilege('league_one_runtime',$1,'EXECUTE') AS runtime,
      has_function_privilege('league_one_auth',$1,'EXECUTE') AS auth,has_function_privilege('league_one_account',$1,'EXECUTE') AS account,
      EXISTS(SELECT 1 FROM pg_proc p,LATERAL aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a WHERE p.oid=$1::regprocedure AND a.grantee=0 AND a.privilege_type='EXECUTE') AS public`,[signature]);expect(acl).toEqual({runtime:true,auth:false,account:false,public:false});}
    for(const role of ['league_one_runtime','league_one_auth','league_one_account']){const [privileges]=await query(`SELECT rolsuper,rolcreatedb,rolcreaterole,rolreplication,rolinherit,rolbypassrls,
      EXISTS(SELECT 1 FROM pg_auth_members WHERE member=pg_roles.oid) AS memberships FROM pg_roles WHERE rolname=$1`,[role]);expect(privileges).toEqual({rolsuper:false,rolcreatedb:false,rolcreaterole:false,rolreplication:false,rolinherit:false,rolbypassrls:false,memberships:false});}
    const before=await invariant();
    for(const sql of ["SELECT public.submit_public_data_intake('{}'::jsonb,true)","SELECT public.configure_public_data_refresh('{}'::jsonb)",'SELECT * FROM public_data_intakes','SET ROLE league_one_runtime','CREATE TABLE public.cp24_forbidden(id integer)'])await expect(auth.database.query(sql)).rejects.toMatchObject({code:'42501'});
    for(const sql of ["UPDATE public_data_intakes SET username='forged' WHERE id=$1",'DELETE FROM public_data_intakes WHERE id=$1'])await expect(query(sql,[capacityId])).rejects.toMatchObject({code:'42501'});
    for(const sql of ['SET ROLE league_one_account','SET ROLE league_one_auth','CREATE TABLE public.cp24_forbidden(id integer)'])await expect(query(sql)).rejects.toMatchObject({code:'42501'});
    await expect(query('SELECT public.assert_public_data_owner($1,$2::jsonb)',[capacityId,'{}'])).rejects.toMatchObject({code:'42501'});
    await expect(query("SELECT public.fail_public_data_work('{}'::jsonb)")).rejects.toMatchObject({code:'42501'});
    for(const sql of ["UPDATE public_data_intakes SET username='forged' WHERE id=$1",'DELETE FROM public_data_intakes WHERE id=$1'])await rejectSql(ownerQuery(sql,[capacityId]),/immutable/u);
    for(const sql of ['UPDATE public_data_refresh_configurations SET paused=NOT paused WHERE target_id=$1','DELETE FROM public_data_refresh_configurations WHERE target_id=$1'])await rejectSql(ownerQuery(sql,[targetId]),/immutable/u);
    expect(await invariant()).toEqual(before);await close(auth);event('permissions',{actualRoles:[...actualLogins],accountLoginExecuted:false,signatureCount:signatures.length,unchangedDigest:qualificationDigest(before)});
  }),120_000);
});
