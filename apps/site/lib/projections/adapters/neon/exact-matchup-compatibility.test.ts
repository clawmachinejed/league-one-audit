import { describe, expect, it, vi } from 'vitest';
import type { DatabaseClient, DatabaseRow } from '../../../database';
import type { AdministrationSourceMapping } from '../../../league-administration/source-mapping';
import type { JsonValue } from '../../../league-administration/contracts';
import { normalizeAdministrationObservation } from '../../../league-administration/normalize';
import { createSleeperCalendarEvidence } from '../../../league-administration/period-mapping';
import schedule from '../../../../test-support/fixtures/sleeper-2026-season-schedule.json';
import { compatibleScoringRulesHash } from '../../shared/revision-compatibility';
import type { MatchupsData, Player, Team } from '../../../types';
import { EXACT_MATCHUPS_POLICY, exactMatchupsScope } from '../../../aggregator/exact-matchups';
import { createExactMatchupCompatibilityReader, type ExactMatchupCompatibilityReadInput } from '../../../league-administration/store';

vi.mock('server-only', () => ({}));
const uuid = (value: number) => `00000000-0000-4000-8000-${String(value).padStart(12, '0')}`;
const mapping: AdministrationSourceMapping = { connectionId: uuid(1), leagueSeasonId: uuid(2), revisionId: uuid(3), generation: 1,
  scope: { leagueKey: 'league1', provider: 'sleeper', externalLeagueId: 'fixture-source', season: 2026 } };
