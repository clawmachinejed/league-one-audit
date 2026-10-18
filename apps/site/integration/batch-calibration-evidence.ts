import assert from 'node:assert/strict';
import { join } from 'node:path';
import { writeFile } from 'node:fs/promises';
import { qualificationDigest,type QualificationBinding } from './qualification-profile';
import { BATCH_SQL,batchKeys,batchUuid,batchFixture,batchHash,assertBatchSpan,parseBatchMessage,type BatchConfig,type BatchMessage,type BatchSpan } from './batch-calibration-protocol';

export const BATCH_EVIDENCE_FILE='batch-calibration-evidence.json';
export const BATCH_CASE_NAMES=[
  'keeps omitted and false batch selections free of DATA writes and acquisition',
  'completes four fresh leagues in one bounded ordinary backend batch',
  'retains exact source receipt and stored reader parity without protected mutation',
] as const;
export const BATCH_CASE_LIMITS=[60_000,90_000,60_000] as const;
export type BatchDispatch={workerId:string;generation:number;resource:string;leagueId:string|null;admittedAt:string;outcomeAt:string;deadlineAt:string;
  maxRequests:number;outcome:string;work:Record<string,unknown>};
export type BatchMember={playerId:string;section:string;nativeSection:string|null};
export type BatchCoreValues={rosters:{rosterId:string;players:BatchMember[];
  starters:{index:number;nativeId:string;empty:boolean;membership:BatchMember|null}[]|null;
  reserve:BatchMember[]|null;taxi:BatchMember[]|null;bench:BatchMember[]|null}[];
  managers:{rosterId:string;primaryState:string;primaryId:string|null;coState:string;coIds:string[]|null}[];
  directory:{managerId:string;displayName:string|null;username:string|null}[]};
export function expectedBatchCore(manager:string,username:string,player:string):BatchCoreValues {
  return {rosters:[{rosterId:'1',players:[{playerId:player,section:'roster',nativeSection:'players'}],
    starters:[{index:0,nativeId:player,empty:false,membership:{playerId:player,section:'active',nativeSection:'starters'}}],reserve:[],taxi:[],bench:[]},
    {rosterId:'2',players:[],starters:[],reserve:[],taxi:[],bench:[]}],
    managers:[{rosterId:'1',primaryState:'owned',primaryId:manager,coState:'known',coIds:[]},
      {rosterId:'2',primaryState:'unowned',primaryId:null,coState:'known',coIds:[]}],
    directory:[{managerId:manager,displayName:username,username:null}]};
}
export type BatchHead={leagueId:string;leagueSeasonId:string;settingsReceipt:string;rosterReceipt:string;managersReceipt:string;directoryCapture:string;
  exactReceipt:string;readerDigest:string;points:string;starters:string[];core:BatchCoreValues};
export type BatchReceipt={id:string;contentId:string;leagueId:string;family:string;workerId:string;generation:number;work:Record<string,unknown>;payload:unknown};
export type BatchDirectory={id:string;leagueId:string;workerId:string;generation:number;payload:unknown};
export type BatchCalibrationEvidence={kind:'data-batch-calibration-evidence-v1';contextDigest:string;gitSha:string;config:BatchConfig;ready:BatchMessage|null;
  serverVersion:string;serverVersionNum:string;calls:BatchMessage[];cases:{name:string;limitMs:number;state:'unserved'|'running'|'passed'|'failed';span:BatchSpan|null}[];
  dispatches:BatchDispatch[];heads:BatchHead[];receipts:BatchReceipt[];directories:BatchDirectory[];readerSpan:BatchSpan|null;readerRequests:number;historyBefore:string|null;historyAfter:string|null;
  protectedBefore:string|null;protectedAfter:string|null;disabledBefore:string|null;disabledAfter:string|null;storedBefore:string|null;storedAfter:string|null;
  terminal:boolean;finalGeneration:number;finalJobState:string;cleanupComplete:boolean;source:'synthetic-native-fetch';scope:'single-batch-calibration-only';
  limitations:readonly string[]};
