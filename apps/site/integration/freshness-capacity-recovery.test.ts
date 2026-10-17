import { beforeAll, describe, expect, it } from 'vitest';
import type { HttpAttempt, OriginObservation } from './freshness-capacity-evidence';
import { capacityDigest } from './freshness-capacity-manifest';
import { createCapacityFleetFixture, type CapacityFleetFixture } from './freshness-capacity-fixtures';
import { createCapacityRecoveryManifest, assertCapacityRecoveryManifest, RECOVERY_CLOCK, evaluateCapacityRecovery, type CapacityRecoveryEvidence, type RecoveryPairRead, type CapacityRecoveryManifest, type CapacityRecoveryPins } from './freshness-capacity-recovery';
import { normalizeAdministrationObservation } from '../lib/league-administration/normalize';
import { validatePublicIntake } from '../lib/league-administration/public-intake-contracts';
import type { AdministrationEnvelope } from '../lib/league-administration/contracts';
let fleet:CapacityFleetFixture,manifest:CapacityRecoveryManifest;
const pins:CapacityRecoveryPins={readinessContractSha256:'a'.repeat(64),acceptanceContractSha256:'b'.repeat(64),plannedPostgresqlVersion:'18.6',gitSha:'c'.repeat(40),appTreeSha:'d'.repeat(40),readerQueryMixSha256:'e'.repeat(64),observerManifestDigest:'f'.repeat(64),requestBudgetPolicy:'cp1-data-with-separate-existing-owners-v1',requestOwners:['data-refresh','primary-projection','administration-maintenance','independent-measurement']};
beforeAll(()=>{fleet=createCapacityFleetFixture('explicit-unit-recovery-source');manifest=createCapacityRecoveryManifest(fleet,pins);},30_000);
describe('separate closed provider recovery workload',()=>{
  it('freezes all16 already accepted leagues and three complete ordinary replay requests, without rewriting healthy events',()=>{
    expect(manifest.leagues).toHaveLength(16);expect(manifest.leagues.every(row=>row.requiredInitiallyAccepted)).toBe(true);expect(manifest.pairs).toHaveLength(64);expect(manifest.samples).toHaveLength(7744);
    expect(manifest.submissions.map(row=>row.leagueKeys.length)).toEqual([8,4,4]);expect(new Set(manifest.submissions.map(row=>row.input.id)).size).toBe(3);
    expect(manifest.initialRequests.map(row=>row.endpointIds.length)).toEqual([58,30,30]);expect(manifest.initialScope).toEqual({seasons:[2026],exactPeriods:[{season:2026,nativeWeek:7}],transactionPeriod:{season:2026,nativeWeek:7},playoffBrackets:manifest.submissions[0].input.playoffBrackets});expect(manifest.submissions.map(row=>row.endpointIds.length)).toEqual([522,262,262]);expect(manifest.endpoints).toHaveLength(1056);
    for(const request of manifest.submissions){expect(validatePublicIntake(request.input)).toEqual(request.input);expect(request.offsetMs).toBe(61*60_000);expect(request.input.weeklyReports).toHaveLength(18);}
    expect(fleet.prototype.events).toHaveLength(1280);expect(manifest.gaps.join(' ')).toContain('catalog');expect(Object.isFrozen(manifest.pairs[0])).toBe(true);
  });
  it('keeps genuine lookback, outage, recovery and backlog clocks inside one original bounded envelope',()=>{
    expect(RECOVERY_CLOCK).toMatchObject({lookbackMs:60*60_000,outageStartMs:60*60_000,outageEndMs:90*60_000,backlogDeadlineMs:330*60_000,workMs:340*60_000,lifecycleMs:350*60_000,expiryMs:360*60_000,ciMinutes:360});
    expect(RECOVERY_CLOCK.outageEndMs-RECOVERY_CLOCK.outageStartMs).toBe(30*60_000);expect(RECOVERY_CLOCK.backlogDeadlineMs+RECOVERY_CLOCK.evidenceReserveMs).toBe(RECOVERY_CLOCK.workMs);
    expect(RECOVERY_CLOCK.outageEndMs+RECOVERY_CLOCK.backlogAfterRestoreMs).toBe(RECOVERY_CLOCK.backlogDeadlineMs);
  });
  it('binds each active family to exact changed native bytes and immutable v0 history; paired matchups publish together',()=>{
    for(const pair of manifest.pairs){const endpoint=manifest.endpoints.find(row=>row.id===pair.endpointId)!;expect(endpoint.before).toEqual(pair.before);expect(endpoint.after).toEqual(pair.after);
      expect(pair.before.sha256).not.toBe(pair.after.sha256);expect(pair.retainedHistory).toHaveLength(1);expect(pair.retainedHistory[0].value).toEqual(pair.initialReader.value);}
    for(const league of manifest.leagues){const lineup=manifest.pairs.find(row=>row.pairId===league.key+'/lineups')!,score=manifest.pairs.find(row=>row.pairId===league.key+'/official-scores')!;
      expect(lineup.endpointId).toBe(score.endpointId);expect(lineup.after).toEqual(score.after);}
    expect(manifest.endpoints.filter(row=>row.requirement==='initial-catalog-only')).toHaveLength(7);
    expect(manifest.endpoints.filter(row=>row.requirement==='initial-catalog-only').every(row=>row.before.sha256===row.after.sha256)).toBe(true);
  });
  it('runs declared core correction bytes through current normalizers',()=>{
    const resources=manifest.endpoints.filter(row=>row.scope.leagueKey==='league-01');
    const family={league:'league',rosters:'rosters',users:'users',matchups:'matchups',transactions:'transactions','winners-bracket':'winners_bracket','losers-bracket':'losers_bracket'} as const;
    for(const endpoint of resources){if(!(endpoint.resource in family))continue;const envelope:AdministrationEnvelope={schemaVersion:'league-administration-v1',normalizerVersion:'sleeper-administration-v1',dialect:'sleeper-nfl-v1',scope:{leagueKey:'unit-recovery',provider:'sleeper',externalLeagueId:endpoint.scope.nativeLeagueId!,season:2026},family:family[endpoint.resource as keyof typeof family],week:endpoint.scope.nativeWeek,completeness:'complete',payload:JSON.parse(endpoint.after.utf8),provenance:{origin:'bootstrap',requestStartedAt:null,requestCompletedAt:null,sourceObservedAt:null,checkedAt:'2026-10-17T00:00:00.000Z'}};
      const normalized=normalizeAdministrationObservation(envelope);expect(normalized.status,JSON.stringify(normalized)).toBe('accepted');
    }
  });
  it.each(['deadline','drop-pair','drop-endpoint','omit-period','fake-catalog-repeat','source-pin','rehashed-omission'] as const)('rejects changed frozen recovery plan: %s',mutation=>{
    const changed=structuredClone(manifest);
    if(mutation==='deadline')Object.assign(changed.clock,{workMs:999});
    if(mutation==='drop-pair')changed.pairs.pop();
    if(mutation==='drop-endpoint')changed.endpoints.pop();
    if(mutation==='omit-period')changed.submissions[0].endpointIds.pop();
    if(mutation==='fake-catalog-repeat')changed.endpoints.find(row=>row.resource==='player-catalog')!.requirement='post-restore-changed';
    if(mutation==='source-pin')changed.source.fixtureSha256='0'.repeat(64);
    if(mutation==='rehashed-omission'){changed.submissions.pop();const {digest:oldDigest,...body}=changed;void oldDigest;changed.digest=capacityDigest(body);}
    expect(()=>assertCapacityRecoveryManifest(changed)).toThrow();
  },30_000);
});

