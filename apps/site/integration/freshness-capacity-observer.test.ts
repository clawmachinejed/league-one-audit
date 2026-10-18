import { composeOfficialResults, type OfficialResultsInput } from '../lib/aggregator/official-results';
import { createHash } from 'node:crypto';
import { inflateRawSync } from 'node:zlib';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DatabaseClient } from '../lib/database';
import type { AdministrationProvenance, AdministrationSourceMapping } from '../lib/league-administration/contracts';
import { parsePublicCaptureWitness } from '../lib/league-administration/public-capture-witness';
import { normalizeAdministrationObservation } from '../lib/league-administration/normalize';
import { projectDraftMetadata } from '../lib/aggregator/draft-metadata';
import { projectDraftSelections } from '../lib/aggregator/draft-selections';
import { projectTradedPicks } from '../lib/aggregator/traded-picks';
import { createCapacityFleetFixture } from './freshness-capacity-fixtures';
import { bindCapacityManifest, capacityDigest, freezeCapacityValue, type CapacityManifest, type CapacitySource, type JsonValue } from './freshness-capacity-manifest';
import type { HttpAttempt } from './freshness-capacity-evidence';
import { RECOVERY_INITIAL_SCOPE } from './freshness-capacity-recovery';
import type { CapacitySourceResponse } from './freshness-capacity-transport';
import { CAPACITY_DAILY_CATALOG_CLAIM_SQL, CAPACITY_DAILY_CATALOG_RESERVE_SQL, createCapacityDailyCatalogFetch, CAPACITY_ANCILLARY_HEADS_SQL, CAPACITY_ANCILLARY_FIRST_RECEIPT_SQL, CAPACITY_ANCILLARY_BODY_BYTES, encodeCapacityAncillaryBody, encodeCapacityAncillaryBodies, CAPACITY_DISPATCH_JOURNAL_SQL, CAPACITY_RECEIPT_LINEAGE_SQL, composeCapacityAncillary, evaluateCapacityAncillaryChain, type CapacityAncillarySuccess, createCapacityObserver, capacityCurrentIntakeResource, capacityStoredReceiptNormalization, capacityWeeklyReportReaderValue, capacityDraftReaderScope, capacityIntakeReadOptions, assertCapacityInitialStoredRequest, assertCapacityAuxiliaryTeams, assertCapacityAuxiliaryScope, capacityAuxiliaryReadOptions } from './freshness-capacity-observer';

vi.mock('server-only', () => ({}));
const mocks = vi.hoisted(() => ({ store: { readSourceMapping: vi.fn(), readAcceptedCurrentRoster: vi.fn(),
  readRosterPlayerLinks: vi.fn(), readExactMatchupValues: vi.fn(), readAcceptedTransactions: vi.fn() }, intake: vi.fn() }));
vi.mock('../lib/league-administration/store', async importOriginal => ({ ...await importOriginal<typeof import('../lib/league-administration/store')>(), createLeagueAdministrationStore: () => mocks.store }));
vi.mock('../lib/league-administration/public-intake-reader', () => ({ readPublicSleeperIntake: mocks.intake }));
const fleet = createCapacityFleetFixture('observer-unit-only');
const source: CapacitySource = { readinessContractSha256: 'e'.repeat(64), acceptanceContractSha256: 'f'.repeat(64), plannedPostgresqlVersion: '18.6',
  gitSha: 'a'.repeat(40), appTreeSha: 'b'.repeat(40), fixtureSha256: fleet.digest, readerQueryMixSha256: 'd'.repeat(64),
  clockRefs: { wall: 'unit-wall-not-elapsed-proof', monotonic: 'unit-monotonic-not-elapsed-proof' }, cleanupPlanRef: 'unit-no-resources',
  requestOwners: ['ordinary-runner', 'independent-measurement'], unrelatedUsernames: ['cp26_fleet_intake_a', 'cp26_fleet_intake_b'],
  leagues: fleet.sourceLeagues, initialReaders: fleet.prototype.initialReaders, endpointInventory: fleet.endpointInventory,
  formatWitnesses: fleet.formatWitnesses };
const manifest = bindCapacityManifest(fleet.prototype.plan, source, fleet.prototype.events, { kind: 'healthy' });
const benchmark = 1_792_000_000_000;
type Resource = 'rosters' | 'matchups' | 'transactions';
const hashId = (value: string) => { const h = createHash('sha256').update(value).digest('hex'); return `${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20,32)}`; };
type TestCapture = { receiptId: string; resource: Resource; ordinal: number; provenance: AdministrationProvenance;
  row: Record<string, unknown>; value: JsonValue; lineup: JsonValue; score: JsonValue };