const input: ExactMatchupCompatibilityReadInput = {
  request: { snapshotId: uuid(4), leagueSeasonId: uuid(2), season: 2026, week: 4, modelVersion: 'clock-v1' },
  expectedMapping: mapping, now: new Date('2026-09-29T12:01:00.000Z'),
  context: { defaultSeason: 2026, defaultWeek: 4, activeSeason: 2026, activeWeek: 4,
    lifecycle: 'active', nflPhase: 'regular', temporalState: 'active', refreshDue: false },
};
function fixture() {
  const rules = { rec: 0.5 };
  const raw: JsonValue = [
    { roster_id: 1, matchup_id: 4, players: ['a'], starters: ['a', '0'],
      starters_points: [8.25, null], players_points: { a: 8.25 }, points: 8.25, custom_points: 0 },
    { roster_id: 2, matchup_id: 4, players: ['b'], starters: ['b', '0'],
      starters_points: [4, null], players_points: { b: 4 }, points: 4 },
  ];
  const provenance = { origin: 'network' as const, requestStartedAt: '2026-09-29T12:00:00.000Z',
    requestCompletedAt: '2026-09-29T12:00:01.000Z', sourceObservedAt: '2026-09-29T12:00:01.000Z',
    checkedAt: '2026-09-29T12:00:02.000Z' };
  const configuration: JsonValue = { league_id: mapping.scope.externalLeagueId, season: '2026', sport: 'nfl', season_type: 'regular',
    total_rosters: 2, status: 'in_season', settings: { leg: 4 }, roster_positions: ['QB', 'RB', 'BN'], scoring_settings: rules };
  const normalize = (family: 'league' | 'matchups', payload: JsonValue) => normalizeAdministrationObservation({
    schemaVersion: 'league-administration-v1', normalizerVersion: 'sleeper-administration-v1', dialect: 'sleeper-nfl-v1',
    scope: mapping.scope, family, week: family === 'league' ? null : 4, completeness: 'complete', provenance, payload },
  { expectedRosterCount: 2 });
  const normalized = normalize('matchups', raw), league = normalize('league', configuration);
  const calendar = createSleeperCalendarEvidence({ season: '2026', seasonSchedule: schedule.body,
    evaluatedAt: provenance.requestStartedAt, retrievalStartedAt: provenance.requestStartedAt,
    retrievalCompletedAt: provenance.requestCompletedAt });
  if (!calendar) throw new Error('Invalid synthetic calendar.');
  const calendarEvidence = { id: uuid(22), connection_id: mapping.connectionId, league_season_id: mapping.leagueSeasonId,
    source_mapping_revision_id: mapping.revisionId, configuration_content_id: uuid(7), observation_id: uuid(21),
    mapping_policy_version: calendar.mappingPolicyVersion, schedule_revision: calendar.scheduleRevision, evidence: calendar };
  const accepted = { identity: { scope: exactMatchupsScope(mapping, 4), policy: EXACT_MATCHUPS_POLICY }, generation: 1,
    source_mapping_revision_id: mapping.revisionId, receipt_id: uuid(5), attempt_id: uuid(6), provenance,
    coverage: { periodIds: ['sleeper:matchup-week:4'], interval: null, entitySet: 'full',
      fields: ['roster_id', 'matchup_id'], pagination: 'complete', nextCursor: null, completeness: 'complete', reasons: [] },
    configuration_content_id: uuid(7), population_evidence: { contentHash: league.contentHash }, expected_team_count: 2,
    legacy_observation_id: uuid(8), ordinal: 1, source_mapping: mapping,
    configuration_payload: configuration, configuration_hash: league.contentHash,
    content_id: uuid(9), content_hash: normalized.contentHash, semantic_hash: normalized.semanticHash,
    payload: raw, normalized_value: normalized.value, normalizer_version: 'sleeper-administration-v1', completeness: 'complete',
    league_season_id: mapping.leagueSeasonId, provider: 'sleeper', external_league_id: mapping.scope.externalLeagueId,
    family: 'matchups', week: 4, teams: [{ seasonTeamId: uuid(19), externalRosterId: '1' },
      { seasonTeamId: uuid(20), externalRosterId: '2' }], calendar_evidence: calendarEvidence };
  const capture = { id: uuid(12), connection_id: mapping.connectionId, league_season_id: mapping.leagueSeasonId,
    source_mapping_revision_id: mapping.revisionId, week: 4, reserved_at: '2026-09-29T11:59:59.000001+00:00' };
  const revision = { id: mapping.revisionId, connection_id: mapping.connectionId, league_season_id: mapping.leagueSeasonId,
    generation: 1, provider: 'sleeper', external_league_id: mapping.scope.externalLeagueId, source_namespace: 'nfl:2026' };
  const contents = ([league, normalized] as const).map((document, index) => ({
    id: index ? uuid(9) : uuid(7), league_season_id: mapping.leagueSeasonId, provider: 'sleeper',
    external_league_id: mapping.scope.externalLeagueId, family: index ? 'matchups' : 'league', week: index ? 4 : 0,
    normalizer_version: 'sleeper-administration-v1', accepted: true, completeness: 'complete', content_hash: document.contentHash,
    configuration_version_id: index ? null : uuid(15), payload: document.envelope.payload,
    scoring_profile_id: index ? null : uuid(16), configuration_league_season_id: index ? null : mapping.leagueSeasonId,
    configuration_dialect: index ? null : 'sleeper-nfl-v1', configuration_normalizer_version: index ? null : 'sleeper-administration-v1',
    calendar_evidence: index ? null : calendarEvidence,
  }));
  const inputs = contents.map((content, index) => ({
    input: { id: index ? uuid(14) : uuid(13), capture_id: capture.id, family: content.family,
      observation_id: index ? uuid(8) : uuid(21), content_id: content.id,
      configuration_version_id: content.configuration_version_id, provenance },
    capture, revision, content,
    legacy_observation: { id: index ? uuid(8) : uuid(21), content_id: content.id,
      league_season_id: mapping.leagueSeasonId, family: content.family, week: content.week, outcome: 'changed',
      origin: 'network', request_started_at: provenance.requestStartedAt, request_completed_at: provenance.requestCompletedAt,
      source_observed_at: provenance.sourceObservedAt, checked_at: provenance.checkedAt },
  }));
  const observation = { id: uuid(11), league_season_id: mapping.leagueSeasonId, provider: 'sleeper', week: 4, quality: 'complete',
    request_started_at: provenance.requestStartedAt, request_completed_at: provenance.requestCompletedAt,
    observed_at: provenance.sourceObservedAt, source_data: { season: '2026', week: 4, leagueKey: 'league1', administration: {
      observationId: uuid(21), configurationVersionId: uuid(15), sourceCapture: {
        captureId: uuid(12), leagueInputId: uuid(13), matchupInputId: uuid(14) },
    } } };
  const history = { snapshot_id: input.request.snapshotId, league_season_id: mapping.leagueSeasonId, season: 2026,
    league_key: 'league1', week: 4, model_version: 'clock-v1', league_week_observation_id: observation.id,
    game_state_observation_ids: [uuid(18)], current_snapshot_id: input.request.snapshotId,
    verification_source_observation_id: observation.id, original_observation: observation, verification_observation: observation, inputs };
  const teams: Team[] = [1, 2].map(id => ({ id, managerName: `Manager ${id}`, name: `Team ${id}`, avatar: null,
    wins: 0, losses: 0, ties: 0, pointsFor: 0, pointsAgainst: 0 }));
  const starter = (id: string, points: number): Player => ({ id, name: id, position: 'QB', slot: 'QB',
    injuryStatus: null, nflTeam: id === 'a' ? 'IND' : 'HOU', points, projectedPoints: 10,
    game: { kind: 'scheduled', opponent: id === 'a' ? 'HOU' : 'IND', location: id === 'a' ? 'home' : 'away',
      date: '2026-10-04', kickoffAt: '2026-10-04T17:00:00.000Z' } });
  const empty: Player = { id: 'empty-RB-1', name: 'Empty slot', position: '-', slot: 'RB', injuryStatus: null,
    nflTeam: null, points: null, projectedPoints: null, game: null };
  const payload: MatchupsData = { league: { season: '2026', rosterPositions: ['QB', 'RB'], week: 4, maxWeek: 18 }, teams,
    updatedAt: provenance.requestCompletedAt, week: 4, matchups: [{ id: '4', status: 'upcoming', sides: [
      { team: teams[1], points: 4, projectedPoints: 10, starters: [starter('b', 4), { ...empty }] },
      { team: teams[0], points: 0, projectedPoints: 10, starters: [starter('a', 8.25), { ...empty }] },
    ], winProbability: { modelVersion: 'normal-v3', status: 'estimated',
      teams: [{ teamId: 1, probability: 0.4 }, { teamId: 2, probability: 0.6 }] } }] };
  return { accepted_rows: [accepted], history_rows: [history], snapshot_rows: [{ snapshot_id: input.request.snapshotId,
    league_season_id: mapping.leagueSeasonId, week: 4, model_version: 'clock-v1', revision_key: 'synthetic-revision',
    calculated_at: provenance.requestCompletedAt, published_at: provenance.checkedAt, verified_at: provenance.requestCompletedAt,
    payload, activity_windows: [{ startsAt: '2026-10-04T15:00:00.000Z', endsAt: '2026-10-05T00:00:00.000Z' }], is_current: true }],
  contents, profile: { id: uuid(16), rulesHash: compatibleScoringRulesHash(rules), rules },
  games: { leagueWeekObservationId: observation.id, expectedGameCount: 1, expectedGameIds: [uuid(17)], observations: [{
    id: uuid(18), nflGameId: uuid(17), provider: 'tank01', season: 2026, seasonType: 'reg', week: 4,
    observedAt: provenance.sourceObservedAt, requestStartedAt: provenance.requestStartedAt,
    requestCompletedAt: provenance.requestCompletedAt, homeTeam: 'IND', awayTeam: 'HOU',
  }] } };
}
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
