import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { ChildProcess } from 'node:child_process';
import { lstat, mkdir, realpath, writeFile } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createIndependentDatabase, integrationEnvironment, ownerQuery, type IndependentDatabase } from './neon-integration-harness';
import { spawnIntegrationWorker, stopIntegrationChildTree, verifyIntegrationChildTreeClosed } from './integration-child-process';
import { qualificationBinding, qualificationDigest, type QualificationBinding } from './qualification-profile';
import { runnerSnapshotQuery } from './runner-cycles-protocol';
import { FLEET_DAILY_PROFILE, FLEET_DAILY_SUITE, FLEET_DAILY_TESTS, buildFleetDailyManifest,
  readFleetRawEvidenceDocuments, readFleetEvidenceDocuments, fleetDocumentRows, writeFleetEvidenceChunks,
  resolveFleetDailyManifestReference, resolveFleetDailyRequestLedger, unpackFleetDailyQueue, type FleetEvidenceInventory,
  type FleetEvidenceStream } from './freshness-capacity-profile';
import { FLEET_VERSION, fleetEnvironment, fleetSupervisedWorkDeadline, parseFleetMessage, fleetStart, fleetEnd,
  type FleetAction, type FleetConfig, type FleetMessage } from './freshness-capacity-protocol';
import { DAILY_CLOCK, evaluateCapacityDaily, type CapacityDailyEvidence } from './freshness-capacity-daily';
import { loadCapacityNamedSourceFixture } from './freshness-capacity-fixtures';
import { capacityDigest } from './freshness-capacity-manifest';

