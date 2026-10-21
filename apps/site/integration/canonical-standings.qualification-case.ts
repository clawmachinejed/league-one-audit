import { createHash, randomUUID } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { DatabaseClient } from '../lib/database';
import type { AdministrationWriteFence, CapturedAdministrationDocument, JsonValue, PublicCaptureWitness } from '../lib/league-administration/contracts';
import type { CanonicalSourceMappingV1 } from '../lib/league-administration/canonical-source-contracts';
import type { AdministrationSourceMapping } from '../lib/league-administration/source-mapping';
import type { CanonicalStandingsDelivery, CanonicalObservationWriteResult, CanonicalResourceAttempt } from '../lib/league-administration/canonical-standings-contracts';
import type { LeagueAdministrationStore } from '../lib/league-administration/store-contracts';
const selection = vi.hoisted(() => ({ native: false }));
// Qualification composition only; SQL still verifies every tuple independently.
vi.mock('../lib/league-administration/canonical-standings-policy', async importOriginal => {
  const original = await importOriginal<typeof import('../lib/league-administration/canonical-standings-policy')>();
  return { ...original, selectCanonicalStandingsCapture: (mapping: AdministrationSourceMapping, work: unknown) => selection.native
    ? original.sleeperCanonicalStandingsPolicy({ ...mapping, scope: { ...mapping.scope, nativeNamespace: 'nfl' }, sourceNamespace: 'nfl:2026' })
    : original.selectCanonicalStandingsCapture(mapping, work as never) };
});
import { canonicalStandingsMethods } from '../lib/league-administration/neon/canonical-official-standings';
import { createLeagueAdministrationStore, createPublicIntakeStore } from '../lib/league-administration/store';
import { createProjectionStore } from '../lib/projection-store';
import { runPublicIntakeStep, type PublicIntakeDependencies } from '../lib/league-administration/public-intake';
import { capturePublicSleeperCore, capturePublicSleeperIdentity, capturePublicSleeperLeagueList } from '../lib/sleeper';
import { assertOriginalPublicCapture } from '../lib/league-administration/public-capture-witness';
import { normalizeAdministrationObservation } from '../lib/league-administration/normalize';
import { projectOfficialStandings } from '../lib/aggregator/official-standings';
import { legacyStandingsMapping, resolveCanonicalStandingsPolicy, selectCanonicalStandingsCapture } from '../lib/league-administration/canonical-standings-policy';
import { createPinnedIntegrationDatabase, prepareIntegrationDatabase, integrationEnvironment,
  type IndependentDatabase } from './neon-integration-harness';
import { exactMatchupClockInstant } from './exact-matchup-clock';
import { createBackendControlsDatabaseFetchGuard } from './backend-controls-fetch';
import { qualificationBinding, qualificationDigest, assertCanonicalStandingsSupportSources } from './qualification-profile';
import { CANONICAL_STANDINGS_PROFILE, CANONICAL_STANDINGS_SUITE, CANONICAL_STANDINGS_TESTS,
  CANONICAL_STANDINGS_CASE_TIMEOUTS_MS, CANONICAL_STANDINGS_BEFORE_ALL_MS, CANONICAL_STANDINGS_AFTER_ALL_MS,
  CANONICAL_STANDINGS_LIMITS } from './canonical-standings-profile';
import { fixtureById, fixtureJobPayload, fixtureRegistration, projectFixtureStandings,
  buildFixtureStandingsDelivery, resolveFixtureStandingsPolicy, FIXTURE_JOB_TYPE, STANDINGS_FIXTURES, type StandingsFixture } from './canonical-standings-fixtures';

type Query = DatabaseClient['query'];
type FixtureOwner = { fixture: StandingsFixture; fence: AdministrationWriteFence; database: DatabaseClient };
type Prepared = FixtureOwner & { mapping: CanonicalSourceMappingV1; attempt: CanonicalResourceAttempt; delivery: CanonicalStandingsDelivery };
type Recorded = Prepared & { result: CanonicalObservationWriteResult };
const migrations = ['066_canonical_source_identities.sql', '067_canonical_standings.sql',
  '068_canonical_standings_acceptance.sql', '069_canonical_native_compatibility.sql'] as const;
const siteRoot = fileURLToPath(new URL('..', import.meta.url));
const nativeSources = [
  { id: '900000000000101', manager: '900000000000201', username: 'canonical_legacy_fixture' },
  { id: '900000000000102', manager: '900000000000202', username: 'canonical_bridge_fixture' },
] as const;
const nativeRosters = (manager: string): JsonValue => [{ roster_id: 1, owner_id: manager, co_owners: [],
  players: [], starters: [], reserve: [], taxi: [], settings: { wins: 2, losses: 1, ties: 0,
    fpts: 123, fpts_decimal: 45, fpts_against: 100, fpts_against_decimal: 0, rank: 1, seed: 1 } }];
const nativeLeague = (source: typeof nativeSources[number]) => ({ league_id: source.id, season: '2026', sport: 'nfl',
  name: 'Canonical protocol qualification', total_rosters: 1, settings: { type: 0 }, scoring_settings: {}, roster_positions: ['QB', 'BN'] });

/** Source candidate, not executed SQL proof. Runtime creates tested identities,
 * jobs and facts. The owner installs only policy and adverse instrumentation.
 * Only fixture transport is substituted; no SQL or reader results are mocked. */
