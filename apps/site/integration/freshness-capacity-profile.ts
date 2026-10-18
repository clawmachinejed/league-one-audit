import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { deflateRawSync, inflateRawSync } from 'node:zlib';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { lstat, readFile, readdir, writeFile, realpath } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { bindCapacityManifest, capacityDigest, type ReaderExpectation } from './freshness-capacity-manifest';


export const FLEET_OWNERSHIP_PROFILE = 'data-freshness-capacity-ownership-v1';
export const FLEET_OWNERSHIP_MODULE = 'integration/freshness-capacity-ownership.qualification-case.ts';
export const FLEET_OWNERSHIP_SUITE = 'current DATA batch ownership and recovery through independent runtime sessions';
export const FLEET_OWNERSHIP_TESTS = [
  'retains a committed resource selection across competing ownership and hard death',
  'retains an admitted request charge across death before native fetch',
  'retains both accepted core captures across death before the durable checkpoint',
  'recovers a committed batch advancement whose acknowledgment was withheld',
  'revalidates revoked authority after actual budget backoff and denies unauthorized SQL',
] as const;
export const FLEET_OWNERSHIP_FULL_NAMES = FLEET_OWNERSHIP_TESTS.map(name=>FLEET_OWNERSHIP_SUITE+' > '+name);
export const FLEET_LIVE_PROFILE = 'data-live-public-batch-v1';
export const FLEET_LIVE_MODULE = 'integration/freshness-capacity-live.qualification-case.ts';
export const FLEET_LIVE_SUITE = 'live public DATA discovery and core readback through the selected batch runtime';
export const FLEET_LIVE_TESTS = [
  'retains the complete authorized 2026 discovery through three fixed batch invocation slots',
  'verifies original live core receipts canonical identities and stored-only readback',
  'reconciles complete live evidence and actual process cleanup',
] as const;
export const FLEET_LIVE_FULL_NAMES = FLEET_LIVE_TESTS.map(name=>FLEET_LIVE_SUITE+' > '+name);
export const FLEET_OWNERSHIP_SCENARIOS = ['selection-competition-death','admitted-before-fetch-death',
  'accepted-before-checkpoint-death','advance-unknown-ack-death','backoff-authority-and-acl'] as const;
export const FLEET_OWNERSHIP_OFFSETS = Object.freeze([0,61_000,122_000,122_000,183_000,244_000,305_000,546_000,607_000,668_000,729_000,790_000,851_000]);
export const FLEET_SHORT_CLOCK = Object.freeze({workMs:30*60_000,lifecycleMs:40*60_000,expiryMs:60*60_000,
  admissionMs:10_000,workWindowMs:20_000,cleanupMs:22_000,leaseMs:25_000,maxOwnershipSlots:15});
/** A live acquisition policy is a bounded request plan, never authored provider response evidence. */
export const FLEET_LIVE_POLICY = Object.freeze({kind:'cp26-live-acquisition-policy-v1',username:'ClawMachineJedi',
  nativeManagerId:'862823517857697792',season:2026,origin:'https://api.sleeper.app',method:'GET',
  minimumLeagues:1,maximumLeagues:4,maximumHttp:18,bodyBytes:1024*1024,totalBodyBytes:18*1024*1024,
  slotOffsetsMs:Object.freeze([0,61_000,122_000]),dispatchAllowanceMs:1_000,
  discoveryRule:'complete-original-sealed-unique-native-inventory-before-core-fanout',
  routes:Object.freeze(['/v1/user/ClawMachineJedi','/v1/user/862823517857697792/leagues/nfl/2026',
    '/v1/league/{discoveredNativeId}','/v1/league/{discoveredNativeId}/rosters','/v1/league/{discoveredNativeId}/users'])} as const);

export const FLEET_DAILY_PROFILE = 'data-freshness-capacity-daily-v1';
export const FLEET_DAILY_MODULE = 'integration/freshness-capacity-daily.qualification-case.ts';
export const FLEET_DAILY_SUITE = 'daily DATA source refresh and inactive league correction through the production facade';
export const FLEET_DAILY_TESTS = [
  'runs the fixed daily workload through the existing facade with original lifecycle authority',
  'verifies actual daily resource clocks complete corrections and provider-compliant catalog scheduling',
  'reconciles immutable evidence and actual cleanup without claiming active freshness percentiles',
] as const;
export const FLEET_DAILY_FULL_NAMES = FLEET_DAILY_TESTS.map(name=>FLEET_DAILY_SUITE+' > '+name);
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
  assert(FLEET_EVIDENCE_STREAMS.includes(stream)); return documentRows(stream,value);
}
function documentRows<S extends string>(stream:S,value:unknown):{stream:S;sequence:number;value:FleetDocumentPart}[] {
  assertJsonValue(value);
  const bytes=Buffer.from(JSON.stringify(value),'utf8'); assert(bytes.length>0&&bytes.length<=FLEET_EVIDENCE_LIMITS.totalBytes);
  const partBytes=FLEET_DOCUMENT_LIMITS.partBytes, parts=Math.ceil(bytes.length/partBytes), documentSha256=hash(bytes);
  return Array.from({length:parts},(_,index)=>{const raw=bytes.subarray(index*partBytes,Math.min((index+1)*partBytes,bytes.length)),compressed=deflateRawSync(raw);assert(compressed.length<=FLEET_DOCUMENT_LIMITS.compressedPartBytes);
    return{stream,sequence:index+1,value:{kind:'cp26-json-document-part-deflate-v1',documentSha256,documentBytes:bytes.length,parts,index,partBytes:raw.length,partSha256:hash(raw),bytesBase64:compressed.toString('base64')} satisfies FleetDocumentPart};});
}
/** All declared streams are required; hashes never substitute for semantic qualification. */
function reassembleDocuments<S extends string>(rows:readonly {stream:S;sequence:number;value:unknown}[],streams:readonly S[]):Record<S,unknown> {
  const result={} as Record<S,unknown>;
  assert(rows.length>0&&rows.length<=FLEET_EVIDENCE_LIMITS.maxRows);for(const row of rows)assert(streams.includes(row.stream),'unknown document stream');
  const documents=new Map<S,FleetDocumentPart[]>();let decodedTotal=0;
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
  'lib/league-administration/neon/exact-period-context.ts','lib/aggregator/official-results.ts','lib/league-administration/neon/player-directory.ts'] as const;
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

/** Daily changes only the declared source state and observation clock; retained binding readers stay shared. */
export async function buildFleetDailyManifest(input:Parameters<typeof buildFleetHealthyManifest>[0]) {
  const {fixture,manifest:observerManifest,sourceFiles}=await buildFleetHealthyManifest(input);
  const {createCapacityDailyManifest}=await import('./freshness-capacity-daily');const source=observerManifest.source;
  const dailyManifest=createCapacityDailyManifest(fixture,{readinessContractSha256:source.readinessContractSha256,acceptanceContractSha256:source.acceptanceContractSha256,
    plannedPostgresqlVersion:source.plannedPostgresqlVersion,gitSha:source.gitSha,appTreeSha:source.appTreeSha,requestBudgetPolicy:source.requestBudgetPolicy!,
    readerQueryMixSha256:source.readerQueryMixSha256,requestOwners:source.requestOwners,observerManifestDigest:observerManifest.digest});
  return{fixture,observerManifest,dailyManifest,sourceFiles};
}
export async function fleetDailyWindow(invocationStartedAt:number,supervisedWorkDeadlineAt:number){
  safeInteger(invocationStartedAt);safeInteger(supervisedWorkDeadlineAt);const{DAILY_CLOCK}=await import('./freshness-capacity-daily');
  assert(supervisedWorkDeadlineAt-invocationStartedAt>=DAILY_CLOCK.minimumRemainingWorkMs,'Insufficient original supervised work budget for daily observation');
  assert(supervisedWorkDeadlineAt-invocationStartedAt<=DAILY_CLOCK.workMs,'Daily work budget was rebased or extended');
  return{invocationStartedAt,observationEndsAt:invocationStartedAt+DAILY_CLOCK.observationMs,workDeadlineAt:supervisedWorkDeadlineAt};
}

import type { FleetConfig, FleetMessage, FleetSpan, FleetSqlAttempt } from './freshness-capacity-protocol';
import type { QualificationBinding } from './qualification-profile';

export type FleetCompanion = { kind:'cp26-fleet-healthy-evidence-v1'|'cp26-fleet-recovery-evidence-v1'|'cp26-fleet-daily-evidence-v1'; contextDigest:string;
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
  const recovery=config.profile===FLEET_RECOVERY_PROFILE,daily=config.profile===FLEET_DAILY_PROFILE;assert.equal(row.kind,daily?'cp26-fleet-daily-evidence-v1':recovery?'cp26-fleet-recovery-evidence-v1':'cp26-fleet-healthy-evidence-v1');
  assert.equal(row.rawDirectory,'fleet-raw-'+config.nonce);assert.equal(row.finalDirectory,'fleet-final-'+config.nonce);
  assert.equal(config.evidenceDirectory,resolve(binding.directory,row.rawDirectory));
  assertFleetEvidenceInventory(row.rawInventory);assertFleetEvidenceInventory(row.finalInventory);
  assert.equal(row.rawInventory.manifestDigest,config.manifestDigest);assert.equal(row.finalInventory.manifestDigest,config.manifestDigest);
  assert.equal(row.rawInventory.coverage.find(item=>item.stream==='cleanup')!.rows,0);assert(row.finalInventory.coverage.every(item=>item.rows>0));
  const ready=protocol.parseFleetMessage(row.ready,config,row.ready.pid);assert.equal(ready.type,'ready');
  const expected=['omitted','false','prepare',daily?'run-daily':recovery?'run-recovery':'run-healthy','snapshot'];assert.equal(row.calls.length,expected.length);
  let previous=Date.parse(ready.span.endedAt);
  for(const [index,input] of row.calls.entries()){const call=protocol.parseFleetMessage(input,config,ready.pid);assert.equal(call.type,'result');assert.equal(call.action,expected[index]);assert.equal(call.sequence,index+1);assert.equal(call.error,false);
    assert.equal(call.backendPid,ready.backendPid);assert.equal(call.backendStart,ready.backendStart);
    assert(Date.parse(call.span.startedAt)>=previous);previous=Date.parse(call.span.endedAt);
    if(index===3)assert.equal(capacityDigest(call.inventory),capacityDigest(row.rawInventory));else assert.equal(call.inventory,null);
  }
  assert(previous<=config.workDeadlineAt,'worker result exceeded original work deadline');
  const names=daily?FLEET_DAILY_TESTS:recovery?FLEET_RECOVERY_TESTS:FLEET_HEALTHY_TESTS;assert.equal(row.cases.length,names.length);previous=0;
  for(const [index,item] of row.cases.entries()){keys(item,['name','state','span']);assert.equal(item.name,names[index]);assert.equal(item.state,'passed');protocol.assertFleetSpan(item.span);
    assert(Date.parse(item.span.startedAt)>=previous);previous=Date.parse(item.span.endedAt);}
  for(const [index,first,last] of (recovery||daily?[[0,0,4]]:[[0,0,1],[1,2,4]])){assert(Date.parse(row.cases[index].span.startedAt)<=Date.parse(row.calls[first].span.startedAt));assert(Date.parse(row.cases[index].span.endedAt)>=Date.parse(row.calls[last].span.endedAt));}
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
  assertFleetRawFinalDocuments(raw,documents);
  const cleanup=object(documents.cleanup);keys(cleanup,['kind','childClosed','backendGone','locksGone','connectionsClosed','childExit','forcedStop','cleanupAttempts','at','backendPid','backendStart','scope']);
  assert.equal(cleanup.kind,'cp26-parent-process-cleanup-v1');for(const key of ['childExit','forcedStop','cleanupAttempts'] as const)assert.equal(capacityDigest(cleanup[key]),capacityDigest(companion[key]));for(const key of Object.keys(companion.cleanup))assert.equal(cleanup[key],true);
  assert.equal(cleanup.backendPid,companion.ready.backendPid);assert.equal(cleanup.backendStart,companion.ready.backendStart);
  assert(typeof cleanup.at==='string'&&Number.isFinite(Date.parse(cleanup.at)));assert(Date.parse(cleanup.at)>=Date.parse(companion.calls.at(-1)!.span.endedAt));
  assert.equal(cleanup.scope,'Child process, pinned connection and locks only; outer supervisor owns database resources.');
  let capacity=object(documents['capacity-evidence']);keys(capacity,['manifest','evidence','analysis','journalValidation','evidenceFailures',...(config.profile!==FLEET_HEALTHY_PROFILE?['observerManifest']:[])]);assert.equal(capacity.journalValidation,'validated');assert.deepEqual(capacity.evidenceFailures,[]);
  const buildInput={fixtureId:config.fixtureId,gitSha:config.gitSha,plannedPostgresqlVersion:config.plannedPostgresqlVersion};
  const healthy=config.profile===FLEET_HEALTHY_PROFILE,daily=config.profile===FLEET_DAILY_PROFILE;
  const built=healthy?await buildFleetHealthyManifest(buildInput):daily?await buildFleetDailyManifest(buildInput):await buildFleetRecoveryManifest(buildInput);
  const manifest='manifest'in built?built.manifest:built.observerManifest;
  const laneManifest='manifest'in built?built.manifest:'dailyManifest'in built?built.dailyManifest:built.recoveryManifest;
  assert.equal(built.fixture.digest,config.fixtureDigest);assert.equal(laneManifest.digest,config.manifestDigest);
  if(daily)capacity={...capacity,manifest:resolveFleetDailyManifestReference(capacity.manifest,'daily-manifest',laneManifest),observerManifest:resolveFleetDailyManifestReference(capacity.observerManifest,'observer-manifest',manifest)};
  if(!healthy)assert.equal(capacityDigest(capacity.observerManifest),capacityDigest(manifest),'recovery observer binding drift');
  assert.equal(capacityDigest(capacity.manifest),capacityDigest(laneManifest));
  if(daily)capacity={...capacity,evidence:{...object(capacity.evidence),requests:resolveFleetDailyRequestLedger(object(capacity.evidence).requests,documents['transport-attempts']),queue:unpackFleetDailyQueue(object(capacity.evidence).queue)}};
  const evidence=object(capacity.evidence);assert.equal(evidence.manifestDigest,config.manifestDigest);
  assert.equal(capacityDigest(documents['transport-attempts']),capacityDigest(evidence.requests));
  const {evaluateCapacityEvidence,assertCapacityHttpEndpoint}=await import('./freshness-capacity-evidence');
  const analysis=healthy?evaluateCapacityEvidence(manifest,capacity.evidence as import('./freshness-capacity-evidence').CapacityEvidence)
    :daily?(await import('./freshness-capacity-daily')).evaluateCapacityDaily(laneManifest as import('./freshness-capacity-daily').CapacityDailyManifest,capacity.evidence as import('./freshness-capacity-daily').CapacityDailyEvidence)
    :(await import('./freshness-capacity-recovery')).evaluateCapacityRecovery(laneManifest as import('./freshness-capacity-recovery').CapacityRecoveryManifest,capacity.evidence as import('./freshness-capacity-recovery').CapacityRecoveryEvidence);
  assert.equal(capacityDigest(analysis),capacityDigest(capacity.analysis),'reported analysis differs from complete evidence');
  assert('offlineChecksPass'in analysis?analysis.offlineChecksPass:analysis.pass,'fleet evidence gates failed');
  const requests=object(evidence.requests),attempts=fleetIndex(fleetRows(requests.attempts),'id');
  for(const row of attempts.values())assertCapacityHttpEndpoint(row as import('./freshness-capacity-evidence').HttpAttempt,true);
  const responseOwners=daily?unpackFleetDailyResponses(documents['transport-responses']):fleetRows(documents['transport-responses']);assert.deepEqual(responseOwners.map(row=>row.owner).sort(),[...FLEET_REQUEST_OWNERS].sort());
  const responses=new Map<string,Record<string,unknown>>();
  for(const owner of responseOwners)for(const response of fleetRows(owner.responses)){
    const id=String(response.attemptId);assert(!responses.has(id),'duplicate physical response');responses.set(id,response);const attempt=attempts.get(id);assert(attempt&&attempt.owner===owner.owner&&attempt.outcome==='success');
    assert.equal(hash(String(response.rawUtf8)),response.rawSha256);assert.equal(response.rawSha256,attempt.responseSha256);assert.equal(response.requestStartedAt,attempt.at);assert.equal(response.responseCompletedAt,attempt.endedAt);
    assert.equal(response.responseBoundary,'full-synthetic-bytes-available');assert(Number(response.monotonicCompletedAt)>=Number(response.monotonicStartedAt));
    const endpoint=(daily?(laneManifest as import('./freshness-capacity-daily').CapacityDailyManifest).endpoints:manifest.source.endpointInventory).find(row=>row.id===response.endpointId);assert(endpoint);assert.equal(attempt.origin+String(attempt.path),endpoint.url);assert.equal(attempt.method,endpoint.method);
    const permitted=healthy?manifest.source.endpointInventory.find(row=>row.id===endpoint.id)!.versions:(laneManifest as import('./freshness-capacity-recovery').CapacityRecoveryManifest).endpoints.find(row=>row.id===endpoint.id)?[...['before','after'].map(key=>((laneManifest as import('./freshness-capacity-recovery').CapacityRecoveryManifest).endpoints.find(row=>row.id===endpoint.id)! as unknown as Record<string,unknown>)[key])]:[];
    assert(permitted.some(value=>{const payload=value as {version:string;sha256:string;utf8:string};return payload.version===response.version&&payload.sha256===response.rawSha256&&payload.utf8===response.rawUtf8;}),'unbound physical payload version');
    assert.equal(capacityDigest(response.pairIds),capacityDigest(endpoint.pairIds));
  }
  const rawPrimary=object(documents['primary-coexistence']),primary=daily?{...rawPrimary,sqlAttempts:unpackFleetDailySqlAttempts(rawPrimary.sqlAttempts),secondaryResponses:unpackFleetDailySecondaryResponses(rawPrimary,attempts)}:rawPrimary,fixture=object(primary.fixture),secondary=fleetRows(primary.secondaryResponses);
  const nativeDocuments=fleetIndex(fleetRows(fixture.documents),'url');
  for(const response of secondary){const id=String(response.attemptId);assert(!responses.has(id));const attempt=attempts.get(id),document=object(response.document);
    const retained=nativeDocuments.get(String(document.url));assert(retained&&capacityDigest(retained)===capacityDigest(document));assert.equal(hash(String(document.utf8)),document.sha256);
    if(attempt){assert.equal(attempt.owner,response.owner);assert.equal(attempt.origin+String(attempt.path),document.url);assert.equal(attempt.responseSha256,document.sha256);assert.equal(attempt.at,response.at);assert.equal(attempt.endedAt,response.endedAt);responses.set(id,response);}}
  for(const [id,attempt] of attempts)assert.equal(responses.has(id),attempt.outcome==='success','source response coverage mismatch');
  const operations=object(documents['observer-operations']),reads=object(documents['observer-reads']),proofDocument=object(documents['observer-lineage']);
  assert.equal(operations.openInvocations,0);assert(Array.isArray(operations.failures));
  if(daily)assert(!fleetRows(operations.operations).some(op=>op.operation==='orphan-daily-catalog-choice'),'orphan catalog choice');
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
  const origins=fleetIndex(fleetRows(evidence.origins??(daily?[]:undefined)),'id');
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
  }else if(!daily){const ev=capacity.evidence as import('./freshness-capacity-recovery').CapacityRecoveryEvidence;
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
  }else if(daily){const ev=capacity.evidence as import('./freshness-capacity-daily').CapacityDailyEvidence;fullProofs.push(...ev.intakes.map(row=>({completedAt:row.completedAt,completeProof:row.proof})));}
  else{const ev=capacity.evidence as import('./freshness-capacity-recovery').CapacityRecoveryEvidence;fullProofs.push(...ev.submissions,...ev.queue.completed);}
    const endpointRows=fleetRows(proofDocument.endpointProofs),endpoints=new Map<string,Record<string,unknown>>();
    for(const row of endpointRows){const key=[row.requestId??'shared',row.endpointId,row.proofId].join('/');assert(!endpoints.has(key));endpoints.set(key,row);await assertFleetEndpointLineage(row,responses,attempts,invocations);}
    if(!healthy){const ev=capacity.evidence as import('./freshness-capacity-recovery').CapacityRecoveryEvidence;
    for(const row of ev.endpointAcceptances){const proof=endpoints.get([row.requestId??'shared',row.endpointId,row.proofId].join('/'));assert(proof,'missing exact recovery endpoint proof');
      assert.equal(proof.attemptId,row.attemptId);assert.equal(proof.kind,row.kind);const clocks=await assertFleetEndpointLineage(proof,responses,attempts,invocations);assert.equal(clocks.sourceObservedAt,row.sourceObservedAt);assert.equal(clocks.acceptedAt,row.acceptedAt);const span=object(proof.readSpan);assert(Number(span.startedAt)<=row.readAt&&row.readAt<=Number(span.endedAt));}
    }
    const currentRows=fleetIndex(fleetRows(proofDocument.currentIntakeReads),'id');
    for(const completed of fullProofs){const proof=completed.completeProof;if(!proof)continue;
      const recovery=healthy?null:daily?(laneManifest as import('./freshness-capacity-daily').CapacityDailyManifest).bindingPlan:laneManifest as import('./freshness-capacity-recovery').CapacityRecoveryManifest,queue=healthy||daily?null:(capacity.evidence as import('./freshness-capacity-recovery').CapacityRecoveryEvidence).queue;const initialTarget=daily?(capacity.evidence as import('./freshness-capacity-daily').CapacityDailyEvidence).initialSubmissions.find(row=>row.requestId===proof.requestId):queue?.targets.find(target=>target.input.identityRequestId===proof.requestId);const initialScope=initialTarget?recovery!.initialRequests.find(row=>row.cohort===initialTarget.cohort):null;assert.equal(proof.coverage,initialScope?'complete-materialized-initial-scope':'complete-materialized-inventory');const exactWeeks=initialScope?[7]:Array.from({length:18},(_,i)=>i+1),transactionWeeks=initialScope?[7]:Array.from({length:19},(_,i)=>i);if(initialScope){assert.deepEqual([...proof.completedEndpointIds].sort(),[...initialScope.endpointIds].sort());assert.deepEqual([...proof.nativeIds].sort(),[...initialScope.nativeLeagueIds].sort());assert.equal(proof.draftProofs.length,0);}

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
  if(daily)await assertFleetDailyAuxiliary({manifest:laneManifest as import('./freshness-capacity-daily').CapacityDailyManifest,evidence:capacity.evidence as import('./freshness-capacity-daily').CapacityDailyEvidence,lineage:proofDocument,operations,responses,attempts,invocations});
  if(daily)await assertFleetDailyRecordedState({manifest:laneManifest as import('./freshness-capacity-daily').CapacityDailyManifest,evidence:capacity.evidence as import('./freshness-capacity-daily').CapacityDailyEvidence,operations,reads,lineage:proofDocument,primary,attempts,config});
  const ancillary=await assertFleetAncillaryEvidence({manifest,recovery:healthy||daily?null:laneManifest as import('./freshness-capacity-recovery').CapacityRecoveryManifest,...(daily?{daily:laneManifest as import('./freshness-capacity-daily').CapacityDailyManifest}:{}),evidence,lineage:proofDocument,reads,operations,primary,responses,attempts,invocations});
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
export function assertFleetAncillaryChain(start:number,end:number,successes:readonly FleetAncillarySuccess[],options:{requirePrior?:boolean;freshSource?:boolean}={}){return assertFleetSourceChain(start,end,successes,options,900000);}
export function assertFleetDailyChain(start:number,end:number,successes:readonly FleetAncillarySuccess[]){return assertFleetSourceChain(start,end,successes,{},86400000);}
function assertFleetSourceChain(start:number,end:number,successes:readonly FleetAncillarySuccess[],options:{requirePrior?:boolean;freshSource?:boolean},sourceLimit:900000|86400000) {
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
  if(prior&&!options.freshSource){assert(start-prior.sourceAt<=sourceLimit,'stale ancillary start');assert(prior.confirmedAt-prior.sourceAt<=sourceLimit,'stale initial confirmation');source=prior.sourceAt;}
  const pending=distinct.filter(row=>row.confirmedAt>=start&&row.confirmedAt<=end&&row.acceptedAt<=end&&row.committedAt<=end&&(!options.freshSource||row.sourceAt>=start));
  for(const row of pending){if(row===prior&&options.requirePrior)continue;const gap=row.confirmedAt-(source??start);gaps.push(gap);
    assert(gap<=sourceLimit,sourceLimit===900000?'ancillary successful-confirmation gap exceeds fifteen minutes':'daily successful-confirmation gap exceeds twenty-four hours');assert(row.confirmedAt-row.sourceAt<=sourceLimit,'ancillary current proof is stale');source=row.sourceAt;}
  assert(source!==null,'no confirmed ancillary refresh');const tail=end-source;gaps.push(tail);assert(tail<=sourceLimit,sourceLimit===900000?'ancillary trailing gap exceeds fifteen minutes':'daily trailing gap exceeds twenty-four hours');
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
  daily?:import('./freshness-capacity-daily').CapacityDailyManifest;
  evidence:Record<string,unknown>;lineage:Record<string,unknown>;reads:Record<string,unknown>;operations:Record<string,unknown>;primary:Record<string,unknown>;
  responses:Map<string,Record<string,unknown>>;attempts:Map<string,Record<string,unknown>>;invocations:Record<string,unknown>[]}){
  const{manifest,recovery,daily,evidence,lineage,reads,operations,primary,responses,attempts,invocations}=input;assert(!(recovery&&daily));
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
    if(daily){const submitted=fleetRows(evidence.initialSubmissions).find(item=>item.cohort===cohort);assert(submitted);assert.equal(submitted.requestId,row.requestId);assert.equal(object(submitted.receipt).status,'retained');}
    else if(recovery){const target=fleetRows(object(evidence.queue).targets).find(item=>item.cohort===cohort);assert(target);assert.equal(object(target.input).identityRequestId,row.requestId);}
    else if(cohort==='accepted'){const submitted=fleetRows(primary.setup).filter(item=>item.operation==='initial-submit');assert.equal(submitted.length,1);assert.equal(submitted[0].requestId,row.requestId);assert.equal(object(submitted[0].receipt).status,'retained');}
    else{const submitted=operationRows.filter(item=>item.operation==='submission/'+cohort);assert.equal(submitted.length,1);assert.equal(object(submitted[0].outcome).requestId,row.requestId);assert.equal(object(submitted[0].outcome).status,'retained');}
  }
  assert.equal(new Set([...requests.values()].map(row=>row.requestId)).size,3);
  const anchors=new Map<string,Record<string,unknown>>();const {CAPACITY_ANCILLARY_FIRST_RECEIPT_SQL,CAPACITY_ANCILLARY_HEADS_SQL}=await import('./freshness-capacity-observer');
  const mainAcceptances=fleetRows(daily?evidence.initialHeadConfirmations:recovery?evidence.initial:evidence.firstAcceptances),mainFor=(key:string,component:FleetAncillaryComponent)=>{
    const pairId=key+(component==='standings'?'/rosters':'/lineups'),row=mainAcceptances.find(item=>item.pairId===pairId);assert(row);return row;};
  for(const anchor of fleetRows(lineage.ancillaryAnchors)){keys(anchor,['leagueKey','component','kind','at','requestId','receiptId','query']);const league=manifest.source.leagues.find(item=>item.key===anchor.leagueKey),planned=manifest.plan.leagues.find(item=>item.key===anchor.leagueKey);assert(league&&planned);const component=anchor.component as FleetAncillaryComponent;assert(FLEET_ANCILLARY_COMPONENTS.includes(component));const key=league.key+'/'+component;assert(!anchors.has(key));anchors.set(key,anchor);safeInteger(Number(anchor.at));assert.equal(anchor.requestId,requests.get(planned.cohort)!.requestId);
    if(!recovery&&!daily&&planned.cohort==='accepted'){assert.equal(anchor.kind,'benchmark');assert.equal(anchor.at,evidence.startedAt);assert.equal(anchor.receiptId,null);assert.equal(anchor.query,null);}
    else if(component==='standings'||component==='exact-results'){const main=mainFor(league.key,component),read=daily?{at:main.at,originObservationId:main.proofId}:object(main.read);assert.equal(anchor.kind,'pair-first-read');assert.equal(anchor.at,recovery?read.at:main.at);assert.equal(anchor.receiptId,String(read.originObservationId).split('/')[0]);assert.equal(anchor.query,null);}
    else{assert.equal(anchor.kind,'initial-request-first-receipt');const query=object(anchor.query);keys(query,['sql','params','rowsRef','span']);assert.equal(query.sql,CAPACITY_ANCILLARY_FIRST_RECEIPT_SQL);same(query.params,[anchor.requestId,league.nativeLeagueId,component]);const rows=fleetRows(queryRows.get(String(query.rowsRef)));assert.equal(rows.length,1);numericSpan(query.span);const record=rows[0],receipt=object(record.receipt),content=object(record.content),provenance=object(receipt.provenance);
      assert.equal(receipt.id,anchor.receiptId);assert.equal(object(record.dispatch).intake_id,anchor.requestId);assert.equal(content.family,component);assert.equal(content.external_league_id,league.nativeLeagueId);assert.equal(time(object(record.acceptance).accepted_at),anchor.at);
      const matched=[...responses.values()].filter(row=>row.nativeLeagueId===league.nativeLeagueId&&row.resource===component.replace('_','-')&&Number(row.requestStartedAt)>=time(provenance.requestStartedAt)&&Number(row.responseCompletedAt)<=time(provenance.requestCompletedAt)&&capacityDigest(JSON.parse(String(row.rawUtf8)))===capacityDigest(content.payload));assert.equal(matched.length,1,'ambiguous initial bracket capture');const response=matched[0];
      await assertFleetEndpointLineage({requestId:anchor.requestId,endpointId:response.endpointId,proofId:receipt.id,attemptId:response.attemptId,kind:'resource-receipt',record,readSpan:query.span},responses,attempts,invocations);
      assertFleetAncillaryAnchorJournal(anchor,'ancillary-anchor/'+league.key+'/'+component,operationRows,queryRows);
    }
  }
  assert.equal(anchors.size,manifest.source.leagues.length*4,'missing fixed ancillary anchor');
  const successes=new Map<string,FleetAncillarySuccess[]>(),observations=fleetRows(reads.ancillaryReads),seenSlots=new Set<string>(),lastConfirmedHeads=new Map<string,string>();
  const t0=Number(evidence.startedAt)-(recovery||daily?0:FLEET_HEALTHY_CLOCK.benchmarkOffsetMs),endedAt=Number(evidence.endedAt);safeInteger(t0);safeInteger(endedAt);
  const leagueEnds=new Map(manifest.source.leagues.map(league=>[league.key,daily?t0+daily.clock.observationMs:recovery?endedAt:fleetAncillaryHealthyEnd(Number(evidence.startedAt),manifest.plan.leagues.find(planned=>planned.key===league.key)!.cohort,manifest.plan.pairs.filter(pair=>pair.leagueKey===league.key).map(pair=>{const accepted=mainAcceptances.find(row=>row.pairId===pair.id);assert(accepted);return Number(accepted.at);}))]));
  if(daily)assertFleetDailyAncillarySchedule(daily,evidence as unknown as import('./freshness-capacity-daily').CapacityDailyEvidence,observations);
  else assertFleetAncillarySchedule(t0,[...leagueEnds].map(([leagueKey,endAt])=>({leagueKey,endAt})),observations.map(row=>({leagueKey:String(row.leagueKey),scheduledAt:Number(row.scheduledAt)})),!recovery);
  const {composeOfficialResults}=await import('../lib/aggregator/official-results');
  for(const read of observations){keys(read,['leagueKey','scheduledAt','span','components','componentSpans','currentQueries','unavailable','heads','unchanged','composed']);for(const field of ['componentSpans','currentQueries','unavailable'])assert(Object.keys(object(read[field])).every(key=>FLEET_ANCILLARY_COMPONENTS.includes(key as FleetAncillaryComponent)));const league=manifest.source.leagues.find(item=>item.key===read.leagueKey);assert(league);safeInteger(Number(read.scheduledAt));assert(Number(read.scheduledAt)>=t0&&Number(read.scheduledAt)<=endedAt&&(daily||(Number(read.scheduledAt)-t0)%60_000===0||!recovery&&read.scheduledAt===leagueEnds.get(league.key)),'unfrozen ancillary slot');const slot=league.key+'/'+read.scheduledAt;assert(!seenSlots.has(slot),'replaced ancillary slot');seenSlots.add(slot);const span=numericSpan(read.span);assert(Number(span.endedAt)<=endedAt);const components=object(read.components);keys(components,[...FLEET_ANCILLARY_COMPONENTS]);
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
    const pairAnchors=manifest.plan.pairs.filter(pair=>pair.leagueKey===league.key).map(pair=>{const row=mainAcceptances.find(item=>item.pairId===pair.id);assert(row);return Number(daily?row.at:recovery?object(row.read).at:planned.cohort==='accepted'?evidence.startedAt:row.at);});
    const end=daily?t0+daily.clock.observationMs:recovery?endedAt:fleetAncillaryHealthyEnd(Number(evidence.startedAt),planned.cohort,pairAnchors);assert(endedAt>=end,'truncated ancillary interval');
    const final=recovery?observations.filter(row=>row.leagueKey===league.key&&Number(row.scheduledAt)<=end).sort((a,b)=>Number(a.scheduledAt)-Number(b.scheduledAt)).at(-1):observations.find(row=>row.leagueKey===league.key&&row.scheduledAt===end);
    assert(final,'missing frozen ancillary end read');const boundaryAt=Number(final.scheduledAt),boundarySpan=numericSpan(final.span);assert(boundaryAt<=end&&end-boundaryAt<=manifest.plan.sampleTimeoutMs,'unobserved ancillary end');
    assert(Number(boundarySpan.startedAt)>=boundaryAt&&Number(boundarySpan.startedAt)<=boundaryAt+manifest.plan.sampleDispatchLatenessMs&&Number(boundarySpan.endedAt)<=boundaryAt+manifest.plan.sampleTimeoutMs);
    for(const component of FLEET_ANCILLARY_COMPONENTS){const id=object(final.components)[component];assert(typeof id==='string','missing typed ancillary end component');const success=proofs.get(id)!.success;assert(end-success.sourceAt<=(daily?daily.clock.maxSourceGapMs:900_000),'stale current ancillary end');}
    if(!recovery&&!daily&&planned.cohort==='accepted'){const boundary=observations.find(row=>row.leagueKey===league.key&&row.scheduledAt===evidence.startedAt);assert(boundary&&FLEET_ANCILLARY_COMPONENTS.every(component=>object(boundary.components)[component]!==null),'missing fixed benchmark current proof');}
    for(const component of [...FLEET_ANCILLARY_COMPONENTS,'official-results']as const){const key=league.key+'/'+component,anchor=component==='official-results'?{at:Math.max(...FLEET_ANCILLARY_COMPONENTS.map(part=>Number(anchors.get(league.key+'/'+part)!.at)))}:anchors.get(key)!,rows=successes.get(key)??[];
      if(daily){if(daily.leagues.find(row=>row.key===league.key)!.status==='post_season')reports.push({leagueKey:league.key,component,...assertFleetDailyChain(Number(anchor.at),end,rows)});}
      else if(!recovery)reports.push({leagueKey:league.key,component,...assertFleetAncillaryChain(Number(anchor.at),end,rows,{requirePrior:planned.cohort==='accepted'})});
      else{const outage=object(evidence.outage),cutoff=Number(evidence.startedAt)+60*60_000,restored=Math.max(Number(outage.dependencyRestoredAt),Number(outage.runnerRestoredAt));safeInteger(restored);assert(Number(anchor.at)<=cutoff,'initial ancillary acceptance missed fixed outage');
        const before=assertFleetAncillaryChain(Number(anchor.at),cutoff,rows);const after=assertFleetAncillaryChain(restored,end,rows,{freshSource:true});reports.push({leagueKey:league.key,component,before,outage:{startedAt:Number(outage.startedAt),restoredAt:restored,excludedFromHealthyCadence:true},after});}
    }
  }
  return{policy:daily?'cp1-inactive-ancillary-twenty-four-hour-v1':'cp1-active-ancillary-fifteen-minute-v1',sourceLimitMs:daily?daily.clock.maxSourceGapMs:900_000,metadataPolicy:'existing-daily-applicability',reports};
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

