import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

/** Pure planning only: this module never acquires data, opens SQL or starts a runner. */
export const CAPACITY_FAMILIES = ['rosters', 'lineups', 'official-scores', 'transactions'] as const;
export type CapacityFamily = typeof CAPACITY_FAMILIES[number];
export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export const CAPACITY_LIMITS = Object.freeze({ sourceAgeP95Ms: 300_000, sourceAgeP99Ms: 600_000,
  changeP95Ms: 300_000, receiptMs: 2_000, importMs: 14_400_000, minuteGets: 40, hourGets: 1_800,
  outageMs: 1_800_000, freshnessRecoveryMs: 900_000, backlogRecoveryMs: 14_400_000 });
export const CAPACITY_EXTERNAL_GAPS = Object.freeze([
  'Authorized duration/cost plan through the existing guarded harness (current limits cannot fit this plan)',
  'Actual isolated PostgreSQL and genuine restricted LOGIN evidence bound to the final source',
  'Real elapsed ordinary adapter/coordinator/writer/stored-reader execution and complete transport journals',
  'Acknowledged cleanup and external independent source, payload, SQL and operating review',
  'Remaining CP26 cadence, complete coverage, source permissions and failure-isolation evidence',
]);
const eventMix: Record<CapacityFamily, readonly [string, number][]> = {
  rosters: [['membership', 10], ['native-category', 6], ['empty-repopulation', 4]],
  lineups: [['starter-bench', 12], ['empty-slot', 4], ['restore-slot', 4]],
  'official-scores': [['advance', 8], ['downward-correction', 4], ['explicit-zero', 4], ['custom-override', 4]],
  transactions: [['new-id', 8], ['supplied-field-correction', 8], ['authoritative-removal-reversal', 4]],
};
export type PlannedLeague = { key: string; cohort: 'accepted' | 'intake-a' | 'intake-b';
  format: 'redraft' | 'keeper' | 'dynasty'; regression: 'league-one' | 'league-two' | 'dynasty' | null };
export type PlannedPair = { id: string; leagueKey: string; family: CapacityFamily };
export type PlannedEvent = { id: string; pairId: string; ordinal: number; kind: string; offsetMs: number };
export type PlannedSample = { id: string; pairId: string; offsetMs: number };
export type CapacityPlan = { kind: 'cp26-planning-inventory-v1'; seed: string;
  categorySubstitutions: { leagueKey: string; sourceEvidenceRef: string }[];
  leagues: PlannedLeague[]; pairs: PlannedPair[]; events: PlannedEvent[]; samples: PlannedSample[];
  intakeStartOffsetMs: number; observationHorizonMs: number; sampleDispatchLatenessMs: number; sampleTimeoutMs: number; limits: typeof CAPACITY_LIMITS; digest: string };
