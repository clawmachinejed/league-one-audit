import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { integrationChildEnvironment } from './disposable-integration';
import { createBackendControlsDatabaseFetchGuard } from './backend-controls-fetch';

export const BATCH_CONFIG = 'CP26_BATCH_CALIBRATION_CONFIG';
export const BATCH_VERSION = 'cp26-batch-calibration-v1';
export const batchHash = (value: string) => createHash('sha256').update(value).digest('hex');
/** Exact reviewed maintained-store statements, used only to bind observation inventory. */
export const BATCH_SQL = {
  submit: `/* public-data-intake:submit-with-receipt */
        SELECT public.submit_public_data_intake($1::jsonb,true) AS result`,
  begin: `/* public-data-intake:begin-batch */
        SELECT public.begin_public_data_batch($1::text,$2::timestamptz,$3::uuid) AS result`,
  advance: `/* public-data-intake:advance-batch */
        SELECT public.advance_public_data_batch_owner($1::jsonb,$2::text) AS result`,
  next: '/* public-data-intake:next-batch */ SELECT public.next_public_data_batch_intake($1::uuid) AS result',
  admit: `/* public-data-intake:admit-batch */
        SELECT public.admit_public_data_batch_dispatch($1::jsonb,$2::jsonb) AS admitted`,
  checkpoint: `/* public-data-intake:checkpoint */
      SELECT public.checkpoint_public_data_intake($1::jsonb,$2::jsonb,$3::jsonb)`,
} as const;
export const batchUuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/u;
export function batchKeys(value: object, keys: readonly string[]) { assert.deepEqual(Object.keys(value).sort(), [...keys].sort()); }
export type BatchConfig = { nonce: string; fixtureId: string; requestId: string; contextNonce: string; gitSha: string;
  profileDigest: string; expectedDatabase: string; expectedBranch: string };
export function parseBatchConfig(value: unknown): BatchConfig {
  assert(value && typeof value === 'object' && !Array.isArray(value));
  batchKeys(value, ['nonce','fixtureId','requestId','contextNonce','gitSha','profileDigest','expectedDatabase','expectedBranch']);
  const row = value as BatchConfig;
  for (const id of [row.nonce,row.fixtureId,row.requestId,row.contextNonce]) assert.match(id,batchUuid);
  assert.match(row.gitSha,/^[0-9a-f]{40}$/u); assert.match(row.profileDigest,/^[0-9a-f]{64}$/u);
  assert.match(row.expectedDatabase,/^[a-z][a-z0-9_]{0,62}$/u); assert.match(row.expectedBranch,/^br-[a-z0-9-]{1,100}$/u);
  return row;
}
export function batchEnvironment(source: Record<string,string|undefined>, url: string, config: BatchConfig) {
  parseBatchConfig(config); const parsed = new URL(url);
  assert(['postgres:','postgresql:'].includes(parsed.protocol)); assert.equal(decodeURIComponent(parsed.username),'league_one_runtime');
  assert(['require','verify-full','verify-ca'].includes(parsed.searchParams.get('sslmode') ?? ''));
  assert.equal(decodeURIComponent(parsed.pathname.slice(1)),config.expectedDatabase);
  return { ...integrationChildEnvironment(source), DATABASE_URL:url, [BATCH_CONFIG]:JSON.stringify(config) };
}
export type BatchAction = 'omitted'|'false'|'submit'|'enabled'|'stop';
export type BatchCommand = { version:typeof BATCH_VERSION; nonce:string; sequence:number; action:BatchAction };
export function parseBatchCommand(value:unknown, config:BatchConfig, sequence:number):BatchCommand {
  assert(value && typeof value==='object' && !Array.isArray(value));batchKeys(value,['version','nonce','sequence','action']);
  const row=value as BatchCommand;assert.equal(row.version,BATCH_VERSION);assert.equal(row.nonce,config.nonce);assert.equal(row.sequence,sequence);
  assert(['omitted','false','submit','enabled','stop'].includes(row.action));return row;
}
export type BatchSpan = { startedAt:string; endedAt:string; monotonicStartMs:number; monotonicEndMs:number };
export function batchStart() { return {startedAt:new Date().toISOString(),monotonicStartMs:performance.now()}; }
export function batchEnd(start:ReturnType<typeof batchStart>):BatchSpan { return {...start,endedAt:new Date().toISOString(),monotonicEndMs:performance.now()}; }
export function assertBatchSpan(span:BatchSpan) {
  assert.equal(new Date(span.startedAt).toISOString(),span.startedAt);assert.equal(new Date(span.endedAt).toISOString(),span.endedAt);
  assert(Date.parse(span.endedAt)>=Date.parse(span.startedAt));assert(Number.isFinite(span.monotonicStartMs)&&span.monotonicStartMs>=0);
  assert(Number.isFinite(span.monotonicEndMs)&&span.monotonicEndMs>=span.monotonicStartMs);
}
export type BatchAttempt = BatchSpan & { kind:'source'|'sql'; method:'GET'|'POST'; key:string; bodySha256:string|null;
  sourceVersion:typeof BATCH_VERSION|null; status:'ok'|'failed'; signal:boolean };
