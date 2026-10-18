import assert from 'node:assert/strict';
import { describe, expect, it, vi } from 'vitest';
import { EXACT_MATCHUPS_POLICY, exactMatchupsScope } from '../lib/aggregator/exact-matchups';
import { EXACT_MATCHUP_VALUES_VERSION, projectExactMatchupValues } from '../lib/aggregator/exact-matchup-values';
import { normalizeAdministrationObservation } from '../lib/league-administration/normalize';
import { readExactMatchupValuesRows } from '../lib/league-administration/neon/exact-matchup-values';
import { assertReaderJsonEqual } from './reader-performance-oracle';
vi.mock('server-only', () => ({}));

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const mapping = { connectionId: id(1), leagueSeasonId: id(2), revisionId: id(3), generation: 1,
  scope: { leagueKey: 'cp27-oracle', provider: 'sleeper' as const, externalLeagueId: '9007199254740993001', season: 2026 } };

function exactRead() {
  const payload = [{ roster_id: 1, matchup_id: null, players: ['cp27-player-001'], starters: ['cp27-player-001'],
    starters_points: [0], players_points: { 'cp27-player-001': 0 }, points: 40, custom_points: 0 }];
  const at = '2026-10-18T00:00:00.000Z';
  const provenance = { origin: 'network' as const, requestStartedAt: at, requestCompletedAt: at, sourceObservedAt: at, checkedAt: at };
  const normalized = normalizeAdministrationObservation({ schemaVersion: 'league-administration-v1', normalizerVersion: 'sleeper-administration-v1',
    dialect: 'sleeper-nfl-v1', scope: mapping.scope, family: 'matchups', week: 7, completeness: 'complete', provenance, payload });
  if (normalized.value?.family !== 'matchups') throw new Error('Invalid offline fixture.');
  const teams = [{ seasonTeamId: id(10), externalRosterId: '1' }];
  const row = { identity: { scope: exactMatchupsScope(mapping, 7), policy: EXACT_MATCHUPS_POLICY },
    acceptance_id: id(4), generation: 1, source_mapping_revision_id: id(3), receipt_id: id(5), attempt_id: id(6), provenance,
    coverage: { periodIds: ['sleeper:matchup-week:7'], interval: null, entitySet: 'full', fields: ['roster_id', 'matchup_id'],
      pagination: 'complete', nextCursor: null, completeness: 'complete', reasons: [] },
    configuration_content_id: id(7), population_evidence: { contentHash: 'config-hash' }, expected_team_count: 1,
    legacy_observation_id: id(8), ordinal: 1, expected_generation: 0, source_mapping: mapping,
    configuration_payload: { league_id: mapping.scope.externalLeagueId, season: '2026', total_rosters: 1 }, configuration_hash: 'config-hash',
    content_id: id(9), content_hash: normalized.contentHash, semantic_hash: normalized.semanticHash, payload, normalized_value: normalized.value,
    normalizer_version: 'sleeper-administration-v1', completeness: 'complete', content_accepted: true,
    league_season_id: id(2), provider: 'sleeper', external_league_id: mapping.scope.externalLeagueId, family: 'matchups', week: 7,
    calendar_evidence: null, lineup_applicability_evidence: null, teams,
    value_header: { content_id: id(9), first_acceptance_id: id(4), value_version: EXACT_MATCHUP_VALUES_VERSION, team_count: 1 }, first_acceptance_content_id: id(9),
    typed_teams: [{ content_id: id(9), team_id: id(10), source_ordinal: 1, external_roster_id: '1', matchup_id_state: 'null', native_matchup_id: null,
      players_state: 'supplied', players: payload[0].players, starters_state: 'supplied', starters: payload[0].starters,
      raw_points_state: 'supplied', raw_points: '40.00', custom_points_state: 'supplied', custom_points: '0.00',
      starter_points_state: 'supplied', starter_points_count: 1, player_points_state: 'supplied', player_points_count: 1,
      source_value: normalized.value.matchups[0], starter_points: [{ source_index: 0, points: '0' }],
      player_points: [{ native_player_id: 'cp27-player-001', points: '0' }] }] };
  return { result: readExactMatchupValuesRows([row], mapping, { nativeWeek: 7, matchupsReceiptId: id(5) }),
    expected: projectExactMatchupValues(normalized, teams) };
}

describe('CP27 exact native JSON parity oracle', () => {
  it('accepts real maintained reader values while preserving null-prototype player-point dictionaries', () => {
    const f = exactRead();
    expect(f.result.status).toBe('available');
    if (f.result.status !== 'available') throw new Error('Expected offline readback.');
    const actual = f.result.value;
    expect(Object.getPrototypeOf(actual.teams[0].playerPoints.state === 'supplied'
      ? actual.teams[0].playerPoints.value : null)).toBeNull();
    expect(() => assert.deepEqual(actual, f.expected)).toThrow();
    expect(() => assertReaderJsonEqual(actual, f.expected)).not.toThrow();
    const changed = { ...f.expected, teams: f.expected.teams.map((team, index) => index === 0
      ? { ...team, effectivePoints: { value: '1', source: 'raw' as const } } : team) };
    expect(() => assertReaderJsonEqual(actual, changed)).toThrow();
  });
  it('preserves own special keys, presence, types and array order', () => {
    const actual = Object.assign(Object.create(null), JSON.parse('{"__proto__":0,"constructor":null}'));
    expect(() => assertReaderJsonEqual(actual, JSON.parse('{"constructor":null,"__proto__":0}'))).not.toThrow();
    for (const expected of [{ constructor: null }, JSON.parse('{"__proto__":1,"constructor":null}'),
      JSON.parse('{"__proto__":"0","constructor":null}')]) expect(() => assertReaderJsonEqual(actual, expected)).toThrow();
    expect(() => assertReaderJsonEqual([0, null], [null, 0])).toThrow();
    expect(() => assertReaderJsonEqual({ value: null }, {})).toThrow();
  });
  it.each([undefined, NaN, Infinity, -Infinity, 1n, Symbol('invalid'), () => 1, new Date(), new Map(),
    Object.create({ inherited: true }), [1, , 3], Object.assign([1], { extra: true }),
    { value: undefined }, { [Symbol('invalid')]: 1 }, Object.defineProperty({}, 'hidden', { value: 1 }),
    Object.defineProperty({}, 'getter', { enumerable: true, get: () => { throw new Error('Must not execute accessors'); } }),
  ])('rejects non-JSON evidence without serialization loss (%#)', value => {
    expect(() => assertReaderJsonEqual(value, value)).toThrow();
  });
  it('rejects cycles while allowing repeated references to the same JSON record', () => {
    const cycle: Record<string, unknown> = {}; cycle.self = cycle;
    expect(() => assertReaderJsonEqual(cycle, cycle)).toThrow();
    const shared = { points: 0 };
    expect(() => assertReaderJsonEqual([shared, shared], [{ points: 0 }, { points: 0 }])).not.toThrow();
  });
});
