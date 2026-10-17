import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { capacityDigest, freezeCapacityValue, type CapacityEndpointBinding, type CapacityRequestBudgetPolicy, type CapacitySource, type JsonValue, type PayloadVersion, type ReaderExpectation, capacityTime, CAPACITY_LIMITS } from './freshness-capacity-manifest';
import { validatePublicIntake, PUBLIC_PERIOD_INVENTORY, PUBLIC_TRANSACTION_HISTORY, PUBLIC_DRAFT_PICKS, PUBLIC_PLAYOFF_BRACKETS, type PublicIntakeInput, type PublicIntakeSubmissionReceipt } from '../lib/league-administration/public-intake-contracts';
import { assertCapacityHttpEndpoint, evaluateRequestEnvelope, summarizeCapacity, type SampleEvidence, type ResourceRead, type OriginObservation, type RequestAccounting } from './freshness-capacity-evidence';
import { createCapacityFleetFixture, capacityChangedNativeFields, type CapacityFleetFixture } from './freshness-capacity-fixtures';

export const RECOVERY_CLOCK = Object.freeze({ lookbackMs:60*60_000, acceptanceDeadlineMs:60*60_000, outageStartMs:60*60_000,
  outageEndMs:90*60_000, submissionMs:61*60_000, dispatchLatenessMs:1_000, freshAfterRestoreMs:15*60_000,
  backlogAfterRestoreMs:240*60_000, backlogDeadlineMs:330*60_000, evidenceReserveMs:10*60_000,
  sampleStartMs:60*60_000, sampleIntervalMs:60_000, samplesPerPair:121, sampleDispatchLatenessMs:1_000, sampleTimeoutMs:60_000,
  workMs:340*60_000, lifecycleMs:350*60_000, expiryMs:360*60_000, ciMinutes:360 });
export const RECOVERY_INITIAL_SCOPE = freezeCapacityValue({seasons:[2026],exactPeriods:[{season:2026,nativeWeek:7}],transactionPeriod:{season:2026 as const,nativeWeek:7 as const},playoffBrackets:PUBLIC_PLAYOFF_BRACKETS});
export const RECOVERY_GAPS = Object.freeze([
  'A provider-only recovery lane does not replace the separate healthy 1,280-event benchmark.',
  'The shared catalog uses the first eligible scheduled DATA turn after the unchanged 24-hour attempt guard, with actual freshness and failures reported. Initial capture does not qualify repeated daily service.',
  'Actual restricted LOGIN, full owner journals, named regressions and supervisor cleanup require independent execution evidence.',
]);
export type CapacityRecoveryPins = Pick<CapacitySource,'readinessContractSha256'|'acceptanceContractSha256'|'plannedPostgresqlVersion'|'gitSha'|'appTreeSha'|'readerQueryMixSha256'|'requestOwners'> & {observerManifestDigest:string;requestBudgetPolicy:CapacityRequestBudgetPolicy};
export type RecoveryEndpoint = Omit<CapacityEndpointBinding,'versions'> & { before:PayloadVersion; after:PayloadVersion;
  requirement:'post-restore-changed'|'post-restore-unchanged'|'initial-catalog-only'; changedFields:string[] };
export type RecoveryPairBinding = { pairId:string; leagueKey:string; family:'rosters'|'lineups'|'official-scores'|'transactions'; endpointId:string;
  before:PayloadVersion; after:PayloadVersion; initialReader:ReaderExpectation; expectedReader:ReaderExpectation; retainedHistory:ReaderExpectation[] };
export type RecoverySubmission = { id:'replay-accepted'|'replay-intake-a'|'replay-intake-b'; username:string; leagueKeys:string[]; nativeLeagueIds:string[];
  offsetMs:number; input:PublicIntakeInput; endpointIds:string[] };
export type CapacityRecoveryManifest = { kind:'cp26-provider-recovery-manifest-v1'; seed:string; source:CapacityRecoveryPins & {fixtureSha256:string}; clock:typeof RECOVERY_CLOCK;
  leagues:{key:string;nativeLeagueId:string;season:2026;nativeWeek:7;rosterCount:20;requiredInitiallyAccepted:true}[];
  initialScope:typeof RECOVERY_INITIAL_SCOPE; initialRequests:{cohort:string;username:string;leagueKeys:string[];nativeLeagueIds:string[];endpointIds:string[]}[];
  pairs:RecoveryPairBinding[]; samples:{id:string;pairId:string;ordinal:number;offsetMs:number}[]; endpoints:RecoveryEndpoint[]; submissions:RecoverySubmission[]; correctionTargets:{cohort:string;username:string;nativeUsername:string;cadenceSeconds:86400;expectedCycle:1;endpointIds:string[]}[]; gaps:string[]; digest:string };
