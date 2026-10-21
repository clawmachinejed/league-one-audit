import { beforeAll, describe, expect, it } from 'vitest';
import { createCapacityFleetFixture } from './freshness-capacity-fixtures';
import { bindCapacityManifest, capacityDigest, capacityReadiness, createCapacityPlan, assertCapacityPlan, assertCapacityEndpointInventory, assertCapacityManifest,
  type CapacitySource } from './freshness-capacity-manifest';

const fixtureCache = new Map<string, ReturnType<typeof createCapacityFleetFixture>>();
function fixture(plan: ReturnType<typeof createCapacityPlan>) {
  let fleet = fixtureCache.get(plan.seed);
  if (!fleet) { fleet = createCapacityFleetFixture(plan.seed); fixtureCache.set(plan.seed, fleet); }
  const source: CapacitySource = { readinessContractSha256: 'e'.repeat(64), acceptanceContractSha256: 'f'.repeat(64), plannedPostgresqlVersion: '18.6',
    gitSha: 'a'.repeat(40), appTreeSha: 'b'.repeat(40), fixtureSha256: fleet.digest, readerQueryMixSha256: 'd'.repeat(64),
    clockRefs: { wall: 'synthetic-wall-clock', monotonic: 'synthetic-monotonic-clock' }, cleanupPlanRef: 'synthetic-cleanup-plan',
    requestOwners: ['ordinary-runner', 'independent-measurement'], unrelatedUsernames: [fleet.users[1].username, fleet.users[2].username],
    endpointInventory: fleet.endpointInventory, formatWitnesses: fleet.formatWitnesses, leagues: fleet.sourceLeagues,
    initialReaders: fleet.prototype.initialReaders };
  return structuredClone({ source, events: fleet.prototype.events });
}

describe('CP26 immutable planning inventory', () => {
  it('freezes 16 distinct leagues, concurrent fresh four-league cohorts, 64 pairs and all 1,280 mixed events', () => {
    const plan = createCapacityPlan('source-only-test');
    expect(plan.leagues.slice(0, 3).map(row => row.format)).toEqual(['keeper', 'keeper', 'dynasty']);
    expect(plan.leagues.filter(row => row.cohort === 'accepted')).toHaveLength(8);
    expect(plan.leagues.filter(row => row.cohort === 'intake-a')).toHaveLength(4);
    expect(plan.leagues.filter(row => row.cohort === 'intake-b')).toHaveLength(4);
    expect(plan.pairs).toHaveLength(64); expect(plan.events).toHaveLength(1_280); expect(plan.samples).toHaveLength(7_744);
    const mix = (family: string) => Object.fromEntries([...new Set(plan.events.filter(row => row.pairId === `league-01/${family}`).map(row => row.kind))]
      .map(kind => [kind, plan.events.filter(row => row.pairId === `league-01/${family}` && row.kind === kind).length]));
    expect(mix('rosters')).toEqual({ membership: 10, 'native-category': 6, 'empty-repopulation': 4 });
    expect(mix('lineups')).toEqual({ 'starter-bench': 12, 'empty-slot': 4, 'restore-slot': 4 });
    expect(mix('official-scores')).toEqual({ advance: 8, 'downward-correction': 4, 'explicit-zero': 4, 'custom-override': 4 });
    expect(mix('transactions')).toEqual({ 'new-id': 8, 'supplied-field-correction': 8, 'authoritative-removal-reversal': 4 });
    for (const pair of plan.pairs) {
      const samples = plan.samples.filter(row => row.pairId === pair.id), events = plan.events.filter(row => row.pairId === pair.id);
      expect(samples.at(-1)!.offsetMs - samples[0].offsetMs).toBe(7_200_000);
      expect(samples.slice(1).every((row, index) => row.offsetMs - samples[index].offsetMs === 60_000)).toBe(true);
      expect(events.slice(1).every((row, index) => row.offsetMs - events[index].offsetMs >= 360_000)).toBe(true);
      expect(plan.observationHorizonMs - events.at(-1)!.offsetMs).toBeGreaterThan(360_000);
    }
    expect(Object.isFrozen(plan.events[0])).toBe(true); expect(createCapacityPlan('source-only-test')).toEqual(plan);
    expect(capacityReadiness(plan)).toMatchObject({ sourceBindingsComplete: false, executionReady: false, checkpoint26Qualified: false });
  });
  it('canonicalizes object-key order but preserves array order, null and zero', () => {
    expect(capacityDigest({ b: null, a: 0 })).toBe(capacityDigest({ a: 0, b: null }));
    expect(capacityDigest([0, null])).not.toBe(capacityDigest([null, 0]));
    expect(() => capacityDigest({ bad: Infinity })).toThrow(); expect(() => capacityDigest(undefined)).toThrow();
  });
  it('permits only predeclared native-category substitutions with a source reason', () => {
    const plan = createCapacityPlan('substitution', [{ leagueKey: 'league-01', sourceEvidenceRef: 'retained-no-native-category' }]);
    expect(plan.events.filter(row => row.kind === 'membership-category-unavailable')).toHaveLength(6);
    expect(() => createCapacityPlan('substitution', [{ leagueKey: 'league-99', sourceEvidenceRef: 'missing' }])).toThrow();
    expect(() => createCapacityPlan('substitution', [{ leagueKey: 'league-01', sourceEvidenceRef: '' }])).toThrow();
  });
  it.each(['drop-event', 'drop-slot', 'reschedule', 'relax-limit', 'wrong-cohort'] as const)('rejects changed frozen inventory: %s', mutation => {
    const plan = structuredClone(createCapacityPlan('tamper'));
    if (mutation === 'drop-event') plan.events.pop();
    if (mutation === 'drop-slot') plan.samples.pop();
    if (mutation === 'reschedule') plan.events[1].offsetMs = plan.events[0].offsetMs + 359_999;
    if (mutation === 'relax-limit') Object.assign(plan.limits, { sourceAgeP95Ms: 999_999 });
    if (mutation === 'wrong-cohort') plan.leagues[8].cohort = 'accepted';
    expect(() => assertCapacityPlan(plan)).toThrow();
  });
});

