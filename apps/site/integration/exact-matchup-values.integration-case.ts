import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { DatabaseClient, DatabaseQueryOptions, DatabaseRow } from '../lib/database';
import type { JsonObject, JsonValue, NormalizedAdministrationObservation } from '../lib/league-administration/contracts';
import type { AdministrationSourceMapping } from '../lib/league-administration/source-mapping';
import type { AdministrationWriteFence } from '../lib/league-administration/store-contracts';
import type { ExactMatchupValuesRead, ExactMatchupValuesSelection } from '../lib/aggregator/exact-matchup-values';
import type { RosterAttempt, RosterPopulationEvidence } from '../lib/aggregator/current-roster';
import { createLeagueAdministrationStore, createPublicIntakeStore, createPublicDataRefreshStore } from '../lib/league-administration/store';
import { normalizeAdministrationObservation } from '../lib/league-administration/normalize';
import { runPublicIntakeStep, runPublicDataRefreshStep } from '../lib/league-administration/public-intake';
import { readPublicSleeperIntake } from '../lib/league-administration/public-intake-reader';
import { readPublicDataRefresh } from '../lib/league-administration/public-refresh-reader';
import { PUBLIC_INTAKE_JOB } from '../lib/league-administration/public-intake-contracts';
import { createProjectionStore } from '../lib/projection-store';
import { exactMatchupClockInstant } from './exact-matchup-clock';
import { createIndependentDatabase, createPinnedIntegrationDatabase, ownerQuery, type IndependentDatabase } from './neon-integration-harness';

const rules = { rec: 0.5 };
const numericId = () => '9' + BigInt('0x' + randomUUID().replaceAll('-', '').slice(0, 15));
const leagueDocument = (external: string): JsonObject => ({ league_id: external, season: '2026', sport: 'nfl',
  season_type: 'regular', name: 'CP10 synthetic score league', status: 'complete', total_rosters: 4,
  roster_positions: ['QB', 'SUPER_FLEX', 'BN'], scoring_settings: rules,
  settings: { leg: 18, last_scored_leg: 0, start_week: 1, playoff_week_start: 15, playoff_round_type: 2 } });
// Source order differs from roster order. Vacancy scores and nonmember-map keys
// remain native evidence; neither is substituted into an official team score.
const sourceRows: JsonObject[] = [
  { roster_id: 2, matchup_id: 7, players: ['b'], starters: ['b'], starters_points: [0], players_points: { b: 0 }, points: 0 },
  { roster_id: 1, matchup_id: 7, players: ['a', 'ATL', 'bench'], starters: ['a', '0'],
    starters_points: [1e-7, -3.125], players_points: { a: 8.25, ATL: -2.5, bench: null, extra: 3.25 }, points: 123.456789, custom_points: 0 },
  { roster_id: 3, matchup_id: null, players: [], starters: [], starters_points: [], players_points: {}, points: null, custom_points: null },
  { roster_id: 4, players: ['d'], starters: ['d'], starters_points: [1e-7], players_points: { d: 1e-7 }, points: 1e-7 },
];
type AvailableValues = Extract<ExactMatchupValuesRead, { status: 'available' }>;
const typedTables = ['league_exact_matchup_value_contents', 'league_exact_matchup_team_values',
  'league_exact_matchup_starter_points', 'league_exact_matchup_player_points'] as const;

/** Six 60s cases, one 900s case and two 120s hooks = 25m authored allowance.
 * Not measured SQL fit. Original 20s work, real 60s admission, 30m work,
 * 40m lifecycle and 50m CI gates remain. Authoring grants no paid SQL run. */
