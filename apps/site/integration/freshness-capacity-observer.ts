import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { deflateRawSync } from 'node:zlib';
import { withDatabaseAbortSignal, type DatabaseClient } from '../lib/database';
import { createLeagueAdministrationStore } from '../lib/league-administration/store';
import { readPublicSleeperIntake } from '../lib/league-administration/public-intake-reader';
import { normalizeAdministrationObservation } from '../lib/league-administration/normalize';
import { projectDraftMetadata } from '../lib/aggregator/draft-metadata';
import { projectDraftSelections } from '../lib/aggregator/draft-selections';
import { projectExactMatchupValues } from '../lib/aggregator/exact-matchup-values';
import { projectWeeklyReport } from '../lib/aggregator/weekly-reports';
import { projectPlayoffBracket } from '../lib/aggregator/playoff-brackets';
import { composeOfficialResults, type OfficialResultsInput } from '../lib/aggregator/official-results';
import { projectCurrentRosterGroups } from '../lib/aggregator/current-roster-groups';
import { projectTradedPicks } from '../lib/aggregator/traded-picks';
import { parsePublicCaptureWitness } from '../lib/league-administration/public-capture-witness';
import type { AdministrationProvenance, AdministrationSourceMapping } from '../lib/league-administration/contracts';
import type { PublicIntakeSubmissionReceipt } from '../lib/league-administration/public-intake-contracts';
import { assertCapacityManifest, capacityDigest, capacityTime, freezeCapacityValue, type CapacityManifest,
  type CapacityFamily, type JsonValue, type ReaderExpectation } from './freshness-capacity-manifest';
import { assertCapacityHttpEndpoint } from './freshness-capacity-evidence';
import type { CapacityEvidence, HttpAttempt, OriginObservation, ResourceRead, IntakeEvidence, OutageEvidence } from './freshness-capacity-evidence';
import { assertCapacityRecoveryManifest, type CapacityRecoveryManifest, type RecoveryEndpointAcceptance } from './freshness-capacity-recovery';
import { assertCapacityDailyManifest, DAILY_CLOCK, type CapacityDailyManifest, type DailyCatalogTurn, type DailyIntakeEvidence, type DailyQueueSnapshot, type DailyAuxiliaryRead, type DailyAuxiliaryEvidence, type DailyCatalogChoice } from './freshness-capacity-daily';
import type { CapacitySourceResponse } from './freshness-capacity-transport';

/** Existing restricted SELECT privileges only. This never creates or repairs evidence. */
export const CAPACITY_RECEIPT_LINEAGE_SQL = `/* cp26:read-observer-receipt-lineage */
 SELECT to_jsonb(receipt) AS receipt,to_jsonb(acceptance) AS acceptance,to_jsonb(attempt) AS attempt,
   jsonb_build_object('id',content.id,'league_season_id',content.league_season_id,'provider',content.provider,
     'external_league_id',content.external_league_id,'family',content.family,'week',content.week,
     'accepted',content.accepted,'payload',content.payload) AS content,
   to_jsonb(dispatch) AS dispatch,to_jsonb(dispatch_result) AS outcome
 FROM public.league_roster_capture_receipts receipt
 JOIN public.league_roster_resource_acceptances acceptance ON acceptance.receipt_id=receipt.id
 JOIN public.league_roster_resource_attempts attempt ON attempt.id=receipt.attempt_id AND attempt.scope_id=acceptance.scope_id
 JOIN public.league_administration_contents content ON content.id=receipt.content_id
 JOIN public.public_data_dispatches dispatch ON dispatch.worker_id=attempt.write_fence->>'workerId'
   AND dispatch.generation=(attempt.write_fence->>'generation')::integer
 LEFT JOIN public.public_data_dispatch_outcomes dispatch_result ON dispatch_result.worker_id=dispatch.worker_id AND dispatch_result.generation=dispatch.generation
 WHERE receipt.id=$1::uuid`;
export const CAPACITY_DISPATCH_JOURNAL_SQL = `/* cp26:read-observer-dispatches */
 SELECT to_jsonb(dispatch) AS dispatch,to_jsonb(dispatch_result) AS outcome
 FROM public.public_data_dispatches dispatch
 LEFT JOIN public.public_data_dispatch_outcomes dispatch_result USING(worker_id,generation)
 WHERE dispatch.generation>$1::integer OR dispatch.generation=ANY($2::integer[])
 ORDER BY dispatch.generation,dispatch.worker_id LIMIT 1000`;
export const CAPACITY_ENDPOINT_RECEIPTS_SQL = `/* cp26:read-observer-intake-receipts */
 SELECT to_jsonb(receipt) AS receipt,to_jsonb(acceptance) AS acceptance,to_jsonb(attempt) AS attempt,to_jsonb(content) AS content,
 to_jsonb(dispatch) AS dispatch,to_jsonb(dispatch_result) AS outcome,
 (SELECT coalesce(jsonb_agg(entry.source_value ORDER BY entry.source_value->>'externalRosterId'),'[]'::jsonb)
 FROM public.league_administration_team_entries entry WHERE entry.content_id=content.id) AS typed_teams,
 (SELECT coalesce(jsonb_agg(entry.source_value ORDER BY entry.source_value->>'externalRosterId'),'[]'::jsonb)
 FROM public.league_team_manager_entries entry WHERE entry.content_id=content.id AND entry.normalizer_version='sleeper-current-team-managers-v1') AS typed_managers
 FROM public.league_roster_capture_receipts receipt JOIN public.league_roster_resource_acceptances acceptance ON acceptance.receipt_id=receipt.id
 JOIN public.league_roster_resource_attempts attempt ON attempt.id=receipt.attempt_id AND attempt.scope_id=acceptance.scope_id
 JOIN public.league_administration_contents content ON content.id=receipt.content_id
 JOIN public.public_data_dispatches dispatch ON dispatch.worker_id=attempt.write_fence->>'workerId' AND dispatch.generation=(attempt.write_fence->>'generation')::integer
 LEFT JOIN public.public_data_dispatch_outcomes dispatch_result ON dispatch_result.worker_id=dispatch.worker_id AND dispatch_result.generation=dispatch.generation
 WHERE dispatch.intake_id=$1::uuid ORDER BY acceptance.accepted_at,receipt.id`;
export const CAPACITY_ANCILLARY_HEADS_SQL = `/* cp26:read-ancillary-heads */
 SELECT content.family,receipt.id AS receipt_id,acceptance.id AS acceptance_id,acceptance.generation,
 connection.current_mapping_revision_id,connection.mapping_generation,attempt.ordinal,
 (SELECT max(latest.ordinal) FROM public.league_roster_resource_attempts latest WHERE latest.scope_id=scope.id) AS latest_ordinal
 FROM public.league_roster_resource_scopes scope
 JOIN public.league_roster_resource_heads head ON head.scope_id=scope.id
 JOIN public.league_roster_resource_acceptances acceptance ON acceptance.id=head.accepted_id AND acceptance.generation=head.generation
 JOIN public.league_roster_capture_receipts receipt ON receipt.id=acceptance.receipt_id
 JOIN public.league_roster_resource_attempts attempt ON attempt.id=receipt.attempt_id
 JOIN public.league_administration_contents content ON content.id=receipt.content_id
 JOIN public.league_source_connections connection ON connection.id=scope.connection_id
 WHERE content.external_league_id=$1 AND content.provider='sleeper'
 AND acceptance.source_mapping_revision_id=connection.current_mapping_revision_id
 AND ((content.family='matchups' AND content.week=$2) OR (content.family IN ('rosters','winners_bracket','losers_bracket') AND content.week=0))
 ORDER BY content.family,receipt.id`;
export const CAPACITY_ANCILLARY_RECEIPT_SQL = CAPACITY_ENDPOINT_RECEIPTS_SQL.replace('dispatch.intake_id=$1::uuid', 'receipt.id=$1::uuid');
export const CAPACITY_ANCILLARY_FIRST_RECEIPT_SQL = CAPACITY_ENDPOINT_RECEIPTS_SQL.replace('dispatch.intake_id=$1::uuid',
  'dispatch.intake_id=$1::uuid AND content.external_league_id=$2 AND content.family=$3') + ' LIMIT 1';
export const CAPACITY_INTAKE_CANDIDATES_SQL = `/* cp26:read-observer-intake-candidates */
 SELECT to_jsonb(candidate) AS candidate FROM public.public_data_league_candidates candidate WHERE intake_id=$1::uuid ORDER BY external_league_id`;
export const CAPACITY_ENDPOINT_DIRECTORIES_SQL = `/* cp26:read-observer-directories */
 SELECT to_jsonb(capture) AS capture,to_jsonb(content) AS content,to_jsonb(dispatch) AS dispatch,to_jsonb(dispatch_result) AS outcome
 FROM public.public_data_directory_captures capture JOIN public.league_administration_contents content ON content.id=capture.content_id
 JOIN public.public_data_dispatches dispatch USING(worker_id,generation)
 JOIN public.public_data_dispatch_outcomes dispatch_result USING(worker_id,generation) WHERE capture.intake_id=$1::uuid`;
export const CAPACITY_PLAYER_DIRECTORY_SQL = `/* cp26:read-observer-player-directory */
 SELECT to_jsonb(version) AS version,to_jsonb(capture) AS capture,to_jsonb(attempt) AS attempt,to_jsonb(content) AS content
 FROM public.league_player_directory_versions version JOIN public.league_player_directory_captures capture ON capture.id=version.capture_id
 JOIN public.league_player_directory_attempts attempt ON attempt.id=capture.attempt_id
 JOIN public.league_player_directory_contents content ON content.id=capture.content_id WHERE version.id=$1::uuid`;
const requestSql = `/* cp26:read-observer-intake */ SELECT id,username,seasons,terminal,created_at::text AS created_at,to_jsonb(request) AS stored_request,
 to_jsonb(request)->>'resource_occurrence_id' AS resource_occurrence_id,
 to_jsonb(request)->>'submission_capacity' AS submission_capacity,
 (SELECT to_jsonb(identity) FROM public.public_data_identity_observations identity WHERE identity.intake_id=request.id) AS identity,
 (SELECT coalesce(jsonb_agg(to_jsonb(list)),'[]'::jsonb) FROM public.public_data_league_lists list WHERE list.intake_id=request.id) AS lists,
 (SELECT coalesce(jsonb_agg(jsonb_build_object('dispatch',to_jsonb(dispatch),'outcome',to_jsonb(dispatch_result))),'[]'::jsonb)
  FROM public.public_data_dispatches dispatch JOIN public.public_data_dispatch_outcomes dispatch_result USING(worker_id,generation)
  WHERE dispatch.intake_id=request.id AND dispatch.resource IN ('identity','leagues')) AS discovery_dispatches
 FROM public.public_data_intakes request WHERE id=$1::uuid`;
export const CAPACITY_DAILY_CATALOG_CLAIM_SQL = `/* projection-store:acquire-job */
        INSERT INTO projection_jobs (
          job_key, job_type, scheduled_for, state, payload,
          lease_owner, lease_until, attempt_count, updated_at
        ) VALUES (
          $1, $2, $3, 'running', $4::jsonb,
          $5, now() + ($6 * interval '1 second'), 1, now()
        )
        ON CONFLICT (job_key) DO UPDATE SET
          job_type = EXCLUDED.job_type,
          scheduled_for = EXCLUDED.scheduled_for,
          state = 'running',
          payload = EXCLUDED.payload,
          lease_owner = EXCLUDED.lease_owner,
          lease_until = EXCLUDED.lease_until,
          attempt_count = projection_jobs.attempt_count + 1,
          last_error = NULL,
          completed_at = NULL,
          updated_at = now()
        WHERE (projection_jobs.state IN ('pending', 'failed')
            AND EXCLUDED.scheduled_for >= projection_jobs.scheduled_for)
          OR (projection_jobs.state = 'running' AND projection_jobs.lease_until < now()
            AND EXCLUDED.scheduled_for >= projection_jobs.scheduled_for)
          OR (projection_jobs.state = 'completed'
            AND EXCLUDED.scheduled_for > projection_jobs.scheduled_for
            AND ($7::integer IS NULL OR projection_jobs.completed_at
              <= now() - ($7 * interval '1 second')))
        RETURNING attempt_count, lease_until::text`;
export const CAPACITY_DAILY_CATALOG_RESERVE_SQL = `/* league-administration:begin-player-directory */
        SELECT public.begin_player_directory_attempt($1::uuid,$2::jsonb) AS result`;
/** Passive, closed result observation after the existing database fetch guard. Never reads headers. */
export function createCapacityDailyCatalogFetch(next: typeof fetch, record: (choice: DailyCatalogChoice) => void,
  clock: CapacityObserverClock = realClock): typeof fetch {
  return async (input, init) => {
    let selected: { kind: 'claim' | 'reserve'; query: string; params: JsonValue[] } | null = null;
    try {
      const raw = typeof init?.body === 'string' ? init.body : input instanceof Request ? await input.clone().text() : null;
      if (raw) { const body = object(JSON.parse(raw));
        if (Array.isArray(body.params) && body.query === CAPACITY_DAILY_CATALOG_CLAIM_SQL) {
          const params = body.params; const payload = typeof params[3] === 'string' ? JSON.parse(params[3]) : params[3];
          if (params.length === 7 && uuid(params[4]) && typeof params[2] === 'string' && Number.isFinite(Date.parse(params[2]))
            && params[0] === 'league-administration-public-intake' && params[1] === params[0]
            && Number(params[5]) === 25 && Number(params[6]) === 60
            && capacityDigest(payload) === capacityDigest({ policy: 'public-player-directory-v1', mode: 'player-directory' }))
            selected = { kind: 'claim', query: body.query, params: json(params) as JsonValue[] };
        } else if (Array.isArray(body.params) && body.params.length === 2 && body.query === CAPACITY_DAILY_CATALOG_RESERVE_SQL) {
          const owner = typeof body.params[1] === 'string' ? JSON.parse(body.params[1]) : body.params[1];
          assert.deepEqual(Object.keys(object(owner)).sort(), ['deadlineAt','generation','jobKey','workerId']);
          assert(uuid(body.params[0]) && uuid(owner.workerId) && Number.isSafeInteger(owner.generation) && owner.generation > 0
            && typeof owner.deadlineAt === 'string' && Number.isFinite(Date.parse(owner.deadlineAt)));
          if (owner.jobKey === 'league-administration-public-intake') selected = { kind: 'reserve', query: body.query, params: json(body.params) as JsonValue[] };
        }
      }
    } catch { /* Undeclared or malformed SQL is neither copied nor classified by this observer. */ }
    if (!selected) return next(input,init);
    const start = { startedAt: capacityTime(clock.wallNow()), monotonicStartedAt: clock.monotonicNow() };
    let status: DailyCatalogChoice['status'] = 'failed', result: DailyCatalogChoice['response'] = null;
    try {
      const response = await next(input,init);
      if (response.ok) {
        status = 'unclassified';
        try { const body = object(await response.clone().json()); assert(Array.isArray(body.fields) && Array.isArray(body.rows));
          const fields = body.fields.map(value => String(object(value).name));
          assert.deepEqual(fields, selected.kind === 'claim' ? ['attempt_count','lease_until'] : ['result']);
          assert(body.rows.length <= 1); const rows = body.rows.map(value => { assert(Array.isArray(value) && value.length === fields.length); return json(value); });
          result = { fields,rows }; status = 'success';
        } catch { /* Preserve the original response and let its ordinary decoder decide. */ }
      }
      return response;
    } finally {
      record(freezeCapacityValue({ kind:selected.kind,querySha256:createHash('sha256').update(selected.query).digest('hex'),params:selected.params,
        response:result,status,span:{...start,endedAt:capacityTime(clock.wallNow()),monotonicEndedAt:clock.monotonicNow()} }));
    }
  };
}
export const CAPACITY_DAILY_EMPTY_SQL = `/* cp26:read-daily-empty-origin */ SELECT
 (SELECT count(*)::integer FROM public.public_data_intakes) AS requests,
 (SELECT count(*)::integer FROM public.public_data_dispatches) AS dispatches,
 (SELECT count(*)::integer FROM public.public_data_refresh_targets) AS targets,
 (SELECT count(*)::integer FROM public.public_data_refresh_cycles) AS cycles,
 (SELECT count(*)::integer FROM public.league_player_directory_attempts) AS catalog_attempts`;
export const CAPACITY_DAILY_QUEUE_SQL = `/* cp26:read-observer-daily-queue */ SELECT
      (SELECT coalesce(jsonb_agg(to_jsonb(request) ORDER BY created_at,id),'[]'::jsonb) FROM public.public_data_intakes request WHERE resource_occurrence_id IS NULL) AS requests,
      (SELECT coalesce(jsonb_agg(to_jsonb(cycle) ORDER BY target_id,cycle),'[]'::jsonb) FROM public.public_data_refresh_cycles cycle) AS cycles,
      (SELECT coalesce(jsonb_agg(jsonb_build_object('target',to_jsonb(target),'configuration',to_jsonb(configuration)) ORDER BY target.id),'[]'::jsonb)
        FROM public.public_data_refresh_targets target JOIN public.public_data_refresh_configurations configuration
        ON configuration.target_id=target.id AND configuration.revision=target.configuration_revision) AS configurations,
      (SELECT coalesce(jsonb_agg(to_jsonb(outcome) ORDER BY target_id,cycle),'[]'::jsonb) FROM public.public_data_refresh_cycle_outcomes outcome) AS outcomes`;
export const CAPACITY_DAILY_INTAKE_SQL = `/* cp26:read-observer-daily-intake */ SELECT to_jsonb(request) AS request,to_jsonb(cycle) AS cycle
        FROM public.public_data_intakes request LEFT JOIN public.public_data_refresh_cycles cycle ON cycle.intake_id=request.id
        WHERE request.id=$1::uuid AND request.resource_occurrence_id IS NULL`;
export const CAPACITY_INTAKE_REQUEST_SQL = requestSql;
export type CapacityObserverClock = { wallNow(): number; monotonicNow(): number };
export type CapacityObserverTransportJournal = { owner: string; coverageStartedAt: number; coverageEndedAt: number;
  attempts: readonly HttpAttempt[]; responses: readonly CapacitySourceResponse[]; rejectedRequests?: readonly unknown[] };
export type CapacityObserverSpan = { startedAt: number; endedAt: number; monotonicStartedAt: number; monotonicEndedAt: number };
export type CapacityObserverLineage = CapacityObserverSpan & {
  pairId: string; selector: string; selection: 'current' | 'receipt'; version: string; receiptId: string;
  acceptanceId: string; acceptedGeneration: number; sqlAcceptedAt: string; firstReadMinusSqlAcceptedMs: number;
  mapping: AdministrationSourceMapping; contentId: string; sourceAttemptId: string; transportAttemptId: string;
  sourceResponseSha256: string; sourceResponseCompletedAt: number; receiptProvenance: AdministrationProvenance;
  dispatch: Record<string, unknown>; outcome: Record<string, unknown> | null; readerValueDigest: string;
};
type BoundRead = { pairId: string; read: ResourceRead; reader: ReaderExpectation; origin: OriginObservation; lineage: CapacityObserverLineage };
type Resource = 'rosters' | 'matchups' | 'transactions';
type Cohort = 'intake-a' | 'intake-b';
function object(value: unknown): Record<string, unknown> { assert(value && typeof value === 'object' && !Array.isArray(value)); return value as Record<string, unknown>; }
function uuid(value: unknown): string { assert(typeof value === 'string' && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/iu.test(value), 'invalid stored identity'); return value; }
function timestamp(value: unknown): number { assert(typeof value === 'string' && Number.isFinite(Date.parse(value)), 'invalid stored timestamp'); return capacityTime(Date.parse(value)); }
function json(value: unknown): JsonValue { const copy: unknown = JSON.parse(JSON.stringify(value)); capacityDigest(copy); return copy as JsonValue; }
export const CAPACITY_ANCILLARY_COMPONENTS = ['standings', 'exact-results', 'winners_bracket', 'losers_bracket'] as const;
export type CapacityAncillaryComponent = typeof CAPACITY_ANCILLARY_COMPONENTS[number];
export type CapacityAncillaryQuery = { sql: string; params: JsonValue; rowsRef: string; span: CapacityObserverSpan };
export type CapacityAncillaryProof = { id: string; leagueKey: string; component: CapacityAncillaryComponent;
  mapping: AdministrationSourceMapping; current: JsonValue; retained: JsonValue; context: JsonValue;
  source: { requestId: string; endpointId: string; proofId: string; attemptId: string; kind: 'resource-receipt';
    record: JsonValue; readSpan: CapacityObserverSpan };
  queries: { current: CapacityAncillaryQuery[]; retained: CapacityAncillaryQuery[]; context: CapacityAncillaryQuery[] } };
export type CapacityAncillaryAnchor = { leagueKey: string; component: CapacityAncillaryComponent;
  kind: 'benchmark' | 'pair-first-read' | 'initial-request-first-receipt'; at: number; requestId: string | null;
  receiptId: string | null; query: CapacityAncillaryQuery | null };
