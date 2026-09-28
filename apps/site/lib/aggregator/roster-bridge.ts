import type { FieldGroup, ProviderReference, RosterMembership } from './contracts';
import { validateRosterMembership } from './validation';
import type { AdministrationEnvelope, NormalizedAdministrationObservation, SourceTeam } from '../league-administration/contracts';
import { compatibleRevision } from '../projections/shared/revision-compatibility';

type StoredRead = Readonly<{
  envelope: AdministrationEnvelope; observationId: string; generation: number;
  checkedAt: string; verifiedAt: string | null;
}>;
type Group = 'roster' | 'reserve' | 'taxi';

/** A projection of v1 evidence, deliberately NOT a v2 accepted resource/head. */
export type RetainedRosterProjection = Readonly<{
  status: 'available'; kind: 'legacy-retained-roster'; schemaVersion: 'aggregator-roster-v1';
  normalizerVersion: 'sleeper-roster-bridge-v1';
  scope: StoredRead['envelope']['scope'] & { leagueSeasonId: string };
  lineage: {
    observationId: string; rawContentRef: string; rawContentHash: string;
    legacyNormalizerVersion: string; generation: number; verifiedAt: string | null;
    sourceMappingRevisionId: null; reasons: readonly ['mapping_revision_not_captured'];
  };
  source: StoredRead['envelope']['provenance'] & { sourceUpdatedAt: null };
  teams: readonly Readonly<{
    seasonTeamId: string; sourceTeam: ProviderReference;
    groups: Readonly<Record<Group, FieldGroup<readonly RosterMembership[]>>>;
  }>[];
  comparison: { status: 'equal'; fields: readonly ['players', 'reserve', 'taxi'] };
  featureSupport: {
    officialRoster: 'full' | 'limited'; exactPeriodLineup: 'unverified';
    reasons: readonly string[];
  };
}> | Readonly<{ status: 'unavailable'; reason: string }>;

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function id(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.trim() === value && !/[\x00-\x1f\x7f]/.test(value);
}