/** Authored unit doubles exercise observer rejection; they are never actual SQL or qualification evidence. */
function setup(key = 'league-01', selectedManifest: CapacityManifest = manifest) {
  vi.clearAllMocks();
  let now = benchmark - 1_000;
  const native = source.leagues.find(row => row.key === key)!;
  const mapping: AdministrationSourceMapping = { connectionId: hashId(key + '/connection'), leagueSeasonId: hashId(key + '/season'),
    revisionId: hashId(key + '/revision'), generation: 1,
    scope: { leagueKey: 'unit-' + key, provider: 'sleeper', externalLeagueId: native.nativeLeagueId, season: 2026 } };
  const captures = new Map<string, TestCapture>(), latest = new Map<Resource, TestCapture>();
  const attempts: HttpAttempt[] = [], responses: CapacitySourceResponse[] = [];
  const journal = { owner: 'ordinary-runner', coverageStartedAt: benchmark - 2_000, coverageEndedAt: now, attempts, responses, rejectedRequests: [] as unknown[] };
  const independent = { owner: 'independent-measurement', coverageStartedAt: benchmark - 2_000, coverageEndedAt: now,
    attempts: [] as HttpAttempt[], responses: [] as CapacitySourceResponse[], rejectedRequests: [] as unknown[] };
  const requests = new Map<string, Record<string, unknown>>();
  const dispatchRows: {dispatch: Record<string, unknown>; outcome: Record<string, unknown> | null}[] = [];
  const database: DatabaseClient = { enabled: true, query: vi.fn(async (sql: string, parameters?: readonly unknown[]) => {
    if (sql === CAPACITY_DISPATCH_JOURNAL_SQL) return structuredClone(dispatchRows.filter(row => Number(row.dispatch.generation) > Number(parameters?.[0])
      || (parameters?.[1] as number[]).includes(Number(row.dispatch.generation))));
    if (sql.includes('cp26:read-observer-intake')) return requests.has(String(parameters?.[0])) ? [structuredClone(requests.get(String(parameters?.[0]))!)] : [];
    expect(sql).toBe(CAPACITY_RECEIPT_LINEAGE_SQL);
    const capture = captures.get(String(parameters?.[0])); return capture ? [structuredClone(capture.row)] : [];
  }) as DatabaseClient['query'] };
  const readerValue = (family: 'rosters' | 'lineups' | 'official-scores' | 'transactions', ordinal: number) => ordinal === 0
    ? fleet.prototype.initialReaders.find(row => row.pairId === `${key}/${family}`)!.reader.value
    : fleet.prototype.events.find(row => row.id === `${key}/${family}/event-${ordinal}`)!.expectedReader.value;
  const select = (resource: Resource, id?: string) => id ? captures.get(id)! : latest.get(resource)!;
  mocks.store.readSourceMapping.mockResolvedValue(mapping);
  mocks.store.readAcceptedCurrentRoster.mockImplementation(async () => {
    const capture = select('rosters'); return { status: 'available', receipt: { id: capture.receiptId, provenance: capture.provenance } };
  });
  mocks.store.readRosterPlayerLinks.mockImplementation(async (selection: { rosterReceiptId: string }) => {
    const capture = select('rosters', selection.rosterReceiptId);
    return { status: 'available', rosterReceiptId: capture.receiptId, mapping, rosterSource: capture.provenance,
      teams: [{ externalRosterId: '1', categories: (capture.value as Record<string, JsonValue>).categories }] };
  });
  mocks.store.readExactMatchupValues.mockImplementation(async (_mapping: unknown, selection: { matchupsReceiptId?: string }) => {
    const capture = select('matchups', selection.matchupsReceiptId), lineup = capture.lineup as { starters: Record<string, unknown>[] },
      score = capture.score as { raw: Record<string, unknown>[]; custom: Record<string, unknown>[]; effective: Record<string, unknown>[] };
    return { status: 'available', selection: selection.matchupsReceiptId ? 'receipt' : 'current', matchupsReceiptId: capture.receiptId,
      sourceMappingRevisionId: mapping.revisionId, provenance: capture.provenance,
      value: { teams: lineup.starters.map((team, index) => ({ ...team, ...score.raw[index], ...score.custom[index], ...score.effective[index] })) } };
  });
  mocks.store.readAcceptedTransactions.mockImplementation(async (_mapping: unknown, _week: number, selection?: { receiptId: string }) => {
    const capture = select('transactions', selection?.receiptId);
    return { status: 'available', capture: { accepted: true, receipt: { id: capture.receiptId },
      envelope: { provenance: capture.provenance }, normalizedValue: (capture.value as Record<string, JsonValue>).normalized } };
  });
  const observer = createCapacityObserver(selectedManifest, { database, startedAt: benchmark,
    journals: () => { journal.coverageEndedAt = now; independent.coverageEndedAt = now; return [journal, independent]; },
    clock: { wallNow: () => now, monotonicNow: () => now - benchmark + 10_000 } });
  async function capture(ordinal: number, selected: Resource[] = ['rosters', 'matchups', 'transactions'], tail?: Promise<void>) {
    await observer.observeInvocation('ordinary-runner', async at => {
      for (const resource of selected) {
        const family = resource === 'matchups' ? 'lineups' : resource;
        const event = fleet.prototype.events.find(row => row.id === `${key}/${family}/event-${Math.max(ordinal, 1)}`)!;
        const payload = ordinal === 0 ? event.before : event.after;
        const receiptId = hashId(`${key}/${resource}/${ordinal}/receipt`), worker = hashId(`${key}/${resource}/${ordinal}/worker`);
        const roles = resource === 'rosters' ? ['settings', 'players', 'managers'] : resource === 'matchups' ? ['settings', 'matchups'] : ['transactions'];
        const reservations = Object.fromEntries(roles.map(role => [role, { id: hashId(receiptId + role), nonce: hashId(receiptId + role + '/nonce') }]));
        const role = resource === 'rosters' ? 'players' : resource, attempt = reservations[role];
        const fence = { jobKey: 'league-administration-public-intake', workerId: worker, generation: ordinal + 1, deadlineAt: new Date(at + 20_000).toISOString() };
        const work = { requestId: hashId(key + '/request'), revision: ordinal, kind: resource === 'rosters' ? 'core' : resource === 'matchups' ? 'exact-matchups' : 'transactions',
          externalLeagueId: native.nativeLeagueId, season: 2026, ...(resource === 'rosters' ? {} : { nativeWeek: Number(native.nativePeriod) }) };
        const acquisition = { version: 'public-network-capture-v1', work, fence, dispatchNonce: hashId(receiptId + '/dispatch'), mapping, attempts: reservations };
        const provenance = { origin: 'network', requestStartedAt: new Date(at + 5).toISOString(), requestCompletedAt: new Date(at + 20).toISOString(),
          sourceObservedAt: new Date(at + 20).toISOString(), checkedAt: new Date(at + 21).toISOString(), acquisition } as AdministrationProvenance;
        const contentId = hashId(receiptId + '/content'), scopeId = hashId(key + '/' + resource + '/scope');
        const row = { receipt: { id: receiptId, attempt_id: attempt.id, content_id: contentId, provenance },
          acceptance: { id: hashId(receiptId + '/acceptance'), receipt_id: receiptId, scope_id: scopeId,
            source_mapping_revision_id: mapping.revisionId, generation: ordinal + 1, accepted_at: new Date(at + 25).toISOString() },
          attempt: { id: attempt.id, scope_id: scopeId, source_mapping: mapping, write_fence: fence, capture_nonce: attempt.nonce },
          content: { id: contentId, league_season_id: mapping.leagueSeasonId, provider: 'sleeper', external_league_id: native.nativeLeagueId,
            family: resource, week: resource === 'rosters' ? 0 : Number(native.nativePeriod), accepted: true, payload: JSON.parse(payload.utf8) },
          dispatch: { worker_id: worker, generation: ordinal + 1, work, capture_nonce: acquisition.dispatchNonce },
          outcome: { outcome: 'checkpoint-committed' } };
        const item = { receiptId, resource, ordinal, provenance, row, value: readerValue(family, ordinal),
          lineup: readerValue('lineups', ordinal), score: readerValue('official-scores', ordinal) };
        captures.set(receiptId, item); latest.set(resource, item);
        const id = 'physical-' + (attempts.length + 1), pairIds = resource === 'matchups' ? [`${key}/lineups`, `${key}/official-scores`] : [`${key}/${resource}`];
        attempts.push(freezeCapacityValue({ id, owner: 'ordinary-runner', sequence: attempts.length + 1, method: 'GET', origin: 'https://api.sleeper.app',
          path: `/v1/league/${native.nativeLeagueId}/${resource}${resource === 'rosters' ? '' : '/' + native.nativePeriod}`,
          at: at + 10, endedAt: at + 15, purpose: 'refresh', outcome: 'success', responseSha256: payload.sha256 }));
        responses.push(freezeCapacityValue({ attemptId: id, endpointId: `${key}:${resource}${resource === 'rosters' ? '' : ':' + native.nativePeriod}`, nativeLeagueId: native.nativeLeagueId,
          nativeWeek: resource === 'rosters' ? null : Number(native.nativePeriod), resource, pairIds, version: payload.version,
          rawUtf8: payload.utf8, rawSha256: payload.sha256, requestStartedAt: at + 10, responseCompletedAt: at + 15,
          monotonicStartedAt: at - benchmark + 10_010, monotonicCompletedAt: at - benchmark + 10_015,
          responseBoundary: 'full-synthetic-bytes-available' }));
      }
      now = at + 50; if (tail) await tail;
      return { primary: 'unit-facade-result-retained', nested: { healthy: true } };
    });
  }
  async function discovery(request: Record<string, unknown>) {
    await observer.observeInvocation('ordinary-runner', async at => {
      const identityEndpoint = source.endpointInventory.find(row => row.resource === 'identity'
        && new URL(row.url).pathname === `/v1/user/${request.username}`)!;
      const listEndpoint = source.endpointInventory.find(row => row.resource === 'league-list'
        && row.scope.nativeManagerId === identityEndpoint.scope.nativeManagerId)!;
      const dispatches: unknown[] = [];
      for (const [index, endpoint] of [identityEndpoint, listEndpoint].entries()) {
        const id = `discovery-${index}`, payload = endpoint.versions[0];
        const work = index === 0 ? { requestId: request.id, revision: 0, kind: 'identity', username: request.username }
          : { requestId: request.id, revision: 1, kind: 'leagues', userId: identityEndpoint.scope.nativeManagerId, season: 2026 };
        const fence = { jobKey: 'league-administration-public-intake', workerId: hashId(id), generation: 1,
          deadlineAt: new Date(at + 20_000).toISOString() };
        const captureNonce = hashId(id + 'nonce');
        dispatches.push({ dispatch: { resource: work.kind, work, worker_id: fence.workerId, generation: 1, capture_nonce: captureNonce },
          outcome: { outcome: 'checkpoint-committed', capture_acquisition: { version: 'public-network-capture-v1',
            work, fence, dispatchNonce: captureNonce, mapping: null, attempts: {} } } });
        const stored = { payload: JSON.parse(payload.utf8), request_started_at: new Date(at + 5).toISOString(),
          request_completed_at: new Date(at + 20).toISOString(), ...(index ? { season: 2026 } : {}) };
        if (index === 0) request.identity = stored; else request.lists = [stored];
        attempts.push(freezeCapacityValue({ id, owner: 'ordinary-runner', sequence: attempts.length + 1, method: 'GET', origin: 'https://api.sleeper.app',
          path: new URL(endpoint.url).pathname, at: at + 10, endedAt: at + 15, purpose: 'intake', outcome: 'success', responseSha256: payload.sha256 }));
        responses.push(freezeCapacityValue({ attemptId: id, endpointId: endpoint.id, resource: endpoint.resource,
          nativeLeagueId: null, nativeWeek: null, pairIds: [], version: payload.version, rawUtf8: payload.utf8,
          rawSha256: payload.sha256, requestStartedAt: at + 10, responseCompletedAt: at + 15,
          monotonicStartedAt: at - benchmark + 10_010, monotonicCompletedAt: at - benchmark + 10_015,
          responseBoundary: 'full-synthetic-bytes-available' }));
      }
      request.discovery_dispatches = dispatches; now = at + 50;
    });
  }
  return { observer, capture, discovery, latest, captures, database, requests, dispatchRows, journal, independent, attempts, responses,
    setNow: (value: number) => { now = value; }, now: () => now, key, mapping };
}
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('actual stored observer bridge (authored unit doubles, never qualification)', () => {
  it('derives four logical initial reads from three physical receipts and preserves both source clocks', async () => {
    const test = setup(); await test.capture(0); await test.observer.firstAcceptance(test.key);
    const report = test.observer.snapshot();
    expect(report.evidence.firstAcceptances).toHaveLength(4); expect(report.evidence.requests.attempts).toHaveLength(3);
    expect(report.evidence.origins).toHaveLength(4); expect(report.lineage).toHaveLength(4);
    const paired = report.lineage.filter(row => row.pairId.includes('lineups') || row.pairId.includes('official-scores'));
    expect(paired[0].proofId).toBe(paired[1].proofId); expect(report.receiptProofs).toHaveLength(3);
    expect(report.receiptProofs[0].sourceResponseCompletedAt).toBe(benchmark - 985);
    expect(Date.parse(report.receiptProofs[0].receiptProvenance.sourceObservedAt!)).toBe(benchmark - 980);
    expect(report.lineage[0].firstReadMinusSqlAcceptedMs).toBe(25);
    expect(report.evidence.firstAcceptances.every(row => row.at === benchmark - 950)).toBe(true);
    expect(report.invocations[0].outcome).toEqual({ primary: 'unit-facade-result-retained', nested: { healthy: true } });
    expect(report.executionReady).toBe(false); expect(report.checkpoint26Qualified).toBe(false);
  });
  it('preserves an ordinary facade failure instead of replacing its result', async () => {
    const test = setup(), failure = new Error('ordinary facade failed');
    await expect(test.observer.observeInvocation('ordinary-runner', async () => { throw failure; })).rejects.toBe(failure);
    expect(test.observer.snapshot().invocations[0]).toMatchObject({ failed: true, outcome: null });
  });
  it('reads every fixed slot at most once and shares the exact matchup observation', async () => {
    const test = setup(); await test.capture(0); await test.observer.firstAcceptance(test.key);
    test.setNow(benchmark + 60_000); await test.capture(1); await test.observer.observeDueSamples();
    const before = vi.mocked(test.database.query).mock.calls.length;
    await test.observer.observeDueSamples();
    const report = test.observer.snapshot(); expect(report.evidence.samples).toHaveLength(4);
    expect(report.evidence.samples.every(row => row.status === 'available' && row.at === benchmark + 60_050)).toBe(true);
    expect(vi.mocked(test.database.query).mock.calls.length).toBe(before);
    expect(mocks.store.readExactMatchupValues).toHaveBeenCalledTimes(2);
  });
  it('leaves +1001ms dispatch late and never reschedules missing slots', async () => {
    const test = setup(); await test.capture(0); await test.observer.firstAcceptance(test.key);
    const calls = vi.mocked(test.database.query).mock.calls.length;
    test.setNow(benchmark + 61_001); await test.observer.observeDueSamples();
    expect(vi.mocked(test.database.query).mock.calls).toHaveLength(calls);
    expect(test.observer.snapshot().evidence.samples.every(row => row.status === 'unavailable' && row.read === null)).toBe(true);
    test.setNow(benchmark + 120_000); await test.capture(1); await test.observer.observeDueSamples();
    expect(test.observer.snapshot().evidence.samples.filter(row => row.status === 'unavailable')).toHaveLength(4);
  });
  it('retains a completed read after the slot deadline as timeout without a reader timestamp reset', async () => {
    const test = setup(); await test.capture(0); await test.observer.firstAcceptance(test.key);
    test.setNow(benchmark + 60_000);
    mocks.store.readSourceMapping.mockImplementation(async () => { await Promise.resolve(); test.setNow(benchmark + 120_001); return test.mapping; });
    await test.observer.observeDueSamples();
    expect(test.observer.snapshot().evidence.samples.every(row => row.status === 'timeout' && row.read === null)).toBe(true);
  });
  it('observes new typed values and rereads the immutable original receipt for history', async () => {
    const test = setup(); await test.capture(0); await test.observer.firstAcceptance(test.key);
    const initial = test.latest.get('matchups')!.receiptId;
    test.setNow(benchmark + 60_000); await test.capture(1); await test.observer.observeEvents(test.key);
    const report = test.observer.snapshot(); expect(report.evidence.events).toHaveLength(4);
    expect(report.evidence.events.every(row => row.retainedHistory.length === 1)).toBe(true);
    expect(mocks.store.readExactMatchupValues).toHaveBeenCalledWith(test.mapping, { nativeWeek: 7, matchupsReceiptId: initial });
    expect(report.lineage.some(row => row.selection === 'receipt' && row.proofId === initial)).toBe(true);
  });
  it.each(['mapping', 'worker', 'generation', 'nonce', 'content', 'future', 'provenance'] as const)('rejects changed durable %s evidence', async defect => {
    const test = setup(); await test.capture(0);
    const row = test.latest.get('rosters')!.row;
    if (defect === 'mapping') (row.acceptance as Record<string, unknown>).source_mapping_revision_id = hashId('wrong');
    if (defect === 'worker') (row.dispatch as Record<string, unknown>).worker_id = hashId('wrong');
    if (defect === 'generation') (row.dispatch as Record<string, unknown>).generation = 99;
    if (defect === 'nonce') (row.attempt as Record<string, unknown>).capture_nonce = hashId('wrong');
    if (defect === 'content') (row.content as Record<string, unknown>).payload = [];
    if (defect === 'future') (row.acceptance as Record<string, unknown>).accepted_at = new Date(benchmark + 1).toISOString();
    if (defect === 'provenance') (row.receipt as Record<string, unknown>).provenance = {};
    await test.observer.firstAcceptance(test.key);
    const report = test.observer.snapshot(); expect(report.evidence.firstAcceptances).toHaveLength(3);
    expect(report.failures.some(row => row.operation.endsWith('/rosters'))).toBe(true);
  });
  it('rejects a future unpublished payload even with a new successful HTTP origin', async () => {
    const test = setup(); await test.capture(1); await test.observer.firstAcceptance(test.key);
    expect(test.observer.snapshot().evidence.firstAcceptances).toHaveLength(0);
  });
  it('cannot credit a fresh cohort with prefetched or unrelated intake receipts', async () => {
    const test = setup('league-09'); await test.capture(0); await test.observer.firstAcceptance(test.key);
    expect(test.observer.snapshot().evidence.firstAcceptances).toHaveLength(0);
  });
  it('rejects a response assigned to the wrong frozen native endpoint', async () => {
    const test = setup(); await test.capture(0);
    test.responses[0] = freezeCapacityValue({ ...test.responses[0], endpointId: 'league-02:rosters' });
    await test.observer.firstAcceptance(test.key);
    expect(test.observer.snapshot().evidence.firstAcceptances).toHaveLength(3);
  });
  it('rejects ambiguous identical response observations within the same capture interval', async () => {
    const test = setup(); await test.capture(0);
    test.attempts.push(freezeCapacityValue({ ...test.attempts[0], id: 'duplicate-body', sequence: 4 }));
    test.responses.push(freezeCapacityValue({ ...test.responses[0], attemptId: 'duplicate-body' }));
    await test.observer.firstAcceptance(test.key);
    expect(test.observer.snapshot().evidence.firstAcceptances).toHaveLength(3);
  });
  it('requires immutable entries and detects replacement or removal of an observed prefix', async () => {
    const test = setup(); await test.capture(0); test.observer.snapshot();
    test.responses[0] = freezeCapacityValue({ ...test.responses[0] });
    expect(() => test.observer.snapshot()).toThrow('response history replaced');
    test.responses.splice(0); expect(() => test.observer.snapshot()).toThrow('transport history removed');
  });
  it('rejects mutable transport entries and all undeclared transport requests', async () => {
    const test = setup(); await test.capture(0); test.responses[0] = { ...test.responses[0] };
    expect(() => test.observer.snapshot()).toThrow('deeply immutable');
    test.responses[0] = freezeCapacityValue(test.responses[0]); test.journal.rejectedRequests.push({ method: 'DELETE' });
    expect(() => test.observer.snapshot()).toThrow('undeclared transport request');
  });
  it('preserves failed, retry, redirect, independent GET and POST attempts in owner totals', async () => {
    const test = setup(); await test.capture(0);
    for (const purpose of ['retry', 'redirect'] as const) test.attempts.push(freezeCapacityValue({ ...test.attempts[0],
      id: purpose, sequence: test.attempts.length + 1, purpose, outcome: 'failed', responseSha256: null }));
    test.attempts.push(freezeCapacityValue({ ...test.attempts[0], id: 'post', sequence: 6, method: 'POST', origin: 'https://sleeper.com', path: '/graphql', report: { family: 'weekly_report', externalLeagueId: source.leagues[0].nativeLeagueId, nativeWeek: 1, bodySha256: 'e'.repeat(64) } }));
    test.independent.attempts.push(freezeCapacityValue({ ...test.attempts[0], id: 'independent', owner: 'independent-measurement', sequence: 1, purpose: 'independent-measurement' }));
    const result = test.observer.snapshot().evidence.requests;
    expect(result.attempts).toHaveLength(7); expect(result.ownerTotals).toEqual([{ owner: 'ordinary-runner', attempts: 6 }, { owner: 'independent-measurement', attempts: 1 }]);
  });
});

