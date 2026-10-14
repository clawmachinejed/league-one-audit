import 'server-only';
import type { DatabaseClient, DatabaseRow } from '../../database';
import { TRADED_PICKS_VERSION, TRADED_PICKS_POLICY, TRADED_PICKS_LIMITS, tradedPicksScope, projectTradedPicks, tradedPickInstantMicros,
  type TradedPickFacts, type TradedPicksProjection, type TradedPicksRead, type TradedPicksResource,
  type TradedPicksSelection, type TradedPicksValue } from '../../aggregator/traded-picks';
import type { RosterAttempt } from '../../aggregator/current-roster';
import { compatibleRevision } from '../../projections/shared/revision-compatibility';
import type { AdministrationEnvelope, AdministrationWriteFence, JsonObject } from '../contracts';
import type { AdministrationSourceMapping } from '../source-mapping';
import { normalizeAdministrationObservation } from '../normalize';

/** A current read selects its accepted head; explicit receipt reads may return
 * incomplete observed evidence. Neither borrows another resource or mapping. */
export const TRADED_PICKS_SQL = `/* league-administration:read-traded-picks */
  SELECT scope.identity,head.accepted_id AS head_accepted_id,head.generation AS head_generation,
    accepted.id AS acceptance_id,accepted.generation,accepted.source_mapping_revision_id,accepted.accepted_at,
    receipt.id AS receipt_id,receipt.attempt_id,receipt.provenance,receipt.coverage,receipt.legacy_observation_id,
    receipt.configuration_content_id,receipt.population_evidence,receipt.expected_team_count,
    attempt.id AS reserved_attempt_id,attempt.ordinal,attempt.expected_generation,attempt.source_mapping,
    COALESCE((receipt.provenance->>'requestStartedAt')::timestamptz>=attempt.reserved_at,false) AS capture_after_reservation,
    content.id AS content_id,content.content_hash,content.semantic_hash,content.payload,content.normalized_value,
    content.normalizer_version,content.completeness,content.accepted AS content_accepted,
    content.league_season_id,content.provider,content.external_league_id,content.family,content.week,
    observation.content_id AS observation_content_id,observation.league_season_id AS observation_league_season_id,
    to_jsonb(header.*) AS value_header,first_receipt.content_id AS first_receipt_content_id,
    (SELECT COALESCE(jsonb_agg(to_jsonb(entry) ORDER BY entry.source_ordinal),'[]'::jsonb)
      FROM public.league_traded_pick_catalog_entries entry WHERE entry.content_id=content.id) AS entries,
    (SELECT COALESCE(jsonb_agg(to_jsonb(fact)||jsonb_build_object(
        'asset_scope_valid',asset.league_season_id=content.league_season_id AND asset.provider=content.provider
          AND asset.external_league_id=content.external_league_id AND asset.endpoint_key=scope.identity->'scope'->>'entityId'
          AND asset.pick_season=fact.pick_season AND asset.round_value=fact.round_value AND asset.original_roster_id=fact.original_roster_id
          AND ((header.kind='league' AND asset.draft_id IS NULL) OR (header.kind='draft' AND draft.league_season_id=content.league_season_id
            AND draft.provider=content.provider AND draft.external_league_id=content.external_league_id AND draft.external_draft_id=header.external_draft_id)),
        'owner_scope_valid',team.league_season_id=content.league_season_id AND team.provider=content.provider
          AND team.external_league_id=content.external_league_id AND team.external_roster_id=fact.current_owner_id)
        ORDER BY fact.source_ordinal),'[]'::jsonb)
      FROM public.league_traded_pick_entries fact LEFT JOIN public.league_traded_pick_assets asset ON asset.id=fact.asset_id
      LEFT JOIN public.league_season_drafts draft ON draft.id=asset.draft_id
      LEFT JOIN public.league_season_teams team ON team.id=fact.owner_team_id WHERE fact.content_id=content.id) AS facts
  FROM public.league_roster_resource_scopes scope
  JOIN public.league_roster_resource_heads head ON head.scope_id=scope.id
  JOIN public.league_roster_resource_attempts attempt ON attempt.scope_id=scope.id
  JOIN public.league_roster_capture_receipts receipt ON receipt.attempt_id=attempt.id
  LEFT JOIN public.league_roster_resource_acceptances accepted ON accepted.receipt_id=receipt.id AND accepted.scope_id=scope.id
  JOIN public.league_administration_contents content ON content.id=receipt.content_id
  JOIN public.league_administration_observations observation ON observation.id=receipt.legacy_observation_id
  LEFT JOIN public.league_traded_pick_contents header ON header.content_id=content.id
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
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid traded picks object.');
  return value as Record<string, unknown>;
}
const same = (left: unknown, right: unknown) => left === undefined || right === undefined
  ? left === right : compatibleRevision(left) === compatibleRevision(right);
function uuid(value: unknown): string {
  if (typeof value !== 'string' || !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/iu.test(value)) throw new Error('Invalid traded picks identity.');
  return value;
}
function integer(value: unknown, minimum = 0): number {
  const parsed = typeof value === 'number' || typeof value === 'string' && /^\d+$/u.test(value) ? Number(value) : NaN;
  if (!Number.isSafeInteger(parsed) || parsed < minimum) throw new Error('Invalid traded picks integer.');
  return parsed;
}
function timestamp(value: unknown): string {
  const parsed = value instanceof Date ? value : typeof value === 'string' ? new Date(value) : new Date(NaN);
  if (!Number.isFinite(parsed.getTime())) throw new Error('Invalid traded picks time.');
  return parsed.toISOString();
}
function rows(value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value)) throw new Error('Invalid traded picks relational rows.');
  return value.map(object);
}
const unavailable = (): TradedPicksRead => ({ status: 'unavailable', reason: 'traded_picks_evidence_unavailable' });
export function tradedPicksCoverage(projection: TradedPicksProjection): JsonObject {
  const covered = projection.status === 'accepted' && projection.value.complete;
  return { periodIds: [], interval: null, entitySet: covered ? 'full' : 'unknown',
    fields: ['season', 'round', 'roster_id', 'owner_id', 'previous_owner_id'],
    pagination: covered ? 'complete' : 'unknown', nextCursor: null, completeness: covered ? 'complete' : 'partial',
    reasons: covered ? [] : ['traded_picks_incomplete'] };
}

/** Reconstruct from relational columns. Raw projection only supplies the parity
 * check; it cannot fill absent typed facts, links or canonical identities. */
function relationalValue(row: DatabaseRow, projected: TradedPicksValue): TradedPicksValue {
  const contentId = uuid(row.content_id), header = object(row.value_header), entries = rows(row.entries), facts = rows(row.facts);
  if (header.content_id !== contentId || header.value_version !== TRADED_PICKS_VERSION || row.first_receipt_content_id !== contentId
    || header.kind !== projected.kind || header.complete !== projected.complete) throw new Error('Invalid traded picks typed header.');
  uuid(header.first_receipt_id);
  if (projected.kind === 'catalog') {
    if (facts.length || header.external_draft_id !== null || header.trades_state !== null || entries.length !== projected.entries.length) throw new Error('Invalid trade inventory.');
    return { kind: 'catalog', season: 2026, complete: header.complete as boolean, totalCount: header.total_count === null ? null : integer(header.total_count),
      validIdentityCount: integer(header.valid_identity_count), invalidIdentityCount: integer(header.invalid_identity_count),
      attemptedTradeCount: integer(header.attempted_trade_count), succeededTradeCount: integer(header.succeeded_trade_count),
      failedTradeCount: integer(header.failed_trade_count), unrequestedTradeCount: integer(header.unrequested_trade_count), reason: header.reason as string | null,
      entries: entries.map((entry, index) => {
        if (entry.content_id !== contentId || integer(entry.source_ordinal) !== index) throw new Error('Invalid traded catalog order.');
        return { sourceOrdinal: index, identityState: entry.identity_state, externalDraftId: entry.external_draft_id, tradeState: entry.trade_state };
      }) as TradedPicksValue['entries'] } as TradedPicksValue;
  }
  if (entries.length || facts.length !== projected.entries.length || header.external_draft_id !== projected.externalDraftId
    || ['valid_identity_count','invalid_identity_count','attempted_trade_count','succeeded_trade_count','failed_trade_count','unrequested_trade_count']
      .some(key => integer(header[key]) !== 0)) throw new Error('Invalid traded facts inventory.');
  const assets = new Map<string, string>(), reverse = new Map<string, string>();
  const typed = facts.map((fact, index) => {
    if (fact.content_id !== contentId || integer(fact.source_ordinal) !== index) throw new Error('Invalid traded fact order.');
    if (fact.identity_state === 'valid') {
      const id = uuid(fact.asset_id), key = JSON.stringify([fact.pick_season, fact.round_value, fact.original_roster_id]);
      if (fact.asset_scope_valid !== true || assets.has(key) && assets.get(key) !== id || reverse.has(id) && reverse.get(id) !== key) throw new Error('Invalid canonical traded asset.');
      assets.set(key,id); reverse.set(id,key);
    } else if (fact.asset_id !== null || fact.asset_scope_valid !== null) throw new Error('Invalid diagnostic asset binding.');
    if (fact.ownership_state === 'resolved') { uuid(fact.owner_team_id); if (fact.owner_scope_valid !== true) throw new Error('Invalid canonical traded owner.'); }
    else if (fact.owner_team_id !== null || fact.owner_scope_valid !== null) throw new Error('Ambiguous owner cannot bind a canonical team.');
    const native = object(fact.native_fields);
    return { ...native, sourceOrdinal: index, identityState: fact.identity_state,
      pickSeason: { ...object(native.pickSeason), value: fact.pick_season },
      round: { ...object(native.round), value: fact.round_value === null ? null : integer(fact.round_value,1) },
      originalRosterId: { ...object(native.originalRosterId), value: fact.original_roster_id },
      ownerId: { ...object(native.ownerId), value: fact.owner_id }, previousOwnerId: { ...object(native.previousOwnerId), value: fact.previous_owner_id },
      ownershipState: fact.ownership_state, currentOwnerId: fact.current_owner_id, previousOwnerState: fact.previous_owner_state,
      evidencedPreviousOwnerId: fact.evidenced_previous_owner_id, extensions: fact.extensions, raw: fact.raw } as TradedPickFacts;
  });
  return { kind: projected.kind, season: 2026, externalDraftId: header.external_draft_id as string | null, complete: header.complete as boolean,
    tradesState: header.trades_state as TradedPickFacts['ownerId']['state'], totalCount: header.total_count === null ? null : integer(header.total_count),
    entries: typed, reason: header.reason as string | null };
}

export function readTradedPicksRows(result: readonly DatabaseRow[], mapping: AdministrationSourceMapping,
  selection: TradedPicksSelection): TradedPicksRead {
  try {
    const scope = tradedPicksScope(mapping, selection);
    if (selection.receiptId !== undefined) uuid(selection.receiptId);
    if (!result.length) return { status: 'missing', reason: 'traded_picks_capture_missing' };
    if (result.length !== 1 || Buffer.byteLength(JSON.stringify(result[0]), 'utf8') > TRADED_PICKS_LIMITS.persistedBytes) throw new Error('Invalid traded picks result bounds.');
    const row = result[0], contentId = uuid(row.content_id), receiptId = uuid(row.receipt_id), attemptId = uuid(row.attempt_id);
    uuid(row.legacy_observation_id); integer(row.ordinal, 1); integer(row.expected_generation);
    const provenance = object(row.provenance) as AdministrationEnvelope['provenance'];
    if (!same(row.identity, { scope, policy: TRADED_PICKS_POLICY }) || !same(row.source_mapping, mapping)
      || row.reserved_attempt_id !== attemptId || row.league_season_id !== mapping.leagueSeasonId || row.provider !== mapping.scope.provider
      || row.external_league_id !== mapping.scope.externalLeagueId || row.family !== 'drafts' || Number(row.week) !== 0
      || row.normalizer_version !== 'sleeper-administration-v1' || !['complete', 'partial'].includes(String(row.completeness))
      || row.observation_content_id !== contentId || row.observation_league_season_id !== mapping.leagueSeasonId
      || row.configuration_content_id !== null || row.population_evidence !== null || row.expected_team_count !== null
      || row.capture_after_reservation !== true || provenance.origin !== 'network' || provenance.acquisition !== undefined
      || selection.receiptId !== undefined && selection.receiptId !== receiptId) throw new Error('Invalid traded picks receipt lineage.');
    const started = tradedPickInstantMicros(provenance.requestStartedAt!), completed = tradedPickInstantMicros(provenance.requestCompletedAt!), checked = tradedPickInstantMicros(provenance.checkedAt);
    if (started > completed || completed > checked || provenance.sourceObservedAt !== null
      && (tradedPickInstantMicros(provenance.sourceObservedAt) < started || tradedPickInstantMicros(provenance.sourceObservedAt) > completed)) throw new Error('Invalid traded pick source clocks.');
    const normalized = normalizeAdministrationObservation({ schemaVersion: 'league-administration-v1', normalizerVersion: 'sleeper-administration-v1',
      dialect: 'sleeper-nfl-v1', scope: mapping.scope, family: 'drafts', week: null, completeness: row.completeness as 'complete' | 'partial',
      provenance, payload: row.payload as AdministrationEnvelope['payload'] });
    if (normalized.contentHash !== row.content_hash || normalized.semanticHash !== row.semantic_hash || !same(normalized.value, row.normalized_value)
      || row.content_accepted !== (normalized.status === 'accepted' && row.completeness === 'complete')) throw new Error('Invalid draft native normalization.');
    const projected = projectTradedPicks(normalized);
    if (!same(row.coverage, tradedPicksCoverage(projected))) throw new Error('Invalid traded picks coverage.');
    const payload = object(row.payload);
    if (payload.kind !== selection.kind || selection.kind === 'draft' && payload.externalDraftId !== selection.externalDraftId) throw new Error('Wrong traded picks resource.');
    let value: TradedPicksValue | null = null;
    if (projected.status === 'accepted') {
      value = relationalValue(row, projected.value);
      if (!same(value, projected.value)) throw new Error('Draft typed native parity mismatch.');
    } else if (row.value_header !== null || (rows(row.entries).length || rows(row.facts).length)) throw new Error('Rejected traded picks has typed facts.');
    let acceptanceId: string | null = null, acceptedGeneration: number | null = null, acceptedAt: string | null = null;
    if (row.acceptance_id !== null) {
      acceptanceId = uuid(row.acceptance_id); acceptedGeneration = integer(row.generation, 1); acceptedAt = timestamp(row.accepted_at);
      if (row.source_mapping_revision_id !== mapping.revisionId || acceptedGeneration !== integer(row.expected_generation) + 1
        || projected.status !== 'accepted' || !projected.value.complete || !provenance.sourceObservedAt
        || selection.receiptId === undefined && (row.head_accepted_id !== acceptanceId || integer(row.head_generation) !== acceptedGeneration)) throw new Error('Invalid draft acceptance.');
    } else if (selection.receiptId === undefined || row.generation !== null || row.source_mapping_revision_id !== null || row.accepted_at !== null) throw new Error('Unaccepted current traded picks.');
    return { status: acceptanceId ? 'available' : 'observed', version: TRADED_PICKS_VERSION,
      selection: selection.receiptId === undefined ? 'current' : 'receipt', contentId, receiptId, acceptanceId, acceptedGeneration, acceptedAt,
      sourceMappingRevisionId: mapping.revisionId, provenance, coverage: row.coverage as JsonObject, value };
  } catch { return unavailable(); }
}

export function tradedPicksMethods(client: DatabaseClient) {
  return {
    async beginTradedPicksAttempt(mapping: AdministrationSourceMapping, resource: TradedPicksResource, id: string,
      fence?: AdministrationWriteFence): Promise<RosterAttempt> {
      tradedPicksScope(mapping, resource); uuid(id);
      const selected = resource.kind === 'draft' ? { kind: 'draft', externalDraftId: resource.externalDraftId } : { kind: resource.kind };
      const result = await client.query(`/* league-administration:begin-traded-picks-attempt */
        SELECT public.begin_traded_picks_attempt($1::jsonb,$2::jsonb,$3::uuid,$4::jsonb) AS result`,
      [JSON.stringify(mapping), JSON.stringify(selected), id, fence ? JSON.stringify(fence) : null]);
      const row = object(result.length === 1 ? result[0].result : null);
      if (row.id !== id) throw new Error('Invalid traded picks reservation.');
      return { id, scopeId: uuid(row.scopeId), ordinal: integer(row.ordinal, 1), expectedGeneration: integer(row.expectedGeneration) };
    },
    async readTradedPicks(mapping: AdministrationSourceMapping, selection: TradedPicksSelection): Promise<TradedPicksRead> {
      try {
        const scope = tradedPicksScope(mapping, selection);
        if (selection.receiptId !== undefined) uuid(selection.receiptId);
        const result = await client.query(TRADED_PICKS_SQL, [JSON.stringify({ scope, policy: TRADED_PICKS_POLICY }),
          mapping.revisionId, mapping.generation, selection.receiptId ?? null]);
        return readTradedPicksRows(result, mapping, selection);
      } catch { return unavailable(); }
    },
  };
}
