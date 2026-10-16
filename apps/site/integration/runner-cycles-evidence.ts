import assert from 'node:assert/strict';
import { lstat, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { qualificationDigest, type QualificationBinding } from './qualification-profile';
import { runnerTimestamp, RUNNER_STAGES } from './runner-cycles-protocol';

export const RUNNER_CYCLES_EVIDENCE_FILE = 'runner-cycles-evidence.json';
export const RUNNER_CYCLES_LIMITS = [60_000,660_000,600_000,60_000] as const;
export const RUNNER_CYCLES_NAMES = [
  'keeps omitted and explicit false selections free of DATA acquisition and writes',
  'completes the first cycle across pending pause expiry and an inter-invocation process restart',
  'completes a changed second cycle while admitted work survives pause expiry and later disablement',
  'retains both cycle histories and stored reader parity without non-DATA mutation',
] as const;
export const RUNNER_CYCLES_ORACLES = [
  { oracle:'default-off', omitted:true, explicitFalse:true, noDataWrites:true, noAcquisition:true },
  { oracle:'first-cycle', complete:true, pausedPending:true, expiredPending:true, sameRequest:true, independentRestart:true, oldProcessClosed:true, oldBackendClosed:true },
  { oracle:'second-cycle', complete:true, admittedBeforePause:true, admittedBeforeExpiry:true, originalFence:true, falseAfterAdmission:true, nextAdmissionDisabled:true, resumedSameRequest:true },
  { oracle:'history', twoSettledCycles:true, changedExactValues:true, unchangedContentFreshCapture:true, earlierHistoryPreserved:true, storedOnly:true, noNonDataMutation:true },
] as const;
type Scalar = string|number|boolean|null;
export type RunnerEvent = { at: string; data: Record<string,Scalar|readonly Scalar[]> };
export type RunnerCaseEvidence = { name: string; limitMs: number; state: 'unserved'|'running'|'passed'|'failed'; startedAt: string|null; endedAt: string|null; events: RunnerEvent[] };
export type RunnerAdmission = { resource: string; requestId: string; generation: number; admittedAt: string; deadlineAt: string; outcomeAt: string; outcome: 'checkpoint-committed' };
export type RunnerInvocation = { pid: number; invocation: number; selection: 'omitted'|'false'|'enabled'; variant: 1|2;
  startedAt: string; invocationStartedAt:string; endedAt: string; gets: number; sqlRequests: number; signalRequests: number;
  registrySqlRequests: number; registrySignalRequests: number; claimBefore: number; claimAfter: number;
  facade: 'registry-unavailable'; paths: string[]; admissions: RunnerAdmission[] };
export type RunnerCycleEvidence = { number: 1|2; requestId: string; configurationRevision: number; historyDigest: string;
  dueAt:string; disposition:'complete'; recordedAt: string; nextDueAt: string; directoryContentId: string; directoryCaptureId: string; directoryCapturedAt: string; exactContentId: string };
export type RunnerCyclesEvidence = { kind:'data-runner-cycles-evidence-v1'; contextDigest:string; gitSha:string; serverVersion:string; serverVersionNum:string;
  actualRuntimeLogin:boolean; actualHttpRuntimeLogin:boolean; primaryBoundary:'empty-registry-rejection'; prerequisiteGets:number; prerequisiteAdmissions:number; prerequisiteClaims:number;
  cleanupComplete:boolean; admissionSpacingVerified:boolean; cases:RunnerCaseEvidence[]; invocations:RunnerInvocation[]; cycles:RunnerCycleEvidence[] };
const maxBytes = 1024*1024;
const uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/u;
function keys(value:object,wanted:string[]) { assert.deepEqual(Object.keys(value).sort(),wanted.sort()); }
function timestamp(value:unknown): asserts value is string { assert.equal(typeof value,'string'); assert.equal(runnerTimestamp(value),value); }
function scalar(value:unknown) { assert(value===null||typeof value==='boolean'||typeof value==='number'&&Number.isFinite(value)
  ||typeof value==='string'&&value.length<=300&&!/(?:postgres(?:ql)?:|https?:\/\/|password|sentinel|secret|credential|DATABASE_URL)/iu.test(value)); }
export function assertRunnerCyclesEvidence(value:RunnerCyclesEvidence,binding:QualificationBinding):void {
  assert(Buffer.byteLength(JSON.stringify(value))<=maxBytes);
  keys(value,['kind','contextDigest','gitSha','serverVersion','serverVersionNum','actualRuntimeLogin','actualHttpRuntimeLogin','primaryBoundary','prerequisiteGets','prerequisiteAdmissions','prerequisiteClaims','cleanupComplete','admissionSpacingVerified','cases','invocations','cycles']);
  assert.equal(value.kind,'data-runner-cycles-evidence-v1'); assert.equal(value.contextDigest,qualificationDigest(binding.context));
  assert.equal(value.gitSha,binding.context.gitSha); assert.equal(binding.context.profile,'data-runner-cycles-v1');
  scalar(value.serverVersion);assert.match(value.serverVersionNum,/^[0-9]{5,6}$/u);
  const version=Number(value.serverVersionNum);assert(version>=100000);assert(new RegExp('^'+Math.floor(version/10000)+'\\.'+(version%10000)+'(?:\\s|$)','u').test(value.serverVersion));
  assert.equal(typeof value.actualRuntimeLogin,'boolean');assert.equal(typeof value.actualHttpRuntimeLogin,'boolean');assert.equal(value.primaryBoundary,'empty-registry-rejection');
  for(const count of [value.prerequisiteGets,value.prerequisiteAdmissions,value.prerequisiteClaims])assert(Number.isInteger(count)&&count>=0&&count<=4);
  assert.equal(typeof value.cleanupComplete,'boolean');assert.equal(typeof value.admissionSpacingVerified,'boolean');
  assert.equal(value.cases.length,4);
  for(const [index,entry] of value.cases.entries()) {
    keys(entry,['name','limitMs','state','startedAt','endedAt','events']);assert.equal(entry.name,RUNNER_CYCLES_NAMES[index]);assert.equal(entry.limitMs,RUNNER_CYCLES_LIMITS[index]);
    assert(['unserved','running','passed','failed'].includes(entry.state));if(entry.startedAt!==null)timestamp(entry.startedAt);if(entry.endedAt!==null)timestamp(entry.endedAt);
    if(entry.state==='passed')assert(entry.startedAt&&entry.endedAt);
    if(entry.startedAt&&entry.endedAt)assert(Date.parse(entry.endedAt)>=Date.parse(entry.startedAt)&&Date.parse(entry.endedAt)-Date.parse(entry.startedAt)<=entry.limitMs);
    const previous=value.cases[index-1];if(previous?.endedAt&&entry.startedAt)assert(Date.parse(entry.startedAt)>=Date.parse(previous.endedAt));
    assert(Array.isArray(entry.events)&&entry.events.length<=100);
    for(const event of entry.events) {keys(event,['at','data']);timestamp(event.at);assert(entry.startedAt&&Date.parse(event.at)>=Date.parse(entry.startedAt));
      if(entry.endedAt)assert(Date.parse(event.at)<=Date.parse(entry.endedAt));assert(Object.keys(event.data).length<=30);
      for(const [key,item] of Object.entries(event.data)){assert(/^[A-Za-z][A-Za-z0-9]{0,63}$/u.test(key)&&!/(?:password|secret|credential|url)/iu.test(key));
        if(Array.isArray(item)){assert(item.length<=40);item.forEach(scalar);}else scalar(item);}}
  }
  assert(Array.isArray(value.invocations)&&value.invocations.length<=30);
  let priorClaim=value.prerequisiteClaims;
  let priorEnd:string|null=null;
  for(const row of value.invocations) {
    keys(row,['pid','invocation','selection','variant','startedAt','invocationStartedAt','endedAt','gets','sqlRequests','signalRequests','registrySqlRequests','registrySignalRequests','claimBefore','claimAfter','facade','paths','admissions']);
    assert(Number.isInteger(row.pid)&&row.pid>1&&Number.isInteger(row.invocation)&&row.invocation>0);
    assert(['omitted','false','enabled'].includes(row.selection)&&[1,2].includes(row.variant));assert.equal(row.facade,'registry-unavailable');
    timestamp(row.startedAt);timestamp(row.invocationStartedAt);timestamp(row.endedAt);assert(Date.parse(row.endedAt)>=Date.parse(row.startedAt)&&Date.parse(row.endedAt)-Date.parse(row.startedAt)<=30_000);
    assert(Date.parse(row.invocationStartedAt)>=Date.parse(row.startedAt)&&Date.parse(row.invocationStartedAt)<=Date.parse(row.endedAt));
    if(priorEnd)assert(Date.parse(row.startedAt)>=Date.parse(priorEnd));priorEnd=row.endedAt;
    assert.equal(row.claimBefore,priorClaim);assert(Number.isInteger(row.claimAfter)&&row.claimAfter>=row.claimBefore&&row.claimAfter<=row.claimBefore+1);priorClaim=row.claimAfter;
    assert(Number.isInteger(row.gets)&&row.gets>=0&&row.gets<=2);assert.equal(row.paths.length,row.gets);
    for(const path of row.paths)assert(/^\/v1\/(?:user|league)\/[a-zA-Z0-9_/-]{1,100}$/u.test(path));
    assert(Number.isInteger(row.sqlRequests)&&row.sqlRequests>=1&&row.sqlRequests<=100);
    assert(Number.isInteger(row.signalRequests)&&row.signalRequests>=0&&row.signalRequests<=row.sqlRequests);
    // The real empty registry issues exactly one independently bounded SELECT.
    // Keep total transport counts: only this positively identified read may be
    // present while DATA is disabled, and its signal cannot prove DATA bounds.
    assert.equal(row.registrySqlRequests,1);assert.equal(row.registrySignalRequests,1);
    assert(row.registrySqlRequests<=row.sqlRequests&&row.registrySignalRequests<=row.signalRequests);
    assert(row.signalRequests-row.registrySignalRequests<=row.sqlRequests-row.registrySqlRequests);
    assert(row.admissions.length<=1);if(row.selection!=='enabled'){assert.equal(row.gets,0);assert.equal(row.claimAfter,row.claimBefore);assert.equal(row.admissions.length,0);
      assert.equal(row.sqlRequests,row.registrySqlRequests);assert.equal(row.signalRequests,row.registrySignalRequests);}
    for(const admission of row.admissions){keys(admission,['resource','requestId','generation','admittedAt','deadlineAt','outcomeAt','outcome']);
      assert(RUNNER_STAGES.includes(admission.resource as typeof RUNNER_STAGES[number]));assert.match(admission.requestId,uuid);assert.equal(admission.generation,row.claimAfter);
      assert.equal(admission.outcome,'checkpoint-committed');timestamp(admission.admittedAt);timestamp(admission.deadlineAt);timestamp(admission.outcomeAt);
      assert(Date.parse(admission.outcomeAt)>=Date.parse(admission.admittedAt)&&Date.parse(admission.outcomeAt)<=Date.parse(admission.deadlineAt));
      assert.equal(Date.parse(admission.deadlineAt),Date.parse(row.invocationStartedAt)+20_000);
      assert.equal(row.gets,['core','exact-matchups'].includes(admission.resource)?2:1);assert(row.signalRequests>row.registrySignalRequests);
    }
  }
  assert(Array.isArray(value.cycles)&&value.cycles.length<=2);
  for(const [index,cycle] of value.cycles.entries()){keys(cycle,['number','requestId','configurationRevision','historyDigest','dueAt','disposition','recordedAt','nextDueAt','directoryContentId','directoryCaptureId','directoryCapturedAt','exactContentId']);
    assert.equal(cycle.number,index+1);assert.match(cycle.requestId,uuid);assert(Number.isInteger(cycle.configurationRevision)&&cycle.configurationRevision>0);assert.match(cycle.historyDigest,/^[a-f0-9]{64}$/u);
    for(const id of [cycle.directoryContentId,cycle.directoryCaptureId,cycle.exactContentId])assert.match(id,uuid);
    timestamp(cycle.dueAt);assert.equal(cycle.disposition,'complete');timestamp(cycle.recordedAt);timestamp(cycle.nextDueAt);timestamp(cycle.directoryCapturedAt);
    assert(Date.parse(cycle.nextDueAt)>Date.parse(cycle.recordedAt));assert.equal((Date.parse(cycle.nextDueAt)-Date.parse(cycle.dueAt))%60_000,0);}
}
export function assertCompleteRunnerCyclesEvidence(value:RunnerCyclesEvidence,binding:QualificationBinding):void {
  assertRunnerCyclesEvidence(value,binding);assert.equal(value.cleanupComplete,true);assert.equal(value.admissionSpacingVerified,true);
  assert.equal(value.actualRuntimeLogin,true);assert.equal(value.actualHttpRuntimeLogin,true);
  assert.equal(value.prerequisiteGets,2);assert.equal(value.prerequisiteAdmissions,2);assert.equal(value.prerequisiteClaims,2);
  for(const [index,entry] of value.cases.entries()){assert.equal(entry.state,'passed');const wanted=RUNNER_CYCLES_ORACLES[index];
    const matching=entry.events.filter(event=>event.data.oracle===wanted.oracle);assert.equal(matching.length,1);
    for(const [key,expected] of Object.entries(wanted))assert.equal(matching[0].data[key],expected);}
  assert.equal(value.invocations.reduce((sum,row)=>sum+row.gets,0),16);assert.equal(value.invocations.at(-1)?.claimAfter,18);
  assert.equal(value.invocations.filter(row=>row.selection==='enabled'&&row.claimAfter>row.claimBefore).length,16);
  assert(value.invocations.some(row=>row.selection==='omitted'));assert(value.invocations.filter(row=>row.selection==='false').length>=2);
  assert(new Set(value.invocations.map(row=>row.pid)).size>=2);assert.equal(value.cycles.length,2);
  const admissions=value.invocations.flatMap(row=>row.admissions);assert.equal(admissions.length,12);
  for(const cycle of value.cycles){const scoped=admissions.filter(row=>row.requestId===cycle.requestId);assert.deepEqual(scoped.map(row=>row.resource),RUNNER_STAGES);
    assert(Date.parse(cycle.dueAt)<=Date.parse(scoped[0].admittedAt));assert(Date.parse(cycle.recordedAt)>Date.parse(scoped.at(-1)!.outcomeAt));
    assert.equal(Date.parse(cycle.nextDueAt),Date.parse(cycle.dueAt)+(Math.floor((Date.parse(cycle.recordedAt)-Date.parse(cycle.dueAt))/60_000)+1)*60_000);}
  for(let i=1;i<admissions.length;i++)assert(Date.parse(admissions[i].admittedAt)-Date.parse(admissions[i-1].admittedAt)>=60_000);
  const [first,second]=value.cycles;assert.notEqual(first.requestId,second.requestId);assert.notEqual(first.exactContentId,second.exactContentId);
  assert.equal(first.directoryContentId,second.directoryContentId);assert.notEqual(first.directoryCaptureId,second.directoryCaptureId);
  assert(Date.parse(second.directoryCapturedAt)>Date.parse(first.directoryCapturedAt));
  // A delayed next invocation may skip old cadence slots, per the existing
  // selector; it cannot move the due time backward or into the future.
  assert(Date.parse(second.dueAt)>=Date.parse(first.nextDueAt));assert.equal((Date.parse(second.dueAt)-Date.parse(first.nextDueAt))%60_000,0);
  const witness=(index:number,kind:string)=>value.cases[index].events.filter(entry=>entry.data.witness===kind).map(entry=>entry.data);
  const one=(index:number,kind:string)=>{const rows=witness(index,kind);assert.equal(rows.length,1);return rows[0];};
  const hash=(item:unknown)=>{assert.equal(typeof item,'string');assert.match(item as string,/^[a-f0-9]{64}$/u);};
  const equalHashes=(row:RunnerEvent['data'],before:string,after:string)=>{hash(row[before]);hash(row[after]);assert.equal(row[before],row[after]);};
  const invocation=(row:RunnerEvent['data'])=>{const matches=value.invocations.filter(item=>item.pid===row.pid&&item.invocation===row.invocation);assert.equal(matches.length,1);return matches[0];};
  const disabled=witness(0,'disabled');assert.deepEqual(disabled.map(row=>row.selection),['omitted','false']);
  for(const row of [...disabled,one(2,'disabled')]){equalHashes(row,'beforeDigest','afterDigest');const call=invocation(row);assert.equal(call.selection,row.selection);assert.equal(call.gets,0);assert.equal(call.claimBefore,call.claimAfter);}
  const restart=one(1,'restart');assert.equal(restart.requestId,first.requestId);assert.equal(restart.cycle,1);
  equalHashes(restart,'checkpointBeforeDigest','checkpointAfterDigest');
  for(const key of ['oldPid','newPid','oldBackendPid','newBackendPid'])assert(Number.isInteger(restart[key])&&Number(restart[key])>1);
  assert.notEqual(restart.oldPid,restart.newPid);assert(restart.oldBackendPid!==restart.newBackendPid||restart.oldBackendStart!==restart.newBackendStart);
  for(const key of ['oldBackendStart','newBackendStart']){assert.equal(typeof restart[key],'string');assert(Number.isFinite(Date.parse(restart[key] as string)));}
  for(const key of ['deathRequestedAt','closedAt','restartedAt'])timestamp(restart[key]);
  const firstIdentity=value.invocations.find(row=>row.admissions.some(item=>item.requestId===first.requestId&&item.resource==='identity'))!;
  const firstRemainder=value.invocations.filter(row=>row.admissions.some(item=>item.requestId===first.requestId&&item.resource!=='identity'));
  assert.equal(firstIdentity.pid,restart.oldPid);assert(firstRemainder.every(row=>row.pid===restart.newPid));
  assert(Date.parse(firstIdentity.endedAt)<=Date.parse(restart.deathRequestedAt as string));
  assert(Date.parse(restart.deathRequestedAt as string)<=Date.parse(restart.closedAt as string));
  assert(Date.parse(restart.closedAt as string)<=Date.parse(restart.restartedAt as string));
  assert(firstRemainder.every(row=>Date.parse(row.startedAt)>=Date.parse(restart.restartedAt as string)));
  const pending=witness(1,'pending');assert.deepEqual(pending.map(row=>row.kind),['pause','expiry']);
  for(const row of pending){assert.equal(row.requestId,first.requestId);assert.equal(row.cycle,1);assert(Number.isInteger(row.revision)&&Number(row.revision)>first.configurationRevision);
    timestamp(row.configuredAt);timestamp(row.expiresAt);timestamp(row.checkedAt);equalHashes(row,'checkpointBeforeDigest','checkpointAfterDigest');assert.equal(row.checkpointBeforeDigest,restart.checkpointBeforeDigest);
    const call=invocation(row);assert.equal(call.selection,'enabled');assert.equal(call.claimAfter,call.claimBefore+1);assert.equal(call.gets,0);assert.equal(call.admissions.length,0);
    assert(Date.parse(row.configuredAt as string)<=Date.parse(row.checkedAt as string));
    if(row.kind==='expiry')assert(Date.parse(row.expiresAt as string)<=Date.parse(row.checkedAt as string));}
  assert(Number(pending[1].revision)>Number(pending[0].revision));
  const admitted=one(2,'admitted-control');assert.equal(admitted.requestId,second.requestId);assert(Number.isInteger(admitted.configurationRevision)&&Number(admitted.configurationRevision)>second.configurationRevision);
  const secondIdentity=admissions.find(row=>row.requestId===second.requestId&&row.resource==='identity')!;
  for(const key of ['admittedAt','pausedAt','expiredAt','originalDeadline','outcomeAt'])timestamp(admitted[key]);
  assert.equal(admitted.admittedAt,secondIdentity.admittedAt);assert.equal(admitted.outcomeAt,secondIdentity.outcomeAt);assert.equal(admitted.originalDeadline,secondIdentity.deadlineAt);
  assert(Date.parse(admitted.admittedAt as string)<=Date.parse(admitted.pausedAt as string));assert(Date.parse(admitted.pausedAt as string)<Date.parse(admitted.expiredAt as string));
  assert(Date.parse(admitted.expiredAt as string)<=Date.parse(admitted.outcomeAt as string));assert(Date.parse(admitted.outcomeAt as string)<=Date.parse(admitted.originalDeadline as string));
  const laterDisabled=invocation(one(2,'disabled'));assert.equal(laterDisabled.selection,'false');
  const identityCall=value.invocations.find(row=>row.admissions.includes(secondIdentity))!;assert(Date.parse(laterDisabled.startedAt)>=Date.parse(identityCall.endedAt));
  for(const cycle of value.cycles){const terminal=value.invocations.filter(row=>row.admissions.some(item=>item.requestId===cycle.requestId&&item.resource==='users'))[0];
    const settlement=one(cycle.number,'settlement'),call=invocation(settlement);assert.equal(settlement.cycle,cycle.number);assert.equal(settlement.requestId,cycle.requestId);
    assert.equal(settlement.beforeOutcomeCount,0);assert.equal(settlement.afterOutcomeCount,1);assert.equal(settlement.generation,call.claimAfter);
    assert.equal(call.claimAfter,call.claimBefore+1);assert.equal(call.gets,0);assert.equal(call.admissions.length,0);
    assert.equal(settlement.outcomeDigest,qualificationDigest({disposition:'complete',recordedAt:cycle.recordedAt,nextDueAt:cycle.nextDueAt}));
    assert(Date.parse(call.startedAt)>Date.parse(terminal.endedAt));}
  const history=one(3,'history');assert.equal(history.firstRequest,first.requestId);assert.equal(history.secondRequest,second.requestId);
  equalHashes(history,'priorHistoryBeforeDigest','priorHistoryAfterDigest');assert.equal(history.priorHistoryBeforeDigest,first.historyDigest);
  equalHashes(history,'nonDataBeforeDigest','nonDataAfterDigest');equalHashes(history,'storedBeforeDigest','storedAfterDigest');equalHashes(history,'exactBeforeDigest','exactAfterDigest');
}
export async function writeRunnerCyclesEvidence(binding:QualificationBinding,value:RunnerCyclesEvidence):Promise<string> {
  assertRunnerCyclesEvidence(value,binding);const bytes=JSON.stringify(value,null,2)+'\n';const path=join(binding.directory,RUNNER_CYCLES_EVIDENCE_FILE);
  await writeFile(path,bytes,{flag:'wx',mode:0o600});const stat=await lstat(path);assert(stat.isFile()&&!stat.isSymbolicLink()&&stat.size<=maxBytes);
  const reread=await readFile(path,'utf8');assert.equal(reread,bytes);const parsed=JSON.parse(reread) as RunnerCyclesEvidence;
  assertRunnerCyclesEvidence(parsed,binding);assert.deepEqual(parsed,value);return qualificationDigest(parsed);
}
