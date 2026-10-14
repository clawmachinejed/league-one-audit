import { readFile } from 'node:fs/promises';
import { describe, expect, it, vi } from 'vitest';
import type { DatabaseClient, DatabaseRow } from '../../database';
import { DRAFT_METADATA_VERSION, DRAFT_METADATA_POLICY, DRAFT_METADATA_LIMITS, draftMetadataScope, projectDraftMetadata,
  type DraftMetadataFacts, type DraftMetadataResource } from '../../aggregator/draft-metadata';
import type { JsonObject, JsonValue } from '../contracts';
import { normalizeAdministrationObservation } from '../normalize';
import { createLeagueAdministrationStore } from '../store';
import { createLeagueAdministrationMethods } from './administration';
import { DRAFT_METADATA_SQL, draftMetadataMethods, readDraftMetadataRows } from './draft-metadata';
vi.mock('server-only', () => ({}));
it('reads immutable CP19 witnessed receipts and rejects wrong endpoint or unproved causal lineage', () => {
  const f = fixture();
  const acquisition = { version: 'public-network-capture-v1', mapping,
    work: { kind: 'drafts', resource: 'detail', requestId: id(90), revision: 4, externalLeagueId: mapping.scope.externalLeagueId,
      season: 2026, externalDraftId: selection.externalDraftId, catalogReceiptId: id(91) },
    fence: { jobKey: 'league-administration-public-intake', workerId: id(92), generation: 1, deadlineAt: at },
    dispatchNonce: id(93), attempts: { draftMetadata: { id: id(6), nonce: id(94) } } };
  const row = { ...f.row, provenance: { ...f.normalized.envelope.provenance, acquisition } };
  expect(readDraftMetadataRows([row], mapping, { ...selection, receiptId: id(5) })).toMatchObject({ status: 'available', selection: 'receipt' });
  expect(readDraftMetadataRows([{ ...row, capture_after_reservation: false }], mapping, selection).status).toBe('unavailable');
  expect(readDraftMetadataRows([{ ...row, provenance: { ...row.provenance, acquisition: { ...acquisition,
    work: { ...acquisition.work, externalDraftId: 'wrong-draft' } } } }], mapping, selection).status).toBe('unavailable');
});
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const at = '2026-10-13T12:00:00.000Z';
const mapping = { connectionId: id(1), leagueSeasonId: id(2), revisionId: id(3), generation: 1,
  scope: { leagueKey: 'cp16-unit', provider: 'sleeper' as const, externalLeagueId: '90071992547409999', season: 2026 } };
const selection = { kind: 'detail' as const, externalDraftId: '90071992547409939' };
const native = (draft = selection.externalDraftId): JsonObject => ({ draft_id: draft, league_id: mapping.scope.externalLeagueId,
  season: '2026', sport: 'nfl', type: 'snake', status: 'pre_draft', settings: { rounds: 0, enabled: false }, metadata: null,
  start_time: 0, draft_order: { userB: 2, userA: 1, '\u{10000}': 3, '\uE000': 4 }, slot_to_roster_id: { '1': '90071992547409945', '2': 2, '\u{10000}': 3, '\uE000': 4 }, future: false });
