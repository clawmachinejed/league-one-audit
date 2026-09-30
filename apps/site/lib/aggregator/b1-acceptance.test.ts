import { describe, expect, it, vi } from 'vitest';
import type { DatabaseClient, DatabaseRow } from '../database';
import type { JsonValue } from '../league-administration/contracts';
import { normalizeAdministrationObservation } from '../league-administration/normalize';
import { createLeagueAdministrationStore, createExactMatchupCompatibilityReader } from '../league-administration/store';
import { createRetainedMatchupComparison } from '../league-administration/retained-matchup-comparison';
import type { ExactMatchupValue } from './exact-matchups';
import { projectRetainedMatchups } from './retained-matchups';
import { b1CaptureEnvelope, b1CompatibilityFixture, b1CompatibilityInput, b1Mapping,
  b1RetainedEvidence, b1RetainedSelection, b1Uuid, b1CurrentRosterFixture, b1PlayerCatalog, b1LineupApplicabilityFixture } from './b1-acceptance.fixtures';

import { createAllPlayerBoxScoreMethods } from '../projections/adapters/neon/all-player-box-scores';
import { createBundleOneReadService, type BundleOneReadInput } from './bundle-one';

vi.mock('server-only', () => ({}));

function officialFacts(value: ExactMatchupValue) {
  return { source: value.period.source, season: value.period.season, nativeWeek: value.period.nativeWeek,
    groups: value.groups, teams: value.teams.map(team => ({ seasonTeamId: team.seasonTeamId,
      externalRosterId: team.externalRosterId, nativeMatchupId: team.nativeMatchupId, players: team.players,
      starters: team.starters?.map(slot => ({ index: slot.index, playerExternalId: slot.playerExternalId,
        empty: slot.empty, officialPoints: slot.officialPoints, pointSource: slot.pointSource })) ?? null,
      officialTeamPoints: team.officialTeamPoints, officialPlayerPoints: team.officialPlayerPoints })) };
}
function reader(row: ReturnType<typeof b1CompatibilityFixture>) {
  const query = vi.fn(async () => [row]);
  return { query, service: createExactMatchupCompatibilityReader({ enabled: true, query } as DatabaseClient) };
}