export type BatchOwner = {kind:'acquired';fence:{jobKey:string;workerId:string;generation:number;deadlineAt:string};
  leaseUntil:string;admissionDeadlineAt:string;cleanupDeadlineAt:string};
export type BatchMessage = {version:typeof BATCH_VERSION;nonce:string;contextNonce:string;gitSha:string;profileDigest:string;
  pid:number;backendPid:number;backendStart:string;database:string;branch:string;sessionUser:string;currentUser:string;
  httpSessionUser:string;httpCurrentUser:string;type:'ready'|'result';sequence:number;action:BatchAction|null;
  span:BatchSpan;attempts:BatchAttempt[];owners:BatchOwner[];result:Record<string,unknown>|null;error:boolean};
export function parseBatchMessage(value:unknown, config:BatchConfig,pid:number):BatchMessage {
  assert(value&&typeof value==='object'&&!Array.isArray(value));
  batchKeys(value,['version','nonce','contextNonce','gitSha','profileDigest','pid','backendPid','backendStart','database','branch','sessionUser','currentUser',
    'httpSessionUser','httpCurrentUser','type','sequence','action','span','attempts','owners','result','error']);
  const row=value as BatchMessage;
  assert.equal(row.version,BATCH_VERSION);assert.equal(row.nonce,config.nonce);assert.equal(row.contextNonce,config.contextNonce);
  assert.equal(row.gitSha,config.gitSha);assert.equal(row.profileDigest,config.profileDigest);assert.equal(row.pid,pid);
  assert(Number.isSafeInteger(row.backendPid)&&row.backendPid>1);assert(Number.isFinite(Date.parse(row.backendStart)));
  assert.equal(row.database,config.expectedDatabase);assert.equal(row.branch,config.expectedBranch);
  for(const role of [row.sessionUser,row.currentUser,row.httpSessionUser,row.httpCurrentUser])assert.equal(role,'league_one_runtime');
  assert(['ready','result'].includes(row.type));assert(Number.isInteger(row.sequence)&&row.sequence>=0&&row.sequence<=4);
  assert(typeof row.error==='boolean');assertBatchSpan(row.span);assert(Array.isArray(row.attempts)&&row.attempts.length<=1_000);
  assert(Array.isArray(row.owners)&&row.owners.length<=40);
  for(const attempt of row.attempts){batchKeys(attempt,['startedAt','endedAt','monotonicStartMs','monotonicEndMs','kind','method','key','bodySha256','sourceVersion','status','signal']);assertBatchSpan(attempt);assert(['source','sql'].includes(attempt.kind));assert(['GET','POST'].includes(attempt.method));
    assert(['ok','failed'].includes(attempt.status));assert(typeof attempt.signal==='boolean');
    assert(attempt.kind==='source'? /^\/v1\/(?:user|league)\/[a-zA-Z0-9_/-]{1,100}$/u.test(attempt.key):/^[0-9a-f]{64}$/u.test(attempt.key));
    assert(attempt.kind==='source'?attempt.sourceVersion===BATCH_VERSION&&typeof attempt.bodySha256==='string'&&/^[0-9a-f]{64}$/u.test(attempt.bodySha256):attempt.sourceVersion===null&&attempt.bodySha256===null);}
  for(const owner of row.owners){batchKeys(owner,['kind','fence','leaseUntil','admissionDeadlineAt','cleanupDeadlineAt']);assert.equal(owner.kind,'acquired');
    batchKeys(owner.fence,['jobKey','workerId','generation','deadlineAt']);assert.equal(owner.fence.jobKey,'league-administration-public-intake');assert.match(owner.fence.workerId,batchUuid);
    assert(Number.isSafeInteger(owner.fence.generation)&&owner.fence.generation>0);
    for(const stamp of [owner.fence.deadlineAt,owner.leaseUntil,owner.admissionDeadlineAt,owner.cleanupDeadlineAt])assert(typeof stamp==='string'&&Number.isFinite(Date.parse(stamp)));}
  if(row.type==='ready'){assert.equal(row.sequence,0);assert.equal(row.action,null);assert.equal(row.result,null);assert.equal(row.error,false);assert.equal(row.attempts.length,0);assert.equal(row.owners.length,0);}
  else assert(['omitted','false','submit','enabled'].includes(row.action ?? ''));
  return row;
}
/** Four unrelated native synthetic leagues; source transport only is intercepted.
 * The maintained Sleeper capture/normalizer, runtime SQL and stored readers remain real. */
