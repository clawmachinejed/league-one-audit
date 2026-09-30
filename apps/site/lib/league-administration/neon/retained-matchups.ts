import 'server-only';
import type { DatabaseClient, DatabaseRow } from '../../database';
import {
  isRetainedMatchupId, isRetainedMatchupSelection, RETAINED_MATCHUP_BATCH_LIMIT,
  RETAINED_MATCHUP_INVENTORY_LIMIT, RETAINED_MATCHUP_MAPPING_LIMIT, type RetainedMatchupEvidence, type RetainedMatchupRead,
  type RetainedMatchupSelection,
} from '../retained-matchups-contracts';

// Fixed UTC formatting preserves PostgreSQL microseconds and is independent of session timezone.
const time = (column: string) => `to_char(${column} AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;
const originalProvenance = (column: string) => `${column}->>'origin'=observation.origin
  AND (${column}->>'requestStartedAt')::timestamptz IS NOT DISTINCT FROM observation.request_started_at
  AND (${column}->>'requestCompletedAt')::timestamptz IS NOT DISTINCT FROM observation.request_completed_at
  AND (${column}->>'sourceObservedAt')::timestamptz IS NOT DISTINCT FROM observation.source_observed_at
  AND (${column}->>'checkedAt')::timestamptz IS NOT DISTINCT FROM observation.checked_at`;
const revisionValue = (alias: string) => `CASE WHEN ${alias}.id IS NULL THEN NULL ELSE jsonb_build_object(
  'id',${alias}.id,'connectionId',${alias}.connection_id,'leagueSeasonId',${alias}.league_season_id,
  'provider',${alias}.provider,'externalLeagueId',${alias}.external_league_id,
  'sourceNamespace',${alias}.source_namespace,'generation',${alias}.generation) END`;
const evidenceColumns = `jsonb_build_object(
  'league',jsonb_build_object('leagueSeasonId',season.id,'leagueKey',league.league_key,'season',season.season),
  'observation',jsonb_build_object('id',observation.id,'leagueSeasonId',observation.league_season_id,
    'family',observation.family,'week',observation.week,'contentId',observation.content_id,
    'provenance',jsonb_build_object('origin',observation.origin,
      'requestStartedAt',${time('observation.request_started_at')},
      'requestCompletedAt',${time('observation.request_completed_at')},
      'sourceObservedAt',${time('observation.source_observed_at')},
      'checkedAt',${time('observation.checked_at')}),
    'orderingAt',${time('observation.ordering_at')},'recordedAt',${time('observation.recorded_at')},
    'outcome',observation.outcome),
  'content',CASE WHEN content.id IS NULL THEN NULL ELSE jsonb_build_object(
    'id',content.id,'leagueSeasonId',content.league_season_id,'provider',content.provider,
    'externalLeagueId',content.external_league_id,'family',content.family,'week',content.week,
    'normalizerVersion',content.normalizer_version,'contentHash',content.content_hash,
    'semanticHash',content.semantic_hash,'completeness',content.completeness,'accepted',content.accepted,
    'payload',content.payload,'normalizedValue',content.normalized_value) END,
  'teamLinks',(SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'contentId',entry.content_id,'leagueSeasonId',entry.league_season_id,'teamId',entry.team_id,
    'sourceValue',entry.source_value,'team',CASE WHEN team.id IS NULL THEN NULL ELSE jsonb_build_object(
      'id',team.id,'leagueSeasonId',team.league_season_id,'provider',team.provider,
      'externalLeagueId',team.external_league_id,'externalRosterId',team.external_roster_id) END)
    ORDER BY entry.team_id),'[]'::jsonb)
    FROM public.league_administration_team_entries entry
    LEFT JOIN public.league_season_teams team ON team.id=entry.team_id
    WHERE entry.content_id=observation.content_id),
  'mapping',CASE WHEN mapping.observation_id IS NULL THEN NULL ELSE jsonb_build_object(
    'observationId',mapping.observation_id,'revisionId',mapping.source_mapping_revision_id,
    'revision',CASE WHEN revision.id IS NULL THEN NULL ELSE jsonb_build_object(
      'id',revision.id,'connectionId',revision.connection_id,'leagueSeasonId',revision.league_season_id,
      'provider',revision.provider,'externalLeagueId',revision.external_league_id,
      'sourceNamespace',revision.source_namespace,'generation',revision.generation) END) END,
  'mappingCandidates',(SELECT COALESCE(jsonb_agg(candidate.value ORDER BY candidate.kind,candidate.id),'[]'::jsonb) FROM (
    SELECT 'matchup-receipt' AS kind,receipt.id,jsonb_build_object('kind','matchup-receipt','id',receipt.id,
      'observationId',receipt.legacy_observation_id,'contentId',receipt.content_id,
      'family',resource_scope.identity->'scope'->>'family',
      'nativePeriodId',resource_scope.identity->'scope'->>'scoringPeriodId',
      'provenance',receipt.provenance,'sourceMapping',attempt.source_mapping,
      'revision',${revisionValue('receipt_revision')}) AS value
    FROM public.league_roster_capture_receipts receipt
    LEFT JOIN public.league_roster_resource_attempts attempt ON attempt.id=receipt.attempt_id
    LEFT JOIN public.league_roster_resource_scopes resource_scope ON resource_scope.id=attempt.scope_id
    LEFT JOIN public.league_source_mapping_revisions receipt_revision
      ON receipt_revision.id::text=attempt.source_mapping->>'revisionId'
    WHERE receipt.legacy_observation_id=observation.id AND ${originalProvenance('receipt.provenance')}
    UNION ALL
    SELECT 'calculation-input' AS kind,input.id,jsonb_build_object('kind','calculation-input','id',input.id,
      'observationId',input.observation_id,'contentId',input.content_id,
      'family',input.family,
      'nativePeriodId','sleeper:matchup-week:'||capture.week::text,
      'provenance',input.provenance,'sourceMapping',CASE WHEN capture.id IS NULL THEN NULL ELSE jsonb_build_object(
        'connectionId',capture.connection_id,'leagueSeasonId',capture.league_season_id,
        'revisionId',capture.source_mapping_revision_id,'generation',capture_revision.generation,
        'scope',jsonb_build_object('leagueKey',league.league_key,'season',season.season,
          'provider',capture_revision.provider,'externalLeagueId',capture_revision.external_league_id)) END,
      'revision',${revisionValue('capture_revision')}) AS value
    FROM public.league_calculation_capture_inputs input
    LEFT JOIN public.league_calculation_source_captures capture ON capture.id=input.capture_id
    LEFT JOIN public.league_source_mapping_revisions capture_revision ON capture_revision.id=capture.source_mapping_revision_id
    WHERE input.observation_id=observation.id AND ${originalProvenance('input.provenance')}
    ORDER BY kind,id LIMIT ${RETAINED_MATCHUP_MAPPING_LIMIT + 1}
  ) candidate)
) AS evidence`;
const evidenceJoins = `FROM public.league_administration_observations observation
  LEFT JOIN public.league_administration_contents content ON content.id=observation.content_id
  LEFT JOIN public.league_seasons season ON season.id=observation.league_season_id
  LEFT JOIN public.leagues league ON league.id=season.league_id
  LEFT JOIN public.league_administration_observation_mappings mapping ON mapping.observation_id=observation.id
  LEFT JOIN public.league_source_mapping_revisions revision ON revision.id=mapping.source_mapping_revision_id`;

const identity = (keyParameter: number, seasonParameter: number) => `EXISTS (
  SELECT 1 FROM public.league_seasons selected_season
  JOIN public.leagues selected_league ON selected_league.id=selected_season.league_id
  WHERE selected_season.id=$1::uuid AND selected_league.league_key=$${keyParameter}
    AND selected_season.season=$${seasonParameter}::integer)`;
const aggregate = `COALESCE((SELECT jsonb_agg(capture.evidence ORDER BY capture.native_week,capture.recorded_at,capture.observation_id)
  FROM (`;
const orderColumns = 'observation.week AS native_week,observation.recorded_at,observation.id AS observation_id';
export const RETAINED_MATCHUP_SCAN_SQL = `/* league-administration:scan-retained-matchups */
  SELECT ${identity(5, 6)} AS selection_valid, ${aggregate}
  SELECT ${orderColumns},${evidenceColumns} ${evidenceJoins}
  WHERE observation.league_season_id=$1::uuid AND observation.family='matchups'
    AND observation.week=ANY($2::smallint[])
    AND (content.id IS NULL OR (content.provider=$3 AND content.external_league_id=$4))
  ORDER BY observation.week,observation.recorded_at,observation.id LIMIT ${RETAINED_MATCHUP_INVENTORY_LIMIT + 1}
  ) capture),'[]'::jsonb) AS evidence_rows`;

export const RETAINED_MATCHUP_READ_SQL = `/* league-administration:read-retained-matchups */
  SELECT ${identity(4, 5)} AS selection_valid, ${aggregate}
  SELECT ${orderColumns},${evidenceColumns} ${evidenceJoins}
  WHERE observation.league_season_id=$1::uuid AND observation.family='matchups'
    AND observation.week=ANY($2::smallint[]) AND observation.id=ANY($3::uuid[])
  ORDER BY observation.week,observation.recorded_at,observation.id LIMIT ${RETAINED_MATCHUP_BATCH_LIMIT + 1}
  ) capture),'[]'::jsonb) AS evidence_rows`;

function evidenceRows(rows: readonly DatabaseRow[], limit: number): RetainedMatchupRead {
  try {
    if (rows.length !== 1 || typeof rows[0].selection_valid !== 'boolean') throw new Error('Invalid retained scope result.');
    if (!rows[0].selection_valid) return { status: 'unavailable', reason: 'retained_matchup_scope_mismatch' };
    const values: unknown = typeof rows[0].evidence_rows === 'string' ? JSON.parse(rows[0].evidence_rows) : rows[0].evidence_rows;
    if (!Array.isArray(values)) throw new Error('Invalid retained inventory.');
    if (values.length > limit) return { status: 'unavailable', reason: limit === RETAINED_MATCHUP_INVENTORY_LIMIT
      ? 'retained_matchup_inventory_limit_exceeded' : 'invalid_retained_matchup_evidence' };
    const evidence = values.map(value => {
      if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid retained evidence row.');
      // Individual immutable lineage/value checks belong to the same-capture projector.
      return value as RetainedMatchupEvidence;
    });
    if (evidence.some(value => Array.isArray(value.mappingCandidates)
      && value.mappingCandidates.length > RETAINED_MATCHUP_MAPPING_LIMIT)) {
      return { status: 'unavailable', reason: 'retained_matchup_mapping_limit_exceeded' };
    }
    return { status: 'available', evidence };
  } catch { return { status: 'unavailable', reason: 'invalid_retained_matchup_evidence' }; }
}

/** Internal history reads only: no current pointers, reservations, writer functions or provider clients. */
export function retainedMatchupMethods(client: DatabaseClient) {
  return {
    async scanRetainedMatchups(selection: RetainedMatchupSelection): Promise<RetainedMatchupRead> {
      if (!isRetainedMatchupSelection(selection)) return { status: 'unavailable', reason: 'invalid_retained_matchup_selection' };
      try {
        const rows = await client.query(RETAINED_MATCHUP_SCAN_SQL,
          [selection.leagueSeasonId, selection.nativeWeeks, selection.scope.provider, selection.scope.externalLeagueId,
            selection.scope.leagueKey, selection.scope.season]);
        return evidenceRows(rows, RETAINED_MATCHUP_INVENTORY_LIMIT);
      } catch { return { status: 'unavailable', reason: 'retained_matchup_database_unavailable' }; }
    },
    async readRetainedMatchups(selection: RetainedMatchupSelection, observationIds: readonly string[]): Promise<RetainedMatchupRead> {
      if (!isRetainedMatchupSelection(selection) || !Array.isArray(observationIds)
        || observationIds.length > RETAINED_MATCHUP_BATCH_LIMIT || observationIds.some(id => !isRetainedMatchupId(id))
        || new Set(observationIds).size !== observationIds.length) {
        return { status: 'unavailable', reason: 'invalid_retained_matchup_selection' };
      }
      if (!observationIds.length) return { status: 'available', evidence: [] };
      try {
        const rows = await client.query(RETAINED_MATCHUP_READ_SQL,
          [selection.leagueSeasonId, selection.nativeWeeks, observationIds, selection.scope.leagueKey, selection.scope.season]);
        return evidenceRows(rows, RETAINED_MATCHUP_BATCH_LIMIT);
      } catch { return { status: 'unavailable', reason: 'retained_matchup_database_unavailable' }; }
    },
  };
}