/** Daily reads are sparse but frozen: every completed intake scope and all four fixed fleet boundaries. */
export function assertFleetDailyAncillarySchedule(manifest:import('./freshness-capacity-daily').CapacityDailyManifest,evidence:import('./freshness-capacity-daily').CapacityDailyEvidence,rows:readonly Record<string,unknown>[]){
  const expected=new Set<string>(),start=evidence.startedAt;
  for(const offset of manifest.boundaryOffsets)for(const league of manifest.leagues)expected.add(league.key+'/'+(start+offset));
  for(const intake of evidence.intakes){const request=manifest.initialRequests.find(row=>row.cohort===intake.cohort);assert(request);for(const key of request.leagueKeys)expected.add(key+'/'+intake.completedAt);}
  const actual=rows.map(row=>String(row.leagueKey)+'/'+String(row.scheduledAt));assert.equal(new Set(actual).size,actual.length,'duplicate daily ancillary observation');assert.deepEqual([...actual].sort(),[...expected].sort(),'incomplete daily ancillary schedule');
  for(const boundary of evidence.boundaries){const selected=rows.filter(row=>row.scheduledAt===boundary.scheduledAt),ids=selected.flatMap(row=>Object.values(object(row.components)));assert.equal(selected.length,manifest.leagues.length);assert(ids.every(id=>typeof id==='string'));assert.deepEqual([...boundary.proofIds].sort(),ids.sort(),'daily boundary proof inventory drift');}
}

/** Daily-only exact-byte interning. No physical response or owner may disappear behind a shared body. */
export function unpackFleetDailyResponses(value:unknown):Record<string,unknown>[]{
  const row=object(value);keys(row,['kind','bodies','owners']);assert.equal(row.kind,'cp26-daily-response-pool-v1');
  const bodies=new Map<string,string>(),used=new Set<string>();let decodedBytes=0,responses=0;
  for(const entry of fleetRows(row.bodies)){keys(entry,['sha256','utf8','byteLength']);assert(typeof entry.utf8==='string');assert.match(String(entry.sha256),/^[a-f0-9]{64}$/u);assert(!bodies.has(String(entry.sha256)),'duplicate daily body');assert.equal(Buffer.byteLength(entry.utf8),entry.byteLength);assert.equal(hash(entry.utf8),entry.sha256);decodedBytes+=Number(entry.byteLength);assert(decodedBytes<=FLEET_DOCUMENT_LIMITS.totalDecodedBytes);bodies.set(String(entry.sha256),entry.utf8);}
  const owners=fleetRows(row.owners);assert.deepEqual(owners.map(owner=>owner.owner).sort(),[...FLEET_REQUEST_OWNERS].sort());
  const attempts=new Set<string>();const result=owners.map(owner=>{keys(owner,['owner','responses']);return{owner:owner.owner,responses:fleetRows(owner.responses).map(response=>{
    keys(response,['attemptId','endpointId','resource','nativeLeagueId','nativeWeek','pairIds','version','rawSha256','requestStartedAt','responseCompletedAt','monotonicStartedAt','monotonicCompletedAt','responseBoundary','bodyRef']);
    const id=String(response.attemptId);assert(!attempts.has(id),'duplicate daily physical response');attempts.add(id);assert(++responses<=FLEET_EVIDENCE_LIMITS.maxRows);
    assert.equal(response.bodyRef,response.rawSha256);const utf8=bodies.get(String(response.bodyRef));assert(utf8!==undefined,'missing daily response body');used.add(String(response.bodyRef));
    const{bodyRef,...rest}=response;void bodyRef;return{...rest,rawUtf8:utf8};
  })};});assert.deepEqual([...used].sort(),[...bodies.keys()].sort(),'unused daily response body');return result;
}
export function unpackFleetDailySecondaryResponses(primary:Record<string,unknown>,attempts:ReadonlyMap<string,Record<string,unknown>>):Record<string,unknown>[]{
  const documents=fleetIndex(fleetRows(object(primary.fixture).documents),'url'),tank=fleetIndex(fleetRows(primary.tankAttempts),'id');
  for(const document of documents.values())assert.equal(hash(String(document.utf8)),document.sha256);
  return fleetRows(primary.secondaryResponses).map(response=>{assert(!Object.hasOwn(response,'document'));assert(typeof response.documentRef==='string');const attempt=attempts.get(String(response.attemptId))??tank.get(String(response.attemptId));assert(attempt,'unbound daily secondary attempt');const document=documents.get(String(attempt.origin)+String(attempt.path));assert(document&&document.sha256===response.documentRef,'missing daily secondary source document');const{documentRef,...rest}=response;void documentRef;return{...rest,document};});
}

/** Replays the bounded existing directory reader; supplied eligibility labels cannot replace its rows. */
export async function replayFleetDailyCatalogTurn(turn:import('./freshness-capacity-daily').DailyCatalogTurn){
  if(turn.state==='missed'){assert.equal(turn.read,null);assert.equal(turn.lastAttemptId,null);assert.equal(turn.retryAt,null);assert.deepEqual(turn.attemptIds,[]);return null;}
  const document=object(turn.read);keys(document,['value','queries']);assert.equal(turn.state,'invoked','daily catalog eligibility was not observed');
  const queries=fleetRows(document.queries);assert.equal(queries.length,1,'missing exact catalog eligibility query');const query=queries[0];keys(query,['sql','params','rows','span']);
  const{PLAYER_DIRECTORY_READ_SQL,playerDirectoryMethods}=await import('../lib/league-administration/neon/player-directory');assert.equal(query.sql,PLAYER_DIRECTORY_READ_SQL);assert.deepEqual(query.params,[null,null,null,2]);assert(Array.isArray(query.rows));const span=numericSpan(query.span);assert(Number(span.startedAt)>=turn.startedAt&&Number(span.endedAt)<=turn.endedAt);
  let count=0;const client:import('../lib/database').DatabaseClient={enabled:true,query:(async(sql:string,params:readonly unknown[]=[])=>{assert.equal(++count,1);assert.equal(sql,query.sql);assert.equal(capacityDigest(params),capacityDigest(query.params));return query.rows;}) as import('../lib/database').DatabaseClient['query']};
  const actual=await playerDirectoryMethods(client).readAcceptedPlayerDirectory({limit:1});assert.equal(count,1);assert.equal(capacityDigest(actual),capacityDigest(document.value),'daily catalog typed eligibility drift');assert(actual.status==='missing'||actual.status==='available');
  const latest=actual.latestAttempt;assert.equal(turn.lastAttemptId,latest?.attemptId??null);assert.equal(turn.retryAt,latest?Date.parse(latest.retryAt):null);if(latest)assert.equal(Date.parse(latest.retryAt)-Date.parse(latest.reservedAt),86_400_000);
  return actual;
}

/** Binds the pure daily inventory to the actual read-only SQL/reader transcript.
 * SQL clocks are retained as SQL clocks; no client/server offset is invented. */