function requestRow(key: string, at: number, full = true) {
  const periods = Array.from({ length: 18 }, (_, index) => ({ season: 2026, nativeWeek: index + 1 }));
  return { id: hashId(key + '/request'), username: 'cp26_fleet_intake_a', created_at: new Date(at).toISOString(),
    resource_occurrence_id: null, submission_capacity: null, terminal: false, seasons: [2026],
    stored_request: { seasons: [2026], period_inventory: full ? 'sleeper-2026-native-period-inventory-v1' : null,
      transaction_history: 'sleeper-2026-transaction-history-v1', transaction_period: null,
      playoff_brackets: 'sleeper-2026-playoff-brackets-v1', draft_picks: 'sleeper-2026-draft-picks-v1',
      exact_periods: full ? periods : [periods[6]], weekly_reports: periods } };
}
function outageManifest() {
  return bindCapacityManifest(fleet.prototype.plan, source, fleet.prototype.events, { kind: 'outage', startOffsetMs: 1_800_000,
    durationMs: 1_800_000, dependency: 'provider', backlog: [{ id: 'queued-first', pairId: 'league-01/rosters',
      reader: fleet.prototype.events.find(row => row.id === 'league-01/rosters/event-10')!.expectedReader }],
    lastGood: source.initialReaders.map(row => ({ pairId: row.pairId, reader: row.reader,
      payloadSha256: fleet.prototype.events.find(event => event.id === row.pairId + '/event-1')!.before.sha256 })) });
}
describe('full imports and outage polling retain real observations', () => {
  it('anchors a fresh pair to its first stored read only after its actual complete-scope submission', async () => {
    const test = setup('league-09'); test.setNow(benchmark + 60_001);
    const request = requestRow(test.key, test.now()); test.requests.set(request.id, request);
    await test.observer.observeSubmission('intake-a', request.id, async () => ({ requestId: request.id, status: 'retained' }));
    await test.capture(0); await test.observer.firstAcceptance(test.key);
    const report = test.observer.snapshot(); expect(report.evidence.firstAcceptances).toHaveLength(4);
    expect(report.evidence.intakes[0].submittedAt).toBe(benchmark + 60_001);
    expect([...test.observer.anchors().values()]).toEqual(Array(4).fill(benchmark + 60_051));
  });
  it('refuses a current-week-only submission as complete fleet intake even when a generic reader says available', async () => {
    const test = setup('league-09'); test.setNow(benchmark + 60_000);
    const request = requestRow(test.key, test.now(), false); test.requests.set(request.id, request);
    mocks.intake.mockResolvedValue({ status: 'available', leagues: source.leagues.filter(row => row.key >= 'league-09' && row.key <= 'league-12')
      .map(row => ({ externalLeagueId: row.nativeLeagueId })) });
    await test.observer.observeSubmission('intake-a', request.id, async () => ({ requestId: request.id, status: 'retained' }));
    await test.capture(0); await test.observer.firstAcceptance(test.key); await test.observer.observeIntake('intake-a');
    const report = test.observer.snapshot(); expect(report.evidence.firstAcceptances).toHaveLength(0);
    expect(report.evidence.intakes[0]).toMatchObject({ receiptAt: null, acceptedAt: null, completeAt: null, coverage: 'incomplete' });
    expect(mocks.intake).not.toHaveBeenCalled();
  });
  it('does not replace the submitted cohort identity or a failed submission', async () => {
    const test = setup('league-09'); const id = hashId(test.key + '/request');
    await test.observer.observeSubmission('intake-a', id, async () => { throw new Error('receipt failure'); });
    await expect(test.observer.observeSubmission('intake-a', id, async () => ({ requestId: id, status: 'retained' }))).rejects.toThrow('cannot be retried');
  });
  it('retains stale recovery polls and seals only a fresh post-restoration origin', async () => {
    const test = setup('league-01', outageManifest()); await test.capture(0); await test.observer.firstAcceptance(test.key);
    await test.observer.observeOutage('before'); test.setNow(benchmark + 1_800_000); test.observer.observeOutageStart();
    await test.observer.observeOutage('during'); test.setNow(benchmark + 3_600_000);
    test.observer.observeRestoration('dependency'); test.observer.observeRestoration('runner');
    await test.observer.observeOutage('recovered'); expect(test.observer.snapshot().evidence.outage!.recovered).toHaveLength(0);
    await test.capture(10); await test.observer.observeOutage('recovered');
    const report = test.observer.snapshot(); expect(report.evidence.outage!.recovered).toHaveLength(4);
    expect(report.operations.filter(row => row.operation === 'outage/recovered/league-01/rosters')).toHaveLength(2);
    expect(report.evidence.outage!.lastGood).toHaveLength(4);
  });
  it('allows a pending backlog poll to complete later while freezing its queue identity and original time', async () => {
    const test = setup('league-01', outageManifest()); await test.capture(0); await test.observer.firstAcceptance(test.key);
    test.setNow(benchmark + 1_800_000); test.observer.observeOutageStart();
    const request = requestRow(test.key, test.now()); test.requests.set(request.id, request);
    await test.observer.observeBacklog('queued-first', request.id);
    test.setNow(benchmark + 3_600_000); test.observer.observeRestoration('dependency'); test.observer.observeRestoration('runner');
    expect(test.observer.snapshot().evidence.outage!.backlog[0]).toMatchObject({ queuedAt: benchmark + 1_800_000, read: null });
    request.terminal = true; await test.capture(10);
    mocks.intake.mockResolvedValue({ status: 'available', leagues: [{ externalLeagueId: source.leagues[0].nativeLeagueId }] });
    await test.observer.observeBacklog('queued-first', request.id);
    const result = test.observer.snapshot(); expect(result.evidence.outage!.backlog[0].read?.version).toBe('simulation:league-01:rosters:v10');
    expect(result.operations.filter(row => row.operation === 'backlog/queued-first')).toHaveLength(2);
    await expect(test.observer.observeBacklog('queued-first', hashId('wrong'))).rejects.toThrow('request changed');
  });
});

