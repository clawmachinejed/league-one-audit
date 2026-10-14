import { describe, expect, it, vi } from 'vitest';
import type { DatabaseClient, DatabaseRow } from '../../database';
import { DRAFT_SELECTIONS_VERSION, DRAFT_SELECTIONS_POLICY, draftSelectionsScope, projectDraftSelections } from '../../aggregator/draft-selections';
import { normalizeAdministrationObservation } from '../normalize';
import { createLeagueAdministrationStore } from '../store';
import { draftSelectionsCoverage, draftSelectionsMethods, readDraftSelectionsRows } from './draft-selections';
vi.mock('server-only', () => ({}));
it('reads immutable CP19 witnessed receipts and rejects wrong endpoint or unproved causal lineage', () => {
  const f = fixture();
  const acquisition = { version: 'public-network-capture-v1', mapping,
    work: { kind: 'drafts', resource: 'selections', requestId: id(90), revision: 4, externalLeagueId: mapping.scope.externalLeagueId,
      season: 2026, externalDraftId: selection.externalDraftId, catalogReceiptId: id(91) },
    fence: { jobKey: 'league-administration-public-intake', workerId: id(92), generation: 1, deadlineAt: at },
    dispatchNonce: id(93), attempts: { draftSelections: { id: id(6), nonce: id(94) } } };
  const row = { ...f.row, provenance: { ...f.normalized.envelope.provenance, acquisition } };
  expect(readDraftSelectionsRows([row], mapping, { ...selection, receiptId: id(5) })).toMatchObject({ status: 'available', selection: 'receipt' });
  expect(readDraftSelectionsRows([{ ...row, capture_after_reservation: false }], mapping, selection).status).toBe('unavailable');
  expect(readDraftSelectionsRows([{ ...row, provenance: { ...row.provenance, acquisition: { ...acquisition,
    work: { ...acquisition.work, externalDraftId: 'wrong-draft' } } } }], mapping, selection).status).toBe('unavailable');
});
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const at = '2026-10-14T12:00:00.000Z';
const mapping = { connectionId: id(1), leagueSeasonId: id(2), revisionId: id(3), generation: 1,
  scope: { leagueKey: 'cp17-unit', provider: 'sleeper' as const, externalLeagueId: '90071992547409999', season: 2026 } };
