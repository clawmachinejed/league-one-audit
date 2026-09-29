import { randomUUID } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import type { DatabaseClient, DatabaseRow } from '../../database';
import { EXACT_MATCHUPS_POLICY, exactMatchupsScope } from '../../aggregator/exact-matchups';
import { normalizeAdministrationObservation } from '../normalize';
import type { JsonValue } from '../contracts';
import type { AdministrationSourceMapping } from '../source-mapping';
import { exactMatchupMethods } from './exact-matchups';

vi.mock('server-only', () => ({}));

const mapping: AdministrationSourceMapping = {
  connectionId: '10000000-0000-4000-8000-000000000001',
  leagueSeasonId: '20000000-0000-4000-8000-000000000001',
  revisionId: '30000000-0000-4000-8000-000000000001',
  generation: 1,
  scope: { leagueKey: 'league1', provider: 'sleeper', externalLeagueId: 'fixture-source', season: 2026 },
};

function database(respond: (sql: string, parameters: readonly unknown[]) => readonly DatabaseRow[]): DatabaseClient {
  return { enabled: true, async query<Row extends DatabaseRow>(sql: string, parameters: readonly unknown[] = []) {
    return respond(sql, parameters) as readonly Row[];
  } };
}

describe('exact matchup Neon reservation', () => {
  it('passes a canonical 36-character attempt UUID to SQL and accepts its scoped UUID result', async () => {
    const attemptId = randomUUID();
    const scopeId = randomUUID();
    const respond = vi.fn((sql: string, parameters: readonly unknown[]) => {
      expect(sql).toContain('begin_exact_matchup_attempt');
      expect(parameters).toHaveLength(4);
      return [{ result: { id: attemptId, scopeId, ordinal: 2, expectedGeneration: 0 } }];
    });
    const client = database(respond);

    expect(await exactMatchupMethods(client).beginExactMatchupAttempt(mapping, 3, attemptId)).toEqual({
      id: attemptId, scopeId, ordinal: 2, expectedGeneration: 0,
    });
    expect(respond).toHaveBeenCalledOnce();
    expect(respond.mock.calls[0][1]).toEqual([JSON.stringify(mapping), attemptId, 3, null]);
  });

  it('rejects malformed attempt IDs before invoking SQL', async () => {
    const respond = vi.fn(() => []);
    const client = database(respond);
    await expect(exactMatchupMethods(client).beginExactMatchupAttempt(mapping, 3,
      '50000000-0000-4000-000000000001')).rejects.toThrow('Invalid matchup identity.');
    expect(respond).not.toHaveBeenCalled();
  });

  it('rejects malformed returned reservation IDs', async () => {
    const attemptId = randomUUID();
    const respond = vi.fn(() => [{ result: {
      id: attemptId, scopeId: '40000000-0000-4000-000000000001', ordinal: 1, expectedGeneration: 0,
    } }]);
    await expect(exactMatchupMethods(database(respond)).beginExactMatchupAttempt(mapping, 3, attemptId))
      .rejects.toThrow('Invalid matchup identity.');
    expect(respond).toHaveBeenCalledOnce();
  });

  it('reads a scoped accepted matchup with real 36-character receipt and team IDs', async () => {
    const payload: JsonValue = [
      { roster_id: 1, matchup_id: 4, players: ['a'], starters: ['a', '0'],
        starters_points: [8.25, null], players_points: { a: 8.25 }, points: 8.25, custom_points: 0 },
      { roster_id: 2, matchup_id: 4, players: ['b'], starters: ['b', '0'],
        starters_points: [4, null], players_points: { b: 4 }, points: 4 },
    ];
    const provenance = { origin: 'network' as const, requestStartedAt: '2026-09-25T12:00:00.000Z',
      requestCompletedAt: '2026-09-25T12:00:01.000Z', sourceObservedAt: '2026-09-25T12:00:01.000Z',
      checkedAt: '2026-09-25T12:00:02.000Z' };
    const normalized = normalizeAdministrationObservation({ schemaVersion: 'league-administration-v1',
      normalizerVersion: 'sleeper-administration-v1', dialect: 'sleeper-nfl-v1', scope: mapping.scope,
      family: 'matchups', week: 3, completeness: 'complete', provenance, payload }, { expectedRosterCount: 2 });
    expect(normalized.status).toBe('accepted');
    const configurationContentId = randomUUID();
    const contentId = randomUUID();
    const receiptId = randomUUID();
    const attemptId = randomUUID();
    const legacyObservationId = randomUUID();
    const configurationHash = 'configuration-hash';
    const respond = vi.fn(() => [{
      identity: { scope: exactMatchupsScope(mapping, 3), policy: EXACT_MATCHUPS_POLICY },
      generation: 1, source_mapping_revision_id: mapping.revisionId,
      receipt_id: receiptId, attempt_id: attemptId, provenance,
      coverage: { periodIds: ['sleeper:matchup-week:3'], interval: null, entitySet: 'full',
        fields: ['roster_id', 'matchup_id'], pagination: 'complete', nextCursor: null,
        completeness: 'complete', reasons: [] },
      configuration_content_id: configurationContentId,
      population_evidence: { contentHash: configurationHash }, expected_team_count: 2,
      legacy_observation_id: legacyObservationId, ordinal: 1, source_mapping: mapping,
      configuration_payload: { league_id: mapping.scope.externalLeagueId, season: '2026',
        total_rosters: 2, status: 'in_season', settings: { leg: 3 }, roster_positions: ['QB', 'RB', 'BN'] },
      configuration_hash: configurationHash,
      content_id: contentId, content_hash: normalized.contentHash, semantic_hash: normalized.semanticHash,
      payload, normalized_value: normalized.value, normalizer_version: 'sleeper-administration-v1',
      completeness: 'complete', league_season_id: mapping.leagueSeasonId, provider: 'sleeper',
      external_league_id: mapping.scope.externalLeagueId, family: 'matchups', week: 3,
      teams: [{ seasonTeamId: randomUUID(), externalRosterId: '1' },
        { seasonTeamId: randomUUID(), externalRosterId: '2' }],
    }]);
    const read = await exactMatchupMethods(database(respond)).readAcceptedExactMatchups(mapping, 3);
    expect(read.status).toBe('available');
    if (read.status !== 'available') throw new Error(`Unexpected matchup read: ${read.reason}`);
    expect(read.accepted.contentId).toBe(contentId);
    expect(read.receipt).toMatchObject({ id: receiptId, attemptId, legacyObservationId,
      rawContentHash: normalized.contentHash });
    expect(read.value.teams.find(team => team.externalRosterId === '1')?.officialTeamPoints)
      .toMatchObject({ raw: '8.25', custom: '0', effective: '0' });
    expect(respond).toHaveBeenCalledOnce();
  });
});
