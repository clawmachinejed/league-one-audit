import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DatabaseClient, DatabaseRow } from '../database';
import { createLeagueAdministrationStore } from './store';
import { createPublicIntakeStore, createPublicDataRefreshStore } from './neon/public-intake';
import { validatePublicIntake, PUBLIC_TRANSACTION_HISTORY, publicTransactionHistoryPeriods } from './public-intake-contracts';
import { validatePublicDataRefresh } from './public-refresh-contracts';
import { readPublicTransactionHistory } from './public-transaction-reader';
import { readPublicSleeperIntake } from './public-intake-reader';
import { normalizeAdministrationObservation } from './normalize';
import { TRANSACTIONS_POLICY, transactionsScope, type TransactionCapture, type AcceptedTransactionsRead } from './transaction-capture-contracts';
import type { PublicCaptureWitness, JsonValue } from './contracts';
import type { LeagueAdministrationStore } from './store-contracts';

vi.mock('server-only', () => ({}));
vi.mock('next/cache', () => ({ unstable_cache: (fn: unknown) => fn }));
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
const id = randomUUID(), native = '98765432109876543210', time = '2026-10-13T12:00:00.000Z';
const mapping = { connectionId: randomUUID(), leagueSeasonId: randomUUID(), revisionId: randomUUID(), generation: 1,
  scope: { leagueKey: 'unrelated-cp15-unit', provider: 'sleeper' as const, externalLeagueId: native, season: 2026 } };
const input = { id, username: 'cp15_manager', seasons: [2026] };
const historyInput = { ...input, transactionHistory: PUBLIC_TRANSACTION_HISTORY };
const refreshInput = { id: randomUUID(), identityRequestId: id, expectedRevision: 0, seasons: [2026], cadenceSeconds: 3600,
  expiresAt: '2026-10-14T12:00:00.000Z', paused: false, transactionHistory: PUBLIC_TRANSACTION_HISTORY };
const events = [{ transaction_id: '98765432109876543219', type: 'waiver', status: 'failed', roster_ids: [1],
  adds: { '12345': 1 }, drops: null, settings: { waiver_bid: 0 }, created: 0, status_updated: 1791806400123 }];