/** Authored arithmetic evidence only. These rows never qualify actual SQL or elapsed execution. */
function recoveryEvidence():CapacityRecoveryEvidence{
  const start=10_000_000,end=start+181*60_000,owners=pins.requestOwners,attempts:HttpAttempt[]=[],origins:OriginObservation[]=[];
  let ordinal=0;const identity=()=>`00000000-0000-4000-8000-${String(++ordinal).padStart(12,'0')}`;
  const attempt=(endpoint:CapacityRecoveryManifest['endpoints'][number],at:number,phase:'before'|'after',owner='data-refresh')=>{
    const url=new URL(endpoint.url),payload=endpoint[phase],id=identity();
    const base={id,owner,sequence:attempts.filter(row=>row.owner===owner).length+1,at,endedAt:at+1,origin:url.origin,purpose:'refresh' as const,outcome:'success' as const,responseSha256:payload.sha256};
    const row:HttpAttempt=endpoint.method==='GET'?{...base,method:'GET',path:url.pathname+url.search}:{...base,method:'POST',path:'/graphql',report:{family:'weekly_report',externalLeagueId:endpoint.scope.nativeLeagueId!,nativeWeek:endpoint.scope.nativeWeek!,bodySha256:endpoint.requestSha256!}};
    attempts.push(row);return row;
  };
  const initial:RecoveryPairRead[]=[],recovered:RecoveryPairRead[]=[];
  for(const [phase,rows,offset] of [['before',initial,2],['after',recovered,91]] as const){const physical=new Map<string,ReturnType<typeof attempt>>();
    for(const pair of manifest.pairs){const endpoint=manifest.endpoints.find(row=>row.id===pair.endpointId)!;let request=physical.get(endpoint.id);
      if(!request){request=attempt(endpoint,start+offset*60_000+physical.size*2_000,phase);physical.set(endpoint.id,request);}
      const proofId=identity(),origin={id:proofId+'/'+pair.pairId,pairId:pair.pairId,version:pair[phase].version,payloadSha256:pair[phase].sha256,observedAt:request.endedAt,attemptId:request.id,kind:'successful-provider-observation' as const};origins.push(origin);
      rows.push({pairId:pair.pairId,proofId,read:{at:start+(phase==='before'?20:94)*60_000,committed:true,storedOnly:true,version:origin.version,payloadSha256:origin.payloadSha256,originObservationId:origin.id},reader:structuredClone(phase==='before'?pair.initialReader:pair.expectedReader),retainedHistory:phase==='before'?[]:structuredClone(pair.retainedHistory)});
    }
  }
  const failed=attempt(manifest.endpoints.find(row=>row.id===manifest.pairs[0].endpointId)!,start+61*60_000,'before');failed.outcome='failed';failed.responseSha256=null;
  const endpointAcceptances:CapacityRecoveryEvidence['endpointAcceptances']=[];let requestOrdinal=0;
  for(const submission of manifest.submissions)for(const id of submission.endpointIds){const endpoint=manifest.endpoints.find(row=>row.id===id)!;
    const physical=attempt(endpoint,start+100*60_000+requestOrdinal++*3_000,'after');endpointAcceptances.push({endpointId:id,requestId:submission.input.id,attemptId:physical.id,proofId:identity(),kind:endpoint.resource==='identity'?'identity-observation':endpoint.resource==='league-list'?'league-list':'resource-receipt',sourceObservedAt:physical.endedAt+1,acceptedAt:physical.endedAt+2,readAt:physical.endedAt+3,payloadSha256:endpoint.after.sha256,version:endpoint.after.version});}
  for(const endpoint of manifest.endpoints.filter(row=>row.requirement==='initial-catalog-only')){const cache=endpoint.resource==='player-position-catalog';const physical=attempt(endpoint,start+5*60_000+ordinal*10,'before',cache?'primary-projection':'data-refresh');
    endpointAcceptances.push({endpointId:endpoint.id,requestId:null,attemptId:physical.id,proofId:identity(),kind:cache?'primary-catalog-cache':'player-directory-receipt',sourceObservedAt:physical.endedAt+1,acceptedAt:cache?null:physical.endedAt+2,readAt:physical.endedAt+3,payloadSha256:endpoint.before.sha256,version:endpoint.before.version});}
  // Owner sequence is physical dispatch order, not insertion order in this authored test factory.
  for(const owner of owners)attempts.filter(row=>row.owner===owner).sort((a,b)=>a.at-b.at).forEach((row,index)=>{row.sequence=index+1;});
  const evidence:CapacityRecoveryEvidence={manifestDigest:manifest.digest,startedAt:start,endedAt:end,workDeadlineAt:start+RECOVERY_CLOCK.workMs,
    ownerCoverage:owners.map(owner=>({owner,startedAt:start,endedAt:end})),requests:{coverageStartedAt:start,coverageEndedAt:end,ownerTotals:owners.map(owner=>({owner,attempts:attempts.filter(row=>row.owner===owner).length})),attempts},origins,initial,recovered,
    lastGood:initial.map(row=>({pairId:row.pairId,before:{...structuredClone(row),read:{...row.read,at:start+60*60_000-1}},during:{...structuredClone(row),read:{...row.read,at:start+80*60_000}}})),
    submissions:manifest.submissions.map((submission,index)=>({id:submission.id,requestId:submission.input.id,plannedAt:start+61*60_000,dispatchedAt:start+61*60_000,receiptAt:start+61*60_000+100,receipt:{status:'retained',requestId:submission.input.id},completedAt:start+159*60_000,completeProof:{requestId:submission.input.id,terminal:true,terminalRevision:100,nativeIds:submission.nativeLeagueIds,detailedPeriods:submission.leagueKeys.length*18,detailedTransactions:submission.leagueKeys.length*19,detailedDrafts:submission.leagueKeys.length*5,pages:1,
      draftProofs:submission.endpointIds.filter(id=>['draft-catalog','draft-detail','draft-selections','draft-trades','league-trades'].includes(manifest.endpoints.find(row=>row.id===id)!.resource)).map(id=>({key:id,receiptId:identity(),endpointId:id,valueDigest:'a'.repeat(64)})),coverage:'complete-materialized-inventory',parity:'immutable-intake-receipts-and-current-readers',originalAggregateStatuses:['partial'],immutableProofIds:[identity()],currentReadProofIds:Array.from({length:submission.nativeLeagueIds.length*3},(_,i)=>String(i+1).padStart(64,'0')),completedEndpointIds:[...submission.endpointIds],retainedPages:[String(index+1).repeat(64)]}})),
    samples:manifest.samples.map(slot=>{const source=(slot.offsetMs<94*60_000?initial:recovered).find(row=>row.pairId===slot.pairId)!;const at=start+slot.offsetMs;return{id:slot.id,at,status:'available',read:{...source.read,at:at+1}};}),
    queue:{targets:[],snapshots:[],completed:[]},endpointAcceptances,outage:{startedAt:start+60*60_000,dependencyRestoredAt:start+90*60_000,runnerRestoredAt:start+90*60_000}};
  const requests:Record<string,import('./freshness-capacity-manifest').JsonValue>[]=[],cycles:Record<string,import('./freshness-capacity-manifest').JsonValue>[]=[],configurations:import('./freshness-capacity-manifest').JsonValue[]=[];
  const fields=[['seasons','seasons'],['periodInventory','period_inventory'],['transactionHistory','transaction_history'],['draftPicks','draft_picks'],['playoffBrackets','playoff_brackets'],['weeklyReports','weekly_reports']] as const;
  for(const [index,submission]of manifest.submissions.entries()){
    const cohort=submission.id.slice(7),targetId=identity(),initialId=identity(),cycleId=identity(),configuredAt=start+30*60_000,iso=(at:number)=>new Date(at).toISOString();
    const scope=Object.fromEntries(fields.map(([native])=>[native,(submission.input as unknown as Record<string,import('./freshness-capacity-manifest').JsonValue>)[native]]));
    const columns={...Object.fromEntries(fields.map(([native,column])=>[column,scope[native]])),exact_periods:Array.from({length:18},(_,index)=>({season:2026,nativeWeek:index+1})),transaction_period:null};
    evidence.queue.targets.push({cohort,targetId,configurationRevision:1,configuredAt,configuredCompletedAt:configuredAt+50,input:{id:targetId,expectedRevision:0,identityRequestId:initialId,...scope,cadenceSeconds:86400,expiresAt:iso(evidence.workDeadlineAt),paused:false}});
    configurations.push({target:{id:targetId,configuration_revision:1,created_at:iso(configuredAt)},configuration:{target_id:targetId,revision:1,identity_request_id:initialId,...columns,cadence_seconds:86400,expires_at:iso(evidence.workDeadlineAt),paused:false,configured_at:iso(configuredAt)}});
    cycles.push({target_id:targetId,cycle:1,configuration_revision:1,intake_id:cycleId,due_at:iso(configuredAt),created_at:iso(configuredAt+100)});
    for(const [id,username,createdAt]of [[initialId,submission.username,start],[cycleId,manifest.correctionTargets[index].nativeUsername,configuredAt+100],[submission.input.id,submission.username,start+61*60_000]] as const)requests.push({id,username,...(id===initialId?{seasons:[2026],period_inventory:null,transaction_history:null,draft_picks:null,playoff_brackets:manifest.initialScope.playoffBrackets,weekly_reports:[],exact_periods:[...manifest.initialScope.exactPeriods],transaction_period:manifest.initialScope.transactionPeriod}:columns),created_at:iso(createdAt),resource_occurrence_id:null,terminal:true,revision:100});
    for(const id of [initialId,cycleId]){const completeProof=structuredClone(evidence.submissions[index].completeProof!);completeProof.requestId=id;
      if(id===cycleId)completeProof.completedEndpointIds=[...manifest.correctionTargets[index].endpointIds];else{completeProof.coverage='complete-materialized-initial-scope';completeProof.completedEndpointIds=[...manifest.initialRequests[index].endpointIds];completeProof.detailedPeriods=submission.nativeLeagueIds.length;completeProof.detailedTransactions=submission.nativeLeagueIds.length;completeProof.detailedDrafts=0;completeProof.draftProofs=[];}
      evidence.queue.completed.push({requestId:id,completedAt:start+159*60_000,completeProof});}
  }
  evidence.queue.snapshots=(['after-submissions','restored','final'] as const).map((phase,index)=>({phase,at:start+[61,90,181][index]*60_000,requests:structuredClone(requests).map(row=>({...row,terminal:phase==='final'})),cycles:structuredClone(cycles),configurations:structuredClone(configurations)}));
  return evidence;

}

