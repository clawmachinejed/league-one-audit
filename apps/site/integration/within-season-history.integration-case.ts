import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import calendarFixture from '../test-support/fixtures/sleeper-2026-season-schedule.json';
import type { DatabaseClient, DatabaseQueryOptions, DatabaseRow } from '../lib/database';
import type { ConfigurationComponentName, JsonObject, JsonValue, PublicCaptureWitness } from '../lib/league-administration/contracts';
import type { AdministrationWriteFence } from '../lib/league-administration/store-contracts';
import { normalizeAdministrationObservation } from '../lib/league-administration/normalize';
import { createSleeperCalendarEvidence } from '../lib/league-administration/period-mapping';
import { createLeagueAdministrationStore, createPublicIntakeStore } from '../lib/league-administration/store';
import { readPublicSleeperIntake } from '../lib/league-administration/public-intake-reader';
import { PUBLIC_INTAKE_JOB, PUBLIC_PERIOD_INVENTORY, PUBLIC_PLAYOFF_BRACKETS,
  type PublicIntakeReadOptions } from '../lib/league-administration/public-intake-contracts';
import { createRetainedMatchupComparison } from '../lib/league-administration/retained-matchup-comparison';
import type { RetainedMatchupSelection } from '../lib/league-administration/retained-matchups-contracts';
import { createProjectionStore } from '../lib/projection-store';
import { exactMatchupClockInstant } from './exact-matchup-clock';
import { createIndependentDatabase, ownerQuery, type IndependentDatabase } from './neon-integration-harness';

const weeks = Array.from({ length: 18 }, (_, index) => index + 1);
const families = ['winners_bracket', 'losers_bracket'] as const;
const numericId = () => '7' + BigInt('0x' + randomUUID().replaceAll('-', '').slice(0, 15));
const rules = { rec: 0.5 };
const nativeRows = (week: number, changed = false): JsonValue => [1, 2, 3, 4].map(roster_id => ({
  roster_id, matchup_id: changed ? [1, 3].includes(roster_id) ? 1 : 2 : roster_id <= 2 ? 1 : 2,
  players: [], starters: [], points: roster_id === 1 ? 100.25 + week : roster_id === 2 ? -2.25 : roster_id + week,
  ...(roster_id === 1 ? { custom_points: changed ? -7.75 : 0 } : {}),
}));
const bracketRows: JsonValue = [
  { r: 1, m: 1, t1: 1, t2: 2, w: 1, l: 2 },
  { r: 1, m: 2, t1: 3, t2: 4, w: 3, l: 4 },
  { r: 2, m: 3, t1: { w: 1 }, t2: { w: 2 }, w: null, l: null },
];

/** AUTHORED / SQL-UNQUALIFIED CP20 composition witness. All source documents are
 * synthetic 2026 fixtures. Canonical registration/enrollment, a current job plus
 * dispatch row for each selected step, and completed candidate prerequisites are
 * direct isolated setup. This bypasses admission and core acquisition deliberately;
 * it is not ordinary intake, elapsed cadence, live provider or fleet proof.
 * Identity/list checkpoints, reservations, witnesses, typed writes and period /
 * bracket checkpoints use maintained restricted functions, original twenty-second
 * fences and every installed trigger. Nothing disables a guard or fabricates typed
 * accepted rows. Reads are the actual public request reader and stored comparison.
 * Five cases (300/90/120/120/90s) + two 120s hooks = 16m authored allowance; fit is
 * unmeasured. Existing 30m work / 40m lifecycle / 50m CI and no-retry rules remain. */
