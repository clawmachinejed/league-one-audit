import { randomUUID } from 'node:crypto';
import { setTimeout as waitForRealClock } from 'node:timers/promises';
import { beforeAll, describe, expect, it } from 'vitest';
import { ownerQuery } from './neon-integration-harness';
import { createAccountAcquisitionFixture, type AccountAcquisitionFixture, type AcquisitionActor } from './account-acquisition-fixture';
import { createNeonAcquisitionSourcePort, createNeonSleeperPermitPort, type AcquisitionCommand } from '../lib/accounts/neon/discovery';
import { createAcquisitionJobMethods } from '../lib/projections/adapters/neon/jobs';
import { storedSleeperDiscovery } from '../lib/accounts/stored-discovery';
import type { DatabaseClient, DatabaseQueryOptions, DatabaseRow } from '../lib/database';
import type { PermitJobFence } from '../lib/projections/adapters/sleeper/permit-transport';

// AUTHORED SQL ONLY until the existing guarded disposable supervisor runs this
// exact reviewed commit. Provider HTTP is always synthetic; SQL is real here.
describe.sequential('BC-M1 durable acquisition through actual restricted LOGINs',()=>{
  let f:AccountAcquisitionFixture; let a:AcquisitionActor; let b:AcquisitionActor;
  let identityCommand:AcquisitionCommand; let identityDemand:string; let discoveryDemand:string;
  let association:{associationId:string;associationRevision:string};
  let expiryActor:AcquisitionActor;let expiryDemand:string;
  let contextActor:AcquisitionActor;let contextDemand:string;
  let expiredContextDemand:string;
  let initialFacts:readonly Record<string,unknown>[];
  const facts=()=>ownerQuery(`SELECT
    (SELECT count(*)::int FROM public.app_current_league_selections) AS selections,
    (SELECT count(*)::int FROM public.app_user_leagues) AS saved,
    (SELECT count(*)::int FROM public.league_administration_enrollments) AS enrolled,
    (SELECT count(*)::int FROM public.league_roster_resource_acceptances) AS managerfacts`);
  const admit=async(actor:AcquisitionActor,command:AcquisitionCommand)=>{
    const admitted=await actor.port.admit(command);
    expect(admitted.result.status).toBe('pending');
    if(admitted.result.status!=='pending') throw new Error('Synthetic demand was not admitted.');
    return admitted.result.demandId;
  };
  const activate=async(actor:AcquisitionActor,demand:string)=>{
    const identified=await actor.port.read(demand,randomUUID(),'identify');
    expect(identified.result.status).toBe('identified');
    if(identified.result.status!=='identified') throw new Error('Synthetic identity was not retained.');
    const revision=(await actor.store.readFinal(actor.id)).value.profile.revision;
    const activated=await actor.port.activate({providerAccountId:String(identified.result.providerAccount.id),
      lookupCaptureId:identified.result.lookupCaptureId,expectedActorRevision:String(revision),commandId:randomUUID()});
    expect(activated.result).toMatchObject({status:'active',assurance:'user_asserted'});
    if(activated.result.status!=='active') throw new Error('Synthetic association was not activated.');
    return {associationId:activated.result.associationId,associationRevision:activated.result.associationRevision};
  };
  beforeAll(async()=>{f=await createAccountAcquisitionFixture();a=await f.actor();b=await f.actor();initialFacts=await facts();});

  it('composes durable identity, association, calendar, frozen lists and protected existing consumer DTO',async()=>{
    identityCommand={kind:'identify',commandId:randomUUID(),username:'qualified_alice'};
    identityDemand=await admit(a,identityCommand);
    expect(await f.step()).toEqual({status:'captured',kind:'identify'});
    association=await activate(a,identityDemand);
    discoveryDemand=await admit(a,{kind:'discover',commandId:randomUUID(),...association});
    expect(await f.step()).toEqual({status:'captured',kind:'calendar-state'});
    const frozen=await a.port.read(discoveryDemand,randomUUID());
    expect(frozen.result).toMatchObject({status:'discovery-progress',requiredSeasons:[2024,2025,2026],completedSeasons:[]});
    f.setCalendar(2027); // A restarted worker must not rederive this scan's plan.
    expect(await f.step()).toMatchObject({status:'discovery',progress:{status:'partial',completed:[{season:2024}]}});
    expect(await f.step()).toMatchObject({status:'discovery',progress:{status:'partial',completed:[{season:2024},{season:2025}]}});
    expect(await f.step()).toMatchObject({status:'discovery',progress:{status:'complete',requiredSeasons:[2024,2025,2026]}});
    const stored=await a.port.readDiscovery(discoveryDemand,randomUUID());
    expect(stored.result).toMatchObject({status:'available',coverage:'complete',completedSeasons:[2024,2025,2026],currentSeason:2026});
    expect(stored.decisionTiming).not.toBeNull();
    const consumer=storedSleeperDiscovery(a.id,stored.result);
    expect(consumer).toMatchObject({accountId:a.id,season:'2026',status:'partial',profiles:[{status:'complete'}]});
    expect(consumer.leagues.map(row=>row.season).sort()).toEqual(['2024','2025','2026']);
    expect(f.urls).toHaveLength(5);
    expect(f.urls.filter(url=>url.endsWith('/state/nfl'))).toHaveLength(1);
    expect(await facts()).toEqual(initialFacts); // Candidates grant no selection/membership/enrollment/manager fact.
  });

  it('keeps exact command replay idempotent and rejects changed input without another job',async()=>{
    expect((await a.port.admit(identityCommand)).result).toMatchObject({status:'joined',demandId:identityDemand});
    expect((await a.port.admit({...identityCommand,kind:'identify',username:'different_name'})).result)
      .toEqual({status:'conflict',reason:'command_conflict'});
    expect(await ownerQuery(`SELECT count(*)::int AS count FROM public.projection_jobs j
      JOIN public.app_acquisition_demands d ON d.job_key=j.job_key WHERE d.actor_user_id=$1 AND d.command_id=$2`,
    [a.id,identityCommand.commandId])).toEqual([{count:1}]);
  });

  it('denies cross-actor retained reads and lookup activation without revealing candidates',async()=>{
    expect((await b.port.read(identityDemand,randomUUID())).result).toEqual({status:'denied',reason:'scope_invalid'});
    expect((await b.port.readDiscovery(discoveryDemand,randomUUID())).result.status).not.toBe('available');
    const identified=(await a.port.read(identityDemand,randomUUID(),'identify')).result;
    if(identified.status!=='identified') throw new Error('Identity fixture unavailable.');
    expect((await b.port.activate({providerAccountId:String(identified.providerAccount.id),lookupCaptureId:identified.lookupCaptureId,
      expectedActorRevision:String((await b.store.readFinal(b.id)).value.profile.revision),commandId:randomUUID()})).result.status).toBe('denied');
  });

  it('does not acknowledge an unknown admission commit; exact retry reconciles one retained demand and job',async()=>{
    const actor=await f.actor(); const command:AcquisitionCommand={kind:'identify',commandId:randomUUID(),username:'unknown_admission'};
    let lost=false;
    const uncertain=actor.portWith({...actor.database,async finalTransaction(statements,context){
      const result=await actor.database.finalTransaction(statements,context);
      if(!lost){lost=true;throw new Error('Injected lost committed acknowledgement');} return result;
    }});
    await expect(uncertain.admit(command)).rejects.toThrow();
    const replay=await actor.port.admit(command);
    expect(replay.result.status).toBe('joined');
    if(replay.result.status!=='joined')throw new Error('Admission replay missing.');
    contextActor=actor;contextDemand=replay.result.demandId;
    expect(await ownerQuery('SELECT count(*)::int AS count FROM public.app_acquisition_demands WHERE actor_user_id=$1 AND command_id=$2',
      [actor.id,command.commandId])).toEqual([{count:1}]);
    expect(await f.step()).toEqual({status:'captured',kind:'identify'});
  });

  it('reconciles capture/checkpoint after unknown acknowledgement and rejects altered immutable replay',async()=>{
    const actor=await f.actor();const demand=await admit(actor,{kind:'identify',commandId:randomUUID(),username:'unknown_capture'});
    expiryActor=actor;expiryDemand=demand;
    let saved:{statement:string;parameters:readonly unknown[]}|undefined;let lost=false;
    const uncertain:DatabaseClient={...f.runtime,async query<Row extends DatabaseRow>(statement:string,parameters:readonly unknown[]=[],options?:DatabaseQueryOptions){
      const rows=await f.runtime.query<Row>(statement,parameters,options);
      if(statement.includes('capture_account_acquisition_v1')&&!lost){saved={statement,parameters};lost=true;throw new Error('Injected lost committed acknowledgement');}
      return rows;
    }};
    expect(await f.step({database:uncertain})).toEqual({status:'unavailable',reason:'capture'});
    expect((await actor.port.read(demand,randomUUID(),'identify')).result.status).toBe('identified');
    if(!saved)throw new Error('No capture acknowledgement was intercepted.');
    const before=await ownerQuery('SELECT count(*)::int AS count FROM public.provider_capture_receipts c JOIN public.provider_request_attempts a ON a.id=c.attempt_id WHERE a.demand_id=$1',[demand]);
    await f.runtime.query(saved.statement,saved.parameters);
    expect(await ownerQuery('SELECT count(*)::int AS count FROM public.provider_capture_receipts c JOIN public.provider_request_attempts a ON a.id=c.attempt_id WHERE a.demand_id=$1',[demand])).toEqual(before);
    expect(before).toEqual([{count:1}]);
    const altered=JSON.parse(String(saved.parameters[0]));altered.rawValue.user_id='123';
    await expect(f.runtime.query(saved.statement,[JSON.stringify(altered)])).rejects.toThrow();
  });

  it('rejects a stale worker generation before request reservation and keeps its replacement authoritative',async()=>{
    const actor=await f.actor();const demand=await admit(actor,{kind:'identify',commandId:randomUUID(),username:'stale_worker'});
    const first=await createAcquisitionJobMethods(f.runtime).claimAccountAcquisition('stale-owner');
    if(first.status!=='claimed'||first.demandId!==demand)throw new Error('Expected synthetic lease not claimed.');
    await ownerQuery("UPDATE public.projection_jobs SET lease_until=clock_timestamp()-interval '1 second' WHERE job_key=$1",[first.fence.jobKey]);
    const second=await createAcquisitionJobMethods(f.runtime).claimAccountAcquisition('replacement-owner');
    if(second.status!=='claimed')throw new Error('Replacement lease missing.');
    expect(second.fence.attemptCount).toBeGreaterThan(first.fence.attemptCount);
    await expect(createNeonAcquisitionSourcePort(f.runtime,first.fence).reserve(demand)).rejects.toThrow();
    expect(await createNeonAcquisitionSourcePort(f.runtime,second.fence).fail(demand,'transport')).toBe(true);
  });

  it('retains partial valid list checkpoints when later malformed candidates fail without granting football authority',async()=>{
    const actor=await f.actor();const identified=await admit(actor,{kind:'identify',commandId:randomUUID(),username:'partial_lists'});
    expect(await f.step()).toEqual({status:'captured',kind:'identify'});
    const linked=await activate(actor,identified);
    const demand=await admit(actor,{kind:'discover',commandId:randomUUID(),associationId:linked.associationId,associationRevision:linked.associationRevision});
    expect(await f.step()).toEqual({status:'captured',kind:'calendar-state'});
    expect(await f.step()).toMatchObject({status:'discovery',progress:{status:'partial'}});
    const before=await ownerQuery(`SELECT s.season,s.list_capture_id FROM public.app_discovery_scan_seasons s
      JOIN public.app_acquisition_demands d ON (d.result_ref->>'scanId')::uuid=s.scan_id WHERE d.id=$1 AND s.status='complete'`,[demand]);
    expect(before).toHaveLength(1);
    expect(await f.step({body:()=>[{league_id:'456',name:'Malformed',sport:'nfl',season:'wrong'}]}))
      .toMatchObject({status:'discovery',progress:{reason:'invalid_source'}});
    expect(await ownerQuery(`SELECT s.season,s.list_capture_id FROM public.app_discovery_scan_seasons s
      JOIN public.app_acquisition_demands d ON (d.result_ref->>'scanId')::uuid=s.scan_id WHERE d.id=$1 AND s.status='complete'`,[demand])).toEqual(before);
    expect(await facts()).toEqual(initialFacts);
  });

  it('R020 starts a fresh bounded unfinished-scope execution only for new accepted demand, preserving frozen progress',async()=>{
    // Respect persisted 61-second rolling windows; do not rewrite any permit,
    // attempt or quota history. This bounded real wait is part of the eventual
    // run's existing 30-minute work allowance, not a synthetic clock proof.
    await waitForRealClock(61_100);
    f.setCalendar(2030);
    const actor=await f.actor();const identity=await admit(actor,{kind:'identify',commandId:randomUUID(),username:'r020_resume'});
    expect(await f.step()).toEqual({status:'captured',kind:'identify'});
    const linked=await activate(actor,identity);
    const oldCommand:AcquisitionCommand={kind:'discover',commandId:randomUUID(),...linked};
    const oldDemand=await admit(actor,oldCommand);
    expect(await f.step()).toEqual({status:'captured',kind:'calendar-state'});
    expect(await f.step()).toMatchObject({status:'discovery',progress:{status:'partial'}});
    const progress=(await actor.port.read(oldDemand,randomUUID())).result;
    if(progress.status!=='discovery-progress')throw new Error('R020 scan was not retained.');
    const scanId=progress.scanId;
    const seasons=()=>ownerQuery<{season:number;status:string;request_id:string;list_capture_id:string|null}>(
      'SELECT season,status,request_id::text,list_capture_id::text FROM public.app_discovery_scan_seasons WHERE scan_id=$1 ORDER BY season',[scanId]);
    const original=await seasons();
    expect(original.map(row=>row.season)).toEqual([2028,2029,2030]);
    expect(original.filter(row=>row.status==='complete')).toHaveLength(1);
    const expiredLease=()=>ownerQuery("UPDATE public.projection_jobs SET lease_until=clock_timestamp()-interval '1 second' WHERE job_key=(SELECT job_key FROM public.app_acquisition_demands WHERE id=$1)",[oldDemand]);
    let interruptedInput:Record<string,unknown>|undefined;
    const interrupted:DatabaseClient={...f.runtime,async query<Row extends DatabaseRow>(statement:string,parameters:readonly unknown[]=[],options?:DatabaseQueryOptions){
      if(statement.includes('capture_account_acquisition_v1')) {
        interruptedInput=JSON.parse(String(parameters[0]));
        // Controlled coordinator failure AFTER real permit/observed-success
        // completion and BEFORE sending capture SQL. No false commit receipt.
        throw new Error('Injected interruption before capture');
      }
      return f.runtime.query<Row>(statement,parameters,options);
    }};
    for(let index=0;index<3;index++) {
      if(index===1)await waitForRealClock(3_100); // first retry floor+jitter
      if(index===2)await waitForRealClock(61_100); // actor window and second retry floor
      if(index>0)await expiredLease(); // explicit synthetic coordinator-loss fixture
      expect(await f.step({database:interrupted})).toMatchObject({status:'discovery',progress:{reason:'capture_unconfirmed'}});
    }
    if(!interruptedInput)throw new Error('R020 interruption fixture did not run.');
    const oldRequest=interruptedInput.request as {fence:PermitJobFence};
    const charged=()=>ownerQuery(`SELECT count(*)::int AS count FROM public.provider_http_permits p
      JOIN public.provider_request_attempts attempt ON attempt.dispatch_request_id=p.request_id WHERE attempt.request_id=$1`,[original[1].request_id]);
    expect(await charged()).toEqual([{count:3}]);
    expect((await actor.port.admit(oldCommand)).result).toMatchObject({status:'joined',demandId:oldDemand});
    expect(await seasons()).toEqual(original);
    await expiredLease();
    const calls=f.urls.length;
    expect(await f.step()).toMatchObject({status:'discovery',progress:{reason:'admission'}});
    expect(f.urls).toHaveLength(calls);expect(await charged()).toEqual([{count:3}]);

    // Only the synthetic demand lifetime is advanced, preserving its exact
    // 15-minute constraint. No retained attempt/permit timestamps are changed.
    await ownerQuery(`WITH sample AS MATERIALIZED(SELECT clock_timestamp() AS now)
      UPDATE public.app_acquisition_demands SET created_at=sample.now-interval '16 minutes',
      expires_at=sample.now-interval '1 minute',not_before=sample.now-interval '16 minutes'
      FROM sample WHERE id=$1`,[oldDemand]);
    await createAcquisitionJobMethods(f.runtime).claimAccountAcquisition('expire-r020-demand');
    const freshCommand:AcquisitionCommand={kind:'discover',commandId:randomUUID(),...linked};
    const freshDemand=await admit(actor,freshCommand);
    expect(freshDemand).not.toBe(oldDemand);
    f.setCalendar(2031);
    expect(await f.step()).toEqual({status:'captured',kind:'calendar-state'});
    const resumed=(await actor.port.read(freshDemand,randomUUID())).result;
    expect(resumed).toMatchObject({status:'discovery-progress',scanId,requiredSeasons:[2028,2029,2030],completedSeasons:[2028]});
    const replaced=await seasons();
    expect(replaced[0]).toEqual(original[0]);
    for(let index=1;index<replaced.length;index++) {
      expect(replaced[index].request_id).not.toBe(original[index].request_id);
      expect(replaced[index].list_capture_id).toBeNull();
    }
    expect((await actor.port.admit(freshCommand)).result).toMatchObject({status:'joined',demandId:freshDemand});
    expect(await seasons()).toEqual(replaced);
    await expect(createNeonAcquisitionSourcePort(f.runtime,oldRequest.fence).reserve(oldDemand)).rejects.toThrow();
    await expect(f.runtime.query('SELECT public.capture_account_acquisition_v1($1::jsonb) AS value',[JSON.stringify(interruptedInput)])).rejects.toThrow();
    expect(await f.step()).toMatchObject({status:'discovery',progress:{status:'partial'}});
    expect(await f.step()).toMatchObject({status:'discovery',progress:{status:'complete'}});
    expect(await charged()).toEqual([{count:3}]);
    expect((await seasons())[0]).toEqual(original[0]);
    expect((await actor.port.readDiscovery(freshDemand,randomUUID())).result)
      .toMatchObject({status:'available',scanId,currentSeason:2030,coverage:'complete',completedSeasons:[2028,2029,2030]});
  },240_000);

  it.each(['account','runtime'] as const)('denies %s LOGIN raw acquisition evidence and owner-only policy activation',async role=>{
    const statement='SELECT * FROM public.provider_capture_receipts';
    if(role==='runtime') {
      await expect(f.runtime.query(statement)).rejects.toThrow();
      await expect(f.runtime.query('SELECT public.install_acquisition_policy_v1($1::jsonb)',[JSON.stringify(f.manifest)])).rejects.toThrow();
    } else {
      const context={actorUserId:a.id,requestId:randomUUID()};
      await expect(a.database.transaction([{statement,parameters:[]}],context)).rejects.toThrow();
      await expect(a.database.transaction([{statement:'SELECT public.install_acquisition_policy_v1($1::jsonb)',parameters:[JSON.stringify(f.manifest)]}],context)).rejects.toThrow();
    }
  });

  it('keeps an unknown permit quarantined after late success and validates exact repeated completion metadata',async()=>{
    const actor=await f.actor();const demand=await admit(actor,{kind:'identify',commandId:randomUUID(),username:'late_success'});
    const claim=await createAcquisitionJobMethods(f.runtime).claimAccountAcquisition('quarantine-owner');
    if(claim.status!=='claimed'||claim.demandId!==demand)throw new Error('Quarantine fixture claim missing.');
    const source=createNeonAcquisitionSourcePort(f.runtime,claim.fence);const request=await source.reserve(demand);
    if(!request)throw new Error('Quarantine fixture request missing.');
    const permits=createNeonSleeperPermitPort(f.runtime);const reserved=await permits.reserveCommitted(request);
    if(reserved.commit!=='confirmed'||!reserved.result||typeof reserved.result!=='object'||!('permitId' in reserved.result))throw new Error('Quarantine fixture grant missing.');
    const id=String(reserved.result.permitId);
    const original=await ownerQuery('SELECT occupied_until::text FROM public.provider_http_permits WHERE id=$1',[id]);
    expect(await permits.finish(id,'unknown',null)).toBe(true);
    expect(await permits.finish(id,'success',null)).toBe(true);
    expect(await permits.finish(id,'success',null)).toBe(true);
    expect(await permits.finish(id,'success',3)).toBe(false);
    expect(await ownerQuery('SELECT quarantined,outcome,occupied_until::text FROM public.provider_http_permits WHERE id=$1',[id]))
      .toEqual([{quarantined:true,outcome:'success',occupied_until:original[0].occupied_until}]);
    const request2=await source.reserve(demand);
    if(!request2)throw new Error('Second bounded attempt missing.');
    expect(await permits.reserveCommitted(request2)).toMatchObject({commit:'confirmed',result:{status:'limited'}});
    expect(await source.fail(demand,'transport')).toBe(true);
  });

  it('denies final delivery immediately after session expiry without deleting retained normalized evidence',async()=>{
    const before=await ownerQuery('SELECT count(*)::int AS count FROM public.provider_capture_receipts');
    expect((await expiryActor.port.read(expiryDemand,randomUUID(),'identify')).result.status).toBe('identified');
    await ownerQuery('UPDATE website_auth.session SET "expiresAt"=clock_timestamp()-interval \'1 second\' WHERE id=$1',[expiryActor.receipt.sessionId]);
    await expect(expiryActor.port.read(expiryDemand,randomUUID(),'identify')).rejects.toThrow();
    expect(await ownerQuery('SELECT count(*)::int AS count FROM public.provider_capture_receipts')).toEqual(before);
  });

  it('blocks retained delivery and new acquisition after canonical association revocation',async()=>{
    expect((await a.port.readDiscovery(discoveryDemand,randomUUID())).result.status).toBe('available');
    await a.store.mutate(a.id,{kind:'unlink',id:association.associationId,body:{revision:Number(association.associationRevision)}});
    const before=f.urls.length;
    expect((await a.port.admit({kind:'discover',commandId:randomUUID(),...association})).result.status).toBe('denied');
    await expect(a.port.readDiscovery(discoveryDemand,randomUUID())).rejects.toThrow();
    expect(f.urls).toHaveLength(before);
  });

  it('rejects retained identity after policy suspension/revision change without erasing its capture',async()=>{
    expect((await contextActor.port.read(contextDemand,randomUUID(),'identify')).result.status).toBe('identified');
    const before=await ownerQuery('SELECT count(*)::int AS count FROM public.provider_capture_receipts');
    await ownerQuery("UPDATE public.provider_request_policy_qualifications SET state='suspended',revision=revision+1 WHERE family='identity-lookup'");
    await expect(contextActor.port.read(contextDemand,randomUUID(),'identify')).rejects.toThrow();
    expect(await ownerQuery('SELECT count(*)::int AS count FROM public.provider_capture_receipts')).toEqual(before);
  });

  it('prevents acquisition and final reads after the independently installed access context expires',async()=>{
    // Fresh qualified synthetic policy generation; never decrement/reuse the
    // suspended revision or treat old captures as newly qualified.
    await ownerQuery('SELECT public.install_acquisition_policy_v1($1::jsonb)',[JSON.stringify({...f.manifest,
      context:{...f.manifest.context,revision:'2'},policies:f.manifest.policies.map(policy=>({...policy,revision:'3'}))})]);
    const actor=await f.actor();const completed=await admit(actor,{kind:'identify',commandId:randomUUID(),username:'fresh_access'});
    expect(await f.step()).toEqual({status:'captured',kind:'identify'});
    expect((await actor.port.read(completed,randomUUID(),'identify')).result.status).toBe('identified');
    expiredContextDemand=await admit(actor,{kind:'identify',commandId:randomUUID(),username:'expired_access'});
    const calls=f.urls.length;
    await ownerQuery("UPDATE public.provider_access_contexts SET authority_expires_at=clock_timestamp()-interval '1 second' WHERE id=$1",[f.contextId]);
    expect(await f.step()).toMatchObject({status:'unavailable'});
    expect(f.urls).toHaveLength(calls);
    await expect(actor.port.read(completed,randomUUID(),'identify')).rejects.toThrow();
  });

  it('retires an unfinished scan with superseded calendar evidence and creates qualified replacement without rewriting history',async()=>{
    // The prior case deliberately expired context generation2. Requalification
    // advances every generation; it cannot validate the old retained captures.
    await ownerQuery('SELECT public.install_acquisition_policy_v1($1::jsonb)',[JSON.stringify({...f.manifest,
      context:{...f.manifest.context,revision:'3'},policies:f.manifest.policies.map(policy=>({...policy,revision:'4'}))})]);
    await ownerQuery(`WITH sample AS MATERIALIZED(SELECT clock_timestamp() AS now)
      UPDATE public.app_acquisition_demands SET created_at=sample.now-interval '16 minutes',
      expires_at=sample.now-interval '1 minute',not_before=sample.now-interval '16 minutes'
      FROM sample WHERE id=$1`,[expiredContextDemand]);
    await createAcquisitionJobMethods(f.runtime).claimAccountAcquisition('retire-expired-context-fixture');
    f.setCalendar(2040);
    const actor=await f.actor();const identity=await admit(actor,{kind:'identify',commandId:randomUUID(),username:'replace_stale_scan'});
    expect(await f.step()).toEqual({status:'captured',kind:'identify'});
    const linked=await activate(actor,identity);
    const oldCommand:AcquisitionCommand={kind:'discover',commandId:randomUUID(),...linked};
    const oldDemand=await admit(actor,oldCommand);
    expect(await f.step()).toEqual({status:'captured',kind:'calendar-state'});
    expect(await f.step()).toMatchObject({status:'discovery',progress:{status:'partial'}});
    const progress=(await actor.port.read(oldDemand,randomUUID())).result;
    if(progress.status!=='discovery-progress')throw new Error('Old qualified scan missing.');
    const oldScan=progress.scanId;
    const sourceSnapshot=()=>ownerQuery(`SELECT calendar_capture_id::text,query_set_hash,league_season_at_start,
      retained_selection_seasons FROM public.app_discovery_scans WHERE id=$1`,[oldScan]);
    const seasonSnapshot=()=>ownerQuery(`SELECT season,status,request_id::text,list_capture_id::text
      FROM public.app_discovery_scan_seasons WHERE scan_id=$1 ORDER BY season`,[oldScan]);
    const oldSource=await sourceSnapshot(),oldSeasons=await seasonSnapshot();
    const oldCaptureIds=[oldSource[0].calendar_capture_id,...oldSeasons.map(row=>row.list_capture_id).filter(Boolean)];
    expect(oldCaptureIds).toHaveLength(2);
    const retainedCaptures=()=>ownerQuery('SELECT to_jsonb(c) AS retained FROM public.provider_capture_receipts c WHERE id=ANY($1::uuid[]) ORDER BY id',[oldCaptureIds]);
    const oldCaptures=await retainedCaptures();
    // Isolate calendar qualification: identity and completed-list policies stay
    // current, so refreshing an association is not a hidden prerequisite.
    await ownerQuery("UPDATE public.provider_request_policy_qualifications SET revision=revision+1 WHERE family='nfl-state'");
    await expect(actor.port.readDiscovery(oldDemand,randomUUID())).rejects.toThrow();
    await ownerQuery(`WITH sample AS MATERIALIZED(SELECT clock_timestamp() AS now)
      UPDATE public.app_acquisition_demands SET created_at=sample.now-interval '16 minutes',
      expires_at=sample.now-interval '1 minute',not_before=sample.now-interval '16 minutes'
      FROM sample WHERE id=$1`,[oldDemand]);
    await createAcquisitionJobMethods(f.runtime).claimAccountAcquisition('retire-stale-calendar-demand');
    // Three earlier requests plus a replacement calendar and three lists would
    // exceed the actor rolling cap. Wait on real time; preserve all permit rows.
    await waitForRealClock(61_100);
    f.setCalendar(2042);
    const freshCommand:AcquisitionCommand={kind:'discover',commandId:randomUUID(),...linked};
    const freshDemand=await admit(actor,freshCommand);
    expect(await f.step()).toEqual({status:'captured',kind:'calendar-state'});
    const replacement=(await actor.port.read(freshDemand,randomUUID())).result;
    if(replacement.status!=='discovery-progress')throw new Error('Replacement scan missing.');
    expect(replacement.scanId).not.toBe(oldScan);
    expect(replacement.requiredSeasons).toEqual([2040,2041,2042]);
    expect(await ownerQuery('SELECT status,finished_at IS NOT NULL AS finished FROM public.app_discovery_scans WHERE id=$1',[oldScan]))
      .toEqual([{status:'failed',finished:true}]);
    expect(await sourceSnapshot()).toEqual(oldSource);expect(await seasonSnapshot()).toEqual(oldSeasons);
    expect(await ownerQuery('SELECT count(*)::int AS count FROM public.provider_capture_receipts WHERE id=ANY($1::uuid[])',[oldCaptureIds])).toEqual([{count:2}]);
    expect(await retainedCaptures()).toEqual(oldCaptures);
    const commandsBefore=await ownerQuery('SELECT count(*)::int AS count FROM public.app_discovery_scans WHERE association_id=$1',[linked.associationId]);
    expect((await actor.port.admit(freshCommand)).result).toMatchObject({status:'joined',demandId:freshDemand});
    expect((await actor.port.admit(oldCommand)).result.status).toBe('denied');
    expect(await ownerQuery('SELECT count(*)::int AS count FROM public.app_discovery_scans WHERE association_id=$1',[linked.associationId])).toEqual(commandsBefore);
    for(let index=0;index<3;index++)expect(await f.step()).toMatchObject({status:'discovery'});
    expect((await actor.port.readDiscovery(freshDemand,randomUUID())).result)
      .toMatchObject({status:'available',coverage:'complete',scanId:replacement.scanId,currentSeason:2042});
    expect(await sourceSnapshot()).toEqual(oldSource);expect(await seasonSnapshot()).toEqual(oldSeasons);
  },180_000);

  it('refreshes stale nonnull association evidence under actor CAS and fences old work without losing either lookup',async()=>{
    const actor=await f.actor();const username='refresh_association_evidence';
    const firstDemand=await admit(actor,{kind:'identify',commandId:randomUUID(),username});
    expect(await f.step()).toEqual({status:'captured',kind:'identify'});
    const first=(await actor.port.read(firstDemand,randomUUID(),'identify')).result;
    if(first.status!=='identified')throw new Error('Initial lookup missing.');
    const originalLookup=await ownerQuery('SELECT to_jsonb(c) AS retained FROM public.provider_capture_receipts c WHERE id=$1',[first.lookupCaptureId]);
    const firstCommand={providerAccountId:String(first.providerAccount.id),lookupCaptureId:first.lookupCaptureId,
      expectedActorRevision:String((await actor.store.readFinal(actor.id)).value.profile.revision),commandId:randomUUID()};
    const initial=(await actor.port.activate(firstCommand)).result;
    if(initial.status!=='active')throw new Error('Initial association missing.');
    const oldDemand=await admit(actor,{kind:'discover',commandId:randomUUID(),associationId:initial.associationId,associationRevision:initial.associationRevision});
    const oldClaim=await createAcquisitionJobMethods(f.runtime).claimAccountAcquisition('old-evidence-worker');
    if(oldClaim.status!=='claimed'||oldClaim.demandId!==oldDemand)throw new Error('Old association lease missing.');
    const oldSource=createNeonAcquisitionSourcePort(f.runtime,oldClaim.fence);
    expect(await oldSource.reserve(oldDemand)).not.toBeNull();
    await ownerQuery("UPDATE public.provider_request_policy_qualifications SET revision=revision+1 WHERE family='identity-lookup'");
    const newDemand=await admit(actor,{kind:'identify',commandId:randomUUID(),username});
    expect(await f.step()).toEqual({status:'captured',kind:'identify'});
    const fresh=(await actor.port.read(newDemand,randomUUID(),'identify')).result;
    if(fresh.status!=='identified')throw new Error('Fresh own-subject lookup missing.');
    expect(fresh.providerAccount.id).toBe(first.providerAccount.id);expect(fresh.lookupCaptureId).not.toBe(first.lookupCaptureId);
    const revision=(await actor.store.readFinal(actor.id)).value.profile.revision;
    const freshCommand={providerAccountId:String(fresh.providerAccount.id),lookupCaptureId:fresh.lookupCaptureId,
      expectedActorRevision:String(revision),commandId:randomUUID()};
    expect((await actor.port.activate({...freshCommand,expectedActorRevision:String(revision-1),commandId:randomUUID()})).result.status).toBe('conflict');
    expect(await ownerQuery('SELECT subject_lookup_capture_id::text FROM public.app_provider_account_links WHERE id=$1',[initial.associationId]))
      .toEqual([{subject_lookup_capture_id:first.lookupCaptureId}]);
    const renewed=(await actor.port.activate(freshCommand)).result;
    expect(renewed).toMatchObject({status:'already_active',associationId:initial.associationId,assurance:'user_asserted'});
    if(renewed.status!=='already_active')throw new Error('Evidence refresh not acknowledged.');
    expect(BigInt(renewed.associationRevision)).toBeGreaterThan(BigInt(initial.associationRevision));
    expect((await actor.store.readFinal(actor.id)).value.profile.revision).toBeGreaterThan(revision);
    expect(await ownerQuery('SELECT subject_lookup_capture_id::text FROM public.app_provider_account_links WHERE id=$1',[initial.associationId]))
      .toEqual([{subject_lookup_capture_id:fresh.lookupCaptureId}]);
    expect((await actor.port.activate(freshCommand)).result).toEqual(renewed);
    expect((await actor.port.activate(firstCommand)).result.status).toBe('denied');
    expect(await ownerQuery('SELECT count(*)::int AS count FROM public.provider_capture_receipts WHERE id=ANY($1::uuid[])',
      [[first.lookupCaptureId,fresh.lookupCaptureId]])).toEqual([{count:2}]);
    expect(await ownerQuery('SELECT to_jsonb(c) AS retained FROM public.provider_capture_receipts c WHERE id=$1',[first.lookupCaptureId])).toEqual(originalLookup);
    // Establish the old lease is still live so rejection specifically tests
    // changed association authority, rather than accidental lease expiry.
    expect(await ownerQuery('SELECT lease_until>clock_timestamp() AS live FROM public.projection_jobs WHERE job_key=$1',[oldClaim.fence.jobKey])).toEqual([{live:true}]);
    await expect(oldSource.reserve(oldDemand)).rejects.toThrow();
    expect(await oldSource.fail(oldDemand,'transport')).toBe(true);
    const currentDemand=await admit(actor,{kind:'discover',commandId:randomUUID(),associationId:renewed.associationId,associationRevision:renewed.associationRevision});
    expect(await f.step()).toEqual({status:'captured',kind:'calendar-state'});
    expect(await f.step()).toMatchObject({status:'discovery',progress:{status:'partial'}});
    expect((await actor.port.readDiscovery(currentDemand,randomUUID())).result).toMatchObject({status:'available',coverage:'partial'});
  });
});