function fixture(options: { kind?: 'detail' | 'catalog'; partial?: boolean; malformed?: boolean; catalog?: JsonValue[]; native?: JsonObject } = {}) {
  const resource: DraftMetadataResource = options.kind === 'catalog' ? { kind: 'catalog' }
    : { kind: 'detail', externalDraftId: String(options.native?.draft_id ?? selection.externalDraftId) };
  const nativeRow = options.native ?? native();
  const payload: JsonValue = resource.kind === 'catalog'
    ? { metadataVersion: DRAFT_METADATA_VERSION, kind: 'catalog', catalog: options.catalog ?? [native('b'), native('a')], details: [], reason: options.partial ? 'draft-inventory-limit' : null }
    : { metadataVersion: DRAFT_METADATA_VERSION, kind: 'detail', externalDraftId: resource.externalDraftId, catalog: nativeRow, draft: options.malformed ? null : nativeRow };
  const normalized = normalizeAdministrationObservation({ schemaVersion: 'league-administration-v1', normalizerVersion: 'sleeper-administration-v1',
    dialect: 'sleeper-nfl-v1', scope: mapping.scope, family: 'drafts', week: null, completeness: options.partial || options.malformed ? 'partial' : 'complete',
    provenance: { origin: 'network', requestStartedAt: at, requestCompletedAt: at, sourceObservedAt: options.partial || options.malformed ? null : at, checkedAt: at }, payload });
  const projected = projectDraftMetadata(normalized), value = projected.status === 'accepted' ? projected.value : null;
  const covered = value?.complete === true;
  const facts: Record<string, unknown>[] = [];
  const canonical = new Map<string, string>();
  function fact(kind: string, source: DraftMetadataFacts) {
    if (!canonical.has(source.externalDraftId)) canonical.set(source.externalDraftId, id(50 + canonical.size));
    const { externalDraftId, externalLeagueId, season, settings, metadata, extensions, userSlots, slotRosters, ...nativeFields } = source;
    const base = { content_id: id(8), source_kind: kind, external_draft_id: externalDraftId };
    facts.push({ ...base, draft_id: canonical.get(externalDraftId), external_league_id: externalLeagueId, season,
      type_state: source.type.state, type_value: source.type.value, status_state: source.status.state, status_value: source.status.value,
      settings, metadata, native_fields: { ...nativeFields,
        type: { state: source.type.state, raw: source.type.raw }, status: { state: source.status.state, raw: source.status.raw } },
      extensions, canonical_league_season_id: mapping.leagueSeasonId,
      canonical_provider: 'sleeper', canonical_external_league_matches: true, canonical_external_draft_id: externalDraftId,
      user_slots: userSlots.map(link => [link.externalUserId, link.slot.state, link.slot.raw, link.slot.value]),
      slot_rosters: slotRosters.map(link => [link.slotKey, link.externalRosterId.state, link.externalRosterId.raw, link.externalRosterId.value]) });
  }
  if (value?.kind === 'detail') { fact('catalog', value.catalog); fact('detail', value.detail); }
  else if (value?.kind === 'catalog') for (const entry of value.entries) if (entry.metadata) fact('catalog', entry.metadata);
  const row: DatabaseRow = { identity: { scope: draftMetadataScope(mapping, resource), policy: DRAFT_METADATA_POLICY },
    head_accepted_id: id(4), head_generation: '1', acceptance_id: covered ? id(4) : null, generation: covered ? '1' : null,
    source_mapping_revision_id: covered ? id(3) : null, accepted_at: covered ? at : null,
    receipt_id: id(5), attempt_id: id(6), reserved_attempt_id: id(6), ordinal: '1', expected_generation: '0',
    legacy_observation_id: id(7), provenance: normalized.envelope.provenance,
    coverage: { periodIds: [], interval: null, entitySet: covered ? 'full' : 'unknown',
      fields: ['draft_id', 'league_id', 'season', 'type', 'status', 'settings', 'draft_order', 'slot_to_roster_id', 'metadata', 'start_time', 'created', 'last_picked'],
      pagination: covered ? 'complete' : 'unknown', nextCursor: null, completeness: covered ? 'complete' : 'partial', reasons: covered ? [] : ['draft_metadata_incomplete'] },
    configuration_content_id: null, population_evidence: null, expected_team_count: null, source_mapping: mapping, capture_after_reservation: true,
    content_id: id(8), content_hash: normalized.contentHash, semantic_hash: normalized.semanticHash, payload,
    normalized_value: normalized.value, normalizer_version: 'sleeper-administration-v1', completeness: normalized.envelope.completeness,
    content_accepted: false, league_season_id: id(2), provider: 'sleeper', external_league_id: mapping.scope.externalLeagueId,
    family: 'drafts', week: 0, observation_content_id: id(8), observation_league_season_id: id(2), first_receipt_content_id: value ? id(8) : null,
    value_header: value ? { content_id: id(8), first_receipt_id: id(20), value_version: DRAFT_METADATA_VERSION, kind: value.kind,
      external_draft_id: value.kind === 'detail' ? value.externalDraftId : null, complete: value.complete,
      total_count: value.kind === 'catalog' ? value.totalCount : null, valid_identity_count: value.kind === 'catalog' ? value.validIdentityCount : 0,
      invalid_identity_count: value.kind === 'catalog' ? value.invalidIdentityCount : 0, attempted_detail_count: value.kind === 'catalog' ? value.attemptedDetailCount : 0,
      succeeded_detail_count: value.kind === 'catalog' ? value.succeededDetailCount : 0, failed_detail_count: value.kind === 'catalog' ? value.failedDetailCount : 0,
      unrequested_detail_count: value.kind === 'catalog' ? value.unrequestedDetailCount : 0, reason: value.kind === 'catalog' ? value.reason : null } : null,
    entries: value?.kind === 'catalog' ? value.entries.map(entry => [entry.sourceOrdinal, entry.identityState, entry.externalDraftId, entry.detailState]) : [],
    facts };
  return { normalized, projected, resource, row };
}
function database(query: (sql: string, values: readonly unknown[]) => readonly DatabaseRow[]): DatabaseClient {
  return { enabled: true, async query<Row extends DatabaseRow>(sql: string, values: readonly unknown[] = []) { return query(sql, values) as readonly Row[]; } };
}