describe.sequential('generic within season history through restricted PostgreSQL', () => {
  let connection: IndependentDatabase;
  let administration: ReturnType<typeof createLeagueAdministrationStore>;
  let intake: ReturnType<typeof createPublicIntakeStore>;
  const ownedWorkers: string[] = [];
  beforeAll(async () => {
    connection = createIndependentDatabase(); administration = createLeagueAdministrationStore(connection.database);
    intake = createPublicIntakeStore(connection.database);
    expect((await connection.database.query(`SELECT current_user,session_user,rolsuper,rolcreaterole,rolcreatedb
      FROM pg_roles WHERE rolname=current_user`))[0]).toEqual({ current_user: 'league_one_runtime',
      session_user: 'league_one_runtime', rolsuper: false, rolcreaterole: false, rolcreatedb: false });
  }, 120_000);
  afterAll(async () => {
    vi.restoreAllMocks();
    try {
      if (ownedWorkers.length) await ownerQuery(`UPDATE projection_jobs SET state='failed',lease_owner=NULL,
        lease_until=NULL,completed_at=clock_timestamp() WHERE job_key=$1 AND lease_owner=ANY($2::text[])`, [PUBLIC_INTAKE_JOB, ownedWorkers]);
      const until = Date.now() + 85_000;
      while (true) {
        const [row] = await connection.database.query(`SELECT NOT EXISTS(SELECT 1 FROM public_data_dispatches
          WHERE admitted_at>clock_timestamp()-interval '60 seconds') AS ready`);
        if (row.ready === true) break;
        if (Date.now() >= until) throw new Error('CP20 shared-minute cleanup did not settle.');
        await delay(250);
      }
    } finally { await connection.close(); }
  }, 120_000);
  async function now() {
    const [row] = await connection.database.query('SELECT clock_timestamp() AS at FROM pg_sleep(0.005)');
    return exactMatchupClockInstant(row.at);
  }
  async function fixture(type = 0) {
    const external = numericId(), leagueKey = 'cp20-' + randomUUID();
    const registered = await createProjectionStore(connection.database).registerLeagueSeason({ leagueKey,
      leagueName: 'CP20 synthetic 2026 type ' + type, season: 2026, sleeperLeagueId: external, scoringRules: rules });
    if (registered.kind !== 'stored') throw new Error('CP20 registration unavailable.');
    await ownerQuery("INSERT INTO league_administration_enrollments(league_id,provider,evidence) VALUES($1,'sleeper','CP20 disclosed synthetic prerequisite')", [registered.value.leagueId]);
    await ownerQuery("INSERT INTO league_administration_enrollment_seasons(league_id,season,provider,evidence) VALUES($1,2026,'sleeper','CP20 disclosed synthetic prerequisite')", [registered.value.leagueId]);
    const mapping = await administration.readSourceMapping(external); if (!mapping) throw new Error('Missing CP20 mapping.');
    const payload: JsonObject = { league_id: external, season: '2026', sport: 'nfl', season_type: 'regular',
      name: 'CP20 synthetic 2026 type ' + type, status: 'in_season', total_rosters: 4,
      roster_positions: ['QB', 'BN'], scoring_settings: rules,
      settings: { type, leg: 18, last_scored_leg: 17, start_week: 1, playoff_week_start: 15, playoff_round_type: 2 } };
    return { ...registered.value, external, mapping, payload };
  }
  type Fixture = Awaited<ReturnType<typeof fixture>>;
  async function dispatch(requestId: string) {
    const work = await intake.next(requestId); if (typeof work === 'string') throw new Error('CP20 expected selected work, got ' + work);
    const workerId = randomUUID(); ownedWorkers.push(workerId);
    // Direct original owner/dispatch prerequisites, never an accelerated call to admit().
    const [job] = await ownerQuery(`INSERT INTO projection_jobs(job_key,job_type,scheduled_for,state,lease_owner,lease_until,attempt_count,payload)
      VALUES($1,$1,clock_timestamp(),'running',$2,clock_timestamp()+interval '25 seconds',1,$3::jsonb)
      ON CONFLICT(job_key) DO UPDATE SET state='running',lease_owner=EXCLUDED.lease_owner,
        lease_until=EXCLUDED.lease_until,attempt_count=projection_jobs.attempt_count+1,payload=EXCLUDED.payload,
        scheduled_for=EXCLUDED.scheduled_for,completed_at=NULL
      WHERE projection_jobs.state<>'running' OR projection_jobs.lease_until<=clock_timestamp()
      RETURNING attempt_count AS generation,clock_timestamp()+interval '20 seconds' AS deadline`,
    [PUBLIC_INTAKE_JOB, workerId, JSON.stringify({ requestId })]);
    if (!job) throw new Error('CP20 refuses to replace a live unrelated owner.');
    const fence: AdministrationWriteFence = { jobKey: PUBLIC_INTAKE_JOB, workerId,
      generation: Number(job.generation), deadlineAt: exactMatchupClockInstant(job.deadline) };
    await ownerQuery(`INSERT INTO public_data_dispatches(worker_id,generation,intake_id,revision,resource,work,max_requests)
      VALUES($1,$2,$3,$4,$5,$6::jsonb,$7)`, [workerId, fence.generation, requestId, work.revision, work.kind,
      JSON.stringify(work), ['exact-matchups', 'playoff-brackets', 'core'].includes(work.kind) ? 2 : 1]);
    return { work, fence };
  }
  async function release(fence: AdministrationWriteFence) {
    await ownerQuery(`UPDATE projection_jobs SET state='completed',lease_owner=NULL,lease_until=NULL,completed_at=clock_timestamp()
      WHERE job_key=$1 AND lease_owner=$2 AND attempt_count=$3`, [fence.jobKey, fence.workerId, fence.generation]);
  }
  async function request(fixtures: readonly Fixture[], options: { full?: boolean; brackets?: boolean; nativeWeek?: number; extraPeriod?: number; empty?: boolean } = {}) {
    const id = randomUUID(), manager = numericId(), username = 'cp20_' + manager;
    await intake.submit({ id, username, seasons: [2026], ...(options.empty ? {} : options.full === false
      ? { exactPeriods: [{ season: 2026, nativeWeek: options.nativeWeek ?? 1 }] } : { periodInventory: PUBLIC_PERIOD_INVENTORY }),
    ...(options.brackets === false ? {} : { playoffBrackets: PUBLIC_PLAYOFF_BRACKETS }) });
    const identity = await dispatch(id);
    if (identity.work.kind !== 'identity') throw new Error('CP20 identity work mismatch.');
    try {
      const acquisition = await intake.captureWitness!(identity.work, null, identity.fence), at = await now();
      await intake.recordIdentity(identity.work, { payload: { user_id: manager, username }, requestStartedAt: at, requestCompletedAt: at,
        acquisition, value: { userId: manager, username, displayName: username, avatarUrl: null } }, identity.fence);
    } finally { await release(identity.fence); }
    const discovery = await dispatch(id);
    if (discovery.work.kind !== 'leagues') throw new Error('CP20 list work mismatch.');
    try {
      const acquisition = await intake.captureWitness!(discovery.work, null, discovery.fence), at = await now();
      const payload = fixtures.map(f => options.extraPeriod ? { ...f.payload,
        settings: { ...f.payload.settings as JsonObject, leg: options.extraPeriod } } : f.payload);
      await intake.recordLeagues(discovery.work, { payload, requestStartedAt: at, requestCompletedAt: at, acquisition,
        value: fixtures.map(f => ({ id: f.external, name: String(f.payload.name), season: '2026' })) }, discovery.fence);
    } finally { await release(discovery.fence); }
    for (const f of fixtures) await ownerQuery(`UPDATE public_data_league_candidates SET league_season_id=$3,stage='complete'
      WHERE intake_id=$1 AND external_league_id=$2`, [id, f.external, f.leagueSeasonId]);
    return id;
  }
  async function observation(f: Fixture, payload: JsonValue, family: 'league' | 'matchups' | typeof families[number], week: number | null,
    acquisition?: PublicCaptureWitness, completeness: 'complete' | 'partial' = 'complete') {
    const at = await now();
    return normalizeAdministrationObservation({ schemaVersion: 'league-administration-v1', normalizerVersion: 'sleeper-administration-v1',
      dialect: 'sleeper-nfl-v1', scope: f.mapping.scope, family, week, completeness, payload,
      provenance: { origin: 'network', requestStartedAt: at, requestCompletedAt: at,
        sourceObservedAt: completeness === 'complete' ? at : null, checkedAt: at, ...(acquisition ? { acquisition } : {}) } });
  }
  async function period(f: Fixture, requestId: string, rows?: JsonValue, replayWithinFence = false) {
    const owner = await dispatch(requestId), { work, fence } = owner;
    if (work.kind !== 'exact-matchups' || work.externalLeagueId !== f.external) throw new Error('CP20 period work mismatch.');
    try {
      const settingsAttempt = await administration.beginLeagueSettingsAttempt(f.mapping, randomUUID(), fence);
      const matchupAttempt = await administration.beginExactMatchupAttempt(f.mapping, work.nativeWeek, randomUUID(), fence);
      const acquisition = await intake.captureWitness!(work, f.mapping, fence);
      const settings = await observation(f, f.payload, 'league', null, acquisition), at = settings.envelope.provenance.checkedAt;
      const calendar = createSleeperCalendarEvidence({ season: '2026', seasonSchedule: calendarFixture.body,
        evaluatedAt: at, retrievalStartedAt: at, retrievalCompletedAt: at });
      if (!calendar) throw new Error('CP20 calendar prerequisite unavailable.');
      const savedSettings = await administration.recordObservation(settings, fence, f.mapping, undefined, undefined,
        { attempt: settingsAttempt }, undefined, calendar);
      if (!savedSettings.observationId || savedSettings.leagueSettingsAcceptance?.status !== 'accepted'
        || !savedSettings.leagueSettingsAcceptance.receiptId) throw new Error('CP20 settings acceptance unavailable.');
      const population = { observationId: savedSettings.observationId, contentHash: settings.contentHash, envelope: settings.envelope };
      const input = await observation(f, rows ?? nativeRows(work.nativeWeek), 'matchups', work.nativeWeek, acquisition);
      const result = await administration.recordObservation(input, fence, f.mapping, undefined, undefined, undefined,
        { attempt: matchupAttempt, population });
      if (!result.observationId || result.matchupAcceptance?.status !== 'accepted' || !result.matchupAcceptance.receiptId) throw new Error('CP20 exact acceptance unavailable.');
      const checkpoint = { observations: { league: savedSettings.observationId, matchups: result.observationId },
        receipts: { settings: savedSettings.leagueSettingsAcceptance.receiptId, matchups: result.matchupAcceptance.receiptId } };
      await intake.completeExactPeriod(work, f.mapping, checkpoint, fence);
      if (replayWithinFence) {
        const beforeReplay = await connection.database.query(`SELECT to_jsonb(receipt) AS receipt
          FROM league_roster_capture_receipts receipt WHERE id=$1`, [checkpoint.receipts.matchups]);
        // Exact replay still requires the original live writer fence; release happens only in finally.
        const replay = await administration.recordObservation(input, fence, f.mapping, undefined, undefined, undefined,
          { attempt: matchupAttempt, population });
        expect(replay.matchupAcceptance).toMatchObject({ status: 'accepted', reason: 'exact_receipt_replay', receiptId: checkpoint.receipts.matchups });
        expect(await connection.database.query(`SELECT to_jsonb(receipt) AS receipt
          FROM league_roster_capture_receipts receipt WHERE id=$1`, [checkpoint.receipts.matchups])).toEqual(beforeReplay);
      }
      return { work, fence, input, result, settings, savedSettings, population, matchupAttempt, checkpoint };
    } finally { await release(fence); }
  }
  async function brackets(f: Fixture, requestId: string, winners: JsonValue = bracketRows, losers: JsonValue = bracketRows) {
    const { work, fence } = await dispatch(requestId);
    if (work.kind !== 'playoff-brackets' || work.externalLeagueId !== f.external) throw new Error('CP20 bracket work mismatch.');
    try {
      const attempts = await Promise.all(families.map(family => administration.beginBracketAttempt!(f.mapping, family, randomUUID(), fence)));
      const acquisition = await intake.captureWitness!(work, f.mapping, fence);
      const captures = [];
      for (const [index, family] of families.entries()) {
        const input = await observation(f, family === 'winners_bracket' ? winners : losers, family, null, acquisition);
        const result = await administration.recordObservation(input, fence, f.mapping, undefined, undefined, undefined,
          undefined, undefined, undefined, undefined, undefined, { attempt: attempts[index] });
        if (!result.observationId || result.bracketAcceptance?.status !== 'accepted' || !result.bracketAcceptance.receiptId) throw new Error('CP20 bracket acceptance unavailable.');
        captures.push({ family, input, result, receiptId: result.bracketAcceptance.receiptId });
      }
      await intake.completeBrackets!(work, f.mapping, { observations: { winners_bracket: captures[0].result.observationId!, losers_bracket: captures[1].result.observationId! },
        receipts: { winners_bracket: captures[0].receiptId, losers_bracket: captures[1].receiptId } }, fence);
      return captures;
    } finally { await release(fence); }
  }
  async function storedOnly<T>(body: (database: DatabaseClient, store: ReturnType<typeof createLeagueAdministrationStore>, statements: string[]) => Promise<T>) {
    const statements: string[] = [];
    const database: DatabaseClient = { enabled: true,
      query: async <Row extends DatabaseRow = DatabaseRow>(sql: string, parameters?: readonly unknown[], options?: DatabaseQueryOptions) => {
        statements.push(sql); expect(sql).not.toMatch(/\b(?:INSERT|UPDATE|DELETE|CALL)\b/iu);
        return connection.database.query<Row>(sql, parameters, options);
      } };
    const fetch = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('CP20 stored reader must not fetch.'));
    try { const result = await body(database, createLeagueAdministrationStore(database), statements);
      expect(fetch).not.toHaveBeenCalled(); expect(statements.length).toBeGreaterThan(0); return result;
    } finally { fetch.mockRestore(); }
  }
  async function read(requestId: string, options: PublicIntakeReadOptions = {}) {
    return storedOnly((database, store) => readPublicSleeperIntake(database, store, requestId, { seasonHistoryVersion: 'v1', ...options }));
  }
  function selectedHistory(value: Awaited<ReturnType<typeof read>>, f: Fixture) {
    if (value.status === 'missing' || !value.seasonHistory || value.seasonHistory.status !== 'available') throw new Error('CP20 composed history unavailable.');
    const selected = value.seasonHistory.leagues.find(item => item.identity.externalLeagueId === f.external);
    if (!selected || selected.resource.status !== 'available') throw new Error('CP20 league history unavailable.');
    expect(selected.identity.leagueSeasonId).toBe(f.leagueSeasonId);
    return selected.resource;
  }
  async function activate(f: Fixture, versionId: string | null | undefined, component: ConfigurationComponentName, from = 1, through = 18) {
    if (!versionId) throw new Error('CP20 applicability version missing.');
    const [current] = await connection.database.query(`SELECT COALESCE(max(generation),0)::integer AS generation
      FROM league_configuration_activations WHERE league_season_id=$1 AND component=$2`, [f.leagueSeasonId, component]);
    const [row] = await ownerQuery(`SELECT activate_league_configuration_component($1::uuid,$2::text,'regular',
      $3::smallint,$4::smallint,$5::text,$6::bigint) AS id`, [versionId, component, from, through,
      'CP20 synthetic owner attestation; no provider effectivity claim', current.generation]);
    return String(row.id);
  }
  const retainedSelection = (f: Fixture, nativeWeeks: readonly number[]): RetainedMatchupSelection => ({
    leagueSeasonId: f.leagueSeasonId, scope: f.mapping.scope, nativeWeeks });

  let completeFixtures: Fixture[] = [];
  let completeRequest = '';
  const completeCaptures = new Map<string, Awaited<ReturnType<typeof period>>>();
  it('composes all eighteen native periods and both brackets for three unrelated 2026 formats', async () => {
    completeFixtures = [await fixture(0), await fixture(1), await fixture(2)].sort((a, b) => a.external.localeCompare(b.external));
    completeRequest = await request(completeFixtures);
    for (const f of completeFixtures) await brackets(f, completeRequest);
    for (const f of completeFixtures) for (const week of weeks) {
      const captured = await period(f, completeRequest);
      expect(captured.work.nativeWeek).toBe(week); completeCaptures.set(f.external + ':' + week, captured);
    }
    expect(await intake.next(completeRequest)).toBe('complete');
    const seen: string[] = [], groupKeys: string[] = [];
    for (const afterOrdinal of [0, 20, 40]) {
      const page = await read(completeRequest, { periodInventoryPage: { afterOrdinal, limit: 20 } });
      expect(page).toMatchObject({ seasonHistory: { status: 'available', version: 'sleeper-within-season-history-v1',
        scope: 'selected-request', coverage: { detailedPeriods: afterOrdinal === 40 ? 14 : 20, taskCount: 54, priorSeasons: 'not-requested' } } });
      for (const f of completeFixtures) {
        const resource = selectedHistory(page, f);
        expect(resource.coverage.tasks.map(task => task.nativeWeek)).toEqual(weeks);
        expect(resource.coverage.requestedWeeks).toEqual(weeks);
        expect(resource.brackets.map(bracket => bracket.family)).toEqual(families);
        for (const bracket of resource.brackets) {
          expect(bracket.resource).toMatchObject({ status: 'available', value: { season: 2026, family: bracket.family,
            rounds: [{ round: 1, externalMatchupIds: ['1', '2'] }, { round: 2, externalMatchupIds: ['3'] }] } });
          expect(bracket.reportedResults[0]).toMatchObject({ identity: { kind: 'bracket-match', externalMatchupId: '1', family: bracket.family },
            finality: { status: 'provider-reported-played' } });
        }
        for (const value of resource.periods) {
          const expected = completeCaptures.get(f.external + ':' + value.nativeWeek)!;
          seen.push(f.external + ':' + value.nativeWeek);
          expect(value.values).toMatchObject({ status: 'available', selection: 'receipt', matchupsReceiptId: expected.checkpoint.receipts.matchups,
            provenance: expected.input.envelope.provenance,
            value: { nativeWeek: value.nativeWeek, season: 2026, teams: [
              { externalRosterId: '1', rawPoints: { state: 'supplied', value: String(100.25 + value.nativeWeek) }, customPoints: { state: 'supplied', value: '0' }, effectivePoints: { value: '0', source: 'custom-override' } },
              { externalRosterId: '2', rawPoints: { state: 'supplied', value: '-2.25' }, customPoints: { state: 'missing' }, effectivePoints: { value: '-2.25', source: 'raw' } }, {}, {},
            ] } });
          expect(value.context).toMatchObject({ status: 'available', observedConfiguration: { applicability: 'observation-only' },
            configuration: { competition: { status: 'unknown' } } });
          expect(value.groups.map(group => group.teams.map(team => team.externalRosterId))).toEqual([['1', '2'], ['3', '4']]);
          for (const group of value.groups) {
            groupKeys.push(group.key); expect(group.identity).toMatchObject({ externalLeagueId: f.external,
              leagueSeasonId: f.leagueSeasonId, nativeWeek: value.nativeWeek, season: 2026 });
          }
          expect(value).toMatchObject({ officialOutcome: { status: 'unknown' }, finality: { status: 'unknown' }, series: { status: 'unknown' }, bye: { status: 'unknown' } });
        }
      }
    }
    expect(seen.sort()).toEqual(completeFixtures.flatMap(f => weeks.map(week => f.external + ':' + week)).sort());
    expect(new Set(seen).size).toBe(54); expect(new Set(groupKeys).size).toBe(108);
    const [stored] = await connection.database.query(`SELECT count(*)::integer AS count,count(DISTINCT matchups_receipt_id)::integer AS receipts
      FROM public_data_exact_period_checkpoints WHERE intake_id=$1`, [completeRequest]);
    expect(stored).toEqual({ count: 54, receipts: 54 });
  }, 300_000);

  it('keeps page coverage native gaps and missing states distinct without inventing series', async () => {
    const first = await read(completeRequest, { periodInventoryPage: { afterOrdinal: 0, limit: 20 } });
    const divided = selectedHistory(first, completeFixtures[1]);
    expect(divided.coverage).toMatchObject({ selectedWeeks: [1, 2], readCoverage: 'page', seasonCoverage: 'partial' });
    expect(divided.coverage.gaps).toContainEqual({ nativeWeek: 3, reason: 'period-outside-selected-page' });
    const legs = selectedHistory(await read(completeRequest, { periodInventoryPage: { afterOrdinal: 14, limit: 4 } }), completeFixtures[0]);
    expect(legs.periods.map(value => value.nativeWeek)).toEqual([15, 16, 17, 18]);
    expect(legs.periods.every(value => value.series.status === 'unknown')).toBe(true);
    const f = await fixture(), id = await request([f], { extraPeriod: 19 });
    await brackets(f, id, [], null);
    await period(f, id, [{ roster_id: 1, matchup_id: null, points: 0 }, { roster_id: 2, points: null },
      { roster_id: 3, matchup_id: 2, points: 1 }, { roster_id: 4, matchup_id: 2, points: 2 }]);
    // Disclosed terminal task metadata; no accepted checkpoint is fabricated.
    await ownerQuery(`UPDATE public_data_exact_period_tasks SET status='unavailable',failure_count=5,reason='malformed-source-fixture'
      WHERE intake_id=$1 AND native_week=2`, [id]);
    const result = selectedHistory(await read(id), f);
    expect(result.coverage.seasonCoverage).toBe('partial');
    expect(result.coverage.gaps).toEqual(expect.arrayContaining([
      expect.objectContaining({ reason: 'native-period-outside-supported-range', nativePeriod: 19 }),
      { reason: 'malformed-source-fixture', nativeWeek: 2 }, { reason: 'period-pending', nativeWeek: 3 },
    ]));
    expect(result.periods[0].unassigned.map(team => team.nativeMatchupId.state)).toEqual(['null', 'missing']);
    expect(result.periods[0].groups.map(group => group.teams.map(team => team.externalRosterId))).toEqual([['3', '4']]);
    expect(result.periods[0].bye.status).toBe('unknown');
    expect(result.brackets[0].resource).toMatchObject({ status: 'available', value: { publication: 'published', matches: [] } });
    expect(result.brackets[1].resource).toMatchObject({ status: 'available', value: { publication: 'unpublished', matches: [] } });
    const unrequested = await request([f], { empty: true, brackets: false });
    const omitted = selectedHistory(await read(unrequested), f);
    expect(omitted.coverage).toMatchObject({ requestedWeeks: [], unrequestedWeeks: weeks, seasonCoverage: 'partial' });
    expect(omitted.coverage.gaps).toContainEqual({ reason: 'winners_bracket-not-requested' });
    const empty = await request([]);
    expect(await read(empty)).toMatchObject({ seasonHistory: { status: 'available', leagues: [], coverage: { detailedPeriods: 0, taskCount: 0 } } });
  }, 90_000);

  it('retains corrected removed equal and replayed source evidence beside exact receipt history', async () => {
    const f = await fixture(), firstId = await request([f], { full: false });
    await brackets(f, firstId); const first = await period(f, firstId);
    const old = selectedHistory(await read(firstId), f);
    const selection = retainedSelection(f, [1]);
    const frozenRead = await read(firstId, { seasonHistoryRetained: { selection, batchSize: 1 } });
    if (frozenRead.status === 'missing' || frozenRead.seasonHistory?.status !== 'available'
      || frozenRead.seasonHistory.retainedHistory?.status !== 'available') throw new Error('CP20 original manifest missing.');
    const initialManifest = frozenRead.seasonHistory.retainedHistory.manifest;
    const frozen = JSON.parse(JSON.stringify(initialManifest)) as typeof initialManifest;
    const secondId = await request([f], { full: false });
    await brackets(f, secondId, [{ r: 1, m: 1, t1: 1, t2: 2, w: 2, l: 1 }], []);
    const second = await period(f, secondId, nativeRows(1, true));
    const changed = selectedHistory(await read(secondId), f);
    expect(changed.periods[0].groups.map(group => group.teams.map(team => team.externalRosterId))).toEqual([['1', '3'], ['2', '4']]);
    expect(changed.brackets[0].reportedResults[0]).toMatchObject({ winner: { state: 'supplied', value: '2' }, loser: { state: 'supplied', value: '1' } });
    expect(changed.brackets[1].reportedResults).toEqual([]);
    const thirdId = await request([f], { full: false });
    await brackets(f, thirdId, [], null); const equal = await period(f, thirdId, nativeRows(1, true), true);
    expect(equal.checkpoint.receipts.matchups).not.toBe(second.checkpoint.receipts.matchups);
    expect(equal.input.contentHash).toBe(second.input.contentHash);
    expect(equal.input.envelope.provenance.requestCompletedAt).not.toBe(second.input.envelope.provenance.requestCompletedAt);
    const before = await connection.database.query(`SELECT count(*)::integer AS count FROM league_roster_capture_receipts
      WHERE id=ANY($1::uuid[])`, [[first.checkpoint.receipts.matchups, second.checkpoint.receipts.matchups, equal.checkpoint.receipts.matchups]]);
    expect(before).toEqual([{ count: 3 }]);
    await expect(administration.recordObservation(equal.input, equal.fence, f.mapping, undefined, undefined, undefined,
      { attempt: equal.matchupAttempt, population: equal.population })).rejects.toThrow('writer fence is stale');
    expect(await connection.database.query(`SELECT count(*)::integer AS count FROM league_roster_capture_receipts
      WHERE id=ANY($1::uuid[])`, [[first.checkpoint.receipts.matchups, second.checkpoint.receipts.matchups, equal.checkpoint.receipts.matchups]])).toEqual(before);
    await administration.recordObservation(await observation(f, nativeRows(1, true), 'matchups', 1, undefined, 'partial'));
    const original = selectedHistory(await read(firstId), f);
    expect(original.periods[0].values).toEqual(old.periods[0].values);
    expect(original.periods[0].groups).toEqual(old.periods[0].groups);
    expect(original.brackets).toEqual(old.brackets);
    const resumed = await read(firstId, { seasonHistoryRetained: { selection, manifest: frozen, batchSize: 1 } });
    if (resumed.status === 'missing' || resumed.seasonHistory?.status !== 'available'
      || resumed.seasonHistory.retainedHistory?.status !== 'available') throw new Error('CP20 resumed manifest missing.');
    expect(resumed.seasonHistory.retainedHistory.manifest).toEqual(frozen);
    expect(resumed.seasonHistory.retainedHistory.batch.entries).toEqual(frozenRead.seasonHistory.retainedHistory.batch.entries);
    const fresh = await read(firstId, { seasonHistoryRetained: { selection, batchSize: 100 } });
    if (fresh.status === 'missing' || fresh.seasonHistory?.status !== 'available'
      || fresh.seasonHistory.retainedHistory?.status !== 'available') throw new Error('CP20 corrected manifest missing.');
    expect(fresh.seasonHistory.retainedHistory.manifest.entries.length).toBeGreaterThan(frozen.entries.length);
    expect(fresh.seasonHistory.retainedHistory.coverage.rejectedCount).toBeGreaterThan(0);
    expect(fresh.seasonHistory.retainedHistory.acceptance).toBe('not-typed-acceptance');
    expect(fresh.seasonHistory.retainedHistory.batch.status).toBe('complete');
    expect(selectedHistory(fresh, f).periods[0].values).toEqual(old.periods[0].values);
  }, 120_000);

  it('applies evidenced period settings without rewriting captured configuration', async () => {
    const f = await fixture(), id = await request([f], { brackets: false });
    const captures = [];
    for (const nativeWeek of [1, 2, 3]) { const capture = await period(f, id); expect(capture.work.nativeWeek).toBe(nativeWeek); captures.push(capture); }
    const before = selectedHistory(await read(id), f);
    expect(before.periods[0].context).toMatchObject({ status: 'available', observedConfiguration: { applicability: 'observation-only' },
      configuration: { scoring: { status: 'unknown' }, roster: { status: 'unknown' }, competition: { status: 'unknown' } } });
    for (const component of ['scoring', 'roster', 'competition'] as const) await activate(f, captures[0].savedSettings.versionId, component, 1, 2);
    const applicable = selectedHistory(await read(id), f);
    for (const value of applicable.periods.slice(0, 2)) expect(value.context).toMatchObject({ status: 'available',
      configuration: { scoring: { status: 'known', range: { fromWeek: 1, throughWeek: 2 } }, roster: { status: 'known' }, competition: { status: 'known' } } });
    expect(applicable.periods[2].context).toMatchObject({ status: 'available', configuration: { competition: { status: 'unknown', reason: 'no_binding' } } });
    const payload = { ...f.payload, settings: { ...f.payload.settings as JsonObject, start_week: 5, playoff_week_start: 4 } };
    const attempt = await administration.beginLeagueSettingsAttempt(f.mapping, randomUUID());
    const input = await observation(f, payload, 'league', null);
    const saved = await administration.recordObservation(input, undefined, f.mapping, undefined, undefined, { attempt });
    await activate(f, saved.versionId, 'competition', 1, 2);
    const corrected = selectedHistory(await read(id), f);
    expect(corrected.periods[0].context).toMatchObject({ status: 'available', phase: { status: 'unknown', reason: 'contradictory_competition_boundaries' } });
    for (let index = 0; index < 3; index++) {
      const previous = before.periods[index].context, current = corrected.periods[index].context;
      if (previous.status !== 'available' || current.status !== 'available') throw new Error('CP20 captured settings disappeared.');
      expect(current.observedConfiguration).toEqual(previous.observedConfiguration);
      expect(current.capture).toEqual(previous.capture);
    }
    const unproved = await administration.recordObservation(await observation(f,
      { ...f.payload, settings: { ...f.payload.settings as JsonObject, playoff_week_start: 12 } }, 'league', null));
    await activate(f, unproved.versionId, 'competition', 1, 2);
    expect(selectedHistory(await read(id), f).periods[0].context).toMatchObject({ status: 'available',
      configuration: { competition: { status: 'unknown', reason: 'invalid_applicability_evidence' } } });
  }, 120_000);

  it('rejects foreign and remapped evidence while bounded stored reads remain source free', async () => {
    const f = completeFixtures[0], other = completeFixtures[1], capture = completeCaptures.get(f.external + ':1')!;
    await storedOnly(async (_database, store) => {
      for (const [mapping, nativeWeek] of [[other.mapping, 1], [f.mapping, 2]] as const) {
        expect((await store.readExactMatchupValues!(mapping, { nativeWeek, matchupsReceiptId: capture.checkpoint.receipts.matchups })).status).not.toBe('available');
        expect((await store.readExactPeriodContext!(mapping, { nativeWeek, matchupsReceiptId: capture.checkpoint.receipts.matchups })).status).not.toBe('available');
      }
      const bracket = await store.readAcceptedBracket!(f.mapping, { family: 'winners_bracket' });
      if (bracket.status !== 'available') throw new Error('CP20 bracket identity baseline missing.');
      expect((await store.readAcceptedBracket!(other.mapping, { family: 'winners_bracket', bracketReceiptId: bracket.bracketReceiptId })).status).not.toBe('available');
      expect((await store.readAcceptedBracket!(f.mapping, { family: 'losers_bracket', bracketReceiptId: bracket.bracketReceiptId })).status).not.toBe('available');
    });
    const selection = retainedSelection(f, [1, 2]);
    const original = await read(completeRequest, { seasonHistoryRetained: { selection, batchSize: 1 } });
    if (original.status === 'missing' || original.seasonHistory?.status !== 'available'
      || original.seasonHistory.retainedHistory?.status !== 'available') throw new Error('CP20 retained selection missing.');
    const { manifest, batch } = original.seasonHistory.retainedHistory;
    expect(batch.status).toBe('more');
    const resumed = await read(completeRequest, { seasonHistoryRetained: { selection, manifest, cursor: batch.cursor, batchSize: 1 } });
    expect(resumed).toMatchObject({ seasonHistory: { retainedHistory: { status: 'available', batch: { status: 'complete', fromIndex: 1 } } } });
    await expect(read(completeRequest, { seasonHistoryRetained: { selection, manifest: { ...manifest, id: 'f'.repeat(64) } } })).rejects.toThrow('manifest');
    await expect(read(completeRequest, { seasonHistoryRetained: { selection, manifest, cursor: { manifestId: manifest.id, nextIndex: manifest.entries.length + 1 } } })).rejects.toThrow('cursor');
    await expect(read(completeRequest, { seasonHistoryRetained: { selection, batchSize: 101 } })).rejects.toThrow('selection');
    const foreignRequest = await request([other], { full: false, brackets: false });
    expect(await read(foreignRequest, { seasonHistoryRetained: { selection, manifest } })).toMatchObject({
      seasonHistory: { retainedHistory: { status: 'unavailable', reason: 'season-history-retained-request-scope-mismatch' } } });
    const current = await read(completeRequest);
    await storedOnly(async (database, store, statements) => {
      const baseline = await readPublicSleeperIntake(database, store, completeRequest);
      const baselineQueries = [...statements]; statements.length = 0;
      const omitted = await readPublicSleeperIntake(database, store, completeRequest, {});
      if (baseline.status === 'missing' || omitted.status === 'missing') throw new Error('CP20 default request missing.');
      expect({ ...omitted, readAt: baseline.readAt }).toEqual(baseline);
      expect(statements).toEqual(baselineQueries); expect(omitted).not.toHaveProperty('seasonHistory');
    });
    await ownerQuery("SELECT revise_league_source_connection($1,'sleeper',$2,$3,'CP20 synthetic remap')", [f.leagueSeasonId, f.mapping.revisionId, numericId()]);
    const remapped = await read(completeRequest, { seasonHistoryRetained: { selection, manifest, batchSize: 100 } });
    if (remapped.status === 'missing' || remapped.seasonHistory?.status !== 'available') throw new Error('CP20 request disappeared after remap.');
    expect(remapped.seasonHistory.leagues.find(value => value.identity.externalLeagueId === f.external)?.resource.status).toBe('unavailable');
    expect(selectedHistory(remapped, other).periods).toEqual(selectedHistory(current, other).periods);
    expect(remapped.seasonHistory.retainedHistory).toMatchObject({ status: 'available', acceptance: 'not-typed-acceptance' });
    const comparison = createRetainedMatchupComparison(administration);
    expect((await comparison.compareBatch({ manifest, batchSize: 101 })).status).toBe('unavailable');
  }, 90_000);
});