const created=new WeakSet<CapacityRecoveryManifest>();
const json=(text:string)=>JSON.parse(text) as JsonValue;
const object=(value:JsonValue)=>{assert(value&&typeof value==='object'&&!Array.isArray(value));return value as Record<string,JsonValue>;};
const array=(value:JsonValue)=>{assert(Array.isArray(value));return value;};
function payload(version:string,value:JsonValue):PayloadVersion{const utf8=JSON.stringify(value);return{version,utf8,sha256:createHash('sha256').update(utf8).digest('hex')};}
/** Declared native changes. The maintained normalizers/projectors, not this generator, define accepted semantics. */
function corrected(endpoint:CapacityEndpointBinding):JsonValue {
  if(endpoint.pairIds.length)return json(endpoint.versions[1].utf8);
  const value=json(endpoint.versions[0].utf8);
  if(endpoint.resource==='league') { const row=object(value);object(row.scoring_settings).rec=1;return row; }
  if(endpoint.resource==='identity') {const row=object(value);row.display_name=String(row.display_name??row.username)+' corrected';return row;}
  if(endpoint.resource==='league-list'){for(const item of array(value))object(object(item).scoring_settings).rec=1;return value;}
  if(endpoint.resource==='users'){for(const item of array(value)){const row=object(item);row.display_name=String(row.display_name)+' corrected';}return value;}
  if(endpoint.resource==='matchups'){const row=object(array(value)[0]);row.points=Number(row.points)+1;return value;}
  if(endpoint.resource==='transactions'){const row=object(array(value)[0]);object(row.settings).waiver_bid=1;return value;}
  if(endpoint.resource==='draft-detail'||endpoint.resource==='draft-catalog'){
    const rows=endpoint.resource==='draft-catalog'?array(value):[value];for(const item of rows)object(object(item).settings).reversal_round=1;return value;
  }
  if(endpoint.resource==='draft-selections'){object(array(value)[0]).is_keeper=false;return value;}
  if(endpoint.resource==='league-trades'){object(array(value)[0]).owner_id=3;return value;}
  if(endpoint.resource==='draft-trades')return[{season:'2026',round:1,roster_id:1,owner_id:3,previous_owner_id:1}];
  // Brackets and weekly reports are deliberately unchanged repeat observations, not fabricated new results.
  return value;
}
function replayId(seed:string,cohort:string):string {const bytes=createHash('sha256').update('cp26-recovery/'+seed+'/'+cohort).digest('hex').slice(0,32).split('');bytes[12]='4';bytes[16]='8';const hex=bytes.join('');return [hex.slice(0,8),hex.slice(8,12),hex.slice(12,16),hex.slice(16,20),hex.slice(20)].join('-');}
/** Separate fixed outage/correction workload. No healthy event/sample denominator is changed or relabeled. */
export function createCapacityRecoveryManifest(fleet:CapacityFleetFixture,pins:CapacityRecoveryPins):CapacityRecoveryManifest {
  assert.deepEqual(Object.keys(pins).sort(),['readinessContractSha256','acceptanceContractSha256','plannedPostgresqlVersion','gitSha','appTreeSha','readerQueryMixSha256','requestOwners','observerManifestDigest','requestBudgetPolicy'].sort());
  const {digest:fixtureDigest,...fixtureBody}=fleet;assert.equal(capacityDigest(fixtureBody),fixtureDigest,'recovery fixture drift');
  for(const key of ['readinessContractSha256','acceptanceContractSha256','readerQueryMixSha256','observerManifestDigest'] as const)assert.match(pins[key],/^[a-f0-9]{64}$/u);
  assert.match(pins.gitSha,/^[a-f0-9]{40}$/u);assert.match(pins.appTreeSha,/^[a-f0-9]{40}$/u);assert.match(pins.plannedPostgresqlVersion,/^[1-9][0-9]*\.[0-9]+$/u);
  assert.equal(pins.requestBudgetPolicy,'cp1-data-with-separate-existing-owners-v1');
  assert.deepEqual([...pins.requestOwners].sort(),['administration-maintenance','data-refresh','independent-measurement','primary-projection']);
  const nativeKeys=new Set(fleet.prototype.leagues.map(row=>row.key));
  const endpoints:RecoveryEndpoint[]=fleet.endpointInventory.filter(row=>!row.id.startsWith('aux:')&&!row.id.startsWith('auxiliary:')&&!row.id.includes('overlap')
    &&(row.scope.leagueKey===null||nativeKeys.has(row.scope.leagueKey))).map(endpoint=>{
    const {versions,...binding}=endpoint;const before=versions[0];const value=corrected(endpoint);
    const fields=capacityChangedNativeFields(json(before.utf8),value),changed=fields.length>0;
    const after=endpoint.pairIds.length?versions[1]:changed?payload('recovery:'+endpoint.id+':v1',value):before;
    return{...binding,before:{version:before.version,utf8:before.utf8,sha256:before.sha256},after:{version:after.version,utf8:after.utf8,sha256:after.sha256},
      requirement:endpoint.resource==='player-catalog'||endpoint.resource==='player-position-catalog'?'initial-catalog-only':changed?'post-restore-changed':'post-restore-unchanged',changedFields:fields};
  });
  const pairs:RecoveryPairBinding[]=fleet.prototype.plan.pairs.map(pair=>{
    const event=fleet.prototype.events.find(row=>row.id===pair.id+'/event-1')!,endpoint=endpoints.find(row=>row.pairIds.includes(pair.id))!;
    return{pairId:pair.id,leagueKey:pair.leagueKey,family:pair.family,endpointId:endpoint.id,before:event.before,after:event.after,
      initialReader:fleet.prototype.initialReaders.find(row=>row.pairId===pair.id)!.reader,expectedReader:event.expectedReader,retainedHistory:event.retainedHistory};
  });
  const submissions:RecoverySubmission[]=fleet.users.filter(row=>row.cohort!=='auxiliary').map(user=>({id:('replay-'+user.cohort) as RecoverySubmission['id'],username:user.username,
    leagueKeys:user.leagueKeys,nativeLeagueIds:user.leagueKeys.map(key=>fleet.prototype.leagues.find(row=>row.key===key)!.nativeLeagueId),offsetMs:RECOVERY_CLOCK.submissionMs,
    input:validatePublicIntake({id:replayId(fleet.prototype.plan.seed,user.cohort),username:user.username,seasons:[2026],periodInventory:PUBLIC_PERIOD_INVENTORY,
      transactionHistory:PUBLIC_TRANSACTION_HISTORY,draftPicks:PUBLIC_DRAFT_PICKS,playoffBrackets:PUBLIC_PLAYOFF_BRACKETS,
      weeklyReports:Array.from({length:18},(_,index)=>({season:2026,nativeWeek:index+1}))}),
    endpointIds:endpoints.filter(row=>row.scope.leagueKey!==null&&user.leagueKeys.includes(row.scope.leagueKey)
      ||row.id==='identity:'+user.cohort||row.id==='discovery:'+user.cohort).map(row=>row.id)}));
  const body={kind:'cp26-provider-recovery-manifest-v1' as const,seed:fleet.prototype.plan.seed,source:{...structuredClone(pins),fixtureSha256:fleet.digest},clock:RECOVERY_CLOCK,
    leagues:fleet.prototype.leagues.map(row=>({key:row.key,nativeLeagueId:row.nativeLeagueId,season:2026 as const,nativeWeek:7 as const,rosterCount:20 as const,requiredInitiallyAccepted:true as const})),
    initialScope:RECOVERY_INITIAL_SCOPE,initialRequests:submissions.map(row=>({cohort:row.id.slice(7),username:row.username,leagueKeys:row.leagueKeys,nativeLeagueIds:row.nativeLeagueIds,endpointIds:row.endpointIds.filter(id=>{const endpoint=endpoints.find(item=>item.id===id)!;return ['identity','league-list','league','rosters','users','winners-bracket','losers-bracket'].includes(endpoint.resource)||['matchups','transactions'].includes(endpoint.resource)&&endpoint.scope.nativeWeek===7;})})),
    pairs,samples:pairs.flatMap(pair=>Array.from({length:RECOVERY_CLOCK.samplesPerPair},(_,ordinal)=>({id:pair.pairId+'/recovery-sample-'+ordinal,pairId:pair.pairId,ordinal,offsetMs:RECOVERY_CLOCK.sampleStartMs+ordinal*RECOVERY_CLOCK.sampleIntervalMs}))),endpoints,submissions,correctionTargets:submissions.map(row=>{const cohort=row.id.slice(7),user=fleet.users.find(item=>item.cohort===cohort)!;return{cohort,username:row.username,nativeUsername:user.nativeManagerId,cadenceSeconds:86400 as const,expectedCycle:1 as const,endpointIds:row.endpointIds.map(id=>id==='identity:'+cohort?'identity-native:'+cohort:id)};}),gaps:[...RECOVERY_GAPS]};
  const manifest=freezeCapacityValue({...body,digest:capacityDigest(body)});created.add(manifest);return manifest;
}
export function assertCapacityRecoveryManifest(manifest:CapacityRecoveryManifest):void {
  if(created.has(manifest))return;
  const {digest,...body}=manifest;assert.equal(capacityDigest(body),digest,'recovery manifest hash drift');
  const {fixtureSha256,...pins}=manifest.source,fleet=createCapacityFleetFixture(manifest.seed);assert.equal(fleet.digest,fixtureSha256);
  assert.deepEqual(manifest,createCapacityRecoveryManifest(fleet,pins),'recovery manifest drift');
}

