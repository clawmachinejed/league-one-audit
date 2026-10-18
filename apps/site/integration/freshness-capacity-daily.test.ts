import type { HttpAttempt } from './freshness-capacity-evidence';
import type { RecoveryIntakeProof } from './freshness-capacity-recovery';
import type { JsonValue } from './freshness-capacity-manifest';
import { beforeAll, describe, expect, it } from 'vitest';
import { createCapacityFleetFixture } from './freshness-capacity-fixtures';
import { capacityDigest } from './freshness-capacity-manifest';
import { createCapacityDailyManifest, assertCapacityDailyManifest, DAILY_CLOCK, type CapacityDailyManifest, type CapacityDailyEvidence, evaluateCapacityDaily, classifyDailyCatalogChoice, type DailyCatalogChoice } from './freshness-capacity-daily';
import { validatePublicIntake } from '../lib/league-administration/public-intake-contracts';
import { normalizeAdministrationObservation } from '../lib/league-administration/normalize';
import type { AdministrationEnvelope } from '../lib/league-administration/contracts';
const pins = {readinessContractSha256:'a'.repeat(64),acceptanceContractSha256:'b'.repeat(64),plannedPostgresqlVersion:'18.6',gitSha:'c'.repeat(40),appTreeSha:'d'.repeat(40),readerQueryMixSha256:'e'.repeat(64),observerManifestDigest:'f'.repeat(64),requestBudgetPolicy:'cp1-data-with-separate-existing-owners-v1' as const,requestOwners:['data-refresh','primary-projection','administration-maintenance','independent-measurement']};
let manifest:CapacityDailyManifest;
beforeAll(()=>{manifest=createCapacityDailyManifest(createCapacityFleetFixture('explicit-daily-unit-only'),pins);},30_000);
describe('closed representative daily source workload',()=>{
  it('preserves twelve active and four inactive resources without changing healthy or recovery inventories',()=>{
    expect(manifest.leagues.filter(row=>row.status==='in_season')).toHaveLength(12);
    expect(manifest.leagues.filter(row=>row.status==='post_season')).toHaveLength(4);
    expect(manifest.bindingPlan.pairs).toHaveLength(64);expect(manifest.bindingPlan.samples).toHaveLength(7744);
    expect(manifest.targets.map(row=>row.activeLeagueKeys.length)).toEqual([8,4,0]);
    expect(manifest.targets.every(row=>row.cadenceSeconds===72000&&row.cycles.join(',')==='1,2')).toBe(true);
    expect(manifest.initialRequests.map(row=>row.nativeLeagueIds.length)).toEqual([8,4,4]);
  });
  it('separates fixed observation, correction, full inventory and unchanged success deadlines',()=>{
    expect(DAILY_CLOCK).toMatchObject({publicationOffsetMs:19*3600000,observationMs:25*3600000,
      minimumRemainingWorkMs:25.5*3600000,workMs:26*3600000,lifecycleMs:(26*60+10)*60000,expiryMs:27*3600000,
      fullInventoryMs:4*3600000,maxSourceGapMs:24*3600000,catalogGuardMs:24*3600000});
    expect(manifest.boundaryOffsets).toEqual([1,19,24,25].map(hour=>hour*3600000));
    expect(manifest.targets.map(row=>row.endpointIds.length)).toEqual([522,262,262]);
  });
  it('declares two unrelated ordinary auxiliary submissions and twelve actual empty roster rows',()=>{
    const auxiliary=manifest.auxiliary;expect(auxiliary.nativeLeagueIds).toHaveLength(21);
    expect(auxiliary.nativeLeagueIds.every(id=>!manifest.leagues.some(row=>row.nativeLeagueId===id))).toBe(true);
    expect(new Set(auxiliary.users.map(row=>row.nativeManagerId)).size).toBe(2);
    auxiliary.users.forEach((row,index)=>expect(validatePublicIntake({id:'00000000-0000-4000-8000-00000000000'+(index+1),username:row.username,...row.scope})).toMatchObject({username:row.username,...row.scope}));
    const rosters=JSON.parse(auxiliary.endpoints.find(row=>row.resource==='rosters')!.before.utf8);
    expect(rosters).toHaveLength(12);expect(new Set(rosters.map((row:{roster_id:number})=>row.roster_id)).size).toBe(12);
    rosters.forEach((row:unknown)=>expect(row).toMatchObject({owner_id:null,co_owners:[],players:[],starters:[]}));
    const leagues=auxiliary.endpoints.filter(row=>row.resource==='league').map(row=>JSON.parse(row.before.utf8));
    expect(leagues[0]).toMatchObject({total_rosters:12,status:'pre_draft'});expect(leagues.slice(1).every(row=>row.total_rosters===21)).toBe(true);
  });
  it('uses the maintained native normalizer for the auxiliary official configuration and roster facts',()=>{
    for(const endpoint of manifest.auxiliary.endpoints.filter(row=>['league','rosters','users'].includes(row.resource))){
      const envelope:AdministrationEnvelope={schemaVersion:'league-administration-v1',normalizerVersion:'sleeper-administration-v1',dialect:'sleeper-nfl-v1',scope:{leagueKey:'unit-aux',provider:'sleeper',externalLeagueId:endpoint.scope.nativeLeagueId!,season:2026},family:endpoint.resource as 'league'|'rosters'|'users',week:null,completeness:'complete',payload:JSON.parse(endpoint.before.utf8),provenance:{origin:'bootstrap',requestStartedAt:null,requestCompletedAt:null,sourceObservedAt:null,checkedAt:'2026-10-17T00:00:00.000Z'}};
      expect(normalizeAdministrationObservation(envelope).status,endpoint.id).toBe('accepted');
    }
  });
  it.each(['inactive','scope','clock','auxiliary-omission','auxiliary-empty-rosters'])('rejects a rehashed changed frozen workload: %s',mutation=>{
    const changed=structuredClone(manifest);
    if(mutation==='inactive')changed.leagues[15].status='in_season';
    if(mutation==='scope')changed.targets[0].endpointIds.pop();
    if(mutation==='clock')Object.assign(changed.clock,{maxSourceGapMs:25*3600000});
    if(mutation==='auxiliary-omission')changed.auxiliary.nativeLeagueIds.pop();
    if(mutation==='auxiliary-empty-rosters')changed.auxiliary.endpoints.find(row=>row.resource==='rosters')!.before.utf8='[]';
    const {digest,...body}=changed;void digest;changed.digest=capacityDigest(body);
    expect(()=>assertCapacityDailyManifest(changed)).toThrow();
  },30_000);
});


