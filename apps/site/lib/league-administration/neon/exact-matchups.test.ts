import capture from '../../../test-support/fixtures/sleeper-2026-season-schedule.json';
import { createSleeperCalendarEvidence } from '../period-mapping';
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

function mappedFixture(week = 3) {
  const payload: JsonValue = [{ roster_id: 1, matchup_id: null, players: ['a'], starters: ['a'],
    starters_points: [8.25], players_points: { a: 8.25 }, points: 8.25, custom_points: 0 }];
  const provenance = { origin: 'network' as const, requestStartedAt: '2026-09-25T12:00:00.000Z',
    requestCompletedAt: '2026-09-25T12:00:01.000Z', sourceObservedAt: '2026-09-25T12:00:01.000Z',
    checkedAt: '2026-09-25T12:00:02.000Z' };
  const normalized = normalizeAdministrationObservation({ schemaVersion: 'league-administration-v1',
    normalizerVersion: 'sleeper-administration-v1', dialect: 'sleeper-nfl-v1', scope: mapping.scope,
    family: 'matchups', week, completeness: 'complete', provenance, payload }, { expectedRosterCount: 1 });
  const configurationContentId = randomUUID();
  const evidence = createSleeperCalendarEvidence({ season: '2026', seasonSchedule: capture.body,
    evaluatedAt: '2026-09-15T17:00:00.000Z', retrievalStartedAt: '2026-09-15T17:00:00.000Z',
    retrievalCompletedAt: '2026-09-15T17:00:01.000Z' });
  if (!evidence) throw new Error('Invalid calendar fixture.');
  const row = {
    identity: { scope: exactMatchupsScope(mapping, week), policy: EXACT_MATCHUPS_POLICY },
    generation: 1, source_mapping_revision_id: mapping.revisionId,
    receipt_id: randomUUID(), attempt_id: randomUUID(), provenance,
    coverage: { periodIds: [`sleeper:matchup-week:${week}`], interval: null, entitySet: 'full',
      fields: ['roster_id', 'matchup_id'], pagination: 'complete', nextCursor: null,
      completeness: 'complete', reasons: [] },
    configuration_content_id: configurationContentId,
    population_evidence: { contentHash: 'configuration-hash' }, expected_team_count: 1,
    legacy_observation_id: randomUUID(), ordinal: 1, source_mapping: mapping,
    configuration_payload: { league_id: mapping.scope.externalLeagueId, season: '2026', sport: 'nfl',
      season_type: 'regular', total_rosters: 1, status: 'in_season', settings: { leg: week }, roster_positions: ['QB'] },
    configuration_hash: 'configuration-hash', content_id: randomUUID(), content_hash: normalized.contentHash,
    semantic_hash: normalized.semanticHash, payload, normalized_value: normalized.value,
    normalizer_version: 'sleeper-administration-v1', completeness: 'complete', league_season_id: mapping.leagueSeasonId,
    provider: 'sleeper', external_league_id: mapping.scope.externalLeagueId, family: 'matchups', week,
    teams: [{ seasonTeamId: randomUUID(), externalRosterId: '1' }],
    calendar_evidence: { id: randomUUID(), connection_id: mapping.connectionId,
      league_season_id: mapping.leagueSeasonId, source_mapping_revision_id: mapping.revisionId,
      configuration_content_id: configurationContentId, observation_id: randomUUID(),
      mapping_policy_version: evidence.mappingPolicyVersion, schedule_revision: evidence.scheduleRevision, evidence },
  };
  return row;
}