export async function assertFleetDailyRecordedState(input:{manifest:import('./freshness-capacity-daily').CapacityDailyManifest;
  evidence:import('./freshness-capacity-daily').CapacityDailyEvidence;operations:Record<string,unknown>;reads:Record<string,unknown>;
  lineage:Record<string,unknown>;primary:Record<string,unknown>;attempts:ReadonlyMap<string,Record<string,unknown>>;
  config:{workDeadlineAt:number}}){
  const{manifest,evidence,operations,reads,lineage,primary,attempts,config}=input;
  const same=(a:unknown,b:unknown,message='daily recorded evidence drift')=>assert.equal(capacityDigest(a),capacityDigest(b),message);
  const time=(value:unknown)=>{assert(typeof value==='string');const at=Date.parse(value);assert(Number.isFinite(at));return at;};
  const uuid=(value:unknown)=>{assert(typeof value==='string'&&/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/iu.test(value));return value;};
  const ops=fleetRows(operations.operations),proofs=fleetIndex(fleetRows(lineage.receiptProofs),'receiptId'),readRows=fleetRows(reads.lineage);
  const{CAPACITY_DAILY_QUEUE_SQL}=await import('./freshness-capacity-observer');
  assert.equal(evidence.workDeadlineAt,config.workDeadlineAt);assert(evidence.endedAt<=config.workDeadlineAt);
  const submissions=fleetIndex(evidence.initialSubmissions as unknown as Record<string,unknown>[],'cohort');
  assert.deepEqual([...submissions.keys()].sort(),manifest.initialRequests.map(row=>row.cohort).sort());
  for(const planned of manifest.initialRequests){const row=submissions.get(planned.cohort)!,id=uuid(row.requestId);
    const matches=ops.filter(op=>op.operation==='recovery-submit/initial-'+planned.cohort);assert.equal(matches.length,1,'missing actual daily submission');
    const op=matches[0],span=numericSpan(op.span),outcome=object(op.outcome);same(outcome.receipt,row.receipt);assert.equal(outcome.requestId,id);assert.equal(object(outcome.receipt).status,'retained');
    assert.equal(span.startedAt,row.submittedAt);assert.equal(outcome.receiptAt,row.receiptAt);assert(Number(row.receiptAt)<=Number(span.endedAt));assert(Number(span.startedAt)>=evidence.startedAt);
  }
  assert.equal(evidence.initialHeadConfirmations.length,64);const pairIds=new Set<string>();
  for(const head of evidence.initialHeadConfirmations){assert(!pairIds.has(head.pairId));pairIds.add(head.pairId);
    const [leagueKey,family]=head.pairId.split('/'),planned=manifest.initialRequests.find(row=>row.leagueKeys.includes(leagueKey));assert(planned&&['rosters','lineups','official-scores','transactions'].includes(family));
    assert.equal(head.requestId,submissions.get(planned.cohort)!.requestId);const proof=proofs.get(head.proofId);assert(proof,'missing daily initial receipt');
    assert.equal(object(object(proof.dispatch).work).requestId,head.requestId);assert.equal(object(object(proof.mapping).scope).externalLeagueId,manifest.leagues.find(row=>row.key===leagueKey)!.nativeLeagueId);
    assert(readRows.some(row=>row.proofId===head.proofId&&row.pairId===head.pairId&&row.endedAt===head.at&&row.selection==='current'),'daily initial head lacks actual current reader');
    assert(Number(proof.sourceResponseCompletedAt)<=head.at);
  }
  const snapshots=evidence.queue;assert(snapshots.length>0);const bodies=new Map<string,typeof snapshots[number]>();let priorAt=-1;
  for(const snapshot of snapshots){assert(snapshot.at>=priorAt&&snapshot.at<=evidence.endedAt);priorAt=snapshot.at;
    const{at,...body}=snapshot,digest=capacityDigest(body);assert(!bodies.has(digest),'duplicate unchanged queue body');bodies.set(digest,snapshot);
    const matches=ops.filter(op=>op.operation==='daily-queue'&&object(op.outcome).digest===digest);assert(matches.length>0,'unread daily queue snapshot');
    assert(matches.some(op=>Number(numericSpan(op.span).endedAt)===at));
  }
  const queueOps=ops.filter(op=>op.operation==='daily-queue');assert(queueOps.length>0);
  for(const op of queueOps){const span=numericSpan(op.span),outcome=object(op.outcome);keys(outcome,['digest','querySha256','params']);assert.equal(outcome.querySha256,hash(CAPACITY_DAILY_QUEUE_SQL));assert.deepEqual(outcome.params,[]);assert(bodies.has(String(outcome.digest)));assert(Number(span.endedAt)<=evidence.endedAt);}
  assert(Number(numericSpan(queueOps.at(-1)!.span).endedAt)>=evidence.startedAt+manifest.clock.observationMs,'missing fixed-end queue observation');
  const targets=fleetIndex(evidence.targets as unknown as Record<string,unknown>[],'cohort');assert.deepEqual([...targets.keys()].sort(),manifest.targets.map(row=>row.cohort).sort());
  const fullScope=manifest.bindingPlan.submissions[0].input as unknown as Record<string,unknown>;
  const fields=[['seasons','seasons'],['periodInventory','period_inventory'],['transactionHistory','transaction_history'],['draftPicks','draft_picks'],['playoffBrackets','playoff_brackets'],['weeklyReports','weekly_reports']] as const;
  const periods=Array.from({length:18},(_,index)=>({season:2026,nativeWeek:index+1}));
  for(const planned of manifest.targets){const target=targets.get(planned.cohort)!,value=object(target.input);uuid(target.targetId);assert.equal(target.configurationRevision,1);
    assert.equal(value.id,target.targetId);assert.equal(value.expectedRevision,0);assert.equal(value.identityRequestId,submissions.get(planned.cohort)!.requestId);assert.equal(value.cadenceSeconds,72000);assert.equal(value.paused,false);assert.equal(time(value.expiresAt),config.workDeadlineAt);
    for(const[field]of fields)same(value[field],fullScope[field]);
    const configured=fleetRows(primary.setup).filter(row=>row.operation==='configure'&&row.cohort===planned.cohort);assert.equal(configured.length,1);const ack=object(configured[0].result);assert.equal(ack.targetId,target.targetId);assert.equal(ack.configurationRevision,target.configurationRevision);assert.equal(configured[0].configuredAt,target.configuredAt);
  }
  const immutableConfigs=new Map<string,string>(),immutableCycles=new Map<string,string>(),immutableOutcomes=new Map<string,string>(),requestInputs=new Map<string,string>(),seenRequests=new Set<string>(),requestState=new Map<string,{revision:number;terminal:boolean}>();
  const targetById=new Map(evidence.targets.map(row=>[row.targetId,row]));const cyclesByRequest=new Map<string,Record<string,unknown>>();
  const auxiliary=object((evidence as unknown as Record<string,unknown>).auxiliary),auxIds=new Set(fleetRows(auxiliary.requests).map(row=>uuid(row.requestId)));
  for(const snapshot of snapshots){
    const configurations=fleetIndex(fleetRows(snapshot.configurations).map(row=>({...row,id:object(row.target).id})),'id');
    for(const id of immutableConfigs.keys())assert(configurations.has(id),'daily approval disappeared');
    for(const item of configurations.values()){const target=object(item.target),configuration=object(item.configuration),declared=targetById.get(uuid(target.id));assert(declared,'undeclared daily target');
      assert.equal(target.configuration_revision,1);assert.equal(configuration.target_id,target.id);assert.equal(configuration.revision,1);assert.equal(configuration.identity_request_id,declared.input.identityRequestId);assert.equal(configuration.cadence_seconds,72000);assert.equal(configuration.paused,false);assert.equal(time(configuration.expires_at),config.workDeadlineAt);
      for(const[field,column]of fields)same(configuration[column],declared.input[field]);same(configuration.exact_periods,periods);time(configuration.configured_at);time(target.created_at);
      const digest=capacityDigest(configuration),old=immutableConfigs.get(String(target.id));if(old)assert.equal(old,digest,'immutable daily approval changed');immutableConfigs.set(String(target.id),digest);
    }
    const cycles=fleetRows(snapshot.cycles),cycleKeys=new Set<string>();
    for(const cycle of cycles){const target=targetById.get(uuid(cycle.target_id));assert(target);assert(cycle.cycle===1||cycle.cycle===2);assert.equal(cycle.configuration_revision,1);const key=String(cycle.target_id)+'/'+String(cycle.cycle);assert(!cycleKeys.has(key));cycleKeys.add(key);
      const digest=capacityDigest(cycle),old=immutableCycles.get(key);if(old)assert.equal(old,digest,'immutable daily cycle changed');immutableCycles.set(key,digest);const requestId=uuid(cycle.intake_id);const existing=cyclesByRequest.get(requestId);if(existing)same(existing,cycle);cyclesByRequest.set(requestId,cycle);assert(time(cycle.created_at)>=time(cycle.due_at));
    }
    for(const key of immutableCycles.keys())assert(cycleKeys.has(key),'daily cycle disappeared');
    const outcomeKeys=new Set<string>();for(const outcome of fleetRows(snapshot.outcomes)){const key=String(outcome.target_id)+'/'+String(outcome.cycle);assert(cycleKeys.has(key)&&!outcomeKeys.has(key));outcomeKeys.add(key);assert.equal(outcome.disposition,'complete');time(outcome.recorded_at);time(outcome.next_due_at);const digest=capacityDigest(outcome),old=immutableOutcomes.get(key);if(old)assert.equal(old,digest,'immutable cycle outcome changed');immutableOutcomes.set(key,digest);}
    for(const key of immutableOutcomes.keys())assert(outcomeKeys.has(key),'daily cycle outcome disappeared');
    const requests=fleetIndex(fleetRows(snapshot.requests),'id');for(const id of seenRequests)assert(requests.has(id),'ordinary request disappeared');
    for(const[id,request]of requests){uuid(id);assert(request.resource_occurrence_id===null||request.resource_occurrence_id===undefined,'internal occurrence entered ordinary inventory');seenRequests.add(id);
      const initial=evidence.initialSubmissions.find(row=>row.requestId===id),cycle=cyclesByRequest.get(id);assert(initial||cycle||auxIds.has(id),'unexpected ordinary daily work');
      if(!auxIds.has(id)){const target=cycle?targetById.get(String(cycle.target_id))!:targets.get(initial!.cohort)!,cohort=String(target.cohort),planned=manifest.targets.find(row=>row.cohort===cohort)!;
        assert.equal(request.username,initial?planned.username:planned.nativeUsername);const scope=(initial?manifest.initialScope:fullScope) as unknown as Record<string,unknown>;
        for(const[field,column]of fields)same(request[column],scope[field]??(field==='weeklyReports'?[]:null),'ordinary daily scope drift');same(request.exact_periods,initial?manifest.initialScope.exactPeriods:periods);same(request.transaction_period,initial?manifest.initialScope.transactionPeriod:null);
      }
      const stable={id,username:request.username,created_at:request.created_at,...Object.fromEntries(fields.map(([,column])=>[column,request[column]])),exact_periods:request.exact_periods,transaction_period:request.transaction_period},digest=capacityDigest(stable),old=requestInputs.get(id);if(old)assert.equal(old,digest,'immutable request input changed');requestInputs.set(id,digest);time(request.created_at);
      assert(Number.isSafeInteger(request.revision)&&Number(request.revision)>=0);assert(typeof request.terminal==='boolean');const previous=requestState.get(id);if(previous){assert(Number(request.revision)>=previous.revision);if(previous.terminal)assert(request.terminal&&request.revision===previous.revision,'terminal request changed');}requestState.set(id,{revision:Number(request.revision),terminal:request.terminal});
    }
  }
  assert.equal(immutableConfigs.size,3);assert.equal(immutableCycles.size,6);assert.equal(immutableOutcomes.size,6);
  const final=fleetIndex(fleetRows(snapshots.at(-1)!.requests),'id'),completed=fleetIndex(evidence.intakes as unknown as Record<string,unknown>[],'requestId');assert.equal(completed.size,9);
  assert.deepEqual([...final.keys()].sort(),[...completed.keys(),...auxIds].sort(),'final ordinary inventory is incomplete or has extra work');
  for(const intake of evidence.intakes){const request=final.get(intake.requestId);assert(request&&request.terminal===true&&request.revision===intake.proof.terminalRevision);const initial=evidence.initialSubmissions.find(row=>row.requestId===intake.requestId),planned=manifest.initialRequests.find(row=>row.cohort===intake.cohort);assert(planned);
    assert.equal(intake.kind,initial?'initial':'cycle');assert.equal(intake.proof.requestId,intake.requestId);assert.equal(intake.proof.terminal,true);assert.equal(intake.proof.parity,'immutable-intake-receipts-and-current-readers');same([...intake.proof.nativeIds].sort(),[...planned.nativeLeagueIds].sort());assert.equal(intake.proof.coverage,initial?'complete-materialized-initial-scope':'complete-materialized-inventory');
    const expectedEndpoints=initial?planned.endpointIds:manifest.targets.find(row=>row.cohort===intake.cohort)!.endpointIds;same([...intake.proof.completedEndpointIds].sort(),[...expectedEndpoints].sort());assert.equal(intake.proof.detailedPeriods,planned.nativeLeagueIds.length*(initial?1:18));assert.equal(intake.proof.detailedTransactions,planned.nativeLeagueIds.length*(initial?1:19));assert.equal(intake.proof.detailedDrafts,planned.nativeLeagueIds.length*(initial?0:5));
    assert.equal(intake.createdAt,time(request.created_at));const cycle=cyclesByRequest.get(intake.requestId);assert.equal(intake.cycle,cycle?.cycle??null);assert.equal(intake.targetId,cycle?.target_id??null);assert.equal(intake.dueAt,cycle?time(cycle.due_at):null);
    await assertFleetDailyIntakeRecord(intake,request,cycle??null,ops,evidence.endedAt);
  }
  for(const turn of evidence.catalogTurns){await replayFleetDailyCatalogTurn(turn);const matching=ops.filter(op=>op.operation==='daily-turn/'+turn.ordinal);
    if(turn.state==='missed'){assert.equal(matching.length,0);continue;}assert.equal(matching.length,1);const span=numericSpan(matching[0].span);assert.equal(span.startedAt,turn.startedAt);assert(Number(span.endedAt)>=turn.endedAt);const outcome=object(matching[0].outcome);assert.equal(outcome.state,turn.state);same(outcome.attemptIds,turn.attemptIds);same(outcome.invocationOutcome,turn.invocationOutcome);assert.equal(outcome.invocationFailed,turn.invocationFailed);same(outcome.catalogChoices,turn.catalogChoices);
    const calls=fleetRows(primary.calls).filter(call=>call.action==='enabled'&&Date.parse(String(object(call.span).startedAt))>=turn.startedAt&&Date.parse(String(object(call.span).endedAt))<=turn.endedAt);assert.equal(calls.length,1,'daily turn not bound to one actual facade call');same(calls[0].outcome,turn.invocationOutcome);assert.equal(calls[0].failed,turn.invocationFailed);const invocation=fleetRows(operations.invocations).filter(row=>row.owner==='data-refresh'&&Number(object(row.span).startedAt)>=turn.startedAt&&Number(object(row.span).endedAt)<=turn.endedAt);assert.equal(invocation.length,1);await assertFleetDailyCatalogChoices(turn,invocation[0],fleetRows(primary.sqlAttempts),attempts);
    const actual=[...attempts.values()].filter(row=>row.owner==='data-refresh'&&row.origin==='https://api.sleeper.app'&&row.path==='/v1/players/nfl'&&Number(row.at)>=turn.startedAt&&Number(row.endedAt)<=turn.endedAt).map(row=>String(row.id));same([...turn.attemptIds].sort(),actual.sort());
  }
  const coverage=fleetIndex(fleetRows(operations.ownerCoverage),'owner');for(const owner of FLEET_REQUEST_OWNERS){const held=coverage.get(owner);assert(held);assert(Number(held.startedAt)<=Number(auxiliary.startedAt));for(const attempt of attempts.values())if(attempt.owner===owner)assert(Number(attempt.at)>=Number(held.startedAt)&&Number(attempt.endedAt)<=Number(held.endedAt));}
  return{ordinaryRequests:final.size,completedDailyRequests:completed.size,cycles:immutableCycles.size,catalogTurns:evidence.catalogTurns.length,initialHeads:pairIds.size};
}

/** Replays the existing aggregate reader from its complete actual SQL transcript.
 * Concurrent calls match exact SQL+parameters, never a fabricated typed result. */
export async function replayFleetDailyAuxiliaryRead(proof:import('./freshness-capacity-daily').DailyAuxiliaryRead,label:'a'|'b'){
  const span=numericSpan(proof.span),queries=fleetRows(proof.queries).map((row,index)=>({row,index,used:false}));
  for(const{row}of queries){keys(row,['sql','params','rows','span']);assert(typeof row.sql==='string');assert(Array.isArray(row.params)&&Array.isArray(row.rows));const clock=numericSpan(row.span);assert(Number(clock.startedAt)>=Number(span.startedAt)&&Number(clock.endedAt)<=Number(span.endedAt));}
  const database:import('../lib/database').DatabaseClient={enabled:true,query:(async(sql:string,params:readonly unknown[]=[])=>{const matches=queries.filter(value=>!value.used&&value.row.sql===sql&&capacityDigest(value.row.params)===capacityDigest(params));assert(matches.length>0,'unrecorded auxiliary reader query');if(matches.length>1)for(const match of matches)sameRows(match.row.rows,matches[0].row.rows);const selected=matches[0];selected.used=true;return selected.row.rows;}) as import('../lib/database').DatabaseClient['query']};
  const{CAPACITY_INTAKE_REQUEST_SQL,CAPACITY_INTAKE_CANDIDATES_SQL}=await import('./freshness-capacity-observer');
  const request=await database.query(CAPACITY_INTAKE_REQUEST_SQL,[proof.requestId]);assert.equal(request.length,1);sameRows(request[0],proof.request);
  const candidates=await database.query(CAPACITY_INTAKE_CANDIDATES_SQL,[proof.requestId]);sameRows(candidates,proof.candidates);
  const{createLeagueAdministrationStore}=await import('../lib/league-administration/store'),{readPublicSleeperIntake}=await import('../lib/league-administration/public-intake-reader');
  const store=createLeagueAdministrationStore(database),mapping=await store.readSourceMapping(String(object(object(proof.mapping).scope).externalLeagueId));sameRows(mapping,proof.mapping);
  const pages=[proof.read,...proof.additionalPages];assert(label==='a'||proof.additionalPages.length===0);let afterOrdinal:number|null=0;let read:Awaited<ReturnType<typeof readPublicSleeperIntake>>|null=null;
  for(const[index,value]of pages.entries()){assert(index===0||label==='a'&&afterOrdinal!==null,'extra auxiliary aggregate page');read=await readPublicSleeperIntake(database,store,proof.requestId,{managerEvidenceVersion:'v2',...(label==='a'?{draftPicksPage:{afterOrdinal:afterOrdinal!,limit:20}}:{})});
   const retained=object(value);assert(typeof retained.readAt==='string');const originalAt=Date.parse(retained.readAt);assert(Number.isFinite(originalAt)&&originalAt>=Number(span.startedAt)&&originalAt<=Number(span.endedAt),'auxiliary original read clock outside actual span');const{readAt:replayedAt,...actualValue}=object(read),{readAt:retainedAt,...retainedValue}=retained;assert(Number.isFinite(Date.parse(String(replayedAt))));void retainedAt;sameRows(actualValue,retainedValue);
   if(label==='a'){const page=object(object(retained.draftPicks).page);assert.equal(page.afterOrdinal,afterOrdinal);assert.equal(page.limit,20);const next=page.nextAfterOrdinal;assert(next===null||Number.isSafeInteger(next)&&Number(next)>Number(afterOrdinal));afterOrdinal=next as number|null;}
  }assert(read);if(label==='a')assert.equal(afterOrdinal,null,'incomplete auxiliary draft cursor chain');const candidate=proof.candidates.map(object).map(row=>object(row.candidate)).find(row=>row.external_league_id===object(object(proof.mapping).scope).externalLeagueId);assert(candidate);const retainedRoster=await store.readRosterPlayerLinks({rosterReceiptId:String(candidate.players_receipt_id),leagueSeasonId:String(object(proof.mapping).leagueSeasonId)});sameRows(retainedRoster,proof.retainedRoster);assert.equal(retainedRoster.status,'available');assert(queries.every(row=>row.used),'unused auxiliary reader SQL');return read;
}
function sameRows(a:unknown,b:unknown){assert.equal(capacityDigest(a),capacityDigest(b),'recorded SQL/reader value changed');}

export async function assertFleetDailyAuxiliary(input:{manifest:import('./freshness-capacity-daily').CapacityDailyManifest;
 evidence:import('./freshness-capacity-daily').CapacityDailyEvidence;lineage:Record<string,unknown>;operations:Record<string,unknown>;
 responses:Map<string,Record<string,unknown>>;attempts:Map<string,Record<string,unknown>>;invocations:Record<string,unknown>[]}){
 const{manifest,evidence,lineage,operations,responses,attempts,invocations}=input,aux=evidence.auxiliary,planned=manifest.auxiliary,ops=fleetRows(operations.operations),endpointRows=fleetRows(lineage.endpointProofs),current=fleetIndex(fleetRows(lineage.currentIntakeReads),'id');
 const time=(value:unknown)=>{const at=Date.parse(String(value));assert(Number.isFinite(at));return at;};
 assert.equal(new Set(planned.nativeLeagueIds).size,21);assert.equal(planned.nativeRosterIds.length,12);assert(planned.nativeLeagueIds.every(id=>!manifest.leagues.some(row=>row.nativeLeagueId===id)));
 assert(aux.startedAt<=aux.endedAt&&aux.endedAt<=evidence.startedAt);assert.equal(aux.requests.length,2);
 await assertFleetDailyEmptyOrigin(aux.initialState,aux.startedAt,Math.min(...aux.requests.map(row=>row.submittedAt)),evidence.requests.coverageStartedAt,[...attempts.values()]);
 const queue=evidence.queue.find(row=>{const{at,...body}=row;void at;return capacityDigest(body)===aux.queueDigest;});assert(queue,'missing actual auxiliary terminal queue');assert.equal(queue.requests.length,2);assert.deepEqual(queue.cycles,[]);assert.deepEqual(queue.configurations,[]);assert.deepEqual(queue.outcomes,[]);assert(queue.at<=evidence.startedAt);
 const window=ops.filter(op=>op.operation==='daily-window-start');assert.equal(window.length,1);const origin=object(window[0].outcome);sameRows(origin,{startedAt:evidence.startedAt,setupStartedAt:aux.startedAt,auxiliaryDigest:capacityDigest(aux)});assert(Number(numericSpan(window[0].span).startedAt)>=aux.endedAt);
 const pairs=new Map<string,{mapping:Record<string,unknown>;teams:{native:string;id:string}[];identity:string}>();
 for(const user of planned.users){const entry=aux.requests.find(row=>row.label===user.label);assert(entry);const submitted=ops.filter(op=>op.operation==='daily-auxiliary-submission/'+user.label);assert.equal(submitted.length,1);sameRows(submitted[0].outcome,entry.receipt);assert.equal(object(entry.receipt).status,'retained');assert.equal(object(entry.receipt).requestId,entry.requestId);const submitSpan=numericSpan(submitted[0].span);assert.equal(submitSpan.startedAt,entry.submittedAt);assert.equal(submitSpan.endedAt,entry.receiptAt);
  const queueRequest:Record<string,unknown>|undefined=fleetRows(queue.requests).find(row=>row.id===entry.requestId);assert(queueRequest?.terminal===true);assert.equal(queueRequest.username,user.username);
  const acquired=[...attempts.values()].filter(row=>row.owner==='data-refresh'&&Number(row.at)>=entry.submittedAt&&Number(row.endedAt)<=entry.completedAt&&planned.endpoints.some(endpoint=>endpoint.url===String(row.origin)+String(row.path)));
  assert.equal(acquired.length,planned.expectedHttp[user.label],'auxiliary physical request count differs');assert(acquired.every(row=>row.method==='GET'&&row.outcome==='success'));
  const endpointIds=acquired.map(row=>String(responses.get(String(row.id))?.endpointId));assert(!endpointIds.includes('auxiliary:league-21'),'21st association fanned out');
  const expectedBase=['auxiliary:identity-'+user.label,'auxiliary:discovery-'+user.label,'auxiliary:league-1','auxiliary:rosters','auxiliary:users'];const expectedProofs=user.label==='a'?[...expectedBase,'auxiliary:drafts','auxiliary:league-trades','auxiliary:draft-detail','auxiliary:draft-picks','auxiliary:draft-trades']:expectedBase;
  for(const proof of [entry.proof,aux.overlap[user.label]]){
   assert.equal(proof.requestId,entry.requestId);const span=numericSpan(proof.span);assert(Number(span.startedAt)>=entry.receiptAt&&Number(span.endedAt)<=aux.endedAt);const logged=ops.filter(op=>op.operation==='daily-auxiliary-read/'+user.label&&object(op.outcome).digest===capacityDigest(proof));assert.equal(logged.length,1);sameRows(logged[0].span,proof.span);
   await replayFleetDailyAuxiliaryRead(proof,user.label);
   await assertFleetDailyAuxiliaryImmutable(proof,proof===aux.overlap[user.label]?Math.max(...aux.requests.map(row=>row.completedAt)):entry.receiptAt,endpointRows);
   const request=object(proof.request),stored=object(request.stored_request),identity=object(request.identity);assert.equal(request.id,entry.requestId);sameRows(stored,queueRequest);assert.equal(stored.username,user.username);assert.equal(stored.terminal,true);sameRows(stored.seasons,[2026]);assert.equal(stored.draft_picks,user.scope.draftPicks??null);for(const key of ['period_inventory','transaction_history','transaction_period','playoff_brackets','resource_occurrence_id','submission_capacity'])assert.equal(stored[key],null);sameRows(stored.exact_periods,[]);sameRows(stored.weekly_reports,[]);
   assert.equal(object(identity.payload).user_id,user.nativeManagerId);assert.equal(identity.intake_id,entry.requestId);const lists=fleetRows(request.lists);assert.equal(lists.length,1);sameRows(fleetRows(lists[0].payload).map(row=>row.league_id).sort(),[...user.nativeLeagueIds].sort());
   sameRows([...proof.completedEndpointIds].sort(),[...expectedProofs].sort());for(const endpointId of expectedProofs){const bound=endpointRows.filter(row=>row.requestId===entry.requestId&&row.endpointId===endpointId&&proof.immutableProofIds.includes(String(row.proofId)));assert(bound.length>0);for(const row of bound)await assertFleetEndpointLineage(row,responses,attempts,invocations);}
   for(const id of proof.immutableProofIds)assert(endpointRows.some(row=>row.requestId===entry.requestId&&row.proofId===id),'foreign auxiliary immutable receipt');
   const candidates=fleetRows(proof.candidates).map(row=>object(row.candidate));sameRows(candidates.map(row=>row.external_league_id).sort(),[...user.nativeLeagueIds].sort());assert.equal(candidates.length,user.label==='a'?21:1);
   for(const candidate of candidates){assert.equal(candidate.intake_id,entry.requestId);assert.equal(candidate.season,2026);const admitted=candidate.external_league_id===planned.admittedNativeLeagueId;assert.equal(candidate.stage,admitted?'complete':'capacity');if(!admitted)assert.equal(candidate.league_season_id,null);
    const nativeIndex=planned.nativeLeagueIds.indexOf(String(candidate.external_league_id));assert(nativeIndex>=0);if(nativeIndex===20){for(const field of ['bootstrap_payload','bootstrap_started_at','bootstrap_completed_at'])assert.equal(candidate[field],null);continue;}
    const native=object(candidate.bootstrap_payload);assert.equal(native.league_id,candidate.external_league_id);assert.equal(native.status,'pre_draft');assert.equal(native.total_rosters,admitted?12:21);const from=time(candidate.bootstrap_started_at),to=time(candidate.bootstrap_completed_at);
    const bound=acquired.filter(attempt=>attempt.path==='/v1/league/'+candidate.external_league_id&&Number(attempt.at)>=from&&Number(attempt.endedAt)<=to);assert.equal(bound.length,1,'unbound auxiliary bootstrap');const response=responses.get(String(bound[0].id));assert(response);sameRows(JSON.parse(String(response.rawUtf8)),native);
    const dispatches:Record<string,unknown>[]=fleetRows(lineage.durableDispatches).filter(row=>{const dispatch=object(row.dispatch),work=object(dispatch.work);return dispatch.intake_id===entry.requestId&&work.kind==='bootstrap'&&work.externalLeagueId===candidate.external_league_id;});assert.equal(dispatches.length,1);assert.equal(object(dispatches[0].outcome).outcome,'checkpoint-committed');
   }
   assert.equal(proof.currentReadProofIds.length,3);const resources=new Map<string,Record<string,unknown>>();for(const id of proof.currentReadProofIds){const row=current.get(id);assert(row&&row.requestId===entry.requestId&&row.nativeLeagueId===planned.admittedNativeLeagueId);const{id:ignored,...body}=row;void ignored;assert.equal(capacityDigest(body),id);assert(!resources.has(String(row.kind)));resources.set(String(row.kind),row);await assertFleetCurrentIntakeRead(row,responses,attempts,invocations);assert(Number(numericSpan(row.span).endedAt)<=Number(span.endedAt));}
   sameRows([...resources.keys()].sort(),['heldRoster','settings','teamManagers']);const held=object(resources.get('heldRoster')!.read),teams=fleetRows(held.teams);assert.equal(teams.length,12);sameRows(teams.map(row=>row.externalRosterId).sort(),[...planned.nativeRosterIds].sort());assert.equal(new Set(teams.map(row=>row.seasonTeamId)).size,12);
   for(const team of teams){assert.match(String(team.seasonTeamId),/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/iu);sameRows(team.players,[]);}
   for(const team of fleetRows(object(resources.get('teamManagers')!.read).teams))assert.equal(object(team.primaryOwner).state,'unowned');
   const aggregate=object(proof.read),leagues=fleetRows(aggregate.leagues);sameRows(leagues.map(row=>row.externalLeagueId).sort(),[...user.nativeLeagueIds].sort());const league=leagues.find(row=>row.externalLeagueId===planned.admittedNativeLeagueId)!;assert.equal(league.collection,'complete');const currentResource=(value:unknown)=>{const row=object(value);return row.status==='available'?row:object(row.retained);};for(const[kind,row]of resources)sameRows(currentResource(object(league.resources)[kind]),row.read);
   if(user.label==='a'){const aggregatePages=[aggregate,...proof.additionalPages.map(object)];for(const page of aggregatePages)assertFleetAuxiliaryDraftInventory(page,planned);const allDrafts=aggregatePages.flatMap(page=>fleetRows(page.drafts));assert.equal(allDrafts.length,43);assert.equal(new Set(allDrafts.map(row=>row.ordinal)).size,43);const drafts=allDrafts.filter(row=>row.externalLeagueId===planned.admittedNativeLeagueId);assert.equal(drafts.length,5);for(const draft of drafts){const read=object(draft.resource);assert.equal(read.status,'available');const original=endpointRows.find(row=>row.requestId===entry.requestId&&row.proofId===read.receiptId);assert(original);const normalized=await normalizedFleetReceipt(object(original.record)),payload=object(object(object(original.record).content).payload);const projected=payload.kind==='catalog'||payload.kind==='detail'?(await import('../lib/aggregator/draft-metadata')).projectDraftMetadata(normalized):payload.kind==='selections'?(await import('../lib/aggregator/draft-selections')).projectDraftSelections(normalized):(await import('../lib/aggregator/traded-picks')).projectTradedPicks(normalized);assert.equal(projected.status,'accepted');sameRows(read.value,projected.value);}}else assert.equal(aggregate.drafts,undefined);
   if(proof===aux.overlap[user.label]){const mapping=object(proof.mapping);assert.equal(object(mapping.scope).externalLeagueId,planned.admittedNativeLeagueId);pairs.set(user.label,{mapping,teams:teams.map(row=>({native:String(row.externalRosterId),id:String(row.seasonTeamId)})).sort((a,b)=>a.native.localeCompare(b.native)),identity:String(identity.source_manager_account_id)});
    for(const row of resources.values())assert.equal(object(object(row.source).dispatch).intake_id,aux.requests.find(value=>value.label==='b')!.requestId,'overlap must prove actual B current heads');}
  }
 }
 assert.equal(pairs.size,2);const a=pairs.get('a')!,b=pairs.get('b')!;assert.notEqual(a.identity,b.identity);for(const key of ['connectionId','leagueSeasonId','revisionId'])assert.equal(a.mapping[key],b.mapping[key]);sameRows(a.teams,b.teams);return{physicalHttp:36,nativeAssociations:21,rosterCountDeferrals:19,noFanout:1,canonicalTeams:12};
}