export function batchFixture(fixtureId:string) {
  assert.match(fixtureId,batchUuid);const hash=batchHash(fixtureId),manager='7'+BigInt('0x'+hash.slice(0,14));
  const username='cp26_'+manager, payloads=new Map<string,unknown>();
  const leagues=Array.from({length:4},(_,index)=>{
    const external='8'+BigInt('0x'+batchHash(fixtureId+':'+index).slice(0,14));const player='cp26player'+index;
    const league={league_id:external,season:'2026',sport:'nfl',season_type:'regular',name:'CP26 calibration league '+index,
      status:'in_season',total_rosters:2,roster_positions:['QB','BN'],scoring_settings:{pass_yd:0.04},
      settings:{type:index===2?2:index===3?0:1,leg:1,last_scored_leg:0,start_week:1,playoff_week_start:15}};
    const rosters=[1,2].map(roster_id=>({roster_id,owner_id:roster_id===1?manager:null,co_owners:[],players:roster_id===1?[player]:[],
      starters:roster_id===1?[player]:[],reserve:[],taxi:[],settings:{wins:0,losses:0,ties:0,fpts:0,fpts_decimal:0,waiver_budget_used:0}}));
    const matchups=[1,2].map(roster_id=>({roster_id,matchup_id:1,players:roster_id===1?[player]:[],starters:roster_id===1?[player]:[],
      points:roster_id===1?index+0.25:0,starters_points:roster_id===1?[index+0.25]:[],players_points:roster_id===1?{[player]:index+0.25}:{}}));
    const base='/v1/league/'+external;payloads.set(base,league);payloads.set(base+'/rosters',rosters);payloads.set(base+'/matchups/1',matchups);
    payloads.set(base+'/users',[{user_id:manager,display_name:username}]);return {external,player,league,rosters,matchups};
  });
  payloads.set('/v1/user/'+username,{user_id:manager,username});payloads.set('/v1/user/'+manager+'/leagues/nfl/2026',leagues.map(row=>row.league));
  return {manager,username,leagues,payloads};
}
export function batchFetch(options:{runtimeUrl:string;fixtureId:string;originalFetch:typeof fetch;
  attempt:(attempt:BatchAttempt)=>void;owner:(owner:BatchOwner)=>void}):typeof fetch {
  const isDatabase=createBackendControlsDatabaseFetchGuard(options.runtimeUrl),fixture=batchFixture(options.fixtureId);
  return async(input,init)=>{
    const start=batchStart(),request=input instanceof Request?input:undefined,url=new URL(request?request.url:String(input));
    const signal=init?.signal??request?.signal,method=init?.method??request?.method??'GET';
    if(isDatabase(input,init)){
      const envelope=typeof init?.body==='string'?JSON.parse(init.body):null;
      const query=typeof envelope?.query==='string'?envelope.query:JSON.stringify(envelope?.queries?.map((row:{query:string})=>row.query)??[]);
      let status:'ok'|'failed'='failed';try{const response=await options.originalFetch(input,init);
        // Only tiny owner results are cloned. This deliberately includes observer cost;
        // other SQL spans end at response headers and are not server execution time.
        if(/public-data-intake:(?:begin|advance)-batch/u.test(query)&&response.ok){const wire=await response.clone().json();
          const raw=wire.rows?.[0]?.[0];const owner=typeof raw==='string'?JSON.parse(raw):raw;if(owner?.kind==='acquired')options.owner(owner);}
        status=response.ok?'ok':'failed';return response;
      }finally{options.attempt({...batchEnd(start),kind:'sql',method:'POST',key:batchHash(query),bodySha256:null,sourceVersion:null,status,signal:Boolean(signal)});}
    }
    if(url.origin!=='https://api.sleeper.app'||url.search||url.hash||method!=='GET'||!fixture.payloads.has(url.pathname))throw new Error('CP26 nonfixture HTTP rejected.');
    const body=JSON.stringify(fixture.payloads.get(url.pathname));let status:'ok'|'failed'='failed';
    try{signal?.throwIfAborted();const response=new Response(body,{headers:{'content-type':'application/json'}});status='ok';return response;}
    finally{options.attempt({...batchEnd(start),kind:'source',method:'GET',key:url.pathname,bodySha256:batchHash(body),sourceVersion:BATCH_VERSION,status,signal:Boolean(signal)});}
  };
}
