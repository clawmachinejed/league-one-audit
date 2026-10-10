import type { RosterPlayerLinksSelection, RosterPlayerLinksRead } from '../aggregator/roster-player-links';
import type { PlayerDirectoryAttempt, PlayerDirectoryCapture, PlayerDirectoryRead, PlayerDirectoryReadSelection,
  PlayerDirectoryReservation, PlayerDirectoryWriteResult } from './player-directory-contracts';
import type { SleeperCalendarEvidence } from './period-mapping';
import type { CalculationSourceCapture } from './calculation-capture';
import type { AdministrationEnvelope, AdministrationFamily, AdministrationScope, AdministrationWriteFence,
  NormalizedAdministrationObservation } from './contracts';
import type { RetainedRosterProjection } from '../aggregator/roster-bridge';
import type { AdministrationSourceMapping } from './source-mapping';
import type { AcceptedTeamManagersRead, AcceptedTeamManagerEvidenceRead, RosterCaptureAttempts,
  ManagerDirectoryCaptureRead } from '../aggregator/team-managers';
import type { AcceptedLeagueSettingsRead } from '../aggregator/league-settings';
import type { AcceptedExactMatchupsRead } from '../aggregator/exact-matchups';
import type { AcceptedCurrentRosterRead, CurrentRosterPolicy, RosterAcceptanceInput,
  RosterAcceptanceResult, RosterAttempt } from '../aggregator/current-roster';
import type { CurrentRosterReadOptions } from '../aggregator/current-roster-metadata';
import type { RetainedMatchupRead, RetainedMatchupSelection } from './retained-matchups-contracts';
import type { AcceptedTransactionsRead, RetainedTransactionRead, RetainedTransactionSelection } from './transaction-capture-contracts';

export type AdministrationReadInput = AdministrationScope & Readonly<{
  family: AdministrationFamily; week: number | null;
}>;
export type AdministrationConnectionReadInput = Readonly<{
  provider: 'sleeper'; externalLeagueId: string; family: AdministrationFamily; week: number | null;
}>;
export type LeagueAdministrationStoreRead =
  | Readonly<{ status: 'available'; envelope: AdministrationEnvelope;
    observationId: string; versionId: string | null; generation: number; checkedAt: string; verifiedAt: string | null;
    /** Internal comparison only; never a v2 accepted head or a public DTO. */
    commonRoster?: RetainedRosterProjection }>
  | Readonly<{ status: 'missing' | 'disabled' | 'conflict' | 'unavailable'; reason?: string }>;
export type AdministrationWriteResult = Readonly<{
  status: 'changed' | 'unchanged' | 'replayed' | 'stale' | 'rejected' | 'disabled';
  observationId?: string; versionId?: string | null; generation?: number; leagueSeasonId?: string;
  reason?: string;
  rosterAcceptance?: RosterAcceptanceResult;
  teamManagerAcceptance?: RosterAcceptanceResult;
  teamManagerEvidenceAcceptance?: RosterAcceptanceResult;
  leagueSettingsAcceptance?: RosterAcceptanceResult;
  matchupAcceptance?: RosterAcceptanceResult;
  transactionAcceptance?: RosterAcceptanceResult;
  calendarEvidence?: Readonly<{ id: string; status: 'retained' | 'replayed' }>;
  calculationInput?: Readonly<{ id: string; status: 'retained' | 'replayed' }>;
}>;
export type AdministrationEnrollment = Readonly<{
  leagueId: string; leagueSeasonId: string; leagueKey: string; displayName: string;
  season: number; provider: 'sleeper'; externalLeagueId: string; scoringProfileId: string;
}>;
export type AdministrationEnrollmentIdentity = Readonly<{
  leagueId: string; leagueKey: string; provider: string | null; season: number | null;
}>;
export type AdministrationEnrollmentFailureCode = 'missing-intended-season' | 'unregistered-season'
  | 'missing-source-connection' | 'missing-scoring-profile' | 'invalid-registration' | 'ambiguous-registration';
export type AdministrationEnrollmentResolution =
  | Readonly<{ status: 'ready'; intended: AdministrationEnrollmentIdentity; enrollment: AdministrationEnrollment }>
  | Readonly<{ status: 'unavailable'; intended: AdministrationEnrollmentIdentity; reason: AdministrationEnrollmentFailureCode }>;
export type AdministrationEnrollmentInventory = Readonly<{ entries: readonly AdministrationEnrollmentResolution[] }>;
export type AdministrationEnrollmentSelector = Readonly<{ leagueKey: string }>
  | Readonly<{ provider: 'sleeper'; externalLeagueId: string }>;
