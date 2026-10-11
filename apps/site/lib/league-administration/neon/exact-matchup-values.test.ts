import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import type { DatabaseClient, DatabaseRow } from '../../database';
import { EXACT_MATCHUPS_POLICY, exactMatchupsScope } from '../../aggregator/exact-matchups';
import { EXACT_MATCHUP_VALUES_VERSION } from '../../aggregator/exact-matchup-values';
import { normalizeAdministrationObservation } from '../normalize';
import type { AdministrationSourceMapping } from '../source-mapping';
import { EXACT_MATCHUP_VALUES_SQL, exactMatchupValuesMethods, readExactMatchupValuesRows } from './exact-matchup-values';

vi.mock('server-only', () => ({}));
const mapping: AdministrationSourceMapping = { connectionId: randomUUID(), leagueSeasonId: randomUUID(), revisionId: randomUUID(), generation: 1,
  scope: { leagueKey: 'cp10', provider: 'sleeper', externalLeagueId: '9007199254740993001', season: 2026 } };

function fixture() {
  const contentId = randomUUID(), teamId = randomUUID();
  const payload = [{ roster_id: 1, matchup_id: null, players: ['001', 'NE'], starters: ['001', '0'],
    starters_points: [null, 3.125], players_points: { '001': 0, NE: null, unheld: 0.0000001 }, points: 12.123456789012344, custom_points: 0 }];
  const provenance = { origin: 'network' as const, requestStartedAt: '2026-10-10T10:00:00Z', requestCompletedAt: '2026-10-10T10:00:01Z',
    sourceObservedAt: '2026-10-10T10:00:01Z', checkedAt: '2026-10-10T10:00:02Z' };
  const normalized = normalizeAdministrationObservation({ schemaVersion: 'league-administration-v1', normalizerVersion: 'sleeper-administration-v1',
    dialect: 'sleeper-nfl-v1', scope: mapping.scope, family: 'matchups', week: 15, completeness: 'complete', provenance, payload });
  if (normalized.value?.family !== 'matchups') throw new Error('Invalid test fixture.');
  return {
    identity: { scope: exactMatchupsScope(mapping, 15), policy: EXACT_MATCHUPS_POLICY },
    acceptance_id: randomUUID(), generation: 3, source_mapping_revision_id: mapping.revisionId,
    receipt_id: randomUUID(), attempt_id: randomUUID(), provenance,
    coverage: { periodIds: ['sleeper:matchup-week:15'], interval: null, entitySet: 'full', fields: ['roster_id', 'matchup_id'],
      pagination: 'complete', nextCursor: null, completeness: 'complete', reasons: [] },
    configuration_content_id: randomUUID(), population_evidence: { contentHash: 'config-hash' }, expected_team_count: 1,
    legacy_observation_id: randomUUID(), ordinal: 4, expected_generation: 2, source_mapping: mapping,
    configuration_payload: { league_id: mapping.scope.externalLeagueId, season: '2026', total_rosters: 1 }, configuration_hash: 'config-hash',
    content_id: contentId, content_hash: normalized.contentHash, semantic_hash: normalized.semanticHash, payload, normalized_value: normalized.value,
    normalizer_version: 'sleeper-administration-v1', completeness: 'complete', content_accepted: true,
    league_season_id: mapping.leagueSeasonId, provider: 'sleeper', external_league_id: mapping.scope.externalLeagueId, family: 'matchups', week: 15,
    calendar_evidence: null, lineup_applicability_evidence: null,
    teams: [{ seasonTeamId: teamId, externalRosterId: '1' }],
    value_header: { content_id: contentId, first_acceptance_id: randomUUID(), value_version: EXACT_MATCHUP_VALUES_VERSION, team_count: 1 },
    first_acceptance_content_id: contentId,
    typed_teams: [{ content_id: contentId, team_id: teamId, source_ordinal: 1, external_roster_id: '1',
      matchup_id_state: 'null', native_matchup_id: null, players_state: 'supplied', players: ['001', 'NE'],
      starters_state: 'supplied', starters: ['001', '0'], raw_points_state: 'supplied', raw_points: '12.123456789012344000',
      custom_points_state: 'supplied', custom_points: '0.00', starter_points_state: 'supplied', starter_points_count: 2,
      player_points_state: 'supplied', player_points_count: 3, source_value: normalized.value.matchups[0],
      starter_points: [{ source_index: 0, points: null }, { source_index: 1, points: '3.125' }],
      player_points: [{ native_player_id: '001', points: '0' }, { native_player_id: 'NE', points: null }, { native_player_id: 'unheld', points: '0.000000100' }] }],
  };
}
function client(rows: readonly DatabaseRow[]) {
  const query = vi.fn(async () => rows);
  return { database: { enabled: true, query } as DatabaseClient, query };
}

