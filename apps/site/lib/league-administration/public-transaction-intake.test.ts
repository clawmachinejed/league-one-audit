import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DatabaseClient } from '../database';
import { capturePublicSleeperCore } from '../sleeper';
import { createLeagueAdministrationStore } from './store';
import { createPublicIntakeStore } from './neon/public-intake';
import { runPublicIntakeStep, type PublicIntakeDependencies } from './public-intake';
import { validatePublicIntake, type PublicIntakeStore } from './public-intake-contracts';
import { readPublicTransactions } from './public-transaction-reader';
import { readPublicSleeperIntake } from './public-intake-reader';
import { normalizeAdministrationObservation } from './normalize';
import { parsePublicCaptureWitness } from './public-capture-witness';
import { TRANSACTIONS_POLICY, transactionsScope, type TransactionCapture } from './transaction-capture-contracts';
import type { PublicCaptureWitness } from './contracts';
import type { LeagueAdministrationStore } from './store-contracts';

vi.mock('server-only', () => ({}));
vi.mock('next/cache', () => ({ unstable_cache: (fn: unknown) => fn }));
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
const id = randomUUID(), native = '98765432109876543210', time = '2026-10-13T12:00:00.000Z';
const mapping = { connectionId: randomUUID(), leagueSeasonId: randomUUID(), revisionId: randomUUID(), generation: 1,
  scope: { leagueKey: 'unrelated-cp14-unit', provider: 'sleeper' as const, externalLeagueId: native, season: 2026 } };
const input = { id, username: 'cp14_manager', seasons: [2026] };
const period = { season: 2026 as const, nativeWeek: 0 };
const work = { requestId: id, revision: 3, kind: 'transactions' as const, externalLeagueId: native, ...period };
const payload = [{ transaction_id: '98765432109876543219', type: 'waiver', status: 'failed', roster_ids: [1],
  adds: { '12345': 1 }, drops: null, settings: { waiver_bid: 0 }, created: 0, status_updated: 1791806400123 }];
function fixture() {
  const events: string[] = [];
  let reserved = '';
  const fetch = vi.fn(async () => { events.push('get'); return new Response(JSON.stringify(payload)); });
  vi.stubGlobal('fetch', fetch);
  const observationId = randomUUID(), receiptId = randomUUID();
  const intake: PublicIntakeStore = { submit: vi.fn(), recover: vi.fn(), next: vi.fn(async () => work), admit: vi.fn(async () => true),
    recordIdentity: vi.fn(), recordLeagues: vi.fn(), register: vi.fn(), completeCore: vi.fn(), completeExactPeriod: vi.fn(),
    completeTransactions: vi.fn(async () => undefined), fail: vi.fn(async () => undefined),
    captureWitness: vi.fn(async (selected, selectedMapping, fence): Promise<PublicCaptureWitness> => {
      events.push('witness');
      return { version: 'public-network-capture-v1', work: selected, mapping: selectedMapping, fence,
        dispatchNonce: randomUUID(), attempts: { transactions: { id: reserved, nonce: randomUUID() } } };
    }) };
  const administration = { ...createLeagueAdministrationStore({ enabled: false, reason: 'missing-database-url' }), enabled: true,
    readSourceMapping: vi.fn(async () => mapping),
    beginTransactionAttempt: vi.fn<LeagueAdministrationStore['beginTransactionAttempt']>(async (_mapping, _week, attemptId) => {
      events.push('reserve'); reserved = attemptId;
      return { id: attemptId, scopeId: randomUUID(), ordinal: 1, expectedGeneration: 0 };
    }),
    recordObservation: vi.fn<LeagueAdministrationStore['recordObservation']>(async normalized => {
      events.push('write');
      return { status: normalized.status === 'accepted' ? 'changed' : 'rejected', observationId,
        transactionAcceptance: { status: normalized.status === 'accepted' ? 'accepted' : 'preserved', receiptId, acceptedGeneration: 1 } };
    }) } satisfies LeagueAdministrationStore;
  const jobs = { acquireJob: vi.fn(async () => ({ kind: 'acquired' as const, attempt: 1, leaseUntil: new Date(Date.now() + 25_000).toISOString() })),
    completeJob: vi.fn(async () => true), failJob: vi.fn(async () => true) };
  const dependencies: PublicIntakeDependencies = { intake, administration, jobs };
  return { events, fetch, intake, administration, dependencies, observationId, receiptId,
    run: () => runPublicIntakeStep(id, dependencies, new AbortController().signal) };
}

