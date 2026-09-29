import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { normalizeAdministrationObservation } from '../lib/league-administration/normalize';
import type { AdministrationFamily, JsonValue, NormalizedAdministrationObservation } from '../lib/league-administration/contracts';
import { createLeagueAdministrationMethods } from '../lib/league-administration/neon/administration';
import { createProjectionStore } from '../lib/projection-store';
import type { RosterAttempt, RosterPopulationEvidence } from '../lib/aggregator/current-roster';
import { exactMatchupsScope } from '../lib/aggregator/exact-matchups';
import { createIndependentDatabase, ownerQuery, runtimeQuery, type IndependentDatabase } from './neon-integration-harness';

const rules = { rec: 0.5 };
const ordinary = [
  { roster_id: 1, matchup_id: 4, players: ['a', 'b'], starters: ['a', '0'],
    starters_points: [8.25, null], players_points: { a: 9.5, b: -1 }, points: 8.25, custom_points: 0 },
  { roster_id: 2, matchup_id: 4, players: ['c'], starters: ['c'],
    starters_points: [4], players_points: { c: 4 }, points: 4 },
];
type Payload = unknown;

describe.sequential('exact native-period matchup shadow acceptance', () => {
  let connection: IndependentDatabase;
  let store: ReturnType<typeof createLeagueAdministrationMethods>;
  beforeAll(() => { connection = createIndependentDatabase(); store = createLeagueAdministrationMethods(connection.database); });
  afterAll(async () => connection.close());
  async function fixture(season = 2160) {
    const leagueKey = `exact-matchups-${randomUUID()}`;
    const externalLeagueId = `matchup-source-${randomUUID()}`;
    const registered = await createProjectionStore(connection.database).registerLeagueSeason({
      leagueKey, leagueName: 'Synthetic exact matchup', season, sleeperLeagueId: externalLeagueId, scoringRules: rules,
    });
    if (registered.kind !== 'stored') throw new Error('Isolated fixture registration failed.');
    await ownerQuery("INSERT INTO league_administration_enrollments(league_id,provider,evidence) VALUES($1,'sleeper','synthetic fixture')", [registered.value.leagueId]);
    await ownerQuery("INSERT INTO league_administration_enrollment_seasons(league_id,season,provider,evidence) VALUES($1,$2,'sleeper','synthetic fixture')", [registered.value.leagueId, season]);
    const mapping = await store.readSourceMapping(externalLeagueId);
    if (!mapping) throw new Error('Missing fixture mapping.');
    return { ...registered.value, mapping, leagueKey, externalLeagueId, season };
  }
  type Fixture = Awaited<ReturnType<typeof fixture>>;
  async function capture(f: Fixture, family: AdministrationFamily, payload: Payload, week: number | null,
    completeness: 'complete' | 'partial' = 'complete', origin: 'network' | 'cache' = 'network') {
    const [clock] = await ownerQuery('SELECT clock_timestamp() AS at');
    const at = new Date(String(clock.at)).toISOString();
    return normalizeAdministrationObservation({ schemaVersion: 'league-administration-v1',
      normalizerVersion: 'sleeper-administration-v1', dialect: 'sleeper-nfl-v1',
      scope: f.mapping.scope, family, week, completeness, payload: payload as JsonValue,
      provenance: { origin, requestStartedAt: at, requestCompletedAt: at,
        sourceObservedAt: origin === 'network' ? at : null, checkedAt: at } });
  }
  async function population(f: Fixture, week = 3, status = 'in_season'): Promise<RosterPopulationEvidence> {
    const input = await capture(f, 'league', { league_id: f.externalLeagueId, season: String(f.season),
      sport: 'nfl', total_rosters: 2, scoring_settings: rules, roster_positions: ['QB', 'RB', 'BN'],
      settings: { leg: week }, status }, null);
    const result = await store.recordObservation(input);
    if (!result.observationId) throw new Error('Missing population observation.');
    return { observationId: result.observationId, contentHash: input.contentHash, envelope: input.envelope };
  }
  const reserve = (f: Fixture, week: number) => store.beginExactMatchupAttempt(f.mapping, week, randomUUID());
  const write = (f: Fixture, input: NormalizedAdministrationObservation, attempt: RosterAttempt,
    proof?: RosterPopulationEvidence) => store.recordObservation(input, undefined, f.mapping,
    undefined, undefined, undefined, { attempt, ...(proof ? { population: proof } : {}) });
  async function seed(week = 3) {
    const f = await fixture(); const attempt = await reserve(f, week); const proof = await population(f);
    const input = await capture(f, 'matchups', ordinary, week);
    const result = await write(f, input, attempt, proof);
    expect(result.matchupAcceptance).toMatchObject({ status: 'accepted', reason: null });
    const current = await store.readAcceptedExactMatchups(f.mapping, week);
    expect(current.status).toBe('available');
    if (current.status !== 'available') throw new Error('Missing exact matchup resource.');
    return { f, attempt, proof, input, result, current, week };
  }

  it('binds official zero, player points and participants to immutable native period and season-team IDs', async () => {
    const { f, input, result, current } = await seed();
    expect(current.accepted).toMatchObject({ scope: exactMatchupsScope(f.mapping, 3),
      sourceMappingRevisionId: f.mapping.revisionId, acceptedGeneration: 1 });
    expect(current.receipt).toMatchObject({ legacyObservationId: result.observationId,
      rawContentHash: input.contentHash, expectedTeamCount: 2, provenance: input.envelope.provenance });
    expect(current.value.teams[0]).toMatchObject({ officialTeamPoints: { raw: '8.25', custom: '0', effective: '0' },
      starters: [{ officialPoints: '8.25' }, { empty: true, officialPoints: null }],
      bench: [{ playerExternalId: 'b', officialPoints: '-1' }] });
    expect(current.value.groups).toEqual([expect.objectContaining({ format: 'paired', participantTeamIds: expect.arrayContaining([
      current.value.teams[0].seasonTeamId, current.value.teams[1].seasonTeamId,
    ]) })]);
    expect(await ownerQuery('SELECT payload,normalized_value FROM league_administration_contents WHERE id=$1', [current.accepted.contentId]))
      .toEqual([{ payload: ordinary, normalized_value: input.value }]);
  });

  it('separates weeks, accepts corrections, and keeps equal-content receipts with their actual capture time', async () => {
    const { f, current, week } = await seed();
    const fourth = await reserve(f, 4); const fourthProof = await population(f, 4);
    const fourthInput = await capture(f, 'matchups', ordinary, 4);
    expect((await write(f, fourthInput, fourth, fourthProof)).matchupAcceptance?.status).toBe('accepted');
    expect((await store.readAcceptedExactMatchups(f.mapping, 4)).status).toBe('available');
    expect((await store.readAcceptedExactMatchups(f.mapping, week)).status).toBe('available');
    const replayAttempt = await reserve(f, week); const replayProof = await population(f);
    const same = await capture(f, 'matchups', ordinary, week); const replay = await write(f, same, replayAttempt, replayProof);
    expect(replay.matchupAcceptance?.status).toBe('accepted');
    const next = await store.readAcceptedExactMatchups(f.mapping, week);
    if (next.status !== 'available') throw new Error('Missing corrected read.');
    expect(next.accepted.contentId).toBe(current.accepted.contentId);
    expect(next.receipt.id).not.toBe(current.receipt.id);
    expect(next.receipt.provenance).toEqual(same.envelope.provenance);
    expect((await write(f, same, replayAttempt, replayProof)).matchupAcceptance).toMatchObject({
      status: 'accepted', reason: 'exact_receipt_replay', receiptId: next.receipt.id,
    });
    await expect(write(f, await capture(f, 'matchups', [{ ...ordinary[0], points: 1 }, ordinary[1]], week), replayAttempt, replayProof))
      .rejects.toThrow(/receipt conflict/);
    const corrected = await reserve(f, week); const proof = await population(f);
    expect((await write(f, await capture(f, 'matchups', [{ ...ordinary[0], custom_points: -2 }, ordinary[1]], week), corrected, proof))
      .matchupAcceptance?.status).toBe('accepted');
    expect((await store.readAcceptedExactMatchups(f.mapping, week))).toMatchObject({ status: 'available',
      value: { teams: [{ officialTeamPoints: { effective: '-2' } }] } });
  });

  it('preserves the prior head for missing population, partial capture, stale attempt and failed newest attempt', async () => {
    const { f, current, week } = await seed();
    const missing = await reserve(f, week); const input = await capture(f, 'matchups', ordinary, week);
    expect((await write(f, input, missing)).matchupAcceptance?.status).toBe('preserved');
    const partial = await reserve(f, week); const proof = await population(f);
    const partialInput = await capture(f, 'matchups', ordinary.slice(0, 1), week, 'partial');
    expect((await write(f, partialInput, partial, proof)).matchupAcceptance?.status).toBe('preserved');
    const fullCountPartial = await reserve(f, week); const fullProof = await population(f);
    expect((await write(f, await capture(f, 'matchups', ordinary, week, 'partial'), fullCountPartial, fullProof))
      .matchupAcceptance?.status).toBe('preserved');
    const older = await reserve(f, week); const olderProof = await population(f);
    const newer = await reserve(f, week); const newerProof = await population(f);
    const newerInput = await capture(f, 'matchups', ordinary, week);
    expect((await write(f, newerInput, newer, newerProof)).matchupAcceptance?.status).toBe('accepted');
    expect((await write(f, await capture(f, 'matchups', ordinary, week), older, olderProof)).matchupAcceptance)
      .toMatchObject({ status: 'preserved', reason: 'newer_network_attempt_reserved' });
    const next = await store.readAcceptedExactMatchups(f.mapping, week);
    expect(next).toMatchObject({ status: 'available', accepted: { acceptedGeneration: current.accepted.acceptedGeneration + 1 } });
    await reserve(f, week); // Crashed/latest reservation retains last good acceptance.
    expect(await store.readAcceptedExactMatchups(f.mapping, week)).toEqual(next);
  });

  it('fences remap, foreign period and cached evidence while preserving old callers and history', async () => {
    const { f, current, week } = await seed();
    const attempt = await reserve(f, week); const proof = await population(f);
    await expect(write(f, await capture(f, 'matchups', ordinary, week + 1), attempt, proof)).rejects.toThrow(/scope mismatch/);
    await expect(write(f, await capture(f, 'matchups', ordinary, week, 'complete', 'cache'), attempt, proof))
      .rejects.toThrow(/network capture/);
    const other = `matchup-remap-${randomUUID()}`;
    await ownerQuery("SELECT revise_league_source_connection($1,'sleeper',$2,$3,'synthetic remap')",
      [f.leagueSeasonId, f.mapping.revisionId, other]);
    const middle = await store.readSourceMapping(other);
    await ownerQuery("SELECT revise_league_source_connection($1,'sleeper',$2,$3,'synthetic return')",
      [f.leagueSeasonId, middle!.revisionId, f.externalLeagueId]);
    const latest = await store.readSourceMapping(f.externalLeagueId);
    await expect(write(f, await capture(f, 'matchups', ordinary, week), attempt, proof)).rejects.toThrow(/mapping.*(?:stale|mismatch)|source mapping/);
    expect(await store.readAcceptedExactMatchups(latest!, week)).toEqual({ status: 'missing' });
    expect(await ownerQuery('SELECT source_mapping_revision_id FROM league_roster_resource_acceptances WHERE receipt_id=$1', [current.receipt.id]))
      .toEqual([{ source_mapping_revision_id: f.mapping.revisionId }]);
    const newFixture = { ...f, mapping: latest! };
    const fresh = await reserve(newFixture, week); const newProof = await population(newFixture);
    await write(newFixture, await capture(newFixture, 'matchups', ordinary, week), fresh, newProof);
    expect((await store.readAcceptedExactMatchups(latest!, week)).status).toBe('available');
    await store.recordObservation(await capture(newFixture, 'matchups', ordinary, week));
    expect((await store.readAcceptedExactMatchups(latest!, week)).status).toBe('available');
  });

  it('does not infer a historical bench from a completed league retaining the last leg', async () => {
    const { f, week } = await seed();
    const attempt = await reserve(f, week);
    const proof = await population(f, week, 'complete');
    expect((await write(f, await capture(f, 'matchups', ordinary, week), attempt, proof))
      .matchupAcceptance?.status).toBe('accepted');
    const read = await store.readAcceptedExactMatchups(f.mapping, week);
    expect(read.status).toBe('available');
    if (read.status !== 'available') throw new Error('Missing completed-league read.');
    expect(read.value.teams[0].bench).toBeNull();
    expect(read.value.teams[0].starters?.[0].nativeSlot).toBeNull();
  });

  it('keeps shadow history immutable and the renamed writer inaccessible to runtime', async () => {
    const { f, current } = await seed();
    await expect(ownerQuery('UPDATE league_roster_capture_receipts SET provenance=provenance WHERE id=$1', [current.receipt.id]))
      .rejects.toThrow();
    await expect(runtimeQuery('SELECT record_league_administration_observation_v29($1::jsonb)', ['{}']))
      .rejects.toThrow(/permission denied/);
    await expect(runtimeQuery('SELECT begin_exact_matchup_attempt($1::jsonb,$2::uuid,$3::integer,$4::jsonb)',
      ['{}', randomUUID(), 19, null])).rejects.toThrow();
    const attempt = await reserve(f, 3);
    const proof = await population(f);
    const [matchup] = await ownerQuery('SELECT content_id FROM league_administration_observations WHERE id=$1', [current.receipt.legacyObservationId]);
    await expect(ownerQuery(`INSERT INTO league_roster_capture_receipts(attempt_id,content_id,legacy_observation_id,
      evidence_hash,provenance,configuration_content_id,coverage) VALUES($1,$2,$3,'forged',$4::jsonb,$2,'{}'::jsonb)`,
    [attempt.id, matchup.content_id, current.receipt.legacyObservationId, JSON.stringify(proof.envelope.provenance)]))
      .rejects.toThrow(/self configuration requires league resource/);
  });
});