/** A completed label qualifies only when the same actual terminal SQL row and
 * bounded immutable/current-reader proof were observed in that operation. */
export async function assertFleetDailyIntakeRecord(intake:import('./freshness-capacity-daily').DailyIntakeEvidence,
 request:Record<string,unknown>,cycle:Record<string,unknown>|null,ops:readonly Record<string,unknown>[],snapshotEndedAt:number){
 const{CAPACITY_DAILY_INTAKE_SQL}=await import('./freshness-capacity-observer');assert.equal(request.id,intake.requestId);assert.equal(request.terminal,true);assert.equal(request.revision,intake.proof.terminalRevision);assert.equal(intake.proof.requestId,intake.requestId);
 assert.equal(intake.createdAt,Date.parse(String(request.created_at)));assert.equal(intake.targetId,cycle?.target_id??null);assert.equal(intake.cycle,cycle?.cycle??null);assert.equal(intake.dueAt,cycle?Date.parse(String(cycle.due_at)):null);if(cycle)assert.equal(cycle.intake_id,intake.requestId);
 const binding=ops.filter(op=>op.operation==='daily-intake-binding/'+intake.requestId);assert.equal(binding.length,1);const bound=object(binding[0].outcome);keys(bound,['request','cycle','querySha256','params']);assert.equal(bound.querySha256,hash(CAPACITY_DAILY_INTAKE_SQL));assert.deepEqual(bound.params,[intake.requestId]);sameRows(bound.request,request);sameRows(bound.cycle,cycle);const bindingSpan=numericSpan(binding[0].span);
 const success=ops.filter(op=>op.operation==='daily-intake/'+intake.requestId&&op.outcome!==null);assert.equal(success.length,1);const span=numericSpan(success[0].span);sameRows(success[0].outcome,{requestId:intake.requestId,completedAt:intake.completedAt,proofDigest:capacityDigest(intake.proof)});assert(Number(span.startedAt)<=intake.completedAt&&intake.completedAt<=Number(span.endedAt));assert(Number(bindingSpan.startedAt)>=Number(span.startedAt)&&Number(bindingSpan.endedAt)<=intake.completedAt);assert(intake.completedAt<=snapshotEndedAt&&Number(span.endedAt)<=snapshotEndedAt,'daily completion outside snapshot');
}

export async function assertFleetDailyAuxiliaryImmutable(proof:import('./freshness-capacity-daily').DailyAuxiliaryRead,notBefore:number,endpointRows:readonly Record<string,unknown>[]){
 const fresh=object(proof.immutableReceiptRead);keys(fresh,['span','rows','directories','queries']);const span=numericSpan(fresh.span),outer=numericSpan(proof.span);assert(Number(span.startedAt)>=notBefore&&Number(span.startedAt)>=Number(outer.startedAt)&&Number(span.endedAt)<=Number(outer.endedAt),'original receipt was not freshly read after the required boundary');
 const{CAPACITY_ENDPOINT_RECEIPTS_SQL,CAPACITY_ENDPOINT_DIRECTORIES_SQL,CAPACITY_INTAKE_REQUEST_SQL}=await import('./freshness-capacity-observer');const queries=fleetRows(fresh.queries);assert.equal(queries.length,3);
 for(const[sql,rows]of [[CAPACITY_ENDPOINT_RECEIPTS_SQL,fresh.rows],[CAPACITY_ENDPOINT_DIRECTORIES_SQL,fresh.directories],[CAPACITY_INTAKE_REQUEST_SQL,[proof.request]]]as const){const matches=queries.filter(row=>row.sql===sql);assert.equal(matches.length,1);const query=matches[0];keys(query,['sql','params','rows','span']);assert.deepEqual(query.params,[proof.requestId]);sameRows(query.rows,rows);const clock=numericSpan(query.span);assert(Number(clock.startedAt)>=Number(span.startedAt)&&Number(clock.endedAt)<=Number(span.endedAt));}
 const rows=fleetRows(fresh.rows),ids=new Set<string>();for(const row of rows){const id=String(object(row.receipt).id);assert(!ids.has(id));ids.add(id);assert(proof.immutableProofIds.includes(id));const original=endpointRows.find(value=>value.requestId===proof.requestId&&value.proofId===id);assert(original);sameRows(row,original.record);assert.equal(object(row.dispatch).intake_id,proof.requestId);await normalizedFleetReceipt(row);}
 for(const row of fleetRows(fresh.directories)){const id=String(object(row.capture).id),original=endpointRows.find(value=>value.requestId===proof.requestId&&value.proofId===id);assert(original&&proof.immutableProofIds.includes(id));sameRows(row,original.record);assert.equal(object(row.capture).intake_id,proof.requestId);}
 const candidate=proof.candidates.map(object).map(row=>object(row.candidate)).find(row=>row.external_league_id===object(object(proof.mapping).scope).externalLeagueId);assert(candidate);for(const key of ['settings_receipt_id','players_receipt_id','managers_receipt_id'])assert(ids.has(String(candidate[key])),'original candidate receipt absent from fresh immutable read');
 assertFleetAuxiliaryRetainedRosterIdentity(proof.retainedRoster,proof.mapping,candidate.players_receipt_id);
}
export function assertFleetAuxiliaryDraftInventory(aggregate:Record<string,unknown>,planned:import('./freshness-capacity-daily').CapacityDailyAuxiliary){
 const inventory=object(aggregate.draftPicks);assert.equal(inventory.policy,'sleeper-2026-draft-picks-v1');assert.equal(inventory.collection,'partial');sameRows(inventory.summary,{observedLeagues:21,admittedLeagues:20,capacityLeagues:1,materializedResources:43,pendingResources:0,acquiredResources:5,unavailableResources:38,undiscoveredDraftLeagues:19});
 const tasks=fleetRows(inventory.tasks);assert.equal(tasks.length,43);assert.equal(new Set(tasks.map(row=>row.ordinal)).size,43);assert.equal(tasks.filter(row=>row.collection==='complete').length,5);
 for(const id of planned.nativeLeagueIds.slice(1,20)){const rows=tasks.filter(row=>row.externalLeagueId===id);assert.equal(rows.length,2);sameRows(rows.map(row=>row.resource).sort(),['catalog','league-trades']);for(const row of rows){assert.equal(row.collection,'unavailable');assert.equal(row.reason,'bootstrap-capacity');assert.equal(row.draftReceiptId,null);}}
 assert(!tasks.some(row=>row.externalLeagueId===planned.nativeLeagueIds[20]));const admitted=tasks.filter(row=>row.externalLeagueId===planned.admittedNativeLeagueId);sameRows(admitted.map(row=>row.resource).sort(),['catalog','detail','draft-trades','league-trades','selections']);for(const row of admitted){assert.equal(row.collection,'complete');assert(typeof row.draftReceiptId==='string');}
}

/** A shortened initial budget horizon is justified only by the actual empty isolated schema read. */
export async function assertFleetDailyEmptyOrigin(value:unknown,setupStartedAt:number,firstSubmissionAt:number,coverageStartedAt:number,attempts:readonly Record<string,unknown>[]){
 const row=object(value);keys(row,['sql','params','rows','span']);const{CAPACITY_DAILY_EMPTY_SQL}=await import('./freshness-capacity-observer');assert.equal(row.sql,CAPACITY_DAILY_EMPTY_SQL);assert.deepEqual(row.params,[]);sameRows(row.rows,[{requests:0,dispatches:0,targets:0,cycles:0,catalog_attempts:0}]);const span=numericSpan(row.span);assert(Number(span.startedAt)>=setupStartedAt&&Number(span.endedAt)<=firstSubmissionAt,'empty origin was not observed before first submission');assert(Number.isFinite(coverageStartedAt)&&coverageStartedAt<=setupStartedAt);for(const attempt of attempts){assert(Number(attempt.at)>=coverageStartedAt,'attempt predates original coverage');assert(Number(attempt.endedAt)>=Number(attempt.at));}
}

/** Exact directory choice/admission SQL proves a selected operation without conflating it with network success. */
export async function assertFleetDailyCatalogChoices(turn:import('./freshness-capacity-daily').DailyCatalogTurn,invocation:Record<string,unknown>,sqlAttempts:readonly Record<string,unknown>[],attempts:ReadonlyMap<string,Record<string,unknown>>){
 const uuid=(value:unknown)=>{assert(typeof value==='string'&&/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/iu.test(value));return value;};
 const clock=numericSpan(invocation.span),from=Number(clock.startedAt),to=Number(clock.endedAt);assert.equal(invocation.owner,'data-refresh');assert(from>=turn.startedAt&&to<=turn.endedAt);sameRows(invocation.outcome,turn.invocationOutcome);assert.equal(invocation.failed,turn.invocationFailed);
 const{CAPACITY_DAILY_CATALOG_CLAIM_SQL,CAPACITY_DAILY_CATALOG_RESERVE_SQL}=await import('./freshness-capacity-observer');const declared={claim:hash(CAPACITY_DAILY_CATALOG_CLAIM_SQL),reserve:hash(CAPACITY_DAILY_CATALOG_RESERVE_SQL)};
 const choices=turn.catalogChoices;assert(Array.isArray(choices)&&choices.length<=2);const eligible=turn.retryAt===null||turn.startedAt>=turn.retryAt;
 if(!eligible&&choices.length===0){assert.deepEqual(turn.attemptIds,[]);return{status:'not-due' as const};}
 assert(choices.length>=1,'eligible directory operation unclassified');const used=new Set<unknown>();
 for(const choice of choices){keys(choice as unknown as Record<string,unknown>,['kind','querySha256','params','response','span','status']);assert(choice.kind==='claim'||choice.kind==='reserve');assert.equal(choice.querySha256,declared[choice.kind]);assert.equal(choice.status,'success','unknown catalog acknowledgment');assert(choice.response);keys(choice.response as unknown as Record<string,unknown>,['fields','rows']);const span=numericSpan(choice.span);assert(Number(span.startedAt)>=from&&Number(span.endedAt)<=to);
  const matching=sqlAttempts.filter(row=>row.querySha256===choice.querySha256&&Date.parse(String(object(row.span).startedAt))<=Number(span.startedAt)&&Date.parse(String(object(row.span).endedAt))>=Number(span.endedAt));assert.equal(matching.length,1,'catalog choice lacks exact physical SQL span');assert.equal(matching[0].outcome,'success');assert(!used.has(matching[0].sequence));used.add(matching[0].sequence);
  const fields=choice.kind==='claim'?['attempt_count','lease_until']:['result'];sameRows(choice.response.fields,fields);assert(choice.response.rows.length<=1);for(const row of choice.response.rows)assert(Array.isArray(row)&&row.length===fields.length);
 }
 const claim=choices[0];assert.equal(claim.kind,'claim');if(turn.retryAt!==null)assert(Number(claim.span.startedAt)>=turn.retryAt,'catalog choice predates persisted eligibility');assert.equal(claim.params.length,7);const[owner,type,scheduled,payload,worker,lease,minimum]=claim.params;assert.equal(owner,'league-administration-public-intake');assert.equal(type,owner);uuid(worker);assert.equal(Number(lease),25);assert.equal(Number(minimum),60);sameRows(typeof payload==='string'?JSON.parse(payload):payload,{policy:'public-player-directory-v1',mode:'player-directory'});const scheduledAt=Date.parse(String(scheduled));assert(Number.isFinite(scheduledAt)&&scheduledAt%60_000===0&&scheduledAt>=Math.floor(from/60_000)*60_000&&scheduledAt<=Math.floor(Number(claim.span.startedAt)/60_000)*60_000);
 if(claim.response!.rows.length===0){assert.equal(choices.length,1);assert.deepEqual(turn.attemptIds,[]);return{status:'claim-busy' as const};}
 const acquired=claim.response!.rows[0] as import('../lib/league-administration/contracts').JsonValue[],generation=Number(acquired[0]);assert(Number.isSafeInteger(generation)&&generation>0);assert(Number.isFinite(Date.parse(String(acquired[1]))));assert.equal(choices.length,2);const reserve=choices[1];assert.equal(reserve.kind,'reserve');assert(Number(reserve.span.startedAt)>=Number(claim.span.endedAt));assert.equal(reserve.params.length,2);const[id,wireFence]=reserve.params;uuid(id);const fence=object(typeof wireFence==='string'?JSON.parse(wireFence):wireFence);keys(fence,['jobKey','workerId','generation','deadlineAt']);assert.equal(fence.jobKey,owner);assert.equal(fence.workerId,worker);assert.equal(fence.generation,generation);assert.equal(Date.parse(String(fence.deadlineAt)),from+20_000);assert(Number(reserve.span.endedAt)<=from+20_000);assert.equal(reserve.response!.rows.length,1);const value=(reserve.response!.rows[0] as import('../lib/league-administration/contracts').JsonValue[])[0],result=object(typeof value==='string'?JSON.parse(value):value);
 if(result.status==='backoff'){keys(result,['status','retryAt']);assert(Number.isFinite(Date.parse(String(result.retryAt))));assert.deepEqual(turn.attemptIds,[]);return{status:'reservation-backoff' as const,retryAt:result.retryAt};}
 keys(result,['status','attempt']);assert.equal(result.status,'reserved');const{validatePlayerDirectoryAttempt}=await import('../lib/league-administration/player-directory');const reservation=validatePlayerDirectoryAttempt(object(result.attempt) as unknown as import('../lib/league-administration/player-directory-contracts').PlayerDirectoryAttempt);assert.equal(reservation.id,id);assert.equal(turn.attemptIds.length,1,'known reservation lacks its physical source attempt');const attempt=attempts.get(turn.attemptIds[0]);assert(attempt&&attempt.owner==='data-refresh'&&attempt.method==='GET'&&attempt.origin==='https://api.sleeper.app'&&attempt.path==='/v1/players/nfl');assert((turn.retryAt===null||Number(attempt.at)>=turn.retryAt)&&Number(attempt.at)>=Number(reserve.span.endedAt)&&Number(attempt.endedAt)<=to&&Number(attempt.endedAt)<=from+20_000);return{status:'reserved' as const,attempt:reservation,fence};
}

export function assertFleetAuxiliaryRetainedRosterIdentity(value:unknown,mapping:unknown,receiptId:unknown){
 const retained=object(value);assert.equal(retained.status,'available');assert.equal(retained.rosterReceiptId,receiptId);assert.equal(object(retained.mapping).leagueSeasonId,object(mapping).leagueSeasonId);
}

export type FleetDailySqlLedger={kind:'cp26-daily-sql-ledger-v1';queryDigests:string[];rows:[number,string,string,number,number,number,0|1,0|1][]};
/** Daily-only lossless representation; callback completion order is preserved, including concurrent [2,1]. */
export function packFleetDailySqlAttempts(attempts:readonly FleetSqlAttempt[]):FleetDailySqlLedger{
 assert(Array.isArray(attempts)&&attempts.length<=FLEET_EVIDENCE_LIMITS.maxRows);const queryDigests:string[]=[],indices=new Map<string,number>();
 const rows=attempts.map(attempt=>{keys(attempt,['sequence','span','querySha256','outcome','signal']);keys(attempt.span,['startedAt','endedAt','monotonicStartMs','monotonicEndMs']);assert(attempt.outcome==='success'||attempt.outcome==='failed');assert(typeof attempt.signal==='boolean');
  let index=indices.get(attempt.querySha256);if(index===undefined){index=queryDigests.length;queryDigests.push(attempt.querySha256);indices.set(attempt.querySha256,index);}return[attempt.sequence,attempt.span.startedAt,attempt.span.endedAt,attempt.span.monotonicStartMs,attempt.span.monotonicEndMs,index,attempt.outcome==='success'?0:1,attempt.signal?1:0]as FleetDailySqlLedger['rows'][number];});
 const result:FleetDailySqlLedger={kind:'cp26-daily-sql-ledger-v1',queryDigests,rows};validateFleetDailySqlLedger(result);return result;
}
function validateFleetDailySqlLedger(value:unknown):FleetDailySqlLedger{
 const envelope=object(value);keys(envelope,['kind','queryDigests','rows']);assert.equal(envelope.kind,'cp26-daily-sql-ledger-v1');assert(Array.isArray(envelope.rows)&&envelope.rows.length<=FLEET_EVIDENCE_LIMITS.maxRows);assert(Array.isArray(envelope.queryDigests)&&envelope.queryDigests.length<=envelope.rows.length);
 const digests=envelope.queryDigests as unknown[];assert(digests.every(value=>typeof value==='string'&&/^[a-f0-9]{64}$/u.test(value)));assert.equal(new Set(digests).size,digests.length,'duplicate daily SQL digest');const sequences=new Set<number>(),used=new Set<number>();let bytes=2;
 for(const raw of envelope.rows){assert(Array.isArray(raw)&&raw.length===8,'daily SQL tuple must retain all eight fields');const[sequence,startedAt,endedAt,monoStart,monoEnd,index,outcome,signal]=raw;assert(Number.isSafeInteger(sequence)&&sequence>=1&&sequence<=envelope.rows.length&&!sequences.has(sequence),'incomplete or duplicate SQL sequence');sequences.add(sequence);
  for(const clock of [startedAt,endedAt])assert(typeof clock==='string'&&clock.length<=27&&Number.isFinite(Date.parse(clock))&&new Date(clock).toISOString()===clock,'exact ISO SQL clock required');assert(Date.parse(endedAt)>=Date.parse(startedAt));assert(Number.isFinite(monoStart)&&monoStart>=0&&!Object.is(monoStart,-0)&&Number.isFinite(monoEnd)&&monoEnd>=monoStart&&!Object.is(monoEnd,-0),'invalid original monotonic SQL span');assert(Number.isSafeInteger(index)&&index>=0&&index<digests.length);if(!used.has(index)){assert.equal(index,used.size,'daily SQL dictionary first-use order');used.add(index);}assert(outcome===0||outcome===1);assert(signal===0||signal===1);
  const row={sequence,span:{startedAt,endedAt,monotonicStartMs:monoStart,monotonicEndMs:monoEnd},querySha256:digests[index],outcome:outcome===0?'success':'failed',signal:signal===1};bytes+=Buffer.byteLength(JSON.stringify(row))+(sequences.size>1?1:0);assert(bytes<=FLEET_EVIDENCE_LIMITS.totalBytes,'expanded daily SQL ledger exceeds decoded bound');
 }assert.equal(used.size,digests.length,'unused daily SQL digest');return envelope as unknown as FleetDailySqlLedger;
}
export function unpackFleetDailySqlAttempts(value:unknown):FleetSqlAttempt[]{
 // Every row and the aggregate allocation are checked before the output array is allocated.
 const ledger=validateFleetDailySqlLedger(value);return ledger.rows.map(([sequence,startedAt,endedAt,monotonicStartMs,monotonicEndMs,index,outcome,signal])=>({sequence,span:{startedAt,endedAt,monotonicStartMs,monotonicEndMs},querySha256:ledger.queryDigests[index],outcome:outcome===0?'success':'failed',signal:signal===1}));
}

/** Daily-only exact reference to the already hashed full physical request document. */
export type FleetDailyRequestLedgerReference={kind:'cp26-daily-request-ledger-reference-v1';stream:'transport-attempts';sha256:string;attemptCount:number};
export function packFleetDailyRequestLedger(requests:import('./freshness-capacity-evidence').RequestAccounting):FleetDailyRequestLedgerReference{
 const ledger=object(requests);assert(Array.isArray(ledger.attempts)&&ledger.attempts.length<=FLEET_EVIDENCE_LIMITS.maxRows);
 return{kind:'cp26-daily-request-ledger-reference-v1',stream:'transport-attempts',sha256:capacityDigest(requests),attemptCount:ledger.attempts.length};
}
export function resolveFleetDailyRequestLedger(reference:unknown,verifiedDocument:unknown):import('./freshness-capacity-evidence').RequestAccounting{
 const ref=object(reference);keys(ref,['kind','stream','sha256','attemptCount']);assert.equal(ref.kind,'cp26-daily-request-ledger-reference-v1');assert.equal(ref.stream,'transport-attempts');
 assert(typeof ref.sha256==='string'&&/^[a-f0-9]{64}$/u.test(ref.sha256));safeInteger(Number(ref.attemptCount));assert(typeof ref.attemptCount==='number'&&ref.attemptCount<=FLEET_EVIDENCE_LIMITS.maxRows);
 const ledger=object(verifiedDocument);assert(Array.isArray(ledger.attempts)&&ledger.attempts.length<=FLEET_EVIDENCE_LIMITS.maxRows);assert.equal(ledger.attempts.length,ref.attemptCount);assert.equal(capacityDigest(ledger),ref.sha256,'daily request document differs from its complete reference');
 return ledger as unknown as import('./freshness-capacity-evidence').RequestAccounting;
}

export type FleetDailyManifestRole='daily-manifest'|'observer-manifest';
export type FleetDailyManifestReference={kind:'cp26-daily-manifest-reference-v1';role:FleetDailyManifestRole;digest:string;sha256:string};
export function packFleetDailyManifestReference(role:FleetDailyManifestRole,manifest:{digest:string}):FleetDailyManifestReference{
 assert(role==='daily-manifest'||role==='observer-manifest');const value=object(manifest);assert(typeof value.digest==='string'&&/^[a-f0-9]{64}$/u.test(value.digest));
 return{kind:'cp26-daily-manifest-reference-v1',role,digest:value.digest,sha256:capacityDigest(manifest)};
}
/** Reconstructs deterministic input only after exact Git/config/source checks; physical evidence is never inferred. */
export function resolveFleetDailyManifestReference<T extends {digest:string}>(reference:unknown,expectedRole:FleetDailyManifestRole,rebuilt:T):T{
 const row=object(reference);keys(row,['kind','role','digest','sha256']);assert.equal(row.kind,'cp26-daily-manifest-reference-v1');assert(expectedRole==='daily-manifest'||expectedRole==='observer-manifest');assert.equal(row.role,expectedRole);
 for(const key of ['digest','sha256'])assert(typeof row[key]==='string'&&/^[a-f0-9]{64}$/u.test(row[key] as string));assert.equal(row.digest,rebuilt.digest,'deterministic manifest identity differs');assert.equal(row.sha256,capacityDigest(rebuilt),'deterministic manifest body differs');return rebuilt;
}


