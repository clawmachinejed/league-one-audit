/** Synthetic same-capture B1 evidence; never imported by runtime code. */
import type { AdministrationSourceMapping } from '../league-administration/source-mapping';
import type { AdministrationEnvelope, JsonValue } from '../league-administration/contracts';
import type { RetainedMatchupEvidence, RetainedMatchupSelection } from '../league-administration/retained-matchups-contracts';
import { normalizeAdministrationObservation } from '../league-administration/normalize';
import { createSleeperCalendarEvidence } from '../league-administration/period-mapping';
import schedule from '../../test-support/fixtures/sleeper-2026-season-schedule.json';
import { compatibleScoringRulesHash } from '../projections/shared/revision-compatibility';
import type { MatchupsData, Player, Team } from '../types';
import { EXACT_MATCHUPS_POLICY, exactMatchupsScope } from './exact-matchups';
import type { ExactMatchupCompatibilityReadInput } from '../league-administration/store';
import { CURRENT_ROSTER_POLICY, currentRosterScope } from './current-roster';
import { projectPlayerCatalog, type FantasyPlayerCatalog } from '../sleeper-player-catalog';
export const b1Uuid = (value: number) => `00000000-0000-4000-8000-${String(value).padStart(12, '0')}`;
export const b1Mapping: AdministrationSourceMapping = { connectionId: b1Uuid(1), leagueSeasonId: b1Uuid(2), revisionId: b1Uuid(3), generation: 1,
  scope: { leagueKey: 'league1', provider: 'sleeper', externalLeagueId: 'fixture-source', season: 2026 } };
