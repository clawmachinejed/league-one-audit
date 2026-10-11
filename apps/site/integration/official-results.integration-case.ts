import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { DatabaseClient, DatabaseQueryOptions, DatabaseRow } from '../lib/database';
import type { JsonValue, NormalizedAdministrationObservation } from '../lib/league-administration/contracts';
import type { AdministrationSourceMapping } from '../lib/league-administration/source-mapping';
import type { AdministrationWriteFence } from '../lib/league-administration/store-contracts';
import type { RosterAttempt, RosterPopulationEvidence } from '../lib/aggregator/current-roster';
import { projectOfficialStandings, type OfficialStandingsRead } from '../lib/aggregator/official-standings';
import { composeOfficialResults } from '../lib/aggregator/official-results';
import { normalizeAdministrationObservation } from '../lib/league-administration/normalize';
import { createLeagueAdministrationStore, createPublicIntakeStore, createPublicDataRefreshStore } from '../lib/league-administration/store';
import { runPublicIntakeStep, runPublicDataRefreshStep, type PublicIntakeDependencies } from '../lib/league-administration/public-intake';
import { readPublicSleeperIntake } from '../lib/league-administration/public-intake-reader';
import { readPublicDataRefresh } from '../lib/league-administration/public-refresh-reader';
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
 * All provider payloads are synthetic. No live-provider semantic/finality proof.
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
      expect((await read(f.mapping)).capture.rosterReceiptId).toBe(newest);
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
        finality: { status: 'unknown' } }, { winner: { state: 'missing' }, finality: { status: 'unknown' } }] }, { reportedResults: [] }] });
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
    async function progress(recurring: boolean, resource: string, status = 'progress') {
      const until = Date.now() + 150_000;
      do {
        const outcome = recurring ? await runPublicDataRefreshStep({ ...dependencies, refresh }, AbortSignal.timeout(20_000))
          : await runPublicIntakeStep(id, dependencies, AbortSignal.timeout(20_000));
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
      expect(await intake.next(id)).toMatchObject({ kind: 'core' });
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
          reportedResults: [{ winner: { value: '1' }, loser: { value: '2' }, finality: { status: 'unknown' } }] },
        { family: 'losers_bracket', resource: { status: 'available', value: { publication: 'unpublished', matches: [] } }, reportedResults: [] }] });
      expect(originalStandings.capture.rosterReceiptId).not.toBe(failedCapture.capture.rosterReceiptId);
      expect(await read(mapping, failedCapture.capture.rosterReceiptId)).toEqual({ ...failedCapture, selection: 'receipt' });
      target = await refresh.configure(configuration); correction = true;
      const stages = ['identity', 'leagues', 'bootstrap', 'playoff-brackets', 'exact-matchups', 'core', 'users'];
      for (const resource of stages) await progress(true, resource);
      expect(admissions).toBe(15); expect(claims).toBe(15);
      const base = 'https://api.sleeper.app/v1/league/' + external;
      const expectedCycle = (identity: string) => ['https://api.sleeper.app/v1/user/' + identity,
        'https://api.sleeper.app/v1/user/' + manager + '/leagues/nfl/2026', base,
        base + '/winners_bracket', base + '/losers_bracket', base, base + '/matchups/15', base, base + '/rosters', base + '/users'];
      const originalUrls = expectedCycle(username); originalUrls.splice(9, 0, base, base + '/rosters');
      // Core requests are made concurrently but invoked in stable league/roster order.
      expect(urls).toEqual([...originalUrls, ...expectedCycle(manager)]); expect(urls).toHaveLength(22); // Plus one separately asserted directory prerequisite GET above.
      const until = Date.now() + 150_000;
      while (true) {
        const outcome = await runPublicDataRefreshStep({ ...dependencies, refresh }, AbortSignal.timeout(20_000));
        if (outcome.status === 'busy') { if (Date.now() >= until) throw new Error('CP13 settlement exceeded admission allowance.'); await delay(1_000); continue; }
        expect(outcome.providerRequests).toBe(0); break;
      }
      expect(admissions).toBe(15); expect(claims).toBe(16); expect(urls).toHaveLength(22); fetch.mockRestore();
      let currentId = '';
      await storedOnly(async (database, store) => {
        const current = await readPublicDataRefresh(database, store, target!.targetId, { officialResultsVersion: 'v1' });
        expect(current).toMatchObject({ status: 'available', cycle: { outcome: { disposition: 'complete' } },
          intake: { officialResults: [{ resource: { standings: { teams: [{ record: { wins: { value: 5 } }, pointsFor: { value: '512.35' } }] } } }] } });
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
            reportedResults: [{ winner: { value: '2' }, loser: { value: '1' }, finality: { status: 'unknown' } }] },
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
});