const FLEET_DAILY_QUEUE_POOLS=['requests','cycles','targets','configurations','outcomes'] as const;
type FleetDailyQueuePool=typeof FLEET_DAILY_QUEUE_POOLS[number];
type FleetDailyQueueRow={sha256:string;value:Record<string,unknown>};
type FleetDailyQueueRefs={at:number;requests:number[];cycles:number[];configurations:[number,number,0|1][];outcomes:number[]};
export type FleetDailyQueueLedger={kind:'cp26-daily-queue-ledger-v1';snapshotCount:number;sha256:string;pools:Record<FleetDailyQueuePool,FleetDailyQueueRow[]>;snapshots:FleetDailyQueueRefs[]};
const fleetDailyQueueKeys=['at','requests','cycles','configurations','outcomes'];
/** Daily-only complete row interning. Exact JSON row/property order and every snapshot are retained. */
export function packFleetDailyQueue(snapshots:readonly import('./freshness-capacity-daily').DailyQueueSnapshot[]):FleetDailyQueueLedger{
 assert(Array.isArray(snapshots)&&snapshots.length<=FLEET_EVIDENCE_LIMITS.maxRows);
 const pools:FleetDailyQueueLedger['pools']={requests:[],cycles:[],targets:[],configurations:[],outcomes:[]};
 const indices=Object.fromEntries(FLEET_DAILY_QUEUE_POOLS.map(key=>[key,new Map<string,number>()])) as Record<FleetDailyQueuePool,Map<string,number>>;
 let rowBytes=0,rowCount=0;const digest=createHash('sha256');digest.update('[');
 const put=(key:FleetDailyQueuePool,value:unknown)=>{object(value);assertJsonValue(value);const raw=JSON.stringify(value),sha256=hash(raw),prior=indices[key].get(sha256);
  if(prior!==undefined){assert.equal(JSON.stringify(pools[key][prior].value),raw,'queue hash collision');return prior;}
  rowBytes+=Buffer.byteLength(raw);assert(rowBytes<=FLEET_EVIDENCE_LIMITS.totalBytes&&++rowCount<=FLEET_EVIDENCE_LIMITS.maxRows,'daily queue pool exceeds bound');
  const index=pools[key].length;pools[key].push({sha256,value:value as Record<string,unknown>});indices[key].set(sha256,index);return index;};
 const refs=snapshots.map((row:import('./freshness-capacity-daily').DailyQueueSnapshot,index:number)=>{assert.deepEqual(Object.keys(row),fleetDailyQueueKeys,'queue snapshot property order changed');assertJsonValue(row);if(index)digest.update(',');digest.update(JSON.stringify(row));
  return{at:row.at,requests:row.requests.map(value=>put('requests',value)),cycles:row.cycles.map(value=>put('cycles',value)),configurations:row.configurations.map(value=>{const pair=object(value);keys(pair,['target','configuration']);return[put('targets',pair.target),put('configurations',pair.configuration),Object.keys(pair)[0]==='target'?0:1]as[number,number,0|1];}),outcomes:row.outcomes.map(value=>put('outcomes',value))};});
 digest.update(']');const ledger:FleetDailyQueueLedger={kind:'cp26-daily-queue-ledger-v1',snapshotCount:snapshots.length,sha256:digest.digest('hex'),pools,snapshots:refs};validateFleetDailyQueue(ledger);return ledger;
}
function validateFleetDailyQueue(value:unknown):{ledger:FleetDailyQueueLedger;raw:Record<FleetDailyQueuePool,string[]>}{
 const envelope=object(value);keys(envelope,['kind','snapshotCount','sha256','pools','snapshots']);assert.equal(envelope.kind,'cp26-daily-queue-ledger-v1');
 assert(typeof envelope.snapshotCount==='number');safeInteger(envelope.snapshotCount);assert(envelope.snapshotCount<=FLEET_EVIDENCE_LIMITS.maxRows);assert(typeof envelope.sha256==='string'&&/^[a-f0-9]{64}$/u.test(envelope.sha256));
 assert(Array.isArray(envelope.snapshots)&&envelope.snapshots.length===envelope.snapshotCount);const poolObject=object(envelope.pools);keys(poolObject,[...FLEET_DAILY_QUEUE_POOLS]);
 const raw:Record<FleetDailyQueuePool,string[]>={requests:[],cycles:[],targets:[],configurations:[],outcomes:[]},widths:Record<FleetDailyQueuePool,number[]>={requests:[],cycles:[],targets:[],configurations:[],outcomes:[]};
 const used=Object.fromEntries(FLEET_DAILY_QUEUE_POOLS.map(key=>[key,new Set<number>()]))as Record<FleetDailyQueuePool,Set<number>>;let poolCount=0,poolBytes=0,refCount=0,expandedBytes=2;
 for(const key of FLEET_DAILY_QUEUE_POOLS){const rows=poolObject[key];assert(Array.isArray(rows)&&rows.length<=FLEET_EVIDENCE_LIMITS.maxRows);const seen=new Set<string>();poolCount+=rows.length;assert(poolCount<=FLEET_EVIDENCE_LIMITS.maxRows);
  for(const value of rows){const row=object(value);keys(row,['sha256','value']);assert(typeof row.sha256==='string'&&/^[a-f0-9]{64}$/u.test(row.sha256));object(row.value);assertJsonValue(row.value);const encoded=JSON.stringify(row.value),bytes=Buffer.byteLength(encoded);poolBytes+=bytes;assert(poolBytes<=FLEET_EVIDENCE_LIMITS.totalBytes,'daily queue pool exceeds decoded bound');assert.equal(hash(encoded),row.sha256,'daily queue row hash mismatch');assert(!seen.has(row.sha256),'duplicate daily queue pool row');seen.add(row.sha256);raw[key].push(encoded);widths[key].push(bytes);}
 }
 const ref=(key:FleetDailyQueuePool,index:unknown)=>{assert(typeof index==='number'&&Number.isSafeInteger(index)&&index>=0&&index<raw[key].length,'invalid daily queue reference');assert(++refCount<=FLEET_EVIDENCE_LIMITS.maxRows,'daily queue reference count exceeded');if(!used[key].has(index)){assert.equal(index,used[key].size,'daily queue pool first-use order');used[key].add(index);}return widths[key][index];};
 for(let ordinal=0;ordinal<envelope.snapshots.length;ordinal++){const row=object(envelope.snapshots[ordinal]);assert.deepEqual(Object.keys(row),fleetDailyQueueKeys,'queue snapshot property order changed');assert(typeof row.at==='number'&&Number.isFinite(row.at)&&row.at>=0&&!Object.is(row.at,-0),'invalid original daily queue time');
  let bytes=Buffer.byteLength(JSON.stringify({at:row.at,requests:[],cycles:[],configurations:[],outcomes:[]}));
  for(const key of ['requests','cycles','outcomes']as const){const values=row[key];assert(Array.isArray(values)&&values.length<=FLEET_EVIDENCE_LIMITS.maxRows);bytes+=Math.max(0,values.length-1);for(const index of values)bytes+=ref(key,index);}
  assert(Array.isArray(row.configurations)&&row.configurations.length<=FLEET_EVIDENCE_LIMITS.maxRows);bytes+=Math.max(0,row.configurations.length-1);
  for(const pair of row.configurations){assert(Array.isArray(pair)&&pair.length===3,'daily queue configuration tuple must retain references and order');assert(pair[2]===0||pair[2]===1,'invalid daily queue configuration order');bytes+=Buffer.byteLength('{"target":,"configuration":}')+ref('targets',pair[0])+ref('configurations',pair[1]);}
  expandedBytes+=bytes+(ordinal?1:0);assert(Number.isSafeInteger(expandedBytes)&&expandedBytes<=FLEET_EVIDENCE_LIMITS.totalBytes,'expanded daily queue exceeds decoded bound');
 }
 for(const key of FLEET_DAILY_QUEUE_POOLS)assert.equal(used[key].size,raw[key].length,'unused daily queue pool row');
 // Only after complete reference/expansion validation hash the original queue; no giant expanded JSON allocation.
 const ledger=envelope as unknown as FleetDailyQueueLedger,digest=createHash('sha256');digest.update('[');
 const array=(key:FleetDailyQueuePool,refs:number[])=>{digest.update('[');refs.forEach((index,ordinal)=>{if(ordinal)digest.update(',');digest.update(raw[key][index]);});digest.update(']');};
 ledger.snapshots.forEach((row,ordinal)=>{if(ordinal)digest.update(',');digest.update('{"at":'+JSON.stringify(row.at)+',"requests":');array('requests',row.requests);digest.update(',"cycles":');array('cycles',row.cycles);digest.update(',"configurations":[');row.configurations.forEach(([target,configuration,order],index)=>{if(index)digest.update(',');digest.update(order===0?'{"target":'+raw.targets[target]+',"configuration":'+raw.configurations[configuration]+'}':'{"configuration":'+raw.configurations[configuration]+',"target":'+raw.targets[target]+'}');});digest.update('],"outcomes":');array('outcomes',row.outcomes);digest.update('}');});
 digest.update(']');assert.equal(digest.digest('hex'),ledger.sha256,'daily queue complete digest mismatch');return{ledger,raw};
}
export function unpackFleetDailyQueue(value:unknown):import('./freshness-capacity-daily').DailyQueueSnapshot[]{
 const{ledger,raw}=validateFleetDailyQueue(value);
 const freeze=(value:unknown):unknown=>{if(value&&typeof value==='object'){for(const nested of Object.values(value))freeze(nested);Object.freeze(value);}return value;};
 // Clone each distinct row once; shared reconstructed rows are immutable and never modify verified raw documents.
 const rows=Object.fromEntries(FLEET_DAILY_QUEUE_POOLS.map(key=>[key,raw[key].map(body=>freeze(JSON.parse(body)))]))as Record<FleetDailyQueuePool,import('./freshness-capacity-manifest').JsonValue[]>;
 return ledger.snapshots.map(row=>({at:row.at,requests:row.requests.map(index=>rows.requests[index]),cycles:row.cycles.map(index=>rows.cycles[index]),configurations:row.configurations.map(([target,configuration,order])=>order===0?{target:rows.targets[target],configuration:rows.configurations[configuration]}:{configuration:rows.configurations[configuration],target:rows.targets[target]}),outcomes:row.outcomes.map(index=>rows.outcomes[index])}));
}


export type FleetShortPlan = { kind:'cp26-short-source-plan-v1';profile:typeof FLEET_LIVE_PROFILE|typeof FLEET_OWNERSHIP_PROFILE;
  fixtureId:string;fixtureDigest:string;gitSha:string;appTreeSha:string;plannedPostgresqlVersion:string;
  sourceFiles:{path:string;sha256:string;lfSha256:string}[];clock:typeof FLEET_SHORT_CLOCK;
  policy:typeof FLEET_LIVE_POLICY|{kind:'cp26-ownership-policy-v1';scenarios:typeof FLEET_OWNERSHIP_SCENARIOS;invocationOffsetsMs:typeof FLEET_OWNERSHIP_OFFSETS;fixtureSeed:string;cohorts:{cohort:string;username:string;nativeManagerId:string;nativeLeagueIds:string[]}[];initialScope:{seasons:number[]};resourceScope:{seasons:number[];exactPeriods:{season:number;nativeWeek:number}[];transactionHistory:import('../lib/league-administration/public-intake-contracts').PublicTransactionHistory;playoffBrackets:import('../lib/league-administration/public-intake-contracts').PublicPlayoffBrackets};setupCohort:'intake-a';warmup:{username:string;nativeManagerId:string;nativeLeagueIds:string[];identityUtf8:string;identitySha256:string;discoveryUtf8:string;discoverySha256:string}};digest:string };
/** Shared source-only construction: no worker import, provider request, SQL or synthetic live payload. */
async function fleetShortSource(input:Parameters<typeof buildFleetHealthyManifest>[0]){
  keys(input,['fixtureId','gitSha','plannedPostgresqlVersion']);assert.match(input.fixtureId,/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/u);
  assert.match(input.gitSha,/^[a-f0-9]{40}$/u);assert.match(input.plannedPostgresqlVersion,/^[1-9][0-9]*\.[0-9]+$/u);
  const siteRoot=fileURLToPath(new URL('../',import.meta.url)),repository=fileURLToPath(new URL('../../../',import.meta.url));
  const git=(args:string[])=>execFileSync('git',args,{cwd:repository,encoding:'utf8',windowsHide:true,timeout:2_000}).trim();
  assert.equal(git(['rev-parse','HEAD']),input.gitSha);assert.equal(git(['status','--porcelain']),'','short qualification requires clean exact source');
  const appTreeSha=git(['rev-parse','HEAD:apps/site']);assert.match(appTreeSha,/^[a-f0-9]{40}$/u);
  const{FLEET_SUPPORT_SOURCES,qualificationSourceDigest}=await import('./qualification-profile');
  const sourceFiles=await Promise.all(FLEET_SUPPORT_SOURCES.map(async entry=>{const bytes=await readFile(join(siteRoot,entry.path));
    const lfSha256=qualificationSourceDigest(bytes.toString('utf8'));assert.equal(lfSha256,entry.sourceDigest,'short profile source pin mismatch: '+entry.path);
    return{path:entry.path,sha256:hash(bytes),lfSha256};}));
  return{...input,appTreeSha,sourceFiles};
}
export async function buildFleetLivePlan(input:Parameters<typeof buildFleetHealthyManifest>[0]){
  const source=await fleetShortSource(input),fixtureDigest=capacityDigest(FLEET_LIVE_POLICY);
  const body={kind:'cp26-short-source-plan-v1' as const,profile:FLEET_LIVE_PROFILE as typeof FLEET_LIVE_PROFILE,...source,fixtureDigest,clock:FLEET_SHORT_CLOCK,policy:FLEET_LIVE_POLICY};
  const plan: FleetShortPlan=Object.freeze({...body,digest:capacityDigest(body)});return{plan,sourceFiles:source.sourceFiles};
}
export async function buildFleetOwnershipPlan(input:Parameters<typeof buildFleetHealthyManifest>[0]){
  const source=await fleetShortSource(input),fixtureSeed='cp26-ownership-'+input.fixtureId;
  const{createCapacityFleetFixture}=await import('./freshness-capacity-fixtures');const fixture=createCapacityFleetFixture(fixtureSeed);
  const{PUBLIC_TRANSACTION_HISTORY,PUBLIC_PLAYOFF_BRACKETS}=await import('../lib/league-administration/public-intake-contracts');
  const username='cp26_ownership_warmup',nativeManagerId='9270000000000080001',nativeLeagueIds=fixture.sourceLeagues.filter(row=>fixture.users.find(user=>user.cohort==='accepted')!.leagueKeys.includes(row.key)).slice(0,7).map(row=>row.nativeLeagueId);
  assert.equal(nativeLeagueIds.length,7);const identityUtf8=JSON.stringify({user_id:nativeManagerId,username,display_name:username});
  const discoveryUtf8=JSON.stringify(nativeLeagueIds.map(id=>fixture.prototype.leagues.find(row=>row.nativeLeagueId===id)!.leaguePayload));
  const warmup={username,nativeManagerId,nativeLeagueIds,identityUtf8,identitySha256:hash(identityUtf8),discoveryUtf8,discoverySha256:hash(discoveryUtf8)};
  const body={kind:'cp26-short-source-plan-v1' as const,profile:FLEET_OWNERSHIP_PROFILE as typeof FLEET_OWNERSHIP_PROFILE,...source,fixtureDigest:capacityDigest({baseFixtureDigest:fixture.digest,warmup}),
    clock:FLEET_SHORT_CLOCK,policy:{kind:'cp26-ownership-policy-v1' as const,scenarios:FLEET_OWNERSHIP_SCENARIOS,invocationOffsetsMs:FLEET_OWNERSHIP_OFFSETS,fixtureSeed,
      cohorts:fixture.users.filter(user=>user.cohort!=='auxiliary').map(user=>({cohort:user.cohort,username:user.username,nativeManagerId:user.nativeManagerId,nativeLeagueIds:fixture.sourceLeagues.filter(league=>user.leagueKeys.includes(league.key)).map(league=>league.nativeLeagueId)})),
      initialScope:{seasons:[2026]},resourceScope:{seasons:[2026],exactPeriods:[{season:2026,nativeWeek:7}],transactionHistory:PUBLIC_TRANSACTION_HISTORY,playoffBrackets:PUBLIC_PLAYOFF_BRACKETS},setupCohort:'intake-a' as const,warmup}};
  const plan: FleetShortPlan=Object.freeze({...body,digest:capacityDigest(body)});return{fixture,plan,sourceFiles:source.sourceFiles};
}

export type FleetShortEvidenceInventory={kind:'cp26-short-events-v1';manifestDigest:string;eventCount:number;totalBytes:number;
 chunks:{file:string;index:number;bytes:number;sha256:string;events:number;firstSequence:number;lastSequence:number}[]};
export function assertFleetShortEvidenceInventory(value:unknown):asserts value is FleetShortEvidenceInventory{
 const row=object(value) as unknown as FleetShortEvidenceInventory;keys(row,['kind','manifestDigest','eventCount','totalBytes','chunks']);assert.equal(row.kind,'cp26-short-events-v1');assert.match(row.manifestDigest,/^[a-f0-9]{64}$/u);
 safeInteger(row.eventCount);assert(row.eventCount>0&&row.eventCount<=100_000);safeInteger(row.totalBytes);assert(row.totalBytes>0&&row.totalBytes<=FLEET_EVIDENCE_LIMITS.totalBytes);
 assert(Array.isArray(row.chunks)&&row.chunks.length>0&&row.chunks.length<=FLEET_EVIDENCE_LIMITS.maxChunks);let count=0,total=0;
 for(const[ordinal,chunk]of row.chunks.entries()){keys(chunk,['file','index','bytes','sha256','events','firstSequence','lastSequence']);assert.equal(chunk.index,ordinal);assert.equal(chunk.file,'short-events-'+String(ordinal).padStart(4,'0')+'.json');assert.match(chunk.sha256,/^[a-f0-9]{64}$/u);
  safeInteger(chunk.bytes);assert(chunk.bytes>0&&chunk.bytes<=FLEET_EVIDENCE_LIMITS.chunkBytes);safeInteger(chunk.events);assert(chunk.events>0);assert.equal(chunk.firstSequence,count+1);count+=chunk.events;assert.equal(chunk.lastSequence,count);total+=chunk.bytes;
 }assert.equal(count,row.eventCount);assert.equal(total,row.totalBytes);
}
/** Parent and child retain independent copies of the same complete incremental ledger. */
export async function writeFleetShortEvidence(directory:string,manifestDigest:string,events:readonly import('./freshness-capacity-protocol').FleetShortEvent[]):Promise<FleetShortEvidenceInventory>{
 assert.match(manifestDigest,/^[a-f0-9]{64}$/u);assert(events.length>0&&events.length<=100_000);const chunks:FleetShortEvidenceInventory['chunks']=[];let held:string[]=[],bytes=2,totalBytes=0,completed=0;
 const flush=async()=>{if(!held.length)return;assert(chunks.length<FLEET_EVIDENCE_LIMITS.maxChunks);const raw='['+held.join(',')+']',size=Buffer.byteLength(raw),index=chunks.length,file='short-events-'+String(index).padStart(4,'0')+'.json';totalBytes+=size;assert(totalBytes<=FLEET_EVIDENCE_LIMITS.totalBytes);
  await writeFile(join(directory,file),raw,{flag:'wx',mode:0o600});chunks.push({file,index,bytes:size,sha256:hash(raw),events:held.length,firstSequence:completed+1,lastSequence:completed+held.length});completed+=held.length;held=[];bytes=2;};
 for(const[index,event]of events.entries()){assert.equal(event.eventSequence,index+1);assert.equal(event.manifestDigest,manifestDigest);assertJsonValue(event);const raw=JSON.stringify(event),length=Buffer.byteLength(raw);assert(length+2<=FLEET_EVIDENCE_LIMITS.chunkBytes);if(bytes+length+(held.length?1:0)>FLEET_EVIDENCE_LIMITS.chunkBytes)await flush();bytes+=length+(held.length?1:0);held.push(raw);}await flush();
 const result:FleetShortEvidenceInventory={kind:'cp26-short-events-v1',manifestDigest,eventCount:events.length,totalBytes,chunks};assertFleetShortEvidenceInventory(result);return result;
}
export async function readFleetShortEvidence(directory:string,inventory:FleetShortEvidenceInventory):Promise<import('./freshness-capacity-protocol').FleetShortEvent[]>{
 assertFleetShortEvidenceInventory(inventory);assert.equal(await realpath(directory),resolve(directory));const root=await lstat(directory);assert(root.isDirectory()&&!root.isSymbolicLink());
 assert.deepEqual((await readdir(directory)).sort(),inventory.chunks.map(row=>row.file));const result:import('./freshness-capacity-protocol').FleetShortEvent[]=[];
 for(const chunk of inventory.chunks){const path=join(directory,chunk.file),stat=await lstat(path);assert(stat.isFile()&&!stat.isSymbolicLink());assert.equal(stat.size,chunk.bytes);const bytes=await readFile(path);assert.equal(hash(bytes),chunk.sha256);
  const text=new TextDecoder('utf-8',{fatal:true}).decode(bytes),rows:unknown=JSON.parse(text);assert(Array.isArray(rows)&&rows.length===chunk.events);assert.equal(JSON.stringify(rows),text);for(const value of rows){const event=object(value) as unknown as import('./freshness-capacity-protocol').FleetShortEvent;assert.equal(event.eventSequence,result.length+1);assert.equal(event.manifestDigest,inventory.manifestDigest);result.push(event);}}
 assert.equal(result.length,inventory.eventCount);return result;
}

export type FleetOwnershipProofInventory={kind:'cp26-ownership-parent-v1';manifestDigest:string;documentSha256:string;documentBytes:number;totalBytes:number;chunks:{file:string;index:number;bytes:number;sha256:string;rows:number}[]};
export function assertFleetOwnershipProofInventory(value:unknown):asserts value is FleetOwnershipProofInventory {
 const row=object(value) as unknown as FleetOwnershipProofInventory;keys(row,['kind','manifestDigest','documentSha256','documentBytes','totalBytes','chunks']);assert.equal(row.kind,'cp26-ownership-parent-v1');for(const digest of [row.manifestDigest,row.documentSha256])assert.match(digest,/^[a-f0-9]{64}$/u);safeInteger(row.documentBytes);safeInteger(row.totalBytes);assert(row.documentBytes>0&&row.documentBytes<=FLEET_DOCUMENT_LIMITS.totalDecodedBytes);assert(row.totalBytes>0&&row.totalBytes<=FLEET_EVIDENCE_LIMITS.totalBytes);assert(Array.isArray(row.chunks)&&row.chunks.length>0&&row.chunks.length<=FLEET_EVIDENCE_LIMITS.maxChunks);let bytes=0,parts=0;
 row.chunks.forEach((chunk,index)=>{keys(chunk,['file','index','bytes','sha256','rows']);assert.equal(chunk.index,index);assert.equal(chunk.file,'ownership-parent-'+String(index).padStart(4,'0')+'.json');safeInteger(chunk.bytes);safeInteger(chunk.rows);assert(chunk.bytes>0&&chunk.bytes<=FLEET_EVIDENCE_LIMITS.chunkBytes);assert(chunk.rows>0&&chunk.rows<=FLEET_EVIDENCE_LIMITS.maxRows);assert.match(chunk.sha256,/^[a-f0-9]{64}$/u);bytes+=chunk.bytes;parts+=chunk.rows;});assert.equal(bytes,row.totalBytes);assert.equal(parts,Math.ceil(row.documentBytes/FLEET_DOCUMENT_LIMITS.partBytes));
}
function ownershipParentState(value:unknown):{cases:unknown[];snapshots:unknown[];controls:unknown[]}{const row=object(value);keys(row,['cases','snapshots','controls']);assertJsonValue(row);for(const key of ['cases','snapshots','controls'])assert(Array.isArray(row[key])&&row[key].length<=FLEET_EVIDENCE_LIMITS.maxRows);return row as {cases:unknown[];snapshots:unknown[];controls:unknown[]};}
/** Parent-owned records have a distinct closed document; they never masquerade as child events. */
export async function writeFleetOwnershipProof(directory:string,manifestDigest:string,value:unknown):Promise<FleetOwnershipProofInventory>{
 ownershipParentState(value);assert.match(manifestDigest,/^[a-f0-9]{64}$/u);assert.equal(await realpath(directory),resolve(directory));const stat=await lstat(directory);assert(stat.isDirectory()&&!stat.isSymbolicLink());assert.equal((await readdir(directory)).length,0);const parts=documentRows('ownership-parent-state',value).map(row=>row.value),chunks:FleetOwnershipProofInventory['chunks']=[];let held:string[]=[],size=2,totalBytes=0;
 const flush=async()=>{if(!held.length)return;assert(chunks.length<FLEET_EVIDENCE_LIMITS.maxChunks);const index=chunks.length,file='ownership-parent-'+String(index).padStart(4,'0')+'.json',bytes=Buffer.from('['+held.join(',')+']');totalBytes+=bytes.length;assert(totalBytes<=FLEET_EVIDENCE_LIMITS.totalBytes);await writeFile(join(directory,file),bytes,{flag:'wx',mode:0o600});chunks.push({file,index,bytes:bytes.length,sha256:hash(bytes),rows:held.length});held=[];size=2;};
 for(const part of parts){const text=JSON.stringify(part),length=Buffer.byteLength(text);assert(length+2<=FLEET_EVIDENCE_LIMITS.chunkBytes);if(size+length+(held.length?1:0)>FLEET_EVIDENCE_LIMITS.chunkBytes)await flush();size+=length+(held.length?1:0);held.push(text);}await flush();const inventory:FleetOwnershipProofInventory={kind:'cp26-ownership-parent-v1',manifestDigest,documentSha256:parts[0].documentSha256,documentBytes:parts[0].documentBytes,totalBytes,chunks};assertFleetOwnershipProofInventory(inventory);return inventory;
}
export async function readFleetOwnershipProof(directory:string,inventory:FleetOwnershipProofInventory){
 assertFleetOwnershipProofInventory(inventory);assert.equal(await realpath(directory),resolve(directory));const root=await lstat(directory);assert(root.isDirectory()&&!root.isSymbolicLink());sameRows((await readdir(directory)).sort(),inventory.chunks.map(row=>row.file));const parts:FleetDocumentPart[]=[];
 for(const chunk of inventory.chunks){const path=join(directory,chunk.file),stat=await lstat(path);assert(stat.isFile()&&!stat.isSymbolicLink());assert.equal(await realpath(path),resolve(path));assert.equal(stat.size,chunk.bytes);const bytes=await readFile(path);assert.equal(bytes.length,chunk.bytes);assert.equal(hash(bytes),chunk.sha256);const text=new TextDecoder('utf-8',{fatal:true}).decode(bytes),rows:unknown=JSON.parse(text);assert(Array.isArray(rows));assert.equal(rows.length,chunk.rows);assert.equal(JSON.stringify(rows),text);parts.push(...rows);}
 assert(parts.every(part=>part.documentSha256===inventory.documentSha256&&part.documentBytes===inventory.documentBytes));const restored=reassembleDocuments(parts.map((value,index)=>({stream:'ownership-parent-state' as const,sequence:index+1,value})),['ownership-parent-state'] as const)['ownership-parent-state'];return ownershipParentState(restored);
}