export const b1CompatibilityInput: ExactMatchupCompatibilityReadInput = {
  request: { snapshotId: b1Uuid(4), leagueSeasonId: b1Uuid(2), season: 2026, week: 4, modelVersion: 'clock-v1' },
  expectedMapping: b1Mapping, now: new Date('2026-09-29T12:01:00.000Z'),
  context: { defaultSeason: 2026, defaultWeek: 4, activeSeason: 2026, activeWeek: 4,
    lifecycle: 'active', nflPhase: 'regular', temporalState: 'active', refreshDue: false },
};
export function b1CompatibilityFixture(playerIds: readonly [string, string] = ['a', 'b']) {
  const [firstPlayerId, secondPlayerId] = playerIds;
  const rules = { rec: 0.5 };
  const raw: JsonValue = [
    { roster_id: 1, matchup_id: 4, players: [firstPlayerId], starters: [firstPlayerId, '0'],
      starters_points: [8.25, null], players_points: { [firstPlayerId]: 9.5 }, points: 8.25, custom_points: 0 },
    { roster_id: 2, matchup_id: 4, players: [secondPlayerId], starters: [secondPlayerId, '0'],
      starters_points: [4, null], players_points: { [secondPlayerId]: 4 }, points: 4 },
  ];
  const provenance = { origin: 'network' as const, requestStartedAt: '2026-09-29T12:00:00.000Z',
    requestCompletedAt: '2026-09-29T12:00:01.000Z', sourceObservedAt: '2026-09-29T12:00:01.000Z',
    checkedAt: '2026-09-29T12:00:02.000Z' };
  const configuration: JsonValue = { league_id: b1Mapping.scope.externalLeagueId, season: '2026', sport: 'nfl', season_type: 'regular',
    total_rosters: 2, status: 'in_season', settings: { leg: 4 }, roster_positions: ['QB', 'RB', 'BN'], scoring_settings: rules };
  const normalize = (family: 'league' | 'matchups', payload: JsonValue) => normalizeAdministrationObservation({
    schemaVersion: 'league-administration-v1', normalizerVersion: 'sleeper-administration-v1', dialect: 'sleeper-nfl-v1',
    scope: b1Mapping.scope, family, week: family === 'league' ? null : 4, completeness: 'complete', provenance, payload },
  { expectedRosterCount: 2 });
  const normalized = normalize('matchups', raw), league = normalize('league', configuration);
  const calendar = createSleeperCalendarEvidence({ season: '2026', seasonSchedule: schedule.body,
    evaluatedAt: provenance.requestStartedAt, retrievalStartedAt: provenance.requestStartedAt,
    retrievalCompletedAt: provenance.requestCompletedAt });
  if (!calendar) throw new Error('Invalid synthetic calendar.');
  const calendarEvidence = { id: b1Uuid(22), connection_id: b1Mapping.connectionId, league_season_id: b1Mapping.leagueSeasonId,
    source_mapping_revision_id: b1Mapping.revisionId, configuration_content_id: b1Uuid(7), observation_id: b1Uuid(21),
    mapping_policy_version: calendar.mappingPolicyVersion, schedule_revision: calendar.scheduleRevision, evidence: calendar };
  const accepted = { identity: { scope: exactMatchupsScope(b1Mapping, 4), policy: EXACT_MATCHUPS_POLICY }, generation: 1,
    source_mapping_revision_id: b1Mapping.revisionId, receipt_id: b1Uuid(5), attempt_id: b1Uuid(6), provenance,
    coverage: { periodIds: ['sleeper:matchup-week:4'], interval: null, entitySet: 'full',
      fields: ['roster_id', 'matchup_id'], pagination: 'complete', nextCursor: null, completeness: 'complete', reasons: [] },
    configuration_content_id: b1Uuid(7), population_evidence: { contentHash: league.contentHash }, expected_team_count: 2,
    legacy_observation_id: b1Uuid(8), ordinal: 1, source_mapping: b1Mapping,
    configuration_payload: configuration, configuration_hash: league.contentHash,
    content_id: b1Uuid(9), content_hash: normalized.contentHash, semantic_hash: normalized.semanticHash,
    payload: raw, normalized_value: normalized.value, normalizer_version: 'sleeper-administration-v1', completeness: 'complete',
    league_season_id: b1Mapping.leagueSeasonId, provider: 'sleeper', external_league_id: b1Mapping.scope.externalLeagueId,
    family: 'matchups', week: 4, teams: [{ seasonTeamId: b1Uuid(19), externalRosterId: '1' },
      { seasonTeamId: b1Uuid(20), externalRosterId: '2' }], calendar_evidence: calendarEvidence };
  const capture = { id: b1Uuid(12), connection_id: b1Mapping.connectionId, league_season_id: b1Mapping.leagueSeasonId,
    source_mapping_revision_id: b1Mapping.revisionId, week: 4, reserved_at: '2026-09-29T11:59:59.000001+00:00' };
  const revision = { id: b1Mapping.revisionId, connection_id: b1Mapping.connectionId, league_season_id: b1Mapping.leagueSeasonId,
    generation: 1, provider: 'sleeper', external_league_id: b1Mapping.scope.externalLeagueId, source_namespace: 'nfl:2026' };
  const contents = ([league, normalized] as const).map((document, index) => ({
    id: index ? b1Uuid(9) : b1Uuid(7), league_season_id: b1Mapping.leagueSeasonId, provider: 'sleeper',
    external_league_id: b1Mapping.scope.externalLeagueId, family: index ? 'matchups' : 'league', week: index ? 4 : 0,
    normalizer_version: 'sleeper-administration-v1', accepted: true, completeness: 'complete', content_hash: document.contentHash,
    configuration_version_id: index ? null : b1Uuid(15), payload: document.envelope.payload,
    scoring_profile_id: index ? null : b1Uuid(16), configuration_league_season_id: index ? null : b1Mapping.leagueSeasonId,
    configuration_dialect: index ? null : 'sleeper-nfl-v1', configuration_normalizer_version: index ? null : 'sleeper-administration-v1',
    calendar_evidence: index ? null : calendarEvidence,
  }));
  const inputs = contents.map((content, index) => ({
    input: { id: index ? b1Uuid(14) : b1Uuid(13), capture_id: capture.id, family: content.family,
      observation_id: index ? b1Uuid(8) : b1Uuid(21), content_id: content.id,
      configuration_version_id: content.configuration_version_id, provenance },
    capture, revision, content,
    legacy_observation: { id: index ? b1Uuid(8) : b1Uuid(21), content_id: content.id,
      league_season_id: b1Mapping.leagueSeasonId, family: content.family, week: content.week, outcome: 'changed',
      origin: 'network', request_started_at: provenance.requestStartedAt, request_completed_at: provenance.requestCompletedAt,
      source_observed_at: provenance.sourceObservedAt, checked_at: provenance.checkedAt },
  }));
  const observation = { id: b1Uuid(11), league_season_id: b1Mapping.leagueSeasonId, provider: 'sleeper', week: 4, quality: 'complete',
    request_started_at: provenance.requestStartedAt, request_completed_at: provenance.requestCompletedAt,
    observed_at: provenance.sourceObservedAt, source_data: { season: '2026', week: 4, leagueKey: 'league1', administration: {
      observationId: b1Uuid(21), configurationVersionId: b1Uuid(15), sourceCapture: {
        captureId: b1Uuid(12), leagueInputId: b1Uuid(13), matchupInputId: b1Uuid(14) },
    } } };
  const history = { snapshot_id: b1CompatibilityInput.request.snapshotId, league_season_id: b1Mapping.leagueSeasonId, season: 2026,
    league_key: 'league1', week: 4, model_version: 'clock-v1', league_week_observation_id: observation.id,
    game_state_observation_ids: [b1Uuid(18)], current_snapshot_id: b1CompatibilityInput.request.snapshotId,
    verification_source_observation_id: observation.id, original_observation: observation, verification_observation: observation, inputs };
  const teams: Team[] = [1, 2].map(id => ({ id, managerName: `Manager ${id}`, name: `Team ${id}`, avatar: null,
    wins: 0, losses: 0, ties: 0, pointsFor: 0, pointsAgainst: 0 }));
  const starter = (id: string, points: number): Player => ({ id, name: id, position: 'QB', slot: 'QB',
    injuryStatus: null, nflTeam: id === firstPlayerId ? 'IND' : 'HOU', points, projectedPoints: 10,
    game: { kind: 'scheduled', opponent: id === firstPlayerId ? 'HOU' : 'IND', location: id === firstPlayerId ? 'home' : 'away',
      date: '2026-10-04', kickoffAt: '2026-10-04T17:00:00.000Z' } });
  const empty: Player = { id: 'empty-RB-1', name: 'Empty slot', position: '-', slot: 'RB', injuryStatus: null,
    nflTeam: null, points: null, projectedPoints: null, game: null };
  const payload: MatchupsData = { league: { season: '2026', rosterPositions: ['QB', 'RB'], week: 4, maxWeek: 18 }, teams,
    updatedAt: provenance.requestCompletedAt, week: 4, matchups: [{ id: '4', status: 'upcoming', sides: [
      { team: teams[1], points: 4, projectedPoints: 10, starters: [starter(secondPlayerId, 4), { ...empty }] },
      { team: teams[0], points: 0, projectedPoints: 10, starters: [starter(firstPlayerId, 8.25), { ...empty }] },
    ], winProbability: { modelVersion: 'normal-v3', status: 'estimated',
      teams: [{ teamId: 1, probability: 0.4 }, { teamId: 2, probability: 0.6 }] } }] };
  return { accepted_rows: [accepted], history_rows: [history], snapshot_rows: [{ snapshot_id: b1CompatibilityInput.request.snapshotId,
    league_season_id: b1Mapping.leagueSeasonId, week: 4, model_version: 'clock-v1', revision_key: 'synthetic-revision',
    calculated_at: provenance.requestCompletedAt, published_at: provenance.checkedAt, verified_at: provenance.requestCompletedAt,
    payload, activity_windows: [{ startsAt: '2026-10-04T15:00:00.000Z', endsAt: '2026-10-05T00:00:00.000Z' }], is_current: true }],
  contents, profile: { id: b1Uuid(16), rulesHash: compatibleScoringRulesHash(rules), rules },
  games: { leagueWeekObservationId: observation.id, expectedGameCount: 1, expectedGameIds: [b1Uuid(17)], observations: [{
    id: b1Uuid(18), nflGameId: b1Uuid(17), provider: 'tank01', season: 2026, seasonType: 'reg', week: 4,
    observedAt: provenance.sourceObservedAt, requestStartedAt: provenance.requestStartedAt,
    requestCompletedAt: provenance.requestCompletedAt, homeTeam: 'IND', awayTeam: 'HOU',
  }] } };
}

