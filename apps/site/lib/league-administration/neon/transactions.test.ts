import { describe, expect, it, vi } from 'vitest';
import type { DatabaseClient, DatabaseRow } from '../../database';
import { normalizeAdministrationObservation } from '../normalize';
import { createLeagueAdministrationStore } from '../store';
import { TRANSACTIONS_POLICY, transactionsScope, type TransactionCapture, type RetainedTransactionSelection } from '../transaction-capture-contracts';
import { ACCEPTED_TRANSACTIONS_SQL, RETAINED_TRANSACTION_READ_SQL, RETAINED_TRANSACTION_SCAN_SQL, transactionMethods } from './transactions';
import { projectTransactionCapture } from '../../aggregator/transaction-activity';

vi.mock('server-only', () => ({}));
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const at = '2026-09-29T12:00:00.123Z';
const mapping = { connectionId: id(1), leagueSeasonId: id(2), revisionId: id(3), generation: 1,
  scope: { leagueKey: 'league1', provider: 'sleeper' as const, externalLeagueId: 'original', season: 2026 } };
const selection: RetainedTransactionSelection = { leagueSeasonId: mapping.leagueSeasonId, scope: mapping.scope, nativeWeeks: [0, 18] };
function database(query: (sql: string, params: readonly unknown[]) => readonly DatabaseRow[]): DatabaseClient {
  return { enabled: true, async query<Row extends DatabaseRow>(sql: string, params: readonly unknown[] = []) {
    return query(sql, params) as readonly Row[];
  } };
}
function fixture(): TransactionCapture {
  const normalized = normalizeAdministrationObservation({ schemaVersion: 'league-administration-v1', normalizerVersion: 'sleeper-administration-v1',
    dialect: 'sleeper-nfl-v1', scope: mapping.scope, family: 'transactions', week: 0, completeness: 'complete', payload: [],
    provenance: { origin: 'network', requestStartedAt: at, requestCompletedAt: at, sourceObservedAt: at, checkedAt: at } });
  return { captureId: id(4), captureKind: 'receipt', leagueSeasonId: mapping.leagueSeasonId, observationId: id(5), contentId: id(6),
    week: 0, envelope: normalized.envelope, contentHash: normalized.contentHash, semanticHash: normalized.semanticHash,
    normalizedValue: normalized.value as TransactionCapture['normalizedValue'], accepted: true, outcome: 'changed', orderingAt: at,
    recordedAt: at, mapping, seasonTeams: [], receipt: { id: id(4), attemptId: id(7), ordinal: 1, expectedGeneration: 0,
      provenance: normalized.envelope.provenance, acceptedGeneration: 1, coverage: { periodIds: ['sleeper:transaction-week:0'], interval: null,
        entitySet: 'full', fields: ['transaction_id'], pagination: 'complete', nextCursor: null, completeness: 'complete', reasons: [] } } };
}
const acceptedRow = (capture: TransactionCapture) => [{ capture, identity: { scope: transactionsScope(mapping, 0), policy: TRANSACTIONS_POLICY },
  source_mapping_revision_id: mapping.revisionId }];

