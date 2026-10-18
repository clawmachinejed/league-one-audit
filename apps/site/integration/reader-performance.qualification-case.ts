import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, it, vi } from 'vitest';
import { createDatabase, type DatabaseClient } from '../lib/database';
import { createProjectionStore } from '../lib/projection-store';
import { createLeagueAdministrationStore, createPublicIntakeStore, readPublicPeriodTaskRows } from '../lib/league-administration/store';
import { readPublicSleeperIntake } from '../lib/league-administration/public-intake-reader';
import { runPublicIntakeStep, runPublicPlayerDirectoryStep, type PublicIntakeDependencies } from '../lib/league-administration/public-intake';
import { PUBLIC_DRAFT_PICKS, PUBLIC_INTAKE_JOB, PUBLIC_PERIOD_INVENTORY, PUBLIC_PLAYOFF_BRACKETS } from '../lib/league-administration/public-intake-contracts';
import { normalizeAdministrationObservation } from '../lib/league-administration/normalize';
import { projectExactMatchupValues } from '../lib/aggregator/exact-matchup-values';
import { projectOfficialStandings } from '../lib/aggregator/official-standings';
import { projectPlayoffBracket } from '../lib/aggregator/playoff-brackets';
import { projectWeeklyReport } from '../lib/aggregator/weekly-reports';
import { assertReaderJsonEqual } from './reader-performance-oracle';
import type { AdministrationFamily, JsonValue } from '../lib/league-administration/contracts';
import { createBackendControlsDatabaseFetchGuard } from './backend-controls-fetch';
import { createIndependentDatabase, createPinnedIntegrationDatabase, integrationEnvironment, ownerQuery, type IndependentDatabase } from './neon-integration-harness';
import { exactMatchupClockInstant } from './exact-matchup-clock';
import { readReaderStateSnapshot, ReaderStateSnapshotError } from './reader-performance-snapshot';
import { qualificationBinding, qualificationDigest, type QualificationBinding } from './qualification-profile';
import { createReaderSourceDataset, readerDigest, runReaderSchedule, measuredReaderDatabase, assertReaderTarget,
  READER_PERFORMANCE_OPTIONS, READER_PERFORMANCE_SUITE, READER_PERFORMANCE_TESTS, READER_PERFORMANCE_LIMITS,
  READER_PERFORMANCE_PROFILE, READER_SOURCE_DIGEST, writeReaderPerformanceEvidence, ReaderCorrectnessError, type ReaderCorrectnessCheckpoint,
  type ReaderPerformanceEvidence, type ReaderSlot, type ReaderSample, type QueryMeasurement } from './reader-performance';

const source = createReaderSourceDataset();
type StoredFixture = { source: typeof source.leagues[number]; requestId: string; leagueSeasonId: string; leagueKey: string };
const object = (value: unknown): Record<string, unknown> => { assert(value && typeof value === 'object' && !Array.isArray(value)); return value as Record<string, unknown>; };
const array = (value: unknown): Record<string, unknown>[] => { assert(Array.isArray(value)); return value.map(object); };
const available = (value: unknown) => { const row = object(value); assert.equal(row.status, 'available'); return row; };

/** Source-only CP27 candidate; execution requires separate immutable-source authority.
 * DATA-CP27-2026-10-18-DATASET-SETUP-SCOPE independently reviews the existing CP20
 * owner/dispatch setup pattern. Synthetic operational prerequisites bypass waits,
 * never typed acceptance, original20s/25s fences, clocks, roles, immutable records
 * or the global isolated identity/TLS/sentinel/denylist/cleanup harness. No CP26
 * batch/scheduler, production write, migration application or paid run is selected.
 * pg is setup only. The measured reader uses the original production Neon HTTP. */