export const FLEET_SHORT_DISPATCH_SQL='SELECT to_jsonb(dispatch) AS dispatch,to_jsonb(dispatch_result) AS outcome FROM public.public_data_dispatches dispatch LEFT JOIN public.public_data_dispatch_outcomes dispatch_result USING(worker_id,generation) WHERE dispatch.intake_id=$1::uuid ORDER BY dispatch.generation,dispatch.worker_id';
export type FleetLiveReaderProof={requestId:string;options:{managerEvidenceVersion:'v2'};value:unknown;queryEventSequences:number[];
 requestRows:unknown[];receiptRows:unknown[];directoryRows:unknown[];candidates:unknown[];dispatchRows:unknown[];retainedRosters:{nativeLeagueId:string;value:unknown}[]};
function shortClock(span:FleetSpan){keys(span,['startedAt','endedAt','monotonicStartMs','monotonicEndMs']);const start=Date.parse(span.startedAt),end=Date.parse(span.endedAt);assert(Number.isFinite(start)&&Number.isFinite(end)&&end>=start);assert.equal(new Date(start).toISOString(),span.startedAt);assert.equal(new Date(end).toISOString(),span.endedAt);assert(Number.isFinite(span.monotonicStartMs)&&span.monotonicStartMs>=0&&Number.isFinite(span.monotonicEndMs)&&span.monotonicEndMs>=span.monotonicStartMs);return{start,end};}
/** Original physical responses determine the whole permitted fan-out; no filtered list qualifies. */
export async function assertFleetLiveTransport(events:readonly import('./freshness-capacity-protocol').FleetShortEvent[]){
 const http=events.filter(row=>row.event.kind==='http');assert(http.length>0&&http.length<=FLEET_LIVE_POLICY.maximumHttp);let total=0;
 const byUrl=new Map<string,typeof http>();for(const row of http){assert.equal(row.event.kind,'http');if(row.event.kind!=='http')throw new Error('HTTP event required');
  assert.equal(row.event.method,'GET');assert.equal(row.event.status,200);assert.equal(row.event.errorCode,null);assert(typeof row.event.rawUtf8==='string');assert.equal(hash(row.event.rawUtf8),row.event.rawSha256);
  const bytes=Buffer.byteLength(row.event.rawUtf8);assert(bytes<=FLEET_LIVE_POLICY.bodyBytes);total+=bytes;assert(total<=FLEET_LIVE_POLICY.totalBodyBytes);shortClock(row.span);
  const url=new URL(row.event.url);assert.equal(url.origin,FLEET_LIVE_POLICY.origin);assert.equal(url.href,row.event.url);assert(!url.search&&!url.hash&&!url.username&&!url.password&&!url.port);
  const group=byUrl.get(row.event.url)??[];group.push(row);byUrl.set(row.event.url,group);
 }assert.deepEqual([...http].sort((a,b)=>a.event.kind==='http'&&b.event.kind==='http'?a.event.ordinal-b.event.ordinal:0).map(row=>row.event.kind==='http'?row.event.ordinal:0),Array.from({length:http.length},(_,i)=>i+1));
 const identityUrl=FLEET_LIVE_POLICY.origin+FLEET_LIVE_POLICY.routes[0],listUrl=FLEET_LIVE_POLICY.origin+FLEET_LIVE_POLICY.routes[1];
 const identity=byUrl.get(identityUrl),discovery=byUrl.get(listUrl);assert.equal(identity?.length,1);assert.equal(discovery?.length,1);
 const payload=(event:typeof http[number])=>{assert(event.event.kind==='http'&&typeof event.event.rawUtf8==='string');return JSON.parse(event.event.rawUtf8);};
 const {normalizeSleeperUserIdentity,normalizeSleeperUserLeagues}=await import('../lib/sleeper');
 const nativeIdentity=normalizeSleeperUserIdentity(payload(identity![0]),FLEET_LIVE_POLICY.username);assert.equal(nativeIdentity.userId,FLEET_LIVE_POLICY.nativeManagerId);assert.equal(nativeIdentity.username.toLowerCase(),FLEET_LIVE_POLICY.username.toLowerCase());
 const raw=fleetRows(payload(discovery![0]));assert(raw.length>=1&&raw.length<=4);const ids=raw.map(row=>{assert(typeof row.league_id==='string'&&/^[1-9][0-9]{0,31}$/u.test(row.league_id));assert.equal(String(row.season),'2026');return row.league_id;});assert.equal(new Set(ids).size,ids.length);
 const normalized=normalizeSleeperUserLeagues(raw,'2026',discovery![0].span.endedAt);sameRows(normalized.map(row=>row.id).sort(),[...ids].sort());assert(shortClock(identity![0].span).end<=shortClock(discovery![0].span).start);
 const allowed=new Set([identityUrl,listUrl]);for(const id of ids){const base=FLEET_LIVE_POLICY.origin+'/v1/league/'+id;
  for(const[suffix,count]of [['',2],['/rosters',1],['/users',1]]as const){const url=base+suffix;allowed.add(url);const group=byUrl.get(url);assert.equal(group?.length,count,'live native endpoint count differs');for(const event of group!)assert(shortClock(event.span).start>=shortClock(discovery![0].span).end,'native fan-out preceded complete discovery');}}
 assert([...byUrl.keys()].every(url=>allowed.has(url)),'unplanned live endpoint');assert.equal(http.length,2+4*ids.length);
 return{nativeLeagueIds:ids.sort(),http,totalBytes:total,identity:identity![0],discovery:discovery![0]};
}
/** Execute the maintained stored-only reader against its exact original SQL result transcript. */
export async function replayFleetLiveReader(event:import('./freshness-capacity-protocol').FleetShortEvent,events:readonly import('./freshness-capacity-protocol').FleetShortEvent[]){
 assert(event.event.kind==='record'&&event.event.name==='reader');const proof=object(event.event.value) as unknown as FleetLiveReaderProof;
 keys(proof,['requestId','options','value','queryEventSequences','requestRows','receiptRows','directoryRows','candidates','dispatchRows','retainedRosters']);sameRows(proof.options,{managerEvidenceVersion:'v2'});assert.match(proof.requestId,/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/u);
 assert(Array.isArray(proof.queryEventSequences)&&proof.queryEventSequences.length>0);assert.equal(new Set(proof.queryEventSequences).size,proof.queryEventSequences.length);const outer=shortClock(event.span);
 const transcript=proof.queryEventSequences.map(sequence=>{const row=events.find(row=>row.eventSequence===sequence);assert(row&&row.event.kind==='sql'&&row.event.outcome==='success'&&row.event.rows);const clock=shortClock(row.span);assert(clock.start>=outer.start&&clock.end<=outer.end);return{row,used:false};});
 const database:import('../lib/database').DatabaseClient={enabled:true,query:(async(sql:string,params:readonly unknown[]=[])=>{const matches=transcript.filter(entry=>!entry.used&&entry.row.event.kind==='sql'&&entry.row.event.query===sql&&capacityDigest(entry.row.event.params)===capacityDigest(params));assert(matches.length,'unrecorded live reader query');if(matches.length>1)for(const match of matches)sameRows(match.row.event.kind==='sql'?match.row.event.rows:null,matches[0].row.event.kind==='sql'?matches[0].row.event.rows:null);const selected=matches[0];selected.used=true;assert(selected.row.event.kind==='sql');return selected.row.event.rows;}) as import('../lib/database').DatabaseClient['query']};
 const{CAPACITY_INTAKE_REQUEST_SQL,CAPACITY_INTAKE_CANDIDATES_SQL,CAPACITY_ENDPOINT_RECEIPTS_SQL,CAPACITY_ENDPOINT_DIRECTORIES_SQL}=await import('./freshness-capacity-observer');
 for(const[sql,expected]of [[CAPACITY_INTAKE_REQUEST_SQL,proof.requestRows],[CAPACITY_INTAKE_CANDIDATES_SQL,proof.candidates],[CAPACITY_ENDPOINT_RECEIPTS_SQL,proof.receiptRows],[CAPACITY_ENDPOINT_DIRECTORIES_SQL,proof.directoryRows],[FLEET_SHORT_DISPATCH_SQL,proof.dispatchRows]]as const)sameRows(await database.query(sql,[proof.requestId]),expected);
 const{createLeagueAdministrationStore}=await import('../lib/league-administration/store'),{readPublicSleeperIntake}=await import('../lib/league-administration/public-intake-reader');const store=createLeagueAdministrationStore(database);
 const actual=await readPublicSleeperIntake(database,store,proof.requestId,proof.options),retained=object(proof.value);assert.equal(actual.status,'available');assert.equal(retained.status,'available');const originalAt=Date.parse(String(retained.readAt));assert(originalAt>=outer.start&&originalAt<=outer.end);const{readAt:volatile,...body}=object(actual),{readAt:original,...saved}=retained;void volatile;void original;sameRows(body,saved);
 const candidates=fleetRows(proof.candidates).map(row=>object(row.candidate));assert.equal(proof.retainedRosters.length,candidates.length);assert.equal(new Set(proof.retainedRosters.map(row=>row.nativeLeagueId)).size,candidates.length);
 for(const candidate of candidates){const expected=proof.retainedRosters.find(row=>row.nativeLeagueId===candidate.external_league_id);assert(expected);const roster=await store.readRosterPlayerLinks({rosterReceiptId:String(candidate.players_receipt_id),leagueSeasonId:String(candidate.league_season_id)});assert.equal(roster.status,'available');sameRows(roster,expected.value);}
 assert(transcript.every(row=>row.used),'unused live reader transcript');return proof;
}
async function assertFleetShortSessionEvidence(events:readonly import('./freshness-capacity-protocol').FleetShortEvent[],config:FleetConfig,ready:FleetMessage){const protocol=await import('./freshness-capacity-protocol');
 const sessions=events.filter(row=>row.event.kind==='record'&&row.event.name==='session');assert.equal(sessions.length,1);const sessionEvent=sessions[0];assert.equal(sessionEvent.commandSequence,0);assert(sessionEvent.event.kind==='record');const session=object(sessionEvent.event.value);keys(session,['sql','pinned','http']);assert(typeof session.sql==='string'&&session.sql.includes('current_user,session_user,current_database()')&&session.sql.includes("current_setting('neon.branch_id',true)")&&session.sql.includes('pg_backend_pid()'));
 for(const kind of ['pinned','http']){const entry=object(session[kind]);keys(entry,['row','span']);protocol.assertFleetSpan(entry.span as FleetSpan);assert(shortClock(entry.span as FleetSpan).end<=shortClock(sessionEvent.span).end);const row=object(entry.row);assert.equal(row.current_user,'league_one_runtime');assert.equal(row.session_user,'league_one_runtime');assert.equal(row.database,config.expectedDatabase);assert.equal(row.branch,config.expectedBranch);assert.equal(row.elevated,false);assert.equal(String(row.version).split(' ')[0],config.plannedPostgresqlVersion);assert(Number.isSafeInteger(Number(row.pid))&&Number(row.pid)>1);if(kind==='pinned'){assert.equal(Number(row.pid),ready.backendPid);assert.equal(row.backend_start,ready.backendStart);}}
}
export async function assertFleetLiveEvidence(input:{plan:FleetShortPlan;config:FleetConfig;ready:FleetMessage;calls:FleetMessage[];events:import('./freshness-capacity-protocol').FleetShortEvent[]}){
 const{plan,config,ready,calls,events}=input;assert.equal(plan.profile,FLEET_LIVE_PROFILE);assert.equal(config.profile,FLEET_LIVE_PROFILE);assert.equal(config.manifestDigest,plan.digest);assert.equal(config.fixtureDigest,capacityDigest(FLEET_LIVE_POLICY));const{digest,...body}=plan;assert.equal(digest,capacityDigest(body));sameRows(plan.policy,FLEET_LIVE_POLICY);sameRows(plan.clock,FLEET_SHORT_CLOCK);
 const protocol=await import('./freshness-capacity-protocol');protocol.parseFleetMessage(ready,config,ready.pid);assert.equal(ready.type,'ready');assert.deepEqual(calls.map(row=>row.action),['prepare-live','run-live','snapshot']);
 for(const[index,call]of calls.entries()){protocol.parseFleetMessage(call,config,ready.pid);assert.equal(call.sequence,index+1);assert.equal(call.error,false);assert.equal(call.backendPid,ready.backendPid);assert.equal(call.backendStart,ready.backendStart);}
 const run=shortClock(calls[1].span);let eventBytes=0;for(const[index,event]of events.entries()){protocol.parseFleetShortEvent(event,config,ready.pid,index+1);assert.equal(event.backendPid,ready.backendPid);assert.equal(event.backendStart,ready.backendStart);eventBytes+=Buffer.byteLength(JSON.stringify(event));assert(eventBytes<=FLEET_EVIDENCE_LIMITS.totalBytes);assert(event.event.kind!=='failure');if(event.event.kind==='sql')assert.equal(event.event.outcome,'success');}

 await assertFleetShortSessionEvidence(events,config,ready);
 for(const event of events){if(event.commandSequence===0){assert(shortClock(event.span).end<=shortClock(ready.span).end);continue;}const call=calls.find(row=>row.sequence===event.commandSequence);assert(call,'event has no actual command result');const outer=shortClock(call.span),clock=shortClock(event.span);assert(clock.start>=outer.start&&clock.end<=outer.end);assert(event.commandSequence<=2,'snapshot cannot invent evidence');}
 const transport=await assertFleetLiveTransport(events),started=events.filter(row=>row.event.kind==='invocation'&&row.event.phase==='started'),completed=events.filter(row=>row.event.kind==='invocation'&&row.event.phase==='completed');assert.equal(started.length,3);assert.equal(completed.length,3);
 let totalSteps=0,totalRequests=0;const origins:number[]=[],invocations:Record<string,unknown>[]=[];
 for(let slot=0;slot<3;slot++){const begins=started.filter(row=>row.event.kind==='invocation'&&row.event.slot===slot),ends=completed.filter(row=>row.event.kind==='invocation'&&row.event.slot===slot);assert.equal(begins.length,1);assert.equal(ends.length,1);const begin=begins[0],end=ends[0];assert(begin.event.kind==='invocation'&&end.event.kind==='invocation');const origin=begin.event.invocationStartedAt;origins.push(origin);assert.equal(origin,origins[0]+FLEET_LIVE_POLICY.slotOffsetsMs[slot]);assert.equal(end.event.invocationStartedAt,origin);const actualStart=shortClock(begin.span).start,actualEnd=shortClock(end.span).end;assert(actualStart>=origin&&actualStart<=origin+1_000);assert(actualEnd<=origin+22_000);assert(origin>=run.start&&actualEnd<=run.end);const result=object(end.event.result);assert(['progress','complete','idle','deadline'].includes(String(result.status)));assert.notEqual(result.stopReason,'failed');keys(result,['status','providerRequests','completedSteps','stopReason']);assert(typeof result.completedSteps==='number'&&typeof result.providerRequests==='number');safeInteger(result.completedSteps);safeInteger(result.providerRequests);totalSteps+=result.completedSteps;totalRequests+=result.providerRequests;
  const physical=transport.http.filter(row=>shortClock(row.span).start>=origin&&shortClock(row.span).end<=origin+20_000);assert.equal(physical.length,result.providerRequests);invocations.push({owner:'data-refresh',span:{startedAt:origin,endedAt:origin+20_000,monotonicStartedAt:begin.span.monotonicStartMs,monotonicEndedAt:end.span.monotonicEndMs}});
 }assert.equal(totalSteps,2+3*transport.nativeLeagueIds.length);assert.equal(totalRequests,transport.http.length);
 const submissions=events.filter(row=>row.event.kind==='record'&&row.event.name==='submission');assert.equal(submissions.length,1);assert(submissions[0].event.kind==='record');const submission=object(submissions[0].event.value),submissionInput=object(submission.input),receipt=object(submission.result);sameRows(submissionInput,{id:submissionInput.id,username:FLEET_LIVE_POLICY.username,seasons:[2026]});assert.equal(receipt.status,'retained');assert.equal(receipt.requestId,submissionInput.id);
 const reads=events.filter(row=>row.event.kind==='record'&&row.event.name==='reader');assert.equal(reads.length,1);const read=reads[0],proof=await replayFleetLiveReader(read,events);assert.equal(proof.requestId,receipt.requestId);assert(transport.http.every(row=>shortClock(row.span).end<=shortClock(read.span).start));
 const requests=fleetRows(proof.requestRows);assert.equal(requests.length,1);const request=requests[0],stored=object(request.stored_request);assert.equal(stored.id,proof.requestId);assert.equal(stored.terminal,true);assert.equal(stored.revision,totalSteps);assert.equal(stored.failure_count,0);assert.equal(stored.username,FLEET_LIVE_POLICY.username);sameRows(stored.seasons,[2026]);sameRows(stored.exact_periods,[]);for(const key of ['resource_occurrence_id','period_inventory','transaction_period','transaction_history','playoff_brackets','draft_picks','submission_capacity'])assert.equal(stored[key],null);sameRows(stored.weekly_reports,[]);
 const candidates=fleetRows(proof.candidates).map(row=>object(row.candidate));sameRows(candidates.map(row=>row.external_league_id).sort(),transport.nativeLeagueIds);assert(candidates.every(row=>row.stage==='complete'&&row.season===2026));const receiptRows=fleetRows(proof.receiptRows),directories=fleetRows(proof.directoryRows);assert.equal(receiptRows.length,4*candidates.length);assert.equal(directories.length,candidates.length);
 const attempts=new Map<string,Record<string,unknown>>(),responses=new Map<string,Record<string,unknown>>();for(const row of transport.http){assert(row.event.kind==='http');const id=String(row.eventSequence),url=new URL(row.event.url),clock=shortClock(row.span);attempts.set(id,{id,owner:'data-refresh',outcome:'success',at:clock.start,endedAt:clock.end,origin:url.origin,path:url.pathname,method:'GET'});responses.set(id,{attemptId:id,endpointId:row.event.url,rawUtf8:row.event.rawUtf8,requestStartedAt:clock.start,responseCompletedAt:clock.end});}
 const span={startedAt:shortClock(read.span).start,endedAt:shortClock(read.span).end,monotonicStartedAt:read.span.monotonicStartMs,monotonicEndedAt:read.span.monotonicEndMs};
 const dispatches=new Map<string,Record<string,unknown>>();
 async function lineage(record:Record<string,unknown>,kind:string,proofId:unknown,payload:unknown,start:unknown,end:unknown,url:string){const from=Date.parse(String(start)),to=Date.parse(String(end));const matches=[...responses.entries()].filter(([,value])=>value.endpointId===url&&Number(value.requestStartedAt)>=from&&Number(value.responseCompletedAt)<=to&&capacityDigest(JSON.parse(String(value.rawUtf8)))===capacityDigest(payload));assert.equal(matches.length,1,'ambiguous live capture span');const[id,response]=matches[0];await assertFleetEndpointLineage({requestId:proof.requestId,endpointId:response.endpointId,proofId,attemptId:id,kind,record,readSpan:span},responses,attempts,invocations);const dispatch=object(record.dispatch),outcome=object(record.outcome);assert.equal(dispatch.intake_id,proof.requestId);assert.equal(outcome.outcome,'checkpoint-committed');assert.equal(outcome.worker_id,dispatch.worker_id);assert.equal(outcome.generation,dispatch.generation);const key=dispatch.worker_id+':'+dispatch.generation;if(dispatches.has(key))sameRows(dispatches.get(key),dispatch);else dispatches.set(key,dispatch);}
 for(const record of receiptRows){const content=object(record.content),captured=object(record.receipt),provenance=object(captured.provenance);assert(transport.nativeLeagueIds.includes(String(content.external_league_id)));assert.equal(object(object(object(record.attempt).source_mapping).scope).season,2026);const family=String(content.family);assert(['league','rosters'].includes(family));await lineage(record,'resource-receipt',captured.id,content.payload,provenance.requestStartedAt,provenance.requestCompletedAt,FLEET_LIVE_POLICY.origin+'/v1/league/'+content.external_league_id+(family==='rosters'?'/rosters':''));}
 for(const record of directories){const capture=object(record.capture),content=object(record.content);assert(transport.nativeLeagueIds.includes(String(content.external_league_id)));await lineage(record,'users-directory',capture.id,content.payload,capture.request_started_at,capture.request_completed_at,FLEET_LIVE_POLICY.origin+'/v1/league/'+content.external_league_id+'/users');}
 const discovery=fleetRows(request.discovery_dispatches);assert.equal(discovery.length,2);const lists=fleetRows(request.lists);assert.equal(lists.length,1);for(const resource of ['identity','leagues']){const record=discovery.find(row=>object(row.dispatch).resource===resource);assert(record);const stored=resource==='identity'?object(request.identity):lists[0];await lineage({...record,stored},resource==='identity'?'identity-observation':'league-list',proof.requestId,stored.payload,stored.request_started_at,stored.request_completed_at,resource==='identity'?FLEET_LIVE_POLICY.origin+FLEET_LIVE_POLICY.routes[0]:FLEET_LIVE_POLICY.origin+FLEET_LIVE_POLICY.routes[1]);}

 const allDispatches=fleetRows(proof.dispatchRows);assert.equal(allDispatches.length,totalSteps);assert.equal(new Set(allDispatches.map(row=>object(row.dispatch).worker_id+':'+object(row.dispatch).generation)).size,totalSteps);
 const {parsePublicCaptureWitness}=await import('../lib/league-administration/public-capture-witness');
 for(const candidate of candidates){const rows=allDispatches.filter(row=>object(row.dispatch).resource==='bootstrap'&&object(object(row.dispatch).work).externalLeagueId===candidate.external_league_id);assert.equal(rows.length,1);const record=rows[0],dispatch=object(record.dispatch),outcome=object(record.outcome),witness=parsePublicCaptureWitness(outcome.capture_acquisition);sameRows(witness.work,dispatch.work);assert.equal(witness.work.kind,'bootstrap');assert.equal(witness.work.requestId,proof.requestId);assert.equal(witness.mapping,null);assert.equal(witness.fence.workerId,dispatch.worker_id);assert.equal(witness.fence.generation,Number(dispatch.generation));assert.equal(witness.dispatchNonce,dispatch.capture_nonce);assert.equal(outcome.outcome,'checkpoint-committed');assert.equal(dispatch.intake_id,proof.requestId);assert.equal(dispatch.max_requests,1);
  const start=Date.parse(String(candidate.bootstrap_started_at)),end=Date.parse(String(candidate.bootstrap_completed_at));assert(Number.isFinite(start)&&Number.isFinite(end)&&end>=start);assert(Date.parse(String(dispatch.admitted_at))<=start+1);assert(Date.parse(String(outcome.recorded_at))>=end-1&&Date.parse(String(outcome.recorded_at))<=shortClock(read.span).end);
  const matches=transport.http.filter(row=>row.event.kind==='http'&&row.event.url===FLEET_LIVE_POLICY.origin+'/v1/league/'+candidate.external_league_id&&shortClock(row.span).start>=start&&shortClock(row.span).end<=end);assert.equal(matches.length,1);assert(matches[0].event.kind==='http');sameRows(JSON.parse(matches[0].event.rawUtf8!),candidate.bootstrap_payload);
  assert.equal(invocations.filter(inv=>{const clock=object(inv.span);return Number(clock.startedAt)<=start&&end<=Number(clock.endedAt)&&Date.parse(witness.fence.deadlineAt)===Number(clock.startedAt)+20_000;}).length,1);dispatches.set(dispatch.worker_id+':'+dispatch.generation,dispatch);
 }
 assert.equal(dispatches.size,totalSteps);assert.equal([...dispatches.values()].reduce((sum,row)=>sum+Number(row.max_requests),0),totalRequests);
 for(const row of allDispatches){const dispatch=object(row.dispatch),outcome=object(row.outcome);sameRows(dispatches.get(dispatch.worker_id+':'+dispatch.generation),dispatch);assert.equal(outcome.worker_id,dispatch.worker_id);assert.equal(outcome.generation,dispatch.generation);assert.equal(outcome.outcome,'checkpoint-committed');}
 sameRows([...dispatches.values()].map(row=>row.revision).sort((a,b)=>Number(a)-Number(b)),Array.from({length:totalSteps},(_,i)=>i));
 for(const candidate of candidates){const retained=proof.retainedRosters.find(row=>row.nativeLeagueId===candidate.external_league_id)!;const typed=object(retained.value),teams=fleetRows(typed.teams);assert(teams.length>0,'empty canonical team proof');const raw=transport.http.find(row=>row.event.kind==='http'&&row.event.url.endsWith('/'+candidate.external_league_id+'/rosters'))!;assert(raw.event.kind==='http');const native=fleetRows(JSON.parse(raw.event.rawUtf8!));assert(native.length>0);sameRows(teams.map(row=>String(row.externalRosterId)).sort(),native.map(row=>String(row.roster_id)).sort());assert.equal(new Set(teams.map(row=>row.seasonTeamId)).size,teams.length);for(const team of teams)assert.match(String(team.seasonTeamId),/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/u);assert.equal(object(typed.mapping).leagueSeasonId,candidate.league_season_id);assert.equal(typed.rosterReceiptId,candidate.players_receipt_id);}

 return{nativeLeagueIds:transport.nativeLeagueIds,physicalRequests:totalRequests,completedSteps:totalSteps,typedReceipts:receiptRows.length,directoryCaptures:directories.length,readerSqlQueries:proof.queryEventSequences.length};
}