describe('CP26 supplied source binding', () => {
  const plan = createCapacityPlan('binding-test');
  beforeAll(() => { fixtureCache.set(plan.seed, createCapacityFleetFixture(plan.seed)); }, 30_000);
  it('binds exact supplied payload bytes and oracles without creating execution/qualification authority', () => {
    const { source, events } = fixture(plan); const manifest = bindCapacityManifest(plan, source, events, { kind: 'healthy' });
    source.leagues[0].nativeLeagueId = 'caller-changed';
    expect(manifest.source.leagues[0].nativeLeagueId).toBe('9260000000000000001');
    expect(Object.isFrozen(manifest.events[0].before)).toBe(true);
    expect(capacityReadiness(manifest)).toMatchObject({ sourceBindingsComplete: true, executionReady: false, checkpoint26Qualified: false });
    expect(capacityReadiness(manifest).blockers.join(' ')).toMatch(/restricted LOGIN/);
  });
  it.each(['missing-event', 'duplicate-event', 'wrong-hash', 'unchanged-event', 'missing-selector', 'missing-history', 'later-history',
    'broken-chain', 'reused-version', 'initial-version-reuse', 'score-fields', 'populated-intake', 'duplicate-league', 'wrong-season', 'wrong-period', 'missing-period', 'extra-period',
    'missing-edge', 'missing-measurement-owner'] as const)('rejects incomplete or contradictory source binding: %s', mutation => {
    const { source, events } = fixture(plan);
    if (mutation === 'missing-event') events.pop();
    if (mutation === 'duplicate-event') events[1] = events[0];
    if (mutation === 'wrong-hash') events[0].after.sha256 = '0'.repeat(64);
    if (mutation === 'unchanged-event') events[0].after = events[0].before;
    if (mutation === 'missing-selector') events[0].expectedReader.selector = '';
    if (mutation === 'missing-history') events[0].retainedHistory = [];
    if (mutation === 'later-history') events[0].retainedHistory[0].version = 'v20';
    if (mutation === 'broken-chain') events[1].before = events[2].before;
    if (mutation === 'reused-version') events[1].after.version = events[0].after.version;
    if (mutation === 'initial-version-reuse') events[0].after.version = events[0].before.version;
    if (mutation === 'score-fields') events[40].expectedReader.value = { effective: 0 };
    if (mutation === 'populated-intake') source.leagues[8].initiallyPopulated = true;
    if (mutation === 'duplicate-league') source.leagues[1].nativeLeagueId = source.leagues[0].nativeLeagueId;
    if (mutation === 'wrong-season') Object.assign(source.leagues[0], { season: 2025 });
    if (mutation === 'wrong-period') source.leagues[0].nativePeriod = '19';
    if (mutation === 'missing-period') source.leagues[0].nativePeriods.pop();
    if (mutation === 'extra-period') source.leagues[0].nativePeriods.push('19');
    if (mutation === 'missing-edge') Object.assign(source.formatWitnesses, { 'multiweek-legs': '' });
    if (mutation === 'missing-measurement-owner') source.requestOwners.pop();
    expect(() => bindCapacityManifest(plan, source, events, { kind: 'healthy' })).toThrow();
  });
  it.each(['backlog-value', 'backlog-version', 'last-good-value', 'last-good-hash', 'last-good-history-selector'] as const)('rejects unbound recovery oracle: %s', mutation => {
    const { source, events } = fixture(plan);
    const lane = { kind: 'outage' as const, startOffsetMs: 1_800_000, durationMs: 1_800_000 as const, dependency: 'provider' as const,
      backlog: [{ id: 'queued', pairId: plan.pairs[0].id, reader: structuredClone(events[0].expectedReader) }],
      lastGood: source.initialReaders.map(row => ({ pairId: row.pairId, reader: structuredClone(row.reader),
        payloadSha256: events.find(event => event.id === row.pairId + '/event-1')!.before.sha256 })) };
    if (mutation === 'backlog-value') lane.backlog[0].reader.value = 999;
    if (mutation === 'backlog-version') lane.backlog[0].reader.version = 'unknown';
    if (mutation === 'last-good-value') lane.lastGood[0].reader.value = 999;
    if (mutation === 'last-good-history-selector') lane.lastGood[0].reader.selector = 'history/v0';
    if (mutation === 'last-good-hash') lane.lastGood[0].payloadSha256 = '0'.repeat(64);
    expect(() => bindCapacityManifest(plan, source, events, lane)).toThrow();
  });
  it('retains additional native periods as explicit unqualified gaps in an outage manifest', () => {
    const { source, events } = fixture(plan); source.leagues[0].nativePeriods.push('19'); source.leagues[0].extraPeriodCoverageGaps.push('19');
    const manifest = bindCapacityManifest(plan, source, events, { kind: 'outage', startOffsetMs: 1_800_000,
      durationMs: 1_800_000, backlog: [{ id: 'declared-backlog-1', pairId: plan.pairs[0].id, reader: events[0].expectedReader }],
      lastGood: source.initialReaders.map(row => ({ pairId: row.pairId, reader: row.reader, payloadSha256: events.find(event => event.id === row.pairId + '/event-1')!.before.sha256 })), dependency: 'provider' });
    expect(manifest.source.leagues[0].extraPeriodCoverageGaps).toEqual(['19']);
  });
  it('rejects an outage extending beyond the planned observation horizon', () => {
    const { source, events } = fixture(plan); source.leagues[0].nativePeriods.push('19'); source.leagues[0].extraPeriodCoverageGaps.push('19');
    expect(() => bindCapacityManifest(plan, source, events, { kind: 'outage', startOffsetMs: 9_000_000,
      durationMs: 1_800_000, backlog: [], lastGood: [], dependency: 'provider' })).toThrow();
  });
});

