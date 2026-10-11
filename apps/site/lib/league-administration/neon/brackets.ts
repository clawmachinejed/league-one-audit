import 'server-only';
import type { DatabaseClient, DatabaseRow } from '../../database';
import { BRACKET_POLICY, BRACKET_VALUE_VERSION, bracketScope, projectPlayoffBracket,
  type AcceptedBracketRead, type BracketFamily, type BracketSelection } from '../../aggregator/playoff-brackets';
import type { RosterAttempt } from '../../aggregator/current-roster';
import { compatibleRevision } from '../../projections/shared/revision-compatibility';
import type { AdministrationEnvelope, AdministrationWriteFence } from '../contracts';
import type { AdministrationSourceMapping } from '../source-mapping';
import { normalizeAdministrationObservation } from '../normalize';

/** Receipt reads retain immutable history, while every selection enforces the current mapping. */
export const ACCEPTED_BRACKET_SQL = `/* league-administration:read-accepted-bracket */
  SELECT scope.identity,accepted.id AS acceptance_id,accepted.generation,accepted.source_mapping_revision_id,
    receipt.id AS receipt_id,receipt.attempt_id,receipt.provenance,receipt.coverage,receipt.legacy_observation_id,
    receipt.configuration_content_id,receipt.population_evidence,receipt.expected_team_count,
    attempt.ordinal,attempt.expected_generation,attempt.source_mapping,
    content.id AS content_id,content.content_hash,content.semantic_hash,content.payload,content.normalized_value,
    content.normalizer_version,content.completeness,content.accepted AS content_accepted,
    content.league_season_id,content.provider,content.external_league_id,content.family,content.week,
    observation.content_id AS observation_content_id,observation.league_season_id AS observation_league_season_id,
    to_jsonb(typed_header.*) AS value_header,
    (SELECT first_receipt.content_id FROM public.league_roster_resource_acceptances first_acceptance
      JOIN public.league_roster_capture_receipts first_receipt ON first_receipt.id=first_acceptance.receipt_id
      WHERE first_acceptance.id=typed_header.first_acceptance_id) AS first_acceptance_content_id,
    (  SELECT jsonb_build_object('family',header.family,'season',2026,'publication',header.publication,
    'rounds',(SELECT COALESCE(jsonb_agg(jsonb_build_object('round',r.round,'externalMatchupIds',r.external_matchup_ids) ORDER BY r.round),'[]'::jsonb)
      FROM public.league_bracket_rounds r WHERE r.content_id=header.content_id),
    'matches',(SELECT COALESCE(jsonb_agg(jsonb_build_object('externalMatchupId',m.external_matchup_id,'round',m.round,'sourceOrdinal',m.source_ordinal,
      'entrants',(SELECT COALESCE(jsonb_agg(jsonb_build_object('slot',e.slot,
        'native',jsonb_build_object('state',e.native_state,'raw',e.native_raw,'value',CASE WHEN e.native_kind='roster' THEN jsonb_build_object('kind','roster','externalRosterId',e.external_roster_id)
          WHEN e.native_kind='advancement' THEN jsonb_build_object('kind','advancement','outcome',e.native_outcome,'externalMatchupId',e.native_source_matchup_id) END),
        'from',jsonb_build_object('state',e.from_state,'raw',e.from_raw,'value',CASE WHEN e.from_state='supplied' THEN jsonb_build_object('outcome',e.from_outcome,'externalMatchupId',e.from_source_matchup_id) END)) ORDER BY e.slot),'[]'::jsonb)
        FROM public.league_bracket_entrants e WHERE e.content_id=m.content_id AND e.external_matchup_id=m.external_matchup_id),
      'winner',(SELECT jsonb_build_object('state',r.field_state,'raw',r.raw_value,'value',r.external_roster_id) FROM public.league_bracket_results r WHERE r.content_id=m.content_id AND r.external_matchup_id=m.external_matchup_id AND r.outcome='winner'),
      'loser',(SELECT jsonb_build_object('state',r.field_state,'raw',r.raw_value,'value',r.external_roster_id) FROM public.league_bracket_results r WHERE r.content_id=m.content_id AND r.external_matchup_id=m.external_matchup_id AND r.outcome='loser'),
      'nativePosition',m.native_position,'extensions',m.extensions) ORDER BY m.source_ordinal),'[]'::jsonb) FROM public.league_bracket_matches m WHERE m.content_id=header.content_id),
    'edges',(SELECT COALESCE(jsonb_agg(jsonb_build_object('targetMatchupId',e.target_matchup_id,'slot',e.slot,'sourceMatchupId',e.source_matchup_id,
      'outcome',e.outcome,'origin',e.origin,'sourceMatchPresent',e.source_match_present) ORDER BY m.source_ordinal,e.slot),'[]'::jsonb)
      FROM public.league_bracket_edges e JOIN public.league_bracket_matches m ON m.content_id=e.content_id AND m.external_matchup_id=e.target_matchup_id WHERE e.content_id=header.content_id),
    'limitations',header.limitations) FROM public.league_bracket_contents header WHERE header.content_id=content.id) AS typed_value
  FROM public.league_roster_resource_scopes scope
  JOIN public.league_roster_resource_acceptances accepted ON accepted.scope_id=scope.id
  LEFT JOIN public.league_roster_resource_heads head ON head.scope_id=scope.id
  JOIN public.league_roster_capture_receipts receipt ON receipt.id=accepted.receipt_id
  JOIN public.league_roster_resource_attempts attempt ON attempt.id=receipt.attempt_id AND attempt.scope_id=scope.id
  JOIN public.league_administration_contents content ON content.id=receipt.content_id
  JOIN public.league_administration_observations observation ON observation.id=receipt.legacy_observation_id
  LEFT JOIN public.league_bracket_contents typed_header ON typed_header.content_id=content.id
  JOIN public.league_source_connections connection ON connection.id=scope.connection_id
    AND connection.league_season_id=scope.league_season_id AND connection.current_mapping_revision_id=accepted.source_mapping_revision_id
  JOIN public.league_seasons season ON season.id=scope.league_season_id
  JOIN public.league_administration_enrollment_seasons enrollment ON enrollment.league_id=season.league_id
    AND enrollment.season=season.season AND enrollment.provider=connection.provider
  WHERE scope.identity=$1::jsonb AND connection.current_mapping_revision_id=$2::uuid AND connection.mapping_generation=$3
    AND content.family=$4 AND content.week=0 AND season.season=2026
    AND (($5::uuid IS NULL AND head.accepted_id=accepted.id AND head.generation=accepted.generation)
      OR ($5::uuid IS NOT NULL AND receipt.id=$5::uuid))`;

