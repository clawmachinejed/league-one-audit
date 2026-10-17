import { randomUUID } from 'node:crypto';
import { describe,expect,it } from 'vitest';
import { qualificationDigest,type QualificationBinding } from './qualification-profile';
import { BATCH_SQL,BATCH_VERSION,batchFixture,batchHash,type BatchMessage,type BatchOwner,type BatchSpan } from './batch-calibration-protocol';
import { expectedBatchCore,BATCH_CASE_NAMES,BATCH_CASE_LIMITS,BATCH_LIMITATIONS,assertCompleteBatchCalibrationEvidence,type BatchCalibrationEvidence } from './batch-calibration-evidence';
const epoch=Date.UTC(2026,9,16),at=(ms:number)=>new Date(epoch+ms).toISOString();
const span=(start:number,end:number):BatchSpan=>({startedAt:at(start),endedAt:at(end),monotonicStartMs:start,monotonicEndMs:end});
/** Validator-only synthetic evidence. Never presented as an executed calibration. */
function fixture(){
  const context:QualificationBinding['context']={kind:'integration-qualification-context-v1',gitSha:'a'.repeat(40),runId:randomUUID(),nonce:randomUUID(),
    profile:'data-batch-calibration-v1',profileDigest:'b'.repeat(64),modules:[]};
  const binding={context,directory:'unused'},config={nonce:randomUUID(),fixtureId:randomUUID(),requestId:randomUUID(),contextNonce:context.nonce,
    gitSha:context.gitSha,profileDigest:context.profileDigest,expectedDatabase:'calibration_test',expectedBranch:'br-test'};
  const source=batchFixture(config.fixtureId);
  const ready:BatchMessage={version:BATCH_VERSION,nonce:config.nonce,contextNonce:context.nonce,gitSha:context.gitSha,profileDigest:context.profileDigest,
    pid:100,backendPid:200,backendStart:at(0),database:config.expectedDatabase,branch:config.expectedBranch,sessionUser:'league_one_runtime',currentUser:'league_one_runtime',
    httpSessionUser:'league_one_runtime',httpCurrentUser:'league_one_runtime',type:'ready',sequence:0,action:null,span:span(0,1),attempts:[],owners:[],result:null,error:false};
  const call=(action:BatchMessage['action'],sequence:number,start:number,end:number,result:Record<string,unknown>):BatchMessage=>({...structuredClone(ready),type:'result',action,sequence,span:span(start,end),result});
  const enabled=call('enabled',4,1_000,4_000,{status:'complete',providerRequests:26,completedSteps:18,stopReason:'work-status'});
  const value:BatchCalibrationEvidence={kind:'data-batch-calibration-evidence-v1',contextDigest:qualificationDigest(context),gitSha:context.gitSha,config,ready,
    serverVersion:'PostgreSQL 18.6 synthetic validator fixture',serverVersionNum:'180006',
    calls:[call('omitted',1,100,200,{status:'disabled',providerRequests:0}),call('false',2,300,400,{status:'disabled',providerRequests:0}),
      call('submit',3,500,600,{status:'retained',requestId:config.requestId}),enabled],
    cases:BATCH_CASE_NAMES.map((name,index)=>({name,limitMs:BATCH_CASE_LIMITS[index],state:'passed',span:[span(50,450),span(480,4_500),span(5_000,5_500)][index]})),
    dispatches:[],heads:[],receipts:[],directories:[],readerSpan:span(5_010,5_100),readerRequests:0,historyBefore:'c'.repeat(64),historyAfter:'c'.repeat(64),
    protectedBefore:'d'.repeat(64),protectedAfter:'d'.repeat(64),disabledBefore:'e'.repeat(64),disabledAfter:'e'.repeat(64),storedBefore:'f'.repeat(64),storedAfter:'f'.repeat(64),
    terminal:true,finalGeneration:19,finalJobState:'completed',cleanupComplete:true,source:'synthetic-native-fetch',scope:'single-batch-calibration-only',limitations:BATCH_LIMITATIONS};
  const stages=[{resource:'identity',leagueId:null},{resource:'leagues',leagueId:null},...source.leagues.flatMap(row=>['bootstrap','exact-matchups','core','users'].map(resource=>({resource,leagueId:row.external})))];
  enabled.owners=Array.from({length:19},(_,index):BatchOwner=>({kind:'acquired',fence:{jobKey:'league-administration-public-intake',workerId:randomUUID(),generation:index+1,deadlineAt:at(21_000)},
    leaseUntil:at(26_000),admissionDeadlineAt:at(11_000),cleanupDeadlineAt:at(23_000)}));
  for(const [index,stage] of stages.entries()){
    const owner=enabled.owners[index],start=1_100+index*100,base='/v1/league/'+stage.leagueId;
    const paths=stage.resource==='identity'?['/v1/user/'+source.username]:stage.resource==='leagues'?['/v1/user/'+source.manager+'/leagues/nfl/2026']
      :stage.resource==='bootstrap'?[base]:stage.resource==='exact-matchups'?[base,base+'/matchups/1']:stage.resource==='core'?[base,base+'/rosters']:[base+'/users'];
    const work={kind:stage.resource,requestId:config.requestId,revision:index,...(stage.resource==='identity'?{username:source.username}
      :stage.resource==='leagues'?{userId:source.manager,season:2026}:{externalLeagueId:stage.leagueId,season:2026,...(stage.resource==='exact-matchups'?{nativeWeek:1}:{})})};
    value.dispatches.push({...stage,workerId:owner.fence.workerId,generation:index+1,work,maxRequests:paths.length,admittedAt:at(start),outcomeAt:at(start+80),deadlineAt:at(21_000),outcome:'checkpoint-committed'});
    for(const path of paths)enabled.attempts.push({...span(start+10,start+20),kind:'source',method:'GET',key:path,bodySha256:batchHash(JSON.stringify(source.payloads.get(path))),sourceVersion:BATCH_VERSION,status:'ok',signal:true});
    if(stage.resource==='core'||stage.resource==='exact-matchups')for(const family of stage.resource==='core'?['league','rosters','rosters']:['league','matchups']){
      const suffix=family==='league'?'':family==='matchups'?'/matchups/1':'/rosters';
      value.receipts.push({id:randomUUID(),contentId:randomUUID(),leagueId:stage.leagueId!,family,workerId:owner.fence.workerId,generation:index+1,work,payload:source.payloads.get(base+suffix)});
    }
    if(stage.resource==='users')value.directories.push({id:randomUUID(),leagueId:stage.leagueId!,workerId:owner.fence.workerId,generation:index+1,payload:source.payloads.get(base+'/users')});
  }
  for(const [index,league] of source.leagues.entries()){
    const receipts=value.receipts.filter(row=>row.leagueId===league.external),core=receipts.filter(row=>row.work.kind==='core');
    value.heads.push({leagueId:league.external,leagueSeasonId:randomUUID(),settingsReceipt:core[0].id,rosterReceipt:core[1].id,managersReceipt:core[2].id,
      core:expectedBatchCore(source.manager,source.username,league.player),directoryCapture:value.directories[index].id,exactReceipt:receipts.find(row=>row.family==='matchups')!.id,readerDigest:'a'.repeat(64),points:String(index+0.25),starters:[league.player]});
  }
  const sql=(operation:keyof typeof BATCH_SQL,start:number,end:number)=>({...span(start,end),kind:'sql' as const,method:'POST' as const,
    key:batchHash(BATCH_SQL[operation]),bodySha256:null,sourceVersion:null,status:'ok' as const,signal:true});
  value.calls[2].attempts.push({...sql('submit',510,520),key:'0'.repeat(64)},sql('submit',530,550));
  enabled.attempts.push(sql('begin',1_080,1_090));
  for(let index=0;index<18;index++){const start=1_100+index*100;
    if(index)enabled.attempts.push(sql('advance',start-10,start-5));
    enabled.attempts.push(sql('next',start-4,start-3),sql('admit',start-2,start),sql('checkpoint',start+70,start+80));}
  enabled.attempts.push(sql('advance',2_900,2_905),sql('next',2_910,2_920));
  return {binding,value};
}
describe('partial single-batch calibration evidence oracle',()=>{
  it('accepts a complete synthetic validator fixture without asserting CP26 qualification',()=>{const {binding,value}=fixture();expect(()=>assertCompleteBatchCalibrationEvidence(value,binding)).not.toThrow();
    expect(value.scope).toBe('single-batch-calibration-only');expect(value.limitations).toContain('Synthetic source fetch responses do not measure live provider latency.');});
  const invalid:Record<string,(value:BatchCalibrationEvidence)=>void>={
    'missing SQL observation inventory':value=>{value.calls[3].attempts=value.calls[3].attempts.filter(row=>row.kind!=='sql');},
    'missing ordinary submission SQL':value=>{value.calls[2].attempts=[];},
    'missing advance SQL':value=>{const index=value.calls[3].attempts.findIndex(row=>row.key===batchHash(BATCH_SQL.advance));value.calls[3].attempts.splice(index,1);},
    'wrong username task':value=>{value.dispatches[0].work.username='other';},
    'wrong task season':value=>{value.dispatches[1].work.season=2025;},
    'missing exact native period':value=>{delete value.dispatches.find(row=>row.resource==='exact-matchups')!.work.nativeWeek;},
    'wrong task revision':value=>{value.dispatches[1].work.revision=9;},
    'wrong typed roster member':value=>{value.heads[0].core.rosters[0].players[0].playerId='wrong';},
    'wrong typed roster section':value=>{value.heads[0].core.rosters[0].players[0].section='active';},
    'invented empty roster player':value=>{value.heads[0].core.rosters[1].players.push({playerId:'extra',section:'roster',nativeSection:'players'});},
    'wrong typed primary manager':value=>{value.heads[0].core.managers[0].primaryId='wrong';},
    'invented owner on unowned roster':value=>{value.heads[0].core.managers[1].primaryState='owned';value.heads[0].core.managers[1].primaryId='wrong';},
    'invented typed co-manager':value=>{value.heads[0].core.managers[0].coIds=['wrong'];},
    'wrong typed directory label':value=>{value.heads[0].core.directory[0].displayName='wrong';},
    'omitted failed call':value=>{value.calls.splice(1,1);},
    'second enabled retry':value=>{value.calls.push(structuredClone(value.calls[3]));},
    'partial batch':value=>{value.calls[3].result!.status='progress';},
    'busy batch':value=>{value.calls[3].result!.status='busy';},
    'failure flag':value=>{value.calls[3].error=true;},
    'false string signal':value=>{value.calls[3].attempts[0].signal='false' as never;},
    'false string cleanup':value=>{value.cleanupComplete='false' as never;},
    'future source time':value=>{value.calls[3].attempts[0].startedAt=at(50_000);value.calls[3].attempts[0].endedAt=at(50_010);},
    'future source monotonic':value=>{value.calls[3].attempts[0].monotonicEndMs=9_000;},
    'late admission':value=>{value.dispatches[0].admittedAt=at(11_001);},
    'late accepted capture':value=>{value.dispatches[0].outcomeAt=at(21_001);},
    'renewed work fence':value=>{value.calls[3].owners[1].fence.deadlineAt=at(22_000);},
    'renewed lease':value=>{value.calls[3].owners[1].leaseUntil=at(27_000);},
    'unrotated worker':value=>{value.calls[3].owners[1].fence.workerId=value.calls[3].owners[0].fence.workerId;},
    'missing settlement generation':value=>{value.calls[3].owners.pop();},
    'string generation':value=>{value.calls[3].owners[0].fence.generation='1' as never;},
    'extra owner field':value=>{Object.assign(value.calls[3].owners[0],{renew:true});},
    'duplicate endpoint same total':value=>{value.calls[3].attempts[0].key=value.calls[3].attempts[1].key;value.calls[3].attempts[0].bodySha256=value.calls[3].attempts[1].bodySha256;},
    'wrong raw payload hash':value=>{value.calls[3].attempts[0].bodySha256='f'.repeat(64);},
    'POST hidden as GET':value=>{value.calls[3].attempts[0].method='POST';},
    'wrong receipt league':value=>{value.receipts[0].leagueId=value.heads[1].leagueId;},
    'wrong receipt payload':value=>{value.receipts[0].payload={};},
    'wrong receipt generation':value=>{value.receipts[0].generation++;},
    'missing head receipt':value=>{value.heads[0].rosterReceipt=randomUUID();},
    'duplicate reader league':value=>{value.heads[1].leagueId=value.heads[0].leagueId;},
    'incorrect typed official points':value=>{value.heads[0].points='99';},
    'wrong directory payload':value=>{value.directories[0].payload=[];},
    'changed immutable history':value=>{value.historyAfter='a'.repeat(64);},
    'changed protected table':value=>{value.protectedAfter='a'.repeat(64);},
    'reader HTTP attempt':value=>{value.readerRequests=1;},
  };
  it.each(Object.entries(invalid))('rejects %s',(_name,mutate)=>{const {binding,value}=fixture();mutate(value);expect(()=>assertCompleteBatchCalibrationEvidence(value,binding)).toThrow();});
  it('accepts equivalent persisted UTC spelling without resetting absolute fences',()=>{const {binding,value}=fixture();for(const owner of value.calls[3].owners){owner.fence.deadlineAt=owner.fence.deadlineAt.replace('Z','+00:00');owner.leaseUntil=owner.leaseUntil.replace('Z','+00:00');}
    expect(()=>assertCompleteBatchCalibrationEvidence(value,binding)).not.toThrow();});
});
