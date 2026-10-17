import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { deflateRawSync, inflateRawSync } from 'node:zlib';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { lstat, readFile, readdir, writeFile, realpath } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { bindCapacityManifest, capacityDigest, type ReaderExpectation } from './freshness-capacity-manifest';

export const FLEET_RECOVERY_PROFILE = 'data-freshness-capacity-recovery-v1';
export const FLEET_RECOVERY_MODULE = 'integration/freshness-capacity-recovery.qualification-case.ts';
export const FLEET_RECOVERY_SUITE = 'provider outage and complete queued DATA recovery through the production facade';
export const FLEET_RECOVERY_TESTS = [
  'accepts all 16 leagues before the fixed provider outage with complete owner lookback',
  'preserves all 64 last-good readers during the declared 30 minute outage and queued full replay workload',
  'verifies fresh recovery complete backlog immutable history and actual cleanup under original deadlines',
] as const;
export const FLEET_RECOVERY_FULL_NAMES = FLEET_RECOVERY_TESTS.map(name=>FLEET_RECOVERY_SUITE+' > '+name);
export const FLEET_HEALTHY_PROFILE = 'data-freshness-capacity-healthy-v1';
export const FLEET_HEALTHY_MODULE = 'integration/freshness-capacity-healthy.qualification-case.ts';
export const FLEET_HEALTHY_SUITE = 'full healthy DATA fleet through the production facade';
export const FLEET_HEALTHY_TESTS = [
  'keeps omitted and false DATA selections isolated before the fixed fleet benchmark',
  'runs the complete fixed healthy fleet window alongside positive primary work',
  'reconciles every source event sample receipt reader and shared HTTP attempt with verified cleanup',
] as const;
export const FLEET_HEALTHY_FULL_NAMES = FLEET_HEALTHY_TESTS.map(name => FLEET_HEALTHY_SUITE + ' > ' + name);
export const FLEET_HEALTHY_CLOCK = Object.freeze({ benchmarkOffsetMs: 60 * 60_000, freshSubmissionOffsetMs: 61 * 60_000,
  latestFreshAnchorOffsetMs: 113 * 60_000, pairHorizonMs: 122 * 60_000, evidenceReserveMs: 5 * 60_000,
  workMs: 240 * 60_000, lifecycleMs: 250 * 60_000, expiryMs: 270 * 60_000, ciMinutes: 270 });
export const FLEET_EVIDENCE_LIMITS = Object.freeze({ chunkBytes: 4 * 1024 * 1024, maxChunks: 256, totalBytes: 512 * 1024 * 1024, maxRows: 2_000_000 });
export const FLEET_EVIDENCE_STREAMS = ['transport-attempts', 'transport-responses', 'observer-lineage', 'observer-reads', 'observer-operations',
  'capacity-evidence', 'named-regressions', 'primary-coexistence', 'cleanup'] as const;
export const FLEET_RAW_EVIDENCE_STREAMS = FLEET_EVIDENCE_STREAMS.filter(stream=>stream!=='cleanup');
export type FleetEvidenceStream = typeof FLEET_EVIDENCE_STREAMS[number];
export type FleetEvidenceRow = { stream: FleetEvidenceStream; sequence: number; value: unknown };
export type FleetEvidenceChunk = { file: string; index: number; bytes: number; sha256: string; rows: number };
export type FleetEvidenceInventory = { kind: 'cp26-complete-evidence-chunks-v1'; manifestDigest: string; chunks: FleetEvidenceChunk[];
  totalBytes: number; totalRows: number; coverage: { stream: FleetEvidenceStream; rows: number }[] };