// Endpoint validation is independent of execution: these reject plausible-looking but unbound evidence.
describe('strict complete native inventory and format bindings', () => {
  const plan = createCapacityPlan('binding-test');
  it.each(['missing-endpoint', 'duplicate-route', 'wrong-method', 'post-body', 'irrelevant-manager', 'wrong-native-week',
    'foreign-league', 'missing-draft-fanout', 'unpaired-score', 'wrong-offset', 'wrong-event', 'wrong-version-hash',
    'discovery-subset', 'missing-position-catalog', 'position-query', 'label-witness', 'wrong-field-value',
    'missing-field', 'unknown-reader', 'claimed-unexecuted-value', 'retained-2025-relabel', 'fake-overlap'] as const)('rejects %s', mutation => {
    const { source, events } = fixture(plan), endpoints = source.endpointInventory;
    const roster = endpoints.find(row => row.id === 'league-01:rosters')!, matchups = endpoints.find(row => row.id === 'league-01:matchups:7')!;
    const report = endpoints.find(row => row.resource === 'weekly-report')!, witness = source.formatWitnesses['custom-zero'];
    if (mutation === 'missing-endpoint') endpoints.splice(endpoints.findIndex(row => row.id === 'league-16:report:18'), 1);
    if (mutation === 'duplicate-route') endpoints.push({ ...endpoints[0], id: 'duplicate-physical-route' });
    if (mutation === 'wrong-method') roster.method = 'POST';
    if (mutation === 'post-body') report.requestUtf8 = '{}';
    if (mutation === 'irrelevant-manager') roster.scope.nativeManagerId = '123';
    if (mutation === 'wrong-native-week') matchups.scope.nativeWeek = 8;
    if (mutation === 'foreign-league') roster.scope.nativeLeagueId = '123';
    if (mutation === 'missing-draft-fanout') endpoints.splice(endpoints.findIndex(row => row.id === 'league-12:draft-picks'), 1);
    if (mutation === 'unpaired-score') matchups.pairIds.pop();
    if (mutation === 'wrong-offset') Object.assign(matchups.versions[1].publication, { offsetMs: 60_001 });
    if (mutation === 'wrong-event') matchups.versions[1].eventIds.pop();
    if (mutation === 'wrong-version-hash') roster.versions[1].sha256 = '0'.repeat(64);
    if (mutation === 'discovery-subset') { const row = endpoints.find(row => row.id === 'discovery:intake-a')!; row.versions[0].utf8 = '[]'; }
    if (mutation === 'missing-position-catalog') endpoints.splice(endpoints.findIndex(row => row.id === 'shared:players:K'), 1);
    if (mutation === 'position-query') endpoints.find(row => row.id === 'shared:players:K')!.url += '&position=QB';
    if (mutation === 'label-witness') Object.assign(source.formatWitnesses, { 'custom-zero': 'label-only' });
    if (mutation === 'wrong-field-value') witness.bindings[0].fields[0].value = 123;
    if (mutation === 'missing-field') witness.bindings[0].fields[0].pointer = '/missing';
    if (mutation === 'unknown-reader') Object.assign(witness.bindings[0].expectedReader, { api: 'inventedReader' });
    if (mutation === 'claimed-unexecuted-value') Object.assign(witness.bindings[0].expectedReader, { status: 'not-executed' });
    if (mutation === 'retained-2025-relabel') witness.provenance = { kind: 'retained-source', season: 2025, path: 'retained-2025.json', sha256: witness.bindings[0].payloadSha256 };
    if (mutation === 'fake-overlap') source.formatWitnesses['overlap-deduplication'].bindings.pop();
    expect(() => assertCapacityEndpointInventory(plan, source.leagues, events, endpoints, source.formatWitnesses)).toThrow();
  });
  it('fully revalidates caller clones despite the optimization for returned deeply frozen manifests', () => {
    const { source, events } = fixture(plan), manifest = bindCapacityManifest(plan, source, events, { kind: 'healthy' });
    expect(() => assertCapacityManifest(manifest)).not.toThrow();
    const clone = structuredClone(manifest); clone.source.endpointInventory[0].versions[0].sha256 = '0'.repeat(64);
    expect(() => assertCapacityManifest(clone)).toThrow();
  });
});