function object(value: unknown): Record<string, unknown> {
  if (typeof value === 'string') return object(JSON.parse(value));
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid bracket storage object.');
  return value as Record<string, unknown>;
}
function uuid(value: unknown): string {
  if (typeof value !== 'string' || !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/iu.test(value)) throw new Error('Invalid bracket identity.');
  return value;
}
function ordinal(value: unknown, minimum = 0): number {
  const parsed = typeof value === 'number' || typeof value === 'string' && value !== '' ? Number(value) : NaN;
  if (!Number.isSafeInteger(parsed) || parsed < minimum) throw new Error('Invalid bracket ordinal.');
  return parsed;
}
const expectedCoverage = { periodIds: [], interval: null, entitySet: 'full', fields: ['r', 'm', 't1', 't2', 't1_from', 't2_from', 'w', 'l', 'p'],
  pagination: 'complete', nextCursor: null, completeness: 'complete', reasons: [] };

export function readAcceptedBracketRows(rows: readonly DatabaseRow[], mapping: AdministrationSourceMapping,
  selection: BracketSelection): AcceptedBracketRead {
  try {
    const scope = bracketScope(mapping, selection.family);
    if (selection.bracketReceiptId !== undefined) uuid(selection.bracketReceiptId);
    if (!rows.length) return { status: 'missing', reason: 'accepted_bracket_receipt_missing' };
    if (rows.length !== 1 || Buffer.byteLength(JSON.stringify(rows[0]), 'utf8') > 32 * 1024 * 1024) throw new Error('Invalid bracket result size.');
    const row = rows[0];
    const generation = ordinal(row.generation, 1);
    const contentId = uuid(row.content_id), receiptId = uuid(row.receipt_id), acceptanceId = uuid(row.acceptance_id);
    uuid(row.attempt_id); uuid(row.legacy_observation_id); ordinal(row.ordinal, 1);
    const provenance = object(row.provenance) as AdministrationEnvelope['provenance'];
    if (compatibleRevision(row.identity) !== compatibleRevision({ scope, policy: BRACKET_POLICY })
      || compatibleRevision(row.source_mapping) !== compatibleRevision(mapping)
      || row.source_mapping_revision_id !== mapping.revisionId || row.league_season_id !== mapping.leagueSeasonId
      || row.provider !== mapping.scope.provider || row.external_league_id !== mapping.scope.externalLeagueId
      || row.family !== selection.family || Number(row.week) !== 0 || row.normalizer_version !== 'sleeper-administration-v1'
      || row.content_accepted !== true || row.completeness !== 'complete'
      || row.observation_content_id !== contentId || row.observation_league_season_id !== mapping.leagueSeasonId
      || row.configuration_content_id !== null || row.population_evidence !== null || row.expected_team_count !== null
      || generation !== ordinal(row.expected_generation) + 1 || provenance.origin !== 'network'
      || !provenance.requestStartedAt || !provenance.requestCompletedAt || !provenance.sourceObservedAt
      || compatibleRevision(row.coverage) !== compatibleRevision(expectedCoverage)
      || selection.bracketReceiptId !== undefined && selection.bracketReceiptId !== receiptId) throw new Error('Invalid bracket receipt lineage.');
    const normalized = normalizeAdministrationObservation({ schemaVersion: 'league-administration-v1',
      normalizerVersion: 'sleeper-administration-v1', dialect: 'sleeper-nfl-v1', scope: mapping.scope, family: selection.family,
      week: null, completeness: 'complete', provenance, payload: row.payload as AdministrationEnvelope['payload'] });
    if (normalized.status !== 'accepted' || normalized.contentHash !== row.content_hash || normalized.semanticHash !== row.semantic_hash
      || compatibleRevision(normalized.value) !== compatibleRevision(row.normalized_value)) throw new Error('Invalid bracket native normalization.');
    const projected = projectPlayoffBracket(normalized);
    if (projected.status !== 'accepted') throw new Error('Invalid bracket structure.');
    if (row.value_header === null) return { status: 'missing', reason: 'typed_bracket_not_recorded' };
    const header = object(row.value_header);
    uuid(header.first_acceptance_id);
    if (header.content_id !== contentId || row.first_acceptance_content_id !== contentId || header.value_version !== BRACKET_VALUE_VERSION
      || header.family !== selection.family || header.publication !== projected.value.publication
      || header.match_count !== projected.value.matches.length || header.round_count !== projected.value.rounds.length
      || header.edge_count !== projected.value.edges.length || compatibleRevision(header.limitations) !== compatibleRevision(projected.value.limitations)
      || compatibleRevision(row.typed_value) !== compatibleRevision(projected.value)) throw new Error('Typed bracket native parity mismatch.');
    return { status: 'available', version: BRACKET_VALUE_VERSION, selection: selection.bracketReceiptId === undefined ? 'current' : 'receipt',
      contentId, bracketReceiptId: receiptId, acceptanceId, acceptedGeneration: generation, sourceMappingRevisionId: mapping.revisionId,
      provenance, value: projected.value };
  } catch { return { status: 'unavailable', reason: 'bracket_evidence_unavailable' }; }
}