export type RecoveryPairRead = { pairId:string; read:ResourceRead; reader:ReaderExpectation; retainedHistory:ReaderExpectation[]; proofId:string };
export type RecoveryIntakeProof = { requestId:string; terminal:true; terminalRevision:number; nativeIds:readonly string[];
  detailedPeriods:number; detailedTransactions:number; detailedDrafts:number; pages:number;
  draftProofs:{key:string;receiptId:string;endpointId:string;valueDigest:string}[];
  coverage:'complete-materialized-inventory'|'complete-materialized-initial-scope'; parity:'immutable-intake-receipts-and-current-readers'; originalAggregateStatuses:string[]; immutableProofIds:string[]; currentReadProofIds:string[]; completedEndpointIds:string[]; retainedPages:string[] };
export type RecoverySubmissionEvidence = { id:RecoverySubmission['id']; requestId:string; plannedAt:number; dispatchedAt:number;
  receiptAt:number|null; receipt:PublicIntakeSubmissionReceipt|null; completedAt:number|null; completeProof:RecoveryIntakeProof|null };
export type RecoveryEndpointAcceptance = { endpointId:string; requestId:string|null; attemptId:string; proofId:string;
  kind:'resource-receipt'|'identity-observation'|'league-list'|'player-directory-receipt'|'primary-catalog-cache';
  sourceObservedAt:number; acceptedAt:number|null; readAt:number; payloadSha256:string; version:string };
export type RecoveryQueueEvidence = {targets:{cohort:string;targetId:string;configurationRevision:number;configuredAt:number;configuredCompletedAt:number;input:Record<string,JsonValue>}[];
  snapshots:{phase:'after-submissions'|'restored'|'final';at:number;requests:JsonValue[];cycles:JsonValue[];configurations:JsonValue[]}[];
  completed:{requestId:string;completedAt:number;completeProof:RecoveryIntakeProof}[]};
export type CapacityRecoveryEvidence = { manifestDigest:string; startedAt:number; endedAt:number; workDeadlineAt:number;
  ownerCoverage:{owner:string;startedAt:number;endedAt:number}[]; requests:RequestAccounting; origins:OriginObservation[];
  initial:RecoveryPairRead[]; lastGood:{pairId:string;before:RecoveryPairRead;during:RecoveryPairRead}[]; recovered:RecoveryPairRead[];
  samples:SampleEvidence[]; queue:RecoveryQueueEvidence; submissions:RecoverySubmissionEvidence[]; endpointAcceptances:RecoveryEndpointAcceptance[];
  outage:{startedAt:number;dependencyRestoredAt:number|null;runnerRestoredAt:number|null}|null };
