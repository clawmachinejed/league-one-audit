import { resolveExactLineupApplicability, type ExactLineupApplicability } from '../../aggregator/exact-lineup-applicability';
import type { ExactPeriodMappingQualification } from '../../aggregator/exact-matchups';
import { compatibleRevision } from '../../projections/shared/revision-compatibility';
import type { ConfigurationVersion } from '../applicability';
import type { ConfigurationBinding, ConfigurationComponent } from '../contracts';
import { isAdministrationSourceMapping, type AdministrationSourceMapping } from '../source-mapping';

/** The existing writer creates observed_current entries automatically. Only the
 * explicit owner activation path writes evidenced_period; no head/current-leg join.
 * A receipt's population configuration also carries its reserved mapping, even
 * when that configuration has no standalone settings receipt.
 */
export const EXACT_LINEUP_APPLICABILITY_COLUMNS = `
  (SELECT COALESCE(jsonb_agg(candidate.evidence ORDER BY candidate.generation),'[]'::jsonb)
    FROM (SELECT activation.generation,jsonb_build_object(
      'activation',to_jsonb(activation),'version',to_jsonb(version),'source',source.evidence) AS evidence
      FROM public.league_configuration_activations activation
      JOIN public.league_configuration_versions version ON version.id=activation.configuration_version_id
        AND version.league_season_id=activation.league_season_id
      LEFT JOIN LATERAL (
        SELECT jsonb_build_object('configurationContentId',configuration_source.id,
          'provider',configuration_source.provider,'externalLeagueId',configuration_source.external_league_id,
          'leagueSeasonId',configuration_source.league_season_id,
          'configurationVersionId',configuration_source.configuration_version_id,
          'normalizedValue',configuration_source.normalized_value,'sourceMapping',source_attempt.source_mapping) AS evidence
        FROM public.league_administration_contents configuration_source
        JOIN public.league_roster_capture_receipts source_receipt
          ON source_receipt.configuration_content_id=configuration_source.id
        JOIN public.league_roster_resource_attempts source_attempt ON source_attempt.id=source_receipt.attempt_id
        WHERE configuration_source.configuration_version_id=version.id
          AND configuration_source.league_season_id=scope.league_season_id
          AND configuration_source.provider=content.provider
          AND configuration_source.external_league_id=content.external_league_id
          AND configuration_source.family='league' AND configuration_source.week=0
          AND configuration_source.accepted AND configuration_source.completeness='complete'
          AND source_attempt.source_mapping->>'revisionId'=accepted.source_mapping_revision_id::text
          AND source_attempt.source_mapping->>'connectionId'=scope.connection_id::text
        ORDER BY source_receipt.id LIMIT 1
      ) source ON true
      WHERE activation.league_season_id=scope.league_season_id AND activation.component='roster'
        AND activation.applicability='evidenced_period'
        AND activation.from_week<=$4 AND activation.through_week>=$4
      ORDER BY activation.generation LIMIT 1001
    ) candidate) AS lineup_applicability_evidence`;

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid applicability object.');
  return value as Record<string, unknown>;
}
function id(value: unknown): string {
  if (typeof value !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) {
    throw new Error('Invalid applicability identity.');
  }
  return value;
}
function positive(value: unknown): number {
  if ((typeof value !== 'number' && typeof value !== 'string') || value === '') throw new Error('Invalid applicability range.');
  const result = Number(value);
  if (!Number.isSafeInteger(result) || result < 1) throw new Error('Invalid applicability range.');
  return result;
}
function timestamp(value: unknown): string {
  // Keep SQL microseconds and offset intact; recorded time is not provider source age.
  const match = typeof value === 'string' && /^(\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d)(?:\.\d{1,6})?(Z|[+-]\d\d:\d\d)$/u.exec(value);
  if (!match || !Number.isFinite(Date.parse(value as string))
    || new Date(`${match[1]}Z`).toISOString().slice(0, 19) !== match[1]) throw new Error('Invalid applicability time.');
  return value as string;
}

