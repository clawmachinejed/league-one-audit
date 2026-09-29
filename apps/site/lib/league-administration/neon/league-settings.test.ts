import { randomUUID } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { leagueSettingsMethods } from './league-settings';
import { createLeagueAdministrationStore } from '../store';
import { normalizeAdministrationObservation } from '../normalize';
import { LEAGUE_SETTINGS_POLICY, LEAGUE_SETTINGS_FIELDS, leagueSettingsScope } from '../../aggregator/league-settings';
import type { DatabaseClient, DatabaseRow } from '../../database';
vi.mock('server-only', () => ({}));
const at = '2026-09-29T12:00:00.000Z';
const mapping = { connectionId: randomUUID(), leagueSeasonId: randomUUID(), revisionId: randomUUID(), generation: 1,
  scope: { leagueKey: 'fixture', provider: 'sleeper' as const, externalLeagueId: 'native-id', season: 2026 } };
const normalized = normalizeAdministrationObservation({ schemaVersion: 'league-administration-v1', normalizerVersion: 'sleeper-administration-v1',
  dialect: 'sleeper-nfl-v1', scope: mapping.scope, family: 'league', week: null, completeness: 'complete',
  provenance: { origin: 'network', requestStartedAt: at, requestCompletedAt: at, sourceObservedAt: at, checkedAt: at },
  payload: { league_id: 'native-id', season: '2026', sport: 'nfl', scoring_settings: { rec: 0.5 } } });
function row(): DatabaseRow {
  const content = randomUUID();
  return { identity: { scope: leagueSettingsScope(mapping), policy: LEAGUE_SETTINGS_POLICY }, generation: 2,
    source_mapping_revision_id: mapping.revisionId, source_mapping: mapping, league_id: randomUUID(), league_season_id: mapping.leagueSeasonId,
    provider: 'sleeper', external_league_id: 'native-id', normalizer_version: 'sleeper-administration-v1', completeness: 'complete',
    receipt_id: randomUUID(), attempt_id: randomUUID(), legacy_observation_id: randomUUID(), ordinal: 3,
    provenance: normalized.envelope.provenance, payload: normalized.envelope.payload, normalized_value: normalized.value,
    content_id: content, configuration_content_id: content, content_hash: normalized.contentHash, semantic_hash: normalized.semanticHash,
    configuration_version_id: randomUUID(), population_evidence: null, expected_team_count: null,
    coverage: { periodIds: [], interval: null, entitySet: 'full', fields: LEAGUE_SETTINGS_FIELDS, pagination: 'complete',
      nextCursor: null, completeness: 'complete', reasons: [] } };
}
const database = (query: unknown) => ({ enabled: true, query } as DatabaseClient);
describe('league settings SQL transport', () => {
  it('uses one scoped query and retains receipt times independent of configuration identity', async () => {
    const evidence = row(); const query = vi.fn(async () => [evidence]);
    const read = await leagueSettingsMethods(database(query)).readAcceptedLeagueSettings(mapping);
    expect(read).toMatchObject({ status: 'available', leagueId: evidence.league_id, accepted: { verifiedAt: at },
      receipt: { provenance: normalized.envelope.provenance, sourceUpdatedAt: null, configurationVersionId: evidence.configuration_version_id } });
    expect(query).toHaveBeenCalledOnce(); expect(query.mock.calls[0]?.length).toBe(2);
  });
  it.each([
    ['wrong source', { external_league_id: 'other' }], ['wrong season', { league_season_id: randomUUID() }],
    ['wrong mapping', { source_mapping_revision_id: randomUUID() }], ['hash corruption', { content_hash: 'bad' }],
    ['config corruption', { semantic_hash: 'bad' }], ['partial capture', { completeness: 'partial' }],
    ['fake population', { expected_team_count: 2 }], ['wrong content', { configuration_content_id: randomUUID() }],
    ['wrong coverage', { coverage: { completeness: 'complete' } }], ['absent provenance', { provenance: {} }],
    ['wrong normalized value', { normalized_value: {} }], ['invalid generation', { generation: 0 }],
  ] as const)('fails closed on %s', async (_label, change) => {
    expect(await leagueSettingsMethods(database(async () => [{ ...row(), ...change }])).readAcceptedLeagueSettings(mapping))
      .toEqual({ status: 'unavailable', reason: 'league_settings_evidence_unavailable' });
  });
  it('distinguishes missing, ambiguous, disabled and failed storage', async () => {
    expect(await leagueSettingsMethods(database(async () => [])).readAcceptedLeagueSettings(mapping)).toEqual({ status: 'missing' });
    expect(await leagueSettingsMethods(database(async () => [row(), row()])).readAcceptedLeagueSettings(mapping)).toMatchObject({ status: 'unavailable' });
    expect(await leagueSettingsMethods(database(async () => { throw Error('failure'); })).readAcceptedLeagueSettings(mapping)).toMatchObject({ status: 'unavailable' });
    const disabled = createLeagueAdministrationStore({ enabled: false, reason: 'preview-persistence-disabled' });
    expect(await disabled.readAcceptedLeagueSettings(mapping)).toEqual({ status: 'disabled' });
    await expect(disabled.beginLeagueSettingsAttempt(mapping, randomUUID())).rejects.toThrow('disabled');
  });
  it('reserves the closed policy once with mapping and writer fence', async () => {
    const attemptId = randomUUID(); const attempt = { id: attemptId, scopeId: randomUUID(), ordinal: 1, expectedGeneration: 0 };
    const query = vi.fn(async () => [{ result: attempt }]);
    const fence = { jobKey: 'job', workerId: 'worker', generation: 1, deadlineAt: at };
    expect(await leagueSettingsMethods(database(query)).beginLeagueSettingsAttempt(mapping, attemptId, fence)).toEqual(attempt);
    expect(query).toHaveBeenCalledExactlyOnceWith(expect.stringContaining('begin_current_roster_attempt'),
      [JSON.stringify(mapping), attemptId, JSON.stringify(leagueSettingsScope(mapping)), JSON.stringify(LEAGUE_SETTINGS_POLICY), JSON.stringify(fence)]);
  });
});
