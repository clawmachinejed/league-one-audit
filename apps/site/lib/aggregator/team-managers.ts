import type { AcceptedResource, ProviderReference, SourceScope } from './contracts';
import type { AdministrationDiagnostic, JsonValue } from '../league-administration/contracts';
import type { AdministrationSourceMapping } from '../league-administration/source-mapping';
import type { AcceptedCurrentRosterRead, RosterAttempt } from './current-roster';

export const TEAM_MANAGERS_POLICY = Object.freeze({
  audienceId: 'public', coverageSpecId: 'sleeper-current-all-teams-primary-owners-v1',
  canonicalNormalizerVersion: 'sleeper-current-team-managers-v1',
  validationVersion: 'latest-network-attempt-v1',
});
export type SourceTeamManagers = Readonly<{
  externalRosterId: string;
  primaryOwner: Readonly<{ state: 'owned'; externalManagerId: string }>
    | Readonly<{ state: 'unowned' | 'unknown'; externalManagerId: null }>;
  coManagers: Readonly<{ state: 'known'; externalManagerIds: readonly string[] }>
    | Readonly<{ state: 'unknown'; externalManagerIds: null; reason: string }>;
}>;
export type TeamManagersNormalization = Readonly<{
  version: typeof TEAM_MANAGERS_POLICY.canonicalNormalizerVersion;
  status: 'complete' | 'partial' | 'invalid';
  teams: readonly SourceTeamManagers[] | null;
  diagnostics: readonly AdministrationDiagnostic[];
}>;
export type RosterCaptureAttempts = Readonly<{ players: RosterAttempt; managers: RosterAttempt }>;
export type ProviderManagerIdentity = Readonly<{ providerManagerId: string; sourceManager: ProviderReference }>;
export type TeamManagerRelationships = Readonly<{
  seasonTeamId: string; sourceTeam: ProviderReference;
  primaryOwner: Readonly<{ state: 'owned'; manager: ProviderManagerIdentity }>
    | Readonly<{ state: 'unowned' | 'unknown'; manager: null }>;
  coManagers: (Readonly<{ state: 'known'; managers: readonly ProviderManagerIdentity[]; completeness: 'complete' }>
    | Readonly<{ state: 'unknown'; managers: null; reason: string; completeness: 'unknown' }>)
    & Readonly<{ sourceRefs: readonly string[]; observedAt: string }>;
  assurance: 'provider-observed';
  effectiveFrom: null; effectiveTo: null; effectiveEvidence: 'unknown';
}>;
export type AcceptedTeamManagersRead = Readonly<{
  status: 'available'; accepted: AcceptedResource;
  receipt: Extract<AcceptedCurrentRosterRead, { status: 'available' }>['receipt'];
  teams: readonly TeamManagerRelationships[];
}> | Readonly<{ status: 'missing' | 'unavailable' | 'disabled'; reason?: string }>;

export function teamManagersScope(mapping: AdministrationSourceMapping): SourceScope {
  return { kind: 'enrolled-resource', connectionId: mapping.connectionId,
    leagueSeasonId: mapping.leagueSeasonId, family: 'teams', entityId: null,
    scoringPeriodId: null, audienceId: TEAM_MANAGERS_POLICY.audienceId,
    coverageSpecId: TEAM_MANAGERS_POLICY.coverageSpecId };
}

