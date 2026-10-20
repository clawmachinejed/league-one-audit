import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { DatabaseClient, DatabaseQueryOptions, DatabaseRow } from '../lib/database';
import type { JsonValue, NormalizedAdministrationObservation } from '../lib/league-administration/contracts';
import type { AdministrationSourceMapping } from '../lib/league-administration/source-mapping';
import type { AdministrationWriteFence } from '../lib/league-administration/store-contracts';
import type { RosterAttempt, RosterPopulationEvidence } from '../lib/aggregator/current-roster';
import type { RosterPlayerLinksRead } from '../lib/aggregator/roster-player-links';
import { projectOfficialStandings, type OfficialStandingsRead } from '../lib/aggregator/official-standings';
import { composeOfficialResults } from '../lib/aggregator/official-results';
import { normalizeAdministrationObservation } from '../lib/league-administration/normalize';
import { createLeagueAdministrationStore, createPublicIntakeStore, createPublicDataRefreshStore } from '../lib/league-administration/store';
import { OFFICIAL_STANDINGS_POPULATION_TIME_SQL } from '../lib/league-administration/neon/official-standings';
import { runPublicIntakeStep, runPublicDataRefreshStep, type PublicIntakeDependencies } from '../lib/league-administration/public-intake';
import { readPublicSleeperIntake } from '../lib/league-administration/public-intake-reader';
import { readPublicDataRefresh } from '../lib/league-administration/public-refresh-reader';
import { readPublicOfficialStandings } from '../lib/league-administration/public-official-results-reader';
import { PUBLIC_INTAKE_JOB, PUBLIC_PLAYOFF_BRACKETS } from '../lib/league-administration/public-intake-contracts';
import { createProjectionStore } from '../lib/projection-store';
import { loadCompletePlayerCatalog } from '../lib/sleeper-player-catalog';
import { exactMatchupClockInstant } from './exact-matchup-clock';
import { createIndependentDatabase, createPinnedIntegrationDatabase, ownerQuery, type IndependentDatabase } from './neon-integration-harness';

const numericId = () => '7' + BigInt('0x' + randomUUID().replaceAll('-', '').slice(0, 15));
const typedTables = ['league_official_standings_contents', 'league_official_standings_teams', 'league_official_standings_captures'] as const;
const leagueDocument = (id: string, count = 2, type = 0) => ({ league_id: id, season: '2026', sport: 'nfl',
  name: 'CP13 synthetic DATA league', total_rosters: count, roster_positions: ['QB', 'BN'],
  scoring_settings: { rec: 0.5 }, settings: { type, playoff_week_start: 15, playoff_teams: 2, playoff_round_type: 2 } });
const sourceRows = (count = 2, corrected = false) => Array.from({ length: count }, (_, index) => ({
  roster_id: index + 1, owner_id: null, co_owners: [], players: ['9001'], starters: ['9001'], reserve: [], taxi: [],
  settings: { wins: index === 0 ? corrected ? 5 : 4 : 0, losses: index === 0 ? 1 : 5, ties: 0,
    fpts: 512, fpts_decimal: corrected ? 35 : 34, fpts_against: 400, fpts_against_decimal: 0, rank: index + 1, seed: index + 1 },
}));
type AvailableStandings = Extract<OfficialStandingsRead, { status: 'available' }>;

/** AUTHORED / HOSTED SQL-UNQUALIFIED CP13. Seven60s cases + one1080s case + two120s
 * hooks =29min authored allowance, not measured fit. Resource cases use synthetic
 * enrollment/fences; ordinary case uses actual public dispatch/admission/witnesses.
 * All provider payloads are synthetic. Documented bracket played semantics are tested; no live-provider finality proof.
 * Existing20s worker,60s admission,30/40/50min work/lifecycle/CI limits stay fixed. */
