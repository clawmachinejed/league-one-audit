import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { basename, isAbsolute, join, resolve } from 'node:path';
import { integrationChildEnvironment, assertLocalDailyQualification } from './disposable-integration';
import { createBackendControlsDatabaseFetchGuard } from './backend-controls-fetch';
import { INTEGRATION_WORK_DEADLINE_ENV, integrationLifecycleEnvelope } from './integration-lifecycle-budget';
import { FLEET_HEALTHY_PROFILE, FLEET_RECOVERY_PROFILE, FLEET_DAILY_PROFILE, FLEET_OWNERSHIP_PROFILE, FLEET_LIVE_PROFILE, FLEET_OWNERSHIP_SCENARIOS, assertFleetEvidenceInventory, type FleetEvidenceInventory } from './freshness-capacity-profile';

export const FLEET_CONFIG = 'CP26_FLEET_CONFIG';
export const FLEET_VERSION = 'cp26-fleet-v1';
export type FleetProfile=typeof FLEET_HEALTHY_PROFILE|typeof FLEET_RECOVERY_PROFILE|typeof FLEET_DAILY_PROFILE|typeof FLEET_OWNERSHIP_PROFILE|typeof FLEET_LIVE_PROFILE;
export type FleetConfig = { profile:FleetProfile; nonce: string; fixtureId: string; contextNonce: string; gitSha: string; profileDigest: string;
  fixtureDigest: string; manifestDigest: string; workDeadlineAt:number; evidenceDirectory:string; plannedPostgresqlVersion:string; expectedDatabase: string; expectedBranch: string };