describe('bounded journal cost', () => {
  it('indexes a large immutable ledger once and emits compact read references', async () => {
    const test = setup(); await test.capture(0); await test.observer.firstAcceptance(test.key);
    const total = 12_000;
    for (let i = test.attempts.length; i < total; i++) {
      const at = benchmark + 100 + i * 5, id = `retained-${i}`;
      test.attempts.push(freezeCapacityValue({ ...test.attempts[0], id, sequence: i + 1, at, endedAt: at + 1 }));
      test.responses.push(freezeCapacityValue({ ...test.responses[0], attemptId: id, requestStartedAt: at, responseCompletedAt: at + 1,
        monotonicStartedAt: at - benchmark, monotonicCompletedAt: at - benchmark + 1 }));
    }
    test.setNow(benchmark + 120_000); test.observer.snapshot();
    const start = performance.now();
    // Forty-eight physical read groups: the fleet's sixteen leagues times its three independent endpoints.
    for (let i = 0; i < 16; i++) await test.observer.observeEvents(test.key);
    const elapsedMs = performance.now() - start, report = test.observer.snapshot();
    const compactBytes = Buffer.byteLength(JSON.stringify({ receiptProofs: report.receiptProofs,
      dispatchOutcomes: report.dispatchOutcomes, lineage: report.lineage }));
    expect(report.evidence.requests.attempts).toHaveLength(total); expect(report.receiptProofs).toHaveLength(3);
    expect(report.lineage).toHaveLength(68);
    expect(report.lineage.every(row => !('receiptProvenance' in row) && !('dispatch' in row))).toBe(true);
    process.stdout.write(JSON.stringify({ diagnostic: 'authored near-end ledger; not elapsed qualification', attempts: total,
      physicalReads: 48, elapsedMs, compactBytes, jsonBytes: Buffer.byteLength(JSON.stringify(report)) }) + String.fromCharCode(10));
  });
});

function draftRows(natives: string[]) {
  return source.endpointInventory.filter(row => natives.includes(row.scope.nativeLeagueId ?? '')
    && ['draft-catalog', 'draft-detail', 'draft-selections', 'draft-trades', 'league-trades'].includes(row.resource)).map((endpoint, index) => {
    const nativeId = endpoint.scope.nativeLeagueId!, draftId = endpoint.scope.nativeDraftId;
    const catalog = JSON.parse(source.endpointInventory.find(row => row.resource === 'draft-catalog' && row.scope.nativeLeagueId === nativeId)!.versions[0].utf8);
    const draft = catalog.find((row: {draft_id: string}) => row.draft_id === draftId), body = JSON.parse(endpoint.versions[0].utf8);
    const kind = ({'draft-catalog':'catalog','draft-detail':'detail','draft-selections':'selections','draft-trades':'draft','league-trades':'league'} as Record<string,string>)[endpoint.resource];
    const payload = kind === 'catalog' ? {metadataVersion:'sleeper-draft-metadata-v1',kind,catalog,details:[],reason:null}
      : kind === 'detail' ? {metadataVersion:'sleeper-draft-metadata-v1',kind,externalDraftId:draftId,catalog:draft,draft:body}
        : kind === 'selections' ? {selectionsVersion:'sleeper-draft-selections-v1',kind,externalDraftId:draftId,catalog:draft,picks:body}
          : kind === 'league' ? {tradedPicksVersion:'sleeper-traded-picks-v1',kind,tradedPicks:body}
            : {tradedPicksVersion:'sleeper-traded-picks-v1',kind,externalDraftId:draftId,catalog:draft,tradedPicks:body};
    const at = new Date(benchmark).toISOString(), provenance = {origin:'network' as const,requestStartedAt:at,requestCompletedAt:at,sourceObservedAt:at,checkedAt:at};
    const normalized = normalizeAdministrationObservation({schemaVersion:'league-administration-v1',normalizerVersion:'sleeper-administration-v1',dialect:'sleeper-nfl-v1',
      scope:{provider:'sleeper',leagueKey:'unit',externalLeagueId:nativeId,season:2026},family:'drafts',week:null,completeness:'complete',payload: JSON.parse(JSON.stringify(payload)) as JsonValue,provenance});
    const projected = kind === 'catalog' || kind === 'detail' ? projectDraftMetadata(normalized) : kind === 'selections' ? projectDraftSelections(normalized) : projectTradedPicks(normalized);
    expect(projected.status).toBe('accepted');
    return { externalLeagueId:nativeId,externalDraftId:draftId,ordinal:index+1,collection:'complete',resource:{status:'available',selection:'receipt',
      receiptId:hashId(endpoint.id),version:projected.version,value:structuredClone(projected.value),provenance}};
  });
}
function completePage(options: { periodInventoryPage: { afterOrdinal: number }; transactionHistoryPage: { afterOrdinal: number }; draftPicksPage: { afterOrdinal: number } }) {
  const natives = source.leagues.filter(row => row.key >= 'league-09' && row.key <= 'league-12').map(row => row.nativeLeagueId);
  const periods = natives.flatMap(externalLeagueId => Array.from({ length: 18 }, (_, index) => ({ externalLeagueId, nativeWeek: index + 1 })));
  const transactions = natives.flatMap(externalLeagueId => Array.from({ length: 19 }, (_, nativeWeek) => ({ externalLeagueId, nativeWeek })));
  const available = { status: 'available' }, detail = (row: object, ordinal: number) => ({ ...row, ordinal,
    collection: 'complete', resource: available, exactMatchupValues: available, periodContext: available });
  const periodOffset = options.periodInventoryPage.afterOrdinal, transactionOffset = options.transactionHistoryPage.afterOrdinal;
  const inventory = (offset: number, total: number) => ({ collection: 'complete', summary: { materializedResources: total },
    page: { nextAfterOrdinal: offset + 20 >= total ? null : offset + 20 } });
  return { status: 'partial', leagues: natives.map(externalLeagueId => ({ externalLeagueId, resources: { settings: available,
    heldRoster: { ...available, playerLinks: available }, teamManagers: available, directory: available, managerDirectory: available } })),
    weeklyReports: periods.map(row => ({ ...row, resource: available })), brackets: natives.map(externalLeagueId => ({ externalLeagueId, resource: available })),
    exactPeriods: periods.slice(periodOffset, periodOffset + 20).map((row, i) => detail(row, periodOffset + i + 1)),
    transactions: transactions.slice(transactionOffset, transactionOffset + 20).map((row, i) => detail(row, transactionOffset + i + 1)),
    drafts: draftRows(natives),
    periodInventory: inventory(periodOffset, 72), transactionHistory: inventory(transactionOffset, 76), draftPicks: inventory(0, 20) };
}
describe('complete ordinary intake coverage', () => {
  it('rejects available page labels and inventory counts without original immutable receipt proofs', async () => {
    const test = setup('league-09'); test.setNow(benchmark + 60_001);
    const request = requestRow(test.key, test.now()); test.requests.set(request.id, request);
    await test.observer.observeSubmission('intake-a', request.id, async () => ({ status: 'retained', requestId: request.id }));
    await test.discovery(request);
    request.terminal = true; Object.assign(request.stored_request, { revision: 1 });
    const query = vi.mocked(test.database.query).getMockImplementation()!;
    vi.mocked(test.database.query).mockImplementation(async (sql, parameters, options) =>
      sql.includes('cp26:read-observer-intake-receipts') ? [] : query(sql, parameters, options));
    mocks.intake.mockImplementation(async (_database, _store, _id, options) => completePage(options));
    await test.observer.observeIntake('intake-a');
    const result = test.observer.snapshot(); expect(result.evidence.intakes[0]).toMatchObject({ coverage: 'incomplete', completeAt: null });
    expect(result.failures.at(-1)).toMatchObject({ operation: 'intake/intake-a', reason: 'unavailable' });
    expect(mocks.intake).not.toHaveBeenCalled();
  });
  it('rejects the wrong original discovery before any aggregate page can supply coverage', async () => {
    const test = setup('league-09'); test.setNow(benchmark + 60_001);
    const request = requestRow(test.key, test.now()); test.requests.set(request.id, request);
    await test.observer.observeSubmission('intake-a', request.id, async () => ({ status: 'retained', requestId: request.id }));
    await test.discovery(request);
    (request as Record<string, unknown>).lists = [{ season: 2026, payload: [] }];
    await test.observer.observeIntake('intake-a');
    expect(test.observer.snapshot().evidence.intakes[0].completeAt).toBeNull();
    expect(mocks.intake).not.toHaveBeenCalled();
  });
});