/** Both graphs have already passed the exact canonical JSON decoder. Compare without a second full serialized copy. */
export function assertFleetRawFinalDocuments(raw:Record<string,unknown>,final:Record<string,unknown>):void{
 for(const stream of FLEET_RAW_EVIDENCE_STREAMS){assert(Object.hasOwn(raw,stream)&&Object.hasOwn(final,stream),'missing raw/final evidence: '+stream);assert(isDeepStrictEqual(raw[stream],final[stream]),'raw/final evidence changed: '+stream);}
}


export type FleetLiveCompanion={kind:'cp26-fleet-live-evidence-v1';contextDigest:string;config:FleetConfig;ready:FleetMessage;calls:FleetMessage[];
 cases:{name:string;state:string;span:FleetSpan}[];childDirectory:string;childInventory:FleetShortEvidenceInventory;parentDirectory:string;parentInventory:FleetShortEvidenceInventory;
 cleanup:{childClosed:boolean;backendGone:boolean;locksGone:boolean;connectionsClosed:boolean};cleanupAttempts:{span:FleetSpan;facts:FleetLiveCompanion['cleanup'];backendRows:unknown[];lockRows:unknown[]}[];
 childExit:{code:number|null;signal:string|null};forcedStop:boolean;actualServer:{version:string;versionNum:string}};
/** Closed short-profile envelope; successful labels cannot replace immutable events or cleanup query results. */
export async function assertFleetLiveCompanionEnvelope(value:unknown,binding:QualificationBinding):Promise<FleetLiveCompanion>{
 const row=object(value)as unknown as FleetLiveCompanion;keys(row,['kind','contextDigest','config','ready','calls','cases','childDirectory','childInventory','parentDirectory','parentInventory','cleanup','cleanupAttempts','childExit','forcedStop','actualServer']);
 const protocol=await import('./freshness-capacity-protocol'),config=protocol.parseFleetConfig(row.config);assert.equal(row.kind,'cp26-fleet-live-evidence-v1');assert.equal(config.profile,FLEET_LIVE_PROFILE);assert.equal(binding.context.profile,FLEET_LIVE_PROFILE);
 assert.equal(config.contextNonce,binding.context.nonce);assert.equal(config.gitSha,binding.context.gitSha);assert.equal(config.profileDigest,binding.context.profileDigest);assert.equal(row.contextDigest,hash(JSON.stringify(binding.context)));
 assert.equal(row.childDirectory,'fleet-raw-'+config.nonce);assert.equal(row.parentDirectory,'fleet-final-'+config.nonce);assert.equal(config.evidenceDirectory,resolve(binding.directory,row.childDirectory));
 for(const inventory of [row.childInventory,row.parentInventory]){assertFleetShortEvidenceInventory(inventory);assert.equal(inventory.manifestDigest,config.manifestDigest);assert(inventory.eventCount>0);}sameRows(row.childInventory,row.parentInventory);
 const ready=protocol.parseFleetMessage(row.ready,config,row.ready.pid);assert.equal(ready.type,'ready');assert.equal(ready.inventory,null);let prior=shortClock(ready.span).end;assert(config.workDeadlineAt-prior<=FLEET_SHORT_CLOCK.workMs);
 assert.deepEqual(row.calls.map(call=>call.action),['prepare-live','run-live','snapshot']);for(const[index,value]of row.calls.entries()){const call=protocol.parseFleetMessage(value,config,ready.pid);assert.equal(call.type,'result');assert.equal(call.sequence,index+1);assert.equal(call.error,false);assert.equal(call.inventory,null);assert.equal(call.backendPid,ready.backendPid);assert.equal(call.backendStart,ready.backendStart);const clock=shortClock(call.span);assert(clock.start>=prior);prior=clock.end;assert(prior<=config.workDeadlineAt);}
 sameRows(object(row.calls[1].result).evidenceInventory,row.childInventory);sameRows(object(row.calls[2].result).evidenceInventory,row.childInventory);assert.equal(object(row.calls[2].result).eventCount,row.childInventory.eventCount);
 assert.equal(row.cases.length,FLEET_LIVE_TESTS.length);prior=0;for(const[index,item]of row.cases.entries()){keys(item,['name','state','span']);assert.equal(item.name,FLEET_LIVE_TESTS[index]);assert.equal(item.state,'passed');protocol.assertFleetSpan(item.span);const clock=shortClock(item.span);assert(clock.start>=prior);prior=clock.end;}
 assert(shortClock(row.cases[0].span).start<=shortClock(row.calls[0].span).start&&shortClock(row.cases[0].span).end>=shortClock(row.calls[2].span).end);
 keys(row.cleanup,['childClosed','backendGone','locksGone','connectionsClosed']);assert(Object.values(row.cleanup).every(value=>value===true));keys(row.childExit,['code','signal']);assert.equal(row.childExit.code,0);assert.equal(row.childExit.signal,null);assert.equal(row.forcedStop,false);
 assert(Array.isArray(row.cleanupAttempts)&&row.cleanupAttempts.length>0);let cleanupEnd=shortClock(row.calls[2].span).end;for(const attempt of row.cleanupAttempts){keys(attempt,['span','facts','backendRows','lockRows']);protocol.assertFleetSpan(attempt.span);const clock=shortClock(attempt.span);assert(clock.start>=cleanupEnd);cleanupEnd=clock.end;sameRows(attempt.facts,row.cleanup);assert.deepEqual(attempt.backendRows,[]);assert.deepEqual(attempt.lockRows,[]);}assert(cleanupEnd<=shortClock(row.cases[2].span).end);
 keys(row.actualServer,['version','versionNum']);assert.equal(row.actualServer.version.split(' ')[0],config.plannedPostgresqlVersion);const[major,minor]=config.plannedPostgresqlVersion.split('.').map(Number);assert.equal(row.actualServer.versionNum,String(major*10000+minor));return row;
}
export async function validateFleetLiveCompanion(value:unknown,binding:QualificationBinding){
 const companion=await assertFleetLiveCompanionEnvelope(value,binding);assert.equal(await realpath(binding.directory),resolve(binding.directory));const stat=await lstat(binding.directory);assert(stat.isDirectory()&&!stat.isSymbolicLink());
 const child=await readFleetShortEvidence(join(binding.directory,companion.childDirectory),companion.childInventory),parent=await readFleetShortEvidence(join(binding.directory,companion.parentDirectory),companion.parentInventory);assert(isDeepStrictEqual(child,parent),'child and independently retained parent events differ');
 const config=companion.config,{plan}=await buildFleetLivePlan({fixtureId:config.fixtureId,gitSha:config.gitSha,plannedPostgresqlVersion:config.plannedPostgresqlVersion});assert.equal(plan.digest,config.manifestDigest);assert.equal(plan.fixtureDigest,config.fixtureDigest);
 return assertFleetLiveEvidence({plan,config,ready:companion.ready,calls:companion.calls,events:parent});
}

export const FLEET_OWNERSHIP_SNAPSHOT_SQL="SELECT jsonb_build_object(\n    'jobs',(SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY job_key),'[]') FROM public.projection_jobs x),\n    'intakes',(SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY id),'[]') FROM public.public_data_intakes x),\n    'dispatches',(SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY generation,worker_id),'[]') FROM public.public_data_dispatches x),\n    'outcomes',(SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY generation,worker_id),'[]') FROM public.public_data_dispatch_outcomes x),\n    'selections',(SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY generation,worker_id),'[]') FROM public.public_data_resource_selections x),\n    'selectionFailures',(SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY selection_id),'[]') FROM public.public_data_resource_selection_failures x),\n    'resources',(SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY id),'[]') FROM public.public_data_resources x),\n    'occurrences',(SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY id),'[]') FROM public.public_data_resource_occurrences x),\n    'service',(SELECT coalesce(jsonb_agg(to_jsonb(x)),'[]') FROM public.public_data_resource_service x),\n    'targets',(SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY id),'[]') FROM public.public_data_refresh_targets x)) AS state";

type FleetOwnershipWorkerEvidence={config:FleetConfig;ready:FleetMessage;calls:FleetMessage[];events:import('./freshness-capacity-protocol').FleetShortEvent[];exit:{code:number|null;signal:string|null};forcedStop:boolean;cleanup:{childClosed:boolean;backendGone:boolean;locksGone:boolean};cleanupAttempts:Record<string,unknown>[]};
function fleetRecordedDatabase(value:unknown){
 const record=object(value),outer=shortClock(record.span as FleetSpan),queries=fleetRows(record.queries).map(row=>({row,used:false}));assert(queries.length>0);
 for(const{row}of queries){keys(row,['sql','params','rows','errorCode','span']);assert(typeof row.sql==='string'&&Array.isArray(row.params));assert(row.rows===null||Array.isArray(row.rows));const span=shortClock(row.span as FleetSpan);assert(span.start>=outer.start&&span.end<=outer.end);assert(row.errorCode===null||typeof row.errorCode==='string');}
 const database:import('../lib/database').DatabaseClient={enabled:true,query:(async(sql:string,params:readonly unknown[]=[])=>{const entry=queries.find(entry=>!entry.used&&entry.row.sql===sql&&isDeepStrictEqual(entry.row.params,params));assert(entry,'unrecorded ownership proof query');entry.used=true;if(entry.row.errorCode!==null){assert.equal(entry.row.rows,null);throw Object.assign(new Error('Recorded rejected ownership query'),{code:entry.row.errorCode});}assert(Array.isArray(entry.row.rows));return entry.row.rows;})as import('../lib/database').DatabaseClient['query']};
 return{database,done:()=>assert(queries.every(entry=>entry.used),'unused ownership proof query')};
}
/** Pure reconciliation of independent-session boundary evidence; no supplied case result substitutes for SQL history. */
export async function assertFleetOwnershipEvidence(value:unknown){
 const input=object(value);keys(input,['plan','epoch','schedule','workers','cases','snapshots','controls']);const plan=input.plan as FleetShortPlan;assert.equal(plan.profile,FLEET_OWNERSHIP_PROFILE);assert(plan.policy.kind==='cp26-ownership-policy-v1');const policy=plan.policy,{digest,...body}=plan;assert.equal(digest,capacityDigest(body));sameRows(plan.clock,FLEET_SHORT_CLOCK);sameRows(policy.invocationOffsetsMs,FLEET_OWNERSHIP_OFFSETS);
 const epoch=Number(input.epoch);safeInteger(epoch);assert(epoch>0);const protocol=await import('./freshness-capacity-protocol'),stores=await import('../lib/league-administration/store');
 const fixture=(await import('./freshness-capacity-fixtures')).createCapacityFleetFixture(policy.fixtureSeed);assert.equal(policy.fixtureSeed,'cp26-ownership-'+plan.fixtureId);assert.equal(plan.fixtureDigest,capacityDigest({baseFixtureDigest:fixture.digest,warmup:policy.warmup}));const nativeBodies=new Map(fixture.endpointInventory.filter(endpoint=>endpoint.method==='GET').map(endpoint=>{const version=endpoint.versions.find(row=>row.publication.kind==='initial');assert(version);return[endpoint.url,version.utf8];}));nativeBodies.set('https://api.sleeper.app/v1/user/'+policy.warmup.username,policy.warmup.identityUtf8);nativeBodies.set('https://api.sleeper.app/v1/user/'+policy.warmup.nativeManagerId+'/leagues/nfl/2026',policy.warmup.discoveryUtf8);assert.equal(hash(policy.warmup.identityUtf8),policy.warmup.identitySha256);assert.equal(hash(policy.warmup.discoveryUtf8),policy.warmup.discoverySha256);
 const workers=fleetRows(input.workers)as unknown as FleetOwnershipWorkerEvidence[],byNonce=new Map<string,FleetOwnershipWorkerEvidence>();assert(workers.length===12);const pids=new Set<number>(),backends=new Set<string>();let totalBytes=0;
 for(const worker of workers){keys(worker,['config','ready','calls','events','exit','forcedStop','cleanup','cleanupAttempts']);const config=protocol.parseFleetConfig(worker.config);assert.equal(config.profile,FLEET_OWNERSHIP_PROFILE);assert.equal(config.fixtureId,plan.fixtureId);assert.equal(config.fixtureDigest,plan.fixtureDigest);assert.equal(config.manifestDigest,plan.digest);assert.equal(config.gitSha,plan.gitSha);assert(!byNonce.has(config.nonce));byNonce.set(config.nonce,worker);const ready=protocol.parseFleetMessage(worker.ready,config,worker.ready.pid);assert.equal(ready.type,'ready');assert(!pids.has(ready.pid));pids.add(ready.pid);const backend=ready.backendPid+':'+ready.backendStart;assert(!backends.has(backend));backends.add(backend);assert(epoch+FLEET_OWNERSHIP_OFFSETS.at(-1)!+22_000<=config.workDeadlineAt);
  let last=0;for(const call of worker.calls){protocol.parseFleetMessage(call,config,ready.pid);assert.equal(call.type,'result');assert.equal(call.error,false);assert.equal(call.inventory,null);assert(call.sequence>last);last=call.sequence;assert.equal(call.backendPid,ready.backendPid);assert.equal(call.backendStart,ready.backendStart);}
  for(const[index,event]of worker.events.entries()){protocol.parseFleetShortEvent(event,config,ready.pid,index+1);assert.equal(event.backendPid,ready.backendPid);assert.equal(event.backendStart,ready.backendStart);totalBytes+=Buffer.byteLength(JSON.stringify(event)+'\n');assert(totalBytes<=FLEET_EVIDENCE_LIMITS.totalBytes,'aggregate ownership events exceed bound');assert.notEqual(event.event.kind,'failure');if(event.event.kind==='http'){assert.equal(event.event.status,200);assert.equal(event.event.errorCode,null);assert.equal(event.event.rawUtf8,nativeBodies.get(event.event.url),'ownership response differs from frozen native source');assert(typeof event.event.rawUtf8==='string');assert.equal(event.event.rawSha256,hash(event.event.rawUtf8));}if(event.event.kind==='sql'&&event.event.outcome==='failed'){assert.equal(event.event.errorCode,'42501');assert(worker.calls.some(call=>call.sequence===event.commandSequence&&call.action==='ownership-acl'));}}
  await assertFleetShortSessionEvidence(worker.events,config,ready);const physical=worker.events.filter(row=>row.event.kind==='http');physical.forEach((row,index)=>{assert(row.event.kind==='http');assert.equal(row.event.ordinal,index+1);});for(const event of worker.events){if(event.commandSequence===0){assert(event.event.kind==='record'&&event.event.name==='session');assert(shortClock(event.span).end<=shortClock(ready.span).end);}else{assert(event.commandSequence===1||event.commandSequence===2&&worker.calls.some(call=>call.sequence===2&&call.action==='ownership-acl'));const call=worker.calls.find(row=>row.sequence===event.commandSequence);if(call){const outer=shortClock(call.span),inner=shortClock(event.span);assert(inner.start>=outer.start&&inner.end<=outer.end);}else assert(worker.forcedStop&&event.commandSequence===1);}}
  keys(worker.cleanup,['childClosed','backendGone','locksGone']);assert(Object.values(worker.cleanup).every(row=>row===true));assert(typeof worker.forcedStop==='boolean');keys(worker.exit,['code','signal']);if(!worker.forcedStop)sameRows(worker.exit,{code:0,signal:null});else assert(worker.exit.code!==0||worker.exit.signal!==null,'hard death cannot be normal closure');
  assert(worker.cleanupAttempts.length>0);for(const attempt of worker.cleanupAttempts){keys(attempt,['span','facts','backendRows','lockRows','exit','forcedStop']);protocol.assertFleetSpan(attempt.span as FleetSpan);sameRows(attempt.facts,worker.cleanup);sameRows(attempt.exit,worker.exit);assert.equal(attempt.forcedStop,worker.forcedStop);sameRows(attempt.backendRows,[]);sameRows(attempt.lockRows,[]);assert(shortClock(attempt.span as FleetSpan).start>=shortClock(ready.span).end);}
 }
 const schedule=fleetRows(input.schedule);assert.equal(schedule.length,13);const roles=['setup','setup','owner','competitor','replacement','owner','replacement','owner','replacement','owner','replacement','warmup','owner'];const scenarioIndices=[null,null,0,0,0,1,1,2,2,3,3,4,4];
 for(const[index,row]of schedule.entries()){keys(row,['nonce','scenario','role','slot','invocationStartedAt']);assert.equal(row.slot,index);assert.equal(row.role,roles[index]);assert.equal(row.scenario,scenarioIndices[index]===null?null:FLEET_OWNERSHIP_SCENARIOS[scenarioIndices[index]!]);assert.equal(row.invocationStartedAt,epoch+FLEET_OWNERSHIP_OFFSETS[index]);assert(byNonce.has(String(row.nonce)));}
 assert.equal(schedule[0].nonce,schedule[1].nonce);assert.equal(new Set(schedule.map(row=>row.nonce)).size,workers.length);const setups=byNonce.get(String(schedule[0].nonce))!;assert.equal(setups.calls.length,1);assert.equal(setups.calls[0].action,'prepare-ownership');const setup=object(setups.calls[0].result),turns=fleetRows(setup.turns);assert.equal(turns.length,2);for(const[index,turn]of turns.entries()){assert.equal(turn.at,epoch+FLEET_OWNERSHIP_OFFSETS[index]);const span=shortClock(turn.span as FleetSpan);assert(span.start>=Number(turn.at)&&span.start<=Number(turn.at)+1000&&span.end<=Number(turn.at)+22_000);}assert.equal(setup.sourcePlanDigest,plan.digest);
 for(const row of schedule.slice(2)){const worker=byNonce.get(String(row.nonce))!,started=worker.events.filter(event=>event.event.kind==='invocation'&&event.event.phase==='started');assert.equal(started.length,1);const event=started[0];assert(event.event.kind==='invocation');for(const key of ['scenario','role','slot','invocationStartedAt']as const)assert.equal(event.event[key],row[key]);const clock=shortClock(event.span),origin=Number(row.invocationStartedAt);assert(clock.start>=origin&&clock.start<=origin+(row.role==='competitor'?5000:1000));const completed=worker.events.filter(event=>event.event.kind==='invocation'&&event.event.phase==='completed');assert.equal(completed.length,worker.forcedStop?0:1);if(completed.length){assert(shortClock(completed[0].span).end<=origin+22_000);assert(completed[0].event.kind==='invocation');const result=object(completed[0].event.result);assert.equal(result.providerRequests,worker.events.filter(event=>event.event.kind==='http').length);}
  for(const event of worker.events.filter(row=>row.event.kind==='http')){const clock=shortClock(event.span);assert(clock.start>=origin&&clock.end<=origin+20_000);assert(event.event.kind==='http');assert.equal(event.event.status,200);assert.equal(event.event.errorCode,null);}
 }
 const snapshotMap=new Map<string,Record<string,unknown>>();for(const snapshot of fleetRows(input.snapshots)){keys(snapshot,['id','label','span','sql','params','rows']);assert(!snapshotMap.has(String(snapshot.id)));snapshotMap.set(String(snapshot.id),snapshot);assert.equal(snapshot.sql,FLEET_OWNERSHIP_SNAPSHOT_SQL);sameRows(snapshot.params,[]);protocol.assertFleetSpan(snapshot.span as FleetSpan);const rows=fleetRows(snapshot.rows);assert.equal(rows.length,1);keys(rows[0],['state']);keys(object(rows[0].state),['jobs','intakes','dispatches','outcomes','selections','selectionFailures','resources','occurrences','service','targets']);}
 const state=(value:unknown)=>{const snapshot=object(value);sameRows(snapshotMap.get(String(snapshot.id)),snapshot);return object(fleetRows(snapshot.rows)[0].state);},list=(value:unknown,key:string)=>fleetRows(state(value)[key]);
 const cases=fleetRows(input.cases);assert.equal(cases.length,5);let prior=0;for(const[index,row]of cases.entries()){keys(row,['name','scenario','state','span','evidence']);assert.equal(row.name,FLEET_OWNERSHIP_TESTS[index]);assert.equal(row.scenario,FLEET_OWNERSHIP_SCENARIOS[index]);assert.equal(row.state,'passed');const clock=shortClock(row.span as FleetSpan);assert(clock.start>=prior);prior=clock.end;const proof=object(row.evidence),owner=byNonce.get(String(proof.ownerNonce));assert(owner);const hit=object(proof.boundary),event=hit.event as import('./freshness-capacity-protocol').FleetShortEvent;keys(hit,['event','journalSync']);sameRows(owner.events[event.eventSequence-1],event);assert(event.event.kind==='boundary');assert.equal(event.event.scenario,row.scenario);assert.equal(event.event.role,'owner');const ownerSlot=schedule.find(row=>row.nonce===owner.config.nonce);assert(ownerSlot);assert.equal(event.event.slot,ownerSlot.slot);assert.equal(event.event.invocationStartedAt,ownerSlot.invocationStartedAt);assert.equal(event.event.name,['selected','admitted','core-all-accepted','advance-committed','budget-backoff'][index]);const sync=object(hit.journalSync);keys(sync,['file','eventCount','bytes','sha256','at']);assert.equal(sync.file,'ownership-journal-'+owner.config.nonce+'.ndjson');assert(typeof sync.eventCount==='number'&&sync.eventCount>=event.eventSequence&&sync.eventCount<=owner.events.length);const prefix=owner.events.slice(0,sync.eventCount).map(row=>JSON.stringify(row)+'\n').join('');assert.equal(sync.bytes,Buffer.byteLength(prefix));assert.equal(sync.sha256,hash(prefix));assert(Date.parse(String(sync.at))>=shortClock(event.span).end);assert(shortClock(object(proof.boundarySnapshot).span as FleetSpan).start>=shortClock(event.span).end);assert(shortClock(object(proof.afterSnapshot).span as FleetSpan).start>=shortClock(object(proof.boundarySnapshot).span as FleetSpan).end);
  const fence=object(event.event.fence),work=event.event.work===null?null:object(event.event.work),boundaryValue=object(event.event.value),before=proof.boundarySnapshot,after=proof.afterSnapshot;
  if(index!==2){const needle=index===0?'select_public_data_resource_work':index===3?'advance_public_data_batch_owner':'admit_public_data_batch_dispatch_status';const query=owner.events.filter(row=>row.event.kind==='sql'&&row.event.query.includes(needle)&&shortClock(row.span).end<=shortClock(event.span).start).at(-1);assert(query&&query.event.kind==='sql'&&query.event.outcome==='success');const observed=query.event,recorded=fleetRecordedDatabase({span:query.span,queries:[{sql:observed.query,params:observed.params,rows:observed.rows,errorCode:null,span:query.span}]});const actualFence=fence as import('../lib/league-administration/contracts').AdministrationWriteFence;let actual:unknown;if(index===0)actual=await stores.createPublicDataRefreshStore(recorded.database).selectResourceWork!(actualFence);else if(index===3)actual=await stores.createPublicIntakeStore(recorded.database).advanceBatch!(actualFence,String(observed.params[1]));else{assert(work);actual=await stores.createPublicIntakeStore(recorded.database).admitBatch!(work as import('../lib/league-administration/public-intake-contracts').PublicIntakeWork,actualFence);}sameRows(actual,boundaryValue);recorded.done();}
  const owns=(entry:Record<string,unknown>)=>entry.worker_id===fence.workerId&&entry.generation===fence.generation;const beforeDispatch=list(before,'dispatches').find(owns),afterDispatch=list(after,'dispatches').find(owns),beforeOutcome=list(before,'outcomes').find(owns),afterOutcome=list(after,'outcomes').find(owns);const end=shortClock(owner.cleanupAttempts.at(-1)!.span as FleetSpan).end;
  if(index<4){assert.equal(owner.forcedStop,true);const replacement=byNonce.get(String(proof.replacementNonce));assert(replacement&&!replacement.forcedStop);assert(shortClock(replacement.ready.span).start>=end,'replacement began before actual old process/backend closure');assert(shortClock(object(proof.afterSnapshot).span as FleetSpan).start>=shortClock(replacement.cleanupAttempts.at(-1)!.span as FleetSpan).end);}
  if(index===0){assert.equal(boundaryValue.status,'selected');const selected=list(before,'selections').find(row=>row.id===boundaryValue.selectionId);assert(selected&&owns(selected));sameRows(list(after,'selections').find(row=>row.id===selected.id),selected);assert.equal(beforeDispatch,undefined);assert.equal(afterDispatch,undefined);assert.equal(owner.events.filter(row=>row.event.kind==='http').length,0);const competitor=byNonce.get(String(proof.competitorNonce));assert(competitor&&!competitor.forcedStop);const contenderStart=competitor.events.find(row=>row.event.kind==='invocation'&&row.event.phase==='started');assert(contenderStart);assert(shortClock(contenderStart.span).start>=Date.parse(String(sync.at)));assert(Date.parse(String(sync.at))<=shortClock(owner.cleanupAttempts[0].span as FleetSpan).start);const result=object(competitor.calls.find(row=>row.action==='ownership-turn')?.result);assert.equal(result.status,'busy');assert.equal(result.providerRequests,0);assert.equal(competitor.events.filter(row=>row.event.kind==='http').length,0);assert(list(after,'selections').some(selection=>selection.intake_id===selected.intake_id&&selection.resource_id===selected.resource_id&&!owns(selection)&&list(after,'outcomes').some(outcome=>outcome.worker_id===selection.worker_id&&outcome.generation===selection.generation&&outcome.outcome==='checkpoint-committed')));}
  if(index===1||index===2){assert(beforeDispatch&&afterDispatch);sameRows(afterDispatch,beforeDispatch);assert.equal(beforeOutcome,undefined);assert(afterOutcome);assert.equal(afterOutcome.outcome,'recovered');assert.equal(afterOutcome.settled_request_upper_bound_at,null);if(index===1){assert.equal(owner.events.filter(row=>row.event.kind==='http').length,0);}}
  if(index===2){assert(work);assert.equal(work.kind,'core');const receipts=object(object(boundaryValue.captured).receipts),ids=[receipts.settings,receipts.players,receipts.managers,boundaryValue.managerEvidenceReceiptId];assert.equal(new Set(ids).size,4);const original=fleetRows(proof.originalReceiptRows),originalReplay=fleetRecordedDatabase(proof.originalReceiptRead);const{CAPACITY_ENDPOINT_RECEIPTS_SQL}=await import('./freshness-capacity-observer');sameRows(await originalReplay.database.query(CAPACITY_ENDPOINT_RECEIPTS_SQL,[work.requestId]),original);originalReplay.done();const retained=object(proof.retainedRead),replay=fleetRecordedDatabase(retained),rows=await replay.database.query(CAPACITY_ENDPOINT_RECEIPTS_SQL,[work.requestId]);sameRows(rows,retained.rows);assert(shortClock(retained.span as FleetSpan).start>=end);
   const corePhysical=new Set<number>();for(const id of ids){const a=original.find(row=>object(row.receipt).id===id),b=fleetRows(rows).find(row=>object(row.receipt).id===id);assert(a&&b);assert.equal(a.outcome,null);for(const key of ['receipt','acceptance','attempt','content','typed_teams','typed_managers'])sameRows(a[key],b[key]);await normalizedFleetReceipt(a);const capture=object(object(a.receipt).provenance),attempt=object(a.attempt);sameRows(object(capture.acquisition).work,work);sameRows(object(capture.acquisition).fence,fence);assert.equal(object(a.dispatch).worker_id,fence.workerId);assert.equal(object(a.dispatch).generation,fence.generation);assert.equal(object(a.acceptance).receipt_id,id);assert.equal(object(a.receipt).attempt_id,attempt.id);const content=object(a.content),url='https://api.sleeper.app/v1/league/'+work.externalLeagueId+(content.family==='rosters'?'/rosters':'');const matches:import('./freshness-capacity-protocol').FleetShortEvent[]=owner.events.filter(row=>row.event.kind==='http'&&row.event.url===url&&shortClock(row.span).start>=Date.parse(String(capture.requestStartedAt))&&shortClock(row.span).end<=Date.parse(String(capture.requestCompletedAt)));assert.equal(matches.length,1);assert(matches[0].event.kind==='http');sameRows(JSON.parse(matches[0].event.rawUtf8!),content.payload);corePhysical.add(matches[0].eventSequence);}
   const roster=await stores.createLeagueAdministrationStore(replay.database).readRosterPlayerLinks({rosterReceiptId:String(receipts.players),leagueSeasonId:String(object(boundaryValue.mapping).leagueSeasonId)});assert.equal(roster.status,'available');sameRows(roster,retained.roster);replay.done();assert.equal(corePhysical.size,2,'both original core physical captures required');
   const current=object(proof.currentRead),currentReplay=fleetRecordedDatabase(current),store=stores.createLeagueAdministrationStore(currentReplay.database);assert(shortClock(current.span as FleetSpan).start>=end);const mapping=await store.readSourceMapping(String(work.externalLeagueId));sameRows(mapping,current.mapping);assert(mapping);for(const[key,read]of [['settings',()=>store.readAcceptedLeagueSettings(mapping)],['heldRoster',()=>store.readAcceptedCurrentRoster(mapping)],['managers',()=>store.readAcceptedTeamManagers(mapping)],['managerEvidence',()=>store.readAcceptedTeamManagerEvidence!(mapping)]]as const){const result=await read();assert.equal(result.status,'available');sameRows(result,current[key]);}currentReplay.done();

  }
  if(index===3){assert(beforeDispatch&&beforeOutcome?.outcome==='checkpoint-committed');assert.equal(boundaryValue.kind,'acquired');const next=object(boundaryValue.fence);assert.notEqual(next.workerId,fence.workerId);assert.equal(next.generation,Number(fence.generation)+1);for(const[key,offset]of [['deadlineAt',20000],['admissionDeadlineAt',10000],['cleanupDeadlineAt',22000],['leaseUntil',25000]]as const)assert.equal(Date.parse(String(key==='deadlineAt'?next[key]:boundaryValue[key])),event.event.invocationStartedAt+offset);const probes=fleetRows(proof.staleProbes);sameRows(probes.map(row=>row.name),['admit','checkpoint','recover','fail','advance']);for(const probe of probes){const replay=fleetRecordedDatabase(probe),intake=stores.createPublicIntakeStore(replay.database),f=fence as import('../lib/league-administration/contracts').AdministrationWriteFence,w=beforeDispatch.work as import('../lib/league-administration/public-intake-contracts').PublicIntakeWork;let result:unknown=null,code:unknown=null;try{if(probe.name==='admit')result=await intake.admitBatch!(w,f);else if(probe.name==='checkpoint')result=await replay.database.query('SELECT public.checkpoint_public_data_intake($1::jsonb,$2::jsonb,$3::jsonb)',[JSON.stringify(w),'{}',JSON.stringify(f)]);else if(probe.name==='recover')result=await intake.recover(String(beforeDispatch.intake_id),f);else if(probe.name==='fail')result=await intake.fail(w,f);else{const q=fleetRows(probe.queries).find(row=>String(row.sql).includes('advance_public_data_batch_owner'));assert(q);result=await intake.advanceBatch!(f,String((q.params as unknown[])[1]));}}catch(error){code=error&&typeof error==='object'&&'code'in error?error.code:null;}assert(code==='P0001'||result&&typeof result==='object'&&'status'in result&&result.status==='denied');sameRows(result,probe.result);assert.equal(code,probe.errorCode);replay.done();}const unchanged=[...snapshotMap.values()].find(row=>row.label==='after-stale-probes');assert(unchanged);sameRows(state(unchanged),state(before));}
  if(index===4){assert.equal(owner.forcedStop,false);assert.equal(boundaryValue.status,'budget-backoff');assert(typeof boundaryValue.retryAfterMs==='number'&&boundaryValue.retryAfterMs>0);const retryAt=Date.parse(String(boundaryValue.retryAt));assert(retryAt<event.event.invocationStartedAt+10_000);const warmup=byNonce.get(String(proof.warmupNonce));assert(warmup&&!warmup.forcedStop);const result=object(warmup.calls.find(row=>row.action==='ownership-turn')?.result);assert.equal(result.providerRequests,30);assert.equal(result.completedSteps,23);assert.equal(result.status,'complete');assert.equal(warmup.events.filter(row=>row.event.kind==='http').length,30);const control=object(proof.authorityControl);sameRows(fleetRows(input.controls),[control]);assert(shortClock(control.span as FleetSpan).end<retryAt);const configInput=object(control.input);assert.equal(configInput.paused,true);const selection=list(before,'selections').find(owns);assert(selection&&selection.lane==='active');assert.equal(configInput.id,selection.target_id);assert.equal(configInput.expectedRevision,selection.configuration_revision);const replay=fleetRecordedDatabase(control);const configured=await stores.createPublicDataRefreshStore(replay.database).configure(configInput as import('../lib/league-administration/public-refresh-contracts').PublicDataRefreshConfiguration);sameRows(configured,control.result);assert.equal(configured.configurationRevision,Number(selection.configuration_revision)+1);replay.done();assert.equal(beforeDispatch,undefined);assert.equal(afterDispatch,undefined);assert.equal(owner.events.filter(row=>row.event.kind==='http').length,0);sameRows(list(before,'service'),list(after,'service'));
   const statusEvents=owner.events.filter(row=>row.event.kind==='sql'&&row.event.query.includes('admit_public_data_batch_dispatch_status'));assert.equal(statusEvents.length,2);for(const query of statusEvents){assert(query.event.kind==='sql');sameRows(query.event.params,statusEvents[0].event.kind==='sql'?statusEvents[0].event.params:[]);}assert(shortClock(statusEvents[1].span).start>=shortClock(event.span).end+Number(boundaryValue.retryAfterMs)-1);const last=statusEvents[1];assert(last.event.kind==='sql');assert.equal(object(fleetRows(last.event.rows)[0].result).status,'denied');
   const acl=object(proof.acl),records=owner.events.filter(row=>row.event.kind==='record'&&row.event.name==='acl');assert.equal(records.length,1);assert(records[0].event.kind==='record');sameRows(records[0].event.value,acl);assertFleetOwnershipAclInventory(records[0],owner.events);assert.equal(fleetRows(acl.functionRows).length,42);assert.equal(fleetRows(acl.tableRows).length,11);const publicNames=acl.publicFunctions as string[],privateNames=acl.privateFunctions as string[];sameRows(publicNames,[...FLEET_OWNERSHIP_PUBLIC_FUNCTIONS]);sameRows(privateNames,[...FLEET_OWNERSHIP_PRIVATE_FUNCTIONS]);sameRows(acl.tables,[...FLEET_OWNERSHIP_TABLES]);for(const fn of fleetRows(acl.functionRows)){assert(fn.resolved);assert.equal(fn.runtime_execute,publicNames.includes(String(fn.name)));assert.equal(fn.public_execute,false);for(const allowed of Object.values(object(fn.other_roles)))assert.equal(allowed,false);}for(const table of fleetRows(acl.tableRows)){assert.equal(table.can_select,true);assert.equal(table.can_write,false);assert.equal(table.column_write,false);}const negative=fleetRows(acl.attempts);sameRows(fleetRows(acl.functionRows).filter(row=>row.trigger_function===true).map(row=>row.name).sort(),['public.record_public_data_settled_request_bound()','public.validate_public_data_resource_occurrence()'].sort());assert.equal(negative.length,privateNames.length-2+33);assert(negative.every(row=>row.code==='42501'));const denied=owner.events.filter(row=>row.event.kind==='sql'&&row.event.outcome==='failed');assert.equal(denied.length,negative.length);
   const expectedNegatives=[...privateNames.filter(name=>!['public.record_public_data_settled_request_bound()','public.validate_public_data_resource_occurrence()'].includes(name)).map(name=>({kind:'private-function',name})),...FLEET_OWNERSHIP_TABLES.flatMap(name=>['insert','update','delete'].map(kind=>({kind,name})))];sameRows(negative.map(row=>({kind:row.kind,name:row.name})),expectedNegatives);
   for(const item of expectedNegatives){let sql:string;if(item.kind==='private-function'){const match=/^(public\.[a-z0-9_]+)\((.*)\)$/u.exec(item.name);assert(match);sql='SELECT '+match[1]+'('+(match[2]?match[2].split(',').map(type=>'NULL::'+type).join(','):'')+')';}else{const table=fleetRows(acl.tableRows).find(row=>row.name===item.name);assert(table&&typeof table.first_column==='string'&&/^[a-z_][a-z0-9_]*$/u.test(table.first_column));const column='"'+table.first_column+'"';sql=item.kind==='insert'?'INSERT INTO public.'+item.name+' ('+column+') SELECT '+column+' FROM public.'+item.name+' WHERE false':item.kind==='update'?'UPDATE public.'+item.name+' SET '+column+'='+column+' WHERE false':'DELETE FROM public.'+item.name+' WHERE false';}const matches=denied.filter(row=>row.event.kind==='sql'&&row.event.query===sql);assert.equal(matches.length,1);assert(matches[0].event.kind==='sql');sameRows(matches[0].event.params,[]);}

  }
 }
 return{cases:5,workers:workers.length,invocations:schedule.length,eventCount:workers.reduce((sum,row)=>sum+row.events.length,0),physicalRequests:workers.reduce((sum,row)=>sum+row.events.filter(event=>event.event.kind==='http').length,0)};
}

