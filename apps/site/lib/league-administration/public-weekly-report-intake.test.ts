import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import net from 'node:net';
import { capturePublicSleeperWeeklyReport } from '../sleeper';
import { createLeagueAdministrationStore } from './store';
import { createPublicDataRefreshStore, createPublicIntakeStore } from './neon/public-intake';
import { validatePublicIntake, type PublicIntakeStore } from './public-intake-contracts';
import { validatePublicDataRefresh } from './public-refresh-contracts';
import { parsePublicCaptureWitness, assertOriginalPublicCapture } from './public-capture-witness';
import { runPublicIntakeStep, type PublicIntakeDependencies } from './public-intake';
import { readPublicWeeklyReports } from './public-weekly-report-reader';
import { readPublicSleeperIntake } from './public-intake-reader';
import { WEEKLY_REPORT_VERSION, normalizeWeeklyReportEnvelope, type AcceptedWeeklyReportRead } from '../aggregator/weekly-reports';
import type { PublicCaptureWitness } from './contracts';
import type { DatabaseClient } from '../database';
import type { LeagueAdministrationStore } from './store-contracts';
import retained from '../../test-support/fixtures/cp13-live-source-2026/weekly-reports.json';

vi.mock('server-only', () => ({}));
vi.mock('next/cache', () => ({ unstable_cache: (fn: unknown) => fn }));
beforeEach(() => { vi.spyOn(net.Socket.prototype, 'connect').mockImplementation(() => { throw new Error('Unexpected outbound connection.'); }); });
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
const native = retained.observations[0].externalLeagueId, requestId = randomUUID();
const work = { requestId, revision: 3, kind: 'weekly-report' as const, externalLeagueId: native, season: 2026 as const, nativeWeek: 1 };
const mapping = { connectionId: randomUUID(), leagueSeasonId: randomUUID(), revisionId: randomUUID(), generation: 1,
  scope: { leagueKey: 'report-unit', provider: 'sleeper' as const, externalLeagueId: native, season: 2026 } };
const input = { id: requestId, username: 'report_manager', seasons: [2026] };
const configuration = { id: randomUUID(), expectedRevision: 0, identityRequestId: requestId, seasons: [2026], cadenceSeconds: 60,
  expiresAt: new Date(Date.now() + 86_400_000).toISOString(), paused: false };
function witness(): PublicCaptureWitness {
  return { version: 'public-network-capture-v1', work, mapping,
    fence: { jobKey: 'league-administration-public-intake', workerId: randomUUID(), generation: 1,
      deadlineAt: new Date(Date.now() + 20_000).toISOString() }, dispatchNonce: randomUUID(),
    attempts: { weekly_report: { id: randomUUID(), nonce: randomUUID() } } };
}
function fixture() {
  const events: string[] = [], receiptId = randomUUID(), observationId = randomUUID();
  let attemptId = '';
  const fetch = vi.fn<typeof globalThis.fetch>(async () => { events.push('post'); return Response.json(retained.observations[0].report.document); });
  vi.stubGlobal('fetch', fetch);
  const intake: PublicIntakeStore = { submit: vi.fn(async () => undefined), recover: vi.fn(async () => undefined),
    next: vi.fn(async () => work), admit: vi.fn(async () => true), recordIdentity: vi.fn(async () => undefined),
    recordLeagues: vi.fn(async () => undefined), register: vi.fn(async () => undefined), completeCore: vi.fn(async () => undefined),
    completeExactPeriod: vi.fn(async () => undefined), completeWeeklyReport: vi.fn(async () => undefined), fail: vi.fn(async () => undefined),
    captureWitness: vi.fn(async (selected, selectedMapping, fence) => {
      events.push('witness'); return { ...witness(), work: selected, mapping: selectedMapping, fence,
        attempts: { weekly_report: { id: attemptId, nonce: randomUUID() } } };
    }) };
  const administration = { ...createLeagueAdministrationStore({ enabled: false, reason: 'missing-database-url' }), enabled: true,
    readSourceMapping: vi.fn(async () => mapping),
    beginWeeklyReportAttempt: vi.fn<NonNullable<LeagueAdministrationStore['beginWeeklyReportAttempt']>>(async (_mapping, week, id) => {
      expect(week).toBe(1); events.push('reserve'); attemptId = id;
      return { id, scopeId: randomUUID(), ordinal: 1, expectedGeneration: 0 };
    }),
    recordObservation: vi.fn<LeagueAdministrationStore['recordObservation']>(async normalized => {
      events.push('write');
      if (normalized.status !== 'accepted') return { status: 'rejected', reason: 'invalid-report' };
      return { status: 'changed', observationId, weeklyReportAcceptance: { status: 'accepted', receiptId, acceptedGeneration: 1 } };
    }) } satisfies LeagueAdministrationStore;
  const jobs = { acquireJob: vi.fn(async () => ({ kind: 'acquired' as const, attempt: 1, leaseUntil: new Date(Date.now() + 25_000).toISOString() })),
    completeJob: vi.fn(async () => true), failJob: vi.fn(async () => true) };
  const dependencies: PublicIntakeDependencies = { intake, administration, jobs };
  return { events, fetch, intake, administration, dependencies, receiptId, observationId,
    run: () => runPublicIntakeStep(requestId, dependencies, new AbortController().signal) };
}

