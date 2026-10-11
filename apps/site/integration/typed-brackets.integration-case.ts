import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { DatabaseClient, DatabaseQueryOptions, DatabaseRow } from '../lib/database';
import type { JsonObject, JsonValue, NormalizedAdministrationObservation } from '../lib/league-administration/contracts';
import type { AdministrationSourceMapping } from '../lib/league-administration/source-mapping';
import type { AdministrationWriteFence } from '../lib/league-administration/store-contracts';
import type { RosterAttempt } from '../lib/aggregator/current-roster';
import { projectPlayoffBracket, type AcceptedBracketRead, type BracketFamily, type BracketSelection } from '../lib/aggregator/playoff-brackets';
import { createLeagueAdministrationStore } from '../lib/league-administration/store';
import { normalizeAdministrationObservation } from '../lib/league-administration/normalize';
import { getOfficialAdministrationObservation } from '../lib/sleeper';
import { createProjectionStore } from '../lib/projection-store';
import { exactMatchupClockInstant } from './exact-matchup-clock';
import { createIndependentDatabase, createPinnedIntegrationDatabase, ownerQuery, type IndependentDatabase } from './neon-integration-harness';

const numericId = () => '9' + BigInt('0x' + randomUUID().replaceAll('-', '').slice(0, 15));
const families = ['winners_bracket', 'losers_bracket'] as const;
const typedTables = ['league_bracket_contents', 'league_bracket_rounds', 'league_bracket_matches',
  'league_bracket_entrants', 'league_bracket_edges', 'league_bracket_results'] as const;
// Source order deliberately differs from round and matchup order. Native IDs are
// bracket-local facts; no join to a weekly matchup or finality inference is valid.
const sourceRows: JsonObject[] = [
  { m: 3, r: 2, t1: { w: 1 }, t1_from: { w: 1 }, t2: '4', t2_from: { l: 2 }, w: 1, l: 4, future: { native: true } },
  { m: 2, r: 1, t1: 3, t2: 4, w: 3, l: 4 },
  { m: 1, r: 1, t1: 1, t2: '2', w: 1, l: 2, p: { native: 'opaque' } },
];
type AvailableBracket = Extract<AcceptedBracketRead, { status: 'available' }>;

/** AUTHORED / SQL-UNQUALIFIED CP11. Seven 60s cases plus two 120s hooks = 11m
 * authored allowance, not measured fit. Synthetic enrollment is a prerequisite;
 * ordinary intake/refresh is CP12 and broader finality is CP13. No paid run. */