/** Opt-in latest field evidence; never substitutes for complete-primary v1 coverage. */
export const TEAM_MANAGER_EVIDENCE_POLICY = Object.freeze({
  audienceId: 'public', coverageSpecId: 'sleeper-current-all-teams-manager-evidence-v2',
  canonicalNormalizerVersion: 'sleeper-current-team-manager-evidence-v2',
  validationVersion: 'latest-network-attempt-v1',
});
export type SourceTeamManagerEvidence = Readonly<{
  externalRosterId: string;
  primaryOwner: Readonly<{ state: 'owned'; externalManagerId: string }>
    | Readonly<{ state: 'unowned'; externalManagerId: null }>
    | Readonly<{ state: 'unknown'; externalManagerId: null; reason: 'primary_owner_absent' | 'primary_owner_invalid' }>;
  coManagers: Readonly<{ state: 'known'; externalManagerIds: readonly string[] }>
    | Readonly<{ state: 'partial'; externalManagerIds: readonly string[]; reason: 'co_managers_invalid_members' }>
    | Readonly<{ state: 'unknown'; externalManagerIds: null;
      reason: 'co_managers_absent' | 'co_managers_null' | 'co_managers_invalid' }>;
}>;
export type TeamManagerEvidenceNormalization = Readonly<{
  version: typeof TEAM_MANAGER_EVIDENCE_POLICY.canonicalNormalizerVersion;
  status: 'complete' | 'partial' | 'invalid';
  teams: readonly SourceTeamManagerEvidence[] | null;
  diagnostics: readonly AdministrationDiagnostic[];
}>;
export type TeamManagerEvidenceRelationships = Readonly<{
  seasonTeamId: string; sourceTeam: ProviderReference;
  primaryOwner: Readonly<{ state: 'owned'; manager: ProviderManagerIdentity }>
    | Readonly<{ state: 'unowned'; manager: null }>
    | Readonly<{ state: 'unknown'; manager: null; reason: 'primary_owner_absent' | 'primary_owner_invalid' }>;
  coManagers: (Readonly<{ state: 'known'; managers: readonly ProviderManagerIdentity[]; completeness: 'complete' }>
    | Readonly<{ state: 'partial'; managers: readonly ProviderManagerIdentity[]; completeness: 'partial'; reason: 'co_managers_invalid_members' }>
    | Readonly<{ state: 'unknown'; managers: null; completeness: 'unknown'; reason: string }>)
    & Readonly<{ sourceRefs: readonly string[]; observedAt: string }>;
  assurance: 'provider-observed';
  effectiveFrom: null; effectiveTo: null; effectiveEvidence: 'unknown';
}>;
export type AcceptedTeamManagerEvidenceRead = Readonly<{
  status: 'available'; accepted: AcceptedResource;
  receipt: Extract<AcceptedTeamManagersRead, { status: 'available' }>['receipt'];
  /** This head is latest observed evidence, including adverse changes, never a complete-primary substitute. */
  evidenceCompleteness: 'complete' | 'partial'; evidenceReasons: readonly string[];
  teams: readonly TeamManagerEvidenceRelationships[];
}> | Readonly<{ status: 'missing' | 'unavailable' | 'disabled'; reason?: string }>;

export function teamManagerEvidenceScope(mapping: AdministrationSourceMapping): SourceScope {
  return { ...teamManagersScope(mapping), coverageSpecId: TEAM_MANAGER_EVIDENCE_POLICY.coverageSpecId };
}

export function teamManagerEvidenceCoverage(projection: TeamManagerEvidenceNormalization) {
  return { periodIds: [], interval: null, entitySet: 'full', fields: ['owner_id', 'co_owners'],
    pagination: 'complete', nextCursor: null, completeness: projection.status,
    reasons: [...new Set(projection.diagnostics.map(diagnostic => diagnostic.code))].sort() } as const;
}

/** Sleeper league users.is_owner describes commissioner status, never roster ownership. */
export const MANAGER_DIRECTORY_VERSION = 'sleeper-manager-directory-v1' as const;
export type CommissionerFact = Readonly<{ sourcePath: 'is_owner' }> & (
  | Readonly<{ state: 'known'; value: boolean }>
  | Readonly<{ state: 'absent' | 'null'; value: null }>
  | Readonly<{ state: 'invalid'; value: null; raw: JsonValue }>);
export type SourceManagerDirectoryEntry = Readonly<{
  externalManagerId: string; commissioner: CommissionerFact;
}>;
export type ManagerDirectoryNormalization = Readonly<{
  version: typeof MANAGER_DIRECTORY_VERSION;
  /** Complete covers the directory inventory; every commissioner field states its own evidence. */
  status: 'complete' | 'invalid'; managers: readonly SourceManagerDirectoryEntry[] | null;
  diagnostics: readonly AdministrationDiagnostic[];
}>;
export type ManagerDirectoryCaptureRead = Readonly<{
  status: 'available'; version: typeof MANAGER_DIRECTORY_VERSION;
  leagueSeasonId: string; sourceMapping: AdministrationSourceMapping;
  /** Immutable intake evidence can remain readable after the directory head changes. */
  captureBinding: 'intake-directory-capture'; assurance: 'provider-observed';
  capture: Readonly<{
    id: string; intakeId: string; contentId: string; legacyObservationId: string;
    requestStartedAt: string; requestCompletedAt: string; sourceObservedAt: string; recordedAt: string;
  }>;
  managers: readonly (ProviderManagerIdentity & Readonly<{
    displayName: string | null; username: string | null; avatar: string | null;
    commissioner: CommissionerFact;
  }>)[];
}> | Readonly<{ status: 'missing' | 'unavailable' | 'disabled'; reason?: string }>;
