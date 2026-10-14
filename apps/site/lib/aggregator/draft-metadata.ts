import type { SourceScope } from './contracts';
import type { AdministrationEnvelope, JsonObject, JsonValue, NormalizedAdministrationObservation } from '../league-administration/contracts';
import type { AdministrationSourceMapping } from '../league-administration/source-mapping';
import { isAdministrationSourceMapping } from '../league-administration/source-mapping';
import { normalizeAdministrationObservation } from '../league-administration/normalize';
import { compatibleRevision } from '../projections/shared/revision-compatibility';
import { PUBLIC_CAPTURE_LIMITS } from '../sleeper-public-response';

export const DRAFT_METADATA_VERSION = 'sleeper-draft-metadata-v1' as const;
export const DRAFT_METADATA_POLICY = Object.freeze({ audienceId: 'public', coverageSpecId: DRAFT_METADATA_VERSION,
  canonicalNormalizerVersion: DRAFT_METADATA_VERSION, validationVersion: 'latest-network-attempt-v1' });
export const DRAFT_METADATA_LIMITS = Object.freeze({ drafts: 8, nativeBytes: 8 * 1024 * 1024,
  persistedBytes: 32 * 1024 * 1024, framingBytes: 64 * 1024 });
export type DraftMetadataResource = Readonly<{ kind: 'catalog' }> | Readonly<{ kind: 'detail'; externalDraftId: string }>;
export type DraftMetadataSelection = DraftMetadataResource & Readonly<{ receiptId?: string }>;
export type DraftField<T = JsonValue> = Readonly<{ state: 'missing' | 'null' | 'empty' | 'invalid' | 'supplied'; raw: JsonValue; value: T | null }>;
export type DraftMetadataFacts = Readonly<{
  externalDraftId: string; externalLeagueId: string; season: 2026;
  type: DraftField<string>; status: DraftField<string>; sport: DraftField<string>;
  settings: DraftField<JsonObject>; metadata: DraftField<JsonObject>;
  startTime: DraftField<number>; created: DraftField<number>; lastPicked: DraftField<number>;
  draftOrder: DraftField<JsonObject>; slotToRosterId: DraftField<JsonObject>;
  userSlots: readonly Readonly<{ externalUserId: string; slot: DraftField<number> }>[];
  slotRosters: readonly Readonly<{ slotKey: string; externalRosterId: DraftField<string> }>[];
  extensions: JsonObject;
}>;
export type DraftDetailState = 'succeeded' | 'failed' | 'unrequested';
export type DraftCatalogEntry = Readonly<{ sourceOrdinal: number; identityState: 'valid' | 'invalid';
  externalDraftId: string | null; metadata: DraftMetadataFacts | null; detailState: DraftDetailState }>;
export type DraftCatalogValue = Readonly<{ kind: 'catalog'; season: 2026; complete: boolean;
  totalCount: number | null; validIdentityCount: number; invalidIdentityCount: number;
  attemptedDetailCount: number; succeededDetailCount: number; failedDetailCount: number; unrequestedDetailCount: number;
  entries: readonly DraftCatalogEntry[]; reason: string | null; picks: 'not-requested'; tradedPicks: 'not-requested' }>;
export type DraftDetailValue = Readonly<{ kind: 'detail'; season: 2026; complete: true;
  externalDraftId: string; catalog: DraftMetadataFacts; detail: DraftMetadataFacts;
  picks: 'not-requested'; tradedPicks: 'not-requested' }>;
export type DraftMetadataValue = DraftCatalogValue | DraftDetailValue;
export type DraftMetadataProjection = Readonly<{ status: 'accepted'; version: typeof DRAFT_METADATA_VERSION;
  value: DraftMetadataValue; diagnostics: readonly [] }> | Readonly<{ status: 'rejected'; version: typeof DRAFT_METADATA_VERSION;
  value: null; diagnostics: readonly Readonly<{ code: string; path: string }>[] }>;