export const BATCH_LIMITATIONS=[
  'Synthetic source fetch responses do not measure live provider latency.',
  'SQL fetch spans end at response headers except owner-result observation; they are not isolated server execution times.',
  'This is the ordinary backend intake operator, not the projection runner or healthy-owner coexistence proof.',
  'No transactions, reports, full history, recurring cadence, sixteen-league freshness, outage or backlog qualification.',
  'One enabled invocation only; no failed, busy, deadline or incomplete call may be retried or omitted.',
] as const;
const digest=(value:unknown)=>assert.match(String(value),/^[0-9a-f]{64}$/u);
const time=(value:string)=>{const parsed=Date.parse(value);assert(Number.isFinite(parsed));return parsed;};
export function assertCompleteBatchCalibrationEvidence(value:BatchCalibrationEvidence,binding:QualificationBinding){
  assert(value&&typeof value==='object');assert(Buffer.byteLength(JSON.stringify(value))<2*1024*1024);
  batchKeys(value,['kind','contextDigest','gitSha','config','ready','serverVersion','serverVersionNum','calls','cases','dispatches','heads','readerSpan','readerRequests',
    'receipts','directories','historyBefore','historyAfter','protectedBefore','protectedAfter','disabledBefore','disabledAfter','storedBefore','storedAfter','terminal','finalGeneration','finalJobState','cleanupComplete','source','scope','limitations']);
  assert.equal(value.kind,'data-batch-calibration-evidence-v1');assert.equal(binding.context.profile,'data-batch-calibration-v1');
  assert.equal(value.contextDigest,qualificationDigest(binding.context));assert.equal(value.gitSha,binding.context.gitSha);
  assert.equal(value.config.contextNonce,binding.context.nonce);assert.equal(value.config.profileDigest,binding.context.profileDigest);assert.equal(value.config.gitSha,value.gitSha);
  assert.match(value.serverVersionNum,/^[0-9]{5,6}$/u);assert(value.serverVersion.length>0&&value.serverVersion.length<500);
  assert.equal(value.source,'synthetic-native-fetch');assert.equal(value.scope,'single-batch-calibration-only');assert.deepEqual(value.limitations,BATCH_LIMITATIONS);
  assert.equal(value.cleanupComplete,true);assert(value.ready);parseBatchMessage(value.ready,value.config,value.ready.pid);
  assert.equal(value.ready.type,'ready');assert.equal(value.cases.length,3);
  for(const [index,entry] of value.cases.entries()){assert.equal(entry.name,BATCH_CASE_NAMES[index]);assert.equal(entry.limitMs,BATCH_CASE_LIMITS[index]);
    assert.equal(entry.state,'passed');assert(entry.span);assertBatchSpan(entry.span);assert(entry.span.monotonicEndMs-entry.span.monotonicStartMs<=entry.limitMs);
    if(index)assert(time(entry.span.startedAt)>=time(value.cases[index-1].span!.endedAt));}
  assert.deepEqual(value.calls.map(row=>row.action),['omitted','false','submit','enabled']);
  for(const [index,row] of value.calls.entries()){parseBatchMessage(row,value.config,value.ready.pid);assert.equal(row.type,'result');assert.equal(row.sequence,index+1);
    assert.equal(row.error,false);assert(row.span.monotonicEndMs-row.span.monotonicStartMs<=30_000);
    if(index)assert(time(row.span.startedAt)>=time(value.calls[index-1].span.endedAt));
    assert.equal(row.backendPid,value.ready.backendPid);assert.equal(row.backendStart,value.ready.backendStart);
    for(const attempt of row.attempts){assert.equal(attempt.status,'ok');assert.equal(attempt.signal,true);
      assert(attempt.monotonicStartMs>=row.span.monotonicStartMs&&attempt.monotonicEndMs<=row.span.monotonicEndMs);
      assert(time(attempt.startedAt)>=time(row.span.startedAt)&&time(attempt.endedAt)<=time(row.span.endedAt));}}
  for(const row of value.calls.slice(0,2)){assert.deepEqual(row.result,{status:'disabled',providerRequests:0});assert.equal(row.attempts.length,0);assert.equal(row.owners.length,0);}
  const submitted=value.calls[2];assert.deepEqual(submitted.result,{status:'retained',requestId:value.config.requestId});assert.equal(submitted.attempts.filter(row=>row.kind==='source').length,0);assert.equal(submitted.owners.length,0);
  assert.equal(submitted.attempts.filter(row=>row.kind==='sql'&&row.key===batchHash(BATCH_SQL.submit)).length,1);assert(submitted.attempts.length>=2);
  const enabled=value.calls[3],origin=time(enabled.span.startedAt);
  assert.deepEqual(enabled.result,{status:'complete',providerRequests:26,completedSteps:18,stopReason:'work-status'});
  assert(enabled.span.monotonicEndMs-enabled.span.monotonicStartMs<=22_000);
  const sqlAttempts=enabled.attempts.filter(row=>row.kind==='sql');
  for(const [operation,count] of [['begin',1],['advance',18],['next',19],['admit',18],['checkpoint',18]] as const){
    assert.equal(sqlAttempts.filter(row=>row.key===batchHash(BATCH_SQL[operation])).length,count);}
  const ownerAttempts=sqlAttempts.filter(row=>[batchHash(BATCH_SQL.begin),batchHash(BATCH_SQL.advance)].includes(row.key)).sort((left,right)=>left.monotonicStartMs-right.monotonicStartMs);
  assert.equal(ownerAttempts[0].key,batchHash(BATCH_SQL.begin));
  assert.equal(enabled.owners.length,19);assert.equal(new Set(enabled.owners.map(owner=>owner.fence.workerId)).size,19);
  for(const [index,owner] of enabled.owners.entries()){assert.equal(owner.kind,'acquired');assert.match(owner.fence.workerId,batchUuid);
    assert.equal(owner.fence.generation,index+1);assert.equal(owner.fence.jobKey,'league-administration-public-intake');
    assert.equal(time(owner.fence.deadlineAt),origin+20_000);assert.equal(time(owner.admissionDeadlineAt),origin+10_000);
    assert.equal(time(owner.cleanupDeadlineAt),origin+22_000);assert.equal(time(owner.leaseUntil),origin+25_000);}
  const fixture=batchFixture(value.config.fixtureId),sources=enabled.attempts.filter(row=>row.kind==='source');assert.equal(sources.length,26);
  for(const source of sources){assert.equal(source.method,'GET');assert.equal(source.bodySha256,batchHash(JSON.stringify(fixture.payloads.get(source.key))));}
  assert.equal(value.dispatches.length,18);const used=new Set<number>(),inventory:string[]=[];
  for(const [index,dispatch] of value.dispatches.entries()){
    assert.equal(dispatch.workerId,enabled.owners[index].fence.workerId);assert.equal(dispatch.generation,index+1);
    const work={kind:dispatch.resource,requestId:value.config.requestId,revision:index,...(dispatch.resource==='identity'?{username:fixture.username}
      :dispatch.resource==='leagues'?{userId:fixture.manager,season:2026}:{externalLeagueId:dispatch.leagueId,season:2026,...(dispatch.resource==='exact-matchups'?{nativeWeek:1}:{})})};
    assert.deepEqual(dispatch.work,work);
    assert(time(ownerAttempts[index].endedAt)<=time(dispatch.admittedAt));
    if(index)assert(time(ownerAttempts[index].startedAt)>=time(value.dispatches[index-1].outcomeAt));
    assert.equal(dispatch.outcome,'checkpoint-committed');assert.equal(time(dispatch.deadlineAt),origin+20_000);
    assert(time(dispatch.admittedAt)>=origin&&time(dispatch.admittedAt)<origin+10_000);
    assert(time(dispatch.outcomeAt)>=time(dispatch.admittedAt)&&time(dispatch.outcomeAt)<=origin+20_000);
    const base='/v1/league/'+dispatch.leagueId;
    const paths=dispatch.resource==='identity'?['/v1/user/'+fixture.username]:dispatch.resource==='leagues'?['/v1/user/'+fixture.manager+'/leagues/nfl/2026']
      :dispatch.resource==='bootstrap'?[base]:dispatch.resource==='exact-matchups'?[base,base+'/matchups/1']
      :dispatch.resource==='core'?[base,base+'/rosters']:dispatch.resource==='users'?[base+'/users']:[];
    assert(paths.length>0);assert.equal(dispatch.maxRequests,paths.length);inventory.push(dispatch.resource+':'+(dispatch.leagueId??''));
    if(dispatch.leagueId!==null){assert(fixture.leagues.some(row=>row.external===dispatch.leagueId));}
    const matching=sources.map((source,ordinal)=>({source,ordinal})).filter(({source,ordinal})=>!used.has(ordinal)&&time(source.startedAt)>=time(dispatch.admittedAt)&&time(source.endedAt)<=time(dispatch.outcomeAt));
    assert.deepEqual(matching.map(row=>row.source.key).sort(),paths.sort());matching.forEach(row=>used.add(row.ordinal));
  }
  assert(time(ownerAttempts[18].startedAt)>=time(value.dispatches[17].outcomeAt));
  assert.equal(used.size,26);assert.deepEqual(inventory.sort(),['identity:','leagues:',...fixture.leagues.flatMap(row=>['bootstrap','exact-matchups','core','users'].map(kind=>kind+':'+row.external))].sort());
  assert.equal(value.terminal,true);assert.equal(value.finalGeneration,19);assert.equal(value.finalJobState,'completed');assert.equal(value.readerRequests,0);
  assert(value.readerSpan);assertBatchSpan(value.readerSpan);assert(time(value.readerSpan.startedAt)>=time(enabled.span.endedAt));
  assert.equal(value.directories.length,4);assert(value.receipts.length>=16&&value.receipts.length<=100);
  assert.equal(new Set(value.receipts.map(row=>row.id)).size,value.receipts.length);
  for(const receipt of value.receipts){assert.match(receipt.id,batchUuid);assert.match(receipt.contentId,batchUuid);
    const dispatch=value.dispatches.find(row=>row.workerId===receipt.workerId&&row.generation===receipt.generation);assert(dispatch);
    assert.equal(receipt.leagueId,dispatch.leagueId);assert.deepEqual(receipt.work,dispatch.work);
    assert(['league','rosters','matchups'].includes(receipt.family));
    const suffix=receipt.family==='league'?'':receipt.family==='matchups'?'/matchups/1':'/rosters';
    assert.deepEqual(receipt.payload,fixture.payloads.get('/v1/league/'+receipt.leagueId+suffix));}
  assert.equal(value.heads.length,4);assert.equal(new Set(value.heads.map(row=>row.leagueId)).size,4);
  for(const [index,league] of fixture.leagues.entries()){const head=value.heads.find(row=>row.leagueId===league.external);assert(head);
    for(const id of [head.leagueSeasonId,head.settingsReceipt,head.rosterReceipt,head.managersReceipt,head.directoryCapture,head.exactReceipt])assert.match(id,batchUuid);
    for(const [id,family] of [[head.settingsReceipt,'league'],[head.rosterReceipt,'rosters'],[head.managersReceipt,'rosters'],[head.exactReceipt,'matchups']]){
      const receipt=value.receipts.find(row=>row.id===id);assert(receipt);assert.equal(receipt.leagueId,league.external);assert.equal(receipt.family,family);}
    const directory=value.directories.find(row=>row.id===head.directoryCapture);assert(directory);assert.equal(directory.leagueId,league.external);
    assert.deepEqual(directory.payload,fixture.payloads.get('/v1/league/'+league.external+'/users'));
    assert(value.dispatches.some(row=>row.resource==='users'&&row.leagueId===league.external&&row.workerId===directory.workerId&&row.generation===directory.generation));
    assert.deepEqual(head.core,expectedBatchCore(fixture.manager,fixture.username,league.player));
    digest(head.readerDigest);assert.equal(head.points,String(index+0.25));assert.deepEqual(head.starters,[league.player]);}
  for(const [before,after] of [[value.historyBefore,value.historyAfter],[value.protectedBefore,value.protectedAfter],[value.disabledBefore,value.disabledAfter],[value.storedBefore,value.storedAfter]]){
    digest(before);digest(after);assert.equal(before,after);}
}
/** Always retain failed partial evidence; only the separate complete validator can accept it. */
export async function writeBatchCalibrationEvidence(binding:QualificationBinding,value:BatchCalibrationEvidence){
  const bytes=JSON.stringify(value,null,2)+'\n';assert(Buffer.byteLength(bytes)<2*1024*1024);
  await writeFile(join(binding.directory,BATCH_EVIDENCE_FILE),bytes,{encoding:'utf8',flag:'wx'});
}
