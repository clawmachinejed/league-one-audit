import { describe, expect, it, vi } from 'vitest';
import type { DatabaseClient, DatabaseRow } from '../../database';
import { TRADED_PICKS_VERSION, TRADED_PICKS_POLICY, tradedPicksScope, projectTradedPicks } from '../../aggregator/traded-picks';
import { normalizeAdministrationObservation } from '../normalize';
import { createLeagueAdministrationStore } from '../store';
import { tradedPicksCoverage, tradedPicksMethods, readTradedPicksRows } from './traded-picks';
vi.mock('server-only', () => ({}));
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const at = '2026-10-14T12:00:00.000001Z';
const mapping = { connectionId: id(1), leagueSeasonId: id(2), revisionId: id(3), generation: 1,
  scope: { leagueKey: 'cp18-unit', provider: 'sleeper' as const, externalLeagueId: '90071992547409999', season: 2026 } };
const selection = { kind: 'draft' as const, externalDraftId: 'draft1' };
function fixture(partial = false, owner: string | null = '2') {
  const payload = { tradedPicksVersion: TRADED_PICKS_VERSION, kind: 'draft', externalDraftId: 'draft1',
    catalog: { draft_id: 'draft1', league_id: mapping.scope.externalLeagueId, season: '2026' },
    tradedPicks: [{ season: '2027', round: 2, roster_id: '1', owner_id: owner, previous_owner_id: 1 }] };
  const normalized = normalizeAdministrationObservation({ schemaVersion: 'league-administration-v1', normalizerVersion: 'sleeper-administration-v1',
    dialect: 'sleeper-nfl-v1', scope: mapping.scope, family: 'drafts', week: null, completeness: partial ? 'partial' : 'complete', payload,
    provenance: { origin: 'network', requestStartedAt: at, requestCompletedAt: at, sourceObservedAt: partial ? null : at, checkedAt: at } });
  const projected = projectTradedPicks(normalized); if (projected.status !== 'accepted' || projected.value.kind === 'catalog') throw Error('Invalid fixture.');
  const native = projected.value.entries[0];
  const row: DatabaseRow = { identity: { scope: tradedPicksScope(mapping, selection), policy: TRADED_PICKS_POLICY },
    head_accepted_id: id(4), head_generation: '1', acceptance_id: partial ? null : id(4), generation: partial ? null : '1',
    source_mapping_revision_id: partial ? null : id(3), accepted_at: partial ? null : at, receipt_id: id(5), attempt_id: id(6),
    reserved_attempt_id: id(6), ordinal: '1', expected_generation: '0', legacy_observation_id: id(7), provenance: normalized.envelope.provenance,
    coverage: tradedPicksCoverage(projected), configuration_content_id: null, population_evidence: null, expected_team_count: null,
    source_mapping: mapping, capture_after_reservation: true, content_id: id(8), content_hash: normalized.contentHash,
    semantic_hash: normalized.semanticHash, payload, normalized_value: normalized.value, normalizer_version: 'sleeper-administration-v1',
    completeness: normalized.envelope.completeness, content_accepted: false, league_season_id: id(2), provider: 'sleeper',
    external_league_id: mapping.scope.externalLeagueId, family: 'drafts', week: 0, observation_content_id: id(8), observation_league_season_id: id(2),
    first_receipt_content_id: id(8), value_header: { content_id: id(8), first_receipt_id: id(5), value_version: TRADED_PICKS_VERSION,
      kind: 'draft', external_draft_id: 'draft1', complete: !partial, trades_state: 'supplied', total_count: 1,
      valid_identity_count: 0, invalid_identity_count: 0, attempted_trade_count: 0, succeeded_trade_count: 0, failed_trade_count: 0,
      unrequested_trade_count: 0, reason: projected.value.reason }, entries: [], facts: [{ content_id: id(8), source_ordinal: 0,
      identity_state: 'valid', asset_id: id(9), pick_season: '2027', round_value: '2', original_roster_id: '1', owner_id: owner, previous_owner_id: '1',
      ownership_state: owner === null ? 'unknown' : 'resolved', current_owner_id: owner, owner_team_id: owner === null ? null : id(10),
      previous_owner_state: 'resolved', evidenced_previous_owner_id: '1', native_fields: native, extensions: native.extensions, raw: native.raw,
      asset_scope_valid: true, owner_scope_valid: owner === null ? null : true }] };
  return { row, normalized, projected };
}
const database = (query: (sql: string, parameters: readonly unknown[]) => readonly DatabaseRow[]): DatabaseClient => ({ enabled: true,
  async query<Row extends DatabaseRow>(sql: string, parameters: readonly unknown[] = []) { return query(sql, parameters) as readonly Row[]; } });
