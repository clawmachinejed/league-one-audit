import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import type { ReceiptDiagnosticReader } from './neon-integration-harness';
import { runPublicDataRefreshStep, type PublicIntakeDependencies } from '../lib/league-administration/public-intake';
import { createLeagueAdministrationStore } from '../lib/league-administration/store';
import type { PublicIntakeStore } from '../lib/league-administration/public-intake-contracts';
import type { PublicDataRefreshStore } from '../lib/league-administration/public-refresh-contracts';
import type { NormalizedAdministrationObservation } from '../lib/league-administration/contracts';
import { createPublicDataDiagnostics, observePublicDataDependencies } from './public-data-refresh-diagnostics';
import { createQualificationContext, INGESTION_PROFILE, QUALIFICATION_CONTEXT_ENV } from './qualification-profile';
vi.mock('server-only', () => ({}));
vi.mock('next/cache', () => ({ unstable_cache: (fn: unknown) => fn }));

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
