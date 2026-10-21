import type { RosterAcceptanceResult } from '../aggregator/current-roster';

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
  bracketAcceptance?: RosterAcceptanceResult;
  weeklyReportAcceptance?: RosterAcceptanceResult;
  draftMetadataAcceptance?: RosterAcceptanceResult;
  draftSelectionsAcceptance?: RosterAcceptanceResult;
  tradedPicksAcceptance?: RosterAcceptanceResult;
  calendarEvidence?: Readonly<{ id: string; status: 'retained' | 'replayed' }>;
  calculationInput?: Readonly<{ id: string; status: 'retained' | 'replayed' }>;
}>;
