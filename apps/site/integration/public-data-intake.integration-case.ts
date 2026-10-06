import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createIndependentDatabase, createPinnedIntegrationDatabase, ownerQuery, type IndependentDatabase } from './neon-integration-harness';
import { createProjectionStore } from '../lib/projection-store';
import { createPublicIntakeStore, createPublicDataRefreshStore, createLeagueAdministrationStore } from '../lib/league-administration/store';
import { runPublicIntakeStep, runPublicDataRefreshStep, type PublicIntakeDependencies } from '../lib/league-administration/public-intake';
import { readPublicSleeperIntake } from '../lib/league-administration/public-intake-reader';
import { readPublicDataRefresh } from '../lib/league-administration/public-refresh-reader';
import { recordCapturedAdministration } from '../lib/league-administration/runtime';
import { PUBLIC_INTAKE_JOB, type PublicIntakeWork } from '../lib/league-administration/public-intake-contracts';
import { capturePublicSleeperCore, capturePublicSleeperIdentity } from '../lib/sleeper';
import type { DatabaseClient, DatabaseRow } from '../lib/database';
import type { PublicDataRefreshConfiguration } from '../lib/league-administration/public-refresh-contracts';

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

  it.each(['configured', 'official-only'] as const)('rolls back %s canonical registration and its reservation when an identity-row wait outlives the postcondition fence', async mode => {
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
      total_rosters: 1, settings: {}, ...(mode === 'configured' ? { scoring_settings: { rec: 1 }, roster_positions: ['QB'] } : {}) };
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


/** SOURCE ONLY, NOT EXECUTED. These use real restricted LOGIN SQL and the same
 * coordinator. No owner writes to acceptance/dispatch rows, clock backdating,
 * admission bypass, provider request or SQL execution occurred during authoring.
 * The focused typed-cycle case alone requires at least ten real minute-spaced
 * admissions plus recovery/cadence waits. Full-suite fit inside the qualification
 * lifecycle is unproved; select this case only through the guarded suite. */
describe('bounded public DATA refresh cycles through the existing intake owner', () => {
  let connection: IndependentDatabase;
  let identityRequestId: string;
  let nativeManager: string;
  let targetId: string;
  let configuration: PublicDataRefreshConfiguration;
  let revision = 0;
  let retainedLeague: Record<string, unknown>;
  beforeAll(async () => {
    connection = createIndependentDatabase();
    expect((await connection.database.query('SELECT session_user AS role'))[0].role).toBe('league_one_runtime');
    // Reuse an actual fixture acquisition from the earlier source-to-reader case.
    // Absence is a fixture failure, never manufactured identity/acceptance evidence.
    const [identity] = await connection.database.query(`SELECT identity.intake_id,account.external_manager_id
      FROM public.public_data_identity_observations identity
      JOIN public.league_source_manager_accounts account ON account.id=identity.source_manager_account_id
      WHERE account.provider='sleeper' AND identity.username='synthetic_manager' ORDER BY identity.request_completed_at LIMIT 1`);
    if (identity) {
      identityRequestId = String(identity.intake_id);
      nativeManager = String(identity.external_manager_id);
      const [source] = await connection.database.query('SELECT bootstrap_payload FROM public.public_data_league_candidates WHERE intake_id=$1 AND season=2181', [identityRequestId]);
      if (!source?.bootstrap_payload || typeof source.bootstrap_payload !== 'object') throw new Error('Missing retained league fixture.');
      retainedLeague = source.bootstrap_payload as Record<string, unknown>;
    } else {
      // A focused run creates its own pre-enrolled synthetic league, like the
      // maintained source-to-reader fixture above. This is not fresh-fleet
      // capacity proof. Identity itself still uses actual restricted admission,
      // HTTP parsing and checkpointing; no identity receipt is inserted by owner.
      const native = `6${BigInt(`0x${randomUUID().replaceAll('-', '').slice(0, 15)}`)}`;
      retainedLeague = { league_id: native, season: '2181', sport: 'nfl', name: 'Focused recurring SQL fixture',
        total_rosters: 1, settings: {}, roster_positions: ['QB', 'BN'], scoring_settings: { rec_yd: 0.1, unsupported_bonus: 2 } };
      const jobs = createProjectionStore(connection.database);
      const registered = await jobs.registerLeagueSeason({ leagueKey: `sleeper-${native}`, leagueName: String(retainedLeague.name),
        sleeperLeagueId: native, season: 2181, scoringRules: { rec_yd: 0.1, unsupported_bonus: 2 } });
      if (registered.kind !== 'stored') throw new Error('Focused recurrence fixture registration unavailable.');
      await ownerQuery("INSERT INTO public.league_administration_enrollments(league_id,provider,active,evidence) VALUES($1,'sleeper',false,'public-data-intake-v1')", [registered.value.leagueId]);
      await ownerQuery("INSERT INTO public.league_administration_enrollment_seasons(league_id,season,provider,evidence) VALUES($1,2181,'sleeper','public-data-intake-v1')", [registered.value.leagueId]);
      identityRequestId = randomUUID(); nativeManager = '555';
      const intake = createPublicIntakeStore(connection.database);
      await intake.submit({ id: identityRequestId, username: 'synthetic_manager', seasons: [2181] });
      const capture = vi.spyOn(globalThis, 'fetch').mockImplementation(async input => {
        const url = String(input);
        if (url.endsWith('/user/synthetic_manager')) return new Response(JSON.stringify({ user_id: nativeManager, username: 'synthetic_manager' }));
        if (url.endsWith(`/user/${nativeManager}/leagues/nfl/2181`)) return new Response('[]');
        throw new Error('Unexpected focused prerequisite source scope.');
      });
      try {
        for (const resource of ['identity', 'leagues']) {
          let done = false;
          const until = Date.now() + 150_000;
          while (Date.now() < until) {
            const result = await runPublicIntakeStep(identityRequestId, { intake, jobs,
              administration: createLeagueAdministrationStore(connection.database) }, AbortSignal.timeout(20_000));
            if (['busy', 'backoff'].includes(result.status)) { await delay(1_000); continue; }
            expect(result).toMatchObject({ status: 'progress', resource }); done = true; break;
          }
          expect(done).toBe(true);
        }
      } finally { capture.mockRestore(); }
    }
    targetId = randomUUID();
    configuration = { id: targetId, expectedRevision: 0, identityRequestId, seasons: [2181], cadenceSeconds: 60,
      expiresAt: new Date(Date.now() + 60 * 60_000).toISOString(), paused: false };
  }, 330_000);
  afterAll(async () => {
    if (revision) await createPublicDataRefreshStore(connection.database).configure({ ...configuration, expectedRevision: revision,
      expiresAt: new Date(Date.now() + 60_000).toISOString(), paused: true }).catch(() => undefined);
    await connection.close();
  });
  async function claim(database = connection.database, deadlineMs = 20_000) {
    const jobs = createProjectionStore(database);
    const workerId = randomUUID();
    const acquired = await jobs.acquireJob({ jobKey: PUBLIC_INTAKE_JOB, jobType: PUBLIC_INTAKE_JOB, workerId,
      scheduledFor: new Date().toISOString(), leaseSeconds: 25, payload: { policy: 'public-data-refresh-v1', mode: 'recurring' } });
    if (acquired.kind !== 'acquired') throw new Error('Refresh fixture could not acquire the existing public job.');
    return { jobs, fence: { jobKey: PUBLIC_INTAKE_JOB, workerId, generation: acquired.attempt,
      deadlineAt: new Date(Date.now() + deadlineMs).toISOString() } };
  }
  async function reconfigure(patch: Partial<PublicDataRefreshConfiguration>) {
    const input = { ...configuration, ...patch, expectedRevision: revision };
    const result = await createPublicDataRefreshStore(connection.database).configure(input);
    revision = result.configurationRevision;
    configuration = input;
    return result;
  }

  it('retains one cycle through concurrent selectors, unknown acknowledgements, poisoned selection and sequential approval checks', async () => {
    const database = connection.database;
    const refresh = createPublicDataRefreshStore(database);
    const configured = await refresh.configure(configuration);
    revision = configured.configurationRevision;
    expect(await refresh.configure(configuration)).toMatchObject({ status: 'replayed', configurationRevision: revision });
    await expect(refresh.configure({ ...configuration, id: randomUUID() })).rejects.toThrow('already has a refresh target');
    const owner = await claim();
    const other = createIndependentDatabase();
    try {
      const [left, right] = await Promise.all([refresh.select(owner.fence), createPublicDataRefreshStore(other.database).select(owner.fence)]);
      expect(left.status).toBe('selected');
      expect(right).toEqual(left);
      if (left.status !== 'selected') throw new Error('Missing selected cycle.');
      expect(await database.query('SELECT * FROM public.public_data_refresh_cycles WHERE target_id=$1', [targetId])).toHaveLength(1);
      const [request] = await database.query('SELECT username,seasons FROM public.public_data_intakes WHERE id=$1', [left.requestId]);
      expect(request).toEqual({ username: nativeManager, seasons: [2181] });
      const ambiguous: DatabaseClient = { ...database, async query<Row extends DatabaseRow = DatabaseRow>(statement: string, parameters: readonly unknown[] = []) {
        const rows = await database.query<Row>(statement, parameters);
        if (statement.includes('select_public_data_refresh')) throw new Error('synthetic selection acknowledgement lost');
        return rows;
      } };
      await expect(createPublicDataRefreshStore(ambiguous).select(owner.fence)).rejects.toThrow('acknowledgement lost');
      expect(await refresh.select(owner.fence)).toEqual(left);
      const failed = await refresh.recordSelectionFailure(null, owner.fence, 'selection-failed');
      expect(failed.status).toBe('recorded');
      expect(await refresh.recordSelectionFailure(left, owner.fence, 'selection-failed')).toMatchObject({ status: 'already-recorded', retryAt: failed.retryAt });
      expect((await database.query('SELECT last_served_at,selection_failure_count FROM public.public_data_refresh_targets WHERE id=$1', [targetId]))[0])
        .toEqual({ last_served_at: null, selection_failure_count: 1 });
      expect(await database.query('SELECT * FROM public.public_data_refresh_selection_failures WHERE target_id=$1', [targetId])).toHaveLength(1);
      // Corrected configuration resets eligibility, retaining its earlier failure.
      await reconfigure({ paused: true });
      expect(await refresh.recordSelectionFailure(left, owner.fence, 'request-state-failed')).toEqual({ status: 'superseded' });
      const intake = createPublicIntakeStore(database);
      const work = await intake.next(left.requestId);
      if (typeof work === 'string') throw new Error('Missing selected work.');
      expect(await intake.admit(work, owner.fence)).toBe(false);
      await expect(refresh.configure({ ...configuration, expectedRevision: revision, seasons: [2182] }))
        .rejects.toThrow('unfinished refresh cycle');
      await expect(refresh.configure({ ...configuration, expectedRevision: 0, cadenceSeconds: 61 })).rejects.toThrow('revision changed');
      await reconfigure({ paused: false, expiresAt: new Date(Date.now() + 60 * 60_000).toISOString() });
      expect(await intake.admit(work, owner.fence)).toBe(false); // old approval token remains stale
    } finally { await owner.jobs.failJob(PUBLIC_INTAKE_JOB, owner.fence.workerId, 'metadata-only refresh oracle'); await other.close(); }
    const resumed = await claim();
    try {
      const selected = await refresh.select(resumed.fence);
      expect(selected).toMatchObject({ status: 'selected', targetId, cycle: 1, cycleConfigurationRevision: 1, configurationRevision: revision });
      if (selected.status !== 'selected') throw new Error('Missing resumed request.');
      const [cycle] = await database.query('SELECT intake_id FROM public.public_data_refresh_cycles WHERE target_id=$1 AND cycle=1', [targetId]);
      expect(selected.requestId).toBe(cycle.intake_id);
      const read = await readPublicDataRefresh(database, createLeagueAdministrationStore(database), targetId);
      expect(read.status).toBe('available');
      expect(read).toMatchObject({ target: { configurationRevision: revision }, cycle: { number: 1, configurationRevision: 1, requestId: selected.requestId } });
      // Unknown admission is reconciled by actual durable evidence. This attempt
      // waits for the real global interval and never issues a provider request.
      const [due] = await database.query("SELECT greatest(0,extract(epoch FROM max(admitted_at)+interval '61 seconds'-clock_timestamp())) AS seconds FROM public.public_data_dispatches");
      if (Number(due.seconds) > 0) {
        // This invocation cannot extend its original20s fence while waiting.
        expect(await createPublicIntakeStore(database).admit(await createPublicIntakeStore(database).next(selected.requestId) as PublicIntakeWork, resumed.fence)).toBe(false);
        expect((await database.query('SELECT last_served_at FROM public.public_data_refresh_targets WHERE id=$1', [targetId]))[0].last_served_at).toBeNull();
      }
    } finally { await resumed.jobs.failJob(PUBLIC_INTAKE_JOB, resumed.fence.workerId, 'metadata-only refresh resume'); }
    await reconfigure({ expiresAt: new Date(Date.now() + 3_000).toISOString() });
    const expiring = await claim();
    try {
      const selected = await refresh.select(expiring.fence);
      if (selected.status !== 'selected') throw new Error('Missing expiring approval selection.');
      const intake = createPublicIntakeStore(database);
      const work = await intake.next(selected.requestId);
      if (typeof work === 'string') throw new Error('Missing expiry work.');
      await delay(Math.max(0, Date.parse(configuration.expiresAt) - Date.now()) + 100);
      expect(await intake.admit(work, expiring.fence)).toBe(false);
      expect(await database.query('SELECT * FROM public.public_data_dispatches WHERE worker_id=$1 AND generation=$2',
        [expiring.fence.workerId, expiring.fence.generation])).toHaveLength(0);
      expect((await database.query('SELECT selection_failure_count FROM public.public_data_refresh_targets WHERE id=$1', [targetId]))[0].selection_failure_count).toBe(0);
    } finally {
      await expiring.jobs.failJob(PUBLIC_INTAKE_JOB, expiring.fence.workerId, 'expected expired refresh approval');
      await reconfigure({ expiresAt: new Date(Date.now() + 60 * 60_000).toISOString() });
    }
  });

  it('defers a failed selection without giving it admission credit or monopolizing another verified target', async () => {
    const database = connection.database;
    const [otherIdentity] = await database.query(`SELECT identity.intake_id FROM public.public_data_identity_observations identity
      JOIN public.league_source_manager_accounts account ON account.id=identity.source_manager_account_id
      WHERE account.provider='sleeper' AND account.external_manager_id<>$1 AND identity.username='identity_lock_fixture'
      ORDER BY identity.request_completed_at LIMIT 1`, [nativeManager]);
    if (!otherIdentity) throw new Error('Fairness oracle requires the preceding genuine identity-lock fixture acquisition.');
    const refresh = createPublicDataRefreshStore(database);
    const otherTarget = randomUUID();
    const input = { ...configuration, id: otherTarget, expectedRevision: 0, identityRequestId: String(otherIdentity.intake_id) };
    await refresh.configure(input);
    const first = await claim();
    let firstRequest = '';
    try {
      const selected = await refresh.select(first.fence);
      expect(selected).toMatchObject({ status: 'selected', targetId });
      if (selected.status !== 'selected') throw new Error('Missing poisoned selection fixture.');
      firstRequest = selected.requestId;
      await refresh.recordSelectionFailure(selected, first.fence, 'request-state-failed');
    } finally { await first.jobs.failJob(PUBLIC_INTAKE_JOB, first.fence.workerId, 'synthetic pre-admission outage'); }
    const second = await claim();
    try {
      const selected = await refresh.select(second.fence);
      expect(selected).toMatchObject({ status: 'selected', targetId: otherTarget });
      if (selected.status !== 'selected') throw new Error('Missing fair second target.');
      expect(selected.requestId).not.toBe(firstRequest);
      expect(await database.query('SELECT last_served_at FROM public.public_data_refresh_targets WHERE id=ANY($1::uuid[]) ORDER BY id', [[targetId, otherTarget]]))
        .toEqual([{ last_served_at: null }, { last_served_at: null }]);
      expect(await database.query('SELECT * FROM public.public_data_dispatches WHERE worker_id=ANY($1::text[])', [[first.fence.workerId, second.fence.workerId]])).toHaveLength(0);
    } finally {
      await second.jobs.failJob(PUBLIC_INTAKE_JOB, second.fence.workerId, 'no HTTP in fairness selection oracle');
      await refresh.configure({ ...input, expectedRevision: 1, paused: true });
      await reconfigure({ paused: false });
    }
  });
  it('rejects private helpers and direct cursor/history writes, and rolls back selection after an actual job-lock expiry', async () => {
    const database = connection.database;
    for (const table of ['public_data_refresh_targets', 'public_data_refresh_configurations', 'public_data_refresh_cycles',
      'public_data_refresh_cycle_outcomes', 'public_data_refresh_selection_failures']) {
      const [rights] = await database.query(`SELECT has_table_privilege(current_user,$1,'SELECT') AS readable,
        has_table_privilege(current_user,$1,'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') AS writable`, [`public.${table}`]);
      expect(rights).toEqual({ readable: true, writable: false });
      await expect(database.query(`DELETE FROM public.${table}`)).rejects.toThrow(/permission denied/u);
    }
    for (const signature of ['assert_public_refresh_owner(jsonb)', 'admit_public_data_dispatch_v34(jsonb,jsonb)']) {
      expect((await database.query('SELECT has_function_privilege(current_user,$1,\'EXECUTE\') AS allowed', [`public.${signature}`]))[0].allowed).toBe(false);
      expect((await database.query("SELECT COALESCE(bool_or(acl.grantee=0 AND acl.privilege_type='EXECUTE'),false) AS allowed FROM pg_proc fn CROSS JOIN LATERAL aclexplode(COALESCE(fn.proacl,acldefault('f',fn.proowner))) acl WHERE fn.oid=to_regprocedure($1)", [`public.${signature}`]))[0].allowed).toBe(false);
    }
    const runtime = await createPinnedIntegrationDatabase('runtime');
    const blocker = await createPinnedIntegrationDatabase('owner');
    const owner = await claim(database, 2_000);
    let blocked = false;
    let pending: Promise<unknown> | undefined;
    try {
      await runtime.database.query("SET statement_timeout='8s'");
      const [session] = await runtime.database.query('SELECT pg_backend_pid() AS pid,session_user AS role');
      expect(session.role).toBe('league_one_runtime');
      const [blocking] = await blocker.database.query('SELECT pg_backend_pid() AS pid');
      await blocker.database.query('BEGIN'); blocked = true;
      await blocker.database.query('SELECT job_key FROM public.projection_jobs WHERE job_key=$1 FOR UPDATE', [PUBLIC_INTAKE_JOB]);
      pending = createPublicDataRefreshStore(runtime.database).select(owner.fence).then(() => ({ ok: true }), error => ({ ok: false, error }));
      let reached = false;
      const observeUntil = Date.now() + 1_500;
      while (Date.now() < observeUntil) {
        const [state] = await ownerQuery('SELECT $2::integer=ANY(pg_blocking_pids($1::integer)) AS blocked', [session.pid, blocking.pid]);
        if (state.blocked) { reached = true; break; }
        await delay(20);
      }
      expect(reached, 'Selector must actually block on the job row.').toBe(true);
      await delay(Math.max(0, Date.parse(owner.fence.deadlineAt) - Date.now()) + 100);
      await blocker.database.query('ROLLBACK'); blocked = false;
      expect(await pending).toMatchObject({ ok: false, error: { message: expect.stringContaining('lease lost') } });
      expect((await database.query('SELECT payload FROM public.projection_jobs WHERE job_key=$1', [PUBLIC_INTAKE_JOB]))[0].payload)
        .not.toHaveProperty('refreshSelection');
      expect(await database.query('SELECT * FROM public.public_data_refresh_cycles WHERE target_id=$1', [targetId])).toHaveLength(1);
    } finally {
      if (blocked) { await delay(Math.max(0, Date.parse(owner.fence.deadlineAt) - Date.now()) + 100); await blocker.database.query('ROLLBACK'); }
      await pending;
      await owner.jobs.failJob(PUBLIC_INTAKE_JOB, owner.fence.workerId, 'expected selector lock expiry');
      await runtime.close(); await blocker.close();
    }
  }, 15_000);

  /** AUTHORED / UNEXECUTED: observed PostgreSQL lock waits, not simultaneous
   * Promise creation alone, establish each competing transaction's barrier.
   * The admission-first case may wait the real remaining 61-second interval;
   * the expiry case waits five real seconds. These add runtime beyond metadata
   * checks. No full-suite fit in the 30/40-minute lifecycle has been measured. */
  async function expectBlocked(waiterPid: unknown, blockerPid: unknown) {
    const until = Date.now() + 2_500;
    let blocked = false;
    while (Date.now() < until) {
      const [state] = await ownerQuery('SELECT $2::integer=ANY(pg_blocking_pids($1::integer)) AS blocked', [waiterPid, blockerPid]);
      if (state.blocked) { blocked = true; break; }
      await delay(20);
    }
    expect(blocked, 'Competing SQL statement must reach the observed lock barrier.').toBe(true);
  }

  it('serializes competing configuration CAS calls behind one observed lock and retains only the winning revision', async () => {
    const blocker = await createPinnedIntegrationDatabase('owner');
    const left = await createPinnedIntegrationDatabase('runtime');
    const right = await createPinnedIntegrationDatabase('runtime');
    let open = false;
    const pending: Promise<PromiseSettledResult<Awaited<ReturnType<ReturnType<typeof createPublicDataRefreshStore>['configure']>>>>[] = [];
    const inputs = [61, 62].map(cadenceSeconds => ({ ...configuration, expectedRevision: revision, cadenceSeconds }));
    const before = await connection.database.query('SELECT * FROM public.public_data_refresh_configurations WHERE target_id=$1 ORDER BY revision', [targetId]);
    try {
      const [ownerSession] = await blocker.database.query('SELECT pg_backend_pid() AS pid');
      const sessions = [];
      for (const client of [left, right]) {
        await client.database.query("SET statement_timeout='8s'");
        const [session] = await client.database.query('SELECT pg_backend_pid() AS pid,session_user AS role');
        expect(session.role).toBe('league_one_runtime'); sessions.push(session);
      }
      await blocker.database.query('BEGIN'); open = true;
      await blocker.database.query("SELECT pg_advisory_xact_lock(hashtextextended('public-data-refresh-configuration',0))");
      for (const [index, client] of [left, right].entries()) {
        pending.push(createPublicDataRefreshStore(client.database).configure(inputs[index])
          .then(value => ({ status: 'fulfilled' as const, value }), reason => ({ status: 'rejected' as const, reason })));
        await expectBlocked(sessions[index].pid, ownerSession.pid);
      }
      await blocker.database.query('COMMIT'); open = false;
      const outcomes = await Promise.all(pending);
      expect(outcomes.filter(outcome => outcome.status === 'fulfilled')).toHaveLength(1);
      expect(outcomes.filter(outcome => outcome.status === 'rejected')).toHaveLength(1);
      const winner = outcomes.findIndex(outcome => outcome.status === 'fulfilled');
      const winning = outcomes[winner];
      if (winning.status !== 'fulfilled') throw new Error('Missing CAS winner.');
      expect(outcomes[1 - winner]).toMatchObject({ status: 'rejected', reason: { message: expect.stringContaining('revision changed') } });
      expect(winning.value.configurationRevision).toBe(revision + 1);
      revision = winning.value.configurationRevision; configuration = inputs[winner];
      const after = await connection.database.query('SELECT * FROM public.public_data_refresh_configurations WHERE target_id=$1 ORDER BY revision', [targetId]);
      expect(after.slice(0, -1)).toEqual(before);
      expect(after).toHaveLength(before.length + 1);
    } finally {
      if (open) await blocker.database.query('ROLLBACK');
      await Promise.all(pending);
      await left.close(); await right.close(); await blocker.close();
    }
    await reconfigure({ cadenceSeconds: 60 });
  });

  it('observes a pause commit win against an admission already waiting on the target row', async () => {
    const pauser = await createPinnedIntegrationDatabase('runtime');
    const admitting = await createPinnedIntegrationDatabase('runtime');
    const owner = await claim();
    let open = false;
    let pending: Promise<boolean> | undefined;
    try {
      const selected = await createPublicDataRefreshStore(connection.database).select(owner.fence);
      if (selected.status !== 'selected') throw new Error('Missing pause race selection.');
      const intake = createPublicIntakeStore(admitting.database);
      const work = await intake.next(selected.requestId);
      if (typeof work === 'string') throw new Error('Missing pause race work.');
      await admitting.database.query("SET statement_timeout='8s'");
      const [pauseSession] = await pauser.database.query('SELECT pg_backend_pid() AS pid,session_user AS role');
      const [admitSession] = await admitting.database.query('SELECT pg_backend_pid() AS pid,session_user AS role');
      expect([pauseSession.role, admitSession.role]).toEqual(['league_one_runtime', 'league_one_runtime']);
      await pauser.database.query('BEGIN'); open = true;
      const input = { ...configuration, expectedRevision: revision, paused: true };
      const configured = await createPublicDataRefreshStore(pauser.database).configure(input);
      pending = intake.admit(work, owner.fence);
      // Attach a handler immediately while the assertion inspects the live wait.
      const settled = pending.then(value => ({ value }), error => ({ error }));
      await expectBlocked(admitSession.pid, pauseSession.pid);
      await pauser.database.query('COMMIT'); open = false;
      revision = configured.configurationRevision; configuration = input;
      expect(await settled).toEqual({ value: false });
      expect(await connection.database.query('SELECT * FROM public.public_data_dispatches WHERE worker_id=$1 AND generation=$2',
        [owner.fence.workerId, owner.fence.generation])).toEqual([]);
      expect(await connection.database.query('SELECT * FROM public.public_data_refresh_selection_failures WHERE worker_id=$1 AND generation=$2',
        [owner.fence.workerId, owner.fence.generation])).toEqual([]);
    } finally {
      if (open) await pauser.database.query('ROLLBACK');
      await pending?.catch(() => undefined);
      await owner.jobs.failJob(PUBLIC_INTAKE_JOB, owner.fence.workerId, 'observed pause-before-admission barrier');
      await admitting.close(); await pauser.close();
      await reconfigure({ paused: false });
    }
  });

  it('rejects approval that expires during an observed target-row admission wait under the original live fence', async () => {
    const blocker = await createPinnedIntegrationDatabase('owner');
    const admitting = await createPinnedIntegrationDatabase('runtime');
    await admitting.database.query("SET statement_timeout='10s'");
    const [ownerSession] = await blocker.database.query('SELECT pg_backend_pid() AS pid');
    const [admitSession] = await admitting.database.query('SELECT pg_backend_pid() AS pid,session_user AS role');
    const owner = await claim();
    let open = false;
    let pending: Promise<boolean> | undefined;
    try {
      expect(admitSession.role).toBe('league_one_runtime');
      // Start the short approval only after connection setup has finished.
      await reconfigure({ expiresAt: new Date(Date.now() + 5_000).toISOString() });
      const selected = await createPublicDataRefreshStore(connection.database).select(owner.fence);
      if (selected.status !== 'selected') throw new Error('Missing expiring race selection.');
      const intake = createPublicIntakeStore(admitting.database);
      const work = await intake.next(selected.requestId);
      if (typeof work === 'string') throw new Error('Missing expiring race work.');
      await blocker.database.query('BEGIN'); open = true;
      await blocker.database.query('SELECT id FROM public.public_data_refresh_targets WHERE id=$1 FOR UPDATE', [targetId]);
      pending = intake.admit(work, owner.fence);
      const settled = pending.then(value => ({ value }), error => ({ error }));
      await expectBlocked(admitSession.pid, ownerSession.pid);
      await delay(Math.max(0, Date.parse(configuration.expiresAt) - Date.now()) + 100);
      expect((await ownerQuery('SELECT clock_timestamp()<$1::timestamptz AS live', [owner.fence.deadlineAt]))[0].live).toBe(true);
      await blocker.database.query('ROLLBACK'); open = false;
      expect(await settled).toEqual({ value: false });
      expect(await connection.database.query('SELECT * FROM public.public_data_dispatches WHERE worker_id=$1 AND generation=$2',
        [owner.fence.workerId, owner.fence.generation])).toEqual([]);
    } finally {
      if (open) await blocker.database.query('ROLLBACK');
      await pending?.catch(() => undefined);
      await owner.jobs.failJob(PUBLIC_INTAKE_JOB, owner.fence.workerId, 'observed approval expiry at admission lock');
      await admitting.close(); await blocker.close();
      await reconfigure({ expiresAt: new Date(Date.now() + 60 * 60_000).toISOString() });
    }
  });

  it('retains a real admitted capture when a competing pause waits for that admission to commit', async () => {
    // The interval is the real durable admission interval, outside any job claim.
    const [due] = await connection.database.query("SELECT greatest(0,extract(epoch FROM max(admitted_at)+interval '61 seconds'-clock_timestamp())) AS seconds FROM public.public_data_dispatches");
    if (Number(due.seconds) > 0) await delay(Number(due.seconds) * 1_000);
    const admitting = await createPinnedIntegrationDatabase('runtime');
    const pauser = await createPinnedIntegrationDatabase('runtime');
    const owner = await claim();
    let open = false;
    let pending: ReturnType<ReturnType<typeof createPublicDataRefreshStore>['configure']> | undefined;
    const capture = vi.spyOn(globalThis, 'fetch').mockImplementation(async input => {
      if (String(input).endsWith(`/user/${nativeManager}`)) return new Response(JSON.stringify({ user_id: nativeManager, username: 'admission_race_manager' }));
      throw new Error('Unexpected admission race fixture source scope.');
    });
    try {
      const selected = await createPublicDataRefreshStore(connection.database).select(owner.fence);
      if (selected.status !== 'selected') throw new Error('Missing admission-first selection.');
      const intake = createPublicIntakeStore(admitting.database);
      const work = await intake.next(selected.requestId);
      if (typeof work === 'string' || work.kind !== 'identity') throw new Error('Admission race requires the untouched first-cycle identity step.');
      await pauser.database.query("SET statement_timeout='8s'");
      await admitting.database.query("SET statement_timeout='8s'");
      const [admitSession] = await admitting.database.query('SELECT pg_backend_pid() AS pid,session_user AS role');
      const [pauseSession] = await pauser.database.query('SELECT pg_backend_pid() AS pid,session_user AS role');
      expect([admitSession.role, pauseSession.role]).toEqual(['league_one_runtime', 'league_one_runtime']);
      await admitting.database.query('BEGIN'); open = true;
      expect(await intake.admit(work, owner.fence)).toBe(true);
      const input = { ...configuration, expectedRevision: revision, paused: true };
      pending = createPublicDataRefreshStore(pauser.database).configure(input);
      const settled = pending.then(value => ({ value }), error => ({ error }));
      await expectBlocked(pauseSession.pid, admitSession.pid);
      await admitting.database.query('COMMIT'); open = false;
      const configured = await settled;
      if (!('value' in configured)) throw configured.error;
      revision = configured.value.configurationRevision; configuration = input;
      // Acquisition and checkpoint remain bound to the already admitted owner;
      // pausing prevents new admission but cannot rewrite this original fence.
      const document = await capturePublicSleeperIdentity(work.username, AbortSignal.timeout(Math.max(1, Date.parse(owner.fence.deadlineAt) - Date.now())));
      await intake.recordIdentity(work, document, owner.fence);
      expect(await intake.next(selected.requestId)).toMatchObject({ kind: 'leagues' });
      expect(await connection.database.query('SELECT outcome FROM public.public_data_dispatch_outcomes WHERE worker_id=$1 AND generation=$2',
        [owner.fence.workerId, owner.fence.generation])).toEqual([{ outcome: 'checkpoint-committed' }]);
      expect(await connection.database.query('SELECT * FROM public.public_data_refresh_selection_failures WHERE worker_id=$1 AND generation=$2',
        [owner.fence.workerId, owner.fence.generation])).toEqual([]);
    } finally {
      if (open) await admitting.database.query('ROLLBACK');
      await pending?.catch(() => undefined);
      capture.mockRestore();
      await owner.jobs.failJob(PUBLIC_INTAKE_JOB, owner.fence.workerId, 'observed admission-before-pause barrier');
      await pauser.close(); await admitting.close();
      await reconfigure({ paused: false });
    }
  }, 100_000);

  const refreshHistoryTables = ['public_data_refresh_configurations', 'public_data_refresh_cycles',
    'public_data_refresh_cycle_outcomes', 'public_data_refresh_selection_failures'] as const;
  async function retainedRefreshHistory() {
    return Promise.all(refreshHistoryTables.map(async table => ({ table,
      rows: await connection.database.query(`SELECT * FROM public.${table} WHERE target_id=$1 ORDER BY to_jsonb(${table})::text`, [targetId]) })));
  }
  async function expectRetainedRefreshHistory(previous: Awaited<ReturnType<typeof retainedRefreshHistory>>) {
    for (const { table, rows } of previous) {
      const current = await connection.database.query(`SELECT * FROM public.${table} WHERE target_id=$1`, [targetId]);
      // New cycles/configurations may append rows; every original full row,
      // including source revision, times and disposition, must remain identical.
      expect(current).toEqual(expect.arrayContaining([...rows]));
    }
  }

  it('refreshes two typed core cycles with real admission spacing, a correction and lost-checkpoint replay [focused slow SQL]', async () => {
    const database = connection.database;
    const administration = createLeagueAdministrationStore(database);
    const intake = createPublicIntakeStore(database);
    const jobs = createProjectionStore(database);
    const refresh = createPublicDataRefreshStore(database);
    if (!revision) revision = (await refresh.configure(configuration)).configurationRevision;
    const native = String(retainedLeague.league_id);
    const originalLeague = retainedLeague;
    const originalRefreshHistory = await retainedRefreshHistory();
    let cycleNumber = 1;
    let lostCheckpoint = false;
    let lostAdmissionAck = false;
    let pausedDuringCapture = false;
    let restoreApproval = false;
    const rawLeague = () => ({ ...originalLeague, scoring_settings: { rec_yd: cycleNumber === 1 ? 0.13 : 0.17, unsupported_bonus: 2 } });
    const rawRoster = () => [{ roster_id: 1, owner_id: cycleNumber === 1 ? '555' : '558', co_owners: [cycleNumber === 1 ? '556' : '557'],
      players: [cycleNumber === 1 ? '123' : '456'], starters: [cycleNumber === 1 ? '123' : '456'], reserve: [], taxi: [] }];
    const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(async input => {
      const url = String(input);
      if (url.endsWith(`/user/${nativeManager}`)) return new Response(JSON.stringify({ user_id: nativeManager, username: `refresh_manager_${cycleNumber}` }));
      if (url.endsWith(`/user/${nativeManager}/leagues/nfl/2181`)) return new Response(JSON.stringify([rawLeague()]));
      if (url.endsWith(`/league/${native}`)) return new Response(JSON.stringify(rawLeague()));
      if (url.endsWith(`/league/${native}/rosters`)) return new Response(JSON.stringify(rawRoster()));
      if (url.endsWith(`/league/${native}/users`)) return new Response(JSON.stringify(['555','556','557','558'].map(user_id => ({ user_id, display_name: user_id }))));
      throw new Error('Unexpected recurring source scope.');
    });
    const receiptIds: string[][] = [];
    const immutableReceipts: DatabaseRow[][] = [];
    const seenRequests: string[] = [];
    try {
      const until = Date.now() + 18 * 60_000;
      while (Date.now() < until && seenRequests.length < 2) {
        if (restoreApproval) { await reconfigure({ paused: false }); restoreApproval = false; }
        const outcome = await runPublicDataRefreshStep({ refresh, administration, jobs, managerEvidenceVersion: 'v2',
          intake: { ...intake,
            admit: async (work, fence) => {
              const admitted = await intake.admit(work, fence);
              if (admitted && !lostAdmissionAck) { lostAdmissionAck = true; throw new Error('synthetic admission acknowledgement lost after commit'); }
              if (admitted && !pausedDuringCapture) { await reconfigure({ paused: true }); pausedDuringCapture = true; restoreApproval = true; }
              return admitted;
            },
            completeCore: async (work, mapping, captured, fence) => {
              if (cycleNumber === 2 && work.kind === 'core' && !lostCheckpoint) { lostCheckpoint = true; throw new Error('synthetic recurring core checkpoint lost'); }
              await intake.completeCore(work, mapping, captured, fence);
            } },
        }, AbortSignal.timeout(20_000));
        expect(['progress','busy','backoff','idle','unavailable','complete','partial']).toContain(outcome.status);
        const cycles = await database.query(`SELECT cycle.cycle,cycle.intake_id,request.terminal
          FROM public.public_data_refresh_cycles cycle JOIN public.public_data_intakes request ON request.id=cycle.intake_id
          WHERE cycle.target_id=$1 ORDER BY cycle.cycle`, [targetId]);
        for (const cycle of cycles) {
          const requestId = String(cycle.intake_id);
          if (!cycle.terminal || seenRequests.includes(requestId)) continue;
          const read = await readPublicSleeperIntake(database, administration, requestId, { managerEvidenceVersion: 'v2' });
          expect(read.status).toBe('available');
          if (read.status === 'missing') throw new Error('Missing recurring readback.');
          expect(read.leagues[0].resources).toMatchObject({ settings: { status: 'available' }, heldRoster: { status: 'available',
            teams: [{ players: [{ sourceEntity: { nativeId: cycleNumber === 1 ? '123' : '456' } }] }] },
            teamManagers: { status: 'available', teams: [{ primaryOwner: { manager: { sourceManager: { nativeId: cycleNumber === 1 ? '555' : '558' } } } }] },
            teamManagerEvidence: { status: 'available' }, directory: { status: 'available' } });
          const [captured] = await database.query('SELECT settings_receipt_id,players_receipt_id,managers_receipt_id FROM public.public_data_league_candidates WHERE intake_id=$1', [requestId]);
          const ids = Object.values(captured).map(String);
          receiptIds.push(ids);
          immutableReceipts.push([...await database.query('SELECT * FROM public.league_roster_capture_receipts WHERE id=ANY($1::uuid[]) ORDER BY id', [ids])]);
          seenRequests.push(requestId);
          cycleNumber = 2;
        }
        if (seenRequests.length < 2) await delay(1_000);
      }
      expect(seenRequests).toHaveLength(2);
      expect(new Set(seenRequests).size).toBe(2);
      expect(lostAdmissionAck).toBe(true);
      expect(pausedDuringCapture).toBe(true);
      expect(lostCheckpoint).toBe(true);
      await expectRetainedRefreshHistory(originalRefreshHistory);
      expect(receiptIds[1].some(id => receiptIds[0].includes(id))).toBe(false);
      expect(await database.query('SELECT * FROM public.league_roster_capture_receipts WHERE id=ANY($1::uuid[]) ORDER BY id', [receiptIds[0]])).toEqual(immutableReceipts[0]);
      const [spacing] = await database.query(`SELECT bool_and(gap>=interval '60 seconds') AS bounded FROM (
        SELECT admitted_at-lag(admitted_at) OVER (ORDER BY admitted_at) AS gap FROM public.public_data_dispatches) spacing`);
      expect(spacing.bounded).toBe(true);
      const [cursor] = await database.query(`SELECT target.last_served_at=(SELECT max(dispatch.admitted_at) FROM public.public_data_dispatches dispatch
        JOIN public.public_data_refresh_cycles cycle ON cycle.intake_id=dispatch.intake_id WHERE cycle.target_id=target.id) AS exact_admission
        FROM public.public_data_refresh_targets target WHERE target.id=$1`, [targetId]);
      expect(cursor.exact_admission).toBe(true);
      expect(await database.query(`SELECT failure.* FROM public.public_data_refresh_selection_failures failure
        JOIN public.public_data_dispatches dispatch USING(worker_id,generation) WHERE failure.reason='admission-unconfirmed'`)).toHaveLength(0);
    } finally { fetch.mockRestore(); }
  }, 19 * 60_000);

  it('retains two empty-list cycles without relabeling previous typed data or replaying missed cadence slots [focused slow SQL]', async () => {
    const database = connection.database;
    const refresh = createPublicDataRefreshStore(database);
    if (!revision) revision = (await refresh.configure(configuration)).configurationRevision;
    const administration = createLeagueAdministrationStore(database);
    const prior = await database.query(`SELECT cycle.intake_id FROM public.public_data_refresh_cycles cycle
      JOIN public.public_data_intakes request ON request.id=cycle.intake_id WHERE cycle.target_id=$1 AND request.terminal`, [targetId]);
    const priorRefreshHistory = await retainedRefreshHistory();
    const completed = new Set(prior.map(row => String(row.intake_id)));
    const newCycles: string[] = [];
    const capture = vi.spyOn(globalThis, 'fetch').mockImplementation(async input => {
      const url = String(input);
      if (url.endsWith(`/user/${nativeManager}`)) return new Response(JSON.stringify({ user_id: nativeManager, username: 'empty_cycle_manager' }));
      if (url.endsWith(`/user/${nativeManager}/leagues/nfl/2181`)) return new Response('[]');
      throw new Error('Unexpected source in empty-list recurrence oracle.');
    });
    try {
      const until = Date.now() + 8 * 60_000;
      while (Date.now() < until && newCycles.length < 2) {
        const result = await runPublicDataRefreshStep({ refresh, administration, intake: createPublicIntakeStore(database), jobs: createProjectionStore(database) }, AbortSignal.timeout(20_000));
        expect(['progress','busy','backoff','idle','complete']).toContain(result.status);
        const rows = await database.query(`SELECT cycle.intake_id FROM public.public_data_refresh_cycles cycle
          JOIN public.public_data_intakes request ON request.id=cycle.intake_id WHERE cycle.target_id=$1 AND request.terminal ORDER BY cycle.cycle`, [targetId]);
        for (const row of rows) {
          const requestId = String(row.intake_id);
          if (completed.has(requestId)) continue;
          const read = await readPublicSleeperIntake(database, administration, requestId);
          expect(read).toMatchObject({ status: 'available', leagues: [], rejected: [] });
          completed.add(requestId); newCycles.push(requestId);
        }
        if (newCycles.length < 2) await delay(1_000);
      }
      expect(newCycles).toHaveLength(2);
      expect(new Set(newCycles).size).toBe(2);
      await expectRetainedRefreshHistory(priorRefreshHistory);
      const [cadence] = await database.query(`SELECT bool_and(outcome.next_due_at>outcome.recorded_at
        AND outcome.next_due_at<=outcome.recorded_at+interval '60 seconds') AS skips_missed
        FROM public.public_data_refresh_cycle_outcomes outcome WHERE outcome.target_id=$1`, [targetId]);
      expect(cadence.skips_missed).toBe(true);
      const read = await readPublicDataRefresh(database, administration, targetId);
      expect(read).toMatchObject({ status: 'available', cycle: { requestId: newCycles[1] }, intake: { status: 'available', leagues: [] } });
    } finally { capture.mockRestore(); }
  }, 9 * 60_000);
  it('refuses owner UPDATE and DELETE of existing immutable refresh history and preserves later-cycle rows', async () => {
    // This intentionally uses the owner LOGIN so an ACL rejection cannot stand
    // in for the immutable-history trigger. All attempts are rolled back even
    // if an absent guard unexpectedly permits a mutation.
    const owner = await createPinnedIntegrationDatabase('owner');
    let open = false;
    try {
      const [role] = await owner.database.query('SELECT session_user AS role,current_user AS effective_role');
      expect(role.role).toBe(role.effective_role);
      expect(role.role).not.toBe('league_one_runtime');
      await owner.database.query('BEGIN'); open = true;
      for (const table of refreshHistoryTables) {
        const before = await owner.database.query(`SELECT * FROM public.${table} WHERE target_id=$1 ORDER BY to_jsonb(${table})::text`, [targetId]);
        expect(before.length, `${table} requires an actual retained row from the preceding SQL cases.`).toBeGreaterThan(0);
        const column = table === 'public_data_refresh_configurations' ? 'configured_at'
          : table === 'public_data_refresh_cycles' ? 'created_at' : 'recorded_at';
        for (const statement of [`UPDATE public.${table} SET ${column}=${column}+interval '1 second' WHERE target_id=$1`,
          `DELETE FROM public.${table} WHERE target_id=$1`]) {
          await owner.database.query('SAVEPOINT immutable_refresh_attempt');
          try { await expect(owner.database.query(statement, [targetId])).rejects.toThrow('league administration history is immutable'); }
          finally {
            await owner.database.query('ROLLBACK TO SAVEPOINT immutable_refresh_attempt');
            await owner.database.query('RELEASE SAVEPOINT immutable_refresh_attempt');
          }
          expect(await owner.database.query(`SELECT * FROM public.${table} WHERE target_id=$1 ORDER BY to_jsonb(${table})::text`, [targetId])).toEqual(before);
        }
        expect(await connection.database.query(`SELECT * FROM public.${table} WHERE target_id=$1 ORDER BY to_jsonb(${table})::text`, [targetId])).toEqual(before);
      }
    } finally {
      if (open) await owner.database.query('ROLLBACK');
      await owner.close();
    }
  });

  it('shares the existing sixteen-pending-request limit with manual submissions without spending admission credit', async () => {
    const database = connection.database;
    const refresh = createPublicDataRefreshStore(database);
    if (!revision) revision = (await refresh.configure(configuration)).configurationRevision;
    // Observe terminal completion once, then wait the real next cadence without
    // holding a job, database transaction or extended work fence.
    const settlement = await claim();
    try { await refresh.select(settlement.fence); }
    finally { await settlement.jobs.failJob(PUBLIC_INTAKE_JOB, settlement.fence.workerId, 'capacity fixture cadence observation'); }
    const [due] = await database.query('SELECT greatest(0,extract(epoch FROM next_due_at-clock_timestamp())) AS seconds FROM public.public_data_refresh_targets WHERE id=$1', [targetId]);
    await delay(Number(due.seconds) * 1_000 + 100);
    await reconfigure({ paused: true });
    const runtime = await createPinnedIntegrationDatabase('runtime');
    const owner = await claim(runtime.database);
    let open = false;
    try {
      await runtime.database.query('BEGIN'); open = true;
      const bound = createPublicDataRefreshStore(runtime.database);
      // Acquire job/capacity in the maintained order before filling the pending
      // queue. Any selected current request is retained, never reset for this test.
      expect(await bound.select(owner.fence)).toMatchObject({ status: 'idle' });
      const [before] = await runtime.database.query('SELECT count(*)::integer AS count FROM public.public_data_intakes WHERE NOT terminal');
      const intake = createPublicIntakeStore(runtime.database);
      for (let index = Number(before.count); index < 16; index++) {
        await intake.submit({ id: randomUUID(), username: `capacity_fixture_${index}`, seasons: [2199] });
      }
      await runtime.database.query('SAVEPOINT pending_limit');
      await expect(intake.submit({ id: randomUUID(), username: 'seventeenth_pending_fixture', seasons: [2199] })).rejects.toThrow('capacity reached');
      await runtime.database.query('ROLLBACK TO SAVEPOINT pending_limit');
      await runtime.database.query('RELEASE SAVEPOINT pending_limit');
      expect((await runtime.database.query('SELECT count(*)::integer AS count FROM public.public_data_intakes WHERE NOT terminal'))[0].count).toBe(16);
      await bound.configure({ ...configuration, expectedRevision: revision, paused: false });
      expect(await bound.select(owner.fence)).toMatchObject({ status: 'capacity' });
      expect((await runtime.database.query('SELECT count(*)::integer AS count FROM public.public_data_intakes WHERE NOT terminal'))[0].count).toBe(16);
      expect(await runtime.database.query('SELECT * FROM public.public_data_dispatches WHERE worker_id=$1 AND generation=$2',
        [owner.fence.workerId, owner.fence.generation])).toHaveLength(0);
      await runtime.database.query('ROLLBACK'); open = false;
    } finally {
      if (open) await runtime.database.query('ROLLBACK');
      await owner.jobs.failJob(PUBLIC_INTAKE_JOB, owner.fence.workerId, 'rolled back manual/recurring capacity fixture');
      await runtime.close();
      await reconfigure({ paused: false });
    }
  }, 150_000);

  it('counts paused synthetic metadata targets toward the total16 bound using a genuine restricted configure call', async () => {
    // OWNER SETUP ONLY: synthetic identity and paused-target metadata isolates
    // this negative count boundary. It is NOT ingestion, admission or resource
    // proof. It inserts no typed acceptance, capture receipt, dispatch, or outcome
    // and changes neither the limit nor the real clock. The separate coordinator
    // case above supplies actual normalizer→writer→reader acquisition proof.
    const owner = await createPinnedIntegrationDatabase('owner');
    let open = false;
    let spareIdentity = '';
    try {
      await owner.database.query('BEGIN'); open = true;
      const [count] = await owner.database.query('SELECT count(*)::integer AS count FROM public.public_data_refresh_targets');
      for (let index = Number(count.count); index <= 16; index++) {
        const identity = randomUUID(); const manager = randomUUID(); const target = randomUUID();
        const native = `8${BigInt(`0x${randomUUID().replaceAll('-', '').slice(0, 15)}`)}`;
        await owner.database.query('INSERT INTO public.league_source_manager_accounts(id,provider,external_manager_id) VALUES($1,\'sleeper\',$2)', [manager, native]);
        await owner.database.query("INSERT INTO public.public_data_intakes(id,username,seasons,terminal) VALUES($1,$2,ARRAY[2199],true)", [identity, native]);
        await owner.database.query(`INSERT INTO public.public_data_identity_observations(intake_id,source_manager_account_id,username,display_name,
          payload,request_started_at,request_completed_at) VALUES($1,$2,$3,$3,jsonb_build_object('user_id',$3::text,'username',$3::text),clock_timestamp(),clock_timestamp())`,
        [identity, manager, native]);
        if (index === 16) { spareIdentity = identity; continue; }
        await owner.database.query("INSERT INTO public.public_data_refresh_targets(id,provider,source_manager_account_id,configuration_revision) VALUES($1,'sleeper',$2,1)", [target, manager]);
        await owner.database.query(`INSERT INTO public.public_data_refresh_configurations(target_id,revision,identity_request_id,seasons,cadence_seconds,expires_at,paused)
          VALUES($1,1,$2,ARRAY[2199],60,clock_timestamp()+interval '1 hour',true)`, [target, identity]);
      }
      await owner.database.query('COMMIT'); open = false;
    } finally { if (open) await owner.database.query('ROLLBACK'); await owner.close(); }
    expect((await connection.database.query('SELECT count(*)::integer AS count FROM public.public_data_refresh_targets'))[0].count).toBe(16);
    expect((await connection.database.query('SELECT session_user AS role'))[0].role).toBe('league_one_runtime');
    await expect(createPublicDataRefreshStore(connection.database).configure({ id: randomUUID(), expectedRevision: 0,
      identityRequestId: spareIdentity, seasons: [2199], cadenceSeconds: 60, expiresAt: new Date(Date.now() + 60_000).toISOString(), paused: true }))
      .rejects.toThrow('target capacity reached');
    expect((await connection.database.query('SELECT count(*)::integer AS count FROM public.public_data_refresh_targets'))[0].count).toBe(16);
  }, 90_000);
});


/** R037 AUTHORED / UNEXECUTED. The optional-field matrix uses one explicitly
 * owner-enrolled synthetic NULL-profile identity; this is writer/reader proof,
 * not a substitute for the separate genuinely admitted bootstrap recovery case. */
describe('official preconfiguration source normalization to restricted typed storage', () => {
  let connection: IndependentDatabase;
  beforeAll(() => { connection = createIndependentDatabase(); });
  afterAll(async () => connection.close());
  it('recovers the same NULL-profile identity after canonical registration commits before the bootstrap checkpoint [focused slow SQL]', async () => {
    // Real identity/list/bootstrap/core/directory admissions plus one retry:
    // at least five60-second gaps, possibly one initial interval. No fake clock,
    // skipped admission, owner enrollment, or fabricated accepted resource.
    const database = connection.database;
    expect((await database.query('SELECT session_user AS role'))[0].role).toBe('league_one_runtime');
    const [capacity] = await database.query(`SELECT (SELECT count(*) FROM league_administration_enrollments)
      +(SELECT count(*) FROM public_data_collection_reservations reservation WHERE NOT EXISTS(
        SELECT 1 FROM league_source_connections connection JOIN league_seasons season ON season.id=connection.league_season_id
        JOIN league_administration_enrollments enrollment ON enrollment.league_id=season.league_id
        WHERE connection.provider='sleeper' AND connection.external_league_id=reservation.external_league_id)) AS used`);
    expect(Number(capacity.used), 'Fresh official registration requires one genuine isolated collection slot.').toBeLessThan(16);
    const id = randomUUID();
    const native = `4${BigInt(`0x${randomUUID().replaceAll('-', '').slice(0, 15)}`)}`;
    const season = 2193;
    const league = { league_id: native, season: String(season), sport: 'nfl', name: 'Fresh unconfigured DATA league', total_rosters: 1, settings: {} };
    const roster = [{ roster_id: 1, owner_id: native, co_owners: [], players: [], starters: [], reserve: [], taxi: [] }];
    const intake = createPublicIntakeStore(database);
    const jobs = createProjectionStore(database);
    const administration = createLeagueAdministrationStore(database);
    const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(async input => {
      const url = String(input);
      if (url.endsWith(`/user/official_recovery_${native}`)) return new Response(JSON.stringify({ user_id: native, username: `official_${native}` }));
      if (url.endsWith(`/user/${native}/leagues/nfl/${season}`)) return new Response(JSON.stringify([league]));
      if (url.endsWith(`/league/${native}`)) return new Response(JSON.stringify(league));
      if (url.endsWith(`/league/${native}/rosters`)) return new Response(JSON.stringify(roster));
      if (url.endsWith(`/league/${native}/users`)) return new Response(JSON.stringify([{ user_id: native, display_name: 'Official preconfiguration manager' }]));
      throw new Error('Unexpected official registration recovery source scope.');
    });
    if (!database.queryAfterLock) throw new Error('Actual fenced registration transaction is required.');
    const locked = database.queryAfterLock.bind(database);
    let interrupted = false;
    const interruptedDatabase: DatabaseClient = { ...database,
      queryAfterLock: async <Row extends DatabaseRow = DatabaseRow>(...args: Parameters<NonNullable<DatabaseClient['queryAfterLock']>>) => {
        const rows = await locked<Row>(...args);
        if (!interrupted && args[0].includes('projection-store:register-league-season')) {
          interrupted = true; throw new Error('canonical identity committed; bootstrap checkpoint not reached');
        }
        return rows;
      } };
    const dependencies = { intake, jobs, administration };
    const progress = async (selected = dependencies) => {
      const deadline = Date.now() + 155_000;
      while (Date.now() < deadline) {
        const result = await runPublicIntakeStep(id, selected, AbortSignal.timeout(20_000));
        if (!['busy', 'backoff'].includes(result.status)) return result;
        await delay(1_000);
      }
      throw new Error('Real official registration admission did not become due.');
    };
    const identity = () => database.query(`SELECT league.id AS league_id,season.id AS league_season_id,season.scoring_profile_id,
      connection.id AS connection_id,connection.current_mapping_revision_id FROM leagues league
      JOIN league_seasons season ON season.league_id=league.id
      JOIN league_source_connections connection ON connection.league_season_id=season.id
      WHERE league.league_key=$1 AND season.season=$2 AND connection.provider='sleeper'`, [`sleeper-${native}`, season]);
    try {
      await intake.submit({ id, username: `official_recovery_${native}`, seasons: [season] });
      for (const resource of ['identity', 'leagues']) expect(await progress()).toMatchObject({ status: 'progress', resource });
      expect(await progress({ ...dependencies, intake: createPublicIntakeStore(interruptedDatabase) }))
        .toMatchObject({ status: 'unavailable', resource: 'bootstrap' });
      expect(interrupted).toBe(true);
      const committed = await identity();
      expect(committed).toHaveLength(1);
      expect(committed[0].scoring_profile_id).toBeNull();
      expect(await database.query('SELECT * FROM public_data_collection_reservations WHERE external_league_id=$1', [native])).toHaveLength(1);
      expect((await database.query('SELECT league_season_id,bootstrap_payload FROM public_data_league_candidates WHERE intake_id=$1', [id]))[0])
        .toMatchObject({ league_season_id: null, bootstrap_payload: null });
      for (const resource of ['bootstrap', 'core', 'users']) expect(await progress()).toMatchObject({ status: 'progress', resource });
      expect(await identity()).toEqual(committed);
      const read = await readPublicSleeperIntake(database, administration, id);
      expect(read).toMatchObject({ status: 'available', leagues: [{ resources: {
        settings: { status: 'available', value: { scoring: { rules: { state: 'absent', value: null } }, slots: { state: 'absent', value: null } } },
        heldRoster: { status: 'available' }, teamManagers: { status: 'available' }, directory: { status: 'available' } } }] });
      expect(await database.query(`SELECT active,evidence FROM league_administration_enrollments WHERE league_id=$1`, [committed[0].league_id]))
        .toEqual([{ active: false, evidence: 'public-data-intake-v1' }]);
      expect((await administration.listEnrollmentInventory(season)).entries.some(entry => entry.intended.leagueId === committed[0].league_id)).toBe(false);
      expect(await database.query('SELECT * FROM league_period_authorities WHERE league_key=$1', [`sleeper-${native}`])).toEqual([]);
      const [counts] = await database.query(`SELECT count(*)::integer AS attempts,count(DISTINCT worker_id||':'||generation)::integer AS owners
        FROM public_data_dispatches WHERE intake_id=$1 AND resource='bootstrap'`, [id]);
      expect(counts).toEqual({ attempts: 2, owners: 2 });
    } finally { fetch.mockRestore(); }
  }, 10 * 60_000);

  it('retains all nine missing/null/empty scoring and slot combinations, rejects malformed fields and versions later rules', async () => {
    const database = connection.database;
    expect((await database.query('SELECT session_user AS role'))[0].role).toBe('league_one_runtime');
    const store = createProjectionStore(database);
    const administration = createLeagueAdministrationStore(database);
    const native = `7${BigInt(`0x${randomUUID().replaceAll('-', '').slice(0, 15)}`)}`;
    const season = 2194;
    const registered = await store.registerLeagueSeason({ mode: 'official-data', leagueKey: `sleeper-${native}`,
      leagueName: 'Official preconfiguration matrix', sleeperLeagueId: native, season });
    if (registered.kind !== 'stored') throw new Error('Official registration unavailable.');
    expect(registered.value.scoringProfileId).toBeNull();
    // Explicit immutable metadata setup only. Neither accepted content nor
    // capture/acceptance/dispatch rows are fabricated by the fixture owner.
    await ownerQuery(`INSERT INTO league_administration_enrollments(league_id,provider,active,evidence)
      VALUES($1,'sleeper',false,'public-data-intake-v1')`, [registered.value.leagueId]);
    await ownerQuery(`INSERT INTO league_administration_enrollment_seasons(league_id,season,provider,evidence)
      VALUES($1,$2,'sleeper','public-data-intake-v1')`, [registered.value.leagueId, season]);
    const mapping = await administration.readSourceMapping(native);
    if (!mapping) throw new Error('Missing official-only source mapping.');
    let payload: Record<string, unknown> = { league_id: native, season: String(season), sport: 'nfl',
      name: 'Official preconfiguration matrix', settings: {}, total_rosters: 1 };
    const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(async input => {
      if (String(input).endsWith(`/league/${native}`)) return new Response(JSON.stringify(payload));
      throw new Error('Unexpected preconfiguration matrix source scope.');
    });
    const write = async () => {
      const attempt = await administration.beginLeagueSettingsAttempt(mapping, randomUUID());
      const document = await capturePublicSleeperCore(native, 'league', new AbortController().signal);
      return recordCapturedAdministration(mapping.scope, [document], { store: administration, mapping, leagueSettingsAttempt: attempt });
    };
    const profileSnapshot = () => database.query('SELECT id,rules_hash,rules FROM scoring_profiles ORDER BY id');
    const profiles = await profileSnapshot();
    const acceptedReceipts: string[] = [];
    try {
      for (const scoring of ['absent', 'null', 'empty'] as const) {
        for (const slots of ['absent', 'null', 'empty'] as const) {
          delete payload.scoring_settings; delete payload.roster_positions;
          if (scoring !== 'absent') payload.scoring_settings = scoring === 'null' ? null : {};
          if (slots !== 'absent') payload.roster_positions = slots === 'null' ? null : [];
          const result = await write();
          expect(result.results[0].result.leagueSettingsAcceptance?.status).toBe('accepted');
          const read = await administration.readAcceptedLeagueSettings(mapping);
          if (read.status !== 'available') throw new Error(`Missing official settings ${scoring}/${slots}.`);
          expect(read.value.scoring.rules.state).toBe(scoring);
          expect(read.value.slots.state).toBe(slots);
          expect(read.value.scoring.rules.value).toEqual(scoring === 'empty' ? {} : null);
          expect(read.value.slots.value).toEqual(slots === 'empty' ? [] : null);
          acceptedReceipts.push(read.receipt.id);
          expect(read.receipt.provenance.origin).toBe('network');
          expect((await database.query('SELECT scoring_profile_id FROM league_seasons WHERE id=$1', [registered.value.leagueSeasonId]))[0])
            .toEqual({ scoring_profile_id: null });
        }
      }
      expect(new Set(acceptedReceipts).size).toBe(9);
      expect(await profileSnapshot()).toEqual(profiles);
      const immutableReceipts = await database.query('SELECT * FROM league_roster_capture_receipts WHERE id=ANY($1::uuid[]) ORDER BY id', [acceptedReceipts]);
      const acceptedBeforeInvalid = await database.query(`SELECT head.scope_id,head.accepted_id FROM league_roster_resource_heads head
        JOIN league_roster_resource_scopes scope ON scope.id=head.scope_id WHERE scope.league_season_id=$1 ORDER BY head.scope_id`, [registered.value.leagueSeasonId]);
      for (const invalid of [{ scoring_settings: [] }, { scoring_settings: { pass_td: '4' } },
        { roster_positions: {} }, { roster_positions: [null] }]) {
        payload = { league_id: native, season: String(season), sport: 'nfl', name: 'Invalid preconfiguration',
          settings: {}, total_rosters: 1, ...invalid };
        const result = await write();
        expect(result.results[0].result.leagueSettingsAcceptance?.status).not.toBe('accepted');
        expect(await database.query(`SELECT head.scope_id,head.accepted_id FROM league_roster_resource_heads head
          JOIN league_roster_resource_scopes scope ON scope.id=head.scope_id WHERE scope.league_season_id=$1 ORDER BY head.scope_id`, [registered.value.leagueSeasonId])).toEqual(acceptedBeforeInvalid);
      }
      payload = { league_id: native, season: String(season), sport: 'nfl', name: 'Configured later official evidence',
        settings: {}, total_rosters: 1, scoring_settings: { pass_td: 7.037, rec: 0 }, roster_positions: ['QB', 'BN'] };
      const later = await write();
      expect(later.results[0].result.leagueSettingsAcceptance?.status).toBe('accepted');
      const read = await administration.readAcceptedLeagueSettings(mapping);
      expect(read).toMatchObject({ status: 'available', value: { scoring: { rules: { state: 'known', value: payload.scoring_settings } },
        slots: { state: 'known' } }, comparison: { legacyConfiguration: 'rejected' } });
      expect((await database.query('SELECT scoring_profile_id FROM league_seasons WHERE id=$1', [registered.value.leagueSeasonId]))[0])
        .toEqual({ scoring_profile_id: null });
      expect(await database.query(`SELECT version.scoring_profile_id FROM league_configuration_versions version
        JOIN scoring_profiles profile ON profile.id=version.scoring_profile_id
        WHERE version.league_season_id=$1 AND profile.rules=$2::jsonb`, [registered.value.leagueSeasonId, JSON.stringify(payload.scoring_settings)]))
        .toHaveLength(1);
      expect(await database.query('SELECT * FROM league_roster_capture_receipts WHERE id=ANY($1::uuid[]) ORDER BY id', [acceptedReceipts])).toEqual(immutableReceipts);
      expect((await administration.listEnrollmentInventory(season)).entries.some(entry => entry.intended.leagueId === registered.value.leagueId)).toBe(false);
    } finally { fetch.mockRestore(); }
  });
});