const uuid = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/u;
const hash = /^[a-f0-9]{64}$/u;
export const fleetKeys = (value: object, keys: readonly string[]) => assert.deepEqual(Object.keys(value).sort(), [...keys].sort());
function object(value: unknown): Record<string, unknown> { assert(value && typeof value === 'object' && !Array.isArray(value)); return value as Record<string, unknown>; }
export function parseFleetConfig(value: unknown): FleetConfig {
  const row = object(value) as FleetConfig;
  fleetKeys(row, ['profile','nonce','fixtureId','contextNonce','gitSha','profileDigest','fixtureDigest','manifestDigest','workDeadlineAt','evidenceDirectory','plannedPostgresqlVersion','expectedDatabase','expectedBranch']);
  assert(row.profile===FLEET_HEALTHY_PROFILE||row.profile===FLEET_RECOVERY_PROFILE||row.profile===FLEET_DAILY_PROFILE||row.profile===FLEET_OWNERSHIP_PROFILE||row.profile===FLEET_LIVE_PROFILE,'closed fleet profile required');
  for (const id of [row.nonce,row.fixtureId,row.contextNonce]) assert.match(id,uuid);
  assert.match(row.plannedPostgresqlVersion,/^[1-9][0-9]*\.[0-9]+$/u);
  assert.match(row.gitSha,/^[a-f0-9]{40}$/u); for (const digest of [row.profileDigest,row.fixtureDigest,row.manifestDigest]) assert.match(digest,hash);
  assert.match(row.expectedDatabase,/^[a-z][a-z0-9_]{0,62}$/u); assert.match(row.expectedBranch,/^br-[a-z0-9-]{1,100}$/u);
  assert(Number.isSafeInteger(row.workDeadlineAt) && row.workDeadlineAt > 0 && row.workDeadlineAt <= Date.now() + integrationLifecycleEnvelope(row.profile===FLEET_OWNERSHIP_PROFILE||row.profile===FLEET_LIVE_PROFILE?undefined:row.profile).workMs, 'invalid supervised work deadline');
  assert(typeof row.evidenceDirectory==='string'&&isAbsolute(row.evidenceDirectory)&&resolve(row.evidenceDirectory)===row.evidenceDirectory);
  assert.equal(basename(row.evidenceDirectory),'fleet-raw-'+row.nonce,'invalid worker artifact directory');
  return Object.freeze({ ...row });
}
/** The only accepted origin is the supervisor's original work budget, never a caller-selected duration. */
export function fleetSupervisedWorkDeadline(environment:Record<string,string|undefined>,profile:FleetProfile=FLEET_HEALTHY_PROFILE):number {
  const text=environment[INTEGRATION_WORK_DEADLINE_ENV];assert(text&&/^[1-9][0-9]*$/u.test(text),'supervised deadline required');
  const deadline=Number(text);assert(Number.isSafeInteger(deadline)&&deadline<=Date.now()+integrationLifecycleEnvelope(profile===FLEET_OWNERSHIP_PROFILE||profile===FLEET_LIVE_PROFILE?undefined:profile).workMs,'invalid supervised deadline');return deadline;
}
export function fleetEnvironment(source: Record<string,string|undefined>, runtimeUrl: string, config: FleetConfig) {
  assertLocalDailyQualification(source,config.profile);
  parseFleetConfig(config); assert.equal(config.workDeadlineAt, fleetSupervisedWorkDeadline(source,config.profile), 'supervisor deadline changed');
  const artifactRoot=source.PROJECTION_INTEGRATION_ARTIFACT_DIRECTORY; assert(artifactRoot&&isAbsolute(artifactRoot),'bound artifact directory required');
  assert.equal(config.evidenceDirectory,resolve(join(artifactRoot,'fleet-raw-'+config.nonce)),'worker artifact directory escaped bound run');
  const url=new URL(runtimeUrl);
  assert(['postgres:','postgresql:'].includes(url.protocol)); assert.equal(decodeURIComponent(url.username),'league_one_runtime');
  assert(['require','verify-ca','verify-full'].includes(url.searchParams.get('sslmode') ?? '')); assert.equal(decodeURIComponent(url.pathname.slice(1)),config.expectedDatabase);
  return { ...integrationChildEnvironment(source), DATABASE_URL:runtimeUrl, [FLEET_CONFIG]:JSON.stringify(config) };
}
export const FLEET_ACTIONS = ['omitted','false','prepare','run-healthy','run-recovery','run-daily','prepare-live','run-live','prepare-ownership','ownership-turn','ownership-acl','snapshot','stop'] as const;
export type FleetAction = typeof FLEET_ACTIONS[number];
export type FleetOwnershipScenario = typeof FLEET_OWNERSHIP_SCENARIOS[number];
export type FleetOwnershipRole = 'owner'|'competitor'|'replacement'|'warmup';
type FleetBasicCommand = { version:typeof FLEET_VERSION; nonce:string; sequence:number; action:Exclude<FleetAction,'ownership-turn'> };
export type FleetOwnershipCommand = { version:typeof FLEET_VERSION; nonce:string; sequence:number; action:'ownership-turn';
  scenario:FleetOwnershipScenario;role:FleetOwnershipRole;slot:number;invocationStartedAt:number };