describe('explicit report selectors and capabilities', () => {
  it('keeps omitted and empty report selection off the old wire and sorts only explicit weeks', () => {
    expect(validatePublicIntake(input)).toEqual(input);
    expect(validatePublicIntake({ ...input, weeklyReports: [] })).toEqual(input);
    expect(validatePublicDataRefresh({ ...configuration, weeklyReports: [] })).not.toHaveProperty('weeklyReports');
    const selected = [{ season: 2026, nativeWeek: 4 }, { season: 2026, nativeWeek: 1 }];
    expect(validatePublicIntake({ ...input, weeklyReports: selected }).weeklyReports).toEqual([...selected].reverse());
    expect(validatePublicDataRefresh({ ...configuration, weeklyReports: selected }).weeklyReports).toEqual([...selected].reverse());
    expect(selected[0].nativeWeek).toBe(4);
  });
  it.each([null, false, {}, [{ season: 2025, nativeWeek: 1 }], [{ season: 2026, nativeWeek: 0 }],
    [{ season: 2026, nativeWeek: 19 }], [{ season: 2026, nativeWeek: '1' }], [{ season: 2026, nativeWeek: 1, extra: true }],
    [{ season: 2026, nativeWeek: 1 }, { season: 2026, nativeWeek: 1 }]])('rejects malformed or ambiguous report scope %j', weeklyReports => {
    expect(() => validatePublicIntake({ ...input, weeklyReports } as never)).toThrow();
    expect(() => validatePublicDataRefresh({ ...configuration, weeklyReports } as never)).toThrow();
  });
  it('rejects report selection outside the current-season-only contract', () => {
    expect(() => validatePublicIntake({ ...input, seasons: [2026, 2027], weeklyReports: [{ season: 2026, nativeWeek: 1 }] })).toThrow();
  });
  it('checks R050 before selected mutation and makes no capability query for omitted selection', async () => {
    const query = vi.fn(async (statement: string) => statement.includes('capability') ? [{ supported: false }] : []);
    const client = { enabled: true, query } as unknown as DatabaseClient;
    await expect(createPublicIntakeStore(client).submit({ ...input, weeklyReports: [{ season: 2026, nativeWeek: 1 }] })).rejects.toThrow('R050');
    await expect(createPublicDataRefreshStore(client).configure({ ...configuration, weeklyReports: [{ season: 2026, nativeWeek: 1 }] })).rejects.toThrow('R050');
    expect(query.mock.calls.every(call => call[0].includes('weekly-report-capability'))).toBe(true);
    query.mockClear(); await createPublicIntakeStore(client).submit(input);
    expect(query).toHaveBeenCalledOnce(); expect(query.mock.calls[0][0]).toContain(':submit');
  });
});