export const b1RetainedSelection: RetainedMatchupSelection = {
  leagueSeasonId: b1Mapping.leagueSeasonId, scope: b1Mapping.scope, nativeWeeks: [4],
};
export function b1CaptureEnvelope(row: ReturnType<typeof b1CompatibilityFixture>): AdministrationEnvelope {
  const accepted = row.accepted_rows[0];
  return { schemaVersion: 'league-administration-v1', normalizerVersion: 'sleeper-administration-v1',
    dialect: 'sleeper-nfl-v1', scope: b1Mapping.scope, family: 'matchups', week: 4,
    completeness: 'complete', provenance: accepted.provenance, payload: accepted.payload };
}

/** Retained and accepted fixtures refer to the very same content, observation, and team UUIDs. */
export function b1RetainedEvidence(row: ReturnType<typeof b1CompatibilityFixture>): RetainedMatchupEvidence {
  const accepted = row.accepted_rows[0];
  const normalized = normalizeAdministrationObservation(b1CaptureEnvelope(row));
  if (normalized.status !== 'accepted' || normalized.value?.family !== 'matchups') throw new Error('Invalid B1 fixture.');
  const contentId = accepted.content_id, observationId = accepted.legacy_observation_id;
  return {
    league: { leagueSeasonId: b1Mapping.leagueSeasonId, leagueKey: b1Mapping.scope.leagueKey, season: 2026 },
    observation: { id: observationId, leagueSeasonId: b1Mapping.leagueSeasonId, family: 'matchups', week: 4,
      contentId, provenance: accepted.provenance, orderingAt: accepted.provenance.sourceObservedAt,
      recordedAt: accepted.provenance.checkedAt, outcome: 'changed' },
    content: { id: contentId, leagueSeasonId: b1Mapping.leagueSeasonId, provider: 'sleeper',
      externalLeagueId: b1Mapping.scope.externalLeagueId, family: 'matchups', week: 4,
      normalizerVersion: 'sleeper-administration-v1', contentHash: accepted.content_hash,
      semanticHash: accepted.semantic_hash, completeness: 'complete', accepted: true,
      payload: accepted.payload, normalizedValue: accepted.normalized_value as JsonValue },
    teamLinks: normalized.value.matchups.map(source => {
      const team = accepted.teams.find(team => team.externalRosterId === source.externalRosterId);
      if (!team) throw new Error('Missing B1 team fixture.');
      return { contentId, leagueSeasonId: b1Mapping.leagueSeasonId, teamId: team.seasonTeamId, sourceValue: source as JsonValue,
        team: { id: team.seasonTeamId, leagueSeasonId: b1Mapping.leagueSeasonId, provider: 'sleeper',
          externalLeagueId: b1Mapping.scope.externalLeagueId, externalRosterId: team.externalRosterId } };
    }),
    mapping: null,
    mappingCandidates: [{ kind: 'matchup-receipt', id: accepted.receipt_id, observationId, contentId,
      family: 'matchups', nativePeriodId: 'sleeper:matchup-week:4', provenance: accepted.provenance,
      sourceMapping: b1Mapping, revision: { id: b1Mapping.revisionId, connectionId: b1Mapping.connectionId,
        leagueSeasonId: b1Mapping.leagueSeasonId, provider: 'sleeper', externalLeagueId: b1Mapping.scope.externalLeagueId,
        sourceNamespace: 'nfl:2026', generation: b1Mapping.generation } }],
  };
}

