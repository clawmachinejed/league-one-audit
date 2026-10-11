import 'server-only';
import type { DatabaseClient, DatabaseRow } from '../../database';
import { EXACT_MATCHUPS_POLICY, exactMatchupsScope } from '../../aggregator/exact-matchups';
import { EXACT_MATCHUP_VALUES_VERSION, canonicalStoredOfficialDecimal, projectExactMatchupValues,
  type NativeMatchupField, type ExactMatchupTeamValues, type ExactMatchupValuesRead,
  type ExactMatchupValuesSelection } from '../../aggregator/exact-matchup-values';
import { compatibleRevision } from '../../projections/shared/revision-compatibility';
import { normalizeAdministrationObservation } from '../normalize';
import { isAdministrationSourceMapping, type AdministrationSourceMapping } from '../source-mapping';
import type { AdministrationEnvelope } from '../contracts';
import { readAcceptedExactMatchupsRows } from './exact-matchups';

/** Exact accepted receipt selection shares the current source-mapping fence, but not the current content head. */
export const EXACT_MATCHUP_VALUES_SQL = `/* league-administration:read-exact-matchup-values */
  SELECT scope.identity,accepted.id AS acceptance_id,accepted.generation,accepted.source_mapping_revision_id,
    receipt.id AS receipt_id,receipt.attempt_id,receipt.provenance,receipt.coverage,
    receipt.configuration_content_id,receipt.population_evidence,receipt.expected_team_count,
    receipt.legacy_observation_id,attempt.ordinal,attempt.expected_generation,attempt.source_mapping,
    configuration.payload AS configuration_payload,configuration.content_hash AS configuration_hash,
    content.id AS content_id,content.content_hash,content.semantic_hash,content.payload,
    content.normalized_value,content.normalizer_version,content.completeness,content.accepted AS content_accepted,
    content.league_season_id,content.provider,content.external_league_id,content.family,content.week,
    NULL AS calendar_evidence,NULL AS lineup_applicability_evidence,to_jsonb(header.*) AS value_header,
    (SELECT first_receipt.content_id FROM public.league_roster_resource_acceptances first_acceptance
      JOIN public.league_roster_capture_receipts first_receipt ON first_receipt.id=first_acceptance.receipt_id
      WHERE first_acceptance.id=header.first_acceptance_id) AS first_acceptance_content_id,
    (SELECT COALESCE(jsonb_agg(jsonb_build_object('seasonTeamId',team.id,'externalRosterId',team.external_roster_id)
      ORDER BY team.external_roster_id),'[]'::jsonb)
      FROM public.league_administration_team_entries entry
      JOIN public.league_season_teams team ON team.id=entry.team_id AND team.league_season_id=entry.league_season_id
      WHERE entry.content_id=content.id AND entry.league_season_id=content.league_season_id
        AND team.provider=content.provider AND team.external_league_id=content.external_league_id) AS teams,
    (SELECT COALESCE(jsonb_agg(to_jsonb(typed.*)-'raw_points'-'custom_points'||jsonb_build_object(
      'raw_points',typed.raw_points::text,'custom_points',typed.custom_points::text,'source_value',entry.source_value,
      'starter_points',(SELECT COALESCE(jsonb_agg(jsonb_build_object('source_index',point.source_index,'points',point.points::text)
        ORDER BY point.source_index),'[]'::jsonb) FROM public.league_exact_matchup_starter_points point
        WHERE point.content_id=typed.content_id AND point.team_id=typed.team_id),
      'player_points',(SELECT COALESCE(jsonb_agg(jsonb_build_object('native_player_id',point.native_player_id,'points',point.points::text)
        ORDER BY point.native_player_id COLLATE "C"),'[]'::jsonb) FROM public.league_exact_matchup_player_points point
        WHERE point.content_id=typed.content_id AND point.team_id=typed.team_id)) ORDER BY typed.source_ordinal),'[]'::jsonb)
      FROM public.league_exact_matchup_team_values typed
      JOIN public.league_administration_team_entries entry ON entry.content_id=typed.content_id AND entry.team_id=typed.team_id
      WHERE typed.content_id=content.id) AS typed_teams
  FROM public.league_roster_resource_scopes scope
  JOIN public.league_roster_resource_acceptances accepted ON accepted.scope_id=scope.id
  LEFT JOIN public.league_roster_resource_heads head ON head.scope_id=scope.id
  JOIN public.league_roster_capture_receipts receipt ON receipt.id=accepted.receipt_id
  JOIN public.league_roster_resource_attempts attempt ON attempt.id=receipt.attempt_id AND attempt.scope_id=scope.id
  JOIN public.league_administration_contents content ON content.id=receipt.content_id
  JOIN public.league_administration_contents configuration ON configuration.id=receipt.configuration_content_id
  LEFT JOIN public.league_exact_matchup_value_contents header ON header.content_id=content.id
  JOIN public.league_source_connections connection ON connection.id=scope.connection_id AND connection.league_season_id=scope.league_season_id
    AND connection.current_mapping_revision_id=accepted.source_mapping_revision_id
  JOIN public.league_seasons season ON season.id=scope.league_season_id
  JOIN public.league_administration_enrollment_seasons enrollment ON enrollment.league_id=season.league_id
    AND enrollment.season=season.season AND enrollment.provider=connection.provider
  WHERE scope.identity=$1::jsonb AND connection.current_mapping_revision_id=$2::uuid AND connection.mapping_generation=$3
    AND content.family='matchups' AND content.week=$4
    AND (($5::uuid IS NULL AND head.accepted_id=accepted.id AND head.generation=accepted.generation)
      OR ($5::uuid IS NOT NULL AND receipt.id=$5::uuid))`;

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid typed matchup object.');
  return value as Record<string, unknown>;
}
function uuid(value: unknown): string {
  if (typeof value !== 'string' || !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/iu.test(value)) throw new Error('Invalid typed matchup identity.');
  return value;
}
function integer(value: unknown, minimum = 0): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < minimum) throw new Error('Invalid typed matchup ordinal.');
  return value;
}
function field<T>(state: unknown, value: unknown, read: (value: unknown) => T): NativeMatchupField<T> {
  if (state === 'supplied') return { state, value: read(value) };
  if ((state !== 'missing' && state !== 'null') || value !== null) throw new Error('Invalid native field presence.');
  return { state };
}
function strings(value: unknown): readonly string[] {
  if (!Array.isArray(value) || value.some(item => typeof item !== 'string')) throw new Error('Invalid native lineup.');
  return value;
}
function teamValue(value: unknown, contentId: string): ExactMatchupTeamValues {
  const row = object(value);
  if (row.content_id !== contentId || typeof row.external_roster_id !== 'string'
    || !Array.isArray(row.starter_points) || !Array.isArray(row.player_points)) throw new Error('Invalid typed team lineage.');
  const rawPoints = field(row.raw_points_state, row.raw_points, canonicalStoredOfficialDecimal);
  const customPoints = field(row.custom_points_state, row.custom_points, canonicalStoredOfficialDecimal);
  const starterPoints = row.starter_points.map((value, index) => {
    const point = object(value);
    if (point.source_index !== index) throw new Error('Non-contiguous starter points.');
    return point.points === null ? null : canonicalStoredOfficialDecimal(point.points);
  });
  const playerPoints = Object.create(null) as Record<string, string | null>;
  for (const value of row.player_points) {
    const point = object(value);
    if (typeof point.native_player_id !== 'string' || Object.hasOwn(playerPoints, point.native_player_id)) throw new Error('Duplicate native player points.');
    playerPoints[point.native_player_id] = point.points === null ? null : canonicalStoredOfficialDecimal(point.points);
  }
  if (integer(row.starter_points_count) !== starterPoints.length || integer(row.player_points_count) !== row.player_points.length
    || row.starter_points_state !== 'supplied' && starterPoints.length !== 0
    || row.player_points_state !== 'supplied' && row.player_points.length !== 0) throw new Error('Incomplete typed native points.');
  return { seasonTeamId: uuid(row.team_id), externalRosterId: row.external_roster_id, sourceOrdinal: integer(row.source_ordinal, 1) - 1,
    nativeMatchupId: field(row.matchup_id_state, row.native_matchup_id, value => {
      if (typeof value !== 'string') throw new Error('Invalid native matchup ID.'); return value;
    }), players: field(row.players_state, row.players, strings), starters: field(row.starters_state, row.starters, strings), rawPoints, customPoints,
    starterPoints: field(row.starter_points_state, row.starter_points_state === 'supplied' ? starterPoints : null, value => value as typeof starterPoints),
    playerPoints: field(row.player_points_state, row.player_points_state === 'supplied' ? playerPoints : null, value => value as typeof playerPoints),
    effectivePoints: customPoints.state === 'supplied' ? { value: customPoints.value, source: 'custom-override' }
      : rawPoints.state === 'supplied' ? { value: rawPoints.value, source: 'raw' } : { value: null, source: 'unavailable' } };
}

