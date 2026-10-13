import { createHash, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { DatabaseClient, DatabaseQueryOptions, DatabaseRow } from '../lib/database';
import type { JsonObject, JsonValue, NormalizedAdministrationObservation } from '../lib/league-administration/contracts';
import type { AdministrationSourceMapping } from '../lib/league-administration/source-mapping';
import type { AdministrationWriteFence } from '../lib/league-administration/store-contracts';
import type { RosterAttempt } from '../lib/aggregator/current-roster';
import { projectWeeklyReport, WEEKLY_REPORT_PAYLOAD_BYTE_LIMIT, WEEKLY_REPORT_VALUE_BYTE_LIMIT, type AcceptedWeeklyReportRead } from '../lib/aggregator/weekly-reports';
import { parsedOfficialDecimal } from '../lib/aggregator/exact-matchups';
import { normalizeAdministrationObservation } from '../lib/league-administration/normalize';
import { createLeagueAdministrationStore, createPublicIntakeStore, createPublicDataRefreshStore } from '../lib/league-administration/store';
import { runPublicIntakeStep, runPublicDataRefreshStep, type PublicIntakeDependencies } from '../lib/league-administration/public-intake';
import { readPublicSleeperIntake } from '../lib/league-administration/public-intake-reader';
import { readPublicDataRefresh } from '../lib/league-administration/public-refresh-reader';
import { PUBLIC_INTAKE_JOB } from '../lib/league-administration/public-intake-contracts';
import { createProjectionStore } from '../lib/projection-store';
import { capturePublicSleeperWeeklyReport } from '../lib/sleeper';
import retained from '../test-support/fixtures/cp13-live-source-2026/weekly-reports.json';
import { exactMatchupClockInstant } from './exact-matchup-clock';
import { createIndependentDatabase, createPinnedIntegrationDatabase, ownerQuery, type IndependentDatabase } from './neon-integration-harness';

const numericId = () => '7' + BigInt('0x' + randomUUID().replaceAll('-', '').slice(0, 15));
const digest = (value: string) => createHash('sha256').update(value).digest('hex');
const typedTables = ['league_weekly_report_contents', 'league_weekly_report_teams'] as const;
const selected = [{ season: 2026, nativeWeek: 1 }] as const;
const sourceRows = (correction = false): JsonObject[] => [
  { roster_id: 2, round: 1, rank: 1, wins: correction ? 2 : 1, losses: 0, ties: 0, points: correction ? 110.25 : 110.19999694824219,
    points_against: 110.2, record: correction ? 'WW' : 'W', streak: '1W' },
  { roster_id: 1, round: 1, rank: 2, wins: 0, losses: 1, ties: 0, points: 110.2, points_against: 110.19999694824219, record: 'L', streak: '1L' },
];
const document = (external: string, week = 1, rows = sourceRows()) => ({ data: { metadata: { key: external + '_' + week,
  type: 'league_report', created: 1791300069369, last_updated: 1791300069369, data: { week, standings: rows } } } });
type Available = Extract<AcceptedWeeklyReportRead, { status: 'available' }>;

/** AUTHORED / SQL-UNQUALIFIED. Seven 60s cases, one 1080s case and two 120s hooks
 * total 29m authored allowance, not measured fit. Retained native bodies use fresh
 * synthetic test acquisitions, distinct from their original fixture clocks and
 * native metadata clocks. No live provider capture or paid run is implied.
 * Original 20s worker, 60s admission and 30/40/50m work/lifecycle/CI limits remain. */
describe.sequential('weekly report facts through restricted PostgreSQL and ordinary intake', () => {
  let connection: IndependentDatabase;
  let administration: ReturnType<typeof createLeagueAdministrationStore>;
  const jobsToClose: string[] = [];
  beforeAll(async () => {
    connection = createIndependentDatabase(); administration = createLeagueAdministrationStore(connection.database);
    expect((await connection.database.query(`SELECT current_user,session_user,rolsuper,rolcreaterole,rolcreatedb
      FROM pg_roles WHERE rolname=current_user`))[0]).toEqual({ current_user: 'league_one_runtime', session_user: 'league_one_runtime',
      rolsuper: false, rolcreaterole: false, rolcreatedb: false });
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
        if (Date.now() >= until) throw new Error('Report shared minute cleanup did not settle.');
        await delay(250);
      }
    } finally { await connection.close(); }
  }, 120_000);
  async function fixture(external = numericId()) {
    const registered = await createProjectionStore(connection.database).registerLeagueSeason({ mode: 'official-data',
      leagueKey: 'cp13-report-' + randomUUID(), leagueName: 'CP13 report qualification', season: 2026, sleeperLeagueId: external });
    if (registered.kind !== 'stored') throw new Error('Report fixture registration unavailable.');
    await ownerQuery("INSERT INTO league_administration_enrollments(league_id,provider,evidence) VALUES($1,'sleeper','report synthetic prerequisite') ON CONFLICT DO NOTHING", [registered.value.leagueId]);
    await ownerQuery("INSERT INTO league_administration_enrollment_seasons(league_id,season,provider,evidence) VALUES($1,2026,'sleeper','report synthetic prerequisite') ON CONFLICT DO NOTHING", [registered.value.leagueId]);
    const mapping = await administration.readSourceMapping(external); if (!mapping) throw new Error('Report mapping unavailable.');
    return { ...registered.value, external, mapping };
  }
  type Fixture = { external: string; mapping: AdministrationSourceMapping; leagueSeasonId: string };
  async function fence(seconds = 20): Promise<AdministrationWriteFence> {
    const jobKey = 'cp13-report-' + randomUUID(), workerId = randomUUID(); jobsToClose.push(jobKey);
    await ownerQuery(`INSERT INTO projection_jobs(job_key,job_type,scheduled_for,state,lease_owner,lease_until,attempt_count)
      VALUES($1,'league-administration',clock_timestamp(),'running',$2,clock_timestamp()+interval '25 seconds',1)`, [jobKey, workerId]);
    const [clock] = await connection.database.query("SELECT clock_timestamp()+$1::integer*interval '1 second' AS at", [seconds]);
    return { jobKey, workerId, generation: 1, deadlineAt: exactMatchupClockInstant(clock.at) };
  }
  const reserve = (f: Fixture, week = 1, workFence?: AdministrationWriteFence, store = administration) => store.beginWeeklyReportAttempt!(f.mapping, week, randomUUID(), workFence);
  async function observation(f: Fixture, payload: JsonValue, week = 1, completeness: 'complete' | 'partial' = 'complete') {
    const [clock] = await connection.database.query('SELECT clock_timestamp() AS at FROM pg_sleep(0.005)');
    const at = exactMatchupClockInstant(clock.at);
    return normalizeAdministrationObservation({ schemaVersion: 'league-administration-v1', normalizerVersion: 'sleeper-administration-v1',
      dialect: 'sleeper-nfl-v1', scope: f.mapping.scope, family: 'weekly_report', week, completeness, payload,
      provenance: { origin: 'network', requestStartedAt: at, requestCompletedAt: at, sourceObservedAt: at, checkedAt: at } });
  }
  const writeInput = (f: Fixture, input: NormalizedAdministrationObservation, attempt: RosterAttempt, workFence?: AdministrationWriteFence) =>
    ({ ...input, sourceMapping: f.mapping, ...(workFence ? { writeFence: workFence } : {}), weeklyReportAcceptance: { attempt }, weeklyReportProjection: projectWeeklyReport(input) });
  const write = (f: Fixture, input: NormalizedAdministrationObservation, attempt: RosterAttempt, workFence?: AdministrationWriteFence, store = administration) =>
    store.recordObservation(input, workFence, f.mapping, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, { attempt });
  async function read(mapping: AdministrationSourceMapping, week = 1, receipt?: string, store = administration): Promise<Available> {
    const result = await store.readAcceptedWeeklyReport!(mapping, { nativeWeek: week, ...(receipt ? { reportReceiptId: receipt } : {}) });
    expect(result.status).toBe('available'); if (result.status !== 'available') throw new Error('Report read unavailable: ' + result.reason); return result;
  }
  async function capture(f: Fixture, payload: JsonValue = document(f.external), week = 1) {
    const attempt = await reserve(f, week), input = await observation(f, payload, week), result = await write(f, input, attempt);
    expect(result.weeklyReportAcceptance?.status).toBe('accepted');
    const receipt = result.weeklyReportAcceptance?.receiptId; if (!receipt) throw new Error('Report receipt missing.');
    const value = await read(f.mapping, week, receipt), projected = projectWeeklyReport(input);
    if (projected.status !== 'accepted') throw new Error('Report projection rejected.');
    expect({ ...value.value, teams: value.value.teams.map(({ seasonTeamId, ...team }) => { expect(seasonTeamId).toMatch(/^[0-9a-f-]{36}$/u); return team; }) }).toEqual(projected.value);
    expect(value.provenance).toEqual(input.envelope.provenance); return { attempt, input, result, value };
  }
  async function history(f: Fixture) {
    return connection.database.query(`SELECT
      (SELECT jsonb_agg(to_jsonb(content) ORDER BY content.id) FROM league_administration_contents content WHERE content.league_season_id=$1 AND content.family='weekly_report') AS contents,
      (SELECT jsonb_agg(to_jsonb(observation) ORDER BY observation.id) FROM league_administration_observations observation WHERE observation.league_season_id=$1 AND observation.family='weekly_report') AS observations,
      (SELECT jsonb_agg(to_jsonb(head) ORDER BY head.week) FROM league_administration_heads head WHERE head.league_season_id=$1 AND head.family='weekly_report') AS administration_heads,
      (SELECT jsonb_agg(to_jsonb(receipt) ORDER BY receipt.id) FROM league_roster_capture_receipts receipt JOIN league_roster_resource_attempts attempt ON attempt.id=receipt.attempt_id WHERE attempt.source_mapping->>'leagueSeasonId'=$1::text) AS receipts,
      (SELECT jsonb_agg(to_jsonb(accepted) ORDER BY accepted.id) FROM league_roster_resource_acceptances accepted JOIN league_roster_resource_scopes scope ON scope.id=accepted.scope_id WHERE scope.league_season_id=$1) AS acceptances,
      (SELECT jsonb_agg(to_jsonb(head) ORDER BY head.scope_id) FROM league_roster_resource_heads head JOIN league_roster_resource_scopes scope ON scope.id=head.scope_id WHERE scope.league_season_id=$1) AS heads,
      ${typedTables.map(table => `(SELECT jsonb_agg(to_jsonb(typed) ORDER BY to_jsonb(typed)::text) FROM public.${table} typed
        JOIN league_administration_contents content ON content.id=typed.content_id WHERE content.league_season_id=$1) AS ${table}`).join(',')}`, [f.leagueSeasonId]);
  }
  async function storedOnly<T>(body: (database: DatabaseClient, store: ReturnType<typeof createLeagueAdministrationStore>, queries: string[]) => Promise<T>) {
    const queries: string[] = [], database: DatabaseClient = { enabled: true,
      query: async <Row extends DatabaseRow = DatabaseRow>(sql: string, parameters?: readonly unknown[], options?: DatabaseQueryOptions) => {
        queries.push(sql); expect(sql).not.toMatch(/\b(?:INSERT|UPDATE|DELETE|CALL)\b/iu); return connection.database.query<Row>(sql, parameters, options);
      } };
    const existing = vi.isMockFunction(globalThis.fetch), fetch = existing ? vi.mocked(globalThis.fetch) : vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Report stored readers cannot acquire source.'));
    const calls = fetch.mock.calls.length;
    try { const result = await body(database, createLeagueAdministrationStore(database), queries); expect(fetch).toHaveBeenCalledTimes(calls); expect(queries.length).toBeGreaterThan(0); return result; }
    finally { if (!existing) fetch.mockRestore(); }
  }

  it('replays all twenty four retained native report rows through typed storage with independent clocks', async () => {
    const source = await readFile(new URL('../test-support/fixtures/cp13-live-source-2026/weekly-reports.json', import.meta.url), 'utf8');
    expect(JSON.parse(source)).toEqual(retained); expect(digest(JSON.stringify(retained))).toBe('878c67d15d23836fe44f5464311b50d561d9e7acd61a45336dab937e644d76ad');
    expect(retained.observations.map(item => [item.externalLeagueId, item.requestedWeek, item.report.document.data.metadata.data.standings.length]))
      .toEqual([['1395875117568913408', 1, 12], ['1395875117568913408', 4, 12]]);
    const external = retained.observations[0].externalLeagueId, existing = await connection.database.query(
      "SELECT id FROM league_source_connections WHERE provider='sleeper' AND external_league_id=$1", [external]);
    expect(existing.length).toBeLessThanOrEqual(1);
    // The full inventory also replays this native ID in the earlier evidence module.
    // Reuse that mapping; release only a connection created by this case so either order works.
    const created = existing.length === 0 ? await fixture(external) : null,
      mapping = created?.mapping ?? await administration.readSourceMapping(external);
    if (!mapping) throw new Error('Retained report mapping unavailable.');
    const f: Fixture = created ?? { external, mapping, leagueSeasonId: mapping.leagueSeasonId }, identities = new Map<string, string>(); let rows = 0;
    try {
      expect(mapping.scope).toMatchObject({ provider: 'sleeper', externalLeagueId: external, season: 2026 });
      for (const item of retained.observations) {
        const body = item.report.document, attempt = await reserve(f, item.requestedWeek); expect(digest(JSON.stringify(body))).toBe(item.report.sliceSha256);
        const [clock] = await connection.database.query('SELECT clock_timestamp() AS at'), until = Date.parse(exactMatchupClockInstant(clock.at)) + 20;
        expect(until - Date.now()).toBeLessThanOrEqual(2_000); if (Date.now() < until) await delay(until - Date.now());
        const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => {
          expect(String(url)).toBe('https://sleeper.com/graphql'); expect(init?.method).toBe('POST'); expect(init?.credentials).toBe('omit');
          expect(JSON.parse(String(init?.body)).query).toContain(item.externalLeagueId + '_' + item.requestedWeek);
          return new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } });
        });
        let input: NormalizedAdministrationObservation;
        try {
          const captured = await capturePublicSleeperWeeklyReport(f.external, item.requestedWeek, AbortSignal.timeout(20_000));
          expect(fetch).toHaveBeenCalledTimes(1); expect(captured.payload).toEqual(body);
          expect(Date.parse(captured.requestStartedAt)).toBeGreaterThan(Date.parse(item.report.source.requestCompletedAt));
          input = normalizeAdministrationObservation({ schemaVersion: 'league-administration-v1', normalizerVersion: 'sleeper-administration-v1', dialect: 'sleeper-nfl-v1',
            scope: f.mapping.scope, family: 'weekly_report', week: item.requestedWeek, completeness: 'complete', payload: body,
            provenance: { origin: 'network', requestStartedAt: captured.requestStartedAt, requestCompletedAt: captured.requestCompletedAt,
              sourceObservedAt: captured.sourceObservedAt ?? null, checkedAt: new Date().toISOString() } });
        } finally { fetch.mockRestore(); }
        const result = await write(f, input, attempt); expect(result.weeklyReportAcceptance?.status).toBe('accepted');
        await storedOnly(async (database, store) => {
          const value = await read(f.mapping, item.requestedWeek, result.weeklyReportAcceptance!.receiptId!, store);
          expect(value).toMatchObject({ freshness: 'unknown', historicalApplicability: 'report-only', provenance: input.envelope.provenance,
            value: { nativeWeek: item.requestedWeek, nativeReportWeek: item.requestedWeek, reportKey: body.data.metadata.key,
              metadata: { created: { value: body.data.metadata.created }, lastUpdated: { value: body.data.metadata.last_updated } } } });
          expect(value.value.teams).toHaveLength(12);
          for (const [index, native] of body.data.metadata.data.standings.entries()) {
            const team = value.value.teams[index]; rows++;
            expect(team).toMatchObject({ externalRosterId: String(native.roster_id), sourceOrdinal: index, round: { state: 'known', value: native.round },
              providerRank: { state: 'known', value: native.rank }, record: { state: 'known', value: native.record }, streak: { state: 'known', value: native.streak },
              wins: { state: 'known', value: native.wins }, losses: { state: 'known', value: native.losses }, ties: { state: 'known', value: native.ties },
              pointsFor: { state: 'known', value: parsedOfficialDecimal(native.points) }, pointsAgainst: { state: 'known', value: parsedOfficialDecimal(native.points_against) } });
            if (identities.has(team.externalRosterId)) expect(team.seasonTeamId).toBe(identities.get(team.externalRosterId)); else identities.set(team.externalRosterId, team.seasonTeamId);
          }
          expect(await database.query('SELECT payload FROM league_administration_contents WHERE id=$1', [value.contentId])).toEqual([{ payload: body }]);
        });
      }
      expect(rows).toBe(24); expect(identities.size).toBe(12); expect(retained.observations[0].report.source.requestCompletedAt).toBe('2026-10-12T19:34:18.941Z');
    } finally {
      if (created) await ownerQuery("SELECT revise_league_source_connection($1,'sleeper',$2,$3,'report native fixture release')",
        [created.leagueSeasonId, created.mapping.revisionId, numericId()]);
    }
  }, 60_000);

  it('preserves optional native field states decimals round identity and fail closed capacity boundaries', async () => {
    const f = await fixture(), rows: JsonObject[] = [
      { roster_id: 1, round: 7, rank: null, wins: 0, losses: null, ties: 'bad', points: 0, points_against: -1e-7, record: ' TW? ', streak: '' },
      { roster_id: 2, rank: 'bad', points: null, points_against: 'bad', record: null, streak: {} },
    ];
    const body = document(f.external, 1, rows); delete (body.data.metadata as Partial<typeof body.data.metadata>).created;
    const first = await capture(f, body);
    expect(first.value.value.teams[0]).toMatchObject({ round: { state: 'known', value: 7 }, providerRank: { state: 'null', value: null }, wins: { state: 'known', value: 0 },
      losses: { state: 'null' }, ties: { state: 'invalid' }, pointsFor: { value: '0' }, pointsAgainst: { value: '-0.0000001' }, record: { value: ' TW? ' }, streak: { value: '' } });
    expect(first.value.value.teams[1]).toMatchObject({ round: { state: 'absent' }, providerRank: { state: 'invalid' }, wins: { state: 'absent' },
      pointsFor: { state: 'null' }, pointsAgainst: { state: 'invalid' }, record: { state: 'null' }, streak: { state: 'invalid' } });
    expect(first.value.value.metadata.created.state).toBe('absent'); expect(first.value.value.nativeReportWeek).toBe(1);
    expect((await capture(f, document(f.external, 1, []))).value.value).toMatchObject({ publication: 'published', teams: [] });
    expect((await capture(f, { data: { metadata: null } })).value.value).toMatchObject({ publication: 'unpublished', nativeReportWeek: null, teams: [], metadata: { created: { state: 'absent' } } });
    expect((await capture(f)).value.value.publication).toBe('published');
    for (const bad of [document(f.external, 1, Array.from({ length: 21 }, (_, index) => ({ roster_id: index + 1 }))),
      document(f.external, 1, [{ roster_id: 1, record: 'x'.repeat(WEEKLY_REPORT_VALUE_BYTE_LIMIT) }])]) {
      const attempt = await reserve(f), input = await observation(f, bad); expect(input.status).toBe('rejected'); expect(projectWeeklyReport(input).status).toBe('rejected');
      expect((await write(f, input, attempt)).weeklyReportAcceptance?.status).toBe('preserved');
      expect((await administration.readAcceptedWeeklyReport!(f.mapping, { nativeWeek: 1 })).status).not.toBe('available');
      expect(await read(f.mapping, 1, first.value.reportReceiptId)).toEqual(first.value);
    }
    const attempt = await reserve(f), oversized = await observation(f, { ...document(f.external), unused: 'x'.repeat(WEEKLY_REPORT_PAYLOAD_BYTE_LIMIT) }),
      before = await history(f);
    expect(oversized.status).toBe('rejected'); expect(projectWeeklyReport(oversized).status).toBe('rejected');
    await expect(write(f, oversized, attempt)).rejects.toThrow('report payload byte limit exceeded');
    expect(await history(f)).toEqual(before);
    await expect(connection.database.query('SELECT public.record_league_administration_observation($1::jsonb)',
      [JSON.stringify({ ...oversized, sourceMapping: f.mapping })])).rejects.toThrow('report payload byte limit exceeded');
    expect(await history(f)).toEqual(before);
    expect(await administration.readAcceptedWeeklyReport!(f.mapping, { nativeWeek: 1 }))
      .toMatchObject({ status: 'unavailable', reason: 'latest_report_attempt_has_no_capture' });
    expect(await read(f.mapping, 1, first.value.reportReceiptId)).toEqual(first.value);
  }, 60_000);

  it('retains corrections equal native times replay ordering failed latest attempts and immutable receipts', async () => {
    const f = await fixture(), first = await capture(f), equal = await capture(f);
    expect(equal.value.contentId).toBe(first.value.contentId); expect(equal.value.reportReceiptId).not.toBe(first.value.reportReceiptId);
    const beforeReplay = await history(f);
    expect((await write(f, equal.input, equal.attempt)).weeklyReportAcceptance).toMatchObject({ status: 'accepted', reason: 'exact_receipt_replay' });
    expect(await history(f)).toEqual(beforeReplay);
    const correction = await capture(f, document(f.external, 1, sourceRows(true)));
    expect(correction.value.contentId).not.toBe(first.value.contentId); expect(correction.value.value.metadata).toEqual(first.value.value.metadata);
    expect(correction.value.value.teams[0].pointsFor.value).toBe('110.25');
    for (const newerFirst of [false, true]) {
      const oldAttempt = await reserve(f), oldInput = await observation(f, document(f.external)),
        newAttempt = await reserve(f), newInput = await observation(f, document(f.external, 1, sourceRows(true)));
      if (newerFirst) { await write(f, newInput, newAttempt); await write(f, oldInput, oldAttempt); }
      else { await write(f, oldInput, oldAttempt); await write(f, newInput, newAttempt); }
      expect((await read(f.mapping)).value.teams[0].pointsFor.value).toBe('110.25');
      expect(await read(f.mapping, 1, first.value.reportReceiptId)).toEqual(first.value);
    }
    const latest = await read(f.mapping), failedAttempt = await reserve(f);
    expect(await administration.readAcceptedWeeklyReport!(f.mapping, { nativeWeek: 1 })).toMatchObject({ status: 'unavailable', reason: 'latest_report_attempt_has_no_capture' });
    const partial = await observation(f, { ...document(f.external), errors: [{ message: 'partial report' }] });
    expect((await write(f, partial, failedAttempt)).weeklyReportAcceptance?.status).toBe('preserved');
    expect(await administration.readAcceptedWeeklyReport!(f.mapping, { nativeWeek: 1 })).toMatchObject({ status: 'unavailable', reason: 'report_capture_not_accepted' });
    expect(await read(f.mapping, 1, latest.reportReceiptId)).toEqual({ ...latest, selection: 'receipt' });
    const restored = await capture(f); expect(restored.value.contentId).toBe(first.value.contentId);
    expect(await read(f.mapping, 1, first.value.reportReceiptId)).toEqual(first.value);
  }, 60_000);

  it('rejects forged normalized facts native scope team identity and source mapping substitutions atomically', async () => {
    const f = await fixture(), other = await fixture(), first = await capture(f), attempt = await reserve(f), input = await observation(f, document(f.external));
    const good = writeInput(f, input, attempt), projection = projectWeeklyReport(input);
    if (projection.status !== 'accepted') throw new Error('Expected valid report projection.');
    const forgedValue = { ...projection.value, teams: projection.value.teams.map((team, index) => index ? team : { ...team, wins: { ...team.wins, value: 999 } }) };
    const badInputs: unknown[] = [{ ...good, weeklyReportProjection: { ...projection, value: forgedValue } },
      { ...good, value: { family: 'weekly_report', report: forgedValue } }, { ...good, sourceMapping: other.mapping },
      { ...good, envelope: { ...input.envelope, family: 'rosters' } }, { ...good, envelope: { ...input.envelope, week: 2 } },
      { ...good, weeklyReportAcceptance: { attempt: { ...attempt, scopeId: randomUUID() } } }];
    for (const changed of [{ ...document(f.external).data.metadata, key: other.external + '_1' },
      { ...document(f.external).data.metadata, type: 'other' }, { ...document(f.external).data.metadata, data: { week: 2, standings: sourceRows() } },
      { ...document(f.external).data.metadata, data: { week: 1, standings: [{ roster_id: 1 }, { roster_id: 1 }] } },
      { ...document(f.external).data.metadata, data: { week: 1, standings: [{ roster_id: '1' }] } }])
      badInputs.push({ ...good, envelope: { ...input.envelope, payload: { data: { metadata: changed } } } });
    const before = await history(f);
    for (const bad of badInputs) {
      await expect(connection.database.query('SELECT public.record_league_administration_observation($1::jsonb)', [JSON.stringify(bad)])).rejects.toThrow();
      expect(await history(f)).toEqual(before);
    }
    expect((await administration.readAcceptedWeeklyReport!(other.mapping, { nativeWeek: 1, reportReceiptId: first.value.reportReceiptId })).status).not.toBe('available');
    expect((await administration.readAcceptedWeeklyReport!(f.mapping, { nativeWeek: 2, reportReceiptId: first.value.reportReceiptId })).status).not.toBe('available');
    await ownerQuery("SELECT revise_league_source_connection($1,'sleeper',$2,$3,'report mapping fence')", [f.leagueSeasonId, f.mapping.revisionId, numericId()]);
    expect((await administration.readAcceptedWeeklyReport!(f.mapping, { nativeWeek: 1, reportReceiptId: first.value.reportReceiptId })).status).not.toBe('available');
  }, 60_000);

  it('rolls back observed relation locks and deferred changed or equal receipts under original fences', async () => {
    const f = await fixture(), first = await capture(f), blocker = await createPinnedIntegrationDatabase('owner'), writer = await createPinnedIntegrationDatabase('runtime');
    let open = false, pending: Promise<{ error?: unknown }> | undefined;
    try {
      const workFence = await fence(12), attempt = await reserve(f, 1, workFence), input = await observation(f, document(f.external, 1, sourceRows(true)));
      const before = await history(f), [blockerPid] = await blocker.database.query('SELECT pg_backend_pid() AS pid'),
        [writerPid] = await writer.database.query('SELECT pg_backend_pid() AS pid,current_user AS role');
      expect(writerPid.role).toBe('league_one_runtime'); await blocker.database.query('BEGIN'); open = true;
      await blocker.database.query('LOCK TABLE public.league_weekly_report_contents IN SHARE MODE');
      let settled = false;
      pending = write(f, input, attempt, workFence, createLeagueAdministrationStore(writer.database))
        .then(() => ({}), error => ({ error })).finally(() => { settled = true; });
      let blocked = false;
      for (let poll = 0; poll < 50; poll++) {
        const [row] = await blocker.database.query(`SELECT $1::integer=ANY(pg_blocking_pids($2::integer))
          AND EXISTS(SELECT 1 FROM pg_locks held_lock WHERE held_lock.pid=$2::integer
            AND held_lock.relation='public.league_weekly_report_contents'::regclass AND held_lock.mode='RowExclusiveLock' AND NOT held_lock.granted) AS blocked`, [blockerPid.pid, writerPid.pid]);
        if (row.blocked) { blocked = true; break; } await delay(20);
      }
      expect(blocked).toBe(true); expect(settled).toBe(false);
      await blocker.database.query('SELECT pg_sleep(GREATEST(0,EXTRACT(EPOCH FROM ($1::timestamptz-clock_timestamp())))+0.025)', [workFence.deadlineAt]);
      await blocker.database.query('COMMIT'); open = false;
      expect(String((await pending).error)).toMatch(/fence.*(?:stale|expired)|deadline/iu);
      expect(await history(f)).toEqual(before); expect(await read(f.mapping, 1, first.value.reportReceiptId)).toEqual(first.value);
    } finally { if (open) await blocker.database.query('ROLLBACK'); await pending; await writer.close(); await blocker.close(); }
    for (const body of [document(f.external, 1, sourceRows(true)), document(f.external)]) {
      const deferred = await createPinnedIntegrationDatabase('runtime'), workFence = await fence(6), before = await history(f); let transaction = false;
      try {
        await deferred.database.query('BEGIN'); transaction = true;
        const store = createLeagueAdministrationStore(deferred.database), attempt = await reserve(f, 1, workFence, store), input = await observation(f, body);
        expect((await write(f, input, attempt, workFence, store)).weeklyReportAcceptance?.status).toBe('accepted');
        expect((await deferred.database.query('SELECT clock_timestamp()<$1::timestamptz AS live', [workFence.deadlineAt]))[0].live).toBe(true);
        await deferred.database.query('SELECT pg_sleep(GREATEST(0,EXTRACT(EPOCH FROM ($1::timestamptz-clock_timestamp())))+0.025)', [workFence.deadlineAt]);
        await expect(deferred.database.query('COMMIT')).rejects.toThrow(/fence.*(?:stale|expired)|deadline/iu); transaction = false;
        expect(await history(f)).toEqual(before); expect(await read(f.mapping, 1, first.value.reportReceiptId)).toEqual(first.value);
      } finally { if (transaction) await deferred.database.query('ROLLBACK'); await deferred.close(); }
    }
  }, 60_000);

  it('denies typed mutations private helpers and late history changes while stored reads stay source free', async () => {
    const f = await fixture(), first = await capture(f), before = await history(f);
    for (const table of typedTables) {
      await expect(connection.database.query(`DELETE FROM public.${table} WHERE content_id=$1`, [first.value.contentId])).rejects.toThrow(/permission denied/iu);
      expect(await ownerQuery(`SELECT has_table_privilege('league_one_runtime',$1,'SELECT') AS read,
        has_table_privilege('league_one_runtime',$1,'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') AS write,
        has_table_privilege('league_one_auth',$1,'SELECT,INSERT,UPDATE,DELETE') AS auth`, ['public.' + table])).toEqual([{ read: true, write: false, auth: false }]);
      await expect(ownerQuery(`DELETE FROM public.${table} WHERE content_id=$1`, [first.value.contentId])).rejects.toThrow(/immutable|history/iu);
    }
    const helpers = ['public.weekly_report_native_fact(jsonb,text,text,text,integer)', 'public.project_weekly_report_native(jsonb,text,integer,jsonb)',
      'public.weekly_report_typed_value(uuid)', 'public.capture_weekly_report_typed(uuid,uuid,jsonb)', 'public.validate_weekly_report_typed_lineage()',
      'public.guard_weekly_report_team_insert()', 'public.validate_weekly_report_receipt_fence()', 'public.validate_weekly_report_acceptance_fence()',
      'public.record_league_administration_observation_v48(jsonb)'];
    for (const helper of helpers) expect(await ownerQuery(`SELECT has_function_privilege('league_one_runtime',$1,'EXECUTE') AS runtime,
      has_function_privilege('league_one_auth',$1,'EXECUTE') AS auth`, [helper])).toEqual([{ runtime: false, auth: false }]);
    await expect(connection.database.query('SELECT public.weekly_report_typed_value($1::uuid)', [first.value.contentId])).rejects.toThrow(/permission denied/iu);
    await expect(ownerQuery(`INSERT INTO public.league_weekly_report_teams(content_id,external_roster_id,season_team_id,source_ordinal,field_states)
      VALUES($1,'99',$2,19,'{}')`, [first.value.contentId, first.value.value.teams[0].seasonTeamId])).rejects.toThrow(/original capture transaction/iu);
    const owner = await createPinnedIntegrationDatabase('owner');
    try {
      await owner.database.query('BEGIN'); await owner.database.query(await readFile(new URL('../scripts/provision-runtime-role.sql', import.meta.url), 'utf8'));
      for (const table of [...typedTables, 'public_data_report_tasks', 'public_data_report_checkpoints']) expect(await owner.database.query(`SELECT
        has_table_privilege('league_one_runtime',$1,'SELECT') AS read,has_table_privilege('league_one_runtime',$1,'INSERT,UPDATE,DELETE') AS write`, ['public.' + table]))
        .toEqual([{ read: true, write: false }]);
    } finally { await owner.database.query('ROLLBACK'); await owner.close(); }
    await storedOnly(async (_database, store) => expect(await read(f.mapping, 1, first.value.reportReceiptId, store)).toEqual(first.value));
    expect(await history(f)).toEqual(before);
  }, 60_000);

  it('validates optional selectors immutable request scope and report task permissions before admission', async () => {
    const runtime = await createPinnedIntegrationDatabase('runtime'); let open = false;
    try {
      await runtime.database.query('BEGIN'); open = true;
      const base = { id: randomUUID(), username: 'cp13_report_scope', seasons: [2026] };
      const submit = (input: unknown) => runtime.database.query('SELECT public.submit_public_data_intake($1::jsonb)', [JSON.stringify(input)]);
      for (const input of [{ ...base, weeklyReports: null }, { ...base, weeklyReports: 'all' }, { ...base, weeklyReports: [{ season: 2025, nativeWeek: 1 }] },
        { ...base, weeklyReports: [{ season: 2026, nativeWeek: 0 }] }, { ...base, weeklyReports: [{ season: 2026, nativeWeek: 19 }] },
        { ...base, weeklyReports: [...selected, ...selected] }, { ...base, seasons: [2025], weeklyReports: selected }]) {
        await runtime.database.query('SAVEPOINT invalid_scope');
        try { await expect(submit(input)).rejects.toThrow(); } finally { await runtime.database.query('ROLLBACK TO SAVEPOINT invalid_scope'); }
        expect(await runtime.database.query('SELECT id FROM public_data_intakes WHERE id=$1', [base.id])).toEqual([]);
      }
      await submit(base); await submit({ ...base, weeklyReports: [] });
      const queries: string[] = [], database: DatabaseClient = { enabled: true, query: async <Row extends DatabaseRow = DatabaseRow>(sql: string, params?: readonly unknown[], options?: DatabaseQueryOptions) => {
        queries.push(sql); return runtime.database.query<Row>(sql, params, options);
      } };
      const unselected = await readPublicSleeperIntake(database, createLeagueAdministrationStore(database), base.id);
      expect(unselected).not.toHaveProperty('weeklyReports'); expect(queries.some(sql => sql.includes('read-weekly-reports'))).toBe(false);
      const choice = { ...base, id: randomUUID(), weeklyReports: selected }; await submit(choice); await submit(choice);
      await runtime.database.query('SAVEPOINT changed_scope');
      try { await expect(submit({ ...choice, weeklyReports: [{ season: 2026, nativeWeek: 4 }] })).rejects.toThrow(/replay mismatch/iu); }
      finally { await runtime.database.query('ROLLBACK TO SAVEPOINT changed_scope'); }
      expect(await runtime.database.query('SELECT * FROM public_data_dispatches WHERE intake_id=ANY($1::uuid[])', [[base.id, choice.id]])).toEqual([]);
      expect(await runtime.database.query('SELECT * FROM public_data_report_tasks WHERE intake_id=ANY($1::uuid[])', [[base.id, choice.id]])).toEqual([]);
      for (const table of ['public_data_report_tasks', 'public_data_report_checkpoints']) {
        await runtime.database.query('SAVEPOINT denied_mutation');
        try { await expect(runtime.database.query(`DELETE FROM public.${table} WHERE intake_id=$1`, [choice.id])).rejects.toThrow(/permission denied/iu); }
        finally { await runtime.database.query('ROLLBACK TO SAVEPOINT denied_mutation'); }
      }
      await runtime.database.query('SAVEPOINT denied_helper');
      try { await expect(runtime.database.query("SELECT public.canonical_public_data_weekly_reports('[]'::jsonb,ARRAY[2026])")).rejects.toThrow(/permission denied/iu); }
      finally { await runtime.database.query('ROLLBACK TO SAVEPOINT denied_helper'); }
    } finally { if (open) await runtime.database.query('ROLLBACK'); await runtime.close(); }
  }, 60_000);

  it('composes one post report intake and failed refresh recovery through immutable witnessed selections', async () => {
    const id = randomUUID(), manager = numericId(), external = numericId(), username = 'cp13_report_' + manager;
    const league = { league_id: external, season: '2026', sport: 'nfl', name: 'Report ordinary qualification',
      total_rosters: 2, roster_positions: ['QB', 'BN'], scoring_settings: { pass_yd: 0.04 }, settings: { type: 0 } };
    const urls: string[] = []; let correction = false, failReport = false, admissions = 0, claims = 0;
    const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = String(input); urls.push(url); const base = 'https://api.sleeper.app/v1/league/' + external;
      if (url === 'https://sleeper.com/graphql') {
        expect(init?.method).toBe('POST'); expect(init?.credentials).toBe('omit'); expect(init?.redirect).toBe('error');
        expect(JSON.parse(String(init?.body)).query).toContain(external + '_1');
        return new Response(JSON.stringify({ ...document(external, 1, sourceRows(correction)), ...(failReport ? { errors: [{ message: 'partial report' }] } : {}) }));
      }
      expect(init?.method ?? 'GET').toBe('GET');
      if (url === 'https://api.sleeper.app/v1/user/' + username || url === 'https://api.sleeper.app/v1/user/' + manager) return new Response(JSON.stringify({ user_id: manager, username }));
      if (url === 'https://api.sleeper.app/v1/user/' + manager + '/leagues/nfl/2026') return new Response(JSON.stringify([league]));
      if (url === base) return new Response(JSON.stringify(league));
      if (url === base + '/rosters') return new Response(JSON.stringify([1, 2].map(roster_id => ({ roster_id,
        owner_id: roster_id === 1 ? manager : null, co_owners: [], players: [], starters: [], reserve: [], taxi: [],
        settings: { wins: 0, losses: 0, ties: 0, fpts: 0, fpts_against: 0 } }))));
      if (url === base + '/users') return new Response(JSON.stringify([{ user_id: manager, display_name: username }]));
      throw new Error('Unexpected report synthetic acquisition: ' + url);
    });
    const intake = createPublicIntakeStore(connection.database), refresh = createPublicDataRefreshStore(connection.database), jobs = createProjectionStore(connection.database);
    const dependencies: PublicIntakeDependencies = { intake: { ...intake, admit: async (...args) => {
      const admitted = await intake.admit(...args); if (admitted) admissions++; return admitted;
    } }, administration, jobs: { ...jobs, acquireJob: async (...args) => {
      const claim = await jobs.acquireJob(...args); if (claim.kind === 'acquired') claims++; return claim;
    } } };
    const zeroClaims = { recovery: 0, settlement: 0 };
    async function step(recurring: boolean, phase?: keyof typeof zeroClaims) {
      const before = { claims, admissions, requests: urls.length };
      const outcome = recurring ? await runPublicDataRefreshStep({ ...dependencies, refresh }, AbortSignal.timeout(20_000))
        : await runPublicIntakeStep(id, dependencies, AbortSignal.timeout(20_000));
      const acquired = claims - before.claims, admitted = admissions - before.admissions;
      expect([0, 1]).toContain(acquired); expect([0, 1]).toContain(admitted); expect(urls.length - before.requests).toBe(outcome.providerRequests);
      if (!acquired) { expect(admitted).toBe(0); expect(outcome).toEqual({ status: 'busy', providerRequests: 0 }); }
      else if (!admitted) {
        expect(outcome).toEqual({ status: 'backoff', providerRequests: 0 }); if (!phase) throw new Error('Unexpected report zero-request claim.');
        zeroClaims[phase]++; expect(zeroClaims[phase]).toBeLessThanOrEqual(1);
      } else { expect(acquired).toBe(1); expect(outcome.providerRequests).toBeGreaterThan(0); }
      return outcome;
    }
    async function progress(recurring: boolean, resource: string, status = 'progress', recovery = false) {
      const until = Date.now() + 150_000;
      do {
        const outcome = await step(recurring, recovery ? 'recovery' : undefined);
        if (['busy', 'backoff', 'idle'].includes(outcome.status)) { await delay(1_000); continue; }
        expect(outcome).toMatchObject({ status, resource, providerRequests: resource === 'core' ? 2 : 1 }); return;
      } while (Date.now() < until);
      throw new Error('Report stage exceeded existing admission allowance.');
    }
    const configuration = { id: randomUUID(), expectedRevision: 0, identityRequestId: id, seasons: [2026], weeklyReports: selected,
      cadenceSeconds: 3600, expiresAt: new Date(Date.now() + 25 * 60_000).toISOString(), paused: false };
    let target: { targetId: string; configurationRevision: number } | undefined;
    try {
      await intake.submit({ id, username, seasons: [2026], weeklyReports: selected });
      for (const resource of ['identity', 'leagues', 'bootstrap', 'weekly-report', 'core', 'users']) await progress(false, resource);
      expect(admissions).toBe(6); expect(urls).toHaveLength(7); expect(await intake.next(id)).toBe('complete');
      const mapping = await administration.readSourceMapping(external); if (!mapping) throw new Error('Ordinary report mapping unavailable.');
      const original = await readPublicSleeperIntake(connection.database, administration, id, { officialResultsVersion: 'v1' });
      if (original.status === 'missing' || !original.weeklyReports || !original.officialResults) throw new Error('Original report selection missing.');
      const originalReports = original.weeklyReports, originalResults = original.officialResults, old = originalReports[0].resource;
      if (old.status !== 'available') throw new Error('Original accepted report missing.');
      expect(original).toMatchObject({ status: 'available', request: { weeklyReports: selected },
        weeklyReports: [{ collection: 'complete', nativeWeek: 1, resource: { selection: 'receipt', value: { publication: 'published' } } }],
        officialResults: [{ resource: { reports: [{ nativeWeek: 1, resource: { reportReceiptId: old.reportReceiptId } }] } }] });
      target = await refresh.configure(configuration); correction = true;
      for (const resource of ['identity', 'leagues', 'bootstrap']) await progress(true, resource);
      const pending = await readPublicDataRefresh(connection.database, administration, target.targetId, { officialResultsVersion: 'v1' });
      if (pending.status !== 'available' || !pending.cycle) throw new Error('Report refresh cycle missing.');
      const currentId = pending.cycle.requestId; expect(currentId).not.toBe(id);
      failReport = true; await progress(true, 'weekly-report', 'unavailable'); failReport = false;
      expect(await intake.next(currentId)).toBe('backoff');
      await storedOnly(async (database, store) => {
        expect(await readPublicDataRefresh(database, store, target!.targetId, { officialResultsVersion: 'v1' })).toMatchObject({
          status: 'available', cycle: { requestId: currentId, outcome: null }, intake: { status: 'pending', weeklyReports: [
            { collection: 'pending', failureCount: 1, resource: { status: 'unavailable', reason: 'report-capture-not-complete' }, acquisition: null } ] } });
        expect(await database.query('SELECT report_receipt_id FROM public_data_report_checkpoints WHERE intake_id=$1', [currentId])).toEqual([]);
        expect((await store.readAcceptedWeeklyReport!(mapping, { nativeWeek: 1 })).status).not.toBe('available');
        expect(await read(mapping, 1, old.reportReceiptId, store)).toEqual(old);
        const previous = await readPublicSleeperIntake(database, store, id, { officialResultsVersion: 'v1' });
        if (previous.status === 'missing') throw new Error('Original report request missing.');
        expect(previous.weeklyReports).toEqual(originalReports); expect(previous.officialResults).toEqual(originalResults);
      });
      await progress(true, 'weekly-report', 'progress', true); await progress(true, 'core'); await progress(true, 'users');
      expect(admissions).toBe(13); expect(urls).toHaveLength(15);
      const until = Date.now() + 150_000;
      while (true) {
        const outcome = await step(true, 'settlement');
        if (outcome.status === 'busy') { if (Date.now() >= until) throw new Error('Report settlement exceeded allowance.'); await delay(1_000); continue; }
        expect(outcome.providerRequests).toBe(0); break;
      }
      expect(zeroClaims.settlement).toBe(1); expect(admissions).toBe(13); expect(claims).toBe(14 + zeroClaims.recovery);
      expect(urls.filter(url => url === 'https://sleeper.com/graphql')).toHaveLength(3);
      expect(await intake.next(currentId)).toBe('complete');
      await storedOnly(async (database, store, queries) => {
        const current = await readPublicDataRefresh(database, store, target!.targetId, { officialResultsVersion: 'v1' });
        expect(current).toMatchObject({ status: 'available', target: { weeklyReports: selected },
          cycle: { requestId: currentId, weeklyReports: selected, outcome: { disposition: 'complete' } },
          intake: { status: 'available', weeklyReports: [{ collection: 'complete', failureCount: 1, resource: { status: 'available' } }] } });
        const corrected = await read(mapping, 1, undefined, store);
        expect(corrected.reportReceiptId).not.toBe(old.reportReceiptId); expect(corrected.value.metadata).toEqual(old.value.metadata);
        expect(corrected.value.teams[0].pointsFor.value).toBe('110.25'); expect(await read(mapping, 1, old.reportReceiptId, store)).toEqual(old);
        const previous = await readPublicSleeperIntake(database, store, id, { officialResultsVersion: 'v1' });
        if (previous.status === 'missing') throw new Error('Original report request disappeared.');
        expect(previous.weeklyReports).toEqual(originalReports); expect(previous.officialResults).toEqual(originalResults);
        queries.length = 0; expect(await readPublicSleeperIntake(database, store, currentId)).not.toHaveProperty('officialResults');
        expect(queries.some(sql => sql.includes('read-weekly-reports'))).toBe(true);
      });
      const [spacing] = await connection.database.query(`SELECT count(*)::integer AS count,
        bool_and(history.previous IS NULL OR history.admitted_at-history.previous>=interval '60 seconds') AS spaced
        FROM(SELECT dispatch.admitted_at,lag(dispatch.admitted_at) OVER(ORDER BY dispatch.admitted_at) AS previous
          FROM public_data_dispatches dispatch WHERE dispatch.intake_id=ANY($1::uuid[])) history`, [[id, currentId]]);
      expect(spacing).toEqual({ count: 13, spaced: true });
      const witnesses = await connection.database.query(`SELECT receipt.provenance->'acquisition'->'work'=dispatch.work
          AND receipt.provenance->'acquisition'->>'dispatchNonce'=dispatch.capture_nonce::text
          AND receipt.provenance->'acquisition'->'fence'=attempt.write_fence AS witnessed,
        attempt.reserved_at>=dispatch.admitted_at AND receipt.recorded_at>=attempt.reserved_at AS ordered,
        dispatch.max_requests FROM public_data_report_checkpoints checkpoint
        JOIN league_roster_capture_receipts receipt ON receipt.id=checkpoint.report_receipt_id
        JOIN league_roster_resource_attempts attempt ON attempt.id=receipt.attempt_id
        JOIN public_data_dispatches dispatch ON dispatch.intake_id=checkpoint.intake_id AND dispatch.worker_id=checkpoint.worker_id AND dispatch.generation=checkpoint.generation
        WHERE checkpoint.intake_id=ANY($1::uuid[])`, [[id, currentId]]);
      expect(witnesses).toEqual([{ witnessed: true, ordered: true, max_requests: 1 }, { witnessed: true, ordered: true, max_requests: 1 }]);
      expect(fetch).toHaveBeenCalledTimes(15);
    } finally {
      fetch.mockRestore();
      if (target) await refresh.configure({ ...configuration, expectedRevision: target.configurationRevision, expiresAt: new Date(Date.now() + 60_000).toISOString(), paused: true });
    }
  }, 1_080_000);
});
