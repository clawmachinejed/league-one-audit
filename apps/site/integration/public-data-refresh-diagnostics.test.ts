import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash, randomUUID } from 'node:crypto';
import http from 'node:http';
import ts from 'typescript';
import { types } from '@neondatabase/serverless';
import { capturePublicSleeperIdentity } from '../lib/sleeper';
import { assertOriginalPublicCapture, validateRequestedPublicCaptureWitness } from '../lib/league-administration/public-capture-witness';
import { assertLiveJson } from './live-league-two';
import { exactMatchupClockInstant } from './exact-matchup-clock';
import { writeIntegrationArtifact } from './integration-artifacts';
import { JOURNEY_LEAGUES, JOURNEY_MANAGER, JOURNEY_SEASON } from './public-data-live';
import { readPublicSleeperIntake } from '../lib/league-administration/public-intake-reader';
import type { AcceptedLeagueSettingsRead } from '../lib/aggregator/league-settings';
import type { CurrentRosterCaptureReceipt } from '../lib/aggregator/season-overview-source-contracts';
import type { PublicCaptureWitness } from '../lib/league-administration/contracts';
import type { TeamManagerRelationships } from '../lib/aggregator/team-managers';
import https from 'node:https';
import net from 'node:net';
import { ReceiptDiagnosticReadError, type ReceiptDiagnosticReader } from './neon-integration-harness';
import { runPublicDataRefreshStep, type PublicIntakeDependencies } from '../lib/league-administration/public-intake';
import { createLeagueAdministrationStore } from '../lib/league-administration/store';
import type { DatabaseRow } from '../lib/database';
import type { PublicIntakeStore } from '../lib/league-administration/public-intake-contracts';
import type { PublicDataRefreshStore } from '../lib/league-administration/public-refresh-contracts';
import type { NormalizedAdministrationObservation } from '../lib/league-administration/contracts';
import { createPublicDataDiagnostics, observePublicDataDependencies } from './public-data-refresh-diagnostics';
import { createQualificationContext, qualificationDigest, LIVE_PROFILE, JOURNEY_PROFILE, INGESTION_PROFILE, QUALIFICATION_CONTEXT_ENV,
  SELECTED_PROFILE, OFFICIAL_PROFILE, GUARDS_PROFILE, CONCURRENCY_PROFILE, LATE_WRITE_PROFILE, INTAKE_RECOVERY_PROFILE,
  REFRESH_HISTORY_PROFILE, PERIOD_RECOVERY_PROFILE, PERIOD_EXHAUSTION_PROFILE, SELECTED_MODULE, type QualificationProfile } from './qualification-profile';
vi.mock('server-only', () => ({}));
vi.mock('next/cache', () => ({ unstable_cache: (fn: unknown) => fn }));

// Run the maintained callback against driver-shaped timing fixtures. This checks
// the oracle's control flow only; it does not qualify PostgreSQL lock behavior.
async function advisoryWaitOracle(mode: 'expired-before-lock' | 'blocked' | 'late-block' | 'source-residue' | 'wrong-rejection' | 'unproved-expiry') {
  const source = await readFile(new URL('./public-data-intake.integration-case.ts', import.meta.url), 'utf8');
  const tree = ts.createSourceFile('advisory.ts', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  let body: ts.Block | undefined;
  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node) && node.expression.getText(tree) === 'it' && ts.isStringLiteral(node.arguments[0])
      && node.arguments[0].text === 'rejects a restricted bootstrap after an advisory wait expires without leaving identity or reservation') {
      const callback = node.arguments[1];
      if (ts.isArrowFunction(callback) && ts.isBlock(callback.body)) body = callback.body;
    }
    ts.forEachChild(node, visit);
  };
  visit(tree); expect(body).toBeDefined();
  vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-09T12:00:00.000Z'));
  const trace: string[] = [], pending = Promise.withResolvers<void>();
  let deadline = 0;
  const work = { requestId: id, revision: 0, kind: 'bootstrap', externalLeagueId: '8123', season: 2182 };
  const query = vi.fn(async (sql: string, parameters?: readonly unknown[]) => {
    if (sql === 'ROLLBACK') {
      trace.push('release');
      if (!['expired-before-lock', 'late-block'].includes(mode)) pending.reject(new Error(mode === 'wrong-rejection' ? 'matching admitted public dispatch required' : 'public intake lease lost'));
    }
    if (sql.includes('pg_backend_pid')) return [{ pid: sql.includes('session_user') ? 101 : 202,
      role: 'league_one_runtime', effective_role: 'league_one_runtime' }];
    if (sql.includes('pg_blocking_pids')) {
      expect(parameters).toEqual([101, 202, new Date(deadline).toISOString()]);
      if (mode === 'late-block') vi.setSystemTime(deadline + 1);
      trace.push('observe');
      return [{ blocked: mode !== 'expired-before-lock', live: Date.now() < deadline }];
    }
    if (sql.includes('clock_timestamp() >=')) {
      trace.push('expiry');
      if (mode === 'unproved-expiry') pending.reject(new Error('statement timeout'));
      return [{ expired: mode !== 'unproved-expiry' && Date.now() >= deadline }];
    }
    if (sql.includes("SELECT 'intake' AS resource")) return ['intake', 'identity', 'list', 'candidate'].map(resource => ({ resource, value: { retained: true } }));
    if (sql.includes('FROM public.league_source_connections') && mode === 'source-residue') return [{ id }];
    return [];
  });
  const intake = { next: vi.fn(async () => work), register: vi.fn(async (_work: unknown, _capture: unknown, fence: { deadlineAt: string }) => {
    trace.push('register'); deadline = Date.parse(fence.deadlineAt);
    if (mode === 'expired-before-lock' || mode === 'late-block') { trace.push('settled'); throw new Error('public intake lease lost'); }
    try { return await pending.promise; } finally { trace.push('settled'); }
  }) };
  const jobs = { acquireJob: vi.fn(async () => ({ kind: 'acquired', attempt: 1 })), failJob: vi.fn(async () => {}) };
  const close = vi.fn(async () => { trace.push('close'); });
  const bindings = { expect, randomUUID, vi, PUBLIC_INTAKE_JOB: 'league-administration-public-intake',
    ownerQuery: vi.fn(async (sql: string) => sql.includes('RETURNING id') ? [{ id }] : []),
    createPinnedIntegrationDatabase: vi.fn(async () => ({ database: { query }, close })),
    createProjectionStore: () => jobs, createPublicIntakeStore: () => intake,
    delay: async (milliseconds: number) => { vi.setSystemTime(Date.now() + milliseconds); } };
  const execute = new Function(...Object.keys(bindings), ts.transpile(`return (async () => ${body!.getText(tree)})();`,
    { target: ts.ScriptTarget.ES2022 }));
  const outcome = await execute(...Object.values(bindings)).then(() => ({ ok: true }), (error: unknown) => ({ ok: false, error }));
  return { outcome, query, intake, jobs, close, trace };
}

it('rejects an advisory oracle whose lease-lost error occurred before any lock wait', async () => {
  const f = await advisoryWaitOracle('expired-before-lock');
  expect(f.outcome).toMatchObject({ ok: false, error: { message: expect.stringContaining('Runtime must reach this advisory blocker') } });
  expect(f.close).toHaveBeenCalledTimes(2);
  expect(f.trace.indexOf('settled')).toBeLessThan(f.trace.indexOf('release'));
  expect(f.jobs.failJob).toHaveBeenCalledOnce();
});
it('accepts only a witnessed advisory wait followed by database expiry and the lease rejection', async () => {
  const f = await advisoryWaitOracle('blocked');
  expect(f.outcome).toEqual({ ok: true });
  expect(f.trace).toEqual(['register', 'observe', 'expiry', 'release', 'settled', 'close', 'close']);
  expect(f.intake.next).toHaveBeenCalledTimes(2);
  expect(f.close).toHaveBeenCalledTimes(2);
});
it.each(['late-block', 'source-residue', 'wrong-rejection', 'unproved-expiry'] as const)('rejects the advisory oracle with %s evidence', async mode => {
  const f = await advisoryWaitOracle(mode);
  expect(f.outcome).toMatchObject({ ok: false });
  expect(f.close).toHaveBeenCalledTimes(2);
  expect(f.jobs.failJob).toHaveBeenCalledOnce();
  if (mode === 'unproved-expiry') expect(f.trace.indexOf('settled')).toBeLessThan(f.trace.indexOf('release'));
});

let directory: string;
const outbound = vi.fn(() => { throw new Error('OFFLINE_NETWORK_DENIED'); });
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'public-data-diagnostic-'));
  const context = await createQualificationContext(fileURLToPath(new URL('..', import.meta.url)), 'a'.repeat(40), randomUUID());
  vi.stubEnv(QUALIFICATION_CONTEXT_ENV, JSON.stringify(context));
  vi.stubEnv('PROJECTION_INTEGRATION_ARTIFACT_DIRECTORY', directory);
  vi.stubGlobal('fetch', outbound);
  vi.spyOn(http, 'request').mockImplementation(outbound);
  vi.spyOn(https, 'request').mockImplementation(outbound);
  vi.spyOn(net.Socket.prototype, 'connect').mockImplementation(outbound);
});
afterEach(async () => {
  expect(outbound).not.toHaveBeenCalled();
  vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); outbound.mockClear();
  await rm(directory, { recursive: true, force: true });
});
const id = '11111111-1111-4111-8111-111111111111';
function fixture() {
  const time = '2026-10-06T12:00:00.000Z', native = '123456789';
  const mapping = { connectionId: '22222222-2222-4222-8222-222222222222', leagueSeasonId: '33333333-3333-4333-8333-333333333333',
    revisionId: '44444444-4444-4444-8444-444444444444', generation: 1,
    scope: { leagueKey: 'sleeper-' + native, externalLeagueId: native, season: 2026, provider: 'sleeper' as const } };
  const intake: PublicIntakeStore = { submit: vi.fn(), recover: vi.fn(), next: vi.fn(async () => ({
    requestId: id, revision: 1, kind: 'core' as const, externalLeagueId: native, season: 2026 })),
  admit: vi.fn(async () => true), recordIdentity: vi.fn(), recordLeagues: vi.fn(), register: vi.fn(),
  completeCore: vi.fn(), completeExactPeriod: vi.fn(), fail: vi.fn() };
  const administration = { ...createLeagueAdministrationStore({ enabled: false, reason: 'missing-database-url' }), enabled: true,
    readSourceMapping: vi.fn(async () => mapping),
    beginRosterCapture: vi.fn(async () => ({ players: { id: 'players', scopeId: 'players', ordinal: 1, expectedGeneration: 0 },
      managers: { id: 'managers', scopeId: 'managers', ordinal: 1, expectedGeneration: 0 } })),
    beginLeagueSettingsAttempt: vi.fn(async () => ({ id: 'settings', scopeId: 'settings', ordinal: 1, expectedGeneration: 0 })),
    recordObservation: vi.fn(async (input: NormalizedAdministrationObservation) => ({
      status: 'changed' as const, observationId: 'observed-' + input.envelope.family,
      ...(input.envelope.family === 'league' ? { leagueSettingsAcceptance: { status: 'accepted' as const, receiptId: 'settings', acceptedGeneration: 1 } }
        : { rosterAcceptance: { status: 'accepted' as const, receiptId: 'players', acceptedGeneration: 1 },
          teamManagerAcceptance: { status: 'accepted' as const, receiptId: 'managers', acceptedGeneration: 1 } }),
    })) };
  const source: NonNullable<PublicIntakeDependencies['source']> = { identity: vi.fn(), leagues: vi.fn(),
    core: vi.fn(async (_id, family) => ({ family, week: null, origin: 'network' as const,
      requestStartedAt: time, requestCompletedAt: time, sourceObservedAt: time,
      payload: family === 'league' ? { league_id: native, name: 'Offline fixture', season: '2026', sport: 'nfl',
        total_rosters: 1, settings: {}, scoring_settings: {}, roster_positions: ['QB'] }
        : [{ roster_id: 1, owner_id: '55', co_owners: [], players: ['123'], starters: ['123'], reserve: [], taxi: [] }] })) };
  const refresh: PublicDataRefreshStore = { configure: vi.fn(), select: vi.fn(async () => ({ status: 'selected' as const,
    targetId: id, configurationRevision: 1, cycleConfigurationRevision: 1, cycle: 1, requestId: id })),
  recordSelectionFailure: vi.fn(async () => ({ status: 'admitted' as const })) };
  const jobs = { acquireJob: vi.fn(async () => ({ kind: 'acquired' as const, attempt: 1, leaseUntil: time })),
    completeJob: vi.fn(async () => true), failJob: vi.fn(async () => true) };
  const dependencies = { intake, administration, source, refresh, jobs, now: () => new Date(time) };
  return { dependencies, intake, administration, source, refresh, jobs, mapping };
}
const secret = 'FICTIONAL_PASSWORD_DO_NOT_SERIALIZE';
const sqlError = () => Object.assign(new Error(secret), { code: '42501', query: secret, parameters: [secret], cause: new Error(secret) });