describe('B1 same immutable capture acceptance', () => {
  it('composes normalization, actual accepted/derived parsers, and retained evidence without official or forecast differences', async () => {
    const row = b1CompatibilityFixture(), before = structuredClone(row);
    const normalized = normalizeAdministrationObservation(b1CaptureEnvelope(row), { expectedRosterCount: 2 });
    const { service, query } = reader(row);
    const result = await service.readExactMatchupCompatibility(b1CompatibilityInput);
    const retained = projectRetainedMatchups(b1RetainedSelection, b1RetainedEvidence(row));
    expect(normalized.status).toBe('accepted');
    expect(result.official.status).toBe('available');
    expect(retained.status).toBe('available');
    if (result.official.status !== 'available' || retained.status !== 'available') throw new Error('Same capture unavailable.');
    expect(result.official.receipt.rawContentHash).toBe(normalized.contentHash);
    expect(retained.lineage.contentId).toBe(result.official.accepted.contentId);
    expect(retained.lineage.observationId).toBe(result.official.receipt.legacyObservationId);
    expect(retained.lineage.sourceMappingRevisionId).toBe(b1Mapping.revisionId);
    expect(officialFacts(retained.value)).toEqual(officialFacts(result.official.value));
    expect(result.official.value.teams[0]).toMatchObject({ officialTeamPoints: { raw: '8.25', custom: '0', effective: '0' },
      starters: [{ index: 0, playerExternalId: 'a', officialPoints: '8.25', pointSource: 'starter-index' },
        { index: 1, empty: true, playerExternalId: null, officialPoints: null }], officialPlayerPoints: { a: '9.5' } });
    expect(result.forecast.status).toBe('available');
    expect(result.probability.status).toBe('available');
    if (result.forecast.status !== 'available' || result.probability.status !== 'available') throw new Error('Stored result unavailable.');
    for (const team of result.forecast.teams) {
      const side = row.snapshot_rows[0].payload.matchups[0].sides.find(side => String(side.team.id) === team.externalRosterId)!;
      expect(team.projectedPoints).toBe(side.projectedPoints);
      expect(team.display).toEqual({ source: 'stored-snapshot', temporalContext: 'snapshot-display',
        name: side.team.name, managerName: side.team.managerName, avatar: side.team.avatar });
      expect(team.projectedOutcome).toBe('tie');
      expect(team.starters.map(starter => starter.projectedPoints)).toEqual(side.starters.map(starter => starter.projectedPoints));
    }
    expect(result.probability.groups[0].value).toEqual(row.snapshot_rows[0].payload.matchups[0].winProbability);
    expect(retained.source.sourceObservedAt).toBe(result.official.receipt.provenance.sourceObservedAt);
    expect(result.official.value.state.provider).toBe('unknown');
    expect(query).toHaveBeenCalledOnce();
    expect(row).toEqual(before);
  });

  it.each(['missing', 'malformed'] as const)('keeps exact official and retained facts when derived history is %s', async kind => {
    const row = b1CompatibilityFixture();
    const expected = projectRetainedMatchups(b1RetainedSelection, b1RetainedEvidence(row));
    const actualRow = { ...row, history_rows: kind === 'missing' ? [] : [{}] };
    const query = vi.fn(async () => [actualRow]);
    const result = await createExactMatchupCompatibilityReader({ enabled: true, query } as DatabaseClient)
      .readExactMatchupCompatibility(b1CompatibilityInput);
    if (result.official.status !== 'available' || expected.status !== 'available') throw new Error('Derived failure hid official facts.');
    expect(officialFacts(result.official.value)).toEqual(officialFacts(expected.value));
    expect(result.forecast.status).toBe('unavailable');
    expect(result.gameState.status).toBe('unavailable');
    expect(result.probability.status).toBe('unavailable');
  });

  it('repeats the exact retained capture deterministically without relabeling it accepted', async () => {
    const evidence = b1RetainedEvidence(b1CompatibilityFixture());
    const scan = vi.fn(async () => ({ status: 'available' as const, evidence: [evidence] }));
    const read = vi.fn(async () => ({ status: 'available' as const, evidence: [evidence] }));
    const service = createRetainedMatchupComparison({ scanRetainedMatchups: scan, readRetainedMatchups: read });
    const created = await service.createManifest(b1RetainedSelection);
    if (created.status !== 'available') throw new Error('Manifest unavailable.');
    const request = { manifest: created.manifest, batchSize: 1 };
    const first = await service.compareBatch(request), retry = await service.compareBatch(request);
    expect(retry).toEqual(first);
    if (first.status !== 'complete') throw new Error('Retained comparison incomplete.');
    const result = first.entries[0].result;
    expect(result).toMatchObject({ status: 'available', kind: 'legacy-retained-matchups' });
    if (result.status !== 'available') throw new Error('Retained comparison rejected.');
    expect(result.limitations).toContain('population_unproved');
    expect(result.limitations).toContain('v2_acceptance_not_qualified');
    const resumed = await service.compareBatch({ ...request, cursor: first.cursor });
    expect(resumed).toMatchObject({ status: 'complete', entries: [] });
    expect(scan).toHaveBeenCalledOnce();
    expect(read).toHaveBeenCalledTimes(2);
  });
});

function composedFixture(options: { applicability?: boolean; partialCatalog?: boolean } = {}) {
  const rawRow = b1CompatibilityFixture(['1001', '1002']);
  const row = { ...rawRow, accepted_rows: rawRow.accepted_rows.map(accepted => ({ ...accepted,
    lineup_applicability_evidence: options.applicability === false ? [] : b1LineupApplicabilityFixture(rawRow) })) };
  const rosterRow = b1CurrentRosterFixture(rawRow);
  const statRows = ['1001', '1002'].map(id => ({ source_kind: 'hourly', evidence: null,
    database_now_ms: Date.parse('2026-09-29T12:01:00.000Z'), observed_at: '2026-09-29T11:57:00.000Z',
    semantic_hash: 'a'.repeat(64), entity_kind: 'player', provider_external_id: id,
    game_phase: 'unknown', stats: (id === '1001' ? { pass_yd: 0 } : { pass_yd: 120, pass_td: 1 }) as Record<string, number> }));
  const query = vi.fn(async (sql: string): Promise<readonly DatabaseRow[]> => {
    if (sql.includes('projection-store:read-exact-matchup-compatibility')) return [row];
    if (sql.includes('league-administration:read-accepted-exact-matchups')) return row.accepted_rows;
    if (sql.includes('league-administration:read-accepted-current-roster')) return [rosterRow];
    if (sql.includes('projection-store:read-all-player-box-scores')) return statRows;
    throw new Error('Unexpected B1 operation.');
  });
  const database = { enabled: true, query } as DatabaseClient;
  const administration = createLeagueAdministrationStore(database);
  const service = createBundleOneReadService({ ...administration,
    ...createExactMatchupCompatibilityReader(database), ...createAllPlayerBoxScoreMethods(database) });
  const catalog = b1PlayerCatalog();
  const input: BundleOneReadInput = { expectedMapping: b1Mapping, nativeWeek: 4,
    snapshot: { snapshotId: b1CompatibilityInput.request.snapshotId, modelVersion: 'clock-v1' },
    selectedSeasonTeamId: rawRow.accepted_rows[0].teams[0].seasonTeamId,
    context: b1CompatibilityInput.context, now: b1CompatibilityInput.now,
    playerCatalog: options.partialCatalog ? { ...catalog, complete: false } : catalog };
  return { row, rawRow, rosterRow, statRows, query, service, input };
}

