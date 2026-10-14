import 'server-only';
import type { DatabaseClient, DatabaseRow } from '../../database';
import { DRAFT_METADATA_VERSION, DRAFT_METADATA_POLICY, DRAFT_METADATA_LIMITS, draftMetadataScope, projectDraftMetadata,
  type DraftMetadataFacts, type DraftMetadataProjection, type DraftMetadataRead, type DraftMetadataResource,
  type DraftMetadataSelection, type DraftMetadataValue } from '../../aggregator/draft-metadata';
import type { RosterAttempt } from '../../aggregator/current-roster';
import { compatibleRevision } from '../../projections/shared/revision-compatibility';
import type { AdministrationEnvelope, AdministrationWriteFence, JsonObject } from '../contracts';
import type { AdministrationSourceMapping } from '../source-mapping';
import { normalizeAdministrationObservation } from '../normalize';

/** A current read selects its accepted head; explicit receipt reads may return
 * incomplete observed evidence. Neither borrows another resource or mapping. */
export const DRAFT_METADATA_SQL = `/* league-administration:read-draft-metadata */
  SELECT scope.identity,head.accepted_id AS head_accepted_id,head.generation AS head_generation,
    accepted.id AS acceptance_id,accepted.generation,accepted.source_mapping_revision_id,accepted.accepted_at,
    receipt.id AS receipt_id,receipt.attempt_id,receipt.provenance,receipt.coverage,receipt.legacy_observation_id,
    receipt.configuration_content_id,receipt.population_evidence,receipt.expected_team_count,
    attempt.id AS reserved_attempt_id,attempt.ordinal,attempt.expected_generation,attempt.source_mapping,
    CASE WHEN receipt.provenance ? 'acquisition' THEN COALESCE(
      receipt.provenance->'acquisition'->'fence'=attempt.write_fence
      AND receipt.provenance->'acquisition'->'mapping'=attempt.source_mapping
      AND receipt.provenance->'acquisition'->'attempts'=jsonb_build_object('draftMetadata',
        jsonb_build_object('id',attempt.id,'nonce',attempt.capture_nonce))
      AND EXISTS(SELECT 1 FROM public.public_data_dispatches dispatch
        WHERE dispatch.worker_id=attempt.write_fence->>'workerId'
          AND dispatch.generation=(attempt.write_fence->>'generation')::integer
          AND dispatch.resource='drafts' AND dispatch.max_requests=1
          AND dispatch.work=receipt.provenance->'acquisition'->'work'
          AND dispatch.capture_nonce::text=receipt.provenance->'acquisition'->>'dispatchNonce'
          AND dispatch.admitted_at<=attempt.reserved_at AND attempt.reserved_at<=receipt.recorded_at),false)
      ELSE COALESCE((receipt.provenance->>'requestStartedAt')::timestamptz>=attempt.reserved_at,false)
    END AS capture_after_reservation,
    content.id AS content_id,content.content_hash,content.semantic_hash,content.payload,content.normalized_value,
    content.normalizer_version,content.completeness,content.accepted AS content_accepted,
    content.league_season_id,content.provider,content.external_league_id,content.family,content.week,
    observation.content_id AS observation_content_id,observation.league_season_id AS observation_league_season_id,
    to_jsonb(header.*) AS value_header,first_receipt.content_id AS first_receipt_content_id,
    (SELECT COALESCE(jsonb_agg(jsonb_build_array(entry.source_ordinal,entry.identity_state,entry.external_draft_id,entry.detail_state)
        ORDER BY entry.source_ordinal),'[]'::jsonb)
      FROM public.league_draft_metadata_entries entry WHERE entry.content_id=content.id) AS entries,
    (SELECT COALESCE(jsonb_agg(to_jsonb(fact)||jsonb_build_object('canonical_league_season_id',identity.league_season_id,
        'canonical_provider',identity.provider,'canonical_external_league_matches',identity.external_league_id=content.external_league_id,
        'native_fields',fact.native_fields #- '{type,value}' #- '{status,value}',
        'canonical_external_draft_id',identity.external_draft_id,
        'user_slots',(SELECT COALESCE(jsonb_agg(jsonb_build_array(slot.external_user_id,slot.field_state,slot.raw_value,slot.draft_slot)
            ORDER BY slot.external_user_id COLLATE "C"),'[]'::jsonb)
          FROM public.league_draft_metadata_user_slots slot WHERE slot.content_id=fact.content_id
            AND slot.source_kind=fact.source_kind AND slot.external_draft_id=fact.external_draft_id),
        'slot_rosters',(SELECT COALESCE(jsonb_agg(jsonb_build_array(slot.slot_key,slot.field_state,slot.raw_value,slot.external_roster_id)
            ORDER BY slot.slot_key COLLATE "C"),'[]'::jsonb)
          FROM public.league_draft_metadata_slot_rosters slot WHERE slot.content_id=fact.content_id
            AND slot.source_kind=fact.source_kind AND slot.external_draft_id=fact.external_draft_id))
        ORDER BY fact.source_kind,fact.external_draft_id),'[]'::jsonb)
      FROM public.league_draft_metadata_facts fact JOIN public.league_season_drafts identity ON identity.id=fact.draft_id
      WHERE fact.content_id=content.id) AS facts
  FROM public.league_roster_resource_scopes scope
  JOIN public.league_roster_resource_heads head ON head.scope_id=scope.id
  JOIN public.league_roster_resource_attempts attempt ON attempt.scope_id=scope.id
  JOIN public.league_roster_capture_receipts receipt ON receipt.attempt_id=attempt.id
  LEFT JOIN public.league_roster_resource_acceptances accepted ON accepted.receipt_id=receipt.id AND accepted.scope_id=scope.id
  JOIN public.league_administration_contents content ON content.id=receipt.content_id
  JOIN public.league_administration_observations observation ON observation.id=receipt.legacy_observation_id
  LEFT JOIN public.league_draft_metadata_contents header ON header.content_id=content.id
  LEFT JOIN public.league_roster_capture_receipts first_receipt ON first_receipt.id=header.first_receipt_id
  JOIN public.league_source_connections connection ON connection.id=scope.connection_id AND connection.league_season_id=scope.league_season_id
  JOIN public.league_seasons season ON season.id=scope.league_season_id
  JOIN public.league_administration_enrollment_seasons enrollment ON enrollment.league_id=season.league_id
    AND enrollment.season=season.season AND enrollment.provider=connection.provider
  WHERE scope.identity=$1::jsonb AND connection.current_mapping_revision_id=$2::uuid AND connection.mapping_generation=$3
    AND season.season=2026 AND content.family='drafts' AND content.week=0
    AND (($4::uuid IS NULL AND head.accepted_id=accepted.id AND head.generation=accepted.generation)
      OR ($4::uuid IS NOT NULL AND receipt.id=$4::uuid)) LIMIT 2`;