export async function validateFleetOwnershipCompanion(value:unknown,binding:QualificationBinding){
 const row=object(value);keys(row,['kind','contextDigest','fixtureId','planDigest','actualServer','epoch','schedule','workers','parentDirectory','parentInventory','parentClosed']);assert.equal(row.kind,'cp26-fleet-ownership-evidence-v1');assert.equal(binding.context.profile,FLEET_OWNERSHIP_PROFILE);assert.equal(row.contextDigest,hash(JSON.stringify(binding.context)));assert.equal(row.parentClosed,true);assert.equal(await realpath(binding.directory),resolve(binding.directory));const root=await lstat(binding.directory);assert(root.isDirectory()&&!root.isSymbolicLink());
 const server=object(row.actualServer);keys(server,['version','versionNum']);assert(typeof server.version==='string');const plannedPostgresqlVersion=server.version.split(' ')[0],[major,minor]=plannedPostgresqlVersion.split('.').map(Number);assert.equal(server.versionNum,String(major*10000+minor));
 const{plan}=await buildFleetOwnershipPlan({fixtureId:String(row.fixtureId),gitSha:binding.context.gitSha,plannedPostgresqlVersion});assert.equal(row.planDigest,plan.digest);assert.equal(row.parentDirectory,'ownership-parent-'+row.fixtureId);assertFleetOwnershipProofInventory(row.parentInventory);assert.equal(row.parentInventory.manifestDigest,plan.digest);const workers: FleetOwnershipWorkerEvidence[]=[];let total=row.parentInventory.totalBytes,decoded=row.parentInventory.documentBytes,chunks=row.parentInventory.chunks.length;for(const worker of fleetRows(row.workers)){assertFleetShortEvidenceInventory(worker.eventInventory);const journal=object(worker.journal);safeInteger(journal.bytes as number);assert(Number(journal.bytes)>0);total+=worker.eventInventory.totalBytes+Number(journal.bytes);decoded+=worker.eventInventory.totalBytes;chunks+=worker.eventInventory.chunks.length;}assert(total<=FLEET_EVIDENCE_LIMITS.totalBytes,'combined ownership encoded evidence exceeded');assert(decoded<=FLEET_DOCUMENT_LIMITS.totalDecodedBytes,'combined ownership decoded evidence exceeded');assert(chunks<=FLEET_EVIDENCE_LIMITS.maxChunks,'combined ownership chunk count exceeded');const parent=await readFleetOwnershipProof(join(binding.directory,String(row.parentDirectory)),row.parentInventory);
 for(const raw of fleetRows(row.workers)){keys(raw,['config','ready','calls','eventDirectory','eventInventory','journal','exit','forcedStop','cleanup','cleanupAttempts']);const config=(await import('./freshness-capacity-protocol')).parseFleetConfig(raw.config);assert.equal(config.contextNonce,binding.context.nonce);assert.equal(config.profileDigest,binding.context.profileDigest);assert.equal(config.gitSha,binding.context.gitSha);assert.equal(config.plannedPostgresqlVersion,plannedPostgresqlVersion);assert.equal(config.evidenceDirectory,resolve(binding.directory,'fleet-raw-'+config.nonce));assert.equal(raw.eventDirectory,'fleet-parent-'+config.nonce);
  const inventory=raw.eventInventory as FleetShortEvidenceInventory;assertFleetShortEvidenceInventory(inventory);assert.equal(inventory.manifestDigest,plan.digest);const events=await readFleetShortEvidence(join(binding.directory,String(raw.eventDirectory)),inventory),journal=object(raw.journal);keys(journal,['file','bytes','sha256']);assert.equal(journal.file,'ownership-journal-'+config.nonce+'.ndjson');assert(typeof journal.bytes==='number'&&Number.isSafeInteger(journal.bytes)&&journal.bytes>0);assert(typeof journal.sha256==='string'&&/^[a-f0-9]{64}$/u.test(journal.sha256));const path=join(binding.directory,String(journal.file)),stat=await lstat(path);assert(stat.isFile()&&!stat.isSymbolicLink());assert.equal(await realpath(path),path);assert.equal(stat.size,journal.bytes);const bytes=await readFile(path);assert.equal(hash(bytes),journal.sha256);const text=new TextDecoder('utf-8',{fatal:true}).decode(bytes);assert(text.endsWith('\n'));const lines=text.slice(0,-1).split('\n');assert.equal(lines.length,events.length);for(const[index,line]of lines.entries()){const decoded=JSON.parse(line);assert.equal(JSON.stringify(decoded),line);assert(isDeepStrictEqual(decoded,events[index]),'independent append journal differs from event artifact');}
  workers.push({config,ready:raw.ready as FleetMessage,calls:raw.calls as FleetMessage[],events,exit:raw.exit as FleetOwnershipWorkerEvidence['exit'],forcedStop:raw.forcedStop as boolean,cleanup:raw.cleanup as FleetOwnershipWorkerEvidence['cleanup'],cleanupAttempts:raw.cleanupAttempts as Record<string,unknown>[]});
 }
 return assertFleetOwnershipEvidence({plan,epoch:row.epoch,schedule:row.schedule,workers,cases:parent.cases,snapshots:parent.snapshots,controls:parent.controls});
}

export const FLEET_OWNERSHIP_PUBLIC_FUNCTIONS=[
    'public.public_data_batch_capability()','public.begin_public_data_batch(text,timestamptz,uuid)','public.advance_public_data_batch_owner(jsonb,text)','public.next_public_data_batch_intake(uuid)','public.admit_public_data_batch_dispatch(jsonb,jsonb)',
    'public.public_data_resource_schedule_capability()','public.begin_public_data_resource_batch(text,timestamptz)','public.configure_public_data_resource_schedule(jsonb)','public.select_public_data_resource_work(jsonb)','public.fail_public_data_resource_selection(jsonb,text,jsonb)',
    'public.next_public_data_intake(uuid)','public.checkpoint_public_data_intake(jsonb,jsonb,jsonb)','public.recover_public_data_dispatch(uuid,jsonb)','public.configure_public_data_refresh(jsonb)','public.guard_public_data_intake(jsonb,jsonb)',
    'public.public_data_settled_request_budget_capability()','public.admit_public_data_batch_dispatch_status(jsonb,jsonb)'] as const;

export const FLEET_OWNERSHIP_PRIVATE_FUNCTIONS=[
    'public.public_data_batch_claim_result(public.projection_jobs)','public.assert_public_data_batch_owner(jsonb)','public.public_data_batch_budget_available(integer)','public.admit_public_data_dispatch_v57(jsonb,jsonb)','public.begin_player_directory_attempt_v57(uuid,jsonb)',
    'public.public_data_resource_selection_json(public.public_data_resource_selections)','public.assert_public_data_resource_owner(jsonb)','public.public_data_resource_authority_valid(uuid,uuid,bigint)','public.validate_public_data_resource_occurrence()',
    'public.next_public_data_intake_v58(uuid)','public.seed_public_data_resource_occurrence(uuid,uuid,bigint,jsonb)','public.reconcile_public_data_resource_request(uuid)','public.checkpoint_public_data_intake_v58(jsonb,jsonb,jsonb)',
    'public.recover_public_data_dispatch_v58(uuid,jsonb)','public.public_data_history_authority_valid(uuid)','public.record_public_data_resource_target_failure(uuid,bigint,bigint,jsonb)','public.admit_public_data_batch_dispatch_v58(jsonb,jsonb)',
    'public.configure_public_data_refresh_v58(jsonb)','public.begin_public_data_batch_v58(text,timestamptz,uuid)','public.guard_public_data_intake_v58(jsonb,jsonb)','public.select_public_data_refresh_mode(jsonb,boolean)',
    'public.public_data_settled_capture_upper_bound(public.public_data_dispatches,public.public_data_dispatch_outcomes)','public.record_public_data_settled_request_bound()','public.public_data_settled_request_budget(integer)','public.admit_public_data_settled_direct_status(jsonb,jsonb)'] as const;

export const FLEET_OWNERSHIP_TABLES=['public_data_resource_configurations','public_data_resources','public_data_resource_authorities','public_data_resource_occurrences','public_data_resource_selections','public_data_resource_selection_failures','public_data_history_service','public_data_resource_service','public_data_resource_target_failures','public_data_dispatches','public_data_dispatch_outcomes'] as const;


export const FLEET_OWNERSHIP_FUNCTION_PRIVILEGES_SQL="SELECT name,to_regprocedure(name)::text AS resolved,has_function_privilege(current_user,to_regprocedure(name),'EXECUTE') AS runtime_execute,\n    EXISTS(SELECT 1 FROM pg_proc p,LATERAL aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a WHERE p.oid=to_regprocedure(name) AND a.grantee=0 AND a.privilege_type='EXECUTE') AS public_execute,\n    (SELECT p.prorettype='trigger'::regtype FROM pg_proc p WHERE p.oid=to_regprocedure(name)) AS trigger_function,\n    (SELECT jsonb_object_agg(r.rolname,has_function_privilege(r.oid,to_regprocedure(name),'EXECUTE')) FROM pg_roles r WHERE r.rolname IN('league_one_account','league_one_auth')) AS other_roles\n    FROM unnest($1::text[]) AS name ORDER BY name";
export const FLEET_OWNERSHIP_TABLE_PRIVILEGES_SQL="SELECT name,has_table_privilege(current_user,'public.'||name,'SELECT') AS can_select,\n    has_table_privilege(current_user,'public.'||name,'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') AS can_write,\n    has_any_column_privilege(current_user,'public.'||name,'INSERT,UPDATE,REFERENCES') AS column_write,\n    (SELECT attname FROM pg_attribute WHERE attrelid=('public.'||name)::regclass AND attnum>0 AND NOT attisdropped ORDER BY attnum LIMIT 1) AS first_column\n    FROM unnest($1::text[]) AS name ORDER BY name";
/** Positive privilege observations must agree with the actual same-command SQL transcript. */
export function assertFleetOwnershipAclInventory(record:import('./freshness-capacity-protocol').FleetShortEvent,events:readonly import('./freshness-capacity-protocol').FleetShortEvent[]){
 assert(record.event.kind==='record'&&record.event.name==='acl');const acl=object(record.event.value);keys(acl,['publicFunctions','privateFunctions','tables','functionRows','tableRows','attempts','accountAuthScope']);
 for(const[sql,params,rows]of [[FLEET_OWNERSHIP_FUNCTION_PRIVILEGES_SQL,[[...FLEET_OWNERSHIP_PUBLIC_FUNCTIONS,...FLEET_OWNERSHIP_PRIVATE_FUNCTIONS]],acl.functionRows],[FLEET_OWNERSHIP_TABLE_PRIVILEGES_SQL,[[...FLEET_OWNERSHIP_TABLES]],acl.tableRows]]as const){const matches=events.filter(row=>row.commandSequence===record.commandSequence&&row.event.kind==='sql'&&row.event.query===sql);assert.equal(matches.length,1,'missing or repeated actual privilege query');const query=matches[0];assert(query.event.kind==='sql');assert.equal(query.event.outcome,'success');assert.equal(query.event.errorCode,null);sameRows(query.event.params,params);sameRows(query.event.rows,rows);assert(query.eventSequence<record.eventSequence);assert(shortClock(query.span).end<=shortClock(record.span).end);}
}