describe('one explicit 2026 transaction period', () => {
  it('preserves omitted wire identity and admits Week 0 and 18 alongside existing independent resources', () => {
    expect(validatePublicIntake(input)).toEqual(input);
    for (const nativeWeek of [0, 18]) {
      expect(validatePublicIntake({ ...input, transactionPeriod: { ...period, nativeWeek }, exactPeriods: [{ season: 2026, nativeWeek: 3 }] }))
        .toMatchObject({ transactionPeriod: { season: 2026, nativeWeek } });
    }
  });
  it.each([null, false, [], [period], {}, { ...period, nativeWeek: -1 }, { ...period, nativeWeek: 19 },
    { ...period, nativeWeek: 0.5 }, { ...period, nativeWeek: '0' }, { ...period, season: 2025 }, { ...period, extra: true }])(
    'rejects a malformed or broader period selector: %j', transactionPeriod => {
      expect(() => validatePublicIntake({ ...input, transactionPeriod } as never)).toThrow();
    });
  it.each([[2025], [2025, 2026], [2026, 2027]].map(seasons => ({ seasons })))('rejects season scope $seasons', ({ seasons }) => {
    expect(() => validatePublicIntake({ ...input, seasons, transactionPeriod: period })).toThrow();
  });
  it('checks R051 before any selected submission and leaves omitted submissions compatible', async () => {
    const query = vi.fn(async () => [{ supported: false }]);
    const store = createPublicIntakeStore({ enabled: true, query } as unknown as DatabaseClient);
    await expect(store.submit({ ...input, transactionPeriod: period })).rejects.toThrow('R051');
    expect(query).toHaveBeenCalledOnce();
    await store.submit(input);
    expect(query).toHaveBeenLastCalledWith(expect.stringContaining('public-data-intake:submit'), [JSON.stringify(input)]);
  });
  it('validates SQL-selected transaction work and passes exact checkpoint receipts', async () => {
    const query = vi.fn(async () => [{ result: work }]);
    const store = createPublicIntakeStore({ enabled: true, query } as unknown as DatabaseClient);
    expect(await store.next(id)).toEqual(work);
    query.mockResolvedValue([{ result: { ...work, nativeWeek: -1 } }]);
    await expect(store.next(id)).rejects.toThrow('Invalid public transaction work');
  });
});

describe('ordinary transaction acquisition and existing writer composition', () => {
  it('reserves and witnesses before one uncached GET, preserves native values and checkpoints the same receipt', async () => {
    const f = fixture();
    expect(await f.run()).toEqual({ status: 'progress', resource: 'transactions', providerRequests: 1 });
    expect(f.events).toEqual(['reserve', 'witness', 'get', 'write']);
    expect(f.fetch).toHaveBeenCalledOnce();
    const call = f.administration.recordObservation.mock.calls[0];
    expect(call[0]).toMatchObject({ status: 'accepted', envelope: { payload, week: 0, family: 'transactions' } });
    expect(call[2]).toEqual(mapping);
    expect(call[9]?.attempt.id).toBe(call[0].envelope.provenance.acquisition?.attempts.transactions.id);
    expect(f.intake.completeTransactions).toHaveBeenCalledExactlyOnceWith(work, mapping,
      { observations: { transactions: f.observationId }, receipts: { transactions: f.receiptId } }, call[1]);
    expect(f.intake.fail).not.toHaveBeenCalled();
  });
  it.each(['captureWitness', 'completeTransactions'] as const)('makes no GET without required capability %s', async capability => {
    const f = fixture();
    expect(await runPublicIntakeStep(id, { ...f.dependencies, intake: { ...f.intake, [capability]: undefined } }, new AbortController().signal))
      .toMatchObject({ status: 'unavailable', providerRequests: 0 });
    expect(f.fetch).not.toHaveBeenCalled();
  });
  it('retains malformed evidence without completing or borrowing the accepted head', async () => {
    const f = fixture(); f.fetch.mockResolvedValue(new Response(JSON.stringify([{ transaction_id: 42 }])));
    expect(await f.run()).toMatchObject({ status: 'unavailable', providerRequests: 1 });
    expect(f.administration.recordObservation).toHaveBeenCalledOnce();
    expect(f.administration.recordObservation.mock.calls[0][0].status).toBe('rejected');
    expect(f.intake.completeTransactions).not.toHaveBeenCalled(); expect(f.intake.fail).toHaveBeenCalledOnce();
  });
  it('refuses preserved acceptance and performs no implicit HTTP retry', async () => {
    const f = fixture();
    f.administration.recordObservation.mockResolvedValue({ status: 'unchanged', observationId: f.observationId,
      transactionAcceptance: { status: 'preserved', receiptId: f.receiptId, acceptedGeneration: 1 } });
    expect(await f.run()).toMatchObject({ status: 'unavailable', providerRequests: 1 });
    expect(f.intake.completeTransactions).not.toHaveBeenCalled(); expect(f.fetch).toHaveBeenCalledOnce();
  });
  it('rejects mismatched family, period and league witnesses before HTTP', async () => {
    const f = fixture(); await f.run(); f.fetch.mockClear();
    const witness = f.administration.recordObservation.mock.calls[0][0].envelope.provenance.acquisition!;
    expect(() => parsePublicCaptureWitness(witness)).not.toThrow();
    await expect(capturePublicSleeperCore(native, 'transactions', new AbortController().signal, 1, witness)).rejects.toThrow('scope mismatch');
    await expect(capturePublicSleeperCore('123', 'transactions', new AbortController().signal, 0, witness)).rejects.toThrow('scope mismatch');
    await expect(capturePublicSleeperCore(native, 'matchups', new AbortController().signal, 1, witness)).rejects.toThrow('scope mismatch');
    await expect(capturePublicSleeperCore(native, 'transactions', new AbortController().signal, -1, witness)).rejects.toThrow('Invalid public capture period');
    expect(f.fetch).not.toHaveBeenCalled();
  });
});