function object(value: unknown): Record<string, unknown> {
  if (typeof value === 'string') return object(JSON.parse(value));
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid draft metadata object.');
  return value as Record<string, unknown>;
}
const same = (left: unknown, right: unknown) => left === undefined || right === undefined
  ? left === right : compatibleRevision(left) === compatibleRevision(right);
function uuid(value: unknown): string {
  if (typeof value !== 'string' || !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/iu.test(value)) throw new Error('Invalid draft metadata identity.');
  return value;
}
function integer(value: unknown, minimum = 0): number {
  const parsed = typeof value === 'number' || typeof value === 'string' && /^\d+$/u.test(value) ? Number(value) : NaN;
  if (!Number.isSafeInteger(parsed) || parsed < minimum) throw new Error('Invalid draft metadata integer.');
  return parsed;
}
function timestamp(value: unknown): string {
  const parsed = value instanceof Date ? value : typeof value === 'string' ? new Date(value) : new Date(NaN);
  if (!Number.isFinite(parsed.getTime())) throw new Error('Invalid draft metadata time.');
  return parsed.toISOString();
}
function rows(value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value)) throw new Error('Invalid draft metadata relational rows.');
  return value.map(object);
}
/** Each tuple is selected through its owning content/fact foreign key. Omitting
 * repeated scope IDs prevents bounded native maps from amplifying past 32 MiB. */
function tuples(value: unknown): unknown[][] {
  if (!Array.isArray(value) || value.some(row => !Array.isArray(row) || row.length !== 4)) throw new Error('Invalid draft metadata tuple rows.');
  return value as unknown[][];
}
function fieldState(value: unknown): DraftMetadataFacts['type']['state'] {
  if (typeof value !== 'string' || !['missing', 'null', 'empty', 'invalid', 'supplied'].includes(value)) throw new Error('Invalid draft metadata field state.');
  return value as DraftMetadataFacts['type']['state'];
}
const unavailable = (): DraftMetadataRead => ({ status: 'unavailable', reason: 'draft_metadata_evidence_unavailable' });
export function draftMetadataCoverage(projection: DraftMetadataProjection): JsonObject {
  const covered = projection.status === 'accepted' && projection.value.complete;
  return { periodIds: [], interval: null, entitySet: covered ? 'full' : 'unknown',
    fields: ['draft_id', 'league_id', 'season', 'type', 'status', 'settings', 'draft_order', 'slot_to_roster_id', 'metadata', 'start_time', 'created', 'last_picked'],
    pagination: covered ? 'complete' : 'unknown', nextCursor: null, completeness: covered ? 'complete' : 'partial',
    reasons: covered ? [] : ['draft_metadata_incomplete'] };
}

