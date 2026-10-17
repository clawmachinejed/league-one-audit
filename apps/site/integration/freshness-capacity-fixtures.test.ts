import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { normalizeAdministrationObservation } from '../lib/league-administration/normalize';
import { projectExactMatchupValues } from '../lib/aggregator/exact-matchup-values';
import type { AdministrationEnvelope, JsonObject, JsonValue } from '../lib/league-administration/contracts';
import { bindCapacityManifest, capacityDigest, type CapacitySource, type BoundEvent } from './freshness-capacity-manifest';
import { CAPACITY_FIXTURE_GAPS, capacityChangedNativeFields, capacityFixtureReaderBinding, capacityNativeFixtureReport, capacityPrototypeSampleBindings,
  createCapacityNativeFixturePrototype, projectCapacityFixtureValue, simulatedCapacityEnvelope,
  type CapacityNativeFixturePrototype } from './freshness-capacity-fixtures';

let fixture: CapacityNativeFixturePrototype;
beforeAll(() => { fixture = createCapacityNativeFixturePrototype(); }, 30_000);
function event(family: string, ordinal: number, league = 'league-01'): BoundEvent {
  return fixture.events.find(row => row.id === `${league}/${family}/event-${ordinal}`)!;
}
const payload = (row: BoundEvent, version: 'before' | 'after' = 'after') => JSON.parse(row[version].utf8) as JsonObject[];