it('reproduces the unchanged actual coordinator swallowing a storage cause before diagnostic instrumentation', async () => {
  const f = fixture(); vi.mocked(f.refresh.select).mockRejectedValue(sqlError());
  expect(await runPublicDataRefreshStep(f.dependencies, new AbortController().signal)).toEqual({ status: 'unavailable', providerRequests: 0 });
});
it('localizes the first swallowed store failure promptly and sanitizes both thrown error and retained evidence', async () => {
  const f = fixture(), d = createPublicDataDiagnostics('refresh'); d.beginStep(1);
  vi.mocked(f.refresh.select).mockRejectedValue(sqlError());
  f.jobs.failJob.mockRejectedValue(new Error(secret + ' later cleanup'));
  const result = await runPublicDataRefreshStep(observePublicDataDependencies(d, f.dependencies), new AbortController().signal);
  expect(() => d.checkOutcome(result)).toThrow('boundary=refresh.select; category=sql; sqlState=42501');
  await d.save();
  const raw = await readFile(join(directory, 'public-data-refresh-diagnostics.json'), 'utf8');
  expect(raw).not.toContain(secret);
  expect(JSON.parse(raw).firstFailure).toMatchObject({ phase: 'refresh.select', sqlState: '42501' });
  expect(f.jobs.acquireJob).toHaveBeenCalledOnce();
});
it('observes the rejected source half before Promise.allSettled drops it', async () => {
  const f = fixture(), d = createPublicDataDiagnostics('ordinary'); d.beginStep(1);
  vi.mocked(f.source.core).mockRejectedValueOnce(sqlError());
  const result = await runPublicDataRefreshStep(observePublicDataDependencies(d, f.dependencies), new AbortController().signal);
  expect(result.status).toBe('unavailable');
  expect(() => d.checkOutcome(result)).toThrow('boundary=source.core');
});
it('retains typed preserved/rejected result classification when incomplete core has no thrown boundary error', async () => {
  const f = fixture(), d = createPublicDataDiagnostics('ordinary'); d.beginStep(1);
  const record = f.administration.recordObservation.getMockImplementation()!;
  f.administration.recordObservation.mockImplementation(async input => ({ ...await record(input),
    teamManagerAcceptance: { status: 'preserved' as 'accepted', receiptId: 'retained', acceptedGeneration: 1, reason: secret } }));
  const result = await runPublicDataRefreshStep(observePublicDataDependencies(d, f.dependencies), new AbortController().signal);
  expect(() => d.checkOutcome(result)).toThrow('category=incomplete');
  expect(d.snapshot().events.some(event => event.acceptance?.teamManagerAcceptance === 'preserved'
    && event.acceptance.teamManagerAcceptanceReason === 'other')).toBe(true);
  expect(JSON.stringify(d.snapshot())).not.toContain(secret);
});
it('preserves exact admission ACK loss and its recovery without permitting a second use or another boundary', async () => {
  const f = fixture(), d = createPublicDataDiagnostics('refresh'), fault = d.expectedFault('admission-ack-loss');
  vi.mocked(f.intake.admit).mockRejectedValueOnce(fault); d.beginStep(1);
  const input = observePublicDataDependencies(d, f.dependencies);
  const first = await runPublicDataRefreshStep(input, new AbortController().signal);
  expect(first.status).toBe('unavailable'); expect(() => d.checkOutcome(first)).not.toThrow();
  d.beginStep(1); const second = await runPublicDataRefreshStep(input, new AbortController().signal);
  expect(second.status).toBe('progress'); expect(() => d.checkOutcome(second)).not.toThrow();
  expect(f.intake.recover).toHaveBeenCalledTimes(2);
  await expect(d.observe('intake.admit', async () => { throw fault; })).rejects.toThrow('boundary=intake.admit');
  const other = createPublicDataDiagnostics('refresh'), wrong = other.expectedFault('core-checkpoint-loss');
  await expect(other.observe('intake.admit', async () => { throw wrong; })).rejects.toThrow('boundary=intake.admit');
});
it('preserves the paired checkpoint/cleanup fault and later successful recovery', async () => {
  const f = fixture(), d = createPublicDataDiagnostics('refresh');
  vi.mocked(f.intake.completeCore).mockRejectedValueOnce(d.expectedFault('core-checkpoint-loss'));
  vi.mocked(f.intake.fail).mockRejectedValueOnce(d.expectedFault('paired-cleanup-loss'));
  const input = observePublicDataDependencies(d, f.dependencies);
  d.beginStep(2); const first = await runPublicDataRefreshStep(input, new AbortController().signal);
  expect(first.status).toBe('unavailable'); expect(() => d.checkOutcome(first)).not.toThrow();
  d.beginStep(2); const recovered = await runPublicDataRefreshStep(input, new AbortController().signal);
  expect(recovered.status).toBe('progress'); expect(() => d.checkOutcome(recovered)).not.toThrow();
  expect(d.snapshot().events.filter(event => event.event === 'expected-error').map(event => event.fault))
    .toEqual(['core-checkpoint-loss', 'paired-cleanup-loss']);
});
it('contains hostile getter failures without serializing raw errors and preserves the sanitized failure if writing fails', async () => {
  const d = createPublicDataDiagnostics('ordinary');
  const hostile = new Proxy({ toJSON: () => { throw Error(secret); } }, { get: () => { throw Error(secret); } });
  const thrown = await d.observe('intake.register', async () => { throw hostile; }).catch(error => error as Error);
  expect(thrown.message).toBe('Public DATA diagnostic failure: boundary=intake.register; category=unexpected; sqlState=unknown; step=0; cycle=0.');
  expect(thrown.stack).not.toContain(secret); expect(thrown.cause).toBeUndefined();
  vi.stubEnv(QUALIFICATION_CONTEXT_ENV, undefined);
  vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
  await expect(d.save()).resolves.toBeUndefined();
  expect(() => d.checkOutcome({ status: 'unavailable' })).toThrow(thrown.message);
});
it('bounds real pretty-printed artifact bytes and retains last completed work after prolonged busy polling', async () => {
  const d = createPublicDataDiagnostics('ordinary');
  d.beginStep(1); d.checkOutcome({ status: 'progress', resource: 'identity' });
  for (let index = 0; index < 500; index++) { d.beginStep(1); await d.observe('jobs.acquireJob', async () => ({ kind: 'busy', payload: secret })); }
  await d.save();
  const raw = await readFile(join(directory, 'public-data-ingestion-diagnostics.json'));
  expect(raw.byteLength).toBeLessThanOrEqual(64 * 1024);
  const report = JSON.parse(raw.toString());
  expect(report.events).toHaveLength(128); expect(report.droppedEvents).toBeGreaterThan(0);
  expect(report.lastCompletedBoundary).toMatchObject({ phase: 'coordinator', resource: 'identity', status: 'progress' });
  expect(raw.toString()).not.toContain(secret);
});
it('permits both fixed case artifacts in full mode, refuses overwrites and rejects a mismatched selected profile', async () => {
  await createPublicDataDiagnostics('ordinary').save(); await createPublicDataDiagnostics('refresh').save();
  const raw = await readFile(join(directory, 'public-data-ingestion-diagnostics.json'), 'utf8');
  await expect(createPublicDataDiagnostics('ordinary').save()).rejects.toThrow('boundary=artifact.write');
  expect(await readFile(join(directory, 'public-data-ingestion-diagnostics.json'), 'utf8')).toBe(raw);
  const context = await createQualificationContext(fileURLToPath(new URL('..', import.meta.url)), 'a'.repeat(40), randomUUID(), INGESTION_PROFILE);
  vi.stubEnv(QUALIFICATION_CONTEXT_ENV, JSON.stringify(context));
  const empty = join(directory, 'other'); await mkdir(empty);
  vi.stubEnv('PROJECTION_INTEGRATION_ARTIFACT_DIRECTORY', empty);
  await expect(createPublicDataDiagnostics('refresh').save()).rejects.toThrow('boundary=artifact.write');
  await expect(readFile(join(empty, 'public-data-refresh-diagnostics.json'))).rejects.toThrow();
});

// Explicit intended allowlist: the closeout repair adds only refresh/history.
const diagnosticProfiles = ['full', SELECTED_PROFILE, INGESTION_PROFILE, LIVE_PROFILE, JOURNEY_PROFILE,
  OFFICIAL_PROFILE, GUARDS_PROFILE, CONCURRENCY_PROFILE, LATE_WRITE_PROFILE, INTAKE_RECOVERY_PROFILE,
  REFRESH_HISTORY_PROFILE, PERIOD_RECOVERY_PROFILE, PERIOD_EXHAUSTION_PROFILE] as const;
const diagnosticKinds = ['ordinary', 'refresh', 'live', 'journey'] as const;
const diagnosticArtifacts = { ordinary: 'public-data-ingestion-diagnostics.json', refresh: 'public-data-refresh-diagnostics.json',
  live: 'live-league-two-diagnostics.json', journey: 'public-data-live-diagnostics.json' } as const;
const permittedDiagnosticProfiles = {
  ordinary: new Set<QualificationProfile>(['full', INGESTION_PROFILE]),
  refresh: new Set<QualificationProfile>(['full', SELECTED_PROFILE, REFRESH_HISTORY_PROFILE]),
  live: new Set<QualificationProfile>([LIVE_PROFILE]),
  journey: new Set<QualificationProfile>([JOURNEY_PROFILE]),
};
it.each(diagnosticKinds.flatMap(kind => diagnosticProfiles.map(profile => ({ kind, profile }))))(
  'keeps actual diagnostic artifact binding closed for $kind in $profile', async ({ kind, profile }) => {
    const context = await createQualificationContext(fileURLToPath(new URL('..', import.meta.url)), 'a'.repeat(40), randomUUID(), profile);
    vi.stubEnv(QUALIFICATION_CONTEXT_ENV, JSON.stringify(context));
    const diagnostics = createPublicDataDiagnostics(kind);
    if (!permittedDiagnosticProfiles[kind].has(profile)) {
      await expect(diagnostics.save()).rejects.toThrow('boundary=artifact.write');
      expect(await readdir(directory)).toEqual([]);
      return;
    }
    await diagnostics.save();
    const raw = await readFile(join(directory, diagnosticArtifacts[kind]), 'utf8');
    expect(JSON.parse(raw)).toMatchObject({ kind: 'public-data-ingestion-diagnostics-v1', caseKind: kind,
      profile, runId: context.runId, gitSha: context.gitSha, contextDigest: qualificationDigest(context), firstFailure: null });
    expect(Buffer.byteLength(raw)).toBeLessThanOrEqual(64 * 1024);
  });
it('saves bounded refresh-history evidence at the failed-run coordinates and refuses an overwrite', async () => {
  const context = await createQualificationContext(fileURLToPath(new URL('..', import.meta.url)), 'a'.repeat(40), randomUUID(), REFRESH_HISTORY_PROFILE);
  vi.stubEnv(QUALIFICATION_CONTEXT_ENV, JSON.stringify(context));
  const diagnostics = createPublicDataDiagnostics('refresh');
  for (let index = 0; index < 687; index++) {
    diagnostics.beginStep(2);
    if (index === 0) diagnostics.checkOutcome({ status: 'progress', resource: 'core', providerRequests: 2 });
    await diagnostics.observe('jobs.acquireJob', async () => ({ kind: 'busy', payload: secret }));
  }
  await diagnostics.save();
  const artifact = join(directory, diagnosticArtifacts.refresh), raw = await readFile(artifact, 'utf8');
  const report = JSON.parse(raw);
  expect(report).toMatchObject({ kind: 'public-data-ingestion-diagnostics-v1', caseKind: 'refresh', profile: REFRESH_HISTORY_PROFILE,
    runId: context.runId, gitSha: context.gitSha, contextDigest: qualificationDigest(context), firstFailure: null, step: 687, cycle: 2,
    lastCompletedBoundary: { phase: 'coordinator', resource: 'core', status: 'progress' } });
  expect(report.events).toHaveLength(128); expect(report.droppedEvents).toBeGreaterThan(0);
  expect(Buffer.byteLength(raw)).toBeLessThanOrEqual(64 * 1024); expect(raw).not.toContain(secret);
  await expect(createPublicDataDiagnostics('refresh').save()).rejects.toThrow('boundary=artifact.write');
  expect(await readFile(artifact, 'utf8')).toBe(raw);
});
it.each(['missing-context', 'malformed-context', 'wrong-profile-digest', 'missing-directory', 'relative-directory', 'wrong-module'] as const)(
  'rejects refresh-history diagnostic save with %s before writing an artifact', async mode => {
    const context = await createQualificationContext(fileURLToPath(new URL('..', import.meta.url)), 'a'.repeat(40), randomUUID(), REFRESH_HISTORY_PROFILE);
    const supplied = mode === 'malformed-context' ? '{' : JSON.stringify(mode === 'wrong-profile-digest'
      ? { ...context, profileDigest: '0'.repeat(64) } : mode === 'wrong-module'
        ? { ...context, modules: context.modules.map(entry => ({ ...entry, path: 'integration/unknown.integration-case.ts' })) } : context);
    vi.stubEnv(QUALIFICATION_CONTEXT_ENV, mode === 'missing-context' ? undefined : supplied);
    if (mode === 'missing-directory') vi.stubEnv('PROJECTION_INTEGRATION_ARTIFACT_DIRECTORY', undefined);
    if (mode === 'relative-directory') vi.stubEnv('PROJECTION_INTEGRATION_ARTIFACT_DIRECTORY', 'relative-denied-artifact-directory');
    await expect(createPublicDataDiagnostics('refresh').save()).rejects.toThrow('boundary=artifact.write');
    expect(await readdir(directory)).toEqual([]);
  });
it('rejects refresh-history source drift before issuing a qualification context', async () => {
  const siteRoot = join(directory, 'source'); await mkdir(join(siteRoot, 'integration'), { recursive: true });
  const original = await readFile(new URL('./public-data-intake.integration-case.ts', import.meta.url), 'utf8');
  await writeFile(join(siteRoot, SELECTED_MODULE), original);
  await expect(createQualificationContext(siteRoot, 'a'.repeat(40), randomUUID(), REFRESH_HISTORY_PROFILE)).resolves.toMatchObject({ profile: REFRESH_HISTORY_PROFILE });
  await writeFile(join(siteRoot, SELECTED_MODULE), original + '\n// Deliberate offline source-drift negative.\n');
  await expect(createQualificationContext(siteRoot, 'a'.repeat(40), randomUUID(), REFRESH_HISTORY_PROFILE))
    .rejects.toThrow('Selected qualification source differs from the reviewed LF digest');
  expect(await readdir(directory)).toEqual(['source']);
});
it.each(['valid', 'invalid'] as const)('preserves the first refresh-history failure when its save binding is %s', async binding => {
  const context = await createQualificationContext(fileURLToPath(new URL('..', import.meta.url)), 'a'.repeat(40), randomUUID(), REFRESH_HISTORY_PROFILE);
  vi.stubEnv(QUALIFICATION_CONTEXT_ENV, JSON.stringify(binding === 'valid' ? context : { ...context, profileDigest: '0'.repeat(64) }));
  const diagnostics = createPublicDataDiagnostics('refresh');
  const failure = diagnostics.failure('intake.register', sqlError()), before = diagnostics.snapshot().firstFailure;
  const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
  await expect(diagnostics.save()).resolves.toBeUndefined();
  expect(diagnostics.snapshot().firstFailure).toEqual(before);
  expect(diagnostics.failure('case', undefined)).toBe(failure);
  if (binding === 'valid') {
    const raw = await readFile(join(directory, diagnosticArtifacts.refresh), 'utf8');
    expect(JSON.parse(raw)).toMatchObject({ profile: REFRESH_HISTORY_PROFILE, contextDigest: qualificationDigest(context), firstFailure: before });
    expect(raw).not.toContain(secret); expect(stderr).not.toHaveBeenCalled();
  } else {
    expect(await readdir(directory)).toEqual([]);
    expect(stderr).toHaveBeenCalledExactlyOnceWith('PUBLIC_DATA_DIAGNOSTIC_ARTIFACT_WRITE_FAILED\n');
  }
});