export type DraftMetadataRead = Readonly<{ status: 'available' | 'observed'; version: typeof DRAFT_METADATA_VERSION;
  selection: 'current' | 'receipt'; contentId: string; receiptId: string; acceptanceId: string | null;
  acceptedGeneration: number | null; acceptedAt: string | null; sourceMappingRevisionId: string;
  provenance: AdministrationEnvelope['provenance']; coverage: JsonObject; value: DraftMetadataValue | null }>
  | Readonly<{ status: 'missing' | 'unavailable' | 'disabled'; reason?: string }>;

export function validDraftId(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/u.test(value);
}
export function draftMetadataScope(mapping: AdministrationSourceMapping, resource: DraftMetadataResource): SourceScope {
  if (!isAdministrationSourceMapping(mapping) || mapping.scope.season !== 2026
    || resource.kind !== 'catalog' && (resource.kind !== 'detail' || !validDraftId(resource.externalDraftId))) {
    throw new Error('Invalid draft metadata scope.');
  }
  return { kind: 'enrolled-resource', connectionId: mapping.connectionId, leagueSeasonId: mapping.leagueSeasonId,
    family: 'drafts', entityId: resource.kind === 'catalog' ? 'catalog' : `draft:${resource.externalDraftId}`,
    scoringPeriodId: null, audienceId: 'public', coverageSpecId: DRAFT_METADATA_VERSION };
}
const object = (value: unknown): value is JsonObject => value !== null && typeof value === 'object' && !Array.isArray(value);
export function ownsDraft(value: unknown, leagueId: string, draftId?: string): value is JsonObject {
  return object(value) && validDraftId(value.draft_id) && (draftId === undefined || value.draft_id === draftId)
    && value.league_id === leagueId && value.season === '2026' && (value.sport === undefined || value.sport === 'nfl');
}
function field<T>(row: JsonObject, key: string, parse: (raw: JsonValue) => T | null): DraftField<T> {
  if (!Object.hasOwn(row, key)) return { state: 'missing', raw: null, value: null };
  const raw = row[key];
  if (raw === null) return { state: 'null', raw, value: null };
  const value = parse(raw);
  return { state: value === null ? 'invalid' : raw === '' || Array.isArray(raw) && raw.length === 0
    || object(raw) && Object.keys(raw).length === 0 ? 'empty' : 'supplied', raw, value };
}
const text = (raw: JsonValue) => typeof raw === 'string' ? raw : null;
const dictionary = (raw: JsonValue) => object(raw) ? raw : null;
const integer = (minimum: number) => (raw: JsonValue) => typeof raw === 'number' && Number.isSafeInteger(raw) && raw >= minimum ? raw : null;
const roster = (raw: JsonValue) => typeof raw === 'number' && Number.isSafeInteger(raw) && raw > 0 ? String(raw)
  : typeof raw === 'string' && /^[1-9][0-9]{0,31}$/u.test(raw) ? raw : null;
