import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { DatabaseClient } from '../lib/database';
import type { JsonObject } from '../lib/league-administration/contracts';
import type { AdministrationWriteFence } from '../lib/league-administration/store-contracts';
import type { RosterAttempt } from '../lib/aggregator/current-roster';
import { projectDraftMetadata } from '../lib/aggregator/draft-metadata';
import { createLeagueAdministrationStore, createPublicIntakeStore } from '../lib/league-administration/store';
import { normalizeAdministrationObservation } from '../lib/league-administration/normalize';
import { PUBLIC_DRAFT_PICKS, PUBLIC_INTAKE_JOB } from '../lib/league-administration/public-intake-contracts';
import { readPublicSleeperIntake } from '../lib/league-administration/public-intake-reader';
import { createProjectionStore } from '../lib/projection-store';
import { getOfficialDraftAdministration } from '../lib/sleeper';
import { exactMatchupClockInstant } from './exact-matchup-clock';
import { createPinnedIntegrationDatabase, type IndependentDatabase } from './neon-integration-harness';
import { readFreshInstallEvidence } from './fresh-install-evidence';
import { readFreshInstallCatalog, assertFreshInstallCatalog, assertFreshInstallPrivileges } from './fresh-install-catalog';

type Query = DatabaseClient['query'];
const roles = ['account', 'auth', 'runtime'] as const;
const numericId = () => '9' + BigInt('0x' + randomUUID().replaceAll('-', '').slice(0, 15));
const identifier = (value: string) => '"' + value.replaceAll('"', '""') + '"';
const typedTables = ['league_draft_metadata_contents', 'league_draft_metadata_entries', 'league_draft_metadata_facts',
  'league_draft_metadata_user_slots', 'league_draft_metadata_slot_rosters'] as const;

/** CP21 AUTHORED / SQL-UNQUALIFIED. A new isolated empty child, its newly
 * generated restricted LOGINs, all 56 reviewed migrations and three provisioners
 * are one installation lineage. The frozen catalog is independent of these
 * behavioral assertions. Account/auth cases preserve installed compatibility;
 * they add no account product. All DATA identities and HTTP bodies are synthetic.
 * Eight cases (90/90/90/120/90/90/90/120s) + two 120s hooks = 17m; setup 8m,
 * reporting/cleanup 3m and margin 2m fit the existing 30m work budget. Lifecycle
 * 40m, CI 50m, 0.25 CU, real original 20s fences and no retries remain unchanged.
 * Neither this source nor an embedded SET ROLE diagnostic proves actual LOGIN. */