/** Reconstruct from relational columns. Raw projection only supplies the parity
 * check; it cannot fill absent typed facts, links or canonical identities. */
function relationalValue(row: DatabaseRow, mapping: AdministrationSourceMapping, projected: DraftMetadataValue): DraftMetadataValue {
  const contentId = uuid(row.content_id), header = object(row.value_header), entries = tuples(row.entries), facts = rows(row.facts);
  if (header.content_id !== contentId || header.value_version !== DRAFT_METADATA_VERSION || row.first_receipt_content_id !== contentId
    || header.kind !== projected.kind || header.complete !== projected.complete) throw new Error('Invalid draft metadata typed header.');
  uuid(header.first_receipt_id);
  const expectedFacts = projected.kind === 'detail' ? [['catalog', projected.externalDraftId], ['detail', projected.externalDraftId]]
    : projected.entries.filter(entry => entry.metadata !== null).map(entry => ['catalog', entry.externalDraftId!]);
  const expectedKeys = new Set(expectedFacts.map(([kind, id]) => kind + ':' + id));
  const byKey = new Map<string, DraftMetadataFacts>(), canonicalIds = new Map<string, string>();
  if (facts.length !== expectedKeys.size) throw new Error('Missing or extra draft metadata facts.');
  const linkKey = (link: Record<string, unknown>) => String(link.source_kind) + ':' + String(link.external_draft_id);
  for (const fact of facts) {
    const key = linkKey(fact), native = object(fact.native_fields), identity = uuid(fact.draft_id);
    if (!expectedKeys.has(key) || byKey.has(key) || fact.content_id !== contentId || fact.season !== 2026
      || fact.external_league_id !== mapping.scope.externalLeagueId || fact.canonical_league_season_id !== mapping.leagueSeasonId
      || fact.canonical_provider !== mapping.scope.provider || fact.canonical_external_league_matches !== true
      || fact.canonical_external_draft_id !== fact.external_draft_id) throw new Error('Invalid canonical draft identity.');
    const nativeId = String(fact.external_draft_id), previous = canonicalIds.get(nativeId);
    if (previous && previous !== identity || [...canonicalIds].some(([id, canonical]) => id !== nativeId && canonical === identity)) throw new Error('Conflicting canonical draft identity.');
    canonicalIds.set(nativeId, identity);
    const userRows = tuples(fact.user_slots), rosterRows = tuples(fact.slot_rosters);
    if (new Set(userRows.map(link => link[0])).size !== userRows.length
      || new Set(rosterRows.map(link => link[0])).size !== rosterRows.length) throw new Error('Duplicate draft metadata links.');
    const userSlots = userRows.map(([externalUserId, state, raw, value]) => {
      if (typeof externalUserId !== 'string' || value !== null && typeof value !== 'number') throw new Error('Invalid draft user identity or slot.');
      return { externalUserId, slot: { state: fieldState(state), raw,
        value: value === null ? null : integer(value, 1) } };
    }).sort((a, b) => Buffer.compare(Buffer.from(a.externalUserId), Buffer.from(b.externalUserId)));
    const slotRosters = rosterRows.map(([slotKey, state, raw, value]) => {
      if (typeof slotKey !== 'string' || value !== null && typeof value !== 'string') throw new Error('Invalid native roster reference.');
      return { slotKey, externalRosterId: { state: fieldState(state), raw, value } };
    }).sort((a, b) => Buffer.compare(Buffer.from(a.slotKey), Buffer.from(b.slotKey)));
    const value = { ...native, externalDraftId: nativeId, externalLeagueId: fact.external_league_id, season: fact.season,
      type: { state: fact.type_state, raw: object(native.type).raw, value: fact.type_value },
      status: { state: fact.status_state, raw: object(native.status).raw, value: fact.status_value },
      settings: fact.settings, metadata: fact.metadata, extensions: fact.extensions, userSlots, slotRosters };
    byKey.set(key, value as unknown as DraftMetadataFacts);
  }
  if (projected.kind === 'detail') {
    if (entries.length || header.external_draft_id !== projected.externalDraftId || header.total_count !== null
      || header.reason !== null || ['valid_identity_count', 'invalid_identity_count', 'attempted_detail_count', 'succeeded_detail_count',
        'failed_detail_count', 'unrequested_detail_count'].some(key => integer(header[key]) !== 0)) throw new Error('Invalid detail inventory.');
    return { kind: 'detail', season: 2026, complete: true, externalDraftId: String(header.external_draft_id),
      catalog: byKey.get('catalog:' + header.external_draft_id)!, detail: byKey.get('detail:' + header.external_draft_id)!,
      picks: 'not-requested', tradedPicks: 'not-requested' };
  }
  if (header.external_draft_id !== null || entries.length !== projected.entries.length) throw new Error('Invalid catalog inventory.');
  const sorted = entries.sort((a, b) => integer(a[0]) - integer(b[0]));
  const typedEntries = sorted.map(([ordinal, identityState, externalDraftId, detailState], index) => {
    if (typeof ordinal !== 'number' || integer(ordinal) !== index
      || typeof identityState !== 'string' || !['valid', 'invalid'].includes(identityState)
      || externalDraftId !== null && typeof externalDraftId !== 'string'
      || typeof detailState !== 'string' || !['succeeded', 'failed', 'unrequested'].includes(detailState)) throw new Error('Invalid catalog entry.');
    return { sourceOrdinal: index, identityState, externalDraftId,
      metadata: identityState === 'valid' ? byKey.get('catalog:' + externalDraftId) ?? null : null, detailState };
  });
  return { kind: 'catalog', season: 2026, complete: header.complete, totalCount: header.total_count === null ? null : integer(header.total_count),
    validIdentityCount: integer(header.valid_identity_count), invalidIdentityCount: integer(header.invalid_identity_count),
    attemptedDetailCount: integer(header.attempted_detail_count), succeededDetailCount: integer(header.succeeded_detail_count),
    failedDetailCount: integer(header.failed_detail_count), unrequestedDetailCount: integer(header.unrequested_detail_count),
    entries: typedEntries, reason: header.reason, picks: 'not-requested', tradedPicks: 'not-requested' } as DraftMetadataValue;
}

