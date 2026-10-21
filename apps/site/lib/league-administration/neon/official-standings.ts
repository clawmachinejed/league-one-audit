import 'server-only';
import type { DatabaseClient, DatabaseRow } from '../../database';
import { CURRENT_ROSTER_POLICY, currentRosterScope } from '../../aggregator/current-roster';
import { OFFICIAL_STANDINGS_VERSION, OFFICIAL_STANDINGS_BYTE_LIMIT, projectOfficialStandings,
  type OfficialStandingsRead, type OfficialStandingsSelection } from '../../aggregator/official-standings';
import type { AdministrationEnvelope } from '../contracts';
import type { AdministrationSourceMapping } from '../source-mapping';
import { isAdministrationSourceMapping } from '../source-mapping';
import { normalizeAdministrationObservation } from '../normalize';
import { parsePublicCaptureWitness } from '../public-capture-witness';
import { compatibleRevision } from '../../projections/shared/revision-compatibility';

const fact = (column: string) => `jsonb_build_object('state',team.field_states->'${column}','value',team.${column},'sourcePath','settings.${column}')`;
const points = (whole: string, fraction: string, prefix: string) => `jsonb_build_object('whole',${fact(whole)},'fraction',${fact(fraction)},
  'state',team.${prefix}_state,'value',team.${prefix}_value,'policy','sleeper-whole-plus-hundredths-v1')`;
const typedTeam = `jsonb_build_object('externalRosterId',team.external_roster_id,'sourceOrdinal',team.source_ordinal,
  'record',jsonb_build_object('wins',${fact('wins')},'losses',${fact('losses')},'ties',${fact('ties')}),
  'pointsFor',${points('fpts', 'fpts_decimal', 'points_for')},'pointsAgainst',${points('fpts_against', 'fpts_against_decimal', 'points_against')},
  'providerRank',${fact('rank')},'providerSeed',${fact('seed')})`;

/** Keep the unwitnessed boundary at PostgreSQL precision; witnesses qualify independently. */
export const OFFICIAL_STANDINGS_POPULATION_TIME_SQL = `CASE
    WHEN selected.provenance->'acquisition' IS NULL
      AND selected.population_evidence->'provenance'->'acquisition' IS NULL
    THEN COALESCE((selected.population_evidence->'provenance'->>'requestStartedAt')::timestamptz >= selected.reserved_at,false)
    ELSE false END`;

/** Select the latest reservation before joining qualification. A failed newer attempt never borrows an older fact. */
export const OFFICIAL_STANDINGS_SQL = `/* league-administration:read-official-standings */
  WITH selected AS (
    SELECT scope.id AS scope_id,scope.identity,scope.league_season_id,attempt.id AS attempt_id,
      attempt.ordinal,attempt.source_mapping,attempt.capture_nonce,attempt.write_fence,attempt.reserved_at,
      receipt.id AS receipt_id,receipt.content_id,receipt.legacy_observation_id,public.roster_capture_provenance(receipt) AS provenance,
      receipt.configuration_content_id,public.roster_capture_population_evidence(receipt) AS population_evidence,receipt.expected_team_count
    FROM public.league_roster_resource_scopes scope
    JOIN public.league_source_connections connection ON connection.id=scope.connection_id
      AND connection.league_season_id=scope.league_season_id
    JOIN public.league_roster_resource_heads head ON head.scope_id=scope.id
    JOIN public.league_roster_resource_attempts attempt ON attempt.scope_id=scope.id
    LEFT JOIN public.league_roster_capture_receipts receipt ON receipt.attempt_id=attempt.id
    WHERE scope.identity=$1::jsonb AND connection.current_mapping_revision_id=$2::uuid
      AND connection.mapping_generation=$3
      AND (($4::uuid IS NULL AND attempt.ordinal=head.latest_ordinal) OR ($4::uuid IS NOT NULL AND receipt.id=$4::uuid))
    LIMIT 2
  )
  SELECT selected.*,${OFFICIAL_STANDINGS_POPULATION_TIME_SQL} AS population_after_reservation,
    content.provider,content.external_league_id,content.family,content.week,
    content.content_hash,content.semantic_hash,content.payload,content.normalizer_version,content.completeness,
    observation.content_id AS observation_content_id,observation.league_season_id AS observation_league_season_id,
    to_jsonb(qualification.*) AS qualification,to_jsonb(header.*) AS value_header,
    to_jsonb(configuration.*) AS configuration_content,to_jsonb(population_observation.*) AS population_observation,
    first_receipt.content_id AS first_receipt_content_id,
    CASE WHEN header.content_id IS NOT NULL THEN jsonb_build_object('version',header.value_version,
      'status',header.structural_status,'reasons',header.reasons,'teams',
      (SELECT COALESCE(jsonb_agg(${typedTeam} ORDER BY team.source_ordinal),'[]'::jsonb)
       FROM public.league_official_standings_teams team WHERE team.content_id=content.id)) END AS typed_value,
    (SELECT COALESCE(jsonb_agg(jsonb_build_object('externalRosterId',team.external_roster_id,
      'seasonTeamId',team.season_team_id,'identityLeagueSeasonId',identity.league_season_id,
      'identityProvider',identity.provider,'identityExternalLeagueId',identity.external_league_id,
      'identityExternalRosterId',identity.external_roster_id) ORDER BY team.source_ordinal),'[]'::jsonb)
      FROM public.league_official_standings_teams team
      JOIN public.league_season_teams identity ON identity.id=team.season_team_id
      WHERE team.content_id=content.id) AS identities
  FROM selected
  LEFT JOIN public.league_administration_contents content ON content.id=selected.content_id
  LEFT JOIN public.league_administration_observations observation ON observation.id=selected.legacy_observation_id
  LEFT JOIN public.league_administration_contents configuration ON configuration.id=selected.configuration_content_id
  LEFT JOIN public.league_administration_observations population_observation
    ON population_observation.id=(selected.population_evidence->>'observationId')::uuid
  LEFT JOIN public.league_official_standings_captures qualification ON qualification.receipt_id=selected.receipt_id
  LEFT JOIN public.league_official_standings_contents header ON header.content_id=selected.content_id
  LEFT JOIN public.league_roster_capture_receipts first_receipt ON first_receipt.id=header.first_receipt_id`;

