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
    await ownerQuery(`INSERT INTO public.league_administration_enrollment_seasons(league_id,season,provider,evidence)
      VALUES($1,$2,'sleeper','public-data-intake-v1')`, [registration.value.leagueId, season]);
    let directoryOutage = false;
    const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(async input => {
      const url = String(input);
      if (url.endsWith('/user/synthetic_manager')) return new Response(JSON.stringify({ user_id: '555', username: 'synthetic_manager' }));
      if (url.endsWith(`/user/555/leagues/nfl/${season}`)) return new Response(JSON.stringify([league]));
      if (url.endsWith(`/league/${native}`)) return new Response(JSON.stringify(league));
      if (url.endsWith(`/league/${native}/rosters`)) return new Response(JSON.stringify(roster));
      if (url.endsWith(`/league/${native}/users`)) {
        if (directoryOutage) throw new Error('synthetic directory interruption');
        return new Response(JSON.stringify([{ user_id: '555', display_name: 'Synthetic Manager' }]));
      }
      throw new Error('Unexpected fixture provider scope.');
    });
    const dependencies: PublicIntakeDependencies = { intake, jobs, administration };
    const progress = async (selected = dependencies, requestId = id) => {
      const deadline = Date.now() + 150_000;
      while (Date.now() < deadline) {
        const result = await runPublicIntakeStep(requestId, selected, new AbortController().signal);
        if (!['busy', 'backoff'].includes(result.status)) return result;
        await delay(1_000);
      }
      throw new Error('Real public intake admission did not become due.');
    };
    try {
      expect((await database.query('SELECT session_user AS role'))[0]?.role).toBe('league_one_runtime');
      // Initial synthetic HTTP captures use the real clock. The unchanged rows
      // naturally age during the unchanged, real 60-second intake admissions.
      const originalMapping = await administration.readSourceMapping(native);
      if (!originalMapping) throw new Error('Missing original source mapping.');
      const cachedDocuments = await Promise.all((['league', 'rosters', 'users'] as const)
        .map(family => capturePublicSleeperCore(native, family, new AbortController().signal)));
      // Persist a cache read of those exact fixtures, retaining their real source
      // timestamps. A network refresh must not relabel this original row's origin.
      const originals = await recordCapturedAdministration(originalMapping.scope, cachedDocuments.map(document => ({ ...document, origin: 'cache' as const })),
        { store: administration, mapping: originalMapping });
      const originalIds = originals.results.map(entry => entry.result.observationId);
      const immutableOriginals = await database.query('SELECT * FROM public.league_administration_observations WHERE id=ANY($1::uuid[]) ORDER BY id', [originalIds]);
      directoryOutage = true;
      await intake.submit({ id, username: 'synthetic_manager', seasons: [season] });
      await intake.submit({ id, username: 'synthetic_manager', seasons: [season] });
      await expect(intake.submit({ id, username: 'different_manager', seasons: [season] })).rejects.toThrow('replay mismatch');
      for (const resource of ['identity', 'leagues', 'bootstrap']) expect(await progress()).toMatchObject({ status: 'progress', resource });
      // All typed writes commit, then process death/lost checkpoint leaves this
      // request at core. Retry must acquire fresh receipts for identical content.
      expect(await progress({ ...dependencies, intake: { ...intake, completeCore: async () => { throw new Error('lost core checkpoint'); } } }))
        .toMatchObject({ status: 'unavailable', resource: 'core' });
      const beforeRetry = await administration.readAcceptedLeagueSettings(originalMapping);
      const beforeRetryRoster = await administration.readAcceptedCurrentRoster(originalMapping);
      expect(beforeRetry.status).toBe('available');
      expect(await progress()).toMatchObject({ status: 'progress', resource: 'core' });
      const read = await readPublicSleeperIntake(database, administration, id);
      if (read.status === 'missing') throw new Error('Missing public fixture readback.');
      expect(read.leagues[0].resources).toMatchObject({ settings: { status: 'available' }, heldRoster: { status: 'available' },
        teamManagers: { status: 'available' }, directory: { status: 'unavailable' } });
      const [candidate] = await database.query('SELECT * FROM public.public_data_league_candidates WHERE intake_id=$1', [id]);
      for (const key of ['settings_receipt_id', 'players_receipt_id', 'managers_receipt_id']) expect(candidate[key]).toBeTruthy();
      expect(candidate.league_observation_id).toBe(originals.results.find(entry => entry.family === 'league')?.result.observationId);
      if (beforeRetryRoster.status !== 'available') throw new Error('Missing first mapped network roster capture.');
      expect(candidate.roster_observation_id).toBe(beforeRetryRoster.receipt.legacyObservationId);
      if (beforeRetry.status !== 'available') throw new Error('Missing interrupted typed capture.');
      expect(candidate.settings_receipt_id).not.toBe(beforeRetry.receipt.id);
      const [freshness] = await database.query(`SELECT observed.origin AS original_origin,observed.request_started_at<clock_timestamp()-interval '30 seconds' AS original_old,
        (receipt.provenance->>'requestStartedAt')::timestamptz>=dispatch.admitted_at AS fresh_dispatch
        FROM public.league_roster_capture_receipts receipt
        JOIN public.league_roster_resource_attempts attempt ON attempt.id=receipt.attempt_id
        JOIN public.public_data_dispatches dispatch ON dispatch.worker_id=attempt.write_fence->>'workerId'
          AND dispatch.generation=(attempt.write_fence->>'generation')::integer
        JOIN public.league_administration_observations observed ON observed.id=receipt.legacy_observation_id
        WHERE receipt.id=$1`, [candidate.settings_receipt_id]);
      expect(freshness).toEqual({ original_origin: 'cache', original_old: true, fresh_dispatch: true });
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
      const seasonHistory = await database.query('SELECT * FROM public.league_administration_enrollment_seasons WHERE league_id=$1 ORDER BY season', [registration.value.leagueId]);
      await database.query('SELECT public.prepare_account_league_enrollment($1::uuid,$2::integer,$3::text)', [registration.value.leagueId, season, native]);
      await database.query('SELECT public.prepare_account_league_enrollment($1::uuid,$2::integer,$3::text)', [registration.value.leagueId, season, native]);
      expect(await database.query('SELECT * FROM public.league_administration_enrollment_seasons WHERE league_id=$1 ORDER BY season', [registration.value.leagueId])).toEqual(seasonHistory);
      await expect(database.query('UPDATE public.league_administration_enrollments SET data_adopted_seasons=ARRAY[$2]::integer[] WHERE league_id=$1',
        [registration.value.leagueId, season + 1])).rejects.toMatchObject({ code: '42501' });
      expect((await database.query('SELECT active,evidence FROM public.league_administration_enrollments WHERE league_id=$1', [registration.value.leagueId]))[0])
        .toMatchObject({ active: false, evidence: 'account-onboarding-v1' });
      await expect(database.query('SELECT public.activate_account_league_enrollment($1,$2,$3)', [`sleeper-${native}`, season, native]))
        .rejects.toThrow('complete current onboarding evidence');
      expect((await administration.listEnrollmentInventory(season)).entries.some(entry => entry.intended.leagueId === registration.value.leagueId)).toBe(false);
      const mapping = await administration.readSourceMapping(native);
      if (!mapping) throw new Error('Missing adoption source mapping.');
      directoryOutage = false;
      expect(await progress()).toMatchObject({ status: 'progress', resource: 'users' });
      const [directoryReceipt] = await database.query(`SELECT capture.*,observed.request_started_at AS original_request_started_at
        FROM public.public_data_directory_captures capture JOIN public.league_administration_observations observed
          ON observed.id=capture.legacy_observation_id WHERE capture.intake_id=$1`, [id]);
      expect(directoryReceipt.legacy_observation_id).toBe(originals.results.find(entry => entry.family === 'users')?.result.observationId);
      expect(new Date(String(directoryReceipt.request_started_at)).getTime()).toBeGreaterThan(new Date(String(directoryReceipt.original_request_started_at)).getTime());
      await expect(database.query('DELETE FROM public.public_data_directory_captures WHERE id=$1', [directoryReceipt.id])).rejects.toMatchObject({ code: '42501' });
      await expect(ownerQuery('DELETE FROM public.public_data_directory_captures WHERE id=$1', [directoryReceipt.id])).rejects.toThrow('immutable');
      const finished = await readPublicSleeperIntake(database, administration, id);
      if (finished.status === 'missing') throw new Error('Missing completed intake.');
      expect(finished.leagues[0].resources?.directory).toMatchObject({ status: 'available', acquisition: { id: directoryReceipt.id } });
      expect(await database.query('SELECT * FROM public.league_administration_observations WHERE id=ANY($1::uuid[]) ORDER BY id', [originalIds])).toEqual(immutableOriginals);
      const at = new Date().toISOString();
      await recordCapturedAdministration(mapping.scope, [
        { family: 'league', payload: league }, { family: 'rosters', payload: roster },
        { family: 'users', payload: [{ user_id: '555', display_name: 'Synthetic Manager' }] },
      ].map(document => ({ ...document, family: document.family as 'league' | 'rosters' | 'users', week: null,
        origin: 'network' as const, requestStartedAt: at, requestCompletedAt: at })), { store: administration });
      await database.query('SELECT public.activate_account_league_enrollment($1,$2,$3)', [`sleeper-${native}`, season, native]);
      expect((await administration.listEnrollmentInventory(season)).entries.some(entry => entry.intended.leagueId === registration.value.leagueId)).toBe(true);
      // A later DATA-only history row is not adopted by activating this season.
      await ownerQuery(`INSERT INTO public.league_administration_enrollment_seasons(league_id,season,provider,evidence)
        VALUES($1,$2,'sleeper','public-data-intake-v1')`, [registration.value.leagueId, season + 1]);
      expect((await administration.listEnrollmentInventory(season + 1)).entries.some(entry => entry.intended.leagueId === registration.value.leagueId)).toBe(false);
      const defaultEntry = (await administration.listEnrollmentInventory()).entries.find(entry => entry.intended.leagueId === registration.value.leagueId);
      expect(defaultEntry?.intended.season).toBe(season);
      expect(fetch.mock.calls.filter(([url]) => String(url).includes('/user/'))).toHaveLength(2);
      const originalProfile = await database.query('SELECT scoring_profile_id FROM public.league_seasons WHERE id=$1', [mapping.leagueSeasonId]);
      const correctionId = randomUUID();
      league.scoring_settings.rec_yd = 0.2;
      await intake.submit({ id: correctionId, username: 'synthetic_manager', seasons: [season] });
      // Repeat the whole actual intake path, with normal admission waits, after
      // an official scoring correction that must not rewrite calculation rules.
      for (const resource of ['identity', 'leagues', 'bootstrap', 'core']) {
        expect(await progress(dependencies, correctionId)).toMatchObject({ status: 'progress', resource });
      }
      const corrected = await administration.readAcceptedLeagueSettings(mapping);
      if (corrected.status !== 'available') throw new Error('Missing official correction.');
      expect(corrected.value.scoring.rules).toMatchObject({ value: { rec_yd: 0.2 } });
      expect(await administration.readSource({ ...mapping.scope, family: 'league', week: null }))
        .toMatchObject({ status: 'conflict', reason: 'scoring_profile_change_requires_explicit_compatibility_and_period_review' });
      expect(await database.query('SELECT scoring_profile_id FROM public.league_seasons WHERE id=$1', [mapping.leagueSeasonId])).toEqual(originalProfile);
      const correctedRead = await readPublicSleeperIntake(database, administration, correctionId);
      if (correctedRead.status === 'missing') throw new Error('Missing correction checkpoint.');
      expect(correctedRead.leagues[0].resources).toMatchObject({ settings: { status: 'available' },
        heldRoster: { status: 'available' }, teamManagers: { status: 'available' } });
      const currentRoster = await administration.readAcceptedCurrentRoster(mapping);
      const currentManagers = await administration.readAcceptedTeamManagers(mapping);
      const retainedPopulation = { observationId: corrected.receipt.legacyObservationId, contentHash: corrected.receipt.rawContentHash,
        envelope: { schemaVersion: 'league-administration-v1' as const, normalizerVersion: 'sleeper-administration-v1' as const,
          dialect: 'sleeper-nfl-v1' as const, scope: mapping.scope, family: 'league' as const, week: null, completeness: 'complete' as const,
          provenance: corrected.receipt.provenance, payload: league } };
      // A receipt from the former PUBLIC worker cannot authorize a new unfenced
      // writer's claimed same-batch population, even for identical official rules.
      const wrongOwner = await administration.beginRosterCapture(mapping, randomUUID(), randomUUID());
      const rejectedOwner = await recordCapturedAdministration(mapping.scope,
        [await capturePublicSleeperCore(native, 'rosters', new AbortController().signal)], { store: administration, mapping,
          rosterAttempt: wrongOwner.players, managerAttempt: wrongOwner.managers, populationEvidence: retainedPopulation });
      expect(rejectedOwner.results[0].result.rosterAcceptance?.status).toBe('preserved');
      expect(rejectedOwner.results[0].result.teamManagerAcceptance?.status).toBe('preserved');
      // The no-population recovery path is also fenced by the latest settings
      // reservation; a pending newer settings acquisition cannot reuse old proof.
      await administration.beginLeagueSettingsAttempt(mapping, randomUUID());
      const superseded = await administration.beginRosterCapture(mapping, randomUUID(), randomUUID());
      const rejectedLatest = await recordCapturedAdministration(mapping.scope,
        [await capturePublicSleeperCore(native, 'rosters', new AbortController().signal)], { store: administration, mapping,
          rosterAttempt: superseded.players, managerAttempt: superseded.managers });
      expect(rejectedLatest.results[0].result.rosterAcceptance?.status).toBe('preserved');
      expect(rejectedLatest.results[0].result.teamManagerAcceptance?.status).toBe('preserved');
      expect(await administration.readAcceptedCurrentRoster(mapping)).toEqual(currentRoster);
      expect(await administration.readAcceptedTeamManagers(mapping)).toEqual(currentManagers);

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