function readerFixture() {
  const workerId = randomUUID(), receiptId = randomUUID(), attemptId = randomUUID();
  const witness: PublicCaptureWitness = { version: 'public-network-capture-v1', work, mapping,
    fence: { jobKey: 'league-administration-public-intake', workerId, generation: 1, deadlineAt: time }, dispatchNonce: randomUUID(),
    attempts: { transactions: { id: attemptId, nonce: randomUUID() } } };
  const normalized = normalizeAdministrationObservation({ schemaVersion: 'league-administration-v1', normalizerVersion: 'sleeper-administration-v1',
    dialect: 'sleeper-nfl-v1', scope: mapping.scope, family: 'transactions', week: 0, completeness: 'complete', payload,
    provenance: { origin: 'network', requestStartedAt: time, requestCompletedAt: time, sourceObservedAt: time, checkedAt: time, acquisition: witness } });
  const capture: TransactionCapture = { captureId: receiptId, captureKind: 'receipt', leagueSeasonId: mapping.leagueSeasonId,
    observationId: randomUUID(), contentId: randomUUID(), week: 0, envelope: normalized.envelope,
    contentHash: normalized.contentHash, semanticHash: normalized.semanticHash, normalizedValue: normalized.value as TransactionCapture['normalizedValue'],
    accepted: true, outcome: 'changed', orderingAt: time, recordedAt: time, mapping, seasonTeams: [{ seasonTeamId: randomUUID(), externalRosterId: '1' }],
    receipt: { id: receiptId, attemptId, ordinal: 1, expectedGeneration: 0, acceptedGeneration: 1, provenance: normalized.envelope.provenance,
      coverage: { periodIds: ['sleeper:transaction-week:0'], interval: null, entitySet: 'full', fields: ['transaction_id'],
        pagination: 'complete', nextCursor: null, completeness: 'complete', reasons: [] } } };
  const rows = [{ ordinal: 1, season: 2026, external_league_id: native, native_week: 0, status: 'complete', failure_count: 0, reason: null,
    worker_id: workerId, generation: 1, league_season_id: mapping.leagueSeasonId, source_mapping: mapping,
    transaction_receipt_id: receiptId, recorded_at: time }];
  const candidates = [{ season: 2026, external_league_id: native, stage: 'complete' }];
  const query = vi.fn(async () => rows);
  const administration = { ...createLeagueAdministrationStore({ enabled: false, reason: 'missing-database-url' }), enabled: true,
    readSourceMapping: vi.fn(async () => mapping),
    readAcceptedTransactions: vi.fn<LeagueAdministrationStore['readAcceptedTransactions']>(async () => ({ status: 'available', capture,
      accepted: { scope: transactionsScope(mapping, 0), canonicalNormalizerVersion: TRANSACTIONS_POLICY.canonicalNormalizerVersion,
        sourceMappingRevisionId: mapping.revisionId, contentId: capture.contentId, observationIds: [receiptId],
        validationVersion: TRANSACTIONS_POLICY.validationVersion, acceptedGeneration: 1, verifiedAt: time,
        effectiveFrom: null, effectiveTo: null, effectiveEvidence: 'unknown' } })) };
  const client = { enabled: true, query } as unknown as DatabaseClient;
  return { rows, candidates, administration, client, query, witness, capture, run: () => readPublicTransactions(client, administration, id, candidates, period) };
}

