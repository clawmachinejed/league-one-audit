import { describe, expect, it, vi } from 'vitest';
import { DRAFT_METADATA_VERSION, projectDraftMetadata, draftMetadataScope } from './draft-metadata';
import { normalizeAdministrationObservation } from '../league-administration/normalize';
import type { AdministrationEnvelope, JsonValue } from '../league-administration/contracts';
import { assertSourceScope } from './validation';

vi.mock('server-only', () => ({}));
const row = { draft_id: '90071992547409931234', league_id: '123456789', season: '2026', sport: 'nfl' };
const time = '2026-10-14T01:00:00.000Z';
function observation(payload: JsonValue, completeness: 'complete' | 'partial' = 'complete') {
  return normalizeAdministrationObservation({ schemaVersion: 'league-administration-v1', normalizerVersion: 'sleeper-administration-v1', dialect: 'sleeper-nfl-v1',
    scope: { leagueKey: 'fixture', provider: 'sleeper', externalLeagueId: row.league_id, season: 2026 }, family: 'drafts', week: null,
    payload, completeness, provenance: { origin: 'network', requestStartedAt: time, requestCompletedAt: time, sourceObservedAt: time, checkedAt: time } });
}
const detail = (draft: JsonValue, catalog: JsonValue = row) => observation({ metadataVersion: DRAFT_METADATA_VERSION, kind: 'detail', externalDraftId: row.draft_id, catalog, draft });
const catalog = (rows: JsonValue, details: JsonValue = [], reason: string | null = null, completeness: 'complete' | 'partial' = 'complete') =>
  observation({ metadataVersion: DRAFT_METADATA_VERSION, kind: 'catalog', catalog: rows, details, reason }, completeness);

