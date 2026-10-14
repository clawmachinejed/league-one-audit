import type { SourceScope } from './contracts';
import type { AdministrationEnvelope, JsonObject, JsonValue, NormalizedAdministrationObservation } from '../league-administration/contracts';
import type { AdministrationSourceMapping } from '../league-administration/source-mapping';
import { isAdministrationSourceMapping } from '../league-administration/source-mapping';
import { normalizeAdministrationObservation } from '../league-administration/normalize';
import { compatibleRevision } from '../projections/shared/revision-compatibility';
import { PUBLIC_CAPTURE_LIMITS } from '../sleeper-public-response';
import { DRAFT_METADATA_LIMITS, ownsDraft, validDraftId, type DraftField } from './draft-metadata';
import type { RosterPlayerKindEvidence, RosterPlayerMappingProof } from './roster-player-links';

export const DRAFT_SELECTIONS_VERSION = 'sleeper-draft-selections-v1' as const;
export const DRAFT_SELECTIONS_POLICY = Object.freeze({ audienceId: 'public', coverageSpecId: DRAFT_SELECTIONS_VERSION,
  canonicalNormalizerVersion: DRAFT_SELECTIONS_VERSION, validationVersion: 'latest-network-attempt-v1' });
export const DRAFT_SELECTIONS_LIMITS = Object.freeze({ ...DRAFT_METADATA_LIMITS, selections: 10_000 });
export type DraftSelectionsResource = Readonly<{ kind: 'catalog' }> | Readonly<{ kind: 'selections'; externalDraftId: string }>;
export type DraftSelectionsSelection = DraftSelectionsResource & Readonly<{ receiptId?: string }>;
export type DraftSelectionFacts = Readonly<{
  sourceOrdinal: number; identityState: 'valid' | 'invalid' | 'duplicate' | 'conflict'; externalDraftId: string;
  pickNumber: DraftField<number>; round: DraftField<number>; draftSlot: DraftField<number>;
  playerId: DraftField<string>; rosterId: DraftField<string>; pickedBy: DraftField<string>;
  isKeeper: DraftField<boolean>; metadata: DraftField<JsonObject>; nativeDraftId: DraftField<string>;
  extensions: JsonObject; raw: JsonValue;
}>;
export type DraftSelectionsCatalogValue = Readonly<{ kind: 'catalog'; season: 2026; complete: boolean;
  totalCount: number | null; validIdentityCount: number; invalidIdentityCount: number; attemptedSelectionCount: number;
  succeededSelectionCount: number; failedSelectionCount: number; unrequestedSelectionCount: number;
  entries: readonly Readonly<{ sourceOrdinal: number; identityState: 'valid' | 'invalid'; externalDraftId: string | null;
    selectionState: 'succeeded' | 'failed' | 'unrequested' }>[]; reason: string | null; tradedPicks: 'not-requested' }>;
export type DraftSelectionsValue = DraftSelectionsCatalogValue | Readonly<{ kind: 'selections'; season: 2026;
  externalDraftId: string; complete: boolean; picksState: DraftField['state']; totalCount: number | null;
  entries: readonly DraftSelectionFacts[]; reason: string | null; tradedPicks: 'not-requested' }>;
export type DraftSelectionsProjection = Readonly<{ status: 'accepted'; version: typeof DRAFT_SELECTIONS_VERSION;
  value: DraftSelectionsValue; diagnostics: readonly [] }> | Readonly<{ status: 'rejected'; version: typeof DRAFT_SELECTIONS_VERSION;
  value: null; diagnostics: readonly Readonly<{ code: string; path: string }>[] }>;
export type DraftSelectionPlayerLink = Readonly<{ sourceOrdinal: number; selectionId: string; nativePlayerId: string | null;
  entityKind: 'player' | 'team_defense' | null; identityState: 'resolved' | 'unresolved' | 'conflict'; reasons: readonly string[];
  directoryIdentityStatus: 'valid' | 'invalid' | 'conflict' | 'missing'; kindEvidence: RosterPlayerKindEvidence | null;
  canonicalEntityId: string | null; mappingProof: readonly RosterPlayerMappingProof[] }>;
