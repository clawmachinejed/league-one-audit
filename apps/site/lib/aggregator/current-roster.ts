import type { AcceptedResource, RosterMembership, SourceScope } from './contracts';
import type { AdministrationSourceMapping } from '../league-administration/source-mapping';
import type { AdministrationEnvelope } from '../league-administration/contracts';
import type { CurrentRosterGroups } from './current-roster-groups';
import type { CurrentRosterMetadata } from './current-roster-metadata';

/** A closed qualification registry, not caller-selected claims of support. */
export const CURRENT_ROSTER_POLICY = Object.freeze({
  audienceId: 'public', coverageSpecId: 'sleeper-current-all-teams-players-v1',
  canonicalNormalizerVersion: 'sleeper-current-players-v1',
  validationVersion: 'latest-network-attempt-v1',
});
export type CurrentRosterPolicy = typeof CURRENT_ROSTER_POLICY;
export type RosterAttempt = Readonly<{
  id: string; scopeId: string; ordinal: number; expectedGeneration: number;
}>;
export type RosterPopulationEvidence = Readonly<{
  observationId: string; contentHash: string; envelope: AdministrationEnvelope;
}>;
export type RosterAcceptanceInput = Readonly<{
  attempt: RosterAttempt;
  /** Exact separately collected league document, never inferred from roster length. */
  population?: RosterPopulationEvidence;
}>;
export type RosterAcceptanceResult = Readonly<{
  status: 'accepted' | 'preserved'; reason?: string; receiptId: string;
  acceptedGeneration: number;
}>;
export type AcceptedCurrentRosterRead = Readonly<{
  status: 'available'; accepted: AcceptedResource;
  receipt: { id: string; attemptId: string; ordinal: number;
    provenance: AdministrationEnvelope['provenance']; configurationContentId: string;
    expectedTeamCount: number; legacyObservationId: string };
  teams: readonly { seasonTeamId: string; externalRosterId: string; players: readonly RosterMembership[];
    currentGroups: CurrentRosterGroups }[];
  /** Optional current catalog evidence has its own provenance, never the roster receipt's age. */
  currentPlayerMetadata?: CurrentRosterMetadata;
}> | Readonly<{ status: 'missing' | 'unavailable' | 'disabled'; reason?: string }>;

export function currentRosterScope(mapping: AdministrationSourceMapping): SourceScope {
  return { kind: 'enrolled-resource', connectionId: mapping.connectionId,
    leagueSeasonId: mapping.leagueSeasonId, family: 'roster-membership', entityId: null,
    scoringPeriodId: null, audienceId: CURRENT_ROSTER_POLICY.audienceId,
    coverageSpecId: CURRENT_ROSTER_POLICY.coverageSpecId };
}