describe('anonymous witnessed report transport and ordinary work', () => {
  it.each(retained.observations)('preserves every native row for report week $requestedWeek under one anonymous POST', async observation => {
    const request = vi.fn<typeof fetch>(async () => Response.json(observation.report.document)); vi.stubGlobal('fetch', request);
    const acquisition = { ...witness(), work: { ...work, nativeWeek: observation.requestedWeek } };
    const capture = await capturePublicSleeperWeeklyReport(native, observation.requestedWeek, new AbortController().signal, acquisition);
    expect(capture.payload).toEqual(observation.report.document);
    expect(() => assertOriginalPublicCapture(capture, acquisition)).not.toThrow();
    expect(capture.sourceObservedAt).toBe(capture.requestCompletedAt);
    expect(request).toHaveBeenCalledExactlyOnceWith('https://sleeper.com/graphql', expect.objectContaining({ method: 'POST', credentials: 'omit',
      redirect: 'error', cache: 'no-store', headers: { Accept: 'application/json', 'Content-Type': 'application/json', 'X-Sleeper-GraphQL-Op': 'metadata' } }));
    const options = request.mock.calls[0][1]!;
    expect(JSON.parse(String(options.body))).toEqual({ operationName: 'metadata', variables: {},
      query: `query metadata { metadata(type: "league_report", key: "${native}_${observation.requestedWeek}") { key type data last_updated created } }` });
  });
  it('reserves before witnessing and makes one request before receipt-bound completion', async () => {
    const f = fixture(); expect(await f.run()).toEqual({ status: 'progress', resource: 'weekly-report', providerRequests: 1 });
    expect(f.events).toEqual(['reserve', 'witness', 'post', 'write']);
    expect(f.administration.recordObservation.mock.calls[0][12]?.attempt.id)
      .toBe(f.administration.recordObservation.mock.calls[0][0].envelope.provenance.acquisition?.attempts.weekly_report.id);
    expect(f.intake.completeWeeklyReport).toHaveBeenCalledWith(work, mapping,
      { observations: { weekly_report: f.observationId }, receipts: { weekly_report: f.receiptId } }, expect.objectContaining({ generation: 1 }));
  });
  it.each(['captureWitness', 'completeWeeklyReport'] as const)('makes zero requests without %s', async capability => {
    const f = fixture(); const result = await runPublicIntakeStep(requestId,
      { ...f.dependencies, intake: { ...f.intake, [capability]: undefined } }, new AbortController().signal);
    expect(result).toMatchObject({ status: 'unavailable', providerRequests: 0 }); expect(f.fetch).not.toHaveBeenCalled();
  });
  it.each([{ errors: [{ message: 'partial failure' }], data: retained.observations[0].report.document.data },
    { errors: null, data: retained.observations[0].report.document.data }, { data: {} }, { data: null },
    { data: { metadata: { ...retained.observations[0].report.document.data.metadata, key: native + '_2' } } }])(
    'cannot checkpoint invalid, partial or foreign report data', async body => {
      const f = fixture(); f.fetch.mockResolvedValue(Response.json(body));
      expect(await f.run()).toMatchObject({ status: 'unavailable', providerRequests: 1 });
      expect(f.intake.completeWeeklyReport).not.toHaveBeenCalled(); expect(f.intake.fail).toHaveBeenCalledOnce();
    });
  it('retains explicit unpublished metadata as report absence without a retry', async () => {
    const f = fixture(); f.fetch.mockResolvedValue(Response.json({ data: { metadata: null } }));
    expect(await f.run()).toMatchObject({ status: 'progress', providerRequests: 1 });
    expect(f.administration.recordObservation.mock.calls[0][0].envelope.payload).toEqual({ data: { metadata: null } });
  });
  it('does not complete from a preserved earlier report head', async () => {
    const f = fixture(); f.administration.recordObservation.mockResolvedValue({ status: 'unchanged', observationId: randomUUID() });
    expect(await f.run()).toMatchObject({ status: 'unavailable', providerRequests: 1 });
    expect(f.intake.completeWeeklyReport).not.toHaveBeenCalled();
  });
  it('rejects retagged or copied transport captures', async () => {
    const f = fixture(), unused = async () => { throw new Error('Unexpected other source'); };
    const result = await runPublicIntakeStep(requestId, { ...f.dependencies, source: { identity: unused, leagues: unused, core: unused,
      weeklyReport: async (...args) => ({ ...await capturePublicSleeperWeeklyReport(...args) }) } }, new AbortController().signal);
    expect(result).toMatchObject({ status: 'unavailable', providerRequests: 1 }); expect(f.intake.completeWeeklyReport).not.toHaveBeenCalled();
  });
  it('rejects foreign-week or extra-role witnesses before provider work', async () => {
    const request = vi.fn(); vi.stubGlobal('fetch', request);
    await expect(capturePublicSleeperWeeklyReport(native, 2, new AbortController().signal, witness())).rejects.toThrow();
    expect(() => parsePublicCaptureWitness({ ...witness(), attempts: { ...witness().attempts, settings: { id: randomUUID(), nonce: randomUUID() } } })).toThrow();
    expect(request).not.toHaveBeenCalled();
  });
  it('cancels HTTP failures and makes no retry', async () => {
    const request = vi.fn<typeof fetch>(async () => new Response('busy', { status: 503 })); vi.stubGlobal('fetch', request);
    await expect(capturePublicSleeperWeeklyReport(native, 1, new AbortController().signal, witness())).rejects.toThrow('503');
    expect(request).toHaveBeenCalledOnce();
  });
});

