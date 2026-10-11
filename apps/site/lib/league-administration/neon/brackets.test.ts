import { describe, expect, it, vi } from 'vitest';
import type { DatabaseClient, DatabaseRow } from '../../database';
import { BRACKET_POLICY, BRACKET_VALUE_VERSION, bracketScope, projectPlayoffBracket } from '../../aggregator/playoff-brackets';
import { normalizeAdministrationObservation } from '../normalize';
import { createLeagueAdministrationStore } from '../store';
import { createLeagueAdministrationMethods } from './administration';
import { ACCEPTED_BRACKET_SQL, bracketMethods, readAcceptedBracketRows } from './brackets';
vi.mock('server-only', () => ({}));
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const at = '2026-10-10T12:00:00.000Z';
const mapping = { connectionId: id(1), leagueSeasonId: id(2), revisionId: id(3), generation: 1,
  scope: { leagueKey: 'cp11-unit', provider: 'sleeper' as const, externalLeagueId: 'cp11-source', season: 2026 } };
const selection = { family: 'winners_bracket' as const };
function fixture() {
  const normalized = normalizeAdministrationObservation({ schemaVersion: 'league-administration-v1', normalizerVersion: 'sleeper-administration-v1',
    dialect: 'sleeper-nfl-v1', scope: mapping.scope, ...selection, week: null, completeness: 'complete',
    provenance: { origin: 'network', requestStartedAt: at, requestCompletedAt: at, sourceObservedAt: at, checkedAt: at },
    payload: [{ m: 2, r: 2, t1: { w: 1 }, t2: null, w: null, p: 0, extra: true }, { m: 1, r: 1, t1: 1, t2: 2, w: 1, l: 2 }] });
  const projected = projectPlayoffBracket(normalized); if (projected.status !== 'accepted') throw Error('bad fixture');
  const row: DatabaseRow = { identity: { scope: bracketScope(mapping, selection.family), policy: BRACKET_POLICY },
    acceptance_id: id(4), generation: '1', source_mapping_revision_id: id(3), receipt_id: id(5), attempt_id: id(6),
    legacy_observation_id: id(7), provenance: normalized.envelope.provenance, coverage: { periodIds: [], interval: null,
      entitySet: 'full', fields: ['r', 'm', 't1', 't2', 't1_from', 't2_from', 'w', 'l', 'p'], pagination: 'complete', nextCursor: null, completeness: 'complete', reasons: [] },
    configuration_content_id: null, population_evidence: null, expected_team_count: null, ordinal: '1', expected_generation: '0',
    source_mapping: mapping, content_id: id(8), content_hash: normalized.contentHash, semantic_hash: normalized.semanticHash,
    payload: normalized.envelope.payload, normalized_value: normalized.value, normalizer_version: 'sleeper-administration-v1',
    completeness: 'complete', content_accepted: true, league_season_id: id(2), provider: 'sleeper', external_league_id: mapping.scope.externalLeagueId,
    family: selection.family, week: 0, observation_content_id: id(8), observation_league_season_id: id(2), first_acceptance_content_id: id(8),
    value_header: { content_id: id(8), first_acceptance_id: id(4), value_version: BRACKET_VALUE_VERSION, family: selection.family,
      publication: 'published', match_count: 2, round_count: 2, edge_count: 1, limitations: [] }, typed_value: projected.value };
  return { normalized, projected, row };
}
function database(query: (sql: string, values: readonly unknown[]) => readonly DatabaseRow[]): DatabaseClient {
  return { enabled: true, async query<Row extends DatabaseRow>(sql: string, values: readonly unknown[] = []) { return query(sql, values) as readonly Row[]; } };
}
describe('CP11 stored bracket boundary', () => {
  it('returns typed facts only with native, legacy, receipt and relational parity', () => {
    const f = fixture(); const read = readAcceptedBracketRows([f.row], mapping, selection);
    expect(read).toMatchObject({ status: 'available', selection: 'current', bracketReceiptId: id(5), acceptedGeneration: 1, value: f.projected.value });
    expect(readAcceptedBracketRows([f.row], mapping, { ...selection, bracketReceiptId: id(5) })).toMatchObject({ status: 'available', selection: 'receipt' });
  });
  it.each(['source_mapping', 'content_hash', 'semantic_hash', 'normalized_value', 'typed_value', 'source_mapping_revision_id',
    'observation_content_id', 'first_acceptance_content_id', 'coverage', 'expected_generation', 'configuration_content_id'])(
  'fails closed when %s evidence is forged', key => {
    const { row } = fixture(); expect(readAcceptedBracketRows([{ ...row, [key]: key === 'expected_generation' ? 5 : 'forged' }], mapping, selection))
      .toEqual({ status: 'unavailable', reason: 'bracket_evidence_unavailable' });
  });
  it('distinguishes missing receipt, missing typed capture, invalid receipt and unavailable DB', async () => {
    const { row } = fixture(); expect(readAcceptedBracketRows([], mapping, selection)).toEqual({ status: 'missing', reason: 'accepted_bracket_receipt_missing' });
    expect(readAcceptedBracketRows([{ ...row, value_header: null }], mapping, selection)).toEqual({ status: 'missing', reason: 'typed_bracket_not_recorded' });
    expect(readAcceptedBracketRows([row], mapping, { ...selection, bracketReceiptId: id(90) }).status).toBe('unavailable');
    expect(await bracketMethods(database(() => { throw Error('offline'); })).readAcceptedBracket(mapping, selection)).toEqual({ status: 'unavailable', reason: 'bracket_evidence_unavailable' });
  });
  it('uses a single stored SELECT with exact mapping and optional receipt parameters', async () => {
    const query = vi.fn(() => [fixture().row]); const store = bracketMethods(database(query));
    expect((await store.readAcceptedBracket(mapping, { ...selection, bracketReceiptId: id(5) })).status).toBe('available');
    expect(query).toHaveBeenCalledExactlyOnceWith(ACCEPTED_BRACKET_SQL, [JSON.stringify({ scope: bracketScope(mapping, selection.family), policy: BRACKET_POLICY }), id(3), 1, 'winners_bracket', id(5)]);
    expect(ACCEPTED_BRACKET_SQL).not.toMatch(/\b(?:UPDATE|INSERT|DELETE|fetch)\b/u);
    expect(ACCEPTED_BRACKET_SQL).not.toContain('league_administration_heads');
  });
  it('reserves before acquisition and rejects invalid scope or reservation response', async () => {
    const query = vi.fn(() => [{ result: { id: id(6), scopeId: id(9), ordinal: '2', expectedGeneration: '1' } }]);
    const store = bracketMethods(database(query));
    expect(await store.beginBracketAttempt(mapping, 'losers_bracket', id(6))).toEqual({ id: id(6), scopeId: id(9), ordinal: 2, expectedGeneration: 1 });
    await expect(store.beginBracketAttempt({ ...mapping, scope: { ...mapping.scope, season: 2025 } }, 'losers_bracket', id(6))).rejects.toThrow();
    await expect(bracketMethods(database(() => [{ result: { id: id(99) } }])).beginBracketAttempt(mapping, 'losers_bracket', id(6))).rejects.toThrow();
    expect(query).toHaveBeenCalledTimes(1);
  });
  it('adds typed projection only to the explicitly selected existing writer and keeps disabled compatibility', async () => {
    const f = fixture(), attempt = { id: id(6), scopeId: id(9), ordinal: 1, expectedGeneration: 0 };
    const query = vi.fn((sql: string, values: readonly unknown[]) => {
      expect(sql).toContain('league-administration:record-observation'); expect(values).toHaveLength(1);
      return [{ result: { status: 'changed' } }];
    }); const store = createLeagueAdministrationMethods(database(query));
    await store.recordObservation(f.normalized); expect(JSON.parse(String(query.mock.calls[0][1][0]))).not.toHaveProperty('bracketProjection');
    await store.recordObservation(f.normalized, undefined, mapping, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, { attempt });
    expect(JSON.parse(String(query.mock.calls[1][1][0]))).toMatchObject({ bracketAcceptance: { attempt }, bracketProjection: f.projected });
    expect(await createLeagueAdministrationStore({ enabled: false, reason: 'missing-database-url' }).readAcceptedBracket!(mapping, selection)).toEqual({ status: 'disabled' });
  });
});
