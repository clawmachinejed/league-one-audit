import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AdministrationFamily, JsonValue, NormalizedAdministrationObservation } from '../lib/league-administration/contracts';
import type { CalculationSourceCapture } from '../lib/league-administration/calculation-capture';
import { createLeagueAdministrationMethods } from '../lib/league-administration/neon/administration';
import { normalizeAdministrationObservation } from '../lib/league-administration/normalize';
import { createProjectionSourceHistoryReader, createProjectionStore, type PublishSnapshotInput } from '../lib/projection-store';
import { calculateLineupRevision } from '../lib/projections/domain/lineup-revision';
import { translateSleeperLineupObservation } from '../lib/projections/adapters/sleeper/lineup-observation';
import { externalLeagueRef, externalRosterRef } from '../lib/projections/shared/provider-identity';
import type { SleeperMatchup } from '../lib/transform';
import { exactMatchupClockInstant } from './exact-matchup-clock';
import { createIndependentDatabase, ownerQuery, runtimeQuery, type IndependentDatabase } from './neon-integration-harness';

const rules = { rec: 0.5 };
const matchups: readonly SleeperMatchup[] = [
  { roster_id: 1, matchup_id: 1, players: ['a'], starters: ['a'], players_points: { a: 8 }, points: 8, custom_points: 0 },
  { roster_id: 2, matchup_id: 1, players: ['b'], starters: ['b'], players_points: { b: 4 }, points: 4 },
];

