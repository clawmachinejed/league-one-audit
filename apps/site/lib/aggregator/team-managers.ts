import type { AcceptedResource, ProviderReference, SourceScope } from './contracts';
import type { AdministrationDiagnostic } from '../league-administration/contracts';
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