describe('concurrent facade and observation clocks', () => {
  it('reads a real committed receipt before its enclosing facade finishes and retains the open span', async () => {
    const test = setup(); let release!: () => void;
    const tail = new Promise<void>(resolve => { release = resolve; });
    const running = test.capture(0, ['rosters', 'matchups', 'transactions'], tail);
    await test.observer.firstAcceptance(test.key);
    const active = test.observer.snapshot(); expect(active.evidence.firstAcceptances).toHaveLength(4);
    expect(active.openInvocations).toBe(1); expect(active.invocations[0]).toMatchObject({ span: { endedAt: null }, failed: null });
    release(); await running;
    expect(test.observer.snapshot()).toMatchObject({ openInvocations: 0, invocations: [{ failed: false }] });
  });
  it('does no event SQL before publication or after all currently published versions are sealed', async () => {
    const test = setup(); await test.capture(0); await test.observer.firstAcceptance(test.key);
    const initial = vi.mocked(test.database.query).mock.calls.length;
    await test.observer.observeEvents(test.key); expect(vi.mocked(test.database.query).mock.calls).toHaveLength(initial);
    test.setNow(benchmark + 60_000); await test.capture(1); await test.observer.observeEvents(test.key);
    const complete = vi.mocked(test.database.query).mock.calls.length;
    await test.observer.observeEvents(test.key); expect(vi.mocked(test.database.query).mock.calls).toHaveLength(complete);
  });
});

describe('durable DATA outcome journal', () => {
  it('retains failed and pending dispatches independent of primary facade success and seals only actual later outcomes', async () => {
    const test = setup(), worker = hashId('dispatch-owner');
    test.dispatchRows.push({ dispatch: {worker_id: worker, generation: 1, resource: 'identity'}, outcome: {outcome: 'failed'} },
      { dispatch: {worker_id: worker, generation: 2, resource: 'leagues'}, outcome: null });
    await test.observer.observeDispatches(); expect(test.observer.snapshot().durableDispatches).toEqual(test.dispatchRows);
    test.dispatchRows[1].outcome = {outcome:'checkpoint-committed'};
    await test.observer.observeDispatches();
    const result = test.observer.snapshot(); expect(result.durableDispatches).toEqual(test.dispatchRows);
    expect(result.dispatchObservations[0].entries[1].outcomeId).toBeNull();
    expect(result.dispatchObservations[1].entries[0].outcomeId).toMatch(/^[a-f0-9]{64}$/u);
    expect(result.dispatchJournalReadAt).toBe(test.now());
    expect(vi.mocked(test.database.query).mock.calls[1][1]).toEqual([2, [2]]);
  });
  it('refuses replacement of a pending immutable dispatch and keeps the original row', async () => {
    const test = setup(), original = { worker_id: hashId('dispatch-owner'), generation: 1, resource: 'identity' };
    test.dispatchRows.push({dispatch: original, outcome: null}); await test.observer.observeDispatches();
    test.dispatchRows[0].dispatch = {...original, resource:'core'}; await test.observer.observeDispatches();
    const result = test.observer.snapshot(); expect(result.durableDispatches[0].dispatch).toEqual(original);
    expect(result.failures.at(-1)).toMatchObject({operation:'dispatch-journal',reason:'unavailable'});
  });
});


describe('failed-run retention', () => {
  it('retains unvalidated raw attempts after a rejected request without granting validation credit', async () => {
    const test = setup(); await test.capture(0); await test.observer.firstAcceptance(test.key);
    test.journal.rejectedRequests.push({ method: 'GET', reason: 'undeclared' });
    expect(() => test.observer.snapshot()).toThrow('undeclared transport request');
    const diagnostic = test.observer.diagnosticSnapshot();
    expect(diagnostic.journalValidation).toBe('not-validated-diagnostic-only');
    expect(diagnostic.evidence.requests.attempts).toHaveLength(3);
    expect(diagnostic.receiptProofs).toHaveLength(3);
    expect(diagnostic.checkpoint26Qualified).toBe(false);
  });
});


describe('supersession preserves current-read meaning without claiming intake completion', () => {
  it('retains the exact current object and leaves the aggregate partial wrapper unchanged', () => {
    const current = { status: 'available', receipt: { id: hashId('later') } };
    const original = { status: 'unavailable', reason: 'intake-capture-not-current-head', retained: current };
    expect(capacityCurrentIntakeResource(original)).toBe(current);
    expect(original.status).toBe('unavailable');
  });
  it.each(['stored-source-unavailable','period-capture-not-complete','read-failed'])('does not waive %s because it has a retained value', reason => {
    expect(() => capacityCurrentIntakeResource({status:'unavailable',reason,retained:{status:'available'}})).toThrow();
  });
  it('rejects an unavailable latest reader behind a supersession label', () => {
    expect(() => capacityCurrentIntakeResource({status:'unavailable',reason:'intake-capture-not-current-head',retained:{status:'unavailable'}})).toThrow();
  });
});


describe('closed initial inventory and native draft acceptance', () => {
  const initial = () => {
    const row = requestRow('league-09', benchmark);
    Object.assign(row.stored_request, { period_inventory: null, transaction_history: null, draft_picks: null,
      exact_periods: [{ season: 2026, nativeWeek: 7 }], transaction_period: { season: 2026, nativeWeek: 7 }, weekly_reports: [] });
    return row;
  };
  it('accepts only the frozen selected initial scope, distinct from full history', () => {
    expect(() => assertCapacityInitialStoredRequest(initial(), RECOVERY_INITIAL_SCOPE)).not.toThrow();
    expect(() => assertCapacityInitialStoredRequest(requestRow('league-09', benchmark), RECOVERY_INITIAL_SCOPE)).toThrow();
    const changed = initial(); changed.stored_request.exact_periods[0].nativeWeek = 8;
    expect(() => assertCapacityInitialStoredRequest(changed, RECOVERY_INITIAL_SCOPE)).toThrow();
  });
  it('uses actual selected-scope reader guards without requesting absent history pages', async () => {
    const { readPublicSleeperIntake } = await vi.importActual<typeof import('../lib/league-administration/public-intake-reader')>('../lib/league-administration/public-intake-reader');
    const stored = { id: hashId('initial-page-guard'), seasons: [2026], terminal: true,
      selected_exact_periods: RECOVERY_INITIAL_SCOPE.exactPeriods, selected_transaction_period: RECOVERY_INITIAL_SCOPE.transactionPeriod,
      selected_playoff_brackets: RECOVERY_INITIAL_SCOPE.playoffBrackets, selected_period_inventory: null,
      selected_transaction_history: null, selected_draft_picks: null, selected_weekly_reports: [] };
    const database = { enabled: true, query: vi.fn(async (sql: string) => sql.includes('public-data-intake:read-request') ? [stored] : []) } as unknown as DatabaseClient;
    const store = mocks.store as unknown as Parameters<typeof readPublicSleeperIntake>[1];
    const cursors = { periods: 20, transactions: 40, drafts: null };
    const selected = capacityIntakeReadOptions('initial', cursors);
    expect(selected).toEqual({ managerEvidenceVersion: 'v2', exactMatchupValuesVersion: 'v1', periodContextVersion: 'v1' });
    await expect(readPublicSleeperIntake(database, store, stored.id, selected)).resolves.toMatchObject({ status: 'unavailable', exactPeriods: [], transactions: [], brackets: [] });
    const full = capacityIntakeReadOptions('full', cursors);
    expect(full).toMatchObject({ periodInventoryPage: { afterOrdinal: 20, limit: 20 }, transactionHistoryPage: { afterOrdinal: 40, limit: 20 }, draftPicksPage: { afterOrdinal: 0, limit: 20 } });
    await expect(readPublicSleeperIntake(database, store, stored.id, full)).rejects.toThrow('Draft page requires selected draft intake');
    await expect(readPublicSleeperIntake(database, store, stored.id, { ...selected, transactionHistoryPage: { afterOrdinal: 0, limit: 20 } })).rejects.toThrow('Transaction history page requires selected history');
  });
  const draft = () => {
    const endpoint = source.endpointInventory.find(row => row.resource === 'draft-catalog')!;
    const payload = { metadataVersion: 'sleeper-draft-metadata-v1', kind: 'catalog', catalog: JSON.parse(endpoint.versions[0].utf8), details: [], reason: null };
    const scope = { provider: 'sleeper' as const, leagueKey: 'unit-draft', externalLeagueId: endpoint.scope.nativeLeagueId!, season: 2026 };
    const at = new Date(benchmark).toISOString(), provenance = { origin: 'network' as const, requestStartedAt: at, requestCompletedAt: at, sourceObservedAt: at, checkedAt: at };
    const normalized = normalizeAdministrationObservation({ schemaVersion: 'league-administration-v1', normalizerVersion: 'sleeper-administration-v1', dialect: 'sleeper-nfl-v1',
      scope, family: 'drafts', week: null, completeness: 'complete', payload, provenance });
    return { content: { family: 'drafts', week: 0, completeness: 'complete', payload, accepted: normalized.status === 'accepted',
      content_hash: normalized.contentHash, semantic_hash: normalized.semanticHash, normalized_value: normalized.value, diagnostics: normalized.diagnostics }, receipt: { provenance }, attempt: { source_mapping: { scope } } };
  };
  it('preserves generic draft rejection while requiring the maintained typed projector', () => {
    const row = draft(); expect(row.content.accepted).toBe(false);
    expect(projectDraftMetadata(capacityStoredReceiptNormalization(row)).status).toBe('accepted');
  });
  it.each(['accepted-flag', 'native-hash', 'semantic-hash', 'generic-diagnostics'] as const)('rejects changed draft %s', mutation => {
    const row = draft();
    if (mutation === 'accepted-flag') row.content.accepted = true;
    if (mutation === 'native-hash') row.content.content_hash = '0'.repeat(64);
    if (mutation === 'semantic-hash') row.content.semantic_hash = '0'.repeat(64);
    if (mutation === 'generic-diagnostics') row.content.diagnostics = [];
    expect(() => capacityStoredReceiptNormalization(row)).toThrow();
  });
});