function uniqueRecovery<T>(rows:readonly T[],key:(row:T)=>string,allowed?:readonly string[]):Map<string,T>{
  const result=new Map<string,T>();for(const row of rows){const id=key(row);assert(!result.has(id),'duplicate recovery evidence: '+id);
    if(allowed)assert(allowed.includes(id),'undeclared recovery evidence: '+id);result.set(id,row);}return result;
}
const recoveryHash=(value:string)=>assert.match(value,/^[a-f0-9]{64}$/u);
const recoveryId=(value:string)=>assert.match(value,/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/iu);
/** Pure reconciliation. Stored proof records and actual lifecycle/LOGIN remain separately verified by the guarded parent. */
export function evaluateCapacityRecovery(manifest:CapacityRecoveryManifest,evidence:CapacityRecoveryEvidence){
  assertCapacityRecoveryManifest(manifest);assert.equal(evidence.manifestDigest,manifest.digest,'recovery source drift');
  const start=capacityTime(evidence.startedAt),end=capacityTime(evidence.endedAt),deadline=capacityTime(evidence.workDeadlineAt);
  assert(end>=start);assert(deadline<=start+RECOVERY_CLOCK.workMs,'recovery budget renewed at worker start');
  const outageAt=start+RECOVERY_CLOCK.outageStartMs,restoreAt=start+RECOVERY_CLOCK.outageEndMs;
  const errors:string[]=[],missing:string[]=[];
  const need=(condition:unknown,message:string,observableDeadline:number)=>{if(!condition)(end>=observableDeadline?errors:missing).push(message);};
  const pairIds=manifest.pairs.map(row=>row.pairId),endpointIds=manifest.endpoints.map(row=>row.id);
  const initial=uniqueRecovery(evidence.initial,row=>row.pairId,pairIds),lastGood=uniqueRecovery(evidence.lastGood,row=>row.pairId,pairIds),recovered=uniqueRecovery(evidence.recovered,row=>row.pairId,pairIds);
  const samples=uniqueRecovery(evidence.samples,row=>row.id,manifest.samples.map(row=>row.id));
  const submissions=uniqueRecovery(evidence.submissions,row=>row.id,manifest.submissions.map(row=>row.id));
  const attempts=uniqueRecovery(evidence.requests.attempts,row=>row.id),origins=uniqueRecovery(evidence.origins,row=>row.id);
  const endpointProofs=uniqueRecovery(evidence.endpointAcceptances,row=>`${row.requestId??'shared'}/${row.endpointId}`);
  const owners=uniqueRecovery(evidence.ownerCoverage,row=>row.owner,manifest.source.requestOwners);
  for(const owner of manifest.source.requestOwners){const row=owners.get(owner);if(row){capacityTime(row.startedAt);capacityTime(row.endedAt);assert(row.endedAt>=row.startedAt);}
    need(row&&row.startedAt<=start&&row.endedAt>=end,'incomplete owner transport coverage: '+owner,outageAt);}
  for(const attempt of attempts.values())assertCapacityHttpEndpoint(attempt,true);
  for(const origin of origins.values()){
    const pair=manifest.pairs.find(row=>row.pairId===origin.pairId);assert(pair,'unknown recovery source pair');
    assert(origin.kind==='successful-provider-observation');capacityTime(origin.observedAt);
    assert([pair.before,pair.after].some(value=>value.version===origin.version&&value.sha256===origin.payloadSha256),'unbound recovery source version');
    const attempt=attempts.get(origin.attemptId),endpoint=manifest.endpoints.find(row=>row.id===pair.endpointId)!;
    assert(attempt?.outcome==='success'&&attempt.responseSha256===origin.payloadSha256,'missing recovery source attempt');
    assert.equal(attempt.origin+attempt.path,endpoint.url);assert.equal(origin.observedAt,attempt.endedAt,'recovery origin must use actual full-byte availability');
    const published=attempt.at<restoreAt?pair.before:pair.after;assert.equal(origin.version,published.version);assert.equal(origin.payloadSha256,published.sha256,'unpublished recovery payload');
  }
  function pairRead(row:RecoveryPairRead|undefined,pair:RecoveryPairBinding,phase:'before'|'after'){
    if(!row)return false;assert.equal(row.pairId,pair.pairId);recoveryId(row.proofId);
    const expected=phase==='before'?pair.initialReader:pair.expectedReader,payload=phase==='before'?pair.before:pair.after;
    const origin=origins.get(row.read.originObservationId);capacityTime(row.read.at);
    const valid=row.read.committed===true&&row.read.storedOnly===true&&row.read.at>=start&&row.read.at<=end
      &&origin?.pairId===pair.pairId&&origin.version===payload.version&&origin.payloadSha256===payload.sha256
      &&origin.observedAt<=row.read.at&&row.read.version===payload.version&&row.read.payloadSha256===payload.sha256
      &&capacityDigest(row.reader)===capacityDigest(expected);
    if(phase==='after')return valid&&origin!.observedAt>=restoreAt&&row.read.at-origin!.observedAt<=CAPACITY_LIMITS.sourceAgeP95Ms&&capacityDigest(row.retainedHistory)===capacityDigest(pair.retainedHistory);
    return valid;
  }
  let actualRestore:number|null=null;
  if(evidence.outage){const outage=evidence.outage;capacityTime(outage.startedAt);
    need(outage.startedAt>=outageAt&&outage.startedAt<=outageAt+RECOVERY_CLOCK.dispatchLatenessMs,'fixed outage start missed',outageAt+RECOVERY_CLOCK.dispatchLatenessMs);
    for(const value of [outage.dependencyRestoredAt,outage.runnerRestoredAt])if(value!==null)capacityTime(value);
    if(outage.dependencyRestoredAt!==null&&outage.runnerRestoredAt!==null){
      need(outage.dependencyRestoredAt>=restoreAt&&outage.dependencyRestoredAt<=restoreAt+RECOVERY_CLOCK.dispatchLatenessMs,'fixed dependency restoration missed',restoreAt+RECOVERY_CLOCK.dispatchLatenessMs);
      assert(outage.runnerRestoredAt>=restoreAt&&outage.runnerRestoredAt<=end);
      actualRestore=Math.max(outage.dependencyRestoredAt,outage.runnerRestoredAt);
    }
  }
  need(evidence.outage!==null,'missing actual outage control',outageAt+RECOVERY_CLOCK.dispatchLatenessMs);
  need(actualRestore!==null,'missing actual restoration control',restoreAt+RECOVERY_CLOCK.dispatchLatenessMs);
  const freshnessDeadline=(actualRestore??restoreAt)+RECOVERY_CLOCK.freshAfterRestoreMs;
  const backlogDeadline=(actualRestore??restoreAt)+RECOVERY_CLOCK.backlogAfterRestoreMs;
  for(const pair of manifest.pairs){
    const first=initial.get(pair.pairId),last=lastGood.get(pair.pairId),after=recovered.get(pair.pairId);
    need(pairRead(first,pair,'before')&&first!.read.at<=outageAt,'initial acceptance missing or late: '+pair.pairId,outageAt);
    need(last&&last.pairId===last.before.pairId&&last.pairId===last.during.pairId&&pairRead(last.before,pair,'before')&&pairRead(last.during,pair,'before')
      &&last.before.read.at>=outageAt-60_000&&last.before.read.at<outageAt&&last.during.read.at>=outageAt&&last.during.read.at<restoreAt
      &&origins.get(last.before.read.originObservationId)!.observedAt<outageAt&&origins.get(last.during.read.originObservationId)!.observedAt<outageAt,'last-good value/receipt unavailable: '+pair.pairId,restoreAt);
    need(pairRead(after,pair,'after')&&after!.read.at>=restoreAt&&after!.read.at<=freshnessDeadline,'fresh post-restore value/history missing or late: '+pair.pairId,freshnessDeadline);
  }
  const sourceAge=manifest.pairs.map(pair=>{
    const values=manifest.samples.filter(slot=>slot.pairId===pair.pairId).map(slot=>{
      const row=samples.get(slot.id),scheduledAt=start+slot.offsetMs;
      need(row,'missing scheduled recovery sample: '+slot.id,scheduledAt+RECOVERY_CLOCK.sampleTimeoutMs);
      if(!row)return 'infinity' as const;capacityTime(row.at);assert(['available','unavailable','timeout'].includes(row.status));
      if(row.at<scheduledAt||row.at>scheduledAt+RECOVERY_CLOCK.sampleDispatchLatenessMs||row.status!=='available'||!row.read||row.read.at<row.at||row.read.at>scheduledAt+RECOVERY_CLOCK.sampleTimeoutMs)return 'infinity' as const;
      const read=row.read,origin=origins.get(read.originObservationId);capacityTime(read.at);
      if(read.committed!==true||read.storedOnly!==true||read.at>end||!origin||origin.pairId!==pair.pairId||origin.version!==read.version||origin.payloadSha256!==read.payloadSha256||origin.observedAt>read.at)return 'infinity' as const;
      return read.at-origin.observedAt;
    });
    const heads=[initial.get(pair.pairId)?.read,lastGood.get(pair.pairId)?.before.read,lastGood.get(pair.pairId)?.during.read,recovered.get(pair.pairId)?.read,...manifest.samples.filter(slot=>slot.pairId===pair.pairId).map(slot=>samples.get(slot.id)?.read)]
      .filter((read):read is ResourceRead=>Boolean(read&&read.committed&&read.storedOnly&&origins.get(read.originObservationId)?.pairId===pair.pairId&&read.at<=end)).sort((a,b)=>a.at-b.at);
    let changed=false;for(const read of heads){if(read.version===pair.after.version)changed=true;else if(changed&&read.version===pair.before.version){errors.push('accepted recovery head regression: '+pair.pairId);break;}}
    return{pairId:pair.pairId,sourceAge:summarizeCapacity(values)};
  });
  const duringAttempts=[...attempts.values()].filter(row=>row.at>=outageAt&&row.at<restoreAt);
  need(duringAttempts.length>0,'provider outage was not exercised',restoreAt);
  if(duringAttempts.some(row=>row.outcome==='success'))errors.push('Sleeper request succeeded during declared provider outage');
  for(const endpointProof of endpointProofs.values()){
    assert(endpointIds.includes(endpointProof.endpointId));assert(typeof endpointProof.proofId==='string'&&endpointProof.proofId.length>0);
    const endpoint=manifest.endpoints.find(row=>row.id===endpointProof.endpointId)!,attempt=attempts.get(endpointProof.attemptId);
    assert(attempt?.outcome==='success','endpoint acceptance needs successful actual attempt');
    assert.equal(attempt.method,endpoint.method);assert.equal(attempt.origin+attempt.path,endpoint.url);
    assert.equal(attempt.responseSha256,endpointProof.payloadSha256);recoveryHash(endpointProof.payloadSha256);
    capacityTime(endpointProof.sourceObservedAt);capacityTime(endpointProof.readAt);
    assert(endpointProof.sourceObservedAt>=attempt.endedAt&&endpointProof.readAt>=endpointProof.sourceObservedAt&&endpointProof.readAt<=end);
    const kind=endpoint.resource==='identity'?'identity-observation':endpoint.resource==='league-list'?'league-list':endpoint.resource==='player-catalog'?'player-directory-receipt':endpoint.resource==='player-position-catalog'?'primary-catalog-cache':'resource-receipt';
    assert.equal(endpointProof.kind,kind);
    if(kind==='primary-catalog-cache')assert.equal(endpointProof.acceptedAt,null);
    else {assert(endpointProof.acceptedAt!==null);capacityTime(endpointProof.acceptedAt);recoveryId(endpointProof.proofId);
      assert(endpointProof.acceptedAt>=endpointProof.sourceObservedAt-1&&endpointProof.acceptedAt<=endpointProof.readAt,'acceptance outside actual observation/read span');}
    if(endpoint.requirement==='initial-catalog-only'){assert.equal(endpointProof.requestId,null);assert.equal(endpointProof.version,endpoint.before.version);assert.equal(endpointProof.payloadSha256,endpoint.before.sha256);}
    else {const submission=manifest.submissions.find(row=>row.input.id===endpointProof.requestId);assert(submission?.endpointIds.includes(endpoint.id),'endpoint proof belongs to unrelated replay');
      assert.equal(endpointProof.version,endpoint.after.version);assert.equal(endpointProof.payloadSha256,endpoint.after.sha256);}
  }
  function assertCompleteProof(proof:RecoveryIntakeProof,requestId:string,expected:{nativeLeagueIds:readonly string[];leagueKeys:readonly string[];endpointIds:readonly string[];initial?:boolean}){
    {assert.equal(proof.requestId,requestId);assert.equal(proof.terminal,true);assert(Number.isSafeInteger(proof.terminalRevision)&&proof.terminalRevision>0);
        assert.deepEqual([...proof.nativeIds].sort(),[...expected.nativeLeagueIds].sort());
        assert.equal(proof.detailedPeriods,expected.leagueKeys.length*(expected.initial?1:18));assert.equal(proof.detailedTransactions,expected.leagueKeys.length*(expected.initial?1:19));assert.equal(proof.detailedDrafts,expected.leagueKeys.length*(expected.initial?0:5));
        assert(Number.isSafeInteger(proof.pages)&&proof.pages>0&&proof.pages<=20);assert.equal(proof.coverage,expected.initial?'complete-materialized-initial-scope':'complete-materialized-inventory');assert.equal(proof.parity,'immutable-intake-receipts-and-current-readers');
        assert.equal(proof.originalAggregateStatuses.length,proof.pages);assert(proof.originalAggregateStatuses.every(status=>['available','partial'].includes(status)));
        assert.deepEqual([...proof.completedEndpointIds].sort(),[...expected.endpointIds].sort(),'incomplete immutable endpoint inventory');
        for(const ids of [proof.immutableProofIds,proof.currentReadProofIds]){assert(ids.length>0);assert.equal(new Set(ids).size,ids.length);ids.forEach(id=>assert(typeof id==='string'&&id.length>0));}proof.immutableProofIds.forEach(recoveryId);proof.currentReadProofIds.forEach(recoveryHash);assert.equal(proof.currentReadProofIds.length,expected.nativeLeagueIds.length*3);
        assert.equal(new Set(proof.retainedPages).size,proof.retainedPages.length);assert.equal(proof.retainedPages.length,proof.pages);proof.retainedPages.forEach(recoveryHash);
        const expectedDrafts=expected.endpointIds.filter(id=>['draft-catalog','draft-detail','draft-selections','draft-trades','league-trades'].includes(manifest.endpoints.find(row=>row.id===id)!.resource));
        uniqueRecovery(proof.draftProofs,item=>item.endpointId,expectedDrafts);assert.equal(proof.draftProofs.length,expectedDrafts.length);
        for(const item of proof.draftProofs){recoveryId(item.receiptId);recoveryHash(item.valueDigest);assert(item.key.length>0);}
      }
  }
  for(const submission of manifest.submissions){const row=submissions.get(submission.id),plannedAt=start+submission.offsetMs;
    if(row){assert.equal(row.requestId,submission.input.id);assert.equal(row.plannedAt,plannedAt);capacityTime(row.dispatchedAt);
      need(row.dispatchedAt>=plannedAt&&row.dispatchedAt<=plannedAt+RECOVERY_CLOCK.dispatchLatenessMs,'frozen replay dispatch missed: '+submission.id,plannedAt+RECOVERY_CLOCK.dispatchLatenessMs);
      if(row.receiptAt!==null)capacityTime(row.receiptAt);
      need(row.receipt?.status==='retained'&&row.receipt.requestId===row.requestId&&row.receiptAt!==null&&row.receiptAt>=row.dispatchedAt&&row.receiptAt-row.dispatchedAt<=CAPACITY_LIMITS.receiptMs,'ordinary replay receipt unavailable: '+submission.id,plannedAt+RECOVERY_CLOCK.dispatchLatenessMs+CAPACITY_LIMITS.receiptMs);
      const proof=row.completeProof;
      if(proof)assertCompleteProof(proof,row.requestId,submission);
      if(row.completedAt!==null){capacityTime(row.completedAt);assert(row.completedAt<=end&&row.receiptAt!==null&&row.completedAt>=row.receiptAt,'completion outside recorded receipt/snapshot span');}
      need(proof&&row.completedAt!==null&&row.completedAt>=restoreAt&&row.completedAt<=backlogDeadline,'full replay inventory incomplete or late: '+submission.id,backlogDeadline);
    }else need(false,'missing ordinary replay submission: '+submission.id,plannedAt+RECOVERY_CLOCK.dispatchLatenessMs);
    for(const id of submission.endpointIds){const proof=endpointProofs.get(submission.input.id+'/'+id);
      need(proof&&attempts.get(proof.attemptId)!.at>=restoreAt&&proof.readAt<=backlogDeadline,'post-restore endpoint not materialized: '+id,backlogDeadline);}
  }
  // The three fixed 24-hour approvals each owe one initial correction cycle, even if it materializes later.
  const queue=evidence.queue,targets=uniqueRecovery(queue.targets,row=>row.cohort,manifest.correctionTargets.map(row=>row.cohort));
  const snapshots=uniqueRecovery(queue.snapshots,row=>row.phase,['after-submissions','restored','final']);
  const completions=uniqueRecovery(queue.completed,row=>row.requestId),requiredQueue=new Map<string,{nativeLeagueIds:string[];leagueKeys:string[];endpointIds:string[];initial?:boolean}>();
  const time=(value:JsonValue|undefined)=>{assert(typeof value==='string');const result=Date.parse(value);capacityTime(result);return result;};
  const same=(a:unknown,b:unknown,message:string)=>assert.equal(capacityDigest(a),capacityDigest(b),message);
  const fullPeriods=Array.from({length:18},(_,index)=>({season:2026,nativeWeek:index+1}));
  const scopeFields=[['seasons','seasons'],['periodInventory','period_inventory'],['transactionHistory','transaction_history'],['draftPicks','draft_picks'],['playoffBrackets','playoff_brackets'],['weeklyReports','weekly_reports']] as const;
  const targetIds=new Set<string>(),initialIds=new Set<string>(),cycleBindings=new Map<string,string>(),seenRequests=new Set<string>(),seenCycles=new Set<string>(),sqlConfigurations=new Map<string,Record<string,JsonValue>>(),sqlCreated=new Map<string,number>(),cycleDigests=new Map<string,string>();
  for(const planned of manifest.correctionTargets){const target=targets.get(planned.cohort),submission=manifest.submissions.find(row=>row.id==='replay-'+planned.cohort)!;
    need(target,'missing frozen correction target: '+planned.cohort,outageAt);if(!target)continue;
    recoveryId(target.targetId);assert(!targetIds.has(target.targetId));targetIds.add(target.targetId);assert.equal(target.configurationRevision,1);capacityTime(target.configuredAt);capacityTime(target.configuredCompletedAt);assert(target.configuredAt>=start&&target.configuredCompletedAt>=target.configuredAt&&target.configuredCompletedAt<=outageAt);
    const input=target.input;assert.equal(input.id,target.targetId);assert.equal(input.expectedRevision,0);assert.equal(input.cadenceSeconds,planned.cadenceSeconds);assert.equal(input.paused,false);assert.equal(time(input.expiresAt),deadline);
    const initialId=String(input.identityRequestId);recoveryId(initialId);assert(!initialIds.has(initialId));initialIds.add(initialId);
    for(const [native] of scopeFields)same(input[native],(submission.input as unknown as Record<string,unknown>)[native],'frozen correction scope drift');
    const declaredInitial=manifest.initialRequests.find(row=>row.cohort===planned.cohort)!;requiredQueue.set(initialId,{nativeLeagueIds:declaredInitial.nativeLeagueIds,leagueKeys:declaredInitial.leagueKeys,endpointIds:declaredInitial.endpointIds,initial:true});
  }
  let previousSnapshot=0;
  for(const phase of ['after-submissions','restored','final'] as const){const snapshot=snapshots.get(phase);need(snapshot,'missing queued inventory snapshot: '+phase,phase==='after-submissions'?restoreAt:backlogDeadline);if(!snapshot)continue;
    capacityTime(snapshot.at);assert(snapshot.at>=previousSnapshot&&snapshot.at<=end);assert(snapshot.at>= (phase==='after-submissions'?start+RECOVERY_CLOCK.submissionMs:restoreAt));previousSnapshot=snapshot.at;
    const configurations=uniqueRecovery(snapshot.configurations.map(object),row=>String(object(row.target).id));assert.equal(configurations.size,targetIds.size);
    for(const target of targets.values()){const item=configurations.get(target.targetId);assert(item);const actual=object(item.target),config=object(item.configuration);
      assert.equal(actual.configuration_revision,target.configurationRevision);assert.equal(config.target_id,target.targetId);assert.equal(config.revision,target.configurationRevision);assert.equal(config.identity_request_id,target.input.identityRequestId);assert.equal(config.cadence_seconds,86400);assert.equal(config.paused,false);assert.equal(time(config.expires_at),deadline);
      const targetCreated=time(actual.created_at),configured=time(config.configured_at);assert(configured>=targetCreated-1,'SQL configuration predates target');if(sqlCreated.has(target.targetId))assert.equal(sqlCreated.get(target.targetId),targetCreated);else sqlCreated.set(target.targetId,targetCreated);if(sqlConfigurations.has(target.targetId))same(config,sqlConfigurations.get(target.targetId),'immutable SQL configuration changed');else sqlConfigurations.set(target.targetId,config);
      for(const [native,column]of scopeFields)same(config[column],target.input[native],'stored correction scope drift');same(config.exact_periods,fullPeriods,'stored exact scope drift');
    }
    const cycles=uniqueRecovery(snapshot.cycles.map(object),row=>String(row.target_id));
    for(const id of seenCycles)assert(cycles.has(id),'immutable correction cycle disappeared');
    for(const [id,cycle]of cycles){const target=queue.targets.find(row=>row.targetId===id);assert(target,'unexpected correction target');assert.equal(cycle.cycle,1);assert.equal(cycle.configuration_revision,target.configurationRevision);
      const requestId=String(cycle.intake_id);recoveryId(requestId);const existing=cycleBindings.get(id);if(existing)assert.equal(existing,requestId);else cycleBindings.set(id,requestId);seenCycles.add(id);
      const cycleCreated=time(cycle.created_at);assert(cycleCreated>=time(sqlConfigurations.get(id)!.configured_at)-1);assert(time(cycle.due_at)>=sqlCreated.get(id)!-1&&time(cycle.due_at)<=cycleCreated);const digest=capacityDigest(cycle);if(cycleDigests.has(id))assert.equal(cycleDigests.get(id),digest,'immutable SQL cycle changed');else cycleDigests.set(id,digest);
      const plan=manifest.correctionTargets.find(row=>row.cohort===target.cohort)!,submission=manifest.submissions.find(row=>row.id==='replay-'+target.cohort)!;
      requiredQueue.set(requestId,{nativeLeagueIds:submission.nativeLeagueIds,leagueKeys:submission.leagueKeys,endpointIds:plan.endpointIds});
    }
    const requests=uniqueRecovery(snapshot.requests.map(object),row=>String(row.id));for(const id of seenRequests)assert(requests.has(id),'immutable intake disappeared');
    for(const [id,request]of requests){recoveryId(id);seenRequests.add(id);time(request.created_at);
      if(request.resource_occurrence_id!==null&&request.resource_occurrence_id!==undefined){recoveryId(String(request.resource_occurrence_id));continue;}
      const explicit=manifest.submissions.find(row=>row.input.id===id),required=requiredQueue.get(id);assert(explicit||required,'unexpected ordinary queued work');
      const cohort=explicit?.id.slice(7)??queue.targets.find(row=>row.input.identityRequestId===id||cycleBindings.get(row.targetId)===id)!.cohort;
      const planned=manifest.correctionTargets.find(row=>row.cohort===cohort)!;assert.equal(request.username,cycleBindings.get(queue.targets.find(row=>row.cohort===cohort)!.targetId)===id?planned.nativeUsername:planned.username);
      const initial=initialIds.has(id),expected=(initial?manifest.initialScope:manifest.submissions.find(row=>row.id==='replay-'+cohort)!.input) as unknown as Record<string,unknown>;
      for(const [native,column]of scopeFields)same(request[column],expected[native]??(native==='weeklyReports'?[]:null),'queued intake scope drift');same(request.exact_periods,initial?manifest.initialScope.exactPeriods:fullPeriods,'queued exact scope drift');same(request.transaction_period,initial?manifest.initialScope.transactionPeriod:null,'queued transaction scope drift');
    }
    for(const id of [...initialIds,...manifest.submissions.map(row=>row.input.id),...cycleBindings.values()])assert(requests.has(id),'declared queued request missing');
  }
  for(const target of targets.values())need(cycleBindings.has(target.targetId),'initial correction cycle never materialized: '+target.targetId,backlogDeadline);
  for(const [requestId,expected]of requiredQueue){const completed=completions.get(requestId);need(completed,'queued initial/correction intake incomplete: '+requestId,backlogDeadline);if(!completed)continue;
    capacityTime(completed.completedAt);assert(completed.completedAt>=start&&completed.completedAt<=end);assertCompleteProof(completed.completeProof,requestId,expected);need(completed.completedAt<=backlogDeadline,'queued intake completed after recovery deadline: '+requestId,backlogDeadline);
    const final=snapshots.get('final')?.requests.map(object).find(row=>row.id===requestId);assert(final?.terminal===true&&final.revision===completed.completeProof.terminalRevision,'completion differs from actual final intake');
  }
  for(const id of completions.keys())assert(requiredQueue.has(id),'undeclared queued completion');
  for(const replay of evidence.submissions)if(replay.completeProof){const final=snapshots.get('final')?.requests.map(object).find(row=>row.id===replay.requestId);assert(final?.terminal===true&&final.revision===replay.completeProof.terminalRevision,'replay completion differs from final intake');}
  for(const endpoint of manifest.endpoints.filter(row=>row.requirement==='initial-catalog-only')){const proof=endpointProofs.get('shared/'+endpoint.id);
    need(proof&&proof.readAt<=outageAt,'initial shared catalog witness missing: '+endpoint.id,outageAt);}
  if(end>deadline)errors.push('evidence exceeds original supervisor work deadline');
  const requestEnvelope=end>=outageAt?evaluateRequestEnvelope(manifest.source.requestOwners,evidence.requests,outageAt,end,manifest.source.requestBudgetPolicy):null;
  if(requestEnvelope&&!requestEnvelope.pass)errors.push('request envelope failed');
  const status=errors.length?'fail':missing.length?'incomplete':'pass';
  return{kind:'cp26-provider-recovery-analysis-v1' as const,manifestDigest:manifest.digest,status,pass:status==='pass',errors,missing,
    clocks:{startedAt:start,outageAt,plannedRestoreAt:restoreAt,actualRestoreAt:actualRestore,freshnessDeadline,backlogDeadline,workDeadlineAt:deadline,endedAt:end},
    coverage:{requiredPairs:64,initial:initial.size,lastGood:lastGood.size,recovered:recovered.size,requiredReplays:3,replays:submissions.size,
      requiredQueuedIntakes:requiredQueue.size,requiredFullBacklogRequests:6,requiredInitialRequests:3,completedQueuedIntakes:completions.size,requiredCorrectionCycles:3,materializedCorrectionCycles:cycleBindings.size,requiredEndpointProofs:manifest.submissions.reduce((sum,row)=>sum+row.endpointIds.length,0)+7,endpointProofs:endpointProofs.size},
    sourceAge,requestEnvelope,catalogRecurrenceQualified:false as const,checkpoint26Qualified:false as const,gaps:[...RECOVERY_GAPS]};
}