describe.sequential(READER_PERFORMANCE_SUITE, () => {
  let connection: IndependentDatabase, database: DatabaseClient, binding: QualificationBinding, evidence: ReaderPerformanceEvidence;
  let administration: ReturnType<typeof createLeagueAdministrationStore>, intake: ReturnType<typeof createPublicIntakeStore>;
  let dependencies: PublicIntakeDependencies, restoreFetch: (() => void) | undefined;
  let setup = true, setupFetches = 0, caseDeadline = 0;
  const workers: string[] = [], fixtures: StoredFixture[] = [], ownedRequests = new Set<string>(), queries = new Map<string, QueryMeasurement>();
  const expectedDigests = new Map<string, string>(), routes = new Map<string, unknown>();
  const base = 'https://api.sleeper.app/v1'; routes.set(base + '/players/nfl', source.players);
  for (const league of source.leagues) {
    routes.set(base + '/user/' + league.username, { user_id: league.manager, username: league.username, display_name: league.username });
    routes.set(base + '/user/' + league.manager + '/leagues/nfl/2026', [league.payload]);
    const path = base + '/league/' + league.native;
    for (const [suffix, value] of [['', league.payload], ['/rosters', league.rosters], ['/users', league.users], ['/transactions/7', league.transactions],
      ['/winners_bracket', league.winners], ['/losers_bracket', league.losers], ['/drafts', [league.draft]], ['/traded_picks', league.trades]] as const) routes.set(path + suffix, value);
    league.matchups.forEach((rows, index) => routes.set(path + '/matchups/' + (index + 1), rows));
    const draft = base + '/draft/' + league.draft.draft_id;
    routes.set(draft, league.draft); routes.set(draft + '/picks', league.picks); routes.set(draft + '/traded_picks', league.trades);
  }
  beforeAll(async () => {
    const selected = qualificationBinding(); assert.equal(selected?.context.profile, READER_PERFORMANCE_PROFILE); binding = selected!;
    connection = createIndependentDatabase(); administration = createLeagueAdministrationStore(connection.database); intake = createPublicIntakeStore(connection.database);
    const runtimeUrl = integrationEnvironment().runtimeDatabaseUrl, actual = createDatabase(runtimeUrl); assert(actual.enabled); database = actual;
    const permits = createBackendControlsDatabaseFetchGuard(runtimeUrl), originalFetch = globalThis.fetch;
    const intercept = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      if (permits(input, init)) return originalFetch(input, init);
      if (!setup) { evidence.blockedFetches++; throw new Error('CP27 stored readers attempted source acquisition.'); }
      const url = input instanceof Request ? input.url : String(input), method = init?.method ?? (input instanceof Request ? input.method : 'GET');
      if (method === 'GET' && routes.has(url)) { setupFetches++; return new Response(JSON.stringify(routes.get(url)), { headers: { 'Content-Type': 'application/json' } }); }
      if (url === 'https://sleeper.com/graphql' && method === 'POST' && typeof init?.body === 'string') {
        const body = init.body, league = source.leagues.find(row => body.includes(row.native + '_7')); assert(league, 'Unexpected report selection'); setupFetches++;
        return new Response(JSON.stringify(league.report), { headers: { 'Content-Type': 'application/json' } });
      }
      throw new Error('Unexpected CP27 fixture acquisition.');
    }); restoreFetch = () => intercept.mockRestore();
    const [identity] = await database.query(`SELECT session_user,current_user,current_setting('server_version') AS version,
      current_setting('server_version_num') AS version_num,rolsuper,rolcreaterole,rolcreatedb FROM pg_roles WHERE rolname=current_user`);
    assert.equal(identity.session_user, 'league_one_runtime'); assert.equal(identity.current_user, 'league_one_runtime');
    assert.deepEqual([identity.rolsuper, identity.rolcreaterole, identity.rolcreatedb], [false, false, false]);
    evidence = { kind: 'data-reader-performance-evidence-v1', contextDigest: qualificationDigest(binding.context), gitSha: binding.context.gitSha,
      runId: binding.context.runId, profile: READER_PERFORMANCE_PROFILE, setupResponseCount: 0, operationalResets: 0,
      serverVersion: String(identity.version), serverVersionNum: String(identity.version_num), runtimeLogin: String(identity.session_user), transport: 'production-neon-http',
      sourceDigest: READER_SOURCE_DIGEST, dataset: { leagues: 0, rosters: 0, weeks: 0, players: 0, requestIds: [], receiptCount: 0, sourceBindings: [] },
      cases: READER_PERFORMANCE_TESTS.map(name => ({ name, state: 'unserved', startedAt: null, endedAt: null })), samples: [], maximumActive: 0, elapsedMs: 0,
      lists: [], queries: [], plans: [], tableCounts: [], beforeDigest: null, afterDigest: null, snapshotFailure: null, snapshotCleanupFailures: [], providerRequests: 0, blockedFetches: 0, cleanupComplete: false };
    const jobs = createProjectionStore(connection.database);
    dependencies = { administration, managerEvidenceVersion: 'v2', intake: { ...intake, admit: async (work, fence) => {
      assert(setup && ownedRequests.has(work.requestId)); assert(workers.includes(fence.workerId));
      await ownerQuery(`INSERT INTO public.public_data_dispatches(worker_id,generation,intake_id,revision,resource,work,max_requests)
        VALUES($1,$2,$3,$4,$5,$6::jsonb,$7)`, [fence.workerId, fence.generation, work.requestId, work.revision,
        work.kind, JSON.stringify(work), ['core', 'exact-matchups', 'playoff-brackets'].includes(work.kind) ? 2 : 1]); return true;
    } }, jobs: { ...jobs, acquireJob: async input => {
      assert(setup); assert.equal(input.jobKey, PUBLIC_INTAKE_JOB); assert.equal(input.leaseSeconds, 25);
      const [row] = await ownerQuery(`INSERT INTO public.projection_jobs(job_key,job_type,scheduled_for,state,lease_owner,lease_until,attempt_count,payload)
        VALUES($1,$1,clock_timestamp(),'running',$2,clock_timestamp()+interval '25 seconds',1,$3::jsonb)
        ON CONFLICT(job_key) DO UPDATE SET state='running',lease_owner=EXCLUDED.lease_owner,
          lease_until=EXCLUDED.lease_until,attempt_count=projection_jobs.attempt_count+1,payload=EXCLUDED.payload,
          scheduled_for=EXCLUDED.scheduled_for,completed_at=NULL
        WHERE projection_jobs.state<>'running' OR projection_jobs.lease_until<=clock_timestamp()
        RETURNING attempt_count,lease_until`, [PUBLIC_INTAKE_JOB, input.workerId, JSON.stringify(input.payload)]);
      assert(row, 'CP27 refuses to replace a live unrelated owner.'); workers.push(input.workerId);
      return { kind: 'acquired', attempt: Number(row.attempt_count), leaseUntil: exactMatchupClockInstant(row.lease_until) };
    } } };
  }, 90_000);
  afterAll(async () => {
    try {
      try { if (workers.length) await ownerQuery(`UPDATE public.projection_jobs SET state='failed',lease_owner=NULL,lease_until=NULL,
        completed_at=clock_timestamp() WHERE job_key=$1 AND lease_owner=ANY($2::text[])`, [PUBLIC_INTAKE_JOB, workers]);
      } finally { if (connection) await connection.close(); }
      if (evidence) evidence.cleanupComplete = true;
    } finally {
      try {
        // Preserve measured failures even when a separate plan or snapshot fails.
        if (evidence) { evidence.queries = [...queries.values()].map(({ parameters: _parameters, ...query }) => { void _parameters; return query; });
          await writeReaderPerformanceEvidence(evidence, binding); }
      } finally { restoreFetch?.(); }
    }
  }, 90_000);
  async function caseBody(index: number, body: () => Promise<void>) {
    caseDeadline = performance.now() + READER_PERFORMANCE_LIMITS[index];
    const entry = evidence.cases[index]; entry.state = 'running'; entry.startedAt = new Date().toISOString();
    try { await body(); entry.state = 'passed'; } catch (error) { entry.state = 'failed'; throw error; } finally { entry.endedAt = new Date().toISOString(); }
  }
  async function step(requestId: string) {
    const outcome = await runPublicIntakeStep(requestId, dependencies, AbortSignal.timeout(20_000));
    assert.equal(outcome.status, 'progress', 'CP27 fixture step failed without retry: ' + JSON.stringify(outcome)); return outcome.resource;
  }
  function normalized(fixture: StoredFixture, family: AdministrationFamily, payload: unknown, week: number | null) {
    return normalizeAdministrationObservation({ schemaVersion: 'league-administration-v1', normalizerVersion: 'sleeper-administration-v1', dialect: 'sleeper-nfl-v1',
      scope: { leagueKey: fixture.leagueKey, provider: 'sleeper', externalLeagueId: fixture.source.native, season: 2026 }, family, week, completeness: 'complete',
      provenance: { origin: 'bootstrap', checkedAt: '2026-10-18T00:00:00.000Z', requestStartedAt: null, requestCompletedAt: null, sourceObservedAt: null }, payload: payload as JsonValue });
  }
  function verify(slot: ReaderSlot, input: unknown) {
    let checkpoint: ReaderCorrectnessCheckpoint = 'result-status';
    try {
    const value = object(input), fixture = fixtures[slot.league], league = fixture.source;
    assert.equal(value.status, slot.kind === 'current' ? 'partial' : 'available');
    checkpoint = 'league-identity';
    const candidates = array(value.leagues); assert.equal(candidates.length, 1); assert.equal(candidates[0].externalLeagueId, league.native);
    assert.equal(candidates[0].leagueSeasonId, fixture.leagueSeasonId); assert.equal(candidates[0].collection, 'complete');
    checkpoint = 'core-resources';
    const resources = object(candidates[0].resources), settings = available(resources.settings), held = available(resources.heldRoster), managers = available(resources.teamManagers);
    available(resources.teamManagerEvidence); available(resources.managerDirectory);
    assert.deepEqual(object(available(resources.directory).envelope).payload, league.users);
    assert.deepEqual(settings.value, normalized(fixture, 'league', league.payload, null).leagueSettings?.value);
    checkpoint = 'held-roster-managers';
    const teams = array(held.teams); assert.equal(teams.length, 20); assert.equal(array(managers.teams).length, 20);
    for (const roster of league.rosters) {
      const team = teams.find(row => row.externalRosterId === String(roster.roster_id)); assert(team);
      assert.deepEqual(array(team.players).map(row => object(row.sourceEntity).nativeId).sort(), [...roster.players].sort());
      assert.deepEqual(object(team.currentGroups).nativeLists, { starters: roster.starters, reserve: roster.reserve, taxi: roster.taxi });
      const manager = array(managers.teams).find(row => object(row.sourceTeam).nativeId === String(roster.roster_id)); assert(manager);
      assert.equal(manager.seasonTeamId, team.seasonTeamId);
      assert.equal(object(object(object(manager.primaryOwner).manager).sourceManager).nativeId, roster.owner_id);
      assert.deepEqual(array(object(manager.coManagers).managers).map(row => object(row.sourceManager).nativeId), roster.co_owners);
    }
    checkpoint = 'exact-periods';
    const periods = array(value.exactPeriods); assert.equal(periods.length, slot.kind === 'current' ? 1 : 18);
    assert.deepEqual(periods.map(row => row.nativeWeek), slot.kind === 'current' ? [7] : Array.from({ length: 18 }, (_, i) => i + 1));
    for (const period of periods) {
      available(period.resource); available(period.periodContext); const values = available(period.exactMatchupValues);
      const teamIds = array(object(values.value).teams).map(row => ({ seasonTeamId: String(row.seasonTeamId), externalRosterId: String(row.externalRosterId) }));
      assert.equal(teamIds.length, 20); for (const team of teamIds) assert.equal(team.seasonTeamId, teams.find(held => held.externalRosterId === team.externalRosterId)?.seasonTeamId);
      assertReaderJsonEqual(values.value, projectExactMatchupValues(normalized(fixture, 'matchups', league.matchups[Number(period.nativeWeek) - 1], Number(period.nativeWeek)), teamIds));
      assert.equal(values.matchupsReceiptId, object(period.acquisition).matchupsReceiptId);
    }
    checkpoint = 'transactions';
    const transaction = array(value.transactions); assert.equal(transaction.length, 1); const tx = available(transaction[0].resource);
    assert.equal(array(object(tx.value).events).length, 20); assert.deepEqual(object(object(tx.capture).envelope).payload, league.transactions);
    checkpoint = 'brackets';
    const brackets = array(value.brackets); assert.equal(brackets.length, 1); const paired = available(brackets[0].resource);
    for (const [family, payload] of [['winners_bracket', league.winners], ['losers_bracket', league.losers]] as const)
      assert.deepEqual(available(paired[family]).value, projectPlayoffBracket(normalized(fixture, family, payload, null)).value);
    checkpoint = 'drafts';
    const drafts = array(value.drafts); assert.equal(drafts.length, 5); for (const draft of drafts) available(draft.resource);
    for (const draft of drafts) {
      const item = object(available(draft.resource).value);
      if (item.kind === 'league' || item.kind === 'draft') assert.deepEqual(array(item.entries).map(entry => entry.raw), league.trades);
      if (item.kind === 'catalog' || item.kind === 'detail') {
        const facts = item.kind === 'catalog' ? object(array(item.entries)[0].metadata) : object(item.detail);
        assert.equal(facts.externalDraftId, league.draft.draft_id); assert.equal(facts.externalLeagueId, league.native);
        assert.deepEqual(object(facts.settings).value, league.draft.settings); assert.deepEqual(object(facts.draftOrder).value, league.draft.draft_order);
        assert.deepEqual(object(facts.slotToRosterId).value, league.draft.slot_to_roster_id);
      }
    }
    const selections = drafts.find(row => object(object(row.resource).value).kind === 'selections'); assert(selections);
    assert.deepEqual(array(object(available(selections.resource).value).entries).map(row => row.raw), league.picks);
    checkpoint = 'weekly-reports';
    const reports = array(value.weeklyReports); assert.equal(reports.length, 1);
    const report = object(available(reports[0].resource).value), reportTeams = array(report.teams);
    assert.equal(reportTeams.length, 20);
    const nativeReportTeams = reportTeams.map(({ seasonTeamId, ...team }) => {
      assert.equal(seasonTeamId, teams.find(held => held.externalRosterId === team.externalRosterId)?.seasonTeamId); return team;
    });
    assert.deepEqual({ ...report, teams: nativeReportTeams }, projectWeeklyReport(normalized(fixture, 'weekly_report', league.report, 7)).value);
    checkpoint = 'official-standings';
    const official = array(value.officialResults); assert.equal(official.length, 1);
    const standings = available(available(official[0].resource).standings), standingsTeams = array(standings.teams);
    assert.equal(standingsTeams.length, 20);
    const nativeStandingsTeams = standingsTeams.map(({ seasonTeamId, ...team }) => {
      assert.equal(seasonTeamId, teams.find(held => held.externalRosterId === team.externalRosterId)?.seasonTeamId); return team;
    });
    assert.deepEqual(nativeStandingsTeams, projectOfficialStandings(normalized(fixture, 'rosters', league.rosters, null)).teams);
    checkpoint = 'season-history';
    const history = available(value.seasonHistory); assert.equal(array(history.leagues).length, 1); available(array(history.leagues)[0].resource);
    checkpoint = 'inventory';
    const inventory = object(value.periodInventory); assert.equal(array(inventory.tasks).length, 18);
    assert.equal(inventory.collection, 'complete'); assert.equal(inventory.readCoverage, slot.kind === 'current' ? 'page' : 'complete');
    checkpoint = 'stable-digest';
    const { readAt: _readAt, ...stable } = value; void _readAt;
    const digest = readerDigest(stable), key = slot.league + ':' + slot.kind, previous = expectedDigests.get(key);
    if (previous) assert.equal(digest, previous, 'Stored result changed during measurement.'); else expectedDigests.set(key, digest); return digest;
    } catch (error) { throw new ReaderCorrectnessError(checkpoint, error); }
  }
  async function stateSnapshot() {
    try { return await readReaderStateSnapshot(() => createPinnedIntegrationDatabase('owner'), caseDeadline - performance.now()); }
    catch (error) { if (error instanceof ReaderStateSnapshotError) { evidence.snapshotFailure = error.diagnostic; evidence.snapshotCleanupFailures = error.cleanupFailures; } throw error; }
  }
  it(READER_PERFORMANCE_TESTS[0], () => caseBody(0, async () => {
    const directory = await runPublicPlayerDirectoryStep(dependencies, AbortSignal.timeout(20_000)); assert.equal(directory.status, 'progress'); assert.equal(directory.providerRequests, 1);
    for (const league of source.leagues) {
      const requestId = randomUUID(); ownedRequests.add(requestId);
      await intake.submit({ id: requestId, username: league.username, seasons: [2026], periodInventory: PUBLIC_PERIOD_INVENTORY,
        transactionPeriod: { season: 2026, nativeWeek: 7 }, playoffBrackets: PUBLIC_PLAYOFF_BRACKETS, draftPicks: PUBLIC_DRAFT_PICKS, weeklyReports: [{ season: 2026, nativeWeek: 7 }] });
      for (let ordinal = 0; ordinal < 31; ordinal++) await step(requestId);
      assert.equal(await intake.next(requestId), 'complete');
      // Disclosed own-request operational reset only. Actual core/users typed writers
      // retain fresh candidate receipts after the eighteen settings captures advance head.
      assert(ownedRequests.has(requestId));
      await ownerQuery("UPDATE public.public_data_intakes SET terminal=false WHERE id=$1 AND username=$2", [requestId, league.username]);
      await ownerQuery("UPDATE public.public_data_league_candidates SET stage='core' WHERE intake_id=$1 AND external_league_id=$2", [requestId, league.native]);
      evidence.operationalResets++;
      assert.equal(await step(requestId), 'core'); assert.equal(await step(requestId), 'users'); assert.equal(await intake.next(requestId), 'complete');
      const mapping = await administration.readSourceMapping(league.native); assert(mapping);
      fixtures.push({ source: league, requestId, leagueSeasonId: mapping.leagueSeasonId, leagueKey: mapping.scope.leagueKey });
    }
    evidence.setupResponseCount = setupFetches; assert.equal(setupFetches, 1 + 16 * 54, 'Fixture HTTP inventory changed.');
    const [counts] = await connection.database.query(`SELECT (SELECT count(*) FROM public.public_data_exact_period_tasks WHERE status='complete')::integer AS periods,
      (SELECT count(*) FROM public.league_roster_capture_receipts)::integer AS receipts`);
    assert.equal(counts.periods, 288); evidence.dataset = { leagues: 16, rosters: 320, weeks: 288, players: 160, requestIds: fixtures.map(row => row.requestId),
      receiptCount: Number(counts.receipts), sourceBindings: source.leagues.map(readerDigest) };
    setup = false; const snapshot = await stateSnapshot(); evidence.beforeDigest = snapshot.digest; evidence.tableCounts = snapshot.counts;
  }), READER_PERFORMANCE_LIMITS[0]);
  it(READER_PERFORMANCE_TESTS[1], () => caseBody(1, async () => {
    assert.equal(fixtures.length, 16); assert.equal(setup, false);
    const result = await runReaderSchedule({ database, queries, read: (slot, measured) =>
      readPublicSleeperIntake(measured, createLeagueAdministrationStore(measured), fixtures[slot.league].requestId, READER_PERFORMANCE_OPTIONS[slot.kind]), verify });
    evidence.samples = result.samples; evidence.maximumActive = result.maximumActive; evidence.elapsedMs = result.elapsedMs;
    assertReaderTarget(result.samples); for (const kind of ['current', 'history'] as const) assertReaderTarget(result.samples.filter(row => row.kind === kind));
  }), READER_PERFORMANCE_LIMITS[1]);
  it(READER_PERFORMANCE_TESTS[2], () => caseBody(2, async () => {
    assert.equal(setup, false); assert.equal(fixtures.length, 16);
    for (const fixture of fixtures) for (const kind of ['period-task-list', 'player-directory'] as const) {
      const sample: ReaderSample = { index: 0, league: 0, kind: 'current', temperature: 'repeat-reader-call', lane: 0, startedMs: 0, elapsedMs: 0,
        status: 'passed', failure: 'none', statements: 0, rows: 0, decodedBytes: 0, statementMs: 0, resultDigest: null, failureDetail: null, sqlFailure: null };
      const measured = measuredReaderDatabase(database, queries, sample), start = performance.now();
      const value = kind === 'period-task-list' ? await readPublicPeriodTaskRows(measured, fixture.requestId, true)
        : await createLeagueAdministrationStore(measured).readAcceptedPlayerDirectory({ limit: 200 });
      const elapsedMs = performance.now() - start, rows = kind === 'period-task-list' ? array(value) : array(available(value).rows);
      assert.equal(rows.length, kind === 'period-task-list' ? 18 : 160);
      if (kind === 'player-directory') assert.deepEqual(rows.map(row => row.source), Object.values(source.players));
      evidence.lists.push({ kind, elapsedMs, rows: rows.length, bound: kind === 'period-task-list' ? 360 : 200, digest: readerDigest(value),
        statements: sample.statements, statementRows: sample.rows, decodedBytes: sample.decodedBytes });
    }
    for (const query of queries.values()) {
      const rows = await database.query('EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ' + query.sql, query.parameters, { signal: AbortSignal.timeout(10_000) });
      const plan = object(object(array(rows[0]['QUERY PLAN'])[0]).Plan);
      evidence.plans.push({ digest: query.digest, sql: query.sql, parameterDigest: readerDigest(query.parameters), explainedRows: Number(plan['Actual Rows']), plan: rows });
    }
    evidence.queries = [...queries.values()].map(({ parameters: _parameters, ...query }) => { void _parameters; return query; });
    evidence.afterDigest = (await stateSnapshot()).digest; assert.equal(evidence.beforeDigest, evidence.afterDigest); assert.equal(evidence.blockedFetches, 0);
  }), READER_PERFORMANCE_LIMITS[2]);
});
