import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { DatabaseRow } from '../lib/database';
import type { AdministrationEnvelope, AdministrationFamily, JsonValue } from '../lib/league-administration/contracts';
import { createLeagueAdministrationMethods } from '../lib/league-administration/neon/administration';
import { normalizeAdministrationObservation } from '../lib/league-administration/normalize';
import type { AccountDatabase } from '../lib/accounts/database';
import { accountTeams } from '../lib/accounts/library';
import { ACCOUNT_VIEW_SQL } from '../lib/accounts/neon/source-sql';
import { AccountConflictError, createAccountStore } from '../lib/accounts/store';
import { registerEnrolledIntegrationSeason } from './administration-enrollment-fixture';
import { withAccountActor, type AccountIntegrationQuery } from './neon-integration-harness';

type LeagueFixture = { leagueKey: string; leagueId: string; leagueSeasonId: string; season: number; externalLeagueId: string };
type Fixture = Awaited<ReturnType<typeof createFixture>>;

// Use the existing guarded owner session and real account role. The outer
// rollback keeps canonical route-key fixtures out of other integration cases.
// This adapter tests real store SQL/ACL/RLS, not Neon's HTTP/login transport guard
// (which intentionally requires session_user=league_one_account in production).
async function rollbackFixture(run: (fixture: Fixture) => Promise<void>, prepare?: (query: AccountIntegrationQuery) => Promise<void>) {
  const finished = new Error('rollback-only account adapter fixture');
  try {
    await withAccountActor({}, async query => {
      await query('RESET ROLE');
      await prepare?.(query);
      await run(await createFixture(query));
      throw finished;
    });
  } catch (error) { if (error !== finished) throw error; }
}

async function createFixture(query: AccountIntegrationQuery) {
  const database: AccountDatabase = {
    async transaction(statements, context) {
      await query('SAVEPOINT account_adapter_request');
      try {
        await query('SET LOCAL ROLE league_one_account');
        await query("SELECT set_config('app.actor_user_id',$1,true),set_config('app.request_id',$2,true)",
          [context?.actorUserId ?? '', context?.requestId ?? '']);
        const results: (readonly DatabaseRow[])[] = [];
        for (const statement of statements) results.push(await query(statement.statement, statement.parameters));
        await query('RESET ROLE');
        await query("SELECT set_config('app.actor_user_id','',true),set_config('app.request_id','',true)");
        await query('RELEASE SAVEPOINT account_adapter_request');
        return results;
      } catch (error) {
        await query('ROLLBACK TO SAVEPOINT account_adapter_request');
        await query('RELEASE SAVEPOINT account_adapter_request');
        throw error;
      }
    },
  };
  const store = createAccountStore(database);
  const latest = await query<{ season: number }>(`SELECT coalesce(max(enrollment.season),2149)::integer AS season
    FROM public.league_administration_enrollment_seasons enrollment
    JOIN public.leagues league ON league.id=enrollment.league_id
    WHERE league.league_key IN ('league1','league2','dynasty')`);
  const firstSeason = Math.max(2150, latest[0].season + 1);
  if (firstSeason + 1 > 2200) throw new Error('Isolated fixture has no remaining synthetic annual season.');
  async function league(leagueKey: string, season = firstSeason): Promise<LeagueFixture> {
    const externalLeagueId = `account-adapter-${randomUUID()}`;
    const registered = await registerEnrolledIntegrationSeason(query, {
      leagueKey, season, sleeperLeagueId: externalLeagueId, scoringRules: { pass_td: 4, rec: 0.5 },
    });
    const rows = await query<{ id: string }>('SELECT id FROM public.leagues WHERE league_key=$1', [leagueKey]);
    return { leagueKey, leagueId: rows[0].id, leagueSeasonId: registered.leagueSeasonId, season, externalLeagueId };
  }
  async function record(league: LeagueFixture, family: AdministrationFamily, payload: JsonValue,
    options: { unknownTime?: boolean; time?: string } = {}) {
    const time = options.time ?? new Date(Date.now() - 1_000).toISOString();
    const envelope: AdministrationEnvelope = {
      schemaVersion: 'league-administration-v1', normalizerVersion: 'sleeper-administration-v1', dialect: 'sleeper-nfl-v1',
      scope: { leagueKey: league.leagueKey, provider: 'sleeper', season: league.season, externalLeagueId: league.externalLeagueId },
      family, week: null, completeness: 'complete', payload,
      provenance: { origin: options.unknownTime ? 'cache' : 'network', requestStartedAt: options.unknownTime ? null : time,
        requestCompletedAt: options.unknownTime ? null : time, sourceObservedAt: options.unknownTime ? null : time, checkedAt: time },
    };
    const result = await createLeagueAdministrationMethods({ enabled: true, query })
      .recordObservation(normalizeAdministrationObservation(envelope));
    expect(['changed', 'unchanged']).toContain(result.status);
    return result;
  }
  async function login() { return store.resolve({ issuer: 'https://isolated-adapter.example.test', subject: randomUUID(), displayName: 'Adapter user' }); }
  async function accountId(externalId: string) {
    const rows = await query<{ id: string }>('SELECT id FROM public.league_source_manager_accounts WHERE provider=\'sleeper\' AND external_manager_id=$1', [externalId]);
    return rows[0].id;
  }
  async function link(actor: string, externalId: string) {
    await store.mutate(actor, { kind: 'link', body: { sourceManagerAccountId: await accountId(externalId) } });
  }
  return { query, database, store, league, record, login, accountId, link, firstSeason };
}