describe.sequential('official standings and results through restricted PostgreSQL', () => {
  let connection: IndependentDatabase;
  let administration: ReturnType<typeof createLeagueAdministrationStore>;
  const jobsToClose: string[] = [];
  beforeAll(async () => {
    connection = createIndependentDatabase(); administration = createLeagueAdministrationStore(connection.database);
    expect((await connection.database.query(`SELECT current_user,session_user,rolsuper,rolcreaterole,rolcreatedb
      FROM pg_roles WHERE rolname=current_user`))[0]).toEqual({ current_user: 'league_one_runtime',
      session_user: 'league_one_runtime', rolsuper: false, rolcreaterole: false, rolcreatedb: false });
  }, 120_000);
  afterAll(async () => {
    try { try { await restoreB2Writer(); } finally { try { await restoreABWriter(); } finally { await restoreB1Writer(); } } } finally {
      vi.restoreAllMocks();
      try {
      if (jobsToClose.length) await ownerQuery(`UPDATE projection_jobs SET state='failed',lease_owner=NULL,
        lease_until=NULL,completed_at=clock_timestamp() WHERE job_key=ANY($1::text[])`, [jobsToClose]);
      const until = Date.now() + 85_000;
      while (true) {
        const [row] = await connection.database.query(`SELECT
          NOT EXISTS(SELECT 1 FROM public_data_dispatches WHERE admitted_at>clock_timestamp()-interval '60 seconds')
          AND NOT EXISTS(SELECT 1 FROM projection_jobs WHERE job_key=$1
            AND (state='running' OR completed_at>clock_timestamp()-interval '60 seconds')) AS ready`, [PUBLIC_INTAKE_JOB]);
        if (row.ready === true) break;
        if (Date.now() >= until) throw new Error('CP13 shared minute cleanup did not settle.');
        await delay(250);
      }
      } finally { await connection.close(); }
    }
  }, 120_000);
  async function fixture() {
    const external = numericId(), leagueKey = 'cp13-' + randomUUID();
    const registered = await createProjectionStore(connection.database).registerLeagueSeason({ leagueKey,
      leagueName: 'CP13 synthetic standings', season: 2026, sleeperLeagueId: external, scoringRules: { rec: 0.5 } });
    if (registered.kind !== 'stored') throw new Error('CP13 fixture registration unavailable.');
    await ownerQuery("INSERT INTO league_administration_enrollments(league_id,provider,evidence) VALUES($1,'sleeper','CP13 synthetic prerequisite')", [registered.value.leagueId]);
    await ownerQuery("INSERT INTO league_administration_enrollment_seasons(league_id,season,provider,evidence) VALUES($1,2026,'sleeper','CP13 synthetic prerequisite')", [registered.value.leagueId]);
    const mapping = await administration.readSourceMapping(external); if (!mapping) throw new Error('Missing CP13 mapping.');
    return { ...registered.value, external, mapping };
  }
  type Fixture = Awaited<ReturnType<typeof fixture>>;
  async function fence(seconds = 20): Promise<AdministrationWriteFence> {
    const jobKey = 'cp13-fixture-' + randomUUID(), workerId = randomUUID(); jobsToClose.push(jobKey);
    await ownerQuery(`INSERT INTO projection_jobs(job_key,job_type,scheduled_for,state,lease_owner,lease_until,attempt_count)
      VALUES($1,'league-administration',clock_timestamp(),'running',$2,clock_timestamp()+interval '25 seconds',1)`, [jobKey, workerId]);
    const [clock] = await connection.database.query("SELECT clock_timestamp()+$1::integer*interval '1 second' AS at", [seconds]);
    return { jobKey, workerId, generation: 1, deadlineAt: exactMatchupClockInstant(clock.at) };
  }
  async function observation(f: Fixture, payload: JsonValue, family: 'league' | 'rosters' | 'matchups' | 'winners_bracket' | 'losers_bracket' = 'rosters',
    week: number | null = null, completeness: 'complete' | 'partial' = 'complete') {
    const [clock] = await connection.database.query('SELECT clock_timestamp() AS at FROM pg_sleep(0.005)');
    const at = exactMatchupClockInstant(clock.at);
    return normalizeAdministrationObservation({ schemaVersion: 'league-administration-v1', normalizerVersion: 'sleeper-administration-v1',
      dialect: 'sleeper-nfl-v1', scope: f.mapping.scope, family, week, completeness, payload,
      provenance: { origin: 'network', requestStartedAt: at, requestCompletedAt: at,
        sourceObservedAt: completeness === 'complete' ? at : null, checkedAt: at } });
  }
  async function population(f: Fixture, count: number, workFence: AdministrationWriteFence, store = administration, type = 0): Promise<RosterPopulationEvidence> {
    const input = await observation(f, leagueDocument(f.external, count, type), 'league');
    const result = await store.recordObservation(input, workFence);
    if (!result.observationId) throw new Error('CP13 population capture unavailable.');
    return { observationId: result.observationId, contentHash: input.contentHash, envelope: input.envelope };
  }
  function writeInput(f: Fixture, input: NormalizedAdministrationObservation, attempt: RosterAttempt, workFence: AdministrationWriteFence,
    evidence?: RosterPopulationEvidence, typed = true) {
    return { ...input, sourceMapping: f.mapping, writeFence: workFence,
      rosterAcceptance: { attempt, ...(evidence ? { population: evidence } : {}) },
      ...(typed ? { officialStandings: projectOfficialStandings(input) } : {}) };
  }
  async function write(input: unknown, database = connection.database) {
    const rows = await database.query('SELECT public.record_league_administration_observation($1::jsonb) AS result', [JSON.stringify(input)]);
    expect(rows).toHaveLength(1);
    return rows[0].result as { status: string; rosterAcceptance: { receiptId: string; status: string; reason?: string };
      officialStandings?: { status: string; receiptId: string; contentId: string; version: string } };
  }
  async function read(mapping: AdministrationSourceMapping, receipt?: string, store = administration): Promise<AvailableStandings> {
    const value = await store.readOfficialStandings!(mapping, receipt ? { rosterReceiptId: receipt } : {});
    expect(value.status).toBe('available'); if (value.status !== 'available') throw new Error('CP13 standings unavailable.');
    return value;
  }
  async function capture(f: Fixture, payload: JsonValue = sourceRows(), count: number | null = 2, type = 0) {
    const workFence = await fence(), attempt = await administration.beginRosterAttempt(f.mapping, randomUUID(), undefined, workFence);
    const evidence = count === null ? undefined : await population(f, count, workFence, administration, type);
    const input = await observation(f, payload), submitted = writeInput(f, input, attempt, workFence, evidence), result = await write(submitted);
    expect(result.officialStandings?.status).toBe('recorded');
    if (!result.officialStandings) throw new Error('CP13 marker missing.');
    return { workFence, attempt, input, submitted, result, receipt: result.officialStandings.receiptId, contentId: result.officialStandings.contentId };
  }
  async function history(f: Fixture) {
    const typed = typedTables.map(table => `(SELECT jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text)
      FROM public.${table} t JOIN league_administration_contents content ON content.id=t.content_id
      WHERE content.league_season_id=$1) AS ${table}`);
    return connection.database.query(`SELECT
      (SELECT jsonb_agg(to_jsonb(c) ORDER BY c.id) FROM league_administration_contents c WHERE league_season_id=$1) AS contents,
      (SELECT jsonb_agg(to_jsonb(r) ORDER BY r.id) FROM league_roster_capture_receipts r
        JOIN league_roster_resource_attempts a ON a.id=r.attempt_id WHERE a.source_mapping->>'leagueSeasonId'=$1::text) AS receipts,
      (SELECT jsonb_agg(to_jsonb(h) ORDER BY h.scope_id) FROM league_roster_resource_heads h
        JOIN league_roster_resource_scopes s ON s.id=h.scope_id WHERE s.league_season_id=$1) AS heads,
      ${typed.join(',')}`, [f.leagueSeasonId]);
  }
  async function storedOnly<T>(body: (database: DatabaseClient, store: ReturnType<typeof createLeagueAdministrationStore>) => Promise<T>) {
    const statements: string[] = [];
    const database: DatabaseClient = { enabled: true,
      query: async <Row extends DatabaseRow = DatabaseRow>(sql: string, parameters?: readonly unknown[], options?: DatabaseQueryOptions) => {
        statements.push(sql); expect(sql).not.toMatch(/\b(?:INSERT|UPDATE|DELETE|CALL)\b/iu);
        return connection.database.query<Row>(sql, parameters, options);
      } };
    const fetch = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('CP13 stored reads must not fetch.'));
    try { const result = await body(database, createLeagueAdministrationStore(database));
      expect(fetch).not.toHaveBeenCalled(); expect(statements.length).toBeGreaterThan(0); return result;
    } finally { fetch.mockRestore(); }
  }


  async function directoryPrerequisite(playerIds: readonly string[]) {
    // Synthetic mutable cadence prerequisite, as in CP6. All immutable source and
    // acceptance clocks are generated by the maintained runtime/database path.
    await ownerQuery(`UPDATE league_player_directory_heads SET last_network_at=clock_timestamp()-interval '25 hours',
      next_network_at=clock_timestamp()-interval '1 hour' WHERE provider='sleeper' AND sport='nfl'`);
    const jobs = createProjectionStore(connection.database), until = Date.now() + 85_000;
    while (true) {
      const workerId = randomUUID(), started = new Date().toISOString();
      const acquired = await jobs.acquireJob({ jobKey: PUBLIC_INTAKE_JOB, jobType: PUBLIC_INTAKE_JOB, workerId,
        scheduledFor: started, leaseSeconds: 25, payload: { policy: 'public-player-directory-v1', mode: 'player-directory' } });
      if (acquired.kind !== 'acquired') {
        if (Date.now() >= until) throw new Error('CP13 directory prerequisite owner unavailable.');
        await delay(1_000); continue;
      }
      const originalFence = { jobKey: PUBLIC_INTAKE_JOB, workerId, generation: acquired.attempt,
        deadlineAt: new Date(Date.parse(started) + 20_000).toISOString() };
      try {
        const reserved = await administration.beginPlayerDirectoryAttempt(randomUUID(), originalFence);
        if (reserved.status !== 'reserved') {
          if (Date.now() >= until) throw new Error('CP13 directory prerequisite admission unavailable.');
          await delay(1_000); continue;
        }
        const native = Object.fromEntries(playerIds.map(player_id => [player_id, { player_id, position: 'QB', full_name: 'CP13 synthetic player' }]));
        const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(async input => {
          expect(String(input)).toBe('https://api.sleeper.app/v1/players/nfl'); return new Response(JSON.stringify(native));
        });
        try {
          const source = await loadCompletePlayerCatalog({ attempt: reserved.attempt, signal: AbortSignal.timeout(20_000) });
          expect(source.status).toBe('complete'); expect(fetch).toHaveBeenCalledOnce();
          const result = await administration.recordPlayerDirectoryCapture(reserved.attempt, source, originalFence);
          expect(result.status).toBe('accepted'); expect(result.acceptedVersionId).toBeTypeOf('string');
          return result.acceptedVersionId!;
        } finally { fetch.mockRestore(); }
      } finally {
        if (!await jobs.completeJob(PUBLIC_INTAKE_JOB, workerId)) await jobs.failJob(PUBLIC_INTAKE_JOB, workerId, 'CP13 directory prerequisite closure');
      }
    }
  }

  it('stores provider record points and supplied placement through independent typed receipts', async () => {
    for (const type of [0, 1, 2]) {
      const f = await fixture(), payload = sourceRows(type === 2 ? 20 : 2), captured = await capture(f, payload, payload.length, type);
      const value = await read(f.mapping, captured.receipt), projection = projectOfficialStandings(captured.input);
      expect(value.teams.map(({ seasonTeamId, ...team }) => { expect(seasonTeamId).toBeTypeOf('string'); return team; })).toEqual(projection.teams);
      expect(value.capture.provenance).toEqual(captured.input.envelope.provenance);
      expect(value.coverage).toEqual({ population: 'proven', entitySet: 'full', recordCompleteness: 'complete', reasons: [] });
      expect(value.teams[0]).toMatchObject({ record: { wins: { state: 'known', value: 4 }, ties: { state: 'known', value: 0 } },
        pointsFor: { value: '512.34' }, pointsAgainst: { value: '400' }, providerRank: { value: 1 }, providerSeed: { value: 1 } });
      expect(new Set(value.teams.map(team => team.seasonTeamId)).size).toBe(payload.length);
      expect(await connection.database.query('SELECT payload FROM league_administration_contents WHERE id=$1', [captured.contentId])).toEqual([{ payload }]);
      expect(await connection.database.query(`SELECT count(*)::integer AS count FROM league_official_standings_teams t
        JOIN league_season_teams identity ON identity.id=t.season_team_id AND identity.league_season_id=$2
        AND identity.external_roster_id=t.external_roster_id WHERE t.content_id=$1`, [captured.contentId, f.leagueSeasonId]))
        .toEqual([{ count: payload.length }]);
    }
  }, 60_000);

  it('preserves native field states capacity outcomes and missing population without membership inference', async () => {
    const f = await fixture();
    const payload = [{ roster_id: 1, owner_id: { malformed: true }, players: null,
      settings: { wins: 0, losses: null, ties: -1, fpts: 0, fpts_decimal: 0, rank: null } }];
    const partial = await capture(f, payload, null), value = await read(f.mapping, partial.receipt);
    expect(partial.input.status).toBe('rejected');
    expect(value.coverage).toMatchObject({ population: 'unproved', entitySet: 'unknown', recordCompleteness: 'partial' });
    expect(value.teams[0]).toMatchObject({ record: { wins: { state: 'known', value: 0 }, losses: { state: 'null', value: null },
      ties: { state: 'invalid', value: null } }, pointsFor: { value: '0' }, pointsAgainst: { state: 'absent', value: null },
      providerRank: { state: 'null' }, providerSeed: { state: 'absent' } });
    expect(partial.result.rosterAcceptance.status).toBe('preserved');
    const empty = await capture(f, [], null); expect((await read(f.mapping, empty.receipt)).teams).toEqual([]);
    const mismatch = await capture(f, sourceRows(1), 2);
    expect((await read(f.mapping, mismatch.receipt)).coverage).toMatchObject({ population: 'mismatch', entitySet: 'partial' });
    for (const bad of [null, {}, sourceRows(21), [{ roster_id: 1 }, { roster_id: 1 }]] as JsonValue[]) {
      const captured = await capture(f, bad, null);
      expect((await administration.readOfficialStandings!(f.mapping, { rosterReceiptId: captured.receipt })).status).toBe('unavailable');
      expect(await connection.database.query('SELECT count(*)::integer AS count FROM league_official_standings_teams WHERE content_id=$1', [captured.contentId])).toEqual([{ count: 0 }]);
    }
    const partialFence = await fence(), partialAttempt = await administration.beginRosterAttempt(f.mapping, randomUUID(), undefined, partialFence);
    const partialInput = await observation(f, sourceRows(), 'rosters', null, 'partial');
    const partialReceipt = (await write(writeInput(f, partialInput, partialAttempt, partialFence))).officialStandings!.receiptId;
    const partialDocument = await read(f.mapping, partialReceipt);
    expect(partialDocument.capture.provenance.sourceObservedAt).toBeNull();
    expect(partialDocument.coverage).toMatchObject({ population: 'unproved', entitySet: 'partial',
      reasons: expect.arrayContaining(['standings_capture_partial', 'standings_population_unproved']) });
    expect(partialDocument.freshness).toBe('unknown');
    const later = await capture(f, sourceRows(), null);
    expect((await read(f.mapping, later.receipt)).coverage.population).toBe('unproved');
    expect((await read(f.mapping, partial.receipt))).toEqual(value);
  }, 60_000);

  it('retains corrections replay equal captures and current attempt ordering without silent backfill', async () => {
    // Read-only operands exercise the production predicate at PostgreSQL precision.
    // They never rewrite a persisted reservation, source clock or worker fence.
    await storedOnly(async database => {
      const boundary = '2026-01-01T00:00:00.123500Z';
      const operands = [
        { name: 'before', provenance: {}, population: { provenance: { requestStartedAt: '2026-01-01T00:00:00.123499Z' } }, expected: false },
        { name: 'equal', provenance: {}, population: { provenance: { requestStartedAt: boundary } }, expected: true },
        { name: 'after', provenance: {}, population: { provenance: { requestStartedAt: '2026-01-01T00:00:00.123501Z' } }, expected: true },
        { name: 'null-time', provenance: {}, population: { provenance: { requestStartedAt: null } }, expected: false },
        { name: 'missing-time', provenance: {}, population: { provenance: {} }, expected: false },
        { name: 'missing-population', provenance: {}, population: null, expected: false },
        // Witness branches must not evaluate a timestamp they do not use, even
        // when the witness itself will subsequently fail reader validation.
        { name: 'receipt-witness', provenance: { acquisition: {} }, population: { provenance: { requestStartedAt: 'unused-invalid' } }, expected: false },
        { name: 'population-witness', provenance: {}, population: { provenance: { acquisition: {}, requestStartedAt: 'unused-invalid' } }, expected: false },
        { name: 'null-witness', provenance: { acquisition: null }, population: { provenance: { acquisition: null, requestStartedAt: 'unused-invalid' } }, expected: false },
      ];
      const rows = await database.query(`WITH selected AS (
        SELECT input.ordinality,input.value->>'name' AS name,input.value->'provenance' AS provenance,
          input.value->'population' AS population_evidence,$2::timestamptz AS reserved_at
        FROM jsonb_array_elements($1::jsonb) WITH ORDINALITY input(value,ordinality)
      ) SELECT name,${OFFICIAL_STANDINGS_POPULATION_TIME_SQL} AS population_after_reservation
        FROM selected ORDER BY ordinality`, [JSON.stringify(operands), boundary]);
      expect(rows).toEqual(operands.map(({ name, expected }) => ({ name, population_after_reservation: expected })));
    });
    const f = await fixture(), first = await capture(f), original = await read(f.mapping, first.receipt);
    const beforeReplay = await history(f);
    expect((await write(first.submitted)).officialStandings?.status).toBe('replayed'); expect(await history(f)).toEqual(beforeReplay);
    const same = await capture(f), sameValue = await read(f.mapping, same.receipt);
    expect(same.contentId).toBe(first.contentId); expect(same.receipt).not.toBe(first.receipt);
    expect(Date.parse(sameValue.capture.provenance.requestCompletedAt!)).toBeGreaterThan(Date.parse(original.capture.provenance.requestCompletedAt!));
    const correction = await capture(f, sourceRows(2, true)); expect(correction.contentId).not.toBe(first.contentId);
    expect((await read(f.mapping)).capture.rosterReceiptId).toBe(correction.receipt); expect(await read(f.mapping, first.receipt)).toEqual(original);
    for (const reverse of [false, true]) {
      const workFence = await fence(), a = await administration.beginRosterAttempt(f.mapping, randomUUID(), undefined, workFence),
        b = await administration.beginRosterAttempt(f.mapping, randomUUID(), undefined, workFence);
      expect((await administration.readOfficialStandings!(f.mapping)).status).not.toBe('available');
      const input = await observation(f, sourceRows()), inputs = [writeInput(f, input, a, workFence), writeInput(f, input, b, workFence)];
      const order = reverse ? [1, 0] : [0, 1]; let newest = '';
      for (const index of order) { const result = await write(inputs[index]); if (index === 1) newest = result.officialStandings!.receiptId; }
      const current = await read(f.mapping);
      expect(current.capture.rosterReceiptId).toBe(newest);
      expect(current.coverage.population).toBe('unproved');
    }
    const workFence = await fence(), attempt = await administration.beginRosterAttempt(f.mapping, randomUUID(), undefined, workFence),
      input = await observation(f, sourceRows()), legacy = writeInput(f, input, attempt, workFence, undefined, false);
    const receipt = (await write(legacy)).rosterAcceptance.receiptId, beforeUpgrade = await history(f);
    expect((await write({ ...legacy, officialStandings: projectOfficialStandings(input) })).officialStandings?.status).toBe('legacy-unqualified');
    expect(await administration.readOfficialStandings!(f.mapping, { rosterReceiptId: receipt })).toMatchObject({ status: 'missing', reason: 'typed_standings_not_recorded' });
    expect(await history(f)).toEqual(beforeUpgrade);
  }, 60_000);

  it('rejects forged projections foreign receipts and source mapping mismatches atomically', async () => {
    const f = await fixture(), other = await fixture(), first = await capture(f), workFence = await fence();
    const attempt = await administration.beginRosterAttempt(f.mapping, randomUUID(), undefined, workFence), input = await observation(f, sourceRows());
    const submitted = writeInput(f, input, attempt, workFence), forged = JSON.parse(JSON.stringify(submitted));
    forged.officialStandings!.teams[0].record.wins = { state: 'known', value: 999 };
    const before = await history(f);
    await expect(write(forged)).rejects.toThrow(/projection mismatch/);
    await expect(write({ ...submitted, sourceMapping: other.mapping })).rejects.toThrow(/mapping|scope/);
    expect(await history(f)).toEqual(before);
    expect((await administration.readOfficialStandings!(other.mapping, { rosterReceiptId: first.receipt })).status).not.toBe('available');
    await ownerQuery("SELECT revise_league_source_connection($1,'sleeper',$2,$3,'CP13 source fence')", [f.leagueSeasonId, f.mapping.revisionId, numericId()]);
    expect((await administration.readOfficialStandings!(f.mapping, { rosterReceiptId: first.receipt })).status).not.toBe('available');
  }, 60_000);

  it('rolls back observed lock expiry and deferred changed or equal capture commits under original fences', async () => {
    const f = await fixture(), first = await capture(f), original = await read(f.mapping, first.receipt);
    const blocker = await createPinnedIntegrationDatabase('owner'), writer = await createPinnedIntegrationDatabase('runtime');
    let open = false, pending: Promise<{ error?: unknown }> | undefined;
    try {
      const workFence = await fence(12), attempt = await administration.beginRosterAttempt(f.mapping, randomUUID(), undefined, workFence);
      const input = await observation(f, sourceRows(2, true)), before = await history(f);
      const [blockerPid] = await blocker.database.query('SELECT pg_backend_pid() AS pid'),
        [writerPid] = await writer.database.query('SELECT pg_backend_pid() AS pid');
      await blocker.database.query('BEGIN'); open = true;
      await blocker.database.query('LOCK TABLE public.league_official_standings_contents IN SHARE MODE');
      let settled = false;
      pending = write(writeInput(f, input, attempt, workFence), writer.database).then(() => ({}), error => ({ error })).finally(() => { settled = true; });
      let blocked = false;
      for (let poll = 0; poll < 50; poll++) {
        const [row] = await blocker.database.query(`SELECT $1::integer=ANY(pg_blocking_pids($2::integer))
          AND EXISTS(SELECT 1 FROM pg_locks held_lock WHERE held_lock.pid=$2::integer
            AND held_lock.relation='public.league_official_standings_contents'::regclass
            AND held_lock.mode='RowExclusiveLock' AND NOT held_lock.granted) AS blocked`, [blockerPid.pid, writerPid.pid]);
        if (row.blocked) { blocked = true; break; } await delay(20);
      }
      expect(blocked).toBe(true); expect(settled).toBe(false);
      await blocker.database.query('SELECT pg_sleep(GREATEST(0,EXTRACT(EPOCH FROM ($1::timestamptz-clock_timestamp())))+0.025)', [workFence.deadlineAt]);
      await blocker.database.query('COMMIT'); open = false;
      expect(String((await pending).error)).toMatch(/fence.*(?:stale|expired)|deadline/i);
      expect(await history(f)).toEqual(before); expect(await read(f.mapping, first.receipt)).toEqual(original);
    } finally { if (open) await blocker.database.query('ROLLBACK'); await pending; await writer.close(); await blocker.close(); }
    for (const payload of [sourceRows(2, true), sourceRows()]) {
      const deferred = await createPinnedIntegrationDatabase('runtime'), workFence = await fence(6), before = await history(f);
      let transaction = false;
      try {
        await deferred.database.query('BEGIN'); transaction = true;
        const store = createLeagueAdministrationStore(deferred.database);
        const attempt = await store.beginRosterAttempt(f.mapping, randomUUID(), undefined, workFence), input = await observation(f, payload);
        expect((await write(writeInput(f, input, attempt, workFence), deferred.database)).officialStandings?.status).toBe('recorded');
        expect((await deferred.database.query('SELECT clock_timestamp()<$1::timestamptz AS live', [workFence.deadlineAt]))[0].live).toBe(true);
        await deferred.database.query('SELECT pg_sleep(GREATEST(0,EXTRACT(EPOCH FROM ($1::timestamptz-clock_timestamp())))+0.025)', [workFence.deadlineAt]);
        await expect(deferred.database.query('COMMIT')).rejects.toThrow(/fence.*(?:stale|expired)|deadline/i); transaction = false;
        expect(await history(f)).toEqual(before); expect(await read(f.mapping, first.receipt)).toEqual(original);
      } finally { if (transaction) await deferred.database.query('ROLLBACK'); await deferred.close(); }
    }
  }, 60_000);

  it('denies direct typed mutations and private helpers while stored reads remain source free', async () => {
    const f = await fixture(), first = await capture(f), original = await read(f.mapping, first.receipt), before = await history(f);
    for (const table of typedTables) {
      await expect(connection.database.query(`DELETE FROM public.${table} WHERE content_id=$1`, [first.contentId])).rejects.toThrow(/permission denied/);
      expect(await ownerQuery(`SELECT has_table_privilege('league_one_runtime',$1,'SELECT') AS read,
        has_table_privilege('league_one_runtime',$1,'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') AS write,
        has_table_privilege('league_one_auth',$1,'SELECT,INSERT,UPDATE,DELETE') AS auth`, ['public.' + table]))
        .toEqual([{ read: true, write: false, auth: false }]);
      await expect(ownerQuery(`DELETE FROM public.${table} WHERE content_id=$1`, [first.contentId])).rejects.toThrow(/immutable|history/);
    }
    const helpers = ['public.official_standings_native_fact(jsonb,text,boolean,integer)', 'public.official_standings_native_points(jsonb,text,text)',
      'public.project_official_standings_native(jsonb,text)', 'public.official_standings_typed_value(uuid)',
      'public.official_standings_receipt_coverage(uuid)', 'public.guard_official_standings_insert()',
      'public.validate_official_standings_capture()', 'public.record_league_administration_observation_v47(jsonb)'];
    for (const helper of helpers) expect(await ownerQuery(`SELECT has_function_privilege('league_one_runtime',$1,'EXECUTE') AS runtime,
      has_function_privilege('league_one_auth',$1,'EXECUTE') AS auth`, [helper])).toEqual([{ runtime: false, auth: false }]);
    await expect(connection.database.query('SELECT public.official_standings_typed_value($1::uuid)', [first.contentId])).rejects.toThrow(/permission denied/);
    const owner = await createPinnedIntegrationDatabase('owner');
    try {
      await owner.database.query('BEGIN');
      await owner.database.query(await readFile(new URL('../scripts/provision-runtime-role.sql', import.meta.url), 'utf8'));
      for (const table of typedTables) expect(await owner.database.query(`SELECT has_table_privilege('league_one_runtime',$1,'SELECT') AS read,
        has_table_privilege('league_one_runtime',$1,'INSERT,UPDATE,DELETE') AS write`, ['public.' + table])).toEqual([{ read: true, write: false }]);
    } finally { await owner.database.query('ROLLBACK'); await owner.close(); }
    await storedOnly(async (_database, store) => {
      expect(await read(f.mapping, first.receipt, store)).toEqual(original);
      expect((await read(f.mapping, undefined, store)).selection).toBe('current');
    });
    expect(await history(f)).toEqual(before);
  }, 60_000);

  it('composes native scores and reported bracket results without inferring outcomes or finality', async () => {
    const f = await fixture(), first = await capture(f), standings = await read(f.mapping, first.receipt), workFence = await fence();
    const periods = [];
    for (const nativeWeek of [15, 16]) {
      const attempt = await administration.beginExactMatchupAttempt(f.mapping, nativeWeek, randomUUID(), workFence);
      const evidence = await population(f, 2, workFence);
      const payload = [1, 2].map(roster_id => ({ roster_id, matchup_id: nativeWeek === 15 ? 1 : null,
        players: ['9001'], starters: ['9001'], points: 123.4567, custom_points: nativeWeek === 15 ? 0 : null }));
      const input = await observation(f, payload, 'matchups', nativeWeek);
      const result = await administration.recordObservation(input, workFence, f.mapping, undefined, undefined, undefined, { attempt, population: evidence });
      expect(result.matchupAcceptance?.status).toBe('accepted');
      const values = await administration.readExactMatchupValues!(f.mapping, { nativeWeek, matchupsReceiptId: result.matchupAcceptance!.receiptId });
      expect(values.status).toBe('available'); periods.push({ nativeWeek, values });
    }
    const brackets = [];
    for (const family of ['winners_bracket', 'losers_bracket'] as const) {
      const attempt = await administration.beginBracketAttempt!(f.mapping, family, randomUUID(), workFence);
      const input = await observation(f, family === 'winners_bracket' ? [{ m: 1, r: 1, t1: 1, t2: 2, w: 1, l: 2 },
        { m: 2, r: 2, t1: { w: 1 }, t2: null }] : null, family);
      const result = await administration.recordObservation(input, workFence, f.mapping, undefined, undefined, undefined,
        undefined, undefined, undefined, undefined, undefined, { attempt });
      expect(result.bracketAcceptance?.status).toBe('accepted');
      const resource = await administration.readAcceptedBracket!(f.mapping, { family, bracketReceiptId: result.bracketAcceptance!.receiptId });
      expect(resource.status).toBe('available'); brackets.push({ family, resource });
    }
    const value = composeOfficialResults({ mapping: f.mapping, standings, periods, brackets });
    expect(value).toMatchObject({ status: 'available', scope: 'selected-resources',
      periods: [{ identity: { nativeWeek: 15 }, officialOutcome: { status: 'unknown' }, finality: { status: 'unknown' }, series: { status: 'unknown' } },
        { identity: { nativeWeek: 16 }, officialOutcome: { status: 'unknown' }, finality: { status: 'unknown' }, series: { status: 'unknown' } }],
      brackets: [{ reportedResults: [{ identity: { kind: 'bracket-match', externalMatchupId: '1' }, winner: { value: '1' }, loser: { value: '2' },
        finality: { status: 'provider-reported-played', reason: 'bracket_outcomes_match_resolved_entrants' } }, { winner: { state: 'missing' }, finality: { status: 'unknown' } }] }, { reportedResults: [] }] });
    if (value.status !== 'available') throw new Error('CP13 result composition unavailable.');
    for (const period of value.periods) { expect(period).not.toHaveProperty('aggregateScore'); expect(period).not.toHaveProperty('winner'); }
    expect(value.brackets[0].reportedResults[1]).not.toHaveProperty('bye');
  }, 60_000);

  it('composes ordinary failed core recovery and changed refresh through immutable selected results', async () => {
    const id = randomUUID(), manager = numericId(), external = numericId(), username = 'cp13_results_' + manager;
    const league = leagueDocument(external), urls: string[] = [], exactPeriods = [{ season: 2026, nativeWeek: 15 }];
    const playerIds = [numericId(), numericId()], directoryVersion = await directoryPrerequisite(playerIds);
    let correction = false, failLeagueWrite = false, failedLeagueWrites = 0, admissions = 0, claims = 0;
    const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(async input => {
      const url = String(input); urls.push(url); const base = 'https://api.sleeper.app/v1/league/' + external;
      if (url === 'https://api.sleeper.app/v1/user/' + username || url === 'https://api.sleeper.app/v1/user/' + manager)
        return new Response(JSON.stringify({ user_id: manager, username }));
      if (url === 'https://api.sleeper.app/v1/user/' + manager + '/leagues/nfl/2026') return new Response(JSON.stringify([league]));
      if (url === base) return new Response(JSON.stringify(league));
      if (url === base + '/rosters') return new Response(JSON.stringify(sourceRows(2, correction).map((row, index) => ({
        ...row, owner_id: failLeagueWrite ? { malformed: true } : index === 0 ? manager : null,
        players: failLeagueWrite ? null : [playerIds[index]], starters: [playerIds[index]],
      }))));
      if (url === base + '/users') return new Response(JSON.stringify([{ user_id: manager, display_name: username }]));
      if (url === base + '/matchups/15') return new Response(JSON.stringify([1, 2].map(roster_id => ({
        roster_id, matchup_id: 1, players: [playerIds[roster_id - 1]], starters: [playerIds[roster_id - 1]],
        points: 123.4567, custom_points: correction && roster_id === 1 ? 0 : null,
      }))));
      if (url === base + '/winners_bracket') return new Response(JSON.stringify([{ m: 1, r: 1, t1: 1, t2: 2,
        w: correction ? 2 : 1, l: correction ? 1 : 2 }]));
      if (url === base + '/losers_bracket') return new Response(correction ? '[]' : 'null');
      throw new Error('Unexpected CP13 synthetic acquisition: ' + url);
    });
    const intake = createPublicIntakeStore(connection.database), refresh = createPublicDataRefreshStore(connection.database),
      jobs = createProjectionStore(connection.database);
    const dependencies: PublicIntakeDependencies = { intake: { ...intake, admit: async (...args) => {
      const admitted = await intake.admit(...args); if (admitted) admissions++; return admitted;
    } }, administration: { ...administration, recordObservation: async (...args) => {
      if (failLeagueWrite && args[0].envelope.family === 'league') { failedLeagueWrites++; throw new Error('CP13 injected league write failure.'); }
      return administration.recordObservation(...args);
    } }, jobs: { ...jobs, acquireJob: async (...args) => {
      const claim = await jobs.acquireJob(...args); if (claim.kind === 'acquired') claims++; return claim;
    } } };
    const zeroRequestClaims = { recovery: 0, settlement: 0 };
    async function step(recurring: boolean, zeroRequestPhase?: keyof typeof zeroRequestClaims) {
      const before = { claims, admissions, requests: urls.length };
      const outcome = recurring ? await runPublicDataRefreshStep({ ...dependencies, refresh }, AbortSignal.timeout(20_000))
        : await runPublicIntakeStep(id, dependencies, AbortSignal.timeout(20_000));
      const acquired = claims - before.claims, admitted = admissions - before.admissions;
      expect([0, 1]).toContain(acquired); expect([0, 1]).toContain(admitted);
      expect(urls.length - before.requests).toBe(outcome.providerRequests);
      if (acquired === 0) {
        expect(admitted).toBe(0); expect(outcome).toEqual({ status: 'busy', providerRequests: 0 });
      } else if (admitted === 0) {
        // A failed owner may be reclaimed before its intake retry is due.
        // Settlement also owns a job without admitting a provider request.
        expect(outcome).toEqual({ status: 'backoff', providerRequests: 0 });
        if (!zeroRequestPhase) throw new Error('Unexpected CP13 zero-request owner claim.');
        zeroRequestClaims[zeroRequestPhase]++;
        expect(zeroRequestClaims[zeroRequestPhase]).toBeLessThanOrEqual(1);
      } else {
        expect(acquired).toBe(1); expect(outcome.providerRequests).toBeGreaterThan(0);
      }
      return outcome;
    }
    async function progress(recurring: boolean, resource: string, status = 'progress') {
      const until = Date.now() + 150_000;
      do {
        const outcome = await step(recurring, !recurring && resource === 'core' && status === 'progress' ? 'recovery' : undefined);
        if (['busy', 'backoff', 'idle'].includes(outcome.status)) { await delay(1_000); continue; }
        expect(outcome).toMatchObject({ status, resource, providerRequests: ['core', 'exact-matchups', 'playoff-brackets'].includes(resource) ? 2 : 1 }); return;
      } while (Date.now() < until);
      throw new Error('CP13 ordinary stage exceeded existing admission allowance.');
    }
    const configuration = { id: randomUUID(), expectedRevision: 0, identityRequestId: id, seasons: [2026], exactPeriods,
      playoffBrackets: PUBLIC_PLAYOFF_BRACKETS, cadenceSeconds: 3600,
      expiresAt: new Date(Date.now() + 25 * 60_000).toISOString(), paused: false };
    let target: { targetId: string; configurationRevision: number } | undefined;
    try {
      await intake.submit({ id, username, seasons: [2026], exactPeriods, playoffBrackets: PUBLIC_PLAYOFF_BRACKETS });
      for (const resource of ['identity', 'leagues', 'bootstrap', 'playoff-brackets', 'exact-matchups']) await progress(false, resource);
      const mapping = await administration.readSourceMapping(external); if (!mapping) throw new Error('CP13 ordinary mapping unavailable.');
      failLeagueWrite = true; await progress(false, 'core', 'unavailable'); failLeagueWrite = false;
      expect(failedLeagueWrites).toBe(1);
      const partial = await readPublicSleeperIntake(connection.database, administration, id, { officialResultsVersion: 'v1' });
      expect(partial).toMatchObject({ officialResults: [{ captureBinding: 'intake-dispatch', resource: {
        status: 'available', standings: { status: 'available', coverage: { population: 'unproved', entitySet: 'unknown' } } } }] });
      // This checkpoint failed; unlike a committed checkpoint with a lost
      // acknowledgment, its next attempt must respect the stored retry due time.
      expect(await intake.next(id)).toBe('backoff');
      expect(await connection.database.query(`SELECT candidate.stage, request.failure_count,
        request.next_attempt_at>clock_timestamp() AS retry_pending
        FROM public_data_intakes request JOIN public_data_league_candidates candidate ON candidate.intake_id=request.id
        WHERE request.id=$1 AND candidate.external_league_id=$2`, [id, external]))
        .toEqual([{ stage: 'core', failure_count: 1, retry_pending: true }]);
      const failedCapture = await read(mapping);
      expect(failedCapture.coverage.population).toBe('unproved');
      expect((await administration.readAcceptedCurrentRoster(mapping)).status).not.toBe('available');
      expect((await administration.readAcceptedTeamManagers(mapping)).status).not.toBe('available');
      await progress(false, 'core'); await progress(false, 'users'); expect(await intake.next(id)).toBe('complete');
      const original = await readPublicSleeperIntake(connection.database, administration, id, { officialResultsVersion: 'v1' });
      expect(original).toMatchObject({ officialResults: [{ resource: { status: 'available',
        standings: { status: 'available', coverage: { entitySet: 'full', recordCompleteness: 'complete' } } } }] });
      if (original.status === 'missing' || !original.officialResults) throw new Error('CP13 original result missing.');
      const originalResults = original.officialResults, originalStandings = await read(mapping);
      expect(original.leagues).toMatchObject([{ resources: { teamManagers: { status: 'available' }, managerDirectory: { status: 'available' },
        heldRoster: { status: 'available', playerLinks: { status: 'available', directory: { versionId: directoryVersion },
          counts: { teams: 2, held: 2, resolved: 2, unresolved: 0, conflict: 0 } } } } }]);
      const linkedRoster = await administration.readAcceptedCurrentRoster(mapping, { includePlayerLinks: true });
      if (linkedRoster.status !== 'available' || linkedRoster.playerLinks?.status !== 'available') throw new Error('CP13 canonical player links unavailable.');
      expect(linkedRoster.playerLinks.links.map(link => link.nativePlayerId).sort()).toEqual([...playerIds].sort());
      expect(new Set(linkedRoster.playerLinks.links.map(link => link.canonicalEntityId)).size).toBe(2);
      expect(linkedRoster.playerLinks.links.every(link => link.identityState === 'resolved' && link.canonicalEntityId !== null)).toBe(true);
      const originalLinks = linkedRoster.playerLinks;
      expect(originalResults).toHaveLength(1);
      expect(originalResults[0].resource).toMatchObject({ status: 'available',
        periods: [{ nativeWeek: 15, values: { status: 'available', value: { teams: [
          { externalRosterId: '1', rawPoints: { state: 'supplied', value: '123.4567' },
            customPoints: { state: 'null' }, effectivePoints: { value: '123.4567', source: 'raw' } },
          { externalRosterId: '2', effectivePoints: { value: '123.4567', source: 'raw' } },
        ] } }, context: { status: 'available' }, officialOutcome: { status: 'unknown' }, finality: { status: 'unknown' } }],
        brackets: [{ family: 'winners_bracket', resource: { status: 'available', value: { publication: 'published' } },
          reportedResults: [{ winner: { value: '1' }, loser: { value: '2' }, finality: { status: 'provider-reported-played', reason: 'bracket_outcomes_match_resolved_entrants' } }] },
        { family: 'losers_bracket', resource: { status: 'available', value: { publication: 'unpublished', matches: [] } }, reportedResults: [] }] });
      expect(originalStandings.capture.rosterReceiptId).not.toBe(failedCapture.capture.rosterReceiptId);
      expect(await read(mapping, failedCapture.capture.rosterReceiptId)).toEqual({ ...failedCapture, selection: 'receipt' });
      target = await refresh.configure(configuration); correction = true;
      const stages = ['identity', 'leagues', 'bootstrap', 'playoff-brackets', 'exact-matchups', 'core', 'users'];
      for (const resource of stages) await progress(true, resource);
      expect(admissions).toBe(15); expect(claims).toBe(15 + zeroRequestClaims.recovery);
      const base = 'https://api.sleeper.app/v1/league/' + external;
      const expectedCycle = (identity: string) => ['https://api.sleeper.app/v1/user/' + identity,
        'https://api.sleeper.app/v1/user/' + manager + '/leagues/nfl/2026', base,
        base + '/winners_bracket', base + '/losers_bracket', base, base + '/matchups/15', base, base + '/rosters', base + '/users'];
      const originalUrls = expectedCycle(username); originalUrls.splice(9, 0, base, base + '/rosters');
      // Core requests are made concurrently but invoked in stable league/roster order.
      expect(urls).toEqual([...originalUrls, ...expectedCycle(manager)]); expect(urls).toHaveLength(22); // Plus one separately asserted directory prerequisite GET above.
      const until = Date.now() + 150_000;
      while (true) {
        const outcome = await step(true, 'settlement');
        if (outcome.status === 'busy') { if (Date.now() >= until) throw new Error('CP13 settlement exceeded admission allowance.'); await delay(1_000); continue; }
        expect(outcome.providerRequests).toBe(0); break;
      }
      expect(zeroRequestClaims.settlement).toBe(1);
      expect(admissions).toBe(15); expect(claims).toBe(16 + zeroRequestClaims.recovery);
      expect(urls).toHaveLength(22); fetch.mockRestore();
      let currentId = '';
      await storedOnly(async (database, store) => {
        const current = await readPublicDataRefresh(database, store, target!.targetId, { officialResultsVersion: 'v1' });
        expect(current).toMatchObject({ status: 'available', cycle: { outcome: { disposition: 'complete' } },
          intake: { officialResults: [{ resource: { standings: { teams: [
            { externalRosterId: '1', record: { wins: { value: 5 } }, pointsFor: { value: '512.35' } },
            { externalRosterId: '2', record: { wins: { value: 0 } }, pointsFor: { value: '512.35' } },
          ] } } }] } });
        if (current.status !== 'available' || !current.cycle) throw new Error('CP13 current refresh unavailable.');
        currentId = current.cycle.requestId;
        expect(current.intake).toMatchObject({ leagues: [{ resources: { teamManagers: { status: 'available' },
          managerDirectory: { status: 'available' }, heldRoster: { status: 'available', playerLinks: { status: 'available',
            counts: { teams: 2, held: 2, resolved: 2, unresolved: 0, conflict: 0 } } } } }] });
        expect(await store.readRosterPlayerLinks({ rosterReceiptId: originalLinks.rosterReceiptId, leagueSeasonId: mapping.leagueSeasonId })).toEqual(originalLinks);
        expect(current.intake).toMatchObject({ officialResults: [{ resource: {
          periods: [{ nativeWeek: 15, values: { status: 'available', value: { teams: [
            { externalRosterId: '1', rawPoints: { value: '123.4567' }, customPoints: { state: 'supplied', value: '0' },
              effectivePoints: { value: '0', source: 'custom-override' } },
            { externalRosterId: '2', effectivePoints: { value: '123.4567', source: 'raw' } },
          ] } }, context: { status: 'available' }, officialOutcome: { status: 'unknown' } }],
          brackets: [{ family: 'winners_bracket', resource: { status: 'available' },
            reportedResults: [{ winner: { value: '2' }, loser: { value: '1' }, finality: { status: 'provider-reported-played', reason: 'bracket_outcomes_match_resolved_entrants' } }] },
          { family: 'losers_bracket', resource: { status: 'available', value: { publication: 'published', matches: [] } }, reportedResults: [] }],
        } }] });
        const old = await readPublicSleeperIntake(database, store, id, { officialResultsVersion: 'v1' });
        if (old.status === 'missing') throw new Error('CP13 old intake disappeared.');
        expect(old.officialResults).toEqual(originalResults);
        expect(await read(mapping, originalStandings.capture.rosterReceiptId, store)).toEqual({ ...originalStandings, selection: 'receipt' });
        const defaults = await readPublicSleeperIntake(database, store, id);
        expect(defaults).not.toHaveProperty('officialResults');
        expect((await read(mapping, undefined, store)).capture.rosterReceiptId).not.toBe(originalStandings.capture.rosterReceiptId);
      });
      expect(currentId).not.toBe(id); expect(await intake.next(currentId)).toBe('complete');
      const [spacing] = await connection.database.query(`SELECT count(*)::integer AS count,
        bool_and(history.previous IS NULL OR history.admitted_at-history.previous>=interval '60 seconds') AS spaced
        FROM(SELECT dispatch.admitted_at,lag(dispatch.admitted_at) OVER(ORDER BY dispatch.admitted_at) AS previous
          FROM public_data_dispatches dispatch WHERE dispatch.intake_id=ANY($1::uuid[])) history`, [[id, currentId]]);
      expect(spacing).toEqual({ count: 15, spaced: true });
      const markers = await connection.database.query(`SELECT marker.receipt_id,
        receipt.provenance->'acquisition'->'work'=dispatch.work
        AND receipt.provenance->'acquisition'->>'dispatchNonce'=dispatch.capture_nonce::text
        AND receipt.provenance->'acquisition'->'fence'=attempt.write_fence AS witnessed
        FROM league_official_standings_captures marker
        JOIN league_roster_capture_receipts receipt ON receipt.id=marker.receipt_id
        JOIN league_roster_resource_attempts attempt ON attempt.id=receipt.attempt_id
        JOIN public_data_dispatches dispatch ON dispatch.intake_id=marker.intake_id
          AND dispatch.worker_id=marker.worker_id AND dispatch.generation=marker.generation
        WHERE marker.intake_id=ANY($1::uuid[])`, [[id, currentId]]);
      expect(markers).toHaveLength(3); expect(markers.every(row => row.witnessed === true)).toBe(true);
    } finally {
      fetch.mockRestore();
      if (target) await refresh.configure({ ...configuration, expectedRevision: target.configurationRevision,
        expiresAt: new Date(Date.now() + 60_000).toISOString(), paused: true });
    }
  }, 1_080_000);

  // Separately selected local B1 proof. Disclosed CP28 synthetic prerequisites,
  // admission and job fixtures drive the existing witnessed core. No cadence claim.
  const b1Players = Array.from({ length: 80 }, numericId);
  const b1 = { fixtures: [] as Fixture[], attempts: 0, cores: 0, startedAt: 0, bound: false,
    workers: [] as string[], ready: false };
  type B1Write = { args: Parameters<typeof administration.recordObservation>;
    result: Awaited<ReturnType<typeof administration.recordObservation>> };
  function b1Reserve(count: number) {
    if (!b1.startedAt) b1.startedAt = Date.now();
    const limit = Number(process.env.CP28_LOCAL_B1_ATTEMPT_LIMIT ?? 353);
    expect(Number.isInteger(limit) && limit > 0 && limit <= 353).toBe(true);
    expect(Date.now() - b1.startedAt).toBeLessThan(30 * 60_000);
    expect(b1.attempts + count).toBeLessThanOrEqual(limit); b1.attempts += count;
    // Retained before SQL, including failed and rollback-only reservations.
    console.info('CP28_B1_ATTEMPTS ' + JSON.stringify({ reserved: b1.attempts, limit }));
  }
  const b1Roster = (corrected = false) => sourceRows(10, corrected).map((row, index) => ({
    ...row, players: b1Players.slice(index * 8, index * 8 + 8),
    starters: b1Players.slice(index * 8, index * 8 + 1),
  }));
  async function b1Setup() {
    if (b1.ready) return;
    b1Reserve(1); await directoryPrerequisite(b1Players);
    b1.fixtures.push(await fixture(), await fixture()); expect(b1.fixtures).toHaveLength(2);
    expect((await ownerQuery(`SELECT tgfoid::regproc::text AS function FROM pg_trigger
      WHERE tgrelid='public.league_roster_resource_acceptances'::regclass AND tgname='roster_player_links_after_acceptance'`))[0])
      .toEqual({ function: 'capture_roster_player_links' });
    expect((await ownerQuery('SELECT count(*)::int AS rows FROM public.league_player_directory_entries'))[0].rows).toBeLessThanOrEqual(12_229);
    b1.ready = true;
  }
  async function restoreB1Writer() {
    if (!b1.bound) return;
    await ownerQuery('DROP TRIGGER roster_population_intern_before_lineage ON public.league_roster_capture_receipts');
    b1.bound = false;
    expect(await ownerQuery(`SELECT 1 FROM pg_trigger WHERE tgrelid='public.league_roster_capture_receipts'::regclass
      AND tgname='roster_population_intern_before_lineage'`)).toEqual([]);
  }
  async function b1Shared<T>(body: () => Promise<T>) {
    expect(b1.bound).toBe(false);
    expect(await ownerQuery(`SELECT 1 FROM pg_trigger WHERE tgrelid='public.league_roster_capture_receipts'::regclass
      AND tgname='roster_population_intern_before_lineage'`)).toEqual([]);
    await ownerQuery(`CREATE TRIGGER roster_population_intern_before_lineage BEFORE INSERT
      ON public.league_roster_capture_receipts FOR EACH ROW EXECUTE FUNCTION public.intern_roster_population_evidence()`);
    b1.bound = true;
    try { return await body(); } finally { await restoreB1Writer(); }
  }
  async function b1State(database = connection.database) {
    const tables = ['league_roster_population_contents', 'league_roster_capture_receipts', 'league_roster_resource_acceptances',
      'league_roster_resource_heads', 'league_administration_contents', 'league_administration_observations',
      'league_administration_heads', ...typedTables, 'league_roster_player_link_receipts', 'league_roster_player_links'];
    return database.query(tables.map(table => `SELECT '${table}' AS name,count(*)::int AS rows,
      md5(COALESCE(string_agg(to_jsonb(t)::text,'' ORDER BY to_jsonb(t)::text),'')) AS digest FROM public.${table} t`).join(' UNION ALL '));
  }
  async function b1Receipts(ids: readonly string[], database = connection.database, provenance = false) {
    return database.query(`SELECT receipt.*,public.roster_capture_population_evidence(receipt) AS effective_population,
      ${provenance ? 'public.roster_capture_provenance(receipt) AS effective_provenance,' : ''}
      to_jsonb(attempt) AS attempt,scope.identity FROM public.league_roster_capture_receipts receipt
      JOIN public.league_roster_resource_attempts attempt ON attempt.id=receipt.attempt_id
      JOIN public.league_roster_resource_scopes scope ON scope.id=attempt.scope_id
      WHERE receipt.id=ANY($1::uuid[]) ORDER BY array_position($1::uuid[],receipt.id)`, [ids]);
  }
  async function b1Core(f: Fixture, corrected = false, replay = false, combined?: {
    linkFormat: 'acceptance-v1' | 'shared-v1'; roster?: ReturnType<typeof b1Roster>; state: () => Promise<DatabaseRow[]>; provenance?: boolean;
    occurrence?: { requestId: string; resourceId: string; targetId: string };
    intercept?: (args: B1Write['args']) => Promise<B1Write['result']>; expectedFailure?: () => boolean;
  }) {
    b1Reserve(4); expect(++b1.cores).toBeLessThanOrEqual(80);
    const requestId = combined?.occurrence?.requestId ?? randomUUID(), manager = numericId(), username = 'cp28_b1_' + manager;
    const league = leagueDocument(f.external, 10), roster = combined?.roster ?? b1Roster(corrected);
    if (!combined?.occurrence) {
    await ownerQuery('INSERT INTO public.public_data_intakes(id,username,seasons) VALUES($1,$2,ARRAY[2026])', [requestId, username]);
    await ownerQuery("INSERT INTO public.league_source_manager_accounts(provider,external_manager_id) VALUES('sleeper',$1) ON CONFLICT DO NOTHING", [manager]);
    await ownerQuery(`INSERT INTO public.public_data_identity_observations(intake_id,source_manager_account_id,username,display_name,payload,request_started_at,request_completed_at)
      SELECT $1,id,$2,$2,$3::jsonb,clock_timestamp(),clock_timestamp() FROM public.league_source_manager_accounts
      WHERE provider='sleeper' AND external_manager_id=$4`,
    [requestId, username, JSON.stringify({ user_id: manager, username, fixture: 'B1 disclosed synthetic prerequisite' }), manager]);
    await ownerQuery(`INSERT INTO public.public_data_league_lists(intake_id,season,payload,request_started_at,request_completed_at)
      VALUES($1,2026,$2::jsonb,clock_timestamp(),clock_timestamp())`, [requestId, JSON.stringify([league])]);
    await ownerQuery(`INSERT INTO public.public_data_league_candidates(intake_id,season,external_league_id,name,stage,league_season_id,bootstrap_payload,bootstrap_started_at,bootstrap_completed_at)
      VALUES($1,2026,$2,$3,'core',$4,$5::jsonb,clock_timestamp(),clock_timestamp())`,
    [requestId, f.external, league.name, f.leagueSeasonId, JSON.stringify(league)]);
    }
    const intake = createPublicIntakeStore(connection.database), jobs = createProjectionStore(connection.database);
    const invocation = combined?.occurrence ? Date.now() : undefined;
    const written: B1Write[] = []; let responses = 0, replayed = false;
    const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(async input => {
      const url = String(input), base = 'https://api.sleeper.app/v1/league/' + f.external;
      expect([base, base + '/rosters']).toContain(url); expect(++responses).toBeLessThanOrEqual(2);
      return new Response(JSON.stringify(url === base ? league : roster), { headers: { 'Content-Type': 'application/json' } });
    });
    try {
      const outcome = await runPublicIntakeStep(requestId, { managerEvidenceVersion: 'v2',
        ...(invocation === undefined ? {} : { deadlineAt: new Date(invocation + 20_000).toISOString() }),
        administration: { ...administration, recordObservation: async (...args) => {
          const result = combined?.intercept && args[0].envelope.family === 'rosters'
            ? await combined.intercept(args) : await administration.recordObservation(...args);
          written.push({ args, result }); return result;
        } },
        intake: { ...intake, admit: async (work, owner) => {
          expect(work.kind).toBe('core'); expect(work.requestId).toBe(requestId); expect(b1.workers).toContain(owner.workerId);
          if (combined?.occurrence) {
            await ownerQuery(`INSERT INTO public.public_data_resource_selections(worker_id,generation,intake_id,lane,resource_id,target_id,configuration_revision)
              VALUES($1,$2,$3,'active',$4,$5,1)`, [owner.workerId, owner.generation, requestId, combined.occurrence.resourceId, combined.occurrence.targetId]);
            await ownerQuery(`UPDATE public.projection_jobs SET payload=payload||jsonb_build_object('resourceSelection',
              (SELECT public.public_data_resource_selection_json(selection) FROM public.public_data_resource_selections selection
                WHERE worker_id=$2 AND generation=$3)) WHERE job_key=$1`, [PUBLIC_INTAKE_JOB, owner.workerId, owner.generation]);
          }
          await ownerQuery(`INSERT INTO public.public_data_dispatches(worker_id,generation,intake_id,revision,resource,work,max_requests${combined?.provenance ? ',request_budget_policy' : ''})
            VALUES($1,$2,$3,$4,'core',$5::jsonb,2${combined?.provenance ? ",'public-data-settled-request-budget-v1'" : ''})`, [owner.workerId, owner.generation, requestId, work.revision, JSON.stringify(work)]);
          return true;
        }, completeCore: async (...args) => {
          if (replay) {
            expect(written).toHaveLength(2); const before = await (combined?.state ?? b1State)();
            for (const entry of written) {
              const repeated = await administration.recordObservation(...entry.args);
              for (const key of ['leagueSettingsAcceptance', 'rosterAcceptance', 'teamManagerAcceptance', 'teamManagerEvidenceAcceptance'] as const) {
                if (entry.result[key]) expect(repeated[key]?.receiptId).toBe(entry.result[key]!.receiptId);
                if (combined && entry.result[key]) expect(repeated[key]).toMatchObject({
                  status: 'accepted', reason: 'exact_receipt_replay', acceptedGeneration: entry.result[key]!.acceptedGeneration,
                });
              }
            }
            const changed = [...written[1].args] as Parameters<typeof administration.recordObservation>;
            changed[0] = { ...changed[0], envelope: { ...changed[0].envelope, provenance: { ...changed[0].envelope.provenance,
              checkedAt: new Date(Date.parse(changed[0].envelope.provenance.checkedAt) + 1).toISOString() } } };
            await expect(administration.recordObservation(...changed)).rejects.toThrow(/receipt conflict|replay|mismatch/iu);
            expect(await (combined?.state ?? b1State)()).toEqual(before); replayed = true;
          }
          return intake.completeCore(...args);
        } },
        jobs: { ...jobs, acquireJob: async input => {
          expect(input.jobKey).toBe(PUBLIC_INTAKE_JOB); expect(input.leaseSeconds).toBe(25);
          const payload = invocation === undefined ? input.payload : { requestId, policy: 'public-data-refresh-v1', mode: 'recurring',
            batchMode: 'recurring', batchPolicy: 'public-data-batch-v1', schedulingPolicy: 'public-data-resource-schedule-v1',
            batchInvocationStartedAt: new Date(invocation).toISOString(), batchAdmissionDeadlineAt: new Date(invocation + 10_000).toISOString(),
            batchWorkDeadlineAt: new Date(invocation + 20_000).toISOString(), batchCleanupDeadlineAt: new Date(invocation + 22_000).toISOString() };
          const [row] = await ownerQuery(`INSERT INTO public.projection_jobs(job_key,job_type,scheduled_for,state,lease_owner,lease_until,attempt_count,payload)
            VALUES($1,$1,clock_timestamp(),'running',$2,COALESCE($4::timestamptz,clock_timestamp()+interval '25 seconds'),1,$3::jsonb)
            ON CONFLICT(job_key) DO UPDATE SET state='running',lease_owner=EXCLUDED.lease_owner,lease_until=EXCLUDED.lease_until,
              attempt_count=projection_jobs.attempt_count+1,payload=EXCLUDED.payload,scheduled_for=EXCLUDED.scheduled_for,completed_at=NULL
            WHERE projection_jobs.state<>'running' OR projection_jobs.lease_until<=clock_timestamp()
            RETURNING attempt_count,lease_until`, [PUBLIC_INTAKE_JOB, input.workerId, JSON.stringify(payload),
            invocation === undefined ? null : new Date(invocation + 25_000).toISOString()]);
          expect(row).toBeDefined(); b1.workers.push(input.workerId);
          return { kind: 'acquired', attempt: Number(row.attempt_count), leaseUntil: exactMatchupClockInstant(row.lease_until) };
        } },
      }, AbortSignal.timeout(20_000));
      if (combined?.expectedFailure) {
        expect(combined.expectedFailure()).toBe(true); expect(outcome.status).not.toBe('progress');
        expect(responses).toBe(2);
        console.info('CP28_B2_EXPECTED_CORE_FAILURE ' + JSON.stringify({ outcome, reservations: b1.attempts, fixtureHttp: responses }));
        throw new Error('B2 expected original-deadline core failure verified');
      }
      expect(outcome).toEqual({ status: 'progress', resource: 'core', providerRequests: 2 });
      expect(responses).toBe(2); expect(written).toHaveLength(2); expect(replayed).toBe(replay);
      const ids = [written[0].result.leagueSettingsAcceptance, written[1].result.rosterAcceptance,
        written[1].result.teamManagerAcceptance, written[1].result.teamManagerEvidenceAcceptance].map(value => {
        expect(value?.status).toBe('accepted'); if (!value) throw new Error('B1 missing core receipt.'); return value.receiptId;
      });
      const rows = await b1Receipts(ids, connection.database, combined?.provenance), proof = { observationId: written[0].result.observationId,
        contentHash: written[0].args[0].contentHash, provenance: written[0].args[0].envelope.provenance };
      expect(rows).toHaveLength(4);
      expect(rows[0]).toMatchObject({ population_storage_format: 'inline-v1', population_content_id: null,
        population_evidence: null, effective_population: null });
      for (const row of rows.slice(1)) {
        expect(row.effective_population).toEqual(proof);
        expect(combined?.provenance ? row.effective_provenance : row.provenance).toEqual(written[1].args[0].envelope.provenance);
        const attempt = row.attempt as Record<string, unknown>;
        expect(attempt.source_mapping).toEqual(f.mapping); expect(attempt.write_fence).toEqual(written[1].args[1]);
        expect(row.population_storage_format).toBe(b1.bound ? 'shared-v1' : 'inline-v1');
        expect(row.population_evidence).toEqual(b1.bound ? null : proof);
      }
      if (b1.bound) {
        expect(new Set(rows.slice(1).map(row => row.population_content_id)).size).toBe(1);
        expect(rows[1].population_content_id).toBeTypeOf('string');
      } else expect(rows.every(row => row.population_content_id === null)).toBe(true);
      const standing = await read(f.mapping, ids[1]);
      expect(standing.coverage).toEqual({ population: 'proven', entitySet: 'full', recordCompleteness: 'complete', reasons: [] });
      expect(standing.capture.provenance).toEqual(written[1].args[0].envelope.provenance);
      expect((await administration.readAcceptedLeagueSettings(f.mapping)).status).toBe('available');
      expect(await administration.readAcceptedCurrentRoster(f.mapping, { includePlayerLinks: true })).toMatchObject({
        status: 'available', playerLinks: { status: 'available', counts: { teams: 10, held: 80, resolved: 80, unresolved: 0, conflict: 0 } } });
      expect((await administration.readAcceptedTeamManagers(f.mapping)).status).toBe('available');
      expect((await administration.readAcceptedTeamManagerEvidence!(f.mapping)).status).toBe('available');
      if (combined) {
        const [linkReceipt] = await ownerQuery('SELECT storage_format,link_content_id FROM public.league_roster_player_link_receipts WHERE roster_receipt_id=$1', [ids[1]]);
        expect(linkReceipt.storage_format).toBe(combined.linkFormat);
        if (combined.linkFormat === 'shared-v1') expect(linkReceipt.link_content_id).toBeTypeOf('string');
        else expect(linkReceipt.link_content_id).toBeNull();
      } else expect((await ownerQuery('SELECT count(*)::int AS rows FROM public.league_roster_player_link_contents'))[0].rows).toBe(0);
      return { requestId, ids, rows, proof, standing, written };
    } finally {
      fetch.mockRestore();
      if (b1.workers.length) await ownerQuery(`UPDATE public.projection_jobs SET state='failed',lease_owner=NULL,lease_until=NULL,
        completed_at=clock_timestamp() WHERE job_key=$1 AND lease_owner=ANY($2::text[])`, [PUBLIC_INTAKE_JOB, b1.workers]);
    }
  }
  async function b1Direct(f: Fixture, options: { evidence?: boolean; count?: number; type?: number; payload?: JsonValue } = {}) {
    b1Reserve(1); const workFence = await fence(), attempt = await administration.beginRosterAttempt(f.mapping, randomUUID(), undefined, workFence);
    const evidence = options.evidence === false ? undefined : await population(f, options.count ?? 10, workFence, administration, options.type ?? 0);
    const input = await observation(f, options.payload ?? b1Roster()), submitted = writeInput(f, input, attempt, workFence, evidence);
    const result = await write(submitted); expect(result.officialStandings?.status).toBe('recorded');
    return { workFence, attempt, input, evidence, submitted, result, receipt: result.rosterAcceptance.receiptId };
  }
  it('B1 preserves fresh provenance corrections replay and stored legacy and shared reads', async () => {
    await b1Setup(); const [f] = b1.fixtures; const legacy = await b1Core(f);
    await b1Shared(async () => {
      // First shared INSERT must see its interner's same-statement parent.
      const first = await b1Core(f, false, true), second = await b1Core(f), correction = await b1Core(f, true);
      expect(first.rows[1].population_content_id).not.toBe(second.rows[1].population_content_id);
      expect(first.proof.observationId).toBe(second.proof.observationId);
      expect(first.proof.contentHash).toBe(second.proof.contentHash);
      expect(first.proof.provenance).not.toEqual(second.proof.provenance);
      expect(first.rows[1].evidence_hash).not.toBe(second.rows[1].evidence_hash);
      expect(correction.standing.teams[0].record.wins).toEqual({ state: 'known', value: 5, sourcePath: 'settings.wins' });
      await storedOnly(async (_database, store) => {
        expect(await read(f.mapping, legacy.ids[1], store)).toEqual(legacy.standing);
        expect(await read(f.mapping, first.ids[1], store)).toEqual(first.standing);
        expect(await read(f.mapping, second.ids[1], store)).toEqual(second.standing);
      });
      b1Reserve(1); const workFence = await fence();
      await administration.beginRosterAttempt(f.mapping, randomUUID(), undefined, workFence);
      expect(await administration.readOfficialStandings!(f.mapping)).toEqual({ status: 'unavailable', reason: 'latest_roster_attempt_has_no_capture' });
      expect(await read(f.mapping, first.ids[1])).toEqual(first.standing);
    });
  }, 120_000);
  it('B1 keeps null unproved and other-family population evidence inline', async () => {
    await b1Setup(); const f = b1.fixtures[1];
    await b1Shared(async () => {
      const missing = await b1Direct(f, { evidence: false });
      expect((await b1Receipts([missing.receipt]))[0]).toMatchObject({ population_storage_format: 'inline-v1',
        population_content_id: null, population_evidence: null, effective_population: null });
      expect((await read(f.mapping, missing.receipt)).coverage.population).toBe('unproved');
      const good = await b1Direct(f);
      expect((await b1Receipts([good.receipt]))[0].population_storage_format).toBe('shared-v1');
      const fallback = await b1Direct(f, { evidence: false }), [fallbackRow] = await b1Receipts([fallback.receipt]);
      expect(fallbackRow.population_storage_format).toBe('inline-v1'); expect(fallbackRow.population_content_id).toBeNull();
      expect(fallbackRow.expected_team_count).toBe(10); expect(fallbackRow.population_evidence).not.toBeNull();
      expect((await read(f.mapping, fallback.receipt)).coverage.population).toBe('unproved');
      const [time] = await connection.database.query(`SELECT (receipt.population_evidence->'provenance'->>'requestStartedAt')::timestamptz
        <attempt.reserved_at AS older FROM public.league_roster_capture_receipts receipt
        JOIN public.league_roster_resource_attempts attempt ON attempt.id=receipt.attempt_id WHERE receipt.id=$1`, [fallback.receipt]);
      expect(time.older).toBe(true);
      // A distinct configuration has exactly one receipt source, which is shared.
      // The explicit owner period attestation is synthetic and never a source date.
      const historical = await b1Direct(f, { type: 1 }), [historicalRow] = await b1Receipts([historical.receipt]);
      const [version] = await ownerQuery(`SELECT configuration_version_id FROM public.league_administration_contents WHERE id=$1`,
        [historicalRow.configuration_content_id]);
      const [generation] = await ownerQuery(`SELECT COALESCE(max(generation),0)::int AS value
        FROM public.league_configuration_activations WHERE league_season_id=$1 AND component='competition'`, [f.leagueSeasonId]);
      await ownerQuery(`SELECT public.activate_league_configuration_component($1::uuid,'competition','regular',
        1::smallint,18::smallint,'B1 synthetic local applicability attestation',$2::bigint)`, [version.configuration_version_id, generation.value]);
      b1Reserve(1); const workFence = await fence(), attempt = await administration.beginExactMatchupAttempt(f.mapping, 4, randomUUID(), workFence);
      const evidence = await population(f, 10, workFence), payload = b1Roster().map(row => ({
        roster_id: row.roster_id, matchup_id: Math.ceil(row.roster_id / 2), players: row.players, starters: row.starters, points: 100,
      }));
      const input = await observation(f, payload, 'matchups', 4);
      const result = await administration.recordObservation(input, workFence, f.mapping, undefined, undefined, undefined, { attempt, population: evidence });
      expect(result.matchupAcceptance?.status).toBe('accepted');
      const receipt = result.matchupAcceptance!.receiptId, [row] = await b1Receipts([receipt]);
      expect(row.population_storage_format).toBe('inline-v1'); expect(row.population_content_id).toBeNull();
      expect(row.effective_population).toEqual({ observationId: evidence.observationId, contentHash: evidence.contentHash, provenance: evidence.envelope.provenance });
      expect((await administration.readExactMatchupValues!(f.mapping, { nativeWeek: 4, matchupsReceiptId: receipt })).status).toBe('available');
      let retainedSource: unknown;
      const database: DatabaseClient = { enabled: true, query: async <Row extends DatabaseRow>(sql: string, parameters?: readonly unknown[], options?: DatabaseQueryOptions) => {
        const rows = await connection.database.query<Row>(sql, parameters, options);
        if (sql.includes('league-administration:read-exact-period-context')) {
          retainedSource = (rows[0].applicability_evidence as { competition: { source: { provenance: unknown } }[] }).competition[0].source.provenance;
        }
        return rows;
      } };
      const context = await createLeagueAdministrationStore(database).readExactPeriodContext!(f.mapping, { nativeWeek: 4, matchupsReceiptId: receipt });
      expect(context.status).toBe('available'); expect(retainedSource).toEqual(historical.evidence!.envelope.provenance);
      b1Reserve(1); const bracketAttempt = await administration.beginBracketAttempt!(f.mapping, 'losers_bracket', randomUUID(), workFence);
      const bracket = await administration.recordObservation(await observation(f, [], 'losers_bracket'), workFence, f.mapping,
        undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, { attempt: bracketAttempt });
      expect(bracket.bracketAcceptance?.status).toBe('accepted');
      expect((await b1Receipts([bracket.bracketAcceptance!.receiptId]))[0]).toMatchObject({
        population_storage_format: 'inline-v1', population_content_id: null, population_evidence: null });
    });
  }, 120_000);
  it('B1 rejects foreign bindings hash mismatches history mutation and unauthorized evidence access', async () => {
    await b1Setup();
    await b1Shared(async () => {
      const first = await b1Core(b1.fixtures[0]), other = await b1Core(b1.fixtures[1]);
      const receiptId = first.ids[1], headerId = first.rows[1].population_content_id;
      const before = await b1State();
      const alterations = [
        { population_content_id: other.rows[1].population_content_id }, { population_content_id: randomUUID() },
        { population_content_id: null }, { population_storage_format: 'inline-v1' }, { population_evidence: first.proof },
        { configuration_content_id: other.rows[1].configuration_content_id }, { expected_team_count: null },
        { configuration_content_id: null }, { configuration_content_id: first.rows[1].content_id },
        { attempt_id: first.rows[0].attempt_id },
        { provenance: { ...(first.rows[1].provenance as Record<string, unknown>), acquisition: null } },
      ];
      for (const alteration of alterations) await expect(connection.database.query(`SELECT public.roster_capture_population_evidence(
        jsonb_populate_record(NULL::public.league_roster_capture_receipts,to_jsonb(receipt)||$2::jsonb))
        FROM public.league_roster_capture_receipts receipt WHERE receipt.id=$1`, [receiptId, JSON.stringify(alteration)])).rejects.toThrow();
      expect(await connection.database.query('SELECT public.roster_capture_population_evidence(NULL::public.league_roster_capture_receipts) AS value')).toEqual([{ value: null }]);
      for (const sql of ['UPDATE public.league_roster_population_contents SET content_hash=content_hash WHERE id=$1',
        'DELETE FROM public.league_roster_population_contents WHERE id=$1',
        'UPDATE public.league_roster_capture_receipts SET population_content_id=population_content_id WHERE id=$1',
        'DELETE FROM public.league_roster_capture_receipts WHERE id=$1']) {
        await expect(ownerQuery(sql, [sql.includes('population_contents') ? headerId : receiptId])).rejects.toThrow(/immutable|history|append/iu);
      }
      const table = (await ownerQuery("SELECT 'public.league_roster_population_contents'::regclass::oid::int AS oid"))[0].oid;
      const functions = await ownerQuery(`SELECT oid::int,proname FROM pg_proc WHERE pronamespace='public'::regnamespace
        AND proname IN ('roster_capture_population_evidence','intern_roster_population_evidence','validate_roster_population_content') ORDER BY proname`);
      for (const role of ['runtime', 'account', 'auth'] as const) {
        const client = await createPinnedIntegrationDatabase(role);
        try {
          expect((await client.database.query('SELECT current_user,session_user'))[0]).toEqual({ current_user: 'league_one_' + role, session_user: 'league_one_' + role });
          expect(await client.database.query(`SELECT has_table_privilege(current_user,$1::oid,'SELECT') AS read,
            has_table_privilege(current_user,$1::oid,'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') AS write`, [table]))
            .toEqual([{ read: role === 'runtime', write: false }]);
          for (const fn of functions) expect(await client.database.query("SELECT has_function_privilege(current_user,$1::oid,'EXECUTE') AS execute", [fn.oid]))
            .toEqual([{ execute: role === 'runtime' && fn.proname === 'roster_capture_population_evidence' }]);
          for (const sql of ['INSERT INTO public.league_roster_population_contents DEFAULT VALUES',
            'UPDATE public.league_roster_population_contents SET content_hash=content_hash',
            'DELETE FROM public.league_roster_population_contents', 'TRUNCATE public.league_roster_population_contents']) {
            await expect(client.database.query(sql)).rejects.toThrow(/permission denied/iu);
          }
          if (role !== 'runtime') await expect(client.database.query('SELECT * FROM public.league_roster_population_contents LIMIT 1')).rejects.toThrow(/permission denied/iu);
        } finally { await client.close(); }
      }
      for (const fn of functions) expect((await ownerQuery(`SELECT COALESCE(bool_or(grant_entry.grantee=0 AND grant_entry.privilege_type='EXECUTE'),false) AS public_execute
        FROM pg_proc function CROSS JOIN LATERAL aclexplode(COALESCE(function.proacl,acldefault('f',function.proowner))) grant_entry
        WHERE function.oid=$1::oid`, [fn.oid]))[0].public_execute).toBe(false);
      const owner = await createPinnedIntegrationDatabase('owner');
      try {
        await owner.database.query('BEGIN');
        const orphan = randomUUID();
        await owner.database.query(`INSERT INTO public.league_roster_population_contents(league_season_id,source_mapping_revision_id,
          configuration_content_id,proof_version,content_hash,population_evidence,first_receipt_id)
          SELECT league_season_id,source_mapping_revision_id,configuration_content_id,proof_version,repeat('0',64),population_evidence,$2::uuid
          FROM public.league_roster_population_contents WHERE id=$1`, [headerId, orphan]);
        await expect(owner.database.query(`SELECT public.roster_capture_population_evidence(jsonb_populate_record(NULL::public.league_roster_capture_receipts,
          to_jsonb(receipt)||jsonb_build_object('population_content_id',bad.id)))
          FROM public.league_roster_capture_receipts receipt CROSS JOIN public.league_roster_population_contents bad
          WHERE receipt.id=$1 AND bad.first_receipt_id=$2`, [receiptId, orphan])).rejects.toThrow(/proof binding mismatch/iu);
      } finally { try { await owner.database.query('ROLLBACK'); } finally { await owner.close(); } }
      const deferred = await createPinnedIntegrationDatabase('owner');
      try {
        await deferred.database.query('BEGIN');
        await deferred.database.query(`INSERT INTO public.league_roster_population_contents(league_season_id,source_mapping_revision_id,
          configuration_content_id,proof_version,content_hash,population_evidence,first_receipt_id)
          SELECT league_season_id,source_mapping_revision_id,configuration_content_id,proof_version,repeat('1',64),population_evidence,$2::uuid
          FROM public.league_roster_population_contents WHERE id=$1`, [headerId, randomUUID()]);
        await expect(deferred.database.query('SET CONSTRAINTS roster_population_content_complete IMMEDIATE')).rejects.toMatchObject({ code: 'P0002' });
      } finally { try { await deferred.database.query('ROLLBACK'); } finally { await deferred.close(); } }
      const reader = await createPinnedIntegrationDatabase('runtime');
      try {
        await reader.database.query('BEGIN READ ONLY');
        expect(await reader.database.query('SELECT pg_current_xact_id_if_assigned() AS xid')).toEqual([{ xid: null }]);
        expect((await b1Receipts([receiptId], reader.database))[0].effective_population).toEqual(first.proof);
        expect(await reader.database.query('SELECT pg_current_xact_id_if_assigned() AS xid')).toEqual([{ xid: null }]);
      } finally { try { await reader.database.query('ROLLBACK'); } finally { await reader.close(); } }
      // Remove only the temporary candidate binding. The maintained receipt
      // lineage and FK/check guards remain active for actual INSERT rejection.
      await restoreB1Writer();
      for (const alteration of [ { configuration_content_id: null }, { expected_team_count: null },
        { configuration_content_id: first.rows[1].content_id }, { attempt_id: first.rows[0].attempt_id },
        { population_content_id: other.rows[1].population_content_id },
        { provenance: { ...(first.rows[1].provenance as Record<string, unknown>), acquisition: null } } ]) {
        const invalid = await createPinnedIntegrationDatabase('owner');
        try {
          await invalid.database.query('BEGIN');
          await expect(invalid.database.query(`INSERT INTO public.league_roster_capture_receipts
            SELECT (jsonb_populate_record(NULL::public.league_roster_capture_receipts,
              to_jsonb(receipt)||$2::jsonb||jsonb_build_object('id',$3::uuid))).*
            FROM public.league_roster_capture_receipts receipt WHERE receipt.id=$1`,
          [receiptId, JSON.stringify(alteration), randomUUID()])).rejects.toMatchObject({ code: 'P0001' });
        } finally { try { await invalid.database.query('ROLLBACK'); } finally { await invalid.close(); } }
      }
      expect(await b1State()).toEqual(before);
    });
  }, 120_000);
  it('B1 rolls back observed content waits after deadline or lease expiry', async () => {
    await b1Setup(); const f = b1.fixtures[0];
    await b1Shared(async () => {
      for (const expiry of ['deadline', 'lease'] as const) {
        const workFence = await fence(expiry === 'deadline' ? 4 : 20);
        if (expiry === 'lease') await ownerQuery("UPDATE public.projection_jobs SET lease_until=clock_timestamp()+interval '4 seconds' WHERE job_key=$1", [workFence.jobKey]);
        b1Reserve(1); const attempt = await administration.beginRosterAttempt(f.mapping, randomUUID(), undefined, workFence);
        const evidence = await population(f, 10, workFence), input = await observation(f, b1Roster(true));
        const blocker = await createPinnedIntegrationDatabase('owner'), writer = await createPinnedIntegrationDatabase('runtime');
        let open = false, pending: Promise<{ error?: unknown }> | undefined;
        try {
          const before = await b1State(), [blockerPid] = await blocker.database.query('SELECT pg_backend_pid() AS pid'),
            [writerPid] = await writer.database.query('SELECT pg_backend_pid() AS pid');
          await blocker.database.query('BEGIN'); open = true;
          await blocker.database.query('LOCK TABLE public.league_roster_population_contents IN SHARE MODE');
          pending = write(writeInput(f, input, attempt, workFence, evidence), writer.database).then(() => ({}), error => ({ error }));
          let blocked = false;
          for (let poll = 0; poll < 100; poll++) {
            const [row] = await blocker.database.query(`SELECT $1::int=ANY(pg_blocking_pids($2::int))
              AND EXISTS(SELECT 1 FROM pg_locks WHERE pid=$2::int
                AND relation='public.league_roster_population_contents'::regclass AND mode='RowExclusiveLock' AND NOT granted) AS blocked`,
            [blockerPid.pid, writerPid.pid]);
            if (row.blocked) { blocked = true; break; } await delay(20);
          }
          expect(blocked).toBe(true);
          await blocker.database.query(`SELECT pg_sleep(GREATEST(0,EXTRACT(EPOCH FROM
            (LEAST($1::timestamptz,(SELECT lease_until FROM public.projection_jobs WHERE job_key=$2))-clock_timestamp())))+0.025)`,
          [workFence.deadlineAt, workFence.jobKey]);
          await blocker.database.query('COMMIT'); open = false;
          expect(String((await pending).error)).toMatch(/fence.*(?:stale|expired)|deadline/iu);
          expect(await b1State()).toEqual(before);
          console.info('CP28_B1_FENCE ' + JSON.stringify({ expiry, wait: 'population table RowExclusiveLock', rejected: true, completeStateRollback: true }));
        } finally {
          try { if (open) await blocker.database.query('ROLLBACK'); }
          finally { try { await pending; } finally { try { await writer.close(); } finally { await blocker.close(); } } }
        }
      }
    });
  }, 60_000);
  it('B1 reuses one committed evidence winner across concurrent eligible receipts', async () => {
    await b1Setup(); const f = b1.fixtures[0];
    await b1Shared(async () => {
      const baseline = await b1Direct(f), workFence = await fence();
      b1Reserve(2); const attempts = await administration.beginRosterCapture(f.mapping, randomUUID(), randomUUID(), workFence);
      const evidence = await population(f, 10, workFence), input = await observation(f, b1Roster());
      const submitted = writeInput(f, input, attempts.players, workFence, evidence);
      const proof = { observationId: evidence.observationId, contentHash: evidence.contentHash, provenance: evidence.envelope.provenance };
      const owner = await createPinnedIntegrationDatabase('owner'), writer = await createPinnedIntegrationDatabase('runtime');
      let open = false, pending: Promise<{ result?: Awaited<ReturnType<typeof administration.recordObservation>>; error?: unknown }> | undefined;
      try {
        const [ownerPid] = await owner.database.query('SELECT pg_backend_pid() AS pid'),
          [writerPid] = await writer.database.query('SELECT pg_backend_pid() AS pid');
        await owner.database.query('BEGIN'); open = true;
        // Synthetic first receipt only. All actual INSERT/deferred guards run;
        // no acceptance/head is manufactured, and the waiter is restricted runtime.
        const [first] = await owner.database.query(`INSERT INTO public.league_roster_capture_receipts(attempt_id,content_id,
          legacy_observation_id,evidence_hash,provenance,configuration_content_id,population_evidence,expected_team_count,coverage)
          SELECT $2::uuid,content_id,legacy_observation_id,encode(digest(convert_to($3::jsonb::text,'UTF8'),'sha256'),'hex'),
            $4::jsonb,configuration_content_id,$5::jsonb,expected_team_count,coverage
          FROM public.league_roster_capture_receipts WHERE id=$1 RETURNING id,population_content_id`,
        [baseline.receipt, attempts.players.id, JSON.stringify(submitted), JSON.stringify(input.envelope.provenance), JSON.stringify(proof)]);
        pending = createLeagueAdministrationStore(writer.database).recordObservation(input, workFence, f.mapping,
          undefined, { attempt: attempts.managers, population: evidence }).then(result => ({ result }), error => ({ error }));
        let blocked = false;
        for (let poll = 0; poll < 100; poll++) {
          const [row] = await owner.database.query(`SELECT $1::int=ANY(pg_blocking_pids($2::int))
            AND EXISTS(SELECT 1 FROM pg_locks waiter JOIN pg_locks holder USING(transactionid)
              WHERE waiter.pid=$2::int AND holder.pid=$1::int AND waiter.locktype='transactionid'
                AND waiter.mode='ShareLock' AND NOT waiter.granted AND holder.granted)
            AND EXISTS(SELECT 1 FROM pg_locks WHERE pid=$2::int AND relation='public.league_roster_population_contents'::regclass
              AND mode='RowExclusiveLock' AND granted) AS blocked`, [ownerPid.pid, writerPid.pid]);
          if (row.blocked) { blocked = true; break; } await delay(20);
        }
        expect(blocked).toBe(true);
        await owner.database.query('COMMIT'); open = false;
        const settled = await pending; expect(settled.error).toBeUndefined(); const result = settled.result!;
        expect(result.teamManagerAcceptance?.status).toBe('accepted');
        const [firstRow, secondRow] = await b1Receipts([String(first.id), result.teamManagerAcceptance!.receiptId]);
        expect(firstRow.id).not.toBe(secondRow.id); expect(firstRow.population_content_id).toBe(secondRow.population_content_id);
        expect(firstRow.effective_population).toEqual(proof); expect(secondRow.effective_population).toEqual(proof);
        expect(await ownerQuery('SELECT 1 FROM public.league_roster_resource_acceptances WHERE receipt_id=$1', [first.id])).toEqual([]);
        console.info('CP28_B1_CONCURRENCY ' + JSON.stringify({ setup: 'synthetic owner first receipt through native guards; actual runtime second-policy writer',
          wait: 'population unique-key transactionid ShareLock', firstReceipt: first.id, secondReceipt: secondRow.id,
          sharedContent: first.population_content_id, sharedExactProof: true }));
      } finally {
        try { if (open) await owner.database.query('ROLLBACK'); }
        finally { try { await pending?.catch(() => undefined); } finally { try { await writer.close(); } finally { await owner.close(); } } }
      }
    });
  }, 60_000);
  async function b1Allocation() {
    return ownerQuery(`SELECT c.relname AS name,pg_relation_size(c.oid)::text AS heap,pg_indexes_size(c.oid)::text AS indexes,
      CASE WHEN c.reltoastrelid=0 THEN 0 ELSE pg_total_relation_size(c.reltoastrelid) END::text AS toast,
      (pg_total_relation_size(c.oid)-pg_relation_size(c.oid)-pg_indexes_size(c.oid)
        -CASE WHEN c.reltoastrelid=0 THEN 0 ELSE pg_total_relation_size(c.reltoastrelid) END)::text AS auxiliary,
      pg_total_relation_size(c.oid)::text AS total FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='public' AND c.relkind='r' ORDER BY c.relname`);
  }
  async function b1Tuples() {
    return ownerQuery(['league_roster_population_contents', 'league_roster_capture_receipts', 'league_roster_resource_attempts',
      'league_roster_resource_acceptances', 'league_roster_player_links', 'league_official_standings_captures'].map(table =>
      `SELECT '${table}' AS name,count(*)::int AS rows,COALESCE(sum(pg_column_size(t)),0)::text AS tuple_bytes FROM public.${table} t`).join(' UNION ALL '));
  }
  it('B1 measures matched witnessed cores while sharing only exact within-capture population evidence', async () => {
    await b1Setup();
    const measure = async (format: 'inline-v1' | 'shared-v1') => {
      const beforeWarm = { allocation: await b1Allocation(), tuples: await b1Tuples() };
      for (const f of b1.fixtures) await b1Core(f);
      const before = { allocation: await b1Allocation(), tuples: await b1Tuples() }, batches: unknown[] = [];
      const receipts = new Set<string>(), parents = new Set<string>(); let last: Awaited<ReturnType<typeof b1Core>> | undefined;
      for (let index = 0; index < 32; index++) {
        last = await b1Core(b1.fixtures[index % 2]);
        for (const id of last.ids) receipts.add(id);
        for (const row of last.rows.slice(1)) if (row.population_content_id !== null) parents.add(String(row.population_content_id));
        if ((index + 1) % 8 === 0) batches.push({ cores: index + 1, allocation: await b1Allocation(), tuples: await b1Tuples() });
      }
      expect(receipts.size).toBe(128); expect(parents.size).toBe(format === 'shared-v1' ? 32 : 0);
      const after = { allocation: await b1Allocation(), tuples: await b1Tuples() };
      for (const table of ['league_roster_capture_receipts', 'league_roster_resource_attempts', 'league_roster_resource_acceptances']) {
        expect(Number(after.tuples.find(row => row.name === table)!.rows) - Number(before.tuples.find(row => row.name === table)!.rows)).toBe(128);
      }
      expect(Number(after.tuples.find(row => row.name === 'league_roster_population_contents')!.rows)
        - Number(before.tuples.find(row => row.name === 'league_roster_population_contents')!.rows)).toBe(format === 'shared-v1' ? 32 : 0);
      expect(Number(after.tuples.find(row => row.name === 'league_roster_player_links')!.rows)
        - Number(before.tuples.find(row => row.name === 'league_roster_player_links')!.rows)).toBe(32 * 80);
      let queries = 0;
      const timed: DatabaseClient = { enabled: true, query: async <Row extends DatabaseRow>(sql: string, parameters?: readonly unknown[], options?: DatabaseQueryOptions) => {
        queries++; expect(sql).not.toMatch(/\b(?:INSERT|UPDATE|DELETE|CALL)\b/iu);
        return connection.database.query<Row>(sql, parameters, options);
      } };
      const start = performance.now();
      expect(await read(b1.fixtures[1].mapping, last!.ids[1], createLeagueAdministrationStore(timed))).toEqual(last!.standing);
      expect(queries).toBe(1);
      return { format, beforeWarm, before, after, batches, reader: { elapsedMs: performance.now() - start, queries, teams: 10 } };
    };
    const legacy = await measure('inline-v1'), shared = await b1Shared(() => measure('shared-v1'));
    const delta = (phase: typeof legacy, tables?: readonly string[]) => phase.after.allocation.reduce((sum, row) =>
      sum + (!tables || tables.includes(String(row.name)) ? Number(row.total) - Number(phase.before.allocation.find(old => old.name === row.name)!.total) : 0), 0);
    const affected = ['league_roster_capture_receipts', 'league_roster_population_contents'];
    // Page allocation may step unevenly; retain measured deltas without a
    // synthetic lower-page assertion or extrapolation to the retained horizon.
    console.info('CP28_B1_ALLOCATION ' + JSON.stringify({ kind: 'local-native-witnessed-core-b1-v1',
      leagues: 2, teams: 20, heldAcrossLeagues: 160, heldPerCore: 80, catalogRows: 80,
      measuredCoresPerLayout: 32, warmCoresPerLayout: 2, attemptsPerCore: 4, receiptsPerCore: 4,
      eligiblePopulationReceiptsPerCore: 3, sharedParentsPerFreshCore: 1, sliceA: 'legacy default',
      legacy, shared, affectedAllocatedBytes: { legacy: delta(legacy, affected), shared: delta(shared, affected) },
      allPublicAllocatedBytes: { legacy: delta(legacy), shared: delta(shared) },
      reservedAttempts: b1.attempts, witnessedCores: b1.cores,
      limitations: ['synthetic prerequisites/admission/jobs; no cadence qualification', 'one local reader call per layout; no SLO',
        'no combined A+B measurement', 'no whole-horizon or 10-GiB capacity qualification'] }));
    expect(b1.attempts).toBeLessThanOrEqual(353);
  }, 300_000);

  // Separately selected combined proof. Original fourteen cases retain their
  // defaults; the full profile is not qualified by this bounded local subset.
  type ABMode = 'legacy' | 'A' | 'B1' | 'AB';
  type ABLinks = Extract<RosterPlayerLinksRead, { status: 'available' }>;
  const ab = { mode: 'legacy' as ABMode, touched: false, boundaries: [] as unknown[], saved: [] as {
    fixture: Fixture; ids: string[]; standing: AvailableStandings; links: ABLinks; digest: readonly DatabaseRow[];
  }[] };
  const abHasA = (mode: ABMode) => mode === 'A' || mode === 'AB';
  const abHasB = (mode: ABMode) => mode === 'B1' || mode === 'AB';
  async function abVerifyMode(mode: ABMode) {
    const actual = await ownerQuery(`SELECT c.relname AS table_name,p.proname AS function_name,t.tgname AS trigger_name,
      t.tgtype::int AS event_type,t.tgenabled::text AS enabled,
      c.relnamespace='public'::regnamespace AND p.pronamespace='public'::regnamespace AS public_identity,
      t.tgnargs=0 AND t.tgqual IS NULL AS unconditional_no_arguments FROM pg_trigger t
      JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_proc p ON p.oid=t.tgfoid
      WHERE NOT t.tgisinternal AND (t.tgname IN ('roster_player_links_after_acceptance','roster_population_intern_before_lineage')
        OR t.tgfoid IN ('public.capture_roster_player_links()'::regprocedure,
          'public.capture_roster_player_links_shared()'::regprocedure,'public.intern_roster_population_evidence()'::regprocedure))
      ORDER BY c.relname,t.tgname`);
    const expected = [{ table_name: 'league_roster_resource_acceptances',
      function_name: abHasA(mode) ? 'capture_roster_player_links_shared' : 'capture_roster_player_links',
      trigger_name: 'roster_player_links_after_acceptance', event_type: 5, enabled: 'O',
      public_identity: true, unconditional_no_arguments: true }];
    if (abHasB(mode)) expected.unshift({ table_name: 'league_roster_capture_receipts', function_name: 'intern_roster_population_evidence',
      trigger_name: 'roster_population_intern_before_lineage', event_type: 7, enabled: 'O',
      public_identity: true, unconditional_no_arguments: true });
    expect(actual).toEqual(expected); return actual;
  }
  async function abSetMode(mode: ABMode) {
    await abVerifyMode(ab.mode); ab.touched = true;
    const owner = await createPinnedIntegrationDatabase('owner');
    try {
      await owner.database.query('BEGIN');
      await owner.database.query(`
      DROP TRIGGER roster_player_links_after_acceptance ON public.league_roster_resource_acceptances;
      CREATE TRIGGER roster_player_links_after_acceptance AFTER INSERT ON public.league_roster_resource_acceptances
        FOR EACH ROW EXECUTE FUNCTION public.${abHasA(mode) ? 'capture_roster_player_links_shared' : 'capture_roster_player_links'}();
      DROP TRIGGER IF EXISTS roster_population_intern_before_lineage ON public.league_roster_capture_receipts;
      ${abHasB(mode) ? 'CREATE TRIGGER roster_population_intern_before_lineage BEFORE INSERT ON public.league_roster_capture_receipts FOR EACH ROW EXECUTE FUNCTION public.intern_roster_population_evidence();' : ''}`);
      await owner.database.query('COMMIT'); ab.mode = mode; b1.bound = abHasB(mode);
    } catch (error) {
      await owner.database.query('ROLLBACK').catch(() => undefined); throw error;
    } finally { await owner.close(); }
    await abVerifyMode(mode);
  }
  async function restoreABWriter() {
    if (!ab.touched) return;
    await abSetMode('legacy'); ab.touched = false;
  }
  async function abMode<T>(mode: ABMode, body: () => Promise<T>) {
    try { await abSetMode(mode); return await body(); } finally { await restoreABWriter(); }
  }
  async function abState(database = connection.database) {
    const tables = ['league_roster_resource_attempts', 'league_roster_player_link_contents',
      'league_roster_player_link_content_entries', 'scoring_entities', 'external_scoring_entity_ids',
      'league_administration_observation_mappings', 'league_configuration_versions',
      'league_configuration_activations', 'league_configuration_heads'];
    return [...await b1State(database), ...await database.query(tables.map(table =>
      `SELECT '${table}' AS name,count(*)::int AS rows,
        md5(COALESCE(string_agg(to_jsonb(t)::text,'' ORDER BY to_jsonb(t)::text),'')) AS digest FROM public.${table} t`).join(' UNION ALL '))];
  }
  async function abLinks(f: Fixture, receipt: string, store = administration): Promise<ABLinks> {
    const value = await store.readRosterPlayerLinks({ leagueSeasonId: f.leagueSeasonId, rosterReceiptId: receipt });
    expect(value.status).toBe('available'); if (value.status !== 'available') throw new Error('Combined stored links unavailable.');
    return value;
  }
  async function abLinkStorage(receipt: string, database = connection.database) {
    const [row] = await database.query('SELECT * FROM public.league_roster_player_link_receipts WHERE roster_receipt_id=$1', [receipt]);
    expect(row).toBeDefined(); return row;
  }
  async function abReceiptDigest(ids: readonly string[]) {
    return connection.database.query(`WITH receipts AS (SELECT * FROM public.league_roster_capture_receipts WHERE id=ANY($1::uuid[])),
      link_receipts AS (SELECT * FROM public.league_roster_player_link_receipts WHERE roster_receipt_id=ANY($1::uuid[])),
      facts AS (
        SELECT 'receipts' AS kind,to_jsonb(r) AS value FROM receipts r
        UNION ALL SELECT 'attempts',to_jsonb(a) FROM public.league_roster_resource_attempts a WHERE id IN (SELECT attempt_id FROM receipts)
        UNION ALL SELECT 'acceptances',to_jsonb(a) FROM public.league_roster_resource_acceptances a WHERE receipt_id=ANY($1::uuid[])
        UNION ALL SELECT 'link_receipts',to_jsonb(r) FROM link_receipts r
        UNION ALL SELECT 'legacy_links',to_jsonb(l) FROM public.league_roster_player_links l WHERE roster_acceptance_id IN (SELECT roster_acceptance_id FROM link_receipts)
        UNION ALL SELECT 'link_contents',to_jsonb(c) FROM public.league_roster_player_link_contents c WHERE id IN (SELECT link_content_id FROM link_receipts)
        UNION ALL SELECT 'link_entries',to_jsonb(e) FROM public.league_roster_player_link_content_entries e WHERE content_id IN (SELECT link_content_id FROM link_receipts)
        UNION ALL SELECT 'population_contents',to_jsonb(c) FROM public.league_roster_population_contents c WHERE id IN (SELECT population_content_id FROM receipts))
      SELECT kind,count(*)::int AS rows,md5(string_agg(value::text,'' ORDER BY value::text)) AS digest FROM facts GROUP BY kind ORDER BY kind`, [ids]);
  }
  async function abCore(f: Fixture, options: { score?: boolean; membership?: boolean; replay?: boolean } = {}) {
    const roster = b1Roster(options.score);
    if (options.membership) {
      [roster[0].players[1], roster[1].players[1]] = [roster[1].players[1], roster[0].players[1]];
    }
    const value = await b1Core(f, options.score, options.replay, {
      linkFormat: abHasA(ab.mode) ? 'shared-v1' : 'acceptance-v1', roster, state: abState,
    });
    const links = await abLinks(f, value.ids[1]), storage = await abLinkStorage(value.ids[1]);
    return { ...value, links, storage };
  }
  async function abRemember(f: Fixture, value: Awaited<ReturnType<typeof abCore>>) {
    ab.saved.push({ fixture: f, ids: value.ids, standing: value.standing, links: value.links, digest: await abReceiptDigest(value.ids) });
  }
  async function abCheckHistory() {
    await storedOnly(async (_database, store) => {
      for (const saved of ab.saved) {
        expect(await read(saved.fixture.mapping, saved.ids[1], store)).toEqual(saved.standing);
        expect(await abLinks(saved.fixture, saved.ids[1], store)).toEqual(saved.links);
        expect(await abReceiptDigest(saved.ids)).toEqual(saved.digest);
      }
    });
  }
  it('AB preserves four-mode history fresh proofs corrections return and exact replay', async () => {
    ab.boundaries.push(await abSnapshot('empty-migrated-schema'));
    await b1Setup();
    ab.boundaries.push(await abSnapshot('synthetic-prerequisites'));
    let original: Awaited<ReturnType<typeof abCore>> | undefined;
    for (const mode of ['legacy', 'A', 'B1', 'AB'] as const) {
      await abMode(mode, async () => {
        const modeRows: Awaited<ReturnType<typeof abCore>>[] = [];
        for (const f of b1.fixtures) {
          const value = await abCore(f, { replay: mode === 'AB' && f === b1.fixtures[0] });
          await abRemember(f, value); modeRows.push(value);
          if (mode === 'AB' && f === b1.fixtures[0]) original = value;
        }
        if (abHasA(mode)) expect(modeRows[0].storage.link_content_id).not.toBe(modeRows[1].storage.link_content_id);
        if (abHasB(mode)) expect(modeRows[0].rows[1].population_content_id).not.toBe(modeRows[1].rows[1].population_content_id);
        await abCheckHistory();
        ab.boundaries.push(await abSnapshot('semantic-' + mode));
      });
      await abVerifyMode('legacy'); await abCheckHistory();
    }
    await abMode('AB', async () => {
      const f = b1.fixtures[0], unchanged = await abCore(f);
      ab.boundaries.push(await abSnapshot('unchanged'));
      const score = await abCore(f, { score: true }); ab.boundaries.push(await abSnapshot('score-only-correction'));
      const membership = await abCore(f, { membership: true }); ab.boundaries.push(await abSnapshot('membership-correction'));
      const returned = await abCore(f); ab.boundaries.push(await abSnapshot('return-to-original'));
      expect(original).toBeDefined();
      for (const value of [unchanged, score, returned]) {
        expect(value.storage.link_content_id).toBe(original!.storage.link_content_id);
        expect(value.links.links).toEqual(original!.links.links);
      }
      expect(score.standing.teams[0].record.wins).toEqual({ state: 'known', value: 5, sourcePath: 'settings.wins' });
      expect(membership.storage.link_content_id).not.toBe(original!.storage.link_content_id);
      expect(membership.links.links).not.toEqual(original!.links.links);
      const values = [original!, unchanged, score, membership, returned];
      expect(new Set(values.map(value => value.rows[1].population_content_id)).size).toBe(5);
      expect(new Set(values.map(value => JSON.stringify(value.proof.provenance))).size).toBe(5);
      for (const value of [unchanged, score, membership, returned]) await abRemember(f, value);
      expect(await administration.readRosterPlayerLinks({ leagueSeasonId: b1.fixtures[1].leagueSeasonId,
        rosterReceiptId: original!.ids[1] })).toMatchObject({ status: 'missing' });
      await abCheckHistory();
    });
    await abVerifyMode('legacy'); await abCheckHistory();
    console.info('CP28_AB_SEMANTICS ' + JSON.stringify({ modes: ['legacy', 'A', 'B1', 'AB'], witnessedCores: b1.cores,
      reservations: b1.attempts, historicalReceipts: ab.saved.length * 4, exactHistoryAndDigests: true,
      scoreOnlyAndReturnReuseA: true, freshPopulationEveryCore: true, exactReplayBeforeAck: true, restoredLegacy: true }));
  }, 180_000);
  it('AB rolls back both histories after downstream expiry and serializes actual runtime writers', async () => {
    await b1Setup(); const f = b1.fixtures[0];
    await abMode('AB', async () => {
      const canonical = ab.saved.find(saved => saved.fixture === f)!.links.links.find(link => link.nativePlayerId === b1Players[0])!.canonicalEntityId;
      for (const expiry of ['deadline', 'lease'] as const) {
        const blocker = await createPinnedIntegrationDatabase('owner'), writer = await createPinnedIntegrationDatabase('runtime');
        let open = false, pending: Promise<{ error?: unknown }> | undefined;
        let lastPredicate: DatabaseRow | undefined, fenceStartedAt: number | undefined, writeStartedAt: number | undefined;
        try {
          // Connections and backend identity checks precede the new original
          // four-second deadline/lease. No reserved timestamp is extended.
          const [blockerPid] = await blocker.database.query('SELECT pg_backend_pid() AS pid'),
            [writerPid] = await writer.database.query('SELECT pg_backend_pid() AS pid');
          fenceStartedAt = performance.now();
          const workFence = await fence(expiry === 'deadline' ? 4 : 20);
          if (expiry === 'lease') await ownerQuery("UPDATE public.projection_jobs SET lease_until=clock_timestamp()+interval '4 seconds' WHERE job_key=$1", [workFence.jobKey]);
          b1Reserve(1); const attempt = await administration.beginRosterAttempt(f.mapping, randomUUID(), undefined, workFence);
          const evidence = await population(f, 10, workFence), payload = b1Roster();
          payload[0].players.reverse(); payload[0].starters = [];
          const input = await observation(f, payload), proof = { observationId: evidence.observationId,
            contentHash: evidence.contentHash, provenance: evidence.envelope.provenance };
          const [absent] = await connection.database.query(`SELECT NOT EXISTS(SELECT 1 FROM public.league_roster_population_contents
            WHERE league_season_id=$1 AND source_mapping_revision_id=$2
              AND content_hash=encode(digest(convert_to($3::jsonb::text,'UTF8'),'sha256'),'hex')) AS absent`,
          [f.leagueSeasonId, f.mapping.revisionId, JSON.stringify(proof)]);
          expect(absent.absent).toBe(true);
          const before = await abState(), prior = await administration.readAcceptedCurrentRoster(f.mapping, { includePlayerLinks: true }),
            baselineReadyAt = performance.now();
          await blocker.database.query('BEGIN'); open = true;
          await blocker.database.query('SELECT id FROM public.scoring_entities WHERE id=$1 FOR UPDATE', [canonical]);
          writeStartedAt = performance.now();
          pending = administrationFor(writer.database).recordObservation(input, workFence, f.mapping, { attempt, population: evidence })
            .then(() => ({}), error => ({ error }));
          let observed: DatabaseRow | undefined;
          for (let poll = 0; poll < 100; poll++) {
            const [row] = await blocker.database.query(`SELECT
              $1::int=ANY(pg_blocking_pids($2::int)) AS blocked,
              EXISTS(SELECT 1 FROM pg_locks WHERE pid=$2::int AND locktype='transactionid' AND mode='ShareLock' AND NOT granted) AS transaction_wait,
              EXISTS(SELECT 1 FROM pg_locks WHERE pid=$2::int AND relation='public.league_roster_population_contents'::regclass AND mode='RowExclusiveLock' AND granted) AS population_insert_attempted,
              EXISTS(SELECT 1 FROM pg_locks WHERE pid=$2::int AND relation='public.scoring_entities'::regclass AND mode='RowExclusiveLock' AND granted) AS identity_write_attempted,
              EXISTS(SELECT 1 FROM pg_locks WHERE pid=$2::int AND relation='public.league_roster_resource_acceptances'::regclass AND mode='RowExclusiveLock' AND granted) AS acceptance_insert_attempted`,
            [blockerPid.pid, writerPid.pid]);
            lastPredicate = row;
            if (Object.values(row).every(value => value === true)) { observed = row; break; } await delay(20);
          }
          expect(observed).toBeDefined();
          await blocker.database.query(`SELECT pg_sleep(GREATEST(0,EXTRACT(EPOCH FROM
            (LEAST($1::timestamptz,(SELECT lease_until FROM public.projection_jobs WHERE job_key=$2))-clock_timestamp())))+0.025)`,
          [workFence.deadlineAt, workFence.jobKey]);
          await blocker.database.query('COMMIT'); open = false;
          expect(String((await pending).error)).toMatch(/fence.*(?:stale|expired)|deadline/iu);
          expect(await abState()).toEqual(before);
          expect(await administration.readAcceptedCurrentRoster(f.mapping, { includePlayerLinks: true })).toEqual(prior);
          console.info('CP28_AB_FENCE ' + JSON.stringify({ expiry, observed, freshPopulationKeyPreviouslyAbsent: true,
            blocker: 'scoring_entities row FOR UPDATE', evidence: 'B parent insertion attempted before A-stage wait; uncommitted parent not externally read',
            rejected: true, scopedStateRollback: true, checkedTables: before.map(row => row.name),
            timing: { baselineMs: baselineReadyAt - fenceStartedAt, setupBeforeWriteMs: writeStartedAt - fenceStartedAt,
              totalMs: performance.now() - fenceStartedAt } }));
        } catch (error) {
          // Release only the owned blocker, then retain safe diagnostics. Error
          // text/SQL/parameters are deliberately excluded from this fixture log.
          if (open) { await blocker.database.query('ROLLBACK'); open = false; }
          const settled = await pending;
          const failure = settled?.error as { name?: unknown; code?: unknown } | undefined;
          console.info('CP28_AB_FENCE_DIAGNOSTIC ' + JSON.stringify({ expiry, lastPredicate,
            elapsedMs: fenceStartedAt === undefined ? null : performance.now() - fenceStartedAt,
            setupBeforeWriteMs: writeStartedAt === undefined || fenceStartedAt === undefined ? null : writeStartedAt - fenceStartedAt,
            pendingError: failure ? { name: String(failure.name), code: String(failure.code) } : null }));
          throw error;
        } finally {
          try { if (open) await blocker.database.query('ROLLBACK'); }
          finally { try { await pending; } finally { try { await writer.close(); } finally { await blocker.close(); } } }
        }
      }
      const first = await createPinnedIntegrationDatabase('runtime'), second = await createPinnedIntegrationDatabase('runtime'),
        firstFence = await fence(), secondFence = await fence();
      let open = false, pending: Promise<{ result?: Awaited<ReturnType<typeof administration.recordObservation>>; error?: unknown }> | undefined;
      let lastWait: DatabaseRow | undefined;
      try {
        b1Reserve(2); const firstStore = administrationFor(first.database), secondStore = administrationFor(second.database), payload = b1Roster();
        payload[2].players.reverse(); payload[2].starters = [];
        await first.database.query('BEGIN'); open = true;
        const firstAttempt = await firstStore.beginRosterAttempt(f.mapping, randomUUID(), undefined, firstFence);
        const firstPopulation = await population(f, 10, firstFence, firstStore);
        const firstResult = await firstStore.recordObservation(await observation(f, payload), firstFence, f.mapping,
          { attempt: firstAttempt, population: firstPopulation });
        expect(firstResult.rosterAcceptance?.status).toBe('accepted');
        const firstId = firstResult.rosterAcceptance!.receiptId, firstLinks = await abLinks(f, firstId, firstStore),
          firstStorage = await abLinkStorage(firstId, first.database), [firstRow] = await b1Receipts([firstId], first.database);
        expect(firstRow.population_storage_format).toBe('shared-v1'); expect(firstStorage.storage_format).toBe('shared-v1');
        const [firstPid] = await first.database.query('SELECT pg_backend_pid() AS pid'), [secondPid] = await second.database.query('SELECT pg_backend_pid() AS pid');
        pending = (async () => {
          const attempt = await secondStore.beginRosterAttempt(f.mapping, randomUUID(), undefined, secondFence);
          const freshPopulation = await population(f, 10, secondFence, secondStore);
          return secondStore.recordObservation(await observation(f, payload), secondFence, f.mapping, { attempt, population: freshPopulation });
        })().then(result => ({ result }), error => ({ error }));
        let observed: DatabaseRow | undefined;
        for (let poll = 0; poll < 100; poll++) {
          const [row] = await first.database.query(`WITH expected AS (
            SELECT hashtextextended('league-configuration:'||$3::uuid::text,0) AS key)
            SELECT $1::int=ANY(pg_blocking_pids($2::int)) AS blocked,
              EXISTS(SELECT 1 FROM pg_locks waiter JOIN pg_locks holder
                ON holder.locktype=waiter.locktype AND holder.database=waiter.database
                  AND holder.classid=waiter.classid AND holder.objid=waiter.objid AND holder.objsubid=waiter.objsubid
                CROSS JOIN expected
                WHERE waiter.pid=$2::int AND holder.pid=$1::int AND waiter.locktype='advisory'
                  AND waiter.mode='ExclusiveLock' AND NOT waiter.granted AND holder.mode='ExclusiveLock' AND holder.granted
                  AND waiter.database=(SELECT oid FROM pg_database WHERE datname=current_database())
                  AND waiter.classid::bigint=((expected.key>>32)&4294967295)
                  AND waiter.objid::bigint=(expected.key&4294967295) AND waiter.objsubid=1) AS mapping_lock,
              (SELECT COALESCE(jsonb_agg(to_jsonb(l)),'[]'::jsonb) FROM (
                SELECT locktype,mode,granted,classid::text,objid::text,objsubid FROM pg_locks
                  WHERE pid=$2::int AND NOT granted LIMIT 4) l) AS waiter_locks`, [firstPid.pid, secondPid.pid, f.leagueSeasonId]);
          lastWait = row;
          if (row.blocked === true && row.mapping_lock === true) { observed = row; break; } await delay(20);
        }
        expect(observed).toBeDefined(); await first.database.query('COMMIT'); open = false;
        const settled = await pending; expect(settled.error).toBeUndefined(); expect(settled.result?.rosterAcceptance?.status).toBe('accepted');
        const secondId = settled.result!.rosterAcceptance!.receiptId, secondStorage = await abLinkStorage(secondId),
          [secondRow] = await b1Receipts([secondId]);
        expect(secondId).not.toBe(firstId); expect(secondStorage.link_content_id).toBe(firstStorage.link_content_id);
        expect(secondRow.population_storage_format).toBe('shared-v1');
        expect(secondRow.population_content_id).not.toBe(firstRow.population_content_id);
        expect(secondRow.effective_population).not.toEqual(firstRow.effective_population);
        expect((await abLinks(f, secondId)).links).toEqual(firstLinks.links);
        expect(await abLinks(f, firstId)).toEqual(firstLinks);
        console.info('CP28_AB_CONCURRENCY ' + JSON.stringify({ setup: 'two actual restricted runtime roster writers with separate fresh population evidence',
          wait: 'league-mapping advisory serialization before resource head; not content unique-key contention', observed,
          distinctReceipts: true, sharedAContent: firstStorage.link_content_id, distinctBParents: true }));
      } catch (error) {
        if (open) { await first.database.query('ROLLBACK'); open = false; }
        const settled = await pending, failure = settled?.error as { name?: unknown; code?: unknown } | undefined;
        console.info('CP28_AB_CONCURRENCY_DIAGNOSTIC ' + JSON.stringify({ lastWait,
          pendingError: failure ? { name: String(failure.name), code: String(failure.code) } : null }));
        throw error;
      } finally {
        try { if (open) await first.database.query('ROLLBACK'); }
        finally { try { await pending; } finally { try { await second.close(); } finally { await first.close(); } } }
      }
      await abCheckHistory();
    });
    await abVerifyMode('legacy'); await abCheckHistory();
  }, 120_000);
  const administrationFor = (database: DatabaseClient) => createLeagueAdministrationStore(database);
  const abProofColumns = [
    ['league_roster_resource_attempts', 'source_mapping'], ['league_roster_resource_attempts', 'write_fence'],
    ['league_roster_capture_receipts', 'provenance'], ['league_roster_capture_receipts', 'population_evidence'],
    ['league_roster_capture_receipts', 'coverage'], ['league_roster_population_contents', 'population_evidence'],
    ['league_official_standings_captures', 'source_mapping'], ['league_official_standings_captures', 'reasons'],
    ['league_roster_player_link_receipts', 'reasons'],
    ...['league_roster_player_links', 'league_roster_player_link_content_entries'].flatMap(table =>
      ['mapping_proof', 'kind_evidence', 'reasons'].map(column => [table, column])),
  ];
  async function abSnapshot(boundary: string, expectedPublicRelations = 152, extraColumns: string[][] = []) {
    const inventory = await ownerQuery(`SELECT n.nspname AS schema,c.relname AS table FROM pg_class c
      JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN ('public','website_auth') AND c.relkind='r'
      ORDER BY n.nspname,c.relname`);
    expect(inventory.filter(row => row.schema === 'public')).toHaveLength(expectedPublicRelations);
    expect(inventory.filter(row => row.schema === 'website_auth')).toHaveLength(5);
    const relations = await ownerQuery<DatabaseRow & { schema: string; table: string; name: string; rows: number;
      tuplebytes: string; heap: string; indexes: string; toast: string; auxiliary: string; total: string }>(inventory.map(row => {
      expect(String(row.schema)).toMatch(/^[A-Za-z_][A-Za-z0-9_]*$/u); expect(String(row.table)).toMatch(/^[A-Za-z_][A-Za-z0-9_]*$/u);
      const name = row.schema + '.' + row.table, relation = '"' + row.schema + '"."' + row.table + '"';
      return `SELECT '${row.schema}' AS schema,'${row.table}' AS table,'${name}' AS name,
        count(*)::int AS rows,COALESCE(sum(pg_column_size(t)),0)::text AS tupleBytes,
        pg_relation_size('${relation}'::regclass)::text AS heap,pg_indexes_size('${relation}'::regclass)::text AS indexes,
        (SELECT CASE WHEN reltoastrelid=0 THEN 0 ELSE pg_total_relation_size(reltoastrelid) END FROM pg_class WHERE oid='${relation}'::regclass)::text AS toast,
        (pg_total_relation_size('${relation}'::regclass)-pg_relation_size('${relation}'::regclass)-pg_indexes_size('${relation}'::regclass)
          -(SELECT CASE WHEN reltoastrelid=0 THEN 0 ELSE pg_total_relation_size(reltoastrelid) END FROM pg_class WHERE oid='${relation}'::regclass))::text AS auxiliary,
        pg_total_relation_size('${relation}'::regclass)::text AS total FROM ${relation} t`;
    }).join(' UNION ALL '));
    const columns = await ownerQuery([...abProofColumns, ...extraColumns].map(([table, column]) => `SELECT 'public.${table}' AS name,'${column}' AS column,
      count(${column})::int AS nonnull,COALESCE(sum(pg_column_size(${column})),0)::text AS datumBytes,
      COALESCE(sum(octet_length(convert_to(${column}::text,'UTF8'))),0)::text AS jsonTextBytes FROM public.${table}`).join(' UNION ALL '));
    for (const row of relations) {
      for (const key of ['rows', 'tuplebytes', 'heap', 'indexes', 'toast', 'auxiliary', 'total']) {
        expect(Number.isSafeInteger(Number(row[key])) && Number(row[key]) >= 0).toBe(true);
      }
      expect(Number(row.total)).toBe(Number(row.heap) + Number(row.indexes) + Number(row.toast) + Number(row.auxiliary));
    }
    // SQL folds unquoted aliases; expose a stable explicit JSON spelling.
    return { boundary, mode: ab.mode, counters: { witnessedCores: b1.cores, resourceReservations: b1.attempts,
      syntheticCoreHttpResponses: b1.cores * 2 }, modeTriggers: await abVerifyMode(ab.mode),
      relations: relations.map(({ tuplebytes, ...row }) => ({ ...row, tupleBytes: tuplebytes })),
      columns: columns.map(({ datumbytes, jsontextbytes, ...row }) => ({ ...row, datumBytes: datumbytes, jsonTextBytes: jsontextbytes })) };
  }
  it('AB measures matched witnessed cores with combined lossless sharing and complete allocation attribution', async () => {
    await b1Setup(); await abCheckHistory();
    const measure = async (mode: 'legacy' | 'AB') => abMode(mode, async () => {
      const beforeWarm = await abSnapshot(mode + '-before-warm');
      for (const f of b1.fixtures) await abCore(f);
      const before = await abSnapshot(mode + '-measured-start'), batches: { cores: number; snapshot: Awaited<ReturnType<typeof abSnapshot>> }[] = [];
      const receipts = new Set<string>(), parents = new Set<string>(), links = new Set<string>();
      let last: Awaited<ReturnType<typeof abCore>> | undefined;
      for (let index = 0; index < 32; index++) {
        last = await abCore(b1.fixtures[index % 2]);
        for (const id of last.ids) receipts.add(id);
        for (const row of last.rows.slice(1)) if (row.population_content_id !== null) parents.add(String(row.population_content_id));
        if (last.storage.link_content_id !== null) links.add(String(last.storage.link_content_id));
        if ((index + 1) % 8 === 0) batches.push({ cores: index + 1, snapshot: await abSnapshot(mode + '-measured-' + (index + 1)) });
      }
      const after = batches.at(-1)!.snapshot;
      const rowDelta = (table: string) => Number(after.relations.find(row => row.name === 'public.' + table)!.rows)
        - Number(before.relations.find(row => row.name === 'public.' + table)!.rows);
      expect(receipts.size).toBe(128); expect(parents.size).toBe(mode === 'AB' ? 32 : 0); expect(links.size).toBe(mode === 'AB' ? 2 : 0);
      for (const table of ['league_roster_capture_receipts', 'league_roster_resource_attempts', 'league_roster_resource_acceptances']) expect(rowDelta(table)).toBe(128);
      expect(rowDelta('league_roster_population_contents')).toBe(mode === 'AB' ? 32 : 0);
      expect(rowDelta('league_roster_player_link_receipts')).toBe(32);
      expect(rowDelta('league_roster_player_links')).toBe(mode === 'AB' ? 0 : 2560);
      expect(rowDelta('league_roster_player_link_contents')).toBe(0);
      expect(rowDelta('league_roster_player_link_content_entries')).toBe(0);
      expect(rowDelta('league_official_standings_captures')).toBe(32);
      expect(after.relations.filter(row => row.schema === 'website_auth')).toEqual(beforeWarm.relations.filter(row => row.schema === 'website_auth'));
      let queries = 0;
      const database: DatabaseClient = { enabled: true, query: async <Row extends DatabaseRow>(sql: string, parameters?: readonly unknown[], options?: DatabaseQueryOptions) => {
        queries++; expect(sql).not.toMatch(/\b(?:INSERT|UPDATE|DELETE|CALL)\b/iu);
        return connection.database.query<Row>(sql, parameters, options);
      } };
      const reader = administrationFor(database), start = performance.now();
      expect(await read(b1.fixtures[1].mapping, last!.ids[1], reader)).toEqual(last!.standing);
      const standingsElapsedMs = performance.now() - start; expect(queries).toBe(1);
      const linksStart = performance.now(); expect(await abLinks(b1.fixtures[1], last!.ids[1], reader)).toEqual(last!.links);
      expect(queries).toBe(2); const linksElapsedMs = performance.now() - linksStart;
      await abCheckHistory();
      return { mode, beforeWarm, before, after, batches, historicalDigestChecksPassed: true,
        reader: { standingsElapsedMs, linksElapsedMs, standingsQueries: 1, linkQueries: 1, teams: 10, held: 80 } };
    });
    const legacy = await measure('legacy'), combined = await measure('AB');
    await abVerifyMode('legacy'); await abCheckHistory();
    const affected = ['league_roster_capture_receipts', 'league_roster_population_contents', 'league_roster_player_link_receipts',
      'league_roster_player_links', 'league_roster_player_link_contents', 'league_roster_player_link_content_entries'].map(table => 'public.' + table);
    const delta = (phase: typeof legacy, names?: readonly string[]) => phase.after.relations.reduce((sum, row) =>
      sum + (row.schema === 'public' && (!names || names.includes(String(row.name)))
        ? Number(row.total) - Number(phase.before.relations.find(old => old.name === row.name)!.total) : 0), 0);
    console.info('CP28_AB_ALLOCATION ' + JSON.stringify({ schemaVersion: 1, kind: 'local-native-witnessed-core-combined-ab-v1',
      fixture: { leagues: 2, teamsPerLeague: 10, teamsTotal: 20, heldPerCore: 80, heldAcrossLeagues: 160, uniqueCatalogPlayers: 80 },
      workload: { semanticCores: 12, warmCoresPerLayout: 2, measuredCoresPerLayout: 32, directRosterProbes: 4,
        attemptsPerCore: 4, receiptsPerCore: 4, acceptedStandingsPerCore: 1, eligiblePopulationReceiptsPerCore: 3 },
      semanticBoundaries: ab.boundaries, legacy, combined, affectedRelations: affected,
      affectedAllocatedBytes: { legacy: delta(legacy, affected), combined: delta(combined, affected) },
      allPublicAllocatedBytes: { legacy: delta(legacy), combined: delta(combined) },
      counters: { witnessedCores: b1.cores, resourceReservations: b1.attempts, syntheticCoreHttpResponses: b1.cores * 2 },
      historicalDigestChecksPassed: true, restoredLegacy: true, externalProviderCalls: 0,
      limitations: ['synthetic prerequisites/admission/jobs; no cadence qualification',
        'warmed sequential allocation; small page steps are not zero logical cost',
        'one local standings/link reader call per layout; no SLO',
        'proof-column datum/text diagnostics overlap whole-row tuple bytes and are not additive physical savings',
        'all-public includes synthetic controls and shared identities; classification required',
        '10 teams/80 held per core differs from original hosted20 teams/160 held per core',
        'selected three-case local proof only; full17-case profile remains unqualified',
        'no whole-horizon or 10-GiB capacity qualification'] }));
    expect(b1.cores).toBe(80); expect(b1.attempts).toBe(325);
    expect(delta(combined, affected)).toBeLessThan(delta(legacy, affected));
  }, 300_000);
  // B2 is an isolated opt-in extension. Earlier case bodies and helper defaults
  // retain their original behavior; all three candidate writers restore on exit.
  const b2 = { bound: false, touched: false, successfulCores: 0, expectedFailedCores: 0,
    boundaries: [] as unknown[], saved: [] as { fixture: Fixture; value: Awaited<ReturnType<typeof b2Core>>;
      digest: readonly DatabaseRow[] }[] };
  async function b2Verify(enabled: boolean) {
    const rows = await ownerQuery(`SELECT t.tgname AS name,t.tgtype::int AS event_type,t.tgenabled::text AS enabled,
      t.tgrelid='public.league_roster_capture_receipts'::regclass AS exact_table,
      t.tgfoid='public.intern_roster_capture_provenance()'::regprocedure AS exact_function,
      t.tgnargs=0 AND t.tgqual IS NULL AS unconditional_no_arguments FROM pg_trigger t
      WHERE NOT t.tgisinternal AND (t.tgname='roster_metadata_intern_before_lineage'
        OR t.tgfoid='public.intern_roster_capture_provenance()'::regprocedure) ORDER BY t.tgname`);
    expect(rows).toEqual(enabled ? [{ name: 'roster_metadata_intern_before_lineage', event_type: 7, enabled: 'O',
      exact_table: true, exact_function: true, unconditional_no_arguments: true }] : []);
    return rows;
  }
  async function b2Set(enabled: boolean) {
    await b2Verify(b2.bound); b2.touched = true;
    const owner = await createPinnedIntegrationDatabase('owner');
    try {
      await owner.database.query('BEGIN');
      await owner.database.query('DROP TRIGGER IF EXISTS roster_metadata_intern_before_lineage ON public.league_roster_capture_receipts');
      if (enabled) await owner.database.query(`CREATE TRIGGER roster_metadata_intern_before_lineage BEFORE INSERT
        ON public.league_roster_capture_receipts FOR EACH ROW EXECUTE FUNCTION public.intern_roster_capture_provenance()`);
      await owner.database.query('COMMIT'); b2.bound = enabled;
    } catch (error) { await owner.database.query('ROLLBACK').catch(() => undefined); throw error; }
    finally { await owner.close(); }
    await b2Verify(enabled);
  }
  async function restoreB2Writer() {
    if (!b2.touched) return;
    await b2Set(false); b2.touched = false;
  }
  async function b2Current(f: Fixture) {
    return { roster: await administration.readAcceptedCurrentRoster(f.mapping, { includePlayerLinks: true }),
      managers: await administration.readAcceptedTeamManagers(f.mapping),
      managersV2: await administration.readAcceptedTeamManagerEvidence!(f.mapping) };
  }
  async function b2Mode<T>(mode: ABMode, enabled: boolean, body: () => Promise<T>) {
    let currents: Awaited<ReturnType<typeof b2Current>>[] | undefined;
    try {
      await abSetMode(mode); await b2Set(enabled);
      const result = await body(); currents = await Promise.all(b1.fixtures.map(b2Current)); return result;
    } finally {
      try { await restoreB2Writer(); } finally { await restoreABWriter(); }
      if (currents) expect(await Promise.all(b1.fixtures.map(b2Current))).toEqual(currents);
    }
  }
  async function b2State(database = connection.database) {
    return [...await abState(database), ...await database.query(`SELECT 'league_roster_provenance_contents' AS name,
      count(*)::int AS rows,md5(COALESCE(string_agg(to_jsonb(t)::text,'' ORDER BY to_jsonb(t)::text),'')) AS digest
      FROM public.league_roster_provenance_contents t`)];
  }
  async function b2Digest(ids: readonly string[]) {
    return [...await abReceiptDigest(ids), ...await connection.database.query(`SELECT 'provenance_contents' AS kind,
      count(*)::int AS rows,md5(COALESCE(string_agg(to_jsonb(t)::text,'' ORDER BY to_jsonb(t)::text),'')) AS digest
      FROM public.league_roster_provenance_contents t WHERE id IN
        (SELECT provenance_content_id FROM public.league_roster_capture_receipts WHERE id=ANY($1::uuid[]))`, [ids])];
  }
  async function b2Public(f: Fixture, requestId: string) {
    let queries = 0;
    const database: DatabaseClient = { enabled: true, query: async <Row extends DatabaseRow>(sql: string,
      parameters?: readonly unknown[], options?: DatabaseQueryOptions) => {
      queries++; expect(sql).not.toMatch(/\b(?:INSERT|UPDATE|DELETE|CALL)\b/iu);
      return connection.database.query<Row>(sql, parameters, options);
    } };
    const result = await readPublicOfficialStandings(database, administrationFor(database), requestId, f.mapping);
    return { result, queries };
  }
  async function b2Occurrence(f: Fixture, origin: string) {
    const owner = await createPinnedIntegrationDatabase('owner');
    const requestId = randomUUID(), targetId = randomUUID(), resourceId = randomUUID();
    try {
      await owner.database.query('BEGIN');
      expect(await owner.database.query(`SELECT 1 AS valid FROM public.public_data_intakes request
        JOIN public.public_data_league_candidates candidate ON candidate.intake_id=request.id
        WHERE request.id=$1 AND request.resource_occurrence_id IS NULL AND candidate.league_season_id=$2`, [origin, f.leagueSeasonId])).toEqual([{ valid: 1 }]);
      await owner.database.query(`INSERT INTO public.public_data_refresh_targets(id,provider,source_manager_account_id,configuration_revision)
        SELECT $1,'sleeper',source_manager_account_id,1 FROM public.public_data_identity_observations WHERE intake_id=$2`, [targetId, origin]);
      await owner.database.query(`INSERT INTO public.public_data_refresh_configurations(target_id,revision,identity_request_id,seasons,
        cadence_seconds,expires_at,paused,exact_periods,transaction_history)
        VALUES($1,1,$2,ARRAY[2026],300,clock_timestamp()+interval '1 hour',false,
          '[{"season":2026,"nativeWeek":15}]'::jsonb,'sleeper-2026-transaction-history-v1')`, [targetId, origin]);
      await owner.database.query(`INSERT INTO public.public_data_resource_configurations(target_id,configuration_revision,active_periods)
        VALUES($1,1,jsonb_build_array(jsonb_build_object('season',2026,'externalLeagueId',$2::text,'nativeWeek',15)))`, [targetId, f.external]);
      await owner.database.query(`INSERT INTO public.public_data_resources(id,connection_id,mapping_revision_id,source_mapping,season,external_league_id,kind,native_week)
        VALUES($1,$2,$3,$4::jsonb,2026,$5,'core',0)`, [resourceId, f.mapping.connectionId, f.mapping.revisionId, JSON.stringify(f.mapping), f.external]);
      await owner.database.query(`INSERT INTO public.public_data_resource_authorities(resource_id,target_id,configuration_revision,origin_intake_id,season,external_league_id,active_native_week)
        VALUES($1,$2,1,$3,2026,$4,15)`, [resourceId, targetId, origin, f.external]);
      await owner.database.query(`INSERT INTO public.public_data_resource_occurrences(id,resource_id,origin_intake_id,season,external_league_id,target_id,configuration_revision,source_mapping)
        VALUES($1,$2,$3,2026,$4,$5,1,$6::jsonb)`, [requestId, resourceId, origin, f.external, targetId, JSON.stringify(f.mapping)]);
      await owner.database.query(`INSERT INTO public.public_data_intakes(id,username,seasons,exact_periods,transaction_period,resource_occurrence_id)
        SELECT $1,username,ARRAY[2026],'[]'::jsonb,NULL,$1 FROM public.public_data_intakes WHERE id=$2`, [requestId, origin]);
      await owner.database.query(`INSERT INTO public.public_data_identity_observations(intake_id,source_manager_account_id,username,display_name,avatar_url,payload,request_started_at,request_completed_at)
        SELECT $1,source_manager_account_id,username,display_name,avatar_url,
          jsonb_build_object('inheritedFromIntakeId',$2::uuid,'resourceOccurrenceId',$1::uuid),request_started_at,request_completed_at
        FROM public.public_data_identity_observations WHERE intake_id=$2`, [requestId, origin]);
      await owner.database.query(`INSERT INTO public.public_data_league_lists(intake_id,season,payload,request_started_at,request_completed_at)
        SELECT $1,season,'[]'::jsonb,request_started_at,request_completed_at FROM public.public_data_league_lists WHERE intake_id=$2 AND season=2026`, [requestId, origin]);
      await owner.database.query(`INSERT INTO public.public_data_league_candidates(intake_id,season,external_league_id,name,stage,league_season_id,bootstrap_started_at,bootstrap_completed_at)
        SELECT $1,season,external_league_id,name,'core',league_season_id,bootstrap_started_at,bootstrap_completed_at
        FROM public.public_data_league_candidates WHERE intake_id=$2 AND league_season_id=$3`, [requestId, origin, f.leagueSeasonId]);
      await owner.database.query('UPDATE public.public_data_resources SET open_intake_id=$2 WHERE id=$1', [resourceId, requestId]);
      await owner.database.query('COMMIT');
    } catch (error) { await owner.database.query('ROLLBACK').catch(() => undefined); throw error; }
    finally { await owner.close(); }
    return { requestId, resourceId, targetId };
  }
  async function b2Core(f: Fixture, options: { score?: boolean; replay?: boolean; occurrenceOrigin?: string;
    intercept?: (args: B1Write['args']) => Promise<B1Write['result']>; expectedFailure?: () => boolean } = {}) {
    const occurrence = options.occurrenceOrigin ? await b2Occurrence(f, options.occurrenceOrigin) : undefined;
    const value = await b1Core(f, options.score, options.replay, { occurrence, linkFormat: abHasA(ab.mode) ? 'shared-v1' : 'acceptance-v1',
      roster: b1Roster(options.score), state: b2State, provenance: true,
      intercept: options.intercept, expectedFailure: options.expectedFailure });
    const expected = value.written[1].args[0].envelope.provenance;
    const [settlement] = await connection.database.query(`SELECT outcome.outcome,
      dispatch.request_budget_policy, outcome.settled_request_upper_bound_at IS NOT NULL
        AND outcome.settled_request_upper_bound_at>=dispatch.admitted_at
        AND outcome.settled_request_upper_bound_at<=outcome.recorded_at AS bounded
      FROM public.public_data_dispatches dispatch JOIN public.public_data_dispatch_outcomes outcome
        ON outcome.worker_id=dispatch.worker_id AND outcome.generation=dispatch.generation WHERE dispatch.intake_id=$1`, [value.requestId]);
    expect(settlement).toEqual({ outcome: 'checkpoint-committed', request_budget_policy: 'public-data-settled-request-budget-v1', bounded: true });
    expect(value.rows[0]).toMatchObject({ provenance_storage_format: 'inline-v1', provenance_content_id: null });
    expect(value.rows[0].effective_provenance).toEqual(value.written[0].args[0].envelope.provenance);
    for (const row of value.rows.slice(1)) {
      expect(row.provenance_storage_format).toBe(b2.bound ? 'shared-v1' : 'inline-v1');
      expect(row.provenance).toEqual(b2.bound ? null : expected); expect(row.effective_provenance).toEqual(expected);
      expect(row.provenance_content_id === null).toBe(!b2.bound);
      const attempt = row.attempt as Record<string, unknown>;
      expect(attempt.source_mapping).toEqual(f.mapping); expect(attempt.write_fence).toEqual(value.written[1].args[1]);
    }
    if (b2.bound) expect(new Set(value.rows.slice(1).map(row => row.provenance_content_id)).size).toBe(1);
    const links = await abLinks(f, value.ids[1]), storage = await abLinkStorage(value.ids[1]), publicRead = await b2Public(f, value.requestId);
    expect(publicRead.result.resource).toEqual(value.standing); expect(publicRead.queries).toBe(2);
    const current = await b2Current(f);
    for (const result of Object.values(current)) expect(result.status).toBe('available');
    if (occurrence) {
      const [reconciled] = await connection.database.query(`SELECT last_success_receipt_id,
        last_success_at=$2::timestamptz AS original_observation_time,due_at=$2::timestamptz+interval '4 minutes' AS original_due,
        open_intake_id IS NULL AS closed,failure_count,public.next_public_data_intake($3::uuid) AS next
        FROM public.public_data_resources WHERE id=$1`, [occurrence.resourceId, expected.sourceObservedAt, value.requestId]);
      expect(reconciled).toEqual({ last_success_receipt_id: value.ids[1], original_observation_time: true, original_due: true,
        closed: true, failure_count: 0, next: 'complete' });
      console.info('CP28_B2_RECONCILIATION ' + JSON.stringify({ fixture: 'owner-seeded authority, inherited occurrence and active selection; no selector/cadence proof',
        actualRestrictedCaptureCheckpointReconciliationAndSettlement: true, originalSourceObservedAt: expected.sourceObservedAt,
        dueAt: new Date(Date.parse(expected.sourceObservedAt!) + 240_000).toISOString(), reconciled }));
    }
    b2.successfulCores++;
    return { ...value, links, storage, publicRead, current };
  }
  async function b2Remember(f: Fixture, value: Awaited<ReturnType<typeof b2Core>>) {
    b2.saved.push({ fixture: f, value, digest: await b2Digest(value.ids) });
  }
  async function b2History() {
    await storedOnly(async (_database, store) => {
      for (const saved of b2.saved) {
        expect(await read(saved.fixture.mapping, saved.value.ids[1], store)).toEqual(saved.value.standing);
        expect(await abLinks(saved.fixture, saved.value.ids[1], store)).toEqual(saved.value.links);
        expect(await b2Public(saved.fixture, saved.value.requestId)).toEqual(saved.value.publicRead);
        expect(await b2Digest(saved.value.ids)).toEqual(saved.digest);
      }
    });
  }
  async function b2Snapshot(boundary: string) {
    const snapshot = await abSnapshot(boundary, 153, [['league_roster_provenance_contents', 'provenance']]);
    const [representations] = await ownerQuery(`SELECT
      count(*) FILTER(WHERE population_storage_format='shared-v1')::int AS population_shared_receipts,
      count(*) FILTER(WHERE provenance_storage_format='shared-v1')::int AS provenance_shared_receipts
      FROM public.league_roster_capture_receipts`);
    return { ...snapshot, mode: b2.bound ? 'AB+B2' : 'AB', writerMode: ab.mode,
      provenanceTriggers: await b2Verify(b2.bound),
      counters: { ...snapshot.counters, successfulWitnessedCores: b2.successfulCores },
      representations: { populationSharedReceipts: representations.population_shared_receipts,
        provenanceSharedReceipts: representations.provenance_shared_receipts } };
  }
  it('B2 preserves exact provenance fresh receipts replay and historical reads across storage combinations', async () => {
    b2.boundaries.push(await b2Snapshot('empty-migrated-schema'));
    await b1Setup(); b2.boundaries.push(await b2Snapshot('synthetic-prerequisites'));
    await b2Mode('AB', false, async () => {
      for (const f of b1.fixtures) await b2Remember(f, await b2Core(f));
      b2.boundaries.push(await b2Snapshot('baseline-AB'));
    });
    for (const mode of ['legacy', 'A', 'B1', 'AB'] as const) {
      await b2Mode(mode, true, async () => {
        const prior = b2.saved.filter(saved => saved.fixture === b1.fixtures[0]).at(-1)!.value;
        const unchanged = await b2Core(b1.fixtures[0], { replay: mode === 'AB' });
        expect(unchanged.rows[1].legacy_observation_id).toBe(prior.rows[1].legacy_observation_id);
        expect(unchanged.written[1].args[0].envelope.provenance.requestStartedAt).not.toBe(prior.written[1].args[0].envelope.provenance.requestStartedAt);
        expect(unchanged.written[1].args[0].envelope.provenance.requestCompletedAt).not.toBe(prior.written[1].args[0].envelope.provenance.requestCompletedAt);
        await b2Remember(b1.fixtures[0], unchanged);
        b2.boundaries.push(await b2Snapshot('candidate-' + mode)); await b2History();
      });
    }
    await b2Mode('AB', true, async () => {
      const first = b2.saved.at(-1)!.value, f = b1.fixtures[0], other = await b2Core(b1.fixtures[1]);
      await b2Remember(b1.fixtures[1], other);
      expect(other.rows[1].provenance_content_id).not.toBe(first.rows[1].provenance_content_id);
      const correction = await b2Core(f, { score: true }), returned = await b2Core(f, { occurrenceOrigin: b2.saved[0].value.requestId });
      expect(correction.standing.teams[0].record.wins).toEqual({ state: 'known', value: 5, sourcePath: 'settings.wins' });
      expect(returned.links.links).toEqual(first.links.links); expect(returned.storage.link_content_id).toBe(first.storage.link_content_id);
      expect(returned.rows[1].content_id).toBe(first.rows[1].content_id);
      expect(returned.rows[1].legacy_observation_id).not.toBe(first.rows[1].legacy_observation_id);
      expect(returned.written[1].args[0].envelope.provenance.requestStartedAt).not.toBe(first.written[1].args[0].envelope.provenance.requestStartedAt);
      expect(returned.written[1].args[0].envelope.provenance.requestCompletedAt).not.toBe(first.written[1].args[0].envelope.provenance.requestCompletedAt);
      expect(new Set([first, correction, returned].map(value => value.rows[1].provenance_content_id)).size).toBe(3);
      expect(new Set([first, correction, returned].map(value => JSON.stringify(value.rows[1].effective_provenance))).size).toBe(3);
      await b2Remember(f, correction); await b2Remember(f, returned);
      b2.boundaries.push(await b2Snapshot('cross-league-correction-return')); await b2History();
    });
    expect(b1.cores).toBe(9); expect(b2.successfulCores).toBe(9);
    expect(await connection.database.query('SELECT public.roster_capture_provenance(NULL::public.league_roster_capture_receipts) AS value')).toEqual([{ value: null }]);
    await b2Verify(false); await abVerifyMode('legacy'); await b2History();
    console.info('CP28_B2_SEMANTICS ' + JSON.stringify({ modes: ['AB', 'legacy+B2', 'A+B2', 'B1+B2', 'AB+B2'],
      witnessedCores: b1.cores, successfulWitnessedCores: b2.successfulCores, reservations: b1.attempts,
      historicalReceipts: b2.saved.length * 4, exactHistoryAndDigests: true, exactReplayBeforeAck: true,
      ordinaryCoreCheckpointAndSettlement: true, rawAttemptMappingsAndFencesPreserved: true, restoredAllThreeWriters: true }));
  }, 180_000);
  it('B2 rejects foreign bindings incomplete content history mutation and unauthorized provenance access', async () => {
    const first = b2.saved.find(saved => saved.fixture === b1.fixtures[0] && saved.value.rows[1].provenance_content_id !== null)!.value,
      other = b2.saved.find(saved => saved.fixture === b1.fixtures[1] && saved.value.rows[1].provenance_content_id !== null)!.value;
    const receiptId = first.ids[1], headerId = first.rows[1].provenance_content_id;
    await b2Mode('AB', true, async () => {
      const plain = await b1Direct(b1.fixtures[0], { evidence: false });
      expect((await b1Receipts([plain.receipt], connection.database, true))[0]).toMatchObject({
        provenance_storage_format: 'inline-v1', provenance_content_id: null, provenance: plain.input.envelope.provenance,
        effective_provenance: plain.input.envelope.provenance });
    });
    const before = await b2State();
    const alterations = [ { provenance_content_id: other.rows[1].provenance_content_id }, { provenance_content_id: null },
      { provenance_storage_format: 'inline-v1' }, { provenance: first.rows[1].effective_provenance },
      { legacy_observation_id: other.rows[1].legacy_observation_id }, { content_id: other.rows[1].content_id },
      { attempt_id: first.rows[0].attempt_id } ];
    for (const alteration of alterations) await expect(connection.database.query(`SELECT public.roster_capture_provenance(
      jsonb_populate_record(NULL::public.league_roster_capture_receipts,to_jsonb(receipt)||$2::jsonb))
      FROM public.league_roster_capture_receipts receipt WHERE receipt.id=$1`, [receiptId, JSON.stringify(alteration)]))
      .rejects.toMatchObject({ code: 'P0001' });
    expect(await connection.database.query(`SELECT public.roster_capture_provenance(receipt) AS value FROM (SELECT 1) anchor
      LEFT JOIN public.league_roster_capture_receipts receipt ON receipt.id=$1`, [randomUUID()])).toEqual([{ value: null }]);
    for (const sql of ['UPDATE public.league_roster_provenance_contents SET content_hash=content_hash WHERE id=$1',
      'DELETE FROM public.league_roster_provenance_contents WHERE id=$1',
      'UPDATE public.league_roster_capture_receipts SET provenance_content_id=provenance_content_id WHERE id=$1',
      'DELETE FROM public.league_roster_capture_receipts WHERE id=$1']) {
      await expect(ownerQuery(sql, [sql.includes('provenance_contents') ? headerId : receiptId])).rejects.toThrow(/immutable|history|append/iu);
    }
    const table = (await ownerQuery("SELECT 'public.league_roster_provenance_contents'::regclass::oid::int AS oid"))[0].oid;
    const functions = await ownerQuery(`SELECT oid::int,proname FROM pg_proc WHERE pronamespace='public'::regnamespace
      AND proname IN ('roster_capture_provenance','intern_roster_capture_provenance','validate_roster_provenance_content') ORDER BY proname`);
    expect(functions).toHaveLength(3);
    for (const role of ['runtime', 'account', 'auth'] as const) {
      const client = await createPinnedIntegrationDatabase(role);
      try {
        expect((await client.database.query('SELECT current_user,session_user'))[0])
          .toEqual({ current_user: 'league_one_' + role, session_user: 'league_one_' + role });
        expect(await client.database.query(`SELECT has_table_privilege(current_user,$1::oid,'SELECT') AS read,
          has_table_privilege(current_user,$1::oid,'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') AS write`, [table]))
          .toEqual([{ read: role === 'runtime', write: false }]);
        for (const fn of functions) expect(await client.database.query("SELECT has_function_privilege(current_user,$1::oid,'EXECUTE') AS execute", [fn.oid]))
          .toEqual([{ execute: role === 'runtime' && fn.proname === 'roster_capture_provenance' }]);
        for (const sql of ['INSERT INTO public.league_roster_provenance_contents DEFAULT VALUES',
          'UPDATE public.league_roster_provenance_contents SET content_hash=content_hash',
          'DELETE FROM public.league_roster_provenance_contents', 'TRUNCATE public.league_roster_provenance_contents']) {
          await expect(client.database.query(sql)).rejects.toThrow(/permission denied/iu);
        }
        if (role !== 'runtime') await expect(client.database.query('SELECT * FROM public.league_roster_provenance_contents LIMIT 1')).rejects.toThrow(/permission denied/iu);
      } finally { await client.close(); }
    }
    for (const fn of functions) expect((await ownerQuery(`SELECT COALESCE(bool_or(entry.grantee=0 AND entry.privilege_type='EXECUTE'),false) AS public_execute
      FROM pg_proc function CROSS JOIN LATERAL aclexplode(COALESCE(function.proacl,acldefault('f',function.proowner))) entry
      WHERE function.oid=$1::oid`, [fn.oid]))[0].public_execute).toBe(false);
    // Cloned owner-only headers are rollback fixtures. Recompute the full digest
    // so sibling-role rejection proves witness binding rather than hash rejection.
    for (const defect of ['hash', 'other-role-nonce', 'other-role-missing', 'orphan'] as const) {
      const owner = await createPinnedIntegrationDatabase('owner');
      try {
        await owner.database.query('BEGIN'); const fakeId = randomUUID(), fakeReceipt = randomUUID();
        await owner.database.query(`WITH original AS (SELECT *,CASE $4::text
          WHEN 'other-role-nonce' THEN jsonb_set(provenance,'{acquisition,attempts,managers,nonce}',to_jsonb($5::text))
          WHEN 'other-role-missing' THEN provenance#-'{acquisition,attempts,managers,nonce}' ELSE provenance END AS changed
          FROM public.league_roster_provenance_contents WHERE id=$1)
          INSERT INTO public.league_roster_provenance_contents(id,league_season_id,source_mapping_revision_id,legacy_observation_id,content_hash,provenance,first_receipt_id)
          SELECT $2::uuid,league_season_id,source_mapping_revision_id,legacy_observation_id,
            CASE WHEN $4::text IN ('hash','orphan') THEN encode(digest($2::text,'sha256'),'hex')
              ELSE encode(digest(convert_to(changed::text,'UTF8'),'sha256'),'hex') END,changed,$3::uuid FROM original`,
        [headerId, fakeId, fakeReceipt, defect, randomUUID()]);
        if (defect === 'orphan') await expect(owner.database.query('SET CONSTRAINTS roster_provenance_content_complete IMMEDIATE'))
          .rejects.toMatchObject({ code: 'P0002' });
        else await expect(owner.database.query(`SELECT public.roster_capture_provenance(jsonb_populate_record(NULL::public.league_roster_capture_receipts,
          to_jsonb(receipt)||jsonb_build_object('provenance_content_id',$2::uuid)))
          FROM public.league_roster_capture_receipts receipt WHERE receipt.id=$1`, [receiptId, fakeId]))
          .rejects.toMatchObject({ code: 'P0001', message: defect === 'hash'
            ? 'shared roster provenance observation binding mismatch' : 'shared roster provenance attempt group mismatch' });
      } finally { try { await owner.database.query('ROLLBACK'); } finally { await owner.close(); } }
    }
    for (const alteration of alterations) {
      const owner = await createPinnedIntegrationDatabase('owner');
      try {
        await owner.database.query('BEGIN');
        await expect(owner.database.query(`INSERT INTO public.league_roster_capture_receipts
          SELECT (jsonb_populate_record(NULL::public.league_roster_capture_receipts,
            to_jsonb(receipt)||$2::jsonb||jsonb_build_object('id',$3::uuid))).*
          FROM public.league_roster_capture_receipts receipt WHERE receipt.id=$1`,
        [receiptId, JSON.stringify(alteration), randomUUID()])).rejects.toMatchObject({ code: 'P0001' });
      } finally { try { await owner.database.query('ROLLBACK'); } finally { await owner.close(); } }
    }
    // A later unnamed reservation cannot invalidate an immutable witness group.
    // This is an owner append/rollback fixture, not a live reservation qualification.
    b1Reserve(1); const append = await createPinnedIntegrationDatabase('owner');
    try {
      await append.database.query('BEGIN'); const extra = randomUUID();
      await append.database.query(`INSERT INTO public.league_roster_resource_attempts(id,scope_id,ordinal,expected_generation,source_mapping,write_fence,capture_nonce)
        SELECT $2::uuid,scope_id,(SELECT max(ordinal)+1 FROM public.league_roster_resource_attempts sibling WHERE sibling.scope_id=attempt.scope_id),
          expected_generation,source_mapping,write_fence,gen_random_uuid() FROM public.league_roster_resource_attempts attempt WHERE id=$1`,
      [first.rows[1].attempt_id, extra]);
      expect((await b1Receipts([receiptId], append.database, true))[0].effective_provenance).toEqual(first.rows[1].effective_provenance);
      expect(await append.database.query('SELECT 1 FROM public.league_roster_capture_receipts WHERE attempt_id=$1', [extra])).toEqual([]);
    } finally { try { await append.database.query('ROLLBACK'); } finally { await append.close(); } }
    const reader = await createPinnedIntegrationDatabase('runtime');
    try {
      await reader.database.query('BEGIN READ ONLY');
      expect(await reader.database.query('SELECT pg_current_xact_id_if_assigned() AS xid')).toEqual([{ xid: null }]);
      expect((await b1Receipts([receiptId], reader.database, true))[0].effective_provenance).toEqual(first.rows[1].effective_provenance);
      expect(await reader.database.query('SELECT pg_current_xact_id_if_assigned() AS xid')).toEqual([{ xid: null }]);
    } finally { try { await reader.database.query('ROLLBACK'); } finally { await reader.close(); } }
    // The old mapping/head stays intact after this rollback-only administrative
    // advance. The historical accessor has no current mapping or clock dependency.
    const mapping = await createPinnedIntegrationDatabase('owner');
    try {
      await mapping.database.query('BEGIN');
      await mapping.database.query("SELECT public.revise_league_source_connection($1,'sleeper',$2,$3,'B2 rollback-only mapping advance')",
        [b1.fixtures[0].leagueSeasonId, b1.fixtures[0].mapping.revisionId, numericId()]);
      expect((await b1Receipts([receiptId], mapping.database, true))[0].effective_provenance).toEqual(first.rows[1].effective_provenance);
      expect(await administrationFor(mapping.database).readOfficialStandings!(b1.fixtures[0].mapping, { rosterReceiptId: receiptId }))
        .toEqual({ status: 'missing', reason: 'roster_capture_missing' });
    } finally { try { await mapping.database.query('ROLLBACK'); } finally { await mapping.close(); } }
    expect(await read(b1.fixtures[0].mapping, receiptId)).toEqual(first.standing);
    expect(await b2State()).toEqual(before); await b2History();
    console.info('CP28_B2_SECURITY ' + JSON.stringify({ malformedComposites: alterations.length, guardedInsertRejections: alterations.length,
      immutableMutationRejections: 4, roles: ['runtime', 'account', 'auth'], publicExecuteDenied: true,
      siblingRoleNonceMissingAndWrongRejectedAfterDigestRecompute: true, orphanCommitRejected: true,
      sameFenceAppendHistoricalRead: 'owner rollback fixture', mappingAdvanceHistoricalRead: 'owner rollback fixture',
      sqlNullLeftJoin: true, readOnlyAccessorAllocatesNoXid: true, scopedStateRollback: true, scopedTables: before.map(row => row.name) }));
  }, 120_000);
  it('B2 rolls back provenance after downstream expiry and preserves concurrent writer history', async () => {
    const f = b1.fixtures[0];
    await b2Mode('AB', true, async () => {
      for (const target of ['population', 'identity'] as const) {
        const blocker = await createPinnedIntegrationDatabase('owner'), writer = await createPinnedIntegrationDatabase('runtime');
        let open = false, verified = false, lastWait: DatabaseRow | undefined, callbackError: unknown;
        let pending: Promise<{ result?: B1Write['result']; error?: unknown }> | undefined;
        try {
          const [blockerPid] = await blocker.database.query('SELECT pg_backend_pid() AS pid'),
            [writerPid] = await writer.database.query('SELECT pg_backend_pid() AS pid');
          const identity = b2.saved.find(saved => saved.fixture === f)!.value.links.links[0].canonicalEntityId;
          expect(identity).toBeTypeOf('string');
          const outcome = await b2Core(f, { expectedFailure: () => verified, intercept: async args => {
            try {
            const started = performance.now(), originalFence = args[1]!;
            const before = await b2State();
            const [fresh] = await connection.database.query(`SELECT NOT EXISTS(SELECT 1 FROM public.league_roster_provenance_contents
              WHERE league_season_id=$1 AND source_mapping_revision_id=$2
                AND content_hash=encode(digest(convert_to($3::jsonb::text,'UTF8'),'sha256'),'hex')) AS absent`,
            [f.leagueSeasonId, f.mapping.revisionId, JSON.stringify(args[0].envelope.provenance)]);
            expect(fresh.absent).toBe(true);
            await blocker.database.query('BEGIN'); open = true;
            if (target === 'population') await blocker.database.query('LOCK TABLE public.league_roster_population_contents IN SHARE MODE');
            else await blocker.database.query('SELECT id FROM public.scoring_entities WHERE id=$1 FOR UPDATE', [identity]);
            pending = administrationFor(writer.database).recordObservation(...args).then(result => ({ result }), error => ({ error }));
            let observed: DatabaseRow | undefined;
            for (let poll = 0; poll < 150; poll++) {
              const [row] = await blocker.database.query(`SELECT $1::int=ANY(pg_blocking_pids($2::int)) AS blocked,
                EXISTS(SELECT 1 FROM pg_locks WHERE pid=$2::int AND relation='public.league_roster_provenance_contents'::regclass
                  AND mode='RowExclusiveLock' AND granted) AS provenance_insert,
                EXISTS(SELECT 1 FROM pg_locks WHERE pid=$2::int AND relation='public.league_roster_population_contents'::regclass
                  AND mode='RowExclusiveLock' AND granted) AS population_insert,
                EXISTS(SELECT 1 FROM pg_locks WHERE pid=$2::int AND relation='public.league_roster_population_contents'::regclass
                  AND mode='RowExclusiveLock' AND NOT granted) AS population_wait,
                EXISTS(SELECT 1 FROM pg_locks WHERE pid=$2::int AND relation='public.scoring_entities'::regclass
                  AND mode='RowExclusiveLock' AND granted) AS identity_write,
                EXISTS(SELECT 1 FROM pg_locks WHERE pid=$2::int AND relation='public.league_roster_resource_acceptances'::regclass
                  AND mode='RowExclusiveLock' AND granted) AS acceptance_insert,
                EXISTS(SELECT 1 FROM pg_locks waiter JOIN pg_locks holder USING(transactionid)
                  WHERE waiter.pid=$2::int AND holder.pid=$1::int AND waiter.locktype='transactionid'
                    AND waiter.mode='ShareLock' AND NOT waiter.granted AND holder.granted) AS identity_wait`, [blockerPid.pid, writerPid.pid]);
              lastWait = row;
              if (row.blocked === true && row.provenance_insert === true && (target === 'population' ? row.population_wait === true
                : row.population_insert === true && row.identity_write === true && row.acceptance_insert === true && row.identity_wait === true)) {
                observed = row; break;
              }
              await delay(20);
            }
            expect(observed).toBeDefined();
            await blocker.database.query(`SELECT pg_sleep(GREATEST(0,EXTRACT(EPOCH FROM($1::timestamptz-clock_timestamp())))+0.025)`, [originalFence.deadlineAt]);
            await blocker.database.query('COMMIT'); open = false;
            const settled = await pending;
            expect(String(settled.error)).toMatch(/fence.*(?:stale|expired)|deadline/iu);
            expect(await b2State()).toEqual(before); verified = true;
            console.info('CP28_B2_FENCE ' + JSON.stringify({ target, originalDeadlineAt: originalFence.deadlineAt,
              elapsedMs: performance.now() - started, wait: target === 'population' ? 'B1 population relation lock' : 'A canonical identity transaction lock',
              observed, freshProvenanceKeyAbsentBeforeWrite: true, provenanceInsertAttemptedBeforeWait: true,
              uncommittedParentVisibilityNotClaimed: true, rejected: true, scopedStateRollback: true, scopedTables: before.map(row => row.name) }));
            throw settled.error;
            } catch (error) { if (!verified) callbackError = error; throw error; }
          } }).then(() => ({ error: undefined as unknown }), error => ({ error }));
          if (callbackError) throw callbackError;
          expect(String(outcome.error)).toContain('B2 expected original-deadline core failure verified');
          // The ordinary capture has now restored its fetch spy. Historical
          // no-fetch checks must not reuse that spy's two earlier core calls.
          await b2History(); b2.expectedFailedCores++;
        } catch (error) {
          if (open) { await blocker.database.query('ROLLBACK'); open = false; }
          const settled = await pending, failure = settled?.error as { name?: unknown; code?: unknown } | undefined;
          const callback = callbackError as { name?: unknown; code?: unknown; message?: unknown } | undefined;
          console.info('CP28_B2_FENCE_DIAGNOSTIC ' + JSON.stringify({ target, lastWait,
            callbackError: callback ? { name: String(callback.name), code: String(callback.code), message: String(callback.message).slice(0,240) } : null,
            pendingError: failure ? { name: String(failure.name), code: String(failure.code) } : null }));
          throw error;
        } finally {
          try { if (open) await blocker.database.query('ROLLBACK'); }
          finally { try { await pending; } finally { try { await writer.close(); } finally { await blocker.close(); } } }
        }
      }
      const first = await createPinnedIntegrationDatabase('runtime'), second = await createPinnedIntegrationDatabase('runtime');
      let open = false, lastWait: DatabaseRow | undefined, callbackError: unknown;
      let pending: Promise<{ result?: B1Write['result']; error?: unknown }> | undefined;
      try {
        const [firstPid] = await first.database.query('SELECT pg_backend_pid() AS pid'),
          [secondPid] = await second.database.query('SELECT pg_backend_pid() AS pid');
        const core = await b2Core(f, { intercept: async args => {
          try {
            await first.database.query('BEGIN'); open = true;
            const accepted = await administrationFor(first.database).recordObservation(...args);
            const ids = [accepted.rosterAcceptance, accepted.teamManagerAcceptance, accepted.teamManagerEvidenceAcceptance].map(value => {
              expect(value?.status).toBe('accepted'); return value!.receiptId;
            });
            const initial = await b1Receipts(ids, first.database, true);
            expect(initial.every(row => row.provenance_storage_format === 'shared-v1' && row.population_storage_format === 'shared-v1')).toBe(true);
            expect(new Set(initial.map(row => row.provenance_content_id)).size).toBe(1);
            pending = administrationFor(second.database).recordObservation(...args).then(result => ({ result }), error => ({ error }));
            let observed: DatabaseRow | undefined;
            for (let poll = 0; poll < 150; poll++) {
              const [row] = await first.database.query(`SELECT $1::int=ANY(pg_blocking_pids($2::int)) AS blocked,
                  EXISTS(SELECT 1 FROM pg_locks waiter JOIN pg_locks holder
                    ON holder.locktype=waiter.locktype AND holder.transactionid=waiter.transactionid
                    WHERE waiter.pid=$2::int AND holder.pid=$1::int AND waiter.locktype='transactionid'
                      AND waiter.mode='ShareLock' AND NOT waiter.granted AND holder.mode='ExclusiveLock' AND holder.granted) AS transaction_lock,
                  EXISTS(SELECT 1 FROM pg_locks WHERE pid=$1::int AND locktype='relation'
                    AND relation='public.projection_jobs'::regclass AND mode='RowShareLock' AND granted) AS first_job_owner,
                  EXISTS(SELECT 1 FROM pg_locks WHERE pid=$2::int AND locktype='relation'
                    AND relation='public.projection_jobs'::regclass AND mode='RowShareLock' AND granted) AS second_job_owner`,
              [firstPid.pid, secondPid.pid]);
              lastWait = row;
              if (row.blocked === true && row.transaction_lock === true && row.first_job_owner === true && row.second_job_owner === true) {
                observed = row; break;
              }
              await delay(20);
            }
            expect(observed).toBeDefined(); await first.database.query('COMMIT'); open = false;
            const beforeReplay = await b2State(), settled = await pending; expect(settled.error).toBeUndefined();
            for (const key of ['rosterAcceptance', 'teamManagerAcceptance', 'teamManagerEvidenceAcceptance'] as const) {
              expect(settled.result?.[key]).toMatchObject({ status: 'accepted', reason: 'exact_receipt_replay',
                receiptId: accepted[key]!.receiptId, acceptedGeneration: accepted[key]!.acceptedGeneration });
            }
            expect(await b2State()).toEqual(beforeReplay); expect(await b1Receipts(ids, connection.database, true)).toEqual(initial);
            console.info('CP28_B2_CONCURRENCY ' + JSON.stringify({ setup: 'two restricted runtime writers of the same genuine witnessed core input',
              wait: 'original job ownership row serialization; not mapping or shared-content unique-key contention', observed,
              exactReplay: true, sameThreeReceipts: true, oneFreshProvenanceParent: true, oneFreshPopulationParent: true,
              sameOriginalFenceAndAcquisition: true, noExtraReservations: true }));
            return accepted;
          } catch (error) {
            callbackError = error;
            // Release the original job row before the intake's failure checkpoint tries to acquire it.
            try { if (open) { await first.database.query('ROLLBACK'); open = false; } }
            catch { throw error; }
            throw error;
          }
        } });
        if (callbackError !== undefined) throw callbackError;
        await b2Remember(f, core);
      } catch (error) {
        if (open) { await first.database.query('ROLLBACK'); open = false; }
        const settled = await pending, failure = settled?.error as { name?: unknown; code?: unknown } | undefined;
        const callback = callbackError as { name?: unknown; code?: unknown; message?: unknown } | undefined;
        console.info('CP28_B2_CONCURRENCY_DIAGNOSTIC ' + JSON.stringify({ lastWait,
          callbackError: callback ? { name: String(callback.name), code: String(callback.code), message: String(callback.message).slice(0,240) } : null,
          pendingError: failure ? { name: String(failure.name), code: String(failure.code) } : null })); throw callbackError ?? error;
      } finally {
        try { if (open) await first.database.query('ROLLBACK'); }
        finally { try { await pending; } finally { try { await second.close(); } finally { await first.close(); } } }
      }
      expect(b1.cores).toBe(12); expect(b2.successfulCores).toBe(10); expect(b2.expectedFailedCores).toBe(2);
      b2.boundaries.push(await b2Snapshot('after-security-and-witnessed-interactions')); await b2History();
    });
    await b2Verify(false); await abVerifyMode('legacy');
  }, 120_000);
  it('B2 measures matched witnessed cores with receipt provenance sharing and bounded compression diagnostics', async () => {
    await b2History();
    const measure = async (enabled: boolean) => b2Mode('AB', enabled, async () => {
      const mode = enabled ? 'AB+B2' : 'AB', beforeWarm = await b2Snapshot(mode + '-before-warm');
      for (const f of b1.fixtures) await b2Core(f);
      const before = await b2Snapshot(mode + '-measured-start'), batches: { cores: number; snapshot: Awaited<ReturnType<typeof b2Snapshot>> }[] = [];
      const receipts = new Set<string>(), populations = new Set<string>(), provenances = new Set<string>(), links = new Set<string>();
      let last: Awaited<ReturnType<typeof b2Core>> | undefined;
      for (let index = 0; index < 32; index++) {
        last = await b2Core(b1.fixtures[index % 2]);
        for (const id of last.ids) receipts.add(id);
        for (const row of last.rows.slice(1)) {
          populations.add(String(row.population_content_id));
          if (row.provenance_content_id !== null) provenances.add(String(row.provenance_content_id));
        }
        links.add(String(last.storage.link_content_id));
        if ((index + 1) % 8 === 0) batches.push({ cores: index + 1, snapshot: await b2Snapshot(mode + '-measured-' + (index + 1)) });
      }
      const after = batches.at(-1)!.snapshot;
      const rowDelta = (table: string) => after.relations.find(row => row.name === 'public.' + table)!.rows
        - before.relations.find(row => row.name === 'public.' + table)!.rows;
      expect(receipts.size).toBe(128); expect(populations.size).toBe(32); expect(provenances.size).toBe(enabled ? 32 : 0); expect(links.size).toBe(2);
      for (const table of ['league_roster_capture_receipts', 'league_roster_resource_attempts', 'league_roster_resource_acceptances']) expect(rowDelta(table)).toBe(128);
      expect(rowDelta('league_roster_population_contents')).toBe(32); expect(rowDelta('league_roster_provenance_contents')).toBe(enabled ? 32 : 0);
      expect(rowDelta('league_roster_player_link_receipts')).toBe(32); expect(rowDelta('league_official_standings_captures')).toBe(32);
      for (const table of ['league_roster_player_links', 'league_roster_player_link_contents', 'league_roster_player_link_content_entries']) expect(rowDelta(table)).toBe(0);
      expect(Number(after.representations.populationSharedReceipts) - Number(before.representations.populationSharedReceipts)).toBe(96);
      expect(Number(after.representations.provenanceSharedReceipts) - Number(before.representations.provenanceSharedReceipts)).toBe(enabled ? 96 : 0);
      expect(after.counters.witnessedCores - before.counters.witnessedCores).toBe(32);
      expect(after.counters.successfulWitnessedCores - before.counters.successfulWitnessedCores).toBe(32);
      expect(after.counters.resourceReservations - before.counters.resourceReservations).toBe(128);
      expect(after.relations.filter(row => row.schema === 'website_auth')).toEqual(beforeWarm.relations.filter(row => row.schema === 'website_auth'));
      let queries = 0;
      const database: DatabaseClient = { enabled: true, query: async <Row extends DatabaseRow>(sql: string, parameters?: readonly unknown[], options?: DatabaseQueryOptions) => {
        queries++; expect(sql).not.toMatch(/\b(?:INSERT|UPDATE|DELETE|CALL)\b/iu); return connection.database.query<Row>(sql, parameters, options);
      } };
      const reader = administrationFor(database), start = performance.now();
      expect(await read(b1.fixtures[1].mapping, last!.ids[1], reader)).toEqual(last!.standing);
      const standingsElapsedMs = performance.now() - start; expect(queries).toBe(1);
      const linkStart = performance.now(); expect(await abLinks(b1.fixtures[1], last!.ids[1], reader)).toEqual(last!.links);
      const linksElapsedMs = performance.now() - linkStart; expect(queries).toBe(2);
      const publicStart = performance.now(), publicRead = await b2Public(b1.fixtures[1], last!.requestId);
      const publicElapsedMs = performance.now() - publicStart; expect(publicRead).toEqual(last!.publicRead);
      // Inspect retained values only. No storage ALTER, recompression, rewrite or
      // extra capture; column sizes are diagnostic, not additive physical savings.
      const compression = await ownerQuery(`SELECT scope.identity->'policy'->>'canonicalNormalizerVersion' AS policy,
        receipt.provenance_storage_format,pg_column_size(receipt)::int AS receipt_tuple_bytes,
        pg_column_size(public.roster_capture_provenance(receipt))::int AS logical_provenance_bytes,
        pg_column_size(receipt.provenance)::int AS inline_provenance_bytes,pg_column_compression(receipt.provenance) AS provenance_compression,
        pg_column_size(attempt)::int AS attempt_tuple_bytes,pg_column_size(attempt.source_mapping)::int AS mapping_bytes,
        pg_column_compression(attempt.source_mapping) AS mapping_compression,pg_column_size(attempt.write_fence)::int AS fence_bytes,
        pg_column_compression(attempt.write_fence) AS fence_compression
        FROM public.league_roster_capture_receipts receipt JOIN public.league_roster_resource_attempts attempt ON attempt.id=receipt.attempt_id
        JOIN public.league_roster_resource_scopes scope ON scope.id=attempt.scope_id WHERE receipt.id=ANY($1::uuid[])
        ORDER BY array_position($1::uuid[],receipt.id)`, [last!.ids]);
      expect(compression).toHaveLength(4); await b2History();
      return { mode, beforeWarm, before, after, batches, historicalDigestChecksPassed: true, compression,
        reader: { standingsElapsedMs, linksElapsedMs, publicElapsedMs, standingsQueries: 1, linkQueries: 1,
          publicQueries: publicRead.queries, publicResult: publicRead.result, teams: 10, held: 80 },
        measured: { cores: 32, receipts: receipts.size, populationParents: populations.size, provenanceParents: provenances.size,
          populationReferences: 96, provenanceReferences: enabled ? 96 : 0, reusedLinkContents: links.size } };
    });
    const baseline = await measure(false), candidate = await measure(true);
    await b2Verify(false); await abVerifyMode('legacy'); await b2History();
    const affected = ['public.league_roster_capture_receipts', 'public.league_roster_provenance_contents'];
    const delta = (phase: typeof baseline, names?: readonly string[]) => phase.after.relations.reduce((sum, row) =>
      sum + (row.schema === 'public' && (!names || names.includes(row.name))
        ? Number(row.total) - Number(phase.before.relations.find(old => old.name === row.name)!.total) : 0), 0);
    console.info('CP28_B2_ALLOCATION ' + JSON.stringify({ schemaVersion: 1, kind: 'local-native-witnessed-core-provenance-b2-v1',
      fixture: { leagues: 2, teamsPerLeague: 10, teamsTotal: 20, heldPerCore: 80, heldAcrossLeagues: 160, uniqueCatalogPlayers: 80 },
      workload: { semanticCores: 9, interactionAttemptedCores: 3, expectedFailedCores: 2, warmCoresPerLayout: 2,
        measuredCoresPerLayout: 32, attemptsPerCore: 4, receiptsPerSuccessfulCore: 4, acceptedStandingsPerSuccessfulCore: 1,
        eligiblePopulationReceiptsPerCore: 3, eligibleProvenanceReceiptsPerCore: 3, boundaryReservationAllowance: 8 },
      semanticBoundaries: b2.boundaries, baseline, candidate, affectedRelations: affected,
      affectedAllocatedBytes: { baseline: delta(baseline, affected), candidate: delta(candidate, affected) },
      allPublicAllocatedBytes: { baseline: delta(baseline), candidate: delta(candidate) },
      counters: { witnessedCores: b1.cores, successfulWitnessedCores: b2.successfulCores, expectedFailedCores: b2.expectedFailedCores,
        resourceReservations: b1.attempts, syntheticCoreHttpResponses: b1.cores * 2 },
      historicalDigestChecksPassed: true, restoredAllThreeWriters: true, externalProviderCalls: 0,
      limitations: ['synthetic prerequisites/admission/jobs; no cadence qualification',
        'same expanded 65-migration/158-table schema in both layouts; warmed sequential allocation only',
        'two expected failures use original witnessed core deadline; no separate lease-expiry claim',
        'concurrency proves same-input exact replay under mapping advisory serialization, not content-key contention',
        'existing-row compression inspection only; no lower-target tuning experiment or causal compression claim',
        'one local standings/link/public-reader timing per layout; no SLO',
        'proof-column datum/text diagnostics overlap whole-row tuple bytes and are not additive physical savings',
        'all-public includes synthetic controls and shared identities; classification required',
        '10 teams/80 held per core differs from original hosted 20 teams/160 held per core',
        'four selected local cases only; full21-case profile remains unqualified',
        'fifteen missing-family prices and whole-horizon 10-GiB capacity remain unqualified'] }));
    expect(b1.cores).toBe(80); expect(b2.successfulCores).toBe(78); expect(b2.expectedFailedCores).toBe(2);
    expect(b1.attempts).toBeLessThanOrEqual(329);
    expect(delta(candidate, affected)).toBeLessThan(delta(baseline, affected));
  }, 300_000);
});
