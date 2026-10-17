import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import type { RosterMembership } from '../lib/aggregator/contracts';
import type { ChildProcess } from 'node:child_process';
import { afterAll,beforeAll,describe,expect,it } from 'vitest';
import { createLeagueAdministrationStore } from '../lib/league-administration/store';
import { readPublicSleeperIntake } from '../lib/league-administration/public-intake-reader';
import { createIndependentDatabase,integrationEnvironment,ownerQuery,type IndependentDatabase } from './neon-integration-harness';
import { spawnIntegrationWorker,stopIntegrationChildTree,verifyIntegrationChildTreeClosed } from './integration-child-process';
import { qualificationBinding,qualificationDigest,assertBatchCalibrationSupportSources,type QualificationBinding } from './qualification-profile';
import { runnerSnapshotQuery,runnerTimestamp } from './runner-cycles-protocol';
import { BATCH_VERSION,batchFixture,batchEnvironment,parseBatchMessage,batchStart,batchEnd,
  type BatchAction,type BatchConfig,type BatchMessage } from './batch-calibration-protocol';
import { expectedBatchCore,type BatchCoreValues,BATCH_CASE_NAMES,BATCH_CASE_LIMITS,BATCH_LIMITATIONS,writeBatchCalibrationEvidence,assertCompleteBatchCalibrationEvidence,
  type BatchCalibrationEvidence } from './batch-calibration-evidence';

/** Intentionally tests ONE enabled invocation. Failure is retained, never retried.
 * This is not a sustained CP26 profile or a production projection-facade proof. */
