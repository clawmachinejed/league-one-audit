import { describe, expect, it } from 'vitest';
import type { AdministrationEnvelope, JsonValue } from '../league-administration/contracts';
import { normalizeAdministrationObservation } from '../league-administration/normalize';
import type { TransactionCapture } from '../league-administration/transaction-capture-contracts';
import { buildTransactionActivity, projectTransactionCapture } from './transaction-activity';
import { compareTransactionActivity } from './transaction-activity-comparison';
import { transactionComparisonDisplay } from './transaction-activity-comparison.fixtures';

const uuid = (id: number) => `00000000-0000-4000-8000-${String(id).padStart(12, '0')}`;
const scope = { provider: 'sleeper' as const, externalLeagueId: 'review-source', leagueKey: 'league1', season: 2026 };
const selection = { leagueSeasonId: uuid(1), scope, nativeWeeks: [0] };
const row = (id: string) => ({ transaction_id: id, type: 'waiver', status: 'complete', roster_ids: [1],
  created: Date.parse('2026-09-09T12:00:00Z'), settings: { waiver_bid: 0 } });
function capture(payload: JsonValue, id = 10, provenance?: AdministrationEnvelope['provenance']): TransactionCapture {
  const envelope: AdministrationEnvelope = { schemaVersion: 'league-administration-v1', normalizerVersion: 'sleeper-administration-v1',
    dialect: 'sleeper-nfl-v1', family: 'transactions', week: 0, scope, completeness: 'complete', payload,
    provenance: provenance ?? { origin: 'network', requestStartedAt: '2026-09-09T12:00:00.000001Z',
      requestCompletedAt: '2026-09-09T12:00:00.000002Z', sourceObservedAt: '2026-09-09T12:00:00.000002Z',
      checkedAt: '2026-09-09T12:00:00.000003Z' } };
  const normalized = normalizeAdministrationObservation(envelope);
  return { captureId: uuid(id), captureKind: 'original-observation', leagueSeasonId: selection.leagueSeasonId,
    observationId: uuid(id), contentId: uuid(id + 100), week: 0, envelope,
    contentHash: normalized.contentHash, semanticHash: normalized.semanticHash, normalizedValue: normalized.value as unknown as JsonValue,
    accepted: normalized.status === 'accepted', outcome: 'changed', orderingAt: envelope.provenance.sourceObservedAt!,
    recordedAt: envelope.provenance.checkedAt, mapping: null, receipt: null,
    seasonTeams: [{ seasonTeamId: uuid(1000), externalRosterId: '1' }] };
}

describe('independent transaction activity evidence review', () => {
  it('preserves released equal-time raw-content conflict policy even when source set order alone changes', () => {
    const first = capture([row('one'), row('two')]);
    const reordered = capture([row('two'), row('one')], 11);
    expect(first.contentHash).not.toBe(reordered.contentHash);
    expect(first.semanticHash).toBe(reordered.semanticHash);
    const result = buildTransactionActivity({ selection, captures: [first, reordered] });
    expect(result.status).toBe('available');
    if (result.status !== 'available') return;
    // The existing administration writer rejects different content IDs at the exact same source time.
    expect(result.sourceCoverage.weeks[0].state).toBe('conflict');
    expect(result.events).toHaveLength(0);
  });

  it('rejects a source request whose exact microsecond completion predates its start', () => {
    const source = capture([row('one')], 10, { origin: 'network',
      requestStartedAt: '2026-09-09T12:00:00.000003Z', requestCompletedAt: '2026-09-09T12:00:00.000002Z',
      sourceObservedAt: '2026-09-09T12:00:00.000002Z', checkedAt: '2026-09-09T12:00:00.000004Z' });
    expect(projectTransactionCapture(source).status).toBe('unavailable');
  });

  it('projects normalization-valid partial captures using the real stored acceptance meaning', () => {
    const source = capture([row('one')]);
    const partial: TransactionCapture = { ...source, accepted: false, envelope: { ...source.envelope, completeness: 'partial' } };
    const result = buildTransactionActivity({ selection, captures: [partial] });
    expect(result.status).toBe('available');
    if (result.status !== 'available') return;
    expect(result.sourceCoverage.weeks[0].state).toBe('partial');
    expect(result.events).toHaveLength(1);
  });

  it('applies the same exact submillisecond window to the legacy and resource comparison', () => {
    const result = compareTransactionActivity({ selection, captures: [capture([row('one')])],
      window: { from: '2026-09-09T12:00:00.000001Z', to: null } }, transactionComparisonDisplay);
    expect(result.status).toBe('available');
    if (result.status !== 'available') return;
    expect(result.outputPagination.count).toBe(0);
    expect(result.comparison.status).toBe('equal');
  });

  it('retains native proto-named extensions as data without inventing inherited bids', () => {
    const payload = JSON.parse('[{"transaction_id":"one","type":"waiver","__proto__":{"waiver_bid":99}}]') as JsonValue;
    const result = projectTransactionCapture(capture(payload));
    expect(result.status).toBe('available');
    if (result.status !== 'available') return;
    expect(result.events[0].claim.bids.direct.state).toBe('absent');
    expect(result.events[0].claim.bid).toBeNull();
    expect(Object.hasOwn(result.events[0].compatibility.sourceRow, '__proto__')).toBe(true);
    expect(result.events[0].nativeExtensions.value.__proto__).toEqual({ waiver_bid: 99 });
  });
});
