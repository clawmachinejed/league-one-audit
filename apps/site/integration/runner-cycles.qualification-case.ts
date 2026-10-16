import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import type { ChildProcess } from 'node:child_process';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createLeagueAdministrationStore, createPublicIntakeStore, createPublicDataRefreshStore } from '../lib/league-administration/store';
import { runPublicIntakeStep } from '../lib/league-administration/public-intake';
import { PUBLIC_INTAKE_JOB } from '../lib/league-administration/public-intake-contracts';
import type { PublicDataRefreshConfiguration } from '../lib/league-administration/public-refresh-contracts';
import { readPublicSleeperIntake } from '../lib/league-administration/public-intake-reader';
import { readPublicDataRefresh } from '../lib/league-administration/public-refresh-reader';
import { createProjectionStore } from '../lib/projection-store';
import { createIndependentDatabase, integrationEnvironment, ownerQuery, type IndependentDatabase } from './neon-integration-harness';
import { spawnIntegrationWorker, stopIntegrationChildTree, verifyIntegrationChildTreeClosed } from './integration-child-process';
import { assertRunnerCyclesSupportSources, qualificationBinding, qualificationDigest, type QualificationBinding } from './qualification-profile';
import { RUNNER_STAGES, runnerFixture, runnerEnvironment, runnerCommand, parseRunnerMessage, runnerTimestamp,
  runnerFetch, runnerSnapshotQuery, type RunnerConfig, type RunnerMessage, type RunnerCommand } from './runner-cycles-protocol';
import { RUNNER_CYCLES_NAMES, RUNNER_CYCLES_LIMITS, RUNNER_CYCLES_ORACLES, writeRunnerCyclesEvidence,
  assertCompleteRunnerCyclesEvidence, type RunnerCyclesEvidence, type RunnerInvocation, type RunnerCycleEvidence } from './runner-cycles-evidence';

type Worker = { child: ChildProcess; config: RunnerConfig; commands: number; invocation: number; messages: RunnerMessage[];
  ready?: RunnerMessage; closed: Promise<void>; isClosed: boolean; code: number|null; signal: NodeJS.Signals|null; failure?: Error };
const siteRoot = fileURLToPath(new URL('..',import.meta.url));
const now = () => new Date().toISOString();
/** Four complete cases, not a sustained-fleet benchmark. 27m30 authored body+
 * hook allocation leaves 150s within the original30m work budget. No hosted run
 * is authorized by source. The production primary path rejects its naturally
 * empty registry; DATA uses the unmodified real HTTP runtime in finally. */