describe('recovery arithmetic over exact observed bindings',()=>{
  it('reconciles complete recovery separately without granting catalog recurrence or full CP26 qualification',()=>{
    const result=evaluateCapacityRecovery(manifest,recoveryEvidence());expect(result.status).toBe('pass');expect(result.errors).toEqual([]);expect(result.missing).toEqual([]);
    expect(result.coverage).toMatchObject({initial:64,lastGood:64,recovered:64,replays:3,requiredEndpointProofs:1053,endpointProofs:1053});
    expect(result.catalogRecurrenceQualified).toBe(false);expect(result.checkpoint26Qualified).toBe(false);
  });
  it.each(['one-ms-late-fresh','wrong-history','no-last-good','wrong-current','provider-still-healthy','late-dispatch','late-receipt','stale-recovered-head','sample-head-regression'] as const)('fails actual recorded violation: %s',mutation=>{
    const value=recoveryEvidence();
    if(mutation==='one-ms-late-fresh')value.recovered[0].read.at=value.startedAt+105*60_000+1;
    if(mutation==='wrong-history')value.recovered[0].retainedHistory=[];
    if(mutation==='no-last-good')value.lastGood.pop();
    if(mutation==='wrong-current')value.recovered[0].reader.value=null;
    if(mutation==='provider-still-healthy'){const row=value.requests.attempts.find(row=>row.outcome==='failed')!;row.outcome='success';row.responseSha256='a'.repeat(64);}
    if(mutation==='late-dispatch')value.submissions[0].dispatchedAt+=1_001;
    if(mutation==='late-receipt')value.submissions[0].receiptAt=value.submissions[0].dispatchedAt+2_001;
    if(mutation==='stale-recovered-head')value.recovered[0].read.at=value.startedAt+105*60_000;
    if(mutation==='sample-head-regression'){const row=value.samples.find(item=>item.id===manifest.pairs[0].pairId+'/recovery-sample-50')!;row.read={...value.initial[0].read,at:row.at+1};}
    expect(evaluateCapacityRecovery(manifest,value).status).toBe('fail');
  });
  it('keeps missing full history incomplete before the actual four-hour recovery deadline',()=>{
    const value=recoveryEvidence();value.endpointAcceptances.pop();value.submissions[0].completedAt=null;value.submissions[0].completeProof=null;
    // The removed catalog witness has already missed its initial deadline; retain it and remove a replay instead.
    const full=recoveryEvidence();value.endpointAcceptances=full.endpointAcceptances.filter(row=>row.endpointId!==manifest.submissions[0].endpointIds[0]);
    expect(evaluateCapacityRecovery(manifest,value).status).toBe('incomplete');
    value.endedAt=value.startedAt+330*60_000;value.requests.coverageEndedAt=value.endedAt;value.ownerCoverage.forEach(row=>{row.endedAt=value.endedAt;});
    expect(evaluateCapacityRecovery(manifest,value).status).toBe('fail');
  });
  it.each(['source-drift','duplicate-proof','foreign-request','missing-origin','catalog-sql-fiction','renewed-deadline','missing-period-inventory','future-acceptance','acceptance-before-source','future-completion','completion-before-receipt'] as const)('rejects invalid evidence shape: %s',mutation=>{
    const value=recoveryEvidence();
    if(mutation==='source-drift')value.manifestDigest='0'.repeat(64);
    if(mutation==='duplicate-proof')value.endpointAcceptances.push(value.endpointAcceptances[0]);
    if(mutation==='foreign-request')value.endpointAcceptances[0].requestId=value.submissions[1].requestId;
    if(mutation==='missing-origin')delete value.requests.attempts[0].origin;
    if(mutation==='catalog-sql-fiction')value.endpointAcceptances.find(row=>row.kind==='primary-catalog-cache')!.acceptedAt=value.startedAt;
    if(mutation==='renewed-deadline')value.workDeadlineAt++;
    if(mutation==='missing-period-inventory')value.submissions[0].completeProof!.detailedPeriods--;
    if(mutation==='future-acceptance')value.endpointAcceptances[0].acceptedAt=value.endedAt+1;
    if(mutation==='acceptance-before-source')value.endpointAcceptances[0].acceptedAt=value.endpointAcceptances[0].sourceObservedAt-2;
    if(mutation==='future-completion')value.submissions[0].completedAt=value.endedAt+1;
    if(mutation==='completion-before-receipt')value.submissions[0].completedAt=value.submissions[0].receiptAt!-1;
    expect(()=>evaluateCapacityRecovery(manifest,value)).toThrow();
  });
});


