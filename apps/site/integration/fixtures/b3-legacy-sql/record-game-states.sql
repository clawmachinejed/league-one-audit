/* projection-store:record-game-states */
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
        ORDER BY mapped.external_game_id