/** No IO, IDs allocated, head selection, freshness policy, or historical lineup inference. */
export function projectRetainedRoster(
  read: StoredRead,
  evidence: unknown,
  normalized: NormalizedAdministrationObservation,
): RetainedRosterProjection {
  if (normalized.status !== 'accepted' || normalized.value?.family !== 'rosters'
    || read.envelope.family !== 'rosters' || read.envelope.week !== null
    || read.envelope.completeness !== 'complete') {
    return { status: 'unavailable', reason: 'complete_roster_capture_required' };
  }
  if (!record(evidence) || !id(evidence.league_season_id) || !id(evidence.content_id)
    || !Array.isArray(evidence.roster_team_identities)) {
    return { status: 'unavailable', reason: 'retained_identity_missing' };
  }
  // Bind the new projection to exactly the raw content that the legacy reader validated.
  if (evidence.content_hash !== normalized.contentHash
    || normalized.contentHash !== compatibleRevision(read.envelope.payload)
    || compatibleRevision(normalized.envelope) !== compatibleRevision(read.envelope)) {
    return { status: 'unavailable', reason: 'retained_content_mismatch' };
  }
  const identities = new Map<string, string>();
  const internalIds = new Set<string>();
  for (const identity of evidence.roster_team_identities) {
    if (!record(identity) || !id(identity.externalRosterId) || !id(identity.seasonTeamId)
      || identities.has(identity.externalRosterId) || internalIds.has(identity.seasonTeamId)) {
      return { status: 'unavailable', reason: 'retained_identity_conflict' };
    }
    identities.set(identity.externalRosterId, identity.seasonTeamId);
    internalIds.add(identity.seasonTeamId);
  }
  if (identities.size !== normalized.value.teams.length
    || normalized.value.teams.some(team => !identities.has(team.externalRosterId))) {
    return { status: 'unavailable', reason: 'retained_identity_incomplete' };
  }
  // This is the original observation check, not a later head verification/cache check.
  const checkedTime = evidence.observation_checked_at instanceof Date
    ? evidence.observation_checked_at.getTime()
    : typeof evidence.observation_checked_at === 'string' ? Date.parse(evidence.observation_checked_at) : NaN;
  if (!Number.isFinite(checkedTime) || checkedTime > Date.parse(read.checkedAt)
    || [read.envelope.provenance.requestCompletedAt, read.envelope.provenance.sourceObservedAt]
      .some(time => time !== null && Date.parse(time) > checkedTime)) {
    return { status: 'unavailable', reason: 'retained_observation_time_missing' };
  }
  const checkedAt = new Date(checkedTime).toISOString();
  const groups: readonly Group[] = ['roster', 'reserve', 'taxi'];
  const nativeFields = { roster: 'players', reserve: 'reserve', taxi: 'taxi' } as const;
  const nativeIds = (team: SourceTeam, group: Group) => group === 'roster'
    ? team.playerExternalIds : group === 'reserve' ? team.reserveExternalIds : team.taxiExternalIds;
  const sourceNamespace = JSON.stringify(['nfl', read.envelope.scope.season, read.envelope.scope.externalLeagueId]);
  const teams = normalized.value.teams.map(team => {
    const seasonTeamId = identities.get(team.externalRosterId)!;
    const sourceTeam: ProviderReference = { provider: 'sleeper', resourceKind: 'team',
      nativeNamespace: sourceNamespace, nativeId: team.externalRosterId };
    const mapped = (group: Group): FieldGroup<readonly RosterMembership[]> => {
      const ids = nativeIds(team, group);
      return {
        value: ids === null ? null : ids.map(nativeId => ({
          seasonTeamId, sourceTeam,
          sourceEntity: { provider: 'sleeper', resourceKind: 'scoring-entity', nativeNamespace: 'nfl', nativeId },
          canonicalEntityId: null, identityState: 'unresolved',
          nativeSection: nativeFields[group], section: group,
          effectiveFrom: null, effectiveTo: null, effectiveEvidence: 'unknown',
        })),
        availability: ids === null ? 'missing' : ids.length === 0 ? 'empty' : 'present',
        completeness: ids === null ? 'unknown' : 'complete', freshness: 'unknown',
        authority: 'provider-official', temporalContext: 'current-display',
        sourceRefs: [read.observationId], reasons: ids === null ? ['source_field_missing'] : [],
      };
    };
    return { seasonTeamId, sourceTeam, groups: { roster: mapped('roster'), reserve: mapped('reserve'), taxi: mapped('taxi') } };
  });
  // Same-capture reversible value comparison; no second provider request or pipeline.
  const equal = normalized.value.teams.every((team, index) => groups.every(group => {
    const values = teams[index].groups[group].value?.map(member => member.sourceEntity.nativeId) ?? null;
    return compatibleRevision(values) === compatibleRevision(nativeIds(team, group));
  }));
  if (!equal) return { status: 'unavailable', reason: 'roster_comparison_mismatch' };
  if (teams.some(team => groups.some(group => team.groups[group].value?.some(member => !validateRosterMembership(member))))) {
    return { status: 'unavailable', reason: 'invalid_common_roster_contract' };
  }
  const missing = teams.some(team => groups.some(group => team.groups[group].availability === 'missing'));
  return {
    status: 'available', kind: 'legacy-retained-roster', schemaVersion: 'aggregator-roster-v1',
    normalizerVersion: 'sleeper-roster-bridge-v1',
    scope: { ...read.envelope.scope, leagueSeasonId: evidence.league_season_id },
    lineage: { observationId: read.observationId, rawContentRef: evidence.content_id,
      rawContentHash: normalized.contentHash, legacyNormalizerVersion: read.envelope.normalizerVersion,
      generation: read.generation, verifiedAt: read.verifiedAt,
      sourceMappingRevisionId: null, reasons: ['mapping_revision_not_captured'] },
    source: { ...read.envelope.provenance, checkedAt, sourceUpdatedAt: null },
    teams, comparison: { status: 'equal', fields: ['players', 'reserve', 'taxi'] },
    featureSupport: { officialRoster: missing ? 'limited' : 'full', exactPeriodLineup: 'unverified',
      reasons: [...(missing ? ['source_field_missing'] : []), 'current_membership_is_not_period_lineup'] },
  };
}
