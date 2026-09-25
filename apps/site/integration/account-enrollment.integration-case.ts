import { randomInt } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { createProjectionStore } from '../lib/projection-store';
import { createAccountEnrollmentMethods } from '../lib/league-administration/neon/account-enrollment';
import { createLeagueAdministrationMethods } from '../lib/league-administration/neon/administration';
import { readEnrollmentInventory } from '../lib/league-administration/neon/enrollment';
import { normalizeAdministrationObservation } from '../lib/league-administration/normalize';
import type { AdministrationFamily, JsonValue } from '../lib/league-administration/contracts';
import { withAccountActor, type AccountIntegrationQuery } from './neon-integration-harness';

// The guarded harness pins the isolated owner connection. Every fixture rolls
// back, including its temporary clearing of the synthetic suite's enrollment fleet.
async function fixture(run: (query: AccountIntegrationQuery) => Promise<void>) {
  const rollback = new Error('rollback-only onboarding fixture');
  try {
    await withAccountActor({}, async query => {
      await query('RESET ROLE');
      await query('DELETE FROM public.league_administration_enrollments');
      await query('SET LOCAL ROLE league_one_runtime');
      await run(query);
      throw rollback;
    });
  } catch (error) { if (error !== rollback) throw error; }
}
async function rejected(query: AccountIntegrationQuery, run: () => Promise<unknown>, pattern: RegExp) {
  await query('SAVEPOINT rejected_onboarding');
  await expect(run()).rejects.toThrow(pattern);
  await query('ROLLBACK TO SAVEPOINT rejected_onboarding');
  await query('RELEASE SAVEPOINT rejected_onboarding');
}
async function register(query: AccountIntegrationQuery) {
  const external = `9${Date.now()}${randomInt(100000, 999999)}`;
  const key = `sleeper-${external}`;
  const registration = await createProjectionStore({ enabled: true, query }).registerLeagueSeason({
    leagueKey: key, leagueName: 'Isolated onboarding', season: 2150, sleeperLeagueId: external, scoringRules: { pass_td: 4 },
  });
  if (registration.kind !== 'stored') throw new Error('Fixture registration unavailable.');
  return { key, external, id: registration.value.leagueId };
}

describe.sequential('account enrollment admission in the isolated Neon database', () => {
  it('keeps preparation out of worker inventories until all three sources are accepted', async () => fixture(async query => {
    const league = await register(query);
    const enrollment = createAccountEnrollmentMethods({ enabled: true, query });
    await enrollment.prepare(league.id, 2150, league.external);
    expect(await query('SELECT active FROM public.league_administration_enrollments WHERE league_id=$1', [league.id]))
      .toEqual([{ active: false }]);
    expect(await readEnrollmentInventory({ enabled: true, query }, 2150, { leagueKey: league.key })).toEqual({ entries: [] });
    await rejected(query, () => enrollment.activate(league.key, 2150, league.external), /complete current onboarding evidence/u);
    const now = new Date(Date.now() - 1000).toISOString();
    const sources: [AdministrationFamily, JsonValue][] = [
      ['league', { league_id: league.external, name: 'Isolated onboarding', season: '2150', sport: 'nfl', total_rosters: 1,
        roster_positions: ['QB', 'BN'], scoring_settings: { pass_td: 4 }, settings: { playoff_week_start: 15 } }],
      ['rosters', [{ roster_id: 1, owner_id: '123', co_owners: null, players: [], starters: [], settings: {} }]],
      ['users', [{ user_id: '123', display_name: 'Fixture manager' }]],
    ];
    for (const [family, payload] of sources) {
      const result = await createLeagueAdministrationMethods({ enabled: true, query }).recordObservation(normalizeAdministrationObservation({
        schemaVersion: 'league-administration-v1', normalizerVersion: 'sleeper-administration-v1', dialect: 'sleeper-nfl-v1',
        scope: { leagueKey: league.key, provider: 'sleeper', externalLeagueId: league.external, season: 2150 },
        family, week: null, completeness: 'complete', payload,
        provenance: { origin: 'network', requestStartedAt: now, requestCompletedAt: now, checkedAt: now, sourceObservedAt: now },
      }));
      expect(result.status).toBe('changed');
    }
    await enrollment.activate(league.key, 2150, league.external);
    await enrollment.prepare(league.id, 2150, league.external);
    await enrollment.activate(league.key, 2150, league.external);
    expect(await query('SELECT active FROM public.league_administration_enrollments WHERE league_id=$1', [league.id]))
      .toEqual([{ active: true }]);
  }));

  it('counts inactive reservations toward the bounded fleet and preserves retries', async () => fixture(async query => {
    const enrollment = createAccountEnrollmentMethods({ enabled: true, query });
    const leagues: Awaited<ReturnType<typeof register>>[] = [];
    for (let index = 0; index < 17; index++) leagues.push(await register(query));
    for (const league of leagues.slice(0, 16)) await enrollment.prepare(league.id, 2150, league.external);
    await enrollment.prepare(leagues[0].id, 2150, leagues[0].external);
    await rejected(query, () => enrollment.prepare(leagues[16].id, 2150, leagues[16].external), /capacity reached/u);
    expect(await query('SELECT count(*)::integer AS count FROM public.league_administration_enrollments')).toEqual([{ count: 16 }]);
  }));

  it('rejects source mismatch and grants neither enrollment-table writes nor account-role admission', async () => fixture(async query => {
    const league = await register(query);
    const enrollment = createAccountEnrollmentMethods({ enabled: true, query });
    await rejected(query, () => enrollment.prepare(league.id, 2150, '123'), /registration mismatch/u);
    await rejected(query, () => query("INSERT INTO public.league_administration_enrollments(league_id,provider,evidence) VALUES($1,'sleeper','forged')", [league.id]), /permission denied/u);
    await query('RESET ROLE');
    await query('SET LOCAL ROLE league_one_account');
    await rejected(query, () => enrollment.prepare(league.id, 2150, league.external), /permission denied/u);
    await rejected(query, () => enrollment.activate(league.key, 2150, league.external), /permission denied/u);
  }));
});
