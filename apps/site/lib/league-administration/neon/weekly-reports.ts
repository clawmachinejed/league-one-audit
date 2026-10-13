import 'server-only';
import type { DatabaseClient, DatabaseRow } from '../../database';
import { WEEKLY_REPORT_POLICY, WEEKLY_REPORT_VERSION, WEEKLY_REPORT_VALUE_BYTE_LIMIT, weeklyReportScope, projectWeeklyReport,
  type AcceptedWeeklyReportRead, type WeeklyReportSelection, type WeeklyReportValue } from '../../aggregator/weekly-reports';
import { canonicalStoredOfficialDecimal } from '../../aggregator/exact-matchup-values';
import type { RosterAttempt } from '../../aggregator/current-roster';
import { compatibleRevision } from '../../projections/shared/revision-compatibility';
import type { AdministrationEnvelope, AdministrationWriteFence } from '../contracts';
import type { AdministrationSourceMapping } from '../source-mapping';
import { normalizeAdministrationObservation } from '../normalize';
import { parsePublicCaptureWitness } from '../public-capture-witness';

const fact = (column: string, native = column, decimal = false) => `jsonb_build_object('state',team.field_states->'${native}',
  'value',team.${column}${decimal ? '::text' : ''},'sourcePath','data.metadata.data.standings['||team.source_ordinal||'].${native}')`;
const typedTeam = `jsonb_build_object('externalRosterId',team.external_roster_id,'sourceOrdinal',team.source_ordinal,
  'round',${fact('round')},'providerRank',${fact('rank')},'record',${fact('record')},'streak',${fact('streak')},
  'wins',${fact('wins')},'losses',${fact('losses')},'ties',${fact('ties')},
  'pointsFor',${fact('points_for', 'points', true)},'pointsAgainst',${fact('points_against', 'points_against', true)})`;

/** Select latest reservation before qualification: a failed newer attempt cannot borrow history. */
export const ACCEPTED_WEEKLY_REPORT_SQL = `/* league-administration:read-accepted-weekly-report */
  SELECT scope.identity,head.latest_ordinal,head.accepted_id AS head_accepted_id,head.generation AS head_generation,
    accepted.id AS acceptance_id,accepted.generation,accepted.source_mapping_revision_id,
    receipt.id AS receipt_id,receipt.attempt_id,receipt.provenance,receipt.coverage,receipt.legacy_observation_id,
    receipt.configuration_content_id,receipt.population_evidence,receipt.expected_team_count,
    attempt.id AS reserved_attempt_id,attempt.ordinal,attempt.expected_generation,attempt.source_mapping,
    attempt.capture_nonce,attempt.write_fence,
    CASE WHEN receipt.provenance->'acquisition' IS NULL THEN
      COALESCE((receipt.provenance->>'requestStartedAt')::timestamptz>=attempt.reserved_at,false) ELSE false END AS capture_after_reservation,
    content.id AS content_id,content.content_hash,content.semantic_hash,content.payload,content.normalized_value,
    content.normalizer_version,content.completeness,content.accepted AS content_accepted,
    content.league_season_id,content.provider,content.external_league_id,content.family,content.week,
    observation.content_id AS observation_content_id,observation.league_season_id AS observation_league_season_id,
    to_jsonb(header.*) AS value_header,
    (SELECT first_receipt.content_id FROM public.league_roster_resource_acceptances first_acceptance
      JOIN public.league_roster_capture_receipts first_receipt ON first_receipt.id=first_acceptance.receipt_id
      WHERE first_acceptance.id=header.first_acceptance_id) AS first_acceptance_content_id,
    CASE WHEN header.content_id IS NOT NULL THEN jsonb_build_object('family','weekly_report','season',2026,
      'nativeWeek',header.native_week,'reportKey',header.report_key,'publication',header.publication,'nativeReportWeek',header.native_report_week,
      'metadata',jsonb_build_object('created',jsonb_build_object('state',header.metadata_states->'created','value',header.created_value,'sourcePath','data.metadata.created'),
        'lastUpdated',jsonb_build_object('state',header.metadata_states->'last_updated','value',header.last_updated_value,'sourcePath','data.metadata.last_updated')),
      'teams',(SELECT COALESCE(jsonb_agg(${typedTeam} ORDER BY team.source_ordinal),'[]'::jsonb)
        FROM public.league_weekly_report_teams team WHERE team.content_id=content.id),'limitations',header.limitations) END AS typed_value,
    (SELECT COALESCE(jsonb_agg(jsonb_build_object('externalRosterId',team.external_roster_id,'seasonTeamId',team.season_team_id,
      'identityLeagueSeasonId',identity.league_season_id,'identityProvider',identity.provider,
      'identityExternalLeagueId',identity.external_league_id,'identityExternalRosterId',identity.external_roster_id)
      ORDER BY team.source_ordinal),'[]'::jsonb)
      FROM public.league_weekly_report_teams team JOIN public.league_season_teams identity ON identity.id=team.season_team_id
      WHERE team.content_id=content.id) AS identities
  FROM public.league_roster_resource_scopes scope
  JOIN public.league_roster_resource_heads head ON head.scope_id=scope.id
  JOIN public.league_roster_resource_attempts attempt ON attempt.scope_id=scope.id
  LEFT JOIN public.league_roster_capture_receipts receipt ON receipt.attempt_id=attempt.id
  LEFT JOIN public.league_roster_resource_acceptances accepted ON accepted.receipt_id=receipt.id AND accepted.scope_id=scope.id
  LEFT JOIN public.league_administration_contents content ON content.id=receipt.content_id
  LEFT JOIN public.league_administration_observations observation ON observation.id=receipt.legacy_observation_id
  LEFT JOIN public.league_weekly_report_contents header ON header.content_id=content.id
  JOIN public.league_source_connections connection ON connection.id=scope.connection_id AND connection.league_season_id=scope.league_season_id
  JOIN public.league_seasons season ON season.id=scope.league_season_id
  JOIN public.league_administration_enrollment_seasons enrollment ON enrollment.league_id=season.league_id
    AND enrollment.season=season.season AND enrollment.provider=connection.provider
  WHERE scope.identity=$1::jsonb AND connection.current_mapping_revision_id=$2::uuid AND connection.mapping_generation=$3 AND season.season=2026
    AND (($4::uuid IS NULL AND attempt.ordinal=head.latest_ordinal) OR ($4::uuid IS NOT NULL AND receipt.id=$4::uuid)) LIMIT 2`;