it('reports outage-inclusive fixed-slot ages without applying the separate healthy percentile ceilings',()=>{
  const evidence=recoveryEvidence();evidence.samples[0].status='timeout';evidence.samples[0].read=null;
  const result=evaluateCapacityRecovery(manifest,evidence);expect(result.pass).toBe(true);expect(result.sourceAge).toHaveLength(64);
  expect(result.sourceAge[0].sourceAge).toMatchObject({scheduled:121,observed:120,failures:1,maxMs:'infinity'});
  expect(Number(result.sourceAge[0].sourceAge.p95Ms)).toBeGreaterThan(300_000);
});
it('permits a genuine newer v0 receipt before the outage while retaining exact last-good values',()=>{
  const evidence=recoveryEvidence(),row=evidence.lastGood[0],old=evidence.origins.find(item=>item.id===row.during.read.originObservationId)!;
  const attempt=structuredClone(evidence.requests.attempts.find(item=>item.id===old.attemptId)!);attempt.id='new-before-outage';attempt.at=evidence.startedAt+59*60_000;attempt.endedAt=attempt.at+1;
  evidence.requests.attempts.push(attempt);evidence.requests.attempts.filter(item=>item.owner===attempt.owner).sort((a,b)=>a.at-b.at).forEach((item,index)=>{item.sequence=index+1;});evidence.requests.ownerTotals.find(item=>item.owner===attempt.owner)!.attempts++;
  const origin={...old,id:'new-receipt-origin',attemptId:attempt.id,observedAt:attempt.endedAt};evidence.origins.push(origin);row.during.read.originObservationId=origin.id;
  expect(evaluateCapacityRecovery(manifest,evidence).pass).toBe(true);
});