describe('stored exact native matchup values', () => {
  it('reads typed values after raw, normalized, canonical team and immutable receipt parity, without providers or writes', async () => {
    const row = fixture(), database = client([row]);
    const result = await exactMatchupValuesMethods(database.database).readExactMatchupValues(mapping, { nativeWeek: 15 });
    expect(result).toMatchObject({ status: 'available', version: EXACT_MATCHUP_VALUES_VERSION, selection: 'current',
      contentId: row.content_id, matchupsReceiptId: row.receipt_id, acceptanceId: row.acceptance_id, acceptedGeneration: 3,
      sourceMappingRevisionId: mapping.revisionId, provenance: row.provenance,
      value: { season: 2026, nativeWeek: 15, teams: [{ sourceOrdinal: 0, rawPoints: { state: 'supplied', value: '12.123456789012344' },
        customPoints: { state: 'supplied', value: '0' }, effectivePoints: { value: '0', source: 'custom-override' },
        starterPoints: { state: 'supplied', value: [null, '3.125'] }, playerPoints: { state: 'supplied', value: { '001': '0', NE: null, unheld: '0.0000001' } } }] } });
    expect(database.query).toHaveBeenCalledExactlyOnceWith(EXACT_MATCHUP_VALUES_SQL,
      [JSON.stringify(row.identity), mapping.revisionId, mapping.generation, 15, null]);
  });

  it('pins historical receipt while allowing reused content originally materialized by a different acceptance', async () => {
    const row = fixture(), database = client([row]);
    const result = await exactMatchupValuesMethods(database.database).readExactMatchupValues(mapping, { nativeWeek: 15, matchupsReceiptId: row.receipt_id });
    expect(result).toMatchObject({ status: 'available', selection: 'receipt', matchupsReceiptId: row.receipt_id });
    expect(database.query.mock.calls[0]).toEqual([EXACT_MATCHUP_VALUES_SQL,
      [JSON.stringify(row.identity), mapping.revisionId, mapping.generation, 15, row.receipt_id]]);
    expect(EXACT_MATCHUP_VALUES_SQL).toContain('receipt.id=$5::uuid');
    expect(EXACT_MATCHUP_VALUES_SQL).toContain('connection.current_mapping_revision_id=accepted.source_mapping_revision_id');
  });

  it('does not substitute raw projection for pre-migration missing typed rows', () => {
    const row = fixture();
    expect(readExactMatchupValuesRows([{ ...row, value_header: null }], mapping, { nativeWeek: 15 }))
      .toEqual({ status: 'missing', reason: 'typed_values_not_recorded' });
    expect(readExactMatchupValuesRows([], mapping, { nativeWeek: 15 })).toEqual({ status: 'missing', reason: 'accepted_matchup_receipt_missing' });
  });

  const corruptions: ReadonlyArray<readonly [string, (row: ReturnType<typeof fixture>) => void]> = [
    ['raw hash', row => { row.content_hash = 'forged'; }],
    ['legacy value', row => { row.normalized_value = { ...row.normalized_value,
      matchups: [{ ...row.normalized_value.matchups[0], points: 99 }] }; }],
    ['team source value', row => { row.typed_teams[0].source_value = { ...row.typed_teams[0].source_value, customPoints: 7 }; }],
    ['native field presence', row => { row.typed_teams[0].matchup_id_state = 'missing'; }],
    ['native order', row => { row.typed_teams[0].players.reverse(); }],
    ['starter index', row => { row.typed_teams[0].starter_points[1].source_index = 2; }],
    ['vacancy score', row => { row.typed_teams[0].starter_points[1].points = '0'; }],
    ['missing child', row => { row.typed_teams[0].player_points.pop(); }],
    ['unknown player score', row => { row.typed_teams[0].player_points[2].points = '1'; }],
    ['parsed precision', row => { row.typed_teams[0].raw_points = '12.123456789012345'; }],
    ['forged canonical team', row => { row.typed_teams[0].team_id = randomUUID(); }],
    ['header version', row => { row.value_header.value_version = 'other' as typeof EXACT_MATCHUP_VALUES_VERSION; }],
    ['header count', row => { row.value_header.team_count = 2; }],
    ['original acceptance content', row => { row.first_acceptance_content_id = randomUUID(); }],
    ['generation binding', row => { row.expected_generation = 0; }],
    ['source mapping', row => { row.source_mapping_revision_id = randomUUID(); }],
    ['wrong period', row => { row.week = 16; }],
  ];
  it.each(corruptions)('rejects corrupted %s evidence', (_name, corrupt) => {
    const row = structuredClone(fixture()); corrupt(row);
    expect(readExactMatchupValuesRows([row], mapping, { nativeWeek: 15 }).status).toBe('unavailable');
  });
  it('rejects wrong receipt, unsupported season, invalid selectors and ambiguous results', async () => {
    const row = fixture();
    expect(readExactMatchupValuesRows([row], mapping, { nativeWeek: 15, matchupsReceiptId: randomUUID() }).status).toBe('unavailable');
    expect(readExactMatchupValuesRows([row, row], mapping, { nativeWeek: 15 }).status).toBe('unavailable');
    const database = client([row]), reader = exactMatchupValuesMethods(database.database);
    for (const selection of [{ nativeWeek: 0 }, { nativeWeek: 19 }, { nativeWeek: 15, matchupsReceiptId: 'invalid' }]) {
      expect((await reader.readExactMatchupValues(mapping, selection)).status).toBe('unavailable');
    }
    expect((await reader.readExactMatchupValues({ ...mapping, scope: { ...mapping.scope, season: 2025 } }, { nativeWeek: 15 })).status).toBe('unavailable');
    expect(database.query).not.toHaveBeenCalled();
  });

  it('keeps additive storage private, immutable and in the existing acceptance transaction, without a backfill', () => {
    const migration = readFileSync(new URL('../../../migrations/045_exact_matchup_values.sql', import.meta.url), 'utf8');
    expect(migration).not.toMatch(/SECURITY DEFINER|ALTER FUNCTION|UPDATE public\.league_roster_resource_heads|CREATE.*begin_.*attempt/);
    expect(migration).toContain('AFTER INSERT ON public.league_roster_resource_acceptances');
    expect(migration).toContain('FOREIGN KEY(content_id,team_id) REFERENCES public.league_administration_team_entries');
    expect(migration).toContain('DEFERRABLE INITIALLY DEFERRED');
    expect(migration).toContain('prevent_league_administration_history_change()');
    expect(migration).not.toContain('[[:cntrl:]]');
    expect(migration).toContain("chr(1)||'-'||chr(31)||chr(127)");
    expect(migration).toContain('chr(160)'); expect(migration).toContain('chr(65279)');
    expect(migration).toContain('GRANT SELECT ON public.league_exact_matchup_value_contents');
    expect(migration).not.toMatch(/GRANT (?:ALL|INSERT|UPDATE|DELETE|EXECUTE)/);
    expect(migration.match(/IF attempt\.write_fence IS NOT NULL THEN PERFORM public\.assert_roster_player_link_fence/g)).toHaveLength(2);
  });
});