const selection = { kind: 'selections' as const, externalDraftId: 'draft1' };
function fixture(partial = false, diagnostic = false) {
  const payload = { selectionsVersion: DRAFT_SELECTIONS_VERSION, kind: 'selections', externalDraftId: 'draft1',
    catalog: { draft_id: 'draft1', league_id: mapping.scope.externalLeagueId, season: '2026' },
    picks: [{ pick_no: 2, round: 1, draft_slot: 3, player_id: '007', roster_id: '1', picked_by: '', is_keeper: null, metadata: {},
      ...(diagnostic ? { league_id: 'foreign' } : {}) }] };
  const normalized = normalizeAdministrationObservation({ schemaVersion: 'league-administration-v1', normalizerVersion: 'sleeper-administration-v1',
    dialect: 'sleeper-nfl-v1', scope: mapping.scope, family: 'drafts', week: null, completeness: partial ? 'partial' : 'complete', payload,
    provenance: { origin: 'network', requestStartedAt: at, requestCompletedAt: at, sourceObservedAt: partial ? null : at, checkedAt: at } });
  const projected = projectDraftSelections(normalized); if (projected.status !== 'accepted' || projected.value.kind !== 'selections') throw Error('Invalid fixture.');
  const native = projected.value.entries[0];
  const row: DatabaseRow = { identity: { scope: draftSelectionsScope(mapping, selection), policy: DRAFT_SELECTIONS_POLICY },
    head_accepted_id: id(4), head_generation: '1', acceptance_id: partial ? null : id(4), generation: partial ? null : '1',
    source_mapping_revision_id: partial ? null : id(3), accepted_at: partial ? null : at, receipt_id: id(5), attempt_id: id(6),
    reserved_attempt_id: id(6), ordinal: '1', expected_generation: '0', legacy_observation_id: id(7), provenance: normalized.envelope.provenance,
    coverage: draftSelectionsCoverage(projected), configuration_content_id: null, population_evidence: null, expected_team_count: null,
    source_mapping: mapping, capture_after_reservation: true, content_id: id(8), content_hash: normalized.contentHash,
    semantic_hash: normalized.semanticHash, payload, normalized_value: normalized.value, normalizer_version: 'sleeper-administration-v1',
    completeness: normalized.envelope.completeness, content_accepted: false, league_season_id: id(2), provider: 'sleeper',
    external_league_id: mapping.scope.externalLeagueId, family: 'drafts', week: 0, observation_content_id: id(8), observation_league_season_id: id(2),
    first_receipt_content_id: id(8), value_header: { content_id: id(8), first_receipt_id: id(5), value_version: DRAFT_SELECTIONS_VERSION,
      kind: 'selections', external_draft_id: 'draft1', complete: !partial, picks_state: 'supplied', total_count: 1,
      valid_identity_count: 0, invalid_identity_count: 0, attempted_selection_count: 0, succeeded_selection_count: 0, failed_selection_count: 0,
      unrequested_selection_count: 0, reason: projected.value.reason }, entries: [], facts: [{ content_id: id(8), source_ordinal: 0,
      identity_state: native.identityState, external_draft_id: 'draft1', draft_id: id(9), selection_id: diagnostic ? null : id(10), pick_number: '2', round_value: '1', draft_slot: '3',
      player_id: '007', external_roster_id: '1', season_team_id: diagnostic ? null : id(11), picked_by: '', is_keeper: null, native_fields: native,
      metadata: native.metadata, extensions: native.extensions, raw: native.raw, canonical_draft_league_season_id: id(2),
      canonical_draft_provider: 'sleeper', canonical_draft_external_league_id: mapping.scope.externalLeagueId,
      canonical_draft_external_id: 'draft1', canonical_selection_draft_id: diagnostic ? null : id(9), canonical_pick_number: diagnostic ? null : '2', canonical_team_league_season_id: diagnostic ? null : id(2),
      canonical_team_provider: diagnostic ? null : 'sleeper', canonical_team_external_league_id: diagnostic ? null : mapping.scope.externalLeagueId, canonical_team_external_roster_id: diagnostic ? null : '1' }],
    link_header: partial ? null : { selection_acceptance_id: id(4), selection_receipt_id: id(5), league_season_id: id(2), source_mapping_revision_id: id(3),
      selection_content_id: id(8), link_version: 'sleeper-draft-selection-player-links-v1', directory_version_id: null,
      resolved_at: at, mapping_evaluated_at: at, outcome: 'owner_unqualified', reasons: ['owner_unqualified'],
      selection_count: 1, resolved_count: 0, unresolved_count: 1, conflict_count: 0 }, player_links: [], directory_id: null, directory_content_id: null };
  return { row, normalized, projected };
}
const database = (query: (sql: string, parameters: readonly unknown[]) => readonly DatabaseRow[]): DatabaseClient => ({ enabled: true,
  async query<Row extends DatabaseRow>(sql: string, parameters: readonly unknown[] = []) { return query(sql, parameters) as readonly Row[]; } });