describe('independent current-season draft metadata', () => {
  it('passes catalog and detail identities through the existing shared scope boundary', () => {
    const mapping = { connectionId: '00000000-0000-4000-8000-000000000001', leagueSeasonId: '00000000-0000-4000-8000-000000000002',
      revisionId: '00000000-0000-4000-8000-000000000003', generation: 1,
      scope: { leagueKey: 'fixture', provider: 'sleeper' as const, externalLeagueId: row.league_id, season: 2026 } };
    for (const resource of [{ kind: 'catalog' as const }, { kind: 'detail' as const, externalDraftId: row.draft_id }]) {
      const scope = draftMetadataScope(mapping, resource);
      expect(() => assertSourceScope(scope)).not.toThrow();
      expect(() => assertSourceScope({ ...scope, family: 'unknown-resource' })).toThrow('scope.family');
    }
  });
  it('accepts metadata from a legacy-rejected document without inventing picks or trades', () => {
    const input = detail({ ...row, status: 'pre_draft', settings: { rounds: 0, reversal: false }, metadata: { future: null } });
    expect(input.status).toBe('rejected');
    expect(input.value).toBeNull();
    expect(projectDraftMetadata(input)).toMatchObject({ status: 'accepted', value: { kind: 'detail', externalDraftId: row.draft_id,
      picks: 'not-requested', tradedPicks: 'not-requested', detail: { status: { state: 'supplied', value: 'pre_draft' },
        settings: { state: 'supplied', value: { rounds: 0, reversal: false } } } } });
  });
  it('preserves absent, null, empty, invalid, zero, false and unknown native fields', () => {
    const result = projectDraftMetadata(detail({ ...row, type: '', status: false, settings: {}, metadata: null,
      start_time: 0, last_picked: -1, draft_order: {}, slot_to_roster_id: [], future_native: { false_flag: false, zero: 0 } }));
    expect(result).toMatchObject({ status: 'accepted', value: { detail: {
      type: { state: 'empty', raw: '', value: '' }, status: { state: 'invalid', raw: false, value: null },
      settings: { state: 'empty', value: {} }, metadata: { state: 'null', value: null }, created: { state: 'missing' },
      startTime: { state: 'supplied', raw: 0, value: 0 }, lastPicked: { state: 'invalid', raw: -1 },
      draftOrder: { state: 'empty', value: {} }, slotToRosterId: { state: 'invalid', raw: [] },
      extensions: { future_native: { false_flag: false, zero: 0 } } } } });
  });
  it('keeps user→slot and slot→roster identities distinct, including invalid native members', () => {
    const result = projectDraftMetadata(detail({ ...row, draft_order: { '90071992547409939999': 1, manager: null, invalid: 0 },
      slot_to_roster_id: { '1': '90071992547409935555', '2': 2, '3': false } }));
    expect(result).toMatchObject({ status: 'accepted', value: { detail: {
      userSlots: [{ externalUserId: '90071992547409939999', slot: { state: 'supplied', value: 1 } },
        { externalUserId: 'invalid', slot: { state: 'invalid', raw: 0 } }, { externalUserId: 'manager', slot: { state: 'null' } }],
      slotRosters: [{ slotKey: '1', externalRosterId: { value: '90071992547409935555' } },
        { slotKey: '2', externalRosterId: { value: '2', raw: 2 } }, { slotKey: '3', externalRosterId: { state: 'invalid', raw: false } }] } } });
  });
  it('retains ordinary status/settings/order drift between independent catalog and detail observations', () => {
    expect(projectDraftMetadata(detail({ ...row, status: 'drafting', settings: { rounds: 4 } }, { ...row, status: 'pre_draft', settings: { rounds: 3 } })))
      .toMatchObject({ status: 'accepted', value: { catalog: { status: { value: 'pre_draft' } }, detail: { status: { value: 'drafting' } } } });
  });
  it.each([{ ...row, league_id: '999' }, { ...row, season: '2025' }, { ...row, sport: 'nba' }, { ...row, draft_id: 'other' }])('rejects actual detail identity mismatch %j', changed => {
    expect(projectDraftMetadata(detail(changed)).status).toBe('rejected');
  });
  it('keeps the complete nine-draft inventory and reports no attempted detail reads', () => {
    const rows = Array.from({ length: 9 }, (_, i) => ({ ...row, draft_id: `draft${i}` }));
    expect(projectDraftMetadata(catalog(rows, [], 'draft-inventory-limit', 'partial'))).toMatchObject({ status: 'accepted', value: {
      complete: false, totalCount: 9, validIdentityCount: 9, invalidIdentityCount: 0, attemptedDetailCount: 0,
      succeededDetailCount: 0, failedDetailCount: 0, unrequestedDetailCount: 9, entries: expect.arrayContaining([{ sourceOrdinal: 8,
        identityState: 'valid', externalDraftId: 'draft8', metadata: null, detailState: 'unrequested' }]) } });
  });
  it('counts duplicate and foreign identities honestly without retaining either as a valid metadata identity', () => {
    expect(projectDraftMetadata(catalog([row, row, { ...row, draft_id: 'foreign', league_id: 'elsewhere' }, null], [], 'metadata-source-partial', 'partial')))
      .toMatchObject({ status: 'accepted', value: { complete: false, totalCount: 4, validIdentityCount: 0, invalidIdentityCount: 4,
        attemptedDetailCount: 0, unrequestedDetailCount: 4 } });
  });
  it('distinguishes known complete-empty from transport-unknown and partial sibling failure', () => {
    expect(projectDraftMetadata(catalog([]))).toMatchObject({ status: 'accepted', value: { complete: true, totalCount: 0 } });
    expect(projectDraftMetadata(catalog(null, [], 'metadata-source-partial', 'partial'))).toMatchObject({ status: 'accepted', value: { complete: false, totalCount: null } });
    expect(projectDraftMetadata(catalog([row, { ...row, draft_id: 'two' }], [{ externalDraftId: row.draft_id, state: 'succeeded' },
      { externalDraftId: 'two', state: 'failed' }], 'metadata-source-partial', 'partial'))).toMatchObject({ status: 'accepted', value: {
        complete: false, totalCount: 2, attemptedDetailCount: 2, succeededDetailCount: 1, failedDetailCount: 1, unrequestedDetailCount: 0 } });
  });
  it('rejects fabricated detail outcomes and native/normalized content identity', () => {
    expect(projectDraftMetadata(catalog([row], [{ externalDraftId: 'foreign', state: 'succeeded' }])).status).toBe('rejected');
    const input = detail(row);
    expect(projectDraftMetadata({ ...input, contentHash: '0'.repeat(64) }).status).toBe('rejected');
    expect(projectDraftMetadata({ ...input, status: 'accepted' }).status).toBe('rejected');
  });
  it('keeps acquisition clocks outside native content identities', () => {
    const first = detail(row);
    const next = normalizeAdministrationObservation({ ...first.envelope, provenance: { ...first.envelope.provenance,
      requestStartedAt: '2026-10-14T02:00:00.000Z', requestCompletedAt: '2026-10-14T02:00:00.000Z', sourceObservedAt: '2026-10-14T02:00:00.000Z', checkedAt: '2026-10-14T02:00:00.000Z' } });
    expect(next.contentHash).toBe(first.contentHash);
    expect(projectDraftMetadata(next)).toEqual(projectDraftMetadata(first));
  });
  it.each(['schema', 'normalizer', 'dialect', 'clock', 'cache', 'ordering', 'observation'] as const)('rejects invalid %s evidence independently of legacy rejection', kind => {
    const input = detail(row), envelope = structuredClone(input.envelope);
    const changed = kind === 'schema' ? { ...envelope, schemaVersion: 'wrong' } : kind === 'normalizer' ? { ...envelope, normalizerVersion: 'wrong' }
      : kind === 'dialect' ? { ...envelope, dialect: 'wrong' } : { ...envelope, provenance: { ...envelope.provenance,
        ...(kind === 'clock' ? { requestStartedAt: 'not-a-date' } : kind === 'cache' ? { origin: 'cache' }
          : kind === 'ordering' ? { checkedAt: '2025-01-01T00:00:00Z' } : { sourceObservedAt: null }) } };
    expect(projectDraftMetadata(normalizeAdministrationObservation(changed as AdministrationEnvelope)).status).toBe('rejected');
  });
  it('does not reinterpret the old full-bundle payload or accept a non2026 scope', () => {
    const legacy = observation([{ catalog: row, draft: row, picks: [], traded_picks: [] }]);
    expect(legacy.status).toBe('accepted');
    expect(projectDraftMetadata(legacy).status).toBe('rejected');
    const input = detail(row);
    expect(projectDraftMetadata(normalizeAdministrationObservation({ ...input.envelope,
      scope: { ...input.envelope.scope, season: 2025 } } as AdministrationEnvelope)).status).toBe('rejected');
    expect(() => draftMetadataScope({} as never, { kind: 'catalog' })).toThrow();
  });
  it('does not mistake unrelated legacy validation failures for the intentional payload-shape gap', () => {
    const input = detail(row);
    const badIdentity = normalizeAdministrationObservation({ ...input.envelope, scope: { ...input.envelope.scope, leagueKey: '' } });
    expect(badIdentity.diagnostics[0]).toMatchObject({ code: 'invalid_identifier', path: 'scope.leagueKey' });
    expect(projectDraftMetadata(badIdentity).status).toBe('rejected');
    const nonIso = normalizeAdministrationObservation({ ...input.envelope, provenance: { origin: 'network',
      requestStartedAt: '10/14/2026', requestCompletedAt: '10/14/2026', sourceObservedAt: '10/14/2026', checkedAt: '10/14/2026' } });
    expect(nonIso.diagnostics[0].code).toBe('invalid_timestamp');
    expect(projectDraftMetadata(nonIso).status).toBe('rejected');
  });
  it('enforces transport structure bounds for direct projection callers', () => {
    let nested: JsonValue = null;
    for (let depth = 0; depth < 65; depth++) nested = { child: nested };
    expect(projectDraftMetadata(detail({ ...row, metadata: { nested } }))).toMatchObject({ status: 'rejected',
      diagnostics: [{ code: 'draft_metadata_structure_limit', path: 'payload' }] });
    expect(projectDraftMetadata(catalog(Array(250_000).fill(null), [], 'draft-inventory-limit', 'partial'))).toMatchObject({ status: 'rejected',
      diagnostics: [{ code: 'draft_metadata_structure_limit', path: 'payload' }] });
  });
  it('requires an explicit catalog reason field even for complete-empty inventory', () => {
    expect(projectDraftMetadata(observation({ metadataVersion: DRAFT_METADATA_VERSION, kind: 'catalog', catalog: [], details: [] })))
      .toMatchObject({ status: 'rejected', diagnostics: [{ code: 'invalid_draft_inventory', path: 'payload' }] });
  });
});