function object(value: unknown): Record<string, unknown> {
  if (typeof value === 'string') return object(JSON.parse(value));
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid stored report object.');
  return value as Record<string, unknown>;
}
const same = (left: unknown, right: unknown) => left === undefined || right === undefined
  ? left === right : compatibleRevision(left) === compatibleRevision(right);
function uuid(value: unknown): string {
  if (typeof value !== 'string' || !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/iu.test(value)) throw new Error('Invalid report identity.');
  return value;
}
function ordinal(value: unknown, minimum = 0): number {
  const parsed = typeof value === 'number' || typeof value === 'string' && /^\d+$/u.test(value) ? Number(value) : NaN;
  if (!Number.isSafeInteger(parsed) || parsed < minimum) throw new Error('Invalid report ordinal.');
  return parsed;
}
const unavailable = (reason = 'weekly_report_evidence_unavailable'): AcceptedWeeklyReportRead => ({ status: 'unavailable', reason });
export function weeklyReportCoverage(nativeWeek: number) {
  return { periodIds: [`sleeper:report-week:${nativeWeek}`], interval: null, entitySet: 'unknown',
    fields: ['key', 'type', 'data.week', 'data.standings', 'created', 'last_updated'], pagination: 'complete', nextCursor: null,
    completeness: 'complete', reasons: ['report_population_unproved'] };
}

