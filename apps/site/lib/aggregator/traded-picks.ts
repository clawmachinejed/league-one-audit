import type { SourceScope } from './contracts';
import type { AdministrationEnvelope, JsonObject, JsonValue, NormalizedAdministrationObservation } from '../league-administration/contracts';
import type { AdministrationSourceMapping } from '../league-administration/source-mapping';
import { isAdministrationSourceMapping } from '../league-administration/source-mapping';
import { normalizeAdministrationObservation } from '../league-administration/normalize';
import { compatibleRevision } from '../projections/shared/revision-compatibility';
import { publicDraftCaptureForPayload } from '../league-administration/public-capture-witness';
import { PUBLIC_CAPTURE_LIMITS } from '../sleeper-public-response';
import { DRAFT_METADATA_LIMITS, ownsDraft, validDraftId, type DraftField } from './draft-metadata';

export const TRADED_PICKS_VERSION = 'sleeper-traded-picks-v1' as const;
export const TRADED_PICKS_POLICY = Object.freeze({ audienceId: 'public', coverageSpecId: TRADED_PICKS_VERSION,
  canonicalNormalizerVersion: TRADED_PICKS_VERSION, validationVersion: 'latest-network-attempt-v1' });
export const TRADED_PICKS_LIMITS = Object.freeze({ ...DRAFT_METADATA_LIMITS, rows: 10_000 });
export type TradedPicksResource = Readonly<{ kind: 'catalog' | 'league' }> | Readonly<{ kind: 'draft'; externalDraftId: string }>;
export type TradedPicksSelection = TradedPicksResource & Readonly<{ receiptId?: string }>;
export type OwnershipState = 'resolved' | 'unknown' | 'conflict';
export type TradedPickFacts = Readonly<{ sourceOrdinal: number; identityState: 'valid' | 'invalid' | 'conflict';
  pickSeason: DraftField<string>; round: DraftField<number>; originalRosterId: DraftField<string>;
  ownerId: DraftField<string>; previousOwnerId: DraftField<string>; ownershipState: OwnershipState;
  currentOwnerId: string | null; previousOwnerState: OwnershipState; evidencedPreviousOwnerId: string | null;
  extensions: JsonObject; raw: JsonValue }>;
export type TradedPicksCatalogValue = Readonly<{ kind: 'catalog'; season: 2026; complete: boolean;
  totalCount: number | null; validIdentityCount: number; invalidIdentityCount: number;
  attemptedTradeCount: number; succeededTradeCount: number; failedTradeCount: number; unrequestedTradeCount: number;
  entries: readonly Readonly<{ sourceOrdinal: number; identityState: 'valid' | 'invalid'; externalDraftId: string | null;
    tradeState: 'succeeded' | 'failed' | 'unrequested' }>[]; reason: string | null }>;
export type TradedPicksValue = TradedPicksCatalogValue | Readonly<{ kind: 'league' | 'draft'; season: 2026;
  externalDraftId: string | null; complete: boolean; tradesState: DraftField['state']; totalCount: number | null;
  entries: readonly TradedPickFacts[]; reason: string | null }>;
export type TradedPicksProjection = Readonly<{ status: 'accepted'; version: typeof TRADED_PICKS_VERSION;
  value: TradedPicksValue; diagnostics: readonly [] }> | Readonly<{ status: 'rejected'; version: typeof TRADED_PICKS_VERSION;
  value: null; diagnostics: readonly Readonly<{ code: string; path: string }>[] }>;
export type TradedPicksRead = Readonly<{ status: 'available' | 'observed'; version: typeof TRADED_PICKS_VERSION;
  selection: 'current' | 'receipt'; contentId: string; receiptId: string; acceptanceId: string | null;
  acceptedGeneration: number | null; acceptedAt: string | null; sourceMappingRevisionId: string;
  provenance: AdministrationEnvelope['provenance']; coverage: JsonObject; value: TradedPicksValue | null }>
  | Readonly<{ status: 'missing' | 'unavailable' | 'disabled'; reason?: string }>;