describe('weekly reports retain native values and bound canonical identities', () => {
  const fixture = async () => {
    const test = setup(); await test.capture(0, ['rosters']); const capture = test.latest.get('rosters')!;
    const mapping = (capture.row.attempt as { source_mapping: AdministrationSourceMapping }).source_mapping;
    const endpoint = source.endpointInventory.find(row => row.resource === 'weekly-report' && row.scope.nativeLeagueId === mapping.scope.externalLeagueId)!;
    const original = parsePublicCaptureWitness(capture.provenance.acquisition);
    const provenance = { ...capture.provenance, acquisition: { ...original, work: { kind: 'weekly-report' as const,
      requestId: original.work.requestId, revision: original.work.revision, externalLeagueId: mapping.scope.externalLeagueId,
      season: 2026 as const, nativeWeek: endpoint.scope.nativeWeek! }, attempts: { weekly_report: original.attempts.players! } } };
    const normalized = normalizeAdministrationObservation({ schemaVersion: 'league-administration-v1', normalizerVersion: 'sleeper-administration-v1', dialect: 'sleeper-nfl-v1',
      scope: mapping.scope, family: 'weekly_report', week: endpoint.scope.nativeWeek, completeness: 'complete', payload: JSON.parse(endpoint.versions[0].utf8), provenance });
    const teams = (capture.row.content as { payload: { roster_id: number }[] }).payload.map(row => {
      const id = String(row.roster_id), seasonTeamId = hashId('report-team-' + id);
      return { externalRosterId: id, seasonTeamId, players: [{ seasonTeamId, sourceTeam: { provider: 'sleeper', resourceKind: 'team',
        nativeNamespace: JSON.stringify(['nfl', 2026, mapping.scope.externalLeagueId]), nativeId: id } }] };
    });
    const proof = { nativeLeagueId: mapping.scope.externalLeagueId, source: capture.row,
      read: { status: 'available', receipt: { id: capture.receiptId }, accepted: { scope: { leagueSeasonId: mapping.leagueSeasonId }, sourceMappingRevisionId: mapping.revisionId }, teams } };
    return { normalized, proof };
  };
  it('adds only the maintained reader canonical team identities from the same roster proof', async () => {
    const { normalized, proof } = await fixture(), expected = capacityWeeklyReportReaderValue(normalized, proof);
    expect(expected.teams.map(team => team.seasonTeamId)).toEqual(proof.read.teams.map(team => team.seasonTeamId));
    expect(expected.teams.map(({ seasonTeamId, ...team }) => { expect(seasonTeamId).toMatch(/^[0-9a-f-]{36}$/u); return team; })).toEqual(normalized.value?.family === 'weekly_report' ? normalized.value.report.teams : null);
  });
  it.each(['invalid-uuid','duplicate-uuid','wrong-native-league','wrong-mapping-revision','foreign-player-team'] as const)('rejects %s identity evidence', async mutation => {
    const { normalized, proof } = await fixture();
    if (mutation === 'invalid-uuid') proof.read.teams[0].seasonTeamId = 'invalid';
    if (mutation === 'duplicate-uuid') { proof.read.teams[1].seasonTeamId = proof.read.teams[0].seasonTeamId; proof.read.teams[1].players[0].seasonTeamId = proof.read.teams[0].seasonTeamId; }
    if (mutation === 'wrong-native-league') proof.nativeLeagueId += '1';
    if (mutation === 'wrong-mapping-revision') proof.read.accepted.sourceMappingRevisionId = hashId('different-revision');
    if (mutation === 'foreign-player-team') proof.read.teams[0].players[0].sourceTeam.nativeId = 'foreign';
    expect(() => capacityWeeklyReportReaderValue(normalized, proof)).toThrow();
  });
});


describe('draft reader normalization retains the captured mapping scope', () => {
  it('preserves the actual mapping key instead of substituting a workload label', async () => {
    const test = setup(); await test.capture(0, ['rosters']); const capture = test.latest.get('rosters')!;
    const resource = { provenance: capture.provenance, sourceMappingRevisionId: test.mapping.revisionId };
    expect(test.mapping.scope.leagueKey).not.toBe(test.key);
    expect(capacityDraftReaderScope(resource, test.mapping.scope.externalLeagueId)).toEqual(test.mapping.scope);
  });
  it.each(['foreign-native-league','foreign-revision'] as const)('rejects %s before projecting a draft value', async mutation => {
    const test = setup(); await test.capture(0, ['rosters']); const capture = test.latest.get('rosters')!;
    const resource = { provenance: capture.provenance, sourceMappingRevisionId: mutation === 'foreign-revision' ? hashId('foreign') : test.mapping.revisionId };
    expect(() => capacityDraftReaderScope(resource, test.mapping.scope.externalLeagueId + (mutation === 'foreign-native-league' ? '1' : ''))).toThrow();
  });
});


describe('ancillary cadence uses actual confirmations and maximum intervals', () => {
  const capture = (index: number, sourceAt: number, confirmedAt = sourceAt): CapacityAncillarySuccess => ({
    receiptId: 'receipt-' + index, attemptId: 'attempt-' + index, sourceAt, acceptedAt: sourceAt, confirmedAt });
  it('accepts exactly fifteen minutes and rejects one millisecond beyond either gap or tail', () => {
    const rows = [capture(1,0),capture(2,900_000)];
    expect(evaluateCapacityAncillaryChain(0,1_800_000,rows,true).pass).toBe(true);
    expect(evaluateCapacityAncillaryChain(0,1_800_001,rows,true).failures).toContain('stale-tail');
    expect(evaluateCapacityAncillaryChain(0,1_800_000,[capture(1,0),capture(2,900_001)],true).failures).toContain('confirmation-gap');
  });
  it('requires a pre-boundary confirmation rather than a new convenient starting receipt', () => {
    expect(evaluateCapacityAncillaryChain(900_000,1_000_000,[capture(1,900_001)],true).failures).toContain('missing-fresh-start-proof');
    expect(evaluateCapacityAncillaryChain(900_000,1_000_000,[capture(1,850_000,899_999)],true).pass).toBe(true);
  });
  it('does not move an earlier component anchor to the later exact anchor', () => {
    const rows = [capture(1,600_000,1_000_000)];
    expect(evaluateCapacityAncillaryChain(0,1_100_000,rows).failures).toContain('confirmation-gap');
    expect(evaluateCapacityAncillaryChain(600_000,1_100_000,rows).pass).toBe(true);
  });
  it('allows an actual prior current confirmation at a fresh pair anchor without resetting its clock', () => {
    expect(evaluateCapacityAncillaryChain(100_000,900_000,[capture(1,0,99_999)]).pass).toBe(true);
    expect(evaluateCapacityAncillaryChain(100_000,900_001,[capture(1,0,99_999)]).pass).toBe(false);
  });
  it('does not let cached reads or a different receipt for the same physical attempt renew freshness', () => {
    const first = capture(1,0), cached = {...first,confirmedAt:800_000};
    expect(evaluateCapacityAncillaryChain(0,1_000_000,[first,cached],true).failures).toContain('stale-tail');
    expect(evaluateCapacityAncillaryChain(0,900_000,[first,{...cached,receiptId:'another'}],true).failures).toContain('invalid-success-clock');
    expect(evaluateCapacityAncillaryChain(0,1_000_000,[first,capture(2,800_000)],true).pass).toBe(true);
  });
  it('checks rollback before deduplicating repeated receipt confirmations', () => {
    const first = capture(1,0);
    expect(evaluateCapacityAncillaryChain(0,800_000,[first,capture(2,500_000),{...first,confirmedAt:600_000}],true).failures).toContain('source-regression');
  });
  it('rejects changed clocks on the same immutable receipt', () => {
    const first = capture(1,0);
    expect(evaluateCapacityAncillaryChain(0,900_000,[first,{...first,sourceAt:800_000,confirmedAt:800_000}],true).failures).toContain('invalid-success-clock');
  });
  it('does not repair a stale interval with a capture only confirmed after its prior deadline', () => {
    expect(evaluateCapacityAncillaryChain(0,1_000_000,[capture(1,0),capture(2,850_000,950_000)],true).failures).toContain('confirmation-gap');
  });
  it('requires the first fresh confirmation to have genuinely fresh source age', () => {
    expect(evaluateCapacityAncillaryChain(1_000_000,1_200_000,[capture(1,0,1_100_000)]).failures).toContain('stale-confirmation');
  });
  it('counts only captures confirmed within the segment and never future post-end credit', () => {
    const result = evaluateCapacityAncillaryChain(100_000,900_000,[capture(1,0),capture(2,900_001)],true);
    expect(result.pass).toBe(true); expect(result.distinctCaptures).toBe(0);
  });
  it('separates the deliberate outage from the post-restoration chain', () => {
    const rows = [capture(1,0),capture(2,600_000),capture(3,3_000_000),capture(4,3_600_000)];
    expect(evaluateCapacityAncillaryChain(0,900_000,rows,true).pass).toBe(true);
    expect(evaluateCapacityAncillaryChain(2_700_000,4_000_000,rows,false,true).pass).toBe(true);
    expect(evaluateCapacityAncillaryChain(0,4_000_000,rows,true).pass).toBe(false);
    expect(evaluateCapacityAncillaryChain(2_700_000,3_500_000,[capture(1,2_000_000,2_800_000)],false,true).failures).toContain('no-confirmed-refresh');
  });
  it('retains a late immutable slot and performs no SQL to manufacture a replacement', async () => {
    const test = setup(); test.setNow(benchmark + 1001);
    await test.observer.observeAncillary(benchmark,new Map());
    expect(test.database.query).not.toHaveBeenCalled();
    const snapshot = test.observer.snapshot(); expect(snapshot.ancillaryReads).toHaveLength(16);
    expect(snapshot.ancillaryReads.every(row => row.composed === null && row.unavailable.standings !== undefined)).toBe(true);
    await expect(test.observer.observeAncillary(benchmark,new Map())).rejects.toThrow('ancillary slot cannot be replaced');
  });
});