it('rejects runtime-invalid labels before executing an action or leaking attacker-provided text', async () => {
  const hostile = { toString() { throw Error(secret); }, toJSON() { throw Error(secret); } };
  expect(() => createPublicDataDiagnostics(hostile as never)).toThrow('invalid case kind');
  const d = createPublicDataDiagnostics('ordinary'), action = vi.fn();
  await expect(d.observe(hostile as never, action)).rejects.toThrow('boundary=case');
  expect(action).not.toHaveBeenCalled();
  expect(() => createPublicDataDiagnostics('refresh').expectedFault('constructor' as never)).toThrow('boundary=case');
  const error = createPublicDataDiagnostics('ordinary').failure(hostile as never, hostile, hostile as never);
  expect(error.message).not.toContain(secret);
  expect(error.message).toContain('boundary=case; category=unexpected');
});

it('preserves all seven actual core SQL reasons and keeps null distinct from an unknown reason', async () => {
  const reasons = ['exact_receipt_replay', 'newer_network_attempt_reserved', 'accepted_generation_changed',
    'complete_league_identity_unproved', 'complete_players_population_unproved',
    'complete_primary_owner_population_unproved', 'complete_manager_evidence_population_unproved'];
  for (const reason of reasons) {
    const d = createPublicDataDiagnostics('ordinary');
    await d.observe('administration.recordObservation', async () => ({
      leagueSettingsAcceptance: { status: 'preserved', reason }, reason,
    }));
    expect(d.snapshot().events.at(-1)).toMatchObject({ reason, acceptance: { leagueSettingsAcceptanceReason: reason } });
  }
  for (const reason of [undefined, null, secret, { secret }]) {
    const d = createPublicDataDiagnostics('ordinary');
    await d.observe('administration.recordObservation', async () => ({
      leagueSettingsAcceptance: { status: 'preserved', reason }, reason,
    }));
    const event = d.snapshot().events.at(-1)!;
    expect(event.reason).toBe(reason == null ? undefined : 'other');
    expect(event.acceptance?.leagueSettingsAcceptanceReason).toBe(reason == null ? undefined : 'other');
    expect(JSON.stringify(d.snapshot())).not.toContain(secret);
  }
});

const receiptCases = [
  ['leagueSettingsAcceptance', 5, 'settings', 'league', 'sleeper-league-identity-settings-v1'],
  ['rosterAcceptance', 3, 'players', 'rosters', 'sleeper-current-all-teams-players-v1'],
  ['teamManagerAcceptance', 4, 'managers-v1', 'rosters', 'sleeper-current-all-teams-primary-owners-v1'],
  ['teamManagerEvidenceAcceptance', 10, 'managers-v2', 'rosters', 'sleeper-current-all-teams-manager-evidence-v2'],
] as const;
function receiptFixture(spec: typeof receiptCases[number] = receiptCases[0]) {
  const f = fixture(), d = createPublicDataDiagnostics('ordinary');
  const query = vi.fn(async () => [{ request_started_after_reservation: false,
    request_start_minus_reservation_ms: -0.001, request_start_minus_reservation_clamped: false }]);
  const reader = query as ReceiptDiagnosticReader;
  const attempt = { id: '55555555-5555-4555-8555-555555555555', scopeId: '66666666-6666-4666-8666-666666666666', ordinal: 1, expectedGeneration: 0 };
  const result = { status: 'changed', [spec[0]]: { status: 'preserved', receiptId: id, reason: 'complete_league_identity_unproved' } };
  f.administration.recordObservation.mockResolvedValue(result as never);
  const args: Parameters<PublicIntakeDependencies['administration']['recordObservation']> = [
    { envelope: { family: spec[3], week: null, scope: f.mapping.scope } } as NormalizedAdministrationObservation,
    undefined, f.mapping,
  ];
  args[spec[1]] = { attempt };
  const writer = observePublicDataDependencies(d, f.dependencies, reader).administration.recordObservation;
  const save = async () => { d.failure('coordinator', undefined, 'incomplete'); await d.save(); };
  return { ...f, d, reader, query, result, attempt, args, writer, save };
}
it.each(receiptCases)('binds preserved %s to its exact immutable receipt, attempt, mapping and fixed policy only at save', async (...spec) => {
  const f = receiptFixture(spec as typeof receiptCases[number]);
  expect(await f.writer(...f.args)).toBe(f.result);
  expect(f.query).not.toHaveBeenCalled();
  const failure = f.d.failure('coordinator', undefined, 'incomplete');
  const before = f.d.snapshot().firstFailure;
  await f.save();
  expect(f.d.snapshot().firstFailure).toEqual(before);
  expect(() => f.d.checkOutcome({ status: 'unavailable' })).toThrow(failure);
  expect(f.query).toHaveBeenCalledOnce();
  const [parameters, signal] = f.query.mock.calls[0] as unknown as [unknown[], AbortSignal];
  expect(parameters.slice(0, 3)).toEqual([id, f.attempt.id, f.attempt.scopeId]);
  expect(JSON.parse(parameters[3] as string)).toEqual(f.mapping);
  expect(JSON.parse(parameters[4] as string)).toMatchObject({ scope: { connectionId: f.mapping.connectionId,
    leagueSeasonId: f.mapping.leagueSeasonId, entityId: null, scoringPeriodId: null, audienceId: 'public', coverageSpecId: spec[4] },
  policy: { coverageSpecId: spec[4], validationVersion: 'latest-network-attempt-v1' } });
  expect(parameters.slice(5)).toEqual([1, 0]);
  expect(signal).toBeInstanceOf(AbortSignal);
  const artifact = await readFile(join(directory, 'public-data-ingestion-diagnostics.json'), 'utf8');
  expect(JSON.parse(artifact).events.at(-1)).toMatchObject({ phase: 'administration.receipt', resource: spec[2],
    receipt: { state: 'available', requestStartedAfterReservation: false, requestStartMinusReservationMs: -0.001,
      requestStartMinusReservationClamped: false } });
  for (const forbidden of [id, f.attempt.id, f.attempt.scopeId, f.mapping.connectionId, f.mapping.scope.externalLeagueId,
    '2026-10-06', 'SELECT ', 'provenance', 'https:', secret]) expect(artifact).not.toContain(forbidden);
});
it('models PostgreSQL microsecond ordering, exact equality, null and explicit clamping without Date truncation', async () => {
  const cases = [[1n, 2n], [2n, 2n], [3n, 2n], [60_000_001n, 0n], [0n, 60_000_001n], [null, 1n]] as const;
  for (const [requested, reserved] of cases) {
    const f = receiptFixture(), difference = requested === null ? null : Number(requested - reserved) / 1000;
    f.query.mockResolvedValue([{ request_started_after_reservation: requested === null ? null : requested >= reserved,
      request_start_minus_reservation_ms: difference === null ? null : Math.max(-60000, Math.min(60000, difference)),
      request_start_minus_reservation_clamped: difference === null ? null : Math.abs(difference) > 60000 }] as never);
    await f.writer(...f.args); await f.save();
    expect(f.d.snapshot().events.at(-1)?.receipt).toEqual({ state: 'available',
      requestStartedAfterReservation: requested === null ? null : requested >= reserved,
      requestStartMinusReservationMs: difference === null ? null : Math.max(-60000, Math.min(60000, difference)),
      requestStartMinusReservationClamped: difference === null ? null : Math.abs(difference) > 60000 });
    await rm(join(directory, 'public-data-ingestion-diagnostics.json'));
  }
});
it('never reads accepted or unrelated outcomes and keeps only the latest preserved receipt per fixed resource', async () => {
  const f = receiptFixture();
  f.administration.recordObservation.mockResolvedValueOnce({ ...f.result,
    leagueSettingsAcceptance: { status: 'accepted', receiptId: id } } as never);
  await f.writer(...f.args); await f.save(); expect(f.query).not.toHaveBeenCalled();
  await rm(join(directory, 'public-data-ingestion-diagnostics.json'));
  f.administration.recordObservation.mockResolvedValueOnce({ status: 'rejected', transactionAcceptance: { status: 'preserved', receiptId: id } } as never);
  await f.writer(...f.args); await f.save(); expect(f.query).not.toHaveBeenCalled();
  await rm(join(directory, 'public-data-ingestion-diagnostics.json'));
  await f.writer(...f.args);
  const latest = '77777777-7777-4777-8777-777777777777';
  f.administration.recordObservation.mockResolvedValueOnce({ ...f.result, leagueSettingsAcceptance: { status: 'preserved', receiptId: latest } } as never);
  await f.writer(...f.args); await f.save();
  expect(f.query).toHaveBeenCalledOnce();
  expect((f.query.mock.calls[0] as unknown as [string[], AbortSignal])[0][0]).toBe(latest);
});
it('rejects invalid receipt, attempt and scope bindings before any query without changing the writer result', async () => {
  const changes = [
    (f: ReturnType<typeof receiptFixture>) => { f.result.leagueSettingsAcceptance = { status: 'preserved', receiptId: secret } as never; },
    (f: ReturnType<typeof receiptFixture>) => { f.attempt.id = secret; },
    (f: ReturnType<typeof receiptFixture>) => { f.attempt.scopeId = secret; },
    (f: ReturnType<typeof receiptFixture>) => { f.attempt.ordinal = -1; },
    (f: ReturnType<typeof receiptFixture>) => { f.mapping.revisionId = secret; },
    (f: ReturnType<typeof receiptFixture>) => { f.args[0] = { envelope: { ...f.args[0].envelope, family: 'transactions' } } as never; },
    (f: ReturnType<typeof receiptFixture>) => { f.args[0] = { envelope: { ...f.args[0].envelope, scope: { ...f.mapping.scope, season: 2025 } } } as never; },
    (f: ReturnType<typeof receiptFixture>) => { f.args[0] = { envelope: { ...f.args[0].envelope, week: 1 } } as never; },
  ];
  for (const change of changes) {
    const f = receiptFixture(); change(f);
    expect(await f.writer(...f.args)).toBe(f.result); await f.save();
    expect(f.query).not.toHaveBeenCalled();
    expect(f.d.snapshot().events.at(-1)?.receipt).toEqual({ state: 'invalid-binding' });
    expect(JSON.stringify(f.d.snapshot())).not.toContain(secret);
    await rm(join(directory, 'public-data-ingestion-diagnostics.json'));
  }
});
it('rejects missing, ambiguous, nonfinite, unbounded, inconsistent and extra receipt rows without leaking data', async () => {
  const row = { request_started_after_reservation: true, request_start_minus_reservation_ms: 0, request_start_minus_reservation_clamped: false };
  for (const rows of [[], [row, row], [{}], [{ ...row, secret }], [{ ...row, request_start_minus_reservation_ms: secret }],
    [{ ...row, request_start_minus_reservation_ms: Infinity }], [{ ...row, request_start_minus_reservation_ms: 60001 }],
    [{ ...row, request_start_minus_reservation_ms: -0.001 }], [{ ...row, request_start_minus_reservation_clamped: true }]]) {
    const f = receiptFixture(); f.query.mockResolvedValue(rows as never);
    await f.writer(...f.args); await f.save();
    expect(f.d.snapshot().events.at(-1)?.receipt).toEqual({ state: 'invalid-result' });
    expect(JSON.stringify(f.d.snapshot())).not.toContain(secret);
    await rm(join(directory, 'public-data-ingestion-diagnostics.json'));
  }
});
it('records only owned receipt boundaries without leaking driver text or replacing the primary failure', async () => {
  const cases = [
    [new ReceiptDiagnosticReadError('transaction', sqlError()), 'transaction', 'sql', '42501'],
    [new ReceiptDiagnosticReadError('transaction', new SyntaxError(secret)), 'transaction', 'unexpected', null],
    [new ReceiptDiagnosticReadError('result-validation'), 'result-validation', 'unexpected', null],
    [Object.defineProperty(new ReceiptDiagnosticReadError('transaction'), 'receiptBoundary',
      { get: vi.fn().mockReturnValueOnce('transaction').mockReturnValue(secret) }), 'transaction', 'unexpected', null],
    [Object.assign(new Error(secret), { receiptBoundary: 'result-validation' }), undefined, 'unexpected', null],
    [new ReceiptDiagnosticReadError(secret as never), undefined, 'unexpected', null],
    [new Proxy({}, { getPrototypeOf() { throw new Error(secret); } }), undefined, 'unexpected', null],
  ] as const;
  for (const [error, boundary, category, sqlState] of cases) {
    const f = receiptFixture(); f.query.mockRejectedValue(error);
    await f.writer(...f.args);
    const original = f.d.failure('coordinator', undefined, 'incomplete');
    await f.save();
    const snapshot = f.d.snapshot(), receipt = snapshot.events.at(-1);
    expect(receipt).toMatchObject({ phase: 'administration.receipt', category, sqlState, receipt: { state: 'error' } });
    expect(receipt?.receipt?.boundary).toBe(boundary);
    expect(() => f.d.checkOutcome({ status: 'unavailable' })).toThrow(original);
    expect(JSON.stringify(snapshot)).not.toContain(secret);
    await rm(join(directory, 'public-data-ingestion-diagnostics.json'));
  }
});
it('retains original failure on a read error or one shared five-second cancellation deadline and ignores late results', async () => {
  const failing = receiptFixture(); failing.query.mockRejectedValue(sqlError());
  await failing.writer(...failing.args);
  const original = failing.d.failure('coordinator', undefined, 'incomplete');
  await failing.save();
  expect(() => failing.d.checkOutcome({ status: 'unavailable' })).toThrow(original);
  expect(failing.d.snapshot().events.find(event => event.phase === 'administration.receipt')).toMatchObject({ phase: 'administration.receipt', category: 'sql', sqlState: '42501', receipt: { state: 'error' } });
  expect(JSON.stringify(failing.d.snapshot())).not.toContain(secret);
  await rm(join(directory, 'public-data-ingestion-diagnostics.json'));
  const f = receiptFixture(), late = Promise.withResolvers<never>();
  f.query.mockImplementation(() => late.promise);
  for (const spec of receiptCases) {
    const candidate = receiptFixture(spec);
    f.d.queueReceipts(f.reader, candidate.args, candidate.result);
  }
  const failure = f.d.failure('coordinator', undefined, 'incomplete');
  vi.useFakeTimers();
  const saving = f.save(); let saved = false; void saving.then(() => { saved = true; });
  await vi.advanceTimersByTimeAsync(4999); expect(saved).toBe(false);
  await vi.advanceTimersByTimeAsync(1); await saving;
  expect(f.query).toHaveBeenCalledOnce();
  const signal = (f.query.mock.calls[0] as unknown as [unknown[], AbortSignal])[1];
  expect(signal.aborted).toBe(true);
  expect(f.d.snapshot().events.filter(event => event.receipt?.state === 'timeout')).toHaveLength(4);
  expect(() => f.d.checkOutcome({ status: 'unavailable' })).toThrow(failure);
  const snapshot = f.d.snapshot(); late.reject(new Error(secret)); await Promise.resolve();
  expect(f.d.snapshot()).toEqual(snapshot);
});
it('keeps actual pretty JSON below 64 KiB for maximum fixed reason summaries plus receipt evidence', async () => {
  const f = receiptFixture();
  for (let i = 0; i < 180; i++) await f.d.observe('administration.recordObservation', async () => Object.fromEntries(
    receiptCases.map(([key]) => [key, { status: 'preserved', reason: 'complete_manager_evidence_population_unproved' }])));
  await f.writer(...f.args); f.d.failure('coordinator', undefined, 'incomplete'); await f.save();
  const bytes = await readFile(join(directory, 'public-data-ingestion-diagnostics.json'));
  expect(bytes.byteLength).toBeLessThanOrEqual(64 * 1024);
  const artifact = JSON.parse(bytes.toString());
  expect(artifact.events.length).toBeLessThanOrEqual(128); expect(artifact.droppedEvents).toBeGreaterThan(0);
  expect(artifact.firstFailure).toMatchObject({ phase: 'coordinator', category: 'incomplete' });
  expect(artifact.events.at(-1).receipt.state).toBe('available');
});