export function tradedPicksScope(mapping: AdministrationSourceMapping, resource: TradedPicksResource): SourceScope {
  if (!isAdministrationSourceMapping(mapping) || mapping.scope.season !== 2026
    || !['catalog', 'league', 'draft'].includes(resource.kind) || resource.kind === 'draft' && !validDraftId(resource.externalDraftId)) throw new Error('Invalid traded picks scope.');
  return { kind: 'enrolled-resource', connectionId: mapping.connectionId, leagueSeasonId: mapping.leagueSeasonId,
    family: 'drafts', entityId: resource.kind === 'draft' ? `draft:${resource.externalDraftId}:traded-picks` : resource.kind,
    scoringPeriodId: null, audienceId: 'public', coverageSpecId: TRADED_PICKS_VERSION };
}
const object = (value: unknown): value is JsonObject => value !== null && typeof value === 'object' && !Array.isArray(value);
function field<T>(row: JsonObject, key: string, parse: (raw: JsonValue) => T | null): DraftField<T> {
  if (!Object.hasOwn(row, key)) return { state: 'missing', raw: null, value: null };
  const raw = row[key]; if (raw === null) return { state: 'null', raw, value: null };
  const value = parse(raw); return { state: value === null ? 'invalid' : 'supplied', raw, value };
}
const positive = (raw: JsonValue) => typeof raw === 'number' && Number.isSafeInteger(raw) && raw > 0 ? raw : null;
const roster = (raw: JsonValue) => typeof raw === 'number' && Number.isSafeInteger(raw) && raw > 0 ? String(raw)
  : typeof raw === 'string' && /^[1-9][0-9]{0,31}$/u.test(raw) ? raw : null;
const year = (raw: JsonValue) => typeof raw === 'string' && /^[0-9]{4}$/u.test(raw) && Number(raw) >= 1920 && Number(raw) <= 2200 ? raw : null;
const same = (a: unknown, b: unknown) => compatibleRevision(a) === compatibleRevision(b);
/** Preserve PostgreSQL microsecond ordering rather than truncating to Date milliseconds. */
export function tradedPickInstantMicros(value: string): bigint {
  const match = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2}:\d{2})(?:\.(\d{1,6}))?(Z|[+-](?:0\d|1[0-5]):[0-5]\d)$/u.exec(value);
  if (!match) throw new Error('Invalid precise traded pick timestamp.');
  const local = `${match[1]}T${match[2]}`, localEpoch = Date.parse(`${local}.000Z`), epoch = Date.parse(`${local}.000${match[4]}`);
  if (!Number.isFinite(epoch) || !Number.isFinite(localEpoch) || new Date(localEpoch).toISOString().slice(0, 19) !== local) throw new Error('Invalid traded pick calendar instant.');
  return BigInt(epoch) * 1_000n + BigInt((match[3] ?? '').padEnd(6, '0'));
}
const reject = (code: string): TradedPicksProjection => ({ status: 'rejected', version: TRADED_PICKS_VERSION,
  value: null, diagnostics: [{ code, path: 'payload' }] });
function bounded(value: JsonValue): boolean {
  const pending = [{ value, depth: 1 }]; let count = 1;
  while (pending.length) { const current = pending.pop()!; if (!current.value || typeof current.value !== 'object') continue;
    const children = Object.values(current.value);
    if (count + children.length > PUBLIC_CAPTURE_LIMITS.maxValues || children.length > 0 && current.depth >= PUBLIC_CAPTURE_LIMITS.maxDepth) return false;
    count += children.length; for (const child of children) pending.push({ value: child, depth: current.depth + 1 }); }
  return true;
}

/** Completeness certifies the captured endpoint, independently of ownership resolution.
 * Native year/round/original roster identifies an asset only within that endpoint.
 * No ordering, previous-owner relation, manager, slot or selection implies a chain. */
