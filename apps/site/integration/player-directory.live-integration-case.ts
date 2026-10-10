import { createHash } from 'node:crypto';
import { neonConfig } from '@neondatabase/serverless';
import { afterAll, beforeAll, describe, it } from 'vitest';
import { createDatabase, withDatabaseAbortSignal, type DatabaseClient, type DatabaseRow } from '../lib/database';
import { createProjectionStore } from '../lib/projection-store';
import { createLeagueAdministrationStore, createPublicIntakeStore } from '../lib/league-administration/store';
import { runPublicPlayerDirectoryStep } from '../lib/league-administration/public-intake';
import { PUBLIC_INTAKE_JOB } from '../lib/league-administration/public-intake-contracts';
import { PLAYER_DIRECTORY_RESPONSE_LIMITS } from '../lib/sleeper-player-catalog';
import { PLAYER_DIRECTORY_STORE_MAX_BYTES } from '../lib/league-administration/neon/player-directory';
import { PLAYER_DIRECTORY_MAX_ROWS, PLAYER_DIRECTORY_PAGE_LIMIT, type PlayerDirectoryCapture,
  type PlayerDirectoryRead, type PlayerDirectoryRow } from '../lib/league-administration/player-directory-contracts';
import { compatibleRevision } from '../lib/projections/shared/revision-compatibility';
import { integrationEnvironment } from './neon-integration-harness';
import { writeIntegrationArtifact } from './integration-artifacts';
import { qualificationDigest, requireLivePlayerDirectoryQualification } from './qualification-profile';

// Refuse default/direct collection before database or provider access. Existing
// global setup owns isolated identity, schema, restricted LOGIN and final cleanup.
const binding = requireLivePlayerDirectoryQualification();
const SOURCE_URL = 'https://api.sleeper.app/v1/players/nfl';
const WORK_MS = 20_000, CLEANUP_MS = 2_000;
const MAX_PAGES = Math.ceil(PLAYER_DIRECTORY_MAX_ROWS / PLAYER_DIRECTORY_PAGE_LIMIT);
type Stage = 'preflight' | 'claim' | 'reserve' | 'source' | 'write' | 'complete' | 'read' | 'metadata' | 'cleanup' | 'proof';
type Failure = { stage: Stage; code: string; sqlState: string | null; aborted: boolean };
function check(condition: unknown, code: string): asserts condition {
  if (!condition) throw new Error('live-player-directory:' + code);
}
function safeFailure(stage: Stage, error: unknown): Failure {
  let code = 'operation_failed', sqlState: string | null = null, aborted = false;
  try {
    if (error instanceof Error && /^live-player-directory:[a-z0-9_]+$/u.test(error.message)) code = error.message.split(':')[1];
    if (error && typeof error === 'object') {
      const state = Reflect.get(error, 'code'), name = Reflect.get(error, 'name');
      if (typeof state === 'string' && /^[0-9A-Z]{5}$/u.test(state)) sqlState = state;
      aborted = name === 'AbortError' || name === 'TimeoutError';
    }
  } catch { /* Never inspect/log driver messages, causes, URLs, headers or bodies. */ }
  return { stage, code, sqlState, aborted };
}
function shape(value: unknown) {
  const pending = [{ value, depth: 1 }]; let values = 0, maxDepth = 0;
  while (pending.length) {
    const item = pending.pop()!; values++; maxDepth = Math.max(maxDepth, item.depth);
    check(values <= PLAYER_DIRECTORY_RESPONSE_LIMITS.maxValues && maxDepth <= PLAYER_DIRECTORY_RESPONSE_LIMITS.maxDepth, 'source_shape_bound');
    if (item.value !== null && typeof item.value === 'object') {
      for (const child of Object.values(item.value)) pending.push({ value: child, depth: item.depth + 1 });
    }
  }
  return { values, maxDepth };
}

