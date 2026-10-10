import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createIndependentDatabase, createPinnedIntegrationDatabase, ownerQuery, type IndependentDatabase } from './neon-integration-harness';
import { createProjectionStore } from '../lib/projection-store';
import { createLeagueAdministrationStore, createPublicIntakeStore } from '../lib/league-administration/store';
import { runPublicPlayerDirectoryStep } from '../lib/league-administration/public-intake';
import { PUBLIC_INTAKE_JOB } from '../lib/league-administration/public-intake-contracts';
import { loadCompletePlayerCatalog } from '../lib/sleeper-player-catalog';
import { normalizePlayerDirectoryCapture } from '../lib/league-administration/player-directory';
import type { AdministrationWriteFence } from '../lib/league-administration/contracts';
import type { PublicIntakeWork } from '../lib/league-administration/public-intake-contracts';
import type { PlayerDirectoryAttempt, PlayerDirectoryCapture } from '../lib/league-administration/player-directory-contracts';

const native = JSON.stringify({
  '007': { player_id: '007', full_name: '', first_name: null, last_name: 'Unfiltered', position: 'LB', team: null,
    active: false, status: '', fantasy_positions: [], injury_status: null, source_extension: { count: 0, future: true } },
  '008': { player_id: '008', position: 'UNFAMILIAR', fantasy_positions: ['IDP'], team: 'FA' },
  BUF: { player_id: 'BUF', position: 'DEF', full_name: 'Buffalo Bills' },
});
/** AUTHORED / UNEXECUTED. All directory writes use restricted LOGIN and the existing
 * job fence. Fixture HTTP is not live Sleeper. The guarded owner resets ONLY
 * mutable operational cadence prerequisites between corrections. Fresh owner-created
 * paused/expired bootstrap premises test guard ordering only; no immutable
 * attempt/source/capture/version timestamp is changed. This is not elapsed24h,
 * process-death, workload/capacity, fresh-role provisioning or CP6 proof.
 * Six direct cases; one beforeAll/afterAll; <=9 minute body allowances + hooks. */