describe('B1 composed accepted read through existing adapters', () => {
  it('joins exact slots, dated metadata, selected attention, current groups and exact all-player facts to the same accepted capture', async () => {
    const fixture = composedFixture();
    const result = await fixture.service.readBundleOne(fixture.input);
    expect(result.status).toBe('read');
    if (result.status !== 'read' || result.official.status !== 'available') throw new Error('B1 read unavailable.');
    expect(result.official.lineupApplicability).toMatchObject({ status: 'available',
      period: { season: 2026, seasonType: 'regular', week: 4 }, startingSlots: ['QB', 'RB'] });
    expect(result.official.value.teams[0].starters?.map(slot => slot.nativeSlot)).toEqual(['QB', 'RB']);
    expect(result.official.value.teams[0].bench).toEqual([]);
    expect(result.currentRoster).toMatchObject({ temporalContext: 'current-display', value: { status: 'available' } });
    if (result.currentRoster.value.status !== 'available') throw new Error('Current roster unavailable.');
    const groups = result.currentRoster.value.teams[0].currentGroups;
    expect(groups.starters.value?.map(slot => slot.nativePlayerId)).toEqual(['1001', '0']);
    expect(groups.reserve.value?.map(member => member.sourceEntity.nativeId)).toEqual(['1003']);
    expect(groups.taxi.value?.map(member => member.sourceEntity.nativeId)).toEqual(['1004']);
    expect(groups.bench.value?.map(member => member.sourceEntity.nativeId)).toEqual(['1005']);
    expect(result.metadata).toMatchObject({ status: 'available', historicalPlayerState: 'unverified', currentDisplay: {
      status: 'available', temporalContext: 'current-display', players: [{ sourceAge: 'known',
        sources: [{ observedAt: '2026-09-29T11:59:00.000Z' }] }, {}] } });
    expect(result.attention).toMatchObject({ status: 'available', assessment: { status: 'verified',
      issues: [{ kind: 'out', playerId: '1001' }, { kind: 'empty' }] } });
    expect(result.boxScores).toMatchObject({ status: 'available', reference: { season: 2026, week: 4,
      revision: 'a'.repeat(64), observedAt: '2026-09-29T11:57:00.000Z', receiptId: result.official.receipt.id },
      players: [{ sourceEntity: { nativeId: '1001' }, stats: { pass_yd: 0 } }, { sourceEntity: { nativeId: '1002' } }] });
    if (result.boxScores.status !== 'available') throw new Error('Box scores unavailable.');
    expect(result.boxScores.players[0].stats).not.toHaveProperty('pass_td');
    expect(result.dependencies.official?.contentId).toBe(fixture.row.accepted_rows[0].content_id);
    expect(result.dependencies.currentRoster?.receiptId).not.toBe(result.dependencies.official?.receiptId);
    expect(result.selection).toMatchObject({ status: 'available', seasonTeamId: fixture.input.selectedSeasonTeamId });
    expect(result.probability.status).toBe('available');
    expect(fixture.query).toHaveBeenCalledTimes(3);
    for (const [sql] of fixture.query.mock.calls) expect(sql).not.toMatch(/\b(?:INSERT|UPDATE|DELETE|CALL)\b/);
  });

  it('keeps confirmed issues and every exact official value with partial catalog or unproved slot applicability', async () => {
    const fixture = composedFixture({ partialCatalog: true, applicability: false });
    const result = await fixture.service.readBundleOne(fixture.input);
    if (result.status !== 'read' || result.official.status !== 'available') throw new Error('B1 read unavailable.');
    expect(result.attention).toMatchObject({ status: 'available', assessment: { status: 'unknown',
      issues: [{ kind: 'out', playerId: '1001' }, { kind: 'empty' }] } });
    expect(result.official.lineupApplicability).toEqual({ status: 'unavailable', reason: 'no_binding' });
    expect(result.official.value.teams[0].starters?.map(slot => slot.nativeSlot)).toEqual([null, null]);
    expect(result.official.value.teams[0].bench).toBeNull();
    expect(result.forecast.status).toBe('available');
    expect(result.boxScores.status).toBe('available');
    const retained = projectRetainedMatchups(b1RetainedSelection, b1RetainedEvidence(fixture.rawRow));
    if (retained.status !== 'available') throw new Error('Retained read unavailable.');
    expect(officialFacts(result.official.value)).toEqual(officialFacts(retained.value));
  });

  it('does not reinterpret current injury/groups or read actuals for an exact future period', async () => {
    const fixture = composedFixture();
    const result = await fixture.service.readBundleOne({ ...fixture.input,
      context: { ...fixture.input.context, activeWeek: 3, temporalState: 'future' } });
    if (result.status !== 'read' || result.official.status !== 'available') throw new Error('Future official facts unavailable.');
    expect(result.forecast.status).toBe('available');
    if (result.forecast.status === 'available') expect(result.forecast.teams.every(team => team.projectedOutcome === 'unavailable')).toBe(true);
    expect(result.attention).toMatchObject({ status: 'available', assessment: { status: 'unknown', issues: [] } });
    expect(result.boxScores).toEqual({ status: 'unavailable', reason: 'future_actuals_unavailable' });
    expect(result.official.value.teams[0].reserveAndTaxi).toEqual({ state: 'unknown', reason: 'period_reserve_evidence_missing' });
    expect(fixture.query.mock.calls.some(([sql]) => sql.includes('read-all-player-box-scores'))).toBe(false);
  });

  it('supports official-only reads without inventing a snapshot and reports explicit unavailable derived references', async () => {
    const fixture = composedFixture();
    const result = await fixture.service.readBundleOne({ ...fixture.input, snapshot: null });
    if (result.status !== 'read' || result.official.status !== 'available') throw new Error('Official-only read unavailable.');
    expect(result.forecast).toEqual({ status: 'unavailable', reason: 'snapshot_reference_missing' });
    expect(result.gameState).toEqual({ status: 'unavailable', reason: 'snapshot_reference_missing' });
    expect(result.probability).toEqual({ status: 'unavailable', reason: 'snapshot_reference_missing' });
    expect(result.attention).toMatchObject({ status: 'available', assessment: { status: 'unknown', issues: [{ kind: 'empty' }] } });
    expect(result.boxScores.status).toBe('available');
    expect(fixture.query.mock.calls.some(([sql]) => sql.includes('read-exact-matchup-compatibility'))).toBe(false);
  });
});
/** A later immutable accepted content may differ from the snapshot's original capture. */
function correctAcceptedCapture(fixture: ReturnType<typeof composedFixture>, change: (raw: Record<string, JsonValue>[]) => void) {
  const accepted = fixture.row.accepted_rows[0];
  const raw = structuredClone(accepted.payload) as Record<string, JsonValue>[];
  change(raw);
  const normalized = normalizeAdministrationObservation({ ...b1CaptureEnvelope(fixture.rawRow), payload: raw }, { expectedRosterCount: 2 });
  if (normalized.status !== 'accepted') throw new Error('Rejected correction fixture.');
  Object.assign(accepted, { payload: raw, content_hash: normalized.contentHash, semantic_hash: normalized.semanticHash,
    normalized_value: normalized.value, content_id: b1Uuid(90), receipt_id: b1Uuid(91), legacy_observation_id: b1Uuid(92) });
}