export function capacityDigest(value: unknown): string {
  const canonical = (item: unknown): string => {
    if (item === null || typeof item === 'string' || typeof item === 'boolean') return JSON.stringify(item);
    if (typeof item === 'number') { assert(Number.isFinite(item), 'nonfinite JSON value'); return JSON.stringify(item); }
    if (Array.isArray(item)) return '[' + item.map(canonical).join(',') + ']';
    assert(item && typeof item === 'object', 'non-JSON value');
    return '{' + Object.keys(item).sort().map(key => JSON.stringify(key) + ':' + canonical((item as Record<string, unknown>)[key])).join(',') + '}';
  };
  return createHash('sha256').update(canonical(value)).digest('hex');
}
export function freezeCapacityValue<T>(value: T): T {
  if (value && typeof value === 'object') { Object.values(value).forEach(freezeCapacityValue); Object.freeze(value); }
  return value;
}
export function capacityTime(value: number): number {
  assert(Number.isSafeInteger(value) && value >= 0, 'time must be a nonnegative safe integer'); return value;
}
function label(value: string): void { assert(typeof value === 'string' && value.trim().length > 0 && value.length <= 300, 'missing/bounded label'); }
function hash(value: string): void { assert.match(value, /^[a-f0-9]{64}$/u); }
function unique(values: readonly string[]): void { assert.equal(new Set(values).size, values.length, 'duplicate identity'); }
export function createCapacityPlan(seed: string, categorySubstitutions: CapacityPlan['categorySubstitutions'] = []): CapacityPlan {
  label(seed);
  const leagues: PlannedLeague[] = Array.from({ length: 16 }, (_, index) => ({ key: `league-${String(index + 1).padStart(2, '0')}`,
    cohort: index < 8 ? 'accepted' : index < 12 ? 'intake-a' : 'intake-b',
    format: index < 2 ? 'keeper' : index % 3 === 2 ? 'dynasty' : index % 3 === 1 ? 'keeper' : 'redraft',
    regression: index === 0 ? 'league-one' : index === 1 ? 'league-two' : index === 2 ? 'dynasty' : null }));
  const substitutions = categorySubstitutions.map(row => ({ ...row })).sort((a, b) => a.leagueKey.localeCompare(b.leagueKey));
  unique(substitutions.map(row => row.leagueKey));
  for (const row of substitutions) { assert(leagues.some(league => league.key === row.leagueKey)); label(row.sourceEvidenceRef); }
  const pairs = leagues.flatMap(league => CAPACITY_FAMILIES.map(family => ({ id: `${league.key}/${family}`, leagueKey: league.key, family })));
  const events = pairs.flatMap(pair => eventMix[pair.family].flatMap(([kind, count]) => Array<string>(count).fill(kind))
    .map((kind, index) => ({ id: `${pair.id}/event-${index + 1}`, pairId: pair.id, ordinal: index + 1,
      kind: kind === 'native-category' && substitutions.some(row => row.leagueKey === pair.leagueKey) ? 'membership-category-unavailable' : kind,
      offsetMs: 60_000 + index * 360_000 })));
  // 121 fixed slots span two full hours, starting one minute after each pair's anchor.
  const samples = pairs.flatMap(pair => Array.from({ length: 121 }, (_, index) => ({ id: `${pair.id}/sample-${index + 1}`,
    pairId: pair.id, offsetMs: (index + 1) * 60_000 })));
  const body = { kind: 'cp26-planning-inventory-v1' as const, seed, categorySubstitutions: substitutions, leagues, pairs, events, samples,
    intakeStartOffsetMs: 60_000, observationHorizonMs: 7_320_000, sampleDispatchLatenessMs: 1_000, sampleTimeoutMs: 60_000, limits: CAPACITY_LIMITS };
  return freezeCapacityValue({ ...body, digest: capacityDigest(body) });
}
export function assertCapacityPlan(plan: CapacityPlan): void {
  assert.deepEqual(plan, createCapacityPlan(plan.seed, plan.categorySubstitutions), 'changed frozen planning inventory');
}
export type ReaderExpectation = { selector: string; version: string; value: JsonValue };
export type PayloadVersion = { version: string; utf8: string; sha256: string };
export type BoundEvent = { id: string; before: PayloadVersion; after: PayloadVersion;
  changedFields: string[]; expectedReader: ReaderExpectation; retainedHistory: ReaderExpectation[] };
export type BoundLeague = { key: string; nativeLeagueId: string; season: 2026; nativePeriod: string;
  format: PlannedLeague['format']; regression: PlannedLeague['regression']; nativePeriods: string[]; extraPeriodCoverageGaps: string[]; rosterCount: number; inSeason: true;
  initiallyPopulated: boolean; sourceEvidenceRef: string };
export type CapacitySource = { readinessContractSha256: string; acceptanceContractSha256: string; plannedPostgresqlVersion: string; gitSha: string; appTreeSha: string; fixtureSha256: string; readerQueryMixSha256: string;
  clockRefs: { wall: string; monotonic: string }; cleanupPlanRef: string;
  requestOwners: string[]; unrelatedUsernames: [string, string];
  formatWitnesses: Record<'byes' | 'ties' | 'custom-zero' | 'unusual-scoring' | 'pre-draft-incomplete' | 'multiweek-legs' | 'overlap-deduplication' | 'excess-capacity', string>;
  leagues: BoundLeague[]; initialReaders: { pairId: string; reader: ReaderExpectation }[] };
export type CapacityLane = { kind: 'healthy' } | { kind: 'outage'; startOffsetMs: number;
  durationMs: 1_800_000; backlog: { id: string; pairId: string; reader: ReaderExpectation }[];
  lastGood: { pairId: string; reader: ReaderExpectation; payloadSha256: string }[]; dependency: 'provider' };
export type CapacityManifest = { kind: 'cp26-source-bound-offline-manifest-v1'; plan: CapacityPlan;
  source: CapacitySource; events: BoundEvent[]; lane: CapacityLane; digest: string };