it.each(['unknown-request','extra-cycle','changed-approval','wrong-scope','missing-initial','changed-binding','lost-cycle','false-terminal','missing-immutable-endpoint','legacy-parity'] as const)('rejects queued workload escape: %s',mutation=>{
 const value=recoveryEvidence(),snap=value.queue.snapshots.at(-1)!;
 if(mutation==='unknown-request')snap.requests.push({...snap.requests[0] as object,id:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'} as never);
 if(mutation==='extra-cycle')(snap.cycles[0] as Record<string,unknown>).cycle=2;
 if(mutation==='changed-approval')((snap.configurations[0] as Record<string,unknown>).configuration as Record<string,unknown>).revision=2;
 if(mutation==='wrong-scope')(snap.requests[0] as Record<string,unknown>).exact_periods=[{season:2026,nativeWeek:8}];
 if(mutation==='missing-initial')snap.requests.shift();
 if(mutation==='changed-binding')(snap.cycles[0] as Record<string,unknown>).intake_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
 if(mutation==='lost-cycle')snap.cycles.pop();
 if(mutation==='false-terminal')(snap.requests[0] as Record<string,unknown>).terminal=false;
 if(mutation==='missing-immutable-endpoint')value.queue.completed[0].completeProof.completedEndpointIds.pop();
 if(mutation==='legacy-parity')value.queue.completed[0].completeProof.parity='declared-active-events-and-draft-values' as never;
 expect(()=>evaluateCapacityRecovery(manifest,value)).toThrow();
});
it('keeps a due cycle in the denominator before it has a request row',()=>{
 const value=recoveryEvidence(),targetId=value.queue.targets[0].targetId,cycle=value.queue.snapshots[0].cycles[0] as Record<string,unknown>,id=cycle.intake_id;
 for(const snapshot of value.queue.snapshots){snapshot.cycles=snapshot.cycles.filter(row=>(row as Record<string,unknown>).target_id!==targetId);snapshot.requests=snapshot.requests.filter(row=>(row as Record<string,unknown>).id!==id);}
 value.queue.completed=value.queue.completed.filter(row=>row.requestId!==id);
 const result=evaluateCapacityRecovery(manifest,value);expect(result.status).toBe('incomplete');expect(result.missing.some(row=>row.includes('never materialized'))).toBe(true);
});

it('does not relabel the six full backlog requests as selected initial scope',()=>{
 const value=recoveryEvidence();expect(evaluateCapacityRecovery(manifest,value).coverage).toMatchObject({requiredFullBacklogRequests:6,requiredInitialRequests:3});
 value.submissions[0].completeProof!.coverage='complete-materialized-initial-scope';expect(()=>evaluateCapacityRecovery(manifest,value)).toThrow();
});
it('rejects full-scope proof labels and omitted active-period bindings for initial requests',()=>{
 const value=recoveryEvidence();value.queue.completed[0].completeProof.coverage='complete-materialized-inventory';expect(()=>evaluateCapacityRecovery(manifest,value)).toThrow();
 const missing=recoveryEvidence();missing.queue.completed[0].completeProof.detailedTransactions=0;expect(()=>evaluateCapacityRecovery(manifest,missing)).toThrow();
});
