import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { basename, isAbsolute, join, resolve } from 'node:path';
import { integrationChildEnvironment } from './disposable-integration';
import { createBackendControlsDatabaseFetchGuard } from './backend-controls-fetch';
import { INTEGRATION_WORK_DEADLINE_ENV, integrationLifecycleEnvelope } from './integration-lifecycle-budget';
import { FLEET_HEALTHY_PROFILE, FLEET_RECOVERY_PROFILE, assertFleetEvidenceInventory, type FleetEvidenceInventory } from './freshness-capacity-profile';

export const FLEET_CONFIG = 'CP26_FLEET_CONFIG';
export const FLEET_VERSION = 'cp26-fleet-v1';
export type FleetProfile=typeof FLEET_HEALTHY_PROFILE|typeof FLEET_RECOVERY_PROFILE;
export type FleetConfig = { profile:FleetProfile; nonce: string; fixtureId: string; contextNonce: string; gitSha: string; profileDigest: string;
  fixtureDigest: string; manifestDigest: string; workDeadlineAt:number; evidenceDirectory:string; plannedPostgresqlVersion:string; expectedDatabase: string; expectedBranch: string };
const uuid = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/u;
const hash = /^[a-f0-9]{64}$/u;
export const fleetKeys = (value: object, keys: readonly string[]) => assert.deepEqual(Object.keys(value).sort(), [...keys].sort());
function object(value: unknown): Record<string, unknown> { assert(value && typeof value === 'object' && !Array.isArray(value)); return value as Record<string, unknown>; }
export function parseFleetConfig(value: unknown): FleetConfig {
  const row = object(value) as FleetConfig;
  fleetKeys(row, ['profile','nonce','fixtureId','contextNonce','gitSha','profileDigest','fixtureDigest','manifestDigest','workDeadlineAt','evidenceDirectory','plannedPostgresqlVersion','expectedDatabase','expectedBranch']);
  assert(row.profile===FLEET_HEALTHY_PROFILE||row.profile===FLEET_RECOVERY_PROFILE,'closed fleet profile required');
  for (const id of [row.nonce,row.fixtureId,row.contextNonce]) assert.match(id,uuid);
  assert.match(row.plannedPostgresqlVersion,/^[1-9][0-9]*\.[0-9]+$/u);
  assert.match(row.gitSha,/^[a-f0-9]{40}$/u); for (const digest of [row.profileDigest,row.fixtureDigest,row.manifestDigest]) assert.match(digest,hash);
  assert.match(row.expectedDatabase,/^[a-z][a-z0-9_]{0,62}$/u); assert.match(row.expectedBranch,/^br-[a-z0-9-]{1,100}$/u);
  assert(Number.isSafeInteger(row.workDeadlineAt) && row.workDeadlineAt > 0 && row.workDeadlineAt <= Date.now() + integrationLifecycleEnvelope(row.profile).workMs, 'invalid supervised work deadline');
  assert(typeof row.evidenceDirectory==='string'&&isAbsolute(row.evidenceDirectory)&&resolve(row.evidenceDirectory)===row.evidenceDirectory);
  assert.equal(basename(row.evidenceDirectory),'fleet-raw-'+row.nonce,'invalid worker artifact directory');
  return Object.freeze({ ...row });
}
/** The only accepted origin is the supervisor's original work budget, never a caller-selected duration. */
export function fleetSupervisedWorkDeadline(environment:Record<string,string|undefined>,profile:FleetProfile=FLEET_HEALTHY_PROFILE):number {
  const text=environment[INTEGRATION_WORK_DEADLINE_ENV];assert(text&&/^[1-9][0-9]*$/u.test(text),'supervised deadline required');
  const deadline=Number(text);assert(Number.isSafeInteger(deadline)&&deadline<=Date.now()+integrationLifecycleEnvelope(profile).workMs,'invalid supervised deadline');return deadline;
}
export function fleetEnvironment(source: Record<string,string|undefined>, runtimeUrl: string, config: FleetConfig) {
  parseFleetConfig(config); assert.equal(config.workDeadlineAt, fleetSupervisedWorkDeadline(source,config.profile), 'supervisor deadline changed');
  const artifactRoot=source.PROJECTION_INTEGRATION_ARTIFACT_DIRECTORY; assert(artifactRoot&&isAbsolute(artifactRoot),'bound artifact directory required');
  assert.equal(config.evidenceDirectory,resolve(join(artifactRoot,'fleet-raw-'+config.nonce)),'worker artifact directory escaped bound run');
  const url=new URL(runtimeUrl);
  assert(['postgres:','postgresql:'].includes(url.protocol)); assert.equal(decodeURIComponent(url.username),'league_one_runtime');
  assert(['require','verify-ca','verify-full'].includes(url.searchParams.get('sslmode') ?? '')); assert.equal(decodeURIComponent(url.pathname.slice(1)),config.expectedDatabase);
  return { ...integrationChildEnvironment(source), DATABASE_URL:runtimeUrl, [FLEET_CONFIG]:JSON.stringify(config) };
}
export const FLEET_ACTIONS = ['omitted','false','prepare','run-healthy','run-recovery','snapshot','stop'] as const;
export type FleetAction = typeof FLEET_ACTIONS[number];
export type FleetCommand = { version:typeof FLEET_VERSION; nonce:string; sequence:number; action:FleetAction };
export function parseFleetCommand(value:unknown,config:FleetConfig,sequence:number):FleetCommand {
  const row=object(value) as FleetCommand;fleetKeys(row,['version','nonce','sequence','action']);assert.equal(row.version,FLEET_VERSION);assert.equal(row.nonce,config.nonce);
  assert(Number.isSafeInteger(sequence)&&sequence>=1&&sequence<=16);assert.equal(row.sequence,sequence);assert(FLEET_ACTIONS.includes(row.action));
  if(row.action==='run-healthy')assert.equal(config.profile,FLEET_HEALTHY_PROFILE,'profile command mismatch');
  if(row.action==='run-recovery')assert.equal(config.profile,FLEET_RECOVERY_PROFILE,'profile command mismatch');return row;
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
    if((row.action==='run-healthy'||row.action==='run-recovery')&&!row.error)assert(row.inventory,'complete fleet result requires immutable evidence inventory');}
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