describe.sequential('complete opt-in DATA cycles through the production runner', () => {
  let connection: IndependentDatabase, binding: QualificationBinding, worker: Worker;
  let configuration: PublicDataRefreshConfiguration, revision = 0, caseIndex = 0;
  const fixtureId = randomUUID(), fixture = runnerFixture(fixtureId,1), prerequisiteId = randomUUID(), targetId = randomUUID();
  const active = new Set<Worker>(); const oldPids = new Set<number>();
  let firstRequest = '', secondRequest = '', firstHistory: unknown, firstExact: unknown, firstNonData: unknown;
  let prerequisiteGets = 0, prerequisiteAdmissions = 0, prerequisiteClaims = 0, originalFetch: typeof fetch;
  const invocations: RunnerInvocation[] = [], cycles: RunnerCycleEvidence[] = [];
  const cases: RunnerCyclesEvidence['cases'] = RUNNER_CYCLES_NAMES.map((name,index) => ({ name,limitMs:RUNNER_CYCLES_LIMITS[index],state:'unserved',startedAt:null,endedAt:null,events:[] }));
  let serverVersion = '', serverVersionNum = '', admissionSpacingVerified = false;
  const query = (sql:string,args:readonly unknown[] = []) => connection.database.query(sql,args);
  const administration = () => createLeagueAdministrationStore(connection.database);
  const event = (data: RunnerCyclesEvidence['cases'][number]['events'][number]['data']) => cases[caseIndex].events.push({at:now(),data});
  async function guarded(index:number,body:()=>Promise<void>) {caseIndex=index;cases[index].state='running';cases[index].startedAt=now();
    try {await body();event(RUNNER_CYCLES_ORACLES[index]);cases[index].state='passed';}catch(error){cases[index].state='failed';throw error;}finally{cases[index].endedAt=now();}}
  async function waitUntil(probe:()=>Promise<boolean>,limit:number,reason:string) {const end=Date.now()+limit;
    while(!await probe()){if(Date.now()>=end)throw new Error(reason);await delay(100);}}
  async function eligible() {await waitUntil(async()=>{const [row]=await query(`SELECT
    NOT EXISTS(SELECT 1 FROM public.public_data_dispatches WHERE admitted_at>clock_timestamp()-interval '60 seconds')
    AND NOT EXISTS(SELECT 1 FROM public.projection_jobs WHERE job_key=$1 AND
      (state='running' OR completed_at>clock_timestamp()-interval '60 seconds')) AS ready`,[PUBLIC_INTAKE_JOB]);return row.ready===true;},85_000,'CP25 original admission window not reached.');}
  async function attemptCount() {const rows=await query('SELECT attempt_count FROM public.projection_jobs WHERE job_key=$1',[PUBLIC_INTAKE_JOB]);return Number(rows[0]?.attempt_count ?? 0);}
  async function configure(change:Partial<PublicDataRefreshConfiguration>={}) {configuration={...configuration,...change,expectedRevision:revision};
    const result=await createPublicDataRefreshStore(connection.database).configure(configuration);revision=result.configurationRevision;return result;}
  async function refresh() {return readPublicDataRefresh(connection.database,administration(),targetId,{managerEvidenceVersion:'v2',exactMatchupValuesVersion:'v1'});}
  async function allTables(nonData=false) {const tables=await ownerQuery(`SELECT schemaname,tablename FROM pg_tables WHERE schemaname IN('public','website_auth') ORDER BY schemaname,tablename`);
    // One snapshot and one owner connection, including every empty table. Only
    // validated catalogue identifiers enter this bounded fixture SQL.
    const snapshot=runnerSnapshotQuery(tables.map(row=>({schemaname:String(row.schemaname),tablename:String(row.tablename)})),nonData);
    return ownerQuery(snapshot.sql,snapshot.parameters);}
  async function history(requestId:string) {const rows:Record<string,unknown>={};
    for(const table of ['public_data_intakes','public_data_identity_observations','public_data_league_lists','public_data_league_candidates','public_data_directory_captures',
      'public_data_exact_period_tasks','public_data_exact_period_checkpoints','public_data_dispatches']){
      const column=table==='public_data_intakes'?'id':'intake_id';rows[table]=await query(`SELECT to_jsonb(t) AS row FROM public.${table} t WHERE ${column}=$1 ORDER BY to_jsonb(t)::text`,[requestId]);}
    rows.outcomes=await query(`SELECT to_jsonb(o) AS row FROM public.public_data_dispatch_outcomes o JOIN public.public_data_dispatches d USING(worker_id,generation) WHERE d.intake_id=$1 ORDER BY o.generation`,[requestId]);
    rows.receipts=await query(`SELECT to_jsonb(r) AS receipt,to_jsonb(a) AS acceptance,to_jsonb(c) AS content,to_jsonb(attempt) AS attempt
      FROM public.league_roster_capture_receipts r JOIN public.league_administration_contents c ON c.id=r.content_id
      JOIN public.league_roster_resource_attempts attempt ON attempt.id=r.attempt_id
      JOIN public.league_roster_resource_acceptances a ON a.receipt_id=r.id
      WHERE r.provenance->'acquisition'->'work'->>'requestId'=$1 ORDER BY r.id`,[requestId]);
    rows.cycles=await query(`SELECT to_jsonb(c) AS cycle,to_jsonb(o) AS outcome FROM public.public_data_refresh_cycles c
      JOIN public.public_data_refresh_cycle_outcomes o USING(target_id,cycle) WHERE c.intake_id=$1`,[requestId]);return rows;}
  async function send(target:Worker,action:RunnerCommand['action'],selection:RunnerCommand['selection']='enabled',variant:1|2=1,hold=false) {
    await new Promise<void>((resolve,reject)=>target.child.send(runnerCommand(target.config,++target.commands,action,selection,variant,hold),error=>error?reject(new Error('CP25 child command failed.')):resolve()));}
  async function message(target:Worker,type:RunnerMessage['type'],invocation:number,limit=30_000){let found:RunnerMessage|undefined;
    await waitUntil(async()=>{if(target.failure)throw target.failure;found=target.messages.find(row=>row.type===type&&row.invocation===invocation);
      if(!found&&target.isClosed)throw new Error('CP25 child closed before evidence.');return Boolean(found);},limit,'CP25 child evidence allowance exceeded.');return found!;}
  async function launch(){await assertRunnerCyclesSupportSources(siteRoot);expect(active.size).toBe(0);const env=integrationEnvironment();
    const config:RunnerConfig={nonce:randomUUID(),fixtureId,contextNonce:binding.context.nonce,gitSha:binding.context.gitSha,profileDigest:binding.context.profileDigest,
      expectedDatabase:env.expectedDatabase,expectedBranch:env.expectedBranchId};
    const child=spawnIntegrationWorker(process.execPath,['--conditions=react-server','--import=tsx',fileURLToPath(new URL('./runner-cycles-worker.ts',import.meta.url))],
      {cwd:siteRoot,env:runnerEnvironment(process.env,env.runtimeDatabaseUrl,config),stdio:['ignore','ignore','ignore','ipc']});
    const next={child,config,commands:0,invocation:0,messages:[],isClosed:false,code:null,signal:null} as unknown as Worker;
    next.closed=new Promise<void>(resolve=>child.once('close',(code,signal)=>{next.isClosed=true;next.code=code;next.signal=signal;resolve();}));
    child.on('error',()=>{next.failure=new Error('CP25 child launch failed.');});
    child.on('message',value=>{try{const parsed=parseRunnerMessage(value,config,child.pid!);const previous=next.messages[0];
      if(!previous&&parsed.type!=='ready'||previous&&(previous.backendPid!==parsed.backendPid||previous.backendStart!==parsed.backendStart))throw new Error('CP25 backend changed.');next.messages.push(parsed);
    }catch{next.failure=new Error('CP25 child evidence rejected.');}});active.add(next);
    expect(oldPids.has(child.pid!)).toBe(false);next.ready=await message(next,'ready',0,20_000);
    const [backend]=await ownerQuery('SELECT usename,datname,backend_start::text FROM pg_stat_activity WHERE pid=$1',[next.ready.backendPid]);
    expect(backend.usename).toBe('league_one_runtime');expect(backend.datname).toBe(env.expectedDatabase);expect(backend.backend_start).toBe(next.ready.backendStart);
    return next;}
  async function close(target:Worker,hard=false,cleanup=false){if(hard&&!target.isClosed)await stopIntegrationChildTree(target.child,target.child.pid);
    else if(!target.isClosed)await send(target,'stop');
    await Promise.race([target.closed,delay(12_000).then(()=>{throw new Error('CP25 child close not observed.');})]);
    await verifyIntegrationChildTreeClosed(target.child);
    if(target.ready)await waitUntil(async()=>{const [row]=await ownerQuery(`SELECT NOT EXISTS(SELECT 1 FROM pg_stat_activity WHERE pid=$1 AND backend_start=$2::timestamptz)
      AND NOT EXISTS(SELECT 1 FROM pg_locks WHERE pid=$1) AS gone`,[target.ready!.backendPid,target.ready!.backendStart]);return row.gone===true;},12_000,'CP25 backend remained after process closure.');
    active.delete(target);oldPids.add(target.child.pid!);
    if(!cleanup){if(hard&&process.platform!=='win32')expect(target.signal).toBe('SIGKILL');if(!hard)expect(target.code).toBe(0);}
    return {pid:target.child.pid!,backendPid:target.ready?.backendPid??0,hard,closed:true,closedAt:now()};}
  async function invoke(selection:RunnerCommand['selection']='enabled',variant:1|2=1,onBarrier?:(message:RunnerMessage)=>Promise<void>) {
    const claimBefore=await attemptCount(),startedAt=now(),ordinal=++worker.invocation;
    await send(worker,'invoke',selection,variant,Boolean(onBarrier));
    if(onBarrier){const barrier=await message(worker,'barrier',ordinal);await onBarrier(barrier);await send(worker,'release');}
    const result=await message(worker,'result',ordinal),claimAfter=await attemptCount();
    const rows=await query(`SELECT d.resource,d.intake_id,d.generation,d.admitted_at,o.outcome,o.recorded_at,
      o.capture_acquisition->'fence'->>'deadlineAt' AS deadline_at
      FROM public.public_data_dispatches d JOIN public.public_data_dispatch_outcomes o USING(worker_id,generation)
      WHERE d.generation>$1 AND d.generation<=$2 ORDER BY d.generation`,[claimBefore,claimAfter]);
    const row:RunnerInvocation={pid:worker.child.pid!,invocation:ordinal,selection,variant,startedAt,invocationStartedAt:result.invocationStartedAt!,endedAt:now(),gets:result.gets,sqlRequests:result.sqlRequests,
      signalRequests:result.signalRequests,registrySqlRequests:result.registrySqlRequests,registrySignalRequests:result.registrySignalRequests,
      claimBefore,claimAfter,facade:result.facade as 'registry-unavailable',paths:result.paths,
      admissions:rows.map(item=>({resource:String(item.resource),requestId:String(item.intake_id),generation:Number(item.generation),admittedAt:runnerTimestamp(item.admitted_at),
        deadlineAt:runnerTimestamp(item.deadline_at),outcomeAt:runnerTimestamp(item.recorded_at),outcome:item.outcome as 'checkpoint-committed'}))};
    invocations.push(row);return row;}
  async function stage(resource:typeof RUNNER_STAGES[number],variant:1|2,onBarrier?:(message:RunnerMessage)=>Promise<void>){await eligible();const row=await invoke('enabled',variant,onBarrier);
    expect(row.claimAfter).toBe(row.claimBefore+1);expect(row.admissions).toHaveLength(1);expect(row.admissions[0]).toMatchObject({resource,outcome:'checkpoint-committed'});
    expect(row.gets).toBe(['core','exact-matchups'].includes(resource)?2:1);expect(row.signalRequests).toBeGreaterThan(row.registrySignalRequests);return row.admissions[0];}
  async function settled(number:1|2){await eligible();const beforeOutcome=await query('SELECT * FROM public.public_data_refresh_cycle_outcomes WHERE target_id=$1 AND cycle=$2',[targetId,number]);expect(beforeOutcome).toEqual([]);
    const row=await invoke('enabled',number);expect(row.claimAfter).toBe(row.claimBefore+1);expect(row.gets).toBe(0);expect(row.admissions).toEqual([]);
    const read=await refresh();expect(read).toMatchObject({status:'available',cycle:{number,outcome:{disposition:'complete'}},intake:{status:'available',request:{terminal:true}}});
    if(read.status!=='available'||!read.cycle||!read.cycle.outcome||!read.intake||read.intake.status==='missing')throw new Error('CP25 full settlement unavailable.');
    expect(read.intake.leagues).toHaveLength(1);expect(read.intake.exactPeriods).toHaveLength(1);
    expect(read.intake.leagues[0]).toMatchObject({collection:'complete',resources:{settings:{status:'available'},heldRoster:{status:'available'},directory:{status:'available'}}});
    expect(read.intake.exactPeriods![0]).toMatchObject({collection:'complete',resource:{status:'available'},exactMatchupValues:{status:'available'}});
    const exact=read.intake.exactPeriods![0].exactMatchupValues;if(!exact||exact.status!=='available')throw new Error('CP25 typed exact values unavailable.');
    expect(exact.value.teams.find(team=>team.externalRosterId==='1')?.effectivePoints).toEqual({value:number===1?'0':'12.25',source:'raw'});
    const [directory]=await query('SELECT * FROM public.public_data_directory_captures WHERE intake_id=$1',[read.cycle.requestId]);
    const retained=await history(read.cycle.requestId);
    cycles.push({number,requestId:read.cycle.requestId,configurationRevision:read.cycle.configurationRevision,historyDigest:qualificationDigest(retained),dueAt:read.cycle.dueAt,disposition:'complete',recordedAt:read.cycle.outcome.recordedAt,
      nextDueAt:read.cycle.outcome.nextDueAt,directoryContentId:String(directory.content_id),directoryCaptureId:String(directory.id),directoryCapturedAt:runnerTimestamp(directory.request_completed_at),exactContentId:exact.contentId});
    const afterOutcome=await query('SELECT * FROM public.public_data_refresh_cycle_outcomes WHERE target_id=$1 AND cycle=$2',[targetId,number]);expect(afterOutcome).toHaveLength(1);
    event({witness:'settlement',cycle:number,requestId:read.cycle.requestId,pid:row.pid,invocation:row.invocation,generation:row.claimAfter,beforeOutcomeCount:beforeOutcome.length,
      afterOutcomeCount:afterOutcome.length,outcomeDigest:qualificationDigest(read.cycle.outcome),historyDigest:qualificationDigest(retained),readerDigest:qualificationDigest(read),nextDueAt:read.cycle.outcome.nextDueAt});
    return {requestId:read.cycle.requestId,retained,exact};}

  beforeAll(async()=>{const selected=qualificationBinding();if(selected?.context.profile!=='data-runner-cycles-v1')throw new Error('CP25 requires its closed guarded profile.');binding=selected;
    await assertRunnerCyclesSupportSources(siteRoot);connection=createIndependentDatabase();originalFetch=globalThis.fetch;
    const [identity]=await query(`SELECT current_user,session_user,current_database() AS database,current_setting('neon.branch_id',true) AS branch,
      current_setting('server_version') AS version,current_setting('server_version_num') AS version_num`);
    expect(identity.current_user).toBe('league_one_runtime');expect(identity.session_user).toBe('league_one_runtime');
    expect(identity.database).toBe(integrationEnvironment().expectedDatabase);expect(identity.branch).toBe(integrationEnvironment().expectedBranchId);
    serverVersion=String(identity.version);serverVersionNum=String(identity.version_num);expect(await attemptCount()).toBe(0);
    globalThis.fetch=runnerFetch({runtimeUrl:integrationEnvironment().runtimeDatabaseUrl,fixtureId,variant:()=>1,emptyList:true,originalFetch,
      sql:()=>undefined,source:()=>{prerequisiteGets++;}});
    const intake=createPublicIntakeStore(connection.database),jobs=createProjectionStore(connection.database);
    await intake.submit({id:prerequisiteId,username:fixture.username,seasons:[2026]});
    for(const resource of ['identity','leagues']){await eligible();const result=await runPublicIntakeStep(prerequisiteId,{intake,administration:administration(),jobs},AbortSignal.timeout(20_000));
      expect(result).toMatchObject({status:'progress',resource,providerRequests:1});}
    prerequisiteClaims=await attemptCount();prerequisiteAdmissions=Number((await query('SELECT count(*) AS count FROM public.public_data_dispatches'))[0].count);
    expect([prerequisiteGets,prerequisiteAdmissions,prerequisiteClaims]).toEqual([2,2,2]);
    expect(await readPublicSleeperIntake(connection.database,administration(),prerequisiteId)).toMatchObject({status:'available',leagues:[]});
    globalThis.fetch=async()=>{throw new Error('CP25 stored parent reader attempted source acquisition.');};
    configuration={id:targetId,expectedRevision:0,identityRequestId:prerequisiteId,seasons:[2026],exactPeriods:[{season:2026,nativeWeek:1}],cadenceSeconds:60,
      expiresAt:new Date(Date.now()+3_600_000).toISOString(),paused:false};await configure();firstNonData=await allTables(true);worker=await launch();
  },180_000);
  afterAll(async()=>{let cleanupComplete=true;try{for(const item of [...active])try{await close(item,!item.isClosed,true);}catch{cleanupComplete=false;}
    if(connection)try{await connection.close();}catch{cleanupComplete=false;}
    if(binding&&serverVersion){const evidence:RunnerCyclesEvidence={kind:'data-runner-cycles-evidence-v1',contextDigest:qualificationDigest(binding.context),gitSha:binding.context.gitSha,
      serverVersion,serverVersionNum,actualRuntimeLogin:true,actualHttpRuntimeLogin:worker?.ready?.httpCurrentUser==='league_one_runtime',primaryBoundary:'empty-registry-rejection',
      prerequisiteGets,prerequisiteAdmissions,prerequisiteClaims,cleanupComplete,admissionSpacingVerified,cases,invocations,cycles};
      await writeRunnerCyclesEvidence(binding,evidence);if(cases.every(entry=>entry.state==='passed'))assertCompleteRunnerCyclesEvidence(evidence,binding);}
    expect(cleanupComplete).toBe(true);
  }finally{if(originalFetch)globalThis.fetch=originalFetch;vi.restoreAllMocks();}},90_000);

  it('keeps omitted and explicit false selections free of DATA acquisition and writes',()=>guarded(0,async()=>{const before=await allTables();
    for(const selection of ['omitted','false'] as const){const result=await invoke(selection);expect(result.gets).toBe(0);expect(result.claimAfter).toBe(result.claimBefore);
      expect(result.registrySqlRequests).toBe(1);expect(result.registrySignalRequests).toBe(1);
      expect(result.sqlRequests).toBe(result.registrySqlRequests);expect(result.signalRequests).toBe(result.registrySignalRequests);
      const after=await allTables();expect(after).toEqual(before);event({witness:'disabled',selection,pid:result.pid,invocation:result.invocation,beforeDigest:qualificationDigest(before),afterDigest:qualificationDigest(after)});}
  }),60_000);
  it('completes the first cycle across pending pause expiry and an inter-invocation process restart',()=>guarded(1,async()=>{const admitted=await stage('identity',1);firstRequest=admitted.requestId;
    const identity=await query('SELECT * FROM public.public_data_identity_observations WHERE intake_id=$1',[firstRequest]);expect(identity).toHaveLength(1);
    const original=await refresh();expect(original).toMatchObject({cycle:{number:1,requestId:firstRequest,configurationRevision:1}});
    const old=worker,deathRequestedAt=now();const closure=await close(old,true);worker=await launch();expect(worker.child.pid).not.toBe(old.child.pid);
    const afterRestart=await query('SELECT * FROM public.public_data_identity_observations WHERE intake_id=$1',[firstRequest]);expect(afterRestart).toEqual(identity);
    event({witness:'restart',requestId:firstRequest,cycle:1,oldPid:closure.pid,newPid:worker.child.pid!,oldBackendPid:closure.backendPid,newBackendPid:worker.ready!.backendPid,
      oldBackendStart:old.ready!.backendStart,newBackendStart:worker.ready!.backendStart,deathRequestedAt,closedAt:closure.closedAt,restartedAt:worker.ready!.at,
      checkpointBeforeDigest:qualificationDigest(identity),checkpointAfterDigest:qualificationDigest(afterRestart)});
    await configure({paused:true});await eligible();let blocked=await invoke();expect(blocked.claimAfter).toBe(blocked.claimBefore+1);expect(blocked.gets).toBe(0);expect(blocked.admissions).toEqual([]);
    let pending=await refresh();if(pending.status!=='available')throw new Error('CP25 paused target unavailable.');
    expect(pending).toMatchObject({cycle:{requestId:firstRequest,number:1},target:{paused:true}});
    event({witness:'pending',kind:'pause',requestId:firstRequest,cycle:1,revision:pending.target.configurationRevision,configuredAt:pending.target.configuredAt,expiresAt:pending.target.expiresAt,
      pid:blocked.pid,invocation:blocked.invocation,checkedAt:runnerTimestamp((await query('SELECT clock_timestamp() AS at'))[0].at),checkpointBeforeDigest:qualificationDigest(identity),checkpointAfterDigest:qualificationDigest(await query('SELECT * FROM public.public_data_identity_observations WHERE intake_id=$1',[firstRequest]))});
    const expiresAt=new Date(Date.now()+2_000).toISOString();await configure({paused:false,expiresAt});
    await eligible();expect((await query('SELECT clock_timestamp()>=$1::timestamptz AS expired',[expiresAt]))[0].expired).toBe(true);
    blocked=await invoke();expect(blocked.claimAfter).toBe(blocked.claimBefore+1);expect(blocked.gets).toBe(0);expect(blocked.admissions).toEqual([]);
    pending=await refresh();if(pending.status!=='available')throw new Error('CP25 expired target unavailable.');expect(pending).toMatchObject({cycle:{requestId:firstRequest,number:1},target:{paused:false}});
    event({witness:'pending',kind:'expiry',requestId:firstRequest,cycle:1,revision:pending.target.configurationRevision,configuredAt:pending.target.configuredAt,expiresAt:pending.target.expiresAt,
      pid:blocked.pid,invocation:blocked.invocation,checkedAt:runnerTimestamp((await query('SELECT clock_timestamp() AS at'))[0].at),checkpointBeforeDigest:qualificationDigest(identity),checkpointAfterDigest:qualificationDigest(await query('SELECT * FROM public.public_data_identity_observations WHERE intake_id=$1',[firstRequest]))});
    expect(await query('SELECT * FROM public.public_data_identity_observations WHERE intake_id=$1',[firstRequest])).toEqual(identity);
    await configure({expiresAt:new Date(Date.now()+3_600_000).toISOString(),paused:false});
    for(const resource of RUNNER_STAGES.slice(1))expect((await stage(resource,1)).requestId).toBe(firstRequest);
    const result=await settled(1);expect(result.requestId).toBe(firstRequest);firstHistory=result.retained;firstExact=result.exact;
    expect((await refresh())).toMatchObject({cycle:{configurationRevision:1,requestId:firstRequest}});
  }),660_000);
  it('completes a changed second cycle while admitted work survives pause expiry and later disablement',()=>guarded(2,async()=>{let originalDeadline='',pausedAt='',expiredAt='';
    const admitted=await stage('identity',2,async barrier=>{expect(barrier.gets).toBe(1);
      const [dispatch]=await query(`SELECT d.intake_id,d.admitted_at FROM public.public_data_dispatches d ORDER BY admitted_at DESC LIMIT 1`);
      secondRequest=String(dispatch.intake_id);
      originalDeadline=new Date(Date.parse(barrier.invocationStartedAt!)+20_000).toISOString();
      expiredAt=new Date(Date.now()+2_000).toISOString();await configure({paused:true,expiresAt:expiredAt});
      const [configured]=await query('SELECT configured_at FROM public.public_data_refresh_configurations WHERE target_id=$1 AND revision=$2',[targetId,revision]);pausedAt=runnerTimestamp(configured.configured_at);
      await waitUntil(async()=>Boolean((await query('SELECT clock_timestamp()>=$1::timestamptz AS expired',[expiredAt]))[0].expired),5_000,'CP25 natural expiry not observed.');
      expect(Date.now()).toBeLessThan(Date.parse(originalDeadline));expect(Date.parse(pausedAt)).toBeGreaterThanOrEqual(Date.parse(runnerTimestamp(dispatch.admitted_at)));});
    expect(admitted.requestId).toBe(secondRequest);expect(admitted.deadlineAt).toBe(originalDeadline);expect(Date.parse(admitted.outcomeAt)).toBeGreaterThanOrEqual(Date.parse(expiredAt));
    const before=await allTables();const disabled=await invoke('false',2);expect(disabled.gets).toBe(0);expect(disabled.claimAfter).toBe(disabled.claimBefore);const after=await allTables();expect(after).toEqual(before);
    event({witness:'disabled',selection:'false',pid:disabled.pid,invocation:disabled.invocation,beforeDigest:qualificationDigest(before),afterDigest:qualificationDigest(after)});
    event({witness:'admitted-control',requestId:secondRequest,configurationRevision:revision,admittedAt:admitted.admittedAt,pausedAt,expiredAt,originalDeadline,outcomeAt:admitted.outcomeAt});
    await configure({paused:false,expiresAt:new Date(Date.now()+3_600_000).toISOString()});
    for(const resource of RUNNER_STAGES.slice(1))expect((await stage(resource,2)).requestId).toBe(secondRequest);
    const result=await settled(2);expect(result.requestId).toBe(secondRequest);expect(secondRequest).not.toBe(firstRequest);
  }),600_000);
  it('retains both cycle histories and stored reader parity without non-DATA mutation',()=>guarded(3,async()=>{const before=await allTables();const current=await refresh();
    expect(current).toMatchObject({status:'available',cycle:{number:2,outcome:{disposition:'complete'}},intake:{status:'available'}});
    const historical=await readPublicSleeperIntake(connection.database,administration(),firstRequest,{exactMatchupValuesVersion:'v1'});
    expect(historical).toMatchObject({exactPeriods:[{resource:{status:'unavailable',reason:'intake-capture-not-current-head'},exactMatchupValues:firstExact}]});
    expect(await history(firstRequest)).toEqual(firstHistory);expect(qualificationDigest(await history(firstRequest))).toBe(cycles[0].historyDigest);
    expect(cycles[1].directoryContentId).toBe(cycles[0].directoryContentId);expect(cycles[1].directoryCaptureId).not.toBe(cycles[0].directoryCaptureId);
    expect(Date.parse(cycles[1].directoryCapturedAt)).toBeGreaterThan(Date.parse(cycles[0].directoryCapturedAt));expect(cycles[1].exactContentId).not.toBe(cycles[0].exactContentId);
    const after=await allTables(),nonDataAfter=await allTables(true);expect(after).toEqual(before);expect(nonDataAfter).toEqual(firstNonData);
    const [spacing]=await query(`SELECT count(*)=14 AND bool_and(previous IS NULL OR admitted_at-previous>=interval '60 seconds') AS valid
      FROM (SELECT admitted_at,lag(admitted_at) OVER(ORDER BY admitted_at) AS previous FROM public.public_data_dispatches) d`);
    expect(spacing.valid).toBe(true);admissionSpacingVerified=true;expect(await attemptCount()).toBe(18);
    if(historical.status==='missing')throw new Error('CP25 earlier reader unavailable.');
    event({witness:'history',firstRequest,secondRequest,priorHistoryBeforeDigest:cycles[0].historyDigest,priorHistoryAfterDigest:qualificationDigest(await history(firstRequest)),
      nonDataBeforeDigest:qualificationDigest(firstNonData),nonDataAfterDigest:qualificationDigest(nonDataAfter),storedBeforeDigest:qualificationDigest(before),storedAfterDigest:qualificationDigest(after),
      exactBeforeDigest:qualificationDigest(firstExact),exactAfterDigest:qualificationDigest(historical.exactPeriods![0].exactMatchupValues),latestReaderDigest:qualificationDigest(current),earlierReaderDigest:qualificationDigest(historical),
      unchangedContentId:cycles[0].directoryContentId,earlierCaptureAt:cycles[0].directoryCapturedAt,laterCaptureAt:cycles[1].directoryCapturedAt,nonDataDigest:qualificationDigest(firstNonData),claims:18,admissions:14,gets:18});
  }),60_000);
});
