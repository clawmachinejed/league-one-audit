import { createHash, randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import type { ChildProcess } from 'node:child_process';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { DatabaseRow } from '../lib/database';
import { createLeagueAdministrationStore, createPublicIntakeStore, createPublicDataRefreshStore } from '../lib/league-administration/store';
import { runPublicIntakeStep } from '../lib/league-administration/public-intake';
import { readPublicSleeperIntake } from '../lib/league-administration/public-intake-reader';
import { readPublicDataRefresh } from '../lib/league-administration/public-refresh-reader';
import { PUBLIC_DRAFT_PICKS, PUBLIC_INTAKE_JOB } from '../lib/league-administration/public-intake-contracts';
import { createProjectionStore } from '../lib/projection-store';
import { createIndependentDatabase, createPinnedIntegrationDatabase, integrationEnvironment, ownerQuery, type IndependentDatabase } from './neon-integration-harness';
import { spawnIntegrationWorker, stopIntegrationChildTree, verifyIntegrationChildTreeClosed } from './integration-child-process';
import { assertProcessRecoverySupportSources, qualificationBinding, PROCESS_RECOVERY_TESTS, type QualificationBinding } from './qualification-profile';
import { fixtureFetch, recoveryFixture, recoveryWorkerEnvironment, recoveryStartMessage, parseRecoveryMessage, PROCESS_RECOVERY_VERSION,
  type RecoveryBarrier, type RecoveryMessage, type RecoveryWorkerConfig } from './process-recovery-protocol';

type Worker = { child: ChildProcess; config: RecoveryWorkerConfig; messages: RecoveryMessage[]; ready?: RecoveryMessage;
  closed: Promise<void>; isClosed: boolean; error?: Error; exitCode: number | null; signal: NodeJS.Signals | null };
type Death = { message: RecoveryMessage; before: readonly DatabaseRow[]; heads: readonly DatabaseRow[]; proof: Record<string, unknown> };
const siteRoot = fileURLToPath(new URL('..', import.meta.url));
const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');

/** CP22 AUTHORED / HOSTED SQL UNQUALIFIED. Seven actual OS deaths, sequential
 * replacements, original20s/25s/60s clocks. Case1 has disclosed owner prerequisites;
 * cases2–6 share one ordinary intake. Cases3/4/5/6 finish the previous recovery's
 * real backoff. Case7 ends after same-cycle identity progress, with remaining work
 * pending. Every case is required; no prerequisite failure skips later cases.
 * 1380s bodies+180s hooks=26min, leaving4min for guarded setup/report/cleanup.
 * This is a tight authored allowance, not measured hosted fit or CP23/25 proof. */
describe.sequential('durable DATA recovery after operating-system worker death', () => {
  let connection: IndependentDatabase;
  let binding: QualificationBinding;
  const fixtureId = randomUUID(), id = randomUUID(), fixture = recoveryFixture(fixtureId);
  const draftFixtureId = randomUUID(), draftId = randomUUID(), draftFixture = recoveryFixture(draftFixtureId);
  const active = new Set<Worker>(), evidence: Record<string, unknown>[] = [], deadPids = new Set<number>();
  let mainIdentity: readonly DatabaseRow[] = [], retained: readonly DatabaseRow[] = [];

  const state = (requestId: string = id) => connection.database.query('SELECT revision,failure_count,terminal,next_attempt_at FROM public_data_intakes WHERE id=$1', [requestId]);
  const candidate = () => connection.database.query('SELECT * FROM public_data_league_candidates WHERE intake_id=$1', [id]);
  const identities = () => connection.database.query(`SELECT league.id AS league_id,season.id AS league_season_id,
    season.scoring_profile_id,source.id AS connection_id,source.current_mapping_revision_id
    FROM leagues league JOIN league_seasons season ON season.league_id=league.id
    JOIN league_source_connections source ON source.league_season_id=season.id
    WHERE league.league_key=$1 AND source.provider='sleeper' AND source.external_league_id=$2`, ['sleeper-' + fixture.external, fixture.external]);
  const receipts = (requestId: string = id) => connection.database.query(`SELECT receipt.id,receipt.content_id,receipt.attempt_id,
    to_jsonb(receipt) AS receipt,to_jsonb(content) AS content,to_jsonb(acceptance) AS acceptance,scope.identity
    FROM league_roster_capture_receipts receipt JOIN league_administration_contents content ON content.id=receipt.content_id
    JOIN league_roster_resource_attempts attempt ON attempt.id=receipt.attempt_id
    JOIN league_roster_resource_scopes scope ON scope.id=attempt.scope_id
    LEFT JOIN league_roster_resource_acceptances acceptance ON acceptance.receipt_id=receipt.id
    WHERE receipt.provenance->'acquisition'->'work'->>'requestId'=$1 ORDER BY receipt.id`, [requestId]);
  const heads = (requestId: string = id) => connection.database.query(`SELECT DISTINCT head.* FROM league_roster_resource_heads head
    JOIN league_roster_resource_attempts attempt ON attempt.scope_id=head.scope_id
    JOIN league_roster_capture_receipts receipt ON receipt.attempt_id=attempt.id
    WHERE receipt.provenance->'acquisition'->'work'->>'requestId'=$1 ORDER BY head.scope_id`, [requestId]);
  async function assertRetained() {
    const current = await receipts();
    for (const row of retained) expect(current.find(value => value.id === row.id)).toEqual(row);
    expect(new Set(current.map(row => row.attempt_id)).size).toBe(current.length);
    // Every genuine unchanged acquisition reuses the corresponding semantic
    // content while keeping its own receipt and acceptance history.
    const families = new Map<string, unknown>();
    for (const row of current) {
      const key = JSON.stringify(row.identity);
      if (families.has(key)) expect(row.content_id).toBe(families.get(key));
      else families.set(key, row.content_id);
    }
  }
  async function waitUntil(probe: () => Promise<boolean>, milliseconds: number, failure: string) {
    const until = Date.now() + milliseconds;
    while (!await probe()) { if (Date.now() >= until) throw new Error(failure); await delay(100); }
  }
  async function waitMessage(worker: Worker, type: RecoveryMessage['type'], timeout = 235_000) {
    let found: RecoveryMessage | undefined;
    await waitUntil(async () => {
      if (worker.error) throw worker.error;
      found = worker.messages.find(message => message.type === type);
      if (!found && worker.isClosed) throw new Error('CP22 worker closed before required evidence.');
      return !!found;
    }, timeout, 'CP22 worker evidence deadline exceeded.');
    return found!;
  }
  async function launch(barrier: RecoveryBarrier = 'none', options: { requestId?: string; fixtureId?: string; mode?: 'intake' | 'refresh'; untilProgress?: boolean } = {}) {
    expect(active.size, 'CP22 launches replacements only after old process closure.').toBe(0);
    await assertProcessRecoverySupportSources(siteRoot);
    const env = integrationEnvironment();
    const config: RecoveryWorkerConfig = { nonce: randomUUID(), contextNonce: binding.context.nonce, gitSha: binding.context.gitSha,
      profileDigest: binding.context.profileDigest, expectedDatabase: env.expectedDatabase, expectedBranch: env.expectedBranchId,
      requestId: options.requestId ?? id, fixtureId: options.fixtureId ?? fixtureId,
      mode: options.mode ?? 'intake', barrier, untilProgress: options.untilProgress ?? true };
    const child = spawnIntegrationWorker(process.execPath,
      ['--conditions=react-server', '--import=tsx', fileURLToPath(new URL('./process-recovery-worker.ts', import.meta.url))],
      { cwd: siteRoot, env: recoveryWorkerEnvironment(process.env, env.runtimeDatabaseUrl, config), stdio: ['ignore', 'ignore', 'ignore', 'ipc'] });
    const worker = { child, config, messages: [], isClosed: false, exitCode: null, signal: null } as unknown as Worker;
    worker.closed = new Promise<void>(resolve => child.once('close', (code, signal) => {
      worker.isClosed = true; worker.exitCode = code; worker.signal = signal; resolve();
    }));
    child.on('error', () => { worker.error = new Error('CP22 worker launch failed.'); });
    child.on('message', value => {
      try {
        const message = parseRecoveryMessage(value, config, child.pid!);
        const first = worker.messages[0];
        if (!first && message.type !== 'ready') throw new Error('CP22 owner ran before startup proof.');
        if (first && (message.backendPid !== first.backendPid || message.backendStart !== first.backendStart)) {
          throw new Error('CP22 message backend changed.');
        }
        worker.messages.push(message);
      }
      catch { worker.error = new Error('CP22 worker evidence failed validation.'); }
    });
    active.add(worker);
    try {
      if (!child.pid) throw new Error('CP22 worker PID unavailable.');
      expect(deadPids.has(child.pid), 'Replacement must have a distinct observed OS PID.').toBe(false);
      worker.ready = await waitMessage(worker, 'ready', 15_000);
      const [backend] = await ownerQuery(`SELECT usename,datname,backend_start::text FROM pg_stat_activity WHERE pid=$1`, [worker.ready.backendPid]);
      expect(backend).toEqual({ usename: 'league_one_runtime', datname: env.expectedDatabase, backend_start: worker.ready.backendStart });
      await new Promise<void>((resolve, reject) => child.send(recoveryStartMessage(config), error => error
        ? reject(new Error('CP22 start acknowledgment could not be delivered.')) : resolve()));
      return worker as Worker & { ready: RecoveryMessage };
    } catch (error) {
      await closed(worker, !worker.isClosed && worker.child.pid !== undefined, true);
      throw error;
    }
  }
  async function closed(worker: Worker, hard: boolean, cleanup = false) {
    if (hard) {
      expect(worker.isClosed).toBe(false);
      await stopIntegrationChildTree(worker.child, worker.child.pid);
    }
    await Promise.race([worker.closed, delay(12_000).then(() => { throw new Error('CP22 worker close not observed.'); })]);
    const closure = await verifyIntegrationChildTreeClosed(worker.child);
    const session = worker.ready ?? worker.messages.find(message => message.type === 'ready');
    if (session) await waitUntil(async () => {
      const [row] = await ownerQuery(`SELECT NOT EXISTS(SELECT 1 FROM pg_stat_activity WHERE pid=$1 AND backend_start=$2::timestamptz)
        AND NOT EXISTS(SELECT 1 FROM pg_locks WHERE pid=$1) AS gone`, [session.backendPid, session.backendStart]);
      return row.gone === true;
    }, 12_000, 'CP22 dead database backend or transaction locks remain.');
    active.delete(worker);
    evidence.push({ type: hard ? 'hard-death' : 'natural-close', nonce: worker.config.nonce, pid: worker.child.pid,
      backendPid: session?.backendPid ?? null, backendStart: session?.backendStart ?? null, closure, exitCode: worker.exitCode,
      signal: worker.signal, at: new Date().toISOString(), messages: worker.messages });
    if (hard) deadPids.add(worker.child.pid!);
    if (!cleanup) {
      if (hard && process.platform !== 'win32') expect(worker.signal).toBe('SIGKILL');
      if (!hard) expect(worker.exitCode).toBe(0);
    }
  }
  async function cleanupWorkers() {
    const failures: unknown[] = [];
    for (const worker of [...active]) {
      try { await closed(worker, !worker.isClosed && worker.child.pid !== undefined, true); } catch (error) { failures.push(error); }
    }
    if (failures.length) throw new Error('CP22 failed to close an owned worker.');
  }
  async function guarded(body: () => Promise<void>) {
    try { await body(); }
    finally { try { await cleanupWorkers(); } finally { vi.restoreAllMocks(); } }
  }
  async function progress(resource?: string, options: Parameters<typeof launch>[1] = {}) {
    const worker = await launch('none', options), result = await waitMessage(worker, 'result');
    await closed(worker, false);
    if (resource) expect(result).toMatchObject({ status: 'progress', resource, requests: resource === 'core' ? 2 : 1 });
    else expect(result).toMatchObject({ status: 'complete', requests: 0 });
    return result;
  }
  async function killAt(worker: Worker, expected: RecoveryBarrier, expectedRequests: number): Promise<Death> {
    const message = await waitMessage(worker, 'barrier');
    expect(message).toMatchObject({ barrier: expected, requests: expectedRequests });
    expect(message.workerId).toBeTruthy(); expect(message.generation).toBeGreaterThan(0);
    expect(message.deadlineAt).toBeTruthy(); expect(message.requestId).toBeTruthy();
    const before = await state(message.requestId!);
    const durableHeads = await heads(message.requestId!);
    const proof: Record<string, unknown> = { barrier: expected, nonce: message.nonce, requestId: message.requestId,
      workerId: message.workerId, generation: message.generation, deadlineAt: message.deadlineAt,
      at: message.at, stateDigest: digest(before), receiptDigest: digest(await receipts(message.requestId)), headDigest: digest(durableHeads) };
    evidence.push(proof);
    await closed(worker, true);
    return { message, before, heads: durableHeads, proof };
  }
  async function recover(death: Death, failures: number, options: Parameters<typeof launch>[1] = {}) {
    const worker = await launch('none', { ...options, untilProgress: false });
    expect(worker.ready.pid).not.toBe(death.message.pid);
    expect(worker.ready.backendPid).not.toBe(death.message.backendPid);
    const result = await waitMessage(worker, 'result');
    expect(result).toMatchObject({ status: 'backoff', requests: 0 });
    expect(result.workerId).not.toBe(death.message.workerId);
    await closed(worker, false);
    const after = await state(death.message.requestId);
    expect(await heads(death.message.requestId)).toEqual(death.heads);
    expect(after[0]).toMatchObject({ revision: Number(death.before[0].revision) + 1, failure_count: failures, terminal: false });
    expect(await connection.database.query(`SELECT outcome FROM public_data_dispatch_outcomes WHERE worker_id=$1 AND generation=$2`,
      [death.message.workerId, death.message.generation])).toEqual([{ outcome: 'recovered' }]);
    const [backoff] = await connection.database.query(`SELECT request.next_attempt_at>=outcome.recorded_at+make_interval(secs=>$3::integer-20)
      AND request.next_attempt_at<=outcome.recorded_at+make_interval(secs=>$3::integer) AS original_backoff,
      request.next_attempt_at>clock_timestamp() AS still_waiting FROM public_data_intakes request
      JOIN public_data_dispatches dispatch ON dispatch.intake_id=request.id
      JOIN public_data_dispatch_outcomes outcome USING(worker_id,generation)
      WHERE dispatch.worker_id=$1 AND dispatch.generation=$2`, [death.message.workerId, death.message.generation, 60 * 2 ** (failures - 1)]);
    expect(backoff).toEqual({ original_backoff: true, still_waiting: true });
    death.proof.replacement = { nonce: result.nonce, pid: result.pid, backendPid: result.backendPid,
      workerId: result.workerId, generation: result.generation, stateDigest: digest(after), at: result.at };
  }
  beforeAll(async () => {
    const selected = qualificationBinding();
    if (!selected || selected.context.profile !== 'data-process-recovery-v1') throw new Error('CP22 requires its guarded closed profile.');
    binding = selected;
    await assertProcessRecoverySupportSources(siteRoot);
    connection = createIndependentDatabase();
    expect((await connection.database.query('SELECT current_user,session_user FROM pg_roles WHERE rolname=current_user'))[0])
      .toEqual({ current_user: 'league_one_runtime', session_user: 'league_one_runtime' });
  }, 90_000);
  afterAll(async () => {
    try {
      try { await cleanupWorkers(); }
      finally {
        if (binding) {
          const barriers = ['draft-admitted', 'bootstrap-rolled-back', 'bootstrap-committed', 'core-first-accepted',
            'core-all-accepted', 'users-checkpoint', 'refresh-selected'];
          const serialized = JSON.stringify({ kind: PROCESS_RECOVERY_VERSION, context: binding.context, fixtureId, draftFixtureId,
            hardDeathsObserved: deadPids.size, cases: PROCESS_RECOVERY_TESTS.map((name, index) => {
              const record = evidence.find(event => event.barrier === barriers[index]);
              return { name, barrier: barriers[index], state: record?.replacement ? 'replacement-observed'
                : record ? 'barrier-observed-without-replacement-proof' : 'unobserved', evidence: record ?? null };
            }), events: evidence }) + '\n';
          expect(Buffer.byteLength(serialized)).toBeLessThanOrEqual(256_000);
          await writeFile(join(binding.directory, 'process-recovery-evidence.json'), serialized, { flag: 'wx', mode: 0o600 });
        }
      }
      if (connection) await waitUntil(async () => {
        const [row] = await connection.database.query(`SELECT NOT EXISTS(SELECT 1 FROM public_data_dispatches WHERE admitted_at>clock_timestamp()-interval '60 seconds')
          AND NOT EXISTS(SELECT 1 FROM projection_jobs WHERE job_key=$1 AND (state='running' OR completed_at>clock_timestamp()-interval '60 seconds')) AS ready`, [PUBLIC_INTAKE_JOB]);
        return row.ready === true;
      }, 75_000, 'CP22 original shared-minute cleanup did not settle.');
    } finally { vi.restoreAllMocks(); await connection?.close(); }
  }, 90_000);

  it('restarts an admitted draft child from its retained catalog after process death before acquisition', () => guarded(async () => {
    const intake = createPublicIntakeStore(connection.database), jobs = createProjectionStore(connection.database);
    const administration = createLeagueAdministrationStore(connection.database);
    await intake.submit({ id: draftId, username: draftFixture.username, seasons: [2026], draftPicks: PUBLIC_DRAFT_PICKS });
    // Disclosed synthetic prerequisite ONLY: identity/list/bootstrap and root
    // tasks. A genuine ordinary catalog acquisition creates its immutable receipt
    // and children; the non-target league-trades task is explicitly unavailable.
    const registration = await jobs.registerLeagueSeason({ mode: 'official-data', leagueKey: 'sleeper-' + draftFixture.external,
      leagueName: draftFixture.league.name, season: 2026, sleeperLeagueId: draftFixture.external });
    if (registration.kind !== 'stored') throw new Error('CP22 draft prerequisite identity unavailable.');
    await ownerQuery("INSERT INTO league_administration_enrollments(league_id,provider,active,evidence) VALUES($1,'sleeper',false,'CP22 disclosed draft baseline')", [registration.value.leagueId]);
    await ownerQuery("INSERT INTO league_administration_enrollment_seasons(league_id,season,provider,evidence) VALUES($1,2026,'sleeper','CP22 disclosed draft baseline')", [registration.value.leagueId]);
    await ownerQuery("INSERT INTO league_source_manager_accounts(provider,external_manager_id) VALUES('sleeper',$1)", [draftFixture.manager]);
    await ownerQuery(`INSERT INTO public_data_identity_observations(intake_id,source_manager_account_id,username,display_name,avatar_url,payload,request_started_at,request_completed_at)
      SELECT $1,id,$2,$2,NULL,$3::jsonb,clock_timestamp(),clock_timestamp() FROM league_source_manager_accounts WHERE provider='sleeper' AND external_manager_id=$4`,
    [draftId, draftFixture.username, JSON.stringify({ user_id: draftFixture.manager, username: draftFixture.username, fixture: 'CP22 disclosed baseline' }), draftFixture.manager]);
    await ownerQuery('INSERT INTO public_data_league_lists(intake_id,season,payload,request_started_at,request_completed_at) VALUES($1,2026,$2::jsonb,clock_timestamp(),clock_timestamp())', [draftId, JSON.stringify([draftFixture.league])]);
    await ownerQuery(`INSERT INTO public_data_league_candidates(intake_id,season,external_league_id,name,stage,league_season_id,bootstrap_payload,bootstrap_started_at,bootstrap_completed_at)
      VALUES($1,2026,$2,$3,'complete',$4,$5::jsonb,clock_timestamp(),clock_timestamp())`, [draftId, draftFixture.external, draftFixture.league.name, registration.value.leagueSeasonId, JSON.stringify(draftFixture.league)]);
    const seedWorker = randomUUID();
    await ownerQuery(`INSERT INTO projection_jobs(job_key,job_type,scheduled_for,state,lease_owner,lease_until,attempt_count,payload)
      VALUES($1,$1,date_trunc('minute',clock_timestamp()),'running',$2,clock_timestamp()+interval '25 seconds',1,'{}'::jsonb)`, [PUBLIC_INTAKE_JOB, seedWorker]);
    const seedFence = { jobKey: PUBLIC_INTAKE_JOB, workerId: seedWorker, generation: 1, deadlineAt: new Date(Date.now() + 20_000).toISOString() };
    await ownerQuery(`INSERT INTO public_data_draft_tasks(intake_id,ordinal,season,external_league_id,resource,write_fence)
      VALUES($1,1,2026,$2,'catalog',$3::jsonb),($1,2,2026,$2,'league-trades',$3::jsonb)`, [draftId, draftFixture.external, JSON.stringify(seedFence)]);
    await ownerQuery("UPDATE projection_jobs SET state='failed',lease_owner=NULL,lease_until=NULL WHERE job_key=$1", [PUBLIC_INTAKE_JOB]);
    const urls: string[] = [];
    const source = vi.spyOn(globalThis, 'fetch').mockImplementation(fixtureFetch(draftFixtureId, url => urls.push(url)));
    const catalog = await runPublicIntakeStep(draftId, { administration, jobs, intake: { ...intake, completeDraft: async (...args) => {
      await intake.completeDraft!(...args);
      expect(args[0].resource).toBe('catalog');
      await ownerQuery("UPDATE public_data_draft_tasks SET status='unavailable',failure_count=5,reason='draft-capture-exhausted',write_fence=$2::jsonb WHERE intake_id=$1 AND resource='league-trades'", [draftId, JSON.stringify(args[3])]);
    } } }, AbortSignal.timeout(20_000));
    expect(catalog).toEqual({ status: 'progress', resource: 'drafts', providerRequests: 1 });
    expect(urls).toEqual(['https://api.sleeper.app/v1/league/' + draftFixture.external + '/drafts']); source.mockRestore();
    const original = await receipts(draftId), tasks = await connection.database.query('SELECT ordinal,resource,catalog_receipt_id FROM public_data_draft_tasks WHERE intake_id=$1 ORDER BY ordinal', [draftId]);
    expect(original).toHaveLength(1); expect(tasks).toHaveLength(5);
    evidence.push({ type: 'disclosed-draft-baseline', requestId: draftId, seedWorker,
      syntheticPrerequisites: ['canonical-identity', 'inactive-enrollment', 'identity-observation', 'league-list',
        'completed-candidate-without-core-acquisition', 'root-tasks', 'unavailable-league-trades', 'released-prerequisite-job'],
      ordinaryCatalogAdmissions: 1, ordinaryCatalogGets: 1, receiptDigest: digest(original), taskDigest: digest(tasks) });
    const options = { requestId: draftId, fixtureId: draftFixtureId };
    const worker = await launch('draft-admitted', options);
    const barrier = await waitMessage(worker, 'barrier');
    expect(await receipts(draftId)).toEqual(original);
    expect(await connection.database.query('SELECT outcome FROM public_data_dispatch_outcomes WHERE worker_id=$1 AND generation=$2', [barrier.workerId, barrier.generation])).toEqual([]);
    const death = await killAt(worker, 'draft-admitted', 0); await recover(death, 1, options);
    await progress('drafts', options);
    expect(await connection.database.query('SELECT ordinal,resource,catalog_receipt_id FROM public_data_draft_tasks WHERE intake_id=$1 ORDER BY ordinal', [draftId])).toEqual(tasks);
    expect((await receipts(draftId)).find(row => row.id === original[0].id)).toEqual(original[0]);
    expect(await connection.database.query('SELECT task_ordinal FROM public_data_draft_checkpoints WHERE intake_id=$1 ORDER BY task_ordinal', [draftId])).toEqual([{ task_ordinal: 1 }, { task_ordinal: 3 }]);
    const noFetch = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('CP22 stored reader attempted acquisition.'));
    const read = await readPublicSleeperIntake(connection.database, administration, draftId);
    expect(read).toMatchObject({ status: 'pending', drafts: expect.arrayContaining([expect.objectContaining({ ordinal: 3,
      resource: expect.objectContaining({ status: 'available', value: expect.objectContaining({ kind: 'detail', detail: expect.objectContaining({ status: { raw: 'complete', state: 'supplied', value: 'complete' } }) }) }) })]) });
    expect(noFetch).not.toHaveBeenCalled();
  }), 210_000);

  it('recovers unfinished bootstrap after genuine identity-lock rollback and process death', () => guarded(async () => {
    await createPublicIntakeStore(connection.database).submit({ id, username: fixture.username, seasons: [2026] });
    await progress('identity'); await progress('leagues');
    const blocker = await createPinnedIntegrationDatabase('owner');
    let open = false;
    try {
      const [session] = await blocker.database.query('SELECT pg_backend_pid() AS pid');
      await blocker.database.query('BEGIN'); open = true;
      await blocker.database.query('INSERT INTO leagues(league_key,name) VALUES($1,$2)', ['sleeper-' + fixture.external, 'CP22 uncommitted identity blocker']);
      const worker = await launch('bootstrap-rolled-back');
      const admitted = await waitMessage(worker, 'admitted');
      await waitUntil(async () => (await ownerQuery('SELECT $2::integer=ANY(pg_blocking_pids($1::integer)) AS blocked', [worker.ready.backendPid, session.pid]))[0].blocked === true,
        5_000, 'CP22 did not observe the actual canonical identity lock.');
      const [remaining] = await ownerQuery('SELECT greatest(0,extract(epoch FROM $1::timestamptz-clock_timestamp())) AS seconds', [admitted.deadlineAt]);
      await delay(Number(remaining.seconds) * 1_000 + 150);
      await blocker.database.query('ROLLBACK'); open = false;
      const rolledBack = await waitMessage(worker, 'barrier', 10_000);
      expect(Date.parse(rolledBack.at)).toBeGreaterThan(Date.parse(admitted.deadlineAt!));
      expect(await identities()).toEqual([]);
      expect(await connection.database.query('SELECT external_league_id FROM public_data_collection_reservations WHERE external_league_id=$1', [fixture.external])).toEqual([]);
      expect((await candidate())[0]).toMatchObject({ stage: 'bootstrap', league_season_id: null, bootstrap_payload: null });
      expect(await connection.database.query('SELECT outcome FROM public_data_dispatch_outcomes WHERE worker_id=$1 AND generation=$2', [rolledBack.workerId, rolledBack.generation])).toEqual([]);
      const death = await killAt(worker, 'bootstrap-rolled-back', 1);
      death.proof.actualIdentityLockObserved = true; death.proof.rollbackObserved = true;
      await recover(death, 1);
    } finally {
      // Kill before releasing a failed oracle's identity lock: cleanup cannot
      // accidentally let an unobserved live writer commit the fixture identity.
      try { await cleanupWorkers(); }
      finally {
        try { if (open) await blocker.database.query('ROLLBACK'); }
        finally { await blocker.close(); }
      }
    }
  }), 270_000);

  it('reuses committed canonical identity after process death before bootstrap checkpoint', () => guarded(async () => {
    const worker = await launch('bootstrap-committed'); await waitMessage(worker, 'barrier');
    mainIdentity = await identities(); expect(mainIdentity).toHaveLength(1); expect(mainIdentity[0].scoring_profile_id).toBeNull();
    expect((await candidate())[0]).toMatchObject({ stage: 'bootstrap', league_season_id: null, bootstrap_payload: null });
    expect(await connection.database.query('SELECT external_league_id FROM public_data_collection_reservations WHERE external_league_id=$1', [fixture.external])).toEqual([{ external_league_id: fixture.external }]);
    const death = await killAt(worker, 'bootstrap-committed', 1); death.proof.identityDigest = digest(mainIdentity);
    await recover(death, 2); expect(await identities()).toEqual(mainIdentity);
  }), 120_000);

  it('preserves the first accepted core family across process death before remaining families', () => guarded(async () => {
    await progress('bootstrap'); expect(await identities()).toEqual(mainIdentity);
    const worker = await launch('core-first-accepted'); await waitMessage(worker, 'barrier');
    retained = await receipts(); expect(retained).toHaveLength(1); expect(retained[0].acceptance).not.toBeNull();
    expect((await candidate())[0]).toMatchObject({ stage: 'core', settings_receipt_id: null, players_receipt_id: null, managers_receipt_id: null });
    const mapping = await createLeagueAdministrationStore(connection.database).readSourceMapping(fixture.external);
    if (!mapping) throw new Error('CP22 committed mapping unavailable.');
    const noFetch = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('CP22 stored reader attempted acquisition.'));
    const read = await readPublicSleeperIntake(connection.database, createLeagueAdministrationStore(connection.database), id);
    expect(read.status).toBe('pending'); expect(noFetch).not.toHaveBeenCalled(); noFetch.mockRestore();
    const death = await killAt(worker, 'core-first-accepted', 2); await recover(death, 1); await assertRetained();
  }), 240_000);

  it('reacquires core from durable receipts after process death before intake checkpoint', () => guarded(async () => {
    const worker = await launch('core-all-accepted'); await waitMessage(worker, 'barrier');
    await assertRetained(); const current = await receipts(); expect(current).toHaveLength(4);
    expect(current.every(row => row.acceptance !== null)).toBe(true);
    expect((await candidate())[0]).toMatchObject({ stage: 'core', settings_receipt_id: null, players_receipt_id: null, managers_receipt_id: null });
    retained = current;
    const death = await killAt(worker, 'core-all-accepted', 2); await recover(death, 2); await assertRetained();
  }), 120_000);

  it('continues after checkpoint commit and process death before job completion', () => guarded(async () => {
    await progress('core'); await assertRetained();
    const core = (await candidate())[0]; expect(core).toMatchObject({ stage: 'users' });
    for (const key of ['settings_receipt_id', 'players_receipt_id', 'managers_receipt_id']) expect(core[key]).toBeTruthy();
    const beforeUsers = await receipts(); expect(beforeUsers).toHaveLength(7);
    const worker = await launch('users-checkpoint'); const message = await waitMessage(worker, 'barrier');
    const completedCandidate = await candidate(); expect(completedCandidate[0]).toMatchObject({ stage: 'complete' });
    const outcomes = await connection.database.query('SELECT * FROM public_data_dispatch_outcomes WHERE worker_id=$1 AND generation=$2', [message.workerId, message.generation]);
    expect(outcomes).toHaveLength(1); expect(outcomes[0].outcome).toBe('checkpoint-committed');
    const death = await killAt(worker, 'users-checkpoint', 1);
    const result = await progress(); expect(result.pid).not.toBe(death.message.pid); expect(result.workerId).not.toBe(death.message.workerId);
    expect(result.backendPid).not.toBe(death.message.backendPid); expect(result.nonce).not.toBe(death.message.nonce);
    expect(await heads()).toEqual(death.heads);
    expect(await receipts()).toEqual(beforeUsers); expect(await candidate()).toEqual(completedCandidate);
    expect(await connection.database.query('SELECT * FROM public_data_dispatch_outcomes WHERE worker_id=$1 AND generation=$2', [message.workerId, message.generation])).toEqual(outcomes);
    expect((await state())[0]).toMatchObject({ revision: death.before[0].revision, failure_count: 0, terminal: true });
    expect(await identities()).toEqual(mainIdentity);
    const noFetch = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('CP22 stored reader attempted acquisition.'));
    const read = await readPublicSleeperIntake(connection.database, createLeagueAdministrationStore(connection.database), id);
    expect(read).toMatchObject({ status: 'available', leagues: [{ collection: 'complete', resources: {
      settings: { status: 'available', value: { scoring: { rules: { state: 'absent', value: null } }, slots: { state: 'absent', value: null } } },
      heldRoster: { status: 'available' }, teamManagers: { status: 'available' }, directory: { status: 'available' } } }] });
    expect(noFetch).not.toHaveBeenCalled();
    const dispatches = await connection.database.query(`SELECT resource,count(*)::integer AS attempts FROM public_data_dispatches WHERE intake_id=$1 GROUP BY resource ORDER BY resource`, [id]);
    expect(dispatches).toEqual([{ resource: 'bootstrap', attempts: 3 }, { resource: 'core', attempts: 3 }, { resource: 'identity', attempts: 1 }, { resource: 'leagues', attempts: 1 }, { resource: 'users', attempts: 1 }]);
    expect(await connection.database.query(`WITH ordered AS (SELECT admitted_at,lag(admitted_at) OVER(ORDER BY admitted_at) AS previous FROM public_data_dispatches)
      SELECT bool_and(previous IS NULL OR admitted_at-previous>=interval '60 seconds') AS real_spacing FROM ordered`)).toEqual([{ real_spacing: true }]);
    expect(await connection.database.query(`SELECT count(*)::integer AS unfinished FROM public_data_dispatches dispatch LEFT JOIN public_data_dispatch_outcomes outcome USING(worker_id,generation)
      WHERE dispatch.intake_id=$1 AND outcome.worker_id IS NULL`, [id])).toEqual([{ unfinished: 0 }]);
    death.proof.replacement = { nonce: result.nonce, pid: result.pid, backendPid: result.backendPid, workerId: result.workerId,
      generation: result.generation, requests: result.requests, terminal: true, at: result.at };
    retained = beforeUsers;
  }), 240_000);

  it('resumes the same recurring cycle after process death between selection and admission', () => guarded(async () => {
    const targetId = randomUUID(), refresh = createPublicDataRefreshStore(connection.database);
    const priorHeads = await heads();
    await refresh.configure({ id: targetId, expectedRevision: 0, identityRequestId: id, seasons: [2026],
      cadenceSeconds: 60, expiresAt: new Date(Date.now() + 3_600_000).toISOString(), paused: false });
    const worker = await launch('refresh-selected', { mode: 'refresh' }); const message = await waitMessage(worker, 'barrier');
    const cycles = await connection.database.query('SELECT * FROM public_data_refresh_cycles WHERE target_id=$1', [targetId]);
    expect(cycles).toHaveLength(1); expect(cycles[0].intake_id).toBe(message.requestId);
    expect(await connection.database.query('SELECT worker_id FROM public_data_dispatches WHERE intake_id=$1', [message.requestId])).toEqual([]);
    const death = await killAt(worker, 'refresh-selected', 0);
    const result = await progress('identity', { mode: 'refresh' });
    expect(result.pid).not.toBe(death.message.pid); expect(result.requestId).toBe(message.requestId);
    expect(result.backendPid).not.toBe(death.message.backendPid); expect(result.nonce).not.toBe(death.message.nonce);
    expect(await connection.database.query('SELECT * FROM public_data_refresh_cycles WHERE target_id=$1', [targetId])).toEqual(cycles);
    expect(await connection.database.query('SELECT worker_id FROM public_data_dispatch_outcomes WHERE worker_id=$1 AND generation=$2', [message.workerId, message.generation])).toEqual([]);
    expect(await connection.database.query('SELECT worker_id FROM public_data_refresh_selection_failures WHERE worker_id=$1 AND generation=$2', [message.workerId, message.generation])).toEqual([]);
    const [fresh] = await connection.database.query(`SELECT count(*)::integer AS captures,bool_and(request_started_at>=$2::timestamptz) AS fresh FROM public_data_identity_observations WHERE intake_id=$1`, [message.requestId, message.at]);
    expect(fresh).toEqual({ captures: 1, fresh: true }); await assertRetained(); expect(await heads()).toEqual(priorHeads);
    const noFetch = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('CP22 stored reader attempted acquisition.'));
    const read = await readPublicDataRefresh(connection.database, createLeagueAdministrationStore(connection.database), targetId);
    expect(read).toMatchObject({ status: 'available', cycle: { number: 1, requestId: message.requestId, outcome: null }, intake: { status: 'pending', lists: [], leagues: [] } });
    expect((await readPublicSleeperIntake(connection.database, createLeagueAdministrationStore(connection.database), id)).status).toBe('available');
    expect(noFetch).not.toHaveBeenCalled();
    expect(deadPids.size).toBe(7);
    death.proof.replacement = { nonce: result.nonce, pid: result.pid, backendPid: result.backendPid, workerId: result.workerId,
      generation: result.generation, requests: result.requests, sameCycle: true, remainingWork: 'pending', at: result.at };
    const [counts] = await connection.database.query(`SELECT count(*)::integer AS admissions,
      count(DISTINCT worker_id||':'||generation)::integer AS admitted_owners FROM public_data_dispatches WHERE intake_id=ANY($1::uuid[])`,
    [[id, draftId, message.requestId]]);
    expect(counts).toEqual({ admissions: 13, admitted_owners: 13 });
    const events = evidence.flatMap(entry => Array.isArray(entry.messages) ? entry.messages as RecoveryMessage[] : []);
    const gets = 1 + events.filter(entry => ['barrier', 'result'].includes(entry.type)).reduce((total, entry) => total + entry.requests, 0);
    expect(gets).toBe(15);
    evidence.push({ type: 'observed-accounting', ...counts, interceptedGets: gets,
      childClaims: events.filter(entry => entry.type === 'claim').length, ordinaryParentCatalogClaims: 1,
      note: 'Observed child claims include zero-GET backoff polling; the synthetic prerequisite job is excluded.' });
  }), 180_000);
});