export type FleetCommand = FleetBasicCommand | FleetOwnershipCommand;
export function parseFleetCommand(value:unknown,config:FleetConfig,sequence:number):FleetCommand {
  const row=object(value) as FleetCommand;fleetKeys(row,row.action==='ownership-turn'?['version','nonce','sequence','action','scenario','role','slot','invocationStartedAt']:['version','nonce','sequence','action']);assert.equal(row.version,FLEET_VERSION);assert.equal(row.nonce,config.nonce);
  assert(Number.isSafeInteger(sequence)&&sequence>=1&&sequence<=16);assert.equal(row.sequence,sequence);assert(FLEET_ACTIONS.includes(row.action));
  if(row.action==='run-healthy')assert.equal(config.profile,FLEET_HEALTHY_PROFILE,'profile command mismatch');
  if(row.action==='run-recovery')assert.equal(config.profile,FLEET_RECOVERY_PROFILE,'profile command mismatch');
  if(row.action==='run-daily')assert.equal(config.profile,FLEET_DAILY_PROFILE,'profile command mismatch');
  if(row.action==='prepare-live'||row.action==='run-live')assert.equal(config.profile,FLEET_LIVE_PROFILE,'profile command mismatch');
  if(row.action==='prepare-ownership'||row.action==='ownership-turn'||row.action==='ownership-acl')assert.equal(config.profile,FLEET_OWNERSHIP_PROFILE,'profile command mismatch');
  if(row.action==='ownership-turn'){
    assert(FLEET_OWNERSHIP_SCENARIOS.includes(row.scenario));assert(['owner','competitor','replacement','warmup'].includes(row.role));
    assert(row.role!=='competitor'||row.scenario==='selection-competition-death');assert(row.role!=='warmup'||row.scenario==='backoff-authority-and-acl');
    assert(Number.isSafeInteger(row.slot)&&row.slot>=0&&row.slot<15);assert(Number.isSafeInteger(row.invocationStartedAt)&&row.invocationStartedAt>0&&row.invocationStartedAt+20_000<=config.workDeadlineAt,'original ownership invocation deadline required');
  }
  if(config.profile===FLEET_LIVE_PROFILE)assert(['prepare-live','run-live','snapshot','stop'].includes(row.action),'closed live action required');
  if(config.profile===FLEET_OWNERSHIP_PROFILE)assert(['prepare-ownership','ownership-turn','ownership-acl','snapshot','stop'].includes(row.action),'closed ownership action required');
  return row;
}
export type FleetSpan = { startedAt:string; endedAt:string; monotonicStartMs:number; monotonicEndMs:number };
export function fleetStart(){return {startedAt:new Date().toISOString(),monotonicStartMs:performance.now()};}
export function fleetEnd(start:ReturnType<typeof fleetStart>):FleetSpan{return {...start,endedAt:new Date().toISOString(),monotonicEndMs:performance.now()};}
export function assertFleetSpan(span:FleetSpan){fleetKeys(span,['startedAt','endedAt','monotonicStartMs','monotonicEndMs']);
  assert.equal(new Date(span.startedAt).toISOString(),span.startedAt);assert.equal(new Date(span.endedAt).toISOString(),span.endedAt);
  assert(Date.parse(span.endedAt)>=Date.parse(span.startedAt));assert(Number.isFinite(span.monotonicStartMs)&&span.monotonicStartMs>=0);
  assert(Number.isFinite(span.monotonicEndMs)&&span.monotonicEndMs>=span.monotonicStartMs);}
export type FleetMessage = { profile:FleetProfile;version:typeof FLEET_VERSION;nonce:string;contextNonce:string;gitSha:string;profileDigest:string;fixtureDigest:string;manifestDigest:string;workDeadlineAt:number;plannedPostgresqlVersion:string;
  pid:number;backendPid:number;backendStart:string;database:string;branch:string;sessionUser:string;currentUser:string;httpSessionUser:string;httpCurrentUser:string;
  type:'ready'|'result';sequence:number;action:FleetAction|null;span:FleetSpan;inventory:FleetEvidenceInventory|null;
  result:Record<string,unknown>|null;error:boolean };
