import 'server-only';
import type { DatabaseClient } from '../../database';
import { LEAGUE_SETTINGS_POLICY, LEAGUE_SETTINGS_FIELDS, leagueSettingsScope,
  type AcceptedLeagueSettingsRead } from '../../aggregator/league-settings';
import { assertAcceptedResource } from '../../aggregator/validation';
import type { AcceptedResource } from '../../aggregator/contracts';
import type { RosterAttempt } from '../../aggregator/current-roster';
import { isAdministrationSourceMapping, type AdministrationSourceMapping } from '../source-mapping';
import { normalizeAdministrationObservation } from '../normalize';
import type { AdministrationEnvelope } from '../contracts';
import type { AdministrationWriteFence } from '../store-contracts';
import { compatibleRevision } from '../../projections/shared/revision-compatibility';

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid league evidence.');
  return value as Record<string, unknown>;
}
function id(value: unknown): string {
  if (typeof value !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(value)) throw new Error('Invalid league identity.');
  return value;
}
function integer(value: unknown, minimum = 1): number {
  if ((typeof value !== 'number' && typeof value !== 'string') || value === '') throw new Error('Invalid generation.');
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n < minimum) throw new Error('Invalid generation.');
  return n;
}
export function leagueSettingsMethods(client: DatabaseClient) {
  return {
    async beginLeagueSettingsAttempt(mapping: AdministrationSourceMapping, attemptId: string, fence?: AdministrationWriteFence): Promise<RosterAttempt> {
      if (!isAdministrationSourceMapping(mapping)) throw new Error('Invalid league mapping.');
      const rows = await client.query(`/* league-administration:begin-league-settings */
        SELECT public.begin_current_roster_attempt($1::jsonb,$2::uuid,$3::jsonb,$4::jsonb,$5::jsonb) AS result`,
      [JSON.stringify(mapping), id(attemptId), JSON.stringify(leagueSettingsScope(mapping)), JSON.stringify(LEAGUE_SETTINGS_POLICY), fence ? JSON.stringify(fence) : null]);
      if (rows.length !== 1) throw new Error('Missing league reservation.');
      const row = object(rows[0].result);
      if (row.id !== attemptId) throw new Error('Wrong league reservation.');
      return { id: id(row.id), scopeId: id(row.scopeId), ordinal: integer(row.ordinal), expectedGeneration: integer(row.expectedGeneration, 0) };
    },
    async readAcceptedLeagueSettings(mapping: AdministrationSourceMapping): Promise<AcceptedLeagueSettingsRead> {
      if (!isAdministrationSourceMapping(mapping)) return { status: 'unavailable', reason: 'invalid_mapping' };
      try {
        const identity = { scope: leagueSettingsScope(mapping), policy: LEAGUE_SETTINGS_POLICY };
        const rows = await client.query(`/* league-administration:read-accepted-league-settings */
          SELECT scope.identity,accepted.generation,accepted.source_mapping_revision_id,
            receipt.id AS receipt_id,receipt.attempt_id,receipt.provenance,receipt.coverage,
            receipt.configuration_content_id,receipt.population_evidence,receipt.expected_team_count,receipt.legacy_observation_id,
            attempt.ordinal,attempt.source_mapping,content.id AS content_id,content.content_hash,content.semantic_hash,
            content.payload,content.normalized_value,content.normalizer_version,content.completeness,
            content.configuration_version_id,content.league_season_id,content.provider,content.external_league_id,season.league_id
          FROM public.league_roster_resource_scopes scope
          JOIN public.league_roster_resource_heads head ON head.scope_id=scope.id
          JOIN public.league_roster_resource_acceptances accepted ON accepted.id=head.accepted_id
            AND accepted.scope_id=scope.id AND accepted.generation=head.generation
          JOIN public.league_roster_capture_receipts receipt ON receipt.id=accepted.receipt_id
          JOIN public.league_roster_resource_attempts attempt ON attempt.id=receipt.attempt_id AND attempt.scope_id=scope.id
          JOIN public.league_administration_contents content ON content.id=receipt.content_id
          JOIN public.league_source_connections connection ON connection.id=scope.connection_id
            AND connection.league_season_id=scope.league_season_id
            AND connection.current_mapping_revision_id=accepted.source_mapping_revision_id
          JOIN public.league_seasons season ON season.id=scope.league_season_id
          JOIN public.league_administration_enrollment_seasons enrollment ON enrollment.league_id=season.league_id
            AND enrollment.season=season.season AND enrollment.provider=connection.provider
          WHERE scope.identity=$1::jsonb AND connection.current_mapping_revision_id=$2::uuid
            AND connection.mapping_generation=$3 AND content.family='league' AND content.week=0`,
        [JSON.stringify(identity), mapping.revisionId, mapping.generation]);
        if (!rows.length) return { status: 'missing' };
        if (rows.length !== 1) throw new Error('Ambiguous league settings.');
        const row = rows[0];
        if (!isAdministrationSourceMapping(row.source_mapping) || compatibleRevision(row.source_mapping) !== compatibleRevision(mapping)
          || row.source_mapping_revision_id !== mapping.revisionId || compatibleRevision(row.identity) !== compatibleRevision(identity)
          || row.league_season_id !== mapping.leagueSeasonId || row.provider !== 'sleeper'
          || row.external_league_id !== mapping.scope.externalLeagueId || row.normalizer_version !== 'sleeper-administration-v1'
          || row.completeness !== 'complete' || row.configuration_content_id !== row.content_id
          || row.population_evidence !== null || row.expected_team_count !== null
          || compatibleRevision(row.coverage) !== compatibleRevision({ periodIds: [], interval: null, entitySet: 'full',
            fields: LEAGUE_SETTINGS_FIELDS, pagination: 'complete', nextCursor: null, completeness: 'complete', reasons: [] })) throw new Error('Invalid league lineage.');
        const provenance = object(row.provenance) as AdministrationEnvelope['provenance'];
        const normalized = normalizeAdministrationObservation({ schemaVersion: 'league-administration-v1', normalizerVersion: 'sleeper-administration-v1',
          dialect: 'sleeper-nfl-v1', scope: mapping.scope, family: 'league', week: null, completeness: 'complete', provenance,
          payload: row.payload as AdministrationEnvelope['payload'] });
        const projected = normalized.leagueSettings;
        if (projected?.status !== 'complete' || !projected.value || normalized.contentHash !== row.content_hash
          || normalized.semanticHash !== row.semantic_hash || compatibleRevision(normalized.value) !== compatibleRevision(row.normalized_value)
          || provenance.origin !== 'network' || !provenance.sourceObservedAt || !provenance.requestStartedAt || !provenance.requestCompletedAt) throw new Error('Invalid league capture.');
        const accepted: AcceptedResource = { scope: leagueSettingsScope(mapping), canonicalNormalizerVersion: LEAGUE_SETTINGS_POLICY.canonicalNormalizerVersion,
          sourceMappingRevisionId: mapping.revisionId, contentId: id(row.content_id), observationIds: [id(row.receipt_id)],
          validationVersion: LEAGUE_SETTINGS_POLICY.validationVersion, acceptedGeneration: integer(row.generation), verifiedAt: provenance.sourceObservedAt,
          effectiveFrom: null, effectiveTo: null, effectiveEvidence: 'unknown' };
        assertAcceptedResource(accepted);
        return { status: 'available', accepted, leagueId: id(row.league_id), leagueSeasonId: mapping.leagueSeasonId,
          receipt: { id: id(row.receipt_id), attemptId: id(row.attempt_id), ordinal: integer(row.ordinal),
            legacyObservationId: id(row.legacy_observation_id), provenance, sourceUpdatedAt: null, rawContentHash: normalized.contentHash,
            configurationVersionId: row.configuration_version_id === null ? null : id(row.configuration_version_id), configurationSemanticHash: normalized.semanticHash },
          value: projected.value, comparison: { status: 'equal', legacyConfiguration: normalized.status === 'accepted' ? 'equal' : 'rejected',
            fields: ['raw-content', 'configuration-components', 'configuration-semantic-hash'] } };
      } catch { return { status: 'unavailable', reason: 'league_settings_evidence_unavailable' }; }
    },
  };
}