/** A single observation, not recurring-refresh or cold-start qualification. Runtime
 * Neon HTTP is used because the integration Pool.query adapter ignores abort options.
 * Setup/identity preflight and artifact writing are outside work; claim, reservation,
 * the original strict capture, durable acceptance, completion and ALL reader pages
 * share one original 20s clock. Observer and parity CPU cost is included. No owner
 * setup shifts clocks, grants privileges, substitutes source or retries acquisition. */
describe.sequential('live Sleeper full player directory within the existing work deadline', () => {
  let database: DatabaseClient;
  let databaseEndpoint = '';
  const originalFetch = globalThis.fetch;
  let workStarted = 0, sourceStarted = 0, currentStage: Stage = 'preflight';
  let captured: PlayerDirectoryCapture | null = null;
  const evidence = {
    kind: 'live-player-directory-capacity-v1', contextDigest: qualificationDigest(binding.context),
    limits: { workMs: WORK_MS, cleanupMs: CLEANUP_MS, ...PLAYER_DIRECTORY_RESPONSE_LIMITS,
      maxRows: PLAYER_DIRECTORY_MAX_ROWS, pageRows: PLAYER_DIRECTORY_PAGE_LIMIT, maxPages: MAX_PAGES,
      captureEnvelopeBytes: PLAYER_DIRECTORY_STORE_MAX_BYTES, providerRequests: 1 },
    clock: 'performance.now; absolute Date deadline passed to existing owner',
    databaseTransport: 'existing Neon HTTP', preflightOutsideWork: true, nodeVersion: process.version,
    rawPersistence: 'Original decoded source retained in isolated SQL only until supervisor cleanup; artifact retains hashes and counts.',
    postgresVersion: null as string | null, postgresVersionNumber: null as string | null,
    providerRequests: 0, providerStatus: null as number | null, responseStreamBytes: 0,
    sourceBodyElapsedMs: null as number | null, strictCaptureElapsedMs: null as number | null,
    sourceStageMeaning: 'source stage ends at response headers; body/strict capture have separate monotonic metrics.',
    rawTextUtf8Bytes: null as number | null, sourceRevision: null as string | null,
    values: null as number | null, depth: null as number | null, nativeRows: null as number | null,
    captureStatus: null as string | null, captureReasons: [] as string[], compactCaptureBytes: null as number | null,
    postgresCaptureJsonbTextBytes: null as number | null, storedRawTextUtf8Bytes: null as number | null,
    neonHttpRequests: 0, neonHttpRequestBytes: [] as number[], observedWrites: 0,
    httpByteMeaning: 'Observed instrumented HTTP request body; measurement SELECT adds SQL text bytes.',
    stages: [] as { stage: Stage; startedMs: number; elapsedMs: number; ok: boolean }[],
    failures: [] as Failure[], pages: 0, rowsRead: 0, terminalCursor: false, fullParity: false,
    acceptedVersionId: null as string | null, contentId: null as string | null, receiptId: null as string | null,
    acquisitionElapsedMs: null as number | null, workElapsedMs: null as number | null,
    cleanupElapsedMs: null as number | null, passed: false,
  };
  function fail(stage: Stage, error: unknown) {
    if (evidence.failures.length < 16) evidence.failures.push(safeFailure(stage, error));
  }
  async function observe<T>(stage: Stage, operation: () => Promise<T>): Promise<T> {
    const previous = currentStage; currentStage = stage;
    const start = performance.now(); let ok = false;
    try { const value = await operation(); ok = true; return value; }
    catch (error) { fail(stage, error); throw new Error('live-player-directory:stage_failed'); }
    finally {
      if (stage === 'cleanup') evidence.cleanupElapsedMs = (evidence.cleanupElapsedMs ?? 0) + performance.now() - start;
      if (evidence.stages.length < MAX_PAGES + 24) evidence.stages.push({ stage,
        startedMs: workStarted ? start - workStarted : 0, elapsedMs: performance.now() - start, ok });
      currentStage = previous;
    }
  }
  beforeAll(async () => {
    try {
      const environment = integrationEnvironment();
      // This URL comes only from the existing supervisor's guarded runtime identity.
      const runtime = new URL(environment.runtimeDatabaseUrl);
      check(decodeURIComponent(runtime.username) === 'league_one_runtime', 'runtime_role_url');
      check(neonConfig.fetchFunction === undefined, 'custom_database_fetch');
      const endpoint = neonConfig.fetchEndpoint;
      databaseEndpoint = typeof endpoint === 'function' ? endpoint(runtime.hostname, runtime.port || 5432) : endpoint;
      const target = new URL(databaseEndpoint);
      check(target.protocol === 'https:' && !target.username && !target.password && target.pathname === '/sql'
        && !target.search && !target.hash, 'database_http_endpoint');
      const client = createDatabase(environment.runtimeDatabaseUrl);
      check(client.enabled, 'runtime_database_disabled'); database = client;
      const preflight = withDatabaseAbortSignal(database, AbortSignal.timeout(5_000));
      check(preflight.enabled, 'preflight_disabled');
      const [identity] = await observe('preflight', () => preflight.query(`SELECT current_user,session_user,
        version() AS version,current_setting('server_version_num') AS version_number,rolsuper,rolcreaterole,rolcreatedb
        FROM pg_roles WHERE rolname=current_user`));
      check(identity.current_user === 'league_one_runtime' && identity.session_user === 'league_one_runtime'
        && identity.rolsuper === false && identity.rolcreaterole === false && identity.rolcreatedb === false, 'runtime_identity');
      check(typeof identity.version === 'string' && identity.version.startsWith('PostgreSQL ')
        && identity.version.length <= 512 && !/[\x00-\x1f\x7f]/u.test(identity.version), 'postgres_version');
      check(typeof identity.version_number === 'string' && /^\d{5,8}$/u.test(identity.version_number), 'postgres_version_number');
      evidence.postgresVersion = identity.version; evidence.postgresVersionNumber = identity.version_number;
      const [fresh] = await observe('preflight', () => preflight.query(`SELECT
        (SELECT jsonb_build_object('generation',generation,'ordinal',latest_ordinal,'last',last_network_at,
          'next',next_network_at,'version',accepted_version_id) FROM public.league_player_directory_heads
          WHERE provider='sleeper' AND sport='nfl') AS head,
        (SELECT count(*)::integer FROM public.league_player_directory_attempts) AS attempts,
        (SELECT count(*)::integer FROM public.league_player_directory_contents) AS contents,
        (SELECT count(*)::integer FROM public.league_player_directory_captures) AS captures,
        (SELECT count(*)::integer FROM public.league_player_directory_versions) AS versions,
        (SELECT count(*)::integer FROM public.league_player_directory_entries) AS entries`));
      const head = fresh?.head as Record<string, unknown> | null;
      check(fresh && [fresh.attempts, fresh.contents, fresh.captures, fresh.versions, fresh.entries].every(value => value === 0)
        && (head === null || Number(head.generation) === 0 && Number(head.ordinal) === 0
          && head.last === null && head.next === null && head.version === null), 'fresh_directory_required');
    } catch (error) { fail('preflight', error); throw new Error('Live directory preflight failed; see sanitized artifact.'); }
  }, 10_000);
  afterAll(async () => {
    globalThis.fetch = originalFetch;
    await writeIntegrationArtifact('live-player-directory-capacity.json', evidence);
  }, 5_000);

  it('fetches stores and reads every native row under one real twenty-second owner budget', async () => {
    const startedAt = Date.now(); workStarted = performance.now();
    const workDeadline = startedAt + WORK_MS;
    const signal = AbortSignal.timeout(WORK_MS);
    let requestedWorker: string | null = null, ownerSettled = false, cleanupAttempted = false; currentStage = 'proof';
    const deadline = () => {
      check(performance.now() - workStarted < WORK_MS && Date.now() < workDeadline, 'original_work_deadline');
      signal.throwIfAborted();
    };
    // No tee/clone or second parser consumes the source stream. This observer only
    // counts already decoded fetch-body chunks as the existing strict reader pulls.
    globalThis.fetch = async (input, init) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      if (url === SOURCE_URL) {
        check(evidence.providerRequests === 0, 'extra_provider_request');
        check((init?.method ?? 'GET') === 'GET' && init?.redirect === 'error' && init?.cache === 'no-store'
          && init.signal && !init.signal.aborted, 'source_request_options');
        evidence.providerRequests++; sourceStarted = performance.now();
        return observe('source', async () => {
          const response = await originalFetch(input, init); evidence.providerStatus = response.status;
          check(!response.redirected, 'source_redirect');
          if (!response.body) return response;
          const body = response.body.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({ transform(chunk, controller) {
            evidence.responseStreamBytes += chunk.byteLength;
            controller.enqueue(chunk);
          }, flush() { evidence.sourceBodyElapsedMs = performance.now() - sourceStarted; } }));
          return new Response(body, { status: response.status, statusText: response.statusText, headers: response.headers });
        });
      }
      check(url === databaseEndpoint && init?.method === 'POST' && typeof init.body === 'string'
        && init.signal, 'unexpected_http_request');
      check(evidence.neonHttpRequests < MAX_PAGES + 16, 'database_request_bound');
      evidence.neonHttpRequests++; evidence.neonHttpRequestBytes.push(Buffer.byteLength(init.body, 'utf8'));
      try { return await originalFetch(input, init); }
      catch (error) { fail(currentStage, error); throw new Error('live-player-directory:http_failed'); }
    };
    const observedDatabase: DatabaseClient = {
      ...database,
      async query<Row extends DatabaseRow = DatabaseRow>(statement: string, parameters: readonly unknown[] = [], options = {}) {
        // Diagnostic projection only: unchanged function and parameters, no extra
        // upload or mutation. Its server serialization cost stays inside 20s.
        const recording = statement.includes('record_player_directory_capture');
        if (recording) {
          check(statement.trim().replace(/\s+/gu, ' ') === '/* league-administration:record-player-directory */ SELECT public.record_player_directory_capture($1::jsonb,$2::jsonb,$3::jsonb) AS result'
            && parameters.length === 3 && evidence.observedWrites === 0, 'exact_maintained_write_statement');
          evidence.observedWrites++;
        }
        const measured = recording ? statement + ', octet_length($2::jsonb::text) AS qualification_capture_jsonb_bytes' : statement;
        let rows: readonly Row[];
        try { rows = await database.query<Row>(measured, parameters, options); }
        catch (error) { fail(currentStage, error); throw new Error('live-player-directory:database_query_failed'); }
        if (recording && rows.length === 1) {
          const bytes = Number(rows[0].qualification_capture_jsonb_bytes);
          check(Number.isSafeInteger(bytes) && bytes >= 0, 'postgres_envelope_metric');
          evidence.postgresCaptureJsonbTextBytes = bytes;
        }
        return rows;
      },
    };
    const bounded = withDatabaseAbortSignal(observedDatabase, signal);
    check(bounded.enabled, 'work_database_disabled');
    const administration = createLeagueAdministrationStore(bounded), jobs = createProjectionStore(bounded);
    const cleanup = () => {
      const remaining = Math.max(0, Math.min(CLEANUP_MS, startedAt + WORK_MS + CLEANUP_MS - Date.now()));
      const cleanupSignal = remaining > 0 ? AbortSignal.timeout(remaining) : AbortSignal.abort(new Error('Cleanup deadline exhausted.'));
      const cleanupDatabase = withDatabaseAbortSignal(database, cleanupSignal);
      check(cleanupDatabase.enabled, 'cleanup_disabled');
      const cleanupJobs = createProjectionStore(cleanupDatabase);
      return { intake: createPublicIntakeStore(cleanupDatabase), jobs: { ...cleanupJobs,
        failJob: (...args: Parameters<typeof cleanupJobs.failJob>) => observe('cleanup', async () => {
          cleanupAttempted = true; const result = await cleanupJobs.failJob(...args); if (result) ownerSettled = true; return result;
        }) } };
    };
    try {
      const outcome = await runPublicPlayerDirectoryStep({ intake: createPublicIntakeStore(bounded),
        administration: { ...administration,
          beginPlayerDirectoryAttempt: (...args) => observe('reserve', () => administration.beginPlayerDirectoryAttempt(...args)),
          recordPlayerDirectoryCapture: (...args) => observe('write', async () => {
            evidence.strictCaptureElapsedMs = performance.now() - sourceStarted;
            captured = args[1]; evidence.captureStatus = captured.status; evidence.captureReasons = [...captured.reasons];
            evidence.sourceRevision = captured.sourceRevision; evidence.nativeRows = captured.rows.length;
            evidence.rawTextUtf8Bytes = captured.rawJson === null ? null : Buffer.byteLength(captured.rawJson, 'utf8');
            evidence.compactCaptureBytes = Buffer.byteLength(JSON.stringify(captured), 'utf8');
            deadline(); const result = await administration.recordPlayerDirectoryCapture(...args); deadline(); return result;
          }) },
        jobs: { ...jobs,
          acquireJob: (...args) => observe('claim', async () => { requestedWorker = args[0].workerId; return jobs.acquireJob(...args); }),
          completeJob: (...args) => observe('complete', async () => { const result = await jobs.completeJob(...args); if (result) ownerSettled = true; return result; }),
        }, deadlineAt: new Date(workDeadline).toISOString(), cleanup }, signal);
      evidence.acquisitionElapsedMs = performance.now() - workStarted; deadline();
      check(outcome.status === 'progress' && outcome.providerRequests === 1 && outcome.result?.status === 'accepted', 'fresh_acceptance_required');
      const source = captured as PlayerDirectoryCapture | null;
      check(source?.status === 'complete' && source.rawJson !== null && source.duplicateMemberCount === 0, 'complete_original_capture');
      check(source.sourceRevision === 'sha256:' + createHash('sha256').update(source.rawJson).digest('hex'), 'source_revision');
      const parsed: unknown = JSON.parse(source.rawJson);
      check(parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed), 'native_object');
      const dimensions = shape(parsed); evidence.values = dimensions.values; evidence.depth = dimensions.maxDepth;
      const expected = [...source.rows].sort((left, right) => Buffer.compare(Buffer.from(left.externalPlayerId), Buffer.from(right.externalPlayerId)));
      const nativeIds = Object.keys(parsed).sort((left, right) => Buffer.compare(Buffer.from(left), Buffer.from(right)));
      check(compatibleRevision(expected.map(row => row.externalPlayerId)) === compatibleRevision(nativeIds), 'whole_native_id_set');
      const originalRows = parsed as Record<string, unknown>;
      for (const row of expected) check(compatibleRevision(row.source) === compatibleRevision(originalRows[row.externalPlayerId]), 'original_raw_row_parity');
      deadline();
      const acceptedVersionId = outcome.result.acceptedVersionId;
      check(acceptedVersionId && outcome.result.contentId && outcome.result.receiptId, 'accepted_identity');
      evidence.acceptedVersionId = acceptedVersionId; evidence.contentId = outcome.result.contentId; evidence.receiptId = outcome.result.receiptId;
      let cursor: string | undefined, offset = 0, versionFingerprint: string | null = null;
      const cursors = new Set<string>();
      do {
        deadline(); check(evidence.pages < MAX_PAGES, 'page_count_bound');
        const page: PlayerDirectoryRead = await observe('read', (): Promise<PlayerDirectoryRead> => administration.readAcceptedPlayerDirectory({ versionId: acceptedVersionId,
          limit: PLAYER_DIRECTORY_PAGE_LIMIT, ...(cursor === undefined ? {} : { afterPlayerId: cursor }) }));
        deadline(); check(page.status === 'available', 'stored_reader_available');
        evidence.pages++;
        check(page.version.versionId === acceptedVersionId && page.version.contentId === outcome.result.contentId
          && page.version.receiptId === outcome.result.receiptId && page.version.attemptId === source.attemptId
          && page.version.sourceRevision === source.sourceRevision && page.version.rowCount === expected.length
          && page.version.requestStartedAt === source.requestStartedAt && page.version.requestCompletedAt === source.requestCompletedAt
          && page.version.sourceObservedAt === source.sourceObservedAt, 'version_source_provenance');
        const fingerprint = compatibleRevision(page.version);
        check(versionFingerprint === null || versionFingerprint === fingerprint, 'version_changed_between_pages'); versionFingerprint = fingerprint;
        check(page.rows.length > 0 && page.rows.length <= PLAYER_DIRECTORY_PAGE_LIMIT, 'page_row_count');
        const expectedPage: readonly PlayerDirectoryRow[] = expected.slice(offset, offset + page.rows.length);
        // Whole-row equality includes every typed field, state and unknown native
        // source key/value; this is not a selected-column or ID-only comparison.
        check(compatibleRevision(page.rows) === compatibleRevision(expectedPage), 'whole_row_parity');
        offset += page.rows.length; evidence.rowsRead = offset;
        if (page.nextCursor === null) { evidence.terminalCursor = true; break; }
        check(page.nextCursor === page.rows.at(-1)?.externalPlayerId && !cursors.has(page.nextCursor), 'nonprogress_cursor');
        cursors.add(page.nextCursor); cursor = page.nextCursor; deadline();
      } while (true);
      check(evidence.terminalCursor && offset === expected.length && offset === nativeIds.length, 'complete_reader_coverage');
      const [stored] = await observe('metadata', () => bounded.query(`SELECT content.source_revision,content.row_count,
        octet_length(content.raw_json) AS raw_bytes,
        'sha256:'||encode(pg_catalog.sha256(convert_to(content.raw_json,'UTF8')),'hex') AS raw_revision,
        (SELECT count(*)::integer FROM public.league_player_directory_entries WHERE content_id=content.id) AS stored_rows
        FROM public.league_player_directory_contents content WHERE content.id=$1::uuid`, [outcome.result!.contentId]));
      check(stored && stored.source_revision === source.sourceRevision && stored.raw_revision === source.sourceRevision
        && Number(stored.row_count) === expected.length
        && Number(stored.stored_rows) === expected.length && Number(stored.raw_bytes) === evidence.rawTextUtf8Bytes, 'stored_content_metadata');
      evidence.storedRawTextUtf8Bytes = Number(stored.raw_bytes);
      check(evidence.providerRequests === 1 && evidence.observedWrites === 1 && evidence.responseStreamBytes <= PLAYER_DIRECTORY_RESPONSE_LIMITS.maxBytes
        && evidence.rawTextUtf8Bytes! <= PLAYER_DIRECTORY_RESPONSE_LIMITS.maxBytes && expected.length <= PLAYER_DIRECTORY_MAX_ROWS
        && evidence.compactCaptureBytes! <= PLAYER_DIRECTORY_STORE_MAX_BYTES
        && evidence.postgresCaptureJsonbTextBytes !== null && evidence.postgresCaptureJsonbTextBytes <= PLAYER_DIRECTORY_STORE_MAX_BYTES, 'declared_resource_bounds');
      currentStage = 'proof'; deadline(); evidence.workElapsedMs = performance.now() - workStarted;
      check(evidence.workElapsedMs < WORK_MS, 'final_monotonic_deadline'); evidence.fullParity = true; evidence.passed = true;
    } catch (error) {
      fail(currentStage, error); evidence.workElapsedMs = performance.now() - workStarted;
      throw new Error('Live directory work failed; see sanitized capacity artifact.');
    } finally {
      if (requestedWorker && !ownerSettled && !cleanupAttempted) {
        try { await cleanup().jobs.failJob(PUBLIC_INTAKE_JOB, requestedWorker, 'live-player-directory-qualification-cleanup'); }
        catch (error) { fail('cleanup', error); }
      }
      globalThis.fetch = originalFetch;
    }
  }, 45_000);
});