export type DraftSelectionPlayerLinks = Readonly<{ version: 'sleeper-draft-selection-player-links-v1';
  directoryVersionId: string | null; resolvedAt: string; mappingEvaluatedAt: string;
  outcome: 'complete' | 'partial' | 'capacity_exceeded' | 'owner_unqualified'; reasons: readonly string[];
  counts: Readonly<{ selections: number; resolved: number; unresolved: number; conflict: number }>;
  links: readonly DraftSelectionPlayerLink[] }>;
export type DraftSelectionsRead = Readonly<{ status: 'available' | 'observed'; version: typeof DRAFT_SELECTIONS_VERSION;
  selection: 'current' | 'receipt'; contentId: string; receiptId: string; acceptanceId: string | null;
  acceptedGeneration: number | null; acceptedAt: string | null; sourceMappingRevisionId: string;
  provenance: AdministrationEnvelope['provenance']; coverage: JsonObject; value: DraftSelectionsValue | null;
  playerLinks: DraftSelectionPlayerLinks | null }>
  | Readonly<{ status: 'missing' | 'unavailable' | 'disabled'; reason?: string }>;

export function draftSelectionsScope(mapping: AdministrationSourceMapping, resource: DraftSelectionsResource): SourceScope {
  if (!isAdministrationSourceMapping(mapping) || mapping.scope.season !== 2026
    || resource.kind !== 'catalog' && (resource.kind !== 'selections' || !validDraftId(resource.externalDraftId))) throw new Error('Invalid draft selections scope.');
  return { kind: 'enrolled-resource', connectionId: mapping.connectionId, leagueSeasonId: mapping.leagueSeasonId,
    family: 'drafts', entityId: resource.kind === 'catalog' ? 'catalog' : `draft:${resource.externalDraftId}:selections`,
    scoringPeriodId: null, audienceId: 'public', coverageSpecId: DRAFT_SELECTIONS_VERSION };
}
const object = (value: unknown): value is JsonObject => value !== null && typeof value === 'object' && !Array.isArray(value);
function field<T>(row: JsonObject, key: string, parse: (raw: JsonValue) => T | null): DraftField<T> {
  if (!Object.hasOwn(row, key)) return { state: 'missing', raw: null, value: null };
  const raw = row[key]; if (raw === null) return { state: 'null', raw, value: null };
  const value = parse(raw);
  return { state: value === null ? 'invalid' : raw === '' || object(raw) && Object.keys(raw).length === 0 ? 'empty' : 'supplied', raw, value };
}
const positive = (raw: JsonValue) => typeof raw === 'number' && Number.isSafeInteger(raw) && raw > 0 ? raw : null;
const nativePlayer = (raw: JsonValue) => typeof raw === 'string' && raw.length > 0 && [...raw].length <= 128
  && raw.trim() === raw && !/[\x00-\x1f\x7f]/u.test(raw) ? raw : null;
const roster = (raw: JsonValue) => typeof raw === 'number' && Number.isSafeInteger(raw) && raw > 0 ? String(raw)
  : typeof raw === 'string' && /^[1-9][0-9]{0,31}$/u.test(raw) ? raw : null;
const text = (raw: JsonValue) => typeof raw === 'string' ? raw : null;
const same = (a: unknown, b: unknown) => compatibleRevision(a) === compatibleRevision(b);
function bounded(value: JsonValue): boolean {
  const pending = [{ value, depth: 1 }]; let count = 1;
  while (pending.length) {
    const current = pending.pop()!; if (!current.value || typeof current.value !== 'object') continue;
    const children = Object.values(current.value);
    if (count + children.length > PUBLIC_CAPTURE_LIMITS.maxValues || children.length > 0 && current.depth >= PUBLIC_CAPTURE_LIMITS.maxDepth) return false;
    count += children.length; for (const child of children) pending.push({ value: child, depth: current.depth + 1 });
  }
  return true;
}
const reject = (code: string): DraftSelectionsProjection => ({ status: 'rejected', version: DRAFT_SELECTIONS_VERSION,
  value: null, diagnostics: [{ code, path: 'payload' }] });