/** A distinct current-roster receipt from the same source batch, never a period-lineup replacement. */
export function b1CurrentRosterFixture(row: ReturnType<typeof b1CompatibilityFixture>) {
  const exact = row.accepted_rows[0];
  const payload: JsonValue = [
    { roster_id: 1, players: ['1001', '1003', '1004', '1005'], starters: ['1001', '0'], reserve: ['1003'], taxi: ['1004'] },
    { roster_id: 2, players: ['1002'], starters: ['1002', '0'], reserve: [], taxi: [] },
  ];
  const normalized = normalizeAdministrationObservation({ ...b1CaptureEnvelope(row), family: 'rosters', week: null, payload },
    { expectedRosterCount: 2 });
  return { identity: { scope: currentRosterScope(b1Mapping), policy: CURRENT_ROSTER_POLICY },
    scope_id: b1Uuid(30), generation: 1, source_mapping_revision_id: b1Mapping.revisionId,
    receipt_id: b1Uuid(31), attempt_id: b1Uuid(32), provenance: exact.provenance,
    configuration_content_id: exact.configuration_content_id, expected_team_count: 2,
    legacy_observation_id: b1Uuid(33), ordinal: 1, source_mapping: b1Mapping,
    coverage: { periodIds: [], interval: null, entitySet: 'full', fields: ['players'], pagination: 'complete',
      nextCursor: null, completeness: 'complete', reasons: [] },
    content_id: b1Uuid(34), content_hash: normalized.contentHash, payload, normalized_value: normalized.value,
    normalizer_version: 'sleeper-administration-v1', completeness: 'complete', league_season_id: b1Mapping.leagueSeasonId,
    provider: 'sleeper', external_league_id: b1Mapping.scope.externalLeagueId, identities: exact.teams };
}

