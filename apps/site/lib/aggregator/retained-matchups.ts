import type { AdministrationEnvelope, AdministrationProvenance } from '../league-administration/contracts';
import { normalizeAdministrationObservation } from '../league-administration/normalize';
import { isRetainedMatchupId, isRetainedMatchupSelection, RETAINED_MATCHUP_MAPPING_LIMIT,
  type RetainedMatchupEvidence, type RetainedMatchupMappingRevision,
  type RetainedMatchupSelection } from '../league-administration/retained-matchups-contracts';
import { isAdministrationSourceMapping } from '../league-administration/source-mapping';
import { compatibleRevision } from '../projections/shared/revision-compatibility';
import { projectExactMatchups, type ExactMatchupValue } from './exact-matchups';

export const RETAINED_MATCHUPS_TRANSFORMATION_VERSION = 'sleeper-retained-matchups-v2' as const;

export type RetainedMatchupRejection = 'retained_selection_invalid' | 'retained_scope_mismatch'
  | 'retained_content_missing' | 'retained_content_link_invalid' | 'complete_matchup_capture_required'
  | 'retained_normalizer_unsupported' | 'retained_observation_invalid' | 'retained_observation_time_invalid'
  | 'retained_raw_hash_mismatch' | 'retained_semantic_hash_mismatch' | 'retained_legacy_value_mismatch'
  | 'retained_normalization_rejected' | 'retained_team_link_invalid' | 'retained_team_link_conflict'
  | 'retained_team_links_incomplete' | 'retained_team_value_mismatch' | 'retained_mapping_lineage_invalid'
  | 'retained_mapping_lineage_conflict' | 'retained_matchup_comparison_mismatch' | 'retained_evidence_invalid';

export type RetainedMatchupProjection = Readonly<{
  status: 'available'; kind: 'legacy-retained-matchups';
  transformationVersion: typeof RETAINED_MATCHUPS_TRANSFORMATION_VERSION;
  scope: RetainedMatchupSelection['scope'] & { leagueSeasonId: string; nativeWeek: number };
  lineage: {
    observationId: string; contentId: string; rawContentHash: string; semanticHash: string;
    legacyNormalizerVersion: string; observationOutcome: string;
    sourceMappingRevisionId: string | null; sourceConnectionId: string | null; mappingGeneration: number | null;
    mappingEvidence: readonly Readonly<{ kind: 'observation-mapping' | 'matchup-receipt' | 'calculation-input'; id: string }>[];
  };
  source: AdministrationProvenance & { orderingAt: string; recordedAt: string; sourceUpdatedAt: null };
  value: ExactMatchupValue;
  comparison: { status: 'equal'; fields: readonly string[] };
  /** A complete legacy input is not independent proof of the expected population. */
  limitations: readonly string[];
}> | Readonly<{ status: 'rejected'; reason: RetainedMatchupRejection }>;

const unproved = ['population_unproved', 'configuration_applicability_unproved', 'player_metadata_unproved',
  'nfl_period_mapping_unproved', 'finality_unproved', 'derived_provenance_unproved',
  'v2_acceptance_not_qualified'] as const;

/** SQL emits UTC; captured JSON may retain an explicit offset. Compare instants without dropping microseconds. */
function timestamp(value: unknown): bigint | null {
  const match = typeof value === 'string'
    ? /^(\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d)(?:\.(\d{1,6}))?(Z|[+-]\d\d:\d\d)$/u.exec(value) : null;
  if (!match) return null;
  const localFields = Date.parse(`${match[1]}Z`);
  const milliseconds = Date.parse(`${match[1]}${match[3]}`);
  if (!Number.isFinite(milliseconds) || !Number.isFinite(localFields)
    || new Date(localFields).toISOString().slice(0, 19) !== match[1]) return null;
  return BigInt(milliseconds) * 1_000n + BigInt((match[2] ?? '').padEnd(6, '0'));
}
function reject(reason: RetainedMatchupRejection): RetainedMatchupProjection { return { status: 'rejected', reason }; }

function validRevision(revision: RetainedMatchupMappingRevision | null,
  selection: RetainedMatchupSelection): revision is RetainedMatchupMappingRevision {
  return !!revision && isRetainedMatchupId(revision.id) && isRetainedMatchupId(revision.connectionId)
    && revision.leagueSeasonId === selection.leagueSeasonId && revision.provider === selection.scope.provider
    && revision.externalLeagueId === selection.scope.externalLeagueId && revision.sourceNamespace === `nfl:${selection.scope.season}`
    && Number.isSafeInteger(revision.generation) && revision.generation >= 1;
}

function sameProvenance(candidate: AdministrationProvenance, original: AdministrationProvenance): boolean {
  return candidate.origin === original.origin && (['requestStartedAt', 'requestCompletedAt', 'sourceObservedAt', 'checkedAt'] as const)
    .every(key => candidate[key] === null ? original[key] === null
      : timestamp(candidate[key]) !== null && timestamp(candidate[key]) === timestamp(original[key]));
}