export function readAcceptedWeeklyReportRows(rows: readonly DatabaseRow[], mapping: AdministrationSourceMapping,
  selection: WeeklyReportSelection): AcceptedWeeklyReportRead {
  try {
    const scope = weeklyReportScope(mapping, selection.nativeWeek);
    if (selection.reportReceiptId !== undefined) uuid(selection.reportReceiptId);
    if (!rows.length) return { status: 'missing', reason: 'report_capture_missing' };
    if (rows.length !== 1 || Buffer.byteLength(JSON.stringify(rows[0]), 'utf8') > 32 * 1024 * 1024) throw new Error('Invalid report row bounds.');
    const row = rows[0], reservedAttemptId = uuid(row.reserved_attempt_id);
    if (!same(row.identity, { scope, policy: WEEKLY_REPORT_POLICY }) || !same(row.source_mapping, mapping)) throw new Error('Wrong report scope.');
    ordinal(row.ordinal, 1); ordinal(row.latest_ordinal, 1);
    if (selection.reportReceiptId === undefined && ordinal(row.ordinal) !== ordinal(row.latest_ordinal)) throw new Error('Stale report attempt.');
    if (row.receipt_id === null) return unavailable('latest_report_attempt_has_no_capture');
    const receiptId = uuid(row.receipt_id);
    if (selection.reportReceiptId !== undefined && selection.reportReceiptId !== receiptId) throw new Error('Wrong report receipt.');
    if (row.acceptance_id === null) return unavailable('report_capture_not_accepted');
    const contentId = uuid(row.content_id), acceptanceId = uuid(row.acceptance_id), generation = ordinal(row.generation, 1);
    uuid(row.legacy_observation_id);
    const provenance = object(row.provenance) as AdministrationEnvelope['provenance'];
    if (row.attempt_id !== reservedAttemptId || row.source_mapping_revision_id !== mapping.revisionId
      || row.league_season_id !== mapping.leagueSeasonId || row.provider !== mapping.scope.provider
      || row.external_league_id !== mapping.scope.externalLeagueId || row.family !== 'weekly_report' || Number(row.week) !== selection.nativeWeek
      || row.normalizer_version !== 'sleeper-administration-v1' || row.content_accepted !== true || row.completeness !== 'complete'
      || row.observation_content_id !== contentId || row.observation_league_season_id !== mapping.leagueSeasonId
      || row.configuration_content_id !== null || row.population_evidence !== null || row.expected_team_count !== null
      || generation !== ordinal(row.expected_generation) + 1 || provenance.origin !== 'network'
      || !same(row.coverage, weeklyReportCoverage(selection.nativeWeek))
      || selection.reportReceiptId === undefined && (row.head_accepted_id !== acceptanceId || ordinal(row.head_generation) !== generation)) {
      throw new Error('Invalid report receipt lineage.');
    }
    const clocks = [provenance.requestStartedAt, provenance.requestCompletedAt, provenance.sourceObservedAt, provenance.checkedAt];
    if (!clocks.every(clock => typeof clock === 'string' && Number.isFinite(Date.parse(clock)))
      || Date.parse(clocks[0]!) > Date.parse(clocks[1]!) || Date.parse(clocks[1]!) > Date.parse(clocks[3]!)
      || Date.parse(clocks[2]!) > Date.parse(clocks[3]!)) throw new Error('Invalid report source clocks.');
    if (provenance.acquisition !== undefined) {
      const witness = parsePublicCaptureWitness(provenance.acquisition);
      if (witness.work.kind !== 'weekly-report' || witness.work.nativeWeek !== selection.nativeWeek || witness.work.season !== 2026
        || witness.work.externalLeagueId !== mapping.scope.externalLeagueId || !same(witness.mapping, mapping)
        || !same(witness.fence, row.write_fence) || witness.attempts.weekly_report?.id !== reservedAttemptId
        || witness.attempts.weekly_report?.nonce !== row.capture_nonce) throw new Error('Invalid report acquisition binding.');
    } else if (row.capture_after_reservation !== true) throw new Error('Report capture predates reservation.');
    const normalized = normalizeAdministrationObservation({ schemaVersion: 'league-administration-v1', normalizerVersion: 'sleeper-administration-v1',
      dialect: 'sleeper-nfl-v1', scope: mapping.scope, family: 'weekly_report', week: selection.nativeWeek, completeness: 'complete',
      provenance, payload: row.payload as AdministrationEnvelope['payload'] });
    if (normalized.status !== 'accepted' || normalized.contentHash !== row.content_hash || normalized.semanticHash !== row.semantic_hash
      || !same(normalized.value, row.normalized_value)) throw new Error('Invalid report native normalization.');
    const projected = projectWeeklyReport(normalized);
    if (projected.status !== 'accepted') throw new Error('Invalid report native structure.');
    if (row.value_header === null) return { status: 'missing', reason: 'typed_report_not_recorded' };
    const header = object(row.value_header), typed = structuredClone(object(row.typed_value)) as unknown as WeeklyReportValue;
    uuid(header.first_acceptance_id);
    if (!Array.isArray(typed.teams) || Buffer.byteLength(JSON.stringify(typed), 'utf8') > WEEKLY_REPORT_VALUE_BYTE_LIMIT) throw new Error('Invalid report typed size.');
    for (const team of typed.teams) for (const key of ['pointsFor', 'pointsAgainst'] as const) {
      const field = team[key];
      if (field.state === 'known') (field as { value: string }).value = canonicalStoredOfficialDecimal(field.value);
    }
    if (header.content_id !== contentId || row.first_acceptance_content_id !== contentId || header.value_version !== WEEKLY_REPORT_VERSION
      || Number(header.native_week) !== selection.nativeWeek || header.report_key !== projected.value.reportKey
      || header.publication !== projected.value.publication || header.native_report_week !== projected.value.nativeReportWeek
      || Number(header.team_count) !== projected.value.teams.length || !same(header.limitations, projected.value.limitations)
      || !same(typed, projected.value)) throw new Error('Report typed native parity mismatch.');
    if (!Array.isArray(row.identities) || row.identities.length !== projected.value.teams.length) throw new Error('Missing report team identities.');
    const identities = new Map<string, string>();
    for (const raw of row.identities) {
      const identity = object(raw);
      if (typeof identity.externalRosterId !== 'string' || identities.has(identity.externalRosterId)
        || identity.identityLeagueSeasonId !== mapping.leagueSeasonId || identity.identityProvider !== mapping.scope.provider
        || identity.identityExternalLeagueId !== mapping.scope.externalLeagueId || identity.identityExternalRosterId !== identity.externalRosterId) {
        throw new Error('Foreign report team identity.');
      }
      identities.set(identity.externalRosterId, uuid(identity.seasonTeamId));
    }
    if (new Set(identities.values()).size !== identities.size) throw new Error('Duplicate report canonical identity.');
    const teams = projected.value.teams.map(team => {
      const seasonTeamId = identities.get(team.externalRosterId);
      if (!seasonTeamId) throw new Error('Unmapped report team.');
      return { ...team, seasonTeamId };
    });
    return { status: 'available', version: WEEKLY_REPORT_VERSION, selection: selection.reportReceiptId === undefined ? 'current' : 'receipt',
      contentId, reportReceiptId: receiptId, acceptanceId, acceptedGeneration: generation, sourceMappingRevisionId: mapping.revisionId,
      provenance, freshness: 'unknown', historicalApplicability: 'report-only', value: { ...projected.value, teams } };
  } catch { return unavailable(); }
}