describe.sequential('account store adapter against actual accepted-source SQL and restricted grants', () => {
  it('ignores an unrelated league at the maximum supported year when selecting canonical fixture years', async () => rollbackFixture(async f => {
    expect(f.firstSeason).toBeLessThan(2200);
    const league = await f.league('league1');
    const view = await f.store.read(await f.login());
    expect(view.library.leagues.find(value => value.key === 'league1')?.season).toBe(league.season);
  }, async query => {
    await registerEnrolledIntegrationSeason(query, { leagueKey: `unrelated-maximum-${randomUUID()}`, season: 2200,
      sleeperLeagueId: `unrelated-maximum-source-${randomUUID()}`, scoringRules: { pass_td: 4, rec: 0.5 } });
  }));

  it('uses the normalized source display name when a Sleeper user has no username', async () => rollbackFixture(async f => {
    const league = await f.league('league1');
    const manager = `display-only-${randomUUID()}`;
    await f.record(league, 'users', [{ user_id: manager, display_name: 'Source display name' }]);
    const sourceManagerAccountId = await f.accountId(manager);
    const actor = await f.login();
    const view = await f.store.read(actor);
    expect(view.library.availableProviderAccounts.find(account => account.id === sourceManagerAccountId)).toMatchObject({
      provider: 'sleeper', externalId: manager, displayName: 'Source display name', username: null,
    });
    await f.link(actor, manager);
    expect((await f.store.read(actor)).links.find(link => link.sourceManagerAccountId === sourceManagerAccountId)).toMatchObject({
      displayName: 'Source display name', assurance: 'user_asserted',
    });
  }));
  it('executes the full view with owner/co-owner teams across independent leagues and exact source IDs', async () => rollbackFixture(async f => {
    const one = await f.league('league1'); const two = await f.league('league2'); const dynasty = await f.league('dynasty');
    const manager = `manager-${randomUUID()}`; const coOwner = `co-${randomUUID()}`;
    for (const league of [one, two, dynasty]) await f.record(league, 'users', [
      { user_id: manager, username: 'eneerg', display_name: 'Source manager' },
      { user_id: coOwner, username: 'coowner', display_name: 'Co-owner' },
    ]);
    await f.record(one, 'rosters', [{ roster_id: 1, owner_id: manager, co_owners: [coOwner], players: [], starters: [] },
      { roster_id: 2, owner_id: coOwner, co_owners: [], players: [], starters: [] }]);
    await f.record(two, 'rosters', [{ roster_id: 1, owner_id: 'different-source-owner', co_owners: [], players: [], starters: [] }]);
    await f.record(dynasty, 'rosters', [{ roster_id: 1, owner_id: manager, co_owners: [], players: [], starters: [] }]);
    const actor = await f.login(); await f.link(actor, manager); await f.link(actor, coOwner);
    const rows = await f.database.transaction([{ statement: ACCOUNT_VIEW_SQL, parameters: [] }], { actorUserId: actor, requestId: randomUUID() });
    expect(rows[0]).toHaveLength(1);
    const view = await f.store.read(actor);
    const teams = accountTeams(view);
    expect(teams.filter(team => team.leagueKey === 'league1')).toHaveLength(2);
    expect(teams.find(team => team.leagueKey === 'league1' && team.rosterId === '1')?.roles.sort()).toEqual(['co_owner', 'owner']);
    expect(teams.filter(team => team.leagueKey === 'dynasty')).toHaveLength(1);
    expect(teams.filter(team => team.leagueKey === 'league2')).toEqual([]);
    expect(new Set(teams.map(team => team.id)).size).toBe(3);
    expect(teams.every(team => team.assurance === 'user_asserted')).toBe(true);
  }));

  it('excludes retained older ownership and never derives participation from a favorite or display override', async () => rollbackFixture(async f => {
    const league = await f.league('league2'); const manager = `old-${randomUUID()}`;
    await f.record(league, 'users', [{ user_id: manager, username: 'eneerg', display_name: 'Tyler' }]);
    const original = await f.record(league, 'rosters', [{ roster_id: 1, owner_id: manager, players: [], starters: [] }],
      { time: new Date(Date.now() - 120_000).toISOString() });
    await f.record(league, 'rosters', [{ roster_id: 1, owner_id: 'new-source-owner', players: [], starters: [] }]);
    const actor = await f.login(); await f.link(actor, manager);
    const team = await f.query<{ id: string }>('SELECT id FROM public.league_season_teams WHERE league_season_id=$1', [league.leagueSeasonId]);
    await f.store.mutate(actor, { kind: 'save-league', id: league.leagueId,
      body: { favorite: true, sortPosition: 0, preferredSeasonTeamId: team[0].id, revision: null } });
    expect(await f.query(`SELECT id FROM public.league_administration_observations WHERE id=$1`, [original.observationId])).toHaveLength(1);
    const view = await f.store.read(actor);
    expect(view.library.leagues.find(value => value.key === 'league2')?.saved?.favorite).toBe(true);
    expect(accountTeams(view)).toEqual([]);
  }));

  it('keeps unknown cached source unavailable until real network verification supplies accepted-head time', async () => rollbackFixture(async f => {
    const league = await f.league('league1'); const manager = `cached-${randomUUID()}`;
    const payload = [{ roster_id: 1, owner_id: manager, co_owners: [], players: [], starters: [] }];
    const cached = await f.record(league, 'rosters', payload, { unknownTime: true, time: new Date(Date.now() - 120_000).toISOString() });
    await f.record(league, 'users', [{ user_id: manager, username: 'cached', display_name: 'Cached owner' }]);
    const actor = await f.login(); await f.link(actor, manager);
    expect((await f.store.read(actor)).library.leagues.find(value => value.key === 'league1')?.sourceState).toBe('unavailable');
    const observed = new Date(Date.now() - 1_000).toISOString();
    const verified = await f.record(league, 'rosters', payload, { time: observed });
    expect(verified.observationId).toBe(cached.observationId);
    const source = await f.query<{ source_observed_at: unknown }>('SELECT source_observed_at FROM public.league_administration_observations WHERE id=$1', [cached.observationId]);
    expect(source[0].source_observed_at).toBeNull();
    const teams = accountTeams(await f.store.read(actor));
    expect(teams).toHaveLength(1);
    expect(Date.parse(teams[0].observedAt)).toBe(Date.parse(observed));
  }));

  it('preserves actual League Two source owner/co-owner roles despite its separate display attribution rule', async () => rollbackFixture(async f => {
    const league = await f.league('league2');
    const sourceOwner = '95628446075863040'; const sourceCoOwner = '862177751849877504';
    await f.record(league, 'users', [{ user_id: sourceOwner, username: 'eneerg', display_name: 'eneerg' },
      { user_id: sourceCoOwner, username: 'Tyler', display_name: 'Tyler' }]);
    await f.record(league, 'rosters', [{ roster_id: 7, owner_id: sourceOwner, co_owners: [sourceCoOwner], players: [], starters: [] }]);
    const ownerAccount = await f.login(); const coOwnerAccount = await f.login();
    await f.link(ownerAccount, sourceOwner); await f.link(coOwnerAccount, sourceCoOwner);
    const ownerTeams = accountTeams(await f.store.read(ownerAccount));
    const coOwnerTeams = accountTeams(await f.store.read(coOwnerAccount));
    expect(ownerTeams).toHaveLength(1); expect(coOwnerTeams).toHaveLength(1);
    expect(ownerTeams[0].roles).toEqual(['owner']);
    expect(coOwnerTeams[0].roles).toEqual(['co_owner']);
    expect(ownerTeams[0].id).toBe(coOwnerTeams[0].id);
  }));

  it('selects the intended annual source and retains a saved follow through incomplete rollover and retirement', async () => rollbackFixture(async f => {
    const old = await f.league('league1'); const manager = `annual-${randomUUID()}`;
    await f.record(old, 'users', [{ user_id: manager, username: 'annual', display_name: 'Annual owner' }]);
    await f.record(old, 'rosters', [{ roster_id: 1, owner_id: manager, players: [], starters: [] }]);
    const actor = await f.login(); await f.link(actor, manager);
    await f.store.mutate(actor, { kind: 'save-league', id: old.leagueId,
      body: { favorite: true, sortPosition: 2, preferredSeasonTeamId: null, revision: null } });
    const current = await f.league('league1', old.season + 1);
    let view = await f.store.read(actor);
    expect(view.library.leagues.find(value => value.key === 'league1')).toMatchObject({ season: current.season, sourceState: 'unavailable', saved: { favorite: true } });
    expect(accountTeams(view)).toEqual([]);
    await f.record(current, 'rosters', [{ roster_id: 1, owner_id: manager, players: [], starters: [] }]);
    expect(accountTeams(await f.store.read(actor))[0].season).toBe(current.season);
    await f.query('UPDATE public.league_administration_enrollments SET active=false WHERE league_id=$1', [old.leagueId]);
    view = await f.store.read(actor);
    expect(view.library.leagues.find(value => value.key === 'league1')).toMatchObject({ sourceState: 'unavailable', saved: { favorite: true } });
    await f.store.mutate(actor, { kind: 'save-league', id: old.leagueId,
      body: { favorite: false, sortPosition: 3, preferredSeasonTeamId: null, revision: 1 } });
    expect((await f.store.read(actor)).library.leagues.find(value => value.key === 'league1')?.saved?.favorite).toBe(false);
  }));

  it('applies the store mutation revisions and private row scope using the real account role', async () => rollbackFixture(async f => {
    const a = await f.login(); const b = await f.login();
    await f.store.mutate(a, { kind: 'profile', body: { displayName: 'A updated', revision: 1 } });
    await expect(f.store.mutate(a, { kind: 'profile', body: { displayName: 'Stale update', revision: 1 } })).rejects.toBeInstanceOf(AccountConflictError);
    expect((await f.store.read(a)).profile.displayName).toBe('A updated');
    expect((await f.store.read(b)).profile.displayName).toBe('Adapter user');
  }));
});
