import assert from 'node:assert/strict';
import { lstat, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { BACKEND_CONTROLS_TESTS, qualificationDigest, type QualificationBinding } from './qualification-profile';

export const BACKEND_CONTROLS_EVIDENCE_FILE = 'backend-controls-evidence.json';
export const BACKEND_CONTROLS_LIMITS = [90_000,90_000,120_000,180_000,240_000,90_000,180_000,90_000,120_000] as const;
export const BACKEND_CONTROLS_EVENT_TYPES = ['submission','configuration','lock','capture','status','capacity','permissions','mutation-denied','prerequisite','latency'] as const;
export const BACKEND_CONTROLS_ORACLES = [
  { type:'submission', oracle:'submission-validation', invalidInputsRejected:true, canonicalReplay:true, replayConflict:true, unchangedOnReject:true },
  { type:'configuration', oracle:'configuration-validation', identityBound:true, explicitSelectors:true, scopeFrozen:true, exactReplay:true, staleCasRejected:true },
  { type:'lock', oracle:'cas-race', waiterCount:2, winnerCount:1, revisionAppend:1, historyUnchanged:true },
  { type:'lock', oracle:'pause-expiry', pausedIdle:true, pauseWon:true, expiryWon:true, staleTokenRejected:true, sameCycle:true, originalFence:true },
  { type:'capture', oracle:'capture-after-pause', providerGets:2, identityCheckpoint:true, exactWitness:true, noSecondAdmission:true, failureRetained:true, retryFuture:true, sourceRecordRetained:true },
  { type:'capacity', oracle:'target-capacity', targetCount:16, pausedCount:16, rejectedSeventeenth:true, unchangedOnReject:true },
  { type:'capacity', oracle:'submit-capacity', pendingBefore:15, pendingAfter:16, retained:1, capacity:1, stickyAfterRelease:true, newIdRetained:true, legacyThrow:true, mismatchRejected:true, explicitSelectors:true, selectorMismatch:true, noDispatch:true, noWork:true },
  { type:'status', oracle:'stored-status', missing:true, pending:true, available:true, unavailable:true, capacity:true, progress:true, failureBackoff:true, noProvider:true, noWrites:true },
  { type:'permissions', oracle:'permissions', runtimeAllowed:true, authDenied:true, accountDenied:true, publicDenied:true, noEscalation:true, immutableCapacity:true, immutableConfiguration:true },
] as const;
type Scalar = string | number | boolean | null;
export type ControlEvent = { type: typeof BACKEND_CONTROLS_EVENT_TYPES[number]; at: string; data: Record<string, Scalar | readonly Scalar[]> };
export type ControlCase = { name: string; limitMs: number; state: 'unserved' | 'running' | 'passed' | 'failed'; startedAt: string | null; endedAt: string | null; events: ControlEvent[] };
export type ControlsEvidence = { kind: 'data-backend-controls-evidence-v1'; contextDigest: string; gitSha: string;
  serverVersion: string; serverVersionNum: string; actualLogins: readonly string[]; accountLoginExecuted: false;
  prerequisiteGets: number; measuredGets: number; cleanupComplete: boolean; cases: ControlCase[] };
const maxBytes = 1024 * 1024;
const timestamp = (value: unknown) => typeof value === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/u.test(value) && Number.isFinite(Date.parse(value));
function keys(value: object, wanted: string[]) { assert.deepEqual(Object.keys(value).sort(), wanted.sort()); }
function scalar(value: unknown): void {
  assert(value === null || typeof value === 'boolean' || typeof value === 'number' && Number.isFinite(value)
    || typeof value === 'string' && value.length <= 300 && !/(?:postgres(?:ql)?:|https?:\/\/|password|sentinel|secret|credential|DATABASE_URL)/iu.test(value), 'Unsafe control evidence value.');
}
export function assertBackendControlsEvidence(value: ControlsEvidence, binding: QualificationBinding): void {
  assert(Buffer.byteLength(JSON.stringify(value))<=maxBytes,'Control companion exceeds its evidence budget.');
  keys(value, ['kind','contextDigest','gitSha','serverVersion','serverVersionNum','actualLogins','accountLoginExecuted','prerequisiteGets','measuredGets','cleanupComplete','cases']);
  assert.equal(value.kind,'data-backend-controls-evidence-v1'); assert.equal(value.contextDigest,qualificationDigest(binding.context));
  assert.equal(value.gitSha,binding.context.gitSha); assert.equal(binding.context.profile,'data-backend-controls-v1');
  assert(typeof value.serverVersion==='string' && value.serverVersion.length>0&&value.serverVersion.length<=100); scalar(value.serverVersion);
  assert.match(value.serverVersionNum,/^[0-9]{5,6}$/u); assert.equal(value.accountLoginExecuted,false);
  const versionNumber=Number(value.serverVersionNum),major=Math.floor(versionNumber/10000),minor=versionNumber%10000;
  assert(major>=10);assert(new RegExp('^'+major+'\\.'+minor+'(?:\\s|$)','u').test(value.serverVersion),'Control server version evidence disagrees.');
  assert(Array.isArray(value.actualLogins) && value.actualLogins.every(role=>['league_one_runtime','league_one_auth'].includes(role)));
  assert.equal(new Set(value.actualLogins).size,value.actualLogins.length);
  for(const count of [value.prerequisiteGets,value.measuredGets]) assert(Number.isInteger(count)&&count>=0&&count<=20);
  assert.equal(typeof value.cleanupComplete,'boolean'); assert.equal(value.cases.length,BACKEND_CONTROLS_TESTS.length);
  for(const [index,entry] of value.cases.entries()) {
    keys(entry,['name','limitMs','state','startedAt','endedAt','events']); assert.equal(entry.name,BACKEND_CONTROLS_TESTS[index]);
    assert.equal(entry.limitMs,BACKEND_CONTROLS_LIMITS[index]); assert(['unserved','running','passed','failed'].includes(entry.state));
    assert(entry.startedAt===null||timestamp(entry.startedAt)); assert(entry.endedAt===null||timestamp(entry.endedAt));
    if(entry.state==='passed') { assert(timestamp(entry.startedAt)&&timestamp(entry.endedAt)); assert(entry.events.length>0); }
    if(entry.startedAt&&entry.endedAt) { const duration=Date.parse(entry.endedAt)-Date.parse(entry.startedAt); assert(duration>=0&&duration<=entry.limitMs); }
    const previous=value.cases[index-1]; if(previous?.endedAt&&entry.startedAt) assert(Date.parse(entry.startedAt)>=Date.parse(previous.endedAt));
    assert(Array.isArray(entry.events)&&entry.events.length<=200);
    for(const event of entry.events) {
      keys(event,['type','at','data']); assert(BACKEND_CONTROLS_EVENT_TYPES.includes(event.type)); assert(timestamp(event.at));
      if(entry.startedAt) assert(Date.parse(event.at)>=Date.parse(entry.startedAt));
      if(entry.endedAt) assert(Date.parse(event.at)<=Date.parse(entry.endedAt));
      assert(event.data&&typeof event.data==='object'&&!Array.isArray(event.data)); assert(Object.keys(event.data).length<=32);
      for(const [key,item] of Object.entries(event.data)) {
        assert(/^[A-Za-z][A-Za-z0-9]{0,63}$/u.test(key)); assert(!/(?:password|sentinel|secret|credential|url)/iu.test(key));
        if(Array.isArray(item)){assert(item.length<=64);for(const element of item)scalar(element);}else scalar(item);
      }
    }
  }
}
export function assertCompleteBackendControlsEvidence(value: ControlsEvidence, binding: QualificationBinding): void {
  assertBackendControlsEvidence(value,binding); assert.equal(value.cleanupComplete,true);
  assert.deepEqual([...value.actualLogins].sort(),['league_one_auth','league_one_runtime']);
  assert.equal(value.prerequisiteGets,2); assert.equal(value.measuredGets,2);
  for(const [index,entry] of value.cases.entries()) {
    assert.equal(entry.state,'passed'); const {type,...required}=BACKEND_CONTROLS_ORACLES[index];
    const matches=entry.events.filter(event=>event.type===type&&event.data.oracle===required.oracle);
    assert.equal(matches.length,1,'One complete case oracle is required.');
    for(const [key,wanted] of Object.entries(required)) assert.equal(matches[0].data[key],wanted,'Incomplete control case oracle.');
  }
}
/** Bound, exclusive write followed by independent byte readback. Failed cases remain retained. */
export async function writeBackendControlsEvidence(binding: QualificationBinding, value: ControlsEvidence): Promise<string> {
  assertBackendControlsEvidence(value,binding); const serialized=JSON.stringify(value,null,2)+'\n';
  assert(Buffer.byteLength(serialized)<=maxBytes); const path=join(binding.directory,BACKEND_CONTROLS_EVIDENCE_FILE);
  await writeFile(path,serialized,{flag:'wx',mode:0o600}); const stat=await lstat(path);
  assert(stat.isFile()&&!stat.isSymbolicLink()&&stat.size>0&&stat.size<=maxBytes);
  const reread=await readFile(path,'utf8'); assert.equal(reread,serialized);
  const parsed=JSON.parse(reread) as ControlsEvidence; assertBackendControlsEvidence(parsed,binding);
  assert.deepEqual(parsed,value); return qualificationDigest(parsed);
}
