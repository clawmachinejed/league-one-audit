import { createHash, randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import type { ChildProcess } from 'node:child_process';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { DatabaseRow } from '../lib/database';
import { createLeagueAdministrationStore, createPublicIntakeStore, createPublicDataRefreshStore } from '../lib/league-administration/store';
import { readPublicSleeperIntake } from '../lib/league-administration/public-intake-reader';
import { readPublicDataRefresh } from '../lib/league-administration/public-refresh-reader';
import { PUBLIC_INTAKE_JOB } from '../lib/league-administration/public-intake-contracts';
import type { PublicDataRefreshConfiguration } from '../lib/league-administration/public-refresh-contracts';
import { createProjectionStore } from '../lib/projection-store';
import { createIndependentDatabase, createPinnedIntegrationDatabase, integrationEnvironment, ownerQuery, type IndependentDatabase } from './neon-integration-harness';
import { spawnIntegrationWorker, stopIntegrationChildTree, verifyIntegrationChildTreeClosed } from './integration-child-process';
import { assertCompetingWorkersSupportSources, qualificationBinding, COMPETING_WORKERS_TESTS, type QualificationBinding } from './qualification-profile';
import { CONTENTION_VERSION, STALE_PROBES, assertContentionReader, assertFairness, assertSameBackend, contentionControl, contentionEnvironment,
  contentionFixture, parseContentionMessage, type ContentionConfig, type ContentionMessage, type Control, type FairnessObservation } from './competing-workers-protocol';

type Worker = { child: ChildProcess; config: ContentionConfig; messages: ContentionMessage[]; ready?: ContentionMessage;
  sequence: number; step: number; isClosed: boolean; exitCode: number | null; error?: Error; closed: Promise<void> };
type Fixture = ReturnType<typeof contentionFixture> & { requestId: string; target?: PublicDataRefreshConfiguration };
const siteRoot = fileURLToPath(new URL('..',import.meta.url));
const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const CASE_LIMITS = [180_000,210_000,240_000,210_000,540_000] as const;

/** Frozen DATA-CP23-2026-10-15-CONTENTION-SCOPE. Authored, not hosted SQL proof.
 * Exactly five cases;12 admissions/21 GET attempts/at least15 ordinary claims.
 * Metadata prerequisites have no ordinary acquisition or acceptance credit.
 * No measured job/lease/fence/admission/retry timestamp is rewritten. */
describe.sequential('fenced DATA ownership and bounded fairness under competing live workers', () => {
  let connection: IndependentDatabase, binding: QualificationBinding | undefined;
  const active = new Set<Worker>(), allWorkers: Worker[] = [], events: Record<string,unknown>[] = [], targets: Fixture[] = [];
  const cases = COMPETING_WORKERS_TESTS.map((name,index) => ({ name, limitMs: CASE_LIMITS[index], state: 'unserved', startedAt: null as string|null,
    endedAt: null as string|null, plannedAdmissions: [1,2,2,1,6][index], plannedGets: [2,4,3,2,10][index], evidence: [] as Record<string,unknown>[] }));
  const fairnessSlots=['F','A','B','F','A','B'].map((target,index)=>({index,target,resource:index<4?'core':'users',
    readerBoundMs:[null,180_000,240_000,null,360_000,420_000][index],state:'unserved',observation:null as FairnessObservation|null}));
  let caseIndex = -1;
  const query = <Row extends DatabaseRow = DatabaseRow>(sql: string, args: readonly unknown[] = []) => connection.database.query<Row>(sql,args);
  const receiptRows = (requestId: string) => query(`SELECT receipt.id,receipt.content_id,receipt.attempt_id,
    to_jsonb(receipt) AS receipt,to_jsonb(content) AS content,to_jsonb(acceptance) AS acceptance,
    acceptance.accepted_at::text AS accepted_at,scope.identity
    FROM league_roster_capture_receipts receipt JOIN league_administration_contents content ON content.id=receipt.content_id
    JOIN league_roster_resource_attempts attempt ON attempt.id=receipt.attempt_id
    JOIN league_roster_resource_scopes scope ON scope.id=attempt.scope_id
    LEFT JOIN league_roster_resource_acceptances acceptance ON acceptance.receipt_id=receipt.id
    WHERE receipt.provenance->'acquisition'->'work'->>'requestId'=$1 ORDER BY receipt.id`,[requestId]);
  const state = (id: string) => query('SELECT revision,failure_count,terminal,next_attempt_at::text FROM public_data_intakes WHERE id=$1',[id]);
  const candidate = (id: string) => query('SELECT * FROM public_data_league_candidates WHERE intake_id=$1',[id]);
  const dispatches = (id: string) => query(`SELECT dispatch.*,outcome.outcome,outcome.recorded_at::text AS outcome_at,
    dispatch.admitted_at::text AS admitted_time FROM public_data_dispatches dispatch LEFT JOIN public_data_dispatch_outcomes outcome USING(worker_id,generation)
    WHERE intake_id=$1 ORDER BY admitted_at`,[id]);
  async function until(probe: () => Promise<boolean>, milliseconds: number, label: string) {
    const deadline = Date.now()+milliseconds;
    while (!await probe()) { if (Date.now()>=deadline) throw new Error(label); await delay(50); }
  }
  function latest(worker: Worker, type: ContentionMessage['type'], step = worker.step, barrier?: ContentionMessage['barrier']) {
    return worker.messages.find(message => message.type===type && message.step===step && (!barrier || message.barrier===barrier));
  }
  async function message(worker: Worker, type: ContentionMessage['type'], milliseconds = 30_000, barrier?: ContentionMessage['barrier']) {
    let found: ContentionMessage|undefined;
    await until(async () => { if (worker.error) throw worker.error; found=latest(worker,type,worker.step,barrier);
      if (!found && worker.isClosed) throw new Error('CP23 worker closed before required evidence.'); return !!found;
    },milliseconds,'CP23 required process evidence timed out.');
    return found!;
  }
  async function control(worker: Worker, command: Control) {
    if (command==='step') worker.step++;
    await new Promise<void>((resolve,reject) => worker.child.send(contentionControl(worker.config,command,++worker.sequence), error =>
      error ? reject(new Error('CP23 control delivery failed.')) : resolve()));
  }
  async function launch(fixtures: readonly Fixture[], requestId: string|null = null, action: ContentionConfig['action']='normal', faultFixture: string|null=null) {
    if (!binding) throw new Error('CP23 context missing.');
    await assertCompetingWorkersSupportSources(siteRoot);
    const env=integrationEnvironment();
    const config: ContentionConfig={ nonce:randomUUID(),contextNonce:binding.context.nonce,gitSha:binding.context.gitSha,profileDigest:binding.context.profileDigest,
      expectedDatabase:env.expectedDatabase,expectedBranch:env.expectedBranchId,fixtures:fixtures.map(f=>f.id),requestId,action,faultFixture };
    const child=spawnIntegrationWorker(process.execPath,['--conditions=react-server','--import=tsx',fileURLToPath(new URL('./competing-workers-worker.ts',import.meta.url))],
      {cwd:siteRoot,env:contentionEnvironment(process.env,env.runtimeDatabaseUrl,config),stdio:['ignore','ignore','ignore','ipc']});
    const worker={child,config,messages:[],sequence:0,step:0,isClosed:false,exitCode:null} as unknown as Worker;
    worker.closed=new Promise(resolve=>child.once('close',code=>{worker.isClosed=true;worker.exitCode=code;resolve();}));
    child.on('error',()=>{worker.error=new Error('CP23 child launch failed.');});
    child.on('message',value=>{try { const parsed=parseContentionMessage(value,config,child.pid!);
      if (!worker.messages.length && parsed.type!=='ready') throw new Error('CP23 missing startup proof.');
      if (worker.messages.length) assertSameBackend(worker.messages[0],parsed);
      if(worker.messages.length>=4_000)throw new Error('CP23 bounded event inventory exhausted.');worker.messages.push(parsed);
    } catch {worker.error=new Error('CP23 process evidence rejected.');} });
    active.add(worker);allWorkers.push(worker);
    worker.ready=await message(worker,'ready',15_000);
    return worker;
  }
  async function overlap(workers: readonly Worker[]) {
    expect(workers).toHaveLength(2);
    expect(new Set(workers.map(w=>w.ready!.pid)).size).toBe(2);
    expect(new Set(workers.map(w=>w.ready!.backendPid)).size).toBe(2);
    const rows=await ownerQuery(`SELECT pid,usename,datname,backend_start::text FROM pg_stat_activity WHERE pid=ANY($1::integer[]) ORDER BY pid`,[workers.map(w=>w.ready!.backendPid)]);
    expect(rows).toHaveLength(2);
    for (const worker of workers) expect(rows.find(row=>row.pid===worker.ready!.backendPid)).toEqual({pid:worker.ready!.backendPid,
      usename:'league_one_runtime',datname:worker.config.expectedDatabase,backend_start:worker.ready!.backendStart});
    events.push({type:'live-overlap',caseIndex,at:new Date().toISOString(),workers:workers.map(w=>({nonce:w.config.nonce,pid:w.ready!.pid,backendPid:w.ready!.backendPid,backendStart:w.ready!.backendStart})),rows});
  }
  async function close(worker: Worker, cleanup=false) {
    if (!worker.isClosed) {
      if (cleanup) await stopIntegrationChildTree(worker.child,worker.child.pid);
      else await control(worker,'stop');
    }
    await Promise.race([worker.closed,delay(12_000).then(()=>{throw new Error('CP23 child closure timed out.');})]);
    const closure=await verifyIntegrationChildTreeClosed(worker.child);
    if (worker.ready) await until(async()=> (await ownerQuery(`SELECT NOT EXISTS(SELECT 1 FROM pg_stat_activity WHERE pid=$1 AND backend_start=$2::timestamptz)
      AND NOT EXISTS(SELECT 1 FROM pg_locks WHERE pid=$1) AS gone`,[worker.ready!.backendPid,worker.ready!.backendStart]))[0].gone===true,12_000,'CP23 backend/locks survived child closure.');
    active.delete(worker);events.push({type:'child-close',caseIndex,nonce:worker.config.nonce,closure,exitCode:worker.exitCode,cleanup,at:new Date().toISOString()});
    if (!cleanup) {expect(worker.error).toBeUndefined();expect(worker.exitCode).toBe(0);}
  }
  async function cleanupWorkers() { const failures:unknown[]=[];for(const worker of [...active])try{await close(worker,true);}catch(error){failures.push(error);}if(failures.length)throw new Error('CP23 owned child cleanup failed.'); }
  async function pauseTargets() { const refresh=createPublicDataRefreshStore(connection.database);for(const fixture of targets)if(fixture.target&&!fixture.target.paused){
    const configured=await refresh.configure({...fixture.target,paused:true});fixture.target={...fixture.target,paused:true,expectedRevision:configured.configurationRevision};} }
  async function guarded(index:number,body:()=>Promise<void>) {
    caseIndex=index;cases[index].state='running';cases[index].startedAt=new Date().toISOString();
    try {await body();cases[index].state='passed';}catch(error){cases[index].state='failed';if(index===4)for(const slot of fairnessSlots)if(slot.state==='running')slot.state='failed';throw error;}
    finally {try{try{await cleanupWorkers();}finally{vi.restoreAllMocks();await pauseTargets();}}
      catch(error){cases[index].state='failed';throw error;}finally{cases[index].endedAt=new Date().toISOString();}}
  }
  async function seedIdentity(fixture:Fixture,id:string) {
    await ownerQuery("INSERT INTO league_source_manager_accounts(provider,external_manager_id) VALUES('sleeper',$1) ON CONFLICT(provider,external_manager_id) DO NOTHING",[fixture.manager]);
    await ownerQuery(`INSERT INTO public_data_identity_observations(intake_id,source_manager_account_id,username,display_name,avatar_url,payload,request_started_at,request_completed_at)
      SELECT $1,id,$2,$2,NULL,$3::jsonb,clock_timestamp(),clock_timestamp() FROM league_source_manager_accounts WHERE provider='sleeper' AND external_manager_id=$4`,
      [id,fixture.username,JSON.stringify({user_id:fixture.manager,username:fixture.username,fixture:'CP23 disclosed identity prerequisite'}),fixture.manager]);
  }
  async function seedMetadata(fixture:Fixture,bootstrap=false) {
    await seedIdentity(fixture,fixture.requestId);
    await ownerQuery('INSERT INTO public_data_league_lists(intake_id,season,payload,request_started_at,request_completed_at) VALUES($1,2026,$2::jsonb,clock_timestamp(),clock_timestamp())',[fixture.requestId,JSON.stringify([fixture.league])]);
    if (bootstrap) {
      await ownerQuery("INSERT INTO public_data_league_candidates(intake_id,season,external_league_id,name,stage) VALUES($1,2026,$2,$3,'bootstrap')",[fixture.requestId,fixture.external,fixture.league.name]);
    } else {
      const registration=await createProjectionStore(connection.database).registerLeagueSeason({mode:'official-data',leagueKey:'sleeper-'+fixture.external,
        leagueName:fixture.league.name,season:2026,sleeperLeagueId:fixture.external});
      if(registration.kind!=='stored')throw new Error('CP23 canonical prerequisite missing.');
      await ownerQuery("INSERT INTO league_administration_enrollments(league_id,provider,active,evidence) VALUES($1,'sleeper',false,'CP23 disclosed prerequisite')",[registration.value.leagueId]);
      await ownerQuery("INSERT INTO league_administration_enrollment_seasons(league_id,season,provider,evidence) VALUES($1,2026,'sleeper','CP23 disclosed prerequisite')",[registration.value.leagueId]);
      await ownerQuery(`INSERT INTO public_data_league_candidates(intake_id,season,external_league_id,name,stage,league_season_id,bootstrap_payload,bootstrap_started_at,bootstrap_completed_at)
        VALUES($1,2026,$2,$3,'core',$4,$5::jsonb,clock_timestamp(),clock_timestamp())`,[fixture.requestId,fixture.external,fixture.league.name,registration.value.leagueSeasonId,JSON.stringify(fixture.league)]);
    }
    expect(await receiptRows(fixture.requestId)).toEqual([]);
    events.push({type:'disclosed-prerequisites',caseIndex,requestId:fixture.requestId,fixtureId:fixture.id,bootstrap,
      direct:['identity-observation','league-list',...(bootstrap?['bootstrap-pending-candidate']:['canonical-registration','inactive-enrollment','core-ready-candidate'])],acceptedReceiptCredit:0,ordinaryAdmissionCredit:0});
  }
  async function manualFixture(bootstrap=false):Promise<Fixture> {
    const fixture={...contentionFixture(randomUUID()),requestId:randomUUID()};
    await createPublicIntakeStore(connection.database).submit({id:fixture.requestId,username:fixture.username,seasons:[2026]});
    await seedMetadata(fixture,bootstrap);return fixture;
  }
  async function refreshFixtures(count:number):Promise<Fixture[]> {
    const refresh=createPublicDataRefreshStore(connection.database),jobs=createProjectionStore(connection.database),output:Fixture[]=[];
    for(let index=0;index<count;index++) {
      const fixture:Fixture={...contentionFixture(randomUUID()),requestId:randomUUID()};
      const identityId=randomUUID();await createPublicIntakeStore(connection.database).submit({id:identityId,username:fixture.username,seasons:[2026]});
      await seedIdentity(fixture,identityId);
      await ownerQuery('UPDATE public_data_intakes SET terminal=true WHERE id=$1',[identityId]);
      fixture.target={id:randomUUID(),identityRequestId:identityId,expectedRevision:0,seasons:[2026],cadenceSeconds:3600,expiresAt:new Date(Date.now()+3_600_000).toISOString(),paused:false};
      const configured=await refresh.configure(fixture.target);fixture.target={...fixture.target,expectedRevision:configured.configurationRevision};targets.push(fixture);
      let prepared=false;
      const start=Date.now();while(!prepared&&Date.now()-start<75_000) {
        const workerId=randomUUID();const claim=await jobs.acquireJob({jobKey:PUBLIC_INTAKE_JOB,jobType:PUBLIC_INTAKE_JOB,workerId,
          scheduledFor:new Date(Math.floor(Date.now()/60_000)*60_000).toISOString(),leaseSeconds:25,minimumIntervalSeconds:60,payload:{policy:'public-data-refresh-v1',mode:'recurring'}});
        if(claim.kind!=='acquired'){await delay(250);continue;}
        const fence={jobKey:PUBLIC_INTAKE_JOB,workerId,generation:claim.attempt,deadlineAt:new Date(Date.now()+20_000).toISOString()};
        try {const selected=await refresh.select(fence);expect(selected).toMatchObject({status:'selected',targetId:fixture.target.id});
          if(selected.status!=='selected')throw new Error('CP23 setup cycle missing.');fixture.requestId=selected.requestId;await seedMetadata(fixture);
          events.push({type:'disclosed-setup-selection',caseIndex,fixtureId:fixture.id,identityId,selection:selected,workerId,generation:claim.attempt,ordinaryClaimCredit:0,identityHeaderTerminalIsSynthetic:true});prepared=true;
        } finally {expect(await jobs.failJob(PUBLIC_INTAKE_JOB,workerId,'cp23-disclosed-setup-complete')).toBe(true);}
      }
      if(!prepared)throw new Error('CP23 prerequisite waited beyond original job cooldown allowance.');
      const paused=await refresh.configure({...fixture.target,paused:true});fixture.target={...fixture.target,expectedRevision:paused.configurationRevision,paused:true};output.push(fixture);
    }
    for(const fixture of output){const resumed=await refresh.configure({...fixture.target!,paused:false});fixture.target={...fixture.target!,expectedRevision:resumed.configurationRevision,paused:false};}
    expect(await query('SELECT last_served_at FROM public_data_refresh_targets WHERE id=ANY($1::uuid[])',[output.map(f=>f.target!.id)])).toEqual(output.map(()=>({last_served_at:null})));
    return output;
  }
  async function releaseAdmission(winner:Worker,contender?:Worker) {
    const admitted=await message(winner,'admitted');await message(winner,'barrier',10_000,'admitted');
    if(contender) {
      const loser=await message(contender,'result',10_000);expect(loser).toMatchObject({status:'busy',requests:0});
      expect(latest(contender,'attempt')).toBeTruthy();
      const [live]=await query('SELECT lease_owner,attempt_count,state,lease_until>clock_timestamp() AS live FROM projection_jobs WHERE job_key=$1',[PUBLIC_INTAKE_JOB]);
      expect(live).toEqual({lease_owner:admitted.workerId,attempt_count:admitted.generation,state:'running',live:true});
      events.push({type:'observed-competing-claim',caseIndex,at:new Date().toISOString(),winner:admitted,loser,live});
    }
    await control(winner,'release');return admitted;
  }
  async function round(workers:readonly Worker[]) {
    for(const worker of workers)await control(worker,'step');
    const released=new Set<Worker>();
    await until(async()=>{
      for(const worker of workers){if(worker.error)throw worker.error;if(worker.isClosed)throw new Error('CP23 process closed in round.');
        if(latest(worker,'barrier',worker.step,'admitted')&&!released.has(worker)) {
          const other=workers.find(value=>value!==worker);
          if(other&&!latest(other,'result'))continue;
          await releaseAdmission(worker,other);released.add(worker);
        }}
      return workers.every(worker=>!!latest(worker,'result'));
    },30_000,'CP23 competing round exceeded its original owner allowance.');
    return workers.map(worker=>latest(worker,'result')!);
  }
  async function progress(workers:readonly Worker[],milliseconds:number) {
    const deadline=Date.now()+milliseconds;
    while(Date.now()<deadline){const results=await round(workers);const admitted=results.find(result=>result.requests>0);
      if(admitted)return admitted;expect(results.every(result=>['busy','backoff'].includes(result.status!))).toBe(true);
      const [eligibility]=await query(`SELECT greatest(0,CASE WHEN state='completed' THEN greatest(
        extract(epoch FROM completed_at+interval '60 seconds'-clock_timestamp()),
        extract(epoch FROM date_trunc('minute',scheduled_for)+interval '60 seconds'-clock_timestamp()))
        WHEN state='running' THEN extract(epoch FROM lease_until-clock_timestamp()) ELSE 0 END) AS seconds
        FROM projection_jobs WHERE job_key=$1`,[PUBLIC_INTAKE_JOB]);
      await delay(Math.min(60_000,Math.max(250,Number(eligibility?.seconds??0)*1_000+25)));}
    throw new Error('CP23 bounded progress was not observed.');
  }
  async function readback(fixture:Fixture,users=false) {
    const noFetch=vi.spyOn(globalThis,'fetch').mockRejectedValue(new Error('CP23 stored reader attempted acquisition.'));
    try {const administration=createLeagueAdministrationStore(connection.database),read=await readPublicSleeperIntake(connection.database,administration,fixture.requestId);
      assertContentionReader(read,fixture,users);
      const mapping=await administration.readSourceMapping(fixture.external);if(!mapping)throw new Error('CP23 reader mapping absent.');
      const settings=await administration.readAcceptedLeagueSettings(mapping),players=await administration.readAcceptedCurrentRoster(mapping),managers=await administration.readAcceptedTeamManagers(mapping);
      if(settings.status!=='available'||players.status!=='available'||managers.status!=='available')throw new Error('CP23 typed readers unavailable.');
      expect(settings.value).toMatchObject({sourceLeague:{provider:'sleeper',nativeId:fixture.external},season:2026,sport:'nfl',name:{state:'known',value:fixture.league.name},teamCount:{state:'known',value:2},scoring:{rules:{state:'absent',value:null}},slots:{state:'absent',value:null}});
      expect(players.teams.map(team=>({id:team.externalRosterId,players:team.players}))).toEqual([{id:'1',players:[]},{id:'2',players:[]}]);
      expect(managers.teams).toHaveLength(2);expect(managers.teams[0]).toMatchObject({sourceTeam:{nativeId:'1'},primaryOwner:{state:'owned',manager:{sourceManager:{provider:'sleeper',nativeId:fixture.manager}}},coManagers:{state:'known',managers:[]}});
      expect(managers.teams[1]).toMatchObject({sourceTeam:{nativeId:'2'},primaryOwner:{state:'unowned',manager:null},coManagers:{state:'known',managers:[]}});
      const [stored]=await candidate(fixture.requestId);expect([settings.receipt.id,players.receipt.id,managers.receipt.id]).toEqual([stored.settings_receipt_id,stored.players_receipt_id,stored.managers_receipt_id]);
      if(users){expect(read).toMatchObject({status:'available',leagues:[{resources:{managerDirectory:{status:'available',managers:[{sourceManager:{provider:'sleeper',nativeId:fixture.manager},displayName:fixture.username}]}}}]});}
      if(fixture.target){const refresh=await readPublicDataRefresh(connection.database,administration,fixture.target.id);expect(refresh).toMatchObject({status:'available',cycle:{requestId:fixture.requestId}});}
      expect(noFetch).not.toHaveBeenCalled();const verifiedAt=new Date().toISOString();cases[caseIndex].evidence.push({type:'stored-readback',fixtureId:fixture.id,requestId:fixture.requestId,users,verifiedAt,readerDigest:digest(read),receiptIds:[settings.receipt.id,players.receipt.id,managers.receipt.id]});return verifiedAt;
    }finally{noFetch.mockRestore();}
  }
  async function assertRecovery(fixture:Fixture,original:ContentionMessage) {
    const rows=await dispatches(fixture.requestId);expect(rows).toHaveLength(1);expect(rows[0]).toMatchObject({worker_id:original.workerId,generation:original.generation,outcome:'recovered'});
    expect((await state(fixture.requestId))[0]).toMatchObject({revision:1,failure_count:1,terminal:false});
    expect(await receiptRows(fixture.requestId)).toEqual([]);
    cases[caseIndex].evidence.push({type:'ordinary-recovery',requestId:fixture.requestId,dispatch:rows[0],state:await state(fixture.requestId)});
  }
  beforeAll(async()=>{const selected=qualificationBinding();if(!selected||selected.context.profile!=='data-competing-workers-v1')throw new Error('CP23 requires its guarded closed profile.');binding=selected;
    await assertCompetingWorkersSupportSources(siteRoot);connection=createIndependentDatabase();expect((await query('SELECT current_user,session_user'))[0]).toEqual({current_user:'league_one_runtime',session_user:'league_one_runtime'});
    const [server]=await query("SELECT current_setting('server_version') AS version,current_setting('server_version_num') AS version_num");
    expect(server.version).toEqual(expect.any(String));expect(String(server.version_num)).toMatch(/^[0-9]{5,6}$/u);
    events.push({type:'database-version-before-launch',at:new Date().toISOString(),server});
  },90_000);
  afterAll(async()=>{let cleanupFailure=false,aggregateFailure=false;let durable:readonly DatabaseRow[]=[];
    const counts=()=>({claims:allWorkers.reduce((n,w)=>n+w.messages.filter(m=>m.type==='claim').length,0),attempts:allWorkers.reduce((n,w)=>n+w.messages.filter(m=>m.type==='attempt').length,0),
      admissions:allWorkers.reduce((n,w)=>n+w.messages.filter(m=>m.type==='admitted').length,0),gets:allWorkers.reduce((n,w)=>n+[...new Set(w.messages.map(m=>m.step))].reduce((sum,step)=>sum+Math.max(0,...w.messages.filter(m=>m.step===step).map(m=>m.requests)),0),0)});
    try{try{await cleanupWorkers();}catch{cleanupFailure=true;}
      const observed=counts();
      try{if(connection){const owners=allWorkers.flatMap(w=>w.messages.filter(m=>m.type==='claim').map(m=>m.workerId!));
        durable=await query('SELECT worker_id,generation,intake_id,resource,admitted_at::text FROM public_data_dispatches WHERE worker_id=ANY($1::text[]) ORDER BY admitted_at',[owners]);}
        if(cases.every(value=>value.state==='passed')){expect(observed.admissions).toBe(12);expect(observed.gets).toBe(21);expect(observed.claims).toBeGreaterThanOrEqual(15);expect(durable).toHaveLength(12);
          const key=(value:{workerId:unknown;generation:unknown})=>String(value.workerId)+':'+String(value.generation);
          const admitted=allWorkers.flatMap(w=>w.messages.filter(m=>m.type==='admitted').map(m=>({workerId:m.workerId,generation:m.generation,requestId:m.requestId,resource:m.resource}))).sort((a,b)=>key(a).localeCompare(key(b)));
          const persisted=durable.map(row=>({workerId:row.worker_id,generation:Number(row.generation),requestId:row.intake_id,resource:row.resource})).sort((a,b)=>key(a).localeCompare(key(b)));
          expect(persisted).toEqual(admitted);
        }
      }catch{aggregateFailure=true;}
      finally{const serialized=JSON.stringify({kind:CONTENTION_VERSION,context:binding?.context??null,cases,fairnessSlots,events,cleanupFailure,aggregateFailure,
        planned:{admissions:12,gets:21,minimumOrdinaryClaims:15},observed,durableDispatches:durable,targets:targets.map(f=>({fixtureId:f.id,requestId:f.requestId,configuration:f.target})),
        getAccounting:'Maximum observed requests per worker step; an incomplete step is a lower bound, never a zero-request assertion.',
        incompleteSteps:allWorkers.flatMap(w=>[...new Set(w.messages.filter(m=>m.type==='attempt').map(m=>m.step))].filter(step=>!w.messages.some(m=>m.type==='result'&&m.step===step)).map(step=>({nonce:w.config.nonce,step}))),
        workers:allWorkers.map(w=>({config:w.config,pid:w.child.pid,exitCode:w.exitCode,isClosed:w.isClosed,protocolFailed:!!w.error,messages:w.messages}))},null,2)+'\n';
        if(Buffer.byteLength(serialized,'utf8')>8*1024*1024)throw new Error('CP23 evidence artifact budget exceeded.');
        if(binding)await writeFile(join(binding.directory,'competing-workers-evidence.json'),serialized,{encoding:'utf8',flag:'wx',mode:0o600});
      }
      if(cleanupFailure||aggregateFailure)throw new Error('CP23 cleanup or aggregate reconciliation failed.');
    }finally{await connection?.close();vi.restoreAllMocks();}},90_000);

  it('admits and accepts one core capture while independent worker processes compete for the same job',()=>guarded(0,async()=>{
    const fixture=await manualFixture();const workers=[await launch([fixture],fixture.requestId),await launch([fixture],fixture.requestId)];await overlap(workers);
    const result=await progress(workers,120_000);expect(result).toMatchObject({status:'progress',resource:'core',requests:2});
    expect(await dispatches(fixture.requestId)).toHaveLength(1);expect(await receiptRows(fixture.requestId)).toHaveLength(3);await readback(fixture);
    for(const worker of workers)await close(worker);
  }),180_000);
  it('rejects the original owner after real fence expiry and lease takeover while a healthy worker accepts',()=>guarded(1,async()=>{
    const abandoned=await manualFixture(),[healthy]=await refreshFixtures(1);
    const old=await launch([abandoned],abandoned.requestId,'stale-core'),fresh=await launch([healthy],null,'hold-selected');await overlap([old,fresh]);
    // Start the declared stale subject first; a live contender must independently
    // attempt and lose before its acquisition proceeds. No target is sent by IPC.
    let admitted:ContentionMessage|undefined;const deadline=Date.now()+80_000;
    while(!admitted&&Date.now()<deadline){await control(old,'step');await until(async()=>!!latest(old,'admitted')||!!latest(old,'result'),15_000,'CP23 old claim missing.');
      if(latest(old,'admitted')){await control(fresh,'step');admitted=await releaseAdmission(old,fresh);}else{expect((await message(old,'result')).requests).toBe(0);await delay(500);}}
    if(!admitted)throw new Error('CP23 stale subject admission absent.');await message(old,'barrier',15_000,'captured-core');
    expect(await receiptRows(abandoned.requestId)).toEqual([]);
    await until(async()=> (await query('SELECT lease_until<clock_timestamp() AS expired FROM projection_jobs WHERE job_key=$1',[PUBLIC_INTAKE_JOB]))[0].expired===true,30_000,'CP23 natural lease did not expire.');
    await control(fresh,'step');const takeover=await message(fresh,'barrier',15_000,'selected');
    expect(takeover.generation).toBeGreaterThan(admitted.generation!);expect(takeover.workerId).not.toBe(admitted.workerId);expect(Date.parse(takeover.at)).toBeGreaterThan(Date.parse(admitted.deadlineAt!));
    const before={state:await state(abandoned.requestId),candidate:await candidate(abandoned.requestId),receipts:await receiptRows(abandoned.requestId),dispatches:await dispatches(abandoned.requestId),job:await query('SELECT * FROM projection_jobs WHERE job_key=$1',[PUBLIC_INTAKE_JOB])};
    await control(old,'release');const probes=await message(old,'probes');expect(probes.rejected).toEqual(STALE_PROBES);await message(old,'cleanup');expect(await message(old,'result')).toMatchObject({status:'unavailable',requests:2});
    expect({state:await state(abandoned.requestId),candidate:await candidate(abandoned.requestId),receipts:await receiptRows(abandoned.requestId),dispatches:await dispatches(abandoned.requestId),job:await query('SELECT * FROM projection_jobs WHERE job_key=$1',[PUBLIC_INTAKE_JOB])}).toEqual(before);
    cases[1].evidence.push({type:'stale-fence-rejected',original:admitted,takeover,probes,beforeAfterDigest:digest(before),negativeOnlyTransactionWrapper:true});
    await control(fresh,'release');expect(await message(fresh,'result')).toMatchObject({status:'backoff',requests:0});
    expect(await progress([fresh],100_000)).toMatchObject({status:'progress',resource:'core',requests:2});await assertRecovery(abandoned,admitted);await readback(healthy);await close(old);await close(fresh);
  }),210_000);
  it('rolls back fenced bootstrap registration after an observed lock wait and preserves healthy worker progress',()=>guarded(2,async()=>{
    const abandoned=await manualFixture(true),healthy=await manualFixture(),blocker=await createPinnedIntegrationDatabase('owner');let transaction=false;
    try{const old=await launch([abandoned],abandoned.requestId,'bootstrap-lock'),fresh=await launch([healthy],healthy.requestId);await overlap([old,fresh]);
      const [blocking]=await blocker.database.query('SELECT pg_backend_pid() AS pid');await blocker.database.query('BEGIN');transaction=true;
      await blocker.database.query('INSERT INTO leagues(league_key,name) VALUES($1,$2)',['sleeper-'+abandoned.external,'CP23 uncommitted blocker']);
      let admitted:ContentionMessage|undefined;const deadline=Date.now()+90_000;
      while(!admitted&&Date.now()<deadline){await control(old,'step');await until(async()=>!!latest(old,'admitted')||!!latest(old,'result'),15_000,'CP23 bootstrap claim missing.');
        if(latest(old,'admitted')){await control(fresh,'step');admitted=await releaseAdmission(old,fresh);}else{await message(old,'result');await delay(500);}}
      if(!admitted)throw new Error('CP23 bootstrap admission absent.');
      await until(async()=> (await ownerQuery('SELECT $2::integer=ANY(pg_blocking_pids($1::integer)) AS blocked',[old.ready!.backendPid,blocking.pid]))[0].blocked===true,8_000,'CP23 real canonical identity lock not observed.');
      await delay(Math.max(0,Date.parse(admitted.deadlineAt!)-Date.now())+150);await blocker.database.query('ROLLBACK');transaction=false;
      const rolledBack=await message(old,'barrier',12_000,'rolled-back');await message(old,'cleanup');expect(await message(old,'result')).toMatchObject({status:'unavailable',requests:1});
      expect(await query('SELECT id FROM leagues WHERE league_key=$1',['sleeper-'+abandoned.external])).toEqual([]);
      expect(await query('SELECT * FROM public_data_collection_reservations WHERE external_league_id=$1',[abandoned.external])).toEqual([]);
      expect((await candidate(abandoned.requestId))[0]).toMatchObject({stage:'bootstrap',league_season_id:null,bootstrap_payload:null});
      cases[2].evidence.push({type:'observed-lock-and-rollback',admitted,rolledBack,blockerPid:blocking.pid,originalDeadline:admitted.deadlineAt});
      expect(await progress([fresh],110_000)).toMatchObject({status:'progress',resource:'core',requests:2});await assertRecovery(abandoned,admitted);await readback(healthy);await close(old);await close(fresh);
    }finally{try{if(transaction){await cleanupWorkers();await blocker.database.query('ROLLBACK');}}finally{await blocker.close();}}
  }),240_000);
  it('isolates a pre-admission selection failure while another target acquires and accepts official data',()=>guarded(3,async()=>{
    const [failed,healthy]=await refreshFixtures(2);const workers=[await launch([failed,healthy],null,'selection-failure',failed.id),await launch([failed,healthy],null,'selection-failure',failed.id)];await overlap(workers);
    await control(workers[0],'step');expect(await message(workers[0],'result')).toMatchObject({status:'unavailable',requests:0});
    const deadline=Date.now()+140_000;let success:ContentionMessage|undefined;
    while(!success&&Date.now()<deadline){const results=await round(workers);success=results.find(result=>result.status==='progress');
      expect(results.every(result=>['busy','backoff','unavailable','progress'].includes(result.status!))).toBe(true);if(!success)await delay(500);}
    expect(success).toMatchObject({status:'progress',resource:'core',requestId:healthy.requestId,requests:2});
    const failures=await query('SELECT * FROM public_data_refresh_selection_failures WHERE target_id=$1',[failed.target!.id]);expect(failures).toHaveLength(1);
    expect(await dispatches(failed.requestId)).toEqual([]);expect(await receiptRows(failed.requestId)).toEqual([]);
    expect((await query('SELECT last_served_at,selection_failure_count FROM public_data_refresh_targets WHERE id=$1',[failed.target!.id]))[0]).toEqual({last_served_at:null,selection_failure_count:1});
    expect(await dispatches(healthy.requestId)).toHaveLength(1);await readback(healthy);cases[3].evidence.push({type:'pre-admission-failure-isolated',failures,failedRequest:failed.requestId,healthyRequest:healthy.requestId});for(const worker of workers)await close(worker);
  }),210_000);
  it('bounds per-target accepted progress across repeated competing-worker rounds with a failing target',()=>guarded(4,async()=>{
    const fixtures=await refreshFixtures(3),[failed,a,b]=fixtures;const observations:FairnessObservation[]=[];
    const epoch=new Date().toISOString();cases[4].evidence.push({type:'frozen-fairness-denominator',epoch,order:['F','A','B','F','A','B'],healthyBoundsMs:[180000,240000,360000,420000],revisitMs:240000,firstToSixthAdmissionMs:420000,fixtureIds:fixtures.map(f=>f.id),observations});
    const workers=[await launch(fixtures,null,'normal',failed.id),await launch(fixtures,null,'normal',failed.id)];await overlap(workers);
    let retainedFailed:readonly DatabaseRow[]=[];
    for(let index=0;index<6;index++){
      fairnessSlots[index].state='running';
      const result=await progress(workers,Math.max(1,Date.parse(epoch)+435_000-Date.now()));
      const fixture=fixtures.find(value=>value.requestId===result.requestId);if(!fixture)throw new Error('CP23 admitted an unserved/foreign target.');
      const label=fixture===failed?'F':fixture===a?'A':'B';
      const dispatch=(await dispatches(fixture.requestId)).find(row=>row.worker_id===result.workerId&&Number(row.generation)===result.generation);if(!dispatch)throw new Error('CP23 actual dispatch absent.');
      const receipts=await receiptRows(fixture.requestId);const freshReceipts=receipts.filter(row=>(row.receipt as {provenance:{acquisition:{fence:{workerId:string;generation:number}}}}).provenance.acquisition.fence.workerId===result.workerId);
      let acceptedAt:string|null=null,readerVerifiedAt:string|null=null,receiptCount=freshReceipts.length;
      if(label==='F'){
        expect(result).toMatchObject({status:'unavailable',resource:'core',requests:2});expect(freshReceipts).toHaveLength(1);
        expect(freshReceipts[0].accepted_at).toEqual(expect.any(String));expect(freshReceipts[0].acceptance).toMatchObject({receipt_id:freshReceipts[0].id});
        expect(freshReceipts[0].identity).toMatchObject({policy:{canonicalNormalizerVersion:'sleeper-league-settings-v1'}});
        expect(freshReceipts[0].receipt).toMatchObject({provenance:{acquisition:{work:{requestId:fixture.requestId,kind:'core'},fence:{workerId:result.workerId,generation:result.generation}}}});
        for(const retained of retainedFailed)expect(receipts.find(row=>row.id===retained.id)).toEqual(retained);
        if(retainedFailed.length)expect(freshReceipts[0].content_id).toBe(retainedFailed[0].content_id);retainedFailed=receipts;
        expect((await candidate(fixture.requestId))[0]).toMatchObject({stage:'core',settings_receipt_id:null,players_receipt_id:null,managers_receipt_id:null});
        expect((await state(fixture.requestId))[0]).toMatchObject({failure_count:index===0?1:2,terminal:false});
      }else{
        expect(result.status).toBe('progress');readerVerifiedAt=await readback(fixture,result.resource==='users');
        if(result.resource==='core'){expect(freshReceipts).toHaveLength(3);acceptedAt=new Date(Math.max(...freshReceipts.map(row=>Date.parse(String(row.accepted_at))))).toISOString();}
        else{const captures=await query('SELECT recorded_at::text FROM public_data_directory_captures WHERE worker_id=$1 AND generation=$2',[result.workerId,result.generation]);expect(captures).toHaveLength(1);acceptedAt=new Date(String(captures[0].recorded_at)).toISOString();receiptCount=1;}
      }
      observations.push({target:label,resource:result.resource as 'core'|'users',admittedAt:String(dispatch.admitted_time),acceptedAt,readerVerifiedAt,requests:result.requests,status:result.status!,receiptCount});
      fairnessSlots[index].observation=observations[index];fairnessSlots[index].state='observed';
      cases[4].evidence.push({type:'fairness-dispatch',index,result,dispatch,receiptDigest:digest(receipts),newReceiptIds:freshReceipts.map(row=>row.id),state:await state(fixture.requestId)});
    }
    assertFairness(observations,epoch);for(const slot of fairnessSlots)slot.state='passed';expect((await dispatches(failed.requestId))).toHaveLength(2);expect((await dispatches(a.requestId))).toHaveLength(2);expect((await dispatches(b.requestId))).toHaveLength(2);
    for(const worker of workers)await close(worker);
  }),540_000);
});
