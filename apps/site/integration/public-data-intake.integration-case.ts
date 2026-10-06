import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createIndependentDatabase, ownerQuery, type IndependentDatabase } from './neon-integration-harness';
import { createProjectionStore } from '../lib/projection-store';
import { createPublicIntakeStore } from '../lib/league-administration/neon/public-intake';
import { createLeagueAdministrationStore } from '../lib/league-administration/store';
import { recordCapturedAdministration } from '../lib/league-administration/runtime';
import { readPublicSleeperIntake } from '../lib/league-administration/public-intake-reader';
import type { PublicIntakeWork } from '../lib/league-administration/public-intake-contracts';

/** AUTHORED, NOT EXECUTED: existing isolated harness and actual restricted LOGIN.
 * This fixture starts with an operator-registered source to avoid changing other
 * integration suites' fleet/capacity. Fresh-fleet capacity/load remains separate. */
describe('public data intake retained source to typed PostgreSQL readback', () => {
  let connection: IndependentDatabase;
  beforeAll(() => { connection = createIndependentDatabase(); });
  afterAll(async () => connection.close());
  it('retains identity/list checkpoints, accepted official core and independent missing directory with no active enrollment', async () => {
    const database = connection.database;
    const jobs = createProjectionStore(database);
    const intake = createPublicIntakeStore(database);
    const administration = createLeagueAdministrationStore(database);
    const id = randomUUID();
    const native = `9${BigInt(`0x${randomUUID().replaceAll('-', '').slice(0, 15)}`)}`;
    const season = 2181;
    const league = { league_id: native, season: String(season), sport: 'nfl', name: 'Synthetic unrelated official league',
      total_rosters: 1, roster_positions: ['QB', 'BN'], settings: { divisions: 3 }, scoring_settings: { rec_yd: 0.1, unsupported_bonus: 2 } };
    const registration = await jobs.registerLeagueSeason({ leagueKey: `sleeper-${native}`, leagueName: league.name,
      sleeperLeagueId: native, season, scoringRules: league.scoring_settings });
    if (registration.kind !== 'stored') throw new Error('Integration persistence disabled.');
    await ownerQuery(`INSERT INTO public.league_administration_enrollments(league_id,provider,active,evidence)
      VALUES($1,'sleeper',false,'public-data-intake-v1')`, [registration.value.leagueId]);
    await intake.submit({ id, username: 'synthetic_manager', seasons: [season] });
    await intake.submit({ id, username: 'synthetic_manager', seasons: [season] });
    await expect(intake.submit({ id, username: 'different_manager', seasons: [season] })).rejects.toThrow('replay mismatch');
    const workerId = randomUUID();
    const claim = await jobs.acquireJob({ jobKey: 'league-administration-public-intake', jobType: 'league-administration-public-intake',
      workerId, scheduledFor: new Date().toISOString(), leaseSeconds: 60, payload: { requestId: id } });
    if (claim.kind !== 'acquired') throw new Error('Public integration job busy.');
    const fence = { jobKey: 'league-administration-public-intake', workerId, generation: claim.attempt,
      deadlineAt: new Date(Date.now() + 55_000).toISOString() };
    const work = async () => {
      const next = await intake.next(id);
      if (typeof next === 'string') throw new Error(`Unexpected fixture disposition ${next}`);
      return next;
    };
    const capture = async <T,>(payload: unknown, value: T) => {
      const [row] = await ownerQuery('SELECT clock_timestamp() AS at');
      const at = new Date(String(row.at)).toISOString();
      return { payload, value, requestStartedAt: at, requestCompletedAt: at };
    };
    const identityWork = await work() as Extract<PublicIntakeWork, { kind: 'identity' }>;
    await intake.recordIdentity(identityWork, await capture({ user_id: '555', username: 'synthetic_manager' },
      { userId: '555', username: 'synthetic_manager', displayName: 'Synthetic Manager', avatarUrl: null }), fence);
    await expect(intake.recordIdentity(identityWork, await capture({ user_id: '555', username: 'synthetic_manager' },
      { userId: '555', username: 'synthetic_manager', displayName: 'Synthetic Manager', avatarUrl: null }), fence)).rejects.toThrow('checkpoint changed');
    expect((await work()).kind).toBe('leagues');
    await intake.recordLeagues(await work() as Extract<PublicIntakeWork, { kind: 'leagues' }>,
      await capture([league], [{ id: native, name: league.name, season: String(season) }]), fence);
    const bootstrap = await capture(league, league);
    await intake.register(await work() as Extract<PublicIntakeWork, { kind: 'bootstrap' | 'core' | 'users' }>,
      { ...bootstrap, family: 'league', week: null, origin: 'network' }, fence);
    const mapping = await administration.readSourceMapping(native);
    if (!mapping) throw new Error('Missing public fixture source mapping.');
    const attempts = await administration.beginRosterCapture(mapping, randomUUID(), randomUUID(), fence);
    const settings = await administration.beginLeagueSettingsAttempt(mapping, randomUUID(), fence);
    const leagueCapture = await capture(league, league);
    const roster = [{ roster_id: 1, owner_id: '555', co_owners: ['556'], players: ['123'], starters: ['123'], reserve: [], taxi: [] }];
    const rosterCapture = await capture(roster, roster);
    const result = await recordCapturedAdministration(mapping.scope,
      [{ ...leagueCapture, family: 'league', week: null, origin: 'network' }, { ...rosterCapture, family: 'rosters', week: null, origin: 'network' }],
      { store: administration, mapping, fence, rosterAttempt: attempts.players, managerAttempt: attempts.managers, leagueSettingsAttempt: settings });
    expect(result.status).toBe('stored');
    expect(result.results.find(entry => entry.family === 'league')?.result.leagueSettingsAcceptance?.status).toBe('accepted');
    expect(result.results.find(entry => entry.family === 'rosters')?.result.rosterAcceptance?.status).toBe('accepted');
    const observations = Object.fromEntries(result.results.map(entry => [entry.family, entry.result.observationId]));
    await intake.completeCore(await work() as Extract<PublicIntakeWork, { kind: 'bootstrap' | 'core' | 'users' }>, mapping, observations, fence);
    expect((await work()).kind).toBe('users');
    const read = await readPublicSleeperIntake(database, administration, id);
    if (read.status === 'missing') throw new Error('Missing public fixture readback.');
    expect(read.leagues[0].resources).toMatchObject({ settings: { status: 'available' }, heldRoster: { status: 'available' },
      teamManagers: { status: 'available' }, directory: { status: 'missing' } });
    expect((await administration.listEnrollmentInventory(season)).entries.some(entry => entry.intended.leagueId === registration.value.leagueId)).toBe(false);
    const [enrollment] = await ownerQuery('SELECT active FROM public.league_administration_enrollments WHERE league_id=$1', [registration.value.leagueId]);
    expect(enrollment.active).toBe(false);
    await expect(database.query('UPDATE public.public_data_intakes SET revision=revision+1 WHERE id=$1', [id])).rejects.toMatchObject({ code: '42501' });
    expect(await intake.admit(await work(), fence)).toBe(true);
    expect(await intake.admit(await work(), fence)).toBe(false);
    await jobs.failJob(fence.jobKey, workerId, 'synthetic interrupted request');
    const retryOwner = randomUUID();
    const retry = await jobs.acquireJob({ jobKey: fence.jobKey, jobType: fence.jobKey, workerId: retryOwner,
      scheduledFor: new Date().toISOString(), leaseSeconds: 30, payload: { requestId: id } });
    if (retry.kind !== 'acquired') throw new Error('Synthetic retry claim unavailable.');
    expect(await intake.admit(await work(), { ...fence, workerId: retryOwner, generation: retry.attempt })).toBe(false);
    await expect(intake.completeCore(await work() as Extract<PublicIntakeWork, { kind: 'bootstrap' | 'core' | 'users' }>, mapping, observations, fence))
      .rejects.toThrow('lease lost');
    await jobs.completeJob(fence.jobKey, retryOwner);
  });
});