describe('request-bound stored transaction facts', () => {
  it('composes exact receipt and native ID/status/zero bid/timestamps with provider access blocked', async () => {
    const f = readerFixture(), fetch = vi.fn(() => { throw new Error('provider forbidden'); }); vi.stubGlobal('fetch', fetch);
    const result = await f.run();
    expect(f.administration.readAcceptedTransactions).toHaveBeenCalledExactlyOnceWith(mapping, 0, { receiptId: f.capture.captureId });
    expect(result[0]).toMatchObject({ resource: { status: 'available', value: { status: 'available', events: [{
      externalTransactionId: payload[0].transaction_id, nativeStatus: { state: 'known', value: 'failed' },
      createdAtMilliseconds: { state: 'known', value: 0 }, statusUpdatedAtMilliseconds: { state: 'known', value: payload[0].status_updated },
      claim: { bid: 0 } }] } }, acquisition: { transactionReceiptId: f.capture.captureId } });
    expect(fetch).not.toHaveBeenCalled();
  });
  it.each(['request', 'worker', 'period', 'attempt', 'mapping'] as const)('rejects a foreign %s acquisition', async kind => {
    const f = readerFixture();
    if (kind === 'request') Object.assign(f.witness, { work: { ...work, requestId: randomUUID() } });
    if (kind === 'worker') Object.assign(f.witness, { fence: { ...f.witness.fence, workerId: randomUUID() } });
    if (kind === 'period') Object.assign(f.witness, { work: { ...work, nativeWeek: 1 } });
    if (kind === 'attempt') Object.assign(f.witness, { attempts: { transactions: { id: randomUUID(), nonce: randomUUID() } } });
    if (kind === 'mapping') Object.assign(f.witness, { mapping: { ...mapping, revisionId: randomUUID() } });
    const provenance = { ...f.capture.envelope.provenance, acquisition: f.witness };
    Object.assign(f.capture, { envelope: { ...f.capture.envelope, provenance }, receipt: { ...f.capture.receipt, provenance } });
    expect((await f.run())[0].resource.status).toBe('unavailable');
  });
  it('does not read accepted values for incomplete work or fabricate transactions for empty discovery', async () => {
    const f = readerFixture(); f.rows[0].status = 'pending';
    expect((await f.run())[0].resource).toEqual({ status: 'unavailable', reason: 'transaction-capture-not-complete' });
    expect(f.administration.readAcceptedTransactions).not.toHaveBeenCalled(); f.rows.length = 0; f.candidates.length = 0;
    expect(await f.run()).toEqual([]);
  });
  it('rejects mapping changes while a receipt is being read', async () => {
    const f = readerFixture(); f.administration.readSourceMapping.mockResolvedValueOnce(mapping).mockResolvedValue({ ...mapping, revisionId: randomUUID() });
    expect((await f.run())[0].resource.status).toBe('unavailable');
  });
  it('keeps the ordinary omitted reader shape and query set unchanged', async () => {
    const query = vi.fn(async (statement: string) => statement.includes('read-request') ? [{ id, seasons: [2026], terminal: false }] : []);
    const result = await readPublicSleeperIntake({ enabled: true, query } as unknown as DatabaseClient,
      createLeagueAdministrationStore({ enabled: false, reason: 'missing-database-url' }), id);
    expect(result).not.toHaveProperty('transactions');
    if (result.status === 'missing') throw new Error('Expected stored request');
    expect(result.coverage.notRequested).toContain('transactions');
    expect(query.mock.calls.some(call => call[0].includes('read-transactions'))).toBe(false);
  });
  it('ordinary composition exposes independently usable transactions without declaring incomplete core complete', async () => {
    const f = readerFixture();
    const query = vi.fn(async (statement: string) => statement.includes('read-request')
      ? [{ id, seasons: [2026], terminal: false, external_manager_id: '55', selected_transaction_period: period }]
      : statement.includes('read-lists') ? [{ season: 2026 }]
        : statement.includes('read-candidates') ? f.candidates
          : statement.includes('read-transactions') ? f.rows : []);
    const result = await readPublicSleeperIntake({ enabled: true, query } as unknown as DatabaseClient, f.administration, id);
    expect(result).toMatchObject({ status: 'pending', transactions: [{ resource: { status: 'available' } }] });
    if (result.status === 'missing') throw new Error('Expected stored request');
    expect(result.coverage.requested).toContain('transactions'); expect(result.coverage.notRequested).not.toContain('transactions');
  });
});