function assertJsonValue(value: unknown, seen = new Set<object>()): void {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return;
  if (typeof value === 'number') { assert(Number.isFinite(value), 'nonfinite evidence value'); return; }
  assert(value && typeof value === 'object' && !seen.has(value), 'non-JSON or cyclic evidence value');
  assert(Array.isArray(value) || Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null, 'nonplain evidence value');
  seen.add(value);
  if (Array.isArray(value)) { for (let i=0;i<value.length;i++) { assert(Object.hasOwn(value,i), 'sparse evidence array'); assertJsonValue(value[i],seen); } }
  else for (const nested of Object.values(value)) assertJsonValue(nested,seen);
  seen.delete(value);
}
const hash = (bytes: string | Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const keys = (value: object, expected: string[]) => assert.deepEqual(Object.keys(value).sort(), expected.sort());
const object = (value: unknown): Record<string, unknown> => { assert(value && typeof value === 'object' && !Array.isArray(value)); return value as Record<string, unknown>; };
const safeInteger = (value: number) => assert(Number.isSafeInteger(value) && value >= 0);
/** Fixed origins; late setup/acceptance is incomplete coverage, not a rewritten import SLA. */
export function fleetHealthyWindow(invocationStartedAt: number, freshAnchors: readonly number[]) {
  safeInteger(invocationStartedAt); freshAnchors.forEach(safeInteger);
  const benchmarkStartedAt = invocationStartedAt + FLEET_HEALTHY_CLOCK.benchmarkOffsetMs;
  const latestFreshAnchorAt = invocationStartedAt + FLEET_HEALTHY_CLOCK.latestFreshAnchorOffsetMs;
  return { invocationStartedAt, benchmarkStartedAt, freshSubmissionAt: invocationStartedAt + FLEET_HEALTHY_CLOCK.freshSubmissionOffsetMs,
    latestFreshAnchorAt, workDeadlineAt: invocationStartedAt + FLEET_HEALTHY_CLOCK.workMs,
    qualifyingAnchors: freshAnchors.every(anchor => anchor >= invocationStartedAt + FLEET_HEALTHY_CLOCK.freshSubmissionOffsetMs && anchor <= latestFreshAnchorAt),
    observationEndsAt: freshAnchors.map(anchor => anchor + FLEET_HEALTHY_CLOCK.pairHorizonMs) };
}
/** No missing facade owner/format coverage can be replaced by an authored label. */
export function assertFleetHealthyReady(value: { fullPositiveFacade: boolean; maintenanceCoexistence: boolean; allOwnerTransport: boolean;
  namedStoredRegressions: boolean; currentSourcePins: boolean; liveLoginGuard: boolean }) {
  keys(value, ['fullPositiveFacade','maintenanceCoexistence','allOwnerTransport','namedStoredRegressions','currentSourcePins','liveLoginGuard']);
  for (const [name, ready] of Object.entries(value)) assert.equal(ready, true, 'incomplete healthy profile prerequisite: ' + name);
}
export function assertFleetEvidenceInventory(value: unknown): asserts value is FleetEvidenceInventory {
  const row = object(value) as unknown as FleetEvidenceInventory;
  keys(row, ['kind','manifestDigest','chunks','totalBytes','totalRows','coverage']);
  assert.equal(row.kind, 'cp26-complete-evidence-chunks-v1'); assert.match(row.manifestDigest, /^[a-f0-9]{64}$/u);
  assert(Array.isArray(row.chunks) && row.chunks.length > 0 && row.chunks.length <= FLEET_EVIDENCE_LIMITS.maxChunks);
  safeInteger(row.totalBytes); safeInteger(row.totalRows); assert(row.totalBytes <= FLEET_EVIDENCE_LIMITS.totalBytes && row.totalRows <= FLEET_EVIDENCE_LIMITS.maxRows);
  row.chunks.forEach((chunk,index) => { keys(chunk,['file','index','bytes','sha256','rows']); assert.equal(chunk.index,index);
    assert.equal(chunk.file, 'fleet-evidence-' + String(index).padStart(4,'0') + '.json'); safeInteger(chunk.bytes); safeInteger(chunk.rows);
    assert(chunk.bytes > 0 && chunk.bytes <= FLEET_EVIDENCE_LIMITS.chunkBytes && chunk.rows > 0); assert.match(chunk.sha256,/^[a-f0-9]{64}$/u); });
  assert.equal(row.chunks.reduce((sum,item)=>sum+item.bytes,0),row.totalBytes); assert.equal(row.chunks.reduce((sum,item)=>sum+item.rows,0),row.totalRows);
  assert.deepEqual(row.coverage.map(item=>item.stream), [...FLEET_EVIDENCE_STREAMS]);
  for (const coverage of row.coverage) { keys(coverage,['stream','rows']); safeInteger(coverage.rows); }
  assert.equal(row.coverage.reduce((sum,item)=>sum+item.rows,0),row.totalRows);
}
/** Immutable bounded chunks; every row and stream count is declared. There is no truncation mode. */
export async function writeFleetEvidenceChunks(directory: string, manifestDigest: string, rows: readonly FleetEvidenceRow[]): Promise<FleetEvidenceInventory> {
  assert.match(manifestDigest,/^[a-f0-9]{64}$/u); assert(rows.length > 0 && rows.length <= FLEET_EVIDENCE_LIMITS.maxRows);
  const coverage = FLEET_EVIDENCE_STREAMS.map(stream=>({stream,rows:0})), chunks: FleetEvidenceChunk[] = [];
  let current: string[] = [], size = 2, totalBytes = 0;
  const flush = async () => { if (!current.length) return; assert(chunks.length < FLEET_EVIDENCE_LIMITS.maxChunks);
    const bytes = '[' + current.join(',') + ']', index=chunks.length, file='fleet-evidence-'+String(index).padStart(4,'0')+'.json';
    totalBytes += Buffer.byteLength(bytes); assert(totalBytes <= FLEET_EVIDENCE_LIMITS.totalBytes);
    await writeFile(join(directory,file),bytes,{flag:'wx',mode:0o600});
    chunks.push({file,index,bytes:Buffer.byteLength(bytes),sha256:hash(bytes),rows:current.length}); current=[];size=2; };
  for (const row of rows) { keys(row,['stream','sequence','value']); const counter=coverage.find(item=>item.stream===row.stream); assert(counter,'unknown evidence stream');
    assert.equal(row.sequence,counter.rows+1,'missing or repeated stream row'); counter.rows++;
    assertJsonValue(row.value); const bytes=JSON.stringify(row); assert(typeof bytes==='string'); const length=Buffer.byteLength(bytes); assert(length+2<=FLEET_EVIDENCE_LIMITS.chunkBytes,'oversized evidence row');
    if(size+length+(current.length?1:0)>FLEET_EVIDENCE_LIMITS.chunkBytes)await flush();
    size+=length+(current.length?1:0);current.push(bytes); }
  await flush(); const inventory: FleetEvidenceInventory={kind:'cp26-complete-evidence-chunks-v1',manifestDigest,chunks,totalBytes,totalRows:rows.length,coverage};
  assertFleetEvidenceInventory(inventory); return inventory;
}
/** Verify all bytes before yielding any evidence; extra/missing files and sequence gaps fail closed. */
export async function readFleetEvidenceChunks(directory:string, inventory:FleetEvidenceInventory):Promise<FleetEvidenceRow[]> {
  assertFleetEvidenceInventory(inventory);
  const files=(await readdir(directory)).filter(file=>file.startsWith('fleet-evidence-')).sort();
  assert.deepEqual(files,inventory.chunks.map(chunk=>chunk.file));
  const result:FleetEvidenceRow[]=[], coverage=new Map<FleetEvidenceStream,number>(FLEET_EVIDENCE_STREAMS.map(stream=>[stream,0]));
  for(const chunk of inventory.chunks){const path=join(directory,chunk.file),stat=await lstat(path);assert(stat.isFile()&&!stat.isSymbolicLink());assert.equal(stat.size,chunk.bytes);
    const bytes=await readFile(path);assert.equal(bytes.length,chunk.bytes);assert.equal(hash(bytes),chunk.sha256);
    const rows:unknown=JSON.parse(bytes.toString('utf8'));assert(Array.isArray(rows));assert.equal(rows.length,chunk.rows);
    for(const value of rows){const row=object(value) as unknown as FleetEvidenceRow;keys(row,['stream','sequence','value']);assert(coverage.has(row.stream));
      const count=coverage.get(row.stream)!+1;assert.equal(row.sequence,count,'missing or repeated stream row');coverage.set(row.stream,count);result.push(row);}
  }
  assert.equal(result.length,inventory.totalRows);
  assert.deepEqual([...coverage].map(([stream,rows])=>({stream,rows})),inventory.coverage);return result;
}

export const FLEET_DOCUMENT_LIMITS=Object.freeze({partBytes:1024*1024,compressedPartBytes:1024*1024+1024,totalDecodedBytes:512*1024*1024});
export type FleetDocumentPart = { kind:'cp26-json-document-part-deflate-v1'; documentSha256:string; documentBytes:number; parts:number; index:number; partBytes:number;partSha256:string;bytesBase64:string };
/** New-fleet-only lossless parts. Raw part/document and outer chunk limits remain unchanged. */
export function fleetDocumentRows(stream:FleetEvidenceStream,value:unknown):FleetEvidenceRow[] {
  assert(FLEET_EVIDENCE_STREAMS.includes(stream)); assertJsonValue(value);
  const bytes=Buffer.from(JSON.stringify(value),'utf8'); assert(bytes.length>0&&bytes.length<=FLEET_EVIDENCE_LIMITS.totalBytes);
  const partBytes=FLEET_DOCUMENT_LIMITS.partBytes, parts=Math.ceil(bytes.length/partBytes), documentSha256=hash(bytes);
  return Array.from({length:parts},(_,index)=>{const raw=bytes.subarray(index*partBytes,Math.min((index+1)*partBytes,bytes.length)),compressed=deflateRawSync(raw);assert(compressed.length<=FLEET_DOCUMENT_LIMITS.compressedPartBytes);
    return{stream,sequence:index+1,value:{kind:'cp26-json-document-part-deflate-v1',documentSha256,documentBytes:bytes.length,parts,index,partBytes:raw.length,partSha256:hash(raw),bytesBase64:compressed.toString('base64')} satisfies FleetDocumentPart};});
}
/** All declared streams are required; hashes never substitute for semantic qualification. */
function reassembleDocuments(rows:readonly FleetEvidenceRow[],streams:readonly FleetEvidenceStream[]):Record<FleetEvidenceStream,unknown> {
  const result={} as Record<FleetEvidenceStream,unknown>;
  assert(rows.length>0&&rows.length<=FLEET_EVIDENCE_LIMITS.maxRows);for(const row of rows)assert(streams.includes(row.stream),'unknown document stream');
  const documents=new Map<FleetEvidenceStream,FleetDocumentPart[]>();let decodedTotal=0;
  // Check every declared size and complete part inventory before allocating decoded documents.
  for(const stream of streams){const selected=rows.filter(row=>row.stream===stream);assert(selected.length>0,'missing semantic document stream: '+stream);let digest:string|null=null,total:number|null=null;const parts:FleetDocumentPart[]=[];
    selected.forEach((row,index)=>{keys(row,['stream','sequence','value']);assert.equal(row.sequence,index+1);const part=object(row.value) as unknown as FleetDocumentPart;keys(part,['kind','documentSha256','documentBytes','parts','index','partBytes','partSha256','bytesBase64']);
      assert.equal(part.kind,'cp26-json-document-part-deflate-v1');assert.equal(part.index,index);assert.equal(part.parts,selected.length);assert.match(part.documentSha256,/^[a-f0-9]{64}$/u);assert.match(part.partSha256,/^[a-f0-9]{64}$/u);
      safeInteger(part.documentBytes);safeInteger(part.partBytes);assert(part.documentBytes>0&&part.documentBytes<=FLEET_EVIDENCE_LIMITS.totalBytes);assert.equal(part.parts,Math.ceil(part.documentBytes/FLEET_DOCUMENT_LIMITS.partBytes));assert.equal(part.partBytes,Math.min(FLEET_DOCUMENT_LIMITS.partBytes,part.documentBytes-index*FLEET_DOCUMENT_LIMITS.partBytes));
      assert(typeof part.bytesBase64==='string'&&part.bytesBase64.length>0&&part.bytesBase64.length<=4*Math.ceil(FLEET_DOCUMENT_LIMITS.compressedPartBytes/3));assert.match(part.bytesBase64,/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u);
      if(index===0){digest=part.documentSha256;total=part.documentBytes;}else{assert.equal(part.documentSha256,digest);assert.equal(part.documentBytes,total);}parts.push(part);
    });decodedTotal+=total!;assert(decodedTotal<=FLEET_DOCUMENT_LIMITS.totalDecodedBytes,'aggregate decoded document size exceeded');documents.set(stream,parts);
  }
  for(const[stream,parts]of documents){const buffers:Buffer[]=[];for(const part of parts){const compressed=Buffer.from(part.bytesBase64,'base64');assert.equal(compressed.toString('base64'),part.bytesBase64,'noncanonical document bytes');assert(compressed.length>0&&compressed.length<=FLEET_DOCUMENT_LIMITS.compressedPartBytes);
      const decoded=inflateRawSync(compressed,{maxOutputLength:part.partBytes,info:true}) as unknown as {buffer:Buffer;engine:{bytesWritten:number}};assert.equal(decoded.engine.bytesWritten,compressed.length,'trailing compressed document bytes');assert.equal(decoded.buffer.length,part.partBytes);assert.equal(hash(decoded.buffer),part.partSha256);buffers.push(decoded.buffer);}
    const bytes=Buffer.concat(buffers);assert.equal(bytes.length,parts[0].documentBytes);assert.equal(hash(bytes),parts[0].documentSha256);
    const text=new TextDecoder('utf-8',{fatal:true}).decode(bytes),value:unknown=JSON.parse(text);assertJsonValue(value);assert.equal(JSON.stringify(value),text,'noncanonical semantic document');result[stream]=value;
  }
  return result;
}
export function reassembleFleetDocuments(rows:readonly FleetEvidenceRow[]):Record<FleetEvidenceStream,unknown> { return reassembleDocuments(rows,FLEET_EVIDENCE_STREAMS); }
/** Raw worker evidence cannot assert the later parent-observed process cleanup. */
export async function readFleetRawEvidenceDocuments(directory:string,inventory:FleetEvidenceInventory){
  assert.equal(inventory.coverage.find(row=>row.stream==='cleanup')?.rows,0,'worker cannot attest parent cleanup');
  return reassembleDocuments(await readFleetEvidenceChunks(directory,inventory),FLEET_RAW_EVIDENCE_STREAMS) as Record<Exclude<FleetEvidenceStream,'cleanup'>,unknown>;
}
export async function readFleetEvidenceDocuments(directory:string,inventory:FleetEvidenceInventory){
  return reassembleFleetDocuments(await readFleetEvidenceChunks(directory,inventory));
}

export const FLEET_REQUEST_OWNERS = ['data-refresh','primary-projection','administration-maintenance','independent-measurement'] as const;
export const FLEET_QUERY_SOURCE_PATHS = ['integration/freshness-capacity-observer.ts','lib/league-administration/public-intake-reader.ts',
  'lib/league-administration/neon/current-roster.ts','lib/league-administration/neon/roster-player-links.ts','lib/league-administration/neon/exact-matchup-values.ts','lib/league-administration/neon/transactions.ts',
  'lib/league-administration/neon/official-standings.ts','lib/league-administration/neon/brackets.ts',
  'lib/league-administration/neon/exact-period-context.ts','lib/aggregator/official-results.ts'] as const;
/** Shared parent/worker construction. Clean Git binds the complete source tree; no worker import or SQL occurs here. */
export async function buildFleetHealthyManifest(input:{fixtureId:string;gitSha:string;plannedPostgresqlVersion:string}) {
  keys(input,['fixtureId','gitSha','plannedPostgresqlVersion']);
  assert.match(input.fixtureId,/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/u);assert.match(input.gitSha,/^[a-f0-9]{40}$/u);
  assert.match(input.plannedPostgresqlVersion,/^[1-9][0-9]*\.[0-9]+$/u);
  const siteRoot=fileURLToPath(new URL('../',import.meta.url)),repository=fileURLToPath(new URL('../../../',import.meta.url));
  const git=(args:string[])=>execFileSync('git',args,{cwd:repository,encoding:'utf8',windowsHide:true,timeout:2_000}).trim();
  assert.equal(git(['rev-parse','HEAD']),input.gitSha,'fleet source HEAD mismatch');
  assert.equal(git(['status','--porcelain']),'','fleet source must be clean before manifest binding');
  const appTreeSha=git(['rev-parse','HEAD:apps/site']);assert.match(appTreeSha,/^[a-f0-9]{40}$/u);
  const contractPaths=['docs/aggregator-backend/data-backend-readiness-contract.md','docs/aggregator-backend/data-backend-acceptance-baseline.md'] as const;
  const contracts=await Promise.all(contractPaths.map(async path=>({path,sha256:hash(await readFile(join(repository,path)))})));
  const querySources=await Promise.all(FLEET_QUERY_SOURCE_PATHS.map(async path=>({path,sha256:hash(await readFile(join(siteRoot,path)))})));
  const {createCapacityFleetFixture,loadCapacityNamedSourceFixture,CAPACITY_NAMED_SOURCE_SHA256}=await import('./freshness-capacity-fixtures');
  loadCapacityNamedSourceFixture();
  const fixture=createCapacityFleetFixture('cp26-healthy-'+input.fixtureId);
  const manifest=bindCapacityManifest(fixture.prototype.plan,{
    readinessContractSha256:contracts[0].sha256,acceptanceContractSha256:contracts[1].sha256,plannedPostgresqlVersion:input.plannedPostgresqlVersion,
    gitSha:input.gitSha,appTreeSha,fixtureSha256:fixture.digest,
    readerQueryMixSha256:capacityDigest({queries:querySources,bindings:fixture.prototype.readerBindings,namedSourceSha256:CAPACITY_NAMED_SOURCE_SHA256}),
    clockRefs:{wall:'Date.now and originating provider capture timestamps',monotonic:'node:perf_hooks performance.now'},
    cleanupPlanRef:'freshness-capacity-profile-v1:parent-process-cleanup-plus-supervisor-final-receipt',
    requestBudgetPolicy:'cp1-data-with-separate-existing-owners-v1',requestOwners:[...FLEET_REQUEST_OWNERS],unrelatedUsernames:[fixture.users[1].username,fixture.users[2].username],
    endpointInventory:fixture.endpointInventory,formatWitnesses:fixture.formatWitnesses,leagues:fixture.sourceLeagues,initialReaders:fixture.prototype.initialReaders,
  },fixture.prototype.events,{kind:'healthy'});
  return {fixture,manifest,sourceFiles:{contracts,querySources,namedSourceSha256:CAPACITY_NAMED_SOURCE_SHA256}};
}

/** Recovery shares only the validated reader binding core; its acceptance/outage/backlog gates are separate. */
export async function buildFleetRecoveryManifest(input:Parameters<typeof buildFleetHealthyManifest>[0]) {
  const {fixture,manifest:observerManifest,sourceFiles}=await buildFleetHealthyManifest(input);
  const {createCapacityRecoveryManifest}=await import('./freshness-capacity-recovery');
  const source=observerManifest.source;
  const recoveryManifest=createCapacityRecoveryManifest(fixture,{
    readinessContractSha256:source.readinessContractSha256,acceptanceContractSha256:source.acceptanceContractSha256,
    plannedPostgresqlVersion:source.plannedPostgresqlVersion,gitSha:source.gitSha,appTreeSha:source.appTreeSha,
    requestBudgetPolicy:source.requestBudgetPolicy!,readerQueryMixSha256:source.readerQueryMixSha256,requestOwners:source.requestOwners,observerManifestDigest:observerManifest.digest,
  });
  return{fixture,observerManifest,recoveryManifest,sourceFiles};
}

import type { FleetConfig, FleetMessage, FleetSpan } from './freshness-capacity-protocol';
import type { QualificationBinding } from './qualification-profile';

export type FleetCompanion = { kind:'cp26-fleet-healthy-evidence-v1'|'cp26-fleet-recovery-evidence-v1'; contextDigest:string;
  config:FleetConfig; ready:FleetMessage; calls:FleetMessage[]; cases:{name:string;state:string;span:FleetSpan}[];
  rawDirectory:string;rawInventory:FleetEvidenceInventory;finalDirectory:string;finalInventory:FleetEvidenceInventory;
  cleanup:{childClosed:boolean;backendGone:boolean;locksGone:boolean;connectionsClosed:boolean};cleanupAttempts:{span:FleetSpan;completed:boolean;facts:FleetCompanion['cleanup']}[];childExit:{code:number|null;signal:string|null};forcedStop:boolean;actualServer:{version:string;versionNum:string};
  disabledBefore:string;disabledAfter:string;enrollmentPrerequisites:Record<string,unknown>[] };
/** Protocol truth is checked before any chunk is opened. No supplied pass/ready boolean qualifies this artifact. */
export async function assertFleetCompanionEnvelope(value:unknown,binding:QualificationBinding):Promise<FleetCompanion>{
  const row=object(value) as FleetCompanion;keys(row,['kind','contextDigest','config','ready','calls','cases','rawDirectory','rawInventory','finalDirectory','finalInventory','cleanup','cleanupAttempts','childExit','forcedStop','actualServer','disabledBefore','disabledAfter','enrollmentPrerequisites']);
  const protocol=await import('./freshness-capacity-protocol');const config=protocol.parseFleetConfig(row.config);
  assert.equal(config.profile,binding.context.profile);assert.equal(config.contextNonce,binding.context.nonce);assert.equal(config.gitSha,binding.context.gitSha);assert.equal(config.profileDigest,binding.context.profileDigest);
  assert.equal(row.contextDigest,hash(JSON.stringify(binding.context)));
  const recovery=config.profile===FLEET_RECOVERY_PROFILE;assert.equal(row.kind,recovery?'cp26-fleet-recovery-evidence-v1':'cp26-fleet-healthy-evidence-v1');
  assert.equal(row.rawDirectory,'fleet-raw-'+config.nonce);assert.equal(row.finalDirectory,'fleet-final-'+config.nonce);
  assert.equal(config.evidenceDirectory,resolve(binding.directory,row.rawDirectory));
  assertFleetEvidenceInventory(row.rawInventory);assertFleetEvidenceInventory(row.finalInventory);
  assert.equal(row.rawInventory.manifestDigest,config.manifestDigest);assert.equal(row.finalInventory.manifestDigest,config.manifestDigest);
  assert.equal(row.rawInventory.coverage.find(item=>item.stream==='cleanup')!.rows,0);assert(row.finalInventory.coverage.every(item=>item.rows>0));
  const ready=protocol.parseFleetMessage(row.ready,config,row.ready.pid);assert.equal(ready.type,'ready');
  const expected=['omitted','false','prepare',recovery?'run-recovery':'run-healthy','snapshot'];assert.equal(row.calls.length,expected.length);
  let previous=Date.parse(ready.span.endedAt);
  for(const [index,input] of row.calls.entries()){const call=protocol.parseFleetMessage(input,config,ready.pid);assert.equal(call.type,'result');assert.equal(call.action,expected[index]);assert.equal(call.sequence,index+1);assert.equal(call.error,false);
    assert.equal(call.backendPid,ready.backendPid);assert.equal(call.backendStart,ready.backendStart);
    assert(Date.parse(call.span.startedAt)>=previous);previous=Date.parse(call.span.endedAt);
    if(index===3)assert.equal(capacityDigest(call.inventory),capacityDigest(row.rawInventory));else assert.equal(call.inventory,null);
  }
  assert(previous<=config.workDeadlineAt,'worker result exceeded original work deadline');
  const names=recovery?FLEET_RECOVERY_TESTS:FLEET_HEALTHY_TESTS;assert.equal(row.cases.length,names.length);previous=0;
  for(const [index,item] of row.cases.entries()){keys(item,['name','state','span']);assert.equal(item.name,names[index]);assert.equal(item.state,'passed');protocol.assertFleetSpan(item.span);
    assert(Date.parse(item.span.startedAt)>=previous);previous=Date.parse(item.span.endedAt);}
  for(const [index,first,last] of (recovery?[[0,0,4]]:[[0,0,1],[1,2,4]])){assert(Date.parse(row.cases[index].span.startedAt)<=Date.parse(row.calls[first].span.startedAt));assert(Date.parse(row.cases[index].span.endedAt)>=Date.parse(row.calls[last].span.endedAt));}
  keys(row.cleanup,['childClosed','backendGone','locksGone','connectionsClosed']);assert(Object.values(row.cleanup).every(item=>item===true),'unverified parent process cleanup');
  assert.equal(row.forcedStop,false);keys(row.childExit,['code','signal']);assert.equal(row.childExit.code,0);assert.equal(row.childExit.signal,null);
  assert(Array.isArray(row.cleanupAttempts)&&row.cleanupAttempts.length>0);for(const attempt of row.cleanupAttempts){keys(attempt,['span','completed','facts']);protocol.assertFleetSpan(attempt.span);assert.equal(capacityDigest(attempt.facts),capacityDigest(row.cleanup));assert.equal(attempt.completed,true);}
  keys(row.actualServer,['version','versionNum']);assert.equal(row.actualServer.version.split(' ')[0],config.plannedPostgresqlVersion);
  const [major,minor]=config.plannedPostgresqlVersion.split('.').map(Number);assert.equal(row.actualServer.versionNum,String(major*10000+minor));
  assert.match(row.disabledBefore,/^[a-f0-9]{64}$/u);assert.equal(row.disabledBefore,row.disabledAfter,'disabled invocation changed stored state');
  for(const call of row.calls.slice(0,2)){assert.equal(call.result?.dataAttemptsBefore,0);assert.equal(call.result?.dataAttemptsAfter,0);}
  assert.equal(row.calls[4].result?.openInvocations,0);assert.equal(row.calls[4].result?.rejected,0);assert.equal(row.calls[4].result?.rawWritten,true);
  assert.equal(row.enrollmentPrerequisites.length,3);assert.deepEqual(row.enrollmentPrerequisites.map(item=>item.leagueKey).sort(),['dynasty','league1','league2']);
  return row;
}
function fleetIndex(rows:readonly Record<string,unknown>[],field:string){const map=new Map<string,Record<string,unknown>>();for(const row of rows){const id=String(row[field]);assert(!map.has(id),'duplicate retained proof: '+id);map.set(id,row);}return map;}
function fleetRows(value:unknown):Record<string,unknown>[]{assert(Array.isArray(value));return value.map(object);}
function numericSpan(value:unknown){const row=object(value);for(const key of ['startedAt','endedAt','monotonicStartedAt','monotonicEndedAt'])assert(typeof row[key]==='number'&&Number.isFinite(row[key]));
  assert(Number(row.endedAt)>=Number(row.startedAt)&&Number(row.monotonicEndedAt)>=Number(row.monotonicStartedAt));return row;}
/** Complete source-bound semantic reconciliation; raw chunks and final cleanup remain separate immutable artifacts. */
export async function validateFleetCompanion(value:unknown,binding:QualificationBinding){
  const companion=await assertFleetCompanionEnvelope(value,binding),config=companion.config;
  assert.equal(await realpath(binding.directory),resolve(binding.directory),'symlinked artifact root');const root=await lstat(binding.directory);assert(root.isDirectory()&&!root.isSymbolicLink());
  const directories=[companion.rawDirectory,companion.finalDirectory].map(name=>join(binding.directory,name));
  for(const path of directories){assert.equal(resolve(path),path);const stat=await lstat(path);assert(stat.isDirectory()&&!stat.isSymbolicLink(),'symlinked evidence directory');assert.equal(await realpath(path),path,'noncanonical evidence directory');}
  const raw=await readFleetRawEvidenceDocuments(directories[0],companion.rawInventory),documents=await readFleetEvidenceDocuments(directories[1],companion.finalInventory);
  for(const stream of FLEET_RAW_EVIDENCE_STREAMS)assert.equal(capacityDigest(raw[stream]),capacityDigest(documents[stream]),'raw/final evidence changed: '+stream);
  const cleanup=object(documents.cleanup);keys(cleanup,['kind','childClosed','backendGone','locksGone','connectionsClosed','childExit','forcedStop','cleanupAttempts','at','backendPid','backendStart','scope']);
  assert.equal(cleanup.kind,'cp26-parent-process-cleanup-v1');for(const key of ['childExit','forcedStop','cleanupAttempts'] as const)assert.equal(capacityDigest(cleanup[key]),capacityDigest(companion[key]));for(const key of Object.keys(companion.cleanup))assert.equal(cleanup[key],true);
  assert.equal(cleanup.backendPid,companion.ready.backendPid);assert.equal(cleanup.backendStart,companion.ready.backendStart);
  assert(typeof cleanup.at==='string'&&Number.isFinite(Date.parse(cleanup.at)));assert(Date.parse(cleanup.at)>=Date.parse(companion.calls.at(-1)!.span.endedAt));
  assert.equal(cleanup.scope,'Child process, pinned connection and locks only; outer supervisor owns database resources.');
  const capacity=object(documents['capacity-evidence']);keys(capacity,['manifest','evidence','analysis','journalValidation','evidenceFailures',...(config.profile===FLEET_RECOVERY_PROFILE?['observerManifest']:[])]);assert.equal(capacity.journalValidation,'validated');assert.deepEqual(capacity.evidenceFailures,[]);
  const buildInput={fixtureId:config.fixtureId,gitSha:config.gitSha,plannedPostgresqlVersion:config.plannedPostgresqlVersion};
  const healthy=config.profile===FLEET_HEALTHY_PROFILE;
  const built=healthy?await buildFleetHealthyManifest(buildInput):await buildFleetRecoveryManifest(buildInput);
  const manifest='manifest'in built?built.manifest:built.observerManifest;
  const laneManifest='manifest'in built?built.manifest:built.recoveryManifest;
  if(!healthy)assert.equal(capacityDigest(capacity.observerManifest),capacityDigest(manifest),'recovery observer binding drift');
  assert.equal(built.fixture.digest,config.fixtureDigest);assert.equal(laneManifest.digest,config.manifestDigest);assert.equal(capacityDigest(capacity.manifest),capacityDigest(laneManifest));
  const evidence=object(capacity.evidence);assert.equal(evidence.manifestDigest,config.manifestDigest);
  assert.equal(capacityDigest(documents['transport-attempts']),capacityDigest(evidence.requests));
  const {evaluateCapacityEvidence,assertCapacityHttpEndpoint}=await import('./freshness-capacity-evidence');
  const analysis=healthy?evaluateCapacityEvidence(manifest,capacity.evidence as import('./freshness-capacity-evidence').CapacityEvidence)
    :(await import('./freshness-capacity-recovery')).evaluateCapacityRecovery(laneManifest as import('./freshness-capacity-recovery').CapacityRecoveryManifest,capacity.evidence as import('./freshness-capacity-recovery').CapacityRecoveryEvidence);
  assert.equal(capacityDigest(analysis),capacityDigest(capacity.analysis),'reported analysis differs from complete evidence');
  assert('offlineChecksPass'in analysis?analysis.offlineChecksPass:analysis.pass,'fleet evidence gates failed');
  const requests=object(evidence.requests),attempts=fleetIndex(fleetRows(requests.attempts),'id');
  for(const row of attempts.values())assertCapacityHttpEndpoint(row as import('./freshness-capacity-evidence').HttpAttempt,true);
  const responseOwners=fleetRows(documents['transport-responses']);assert.deepEqual(responseOwners.map(row=>row.owner).sort(),[...FLEET_REQUEST_OWNERS].sort());
  const responses=new Map<string,Record<string,unknown>>();
  for(const owner of responseOwners)for(const response of fleetRows(owner.responses)){
    const id=String(response.attemptId);assert(!responses.has(id),'duplicate physical response');responses.set(id,response);const attempt=attempts.get(id);assert(attempt&&attempt.owner===owner.owner&&attempt.outcome==='success');
    assert.equal(hash(String(response.rawUtf8)),response.rawSha256);assert.equal(response.rawSha256,attempt.responseSha256);assert.equal(response.requestStartedAt,attempt.at);assert.equal(response.responseCompletedAt,attempt.endedAt);
    assert.equal(response.responseBoundary,'full-synthetic-bytes-available');assert(Number(response.monotonicCompletedAt)>=Number(response.monotonicStartedAt));
    const endpoint=manifest.source.endpointInventory.find(row=>row.id===response.endpointId);assert(endpoint);assert.equal(attempt.origin+String(attempt.path),endpoint.url);assert.equal(attempt.method,endpoint.method);
    const permitted=healthy?endpoint.versions:(laneManifest as import('./freshness-capacity-recovery').CapacityRecoveryManifest).endpoints.find(row=>row.id===endpoint.id)?[...['before','after'].map(key=>((laneManifest as import('./freshness-capacity-recovery').CapacityRecoveryManifest).endpoints.find(row=>row.id===endpoint.id)! as unknown as Record<string,unknown>)[key])]:[];
    assert(permitted.some(value=>{const payload=value as {version:string;sha256:string;utf8:string};return payload.version===response.version&&payload.sha256===response.rawSha256&&payload.utf8===response.rawUtf8;}),'unbound physical payload version');
    assert.equal(capacityDigest(response.pairIds),capacityDigest(endpoint.pairIds));
  }
  const primary=object(documents['primary-coexistence']),fixture=object(primary.fixture),secondary=fleetRows(primary.secondaryResponses);
  const nativeDocuments=fleetIndex(fleetRows(fixture.documents),'url');
  for(const response of secondary){const id=String(response.attemptId);assert(!responses.has(id));const attempt=attempts.get(id),document=object(response.document);
    const retained=nativeDocuments.get(String(document.url));assert(retained&&capacityDigest(retained)===capacityDigest(document));assert.equal(hash(String(document.utf8)),document.sha256);
    if(attempt){assert.equal(attempt.owner,response.owner);assert.equal(attempt.origin+String(attempt.path),document.url);assert.equal(attempt.responseSha256,document.sha256);assert.equal(attempt.at,response.at);assert.equal(attempt.endedAt,response.endedAt);responses.set(id,response);}}
  for(const [id,attempt] of attempts)assert.equal(responses.has(id),attempt.outcome==='success','source response coverage mismatch');
  const operations=object(documents['observer-operations']),reads=object(documents['observer-reads']),proofDocument=object(documents['observer-lineage']);
  assert.equal(operations.openInvocations,0);assert(Array.isArray(operations.failures));
  const coverage=fleetIndex(fleetRows(operations.ownerCoverage),'owner');for(const owner of FLEET_REQUEST_OWNERS){const row=coverage.get(owner);assert(row&&Number(row.startedAt)<=Number(evidence.startedAt)&&Number(row.endedAt)>=Number(evidence.endedAt));}
  const invocations=fleetRows(operations.invocations);for(const invocation of invocations){assert.equal(invocation.owner,'data-refresh');numericSpan(invocation.span);assert.notEqual(invocation.failed,null);}
  const durable=fleetRows(proofDocument.durableDispatches);assert(durable.length>0);for(const row of durable){const dispatch=object(row.dispatch),outcome=object(row.outcome);assert.equal(dispatch.worker_id,outcome.worker_id);assert.equal(dispatch.generation,outcome.generation);}
  const proofRows=fleetIndex(fleetRows(proofDocument.receiptProofs),'receiptId'),outcomes=fleetIndex(fleetRows(proofDocument.dispatchOutcomes),'id');
  for(const row of outcomes.values())assert.equal(capacityDigest(row.value),row.id);
  const {parsePublicCaptureWitness}=await import('../lib/league-administration/public-capture-witness');
  for(const proof of proofRows.values()){
    const response=responses.get(String(proof.transportAttemptId));assert(response&&response.rawSha256===proof.sourceResponseSha256);assert.equal(response.responseCompletedAt,proof.sourceResponseCompletedAt);
    const provenance=object(proof.receiptProvenance),dispatch=object(proof.dispatch),witness=parsePublicCaptureWitness(provenance.acquisition);
    assert.equal(provenance.origin,'network');assert.equal(provenance.sourceObservedAt,provenance.requestCompletedAt);
    const captureStart=Date.parse(String(provenance.requestStartedAt)),captureEnd=Date.parse(String(provenance.requestCompletedAt));
    assert(captureStart<=Number(response.requestStartedAt)&&Number(response.responseCompletedAt)<=captureEnd);
    assert.equal(witness.fence.workerId,dispatch.worker_id);assert.equal(witness.fence.generation,dispatch.generation);assert.equal(witness.dispatchNonce,dispatch.capture_nonce);assert.equal(capacityDigest(witness.work),capacityDigest(dispatch.work));assert.equal(capacityDigest(witness.mapping),capacityDigest(proof.mapping));
    assert.equal(invocations.filter(row=>{const span=object(row.span);return Number(span.startedAt)<=captureStart&&captureEnd<=Number(span.endedAt)&&Date.parse(witness.fence.deadlineAt)===Number(span.startedAt)+20_000;}).length,1);
  }
  const readRows=fleetRows(reads.lineage);for(const row of readRows){numericSpan(row);assert(proofRows.has(String(row.proofId)));assert(row.outcomeId===null||outcomes.has(String(row.outcomeId)));}
  const origins=fleetIndex(fleetRows(evidence.origins),'id');
  function actualRead(pairId:string,read:import('./freshness-capacity-evidence').ResourceRead,reader?:ReaderExpectation){
    const origin=origins.get(read.originObservationId);assert(origin&&origin.pairId===pairId);const id=read.originObservationId.slice(0,read.originObservationId.indexOf('/')),proof=proofRows.get(id);assert(proof);
    assert.equal(proof.version,read.version);assert.equal(proof.sourceResponseSha256,read.payloadSha256);assert.equal(proof.transportAttemptId,origin.attemptId);assert.equal(proof.sourceResponseCompletedAt,origin.observedAt);
    assert(readRows.some(row=>row.proofId===id&&row.pairId===pairId&&row.endedAt===read.at&&(!reader||row.selector===reader.selector&&row.readerValueDigest===capacityDigest(reader.value))),'unwitnessed stored read');
  }
  if(healthy){const ev=capacity.evidence as import('./freshness-capacity-evidence').CapacityEvidence;
    for(const row of ev.firstAcceptances)actualRead(row.pairId,row.read,row.reader);
    for(const row of ev.samples)if(row.read)actualRead(manifest.plan.samples.find(slot=>slot.id===row.id)!.pairId,row.read);
    for(const row of ev.events){const event=manifest.events.find(item=>item.id===row.id)!,pair=manifest.plan.events.find(item=>item.id===row.id)!.pairId;if(row.read)actualRead(pair,row.read,row.reader!);
      for(const expected of event.retainedHistory)assert(readRows.some(item=>item.pairId===pair&&item.selection==='receipt'&&item.selector===expected.selector&&item.readerValueDigest===capacityDigest(expected.value)&&proofRows.get(String(item.proofId))?.version===expected.version),'missing actual immutable history read');}
  }else{const ev=capacity.evidence as import('./freshness-capacity-recovery').CapacityRecoveryEvidence;
    for(const row of [...ev.initial,...ev.recovered,...ev.lastGood.flatMap(row=>[row.before,row.during])])actualRead(row.pairId,row.read,row.reader);
    for(const pair of (laneManifest as import('./freshness-capacity-recovery').CapacityRecoveryManifest).pairs)for(const expected of pair.retainedHistory)assert(readRows.some(item=>item.pairId===pair.pairId&&item.selection==='receipt'&&item.selector===expected.selector&&item.readerValueDigest===capacityDigest(expected.value)&&proofRows.get(String(item.proofId))?.version===expected.version),'missing actual recovery immutable history read');
    for(const row of ev.samples)if(row.read)actualRead((laneManifest as import('./freshness-capacity-recovery').CapacityRecoveryManifest).samples.find(slot=>slot.id===row.id)!.pairId,row.read);
    assert(Array.isArray(proofDocument.endpointProofs),'missing full recovery endpoint proof journal');
  }
  const fullProofs:{completedAt:number|null;completeProof:import('./freshness-capacity-recovery').RecoveryIntakeProof|null}[]=[];
  if(healthy){const ev=capacity.evidence as import('./freshness-capacity-evidence').CapacityEvidence,ops=fleetRows(operations.operations);
    for(const intake of ev.intakes){assert(intake.completeAt!==null&&intake.coverage==='complete');const completed=ops.filter(row=>row.operation==='intake/'+intake.cohort&&row.outcome!==null&&object(row.outcome).coverage==='complete-materialized-inventory');assert.equal(completed.length,1,'missing exact healthy intake completion operation');
      const operation=completed[0],span=object(operation.span);numericSpan(span);assert.equal(span.endedAt,intake.completeAt);const proof=object(operation.outcome) as unknown as import('./freshness-capacity-recovery').RecoveryIntakeProof;
      const submissions=ops.filter(row=>row.operation==='submission/'+intake.cohort);assert.equal(submissions.length,1);assert.equal(object(submissions[0].outcome).requestId,proof.requestId);assert.equal(object(submissions[0].outcome).status,'retained');assert.equal(object(submissions[0].span).endedAt,intake.receiptAt);
      const leagues=manifest.source.leagues.filter(row=>manifest.plan.leagues.find(item=>item.key===row.key)!.cohort===intake.cohort),ids=leagues.map(row=>row.nativeLeagueId);assert.deepEqual([...proof.nativeIds].sort(),ids.sort());assert.equal(proof.terminal,true);assert(Number.isSafeInteger(proof.terminalRevision)&&proof.terminalRevision>0);assert.equal(proof.parity,'immutable-intake-receipts-and-current-readers');assert.equal(proof.detailedPeriods,ids.length*18);assert.equal(proof.detailedTransactions,ids.length*19);assert.equal(proof.detailedDrafts,ids.length*5);
      const identity='identity:'+intake.cohort,discovery='discovery:'+intake.cohort;const endpoints=manifest.source.endpointInventory.filter(row=>ids.includes(row.scope.nativeLeagueId??'')||row.id===identity||row.id===discovery).map(row=>row.id);assert.deepEqual([...proof.completedEndpointIds].sort(),endpoints.sort());assert.equal(proof.retainedPages.length,proof.pages);assert.equal(proof.originalAggregateStatuses.length,proof.pages);assert(proof.originalAggregateStatuses.every(status=>['available','partial'].includes(status)));fullProofs.push({completedAt:intake.completeAt,completeProof:proof});
    }
  }else{const ev=capacity.evidence as import('./freshness-capacity-recovery').CapacityRecoveryEvidence;fullProofs.push(...ev.submissions,...ev.queue.completed);}
    const endpointRows=fleetRows(proofDocument.endpointProofs),endpoints=new Map<string,Record<string,unknown>>();
    for(const row of endpointRows){const key=[row.requestId??'shared',row.endpointId,row.proofId].join('/');assert(!endpoints.has(key));endpoints.set(key,row);await assertFleetEndpointLineage(row,responses,attempts,invocations);}
    if(!healthy){const ev=capacity.evidence as import('./freshness-capacity-recovery').CapacityRecoveryEvidence;
    for(const row of ev.endpointAcceptances){const proof=endpoints.get([row.requestId??'shared',row.endpointId,row.proofId].join('/'));assert(proof,'missing exact recovery endpoint proof');
      assert.equal(proof.attemptId,row.attemptId);assert.equal(proof.kind,row.kind);const clocks=await assertFleetEndpointLineage(proof,responses,attempts,invocations);assert.equal(clocks.sourceObservedAt,row.sourceObservedAt);assert.equal(clocks.acceptedAt,row.acceptedAt);const span=object(proof.readSpan);assert(Number(span.startedAt)<=row.readAt&&row.readAt<=Number(span.endedAt));}
    }
    const currentRows=fleetIndex(fleetRows(proofDocument.currentIntakeReads),'id');
    for(const completed of fullProofs){const proof=completed.completeProof;if(!proof)continue;
      const recovery=healthy?null:laneManifest as import('./freshness-capacity-recovery').CapacityRecoveryManifest,queue=healthy?null:(capacity.evidence as import('./freshness-capacity-recovery').CapacityRecoveryEvidence).queue;const initialTarget=queue?.targets.find(target=>target.input.identityRequestId===proof.requestId);const initialScope=initialTarget?recovery!.initialRequests.find(row=>row.cohort===initialTarget.cohort):null;assert.equal(proof.coverage,initialScope?'complete-materialized-initial-scope':'complete-materialized-inventory');const exactWeeks=initialScope?[7]:Array.from({length:18},(_,i)=>i+1),transactionWeeks=initialScope?[7]:Array.from({length:19},(_,i)=>i);if(initialScope){assert.deepEqual([...proof.completedEndpointIds].sort(),[...initialScope.endpointIds].sort());assert.deepEqual([...proof.nativeIds].sort(),[...initialScope.nativeLeagueIds].sort());assert.equal(proof.draftProofs.length,0);}

      for(const endpointId of proof.completedEndpointIds)assert(endpointRows.some(row=>row.requestId===proof.requestId&&row.endpointId===endpointId&&proof.immutableProofIds.includes(String(row.proofId))),'missing original immutable endpoint lineage');
      for(const id of proof.immutableProofIds)assert(endpointRows.some(row=>row.requestId===proof.requestId&&row.proofId===id),'foreign immutable intake proof');
      for(const id of proof.currentReadProofIds){const current=currentRows.get(id);assert(current&&current.requestId===proof.requestId&&proof.nativeIds.includes(String(current.nativeLeagueId)));const {id:ignored,...body}=current;void ignored;assert.equal(capacityDigest(body),id);numericSpan(current.span);
        await assertFleetCurrentIntakeRead(current,responses,attempts,invocations);}
      assert.equal(new Set(proof.currentReadProofIds.map(id=>{const row=currentRows.get(id)!;return row.nativeLeagueId+'/'+String(row.kind);})).size,proof.nativeIds.length*3);
      for(const draft of proof.draftProofs){const original=endpointRows.find(row=>row.requestId===proof.requestId&&row.endpointId===draft.endpointId&&row.proofId===draft.receiptId);assert(original,'missing original draft receipt');const record=object(original.record),normalized=await normalizedFleetReceipt(record);const endpoint=manifest.source.endpointInventory.find(row=>row.id===draft.endpointId);assert(endpoint);const projected=endpoint.resource==='draft-catalog'||endpoint.resource==='draft-detail'?(await import('../lib/aggregator/draft-metadata')).projectDraftMetadata(normalized):endpoint.resource==='draft-selections'?(await import('../lib/aggregator/draft-selections')).projectDraftSelections(normalized):(await import('../lib/aggregator/traded-picks')).projectTradedPicks(normalized);assert.equal(projected.status,'accepted');assert.equal(capacityDigest(projected.value),draft.valueDigest,'original draft typed value drift');}
      const normalizedOriginal=new Map<string,Awaited<ReturnType<typeof normalizedFleetReceipt>>>();
      const original=async(id:unknown)=>{const key=String(id);if(!normalizedOriginal.has(key)){const raw=endpointRows.find(row=>row.requestId===proof.requestId&&row.proofId===key&&object(row.record).receipt);assert(raw,'typed page points to absent original receipt');normalizedOriginal.set(key,await normalizedFleetReceipt(object(raw.record)));}return normalizedOriginal.get(key)!;};
      const exactKeys=new Set<string>(),transactionKeys=new Set<string>(),draftKeys=new Set<string>();
      const retained=fleetRows(reads.intakePages),pageValues=proof.retainedPages.map((digest,index)=>{const page=retained.find(row=>row.digest===digest);assert(page&&capacityDigest(page.value)===digest);const value=object(page.value);assert.equal(value.status,proof.originalAggregateStatuses[index]);return value;});
      const activePages=assertFleetIntakePagination(pageValues,Boolean(initialScope));
      for(const [index,digest]of proof.retainedPages.entries()){const value=pageValues[index],active=activePages[index];
        const reports=fleetRows(value.weeklyReports??(initialScope?[]:undefined));assert.deepEqual(reports.map(entry=>entry.externalLeagueId+'/'+String(entry.nativeWeek)).sort(),initialScope?[]:proof.nativeIds.flatMap(id=>Array.from({length:18},(_,i)=>id+'/'+(i+1))).sort());assert.deepEqual(fleetRows(value.brackets).map(entry=>entry.externalLeagueId).sort(),[...proof.nativeIds].sort());
        for(const entry of reports){const read=object(entry.resource);assert.equal(read.status,'available');const roster=currentRows.get(proof.currentReadProofIds.find(id=>{const row=currentRows.get(id)!;return row.kind==='heldRoster'&&row.nativeLeagueId===entry.externalLeagueId;})!);assert(roster,'missing same-league current roster identity proof');const pageLeague=fleetRows(value.leagues).find(row=>row.externalLeagueId===entry.externalLeagueId);assert(pageLeague);const held=object(object(pageLeague.resources).heldRoster),current=held.status==='available'?held:object(held.retained);assert.equal(capacityDigest(current),capacityDigest(roster.read),'page roster differs from bound canonical identities');assert.equal(capacityDigest(read.value),capacityDigest(await fleetWeeklyReportReaderValue(await original(read.reportReceiptId),roster)));}
        for(const entry of fleetRows(value.brackets)){const read=object(entry.resource);assert.equal(read.status,'available');for(const family of ['winners_bracket','losers_bracket']){const bracket=object(read[family]);assert.equal(bracket.status,'available');const projected=(await import('../lib/aggregator/playoff-brackets')).projectPlayoffBracket(await original(bracket.bracketReceiptId));assert.equal(projected.status,'accepted');assert.equal(capacityDigest(bracket.value),capacityDigest(projected.value));}}
        for(const entry of active.exactPeriods?fleetRows(value.exactPeriods):[]){const read=object(entry.exactMatchupValues);assert.equal(read.status,'available');assert.equal(read.selection,'receipt');const projected=(await import('../lib/aggregator/exact-matchup-values')).projectExactMatchupValues(await original(read.matchupsReceiptId),object(read.value).teams as Parameters<typeof import('../lib/aggregator/exact-matchup-values').projectExactMatchupValues>[1]);assert.equal(capacityDigest(read.value),capacityDigest(projected));const key=entry.externalLeagueId+'/'+String(entry.nativeWeek);assert(!exactKeys.has(key));exactKeys.add(key);}
        for(const entry of active.transactions?fleetRows(value.transactions):[]){const read=object(entry.resource);assert.equal(read.status,'available');const capture=object(read.capture);assert.equal(capacityDigest(capture.normalizedValue),capacityDigest((await original(object(capture.receipt).id)).value));const key=entry.externalLeagueId+'/'+String(entry.nativeWeek);assert(!transactionKeys.has(key));transactionKeys.add(key);}
        for(const entry of active.drafts?fleetRows(value.drafts??(initialScope?[]:undefined)):[]){const read=object(entry.resource);assert.equal(read.status,'available');assert.equal(read.selection,'receipt');const proofRow=proof.draftProofs.find(item=>item.receiptId===read.receiptId);assert(proofRow&&proofRow.valueDigest===capacityDigest(read.value));assert(!draftKeys.has(proofRow.key));draftKeys.add(proofRow.key);}
        assert(fleetRows(reads.intakePageReads).some(row=>row.requestId===proof.requestId&&row.digest===digest&&Number(object(row.span).endedAt)<=Number(completed.completedAt)),'unbound original intake page');}
      assert.deepEqual([...exactKeys].sort(),proof.nativeIds.flatMap(id=>exactWeeks.map(week=>id+'/'+week)).sort());assert.deepEqual([...transactionKeys].sort(),proof.nativeIds.flatMap(id=>transactionWeeks.map(week=>id+'/'+week)).sort());assert.equal(draftKeys.size,proof.detailedDrafts);
    }
  const pages=fleetIndex(fleetRows(reads.intakePages),'digest');for(const row of pages.values())assert.equal(capacityDigest(row.value),row.digest);
  for(const row of fleetRows(reads.intakePageReads)){numericSpan(row.span);assert(pages.has(String(row.digest)));}
  const ancillary=await assertFleetAncillaryEvidence({manifest,recovery:healthy?null:laneManifest as import('./freshness-capacity-recovery').CapacityRecoveryManifest,evidence,lineage:proofDocument,reads,operations,primary,responses,attempts,invocations});
  await assertFleetNamedAndCoexistence(companion,documents,primary);
  return{profile:config.profile,manifestDigest:config.manifestDigest,rawInventory:companion.rawInventory,finalInventory:companion.finalInventory,analysis,ancillary,
    checkpoint26Qualified:false as const,cleanupScope:'child-process-and-connections-only' as const};
}

/** Validates the ordinary reader's independent cursors without discarding retained pages.
 * Exhausted families restart at page zero while another family advances; only an
 * exact replay of that already validated first family page is excluded from counts. */
export function assertFleetIntakePagination(pages:readonly Record<string,unknown>[],initialScope:boolean){
  assert(pages.length>0,'missing retained intake pages');
  const families=[['periodInventory','exactPeriods'],['transactionHistory','transactions'],['draftPicks','drafts']] as const;
  if(initialScope){
    assert.equal(pages.length,1,'initial scope must retain exactly one page');
    for(const [inventory]of families)assert.equal(pages[0][inventory],undefined,'initial scope cannot claim full inventory pagination');
    assert.equal(fleetRows(pages[0].drafts??[]).length,0,'initial scope cannot contain draft rows');
    return[{exactPeriods:true,transactions:true,drafts:false}];
  }
  const cursors:Record<typeof families[number][1],number|null>={exactPeriods:0,transactions:0,drafts:0};
  const first=new Map<string,string>(),inventories=new Map<string,string>();
  const result=pages.map(value=>{
    assert(Object.values(cursors).some(cursor=>cursor!==null),'extra aggregate page after all families completed');
    const active={exactPeriods:false,transactions:false,drafts:false};
    for(const [inventoryName,rowsName]of families){
      const inventory=object(value[inventoryName]),page=object(inventory.page),rows=fleetRows(value[rowsName]);
      const cursor=cursors[rowsName],familyDigest=capacityDigest({inventory,rows});
      if(cursor===null){assert.equal(familyDigest,first.get(rowsName),'changed completed-family first-page replay');continue;}
      keys(page,['afterOrdinal','limit','nextAfterOrdinal']);assert.equal(page.afterOrdinal,cursor,'intake cursor chain changed');assert.equal(page.limit,20,'intake page limit changed');
      const tasks=fleetRows(inventory.tasks),ordinals=tasks.map(task=>task.ordinal);let previous=0;
      for(const ordinal of ordinals){assert(Number.isSafeInteger(ordinal)&&Number(ordinal)>previous,'invalid intake inventory ordinals');previous=Number(ordinal);}
      const metadata=capacityDigest({...inventory,page:null});if(cursor===0){first.set(rowsName,familyDigest);inventories.set(rowsName,metadata);}else assert.equal(metadata,inventories.get(rowsName),'intake inventory changed between pages');
      const remaining=ordinals.filter(ordinal=>Number(ordinal)>cursor),selected=remaining.slice(0,20);
      assert.deepEqual(rows.map(row=>row.ordinal),selected,'intake detail page differs from its inventory slice');
      const next=remaining.length>20?selected.at(-1):null;assert.equal(page.nextAfterOrdinal,next,'intake continuation omitted or changed');
      assert(next===null||Number.isSafeInteger(next)&&Number(next)>cursor,'intake cursor did not advance');
      cursors[rowsName]=next===null?null:Number(next);active[rowsName]=true;
    }
    return active;
  });
  assert(Object.values(cursors).every(cursor=>cursor===null),'retained intake pagination is incomplete');
  return result;
}

export async function assertFleetNamedAndCoexistence(companion:FleetCompanion,documents:Record<FleetEvidenceStream,unknown>,primary:Record<string,unknown>){
  const {loadCapacityNamedSourceFixture}=await import('./freshness-capacity-fixtures');const retained=loadCapacityNamedSourceFixture();
  const fixture=object(primary.fixture);assert.equal(capacityDigest(fixture.named),capacityDigest(retained));
  assert.equal(capacityDigest({named:fixture.named,documents:fixture.documents,sourceFiles:fixture.sourceFiles}),fixture.digest);
  const siteRoot=fileURLToPath(new URL('../',import.meta.url));const sources=fleetRows(fixture.sourceFiles);
  assert.deepEqual(sources.map(row=>row.path).sort(),['test-support/fixtures/sleeper-2026-season-schedule.json',...['QB','RB','WR','TE','K','DEF'].map(position=>'test-support/fixtures/all-player-foundation/catalog-'+position+'.json')].sort());
  for(const source of sources)assert.equal(hash(await readFile(join(siteRoot,String(source.path)))),source.sha256,'coexistence fixture source drift');
  const cache=object(primary.cache);assert.equal(cache.kind,'installed-next-filesystem-cache');assert.equal(cache.customHandler,false);
  assert(Array.isArray(cache.sourceFiles)&&cache.sourceFiles.length===5);
  const {createRequire}=await import('node:module'),require=createRequire(join(siteRoot,'package.json'));
  const cacheSources=fleetRows(cache.sourceFiles);assert.deepEqual(cacheSources.map(row=>row.name).sort(),['next/package.json','next/dist/server/lib/incremental-cache/index.js','next/dist/server/lib/incremental-cache/file-system-cache.js','next/dist/server/lib/node-fs-methods.js','next/dist/server/web/spec-extension/unstable-cache.js'].sort());
  for(const source of cacheSources)assert.equal(hash(await readFile(require.resolve(String(source.name)))),source.sha256,'installed cache source drift');
  const calls=fleetRows(primary.calls),enabled=calls.filter(row=>row.action==='enabled');assert(enabled.length>0);
  const {assertFleetSpan}=await import('./freshness-capacity-protocol');
  for(const call of calls)assertFleetSpan(call.span as FleetSpan);
  assert(enabled.some(row=>!row.failed&&object(row.outcome).status==='completed'&&Number(object(row.outcome).publishedLeagues)>0&&object(row.outcome).failedLeagues===0),'no positive full primary execution');
  const lane=object(documents['capacity-evidence']),observed=object(lane.evidence),requestRows=fleetRows(object(documents['transport-attempts']).attempts);
  const recovery=companion.config.profile===FLEET_RECOVERY_PROFILE,outage=recovery?object(observed.outage):null;
  for(const call of enabled){const outcome=call.outcome===null?null:object(call.outcome);
    const normal=call.failed===false&&outcome&&['completed','skipped'].includes(String(outcome.status))&&(outcome.status!=='completed'||outcome.failedLeagues===0);
    if(normal)continue;
    const span=call.span as FleetSpan,begin=Date.parse(span.startedAt),end=Date.parse(span.endedAt);
    assert(recovery&&outage&&begin>=Number(outage.startedAt)&&begin<Number(outage.dependencyRestoredAt),'primary failure outside declared provider outage');
    assert(requestRows.some(row=>row.owner==='primary-projection'&&row.outcome!=='success'&&Number(row.at)>=begin&&Number(row.endedAt)<=end),'primary failure lacks actual failed provider attempt');
  }
  const tank=fleetRows(primary.tankAttempts);assert(tank.length>0);const tankIds=fleetIndex(tank,'id'),secondary=fleetRows(primary.secondaryResponses),controlled=fleetIndex(fleetRows(fixture.documents),'url');
  const tankCoverage=object(primary.tankCoverage);assert(Number.isSafeInteger(tankCoverage.startedAt)&&Number.isSafeInteger(tankCoverage.endedAt)&&Number(tankCoverage.endedAt)>=Number(tankCoverage.startedAt));assert.equal(tankCoverage.attempts,tank.length);
  let tankSequence=0;for(const row of tank){assert.equal(row.sequence,++tankSequence);assert(Number.isSafeInteger(row.at)&&Number.isSafeInteger(row.endedAt)&&Number(row.endedAt)>=Number(row.at));assert(Number(row.at)>=Number(tankCoverage.startedAt)&&Number(row.endedAt)<=Number(tankCoverage.endedAt));
    assert.equal(calls.filter(call=>{const span=call.span as FleetSpan;return Date.parse(span.startedAt)<=Number(row.at)&&Number(row.endedAt)<=Date.parse(span.endedAt);}).length,1,'Tank01 attempt outside actual primary invocation');assert.equal(row.owner,'primary-projection');assert.equal(row.origin,'https://tank01-nfl-live-in-game-real-time-statistics-nfl.p.rapidapi.com');assert.equal(row.method,'GET');assert(['success','failed','timeout'].includes(String(row.outcome)));
    const matches=secondary.filter(response=>response.attemptId===row.id);assert.equal(matches.length,row.outcome==='success'?1:0,'Tank01 response coverage mismatch');
    const document=controlled.get(String(row.origin)+String(row.path));assert(document,'undeclared Tank01 route');
    if(row.outcome==='success'){const response=matches[0];assert.equal(response.owner,row.owner);assert.equal(response.at,row.at);assert.equal(response.endedAt,row.endedAt);assert(Number.isFinite(response.monotonicStart)&&Number.isFinite(response.monotonicEnd)&&Number(response.monotonicStart)>=0&&Number(response.monotonicEnd)>=Number(response.monotonicStart));
      assert.equal(capacityDigest(response.document),capacityDigest(document));assert.equal(hash(String(document.utf8)),row.responseSha256);assert.equal(row.responseSha256,document.sha256);
    }else assert.equal(row.responseSha256,null);
  }
  for(const response of secondary)if(String(object(response.document).url).startsWith('https://tank01-nfl-live-in-game-real-time-statistics-nfl.p.rapidapi.com/'))assert(tankIds.has(String(response.attemptId)),'unaccounted Tank01 response');
  const requests=object(documents['transport-attempts']);assert(fleetRows(requests.attempts).some(row=>row.owner==='administration-maintenance'),'no actual maintenance provider coexistence');
  assert(fleetRows(primary.jobs).some(row=>row.job_key==='league-administration-maintenance'&&row.state==='completed'),'maintenance did not finish');
  const named=object(documents['named-regressions']);assert.equal(capacityDigest(named.original),capacityDigest(retained));
  const rows=fleetIndex(fleetRows(named.reads),'key');assert.deepEqual([...rows.keys()].sort(),['dynasty','league1','league2']);
  const {normalizeAdministrationObservation}=await import('../lib/league-administration/normalize');const {projectCurrentRosterGroups}=await import('../lib/aggregator/current-roster-groups');
  for(const sample of retained.collections[0].samples){
    const row=rows.get(sample.key)!,mapping=object(row.mapping),current=object(row.current),held=object(row.held),settings=object(row.settings),roster=object(row.roster);
    const enrollment=companion.enrollmentPrerequisites.find(item=>item.leagueKey===sample.key)!;assert.equal(enrollment.nativeLeagueId,sample.nativeLeagueId);assert.equal(enrollment.season,2026);
    const nativeLeague=sample.resources.find(item=>item.document.family==='league')!.document.payload;
    assert.equal(enrollment.nativeScoringDigest,capacityDigest(object(nativeLeague).scoring_settings));assert.equal(enrollment.kind,'cp26-named-regression-enrollment-prerequisite');
    assert.equal(row.nativeLeagueId,sample.nativeLeagueId);assert.equal(mapping.leagueSeasonId,enrollment.leagueSeasonId);assert.equal(object(mapping.scope).externalLeagueId,sample.nativeLeagueId);
    for(const [family,read] of [['league',current],['rosters',held]] as const){assert.equal(read.status,'available');const envelope=object(read.envelope);
      assert.equal(capacityDigest(envelope.payload),capacityDigest(sample.resources.find(item=>item.document.family===family)!.document.payload));assert.equal(object(envelope.scope).externalLeagueId,sample.nativeLeagueId);assert.equal(object(envelope.scope).season,2026);assert.equal(object(envelope.provenance).origin,'network');}
    assert.equal(settings.status,'available');assert.equal(roster.status,'available');
    const normalizedLeague=normalizeAdministrationObservation(current.envelope as import('../lib/league-administration/contracts').AdministrationEnvelope);assert.equal(normalizedLeague.status,'accepted');assert(normalizedLeague.leagueSettings?.value);
    assert.equal(capacityDigest(settings.value),capacityDigest(normalizedLeague.leagueSettings.value),'named typed settings differ from retained native source');
    const normalizedRoster=normalizeAdministrationObservation(held.envelope as import('../lib/league-administration/contracts').AdministrationEnvelope);assert(normalizedRoster.status==='accepted'&&normalizedRoster.value?.family==='rosters');
    const teams=fleetRows(roster.teams);assert.equal(teams.length,normalizedRoster.value.teams.length);
    for(const native of normalizedRoster.value.teams){const team=teams.find(item=>item.externalRosterId===native.externalRosterId);assert(team);const players=fleetRows(team.players);
      assert.deepEqual(players.map(item=>object(item.sourceEntity).nativeId),native.playerExternalIds);for(const player of players)assert.equal(player.seasonTeamId,team.seasonTeamId);
      const receipt=object(roster.receipt);const expected=projectCurrentRosterGroups(native,team.players as import('../lib/aggregator/contracts').RosterMembership[],String(receipt.id),(held.envelope as import('../lib/league-administration/contracts').AdministrationEnvelope).provenance);
      assert.equal(capacityDigest(team.currentGroups),capacityDigest(expected),'named roster groups differ from maintained projector');}
    const snapshot=object(row.snapshot),context=object(object(row.context).snapshot);assert.equal(snapshot.snapshotId,context.snapshotId);assert.equal(capacityDigest(snapshot.payload),capacityDigest(context.payload));
    assert.equal(snapshot.leagueSeasonId,enrollment.leagueSeasonId);assert.equal(snapshot.modelVersion,'clock-v1');assert.equal(snapshot.week,2);assert.equal(object(snapshot.payload).week,2);assert.equal(String(object(object(snapshot.payload).league).season),'2026');
  }
}

/** Rechecks immutable native capture lineage without making another provider or database call. */
export async function assertFleetEndpointLineage(row:Record<string,unknown>,responses:Map<string,Record<string,unknown>>,attempts:Map<string,Record<string,unknown>>,invocations:Record<string,unknown>[]){
 const record=object(row.record),response=responses.get(String(row.attemptId)),physical=attempts.get(String(row.attemptId));assert(response&&physical?.outcome==='success');assert.equal(response.endpointId,row.endpointId);numericSpan(row.readSpan);
 assert.equal(physical.owner,row.kind==='primary-catalog-cache'?'primary-projection':'data-refresh');
 const span=object(row.readSpan),time=(value:unknown)=>{const at=Date.parse(String(value));assert(Number.isFinite(at));return at;},same=(a:unknown,b:unknown)=>assert.equal(capacityDigest(a),capacityDigest(b));
 let sourceObservedAt:number,acceptedAt:number|null,captureStart:number;const {parsePublicCaptureWitness}=await import('../lib/league-administration/public-capture-witness');
 function acquisition(value:unknown,dispatchValue:unknown){const witness=parsePublicCaptureWitness(value),dispatch=object(dispatchValue);assert.equal(witness.work.requestId,row.requestId);same(witness.work,dispatch.work);assert.equal(witness.fence.workerId,dispatch.worker_id);assert.equal(witness.fence.generation,Number(dispatch.generation));assert.equal(witness.dispatchNonce,dispatch.capture_nonce);return witness;}
 function captured(payload:unknown,start:number,end:number,fence?:Record<string,unknown>){same(payload,JSON.parse(String(response!.rawUtf8)));assert(start<=Number(response!.requestStartedAt)&&Number(response!.responseCompletedAt)<=end);if(fence)assert.equal(invocations.filter(inv=>{const clock=object(inv.span);return inv.owner===physical!.owner&&Number(clock.startedAt)<=start&&end<=Number(clock.endedAt)&&time(fence.deadlineAt)===Number(clock.startedAt)+20_000;}).length,1);}
 if(row.kind==='primary-catalog-cache'){
  const slice=object(record.slice),read=object(record.read);assert.equal(read.complete,true);assert.equal(slice.status,'available');assert.equal(slice.complete,true);sourceObservedAt=time(slice.observedAt);acceptedAt=null;captureStart=Number(response.requestStartedAt);
  const {projectPlayerCatalog}=await import('../lib/sleeper-player-catalog');const projected=projectPlayerCatalog(JSON.parse(String(response.rawUtf8)));assert.equal(slice.sourceRevision,projected.sourceRevision);same([...(slice.playerIds as string[])].sort(),Object.keys(projected.catalog).sort());assert.equal(row.proofId,capacityDigest({endpoint:row.endpointId,slice}));assert(Number(response.responseCompletedAt)<=sourceObservedAt);
 }else if(row.kind==='player-directory-receipt'){
  const version=object(record.version),capture=object(record.capture),attempt=object(record.attempt),content=object(record.content),read=object(record.read);assert.equal(version.capture_id,capture.id);assert.equal(capture.id,row.proofId);assert.equal(capture.attempt_id,attempt.id);assert.equal(capture.content_id,content.id);assert.equal(capture.status,'complete');assert.equal(object(read.version).receiptId,capture.id);assert.equal(object(read.version).sourceRevision,content.source_revision);assert.equal(content.raw_json,response.rawUtf8);
  captureStart=time(capture.request_started_at);sourceObservedAt=time(capture.request_completed_at);assert.equal(time(capture.source_observed_at),sourceObservedAt);acceptedAt=time(version.accepted_at);captured(JSON.parse(String(content.raw_json)),captureStart,sourceObservedAt,object(attempt.write_fence));
 }else if(row.kind==='identity-observation'||row.kind==='league-list'){
  const stored=object(record.stored),outcome=object(record.outcome),witness=acquisition(outcome.capture_acquisition,record.dispatch);assert.equal(outcome.outcome,'checkpoint-committed');assert.equal(stored.intake_id,row.requestId);assert.equal(row.proofId,row.requestId);captureStart=time(stored.request_started_at);sourceObservedAt=time(stored.request_completed_at);acceptedAt=time(outcome.recorded_at);captured(stored.payload,captureStart,sourceObservedAt,witness.fence);
 }else if(record.capture){
  const capture=object(record.capture),content=object(record.content),outcome=object(record.outcome),witness=acquisition(outcome.capture_acquisition,record.dispatch);assert.equal(outcome.outcome,'checkpoint-committed');assert.equal(witness.work.kind,'users');assert.equal(capture.id,row.proofId);assert.equal(capture.intake_id,row.requestId);assert.equal(capture.content_id,content.id);assert.equal(content.family,'users');assert.equal(content.accepted,true);same(witness.mapping,capture.source_mapping);
  captureStart=time(capture.request_started_at);sourceObservedAt=time(capture.request_completed_at);assert.equal(time(capture.source_observed_at),sourceObservedAt);acceptedAt=time(capture.recorded_at);captured(content.payload,captureStart,sourceObservedAt,witness.fence);
 }else{
  const receipt=object(record.receipt),acceptance=object(record.acceptance),attempt=object(record.attempt),content=object(record.content),provenance=object(receipt.provenance),witness=acquisition(provenance.acquisition,record.dispatch);
  assert.equal(receipt.id,row.proofId);assert.equal(receipt.attempt_id,attempt.id);assert.equal(receipt.content_id,content.id);assert.equal(acceptance.receipt_id,receipt.id);assert.equal(acceptance.scope_id,attempt.scope_id);if(content.family!=='drafts')assert.equal(content.accepted,true);assert.equal(object(record.outcome).outcome,'checkpoint-committed');assert.equal(object(record.outcome).worker_id,object(record.dispatch).worker_id);assert.equal(object(record.outcome).generation,object(record.dispatch).generation);assert.equal(provenance.origin,'network');same(witness.fence,attempt.write_fence);same(witness.mapping,attempt.source_mapping);assert(Object.values(witness.attempts).some(item=>item?.id===attempt.id&&item.nonce===attempt.capture_nonce));
  const mapping=object(attempt.source_mapping);assert.equal(acceptance.source_mapping_revision_id,mapping.revisionId);assert.equal(content.league_season_id,mapping.leagueSeasonId);assert.equal(content.external_league_id,object(mapping.scope).externalLeagueId);
  captureStart=time(provenance.requestStartedAt);sourceObservedAt=time(provenance.requestCompletedAt);assert.equal(time(provenance.sourceObservedAt),sourceObservedAt);acceptedAt=time(acceptance.accepted_at);
  const draft=content.family==='drafts'?object(content.payload):null;const native=draft?(draft.kind==='catalog'?draft.catalog:draft.kind==='detail'?draft.draft:draft.kind==='selections'?draft.picks:draft.tradedPicks):content.payload;captured(native,captureStart,sourceObservedAt,witness.fence);await normalizedFleetReceipt(record);
 }
 assert(sourceObservedAt>=Number(response.responseCompletedAt)&&sourceObservedAt<=Number(span.endedAt));if(acceptedAt!==null)assert(acceptedAt>=sourceObservedAt-1&&acceptedAt<=Number(span.endedAt));return{sourceObservedAt,acceptedAt};
}
export async function normalizedFleetReceipt(row:Record<string,unknown>){
 const content=object(row.content),receipt=object(row.receipt),mapping=object(object(row.attempt).source_mapping);const {normalizeAdministrationObservation}=await import('../lib/league-administration/normalize');
 const normalized=normalizeAdministrationObservation({schemaVersion:'league-administration-v1',normalizerVersion:'sleeper-administration-v1',dialect:'sleeper-nfl-v1',scope:mapping.scope as import('../lib/league-administration/contracts').AdministrationEnvelope['scope'],family:content.family as import('../lib/league-administration/contracts').AdministrationEnvelope['family'],week:Number(content.week)===0&&!['matchups','transactions','weekly_report'].includes(String(content.family))?null:Number(content.week),completeness:content.completeness as 'complete',payload:content.payload as import('./freshness-capacity-manifest').JsonValue,provenance:receipt.provenance as import('../lib/league-administration/contracts').AdministrationEnvelope['provenance']},content.family==='rosters'?{expectedRosterCount:Number(receipt.expected_team_count)}:undefined);
 assert.equal(content.accepted,normalized.status==='accepted'&&content.completeness==='complete');assert.equal(normalized.contentHash,content.content_hash);assert.equal(normalized.semanticHash,content.semantic_hash);assert.equal(capacityDigest(normalized.value),capacityDigest(content.normalized_value));assert.equal(capacityDigest(normalized.diagnostics),capacityDigest(content.diagnostics));if(content.family==='drafts'){const payload=object(content.payload);const projected=payload.kind==='catalog'||payload.kind==='detail'?(await import('../lib/aggregator/draft-metadata')).projectDraftMetadata(normalized):payload.kind==='selections'?(await import('../lib/aggregator/draft-selections')).projectDraftSelections(normalized):(await import('../lib/aggregator/traded-picks')).projectTradedPicks(normalized);assert.equal(projected.status,'accepted');assert(projected.status==='accepted'&&projected.value.complete,'incomplete typed draft acceptance');}else assert.equal(normalized.status,'accepted');if(normalized.value?.family==='rosters'){const compare=(a:{externalRosterId:string},b:{externalRosterId:string})=>a.externalRosterId.localeCompare(b.externalRosterId);assert.equal(capacityDigest(row.typed_teams),capacityDigest([...normalized.value.teams].sort(compare)));assert.equal(capacityDigest(row.typed_managers),capacityDigest([...(normalized.teamManagers?.teams??[])].sort(compare)));}return normalized;
}
async function assertFleetCurrentIntakeRead(row:Record<string,unknown>,responses:Map<string,Record<string,unknown>>,attempts:Map<string,Record<string,unknown>>,invocations:Record<string,unknown>[]){
 const source=object(row.source),receipt=object(source.receipt),content=object(source.content),read=object(row.read);assert.equal(read.status,'available');assert.equal(object(read.receipt).id,receipt.id);assert.equal(object(read.accepted).contentId,content.id);assert.equal(object(read.accepted).sourceMappingRevisionId,object(source.acceptance).source_mapping_revision_id);assert.equal(content.external_league_id,row.nativeLeagueId);
 const provenance=object(receipt.provenance),start=Date.parse(String(provenance.requestStartedAt)),end=Date.parse(String(provenance.requestCompletedAt));const matched=[...responses.values()].filter(value=>value.nativeLeagueId===row.nativeLeagueId&&Number(value.requestStartedAt)>=start&&Number(value.responseCompletedAt)<=end&&capacityDigest(JSON.parse(String(value.rawUtf8)))===capacityDigest(content.payload));assert.equal(matched.length,1);const response=matched[0];
 await assertFleetEndpointLineage({requestId:object(source.dispatch).intake_id,endpointId:response.endpointId,proofId:receipt.id,attemptId:response.attemptId,kind:'resource-receipt',record:source,readSpan:row.span},responses,attempts,invocations);
 const normalized=await normalizedFleetReceipt(source),same=(a:unknown,b:unknown)=>assert.equal(capacityDigest(a),capacityDigest(b));if(row.kind==='settings'){assert.equal(normalized.leagueSettings?.status,'complete');same(read.value,normalized.leagueSettings!.value);return;}
 assert(['heldRoster','teamManagers'].includes(String(row.kind)));assert(normalized.value?.family==='rosters');const teams=fleetRows(read.teams);assert.equal(teams.length,normalized.value.teams.length);
 if(row.kind==='heldRoster'){const {projectCurrentRosterGroups}=await import('../lib/aggregator/current-roster-groups');for(const native of normalized.value.teams){const team=teams.find(item=>item.externalRosterId===native.externalRosterId);assert(team);const players=fleetRows(team.players);same(players.map(item=>object(item.sourceEntity).nativeId),native.playerExternalIds);same(team.currentGroups,projectCurrentRosterGroups(native,players as unknown as Parameters<typeof projectCurrentRosterGroups>[1],String(receipt.id),receipt.provenance as import('../lib/league-administration/contracts').AdministrationEnvelope['provenance']));}}
 else{assert(normalized.teamManagers?.teams);for(const native of normalized.teamManagers.teams){const team=teams.find(item=>object(item.sourceTeam).nativeId===native.externalRosterId);assert(team);const owner=object(team.primaryOwner),co=object(team.coManagers);assert.equal(owner.state,native.primaryOwner.state);assert.equal(owner.manager===null?null:object(object(owner.manager).sourceManager).nativeId,native.primaryOwner.externalManagerId);assert.equal(co.state,native.coManagers.state);same(co.managers===null?null:fleetRows(co.managers).map(item=>object(item.sourceManager).nativeId).sort(),native.coManagers.externalManagerIds===null?null:[...native.coManagers.externalManagerIds].sort());}}
}


/** The surrounding validator binds these rows to actual receipt-selected and current
 * maintained reads. Reproduce only the maintained weekly reader's canonical team
 * identity enrichment; all native report fields still come from its projector. */
export async function fleetWeeklyReportReaderValue(normalized:import('../lib/league-administration/contracts').NormalizedAdministrationObservation,rosterProof:Record<string,unknown>){
  const {projectWeeklyReport}=await import('../lib/aggregator/weekly-reports');
  const {parsePublicCaptureWitness}=await import('../lib/league-administration/public-capture-witness');
  const reportMapping=parsePublicCaptureWitness(normalized.envelope.provenance.acquisition).mapping;assert(reportMapping);
  const source=object(rosterProof.source),receipt=object(source.receipt),read=object(rosterProof.read),accepted=object(read.accepted),scope=object(accepted.scope);
  const rosterMapping=parsePublicCaptureWitness(object(receipt.provenance).acquisition).mapping;assert(rosterMapping);
  assert.equal(capacityDigest(reportMapping),capacityDigest(rosterMapping),'weekly report canonical mapping differs from roster');
  assert.equal(capacityDigest(reportMapping.scope),capacityDigest(normalized.envelope.scope));
  assert.equal(rosterProof.nativeLeagueId,reportMapping.scope.externalLeagueId);assert.equal(object(source.content).external_league_id,rosterProof.nativeLeagueId);
  assert.equal(read.status,'available');assert.equal(object(read.receipt).id,receipt.id);assert.equal(accepted.contentId,object(source.content).id);
  assert.equal(accepted.sourceMappingRevisionId,rosterMapping.revisionId);assert.equal(scope.leagueSeasonId,rosterMapping.leagueSeasonId);assert.equal(scope.connectionId,rosterMapping.connectionId);
  assert.equal(capacityDigest(object(source.attempt).source_mapping),capacityDigest(rosterMapping));
  const identities=new Map<string,string>(),canonical=new Set<string>();
  for(const team of fleetRows(read.teams)){
    assert(typeof team.externalRosterId==='string'&&/^[1-9][0-9]*$/u.test(team.externalRosterId));
    assert(typeof team.seasonTeamId==='string'&&/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/u.test(team.seasonTeamId));
    assert(!identities.has(team.externalRosterId)&&!canonical.has(team.seasonTeamId),'duplicate weekly canonical identity');
    identities.set(team.externalRosterId,team.seasonTeamId);canonical.add(team.seasonTeamId);
    for(const player of fleetRows(team.players)){assert.equal(player.seasonTeamId,team.seasonTeamId);assert.deepEqual(player.sourceTeam,{provider:'sleeper',resourceKind:'team',nativeNamespace:JSON.stringify(['nfl',reportMapping.scope.season,reportMapping.scope.externalLeagueId]),nativeId:team.externalRosterId});}
  }
  const projected=projectWeeklyReport(normalized);assert.equal(projected.status,'accepted');assert(projected.status==='accepted');
  return{...projected.value,teams:projected.value.teams.map(team=>{const seasonTeamId=identities.get(team.externalRosterId);assert(seasonTeamId,'unmapped weekly report team');return{...team,seasonTeamId};})};
}


export const FLEET_ANCILLARY_COMPONENTS = ['standings','exact-results','winners_bracket','losers_bracket'] as const;
type FleetAncillaryComponent = typeof FLEET_ANCILLARY_COMPONENTS[number];
/** Ceiling preserves PostgreSQL microseconds at an integer wall-clock boundary. */
export function fleetSqlEvidenceTime(value:unknown){assert(typeof value==='string');const ms=Date.parse(value);safeInteger(ms);const match=value.match(/\.(\d{1,6})(?:Z|[+-]\d{2}(?::?\d{2})?)$/u);const remainder=match?Number(match[1].padEnd(6,'0').slice(3)):0;return ms+(remainder>0?1:0);}
export type FleetAncillarySuccess = { receiptId:string; attemptId:string; sourceAt:number; acceptedAt:number; committedAt:number; confirmedAt:number };
/** Independent parent reduction: only a new physical capture can renew the clock.
 * A later confirmation cannot repair an interval that already exceeded fifteen minutes. */
export function assertFleetAncillaryChain(start:number,end:number,successes:readonly FleetAncillarySuccess[],options:{requirePrior?:boolean;freshSource?:boolean}={}) {
  safeInteger(start);safeInteger(end);assert(end>=start);
  const receipts=new Map<string,FleetAncillarySuccess>(),attempts=new Map<string,string>();
  const ordered=[...successes].sort((a,b)=>a.confirmedAt-b.confirmedAt);
  let previousSource=-Infinity;
  for(const row of ordered){
    for(const at of [row.sourceAt,row.acceptedAt,row.committedAt,row.confirmedAt])safeInteger(at);
    assert(row.sourceAt<=row.confirmedAt&&row.acceptedAt<=row.confirmedAt+1&&row.committedAt<=row.confirmedAt+1,'unconfirmed ancillary capture');
    assert(row.acceptedAt>=row.sourceAt-1&&row.committedAt>=row.acceptedAt-1,'ancillary acceptance chronology');
    if(row.confirmedAt<=end){assert(row.sourceAt>=previousSource,'ancillary current head regressed');previousSource=row.sourceAt;}
    const prior=receipts.get(row.receiptId);
    if(prior)assert.deepEqual([row.attemptId,row.sourceAt,row.acceptedAt,row.committedAt],[prior.attemptId,prior.sourceAt,prior.acceptedAt,prior.committedAt],'ancillary receipt changed');
    else{assert(!attempts.has(row.attemptId),'ancillary physical attempt reused');receipts.set(row.receiptId,row);attempts.set(row.attemptId,row.receiptId);}
  }
  const distinct=[...receipts.values()],prior=distinct.filter(row=>row.confirmedAt<=start&&row.sourceAt<=start&&row.acceptedAt<=start&&row.committedAt<=start).at(-1);
  let source:number|null=null;const gaps:number[]=[];
  if(options.requirePrior)assert(prior,'missing confirmed ancillary start');
  if(prior&&!options.freshSource){assert(start-prior.sourceAt<=900_000,'stale ancillary start');assert(prior.confirmedAt-prior.sourceAt<=900_000,'stale initial confirmation');source=prior.sourceAt;}
  const pending=distinct.filter(row=>row.confirmedAt>=start&&row.confirmedAt<=end&&row.acceptedAt<=end&&row.committedAt<=end&&(!options.freshSource||row.sourceAt>=start));
  for(const row of pending){if(row===prior&&options.requirePrior)continue;const gap=row.confirmedAt-(source??start);gaps.push(gap);
    assert(gap<=900_000,'ancillary successful-confirmation gap exceeds fifteen minutes');assert(row.confirmedAt-row.sourceAt<=900_000,'ancillary current proof is stale');source=row.sourceAt;}
  assert(source!==null,'no confirmed ancillary refresh');const tail=end-source;gaps.push(tail);assert(tail<=900_000,'ancillary trailing gap exceeds fifteen minutes');
  return{start,end,distinctCaptures:distinct.filter(row=>row.confirmedAt<=end).length,maximumGapMs:Math.max(0,...gaps),tailMs:tail};
}
/** Replay the exact maintained typed reader against retained query output. No SQL is executed. */
export async function replayFleetAncillaryQueries(component:FleetAncillaryComponent,mapping:import('../lib/league-administration/source-mapping').AdministrationSourceMapping,
  nativeWeek:number,receiptId:string,queries:Record<string,unknown>,expected:{current:unknown;retained:unknown;context:unknown},queryRows:ReadonlyMap<string,unknown>){
  assert(FLEET_ANCILLARY_COMPONENTS.includes(component));
  const {officialStandingsMethods,OFFICIAL_STANDINGS_SQL}=await import('../lib/league-administration/neon/official-standings');
  const {bracketMethods,ACCEPTED_BRACKET_SQL}=await import('../lib/league-administration/neon/brackets');
  const {exactMatchupValuesMethods,EXACT_MATCHUP_VALUES_SQL}=await import('../lib/league-administration/neon/exact-matchup-values');
  const {exactPeriodContextMethods,EXACT_PERIOD_CONTEXT_SQL}=await import('../lib/league-administration/neon/exact-period-context');
  const allowed=component==='standings'?OFFICIAL_STANDINGS_SQL:component==='exact-results'?EXACT_MATCHUP_VALUES_SQL:ACCEPTED_BRACKET_SQL;
  const same=(a:unknown,b:unknown)=>assert.equal(capacityDigest(a),capacityDigest(b));
  async function replay(name:'current'|'retained'|'context'){
    const rows=fleetRows(queries[name]);assert.equal(rows.length,1,'exactly one maintained ancillary query required');const transcript=rows[0];keys(transcript,['sql','params','rowsRef','span']);numericSpan(transcript.span);const retainedRows=queryRows.get(String(transcript.rowsRef));assert(Array.isArray(transcript.params)&&Array.isArray(retainedRows));assert.equal(capacityDigest(retainedRows),transcript.rowsRef);
    assert.equal(transcript.sql,name==='context'?EXACT_PERIOD_CONTEXT_SQL:allowed);let calls=0;
    const client:import('../lib/database').DatabaseClient={enabled:true,async query<Row extends import('../lib/database').DatabaseRow>(sql:string,params:readonly unknown[]=[]){calls++;assert.equal(calls,1);assert.equal(sql,transcript.sql);same(params,transcript.params);return structuredClone(retainedRows) as readonly Row[];}};
    const retained=name==='retained';const result=name==='context'?await exactPeriodContextMethods(client).readExactPeriodContext(mapping,{nativeWeek,matchupsReceiptId:receiptId})
      :component==='standings'?await officialStandingsMethods(client).readOfficialStandings(mapping,retained?{rosterReceiptId:receiptId}:{})
      :component==='exact-results'?await exactMatchupValuesMethods(client).readExactMatchupValues(mapping,{nativeWeek,...(retained?{matchupsReceiptId:receiptId}:{})})
      :await bracketMethods(client).readAcceptedBracket(mapping,{family:component,...(retained?{bracketReceiptId:receiptId}:{})});
    assert.equal(calls,1);assert.equal(result.status,'available','ancillary typed reader is not available');same(result,expected[name]);return result;
  }
  keys(queries,['current','retained','context']);const current=object(await replay('current')),retained=object(await replay('retained'));
  assert.equal(current.selection,'current');assert.equal(retained.selection,'receipt');
  const receipt=(value:Record<string,unknown>)=>component==='standings'?object(value.capture).rosterReceiptId:component==='exact-results'?value.matchupsReceiptId:value.bracketReceiptId;
  assert.equal(receipt(current),receiptId);assert.equal(receipt(retained),receiptId);
  let context:Record<string,unknown>|null=null;
  if(component==='exact-results'){context=object(await replay('context'));assert.equal(object(context.capture).matchupsReceiptId,receiptId);assert.equal(object(context.period).nativeWeek,nativeWeek);}
  else{assert.deepEqual(queries.context,[]);assert.equal(expected.context,null);}
  return{current,retained,context};
}


/** Ancillary evidence is mandatory in the new profiles, independently of worker summaries. */
export async function assertFleetAncillaryEvidence(input:{manifest:import('./freshness-capacity-manifest').CapacityManifest;recovery:import('./freshness-capacity-recovery').CapacityRecoveryManifest|null;
  evidence:Record<string,unknown>;lineage:Record<string,unknown>;reads:Record<string,unknown>;operations:Record<string,unknown>;primary:Record<string,unknown>;
  responses:Map<string,Record<string,unknown>>;attempts:Map<string,Record<string,unknown>>;invocations:Record<string,unknown>[]}){
  const{manifest,recovery,evidence,lineage,reads,operations,primary,responses,attempts,invocations}=input;
  const same=(a:unknown,b:unknown)=>assert.equal(capacityDigest(a),capacityDigest(b));
  const time=(value:unknown)=>{const at=Date.parse(String(value));safeInteger(at);return at;};
  const decoded=decodeFleetAncillaryBodies(lineage.ancillaryQueryRows,lineage.ancillaryProofs),queryRows=decoded.queryRows;
  const proofRows=fleetIndex(decoded.proofRows,'id'),proofs=new Map<string,{row:Record<string,unknown>;success:Omit<FleetAncillarySuccess,'confirmedAt'>}>();
  for(const[id,row]of proofRows){keys(row,['id','leagueKey','component','mapping','current','retained','context','source','queries']);const{id:ignored,...body}=row;void ignored;assert.equal(capacityDigest(body),id);
    const league=manifest.source.leagues.find(item=>item.key===row.leagueKey);assert(league);const component=row.component as FleetAncillaryComponent;assert(FLEET_ANCILLARY_COMPONENTS.includes(component));
    const source=object(row.source),record=object(source.record),content=object(record.content),receipt=object(record.receipt),acceptance=object(record.acceptance),outcome=object(record.outcome),mapping=object(row.mapping);
    assert.equal(content.family,component==='standings'?'rosters':component==='exact-results'?'matchups':component);assert.equal(content.external_league_id,league.nativeLeagueId);assert.equal(object(mapping.scope).externalLeagueId,league.nativeLeagueId);assert.equal(object(mapping.scope).season,2026);same(mapping,object(record.attempt).source_mapping);
    const response=responses.get(String(source.attemptId));assert(response);const endpoint=manifest.source.endpointInventory.find(item=>item.id===source.endpointId);assert(endpoint);assert.equal(endpoint.scope.nativeLeagueId,league.nativeLeagueId);
    assert.equal(endpoint.resource,component==='standings'?'rosters':component==='exact-results'?'matchups':component.replace('_','-'));if(component==='exact-results')assert.equal(endpoint.scope.nativeWeek,Number(league.nativePeriod));
    await assertFleetEndpointLineage(source,responses,attempts,invocations);
    await replayFleetAncillaryQueries(component,mapping as unknown as import('../lib/league-administration/source-mapping').AdministrationSourceMapping,Number(league.nativePeriod),String(receipt.id),object(row.queries),{current:row.current,retained:row.retained,context:row.context},queryRows);
    const sourceAt=Number(response.responseCompletedAt),acceptedAt=fleetSqlEvidenceTime(acceptance.accepted_at),committedAt=fleetSqlEvidenceTime(outcome.recorded_at);safeInteger(sourceAt);assert.equal(outcome.outcome,'checkpoint-committed');
    const currentQueries=[...fleetRows(object(row.queries).current),...fleetRows(object(row.queries).context)];const confirmedAt=Number(numericSpan(source.readSpan).endedAt);for(const query of currentQueries)numericSpan(query.span);
    assert(sourceAt<=confirmedAt&&acceptedAt<=confirmedAt+1&&committedAt<=confirmedAt+1,'ancillary current read preceded durable success');
    proofs.set(id,{row,success:{receiptId:String(receipt.id),attemptId:String(source.attemptId),sourceAt,acceptedAt,committedAt}});
  }
  const requests=fleetIndex(fleetRows(lineage.ancillaryRequests),'cohort');assert.deepEqual([...requests.keys()].sort(),['accepted','intake-a','intake-b']);
  const operationRows=fleetRows(operations.operations);
  for(const[cohort,row]of requests){keys(row,['cohort','requestId']);assert.match(String(row.requestId),/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/iu);
    if(recovery){const target=fleetRows(object(evidence.queue).targets).find(item=>item.cohort===cohort);assert(target);assert.equal(object(target.input).identityRequestId,row.requestId);}
    else if(cohort==='accepted'){const submitted=fleetRows(primary.setup).filter(item=>item.operation==='initial-submit');assert.equal(submitted.length,1);assert.equal(submitted[0].requestId,row.requestId);assert.equal(object(submitted[0].receipt).status,'retained');}
    else{const submitted=operationRows.filter(item=>item.operation==='submission/'+cohort);assert.equal(submitted.length,1);assert.equal(object(submitted[0].outcome).requestId,row.requestId);assert.equal(object(submitted[0].outcome).status,'retained');}
  }
  assert.equal(new Set([...requests.values()].map(row=>row.requestId)).size,3);
  const anchors=new Map<string,Record<string,unknown>>();const {CAPACITY_ANCILLARY_FIRST_RECEIPT_SQL,CAPACITY_ANCILLARY_HEADS_SQL}=await import('./freshness-capacity-observer');
  const mainAcceptances=fleetRows(recovery?evidence.initial:evidence.firstAcceptances),mainFor=(key:string,component:FleetAncillaryComponent)=>{
    const pairId=key+(component==='standings'?'/rosters':'/lineups'),row=mainAcceptances.find(item=>item.pairId===pairId);assert(row);return row;};
  for(const anchor of fleetRows(lineage.ancillaryAnchors)){keys(anchor,['leagueKey','component','kind','at','requestId','receiptId','query']);const league=manifest.source.leagues.find(item=>item.key===anchor.leagueKey),planned=manifest.plan.leagues.find(item=>item.key===anchor.leagueKey);assert(league&&planned);const component=anchor.component as FleetAncillaryComponent;assert(FLEET_ANCILLARY_COMPONENTS.includes(component));const key=league.key+'/'+component;assert(!anchors.has(key));anchors.set(key,anchor);safeInteger(Number(anchor.at));assert.equal(anchor.requestId,requests.get(planned.cohort)!.requestId);
    if(!recovery&&planned.cohort==='accepted'){assert.equal(anchor.kind,'benchmark');assert.equal(anchor.at,evidence.startedAt);assert.equal(anchor.receiptId,null);assert.equal(anchor.query,null);}
    else if(component==='standings'||component==='exact-results'){const main=mainFor(league.key,component),read=object(main.read);assert.equal(anchor.kind,'pair-first-read');assert.equal(anchor.at,recovery?read.at:main.at);assert.equal(anchor.receiptId,String(read.originObservationId).split('/')[0]);assert.equal(anchor.query,null);}
    else{assert.equal(anchor.kind,'initial-request-first-receipt');const query=object(anchor.query);keys(query,['sql','params','rowsRef','span']);assert.equal(query.sql,CAPACITY_ANCILLARY_FIRST_RECEIPT_SQL);same(query.params,[anchor.requestId,league.nativeLeagueId,component]);const rows=fleetRows(queryRows.get(String(query.rowsRef)));assert.equal(rows.length,1);numericSpan(query.span);const record=rows[0],receipt=object(record.receipt),content=object(record.content),provenance=object(receipt.provenance);
      assert.equal(receipt.id,anchor.receiptId);assert.equal(object(record.dispatch).intake_id,anchor.requestId);assert.equal(content.family,component);assert.equal(content.external_league_id,league.nativeLeagueId);assert.equal(time(object(record.acceptance).accepted_at),anchor.at);
      const matched=[...responses.values()].filter(row=>row.nativeLeagueId===league.nativeLeagueId&&row.resource===component.replace('_','-')&&Number(row.requestStartedAt)>=time(provenance.requestStartedAt)&&Number(row.responseCompletedAt)<=time(provenance.requestCompletedAt)&&capacityDigest(JSON.parse(String(row.rawUtf8)))===capacityDigest(content.payload));assert.equal(matched.length,1,'ambiguous initial bracket capture');const response=matched[0];
      await assertFleetEndpointLineage({requestId:anchor.requestId,endpointId:response.endpointId,proofId:receipt.id,attemptId:response.attemptId,kind:'resource-receipt',record,readSpan:query.span},responses,attempts,invocations);
      assertFleetAncillaryAnchorJournal(anchor,'ancillary-anchor/'+league.key+'/'+component,operationRows,queryRows);
    }
  }
  assert.equal(anchors.size,manifest.source.leagues.length*4,'missing fixed ancillary anchor');
  const successes=new Map<string,FleetAncillarySuccess[]>(),observations=fleetRows(reads.ancillaryReads),seenSlots=new Set<string>(),lastConfirmedHeads=new Map<string,string>();
  const t0=Number(evidence.startedAt)-(recovery?0:FLEET_HEALTHY_CLOCK.benchmarkOffsetMs),endedAt=Number(evidence.endedAt);safeInteger(t0);safeInteger(endedAt);
  const leagueEnds=new Map(manifest.source.leagues.map(league=>[league.key,recovery?endedAt:fleetAncillaryHealthyEnd(Number(evidence.startedAt),manifest.plan.leagues.find(planned=>planned.key===league.key)!.cohort,manifest.plan.pairs.filter(pair=>pair.leagueKey===league.key).map(pair=>{const accepted=mainAcceptances.find(row=>row.pairId===pair.id);assert(accepted);return Number(accepted.at);}))]));
  assertFleetAncillarySchedule(t0,[...leagueEnds].map(([leagueKey,endAt])=>({leagueKey,endAt})),observations.map(row=>({leagueKey:String(row.leagueKey),scheduledAt:Number(row.scheduledAt)})),!recovery);
  const {composeOfficialResults}=await import('../lib/aggregator/official-results');
  for(const read of observations){keys(read,['leagueKey','scheduledAt','span','components','componentSpans','currentQueries','unavailable','heads','unchanged','composed']);for(const field of ['componentSpans','currentQueries','unavailable'])assert(Object.keys(object(read[field])).every(key=>FLEET_ANCILLARY_COMPONENTS.includes(key as FleetAncillaryComponent)));const league=manifest.source.leagues.find(item=>item.key===read.leagueKey);assert(league);safeInteger(Number(read.scheduledAt));assert(Number(read.scheduledAt)>=t0&&Number(read.scheduledAt)<=endedAt&&((Number(read.scheduledAt)-t0)%60_000===0||!recovery&&read.scheduledAt===leagueEnds.get(league.key)),'unfrozen ancillary slot');const slot=league.key+'/'+read.scheduledAt;assert(!seenSlots.has(slot),'replaced ancillary slot');seenSlots.add(slot);const span=numericSpan(read.span);assert(Number(span.endedAt)<=endedAt);const components=object(read.components);keys(components,[...FLEET_ANCILLARY_COMPONENTS]);
    const unchanged=read.unchanged;assert(Array.isArray(unchanged)&&new Set(unchanged).size===unchanged.length&&unchanged.every(component=>FLEET_ANCILLARY_COMPONENTS.includes(component)));for(const component of unchanged)assert.equal(components[component],null,'unchanged hint cannot fabricate current proof');if(unchanged.length){assert.equal(unchanged.length,4);assert(read.heads!==null);assert.deepEqual(read.currentQueries,{});assert.deepEqual(read.componentSpans,{});assert.equal(read.composed,null);}
    if(read.heads!==null){const head=object(read.heads);keys(head,['sql','params','rowsRef','span']);assert.equal(head.sql,CAPACITY_ANCILLARY_HEADS_SQL);same(head.params,[league.nativeLeagueId,Number(league.nativePeriod)]);assert(queryRows.has(String(head.rowsRef)));const clock=numericSpan(head.span);assert(Number(clock.startedAt)>=Number(span.startedAt)&&Number(clock.endedAt)<=Number(span.endedAt));}
    const available=new Map<FleetAncillaryComponent,Record<string,unknown>>();
    for(const component of FLEET_ANCILLARY_COMPONENTS){const id=components[component];if(id===null)continue;assert(typeof id==='string');const proof=proofs.get(id);assert(proof&&proof.row.leagueKey===league.key&&proof.row.component===component);const componentSpan=numericSpan(object(read.componentSpans)[component]);assert(Number(componentSpan.startedAt)>=Number(span.startedAt)&&Number(componentSpan.endedAt)<=Number(span.endedAt));
      assert(Number(span.startedAt)>=Number(read.scheduledAt)&&Number(span.startedAt)<=Number(read.scheduledAt)+manifest.plan.sampleDispatchLatenessMs);assert(Number(span.endedAt)<=Number(read.scheduledAt)+manifest.plan.sampleTimeoutMs);
      const transcripts=[...fleetRows(object(proof.row.queries).current),...fleetRows(object(proof.row.queries).context)],actual=fleetRows(object(read.currentQueries)[component]);assert.equal(actual.length,transcripts.length);
      for(let i=0;i<actual.length;i++){keys(actual[i],['digest','span']);const expected=transcripts[i];assert.equal(actual[i].digest,capacityDigest({sql:expected.sql,params:expected.params,rowsRef:expected.rowsRef}));const clock=numericSpan(actual[i].span);assert(Number(clock.startedAt)>=Number(componentSpan.startedAt)&&Number(clock.endedAt)<=Number(componentSpan.endedAt));}
      const confirmedAt=Number(componentSpan.endedAt);assert(proof.success.committedAt<=confirmedAt+1&&proof.success.acceptedAt<=confirmedAt+1);
      const key=league.key+'/'+component;successes.set(key,[...(successes.get(key)??[]),{...proof.success,confirmedAt}]);available.set(component,proof.row);
    }
    if(available.size===4){const values=Object.fromEntries(available);const composed=composeOfficialResults({mapping:values.standings.mapping,standings:values.standings.current,periods:[{nativeWeek:Number(league.nativePeriod),values:values['exact-results'].current,context:values['exact-results'].context}],brackets:(['winners_bracket','losers_bracket']as const).map(family=>({family,resource:values[family].current}))} as unknown as import('../lib/aggregator/official-results').OfficialResultsInput);assert.equal(composed.status,'available');keys(object(read.composed),['status','digest']);assert.equal(object(read.composed).status,'available');assert.equal(object(read.composed).digest,capacityDigest(composed));
      const componentSuccesses=FLEET_ANCILLARY_COMPONENTS.map(component=>successes.get(league.key+'/'+component)!.at(-1)!);
      const combined:FleetAncillarySuccess={receiptId:capacityDigest(componentSuccesses.map(row=>row.receiptId)),attemptId:capacityDigest(componentSuccesses.map(row=>row.attemptId)),sourceAt:Math.min(...componentSuccesses.map(row=>row.sourceAt)),acceptedAt:Math.max(...componentSuccesses.map(row=>row.acceptedAt)),committedAt:Math.max(...componentSuccesses.map(row=>row.committedAt)),confirmedAt:Number(span.endedAt)};
      const key=league.key+'/official-results';successes.set(key,[...(successes.get(key)??[]),combined]);}
    else assert.equal(read.composed,null,'composition cannot hide missing current components');
    const nextHeads=fleetAncillaryHeadTransition(lastConfirmedHeads.get(league.key)??null,{rowsRef:read.heads===null?null:String(object(read.heads).rowsRef),unchanged:unchanged.length>0,unavailable:Object.keys(object(read.unavailable)).length>0,confirmed:available.size===4});if(nextHeads!==null)lastConfirmedHeads.set(league.key,nextHeads);
  }
  const reports:Record<string,unknown>[]=[];
  for(const league of manifest.source.leagues){const planned=manifest.plan.leagues.find(row=>row.key===league.key)!;
    const pairAnchors=manifest.plan.pairs.filter(pair=>pair.leagueKey===league.key).map(pair=>{const row=mainAcceptances.find(item=>item.pairId===pair.id);assert(row);return Number(recovery?object(row.read).at:planned.cohort==='accepted'?evidence.startedAt:row.at);});
    const end=recovery?endedAt:fleetAncillaryHealthyEnd(Number(evidence.startedAt),planned.cohort,pairAnchors);assert(endedAt>=end,'truncated ancillary interval');
    const final=recovery?observations.filter(row=>row.leagueKey===league.key&&Number(row.scheduledAt)<=end).sort((a,b)=>Number(a.scheduledAt)-Number(b.scheduledAt)).at(-1):observations.find(row=>row.leagueKey===league.key&&row.scheduledAt===end);
    assert(final,'missing frozen ancillary end read');const boundaryAt=Number(final.scheduledAt),boundarySpan=numericSpan(final.span);assert(boundaryAt<=end&&end-boundaryAt<=manifest.plan.sampleTimeoutMs,'unobserved ancillary end');
    assert(Number(boundarySpan.startedAt)>=boundaryAt&&Number(boundarySpan.startedAt)<=boundaryAt+manifest.plan.sampleDispatchLatenessMs&&Number(boundarySpan.endedAt)<=boundaryAt+manifest.plan.sampleTimeoutMs);
    for(const component of FLEET_ANCILLARY_COMPONENTS){const id=object(final.components)[component];assert(typeof id==='string','missing typed ancillary end component');const success=proofs.get(id)!.success;assert(end-success.sourceAt<=900_000,'stale current ancillary end');}
    if(!recovery&&planned.cohort==='accepted'){const boundary=observations.find(row=>row.leagueKey===league.key&&row.scheduledAt===evidence.startedAt);assert(boundary&&FLEET_ANCILLARY_COMPONENTS.every(component=>object(boundary.components)[component]!==null),'missing fixed benchmark current proof');}
    for(const component of [...FLEET_ANCILLARY_COMPONENTS,'official-results']as const){const key=league.key+'/'+component,anchor=component==='official-results'?{at:Math.max(...FLEET_ANCILLARY_COMPONENTS.map(part=>Number(anchors.get(league.key+'/'+part)!.at)))}:anchors.get(key)!,rows=successes.get(key)??[];
      if(!recovery)reports.push({leagueKey:league.key,component,...assertFleetAncillaryChain(Number(anchor.at),end,rows,{requirePrior:planned.cohort==='accepted'})});
      else{const outage=object(evidence.outage),cutoff=Number(evidence.startedAt)+60*60_000,restored=Math.max(Number(outage.dependencyRestoredAt),Number(outage.runnerRestoredAt));safeInteger(restored);assert(Number(anchor.at)<=cutoff,'initial ancillary acceptance missed fixed outage');
        const before=assertFleetAncillaryChain(Number(anchor.at),cutoff,rows);const after=assertFleetAncillaryChain(restored,end,rows,{freshSource:true});reports.push({leagueKey:league.key,component,before,outage:{startedAt:Number(outage.startedAt),restoredAt:restored,excludedFromHealthyCadence:true},after});}
    }
  }
  return{policy:'cp1-active-ancillary-fifteen-minute-v1',sourceLimitMs:900_000,metadataPolicy:'existing-daily-applicability',reports};
}


/** Every scheduled observation is retained, including absent, unavailable and unchanged heads. */
export function assertFleetAncillarySchedule(start:number,ends:readonly {leagueKey:string;endAt:number}[],rows:readonly {leagueKey:string;scheduledAt:number}[],exactEnds:boolean){
  safeInteger(start);const expected=new Set<string>();assert.equal(new Set(ends.map(row=>row.leagueKey)).size,ends.length);
  for(const row of ends){safeInteger(row.endAt);assert(row.endAt>=start&&row.endAt-start<=340*60_000,'invalid ancillary horizon');for(let at=start;at<=row.endAt;at+=60_000)expected.add(row.leagueKey+'/'+at);if(exactEnds)expected.add(row.leagueKey+'/'+row.endAt);}
  const actual=rows.map(row=>row.leagueKey+'/'+row.scheduledAt);assert.equal(new Set(actual).size,actual.length,'duplicate ancillary observation');assert.deepEqual([...actual].sort(),[...expected].sort(),'incomplete fixed ancillary observation inventory');
}


export function fleetAncillaryHealthyEnd(benchmark:number,cohort:'accepted'|'intake-a'|'intake-b',firstReads:readonly number[]){
  safeInteger(benchmark);assert.equal(firstReads.length,4);firstReads.forEach(safeInteger);return(cohort==='accepted'?benchmark:Math.max(...firstReads))+FLEET_HEALTHY_CLOCK.pairHorizonMs;
}

/** A small head query is only a skip hint after the same heads had real typed confirmation. */
export function fleetAncillaryHeadTransition(previous:string|null,row:{rowsRef:string|null;unchanged:boolean;unavailable:boolean;confirmed:boolean}):string|null{
  if(row.unchanged){assert(previous!==null&&row.rowsRef===previous,'unchanged ancillary heads were not previously confirmed');assert(!row.unavailable&&!row.confirmed,'unchanged ancillary observation contains a failure or confirmation');return previous;}
  return row.confirmed&&row.rowsRef!==null?row.rowsRef:previous;
}

/** Artifact-only lossless encoding. These bounds do not increase the outer artifact limits. */
export const FLEET_ANCILLARY_DECODE_LIMITS=Object.freeze({bodyBytes:4*1024*1024,totalBytes:512*1024*1024});
export function decodeFleetAncillaryBodies(queryValues:unknown,proofValues:unknown){
  const queries=fleetRows(queryValues),proofs=fleetRows(proofValues),all=[...queries,...proofs];assert(all.length<=FLEET_EVIDENCE_LIMITS.maxRows);
  let total=0;
  // Validate the entire declared allocation budget before inflating the first body.
  for(const row of all){keys(row,['id','encoding','decodedBytes','decodedSha256','data']);assert.equal(row.encoding,'deflate-json-v1');assert.match(String(row.id),/^[a-f0-9]{64}$/u);assert.match(String(row.decodedSha256),/^[a-f0-9]{64}$/u);
    assert(typeof row.decodedBytes==='number');safeInteger(row.decodedBytes);assert(Number(row.decodedBytes)>0&&Number(row.decodedBytes)<=FLEET_ANCILLARY_DECODE_LIMITS.bodyBytes,'oversized decoded ancillary body');total+=Number(row.decodedBytes);assert(total<=FLEET_ANCILLARY_DECODE_LIMITS.totalBytes,'aggregate decoded ancillary size exceeded');
    assert(typeof row.data==='string'&&row.data.length>0&&row.data.length<=4*Math.ceil(FLEET_ANCILLARY_DECODE_LIMITS.bodyBytes/3));assert.match(row.data,/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u);
  }
  function decode(row:Record<string,unknown>){
    const compressed=Buffer.from(String(row.data),'base64');assert(compressed.length>0&&compressed.length<=FLEET_ANCILLARY_DECODE_LIMITS.bodyBytes);assert.equal(compressed.toString('base64'),row.data,'noncanonical ancillary base64');
    const result=inflateRawSync(compressed,{maxOutputLength:Number(row.decodedBytes),info:true}) as unknown as {buffer:Buffer;engine:{bytesWritten:number}};
    assert.equal(result.engine.bytesWritten,compressed.length,'trailing ancillary compressed bytes');assert.equal(result.buffer.length,row.decodedBytes,'ancillary decoded byte mismatch');assert.equal(hash(result.buffer),row.decodedSha256,'ancillary decoded hash mismatch');
    const text=new TextDecoder('utf-8',{fatal:true}).decode(result.buffer),value:unknown=JSON.parse(text);assertJsonValue(value);assert.equal(JSON.stringify(value),text,'noncanonical ancillary JSON');assert.equal(capacityDigest(value),row.id,'ancillary content ID mismatch');return value;
  }
  const queryRows=new Map<string,unknown>();for(const row of queries){assert(!queryRows.has(String(row.id)),'duplicate ancillary query body');const value=decode(row);assert(Array.isArray(value));queryRows.set(String(row.id),value);}
  const proofRows:Record<string,unknown>[]=[],ids=new Set<string>();for(const row of proofs){assert(!ids.has(String(row.id)),'duplicate ancillary proof body');ids.add(String(row.id));const value=object(decode(row));assert(!Object.hasOwn(value,'id'));proofRows.push({id:row.id,...value});}
  return{queryRows,proofRows,decodedBytes:total};
}

/** Pending anchors retain the earliest receipt; checkpoint completion may change only its outcome. */
export function assertFleetAncillaryAnchorJournal(anchor:Record<string,unknown>,operation:string,journal:readonly Record<string,unknown>[],queryRows:ReadonlyMap<string,unknown>){
  const finalQuery=object(anchor.query),finalRows=fleetRows(queryRows.get(String(finalQuery.rowsRef)));assert.equal(finalRows.length,1);const final=finalRows[0],finalOutcome=object(final.outcome),finalSpan=numericSpan(finalQuery.span);
  assert.equal(finalOutcome.outcome,'checkpoint-committed');const entries=journal.filter(row=>row.operation===operation);assert(entries.length>0,'missing ancillary anchor journal');let finalSeen=false;
  for(const entry of entries){keys(entry,['operation','span','outcome']);const outcome=object(entry.outcome);keys(outcome,['status','receiptId','acceptedAt','requestId','query']);assert.equal(outcome.receiptId,anchor.receiptId);assert.equal(outcome.requestId,anchor.requestId);assert.equal(outcome.acceptedAt,object(final.acceptance).accepted_at);
    const query=object(outcome.query);keys(query,['sql','params','rowsRef','span']);assert.equal(query.sql,finalQuery.sql);assert.equal(capacityDigest(query.params),capacityDigest(finalQuery.params));const span=numericSpan(query.span);assert.equal(capacityDigest(span),capacityDigest(entry.span));assert(Number(span.endedAt)<=Number(finalSpan.endedAt));
    const rows=fleetRows(queryRows.get(String(query.rowsRef)));assert.equal(rows.length,1);const acceptedAt=fleetSqlEvidenceTime(object(rows[0].acceptance).accepted_at),sourceCompletedAt=Date.parse(String(object(object(rows[0].receipt).provenance).requestCompletedAt));safeInteger(sourceCompletedAt);assert(acceptedAt<=Number(span.endedAt)+1,'ancillary anchor query preceded acceptance');assert(sourceCompletedAt<=Number(span.endedAt),'ancillary anchor query preceded source completion');const{outcome:actualOutcome,...body}=rows[0],{outcome:ignored,...expected}=final;void ignored;assert.equal(capacityDigest(body),capacityDigest(expected),'earliest ancillary anchor row changed');
    if(outcome.status==='pending-checkpoint')assert.equal(actualOutcome,null);else{assert.equal(outcome.status,'checkpoint-committed');assert.equal(capacityDigest(actualOutcome),capacityDigest(finalOutcome));if(capacityDigest(query)===capacityDigest(finalQuery))finalSeen=true;}
  }
  assert(finalSeen,'final ancillary anchor checkpoint query absent');
}