describe.sequential('typed official playoff brackets through restricted PostgreSQL', () => {
  let connection: IndependentDatabase;
  let administration: ReturnType<typeof createLeagueAdministrationStore>;
  beforeAll(async () => {
    connection = createIndependentDatabase(); administration = createLeagueAdministrationStore(connection.database);
    expect((await connection.database.query(`SELECT current_user,session_user,rolsuper,rolcreaterole,rolcreatedb
      FROM pg_roles WHERE rolname=current_user`))[0]).toEqual({ current_user: 'league_one_runtime',
      session_user: 'league_one_runtime', rolsuper: false, rolcreaterole: false, rolcreatedb: false });
  }, 120_000);
  afterAll(async () => { vi.restoreAllMocks(); await connection.close(); }, 120_000);
  async function fixture() {
    const external = numericId(), leagueKey = 'cp11-' + randomUUID();
    const registered = await createProjectionStore(connection.database).registerLeagueSeason({ leagueKey,
      leagueName: 'CP11 synthetic official bracket', season: 2026, sleeperLeagueId: external, scoringRules: { rec: 0.5 } });
    if (registered.kind !== 'stored') throw new Error('CP11 fixture registration unavailable.');
    await ownerQuery("INSERT INTO league_administration_enrollments(league_id,provider,evidence) VALUES($1,'sleeper','CP11 synthetic prerequisite')", [registered.value.leagueId]);
    await ownerQuery("INSERT INTO league_administration_enrollment_seasons(league_id,season,provider,evidence) VALUES($1,2026,'sleeper','CP11 synthetic prerequisite')", [registered.value.leagueId]);
    const mapping = await administration.readSourceMapping(external); if (!mapping) throw new Error('Missing CP11 mapping.');
    return { ...registered.value, external, mapping };
  }
  type Fixture = Awaited<ReturnType<typeof fixture>>;
  const reserve = (f: Fixture, family: BracketFamily = 'winners_bracket', fence?: AdministrationWriteFence) => {
    if (!administration.beginBracketAttempt) throw new Error('Missing CP11 reservation.');
    return administration.beginBracketAttempt(f.mapping, family, randomUUID(), fence);
  };
  const write = (f: Fixture, input: NormalizedAdministrationObservation, attempt: RosterAttempt,
    fence?: AdministrationWriteFence, store = administration) => store.recordObservation(input, fence, f.mapping,
      undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, { attempt });
  async function observation(f: Fixture, payload: JsonValue, family: BracketFamily = 'winners_bracket', completeness: 'complete' | 'partial' = 'complete') {
    const [clock] = await connection.database.query('SELECT clock_timestamp() AS at FROM pg_sleep(0.005)');
    const at = exactMatchupClockInstant(clock.at);
    return normalizeAdministrationObservation({ schemaVersion: 'league-administration-v1', normalizerVersion: 'sleeper-administration-v1',
      dialect: 'sleeper-nfl-v1', scope: f.mapping.scope, family, week: null, completeness, payload,
      provenance: { origin: 'network', requestStartedAt: at, requestCompletedAt: at, sourceObservedAt: completeness === 'partial' ? null : at, checkedAt: at } });
  }
  async function sourceObservation(f: Fixture, payload: JsonValue, family: BracketFamily) {
    // SQL-derived clock is used only to wait until the reservation precedes the
    // fixture adapter call; all captured provider timestamps remain unchanged.
    const [clock] = await connection.database.query('SELECT clock_timestamp() AS at');
    const until = new Date(exactMatchupClockInstant(clock.at)).getTime() + 20;
    expect(until - Date.now()).toBeLessThanOrEqual(2_000);
    if (Date.now() < until) await delay(until - Date.now());
    const urls: string[] = [];
    const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(async input => {
      const url = String(input); urls.push(url);
      expect(url).toBe('https://api.sleeper.app/v1/league/' + f.external + '/' + family);
      return new Response(JSON.stringify(payload), { headers: { 'content-type': 'application/json' } });
    });
    try {
      const captured = await getOfficialAdministrationObservation(f.external, family, null, 0, AbortSignal.timeout(20_000));
      expect(urls).toHaveLength(1); expect(captured.payload).toEqual(payload);
      return normalizeAdministrationObservation({ schemaVersion: 'league-administration-v1', normalizerVersion: 'sleeper-administration-v1',
        dialect: 'sleeper-nfl-v1', scope: f.mapping.scope, family: captured.family, week: captured.week,
        completeness: captured.completeness ?? 'complete', payload: captured.payload as JsonValue,
        provenance: { origin: captured.origin, requestStartedAt: captured.requestStartedAt,
          requestCompletedAt: captured.requestCompletedAt, sourceObservedAt: captured.sourceObservedAt, checkedAt: new Date().toISOString() } });
    } finally { fetch.mockRestore(); }
  }
  async function read(mapping: AdministrationSourceMapping, selection: BracketSelection, store = administration): Promise<AvailableBracket> {
    if (!store.readAcceptedBracket) throw new Error('Missing CP11 stored reader.');
    const result = await store.readAcceptedBracket(mapping, selection); expect(result.status).toBe('available');
    if (result.status !== 'available') throw new Error('Missing CP11 accepted bracket.');
    return result;
  }
  async function capture(f: Fixture, payload: JsonValue = sourceRows, family: BracketFamily = 'winners_bracket', source = false) {
    const attempt = await reserve(f, family), input = source ? await sourceObservation(f, payload, family) : await observation(f, payload, family);
    const projection = projectPlayoffBracket(input); expect(projection.status).toBe('accepted');
    const result = await write(f, input, attempt); expect(result.bracketAcceptance?.status).toBe('accepted');
    if (!result.bracketAcceptance?.receiptId) throw new Error('Missing CP11 accepted receipt.');
    const value = await read(f.mapping, { family, bracketReceiptId: result.bracketAcceptance.receiptId });
    expect(value.value).toEqual(projection.value); expect(value.provenance).toEqual(input.envelope.provenance);
    expect(await connection.database.query('SELECT payload,normalized_value FROM league_administration_contents WHERE id=$1', [value.contentId]))
      .toEqual([{ payload, normalized_value: input.value }]);
    return { attempt, input, result, value };
  }
  async function history(f: Fixture) {
    const typed = typedTables.map(table => `(SELECT jsonb_agg(to_jsonb(typed) ORDER BY to_jsonb(typed)::text)
      FROM public.${table} typed JOIN league_administration_contents content ON content.id=typed.content_id
      WHERE content.league_season_id=$1) AS ${table}`);
    return connection.database.query(`SELECT
      (SELECT jsonb_agg(to_jsonb(content) ORDER BY content.id) FROM league_administration_contents content
        WHERE content.league_season_id=$1 AND content.family=ANY($2::text[])) AS legacy,
      (SELECT jsonb_agg(to_jsonb(observation) ORDER BY observation.id) FROM league_administration_observations observation
        WHERE observation.league_season_id=$1 AND observation.family=ANY($2::text[])) AS observations,
      (SELECT jsonb_agg(to_jsonb(receipt) ORDER BY receipt.id) FROM league_roster_capture_receipts receipt
        JOIN league_roster_resource_attempts attempt ON attempt.id=receipt.attempt_id
        WHERE attempt.source_mapping->>'leagueSeasonId'=$1::text) AS receipts,
      (SELECT jsonb_agg(to_jsonb(accepted) ORDER BY accepted.id) FROM league_roster_resource_acceptances accepted
        JOIN league_roster_resource_scopes scope ON scope.id=accepted.scope_id WHERE scope.league_season_id=$1) AS acceptances,
      (SELECT jsonb_agg(to_jsonb(head) ORDER BY head.scope_id) FROM league_roster_resource_heads head
        JOIN league_roster_resource_scopes scope ON scope.id=head.scope_id WHERE scope.league_season_id=$1) AS heads,
      ${typed.join(',')}`, [f.leagueSeasonId, families]);
  }
  async function storedOnly<T>(body: (store: ReturnType<typeof createLeagueAdministrationStore>) => Promise<T>) {
    const statements: string[] = [];
    const database: DatabaseClient = { enabled: true,
      query: async <Row extends DatabaseRow = DatabaseRow>(sql: string, parameters?: readonly unknown[], options?: DatabaseQueryOptions) => {
        statements.push(sql); expect(sql).not.toMatch(/\b(?:INSERT|UPDATE|DELETE|CALL)\b/iu);
        return connection.database.query<Row>(sql, parameters, options);
      } };
    const fetch = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('CP11 stored reader must not fetch.'));
    try { const result = await body(createLeagueAdministrationStore(database));
      expect(fetch).not.toHaveBeenCalled(); expect(statements.length).toBeGreaterThan(0); return result;
    } finally { fetch.mockRestore(); }
  }

  it('stores native bracket rounds entrants advancement edges and supplied results for both families', async () => {
    const f = await fixture();
    for (const family of families) {
      const captured = await capture(f, sourceRows, family, true), value = captured.value.value;
      expect(value).toMatchObject({ family, season: 2026, publication: 'published', limitations: [],
        rounds: [{ round: 1, externalMatchupIds: ['2', '1'] }, { round: 2, externalMatchupIds: ['3'] }],
        edges: [{ targetMatchupId: '3', slot: 1, sourceMatchupId: '1', outcome: 'winner', origin: 'both', sourceMatchPresent: true },
          { targetMatchupId: '3', slot: 2, sourceMatchupId: '2', outcome: 'loser', origin: 'explicit', sourceMatchPresent: true }] });
      expect(value.matches.map(match => [match.externalMatchupId, match.round, match.sourceOrdinal])).toEqual([['3', 2, 0], ['2', 1, 1], ['1', 1, 2]]);
      expect(value.matches[0]).toMatchObject({ winner: { state: 'supplied', raw: 1, value: '1' }, loser: { state: 'supplied', raw: 4, value: '4' },
        entrants: [{ slot: 1, native: { state: 'supplied', raw: { w: 1 }, value: { kind: 'advancement', outcome: 'winner', externalMatchupId: '1' } } },
          { slot: 2, native: { state: 'supplied', raw: '4', value: { kind: 'roster', externalRosterId: '4' } } }], extensions: { future: { native: true } } });
      expect(value.matches[2].nativePosition).toEqual({ state: 'supplied', raw: { native: 'opaque' }, value: { native: 'opaque' } });
      const counts = await Promise.all(typedTables.map(table => connection.database.query(`SELECT count(*)::integer AS count FROM public.${table} WHERE content_id=$1`, [captured.value.contentId])));
      expect(counts.map(rows => rows[0].count)).toEqual([1, 2, 3, 6, 2, 6]);
      expect(value).not.toHaveProperty('final'); expect(value).not.toHaveProperty('nativeWeek'); expect(value).not.toHaveProperty('aggregateScore');
      expect((await read(f.mapping, { family })).bracketReceiptId).toBe(captured.value.bracketReceiptId);
    }
  }, 60_000);

  it('distinguishes unpublished empty and native field states without inventing results', async () => {
    const f = await fixture();
    for (const family of families) {
      expect(await administration.readAcceptedBracket!(f.mapping, { family })).toMatchObject({ status: 'missing' });
      const unpublished = await capture(f, null, family, true), empty = await capture(f, [], family, true);
      expect(unpublished.value.value).toMatchObject({ publication: 'unpublished', rounds: [], matches: [], edges: [] });
      expect(empty.value.value).toMatchObject({ publication: 'published', rounds: [], matches: [], edges: [] });
      expect(unpublished.value.contentId).not.toBe(empty.value.contentId);
      expect(unpublished.input.contentHash).not.toBe(empty.input.contentHash);
      expect(await read(f.mapping, { family, bracketReceiptId: unpublished.value.bracketReceiptId })).toEqual(unpublished.value);
      const unresolved = await capture(f, [{ m: 1, r: 1, t1: null, t2: { future_seed: 9 }, t1_from: { w: 9 }, w: null, p: 0 }], family);
      expect(unresolved.value.value).toMatchObject({ limitations: ['unresolved_advancement_source', 'unsupported_entrant_reference'],
        edges: [{ targetMatchupId: '1', slot: 1, sourceMatchupId: '9', outcome: 'winner', origin: 'explicit', sourceMatchPresent: false }],
        matches: [{ entrants: [{ native: { state: 'null', raw: null, value: null }, from: { state: 'supplied' } },
          { native: { state: 'unsupported', raw: { future_seed: 9 }, value: null }, from: { state: 'missing' } }],
          winner: { state: 'null', raw: null, value: null }, loser: { state: 'missing', raw: null, value: null },
          nativePosition: { state: 'supplied', raw: 0, value: 0 } }] });
    }
  }, 60_000);

  it('preserves last good typed brackets through malformed partial and conflicting captures', async () => {
    const f = await fixture(), first = await capture(f), before = await read(f.mapping, { family: 'winners_bracket' });
    const invalid: { payload: JsonValue; partial?: true; legacyAccepted?: true }[] = [
      { payload: {} }, { payload: null, partial: true }, { payload: sourceRows, partial: true },
      { payload: [{ m: 1, r: 1, t1: { w: 1 } }] },
      { payload: [{ m: 1, r: 1, t1: 1, t2: 2, w: 1, l: 1 }], legacyAccepted: true },
      { payload: [{ m: 1, r: 1, t1: 1, t2: 2, w: 3 }], legacyAccepted: true },
      { payload: [{ m: 1, r: 1, t1: { w: 2 } }, { m: 2, r: 2, t1: { w: 1 } }], legacyAccepted: true },
    ];
    for (const bad of invalid) {
      const attempt = await reserve(f), input = await observation(f, bad.payload, 'winners_bracket', bad.partial ? 'partial' : 'complete');
      if (bad.legacyAccepted) expect(input.status).toBe('accepted');
      expect(projectPlayoffBracket(input).status).toBe('rejected');
      const result = await write(f, input, attempt); expect(result.bracketAcceptance?.status).toBe('preserved');
      expect(await read(f.mapping, { family: 'winners_bracket' })).toEqual(before);
      expect(await connection.database.query(`SELECT content.payload FROM league_administration_observations observation
        JOIN league_administration_contents content ON content.id=observation.content_id WHERE observation.id=$1`, [result.observationId])).toEqual([{ payload: bad.payload }]);
    }
    expect(await read(f.mapping, { family: 'winners_bracket', bracketReceiptId: first.value.bracketReceiptId })).toEqual(first.value);
  }, 60_000);

  it('retains immutable corrections equal content replay and both out of order completion orders', async () => {
    const f = await fixture(), first = await capture(f), same = await capture(f);
    expect(same.value.contentId).toBe(first.value.contentId); expect(same.value.bracketReceiptId).not.toBe(first.value.bracketReceiptId);
    const beforeReplay = await history(f);
    expect((await write(f, same.input, same.attempt)).bracketAcceptance)
      .toMatchObject({ status: 'accepted', reason: 'exact_receipt_replay', receiptId: same.value.bracketReceiptId });
    expect(await history(f)).toEqual(beforeReplay);
    const reordered = await capture(f, [...sourceRows].reverse());
    expect(reordered.input.semanticHash).toBe(first.input.semanticHash);
    expect(reordered.input.contentHash).not.toBe(first.input.contentHash);
    expect(reordered.value.contentId).not.toBe(first.value.contentId);
    expect(reordered.value.value.matches.map(match => match.externalMatchupId)).toEqual(['1', '2', '3']);
    expect(await read(f.mapping, { family: 'winners_bracket', bracketReceiptId: first.value.bracketReceiptId })).toEqual(first.value);
    const correctionRows = sourceRows.map(row => row.m === 3 ? { ...row, w: 4, l: 1 } : row);
    const correction = await capture(f, correctionRows); expect(correction.value.contentId).not.toBe(first.value.contentId);
    expect(correction.value.value.matches[0].winner.value).toBe('4');
    expect(await read(f.mapping, { family: 'winners_bracket', bracketReceiptId: first.value.bracketReceiptId })).toEqual(first.value);
    for (const olderFirst of [true, false]) {
      const older = await reserve(f), newer = await reserve(f), olderInput = await observation(f, [{ m: 1, r: 1, t1: 1, t2: 2, w: 1, l: 2 }]),
        newerInput = await observation(f, [{ m: 1, r: 1, t1: 1, t2: 2, w: 2, l: 1, p: olderFirst ? 1 : 2 }]);
      const oldWrite = () => write(f, olderInput, older), newWrite = () => write(f, newerInput, newer);
      const a = await (olderFirst ? oldWrite() : newWrite()), b = await (olderFirst ? newWrite() : oldWrite());
      expect((olderFirst ? a : b).bracketAcceptance).toMatchObject({ status: 'preserved', reason: 'newer_network_attempt_reserved' });
      expect((olderFirst ? b : a).bracketAcceptance?.status).toBe('accepted');
      expect((await read(f.mapping, { family: 'winners_bracket' })).value.matches[0].winner.value).toBe('2');
    }
  }, 60_000);

  it('rejects unrelated source mappings receipts and forged normalized bracket facts', async () => {
    const f = await fixture(), first = await capture(f), other = await fixture();
    for (const [mapping, selection] of [[other.mapping, { family: 'winners_bracket', bracketReceiptId: first.value.bracketReceiptId }],
      [f.mapping, { family: 'losers_bracket', bracketReceiptId: first.value.bracketReceiptId }],
      [{ ...f.mapping, revisionId: randomUUID() }, { family: 'winners_bracket', bracketReceiptId: first.value.bracketReceiptId }]] as const)
      expect((await administration.readAcceptedBracket!(mapping, selection)).status).not.toBe('available');
    const attempt = await reserve(f), input = await observation(f, sourceRows), before = await history(f);
    const projection = projectPlayoffBracket(input); expect(projection.status).toBe('accepted');
    if (projection.status !== 'accepted') throw new Error('Missing fixture projection.');
    await expect(connection.database.query('SELECT public.record_league_administration_observation($1::jsonb)', [JSON.stringify({ ...input,
      sourceMapping: other.mapping, bracketAcceptance: { attempt }, bracketProjection: projection })])).rejects.toThrow();
    const forged = { ...projection, value: { ...projection.value, matches: projection.value.matches.map((match, index) => index === 0
      ? { ...match, winner: { state: 'supplied', raw: 99, value: '99' } } : match) } };
    await expect(connection.database.query('SELECT public.record_league_administration_observation($1::jsonb)', [JSON.stringify({ ...input,
      sourceMapping: f.mapping, bracketAcceptance: { attempt }, bracketProjection: forged })])).rejects.toThrow();
    expect(await history(f)).toEqual(before);
    const conflicts: { rows: JsonValue; error: RegExp }[] = [
      { rows: [{ m: 1, r: 1, t1: { w: 2 } }, { m: 2, r: 2, t1: { w: 1 } }], error: /cyclic bracket advancement/ },
      { rows: [{ m: 1, r: 1, t1: 1, t2: 1 }], error: /duplicate bracket entrants/ },
      { rows: [{ m: 1, r: 1, t1: 1, t2: 2, w: 1 }, { m: 2, r: 2, t1: 2, t1_from: { w: 1 } }], error: /resolved advancement conflict/ },
    ];
    for (const conflict of conflicts) {
      const token = await reserve(f), source = await observation(f, conflict.rows);
      expect(source.status).toBe('accepted');
      const original = await history(f);
      await expect(connection.database.query('SELECT public.record_league_administration_observation($1::jsonb)', [JSON.stringify({ ...source,
        sourceMapping: f.mapping, bracketAcceptance: { attempt: token },
        bracketProjection: { version: 'sleeper-playoff-brackets-v1', status: 'accepted', value: {}, diagnostics: [] } })])).rejects.toThrow(conflict.error);
      expect(await history(f)).toEqual(original);
    }
    // Each direct forgery rolls back; reservations in the independent conflict
    // loop are intentional evidence and do not imply accepted resource changes.
    expect((await read(f.mapping, { family: 'winners_bracket' })).bracketReceiptId).toBe(first.value.bracketReceiptId);
    await ownerQuery("SELECT revise_league_source_connection($1,'sleeper',$2,$3,'CP11 source fence')", [f.leagueSeasonId, f.mapping.revisionId, numericId()]);
    expect((await administration.readAcceptedBracket!(f.mapping, { family: 'winners_bracket', bracketReceiptId: first.value.bracketReceiptId })).status).not.toBe('available');
  }, 60_000);

  it('rolls back typed bracket acceptance after an observed lock outlives the original worker fence', async () => {
    const f = await fixture(); await capture(f);
    const head = await read(f.mapping, { family: 'winners_bracket' });
    const blocker = await createPinnedIntegrationDatabase('owner'), writer = await createPinnedIntegrationDatabase('runtime');
    const jobKey = 'cp11-fence-' + randomUUID(), workerId = randomUUID();
    await ownerQuery(`INSERT INTO projection_jobs(job_key,job_type,scheduled_for,state,lease_owner,lease_until,attempt_count)
      VALUES($1,'league-administration',clock_timestamp(),'running',$2,clock_timestamp()+interval '25 seconds',1)`, [jobKey, workerId]);
    const [clock] = await connection.database.query("SELECT clock_timestamp()+interval '12 seconds' AS at");
    const fence: AdministrationWriteFence = { jobKey, workerId, generation: 1, deadlineAt: exactMatchupClockInstant(clock.at) };
    let pending: Promise<{ error?: unknown }> | undefined, open = false;
    try {
      const [blockerPid] = await blocker.database.query('SELECT pg_backend_pid() AS pid'),
        [writerPid] = await writer.database.query('SELECT pg_backend_pid() AS pid,session_user AS role');
      expect(writerPid.role).toBe('league_one_runtime');
      const attempt = await reserve(f, 'winners_bracket', fence), input = await observation(f, [{ m: 1, r: 1, t1: 1, t2: 2, w: 2, l: 1 }]);
      const before = await history(f);
      await blocker.database.query('BEGIN'); open = true;
      await blocker.database.query('LOCK TABLE public.league_bracket_contents IN SHARE MODE');
      let settled = false;
      pending = write(f, input, attempt, fence, createLeagueAdministrationStore(writer.database))
        .then(() => ({}), error => ({ error })).finally(() => { settled = true; });
      let blocked = false;
      for (let poll = 0; poll < 50; poll++) {
        const [row] = await blocker.database.query(`SELECT $1::integer=ANY(pg_blocking_pids($2::integer))
          AND EXISTS(SELECT 1 FROM pg_locks held_lock WHERE held_lock.pid=$2::integer
            AND held_lock.relation='public.league_bracket_contents'::regclass AND held_lock.mode='RowExclusiveLock' AND NOT held_lock.granted) AS blocked`, [blockerPid.pid, writerPid.pid]);
        if (row.blocked) { blocked = true; break; } await delay(20);
      }
      expect(blocked).toBe(true); expect(settled).toBe(false);
      await blocker.database.query('SELECT pg_sleep(GREATEST(0,EXTRACT(EPOCH FROM ($1::timestamptz-clock_timestamp())))+0.025)', [fence.deadlineAt]);
      await blocker.database.query('COMMIT'); open = false;
      expect(String((await pending).error)).toMatch(/fence.*(?:stale|expired)|deadline/i);
      expect(await history(f)).toEqual(before); expect(await read(f.mapping, { family: 'winners_bracket' })).toEqual(head);
    } finally {
      if (open) await blocker.database.query('ROLLBACK'); await pending; await writer.close(); await blocker.close();
      await ownerQuery("UPDATE projection_jobs SET state='failed',lease_owner=NULL,lease_until=NULL,completed_at=clock_timestamp() WHERE job_key=$1", [jobKey]);
    }
    // Separate deferred-constraint witness: the original six-second synthetic
    // fence is live when the writer returns but expired before COMMIT validates
    // either a new typed header or a fresh receipt for existing content. Each
    // transaction has its own fixed fence; neither extends the twelve-second lock.
    const deferredPayloads: JsonValue[] = [[{ m: 1, r: 1, t1: 1, t2: 2, w: 2, l: 1, p: 'deferred' }], sourceRows];
    for (const payload of deferredPayloads) {
      const deferredWriter = await createPinnedIntegrationDatabase('runtime'), deferredJob = 'cp11-deferred-' + randomUUID(), deferredWorker = randomUUID();
      await ownerQuery(`INSERT INTO projection_jobs(job_key,job_type,scheduled_for,state,lease_owner,lease_until,attempt_count)
        VALUES($1,'league-administration',clock_timestamp(),'running',$2,clock_timestamp()+interval '20 seconds',1)`, [deferredJob, deferredWorker]);
      const beforeDeferred = await history(f);
      const [deadline] = await connection.database.query("SELECT clock_timestamp()+interval '6 seconds' AS at");
      const deferredFence: AdministrationWriteFence = { jobKey: deferredJob, workerId: deferredWorker, generation: 1, deadlineAt: exactMatchupClockInstant(deadline.at) };
      let deferredOpen = false;
      try {
        await deferredWriter.database.query('BEGIN'); deferredOpen = true;
        const store = createLeagueAdministrationStore(deferredWriter.database);
        const attempt = await store.beginBracketAttempt!(f.mapping, 'winners_bracket', randomUUID(), deferredFence);
        const input = await observation(f, payload);
        expect((await write(f, input, attempt, deferredFence, store)).bracketAcceptance?.status).toBe('accepted');
        await deferredWriter.database.query('SELECT pg_sleep(GREATEST(0,EXTRACT(EPOCH FROM ($1::timestamptz-clock_timestamp())))+0.025)', [deferredFence.deadlineAt]);
        await expect(deferredWriter.database.query('COMMIT')).rejects.toThrow(/fence.*(?:stale|expired)|deadline/i); deferredOpen = false;
        expect(await history(f)).toEqual(beforeDeferred);
        expect(await read(f.mapping, { family: 'winners_bracket' })).toEqual(head);
      } finally {
        if (deferredOpen) await deferredWriter.database.query('ROLLBACK'); await deferredWriter.close();
        await ownerQuery("UPDATE projection_jobs SET state='failed',lease_owner=NULL,lease_until=NULL,completed_at=clock_timestamp() WHERE job_key=$1", [deferredJob]);
      }
    }
  }, 60_000);

  it('denies direct typed mutations and private helpers while stored readers remain source free', async () => {
    const f = await fixture(), first = await capture(f), before = await history(f);
    for (const table of typedTables) {
      await expect(connection.database.query(`DELETE FROM public.${table} WHERE content_id=$1`, [first.value.contentId])).rejects.toThrow(/permission denied/);
      expect(await ownerQuery(`SELECT has_table_privilege('league_one_runtime',$1,'SELECT') AS read,
        has_table_privilege('league_one_runtime',$1,'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') AS write,
        has_table_privilege('league_one_auth',$1,'SELECT,INSERT,UPDATE,DELETE') AS auth`, ['public.' + table]))
        .toEqual([{ read: true, write: false, auth: false }]);
      await expect(ownerQuery(`DELETE FROM public.${table} WHERE content_id=$1`, [first.value.contentId])).rejects.toThrow(/immutable|history/);
    }
    await expect(ownerQuery("INSERT INTO public.league_bracket_rounds(content_id,round,external_matchup_ids) VALUES($1,99,ARRAY['99'])",
      [first.value.contentId])).rejects.toThrow(/history cannot gain later facts/);
    const helpers = ['public.bracket_native_field(jsonb,text,text)', 'public.project_bracket_native(jsonb,text,jsonb)',
      'public.bracket_typed_value(uuid)', 'public.validate_bracket_typed_lineage()',
      'public.guard_bracket_child_insert()', 'public.validate_bracket_acceptance_fence()', 'public.capture_bracket_typed(uuid,uuid,jsonb)', 'public.record_league_administration_observation_v45(jsonb)'];
    for (const helper of helpers) expect(await ownerQuery(`SELECT has_function_privilege('league_one_runtime',$1,'EXECUTE') AS runtime,
      has_function_privilege('league_one_auth',$1,'EXECUTE') AS auth`, [helper])).toEqual([{ runtime: false, auth: false }]);
    await expect(connection.database.query("SELECT public.bracket_native_field('{}'::jsonb,'t1','entrant')")).rejects.toThrow(/permission denied/);
    await expect(connection.database.query('SELECT public.bracket_typed_value($1::uuid)', [first.value.contentId])).rejects.toThrow(/permission denied/);
    const owner = await createPinnedIntegrationDatabase('owner');
    try {
      await owner.database.query('BEGIN');
      await owner.database.query(await readFile(new URL('../scripts/provision-runtime-role.sql', import.meta.url), 'utf8'));
      for (const table of typedTables) expect(await owner.database.query(`SELECT has_table_privilege('league_one_runtime',$1,'SELECT') AS read,
        has_table_privilege('league_one_runtime',$1,'INSERT,UPDATE,DELETE') AS write`, ['public.' + table])).toEqual([{ read: true, write: false }]);
    } finally { await owner.database.query('ROLLBACK'); await owner.close(); }
    await storedOnly(async store => {
      expect(await read(f.mapping, { family: 'winners_bracket', bracketReceiptId: first.value.bracketReceiptId }, store)).toEqual(first.value);
      expect((await read(f.mapping, { family: 'winners_bracket' }, store)).selection).toBe('current');
    });
    expect(await history(f)).toEqual(before);
  }, 60_000);
});