const nativeKeyOrder = (left: string, right: string) => Buffer.compare(Buffer.from(left), Buffer.from(right));
function facts(row: JsonObject): DraftMetadataFacts {
  const draftOrder = field(row, 'draft_order', dictionary), slotToRosterId = field(row, 'slot_to_roster_id', dictionary);
  return { externalDraftId: row.draft_id as string, externalLeagueId: row.league_id as string, season: 2026,
    type: field(row, 'type', text), status: field(row, 'status', text), sport: field(row, 'sport', text),
    settings: field(row, 'settings', dictionary), metadata: field(row, 'metadata', dictionary),
    startTime: field(row, 'start_time', integer(0)), created: field(row, 'created', integer(0)), lastPicked: field(row, 'last_picked', integer(0)),
    draftOrder, slotToRosterId,
    userSlots: draftOrder.value === null ? [] : Object.keys(draftOrder.value).sort(nativeKeyOrder).map(externalUserId => ({ externalUserId,
      slot: field(draftOrder.value!, externalUserId, integer(1)) })),
    slotRosters: slotToRosterId.value === null ? [] : Object.keys(slotToRosterId.value).sort(nativeKeyOrder).map(slotKey => ({ slotKey,
      externalRosterId: field(slotToRosterId.value!, slotKey, roster) })),
    extensions: Object.fromEntries(Object.entries(row).filter(([key]) => !['draft_id', 'league_id', 'season', 'type', 'status', 'sport',
      'settings', 'metadata', 'start_time', 'created', 'last_picked', 'draft_order', 'slot_to_roster_id'].includes(key))) };
}
function reject(code: string): DraftMetadataProjection {
  return { status: 'rejected', version: DRAFT_METADATA_VERSION, value: null, diagnostics: [{ code, path: 'payload' }] };
}
function boundedNative(value: JsonValue): boolean {
  const pending = [{ value, depth: 1 }];
  let values = 1;
  while (pending.length) {
    const current = pending.pop()!;
    if (current.value === null || typeof current.value !== 'object') continue;
    const children = Object.values(current.value);
    if (values + children.length > PUBLIC_CAPTURE_LIMITS.maxValues || children.length > 0 && current.depth >= PUBLIC_CAPTURE_LIMITS.maxDepth) return false;
    values += children.length;
    for (const child of children) pending.push({ value: child, depth: current.depth + 1 });
  }
  return true;
}

