import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AdministrationEnvelope } from '../lib/league-administration/contracts';
import { normalizeAdministrationObservation } from '../lib/league-administration/normalize';
import { createLeagueAdministrationMethods } from '../lib/league-administration/neon/administration';
import { registerEnrolledIntegrationSeason } from './administration-enrollment-fixture';
import { accountQuery, createIndependentDatabase, integrationEnvironment, ownerQuery, runtimeQuery,
  withAccountActor, type IndependentDatabase } from './neon-integration-harness';

const issuer = 'https://isolated-auth.example.test';
const rules = { pass_td: 4, rec: 0.5 };
const resolveSql = 'SELECT public.resolve_app_login_identity($1,$2,$3,$4::uuid) AS id';
const privateTables = ['app_users', 'app_login_identities', 'app_provider_account_links', 'app_user_leagues',
  'app_league_groups', 'app_league_group_memberships', 'app_identity_audit_events'];
const actor = (appUserId: string) => ({ actorUserId: appUserId, requestId: randomUUID() });

async function user(subject = randomUUID(), name = 'Isolated account') {
  const result = await accountQuery<{ id: string }>(resolveSql, [issuer, subject, name, randomUUID()]);
  return { id: result[0].id, subject };
}

describe.sequential('private account foundation against the guarded isolated database', () => {
  let connection: IndependentDatabase;
  beforeAll(() => { connection = createIndependentDatabase(); });
  afterAll(async () => { await connection.close(); });

  async function leagueFixture(season = 2150, leagueKey = `account-${randomUUID()}`) {
    const externalLeagueId = `account-source-${randomUUID()}`;
    const registered = await registerEnrolledIntegrationSeason(ownerQuery, {
      leagueKey, season, sleeperLeagueId: externalLeagueId, scoringRules: rules,
    });
    const externalManagerId = `manager-${randomUUID()}`;
    const at = new Date().toISOString();
    const envelope: AdministrationEnvelope = {
      schemaVersion: 'league-administration-v1', normalizerVersion: 'sleeper-administration-v1', dialect: 'sleeper-nfl-v1',
      scope: { leagueKey, provider: 'sleeper', externalLeagueId, season }, family: 'rosters', week: null,
      completeness: 'complete', provenance: { origin: 'network', requestStartedAt: at, requestCompletedAt: at,
        sourceObservedAt: at, checkedAt: at },
      payload: [{ roster_id: 1, owner_id: externalManagerId, co_owners: [], players: [], starters: [] }],
    };
    const observation = await createLeagueAdministrationMethods(connection.database)
      .recordObservation(normalizeAdministrationObservation(envelope));
    expect(observation.status).toBe('changed');
    const result = await ownerQuery<{ league_id: string; team_id: string; manager_id: string }>(`SELECT season.league_id,
      team.id AS team_id,manager.id AS manager_id FROM public.league_seasons season
      JOIN public.league_season_teams team ON team.league_season_id=season.id
      JOIN public.league_source_manager_accounts manager ON manager.external_manager_id=$2
      WHERE season.id=$1`, [registered.leagueSeasonId, externalManagerId]);
    return { ...result[0], ...registered, leagueKey, externalLeagueId, envelope };
  }

  it('resolves concurrent first sign-ins once without merging same display names or different issuers', async () => {
    const subject = randomUUID();
    const [a, b] = await Promise.all([user(subject, 'Shared display'), user(subject, 'Shared display')]);
    expect(a.id).toBe(b.id);
    const other = await user(randomUUID(), 'Shared display');
    const otherIssuer = await accountQuery<{ id: string }>(resolveSql,
      ['https://another-isolated-auth.example.test', subject, 'Shared display', randomUUID()]);
    expect(other.id).not.toBe(a.id);
    expect(otherIssuer[0].id).not.toBe(a.id);
    expect(await ownerQuery(`SELECT count(*)::integer AS count FROM public.app_login_identities WHERE issuer=$1 AND subject=$2`,
      [issuer, subject])).toEqual([{ count: 1 }]);
    expect(await ownerQuery(`SELECT count(*)::integer AS count FROM public.app_users app_user
      WHERE NOT EXISTS(SELECT 1 FROM public.app_login_identities login WHERE login.app_user_id=app_user.id)`))
      .toEqual([{ count: 0 }]);
  });

  it('rolls back new user, login and audit together after a failed first-login transaction', async () => {
    const subject = randomUUID(); const requestId = randomUUID(); const displayName = `rollback-${randomUUID()}`;
    await expect(withAccountActor({}, async query => {
      await query(resolveSql, [issuer, subject, displayName, requestId]);
      await query('SELECT 1/0');
    })).rejects.toThrow();
    expect(await ownerQuery(`SELECT count(*)::integer AS count FROM public.app_login_identities WHERE issuer=$1 AND subject=$2`,
      [issuer, subject])).toEqual([{ count: 0 }]);
    expect(await ownerQuery('SELECT count(*)::integer AS count FROM public.app_users WHERE display_name=$1', [displayName]))
      .toEqual([{ count: 0 }]);
    expect(await ownerQuery('SELECT count(*)::integer AS count FROM public.app_identity_audit_events WHERE request_id=$1', [requestId]))
      .toEqual([{ count: 0 }]);
  });

  it('records first-login authentication provenance and restores the caller transaction context', async () => {
    const requestId = randomUUID();
    const id = await withAccountActor({}, async query => {
      const rows = await query<{ id: string }>(resolveSql, [issuer, randomUUID(), 'New account', requestId]);
      expect(await query(`SELECT public.current_app_actor() AS actor,
        current_setting('app.request_id',true) AS request`)).toEqual([{ actor: null, request: '' }]);
      return rows[0].id;
    });
    expect(await ownerQuery(`SELECT actor_kind,subject_type,subject_user_id,request_id
      FROM public.app_identity_audit_events WHERE request_id=$1 ORDER BY subject_type`, [requestId])).toEqual([
      { actor_kind: 'authentication', subject_type: 'app_login_identities', subject_user_id: id, request_id: requestId },
      { actor_kind: 'authentication', subject_type: 'app_users', subject_user_id: id, request_id: requestId },
    ]);
  });

  it('denies missing, malformed, inactive and other-user contexts, including concurrent requests', async () => {
    const [a, b] = await Promise.all([user(), user()]);
    const [aRows, bRows] = await Promise.all([
      accountQuery('SELECT id FROM public.app_users', [], actor(a.id)),
      accountQuery('SELECT id FROM public.app_users', [], actor(b.id)),
    ]);
    expect(aRows).toEqual([{ id: a.id }]); expect(bRows).toEqual([{ id: b.id }]);
    expect(await accountQuery('SELECT id FROM public.app_users')).toEqual([]);
    expect(await accountQuery('SELECT id FROM public.app_users', [], { actorUserId: 'not-a-uuid' })).toEqual([]);
    expect(await accountQuery('UPDATE public.app_users SET display_name=$1 WHERE id=$2 RETURNING id', ['No', b.id], actor(a.id)))
      .toEqual([]);
    await ownerQuery(`UPDATE public.app_users SET status='disabled' WHERE id=$1
      AND set_config('app.request_id',$2,true) IS NOT NULL`, [a.id, randomUUID()]);
    expect(await accountQuery('SELECT id FROM public.app_users', [], actor(a.id))).toEqual([]);
    await expect(user(a.subject)).rejects.toThrow(/unavailable/u);
  });

  it('prevents ordinary lifecycle, identity, assurance, group and source escalation', async () => {
    const a = await user(); const context = actor(a.id);
    for (const statement of [
      "UPDATE public.app_users SET status='active' WHERE id=$1",
      "UPDATE public.app_login_identities SET subject='reassigned' WHERE app_user_id=$1",
      "INSERT INTO public.app_provider_account_links(app_user_id,source_manager_account_id,assurance) VALUES($1,$1,'user_asserted')",
      "INSERT INTO public.app_league_groups(group_key,name) VALUES('unauthorized','Unauthorized') RETURNING $1::uuid",
      'UPDATE public.league_source_manager_accounts SET external_manager_id=$1::text',
      'DELETE FROM public.league_administration_memberships WHERE manager_id=$1',
      'DELETE FROM public.projection_jobs WHERE lease_owner=$1::text',
      'SELECT public.record_league_administration_observation(jsonb_build_object(\'actor\',$1::text))',
    ]) await expect(accountQuery(statement, [a.id], context)).rejects.toThrow(/permission/u);
    await expect(accountQuery('SELECT payload FROM public.league_administration_contents', [], context)).rejects.toThrow(/permission/u);
    await expect(accountQuery('SELECT * FROM public.app_identity_audit_events', [], context)).rejects.toThrow(/permission/u);
    await expect(accountQuery('SELECT * FROM public.app_schema_migrations', [], context)).rejects.toThrow(/permission/u);
  });

  it('allows duplicate unverified source associations across people, but revocation cannot be undone', async () => {
    const f = await leagueFixture(); const [a, b] = await Promise.all([user(), user()]);
    const insert = `INSERT INTO public.app_provider_account_links(app_user_id,source_manager_account_id)
      VALUES($1,$2) RETURNING id,assurance,origin,revision`;
    const link = await accountQuery<{ id: string }>(insert, [a.id, f.manager_id], actor(a.id));
    expect(link[0]).toMatchObject({ assurance: 'user_asserted', origin: 'self_association', revision: '1' });
    await accountQuery(insert, [b.id, f.manager_id], actor(b.id));
    await expect(accountQuery(insert, [a.id, f.manager_id], actor(a.id))).rejects.toThrow(/unique/u);
    await expect(accountQuery(insert, [b.id, f.manager_id], actor(a.id))).rejects.toThrow(/row-level security/u);
    await accountQuery('UPDATE public.app_provider_account_links SET revoked_at=clock_timestamp() WHERE id=$1', [link[0].id], actor(a.id));
    await expect(accountQuery('UPDATE public.app_provider_account_links SET revoked_at=NULL WHERE id=$1', [link[0].id], actor(a.id)))
      .rejects.toThrow(/reactivated/u);
    await accountQuery(insert, [a.id, f.manager_id], actor(a.id));
    expect(await accountQuery('SELECT id FROM public.app_provider_account_links WHERE id=$1', [link[0].id], actor(b.id))).toEqual([]);
    expect(await ownerQuery('SELECT id FROM public.league_source_manager_accounts WHERE id=$1', [f.manager_id])).toHaveLength(1);
  });

  it('keeps issuer/subject tombstones unavailable after revocation and deleted lifecycle replay', async () => {
    const a = await user(); const b = await user();
    await ownerQuery(`UPDATE public.app_login_identities SET revoked_at=clock_timestamp() WHERE app_user_id=$1
      AND set_config('app.request_id',$2,true) IS NOT NULL`, [a.id, randomUUID()]);
    await expect(user(a.subject)).rejects.toThrow(/unavailable/u);
    await ownerQuery(`UPDATE public.app_users SET status='deleted' WHERE id=$1
      AND set_config('app.request_id',$2,true) IS NOT NULL`, [b.id, randomUUID()]);
    await expect(user(b.subject)).rejects.toThrow(/unavailable/u);
    await expect(ownerQuery(`UPDATE public.app_users SET status='active' WHERE id=$1
      AND set_config('app.request_id',$2,true) IS NOT NULL`, [b.id, randomUUID()])).rejects.toThrow(/immutable/u);
    await expect(ownerQuery(`UPDATE public.app_login_identities SET revoked_at=NULL WHERE app_user_id=$1
      AND set_config('app.request_id',$2,true) IS NOT NULL`, [a.id, randomUUID()])).rejects.toThrow(/reactivated/u);
  });

  it('validates preferred team against exact league, accepted roster and intended year without erasing follows', async () => {
    const a = await user(); const f = await leagueFixture(); const other = await leagueFixture();
    await expect(accountQuery(`INSERT INTO public.app_user_leagues(app_user_id,league_id,preferred_season_team_id)
      VALUES($1,$2,$3)`, [a.id, f.league_id, other.team_id], actor(a.id))).rejects.toThrow(/approved current league roster/u);
    await accountQuery(`INSERT INTO public.app_user_leagues(app_user_id,league_id,preferred_season_team_id)
      VALUES($1,$2,$3)`, [a.id, f.league_id, f.team_id], actor(a.id));
    await ownerQuery(`INSERT INTO public.league_administration_enrollment_seasons(league_id,season,provider,evidence)
      VALUES($1,2151,'sleeper','isolated next-season fixture intentionally incomplete')`, [f.league_id]);
    await accountQuery('UPDATE public.app_user_leagues SET favorite=true WHERE league_id=$1', [f.league_id], actor(a.id));
    expect(await accountQuery('SELECT preferred_season_team_id,favorite FROM public.app_user_leagues WHERE league_id=$1',
      [f.league_id], actor(a.id))).toEqual([{ preferred_season_team_id: f.team_id, favorite: true }]);
    await accountQuery('UPDATE public.app_user_leagues SET preferred_season_team_id=NULL WHERE league_id=$1', [f.league_id], actor(a.id));
    await expect(accountQuery('UPDATE public.app_user_leagues SET preferred_season_team_id=$2 WHERE league_id=$1',
      [f.league_id, f.team_id], actor(a.id))).rejects.toThrow(/approved current league roster/u);
    expect(await accountQuery('SELECT league_id FROM public.app_user_leagues', [], actor(a.id))).toEqual([{ league_id: f.league_id }]);
  });

  it('rejects an old source team after owner remapping even within the same annual league', async () => {
    const a = await user(); const f = await leagueFixture();
    await ownerQuery(`SELECT public.remap_league_source_connection($1,'sleeper',$2,$3,'isolated source correction')`,
      [f.leagueSeasonId, f.externalLeagueId, `replacement-${randomUUID()}`]);
    await expect(accountQuery(`INSERT INTO public.app_user_leagues(app_user_id,league_id,preferred_season_team_id)
      VALUES($1,$2,$3)`, [a.id, f.league_id, f.team_id], actor(a.id))).rejects.toThrow(/approved current league roster/u);
  });

  it('uses case-insensitive platform handles and revision compare-and-swap without changing source identities', async () => {
    const a = await user(); const b = await user(); const handle = `H${randomUUID().replaceAll('-', '').slice(0, 20)}`;
    await accountQuery('UPDATE public.app_users SET platform_handle=$1 WHERE id=$2', [handle, a.id], actor(a.id));
    await expect(accountQuery('UPDATE public.app_users SET platform_handle=$1 WHERE id=$2', [handle.toLowerCase(), b.id], actor(b.id)))
      .rejects.toThrow(/unique/u);
    const revisions = await Promise.all(['First edit', 'Second edit'].map(name => accountQuery(
      'UPDATE public.app_users SET display_name=$1 WHERE id=$2 AND revision=2 RETURNING revision', [name, a.id], actor(a.id))));
    expect(revisions.map(rows => rows.length).sort()).toEqual([0, 1]);
  });

  it('requires request context and atomically appends a minimal uneditable audit event', async () => {
    const a = await user(); const context = actor(a.id); const privateName = `private-${randomUUID()}`;
    await expect(accountQuery('UPDATE public.app_users SET display_name=$1 WHERE id=$2', [privateName, a.id], { actorUserId: a.id }))
      .rejects.toThrow(/request context/u);
    await accountQuery('UPDATE public.app_users SET display_name=$1 WHERE id=$2', [privateName, a.id], context);
    const events = await ownerQuery(`SELECT actor_kind,actor_user_id,subject_id,request_id,metadata
      FROM public.app_identity_audit_events WHERE request_id=$1`, [context.requestId]);
    expect(events).toEqual([{ actor_kind: 'user', actor_user_id: a.id, subject_id: a.id,
      request_id: context.requestId, metadata: { revision: 2 } }]);
    expect(JSON.stringify(events)).not.toContain(privateName);
    await expect(ownerQuery('DELETE FROM public.app_identity_audit_events WHERE request_id=$1', [context.requestId]))
      .rejects.toThrow(/append-only/u);
  });

  it('installs RLS on all new tables and leaves the existing worker unable to use private records/functions', async () => {
    const tables = await ownerQuery(`SELECT relname,relrowsecurity,has_any_column_privilege('league_one_runtime',oid,'SELECT,INSERT,UPDATE') AS worker
      FROM pg_class WHERE relnamespace='public'::regnamespace AND relname=ANY($1::text[])`, [privateTables]);
    expect(tables).toHaveLength(7);
    for (const row of tables) expect(row).toMatchObject({ relrowsecurity: true, worker: false });
    for (const table of privateTables) await expect(runtimeQuery(`SELECT * FROM public.${table}`)).rejects.toThrow(/permission/u);
    await expect(runtimeQuery(resolveSql, [issuer, randomUUID(), 'Worker denied', randomUUID()])).rejects.toThrow(/permission/u);
    await expect(runtimeQuery('SELECT public.current_app_actor()')).rejects.toThrow(/permission/u);
    await expect(runtimeQuery('SET ROLE league_one_account')).rejects.toThrow(/permission/u);
  });

  it('caps one actor at sixty audited writes per minute and atomically rejects a concurrent excess write', async () => {
    const a = await user(); const b = await user();
    await ownerQuery(`INSERT INTO public.app_identity_audit_events(actor_kind,actor_user_id,operation,subject_type,
      subject_id,subject_user_id,request_id,metadata)
      SELECT 'user',$1::uuid,'update','app_users',$1::uuid,$1::uuid,gen_random_uuid(),'{}'::jsonb FROM generate_series(1,59)`, [a.id]);
    const results = await Promise.allSettled(['First bounded edit', 'Second bounded edit'].map(name => accountQuery(
      'UPDATE public.app_users SET display_name=$1 WHERE id=$2 RETURNING display_name,revision', [name, a.id], actor(a.id))));
    const accepted = results.filter(result => result.status === 'fulfilled');
    const rejected = results.filter(result => result.status === 'rejected');
    expect(accepted).toHaveLength(1); expect(rejected).toHaveLength(1);
    expect(rejected[0].reason).toMatchObject({ code: 'P4290' });
    expect(accepted[0].value[0].revision).toBe('2');
    expect(await accountQuery('SELECT display_name,revision FROM public.app_users', [], actor(a.id))).toEqual(accepted[0].value);
    expect(await ownerQuery(`SELECT count(*)::integer AS count FROM public.app_identity_audit_events
      WHERE actor_user_id=$1 AND actor_kind='user'`, [a.id])).toEqual([{ count: 60 }]);
    await accountQuery('UPDATE public.app_users SET display_name=$1 WHERE id=$2', ['Other actor unaffected', b.id], actor(b.id));
    expect((await accountQuery('SELECT revision FROM public.app_users', [], actor(b.id)))[0].revision).toBe('2');
  });

  it('denies user writes under a repeatable-read snapshot that could miss committed rate evidence', async () => {
    const a = await user();
    const owner = createIndependentDatabase(integrationEnvironment().ownerDatabaseUrl);
    try {
      await owner.database.query('BEGIN ISOLATION LEVEL REPEATABLE READ');
      await owner.database.query('SET LOCAL ROLE league_one_account');
      await owner.database.query("SELECT set_config('app.actor_user_id',$1,true),set_config('app.request_id',$2,true)", [a.id, randomUUID()]);
      await expect(owner.database.query('UPDATE public.app_users SET display_name=$1 WHERE id=$2', ['Wrong isolation', a.id]))
        .rejects.toMatchObject({ code: 'P4290' });
    } finally { await owner.database.query('ROLLBACK'); await owner.close(); }
    expect(await accountQuery('SELECT display_name,revision FROM public.app_users', [], actor(a.id)))
      .toEqual([{ display_name: 'Isolated account', revision: '1' }]);
  });

  it('rejects concurrent distinct-row writes with the actor lock before the first audit event commits', async () => {
    const a = await user(); const one = await leagueFixture(); const two = await leagueFixture();
    for (const leagueId of [one.league_id, two.league_id]) await accountQuery(
      'INSERT INTO public.app_user_leagues(app_user_id,league_id) VALUES($1,$2)', [a.id, leagueId], actor(a.id));
    await ownerQuery(`INSERT INTO public.app_identity_audit_events(actor_kind,actor_user_id,operation,subject_type,
      subject_id,subject_user_id,request_id,metadata)
      SELECT 'user',$1::uuid,'update','app_users',$1::uuid,$1::uuid,gen_random_uuid(),'{}'::jsonb FROM generate_series(1,57)`, [a.id]);
    let signalHeld!: () => void;
    let failHeld!: (error: unknown) => void;
    let releaseFirst!: () => void;
    const held = new Promise<void>((resolve, reject) => { signalHeld = resolve; failHeld = reject; });
    const release = new Promise<void>(resolve => { releaseFirst = resolve; });
    const update = 'UPDATE public.app_user_leagues SET favorite=true WHERE league_id=$1 RETURNING favorite,revision';
    const first = withAccountActor(actor(a.id), async query => {
      const result = await query(update, [one.league_id]);
      // Hold the first row's successful write and actor advisory lock open.
      // The second row shares no row lock and cannot see this uncommitted audit.
      signalHeld();
      await release;
      return result;
    }).catch((error: unknown) => { failHeld(error); throw error; });
    const second = (async () => {
      try {
        await held;
        return await accountQuery(update, [two.league_id], actor(a.id));
      } finally { releaseFirst(); }
    })();
    const results = await Promise.allSettled([first, second]);
    expect(results[0]).toMatchObject({ status: 'fulfilled', value: [{ favorite: true, revision: '2' }] });
    expect(results[1]).toMatchObject({ status: 'rejected', reason: { code: 'P4290' } });
    expect(await accountQuery('SELECT favorite,revision FROM public.app_user_leagues WHERE league_id=$1', [one.league_id], actor(a.id)))
      .toEqual([{ favorite: true, revision: '2' }]);
    expect(await accountQuery('SELECT favorite,revision FROM public.app_user_leagues WHERE league_id=$1', [two.league_id], actor(a.id)))
      .toEqual([{ favorite: false, revision: '1' }]);
    expect(await ownerQuery(`SELECT count(*)::integer AS count FROM public.app_identity_audit_events
      WHERE actor_user_id=$1 AND actor_kind='user'`, [a.id])).toEqual([{ count: 60 }]);
  });

  it('rolls back every row and audit event when a multirow mutation crosses the write limit', async () => {
    const a = await user(); const one = await leagueFixture(); const two = await leagueFixture();
    for (const leagueId of [one.league_id, two.league_id]) await accountQuery(
      'INSERT INTO public.app_user_leagues(app_user_id,league_id) VALUES($1,$2)', [a.id, leagueId], actor(a.id));
    await ownerQuery(`INSERT INTO public.app_identity_audit_events(actor_kind,actor_user_id,operation,subject_type,
      subject_id,subject_user_id,request_id,metadata)
      SELECT 'user',$1::uuid,'update','app_users',$1::uuid,$1::uuid,gen_random_uuid(),'{}'::jsonb FROM generate_series(1,57)`, [a.id]);
    await expect(accountQuery('UPDATE public.app_user_leagues SET favorite=true WHERE app_user_id=$1', [a.id], actor(a.id)))
      .rejects.toMatchObject({ code: 'P4290' });
    expect(await accountQuery('SELECT favorite,revision FROM public.app_user_leagues', [], actor(a.id)))
      .toEqual([{ favorite: false, revision: '1' }, { favorite: false, revision: '1' }]);
    expect(await ownerQuery(`SELECT count(*)::integer AS count FROM public.app_identity_audit_events
      WHERE actor_user_id=$1 AND actor_kind='user'`, [a.id])).toEqual([{ count: 59 }]);
  });

  it('bootstraps only the operator-approved two-league group, idempotently and without user accounts', async () => {
    const owner = createIndependentDatabase(integrationEnvironment().ownerDatabaseUrl);
    const seed = await readFile(new URL('../scripts/seed-account-league-group.sql', import.meta.url), 'utf8');
    // Keep this fixture entirely rollback-only; the production script owns its
    // transaction while this guarded test owns the surrounding transaction.
    const body = seed.replace(/^BEGIN;\r?$/mu, '').replace(/^COMMIT;\r?$/mu, '');
    try {
      await owner.database.query('BEGIN');
      const before = await owner.database.query('SELECT count(*)::integer AS count FROM public.app_users');
      for (const key of ['league1', 'league2', 'dynasty']) {
        await registerEnrolledIntegrationSeason(owner.database.query, { leagueKey: key, season: 2160,
          sleeperLeagueId: `account-bootstrap-${key}-${randomUUID()}`, scoringRules: rules });
      }
      await owner.database.query(body);
      await owner.database.query(body);
      const memberships = await owner.database.query(`SELECT league.league_key FROM public.app_league_groups g
        JOIN public.app_league_group_memberships m ON m.group_id=g.id AND m.ended_at IS NULL
        JOIN public.leagues league ON league.id=m.league_id WHERE g.group_key='league-one-two' ORDER BY league.league_key`);
      expect(memberships).toEqual([{ league_key: 'league1' }, { league_key: 'league2' }]);
      expect(await owner.database.query('SELECT count(*)::integer AS count FROM public.app_users')).toEqual(before);
    } finally { await owner.database.query('ROLLBACK'); await owner.close(); }
  });
});
