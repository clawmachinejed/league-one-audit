/* projection-store:record-projection-candidates */
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
        FROM run