describe('ancillary official results require every actual typed child', () => {
  // Compact schema-only composition witnesses. Actual SQL/lineage qualification is tested independently.
  const input = (): OfficialResultsInput => {
    const mapping: AdministrationSourceMapping = { connectionId:hashId('ancillary-connection'),leagueSeasonId:hashId('ancillary-season'),revisionId:hashId('ancillary-revision'),generation:1,
      scope:{provider:'sleeper',leagueKey:'ancillary-unit',externalLeagueId:'123456789012345678',season:2026} };
    const values = {status:'available',version:'sleeper-exact-matchup-values-v1',selection:'current',sourceMappingRevisionId:mapping.revisionId,
      matchupsReceiptId:hashId('ancillary-exact'),value:{season:2026,nativeWeek:7,teams:[]}};
    return {mapping,standings:{status:'available',version:'sleeper-official-standings-v1',mapping,teams:[]},
      periods:[{nativeWeek:7,values,context:{status:'available',version:'sleeper-exact-period-context-v1',sourceMappingRevisionId:mapping.revisionId,
        period:{season:2026,nativeWeek:7},capture:{matchupsReceiptId:values.matchupsReceiptId},observedConfiguration:{provenance:{sourceObservedAt:'2025-01-01T00:00:00Z'},applicability:'observation-only'},
        configuration:{competition:{status:'unknown'}},phase:{status:'unknown'}}}],
      brackets:(['winners_bracket','losers_bracket'] as const).map(family=>({family,resource:{status:'available',version:'sleeper-playoff-brackets-v1',sourceMappingRevisionId:mapping.revisionId,
        bracketReceiptId:hashId(family),value:{family,season:2026,matches:[]}}}))} as unknown as OfficialResultsInput;
  };
  it('preserves unknown official outcome/finality and does not apply the active clock to old settings', () => {
    const result = composeCapacityAncillary(input()); expect(result.status).toBe('available');
    if(result.status==='available') expect(result.periods[0]).toMatchObject({officialOutcome:{status:'unknown'},finality:{status:'unknown'},series:{status:'unknown'}});
  });
  it.each(['standings','exact','context','winners_bracket','losers_bracket'])('rejects missing %s even when the outer composer is available', component => {
    const value = structuredClone(input()) as unknown as Record<string,unknown>, periods=value.periods as Record<string,unknown>[], brackets=value.brackets as Record<string,unknown>[];
    if(component==='standings') value.standings={status:'unavailable'};
    else if(component==='exact') periods[0].values={status:'unavailable'};
    else if(component==='context') periods[0].context={status:'unavailable'};
    else brackets[component==='winners_bracket'?0:1].resource={status:'unavailable'};
    expect(composeOfficialResults(value as unknown as OfficialResultsInput).status).toBe('available');
    expect(()=>composeCapacityAncillary(value as unknown as OfficialResultsInput)).toThrow();
  });
  it.each(['receipt','week'])('rejects a foreign exact context %s', field => {
    const value=structuredClone(input()) as unknown as {periods:{context:{capture:{matchupsReceiptId:string};period:{nativeWeek:number}}}[]};
    if(field==='receipt') value.periods[0].context.capture.matchupsReceiptId=hashId('foreign'); else value.periods[0].context.period.nativeWeek=8;
    expect(()=>composeCapacityAncillary(value as unknown as OfficialResultsInput)).toThrow();
  });
});


describe('lossless bounded ancillary artifact encoding', () => {
  it('preserves every nested value and exact UTF-8 bytes with deterministic encoding', () => {
    const value = [{ native: 'équipe', missing: null, nested: { values: [1, false, 'source'] } }];
    const id = capacityDigest(value), encoded = encodeCapacityAncillaryBody(id, value);
    expect(encoded).toEqual(encodeCapacityAncillaryBody(id, value));
    const raw = inflateRawSync(Buffer.from(encoded.data, 'base64'));
    expect(raw.toString('utf8')).toBe(JSON.stringify(value));
    expect(raw.length).toBe(encoded.decodedBytes);
    expect(createHash('sha256').update(raw).digest('hex')).toBe(encoded.decodedSha256);
    expect(Object.keys(encoded).sort()).toEqual(['data','decodedBytes','decodedSha256','encoding','id']);
  });
  it('rejects a changed body identity and oversized decoded content even when highly compressible', () => {
    expect(() => encodeCapacityAncillaryBody('a'.repeat(64), [])).toThrow('digest mismatch');
    const value = 'x'.repeat(CAPACITY_ANCILLARY_BODY_BYTES);
    expect(() => encodeCapacityAncillaryBody(capacityDigest(value), value)).toThrow('decoded body exceeds');
  });
  it('encodes query bodies and checks total decoded bytes without replacing their digest identities', () => {
    const value: JsonValue = [{ id: 'receipt', timestamp: '2026-10-17T00:00:00.123456+00:00' }];
    const result = encodeCapacityAncillaryBodies([{ id: capacityDigest(value), value }], []);
    expect(result.decodedBytes).toBe(Buffer.byteLength(JSON.stringify(value), 'utf8'));
    expect(JSON.parse(inflateRawSync(Buffer.from(result.queryRows[0].data, 'base64')).toString('utf8'))).toEqual(value);
    expect(result.proofs).toEqual([]);
  });
});


describe('earliest ancillary receipt checkpoint binding', () => {
  function pendingSetup() {
    const test = setup('league-09'), requestId = hashId('ancillary-initial'), workerId = hashId('ancillary-worker');
    let committed = false, changed = false;
    vi.mocked(test.database.query).mockImplementation((async (sql: string, params?: readonly unknown[]) => {
      if (sql === CAPACITY_ANCILLARY_HEADS_SQL) return [];
      if (sql !== CAPACITY_ANCILLARY_FIRST_RECEIPT_SQL) return [];
      const family = String(params?.[2]), receiptId = hashId(family + (changed ? '/later' : '/earliest'));
      return [{ receipt: { id: receiptId }, acceptance: { receipt_id: receiptId, accepted_at: new Date(benchmark-100).toISOString() },
        content: { family, external_league_id: source.leagues.find(row=>row.key==='league-09')!.nativeLeagueId },
        dispatch: { intake_id: requestId, worker_id: workerId, generation: 1 },
        outcome: committed ? { outcome: 'checkpoint-committed', worker_id: workerId, generation: 1 } : null }];
    }) as DatabaseClient['query']);
    return { test, requestId, commit: () => { committed = true; }, change: () => { changed = true; } };
  }
  it('retains pending observations and freezes only the same earliest receipt after its actual checkpoint', async () => {
    const { test,requestId,commit } = pendingSetup(); test.setNow(benchmark);
    await test.observer.observeAncillary(benchmark,new Map([['intake-a',requestId]]),['league-09']);
    const first = test.observer.snapshot(); expect(first.ancillaryAnchors).toHaveLength(0);
    expect(first.operations.some(row => row.operation.startsWith('ancillary-anchor/') && (row.outcome as Record<string,unknown>).status === 'pending-checkpoint')).toBe(true);
    commit(); test.setNow(benchmark+60_000);
    await test.observer.observeAncillary(benchmark+60_000,new Map([['intake-a',requestId]]),['league-09']);
    const final = test.observer.snapshot(); expect(final.ancillaryAnchors).toHaveLength(2);
    for (const anchor of final.ancillaryAnchors) {
      expect(anchor.at).toBe(benchmark-100); expect(anchor.receiptId).toBe(hashId(anchor.component+'/earliest'));
      const body = final.ancillaryQueryRows.find(row=>row.id===anchor.query!.rowsRef)!;
      expect('encoding' in body).toBe(true);
      if ('data' in body) expect(JSON.parse(inflateRawSync(Buffer.from(body.data,'base64')).toString('utf8'))[0].outcome.outcome).toBe('checkpoint-committed');
    }
  });
  it('rejects a different favorable receipt after the earliest pending acceptance', async () => {
    const { test,requestId,commit,change } = pendingSetup(); test.setNow(benchmark);
    await test.observer.observeAncillary(benchmark,new Map([['intake-a',requestId]]),['league-09']);
    commit(); change(); test.setNow(benchmark+60_000);
    await test.observer.observeAncillary(benchmark+60_000,new Map([['intake-a',requestId]]),['league-09']);
    expect(test.observer.snapshot().ancillaryAnchors).toHaveLength(0);
    expect(test.observer.snapshot().failures.some(row=>row.operation.startsWith('ancillary'))).toBe(true);
  });
});