/** Only the explicit canonical API historical branch uses this bounded immutable-revision selector.
 * The original current/legacy API above retains its existing current-mapping requirement. */
export const HISTORICAL_OFFICIAL_STANDINGS_SQL = OFFICIAL_STANDINGS_SQL
  .replace('league-administration:read-official-standings', 'league-administration:read-historical-legacy-standings')
  .replace(`connection.current_mapping_revision_id=$2::uuid
      AND connection.mapping_generation=$3`, `EXISTS (SELECT 1 FROM public.league_source_mapping_revisions revision
        WHERE revision.id=$2::uuid AND revision.connection_id=scope.connection_id
          AND revision.league_season_id=scope.league_season_id AND revision.generation=$3
          AND revision.provider='sleeper' AND revision.native_namespace='nfl'
          AND revision.external_league_id=attempt.source_mapping->'scope'->>'externalLeagueId'
          AND revision.source_namespace='nfl:2026')`);

function object(value: unknown): Record<string, unknown> {
  if (typeof value === 'string') return object(JSON.parse(value));
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid standings object.');
  return value as Record<string, unknown>;
}
const same = (left: unknown, right: unknown) => left === undefined || right === undefined
  ? left === right : compatibleRevision(left) === compatibleRevision(right);
const uuid = (value: unknown): string => {
  if (typeof value !== 'string' || !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/iu.test(value)) throw new Error('Invalid standings identity.');
  return value;
};
function ordinal(value: unknown): number {
  const parsed = typeof value === 'number' || typeof value === 'string' && /^[1-9][0-9]*$/u.test(value) ? Number(value) : NaN;
  if (!Number.isSafeInteger(parsed) || parsed < 1) throw new Error('Invalid standings ordinal.');
  return parsed;
}
const unavailable = (reason: string): OfficialStandingsRead => ({ status: 'unavailable', reason });