it('does not read queued preserved evidence for a successful case or an invalid qualification context', async () => {
  const f = receiptFixture(); await f.writer(...f.args); await f.d.save();
  expect(f.query).not.toHaveBeenCalled();
  const other = receiptFixture(); await other.writer(...other.args);
  other.d.failure('coordinator', undefined, 'incomplete');
  vi.stubEnv(QUALIFICATION_CONTEXT_ENV, undefined); vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
  await other.d.save(); expect(other.query).not.toHaveBeenCalled();
});


it('retains a fixed synchronous assertion group without retaining the assertion message, values or stack', async () => {
  const d = createPublicDataDiagnostics('ordinary');
  const callback = vi.fn(() => { expect(secret).toBe('SYNTHETIC_EXPECTED'); });
  const failure = (() => { try { d.assertion('settings-value', callback); } catch (error) { return error as Error; } })()!;
  expect(callback).toHaveBeenCalledOnce();
  expect(d.failure('case', failure)).toBe(failure);
  expect(d.snapshot().firstFailure).toEqual({ phase: 'case.assertion', category: 'assertion', sqlState: null,
    step: 0, cycle: 0, assertionCheckpoint: 'settings-value' });
  expect(failure.message).toContain('assertionCheckpoint=settings-value');
  for (const raw of [failure.message, failure.stack!, JSON.stringify(d.snapshot())]) {
    expect(raw).not.toContain(secret); expect(raw).not.toContain('SYNTHETIC_EXPECTED');
  }
  await d.save();
  const saved = JSON.parse(await readFile(join(directory, 'public-data-ingestion-diagnostics.json'), 'utf8'));
  expect(saved.firstFailure).toEqual(d.snapshot().firstFailure);
  expect(saved.contextDigest).toMatch(/^[0-9a-f]{64}$/u);
});

it('invokes an owned assertion group once, preserves its return and never leaves a stale group on later failures', () => {
  const d = createPublicDataDiagnostics('ordinary'), value = {}, action = vi.fn(() => value);
  expect(d.assertion('settings-value', action)).toBe(value); expect(action).toHaveBeenCalledOnce();
  let error: unknown; try { expect(1).toBe(2); } catch (caught) { error = caught; }
  d.failure('case', error);
  expect(d.snapshot().firstFailure).toMatchObject({ phase: 'case', category: 'assertion' });
  expect(d.snapshot().firstFailure).not.toHaveProperty('assertionCheckpoint');
});

it('preserves an earlier observed SQL failure over a later owned assertion and does not label non-assertion exceptions', async () => {
  const d = createPublicDataDiagnostics('ordinary');
  const first = await d.observe('intake.register', async () => { throw sqlError(); }).catch(error => error);
  expect(() => d.assertion('candidate', () => { expect(1).toBe(2); })).toThrow(first);
  expect(d.snapshot().firstFailure).toMatchObject({ phase: 'intake.register', category: 'sql', sqlState: '42501' });
  expect(d.snapshot().firstFailure).not.toHaveProperty('assertionCheckpoint');
  const other = createPublicDataDiagnostics('ordinary');
  expect(() => other.assertion('candidate', () => { throw new Error(secret); })).toThrow('category=unexpected');
  expect(other.snapshot().firstFailure).not.toHaveProperty('assertionCheckpoint');
});

it('rejects runtime-invalid assertion labels without coercion or callback execution and never reads assertion stacks', () => {
  const hostile = { toString() { throw Error(secret); }, toJSON() { throw Error(secret); } };
  for (const label of [secret, hostile, null, 1]) {
    const action = vi.fn(), d = createPublicDataDiagnostics('ordinary');
    expect(() => d.assertion(label as never, action)).toThrow('boundary=case; category=unexpected');
    expect(action).not.toHaveBeenCalled(); expect(JSON.stringify(d.snapshot())).not.toContain(secret);
  }
  const stack = vi.fn(() => { throw Error(secret); }), message = vi.fn(() => { throw Error(secret); });
  const error = Object.defineProperties({ name: 'AssertionError' }, { stack: { get: stack }, message: { get: message } });
  const d = createPublicDataDiagnostics('ordinary');
  expect(() => d.assertion('manager-parity', () => { throw error; })).toThrow('assertionCheckpoint=manager-parity');
  expect(stack).not.toHaveBeenCalled(); expect(message).not.toHaveBeenCalled();
});

const databaseVersionRow = () => ({ role: 'league_one_runtime', effective_role: 'league_one_runtime',
  server_version: '18.6 (4e955f5)', server_version_num: '180006' });

it('retains only validated version primitives from the existing restricted identity row in context-bound evidence', async () => {
  const d = createPublicDataDiagnostics('ordinary'), row = databaseVersionRow();
  d.recordDatabaseVersion(row); row.server_version = secret;
  const snapshot = d.snapshot(); snapshot.databaseVersion!.serverVersion = secret;
  expect(d.snapshot().databaseVersion).toEqual({ serverVersion: '18.6 (4e955f5)', serverVersionNum: 180006 });
  await d.save();
  const raw = await readFile(join(directory, 'public-data-ingestion-diagnostics.json'), 'utf8'), saved = JSON.parse(raw);
  expect(saved.databaseVersion).toEqual(d.snapshot().databaseVersion);
  expect(saved.gitSha).toBe('a'.repeat(40)); expect(saved.contextDigest).toMatch(/^[0-9a-f]{64}$/u);
  expect(raw).not.toContain(secret); expect(raw).not.toContain('league_one_runtime');
});

it('rejects malformed, extra, inherited, accessor or mismatched database version evidence without evaluating values', () => {
  const getter = vi.fn(() => { throw Error(secret); });
  const accessor = Object.defineProperty(databaseVersionRow(), 'server_version', { get: getter });
  const value = { toString: getter, toJSON: getter };
  const rows = [null, [], Object.create(databaseVersionRow()), accessor,
    { ...databaseVersionRow(), server_version: value }, { ...databaseVersionRow(), server_version: secret },
    { ...databaseVersionRow(), server_version: '18.6 (' + 'a'.repeat(100) + ')' },
    { ...databaseVersionRow(), server_version_num: 180006 }, { ...databaseVersionRow(), server_version_num: '180007' },
    { ...databaseVersionRow(), server_version_num: '0180006' }, { ...databaseVersionRow(), extra: secret },
    { ...databaseVersionRow(), role: 'neondb_owner' }, { ...databaseVersionRow(), effective_role: 'neondb_owner' },
    { ...databaseVersionRow(), [Symbol(secret)]: secret }];
  for (const row of rows) {
    const d = createPublicDataDiagnostics('ordinary');
    expect(() => d.recordDatabaseVersion(row)).toThrow('boundary=case; category=unexpected');
    expect(d.snapshot()).not.toHaveProperty('databaseVersion'); expect(JSON.stringify(d.snapshot())).not.toContain(secret);
  }
  expect(getter).not.toHaveBeenCalled();
});

it('keeps the first database version immutable and preserves an earlier failure if version recording later fails', () => {
  const d = createPublicDataDiagnostics('ordinary'); d.recordDatabaseVersion(databaseVersionRow());
  expect(() => d.recordDatabaseVersion({ ...databaseVersionRow(), server_version: '18.7', server_version_num: '180007' }))
    .toThrow('boundary=case; category=unexpected');
  expect(d.snapshot().databaseVersion).toEqual({ serverVersion: '18.6 (4e955f5)', serverVersionNum: 180006 });
  const other = createPublicDataDiagnostics('ordinary'), first = other.failure('intake.register', sqlError());
  expect(() => other.recordDatabaseVersion({ server_version: secret })).toThrow(first);
  expect(other.snapshot().firstFailure).toMatchObject({ phase: 'intake.register', sqlState: '42501' });
});