beforeAll(()=>{fixtureCache.set('unit-policy',createCapacityFleetFixture('unit-policy'));},30_000);
it('preserves omitted request policies in historical manifests', () => {
  const plan = createCapacityPlan('unit-policy'), { source, events } = fixture(plan);
  expect(bindCapacityManifest(plan, source, events, { kind: 'healthy' }).source.requestBudgetPolicy).toBeUndefined();
});
it('rejects an explicit DATA-only request policy without separate existing owners', () => {
  const plan = createCapacityPlan('unit-policy'), { source, events } = fixture(plan);
  source.requestBudgetPolicy = 'cp1-data-with-separate-existing-owners-v1';
  expect(() => bindCapacityManifest(plan, source, events, { kind: 'healthy' })).toThrow();
});
it('freezes an explicit DATA-only request policy with separate existing owners', () => {
  const plan = createCapacityPlan('unit-policy'), { source, events } = fixture(plan);
  source.requestBudgetPolicy = 'cp1-data-with-separate-existing-owners-v1';
  source.requestOwners = ['data-refresh', 'independent-measurement', 'primary-projection', 'administration-maintenance'];
  expect(bindCapacityManifest(plan, source, events, { kind: 'healthy' }).source.requestBudgetPolicy).toBe(source.requestBudgetPolicy);
});
it('rejects an unknown request policy with separate existing owners', () => {
  const plan = createCapacityPlan('unit-policy'), { source, events } = fixture(plan);
  source.requestBudgetPolicy = 'cp1-data-with-separate-existing-owners-v1';
  source.requestOwners = ['data-refresh', 'independent-measurement', 'primary-projection', 'administration-maintenance'];
  expect(() => bindCapacityManifest(plan, { ...source, requestBudgetPolicy: 'combined' as never }, events, { kind: 'healthy' })).toThrow();
});
