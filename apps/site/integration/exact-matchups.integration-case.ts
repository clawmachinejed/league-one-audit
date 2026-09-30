import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { normalizeAdministrationObservation } from '../lib/league-administration/normalize';
import type { AdministrationFamily, JsonValue, NormalizedAdministrationObservation } from '../lib/league-administration/contracts';
import { createLeagueAdministrationMethods } from '../lib/league-administration/neon/administration';
import type { AdministrationWriteFence } from '../lib/league-administration/store-contracts';
import { createProjectionStore } from '../lib/projection-store';
import type { RosterAttempt, RosterPopulationEvidence } from '../lib/aggregator/current-roster';
import { exactMatchupsScope } from '../lib/aggregator/exact-matchups';
import { exactMatchupClockInstant } from './exact-matchup-clock';
import captureSchedule from '../test-support/fixtures/sleeper-2026-season-schedule.json';
import { createSleeperCalendarEvidence } from '../lib/league-administration/period-mapping';
import { createIndependentDatabase, createPinnedIntegrationDatabase, ownerQuery, runtimeQuery,
  type IndependentDatabase } from './neon-integration-harness';

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
    // The wait keeps a millisecond-resolution fixture clock after a preceding reservation.
    const [clock] = await ownerQuery('SELECT clock_timestamp() AS at FROM pg_sleep(0.005)');
    const at = exactMatchupClockInstant(clock.at);
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
  const reserve = (f: Fixture, week: number, fence?: AdministrationWriteFence) =>
    store.beginExactMatchupAttempt(f.mapping, week, randomUUID(), fence);
  const write = (f: Fixture, input: NormalizedAdministrationObservation, attempt: RosterAttempt,
    proof?: RosterPopulationEvidence, fence?: AdministrationWriteFence) => store.recordObservation(input, fence, f.mapping,
    undefined, undefined, undefined, { attempt, ...(proof ? { population: proof } : {}) });
  async function matchupCounts(f: Fixture) {
    const [row] = await ownerQuery<{ contents: number; observations: number }>(`SELECT
      (SELECT count(*)::integer FROM league_administration_contents WHERE league_season_id=$1 AND family='matchups') AS contents,
      (SELECT count(*)::integer FROM league_administration_observations WHERE league_season_id=$1 AND family='matchups') AS observations`,
    [f.leagueSeasonId]);
    return row;
  }
  async function workerFence(seconds = 300): Promise<AdministrationWriteFence> {
    const jobKey = `exact-matchup-fence:${randomUUID()}`; const workerId = randomUUID();
    await ownerQuery(`INSERT INTO projection_jobs(job_key,job_type,scheduled_for,state,lease_owner,lease_until,attempt_count)
      VALUES($1,'league-administration',clock_timestamp(),'running',$2,clock_timestamp()+interval '5 minutes',1)`, [jobKey, workerId]);
    const [clock] = await ownerQuery("SELECT clock_timestamp()+($1::integer * interval '1 second') AS at", [seconds]);
    return { jobKey, workerId, generation: 1, deadlineAt: exactMatchupClockInstant(clock.at) };
  }
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
      bench: null, nonstarters: { state: 'known', players: [{ playerExternalId: 'b', officialPoints: '-1' }] } });
    expect(current.lineupApplicability).toEqual({ status: 'unavailable', reason: 'period_mapping_unproved' });
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
    const correctedRead = await store.readAcceptedExactMatchups(f.mapping, week);
    expect(correctedRead.status).toBe('available');
    if (correctedRead.status !== 'available') throw new Error('Missing corrected matchup resource.');
    expect(correctedRead.value.teams).toHaveLength(2);
    expect(correctedRead.value.teams.find(team => team.externalRosterId === '1'))
      .toMatchObject({ officialTeamPoints: { effective: '-2' } });
  });

  it('preserves the prior head for missing population, partial capture, stale attempt and failed newest attempt', async () => {
    const { f, current, week } = await seed();
    const legacyHead = await ownerQuery('SELECT accepted_observation_id FROM league_administration_heads WHERE league_season_id=$1 AND family=\'matchups\' AND week=$2',
      [f.leagueSeasonId, week]);
    async function assertPartialPreserved(input: NormalizedAdministrationObservation, attempt: RosterAttempt,
      proof: RosterPopulationEvidence) {
      const result = await write(f, input, attempt, proof);
      expect(result.matchupAcceptance).toMatchObject({ status: 'preserved', reason: 'complete_matchup_population_unproved' });
      const receiptId = result.matchupAcceptance?.receiptId;
      if (!receiptId || !result.observationId) throw new Error('Missing partial capture lineage.');
      expect(await ownerQuery(`SELECT content.accepted,content.completeness,content.content_hash,
        receipt.legacy_observation_id,observation.content_id=receipt.content_id AS observation_matches_content
        FROM league_roster_capture_receipts receipt
        JOIN league_administration_contents content ON content.id=receipt.content_id
        JOIN league_administration_observations observation ON observation.id=receipt.legacy_observation_id
        WHERE receipt.id=$1`, [receiptId])).toEqual([{ accepted: false, completeness: 'partial',
        content_hash: input.contentHash, legacy_observation_id: result.observationId, observation_matches_content: true }]);
      expect(await ownerQuery('SELECT accepted_observation_id FROM league_administration_heads WHERE league_season_id=$1 AND family=\'matchups\' AND week=$2',
        [f.leagueSeasonId, week])).toEqual(legacyHead);
      expect(await store.readAcceptedExactMatchups(f.mapping, week)).toEqual(current);
    }
    const missing = await reserve(f, week); const input = await capture(f, 'matchups', ordinary, week);
    expect((await write(f, input, missing)).matchupAcceptance?.status).toBe('preserved');
    const partial = await reserve(f, week); const proof = await population(f);
    const partialInput = await capture(f, 'matchups', ordinary.slice(0, 1), week, 'partial');
    await assertPartialPreserved(partialInput, partial, proof);
    const fullCountPartial = await reserve(f, week); const fullProof = await population(f);
    await assertPartialPreserved(await capture(f, 'matchups', ordinary, week, 'partial'), fullCountPartial, fullProof);
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

  it.each(['older-first', 'newer-first'] as const)('keeps the newest reserved capture under overlapping %s completion', async order => {
    const { f, week } = await seed();
    const older = await reserve(f, week);
    const peer = createIndependentDatabase();
    try {
      const peerStore = createLeagueAdministrationMethods(peer.database);
      const newer = await peerStore.beginExactMatchupAttempt(f.mapping, week, randomUUID());
      const proof = await population(f);
      const olderInput = await capture(f, 'matchups', [{ ...ordinary[0], custom_points: -1 }, ordinary[1]], week);
      const newerInput = await capture(f, 'matchups', [{ ...ordinary[0], custom_points: 2 }, ordinary[1]], week);
      const finishOlder = () => write(f, olderInput, older, proof);
      const finishNewer = () => peerStore.recordObservation(newerInput, undefined, f.mapping,
        undefined, undefined, undefined, { attempt: newer, population: proof });
      const first = await (order === 'older-first' ? finishOlder() : finishNewer());
      const second = await (order === 'older-first' ? finishNewer() : finishOlder());
      const olderResult = order === 'older-first' ? first : second;
      const newerResult = order === 'older-first' ? second : first;
      expect(olderResult.matchupAcceptance).toMatchObject({ status: 'preserved', reason: 'newer_network_attempt_reserved' });
      expect(newerResult.matchupAcceptance).toMatchObject({ status: 'accepted', reason: null });
      const acceptedRead = await store.readAcceptedExactMatchups(f.mapping, week);
      expect(acceptedRead.status).toBe('available');
      if (acceptedRead.status !== 'available') throw new Error('Missing latest matchup resource.');
      expect(acceptedRead.receipt.attemptId).toBe(newer.id);
      expect(acceptedRead.value.teams).toHaveLength(2);
      expect(acceptedRead.value.teams.find(team => team.externalRosterId === '1'))
        .toMatchObject({ officialTeamPoints: { effective: '2' } });
    } finally { await peer.close(); }
  });

  it('rejects wrong league, season and pre-reservation population without moving the accepted head', async () => {
    const { f, current, week } = await seed();
    const wrongLeague = await fixture(); const wrongSeason = await fixture(2161);
    const attempt = await reserve(f, week);
    const input = await capture(f, 'matchups', ordinary, week);
    for (const proof of [await population(wrongLeague), await population(wrongSeason)]) {
      await expect(write(f, input, attempt, proof)).rejects.toThrow(/population evidence mismatch/);
    }
    const oldProof = await population(f);
    const later = await reserve(f, week);
    await expect(write(f, await capture(f, 'matchups', ordinary, week), later, oldProof))
      .rejects.toThrow(/population evidence mismatch/);
    expect(await store.readAcceptedExactMatchups(f.mapping, week)).toEqual(current);
  });

  it('binds the exact writer fence and rolls back expired writes including legacy history', async () => {
    const { f, current, week } = await seed(); const fence = await workerFence();
    for (const invalid of [{ ...fence, generation: 2 }, { ...fence, workerId: randomUUID() },
      { ...fence, deadlineAt: '2020-01-01T00:00:00.000Z' }]) {
      await expect(reserve(f, week, invalid)).rejects.toThrow(/writer fence/);
    }
    const attempt = await reserve(f, week, fence); const proof = await population(f);
    const input = await capture(f, 'matchups', [{ ...ordinary[0], custom_points: 6 }, ordinary[1]], week);
    const before = await matchupCounts(f);
    await expect(write(f, input, attempt, proof)).rejects.toThrow(/attempt scope mismatch/);
    await expect(write(f, input, attempt, proof, { ...fence, workerId: randomUUID() }))
      .rejects.toThrow(/league administration writer fence is stale/);
    await expect(write(f, input, attempt, proof, { ...fence,
      deadlineAt: new Date(new Date(fence.deadlineAt).getTime() + 1000).toISOString() }))
      .rejects.toThrow(/attempt scope mismatch/);
    await ownerQuery("UPDATE projection_jobs SET lease_until=clock_timestamp()-interval '1 second' WHERE job_key=$1", [fence.jobKey]);
    await expect(write(f, input, attempt, proof, fence)).rejects.toThrow(/writer fence/);
    expect(await matchupCounts(f)).toEqual(before);
    expect(await store.readAcceptedExactMatchups(f.mapping, week)).toEqual(current);
  });

  it.each(['source', 'head'] as const)('rejects a reservation whose fence expires while blocked on the %s lock', async lock => {
    const { f, current, week, attempt } = await seed();
    const owner = await createPinnedIntegrationDatabase('owner');
    const writer = await createPinnedIntegrationDatabase('runtime');
    let completion: Promise<{ error?: unknown }> | undefined;
    try {
      const [ownerPid] = await owner.database.query('SELECT pg_backend_pid() AS pid');
      const [writerPid] = await writer.database.query('SELECT pg_backend_pid() AS pid');
      const fence = await workerFence(8);
      await owner.database.query('BEGIN');
      if (lock === 'source') await owner.database.query(
        "SELECT pg_advisory_xact_lock(hashtextextended('league-configuration:'||$1::text,0))", [f.leagueSeasonId]);
      else await owner.database.query('SELECT scope_id FROM league_roster_resource_heads WHERE scope_id=$1 FOR UPDATE', [attempt.scopeId]);
      const rejectedId = randomUUID();
      completion = createLeagueAdministrationMethods(writer.database)
        .beginExactMatchupAttempt(f.mapping, week, rejectedId, fence)
        .then(() => ({}), error => ({ error }));
      let blocked = false;
      for (let poll = 0; poll < 50; poll++) {
        const [row] = await owner.database.query<{ blocked: boolean }>(
          'SELECT $1::integer=ANY(pg_blocking_pids($2::integer)) AS blocked', [ownerPid.pid, writerPid.pid]);
        if (row.blocked) { blocked = true; break; }
        await new Promise(resolve => setTimeout(resolve, 20));
      }
      expect(blocked).toBe(true);
      await owner.database.query(`SELECT pg_sleep(GREATEST(0,EXTRACT(EPOCH FROM ($1::timestamptz-clock_timestamp())))+0.025)`,
        [fence.deadlineAt]);
      await owner.database.query('COMMIT');
      expect(String((await completion).error)).toMatch(/reservation writer fence expired/);
      expect(await ownerQuery('SELECT id FROM league_roster_resource_attempts WHERE id=$1', [rejectedId])).toEqual([]);
      expect(await store.readAcceptedExactMatchups(f.mapping, week)).toEqual(current);
    } finally {
      await owner.database.query('ROLLBACK').catch(() => undefined);
      await completion;
      await writer.close(); await owner.close();
    }
  });

  it('rolls back a capture blocked past its fence deadline, leaving v1 and shadow unchanged', async () => {
    const { f, current, week } = await seed();
    const owner = await createPinnedIntegrationDatabase('owner');
    const writer = await createPinnedIntegrationDatabase('runtime');
    let completion: Promise<{ error?: unknown }> | undefined;
    try {
      const [ownerPid] = await owner.database.query('SELECT pg_backend_pid() AS pid');
      const [writerPid] = await writer.database.query('SELECT pg_backend_pid() AS pid');
      const fence = await workerFence(8);
      const attempt = await reserve(f, week, fence); const proof = await population(f);
      const input = await capture(f, 'matchups', [{ ...ordinary[0], custom_points: 7 }, ordinary[1]], week);
      const before = await matchupCounts(f);
      await owner.database.query('BEGIN');
      await owner.database.query('SELECT scope_id FROM league_roster_resource_heads WHERE scope_id=$1 FOR UPDATE', [attempt.scopeId]);
      completion = createLeagueAdministrationMethods(writer.database)
        .recordObservation(input, fence, f.mapping, undefined, undefined, undefined, { attempt, population: proof })
        .then(() => ({}), error => ({ error }));
      let blocked = false;
      for (let poll = 0; poll < 50; poll++) {
        const [row] = await owner.database.query<{ blocked: boolean }>(
          'SELECT $1::integer=ANY(pg_blocking_pids($2::integer)) AS blocked', [ownerPid.pid, writerPid.pid]);
        if (row.blocked) { blocked = true; break; }
        await new Promise(resolve => setTimeout(resolve, 20));
      }
      expect(blocked).toBe(true);
      await owner.database.query(`SELECT pg_sleep(GREATEST(0,EXTRACT(EPOCH FROM ($1::timestamptz-clock_timestamp())))+0.025)`,
        [fence.deadlineAt]);
      await owner.database.query('COMMIT');
      expect(String((await completion).error)).toMatch(/writer fence.*(?:stale|expired)/);
      expect(await matchupCounts(f)).toEqual(before);
      expect(await store.readAcceptedExactMatchups(f.mapping, week)).toEqual(current);
    } finally {
      await owner.database.query('ROLLBACK').catch(() => undefined);
      await completion;
      await writer.close(); await owner.close();
    }
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

  it('leaves the accepted shadow fixed when an old v1 caller writes changed matchup content', async () => {
    const { f, current, week } = await seed();
    const changed = await capture(f, 'matchups', [{ ...ordinary[0], custom_points: 27 }, ordinary[1]], week);
    expect((await store.recordObservation(changed)).status).toMatch(/changed|unchanged/);
    expect(await store.readAcceptedExactMatchups(f.mapping, week)).toEqual(current);
    const [legacy] = await ownerQuery<{ content_hash: string }>(`SELECT content.content_hash FROM league_administration_heads head
      JOIN league_administration_observations observation ON observation.id=head.accepted_observation_id
      JOIN league_administration_contents content ON content.id=observation.content_id
      WHERE head.league_season_id=$1 AND head.family='matchups' AND head.week=$2`, [f.leagueSeasonId, week]);
    expect(legacy.content_hash).toBe(changed.contentHash);
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
    expect(read.value.teams[0].nonstarters).toEqual({ state: 'known', players: [{ playerExternalId: 'b', officialPoints: '-1' }] });
  });

  async function exactConfiguration(f: Fixture, positions: readonly string[], leg = 18, status = 'complete') {
    const input = await capture(f, 'league', { league_id: f.externalLeagueId, season: String(f.season),
      sport: 'nfl', season_type: 'regular', total_rosters: 2, scoring_settings: rules,
      roster_positions: positions, settings: { leg }, status }, null);
    const at = input.envelope.provenance.checkedAt;
    const calendar = createSleeperCalendarEvidence({ season: String(f.season), seasonSchedule: captureSchedule.body,
      evaluatedAt: at, retrievalStartedAt: at, retrievalCompletedAt: at });
    if (!calendar) throw new Error('Invalid exact applicability calendar fixture.');
    const result = await store.recordObservation(input, undefined, f.mapping, undefined, undefined, undefined, undefined, calendar);
    if (!result.observationId || !result.versionId) throw new Error('Missing existing configuration writer result.');
    return { input, result, proof: { observationId: result.observationId, contentHash: input.contentHash, envelope: input.envelope } };
  }

  async function activate(f: Fixture, versionId: string, week: number, seasonType = 'regular') {
    const [state] = await ownerQuery<{ generation: number }>(`SELECT COALESCE(max(generation),0)::integer AS generation
      FROM league_configuration_activations WHERE league_season_id=$1 AND component='roster'`, [f.leagueSeasonId]);
    const [activation] = await ownerQuery<{ id: string }>(`SELECT activate_league_configuration_component(
      $1::uuid,'roster',$2::text,$3::smallint,$3::smallint,'synthetic explicitly evidenced slots',$4::bigint) AS id`,
    [versionId, seasonType, week, state.generation]);
    return activation.id;
  }

  it.each([1, 4, 18])('reads the existing writer and explicit activation for exact Week %i without current-leg inference', async week => {
    const f = await fixture(2026);
    const attempt = await reserve(f, week);
    const configuration = await exactConfiguration(f, ['QB', 'RB', 'BN']);
    const input = await capture(f, 'matchups', ordinary, week);
    expect((await write(f, input, attempt, configuration.proof)).matchupAcceptance?.status).toBe('accepted');
    const before = await store.readAcceptedExactMatchups(f.mapping, week);
    if (before.status !== 'available') throw new Error('Missing unqualified official fixture.');
    expect(before.lineupApplicability).toEqual({ status: 'unavailable', reason: 'no_binding' });
    expect(before.value.teams[0].bench).toBeNull();
    const activationId = await activate(f, configuration.result.versionId!, week);
    const after = await store.readAcceptedExactMatchups(f.mapping, week);
    if (after.status !== 'available') throw new Error('Missing qualified official fixture.');
    expect(after.lineupApplicability).toMatchObject({ status: 'available', activationRef: activationId,
      configurationVersionId: configuration.result.versionId, sourceMappingRevisionId: f.mapping.revisionId,
      period: { season: 2026, seasonType: 'regular', week }, startingSlots: ['QB', 'RB'] });
    expect(after.value.teams[0]).toMatchObject({ starters: [{ nativeSlot: 'QB', officialPoints: '8.25' },
      { nativeSlot: 'RB', empty: true }], bench: [{ playerExternalId: 'b', officialPoints: '-1' }],
      reserveAndTaxi: { state: 'unknown' } });
    // Roster 2's one-slot array cannot prove a complete two-slot lineup/bench.
    expect(after.value.teams[1].bench).toBeNull();
    expect(after.value.teams[1].starters?.[0].nativeSlot).toBeNull();
    expect(after.receipt).toEqual(before.receipt);
    expect(after.accepted).toEqual(before.accepted);
    expect(await ownerQuery('SELECT payload,normalized_value FROM league_administration_contents WHERE id=$1', [after.accepted.contentId]))
      .toEqual([{ payload: ordinary, normalized_value: input.value }]);
  });

  it('keeps exact slot corrections generation-scoped and waits for configuration mapping evidence', async () => {
    const f = await fixture(2026); const week = 3;
    const firstAttempt = await reserve(f, week);
    const first = await exactConfiguration(f, ['QB', 'RB', 'BN']);
    await write(f, await capture(f, 'matchups', ordinary, week), firstAttempt, first.proof);
    const oldActivation = await activate(f, first.result.versionId!, week);
    const before = await store.readAcceptedExactMatchups(f.mapping, week);
    expect(before).toMatchObject({ status: 'available', lineupApplicability: { status: 'available', activationRef: oldActivation } });
    const nextAttempt = await reserve(f, week);
    const correction = await exactConfiguration(f, ['QB', 'SUPER_FLEX', 'BN']);
    const newActivation = await activate(f, correction.result.versionId!, week);
    const unbound = await store.readAcceptedExactMatchups(f.mapping, week);
    if (unbound.status !== 'available') throw new Error('Missing official values during optional mapping gap.');
    expect(unbound.lineupApplicability).toEqual({ status: 'unavailable', reason: 'invalid_applicability_evidence' });
    expect(unbound.value.teams[0].officialTeamPoints.effective).toBe('0');
    expect((await write(f, await capture(f, 'matchups', ordinary, week), nextAttempt, correction.proof)).matchupAcceptance?.status).toBe('accepted');
    const after = await store.readAcceptedExactMatchups(f.mapping, week);
    expect(after).toMatchObject({ status: 'available', lineupApplicability: { status: 'available', activationRef: newActivation,
      startingSlots: ['QB', 'SUPER_FLEX'] } });
    expect(await ownerQuery('SELECT id FROM league_configuration_activations WHERE id=$1', [oldActivation])).toEqual([{ id: oldActivation }]);
  });

  it('does not apply a different season type or week and never grants runtime configuration activation', async () => {
    const f = await fixture(2026); const week = 4; const attempt = await reserve(f, week);
    const configuration = await exactConfiguration(f, ['QB', 'RB', 'BN'], week, 'in_season');
    await write(f, await capture(f, 'matchups', ordinary, week), attempt, configuration.proof);
    await activate(f, configuration.result.versionId!, week, 'post');
    await activate(f, configuration.result.versionId!, week - 1);
    const current = await store.readAcceptedExactMatchups(f.mapping, week);
    expect(current).toMatchObject({ status: 'available', lineupApplicability: { status: 'unavailable', reason: 'no_binding' } });
    await expect(runtimeQuery(`SELECT activate_league_configuration_component(
      $1::uuid,'roster','regular',4::smallint,4::smallint,'unprivileged fixture',3::bigint)`, [configuration.result.versionId]))
      .rejects.toThrow(/permission denied/);
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
