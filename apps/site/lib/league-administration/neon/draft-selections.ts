import 'server-only';
import type { DatabaseClient, DatabaseRow } from '../../database';
import { DRAFT_SELECTIONS_VERSION, DRAFT_SELECTIONS_POLICY, DRAFT_SELECTIONS_LIMITS, draftSelectionsScope, projectDraftSelections,
  type DraftSelectionFacts, type DraftSelectionPlayerLinks, type DraftSelectionsProjection, type DraftSelectionsRead, type DraftSelectionsResource,
  type DraftSelectionsSelection, type DraftSelectionsValue } from '../../aggregator/draft-selections';
import type { RosterAttempt } from '../../aggregator/current-roster';
import { rosterPlayerKind } from '../../aggregator/roster-player-links';
import { compatibleRevision } from '../../projections/shared/revision-compatibility';
import type { AdministrationEnvelope, AdministrationWriteFence, JsonObject } from '../contracts';
import type { AdministrationSourceMapping } from '../source-mapping';
import { normalizeAdministrationObservation } from '../normalize';

/** A current read selects its accepted head; explicit receipt reads may return
 * incomplete observed evidence. Neither borrows another resource or mapping. */
export const DRAFT_SELECTIONS_SQL = `/* league-administration:read-draft-selections */
  SELECT scope.identity,head.accepted_id AS head_accepted_id,head.generation AS head_generation,
    accepted.id AS acceptance_id,accepted.generation,accepted.source_mapping_revision_id,accepted.accepted_at,
    receipt.id AS receipt_id,receipt.attempt_id,receipt.provenance,receipt.coverage,receipt.legacy_observation_id,
    receipt.configuration_content_id,receipt.population_evidence,receipt.expected_team_count,
    attempt.id AS reserved_attempt_id,attempt.ordinal,attempt.expected_generation,attempt.source_mapping,
    CASE WHEN receipt.provenance ? 'acquisition' THEN COALESCE(
      receipt.provenance->'acquisition'->'fence'=attempt.write_fence
      AND receipt.provenance->'acquisition'->'mapping'=attempt.source_mapping
      AND receipt.provenance->'acquisition'->'attempts'=jsonb_build_object('draftSelections',
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
    (SELECT COALESCE(jsonb_agg(to_jsonb(entry) ORDER BY entry.source_ordinal),'[]'::jsonb)
      FROM public.league_draft_selection_catalog_entries entry WHERE entry.content_id=content.id) AS entries,
    (SELECT COALESCE(jsonb_agg(to_jsonb(fact)||jsonb_build_object(
        'native_fields',fact.native_fields #- '{pickNumber,value}' #- '{round,value}' #- '{draftSlot,value}'
          #- '{playerId,value}' #- '{rosterId,value}' #- '{pickedBy,value}' #- '{isKeeper,value}',
        'canonical_draft_league_season_id',draft.league_season_id,'canonical_draft_provider',draft.provider,
        'canonical_draft_external_league_id',draft.external_league_id,'canonical_draft_external_id',draft.external_draft_id,
        'canonical_selection_draft_id',pick.draft_id,'canonical_pick_number',pick.native_pick_number,
        'canonical_team_league_season_id',team.league_season_id,'canonical_team_provider',team.provider,
        'canonical_team_external_league_id',team.external_league_id,'canonical_team_external_roster_id',team.external_roster_id)
        ORDER BY fact.source_ordinal),'[]'::jsonb)
      FROM public.league_draft_selection_entries fact
      JOIN public.league_season_drafts draft ON draft.id=fact.draft_id
      LEFT JOIN public.league_draft_selections pick ON pick.id=fact.selection_id
      LEFT JOIN public.league_season_teams team ON team.id=fact.season_team_id
      WHERE fact.content_id=content.id) AS facts,
    to_jsonb(links.*) AS link_header,
    (SELECT COALESCE(jsonb_agg(to_jsonb(link) ORDER BY link.source_ordinal),'[]'::jsonb)
      FROM public.league_draft_selection_player_links link WHERE link.selection_acceptance_id=accepted.id) AS player_links,
    directory.id AS directory_id, directory.content_id AS directory_content_id
  FROM public.league_roster_resource_scopes scope
  JOIN public.league_roster_resource_heads head ON head.scope_id=scope.id
  JOIN public.league_roster_resource_attempts attempt ON attempt.scope_id=scope.id
  JOIN public.league_roster_capture_receipts receipt ON receipt.attempt_id=attempt.id
  LEFT JOIN public.league_roster_resource_acceptances accepted ON accepted.receipt_id=receipt.id AND accepted.scope_id=scope.id
  JOIN public.league_administration_contents content ON content.id=receipt.content_id
  JOIN public.league_administration_observations observation ON observation.id=receipt.legacy_observation_id
  LEFT JOIN public.league_draft_selection_contents header ON header.content_id=content.id
  LEFT JOIN public.league_roster_capture_receipts first_receipt ON first_receipt.id=header.first_receipt_id
  LEFT JOIN public.league_draft_selection_link_receipts links ON links.selection_acceptance_id=accepted.id
  LEFT JOIN public.league_player_directory_versions directory ON directory.id=links.directory_version_id
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
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid draft selections object.');
  return value as Record<string, unknown>;
}
const same = (left: unknown, right: unknown) => left === undefined || right === undefined
  ? left === right : compatibleRevision(left) === compatibleRevision(right);
function uuid(value: unknown): string {
  if (typeof value !== 'string' || !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/iu.test(value)) throw new Error('Invalid draft selections identity.');
  return value;
}
function integer(value: unknown, minimum = 0): number {
  const parsed = typeof value === 'number' || typeof value === 'string' && /^\d+$/u.test(value) ? Number(value) : NaN;
  if (!Number.isSafeInteger(parsed) || parsed < minimum) throw new Error('Invalid draft selections integer.');
  return parsed;
}
function timestamp(value: unknown): string {
  const parsed = value instanceof Date ? value : typeof value === 'string' ? new Date(value) : new Date(NaN);
  if (!Number.isFinite(parsed.getTime())) throw new Error('Invalid draft selections time.');
  return parsed.toISOString();
}
/** Match the established roster-link reader: frozen PostgreSQL proof instants
 * retain microseconds and their original spelling, including offset notation. */
function proofTimestamp(value: unknown): string {
  if (typeof value !== 'string') throw new Error('Invalid draft link proof timestamp.');
  instantMicros(value); return value;
}
function instantMicros(value: string): bigint {
  const match = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2}:\d{2})(?:\.(\d{1,6}))?(Z|[+-]\d{2}(?::\d{2})?)$/u.exec(value);
  if (!match) throw new Error('Invalid precise draft link timestamp.');
  const local = `${match[1]}T${match[2]}`, localEpoch = Date.parse(`${local}.000Z`);
  const zone = match[4].length === 3 ? `${match[4]}:00` : match[4], epoch = Date.parse(`${local}.000${zone}`);
  if (!Number.isFinite(epoch) || !Number.isFinite(localEpoch) || new Date(localEpoch).toISOString().slice(0, 19) !== local) throw new Error('Invalid precise draft link calendar instant.');
  return BigInt(epoch) * 1_000n + BigInt((match[3] ?? '').padEnd(6, '0'));
}
function rows(value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value)) throw new Error('Invalid draft selections relational rows.');
  return value.map(object);
}
const unavailable = (): DraftSelectionsRead => ({ status: 'unavailable', reason: 'draft_selections_evidence_unavailable' });
export function draftSelectionsCoverage(projection: DraftSelectionsProjection): JsonObject {
  const covered = projection.status === 'accepted' && projection.value.complete;
  return { periodIds: [], interval: null, entitySet: covered ? 'full' : 'unknown',
    fields: ['draft_id', 'pick_no', 'round', 'draft_slot', 'player_id', 'roster_id', 'picked_by', 'is_keeper', 'metadata'],
    pagination: covered ? 'complete' : 'unknown', nextCursor: null, completeness: covered ? 'complete' : 'partial',
    reasons: covered ? [] : ['draft_selections_incomplete'] };
}

/** Reconstruct from relational columns. Raw projection only supplies the parity
 * check; it cannot fill absent typed facts, links or canonical identities. */
function relationalValue(row: DatabaseRow, mapping: AdministrationSourceMapping, projected: DraftSelectionsValue): DraftSelectionsValue {
  const contentId = uuid(row.content_id), header = object(row.value_header), entries = rows(row.entries), facts = rows(row.facts);
  if (header.content_id !== contentId || header.value_version !== DRAFT_SELECTIONS_VERSION || row.first_receipt_content_id !== contentId
    || header.kind !== projected.kind || header.complete !== projected.complete) throw new Error('Invalid draft selection typed header.');
  uuid(header.first_receipt_id);
  if (projected.kind === 'catalog') {
    if (facts.length || header.external_draft_id !== null || header.picks_state !== null) throw new Error('Invalid catalog facts.');
    return { kind: 'catalog', season: 2026, complete: header.complete as boolean,
      totalCount: header.total_count === null ? null : integer(header.total_count), validIdentityCount: integer(header.valid_identity_count),
      invalidIdentityCount: integer(header.invalid_identity_count), attemptedSelectionCount: integer(header.attempted_selection_count),
      succeededSelectionCount: integer(header.succeeded_selection_count), failedSelectionCount: integer(header.failed_selection_count),
      unrequestedSelectionCount: integer(header.unrequested_selection_count), reason: header.reason as string | null,
      entries: entries.map((entry, index) => {
        if (entry.content_id !== contentId || integer(entry.source_ordinal) !== index) throw new Error('Invalid catalog order.');
        return { sourceOrdinal: index, identityState: entry.identity_state, externalDraftId: entry.external_draft_id, selectionState: entry.selection_state };
      }) as DraftSelectionsValue['entries'], tradedPicks: 'not-requested' } as DraftSelectionsValue;
  }
  if (entries.length || header.external_draft_id !== projected.externalDraftId || facts.length !== projected.entries.length
    || ['valid_identity_count','invalid_identity_count','attempted_selection_count','succeeded_selection_count','failed_selection_count','unrequested_selection_count'].some(key => integer(header[key]) !== 0)) throw new Error('Invalid selection header.');
  const identities = new Map<number, string>();
  const typed = facts.map((fact, index) => {
    const native = object(fact.native_fields), draftId = uuid(fact.draft_id);
    if (fact.content_id !== contentId || integer(fact.source_ordinal) !== index || fact.external_draft_id !== projected.externalDraftId
      || fact.canonical_draft_league_season_id !== mapping.leagueSeasonId || fact.canonical_draft_provider !== mapping.scope.provider
      || fact.canonical_draft_external_league_id !== mapping.scope.externalLeagueId || fact.canonical_draft_external_id !== projected.externalDraftId) throw new Error('Invalid draft selection identity.');
    if (fact.identity_state === 'valid') {
      const selectionId = uuid(fact.selection_id), pickNumber = integer(fact.pick_number, 1);
      if (fact.canonical_selection_draft_id !== draftId || integer(fact.canonical_pick_number, 1) !== pickNumber
        || identities.has(pickNumber) || [...identities.values()].includes(selectionId)) throw new Error('Conflicting stable selection identity.');
      identities.set(pickNumber, selectionId);
    } else if (fact.selection_id !== null || fact.canonical_selection_draft_id !== null || fact.canonical_pick_number !== null) throw new Error('Invalid selection gained canonical identity.');
    if (fact.season_team_id !== null) {
      uuid(fact.season_team_id);
      if (fact.identity_state !== 'valid' || fact.canonical_team_league_season_id !== mapping.leagueSeasonId || fact.canonical_team_provider !== mapping.scope.provider
        || fact.canonical_team_external_league_id !== mapping.scope.externalLeagueId || fact.canonical_team_external_roster_id !== fact.external_roster_id) throw new Error('Foreign native roster link.');
    } else if (fact.identity_state === 'valid' && fact.external_roster_id !== null
      || [fact.canonical_team_league_season_id, fact.canonical_team_provider, fact.canonical_team_external_league_id, fact.canonical_team_external_roster_id]
        .some(value => value !== null)) throw new Error('Invalid supplied native roster identity.');
    const field = (name: string, value: unknown) => ({ ...object(native[name]), value });
    const number = (value: unknown) => value === null ? null : integer(value, 1);
    return { ...native, sourceOrdinal: index, identityState: fact.identity_state, externalDraftId: fact.external_draft_id,
      pickNumber: field('pickNumber', number(fact.pick_number)), round: field('round', number(fact.round_value)),
      draftSlot: field('draftSlot', number(fact.draft_slot)), playerId: field('playerId', fact.player_id),
      rosterId: field('rosterId', fact.external_roster_id), pickedBy: field('pickedBy', fact.picked_by),
      isKeeper: field('isKeeper', fact.is_keeper), metadata: fact.metadata, extensions: fact.extensions, raw: fact.raw } as DraftSelectionFacts;
  });
  return { kind: 'selections', season: 2026, externalDraftId: String(header.external_draft_id), complete: header.complete as boolean,
    picksState: header.picks_state as DraftSelectionFacts['pickNumber']['state'], totalCount: header.total_count === null ? null : integer(header.total_count),
    entries: typed, reason: header.reason as string | null, tradedPicks: 'not-requested' };
}

function playerLinks(row: DatabaseRow, mapping: AdministrationSourceMapping, value: DraftSelectionsValue | null, acceptanceId: string | null): DraftSelectionPlayerLinks | null {
  const links = rows(row.player_links);
  if (value?.kind !== 'selections' || !acceptanceId) {
    if (row.link_header !== null || links.length) throw new Error('Unexpected draft player links.');
    return null;
  }
  const header = object(row.link_header);
  if (header.selection_acceptance_id !== acceptanceId || header.selection_receipt_id !== row.receipt_id
    || header.league_season_id !== mapping.leagueSeasonId || header.source_mapping_revision_id !== mapping.revisionId
    || header.selection_content_id !== row.content_id || header.link_version !== 'sleeper-draft-selection-player-links-v1'
    || !['complete','partial','capacity_exceeded','owner_unqualified'].includes(String(header.outcome))
    || !Array.isArray(header.reasons) || header.reasons.some(reason => typeof reason !== 'string')) throw new Error('Invalid draft player link lineage.');
  const directoryVersionId = header.directory_version_id === null ? null : uuid(header.directory_version_id);
  if (directoryVersionId !== row.directory_id || directoryVersionId !== null && !row.directory_content_id) throw new Error('Missing frozen directory evidence.');
  const count = integer(header.selection_count), resolved = integer(header.resolved_count), unresolved = integer(header.unresolved_count), conflict = integer(header.conflict_count);
  const resolvedAt = proofTimestamp(header.resolved_at), mappingEvaluatedAt = proofTimestamp(header.mapping_evaluated_at);
  if (instantMicros(mappingEvaluatedAt) > instantMicros(resolvedAt)) throw new Error('Invalid frozen draft link clock order.');
  const unqualified = ['capacity_exceeded','owner_unqualified'].includes(String(header.outcome));
  if (count !== value.entries.length || resolved + unresolved + conflict !== count
    || (unqualified ? links.length !== 0 || unresolved !== count : links.length !== count)
    || header.outcome === 'complete' && (resolved !== count || header.reasons.length !== 0)
    || header.outcome === 'partial' && unresolved + conflict === 0) throw new Error('Invalid draft link counts.');
  const facts = rows(row.facts);
  const result = links.map((link, index) => {
    const ordinal = integer(link.source_ordinal), native = value.entries[ordinal], fact = facts[ordinal];
    if (ordinal !== index || !native || !fact || link.selection_acceptance_id !== acceptanceId || link.selection_id !== fact.selection_id
      || link.native_player_id !== native.playerId.value || !['resolved','unresolved','conflict'].includes(String(link.identity_state))
      || !['valid','invalid','conflict','missing'].includes(String(link.directory_identity_status)) || !Array.isArray(link.reasons)
      || link.reasons.some(reason => typeof reason !== 'string') || !Array.isArray(link.mapping_proof)) throw new Error('Invalid draft player association.');
    const canonicalEntityId = link.canonical_entity_id === null ? null : uuid(link.canonical_entity_id);
    const proof = rows(link.mapping_proof);
    for (const entry of proof) {
      uuid(entry.scoringEntityId); const from = proofTimestamp(entry.validFrom);
      if (entry.validTo !== null && instantMicros(proofTimestamp(entry.validTo)) <= instantMicros(from)) throw new Error('Invalid frozen draft mapping interval.');
      if (entry.provider !== 'sleeper' || entry.externalId !== native.playerId.value || !['player','team_defense'].includes(String(entry.entityKind))
        || !['verified','unverified','retired'].includes(String(entry.mappingStatus)) || !['player','team_defense'].includes(String(entry.canonicalKind))) throw new Error('Invalid immutable draft mapping proof.');
    }
    if (link.identity_state === 'resolved') {
      const kind = object(link.kind_evidence);
      if (kind.position !== null && typeof kind.position !== 'string' || kind.fantasyPositions !== null
        && (!Array.isArray(kind.fantasyPositions) || kind.fantasyPositions.some(position => typeof position !== 'string'))
        || !['missing','null','invalid','supplied'].includes(String(kind.positionState))
        || !['missing','null','invalid','supplied'].includes(String(kind.fantasyPositionsState))
        || rosterPlayerKind(kind as Parameters<typeof rosterPlayerKind>[0]).entityKind !== link.entity_kind) throw new Error('Invalid frozen draft player kind.');
      if (!canonicalEntityId || !directoryVersionId || link.directory_identity_status !== 'valid' || !link.kind_evidence
        || !['player','team_defense'].includes(String(link.entity_kind)) || proof.length !== 1 || proof[0].scoringEntityId !== canonicalEntityId
        || proof[0].entityKind !== link.entity_kind || proof[0].canonicalKind !== link.entity_kind || proof[0].mappingStatus !== 'verified' || link.reasons.length !== 0
        || instantMicros(proofTimestamp(proof[0].validFrom)) > instantMicros(mappingEvaluatedAt)
        || proof[0].validTo !== null && instantMicros(proofTimestamp(proof[0].validTo)) <= instantMicros(mappingEvaluatedAt)) throw new Error('Invalid resolved draft identity.');
    } else if (canonicalEntityId !== null) throw new Error('Unresolved draft link has canonical identity.');
    return { sourceOrdinal: ordinal, selectionId: uuid(link.selection_id), nativePlayerId: link.native_player_id,
      entityKind: link.entity_kind, identityState: link.identity_state, reasons: link.reasons,
      directoryIdentityStatus: link.directory_identity_status, kindEvidence: link.kind_evidence,
      canonicalEntityId, mappingProof: link.mapping_proof };
  });
  if (!unqualified && (result.filter(link => link.identityState === 'resolved').length !== resolved || result.filter(link => link.identityState === 'unresolved').length !== unresolved
    || result.filter(link => link.identityState === 'conflict').length !== conflict)) throw new Error('Invalid draft link outcome counts.');
  return { version: 'sleeper-draft-selection-player-links-v1', directoryVersionId, resolvedAt,
    mappingEvaluatedAt, outcome: header.outcome, reasons: header.reasons,
    counts: { selections: count, resolved, unresolved, conflict }, links: result } as DraftSelectionPlayerLinks;
}

export function readDraftSelectionsRows(result: readonly DatabaseRow[], mapping: AdministrationSourceMapping,
  selection: DraftSelectionsSelection): DraftSelectionsRead {
  try {
    const scope = draftSelectionsScope(mapping, selection);
    if (selection.receiptId !== undefined) uuid(selection.receiptId);
    if (!result.length) return { status: 'missing', reason: 'draft_selections_capture_missing' };
    if (result.length !== 1 || Buffer.byteLength(JSON.stringify(result[0]), 'utf8') > DRAFT_SELECTIONS_LIMITS.persistedBytes) throw new Error('Invalid draft selections result bounds.');
    const row = result[0], contentId = uuid(row.content_id), receiptId = uuid(row.receipt_id), attemptId = uuid(row.attempt_id);
    uuid(row.legacy_observation_id); integer(row.ordinal, 1); integer(row.expected_generation);
    const provenance = object(row.provenance) as AdministrationEnvelope['provenance'];
    if (!same(row.identity, { scope, policy: DRAFT_SELECTIONS_POLICY }) || !same(row.source_mapping, mapping)
      || row.reserved_attempt_id !== attemptId || row.league_season_id !== mapping.leagueSeasonId || row.provider !== mapping.scope.provider
      || row.external_league_id !== mapping.scope.externalLeagueId || row.family !== 'drafts' || Number(row.week) !== 0
      || row.normalizer_version !== 'sleeper-administration-v1' || !['complete', 'partial'].includes(String(row.completeness))
      || row.observation_content_id !== contentId || row.observation_league_season_id !== mapping.leagueSeasonId
      || row.configuration_content_id !== null || row.population_evidence !== null || row.expected_team_count !== null
      || row.capture_after_reservation !== true || provenance.origin !== 'network'
      || selection.receiptId !== undefined && selection.receiptId !== receiptId) throw new Error('Invalid draft selections receipt lineage.');
    const started = timestamp(provenance.requestStartedAt), completed = timestamp(provenance.requestCompletedAt), checked = timestamp(provenance.checkedAt);
    if (started > completed || completed > checked || provenance.sourceObservedAt !== null
      && (timestamp(provenance.sourceObservedAt) < started || timestamp(provenance.sourceObservedAt) > completed)) throw new Error('Invalid draft source clocks.');
    const normalized = normalizeAdministrationObservation({ schemaVersion: 'league-administration-v1', normalizerVersion: 'sleeper-administration-v1',
      dialect: 'sleeper-nfl-v1', scope: mapping.scope, family: 'drafts', week: null, completeness: row.completeness as 'complete' | 'partial',
      provenance, payload: row.payload as AdministrationEnvelope['payload'] });
    if (normalized.contentHash !== row.content_hash || normalized.semanticHash !== row.semantic_hash || !same(normalized.value, row.normalized_value)
      || row.content_accepted !== (normalized.status === 'accepted' && row.completeness === 'complete')) throw new Error('Invalid draft native normalization.');
    const projected = projectDraftSelections(normalized);
    if (!same(row.coverage, draftSelectionsCoverage(projected))) throw new Error('Invalid draft selections coverage.');
    const payload = object(row.payload);
    if (payload.kind !== selection.kind || selection.kind === 'selections' && payload.externalDraftId !== selection.externalDraftId) throw new Error('Wrong draft selections resource.');
    let value: DraftSelectionsValue | null = null;
    if (projected.status === 'accepted') {
      value = relationalValue(row, mapping, projected.value);
      if (!same(value, projected.value)) throw new Error('Draft typed native parity mismatch.');
    } else if (row.value_header !== null || (rows(row.entries).length || rows(row.facts).length)) throw new Error('Rejected draft selections has typed facts.');
    let acceptanceId: string | null = null, acceptedGeneration: number | null = null, acceptedAt: string | null = null;
    if (row.acceptance_id !== null) {
      acceptanceId = uuid(row.acceptance_id); acceptedGeneration = integer(row.generation, 1); acceptedAt = timestamp(row.accepted_at);
      if (row.source_mapping_revision_id !== mapping.revisionId || acceptedGeneration !== integer(row.expected_generation) + 1
        || projected.status !== 'accepted' || !projected.value.complete || !provenance.sourceObservedAt
        || selection.receiptId === undefined && (row.head_accepted_id !== acceptanceId || integer(row.head_generation) !== acceptedGeneration)) throw new Error('Invalid draft acceptance.');
    } else if (selection.receiptId === undefined || row.generation !== null || row.source_mapping_revision_id !== null || row.accepted_at !== null) throw new Error('Unaccepted current draft selections.');
    return { status: acceptanceId ? 'available' : 'observed', version: DRAFT_SELECTIONS_VERSION,
      selection: selection.receiptId === undefined ? 'current' : 'receipt', contentId, receiptId, acceptanceId, acceptedGeneration, acceptedAt,
      sourceMappingRevisionId: mapping.revisionId, provenance, coverage: row.coverage as JsonObject, value, playerLinks: playerLinks(row, mapping, value, acceptanceId) };
  } catch { return unavailable(); }
}

export function draftSelectionsMethods(client: DatabaseClient) {
  return {
    async beginDraftSelectionsAttempt(mapping: AdministrationSourceMapping, resource: DraftSelectionsResource, id: string,
      fence?: AdministrationWriteFence): Promise<RosterAttempt> {
      draftSelectionsScope(mapping, resource); uuid(id);
      const selected = resource.kind === 'catalog' ? { kind: 'catalog' } : { kind: 'selections', externalDraftId: resource.externalDraftId };
      const result = await client.query(`/* league-administration:begin-draft-selections-attempt */
        SELECT public.begin_draft_selections_attempt($1::jsonb,$2::jsonb,$3::uuid,$4::jsonb) AS result`,
      [JSON.stringify(mapping), JSON.stringify(selected), id, fence ? JSON.stringify(fence) : null]);
      const row = object(result.length === 1 ? result[0].result : null);
      if (row.id !== id) throw new Error('Invalid draft selections reservation.');
      return { id, scopeId: uuid(row.scopeId), ordinal: integer(row.ordinal, 1), expectedGeneration: integer(row.expectedGeneration) };
    },
    async readDraftSelections(mapping: AdministrationSourceMapping, selection: DraftSelectionsSelection): Promise<DraftSelectionsRead> {
      try {
        const scope = draftSelectionsScope(mapping, selection);
        if (selection.receiptId !== undefined) uuid(selection.receiptId);
        const result = await client.query(DRAFT_SELECTIONS_SQL, [JSON.stringify({ scope, policy: DRAFT_SELECTIONS_POLICY }),
          mapping.revisionId, mapping.generation, selection.receiptId ?? null]);
        return readDraftSelectionsRows(result, mapping, selection);
      } catch { return unavailable(); }
    },
  };
}