export function readDraftMetadataRows(result: readonly DatabaseRow[], mapping: AdministrationSourceMapping,
  selection: DraftMetadataSelection): DraftMetadataRead {
  try {
    const scope = draftMetadataScope(mapping, selection);
    if (selection.receiptId !== undefined) uuid(selection.receiptId);
    if (!result.length) return { status: 'missing', reason: 'draft_metadata_capture_missing' };
    if (result.length !== 1 || Buffer.byteLength(JSON.stringify(result[0]), 'utf8') > DRAFT_METADATA_LIMITS.persistedBytes) throw new Error('Invalid draft metadata result bounds.');
    const row = result[0], contentId = uuid(row.content_id), receiptId = uuid(row.receipt_id), attemptId = uuid(row.attempt_id);
    uuid(row.legacy_observation_id); integer(row.ordinal, 1); integer(row.expected_generation);
    const provenance = object(row.provenance) as AdministrationEnvelope['provenance'];
    if (!same(row.identity, { scope, policy: DRAFT_METADATA_POLICY }) || !same(row.source_mapping, mapping)
      || row.reserved_attempt_id !== attemptId || row.league_season_id !== mapping.leagueSeasonId || row.provider !== mapping.scope.provider
      || row.external_league_id !== mapping.scope.externalLeagueId || row.family !== 'drafts' || Number(row.week) !== 0
      || row.normalizer_version !== 'sleeper-administration-v1' || !['complete', 'partial'].includes(String(row.completeness))
      || row.observation_content_id !== contentId || row.observation_league_season_id !== mapping.leagueSeasonId
      || row.configuration_content_id !== null || row.population_evidence !== null || row.expected_team_count !== null
      || row.capture_after_reservation !== true || provenance.origin !== 'network'
      || selection.receiptId !== undefined && selection.receiptId !== receiptId) throw new Error('Invalid draft metadata receipt lineage.');
    const started = timestamp(provenance.requestStartedAt), completed = timestamp(provenance.requestCompletedAt), checked = timestamp(provenance.checkedAt);
    if (started > completed || completed > checked || provenance.sourceObservedAt !== null
      && (timestamp(provenance.sourceObservedAt) < started || timestamp(provenance.sourceObservedAt) > completed)) throw new Error('Invalid draft source clocks.');
    const normalized = normalizeAdministrationObservation({ schemaVersion: 'league-administration-v1', normalizerVersion: 'sleeper-administration-v1',
      dialect: 'sleeper-nfl-v1', scope: mapping.scope, family: 'drafts', week: null, completeness: row.completeness as 'complete' | 'partial',
      provenance, payload: row.payload as AdministrationEnvelope['payload'] });
    if (normalized.contentHash !== row.content_hash || normalized.semanticHash !== row.semantic_hash || !same(normalized.value, row.normalized_value)
      || row.content_accepted !== (normalized.status === 'accepted' && row.completeness === 'complete')) throw new Error('Invalid draft native normalization.');
    const projected = projectDraftMetadata(normalized);
    if (!same(row.coverage, draftMetadataCoverage(projected))) throw new Error('Invalid draft metadata coverage.');
    const payload = object(row.payload);
    if (payload.kind !== selection.kind || selection.kind === 'detail' && payload.externalDraftId !== selection.externalDraftId) throw new Error('Wrong draft metadata resource.');
    let value: DraftMetadataValue | null = null;
    if (projected.status === 'accepted') {
      value = relationalValue(row, mapping, projected.value);
      if (!same(value, projected.value)) throw new Error('Draft typed native parity mismatch.');
    } else if (row.value_header !== null || (tuples(row.entries).length || rows(row.facts).length)) throw new Error('Rejected draft metadata has typed facts.');
    let acceptanceId: string | null = null, acceptedGeneration: number | null = null, acceptedAt: string | null = null;
    if (row.acceptance_id !== null) {
      acceptanceId = uuid(row.acceptance_id); acceptedGeneration = integer(row.generation, 1); acceptedAt = timestamp(row.accepted_at);
      if (row.source_mapping_revision_id !== mapping.revisionId || acceptedGeneration !== integer(row.expected_generation) + 1
        || projected.status !== 'accepted' || !projected.value.complete || !provenance.sourceObservedAt
        || selection.receiptId === undefined && (row.head_accepted_id !== acceptanceId || integer(row.head_generation) !== acceptedGeneration)) throw new Error('Invalid draft acceptance.');
    } else if (selection.receiptId === undefined || row.generation !== null || row.source_mapping_revision_id !== null || row.accepted_at !== null) throw new Error('Unaccepted current draft metadata.');
    return { status: acceptanceId ? 'available' : 'observed', version: DRAFT_METADATA_VERSION,
      selection: selection.receiptId === undefined ? 'current' : 'receipt', contentId, receiptId, acceptanceId, acceptedGeneration, acceptedAt,
      sourceMappingRevisionId: mapping.revisionId, provenance, coverage: row.coverage as JsonObject, value };
  } catch { return unavailable(); }
}