describe('native CP26 synthetic binding inventory', () => {
  it('labels all sixteen identities as simulations and preserves the complete frozen denominators', () => {
    expect(fixture).toMatchObject({ executionReady: false, sourceBindingsComplete: false, checkpoint26Qualified: false,
      provenance: 'authored-synthetic-2026-not-live', inventory: { logicalEvents: 1_280, activeFamilyPairs: 64,
        scheduledSamples: 7_744, distinctChangedAcquisitions: 960, completeTransportResponseInventory: false } });
    expect(fixture.leagues.filter(league => league.cohort === 'accepted')).toHaveLength(8);
    expect(fixture.leagues.filter(league => league.cohort === 'intake-a')).toHaveLength(4);
    expect(fixture.leagues.filter(league => league.cohort === 'intake-b')).toHaveLength(4);
    expect(new Set(fixture.leagues.map(league => league.nativeLeagueId)).size).toBe(16);
    for (const league of fixture.leagues) expect(league).toMatchObject({ season: 2026, rosterCount: 20, regressionWitnessStatus: 'unqualified-simulation' });
    expect(CAPACITY_FIXTURE_GAPS.some(gap => gap.includes('drafts, brackets, weekly reports'))).toBe(true);
    expect(Object.isFrozen(fixture.events)).toBe(true);
  });
  it('uses native membership, reserve/taxi and complete-empty transitions rather than ordinal-only changes', () => {
    for (let n = 1; n <= 10; n++) {
      const row = event('rosters', n), before = payload(row, 'before')[0].players as string[], after = payload(row)[0].players as string[];
      expect(after.length - before.length).toBe(n % 2 ? 1 : -1);
    }
    expect(payload(event('rosters', 11))[0].reserve).toEqual([]);
    expect(payload(event('rosters', 12))[0].reserve).toEqual(['cp26-sim-player-5']);
    expect(payload(event('rosters', 13))[0].taxi).toEqual([]);
    expect(payload(event('rosters', 14))[0].taxi).toEqual(['cp26-sim-player-6']);
    for (const n of [17, 19]) {
      const rows = payload(event('rosters', n)); expect(rows).toHaveLength(20);
      expect(rows.every(row => Array.isArray(row.players) && row.players.length === 0)).toBe(true);
      expect(event('rosters', n).expectedReader.value).toMatchObject({ categories: { players: { state: 'empty', raw: [], nativePlayerIds: [] } } });
    }
    for (const n of [18, 20]) expect((payload(event('rosters', n))[0].players as string[]).length).toBe(8);
  });
  it('aligns meaningful lineup and score changes in one exact-period payload without double-counting captures', () => {
    for (const league of fixture.leagues) for (let n = 1; n <= 20; n++) {
      const lineups = event('lineups', n, league.key), scores = event('official-scores', n, league.key);
      expect(lineups.before).toEqual(scores.before); expect(lineups.after).toEqual(scores.after);
      expect(lineups.changedFields.every(path => path.includes('/starters/'))).toBe(true);
      expect(scores.changedFields.every(path => /\/(?:points|custom_points)$/u.test(path))).toBe(true);
      expect(capacityDigest(lineups.expectedReader.value)).not.toBe(capacityDigest(lineups.retainedHistory.at(-1)!.value));
      expect(capacityDigest(scores.expectedReader.value)).not.toBe(capacityDigest(scores.retainedHistory.at(-1)!.value));
    }
    expect(payload(event('lineups', 16))[0].starters).toEqual(['0', '0', '0', '0']);
    expect(payload(event('lineups', 20))[0].starters).toEqual(['cp26-sim-player-1', 'cp26-sim-player-2', 'cp26-sim-player-3', 'cp26-sim-player-4']);
    for (let n = 13; n <= 16; n++) expect(payload(event('official-scores', n))[n - 13].points).toBe(0);
    expect(event('official-scores', 17).expectedReader.value).toMatchObject({
      custom: expect.arrayContaining([{ externalRosterId: '1', customPoints: { state: 'supplied', value: '0' } }]),
      effective: expect.arrayContaining([{ externalRosterId: '1', effectivePoints: { value: '0', source: 'custom-override' } }]),
    });
    expect(payload(event('official-scores', 9))[0].points).toBeLessThan(Number(payload(event('official-scores', 9), 'before')[0].points));
  });
  it('keeps stable transaction IDs through zero-bid/status corrections and complete-response removals', () => {
    expect(payload(event('transactions', 8))).toHaveLength(9);
    for (let n = 9; n <= 16; n++) {
      const row = event('transactions', n), before = payload(row, 'before'), after = payload(row);
      expect(after.map(value => value.transaction_id)).toEqual(before.map(value => value.transaction_id));
      if (n % 2) expect(after[n - 8].settings).toEqual({ waiver_bid: 0 });
      else expect(after[n - 8].status).toBe('failed');
    }
    for (let n = 17; n <= 20; n++) expect(payload(event('transactions', n))).toHaveLength(25 - n);
    expect(event('transactions', 20).retainedHistory).toHaveLength(20);
    expect(JSON.stringify(event('transactions', 20).retainedHistory[8].value)).toContain(String(payload(event('transactions', 8))[1].transaction_id));
  });
  it('binds exact native bytes, changed native paths, prior values and existing reader receipt parameters', () => {
    for (const row of fixture.events) {
      expect(createHash('sha256').update(row.before.utf8).digest('hex')).toBe(row.before.sha256);
      expect(createHash('sha256').update(row.after.utf8).digest('hex')).toBe(row.after.sha256);
      const actualPaths = capacityChangedNativeFields(JSON.parse(row.before.utf8), JSON.parse(row.after.utf8));
      expect(row.changedFields.every(path => actualPaths.includes(path))).toBe(true);
      const planned = fixture.plan.events.find(planned => planned.id === row.id)!;
      const initial = fixture.initialReaders.find(initial => initial.pairId === planned.pairId)!;
      expect(row.expectedReader.selector).toBe(initial.reader.selector);
      expect(row.expectedReader.selector.length).toBeLessThanOrEqual(300);
      expect(fixture.readerBindings.head.find(binding => binding.selector === row.expectedReader.selector)!.binding.selection)
        .toBe('current-accepted-head-without-historical-receipt-override');
      const priorSelectors = new Set(row.retainedHistory.map(prior => prior.selector));
      expect(priorSelectors.size).toBe(row.retainedHistory.length);
      for (const prior of row.retainedHistory) {
        const binding = fixture.readerBindings.history.find(binding => binding.selector === prior.selector)!.binding;
        expect(binding.sourceVersion).toBe(prior.version);
        expect(binding.receiptResolution).toBe('unresolved-committed-receipt-for-version-and-payload-hash');
        expect(binding.mappingResolution).toBe('unresolved-actual-mapping-and-league-season');
        expect(prior.selector).not.toBe(row.expectedReader.selector);
      }
      expect(row.retainedHistory.every(prior => prior.version !== row.after.version)).toBe(true);
      const ordinal = Number(row.id.match(/event-(\d+)$/u)![1]); expect(row.retainedHistory).toHaveLength(ordinal);
    }
    expect(capacityFixtureReaderBinding(fixture.leagues[0], 'rosters', event('rosters', 1).after).receiptParameter).toBe('rosterReceiptId');
    expect(capacityFixtureReaderBinding(fixture.leagues[0], 'transactions', event('transactions', 1).after).receiptParameter).toBe('receiptId');
    expect(capacityFixtureReaderBinding(fixture.leagues[0], 'lineups', event('lineups', 1).after).receiptParameter).toBe('matchupsReceiptId');
  });
  it('uses bootstrap provenance and actual pure validators, never acquisition or committed identity claims', () => {
    const row = event('rosters', 1), envelope = simulatedCapacityEnvelope(fixture.leagues[0], 'rosters', payload(row));
    expect(envelope.provenance).toMatchObject({ origin: 'bootstrap', sourceObservedAt: null, requestStartedAt: null, requestCompletedAt: null });
    expect(normalizeAdministrationObservation(envelope, { expectedRosterCount: 20 }).status).toBe('accepted');
    const invalid = structuredClone(row.after), rows = JSON.parse(invalid.utf8); rows[0].starters = 7; invalid.utf8 = JSON.stringify(rows);
    expect(() => projectCapacityFixtureValue(fixture.leagues[0], 'rosters', invalid)).toThrow();
  });
  it('leaves real sample anchors unresolved and retains all planned contiguous slots', () => {
    const samples = capacityPrototypeSampleBindings(fixture); expect(samples).toHaveLength(7_744);
    const first = samples.filter(sample => sample.pairId === 'league-01/rosters');
    expect(first).toHaveLength(121); expect(first[0].offsetMs).toBe(60_000); expect(first.at(-1)!.offsetMs).toBe(7_260_000);
    expect(new Set(samples.map(sample => sample.clockAnchor))).toEqual(new Set(['unresolved-real-first-acceptance']));
    expect(first[0].binding.calls).toEqual(['readAcceptedCurrentRoster(mapping)',
      'readRosterPlayerLinks({rosterReceiptId:receipt.id,leagueSeasonId:mapping.leagueSeasonId})']);
    expect(first[0].binding.sourceAgeField).toBe('receipt.provenance.sourceObservedAt');
    for (const sample of samples) expect(sample.binding.selection).toBe('current-accepted-head-without-historical-receipt-override');
    expect(samples.find(sample => sample.pairId === 'league-01/lineups')!.binding.calls).toEqual(['readExactMatchupValues(mapping,{nativeWeek:7})']);
    expect(samples.find(sample => sample.pairId === 'league-01/transactions')!.binding.calls).toEqual(['readAcceptedTransactions(mapping,7)']);
  });
  it('composes native events with the manifest API using test-only source placeholders, without creating run-ready evidence', () => {
    // These pins and witness labels test structural API composition only; none is exported as source evidence.
    const testSource: CapacitySource = { readinessContractSha256: 'e'.repeat(64), acceptanceContractSha256: 'f'.repeat(64),
      plannedPostgresqlVersion: '18.6', gitSha: 'a'.repeat(40), appTreeSha: 'b'.repeat(40),
      fixtureSha256: fixture.digest, readerQueryMixSha256: capacityDigest(fixture.readerBindings),
      clockRefs: { wall: 'test-only-unexecuted-wall', monotonic: 'test-only-unexecuted-monotonic' },
      cleanupPlanRef: 'test-only-unexecuted-cleanup', requestOwners: ['ordinary-runner', 'independent-measurement'],
      unrelatedUsernames: ['test-only-user-a', 'test-only-user-b'],
      formatWitnesses: { byes: 'test-only-no-witness', ties: 'test-only-no-witness', 'custom-zero': 'test-only-no-witness',
        'unusual-scoring': 'test-only-no-witness', 'pre-draft-incomplete': 'test-only-no-witness',
        'multiweek-legs': 'test-only-no-witness', 'overlap-deduplication': 'test-only-no-witness', 'excess-capacity': 'test-only-no-witness' },
      leagues: fixture.plan.leagues.map(planned => ({ key: planned.key,
        nativeLeagueId: fixture.leagues.find(league => league.key === planned.key)!.nativeLeagueId, season: 2026,
        format: planned.format, regression: planned.regression, nativePeriod: '7',
        nativePeriods: Array.from({ length: 18 }, (_, index) => String(index + 1)), extraPeriodCoverageGaps: [],
        rosterCount: 20, inSeason: true, initiallyPopulated: planned.cohort === 'accepted',
        sourceEvidenceRef: 'test-only-authored-simulation-with-unresolved-gates' })), initialReaders: fixture.initialReaders };
    const manifest = bindCapacityManifest(fixture.plan, testSource, fixture.events, { kind: 'healthy' });
    expect(manifest.events).toHaveLength(1_280);
    expect(manifest.events[19].retainedHistory).toHaveLength(20);
    for (const row of manifest.events) for (const prior of row.retainedHistory) expect(prior.selector.length).toBeLessThanOrEqual(300);
    expect(fixture).toMatchObject({ executionReady: false, sourceBindingsComplete: false, checkpoint26Qualified: false });
  }, 30_000);
  it('exports a compact explicit-gap report and retains repeated native states under distinct version selectors', () => {
    const report = capacityNativeFixtureReport(fixture);
    expect(report).toMatchObject({ digest: fixture.digest, executionReady: false, sourceBindingsComplete: false,
      readerBindingCounts: { head: 64, history: 1_344 } });
    expect(report.eventKinds['membership']).toBe(160);
    expect(JSON.parse(JSON.stringify(report))).toEqual(report);
    const bindings = fixture.readerBindings.history.filter(row => row.binding.family === 'rosters'
      && row.binding.nativeLeagueId === fixture.leagues[0].nativeLeagueId);
    expect(bindings[0].binding.sourcePayloadSha256).toBe(bindings[2].binding.sourcePayloadSha256);
    expect(bindings[0].selector).not.toBe(bindings[2].selector);
    expect(bindings[0].binding.sourceVersion).not.toBe(bindings[2].binding.sourceVersion);
  });
});