export type CapacityAncillaryRead = { leagueKey: string; scheduledAt: number; span: CapacityObserverSpan;
  components: Record<CapacityAncillaryComponent, string | null>;
  componentSpans: Partial<Record<CapacityAncillaryComponent, CapacityObserverSpan>>;
  currentQueries: Partial<Record<CapacityAncillaryComponent, { digest: string; span: CapacityObserverSpan }[]>>;
  unavailable: Partial<Record<CapacityAncillaryComponent, JsonValue>>; heads: CapacityAncillaryQuery | null;
  unchanged: CapacityAncillaryComponent[]; composed: JsonValue };
export const CAPACITY_ANCILLARY_LIMIT_MS = 900_000;
export const CAPACITY_ANCILLARY_BODY_BYTES = 4 * 1024 * 1024;
export const CAPACITY_ANCILLARY_DECODED_BYTES = 512 * 1024 * 1024;
export type CapacityAncillaryEncodedBody = { id: string; encoding: 'deflate-json-v1'; decodedBytes: number;
  decodedSha256: string; data: string };
/** Lossless artifact encoding only. Every decoded field remains mandatory parent evidence. */
export function encodeCapacityAncillaryBody(id: string, value: unknown): CapacityAncillaryEncodedBody {
  assert.equal(capacityDigest(value), id, 'ancillary body digest mismatch');
  const raw = Buffer.from(JSON.stringify(value), 'utf8');
  assert(raw.length > 0 && raw.length <= CAPACITY_ANCILLARY_BODY_BYTES, 'ancillary decoded body exceeds bound');
  const compressed = deflateRawSync(raw);
  assert(compressed.length > 0 && compressed.length <= CAPACITY_ANCILLARY_BODY_BYTES, 'ancillary compressed body exceeds bound');
  return { id, encoding: 'deflate-json-v1', decodedBytes: raw.length,
    decodedSha256: createHash('sha256').update(raw).digest('hex'), data: compressed.toString('base64') };
}
export function encodeCapacityAncillaryBodies(queryRows: readonly { id: string; value: JsonValue }[], proofs: readonly CapacityAncillaryProof[]) {
  const rows = queryRows.map(row => ({ id: row.id, value: row.value as unknown }));
  const bodies = proofs.map(({ id, ...value }) => ({ id, value }));
  let decodedBytes = 0;
  for (const row of [...rows, ...bodies]) {
    decodedBytes += Buffer.byteLength(JSON.stringify(row.value), 'utf8');
    assert(decodedBytes <= CAPACITY_ANCILLARY_DECODED_BYTES, 'ancillary aggregate decoded bytes exceed bound');
  }
  return { queryRows: rows.map(row => encodeCapacityAncillaryBody(row.id, row.value)),
    proofs: bodies.map(row => encodeCapacityAncillaryBody(row.id, row.value)), decodedBytes };
}
/** Composition availability alone is deliberately insufficient: every declared child must be readable. */
export function composeCapacityAncillary(input: OfficialResultsInput) {
  assert.equal(input.standings.status, 'available'); assert.equal(input.periods.length, 1); assert.equal(input.brackets.length, 2);
  assert.deepEqual(input.brackets.map(row => row.family).sort(), ['losers_bracket', 'winners_bracket']);
  for (const row of input.periods) {
    assert.equal(row.values.status, 'available'); assert.equal(row.context?.status, 'available');
    assert(row.values.status === 'available' && row.context?.status === 'available');
    assert.equal(row.context.capture.matchupsReceiptId, row.values.matchupsReceiptId);
    assert.equal(row.context.period.nativeWeek, row.nativeWeek); assert.equal(row.values.value.nativeWeek, row.nativeWeek);
  }
  for (const row of input.brackets) assert.equal(row.resource.status, 'available');
  const result = composeOfficialResults(input); assert.equal(result.status, 'available'); return result;
}
export type CapacityAncillarySuccess = { receiptId: string; attemptId: string; sourceAt: number; acceptedAt: number; confirmedAt: number };
/** No percentile, cached-read renewal, or retrospective repair of an already stale interval. */
export function evaluateCapacityAncillaryChain(start: number, end: number, successes: readonly CapacityAncillarySuccess[], requirePrior = false, freshSource = false) {
  assert(Number.isFinite(start) && Number.isFinite(end) && end >= start);
  const rows = [...successes].sort((a,b) => a.confirmedAt - b.confirmedAt), receipts = new Map<string, CapacityAncillarySuccess>(), attempts = new Map<string, CapacityAncillarySuccess>();
  const distinct: CapacityAncillarySuccess[] = []; let malformed = false, regression = false, latestSource = -Infinity;
  for (const row of rows.filter(row => row.confirmedAt <= end)) {
    if (![row.sourceAt,row.acceptedAt,row.confirmedAt].every(Number.isFinite) || row.sourceAt > row.confirmedAt || row.acceptedAt > row.confirmedAt) { malformed = true; continue; }
    if (row.confirmedAt >= start && row.sourceAt < latestSource) regression = true;
    latestSource = Math.max(latestSource, row.sourceAt);
    const priorReceipt = receipts.get(row.receiptId), priorAttempt = attempts.get(row.attemptId);
    if (priorReceipt || priorAttempt) {
      const same = (previous: CapacityAncillarySuccess | undefined) => previous && previous.receiptId === row.receiptId && previous.attemptId === row.attemptId
        && previous.sourceAt === row.sourceAt && previous.acceptedAt === row.acceptedAt;
      if (!same(priorReceipt) || !same(priorAttempt)) malformed = true;
      continue;
    }
    receipts.set(row.receiptId,row); attempts.set(row.attemptId,row); distinct.push(row);
  }
  const prior = distinct.filter(row => row.confirmedAt <= start && row.sourceAt <= start).at(-1);
  const pending = distinct.filter(row => row.confirmedAt > start && row.confirmedAt <= end && (!freshSource || row.sourceAt >= start));
  let sourceAt: number | null = !freshSource ? prior?.sourceAt ?? null : null;
  const gaps: number[] = [], failures: string[] = [...(malformed ? ['invalid-success-clock'] : []), ...(regression ? ['source-regression'] : [])];
  if (requirePrior && (sourceAt === null || start - sourceAt > CAPACITY_ANCILLARY_LIMIT_MS)) failures.push('missing-fresh-start-proof');
  if (requirePrior && prior && prior.confirmedAt - prior.sourceAt > CAPACITY_ANCILLARY_LIMIT_MS) failures.push('stale-start-confirmation');
  if (!requirePrior && sourceAt !== null && start - sourceAt > CAPACITY_ANCILLARY_LIMIT_MS) failures.push('stale-start-proof');
  if (freshSource && prior && prior.confirmedAt === start && prior.sourceAt >= start) pending.unshift(prior);
  for (const row of pending) {
    const gap = row.confirmedAt - (sourceAt ?? start); gaps.push(gap);
    if (gap > CAPACITY_ANCILLARY_LIMIT_MS) failures.push('confirmation-gap');
    if (row.confirmedAt - row.sourceAt > CAPACITY_ANCILLARY_LIMIT_MS) failures.push('stale-confirmation');
    if (sourceAt !== null && row.sourceAt < sourceAt) failures.push('source-regression');
    sourceAt = Math.max(sourceAt ?? row.sourceAt, row.sourceAt);
  }
  const tail = end - (sourceAt ?? start); gaps.push(tail);
  if (sourceAt === null) failures.push('no-confirmed-refresh');
  if (tail > CAPACITY_ANCILLARY_LIMIT_MS) failures.push('stale-tail');
  return { pass: failures.length === 0, start, end, distinctCaptures: distinct.filter(row => row.confirmedAt >= start && row.confirmedAt <= end).length, maximumGapMs: Math.max(0,...gaps), tailMs: tail, failures };
}

const resourceFor = (family: CapacityFamily): Resource => family === 'lineups' || family === 'official-scores' ? 'matchups' : family;
const familiesFor = (resource: Resource): CapacityFamily[] => resource === 'matchups' ? ['lineups', 'official-scores'] : [resource];
/** Only identifies the actual latest read; immutable completion still requires separate receipt proofs. */
export function capacityCurrentIntakeResource(value: unknown) {
  const row = object(value);
  if (row.status === 'available') return row;
  assert.equal(row.status, 'unavailable'); assert.equal(row.reason, 'intake-capture-not-current-head', 'only evidenced supersession can use separate proofs');
  const retained = object(row.retained); assert.equal(retained.status, 'available'); return retained;
}
export function capacityStoredReceiptNormalization(row: Record<string, unknown>) {
  const content = object(row.content), receipt = object(row.receipt), mapping = object(object(row.attempt).source_mapping);
  const normalized = normalizeAdministrationObservation({ schemaVersion: 'league-administration-v1', normalizerVersion: 'sleeper-administration-v1',
    dialect: 'sleeper-nfl-v1', scope: object(mapping.scope) as unknown as AdministrationSourceMapping['scope'],
    family: String(content.family) as Parameters<typeof normalizeAdministrationObservation>[0]['family'],
    week: Number(content.week) === 0 && !['matchups','transactions','weekly_report'].includes(String(content.family)) ? null : Number(content.week),
    completeness: content.completeness as 'complete', payload: json(content.payload), provenance: receipt.provenance as AdministrationProvenance },
    content.family === 'rosters' ? { expectedRosterCount: Number(receipt.expected_team_count) } : undefined);
  assert.equal(content.accepted, normalized.status === 'accepted' && content.completeness === 'complete');
  assert.equal(normalized.contentHash, content.content_hash); assert.equal(normalized.semanticHash, content.semantic_hash);
  if (content.family === 'drafts') { const kind = object(content.payload).kind;
    const typed = kind === 'catalog' || kind === 'detail' ? projectDraftMetadata(normalized) : kind === 'selections' ? projectDraftSelections(normalized) : projectTradedPicks(normalized);
    assert.equal(typed.status, 'accepted'); assert.equal(typed.value?.complete, true);
  } else assert.equal(normalized.status, 'accepted');
  assert.equal(capacityDigest(normalized.value), capacityDigest(content.normalized_value), 'immutable normalized value differs from native source');
  assert.equal(capacityDigest(normalized.diagnostics), capacityDigest(content.diagnostics), 'generic diagnostics differ from native source');
  if (normalized.value?.family === 'rosters') {
    const byRoster = (left: { externalRosterId: string }, right: { externalRosterId: string }) => left.externalRosterId.localeCompare(right.externalRosterId);
    assert.equal(capacityDigest(row.typed_teams), capacityDigest([...normalized.value.teams].sort(byRoster)), 'immutable materialized roster mismatch');
    assert.equal(capacityDigest(row.typed_managers), capacityDigest([...(normalized.teamManagers?.teams ?? [])].sort(byRoster)), 'immutable materialized manager mismatch');
  }
  return normalized;
}

/** Match the maintained weekly reader's canonical identity enrichment using an already-bound current roster. */
export function capacityWeeklyReportReaderValue(normalized: ReturnType<typeof capacityStoredReceiptNormalization>, rosterProof: { nativeLeagueId: string; read: unknown; source: unknown }) {
  const projected = projectWeeklyReport(normalized); assert.equal(projected.status, 'accepted'); assert(projected.value);
  const roster = object(rosterProof.read), source = object(rosterProof.source), receipt = object(source.receipt);
  const reportMapping = parsePublicCaptureWitness(normalized.envelope.provenance.acquisition).mapping;
  const rosterMapping = parsePublicCaptureWitness(object(receipt.provenance).acquisition).mapping;
  assert(reportMapping && rosterMapping); assert.equal(rosterProof.nativeLeagueId, normalized.envelope.scope.externalLeagueId);
  assert.equal(reportMapping.scope.provider, 'sleeper'); assert.equal(reportMapping.scope.season, 2026);
  assert.equal(rosterMapping.scope.externalLeagueId, rosterProof.nativeLeagueId);
  assert.equal(capacityDigest(rosterMapping.scope), capacityDigest(reportMapping.scope));
  assert.equal(rosterMapping.leagueSeasonId, reportMapping.leagueSeasonId); assert.equal(rosterMapping.revisionId, reportMapping.revisionId);
  assert.equal(roster.status, 'available'); assert.equal(object(roster.receipt).id, receipt.id);
  assert.equal(object(object(roster.accepted).scope).leagueSeasonId, reportMapping.leagueSeasonId);
  assert.equal(object(roster.accepted).sourceMappingRevisionId, reportMapping.revisionId); assert(Array.isArray(roster.teams));
  const identities = new Map<string, string>();
  for (const input of roster.teams) {
    const team = object(input), nativeId = String(team.externalRosterId), canonical = uuid(team.seasonTeamId);
    assert(typeof team.externalRosterId === 'string' && nativeId.length > 0 && !identities.has(nativeId));
    identities.set(nativeId, canonical); assert(Array.isArray(team.players));
    for (const input of team.players) { const player = object(input); assert.equal(player.seasonTeamId, canonical);
      assert.equal(capacityDigest(player.sourceTeam), capacityDigest({ provider: 'sleeper', resourceKind: 'team',
        nativeNamespace: JSON.stringify(['nfl', 2026, rosterProof.nativeLeagueId]), nativeId })); }
  }
  assert.equal(new Set(identities.values()).size, identities.size);
  return { ...projected.value, teams: projected.value.teams.map(team => {
    const seasonTeamId = identities.get(team.externalRosterId); assert(seasonTeamId, 'report team absent from bound current roster'); return { ...team, seasonTeamId };
  }) };
}

/** A plan key is a workload label; native capture normalization uses its actual mapping scope. */
export function capacityDraftReaderScope(resource: Record<string, unknown>, nativeLeagueId: string) {
  const mapping = parsePublicCaptureWitness(object(resource.provenance).acquisition).mapping; assert(mapping);
  assert.equal(mapping.scope.provider, 'sleeper'); assert.equal(mapping.scope.season, 2026);
  assert.equal(mapping.scope.externalLeagueId, nativeLeagueId); assert.equal(resource.sourceMappingRevisionId, mapping.revisionId);
  return mapping.scope;
}

export function capacityIntakeReadOptions(proofScope: 'full' | 'initial', cursors: { periods: number | null; transactions: number | null; drafts: number | null }): NonNullable<Parameters<typeof readPublicSleeperIntake>[3]> {
  return { managerEvidenceVersion: 'v2', exactMatchupValuesVersion: 'v1', periodContextVersion: 'v1',
    ...(proofScope === 'full' ? { periodInventoryPage: { afterOrdinal: cursors.periods ?? 0, limit: 20 },
      transactionHistoryPage: { afterOrdinal: cursors.transactions ?? 0, limit: 20 },
      draftPicksPage: { afterOrdinal: cursors.drafts ?? 0, limit: 20 } } : {}) };
}

export function assertCapacityInitialStoredRequest(row: Record<string, unknown>, scope: CapacityRecoveryManifest['initialScope']) {
  const request = object(row.stored_request);
  assert.equal(capacityDigest(request.seasons), capacityDigest(scope.seasons));
  assert.equal(capacityDigest(request.exact_periods), capacityDigest(scope.exactPeriods));
  assert.equal(capacityDigest(request.transaction_period), capacityDigest(scope.transactionPeriod));
  assert.equal(request.playoff_brackets, scope.playoffBrackets);
  for (const key of ['period_inventory', 'transaction_history', 'draft_picks']) assert.equal(request[key], null);
  assert.equal(capacityDigest(request.weekly_reports), capacityDigest([]));
  assert.equal(row.resource_occurrence_id, null); assert.equal(row.submission_capacity, null);
}

const realClock: CapacityObserverClock = { wallNow: Date.now, monotonicNow: () => performance.now() };