export function bracketMethods(client: DatabaseClient) {
  return {
    async beginBracketAttempt(mapping: AdministrationSourceMapping, family: BracketFamily, id: string,
      fence?: AdministrationWriteFence): Promise<RosterAttempt> {
      bracketScope(mapping, family); uuid(id);
      const rows = await client.query(`/* league-administration:begin-bracket-attempt */
        SELECT public.begin_bracket_attempt($1::jsonb,$2::text,$3::uuid,$4::jsonb) AS result`,
      [JSON.stringify(mapping), family, id, fence ? JSON.stringify(fence) : null]);
      const row = object(rows.length === 1 ? rows[0].result : null);
      if (row.id !== id) throw new Error('Invalid bracket reservation.');
      return { id, scopeId: uuid(row.scopeId), ordinal: ordinal(row.ordinal, 1), expectedGeneration: ordinal(row.expectedGeneration) };
    },
    async readAcceptedBracket(mapping: AdministrationSourceMapping, selection: BracketSelection): Promise<AcceptedBracketRead> {
      try {
        const scope = bracketScope(mapping, selection.family);
        if (selection.bracketReceiptId !== undefined) uuid(selection.bracketReceiptId);
        const rows = await client.query(ACCEPTED_BRACKET_SQL,
          [JSON.stringify({ scope, policy: BRACKET_POLICY }), mapping.revisionId, mapping.generation, selection.family, selection.bracketReceiptId ?? null]);
        return readAcceptedBracketRows(rows, mapping, selection);
      } catch { return { status: 'unavailable', reason: 'bracket_evidence_unavailable' }; }
    },
  };
}
