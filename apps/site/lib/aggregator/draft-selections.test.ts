import { describe, expect, it } from 'vitest';
import { DRAFT_SELECTIONS_VERSION, draftSelectionsScope, projectDraftSelections } from './draft-selections';
import { normalizeAdministrationObservation } from '../league-administration/normalize';
import type { JsonObject, JsonValue } from '../league-administration/contracts';
const row = { draft_id: '90071992547409939999', league_id: '123456789', season: '2026', sport: 'nfl' };
const at = '2026-10-14T10:00:00.000Z';
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const mapping = { connectionId: id(1), leagueSeasonId: id(2), revisionId: id(3), generation: 1,
  scope: { leagueKey: 'cp17-unit', provider: 'sleeper' as const, externalLeagueId: row.league_id, season: 2026 } };
function normalized(payload: JsonValue, completeness: 'complete' | 'partial' = 'complete') {
  return normalizeAdministrationObservation({ schemaVersion: 'league-administration-v1', normalizerVersion: 'sleeper-administration-v1',
    dialect: 'sleeper-nfl-v1', scope: mapping.scope, family: 'drafts', week: null, completeness, payload,
    provenance: { origin: 'network', requestStartedAt: at, requestCompletedAt: at, sourceObservedAt: completeness === 'complete' ? at : null, checkedAt: at } });
}
const payload = (picks: JsonValue): JsonObject => ({ selectionsVersion: DRAFT_SELECTIONS_VERSION, kind: 'selections', externalDraftId: row.draft_id, catalog: row, picks });
const project = (picks: JsonValue, completeness: 'complete' | 'partial' = 'complete') => projectDraftSelections(normalized(payload(picks), completeness));
describe('independent native draft selection projection', () => {
  it('preserves arbitrary source order native pick identity and optional native fields', () => {
    const result = project([{ pick_no: 12, round: 2, draft_slot: 1, player_id: '007', roster_id: '90071992547409939998', picked_by: '', is_keeper: null,
      metadata: {}, future_native: { false: false, zero: 0 } }, { pick_no: 2, player_id: 'missing' }]);
    expect(result).toMatchObject({ status: 'accepted', value: { complete: true, totalCount: 2, entries: [
      { sourceOrdinal: 0, identityState: 'valid', pickNumber: { value: 12 }, round: { value: 2 }, rosterId: { value: '90071992547409939998' },
        pickedBy: { state: 'empty', raw: '', value: '' }, isKeeper: { state: 'null' }, metadata: { state: 'empty' }, extensions: { future_native: { false: false, zero: 0 } } },
      { sourceOrdinal: 1, pickNumber: { value: 2 }, round: { state: 'missing' }, rosterId: { state: 'missing' }, draftSlot: { state: 'missing' } },
    ] } });
  });
  it.each([null, {}, 'invalid', false, 0])('retains malformed picks %j as observed noncomplete evidence', picks => {
    expect(project(picks)).toMatchObject({ status: 'accepted', value: { complete: false, totalCount: null, entries: [],
      picksState: picks === null ? 'null' : 'invalid', reason: 'draft-selections-invalid-picks' } });
  });
  it('distinguishes missing and complete empty arrays from partial empty arrays', () => {
    const missing = { ...payload([]) }; delete missing.picks;
    expect(projectDraftSelections(normalized(missing))).toMatchObject({ value: { complete: false, picksState: 'missing' } });
    expect(project([])).toMatchObject({ value: { complete: true, picksState: 'empty', totalCount: 0 } });
    expect(project([], 'partial')).toMatchObject({ value: { complete: false, picksState: 'empty', reason: 'draft-selections-source-partial' } });
  });
  it('retains duplicates including exact repeats and contradictions without last wins', () => {
    expect(project([{ pick_no: 1, player_id: 'a' }, { pick_no: 1, player_id: 'a' }, { pick_no: 2, draft_id: 'foreign' },
      { pick_no: '3' }, null, { pick_no: 4, league_id: 'foreign' }])).toMatchObject({ value: { complete: false, entries: [
      { identityState: 'duplicate' }, { identityState: 'duplicate' }, { identityState: 'conflict' }, { identityState: 'invalid' },
      { identityState: 'invalid', raw: null }, { identityState: 'conflict' } ] } });
  });
  it('preserves invalid optional values without replacing valid native pick identity', () => {
    expect(project([{ pick_no: 1, round: 0, draft_slot: false, player_id: ' bad ', roster_id: 0, is_keeper: 'yes', metadata: [], picked_by: false }]))
      .toMatchObject({ value: { complete: true, entries: [{ identityState: 'valid', round: { state: 'invalid', raw: 0 },
        draftSlot: { state: 'invalid' }, playerId: { state: 'invalid' }, rosterId: { state: 'invalid' }, isKeeper: { state: 'invalid' },
        metadata: { state: 'invalid' }, pickedBy: { state: 'invalid' } }] } });
  });
  it('does not change native pick identity when player round or team is corrected', () => {
    const a = project([{ pick_no: 9, round: 1, player_id: 'a', roster_id: 1 }]);
    const b = project([{ pick_no: 9, round: 2, player_id: 'b', roster_id: 2 }]);
    expect(a).toMatchObject({ value: { entries: [{ pickNumber: { value: 9 } }] } });
    expect(b).toMatchObject({ value: { entries: [{ pickNumber: { value: 9 } }] } });
    expect(b).not.toEqual(a);
  });
  it('bounds arrays and native nesting and verifies normalized evidence', () => {
    expect(project(Array.from({ length: 10001 }, (_, i) => ({ pick_no: i + 1 })))).toMatchObject({ status: 'rejected' });
    let deep: JsonValue = {}; for (let i = 0; i < 65; i++) deep = { nested: deep };
    expect(project([{ pick_no: 1, metadata: deep }])).toMatchObject({ status: 'rejected' });
    const good = normalized(payload([]));
    expect(projectDraftSelections({ ...good, contentHash: '0'.repeat(64) }).status).toBe('rejected');
    expect(projectDraftSelections({ ...good, value: { forged: true } } as never).status).toBe('rejected');
    expect(projectDraftSelections(normalized({ ...payload([]), catalog: { ...row, season: '2025' } })).status).toBe('rejected');
  });
  it('keeps bounded catalog inventory counts and invalid native identities', () => {
    const catalog = Array.from({ length: 9 }, (_, i) => ({ ...row, draft_id: 'draft' + i }));
    expect(projectDraftSelections(normalized({ selectionsVersion: DRAFT_SELECTIONS_VERSION, kind: 'catalog', catalog, selections: [], reason: 'draft-inventory-limit' }, 'partial')))
      .toMatchObject({ value: { complete: false, totalCount: 9, attemptedSelectionCount: 0, unrequestedSelectionCount: 9,
        entries: expect.arrayContaining([{ sourceOrdinal: 8, identityState: 'valid', externalDraftId: 'draft8', selectionState: 'unrequested' }]) } });
    expect(projectDraftSelections(normalized({ selectionsVersion: DRAFT_SELECTIONS_VERSION, kind: 'catalog', catalog: [row, row], selections: [], reason: null }, 'partial')))
      .toMatchObject({ value: { validIdentityCount: 0, invalidIdentityCount: 2 } });
  });
  it('uses separate catalog and native draft scopes without admitting another season', () => {
    expect(draftSelectionsScope(mapping, { kind: 'catalog' }).entityId).toBe('catalog');
    expect(draftSelectionsScope(mapping, { kind: 'selections', externalDraftId: row.draft_id }).entityId).toBe(`draft:${row.draft_id}:selections`);
    expect(() => draftSelectionsScope({ ...mapping, scope: { ...mapping.scope, season: 2025 } }, { kind: 'catalog' })).toThrow();
  });
});