describe.sequential('shared Sleeper player directory through restricted PostgreSQL', () => {
  const activeOwners = new Set<() => Promise<boolean>>();
  const pendingDispatches = new Map<string, PublicIntakeWork>();
  let connection: IndependentDatabase;
  let store: ReturnType<typeof createLeagueAdministrationStore>;
  beforeAll(async () => {
    connection = createIndependentDatabase(); store = createLeagueAdministrationStore(connection.database);
    const [identity] = await connection.database.query(`SELECT current_user,session_user,version() AS version,
      rolsuper,rolcreaterole,rolcreatedb FROM pg_roles WHERE rolname=current_user`);
    expect(identity).toMatchObject({ current_user: 'league_one_runtime', session_user: 'league_one_runtime',
      rolsuper: false, rolcreaterole: false, rolcreatedb: false });
    expect(String(identity.version)).toContain('PostgreSQL');
  });
  afterAll(async () => {
    vi.restoreAllMocks();
    try {
      for (const finish of [...activeOwners]) await finish();
      // Recover only this module's abandoned dispatch, using a fresh genuine owner.
      // Never repair a preexisting unresolved dispatch from another module.
      for (const [priorWorker, work] of pendingDispatches) {
        const [oldest] = await connection.database.query(`SELECT dispatch.worker_id FROM public.public_data_dispatches dispatch
          WHERE NOT EXISTS(SELECT 1 FROM public.public_data_dispatch_outcomes outcome
            WHERE outcome.worker_id=dispatch.worker_id AND outcome.generation=dispatch.generation)
          ORDER BY admitted_at LIMIT 1`);
        if (oldest?.worker_id !== priorWorker) throw new Error('CP5 dispatch cleanup requires its own oldest unresolved dispatch.');
        const recovery = await claim(20_000, connection.database, { requestId: work.requestId, policy: 'public-data-intake-v1' });
        try { await createPublicIntakeStore(connection.database).recover(work.requestId, recovery.fence); pendingDispatches.delete(priorWorker); }
        finally { await recovery.finish(); }
      }
      await syntheticCadencePrerequisite();
      // Genuine DB elapsed time isolates later modules; immutable dispatch/job
      // history is not rewritten to make the shared minute guard disappear.
      const deadline = Date.now() + 85_000;
      while (true) {
        const [clock] = await connection.database.query(`SELECT
          NOT EXISTS(SELECT 1 FROM public.public_data_dispatches WHERE admitted_at>clock_timestamp()-interval '60 seconds')
          AND NOT EXISTS(SELECT 1 FROM public.projection_jobs WHERE job_key=$1
            AND (state='running' OR completed_at>clock_timestamp()-interval '60 seconds')) AS ready`, [PUBLIC_INTAKE_JOB]);
        if (clock.ready === true) break;
        if (Date.now() >= deadline) throw new Error('CP5 shared minute cleanup did not settle.');
        await delay(250);
      }
    } finally { await connection?.close(); }
  });

  function trackOwner(jobs: ReturnType<typeof createProjectionStore>, workerId: string) {
    const finish = async () => {
      const completed = await jobs.completeJob(PUBLIC_INTAKE_JOB, workerId);
      if (!completed) await jobs.failJob(PUBLIC_INTAKE_JOB, workerId, 'CP5 fixture owner cleanup');
      activeOwners.delete(finish); return completed;
    };
    activeOwners.add(finish); return finish;
  }

  async function syntheticCadencePrerequisite() {
    // Explicit owner fixture setup: operational cursor only, never source times.
    await ownerQuery(`UPDATE public.league_player_directory_heads SET
      last_network_at=clock_timestamp()-interval '25 hours',next_network_at=clock_timestamp()-interval '1 hour'
      WHERE provider='sleeper' AND sport='nfl'`);
  }
  async function claim(deadlineMs = 20_000, database = connection.database,
    payload: Record<string, unknown> = { policy: 'public-player-directory-v1', mode: 'player-directory' }) {
    const jobs = createProjectionStore(database); const workerId = randomUUID();
    const acquired = await jobs.acquireJob({ jobKey: PUBLIC_INTAKE_JOB, jobType: PUBLIC_INTAKE_JOB, workerId,
      scheduledFor: new Date().toISOString(), leaseSeconds: 25,
      payload });
    if (acquired.kind !== 'acquired') throw new Error('Directory fixture could not acquire existing owner.');
    const fence: AdministrationWriteFence = { jobKey: PUBLIC_INTAKE_JOB, workerId, generation: acquired.attempt,
      deadlineAt: new Date(Date.now() + deadlineMs).toISOString() };
    return { fence, finish: trackOwner(jobs, workerId) };
  }
  async function reserve(fence: AdministrationWriteFence, reader = store) {
    await syntheticCadencePrerequisite();
    const reservation = await reader.beginPlayerDirectoryAttempt(randomUUID(), fence);
    if (reservation.status !== 'reserved') throw new Error('Synthetic directory reservation unexpectedly backed off.');
    return reservation.attempt;
  }
  async function capture(attempt: PlayerDirectoryAttempt, raw = native): Promise<PlayerDirectoryCapture> {
    const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, options) => {
      expect(String(input)).toBe('https://api.sleeper.app/v1/players/nfl');
      expect(options?.redirect).toBe('error');
      return new Response(raw, { headers: { 'Content-Type': 'application/json' } });
    });
    try {
      const result = await loadCompletePlayerCatalog({ attempt, signal: AbortSignal.timeout(10_000) });
      expect(fetch).toHaveBeenCalledTimes(1); return result;
    } finally { fetch.mockRestore(); }
  }
  async function write(fence: AdministrationWriteFence, raw = native) {
    const attempt = await reserve(fence); const source = await capture(attempt, raw);
    const result = await store.recordPlayerDirectoryCapture(attempt, source, fence);
    return { attempt, source, result };
  }
  async function available(versionId?: string) {
    const read = await store.readAcceptedPlayerDirectory(versionId ? { versionId } : undefined);
    if (read.status !== 'available') throw new Error('Stored directory unavailable: ' + read.status);
    return read;
  }
  async function history() {
    const [row] = await ownerQuery(`SELECT
      (SELECT count(*)::integer FROM public.league_player_directory_contents) AS contents,
      (SELECT count(*)::integer FROM public.league_player_directory_captures) AS captures,
      (SELECT count(*)::integer FROM public.league_player_directory_versions) AS versions,
      (SELECT jsonb_build_object('ordinal',latest_ordinal,'generation',generation,'version',accepted_version_id)
        FROM public.league_player_directory_heads WHERE provider='sleeper' AND sport='nfl') AS head`);
    return row;
  }

  it('stores full native rows and bounded stored-only pages through the shared owner', async () => {
    await syntheticCadencePrerequisite();
    const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(async input => {
      expect(String(input)).toBe('https://api.sleeper.app/v1/players/nfl'); return new Response(native);
    });
    try {
      const jobs = createProjectionStore(connection.database); const intake = createPublicIntakeStore(connection.database);
      let result; const deadline = Date.now() + 150_000;
      do {
        result = await runPublicPlayerDirectoryStep({ administration: store, jobs, intake }, AbortSignal.timeout(20_000));
        if (!['busy', 'backoff'].includes(result.status)) break;
        await delay(1_000);
      } while (Date.now() < deadline);
      expect(result).toMatchObject({ status: 'progress', resource: 'player-directory', providerRequests: 1 });
      expect(fetch).toHaveBeenCalledTimes(1);
    } finally { fetch.mockRestore(); }
    const forbidden = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Stored reader cannot acquire source.'));
    try {
      const accepted = await available();
      expect(accepted.rows.map(row => row.externalPlayerId)).toEqual(['007', '008', 'BUF']);
      expect(accepted.rows[0]).toMatchObject({ fullName: '', firstName: null, active: false, team: null, fantasyPositions: [],
        fieldStates: { full_name: 'supplied', first_name: 'null', team: 'null', active: 'supplied', fantasy_positions: 'supplied' },
        source: { source_extension: { count: 0, future: true } } });
      const first = await store.readAcceptedPlayerDirectory({ versionId: accepted.version.versionId, limit: 1 });
      expect(first).toMatchObject({ status: 'available', rows: [accepted.rows[0]], nextCursor: '007' });
      expect(await store.readAcceptedPlayerDirectory({ versionId: accepted.version.versionId, afterPlayerId: '007', limit: 2 }))
        .toMatchObject({ status: 'available', rows: accepted.rows.slice(1), nextCursor: null });
      expect(await store.readAcceptedPlayerDirectory({ playerIds: ['BUF'] })).toMatchObject({ status: 'available', rows: [accepted.rows[2]] });
      expect(forbidden).not.toHaveBeenCalled();
      const [stored] = await connection.database.query(`SELECT content.raw_json,content.source_revision,
        (SELECT count(*)::integer FROM public.league_player_directory_entries WHERE content_id=content.id) AS entries
        FROM public.league_player_directory_contents content WHERE id=$1`, [accepted.version.contentId]);
      expect(stored).toEqual({ raw_json: native, source_revision: accepted.version.sourceRevision, entries: 3 });
    } finally { forbidden.mockRestore(); }
  }, 180_000);

  it('shares unchanged content without restamping replay and retains corrections and removals', async () => {
    const owner = await claim();
    try {
      const first = await write(owner.fence); const original = await available(first.result.acceptedVersionId!);
      const second = await write(owner.fence); const unchanged = await available();
      expect(second.result).toMatchObject({ status: 'accepted', contentId: first.result.contentId });
      expect(second.result.receiptId).not.toBe(first.result.receiptId);
      expect(second.result.acceptedVersionId).not.toBe(first.result.acceptedVersionId);
      const beforeReplay = await history();
      expect(await store.recordPlayerDirectoryCapture(first.attempt, first.source, owner.fence)).toMatchObject({
        status: 'replayed', receiptId: first.result.receiptId, acceptedVersionId: first.result.acceptedVersionId, generation: first.result.generation });
      expect(await history()).toEqual(beforeReplay);
      expect(await available(original.version.versionId)).toEqual({ ...original, latestAttempt: unchanged.latestAttempt });
      const correctedRaw = JSON.stringify({ '007': { player_id: '007', position: 'LB', team: 'BUF' } });
      const correction = await write(owner.fence, correctedRaw); const current = await available();
      expect(correction.result.status).toBe('accepted'); expect(current.rows).toHaveLength(1);
      expect(current.rows[0].team).toBe('BUF'); expect(current.version.contentId).not.toBe(original.version.contentId);
      expect((await available(original.version.versionId)).rows).toEqual(original.rows);
      expect((await available(original.version.versionId)).version.sourceObservedAt).toBe(original.version.sourceObservedAt);
    } finally { expect(await owner.finish()).toBe(true); }
  }, 60_000);

  it('preserves last good data through partial invalid conflicting empty and unavailable captures', async () => {
    const cases = [JSON.stringify({ good: { position: 'DL' }, bad: { active: 'yes' } }),
      JSON.stringify({ conflict: { player_id: 'other', position: 'QB' } }), '{}', '[]', '{',
      '{"x":{"position":"QB"},"x":{"position":"LB"}}'];
    cases.push(JSON.stringify(Object.fromEntries(['v', 'nativev', 'é', '\u0085', '💫'.repeat(128), '💫'.repeat(129), 'x'.repeat(4096)]
      .map(id => [id, { player_id: id, position: 'IDP' }]))));
    const lastGood = await available();
    for (const raw of cases) {
      const owner = await claim();
      try {
        const attempt = await reserve(owner.fence);
        // Direct normalizer fixture avoids provider cooldown affecting unrelated witnesses.
        const at = new Date().toISOString();
        const source = normalizePlayerDirectoryCapture({ attempt, rawJson: raw, requestStartedAt: at,
          requestCompletedAt: at, sourceObservedAt: at, providerRequests: 1 });
        const result = await store.recordPlayerDirectoryCapture(attempt, source, owner.fence);
        expect(result.status).toBe('preserved'); expect(result.acceptedVersionId).toBeNull();
        const read = await available(); expect(read.version).toEqual(lastGood.version); expect(read.rows).toEqual(lastGood.rows);
        expect(read.latestAttempt).toMatchObject({ status: source.status, reasons: source.reasons, receiptId: result.receiptId });
        const [retained] = await connection.database.query(`SELECT raw_json,duplicate_member_count FROM public.league_player_directory_contents WHERE id=$1`, [result.contentId]);
        expect(retained).toMatchObject({ raw_json: raw, duplicate_member_count: source.duplicateMemberCount });
        expect(await connection.database.query('SELECT external_player_id,identity_status FROM public.league_player_directory_entries WHERE content_id=$1 ORDER BY external_player_id COLLATE "C"', [result.contentId]))
          .toEqual([...source.rows].sort((left, right) => Buffer.compare(Buffer.from(left.externalPlayerId), Buffer.from(right.externalPlayerId)))
            .map(row => ({ external_player_id: row.externalPlayerId, identity_status: row.identityStatus })));
      } finally { await owner.finish(); }
    }
    const owner = await claim();
    try {
      const attempt = await reserve(owner.fence);
      const source = normalizePlayerDirectoryCapture({ attempt, rawJson: '{"a":{"extension":"\\u0000"}}',
        requestStartedAt: new Date().toISOString(), requestCompletedAt: new Date().toISOString(), sourceObservedAt: null,
        providerRequests: 1, failureReason: 'catalog-response-invalid' });
      const result = await store.recordPlayerDirectoryCapture(attempt, source, owner.fence);
      expect(result).toMatchObject({ status: 'preserved', reason: 'unavailable' });
      expect(await connection.database.query('SELECT raw_json,source_revision FROM public.league_player_directory_contents WHERE id=$1', [result.contentId]))
        .toEqual([{ raw_json: source.rawJson, source_revision: source.sourceRevision }]);
      expect((await available()).version).toEqual(lastGood.version);
    } finally { await owner.finish(); }
  }, 120_000);

  it('serializes reservations and rejects raw typed hash and nonce conflicts', async () => {
    const owner = await claim(); const other = createIndependentDatabase();
    try {
      await syntheticCadencePrerequisite();
      const results = await Promise.all([store.beginPlayerDirectoryAttempt(randomUUID(), owner.fence),
        createLeagueAdministrationStore(other.database).beginPlayerDirectoryAttempt(randomUUID(), owner.fence)]);
      expect(results.map(result => result.status).sort()).toEqual(['backoff', 'reserved']);
      const reserved = results.find(result => result.status === 'reserved');
      if (!reserved || reserved.status !== 'reserved') throw new Error('No reserved attempt.');
      const source = await capture(reserved.attempt); const before = await history();
      for (const bad of [{ ...source, sourceRevision: `sha256:${'0'.repeat(64)}` },
        { ...source, attemptNonce: randomUUID() }, { ...source, rows: source.rows.slice(1) },
        { ...source, rows: [{ ...source.rows[0], team: 'invented' }, ...source.rows.slice(1)] },
        { ...source, sourceObservedAt: 'infinity', requestCompletedAt: 'infinity' }]) {
        await expect(store.recordPlayerDirectoryCapture(reserved.attempt, bad, owner.fence)).rejects.toThrow();
        expect(await history()).toEqual(before);
      }
      const newer = await reserve(owner.fence); const newerSource = await capture(newer);
      expect(await store.recordPlayerDirectoryCapture(reserved.attempt, source, owner.fence)).toMatchObject({ status: 'preserved', reason: 'stale_attempt' });
      // Deliberately skewed collector clocks prove no app/DB cross-clock comparison.
      const skewed = { ...newerSource, requestStartedAt: '2026-10-09T00:00:00.000Z', requestCompletedAt: '2026-10-09T00:00:01.000Z',
        sourceObservedAt: '2026-10-09T00:00:01.000Z', sourceSlices: newerSource.sourceSlices.map(slice => ({ ...slice, observedAt: '2026-10-09T00:00:01.000Z' })) };
      expect(await store.recordPlayerDirectoryCapture(newer, skewed, owner.fence)).toMatchObject({ status: 'accepted' });
      const after = await history();
      await expect(store.recordPlayerDirectoryCapture(newer, newerSource, owner.fence)).rejects.toThrow('receipt conflict');
      expect(await history()).toEqual(after);
      const positiveAttempt = await reserve(owner.fence); const positiveSource = await capture(positiveAttempt);
      const [sourceClock] = await connection.database.query('SELECT clock_timestamp() AS at');
      const positiveAt = new Date(new Date(sourceClock.at as string).getTime() + 3_600_000).toISOString();
      const positive = { ...positiveSource, requestStartedAt: positiveAt, requestCompletedAt: positiveAt, sourceObservedAt: positiveAt,
        sourceSlices: positiveSource.sourceSlices.map(slice => ({ ...slice, observedAt: positiveAt })),
        rows: positiveSource.rows.map(row => ({ ...row, source: { forged: true } })) };
      expect(await store.recordPlayerDirectoryCapture(positiveAttempt, positive, owner.fence)).toMatchObject({ status: 'accepted' });
      expect((await available()).rows.map(row => row.source)).toEqual(positiveSource.rows.map(row => row.source));
      expect((await available()).version.sourceObservedAt).toBe(positiveAt);
      expect(await connection.database.query(`SELECT capture.source_observed_at>capture.recorded_at AS positive
        FROM public.league_player_directory_captures capture WHERE attempt_id=$1`, [positiveAttempt.id])).toEqual([{ positive: true }]);
      expect(await connection.database.query(`SELECT capture.request_started_at<attempt.reserved_at AS negative
        FROM public.league_player_directory_captures capture JOIN public.league_player_directory_attempts attempt ON attempt.id=capture.attempt_id
        WHERE attempt.id=$1`, [newer.id])).toEqual([{ negative: true }]);
      await expect(connection.database.query('SELECT public.begin_player_directory_attempt($1,NULL)', [randomUUID()])).rejects.toThrow('owner required');
      await expect(connection.database.query('SELECT public.record_player_directory_capture($1,$2,NULL)',
        [JSON.stringify(newer), JSON.stringify(skewed)])).rejects.toThrow('owner required');
    } finally { await other.close(); await owner.finish(); }
  }, 60_000);

  it('denies direct history mutation and private helpers and restores late optional grants', async () => {
    for (const suffix of ['heads', 'attempts', 'contents', 'entries', 'captures', 'source_slices', 'versions']) {
      const relation = 'public.league_player_directory_' + suffix;
      const [privileges] = await connection.database.query(`SELECT has_table_privilege(current_user,$1,'SELECT') AS readable,
        has_table_privilege(current_user,$1,'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') AS writable`, [relation]);
      expect(privileges).toEqual({ readable: true, writable: false });
      await expect(connection.database.query(`DELETE FROM ${relation}`)).rejects.toThrow(/permission denied/u);
      if (suffix !== 'heads') await expect(ownerQuery(`UPDATE ${relation} SET ${suffix === 'entries' ? 'content_id=content_id' : suffix === 'source_slices' ? 'capture_id=capture_id' : 'id=id'}`)).rejects.toThrow();
    }
    for (const helper of ['public.player_directory_native_row(text,jsonb)', 'public.player_directory_json_shape(text)',
      'public.assert_player_directory_owner(jsonb)', 'public.validate_player_directory_lineage()', 'public.admit_public_data_dispatch_v40(jsonb,jsonb)']) {
      const [permission] = await connection.database.query(`SELECT has_function_privilege(current_user,$1,'EXECUTE') AS executable,
        EXISTS(SELECT 1 FROM pg_proc proc,aclexplode(coalesce(proc.proacl,acldefault('f',proc.proowner))) privilege
          WHERE proc.oid=$1::regprocedure AND privilege.grantee=0 AND privilege.privilege_type='EXECUTE') AS public_executable`, [helper]);
      expect(permission).toEqual({ executable: false, public_executable: false });
    }
    await expect(connection.database.query("SELECT public.player_directory_json_shape('{}')")).rejects.toThrow(/permission denied/u);
    const provisioner = await readFile(new URL('../scripts/provision-runtime-role.sql', import.meta.url), 'utf8');
    const marker = provisioner.match(/-- BEGIN OPTIONAL SHARED PLAYER DIRECTORY GRANTS([\s\S]*?)-- END OPTIONAL SHARED PLAYER DIRECTORY GRANTS/u)?.[1];
    if (!marker) throw new Error('Missing maintained optional grant block.');
    let restored = false;
    try {
      await ownerQuery('REVOKE ALL ON FUNCTION public.begin_player_directory_attempt(uuid,jsonb),public.record_player_directory_capture(jsonb,jsonb,jsonb) FROM league_one_runtime');
      expect(await connection.database.query(`SELECT has_function_privilege(current_user,'public.begin_player_directory_attempt(uuid,jsonb)','EXECUTE') AS reserve,
        has_function_privilege(current_user,'public.record_player_directory_capture(jsonb,jsonb,jsonb)','EXECUTE') AS record`)).toEqual([{ reserve: false, record: false }]);
      await expect(connection.database.query('SELECT public.begin_player_directory_attempt($1,NULL)', [randomUUID()])).rejects.toThrow(/permission denied/u);
      await ownerQuery(marker); await ownerQuery(marker); restored = true;
      expect(await connection.database.query(`SELECT has_function_privilege(current_user,'public.begin_player_directory_attempt(uuid,jsonb)','EXECUTE') AS reserve,
        has_function_privilege(current_user,'public.record_player_directory_capture(jsonb,jsonb,jsonb)','EXECUTE') AS record`)).toEqual([{ reserve: true, record: true }]);
      const owner = await claim();
      try { expect(await store.beginPlayerDirectoryAttempt(randomUUID(), owner.fence)).toMatchObject({ status: 'backoff' }); }
      finally { await owner.finish(); }
    } finally { if (!restored) await ownerQuery(marker); }
  }, 60_000);

  it('preserves shared admission and daily limits through failed capture and an observed lock expiry', async () => {
    const owner = await claim(8_000); const runtime = await createPinnedIntegrationDatabase();
    const blocker = await createPinnedIntegrationDatabase('owner'); let locked = false; let pending: Promise<unknown> | undefined;
    try {
      const writer = createLeagueAdministrationStore(runtime.database); const attempt = await reserve(owner.fence, writer);
      expect(await writer.beginPlayerDirectoryAttempt(randomUUID(), owner.fence)).toMatchObject({ status: 'backoff' });
      expect(await writer.beginPlayerDirectoryAttempt(attempt.id, owner.fence)).toMatchObject({ status: 'backoff' });
      const source = await capture(attempt); const before = await history();
      await runtime.database.query("SET statement_timeout='15s'");
      const [runtimePid] = await runtime.database.query('SELECT pg_backend_pid() AS pid');
      const [blockerPid] = await blocker.database.query('SELECT pg_backend_pid() AS pid');
      await blocker.database.query('BEGIN'); locked = true;
      await blocker.database.query("SELECT 1 FROM public.league_player_directory_heads WHERE provider='sleeper' AND sport='nfl' FOR UPDATE");
      pending = writer.recordPlayerDirectoryCapture(attempt, source, owner.fence).then(value => ({ value }), error => ({ error }));
      let observed = false;
      for (let count = 0; count < 100; count++) {
        const [state] = await blocker.database.query('SELECT $2::integer=ANY(pg_blocking_pids($1::integer)) AS blocked,clock_timestamp()<$3::timestamptz AS live',
          [runtimePid.pid, blockerPid.pid, owner.fence.deadlineAt]);
        if (state.blocked === true) { expect(state.live).toBe(true); observed = true; break; }
        await delay(25);
      }
      expect(observed).toBe(true);
      while (true) {
        const [state] = await blocker.database.query('SELECT clock_timestamp()>$1::timestamptz AS expired', [owner.fence.deadlineAt]);
        if (state.expired === true) break;
        await delay(50);
      }
      await blocker.database.query('ROLLBACK'); locked = false;
      expect(await pending).toHaveProperty('error'); pending = undefined;
      expect(await history()).toEqual(before);
      expect((await available()).latestAttempt).toMatchObject({ attemptId: attempt.id, status: 'pending' });
    } finally {
      if (locked) await blocker.database.query('ROLLBACK');
      await pending; await Promise.all([blocker.close(), runtime.close()]); await owner.finish();
    }
    const replacement = await claim();
    try {
      // A failed publication/crash-before-receipt still consumed the daily attempt.
      expect(await store.beginPlayerDirectoryAttempt(randomUUID(), replacement.fence)).toMatchObject({ status: 'backoff' });
      const [cadence] = await connection.database.query(`SELECT next_network_at-last_network_at=interval '24 hours' AS daily
        FROM public.league_player_directory_heads WHERE provider='sleeper' AND sport='nfl'`);
      expect(cadence.daily).toBe(true);
    } finally { await replacement.finish(); }
    // Real restricted admission in both directions; no source request is made.
    const intake = createPublicIntakeStore(connection.database); const requestId = randomUUID();
    await intake.submit({ id: requestId, username: 'directory_budget_fixture', seasons: [2026] });
    const jobs = createProjectionStore(connection.database); const workerId = randomUUID();
    const ordinary = await jobs.acquireJob({ jobKey: PUBLIC_INTAKE_JOB, jobType: PUBLIC_INTAKE_JOB, workerId,
      scheduledFor: new Date().toISOString(), leaseSeconds: 25, payload: { requestId, policy: 'public-data-intake-v1' } });
    if (ordinary.kind !== 'acquired') throw new Error('Ordinary budget fixture owner unavailable.');
    const finishOrdinary = trackOwner(jobs, workerId);
    const ordinaryFence = { jobKey: PUBLIC_INTAKE_JOB, workerId, generation: ordinary.attempt,
      deadlineAt: new Date(Date.now() + 20_000).toISOString() };
    try {
      const work = await intake.next(requestId); if (typeof work === 'string') throw new Error('Missing ordinary fixture work.');
      const capacityBefore = await connection.database.query('SELECT count(*)::integer AS count FROM public.public_data_collection_reservations');
      expect(await intake.admit(work, ordinaryFence)).toBe(false);
      expect(await connection.database.query('SELECT count(*)::integer AS count FROM public.public_data_collection_reservations')).toEqual(capacityBefore);
      expect(await connection.database.query('SELECT 1 FROM public.public_data_dispatches WHERE worker_id=$1', [workerId])).toEqual([]);
      await syntheticCadencePrerequisite();
      const admitted = await intake.admit(work, ordinaryFence);
      if (admitted) pendingDispatches.set(workerId, work);
      expect(admitted).toBe(true);
    } finally {
      try {
        const unfinished = pendingDispatches.get(workerId);
        if (unfinished) { await intake.fail(unfinished, ordinaryFence); pendingDispatches.delete(workerId); }
      } finally { await finishOrdinary(); }
    }
    const afterOrdinary = await claim();
    try { expect(await store.beginPlayerDirectoryAttempt(randomUUID(), afterOrdinary.fence)).toMatchObject({ status: 'backoff' }); }
    finally { await afterOrdinary.finish(); }
    // Fresh owner-created negative premises only: this does not claim source
    // acquisition or elapsed approval. No existing immutable row is changed.
    for (const paused of [true, false]) {
      const request = randomUUID(); const manager = randomUUID(); const target = randomUUID();
      const external = BigInt('0x' + randomUUID().replaceAll('-', '').slice(0, 24)).toString();
      await ownerQuery(`WITH manager AS (
          INSERT INTO public.league_source_manager_accounts(id,provider,external_manager_id)
          VALUES($1,'sleeper',$4) RETURNING id
        ), request AS (
          INSERT INTO public.public_data_intakes(id,username,seasons) VALUES($2,'directory_negative_fixture',ARRAY[2026]) RETURNING id
        ), identity AS (
          INSERT INTO public.public_data_identity_observations(intake_id,source_manager_account_id,username,display_name,payload,request_started_at,request_completed_at)
          SELECT request.id,manager.id,'directory_negative_fixture','Synthetic admission premise','{}',statement_timestamp(),statement_timestamp()
          FROM request,manager RETURNING intake_id
        ), list AS (
          INSERT INTO public.public_data_league_lists(intake_id,season,payload,request_started_at,request_completed_at)
          SELECT intake_id,2026,'[]',statement_timestamp(),statement_timestamp() FROM identity RETURNING intake_id,season
        ), candidate AS (
          INSERT INTO public.public_data_league_candidates(intake_id,season,external_league_id,name)
          SELECT intake_id,season,$4,'Synthetic admission premise' FROM list RETURNING intake_id
        ), target AS (
          INSERT INTO public.public_data_refresh_targets(id,provider,source_manager_account_id,configuration_revision)
          SELECT $3,'sleeper',id,1 FROM manager RETURNING id
        ), configuration AS (
          INSERT INTO public.public_data_refresh_configurations(target_id,revision,identity_request_id,seasons,cadence_seconds,expires_at,paused)
          SELECT target.id,1,identity.intake_id,ARRAY[2026],60,
            statement_timestamp()+CASE WHEN $5::boolean THEN interval '1 hour' ELSE interval '-1 hour' END,$5
          FROM target,identity RETURNING target_id,revision
        ) INSERT INTO public.public_data_refresh_cycles(target_id,cycle,configuration_revision,intake_id,due_at)
          SELECT target_id,1,revision,candidate.intake_id,statement_timestamp() FROM configuration,candidate`,
      [manager, request, target, external, paused]);
      await ownerQuery('UPDATE public.public_data_refresh_targets SET current_cycle=1 WHERE id=$1', [target]);
      await syntheticCadencePrerequisite();
      const selected = await claim(20_000, connection.database, { requestId: request, policy: 'public-data-refresh-v1', mode: 'recurring',
        refreshSelection: { status: 'selected', targetId: target, configurationRevision: 1,
          cycleConfigurationRevision: 1, cycle: 1, requestId: request } });
      try {
        const work = await intake.next(request);
        if (typeof work === 'string' || work.kind !== 'bootstrap') throw new Error('Missing synthetic negative bootstrap premise.');
        const before = await history();
        const capacityBefore = await connection.database.query('SELECT count(*)::integer AS count FROM public.public_data_collection_reservations');
        const fence = { ...selected.fence, reserveCollection: true };
        expect(await intake.admit(work, fence)).toBe(false);
        expect(await connection.database.query('SELECT count(*)::integer AS count FROM public.public_data_collection_reservations')).toEqual(capacityBefore);
        expect(await connection.database.query('SELECT 1 FROM public.public_data_collection_reservations WHERE external_league_id=$1', [external])).toEqual([]);
        expect(await connection.database.query('SELECT 1 FROM public.public_data_dispatches WHERE worker_id=$1', [fence.workerId])).toEqual([]);
        expect(await history()).toEqual(before);
      } finally { await selected.finish(); }
    }
  }, 60_000);
});