describe.sequential('exact native lineup and score values through restricted PostgreSQL', () => {
  let connection: IndependentDatabase;
  let administration: ReturnType<typeof createLeagueAdministrationStore>;
  beforeAll(async () => {
    connection = createIndependentDatabase(); administration = createLeagueAdministrationStore(connection.database);
    expect((await connection.database.query(`SELECT current_user,session_user,rolsuper,rolcreaterole,rolcreatedb
      FROM pg_roles WHERE rolname=current_user`))[0]).toEqual({ current_user: 'league_one_runtime',
      session_user: 'league_one_runtime', rolsuper: false, rolcreaterole: false, rolcreatedb: false });
  }, 120_000);
  afterAll(async () => {
    vi.restoreAllMocks();
    try {
      const until = Date.now() + 85_000;
      while (true) {
        const [row] = await connection.database.query(`SELECT
          NOT EXISTS(SELECT 1 FROM public_data_dispatches AS dispatch WHERE dispatch.admitted_at>clock_timestamp()-interval '60 seconds')
          AND NOT EXISTS(SELECT 1 FROM projection_jobs AS job WHERE job.job_key=$1
            AND (job.state='running' OR job.completed_at>clock_timestamp()-interval '60 seconds')) AS ready`, [PUBLIC_INTAKE_JOB]);
        if (row.ready === true) break;
        if (Date.now() >= until) throw new Error('CP10 shared minute cleanup did not settle.');
        await delay(250);
      }
    } finally { await connection.close(); }
  }, 120_000);
  async function fixture() {
    const external = numericId(), leagueKey = 'cp10-' + randomUUID();
    const registered = await createProjectionStore(connection.database).registerLeagueSeason({ leagueKey,
      leagueName: 'CP10 synthetic official values', season: 2026, sleeperLeagueId: external, scoringRules: rules });
    if (registered.kind !== 'stored') throw new Error('CP10 fixture registration unavailable.');
    await ownerQuery("INSERT INTO league_administration_enrollments(league_id,provider,evidence) VALUES($1,'sleeper','CP10 synthetic prerequisite')", [registered.value.leagueId]);
    await ownerQuery("INSERT INTO league_administration_enrollment_seasons(league_id,season,provider,evidence) VALUES($1,2026,'sleeper','CP10 synthetic prerequisite')", [registered.value.leagueId]);
    const mapping = await administration.readSourceMapping(external); if (!mapping) throw new Error('Missing CP10 source mapping.');
    return { ...registered.value, external, mapping, payload: leagueDocument(external) };
  }
  type Fixture = Awaited<ReturnType<typeof fixture>>;
  async function observation(f: Fixture, payload: JsonValue, family: 'league' | 'matchups' = 'matchups', week: number | null = 1,
    completeness: 'complete' | 'partial' = 'complete') {
    const [clock] = await connection.database.query('SELECT clock_timestamp() AS at FROM pg_sleep(0.005)');
    const at = exactMatchupClockInstant(clock.at);
    return normalizeAdministrationObservation({ schemaVersion: 'league-administration-v1', normalizerVersion: 'sleeper-administration-v1',
      dialect: 'sleeper-nfl-v1', scope: f.mapping.scope, family, week, completeness, payload,
      provenance: { origin: 'network', requestStartedAt: at, requestCompletedAt: at, sourceObservedAt: at, checkedAt: at } });
  }
  const reserve = (f: Fixture, week = 1, fence?: AdministrationWriteFence) => administration.beginExactMatchupAttempt(f.mapping, week, randomUUID(), fence);
  async function population(f: Fixture): Promise<RosterPopulationEvidence> {
    const input = await observation(f, f.payload, 'league', null), result = await administration.recordObservation(input);
    if (!result.observationId) throw new Error('Missing CP10 population observation.');
    return { observationId: result.observationId, contentHash: input.contentHash, envelope: input.envelope };
  }
  const write = (f: Fixture, input: NormalizedAdministrationObservation, attempt: RosterAttempt,
    proof: RosterPopulationEvidence, fence?: AdministrationWriteFence, store = administration) =>
    store.recordObservation(input, fence, f.mapping, undefined, undefined, undefined, { attempt, population: proof });
  async function read(mapping: AdministrationSourceMapping, selection: ExactMatchupValuesSelection,
    store = administration): Promise<AvailableValues> {
    if (!store.readExactMatchupValues) throw new Error('Missing CP10 typed reader.');
    const value = await store.readExactMatchupValues(mapping, selection);
    expect(value.status).toBe('available');
    if (value.status !== 'available') throw new Error('Missing CP10 accepted typed values.');
    return value;
  }
  async function capture(f: Fixture, rows: JsonValue = sourceRows, week = 1) {
    const attempt = await reserve(f, week), proof = await population(f), input = await observation(f, rows, 'matchups', week);
    const result = await write(f, input, attempt, proof); expect(result.matchupAcceptance?.status).toBe('accepted');
    if (!result.matchupAcceptance?.receiptId) throw new Error('Missing CP10 receipt.');
    const value = await read(f.mapping, { nativeWeek: week, matchupsReceiptId: result.matchupAcceptance.receiptId });
    expect(value.provenance).toEqual(input.envelope.provenance);
    expect(await connection.database.query('SELECT content.payload FROM league_administration_contents AS content WHERE content.id=$1', [value.contentId]))
      .toEqual([{ payload: rows }]);
    return { attempt, proof, input, result, value };
  }
  async function history(f: Fixture) {
    return connection.database.query(`SELECT
      (SELECT jsonb_agg(to_jsonb(content) ORDER BY content.id) FROM league_administration_contents AS content
        WHERE content.league_season_id=$1 AND content.family='matchups') AS contents,
      (SELECT jsonb_agg(to_jsonb(observation) ORDER BY observation.id) FROM league_administration_observations AS observation
        WHERE observation.league_season_id=$1 AND observation.family='matchups') AS observations,
      (SELECT jsonb_agg(to_jsonb(receipt) ORDER BY receipt.id) FROM league_roster_capture_receipts AS receipt
        JOIN league_roster_resource_attempts AS attempt ON attempt.id=receipt.attempt_id
        JOIN league_administration_contents AS content ON content.id=receipt.content_id
        WHERE attempt.source_mapping->>'leagueSeasonId'=$1::text AND content.family='matchups') AS receipts,
      (SELECT jsonb_agg(to_jsonb(acceptance) ORDER BY acceptance.id) FROM league_roster_resource_acceptances AS acceptance
        JOIN league_roster_capture_receipts AS receipt ON receipt.id=acceptance.receipt_id
        JOIN league_administration_contents AS content ON content.id=receipt.content_id
        WHERE content.league_season_id=$1 AND content.family='matchups') AS acceptances,
      (SELECT jsonb_agg(to_jsonb(typed) ORDER BY typed.content_id) FROM league_exact_matchup_value_contents AS typed
        JOIN league_administration_contents AS content ON content.id=typed.content_id WHERE content.league_season_id=$1) AS typed_contents,
      (SELECT jsonb_agg(to_jsonb(team) ORDER BY team.content_id,team.team_id) FROM league_exact_matchup_team_values AS team
        JOIN league_administration_contents AS content ON content.id=team.content_id WHERE content.league_season_id=$1) AS teams,
      (SELECT jsonb_agg(to_jsonb(point) ORDER BY point.content_id,point.team_id,point.source_index) FROM league_exact_matchup_starter_points AS point
        JOIN league_administration_contents AS content ON content.id=point.content_id WHERE content.league_season_id=$1) AS starters,
      (SELECT jsonb_agg(to_jsonb(point) ORDER BY point.content_id,point.team_id,point.native_player_id) FROM league_exact_matchup_player_points AS point
        JOIN league_administration_contents AS content ON content.id=point.content_id WHERE content.league_season_id=$1) AS players`, [f.leagueSeasonId]);
  }
  async function storedOnly<T>(body: (database: DatabaseClient, store: ReturnType<typeof createLeagueAdministrationStore>) => Promise<T>) {
    const statements: string[] = [];
    const database: DatabaseClient = { enabled: true,
      query: async <Row extends DatabaseRow = DatabaseRow>(sql: string, parameters?: readonly unknown[], options?: DatabaseQueryOptions) => {
        statements.push(sql); expect(sql).not.toMatch(/\b(?:INSERT|UPDATE|DELETE|CALL)\b/iu);
        return connection.database.query<Row>(sql, parameters, options);
      } };
    const fetch = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('CP10 stored reader must not fetch source.'));
    try { const result = await body(database, createLeagueAdministrationStore(database));
      expect(fetch).not.toHaveBeenCalled(); expect(statements.length).toBeGreaterThan(0); return result;
    } finally { fetch.mockRestore(); }
  }

  it('stores exact native lineup and score channels with zero negative and exponent values', async () => {
    const f = await fixture(), first = await capture(f), current = await read(f.mapping, { nativeWeek: 1 });
    expect(current).toEqual({ ...first.value, selection: 'current' });
    expect(first.value.value).toMatchObject({ nativeWeek: 1, season: 2026, teams: [
      { externalRosterId: '2', sourceOrdinal: 0, rawPoints: { state: 'supplied', value: '0' }, customPoints: { state: 'missing' }, effectivePoints: { value: '0', source: 'raw' } },
      { externalRosterId: '1', sourceOrdinal: 1, nativeMatchupId: { state: 'supplied', value: '7' },
        players: { state: 'supplied', value: ['a', 'ATL', 'bench'] }, starters: { state: 'supplied', value: ['a', '0'] },
        rawPoints: { state: 'supplied', value: '123.456789' }, customPoints: { state: 'supplied', value: '0' },
        starterPoints: { state: 'supplied', value: ['0.0000001', '-3.125'] },
        playerPoints: { state: 'supplied', value: { a: '8.25', ATL: '-2.5', bench: null, extra: '3.25' } },
        effectivePoints: { value: '0', source: 'custom-override' } },
      { externalRosterId: '3', sourceOrdinal: 2, nativeMatchupId: { state: 'null' }, rawPoints: { state: 'null' }, customPoints: { state: 'null' }, effectivePoints: { value: null, source: 'unavailable' } },
      { externalRosterId: '4', sourceOrdinal: 3, nativeMatchupId: { state: 'missing' }, rawPoints: { state: 'supplied', value: '0.0000001' } },
    ] });
    // Independent SQL oracle reads persisted typed columns, using NUMERIC equality
    // rather than converting a rounded JSON number back into an official score.
    expect(await connection.database.query(`SELECT team.external_roster_id,team.source_ordinal,
      team.raw_points_state,team.custom_points_state,team.raw_points=123.456789::numeric AS exact_raw,
      team.custom_points=0::numeric AS custom_zero,team.players,team.starters
      FROM league_exact_matchup_team_values AS team WHERE team.content_id=$1 AND team.external_roster_id='1'`, [first.value.contentId]))
      .toEqual([{ external_roster_id: '1', source_ordinal: 2, raw_points_state: 'supplied', custom_points_state: 'supplied',
        exact_raw: true, custom_zero: true, players: ['a', 'ATL', 'bench'], starters: ['a', '0'] }]);
    const teamId = first.value.value.teams[1].seasonTeamId;
    expect(await connection.database.query(`SELECT point.source_index,point.points::text AS points FROM league_exact_matchup_starter_points AS point
      WHERE point.content_id=$1 AND point.team_id=$2 ORDER BY point.source_index`, [first.value.contentId, teamId]))
      .toEqual([{ source_index: 0, points: '0.0000001' }, { source_index: 1, points: '-3.125' }]);
    expect(await connection.database.query(`SELECT point.native_player_id,point.points::text AS points FROM league_exact_matchup_player_points AS point
      WHERE point.content_id=$1 AND point.team_id=$2 ORDER BY point.native_player_id COLLATE "C"`, [first.value.contentId, teamId]))
      .toEqual([{ native_player_id: 'ATL', points: '-2.5' }, { native_player_id: 'a', points: '8.25' },
        { native_player_id: 'bench', points: null }, { native_player_id: 'extra', points: '3.25' }]);
    expect(await connection.database.query(`SELECT typed.team_count,typed.value_version,typed.first_acceptance_id=$2::uuid AS first_acceptance
      FROM league_exact_matchup_value_contents AS typed WHERE typed.content_id=$1`, [first.value.contentId, first.value.acceptanceId]))
      .toEqual([{ team_count: 4, value_version: 'sleeper-exact-matchup-values-v1', first_acceptance: true }]);
  }, 60_000);

  it('distinguishes missing null and empty fields while invalid and partial captures preserve the accepted head', async () => {
    const f = await fixture();
    const rows: JsonObject[] = [{ roster_id: 1 }, { roster_id: 2, matchup_id: null, players: null, starters: null, points: null,
      custom_points: null, starters_points: null, players_points: null },
    { roster_id: 3, players: [], starters: [], points: 0, custom_points: 0, starters_points: [], players_points: {} },
    { roster_id: 4, players: ['x'], starters: ['x'], points: -1.00001, starters_points: [null], players_points: { x: null } }];
    const first = await capture(f, rows), head = await read(f.mapping, { nativeWeek: 1 });
    for (const field of ['nativeMatchupId', 'players', 'starters', 'rawPoints', 'customPoints', 'starterPoints', 'playerPoints'] as const) {
      expect(first.value.value.teams[0][field]).toEqual({ state: 'missing' });
      expect(first.value.value.teams[1][field]).toEqual({ state: 'null' });
    }
    expect(first.value.value.teams[2]).toMatchObject({ players: { state: 'supplied', value: [] }, starters: { state: 'supplied', value: [] },
      starterPoints: { state: 'supplied', value: [] }, playerPoints: { state: 'supplied', value: {} }, effectivePoints: { value: '0', source: 'custom-override' } });
    expect(first.value.value.teams[3]).toMatchObject({ rawPoints: { state: 'supplied', value: '-1.00001' },
      starterPoints: { state: 'supplied', value: [null] }, playerPoints: { state: 'supplied', value: { x: null } } });
    const typedBefore = await connection.database.query('SELECT to_jsonb(team) AS team FROM league_exact_matchup_team_values AS team WHERE team.content_id=$1 ORDER BY team.source_ordinal', [head.contentId]);
    for (const [payload, completeness] of [[[{ ...rows[0], points: '0' }, ...rows.slice(1)], 'complete'],
      [[{ ...rows[0], starters: ['x'], starters_points: [] }, ...rows.slice(1)], 'complete'], [rows.slice(0, 1), 'partial']] as const) {
      const attempt = await reserve(f), proof = await population(f), input = await observation(f, payload, 'matchups', 1, completeness);
      const rejected = await write(f, input, attempt, proof);
      expect(rejected.matchupAcceptance?.status).not.toBe('accepted');
      expect(await read(f.mapping, { nativeWeek: 1 })).toEqual(head);
      expect(await connection.database.query('SELECT to_jsonb(team) AS team FROM league_exact_matchup_team_values AS team WHERE team.content_id=$1 ORDER BY team.source_ordinal', [head.contentId])).toEqual(typedBefore);
      if (rejected.matchupAcceptance?.receiptId) expect((await administration.readExactMatchupValues!(f.mapping,
        { nativeWeek: 1, matchupsReceiptId: rejected.matchupAcceptance.receiptId })).status).not.toBe('available');
    }
  }, 60_000);

  it('retains equal scores unpaired rows and separate native legs without inventing aggregate scores or finality', async () => {
    const f = await fixture(), first = await capture(f, sourceRows, 15);
    const secondRows = sourceRows.map(row => row.roster_id === 1 ? { ...row, custom_points: -4.5 } : { ...row });
    const second = await capture(f, secondRows, 16);
    expect(first.value.value.teams.slice(0, 2).map(team => team.effectivePoints.value)).toEqual(['0', '0']);
    expect(second.value.value.teams.slice(0, 2).map(team => team.effectivePoints.value)).toEqual(['0', '-4.5']);
    expect(first.value.value.teams.map(team => team.seasonTeamId)).toEqual(second.value.value.teams.map(team => team.seasonTeamId));
    expect(first.value.contentId).not.toBe(second.value.contentId);
    for (const [week, captured] of [[15, first], [16, second]] as const) {
      const ordinary = await administration.readAcceptedExactMatchups(f.mapping, week);
      expect(ordinary).toMatchObject({ status: 'available', value: { period: { nativeWeek: week },
        groups: [{ format: 'paired', nativeMatchupId: '7' }, { format: 'unpaired', nativeMatchupId: null }, { format: 'unpaired', nativeMatchupId: null }],
        state: { provider: 'unknown', local: 'unknown', reason: 'no_matchup_finality_evidence' } } });
      const exact = await read(f.mapping, { nativeWeek: week, matchupsReceiptId: captured.value.matchupsReceiptId });
      expect(exact).toEqual(captured.value);
      expect(exact.value).not.toHaveProperty('aggregateScore'); expect(exact.value).not.toHaveProperty('winner');
    }
  }, 60_000);

  it('preserves immutable corrections equal content replay and both out of order completion orders', async () => {
    const f = await fixture(), first = await capture(f), immutable = await connection.database.query(
      'SELECT to_jsonb(team) AS team FROM league_exact_matchup_team_values AS team WHERE team.content_id=$1 ORDER BY team.source_ordinal', [first.value.contentId]);
    const same = await capture(f);
    expect(same.value.contentId).toBe(first.value.contentId); expect(same.value.matchupsReceiptId).not.toBe(first.value.matchupsReceiptId);
    expect(same.value.provenance).not.toEqual(first.value.provenance);
    const beforeReplay = await history(f);
    expect((await write(f, same.input, same.attempt, same.proof)).matchupAcceptance)
      .toMatchObject({ status: 'accepted', reason: 'exact_receipt_replay', receiptId: same.value.matchupsReceiptId });
    expect(await history(f)).toEqual(beforeReplay);
    const correction = await capture(f, sourceRows.map(row => row.roster_id === 1
      ? { ...row, custom_points: -9.125, starters: ['0', 'a'], starters_points: [7, 2.5] } : row));
    expect(correction.value.contentId).not.toBe(first.value.contentId);
    expect(correction.value.value.teams[1]).toMatchObject({ starters: { state: 'supplied', value: ['0', 'a'] },
      starterPoints: { state: 'supplied', value: ['7', '2.5'] }, effectivePoints: { value: '-9.125', source: 'custom-override' } });
    expect(await read(f.mapping, { nativeWeek: 1, matchupsReceiptId: first.value.matchupsReceiptId })).toEqual(first.value);
    expect(await connection.database.query('SELECT to_jsonb(team) AS team FROM league_exact_matchup_team_values AS team WHERE team.content_id=$1 ORDER BY team.source_ordinal', [first.value.contentId])).toEqual(immutable);
    for (const olderFirst of [true, false]) {
      const older = await reserve(f), olderProof = await population(f), newer = await reserve(f), newerProof = await population(f);
      const olderInput = await observation(f, sourceRows.map(row => ({ ...row, points: 3 }))),
        newerInput = await observation(f, sourceRows.map(row => ({ ...row, custom_points: olderFirst ? 5.125 : 6.125 })));
      const completeOlder = () => write(f, olderInput, older, olderProof), completeNewer = () => write(f, newerInput, newer, newerProof);
      const firstResult = await (olderFirst ? completeOlder() : completeNewer()), secondResult = await (olderFirst ? completeNewer() : completeOlder());
      expect((olderFirst ? firstResult : secondResult).matchupAcceptance).toMatchObject({ status: 'preserved', reason: 'newer_network_attempt_reserved' });
      expect((olderFirst ? secondResult : firstResult).matchupAcceptance?.status).toBe('accepted');
      const current = await read(f.mapping, { nativeWeek: 1 });
      expect(current.value.teams.every(team => team.effectivePoints.value === (olderFirst ? '5.125' : '6.125'))).toBe(true);
    }
  }, 60_000);

  it('rejects unrelated source scope and rolls back an observed write after the original fence expires', async () => {
    const f = await fixture(), first = await capture(f), other = await fixture(), head = await read(f.mapping, { nativeWeek: 1 });
    for (const [mapping, selection] of [[other.mapping, { nativeWeek: 1, matchupsReceiptId: first.value.matchupsReceiptId }],
      [f.mapping, { nativeWeek: 2, matchupsReceiptId: first.value.matchupsReceiptId }],
      [{ ...f.mapping, revisionId: randomUUID() }, { nativeWeek: 1, matchupsReceiptId: first.value.matchupsReceiptId }]] as const)
      expect((await administration.readExactMatchupValues!(mapping, selection)).status).not.toBe('available');
    const blocker = await createPinnedIntegrationDatabase('owner'), writer = await createPinnedIntegrationDatabase('runtime');
    const jobKey = 'cp10-fence-' + randomUUID(), workerId = randomUUID();
    await ownerQuery(`INSERT INTO projection_jobs(job_key,job_type,scheduled_for,state,lease_owner,lease_until,attempt_count)
      VALUES($1,'league-administration',clock_timestamp(),'running',$2,clock_timestamp()+interval '25 seconds',1)`, [jobKey, workerId]);
    const [clock] = await connection.database.query("SELECT clock_timestamp()+interval '12 seconds' AS at");
    const fence: AdministrationWriteFence = { jobKey, workerId, generation: 1, deadlineAt: exactMatchupClockInstant(clock.at) };
    let pending: Promise<{ error?: unknown }> | undefined, open = false;
    try {
      const [blockerPid] = await blocker.database.query('SELECT pg_backend_pid() AS pid'),
        [writerPid] = await writer.database.query('SELECT pg_backend_pid() AS pid,session_user AS role');
      expect(writerPid.role).toBe('league_one_runtime');
      const attempt = await reserve(f, 1, fence), proof = await population(f), input = await observation(f, sourceRows.map(row => ({ ...row, custom_points: 901.125 })));
      const before = await history(f);
      await blocker.database.query('BEGIN'); open = true;
      await blocker.database.query('LOCK TABLE public.league_exact_matchup_value_contents IN SHARE MODE');
      let settled = false;
      pending = write(f, input, attempt, proof, fence, createLeagueAdministrationStore(writer.database))
        .then(() => ({}), error => ({ error })).finally(() => { settled = true; });
      let blocked = false;
      for (let poll = 0; poll < 50; poll++) {
        const [row] = await blocker.database.query(`SELECT $1::integer=ANY(pg_blocking_pids($2::integer))
          AND EXISTS(SELECT 1 FROM pg_locks AS held_lock WHERE held_lock.pid=$2::integer
            AND held_lock.relation='public.league_exact_matchup_value_contents'::regclass AND held_lock.mode='RowExclusiveLock' AND NOT held_lock.granted) AS blocked`, [blockerPid.pid, writerPid.pid]);
        if (row.blocked) { blocked = true; break; } await delay(20);
      }
      expect(blocked).toBe(true); expect(settled).toBe(false);
      await blocker.database.query('SELECT pg_sleep(GREATEST(0,EXTRACT(EPOCH FROM ($1::timestamptz-clock_timestamp())))+0.025)', [fence.deadlineAt]);
      await blocker.database.query('COMMIT'); open = false;
      expect(String((await pending).error)).toMatch(/fence.*(?:stale|expired)|deadline/i);
      expect(await history(f)).toEqual(before); expect(await read(f.mapping, { nativeWeek: 1 })).toEqual(head);
    } finally {
      if (open) await blocker.database.query('ROLLBACK'); await pending; await writer.close(); await blocker.close();
      await ownerQuery("UPDATE projection_jobs SET state='failed',lease_owner=NULL,lease_until=NULL,completed_at=clock_timestamp() WHERE job_key=$1", [jobKey]);
    }
    await ownerQuery("SELECT revise_league_source_connection($1,'sleeper',$2,$3,'CP10 source fence')", [f.leagueSeasonId, f.mapping.revisionId, numericId()]);
    expect((await administration.readExactMatchupValues!(f.mapping, { nativeWeek: 1, matchupsReceiptId: first.value.matchupsReceiptId })).status).not.toBe('available');
  }, 60_000);

  it('denies direct typed history mutation and private helpers while stored readers remain restricted and source free', async () => {
    const f = await fixture(), first = await capture(f), before = await history(f);
    for (const table of typedTables) {
      await expect(connection.database.query(`DELETE FROM public.${table} WHERE content_id=$1`, [first.value.contentId])).rejects.toThrow(/permission denied/);
      expect(await ownerQuery(`SELECT has_table_privilege('league_one_runtime',$1,'SELECT') AS read,
        has_table_privilege('league_one_runtime',$1,'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') AS write,
        has_table_privilege('league_one_auth',$1,'SELECT,INSERT,UPDATE,DELETE') AS auth`, ['public.' + table]))
        .toEqual([{ read: true, write: false, auth: false }]);
      await expect(ownerQuery(`DELETE FROM public.${table} WHERE content_id=$1`, [first.value.contentId])).rejects.toThrow(/immutable|history/);
    }
    // Helper names and direct invocation are fixed to the reviewed CP10 migration.
    const helpers = ['public.exact_matchup_native_state(jsonb,text,text)', 'public.validate_exact_matchup_value_lineage()',
      'public.validate_exact_matchup_value_cardinality()', 'public.capture_exact_matchup_values()'];
    for (const helper of helpers) expect(await ownerQuery(`SELECT has_function_privilege('league_one_runtime',$1,'EXECUTE') AS runtime,
      has_function_privilege('league_one_auth',$1,'EXECUTE') AS auth`, [helper])).toEqual([{ runtime: false, auth: false }]);
    await expect(connection.database.query("SELECT public.exact_matchup_native_state('{}'::jsonb,'points','number')")).rejects.toThrow(/permission denied/);
    await expect(connection.database.query('SELECT public.capture_exact_matchup_values()')).rejects.toThrow(/permission denied/);
    const owner = await createPinnedIntegrationDatabase('owner');
    try {
      await owner.database.query('BEGIN');
      await owner.database.query(await readFile(new URL('../scripts/provision-runtime-role.sql', import.meta.url), 'utf8'));
      for (const table of typedTables) expect(await owner.database.query(`SELECT has_table_privilege('league_one_runtime',$1,'SELECT') AS read,
        has_table_privilege('league_one_runtime',$1,'INSERT,UPDATE,DELETE') AS write`, ['public.' + table])).toEqual([{ read: true, write: false }]);
    } finally { await owner.database.query('ROLLBACK'); await owner.close(); }
    await storedOnly(async (_database, store) => {
      expect(await read(f.mapping, { nativeWeek: 1, matchupsReceiptId: first.value.matchupsReceiptId }, store)).toEqual(first.value);
      expect((await read(f.mapping, { nativeWeek: 1 }, store)).selection).toBe('current');
    });
    expect(await history(f)).toEqual(before);
  }, 60_000);

  it('composes ordinary exact score intake and changed refresh through immutable stored receipt reads', async () => {
    const id = randomUUID(), manager = numericId(), external = numericId(), username = 'cp10_values_' + manager;
    const league = leagueDocument(external), urls: string[] = [], exactPeriods = [{ season: 2026, nativeWeek: 1 }];
    let correction = false, claims = 0, admissions = 0;
    const changedRows = sourceRows.map(row => row.roster_id === 1 ? { ...row, custom_points: -12.34567, starters_points: [2.25, null] } : row);
    const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(async input => {
      const url = String(input); urls.push(url);
      if (url === 'https://api.sleeper.app/v1/user/' + username || url === 'https://api.sleeper.app/v1/user/' + manager)
        return new Response(JSON.stringify({ user_id: manager, username }));
      if (url === 'https://api.sleeper.app/v1/user/' + manager + '/leagues/nfl/2026') return new Response(JSON.stringify([league]));
      if (url === 'https://api.sleeper.app/v1/league/' + external) return new Response(JSON.stringify(league));
      if (url === 'https://api.sleeper.app/v1/league/' + external + '/matchups/1') return new Response(JSON.stringify(correction ? changedRows : sourceRows));
      if (url === 'https://api.sleeper.app/v1/league/' + external + '/rosters') return new Response(JSON.stringify([1, 2, 3, 4].map(roster_id => ({ roster_id,
        owner_id: roster_id === 1 ? manager : null, co_owners: [], players: [], starters: [], reserve: [], taxi: [] }))));
      if (url === 'https://api.sleeper.app/v1/league/' + external + '/users') return new Response(JSON.stringify([{ user_id: manager, display_name: username }]));
      throw new Error('Unexpected CP10 synthetic acquisition: ' + url);
    });
    const intake = createPublicIntakeStore(connection.database), refresh = createPublicDataRefreshStore(connection.database), jobs = createProjectionStore(connection.database);
    const dependencies = { intake: { ...intake, admit: async (...args: Parameters<typeof intake.admit>) => {
      const admitted = await intake.admit(...args); if (admitted) admissions++; return admitted;
    } }, administration, jobs: { ...jobs, acquireJob: async (...args: Parameters<typeof jobs.acquireJob>) => {
      const claim = await jobs.acquireJob(...args); if (claim.kind === 'acquired') claims++; return claim;
    } } };
    async function progress(recurring: boolean, resource: string) {
      const until = Date.now() + 150_000;
      do {
        const outcome = recurring ? await runPublicDataRefreshStep({ ...dependencies, refresh }, AbortSignal.timeout(20_000))
          : await runPublicIntakeStep(id, dependencies, AbortSignal.timeout(20_000));
        if (['busy', 'backoff', 'idle'].includes(outcome.status)) { await delay(1_000); continue; }
        expect(outcome).toMatchObject({ status: 'progress', resource, providerRequests: ['core', 'exact-matchups'].includes(resource) ? 2 : 1 }); return;
      } while (Date.now() < until);
      throw new Error('CP10 ordinary stage exceeded its existing admission allowance.');
    }
    const checkpoints = (requestId: string) => connection.database.query(`SELECT checkpoint.* FROM public_data_exact_period_checkpoints AS checkpoint
      WHERE checkpoint.intake_id=$1 ORDER BY checkpoint.task_ordinal`, [requestId]);
    let target: { targetId: string; configurationRevision: number } | undefined;
    const configuration = { id: randomUUID(), expectedRevision: 0, identityRequestId: id, seasons: [2026], exactPeriods,
      cadenceSeconds: 60, expiresAt: new Date(Date.now() + 25 * 60_000).toISOString(), paused: false };
    try {
      await intake.submit({ id, username, seasons: [2026], exactPeriods });
      const stages = ['identity', 'leagues', 'bootstrap', 'exact-matchups', 'core', 'users'];
      for (const resource of stages) await progress(false, resource);
      expect(await intake.next(id)).toBe('complete');
      const mapping = await administration.readSourceMapping(external); if (!mapping) throw new Error('Missing ordinary CP10 mapping.');
      const originalCheckpoints = await checkpoints(id); expect(originalCheckpoints).toHaveLength(1);
      const original = await read(mapping, { nativeWeek: 1, matchupsReceiptId: String(originalCheckpoints[0].matchups_receipt_id) });
      expect(original.value.teams[1].effectivePoints).toEqual({ value: '0', source: 'custom-override' });
      target = await refresh.configure(configuration); correction = true;
      for (const resource of stages) await progress(true, resource);
      const base = 'https://api.sleeper.app/v1/league/' + external;
      const expectedCycle = (identity: string) => ['https://api.sleeper.app/v1/user/' + identity,
        'https://api.sleeper.app/v1/user/' + manager + '/leagues/nfl/2026', base, base, base + '/matchups/1', base, base + '/rosters', base + '/users'];
      expect(urls).toEqual([...expectedCycle(username), ...expectedCycle(manager)]);
      expect(admissions).toBe(12); expect(claims).toBe(12);
      // The next ordinary owner selection records the completed cycle without a GET.
      const settleUntil = Date.now() + 150_000;
      while (true) {
        const outcome = await runPublicDataRefreshStep({ ...dependencies, refresh }, AbortSignal.timeout(20_000));
        if (outcome.status === 'busy') { if (Date.now() >= settleUntil) throw new Error('CP10 settlement exceeded admission allowance.'); await delay(1_000); continue; }
        expect(outcome.providerRequests).toBe(0); break;
      }
      expect(urls).toHaveLength(16); expect(admissions).toBe(12); expect(claims).toBe(13); fetch.mockRestore();
      let currentId = '';
      await storedOnly(async (database, store) => {
        const current = await readPublicDataRefresh(database, store, target!.targetId, { exactMatchupValuesVersion: 'v1' });
        expect(current).toMatchObject({ status: 'available', cycle: { outcome: { disposition: 'complete' } },
          intake: { status: 'available', exactPeriods: [{ resource: { status: 'available' }, exactMatchupValues: { status: 'available' } }] } });
        if (current.status !== 'available' || !current.cycle || !current.intake || current.intake.status === 'missing') throw new Error('Missing complete CP10 refresh.');
        currentId = current.cycle.requestId;
        const latest = await read(mapping, { nativeWeek: 1 }, store);
        expect(latest.value.teams[1]).toMatchObject({ customPoints: { state: 'supplied', value: '-12.34567' },
          starterPoints: { state: 'supplied', value: ['2.25', null] }, effectivePoints: { value: '-12.34567', source: 'custom-override' } });
        expect(latest.contentId).not.toBe(original.contentId);
        const old = await readPublicSleeperIntake(database, store, id, { exactMatchupValuesVersion: 'v1' });
        expect(old).toMatchObject({ exactPeriods: [{ resource: { status: 'unavailable', reason: 'intake-capture-not-current-head' }, exactMatchupValues: original }] });
        expect(await read(mapping, { nativeWeek: 1, matchupsReceiptId: original.matchupsReceiptId }, store)).toEqual(original);
        const defaults = await readPublicSleeperIntake(database, store, id);
        if (defaults.status === 'missing') throw new Error('Missing CP10 default intake.');
        expect(defaults.exactPeriods?.every(period => !Object.hasOwn(period, 'exactMatchupValues'))).toBe(true);
      });
      expect(currentId).not.toBe(id); expect(await intake.next(currentId)).toBe('complete');
      expect(await checkpoints(id)).toEqual(originalCheckpoints); expect(await checkpoints(currentId)).toHaveLength(1);
      const witnesses = await connection.database.query(`SELECT checkpoint.intake_id,
        dispatch.work->>'kind'='exact-matchups' AND (dispatch.work->>'nativeWeek')::integer=task.native_week AS same_work,
        checkpoint.source_mapping=attempt.source_mapping AS same_mapping,
        receipt.provenance->'acquisition'->>'dispatchNonce'=dispatch.capture_nonce::text
          AND receipt.provenance->'acquisition'->'work'=dispatch.work
          AND receipt.provenance->'acquisition'->'fence'=attempt.write_fence AS witnessed,
        attempt.reserved_at>=dispatch.admitted_at AND receipt.recorded_at>=attempt.reserved_at AS database_order
        FROM public_data_exact_period_checkpoints AS checkpoint
        JOIN public_data_exact_period_tasks AS task ON task.intake_id=checkpoint.intake_id AND task.ordinal=checkpoint.task_ordinal
        JOIN public_data_dispatches AS dispatch ON dispatch.worker_id=checkpoint.worker_id AND dispatch.generation=checkpoint.generation
        JOIN league_roster_capture_receipts AS receipt ON receipt.id IN(checkpoint.settings_receipt_id,checkpoint.matchups_receipt_id)
        JOIN league_roster_resource_attempts AS attempt ON attempt.id=receipt.attempt_id
        WHERE checkpoint.intake_id=ANY($1::uuid[])`, [[id, currentId]]);
      expect(witnesses).toHaveLength(4);
      for (const row of witnesses) expect(row).toMatchObject({ same_work: true, same_mapping: true, witnessed: true, database_order: true });
      const [spacing] = await connection.database.query(`SELECT count(*)::integer AS count,
        bool_and(history.previous IS NULL OR history.admitted_at-history.previous>=interval '60 seconds') AS spaced
        FROM(SELECT dispatch.admitted_at,lag(dispatch.admitted_at) OVER(ORDER BY dispatch.admitted_at) AS previous
          FROM public_data_dispatches AS dispatch WHERE dispatch.intake_id=ANY($1::uuid[])) AS history`, [[id, currentId]]);
      expect(spacing).toEqual({ count: 12, spaced: true });
    } finally {
      fetch.mockRestore();
      if (target) await refresh.configure({ ...configuration, expectedRevision: target.configurationRevision,
        expiresAt: new Date(Date.now() + 60_000).toISOString(), paused: true });
    }
  }, 900_000);
});