/** Native pick number is identity. Array order, round, player and team never manufacture it. */
export function projectDraftSelections(normalized: NormalizedAdministrationObservation): DraftSelectionsProjection {
  try {
    const { envelope } = normalized, payload = envelope.payload, provenance = envelope.provenance;
    const instant = (value: unknown) => typeof value === 'string' ? Date.parse(value) : NaN;
    const started = instant(provenance.requestStartedAt), completed = instant(provenance.requestCompletedAt), checkedAt = instant(provenance.checkedAt);
    const observed = provenance.sourceObservedAt === null ? null : instant(provenance.sourceObservedAt);
    if (envelope.schemaVersion !== 'league-administration-v1' || envelope.normalizerVersion !== 'sleeper-administration-v1'
      || envelope.dialect !== 'sleeper-nfl-v1' || provenance.origin !== 'network' || provenance.acquisition !== undefined
      || !Number.isFinite(started) || !Number.isFinite(completed) || !Number.isFinite(checkedAt) || started > completed || completed > checkedAt
      || observed !== null && (!Number.isFinite(observed) || observed < started || observed > completed)
      || envelope.completeness === 'complete' && observed === null || !['complete', 'partial'].includes(envelope.completeness)
      || envelope.family !== 'drafts' || envelope.week !== null || envelope.scope.provider !== 'sleeper' || envelope.scope.season !== 2026
      || !object(payload) || payload.selectionsVersion !== DRAFT_SELECTIONS_VERSION
      || Buffer.byteLength(JSON.stringify(payload), 'utf8') > DRAFT_SELECTIONS_LIMITS.nativeBytes + DRAFT_SELECTIONS_LIMITS.framingBytes) return reject('invalid_draft_selections_scope');
    if (!bounded(payload.catalog ?? null) || !bounded(payload.picks ?? null)) return reject('draft_selections_structure_limit');
    const checked = normalizeAdministrationObservation(envelope);
    if (checked.status !== 'rejected' || checked.diagnostics.length !== 1 || checked.diagnostics[0].code !== 'invalid_array'
      || checked.diagnostics[0].path !== 'payload') return reject('invalid_draft_selections_envelope');
    if (checked.status !== normalized.status || checked.contentHash !== normalized.contentHash || checked.semanticHash !== normalized.semanticHash
      || !same(checked.diagnostics, normalized.diagnostics) || !same(checked.value, normalized.value)) return reject('draft_selections_native_normalized_mismatch');
    let value: DraftSelectionsValue;
    if (payload.kind === 'catalog') {
      if (!Array.isArray(payload.selections) || payload.selections.length > 8 || !(payload.reason === null || typeof payload.reason === 'string')) return reject('invalid_draft_selection_inventory');
      const catalog = Array.isArray(payload.catalog) ? payload.catalog : null;
      const counts = new Map<string, number>();
      for (const row of catalog ?? []) if (ownsDraft(row, envelope.scope.externalLeagueId)) counts.set(String(row.draft_id), (counts.get(String(row.draft_id)) ?? 0) + 1);
      const outcomes = new Map<string, 'succeeded' | 'failed' | 'unrequested'>();
      for (const outcome of payload.selections) {
        if (!object(outcome) || !validDraftId(outcome.externalDraftId) || counts.get(outcome.externalDraftId) !== 1 || outcomes.has(outcome.externalDraftId)
          || !['succeeded', 'failed', 'unrequested'].includes(String(outcome.state))) return reject('invalid_draft_selection_accounting');
        outcomes.set(outcome.externalDraftId, outcome.state as 'succeeded' | 'failed' | 'unrequested');
      }
      if (catalog && catalog.length > 8 && [...outcomes.values()].some(state => state !== 'unrequested')) return reject('draft_selection_inventory_limit');
      const entries = (catalog ?? []).map((row, sourceOrdinal) => {
        const valid = ownsDraft(row, envelope.scope.externalLeagueId) && counts.get(String(row.draft_id)) === 1;
        const externalDraftId = object(row) && validDraftId(row.draft_id) ? row.draft_id : null;
        return { sourceOrdinal, identityState: valid ? 'valid' as const : 'invalid' as const, externalDraftId,
          selectionState: valid ? outcomes.get(externalDraftId!) ?? 'unrequested' : 'unrequested' as const };
      });
      const validIdentityCount = entries.filter(entry => entry.identityState === 'valid').length;
      const succeededSelectionCount = entries.filter(entry => entry.selectionState === 'succeeded').length;
      const failedSelectionCount = entries.filter(entry => entry.selectionState === 'failed').length;
      const complete = catalog !== null && catalog.length <= 8 && entries.length === validIdentityCount && envelope.completeness === 'complete';
      if (complete && payload.reason !== null && payload.reason !== 'metadata-source-partial') return reject('invalid_complete_draft_selection_inventory');
      value = { kind: 'catalog', season: 2026, complete, totalCount: catalog?.length ?? null, validIdentityCount,
        invalidIdentityCount: entries.length - validIdentityCount, attemptedSelectionCount: succeededSelectionCount + failedSelectionCount,
        succeededSelectionCount, failedSelectionCount, unrequestedSelectionCount: entries.length - succeededSelectionCount - failedSelectionCount,
        entries, reason: payload.reason, tradedPicks: 'not-requested' };
    } else if (payload.kind === 'selections') {
      if (!validDraftId(payload.externalDraftId) || !ownsDraft(payload.catalog, envelope.scope.externalLeagueId, payload.externalDraftId)) return reject('invalid_draft_selections_identity');
      const picks = Array.isArray(payload.picks) ? payload.picks : null;
      if (picks && picks.length > DRAFT_SELECTIONS_LIMITS.selections) return reject('draft_selection_capacity');
      const frequencies = new Map<number, number>();
      for (const row of picks ?? []) if (object(row)) { const number = positive(row.pick_no); if (number !== null) frequencies.set(number, (frequencies.get(number) ?? 0) + 1); }
      const entries: DraftSelectionFacts[] = (picks ?? []).map((raw, sourceOrdinal) => {
        const row = object(raw) ? raw : {}, pickNumber = field(row, 'pick_no', positive);
        const conflict = Object.hasOwn(row, 'draft_id') && row.draft_id !== payload.externalDraftId
          || Object.hasOwn(row, 'league_id') && row.league_id !== envelope.scope.externalLeagueId
          || Object.hasOwn(row, 'season') && row.season !== '2026' || Object.hasOwn(row, 'sport') && row.sport !== 'nfl';
        return { sourceOrdinal, identityState: conflict ? 'conflict' : pickNumber.value === null ? 'invalid'
          : frequencies.get(pickNumber.value)! > 1 ? 'duplicate' : 'valid', externalDraftId: payload.externalDraftId as string,
          pickNumber, round: field(row, 'round', positive), draftSlot: field(row, 'draft_slot', positive),
          playerId: field(row, 'player_id', nativePlayer), rosterId: field(row, 'roster_id', roster), pickedBy: field(row, 'picked_by', text),
          isKeeper: field(row, 'is_keeper', value => typeof value === 'boolean' ? value : null),
          metadata: field(row, 'metadata', value => object(value) ? value : null), nativeDraftId: field(row, 'draft_id', value => validDraftId(value) ? value : null),
          extensions: Object.fromEntries(Object.entries(row).filter(([key]) => !['pick_no', 'round', 'draft_slot', 'player_id', 'roster_id', 'picked_by', 'is_keeper', 'metadata', 'draft_id'].includes(key))), raw };
      });
      const picksState = !Object.hasOwn(payload, 'picks') ? 'missing' : payload.picks === null ? 'null' : picks === null ? 'invalid' : picks.length ? 'supplied' : 'empty';
      const valid = entries.every(entry => entry.identityState === 'valid');
      const complete = picks !== null && valid && envelope.completeness === 'complete';
      value = { kind: 'selections', season: 2026, externalDraftId: payload.externalDraftId, complete, picksState, totalCount: picks?.length ?? null,
        entries, reason: picks === null ? 'draft-selections-invalid-picks' : !valid ? 'draft-selections-invalid-identities'
          : !complete ? 'draft-selections-source-partial' : null, tradedPicks: 'not-requested' };
    } else return reject('invalid_draft_selections_kind');
    if (Buffer.byteLength(JSON.stringify({ ...normalized, draftSelectionsProjection: { value } }), 'utf8') > DRAFT_SELECTIONS_LIMITS.persistedBytes) return reject('draft_selections_projection_limit');
    return { status: 'accepted', version: DRAFT_SELECTIONS_VERSION, value, diagnostics: [] };
  } catch { return reject('invalid_draft_selections'); }
}
