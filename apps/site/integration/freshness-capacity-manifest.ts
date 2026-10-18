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
  'Named League One, League Two and Dynasty live regression parity is not established by authored fixture labels',
  'Not-executed format reader bindings remain unqualified and require actual stored-reader evidence',
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
  const memo = new WeakMap<object, string>();
  const canonical = (item: unknown): string => {
    if (item === null || typeof item === 'string' || typeof item === 'boolean') return JSON.stringify(item);
    if (typeof item === 'number') { assert(Number.isFinite(item), 'nonfinite JSON value'); return JSON.stringify(item); }
    assert(item && typeof item === 'object', 'non-JSON value');
    const prior = memo.get(item); if (prior !== undefined) return prior;
    const result = Array.isArray(item) ? '[' + item.map(canonical).join(',') + ']'
      : '{' + Object.keys(item).sort().map(key => JSON.stringify(key) + ':' + canonical((item as Record<string, unknown>)[key])).join(',') + '}';
    memo.set(item, result); return result;
  };
  return createHash('sha256').update(canonical(value)).digest('hex');
}
export function freezeCapacityValue<T>(value: T): T {
  const visited = new WeakSet<object>();
  const visit = (item: unknown) => { if (item && typeof item === 'object' && !visited.has(item)) { visited.add(item); Object.values(item).forEach(visit); Object.freeze(item); } };
  visit(value); return value;
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
export type CapacityNativeResource = 'identity' | 'league-list' | 'league' | 'rosters' | 'users' | 'matchups' | 'transactions'
  | 'winners-bracket' | 'losers-bracket' | 'draft-catalog' | 'draft-detail' | 'draft-selections' | 'draft-trades' | 'league-trades' | 'weekly-report' | 'player-catalog' | 'player-position-catalog';
export type CapacityEndpointVersion = PayloadVersion & { eventIds: string[]; publication: { kind: 'initial' } | { kind: 'pair-anchor'; offsetMs: number } };
export type CapacityEndpointBinding = { id: string; resource: CapacityNativeResource; method: 'GET' | 'POST'; url: string;
  requestUtf8: string | null; requestSha256: string | null;
  scope: { leagueKey: string | null; nativeLeagueId: string | null; nativeWeek: number | null; nativeDraftId: string | null; nativeManagerId: string | null; nativePosition: 'QB' | 'RB' | 'WR' | 'TE' | 'K' | 'DEF' | null };
  pairIds: string[]; versions: CapacityEndpointVersion[] };
export const CAPACITY_FORMAT_SCENARIOS = ['byes', 'ties', 'custom-zero', 'unusual-scoring', 'pre-draft-incomplete', 'multiweek-legs', 'overlap-deduplication', 'excess-capacity'] as const;
export type CapacityFormatScenario = typeof CAPACITY_FORMAT_SCENARIOS[number];
export type CapacityFormatWitness = { kind: 'cp26-format-source-witness-v1'; scenario: CapacityFormatScenario;
  provenance: { kind: 'authored-synthetic-2026'; basis: { path: string; sha256: string }[] }
    | { kind: 'retained-source'; season: 2025 | 2026; path: string; sha256: string };
  scope: 'fleet' | 'auxiliary'; coverage: 'explicit-native-fields' | 'native-shape-with-derived-gap';
  bindings: { endpointId: string; version: string; payloadSha256: string; fields: { pointer: string; value: JsonValue }[];
    expectedReader: { api: 'normalizeAdministrationObservation' | 'readPublicSleeperIntake'; status: 'offline-normalized' | 'not-executed'; value: JsonValue }; unsupported: string[] }[] };
export type CapacityRequestBudgetPolicy = 'cp1-data-with-separate-existing-owners-v1';
export type CapacitySource = { readinessContractSha256: string; acceptanceContractSha256: string; plannedPostgresqlVersion: string; gitSha: string; appTreeSha: string; fixtureSha256: string; readerQueryMixSha256: string;
  clockRefs: { wall: string; monotonic: string }; cleanupPlanRef: string;
  requestBudgetPolicy?: CapacityRequestBudgetPolicy; requestOwners: string[]; unrelatedUsernames: [string, string];
  endpointInventory: CapacityEndpointBinding[]; formatWitnesses: Record<CapacityFormatScenario, CapacityFormatWitness>;
  leagues: BoundLeague[]; initialReaders: { pairId: string; reader: ReaderExpectation }[] };
export type CapacityLane = { kind: 'healthy' } | { kind: 'outage'; startOffsetMs: number;
  durationMs: 1_800_000; backlog: { id: string; pairId: string; reader: ReaderExpectation }[];
  lastGood: { pairId: string; reader: ReaderExpectation; payloadSha256: string }[]; dependency: 'provider' };
export type CapacityManifest = { kind: 'cp26-source-bound-offline-manifest-v1'; plan: CapacityPlan;
  source: CapacitySource; events: BoundEvent[]; lane: CapacityLane; digest: string };
function assertExpectation(row: ReaderExpectation, digest: (value: JsonValue) => string = capacityDigest): void { label(row.selector); label(row.version); digest(row.value); }
const validatedManifests = new WeakSet<CapacityManifest>();
function assertPayload(row: PayloadVersion): void {
  label(row.version); hash(row.sha256); assert(typeof row.utf8 === 'string' && Buffer.byteLength(row.utf8) <= 8 * 1024 * 1024);
  assert.equal(createHash('sha256').update(row.utf8).digest('hex'), row.sha256, 'payload hash mismatch');
  capacityDigest(JSON.parse(row.utf8));
}
/** Requires supplied native payloads and exact reader/history oracles; fabricates none. */
export function bindCapacityManifest(plan: CapacityPlan, source: CapacitySource, events: BoundEvent[], lane: CapacityLane): CapacityManifest {
  assertCapacityPlan(plan);
  const valueDigests = new Map<JsonValue, string>();
  const readerDigest = (value: JsonValue) => { let digest = valueDigests.get(value); if (digest === undefined) { digest = capacityDigest(value); valueDigests.set(value, digest); } return digest; };
  assert.match(source.gitSha, /^[a-f0-9]{40}$/u); assert.match(source.appTreeSha, /^[a-f0-9]{40}$/u);
  hash(source.readinessContractSha256); hash(source.acceptanceContractSha256); assert.match(source.plannedPostgresqlVersion, /^\d+\.\d+$/u);
  hash(source.fixtureSha256); hash(source.readerQueryMixSha256);
  label(source.clockRefs.wall); label(source.clockRefs.monotonic); label(source.cleanupPlanRef);
  assert(source.requestOwners.length > 0); source.requestOwners.forEach(label); unique(source.requestOwners);
  assert(source.requestOwners.includes('independent-measurement'), 'measurement GET owner must be accounted');
  if(source.requestBudgetPolicy!==undefined){assert.equal(source.requestBudgetPolicy,'cp1-data-with-separate-existing-owners-v1');assert.deepEqual([...source.requestOwners].sort(),['administration-maintenance','data-refresh','independent-measurement','primary-projection']);}
  assert.equal(source.unrelatedUsernames.length, 2); source.unrelatedUsernames.forEach(label); unique(source.unrelatedUsernames);
  const witnessKeys = ['byes', 'ties', 'custom-zero', 'unusual-scoring', 'pre-draft-incomplete', 'multiweek-legs', 'overlap-deduplication', 'excess-capacity'];
  assert.deepEqual(Object.keys(source.formatWitnesses).sort(), witnessKeys.sort());
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
  for (const row of source.initialReaders) { assert(plan.pairs.some(pair => pair.id === row.pairId)); assertExpectation(row.reader, readerDigest); }
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
    assertExpectation(row.expectedReader, readerDigest); assert.equal(row.expectedReader.version, row.after.version);
    assert(row.retainedHistory.length > 0, 'missing retained prior-version assertions');
    row.retainedHistory.forEach(reader => assertExpectation(reader, readerDigest)); unique(row.retainedHistory.map(item => item.selector));
    const initial = initialByPair.get(planned.pairId)!;
    assert.equal(row.expectedReader.selector, initial.selector, 'controlled visibility requires the committed head selector');
    const earlier = eventsByPair.get(planned.pairId)!.filter(item => item.ordinal < planned.ordinal)
      .map(item => eventById.get(item.id)!.expectedReader);
    const requiredHistory = [initial, ...earlier];
    assert.equal(row.retainedHistory.length, requiredHistory.length, 'every prior version must be retained');
    for (const prior of requiredHistory) {
      const actual: ReaderExpectation | undefined = row.retainedHistory.find(item => item.version === prior.version); assert(actual, 'missing prior version');
      assert.equal(readerDigest(actual.value), readerDigest(prior.value), 'changed immutable history value');
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
  assertCapacityEndpointInventory(plan, source.leagues, events, source.endpointInventory, source.formatWitnesses);
  for (const username of source.unrelatedUsernames) assert(source.endpointInventory.some(endpoint => endpoint.resource === 'identity' && new URL(endpoint.url).pathname === '/v1/user/' + username), 'missing fresh username endpoint');
  function boundVersion(pairId: string, reader: ReaderExpectation) {
    const planned = eventsByPair.get(pairId); assert(planned, 'unknown pair');
    const initial = initialByPair.get(pairId)!;
    const event = planned.map(row => eventById.get(row.id)!).find(row => row.after.version === reader.version);
    const expected = reader.version === initial.version ? initial : event?.expectedReader; assert(expected, 'unknown reader version');
    assert.equal(readerDigest(reader.value), readerDigest(expected.value), 'unbound reader value');
    return reader.version === initial.version ? eventById.get(planned[0].id)!.before : event!.after;
  }
  assert(lane.kind === 'healthy' || lane.kind === 'outage');
  if (lane.kind === 'outage') {
    capacityTime(lane.startOffsetMs); assert.equal(lane.durationMs, CAPACITY_LIMITS.outageMs);
    assert(lane.startOffsetMs + lane.durationMs <= plan.observationHorizonMs);
    assert(lane.backlog.length > 0); unique(lane.backlog.map(row => row.id));
    for (const row of lane.backlog) { label(row.id); assert(plan.pairs.some(pair => pair.id === row.pairId)); assertExpectation(row.reader, readerDigest); boundVersion(row.pairId, row.reader); }
    assert.equal(lane.lastGood.length, plan.pairs.length); unique(lane.lastGood.map(row => row.pairId));
    for (const row of lane.lastGood) { assert(plan.pairs.some(pair => pair.id === row.pairId)); assertExpectation(row.reader, readerDigest); hash(row.payloadSha256);
      assert.equal(row.reader.selector, initialByPair.get(row.pairId)!.selector, 'last-good witness requires the declared head selector');
      assert.equal(boundVersion(row.pairId, row.reader).sha256, row.payloadSha256, 'unbound last-good version'); }
    assert.equal(lane.dependency, 'provider');
  }
  // Clone inputs so freezing cannot mutate caller state, then bind all supplied bytes/oracles.
  const body = structuredClone({ kind: 'cp26-source-bound-offline-manifest-v1' as const, plan, source, events, lane });
  const manifest = freezeCapacityValue({ ...body, digest: capacityDigest(body) });
  validatedManifests.add(manifest); return manifest;
}
export function assertCapacityManifest(manifest: CapacityManifest): void {
  if (validatedManifests.has(manifest)) return;
  assert.deepEqual(manifest, bindCapacityManifest(manifest.plan, manifest.source, manifest.events, manifest.lane), 'manifest drift');
}
export function capacityReadiness(manifest: CapacityPlan | CapacityManifest) {
  const sourceBound = manifest.kind === 'cp26-source-bound-offline-manifest-v1';
  if (sourceBound) assertCapacityManifest(manifest); else assertCapacityPlan(manifest);
  return { sourceBindingsComplete: sourceBound, executionReady: false as const, checkpoint26Qualified: false as const,
    blockers: [...(sourceBound ? [] : ['Missing exact native source/payload hashes, committed reader selectors/values and retained-history bindings']),
      ...CAPACITY_EXTERNAL_GAPS] };
}

/** Canonical request bytes used by the existing anonymous metadata adapter. */
export function capacityWeeklyReportRequest(nativeLeagueId: string, nativeWeek: number): string {
  return JSON.stringify({ operationName: 'metadata', variables: {},
    query: `query metadata { metadata(type: "league_report", key: "${nativeLeagueId}_${nativeWeek}") { key type data last_updated created } }` });
}
export function capacityPointer(value: JsonValue, pointer: string): JsonValue {
  assert(pointer.startsWith('/') && pointer.length > 1, 'native JSON pointer required');
  let selected = value;
  for (const raw of pointer.slice(1).split('/')) {
    assert(!/~(?:[^01]|$)/u.test(raw), 'invalid JSON pointer escape');
    const key = raw.replaceAll('~1', '/').replaceAll('~0', '~');
    assert(selected !== null && typeof selected === 'object' && Object.hasOwn(selected, key), 'missing native field');
    selected = (selected as Record<string, JsonValue>)[key];
  }
  return selected;
}
/** Structural source binding, never an attestation of execution or named regressions. */
export function assertCapacityEndpointInventory(plan: CapacityPlan, leagues: BoundLeague[], events: BoundEvent[],
  endpoints: CapacityEndpointBinding[], witnesses: Record<CapacityFormatScenario, CapacityFormatWitness>): void {
  assert(Array.isArray(endpoints) && endpoints.length > 0, 'complete endpoint inventory required');
  unique(endpoints.map(row => row.id));
  unique(endpoints.map(row => `${row.method} ${row.url} ${row.requestSha256 ?? ''}`));
  const byEvent = new Map(events.map(row => [row.id, row]));
  const paired = new Map<string, CapacityEndpointBinding>();
  for (const endpoint of endpoints) {
    label(endpoint.id); const url = new URL(endpoint.url), scope = endpoint.scope;
    assert(!url.hash && !url.username && !url.password, 'exact anonymous native route required');
    if (endpoint.resource === 'player-position-catalog') { assert(['QB', 'RB', 'WR', 'TE', 'K', 'DEF'].includes(scope.nativePosition!)); assert.equal(url.search, '?position=' + scope.nativePosition); }
    else { assert.equal(url.search, ''); assert.equal(scope.nativePosition, null, 'irrelevant position scope'); }
    for (const id of [scope.nativeLeagueId, scope.nativeManagerId]) if (id !== null) assert.match(id, /^[1-9][0-9]{0,31}$/u);
    if (scope.nativeDraftId !== null) assert.match(scope.nativeDraftId, /^[a-zA-Z0-9_-]{1,128}$/u);
    if (scope.nativeWeek !== null) assert(Number.isInteger(scope.nativeWeek) && scope.nativeWeek >= 0 && scope.nativeWeek <= 18);
    if (scope.leagueKey !== null) assert(leagues.some(league => league.key === scope.leagueKey && league.nativeLeagueId === scope.nativeLeagueId), 'foreign native league');
    const personal = endpoint.resource === 'identity' || endpoint.resource === 'league-list';
    const shared = endpoint.resource === 'player-catalog' || endpoint.resource === 'player-position-catalog';
    const weekly = ['matchups', 'transactions', 'weekly-report'].includes(endpoint.resource);
    const draft = ['draft-detail', 'draft-selections', 'draft-trades'].includes(endpoint.resource);
    assert.equal(scope.nativeManagerId !== null, personal, 'irrelevant/missing manager scope');
    assert.equal(scope.nativeLeagueId !== null, !personal && !shared, 'irrelevant/missing league scope');
    assert.equal(scope.nativeWeek !== null, weekly, 'irrelevant/missing native period');
    assert.equal(scope.nativeDraftId !== null, draft, 'irrelevant/missing draft scope');
    if (personal || shared) assert.equal(scope.leagueKey, null);
    const leaguePath = '/v1/league/' + scope.nativeLeagueId;
    const paths: Partial<Record<CapacityNativeResource, string>> = {
      'league-list': '/v1/user/' + scope.nativeManagerId + '/leagues/nfl/2026', league: leaguePath,
      rosters: leaguePath + '/rosters', users: leaguePath + '/users', matchups: leaguePath + '/matchups/' + scope.nativeWeek,
      transactions: leaguePath + '/transactions/' + scope.nativeWeek, 'winners-bracket': leaguePath + '/winners_bracket',
      'losers-bracket': leaguePath + '/losers_bracket', 'draft-catalog': leaguePath + '/drafts', 'league-trades': leaguePath + '/traded_picks',
      'draft-detail': '/v1/draft/' + scope.nativeDraftId, 'draft-selections': '/v1/draft/' + scope.nativeDraftId + '/picks',
      'draft-trades': '/v1/draft/' + scope.nativeDraftId + '/traded_picks', 'player-catalog': '/v1/players/nfl', 'player-position-catalog': '/v1/players/nfl', 'weekly-report': '/graphql',
    };
    assert(endpoint.resource === 'identity' || Object.hasOwn(paths, endpoint.resource), 'unknown native resource');
    if (endpoint.resource === 'identity') assert.match(url.pathname, /^\/v1\/user\/[a-zA-Z0-9_]{1,100}$/u);
    else assert.equal(url.pathname, paths[endpoint.resource], 'resource/native scope route mismatch');
    if (endpoint.resource === 'weekly-report') {
      assert.equal(endpoint.method, 'POST'); assert.equal(url.origin, 'https://sleeper.com');
      assert(scope.nativeLeagueId && scope.nativeWeek && scope.nativeWeek >= 1);
      assert.equal(endpoint.requestUtf8, capacityWeeklyReportRequest(scope.nativeLeagueId, scope.nativeWeek));
      assert.equal(endpoint.requestSha256, createHash('sha256').update(endpoint.requestUtf8).digest('hex'));
    } else {
      assert.equal(endpoint.method, 'GET'); assert.equal(url.origin, 'https://api.sleeper.app');
      assert.equal(endpoint.requestUtf8, null); assert.equal(endpoint.requestSha256, null);
    }
    if (endpoint.resource === 'matchups') assert(scope.nativeWeek && scope.nativeWeek >= 1);
    assert(endpoint.versions.length > 0); unique(endpoint.versions.map(row => row.version)); unique(endpoint.pairIds);
    for (const pairId of endpoint.pairIds) {
      const pair = plan.pairs.find(row => row.id === pairId); assert(pair && pair.leagueKey === scope.leagueKey);
      assert.equal(endpoint.resource, pair.family === 'lineups' || pair.family === 'official-scores' ? 'matchups' : pair.family);
      assert(!paired.has(pairId), 'multiple physical endpoints for a logical pair'); paired.set(pairId, endpoint);
    }
    const initialPayload = JSON.parse(endpoint.versions[0]?.utf8 ?? 'null');
    if (endpoint.resource === 'identity') {
      assert.equal(initialPayload.user_id, scope.nativeManagerId);
      assert(typeof initialPayload.username === 'string');
      assert([scope.nativeManagerId, initialPayload.username].includes(url.pathname.slice('/v1/user/'.length)), 'identity path/response mismatch');
    }
    if (endpoint.resource === 'draft-detail') { assert.equal(initialPayload.draft_id, scope.nativeDraftId); assert.equal(initialPayload.league_id, scope.nativeLeagueId); assert.equal(initialPayload.season, '2026'); }
    if (endpoint.resource === 'weekly-report') { assert.equal(initialPayload.data?.metadata?.key, scope.nativeLeagueId + '_' + scope.nativeWeek); assert.equal(initialPayload.data.metadata.type, 'league_report'); }
    if (endpoint.resource === 'league-list') {
      assert(Array.isArray(initialPayload)); unique(initialPayload.map(row => row.league_id));
      for (const row of initialPayload) { assert.equal(row.season, '2026'); assert.equal(row.sport, 'nfl');
        const declared = endpoints.find(item => item.resource === 'league' && item.scope.nativeLeagueId === row.league_id);
        assert(declared, 'undeclared discovery association'); assert.deepEqual(row, JSON.parse(declared.versions[0].utf8), 'discovery settings differ'); }
    }
    if (endpoint.pairIds.length && weekly) assert.equal(String(scope.nativeWeek), leagues.find(row => row.key === scope.leagueKey)!.nativePeriod);
    assert.equal(endpoint.versions[0].publication.kind, 'initial');
    assert.deepEqual(endpoint.versions[0].eventIds, []);
    assert.equal(endpoint.versions.length, endpoint.pairIds.length ? 21 : 1, 'undeclared native publication history');
    endpoint.versions.forEach((version, ordinal) => {
      assertPayload(version); unique(version.eventIds);
      if (ordinal === 0) return;
      assert.equal(version.publication.kind, 'pair-anchor');
      const planned = endpoint.pairIds.map(pairId => plan.events.find(row => row.pairId === pairId && row.ordinal === ordinal)!);
      assert.deepEqual([...version.eventIds].sort(), planned.map(row => row.id).sort(), 'physical response must bind every paired event');
      for (const event of planned) {
        assert(version.publication.kind === 'pair-anchor'); assert.equal(version.publication.offsetMs, event.offsetMs);
        const bound = byEvent.get(event.id); assert(bound);
        assert.deepEqual({ version: version.version, utf8: version.utf8, sha256: version.sha256 }, bound.after);
        const before = endpoint.versions[ordinal - 1];
        assert.deepEqual({ version: before.version, utf8: before.utf8, sha256: before.sha256 }, bound.before);
      }
    });
  }
  assert.equal(paired.size, plan.pairs.length, 'missing physical pair bindings');
  for (const league of leagues) {
    const own = endpoints.filter(endpoint => endpoint.scope.leagueKey === league.key);
    const one = (resource: CapacityNativeResource, week: number | null = null) => {
      const rows = own.filter(row => row.resource === resource && row.scope.nativeWeek === week);
      assert.equal(rows.length, 1, `missing/duplicate ${league.key}/${resource}/${week}`); return rows[0];
    };
    const rawLeague = JSON.parse(one('league').versions[0].utf8);
    assert.equal(rawLeague.league_id, league.nativeLeagueId); assert.equal(rawLeague.season, '2026');
    assert.equal(rawLeague.total_rosters, league.rosterCount); assert.equal(rawLeague.status, 'in_season');
    assert.equal(String(rawLeague.settings.leg), league.nativePeriod);
    assert.equal(rawLeague.settings.type, league.format === 'dynasty' ? 2 : league.format === 'keeper' ? 1 : 0);
    for (const version of one('rosters').versions) assert.equal(JSON.parse(version.utf8).length, league.rosterCount, 'roster inventory differs');
    one('users'); one('winners-bracket'); one('losers-bracket'); one('league-trades');
    for (let week = 1; week <= 18; week++) { one('matchups', week); one('weekly-report', week); }
    for (let week = 0; week <= 18; week++) one('transactions', week);
    const drafts: { draft_id: string; league_id: string; season: string }[] = JSON.parse(one('draft-catalog').versions[0].utf8);
    assert(Array.isArray(drafts) && drafts.length > 0 && drafts.length <= 8); unique(drafts.map(row => row.draft_id));
    for (const draft of drafts) {
      assert.equal(draft.league_id, league.nativeLeagueId); assert.equal(draft.season, '2026');
      for (const resource of ['draft-detail', 'draft-selections', 'draft-trades'] as const)
        assert.equal(own.filter(row => row.resource === resource && row.scope.nativeDraftId === draft.draft_id).length, 1, 'missing draft fanout');
    }
    const lineups = paired.get(league.key + '/lineups')!, scores = paired.get(league.key + '/official-scores')!;
    assert.equal(lineups.id, scores.id, 'lineups and scores must share physical response');
  }
  for (const cohort of ['accepted', 'intake-a', 'intake-b'] as const) {
    const expected = plan.leagues.filter(row => row.cohort === cohort).map(row => leagues.find(league => league.key === row.key)!.nativeLeagueId).sort();
    const discoveries = endpoints.filter(row => row.resource === 'league-list' && capacityDigest(JSON.parse(row.versions[0].utf8).map((league: {league_id: string}) => league.league_id).sort()) === capacityDigest(expected));
    assert.equal(discoveries.length, 1, 'complete distinct cohort discovery required');
    assert(endpoints.some(row => row.resource === 'identity' && row.scope.nativeManagerId === discoveries[0].scope.nativeManagerId), 'discovery missing identity');
  }
  assert.equal(endpoints.filter(row => row.resource === 'player-catalog').length, 1, 'shared catalog must be declared once');
  const fullCatalog = JSON.parse(endpoints.find(row => row.resource === 'player-catalog')!.versions[0].utf8);
  for (const position of ['QB', 'RB', 'WR', 'TE', 'K', 'DEF']) {
    const rows = endpoints.filter(row => row.resource === 'player-position-catalog' && row.scope.nativePosition === position);
    assert.equal(rows.length, 1, 'missing shared position catalog');
    const slice = JSON.parse(rows[0].versions[0].utf8); assert(Object.keys(slice).length > 0);
    for (const [id, value] of Object.entries(slice)) { assert.deepEqual(value, fullCatalog[id], 'shared catalog source conflict'); assert.equal((value as {position: string}).position, position); }
  }
  assert.deepEqual(Object.keys(witnesses).sort(), [...CAPACITY_FORMAT_SCENARIOS].sort());
  for (const scenario of CAPACITY_FORMAT_SCENARIOS) {
    const witness = witnesses[scenario]; assert(witness && typeof witness === 'object', 'structured format witness required');
    assert.equal(witness.kind, 'cp26-format-source-witness-v1'); assert.equal(witness.scenario, scenario);
    assert(['fleet', 'auxiliary'].includes(witness.scope)); assert(['explicit-native-fields', 'native-shape-with-derived-gap'].includes(witness.coverage));
    if (witness.provenance.kind === 'authored-synthetic-2026') {
      assert(witness.provenance.basis.length > 0); for (const basis of witness.provenance.basis) { label(basis.path); hash(basis.sha256); }
    } else {
      assert.equal(witness.provenance.kind, 'retained-source'); assert([2025, 2026].includes(witness.provenance.season));
      label(witness.provenance.path); hash(witness.provenance.sha256);
    }
    assert(witness.bindings.length > 0);
    const facts = witness.bindings.flatMap(binding => binding.fields);
    const fields = (suffix: string) => facts.filter(field => field.pointer.endsWith(suffix));
    if (scenario === 'byes') assert(fields('/matchup_id').some(field => field.value === null));
    if (scenario === 'ties') { const scores = fields('/points'); assert(scores.length >= 2 && scores[0].value === scores[1].value); }
    if (scenario === 'custom-zero') assert(fields('/custom_points').some(field => field.value === 0));
    if (scenario === 'unusual-scoring') assert(facts.some(field => field.pointer.startsWith('/scoring_settings/') && typeof field.value === 'number'));
    if (scenario === 'pre-draft-incomplete') assert(fields('/status').some(field => field.value === 'pre_draft'));
    if (scenario === 'multiweek-legs') assert(fields('/playoff_round_type').length && fields('/playoff_week_start').length);
    if (scenario === 'excess-capacity') assert(fields('/total_rosters').some(field => typeof field.value === 'number' && field.value > 20));
    if (scenario === 'overlap-deduplication') {
      assert(witness.bindings.length >= 2); const ids = fields('/league_id').map(field => field.value);
      assert(ids.length > new Set(ids).size, 'overlap requires shared IDs across discovery sources');
    }
    for (const binding of witness.bindings) {
      const endpoint = endpoints.find(row => row.id === binding.endpointId); assert(endpoint, 'unbound witness endpoint');
      const version = endpoint.versions.find(row => row.version === binding.version); assert(version, 'unbound witness version');
      assert.equal(binding.payloadSha256, version.sha256); assert(binding.fields.length > 0); unique(binding.fields.map(field => field.pointer));
      for (const field of binding.fields) assert.deepEqual(capacityPointer(JSON.parse(version.utf8), field.pointer), field.value, 'native witness field mismatch');
      assert(['normalizeAdministrationObservation', 'readPublicSleeperIntake'].includes(binding.expectedReader.api), 'unknown reader API');
      assert(['offline-normalized', 'not-executed'].includes(binding.expectedReader.status));
      capacityDigest(binding.expectedReader.value); binding.unsupported.forEach(label);
      if (binding.expectedReader.status === 'not-executed') { assert.equal(binding.expectedReader.value, null); assert(binding.unsupported.length > 0); }
      if (binding.expectedReader.status === 'offline-normalized') assert.equal(binding.expectedReader.api, 'normalizeAdministrationObservation');
      if (witness.provenance.kind === 'retained-source') {
        assert.equal(witness.provenance.season, 2026, 'retained historical source cannot be relabeled as this fleet');
        assert.equal(witness.provenance.sha256, version.sha256, 'retained witness requires exact source bytes');
      }
      if (witness.coverage === 'native-shape-with-derived-gap') assert(binding.unsupported.length > 0, 'derived gap must remain explicit');
    }
  }
}