describe('transaction storage boundary', () => {
  it('accepts a mapped complete empty Week 0 without inventing a roster population requirement', async () => {
    const source = fixture(); const query = vi.fn(() => acceptedRow(source));
    const read = await transactionMethods(database(query)).readAcceptedTransactions(mapping, 0);
    expect(read).toMatchObject({ status: 'available', capture: source, accepted: { verifiedAt: at, observationIds: [source.receipt!.id] } });
    expect(query).toHaveBeenCalledExactlyOnceWith(ACCEPTED_TRANSACTIONS_SQL,
      [JSON.stringify({ scope: transactionsScope(mapping, 0), policy: TRANSACTIONS_POLICY }), mapping.revisionId, 1, 0]);
  });
  it.each([
    (c: TransactionCapture) => ({ ...c, mapping: null }),
    (c: TransactionCapture) => ({ ...c, mapping: { ...mapping, revisionId: id(90) } }),
    (c: TransactionCapture) => ({ ...c, contentHash: 'wrong' }),
    (c: TransactionCapture) => ({ ...c, normalizedValue: null }),
    (c: TransactionCapture) => ({ ...c, captureKind: 'original-observation' as const }),
    (c: TransactionCapture) => ({ ...c, receipt: { ...c.receipt!, coverage: { ...c.receipt!.coverage, completeness: 'partial' as const } } }),
    (c: TransactionCapture) => ({ ...c, seasonTeams: [{ seasonTeamId: id(8), externalRosterId: '1' }, { seasonTeamId: id(9), externalRosterId: '1' }] }),
  ])('fails closed on mismatched accepted lineage', async mutate => {
    const read = await transactionMethods(database(() => acceptedRow(mutate(fixture())))).readAcceptedTransactions(mapping, 0);
    expect(read).toEqual({ status: 'unavailable', reason: 'transaction_evidence_unavailable' });
  });
  it('keeps missing and database-failed current reads distinct', async () => {
    expect(await transactionMethods(database(() => [])).readAcceptedTransactions(mapping, 18)).toEqual({ status: 'missing' });
    expect(await transactionMethods(database(() => { throw Error('offline'); })).readAcceptedTransactions(mapping, 18))
      .toEqual({ status: 'unavailable', reason: 'transaction_evidence_unavailable' });
  });
  it('validates native reservation bounds and the returned attempt before any acquisition', async () => {
    const query = vi.fn(() => [{ result: { id: id(7), scopeId: id(8), ordinal: 2, expectedGeneration: 1 } }]);
    const store = transactionMethods(database(query));
    expect(await store.beginTransactionAttempt(mapping, 0, id(7))).toEqual({ id: id(7), scopeId: id(8), ordinal: 2, expectedGeneration: 1 });
    await expect(store.beginTransactionAttempt(mapping, -1, id(7))).rejects.toThrow('Invalid native transaction week');
    await expect(store.beginTransactionAttempt(mapping, 19, id(7))).rejects.toThrow('Invalid native transaction week');
    expect(query).toHaveBeenCalledTimes(1);
    await expect(transactionMethods(database(() => [{ result: { id: id(9) } }])).beginTransactionAttempt(mapping, 0, id(7)))
      .rejects.toThrow('Invalid transaction reservation');
  });
  it('retains unverified original observation mapping independently from a later mapped receipt', async () => {
    const source = { ...fixture(), captureId: id(5), captureKind: 'original-observation' as const, mapping: null, receipt: null };
    const query = vi.fn(() => [{ selection_valid: true, captures: [source] }]);
    const store = transactionMethods(database(query));
    expect(await store.scanRetainedTransactions(selection)).toEqual({ status: 'available', captures: [source] });
    expect(query).toHaveBeenCalledWith(RETAINED_TRANSACTION_SCAN_SQL, [id(2), [0, 18], 'sleeper', 'original', 'league1', 2026]);
    expect(await store.readRetainedTransactions(selection, [id(5)])).toEqual({ status: 'available', captures: [source] });
    expect(query).toHaveBeenLastCalledWith(RETAINED_TRANSACTION_READ_SQL, [id(2), [0, 18], [id(5)], 'league1', 2026, 'sleeper', 'original']);
    expect(RETAINED_TRANSACTION_SCAN_SQL).toContain("candidate.provenance->>'sourceObservedAt'");
    expect(RETAINED_TRANSACTION_SCAN_SQL).not.toContain('current_mapping_revision_id');
  });
  it('refuses oversized inventory and malformed or cross-season selections, never truncating silently', async () => {
    const query = vi.fn(() => [{ selection_valid: true, captures: Array(1_001).fill(fixture()) }]);
    const store = transactionMethods(database(query));
    expect(await store.scanRetainedTransactions(selection)).toMatchObject({ status: 'unavailable', reason: 'retained_transaction_limit_exceeded' });
    for (const nativeWeeks of [[], [18, 0], [0, 0], [-1], [19]]) {
      expect(await store.scanRetainedTransactions({ ...selection, nativeWeeks })).toMatchObject({ status: 'unavailable', reason: 'invalid_retained_transaction_selection' });
    }
    expect(await store.readRetainedTransactions(selection, [id(4), id(4)])).toMatchObject({ status: 'unavailable' });
    expect(await store.readRetainedTransactions(selection, [])).toEqual({ status: 'available', captures: [] });
    expect(query).toHaveBeenCalledTimes(1);
    expect(await transactionMethods(database(() => [{ selection_valid: false, captures: [] }])).scanRetainedTransactions(selection))
      .toEqual({ status: 'unavailable', reason: 'retained_transaction_scope_mismatch' });
  });
  it('disabled facade neither validates inputs nor constructs a database client', async () => {
    const store = createLeagueAdministrationStore({ enabled: false, reason: 'preview-persistence-disabled' });
    expect(await store.readAcceptedTransactions(mapping, -1)).toEqual({ status: 'disabled' });
    expect(await store.scanRetainedTransactions(selection)).toEqual({ status: 'disabled', reason: 'persistence_disabled' });
    expect(await store.readRetainedTransactions(selection, ['malformed'])).toEqual({ status: 'disabled', reason: 'persistence_disabled' });
    await expect(store.beginTransactionAttempt(mapping, 0, id(7))).rejects.toThrow('Administration persistence disabled');
  });
  it('projects a fresh accepted receipt at its capture time even when the linked original observation is older', async () => {
    const source = fixture();
    const observedAt = '2026-09-29T13:00:00.123Z';
    const provenance = { ...source.envelope.provenance, sourceObservedAt: observedAt,
      requestStartedAt: observedAt, requestCompletedAt: observedAt, checkedAt: observedAt };
    const fresh = { ...source, orderingAt: observedAt, recordedAt: observedAt, envelope: { ...source.envelope, provenance },
      receipt: { ...source.receipt!, provenance } };
    const read = await transactionMethods(database(() => acceptedRow(fresh))).readAcceptedTransactions(mapping, 0);
    expect(read.status).toBe('available');
    if (read.status !== 'available') throw new Error('Missing fixture capture.');
    expect(projectTransactionCapture(read.capture).status).toBe('available');
    expect(ACCEPTED_TRANSACTIONS_SQL).toContain("'orderingAt',COALESCE(receipt.provenance->>'sourceObservedAt'");
    expect(RETAINED_TRANSACTION_SCAN_SQL).toContain("'orderingAt',to_char(observation.ordering_at");
  });
});