describe.sequential('four fresh leagues through one ordinary bounded DATA batch',()=>{
  const siteRoot=fileURLToPath(new URL('..',import.meta.url)),fixtureId=randomUUID(),requestId=randomUUID(),fixture=batchFixture(fixtureId);
  let binding:QualificationBinding,connection:IndependentDatabase,child:ChildProcess,config:BatchConfig,evidence:BatchCalibrationEvidence;
  let closed=false,childFailure=false,sequence=0,childClosed:Promise<void>,originalFetch:typeof fetch;
  const messages:BatchMessage[]=[];
  const query=(sql:string,args:readonly unknown[]=[])=>connection.database.query(sql,args);
  async function waitUntil(check:()=>Promise<boolean>|boolean,limit:number){const end=Date.now()+limit;
    while(!await check()){if(Date.now()>=end)throw new Error('CP26 bounded observation timed out.');await delay(25);}}
  async function snapshot(protectedOnly=false){const catalogue=await ownerQuery(`SELECT schemaname,tablename FROM pg_tables WHERE schemaname IN('public','website_auth') ORDER BY schemaname,tablename`);
    const selection=runnerSnapshotQuery(catalogue.map(row=>({schemaname:String(row.schemaname),tablename:String(row.tablename)})),protectedOnly);
    return qualificationDigest(await ownerQuery(selection.sql,selection.parameters));}
  async function history(){const result:Record<string,unknown>={};
    for(const table of ['public_data_intakes','public_data_identity_observations','public_data_league_lists','public_data_league_candidates',
      'public_data_directory_captures','public_data_exact_period_tasks','public_data_exact_period_checkpoints','public_data_dispatches']){
      result[table]=await query(`SELECT to_jsonb(t) AS row FROM public.${table} t WHERE ${table==='public_data_intakes'?'id':'intake_id'}=$1 ORDER BY to_jsonb(t)::text`,[requestId]);}
    result.receipts=await query(`SELECT to_jsonb(r) AS receipt,to_jsonb(a) AS acceptance,to_jsonb(c) AS content
      FROM public.league_roster_capture_receipts r JOIN public.league_administration_contents c ON c.id=r.content_id
      JOIN public.league_roster_resource_acceptances a ON a.receipt_id=r.id
      WHERE r.provenance->'acquisition'->'work'->>'requestId'=$1 ORDER BY r.id`,[requestId]);
    return qualificationDigest(result);}
  async function command(action:BatchAction){const ordinal=++sequence;
    await new Promise<void>((resolve,reject)=>child.send({version:BATCH_VERSION,nonce:config.nonce,sequence:ordinal,action},error=>error?reject(new Error('CP26 child command failed.')):resolve()));
    if(action==='stop')return;
    await waitUntil(()=>{if(childFailure||closed)throw new Error('CP26 child evidence unavailable.');return messages.some(row=>row.sequence===ordinal);},30_000);
    const result=messages.find(row=>row.sequence===ordinal)!;evidence.calls.push(result);return result;}
  async function guarded(index:number,body:()=>Promise<void>){const start=batchStart();evidence.cases[index].state='running';
    try{await body();evidence.cases[index].state='passed';}catch(error){evidence.cases[index].state='failed';throw error;}
    finally{evidence.cases[index].span=batchEnd(start);}}
  beforeAll(async()=>{
    const selected=qualificationBinding();if(selected?.context.profile!=='data-batch-calibration-v1')throw new Error('CP26 requires its closed guarded profile.');binding=selected;
    await assertBatchCalibrationSupportSources(siteRoot);connection=createIndependentDatabase();originalFetch=globalThis.fetch;
    const env=integrationEnvironment();config={nonce:randomUUID(),fixtureId,requestId,contextNonce:binding.context.nonce,gitSha:binding.context.gitSha,
      profileDigest:binding.context.profileDigest,expectedDatabase:env.expectedDatabase,expectedBranch:env.expectedBranchId};
    const [identity]=await query(`SELECT current_user,session_user,current_database() AS database,current_setting('neon.branch_id',true) AS branch,
      current_setting('server_version') AS version,current_setting('server_version_num') AS version_num`);
    expect(identity.current_user).toBe('league_one_runtime');expect(identity.session_user).toBe('league_one_runtime');
    expect(identity.database).toBe(env.expectedDatabase);expect(identity.branch).toBe(env.expectedBranchId);
    evidence={kind:'data-batch-calibration-evidence-v1',contextDigest:qualificationDigest(binding.context),gitSha:binding.context.gitSha,config,ready:null,
      serverVersion:String(identity.version),serverVersionNum:String(identity.version_num),calls:[],cases:BATCH_CASE_NAMES.map((name,index)=>({name,limitMs:BATCH_CASE_LIMITS[index],state:'unserved',span:null})),
      dispatches:[],heads:[],receipts:[],directories:[],readerSpan:null,readerRequests:0,historyBefore:null,historyAfter:null,protectedBefore:null,protectedAfter:null,
      disabledBefore:null,disabledAfter:null,storedBefore:null,storedAfter:null,terminal:false,finalGeneration:0,finalJobState:'unobserved',cleanupComplete:false,
      source:'synthetic-native-fetch',scope:'single-batch-calibration-only',limitations:BATCH_LIMITATIONS};
    expect(await query('SELECT 1 FROM public.public_data_intakes')).toEqual([]);expect(await query('SELECT 1 FROM public.projection_jobs')).toEqual([]);
    child=spawnIntegrationWorker(process.execPath,['--conditions=react-server','--import=tsx',fileURLToPath(new URL('./batch-calibration-worker.ts',import.meta.url))],
      {cwd:siteRoot,env:batchEnvironment(process.env,env.runtimeDatabaseUrl,config),stdio:['ignore','ignore','ignore','ipc']});
    childClosed=new Promise<void>(resolve=>child.once('close',()=>{closed=true;resolve();}));child.on('error',()=>{childFailure=true;});
    child.on('message',value=>{try{messages.push(parseBatchMessage(value,config,child.pid!));}catch{childFailure=true;}});
    await waitUntil(()=>{if(childFailure||closed)throw new Error('CP26 worker not ready.');return messages.some(row=>row.type==='ready');},20_000);
    evidence.ready=messages.find(row=>row.type==='ready')!;
    const [backend]=await ownerQuery('SELECT usename,datname,backend_start::text FROM pg_stat_activity WHERE pid=$1',[evidence.ready.backendPid]);
    expect(backend.usename).toBe('league_one_runtime');expect(backend.datname).toBe(env.expectedDatabase);expect(backend.backend_start).toBe(evidence.ready.backendStart);
    globalThis.fetch=async()=>{evidence.readerRequests++;throw new Error('CP26 parent stored reader attempted source HTTP.');};
  },60_000);
  afterAll(async()=>{
    let cleanup=true;
    try{
      if(child&&!closed){if(sequence===4&&!childFailure)await command('stop');else await stopIntegrationChildTree(child,child.pid);}
      if(child){await Promise.race([childClosed,delay(12_000).then(()=>{throw new Error('CP26 child closure timed out.');})]);await verifyIntegrationChildTreeClosed(child);}
      if(evidence?.ready)await waitUntil(async()=>{const [row]=await ownerQuery(`SELECT NOT EXISTS(SELECT 1 FROM pg_stat_activity WHERE pid=$1 AND backend_start=$2::timestamptz)
        AND NOT EXISTS(SELECT 1 FROM pg_locks WHERE pid=$1) AS gone`,[evidence.ready!.backendPid,evidence.ready!.backendStart]);return row.gone===true;},12_000);
    }catch{cleanup=false;}
    try{if(connection)await connection.close();}catch{cleanup=false;}
    if(originalFetch)globalThis.fetch=originalFetch;
    if(evidence&&binding){evidence.cleanupComplete=cleanup;await writeBatchCalibrationEvidence(binding,evidence);
      if(evidence.cases.every(row=>row.state==='passed'))assertCompleteBatchCalibrationEvidence(evidence,binding);}
    expect(cleanup).toBe(true);
  },60_000);
  it('keeps omitted and false batch selections free of DATA writes and acquisition',()=>guarded(0,async()=>{
    evidence.disabledBefore=await snapshot();
    for(const action of ['omitted','false'] as const){const result=await command(action);expect(result?.error).toBe(false);
      expect(result?.result).toEqual({status:'disabled',providerRequests:0});expect(result?.attempts).toEqual([]);expect(result?.owners).toEqual([]);}
    evidence.disabledAfter=await snapshot();expect(evidence.disabledAfter).toBe(evidence.disabledBefore);
  }),60_000);
  it('completes four fresh leagues in one bounded ordinary backend batch',()=>guarded(1,async()=>{
    evidence.protectedBefore=await snapshot(true);const submitted=await command('submit');
    expect(submitted?.error).toBe(false);expect(submitted?.result).toEqual({status:'retained',requestId});
    const result=await command('enabled');
    const rows=await query(`SELECT d.worker_id,d.generation,d.resource,d.work,d.max_requests,d.admitted_at,o.outcome,o.recorded_at,
      o.capture_acquisition->'fence'->>'deadlineAt' AS deadline_at FROM public.public_data_dispatches d
      LEFT JOIN public.public_data_dispatch_outcomes o USING(worker_id,generation) WHERE d.intake_id=$1 ORDER BY d.generation`,[requestId]);
    evidence.dispatches=rows.map(row=>({workerId:String(row.worker_id),generation:Number(row.generation),resource:String(row.resource),
      leagueId:typeof (row.work as Record<string,unknown>)?.externalLeagueId==='string'?String((row.work as Record<string,unknown>).externalLeagueId):null,
      work:row.work as Record<string,unknown>,maxRequests:Number(row.max_requests),admittedAt:runnerTimestamp(row.admitted_at),outcomeAt:runnerTimestamp(row.recorded_at),
      deadlineAt:runnerTimestamp(row.deadline_at),outcome:String(row.outcome)}));
    const [job]=await query('SELECT state,attempt_count FROM public.projection_jobs WHERE job_key=$1',['league-administration-public-intake']);
    const [request]=await query('SELECT terminal FROM public.public_data_intakes WHERE id=$1',[requestId]);
    evidence.finalGeneration=Number(job?.attempt_count??0);evidence.finalJobState=String(job?.state??'missing');evidence.terminal=request?.terminal===true;
    expect(result?.error).toBe(false);expect(result?.result).toEqual({status:'complete',providerRequests:26,completedSteps:18,stopReason:'work-status'});
    expect(evidence.dispatches).toHaveLength(18);expect(result?.owners).toHaveLength(19);expect(evidence.terminal).toBe(true);
    evidence.historyBefore=await history();
  }),90_000);
  it('retains exact source receipt and stored reader parity without protected mutation',()=>guarded(2,async()=>{
    evidence.storedBefore=await snapshot();const start=batchStart();
    const read=await readPublicSleeperIntake(connection.database,createLeagueAdministrationStore(connection.database),requestId,
      {managerEvidenceVersion:'v2',exactMatchupValuesVersion:'v1'});evidence.readerSpan=batchEnd(start);
    expect(read).toMatchObject({status:'available',request:{terminal:true}});if(read.status==='missing')throw new Error('CP26 stored reader missing.');
    expect(read.leagues).toHaveLength(4);expect(read.exactPeriods).toHaveLength(4);
    const candidates=await query(`SELECT candidate.*,capture.id AS capture_id FROM public.public_data_league_candidates candidate
      JOIN public.public_data_directory_captures capture ON capture.intake_id=candidate.intake_id AND capture.league_season_id=candidate.league_season_id
      WHERE candidate.intake_id=$1 ORDER BY candidate.season,candidate.external_league_id`,[requestId]);expect(candidates).toHaveLength(4);
    for(const [index,fixtureLeague] of fixture.leagues.entries()){
      const league=read.leagues.find(row=>row.externalLeagueId===fixtureLeague.external),period=read.exactPeriods?.find(row=>row.externalLeagueId===fixtureLeague.external);
      expect(league).toMatchObject({collection:'complete',resources:{settings:{status:'available'},heldRoster:{status:'available'},teamManagers:{status:'available'},directory:{status:'available'}}});
      const exact=period?.exactMatchupValues;if(!exact||exact.status!=='available')throw new Error('CP26 typed exact reader unavailable.');
      expect(period?.resource.status).toBe('available');const team=exact.value.teams.find(row=>row.externalRosterId==='1');
      expect(team?.effectivePoints).toEqual({value:String(index+0.25),source:'raw'});expect(team?.starters).toEqual({state:'supplied',value:[fixtureLeague.player]});
      const resources=league&&'resources' in league?league.resources:null;
      if(!resources||resources.heldRoster.status!=='available'||resources.teamManagers.status!=='available'
        ||resources.managerDirectory?.status!=='available')throw new Error('CP26 typed core reader unavailable.');
      const member=(row:RosterMembership)=>({playerId:row.sourceEntity.nativeId,section:row.section,nativeSection:row.nativeSection});
      const core:BatchCoreValues={rosters:resources.heldRoster.teams.map(row=>({rosterId:row.externalRosterId,players:row.players.map(member),
        starters:row.currentGroups.starters.value?.map(slot=>({index:slot.index,nativeId:slot.nativePlayerId,empty:slot.empty,membership:slot.membership?member(slot.membership):null}))??null,
        reserve:row.currentGroups.reserve.value?.map(member)??null,taxi:row.currentGroups.taxi.value?.map(member)??null,bench:row.currentGroups.bench.value?.map(member)??null
      })).sort((left,right)=>left.rosterId.localeCompare(right.rosterId)),managers:resources.teamManagers.teams.map(row=>({rosterId:row.sourceTeam.nativeId,
        primaryState:row.primaryOwner.state,primaryId:row.primaryOwner.manager?.sourceManager.nativeId??null,coState:row.coManagers.state,
        coIds:row.coManagers.managers?.map(manager=>manager.sourceManager.nativeId)??null})).sort((left,right)=>left.rosterId.localeCompare(right.rosterId)),
        directory:resources.managerDirectory.managers.map(row=>({managerId:row.sourceManager.nativeId,displayName:row.displayName,username:row.username})).sort((left,right)=>left.managerId.localeCompare(right.managerId))};
      expect(core).toEqual(expectedBatchCore(fixture.manager,fixture.username,fixtureLeague.player));
      const candidate=candidates.find(row=>row.external_league_id===fixtureLeague.external)!;
      evidence.heads.push({leagueId:fixtureLeague.external,leagueSeasonId:String(candidate.league_season_id),settingsReceipt:String(candidate.settings_receipt_id),
        rosterReceipt:String(candidate.players_receipt_id),managersReceipt:String(candidate.managers_receipt_id),directoryCapture:String(candidate.capture_id),
        exactReceipt:exact.matchupsReceiptId,core,readerDigest:qualificationDigest({league,period}),points:team!.effectivePoints.value!,starters:team!.starters.state==='supplied'?[...team!.starters.value]:[]});
      const contents=await query(`SELECT family,payload FROM public.league_administration_contents WHERE external_league_id=$1 AND accepted ORDER BY family`,[fixtureLeague.external]);
      expect(contents).toHaveLength(4);for(const content of contents){const suffix=content.family==='league'?'':content.family==='matchups'?'/matchups/1':'/'+content.family;
        expect(content.payload).toEqual(fixture.payloads.get('/v1/league/'+fixtureLeague.external+suffix));}
    }
    const receipts=await query(`SELECT r.id,r.content_id,c.external_league_id,c.family,c.payload,r.provenance->'acquisition'->'work' AS work,
      r.provenance->'acquisition'->'fence'->>'workerId' AS worker_id,r.provenance->'acquisition'->'fence'->>'generation' AS generation
      FROM public.league_roster_capture_receipts r JOIN public.league_administration_contents c ON c.id=r.content_id
      JOIN public.league_roster_resource_acceptances a ON a.receipt_id=r.id
      WHERE r.provenance->'acquisition'->'work'->>'requestId'=$1 ORDER BY r.id`,[requestId]);
    evidence.receipts=receipts.map(row=>({id:String(row.id),contentId:String(row.content_id),leagueId:String(row.external_league_id),family:String(row.family),
      workerId:String(row.worker_id),generation:Number(row.generation),work:row.work as Record<string,unknown>,payload:row.payload}));
    const directories=await query(`SELECT d.id,d.worker_id,d.generation,c.external_league_id,c.payload FROM public.public_data_directory_captures d
      JOIN public.league_administration_contents c ON c.id=d.content_id WHERE d.intake_id=$1 ORDER BY d.id`,[requestId]);
    evidence.directories=directories.map(row=>({id:String(row.id),leagueId:String(row.external_league_id),workerId:String(row.worker_id),generation:Number(row.generation),payload:row.payload}));
    evidence.historyAfter=await history();evidence.protectedAfter=await snapshot(true);evidence.storedAfter=await snapshot();
    expect(evidence.historyAfter).toBe(evidence.historyBefore);expect(evidence.protectedAfter).toBe(evidence.protectedBefore);
    expect(evidence.storedAfter).toBe(evidence.storedBefore);expect(evidence.readerRequests).toBe(0);
  }),60_000);
});
