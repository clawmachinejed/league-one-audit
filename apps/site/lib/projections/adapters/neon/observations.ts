import 'server-only';

import type { DatabaseClient } from '../../../database';
import type { ProjectionStore } from './contracts';
import { json, normalizeIds, provider, requiredText, rowNumber, rowText } from './database-values';
import { containsScheduledGame } from './snapshot-codec';
import { observationLineupValues } from './lineup-publication-values';

type ObservationMethods = Pick<ProjectionStore,
  | 'recordGameStates'
  | 'recordLeagueWeekObservation'
>;

export function createObservationMethods(client: DatabaseClient): ObservationMethods {
  return {
    async recordGameStates(input) {
      if (input.states.length === 0) return { kind: 'stored', value: [] };
      const normalizedProvider = provider(input.provider);
      const externalGameIds = input.states.map((state) =>
        requiredText(state.externalGameId, 'External game ID'));
      if (new Set(externalGameIds).size !== externalGameIds.length) {
        throw new Error('A game-state batch must contain each external game ID once.');
      }
      const states = input.states.map((state) => ({
        external_game_id: requiredText(state.externalGameId, 'External game ID'),
        source_revision: requiredText(state.sourceRevision, 'Game-state source revision'),
        request_started_at: state.requestStartedAt,
        request_completed_at: state.requestCompletedAt,
        observed_at: state.observedAt,
        status_code: state.statusCode,
        period: state.period,
        game_clock: state.gameClock,
        home_score: state.homeScore,
        away_score: state.awayScore,
        source_data: state.sourceData,
      }));
      const rows = await client.query(`/* projection-store:record-game-states */
        WITH input AS (
          SELECT * FROM jsonb_to_recordset($2::jsonb) AS value(
            external_game_id text, source_revision text,
            request_started_at timestamptz, request_completed_at timestamptz,
            observed_at timestamptz, status_code smallint, period text, game_clock text,
            home_score numeric, away_score numeric, source_data jsonb
          )
        ), mapped AS (
          SELECT input.*, mapping.nfl_game_id
          FROM input JOIN external_game_ids mapping
            ON mapping.provider = $1 AND mapping.external_game_id = input.external_game_id
        ), inserted AS (
          INSERT INTO game_state_observations (
            nfl_game_id, provider, source_revision, request_started_at,
            request_completed_at, observed_at, status_code, period, game_clock,
            home_score, away_score, source_data
          )
          SELECT nfl_game_id, $1, source_revision, request_started_at,
            request_completed_at, observed_at, status_code, period, game_clock,
            home_score, away_score, source_data
          FROM mapped
          ORDER BY nfl_game_id
          ON CONFLICT (provider, nfl_game_id, source_revision) DO UPDATE
          SET source_revision = game_state_observations.source_revision
          WHERE game_state_observations.request_started_at = EXCLUDED.request_started_at
            AND game_state_observations.request_completed_at = EXCLUDED.request_completed_at
            AND game_state_observations.observed_at = EXCLUDED.observed_at
            AND game_state_observations.status_code = EXCLUDED.status_code
            AND game_state_observations.period IS NOT DISTINCT FROM EXCLUDED.period
            AND game_state_observations.game_clock IS NOT DISTINCT FROM EXCLUDED.game_clock
            AND game_state_observations.home_score IS NOT DISTINCT FROM EXCLUDED.home_score
            AND game_state_observations.away_score IS NOT DISTINCT FROM EXCLUDED.away_score
            AND game_state_observations.source_data = EXCLUDED.source_data
          RETURNING id, nfl_game_id, source_revision
        ), resolved AS (
          SELECT id, nfl_game_id, source_revision FROM inserted
        )
        SELECT mapped.external_game_id, resolved.source_revision,
          resolved.id AS observation_id
        FROM resolved
        JOIN mapped ON mapped.nfl_game_id = resolved.nfl_game_id
          AND mapped.source_revision = resolved.source_revision
        ORDER BY mapped.external_game_id`, [normalizedProvider, json(states)]);
      return {
        kind: 'stored',
        value: rows.map((row) => ({
          externalGameId: rowText(row, 'external_game_id'),
          sourceRevision: rowText(row, 'source_revision'),
          observationId: rowText(row, 'observation_id'),
        })),
      };
    },

    async recordLeagueWeekObservation(input) {
      const [lineupVersion, lineupRevision] = observationLineupValues(input.lineupRevisionVersion, input.lineupRevision);
      const expectedGameIds = normalizeIds(input.expectedTank01GameIds);
      if (containsScheduledGame(input.sourceData) && expectedGameIds.length === 0) {
        throw new Error('Scheduled games require expected Tank01 game identifiers.');
      }
      const playerPoints = input.playerPoints.map((point) => ({
        sleeper_player_id: requiredText(point.sleeperPlayerId, 'Sleeper player ID'),
        entity_kind: point.entityKind,
        external_roster_id: requiredText(point.externalRosterId, 'External roster ID'),
        points: point.points,
        is_starter: point.isStarter,
        lineup_slot: point.lineupSlot,
      }));
      const rosterPoints = input.rosterPoints.map((point) => ({
        external_roster_id: requiredText(point.externalRosterId, 'External roster ID'),
        points: point.points,
      }));
      const rows = await client.query(`/* projection-store:record-league-week-observation */
        WITH inserted_observation AS (
          INSERT INTO league_week_observations (
            league_season_id, provider, week, source_revision, request_started_at,
            request_completed_at, observed_at, quality, expected_game_count, source_data,
            lineup_revision_version, lineup_revision
          ) VALUES ($1, 'sleeper', $2, $3, $4, $5, $6, $7, $11, $8::jsonb, $13, $14)
          ON CONFLICT (league_season_id, provider, source_revision) DO NOTHING
          RETURNING id
        ), observation AS (
          SELECT id FROM inserted_observation
          UNION ALL
          SELECT id FROM league_week_observations
          WHERE league_season_id = $1 AND provider = 'sleeper' AND source_revision = $3
            AND week = $2 AND observed_at = $6::timestamptz AND quality = $7
            AND request_started_at = $4::timestamptz AND request_completed_at = $5::timestamptz
            AND expected_game_count = $11 AND source_data = $8::jsonb
            AND lineup_revision_version IS NOT DISTINCT FROM $13::text
            AND lineup_revision IS NOT DISTINCT FROM $14::text
          LIMIT 1
        ), expected_input AS (
          SELECT unnest($12::text[]) AS external_game_id
        ), mapped_expected AS (
          SELECT expected_input.external_game_id, mapping.nfl_game_id
          FROM expected_input
          JOIN external_game_ids mapping
            ON mapping.provider = 'tank01'
            AND mapping.external_game_id = expected_input.external_game_id
          JOIN nfl_games game ON game.id = mapping.nfl_game_id
          JOIN league_seasons season
            ON season.id = $1 AND season.season = game.season
          WHERE game.week = $2 AND game.season_type = 'reg'
        ), inserted_expected AS (
          INSERT INTO league_week_expected_games (league_week_observation_id, nfl_game_id)
          SELECT inserted_observation.id, mapped_expected.nfl_game_id
          FROM inserted_observation CROSS JOIN mapped_expected
          ON CONFLICT DO NOTHING
          RETURNING nfl_game_id
        ), player_input AS (
          SELECT * FROM jsonb_to_recordset($9::jsonb) AS value(
            sleeper_player_id text, entity_kind text, external_roster_id text,
            points numeric, is_starter boolean, lineup_slot text
          )
        ), mapped_players AS (
          SELECT player_input.*, mapping.scoring_entity_id
          FROM player_input
          JOIN external_scoring_entity_ids mapping
            ON mapping.provider = 'sleeper'
            AND mapping.entity_kind = player_input.entity_kind
            AND mapping.external_id = player_input.sleeper_player_id
        ), inserted_players AS (
          INSERT INTO official_player_point_observations (
            league_week_observation_id, external_roster_id, scoring_entity_id,
            points, is_starter, lineup_slot
          )
          SELECT observation.id, external_roster_id, scoring_entity_id,
            points, is_starter, lineup_slot
          FROM mapped_players CROSS JOIN observation
          ON CONFLICT DO NOTHING
          RETURNING scoring_entity_id
        ), roster_input AS (
          SELECT * FROM jsonb_to_recordset($10::jsonb) AS value(
            external_roster_id text, points numeric
          )
        ), inserted_rosters AS (
          INSERT INTO official_roster_point_observations (
            league_week_observation_id, external_roster_id, points
          )
          SELECT observation.id, external_roster_id, points
          FROM roster_input CROSS JOIN observation
          ON CONFLICT DO NOTHING
          RETURNING external_roster_id
        )
        SELECT observation.id AS observation_id,
          ((SELECT count(*) FROM official_player_point_observations points
            WHERE points.league_week_observation_id = observation.id)::integer
            + (SELECT count(*) FROM inserted_players)::integer)
            AS player_points_stored,
          ((SELECT count(*) FROM official_roster_point_observations points
            WHERE points.league_week_observation_id = observation.id)::integer
            + (SELECT count(*) FROM inserted_rosters)::integer)
            AS roster_points_stored,
          COALESCE((SELECT jsonb_agg(player_input.sleeper_player_id ORDER BY player_input.sleeper_player_id)
            FROM player_input
            WHERE NOT EXISTS (
              SELECT 1 FROM mapped_players
              WHERE mapped_players.sleeper_player_id = player_input.sleeper_player_id
                AND mapped_players.entity_kind = player_input.entity_kind
            )), '[]'::jsonb) AS unmapped_ids,
          ((SELECT count(*) FROM league_week_expected_games expected
            WHERE expected.league_week_observation_id = observation.id)::integer
            + (SELECT count(*) FROM inserted_expected)::integer)
            AS expected_games_stored,
          COALESCE((SELECT jsonb_agg(expected_input.external_game_id ORDER BY expected_input.external_game_id)
            FROM expected_input
            WHERE NOT EXISTS (
              SELECT 1 FROM mapped_expected
              WHERE mapped_expected.external_game_id = expected_input.external_game_id
            )), '[]'::jsonb) AS unmapped_game_ids,
          (SELECT count(*) FROM inserted_players) AS inserted_player_count,
          (SELECT count(*) FROM inserted_rosters) AS inserted_roster_count
        FROM observation`, [
        input.leagueSeasonId, input.week,
        requiredText(input.sourceRevision, 'Sleeper source revision'),
        input.requestStartedAt, input.requestCompletedAt, input.observedAt,
        input.quality, json(input.sourceData), json(playerPoints), json(rosterPoints),
        expectedGameIds.length, expectedGameIds, lineupVersion, lineupRevision,
      ]);
      const row = rows[0];
      if (!row) throw new Error('League-week observation did not return a row.');
      const rawUnmapped = row.unmapped_ids;
      const unmapped = Array.isArray(rawUnmapped)
        ? rawUnmapped.filter((value): value is string => typeof value === 'string')
        : [];
      const rawUnmappedGames = row.unmapped_game_ids;
      const unmappedGames = Array.isArray(rawUnmappedGames)
        ? rawUnmappedGames.filter((value): value is string => typeof value === 'string')
        : [];
      return {
        kind: 'stored',
        value: {
          observationId: rowText(row, 'observation_id'),
          playerPointsStored: rowNumber(row, 'player_points_stored'),
          rosterPointsStored: rowNumber(row, 'roster_points_stored'),
          unmappedSleeperPlayerIds: unmapped,
          expectedGamesStored: rowNumber(row, 'expected_games_stored'),
          unmappedTank01GameIds: unmappedGames,
        },
      };
    },

  };
}
