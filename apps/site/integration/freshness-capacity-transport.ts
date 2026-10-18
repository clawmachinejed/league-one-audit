import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { assertCapacityEndpointInventory, capacityTime, freezeCapacityValue, type CapacityNativeResource, type CapacityEndpointBinding, type PayloadVersion } from './freshness-capacity-manifest';
import type { CapacityFleetFixture } from './freshness-capacity-fixtures';
import { assertCapacityRecoveryManifest, RECOVERY_CLOCK, type CapacityRecoveryManifest } from './freshness-capacity-recovery';
import { assertCapacityDailyManifest, type CapacityDailyManifest } from './freshness-capacity-daily';
import type { HttpAttempt } from './freshness-capacity-evidence';

export type CapacitySourceResponse = { attemptId: string; endpointId: string; resource: CapacityNativeResource;
  nativeLeagueId: string | null; nativeWeek: number | null; pairIds: string[]; version: string;
  rawUtf8: string; rawSha256: string; requestStartedAt: number; responseCompletedAt: number;
  monotonicStartedAt: number; monotonicCompletedAt: number; responseBoundary: 'full-synthetic-bytes-available' };
export type CapacityRejectedRequest = { method: string; url: string; at: number; reason: 'undeclared-request' | 'invalid-publication-anchor' };
export type CapacityTransportOptions = { owner: string; purpose: HttpAttempt['purpose'];
  anchors(): ReadonlyMap<string, number>; wallNow?(): number; monotonicNow?(): number;
  outage?: { startedAt: number; endedAt: number };
  onAttempt?(attempt: Readonly<HttpAttempt>): void; onResponse?(response: Readonly<CapacitySourceResponse>): void };