export function readOfficialStandingsRows(rows: readonly DatabaseRow[], mapping: AdministrationSourceMapping,
  selection: OfficialStandingsSelection): OfficialStandingsRead {
  try {
    if (!isAdministrationSourceMapping(mapping) || mapping.scope.season !== 2026) throw new Error('Invalid standings mapping.');
    if (selection.rosterReceiptId !== undefined) uuid(selection.rosterReceiptId);
    if (!rows.length) return { status: 'missing', reason: 'roster_capture_missing' };
    if (rows.length !== 1 || Buffer.byteLength(JSON.stringify(rows[0]), 'utf8') > 32 * 1024 * 1024) throw new Error('Invalid standings row bounds.');
    const row = rows[0];
    if (!same(row.identity, { scope: currentRosterScope(mapping), policy: CURRENT_ROSTER_POLICY })
      || !same(row.source_mapping, mapping) || row.league_season_id !== mapping.leagueSeasonId) throw new Error('Invalid standings attempt scope.');
    const attemptId = uuid(row.attempt_id), attemptOrdinal = ordinal(row.ordinal);
    if (row.receipt_id === null) return unavailable('latest_roster_attempt_has_no_capture');
    const receiptId = uuid(row.receipt_id), contentId = uuid(row.content_id), observationId = uuid(row.legacy_observation_id);
    if (selection.rosterReceiptId !== undefined && selection.rosterReceiptId !== receiptId) throw new Error('Wrong standings receipt.');
    if (row.qualification === null) return { status: 'missing', reason: 'typed_standings_not_recorded' };
    if (typeof row.population_after_reservation !== 'boolean') throw new Error('Invalid standings population time evidence.');
    const marker = object(row.qualification), header = object(row.value_header);
    const provenance = object(row.provenance) as AdministrationEnvelope['provenance'];
    const population = row.population_evidence === null ? null : object(row.population_evidence);
    const populationProvenance = population?.provenance ? object(population.provenance) : null;
    const sameAcquisition = provenance.acquisition !== undefined
      ? same(populationProvenance?.acquisition, provenance.acquisition)
      : populationProvenance !== null && populationProvenance.acquisition === undefined
        && row.population_after_reservation;
    const configurationContentId = row.configuration_content_id === null ? null : uuid(row.configuration_content_id);
    // The legacy count also requires projection/scoring compatibility. Qualify
    // native population directly from this receipt's independently linked league document.
    let expectedTeamCount: number | null = null;
    if (sameAcquisition && configurationContentId && row.configuration_content && row.population_observation) {
      const configuration = object(row.configuration_content), observation = object(row.population_observation);
      const payload = object(configuration.payload), count = payload.total_rosters;
      if (configuration.id === configurationContentId && configuration.league_season_id === mapping.leagueSeasonId
        && configuration.provider === mapping.scope.provider && configuration.external_league_id === mapping.scope.externalLeagueId
        && configuration.family === 'league' && Number(configuration.week) === 0
        && configuration.normalizer_version === 'sleeper-administration-v1' && configuration.accepted === true
        && configuration.completeness === 'complete' && configuration.content_hash === population?.contentHash
        && payload.league_id === mapping.scope.externalLeagueId && payload.season === String(mapping.scope.season) && payload.sport === 'nfl'
        && observation.id === population?.observationId && observation.content_id === configurationContentId
        && observation.league_season_id === mapping.leagueSeasonId && observation.family === 'league' && Number(observation.week) === 0
        && typeof count === 'number' && Number.isInteger(count) && count > 0 && count <= 2_147_483_647) {
        expectedTeamCount = count;
      }
    }
    if (marker.receipt_id !== receiptId || marker.content_id !== contentId || marker.attempt_id !== attemptId
      || ordinal(marker.attempt_ordinal) !== attemptOrdinal || !same(marker.source_mapping, mapping)
      || marker.value_version !== OFFICIAL_STANDINGS_VERSION || marker.expected_team_count !== expectedTeamCount
      || header.content_id !== contentId || header.value_version !== OFFICIAL_STANDINGS_VERSION
      || row.first_receipt_content_id !== contentId || !uuid(header.first_receipt_id)
      || row.provider !== mapping.scope.provider || row.external_league_id !== mapping.scope.externalLeagueId
      || row.family !== 'rosters' || Number(row.week) !== 0 || row.normalizer_version !== 'sleeper-administration-v1'
      || row.observation_content_id !== contentId || row.observation_league_season_id !== mapping.leagueSeasonId
      || provenance.origin !== 'network' || row.completeness === 'complete' && !provenance.sourceObservedAt
      || !provenance.requestStartedAt || !provenance.requestCompletedAt) {
      throw new Error('Invalid standings capture lineage.');
    }
    if (provenance.acquisition !== undefined) {
      const witness = parsePublicCaptureWitness(provenance.acquisition);
      if (witness.work.kind !== 'core' || witness.work.season !== 2026 || !same(witness.mapping, mapping)
        || witness.attempts.players.id !== attemptId || witness.attempts.players.nonce !== row.capture_nonce
        || !same(witness.fence, row.write_fence) || marker.intake_id !== witness.work.requestId
        || marker.worker_id !== witness.fence.workerId || Number(marker.generation) !== witness.fence.generation) {
        throw new Error('Invalid standings acquisition binding.');
      }
    } else if (marker.intake_id !== null || marker.worker_id !== null || marker.generation !== null) {
      throw new Error('Unwitnessed standings request binding.');
    }
    const start = Date.parse(provenance.requestStartedAt!);
    const completed = Date.parse(provenance.requestCompletedAt!);
    const observed = provenance.sourceObservedAt === null ? null : Date.parse(provenance.sourceObservedAt!);
    const checked = Date.parse(provenance.checkedAt);
    if (![start, completed, checked].every(Number.isFinite) || start > completed
      || completed > checked || observed !== null && (!Number.isFinite(observed) || observed > checked) || !['complete', 'partial'].includes(String(row.completeness))) {
      throw new Error('Invalid standings capture time.');
    }
    const normalized = normalizeAdministrationObservation({ schemaVersion: 'league-administration-v1',
      normalizerVersion: 'sleeper-administration-v1', dialect: 'sleeper-nfl-v1', scope: mapping.scope,
      family: 'rosters', week: null, completeness: row.completeness as AdministrationEnvelope['completeness'],
      provenance, payload: row.payload as AdministrationEnvelope['payload'] });
    // Legacy normalization can reject unrelated players/ownership or population fields.
    if (normalized.contentHash !== row.content_hash) throw new Error('Invalid standings native content.');
    const projection = projectOfficialStandings(normalized);
    if (Buffer.byteLength(JSON.stringify(row.typed_value), 'utf8') > OFFICIAL_STANDINGS_BYTE_LIMIT
      || !same(row.typed_value, projection) || header.structural_status !== projection.status
      || Number(header.team_count) !== projection.teams.length || !same(header.reasons, projection.reasons)) {
      throw new Error('Typed standings native parity mismatch.');
    }
    if (projection.status !== 'qualified') return unavailable(`official_standings_${projection.status}`);
    if (!Array.isArray(row.identities) || row.identities.length !== projection.teams.length) throw new Error('Missing standings team identities.');
    const identities = new Map<string, string>();
    for (const raw of row.identities) {
      const identity = object(raw);
      if (typeof identity.externalRosterId !== 'string' || identities.has(identity.externalRosterId)
        || identity.identityLeagueSeasonId !== mapping.leagueSeasonId || identity.identityProvider !== mapping.scope.provider
        || identity.identityExternalLeagueId !== mapping.scope.externalLeagueId
        || identity.identityExternalRosterId !== identity.externalRosterId) throw new Error('Foreign standings team identity.');
      identities.set(identity.externalRosterId, uuid(identity.seasonTeamId));
    }
    if (new Set(identities.values()).size !== identities.size) throw new Error('Duplicate canonical team identity.');
    const teams = projection.teams.map(team => {
      const seasonTeamId = identities.get(team.externalRosterId);
      if (!seasonTeamId) throw new Error('Unmapped standings team.');
      return { ...team, seasonTeamId };
    });
    const populationState = expectedTeamCount === null ? 'unproved' : expectedTeamCount === teams.length ? 'proven' : 'mismatch';
    const entitySet = row.completeness === 'complete' && populationState === 'proven' ? 'full'
      : populationState === 'mismatch' || row.completeness === 'partial' ? 'partial' : 'unknown';
    const recordCompleteness = teams.length === 0 ? 'unknown' : teams.every(team => Object.values(team.record).every(field => field.state === 'known')
      && team.pointsFor.state === 'known' && team.pointsAgainst.state === 'known') ? 'complete' : 'partial';
    const reasons = [...projection.reasons, ...(populationState === 'unproved' ? ['standings_population_unproved']
      : populationState === 'mismatch' ? ['standings_population_mismatch'] : []),
    ...(row.completeness === 'partial' ? ['standings_capture_partial'] : []),
    ...(recordCompleteness !== 'complete' ? ['standings_record_fields_incomplete'] : [])];
    if (marker.population_state !== populationState || marker.entity_set !== entitySet
      || marker.record_completeness !== recordCompleteness || !same(marker.reasons, reasons)) throw new Error('Invalid standings coverage.');
    return { status: 'available', version: OFFICIAL_STANDINGS_VERSION,
      selection: selection.rosterReceiptId === undefined ? 'current' : 'receipt', mapping,
      capture: { rosterReceiptId: receiptId, attemptId, ordinal: attemptOrdinal, contentId, legacyObservationId: observationId,
        provenance, configurationContentId, expectedTeamCount }, temporalContext: 'season-to-date',
      historicalApplicability: 'unverified', freshness: 'unknown',
      coverage: { population: populationState, entitySet, recordCompleteness, reasons }, teams };
  } catch { return unavailable('official_standings_evidence_unavailable'); }
}

export function officialStandingsMethods(client: DatabaseClient) {
  return {
    async readOfficialStandings(mapping: AdministrationSourceMapping, selection: OfficialStandingsSelection = {}): Promise<OfficialStandingsRead> {
      try {
        if (!isAdministrationSourceMapping(mapping) || mapping.scope.season !== 2026) throw new Error('Invalid standings mapping.');
        if (selection.rosterReceiptId !== undefined) uuid(selection.rosterReceiptId);
        const rows = await client.query(OFFICIAL_STANDINGS_SQL,
          [JSON.stringify({ scope: currentRosterScope(mapping), policy: CURRENT_ROSTER_POLICY }), mapping.revisionId,
            mapping.generation, selection.rosterReceiptId ?? null]);
        return readOfficialStandingsRows(rows, mapping, selection);
      } catch { return unavailable('official_standings_evidence_unavailable'); }
    },
  };
}
