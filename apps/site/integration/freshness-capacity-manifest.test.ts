import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { bindCapacityManifest, capacityDigest, capacityReadiness, createCapacityPlan, assertCapacityPlan,
  type CapacitySource, type BoundEvent, type CapacityPlan } from './freshness-capacity-manifest';

function fixture(plan: CapacityPlan) {
  const source: CapacitySource = { readinessContractSha256: 'e'.repeat(64), acceptanceContractSha256: 'f'.repeat(64), plannedPostgresqlVersion: '18.6', gitSha: 'a'.repeat(40), appTreeSha: 'b'.repeat(40), fixtureSha256: 'c'.repeat(64), readerQueryMixSha256: 'd'.repeat(64),
    clockRefs: { wall: 'synthetic-wall-clock', monotonic: 'synthetic-monotonic-clock' }, cleanupPlanRef: 'synthetic-cleanup-plan',
    requestOwners: ['ordinary-runner', 'independent-measurement'], unrelatedUsernames: ['synthetic-a', 'synthetic-b'],
    formatWitnesses: { byes: 'fixture-byes', ties: 'fixture-ties', 'custom-zero': 'fixture-zero', 'unusual-scoring': 'fixture-scoring',
      'pre-draft-incomplete': 'fixture-predraft', 'multiweek-legs': 'fixture-legs', 'overlap-deduplication': 'fixture-overlap', 'excess-capacity': 'fixture-capacity' },
    leagues: plan.leagues.map(league => ({ key: league.key, nativeLeagueId: `synthetic-${league.key}`, season: 2026,
      format: league.format, regression: league.regression, nativePeriod: '1', nativePeriods: Array.from({ length: 18 }, (_, index) => String(index + 1)), extraPeriodCoverageGaps: [],
      rosterCount: 20, inSeason: true, initiallyPopulated: league.cohort === 'accepted', sourceEvidenceRef: 'synthetic-source' })),
    initialReaders: plan.pairs.map(pair => ({ pairId: pair.id, reader: { selector: pair.id + '/head', version: 'v0', value: { raw: 0, custom: null, effective: 0 } } })) };
  const payload = (pairId: string, ordinal: number) => { const utf8 = JSON.stringify({ pairId, ordinal });
    return { version: `v${ordinal}`, utf8, sha256: createHash('sha256').update(utf8).digest('hex') }; };
  const events: BoundEvent[] = plan.events.map(event => ({ id: event.id, before: payload(event.pairId, event.ordinal - 1), after: payload(event.pairId, event.ordinal),
    changedFields: ['synthetic'], expectedReader: { selector: `${event.pairId}/head`, version: `v${event.ordinal}`, value: { raw: event.ordinal, custom: null, effective: event.ordinal } },
    retainedHistory: Array.from({ length: event.ordinal }, (_, ordinal) => ({ selector: `${event.pairId}/history/v${ordinal}`, version: `v${ordinal}`, value: { raw: ordinal, custom: null, effective: ordinal } })) }));
  return { source, events };
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
  it('binds exact supplied payload bytes and oracles without creating execution/qualification authority', () => {
    const { source, events } = fixture(plan); const manifest = bindCapacityManifest(plan, source, events, { kind: 'healthy' });
    source.leagues[0].nativeLeagueId = 'caller-changed';
    expect(manifest.source.leagues[0].nativeLeagueId).toBe('synthetic-league-01');
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
    if (mutation === 'initial-version-reuse') events[0].after.version = 'v0';
    if (mutation === 'score-fields') events[40].expectedReader.value = { effective: 0 };
    if (mutation === 'populated-intake') source.leagues[8].initiallyPopulated = true;
    if (mutation === 'duplicate-league') source.leagues[1].nativeLeagueId = source.leagues[0].nativeLeagueId;
    if (mutation === 'wrong-season') Object.assign(source.leagues[0], { season: 2025 });
    if (mutation === 'wrong-period') source.leagues[0].nativePeriod = '19';
    if (mutation === 'missing-period') source.leagues[0].nativePeriods.pop();
    if (mutation === 'extra-period') source.leagues[0].nativePeriods.push('19');
    if (mutation === 'missing-edge') source.formatWitnesses['multiweek-legs'] = '';
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
  it('retains additional native periods as explicit unqualified gaps and freezes outage/backlog separately', () => {
    const { source, events } = fixture(plan); source.leagues[0].nativePeriods.push('19'); source.leagues[0].extraPeriodCoverageGaps.push('19');
    const manifest = bindCapacityManifest(plan, source, events, { kind: 'outage', startOffsetMs: 1_800_000,
      durationMs: 1_800_000, backlog: [{ id: 'declared-backlog-1', pairId: plan.pairs[0].id, reader: events[0].expectedReader }],
      lastGood: source.initialReaders.map(row => ({ pairId: row.pairId, reader: row.reader, payloadSha256: events.find(event => event.id === row.pairId + '/event-1')!.before.sha256 })), dependency: 'provider' });
    expect(manifest.source.leagues[0].extraPeriodCoverageGaps).toEqual(['19']);
    expect(() => bindCapacityManifest(plan, source, events, { ...manifest.lane, kind: 'outage', startOffsetMs: 9_000_000,
      durationMs: 1_800_000, backlog: [], lastGood: [], dependency: 'provider' })).toThrow();
  });
});