function assertExpectation(row: ReaderExpectation): void { label(row.selector); label(row.version); capacityDigest(row.value); }
function assertPayload(row: PayloadVersion): void {
  label(row.version); hash(row.sha256); assert(typeof row.utf8 === 'string' && Buffer.byteLength(row.utf8) <= 8 * 1024 * 1024);
  assert.equal(createHash('sha256').update(row.utf8).digest('hex'), row.sha256, 'payload hash mismatch');
  capacityDigest(JSON.parse(row.utf8));
}
/** Requires supplied native payloads and exact reader/history oracles; fabricates none. */
export function bindCapacityManifest(plan: CapacityPlan, source: CapacitySource, events: BoundEvent[], lane: CapacityLane): CapacityManifest {
  assertCapacityPlan(plan);
  assert.match(source.gitSha, /^[a-f0-9]{40}$/u); assert.match(source.appTreeSha, /^[a-f0-9]{40}$/u);
  hash(source.readinessContractSha256); hash(source.acceptanceContractSha256); assert.match(source.plannedPostgresqlVersion, /^\d+\.\d+$/u);
  hash(source.fixtureSha256); hash(source.readerQueryMixSha256);
  label(source.clockRefs.wall); label(source.clockRefs.monotonic); label(source.cleanupPlanRef);
  assert(source.requestOwners.length > 0); source.requestOwners.forEach(label); unique(source.requestOwners);
  assert(source.requestOwners.includes('independent-measurement'), 'measurement GET owner must be accounted');
  assert.equal(source.unrelatedUsernames.length, 2); source.unrelatedUsernames.forEach(label); unique(source.unrelatedUsernames);
  const witnessKeys = ['byes', 'ties', 'custom-zero', 'unusual-scoring', 'pre-draft-incomplete', 'multiweek-legs', 'overlap-deduplication', 'excess-capacity'];
  assert.deepEqual(Object.keys(source.formatWitnesses).sort(), witnessKeys.sort()); Object.values(source.formatWitnesses).forEach(label);
  assert.equal(source.leagues.length, 16); unique(source.leagues.map(row => row.key)); unique(source.leagues.map(row => row.nativeLeagueId));
  for (const planned of plan.leagues) {
    const row = source.leagues.find(item => item.key === planned.key); assert(row, 'missing league');
    assert.equal(row.format, planned.format); assert.equal(row.regression, planned.regression);
    label(row.nativeLeagueId); label(row.sourceEvidenceRef); assert.equal(row.season, 2026); assert.equal(row.inSeason, true);
    assert.equal(row.initiallyPopulated, planned.cohort === 'accepted', 'fresh cohort must be unpopulated');
    assert(Number.isInteger(row.rosterCount) && row.rosterCount > 0 && row.rosterCount <= 20);
    unique(row.nativePeriods); unique(row.extraPeriodCoverageGaps); row.nativePeriods.forEach(label); row.extraPeriodCoverageGaps.forEach(label);
    for (let week = 1; week <= 18; week++) assert(row.nativePeriods.includes(String(week)), 'missing benchmark period');
    label(row.nativePeriod); assert(row.nativePeriods.includes(row.nativePeriod));
    for (const period of row.nativePeriods.filter(period => !Array.from({ length: 18 }, (_, index) => String(index + 1)).includes(period))) {
      assert(row.extraPeriodCoverageGaps.includes(period), 'extra native period needs explicit qualification accounting');
    }
  }
  assert.equal(source.initialReaders.length, plan.pairs.length); unique(source.initialReaders.map(row => row.pairId));
  for (const row of source.initialReaders) { assert(plan.pairs.some(pair => pair.id === row.pairId)); assertExpectation(row.reader); }
  assert.equal(events.length, plan.events.length); unique(events.map(row => row.id));
  const eventById = new Map(events.map(row => [row.id, row]));
  const eventsByPair = new Map(plan.pairs.map(pair => [pair.id, plan.events.filter(row => row.pairId === pair.id)]));
  const initialByPair = new Map(source.initialReaders.map(row => [row.pairId, row.reader]));
  for (const pair of plan.pairs) unique([initialByPair.get(pair.id)!.version,
    ...eventsByPair.get(pair.id)!.map(event => eventById.get(event.id)?.after.version ?? '')]);
  for (const planned of plan.events) {
    const row = eventById.get(planned.id); assert(row, 'missing controlled event');
    assertPayload(row.before); assertPayload(row.after);
    assert.notEqual(row.before.sha256, row.after.sha256, 'event must change source content');
    assert.notEqual(row.before.version, row.after.version);
    assert(row.changedFields.length > 0); row.changedFields.forEach(label); unique(row.changedFields);
    assertExpectation(row.expectedReader); assert.equal(row.expectedReader.version, row.after.version);
    assert(row.retainedHistory.length > 0, 'missing retained prior-version assertions');
    row.retainedHistory.forEach(assertExpectation); unique(row.retainedHistory.map(item => item.selector));
    const initial = initialByPair.get(planned.pairId)!;
    assert.equal(row.expectedReader.selector, initial.selector, 'controlled visibility requires the committed head selector');
    const earlier = eventsByPair.get(planned.pairId)!.filter(item => item.ordinal < planned.ordinal)
      .map(item => eventById.get(item.id)!.expectedReader);
    const requiredHistory = [initial, ...earlier];
    assert.equal(row.retainedHistory.length, requiredHistory.length, 'every prior version must be retained');
    for (const prior of requiredHistory) {
      const actual: ReaderExpectation | undefined = row.retainedHistory.find(item => item.version === prior.version); assert(actual, 'missing prior version');
      assert.equal(capacityDigest(actual.value), capacityDigest(prior.value), 'changed immutable history value');
    }
    if (planned.ordinal === 1) assert.equal(initial.version, row.before.version);
    const previous = eventsByPair.get(planned.pairId)!.find(item => item.ordinal === planned.ordinal - 1);
    if (previous) { const prior = eventById.get(previous.id)!;
      assert.deepEqual(row.before, prior.after, 'broken same-pair source history'); }
    if (plan.pairs.find(pair => pair.id === planned.pairId)!.family === 'official-scores') {
      const value = row.expectedReader.value; assert(value && typeof value === 'object' && !Array.isArray(value));
      for (const field of ['raw', 'custom', 'effective']) assert(Object.hasOwn(value, field), 'scores need separate raw/custom/effective expectations');
    }
  }
  function boundVersion(pairId: string, reader: ReaderExpectation) {
    const planned = eventsByPair.get(pairId); assert(planned, 'unknown pair');
    const initial = initialByPair.get(pairId)!;
    const event = planned.map(row => eventById.get(row.id)!).find(row => row.after.version === reader.version);
    const expected = reader.version === initial.version ? initial : event?.expectedReader; assert(expected, 'unknown reader version');
    assert.equal(capacityDigest(reader.value), capacityDigest(expected.value), 'unbound reader value');
    return reader.version === initial.version ? eventById.get(planned[0].id)!.before : event!.after;
  }
  assert(lane.kind === 'healthy' || lane.kind === 'outage');
  if (lane.kind === 'outage') {
    capacityTime(lane.startOffsetMs); assert.equal(lane.durationMs, CAPACITY_LIMITS.outageMs);
    assert(lane.startOffsetMs + lane.durationMs <= plan.observationHorizonMs);
    assert(lane.backlog.length > 0); unique(lane.backlog.map(row => row.id));
    for (const row of lane.backlog) { label(row.id); assert(plan.pairs.some(pair => pair.id === row.pairId)); assertExpectation(row.reader); boundVersion(row.pairId, row.reader); }
    assert.equal(lane.lastGood.length, plan.pairs.length); unique(lane.lastGood.map(row => row.pairId));
    for (const row of lane.lastGood) { assert(plan.pairs.some(pair => pair.id === row.pairId)); assertExpectation(row.reader); hash(row.payloadSha256);
      assert.equal(row.reader.selector, initialByPair.get(row.pairId)!.selector, 'last-good witness requires the declared head selector');
      assert.equal(boundVersion(row.pairId, row.reader).sha256, row.payloadSha256, 'unbound last-good version'); }
    assert.equal(lane.dependency, 'provider');
  }
  // Clone inputs so freezing cannot mutate caller state, then bind all supplied bytes/oracles.
  const body = structuredClone({ kind: 'cp26-source-bound-offline-manifest-v1' as const, plan, source, events, lane });
  return freezeCapacityValue({ ...body, digest: capacityDigest(body) });
}
export function assertCapacityManifest(manifest: CapacityManifest): void {
  assert.deepEqual(manifest, bindCapacityManifest(manifest.plan, manifest.source, manifest.events, manifest.lane), 'manifest drift');
}
export function capacityReadiness(manifest: CapacityPlan | CapacityManifest) {
  const sourceBound = manifest.kind === 'cp26-source-bound-offline-manifest-v1';
  if (sourceBound) assertCapacityManifest(manifest); else assertCapacityPlan(manifest);
  return { sourceBindingsComplete: sourceBound, executionReady: false as const, checkpoint26Qualified: false as const,
    blockers: [...(sourceBound ? [] : ['Missing exact native source/payload hashes, committed reader selectors/values and retained-history bindings']),
      ...CAPACITY_EXTERNAL_GAPS] };
}