// These tests fail real Vitest assertions and inspect the same saved artifact as the SQL case.
async function comparisonArtifact() {
  const raw = await readFile(join(directory, 'public-data-ingestion-diagnostics.json'), 'utf8');
  expect(raw).not.toContain(secret);
  expect(Buffer.byteLength(raw)).toBeLessThanOrEqual(64 * 1024);
  // The writer is intentionally immutable (wx); each later fixture save needs a new owned file.
  await rm(join(directory, 'public-data-ingestion-diagnostics.json'));
  return JSON.parse(raw).firstFailure;
}
it('names the exact failed settings field with bounded actual and expected values', async () => {
  const d = createPublicDataDiagnostics('ordinary');
  const actual = { nativeSettings: { fields: { state: 'known', value: { divisions: 2 } } } };
  const expected = { nativeSettings: { fields: { state: 'known', value: { divisions: 3 } } } };
  expect(() => d.assertion('settings-value', () => d.comparison('settings.value', actual, expected,
    (a, e) => expect(a).toMatchObject(e)))).toThrow('comparison=settings.value; matcher=toMatchObject');
  await d.save();
  const failure = await comparisonArtifact();
  expect(failure).toMatchObject({ assertionCheckpoint: 'settings-value', comparison: { id: 'settings.value', matcher: 'toMatchObject',
    actual: { nativeSettings: { fields: { value: { divisions: 2 } } } },
    expected: { nativeSettings: { fields: { value: { divisions: 3 } } } }, truncated: false } });
});
it('shares synthetic identity aliases across both operands while preserving positions and equality', async () => {
  const d = createPublicDataDiagnostics('ordinary'), other = '22222222-2222-4222-8222-222222222222';
  expect(() => d.assertion('team-identities', () => d.comparison('teams.identity-parity', [id, other], [id, id],
    (a, e) => expect(a).toEqual(e)))).toThrow('comparison=teams.identity-parity');
  await d.save();
  const { comparison: c } = await comparisonArtifact();
  expect(c.actual).toEqual({ length: 2, items: [{ alias: 1, kind: 'uuid' }, { alias: 2, kind: 'uuid' }] });
  expect(c.expected).toEqual({ length: 2, items: [{ alias: 1, kind: 'uuid' }, { alias: 1, kind: 'uuid' }] });
  expect(JSON.stringify(c)).not.toContain(id); expect(JSON.stringify(c)).not.toContain(other);
});
it('retains observed lengths, missing versus null, and exact timestamp differences', async () => {
  for (const run of [
    () => { const d = createPublicDataDiagnostics('ordinary');
      expect(() => d.assertion('team-counts', () => d.comparison('players.team-count', [], 1, (a, e) => expect(a).toHaveLength(e)))).toThrow();
      return d; },
    () => { const d = createPublicDataDiagnostics('ordinary');
      expect(() => d.assertion('candidate', () => d.comparison('candidate.fields', {}, { scoring_profile_id: null }, (a, e) => expect(a).toMatchObject(e)))).toThrow();
      return d; },
    () => { const d = createPublicDataDiagnostics('ordinary');
      expect(() => d.assertion('discovery-times', () => d.comparison('discovery.started', '2026-10-08T18:00:00.000Z', '2026-10-08T18:00:00.123Z', (a, e) => expect(a).toBe(e)))).toThrow();
      return d; },
  ]) {
    const d = run(); await d.save(); const { comparison: c } = await comparisonArtifact();
    if (c.id === 'players.team-count') expect(c).toMatchObject({ actual: { length: 0 }, expected: 1 });
    if (c.id === 'candidate.fields') expect(c).toMatchObject({ actual: { scoring_profile_id: { state: 'missing' } }, expected: { scoring_profile_id: null } });
    if (c.id === 'discovery.started') expect(c).toMatchObject({ actual: { timestamp: '2026-10-08T18:00:00.000Z' }, expected: { timestamp: '2026-10-08T18:00:00.123Z' } });
  }
});
function fullComparisonFixture() {
  const time = '2026-10-08T18:00:00.123Z', mapping = fixture().mapping;
  const witness: PublicCaptureWitness = { version: 'public-network-capture-v1',
    work: { requestId: id, revision: 1, kind: 'core', externalLeagueId: mapping.scope.externalLeagueId, season: mapping.scope.season },
    fence: { jobKey: 'league-administration-public-intake', workerId: id, generation: 1, deadlineAt: time },
    dispatchNonce: id, mapping, attempts: { settings: { id, nonce: id }, players: { id, nonce: id }, managers: { id, nonce: id }, managersV2: { id, nonce: id } } };
  const provenance = { origin: 'network' as const, requestStartedAt: time, requestCompletedAt: time, sourceObservedAt: time, checkedAt: time, acquisition: witness };
  const settings: Extract<AcceptedLeagueSettingsRead, { status: 'available' }>['receipt'] = {
    id, attemptId: id, ordinal: 1, legacyObservationId: id, provenance, sourceUpdatedAt: null,
    rawContentHash: 'a'.repeat(64), configurationVersionId: id, configurationSemanticHash: 'b'.repeat(64) };
  const roster: CurrentRosterCaptureReceipt = { id, attemptId: id, ordinal: 1, provenance,
    configurationContentId: id, expectedTeamCount: 1, legacyObservationId: id };
  const sourceTeam = { provider: 'sleeper' as const, resourceKind: 'team', nativeNamespace: 'fixture-team', nativeId: '1' };
  const primaryOwner: TeamManagerRelationships['primaryOwner'] = { state: 'owned', manager: { providerManagerId: id,
    sourceManager: { provider: 'sleeper', resourceKind: 'manager', nativeNamespace: 'fixture-manager', nativeId: '9' } } };
  return { witness, provenance, mapping,
    resources: { settings: { status: 'available', receipt: settings }, heldRoster: { status: 'available', receipt: roster },
      teamManagers: { status: 'available', receipt: roster }, teamManagerEvidence: { status: 'available', receipt: roster, captureBinding: 'latest-for-current-source-mapping' },
      directory: { status: 'available', observationId: id, acquisition: { id, legacyObservationId: id, sourceMapping: mapping } } },
    parity: { sourceTeam, primaryOwner, coManagers: { state: 'known', completeness: 'complete', managers: [primaryOwner.manager] } },
    lineage: { intake_id: id, resource: 'core', source_mapping: mapping, provenance, exact_witness: true, server_window: true, current_head: true } };
}
// Enumerate only this fixed synthetic contract fixture, never arbitrary live values.
function leafPaths(value: unknown, path: (string | number)[] = []): (string | number)[][] {
  if (value === null || typeof value !== 'object') return [path];
  return Object.entries(value).flatMap(([key, child]) => leafPaths(child, [...path, Array.isArray(value) ? Number(key) : key]));
}
function atPath(value: unknown, path: readonly (string | number)[], projected = false): unknown {
  return path.reduce<unknown>((current, key) => {
    const record = current as Record<string | number, unknown>;
    return projected && typeof key === 'number' ? (record.items as unknown[])[key] : record[key];
  }, value);
}
it('exposes every retained receipt, provenance, capture and manager identity field within realistic full operands', async () => {
  const f = fullComparisonFixture();
  const cases = [
    ['stored-resources.composition', 'stored-resources', f.resources],
    ['lineage.witness', 'receipt-witness', f.lineage],
    ['manager-evidence.parity', 'manager-parity', f.parity],
  ] as const;
  for (const [label, group, expected] of cases) {
    for (const path of leafPaths(expected)) {
      const actual = structuredClone(expected), old = atPath(actual, path);
      const parent = atPath(actual, path.slice(0, -1)) as Record<string | number, unknown>;
      parent[path.at(-1)!] = old === null ? false : typeof old === 'boolean' ? !old : typeof old === 'number' ? old + 1 : String(old) + '-changed';
      const d = createPublicDataDiagnostics('ordinary');
      expect(() => d.assertion(group, () => d.comparison(label, actual, expected, (a, e) => expect(a).toMatchObject(e)))).toThrow();
      await d.save(); const { comparison: c } = await comparisonArtifact();
      expect(c.truncated, label + ':' + path.join('.')).toBe(false);
      expect(atPath(c.actual, path, true), label + ':' + path.join('.')).not.toEqual(atPath(c.expected, path, true));
    }
  }
});
it('retains receipt time and nonce relations without admitting unrelated fields into subset evidence', async () => {
  const f = fullComparisonFixture(), actual = structuredClone(f.lineage);
  Object.assign(actual.provenance.acquisition, { dispatchNonce: '99999999-9999-4999-8999-999999999999' });
  actual.provenance.requestCompletedAt = '2026-10-08T18:00:00.124Z';
  const oversized = { ...actual, players: Array.from({ length: 2000 }, () => ({ id: secret })) };
  const d = createPublicDataDiagnostics('ordinary');
  expect(() => d.assertion('receipt-witness', () => d.comparison('lineage.witness', oversized, f.lineage, (a, e) => expect(a).toMatchObject(e)))).toThrow();
  await d.save(); const { comparison: c } = await comparisonArtifact();
  expect(c.truncated).toBe(false);
  expect(c.actual.provenance.requestCompletedAt).toEqual({ timestamp: '2026-10-08T18:00:00.124Z' });
  expect(c.expected.provenance.requestCompletedAt).toEqual({ timestamp: '2026-10-08T18:00:00.123Z' });
  expect(c.actual.provenance.acquisition.dispatchNonce).not.toEqual(c.expected.provenance.acquisition.dispatchNonce);
  expect(c.actual.$omittedFieldCount).toBe(1);
});
it('never inspects hostile error payloads, getters, prototypes or serialization hooks in operand projections', async () => {
  const touched = vi.fn(() => { throw new Error(secret); });
  const operand = Object.create({ get status() { return touched(); } });
  Object.defineProperties(operand, { id: { get: touched, enumerable: true }, [secret]: { value: secret, enumerable: true },
    toJSON: { value: touched, enumerable: true }, valueOf: { value: touched, enumerable: true } });
  const d = createPublicDataDiagnostics('ordinary');
  expect(() => d.assertion('candidate', () => d.comparison('candidate.fields', operand, { id, status: 'available' },
    () => expect(0).toBe(1)))).toThrow('comparison=candidate.fields');
  await d.save(); const { comparison: c } = await comparisonArtifact();
  expect(touched).not.toHaveBeenCalled();
  expect(c.actual).toMatchObject({ id: { redacted: 'accessor' }, status: { state: 'missing' }, $redactedFieldCount: 3 });
  const copy = d.snapshot(); copy.firstFailure!.comparison!.actual = secret;
  await d.save(); expect((await comparisonArtifact()).comparison.actual).toEqual(c.actual);
});
it('rejects invalid comparison labels, scopes and non-assertion evidence without coercion or stale attribution', async () => {
  const coerced = vi.fn(() => secret), bad = { toString: coerced };
  const d = createPublicDataDiagnostics('ordinary');
  expect(() => d.assertion('candidate', () => d.comparison(bad as never, 0, 1, (a, e) => expect(a).toBe(e)))).toThrow('boundary=case');
  expect(coerced).not.toHaveBeenCalled(); expect(d.snapshot().firstFailure?.comparison).toBeUndefined();
  const outside = createPublicDataDiagnostics('ordinary');
  expect(() => outside.comparison('candidate.fields', 0, 1, (a, e) => expect(a).toBe(e))).toThrow('boundary=case');
  const sql = createPublicDataDiagnostics('ordinary');
  await expect(sql.observe('reader.settings', async () => { throw sqlError(); })).rejects.toThrow('sqlState=42501');
  expect(() => sql.assertion('settings-value', () => sql.comparison('settings.value', 0, 1, (a, e) => expect(a).toBe(e)))).toThrow('sqlState=42501');
  expect(sql.snapshot().firstFailure?.comparison).toBeUndefined();
});
it('makes truncation explicit for arrays, depth, node and total byte limits', async () => {
  const nested: Record<string, unknown> = {}; let cursor = nested;
  for (let i = 0; i < 20; i++) { const next = {}; cursor.value = next; cursor = next; }
  for (const actual of [Array(17).fill(id), nested, Array.from({ length: 16 }, () => Array.from({ length: 16 }, () => Array(16).fill(id)))]) {
    const d = createPublicDataDiagnostics('ordinary');
    expect(() => d.assertion('receipt-provenance', () => d.comparison('receipt.acquisition', actual, null, (a, e) => expect(a).toEqual(e)))).toThrow();
    await d.save(); expect((await comparisonArtifact()).comparison.truncated).toBe(true);
  }
});
it('uses the actual installed timestamptz parser without losing milliseconds at both ordinary comparison sites', async () => {
  const source = await readFile(new URL('./public-data-intake.integration-case.ts', import.meta.url), 'utf8');
  const ordinary = source.slice(0, source.indexOf('/** AUTHORED, NOT EXECUTED. Real restricted LOGIN'));
  const ast = ts.createSourceFile('ordinary.ts', ordinary, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const sites = new Map<string, ts.CallExpression>(); let matchers = 0;
  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
      if (node.expression.expression.getText(ast) === 'diagnostics' && node.expression.name.text === 'comparison') sites.set((node.arguments[0] as ts.StringLiteral).text, node);
      if (ts.isCallExpression(node.expression.expression) && node.expression.expression.expression.getText(ast) === 'expect') {
        matchers++;
        const callback = node.parent;
        expect(ts.isArrowFunction(callback) && ts.isCallExpression(callback.parent) && callback.parent.expression.getText(ast) === 'diagnostics.comparison').toBe(true);
      }
    }
    ts.forEachChild(node, visit);
  }; visit(ast);
  expect(matchers).toBe(48); expect(sites.size).toBe(48);
  for (const field of ['started', 'completed'] as const) {
    const site = sites.get('discovery.' + field)!;
    expect(site.arguments[1].getText(ast)).toBe('exactMatchupClockInstant(stored.' + field + ')');
    expect(site.arguments[2].getText(ast)).toBe(field === 'started' ? 'original.requestStartedAt' : 'original.requestCompletedAt');
    for (const fraction of ['000', '001', '123', '999']) {
      const parsed = types.getTypeParser(1184)('2026-10-08 18:00:00.' + fraction + '+00');
      const expected = '2026-10-08T18:00:00.' + fraction + 'Z';
      expect(parsed).toBeInstanceOf(Date); expect(exactMatchupClockInstant(parsed)).toBe(expected);
      expect(new Date(String(parsed)).toISOString()).toBe('2026-10-08T18:00:00.000Z');
    }
  }
});

it('uses a fixed UUID descriptor, records its calling group and never projects matcher objects', async () => {
  const d = createPublicDataDiagnostics('ordinary'), pattern = expect.stringMatching(/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/iu);
  const pass = vi.fn((a: string, e: unknown) => expect(a).toEqual(e));
  d.assertion('canonical-ids', () => d.comparison('uuid.shape', id, pattern, pass));
  expect(pass).toHaveBeenCalledOnce();
  expect(() => d.assertion('receipt-identities', () => d.comparison('uuid.shape', secret, pattern, (a, e) => expect(a).toEqual(e)))).toThrow();
  await d.save(); expect(await comparisonArtifact()).toMatchObject({ assertionCheckpoint: 'receipt-identities', comparison: {
    id: 'uuid.shape', occurrence: 2, matcher: 'toEqual', actual: { kind: 'string' }, expected: { pattern: 'uuid' } } });
});
it('keeps the first comparison and never reads exception-supplied actual, expected, stack or message', async () => {
  const d = createPublicDataDiagnostics('ordinary'), touched = vi.fn(() => { throw new Error(secret); });
  const error = Object.defineProperties({ name: 'AssertionError' }, Object.fromEntries(
    ['actual', 'expected', 'stack', 'message'].map(key => [key, { get: touched }])));
  const first = (() => { try { d.assertion('dispatch-witness', () => d.comparison('dispatch.flags', { server_window: false }, { server_window: true }, () => { throw error; })); }
    catch (caught) { return caught; } })();
  expect(() => d.assertion('discovery-times', () => d.comparison('discovery.started', 1, 2, (a, e) => expect(a).toBe(e)))).toThrow(first as Error);
  await d.save(); expect((await comparisonArtifact()).comparison.id).toBe('dispatch.flags');
  expect(touched).not.toHaveBeenCalled();
});
it('marks unknown object and array field presence without serializing their names or values', async () => {
  for (const actual of [{ status: 'complete', [secret]: secret }, Object.assign([id], { [secret]: secret })]) {
    const d = createPublicDataDiagnostics('ordinary');
    expect(() => d.assertion('receipt-provenance', () => d.comparison('receipt.acquisition', actual, null, (a, e) => expect(a).toEqual(e)))).toThrow();
    await d.save(); expect((await comparisonArtifact()).comparison.actual.$redactedFieldCount).toBe(1);
  }
});
it.each([
  ['live', LIVE_PROFILE, 'live-league-two-diagnostics.json'],
  ['journey', JOURNEY_PROFILE, 'public-data-live-diagnostics.json'],
] as const)('keeps %s diagnostics out of full-profile evidence and saves safe dynamic-field/tail failures under its own context', async (kind, profile, artifact) => {
  await expect(createPublicDataDiagnostics(kind).save()).rejects.toThrow('artifact.write');
  const context = await createQualificationContext(fileURLToPath(new URL('..', import.meta.url)), 'a'.repeat(40), randomUUID(), profile);
  vi.stubEnv(QUALIFICATION_CONTEXT_ENV, JSON.stringify(context));
  const expected = { nativeSettings: { fields: { arbitrary_private_key: 3 } }, players: Array.from({ length: 25 }, (_, i) => i) };
  for (const target of ['field', 'tail'] as const) {
    const actual = structuredClone(expected);
    if (target === 'field') actual.nativeSettings.fields.arbitrary_private_key = -7; else actual.players[24] = 123;
    const diagnostics = createPublicDataDiagnostics(kind);
    expect(() => diagnostics.assertion('live-core', () => assertLiveJson(actual, expected,
      (id, a, e) => diagnostics.comparison(id, a, e, (left, right) => expect(left).toEqual(right)), 'settings'))).toThrow('comparison=live.json.value');
    await diagnostics.save();
    const path = join(directory, artifact), serialized = await readFile(path, 'utf8');
    const report = JSON.parse(serialized), comparison = report.firstFailure.comparison;
    expect(report).toMatchObject({ caseKind: kind, profile, firstFailure: { assertionCheckpoint: 'live-core', comparison: { id: 'live.json.value', matcher: 'toEqual', truncated: false } } });
    expect(comparison.actual.value).toBe(target === 'field' ? -7 : 123);
    expect(comparison.expected.value).toBe(target === 'field' ? 3 : 24);
    expect(serialized).not.toContain('arbitrary_private_key');
    expect(serialized).toContain(target === 'field' ? 'nativeSettings' : 'players');
    if (target === 'tail') expect(comparison.actual.path.items).toContain(24);
    await rm(path);
  }
});