/** Independent metadata projection; legacy complete picks/trades acceptance is deliberately irrelevant. */
export function projectDraftMetadata(normalized: NormalizedAdministrationObservation): DraftMetadataProjection {
  try {
    const { envelope } = normalized, payload = envelope.payload;
    const provenance = envelope.provenance;
    const timestamp = (value: unknown) => typeof value === 'string' && Number.isFinite(Date.parse(value)) ? Date.parse(value) : NaN;
    const started = timestamp(provenance.requestStartedAt), completed = timestamp(provenance.requestCompletedAt), checkedAt = timestamp(provenance.checkedAt);
    const observed = provenance.sourceObservedAt === null ? null : timestamp(provenance.sourceObservedAt);
    if (envelope.schemaVersion !== 'league-administration-v1' || envelope.normalizerVersion !== 'sleeper-administration-v1'
      || envelope.dialect !== 'sleeper-nfl-v1' || provenance.origin !== 'network' || provenance.acquisition !== undefined
      || !Number.isFinite(started) || !Number.isFinite(completed) || !Number.isFinite(checkedAt) || started > completed || completed > checkedAt
      || observed !== null && (!Number.isFinite(observed) || observed < started || observed > completed)
      || envelope.completeness === 'complete' && observed === null
      || !['complete', 'partial'].includes(envelope.completeness)
      || envelope.family !== 'drafts' || envelope.week !== null || envelope.scope.provider !== 'sleeper' || envelope.scope.season !== 2026
      || !object(payload) || payload.metadataVersion !== DRAFT_METADATA_VERSION
      || Buffer.byteLength(JSON.stringify(payload), 'utf8') > DRAFT_METADATA_LIMITS.nativeBytes + 64 * 1024) return reject('invalid_draft_metadata_scope');
    if (!boundedNative(payload.catalog ?? null) || payload.kind === 'detail' && !boundedNative(payload.draft ?? null)) return reject('draft_metadata_structure_limit');
    const checked = normalizeAdministrationObservation(envelope);
    // The only intended v1 gap is its full-bundle array shape. Other rejected
    // envelopes (including invalid identities/ISO clocks) cannot qualify here.
    if (checked.status !== 'rejected' || checked.diagnostics.length !== 1
      || checked.diagnostics[0].code !== 'invalid_array' || checked.diagnostics[0].path !== 'payload') return reject('invalid_draft_metadata_envelope');
    if (checked.status !== normalized.status || checked.contentHash !== normalized.contentHash || checked.semanticHash !== normalized.semanticHash
      || compatibleRevision(checked.diagnostics) !== compatibleRevision(normalized.diagnostics)
      || compatibleRevision(checked.value) !== compatibleRevision(normalized.value)) return reject('draft_metadata_native_normalized_mismatch');
    let value: DraftMetadataValue;
    if (payload.kind === 'detail') {
      if (envelope.completeness !== 'complete' || !validDraftId(payload.externalDraftId)
        || !ownsDraft(payload.catalog, envelope.scope.externalLeagueId, payload.externalDraftId)
        || !ownsDraft(payload.draft, envelope.scope.externalLeagueId, payload.externalDraftId)) return reject('invalid_draft_metadata_identity');
      value = { kind: 'detail', season: 2026, complete: true, externalDraftId: payload.externalDraftId,
        catalog: facts(payload.catalog), detail: facts(payload.draft), picks: 'not-requested', tradedPicks: 'not-requested' };
    } else if (payload.kind === 'catalog') {
      if (!Array.isArray(payload.details) || payload.details.length > 8 || !(payload.reason === null || typeof payload.reason === 'string')) return reject('invalid_draft_inventory');
      const catalog = Array.isArray(payload.catalog) ? payload.catalog : null;
      const frequencies = new Map<string, number>();
      for (const row of catalog ?? []) if (ownsDraft(row, envelope.scope.externalLeagueId)) frequencies.set(row.draft_id as string, (frequencies.get(row.draft_id as string) ?? 0) + 1);
      const outcomes = new Map<string, DraftDetailState>();
      for (const outcome of payload.details) {
        if (!object(outcome) || !validDraftId(outcome.externalDraftId) || frequencies.get(outcome.externalDraftId) !== 1
          || outcomes.has(outcome.externalDraftId) || !['succeeded', 'failed', 'unrequested'].includes(String(outcome.state))) return reject('invalid_draft_detail_accounting');
        outcomes.set(outcome.externalDraftId, outcome.state as DraftDetailState);
      }
      if (catalog && catalog.length > 8 && [...outcomes.values()].some(state => state !== 'unrequested')) return reject('draft_inventory_fanout_limit');
      const entries: DraftCatalogEntry[] = (catalog ?? []).map((row, sourceOrdinal) => {
        const valid = ownsDraft(row, envelope.scope.externalLeagueId) && frequencies.get(row.draft_id as string) === 1;
        const externalDraftId = object(row) && validDraftId(row.draft_id) ? row.draft_id : null;
        return { sourceOrdinal, identityState: valid ? 'valid' : 'invalid', externalDraftId,
          metadata: valid && catalog!.length <= 8 ? facts(row as JsonObject) : null, detailState: valid ? outcomes.get(externalDraftId!) ?? 'unrequested' : 'unrequested' };
      });
      const validIdentityCount = entries.filter(entry => entry.identityState === 'valid').length;
      const succeededDetailCount = entries.filter(entry => entry.detailState === 'succeeded').length;
      const failedDetailCount = entries.filter(entry => entry.detailState === 'failed').length;
      const complete = catalog !== null && catalog.length <= 8 && entries.length === validIdentityCount && envelope.completeness === 'complete';
      value = { kind: 'catalog', season: 2026, complete, totalCount: catalog?.length ?? null, validIdentityCount,
        invalidIdentityCount: entries.length - validIdentityCount, attemptedDetailCount: succeededDetailCount + failedDetailCount,
        succeededDetailCount, failedDetailCount, unrequestedDetailCount: entries.length - succeededDetailCount - failedDetailCount,
        entries, reason: payload.reason, picks: 'not-requested', tradedPicks: 'not-requested' };
      if (complete && payload.reason !== null && payload.reason !== 'metadata-source-partial') return reject('invalid_complete_draft_inventory');
    } else return reject('invalid_draft_metadata_kind');
    if (Buffer.byteLength(JSON.stringify({ ...normalized, draftMetadataProjection: { value } }), 'utf8') > DRAFT_METADATA_LIMITS.persistedBytes) return reject('draft_metadata_projection_limit');
    return { status: 'accepted', version: DRAFT_METADATA_VERSION, value, diagnostics: [] };
  } catch { return reject('invalid_draft_metadata'); }
}