export function readExactLineupApplicability(input: unknown, mapping: AdministrationSourceMapping,
  periodMapping: ExactPeriodMappingQualification): ExactLineupApplicability {
  if (periodMapping.status !== 'mapped' || periodMapping.season !== mapping.scope.season) {
    return { status: 'unavailable', reason: 'period_mapping_unproved' };
  }
  if (input === null || input === undefined || (Array.isArray(input) && input.length === 0)) {
    return { status: 'unavailable', reason: 'no_binding' };
  }
  try {
    if (!isAdministrationSourceMapping(mapping) || !Array.isArray(input) || input.length > 1000) throw new Error('Invalid applicability inventory.');
    const bindings: ConfigurationBinding[] = [];
    const versions = new Map<string, ConfigurationVersion>();
    const activationRefs: Record<number, string> = {};
    const candidates = input.map(candidate => {
      const row = object(candidate); return { row, activation: object(row.activation) };
    }).filter(({ activation }) => {
      // A different season type/range is irrelevant, never numeric-week proof.
      if (activation.applicability !== 'evidenced_period' || activation.component !== 'roster'
        || activation.season_type !== periodMapping.seasonType) return false;
      const from = positive(activation.from_week); const through = positive(activation.through_week);
      if (from > through || through > 30) throw new Error('Invalid applicability interval.');
      return periodMapping.week >= from && periodMapping.week <= through;
    });
    const newestGeneration = Math.max(0, ...candidates.map(({ activation }) => positive(activation.generation)));
    // A superseded configuration may predate mapping retention. Only the newest
    // applicable decision must have readable source/version evidence; never fall
    // back to an older known decision when the newest one is unproved.
    for (const { row, activation } of candidates.filter(({ activation }) => positive(activation.generation) === newestGeneration)) {
      const version = object(row.version); const source = object(row.source); const normalized = object(source.normalizedValue);
      if (activation.league_season_id !== mapping.leagueSeasonId || version.league_season_id !== mapping.leagueSeasonId
        || source.leagueSeasonId !== mapping.leagueSeasonId || source.provider !== mapping.scope.provider
        || source.externalLeagueId !== mapping.scope.externalLeagueId
        || !isAdministrationSourceMapping(source.sourceMapping)
        || compatibleRevision(source.sourceMapping) !== compatibleRevision(mapping)
        || version.dialect !== 'sleeper-nfl-v1' || version.normalizer_version !== 'sleeper-administration-v1'
        || source.configurationVersionId !== version.id || activation.configuration_version_id !== version.id
        || normalized.family !== 'league' || normalized.externalLeagueId !== mapping.scope.externalLeagueId
        || normalized.season !== mapping.scope.season || !Array.isArray(version.components)
        || compatibleRevision(version.components) !== compatibleRevision(normalized.components)) throw new Error('Invalid applicability lineage.');
      id(source.configurationContentId);
      const components = version.components.map(entry => {
        const component = object(entry);
        if (component.hash !== compatibleRevision({ normalizerVersion: 'sleeper-administration-v1',
          dialect: 'sleeper-nfl-v1', name: component.name, value: component.value })) throw new Error('Invalid component hash.');
        return component as ConfigurationComponent;
      });
      if (version.semantic_hash !== compatibleRevision({ schemaVersion: 'league-administration-v1',
        normalizerVersion: 'sleeper-administration-v1', dialect: 'sleeper-nfl-v1', family: 'league', value: normalized })) {
        throw new Error('Invalid configuration hash.');
      }
      const generation = positive(activation.generation);
      if (typeof activation.evidence !== 'string' || !activation.evidence.trim()) throw new Error('Missing applicability evidence.');
      const configurationVersionId = id(version.id);
      const candidateVersion = { id: configurationVersionId, leagueSeasonId: mapping.leagueSeasonId, components };
      if (versions.has(configurationVersionId) && compatibleRevision(versions.get(configurationVersionId)) !== compatibleRevision(candidateVersion)) {
        throw new Error('Conflicting configuration version.');
      }
      versions.set(configurationVersionId, candidateVersion);
      activationRefs[generation] = id(activation.id);
      bindings.push({ leagueSeasonId: mapping.leagueSeasonId, component: 'roster',
        period: { season: periodMapping.season, seasonType: periodMapping.seasonType, week: periodMapping.week },
        componentHash: String(activation.component_hash), configurationVersionId, generation,
        recordedAt: timestamp(activation.recorded_at), evidence: { kind: 'owner_confirmed', reference: activation.evidence } });
    }
    return resolveExactLineupApplicability({ mapping, periodMapping, bindings, versions: [...versions.values()], activationRefs });
  } catch { return { status: 'unavailable', reason: 'invalid_applicability_evidence' }; }
}