function catalogChoice(at:number,attemptId:string):DailyCatalogChoice[] {
  const span={startedAt:at,endedAt:at+1,monotonicStartedAt:at,monotonicEndedAt:at+1};
  return [{kind:'claim',querySha256:'1'.repeat(64),params:[],span,status:'success',response:{fields:['attempt_count','lease_until'],rows:[[1,new Date(at+25000).toISOString()]]}},
    {kind:'reserve',querySha256:'2'.repeat(64),params:[],span,status:'success',response:{fields:['result'],rows:[[{status:'reserved',attempt:{attemptId}}]]}}];
}

/** Arithmetic doubles only. No authored UUID, reader or timestamp is execution evidence. */
function arithmeticDaily():CapacityDailyEvidence {
  const startedAt=5_000_000,endedAt=startedAt+DAILY_CLOCK.observationMs+1,coverageStartedAt=startedAt-200_000;
  let serial=0;const id=()=>`00000000-0000-4000-8000-${String(++serial).padStart(12,'0')}`;
  const attempts:HttpAttempt[]=[],endpointAcceptances:CapacityDailyEvidence['endpointAcceptances']=[];
  const physical=(endpoint:CapacityDailyManifest['endpoints'][number],at:number)=>{
    const version=at<startedAt+DAILY_CLOCK.publicationOffsetMs?endpoint.before:endpoint.after,url=new URL(endpoint.url);
    const common={id:id(),owner:'data-refresh',sequence:attempts.length+1,at,endedAt:at+1,purpose:'refresh' as const,outcome:'success' as const,responseSha256:version.sha256,origin:url.origin};
    const attempt:HttpAttempt=endpoint.method==='GET'?{...common,method:'GET',path:url.pathname+url.search}:{...common,method:'POST',path:'/graphql',report:{family:'weekly_report',externalLeagueId:endpoint.scope.nativeLeagueId!,nativeWeek:endpoint.scope.nativeWeek!,bodySha256:endpoint.requestSha256!}};
    attempts.push(attempt);return{attempt,version};
  };
  const proof=(requestId:string,cohort:string,initial:boolean):RecoveryIntakeProof=>{
    const plan=manifest.initialRequests.find(row=>row.cohort===cohort)!;
    return {requestId,terminal:true,terminalRevision:1,nativeIds:plan.nativeLeagueIds,detailedPeriods:plan.nativeLeagueIds.length*(initial?1:18),detailedTransactions:plan.nativeLeagueIds.length*(initial?1:19),detailedDrafts:initial?0:plan.nativeLeagueIds.length*5,pages:1,draftProofs:[],coverage:initial?'complete-materialized-initial-scope':'complete-materialized-inventory',parity:'immutable-intake-receipts-and-current-readers',originalAggregateStatuses:['available'],currentReadProofIds:[],immutableProofIds:[],completedEndpointIds:initial?plan.endpointIds:manifest.targets.find(row=>row.cohort===cohort)!.endpointIds,retainedPages:[]};
  };
  const auxProof=(requestId:string,at:number)=>({requestId,span:{startedAt:at,endedAt:at+1,monotonicStartedAt:at,monotonicEndedAt:at+1},request:null,read:null,additionalPages:[],mapping:null,candidates:[],queries:[],currentReadProofIds:[],immutableProofIds:[],completedEndpointIds:[],immutableReceiptRead:null,retainedRoster:null});
  const auxiliaryRequests=manifest.auxiliary.users.map((user,index)=>{const requestId=id(),at=coverageStartedAt+1000+index*61000;
    return{label:user.label,requestId,submittedAt:at,receiptAt:at+1,receipt:null,completedAt:at+2,proof:auxProof(requestId,at+1)};});
  const auxiliary={startedAt:coverageStartedAt,endedAt:startedAt-1,initialState:null,requests:auxiliaryRequests,
    overlap:{a:auxProof(auxiliaryRequests[0].requestId,startedAt-3),b:auxProof(auxiliaryRequests[1].requestId,startedAt-3)},queueDigest:'a'.repeat(64)};
  const initialSubmissions=manifest.initialRequests.map(row=>({cohort:row.cohort,requestId:id(),submittedAt:startedAt+1,receiptAt:startedAt+2,receipt:null}));
  const initialHeadConfirmations=initialSubmissions.flatMap(row=>manifest.initialRequests.find(item=>item.cohort===row.cohort)!.leagueKeys.flatMap(key=>['rosters','lineups','official-scores','transactions'].map(family=>({pairId:key+'/'+family,requestId:row.requestId,at:startedAt+1000,proofId:id()}))));
  const targets=manifest.targets.map(row=>({cohort:row.cohort,targetId:id(),configurationRevision:1,configuredAt:startedAt+2000,configuredCompletedAt:startedAt+2001,input:{cadenceSeconds:72000,paused:false} as Record<string,JsonValue>}));
  const intakes:CapacityDailyEvidence['intakes']=initialSubmissions.map(row=>({requestId:row.requestId,cohort:row.cohort,kind:'initial',cycle:null,targetId:null,createdAt:row.submittedAt,dueAt:null,completedAt:startedAt+1000,proof:proof(row.requestId,row.cohort,true)}));
  for(const cycle of [1,2]){let offset=0;
    for(const target of targets){const plan=manifest.targets.find(row=>row.cohort===target.cohort)!,requestId=id(),dueAt=startedAt+30*60000+(cycle-1)*72000000;
      for(const endpointId of plan.endpointIds){const endpoint=manifest.endpoints.find(row=>row.id===endpointId)!,{attempt,version}=physical(endpoint,dueAt+offset++*5000);
        endpointAcceptances.push({endpointId,requestId,attemptId:attempt.id,proofId:id(),kind:endpoint.resource==='identity'?'identity-observation':endpoint.resource==='league-list'?'league-list':'resource-receipt',sourceObservedAt:attempt.endedAt,acceptedAt:attempt.endedAt+1,readAt:attempt.endedAt+2,payloadSha256:version.sha256,version:version.version});}
      intakes.push({requestId,cohort:target.cohort,kind:'cycle',cycle,targetId:target.targetId,createdAt:dueAt,dueAt,completedAt:dueAt+offset*5000,proof:proof(requestId,target.cohort,false)});
    }
  }
  const catalog=manifest.endpoints.find(row=>row.resource==='player-catalog')!;
  let catalogAt:number|null=null,lastAttemptId:string|null=null;
  const catalogTurns=Array.from({length:1500},(_,ordinal)=>{const at=startedAt+ordinal*60000+5,retryAt=catalogAt===null?null:catalogAt+DAILY_CLOCK.catalogGuardMs;
    const row={ordinal,scheduledAt:startedAt+ordinal*60000,startedAt:at,endedAt:at+2,state:'invoked' as const,catalogChoices:[] as DailyCatalogChoice[],read:null,invocationOutcome:{status:'completed'},invocationFailed:false,lastAttemptId,retryAt,attemptIds:[] as string[]};
    if(retryAt===null||at>=retryAt){const {attempt}=physical(catalog,at);row.attemptIds.push(attempt.id);row.catalogChoices=catalogChoice(at,attempt.id);catalogAt=at;lastAttemptId=attempt.id;}return row;});
  attempts.sort((a,b)=>a.at-b.at).forEach((row,index)=>row.sequence=index+1);
  return{manifestDigest:manifest.digest,startedAt,endedAt,workDeadlineAt:startedAt+DAILY_CLOCK.minimumRemainingWorkMs,auxiliary,targets,initialSubmissions,initialHeadConfirmations,intakes,endpointAcceptances,catalogTurns,queue:[],boundaries:manifest.boundaryOffsets.map(offset=>({scheduledAt:startedAt+offset,startedAt:startedAt+offset,endedAt:startedAt+offset+1,proofIds:['a'.repeat(64)]})),ownerCoverage:pins.requestOwners.map(owner=>({owner,startedAt:coverageStartedAt,endedAt})),requests:{coverageStartedAt,coverageEndedAt:endedAt,ownerTotals:pins.requestOwners.map(owner=>({owner,attempts:owner==='data-refresh'?attempts.length:0})),attempts}};
}
describe('daily timing and whole observed request arithmetic',()=>{
  it('requires genuine second-cycle clocks while leaving actual execution and active gates unqualified',()=>{
    const result=evaluateCapacityDaily(manifest,arithmeticDaily());expect(result.errors).toEqual([]);expect(result.missing).toEqual([]);expect(result.pass).toBe(true);
    expect(result.checkpoint26Qualified).toBe(false);expect(result.activePercentilesQualified).toBe(false);
  });
  it('uses persisted eligibility rather than adding request latency to the 24-hour guard',()=>{
    const evidence=arithmeticDaily(),first=evidence.requests.attempts.find(row=>row.id===evidence.catalogTurns[0].attemptIds[0])!;
    first.at+=1;first.endedAt+=1;
    const result=evaluateCapacityDaily(manifest,evidence);
    expect(result.pass).toBe(true);expect(result.catalog.physicalSourceGapMs).toBe(DAILY_CLOCK.catalogGuardMs-1);
    expect(result.catalog.recurrenceRetryAt).toBe(evidence.catalogTurns[1440].retryAt);
  });
  it('retains a genuine eligibility crossing during the original invocation',()=>{
    const evidence=arithmeticDaily(),turn=evidence.catalogTurns[1440];turn.startedAt-=1;
    expect(evaluateCapacityDaily(manifest,evidence).pass).toBe(true);
    turn.catalogChoices[0].span.startedAt=turn.retryAt!-1;
    expect(()=>evaluateCapacityDaily(manifest,evidence)).toThrow('catalog choice before');
  });
  it.each(['source-gap','initial-deadline','full-deadline','missing-second','no-catalog-repeat','catalog-too-early','shifted-tail','missing-turn'])('fails incomplete or late declared evidence: %s',mutation=>{
    const evidence=arithmeticDaily();
    if(mutation==='source-gap'){const first=evidence.endpointAcceptances[0],row=evidence.endpointAcceptances.find(row=>row.endpointId===first.endpointId&&row.attemptId!==first.attemptId)!;row.readAt=first.sourceObservedAt+DAILY_CLOCK.maxSourceGapMs+1;}
    if(mutation==='initial-deadline')evidence.intakes[0].completedAt=evidence.initialSubmissions[0].submittedAt+DAILY_CLOCK.fullInventoryMs+1;
    if(mutation==='full-deadline'){const row=evidence.intakes.find(row=>row.kind==='cycle')!;row.completedAt=row.createdAt+DAILY_CLOCK.fullInventoryMs+1;}
    if(mutation==='missing-second')evidence.intakes=evidence.intakes.filter(row=>row.cycle!==2);
    if(mutation==='no-catalog-repeat')evidence.catalogTurns[1440].attemptIds=[];
    if(mutation==='catalog-too-early')evidence.catalogTurns[1440].retryAt=evidence.catalogTurns[1440].startedAt+1;
    if(mutation==='shifted-tail')evidence.endedAt-=2;
    if(mutation==='missing-turn')evidence.catalogTurns.splice(500,1);
    let rejected=false;try{rejected=!evaluateCapacityDaily(manifest,evidence).pass;}catch{rejected=true;}expect(rejected).toBe(true);
  });
});