describe.sequential(CANONICAL_STANDINGS_SUITE, () => {
  let runtime: IndependentDatabase, owner: IndependentDatabase;
  let fetchSpy: ReturnType<typeof vi.spyOn>, binding: NonNullable<ReturnType<typeof qualificationBinding>>;
  let serverVersion = '', serverVersionNum = 0, allowedNative: typeof nativeSources[number] | null = null;
  let forbiddenRequests = 0, oldMapping: AdministrationSourceMapping, oldRead: unknown, oldSnapshot: unknown;
  let bridge: Recorded | undefined, bridgeReplay: CanonicalObservationWriteResult | undefined;
  const sessions = new Set<IndependentDatabase>(), jobs: FixtureOwner[] = [], requests: string[] = [];
  const lateConnections: Promise<void>[] = [];
  const captures: CapturedAdministrationDocument[] = [], mutationsRejected: string[] = [];
  const completed: string[] = [], observations: Recorded[] = [];
  const nativeStepDurationsMs: number[] = [];
  const q: Query = (sql, args, options) => runtime.database.query(sql, args, options);
  const oq: Query = (sql, args, options) => owner.database.query(sql, args, options);
  const store = (database = runtime.database) => createLeagueAdministrationStore(database);
  const canonical = (database = runtime.database) => canonicalStandingsMethods(database, resolveFixtureStandingsPolicy);
  async function pin(role: 'owner' | 'runtime' = 'runtime') {
    const pending = createPinnedIntegrationDatabase(role);
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const session = await Promise.race([pending, new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('Canonical fixture connection deadline exceeded.')), 10_000);
      })]);
      sessions.add(session);
      await session.database.query("SET statement_timeout='10s'; SET lock_timeout='10s'");
      return session;
    } catch (error) { lateConnections.push(pending.then(session => session.close(), () => undefined)); throw error; }
    finally { clearTimeout(timer); }
  }
  async function transaction<T>(database: DatabaseClient, body: () => Promise<T>) {
    await database.query('BEGIN');
    try { const value = await body(); await database.query('COMMIT'); return value; }
    catch (error) { await database.query('ROLLBACK'); throw error; }
  }
  async function rejection(run: () => Promise<unknown>, code = 'P0001', diagnostic?: RegExp) {
    let caught: unknown;
    try { await run(); } catch (error) { caught = error; }
    expect(caught, 'Expected genuine SQL rejection').toBeDefined();
    expect(caught).toMatchObject({ code });
    if (diagnostic) expect(String(caught)).toMatch(diagnostic);
  }
  async function sqlRejection(database: DatabaseClient, sql: string, args: readonly unknown[] = [], code?: string) {
    await database.query('BEGIN');
    try { await rejection(() => database.query(sql, args), code); } finally { await database.query('ROLLBACK'); }
  }
  async function clock(database = runtime.database) {
    const [row] = await database.query('SELECT clock_timestamp() AS at'); return exactMatchupClockInstant(row.at);
  }
  async function claim(fixture: StandingsFixture, database = runtime.database, seconds = 25, deadlineSeconds = 20): Promise<FixtureOwner> {
    const workerId = randomUUID(), jobKey = 'canonical-fixture:' + randomUUID(), at = await clock(database);
    const acquired = await createProjectionStore(database).acquireJob({ jobKey, jobType: FIXTURE_JOB_TYPE,
      workerId, scheduledFor: at, leaseSeconds: seconds, payload: fixtureJobPayload(fixture) });
    if (acquired.kind !== 'acquired') throw new Error('Fixture job was not acquired through runtime.');
    const value = { fixture, database, fence: { jobKey, workerId, generation: acquired.attempt,
      deadlineAt: new Date(Date.parse(at) + deadlineSeconds * 1000).toISOString() } };
    jobs.push(value); return value;
  }
  async function register(context: FixtureOwner) {
    const input = fixtureRegistration(context.fixture, context.fence), method = store(context.database).registerCanonicalLeagueSeason;
    if (!method) throw new Error('Canonical registration capability absent.');
    return method(input.input, input.authorization);
  }
  async function prepare(id: string, database = runtime.database): Promise<Prepared> {
    const context = await claim(fixtureById(id), database), registered = await register(context);
    const attempt = await canonical(database).beginCanonicalResourceAttempt(registered.mapping, randomUUID(), context.fixture.policy, context.fence);
    const delivery = buildFixtureStandingsDelivery(context.fixture, registered.mapping, attempt, context.fence,
      { captureId: randomUUID(), checkedAt: await clock(database) });
    return { ...context, mapping: registered.mapping, attempt, delivery };
  }
  async function record(id: string): Promise<Recorded> {
    const prepared = await prepare(id), result = await canonical().recordCanonicalObservation(prepared.delivery,
      prepared.mapping, prepared.attempt, prepared.fence);
    const value = { ...prepared, result }; observations.push(value); return value;
  }
  const current = (mapping: CanonicalSourceMappingV1) => canonical().readCanonicalOfficialStandings(mapping, { kind: 'current', representation: 'canonical-v1' });
  const historical = (entry: Recorded) => canonical().readCanonicalOfficialStandings(entry.mapping,
    { kind: 'receipt', representation: 'canonical-v1', receiptId: entry.result.receiptId });
  const rawWrite = (delivery: unknown, database = runtime.database) => database.query(
    'SELECT public.record_league_administration_observation($1::jsonb) AS result', [JSON.stringify(delivery)]);
  const counts = () => q(`SELECT
    (SELECT count(*)::int FROM league_canonical_resource_contents) AS contents,
    (SELECT count(*)::int FROM league_canonical_resource_receipts) AS receipts,
    (SELECT count(*)::int FROM league_canonical_standings_teams) AS teams,
    (SELECT count(*)::int FROM league_season_teams) AS identities,
    (SELECT count(*)::int FROM league_roster_capture_receipts) AS native_receipts,
    (SELECT count(*)::int FROM league_administration_observations) AS native_observations,
    (SELECT count(*)::int FROM league_roster_resource_acceptances) AS acceptances,
    (SELECT count(*)::int FROM league_roster_resource_attempts) AS attempts,
    (SELECT jsonb_agg(to_jsonb(head) ORDER BY scope_id) FROM league_roster_resource_heads head) AS heads`);
  async function oldEvidence() {
    return q(`SELECT
      (SELECT jsonb_agg(to_jsonb(row) ORDER BY row.id) FROM league_administration_contents row WHERE league_season_id=$1) AS contents,
      (SELECT jsonb_agg(to_jsonb(row) ORDER BY row.id) FROM league_administration_observations row WHERE league_season_id=$1) AS observations,
      (SELECT jsonb_agg(to_jsonb(row) ORDER BY row.id) FROM league_roster_capture_receipts row JOIN league_roster_resource_attempts attempt ON attempt.id=row.attempt_id
        WHERE attempt.source_mapping->>'leagueSeasonId'=$1::text) AS receipts,
      (SELECT jsonb_agg(jsonb_build_object('id',id,'scopeId',scope_id,'ordinal',ordinal,'expectedGeneration',expected_generation,
        'sourceMapping',source_mapping,'writeFence',write_fence,'reservedAt',reserved_at,'nonce',capture_nonce) ORDER BY id)
        FROM league_roster_resource_attempts WHERE source_mapping->>'leagueSeasonId'=$1::text) AS attempts,
      (SELECT jsonb_agg(to_jsonb(row)-ARRAY['native_namespace','canonical_registration_context'] ORDER BY row.id)
        FROM league_source_connections row WHERE league_season_id=$1) AS connections,
      (SELECT jsonb_agg(to_jsonb(row)-'native_namespace' ORDER BY row.id)
        FROM league_source_mapping_revisions row WHERE league_season_id=$1) AS revisions,
      (SELECT jsonb_agg(to_jsonb(row)-ARRAY['native_namespace','previous_native_namespace'] ORDER BY row.id)
        FROM league_source_connection_history row WHERE league_season_id=$1) AS history,
      (SELECT jsonb_agg(to_jsonb(row)-ARRAY['native_namespace','source_league_namespace'] ORDER BY row.id)
        FROM league_season_teams row WHERE league_season_id=$1) AS team_identities,
      (SELECT jsonb_agg(to_jsonb(row)-'canonical_registration_context' ORDER BY row.league_id)
        FROM league_administration_enrollments row WHERE league_id=(SELECT league_id FROM league_seasons WHERE id=$1)) AS enrollments,
      (SELECT jsonb_agg(to_jsonb(row)-'canonical_registration_context' ORDER BY row.season)
        FROM league_administration_enrollment_seasons row WHERE league_id=(SELECT league_id FROM league_seasons WHERE id=$1)) AS enrollment_seasons,
      (SELECT to_jsonb(row) FROM league_seasons row WHERE id=$1) AS season`, [oldMapping.leagueSeasonId]);
  }
  async function blocked(waiter: number, blocker: number) {
    const until = Date.now() + 2000;
    while (Date.now() < until) {
      if ((await oq('SELECT $1::int=ANY(pg_blocking_pids($2::int)) AS blocked', [blocker, waiter]))[0].blocked) return;
      await delay(20);
    }
    throw new Error('Required independent-session lock was not observed.');
  }
  function test(index: number, body: () => Promise<void>) {
    it(CANONICAL_STANDINGS_TESTS[index], async () => { await body(); completed.push(CANONICAL_STANDINGS_TESTS[index]); }, CANONICAL_STANDINGS_CASE_TIMEOUTS_MS[index]);
  }
  async function nativeJourney(source: typeof nativeSources[number], selected: boolean) {
    selection.native = selected; allowedNative = source;
    const intake = createPublicIntakeStore(runtime.database), administration = store(), requestId = randomUUID();
    const originalCanonical = administration.recordCanonicalObservation;
    const observed: LeagueAdministrationStore = selected ? { ...administration,
      recordCanonicalObservation: async (delivery, mapping, attempt, fence) => {
        if (!originalCanonical) throw new Error('Missing native canonical writer.');
        const atomicBefore = await counts();
        await instrument('league_canonical_resource_receipts', "RAISE EXCEPTION 'qualification native companion rollback';");
        try { await rejection(() => rawWrite(delivery), 'P0001', /qualification native companion rollback/u); }
        finally { await removeInstrumentation(); }
        expect(await counts()).toEqual(atomicBefore); mutationsRejected.push('native-companion-atomic-rollback');
        const result = await originalCanonical(delivery, mapping, attempt, fence), before = await counts();
        const nativeReceipt = result.legacyResult?.rosterAcceptance?.receiptId;
        const hashBefore = await q('SELECT evidence_hash FROM league_roster_capture_receipts WHERE id=$1', [nativeReceipt]);
        expect(hashBefore).toHaveLength(1); expect(hashBefore[0].evidence_hash).toMatch(/^[0-9a-f]{64}$/u);
        bridgeReplay = await originalCanonical(delivery, mapping, attempt, fence);
        expect(await counts()).toEqual(before);
        expect(await q('SELECT evidence_hash FROM league_roster_capture_receipts WHERE id=$1', [nativeReceipt])).toEqual(hashBefore);
        const witness = delivery.provenance.acquisition as PublicCaptureWitness;
        const [oldNative] = await q(`SELECT receipt.attempt_id FROM league_roster_capture_receipts receipt
          JOIN league_roster_resource_attempts attempt ON attempt.id=receipt.attempt_id
          WHERE attempt.source_mapping->>'leagueSeasonId'=$1 LIMIT 1`, [oldMapping.leagueSeasonId]);
        const changed = [
          ['bridge-replay-capture-id', { ...delivery, provenance: { ...delivery.provenance, captureId: randomUUID() } }, /replay|evidence/u],
          ['bridge-swapped-witness', { ...delivery, provenance: { ...delivery.provenance, acquisition: { ...witness, dispatchNonce: randomUUID() } } }, /witness|acquisition/u],
          ['bridge-swapped-payload', { ...delivery, nativePayload: [] }, /legacy submission mismatch/u],
          ['bridge-swapped-attempt', { ...delivery, attempt: { ...attempt, nonce: randomUUID() } }, /attempt mismatch/u],
          ['bridge-old-native-receipt', { ...delivery, nativeSourceRef: { kind: 'sleeper-roster-bridge-v1', nativeAttemptId: oldNative.attempt_id } }, /companion\/native reservation mismatch/u],
        ] as const;
        for (const [label, value, diagnostic] of changed) { await rejection(() => rawWrite(value), 'P0001', diagnostic); mutationsRejected.push(label); }
        await q('BEGIN');
        try {
          const freshAttempt = await canonicalStandingsMethods(runtime.database).beginCanonicalResourceAttempt(mapping, randomUUID(), delivery.policy, fence);
          await rejection(() => rawWrite({ ...delivery, attempt: freshAttempt, provenance: { ...delivery.provenance, captureId: randomUUID() } }),
            'P0001', /companion\/native reservation mismatch/u);
          mutationsRejected.push('bridge-old-capture-new-attempt');
        } finally { await q('ROLLBACK'); }
        expect(await counts()).toEqual(before);
        bridge = { fixture: fixtureById('sleeper-parity'), database: runtime.database, delivery, mapping, attempt, fence, result };
        return result;
      } } : administration;
    const originalWitness = intake.captureWitness;
    const observedIntake = !selected ? intake : { ...intake, captureWitness: async (...args: Parameters<NonNullable<typeof originalWitness>>) => {
      if (!originalWitness) throw new Error('Missing native witness capability.');
      const witness = await originalWitness(...args);
      if (args[0].kind === 'core') {
        expect(Object.keys(witness.attempts).sort()).toEqual(['managers', 'players', 'settings']);
        const mapping = args[1]!;
        const canonicalMapping = { ...mapping, scope: { ...mapping.scope, nativeNamespace: 'nfl' }, sourceNamespace: 'nfl:2026' };
        const [companion] = await q(`SELECT attempt.id,attempt.scope_id FROM league_roster_resource_attempts attempt
          JOIN league_roster_resource_scopes scope ON scope.id=attempt.scope_id
          WHERE attempt.write_fence=$1::jsonb AND scope.identity->'scope'->>'family'='standings'`, [JSON.stringify(args[2])]);
        expect(companion).toBeDefined();
        // Owner-corrupted metadata under SET LOCAL ROLE is validator fault
        // injection. Only the restored positive path is a genuine runtime LOGIN.
        const wrongMapping = { ...oldMapping, scope: { ...oldMapping.scope, nativeNamespace: 'nfl' }, sourceNamespace: 'nfl:2026' };
        const mutations = [
          ['zero-native-companion', 'UPDATE league_roster_resource_attempts SET write_fence=NULL WHERE id=$1', [companion.id], null],
          ['null-companion-nonce', 'UPDATE league_roster_resource_attempts SET capture_nonce=NULL WHERE id=$1', [companion.id], /canonical companion mismatch/u],
          ['predispatch-companion', `UPDATE league_roster_resource_attempts SET reserved_at=(SELECT admitted_at-interval '1 microsecond'
            FROM public_data_dispatches WHERE worker_id=$2 AND generation=$3) WHERE id=$1`, [companion.id, args[2].workerId, args[2].generation], /canonical companion mismatch/u],
          ['late-native-companion', 'UPDATE league_roster_resource_attempts SET reserved_at=clock_timestamp() WHERE id=$1', [companion.id], /must precede native players/u],
          ['wrong-mapping-companion', 'UPDATE league_roster_resource_attempts SET source_mapping=$2::jsonb WHERE id=$1', [companion.id, JSON.stringify(wrongMapping)], /canonical companion mismatch/u],
          ['unknown-native-companion', `UPDATE league_roster_resource_attempts SET source_mapping=$2::jsonb WHERE id=$1;
            UPDATE league_roster_resource_scopes SET identity=jsonb_set(identity,'{scope,family}','"unknown"') WHERE id=$3`,
          [companion.id, JSON.stringify(mapping), companion.scope_id], /resource group mismatch/u],
        ] as const;
        for (const [label, sql, parameters, diagnostic] of mutations) {
          await oq('BEGIN');
          try {
            await oq('ALTER TABLE league_roster_resource_attempts DISABLE TRIGGER roster_attempt_immutable');
            if (label === 'unknown-native-companion') await oq('ALTER TABLE league_roster_resource_scopes DISABLE TRIGGER roster_scope_immutable');
            // node-postgres extended queries accept one parameterized statement.
            if (label === 'unknown-native-companion') {
              await oq('UPDATE league_roster_resource_attempts SET source_mapping=$2::jsonb WHERE id=$1', parameters.slice(0, 2));
              await oq(`UPDATE league_roster_resource_scopes SET identity=jsonb_set(identity,'{scope,family}','"unknown"') WHERE id=$1`, [companion.scope_id]);
              await oq('ALTER TABLE league_roster_resource_scopes ENABLE TRIGGER roster_scope_immutable');
            } else await oq(sql, parameters);
            await oq('ALTER TABLE league_roster_resource_attempts ENABLE TRIGGER roster_attempt_immutable');
            await oq('SET LOCAL ROLE league_one_runtime');
            const actual = createPublicIntakeStore(owner.database).captureWitness!;
            if (diagnostic === null) expect(await actual(...args)).toEqual(witness);
            else await rejection(() => actual(...args), 'P0001', diagnostic);
          } finally { await oq('ROLLBACK'); }
          expect(await originalWitness(...args)).toEqual(witness); mutationsRejected.push(label);
        }
        const triggers = await q(`SELECT tgname,tgenabled FROM pg_trigger WHERE (tgrelid='public.league_roster_resource_attempts'::regclass
          AND tgname='roster_attempt_immutable') OR (tgrelid='public.league_roster_resource_scopes'::regclass AND tgname='roster_scope_immutable') ORDER BY tgname`);
        expect(triggers).toEqual([{ tgname: 'roster_attempt_immutable', tgenabled: 'O' }, { tgname: 'roster_scope_immutable', tgenabled: 'O' }]);
        await rejection(() => originalWitness({ kind: 'users', requestId: witness.work.requestId, revision: witness.work.revision,
          externalLeagueId: mapping.scope.externalLeagueId, season: mapping.scope.season }, args[1], args[2]), 'P0001', /checkpoint changed|original public dispatch/u);
        mutationsRejected.push('wrong-work-companion');
        await runtime.database.query('BEGIN');
        try {
          await canonicalStandingsMethods(runtime.database).beginCanonicalResourceAttempt(canonicalMapping, randomUUID(), resolveCanonicalStandingsPolicy(canonicalMapping), args[2]);
          await rejection(() => originalWitness(...args), 'P0001', /canonical companion mismatch/u); mutationsRejected.push('duplicate-native-companion');
        } finally { await runtime.database.query('ROLLBACK'); }
        expect(await originalWitness(...args)).toEqual(witness);
      }
      return witness;
    } };
    const dependencies: PublicIntakeDependencies = { intake: observedIntake, administration: observed, jobs: createProjectionStore(runtime.database),
      source: { identity: capturePublicSleeperIdentity, leagues: capturePublicSleeperLeagueList,
        core: async (external, family, signal, witness) => {
          const capture = await capturePublicSleeperCore(external, family, signal, undefined, witness);
          assertOriginalPublicCapture(capture, witness!);
          expect(() => assertOriginalPublicCapture({ ...capture }, witness!)).toThrow();
          captures.push(capture); return capture;
        } } };
    await intake.submit({ id: requestId, username: source.username, seasons: [2026] });
    const started = Date.now(), before = requests.length;
    for (const stage of ['identity', 'leagues', 'bootstrap', 'core']) {
      let done = false;
      while (!done && Date.now() - started < 225_000) {
        const stepStarted = Date.now();
        const outcome = await runPublicIntakeStep(requestId, dependencies, AbortSignal.timeout(20_000));
        if (outcome.status === 'busy' || outcome.status === 'backoff') { await delay(500); continue; }
        const elapsed = Date.now() - stepStarted; nativeStepDurationsMs.push(elapsed);
        expect(elapsed).toBeLessThan(20_000);
        expect(outcome).toMatchObject({ status: 'progress', resource: stage, providerRequests: stage === 'core' ? 2 : 1 }); done = true;
      }
      expect(done, 'Native dispatch exceeded bounded real-time interval').toBe(true);
    }
    const mapping = await administration.readSourceMapping(source.id); if (!mapping) throw new Error('Native mapping absent.');
    expect(requests.slice(before)).toEqual([`/v1/user/${source.username}`, `/v1/user/${source.manager}/leagues/nfl/2026`,
      `/v1/league/${source.id}`, `/v1/league/${source.id}`, `/v1/league/${source.id}/rosters`]);
    allowedNative = null; selection.native = false; return mapping;
  }
  beforeAll(async () => {
    const selected = qualificationBinding();
    if (selected?.context.profile !== CANONICAL_STANDINGS_PROFILE) throw new Error('Closed canonical qualification context required.');
    binding = selected; await assertCanonicalStandingsSupportSources(siteRoot);
    await prepareIntegrationDatabase({ throughMigration: '065_roster_provenance_contents.sql' });
    runtime = await pin(); owner = await pin('owner');
    expect((await q('SELECT session_user,current_user'))[0]).toEqual({ session_user: 'league_one_runtime', current_user: 'league_one_runtime' });
    const [version] = await q("SELECT current_setting('server_version') AS version,current_setting('server_version_num') AS version_num");
    serverVersion = String(version.version); serverVersionNum = Number(version.version_num);
    expect(serverVersionNum).toBeGreaterThanOrEqual(CANONICAL_STANDINGS_LIMITS.minimumPostgresVersion);
    expect(serverVersionNum).toBeLessThanOrEqual(CANONICAL_STANDINGS_LIMITS.maximumPostgresVersion);
    const originalFetch = globalThis.fetch, databaseFetch = createBackendControlsDatabaseFetchGuard(integrationEnvironment().runtimeDatabaseUrl);
    fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      if (databaseFetch(input, init)) return originalFetch(input, init);
      const url = new URL(input instanceof Request ? input.url : String(input)), source = allowedNative;
      if (url.origin !== 'https://api.sleeper.app' || !source || (init?.method ?? 'GET') !== 'GET') {
        forbiddenRequests++; throw new Error('Canonical qualification provider network tripwire.');
      }
      let payload: unknown;
      if (url.pathname === `/v1/user/${source.username}`) payload = { user_id: source.manager, username: source.username, display_name: source.username };
      else if (url.pathname === `/v1/user/${source.manager}/leagues/nfl/2026`) payload = [nativeLeague(source)];
      else if (url.pathname === `/v1/league/${source.id}`) payload = nativeLeague(source);
      else if (url.pathname === `/v1/league/${source.id}/rosters`) payload = nativeRosters(source.manager);
      else { forbiddenRequests++; throw new Error('Unregistered fixture transport path.'); }
      requests.push(url.pathname); return new Response(JSON.stringify(payload), { headers: { 'content-type': 'application/json' } });
    });
    oldMapping = await nativeJourney(nativeSources[0], false);
    oldRead = await store().readOfficialStandings!(oldMapping); expect(oldRead).toMatchObject({ status: 'available' }); oldSnapshot = await oldEvidence();
    for (const name of migrations) {
      const sql = (await readFile(new URL(`../migrations/${name}`, import.meta.url), 'utf8')).replace(/\r\n?/gu, '\n');
      await transaction(owner.database, async () => {
        await oq("SELECT pg_advisory_xact_lock(hashtext('league-one-schema-migrations'))"); await oq(sql);
        await oq('INSERT INTO app_schema_migrations(name,checksum) VALUES($1,$2)', [name, createHash('sha256').update(sql).digest('hex')]);
      });
    }
    expect(await oldEvidence()).toEqual(oldSnapshot); expect(await store().readOfficialStandings!(oldMapping)).toEqual(oldRead);
    await oq(await readFile(new URL('../scripts/provision-runtime-role.sql', import.meta.url), 'utf8'));
    const context = await claim(fixtureById('alpha-complete')), input = fixtureRegistration(context.fixture, context.fence);
    await rejection(() => store().registerCanonicalLeagueSeason!(input.input, input.authorization), 'P0001', /unregistered|not installed/u);
    mutationsRejected.push('production-fixture-denial');
    expect((await q('SELECT count(*)::int AS count FROM league_source_connections WHERE provider=$1', ['fixture-sports']))[0].count).toBe(0);
    await transaction(owner.database, async () => oq(await readFile(new URL('./canonical-standings-fixture-policy.sql', import.meta.url), 'utf8')));
    expect((await oq('SELECT public.canonical_standings_fixture_registry() AS registry'))[0].registry).toEqual(STANDINGS_FIXTURES);
  }, CANONICAL_STANDINGS_BEFORE_ALL_MS);

  test(0, async () => {
    const entry = await record('alpha-complete'), read = await current(entry.mapping);
    expect(entry.result).toMatchObject({ status: 'recorded', outcome: 'accepted', acceptedGeneration: 1 });
    expect(read).toMatchObject({ status: 'available', representation: 'canonical-v1', population: 'proven',
      expectedTeamCount: 2, recordCompleteness: 'complete', freshness: 'unknown', historicalApplicability: 'unverified',
      receipt: { legacyRosterReceiptId: null }, coverage: { entitySet: 'full', completeness: 'complete' } });
    if (read.status !== 'available' || read.representation !== 'canonical-v1') throw new Error('Standalone reader unavailable.');
    expect(read.facts).toEqual(projectFixtureStandings(entry.fixture));
    expect(read.teams.map(team => team.sourceTeam.nativeId)).toEqual(['club:ABC-7', 'club:XYZ-9']);
    expect(new Set(read.teams.map(team => team.seasonTeamId)).size).toBe(2);
    const [identity] = await q(`SELECT season.league_id,season.scoring_profile_id,enrollment.active,enrollment.evidence
      FROM league_seasons season JOIN league_administration_enrollments enrollment ON enrollment.league_id=season.league_id WHERE season.id=$1`, [entry.mapping.leagueSeasonId]);
    expect(identity).toMatchObject({ scoring_profile_id: null, active: false, evidence: 'canonical-official-data-v1' });
    for (const season of [undefined, 2026]) {
      const inventory = await store().listEnrollmentInventory(season);
      expect(inventory.entries.some(item => item.intended.leagueId === identity.league_id)).toBe(false);
      expect(JSON.stringify(inventory)).not.toContain(entry.mapping.leagueSeasonId);
    }
    expect(await store().readCanonicalSourceMapping!({ sourceLeague: entry.fixture.sourceLeague, leagueSeasonId: entry.mapping.leagueSeasonId }))
      .toEqual({ status: 'available', mapping: entry.mapping });
    expect((await q('SELECT count(*)::int AS count FROM league_roster_capture_receipts receipt JOIN league_roster_resource_attempts attempt ON attempt.id=receipt.attempt_id JOIN league_roster_resource_scopes scope ON scope.id=attempt.scope_id WHERE scope.league_season_id=$1',
      [entry.mapping.leagueSeasonId]))[0].count).toBe(0);
  });

  test(1, async () => {
    const entry = await record('sleeper-parity'), read = await historical(entry);
    expect(read).toMatchObject({ status: 'available', population: 'unproved', receipt: { legacyRosterReceiptId: null } });
    const native = projectOfficialStandings(normalizeAdministrationObservation({ schemaVersion: 'league-administration-v1',
      normalizerVersion: 'sleeper-administration-v1', dialect: 'sleeper-nfl-v1',
      scope: { provider: 'sleeper', leagueKey: entry.fixture.leagueKey, externalLeagueId: entry.fixture.sourceLeague.nativeId, season: 2026 },
      family: 'rosters', week: null, completeness: 'complete', payload: entry.fixture.nativePayload,
      provenance: { origin: 'bootstrap', requestStartedAt: null, requestCompletedAt: null, sourceObservedAt: null, checkedAt: await clock() } }));
    if (read.status !== 'available' || read.representation !== 'canonical-v1') throw new Error('Sleeper fixture reader unavailable.');
    expect(read.facts).toEqual(projectFixtureStandings(entry.fixture));
    native.teams.forEach((team, index) => {
      expect(read.facts.teams[index].pointsFor).toEqual({ state: team.pointsFor.state, value: team.pointsFor.value });
      expect(read.facts.teams[index].pointsAgainst).toEqual({ state: team.pointsAgainst.state, value: team.pointsAgainst.value });
      expect(read.facts.teams[index].record.wins).toEqual({ state: team.record.wins.state, value: team.record.wins.value });
      expect(read.facts.teams[index].record.losses).toEqual({ state: team.record.losses.state, value: team.record.losses.value });
      expect(read.facts.teams[index].record.ties).toEqual({ state: team.record.ties.state, value: team.record.ties.value });
      expect(read.facts.teams[index].providerRank).toEqual({ state: team.providerRank.state, value: team.providerRank.value });
      expect(read.facts.teams[index].providerSeed).toEqual({ state: team.providerSeed.state, value: team.providerSeed.value });
    });
    expect(await store().readOfficialStandings!(oldMapping)).toEqual(oldRead);
    expect(await oldEvidence()).toEqual(oldSnapshot);
  });

  test(2, async () => {
    const beta = await record('beta-complete'), gamma = await record('gamma-complete');
    const alpha = observations.find(item => item.fixture.id === 'alpha-complete')!;
    const read = await Promise.all([alpha, beta, gamma].map(historical));
    const ids = read.flatMap(value => value.status === 'available' && value.representation === 'canonical-v1' ? value.teams.map(team => team.seasonTeamId) : []);
    expect(new Set(ids).size).toBe(6);
    expect(new Set([alpha, beta, gamma].map(item => item.mapping.connectionId)).size).toBe(3);
    const prepared = await prepare('alpha-complete'), before = await counts();
    for (const mapping of [{ ...prepared.mapping, revisionId: randomUUID() },
      { ...prepared.mapping, sourceNamespace: 'wrong:season' }, { ...prepared.mapping, scope: { ...prepared.mapping.scope, nativeNamespace: 'league:beta' } },
      { ...prepared.mapping, leagueSeasonId: beta.mapping.leagueSeasonId }]) {
      await rejection(() => rawWrite({ ...prepared.delivery, mapping }));
    }
    await sqlRejection(runtime.database, 'UPDATE league_source_connections SET canonical_registration_context=$1::jsonb WHERE id=$2', ['{}', prepared.mapping.connectionId], 'P0001');
    await runtime.database.query('BEGIN');
    try {
      await q("UPDATE projection_jobs SET payload=jsonb_set(payload,'{standingsDigest}',to_jsonb($2::text)) WHERE job_key=$1", [prepared.fence.jobKey, 'sha256:' + '0'.repeat(64)]);
      await rejection(() => rawWrite(prepared.delivery), 'P0001', /unregistered fixture job payload/u);
    } finally { await q('ROLLBACK'); }
    const registration = fixtureRegistration(beta.fixture, (await claim(beta.fixture)).fence);
    await rejection(() => store().registerCanonicalLeagueSeason!({ ...registration.input, leagueKey: alpha.mapping.scope.leagueKey }, registration.authorization));
    expect(await counts()).toEqual(before);
    expect((await canonical().recordCanonicalObservation(prepared.delivery, prepared.mapping, prepared.attempt, prepared.fence)).outcome).toBe('accepted');
  });

  test(3, async () => {
    const prepared = await prepare('alpha-complete'), before = await counts(), input = prepared.delivery;
    const changed = [
      { ...input, verified: true }, { ...input, contractVersion: 'future' }, { ...input, adapterVersion: 'unknown' },
      { ...input, canonicalValue: { ...input.canonicalValue, teams: [] } },
      { ...input, coverage: { ...input.coverage, fields: [] } },
      { ...input, nativePayload: [] }, { ...input, nativeSourceRef: { ...input.nativeSourceRef, sourceDigest: 'sha256:' + '0'.repeat(64) } },
      { ...input, provenance: { ...input.provenance, requestStartedAt: null, requestCompletedAt: input.provenance.checkedAt } },
      { ...input, provenance: { ...input.provenance, requestStartedAt: input.provenance.checkedAt, requestCompletedAt: null } },
      { ...input, provenance: { ...input.provenance, acquisition: { ...input.provenance.acquisition, nonce: randomUUID() } } },
      { ...input, policy: { ...input.policy, audienceId: 'account' } }, { ...input, scope: { ...input.scope, family: 'teams' } },
      { ...input, canonicalValue: { ...input.canonicalValue, teams: input.canonicalValue.teams.map(team => ({ ...team,
        sourceTeam: { ...team.sourceTeam, nativeNamespace: 'squads:beta:2026' } })) } },
    ];
    for (const altered of changed) await rejection(() => rawWrite(altered));
    await rejection(() => rawWrite({ ...input, provenance: { ...input.provenance, normalizedAt: '2026-02-30T00:00:00Z' } }), '22008');
    for (const sql of ["SELECT public.canonical_native_hash('{}'::jsonb)",
      "SELECT public.verify_registered_canonical_delivery('{}'::jsonb,'{}'::jsonb)",
      "SELECT public.accept_canonical_resource('{}'::jsonb,'{}'::jsonb)",
      "SELECT public.record_league_administration_observation_legacy_v65('{}'::jsonb)",
      "SELECT public.record_league_administration_observation_v54('{}'::jsonb)",
      'INSERT INTO league_canonical_resource_contents DEFAULT VALUES',
      'UPDATE league_canonical_resource_receipts SET outcome=outcome',
      'DELETE FROM league_canonical_standings_teams', 'TRUNCATE league_canonical_resource_contents CASCADE']) {
      await sqlRejection(runtime.database, sql, [], '42501');
    }
    expect(await counts()).toEqual(before);
    expect((await canonical().recordCanonicalObservation(prepared.delivery, prepared.mapping, prepared.attempt, prepared.fence)).outcome).toBe('accepted');
    mutationsRejected.push('native-parity', 'mixed-input', 'fixture-provenance-pair', 'private-helpers', 'direct-evidence-dml');
  });

  async function instrument(relation: 'league_canonical_standings_teams' | 'league_canonical_resource_receipts' | 'league_canonical_resource_contents', body: string) {
    await oq(`CREATE FUNCTION public.canonical_qualification_corrupt() RETURNS trigger LANGUAGE plpgsql
      SET search_path=pg_catalog,public,pg_temp AS $$ BEGIN ${body} END; $$;
      REVOKE ALL ON FUNCTION public.canonical_qualification_corrupt() FROM PUBLIC,league_one_runtime,league_one_account,league_one_auth;
      CREATE TRIGGER zz_canonical_qualification_corrupt BEFORE INSERT ON public.${relation}
      FOR EACH ROW EXECUTE FUNCTION public.canonical_qualification_corrupt()`);
  }
  async function removeInstrumentation() {
    await oq(`DROP TRIGGER IF EXISTS zz_canonical_qualification_corrupt ON public.league_canonical_standings_teams;
      DROP TRIGGER IF EXISTS zz_canonical_qualification_corrupt ON public.league_canonical_resource_receipts;
      DROP TRIGGER IF EXISTS zz_canonical_qualification_corrupt ON public.league_canonical_resource_contents;
      DROP FUNCTION IF EXISTS public.canonical_qualification_corrupt()`);
  }
  test(4, async () => {
    for (const [body, code, diagnostic] of [
      ["NEW.wins:=999; RETURN NEW;", 'P0001', /typed materialization mismatch/u],
      ["RETURN NULL;", 'P0001', /typed materialization mismatch/u],
      ["NEW.season_team_id:=gen_random_uuid(); RETURN NEW;", '23503', /foreign key constraint/u],
      ["NEW.source_ordinal:=0; RETURN NEW;", '23505', /unique constraint/u],
      ["NEW.field_states:=jsonb_set(NEW.field_states,'{wins}','\"absent\"'); NEW.wins:=0; RETURN NEW;", 'P0001', /typed materialization mismatch/u],
    ] as const) {
      const prepared = await prepare('alpha-field-states'), before = await counts();
      await instrument('league_canonical_standings_teams', body);
      try { await rejection(() => rawWrite(prepared.delivery), code, diagnostic); } finally { await removeInstrumentation(); }
      expect(await counts()).toEqual(before);
    }
    const prepared = await prepare('alpha-field-states'), before = await counts();
    const other = observations.find(entry => entry.fixture.id === 'alpha-complete')!;
    await instrument('league_canonical_resource_contents', `NEW.first_receipt_id:='${other.result.receiptId}'::uuid; RETURN NEW;`);
    try { await rejection(() => rawWrite(prepared.delivery), 'P0001', /first receipt|typed closure/u); } finally { await removeInstrumentation(); }
    expect(await counts()).toEqual(before);
    await instrument('league_canonical_resource_receipts', "RAISE EXCEPTION 'qualification injected after typed materialization';");
    try { await rejection(() => rawWrite(prepared.delivery), 'P0001', /qualification injected after typed materialization/u); } finally { await removeInstrumentation(); }
    expect(await counts()).toEqual(before);
    const valid = await canonical().recordCanonicalObservation(prepared.delivery, prepared.mapping, prepared.attempt, prepared.fence);
    expect(valid.outcome).toBe('preserved-conflict');
    expect(await canonical().readCanonicalOfficialStandings(prepared.mapping, { kind: 'receipt', representation: 'canonical-v1', receiptId: valid.receiptId }))
      .toMatchObject({ status: 'available', recordCompleteness: 'partial' });
    mutationsRejected.push('typed-value', 'missing-child', 'wrong-team-uuid', 'duplicate-child', 'state-value-pair', 'first-receipt-closure', 'post-materialization-rollback');
  });

  test(5, async () => {
    const mapping = await nativeJourney(nativeSources[1], true);
    if (!bridge) throw new Error('Actual protocol bridge was not recorded.');
    expect(bridge.mapping.leagueSeasonId).toBe(mapping.leagueSeasonId);
    expect(bridge.result).toMatchObject({ status: 'recorded', outcome: 'accepted', legacyResult: { rosterAcceptance: { status: 'accepted' } } });
    const read = await canonicalStandingsMethods(runtime.database).readCanonicalOfficialStandings(bridge.mapping,
      { kind: 'current', representation: 'canonical-v1' });
    expect(read).toMatchObject({ status: 'available', population: 'proven', expectedTeamCount: 1,
      receipt: { legacyRosterReceiptId: bridge.result.legacyResult!.rosterAcceptance!.receiptId } });
    const [ordering] = await q(`SELECT canonical.reserved_at<=native.reserved_at AS correct,
      public.roster_capture_provenance(receipt)->'acquisition' AS acquisition
      FROM league_roster_resource_attempts canonical JOIN league_roster_resource_attempts native ON native.id=$2
      JOIN league_roster_capture_receipts receipt ON receipt.attempt_id=native.id WHERE canonical.id=$1`,
      [bridge.attempt.id, bridge.delivery.nativeSourceRef.kind === 'sleeper-roster-bridge-v1' ? bridge.delivery.nativeSourceRef.nativeAttemptId : null]);
    expect(ordering.correct).toBe(true);
    expect(Object.keys((ordering.acquisition as { attempts: object }).attempts).sort()).toEqual(['managers', 'players', 'settings']);
    expect(mutationsRejected).toContain('duplicate-native-companion');
    expect(await oldEvidence()).toEqual(oldSnapshot);
  });

  test(6, async () => {
    if (!bridge || !bridgeReplay) throw new Error('Live-fence replay evidence missing.');
    expect(bridgeReplay).toMatchObject({ status: 'replayed', receiptId: bridge.result.receiptId,
      contentId: bridge.result.contentId, attemptId: bridge.attempt.id, outcome: 'accepted' });
    expect(bridgeReplay.legacyResult?.observationId).toBe(bridge.result.legacyResult?.observationId);
    expect(bridgeReplay.legacyResult?.rosterAcceptance?.receiptId).toBe(bridge.result.legacyResult?.rosterAcceptance?.receiptId);
    expect((await q('SELECT count(*)::int AS count FROM league_canonical_resource_receipts WHERE attempt_id=$1', [bridge.attempt.id]))[0].count).toBe(1);
    expect(mutationsRejected).toContain('bridge-replay-capture-id');
    for (const label of ['bridge-swapped-witness', 'bridge-swapped-payload', 'bridge-swapped-attempt',
      'bridge-old-native-receipt', 'bridge-old-capture-new-attempt']) expect(mutationsRejected).toContain(label);
    const fresh = await prepare('alpha-complete'), first = await canonical().recordCanonicalObservation(fresh.delivery, fresh.mapping, fresh.attempt, fresh.fence);
    const before = await counts(), replay = await canonical().recordCanonicalObservation(fresh.delivery, fresh.mapping, fresh.attempt, fresh.fence);
    expect(replay).toEqual({ ...first, status: 'replayed' }); expect(await counts()).toEqual(before);
    await rejection(() => rawWrite({ ...fresh.delivery, nativeSourceRef: { kind: 'sleeper-roster-bridge-v1',
      nativeAttemptId: bridge!.delivery.nativeSourceRef.kind === 'sleeper-roster-bridge-v1' ? bridge!.delivery.nativeSourceRef.nativeAttemptId : null } }));
    expect(await counts()).toEqual(before);
  });

  test(7, async () => {
    const first = await record('alpha-complete'), second = await record('alpha-complete');
    expect(second.result.contentId).toBe(first.result.contentId); expect(second.result.receiptId).not.toBe(first.result.receiptId);
    expect(second.delivery.provenance.captureId).not.toBe(first.delivery.provenance.captureId);
    const correction = await record('alpha-correction'); expect(correction.result.outcome).toBe('accepted');
    expect(correction.result.contentId).not.toBe(first.result.contentId);
    const stale = await record('alpha-stale'); expect(stale.result.outcome).toBe('preserved-stale');
    const conflict = await record('alpha-conflict'); expect(conflict.result.outcome).toBe('preserved-conflict');
    expect(await current(conflict.mapping)).toMatchObject({ status: 'unavailable', reason: 'source-time-conflict' });
    expect(await historical(conflict)).toMatchObject({ status: 'available', receipt: { outcome: 'preserved-conflict', acceptedGeneration: null } });
    expect(await historical(first)).toMatchObject({ status: 'available', facts: first.delivery.canonicalValue });
    expect(await historical(correction)).toMatchObject({ status: 'available', facts: correction.delivery.canonicalValue });
    const [head] = await q(`SELECT accepted.canonical_receipt_id FROM league_roster_resource_heads head
      JOIN league_roster_resource_acceptances accepted ON accepted.id=head.accepted_id WHERE head.scope_id=$1`, [first.attempt.scopeId]);
    expect(head.canonical_receipt_id).toBe(correction.result.receiptId);
  });

  test(8, async () => {
    // Native source clocks increase in this fixed sequence; current partial
    // availability must come from each new receipt, with old facts immutable.
    const prior = observations.find(item => item.fixture.id === 'alpha-complete')!;
    for (const [id, population, entitySet] of [
      ['alpha-partial', 'mismatch', 'subset'], ['alpha-unproved', 'unproved', 'unknown'],
      ['alpha-matching-unproved', 'unproved', 'subset'], ['alpha-mismatch', 'mismatch', 'subset'],
    ] as const) {
      const entry = await record(id), read = await historical(entry);
      expect(entry.result.outcome).toBe('accepted');
      expect(read).toMatchObject({ status: 'available', population, coverage: { entitySet } });
      expect(await current(entry.mapping)).toMatchObject({ status: 'available', population, coverage: { entitySet } });
      expect(await historical(prior)).toMatchObject({ status: 'available', facts: prior.delivery.canonicalValue });
    }
    for (const [id, outcome] of [['alpha-duplicate', 'invalid'], ['alpha-capacity', 'capacity'], ['alpha-decimal-capacity', 'capacity']] as const) {
      const entry = await record(id); expect(entry.result.outcome).toBe(outcome);
      expect(await current(entry.mapping)).toMatchObject({ status: 'unavailable' });
    }
    const pending = await prepare('alpha-complete');
    expect(await current(pending.mapping)).toMatchObject({ status: 'unavailable', reason: 'pending' });
    await rejection(() => rawWrite({ ...pending.delivery, canonicalValue: { ...pending.delivery.canonicalValue, teams: [] } }));
    expect(await current(pending.mapping)).toMatchObject({ status: 'unavailable', reason: 'pending' });
    expect(await historical(prior)).toMatchObject({ status: 'available' });
  });

  test(9, async () => {
    const waiter = await pin(), fixture = fixtureById('beta-complete');
    const base = observations.find(entry => entry.fixture.id === fixture.id)!;
    const waiterPid = Number((await waiter.database.query('SELECT pg_backend_pid() AS pid'))[0].pid);
    const ownerPid = Number((await oq('SELECT pg_backend_pid() AS pid'))[0].pid);
    for (const target of ['source', 'head'] as const) {
      const context = await claim(fixture, waiter.database, 3, 2), registered = await register(context), id = randomUUID();
      await oq('BEGIN');
      try {
        await oq(target === 'source' ? 'SELECT id FROM league_source_connections WHERE id=$1 FOR UPDATE'
          : 'SELECT scope_id FROM league_roster_resource_heads WHERE scope_id=$1 FOR UPDATE',
        [target === 'source' ? registered.mapping.connectionId : base.attempt.scopeId]);
        const pending = canonical(waiter.database).beginCanonicalResourceAttempt(registered.mapping, id, fixture.policy, context.fence)
          .then(value => ({ value, error: undefined }), error => ({ value: undefined, error }));
        await blocked(waiterPid, ownerPid); await delay(2200); await oq('COMMIT');
        const result = await pending;
        expect(result.error).toMatchObject({ code: 'P0001' }); expect(String(result.error)).toMatch(/fence.*(stale|expired)/u);
        expect((await q('SELECT count(*)::int AS count FROM league_roster_resource_attempts WHERE id=$1', [id]))[0].count).toBe(0);
      } finally { await oq('ROLLBACK'); }
    }
    for (const target of ['source', 'head'] as const) {
      const context = await claim(fixture, waiter.database, 3, 2), registered = await register(context);
      const attempt = await canonical(waiter.database).beginCanonicalResourceAttempt(registered.mapping, randomUUID(), fixture.policy, context.fence);
      const delivery = buildFixtureStandingsDelivery(fixture, registered.mapping, attempt, context.fence,
        { captureId: randomUUID(), checkedAt: await clock(waiter.database) });
      const before = await counts(); await oq('BEGIN');
      try {
        await oq(target === 'source' ? 'SELECT id FROM league_source_connections WHERE id=$1 FOR UPDATE'
          : 'SELECT scope_id FROM league_roster_resource_heads WHERE scope_id=$1 FOR UPDATE',
        [target === 'source' ? registered.mapping.connectionId : attempt.scopeId]);
        const pending = rawWrite(delivery, waiter.database).then(value => ({ value, error: undefined }), error => ({ value: undefined, error }));
        await blocked(waiterPid, ownerPid); await delay(2200); await oq('COMMIT');
        const result = await pending;
        expect(result.error).toMatchObject({ code: 'P0001' }); expect(String(result.error)).toMatch(/fence.*(stale|expired)/u);
      } finally { await oq('ROLLBACK'); }
      expect(await counts()).toEqual(before);
    }
    const changedWork = await prepare('alpha-complete', waiter.database), unchanged = await counts();
    await oq('BEGIN');
    try {
      await oq('UPDATE projection_jobs SET payload=$2::jsonb WHERE job_key=$1',
        [changedWork.fence.jobKey, JSON.stringify(fixtureJobPayload(fixtureById('alpha-correction')))]);
      const pending = rawWrite(changedWork.delivery, waiter.database).then(value => ({ value, error: undefined }), error => ({ value: undefined, error }));
      await blocked(waiterPid, ownerPid); await oq('COMMIT');
      const result = await pending;
      expect(result.error).toMatchObject({ code: 'P0001' }); expect(String(result.error)).toMatch(/fixture immutable acquisition mismatch/u);
    } finally { await oq('ROLLBACK'); }
    expect(await counts()).toEqual(unchanged);
    const original = await prepare('beta-complete'), before = await counts();
    expect(await createProjectionStore(runtime.database).failJob(original.fence.jobKey, original.fence.workerId, 'qualification supersession')).toBe(true);
    const nextOwner = randomUUID(), next = await createProjectionStore(runtime.database).acquireJob({ jobKey: original.fence.jobKey,
      jobType: FIXTURE_JOB_TYPE, workerId: nextOwner, scheduledFor: await clock(), leaseSeconds: 20, payload: fixtureJobPayload(original.fixture) });
    expect(next).toMatchObject({ kind: 'acquired', attempt: original.fence.generation + 1 });
    await rejection(() => rawWrite(original.delivery), 'P0001', /fence.*stale/u); expect(await counts()).toEqual(before);
    await createProjectionStore(runtime.database).failJob(original.fence.jobKey, nextOwner, 'qualification supersession complete');

    // New identity registration cannot escape its original deadline by delaying COMMIT.
    const delta = await claim(fixtureById('delta-complete'), runtime.database, 3, 2);
    await q('BEGIN');
    try { await register(delta); await delay(2200); await rejection(() => q('COMMIT'), 'P0001', /fence.*(stale|expired)/u); }
    finally { await q('ROLLBACK'); }
    expect((await q('SELECT count(*)::int AS count FROM leagues WHERE league_key=$1', [delta.fixture.leagueKey]))[0].count).toBe(0);
    expect((await register(await claim(delta.fixture))).mapping.scope.leagueKey).toBe(delta.fixture.leagueKey);

    // A runtime-created preexisting native mapping has no enrollment prerequisite.
    // Only the new membership rows must roll back; the old source must survive.
    const membership = fixtureById('sleeper-membership-complete');
    const existing = await createProjectionStore(runtime.database).registerLeagueSeason({ mode: 'official-data',
      leagueKey: membership.leagueKey, leagueName: membership.leagueName, sleeperLeagueId: membership.sourceLeague.nativeId, season: 2026 });
    if (existing.kind !== 'stored') throw new Error('Runtime membership prerequisite unavailable.');
    const memberCount = () => q(`SELECT (SELECT count(*)::int FROM league_administration_enrollments WHERE league_id=$1) AS enrollments,
      (SELECT count(*)::int FROM league_administration_enrollment_seasons WHERE league_id=$1) AS seasons`, [existing.value.leagueId]);
    expect(await memberCount()).toEqual([{ enrollments: 0, seasons: 0 }]);
    for (const mode of ['changed-work', 'expired-fence'] as const) {
      const context = await claim(membership, runtime.database, mode === 'expired-fence' ? 3 : 25, mode === 'expired-fence' ? 2 : 20);
      await q('BEGIN');
      try {
        const registered = await register(context); expect(registered.leagueSeasonId).toBe(existing.value.leagueSeasonId);
        if (mode === 'expired-fence') await delay(2200);
        else await q("UPDATE projection_jobs SET payload=jsonb_set(payload,'{standingsDigest}',to_jsonb($2::text)) WHERE job_key=$1", [context.fence.jobKey, 'sha256:' + '0'.repeat(64)]);
        await rejection(() => q('COMMIT'), 'P0001', mode === 'expired-fence' ? /fence.*(stale|expired)/u : /fixture|registration/u);
      } finally { await q('ROLLBACK'); }
      expect(await memberCount()).toEqual([{ enrollments: 0, seasons: 0 }]);
      expect((await q('SELECT id FROM league_seasons WHERE id=$1', [existing.value.leagueSeasonId]))[0].id).toBe(existing.value.leagueSeasonId);
    }
    await register(await claim(membership)); expect(await memberCount()).toEqual([{ enrollments: 1, seasons: 1 }]);

    const delayed = await claim(fixture, runtime.database, 3, 2), registered = await register(delayed);
    const attempt = await canonical().beginCanonicalResourceAttempt(registered.mapping, randomUUID(), fixture.policy, delayed.fence);
    const delivery = buildFixtureStandingsDelivery(fixture, registered.mapping, attempt, delayed.fence, { captureId: randomUUID(), checkedAt: await clock() });
    const beforeCommit = await counts(); await q('BEGIN');
    try { await rawWrite(delivery); await delay(2200); await rejection(() => q('COMMIT'), 'P0001', /fence.*(stale|expired)/u); }
    finally { await q('ROLLBACK'); }
    expect(await counts()).toEqual(beforeCommit);
    mutationsRejected.push('observed-source-lock-expiry', 'observed-head-lock-expiry', 'writer-source-lock-expiry', 'writer-head-lock-expiry',
      'observed-job-lock-context-change', 'superseded-original-fence',
      'registration-deferred-expiry', 'membership-deferred-payload', 'membership-deferred-expiry', 'receipt-deferred-expiry');
  });

  test(10, async () => {
    expect(mutationsRejected).toContain('production-fixture-denial');
    const migration = await readFile(new URL('../migrations/069_canonical_native_compatibility.sql', import.meta.url), 'utf8');
    const inventory = migration.slice(migration.indexOf('FOREACH signature IN ARRAY ARRAY['), migration.indexOf("'] LOOP", migration.indexOf('FOREACH signature IN ARRAY ARRAY[')) + 2);
    const signatures = [...inventory.matchAll(/'(public\.[^']+)'/gu)].map(match => match[1]);
    expect(signatures).toHaveLength(55);
    signatures.push('public.canonical_standings_fixture_registry()', 'public.canonical_standings_fixture_job_payload(jsonb)',
      'public.canonical_standings_fixture_job(jsonb)', 'public.canonical_standings_fixture_fact(jsonb,text,text)', 'public.verify_fixture_standings_delivery(jsonb)');
    const publicEntries = new Set(['public.record_league_administration_observation(jsonb)',
      'public.begin_canonical_resource_attempt(jsonb,uuid,jsonb,jsonb,jsonb)', 'public.register_canonical_official_source(jsonb,jsonb,jsonb)']);
    async function assertGrants() {
      const rows = await oq(`SELECT signature,role_name,has_function_privilege(role_name,to_regprocedure(signature),'EXECUTE') AS allowed,
        pg_has_role(role_name,proc.proowner,'MEMBER') AS owner_member,has_schema_privilege(role_name,'public','CREATE') AS schema_create,
        EXISTS(SELECT 1 FROM aclexplode(COALESCE(proc.proacl,acldefault('f',proc.proowner))) acl
          WHERE acl.grantee=0 AND acl.privilege_type='EXECUTE') AS public_execute
        FROM unnest($1::text[]) signature CROSS JOIN unnest(ARRAY['league_one_runtime','league_one_account','league_one_auth']) role_name
        JOIN pg_proc proc ON proc.oid=to_regprocedure(signature)`, [signatures]);
      expect(rows).toHaveLength(180);
      for (const row of rows) expect(row).toMatchObject({ allowed: row.role_name === 'league_one_runtime' && publicEntries.has(String(row.signature)),
        owner_member: false, schema_create: false, public_execute: false });
      const tables = await oq(`SELECT relation_name,role_name,has_table_privilege(role_name,relation_name,'SELECT') AS readable,
        has_table_privilege(role_name,relation_name,'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN') AS writable,
        has_any_column_privilege(role_name,relation_name,'INSERT,UPDATE,REFERENCES') AS column_writable
        FROM unnest(ARRAY['public.league_canonical_resource_contents','public.league_canonical_resource_receipts','public.league_canonical_standings_teams']) relation_name
        CROSS JOIN unnest(ARRAY['league_one_runtime','league_one_account','league_one_auth']) role_name`);
      for (const row of tables) expect(row).toMatchObject({ readable: row.role_name === 'league_one_runtime', writable: false, column_writable: false });
      expect(tables).toHaveLength(9);
      expect((await oq(`SELECT count(*)::int AS count FROM pg_class relation,
        LATERAL aclexplode(COALESCE(relation.relacl,acldefault('r',relation.relowner))) acl
        WHERE relation.oid=ANY(ARRAY['public.league_canonical_resource_contents'::regclass,'public.league_canonical_resource_receipts'::regclass,
          'public.league_canonical_standings_teams'::regclass]) AND acl.grantee=0`))[0].count).toBe(0);
    }
    await assertGrants();
    // These two are role-context authorization probes, not account/auth LOGIN claims.
    for (const role of ['league_one_account', 'league_one_auth'] as const) {
      await oq('BEGIN');
      try { await oq(`SET LOCAL ROLE ${role}`); await oq("SET LOCAL statement_timeout='10s'; SET LOCAL lock_timeout='10s'");
        expect((await oq('SELECT current_user AS role'))[0].role).toBe(role);
        await rejection(() => oq("SELECT public.record_league_administration_observation('{}'::jsonb)"), '42501');
      } finally { await oq('ROLLBACK'); }
    }
    await sqlRejection(runtime.database, "CREATE OR REPLACE FUNCTION public.canonical_fixture_job_context(jsonb,jsonb,jsonb) RETURNS jsonb LANGUAGE sql AS 'SELECT NULL::jsonb'", [], '42501');
    await sqlRejection(runtime.database, 'SELECT public.canonical_standings_fixture_registry()', [], '42501');
    await sqlRejection(runtime.database, "SELECT public.canonical_standings_fixture_job('{}'::jsonb)", [], '42501');
    const restoration = await prepare('gamma-complete');
    await oq('BEGIN');
    try {
      await oq(`REVOKE EXECUTE ON FUNCTION public.begin_canonical_resource_attempt(jsonb,uuid,jsonb,jsonb,jsonb),
        public.register_canonical_official_source(jsonb,jsonb,jsonb),public.record_league_administration_observation(jsonb) FROM league_one_runtime;
        REVOKE SELECT ON public.league_canonical_resource_contents,public.league_canonical_resource_receipts,public.league_canonical_standings_teams FROM league_one_runtime`);
      expect((await oq("SELECT has_function_privilege('league_one_runtime','public.begin_canonical_resource_attempt(jsonb,uuid,jsonb,jsonb,jsonb)','EXECUTE') AS allowed"))[0].allowed).toBe(false);
      await oq(await readFile(new URL('../scripts/provision-runtime-role.sql', import.meta.url), 'utf8'));
      await assertGrants();
      await oq('SET LOCAL ROLE league_one_runtime');
      expect((await oq('SELECT current_user AS role'))[0].role).toBe('league_one_runtime');
      expect(await canonical(owner.database).beginCanonicalResourceAttempt(restoration.mapping, restoration.attempt.id,
        restoration.fixture.policy, restoration.fence)).toEqual(restoration.attempt);
      await oq('SELECT id FROM league_canonical_resource_contents LIMIT 1');
      await oq('SAVEPOINT private_denial');
      await rejection(() => oq('SELECT public.canonical_standings_fixture_registry()'), '42501');
      await oq('ROLLBACK TO SAVEPOINT private_denial');
    } finally { await oq('ROLLBACK'); }
    await assertGrants();
    const positive = await record('gamma-complete'); expect(positive.result.outcome).toBe('accepted');
    expect(await historical(positive)).toMatchObject({ status: 'available' });
    mutationsRejected.push('account-auth-public-denial', 'runtime-policy-replacement', 'provisioner-grants-restored');
  });

  test(11, async () => {
    if (!bridge) throw new Error('Native bridge historical prerequisite missing.');
    expect(await oldEvidence()).toEqual(oldSnapshot);
    expect(await store().readOfficialStandings!(oldMapping)).toEqual(oldRead);
    const installed = await oq("SELECT name FROM app_schema_migrations ORDER BY name");
    expect(installed.map(row => Number(String(row.name).slice(0, 3)))).toEqual(Array.from({ length: 69 }, (_, index) => index + 1));
    const [namespaces] = await q(`SELECT connection.native_namespace,connection.canonical_registration_context,
      revision.native_namespace AS revision_namespace,
      (SELECT bool_and(native_namespace='nfl' AND previous_native_namespace IS NULL) FROM league_source_connection_history WHERE league_season_id=$1) AS history_initialized,
      (SELECT bool_and(source_league_namespace='nfl' AND native_namespace=$2) FROM league_season_teams WHERE league_season_id=$1) AS teams_initialized
      FROM league_source_connections connection JOIN league_source_mapping_revisions revision ON revision.id=connection.current_mapping_revision_id
      WHERE connection.league_season_id=$1`, [oldMapping.leagueSeasonId, JSON.stringify(['nfl', 2026, oldMapping.scope.externalLeagueId])]);
    expect(namespaces).toMatchObject({ native_namespace: 'nfl', canonical_registration_context: null, revision_namespace: 'nfl', history_initialized: true, teams_initialized: true });
    const alias = await claim(fixtureById('alpha-remap-complete')), aliasRegistration = fixtureRegistration(alias.fixture, alias.fence);
    const identityBefore = await q(`SELECT (SELECT count(*) FROM leagues) AS leagues,(SELECT count(*) FROM league_source_connections) AS connections,
      (SELECT count(*) FROM league_source_mapping_revisions) AS revisions,(SELECT count(*) FROM league_administration_enrollments) AS enrollments,
      (SELECT count(*) FROM league_administration_enrollment_seasons) AS seasons`);
    await rejection(() => register(alias), 'P0001', /cannot attach to an existing unrelated league key/u);
    for (const changed of [{ ...aliasRegistration.input, leagueKey: 'standings-unregistered-key' },
      { ...aliasRegistration.input, sourceLeague: fixtureById('gamma-complete').sourceLeague }]) {
      await rejection(() => store().registerCanonicalLeagueSeason!(changed, aliasRegistration.authorization), 'P0001', /fixture|registered|registration/u);
    }
    expect(await q(`SELECT (SELECT count(*) FROM leagues) AS leagues,(SELECT count(*) FROM league_source_connections) AS connections,
      (SELECT count(*) FROM league_source_mapping_revisions) AS revisions,(SELECT count(*) FROM league_administration_enrollments) AS enrollments,
      (SELECT count(*) FROM league_administration_enrollment_seasons) AS seasons`)).toEqual(identityBefore);
    mutationsRejected.push('remap-alias-registration-denial');
    const nativeReceipt = bridge.result.legacyResult?.rosterAcceptance?.receiptId;
    if (!nativeReceipt) throw new Error('Original native receipt missing.');
    const method = canonicalStandingsMethods(runtime.database);
    const canonicalSelection = { kind: 'receipt', representation: 'canonical-v1', receiptId: bridge.result.receiptId } as const;
    const legacySelection = { kind: 'receipt', representation: 'legacy-sleeper-v1', receiptId: nativeReceipt } as const;
    const priorCanonical = await method.readCanonicalOfficialStandings(bridge.mapping, canonicalSelection);
    const priorLegacy = await method.readCanonicalOfficialStandings(bridge.mapping, legacySelection);
    expect(priorCanonical).toMatchObject({ status: 'available' }); expect(priorLegacy).toMatchObject({ status: 'available' });
    const before = await counts();
    await oq('SELECT public.revise_league_source_connection($1,$2,$3,$4,$5)',
      [bridge.mapping.leagueSeasonId, 'sleeper', bridge.mapping.revisionId, '900000000000103', 'canonical qualification historical remap']);
    selection.native = false;
    expect(selectCanonicalStandingsCapture(legacyStandingsMapping(bridge.mapping), { kind: 'core' } as never)).toBeNull();
    expect(await method.readCanonicalOfficialStandings(bridge.mapping, canonicalSelection)).toEqual(priorCanonical);
    expect(await method.readCanonicalOfficialStandings(bridge.mapping, legacySelection)).toEqual(priorLegacy);
    expect((await method.readCanonicalOfficialStandings(bridge.mapping, { kind: 'current', representation: 'canonical-v1' })).status).not.toBe('available');
    expect((await store().readOfficialStandings!(legacyStandingsMapping(bridge.mapping))).status).not.toBe('available');
    const alpha = observations.find(entry => entry.fixture.id === 'alpha-complete')!, alphaHistory = await historical(alpha);
    const [revision] = await oq('SELECT public.revise_canonical_source_connection($1,$2,$3,$4,$5,$6) AS id',
      [alpha.mapping.leagueSeasonId, alpha.mapping.scope.provider, alpha.mapping.revisionId, 'league:remapped',
        alpha.mapping.scope.externalLeagueId, 'canonical qualification namespace-only remap']);
    const [history] = await q(`SELECT revision.native_namespace,revision.external_league_id,revision.generation,
      history.previous_native_namespace FROM league_source_mapping_revisions revision
      JOIN league_source_connection_history history ON history.id=revision.history_id WHERE revision.id=$1`, [revision.id]);
    expect(history).toMatchObject({ native_namespace: 'league:remapped', external_league_id: 'club:ABC-7', previous_native_namespace: 'league:alpha' });
    expect(Number(history.generation)).toBe(alpha.mapping.generation + 1);
    expect(await historical(alpha)).toEqual(alphaHistory); expect((await current(alpha.mapping)).status).not.toBe('available');
    expect(await counts()).toEqual(before); expect(await oldEvidence()).toEqual(oldSnapshot);
    mutationsRejected.push('historical-remap-current-denial');
  });

  test(12, async () => {
    await assertCanonicalStandingsSupportSources(siteRoot);
    expect(requests).toEqual(nativeSources.flatMap(source => [`/v1/user/${source.username}`,
      `/v1/user/${source.manager}/leagues/nfl/2026`, `/v1/league/${source.id}`, `/v1/league/${source.id}`, `/v1/league/${source.id}/rosters`]));
    expect(captures).toHaveLength(6); expect(forbiddenRequests).toBe(0);
    expect(nativeStepDurationsMs).toHaveLength(8); expect(nativeStepDurationsMs.every(value => value >= 0 && value < 20_000)).toBe(true);
    for (const capture of captures) { expect(Object.isFrozen(capture)).toBe(true); assertOriginalPublicCapture(capture, capture.acquisition!); }
    expect(bridge?.mapping.leagueSeasonId).not.toBe(oldMapping.leagueSeasonId);
    expect(await oldEvidence()).toEqual(oldSnapshot); expect(await store().readOfficialStandings!(oldMapping)).toEqual(oldRead);
    expect(selectCanonicalStandingsCapture(oldMapping, { kind: 'core' } as never)).toBeNull();
    // The source manifest binds both-league registry and all protected scorer,
    // projection, publication and provider sources. No UI or live-site claim.
    expect(mutationsRejected).toContain('production-fixture-denial');
  });

  afterAll(async () => {
    selection.native = false; allowedNative = null; fetchSpy?.mockRestore();
    const errors: unknown[] = [];
    for (const session of sessions) { try { await session.database.query('ROLLBACK'); } catch (error) { errors.push(error); } }
    for (const job of jobs) { try { await createProjectionStore(job.database).failJob(job.fence.jobKey, job.fence.workerId, 'Canonical qualification finished'); } catch (error) { errors.push(error); } }
    for (const session of sessions) { try { await session.close(); } catch (error) { errors.push(error); } }
    for (const pending of lateConnections) { try { await pending; } catch (error) { errors.push(error); } }
    if (binding) await writeFile(join(binding.directory, 'canonical-standings-evidence.json'), JSON.stringify({
      kind: 'canonical-standings-qualification-evidence-v1', contextDigest: qualificationDigest(binding.context),
      serverVersion, serverVersionNum, providerSimulation: true, actualProviderRequests: 0,
      mockedRequests: requests, originalSealedCaptures: captures.length, nativeStepDurationsMs, forbiddenRequests, completed,
      boundaryAssertions: mutationsRejected, cleanupComplete: errors.length === 0,
    }, null, 2));
    expect(forbiddenRequests).toBe(0); if (errors.length) throw new AggregateError(errors, 'Canonical fixture cleanup failed.');
  }, CANONICAL_STANDINGS_AFTER_ALL_MS);
});
