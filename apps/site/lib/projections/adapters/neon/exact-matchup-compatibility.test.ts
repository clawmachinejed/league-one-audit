import { describe, expect, it, vi } from 'vitest';
import type { DatabaseClient, DatabaseRow } from '../../../database';
import { EXACT_MATCHUPS_POLICY, exactMatchupsScope } from '../../../aggregator/exact-matchups';
import { createExactMatchupCompatibilityReader } from '../../../league-administration/store';
import { b1Uuid as uuid, b1Mapping as mapping, b1CompatibilityInput as input,
  b1CompatibilityFixture as fixture } from '../../../aggregator/b1-acceptance.fixtures';

vi.mock('server-only', () => ({}));
function database(result: readonly DatabaseRow[]) {
  const query = vi.fn(async () => result);
  const client = { enabled: true, query } as unknown as DatabaseClient;
  return { query, reader: createExactMatchupCompatibilityReader(client) };
}
function row() { return fixture(); }

describe('single-statement exact matchup compatibility evidence', () => {
  it('composes the existing exact selectors into one bounded read and retains immutable acceptance configuration identity', async () => {
    const { reader, query } = database([row()]);
    const result = await reader.readExactMatchupCompatibility(input);
    expect(result.official.status).toBe('available');
    if (result.official.status !== 'available') throw new Error('Official facts missing.');
    expect(result.official.receipt.configurationContentId).toBe(uuid(7));
    expect(result.official.value.teams[0].officialTeamPoints).toMatchObject({ raw: '8.25', custom: '0', effective: '0' });
    expect(result.forecast.status).toBe('available');
    expect(result.gameState.status).toBe('available');
    expect(result.probability.status).toBe('available');
    expect(query).toHaveBeenCalledOnce();
    const calls = query.mock.calls as unknown as [string, unknown[]][];
    const [sql, parameters] = calls[0];
    expect(parameters).toEqual([JSON.stringify({ scope: exactMatchupsScope(mapping, 4), policy: EXACT_MATCHUPS_POLICY }),
      mapping.revisionId, mapping.generation, 4, uuid(4), uuid(2), 2026, 4, 'clock-v1', mapping.connectionId]);
    expect(sql).toContain('snapshot.id=$5::uuid AND snapshot.league_season_id=$6::uuid');
    expect(sql).toContain('season.season=$7 AND snapshot.week=$8 AND snapshot.model_version=$9');
    expect(sql).toContain('configuration_content_id=content.id');
    expect(sql).toContain('version.id=content.configuration_version_id');
    expect(sql).toContain('profile.id=season.scoring_profile_id');
    expect(sql).toContain('WHERE observation.id=ANY(history.game_state_observation_ids)');
    expect(sql).toContain('expected.league_week_observation_id=original.id');
    expect(sql).not.toMatch(/\b(?:INSERT|UPDATE|DELETE|CALL)\b/);
    expect(sql).not.toMatch(/frozen_player|projection_candidates|league_configuration_heads|defaultSeason/);
  });

  it.each([
    ['malformed history', { history_rows: [{}] }, 'snapshot_missing'],
    ['malformed snapshot payload', { snapshot_rows: [{ is_current: true, payload: {} }] }, 'snapshot_missing'],
    ['ambiguous snapshot', { snapshot_rows: [{}, {}] }, 'snapshot_missing'],
    ['missing derived contents', { contents: null }, 'source_history_unavailable'],
    ['malformed scoring profile', { profile: { rules: { pass_yd: 'four' } } }, 'source_history_unavailable'],
    ['malformed game evidence', { games: { observations: false } }, 'game_evidence_unavailable'],
  ])('preserves accepted custom zero and starter vacancies with %s', async (_name, change, reason) => {
    const result = await database([{ ...row(), ...change }]).reader.readExactMatchupCompatibility(input);
    expect(result.official.status).toBe('available');
    if (result.official.status !== 'available') throw new Error('Derived evidence suppressed official facts.');
    expect(result.official.value.teams[0].officialTeamPoints.effective).toBe('0');
    expect(result.official.value.teams[0].starters?.map(slot => slot.playerExternalId)).toEqual(['a', null]);
    expect(result.forecast).toEqual({ status: 'unavailable', reason });
    expect(result.gameState).toEqual({ status: 'unavailable', reason });
    expect(result.probability).toEqual({ status: 'unavailable', reason });
  });

  it.each([
    ['wrong league-season', { request: { ...input.request, leagueSeasonId: uuid(99) } }],
    ['wrong numeric season', { request: { ...input.request, season: 2025 } }],
    ['invalid snapshot UUID', { request: { ...input.request, snapshotId: 'latest' } }],
    ['invalid period', { request: { ...input.request, week: 0 } }],
    ['blank model', { request: { ...input.request, modelVersion: '' } }],
    ['invalid expected source', { expectedMapping: { ...mapping, generation: 0 } }],
  ])('refuses %s before querying', async (_name, change) => {
    const { reader, query } = database([row()]);
    const result = await reader.readExactMatchupCompatibility({ ...input, ...change });
    expect(query).not.toHaveBeenCalled();
    expect(result.official.status).toBe('unavailable');
  });

  it('reports missing official acceptance without synthesizing a matchup', async () => {
    const result = await database([{ ...row(), accepted_rows: [] }]).reader.readExactMatchupCompatibility(input);
    expect(result.official).toEqual({ status: 'missing' });
    expect(result.forecast.status).toBe('unavailable');
  });

  it('does not retry a failed statement against a later pointer state', async () => {
    const { query, reader } = database([]);
    query.mockRejectedValueOnce(new Error('read failed'));
    const result = await reader.readExactMatchupCompatibility(input);
    expect(query).toHaveBeenCalledOnce();
    expect(result.official.status).toBe('unavailable');
  });
});