describe('B1 composed limitations across corrections and periods', () => {
  it('keeps forecast totals, display identity and selected-team outcome when stored sides put the opponent first', async () => {
    const fixture = composedFixture();
    const matchup = fixture.row.snapshot_rows[0].payload.matchups[0];
    matchup.sides[0].projectedPoints = 17.5;
    matchup.sides[1].projectedPoints = 13.25;
    const result = await fixture.service.readBundleOne(fixture.input);
    if (result.status !== 'read' || result.forecast.status !== 'available') throw new Error('Stored forecast unavailable.');
    expect(result.forecast.teams).toMatchObject([
      { externalRosterId: '1', projectedPoints: 13.25, projectedOutcome: 'loss', display: { name: 'Team 1' } },
      { externalRosterId: '2', projectedPoints: 17.5, projectedOutcome: 'win', display: { name: 'Team 2' } },
    ]);
    expect(result.forecast.teams[0].starters[0].projectedPoints).toBe(10);
    expect(result.selection).toMatchObject({ status: 'available', seasonTeamId: fixture.input.selectedSeasonTeamId });
    expect(result.probability).toMatchObject({ status: 'available', groups: [{ value: matchup.winProbability }] });
  });
  it('keeps corrected official custom points while independently withholding an old forecast', async () => {
    const fixture = composedFixture();
    correctAcceptedCapture(fixture, raw => { raw[0].custom_points = -1.25; });
    const result = await fixture.service.readBundleOne(fixture.input);
    if (result.status !== 'read' || result.official.status !== 'available') throw new Error('Correction lost official data.');
    expect(result.official.value.teams[0].officialTeamPoints).toMatchObject({ raw: '8.25', custom: '-1.25', effective: '-1.25' });
    expect(result.forecast).toEqual({ status: 'unavailable', reason: 'original_official_facts_mismatch' });
    expect(result.official.value.teams[0].starters?.[0].officialPoints).toBe('8.25');
    expect(result.boxScores.status).toBe('available');
    const retained = projectRetainedMatchups(b1RetainedSelection, b1RetainedEvidence(fixture.row));
    if (retained.status !== 'available') throw new Error('Correction lost retained evidence.');
    expect(officialFacts(result.official.value)).toEqual(officialFacts(retained.value));
  });

  it('preserves an unpaired official participant without inventing an opponent or borrowed matchup', async () => {
    const fixture = composedFixture();
    correctAcceptedCapture(fixture, raw => { raw[0].matchup_id = null; });
    const result = await fixture.service.readBundleOne({ ...fixture.input, snapshot: null });
    if (result.status !== 'read' || result.official.status !== 'available') throw new Error('Unpaired official data unavailable.');
    expect(result.official.value.groups).toHaveLength(2);
    expect(result.official.value.groups.every(group => group.format === 'unpaired' && group.participantTeamIds.length === 1)).toBe(true);
    expect(result.selection).toMatchObject({ status: 'available', groups: [{ participantTeamIds: [fixture.input.selectedSeasonTeamId] }] });
    expect(result.forecast.status).toBe('unavailable');
  });

  it('treats partial statistic inventory as missing while preserving observed zero and exact source age', async () => {
    const fixture = composedFixture();
    fixture.statRows[1].stats = {};
    const result = await fixture.service.readBundleOne(fixture.input);
    if (result.status !== 'read' || result.boxScores.status !== 'available') throw new Error('Partial statistic read unavailable.');
    expect(result.boxScores.coverage.status).toBe('partial');
    expect(result.boxScores.players).toMatchObject([{ status: 'available', stats: { pass_yd: 0 } }, { status: 'missing', stats: null }]);
    expect(result.boxScores.reference.observedAt).toBe('2026-09-29T11:57:00.000Z');
    expect(result.official.status).toBe('available');
    expect(result.forecast.status).toBe('available');
  });

  it('isolates wrong box-score entity identity from the exact matchup and forecast', async () => {
    const fixture = composedFixture();
    fixture.statRows[0].provider_external_id = '1009';
    const result = await fixture.service.readBundleOne(fixture.input);
    if (result.status !== 'read') throw new Error('B1 read unavailable.');
    expect(result.boxScores.status).toBe('unavailable');
    expect(result.official.status).toBe('available');
    expect(result.forecast.status).toBe('available');
  });

  it('preserves historical results without assigning current injury or reserve status to the exact past lineup', async () => {
    const fixture = composedFixture();
    const result = await fixture.service.readBundleOne({ ...fixture.input,
      context: { ...fixture.input.context, activeWeek: 5, temporalState: 'past' }, now: new Date('2026-10-12T12:00:00.000Z') });
    if (result.status !== 'read' || result.official.status !== 'available') throw new Error('Past exact facts unavailable.');
    expect(result.forecast.status).toBe('available');
    expect(result.attention).toMatchObject({ status: 'available', assessment: { status: 'completed', issues: [] },
      limitations: expect.arrayContaining(['current_metadata_not_historical', 'local_completion_not_provider_finality']) });
    expect(result.official.value.teams[0].reserveAndTaxi.state).toBe('unknown');
    expect(result.official.value.state.provider).toBe('unknown');
  });

  it('keeps official and roster evidence while the existing active snapshot freshness policy withholds derived results', async () => {
    const fixture = composedFixture();
    const result = await fixture.service.readBundleOne({ ...fixture.input, now: new Date('2026-10-04T17:01:00.000Z') });
    if (result.status !== 'read') throw new Error('B1 read unavailable.');
    expect(result.forecast).toEqual({ status: 'unavailable', reason: 'snapshot_stale' });
    expect(result.gameState.status).toBe('unavailable');
    expect(result.official.status).toBe('available');
    expect(result.currentRoster.value.status).toBe('available');
    expect(result.attention).toMatchObject({ status: 'available', assessment: { status: 'unknown', issues: [{ kind: 'empty' }] } });
  });
});