describe.sequential('fresh installation and restricted LOGIN enforcement', () => {
  const connections: Partial<Record<'owner' | typeof roles[number], IndependentDatabase>> = {};
  const jobs: AdministrationWriteFence[] = [];
  let evidence: Awaited<ReturnType<typeof readFreshInstallEvidence>>;
  const database = (role: 'owner' | typeof roles[number]) => {
    const connection = connections[role];
    if (!connection) throw new Error('Missing CP21 pinned ' + role + ' connection.');
    return connection.database;
  };
  const owner: Query = (sql, parameters, options) => database('owner').query(sql, parameters, options);
  const runtime: Query = (sql, parameters, options) => database('runtime').query(sql, parameters, options);
  const administration = () => createLeagueAdministrationStore(database('runtime'));
  beforeAll(async () => {
    evidence = await readFreshInstallEvidence();
    for (const role of ['owner', ...roles] as const) connections[role] = await createPinnedIntegrationDatabase(role);
  }, 120_000);
  afterAll(async () => {
    vi.restoreAllMocks();
    const errors: unknown[] = [];
    for (const connection of Object.values(connections)) {
      try { await connection.database.query('ROLLBACK'); } catch (error) { errors.push(error); }
    }
    for (const fence of jobs) {
      try { await finishJob(fence); } catch (error) { errors.push(error); }
    }
    const closed = await Promise.allSettled(Object.values(connections).map(connection => connection.close()));
    errors.push(...closed.filter(result => result.status === 'rejected').map(result => result.reason));
    if (errors.length) throw new AggregateError(errors, 'CP21 fixture cleanup failed.');
  }, 120_000);

  async function transaction<T>(query: Query, body: () => Promise<T>) {
    await query('BEGIN');
    try { const result = await body(); await query('COMMIT'); return result; }
    catch (error) { await query('ROLLBACK'); throw error; }
  }
  // Always restore the savepoint, including an unexpectedly successful forbidden
  // SET ROLE/SESSION AUTHORIZATION, before failing the assertion.
  async function rejected(query: Query, sql: string, parameters: readonly unknown[], code: string,
    detail?: { constraint: string } | { message: RegExp }) {
    await query('SAVEPOINT cp21_expected_rejection');
    let error: unknown;
    try { await query(sql, parameters); } catch (caught) { error = caught; }
    finally { await query('ROLLBACK TO SAVEPOINT cp21_expected_rejection'); await query('RELEASE SAVEPOINT cp21_expected_rejection'); }
    expect(error, sql).toMatchObject({ code });
    if (detail && 'constraint' in detail) expect(error, sql).toMatchObject(detail);
    if (detail && 'message' in detail) expect(String(error), sql).toMatch(detail.message);
  }
  async function boundary(query: Query, role: typeof roles[number], statements: readonly string[]) {
    await transaction(query, async () => {
      for (const statement of statements) await rejected(query, statement, [], '42501');
      for (const schema of ['public', ...(role === 'auth' ? ['website_auth'] : [])])
        await rejected(query, `CREATE TABLE ${schema}.cp21_forbidden_table(id integer)`, [], '42501');
      await rejected(query, 'CREATE SCHEMA cp21_forbidden_schema', [], '42501');
      await rejected(query, 'CREATE ROLE cp21_forbidden_role', [], '42501');
      for (const name of [evidence.initial.installerRole, ...roles.filter(peer => peer !== role).map(peer => 'league_one_' + peer)])
        await rejected(query, 'SET ROLE ' + identifier(name), [], '42501');
      await rejected(query, 'SET SESSION AUTHORIZATION ' + identifier(evidence.initial.installerRole), [], '42501');
    });
  }
  async function fixture() {
    const external = numericId(), leagueKey = 'cp21-' + randomUUID();
    const input = { leagueKey, leagueName: 'CP21 synthetic installation', season: 2026, sleeperLeagueId: external, scoringRules: { rec: 0.5 } };
    const registered = await createProjectionStore(database('runtime')).registerLeagueSeason(input);
    if (registered.kind !== 'stored') throw new Error('CP21 canonical registration unavailable.');
    // The existing mapping reader requires explicit season enrollment. These
    // owner prerequisites do not stand in for ordinary DATA discovery.
    await owner("INSERT INTO league_administration_enrollments(league_id,provider,evidence) VALUES($1,'sleeper','CP21 synthetic prerequisite')", [registered.value.leagueId]);
    await owner("INSERT INTO league_administration_enrollment_seasons(league_id,season,provider,evidence) VALUES($1,2026,'sleeper','CP21 synthetic prerequisite')", [registered.value.leagueId]);
    const mapping = await administration().readSourceMapping(external);
    if (!mapping) throw new Error('CP21 canonical mapping unavailable.');
    return { ...registered.value, leagueKey, external, input, mapping };
  }
  async function fenceFor(jobKey = 'cp21-' + randomUUID()): Promise<AdministrationWriteFence> {
    const workerId = randomUUID(), [clock] = await runtime('SELECT clock_timestamp() AS at');
    const claim = await createProjectionStore(database('runtime')).acquireJob({ jobKey, workerId,
      jobType: 'league-administration', scheduledFor: exactMatchupClockInstant(clock.at), leaseSeconds: 30, payload: {} });
    if (claim.kind !== 'acquired') throw new Error('CP21 could not acquire its isolated job.');
    const [deadline] = await runtime("SELECT clock_timestamp()+interval '20 seconds' AS at");
    const fence = { jobKey, workerId, generation: claim.attempt, deadlineAt: exactMatchupClockInstant(deadline.at) };
    jobs.push(fence); return fence;
  }
  async function finishJob(fence: AdministrationWriteFence) {
    await owner(`UPDATE projection_jobs SET state='failed',lease_owner=NULL,lease_until=NULL,completed_at=clock_timestamp()
      WHERE job_key=$1 AND lease_owner=$2 AND attempt_count=$3`, [fence.jobKey, fence.workerId, fence.generation]);
  }

  it('binds the empty child and three newly created LOGIN identities to the reviewed installation lineage', async () => {
    expect(evidence.initial.profile).toBe('data-fresh-install-v1');
    expect(evidence.installed.initialEvidenceDigest).toMatch(/^[a-f0-9]{64}$/u);
    expect(evidence.initial.empty).toMatchObject({ schemas: 0, relations: 0, functions: 0, types: 0, roles: 0, sessions: 0 });
    const [identity] = await owner('SELECT current_database() AS database,current_user AS owner,session_user AS session');
    expect(identity).toEqual({ database: evidence.initial.databaseName, owner: evidence.initial.installerRole, session: evidence.initial.installerRole });
    for (const role of roles) {
      const name = 'league_one_' + role, initial = evidence.initial.roles.find(row => row.name === name);
      expect(initial).toBeDefined();
      const [actual] = await database(role).query(`SELECT current_user,session_user,oid::text AS oid,rolcanlogin,rolsuper,rolcreatedb,
        rolcreaterole,rolreplication,rolinherit,rolbypassrls,
        EXISTS(SELECT 1 FROM pg_auth_members membership WHERE membership.member=pg_roles.oid) AS has_memberships
        FROM pg_roles WHERE rolname=current_user`);
      expect(actual).toEqual({ current_user: name, session_user: name, oid: initial!.oid, rolcanlogin: true,
        rolsuper: false, rolcreatedb: false, rolcreaterole: false, rolreplication: false, rolinherit: false,
        rolbypassrls: false, has_memberships: false });
    }
    expect(evidence.installed.sources.migrations).toHaveLength(56);
    expect(await owner('SELECT name,checksum FROM public.app_schema_migrations ORDER BY name'))
      .toEqual(evidence.installed.sources.migrations.map(({ name, checksum }) => ({ name, checksum })));
  }, 90_000);

  it('matches every installed public and website_auth object to the frozen catalog manifest', async () => {
    await assertFreshInstallCatalog(await readFreshInstallCatalog(owner, evidence.initial.installerRole));
  }, 90_000);

  it('matches effective role PUBLIC and default privileges without ownership or membership escalation', async () => {
    await assertFreshInstallPrivileges(await readFreshInstallCatalog(owner, evidence.initial.installerRole));
  }, 90_000);

  it('commits one canonical DATA write and stored read through the actual runtime LOGIN while denying direct private history and DDL access', async () => {
    const f = await fixture(), request = { id: randomUUID(), username: 'cp21_' + numericId(), seasons: [2026] };
    await createPublicIntakeStore(database('runtime')).submit(request);
    const reader = await createPinnedIntegrationDatabase('runtime');
    const fetch = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('CP21 stored reader must not fetch.'));
    try {
      expect(await createLeagueAdministrationStore(reader.database).readSourceMapping(f.external)).toEqual(f.mapping);
      expect(await readPublicSleeperIntake(reader.database, createLeagueAdministrationStore(reader.database), request.id))
        .toMatchObject({ status: 'pending', request: { id: request.id, requested_username: request.username,
          seasons: [2026], revision: 0, terminal: false }, lists: [], leagues: [] });
      expect(fetch).not.toHaveBeenCalled();
    } finally { fetch.mockRestore(); await reader.close(); }
    const before = await owner('SELECT to_jsonb(request) AS value FROM public_data_intakes request WHERE id=$1', [request.id]);
    await boundary(runtime, 'runtime', [
      'SELECT * FROM public.app_schema_migrations', 'SELECT * FROM public.app_users', 'SELECT * FROM website_auth."user"',
      ...['public_data_intakes', 'public_data_draft_tasks', 'league_roster_capture_receipts', 'league_draft_metadata_facts'].map(table => `DELETE FROM public.${table} WHERE false`),
      'SELECT public.assert_public_data_owner(NULL::uuid,NULL::jsonb)', 'SELECT public.draft_metadata_typed_value(NULL::uuid)',
      'SELECT public.record_league_administration_observation_v54(NULL::jsonb)',
    ]);
    expect(await owner('SELECT to_jsonb(request) AS value FROM public_data_intakes request WHERE id=$1', [request.id])).toEqual(before);
    expect(await administration().readSourceMapping(f.external)).toEqual(f.mapping);
  }, 120_000);

  it('preserves the installed account boundary through actual account LOGIN writes row isolation and denied DATA auth and DDL access', async () => {
    const query = database('account').query;
    const resolve = async (name: string) => (await query<{ id: string }>('SELECT public.resolve_app_login_identity($1,$2,$3,$4::uuid) AS id',
      ['https://isolated-auth.example.test', randomUUID(), name, randomUUID()]))[0].id;
    const a = await resolve('CP21 account A'), b = await resolve('CP21 account B');
    await transaction(query, async () => {
      await query("SELECT set_config('app.actor_user_id',$1,true),set_config('app.request_id',$2,true)", [a, randomUUID()]);
      expect(await query('SELECT id FROM public.app_users')).toEqual([{ id: a }]);
      expect(await query('UPDATE public.app_users SET display_name=$1 WHERE id=$2 RETURNING id,display_name', ['CP21 updated A', a]))
        .toEqual([{ id: a, display_name: 'CP21 updated A' }]);
      expect(await query('UPDATE public.app_users SET display_name=$1 WHERE id=$2 RETURNING id', ['Forbidden B', b])).toEqual([]);
      expect(await query('SELECT id FROM public.app_users WHERE id=$1', [b])).toEqual([]);
      await rejected(query, "UPDATE public.app_users SET status='disabled' WHERE id=$1", [a], '42501');
    });
    expect(await owner('SELECT id,display_name FROM public.app_users WHERE id=ANY($1::uuid[]) ORDER BY display_name', [[a, b]]))
      .toEqual([{ id: b, display_name: 'CP21 account B' }, { id: a, display_name: 'CP21 updated A' }]);
    const reader = await createPinnedIntegrationDatabase('account');
    try {
      await transaction(reader.database.query, async () => {
        await reader.database.query("SELECT set_config('app.actor_user_id',$1,true),set_config('app.request_id',$2,true)", [a, randomUUID()]);
        expect(await reader.database.query('SELECT id,display_name FROM public.app_users')).toEqual([{ id: a, display_name: 'CP21 updated A' }]);
        expect(await reader.database.query('SELECT id FROM public.app_users WHERE id=$1', [b])).toEqual([]);
      });
    } finally { await reader.close(); }
    await transaction(query, async () => {
      expect(await query('SELECT id FROM public.app_users')).toEqual([]);
      expect(await query("UPDATE public.app_users SET display_name='Missing actor' WHERE id=$1 RETURNING id", [a])).toEqual([]);
      await query("SELECT set_config('app.actor_user_id',$1,true),set_config('app.request_id','',true)", [a]);
      await rejected(query, "UPDATE public.app_users SET display_name='Missing request' WHERE id=$1", [a], 'P0001', { message: /request context/u });
    });
    const before = await owner('SELECT to_jsonb(app_user) AS value FROM public.app_users app_user WHERE id=ANY($1::uuid[]) ORDER BY id', [[a, b]]);
    await boundary(query, 'account', ['SELECT * FROM public.app_schema_migrations', 'SELECT * FROM website_auth."user"',
      'SELECT * FROM public.league_administration_contents', 'DELETE FROM public.projection_jobs WHERE false',
      'SELECT public.record_league_administration_observation(NULL::jsonb)']);
    expect(await owner('SELECT to_jsonb(app_user) AS value FROM public.app_users app_user WHERE id=ANY($1::uuid[]) ORDER BY id', [[a, b]])).toEqual(before);
  }, 90_000);

  it('preserves the installed auth boundary through actual auth LOGIN CRUD foreign keys uniqueness and denied DATA account and DDL access', async () => {
    const query = database('auth').query, a = 'cp21-' + randomUUID(), b = 'cp21-' + randomUUID();
    await transaction(query, async () => {
      for (const id of [a, b]) {
        await query('INSERT INTO website_auth."user"(id,name,email,"emailVerified") VALUES($1,$1,$2,false)', [id, id + '@example.test']);
        await query('INSERT INTO website_auth.session(id,"expiresAt",token,"updatedAt","userId") VALUES($1,now()+interval \'1 hour\',$1,now(),$2)', [id + '-session', id]);
        await query('INSERT INTO website_auth.account(id,"accountId","providerId","userId","updatedAt") VALUES($1,$2,\'credential\',$2,now())', [id + '-account', id]);
      }
      await query('INSERT INTO website_auth.verification(id,identifier,value,"expiresAt") VALUES($1,$1,\'synthetic\',now())', [a]);
      await query('INSERT INTO website_auth."rateLimit"(id,key,count,"lastRequest") VALUES($1,$1,1,1)', [a]);
      await query('UPDATE website_auth."user" SET name=\'CP21 updated\' WHERE id=$1', [a]);
      expect(await query('SELECT name FROM website_auth."user" WHERE id=$1', [a])).toEqual([{ name: 'CP21 updated' }]);
      await query('UPDATE website_auth.session SET "userAgent"=\'CP21 synthetic agent\' WHERE "userId"=$1', [b]);
      expect(await query('SELECT "userAgent" FROM website_auth.session WHERE "userId"=$1', [b])).toEqual([{ userAgent: 'CP21 synthetic agent' }]);
      await query('UPDATE website_auth.account SET scope=\'CP21 synthetic scope\' WHERE "userId"=$1', [b]);
      expect(await query('SELECT scope FROM website_auth.account WHERE "userId"=$1', [b])).toEqual([{ scope: 'CP21 synthetic scope' }]);
      await query('UPDATE website_auth.verification SET value=\'CP21 changed\' WHERE id=$1', [a]);
      expect(await query('SELECT value FROM website_auth.verification WHERE id=$1', [a])).toEqual([{ value: 'CP21 changed' }]);
      await query('UPDATE website_auth."rateLimit" SET count=2,"lastRequest"=2 WHERE id=$1', [a]);
      expect(await query('SELECT count,"lastRequest"::integer FROM website_auth."rateLimit" WHERE id=$1', [a])).toEqual([{ count: 2, lastRequest: 2 }]);
      await rejected(query, 'INSERT INTO website_auth."user"(id,name,email,"emailVerified") SELECT id||\'-duplicate\',name,email,false FROM website_auth."user" WHERE id=$1', [a], '23505', { constraint: 'user_email_key' });
      await rejected(query, 'INSERT INTO website_auth.session(id,"expiresAt",token,"updatedAt","userId") SELECT id||\'-duplicate\',"expiresAt",token,now(),"userId" FROM website_auth.session WHERE "userId"=$1', [a], '23505', { constraint: 'session_token_key' });
      await rejected(query, 'INSERT INTO website_auth."rateLimit"(id,key,count,"lastRequest") SELECT id||\'-duplicate\',key,count,"lastRequest" FROM website_auth."rateLimit" WHERE id=$1', [a], '23505', { constraint: 'rateLimit_key_key' });
      await rejected(query, 'INSERT INTO website_auth.session(id,"expiresAt",token,"updatedAt","userId") VALUES($1,now(),$1,now(),$1)', [randomUUID()], '23503', { constraint: 'session_userId_fkey' });
      await rejected(query, 'INSERT INTO website_auth.account(id,"accountId","providerId","userId","updatedAt") VALUES($1,$1,\'credential\',$1,now())', [randomUUID()], '23503', { constraint: 'account_userId_fkey' });
      await query('DELETE FROM website_auth."user" WHERE id=$1', [a]);
      for (const table of ['session', 'account']) expect(await query(`SELECT "userId" FROM website_auth.${table} WHERE "userId"=ANY($1::text[])`, [[a, b]])).toEqual([{ userId: b }]);
      expect(await query('SELECT id FROM website_auth.verification WHERE id=$1', [a])).toEqual([{ id: a }]);
      expect(await query('SELECT id FROM website_auth."rateLimit" WHERE id=$1', [a])).toEqual([{ id: a }]);
      // Separate rows distinguish direct child DELETE from user FK cascades.
      await query('INSERT INTO website_auth.session(id,"expiresAt",token,"updatedAt","userId") VALUES($1,now(),$1,now(),$2)', [b + '-direct-delete', b]);
      await query('INSERT INTO website_auth.account(id,"accountId","providerId","userId","updatedAt") VALUES($1,$2,\'credential\',$2,now())', [b + '-direct-delete', b]);
      for (const table of ['session', 'account']) {
        expect(await query(`DELETE FROM website_auth.${table} WHERE id=$1 RETURNING id`, [b + '-direct-delete'])).toEqual([{ id: b + '-direct-delete' }]);
        expect(await query(`SELECT id FROM website_auth.${table} WHERE id=$1`, [b + '-direct-delete'])).toEqual([]);
      }
      for (const table of ['verification', '"rateLimit"']) {
        expect(await query(`DELETE FROM website_auth.${table} WHERE id=$1 RETURNING id`, [a])).toEqual([{ id: a }]);
        expect(await query(`SELECT id FROM website_auth.${table} WHERE id=$1`, [a])).toEqual([]);
      }
    });
    const reader = await createPinnedIntegrationDatabase('auth');
    try {
      expect(await reader.database.query('SELECT id,name FROM website_auth."user" WHERE id=ANY($1::text[])', [[a, b]])).toEqual([{ id: b, name: b }]);
      expect(await reader.database.query('SELECT "userAgent" FROM website_auth.session WHERE "userId"=$1', [b])).toEqual([{ userAgent: 'CP21 synthetic agent' }]);
      expect(await reader.database.query('SELECT scope FROM website_auth.account WHERE "userId"=$1', [b])).toEqual([{ scope: 'CP21 synthetic scope' }]);
      for (const table of ['verification', '"rateLimit"']) expect(await reader.database.query(`SELECT id FROM website_auth.${table} WHERE id=$1`, [a])).toEqual([]);
    } finally { await reader.close(); }
    const authSnapshot = () => owner(`SELECT ${['user', 'session', 'account', 'verification', 'rateLimit'].map(table =>
      `(SELECT jsonb_agg(to_jsonb(row) ORDER BY row.id) FROM website_auth.${identifier(table)} row) AS ${identifier(table)}`).join(',')}`);
    const before = await authSnapshot();
    await boundary(query, 'auth', ['SELECT * FROM public.app_schema_migrations', 'SELECT * FROM public.app_users',
      'SELECT * FROM public.leagues', "SELECT public.resolve_app_login_identity('issuer','subject','name',gen_random_uuid())", 'TRUNCATE website_auth.session']);
    expect(await authSnapshot()).toEqual(before);
  }, 90_000);

  it('enforces canonical identity foreign keys uniqueness and task cardinality without cross-scope aliases', async () => {
    const a = await fixture(), b = await fixture();
    expect((await createProjectionStore(database('runtime')).registerLeagueSeason(a.input))).toMatchObject({ kind: 'stored', value: { leagueId: a.leagueId, leagueSeasonId: a.leagueSeasonId } });
    // Direct synthetic identity prerequisites isolate keys from resource capture.
    for (const f of [a, b]) {
      await owner("INSERT INTO league_season_teams(league_season_id,provider,external_league_id,external_roster_id) VALUES($1,'sleeper',$2,'1')", [f.leagueSeasonId, f.external]);
      await owner("INSERT INTO league_season_drafts(league_season_id,provider,external_league_id,external_draft_id) VALUES($1,'sleeper',$2,'cp21_native_draft')", [f.leagueSeasonId, f.external]);
    }
    for (const table of ['league_season_teams', 'league_season_drafts']) expect(await owner(`SELECT count(*)::integer AS count,count(DISTINCT id)::integer AS identities
      FROM ${table} WHERE league_season_id=ANY($1::uuid[])`, [[a.leagueSeasonId, b.leagueSeasonId]])).toEqual([{ count: 2, identities: 2 }]);
    await transaction(owner, async () => {
      await rejected(owner, 'INSERT INTO leagues(league_key,name) VALUES($1,\'Duplicate\')', [a.leagueKey], '23505', { constraint: 'leagues_league_key_key' });
      await rejected(owner, 'INSERT INTO league_seasons(league_id,season,scoring_profile_id) SELECT league_id,season,scoring_profile_id FROM league_seasons WHERE id=$1', [a.leagueSeasonId], '23505', { constraint: 'league_seasons_league_id_season_key' });
      await rejected(owner, 'INSERT INTO league_seasons(league_id,season,scoring_profile_id) SELECT $2::uuid,season,scoring_profile_id FROM league_seasons WHERE id=$1', [a.leagueSeasonId, randomUUID()], '23503', { constraint: 'league_seasons_league_id_fkey' });
      const [spareLeague] = await owner<{ id: string }>("INSERT INTO leagues(league_key,name) VALUES($1,'CP21 unconnected 2026 prerequisite') RETURNING id", ['cp21-' + randomUUID()]);
      const [spare] = await owner<{ id: string }>('INSERT INTO league_seasons(league_id,season,scoring_profile_id) SELECT $2::uuid,2026,scoring_profile_id FROM league_seasons WHERE id=$1 RETURNING id', [b.leagueSeasonId, spareLeague.id]);
      await rejected(owner, "INSERT INTO league_source_connections(league_season_id,provider,external_league_id) VALUES($1,'sleeper',$2)", [spare.id, a.external], '23505', { constraint: 'league_source_connections_provider_external_league_id_key' });
      await rejected(owner, "INSERT INTO league_season_teams(league_season_id,provider,external_league_id,external_roster_id) VALUES($1,'sleeper',$2,'1')", [a.leagueSeasonId, a.external], '23505', { constraint: 'league_season_teams_league_season_id_provider_external_leag_key' });
      await rejected(owner, "INSERT INTO league_season_drafts(league_season_id,provider,external_league_id,external_draft_id) VALUES($1,'sleeper',$2,'cp21_native_draft')", [a.leagueSeasonId, a.external], '23505', { constraint: 'league_season_drafts_league_season_id_provider_external_lea_key' });
      await rejected(owner, "INSERT INTO league_season_teams(league_season_id,provider,external_league_id,external_roster_id) VALUES($1,'unsupported',$2,'1')", [a.leagueSeasonId, a.external], '23514', { constraint: 'league_season_teams_provider_check' });
      await rejected(owner, "INSERT INTO league_season_drafts(league_season_id,provider,external_league_id,external_draft_id) VALUES($1,'sleeper',$2,'invalid draft')", [a.leagueSeasonId, a.external], '23514', { constraint: 'league_season_drafts_external_draft_id_check' });
      await rejected(owner, 'INSERT INTO league_seasons(league_id,season,scoring_profile_id) SELECT league_id,3000,scoring_profile_id FROM league_seasons WHERE id=$1', [a.leagueSeasonId], '23514', { constraint: 'league_seasons_season_check' });
    });
    const requestId = randomUUID(), username = 'cp21_' + numericId();
    await createPublicIntakeStore(database('runtime')).submit({ id: requestId, username, seasons: [2026], exactPeriods: [{ season: 2026, nativeWeek: 1 }], draftPicks: PUBLIC_DRAFT_PICKS });
    // One admitted candidate avoids a feature import/cadence run. These owner
    // rows are declared prerequisites, not provider or ordinary discovery proof.
    const [manager] = await owner<{ id: string }>("INSERT INTO league_source_manager_accounts(provider,external_manager_id) VALUES('sleeper',$1) RETURNING id", [numericId()]);
    await owner('INSERT INTO public_data_identity_observations(intake_id,source_manager_account_id,username,display_name,payload,request_started_at,request_completed_at) VALUES($1,$2,$3,$3,\'{}\',clock_timestamp(),clock_timestamp())', [requestId, manager.id, username]);
    await owner('INSERT INTO public_data_league_lists(intake_id,season,payload,request_started_at,request_completed_at) VALUES($1,2026,$2::jsonb,clock_timestamp(),clock_timestamp())', [requestId, JSON.stringify([{ league_id: a.external, season: '2026', name: 'CP21 synthetic candidate' }])]);
    await owner('INSERT INTO public_data_league_candidates(intake_id,season,external_league_id,name,league_season_id) VALUES($1,2026,$2,\'CP21 synthetic candidate\',$3)', [requestId, a.external, a.leagueSeasonId]);
    const taskSql = 'INSERT INTO public_data_exact_period_tasks(intake_id,ordinal,season,external_league_id,native_week) VALUES($1,$2,2026,$3,$4)';
    await owner(taskSql, [requestId, 1, a.external, 1]);
    const foreignKeys = await owner<{ conname: string }>(`SELECT conname FROM pg_constraint WHERE conrelid='public.public_data_exact_period_tasks'::regclass
      AND confrelid='public.public_data_league_candidates'::regclass AND contype='f'`);
    expect(foreignKeys).toHaveLength(1);
    await transaction(owner, async () => {
      await rejected(owner, taskSql, [requestId, 2, a.external, 1], '23505', { constraint: 'public_period_task_native_scope' });
      await rejected(owner, taskSql, [requestId, 2, numericId(), 1], '23503', { constraint: foreignKeys[0].conname });
      await rejected(owner, taskSql, [requestId, 2, a.external, 2], 'P0001', { message: /outside immutable selection/u });
    });
    const fence = await fenceFor(PUBLIC_INTAKE_JOB);
    try {
      const rootSql = "INSERT INTO public_data_draft_tasks(intake_id,ordinal,season,external_league_id,resource,write_fence) VALUES($1,$2,2026,$3,'catalog',$4::jsonb)";
      await transaction(owner, async () => {
        await owner(rootSql, [requestId, 1, a.external, JSON.stringify(fence)]);
        // NULLS NOT DISTINCT is an installed-catalog assertion. The valid root
        // ordinal also repeats the PK; changing it reaches the preceding trigger.
        await rejected(owner, rootSql, [requestId, 1, a.external, JSON.stringify(fence)], '23505', { constraint: 'public_data_draft_tasks_pkey' });
        await rejected(owner, rootSql, [requestId, 3, a.external, JSON.stringify(fence)], 'P0001', { message: /root task ordinal mismatch/u });
      });
    } finally { await finishJob(fence); }
    expect(await owner('SELECT ordinal,native_week FROM public_data_exact_period_tasks WHERE intake_id=$1', [requestId])).toEqual([{ ordinal: 1, native_week: 1 }]);
    expect(await owner('SELECT ordinal,external_draft_id FROM public_data_draft_tasks WHERE intake_id=$1', [requestId])).toEqual([{ ordinal: 1, external_draft_id: null }]);
  }, 90_000);

  it('preserves receipt cardinality and immutable typed history under duplicate foreign and mutation attempts', async () => {
    const f = await fixture(), other = await fixture(), store = administration();
    if (!store.beginDraftMetadataAttempt || !store.readDraftMetadata) throw new Error('CP21 installed draft methods unavailable.');
    const draftId = '90071992547409939', resource = { kind: 'detail', externalDraftId: draftId } as const;
    const native: JsonObject = { draft_id: draftId, league_id: f.external, season: '2026', sport: 'nfl', type: 'snake', status: 'complete',
      settings: { rounds: 2, teams: 2 }, metadata: { name: 'CP21 synthetic draft' }, draft_order: { '90071992547409940': 1 }, slot_to_roster_id: { '1': 1 } };
    let attempt: RosterAttempt | undefined;
    const fence = await fenceFor();
    let captured: { receiptId: string; contentId: string; foreignAttempt: RosterAttempt; value: Awaited<ReturnType<NonNullable<typeof store.readDraftMetadata>>> };
    try {
      const urls: string[] = [];
      const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(async input => {
        const url = String(input); urls.push(url);
        const body = url === `https://api.sleeper.app/v1/league/${f.external}/drafts` ? [native]
          : url === `https://api.sleeper.app/v1/draft/${draftId}` ? native : undefined;
        if (!body) throw new Error('Unexpected CP21 fixture HTTP endpoint: ' + url);
        return new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } });
      });
      const acquired = await (async () => {
        try { return await getOfficialDraftAdministration(f.external, 2026, { metadataOnly: true, maxRequests: 2,
          signal: AbortSignal.timeout(20_000), beforeDetail: async id => {
            expect(id).toBe(draftId);
            attempt = await store.beginDraftMetadataAttempt!(f.mapping, resource, randomUUID(), fence);
            const [clock] = await runtime('SELECT clock_timestamp() AS at');
            const until = Date.parse(exactMatchupClockInstant(clock.at)) + 20;
            expect(until - Date.now()).toBeLessThanOrEqual(2_000);
            if (Date.now() < until) await delay(until - Date.now());
          } });
        } finally { fetch.mockRestore(); }
      })();
      expect(urls).toEqual([`https://api.sleeper.app/v1/league/${f.external}/drafts`, `https://api.sleeper.app/v1/draft/${draftId}`]);
      expect(acquired.providerRequests).toBe(2);
      const document = acquired.observations.find(row => (row.payload as JsonObject).kind === 'detail');
      if (!document || !attempt) throw new Error('CP21 fixture adapter detail unavailable.');
      const input = normalizeAdministrationObservation({ schemaVersion: 'league-administration-v1', normalizerVersion: 'sleeper-administration-v1',
        dialect: 'sleeper-nfl-v1', scope: f.mapping.scope, family: document.family, week: document.week,
        completeness: document.completeness ?? 'complete', payload: document.payload as JsonObject,
        provenance: { origin: document.origin, requestStartedAt: document.requestStartedAt, requestCompletedAt: document.requestCompletedAt,
          sourceObservedAt: document.sourceObservedAt, checkedAt: new Date().toISOString() } });
      const write = () => store.recordObservation(input, fence, f.mapping,
        undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, { attempt: attempt! });
      const first = await write(), receiptId = first.draftMetadataAcceptance?.receiptId;
      if (!receiptId) throw new Error('CP21 typed receipt unavailable.');
      const replay = await write();
      expect(replay.draftMetadataAcceptance).toMatchObject({ receiptId, reason: 'exact_receipt_replay' });
      const value = await store.readDraftMetadata(f.mapping, { ...resource, receiptId });
      expect(value).toMatchObject({ status: 'available', receiptId, value: projectDraftMetadata(input).value });
      if (value.status !== 'available' && value.status !== 'observed') throw new Error('CP21 typed read unavailable.');
      const foreignAttempt = await store.beginDraftMetadataAttempt(other.mapping, resource, randomUUID(), fence);
      captured = { receiptId, contentId: value.contentId, foreignAttempt, value };
    } finally { await finishJob(fence); }
    async function history() {
      const typed = typedTables.map(table => `(SELECT jsonb_agg(to_jsonb(typed) ORDER BY to_jsonb(typed)::text)
        FROM public.${table} typed WHERE typed.content_id=$1) AS ${table}`);
      return owner(`SELECT
        (SELECT jsonb_agg(to_jsonb(content) ORDER BY content.id) FROM league_administration_contents content WHERE content.league_season_id=$2 AND family='drafts') AS contents,
        (SELECT jsonb_agg(to_jsonb(observation) ORDER BY observation.id) FROM league_administration_observations observation WHERE observation.league_season_id=$2 AND family='drafts') AS observations,
        (SELECT jsonb_agg(to_jsonb(receipt) ORDER BY receipt.id) FROM league_roster_capture_receipts receipt WHERE receipt.content_id=$1) AS receipts,
        (SELECT jsonb_agg(to_jsonb(accepted) ORDER BY accepted.id) FROM league_roster_resource_acceptances accepted WHERE accepted.receipt_id=$3) AS acceptances,
        (SELECT jsonb_agg(to_jsonb(head) ORDER BY head.scope_id) FROM league_roster_resource_heads head JOIN league_roster_resource_scopes scope ON scope.id=head.scope_id WHERE scope.league_season_id=$2) AS heads,
        ${typed.join(',')}`, [captured.contentId, f.leagueSeasonId, captured.receiptId]);
    }
    const before = await history();
    expect(before[0].receipts).toHaveLength(1); expect(before[0].acceptances).toHaveLength(1);
    const cloneReceipt = `INSERT INTO league_roster_capture_receipts(id,attempt_id,content_id,legacy_observation_id,evidence_hash,provenance,
      configuration_content_id,population_evidence,expected_team_count,coverage)
      SELECT gen_random_uuid(),COALESCE($2::uuid,attempt_id),content_id,legacy_observation_id,evidence_hash,provenance,
        configuration_content_id,population_evidence,expected_team_count,coverage FROM league_roster_capture_receipts WHERE id=$1`;
    await transaction(owner, async () => {
      await rejected(owner, cloneReceipt, [captured.receiptId, null], '23505', { constraint: 'league_roster_capture_receipts_attempt_id_key' });
      await rejected(owner, cloneReceipt, [captured.receiptId, captured.foreignAttempt.id], 'P0001', { message: /resource receipt lineage mismatch/u });
      await rejected(owner, `INSERT INTO league_roster_resource_acceptances(scope_id,receipt_id,source_mapping_revision_id,generation)
        SELECT scope_id,receipt_id,source_mapping_revision_id,generation FROM league_roster_resource_acceptances WHERE receipt_id=$1`,
      [captured.receiptId], '23505', { constraint: 'league_roster_resource_acceptances_receipt_id_key' });
      for (const table of ['league_roster_capture_receipts', ...typedTables]) {
        const key = table === 'league_roster_capture_receipts' ? 'id' : 'content_id';
        const id = table === 'league_roster_capture_receipts' ? captured.receiptId : captured.contentId;
        // The detail has no catalog entries; only rows that exist can exercise
        // row triggers. Its remaining typed tables all contain native detail.
        if (table === 'league_draft_metadata_entries') continue;
        await rejected(owner, `UPDATE ${table} SET ${key}=${key} WHERE ${key}=$1`, [id], 'P0001', { message: /history is immutable/u });
        await rejected(owner, `DELETE FROM ${table} WHERE ${key}=$1`, [id], 'P0001', { message: /history is immutable/u });
      }
      await rejected(owner, `INSERT INTO league_draft_metadata_facts(content_id,source_kind,external_draft_id,draft_id,external_league_id,season,
        type_state,type_value,status_state,status_value,settings,metadata,native_fields,extensions)
        SELECT content_id,'catalog',external_draft_id,draft_id,external_league_id,season,type_state,type_value,status_state,status_value,
          settings,metadata,native_fields,extensions FROM league_draft_metadata_facts WHERE content_id=$1 AND source_kind='detail'`,
      [captured.contentId], 'P0001', { message: /draft metadata history cannot gain later facts/u });
    });
    await transaction(runtime, async () => {
      await rejected(runtime, 'DELETE FROM league_roster_capture_receipts WHERE id=$1', [captured.receiptId], '42501');
      await rejected(runtime, 'UPDATE league_draft_metadata_facts SET status_value=status_value WHERE content_id=$1', [captured.contentId], '42501');
    });
    expect(await history()).toEqual(before);
    const fetch = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('CP21 stored reader must not fetch.'));
    try {
      expect(await store.readDraftMetadata(other.mapping, { ...resource, receiptId: captured.receiptId }))
        .toEqual({ status: 'missing', reason: 'draft_metadata_capture_missing' });
      expect(await store.readDraftMetadata(f.mapping, { ...resource, receiptId: captured.receiptId })).toEqual(captured.value);
      expect(fetch).not.toHaveBeenCalled();
    } finally { fetch.mockRestore(); }
  }, 120_000);
});