describe('stored draft selections', () => {
  it('reconstructs native values from relational columns and freezes receipt linkage', () => {
    const f = fixture();
    expect(readDraftSelectionsRows([f.row], mapping, selection)).toMatchObject({ status: 'available', value: f.projected.value,
      playerLinks: { outcome: 'owner_unqualified', counts: { selections: 1, unresolved: 1 }, links: [] } });
    expect(readDraftSelectionsRows([f.row], mapping, { ...selection, receiptId: id(5) })).toMatchObject({ status: 'available', selection: 'receipt' });
  });
  it('retains partial exact receipt evidence and withholds current availability', () => {
    const f = fixture(true);
    expect(readDraftSelectionsRows([f.row], mapping, { ...selection, receiptId: id(5) })).toMatchObject({ status: 'observed', value: f.projected.value, playerLinks: null });
    expect(readDraftSelectionsRows([f.row], mapping, selection).status).toBe('unavailable');
  });
  it('retains diagnostic native roster references without manufacturing canonical team links', () => {
    const f = fixture(true, true), resource = { ...selection, receiptId: id(5) };
    expect(readDraftSelectionsRows([f.row], mapping, resource)).toMatchObject({ status: 'observed', value: { entries: [
      { identityState: 'conflict', rosterId: { state: 'supplied', value: '1' }, extensions: { league_id: 'foreign' } }] } });
    const facts = structuredClone(f.row.facts) as Record<string, unknown>[];
    Object.assign(facts[0], { season_team_id: id(11), canonical_team_league_season_id: id(2), canonical_team_provider: 'sleeper',
      canonical_team_external_league_id: mapping.scope.externalLeagueId, canonical_team_external_roster_id: '1' });
    expect(readDraftSelectionsRows([{ ...f.row, facts }], mapping, resource).status).toBe('unavailable');
  });
  it.each(['pick_number','round_value','player_id','external_roster_id','canonical_pick_number','canonical_draft_external_id','canonical_team_league_season_id','source_ordinal'])
  ('rejects mutated typed or lineage column %s', key => {
    const f = fixture(), facts = structuredClone(f.row.facts) as Record<string, unknown>[]; facts[0][key] = key === 'source_ordinal' ? 1 : 'forged';
    expect(readDraftSelectionsRows([{ ...f.row, facts }], mapping, selection).status).toBe('unavailable');
  });
  it.each(['content_hash','semantic_hash','source_mapping_revision_id','reserved_attempt_id','observation_content_id','first_receipt_content_id'])
  ('rejects forged receipt evidence %s', key => {
    const f = fixture(); expect(readDraftSelectionsRows([{ ...f.row, [key]: id(99) }], mapping, selection).status).toBe('unavailable');
  });
  it('does not borrow foreign receipt or current directory links', () => {
    const f = fixture();
    expect(readDraftSelectionsRows([f.row], mapping, { ...selection, receiptId: id(99) }).status).toBe('unavailable');
    expect(readDraftSelectionsRows([{ ...f.row, link_header: { ...(f.row.link_header as object), directory_version_id: id(99) } }], mapping, selection).status).toBe('unavailable');
    expect(readDraftSelectionsRows([{ ...f.row, link_header: null }], mapping, selection).status).toBe('unavailable');
  });
  it('validates frozen player kind and mapping proof without using current mappings', () => {
    const f = fixture(), link = { selection_acceptance_id: id(4), source_ordinal: 0, selection_id: id(10), native_player_id: '007',
      entity_kind: 'player', identity_state: 'resolved', reasons: [], directory_identity_status: 'valid',
      kind_evidence: { position: 'LB', fantasyPositions: ['IDP'], positionState: 'supplied', fantasyPositionsState: 'supplied' },
      canonical_entity_id: id(15), mapping_proof: [{ provider: 'sleeper', entityKind: 'player', externalId: '007', scoringEntityId: id(15),
        mappingStatus: 'verified', validFrom: at, validTo: null, canonicalKind: 'player' }] };
    const resolved = { ...f.row, link_header: { ...(f.row.link_header as object), directory_version_id: id(14), outcome: 'complete',
      reasons: [], resolved_count: 1, unresolved_count: 0 }, player_links: [link], directory_id: id(14), directory_content_id: id(16) };
    expect(readDraftSelectionsRows([resolved], mapping, selection)).toMatchObject({ status: 'available', playerLinks: { links: [{ canonicalEntityId: id(15) }] } });
    expect(readDraftSelectionsRows([{ ...resolved, player_links: [{ ...link, kind_evidence: { ...link.kind_evidence, position: 'DEF' } }] }], mapping, selection).status).toBe('unavailable');
    expect(readDraftSelectionsRows([{ ...resolved, player_links: [{ ...link, mapping_proof: [{ ...link.mapping_proof[0], validTo: at }] }] }], mapping, selection).status).toBe('unavailable');
  });
  it('reserves native relational and immutable link framing before query submission', async () => {
    const f = fixture(), payload = { ...(f.normalized.envelope.payload as Record<string, unknown>), picks: [{ pick_no: 1, picked_by: 'x'.repeat(6_300_000) }] };
    const input = normalizeAdministrationObservation({ ...f.normalized.envelope, payload: payload as never });
    expect(projectDraftSelections(input).status).toBe('accepted');
    const query = vi.fn(() => [{ result: { status: 'rejected' } }]), store = createLeagueAdministrationStore(database(query));
    await expect(store.recordObservation(input, undefined, mapping, undefined, undefined, undefined, undefined, undefined, undefined,
      undefined, undefined, undefined, undefined, undefined, { attempt: { id: id(6), scopeId: id(17), ordinal: 1, expectedGeneration: 0 } })).rejects.toThrow('persistence budget');
    expect(query).not.toHaveBeenCalled();
  }, 30_000);
  it.each([
    ['2026-10-14T12:00:00.123000Z', '2026-10-14T12:00:00.123900Z', 'available'],
    ['2026-10-14T12:00:00.123200Z', null, 'unavailable'],
    ['2026-10-14T12:00:00.123000Z', '2026-10-14T12:00:00.123099Z', 'unavailable'],
    ['2026-10-14 12:00:00.1231+00', '2026-10-14T12:00:00.123900Z', 'available'],
  ])('checks microsecond mapping interval %s to %s without rounding the frozen proof', (validFrom, validTo, expected) => {
    const f = fixture(), evaluated = '2026-10-14T12:00:00.123100Z', resolved = '2026-10-14T12:00:00.123800Z';
    const proof = { provider: 'sleeper', entityKind: 'player', externalId: '007', scoringEntityId: id(15), mappingStatus: 'verified',
      validFrom, validTo, canonicalKind: 'player' };
    const row = { ...f.row, directory_id: id(14), directory_content_id: id(16), link_header: { ...(f.row.link_header as object),
      directory_version_id: id(14), outcome: 'complete', reasons: [], resolved_count: 1, unresolved_count: 0,
      resolved_at: resolved, mapping_evaluated_at: evaluated }, player_links: [{ selection_acceptance_id: id(4), source_ordinal: 0,
      selection_id: id(10), native_player_id: '007', entity_kind: 'player', identity_state: 'resolved', reasons: [], directory_identity_status: 'valid',
      kind_evidence: { position: 'LB', fantasyPositions: ['IDP'], positionState: 'supplied', fantasyPositionsState: 'supplied' },
      canonical_entity_id: id(15), mapping_proof: [proof] }] };
    const read = readDraftSelectionsRows([row], mapping, selection); expect(read.status).toBe(expected);
    if (expected === 'available') expect(read).toMatchObject({ playerLinks: { resolvedAt: resolved, mappingEvaluatedAt: evaluated, links: [{ mappingProof: [proof] }] } });
  });
  it('reads without provider access and performs no I/O when disabled', async () => {
    const f = fixture(), query = vi.fn(() => [f.row]), fetch = vi.spyOn(globalThis, 'fetch').mockRejectedValue(Error('forbidden'));
    try {
      expect((await draftSelectionsMethods(database(query)).readDraftSelections(mapping, selection)).status).toBe('available');
      expect(query).toHaveBeenCalledOnce(); expect(fetch).not.toHaveBeenCalled();
      const disabled = createLeagueAdministrationStore({ enabled: false, reason: 'missing-database-url' });
      expect(await disabled.readDraftSelections!(null as never, null as never)).toEqual({ status: 'disabled' });
      await expect(disabled.beginDraftSelectionsAttempt!(null as never, null as never, '')).rejects.toThrow('disabled');
    } finally { fetch.mockRestore(); }
  });
});
