import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { DatabaseClient, DatabaseRow } from '../lib/database';
import type { JsonValue } from '../lib/league-administration/contracts';
import type { AdministrationSourceMapping } from '../lib/league-administration/source-mapping';
import { createLeagueAdministrationMethods } from '../lib/league-administration/neon/administration';
import { normalizeAdministrationObservation } from '../lib/league-administration/normalize';
import { createRetainedMatchupComparison, type RetainedMatchupManifest } from '../lib/league-administration/retained-matchup-comparison';
import type { RetainedMatchupSelection } from '../lib/league-administration/retained-matchups-contracts';
import { createProjectionStore } from '../lib/projection-store';
import { exactMatchupClockInstant } from './exact-matchup-clock';
import { createIndependentDatabase, ownerQuery, type IndependentDatabase } from './neon-integration-harness';

const rules = { rec: 0.5 };
const ordinary = [
  { roster_id: 1, matchup_id: 4, players: ['a', 'b'], starters: ['a', '0'],
    starters_points: [0, null], players_points: { a: 9.5, b: -1 }, points: 8.25, custom_points: 0 },
  { roster_id: 2, matchup_id: 4, players: [], starters: [], points: -2.25 },
];

describe.sequential('read-only retained matchup comparison through the guarded disposable suite', () => {
  let connection: IndependentDatabase;
  let store: ReturnType<typeof createLeagueAdministrationMethods>;
  beforeAll(() => { connection = createIndependentDatabase(); store = createLeagueAdministrationMethods(connection.database); });
  afterAll(async () => connection.close());

  async function fixture() {
    const leagueKey = `retained-matchups-${randomUUID()}`;
    const externalLeagueId = `retained-source-${randomUUID()}`; const season = 2190;
    const registered = await createProjectionStore(connection.database).registerLeagueSeason({
      leagueKey, leagueName: 'Synthetic retained comparison', season, sleeperLeagueId: externalLeagueId, scoringRules: rules,
    });
    if (registered.kind !== 'stored') throw new Error('Isolated fixture registration failed.');
    await ownerQuery("INSERT INTO league_administration_enrollments(league_id,provider,evidence) VALUES($1,'sleeper','synthetic retained fixture')", [registered.value.leagueId]);
    await ownerQuery("INSERT INTO league_administration_enrollment_seasons(league_id,season,provider,evidence) VALUES($1,$2,'sleeper','synthetic retained fixture')", [registered.value.leagueId, season]);
    const mapping = await store.readSourceMapping(externalLeagueId);
    if (!mapping) throw new Error('Missing synthetic source mapping.');
    const selection: RetainedMatchupSelection = { leagueSeasonId: registered.value.leagueSeasonId, scope: mapping.scope, nativeWeeks: [3] };
    return { ...registered.value, mapping, selection };
  }
  async function document(mapping: AdministrationSourceMapping, payload: unknown = ordinary, week = 3,
    completeness: 'complete' | 'partial' = 'complete') {
    const [clock] = await ownerQuery('SELECT clock_timestamp() AS at FROM pg_sleep(0.005)');
    const at = exactMatchupClockInstant(clock.at);
    return normalizeAdministrationObservation({ schemaVersion: 'league-administration-v1',
      normalizerVersion: 'sleeper-administration-v1', dialect: 'sleeper-nfl-v1', scope: mapping.scope,
      family: 'matchups', week, completeness, payload: payload as JsonValue,
      provenance: { origin: 'network', requestStartedAt: at, requestCompletedAt: at, sourceObservedAt: at, checkedAt: at } });
  }
  async function receipt(mapping: AdministrationSourceMapping, payload: unknown = ordinary) {
    const attempt = await store.beginExactMatchupAttempt(mapping, 3, randomUUID());
    const input = await document(mapping, payload);
    const result = await store.recordObservation(input, undefined, mapping, undefined, undefined, undefined, { attempt });
    if (!result.observationId || !result.matchupAcceptance?.receiptId) throw new Error('Missing synthetic exact receipt.');
    return { input, result };
  }
  async function manifest(selection: RetainedMatchupSelection) {
    const result = await createRetainedMatchupComparison(store).createManifest(selection);
    expect(result.status).toBe('available');
    if (result.status !== 'available') throw new Error(`Unavailable synthetic manifest: ${result.reason}`);
    return result.manifest;
  }
  async function compare(value: RetainedMatchupManifest, batchSize: number) {
    const planner = createRetainedMatchupComparison(store);
    const entries = []; let cursor;
    for (;;) {
      const result = await planner.compareBatch({ manifest: value, cursor, batchSize });
      if ('reason' in result) throw new Error(result.reason);
      entries.push(...result.entries);
      if (result.status === 'complete') return entries;
      cursor = result.cursor;
    }
  }
  // Fixed synthetic state inventory, including accepted/network evidence and every prohibited output family.
  async function stateDigest() {
    const tables = ['league_administration_contents', 'league_administration_observations', 'league_administration_heads',
      'league_administration_observation_mappings', 'league_roster_resource_attempts', 'league_roster_capture_receipts',
      'league_roster_resource_acceptances', 'league_roster_resource_heads', 'league_calculation_source_captures',
      'league_calculation_capture_inputs', 'scoring_profiles', 'league_week_observations', 'official_player_point_observations',
      'official_roster_point_observations', 'pregame_projection_runs', 'pregame_projection_candidates',
      'pregame_projection_baselines', 'projection_snapshots', 'current_projection_snapshots'];
    const columns = tables.map(table => `(SELECT md5(COALESCE(jsonb_agg(to_jsonb(item) ORDER BY to_jsonb(item)::text)::text,'[]'))
      FROM public.${table} item) AS ${table}`);
    return ownerQuery(`SELECT ${columns.join(',')}`);
  }

  it('preserves original source age when a same-content legacy read only refreshes a later head', async () => {
    const f = await fixture(); const original = await document(f.mapping);
    const first = await store.recordObservation(original); const frozen = await manifest(f.selection);
    const later = await document(f.mapping); const repeated = await store.recordObservation(later);
    expect(repeated.observationId).toBe(first.observationId);
    expect(later.envelope.provenance.sourceObservedAt).not.toBe(original.envelope.provenance.sourceObservedAt);
    const values = await compare(frozen, 1);
    expect(values).toHaveLength(1);
    expect(values[0].result.status).toBe('available');
    if (values[0].result.status !== 'available') throw new Error('Missing retained original projection.');
    expect(Date.parse(values[0].result.source.sourceObservedAt!)).toBe(Date.parse(original.envelope.provenance.sourceObservedAt!));
    expect(values[0].result.lineage.sourceMappingRevisionId).toBeNull();
    expect(values[0].result.limitations).toContain('mapping_revision_not_captured');
    expect(values[0].result.value.teams[0].officialTeamPoints).toMatchObject({ raw: '8.25', custom: '0', effective: '0' });
    expect(values[0].result.value.teams[0].starters?.[1]).toMatchObject({ empty: true, playerExternalId: null });
    expect(values[0].result.value.teams[1].players).toEqual([]);
    expect(values[0].result.source.checkedAt).toMatch(/\.\d{6}Z$/u);
  });

  it('freezes membership and yields identical bounded retry results without modifying any retained or published state', async () => {
    const f = await fixture();
    await store.recordObservation(await document(f.mapping));
    await store.recordObservation(await document(f.mapping, [{ ...ordinary[0], custom_points: -3 }, ordinary[1]]));
    const frozen = await manifest(f.selection);
    await store.recordObservation(await document(f.mapping, [{ ...ordinary[0], custom_points: 6.5 }, ordinary[1]]));
    const fresh = await manifest(f.selection);
    expect(frozen.entries).toHaveLength(2); expect(fresh.entries).toHaveLength(3);
    const before = await stateDigest();
    const all = await compare(frozen, 100); const one = await compare(frozen, 1);
    expect(one).toEqual(all); expect(await compare(frozen, 1)).toEqual(all);
    const statements: string[] = [];
    const readOnly: DatabaseClient = { enabled: true,
      async query<Row extends DatabaseRow>(statement: string, parameters: readonly unknown[] = []) {
        statements.push(statement);
        if (!/^\s*(?:\/\*[\s\S]*?\*\/\s*)?SELECT\b/u.test(statement)) throw new Error('Unexpected planner write.');
        return connection.database.query<Row>(statement, parameters);
      } };
    const planner = createRetainedMatchupComparison(createLeagueAdministrationMethods(readOnly));
    const first = await planner.compareBatch({ manifest: frozen, batchSize: 1 });
    if (first.status !== 'more') throw new Error('Expected interrupted progress.');
    expect(await planner.compareBatch({ manifest: frozen, batchSize: 1 })).toEqual(first);
    const resumed = await planner.compareBatch({ manifest: frozen, cursor: first.cursor, batchSize: 1 });
    expect(resumed.status).toBe('complete');
    expect(statements).toHaveLength(3);
    expect(await stateDigest()).toEqual(before);
  });

  it('preserves original captured receipt revisions through A-to-B-to-A without following the current connection', async () => {
    const f = await fixture(); const a1 = await receipt(f.mapping); const frozen = await manifest(f.selection);
    const alternate = `alternate-${randomUUID()}`;
    await ownerQuery("SELECT revise_league_source_connection($1,'sleeper',$2,$3,'synthetic remap away')",
      [f.leagueSeasonId, f.mapping.revisionId, alternate]);
    const b2 = await store.readSourceMapping(alternate);
    if (!b2) throw new Error('Missing alternate mapping.');
    await receipt(b2, [{ ...ordinary[0], custom_points: -7 }, ordinary[1]]);
    expect((await compare(frozen, 1))[0].result).toMatchObject({ status: 'available', lineage: { sourceMappingRevisionId: f.mapping.revisionId } });
    await ownerQuery("SELECT revise_league_source_connection($1,'sleeper',$2,$3,'synthetic remap back')",
      [f.leagueSeasonId, b2.revisionId, f.mapping.scope.externalLeagueId]);
    const a3 = await store.readSourceMapping(f.mapping.scope.externalLeagueId);
    if (!a3) throw new Error('Missing returned mapping.');
    await receipt(a3, [{ ...ordinary[0], custom_points: -8 }, ordinary[1]]);
    const next = await manifest(f.selection); expect(next.entries).toHaveLength(2);
    const values = await compare(next, 1);
    expect(values.map(item => item.result.status === 'available' ? item.result.lineage.sourceMappingRevisionId : null))
      .toEqual([f.mapping.revisionId, a3.revisionId]);
    expect(values[0].observationId).toBe(a1.result.observationId);
    expect(await compare(frozen, 1)).toEqual(values.slice(0, 1));
  });

  it('never attaches a later equal-content network receipt mapping to an older unmapped observation', async () => {
    const f = await fixture(); const first = await store.recordObservation(await document(f.mapping));
    const frozen = await manifest(f.selection); const before = await compare(frozen, 1);
    const acquired = await receipt(f.mapping);
    expect(acquired.result.observationId).toBe(first.observationId);
    expect(await compare(frozen, 1)).toEqual(before);
    const scan = await store.scanRetainedMatchups(f.selection);
    if (scan.status !== 'available') throw new Error('Missing retained scan.');
    expect(scan.evidence[0].mappingCandidates).toEqual([]);
    expect(scan.evidence[0].mapping).toBeNull();
  });

  it('matches exact original receipt instants across retained offset JSON and normalized UTC database timestamps', async () => {
    const f = await fixture(); const attempt = await store.beginExactMatchupAttempt(f.mapping, 3, randomUUID());
    const input = await document(f.mapping);
    const offset = new Date(Date.parse(input.envelope.provenance.checkedAt) + 3_600_000).toISOString().replace('Z', '+01:00');
    const normalized = normalizeAdministrationObservation({ ...input.envelope,
      provenance: { origin: 'network', requestStartedAt: offset, requestCompletedAt: offset, sourceObservedAt: offset, checkedAt: offset } });
    await store.recordObservation(normalized, undefined, f.mapping, undefined, undefined, undefined, { attempt });
    const scanned = await store.scanRetainedMatchups(f.selection);
    if (scanned.status !== 'available') throw new Error('Missing offset source scan.');
    expect(scanned.evidence[0].observation.provenance.sourceObservedAt).toMatch(/\.\d{6}Z$/u);
    expect(scanned.evidence[0].mappingCandidates[0].provenance.sourceObservedAt).toBe(offset);
    expect((await compare(await manifest(f.selection), 1))[0].result)
      .toMatchObject({ status: 'available', lineage: { sourceMappingRevisionId: f.mapping.revisionId } });
  });

  it('retains exact calculation-input mapping proof and excludes later consumption of the same original content', async () => {
    const f = await fixture();
    const firstCapture = await store.beginCalculationSourceCapture(f.mapping, 3, randomUUID());
    const firstInput = await document(f.mapping);
    const first = await store.recordObservation(firstInput, undefined, f.mapping,
      undefined, undefined, undefined, undefined, undefined, firstCapture);
    expect(first.calculationInput?.status).toBe('retained');
    const frozen = await manifest(f.selection); const original = await compare(frozen, 1);
    expect(original[0].result).toMatchObject({ status: 'available', lineage: { sourceMappingRevisionId: f.mapping.revisionId } });
    const laterCapture = await store.beginCalculationSourceCapture(f.mapping, 3, randomUUID());
    const later = await store.recordObservation(await document(f.mapping), undefined, f.mapping,
      undefined, undefined, undefined, undefined, undefined, laterCapture);
    expect(later.observationId).toBe(first.observationId);
    expect(await compare(frozen, 1)).toEqual(original);
    const scan = await store.scanRetainedMatchups(f.selection);
    if (scan.status !== 'available') throw new Error('Missing calculation scan.');
    expect(scan.evidence[0].mappingCandidates).toHaveLength(1);
    expect(scan.evidence[0].mappingCandidates[0]).toMatchObject({ kind: 'calculation-input', id: first.calculationInput!.id });
  });

  it('rejects wrong league/season identity, preserves partial evidence as rejected, and keeps unrelated periods outside the manifest', async () => {
    const f = await fixture();
    await store.recordObservation(await document(f.mapping, ordinary.slice(0, 1), 3, 'partial'));
    await store.recordObservation(await document(f.mapping, ordinary, 4));
    const frozen = await manifest(f.selection); expect(frozen.entries).toHaveLength(1);
    expect((await compare(frozen, 1))[0].result).toEqual({ status: 'rejected', reason: 'complete_matchup_capture_required' });
    expect(await store.scanRetainedMatchups({ ...f.selection, scope: { ...f.selection.scope, leagueKey: 'wrong-league' } }))
      .toEqual({ status: 'unavailable', reason: 'retained_matchup_scope_mismatch' });
    expect(await store.scanRetainedMatchups({ ...f.selection, scope: { ...f.selection.scope, season: 2191 } }))
      .toEqual({ status: 'unavailable', reason: 'retained_matchup_scope_mismatch' });
    expect(await store.readRetainedMatchups({ ...f.selection, nativeWeeks: [4] }, frozen.entries.map(item => item.observationId)))
      .toEqual({ status: 'available', evidence: [] });
  });
});