export function weeklyReportMethods(client: DatabaseClient) {
  return {
    async beginWeeklyReportAttempt(mapping: AdministrationSourceMapping, nativeWeek: number, id: string,
      fence?: AdministrationWriteFence): Promise<RosterAttempt> {
      weeklyReportScope(mapping, nativeWeek); uuid(id);
      const rows = await client.query(`/* league-administration:begin-weekly-report-attempt */
        SELECT public.begin_weekly_report_attempt($1::jsonb,$2::integer,$3::uuid,$4::jsonb) AS result`,
      [JSON.stringify(mapping), nativeWeek, id, fence ? JSON.stringify(fence) : null]);
      const row = object(rows.length === 1 ? rows[0].result : null);
      if (row.id !== id) throw new Error('Wrong report reservation.');
      return { id, scopeId: uuid(row.scopeId), ordinal: ordinal(row.ordinal, 1), expectedGeneration: ordinal(row.expectedGeneration) };
    },
    async readAcceptedWeeklyReport(mapping: AdministrationSourceMapping, selection: WeeklyReportSelection): Promise<AcceptedWeeklyReportRead> {
      try {
        const scope = weeklyReportScope(mapping, selection.nativeWeek);
        if (selection.reportReceiptId !== undefined) uuid(selection.reportReceiptId);
        const rows = await client.query(ACCEPTED_WEEKLY_REPORT_SQL, [JSON.stringify({ scope, policy: WEEKLY_REPORT_POLICY }),
          mapping.revisionId, mapping.generation, selection.reportReceiptId ?? null]);
        return readAcceptedWeeklyReportRows(rows, mapping, selection);
      } catch { return unavailable(); }
    },
  };
}