describe('daily auxiliary immutable identity and scope guards', () => {
  it('uses the maintained20-row draft page bound and explicit advancing cursor',()=>{
    expect(capacityAuxiliaryReadOptions('a')).toEqual({managerEvidenceVersion:'v2',draftPicksPage:{afterOrdinal:0,limit:20}});
    expect(capacityAuxiliaryReadOptions('a',200)).toEqual({managerEvidenceVersion:'v2',draftPicksPage:{afterOrdinal:200,limit:20}});
    expect(capacityAuxiliaryReadOptions('b')).toEqual({managerEvidenceVersion:'v2'});
    expect(()=>capacityAuxiliaryReadOptions('a',-1)).toThrow();
  });
  const nativeIds = Array.from({length:12},(_,i)=>String(i+1));
  const read = () => ({status:'available',teams:nativeIds.map(id=>({externalRosterId:id,seasonTeamId:hashId('aux-team-'+id),players:[]}))});
  const scope = () => ({terminal:true,username:'aux-a',seasons:[2026],draft_picks:'sleeper-2026-draft-picks-v1',
    period_inventory:null,transaction_history:null,transaction_period:null,playoff_brackets:null,submission_capacity:null,resource_occurrence_id:null,exact_periods:[],weekly_reports:[]});
  it('retains twelve native-to-canonical identities independently of row order',()=>{
    const actual=read(),reordered=read();reordered.teams.reverse();
    expect(assertCapacityAuxiliaryTeams(nativeIds,actual)).toEqual(assertCapacityAuxiliaryTeams(nativeIds,reordered));
    expect(assertCapacityAuxiliaryTeams(nativeIds,actual)).toHaveLength(12);
  });
  it.each(['empty','duplicate-native','duplicate-canonical','nonempty-player','invalid-canonical','unavailable'])('rejects vacuous or altered overlap evidence: %s',mutation=>{
    const actual=read();if(mutation==='empty')actual.teams=[];
    if(mutation==='duplicate-native')actual.teams[1].externalRosterId=actual.teams[0].externalRosterId;
    if(mutation==='duplicate-canonical')actual.teams[1].seasonTeamId=actual.teams[0].seasonTeamId;
    if(mutation==='nonempty-player')(actual.teams[0].players as unknown[]).push({playerId:'unexpected'});
    if(mutation==='invalid-canonical')actual.teams[0].seasonTeamId='label';
    if(mutation==='unavailable')actual.status='unavailable';
    expect(()=>assertCapacityAuxiliaryTeams(nativeIds,actual)).toThrow();
  });
  it('binds separate A draft and B core-only ordinary request scopes',()=>{
    expect(()=>assertCapacityAuxiliaryScope(scope(),'aux-a',true)).not.toThrow();
    expect(()=>assertCapacityAuxiliaryScope({...scope(),username:'aux-b',draft_picks:null},'aux-b',false)).not.toThrow();
  });
  it.each(['username','terminal','drafts','selected-period','internal','capacity'])('rejects changed auxiliary SQL request scope: %s',mutation=>{
    const actual=scope();if(mutation==='username')actual.username='other';if(mutation==='terminal')actual.terminal=false;
    if(mutation==='drafts')(actual as Record<string,unknown>).draft_picks=null;
    if(mutation==='selected-period')(actual as Record<string,unknown>).exact_periods=[{season:2026,nativeWeek:7}];
    if(mutation==='internal')(actual as Record<string,unknown>).resource_occurrence_id=hashId('internal');
    if(mutation==='capacity')(actual as Record<string,unknown>).submission_capacity='pending-request-limit';
    expect(()=>assertCapacityAuxiliaryScope(actual,'aux-a',true)).toThrow();
  });
});


describe('passive closed daily catalog SQL acknowledgment capture',()=>{
  const params=['league-administration-public-intake','league-administration-public-intake','2026-10-17T00:00:00.000Z',JSON.stringify({policy:'public-player-directory-v1',mode:'player-directory'}),hashId('directory-owner'),'25','60'];
  const body=(query=CAPACITY_DAILY_CATALOG_CLAIM_SQL,values:unknown[]=params)=>({method:'POST',body:JSON.stringify({query,params:values})});
  const reply=()=>new Response(JSON.stringify({fields:[{name:'attempt_count'},{name:'lease_until'}],rows:[['1','2026-10-17T00:00:25.000Z']]}),{status:200});
  const clock={wallNow:()=>benchmark,monotonicNow:()=>100};
  it('returns the original response with untouched body and binds only the exact declared result',async()=>{
    const response=reply(),next=vi.fn<typeof fetch>().mockResolvedValue(response),record=vi.fn();
    const wrapped=createCapacityDailyCatalogFetch(next,record,clock),input='https://isolated.invalid/sql',init=body();
    expect(await wrapped(input,init)).toBe(response);expect(next).toHaveBeenCalledExactlyOnceWith(input,init);
    expect(await response.json()).toMatchObject({rows:[['1','2026-10-17T00:00:25.000Z']]});
    expect(record).toHaveBeenCalledOnce();expect(record.mock.calls[0][0]).toMatchObject({kind:'claim',status:'success',params,response:{fields:['attempt_count','lease_until'],rows:[['1','2026-10-17T00:00:25.000Z']]}});
    expect(Object.keys(record.mock.calls[0][0]).sort()).toEqual(['kind','params','querySha256','response','span','status']);
  });
  it('records exact reservation results without changing ordinary decoding',async()=>{
    const response=new Response(JSON.stringify({fields:[{name:'result'}],rows:[[JSON.stringify({status:'backoff',retryAt:'2026-10-18T00:00:00.000Z'})]]}));
    const record=vi.fn(),wrapped=createCapacityDailyCatalogFetch(vi.fn<typeof fetch>().mockResolvedValue(response),record,clock);
    await wrapped('https://isolated.invalid/sql',body(CAPACITY_DAILY_CATALOG_RESERVE_SQL,[hashId('attempt'),JSON.stringify({jobKey:'league-administration-public-intake',workerId:params[4],generation:1,deadlineAt:'2026-10-17T00:00:22.000Z'})]));
    expect(record.mock.calls[0][0]).toMatchObject({kind:'reserve',status:'success'});
  });
  it.each(['other-query','other-payload','extra-payload','other-owner'])('does not copy unrelated query values: %s',async mutation=>{
    const values=[...params];let query=CAPACITY_DAILY_CATALOG_CLAIM_SQL;
    if(mutation==='other-query')query='select private_data';
    if(mutation==='other-payload')values[3]=JSON.stringify({policy:'public-data-batch-v1',mode:'intake'});
    if(mutation==='extra-payload')values[3]=JSON.stringify({policy:'public-player-directory-v1',mode:'player-directory',extra:'unrelated'});
    if(mutation==='other-owner')values[0]='another-job';
    const record=vi.fn(),response=reply(),wrapped=createCapacityDailyCatalogFetch(vi.fn<typeof fetch>().mockResolvedValue(response),record,clock);
    expect(await wrapped('https://isolated.invalid/sql',body(query,values))).toBe(response);expect(record).not.toHaveBeenCalled();
  });
  it('does not copy undeclared owner fields from even an exact reservation query',async()=>{
    const record=vi.fn(),response=reply(),wrapped=createCapacityDailyCatalogFetch(vi.fn<typeof fetch>().mockResolvedValue(response),record,clock);
    await wrapped('https://isolated.invalid/sql',body(CAPACITY_DAILY_CATALOG_RESERVE_SQL,[hashId('attempt'),JSON.stringify({jobKey:'league-administration-public-intake',workerId:params[4],generation:1,deadlineAt:'2026-10-17T00:00:22.000Z',unrelated:'not-retained'})]));
    expect(record).not.toHaveBeenCalled();
  });
  it('retains malformed success as unclassified and preserves HTTP errors without copying their bodies',async()=>{
    for(const response of [new Response(JSON.stringify({fields:[{name:'other'}],rows:[['unrelated']]})),new Response('private failure',{status:500})]){
      const record=vi.fn(),wrapped=createCapacityDailyCatalogFetch(vi.fn<typeof fetch>().mockResolvedValue(response),record,clock);
      expect(await wrapped('https://isolated.invalid/sql',body())).toBe(response);
      expect(record.mock.calls[0][0]).toMatchObject({status:response.ok?'unclassified':'failed',response:null});
    }
  });
  it('rethrows the same transport failure while retaining only its bounded failure status',async()=>{
    const error=new Error('private transport error'),record=vi.fn(),wrapped=createCapacityDailyCatalogFetch(vi.fn<typeof fetch>().mockRejectedValue(error),record,clock);
    await expect(wrapped('https://isolated.invalid/sql',body())).rejects.toBe(error);
    expect(record.mock.calls[0][0]).toMatchObject({status:'failed',response:null});expect(JSON.stringify(record.mock.calls)).not.toContain(error.message);
  });
});