/**
 * Pure projection of one immutable observation, never a network acceptance or a head read.
 * A captured mapping is read only from that observation's immutable link. In particular,
 * current connections, later equal-content verification and current configuration are not inputs.
 */
export function projectRetainedMatchups(selection: RetainedMatchupSelection,
  evidence: RetainedMatchupEvidence): RetainedMatchupProjection {
  try {
    if (!isRetainedMatchupSelection(selection)) return reject('retained_selection_invalid');
    const { league, observation, content, mapping, mappingCandidates, teamLinks } = evidence;
    if (league.leagueSeasonId !== selection.leagueSeasonId || league.leagueKey !== selection.scope.leagueKey
      || league.season !== selection.scope.season || observation.leagueSeasonId !== selection.leagueSeasonId
      || observation.family !== 'matchups' || !selection.nativeWeeks.includes(observation.week)) {
      return reject('retained_scope_mismatch');
    }
    if (!content) return reject('retained_content_missing');
    if (!isRetainedMatchupId(observation.id) || !isRetainedMatchupId(content.id)
      || observation.contentId !== content.id) return reject('retained_content_link_invalid');
    if (content.leagueSeasonId !== selection.leagueSeasonId || content.provider !== selection.scope.provider
      || content.externalLeagueId !== selection.scope.externalLeagueId || content.family !== 'matchups'
      || content.week !== observation.week) return reject('retained_scope_mismatch');
    if (content.completeness !== 'complete') return reject('complete_matchup_capture_required');
    if (content.normalizerVersion !== 'sleeper-administration-v1') return reject('retained_normalizer_unsupported');
    if (!content.accepted || !['changed', 'unchanged', 'stale'].includes(observation.outcome)) {
      return reject('retained_observation_invalid');
    }
    const provenance = observation.provenance;
    const orderingAt = timestamp(observation.orderingAt);
    const checkedAt = timestamp(provenance.checkedAt);
    const started = timestamp(provenance.requestStartedAt);
    const completed = timestamp(provenance.requestCompletedAt);
    const observed = timestamp(provenance.sourceObservedAt);
    if (orderingAt === null || checkedAt === null || timestamp(observation.recordedAt) === null
      || (provenance.requestStartedAt !== null && started === null)
      || (provenance.requestCompletedAt !== null && completed === null)
      || (provenance.sourceObservedAt !== null && observed === null)
      || orderingAt !== (observed ?? completed ?? checkedAt) || (started === null) !== (completed === null)
      || (started !== null && completed !== null && (started > completed || completed > checkedAt))
      || (observed !== null && observed > checkedAt)
      || (provenance.origin === 'network' && (started === null || completed === null || observed === null))) {
      return reject('retained_observation_time_invalid');
    }
    const envelope: AdministrationEnvelope = { schemaVersion: 'league-administration-v1',
      normalizerVersion: 'sleeper-administration-v1', dialect: 'sleeper-nfl-v1', scope: selection.scope,
      family: 'matchups', week: observation.week, completeness: 'complete', provenance, payload: content.payload };
    // Do not pass the observed row count as an expectation: it cannot prove population.
    const normalized = normalizeAdministrationObservation(envelope);
    if (normalized.contentHash !== content.contentHash) return reject('retained_raw_hash_mismatch');
    if (normalized.status !== 'accepted' || normalized.value?.family !== 'matchups' || !normalized.semanticHash) {
      return reject('retained_normalization_rejected');
    }
    if (normalized.semanticHash !== content.semanticHash) return reject('retained_semantic_hash_mismatch');
    if (compatibleRevision(normalized.value) !== compatibleRevision(content.normalizedValue)) {
      return reject('retained_legacy_value_mismatch');
    }
    const sourceTeams = new Map(normalized.value.matchups.map(team => [team.externalRosterId, team]));
    const externalIds = new Set<string>();
    const internalIds = new Set<string>();
    const teams: { seasonTeamId: string; externalRosterId: string }[] = [];
    for (const link of teamLinks) {
      const team = link.team;
      if (!team || link.contentId !== content.id || link.leagueSeasonId !== selection.leagueSeasonId
        || team.leagueSeasonId !== selection.leagueSeasonId || team.provider !== selection.scope.provider
        || team.externalLeagueId !== selection.scope.externalLeagueId || !isRetainedMatchupId(team.id)
        || team.id !== link.teamId || typeof team.externalRosterId !== 'string'
        || !/^[1-9]\d*$/u.test(team.externalRosterId)) return reject('retained_team_link_invalid');
      if (externalIds.has(team.externalRosterId) || internalIds.has(team.id)) return reject('retained_team_link_conflict');
      externalIds.add(team.externalRosterId); internalIds.add(team.id);
      const source = sourceTeams.get(team.externalRosterId);
      if (!source) return reject('retained_team_links_incomplete');
      if (compatibleRevision(source) !== compatibleRevision(link.sourceValue)) return reject('retained_team_value_mismatch');
      teams.push({ seasonTeamId: team.id, externalRosterId: team.externalRosterId });
    }
    if (teams.length !== sourceTeams.size) return reject('retained_team_links_incomplete');
    let capturedRevision: RetainedMatchupMappingRevision | null = null;
    const mappingEvidence: { kind: 'observation-mapping' | 'matchup-receipt' | 'calculation-input'; id: string }[] = [];
    if (mapping) {
      const revision = mapping.revision;
      if (mapping.observationId !== observation.id || !validRevision(revision, selection)
        || mapping.revisionId !== revision.id || provenance.origin !== 'network') {
        return reject('retained_mapping_lineage_invalid');
      }
      capturedRevision = revision;
      mappingEvidence.push({ kind: 'observation-mapping', id: observation.id });
    }
    if (!Array.isArray(mappingCandidates) || mappingCandidates.length > RETAINED_MATCHUP_MAPPING_LIMIT) {
      return reject('retained_mapping_lineage_invalid');
    }
    const candidateIds = new Set<string>();
    for (const candidate of mappingCandidates) {
      const revision = candidate.revision; const sourceMapping = candidate.sourceMapping;
      const identity = `${candidate.kind}:${candidate.id}`;
      if (!['matchup-receipt', 'calculation-input'].includes(candidate.kind) || !isRetainedMatchupId(candidate.id)
        || candidateIds.has(identity) || candidate.observationId !== observation.id || candidate.contentId !== content.id
        || candidate.family !== 'matchups' || candidate.nativePeriodId !== `sleeper:matchup-week:${observation.week}` || provenance.origin !== 'network'
        || !sameProvenance(candidate.provenance, provenance) || !validRevision(revision, selection)
        || !isAdministrationSourceMapping(sourceMapping) || sourceMapping.revisionId !== revision.id
        || sourceMapping.connectionId !== revision.connectionId || sourceMapping.leagueSeasonId !== selection.leagueSeasonId
        || sourceMapping.generation !== revision.generation || compatibleRevision(sourceMapping.scope) !== compatibleRevision(selection.scope)) {
        return reject('retained_mapping_lineage_invalid');
      }
      if (capturedRevision && compatibleRevision(capturedRevision) !== compatibleRevision(revision)) {
        return reject('retained_mapping_lineage_conflict');
      }
      candidateIds.add(identity); capturedRevision = revision;
      mappingEvidence.push({ kind: candidate.kind, id: candidate.id });
    }
    mappingEvidence.sort((left, right) => left.kind < right.kind ? -1 : left.kind > right.kind ? 1
      : left.id < right.id ? -1 : left.id > right.id ? 1 : 0);
    // Slot labels need actual period-bound applicability; this retained scan has none.
    const value = projectExactMatchups(normalized, teams);
    const equal = normalized.value.matchups.every((source, index) => {
      const team = value.teams[index];
      const numeric = (point: string | null) => point === null ? null : Number(point);
      return source.externalRosterId === team.externalRosterId && source.externalMatchupId === team.nativeMatchupId
        && compatibleRevision(source.playerExternalIds) === compatibleRevision(team.players)
        && compatibleRevision(source.starterExternalIds)
          === compatibleRevision(team.starters?.map(slot => slot.empty ? '0' : slot.playerExternalId) ?? null)
        && source.points === numeric(team.officialTeamPoints.raw) && source.customPoints === numeric(team.officialTeamPoints.custom)
        && (source.customPoints ?? source.points) === numeric(team.officialTeamPoints.effective);
    });
    if (!equal) return reject('retained_matchup_comparison_mismatch');
    return { status: 'available', kind: 'legacy-retained-matchups',
      transformationVersion: RETAINED_MATCHUPS_TRANSFORMATION_VERSION,
      scope: { ...selection.scope, leagueSeasonId: selection.leagueSeasonId, nativeWeek: observation.week },
      lineage: { observationId: observation.id, contentId: content.id, rawContentHash: normalized.contentHash,
        semanticHash: normalized.semanticHash, legacyNormalizerVersion: content.normalizerVersion,
        observationOutcome: observation.outcome, sourceMappingRevisionId: capturedRevision?.id ?? null,
        sourceConnectionId: capturedRevision?.connectionId ?? null, mappingGeneration: capturedRevision?.generation ?? null, mappingEvidence },
      source: { ...normalized.envelope.provenance, orderingAt: observation.orderingAt,
        recordedAt: observation.recordedAt, sourceUpdatedAt: null }, value,
      comparison: { status: 'equal', fields: ['raw-content', 'semantic-hash', 'legacy-normalized-value',
        'content-linked-team-values', 'participants', 'matchup-groups', 'players', 'ordered-starters', 'official-team-points'] },
      limitations: [...(capturedRevision ? [] : ['mapping_revision_not_captured']), ...unproved,
        ...(provenance.sourceObservedAt === null ? ['source_observation_age_unproved'] : [])] };
  } catch { return reject('retained_evidence_invalid'); }
}