function readerFixture() {
  const acquisition = witness(), receiptId = randomUUID();
  const normalized = normalizeWeeklyReportEnvelope({ schemaVersion: 'league-administration-v1', normalizerVersion: 'sleeper-administration-v1',
    dialect: 'sleeper-nfl-v1', scope: mapping.scope, family: 'weekly_report', week: 1, completeness: 'complete',
    payload: retained.observations[0].report.document, provenance: { origin: 'network', requestStartedAt: '2026-10-12T20:00:00.000Z',
      requestCompletedAt: '2026-10-12T20:00:00.010Z', sourceObservedAt: '2026-10-12T20:00:00.010Z', checkedAt: '2026-10-12T20:00:00.010Z', acquisition } });
  if (normalized.status !== 'accepted') throw new Error('Retained report rejected');
  const resource: AcceptedWeeklyReportRead = { status: 'available', version: WEEKLY_REPORT_VERSION, selection: 'receipt', contentId: randomUUID(),
    reportReceiptId: receiptId, acceptanceId: randomUUID(), acceptedGeneration: 1, sourceMappingRevisionId: mapping.revisionId,
    provenance: { origin: 'network', requestStartedAt: '2026-10-12T20:00:00.000Z', requestCompletedAt: '2026-10-12T20:00:00.010Z',
      sourceObservedAt: '2026-10-12T20:00:00.010Z', checkedAt: '2026-10-12T20:00:00.010Z', acquisition },
    freshness: 'unknown', historicalApplicability: 'report-only', value: { ...normalized.value,
      teams: normalized.value.teams.map(team => ({ ...team, seasonTeamId: randomUUID() })) } };
  const rows = [{ ordinal: 1, season: 2026, external_league_id: native, native_week: 1, status: 'complete', failure_count: 0, reason: null,
    worker_id: acquisition.fence.workerId, generation: acquisition.fence.generation, league_season_id: mapping.leagueSeasonId,
    source_mapping: mapping, report_receipt_id: receiptId, recorded_at: '2026-10-12T20:00:00.010Z' }];
  const client = { enabled: true, query: vi.fn(async () => rows) } as unknown as DatabaseClient;
  const administration = { ...createLeagueAdministrationStore({ enabled: false, reason: 'missing-database-url' }),
    readSourceMapping: vi.fn(async () => mapping), readAcceptedWeeklyReport: vi.fn(async () => resource) };
  const candidates = [{ season: 2026, external_league_id: native, stage: 'complete' }];
  return { rows, acquisition, resource, administration, run: () => readPublicWeeklyReports(client, administration, requestId, candidates, [{ season: 2026, nativeWeek: 1 }]) };
}
describe('stored report checkpoint reads', () => {
  it('requests the exact receipt and preserves native report values and original source clock', async () => {
    const f = readerFixture(); const result = await f.run();
    expect(result[0].resource).toEqual(f.resource);
    expect(f.administration.readAcceptedWeeklyReport).toHaveBeenCalledWith(mapping, { nativeWeek: 1, reportReceiptId: f.rows[0].report_receipt_id });
    expect(result[0].resource.status).toBe('available');
  });
  it('does not borrow a receipt from a different acquisition', async () => {
    const f = readerFixture(); Object.assign(f.acquisition, { work: { ...work, requestId: randomUUID() } });
    expect((await f.run())[0].resource.status).toBe('unavailable');
  });
  it('does not call accepted readers for pending tasks', async () => {
    const f = readerFixture(); f.rows[0].status = 'pending';
    expect((await f.run())[0].resource).toEqual({ status: 'unavailable', reason: 'report-capture-not-complete' });
    expect(f.administration.readAcceptedWeeklyReport).not.toHaveBeenCalled();
  });
  it('does not add report payloads or queries when selection was omitted', async () => {
    const query = vi.fn(async (statement: string) => statement.includes('read-request')
      ? [{ id: requestId, seasons: [2026], terminal: false, selected_exact_periods: null, selected_period_inventory: null, selected_playoff_brackets: null }] : []);
    const result = await readPublicSleeperIntake({ enabled: true, query } as unknown as DatabaseClient,
      createLeagueAdministrationStore({ enabled: false, reason: 'missing-database-url' }), requestId);
    expect(result).not.toHaveProperty('weeklyReports');
    if (result.status === 'missing') throw new Error('Expected retained request');
    expect(result.request).not.toHaveProperty('weeklyReports');
    expect(query.mock.calls.some(call => call[0].includes('read-weekly-reports'))).toBe(false);
  });
});
