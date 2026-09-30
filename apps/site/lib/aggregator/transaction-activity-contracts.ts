import type { AdministrationProvenance, AdministrationScope, JsonObject, JsonValue } from '../league-administration/contracts';
import type { RetainedTransactionSelection, TransactionCapture } from '../league-administration/transaction-capture-contracts';
import type { SleeperTransaction } from '../transform';
import type { TransactionResult } from '../types';

export const TRANSACTION_ACTIVITY_VERSION = 'sleeper-transaction-activity-v1' as const;
export type ActivityFact<T> = Readonly<{
  state: 'known' | 'absent' | 'null' | 'invalid'; value: T | null;
  /** Exact parsed source value; no claim about JSON lexical number precision. */
  raw: JsonValue | null; sourcePath: string;
}>;
export type ActivityParticipant = Readonly<{
  id: string; externalRosterId: string; seasonTeamId: string | null;
  mappingEvidence: 'captured' | 'unverified' | 'unresolved';
}>;
export type ActivityPlayerMovement = Readonly<{
  player: { provider: 'sleeper'; nativeNamespace: 'nfl'; nativeId: string };
  direction: 'add' | 'drop'; team: ActivityParticipant;
}>;
export type ActivityPickMovement = Readonly<{
  season: number; round: number; originalTeam: ActivityParticipant;
  from: ActivityParticipant; to: ActivityParticipant;
}>;
export type ActivityBudgetMovement = Readonly<{ from: ActivityParticipant; to: ActivityParticipant; amount: number; unit: 'FAAB' }>;
export type TransactionActivityEvent = Readonly<{
  id: string; externalTransactionId: string; leagueSeasonId: string;
  nativeType: ActivityFact<string>; type: 'waiver' | 'trade' | 'free_agent' | 'other' | 'unknown';
  typeSupport: 'supported' | 'unsupported' | 'unknown'; nativeStatus: ActivityFact<string>; result: TransactionResult;
  createdAtMilliseconds: ActivityFact<number>; statusUpdatedAtMilliseconds: ActivityFact<number>;
  /** Existing presentation policy: positive valid status_updated, then created, otherwise unknown. */
  timestamp: string | null; calendarDay: string | null;
  participants: readonly ActivityParticipant[];
  rosterIds: ActivityFact<readonly string[]>; consenterIds: ActivityFact<readonly string[]>;
  adds: ActivityFact<readonly ActivityPlayerMovement[]>; drops: ActivityFact<readonly ActivityPlayerMovement[]>;
  picks: ActivityFact<readonly ActivityPickMovement[]>; budget: ActivityFact<readonly ActivityBudgetMovement[]>;
  claim: Readonly<{
    eligible: boolean; visibility: 'supplied-only'; losingClaimInventory: 'unknown';
    bid: number | null; unit: 'FAAB'; policy: 'settings-root-metadata-v1';
    bids: Readonly<{ settings: ActivityFact<number>; direct: ActivityFact<number>; metadata: ActivityFact<number> }>;
    notes: Readonly<Record<'notes' | 'note' | 'reason' | 'failure_reason', ActivityFact<string>>>;
  }>;
  /** Unknown supplied claim detail is retained with its native names, not interpreted as a losing bid. */
  settings: ActivityFact<JsonObject>; metadata: ActivityFact<JsonObject>;
  nativeExtensions: Readonly<{ provider: 'sleeper'; value: JsonObject }>;
  evidence: Readonly<{ captureId: string; observationId: string; contentId: string; week: number;
    sourceMappingRevisionId: string | null; provenance: AdministrationProvenance }>;
  limitations: readonly string[];
  /** Reconstructed from the typed facts, solely for the existing internal presenters. */
  compatibility: Readonly<{ sourceRow: SleeperTransaction }>;
}>;
export type TransactionWeekProjection = Readonly<{
  status: 'available'; version: typeof TRANSACTION_ACTIVITY_VERSION; captureId: string; leagueSeasonId: string;
  scope: AdministrationScope; week: number; source: AdministrationProvenance;
  mappingEvidence: 'captured' | 'unverified'; sourceCompleteness: 'complete' | 'partial';
  events: readonly TransactionActivityEvent[]; limitations: readonly string[];
  compatibility: Readonly<{ sourceRows: readonly SleeperTransaction[] }>;
}> | Readonly<{ status: 'unavailable'; reason: string }>;
export type TransactionActivityInput = Readonly<{
  selection: RetainedTransactionSelection; captures: readonly TransactionCapture[];
  failures?: readonly Readonly<{ week: number; checkedAt: string; reason: string }>[];
  /** Inclusive from, exclusive to; native weeks remain explicit and never imply NFL periods. */
  window?: Readonly<{ from: string | null; to: string | null }>;
}>;
export type TransactionActivityRequest = Readonly<{
  limit?: number; cursor?: string | null; teamId?: string; types?: readonly string[];
}>;
export type TransactionActivityPage = Readonly<{
  status: 'available'; version: typeof TRANSACTION_ACTIVITY_VERSION; revision: string;
  selection: RetainedTransactionSelection; window: Readonly<{ from: string | null; to: string | null }>;
  events: readonly TransactionActivityEvent[];
  sourceCoverage: Readonly<{ completeness: 'complete' | 'partial' | 'unknown';
    weeks: readonly Readonly<{ week: number; state: 'complete' | 'partial' | 'missing' | 'failed' | 'invalid' | 'conflict';
      selectedCaptureId: string | null; latestCaptureId: string | null; lastGood: boolean; reasons: readonly string[] }>[] }>;
  windowCoverage: Readonly<{ completeness: 'complete' | 'partial'; unknownTimestampEvents: number }>;
  pagination: Readonly<{ state: 'complete' | 'more'; nextCursor: string | null; total: number; limit: number }>;
  claimVisibility: Readonly<{ visibility: 'supplied-only'; losingClaimInventory: 'unknown' }>;
  conflicts: readonly Readonly<{ eventId: string; captureIds: readonly string[]; reason: 'equal_time_event_conflict' }>[];
  limitations: readonly string[];
  compatibility: Readonly<{ sourceRows: readonly SleeperTransaction[]; withheldEventIds: readonly string[] }>;
}> | Readonly<{ status: 'unavailable'; reason: string }>;