describe('closed catalog choice arithmetic',()=>{
  it('distinguishes a known busy claim, reserved source work and a known reservation backoff',()=>{
    const choices=catalogChoice(1000,'unit-attempt');
    expect(classifyDailyCatalogChoice(choices)).toBe('reserved');
    expect(classifyDailyCatalogChoice([{...choices[0],response:{fields:['attempt_count','lease_until'],rows:[]}}])).toBe('claim-busy');
    choices[1].response!.rows=[[JSON.stringify({status:'backoff',retryAt:new Date(2000).toISOString()})]];
    expect(classifyDailyCatalogChoice(choices)).toBe('reservation-backoff');
  });
  it.each(['missing','failed','unknown','wrong-fields','duplicate','empty-reserve'])('does not classify incomplete acknowledgments: %s',mutation=>{
    const choices=catalogChoice(1000,'unit-attempt');
    if(mutation==='missing')choices.pop();if(mutation==='failed')choices[0].status='failed';
    if(mutation==='unknown')choices[1].response!.rows=[[{status:'maybe'}]];
    if(mutation==='wrong-fields')choices[0].response!.fields=['unrelated','lease_until'];
    if(mutation==='duplicate')choices.push(choices[1]);if(mutation==='empty-reserve')choices[1].response!.rows=[];
    expect(classifyDailyCatalogChoice(choices)).toBe('unclassified');
  });
});