// Execute the maintained live closure/finally rather than a second diagnostic adapter.
async function liveReceiptFixture() {
  const context = await createQualificationContext(fileURLToPath(new URL('..', import.meta.url)), 'a'.repeat(40), randomUUID(), LIVE_PROFILE);
  vi.stubEnv(QUALIFICATION_CONTEXT_ENV, JSON.stringify(context));
  const source = await readFile(new URL('./league-two.live-integration-case.ts', import.meta.url), 'utf8');
  const tree = ts.createSourceFile('live.ts', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const wrappers: string[] = [], finalizers: string[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isVariableStatement(node) && node.declarationList.declarations.some(declaration =>
      ts.isIdentifier(declaration.name) && declaration.name.text === 'observedStore')) wrappers.push(node.getText(tree));
    if (ts.isTryStatement(node) && node.finallyBlock?.statements[0]?.getText(tree) === 'globalThis.fetch = originalFetch;') {
      finalizers.push(node.finallyBlock.getText(tree));
    }
    ts.forEachChild(node, visit);
  };
  visit(tree); expect(wrappers).toHaveLength(1); expect(finalizers).toHaveLength(1);
  const makeStore = new Function('administration', 'normalized', 'diagnostics', 'receiptReader', 'assertLiveJson', 'equal',
    ts.transpile(wrappers[0], { target: ts.ScriptTarget.ES2022 }) + '\nreturn observedStore;') as
    (...args: unknown[]) => PublicIntakeDependencies['administration'];
  const runFinally = new Function('originalFetch', 'diagnostics', 'writeIntegrationArtifact', 'qualificationDigest', 'binding', 'source', 'captures',
    'return (async () => ' + ts.transpile(finalizers[0], { target: ts.ScriptTarget.ES2022 }) + ')();') as (...args: unknown[]) => Promise<void>;
  const settings = receiptFixture(receiptCases[0]), rosters = receiptFixture(receiptCases[1]);
  for (const spec of receiptCases.slice(2)) {
    const resource = receiptFixture(spec);
    rosters.args[spec[1]] = resource.args[spec[1]];
    Object.assign(rosters.result, resource.result);
  }
  const diagnostics = createPublicDataDiagnostics('live'), originalFetch = globalThis.fetch;
  const read = vi.fn<ReceiptDiagnosticReader>(async () => {
    expect(globalThis.fetch).toBe(originalFetch);
    return [{ request_started_after_reservation: false, request_start_minus_reservation_ms: -0.001,
      request_start_minus_reservation_clamped: false }];
  });
  const guard = vi.fn<typeof fetch>(async () => { throw new Error(secret); });
  vi.stubGlobal('fetch', guard);
  const administration = fixture().administration;
  administration.recordObservation.mockImplementation(async input =>
    (input.envelope.family === 'league' ? settings.result : rosters.result) as never);
  const equal = (label: Parameters<typeof diagnostics.comparison>[0], actual: unknown, expected: unknown) =>
    diagnostics.assertion('live-core', () => diagnostics.comparison(label, actual, expected, (a, e) => expect(a).toEqual(e)));
  const store = makeStore(administration, [settings.args[0], rosters.args[0]], diagnostics, read, assertLiveJson, equal);
  const write = async () => {
    expect(await store.recordObservation(...settings.args)).toBe(settings.result);
    expect(await store.recordObservation(...rosters.args)).toBe(rosters.result);
    expect(administration.recordObservation.mock.calls).toEqual([settings.args, rosters.args]);
    expect(read).not.toHaveBeenCalled();
  };
  const fail = () => {
    try { equal('live.write', { settings: 'preserved' }, { settings: 'accepted' }); }
    catch (error) { return error as Error; }
    throw new Error('Expected original live comparison failure.');
  };
  const captureArtifact = vi.fn(async () => {});
  const finalize = async () => {
    await runFinally(originalFetch, diagnostics, captureArtifact, () => 'offline-context', { context }, { snapshot: () => ({}) }, []);
    expect(globalThis.fetch).toBe(originalFetch); expect(guard).not.toHaveBeenCalled(); expect(captureArtifact).toHaveBeenCalledOnce();
  };
  return { diagnostics, read, write, fail, finalize, settings, rosters };
}
it('queues all four exact live receipt bindings and restores fetch before failed-case diagnostics without replacing the failure', async () => {
  const f = await liveReceiptFixture(); await f.write(); const failure = f.fail(), original = f.diagnostics.snapshot().firstFailure;
  await f.finalize();
  expect(f.read).toHaveBeenCalledTimes(4);
  expect(f.read.mock.calls.map(([parameters]) => parameters.slice(0, 3))).toEqual(Array(4).fill([id, f.settings.attempt.id, f.settings.attempt.scopeId]));
  expect(f.read.mock.calls.map(([parameters]) => JSON.parse(parameters[4]).policy.coverageSpecId)).toEqual(receiptCases.map(spec => spec[4]));
  for (const [parameters, signal] of f.read.mock.calls) {
    expect(JSON.parse(parameters[3])).toEqual(f.settings.mapping); expect(parameters.slice(5)).toEqual([1, 0]); expect(signal.aborted).toBe(false);
  }
  expect(f.diagnostics.snapshot().firstFailure).toEqual(original); expect(f.diagnostics.failure('case', undefined)).toBe(failure);
  const artifact = await readFile(join(directory, 'live-league-two-diagnostics.json'), 'utf8'), saved = JSON.parse(artifact);
  expect(saved).toMatchObject({ caseKind: 'live', profile: LIVE_PROFILE, firstFailure: { comparison: { id: 'live.write' } } });
  expect(saved.events.filter((event: { phase: string }) => event.phase === 'administration.receipt')).toEqual(receiptCases.map(spec =>
    expect.objectContaining({ resource: spec[2], receipt: { state: 'available', requestStartedAfterReservation: false,
      requestStartMinusReservationMs: -0.001, requestStartMinusReservationClamped: false } })));
  for (const raw of [secret, id, f.settings.attempt.id, f.settings.mapping.connectionId]) expect(artifact).not.toContain(raw);
});
it('performs no live receipt reads when the case has no failure', async () => {
  const f = await liveReceiptFixture(); await f.write(); await f.finalize(); expect(f.read).not.toHaveBeenCalled();
  expect(f.diagnostics.snapshot().firstFailure).toBeNull();
});
it('keeps the original live comparison when a diagnostic read rejects', async () => {
  const f = await liveReceiptFixture(); await f.write(); const failure = f.fail();
  f.read.mockRejectedValue(new ReceiptDiagnosticReadError('transaction', sqlError()));
  await f.finalize(); expect(f.read).toHaveBeenCalledTimes(4); expect(f.diagnostics.failure('case', undefined)).toBe(failure);
  expect(f.diagnostics.snapshot().events.filter(event => event.receipt?.state === 'error')).toHaveLength(4);
  expect(await readFile(join(directory, 'live-league-two-diagnostics.json'), 'utf8')).not.toContain(secret);
});
it('uses one existing five-second bound for all live receipt reads and ignores late results', async () => {
  const f = await liveReceiptFixture(); await f.write(); const failure = f.fail(), late = Promise.withResolvers<readonly DatabaseRow[]>();
  f.read.mockImplementation(() => late.promise); vi.useFakeTimers();
  const saving = f.finalize(); let saved = false; void saving.then(() => { saved = true; });
  await vi.advanceTimersByTimeAsync(4999); expect(saved).toBe(false);
  await vi.advanceTimersByTimeAsync(1); await saving;
  expect(f.read).toHaveBeenCalledOnce(); expect(f.read.mock.calls[0][1].aborted).toBe(true);
  expect(f.diagnostics.snapshot().events.filter(event => event.receipt?.state === 'timeout')).toHaveLength(4);
  expect(f.diagnostics.failure('case', undefined)).toBe(failure);
  const snapshot = f.diagnostics.snapshot(); late.resolve([]); await Promise.resolve(); expect(f.diagnostics.snapshot()).toEqual(snapshot);
});
// Execute the maintained journey assertions and its actual catch/finally; never copy a SQL oracle.
async function journeyAssertionFixture() {
  const context = await createQualificationContext(fileURLToPath(new URL('..', import.meta.url)), 'a'.repeat(40), randomUUID(), JOURNEY_PROFILE);
  vi.stubEnv(QUALIFICATION_CONTEXT_ENV, JSON.stringify(context));
  const text = await readFile(new URL('./public-data.live-integration-case.ts', import.meta.url), 'utf8');
  const tree = ts.createSourceFile('journey.ts', text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const declarations = new Map<string, string>(), checks = new Map<string, ts.CallExpression>();
  let finalizer: ts.TryStatement | undefined;
  const visit = (node: ts.Node) => {
    if (ts.isVariableStatement(node)) for (const declaration of node.declarationList.declarations) {
      if (ts.isIdentifier(declaration.name) && ['check', 'equal', 'proveCollection', 'observedReaders'].includes(declaration.name.text)) declarations.set(declaration.name.text, node.getText(tree));
    }
    if (ts.isCallExpression(node) && node.expression.getText(tree) === 'check' && ts.isStringLiteral(node.arguments[1])) checks.set(node.arguments[1].text, node);
    if (ts.isTryStatement(node) && node.finallyBlock?.statements[0]?.getText(tree) === 'globalThis.fetch = originalFetch;') finalizer = node;
    ts.forEachChild(node, visit);
  };
  visit(tree); expect(declarations.size).toBe(4); expect(finalizer?.catchClause).toBeDefined();
  const diagnostics = createPublicDataDiagnostics('journey'); for (let i = 0; i < 14; i++) diagnostics.beginStep(1);
  const originalFetch = globalThis.fetch, guardedFetch = vi.fn<typeof fetch>(async () => { throw new Error(secret); });
  vi.stubGlobal('fetch', guardedFetch);
  const base = { diagnostics, expect, JOURNEY_LEAGUES, JOURNEY_MANAGER, JOURNEY_SEASON };
  const compile = (bindings: Record<string, unknown>, code: string) => new Function(...Object.keys(bindings),
    ts.transpile(code, { target: ts.ScriptTarget.ES2022 }));
  const prove = async (read: unknown, actual?: { database: unknown; administration: unknown }) => {
    const bindings = { ...base, readPublicSleeperIntake: actual ? readPublicSleeperIntake : vi.fn(async () => read), database: actual?.database ?? {}, administration: actual?.administration ?? {} };
    return compile(bindings, declarations.get('check')! + '\n' + declarations.get('observedReaders')! + '\n' + declarations.get('proveCollection')! + '\nreturn proveCollection;')(...Object.values(bindings))(id, 1);
  };
  const selected = async (key: string, supplied: Record<string, unknown>) => {
    const node = checks.get(key); expect(node).toBeDefined();
    const bindings = { ...base, ...supplied };
    return compile(bindings, declarations.get('check')! + '\nreturn (async () => { ' + node!.getText(tree) + '; })();')(...Object.values(bindings));
  };
  const profile = async (canonical: DatabaseRow, initialRules: unknown, options: { cycle?: 1 | 2; first?: DatabaseRow; refreshedRules?: unknown } = {}) => {
    const declaration = checks.get('journey.canonical.fields')!.parent.parent as ts.Block;
    const statements = [...declaration.statements];
    const start = statements.findIndex(statement => ts.isVariableStatement(statement)
      && statement.declarationList.declarations.some(value => value.name.getText(tree) === '[canonical]'));
    const end = statements.findIndex(statement => ts.isIfStatement(statement) && statement.getText(tree).includes("'journey.canonical.stable'"));
    expect(start).toBeGreaterThanOrEqual(0); expect(end).toBeGreaterThan(start);
    const query = vi.fn(async () => [canonical]);
    const capture = vi.fn((cycle: number) => ({ payload: { scoring_settings: cycle === 1 ? initialRules : options.refreshedRules } }));
    const bindings = { ...base, createHash, assertLiveJson, database: { query }, capture, cycle: options.cycle ?? 1,
      leagueId: JOURNEY_LEAGUES[0], mapping: { leagueSeasonId: id, connectionId: id }, firstIdentity: new Map([[JOURNEY_LEAGUES[0], options.first]]),
      uuid: /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/iu };
    const code = declarations.get('check')! + '\n' + declarations.get('equal')! + '\nreturn (async () => { '
      + statements.slice(start, end + 1).map(statement => statement.getText(tree)).join('\n') + ' })();';
    await compile(bindings, code)(...Object.values(bindings));
    expect(query).toHaveBeenCalledExactlyOnceWith(expect.stringContaining('LEFT JOIN public.scoring_profiles profile ON profile.id=season.scoring_profile_id'), [JOURNEY_LEAGUES[0], JOURNEY_SEASON]);
    expect(capture).toHaveBeenCalledExactlyOnceWith(1, 'bootstrap', JOURNEY_LEAGUES[0], 'league');
  };
  const tail = async (overrides: { cycles?: readonly string[]; disposition?: string; spacing?: boolean; count?: string; claims?: number;
    admissions?: number; unfinished?: readonly DatabaseRow[]; payloadChanged?: boolean; providerRequests?: number; intakeStatus?: string } = {}) => {
    const statements = [...finalizer!.tryBlock.statements];
    const start = statements.findIndex(statement => ts.isVariableStatement(statement)
      && statement.declarationList.declarations.some(value => value.name.getText(tree) === 'settled'));
    expect(start).toBeGreaterThanOrEqual(0);
    const parse = (oid: number, raw: string) => types.getTypeParser(oid, 'text')(raw);
    const query = vi.fn(async (sql: string) => {
      if (sql.includes('FROM public.public_data_refresh_cycles WHERE target_id=$1')) {
        const oid = sql.includes('SELECT cycle::integer AS cycle') ? 23 : 20;
        return (overrides.cycles ?? ['1']).map(value => ({ cycle: parse(oid, value) }));
      }
      if (sql.includes('SELECT disposition FROM public.public_data_refresh_cycle_outcomes')) return [{ disposition: parse(25, overrides.disposition ?? 'complete') }];
      if (sql.includes("bool_and(gap>=interval '60 seconds')")) return [{ count: parse(sql.includes('count(*)::int') ? 23 : 20, overrides.count ?? '28'), bounded: parse(16, overrides.spacing === false ? 'f' : 't') }];
      if (sql.includes('WHERE outcome.worker_id IS NULL')) return overrides.unfinished ?? [];
      throw new Error('Unexpected offline final-tail query.');
    });
    const originalPayload = { payload: 'original' }, capturePayload = overrides.payloadChanged ? { payload: 'changed' } : originalPayload;
    const source = { assertComplete: vi.fn(), captures: [{ capture: { payload: capturePayload }, payloadDigest: qualificationDigest(originalPayload) }] };
    const step = vi.fn(async () => ({ status: 'backoff', providerRequests: overrides.providerRequests ?? 0 }));
    const read = vi.fn(async () => ({ status: 'available', target: { id, externalManagerId: JOURNEY_MANAGER, cadenceSeconds: 3600 },
      cycle: { number: 1, requestId: id, outcome: { disposition: 'complete' } },
      intake: { status: overrides.intakeStatus ?? 'available', request: { terminal: true } } }));
    for (let index = 14; index < 29; index++) diagnostics.beginStep(2);
    const bindings = { ...base, runPublicDataRefreshStep: step, readPublicDataRefresh: read, database: { query }, dependencies: {}, observedReaders: {},
      targetId: id, currentRequest: id, JOURNEY_CADENCE_SECONDS: 3600, until: performance.now() + 60_000,
      claims: overrides.claims ?? 29, admissions: overrides.admissions ?? 28, source, qualificationDigest, finalized: false, process: { stdout: { write: vi.fn() } } };
    const code = declarations.get('check')! + '\nreturn (async () => { ' + statements.slice(start).map(statement => statement.getText(tree)).join('\n') + '; return { finalized }; })();';
    const result = await compile(bindings, code)(...Object.values(bindings));
    expect(query).toHaveBeenCalledTimes(4); expect(step).toHaveBeenCalledOnce(); expect(read).toHaveBeenCalledOnce(); expect(source.assertComplete).toHaveBeenCalledOnce();
    return result;
  };
  const run = async (action: () => Promise<unknown>) => {
    const bindings = { ...base, action, originalFetch, writeIntegrationArtifact, qualificationDigest, binding: { context },
      claims: 14, admissions: 14, finalized: false, changes: [], source: { snapshot: () => ({}) } };
    const body = 'return (async () => { try { await diagnostics.observe("reader.intake", action); } '
      + finalizer!.catchClause!.getText(tree) + ' finally ' + finalizer!.finallyBlock!.getText(tree) + ' })();';
    let thrown: unknown;
    try { await compile(bindings, body)(...Object.values(bindings)); } catch (error) { thrown = error; }
    expect(thrown).toBeInstanceOf(Error); expect(globalThis.fetch).toBe(originalFetch); expect(guardedFetch).not.toHaveBeenCalled();
    const raw = await readFile(join(directory, 'public-data-live-diagnostics.json'), 'utf8'), saved = JSON.parse(raw);
    expect(Buffer.byteLength(raw)).toBeLessThanOrEqual(64 * 1024); expect(raw).not.toContain(secret);
    expect(saved.firstFailure).toEqual(diagnostics.snapshot().firstFailure);
    expect(diagnostics.failure('case', new Error(secret))).toBe(thrown);
    return { raw, saved, thrown };
  };
  return { prove, selected, profile, tail, run, checks, tree };
}
const journeyRead = () => ({ status: 'available', request: { id, terminal: true, external_manager_id: JOURNEY_MANAGER,
  seasons: [JOURNEY_SEASON], failure_count: 0 }, rejected: [], leagues: JOURNEY_LEAGUES.map(externalLeagueId => ({ externalLeagueId })), lists: [{ season: JOURNEY_SEASON }] });
it.each(['status', 'header', 'league-order', 'list-count'] as const)('retains the actual journey first-readback %s mismatch through observe/catch/finally/save', async mode => {
  const f = await journeyAssertionFixture(), read = journeyRead();
  if (mode === 'status') read.status = 'partial';
  if (mode === 'header') read.request.terminal = false;
  if (mode === 'league-order') read.leagues.reverse();
  if (mode === 'list-count') read.lists = [];
  Object.assign(read, { arbitrary_secret_key: secret });
  const { saved, raw } = await f.run(() => f.prove(read));
  const label = mode === 'status' || mode === 'header' ? 'journey.intake.summary' : 'journey.intake.' + mode;
  expect(saved.firstFailure).toMatchObject({ phase: 'case.assertion', category: 'assertion', step: 14, cycle: 1,
    assertionCheckpoint: 'intake-readback', comparison: { id: label, matcher: mode === 'list-count' ? 'toHaveLength'
      : mode === 'league-order' ? 'toEqual' : 'toMatchObject', occurrence: 1 } });
  if (mode === 'status') expect(saved.firstFailure.comparison.actual.status).toBe('partial');
  if (mode === 'header') expect(saved.firstFailure.comparison.actual.request.terminal).toBe(false);
  if (mode === 'list-count') expect(saved.firstFailure.comparison.actual).toEqual({ length: 0 });
  expect(raw).not.toContain('arbitrary_secret_key'); expect(raw).not.toContain(JOURNEY_MANAGER);
});
it.each([
  ['journey.receipt.generation', 'toBe', { reader: { accepted: { acceptedGeneration: 2 } }, acceptedWrites: [{ acceptedGeneration: 1 }], i: 0 }],
  ['journey.directory.fresh', 'not.toBe', { directoryCapture: { id }, firstDirectories: new Map([['league', id]]), leagueId: 'league' }],
  ['journey.manager.uuid', 'toMatch', { manager: { providerManagerId: secret }, uuid: /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/iu }],
  ['journey.settlement.spacing', 'toEqual', { spacing: { count: 27, bounded: false } }],
] as const)('retains actual late %s assertion identity and unchanged matcher %s', async (label, matcher, bindings) => {
  const f = await journeyAssertionFixture(), { saved } = await f.run(() => f.selected(label, bindings));
  expect(saved.firstFailure).toMatchObject({ phase: 'case.assertion', category: 'assertion', comparison: { id: label, matcher, occurrence: 1 } });
  if (matcher === 'not.toBe') expect(saved.firstFailure.comparison.actual).toEqual(saved.firstFailure.comparison.expected);
  if (matcher === 'toMatch') expect(saved.firstFailure.comparison.expected).toEqual({ pattern: 'uuid' });
});
it('retains the exact actual history assertion while bounding and sanitizing large immutable-row differences', async () => {
  const f = await journeyAssertionFixture();
  const rows = Array.from({ length: 30 }, (_, n) => ({ id: String(n), payload: { private_key: secret }, name: secret }));
  const { saved, raw } = await f.run(() => f.selected('journey.history.unchanged', {
    database: { query: vi.fn(async () => rows) }, item: { sql: secret, args: [secret], rows: [] },
  }));
  expect(saved.firstFailure).toMatchObject({ assertionCheckpoint: 'stored-resources', comparison: { id: 'journey.history.unchanged',
    matcher: 'toEqual', occurrence: 1, truncated: true, redacted: true } });
  expect(raw).not.toContain('private_key'); expect(raw).not.toContain(secret);
});
it('requires every journey matcher to use owned comparison instrumentation and the matching closed matcher label', async () => {
  const f = await journeyAssertionFixture();
  const text = await readFile(new URL('./public-data-refresh-diagnostics.ts', import.meta.url), 'utf8');
  const tree = ts.createSourceFile('diagnostics.ts', text, ts.ScriptTarget.Latest, true), labels = new Map<string, string>();
  const collect = (node: ts.Node) => {
    if (ts.isVariableDeclaration(node) && node.name.getText(tree) === 'comparisons' && node.initializer && ts.isAsExpression(node.initializer)
      && ts.isObjectLiteralExpression(node.initializer.expression)) for (const property of node.initializer.expression.properties) {
      if (ts.isPropertyAssignment(property) && ts.isStringLiteral(property.name) && ts.isStringLiteral(property.initializer)) labels.set(property.name.text, property.initializer.text);
    }
    ts.forEachChild(node, collect);
  }; collect(tree);
  expect(f.checks.size).toBe(72);
  let count = 0;
  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node) && node.expression.getText(f.tree) === 'expect') {
      count++; let parent: ts.Node | undefined = node, owner: ts.CallExpression | undefined;
      while (parent) {
        if (ts.isCallExpression(parent) && ['check', 'diagnostics.comparison'].includes(parent.expression.getText(f.tree))) { owner = parent; break; }
        parent = parent.parent;
      }
      expect(owner, 'Every matcher needs an owned comparison.').toBeDefined();
      if (owner?.expression.getText(f.tree) === 'check') {
        let expression: ts.Node = node.parent; while (!ts.isCallExpression(expression)) expression = expression.parent;
        const matcher = (expression as ts.CallExpression).expression.getText(f.tree).replace(/^expect\(a\)\./u, '');
        const key = (owner.arguments[1] as ts.StringLiteral).text;
        expect(matcher).toBe(labels.get(key));
      }
    }
    ts.forEachChild(node, visit);
  }; visit(f.tree); expect(count).toBe(73);
});
it('supplements a partial first readback with a bounded league alias and exact unavailable resource reason', async () => {
  const f = await journeyAssertionFixture(), read = journeyRead(); read.status = 'partial';
  Object.assign(read.leagues[2], { collection: 'complete', resources: {
    settings: { status: 'available' }, teamManagers: { status: 'available' }, heldRoster: { status: 'unavailable', reason: 'intake-capture-not-current-head', retained: { payload: secret } },
    directory: { status: 'available' }, teamManagerEvidence: { status: 'available' },
  } });
  const { saved, raw } = await f.run(() => f.prove(read)), evidence = saved.firstFailure.comparison;
  expect(evidence.readback).toMatchObject({ length: 4, omitted: 0, truncated: false });
  expect(evidence.readback.items[2]).toMatchObject({ ordinal: 3, externalLeagueId: { kind: 'native-id', alias: expect.any(Number) }, collection: 'complete',
    resources: { heldRoster: { status: 'unavailable', reason: 'intake-capture-not-current-head' } } });
  expect(new Set(evidence.readback.items.map((row: { externalLeagueId: { alias: number } }) => row.externalLeagueId.alias)).size).toBe(4);
  expect(raw).not.toContain('retained'); expect(raw).not.toContain(secret);
});
it('never invokes supplemental getters and bounds foreign members and unknown reasons', async () => {
  const f = await journeyAssertionFixture(), read = journeyRead(), getter = vi.fn(() => { throw new Error(secret); }); read.status = 'partial';
  Object.assign(read.leagues[0], { resources: { heldRoster: { status: 'unavailable', reason: secret, payload: secret } } });
  Object.defineProperty(read.leagues[1], 'resources', { get: getter });
  read.leagues.push(...JOURNEY_LEAGUES.map(externalLeagueId => ({ externalLeagueId })));
  const { saved, raw } = await f.run(() => f.prove(read)), evidence = saved.firstFailure.comparison;
  expect(getter).not.toHaveBeenCalled(); expect(evidence).toMatchObject({ truncated: true, redacted: true });
  expect(evidence.readback).toMatchObject({ length: 8, omitted: 4, truncated: true }); expect(evidence.readback.items).toHaveLength(4);
  expect(evidence.readback.items[0].resources.heldRoster.reason).toBe('other'); expect(raw).not.toContain(secret);
});
it('keeps a swallowed actual typed-reader SQL failure first and adds the actual composed-reader partial summary without extra queries', async () => {
  const f = await journeyAssertionFixture(), original = fixture().mapping;
  const mapping = (native: string) => ({ ...original, scope: { ...original.scope, externalLeagueId: native, leagueKey: 'sleeper-' + native } });
  const observed = { status: 'available', accepted: { observationIds: [id] } };
  const admin = { readSourceMapping: vi.fn(async (native: string) => mapping(native)),
    readAcceptedLeagueSettings: vi.fn(async () => observed), readAcceptedTeamManagers: vi.fn(async () => observed),
    readAcceptedCurrentRoster: vi.fn(async () => { throw sqlError(); }), readAcceptedTeamManagerEvidence: vi.fn(async () => observed),
    readSource: vi.fn(async () => ({ status: 'available', observationId: id })),
  };
  const query = vi.fn(async (sql: string) => {
    if (sql.includes('read-request')) return [journeyRead().request];
    if (sql.includes('read-lists')) return [{ season: JOURNEY_SEASON }];
    if (sql.includes('read-candidates')) return JOURNEY_LEAGUES.map(native => ({ season: JOURNEY_SEASON, external_league_id: native,
      name: secret, stage: 'complete', league_season_id: original.leagueSeasonId, settings_receipt_id: id, players_receipt_id: id,
      managers_receipt_id: id, users_observation_id: id, directory_capture: { sourceMapping: mapping(native) } }));
    if (sql.includes('read-rejections')) return [];
    throw new Error('Unexpected offline query.');
  });
  const { saved, raw } = await f.run(() => f.prove(undefined, { database: { enabled: true, query }, administration: admin }));
  expect(saved.firstFailure).toMatchObject({ phase: 'reader.players', category: 'sql', sqlState: '42501', step: 14, cycle: 1,
    readbackComparison: { assertionCheckpoint: 'intake-readback', comparison: { id: 'journey.intake.summary', matcher: 'toMatchObject' } } });
  expect(saved.firstFailure.comparison).toBeUndefined();
  expect(saved.firstFailure.readbackComparison.comparison.readback.items).toHaveLength(4);
  for (const entry of saved.firstFailure.readbackComparison.comparison.readback.items) expect(entry.resources.heldRoster).toEqual({ status: 'unavailable', reason: 'held-roster-read-failed' });
  expect(query).toHaveBeenCalledTimes(4); expect(admin.readAcceptedCurrentRoster).toHaveBeenCalledTimes(4);
  for (const [index, call] of admin.readAcceptedCurrentRoster.mock.calls.entries()) expect(call).toEqual([mapping(JOURNEY_LEAGUES[index]), { includeSeasonOverview: true }]);
  expect(raw).not.toContain(secret);
});
it('refuses nested native-ID objects and keeps the fixed readback supplement small', async () => {
  const f = await journeyAssertionFixture(), read = journeyRead(); read.status = 'partial';
  Object.assign(read.leagues[0], { externalLeagueId: { payload: Array.from({ length: 50 }, () => ({ envelope: { name: secret, value: 'large'.repeat(1000) } })) } });
  const { saved, raw } = await f.run(() => f.prove(read));
  expect(saved.firstFailure.comparison.readback.items[0].externalLeagueId).toEqual({ redacted: 'invalid-native-id' });
  expect(Buffer.byteLength(JSON.stringify(saved.firstFailure.comparison.readback))).toBeLessThan(4 * 1024);
  expect(raw).not.toContain('large'); expect(raw).not.toContain(secret);
});
it('preserves the original assertion when a revoked proxy makes the fixed readback supplement uninspectable', async () => {
  const context = await createQualificationContext(fileURLToPath(new URL('..', import.meta.url)), 'a'.repeat(40), randomUUID(), JOURNEY_PROFILE);
  vi.stubEnv(QUALIFICATION_CONTEXT_ENV, JSON.stringify(context));
  const { proxy, revoke } = Proxy.revocable([], {}); revoke();
  const diagnostics = createPublicDataDiagnostics('journey'); let first: unknown;
  try { diagnostics.assertion('intake-readback', () => diagnostics.comparison('journey.intake.summary', { status: 'partial', leagues: proxy },
    { status: 'available' }, () => expect(false).toBe(true))); } catch (error) { first = error; }
  await diagnostics.save(); const raw = await readFile(join(directory, 'public-data-live-diagnostics.json'), 'utf8'), saved = JSON.parse(raw);
  expect(saved.firstFailure).toMatchObject({ category: 'assertion', comparison: { id: 'journey.intake.summary', matcher: 'toMatchObject',
    readback: { state: 'unavailable', redacted: true } } });
  expect(diagnostics.failure('case', new Error(secret))).toBe(first); expect(Buffer.byteLength(raw)).toBeLessThanOrEqual(64 * 1024);
});