export type { AdministrationWriteFence } from './contracts';
export type LeagueAdministrationStore = Readonly<{
  enabled: boolean;
  beginPlayerDirectoryAttempt: (id: string, fence: AdministrationWriteFence) => Promise<PlayerDirectoryReservation>;
  recordPlayerDirectoryCapture: (attempt: PlayerDirectoryAttempt, capture: PlayerDirectoryCapture,
    fence: AdministrationWriteFence) => Promise<PlayerDirectoryWriteResult>;
  readAcceptedPlayerDirectory: (selection?: PlayerDirectoryReadSelection) => Promise<PlayerDirectoryRead>;
  recordObservation: (input: NormalizedAdministrationObservation, fence?: AdministrationWriteFence,
    mapping?: AdministrationSourceMapping, acceptance?: RosterAcceptanceInput,
    managerAcceptance?: RosterAcceptanceInput, leagueSettingsAcceptance?: Readonly<{ attempt: RosterAttempt }>,
    matchupAcceptance?: RosterAcceptanceInput, calendarEvidence?: SleeperCalendarEvidence,
    calculationCapture?: CalculationSourceCapture, transactionAcceptance?: Readonly<{ attempt: RosterAttempt }>,
    managerEvidenceAcceptance?: RosterAcceptanceInput) => Promise<AdministrationWriteResult>;
  beginTransactionAttempt: (mapping: AdministrationSourceMapping, week: number, id: string,
    fence?: AdministrationWriteFence) => Promise<RosterAttempt>;
  readAcceptedTransactions: (mapping: AdministrationSourceMapping, week: number) => Promise<AcceptedTransactionsRead>;
  /** Original immutable observations only; later receipt times never rewrite their mapping proof. */
  scanRetainedTransactions: (selection: RetainedTransactionSelection) => Promise<RetainedTransactionRead>;
  readRetainedTransactions: (selection: RetainedTransactionSelection, observationIds: readonly string[]) => Promise<RetainedTransactionRead>;
  beginCalculationSourceCapture: (mapping: AdministrationSourceMapping, week: number, id: string) => Promise<CalculationSourceCapture>;
  beginLeagueSettingsAttempt: (mapping: AdministrationSourceMapping, attemptId: string, fence?: AdministrationWriteFence) => Promise<RosterAttempt>;
  readAcceptedLeagueSettings: (mapping: AdministrationSourceMapping) => Promise<AcceptedLeagueSettingsRead>;
  beginExactMatchupAttempt: (mapping: AdministrationSourceMapping, week: number, attemptId: string,
    fence?: AdministrationWriteFence) => Promise<RosterAttempt>;
  readAcceptedExactMatchups: (mapping: AdministrationSourceMapping, week: number) => Promise<AcceptedExactMatchupsRead>;
  beginRosterCapture: (mapping: AdministrationSourceMapping, playersId: string, managersId: string,
    fence?: AdministrationWriteFence) => Promise<RosterCaptureAttempts>;
  readAcceptedTeamManagers: (mapping: AdministrationSourceMapping) => Promise<AcceptedTeamManagersRead>;
  /** Optional capability for older store implementations; Neon and disabled stores provide both. */
  beginTeamManagerEvidenceAttempt?: (mapping: AdministrationSourceMapping, id: string,
    fence?: AdministrationWriteFence) => Promise<RosterAttempt>;
  readAcceptedTeamManagerEvidence?: (mapping: AdministrationSourceMapping) => Promise<AcceptedTeamManagerEvidenceRead>;
  /** Exact immutable public directory capture; never substitutes for a current accepted head. */
  readManagerDirectoryCapture?: (mapping: AdministrationSourceMapping, captureId: string) => Promise<ManagerDirectoryCaptureRead>;
  beginRosterAttempt: (mapping: AdministrationSourceMapping, attemptId: string, policy?: CurrentRosterPolicy,
    fence?: AdministrationWriteFence) => Promise<RosterAttempt>;
  readRosterPlayerLinks: (selection: RosterPlayerLinksSelection) => Promise<RosterPlayerLinksRead>;
  readAcceptedCurrentRoster: (mapping: AdministrationSourceMapping, options?: CurrentRosterReadOptions) => Promise<AcceptedCurrentRosterRead>;
  readSourceMapping: (externalLeagueId: string) => Promise<AdministrationSourceMapping | null>;
  readSource: (input: AdministrationReadInput) => Promise<LeagueAdministrationStoreRead>;
  readSourceByConnection: (input: AdministrationConnectionReadInput) => Promise<LeagueAdministrationStoreRead>;
  /** Bounded immutable evidence only; these methods do not follow or advance accepted heads. */
  scanRetainedMatchups: (selection: RetainedMatchupSelection) => Promise<RetainedMatchupRead>;
  readRetainedMatchups: (selection: RetainedMatchupSelection, observationIds: readonly string[]) => Promise<RetainedMatchupRead>;
  /** Every intended membership is retained, including incomplete registrations. */
  listEnrollmentInventory: (season?: number) => Promise<AdministrationEnrollmentInventory>;
  /** Filter in SQL before validation, so unrelated registration cannot block a scoped read. */
  readEnrollment: (selector: AdministrationEnrollmentSelector, season?: number) => Promise<AdministrationEnrollmentResolution | Readonly<{ status: 'missing' }>>;
  /** Strict coordinated-publication contract; never silently return a smaller group. */
  listEnrollments: (season?: number) => Promise<readonly AdministrationEnrollment[]>;
}>;
