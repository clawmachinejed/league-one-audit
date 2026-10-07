import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
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
  vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); outbound.mockClear();
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
  return { dependencies, intake, administration, source, refresh, jobs };
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