const profileRules = { rec: 1, unsupported_bonus: 2 };
const profileRow = (rules: Record<string, number> | null | undefined): DatabaseRow => {
  const configured = rules != null && Object.keys(rules).length > 0;
  return { league_id: id, league_season_id: id, connection_id: id, scoring_profile_id: configured ? id : null,
    profile_id: configured ? id : null, rules_hash: configured ? createHash('sha256').update(JSON.stringify(Object.fromEntries(Object.entries(rules).sort(([a], [b]) => a.localeCompare(b))))).digest('hex') : null,
    profile_rules: configured ? rules : null, active: false, evidence: 'public-data-intake-v1' };
};
it.each([
  { name: 'supported', rules: { rec: 1 } }, { name: 'unfamiliar numeric', rules: profileRules },
  { name: 'absent', rules: undefined }, { name: 'null', rules: null }, { name: 'empty', rules: {} },
] as { name: string; rules: Record<string, number> | null | undefined }[])('accepts the actual journey canonical oracle for initial $name registration evidence', async ({ rules }) => {
  const f = await journeyAssertionFixture(); await f.profile(profileRow(rules), rules);
});
it.each([
  ['missing profile', { scoring_profile_id: null }, 'journey.canonical.profile-present'],
  ['numeric profile', { scoring_profile_id: 42 }, 'journey.canonical.profile-present'],
  ['object profile', { scoring_profile_id: { payload: secret } }, 'journey.canonical.profile-present'],
  ['invalid profile UUID', { scoring_profile_id: 'invalid' }, 'journey.canonical.profile-uuid'],
  ['missing joined profile', { profile_id: null }, 'journey.canonical.profile-binding'],
  ['wrong joined profile', { profile_id: '22222222-2222-4222-8222-222222222222' }, 'journey.canonical.profile-binding'],
  ['wrong hash', { rules_hash: '0'.repeat(64) }, 'journey.canonical.profile-hash'],
  ['missing hash', { rules_hash: null }, 'journey.canonical.profile-hash'],
  ['missing rules', { profile_rules: null }, 'live.json.type'],
  ['wrong numeric rule', { profile_rules: { rec: 1, unsupported_bonus: 3 } }, 'live.json.value'],
  ['omitted unfamiliar rule', { profile_rules: { rec: 1 } }, 'live.json.length'],
] as const)('rejects %s through the actual canonical oracle with bounded exact diagnostic', async (_name, change, label) => {
  const f = await journeyAssertionFixture(), { saved, raw } = await f.run(() => f.profile({ ...profileRow(profileRules), ...change }, profileRules));
  expect(saved.firstFailure.comparison.id).toBe(label);
  expect(raw).not.toContain('unsupported_bonus'); expect(raw).not.toContain(id);
  if (label === 'journey.canonical.profile-hash') expect(saved.firstFailure.comparison.expected).toMatchObject({ kind: 'string', alias: expect.any(Number) });
});
it.each(['scoring_profile_id', 'profile_id', 'rules_hash', 'profile_rules'] as const)('requires NULL %s for initially absent/null/empty profile evidence', async field => {
  const f = await journeyAssertionFixture(), row = { ...profileRow(null), [field]: field === 'profile_rules' ? {} : id };
  const { saved } = await f.run(() => f.profile(row, null)); expect(saved.firstFailure.comparison.id).toBe('journey.canonical.profile-empty');
  expect(saved.firstFailure.comparison.actual[field]).not.toBeNull(); expect(saved.firstFailure.comparison.expected[field]).toBeNull();
});
it.each([
  { name: 'same supported rules', initial: { rec: 1 }, refreshed: { rec: 1 } },
  { name: 'changed supported rules', initial: { rec: 1 }, refreshed: { rec: 2 } },
  { name: 'changed unfamiliar rules', initial: profileRules, refreshed: { different_unfamiliar: 9 } },
  { name: 'initial NULL with later configured rules', initial: null, refreshed: profileRules },
])('preserves initial immutable profile with $name on refresh', async ({ initial, refreshed }) => {
  const f = await journeyAssertionFixture(), row = profileRow(initial);
  await f.profile(row, initial, { cycle: 2, first: structuredClone(row), refreshedRules: refreshed });
});
it('rejects replacement of the original season profile even when replacement rules and hash are equal', async () => {
  const f = await journeyAssertionFixture(), first = profileRow(profileRules), replacement = { ...first,
    scoring_profile_id: '22222222-2222-4222-8222-222222222222', profile_id: '22222222-2222-4222-8222-222222222222' };
  const { saved } = await f.run(() => f.profile(replacement, profileRules, { cycle: 2, first, refreshedRules: profileRules }));
  expect(saved.firstFailure.comparison.id).toBe('journey.canonical.stable');
});
it('executes the actual final journey tail with installed Neon parsers and reaches finalization without weakening strict numeric equality', async () => {
  const f = await journeyAssertionFixture(); expect(await f.tail()).toEqual({ finalized: true });
  expect(types.getTypeParser(20, 'text')('1')).toBe('1'); expect(types.getTypeParser(23, 'text')('1')).toBe(1);
});
it.each([
  ['wrong cycle', { cycles: ['2'] }, 'journey.refresh.cycle-count'],
  ['extra cycle', { cycles: ['1', '2'] }, 'journey.refresh.cycle-count'],
  ['missing cycle', { cycles: [] }, 'journey.refresh.cycle-count'],
  ['partial disposition', { disposition: 'partial' }, 'journey.refresh.disposition'],
  ['short spacing', { spacing: false }, 'journey.settlement.spacing'],
  ['missing dispatch', { count: '27' }, 'journey.settlement.spacing'],
  ['extra dispatch', { count: '29' }, 'journey.settlement.spacing'],
  ['missing claim', { claims: 28 }, 'journey.settlement.claims'],
  ['extra claim', { claims: 30 }, 'journey.settlement.claims'],
  ['missing admission', { admissions: 27 }, 'journey.settlement.admissions'],
  ['extra admission', { admissions: 29 }, 'journey.settlement.admissions'],
  ['unfinished dispatch', { unfinished: [{ worker_id: id }] }, 'journey.settlement.unfinished'],
  ['changed retained payload', { payloadChanged: true }, 'journey.capture.unchanged'],
  ['extra settlement GET', { providerRequests: 1 }, 'journey.settlement.outcome'],
  ['partial composed readback', { intakeStatus: 'partial' }, 'journey.refresh.readback'],
] as const)('refuses %s in the actual final journey tail and saves the precise failure', async (_name, change, label) => {
  const f = await journeyAssertionFixture(), { saved } = await f.run(() => f.tail(change));
  expect(saved.firstFailure).toMatchObject({ category: 'assertion', step: 29, cycle: 2, comparison: { id: label } });
});
{
// Execute the actual SQL case's changed capture/checkpoint/readback tail offline.
// The transport and witness helpers are real; SQL and the HTTP response are fixtures.
const source = await readFile(new URL('./public-data-intake.integration-case.ts', import.meta.url), 'utf8');
const ast = ts.createSourceFile('case.ts', source, ts.ScriptTarget.Latest, true);
let statements: readonly ts.Statement[] | undefined;
const visit = (node: ts.Node) => {
  if (ts.isCallExpression(node) && node.expression.getText(ast) === 'it'
    && ts.isStringLiteral(node.arguments[0])
    && node.arguments[0].text === 'retains a real admitted capture when a competing pause waits for that admission to commit') {
    const body = (node.arguments[1] as ts.ArrowFunction).body as ts.Block;
    const attempt = body.statements.find(ts.isTryStatement)!;
    const start = attempt.tryBlock.statements.findIndex(statement => statement.getText(ast).startsWith('const witness ='));
    if (start < 0) throw new Error('Actual witnessed capture tail is missing.');
    statements = attempt.tryBlock.statements.slice(start);
  }
  ts.forEachChild(node, visit);
};
visit(ast);
if (!statements?.length) throw new Error('Actual admission race case was not found.');
const tail = ts.transpileModule(statements.map(statement => statement.getText(ast)).join('\n'),
  { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
const execute = new Function('bindings', `return (async () => { const { intake, work, owner, selected, connection, capture,
  validateRequestedPublicCaptureWitness, capturePublicSleeperIdentity, assertOriginalPublicCapture, expect } = bindings;
  ${tail} })();`) as (bindings: Record<string, unknown>) => Promise<void>;

function fixture() {
  const work = { requestId: '11111111-1111-4111-8111-111111111111', revision: 0, kind: 'identity' as const, username: 'fixture_manager' };
  const fence = { jobKey: 'league-administration-public-intake', workerId: '22222222-2222-4222-8222-222222222222',
    generation: 1, deadlineAt: new Date(Date.now() + 20_000).toISOString() };
  const witness: PublicCaptureWitness = { version: 'public-network-capture-v1', work, fence,
    dispatchNonce: '33333333-3333-4333-8333-333333333333', mapping: null, attempts: {} };
  const events: string[] = [];
  const capture = vi.fn<typeof fetch>(async input => {
    expect(String(input)).toBe('https://api.sleeper.app/v1/user/fixture_manager');
    events.push('GET'); return new Response(JSON.stringify({ user_id: '987654321', username: 'fixture_manager' }));
  });
  vi.stubGlobal('fetch', capture);
  const intake = {
    captureWitness: vi.fn(async () => { events.push('witness'); return witness; }),
    recordIdentity: vi.fn(async (_work: unknown, document: { acquisition?: PublicCaptureWitness }, _fence: unknown) => {
      expect(_work).toEqual(work); expect(_fence).toEqual(fence);
      assertOriginalPublicCapture(document, witness); events.push('checkpoint');
    }),
    next: vi.fn(async () => ({ kind: 'leagues' })),
  };
  const query = vi.fn(async (sql: string): Promise<DatabaseRow[]> => {
    if (sql.includes('SELECT outcome FROM')) return [{ outcome: 'checkpoint-committed' }];
    if (sql.includes('SELECT outcome.capture_acquisition')) return [{ capture_acquisition: witness, exact_witness: true }];
    if (sql.includes('public_data_refresh_selection_failures')) return [];
    throw new Error('Unexpected offline readback.');
  });
  const bindings = { intake, work, owner: { fence }, selected: { requestId: work.requestId }, connection: { database: { query } },
    capture, validateRequestedPublicCaptureWitness, capturePublicSleeperIdentity, assertOriginalPublicCapture, expect };
  return { bindings, witness, intake, capture, events, query };
}

it('executes the witnessed SQL-case tail through the actual transport and original-capture seal', async () => {
  const f = fixture(); await execute(f.bindings);
  expect(f.events).toEqual(['witness', 'GET', 'checkpoint']);
  expect(f.intake.captureWitness).toHaveBeenCalledExactlyOnceWith(f.bindings.work, null, f.bindings.owner.fence);
  expect(f.intake.recordIdentity).toHaveBeenCalledExactlyOnceWith(f.bindings.work,
    expect.objectContaining({ acquisition: f.witness }), f.bindings.owner.fence);
  expect(f.query).toHaveBeenCalledTimes(3);
});

it('waits for the witness before issuing the capture GET', async () => {
  const f = fixture(); let release!: (value: PublicCaptureWitness) => void;
  f.intake.captureWitness.mockImplementation(() => new Promise(resolve => { release = resolve; }));
  const pending = execute(f.bindings);
  expect(f.capture).not.toHaveBeenCalled(); expect(f.intake.recordIdentity).not.toHaveBeenCalled();
  release(f.witness); await pending; expect(f.capture).toHaveBeenCalledTimes(1);
});

it('refuses a witness for different work before any GET or checkpoint', async () => {
  const f = fixture(); f.intake.captureWitness.mockResolvedValue({ ...f.witness, work: { ...f.witness.work, revision: 1 } });
  await expect(execute(f.bindings)).rejects.toThrow('reservation group mismatch');
  expect(f.capture).not.toHaveBeenCalled(); expect(f.intake.recordIdentity).not.toHaveBeenCalled();
});

it.each(['omitted', 'copied', 'retagged'] as const)('refuses a %s transport witness before checkpoint', async mode => {
  const f = fixture();
  f.bindings.capturePublicSleeperIdentity = async (username, signal, witness) => {
    const document = await capturePublicSleeperIdentity(username, signal, mode === 'omitted' ? undefined : witness);
    if (mode === 'omitted') return document;
    return { ...document, acquisition: mode === 'retagged' ? { ...witness!, dispatchNonce: '44444444-4444-4444-8444-444444444444' } : document.acquisition };
  };
  await expect(execute(f.bindings)).rejects.toThrow();
  expect(f.capture).toHaveBeenCalledTimes(1); expect(f.intake.recordIdentity).not.toHaveBeenCalled();
});

it.each(['missing', 'mismatched', 'duplicate'] as const)('rejects %s retained acquisition readback', async mode => {
  const f = fixture(); const original = f.query.getMockImplementation()!;
  f.query.mockImplementation(async sql => {
    if (!sql.includes('SELECT outcome.capture_acquisition')) return original(sql);
    const row = { capture_acquisition: mode === 'missing' ? null : f.witness, exact_witness: mode !== 'mismatched' };
    return mode === 'duplicate' ? [row, row] : [row];
  });
  await expect(execute(f.bindings)).rejects.toThrow();
  expect(f.intake.recordIdentity).toHaveBeenCalledTimes(1);
});

}