export function projectTradedPicks(normalized: NormalizedAdministrationObservation): TradedPicksProjection {
  try {
    const { envelope } = normalized, payload = envelope.payload, provenance = envelope.provenance;
    publicDraftCaptureForPayload(provenance.acquisition, envelope.scope.externalLeagueId, envelope.scope.season, payload);
    if (envelope.schemaVersion !== 'league-administration-v1' || envelope.normalizerVersion !== 'sleeper-administration-v1'
      || envelope.dialect !== 'sleeper-nfl-v1' || provenance.origin !== 'network'
      || !['complete', 'partial'].includes(envelope.completeness) || envelope.family !== 'drafts' || envelope.week !== null
      || envelope.scope.provider !== 'sleeper' || envelope.scope.season !== 2026 || !object(payload)
      || payload.tradedPicksVersion !== TRADED_PICKS_VERSION
      || Buffer.byteLength(JSON.stringify(payload), 'utf8') > TRADED_PICKS_LIMITS.nativeBytes + TRADED_PICKS_LIMITS.framingBytes) return reject('invalid_traded_picks_scope');
    if (!bounded(payload.catalog ?? null) || !bounded(payload.tradedPicks ?? null)) return reject('traded_picks_structure_limit');
    const checked = normalizeAdministrationObservation(envelope);
    if (checked.status !== 'rejected' || checked.diagnostics.length !== 1 || checked.diagnostics[0].code !== 'invalid_array'
      || checked.diagnostics[0].path !== 'payload') return reject('invalid_traded_picks_envelope');
    if (checked.status !== normalized.status || checked.contentHash !== normalized.contentHash || checked.semanticHash !== normalized.semanticHash
      || !same(checked.diagnostics, normalized.diagnostics) || !same(checked.value, normalized.value)) return reject('traded_picks_native_normalized_mismatch');
    const started = tradedPickInstantMicros(provenance.requestStartedAt!), completed = tradedPickInstantMicros(provenance.requestCompletedAt!), checkedAt = tradedPickInstantMicros(provenance.checkedAt);
    const observed = provenance.sourceObservedAt === null ? null : tradedPickInstantMicros(provenance.sourceObservedAt);
    if (started > completed || completed > checkedAt
      || observed !== null && (observed < started || observed > completed)
      || envelope.completeness === 'complete' && observed === null) return reject('invalid_traded_picks_clocks');
    let value: TradedPicksValue;
    if (payload.kind === 'catalog') {
      if (!Array.isArray(payload.trades) || payload.trades.length > 8 || !(payload.reason === null || typeof payload.reason === 'string')) return reject('invalid_traded_pick_inventory');
      const catalog = Array.isArray(payload.catalog) ? payload.catalog : null, counts = new Map<string, number>();
      for (const row of catalog ?? []) if (ownsDraft(row, envelope.scope.externalLeagueId)) counts.set(String(row.draft_id), (counts.get(String(row.draft_id)) ?? 0) + 1);
      const outcomes = new Map<string, 'succeeded' | 'failed' | 'unrequested'>();
      for (const outcome of payload.trades) {
        if (!object(outcome) || !validDraftId(outcome.externalDraftId) || counts.get(outcome.externalDraftId) !== 1 || outcomes.has(outcome.externalDraftId)
          || !['succeeded', 'failed', 'unrequested'].includes(String(outcome.state))) return reject('invalid_traded_pick_accounting');
        outcomes.set(outcome.externalDraftId, outcome.state as 'succeeded' | 'failed' | 'unrequested');
      }
      if (catalog && catalog.length > 8 && [...outcomes.values()].some(state => state !== 'unrequested')) return reject('traded_pick_inventory_limit');
      const entries = (catalog ?? []).map((row, sourceOrdinal) => { const valid = ownsDraft(row, envelope.scope.externalLeagueId) && counts.get(String(row.draft_id)) === 1;
        const externalDraftId = object(row) && validDraftId(row.draft_id) ? row.draft_id : null;
        return { sourceOrdinal, identityState: valid ? 'valid' as const : 'invalid' as const, externalDraftId,
          tradeState: valid ? outcomes.get(externalDraftId!) ?? 'unrequested' : 'unrequested' as const }; });
      const validIdentityCount = entries.filter(entry => entry.identityState === 'valid').length;
      const succeededTradeCount = entries.filter(entry => entry.tradeState === 'succeeded').length;
      const failedTradeCount = entries.filter(entry => entry.tradeState === 'failed').length;
      const complete = catalog !== null && catalog.length <= 8 && entries.length === validIdentityCount && envelope.completeness === 'complete';
      if (complete && payload.reason !== null && payload.reason !== 'metadata-source-partial') return reject('invalid_complete_traded_pick_inventory');
      value = { kind: 'catalog', season: 2026, complete, totalCount: catalog?.length ?? null, validIdentityCount,
        invalidIdentityCount: entries.length - validIdentityCount, attemptedTradeCount: succeededTradeCount + failedTradeCount,
        succeededTradeCount, failedTradeCount, unrequestedTradeCount: entries.length - succeededTradeCount - failedTradeCount, entries, reason: payload.reason };
    } else if (payload.kind === 'league' || payload.kind === 'draft') {
      if (payload.kind === 'draft' && (!validDraftId(payload.externalDraftId) || !ownsDraft(payload.catalog, envelope.scope.externalLeagueId, payload.externalDraftId))
        || payload.kind === 'league' && (Object.hasOwn(payload, 'externalDraftId') || Object.hasOwn(payload, 'catalog'))) return reject('invalid_traded_pick_endpoint');
      const trades = Array.isArray(payload.tradedPicks) ? payload.tradedPicks : null;
      if (trades && trades.length > TRADED_PICKS_LIMITS.rows) return reject('traded_pick_capacity');
      const entries: TradedPickFacts[] = (trades ?? []).map((raw, sourceOrdinal) => {
        const row = object(raw) ? raw : {}, pickSeason = field(row, 'season', year), round = field(row, 'round', positive), originalRosterId = field(row, 'roster_id', roster);
        const conflict = Object.hasOwn(row, 'league_id') && row.league_id !== envelope.scope.externalLeagueId
          || Object.hasOwn(row, 'sport') && row.sport !== 'nfl'
          || payload.kind === 'draft' && Object.hasOwn(row, 'draft_id') && row.draft_id !== payload.externalDraftId;
        return { sourceOrdinal, identityState: conflict ? 'conflict' : pickSeason.value === null || round.value === null || originalRosterId.value === null ? 'invalid' : 'valid',
          pickSeason, round, originalRosterId, ownerId: field(row, 'owner_id', roster), previousOwnerId: field(row, 'previous_owner_id', roster),
          ownershipState: 'unknown', currentOwnerId: null, previousOwnerState: 'unknown', evidencedPreviousOwnerId: null,
          extensions: Object.fromEntries(Object.entries(row).filter(([key]) => !['season', 'round', 'roster_id', 'owner_id', 'previous_owner_id'].includes(key))), raw };
      });
      const groups = new Map<string, TradedPickFacts[]>();
      for (const entry of entries) if (entry.identityState === 'valid') { const key = JSON.stringify([entry.pickSeason.value, entry.round.value, entry.originalRosterId.value]);
        const group = groups.get(key); if (group) group.push(entry); else groups.set(key, [entry]); }
      const resolved = new Map<number, TradedPickFacts>();
      for (const group of groups.values()) {
        const resolution = (key: 'ownerId' | 'previousOwnerId') => { const supplied = new Set(group.map(entry => entry[key].value).filter(value => value !== null));
          const state: OwnershipState = supplied.size > 1 ? 'conflict' : group.some(entry => entry[key].value === null) ? 'unknown' : 'resolved';
          return { state, value: state === 'resolved' ? [...supplied][0] : null }; };
        const owner = resolution('ownerId'), previous = resolution('previousOwnerId');
        for (const entry of group) resolved.set(entry.sourceOrdinal, { ...entry, ownershipState: owner.state, currentOwnerId: owner.value,
          previousOwnerState: previous.state, evidencedPreviousOwnerId: previous.value });
      }
      const valid = entries.every(entry => entry.identityState === 'valid'), complete = trades !== null && valid && envelope.completeness === 'complete';
      value = { kind: payload.kind, season: 2026, externalDraftId: payload.kind === 'draft' ? payload.externalDraftId as string : null,
        complete, tradesState: !Object.hasOwn(payload, 'tradedPicks') ? 'missing' : payload.tradedPicks === null ? 'null' : trades === null ? 'invalid' : trades.length ? 'supplied' : 'empty',
        totalCount: trades?.length ?? null, entries: entries.map(entry => resolved.get(entry.sourceOrdinal) ?? entry),
        reason: trades === null ? 'traded-picks-invalid-array' : !valid ? 'traded-picks-invalid-identities' : !complete ? 'traded-picks-source-partial' : null };
    } else return reject('invalid_traded_picks_kind');
    if (Buffer.byteLength(JSON.stringify({ ...normalized, tradedPicksProjection: { value } }), 'utf8') > TRADED_PICKS_LIMITS.persistedBytes) return reject('traded_picks_projection_limit');
    return { status: 'accepted', version: TRADED_PICKS_VERSION, value, diagnostics: [] };
  } catch { return reject('invalid_traded_picks'); }
}
