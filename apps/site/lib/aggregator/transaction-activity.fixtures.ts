import type { AdministrationEnvelope, JsonValue } from '../league-administration/contracts';
import { normalizeAdministrationObservation } from '../league-administration/normalize';
import type { TransactionCapture } from '../league-administration/transaction-capture-contracts';

export const activityId = (n: number) => `10000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
export const activityScope = { provider: 'sleeper' as const, leagueKey: 'league1', externalLeagueId: 'source-2026', season: 2026 };
export function activityCapture(rows: JsonValue = [], options: {
  id?: number; week?: number; at?: string; completeness?: 'complete' | 'partial';
} = {}): TransactionCapture {
  const id = options.id ?? 1; const at = options.at ?? '2026-09-30T12:00:00.000Z';
  const envelope: AdministrationEnvelope = { schemaVersion: 'league-administration-v1', normalizerVersion: 'sleeper-administration-v1',
    dialect: 'sleeper-nfl-v1', scope: activityScope, family: 'transactions', week: options.week ?? 0,
    completeness: options.completeness ?? 'complete', payload: rows,
    provenance: { origin: 'network', requestStartedAt: at, requestCompletedAt: at, sourceObservedAt: at, checkedAt: at } };
  const normalized = normalizeAdministrationObservation(envelope);
  return { captureId: activityId(id), captureKind: 'original-observation', leagueSeasonId: activityId(90),
    observationId: activityId(id), contentId: activityId(id + 100), envelope, week: envelope.week!,
    contentHash: normalized.contentHash, semanticHash: normalized.semanticHash,
    normalizedValue: normalized.value as unknown as JsonValue, accepted: normalized.status === 'accepted' && envelope.completeness === 'complete',
    outcome: normalized.status === 'accepted' ? 'changed' : 'rejected', orderingAt: at, recordedAt: at,
    mapping: null, receipt: null, seasonTeams: [1, 2, 3].map(n => ({ seasonTeamId: activityId(n + 900), externalRosterId: String(n) })) };
}