/** The parent owns process closure; the existing outer supervisor alone owns schema, role and branch cleanup. */
describe.sequential(FLEET_DAILY_SUITE, () => {
  const siteRoot = fileURLToPath(new URL('../', import.meta.url));
  let binding: QualificationBinding, connection: IndependentDatabase, child: ChildProcess, config: FleetConfig;
  let rebuilt: Awaited<ReturnType<typeof buildFleetDailyManifest>>;
  let closed = false, childFailed = false, sequence = 0, closePromise: Promise<void>, cleanupDone = false;
  let rawInventory: FleetEvidenceInventory | null = null, finalInventory: FleetEvidenceInventory | null = null;
  let disabledBefore: string | null = null, disabledAfter: string | null = null;
  const messages: FleetMessage[] = [], calls: FleetMessage[] = [], enrollmentPrerequisites: Record<string, unknown>[] = [];
  const cases = FLEET_DAILY_TESTS.map(name => ({ name, state: 'unserved', span: null as ReturnType<typeof fleetEnd> | null }));
  const cleanup = { childClosed: false, backendGone: false, locksGone: false, connectionsClosed: false };
  const cleanupAttempts: { span: ReturnType<typeof fleetEnd>; completed: boolean; facts: typeof cleanup }[] = [];
  let actualServer: { version: string; versionNum: string }, ready: FleetMessage | null = null, originalFetch: typeof fetch;
  let rawDirectory = '', finalDirectory = '';
  let childExit: { code: number | null; signal: string | null } | null = null, forcedStop = false;
  const query = (sql: string, parameters: readonly unknown[] = []) => connection.database.query(sql, parameters);
  async function waitUntil(check: () => Promise<boolean> | boolean, deadlineAt: number) {
    while (!await check()) { if (Date.now() >= deadlineAt) throw new Error('Fleet bounded parent wait expired.'); await delay(100); }
  }
  async function newDirectory(name: string) {
    assert.equal(await realpath(binding.directory), resolve(binding.directory), 'artifact parent is symlinked or noncanonical');
    const parent = await lstat(binding.directory); assert(parent.isDirectory() && !parent.isSymbolicLink());
    const path = join(binding.directory, name); assert.equal(resolve(path), path); await mkdir(path);
    const child = await lstat(path); assert(child.isDirectory() && !child.isSymbolicLink()); assert.equal(await realpath(path), path);
    return path;
  }
  async function snapshot() {
    const tables = await ownerQuery("SELECT schemaname,tablename FROM pg_tables WHERE schemaname IN('public','website_auth') ORDER BY schemaname,tablename");
    const selected = runnerSnapshotQuery(tables.map(row => ({ schemaname: String(row.schemaname), tablename: String(row.tablename) })), false);
    return qualificationDigest(await ownerQuery(selected.sql, selected.parameters));
  }
  async function command(action: FleetAction) {
    const ordinal = ++sequence;
    await new Promise<void>((resolve, reject) => child.send({ version: FLEET_VERSION, nonce: config.nonce, sequence: ordinal, action },
      error => error ? reject(new Error('Fleet command delivery failed.')) : resolve()));
    if (action === 'stop') return undefined;
    const deadline = action === 'run-daily' ? config.workDeadlineAt : Math.min(config.workDeadlineAt, Date.now() + 60_000);
    await waitUntil(() => {
      if (childFailed || closed) throw new Error('Fleet child stopped before its evidence message.');
      return messages.some(row => row.type === 'result' && row.sequence === ordinal);
    }, deadline);
    const result = messages.find(row => row.type === 'result' && row.sequence === ordinal)!; calls.push(result); return result;
  }
  async function guarded(index: number, body: () => Promise<void>) {
    const start = fleetStart(); cases[index].state = 'running';
    try { await body(); cases[index].state = 'passed'; }
    catch (error) { cases[index].state = 'failed'; throw error; }
    finally { cases[index].span = fleetEnd(start); }
  }
  async function closeOwnedResources() {
    if (cleanupDone) return;
    const start = fleetStart();
    try {
      if (child && !closed) {
        if (sequence === 5 && !childFailed) await command('stop'); else { forcedStop = true; await stopIntegrationChildTree(child, child.pid); }
      }
      if (child) {
        await Promise.race([closePromise, delay(12_000).then(() => { throw new Error('Fleet process closure expired.'); })]);
        await verifyIntegrationChildTreeClosed(child); cleanup.childClosed = true;
      }
      if (ready) await waitUntil(async () => {
        const [row] = await ownerQuery(`SELECT NOT EXISTS(SELECT 1 FROM pg_stat_activity WHERE pid=$1 AND backend_start=$2::timestamptz) AS backend_gone,
          NOT EXISTS(SELECT 1 FROM pg_locks WHERE pid=$1) AS locks_gone`, [ready!.backendPid, ready!.backendStart]);
        cleanup.backendGone = row.backend_gone === true; cleanup.locksGone = row.locks_gone === true;
        return cleanup.backendGone && cleanup.locksGone;
      }, Date.now() + 12_000);
    } finally {
      try {
        if (connection && !cleanup.connectionsClosed) { await connection.close(); cleanup.connectionsClosed = true; }
      } finally {
        if (originalFetch) globalThis.fetch = originalFetch;
        cleanupDone = Object.values(cleanup).every(Boolean);
        cleanupAttempts.push({ span: fleetEnd(start), completed: cleanupDone, facts: { ...cleanup } });
      }
    }
  }
  beforeAll(async () => {
    const selected = qualificationBinding(); assert(selected?.context.profile === FLEET_DAILY_PROFILE, 'closed daily profile required'); binding = selected;
    const environment = integrationEnvironment(); connection = createIndependentDatabase(); originalFetch = globalThis.fetch;
    const [identity] = await query(`SELECT current_user,session_user,current_database() AS database,current_setting('neon.branch_id',true) AS branch,
      current_setting('server_version') AS version,current_setting('server_version_num') AS version_num`);
    expect(identity.current_user).toBe('league_one_runtime'); expect(identity.session_user).toBe('league_one_runtime');
    expect(identity.database).toBe(environment.expectedDatabase); expect(identity.branch).toBe(environment.expectedBranchId);
    actualServer = { version: String(identity.version), versionNum: String(identity.version_num) };
    const nonce = randomUUID(), fixtureId = randomUUID(), plannedPostgresqlVersion = actualServer.version.split(' ')[0];
    const built = await buildFleetDailyManifest({ fixtureId, gitSha: binding.context.gitSha, plannedPostgresqlVersion });
    rebuilt = built;
    rawDirectory = await newDirectory('fleet-raw-' + nonce);
    config = { profile: FLEET_DAILY_PROFILE, nonce, fixtureId, contextNonce: binding.context.nonce, gitSha: binding.context.gitSha,
      profileDigest: binding.context.profileDigest, fixtureDigest: built.fixture.digest, manifestDigest: built.dailyManifest.digest,
      expectedDatabase: environment.expectedDatabase, expectedBranch: environment.expectedBranchId, plannedPostgresqlVersion,
      evidenceDirectory: rawDirectory, workDeadlineAt: fleetSupervisedWorkDeadline(process.env, FLEET_DAILY_PROFILE) };
    expect(await query('SELECT 1 FROM public.public_data_intakes')).toEqual([]); expect(await query('SELECT 1 FROM public.projection_jobs')).toEqual([]);
    child = spawnIntegrationWorker(process.execPath, ['--conditions=react-server', '--import=tsx', fileURLToPath(new URL('./freshness-capacity-worker.ts', import.meta.url))],
      { cwd: siteRoot, env: fleetEnvironment(process.env, environment.runtimeDatabaseUrl, config), stdio: ['ignore', 'ignore', 'ignore', 'ipc'] });
    closePromise = new Promise<void>(resolve => child.once('close', (code, signal) => { childExit = { code, signal }; closed = true; resolve(); }));
    child.on('error', () => { childFailed = true; });
    child.on('message', value => { try { messages.push(parseFleetMessage(value, config, child.pid!)); } catch { childFailed = true; } });
    await waitUntil(() => { if (closed || childFailed) throw new Error('Fleet worker startup failed.'); return messages.some(row => row.type === 'ready'); }, Date.now() + 60_000);
    ready = messages.find(row => row.type === 'ready')!;
    const [backend] = await ownerQuery('SELECT usename,datname,backend_start::text FROM pg_stat_activity WHERE pid=$1', [ready.backendPid]);
    expect(backend.usename).toBe('league_one_runtime'); expect(backend.datname).toBe(environment.expectedDatabase); expect(backend.backend_start).toBe(ready.backendStart);
  }, 90_000);
  afterAll(async () => {
    let closureError: unknown;
    try { await closeOwnedResources(); } catch (error) { closureError = error; }
    finally { if (binding && config) {
      const companion = { kind: 'cp26-fleet-daily-evidence-v1', contextDigest: qualificationDigest(binding.context), config, ready, calls, cases,
        rawDirectory: basename(rawDirectory), rawInventory, finalDirectory: finalDirectory ? basename(finalDirectory) : null, finalInventory,
        cleanup, cleanupAttempts, childExit, forcedStop, actualServer, disabledBefore, disabledAfter, enrollmentPrerequisites };
      const bytes = JSON.stringify(companion) + '\n'; assert(Buffer.byteLength(bytes) <= 4 * 1024 * 1024);
      await writeFile(join(binding.directory, 'cp26-fleet-daily-evidence.json'), bytes, { flag: 'wx', mode: 0o600 });
    } }
    if (closureError) throw closureError;
    expect(cleanup).toEqual({ childClosed: true, backendGone: true, locksGone: true, connectionsClosed: true });
  }, 60_000);
  it(FLEET_DAILY_TESTS[0], () => guarded(0, async () => {
    disabledBefore = await snapshot();
    for (const action of ['omitted', 'false'] as const) {
      const result = await command(action); expect(result?.error).toBe(false);
      expect(result?.result?.dataAttemptsBefore).toBe(0); expect(result?.result?.dataAttemptsAfter).toBe(0);
    }
    disabledAfter = await snapshot(); expect(disabledAfter).toBe(disabledBefore);
    const prepared = await command('prepare'); expect(prepared?.error).toBe(false);
    const namedSource = loadCapacityNamedSourceFixture();
    const registrations = prepared?.result?.prepared as { leagueKey: string; leagueId: string; leagueSeasonId: string; nativeLeagueId: string }[];
    expect(registrations.map(row => row.leagueKey).sort()).toEqual(['dynasty', 'league1', 'league2']);
    for (const registration of registrations) {
      const expected = namedSource.collections[0].samples.find(row => row.key === registration.leagueKey); assert(expected);
      expect(registration.nativeLeagueId).toBe(expected.nativeLeagueId);
      const nativeLeague = expected.resources.find(row => row.document.family === 'league')!.document.payload as Record<string, unknown>;
      const [stored] = await query(`SELECT league.league_key,season.season,connection.external_league_id,profile.rules FROM public.leagues league
        JOIN public.league_seasons season ON season.league_id=league.id JOIN public.scoring_profiles profile ON profile.id=season.scoring_profile_id JOIN public.league_source_connections connection ON connection.league_season_id=season.id
        WHERE league.id=$1::uuid AND season.id=$2::uuid AND connection.provider='sleeper'`, [registration.leagueId, registration.leagueSeasonId]);
      expect(stored).toMatchObject({ league_key: registration.leagueKey, season: 2026, external_league_id: registration.nativeLeagueId });
      expect(capacityDigest(stored.rules)).toBe(capacityDigest(nativeLeague.scoring_settings));
      const witness = { kind: 'cp26-named-regression-enrollment-prerequisite', ...registration, season: 2026,
        nativeScoringDigest: capacityDigest(nativeLeague.scoring_settings), meaning: 'Metadata only; no manager discovery ancestry, accepted receipt, snapshot or capture is seeded.' };
      await ownerQuery("INSERT INTO public.league_administration_enrollments(league_id,provider,evidence) VALUES($1,'sleeper',$2)", [registration.leagueId, JSON.stringify(witness)]);
      await ownerQuery("INSERT INTO public.league_administration_enrollment_seasons(league_id,season,provider,evidence) VALUES($1,2026,'sleeper',$2)", [registration.leagueId, JSON.stringify(witness)]);
      enrollmentPrerequisites.push(witness);
    }
    const result = await command('run-daily'); rawInventory = result?.inventory ?? null;
    expect(result?.error).toBe(false); expect(rawInventory).not.toBeNull();
    expect(result?.result?.failedLoop).toBe(false); expect(result?.result?.closed).toBe(true); expect(result?.result?.offlineChecksPass).toBe(true);
    const final = await command('snapshot'); expect(final?.error).toBe(false); expect(final?.result?.openInvocations).toBe(0);
  }), DAILY_CLOCK.workMs);
  it(FLEET_DAILY_TESTS[1], () => guarded(1, async () => {
    assert(rawInventory); const raw = await readFleetRawEvidenceDocuments(rawDirectory, rawInventory);
    const capacity = raw['capacity-evidence'] as { manifest: unknown; observerManifest: unknown;
      evidence: Omit<CapacityDailyEvidence, 'requests' | 'queue'> & { requests: unknown; queue: unknown }; analysis: unknown };
    expect(rebuilt.fixture.digest).toBe(config.fixtureDigest); expect(rebuilt.dailyManifest.digest).toBe(config.manifestDigest);
    const manifest = resolveFleetDailyManifestReference(capacity.manifest, 'daily-manifest', rebuilt.dailyManifest);
    resolveFleetDailyManifestReference(capacity.observerManifest, 'observer-manifest', rebuilt.observerManifest);
    const evidence: CapacityDailyEvidence = { ...capacity.evidence,
      requests: resolveFleetDailyRequestLedger(capacity.evidence.requests, raw['transport-attempts']),
      queue: unpackFleetDailyQueue(capacity.evidence.queue) };
    const analysis = evaluateCapacityDaily(manifest, evidence); expect(analysis.pass).toBe(true);
    expect(capacityDigest(capacity.analysis)).toBe(capacityDigest(analysis));
    const primary = raw['primary-coexistence'] as { calls: { action: string; failed: boolean; outcome: Record<string, unknown>; span: ReturnType<typeof fleetEnd> }[]; tankAttempts: unknown[]; jobs: Record<string, unknown>[] };
    expect(primary.calls.some(row => row.action === 'enabled' && !row.failed && row.outcome?.status === 'completed'
      && Number(row.outcome.publishedLeagues) > 0 && row.outcome.failedLeagues === 0)).toBe(true);
    expect(primary.calls.filter(row => row.action === 'enabled').every(row => !row.failed && row.outcome
      && ['completed', 'skipped'].includes(String(row.outcome.status)) && (row.outcome.status !== 'completed' || row.outcome.failedLeagues === 0))).toBe(true);
    expect(primary.tankAttempts.length).toBeGreaterThan(0);
    expect(primary.jobs.some(row => row.job_key === 'league-administration-maintenance' && row.state === 'completed')).toBe(true);
    const named = raw['named-regressions'] as { reads: { key: string; nativeLeagueId: string; current: { envelope: { payload: unknown; scope: { externalLeagueId: string } } };
      held: { envelope: { payload: unknown } }; context: { snapshot: { snapshotId: string; payload: unknown } };
      snapshot: { snapshotId: string; leagueSeasonId: string; modelVersion: string; week: number; payload: { league: { season: string | number }; week: number } } }[] };
    expect(named.reads.map(row => row.key).sort()).toEqual(['dynasty', 'league1', 'league2']);
    for (const sample of loadCapacityNamedSourceFixture().collections[0].samples) {
      const row = named.reads.find(row => row.key === sample.key)!; expect(row.nativeLeagueId).toBe(sample.nativeLeagueId);
      expect(row.current.envelope.scope.externalLeagueId).toBe(sample.nativeLeagueId);
      expect(capacityDigest(row.current.envelope.payload)).toBe(capacityDigest(sample.resources.find(row => row.document.family === 'league')!.document.payload));
      expect(capacityDigest(row.held.envelope.payload)).toBe(capacityDigest(sample.resources.find(row => row.document.family === 'rosters')!.document.payload));
      expect(row.snapshot.snapshotId).toBe(row.context.snapshot.snapshotId); expect(capacityDigest(row.snapshot.payload)).toBe(capacityDigest(row.context.snapshot.payload));
      expect(row.snapshot.modelVersion).toBe('clock-v1'); expect(row.snapshot.week).toBe(2); expect(row.snapshot.payload.week).toBe(2);
      expect(String(row.snapshot.payload.league.season)).toBe('2026');
      expect(row.snapshot.leagueSeasonId).toBe(enrollmentPrerequisites.find(item => item.leagueKey === sample.key)!.leagueSeasonId);
    }
  }), 120_000);
  it(FLEET_DAILY_TESTS[2], () => guarded(2, async () => {
    assert(rawInventory); const raw = await readFleetRawEvidenceDocuments(rawDirectory, rawInventory);
    await closeOwnedResources(); expect(Object.values(cleanup).every(Boolean)).toBe(true);
    expect(forcedStop).toBe(false); expect(childExit).toEqual({ code: 0, signal: null });
    finalDirectory = await newDirectory('fleet-final-' + config.nonce);
    const documents = { ...raw, cleanup: { kind: 'cp26-parent-process-cleanup-v1', ...cleanup, childExit, forcedStop, cleanupAttempts, at: new Date().toISOString(),
      backendPid: ready!.backendPid, backendStart: ready!.backendStart, scope: 'Child process, pinned connection and locks only; outer supervisor owns database resources.' } };
    finalInventory = await writeFleetEvidenceChunks(finalDirectory, config.manifestDigest,
      Object.entries(documents).flatMap(([stream, value]) => fleetDocumentRows(stream as FleetEvidenceStream, value)));
    await readFleetEvidenceDocuments(finalDirectory, finalInventory);
  }), 120_000);
});
