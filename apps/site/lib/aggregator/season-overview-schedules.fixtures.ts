/** Synthetic B2 same-capture inputs; runtime modules never import this file. */
import type { DatabaseClient } from '../database';
import type { JsonObject, JsonValue } from '../league-administration/contracts';
import { normalizeAdministrationObservation } from '../league-administration/normalize';
import { createExactMatchupCompatibilityReader } from '../league-administration/store';
import { createSleeperCalendarEvidence } from '../league-administration/period-mapping';
import schedule from '../../test-support/fixtures/sleeper-2026-season-schedule.json';
import { b1CompatibilityFixture, b1CompatibilityInput, b1Mapping, b1Uuid } from './b1-acceptance.fixtures';
import { projectExactMatchups, exactMatchupsScope } from './exact-matchups';
import { projectSeasonOverviewSource } from './season-overview-source';
import { CURRENT_ROSTER_POLICY, currentRosterScope } from './current-roster';
import { LEAGUE_SETTINGS_POLICY, leagueSettingsScope, type AcceptedLeagueSettingsRead } from './league-settings';
import type { SeasonOverviewProjectionInput } from './season-overview-projections';

export async function seasonOverviewFixture(): Promise<SeasonOverviewProjectionInput> {
  const row = b1CompatibilityFixture();
  const configuration: JsonObject = { ...row.accepted_rows[0].configuration_payload as JsonObject,
    settings: { leg: 4, start_week: 1, league_average_match: 0, best_ball: 0, playoff_week_start: 15 } };
  row.accepted_rows[0].configuration_payload = configuration;
  const provenance = row.accepted_rows[0].provenance;
  const normalized = normalizeAdministrationObservation({ schemaVersion: 'league-administration-v1',
    normalizerVersion: 'sleeper-administration-v1', dialect: 'sleeper-nfl-v1', scope: b1Mapping.scope,
    family: 'league', week: null, completeness: 'complete', provenance, payload: configuration });
  row.accepted_rows[0].configuration_hash = normalized.contentHash;
  row.accepted_rows[0].population_evidence.contentHash = normalized.contentHash;
  row.contents[0].content_hash = normalized.contentHash;
  row.contents[0].payload = normalized.envelope.payload;
  const compatibility = await createExactMatchupCompatibilityReader({ enabled: true, query: async () => [row] } as DatabaseClient)
    .readExactMatchupCompatibility(b1CompatibilityInput);
  if (compatibility.official.status !== 'available' || compatibility.forecast.status !== 'available'
    || compatibility.gameState.status !== 'available') throw new Error(`B2 fixture needs qualified B1 references: ${JSON.stringify({
      official: compatibility.official.status === 'available' ? 'available' : compatibility.official,
      forecast: compatibility.forecast.status === 'available' ? 'available' : compatibility.forecast,
      gameState: compatibility.gameState.status === 'available' ? 'available' : compatibility.gameState })}`);
  const official = compatibility.official;
  const teams = row.snapshot_rows[0].payload.teams.map((team, index) => ({ seasonTeamId: b1Uuid(19 + index),
    externalRosterId: String(team.id), team: { ...team, name: `Current ${team.name}`, ties: 3 },
    currentRecord: { wins: 0, losses: 0, ties: 3 }, leagueOneRank: index + 1 }));
  const rosterPayload = teams.map(team => ({ roster_id: team.team.id, players: [], settings: {
    wins: 0, losses: 0, ties: 3, fpts: 0, fpts_against: 0 } }));
  const roster = normalizeAdministrationObservation({ ...normalized.envelope, family: 'rosters', payload: rosterPayload });
  const source = projectSeasonOverviewSource({ normalized: roster, mapping: b1Mapping, seasonTeams: teams,
    accepted: { ...official.accepted, scope: currentRosterScope(b1Mapping), contentId: b1Uuid(200), observationIds: [b1Uuid(201)],
      canonicalNormalizerVersion: CURRENT_ROSTER_POLICY.canonicalNormalizerVersion, verifiedAt: provenance.sourceObservedAt },
    receipt: { id: b1Uuid(201), attemptId: b1Uuid(202), ordinal: 1, provenance, expectedTeamCount: 2,
      configurationContentId: official.receipt.configurationContentId, legacyObservationId: b1Uuid(203) } });
  const settings: AcceptedLeagueSettingsRead = { status: 'available', leagueId: b1Uuid(210), leagueSeasonId: b1Mapping.leagueSeasonId,
    accepted: { ...official.accepted, scope: leagueSettingsScope(b1Mapping), contentId: official.receipt.configurationContentId,
      canonicalNormalizerVersion: LEAGUE_SETTINGS_POLICY.canonicalNormalizerVersion },
    receipt: { id: b1Uuid(211), attemptId: b1Uuid(212), ordinal: 1, provenance, legacyObservationId: b1Uuid(213),
      sourceUpdatedAt: null, rawContentHash: normalized.contentHash, configurationVersionId: b1Uuid(15), configurationSemanticHash: normalized.semanticHash },
    value: normalized.leagueSettings!.value!, comparison: { status: 'equal', legacyConfiguration: 'equal', fields: [] } };
  const captures = [1, 2, 3].map(week => {
    const capture = normalizeAdministrationObservation({ ...normalized.envelope, family: 'matchups', week,
      payload: teams.map(team => ({ roster_id: team.team.id, matchup_id: 1, points: 0 })) });
    return { ...official, accepted: { ...official.accepted, scope: exactMatchupsScope(b1Mapping, week), contentId: b1Uuid(220 + week) },
      value: projectExactMatchups(capture, teams) };
  });
  const evidence = createSleeperCalendarEvidence({ season: '2026',
    seasonSchedule: schedule.body.map(game => ({ ...game, status: game.week < 4 ? 'complete' : game.status })),
    evaluatedAt: '2026-09-29T17:00:00.000Z', retrievalStartedAt: '2026-09-29T17:00:00.000Z', retrievalCompletedAt: '2026-09-29T17:00:01.000Z' });
  if (!evidence) throw new Error('B2 fixture needs the retained calendar.');
  return { mapping: b1Mapping, source, teams, league: row.snapshot_rows[0].payload.league, updatedAt: provenance.checkedAt,
    settings, captures, compatibility, context: b1CompatibilityInput.context,
    calendar: { leagueSeasonId: b1Mapping.leagueSeasonId, sourceMappingRevisionId: b1Mapping.revisionId,
      evidenceRef: b1Uuid(230), evidence } };
}

export function seasonOverviewCapture(input: SeasonOverviewProjectionInput, week: number, payload: JsonValue) {
  const current = input.compatibility!.official;
  if (current.status !== 'available') throw new Error('Expected accepted fixture.');
  const normalized = normalizeAdministrationObservation({ schemaVersion: 'league-administration-v1',
    normalizerVersion: 'sleeper-administration-v1', dialect: 'sleeper-nfl-v1', scope: input.mapping.scope,
    family: 'matchups', week, completeness: 'complete', provenance: current.receipt.provenance, payload });
  return { ...current, accepted: { ...current.accepted, scope: exactMatchupsScope(input.mapping, week), contentId: b1Uuid(240 + week) },
    value: projectExactMatchups(normalized, input.teams) };
}
