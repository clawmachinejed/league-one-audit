/** Synthetic immutable source/display evidence, used only by B3 comparison tests. */
import type { AdministrationEnvelope, JsonValue } from '../league-administration/contracts';
import { normalizeAdministrationObservation } from '../league-administration/normalize';
import type { RetainedTransactionSelection, TransactionCapture } from '../league-administration/transaction-capture-contracts';
import type { SleeperTransaction } from '../transform';
import type { TransactionDisplayInput } from './transaction-activity-comparison';

export const transactionComparisonUuid = (value: number) => `00000000-0000-4000-8000-${String(value).padStart(12, '0')}`;
const scope = { leagueKey: 'league1', provider: 'sleeper' as const, externalLeagueId: 'comparison-source', season: 2026 };
export const transactionComparisonSelection: RetainedTransactionSelection = {
  leagueSeasonId: transactionComparisonUuid(1), scope, nativeWeeks: [0, 1, 2, 3],
};
export const transactionComparisonDisplay: TransactionDisplayInput = {
  leagueSeasonId: transactionComparisonUuid(1), leagueKey: 'league1',
  teams: [1, 2, 3].map((id, index) => ({ id, name: ['Alpha', 'Beta', 'Gamma'][index], managerName: `Manager ${id}`,
    avatar: null, wins: 0, losses: 0, ties: 0, pointsFor: 0, pointsAgainst: null })),
  catalog: { p1: { full_name: 'Player One', position: 'WR', team: 'IND' },
    p2: { full_name: 'Player Two', position: 'RB', team: 'SEA' },
    p3: { full_name: 'Player Three', position: 'TE', team: 'BUF' } },
  managerRosterIds: [3, 1, 2],
  teamsObservation: { observationId: transactionComparisonUuid(4), observedAt: '2026-12-02T12:00:00.123456Z' },
  catalogObservation: { observationId: transactionComparisonUuid(5), observedAt: '2026-12-02T12:00:01.654321Z' },
};
export const transactionComparisonTime = Date.parse('2026-09-09T12:00:00Z');
export function comparisonTransaction(overrides: Partial<SleeperTransaction> = {}): SleeperTransaction {
  return { transaction_id: 't1', type: 'waiver', status: 'complete', created: transactionComparisonTime,
    status_updated: transactionComparisonTime, roster_ids: [1], consenter_ids: [1], adds: { p1: 1 },
    settings: { waiver_bid: 10 }, ...overrides };
}
export function transactionComparisonCapture(rows: SleeperTransaction[], index = 10, week = 0,
  completeness: 'complete' | 'partial' = 'complete'): TransactionCapture {
  const envelope: AdministrationEnvelope = {
    schemaVersion: 'league-administration-v1', normalizerVersion: 'sleeper-administration-v1', dialect: 'sleeper-nfl-v1',
    scope, family: 'transactions', week, completeness,
    provenance: { origin: 'network', requestStartedAt: '2026-12-01T11:59:59.123456Z',
      requestCompletedAt: '2026-12-01T12:00:00.123456Z', sourceObservedAt: '2026-12-01T12:00:00.123456Z',
      checkedAt: '2026-12-01T12:00:00.654321Z' },
    payload: rows as unknown as JsonValue,
  };
  const normalized = normalizeAdministrationObservation(envelope);
  if (normalized.status !== 'accepted') throw new Error(`Invalid comparison fixture: ${JSON.stringify(normalized.diagnostics)}`);
  return { captureId: transactionComparisonUuid(index), captureKind: 'original-observation',
    leagueSeasonId: transactionComparisonSelection.leagueSeasonId, observationId: transactionComparisonUuid(index),
    contentId: transactionComparisonUuid(index + 100), week, envelope, contentHash: normalized.contentHash,
    semanticHash: normalized.semanticHash, normalizedValue: normalized.value as unknown as JsonValue,
    accepted: completeness === 'complete', outcome: 'changed', orderingAt: '2026-12-01T12:00:00.123456Z',
    recordedAt: '2026-12-01T12:00:00.654321Z', mapping: null,
    seasonTeams: [1, 2, 3].map(id => ({ seasonTeamId: transactionComparisonUuid(id + 10_000), externalRosterId: String(id) })),
    receipt: null };
}