export function draftMetadataMethods(client: DatabaseClient) {
  return {
    async beginDraftMetadataAttempt(mapping: AdministrationSourceMapping, resource: DraftMetadataResource, id: string,
      fence?: AdministrationWriteFence): Promise<RosterAttempt> {
      draftMetadataScope(mapping, resource); uuid(id);
      const selected = resource.kind === 'catalog' ? { kind: 'catalog' } : { kind: 'detail', externalDraftId: resource.externalDraftId };
      const result = await client.query(`/* league-administration:begin-draft-metadata-attempt */
        SELECT public.begin_draft_metadata_attempt($1::jsonb,$2::jsonb,$3::uuid,$4::jsonb) AS result`,
      [JSON.stringify(mapping), JSON.stringify(selected), id, fence ? JSON.stringify(fence) : null]);
      const row = object(result.length === 1 ? result[0].result : null);
      if (row.id !== id) throw new Error('Invalid draft metadata reservation.');
      return { id, scopeId: uuid(row.scopeId), ordinal: integer(row.ordinal, 1), expectedGeneration: integer(row.expectedGeneration) };
    },
    async readDraftMetadata(mapping: AdministrationSourceMapping, selection: DraftMetadataSelection): Promise<DraftMetadataRead> {
      try {
        const scope = draftMetadataScope(mapping, selection);
        if (selection.receiptId !== undefined) uuid(selection.receiptId);
        const result = await client.query(DRAFT_METADATA_SQL, [JSON.stringify({ scope, policy: DRAFT_METADATA_POLICY }),
          mapping.revisionId, mapping.generation, selection.receiptId ?? null]);
        return readDraftMetadataRows(result, mapping, selection);
      } catch { return unavailable(); }
    },
  };
}