function accepted(nativeWeek: number, payload: JsonValue = events, sourceTime = time): AcceptedTransactionsRead & { status: 'available' } {
  const workerId = randomUUID(), receiptId = randomUUID(), attemptId = randomUUID();
  const witness: PublicCaptureWitness = { version: 'public-network-capture-v1',
    work: { requestId: id, revision: nativeWeek + 3, kind: 'transactions', season: 2026, nativeWeek, externalLeagueId: native }, mapping,
    fence: { jobKey: 'league-administration-public-intake', workerId, generation: 1, deadlineAt: sourceTime }, dispatchNonce: randomUUID(),
    attempts: { transactions: { id: attemptId, nonce: randomUUID() } } };
  const normalized = normalizeAdministrationObservation({ schemaVersion: 'league-administration-v1', normalizerVersion: 'sleeper-administration-v1',
    dialect: 'sleeper-nfl-v1', scope: mapping.scope, family: 'transactions', week: nativeWeek, completeness: 'complete', payload,
    provenance: { origin: 'network', requestStartedAt: sourceTime, requestCompletedAt: sourceTime, sourceObservedAt: sourceTime,
      checkedAt: sourceTime, acquisition: witness } });
  const capture: TransactionCapture = { captureId: receiptId, captureKind: 'receipt', leagueSeasonId: mapping.leagueSeasonId,
    observationId: randomUUID(), contentId: randomUUID(), week: nativeWeek, envelope: normalized.envelope,
    contentHash: normalized.contentHash, semanticHash: normalized.semanticHash, normalizedValue: normalized.value as TransactionCapture['normalizedValue'],
    accepted: true, outcome: 'changed', orderingAt: sourceTime, recordedAt: sourceTime, mapping,
    seasonTeams: [{ seasonTeamId: randomUUID(), externalRosterId: '1' }],
    receipt: { id: receiptId, attemptId, ordinal: 1, expectedGeneration: 0, acceptedGeneration: 1, provenance: normalized.envelope.provenance,
      coverage: { periodIds: ['sleeper:transaction-week:' + nativeWeek], interval: null, entitySet: 'full', fields: ['transaction_id'],
        pagination: 'complete', nextCursor: null, completeness: 'complete', reasons: [] } } };
  return { status: 'available', capture, accepted: { scope: transactionsScope(mapping, nativeWeek),
    canonicalNormalizerVersion: TRANSACTIONS_POLICY.canonicalNormalizerVersion, sourceMappingRevisionId: mapping.revisionId,
    contentId: capture.contentId, observationIds: [receiptId], validationVersion: TRANSACTIONS_POLICY.validationVersion,
    acceptedGeneration: 1, verifiedAt: sourceTime, effectiveFrom: null, effectiveTo: null, effectiveEvidence: 'unknown' } };
}
function fixture() {
  const receipts = Array.from({ length: 19 }, (_, week) => accepted(week));
  const current = [...receipts];
  const rows: Record<string, unknown>[] = receipts.map((resource, index) => ({ ordinal: index + 1, season: 2026, external_league_id: native,
    native_week: index, status: 'complete', failure_count: 0, reason: null,
    worker_id: resource.capture.envelope.provenance.acquisition!.fence.workerId, generation: 1,
    league_season_id: mapping.leagueSeasonId, source_mapping: mapping, transaction_receipt_id: resource.capture.captureId, recorded_at: time }));
  const candidates: Record<string, unknown>[] = [{ season: 2026, external_league_id: native, stage: 'complete' }];
  const lists: DatabaseRow[] = [{ season: 2026 }];
  const query = vi.fn(async () => rows);
  const administration = { ...createLeagueAdministrationStore({ enabled: false, reason: 'missing-database-url' }), enabled: true,
    readSourceMapping: vi.fn(async () => mapping),
    readAcceptedTransactions: vi.fn<LeagueAdministrationStore['readAcceptedTransactions']>(async (_mapping, week, selection) =>
      selection ? receipts.find(receipt => receipt.capture.captureId === selection.receiptId) ?? { status: 'missing' } : current[week]) };
  const client = { enabled: true, query } as unknown as DatabaseClient;
  return { receipts, current, rows, candidates, lists, query, administration, client,
    run: (page = {}) => readPublicTransactionHistory(client, administration, id, candidates, lists, page) };
}

describe('full 2026 transaction history selection', () => {
  it('requests all nineteen native periods exactly once and preserves the omitted contract', () => {
    expect(validatePublicIntake(input)).toEqual(input);
    expect(validatePublicIntake(historyInput)).toEqual(historyInput);
    expect(publicTransactionHistoryPeriods()).toEqual(Array.from({ length: 19 }, (_, nativeWeek) => ({ season: 2026, nativeWeek })));
    expect(validatePublicDataRefresh(refreshInput, new Date(time))).toEqual(refreshInput);
    expect(() => validatePublicIntake({ ...historyInput, transactionPeriod: { season: 2026, nativeWeek: 0 } })).toThrow('mutually exclusive');
  });
  it.each([null, false, [], {}, 'sleeper-2025-transaction-history-v1', 'sleeper-2026-transaction-history-v2'])(
    'rejects invalid selectors before intake or refresh mutation: %j', transactionHistory => {
      expect(() => validatePublicIntake({ ...input, transactionHistory } as never)).toThrow();
      expect(() => validatePublicDataRefresh({ ...refreshInput, transactionHistory } as never, new Date(time))).toThrow();
    });
  it.each([[2025], [2026, 2027], [2025, 2026]].map(seasons => ({ seasons })))('refuses other season scope $seasons', ({ seasons }) => {
    expect(() => validatePublicIntake({ ...historyInput, seasons })).toThrow();
    expect(() => validatePublicDataRefresh({ ...refreshInput, seasons }, new Date(time))).toThrow();
  });
  it('fails closed before selected mutation if either schema capability is unavailable', async () => {
    const query = vi.fn<(statement: string, parameters?: readonly unknown[]) => Promise<DatabaseRow[]>>(async () => [{ supported: false }]);
    const client = { enabled: true, query } as unknown as DatabaseClient;
    await expect(createPublicIntakeStore(client).submit(historyInput)).rejects.toThrow('R052');
    expect(query).toHaveBeenCalledOnce();
    vi.useFakeTimers(); vi.setSystemTime(new Date(time));
    try { await expect(createPublicDataRefreshStore(client).configure(refreshInput)).rejects.toThrow('R052'); }
    finally { vi.useRealTimers(); }
    expect(query).toHaveBeenCalledTimes(2);
    expect(query.mock.calls.every(call => String(call[0]).includes('transaction-history-capability'))).toBe(true);
    await createPublicIntakeStore(client).submit(input);
    expect(query).toHaveBeenLastCalledWith(expect.stringContaining('public-data-intake:submit'), [JSON.stringify(input)]);
  });
});