it('replays retained real 2026 and true-2025 exact-value slices without changing their season or observation clocks', async () => {
  const denied = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Offline fixture audit forbids network'));
  try {
    const files = ['../test-support/fixtures/cp13-live-source-2026/prior-periods.json', '../test-support/fixtures/cp13-live-source-2025/source.json'];
    const observed: number[] = [];
    for (const file of files) {
      const retained = JSON.parse(await readFile(new URL(file, import.meta.url), 'utf8'));
      const expectedSeason = file.includes('2025') ? 2025 : 2026;
      let checked = 0;
      for (const sample of retained.samples) {
        expect(sample.externalLeagueId).toMatch(/^[0-9]+$/u);
        expect(sample.season ?? retained.season).toBe(expectedSeason);
        const resources = Array.isArray(sample.resources) ? sample.resources : sample.resources.matchups;
        for (const resource of resources as { document: { family: string; week: number; payload: JsonValue; requestStartedAt: string; requestCompletedAt: string; sourceObservedAt: string }; sliceSha256: string }[]) {
          const document = resource.document; if (document.family !== 'matchups') continue;
          expect(createHash('sha256').update(JSON.stringify(document)).digest('hex')).toBe(resource.sliceSha256);
          const rows = document.payload as JsonObject[];
          const scope = { leagueKey: `retained-${expectedSeason}`, provider: 'sleeper' as const,
            externalLeagueId: sample.externalLeagueId, season: expectedSeason };
          const envelope: AdministrationEnvelope = { schemaVersion: 'league-administration-v1', normalizerVersion: 'sleeper-administration-v1',
            dialect: 'sleeper-nfl-v1', scope, family: 'matchups', week: document.week, completeness: 'complete', payload: document.payload,
            provenance: { origin: 'network', requestStartedAt: document.requestStartedAt, requestCompletedAt: document.requestCompletedAt,
              sourceObservedAt: document.sourceObservedAt, checkedAt: document.requestCompletedAt } };
          const normalized = normalizeAdministrationObservation(envelope);
          expect(normalized.status).toBe('accepted');
          const projected = projectExactMatchupValues(normalized, rows.map(row => ({ externalRosterId: String(row.roster_id),
            seasonTeamId: `00000000-0000-0000-0000-${String(row.roster_id).padStart(12, '0')}` })));
          expect(projected.season).toBe(expectedSeason);
          expect(projected.teams).toHaveLength(rows.length);
          expect(projected.teams.map(team => team.rawPoints)).toEqual(rows.map(row => row.points === null ? { state: 'null' }
            : Object.hasOwn(row, 'points') ? { state: 'supplied', value: String(row.points) } : { state: 'missing' }));
          expect(envelope.provenance.sourceObservedAt).toBe(document.sourceObservedAt); checked++;
        }
      }
      expect(checked).toBeGreaterThan(0); observed.push(checked);
    }
    expect(observed).toEqual([20, 3]); expect(denied).not.toHaveBeenCalled();
  } finally { denied.mockRestore(); }
});