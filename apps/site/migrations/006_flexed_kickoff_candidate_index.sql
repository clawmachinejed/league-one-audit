-- Kickoff corrections rebuild the latest eligible pregame candidate for each
-- affected NFL game. Keep that repair targeted as immutable history grows.
CREATE INDEX IF NOT EXISTS pregame_projection_candidates_game_run_idx
  ON pregame_projection_candidates (nfl_game_id, projection_run_id);