describe('stored complete history and bounded receipt pages', () => {
  it('reads every exact receipt with native-period grouping and no provider calls', async () => {
    const f = fixture(), fetch = vi.fn(() => { throw new Error('Provider forbidden'); }); vi.stubGlobal('fetch', fetch);
    const result = await f.run();
    expect(result.inventory).toMatchObject({ collection: 'complete', readCoverage: 'complete',
      summary: { requestedPeriods: 19, materializedPeriods: 19, acquiredPeriods: 19, pendingPeriods: 0, unavailablePeriods: 0 } });
    expect(result.transactions.map(row => row.nativeWeek)).toEqual(Array.from({ length: 19 }, (_, week) => week));
    for (const [week, row] of result.transactions.entries()) {
      expect(row).toMatchObject({ resource: { status: 'available', value: { events: [{ externalTransactionId: events[0].transaction_id,
        nativeStatus: { value: 'failed' }, createdAtMilliseconds: { value: 0 }, claim: { bid: 0 } }] } },
      acquisition: { transactionReceiptId: f.receipts[week].capture.captureId }, currentAccepted: { captureBinding: 'latest-for-current-source-mapping' } });
    }
    expect(fetch).not.toHaveBeenCalled();
    expect(f.administration.readAcceptedTransactions).toHaveBeenCalledTimes(38);
  });
  it('separates newer correction and complete-empty current heads from old request receipts', async () => {
    const f = fixture();
    f.current[0] = accepted(0, [{ ...events[0], status: 'complete', status_updated: 1 }], '2026-10-13T13:00:00.000Z');
    f.current[18] = accepted(18, [], '2026-10-13T13:00:00.000Z');
    const result = await f.run();
    expect(result.transactions[0]).toMatchObject({ resource: { value: { events: [{ nativeStatus: { value: 'failed' } }] } },
      currentAccepted: { resource: { accepted: { verifiedAt: '2026-10-13T13:00:00.000Z' },
        value: { events: [{ nativeStatus: { value: 'complete' }, statusUpdatedAtMilliseconds: { value: 1 } }] } } } });
    expect(result.transactions[18]).toMatchObject({ resource: { value: { events: [{ externalTransactionId: events[0].transaction_id }] } },
      currentAccepted: { resource: { value: { events: [] } } } });
    expect(result.transactions[18].acquisition?.transactionReceiptId).toBe(f.receipts[18].capture.captureId);
  });
  it('retains last good separately while pending or failed acquisition never counts as acquired', async () => {
    const f = fixture();
    Object.assign(f.rows[0], { status: 'pending', transaction_receipt_id: null, failure_count: 1 });
    Object.assign(f.rows[18], { status: 'unavailable', transaction_receipt_id: null, failure_count: 5, reason: 'transaction-capture-exhausted' });
    const result = await f.run();
    expect(result.inventory).toMatchObject({ collection: 'pending', summary: { acquiredPeriods: 17, pendingPeriods: 1, unavailablePeriods: 1 } });
    for (const week of [0, 18]) expect(result.transactions[week]).toMatchObject({ resource: { status: 'unavailable' }, acquisition: null,
      currentAccepted: { resource: { status: 'available' } } });
    Object.assign(f.rows[0], { status: 'unavailable', failure_count: 5, reason: 'transaction-capture-exhausted' });
    expect((await f.run()).inventory.collection).toBe('partial');
  });
  it('limits rich reads to the selected page without relabeling inventory as fully verified', async () => {
    const f = fixture(); const result = await f.run({ afterOrdinal: 1, limit: 2 });
    expect(result.transactions.map(row => row.nativeWeek)).toEqual([1, 2]);
    expect(result.inventory).toMatchObject({ collection: 'complete', readCoverage: 'page', tasks: expect.any(Array),
      page: { afterOrdinal: 1, limit: 2, nextAfterOrdinal: 3 } });
    expect(result.inventory.tasks).toHaveLength(19);
    expect(f.administration.readAcceptedTransactions).toHaveBeenCalledTimes(4);
  });
  it('keeps equal-content acquisition clocks on the requested receipt despite an older immutable observation', async () => {
    const f = fixture();
    const fresh = accepted(0, events, '2026-10-13T14:00:00.000Z');
    Object.assign(fresh.capture, { observationId: f.receipts[0].capture.observationId, contentId: f.receipts[0].capture.contentId });
    f.receipts[0] = fresh;
    Object.assign(f.rows[0], { transaction_receipt_id: fresh.capture.captureId,
      worker_id: fresh.capture.envelope.provenance.acquisition!.fence.workerId, recorded_at: '2026-10-13T14:00:00.000Z' });
    const result = await f.run({ limit: 1 });
    expect(result.transactions[0]).toMatchObject({ resource: { accepted: { verifiedAt: '2026-10-13T14:00:00.000Z' },
      capture: { captureId: fresh.capture.captureId, observationId: fresh.capture.observationId } },
      acquisition: { transactionReceiptId: fresh.capture.captureId },
      currentAccepted: { resource: { accepted: { verifiedAt: time } } } });
  });
  it('cannot replace an unavailable requested receipt with an available current head', async () => {
    const f = fixture(); f.rows[0].transaction_receipt_id = randomUUID();
    const result = await f.run({ limit: 1 });
    expect(result.transactions[0]).toMatchObject({ resource: { status: 'missing' }, acquisition: null,
      currentAccepted: { resource: { status: 'available' } } });
  });
  it('labels authoritative empty requested receipts independently of pending and unavailable periods', async () => {
    const f = fixture(), empty = accepted(0, []); f.receipts[0] = empty;
    Object.assign(f.rows[0], { transaction_receipt_id: empty.capture.captureId,
      worker_id: empty.capture.envelope.provenance.acquisition!.fence.workerId });
    expect((await f.run({ limit: 1 })).transactions[0]).toMatchObject({ receiptState: 'complete-empty',
      resource: { status: 'available', value: { events: [] } } });
    Object.assign(f.rows[0], { status: 'pending', transaction_receipt_id: null });
    expect((await f.run({ limit: 1 })).transactions[0].receiptState).toBe('pending');
  });
  it('bounds the complete admitted matrix at380 while accounting for every excess league', async () => {
    const f = fixture(); f.rows.length = 0; f.candidates.length = 0;
    for (let league = 0; league < 1000; league++) {
      const external = String(1000 + league);
      f.candidates.push({ season: 2026, external_league_id: external, stage: league < 20 ? 'bootstrap' : 'capacity' });
      if (league < 20) for (let week = 0; week < 19; week++) f.rows.push({ ordinal: league * 19 + week + 1,
        season: 2026, external_league_id: external, native_week: week, status: 'pending', failure_count: 0,
        reason: null, transaction_receipt_id: null });
    }
    const result = await f.run({ afterOrdinal: 360, limit: 20 });
    expect(result.inventory).toMatchObject({ collection: 'pending', coverage: 'limited', readCoverage: 'page',
      summary: { observedLeagues: 1000, admittedLeagues: 20, capacityLeagues: 980, requestedPeriods: 19000,
        materializedPeriods: 380, capacityPeriods: 18620, pendingPeriods: 380, acquiredPeriods: 0 },
      page: { nextAfterOrdinal: null } });
    expect(result.transactions).toHaveLength(20); expect(result.inventory.capacity).toHaveLength(980);
    expect(f.administration.readAcceptedTransactions).not.toHaveBeenCalled();
    f.rows.push({ ...f.rows[379], ordinal: 381 });
    await expect(f.run()).rejects.toThrow('matrix');
  });
  it.each([{ limit: 21 }, { limit: 0 }, { afterOrdinal: -1 }, { afterOrdinal: 381 }, { limit: 1.5 }])(
    'rejects invalid pages before database work %j', async page => {
      const f = fixture(); await expect(f.run(page)).rejects.toThrow('page'); expect(f.query).not.toHaveBeenCalled();
    });
  it('does not mistake missing, duplicate or foreign task rows for full season acquisition', async () => {
    for (const corrupt of [0, 1, 2]) {
      const f = fixture();
      if (corrupt === 0) f.rows.pop();
      if (corrupt === 1) f.rows[18] = f.rows[0];
      if (corrupt === 2) f.rows[18].external_league_id = '123';
      await expect(f.run()).rejects.toThrow();
    }
  });
  it('accounts for excess discovery and later bootstrap capacity without silently dropping periods', async () => {
    const f = fixture(); f.candidates.push({ season: 2026, external_league_id: '999', stage: 'capacity' });
    expect((await f.run()).inventory).toMatchObject({ collection: 'partial', coverage: 'limited',
      summary: { requestedPeriods: 38, materializedPeriods: 19, capacityPeriods: 19 }, capacity: [{ externalLeagueId: '999' }] });
    f.candidates.pop(); f.candidates[0].stage = 'capacity';
    for (const row of f.rows) Object.assign(row, { status: 'unavailable', transaction_receipt_id: null, reason: 'bootstrap-capacity' });
    expect((await f.run()).inventory).toMatchObject({ collection: 'partial',
      summary: { requestedPeriods: 19, materializedPeriods: 19, acquiredPeriods: 0, unavailablePeriods: 19 } });
  });
  it('distinguishes empty completed discovery from not-yet-observed discovery', async () => {
    const f = fixture(); f.rows.length = 0; f.candidates.length = 0;
    expect((await f.run()).inventory).toMatchObject({ discovery: 'complete', collection: 'complete', summary: { requestedPeriods: 0, acquiredPeriods: 0 } });
    f.lists.length = 0;
    expect((await f.run()).inventory).toMatchObject({ discovery: 'pending', collection: 'pending' });
    expect(f.administration.readAcceptedTransactions).not.toHaveBeenCalled();
  });
  it('ordinary composition keeps partial page and last-good reads out of request completion', async () => {
    const f = fixture();
    const query = vi.fn(async (statement: string) => statement.includes('read-request')
      ? [{ id, seasons: [2026], terminal: true, external_manager_id: '55', selected_transaction_history: PUBLIC_TRANSACTION_HISTORY }]
      : statement.includes('read-lists') ? f.lists : statement.includes('read-candidates') ? f.candidates
        : statement.includes('read-transactions') ? f.rows : []);
    const result = await readPublicSleeperIntake({ enabled: true, query } as unknown as DatabaseClient, f.administration, id, { transactionHistoryPage: { limit: 1 } });
    expect(result).toMatchObject({ status: 'partial', reason: 'transaction-history-page-not-fully-verified',
      transactionHistory: { readCoverage: 'page', summary: { acquiredPeriods: 19 } }, transactions: [{ nativeWeek: 0 }] });
  });
});
