import 'server-only';

import type { DatabaseClient } from '../../../database';
import type { ProjectionStore } from './contracts';
import {
  json,
  normalizeIds,
  provider,
  requiredText,
  rowNumber,
  rowText,
} from './database-values';
import { asPlayerProjection } from './row-codec';

type ProjectionMethods = Pick<ProjectionStore,
  | 'recordProjectionCandidates'
  | 'readLatestCandidatesBySleeperIds'
  | 'freezeLatestBaselines'
  | 'readFrozenBaselinesBySleeperIds'
>;

export function createProjectionMethods(client: DatabaseClient): ProjectionMethods {
  return {
    async recordProjectionCandidates(input) {
      const candidates = input.candidates.map((candidate) => ({
        game_id: candidate.gameId,
        entity_id: candidate.entityId,
        scoring_profile_id: candidate.scoringProfileId,
        projection_points: candidate.projectionPoints,
        projected_stats: candidate.projectedStats,
        quality: candidate.quality,
      }));
      const rows = await client.query(`/* projection-store:record-projection-candidates */
        WITH run AS (
          INSERT INTO pregame_projection_runs (
            provider, season, season_type, week, model_version, source_revision,
            request_started_at, request_completed_at, fetched_at, quality,
            projection_slate_observation_id
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
          ON CONFLICT (provider, season, season_type, week, source_revision, model_version)
          DO UPDATE SET projection_slate_observation_id = COALESCE(
            pregame_projection_runs.projection_slate_observation_id,
            EXCLUDED.projection_slate_observation_id
          )
          WHERE pregame_projection_runs.projection_slate_observation_id IS NULL
            OR EXCLUDED.projection_slate_observation_id IS NULL
            OR pregame_projection_runs.projection_slate_observation_id
              = EXCLUDED.projection_slate_observation_id
          RETURNING id, provider, model_version, fetched_at, created_at, quality
        ), input AS (
          SELECT * FROM jsonb_to_recordset($12::jsonb) AS value(
            game_id uuid, entity_id uuid, scoring_profile_id uuid,
            projection_points numeric, projected_stats jsonb, quality text
          )
        ), inserted_candidates AS (
          INSERT INTO pregame_projection_candidates (
            projection_run_id, nfl_game_id, scoring_entity_id, scoring_profile_id,
            projection_points, projected_stats, quality
          )
          SELECT run.id, input.game_id, input.entity_id, input.scoring_profile_id,
            input.projection_points, input.projected_stats, input.quality
          FROM input CROSS JOIN run
          ON CONFLICT DO NOTHING
          RETURNING *
        ), candidate_rows AS (
          SELECT * FROM inserted_candidates
          UNION ALL
          SELECT candidate.*
          FROM input
          CROSS JOIN run
          JOIN pregame_projection_candidates candidate
            ON candidate.projection_run_id = run.id
            AND candidate.nfl_game_id = input.game_id
            AND candidate.scoring_entity_id = input.entity_id
            AND candidate.scoring_profile_id = input.scoring_profile_id
        ), current_candidates AS (
          INSERT INTO current_pregame_projection_candidates (
            nfl_game_id, scoring_entity_id, scoring_profile_id,
            projection_provider, model_version, projection_run_id,
            source_fetched_at, source_run_created_at
          )
          SELECT candidate.nfl_game_id, candidate.scoring_entity_id,
            candidate.scoring_profile_id, run.provider, run.model_version, run.id,
            run.fetched_at, run.created_at
          FROM candidate_rows candidate
          CROSS JOIN run
          JOIN nfl_games game ON game.id = candidate.nfl_game_id
          WHERE run.quality = 'complete' AND candidate.quality <> 'invalid'
            AND game.kickoff_at IS NOT NULL AND run.fetched_at <= game.kickoff_at
          ON CONFLICT (
            nfl_game_id, scoring_entity_id, scoring_profile_id,
            projection_provider, model_version
          ) DO UPDATE SET
            projection_run_id = EXCLUDED.projection_run_id,
            source_fetched_at = EXCLUDED.source_fetched_at,
            source_run_created_at = EXCLUDED.source_run_created_at,
            updated_at = now()
          WHERE (
            EXCLUDED.source_fetched_at,
            EXCLUDED.source_run_created_at,
            EXCLUDED.projection_run_id
          ) > (
            current_pregame_projection_candidates.source_fetched_at,
            current_pregame_projection_candidates.source_run_created_at,
            current_pregame_projection_candidates.projection_run_id
          )
          RETURNING projection_run_id
        )
        SELECT run.id AS run_id,
          (SELECT count(*) FROM inserted_candidates)::integer AS candidates_stored,
          (SELECT count(*) FROM input)::integer AS candidate_count
        FROM run`, [
        provider(input.provider), input.season, input.seasonType, input.week,
        requiredText(input.modelVersion, 'Projection model version'),
        requiredText(input.sourceRevision, 'Projection source revision'),
        input.requestStartedAt, input.requestCompletedAt, input.fetchedAt, input.quality,
        input.projectionSlateObservationId ?? null,
        json(candidates),
      ]);
      const row = rows[0];
      if (!row) throw new Error('Projection run did not return a row.');
      return {
        kind: 'stored',
        value: {
          runId: rowText(row, 'run_id'),
          candidatesStored: rowNumber(row, 'candidates_stored'),
          candidateCount: rowNumber(row, 'candidate_count'),
        },
      };
    },

    async readLatestCandidatesBySleeperIds(input) {
      const sleeperIds = normalizeIds(input.sleeperPlayerIds);
      if (sleeperIds.length === 0) return [];
      const rows = await client.query(`/* projection-store:read-latest-candidates */
        SELECT DISTINCT ON (sleeper.external_id)
          sleeper.external_id AS sleeper_player_id,
          entity.id AS entity_id,
          entity.kind AS entity_kind,
          entity.display_name,
          entity.nfl_team,
          game.id AS game_id,
          tank_game.external_game_id AS tank01_game_id,
          candidate.projection_points,
          candidate.projected_stats,
          candidate.quality,
          run.id AS source_projection_run_id,
          run.provider AS projection_provider,
          run.model_version,
          run.fetched_at::text,
          NULL::text AS frozen_at
        FROM external_scoring_entity_ids sleeper
        JOIN scoring_entities entity ON entity.id = sleeper.scoring_entity_id
        JOIN pregame_projection_candidates candidate ON candidate.scoring_entity_id = entity.id
        JOIN pregame_projection_runs run ON run.id = candidate.projection_run_id
        JOIN nfl_games game ON game.id = candidate.nfl_game_id
        JOIN league_seasons season
          ON season.id = $1 AND season.scoring_profile_id = candidate.scoring_profile_id
        LEFT JOIN LATERAL (
          SELECT mapping.external_game_id
          FROM external_game_ids mapping
          WHERE mapping.nfl_game_id = game.id AND mapping.provider = 'tank01'
          ORDER BY mapping.mapped_at DESC, mapping.external_game_id DESC
          LIMIT 1
        ) tank_game ON true
        WHERE sleeper.provider = 'sleeper'
          AND sleeper.external_id = ANY($2::text[])
          AND run.season = $3 AND run.season_type = $4 AND run.week = $5
          AND run.model_version = $6 AND run.quality = 'complete'
          AND run.provider = $7
          AND candidate.quality <> 'invalid'
        ORDER BY sleeper.external_id, run.fetched_at DESC, run.created_at DESC`, [
        input.leagueSeasonId, sleeperIds, input.season, input.seasonType,
        input.week, input.modelVersion, provider(input.provider),
      ]);
      return rows.map(asPlayerProjection);
    },

    async freezeLatestBaselines(input) {
      const gameIds = normalizeIds(input.externalGameIds);
      if (gameIds.length === 0) return { kind: 'stored', value: [] };
      const rows = await client.query(`/* projection-store:freeze-latest-baselines */
        WITH requested_games AS (
          SELECT DISTINCT mapping.nfl_game_id
          FROM external_game_ids mapping
          WHERE mapping.provider = $1 AND mapping.external_game_id = ANY($2::text[])
        ), latest AS (
          SELECT DISTINCT ON (candidate.nfl_game_id, candidate.scoring_entity_id)
            candidate.nfl_game_id, candidate.scoring_entity_id,
            candidate.scoring_profile_id, candidate.projection_points,
            candidate.projected_stats, candidate.quality,
            run.id AS source_projection_run_id, run.provider AS projection_provider,
            run.model_version, run.fetched_at
          FROM pregame_projection_candidates candidate
          JOIN pregame_projection_runs run ON run.id = candidate.projection_run_id
          JOIN requested_games ON requested_games.nfl_game_id = candidate.nfl_game_id
          JOIN nfl_games game ON game.id = candidate.nfl_game_id
          JOIN league_seasons league_season
            ON league_season.id = $3
            AND league_season.scoring_profile_id = candidate.scoring_profile_id
          WHERE run.season = $4 AND run.season_type = $5 AND run.week = $6
            AND run.model_version = $7 AND run.quality = 'complete'
            AND run.provider = $8
            AND game.kickoff_at IS NOT NULL
            AND run.fetched_at <= game.kickoff_at
            AND candidate.quality <> 'invalid'
          ORDER BY candidate.nfl_game_id, candidate.scoring_entity_id,
            run.fetched_at DESC, run.created_at DESC
        ), inserted AS (
          INSERT INTO pregame_projection_baselines (
            nfl_game_id, scoring_entity_id, scoring_profile_id,
            projection_provider, model_version,
            source_projection_run_id, projection_points, projected_stats, quality, frozen_at
          )
          SELECT nfl_game_id, scoring_entity_id, scoring_profile_id,
            projection_provider, model_version,
            source_projection_run_id, projection_points, projected_stats, quality, $9
          FROM latest
          ON CONFLICT DO NOTHING
          RETURNING *
        ), selected AS (
          SELECT baseline.*
          FROM pregame_projection_baselines baseline
          JOIN requested_games ON requested_games.nfl_game_id = baseline.nfl_game_id
          JOIN league_seasons league_season
            ON league_season.id = $3
            AND league_season.scoring_profile_id = baseline.scoring_profile_id
          WHERE baseline.model_version = $7 AND baseline.projection_provider = $8
          UNION ALL
          SELECT inserted.* FROM inserted
          WHERE NOT EXISTS (
            SELECT 1 FROM pregame_projection_baselines baseline
            WHERE baseline.nfl_game_id = inserted.nfl_game_id
              AND baseline.scoring_entity_id = inserted.scoring_entity_id
              AND baseline.scoring_profile_id = inserted.scoring_profile_id
              AND baseline.projection_provider = inserted.projection_provider
              AND baseline.model_version = inserted.model_version
          )
        )
        SELECT sleeper.external_id AS sleeper_player_id,
          entity.id AS entity_id, entity.kind AS entity_kind,
          entity.display_name, entity.nfl_team,
          game.id AS game_id, tank_game.external_game_id AS tank01_game_id,
          selected.projection_points, selected.projected_stats, selected.quality,
          selected.source_projection_run_id,
          selected.projection_provider,
          selected.model_version,
          run.fetched_at::text,
          selected.frozen_at::text
        FROM selected
        JOIN scoring_entities entity ON entity.id = selected.scoring_entity_id
        JOIN nfl_games game ON game.id = selected.nfl_game_id
        JOIN pregame_projection_runs run ON run.id = selected.source_projection_run_id
        JOIN external_scoring_entity_ids sleeper
          ON sleeper.scoring_entity_id = entity.id AND sleeper.provider = 'sleeper'
        LEFT JOIN LATERAL (
          SELECT mapping.external_game_id
          FROM external_game_ids mapping
          WHERE mapping.nfl_game_id = game.id AND mapping.provider = 'tank01'
          ORDER BY mapping.mapped_at DESC, mapping.external_game_id DESC
          LIMIT 1
        ) tank_game ON true
        ORDER BY sleeper.external_id`, [
        provider(input.gameProvider), gameIds, input.leagueSeasonId, input.season,
        input.seasonType, input.week, input.modelVersion,
        provider(input.projectionProvider), input.frozenAt,
      ]);
      return { kind: 'stored', value: rows.map(asPlayerProjection) };
    },

    async readFrozenBaselinesBySleeperIds(input) {
      const sleeperIds = normalizeIds(input.sleeperPlayerIds);
      if (sleeperIds.length === 0) return [];
      const rows = await client.query(`/* projection-store:read-frozen-baselines */
        SELECT sleeper.external_id AS sleeper_player_id,
          entity.id AS entity_id, entity.kind AS entity_kind,
          entity.display_name, entity.nfl_team,
          game.id AS game_id, tank_game.external_game_id AS tank01_game_id,
          baseline.projection_points, baseline.projected_stats, baseline.quality,
          baseline.source_projection_run_id,
          baseline.projection_provider,
          baseline.model_version,
          run.fetched_at::text,
          baseline.frozen_at::text
        FROM external_scoring_entity_ids sleeper
        JOIN scoring_entities entity ON entity.id = sleeper.scoring_entity_id
        JOIN pregame_projection_baselines baseline ON baseline.scoring_entity_id = entity.id
        JOIN pregame_projection_runs run ON run.id = baseline.source_projection_run_id
        JOIN nfl_games game ON game.id = baseline.nfl_game_id
        JOIN league_seasons league_season
          ON league_season.id = $1
          AND league_season.scoring_profile_id = baseline.scoring_profile_id
        LEFT JOIN LATERAL (
          SELECT mapping.external_game_id
          FROM external_game_ids mapping
          WHERE mapping.nfl_game_id = game.id AND mapping.provider = 'tank01'
          ORDER BY mapping.mapped_at DESC, mapping.external_game_id DESC
          LIMIT 1
        ) tank_game ON true
        WHERE sleeper.provider = 'sleeper' AND sleeper.external_id = ANY($2::text[])
          AND game.season = $3 AND game.season_type = $4 AND game.week = $5
          AND baseline.model_version = $6 AND baseline.projection_provider = $7
        ORDER BY sleeper.external_id`, [
        input.leagueSeasonId, sleeperIds, input.season, input.seasonType,
        input.week, input.modelVersion, provider(input.provider),
      ]);
      return rows.map(asPlayerProjection);
    },

  };
}