/** Only an authored HTTP boundary: no SQL, acquisition coordinator, retries, caches or fallback network. */
export function createCapacityFixtureTransport(fixture: CapacityFleetFixture, options: CapacityTransportOptions) {
  assertCapacityEndpointInventory(fixture.prototype.plan, fixture.sourceLeagues, fixture.prototype.events,
    fixture.endpointInventory, fixture.formatWitnesses);
  const endpointInventory = freezeCapacityValue(structuredClone(fixture.endpointInventory));
  return createClosedTransport(endpointInventory,options,(id,requestStartedAt)=>{
    const endpoint=endpointInventory.find(row=>row.id===id)!,anchors=options.anchors(),values=endpoint.pairIds.map(pair=>anchors.get(pair));
    if(!values.some(value=>value!==undefined))return endpoint.versions[0];
    assert(values.every(value=>value!==undefined),'paired publication requires all acceptance anchors');
    values.forEach(value=>capacityTime(value!));assert.equal(new Set(values).size,1,'shared matchups publication anchor differs');
    return endpoint.versions.filter(version=>version.publication.kind==='initial'||requestStartedAt>=values[0]!+version.publication.offsetMs).at(-1)!;
  });
}
/** Same HTTP boundary, with one separately frozen absolute post-outage publication. */
export function createCapacityRecoveryTransport(manifest:CapacityRecoveryManifest,options:Omit<CapacityTransportOptions,'anchors'|'outage'> & {startedAt:number}){
  assertCapacityRecoveryManifest(manifest);capacityTime(options.startedAt);assert(manifest.source.requestOwners.includes(options.owner),'unknown recovery request owner');
  const endpoints=freezeCapacityValue(structuredClone(manifest.endpoints)),startedAt=options.startedAt;
  return createClosedTransport(endpoints,{...options,anchors:()=>new Map(),outage:{startedAt:startedAt+RECOVERY_CLOCK.outageStartMs,endedAt:startedAt+RECOVERY_CLOCK.outageEndMs}},
    (id,at)=>{const endpoint=endpoints.find(row=>row.id===id)!;return at>=startedAt+RECOVERY_CLOCK.outageEndMs?endpoint.after:endpoint.before;});
}
/** Same maintained-adapter interception with the separate fixed daily correction clock. */
export function createCapacityDailyTransport(manifest: CapacityDailyManifest, options: Omit<CapacityTransportOptions, 'anchors' | 'outage'> & { startedAt: number | (() => number | null) }) {
  assertCapacityDailyManifest(manifest); if (typeof options.startedAt === 'number') capacityTime(options.startedAt); assert(manifest.source.requestOwners.includes(options.owner));
  const endpoints = manifest.endpoints; let epoch: number | null = typeof options.startedAt === 'number' ? options.startedAt : null;
  return createClosedTransport(endpoints, { ...options, anchors: () => new Map() }, (id, at) => {
    const actual = typeof options.startedAt === 'number' ? options.startedAt : options.startedAt();
    if (actual !== null) { capacityTime(actual); assert(epoch === null || actual === epoch, 'daily publication epoch cannot be rebased'); epoch = actual; }
    else assert(epoch === null, 'daily publication epoch cannot be cleared');
    const endpoint = endpoints.find(row => row.id === id)!; return epoch === null || at < epoch + manifest.clock.publicationOffsetMs ? endpoint.before : endpoint.after;
  });
}
/** Daily artifacts retain every response span but intern identical exact native bytes once. */
export function packCapacityDailyResponses(rows: readonly { owner: string; responses: readonly CapacitySourceResponse[] }[]) {
  const bodies = new Map<string, { sha256: string; utf8: string; byteLength: number }>();
  const owners = rows.map(row => ({ owner: row.owner, responses: row.responses.map(({ rawUtf8, ...response }) => {
    assert.equal(createHash('sha256').update(rawUtf8).digest('hex'), response.rawSha256);
    const existing = bodies.get(response.rawSha256); if (existing) assert.equal(existing.utf8, rawUtf8);
    else bodies.set(response.rawSha256, { sha256: response.rawSha256, utf8: rawUtf8, byteLength: Buffer.byteLength(rawUtf8, 'utf8') });
    return { ...response, bodyRef: response.rawSha256 };
  }) }));
  return freezeCapacityValue({ kind: 'cp26-daily-response-pool-v1' as const, bodies: [...bodies.values()], owners });
}
function createClosedTransport(endpointInventory:readonly Omit<CapacityEndpointBinding,'versions'>[],options:CapacityTransportOptions,
  selectVersion:(id:string,requestStartedAt:number)=>PayloadVersion){
  assert(options.owner.trim().length > 0 && options.owner.length <= 300);
  const owner = options.owner, purpose = options.purpose, outage = options.outage ? Object.freeze({ ...options.outage }) : undefined;
  const wall = options.wallNow ?? Date.now, monotonic = options.monotonicNow ?? (() => performance.now());
  const coverageStartedAt = capacityTime(wall()), session = randomUUID();
  if (options.outage) { capacityTime(options.outage.startedAt); capacityTime(options.outage.endedAt); assert(options.outage.endedAt > options.outage.startedAt); }
  const attempts: HttpAttempt[] = [], responses: CapacitySourceResponse[] = [], rejectedRequests: CapacityRejectedRequest[] = [];
  let sequence = 0;
  const fixtureFetch: typeof fetch = async (input, init) => {
    const requestStartedAt = capacityTime(wall()), monotonicStartedAt = monotonic();
    assert(Number.isFinite(monotonicStartedAt) && monotonicStartedAt >= 0);
    const request = input instanceof Request ? input : null;
    const url = request?.url ?? String(input), method = (init?.method ?? request?.method ?? 'GET').toUpperCase();
    const body = init?.body !== undefined ? (typeof init.body === 'string' ? init.body : null) : request ? await request.clone().text() : '';
    const requestUtf8 = body === '' ? null : body;
    const endpoint = endpointInventory.find(row => row.method === method && row.url === url && row.requestUtf8 === requestUtf8);
    if (!endpoint || (init?.body !== undefined && typeof init.body !== 'string')) {
      rejectedRequests.push(Object.freeze({ method, url, at: requestStartedAt, reason: 'undeclared-request' }));
      throw new Error('CP26 fixture transport rejected undeclared method, endpoint or exact request bytes.');
    }
    let selected: PayloadVersion;
    try { selected = selectVersion(endpoint.id,requestStartedAt); }
    catch (error) { rejectedRequests.push(Object.freeze({ method, url, at: requestStartedAt, reason: 'invalid-publication-anchor' })); throw error; }
    const id = `${owner}:${session}:${++sequence}`, signal = init?.signal ?? request?.signal;
    let outcome: HttpAttempt['outcome'] = 'failed', responseSha256: string | null = null;
    try {
      signal?.throwIfAborted();
      if (outage && requestStartedAt >= outage.startedAt && requestStartedAt < outage.endedAt) throw new Error('CP26 authored provider outage.');
      const bytes = new TextEncoder().encode(selected.utf8);
      assert.equal(createHash('sha256').update(bytes).digest('hex'), selected.sha256);
      // The entire exact response is available in this immutable in-memory stream now.
      // This is deliberately earlier than the maintained adapter's body parse/capture completion.
      const stream = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(bytes); controller.close(); } });
      const responseCompletedAt = capacityTime(wall()), monotonicCompletedAt = monotonic();
      assert(responseCompletedAt >= requestStartedAt && monotonicCompletedAt >= monotonicStartedAt);
      const response = freezeCapacityValue<CapacitySourceResponse>({ attemptId: id, endpointId: endpoint.id, resource: endpoint.resource,
        nativeLeagueId: endpoint.scope.nativeLeagueId, nativeWeek: endpoint.scope.nativeWeek, pairIds: [...endpoint.pairIds], version: selected.version,
        rawUtf8: selected.utf8, rawSha256: selected.sha256, requestStartedAt, responseCompletedAt,
        monotonicStartedAt, monotonicCompletedAt, responseBoundary: 'full-synthetic-bytes-available' });
      options.onResponse?.(response); responses.push(response); responseSha256 = selected.sha256; outcome = 'success';
      return new Response(stream, { status: 200, headers: { 'content-type': 'application/json', 'content-length': String(bytes.length) } });
    } catch (error) { if (signal?.aborted) outcome = 'timeout'; throw error; }
    finally {
      const endedAt = responseSha256 ? responses.find(row => row.attemptId === id)!.responseCompletedAt : capacityTime(wall());
      assert(endedAt >= requestStartedAt);
      const common = { id, owner, sequence, at: requestStartedAt, endedAt, purpose, outcome, responseSha256, origin: new URL(endpoint.url).origin };
      const attempt: HttpAttempt = endpoint.method === 'POST'
        ? { ...common, method: 'POST', path: '/graphql', report: { family: 'weekly_report', externalLeagueId: endpoint.scope.nativeLeagueId!,
          nativeWeek: endpoint.scope.nativeWeek!, bodySha256: endpoint.requestSha256! } }
        : { ...common, method: 'GET', path: new URL(endpoint.url).pathname + new URL(endpoint.url).search };
      attempts.push(freezeCapacityValue(attempt));
      try { options.onAttempt?.(attempt); } catch (error) {
        attempts[attempts.length - 1] = freezeCapacityValue({ ...attempt, outcome: 'failed', responseSha256: null });
        const responseIndex = responses.findIndex(row => row.attemptId === id); if (responseIndex >= 0) responses.splice(responseIndex, 1);
        throw error;
      }
    }
  };
  return { fetch: fixtureFetch, journal: () => {
    const coverageEndedAt = capacityTime(wall()); assert(coverageEndedAt >= coverageStartedAt);
    return Object.freeze({ owner: options.owner, coverageStartedAt, coverageEndedAt,
      revision: attempts.length + responses.length + rejectedRequests.length,
      attempts: Object.freeze([...attempts]), responses: Object.freeze([...responses]), rejectedRequests: Object.freeze([...rejectedRequests]) });
  } };
}