describe('CP16 stored draft metadata boundary', () => {
  it('reconstructs exact native metadata from typed facts and links independently of legacy full draft acceptance', () => {
    const f = fixture(); expect(f.normalized.status).toBe('rejected');
    expect(readDraftMetadataRows([f.row], mapping, selection)).toMatchObject({ status: 'available', selection: 'current',
      receiptId: id(5), acceptedGeneration: 1, acceptedAt: at, value: f.projected.value });
    expect(readDraftMetadataRows([f.row], mapping, { ...selection, receiptId: id(5) })).toMatchObject({ status: 'available', selection: 'receipt' });
  });
  it('retains catalog source order and scopes repeated users and slots to each native draft', () => {
    const f = fixture({ kind: 'catalog' }), read = readDraftMetadataRows([f.row], mapping, f.resource);
    expect(read).toMatchObject({ status: 'available', value: { kind: 'catalog', totalCount: 2,
      entries: [{ sourceOrdinal: 0, externalDraftId: 'b' }, { sourceOrdinal: 1, externalDraftId: 'a' }] } });
    expect(read).toMatchObject({ value: f.projected.value });
    if (f.projected.status !== 'accepted' || f.projected.value.kind !== 'catalog') throw Error('Invalid catalog fixture.');
    expect(f.projected.value.entries[0].metadata?.userSlots.map(slot => slot.externalUserId)).toEqual(['userA', 'userB', '\uE000', '\u{10000}']);
  });
  it.each([{ kind: 'catalog' as const, partial: true }, { malformed: true }])('returns exact incomplete evidence as observed while withholding a current read %#', options => {
    const f = fixture(options);
    expect(readDraftMetadataRows([f.row], mapping, { ...f.resource, receiptId: id(5) })).toMatchObject({ status: 'observed',
      acceptanceId: null, acceptedGeneration: null, acceptedAt: null, value: f.projected.value });
    expect(readDraftMetadataRows([f.row], mapping, f.resource).status).toBe('unavailable');
  });
  it('reads all nine capped catalog identities and counts without fabricating per-draft detail facts', () => {
    const f = fixture({ kind: 'catalog', partial: true, catalog: Array.from({ length: 9 }, (_, index) => native('draft-' + index)) });
    expect(f.row.facts).toEqual([]);
    expect(readDraftMetadataRows([f.row], mapping, { ...f.resource, receiptId: id(5) })).toMatchObject({ status: 'observed', value: {
      totalCount: 9, validIdentityCount: 9, attemptedDetailCount: 0, unrequestedDetailCount: 9,
      entries: Array.from({ length: 9 }, (_, index) => ({ sourceOrdinal: index, externalDraftId: 'draft-' + index, metadata: null })) } });
  });
  it.each(['catalog', 'draft_order', 'slot_to_roster_id'] as const)('reads a supported large %s capture within the unchanged result budget without provider access', async kind => {
    const large = Object.fromEntries(Array.from({ length: 100_000 }, (_, index) => ['user' + index, 1]));
    const f = kind === 'catalog' ? fixture({ kind: 'catalog', partial: true, catalog: Array(220_000).fill(null) as JsonValue[] })
      : fixture({ native: { ...native('d'.repeat(128)), [kind]: large } });
    expect(f.projected.status).toBe('accepted');
    const writeBytes = Buffer.byteLength(JSON.stringify({ ...f.normalized, draftMetadataProjection: { value: f.projected.value } }));
    const readBytes = Buffer.byteLength(JSON.stringify(f.row));
    expect(writeBytes).toBeLessThanOrEqual(DRAFT_METADATA_LIMITS.persistedBytes);
    expect(readBytes, 'actual selected-row bytes: ' + readBytes).toBeLessThanOrEqual(DRAFT_METADATA_LIMITS.persistedBytes);
    const query = vi.fn<(sql: string, values: readonly unknown[]) => readonly DatabaseRow[]>(() => [f.row]);
    const fetch = vi.spyOn(globalThis, 'fetch').mockRejectedValue(Error('provider access forbidden'));
    try {
      const selected = kind === 'catalog' ? { ...f.resource, receiptId: id(5) } : f.resource;
      const read = await draftMetadataMethods(database(query)).readDraftMetadata(mapping, selected);
      expect(read.status).toBe(kind === 'catalog' ? 'observed' : 'available');
      if (read.status !== 'observed' && read.status !== 'available') throw Error('Large capture unavailable.');
      expect(read.value).toEqual(f.projected.value);
      expect(query).toHaveBeenCalledExactlyOnceWith(DRAFT_METADATA_SQL,
        [JSON.stringify({ scope: draftMetadataScope(mapping, f.resource), policy: DRAFT_METADATA_POLICY }), id(3), 1, kind === 'catalog' ? id(5) : null]);
      expect(fetch).not.toHaveBeenCalled();
    } finally { fetch.mockRestore(); }
  }, 30_000);
  it('reconstructs large type and status text without selecting redundant native typed values', async () => {
    const f = fixture({ native: { ...native(), type: 't'.repeat(2_096_000), status: 's'.repeat(2_096_000) } });
    expect(f.projected.status).toBe('accepted');
    expect(Buffer.byteLength(JSON.stringify(f.row))).toBeLessThanOrEqual(DRAFT_METADATA_LIMITS.persistedBytes);
    for (const fact of f.row.facts as Record<string, unknown>[]) {
      expect((fact.native_fields as Record<string, unknown>).type).not.toHaveProperty('value');
      expect((fact.native_fields as Record<string, unknown>).status).not.toHaveProperty('value');
    }
    expect(readDraftMetadataRows([f.row], mapping, f.resource)).toMatchObject({ status: 'available', value: f.projected.value });
  }, 30_000);
  it.each([4_180_000, 4_193_800])('reserves result framing before persistence for a near-cap invalid member of %i bytes', async length => {
    const f = fixture({ native: { draft_id: 'draft-1', league_id: mapping.scope.externalLeagueId,
      season: '2026', sport: 'nfl', draft_order: { user: 'x'.repeat(length) } } });
    expect(f.projected.status).toBe('accepted');
    expect(Buffer.byteLength(JSON.stringify(f.row.payload))).toBeLessThanOrEqual(DRAFT_METADATA_LIMITS.nativeBytes);
    const attempt = { id: id(6), scopeId: id(9), ordinal: 1, expectedGeneration: 0 };
    const query = vi.fn<(sql: string, values: readonly unknown[]) => readonly DatabaseRow[]>(() => [{ result: { status: 'rejected' } }]);
    const fetch = vi.spyOn(globalThis, 'fetch').mockRejectedValue(Error('provider access forbidden'));
    const store = createLeagueAdministrationMethods(database(query));
    try {
      const persistence = store.recordObservation(f.normalized, undefined, mapping, undefined, undefined, undefined, undefined,
        undefined, undefined, undefined, undefined, undefined, undefined, { attempt });
      if (length === 4_193_800) {
        // The former exact final submission fit under 32 MiB despite its selected
        // row exceeding that limit. Refuse persistence before any write occurs.
        expect(Buffer.byteLength(JSON.stringify({ ...f.normalized, sourceMapping: mapping,
          draftMetadataAcceptance: { attempt }, draftMetadataProjection: f.projected }))).toBeLessThanOrEqual(DRAFT_METADATA_LIMITS.persistedBytes);
        await expect(persistence).rejects.toThrow(/persistence budget/i);
        expect(query).not.toHaveBeenCalled();
      } else {
        await expect(persistence).resolves.toMatchObject({ status: 'rejected' });
        expect(query).toHaveBeenCalledTimes(1);
        expect(Buffer.byteLength(JSON.stringify(f.row))).toBeLessThanOrEqual(DRAFT_METADATA_LIMITS.persistedBytes);
        expect(readDraftMetadataRows([f.row], mapping, f.resource)).toMatchObject({ status: 'available', value: f.projected.value });
      }
      expect(fetch).not.toHaveBeenCalled();
    } finally { fetch.mockRestore(); }
  }, 30_000);
  it.each(['source_mapping', 'content_hash', 'semantic_hash', 'normalized_value', 'source_mapping_revision_id',
    'observation_content_id', 'observation_league_season_id', 'first_receipt_content_id', 'coverage', 'expected_generation',
    'configuration_content_id', 'population_evidence', 'expected_team_count', 'capture_after_reservation', 'reserved_attempt_id',
    'content_accepted', 'head_accepted_id', 'head_generation', 'accepted_at'])(
    'fails closed when %s evidence is forged', key => {
      const { row } = fixture(); expect(readDraftMetadataRows([{ ...row, [key]: 'forged' }], mapping, selection).status).toBe('unavailable');
    });
  it.each(['missing-fact', 'extra-fact', 'canonical-league', 'canonical-match-false', 'canonical-match-missing', 'canonical-match-nonboolean', 'canonical-native', 'canonical-id', 'typed-status', 'typed-settings',
    'missing-slot', 'extra-slot', 'slot-scope', 'slot-value', 'roster-value', 'slot-arity', 'slot-key', 'slot-state', 'slot-number-type', 'roster-arity', 'roster-key', 'roster-state', 'roster-value-type', 'missing-group', 'first-receipt', 'missing-header', 'header-count'])(
    'rejects relational %s corruption rather than returning raw-only metadata', fault => {
      const { row } = fixture(); const changed = structuredClone(row) as Record<string, unknown>;
      const facts = changed.facts as Record<string, unknown>[], slots = facts[0].user_slots as unknown[][], rosters = facts[0].slot_rosters as unknown[][];
      const header = changed.value_header as Record<string, unknown>;
      if (fault === 'missing-fact') facts.pop();
      if (fault === 'extra-fact') facts.push({ ...facts[0] });
      if (fault === 'canonical-league') facts[0].canonical_league_season_id = id(99);
      if (fault === 'canonical-match-false') facts[0].canonical_external_league_matches = false;
      if (fault === 'canonical-match-missing') delete facts[0].canonical_external_league_matches;
      if (fault === 'canonical-match-nonboolean') facts[0].canonical_external_league_matches = 'true';
      if (fault === 'canonical-native') facts[0].canonical_external_draft_id = 'foreign';
      if (fault === 'canonical-id') facts[0].draft_id = id(99);
      if (fault === 'typed-status') facts[0].status_value = 'complete';
      if (fault === 'typed-settings') facts[0].settings = { state: 'supplied', raw: {}, value: {} };
      if (fault === 'missing-slot') slots.pop();
      if (fault === 'extra-slot') slots.push([...slots[0]]);
      if (fault === 'slot-scope') slots[0][0] = 'foreign';
      if (fault === 'slot-value') slots[0][3] = 3;
      if (fault === 'roster-value') rosters[0][3] = 'foreign';
      if (fault === 'slot-arity') slots[0].push('foreign');
      if (fault === 'slot-key') slots[0][0] = 1;
      if (fault === 'slot-state') slots[0][1] = 'unknown';
      if (fault === 'slot-number-type') slots[0][3] = String(slots[0][3]);
      if (fault === 'roster-arity') rosters[0].pop();
      if (fault === 'roster-key') rosters[0][0] = 1;
      if (fault === 'roster-state') rosters[0][1] = 'unknown';
      if (fault === 'roster-value-type') rosters[0][3] = 1;
      if (fault === 'missing-group') delete facts[0].user_slots;
      if (fault === 'first-receipt') header.first_receipt_id = 'invalid';
      if (fault === 'missing-header') changed.value_header = null;
      if (fault === 'header-count') header.valid_identity_count = 1;
      expect(readDraftMetadataRows([changed], mapping, selection).status).toBe('unavailable');
    });
  it('rejects absent or noncontiguous catalog children and accepted incomplete receipts', () => {
    const f = fixture({ kind: 'catalog' }), entries = structuredClone(f.row.entries) as unknown[][];
    entries[0][0] = 7;
    expect(readDraftMetadataRows([{ ...f.row, entries }], mapping, f.resource).status).toBe('unavailable');
    const partial = fixture({ kind: 'catalog', partial: true });
    expect(readDraftMetadataRows([{ ...partial.row, acceptance_id: id(4), generation: 1, source_mapping_revision_id: id(3), accepted_at: at }],
      mapping, { ...partial.resource, receiptId: id(5) }).status).toBe('unavailable');
  });
  it.each(['arity', 'ordinal-type', 'identity-state', 'native-id', 'detail-state'] as const)('rejects malformed compact catalog tuple %s', fault => {
    const f = fixture({ kind: 'catalog' }), entries = structuredClone(f.row.entries) as unknown[][];
    if (fault === 'arity') entries[0].push(id(8));
    if (fault === 'ordinal-type') entries[0][0] = '0';
    if (fault === 'identity-state') entries[0][1] = 'unknown';
    if (fault === 'native-id') entries[0][2] = 12;
    if (fault === 'detail-state') entries[0][3] = 'unknown';
    expect(readDraftMetadataRows([{ ...f.row, entries }], mapping, f.resource).status).toBe('unavailable');
  });
  it('rejects compact links moved between two draft facts even when their user keys match', () => {
    const f = fixture({ kind: 'catalog', catalog: [{ ...native('a'), draft_order: { user: 1 } }, { ...native('b'), draft_order: { user: 2 } }] });
    const facts = structuredClone(f.row.facts) as Record<string, unknown>[];
    [facts[0].user_slots, facts[1].user_slots] = [facts[1].user_slots, facts[0].user_slots];
    expect(readDraftMetadataRows([{ ...f.row, facts }], mapping, f.resource).status).toBe('unavailable');
  });
  it.each(['requestStartedAt', 'requestCompletedAt', 'checkedAt', 'sourceObservedAt'])('rejects invalid %s clocks', key => {
    const { row } = fixture();
    expect(readDraftMetadataRows([{ ...row, provenance: { ...(row.provenance as object), [key]: 'not-a-time' } }], mapping, selection).status).toBe('unavailable');
  });
  it('rejects foreign scope receipts stale revisions wrong season and unsupported acquisition witnesses', () => {
    const { row } = fixture();
    for (const wrong of [{ ...mapping, revisionId: id(99) }, { ...mapping, scope: { ...mapping.scope, season: 2025 } },
      { ...mapping, leagueSeasonId: id(99) }]) expect(readDraftMetadataRows([row], wrong, selection).status).toBe('unavailable');
    expect(readDraftMetadataRows([row], mapping, { ...selection, receiptId: id(99) }).status).toBe('unavailable');
    expect(readDraftMetadataRows([row], mapping, { kind: 'catalog' }).status).toBe('unavailable');
    expect(readDraftMetadataRows([{ ...row, provenance: { ...(row.provenance as object), acquisition: {} } }], mapping, selection).status).toBe('unavailable');
    expect(readDraftMetadataRows([{ ...row, provenance: { ...(row.provenance as object), requestStartedAt: '2026-10-14T12:00:00.000Z' } }], mapping, selection).status).toBe('unavailable');
  });
  it('uses only a stored SELECT with exact mapping and receipt parameters and no private SQL helper execution', async () => {
    const query = vi.fn<(sql: string, values: readonly unknown[]) => readonly DatabaseRow[]>(() => [fixture().row]), fetch = vi.spyOn(globalThis, 'fetch').mockRejectedValue(Error('provider access forbidden'));
    try {
      const store = draftMetadataMethods(database(query));
      expect((await store.readDraftMetadata(mapping, { ...selection, receiptId: id(5) })).status).toBe('available');
      expect(query).toHaveBeenCalledExactlyOnceWith(DRAFT_METADATA_SQL,
        [JSON.stringify({ scope: draftMetadataScope(mapping, selection), policy: DRAFT_METADATA_POLICY }), id(3), 1, id(5)]);
      expect(fetch).not.toHaveBeenCalled();
      expect(DRAFT_METADATA_SQL).not.toMatch(/\b(?:UPDATE|INSERT|DELETE|CALL|fetch)\b/u);
      expect(DRAFT_METADATA_SQL).not.toContain('draft_metadata_typed_value(');
      expect(DRAFT_METADATA_SQL).not.toContain('league_administration_heads');
      expect(DRAFT_METADATA_SQL).toContain('head.accepted_id=accepted.id');
      expect(DRAFT_METADATA_SQL).toContain('entry.content_id=content.id');
      expect(DRAFT_METADATA_SQL).toContain('fact.content_id=content.id');
      expect(DRAFT_METADATA_SQL).toContain('identity.external_league_id=content.external_league_id');
      expect(DRAFT_METADATA_SQL).toContain("fact.native_fields #- '{type,value}' #- '{status,value}'");
      expect(DRAFT_METADATA_SQL.match(/slot.content_id=fact.content_id/g)).toHaveLength(2);
      expect(DRAFT_METADATA_SQL.match(/slot.source_kind=fact.source_kind AND slot.external_draft_id=fact.external_draft_id/g)).toHaveLength(2);
    } finally { fetch.mockRestore(); }
  });
  it('distinguishes missing receipts unavailable databases and disabled storage', async () => {
    expect(readDraftMetadataRows([], mapping, selection)).toEqual({ status: 'missing', reason: 'draft_metadata_capture_missing' });
    expect(readDraftMetadataRows([fixture().row, fixture().row], mapping, selection).status).toBe('unavailable');
    expect((await draftMetadataMethods(database(() => { throw Error('offline'); })).readDraftMetadata(mapping, selection)).status).toBe('unavailable');
    expect(await createLeagueAdministrationStore({ enabled: false, reason: 'missing-database-url' }).readDraftMetadata!(mapping, selection)).toEqual({ status: 'disabled' });
  });
  it('reserves the selected resource before acquisition and rejects invalid scope and malformed tokens', async () => {
    const query = vi.fn<(sql: string, values: readonly unknown[]) => readonly DatabaseRow[]>(() => [{ result: { id: id(6), scopeId: id(9), ordinal: '2', expectedGeneration: '1' } }]);
    const store = draftMetadataMethods(database(query));
    expect(await store.beginDraftMetadataAttempt(mapping, selection, id(6))).toEqual({ id: id(6), scopeId: id(9), ordinal: 2, expectedGeneration: 1 });
    expect(JSON.parse(String(query.mock.calls[0][1][1]))).toEqual(selection);
    await expect(store.beginDraftMetadataAttempt({ ...mapping, scope: { ...mapping.scope, season: 2025 } }, selection, id(6))).rejects.toThrow();
    await expect(draftMetadataMethods(database(() => [{ result: { id: id(99) } }])).beginDraftMetadataAttempt(mapping, selection, id(6))).rejects.toThrow();
    expect(query).toHaveBeenCalledTimes(1);
  });
  it('adds independent metadata only for the explicit existing writer option', async () => {
    const f = fixture(), attempt = { id: id(6), scopeId: id(9), ordinal: 1, expectedGeneration: 0 };
    const query = vi.fn<(sql: string, values: readonly unknown[]) => readonly DatabaseRow[]>(() => [{ result: { status: 'rejected' } }]), store = createLeagueAdministrationMethods(database(query));
    await store.recordObservation(f.normalized);
    expect(JSON.parse(String(query.mock.calls[0][1][0]))).not.toHaveProperty('draftMetadataProjection');
    await store.recordObservation(f.normalized, undefined, mapping, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, { attempt });
    expect(JSON.parse(String(query.mock.calls[1][1][0]))).toMatchObject({ draftMetadataAcceptance: { attempt }, draftMetadataProjection: f.projected });
  });
  it('keeps fresh runtime provisioning limited to typed SELECT and the two writer entry points', async () => {
    const provision = await readFile(new URL('../../../scripts/provision-runtime-role.sql', import.meta.url), 'utf8');
    const block = provision.split('-- BEGIN OPTIONAL DRAFT METADATA GRANTS')[1]?.split('-- END OPTIONAL DRAFT METADATA GRANTS')[0];
    expect(block).toBeTruthy();
    for (const table of ['league_season_drafts', 'league_draft_metadata_contents', 'league_draft_metadata_entries',
      'league_draft_metadata_facts', 'league_draft_metadata_user_slots', 'league_draft_metadata_slot_rosters']) expect(block).toContain("'" + table + "'");
    expect(block).toContain("GRANT SELECT ON TABLE public.%I TO league_one_runtime");
    expect(block).toContain("REVOKE ALL ON FUNCTION %s FROM PUBLIC,league_one_runtime");
    expect(block).toContain('public.record_league_administration_observation_v52(jsonb)');
    expect(block?.match(/GRANT EXECUTE ON FUNCTION/gu)).toHaveLength(2);
    expect(block).toContain('public.begin_draft_metadata_attempt(jsonb,jsonb,uuid,jsonb)');
    expect(block).toContain('public.record_league_administration_observation(jsonb)');
  });
});
