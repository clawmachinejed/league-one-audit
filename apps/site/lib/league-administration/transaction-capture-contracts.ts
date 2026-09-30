import type { AcceptedResource, ObservedCoverage, SourceScope } from '../aggregator/contracts';
import type { AdministrationEnvelope, AdministrationScope, JsonValue } from './contracts';
import type { AdministrationSourceMapping } from './source-mapping';

export const TRANSACTIONS_POLICY = Object.freeze({ audienceId: 'public',
  coverageSpecId: 'sleeper-native-week-transactions-v1', canonicalNormalizerVersion: 'sleeper-transactions-v1',
  validationVersion: 'latest-network-attempt-v1' });
export const RETAINED_TRANSACTION_INVENTORY_LIMIT = 1_000;
export const RETAINED_TRANSACTION_BATCH_LIMIT = 100;

export function transactionsScope(mapping: AdministrationSourceMapping, week: number): SourceScope {
  if (!Number.isInteger(week) || week < 0 || week > 18) throw new Error('Invalid native transaction week.');
  return { kind: 'enrolled-resource', connectionId: mapping.connectionId, leagueSeasonId: mapping.leagueSeasonId,
    family: 'transactions', entityId: null, scoringPeriodId: `sleeper:transaction-week:${week}`,
    audienceId: TRANSACTIONS_POLICY.audienceId, coverageSpecId: TRANSACTIONS_POLICY.coverageSpecId };
}

/** Receipt acquisitions and original v1 observations have distinct capture identities/times. */
export type TransactionCapture = Readonly<{
  captureId: string; captureKind: 'receipt' | 'original-observation'; leagueSeasonId: string;
  observationId: string; contentId: string; week: number; envelope: AdministrationEnvelope;
  contentHash: string; semanticHash: string | null; normalizedValue: JsonValue | null;
  accepted: boolean; outcome: string; orderingAt: string; recordedAt: string;
  /** Null is unverified historical mapping, never today's mapping substituted for proof. */
  mapping: AdministrationSourceMapping | null;
  seasonTeams: readonly Readonly<{ seasonTeamId: string; externalRosterId: string }>[];
  receipt: Readonly<{ id: string; attemptId: string; ordinal: number; expectedGeneration: number;
    provenance: AdministrationEnvelope['provenance']; coverage: ObservedCoverage;
    acceptedGeneration: number | null }> | null;
}>;
export type AcceptedTransactionsRead = Readonly<{ status: 'available'; capture: TransactionCapture; accepted: AcceptedResource }>
  | Readonly<{ status: 'missing' | 'disabled' | 'unavailable'; reason?: string }>;
export type RetainedTransactionSelection = Readonly<{
  leagueSeasonId: string; scope: AdministrationScope; nativeWeeks: readonly number[];
}>;
export type RetainedTransactionRead = Readonly<{ status: 'available'; captures: readonly TransactionCapture[] }>
  | Readonly<{ status: 'disabled' | 'unavailable'; reason: string }>;

export function isTransactionCaptureId(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/u.test(value);
}
export function isRetainedTransactionSelection(value: RetainedTransactionSelection): boolean {
  const scope = value?.scope;
  return isTransactionCaptureId(value?.leagueSeasonId) && !!scope && scope.provider === 'sleeper'
    && [scope.leagueKey, scope.externalLeagueId].every(text => typeof text === 'string' && text.length > 0
      && text.trim() === text && !/[\x00-\x1f\x7f]/u.test(text))
    && Number.isInteger(scope.season) && scope.season >= 1920 && scope.season <= 2200
    && Array.isArray(value.nativeWeeks) && value.nativeWeeks.length > 0 && value.nativeWeeks.length <= 19
    && value.nativeWeeks.every((week, index) => Number.isInteger(week) && week >= 0 && week <= 18
      && (index === 0 || value.nativeWeeks[index - 1] < week));
}
