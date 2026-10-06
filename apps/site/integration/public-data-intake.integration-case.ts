import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createIndependentDatabase, createPinnedIntegrationDatabase, ownerQuery, type IndependentDatabase } from './neon-integration-harness';
import { createProjectionStore } from '../lib/projection-store';
import { createPublicIntakeStore, createLeagueAdministrationStore } from '../lib/league-administration/store';
import { runPublicIntakeStep, type PublicIntakeDependencies } from '../lib/league-administration/public-intake';
import { readPublicSleeperIntake } from '../lib/league-administration/public-intake-reader';
import { recordCapturedAdministration } from '../lib/league-administration/runtime';
import { PUBLIC_INTAKE_JOB, type PublicIntakeWork } from '../lib/league-administration/public-intake-contracts';
import { capturePublicSleeperCore } from '../lib/sleeper';

/** AUTHORED, NOT EXECUTED. Real restricted LOGIN, coordinator, parsers,
 * normalizer and PostgreSQL writer/readers; only HTTP responses are fixtures.
 * Real 60-second admission remains, so this oracle takes several minutes.
 * A pre-enrolled source avoids changing the other suites' fleet. Fresh-fleet
 * registration/capacity and live provider qualification remain separate gaps. */
describe('public data source to typed PostgreSQL readback and recovery', () => {
  let connection: IndependentDatabase;
  beforeAll(() => { connection = createIndependentDatabase(); });
  afterAll(async () => connection.close());
  it('binds typed receipts, preserves core through interruption, recovers once and permits explicit existing-consumer adoption', async () => {
    const database = connection.database;
    const jobs = createProjectionStore(database);
    const intake = createPublicIntakeStore(database);
    const administration = createLeagueAdministrationStore(database);
    const id = randomUUID();
    const native = `9${BigInt(`0x${randomUUID().replaceAll('-', '').slice(0, 15)}`)}`;
    const season = 2181;
    const league = { league_id: native, season: String(season), sport: 'nfl', name: 'Synthetic unrelated official league',
      total_rosters: 1, roster_positions: ['QB', 'BN'], settings: { divisions: 3 }, scoring_settings: { rec_yd: 0.1, unsupported_bonus: 2 } };
    const roster = [{ roster_id: 1, owner_id: '555', co_owners: ['556'], players: ['123'], starters: ['123'], reserve: [], taxi: [] }];
    const registration = await jobs.registerLeagueSeason({ leagueKey: `sleeper-${native}`, leagueName: league.name,
      sleeperLeagueId: native, season, scoringRules: league.scoring_settings });
    if (registration.kind !== 'stored') throw new Error('Integration persistence disabled.');
    await ownerQuery(`INSERT INTO public.league_administration_enrollments(league_id,provider,active,evidence)
      VALUES($1,'sleeper',false,'public-data-intake-v1')`, [registration.value.leagueId]);
    const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(async input => {
      const url = String(input);
      if (url.endsWith('/user/synthetic_manager')) return new Response(JSON.stringify({ user_id: '555', username: 'synthetic_manager' }));
      if (url.endsWith(`/user/555/leagues/nfl/${season}`)) return new Response(JSON.stringify([league]));
      if (url.endsWith(`/league/${native}`)) return new Response(JSON.stringify(league));
      if (url.endsWith(`/league/${native}/rosters`)) return new Response(JSON.stringify(roster));
      if (url.endsWith(`/league/${native}/users`)) throw new Error('synthetic directory interruption');
      throw new Error('Unexpected fixture provider scope.');
    });
    const dependencies: PublicIntakeDependencies = { intake, jobs, administration };
    const progress = async (selected = dependencies) => {
      const deadline = Date.now() + 150_000;
      while (Date.now() < deadline) {
        const result = await runPublicIntakeStep(id, selected, new AbortController().signal);
        if (!['busy', 'backoff'].includes(result.status)) return result;
        await delay(1_000);
      }
      throw new Error('Real public intake admission did not become due.');
    };
    try {
      expect((await database.query('SELECT session_user AS role'))[0]?.role).toBe('league_one_runtime');
      await intake.submit({ id, username: 'synthetic_manager', seasons: [season] });
      await intake.submit({ id, username: 'synthetic_manager', seasons: [season] });
      await expect(intake.submit({ id, username: 'different_manager', seasons: [season] })).rejects.toThrow('replay mismatch');
      for (const resource of ['identity', 'leagues', 'bootstrap', 'core']) expect(await progress()).toMatchObject({ status: 'progress', resource });
      const read = await readPublicSleeperIntake(database, administration, id);
      if (read.status === 'missing') throw new Error('Missing public fixture readback.');
      expect(read.leagues[0].resources).toMatchObject({ settings: { status: 'available' }, heldRoster: { status: 'available' },
        teamManagers: { status: 'available' }, directory: { status: 'missing' } });
      const [candidate] = await database.query('SELECT * FROM public.public_data_league_candidates WHERE intake_id=$1', [id]);
      for (const key of ['settings_receipt_id', 'players_receipt_id', 'managers_receipt_id']) expect(candidate[key]).toBeTruthy();
      expect((await administration.listEnrollmentInventory(season)).entries.some(entry => entry.intended.leagueId === registration.value.leagueId)).toBe(false);
      await expect(database.query('UPDATE public.public_data_intakes SET revision=revision+1 WHERE id=$1', [id])).rejects.toMatchObject({ code: '42501' });
      expect(await progress({ ...dependencies, intake: { ...intake, fail: async () => { throw new Error('old operation database deadline'); } } }))
        .toMatchObject({ status: 'unavailable', resource: 'users' });
      const [before] = await database.query('SELECT revision,failure_count FROM public.public_data_intakes WHERE id=$1', [id]);
      expect(before.failure_count).toBe(0);
      const workerId = randomUUID();
      const claim = await jobs.acquireJob({ jobKey: PUBLIC_INTAKE_JOB, jobType: PUBLIC_INTAKE_JOB, workerId,
        scheduledFor: new Date().toISOString(), leaseSeconds: 25, payload: { requestId: id } });
      if (claim.kind !== 'acquired') throw new Error('Replacement restricted owner unavailable.');
      const fence = { jobKey: PUBLIC_INTAKE_JOB, workerId, generation: claim.attempt, deadlineAt: new Date(Date.now() + 20_000).toISOString() };
      await intake.recover(id, fence);
      await intake.recover(id, fence);
      const [after] = await database.query('SELECT revision,failure_count FROM public.public_data_intakes WHERE id=$1', [id]);
      expect(Number(after.revision)).toBe(Number(before.revision) + 1);
      expect(after.failure_count).toBe(1);
      expect(await intake.next(id)).toBe('backoff');
      const [retained] = await database.query('SELECT * FROM public.public_data_league_candidates WHERE intake_id=$1', [id]);
      for (const key of ['settings_receipt_id', 'players_receipt_id', 'managers_receipt_id']) expect(retained[key]).toBe(candidate[key]);
      await jobs.completeJob(PUBLIC_INTAKE_JOB, workerId);
      // Explicit legacy preparation adopts DATA purpose; installed025 activation
      // still requires three fresh official heads, including the missing directory.
      await database.query('SELECT public.prepare_account_league_enrollment($1::uuid,$2::integer,$3::text)', [registration.value.leagueId, season, native]);
      expect((await database.query('SELECT active,evidence FROM public.league_administration_enrollments WHERE league_id=$1', [registration.value.leagueId]))[0])
        .toMatchObject({ active: false, evidence: 'account-onboarding-v1' });
      await expect(database.query('SELECT public.activate_account_league_enrollment($1,$2,$3)', [`sleeper-${native}`, season, native]))
        .rejects.toThrow('complete current onboarding evidence');
      expect((await administration.listEnrollmentInventory(season)).entries.some(entry => entry.intended.leagueId === registration.value.leagueId)).toBe(false);
      const mapping = await administration.readSourceMapping(native);
      if (!mapping) throw new Error('Missing adoption source mapping.');
      const at = new Date().toISOString();
      await recordCapturedAdministration(mapping.scope, [
        { family: 'league', payload: league }, { family: 'rosters', payload: roster },
        { family: 'users', payload: [{ user_id: '555', display_name: 'Synthetic Manager' }] },
      ].map(document => ({ ...document, family: document.family as 'league' | 'rosters' | 'users', week: null,
        origin: 'network' as const, requestStartedAt: at, requestCompletedAt: at })), { store: administration });
      await database.query('SELECT public.activate_account_league_enrollment($1,$2,$3)', [`sleeper-${native}`, season, native]);
      expect((await administration.listEnrollmentInventory(season)).entries.some(entry => entry.intended.leagueId === registration.value.leagueId)).toBe(true);
      expect(fetch.mock.calls.filter(([url]) => String(url).includes('/user/'))).toHaveLength(2);
    } finally { fetch.mockRestore(); }
  }, 750_000);

  it('admits generation one after normal completed-job retention while preserving older dispatch history', async () => {
    const database = connection.database;
    const jobs = createProjectionStore(database);
    const intake = createPublicIntakeStore(database);
    // Age only this suite's completed synthetic owner. Invoke the maintained
    // retention API at its ordinary 48-hour cutoff, not direct job deletion.
    await ownerQuery("UPDATE public.projection_jobs SET updated_at=clock_timestamp()-interval '49 hours' WHERE job_key=$1 AND state='completed'", [PUBLIC_INTAKE_JOB]);
    await jobs.pruneHistory({ before: new Date(Date.now() - 48 * 60 * 60_000).toISOString() });
    expect(await database.query('SELECT job_key FROM public.projection_jobs WHERE job_key=$1', [PUBLIC_INTAKE_JOB])).toHaveLength(0);
    expect((await database.query('SELECT worker_id FROM public.public_data_dispatches')).length).toBeGreaterThan(0);
    const id = randomUUID();
    await intake.submit({ id, username: 'pruning_fixture', seasons: [2183] });
    // Wait for existing immutable admissions without weakening their interval.
    const [due] = await database.query("SELECT greatest(0,extract(epoch FROM max(admitted_at)+interval '61 seconds'-clock_timestamp())) AS seconds FROM public.public_data_dispatches");
    await delay(Number(due.seconds) * 1_000);
    const workerId = randomUUID();
    const claim = await jobs.acquireJob({ jobKey: PUBLIC_INTAKE_JOB, jobType: PUBLIC_INTAKE_JOB, workerId,
      scheduledFor: new Date().toISOString(), leaseSeconds: 25, payload: { requestId: id } });
    expect(claim).toMatchObject({ kind: 'acquired', attempt: 1 });
    if (claim.kind !== 'acquired') throw new Error('Missing fresh job lifecycle.');
    const fence = { jobKey: PUBLIC_INTAKE_JOB, workerId, generation: claim.attempt, deadlineAt: new Date(Date.now() + 20_000).toISOString() };
    await intake.recover(id, fence);
    const work = await intake.next(id);
    if (typeof work === 'string') throw new Error('Missing pruning fixture work.');
    expect(await intake.admit(work, fence)).toBe(true);
    expect(await intake.admit(work, fence)).toBe(false);
    await intake.fail(work, fence);
    await jobs.completeJob(PUBLIC_INTAKE_JOB, workerId);
    expect(await database.query('SELECT worker_id FROM public.public_data_dispatches WHERE worker_id=$1 AND generation=1', [workerId])).toHaveLength(1);
  }, 90_000);

  it('rejects a restricted bootstrap after an advisory wait expires without leaving identity or reservation', async () => {
    // Synthetic retained discovery isolates this lock oracle; the protected
    // mutation uses the actual runtime LOGIN, never an owner SET ROLE shortcut.
    const id = randomUUID();
    const native = `8${BigInt(`0x${randomUUID().replaceAll('-', '').slice(0, 15)}`)}`;
    const season = 2182;
    await ownerQuery("INSERT INTO public.public_data_intakes(id,username,seasons) VALUES($1,'lock_fixture',ARRAY[$2]::integer[])", [id, season]);
    const [manager] = await ownerQuery("INSERT INTO public.league_source_manager_accounts(provider,external_manager_id) VALUES('sleeper',$1) RETURNING id", [native]);
    await ownerQuery(`INSERT INTO public.public_data_identity_observations(intake_id,source_manager_account_id,username,display_name,payload,request_started_at,request_completed_at)
      VALUES($1,$2,'lock_fixture','Fixture','{}',clock_timestamp(),clock_timestamp())`, [id, manager.id]);
    await ownerQuery("INSERT INTO public.public_data_league_lists(intake_id,season,payload,request_started_at,request_completed_at) VALUES($1,$2,'[]',clock_timestamp(),clock_timestamp())", [id, season]);
    await ownerQuery("INSERT INTO public.public_data_league_candidates(intake_id,season,external_league_id,name) VALUES($1,$2,$3,'Lock fixture')", [id, season, native]);
    const blocker = await createPinnedIntegrationDatabase('owner');
    const runtime = await createPinnedIntegrationDatabase('runtime');
    try {
      const jobs = createProjectionStore(runtime.database);
      const intake = createPublicIntakeStore(runtime.database);
      const workerId = randomUUID();
      const claim = await jobs.acquireJob({ jobKey: PUBLIC_INTAKE_JOB, jobType: PUBLIC_INTAKE_JOB, workerId,
        scheduledFor: new Date(Date.now() + 1_000).toISOString(), leaseSeconds: 25, payload: { requestId: id } });
      if (claim.kind !== 'acquired') throw new Error('Lock fixture owner unavailable.');
      const fence = { jobKey: PUBLIC_INTAKE_JOB, workerId, generation: claim.attempt, deadlineAt: new Date(Date.now() + 1_000).toISOString() };
      const work = await intake.next(id) as Extract<PublicIntakeWork, { kind: 'bootstrap' | 'core' | 'users' }>;
      await blocker.database.query('BEGIN');
      await blocker.database.query("SELECT pg_advisory_xact_lock(hashtextextended('account-league-enrollment',0))");
      const at = new Date().toISOString();
      const rejected = expect(intake.register(work, { family: 'league', week: null, origin: 'network', requestStartedAt: at, requestCompletedAt: at,
        payload: { league_id: native, season: String(season), sport: 'nfl', name: 'Lock fixture', total_rosters: 1,
          settings: {}, scoring_settings: { rec: 1 }, roster_positions: ['QB'] } }, fence)).rejects.toThrow('lease lost');
      await delay(1_200);
      await blocker.database.query('ROLLBACK');
      await rejected;
      expect(await runtime.database.query('SELECT id FROM public.leagues WHERE league_key=$1', [`sleeper-${native}`])).toHaveLength(0);
      expect(await runtime.database.query('SELECT external_league_id FROM public.public_data_collection_reservations WHERE external_league_id=$1', [native])).toHaveLength(0);
      await jobs.failJob(PUBLIC_INTAKE_JOB, workerId, 'expected expired registration fence');
    } finally { await blocker.close(); await runtime.close(); }
  });

  it('rolls back canonical registration and its reservation when an identity-row wait outlives the postcondition fence', async () => {
    // This test needs one real slot in the isolated fleet. Saturation is an
    // explicit fixture failure, never a skip, owner bypass or capacity rewrite.
    const [capacity] = await connection.database.query(`SELECT
      (SELECT count(*) FROM public.league_administration_enrollments)
      +(SELECT count(*) FROM public.public_data_collection_reservations reservation WHERE NOT EXISTS(
        SELECT 1 FROM public.league_source_connections source JOIN public.league_seasons season ON season.id=source.league_season_id
        JOIN public.league_administration_enrollments enrollment ON enrollment.league_id=season.league_id
        WHERE source.provider='sleeper' AND source.external_league_id=reservation.external_league_id)) AS used`);
    expect(Number(capacity.used), 'Identity-lock oracle requires one available isolated collection slot.').toBeLessThan(16);
    const id = randomUUID();
    const native = `7${BigInt(`0x${randomUUID().replaceAll('-', '').slice(0, 15)}`)}`;
    const season = 2184;
    const leagueKey = `sleeper-${native}`;
    const league = { league_id: native, season: String(season), sport: 'nfl', name: 'Identity lock fixture',
      total_rosters: 1, settings: {}, scoring_settings: { rec: 1 }, roster_positions: ['QB'] };
    const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(async input => {
      const url = String(input);
      if (url.endsWith('/user/identity_lock_fixture')) return new Response(JSON.stringify({ user_id: native, username: 'identity_lock_fixture' }));
      if (url.endsWith(`/user/${native}/leagues/nfl/${season}`)) return new Response(JSON.stringify([league]));
      if (url.endsWith(`/league/${native}`)) return new Response(JSON.stringify(league));
      throw new Error('Unexpected identity-lock fixture source scope.');
    });
    const blocker = await createPinnedIntegrationDatabase('owner');
    const runtime = await createPinnedIntegrationDatabase('runtime');
    const database = runtime.database;
    const jobs = createProjectionStore(database);
    const intake = createPublicIntakeStore(database);
    const administration = createLeagueAdministrationStore(database);
    const workerId = randomUUID();
    let blockerOpen = false;
    let registrationDeadline = 0;
    let pending: Promise<unknown> | undefined;
    try {
      await database.query("SET statement_timeout='15s'");
      const [runtimeSession] = await database.query('SELECT session_user AS role,pg_backend_pid() AS pid');
      expect(runtimeSession.role).toBe('league_one_runtime');
      const [blockerSession] = await blocker.database.query('SELECT pg_backend_pid() AS pid');
      await intake.submit({ id, username: 'identity_lock_fixture', seasons: [season] });
      // Retain discovery through the maintained worker and parsers. Admissions
      // and outcomes are genuine; this fixture inserts neither directly.
      for (const resource of ['identity', 'leagues']) {
        const until = Date.now() + 150_000;
        let completed = false;
        while (Date.now() < until) {
          const result = await runPublicIntakeStep(id, { intake, jobs, administration }, new AbortController().signal);
          if (['busy', 'backoff'].includes(result.status)) { await delay(1_000); continue; }
          expect(result).toMatchObject({ status: 'progress', resource });
          completed = true;
          break;
        }
        expect(completed, `Discovery ${resource} did not become due.`).toBe(true);
      }
      const [due] = await database.query("SELECT greatest(0,extract(epoch FROM max(admitted_at)+interval '61 seconds'-clock_timestamp())) AS seconds FROM public.public_data_dispatches");
      await delay(Number(due.seconds) * 1_000);
      const claim = await jobs.acquireJob({ jobKey: PUBLIC_INTAKE_JOB, jobType: PUBLIC_INTAKE_JOB, workerId,
        scheduledFor: new Date().toISOString(), leaseSeconds: 25, payload: { requestId: id } });
      if (claim.kind !== 'acquired') throw new Error('Identity-lock restricted owner unavailable.');
      const work = await intake.next(id);
      if (typeof work === 'string' || work.kind !== 'bootstrap') throw new Error('Missing retained bootstrap work.');
      const fence = { jobKey: PUBLIC_INTAKE_JOB, workerId, generation: claim.attempt, deadlineAt: new Date(Date.now() + 8_000).toISOString() };
      registrationDeadline = Date.parse(fence.deadlineAt);
      expect(await intake.admit(work, fence)).toBe(true);
      const capture = await capturePublicSleeperCore(native, 'league', new AbortController().signal);
      await blocker.database.query('BEGIN');
      blockerOpen = true;
      // No advisory lock here. The uncommitted unique league key makes the
      // canonical INSERT/ON CONFLICT wait AFTER the intake guard has succeeded.
      await blocker.database.query('INSERT INTO public.leagues(league_key,name) VALUES($1,$2)', [leagueKey, 'Uncommitted blocker']);
      pending = intake.register(work, capture, fence).then(() => ({ ok: true }), error => ({ ok: false, error }));
      let observedIdentityWait = false;
      const observeUntil = Date.now() + 5_000;
      while (Date.now() < observeUntil) {
        const [state] = await ownerQuery('SELECT $2::integer=ANY(pg_blocking_pids($1::integer)) AS blocked',
          [runtimeSession.pid, blockerSession.pid]);
        if (state.blocked === true) { observedIdentityWait = true; break; }
        await delay(25);
      }
      expect(observedIdentityWait, 'Runtime must reach the actual canonical identity lock before expiry.').toBe(true);
      const [expiry] = await ownerQuery('SELECT greatest(0,extract(epoch FROM $1::timestamptz-clock_timestamp())) AS seconds', [fence.deadlineAt]);
      await delay(Number(expiry.seconds) * 1_000 + 100);
      await blocker.database.query('ROLLBACK');
      blockerOpen = false;
      const outcome = await pending as { ok: boolean; error?: Error };
      expect(outcome.ok).toBe(false);
      expect(outcome.error?.message).toContain('lease lost');
      // The identity statement ran after the blocker rolled back, but the final
      // assertion rejected its transaction. Neither identity nor slot commits.
      expect(await database.query('SELECT id FROM public.leagues WHERE league_key=$1', [leagueKey])).toHaveLength(0);
      expect(await database.query('SELECT id FROM public.league_source_connections WHERE provider=$1 AND external_league_id=$2', ['sleeper', native])).toHaveLength(0);
      expect(await database.query('SELECT external_league_id FROM public.public_data_collection_reservations WHERE external_league_id=$1', [native])).toHaveLength(0);
      expect(await intake.next(id)).toEqual(work);
      expect(await database.query('SELECT worker_id FROM public.public_data_dispatches WHERE worker_id=$1 AND generation=$2', [workerId, claim.attempt])).toHaveLength(1);
      expect(await database.query('SELECT worker_id FROM public.public_data_dispatch_outcomes WHERE worker_id=$1 AND generation=$2', [workerId, claim.attempt])).toHaveLength(0);
    } finally {
      if (blockerOpen) {
        // An earlier assertion failure must not accidentally unblock a live
        // mutation and commit fixture state while unwinding the oracle.
        await delay(Math.max(0, registrationDeadline - Date.now()) + 100);
        await blocker.database.query('ROLLBACK');
      }
      await pending;
      await jobs.failJob(PUBLIC_INTAKE_JOB, workerId, 'expected expired identity registration postcondition');
      fetch.mockRestore();
      await blocker.close();
      await runtime.close();
    }
  }, 390_000);
});
