import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { ChildProcess } from 'node:child_process';
import { lstat, mkdir, realpath, writeFile } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createIndependentDatabase, integrationEnvironment, ownerQuery, type IndependentDatabase } from './neon-integration-harness';
import { spawnIntegrationWorker, stopIntegrationChildTree, verifyIntegrationChildTreeClosed } from './integration-child-process';
import { qualificationBinding, qualificationDigest, type QualificationBinding } from './qualification-profile';
import { FLEET_LIVE_PROFILE, FLEET_LIVE_SUITE, FLEET_LIVE_TESTS, FLEET_EVIDENCE_LIMITS,
  buildFleetLivePlan, assertFleetLiveEvidence, writeFleetShortEvidence, readFleetShortEvidence,
  type FleetShortEvidenceInventory } from './freshness-capacity-profile';
import { FLEET_VERSION, fleetEnvironment, fleetSupervisedWorkDeadline, parseFleetMessage, parseFleetShortEvent, fleetStart, fleetEnd,
  type FleetAction, type FleetConfig, type FleetMessage, type FleetShortEvent } from './freshness-capacity-protocol';

/** One explicit live public request. Existing supervisor alone owns database/schema/credential cleanup. */
describe.sequential(FLEET_LIVE_SUITE, () => {
  const siteRoot=fileURLToPath(new URL('../',import.meta.url));
  let binding:QualificationBinding,connection:IndependentDatabase,config:FleetConfig,child:ChildProcess;
  let built:Awaited<ReturnType<typeof buildFleetLivePlan>>,ready:FleetMessage|null=null;
  let sequence=0,closed=false,childFailed=false,closePromise:Promise<void>,cleanupDone=false,forcedStop=false;
  let childExit:{code:number|null;signal:string|null}|null=null,actualServer:{version:string;versionNum:string};
  let childDirectory='',parentDirectory='',childInventory:FleetShortEvidenceInventory|null=null,parentInventory:FleetShortEvidenceInventory|null=null;
  const messages:FleetMessage[]=[],events:FleetShortEvent[]=[],calls:FleetMessage[]=[];
  let receivedBytes=0;
  const cases=FLEET_LIVE_TESTS.map(name=>({name,state:'unserved',span:null as ReturnType<typeof fleetEnd>|null}));
  const cleanup={childClosed:false,backendGone:false,locksGone:false,connectionsClosed:false};
  const cleanupAttempts:{span:ReturnType<typeof fleetEnd>;facts:typeof cleanup;backendRows:readonly unknown[];lockRows:readonly unknown[]}[]=[];
  const query=(sql:string,params:readonly unknown[]=[])=>connection.database.query(sql,params);
  async function waitUntil(check:()=>boolean|Promise<boolean>,deadline:number){
    while(!await check()){assert(Date.now()<deadline,'bounded live parent wait expired');await delay(50);}
  }
  async function directory(name:string){
    assert.equal(await realpath(binding.directory),resolve(binding.directory));const root=await lstat(binding.directory);assert(root.isDirectory()&&!root.isSymbolicLink());
    const path=join(binding.directory,name);await mkdir(path);const child=await lstat(path);assert(child.isDirectory()&&!child.isSymbolicLink());assert.equal(await realpath(path),path);return path;
  }
  async function command(action:FleetAction){
    const ordinal=++sequence;await new Promise<void>((resolve,reject)=>child.send({version:FLEET_VERSION,nonce:config.nonce,sequence:ordinal,action},error=>error?reject(new Error('Live command delivery failed')):resolve()));
    if(action==='stop')return;
    const deadline=Math.min(config.workDeadlineAt,Date.now()+(action==='run-live'?190_000:60_000));
    await waitUntil(()=>{assert(!childFailed&&!closed,'live worker stopped before result');return messages.some(row=>row.type==='result'&&row.sequence===ordinal);},deadline);
    const result=messages.find(row=>row.type==='result'&&row.sequence===ordinal)!;calls.push(result);return result;
  }
  async function guarded(index:number,body:()=>Promise<void>){const start=fleetStart();cases[index].state='running';try{await body();cases[index].state='passed';}catch(error){cases[index].state='failed';throw error;}finally{cases[index].span=fleetEnd(start);}}
  async function closeOwnedResources(){
    if(cleanupDone)return;const start=fleetStart();let backendRows:readonly unknown[]=[],lockRows:readonly unknown[]=[];
    try{
      if(child&&!closed){if(sequence===3&&!childFailed)await command('stop');else{forcedStop=true;await stopIntegrationChildTree(child,child.pid);}}
      if(child){await Promise.race([closePromise,delay(12_000).then(()=>{throw new Error('Live child closure expired');})]);await verifyIntegrationChildTreeClosed(child);cleanup.childClosed=true;}
      if(ready)await waitUntil(async()=>{
        backendRows=await ownerQuery('SELECT pid,backend_start::text FROM pg_stat_activity WHERE pid=$1 AND backend_start=$2::timestamptz',[ready!.backendPid,ready!.backendStart]);
        lockRows=await ownerQuery('SELECT pid,locktype FROM pg_locks WHERE pid=$1',[ready!.backendPid]);cleanup.backendGone=backendRows.length===0;cleanup.locksGone=lockRows.length===0;return cleanup.backendGone&&cleanup.locksGone;
      },Date.now()+12_000);
    }finally{try{if(connection&&!cleanup.connectionsClosed){await connection.close();cleanup.connectionsClosed=true;}}finally{cleanupDone=Object.values(cleanup).every(Boolean);cleanupAttempts.push({span:fleetEnd(start),facts:{...cleanup},backendRows,lockRows});}}
  }
  beforeAll(async()=>{
    const selected=qualificationBinding();assert(selected?.context.profile===FLEET_LIVE_PROFILE,'explicit bound current live profile required');binding=selected;
    const environment=integrationEnvironment();connection=createIndependentDatabase();
    const[identity]=await query("SELECT current_user,session_user,current_database() AS database,current_setting('neon.branch_id',true) AS branch,current_setting('server_version') AS version,current_setting('server_version_num') AS version_num");
    expect(identity.current_user).toBe('league_one_runtime');expect(identity.session_user).toBe('league_one_runtime');expect(identity.database).toBe(environment.expectedDatabase);expect(identity.branch).toBe(environment.expectedBranchId);
    actualServer={version:String(identity.version),versionNum:String(identity.version_num)};
    const nonce=randomUUID(),fixtureId=randomUUID(),plannedPostgresqlVersion=actualServer.version.split(' ')[0];
    built=await buildFleetLivePlan({fixtureId,gitSha:binding.context.gitSha,plannedPostgresqlVersion});childDirectory=await directory('fleet-raw-'+nonce);
    config={profile:FLEET_LIVE_PROFILE,nonce,fixtureId,contextNonce:binding.context.nonce,gitSha:binding.context.gitSha,profileDigest:binding.context.profileDigest,
      fixtureDigest:built.plan.fixtureDigest,manifestDigest:built.plan.digest,plannedPostgresqlVersion,expectedDatabase:environment.expectedDatabase,expectedBranch:environment.expectedBranchId,
      evidenceDirectory:childDirectory,workDeadlineAt:fleetSupervisedWorkDeadline(process.env,FLEET_LIVE_PROFILE)};
    expect(await query('SELECT id FROM public.public_data_intakes')).toEqual([]);expect(await query('SELECT job_key FROM public.projection_jobs')).toEqual([]);
    child=spawnIntegrationWorker(process.execPath,['--conditions=react-server','--import=tsx',fileURLToPath(new URL('./freshness-capacity-worker.ts',import.meta.url))],
      {cwd:siteRoot,env:fleetEnvironment(process.env,environment.runtimeDatabaseUrl,config),stdio:['ignore','ignore','ignore','ipc']});
    closePromise=new Promise<void>(resolve=>child.once('close',(code,signal)=>{childExit={code,signal};closed=true;resolve();}));child.on('error',()=>{childFailed=true;});
    child.on('message',value=>{try{
      if(value&&typeof value==='object'&&'type'in value&&value.type==='short-event'){
        const event=parseFleetShortEvent(value,config,child.pid!,events.length+1);receivedBytes+=Buffer.byteLength(JSON.stringify(event));assert(receivedBytes<=FLEET_EVIDENCE_LIMITS.totalBytes);events.push(event);
      }else messages.push(parseFleetMessage(value,config,child.pid!));
    }catch{childFailed=true;}});
    await waitUntil(()=>{assert(!closed&&!childFailed);return messages.some(row=>row.type==='ready');},Date.now()+60_000);ready=messages.find(row=>row.type==='ready')!;
    const[backend]=await ownerQuery('SELECT usename,datname,backend_start::text FROM pg_stat_activity WHERE pid=$1',[ready.backendPid]);
    expect(backend.usename).toBe('league_one_runtime');expect(backend.datname).toBe(environment.expectedDatabase);expect(backend.backend_start).toBe(ready.backendStart);
  },90_000);
  afterAll(async()=>{
    let error:unknown;try{await closeOwnedResources();}catch(caught){error=caught;}
    finally{if(binding&&config){
      if(events.length&&!parentInventory){parentDirectory=await directory('fleet-final-'+config.nonce);parentInventory=await writeFleetShortEvidence(parentDirectory,config.manifestDigest,events);}
      const companion={kind:'cp26-fleet-live-evidence-v1',contextDigest:qualificationDigest(binding.context),config,ready,calls,cases,
        childDirectory:basename(childDirectory),childInventory,parentDirectory:parentDirectory?basename(parentDirectory):null,parentInventory,
        cleanup,cleanupAttempts,childExit,forcedStop,actualServer};const bytes=JSON.stringify(companion)+'\n';assert(Buffer.byteLength(bytes)<=4*1024*1024);
      await writeFile(join(binding.directory,'cp26-fleet-live-evidence.json'),bytes,{flag:'wx',mode:0o600});
    }}if(error)throw error;expect(Object.values(cleanup).every(Boolean)).toBe(true);
  },60_000);
  it(FLEET_LIVE_TESTS[0],()=>guarded(0,async()=>{
    const prepared=await command('prepare-live');expect(prepared?.error).toBe(false);
    const acquired=await command('run-live');expect(acquired?.error).toBe(false);assert(acquired?.result);childInventory=acquired.result.evidenceInventory as FleetShortEvidenceInventory;
    const snapshot=await command('snapshot');expect(snapshot?.error).toBe(false);
    const childEvents=await readFleetShortEvidence(childDirectory,childInventory);expect(qualificationDigest(childEvents)).toBe(qualificationDigest(events));
    const state=childEvents.find(row=>row.event.kind==='record'&&row.event.name==='current-week'),submitted=childEvents.find(row=>row.event.kind==='record'&&row.event.name==='submission');
    const first=childEvents.find(row=>row.eventSequence===acquired.result!.firstReadEventSequence);assert(state&&submitted&&first&&first.event.kind==='record'&&first.event.name==='reader');
    assert(first.event.value&&typeof first.event.value==='object'&&'phase'in first.event.value&&first.event.value.phase==='initial-useful');
    for(const origin of [state,submitted]){expect(Date.parse(first.span.endedAt)-Date.parse(origin.span.startedAt)).toBeLessThanOrEqual(60_000);expect(first.span.monotonicEndMs-origin.span.monotonicStartMs).toBeLessThanOrEqual(60_000);}
    expect(childEvents.filter(row=>row.event.kind==='record'&&row.event.name==='submission-replay')).toHaveLength(1);
    const later=childEvents.filter(row=>row.event.kind==='invocation'&&row.event.phase==='completed'&&row.event.slot>0);expect(later).toHaveLength(2);
    for(const row of later){assert(row.event.kind==='invocation');expect(row.event.result).toMatchObject({status:'complete',providerRequests:0});}
  }),210_000);
  it(FLEET_LIVE_TESTS[1],()=>guarded(1,async()=>{
    assert(ready&&childInventory);const original=await readFleetShortEvidence(childDirectory,childInventory);
    expect(qualificationDigest(original)).toBe(qualificationDigest(events));await assertFleetLiveEvidence({plan:built.plan,config,ready,calls,events:original});
  }),120_000);
  it(FLEET_LIVE_TESTS[2],()=>guarded(2,async()=>{
    await closeOwnedResources();expect(childExit).toEqual({code:0,signal:null});expect(forcedStop).toBe(false);expect(Object.values(cleanup).every(Boolean)).toBe(true);
    parentDirectory=await directory('fleet-final-'+config.nonce);parentInventory=await writeFleetShortEvidence(parentDirectory,config.manifestDigest,events);
    const retained=await readFleetShortEvidence(parentDirectory,parentInventory);expect(qualificationDigest(retained)).toBe(qualificationDigest(events));
  }),60_000);
});