export function readExactMatchupValuesRows(rows: readonly DatabaseRow[], mapping: AdministrationSourceMapping,
  selection: ExactMatchupValuesSelection): ExactMatchupValuesRead {
  try {
    if (!isAdministrationSourceMapping(mapping) || mapping.scope.season !== 2026) throw new Error('Unsupported exact value mapping.');
    exactMatchupsScope(mapping, selection.nativeWeek);
    if (selection.matchupsReceiptId !== undefined) uuid(selection.matchupsReceiptId);
    if (!rows.length) return { status: 'missing', reason: 'accepted_matchup_receipt_missing' };
    if (rows.length !== 1 || Buffer.byteLength(JSON.stringify(rows[0]), 'utf8') > 64 * 1024 * 1024) throw new Error('Invalid typed value result size.');
    const row = rows[0];
    const accepted = readAcceptedExactMatchupsRows(rows, mapping, selection.nativeWeek);
    if (accepted.status !== 'available' || row.content_accepted !== true
      || Number(row.generation) !== Number(row.expected_generation) + 1
      || selection.matchupsReceiptId !== undefined && selection.matchupsReceiptId !== accepted.receipt.id) throw new Error('Invalid accepted value receipt.');
    if (row.value_header === null) return { status: 'missing', reason: 'typed_values_not_recorded' };
    const header = object(row.value_header);
    if (header.content_id !== accepted.accepted.contentId || row.first_acceptance_content_id !== header.content_id
      || header.value_version !== EXACT_MATCHUP_VALUES_VERSION
      || header.team_count !== accepted.receipt.expectedTeamCount || !Array.isArray(row.typed_teams)
      || row.typed_teams.length !== header.team_count) throw new Error('Invalid typed value header.');
    uuid(header.first_acceptance_id);
    const normalized = normalizeAdministrationObservation({ schemaVersion: 'league-administration-v1',
      normalizerVersion: 'sleeper-administration-v1', dialect: 'sleeper-nfl-v1', scope: mapping.scope, family: 'matchups',
      week: selection.nativeWeek, completeness: 'complete', provenance: accepted.receipt.provenance,
      payload: row.payload as AdministrationEnvelope['payload'] }, { expectedRosterCount: accepted.receipt.expectedTeamCount });
    const projected = projectExactMatchupValues(normalized, accepted.value.teams);
    const typed = row.typed_teams.map(value => teamValue(value, accepted.accepted.contentId));
    if (compatibleRevision(typed) !== compatibleRevision(projected.teams) || normalized.value?.family !== 'matchups'
      || row.typed_teams.some((value, index) => compatibleRevision(object(value).source_value)
        !== compatibleRevision(normalized.value!.family === 'matchups' ? normalized.value!.matchups[index] : null))) {
      throw new Error('Typed and native matchup values disagree.');
    }
    return { status: 'available', version: EXACT_MATCHUP_VALUES_VERSION, selection: selection.matchupsReceiptId === undefined ? 'current' : 'receipt',
      contentId: accepted.accepted.contentId, matchupsReceiptId: accepted.receipt.id, acceptanceId: uuid(row.acceptance_id),
      acceptedGeneration: accepted.accepted.acceptedGeneration, sourceMappingRevisionId: mapping.revisionId,
      provenance: accepted.receipt.provenance, value: { ...projected, teams: typed } };
  } catch { return { status: 'unavailable', reason: 'exact_matchup_values_evidence_unavailable' }; }
}

export function exactMatchupValuesMethods(client: DatabaseClient) {
  return {
    async readExactMatchupValues(mapping: AdministrationSourceMapping, selection: ExactMatchupValuesSelection): Promise<ExactMatchupValuesRead> {
      try {
        if (!isAdministrationSourceMapping(mapping) || mapping.scope.season !== 2026) throw new Error('Unsupported exact value mapping.');
        const scope = exactMatchupsScope(mapping, selection.nativeWeek);
        if (selection.matchupsReceiptId !== undefined) uuid(selection.matchupsReceiptId);
        const rows = await client.query(EXACT_MATCHUP_VALUES_SQL,
          [JSON.stringify({ scope, policy: EXACT_MATCHUPS_POLICY }), mapping.revisionId, mapping.generation,
            selection.nativeWeek, selection.matchupsReceiptId ?? null]);
        return readExactMatchupValuesRows(rows, mapping, selection);
      } catch { return { status: 'unavailable', reason: 'exact_matchup_values_evidence_unavailable' }; }
    },
  };
}