export function parseFleetMessage(value:unknown,config:FleetConfig,pid:number):FleetMessage {
  const row=object(value) as FleetMessage;
  fleetKeys(row,['profile','version','nonce','contextNonce','gitSha','profileDigest','fixtureDigest','manifestDigest','workDeadlineAt','plannedPostgresqlVersion','pid','backendPid','backendStart','database','branch',
    'sessionUser','currentUser','httpSessionUser','httpCurrentUser','type','sequence','action','span','inventory','result','error']);
  assert.equal(row.version,FLEET_VERSION);for(const key of ['profile','nonce','contextNonce','gitSha','profileDigest','fixtureDigest','manifestDigest','workDeadlineAt','plannedPostgresqlVersion'] as const)assert.equal(row[key],config[key]);
  assert.equal(row.pid,pid);assert(Number.isSafeInteger(pid)&&pid>1);assert(Number.isSafeInteger(row.backendPid)&&row.backendPid>1);assert(Number.isFinite(Date.parse(row.backendStart)));
  assert.equal(row.database,config.expectedDatabase);assert.equal(row.branch,config.expectedBranch);
  for(const role of [row.sessionUser,row.currentUser,row.httpSessionUser,row.httpCurrentUser])assert.equal(role,'league_one_runtime');
  assert(['ready','result'].includes(row.type));assert(Number.isSafeInteger(row.sequence)&&row.sequence>=0&&row.sequence<=16);assert.equal(typeof row.error,'boolean');assertFleetSpan(row.span);
  if(row.type==='ready'){assert.equal(row.sequence,0);assert.equal(row.action,null);assert.equal(row.inventory,null);assert.equal(row.result,null);assert.equal(row.error,false);}
  else {assert(row.sequence>0);assert(FLEET_ACTIONS.includes(row.action as FleetAction));assert(row.action!=='stop');
    if(row.result!==null)object(row.result);if(row.inventory!==null){assertFleetEvidenceInventory(row.inventory);assert.equal(row.inventory.manifestDigest,config.manifestDigest);}
    if((row.action==='run-healthy'||row.action==='run-recovery'||row.action==='run-daily')&&!row.error)assert(row.inventory,'complete fleet result requires immutable evidence inventory');}
  return row;
}
export type FleetSqlAttempt = { sequence:number;span:FleetSpan;querySha256:string;outcome:'success'|'failed';signal:boolean };
/** Exact existing Neon endpoint/connection allowlist; source traffic must pass the separate closed fixture transport. */
export function fleetFetch(options:{runtimeUrl:string;originalFetch:typeof fetch;providerFetch:typeof fetch;onSql:(attempt:FleetSqlAttempt)=>void}):typeof fetch {
  const isDatabase=createBackendControlsDatabaseFetchGuard(options.runtimeUrl);let sequence=0;
  return async(input,init)=>{
    if(!isDatabase(input,init))return options.providerFetch(input,init);
    const start=fleetStart(),request=input instanceof Request?input:null,signal=init?.signal??request?.signal;
    const raw=typeof init?.body==='string'?init.body:request?await request.clone().text():null;assert(raw,'SQL envelope bytes required');
    const body:unknown=JSON.parse(raw),envelope=object(body);assert(typeof envelope.query==='string'||Array.isArray(envelope.queries),'invalid SQL envelope');
    const query=typeof envelope.query==='string'?envelope.query:JSON.stringify((envelope.queries as {query:string}[]).map(row=>row.query));
    const querySha256=createHash('sha256').update(query).digest('hex'),ordinal=++sequence;let outcome:'success'|'failed'='failed';
    try {signal?.throwIfAborted();const response=await options.originalFetch(input,init);outcome=response.ok?'success':'failed';return response;}
    finally {options.onSql({sequence:ordinal,span:fleetEnd(start),querySha256,outcome,signal:Boolean(signal)});}
  };
}

/** Incremental source-bound records are acknowledged by the parent before a death barrier.
 * They contain no command-supplied work, witness or SQL result. Killed children need no final snapshot. */
export const FLEET_SHORT_BOUNDARIES = ['selected','admitted','core-all-accepted','advance-committed','budget-backoff'] as const;
export type FleetShortEventValue =
  | {kind:'sql';transport:'pinned'|'http';query:string;querySha256:string;params:unknown[];lock:{sql:string;params:unknown[];verifyAfter:{sql:string;params:unknown[]}|null}|null;rows:unknown[]|null;outcome:'success'|'failed';errorCode:string|null}
  | {kind:'http';ordinal:number;method:'GET';url:string;status:number|null;rawUtf8:string|null;rawSha256:string|null;errorCode:'aborted'|'request'|'body'|'policy'|null}
  | {kind:'boundary';name:typeof FLEET_SHORT_BOUNDARIES[number];scenario:FleetOwnershipScenario;role:FleetOwnershipRole;slot:number;invocationStartedAt:number;work:unknown;fence:unknown;value:unknown}
  | {kind:'invocation';phase:'started'|'completed';scenario:FleetOwnershipScenario|null;role:FleetOwnershipRole|null;slot:number;invocationStartedAt:number;result:unknown}
  | {kind:'record';name:'submission'|'configuration'|'reader'|'acl'|'session'|'current-week'|'submission-replay';value:unknown}
  | {kind:'failure';stage:string;failureKind:'assertion'|'aborted'|'operation'};