/** Read-only composition for the existing lifecycle owner. There is no acquisition loop or SQL writer here. */
/** Native roster identities must establish non-vacuous canonical deduplication. */
export function assertCapacityAuxiliaryTeams(nativeRosterIds: readonly string[], read: unknown) {
  const roster = object(read); assert.equal(roster.status, 'available'); assert(Array.isArray(roster.teams));
  const teams = roster.teams.map(object); assert.equal(teams.length, 12); assert.equal(nativeRosterIds.length, 12);
  assert.deepEqual(teams.map(row => String(row.externalRosterId)).sort(), [...nativeRosterIds].sort());
  const ids = teams.map(row => uuid(row.seasonTeamId)); assert.equal(new Set(ids).size, 12);
  teams.forEach(row => assert.deepEqual(row.players, []));
  return teams.map(row => ({ native: String(row.externalRosterId), id: uuid(row.seasonTeamId) }))
    .sort((a,b) => a.native.localeCompare(b.native));
}
export function capacityAuxiliaryReadOptions(label: 'a' | 'b', afterOrdinal = 0) {
  assert(Number.isSafeInteger(afterOrdinal) && afterOrdinal >= 0);
  return { managerEvidenceVersion: 'v2' as const, ...(label === 'a' ? { draftPicksPage: { afterOrdinal, limit: 20 } } : {}) };
}
export function assertCapacityAuxiliaryScope(row: unknown, username: string, drafts: boolean) {
  const stored = object(row); assert.equal(stored.terminal, true); assert.equal(stored.username, username);
  assert.equal(capacityDigest(stored.seasons), capacityDigest([2026]));
  assert.equal(stored.draft_picks, drafts ? 'sleeper-2026-draft-picks-v1' : null);
  for (const key of ['period_inventory','transaction_history','transaction_period','playoff_brackets','submission_capacity','resource_occurrence_id']) assert.equal(stored[key], null);
  for (const key of ['exact_periods','weekly_reports']) assert.deepEqual(stored[key], []);
}
export function createCapacityObserver(manifest: CapacityManifest, options: {
  database: DatabaseClient; startedAt: number; journals(): readonly CapacityObserverTransportJournal[]; clock?: CapacityObserverClock;
  recovery?: CapacityRecoveryManifest; daily?: CapacityDailyManifest;
}) {
  assertCapacityManifest(manifest); assert.equal(options.database.enabled, true);
  const clock = options.clock ?? realClock, setupStartedAt = capacityTime(options.startedAt), daily = options.daily, recovery = options.recovery ?? daily?.bindingPlan;
  let startedAt = setupStartedAt, dailyWindowStarted = false;
  assert(!(options.recovery && daily), 'distinct measurement lanes required');
  if (daily) assertCapacityDailyManifest(daily);
  const endpointInventory = daily ? daily.endpoints.map(({ before, after, ...row }) => ({ ...row, versions: [before, after].map(value => ({ ...value, eventIds: [], publication: { kind: 'initial' as const } })) })) : manifest.source.endpointInventory;
  let publicationAt = startedAt + (daily?.clock.publicationOffsetMs ?? recovery?.clock.outageEndMs ?? 0);
  let auxiliaryEvidence: DailyAuxiliaryEvidence | null = null, dailyInitialState: JsonValue = null;
  const auxiliarySubmissions = new Map<string, { label: 'a' | 'b'; requestId: string; submittedAt: number; receiptAt: number; receipt: JsonValue }>();
  let activeDailyTurn: DailyCatalogTurn | null = null;
  const dailyTurns: DailyCatalogTurn[] = [], dailyIntakes = new Map<string, DailyIntakeEvidence>(), dailyQueue: DailyQueueSnapshot[] = [];
  const dailyBoundaries: { scheduledAt: number; startedAt: number; endedAt: number; proofIds: string[] }[] = [];
  if (recovery) { assertCapacityRecoveryManifest(recovery); assert.equal(recovery.source.observerManifestDigest, manifest.digest); }
  const recoverySubmissions = new Map<string, { id: string; requestId: string; plannedAt: number; dispatchedAt: number; receiptAt: number | null; receipt: PublicIntakeSubmissionReceipt | null; completedAt: number | null; completeProof: JsonValue }>();
  const recoveryHeads = { initial: new Map<string, BoundRead>(), before: new Map<string, BoundRead>(), during: new Map<string, BoundRead>(), recovered: new Map<string, BoundRead>() };
  const recoveryHistory = new Map<string, ReaderExpectation[]>();
  const recoverySamples = new Map<string, CapacityEvidence['samples'][number]>();
  const endpointAcceptances = new Map<string, RecoveryEndpointAcceptance>();
  const endpointProofs = new Map<string, { proofId: string; kind: RecoveryEndpointAcceptance['kind']; endpointId: string; requestId: string | null; attemptId: string; readSpan: CapacityObserverSpan; record: JsonValue }>();
  const ancillaryQueryRows = new Map<string, JsonValue>();
  function ancillaryRowsRef(rows: unknown) { const value = json(rows), id = capacityDigest(value); if (!ancillaryQueryRows.has(id)) ancillaryQueryRows.set(id, freezeCapacityValue(value)); return id; }
  const ancillaryProofs = new Map<string, CapacityAncillaryProof>(), ancillaryCache = new Map<string, string>();
  const ancillaryAnchors = new Map<string, CapacityAncillaryAnchor>(), ancillaryRequests = new Map<string, string>();
  const pendingAncillaryAnchors = new Map<string, { receiptId: string; acceptedAt: string; requestId: string }>();
  const ancillaryReads: CapacityAncillaryRead[] = [], ancillarySlots = new Set<string>(), ancillaryHeadFingerprints = new Map<string,string>();
  const first = new Map<string, CapacityEvidence['firstAcceptances'][number]>(), anchors = new Map<string, number>();
  const samples = new Map<string, CapacityEvidence['samples'][number]>(), events = new Map<string, CapacityEvidence['events'][number]>();
  const origins = new Map<string, OriginObservation>(), receipts = new Map<string, CapacityObserverLineage>();
  const dispatchOutcomes = new Map<string, Record<string, unknown>>();
  const receiptProofs = new Map<string, Omit<CapacityObserverLineage, keyof CapacityObserverSpan | 'pairId' | 'selector' | 'selection' | 'firstReadMinusSqlAcceptedMs' | 'readerValueDigest' | 'outcome'>>();
  const lineage: (CapacityObserverSpan & { proofId: string; pairId: string; selector: string; selection: 'current' | 'receipt';
    firstReadMinusSqlAcceptedMs: number; readerValueDigest: string; outcomeId: string | null })[] = [], failures: { operation: string; at: number; reason: 'unavailable' | 'timeout' | 'late'; assertionLocation?: string }[] = [];
  const operations: { operation: string; span: CapacityObserverSpan; outcome: JsonValue }[] = [];
  const intakes = new Map<Cohort, IntakeEvidence>(), intakeIds = new Map<Cohort, string>();
  const outageReads = { before: new Map<string, BoundRead>(), during: new Map<string, BoundRead>(), recovered: new Map<string, BoundRead>() };
  const backlog = new Map<string, OutageEvidence['backlog'][number]>();
  const backlogRequests = new Map<string, string>();
  let outageStartedAt: number | null = null, dependencyRestoredAt: number | null = null, runnerRestoredAt: number | null = null;
  const inFlight = new Set<string>();
  const durableDispatches = new Map<string, { dispatch: Record<string, unknown>; outcome: Record<string, unknown> | null }>();
  const dispatchObservations: { span: CapacityObserverSpan; entries: { key: string; outcomeId: string | null }[] }[] = [];
  const intakePages = new Map<string, JsonValue>();
  const queueSnapshots: { phase: 'after-submissions' | 'restored' | 'final'; at: number; requests: JsonValue[]; cycles: JsonValue[]; configurations: JsonValue[] }[] = [];
  const queueCompleted = new Map<string, { requestId: string; completedAt: number; completeProof: JsonValue }>();
  const currentIntakeReads = new Map<string, { id: string; requestId: string; nativeLeagueId: string; kind: string; span: CapacityObserverSpan; read: JsonValue; source: JsonValue }>();
  const intakePageReads: { requestId: string; page: number; digest: string; span: CapacityObserverSpan }[] = [];
  let dispatchCursor = 0, dispatchJournalReadAt: number | null = null;
  const invocations: { owner: string; span: { startedAt: number; monotonicStartedAt: number; endedAt: number | null; monotonicEndedAt: number | null }; outcome: JsonValue; failed: boolean | null }[] = [];
  const transportPrefixes = new Map<string, { start: number; end: number; attempts: readonly HttpAttempt[]; responses: readonly CapacitySourceResponse[] }>();
  const attemptIndex = new Map<string, HttpAttempt>(), responseIndex = new Map<string, CapacitySourceResponse>();
  const responseScopes = new Map<string, CapacitySourceResponse[]>();
  const begin = () => ({ startedAt: capacityTime(clock.wallNow()), monotonicStartedAt: clock.monotonicNow() });
  function end(start: ReturnType<typeof begin>): CapacityObserverSpan {
    const span = { ...start, endedAt: capacityTime(clock.wallNow()), monotonicEndedAt: clock.monotonicNow() };
    assert(Number.isFinite(span.monotonicStartedAt) && span.monotonicStartedAt >= 0
      && Number.isFinite(span.monotonicEndedAt) && span.monotonicEndedAt >= span.monotonicStartedAt
      && span.endedAt >= span.startedAt, 'observer clock moved backwards');
    return span;
  }
  function immutable(value: unknown): void {
    if (value && typeof value === 'object') { assert(Object.isFrozen(value), 'transport entries must be deeply immutable'); Object.values(value).forEach(immutable); }
  }
  function journal() {
    const rows = options.journals(), owners = manifest.source.requestOwners;
    assert.equal(rows.length, owners.length, 'every declared owner needs its own journal');
    assert.equal(new Set(rows.map(row => row.owner)).size, rows.length, 'duplicate owner journal');
    for (const owner of owners) assert(rows.some(row => row.owner === owner), 'missing owner journal');
    for (const row of rows) {
      assert.equal(row.rejectedRequests?.length ?? 0, 0, 'undeclared transport request');
      capacityTime(row.coverageStartedAt); capacityTime(row.coverageEndedAt); assert(row.coverageEndedAt >= row.coverageStartedAt);
      const prior = transportPrefixes.get(row.owner);
      if (prior) {
        assert.equal(row.coverageStartedAt, prior.start, 'owner coverage origin changed'); assert(row.coverageEndedAt >= prior.end);
        assert(row.attempts.length >= prior.attempts.length && row.responses.length >= prior.responses.length, 'transport history removed');
        prior.attempts.forEach((value, index) => assert.equal(row.attempts[index], value, 'HTTP history replaced'));
        prior.responses.forEach((value, index) => assert.equal(row.responses[index], value, 'response history replaced'));
      }
      for (let index = prior?.attempts.length ?? 0; index < row.attempts.length; index++) {
        const attempt = row.attempts[index]; immutable(attempt); assertCapacityHttpEndpoint(attempt, true);
        assert.equal(attempt.owner, row.owner); assert.equal(attempt.sequence, index + 1, 'incomplete owner sequence');
        assert(attempt.at >= row.coverageStartedAt && attempt.endedAt <= row.coverageEndedAt);
        assert(!attemptIndex.has(attempt.id), 'duplicate physical HTTP attempt'); attemptIndex.set(attempt.id, attempt);
      }
      for (const response of row.responses.slice(prior?.responses.length ?? 0)) {
        immutable(response); assert(!responseIndex.has(response.attemptId), 'duplicate source response');
        assert.equal(createHash('sha256').update(response.rawUtf8).digest('hex'), response.rawSha256);
        responseIndex.set(response.attemptId, response);
        const key = `${response.nativeLeagueId}/${response.resource}/${response.nativeWeek}`;
        responseScopes.set(key, [...(responseScopes.get(key) ?? []), response]);
      }
      transportPrefixes.set(row.owner, { start: row.coverageStartedAt, end: row.coverageEndedAt,
        attempts: [...row.attempts], responses: [...row.responses] });
    }
    return { requests: { coverageStartedAt: Math.max(...rows.map(row => row.coverageStartedAt)),
      coverageEndedAt: Math.min(...rows.map(row => row.coverageEndedAt)),
      ownerTotals: rows.map(row => ({ owner: row.owner, attempts: row.attempts.length })), attempts: [...attemptIndex.values()] } };
  }
  function league(key: string) { const row = manifest.source.leagues.find(row => row.key === key); assert(row, 'unknown league'); return row; }
  function expected(pairId: string, version: string) {
    if (recovery) {
      const pair = recovery.pairs.find(row => row.pairId === pairId); assert(pair);
      if (version === pair.before.version) return { reader: pair.initialReader, payload: pair.before };
      assert.equal(version, pair.after.version, 'undeclared recovery source version'); return { reader: pair.expectedReader, payload: pair.after };
    }
    const initial = manifest.source.initialReaders.find(row => row.pairId === pairId)!;
    const planned = manifest.plan.events.filter(row => row.pairId === pairId);
    const bound = planned.map(event => manifest.events.find(row => row.id === event.id)!);
    if (version === initial.reader.version) return { reader: initial.reader, payload: bound[0].before };
    const event = bound.find(row => row.after.version === version); assert(event, 'undeclared version');
    return { reader: event.expectedReader, payload: event.after };
  }
  function remember(rows: readonly BoundRead[]) {
    for (const row of rows) {
      const original = origins.get(row.origin.id); if (original) assert.deepEqual(original, row.origin, 'receipt source changed');
      else origins.set(row.origin.id, row.origin);
      const key = `${row.pairId}/${row.read.version}`;
      if (!receipts.has(key)) receipts.set(key, row.lineage);
      const { startedAt: readStart, endedAt: readEnd, monotonicStartedAt, monotonicEndedAt, pairId, selector, selection,
        firstReadMinusSqlAcceptedMs, readerValueDigest, outcome, ...proof } = row.lineage;
      const previous = receiptProofs.get(proof.receiptId);
      if (previous) assert.equal(capacityDigest(previous), capacityDigest(proof), 'immutable receipt proof changed');
      else receiptProofs.set(proof.receiptId, freezeCapacityValue(structuredClone(proof)));
      const outcomeId = outcome === null ? null : capacityDigest(outcome);
      if (outcomeId !== null && !dispatchOutcomes.has(outcomeId)) dispatchOutcomes.set(outcomeId, freezeCapacityValue(structuredClone(outcome!)));
      lineage.push({ startedAt: readStart, endedAt: readEnd, monotonicStartedAt, monotonicEndedAt,
        proofId: proof.receiptId, pairId, selector, selection, firstReadMinusSqlAcceptedMs, readerValueDigest, outcomeId });
    }
  }
  async function bindReceipt(mapping: AdministrationSourceMapping, key: string, resource: Resource, receiptId: string,
    provenance: AdministrationProvenance, values: ReadonlyMap<CapacityFamily, JsonValue>, selection: 'current' | 'receipt',
    start: ReturnType<typeof begin>, signal: AbortSignal): Promise<BoundRead[]> {
    const rows = await options.database.query(CAPACITY_RECEIPT_LINEAGE_SQL, [uuid(receiptId)], { signal });
    assert.equal(rows.length, 1, 'ambiguous or absent committed receipt');
    const row = rows[0], receipt = object(row.receipt), acceptance = object(row.acceptance), attempt = object(row.attempt);
    const content = object(row.content), dispatch = object(row.dispatch), native = league(key);
    assert.equal(receipt.id, receiptId); assert.equal(receipt.attempt_id, attempt.id); assert.equal(receipt.content_id, content.id);
    assert.equal(acceptance.receipt_id, receiptId); assert.equal(acceptance.scope_id, attempt.scope_id);
    assert.equal(acceptance.source_mapping_revision_id, mapping.revisionId);
    assert.equal(content.league_season_id, mapping.leagueSeasonId); assert.equal(content.external_league_id, native.nativeLeagueId);
    assert.equal(content.provider, 'sleeper'); assert.equal(content.family, resource); assert.equal(content.accepted, true);
    assert.equal(Number(content.week), resource === 'rosters' ? 0 : Number(native.nativePeriod));
    assert.equal(capacityDigest(attempt.source_mapping), capacityDigest(mapping));
    assert.equal(capacityDigest(receipt.provenance), capacityDigest(provenance)); assert.equal(provenance.origin, 'network');
    const captureStart = timestamp(provenance.requestStartedAt), captureEnd = timestamp(provenance.requestCompletedAt);
    assert.equal(timestamp(provenance.sourceObservedAt), captureEnd); assert(captureStart <= captureEnd);
    const witness = parsePublicCaptureWitness(provenance.acquisition), role = resource === 'rosters' ? 'players' : resource;
    assert.equal(witness.attempts[role]?.id, attempt.id); assert.equal(witness.attempts[role]?.nonce, attempt.capture_nonce);
    assert.equal(capacityDigest(witness.mapping), capacityDigest(mapping));
    assert.equal(capacityDigest(witness.fence), capacityDigest(attempt.write_fence));
    assert.equal(witness.fence.workerId, dispatch.worker_id); assert.equal(witness.fence.generation, Number(dispatch.generation));
    assert.equal(witness.dispatchNonce, dispatch.capture_nonce); assert.equal(capacityDigest(witness.work), capacityDigest(dispatch.work));
    assert('externalLeagueId' in witness.work && witness.work.externalLeagueId === native.nativeLeagueId && witness.work.season === native.season);
    assert(resource === 'rosters' ? witness.work.kind === 'core'
      : witness.work.kind === (resource === 'matchups' ? 'exact-matchups' : 'transactions')
        && 'nativeWeek' in witness.work && witness.work.nativeWeek === Number(native.nativePeriod));
    journal();
    const path = `/v1/league/${native.nativeLeagueId}/${resource}${resource === 'rosters' ? '' : '/' + native.nativePeriod}`;
    const candidates = (responseScopes.get(`${native.nativeLeagueId}/${resource}/${resource === 'rosters' ? null : Number(native.nativePeriod)}`) ?? []).filter(response => {
      const http = attemptIndex.get(response.attemptId);
      return http?.method === 'GET' && http.path === path && http.outcome === 'success'
        && response.nativeLeagueId === native.nativeLeagueId && response.resource === resource
        && response.nativeWeek === (resource === 'rosters' ? null : Number(native.nativePeriod))
        && captureStart <= response.requestStartedAt && response.responseCompletedAt <= captureEnd
        && http.at === response.requestStartedAt && http.endedAt === response.responseCompletedAt
        && http.responseSha256 === response.rawSha256 && capacityDigest(JSON.parse(response.rawUtf8)) === capacityDigest(content.payload);
    });
    assert.equal(candidates.length, 1, 'receipt needs one unambiguous physical source response');
    const response = candidates[0], physical = attemptIndex.get(response.attemptId)!;
    const endpoint = endpointInventory.find(row => row.id === response.endpointId);
    assert(endpoint && endpoint.method === physical.method && new URL(endpoint.url).pathname === physical.path
      && endpoint.resource === resource && endpoint.scope.nativeLeagueId === native.nativeLeagueId, 'wrong frozen endpoint');
    const invocationsForCapture = invocations.filter(invocation => invocation.owner === physical.owner
      && invocation.span.startedAt <= captureStart && captureEnd <= (invocation.span.endedAt ?? clock.wallNow())
      && timestamp(witness.fence.deadlineAt) === invocation.span.startedAt + 20_000);
    assert.equal(invocationsForCapture.length, 1, 'unattributed or ambiguous ordinary invocation');
    assert(physical.owner !== 'independent-measurement', 'independent probe cannot become an imported origin');
    assert.equal(createHash('sha256').update(response.rawUtf8).digest('hex'), response.rawSha256);
    assert.equal(response.responseBoundary, 'full-synthetic-bytes-available');
    assert(response.requestStartedAt <= response.responseCompletedAt && response.monotonicStartedAt <= response.monotonicCompletedAt);
    const span = end(start); assert(captureEnd <= span.endedAt, 'future source receipt');
    assert.equal(capacityDigest(response.pairIds.slice().sort()), capacityDigest(familiesFor(resource).map(family => `${key}/${family}`).sort()));
    return familiesFor(resource).map(family => {
      const pairId = `${key}/${family}`, bound = expected(pairId, response.version), value = values.get(family); assert(value !== undefined);
      assert.equal(bound.payload.sha256, response.rawSha256, 'response differs from frozen source version');
      const origin: OriginObservation = { id: `${receiptId}/${pairId}`, pairId, version: response.version,
        payloadSha256: response.rawSha256, observedAt: response.responseCompletedAt, attemptId: response.attemptId, kind: 'successful-provider-observation' };
      const anchor = anchors.get(pairId);
      const available = anchor === undefined ? null : manifest.plan.events.filter(event => event.pairId === pairId
        && anchor + event.offsetMs <= response.requestStartedAt).at(-1);
      const recoveryPair = recovery?.pairs.find(row => row.pairId === pairId);
      const published = recoveryPair ? response.requestStartedAt < publicationAt ? recoveryPair.before : recoveryPair.after
        : available ? manifest.events.find(event => event.id === available.id)!.after
          : manifest.events.find(event => event.id === manifest.plan.events.find(event => event.pairId === pairId)!.id)!.before;
      assert.equal(response.version, published.version, 'source version unavailable at request start');
      let selector = bound.reader.selector;
      if (selection === 'receipt') {
        const history = (recovery ? recovery.pairs.find(row => row.pairId === pairId)!.retainedHistory : manifest.plan.events.filter(event => event.pairId === pairId)
          .flatMap(event => manifest.events.find(bound => bound.id === event.id)!.retainedHistory))
          .find(reader => reader.version === response.version);
        assert(history, 'undeclared immutable history selector'); selector = history.selector;
      }
      const reader = { selector, version: response.version, value };
      const sqlAcceptedAt = String(acceptance.accepted_at); assert(timestamp(sqlAcceptedAt) <= span.endedAt, 'future SQL acceptance');
      assert(Number.isSafeInteger(Number(acceptance.generation)) && Number(acceptance.generation) > 0);
      return { pairId, origin, reader, read: { at: span.endedAt, committed: true, storedOnly: true,
        version: response.version, payloadSha256: response.rawSha256, originObservationId: origin.id },
        lineage: { ...span, pairId, selector: reader.selector, selection, version: response.version, receiptId,
          acceptanceId: uuid(acceptance.id), acceptedGeneration: Number(acceptance.generation), sqlAcceptedAt,
          firstReadMinusSqlAcceptedMs: span.endedAt - timestamp(sqlAcceptedAt), mapping, contentId: uuid(content.id),
          sourceAttemptId: uuid(attempt.id), transportAttemptId: response.attemptId, sourceResponseSha256: response.rawSha256,
          sourceResponseCompletedAt: response.responseCompletedAt, receiptProvenance: provenance,
          dispatch, outcome: row.outcome === null ? null : object(row.outcome), readerValueDigest: capacityDigest(value) } };
    });
  }
  async function readGroup(key: string, resource: Resource, signal: AbortSignal, retained?: CapacityObserverLineage): Promise<BoundRead[]> {
    const start = begin(), native = league(key), store = createLeagueAdministrationStore(withDatabaseAbortSignal(options.database, signal));
    const mapping = retained?.mapping ?? await store.readSourceMapping(native.nativeLeagueId);
    assert(mapping && mapping.scope.provider === 'sleeper' && mapping.scope.externalLeagueId === native.nativeLeagueId
      && mapping.scope.season === native.season, 'missing or wrong actual source mapping');
    const values = new Map<CapacityFamily, JsonValue>(); let receiptId: string, provenance: AdministrationProvenance;
    if (resource === 'rosters') {
      const current = retained ? null : await store.readAcceptedCurrentRoster(mapping);
      if (current) assert.equal(current.status, 'available');
      receiptId = retained?.receiptId ?? (current?.status === 'available' ? current.receipt.id : '');
      const links = await store.readRosterPlayerLinks({ rosterReceiptId: receiptId, leagueSeasonId: mapping.leagueSeasonId });
      assert.equal(links.status, 'available'); assert(links.status === 'available');
      assert.equal(links.rosterReceiptId, receiptId); assert.equal(capacityDigest(links.mapping), capacityDigest(mapping));
      provenance = links.rosterSource;
      if (current?.status === 'available') assert.equal(capacityDigest(current.receipt.provenance), capacityDigest(provenance));
      const team = links.teams.find(team => team.externalRosterId === '1'); assert(team, 'missing declared roster');
      values.set('rosters', json({ categories: team.categories }));
    } else if (resource === 'matchups') {
      assert(store.readExactMatchupValues, 'missing typed matchup reader');
      const exact = await store.readExactMatchupValues(mapping, { nativeWeek: Number(native.nativePeriod),
        ...(retained ? { matchupsReceiptId: retained.receiptId } : {}) });
      assert.equal(exact.status, 'available'); assert(exact.status === 'available');
      assert.equal(exact.selection, retained ? 'receipt' : 'current'); assert.equal(exact.sourceMappingRevisionId, mapping.revisionId);
      receiptId = exact.matchupsReceiptId; provenance = exact.provenance;
      values.set('lineups', json({ starters: exact.value.teams.map(team => ({ externalRosterId: team.externalRosterId, starters: team.starters })) }));
      values.set('official-scores', json({ raw: exact.value.teams.map(team => ({ externalRosterId: team.externalRosterId, rawPoints: team.rawPoints })),
        custom: exact.value.teams.map(team => ({ externalRosterId: team.externalRosterId, customPoints: team.customPoints })),
        effective: exact.value.teams.map(team => ({ externalRosterId: team.externalRosterId, effectivePoints: team.effectivePoints })) }));
    } else {
      const transaction = await store.readAcceptedTransactions(mapping, Number(native.nativePeriod), retained ? { receiptId: retained.receiptId } : undefined);
      assert.equal(transaction.status, 'available'); assert(transaction.status === 'available');
      assert(transaction.capture.receipt && transaction.capture.accepted === true);
      receiptId = transaction.capture.receipt.id; provenance = transaction.capture.envelope.provenance;
      values.set('transactions', json({ normalized: transaction.capture.normalizedValue }));
    }
    if (retained) assert.equal(receiptId, retained.receiptId, 'history selector replaced by another receipt');
    return bindReceipt(mapping, key, resource, receiptId, provenance, values, retained ? 'receipt' : 'current', start, signal);
  }
  async function bounded<T>(operation: string, run: (signal: AbortSignal) => Promise<T>, deadlineAt: number): Promise<T | null> {
    const controller = new AbortController(), remaining = deadlineAt - clock.wallNow();
    if (remaining <= 0) { failures.push({ operation, at: capacityTime(clock.wallNow()), reason: 'timeout' }); return null; }
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const value = await Promise.race([run(controller.signal), new Promise<never>((_, reject) => {
        timer = setTimeout(() => { controller.abort(); reject(new Error('observer timeout')); }, remaining);
      })]);
      if (clock.wallNow() > deadlineAt) throw new Error('observer timeout');
      return value;
    } catch (error) { failures.push({ operation, at: capacityTime(clock.wallNow()),
      ...(error instanceof Error && error.name === 'AssertionError' ? { assertionLocation: error.stack?.match(/freshness-capacity-observer\.ts:\d+:\d+/u)?.[0] ?? 'observer assertion' } : {}), reason: controller.signal.aborted || clock.wallNow() > deadlineAt ? 'timeout' : 'unavailable' }); return null; }
    finally { if (timer) clearTimeout(timer); controller.abort(); }
  }
  async function current(key: string, resource: Resource, operation: string, deadlineAt = clock.wallNow() + manifest.plan.sampleTimeoutMs) {
    const result = await bounded(operation, signal => readGroup(key, resource, signal), deadlineAt);
    if (result) remember(result); return result;
  }
  const groups = (key: string) => (['rosters', 'matchups', 'transactions'] as const).map(resource => ({ key, resource }));
  /** The caller supplies its existing ordinary operation, with the unchanged invocation origin. */
  async function observeInvocation<T>(owner: string, run: (invocationStartedAt: number) => Promise<T>) {
    assert(manifest.source.requestOwners.includes(owner) && owner !== 'independent-measurement', 'undeclared acquisition owner');
    const start = begin();
    const entry: typeof invocations[number] = { owner, span: { ...start, endedAt: null, monotonicEndedAt: null }, outcome: null, failed: null };
    // A committed DATA receipt may be read while its enclosing production facade is still running.
    invocations.push(entry);
    try {
      const outcome = await run(start.startedAt); entry.span = end(start);
      entry.outcome = outcome === undefined ? null : json(outcome); entry.failed = false; return outcome;
    } catch (error) { entry.span = end(start); entry.failed = true; throw error; }
  }
  /** Read every DATA outcome separately from the facade's primary return value. No acquisition or retry. */
  async function observeDispatches() {
    const operation = 'dispatch-journal', start = begin();
    assert(!inFlight.has(operation), 'dispatch journal read already active'); inFlight.add(operation);
    try {
      const read = await bounded(operation, async signal => {
        const pending = [...durableDispatches.values()].filter(row => row.outcome === null).map(row => Number(row.dispatch.generation));
        for (let page = 0; page < 100; page++) {
          const pageStart = begin();
          const rows = await options.database.query(CAPACITY_DISPATCH_JOURNAL_SQL, [dispatchCursor, pending], { signal });
          const entries: { key: string; outcomeId: string | null }[] = [];
          for (const row of rows) {
            const dispatch = object(row.dispatch), outcome = row.outcome === null ? null : object(row.outcome);
            const generation = Number(dispatch.generation); assert(Number.isSafeInteger(generation) && generation > 0);
            const key = `${uuid(dispatch.worker_id)}/${generation}`, previous = durableDispatches.get(key);
            if (previous) {
              assert.equal(capacityDigest(previous.dispatch), capacityDigest(dispatch), 'durable dispatch changed');
              if (previous.outcome !== null) assert.equal(capacityDigest(previous.outcome), capacityDigest(outcome), 'sealed dispatch outcome changed');
            }
            durableDispatches.set(key, freezeCapacityValue(structuredClone({ dispatch, outcome })));
            const outcomeId = outcome === null ? null : capacityDigest(outcome);
            if (outcomeId !== null && !dispatchOutcomes.has(outcomeId)) dispatchOutcomes.set(outcomeId, freezeCapacityValue(structuredClone(outcome!)));
            entries.push({ key, outcomeId });
            dispatchCursor = Math.max(dispatchCursor, generation);
          }
          dispatchObservations.push({ span: end(pageStart), entries });
          if (rows.length < 1000) { dispatchJournalReadAt = capacityTime(clock.wallNow()); return true; }
        }
        throw new Error('dispatch journal page bound exceeded');
      }, start.startedAt + manifest.plan.sampleTimeoutMs);
      operations.push({ operation, span: end(start), outcome: json({ complete: read === true, entries: durableDispatches.size,
        pending: [...durableDispatches.values()].filter(row => row.outcome === null).length }) });
    } finally { inFlight.delete(operation); }
  }
  async function firstAcceptance(key: string) {
    await Promise.all(groups(key).map(async ({ resource }) => {
      const pairIds = familiesFor(resource).map(family => `${key}/${family}`);
      if (pairIds.some(id => first.has(id))) { assert(pairIds.every(id => first.has(id)), 'split matchup anchor'); return; }
      const token = `first/${key}/${resource}`; assert(!inFlight.has(token), 'duplicate first acceptance read'); inFlight.add(token);
      try {
        const rows = await current(key, resource, token); if (!rows) return;
        for (const row of rows) {
          const initial = manifest.source.initialReaders.find(item => item.pairId === row.pairId)!;
          const cohort = manifest.plan.leagues.find(item => item.key === key)!.cohort;
          if (cohort !== 'accepted') {
            const intake = intakes.get(cohort), requestId = intakeIds.get(cohort);
            if (!intake?.acceptedAt || !requestId || object(row.lineage.dispatch.work).requestId !== requestId
              || timestamp(row.lineage.receiptProvenance.requestStartedAt) < intake.acceptedAt) {
              failures.push({ operation: token, at: row.read.at, reason: 'unavailable' }); return;
            }
          }
          if (capacityDigest(row.reader) !== capacityDigest(initial.reader)) { failures.push({ operation: token, at: row.read.at, reason: 'unavailable' }); return; }
        }
        for (const row of rows) {
          first.set(row.pairId, { pairId: row.pairId, at: row.read.at, read: row.read, reader: row.reader });
          anchors.set(row.pairId, manifest.plan.leagues.find(league => league.key === key)!.cohort === 'accepted' ? startedAt : row.read.at);
        }
      } finally { inFlight.delete(token); }
    }));
  }
  async function ancillaryAnchor(key: string, component: CapacityAncillaryComponent, signal: AbortSignal) {
    const id = key + '/' + component; if (ancillaryAnchors.has(id)) return;
    const planned = manifest.plan.leagues.find(row => row.key === key)!, requestId = ancillaryRequests.get(planned.cohort);
    if (!requestId) return;
    if (!recovery && planned.cohort === 'accepted') {
      ancillaryAnchors.set(id, { leagueKey: key, component, kind: 'benchmark', at: startedAt, requestId, receiptId: null, query: null }); return;
    }
    if (component === 'standings' || component === 'exact-results') {
      const pairId = key + (component === 'standings' ? '/rosters' : '/lineups');
      const accepted = recovery ? recoveryHeads.initial.get(pairId)?.read : first.get(pairId)?.read;
      const anchor = anchors.get(pairId); if (!accepted || anchor === undefined) return;
      ancillaryAnchors.set(id, { leagueKey: key, component, kind: 'pair-first-read', at: anchor, requestId,
        receiptId: uuid(accepted.originObservationId.split('/')[0]), query: null }); return;
    }
    const beginQuery = begin(), params = [requestId, league(key).nativeLeagueId, component];
    const rows = await options.database.query(CAPACITY_ANCILLARY_FIRST_RECEIPT_SQL, params, { signal });
    const query = { sql: CAPACITY_ANCILLARY_FIRST_RECEIPT_SQL, params: json(params), rowsRef: ancillaryRowsRef(rows), span: end(beginQuery) };
    if (!rows.length) return;
    assert.equal(rows.length, 1); const row = rows[0], receipt = object(row.receipt), acceptance = object(row.acceptance), dispatch = object(row.dispatch);
    assert.equal(dispatch.intake_id, requestId); assert.equal(object(row.content).family, component);
    assert.equal(object(row.content).external_league_id, league(key).nativeLeagueId); assert.equal(acceptance.receipt_id, receipt.id);
    const candidate = { receiptId: uuid(receipt.id), acceptedAt: String(acceptance.accepted_at), requestId };
    timestamp(candidate.acceptedAt);
    const pending = pendingAncillaryAnchors.get(id);
    if (pending) assert.deepEqual(candidate, pending, 'earliest ancillary receipt changed before checkpoint');
    else pendingAncillaryAnchors.set(id, candidate);
    operations.push({ operation: 'ancillary-anchor/' + id, span: query.span,
      outcome: json({ status: row.outcome === null ? 'pending-checkpoint' : object(row.outcome).outcome, ...candidate, query }) });
    if (row.outcome === null) return;
    assert.equal(object(row.outcome).outcome, 'checkpoint-committed');
    assert.equal(object(row.outcome).worker_id, dispatch.worker_id); assert.equal(object(row.outcome).generation, dispatch.generation);
    ancillaryAnchors.set(id, { leagueKey: key, component, kind: 'initial-request-first-receipt', at: timestamp(candidate.acceptedAt),
      requestId, receiptId: candidate.receiptId, query });
  }
  async function ancillaryComponent(key: string, component: CapacityAncillaryComponent, signal: AbortSignal,
    observation: CapacityAncillaryRead) {
    const start = begin(), native = league(key), trace: CapacityAncillaryQuery[] = [];
    const traced: DatabaseClient = { enabled: true, query: (async (sql: string, params: readonly unknown[] = [], queryOptions?: Parameters<DatabaseClient['query']>[2]) => {
      const queryStart = begin(), rows = await options.database.query(sql, params, { ...queryOptions, signal });
      trace.push({ sql, params: json(params), rowsRef: ancillaryRowsRef(rows), span: end(queryStart) }); return rows;
    }) as DatabaseClient['query'] };
    const store = createLeagueAdministrationStore(traced);
    // Mapping lookup is not a freshness observation; the receipt and typed readers bind it independently.
    const mapping = await createLeagueAdministrationStore(withDatabaseAbortSignal(options.database, signal)).readSourceMapping(native.nativeLeagueId);
    assert(mapping && mapping.scope.provider === 'sleeper' && mapping.scope.season === 2026 && mapping.scope.externalLeagueId === native.nativeLeagueId);
    let currentRead: unknown, retainedRead: unknown, context: unknown = null;
    if (component === 'standings') { assert(store.readOfficialStandings); currentRead = await store.readOfficialStandings(mapping); }
    else if (component === 'exact-results') { assert(store.readExactMatchupValues); currentRead = await store.readExactMatchupValues(mapping, { nativeWeek: Number(native.nativePeriod) }); }
    else { assert(store.readAcceptedBracket); currentRead = await store.readAcceptedBracket(mapping, { family: component }); }
    observation.unavailable[component] = json(currentRead);
    assert.equal(object(currentRead).status, 'available');
    const receiptId = uuid(component === 'standings' ? object(object(currentRead).capture).rosterReceiptId
      : object(currentRead)[component === 'exact-results' ? 'matchupsReceiptId' : 'bracketReceiptId']);
    const currentQueries = [...trace]; trace.length = 0;
    if (component === 'exact-results') {
      assert(store.readExactPeriodContext); context = await store.readExactPeriodContext(mapping, { nativeWeek: Number(native.nativePeriod), matchupsReceiptId: receiptId });
      observation.unavailable[component] = json({ current: currentRead, context }); assert.equal(object(context).status, 'available');
      assert.equal(object(object(context).capture).matchupsReceiptId, receiptId); assert.equal(object(object(context).period).nativeWeek, Number(native.nativePeriod));
    }
    const contextQueries = [...trace]; trace.length = 0;
    observation.currentQueries[component] = [...currentQueries,...contextQueries].map(query => ({
      digest: capacityDigest({ sql: query.sql, params: query.params, rowsRef: query.rowsRef }), span: query.span }));
    const cacheKey = capacityDigest({ key, component, mapping, currentRead, context,
      queries: observation.currentQueries[component]!.map(query => query.digest) });
    let proofId = ancillaryCache.get(cacheKey);
    if (!proofId) {
      if (component === 'standings') retainedRead = await store.readOfficialStandings!(mapping, { rosterReceiptId: receiptId });
      else if (component === 'exact-results') retainedRead = await store.readExactMatchupValues!(mapping, { nativeWeek: Number(native.nativePeriod), matchupsReceiptId: receiptId });
      else retainedRead = await store.readAcceptedBracket!(mapping, { family: component, bracketReceiptId: receiptId });
      assert.equal(object(retainedRead).status, 'available');
      assert.equal(capacityDigest({ ...object(currentRead), selection: 'receipt' }), capacityDigest(retainedRead), 'current and immutable ancillary reader disagree');
      const retainedQueries = [...trace], sourceStart = begin(); journal();
      const rows = await options.database.query(CAPACITY_ANCILLARY_RECEIPT_SQL, [receiptId], { signal }); assert.equal(rows.length, 1);
      const row = rows[0], receipt = object(row.receipt), acceptance = object(row.acceptance), attempt = object(row.attempt), content = object(row.content), dispatch = object(row.dispatch);
      const provenance = object(receipt.provenance), witness = parsePublicCaptureWitness(provenance.acquisition);
      assert.equal(receipt.id, receiptId); assert.equal(receipt.attempt_id, attempt.id); assert.equal(acceptance.receipt_id, receiptId);
      assert.equal(receipt.content_id, content.id); assert.equal(acceptance.scope_id, attempt.scope_id);
      assert.equal(content.family, component === 'standings' ? 'rosters' : component === 'exact-results' ? 'matchups' : component);
      if (row.outcome === null || object(row.outcome).outcome !== 'checkpoint-committed') observation.unavailable[component] = json({ current: currentRead, pendingSourceRowsRef: ancillaryRowsRef(rows) });
      assert.equal(object(row.outcome).outcome, 'checkpoint-committed'); assert.equal(object(row.outcome).worker_id, dispatch.worker_id);
      assert.equal(Number(object(row.outcome).generation), Number(dispatch.generation));
      assert.equal(provenance.origin, 'network'); assert.equal(provenance.sourceObservedAt, provenance.requestCompletedAt);
      assert.equal(capacityDigest(witness.mapping), capacityDigest(mapping)); assert.equal(capacityDigest(attempt.source_mapping), capacityDigest(mapping));
      assert.equal(acceptance.source_mapping_revision_id, mapping.revisionId); assert.equal(content.league_season_id, mapping.leagueSeasonId);
      assert.equal(content.external_league_id, native.nativeLeagueId); assert.equal(capacityDigest(witness.work), capacityDigest(dispatch.work));
      assert.equal(capacityDigest(witness.fence), capacityDigest(attempt.write_fence)); assert.equal(witness.fence.workerId, dispatch.worker_id);
      assert.equal(witness.fence.generation, Number(dispatch.generation)); assert.equal(witness.dispatchNonce, dispatch.capture_nonce);
      assert(Object.values(witness.attempts).some(value => value?.id === attempt.id && value.nonce === attempt.capture_nonce));
      const response = endpointResponse(content, timestamp(provenance.requestStartedAt), timestamp(provenance.requestCompletedAt));
      assertEndpointInvocation(response, timestamp(provenance.requestStartedAt), timestamp(provenance.requestCompletedAt), object(witness.fence));
      capacityStoredReceiptNormalization(row);
      const proof = { leagueKey: key, component, mapping, current: json(currentRead), retained: json(retainedRead), context: json(context),
        source: { requestId: uuid(dispatch.intake_id), endpointId: response.endpointId, proofId: receiptId, attemptId: response.attemptId,
          kind: 'resource-receipt' as const, record: json(row), readSpan: end(sourceStart) },
        queries: { current: currentQueries, retained: retainedQueries, context: contextQueries } };
      proofId = capacityDigest(proof); ancillaryProofs.set(proofId, freezeCapacityValue({ id: proofId, ...proof })); ancillaryCache.set(cacheKey, proofId);
    }
    const completed = end(start); assert(completed.endedAt <= observation.scheduledAt + manifest.plan.sampleTimeoutMs, 'late ancillary confirmation');
    observation.components[component] = proofId; delete observation.unavailable[component]; observation.componentSpans[component] = completed;
  }
  /** Independent fixed minute reads only. This does not schedule or acquire provider work. */
  async function observeAncillary(scheduledAt: number, initialRequests: ReadonlyMap<string, string>, selectedKeys?: readonly string[], forceBoundary = false) {
    capacityTime(scheduledAt);
    if (selectedKeys) assert(new Set(selectedKeys).size === selectedKeys.length && selectedKeys.every(key => manifest.plan.leagues.some(row => row.key === key)));
    for (const [cohort, requestId] of initialRequests) {
      assert(manifest.plan.leagues.some(row => row.cohort === cohort)); uuid(requestId);
      const previous = ancillaryRequests.get(cohort); assert(previous === undefined || previous === requestId, 'initial request binding changed'); ancillaryRequests.set(cohort, requestId);
    }
    await Promise.all(manifest.plan.leagues.filter(row => !selectedKeys || selectedKeys.includes(row.key)).map(async planned => {
      const slotId = planned.key + '/' + scheduledAt; assert(!ancillarySlots.has(slotId), 'ancillary slot cannot be replaced'); ancillarySlots.add(slotId);
      const start = begin(), observation: CapacityAncillaryRead = { leagueKey: planned.key, scheduledAt, span: { ...start, endedAt: start.startedAt, monotonicEndedAt: start.monotonicStartedAt },
        components: { standings: null, 'exact-results': null, winners_bracket: null, losers_bracket: null }, componentSpans: {}, currentQueries: {}, unavailable: {}, heads: null, unchanged: [], composed: null };
      ancillaryReads.push(observation);
      if (start.startedAt < scheduledAt || start.startedAt > scheduledAt + manifest.plan.sampleDispatchLatenessMs) {
        observation.unavailable.standings = { status: 'late-dispatch' }; observation.span = end(start); return;
      }
      const hint = await bounded('ancillary-heads/' + planned.key, async signal => {
        const queryStart = begin(), params = [league(planned.key).nativeLeagueId, Number(league(planned.key).nativePeriod)];
        const rows = await options.database.query(CAPACITY_ANCILLARY_HEADS_SQL, params, { signal });
        observation.heads = { sql: CAPACITY_ANCILLARY_HEADS_SQL, params: json(params), rowsRef: ancillaryRowsRef(rows), span: end(queryStart) };
        await Promise.all(CAPACITY_ANCILLARY_COMPONENTS.map(component => ancillaryAnchor(planned.key, component, signal)));
        return capacityDigest(rows);
      }, scheduledAt + manifest.plan.sampleTimeoutMs);
      const originalStart = recovery ? startedAt : startedAt - 3_600_000;
      const forced = forceBoundary || (scheduledAt - originalStart) % 900_000 === 0;
      if (hint !== null && ancillaryHeadFingerprints.get(planned.key) === hint && !forced) {
        observation.unchanged = [...CAPACITY_ANCILLARY_COMPONENTS]; observation.span = end(start); return;
      }
      await Promise.all(CAPACITY_ANCILLARY_COMPONENTS.map(component => bounded('ancillary/' + planned.key + '/' + component, async signal => {
        await ancillaryAnchor(planned.key, component, signal); await ancillaryComponent(planned.key, component, signal, observation);
      }, scheduledAt + manifest.plan.sampleTimeoutMs)));
      observation.span = end(start);
      if (observation.span.endedAt > scheduledAt + manifest.plan.sampleTimeoutMs) { observation.components = { standings: null, 'exact-results': null, winners_bracket: null, losers_bracket: null }; return; }
      if (CAPACITY_ANCILLARY_COMPONENTS.every(component => observation.components[component] !== null)) {
        const values = Object.fromEntries(CAPACITY_ANCILLARY_COMPONENTS.map(component => [component, ancillaryProofs.get(observation.components[component]!)!]));
        const input = { mapping: values.standings.mapping, standings: values.standings.current,
          periods: [{ nativeWeek: Number(league(planned.key).nativePeriod), values: values['exact-results'].current, context: values['exact-results'].context }],
          brackets: (['winners_bracket','losers_bracket'] as const).map(family => ({ family, resource: values[family].current })) } as unknown as OfficialResultsInput;
        observation.composed = { status: 'available', digest: capacityDigest(composeCapacityAncillary(input)) }; observation.span = end(start);
        if (observation.span.endedAt > scheduledAt + manifest.plan.sampleTimeoutMs) {
          observation.composed = null; observation.components = { standings: null, 'exact-results': null, winners_bracket: null, losers_bracket: null }; return;
        }
        if (hint !== null) ancillaryHeadFingerprints.set(planned.key, hint);
      }
    }));
  }
  async function observeDueSamples() {
    const now = capacityTime(clock.wallNow()), due = manifest.plan.samples.filter(slot => anchors.has(slot.pairId)
      && !samples.has(slot.id) && anchors.get(slot.pairId)! + slot.offsetMs <= now);
    const selected = new Map<string, typeof due>();
    for (const slot of due) { const pair = manifest.plan.pairs.find(pair => pair.id === slot.pairId)!;
      const key = `${pair.leagueKey}/${resourceFor(pair.family)}/${anchors.get(pair.id)! + slot.offsetMs}`;
      selected.set(key, [...(selected.get(key) ?? []), slot]); }
    await Promise.all([...selected.entries()].map(async ([token, slots]) => {
      const dispatchAt = capacityTime(clock.wallNow()), scheduledAt = anchors.get(slots[0].pairId)! + slots[0].offsetMs;
      // Claim every slot synchronously before the first await. No late result can reassign it.
      slots.forEach(slot => samples.set(slot.id, { id: slot.id, at: dispatchAt, status: 'unavailable', read: null }));
      if (dispatchAt > scheduledAt + manifest.plan.sampleDispatchLatenessMs) {
        failures.push({ operation: token, at: dispatchAt, reason: 'late' }); return;
      }
      const pair = manifest.plan.pairs.find(pair => pair.id === slots[0].pairId)!;
      const rows = await current(pair.leagueKey, resourceFor(pair.family), token, scheduledAt + manifest.plan.sampleTimeoutMs);
      const failure = failures.findLast(failure => failure.operation === token);
      for (const slot of slots) { const row = rows?.find(row => row.pairId === slot.pairId);
        samples.set(slot.id, { id: slot.id, at: dispatchAt, status: row ? 'available'
          : failure?.reason === 'timeout' ? 'timeout' : 'unavailable', read: row?.read ?? null }); }
    }));
  }
  async function observeEvents(key: string) {
    await Promise.all(groups(key).map(async ({ resource }) => {
      const now = capacityTime(clock.wallNow());
      const due = familiesFor(resource).some(family => { const pairId = `${key}/${family}`, anchor = anchors.get(pairId);
        const latest = anchor === undefined ? undefined : manifest.plan.events.filter(event => event.pairId === pairId && anchor + event.offsetMs <= now).at(-1);
        return latest !== undefined && !events.has(latest.id); });
      if (!due) return;
      const rows = await current(key, resource, `events/${key}/${resource}`); if (!rows) return;
      const historyReads = new Map<string, BoundRead[] | null>();
      for (const row of rows) {
        const anchor = anchors.get(row.pairId); if (anchor === undefined) continue;
        const planned = manifest.plan.events.find(event => event.pairId === row.pairId
          && manifest.events.find(bound => bound.id === event.id)!.after.version === row.read.version);
        if (!planned || events.has(planned.id)) continue;
        const bound = manifest.events.find(event => event.id === planned.id)!;
        const result = { id: planned.id, publishedAt: anchor + planned.offsetMs, read: row.read,
          reader: row.reader, retainedHistory: [] as ReaderExpectation[] };
        // Keep the first head observation; a later poll cannot improve its latency.
        events.set(planned.id, result);
        for (const historical of bound.retainedHistory) {
          const retained = receipts.get(`${row.pairId}/${historical.version}`); if (!retained) continue;
          if (!historyReads.has(retained.receiptId)) {
            const read = await bounded(`history/${planned.id}/${historical.version}`,
              signal => readGroup(key, resource, signal, retained), clock.wallNow() + manifest.plan.sampleTimeoutMs);
            historyReads.set(retained.receiptId, read); if (read) remember(read);
          }
          const history: BoundRead[] | null = historyReads.get(retained.receiptId)!; if (!history) continue;
          const observed: BoundRead = history.find(item => item.pairId === row.pairId)!;
          const reader = { ...observed.reader, selector: historical.selector };
          result.retainedHistory.push(reader);
          assert.equal(observed.reader.selector, historical.selector);
        }
      }
    }));
  }
  async function observeSubmission(cohort: Cohort, requestId: string, submit: () => Promise<PublicIntakeSubmissionReceipt>) {
    assert(!intakes.has(cohort), 'submission cannot be retried or replaced'); uuid(requestId);
    const start = begin(); intakes.set(cohort, { cohort, submittedAt: start.startedAt, receiptAt: null, acceptedAt: null, completeAt: null, coverage: 'incomplete' });
    intakeIds.set(cohort, requestId);
    try {
      const receipt = await submit(), span = end(start); operations.push({ operation: `submission/${cohort}`, span, outcome: json(receipt) });
      assert.equal(receipt.requestId, requestId); assert.equal(receipt.status, 'retained');
      const rows = await options.database.query(requestSql, [requestId]); assert.equal(rows.length, 1);
      assert.equal(rows[0].id, requestId); assert.equal(rows[0].resource_occurrence_id, null); assert.equal(rows[0].submission_capacity, null);
      assert.equal(rows[0].username, manifest.source.unrelatedUsernames[cohort === 'intake-a' ? 0 : 1]);
      assertFullRequest(rows[0]);
      intakes.set(cohort, { cohort, submittedAt: start.startedAt, receiptAt: span.endedAt,
        acceptedAt: timestamp(rows[0].created_at), completeAt: null, coverage: 'incomplete' });
    } catch { failures.push({ operation: `submission/${cohort}`, at: capacityTime(clock.wallNow()), reason: 'unavailable' }); }
  }
  function assertFullRequest(row: Record<string, unknown>) {
    const request = object(row.stored_request);
    assert.equal(capacityDigest(request.seasons), capacityDigest([2026]));
    assert.equal(request.period_inventory, 'sleeper-2026-native-period-inventory-v1');
    assert.equal(request.transaction_history, 'sleeper-2026-transaction-history-v1');
    assert.equal(request.transaction_period, null); assert.equal(request.playoff_brackets, 'sleeper-2026-playoff-brackets-v1');
    assert.equal(request.draft_picks, 'sleeper-2026-draft-picks-v1');
    const periods = Array.from({ length: 18 }, (_, index) => ({ season: 2026, nativeWeek: index + 1 }));
    assert.equal(capacityDigest(request.exact_periods), capacityDigest(periods));
    assert.equal(capacityDigest(request.weekly_reports), capacityDigest(periods));
    assert.equal(row.resource_occurrence_id, null); assert.equal(row.submission_capacity, null);
  }
  function assertDiscovery(row: Record<string, unknown>, nativeIds: readonly string[]) {
    const identity = object(row.identity), identityPayload = object(identity.payload);
    const endpoint = endpointInventory.find(endpoint => endpoint.resource === 'identity'
      && new URL(endpoint.url).pathname === `/v1/user/${row.username}`); assert(endpoint);
    assert.equal(identityPayload.user_id, endpoint.scope.nativeManagerId);
    const lists = row.lists; assert(Array.isArray(lists) && lists.length === 1);
    const list = object(lists[0]); assert.equal(list.season, 2026); assert(Array.isArray(list.payload));
    assert.equal(capacityDigest(list.payload.map(value => object(value).league_id).sort()), capacityDigest([...nativeIds].sort()));
    journal(); assert(Array.isArray(row.discovery_dispatches));
    for (const [resource, stored] of [['identity', identity], ['league-list', list]] as const) {
      const start = timestamp(stored.request_started_at), completed = timestamp(stored.request_completed_at);
      const responses = [...responseIndex.values()].filter(response => response.resource === resource
        && start <= response.requestStartedAt && response.responseCompletedAt <= completed
        && capacityDigest(JSON.parse(response.rawUtf8)) === capacityDigest(stored.payload));
      assert.equal(responses.length, 1, 'unbound discovery response');
      const response = responses[0], physical = attemptIndex.get(response.attemptId); assert(physical?.outcome === 'success');
      const declared = endpointInventory.find(item => item.id === response.endpointId);
      assert(declared && declared.resource === resource && declared.method === physical.method
        && new URL(declared.url).pathname === physical.path && declared.scope.nativeManagerId === identityPayload.user_id);
      const recoveryEndpoint = (daily?.endpoints ?? recovery?.endpoints)?.find(row => row.id === declared.id);
      const sourceVersion = recoveryEndpoint ? response.requestStartedAt < publicationAt ? recoveryEndpoint.before : recoveryEndpoint.after : declared.versions[0];
      assert.equal(sourceVersion.sha256, response.rawSha256);
      const acquisitions: Record<string, unknown>[] = row.discovery_dispatches.map(value => object(value)).filter(item => object(item.dispatch).resource === (resource === 'identity' ? 'identity' : 'leagues')
        && object(item.outcome).outcome === 'checkpoint-committed');
      assert.equal(acquisitions.length, 1, 'ambiguous discovery dispatch');
      const dispatch = object(acquisitions[0].dispatch), outcome = object(acquisitions[0].outcome);
      assert.equal(outcome.outcome, 'checkpoint-committed');
      const witness = parsePublicCaptureWitness(outcome.capture_acquisition);
      assert.equal(witness.work.requestId, row.id); assert.equal(capacityDigest(witness.work), capacityDigest(dispatch.work));
      assert.equal(witness.dispatchNonce, dispatch.capture_nonce); assert.equal(witness.fence.workerId, dispatch.worker_id);
      assert.equal(witness.fence.generation, Number(dispatch.generation));
      assert(witness.work.kind === 'identity' ? witness.work.username === row.username
        : witness.work.kind === 'leagues' && witness.work.userId === identityPayload.user_id && witness.work.season === 2026);
      assert.equal(invocations.filter(invocation => invocation.owner === physical.owner
        && invocation.span.startedAt <= start && completed <= (invocation.span.endedAt ?? clock.wallNow())
        && timestamp(witness.fence.deadlineAt) === invocation.span.startedAt + 20_000).length, 1);
      if (stored.intake_id === row.id) {
        const proofId = uuid(row.id), kind = resource === 'identity' ? 'identity-observation' : 'league-list';
        retainEndpoint({ endpointId: declared.id, requestId: proofId, attemptId: physical.id, proofId, kind,
          sourceObservedAt: completed, acceptedAt: timestamp(outcome.recorded_at), readAt: capacityTime(clock.wallNow()),
          payloadSha256: response.rawSha256, version: response.version }, begin(), { stored, dispatch, outcome });
      }
    }
  }
  function draftKey(entry: Record<string, unknown>) {
    const resource = object(entry.resource), value = object(resource.value);
    return `${entry.externalLeagueId}/${value.kind}/${entry.externalDraftId ?? '-'}`;
  }
  function draftPayload(endpoint: CapacityManifest['source']['endpointInventory'][number], at: number): JsonValue {
    const bound = (daily?.endpoints ?? recovery?.endpoints)?.find(row => row.id === endpoint.id);
    return JSON.parse(bound ? (at < publicationAt ? bound.before : bound.after).utf8 : endpoint.versions[0].utf8);
  }
  function assertDraftValue(entry: Record<string, unknown>) {
    const resource = object(entry.resource), value = object(resource.value), nativeId = String(entry.externalLeagueId);
    assert(manifest.source.leagues.some(row => row.nativeLeagueId === nativeId) || daily?.auxiliary.admittedNativeLeagueId === nativeId);
    const endpoints = endpointInventory.filter(row => row.scope.nativeLeagueId === nativeId);
    const at = recovery ? timestamp(object(resource.provenance).requestStartedAt) : 0;
    const catalog = draftPayload(endpoints.find(row => row.resource === 'draft-catalog')!, at) as Record<string, JsonValue>[];
    const draft = catalog.find(row => row.draft_id === entry.externalDraftId);
    const nativeResource = value.kind === 'catalog' ? 'draft-catalog' : value.kind === 'detail' ? 'draft-detail'
      : value.kind === 'selections' ? 'draft-selections' : value.kind === 'league' ? 'league-trades' : value.kind === 'draft' ? 'draft-trades' : null;
    assert(nativeResource && (entry.externalDraftId == null || draft), 'undeclared draft resource identity');
    const endpoint = endpoints.find(row => row.resource === nativeResource && row.scope.nativeDraftId === (entry.externalDraftId ?? null)); assert(endpoint);
    const body = draftPayload(endpoint, at);
    const payload = value.kind === 'catalog' ? { metadataVersion: 'sleeper-draft-metadata-v1', kind: 'catalog', catalog, details: [], reason: null }
      : value.kind === 'detail' ? { metadataVersion: 'sleeper-draft-metadata-v1', kind: 'detail', externalDraftId: entry.externalDraftId, catalog: draft, draft: body }
        : value.kind === 'selections' ? { selectionsVersion: 'sleeper-draft-selections-v1', kind: 'selections', externalDraftId: entry.externalDraftId, catalog: draft, picks: body }
          : value.kind === 'league' ? { tradedPicksVersion: 'sleeper-traded-picks-v1', kind: 'league', tradedPicks: body }
            : { tradedPicksVersion: 'sleeper-traded-picks-v1', kind: 'draft', externalDraftId: entry.externalDraftId, catalog: draft, tradedPicks: body };
    const normalized = normalizeAdministrationObservation({ schemaVersion: 'league-administration-v1', normalizerVersion: 'sleeper-administration-v1',
      dialect: 'sleeper-nfl-v1', scope: capacityDraftReaderScope(resource, nativeId),
      family: 'drafts', week: null, completeness: 'complete', payload: json(payload), provenance: resource.provenance as AdministrationProvenance });
    const projected = value.kind === 'catalog' || value.kind === 'detail' ? projectDraftMetadata(normalized)
      : value.kind === 'selections' ? projectDraftSelections(normalized) : projectTradedPicks(normalized);
    assert.equal(projected.status, 'accepted'); assert.equal(resource.version, projected.version);
    assert.equal(capacityDigest(value), capacityDigest(projected.value), 'draft typed value differs from frozen native source');
    assert.equal(resource.selection, 'receipt'); uuid(resource.receiptId);
    return { key: draftKey(entry), receiptId: resource.receiptId, endpointId: endpoint.id, valueDigest: capacityDigest(value) };
  }
  async function proveCurrentCore(requestId: string, nativeLeagueId: string, kind: 'settings' | 'teamManagers' | 'heldRoster', read: Record<string, unknown>, signal: AbortSignal) {
    const start = begin(), receiptId = uuid(object(read.receipt).id);
    const rows = await options.database.query(CAPACITY_ENDPOINT_RECEIPTS_SQL.replace('dispatch.intake_id=$1::uuid', 'receipt.id=$1::uuid'), [receiptId], { signal });
    assert.equal(rows.length, 1); const row = rows[0], content = object(row.content), receipt = object(row.receipt), acceptance = object(row.acceptance);
    assert.equal(content.external_league_id, nativeLeagueId); assert.equal(receipt.id, receiptId); assert.equal(acceptance.receipt_id, receiptId);
    assert.equal(object(read.accepted).contentId, content.id); assert.equal(object(read.accepted).sourceMappingRevisionId, acceptance.source_mapping_revision_id);
    const normalized = capacityStoredReceiptNormalization(row), provenance = object(receipt.provenance);
    const response = endpointResponse(content, timestamp(provenance.requestStartedAt), timestamp(provenance.requestCompletedAt));
    const witness = parsePublicCaptureWitness(provenance.acquisition);
    assertEndpointInvocation(response, timestamp(provenance.requestStartedAt), timestamp(provenance.requestCompletedAt), object(witness.fence));
    if (kind === 'settings') { assert.equal(normalized.leagueSettings?.status, 'complete'); assert.equal(capacityDigest(read.value), capacityDigest(normalized.leagueSettings!.value)); }
    else {
      assert(normalized.value?.family === 'rosters'); assert(Array.isArray(read.teams));
      if (kind === 'heldRoster') {
        assert.equal(read.teams.length, normalized.value.teams.length);
        for (const team of normalized.value.teams) {
          const actual: Record<string, unknown> | undefined = read.teams.map(object).find(row => row.externalRosterId === team.externalRosterId); assert(actual && Array.isArray(actual.players));
          assert.equal(capacityDigest(actual.players.map((value: unknown) => object(object(value).sourceEntity).nativeId)), capacityDigest(team.playerExternalIds));
          assert.equal(capacityDigest(actual.currentGroups), capacityDigest(projectCurrentRosterGroups(team,
            actual.players as Parameters<typeof projectCurrentRosterGroups>[1], receiptId, receipt.provenance as AdministrationProvenance)));
        }
      } else {
        assert(normalized.teamManagers?.teams); assert.equal(read.teams.length, normalized.teamManagers.teams.length);
        for (const team of normalized.teamManagers.teams) {
          const actual = read.teams.map(object).find(row => object(row.sourceTeam).nativeId === team.externalRosterId); assert(actual);
          const owner = object(actual.primaryOwner), co = object(actual.coManagers); assert.equal(owner.state, team.primaryOwner.state);
          assert.equal(owner.manager === null ? null : object(object(owner.manager).sourceManager).nativeId, team.primaryOwner.externalManagerId);
          assert.equal(co.state, team.coManagers.state); assert.equal(capacityDigest(co.managers === null ? null : (co.managers as unknown[]).map(value => object(object(value).sourceManager).nativeId).sort()),
            capacityDigest(team.coManagers.externalManagerIds === null ? null : [...team.coManagers.externalManagerIds].sort()));
        }
      }
    }
    const entry = { requestId, nativeLeagueId, kind, span: end(start), read: json(read), source: json(row) }, id = capacityDigest(entry);
    currentIntakeReads.set(id, freezeCapacityValue({ id, ...entry })); return id;
  }
  async function completeIntake(requestId: string, nativeIds: readonly string[], signal: AbortSignal, proofScope: 'full' | 'initial' = 'full') {
    const database = withDatabaseAbortSignal(options.database, signal); assert(database.enabled);
    const stored = await database.query(requestSql, [requestId]); assert.equal(stored.length, 1);
    if (proofScope === 'initial') assertCapacityInitialStoredRequest(stored[0], recovery!.initialScope); else assertFullRequest(stored[0]);
    assertDiscovery(stored[0], nativeIds);
    const terminalRevision = Number(object(stored[0].stored_request).revision);
    assert.equal(stored[0].terminal, true); assert(Number.isSafeInteger(terminalRevision) && terminalRevision > 0);
    const proofs = await proveIntakeEndpoints(requestId, nativeIds, signal), receiptRows = new Map(proofs.rows.map(row => [String(object(row.receipt).id), row]));
    const candidates = await database.query(CAPACITY_INTAKE_CANDIDATES_SQL, [requestId]); assert.equal(candidates.length, nativeIds.length);
    for (const row of candidates) { const candidate = object(row.candidate); assert.equal(candidate.stage, 'complete'); assert(nativeIds.includes(String(candidate.external_league_id)));
      for (const field of ['settings_receipt_id','players_receipt_id','managers_receipt_id']) { const proof = receiptRows.get(uuid(candidate[field])); assert(proof, 'original core receipt absent');
        assert.equal(object(proof.content).external_league_id, candidate.external_league_id); assert.equal(object(proof.dispatch).intake_id, requestId); capacityStoredReceiptNormalization(proof); }
      assert(proofs.directories.some(row => object(row.capture).id === candidate.users_capture_id), 'original directory capture absent');
    }
    const identityEndpoint = endpointInventory.find(row => row.resource === 'identity' && new URL(row.url).pathname === '/v1/user/' + stored[0].username); assert(identityEndpoint);
    const initialPlan = proofScope === 'initial' ? recovery!.initialRequests.find(row => row.username === stored[0].username) : undefined;
    if (proofScope === 'initial') { assert(initialPlan); assert.equal(capacityDigest([...initialPlan.nativeLeagueIds].sort()), capacityDigest([...nativeIds].sort())); }
    const expectedEndpoints = initialPlan ? [...initialPlan.endpointIds].sort() : endpointInventory.filter(row => nativeIds.includes(row.scope.nativeLeagueId ?? '')
      || row.id === identityEndpoint.id || row.resource === 'league-list' && row.scope.nativeManagerId === identityEndpoint.scope.nativeManagerId).map(row => row.id).sort();
    const completedEndpoints = [...endpointAcceptances.values()].filter(row => row.requestId === requestId).map(row => row.endpointId).sort();
    assert.equal(capacityDigest(completedEndpoints), capacityDigest(expectedEndpoints), 'full immutable endpoint inventory absent');
    const originalAggregateStatuses: string[] = [], retainedPages: string[] = [], currentReadProofIds: string[] = [];
    const currentRosterProofs = new Map<string, Parameters<typeof capacityWeeklyReportReaderValue>[1]>();
    const store = createLeagueAdministrationStore(database), seen = { periods: new Set<string>(), transactions: new Set<string>(), drafts: new Set<string>() };
    const cursors = { periods: 0 as number | null, transactions: 0 as number | null, drafts: 0 as number | null };
    const expectedPeriods = nativeIds.flatMap(id => (proofScope === 'initial' ? [7] : Array.from({ length: 18 }, (_, i) => i + 1)).map(week => `${id}/${week}`)).sort();
    const draftProofs: ReturnType<typeof assertDraftValue>[] = [];
    const expectedDrafts = proofScope === 'initial' ? [] : endpointInventory.filter(row => nativeIds.includes(row.scope.nativeLeagueId ?? '')
      && ['draft-catalog', 'draft-detail', 'draft-selections', 'draft-trades', 'league-trades'].includes(row.resource)).map(row => {
        const kind = ({ 'draft-catalog': 'catalog', 'draft-detail': 'detail', 'draft-selections': 'selections', 'draft-trades': 'draft', 'league-trades': 'league' } as Record<string, string>)[row.resource];
        return `${row.scope.nativeLeagueId}/${kind}/${row.scope.nativeDraftId ?? '-'}`; }).sort();
    const expectedTransactions = nativeIds.flatMap(id => (proofScope === 'initial' ? [7] : Array.from({ length: 19 }, (_, i) => i)).map(week => `${id}/${week}`)).sort();
    for (let page = 0; page < 20; page++) {
      const pageStart = begin();
      const result = await readPublicSleeperIntake(database, store, requestId, capacityIntakeReadOptions(proofScope, cursors));
      const retainedPage = json(result), digest = capacityDigest(retainedPage);
      if (!intakePages.has(digest)) intakePages.set(digest, freezeCapacityValue(retainedPage));
      intakePageReads.push({ requestId, page: page + 1, digest, span: end(pageStart) }); retainedPages.push(digest);
      const value = object(result); originalAggregateStatuses.push(String(value.status)); assert(['available','partial'].includes(String(value.status))); assert(Array.isArray(value.leagues));
      assert.equal(capacityDigest(value.leagues.map(row => object(row).externalLeagueId).sort()), capacityDigest([...nativeIds].sort()));
      for (const row of value.leagues) {
        const resources = object(object(row).resources);
        const nativeId = String(object(row).externalLeagueId); assert.equal(object(row).collection, 'complete');
        for (const field of ['settings','teamManagers','heldRoster'] as const) {
          const current = capacityCurrentIntakeResource(resources[field]);
          if (page === 0) { const proofId = await proveCurrentCore(requestId, nativeId, field, current, signal); currentReadProofIds.push(proofId);
            if (field === 'heldRoster') currentRosterProofs.set(nativeId, currentIntakeReads.get(proofId)!); }
          if (field === 'heldRoster') assert.equal(capacityDigest(current), capacityDigest(currentRosterProofs.get(nativeId)!.read), 'page roster differs from bound current proof');
        }
        assert.equal(capacityCurrentIntakeResource(resources.directory).status, 'available'); assert.equal(object(resources.managerDirectory).status, 'available');
        assert.equal(object(capacityCurrentIntakeResource(resources.heldRoster).playerLinks).status, 'available');
      }
      for (const [field, expectedKeys] of [['weeklyReports', expectedPeriods], ['brackets', [...nativeIds].sort()]] as const) {
        const entries = proofScope === 'initial' && field === 'weeklyReports' ? [] : value[field]; assert(Array.isArray(entries));
        if (proofScope === 'initial' && field === 'weeklyReports') { assert.equal(value[field], undefined); continue; }
        assert.equal(capacityDigest(entries.map(input => { const entry = object(input), resource = object(entry.resource); assert.equal(resource.status, 'available');
          if (field === 'weeklyReports') {
            const original = receiptRows.get(uuid(resource.reportReceiptId)); assert(original);
            const roster = currentRosterProofs.get(String(entry.externalLeagueId)); assert(roster);
            const expected = capacityWeeklyReportReaderValue(capacityStoredReceiptNormalization(original), roster);
            assert.equal(capacityDigest(resource.value), capacityDigest(expected));
          } else for (const family of ['winners_bracket','losers_bracket']) {
            const read = object(resource[family]); assert.equal(read.status, 'available'); const original = receiptRows.get(uuid(read.bracketReceiptId)); assert(original);
            const projected = projectPlayoffBracket(capacityStoredReceiptNormalization(original)); assert.equal(projected.status, 'accepted'); assert.equal(capacityDigest(read.value), capacityDigest(projected.value));
          }
          return field === 'brackets' ? entry.externalLeagueId : `${entry.externalLeagueId}/${entry.nativeWeek}`; }).sort()), capacityDigest(expectedKeys));
      }
      for (const [kind, field, inventoryField] of [['periods', 'exactPeriods', 'periodInventory'], ['transactions', 'transactions', 'transactionHistory'], ['drafts', 'drafts', 'draftPicks']] as const) {
        if (cursors[kind] === null) continue;
        const inventory = proofScope === 'full' ? object(value[inventoryField]) : null;
        if (inventory) assert.equal(inventory.collection, 'complete'); else assert.equal(value[inventoryField], undefined);
        const entries = proofScope === 'initial' && kind === 'drafts' ? [] : value[field]; assert(Array.isArray(entries));
        if (proofScope === 'initial' && kind === 'drafts') assert.equal(value[field], undefined);
        for (const input of entries) {
          const entry = object(input); assert.equal(entry.collection, 'complete');
          if (kind === 'periods') {
            assert.equal(capacityCurrentIntakeResource(entry.resource).status, 'available');
            const exact = object(entry.exactMatchupValues); assert.equal(exact.status, 'available'); assert.equal(exact.selection, 'receipt');
            const original = receiptRows.get(uuid(exact.matchupsReceiptId)); assert(original, 'original matchup receipt absent');
            const projected = projectExactMatchupValues(capacityStoredReceiptNormalization(original), object(exact.value).teams as Parameters<typeof projectExactMatchupValues>[1]);
            assert.equal(capacityDigest(exact.value), capacityDigest(projected)); assert.equal(object(entry.periodContext).status, 'available');
          } else assert.equal(object(entry.resource).status, 'available');
          if (kind === 'transactions') { const capture = object(object(entry.resource).capture), original = receiptRows.get(uuid(object(capture.receipt).id)); assert(original);
            assert.equal(capacityDigest(capture.normalizedValue), capacityDigest(capacityStoredReceiptNormalization(original).value)); }
          if (kind === 'drafts') draftProofs.push(assertDraftValue(entry));
          const key = kind === 'drafts' ? draftKey(entry) : `${entry.externalLeagueId}/${entry.nativeWeek}`;
          assert(!seen[kind].has(key), 'duplicate detailed page resource'); seen[kind].add(key);
        }
        const next = inventory ? object(inventory.page).nextAfterOrdinal : null;
        assert(next === null || Number.isSafeInteger(next) && Number(next) > Number(cursors[kind]), 'page did not advance');
        cursors[kind] = next as number | null;
        if (kind === 'drafts' && next === null && inventory) assert.equal(seen.drafts.size, Number(object(inventory.summary).materializedResources));
      }
      if (Object.values(cursors).every(value => value === null)) {
        assert.equal(capacityDigest([...seen.periods].sort()), capacityDigest(expectedPeriods));
        assert.equal(capacityDigest([...seen.transactions].sort()), capacityDigest(expectedTransactions));
        assert.equal(capacityDigest([...seen.drafts].sort()), capacityDigest(expectedDrafts), 'missing or wrong frozen draft inventory');
        return { requestId, terminal: stored[0].terminal === true, terminalRevision, nativeIds, detailedPeriods: seen.periods.size, detailedTransactions: seen.transactions.size, detailedDrafts: seen.drafts.size, pages: page + 1, draftProofs,
          coverage: proofScope === 'full' ? 'complete-materialized-inventory' : 'complete-materialized-initial-scope', parity: 'immutable-intake-receipts-and-current-readers', originalAggregateStatuses, currentReadProofIds,
          immutableProofIds: [...new Set([...endpointProofs.values()].filter(row => row.requestId === requestId).map(row => row.proofId))], completedEndpointIds: completedEndpoints, retainedPages };
      }
    }
    throw new Error('full intake page bound exceeded');
  }
  async function observeIntake(cohort: Cohort) {
    const requestId = intakeIds.get(cohort), entry = intakes.get(cohort); assert(requestId && entry, 'missing observed submission');
    if (entry.completeAt !== null) return freezeCapacityValue({ ...entry });
    const start = begin(), required = manifest.plan.leagues.filter(item => item.cohort === cohort).map(row => league(row.key).nativeLeagueId).sort();
    const complete = await bounded(`intake/${cohort}`, signal => completeIntake(requestId, required, signal), start.startedAt + manifest.plan.sampleTimeoutMs);
    const span = end(start); operations.push({ operation: `intake/${cohort}`, span, outcome: json(complete) });
    if (complete && entry.completeAt === null) intakes.set(cohort, { ...entry, completeAt: span.endedAt, coverage: 'complete' });
    return freezeCapacityValue({ ...intakes.get(cohort)! });
  }
  async function observeOutage(stage: 'before' | 'during' | 'recovered') {
    assert(manifest.lane.kind === 'outage'); const lane = manifest.lane;
    await Promise.all(manifest.plan.leagues.flatMap(row => groups(row.key)).map(async ({ key, resource }) => {
      const operation = `outage/${stage}/${key}/${resource}`, start = begin();
      const rows = await current(key, resource, operation);
      for (const row of rows ?? []) {
        if (outageReads[stage].has(row.pairId)) continue;
        let qualifies = false;
        if (stage === 'recovered' && dependencyRestoredAt !== null && runnerRestoredAt !== null) {
          const restoredAt = Math.max(dependencyRestoredAt, runnerRestoredAt);
          qualifies = row.read.at >= restoredAt && row.origin.observedAt >= restoredAt
            && row.read.at - row.origin.observedAt <= 300_000
            && capacityDigest(row.reader) === capacityDigest(expected(row.pairId, row.read.version).reader);
        } else if (stage !== 'recovered') {
          const frozen = lane.lastGood.find(item => item.pairId === row.pairId)!;
          const inWindow = stage === 'before' ? row.read.at < startedAt + lane.startOffsetMs
            : outageStartedAt !== null && row.read.at >= outageStartedAt
              && (dependencyRestoredAt === null || row.read.at < dependencyRestoredAt);
          qualifies = inWindow && row.read.payloadSha256 === frozen.payloadSha256
            && capacityDigest(row.reader) === capacityDigest(frozen.reader);
        }
        if (qualifies) outageReads[stage].set(row.pairId, row);
      }
      operations.push({ operation, span: end(start), outcome: json({ observed: rows?.map(row => ({ pairId: row.pairId,
        version: row.read.version, sealed: outageReads[stage].has(row.pairId) })) ?? [] }) });
    }));
  }
  function observeOutageStart() {
    assert.equal(manifest.lane.kind, 'outage'); assert.equal(outageStartedAt, null);
    outageStartedAt = capacityTime(clock.wallNow());
  }
  function observeRestoration(kind: 'dependency' | 'runner') {
    assert.equal(manifest.lane.kind, 'outage');
    if (kind === 'dependency') { assert.equal(dependencyRestoredAt, null); dependencyRestoredAt = capacityTime(clock.wallNow()); }
    else { assert.equal(runnerRestoredAt, null); runnerRestoredAt = capacityTime(clock.wallNow()); }
  }
  async function observeBacklog(id: string, requestId: string) {
    assert(manifest.lane.kind === 'outage'); const task = manifest.lane.backlog.find(row => row.id === id); assert(task);
    const start = begin(), operation = `backlog/${id}`;
    const priorId = backlogRequests.get(id); assert(priorId === undefined || priorId === requestId, 'backlog request changed');
    backlogRequests.set(id, uuid(requestId));
    if (backlog.get(id)?.read) return;
    const complete = await bounded(operation, async signal => {
      const stored = await options.database.query(requestSql, [requestId], { signal }); assert.equal(stored.length, 1);
      const queuedAt = timestamp(stored[0].created_at), prior = backlog.get(id);
      if (prior) assert.equal(queuedAt, prior.queuedAt, 'queued timestamp changed');
      else backlog.set(id, { id, queuedAt, read: null, reader: null });
      assert.equal(stored[0].resource_occurrence_id, null); assert.equal(stored[0].submission_capacity, null);
      if (stored[0].terminal !== true || dependencyRestoredAt === null || runnerRestoredAt === null) return false;
      const restoredAt = Math.max(dependencyRestoredAt, runnerRestoredAt);
      const pair = manifest.plan.pairs.find(row => row.id === task.pairId)!;
      const rows = await readGroup(pair.leagueKey, resourceFor(pair.family), signal); remember(rows);
      const result = rows.find(row => row.pairId === pair.id)!;
      if (queuedAt > restoredAt || result.read.at < Math.max(queuedAt, restoredAt)
        || capacityDigest(result.reader) !== capacityDigest(task.reader)
        || object(result.lineage.dispatch.work).requestId !== requestId) return false;
      const database = withDatabaseAbortSignal(options.database, signal); assert(database.enabled);
      const reader = await readPublicSleeperIntake(database, createLeagueAdministrationStore(database), requestId);
      if (reader.status !== 'available' || !('leagues' in reader)
        || !reader.leagues.some(row => row.externalLeagueId === league(pair.leagueKey).nativeLeagueId)) return false;
      backlog.set(id, { id, queuedAt, read: result.read, reader: result.reader }); return true;
    }, start.startedAt + manifest.plan.sampleTimeoutMs);
    operations.push({ operation, span: end(start), outcome: json({ completed: complete === true }) });
  }

  function retainEndpoint(proof: RecoveryEndpointAcceptance, start: ReturnType<typeof begin>, record: unknown) {
    const endpoint = endpointInventory.find(row => row.id === proof.endpointId); assert(endpoint);
    const recoveryEndpoint = (daily?.endpoints ?? recovery?.endpoints)?.find(row => row.id === proof.endpointId);
    const versions = recoveryEndpoint ? [recoveryEndpoint.before, recoveryEndpoint.after] : endpoint.versions;
    assert(versions.some(row => row.sha256 === proof.payloadSha256 && row.version === proof.version), 'unbound immutable endpoint value');
    assert(proof.sourceObservedAt <= proof.readAt);
    if (proof.acceptedAt !== null) assert(proof.acceptedAt >= proof.sourceObservedAt && proof.acceptedAt <= proof.readAt);
    const key = `${proof.requestId ?? 'shared'}/${proof.endpointId}${daily && proof.requestId === null ? '/' + proof.proofId : ''}`;
    const recordKey = `${key}/${proof.proofId}`;
    if (!endpointProofs.has(recordKey)) endpointProofs.set(recordKey, freezeCapacityValue({ proofId: proof.proofId, kind: proof.kind,
      endpointId: proof.endpointId, requestId: proof.requestId, attemptId: proof.attemptId, readSpan: end(start), record: json(record) }));
    if (!endpointAcceptances.has(key)) endpointAcceptances.set(key, freezeCapacityValue(proof));
  }
  function nativeReceiptPayload(content: Record<string, unknown>) {
    const payload = object(content.payload);
    if (content.family !== 'drafts') return content.payload;
    return payload.kind === 'catalog' ? payload.catalog : payload.kind === 'detail' ? payload.draft
      : payload.kind === 'selections' ? payload.picks : payload.tradedPicks;
  }
  function endpointResponse(content: Record<string, unknown>, startAt: number, endAt: number) {
    const family = String(content.family), nativePayload = family === 'drafts' ? nativeReceiptPayload(content) : content.payload;
    const draft = family === 'drafts' ? object(content.payload) : null;
    const resource = draft ? ({ catalog: 'draft-catalog', detail: 'draft-detail', selections: 'draft-selections', draft: 'draft-trades', league: 'league-trades' } as Record<string,string>)[String(draft.kind)]
      : family.replaceAll('_', '-');
    const candidates = [...responseIndex.values()].filter(response => response.resource === resource
      && response.nativeLeagueId === content.external_league_id && startAt <= response.requestStartedAt && response.responseCompletedAt <= endAt
      && (['matchups','transactions','weekly_report'].includes(family) ? response.nativeWeek === Number(content.week) : true)
      && (!draft?.externalDraftId || endpointInventory.find(item => item.id === response.endpointId)?.scope.nativeDraftId === draft.externalDraftId)
      && capacityDigest(JSON.parse(response.rawUtf8)) === capacityDigest(nativePayload));
    assert.equal(candidates.length, 1, 'endpoint receipt needs one unambiguous source response');
    const response = candidates[0], attempt = attemptIndex.get(response.attemptId), endpoint = endpointInventory.find(row => row.id === response.endpointId);
    assert(attempt?.outcome === 'success' && endpoint && attempt.origin + attempt.path === endpoint.url && attempt.method === endpoint.method);
    assert.equal(response.rawSha256, attempt.responseSha256); return response;
  }
  function assertEndpointInvocation(response: CapacitySourceResponse, startAt: number, endAt: number, fence: Record<string, unknown>) {
    const attempt = attemptIndex.get(response.attemptId)!; assert.equal(attempt.owner, 'data-refresh');
    assert.equal(invocations.filter(row => row.owner === attempt.owner && row.span.startedAt <= startAt
      && endAt <= (row.span.endedAt ?? clock.wallNow()) && timestamp(fence.deadlineAt) === row.span.startedAt + 20_000).length, 1);
  }
  async function proveIntakeEndpoints(requestId: string, nativeIds: readonly string[], signal: AbortSignal) {
    const start = begin(), queries: JsonValue[] = [];
    const query: DatabaseClient['query'] = (async (sql: string, params: readonly unknown[] = [], queryOptions?: Parameters<DatabaseClient['query']>[2]) => {
      const at = begin(), rows = await options.database.query(sql, params, queryOptions);
      queries.push(json({ sql, params, rows, span: end(at) })); return rows;
    }) as DatabaseClient['query'];
      journal(); const rows = await query(CAPACITY_ENDPOINT_RECEIPTS_SQL, [requestId], { signal }); assert(rows.length <= 2500);
      for (const row of rows) {
        const receipt = object(row.receipt), acceptance = object(row.acceptance), attempt = object(row.attempt), content = object(row.content), dispatch = object(row.dispatch);
        const provenance = object(receipt.provenance), captureStart = timestamp(provenance.requestStartedAt), captureEnd = timestamp(provenance.requestCompletedAt);

        assert.equal(typeof content.accepted, 'boolean'); assert.equal(receipt.attempt_id, attempt.id); assert.equal(receipt.content_id, content.id);
        assert.equal(acceptance.receipt_id, receipt.id); assert.equal(acceptance.scope_id, attempt.scope_id);
        assert.equal(provenance.origin, 'network'); assert.equal(timestamp(provenance.sourceObservedAt), captureEnd);
        const witness = parsePublicCaptureWitness(provenance.acquisition);
        assert.equal(witness.work.requestId, requestId); assert.equal(capacityDigest(witness.work), capacityDigest(dispatch.work));
        assert.equal(capacityDigest(witness.fence), capacityDigest(attempt.write_fence)); assert.equal(witness.fence.workerId, dispatch.worker_id);
        assert.equal(witness.fence.generation, Number(dispatch.generation)); assert.equal(witness.dispatchNonce, dispatch.capture_nonce);
        assert(Object.values(witness.attempts).some(value => value?.id === attempt.id && value.nonce === attempt.capture_nonce));
        assert.equal(capacityDigest(witness.mapping), capacityDigest(attempt.source_mapping));
        const mapping = object(attempt.source_mapping); assert.equal(acceptance.source_mapping_revision_id, mapping.revisionId);
        assert.equal(content.league_season_id, mapping.leagueSeasonId); assert.equal(object(mapping.scope).externalLeagueId, content.external_league_id);
        const response = endpointResponse(content, captureStart, captureEnd); assertEndpointInvocation(response, captureStart, captureEnd, object(witness.fence));
        capacityStoredReceiptNormalization(row);
        retainEndpoint({ endpointId: response.endpointId, requestId, attemptId: response.attemptId, proofId: uuid(receipt.id), kind: 'resource-receipt',
          sourceObservedAt: captureEnd, acceptedAt: timestamp(acceptance.accepted_at), readAt: capacityTime(clock.wallNow()),
          payloadSha256: response.rawSha256, version: response.version }, start, row);
      }
      const directories = await query(CAPACITY_ENDPOINT_DIRECTORIES_SQL, [requestId], { signal });
      for (const row of directories) {
        const capture = object(row.capture), content = object(row.content), dispatch = object(row.dispatch), outcome = object(row.outcome);
        const captureStart = timestamp(capture.request_started_at), captureEnd = timestamp(capture.request_completed_at);

        assert.equal(capture.intake_id, requestId); assert.equal(capture.content_id, content.id); assert.equal(content.family, 'users'); assert.equal(content.accepted, true);
        const witness = parsePublicCaptureWitness(outcome.capture_acquisition); assert.equal(outcome.outcome, 'checkpoint-committed');
        assert.equal(witness.work.requestId, requestId); assert.equal(witness.work.kind, 'users'); assert.equal(capacityDigest(witness.work), capacityDigest(dispatch.work));
        assert.equal(witness.fence.workerId, dispatch.worker_id); assert.equal(witness.fence.generation, Number(dispatch.generation)); assert.equal(witness.dispatchNonce, dispatch.capture_nonce);
        assert.equal(capacityDigest(witness.mapping), capacityDigest(capture.source_mapping)); assert.equal(timestamp(capture.source_observed_at), captureEnd);
        const response = endpointResponse(content, captureStart, captureEnd); assertEndpointInvocation(response, captureStart, captureEnd, object(witness.fence));
        retainEndpoint({ endpointId: response.endpointId, requestId, attemptId: response.attemptId, proofId: uuid(capture.id), kind: 'resource-receipt',
          sourceObservedAt: captureEnd, acceptedAt: timestamp(capture.recorded_at), readAt: capacityTime(clock.wallNow()), payloadSha256: response.rawSha256,
          version: response.version }, start, row);
      }
      const requests = await query(requestSql, [requestId], { signal }); assert.equal(requests.length, 1);
      assertDiscovery(requests[0], nativeIds);
      operations.push({ operation: 'intake-endpoints/' + requestId, span: end(start), outcome: json({ retained: [...endpointAcceptances.values()].filter(row => row.requestId === requestId).length }) });
      return { rows, directories, request: requests[0], span: end(start), queries };
  }
  async function observeRecoveryEndpoints(requestId: string) {
    assert(recovery); const submission = recovery.submissions.find(row => row.input.id === requestId); assert(submission);
    const start = begin(); await bounded('recovery-endpoints/' + requestId,
      signal => proveIntakeEndpoints(requestId, submission.nativeLeagueIds, signal), start.startedAt + manifest.plan.sampleTimeoutMs);
  }
  async function observeRecoveryPlayerDirectory() {
    assert(recovery); const start = begin(); await bounded('recovery-player-directory', async signal => {
      journal(); const store = createLeagueAdministrationStore(withDatabaseAbortSignal(options.database, signal));
      const read = await store.readAcceptedPlayerDirectory({ limit: 1 }); assert.equal(read.status, 'available'); if (read.status !== 'available') return false;
      const rows = await options.database.query(CAPACITY_PLAYER_DIRECTORY_SQL, [read.version.versionId], { signal }); assert.equal(rows.length, 1);
      const row = rows[0], version = object(row.version), capture = object(row.capture), attempt = object(row.attempt), content = object(row.content);
      assert.equal(version.capture_id, capture.id); assert.equal(capture.attempt_id, attempt.id); assert.equal(content.id, capture.content_id);
      assert.equal(read.version.receiptId, capture.id); assert.equal(read.version.sourceRevision, content.source_revision); assert.equal(capture.status, 'complete');
      const captureStart = timestamp(capture.request_started_at), captureEnd = timestamp(capture.request_completed_at);
      const responses = [...responseIndex.values()].filter(response => response.resource === 'player-catalog' && captureStart <= response.requestStartedAt
        && response.responseCompletedAt <= captureEnd && response.rawUtf8 === content.raw_json); assert.equal(responses.length, 1);
      const response = responses[0]; assertEndpointInvocation(response, captureStart, captureEnd, object(attempt.write_fence));
      assert.equal(timestamp(capture.source_observed_at), captureEnd);
      retainEndpoint({ endpointId: response.endpointId, requestId: null, attemptId: response.attemptId, proofId: uuid(capture.id), kind: 'player-directory-receipt',
        sourceObservedAt: captureEnd, acceptedAt: timestamp(version.accepted_at), readAt: capacityTime(clock.wallNow()), payloadSha256: response.rawSha256,
        version: response.version }, start, { ...row, read }); return true;
    }, start.startedAt + manifest.plan.sampleTimeoutMs);
    operations.push({ operation: 'recovery-player-directory', span: end(start), outcome: json({ retained: [...endpointAcceptances.values()].some(row => row.kind === 'player-directory-receipt') }) });
  }

  async function observeRecoveryQueue(phase: 'after-submissions' | 'restored' | 'final') {
    assert(recovery); assert(!queueSnapshots.some(row => row.phase === phase), 'queue snapshot cannot be replaced'); const start = begin();
    const result = await bounded('recovery-queue/' + phase, async signal => {
      const rows = await options.database.query(`/* cp26:read-observer-recovery-queue */ SELECT
        (SELECT coalesce(jsonb_agg(to_jsonb(request) ORDER BY created_at,id),'[]'::jsonb) FROM public.public_data_intakes request) AS requests,
        (SELECT coalesce(jsonb_agg(to_jsonb(refresh_cycle) ORDER BY target_id,cycle),'[]'::jsonb) FROM public.public_data_refresh_cycles refresh_cycle) AS cycles,
        (SELECT coalesce(jsonb_agg(jsonb_build_object('target',to_jsonb(target),'configuration',to_jsonb(configuration)) ORDER BY target.id),'[]'::jsonb)
          FROM public.public_data_refresh_targets target JOIN public.public_data_refresh_configurations configuration
          ON configuration.target_id=target.id AND configuration.revision=target.configuration_revision) AS configurations`, [], { signal });
      assert.equal(rows.length, 1); const row = rows[0]; assert(Array.isArray(row.requests) && Array.isArray(row.cycles) && Array.isArray(row.configurations));
      return { phase, at: capacityTime(clock.wallNow()), requests: json(row.requests) as JsonValue[], cycles: json(row.cycles) as JsonValue[], configurations: json(row.configurations) as JsonValue[] };
    }, start.startedAt + manifest.plan.sampleTimeoutMs);
    if (result) queueSnapshots.push(freezeCapacityValue(result));
    operations.push({ operation: 'recovery-queue/' + phase, span: end(start), outcome: json({ complete: result !== null }) });
  }
  async function observeRecoveryQueuedIntake(requestId: string) {
    assert(recovery); if (queueCompleted.has(requestId)) return queueCompleted.get(requestId)!;
    const start = begin(), proof = await bounded('recovery-queued-intake/' + requestId, async signal => {
      const rows = await options.database.query(requestSql, [uuid(requestId)], { signal }); assert.equal(rows.length, 1);
      const declared = recovery.submissions.find(row => row.username === rows[0].username
        || endpointInventory.some(endpoint => endpoint.id === 'identity-native:' + row.id.slice(7)
          && endpoint.scope.nativeManagerId === rows[0].username)); assert(declared);
      const initial = [...recoverySubmissions.values()].some(row => row.id.startsWith('initial-') && row.requestId === requestId);
      return completeIntake(requestId, declared.nativeLeagueIds, signal, initial ? 'initial' : 'full');
    }, start.startedAt + manifest.plan.sampleTimeoutMs);
    if (proof) queueCompleted.set(requestId, freezeCapacityValue({ requestId, completedAt: capacityTime(clock.wallNow()), completeProof: json(proof) }));
    operations.push({ operation: 'recovery-queued-intake/' + requestId, span: end(start), outcome: json(proof) });
    return queueCompleted.get(requestId) ?? null;
  }
  async function observeRecoverySamples() {
    assert(recovery); const now = capacityTime(clock.wallNow());
    await Promise.all(manifest.plan.leagues.flatMap(row => groups(row.key)).flatMap(({ key, resource }) =>
      Array.from({ length: 121 }, (_, ordinal) => ({ key, resource, ordinal, scheduledAt: startedAt + recovery.clock.outageStartMs + ordinal * 60_000 }))
        .filter(row => row.scheduledAt <= now && familiesFor(resource).some(family => !recoverySamples.has(`${key}/${family}/recovery-sample-${row.ordinal}`))))
      .map(async ({ key, resource, ordinal, scheduledAt }) => {
        const at = capacityTime(clock.wallNow()), token = `recovery-sample/${key}/${resource}/${ordinal}`;
        const slots = familiesFor(resource).map(family => ({ pairId: `${key}/${family}`, id: `${key}/${family}/recovery-sample-${ordinal}` }));
        if (slots.every(slot => recoverySamples.has(slot.id))) return;
        slots.forEach(slot => recoverySamples.set(slot.id, { id: slot.id, at, status: 'unavailable', read: null }));
        if (at > scheduledAt + 1000) { failures.push({ operation: token, at, reason: 'late' }); return; }
        const rows = await current(key, resource, token, scheduledAt + 60_000), failure = failures.findLast(row => row.operation === token);
        for (const slot of slots) { const row = rows?.find(row => row.pairId === slot.pairId);
          recoverySamples.set(slot.id, { id: slot.id, at, status: row ? 'available' : failure?.reason === 'timeout' ? 'timeout' : 'unavailable', read: row?.read ?? null }); }
      }));
  }
  async function observeRecoveryPrimaryCatalog() {
    assert(recovery); const start = begin(); await bounded('recovery-primary-catalog', async () => {
      const before = journal().requests.attempts.length;
      const [{ getFantasyPlayerCatalog }, { projectPlayerCatalog }] = await Promise.all([import('../lib/sleeper'), import('../lib/sleeper-player-catalog')]);
      const read = await getFantasyPlayerCatalog(); assert.equal(journal().requests.attempts.length, before, 'catalog observer attempted provider HTTP');
      assert.equal(read.complete, true); assert.equal(read.sourceSlices?.length, 6);
      for (const endpoint of recovery!.endpoints.filter(row => row.resource === 'player-position-catalog')) {
        const slice: import('../lib/sleeper-player-catalog').PlayerCatalogSourceSlice | undefined = read.sourceSlices!.find(row => row.scope === endpoint.scope.nativePosition); assert(slice?.status === 'available' && slice.complete && slice.observedAt);
        const projected = projectPlayerCatalog(JSON.parse(endpoint.before.utf8)); assert.equal(slice.sourceRevision, projected.sourceRevision);
        assert.equal(capacityDigest([...slice.playerIds].sort()), capacityDigest(Object.keys(projected.catalog).sort()));
        const observedAt = timestamp(slice.observedAt), attempts = [...attemptIndex.values()].filter(row => row.owner === 'primary-projection'
          && row.method === endpoint.method && row.origin + row.path === endpoint.url && row.outcome === 'success'
          && row.responseSha256 === endpoint.before.sha256 && row.endedAt <= observedAt
          && invocations.some(invocation => invocation.span.startedAt <= row.at && observedAt <= (invocation.span.endedAt ?? clock.wallNow())));
        assert.equal(attempts.length, 1, 'ambiguous positional cache capture'); const attempt = attempts[0];
        retainEndpoint({ endpointId: endpoint.id, requestId: null, attemptId: attempt.id, proofId: capacityDigest({ endpoint: endpoint.id, slice }),
          kind: 'primary-catalog-cache', sourceObservedAt: observedAt, acceptedAt: null, readAt: capacityTime(clock.wallNow()),
          payloadSha256: endpoint.before.sha256, version: endpoint.before.version }, start, { read, slice,
          boundary: 'Actual maintained cached reader returned exact native source revision without provider HTTP; no SQL receipt is claimed.' });
      }
      return true;
    }, start.startedAt + manifest.plan.sampleTimeoutMs);
    operations.push({ operation: 'recovery-primary-catalog', span: end(start), outcome: json({ retained: [...endpointAcceptances.values()].filter(row => row.kind === 'primary-catalog-cache').length }) });
  }

  /** Separate recovery observations use the same actual receipt binding, never the healthy event denominator. */
  async function observeRecoverySubmission(id: string, requestId: string, run: () => Promise<PublicIntakeSubmissionReceipt>) {
    assert(recovery); const declared = recovery.submissions.find(row => row.id === id);
    const initial = id.startsWith('initial-') ? recovery.submissions.find(row => row.id === 'replay-' + id.slice(8)) : undefined;
    const selected = declared ?? initial; assert(selected); assert(!recoverySubmissions.has(id), 'recovery submission cannot be retried');
    const start = begin(), plannedAt = declared ? startedAt + declared.offsetMs : start.startedAt;
    const entry = { id, requestId: uuid(requestId), plannedAt, dispatchedAt: start.startedAt, receiptAt: null as number | null,
      receipt: null as PublicIntakeSubmissionReceipt | null, completedAt: null as number | null, completeProof: null as JsonValue };
    recoverySubmissions.set(id, entry);
    try {
      const receipt = await run(); assert.equal(receipt.requestId, requestId); assert(['retained', 'capacity'].includes(receipt.status));
      const receiptAt = capacityTime(clock.wallNow());
      const rows = await options.database.query(requestSql, [requestId]); assert.equal(rows.length, 1);
      if (initial) assertCapacityInitialStoredRequest(rows[0], recovery!.initialScope); else assertFullRequest(rows[0]);
      assert.equal(rows[0].username, selected.username); assert(timestamp(rows[0].created_at) >= start.startedAt);
      recoverySubmissions.set(id, { ...entry, receiptAt, receipt });
    } catch { failures.push({ operation: 'recovery-submit/' + id, at: capacityTime(clock.wallNow()), reason: 'unavailable' }); }
    operations.push({ operation: 'recovery-submit/' + id, span: end(start), outcome: json(recoverySubmissions.get(id)) });
  }
  async function observeRecoveryHeads(stage: keyof typeof recoveryHeads) {
    assert(recovery); await Promise.all(manifest.plan.leagues.flatMap(row => groups(row.key)).map(async ({ key, resource }) => {
      const pairIds = familiesFor(resource).map(family => key + '/' + family);
      if (pairIds.every(pair => recoveryHeads[stage].has(pair))) return;
      const operation = 'recovery-' + stage + '/' + key + '/' + resource, start = begin();
      const read = await current(key, resource, operation);
      for (const row of read ?? []) {
        const binding = recovery.pairs.find(pair => pair.pairId === row.pairId)!;
        const expectedReader = stage === 'recovered' ? binding.expectedReader : binding.initialReader;
        let qualifies = capacityDigest(row.reader) === capacityDigest(expectedReader);
        if (stage === 'initial') {
          const cohort = manifest.plan.leagues.find(league => league.key === key)!.cohort;
          const submission = recoverySubmissions.get('initial-' + cohort), work = row.lineage.dispatch.work as Record<string, unknown>;
          qualifies &&= Boolean(submission?.receipt && work.requestId === submission.requestId && row.read.at <= startedAt + recovery.clock.acceptanceDeadlineMs);
        } else if (stage === 'before') qualifies &&= row.read.at < startedAt + recovery.clock.outageStartMs;
        else if (stage === 'during') qualifies &&= row.read.at >= startedAt + recovery.clock.outageStartMs && row.read.at < startedAt + recovery.clock.outageEndMs;
        else qualifies &&= row.origin.observedAt >= startedAt + recovery.clock.outageEndMs && row.read.at - row.origin.observedAt <= 300_000;
        if (!qualifies) continue;
        if (stage === 'recovered') {
          const initial = recoveryHeads.initial.get(row.pairId); if (!initial) continue;
          const retained = await bounded(operation + '/history', signal => readGroup(key, resource, signal, initial.lineage), start.startedAt + manifest.plan.sampleTimeoutMs);
          if (!retained) continue; remember(retained);
          const history = retained.find(value => value.pairId === row.pairId); assert(history);
          const expectedHistory = binding.retainedHistory.find(value => value.version === binding.before.version); assert(expectedHistory);
          if (capacityDigest(history.reader) !== capacityDigest(expectedHistory)) continue;
          recoveryHistory.set(row.pairId, [history.reader]);
        }
        recoveryHeads[stage].set(row.pairId, row);
        if (stage === 'initial') anchors.set(row.pairId, row.read.at);
      }
      operations.push({ operation, span: end(start), outcome: json({ sealed: pairIds.filter(pair => recoveryHeads[stage].has(pair)) }) });
    }));
  }
  async function observeRecoveryIntake(id: string) {
    assert(recovery); const declared = recovery.submissions.find(row => row.id === id), entry = recoverySubmissions.get(id); assert(declared && entry);
    if (entry.completedAt !== null) return freezeCapacityValue({ ...entry });
    const start = begin(), proof = await bounded('recovery-intake/' + id,
      signal => completeIntake(entry.requestId, declared.nativeLeagueIds, signal), start.startedAt + manifest.plan.sampleTimeoutMs);
    const span = end(start); if (proof) recoverySubmissions.set(id, { ...entry, completedAt: span.endedAt, completeProof: json(proof) });
    operations.push({ operation: 'recovery-intake/' + id, span, outcome: json(proof) });
    return freezeCapacityValue({ ...recoverySubmissions.get(id)! });
  }
  async function observeDailyAuxiliarySubmission(label: 'a' | 'b', requestId: string, submit: () => Promise<PublicIntakeSubmissionReceipt>) {
    assert(daily && !dailyWindowStarted && !auxiliarySubmissions.has(label)); uuid(requestId);
    if (label === 'a') {
      assert.equal(auxiliarySubmissions.size, 0); const at = begin(), rows = await options.database.query(CAPACITY_DAILY_EMPTY_SQL, []);
      assert.equal(rows.length, 1); assert.deepEqual(rows[0], { requests: 0, dispatches: 0, targets: 0, cycles: 0, catalog_attempts: 0 });
      dailyInitialState = freezeCapacityValue(json({ sql: CAPACITY_DAILY_EMPTY_SQL, params: [], rows, span: end(at) }));
    } else assert(dailyInitialState !== null);
    const start = begin(), receipt = await submit(), span = end(start);
    operations.push({ operation: 'daily-auxiliary-submission/' + label, span, outcome: json(receipt) });
    assert.equal(receipt.status, 'retained'); assert.equal(receipt.requestId, requestId);
    assert(span.endedAt - span.startedAt <= 2000);
    auxiliarySubmissions.set(label, { label, requestId, submittedAt: span.startedAt, receiptAt: span.endedAt, receipt: json(receipt) });
  }
  async function observeDailyAuxiliaryIntake(label: 'a' | 'b'): Promise<DailyAuxiliaryRead | null> {
    assert(daily && !dailyWindowStarted); const submission = auxiliarySubmissions.get(label); assert(submission);
    const planned = daily.auxiliary.users.find(row => row.label === label)!, requestId = submission.requestId, start = begin();
    return bounded('daily-auxiliary-intake/' + label, async signal => {
      const queries: JsonValue[] = [];
      const database: DatabaseClient = { enabled: true, query: (async (sql: string, params: readonly unknown[] = [], queryOptions?: Parameters<DatabaseClient['query']>[2]) => {
        const queryStart = begin(), rows = await options.database.query(sql, params, { ...queryOptions, signal });
        queries.push(json({ sql, params, rows, span: end(queryStart) })); return rows;
      }) as DatabaseClient['query'] };
      const requestRows = await database.query(requestSql, [requestId]); assert.equal(requestRows.length, 1);
      const request = requestRows[0], stored = object(request.stored_request);
      assertCapacityAuxiliaryScope(stored, planned.username, label === 'a');
      const original = await proveIntakeEndpoints(requestId, planned.nativeLeagueIds, signal);
      const candidates = await database.query(CAPACITY_INTAKE_CANDIDATES_SQL, [requestId]);
      assert.equal(candidates.length, planned.nativeLeagueIds.length);
      assert.deepEqual(candidates.map(row => String(object(row.candidate).external_league_id)).sort(), [...planned.nativeLeagueIds].sort());
      for (const row of candidates) {
        const candidate = object(row.candidate), admitted: boolean = candidate.external_league_id === daily.auxiliary.admittedNativeLeagueId;
        assert.equal(candidate.stage, admitted ? 'complete' : 'capacity');
        if (!admitted) assert.equal(candidate.league_season_id, null);
      }
      const store = createLeagueAdministrationStore(database), mapping = await store.readSourceMapping(daily.auxiliary.admittedNativeLeagueId); assert(mapping);
      const read = await readPublicSleeperIntake(database, store, requestId,
        capacityAuxiliaryReadOptions(label));
      const value = object(read), additionalPages: JsonValue[] = [];
      if (label === 'a') {
        let page: Record<string, unknown> = value, cursor = 0;
        for (let ordinal = 1; ; ordinal++) {
          const next = object(object(page.draftPicks).page).nextAfterOrdinal;
          if (next === null) break;
          assert(ordinal < 3 && Number.isSafeInteger(next) && Number(next) > cursor, 'auxiliary draft page did not advance'); cursor = Number(next);
          const subsequent = await readPublicSleeperIntake(database, store, requestId, capacityAuxiliaryReadOptions(label, cursor));
          page = object(subsequent); additionalPages.push(json(subsequent));
        }
      }
      assert(['partial','available'].includes(String(value.status))); assert(Array.isArray(value.leagues));
      const admitted = value.leagues.map(object).filter(row => row.externalLeagueId === daily.auxiliary.admittedNativeLeagueId); assert.equal(admitted.length, 1);
      assert.equal(admitted[0].collection, 'complete'); const resources = object(admitted[0].resources), currentReadProofIds: string[] = [];
      for (const kind of ['settings','teamManagers','heldRoster'] as const) currentReadProofIds.push(await proveCurrentCore(requestId,
        daily.auxiliary.admittedNativeLeagueId, kind, capacityCurrentIntakeResource(resources[kind]), signal));
      assertCapacityAuxiliaryTeams(daily.auxiliary.nativeRosterIds, capacityCurrentIntakeResource(resources.heldRoster));
      const managers = capacityCurrentIntakeResource(resources.teamManagers); assert(Array.isArray(managers.teams));
      for (const team of managers.teams.map(object)) assert.equal(object(team.primaryOwner).state, 'unowned');
      const candidate = object(candidates.find(row => object(row.candidate).external_league_id === daily.auxiliary.admittedNativeLeagueId)!.candidate);
      const retainedRoster = await store.readRosterPlayerLinks({ rosterReceiptId: uuid(candidate.players_receipt_id), leagueSeasonId: mapping.leagueSeasonId });
      assert.equal(retainedRoster.status, 'available');
      const originals = original.rows.filter(row => object(row.content).external_league_id === daily.auxiliary.admittedNativeLeagueId);
      assert(originals.length >= 3); originals.forEach(row => capacityStoredReceiptNormalization(row));
      if (label === 'a') {
        const allDrafts = [value,...additionalPages.map(object)].flatMap(page => { assert(Array.isArray(page.drafts)); return page.drafts.map(object); });
        assert.equal(allDrafts.length, 43); assert.equal(new Set(allDrafts.map(row => row.ordinal)).size, 43);
        const admittedDrafts = allDrafts.filter(row => row.externalLeagueId === daily.auxiliary.admittedNativeLeagueId);
        for (const row of allDrafts.filter(row => row.externalLeagueId !== daily.auxiliary.admittedNativeLeagueId)) {
          assert.equal(row.collection, 'unavailable'); assert.equal(row.reason, 'bootstrap-capacity');
        }
        assert.equal(admittedDrafts.length, 5); admittedDrafts.forEach(row => { assert.equal(row.collection, 'complete'); assertDraftValue(row); });
      } else assert.equal(value.drafts, undefined);
      const proof: DailyAuxiliaryRead = { requestId, span: end(start), request: json(request), candidates: json(candidates) as JsonValue[],
        mapping: json(mapping), read: json(read), additionalPages, queries, currentReadProofIds, retainedRoster: json(retainedRoster),
        immutableReceiptRead: json({ span: original.span, rows: original.rows, directories: original.directories, queries: original.queries }),
        immutableProofIds: [...new Set([...endpointProofs.values()].filter(row => row.requestId === requestId).map(row => row.proofId))],
        completedEndpointIds: [...endpointAcceptances.values()].filter(row => row.requestId === requestId).map(row => row.endpointId) };
      operations.push({ operation: 'daily-auxiliary-read/' + label, span: proof.span, outcome: json({ requestId, digest: capacityDigest(proof) }) });
      return freezeCapacityValue(proof);
    }, start.startedAt + manifest.plan.sampleTimeoutMs);
  }
  async function beginDailyWindow(completed: readonly { label: 'a' | 'b'; proof: DailyAuxiliaryRead }[]) {
    assert(daily && !dailyWindowStarted && recoverySubmissions.size === 0 && dailyTurns.length === 0);
    assert.equal(completed.length, 2); const a = await observeDailyAuxiliaryIntake('a'), b = await observeDailyAuxiliaryIntake('b'); assert(a && b);
    const am = object(a.mapping), bm = object(b.mapping); for (const key of ['connectionId','leagueSeasonId','revisionId']) assert.equal(am[key], bm[key]);
    const teams = (proof: DailyAuxiliaryRead) => { const row = (object(proof.read).leagues as unknown[]).map(object).find(row => row.externalLeagueId === daily.auxiliary.admittedNativeLeagueId)!;
      return assertCapacityAuxiliaryTeams(daily.auxiliary.nativeRosterIds, capacityCurrentIntakeResource(object(row.resources).heldRoster)); };
    assert.equal(capacityDigest(teams(a)), capacityDigest(teams(b)));
    const queue = await observeDailyQueue(); assert.equal(queue.configurations.length, 0); assert.equal(queue.cycles.length, 0);
    assert.equal(queue.requests.length, 2); assert(queue.requests.every(value => object(value).terminal === true && [...auxiliarySubmissions.values()].some(row => row.requestId === object(value).id)));
    const requests = completed.map(({ label, proof }) => { const submission = auxiliarySubmissions.get(label); assert(submission && proof.requestId === submission.requestId);
      return { ...submission, completedAt: proof.span.endedAt, proof }; });
    assert.equal(new Set(requests.map(row => row.label)).size, 2);
    auxiliaryEvidence = freezeCapacityValue({ startedAt: setupStartedAt, endedAt: capacityTime(clock.wallNow()), initialState: dailyInitialState, requests, overlap: { a,b }, queueDigest: capacityDigest(queue) });
    startedAt = capacityTime(clock.wallNow()); publicationAt = startedAt + daily.clock.publicationOffsetMs; dailyWindowStarted = true;
    operations.push({ operation: 'daily-window-start', span: end(begin()), outcome: json({ startedAt, setupStartedAt, auxiliaryDigest: capacityDigest(auxiliaryEvidence) }) }); return startedAt;
  }
  function recordDailyCatalogChoice(choice: DailyCatalogChoice) {
    if (daily && activeDailyTurn) activeDailyTurn.catalogChoices.push(choice);
    else operations.push({ operation: 'orphan-daily-catalog-choice', span: choice.span, outcome: json(choice) });
  }
  async function observeDailyTurn(ordinal: number, run: () => Promise<unknown>, missed = false) {
    assert(daily && dailyWindowStarted); assert(Number.isSafeInteger(ordinal) && ordinal >= 0 && ordinal < DAILY_CLOCK.observationMs / 60_000);
    assert(!dailyTurns.some(row => row.ordinal === ordinal), 'daily turn cannot be replaced');
    const start = begin(), scheduledAt = startedAt + ordinal * 60_000, before = new Set(journal().requests.attempts.map(row => row.id));
    const row: DailyCatalogTurn = { ordinal, scheduledAt, startedAt: start.startedAt, endedAt: start.startedAt,
      state: missed ? 'missed' : 'invoked', catalogChoices: [], read: null, invocationOutcome: null, invocationFailed: null, lastAttemptId: null, retryAt: null, attemptIds: [] };
    dailyTurns.push(row); const queries: JsonValue[] = [];
    if (missed) { row.endedAt = end(start).endedAt; return; }
    try {
      const database: DatabaseClient = { enabled: true, query: (async (sql: string, params: readonly unknown[] = [], queryOptions?: Parameters<DatabaseClient['query']>[2]) => {
        const queryStart = begin(), rows = await options.database.query(sql, params, queryOptions);
        queries.push(json({ sql, params, rows, span: end(queryStart) })); return rows;
      }) as DatabaseClient['query'] };
      const read = await createLeagueAdministrationStore(database).readAcceptedPlayerDirectory({ limit: 1 });
      row.read = json({ value: read, queries });
      assert(read.status === 'available' || read.status === 'missing'); assert(read.latestAttempt !== undefined);
      if (read.latestAttempt) { row.lastAttemptId = read.latestAttempt.attemptId; row.retryAt = timestamp(read.latestAttempt.retryAt);
        assert.equal(row.retryAt - timestamp(read.latestAttempt.reservedAt), DAILY_CLOCK.catalogGuardMs); }
    } catch { row.state = 'read-failed'; row.read = json({ queries }); }
    activeDailyTurn = row;
    try { row.invocationOutcome = json(await run()); row.invocationFailed = false; }
    catch (error) { row.invocationFailed = true; throw error; }
    finally {
      activeDailyTurn = null; row.endedAt = end(start).endedAt;
      row.attemptIds = journal().requests.attempts.filter(attempt => !before.has(attempt.id) && attempt.owner === 'data-refresh'
        && attempt.method === 'GET' && attempt.path === '/v1/players/nfl').map(attempt => attempt.id);
      operations.push({ operation: 'daily-turn/' + ordinal, span: end(start), outcome: json({ state: row.state, attemptIds: row.attemptIds, invocationOutcome: row.invocationOutcome, invocationFailed: row.invocationFailed, catalogChoices: row.catalogChoices }) });
    }
    if (row.attemptIds.some(id => attemptIndex.get(id)?.outcome === 'success')) await observeRecoveryPlayerDirectory();
  }
  async function observeDailyQueue() {
    assert(daily); const start = begin();
    const rows = await options.database.query(CAPACITY_DAILY_QUEUE_SQL);
    assert.equal(rows.length, 1); const value = rows[0];
    for (const key of ['requests','cycles','configurations','outcomes']) assert(Array.isArray(value[key]));
    const body = { requests: json(value.requests) as JsonValue[], cycles: json(value.cycles) as JsonValue[],
      configurations: json(value.configurations) as JsonValue[], outcomes: json(value.outcomes) as JsonValue[] };
    const digest = capacityDigest(body), previous = dailyQueue.at(-1);
    if (!previous || capacityDigest({ requests: previous.requests, cycles: previous.cycles, configurations: previous.configurations, outcomes: previous.outcomes }) !== digest)
      dailyQueue.push(freezeCapacityValue({ at: end(start).endedAt, ...body }));
    operations.push({ operation: 'daily-queue', span: end(start), outcome: json({ digest, querySha256: createHash('sha256').update(CAPACITY_DAILY_QUEUE_SQL).digest('hex'), params: [] }) }); return body;
  }
  async function observeDailyIntake(requestId: string) {
    assert(daily); if (dailyIntakes.has(requestId)) return dailyIntakes.get(requestId)!;
    const start = begin();
    const result = await bounded('daily-intake/' + requestId, async signal => {
      const rows = await options.database.query(CAPACITY_DAILY_INTAKE_SQL, [uuid(requestId)], { signal });
      assert.equal(rows.length, 1); const request = object(rows[0].request); assert.equal(request.terminal, true);
      const original = [...recoverySubmissions.values()].find(row => row.id.startsWith('initial-') && row.requestId === requestId);
      const planned = daily.targets.find(row => (original ? row.username : row.nativeUsername) === request.username); assert(planned);
      const initial = daily.initialRequests.find(row => row.cohort === planned.cohort)!;
      const proof = await completeIntake(requestId, initial.nativeLeagueIds, signal, original ? 'initial' : 'full');
      const cycle = original ? null : object(rows[0].cycle); if (cycle) assert(cycle.cycle === 1 || cycle.cycle === 2);
      operations.push({ operation: 'daily-intake-binding/' + requestId, span: end(start), outcome: json({ ...rows[0], querySha256: createHash('sha256').update(CAPACITY_DAILY_INTAKE_SQL).digest('hex'), params: [requestId] }) });
      return { requestId, cohort: planned.cohort, kind: original ? 'initial' as const : 'cycle' as const,
        cycle: cycle ? Number(cycle.cycle) : null, targetId: cycle ? uuid(cycle.target_id) : null,
        createdAt: timestamp(request.created_at), dueAt: cycle ? timestamp(cycle.due_at) : null,
        completedAt: end(start).endedAt, proof: proof as import('./freshness-capacity-recovery').RecoveryIntakeProof };
    }, start.startedAt + manifest.plan.sampleTimeoutMs);
    operations.push({ operation: 'daily-intake/' + requestId, span: end(start), outcome: result ? json({ requestId, completedAt: result.completedAt, proofDigest: capacityDigest(result.proof) }) : null });
    if (result) {
      dailyIntakes.set(requestId, freezeCapacityValue(result));
      const requests = new Map([...recoverySubmissions.values()].filter(row => row.id.startsWith('initial-')).map(row => [row.id.slice(8), row.requestId]));
      await observeAncillary(result.completedAt, requests, daily.initialRequests.find(row => row.cohort === result.cohort)!.leagueKeys, true);
    }
    return result;
  }
  async function observeDailyBoundary(scheduledAt: number) {
    assert(daily && daily.boundaryOffsets.includes(scheduledAt - startedAt));
    assert(!dailyBoundaries.some(row => row.scheduledAt === scheduledAt), 'daily boundary cannot be replaced'); const start = begin();
    const requests = new Map([...recoverySubmissions.values()].filter(row => row.id.startsWith('initial-')).map(row => [row.id.slice(8), row.requestId]));
    await observeAncillary(scheduledAt, requests, undefined, true);
    const reads = ancillaryReads.filter(row => row.scheduledAt === scheduledAt);
    dailyBoundaries.push({ scheduledAt, startedAt: start.startedAt, endedAt: end(start).endedAt,
      proofIds: reads.flatMap(row => Object.values(row.components).filter((id): id is string => id !== null)) });
  }
  function dailySnapshot() {
    assert(daily && auxiliaryEvidence); return freezeCapacityValue(structuredClone({ auxiliary: auxiliaryEvidence, manifestDigest: daily.digest, startedAt, endedAt: capacityTime(clock.wallNow()),
      initialSubmissions: [...recoverySubmissions.values()].filter(row => row.id.startsWith('initial-')).map(row => ({ cohort: row.id.slice(8), requestId: row.requestId,
        submittedAt: row.dispatchedAt, receiptAt: row.receiptAt, receipt: json(row.receipt) })),
      initialHeadConfirmations: [...recoveryHeads.initial.values()].map(row => ({ pairId: row.pairId, requestId: String(object(row.lineage.dispatch.work).requestId), at: row.read.at, proofId: row.lineage.receiptId })),
      intakes: [...dailyIntakes.values()], endpointAcceptances: [...endpointAcceptances.values()], catalogTurns: dailyTurns, queue: dailyQueue,
      boundaries: dailyBoundaries, requests: journal().requests }));
  }
  function recoverySnapshot() {
    assert(recovery); const convert = (row: BoundRead) => ({ pairId: row.pairId, read: row.read, reader: row.reader,
      retainedHistory: recoveryHistory.get(row.pairId) ?? [], proofId: row.lineage.receiptId });
    return freezeCapacityValue(structuredClone({ manifestDigest: recovery.digest, startedAt, endedAt: capacityTime(clock.wallNow()),
      initial: [...recoveryHeads.initial.values()].map(convert),
      lastGood: [...recoveryHeads.before.values()].flatMap(before => { const during = recoveryHeads.during.get(before.pairId);
        return during ? [{ pairId: before.pairId, before: convert(before), during: convert(during) }] : []; }),
      recovered: [...recoveryHeads.recovered.values()].map(convert), samples: [...recoverySamples.values()], submissions: [...recoverySubmissions.values()],
      origins: [...origins.values()], requests: journal().requests, endpointAcceptances: [...endpointAcceptances.values()].filter(row => row.requestId === null || recovery.submissions.some(submission => submission.input.id === row.requestId)),
      queue: { snapshots: queueSnapshots, completed: [...queueCompleted.values()] } }));
  }
  function ancillaryAnalysis(endedAt: number, restoredAt?: number) {
    const componentNames = [...CAPACITY_ANCILLARY_COMPONENTS, 'official-results'] as const;
    const leagues = manifest.plan.leagues.map(planned => {
      const observed = ancillaryReads.filter(row => row.leagueKey === planned.key && row.span.endedAt <= endedAt);
      const originalAnchors = manifest.plan.pairs.filter(pair => pair.leagueKey === planned.key).map(pair => anchors.get(pair.id));
      const windowEnd = recovery ? endedAt : originalAnchors.every(value => value !== undefined)
        ? Math.max(...originalAnchors as number[]) + manifest.plan.observationHorizonMs : null;
      const componentAnchors = CAPACITY_ANCILLARY_COMPONENTS.map(component => ancillaryAnchors.get(planned.key + '/' + component));
      const components = componentNames.map(component => {
        const anchor = component === 'official-results' ? componentAnchors.every(Boolean) ? Math.max(...componentAnchors.map(row => row!.at)) : null
          : ancillaryAnchors.get(planned.key + '/' + component)?.at ?? null;
        const successes: CapacityAncillarySuccess[] = [];
        for (const row of observed) {
          if (row.span.startedAt < row.scheduledAt || row.span.startedAt > row.scheduledAt + manifest.plan.sampleDispatchLatenessMs
            || row.span.endedAt > row.scheduledAt + manifest.plan.sampleTimeoutMs) continue;
          const selected = component === 'official-results' ? CAPACITY_ANCILLARY_COMPONENTS : [component];
          if (component === 'official-results' && row.composed === null || selected.some(name => !row.components[name])) continue;
          const proofs = selected.map(name => ancillaryProofs.get(row.components[name]!)!);
          const responses = proofs.map(proof => responseIndex.get(proof.source.attemptId)!);
          const confirmedAt = component === 'official-results' ? row.span.endedAt : row.componentSpans[component]?.endedAt;
          if (confirmedAt === undefined || responses.some(response => !response)) continue;
          successes.push({ receiptId: proofs.map(proof => proof.source.proofId).join('/'), attemptId: responses.map(response => response.attemptId).join('/'),
            sourceAt: Math.min(...responses.map(response => response.responseCompletedAt)),
            acceptedAt: Math.max(...proofs.map(proof => timestamp(object(object(proof.source.record).acceptance).accepted_at))), confirmedAt });
        }
        if (anchor === null || windowEnd === null || windowEnd > endedAt) return { component, pass: false, reason: 'missing-fixed-window', anchor, end: windowEnd };
        if (recovery) {
          const outageStart = startedAt + recovery.clock.outageStartMs, restore = restoredAt ?? startedAt + recovery.clock.outageEndMs;
          if (anchor >= outageStart || restore > endedAt) return { component, pass: false, reason: 'missing-recovery-window', anchor, end: windowEnd };
          const before = evaluateCapacityAncillaryChain(anchor, outageStart, successes), after = evaluateCapacityAncillaryChain(restore, windowEnd, successes, false, true);
          const full = evaluateCapacityAncillaryChain(anchor, windowEnd, successes);
          return { component, pass: before.pass && after.pass, anchor, end: windowEnd, before, after,
            outageInclusive: { maximumGapMs: full.maximumGapMs, failures: full.failures }, excluded: { start: outageStart, end: restore } };
        }
        const chain = evaluateCapacityAncillaryChain(anchor, windowEnd, successes, planned.cohort === 'accepted');
        const boundaryRead = (at: number) => ancillaryReads.some(row => row.leagueKey === planned.key && row.scheduledAt === at && row.composed !== null
          && row.span.startedAt >= at && row.span.startedAt <= at + manifest.plan.sampleDispatchLatenessMs && row.span.endedAt <= at + manifest.plan.sampleTimeoutMs);
        const boundary = (planned.cohort !== 'accepted' || boundaryRead(startedAt)) && boundaryRead(windowEnd);
        return { component, pass: chain.pass && boundary, anchor, end: windowEnd, boundary, chain };
      });
      return { leagueKey: planned.key, pass: components.every(row => row.pass), end: windowEnd, components };
    });
    return { kind: 'cp26-ancillary-cadence-v1', maximumSuccessfulRefreshIntervalMs: CAPACITY_ANCILLARY_LIMIT_MS,
      pass: leagues.every(row => row.pass), leagues, dailyRecurrenceQualified: false };
  }
  function assembleSnapshot(transport: ReturnType<typeof journal>, journalValidation: 'validated' | 'not-validated-diagnostic-only') {
    const endedAt = capacityTime(clock.wallNow());
    let outage: OutageEvidence | null = null;
    if (manifest.lane.kind === 'outage' && outageStartedAt !== null && dependencyRestoredAt !== null && runnerRestoredAt !== null) outage = {
      startedAt: outageStartedAt, dependencyRestoredAt, runnerRestoredAt,
      recovered: [...outageReads.recovered.values()].map(row => ({ pairId: row.pairId, read: row.read })),
      lastGood: [...outageReads.before.values()].flatMap(before => { const during = outageReads.during.get(before.pairId);
        return during ? [{ pairId: before.pairId, before: { read: before.read, reader: before.reader }, during: { read: during.read, reader: during.reader } }] : []; }),
      backlog: [...backlog.values()] };
    const evidence: CapacityEvidence = { manifestDigest: manifest.digest, startedAt, endedAt, firstAcceptances: [...first.values()],
      intakes: [...intakes.values()], requests: transport.requests, origins: [...origins.values()], samples: [...samples.values()], events: [...events.values()], outage };
    const rawAncillary = { queryRows: [...ancillaryQueryRows].map(([id,value]) => ({ id,value })), proofs: [...ancillaryProofs.values()] };
    // Failure snapshots preserve raw observations and intentionally cannot satisfy the encoded parent schema.
    const serializedAncillary = journalValidation === 'validated' ? encodeCapacityAncillaryBodies(rawAncillary.queryRows, rawAncillary.proofs) : rawAncillary;
    return freezeCapacityValue(structuredClone({ kind: 'cp26-stored-observer-journal-v1' as const, journalValidation, evidence, durableDispatches: [...durableDispatches.values()], dispatchObservations, dispatchJournalReadAt,
      ancillaryQueryRows: serializedAncillary.queryRows, ancillaryProofs: serializedAncillary.proofs, ancillaryAnchors: [...ancillaryAnchors.values()], ancillaryRequests: [...ancillaryRequests].map(([cohort, requestId]) => ({ cohort, requestId })), ancillaryReads, endpointProofs: [...endpointProofs.values()], currentIntakeReads: [...currentIntakeReads.values()], intakePages: [...intakePages].map(([digest, value]) => ({ digest, value })), intakePageReads, receiptProofs: [...receiptProofs.values()], dispatchOutcomes: [...dispatchOutcomes].map(([id, value]) => ({ id, value })), lineage, operations, invocations, failures,
      ownerCoverage: options.journals().map(row => ({ owner: row.owner, startedAt: row.coverageStartedAt, endedAt: row.coverageEndedAt })),
      openInvocations: invocations.filter(row => row.span.endedAt === null).length,
      executionReady: false as const, checkpoint26Qualified: false as const,
      gaps: ['Observer source and unit checks do not attest restricted LOGIN, SQL identity or real elapsed execution.',
        'The existing guarded owner must independently prove complete all-owner transport coverage, invocation outcomes, outage control and cleanup.',
        'A short observation never fills missing fixed slots, events, imports, outage history or full fleet qualification.'] }));
  }
  function snapshot() { return assembleSnapshot(journal(), 'validated'); }
  /** Failure retention only. This never grants source validation or qualification credit. */
  function diagnosticSnapshot() {
    const rows = options.journals();
    return assembleSnapshot({ requests: { coverageStartedAt: Math.max(...rows.map(row => row.coverageStartedAt)),
      coverageEndedAt: Math.min(...rows.map(row => row.coverageEndedAt)),
      ownerTotals: rows.map(row => ({ owner: row.owner, attempts: row.attempts.length })), attempts: rows.flatMap(row => [...row.attempts]) } }, 'not-validated-diagnostic-only');
  }
  return { recordDailyCatalogChoice, observeDailyAuxiliarySubmission, observeDailyAuxiliaryIntake, beginDailyWindow, observeDailyTurn, observeDailyQueue, observeDailyIntake, observeDailyBoundary, dailySnapshot, observeInvocation, observeDispatches, observeAncillary, ancillaryAnalysis, observeRecoverySubmission, observeRecoveryHeads, observeRecoveryIntake, observeRecoveryEndpoints, observeRecoveryPlayerDirectory, observeRecoveryPrimaryCatalog, observeRecoverySamples, observeRecoveryQueue, observeRecoveryQueuedIntake, recoverySnapshot, firstAcceptance, observeDueSamples, observeEvents, observeSubmission, observeIntake, observeOutage,
    observeOutageStart, observeRestoration, observeBacklog, snapshot, diagnosticSnapshot, anchors: () => new Map(anchors) };
}