describe('accepted exact matchup period mapping', () => {
  it.each([1, 3, 18])('maps exact native week %s with retained proof, regardless of the old evaluated current week', async week => {
    const row = mappedFixture(week);
    const respond = vi.fn(() => [row]);
    const read = await exactMatchupMethods(database(respond)).readAcceptedExactMatchups(mapping, week);
    expect(read.status).toBe('available');
    if (read.status !== 'available') throw new Error('Expected official matchup.');
    expect(read.value.period.nflWeekMappings).toEqual([{ season: 2026, seasonType: 'regular', week,
      evidenceRef: row.calendar_evidence.id }]);
    expect(read.periodMapping).toMatchObject({ status: 'mapped', purpose: 'native-period-identity', week,
      sourceObservedAt: null, evaluatedAt: row.calendar_evidence.evidence.evaluatedAt });
    expect(read.accepted.verifiedAt).toBe(row.provenance.sourceObservedAt);
    expect(read.value.state).toEqual({ provider: 'unknown', local: 'unknown', reason: 'no_matchup_finality_evidence' });
    expect(read.value.projectionRef).toBeNull();
    expect(respond).toHaveBeenCalledOnce();
  });

  it.each([
    ['missing', (row: ReturnType<typeof mappedFixture>) => ({ ...row, calendar_evidence: null })],
    ['wrong connection', (row: ReturnType<typeof mappedFixture>) => ({ ...row, calendar_evidence: { ...row.calendar_evidence, connection_id: randomUUID() } })],
    ['wrong league-season', (row: ReturnType<typeof mappedFixture>) => ({ ...row, calendar_evidence: { ...row.calendar_evidence, league_season_id: randomUUID() } })],
    ['wrong configuration', (row: ReturnType<typeof mappedFixture>) => ({ ...row, calendar_evidence: { ...row.calendar_evidence, configuration_content_id: randomUUID() } })],
    ['old source revision', (row: ReturnType<typeof mappedFixture>) => ({ ...row, calendar_evidence: { ...row.calendar_evidence, source_mapping_revision_id: randomUUID() } })],
    ['wrong source season', (row: ReturnType<typeof mappedFixture>) => ({ ...row, calendar_evidence: { ...row.calendar_evidence, evidence: { ...row.calendar_evidence.evidence, source: { ...row.calendar_evidence.evidence.source, season: '2025' } } } })],
    ['partial calendar', (row: ReturnType<typeof mappedFixture>) => ({ ...row, calendar_evidence: { ...row.calendar_evidence, evidence: { ...row.calendar_evidence.evidence, schedule: row.calendar_evidence.evidence.schedule.slice(1) } } })],
    ['wrong calendar revision', (row: ReturnType<typeof mappedFixture>) => ({ ...row, calendar_evidence: { ...row.calendar_evidence, schedule_revision: '0'.repeat(64) } })],
    ['unsupported mapping policy', (row: ReturnType<typeof mappedFixture>) => ({ ...row, calendar_evidence: { ...row.calendar_evidence, mapping_policy_version: 'unknown-policy' } })],
    ['invented provider observation', (row: ReturnType<typeof mappedFixture>) => ({ ...row, calendar_evidence: { ...row.calendar_evidence, evidence: { ...row.calendar_evidence.evidence, sourceObservedAt: row.provenance.sourceObservedAt } } })],
    ['unsupported league format', (row: ReturnType<typeof mappedFixture>) => ({ ...row, configuration_payload: { ...row.configuration_payload, season_type: 'post' } })],
  ])('keeps official values and receipt unchanged with %s evidence', async (_name, change) => {
    const row = mappedFixture();
    const original = await exactMatchupMethods(database(() => [row])).readAcceptedExactMatchups(mapping, 3);
    const read = await exactMatchupMethods(database(() => [change(row)])).readAcceptedExactMatchups(mapping, 3);
    if (original.status !== 'available' || read.status !== 'available') throw new Error('Mapping hid official data.');
    expect(read.value.period.nflWeekMappings).toEqual([]);
    expect(read.periodMapping.status).toBe('unmapped');
    expect(read.value.teams).toEqual(original.value.teams);
    expect(read.value.groups).toEqual(original.value.groups);
    expect(read.receipt).toEqual(original.receipt);
    expect(read.accepted).toEqual(original.accepted);
  });

  it('cannot reuse first-A proof for a new A source revision after an A-to-B-to-A remap', async () => {
    const row = mappedFixture();
    const nextMapping = { ...mapping, generation: 3, revisionId: randomUUID() };
    const read = await exactMatchupMethods(database(() => [{ ...row, source_mapping: nextMapping,
      source_mapping_revision_id: nextMapping.revisionId }])).readAcceptedExactMatchups(nextMapping, 3);
    if (read.status !== 'available') throw new Error('Expected new official acceptance.');
    expect(read.periodMapping).toEqual({ status: 'unmapped', reason: 'calendar_evidence_invalid' });
    expect(read.value.period.nflWeekMappings).toEqual([]);
  });
});