describe.sequential('immutable calculation source consumption history', () => {
  let connection: IndependentDatabase;
  let store: ReturnType<typeof createLeagueAdministrationMethods>;
  beforeAll(() => { connection = createIndependentDatabase(); store = createLeagueAdministrationMethods(connection.database); });
  afterAll(async () => connection.close());
  async function fixture() {
    const leagueKey = `calculation-history-${randomUUID()}`; const externalLeagueId = `source-${randomUUID()}`;
    const registered = await createProjectionStore(connection.database).registerLeagueSeason({
      leagueKey, leagueName: 'Synthetic source history', season: 2162, sleeperLeagueId: externalLeagueId, scoringRules: rules,
    });
    if (registered.kind !== 'stored') throw new Error('Fixture registration failed.');
    await ownerQuery("INSERT INTO league_administration_enrollments(league_id,provider,evidence) VALUES($1,'sleeper','synthetic fixture')", [registered.value.leagueId]);
    await ownerQuery("INSERT INTO league_administration_enrollment_seasons(league_id,season,provider,evidence) VALUES($1,2162,'sleeper','synthetic fixture')", [registered.value.leagueId]);
    const mapping = await store.readSourceMapping(externalLeagueId);
    if (!mapping) throw new Error('Missing fixture mapping.');
    return { ...registered.value, leagueKey, externalLeagueId, mapping };
  }
  type Fixture = Awaited<ReturnType<typeof fixture>>;
  const leaguePayload = (f: Fixture) => ({ league_id: f.externalLeagueId, season: '2162', sport: 'nfl',
    season_type: 'regular', total_rosters: 2, scoring_settings: rules, roster_positions: ['QB', 'BN'], settings: { leg: 3 }, status: 'in_season' });
  async function instant() {
    const [clock] = await ownerQuery('SELECT clock_timestamp() AS at FROM pg_sleep(0.005)');
    return exactMatchupClockInstant(clock.at);
  }
  async function document(f: Fixture, family: AdministrationFamily = 'league', payload: unknown = leaguePayload(f),
    origin: 'network' | 'cache' = 'network', at = '') {
    const time = at || await instant();
    return normalizeAdministrationObservation({ schemaVersion: 'league-administration-v1', normalizerVersion: 'sleeper-administration-v1',
      dialect: 'sleeper-nfl-v1', scope: f.mapping.scope, family, week: family === 'matchups' ? 3 : null,
      completeness: 'complete', payload: payload as JsonValue,
      provenance: { origin, requestStartedAt: time, requestCompletedAt: time, sourceObservedAt: origin === 'network' ? time : null, checkedAt: time } });
  }
  const write = (f: Fixture, input: NormalizedAdministrationObservation, capture: CalculationSourceCapture) =>
    store.recordObservation(input, undefined, f.mapping, undefined, undefined, undefined, undefined, undefined, capture);
  async function seed(existing?: Fixture) {
    const f = existing ?? await fixture(); const capture = await store.beginCalculationSourceCapture(f.mapping, 3, randomUUID());
    const league = await document(f); const leagueResult = await write(f, league, capture);
    const matchup = await document(f, 'matchups', matchups); const matchupResult = await write(f, matchup, capture);
    if (!leagueResult.observationId || !leagueResult.versionId || !leagueResult.calculationInput || !matchupResult.calculationInput) {
      throw new Error('Missing retained calculation inputs.');
    }
    const administration = { observationId: leagueResult.observationId, configurationVersionId: leagueResult.versionId,
      generation: leagueResult.generation, sourceCapture: { captureId: capture.id,
        leagueInputId: leagueResult.calculationInput.id, matchupInputId: matchupResult.calculationInput.id } };
    return { f, capture, league, leagueResult, matchup, matchupResult, administration };
  }
  type Seed = Awaited<ReturnType<typeof seed>>;
  function official(value: Seed, sourceData: Readonly<Record<string, unknown>> = { administration: value.administration }, overrides: Record<string, unknown> = {}) {
    const provenance = value.matchup.envelope.provenance;
    return createProjectionStore(connection.database).recordLeagueWeekObservation({ leagueSeasonId: value.f.leagueSeasonId,
      week: 3, sourceRevision: randomUUID(), requestStartedAt: provenance.requestStartedAt!,
      requestCompletedAt: provenance.requestCompletedAt!, observedAt: provenance.sourceObservedAt!, quality: 'complete',
      sourceData, expectedTank01GameIds: [], playerPoints: [],
      rosterPoints: [{ externalRosterId: '1', points: 0 }, { externalRosterId: '2', points: 4 }], ...overrides });
  }
  const counts = (f: Fixture) => ownerQuery(`SELECT
    (SELECT count(*)::integer FROM league_administration_contents WHERE league_season_id=$1) AS contents,
    (SELECT count(*)::integer FROM league_administration_observations WHERE league_season_id=$1) AS observations,
    (SELECT count(*)::integer FROM league_calculation_capture_inputs input JOIN league_calculation_source_captures capture
      ON capture.id=input.capture_id WHERE capture.league_season_id=$1) AS inputs,
    (SELECT jsonb_agg(to_jsonb(head) ORDER BY family,week) FROM league_administration_heads head WHERE league_season_id=$1) AS heads`, [f.leagueSeasonId]);

  /** Same synthetic ownership setup as the store suite; publication itself uses the real restricted adapter. */
  async function publicationFence(f: Fixture): Promise<PublishSnapshotInput['lineupFence']> {
    const watchId = randomUUID(); const runId = randomUUID();
    await ownerQuery(`INSERT INTO league_period_authorities
      (league_key,default_season,default_season_type,default_week,active_season,active_season_type,active_week,
        league_lifecycle,nfl_phase,source_provider,source_revision,source_observed_at,verified_at,source_external_league_id,
        expected_roster_count,expected_starter_slot_count,expected_roster_ids)
      VALUES($1,2162,'reg',3,2162,'reg',3,'active','regular','sleeper','synthetic-source-history',now(),now(),$2,2,1,ARRAY['1','2'])`,
    [f.leagueKey, f.externalLeagueId]);
    await ownerQuery(`INSERT INTO league_week_lineup_watch_states
      (id,league_key,source_provider,external_league_id,season,season_type,week,lineup_revision_version,cadence_policy_version,
        authority_generation,watch_class,materialization_lane,phase,expected_roster_count,expected_starter_slot_count,expected_roster_ids,next_check_at)
      VALUES($1,$2,'sleeper',$3,2162,'reg',3,'lineup-v1','lineup-cadence-v1',1,'current','current',0,2,1,ARRAY['1','2'],now())`,
    [watchId, f.leagueKey, f.externalLeagueId]);
    await ownerQuery(`INSERT INTO projection_jobs(job_key,job_type,scheduled_for,state,lease_owner,lease_until)
      VALUES('live-projection-sync','projection-sync',now(),'running',$1,now()+interval '5 minutes')
      ON CONFLICT(job_key) DO UPDATE SET state='running',lease_owner=$1,lease_until=now()+interval '5 minutes'`, [runId]);
    return { watchId, watchGeneration: 1, authorityGeneration: 1, ownerLane: 'current', runId };
  }

  it('reserves exact immutable source identity without changing resource attempts or accepted heads', async () => {
    const f = await fixture(); const attempt = await store.beginExactMatchupAttempt(f.mapping, 3, randomUUID());
    const before = await ownerQuery('SELECT * FROM league_roster_resource_heads WHERE scope_id=$1', [attempt.scopeId]);
    const id = randomUUID(); const capture = await store.beginCalculationSourceCapture(f.mapping, 3, id);
    expect(capture.id).toBe(id); expect(Number.isFinite(Date.parse(capture.reservedAt))).toBe(true);
    expect(await store.beginCalculationSourceCapture(f.mapping, 3, id)).toEqual(capture);
    await expect(store.beginCalculationSourceCapture(f.mapping, 4, id)).rejects.toThrow(/identity conflict/);
    expect(await ownerQuery('SELECT * FROM league_roster_resource_heads WHERE scope_id=$1', [attempt.scopeId])).toEqual(before);
    expect(await ownerQuery('SELECT * FROM league_roster_resource_attempts WHERE scope_id=$1', [attempt.scopeId])).toHaveLength(1);
  });

  it('retains actual deduplicated input provenance without rewriting the original v1 observation', async () => {
    const f = await fixture(); const oldLeague = await store.recordObservation(await document(f));
    const oldMatchup = await store.recordObservation(await document(f, 'matchups', matchups));
    const before = await ownerQuery('SELECT * FROM league_administration_observations WHERE id=ANY($1::uuid[]) ORDER BY id', [[oldLeague.observationId, oldMatchup.observationId]]);
    const capture = await store.beginCalculationSourceCapture(f.mapping, 3, randomUUID());
    const league = await document(f); const first = await write(f, league, capture);
    const matchup = await document(f, 'matchups', matchups); const second = await write(f, matchup, capture);
    expect(first.observationId).toBe(oldLeague.observationId); expect(second.observationId).toBe(oldMatchup.observationId);
    expect(first.calculationInput?.status).toBe('retained');
    expect(await ownerQuery('SELECT family,provenance FROM league_calculation_capture_inputs WHERE capture_id=$1 ORDER BY family', [capture.id]))
      .toEqual([{ family: 'league', provenance: league.envelope.provenance }, { family: 'matchups', provenance: matchup.envelope.provenance }]);
    expect(await ownerQuery('SELECT * FROM league_administration_observations WHERE id=ANY($1::uuid[]) ORDER BY id', [[oldLeague.observationId, oldMatchup.observationId]])).toEqual(before);
  });

  it('retains cached configuration consumption with unknown provider age even when retrieval predates reservation', async () => {
    const f = await fixture(); await store.recordObservation(await document(f));
    const originalCached = await document(f, 'league', leaguePayload(f), 'cache');
    const capture = await store.beginCalculationSourceCapture(f.mapping, 3, randomUUID());
    const cached = normalizeAdministrationObservation({ ...originalCached.envelope,
      provenance: { ...originalCached.envelope.provenance, checkedAt: await instant() } });
    const result = await write(f, cached, capture);
    expect(result.calculationInput?.status).toBe('retained');
    expect(await ownerQuery('SELECT provenance FROM league_calculation_capture_inputs WHERE id=$1', [result.calculationInput?.id]))
      .toEqual([{ provenance: cached.envelope.provenance }]);
    expect(cached.envelope.provenance.sourceObservedAt).toBeNull();
  });

  it('replays exact input and rejects changed provenance or content atomically', async () => {
    const value = await seed();
    expect((await write(value.f, value.league, value.capture)).calculationInput)
      .toEqual({ id: value.leagueResult.calculationInput!.id, status: 'replayed' });
    const before = await counts(value.f);
    await expect(write(value.f, await document(value.f), value.capture)).rejects.toThrow(/replay conflict/);
    expect(await counts(value.f)).toEqual(before);
    await expect(write(value.f, await document(value.f, 'league', { ...leaguePayload(value.f), name: 'Different' }), value.capture))
      .rejects.toThrow(/replay conflict/);
    expect(await counts(value.f)).toEqual(before);
  });

  it.each(['league', 'matchups'] as const)('rejects a %s network input acquired before reservation without leaving legacy writes', async family => {
    const f = await fixture(); const input = await document(f, family, family === 'league' ? leaguePayload(f) : matchups);
    const capture = await store.beginCalculationSourceCapture(f.mapping, 3, randomUUID());
    const before = await counts(f);
    await expect(write(f, input, capture)).rejects.toThrow(/predates reservation/);
    expect(await counts(f)).toEqual(before);
  });

  it('rejects cached matchup provenance and mismatched capture timestamp or week', async () => {
    const f = await fixture(); const capture = await store.beginCalculationSourceCapture(f.mapping, 3, randomUUID());
    const before = await counts(f);
    await expect(write(f, await document(f, 'matchups', matchups, 'cache'), capture)).rejects.toThrow(/provenance/);
    expect(await counts(f)).toEqual(before);
    await expect(write(f, await document(f), { ...capture, reservedAt: '2026-01-01T00:00:00.000Z' })).rejects.toThrow(/scope mismatch/);
    const fourth = await store.beginCalculationSourceCapture(f.mapping, 4, randomUUID());
    await expect(write(f, await document(f, 'matchups', matchups), fourth)).rejects.toThrow(/scope mismatch/);
    expect(await counts(f)).toEqual(before);
  });

  it('rejects partial or invalid normalized documents before altering legacy evidence', async () => {
    const f = await fixture(); const capture = await store.beginCalculationSourceCapture(f.mapping, 3, randomUUID());
    const valid = await document(f); const before = await counts(f);
    const partial = normalizeAdministrationObservation({ ...valid.envelope, completeness: 'partial' });
    const invalid = normalizeAdministrationObservation({ ...valid.envelope, payload: { league_id: 'wrong' } });
    await expect(write(f, partial, capture)).rejects.toThrow(/accepted mapped capture/);
    await expect(write(f, invalid, capture)).rejects.toThrow(/accepted mapped capture/);
    expect(await counts(f)).toEqual(before);
  });

  it('stores the original official source association and keeps legacy unlinked observations unchanged', async () => {
    const value = await seed();
    const result = await official(value, { administration: value.administration, leagueKey: value.f.leagueKey,
      season: '2162', week: 3, rosterIds: ['1', '2'] });
    if (result.kind !== 'stored') throw new Error('Official observation unavailable.');
    expect((await ownerQuery('SELECT source_data FROM league_week_observations WHERE id=$1', [result.value.observationId]))[0].source_data)
      .toMatchObject({ administration: value.administration });
    const legacy = await official(value, {});
    if (legacy.kind !== 'stored') throw new Error('Legacy observation unavailable.');
    expect((await ownerQuery('SELECT source_data FROM league_week_observations WHERE id=$1', [legacy.value.observationId]))[0].source_data)
      .not.toHaveProperty('administration');
    await ownerQuery("UPDATE league_week_observations SET source_data=source_data||'{\"legacyNote\":true}'::jsonb WHERE id=$1", [legacy.value.observationId]);
    await expect(ownerQuery("UPDATE league_week_observations SET source_data=jsonb_build_object('administration',$2::jsonb) WHERE id=$1",
      [legacy.value.observationId, JSON.stringify(value.administration)])).rejects.toThrow(/immutable/);
    await expect(ownerQuery("UPDATE league_week_observations SET source_data=source_data#-'{administration,sourceCapture}' WHERE id=$1",
      [result.value.observationId])).rejects.toThrow(/immutable/);
    await expect(ownerQuery("UPDATE league_week_observations SET source_revision='replacement' WHERE id=$1",
      [result.value.observationId])).rejects.toThrow(/immutable/);
    // No surviving snapshot or acceptance references these synthetic parents.
    // Existing pruning semantics remain available with the new JSON association.
    expect(await ownerQuery('DELETE FROM league_week_observations WHERE id=$1 RETURNING id', [result.value.observationId]))
      .toEqual([{ id: result.value.observationId }]);
  });

  it.each(['capture', 'league', 'matchup', 'configuration', 'observation', 'generation'] as const)('rejects a mismatched %s association', async field => {
    const value = await seed();
    const context = { ...value.administration, sourceCapture: { ...value.administration.sourceCapture } };
    if (field === 'capture') context.sourceCapture.captureId = randomUUID();
    if (field === 'league') context.sourceCapture.leagueInputId = randomUUID();
    if (field === 'matchup') context.sourceCapture.matchupInputId = randomUUID();
    if (field === 'configuration') context.configurationVersionId = randomUUID();
    if (field === 'observation') context.observationId = randomUUID();
    if (field === 'generation') context.generation = Number(context.generation) + 1;
    await expect(official(value, { administration: context })).rejects.toThrow(/lineage/);
    expect(await ownerQuery('SELECT id FROM league_week_observations WHERE league_season_id=$1', [value.f.leagueSeasonId])).toHaveLength(0);
  });

  it('rejects wrong official interval, roster population and explicit season context', async () => {
    const value = await seed(); const later = await instant();
    await expect(official(value, { administration: value.administration }, { requestCompletedAt: later })).rejects.toThrow(/lineage/);
    await expect(official(value, { administration: value.administration, rosterIds: ['1'] })).rejects.toThrow(/population mismatch/);
    await expect(official(value, { administration: value.administration, season: '2161' })).rejects.toThrow(/lineage/);
  });

  it('fences acquisition and observation insertion against an A to B to A remap even with identical configuration', async () => {
    const value = await seed();
    const revise = async (previous: string, external: string) => {
      const [row] = await ownerQuery("SELECT revise_league_source_connection($1,'sleeper',$2,$3,'synthetic source revision') AS id",
        [value.f.leagueSeasonId, previous, external]); return String(row.id);
    };
    const second = await revise(value.f.mapping.revisionId, `different-${randomUUID()}`);
    const third = await revise(second, value.f.externalLeagueId);
    const nextMapping = await store.readSourceMapping(value.f.externalLeagueId);
    expect(nextMapping?.revisionId).toBe(third);
    await expect(store.beginCalculationSourceCapture(value.f.mapping, 3, randomUUID())).rejects.toThrow(/stale/);
    await expect(write(value.f, await document(value.f), value.capture)).rejects.toThrow(/stale/);
    await expect(official(value)).rejects.toThrow(/lineage/);
    if (!nextMapping) throw new Error('Missing remapped source.');
    const f = { ...value.f, mapping: nextMapping };
    const nextCapture = await store.beginCalculationSourceCapture(nextMapping, 3, randomUUID());
    const next = await write(f, await document(f), nextCapture);
    expect(next.versionId).toBe(value.leagueResult.versionId);
    expect(next.calculationInput?.id).not.toBe(value.leagueResult.calculationInput!.id);
    expect(await ownerQuery('SELECT source_mapping_revision_id FROM league_calculation_source_captures WHERE id=$1', [value.capture.id]))
      .toEqual([{ source_mapping_revision_id: value.f.mapping.revisionId }]);
  });

  it('rejects a reservation belonging to another league without mutating either source', async () => {
    const first = await seed(); const second = await fixture(); const before = await counts(second);
    await expect(write(second, await document(second), first.capture)).rejects.toThrow(/scope mismatch/);
    expect(await counts(second)).toEqual(before);
  });

  it.each([true, false])('reads original and later verification inputs separately after unchanged publication (original linked: %s)', async originalLinked => {
    const original = await seed(); const projection = createProjectionStore(connection.database);
    const lineupFence = await publicationFence(original.f); const externalGameId = `capture-game-${randomUUID()}`;
    await projection.upsertNflGames([{ key: externalGameId, provider: 'tank01', externalGameId,
      season: 2162, seasonType: 'reg', week: 3, homeTeam: 'IND', awayTeam: 'HOU', kickoffAt: '2162-09-26T17:00:00.000Z' }]);
    const leagueRef = externalLeagueRef('sleeper', original.f.externalLeagueId);
    const lineup = translateSleeperLineupObservation(leagueRef, { season: 2162, seasonType: 'regular', week: 3 }, {
      expectedRosterCount: 2, expectedStarterSlotCount: 1, expectedRosterRefs: ['1', '2'].map(id => externalRosterRef(leagueRef, id)),
    }, matchups);
    if (lineup.status !== 'complete') throw new Error('Invalid synthetic lineup.');
    const revision = await calculateLineupRevision(lineup.observation);
    const save = async (value: Seed, linked: boolean) => {
      const at = value.matchup.envelope.provenance.requestCompletedAt!;
      const observation = await official(value, linked ? { administration: value.administration } : {}, {
        expectedTank01GameIds: [externalGameId], lineupRevisionVersion: revision.revisionVersion, lineupRevision: revision.lineupRevision,
      });
      const games = await projection.recordGameStates({ provider: 'tank01', states: [{ externalGameId, sourceRevision: randomUUID(),
        requestStartedAt: at, requestCompletedAt: at, observedAt: at, statusCode: 0, period: null,
        gameClock: null, homeScore: null, awayScore: null, sourceData: {} }] });
      if (observation.kind !== 'stored' || games.kind !== 'stored' || games.value.length !== 1) throw new Error('Missing synthetic source.');
      // The existing store suite's minimal complete payload isolates source-history
      // selection from analytics composition; no score/lineup readiness is claimed.
      const published = await projection.publishSnapshot({ lineupFence, leagueSeasonId: value.f.leagueSeasonId, week: 3,
        modelVersion: 'clock-v1', revisionKey: randomUUID(), leagueWeekObservationId: observation.value.observationId,
        gameStateObservationIds: [games.value[0].observationId], calculatedAt: at,
        payload: { league: { season: '2162', rosterPositions: ['QB'], week: 3, maxWeek: 18 }, teams: [],
          updatedAt: at, week: 3, matchups: [] }, activityWindows: [] });
      return { observationId: observation.value.observationId, gameId: games.value[0].observationId, published };
    };
    const first = await save(original, originalLinked);
    expect(first.published.kind).toBe('published');
    if (first.published.kind !== 'published') throw new Error('Original snapshot not published.');
    const verification = await seed(original.f); const second = await save(verification, true);
    expect(second.published.kind).toBe('unchanged');
    if (second.published.kind !== 'unchanged') throw new Error('Verification did not reuse immutable snapshot.');
    expect(second.published.snapshot.snapshotId).toBe(first.published.snapshot.snapshotId);
    expect(second.observationId).not.toBe(first.observationId); expect(second.gameId).not.toBe(first.gameId);
    const reader = createProjectionSourceHistoryReader(connection.database);
    const request = { snapshotId: first.published.snapshot.snapshotId, leagueSeasonId: original.f.leagueSeasonId,
      season: 2162, week: 3, modelVersion: 'clock-v1' };
    const history = await reader.readSnapshotSourceHistory(request);
    expect(history).toMatchObject({ status: 'available', purpose: 'calculation-input-source-history', analyticsCompatibility: 'not_evaluated',
      original: { leagueWeekObservationId: first.observationId, gameStateObservationIds: [first.gameId],
        source: originalLinked ? { status: 'linked', captureId: original.capture.id }
          : { status: 'source_epoch_unproved', reason: 'legacy_unlinked' } },
      verification: { status: 'current_snapshot', leagueWeekObservationId: second.observationId,
        source: { status: 'linked', captureId: verification.capture.id } } });
    expect(await reader.readSnapshotSourceHistory({ ...request, season: 2161 })).toEqual({ status: 'missing' });
    expect(await reader.readSnapshotSourceHistory({ ...request, week: 4 })).toEqual({ status: 'missing' });
    expect(await reader.readSnapshotSourceHistory({ ...request, modelVersion: 'different-model' })).toEqual({ status: 'missing' });
    if (originalLinked && history.status === 'available' && history.original.source.status === 'linked'
      && history.verification.source?.status === 'linked') {
      expect(history.original.source.leagueInput.provenance).toEqual(original.league.envelope.provenance);
      expect(history.verification.source.leagueInput.provenance).toEqual(verification.league.envelope.provenance);
      expect(history.verification.source.leagueInput.legacyObservationProvenance)
        .toEqual(history.original.source.leagueInput.legacyObservationProvenance);
    }
  });

  it('keeps tables immutable and runtime writers narrow before and after repeated role provisioning', async () => {
    const value = await seed();
    for (const table of ['league_calculation_source_captures', 'league_calculation_capture_inputs']) {
      await expect(runtimeQuery(`INSERT INTO ${table} SELECT * FROM ${table} LIMIT 1`)).rejects.toThrow(/permission denied/);
      await expect(runtimeQuery(`DELETE FROM ${table}`)).rejects.toThrow(/permission denied/);
      await expect(runtimeQuery(`UPDATE ${table} SET id=id`)).rejects.toThrow(/permission denied/);
      await expect(ownerQuery(`UPDATE ${table} SET id=id`)).rejects.toThrow(/immutable/);
      await expect(ownerQuery(`DELETE FROM ${table}`)).rejects.toThrow(/immutable/);
    }
    const rights = () => ownerQuery(`SELECT
      has_function_privilege('league_one_runtime','public.begin_league_calculation_source_capture(jsonb,integer,uuid)','EXECUTE') AS reserve,
      has_function_privilege('league_one_runtime','public.record_league_administration_observation_v31(jsonb)','EXECUTE') AS bypass,
      has_function_privilege('league_one_runtime','public.validate_calculation_source_lineage()','EXECUTE') AS validator,
      has_table_privilege('league_one_runtime','public.league_calculation_source_captures','SELECT') AS readable,
      has_table_privilege('league_one_runtime','public.league_calculation_capture_inputs','INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') AS writable`);
    const expected = [{ reserve: true, bypass: false, validator: false, readable: true, writable: false }];
    expect(await rights()).toEqual(expected);
    await ownerQuery(await readFile(new URL('../scripts/provision-runtime-role.sql', import.meta.url), 'utf8'));
    expect(await rights()).toEqual(expected);
    expect(await ownerQuery('SELECT id FROM league_calculation_capture_inputs WHERE capture_id=$1', [value.capture.id])).toHaveLength(2);
  });
});