export type FleetShortEvent = Omit<FleetMessage,'type'|'sequence'|'action'|'inventory'|'result'|'error'> & {
  type:'short-event';eventSequence:number;commandSequence:number;event:FleetShortEventValue };
export function parseFleetShortEvent(value:unknown,config:FleetConfig,pid:number,expectedSequence:number):FleetShortEvent {
  assert(config.profile===FLEET_OWNERSHIP_PROFILE||config.profile===FLEET_LIVE_PROFILE,'short profile required');
  const row=object(value) as FleetShortEvent;
  fleetKeys(row,['profile','version','nonce','contextNonce','gitSha','profileDigest','fixtureDigest','manifestDigest','workDeadlineAt','plannedPostgresqlVersion','pid','backendPid','backendStart','database','branch','sessionUser','currentUser','httpSessionUser','httpCurrentUser','type','eventSequence','commandSequence','span','event']);
  assert.equal(row.type,'short-event');assert.equal(row.eventSequence,expectedSequence);assert(Number.isSafeInteger(expectedSequence)&&expectedSequence>0&&expectedSequence<=100_000);
  assert(Number.isSafeInteger(row.commandSequence)&&row.commandSequence>=0&&row.commandSequence<=16);
  const {eventSequence: _eventSequence,commandSequence: _commandSequence,event,type: _type,...identity}=row;
  void _eventSequence;void _commandSequence;void _type;
  parseFleetMessage({...identity,type:'ready',sequence:0,action:null,inventory:null,result:null,error:false},config,pid);
  const data=object(event);assert(Buffer.byteLength(JSON.stringify(data),'utf8')<=4*1024*1024,'short event body limit');
  if(data.kind==='sql'){
    fleetKeys(data,['kind','transport','query','querySha256','params','lock','rows','outcome','errorCode']);assert(['pinned','http'].includes(String(data.transport)));assert(typeof data.query==='string'&&data.query.length>0);
    assert.equal(createHash('sha256').update(data.query).digest('hex'),data.querySha256);assert(Array.isArray(data.params));assert(data.rows===null||Array.isArray(data.rows));assert(['success','failed'].includes(String(data.outcome)));
    assert(data.errorCode===null||typeof data.errorCode==='string'&&/^[A-Z0-9]{5}$/u.test(data.errorCode));assert(data.outcome==='success'?data.rows!==null&&data.errorCode===null:data.rows===null);
    if(data.lock!==null){const lock=object(data.lock);fleetKeys(lock,['sql','params','verifyAfter']);assert(typeof lock.sql==='string'&&Array.isArray(lock.params));if(lock.verifyAfter!==null){const verify=object(lock.verifyAfter);fleetKeys(verify,['sql','params']);assert(typeof verify.sql==='string'&&Array.isArray(verify.params));}}
  }else if(data.kind==='http'){
    fleetKeys(data,['kind','ordinal','method','url','status','rawUtf8','rawSha256','errorCode']);assert(Number.isSafeInteger(data.ordinal)&&Number(data.ordinal)>0);assert.equal(data.method,'GET');
    assert(typeof data.url==='string');const url=new URL(data.url);assert.equal(url.protocol,'https:');assert.equal(url.hostname,'api.sleeper.app');assert(!url.username&&!url.password&&!url.port&&!url.hash&&!url.search);
    assert(data.status===null||Number.isSafeInteger(data.status)&&Number(data.status)>=100&&Number(data.status)<=599);assert(data.errorCode===null||['aborted','request','body','policy'].includes(String(data.errorCode)));
    if(data.rawUtf8===null)assert.equal(data.rawSha256,null);else{assert(typeof data.rawUtf8==='string');assert(Buffer.byteLength(data.rawUtf8,'utf8')<=1024*1024);assert.equal(createHash('sha256').update(data.rawUtf8).digest('hex'),data.rawSha256);}
  }else if(data.kind==='boundary'){
    fleetKeys(data,['kind','name','scenario','role','slot','invocationStartedAt','work','fence','value']);assert(config.profile===FLEET_OWNERSHIP_PROFILE);assert(FLEET_SHORT_BOUNDARIES.includes(data.name as typeof FLEET_SHORT_BOUNDARIES[number]));
    parseFleetCommand({version:FLEET_VERSION,nonce:config.nonce,sequence:1,action:'ownership-turn',scenario:data.scenario,role:data.role,slot:data.slot,invocationStartedAt:data.invocationStartedAt},config,1);
  }else if(data.kind==='invocation'){
    fleetKeys(data,['kind','phase','scenario','role','slot','invocationStartedAt','result']);assert(['started','completed'].includes(String(data.phase)));assert(Number.isSafeInteger(data.slot)&&Number(data.slot)>=0&&Number(data.slot)<15);assert(Number.isSafeInteger(data.invocationStartedAt)&&Number(data.invocationStartedAt)>0);
    if(config.profile===FLEET_LIVE_PROFILE){assert.equal(data.scenario,null);assert.equal(data.role,null);assert(Number(data.slot)<3);}else parseFleetCommand({version:FLEET_VERSION,nonce:config.nonce,sequence:1,action:'ownership-turn',scenario:data.scenario,role:data.role,slot:data.slot,invocationStartedAt:data.invocationStartedAt},config,1);
    if(data.phase==='started')assert.equal(data.result,null);
  }else if(data.kind==='record'){
    fleetKeys(data,['kind','name','value']);assert(['submission','configuration','reader','acl','session','current-week','submission-replay'].includes(String(data.name)));
    if(data.name==='current-week'){
      assert.equal(config.profile,FLEET_LIVE_PROFILE);const witness=object(data.value);fleetKeys(witness,['sourceEventSequence','season','nativeWeek','discoverySeason']);
      assert(Number.isSafeInteger(witness.sourceEventSequence)&&Number(witness.sourceEventSequence)>0&&Number(witness.sourceEventSequence)<expectedSequence);
      assert.equal(witness.season,2026);assert.equal(witness.discoverySeason,'2026');assert(Number.isInteger(witness.nativeWeek)&&Number(witness.nativeWeek)>=1&&Number(witness.nativeWeek)<=18);
    }else if(data.name==='submission-replay'){
      assert.equal(config.profile,FLEET_LIVE_PROFILE);const replay=object(data.value);fleetKeys(replay,['input','result','submitSpan','before','after']);assertFleetSpan(replay.submitSpan as FleetSpan);
      for(const key of ['before','after']){const observation=object(replay[key]);fleetKeys(observation,['rows','queryEventSequences']);assert(Array.isArray(observation.rows)&&Array.isArray(observation.queryEventSequences));
        assert(observation.queryEventSequences.length>0&&observation.queryEventSequences.every(sequence=>Number.isSafeInteger(sequence)&&sequence>0&&sequence<expectedSequence));}
    }
  }
  else {fleetKeys(data,['kind','stage','failureKind']);assert.equal(data.kind,'failure');assert(typeof data.stage==='string'&&/^[a-z][a-z0-9-]{0,63}$/u.test(data.stage));assert(['assertion','aborted','operation'].includes(String(data.failureKind)));}
  return row;
}
