import 'server-only';
import type { DatabaseClient, DatabaseRow } from '../../database';
import { compatibleRevision } from '../../projections/shared/revision-compatibility';
import { normalizeAdministrationObservation } from '../normalize';
import { isAdministrationSourceMapping, type AdministrationSourceMapping } from '../source-mapping';
import type { RosterAttempt } from '../../aggregator/current-roster';
import type { AdministrationWriteFence } from '../store-contracts';
import { isRetainedTransactionSelection, isTransactionCaptureId, RETAINED_TRANSACTION_BATCH_LIMIT,
  RETAINED_TRANSACTION_INVENTORY_LIMIT, TRANSACTIONS_POLICY, transactionsScope,
  type AcceptedTransactionsRead, type RetainedTransactionRead, type RetainedTransactionSelection,
  type TransactionCapture } from '../transaction-capture-contracts';

const time = (column: string) => `to_char(${column} AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;
const originalProvenance = `jsonb_build_object('origin',observation.origin,
  'requestStartedAt',${time('observation.request_started_at')},'requestCompletedAt',${time('observation.request_completed_at')},
  'sourceObservedAt',${time('observation.source_observed_at')},'checkedAt',${time('observation.checked_at')})`;
const exactProvenance = `candidate.provenance->>'origin'=observation.origin
  AND (candidate.provenance->>'requestStartedAt')::timestamptz IS NOT DISTINCT FROM observation.request_started_at
  AND (candidate.provenance->>'requestCompletedAt')::timestamptz IS NOT DISTINCT FROM observation.request_completed_at
  AND (candidate.provenance->>'sourceObservedAt')::timestamptz IS NOT DISTINCT FROM observation.source_observed_at
  AND (candidate.provenance->>'checkedAt')::timestamptz IS NOT DISTINCT FROM observation.checked_at`;
const receiptValue = `CASE WHEN receipt.id IS NULL THEN NULL ELSE jsonb_build_object('id',receipt.id,
  'attemptId',attempt.id,'ordinal',attempt.ordinal,'expectedGeneration',attempt.expected_generation,
  'provenance',receipt.provenance,'coverage',receipt.coverage,'acceptedGeneration',accepted.generation) END`;
function captureValue(retained: boolean) {
  return `jsonb_build_object('captureId',${retained ? 'observation.id' : 'receipt.id'},
  'captureKind','${retained ? 'original-observation' : 'receipt'}','leagueSeasonId',observation.league_season_id,
  'observationId',observation.id,'contentId',content.id,'week',observation.week,
  'envelope',jsonb_build_object('schemaVersion','league-administration-v1','normalizerVersion',content.normalizer_version,
    'dialect','sleeper-nfl-v1','scope',jsonb_build_object('leagueKey',league.league_key,'provider',content.provider,
      'externalLeagueId',content.external_league_id,'season',season.season),'family',content.family,'week',content.week,
    'provenance',${retained ? originalProvenance : 'receipt.provenance'},'completeness',content.completeness,'payload',content.payload),
  'contentHash',content.content_hash,'semanticHash',content.semantic_hash,'normalizedValue',content.normalized_value,
  'accepted',content.accepted,'outcome',observation.outcome,'orderingAt',${retained ? time('observation.ordering_at')
    : "COALESCE(receipt.provenance->>'sourceObservedAt',receipt.provenance->>'requestCompletedAt',receipt.provenance->>'checkedAt')"},
  'recordedAt',${time(retained ? 'observation.recorded_at' : 'receipt.recorded_at')},
  'mapping',CASE WHEN revision.id IS NULL THEN NULL ELSE attempt.source_mapping END,
  'seasonTeams',(SELECT COALESCE(jsonb_agg(jsonb_build_object('seasonTeamId',team.id,'externalRosterId',team.external_roster_id)
    ORDER BY team.external_roster_id),'[]'::jsonb) FROM public.league_season_teams team
    WHERE team.league_season_id=content.league_season_id AND team.provider=content.provider
      AND team.external_league_id=content.external_league_id), 'receipt',${receiptValue}) AS capture`;
}
const revisionJoin = `LEFT JOIN public.league_source_mapping_revisions revision
  ON revision.id::text=attempt.source_mapping->>'revisionId'
    AND revision.connection_id::text=attempt.source_mapping->>'connectionId'
    AND revision.league_season_id=content.league_season_id AND revision.provider=content.provider
    AND revision.external_league_id=content.external_league_id
    AND revision.generation::text=attempt.source_mapping->>'generation'
    AND revision.source_namespace='nfl:'||season.season::text`;
const retainedJoins = `FROM public.league_administration_observations observation
  LEFT JOIN public.league_administration_contents content ON content.id=observation.content_id
  JOIN public.league_seasons season ON season.id=observation.league_season_id
  JOIN public.leagues league ON league.id=season.league_id
  LEFT JOIN LATERAL (SELECT candidate.* FROM public.league_roster_capture_receipts candidate
    JOIN public.league_roster_resource_attempts candidate_attempt ON candidate_attempt.id=candidate.attempt_id
    JOIN public.league_roster_resource_scopes candidate_scope ON candidate_scope.id=candidate_attempt.scope_id
    WHERE candidate.legacy_observation_id=observation.id AND candidate.content_id=observation.content_id
      AND candidate_scope.identity->'scope'->>'family'='transactions'
      AND candidate_scope.identity->'scope'->>'scoringPeriodId'='sleeper:transaction-week:'||observation.week::text
      AND ${exactProvenance}
    ORDER BY candidate.recorded_at,candidate.id LIMIT 1) receipt ON true
  LEFT JOIN public.league_roster_resource_attempts attempt ON attempt.id=receipt.attempt_id
  LEFT JOIN public.league_roster_resource_acceptances accepted ON accepted.receipt_id=receipt.id
  ${revisionJoin}`;
const identity = (key: number, season: number) => `EXISTS(SELECT 1 FROM public.league_seasons selected
  JOIN public.leagues league ON league.id=selected.league_id
  WHERE selected.id=$1::uuid AND league.league_key=$${key} AND selected.season=$${season}::integer)`;
export const RETAINED_TRANSACTION_SCAN_SQL = `/* league-administration:scan-retained-transactions */
  SELECT ${identity(5, 6)} AS selection_valid, COALESCE((SELECT jsonb_agg(item.capture ORDER BY item.week,item.recorded_at,item.id)
    FROM (SELECT observation.week,observation.recorded_at,observation.id,${captureValue(true)} ${retainedJoins}
      WHERE observation.league_season_id=$1::uuid AND observation.family='transactions' AND observation.week=ANY($2::smallint[])
        AND (content.id IS NULL OR (content.provider=$3 AND content.external_league_id=$4))
      ORDER BY observation.week,observation.recorded_at,observation.id LIMIT ${RETAINED_TRANSACTION_INVENTORY_LIMIT + 1}) item),'[]'::jsonb) AS captures`;
export const RETAINED_TRANSACTION_READ_SQL = `/* league-administration:read-retained-transactions */
  SELECT ${identity(4, 5)} AS selection_valid, COALESCE((SELECT jsonb_agg(item.capture ORDER BY item.week,item.recorded_at,item.id)
    FROM (SELECT observation.week,observation.recorded_at,observation.id,${captureValue(true)} ${retainedJoins}
      WHERE observation.league_season_id=$1::uuid AND observation.family='transactions'
        AND observation.week=ANY($2::smallint[]) AND observation.id=ANY($3::uuid[])
        AND (content.id IS NULL OR (content.provider=$6 AND content.external_league_id=$7))
      ORDER BY observation.week,observation.recorded_at,observation.id LIMIT ${RETAINED_TRANSACTION_BATCH_LIMIT + 1}) item),'[]'::jsonb) AS captures`;
export const ACCEPTED_TRANSACTIONS_SQL = `/* league-administration:read-accepted-transactions */
  SELECT ${captureValue(false)},scope.identity,accepted.source_mapping_revision_id
  FROM public.league_roster_resource_scopes scope
  JOIN public.league_roster_resource_heads head ON head.scope_id=scope.id
  JOIN public.league_roster_resource_acceptances accepted ON accepted.id=head.accepted_id
    AND accepted.scope_id=scope.id AND accepted.generation=head.generation
  JOIN public.league_roster_capture_receipts receipt ON receipt.id=accepted.receipt_id
  JOIN public.league_roster_resource_attempts attempt ON attempt.id=receipt.attempt_id AND attempt.scope_id=scope.id
  JOIN public.league_administration_contents content ON content.id=receipt.content_id
  JOIN public.league_administration_observations observation ON observation.id=receipt.legacy_observation_id
    AND observation.content_id=content.id AND observation.league_season_id=content.league_season_id
  JOIN public.league_seasons season ON season.id=content.league_season_id
  JOIN public.leagues league ON league.id=season.league_id
  JOIN public.league_source_connections connection ON connection.id=scope.connection_id
    AND connection.league_season_id=scope.league_season_id AND connection.current_mapping_revision_id=accepted.source_mapping_revision_id
  JOIN public.league_administration_enrollment_seasons enrollment ON enrollment.league_id=season.league_id
    AND enrollment.season=season.season AND enrollment.provider=connection.provider
  JOIN public.league_administration_heads legacy ON legacy.league_season_id=content.league_season_id
    AND legacy.family='transactions' AND legacy.week=content.week AND legacy.read_conflict IS NULL
  JOIN public.league_administration_observations current_observation ON current_observation.id=legacy.accepted_observation_id
    AND current_observation.content_id=content.id
  ${revisionJoin}
  WHERE scope.identity=$1::jsonb AND connection.current_mapping_revision_id=$2::uuid
    AND connection.mapping_generation=$3 AND content.family='transactions' AND content.week=$4`;

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid transaction evidence.');
  return value as Record<string, unknown>;
}
function ordinal(value: unknown, minimum = 1): number {
  const parsed = typeof value === 'number' || typeof value === 'string' && value !== '' ? Number(value) : NaN;
  if (!Number.isSafeInteger(parsed) || parsed < minimum) throw new Error('Invalid transaction ordinal.');
  return parsed;
}
function capture(value: unknown): TransactionCapture {
  const row = object(value);
  if (!['captureId', 'leagueSeasonId', 'observationId', 'contentId'].every(key => isTransactionCaptureId(row[key]))
    || !['receipt', 'original-observation'].includes(String(row.captureKind))
    || !Number.isInteger(row.week) || Number(row.week) < 0 || Number(row.week) > 18
    || !Array.isArray(row.seasonTeams)) throw new Error('Invalid transaction capture identity.');
  const teams = row.seasonTeams.map(value => {
    const team = object(value);
    if (!isTransactionCaptureId(team.seasonTeamId) || typeof team.externalRosterId !== 'string'
      || !/^[1-9][0-9]*$/u.test(team.externalRosterId)) throw new Error('Invalid transaction team identity.');
    return team;
  });
  if (new Set(teams.map(team => team.seasonTeamId)).size !== teams.length
    || new Set(teams.map(team => team.externalRosterId)).size !== teams.length) throw new Error('Duplicate transaction teams.');
  if (row.mapping !== null && !isAdministrationSourceMapping(row.mapping)) throw new Error('Invalid transaction mapping.');
  return row as unknown as TransactionCapture;
}
function retainedRows(rows: readonly DatabaseRow[], limit: number): RetainedTransactionRead {
  try {
    if (rows.length !== 1 || typeof rows[0].selection_valid !== 'boolean') throw new Error('Invalid transaction inventory.');
    if (!rows[0].selection_valid) return { status: 'unavailable', reason: 'retained_transaction_scope_mismatch' };
    const values = typeof rows[0].captures === 'string' ? JSON.parse(rows[0].captures) : rows[0].captures;
    if (!Array.isArray(values)) throw new Error('Invalid transaction inventory.');
    if (values.length > limit) return { status: 'unavailable', reason: 'retained_transaction_limit_exceeded' };
    return { status: 'available', captures: values.map(capture) };
  } catch { return { status: 'unavailable', reason: 'invalid_retained_transaction_evidence' }; }
}

export function transactionMethods(client: DatabaseClient) {
  return {
    async beginTransactionAttempt(mapping: AdministrationSourceMapping, week: number, id: string,
      fence?: AdministrationWriteFence): Promise<RosterAttempt> {
      if (!isAdministrationSourceMapping(mapping) || !isTransactionCaptureId(id)) throw new Error('Invalid transaction reservation.');
      transactionsScope(mapping, week);
      const rows = await client.query(`/* league-administration:begin-transaction-attempt */
        SELECT public.begin_transaction_attempt($1::jsonb,$2::uuid,$3::integer,$4::jsonb) AS result`,
      [JSON.stringify(mapping), id, week, fence ? JSON.stringify(fence) : null]);
      const row = object(rows.length === 1 ? rows[0].result : null);
      if (row.id !== id || !isTransactionCaptureId(row.scopeId)) throw new Error('Invalid transaction reservation.');
      return { id, scopeId: row.scopeId, ordinal: ordinal(row.ordinal), expectedGeneration: ordinal(row.expectedGeneration, 0) };
    },
    async readAcceptedTransactions(mapping: AdministrationSourceMapping, week: number): Promise<AcceptedTransactionsRead> {
      if (!isAdministrationSourceMapping(mapping)) return { status: 'unavailable', reason: 'invalid_mapping' };
      try {
        const scope = transactionsScope(mapping, week);
        const rows = await client.query(ACCEPTED_TRANSACTIONS_SQL,
          [JSON.stringify({ scope, policy: TRANSACTIONS_POLICY }), mapping.revisionId, mapping.generation, week]);
        if (!rows.length) return { status: 'missing' };
        if (rows.length !== 1) throw new Error('Ambiguous transaction resource.');
        const source = capture(rows[0].capture);
        const provenance = source.envelope.provenance;
        const expectedCoverage = { periodIds: [scope.scoringPeriodId], interval: null, entitySet: 'full',
          fields: ['transaction_id'], pagination: 'complete', nextCursor: null, completeness: 'complete', reasons: [] };
        if (!source.receipt || source.captureKind !== 'receipt' || source.captureId !== source.receipt.id || !source.accepted
          || source.week !== week || source.leagueSeasonId !== mapping.leagueSeasonId
          || source.envelope.family !== 'transactions' || source.envelope.week !== week
          || source.envelope.completeness !== 'complete' || provenance.origin !== 'network'
          || !provenance.sourceObservedAt || !provenance.requestStartedAt || !provenance.requestCompletedAt
          || compatibleRevision(source.mapping) !== compatibleRevision(mapping)
          || compatibleRevision(source.envelope.scope) !== compatibleRevision(mapping.scope)
          || compatibleRevision(source.receipt?.coverage) !== compatibleRevision(expectedCoverage)
          || compatibleRevision(source.receipt?.provenance) !== compatibleRevision(provenance)
          || rows[0].source_mapping_revision_id !== mapping.revisionId
          || compatibleRevision(rows[0].identity) !== compatibleRevision({ scope, policy: TRANSACTIONS_POLICY })) {
          throw new Error('Invalid accepted transaction lineage.');
        }
        const normalized = normalizeAdministrationObservation(source.envelope);
        if (normalized.status !== 'accepted' || normalized.contentHash !== source.contentHash
          || normalized.semanticHash !== source.semanticHash
          || compatibleRevision(normalized.value) !== compatibleRevision(source.normalizedValue)) throw new Error('Invalid transaction content.');
        return { status: 'available', capture: source, accepted: { scope,
          canonicalNormalizerVersion: TRANSACTIONS_POLICY.canonicalNormalizerVersion, sourceMappingRevisionId: mapping.revisionId,
          contentId: source.contentId, observationIds: [source.receipt.id], validationVersion: TRANSACTIONS_POLICY.validationVersion,
          acceptedGeneration: ordinal(source.receipt.acceptedGeneration), verifiedAt: provenance.sourceObservedAt,
          effectiveFrom: null, effectiveTo: null, effectiveEvidence: 'unknown' } };
      } catch { return { status: 'unavailable', reason: 'transaction_evidence_unavailable' }; }
    },
    async scanRetainedTransactions(selection: RetainedTransactionSelection): Promise<RetainedTransactionRead> {
      if (!isRetainedTransactionSelection(selection)) return { status: 'unavailable', reason: 'invalid_retained_transaction_selection' };
      try { return retainedRows(await client.query(RETAINED_TRANSACTION_SCAN_SQL,
        [selection.leagueSeasonId, selection.nativeWeeks, selection.scope.provider, selection.scope.externalLeagueId,
          selection.scope.leagueKey, selection.scope.season]), RETAINED_TRANSACTION_INVENTORY_LIMIT); }
      catch { return { status: 'unavailable', reason: 'retained_transaction_read_failed' }; }
    },
    async readRetainedTransactions(selection: RetainedTransactionSelection, observationIds: readonly string[]): Promise<RetainedTransactionRead> {
      if (!isRetainedTransactionSelection(selection) || !Array.isArray(observationIds)
        || observationIds.length > RETAINED_TRANSACTION_BATCH_LIMIT || !observationIds.every(isTransactionCaptureId)
        || new Set(observationIds).size !== observationIds.length) return { status: 'unavailable', reason: 'invalid_retained_transaction_selection' };
      if (!observationIds.length) return { status: 'available', captures: [] };
      try { return retainedRows(await client.query(RETAINED_TRANSACTION_READ_SQL,
        [selection.leagueSeasonId, selection.nativeWeeks, observationIds, selection.scope.leagueKey, selection.scope.season,
          selection.scope.provider, selection.scope.externalLeagueId]),
      RETAINED_TRANSACTION_BATCH_LIMIT); }
      catch { return { status: 'unavailable', reason: 'retained_transaction_read_failed' }; }
    },
  };
}