export function b1PlayerCatalog(): FantasyPlayerCatalog {
  const projected = projectPlayerCatalog({
    '1001': { player_id: '1001', full_name: 'Quarterback One', position: 'QB', fantasy_positions: ['QB'], team: 'IND', injury_status: 'Out' },
    '1002': { player_id: '1002', full_name: 'Quarterback Two', position: 'QB', fantasy_positions: ['QB'], team: 'HOU', injury_status: null },
    '1003': { player_id: '1003', full_name: 'Reserve Player', position: 'RB', team: 'IND', injury_status: 'IR' },
    '1004': { player_id: '1004', full_name: 'Taxi Player', position: 'WR', team: 'IND', injury_status: null },
    '1005': { player_id: '1005', full_name: 'Bench Player', position: 'TE', team: 'IND', injury_status: null },
  });
  return { catalog: projected.catalog, sourceRevision: projected.sourceRevision, complete: true,
    sourceSlices: [{ scope: 'all', status: 'available', sourceRevision: projected.sourceRevision,
      observedAt: '2026-09-29T11:59:00.000Z', complete: true, playerIds: Object.keys(projected.catalog) }] };
}
export function b1LineupApplicabilityFixture(row: ReturnType<typeof b1CompatibilityFixture>) {
  const accepted = row.accepted_rows[0];
  const normalized = normalizeAdministrationObservation({ ...b1CaptureEnvelope(row), family: 'league', week: null,
    payload: accepted.configuration_payload });
  if (normalized.status !== 'accepted' || normalized.value?.family !== 'league') throw new Error('Invalid B1 configuration.');
  const component = normalized.value.components.find(component => component.name === 'roster')!;
  return [{ activation: { id: b1Uuid(40), league_season_id: b1Mapping.leagueSeasonId,
    configuration_version_id: b1Uuid(15), component: 'roster', component_hash: component.hash,
    applicability: 'evidenced_period', season_type: 'regular', from_week: 4, through_week: 4,
    evidence: 'Synthetic exact-period owner-confirmed roster definition', generation: 2,
    recorded_at: '2026-09-29T11:58:00.000123Z' },
  version: { id: b1Uuid(15), league_season_id: b1Mapping.leagueSeasonId, components: normalized.value.components,
    normalizer_version: 'sleeper-administration-v1', dialect: 'sleeper-nfl-v1', semantic_hash: normalized.semanticHash },
  source: { configurationContentId: accepted.configuration_content_id, provider: 'sleeper',
    externalLeagueId: b1Mapping.scope.externalLeagueId, leagueSeasonId: b1Mapping.leagueSeasonId,
    configurationVersionId: b1Uuid(15), normalizedValue: normalized.value, sourceMapping: b1Mapping } }];
}