describe('stored traded pick evidence', () => {
  it('reconstructs relational ownership and exact historical receipt binding', () => {
    const f = fixture(); expect(readTradedPicksRows([f.row], mapping, selection)).toMatchObject({ status: 'available', value: f.projected.value });
    expect(readTradedPicksRows([f.row], mapping, { ...selection, receiptId: id(5) })).toMatchObject({ status: 'available', selection: 'receipt' });
  });
  it('allows current complete unknown owner while preserving native null and no canonical owner', () => {
    const f = fixture(false, null); expect(readTradedPicksRows([f.row], mapping, selection)).toMatchObject({ status: 'available', value: f.projected.value });
    const facts = (f.row.facts as DatabaseRow[]).map(row => ({ ...row, owner_team_id: id(10) }));
    expect(readTradedPicksRows([{ ...f.row, facts }], mapping, selection).status).toBe('unavailable');
  });
  it('retains incomplete exact receipts without presenting them as current', () => {
    const f = fixture(true); expect(readTradedPicksRows([f.row], mapping, { ...selection, receiptId: id(5) })).toMatchObject({ status: 'observed', value: f.projected.value });
    expect(readTradedPicksRows([f.row], mapping, selection).status).toBe('unavailable');
  });
  it.each(['observation_content_id', 'observation_league_season_id', 'reserved_attempt_id', 'source_mapping_revision_id', 'first_receipt_content_id', 'head_accepted_id'])('refuses substituted lineage %s', key => {
    const f = fixture(); expect(readTradedPicksRows([{ ...f.row, [key]: id(99) }], mapping, selection).status).toBe('unavailable');
  });
  it.each(['asset_scope_valid', 'owner_scope_valid', 'asset_id', 'current_owner_id', 'owner_team_id', 'pick_season', 'round_value', 'source_ordinal', 'raw'])('refuses corrupt relational fact %s', key => {
    const f = fixture(), facts = (f.row.facts as DatabaseRow[]).map(row => ({ ...row, [key]: null }));
    expect(readTradedPicksRows([{ ...f.row, facts }], mapping, selection).status).toBe('unavailable');
  });
  it('rejects foreign resource receipt duplicate results and missing facts', () => {
    const f = fixture();
    expect(readTradedPicksRows([f.row], mapping, { ...selection, receiptId: id(99) }).status).toBe('unavailable');
    expect(readTradedPicksRows([f.row], mapping, { kind: 'league' }).status).toBe('unavailable');
    expect(readTradedPicksRows([f.row, f.row], mapping, selection).status).toBe('unavailable');
    expect(readTradedPicksRows([{ ...f.row, facts: [] }], mapping, selection).status).toBe('unavailable');
  });
  it('uses one stored query and leaves disabled methods free of I/O', async () => {
    const f = fixture(), query = vi.fn(() => [f.row]), fetch = vi.spyOn(globalThis, 'fetch').mockRejectedValue(Error('no provider'));
    try { expect((await tradedPicksMethods(database(query)).readTradedPicks(mapping, selection)).status).toBe('available');
      expect(query).toHaveBeenCalledTimes(1); expect(fetch).not.toHaveBeenCalled();
      const disabled = createLeagueAdministrationStore({ enabled: false, reason: 'missing-database-url' });
      expect(await disabled.readTradedPicks!(null as never, null as never)).toEqual({ status: 'disabled' });
      await expect(disabled.beginTradedPicksAttempt!(null as never, null as never, '')).rejects.toThrow('disabled');
    } finally { fetch.mockRestore(); }
  });
});
