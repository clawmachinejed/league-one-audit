-- Durable, provider-native weekly projection slates.
--
-- A slate's semantic content is immutable and shared by every league that uses
-- the same provider/period. Fetch observations preserve when that content was
-- seen, while a small mutable pointer identifies the newest complete slate.

CREATE TABLE IF NOT EXISTS projection_slate_contents (
  id uuid PRIMARY KEY,
  provider text NOT NULL,
  season smallint NOT NULL CHECK (season BETWEEN 1920 AND 2200),
  season_type text NOT NULL CHECK (season_type IN ('pre', 'reg', 'post')),
  week smallint NOT NULL CHECK (week BETWEEN 0 AND 30),
  normalizer_version text NOT NULL,
  semantic_hash text NOT NULL CHECK (semantic_hash ~ '^[0-9a-f]{64}$'),
  quality text NOT NULL CHECK (quality IN ('complete', 'partial', 'invalid')),
  coverage jsonb NOT NULL CHECK (jsonb_typeof(coverage) = 'object'),
  warnings jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(warnings) = 'array'),
  entry_count integer NOT NULL CHECK (entry_count >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider, season, season_type, week, normalizer_version, semantic_hash),
  UNIQUE (id, provider, season, season_type, week, normalizer_version)
);

CREATE TABLE IF NOT EXISTS projection_slate_entries (
  projection_slate_content_id uuid NOT NULL
    REFERENCES projection_slate_contents(id) ON DELETE CASCADE,
  entity_kind text NOT NULL CHECK (entity_kind IN ('player', 'team_defense')),
  provider_external_id text NOT NULL,
  aliases jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(aliases) = 'array'),
  nfl_team text,
  position text,
  stats jsonb NOT NULL CHECK (jsonb_typeof(stats) = 'object'),
  scoring_stats jsonb NOT NULL CHECK (jsonb_typeof(scoring_stats) = 'object'),
  missing_fields jsonb NOT NULL DEFAULT '[]'::jsonb
    CHECK (jsonb_typeof(missing_fields) = 'array'),
  ordinal integer NOT NULL CHECK (ordinal >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (projection_slate_content_id, entity_kind, provider_external_id),
  UNIQUE (projection_slate_content_id, ordinal)
);

CREATE TABLE IF NOT EXISTS projection_slate_observations (
  id uuid PRIMARY KEY,
  projection_slate_content_id uuid NOT NULL,
  provider text NOT NULL,
  season smallint NOT NULL CHECK (season BETWEEN 1920 AND 2200),
  season_type text NOT NULL CHECK (season_type IN ('pre', 'reg', 'post')),
  week smallint NOT NULL CHECK (week BETWEEN 0 AND 30),
  normalizer_version text NOT NULL,
  source_revision text NOT NULL,
  request_started_at timestamptz NOT NULL,
  request_completed_at timestamptz NOT NULL,
  observed_at timestamptz NOT NULL,
  quality text NOT NULL CHECK (quality IN ('complete', 'partial', 'invalid')),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (request_completed_at >= request_started_at),
  FOREIGN KEY (
    projection_slate_content_id, provider, season, season_type, week, normalizer_version
  ) REFERENCES projection_slate_contents(
    id, provider, season, season_type, week, normalizer_version
  ),
  UNIQUE (provider, season, season_type, week, normalizer_version, source_revision),
  UNIQUE (
    id, projection_slate_content_id, provider, season, season_type, week, normalizer_version
  )
);

CREATE INDEX IF NOT EXISTS projection_slate_observations_retention_idx
  ON projection_slate_observations (created_at);

CREATE TABLE IF NOT EXISTS current_projection_slates (
  provider text NOT NULL,
  season smallint NOT NULL CHECK (season BETWEEN 1920 AND 2200),
  season_type text NOT NULL CHECK (season_type IN ('pre', 'reg', 'post')),
  week smallint NOT NULL CHECK (week BETWEEN 0 AND 30),
  normalizer_version text NOT NULL,
  projection_slate_observation_id uuid NOT NULL,
  projection_slate_content_id uuid NOT NULL,
  observed_at timestamptz NOT NULL,
  verified_at timestamptz NOT NULL DEFAULT now(),
  material_changed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (provider, season, season_type, week, normalizer_version),
  FOREIGN KEY (
    projection_slate_observation_id, projection_slate_content_id,
    provider, season, season_type, week, normalizer_version
  ) REFERENCES projection_slate_observations(
    id, projection_slate_content_id, provider, season, season_type, week, normalizer_version
  )
);

CREATE OR REPLACE FUNCTION projection_slate_pointer_may_advance(
  current_observed_at timestamptz,
  current_content_id uuid,
  candidate_observed_at timestamptz,
  candidate_content_id uuid
)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
AS $$
BEGIN
  IF current_observed_at = candidate_observed_at
    AND current_content_id <> candidate_content_id THEN
    RAISE EXCEPTION
      'projection slate conflict: equal observation time has different semantic content';
  END IF;
  RETURN candidate_observed_at >= current_observed_at;
END;
$$;

CREATE OR REPLACE FUNCTION prevent_projection_slate_history_update()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'projection slate history is immutable';
END;
$$;

DROP TRIGGER IF EXISTS projection_slate_contents_immutable
  ON projection_slate_contents;
CREATE TRIGGER projection_slate_contents_immutable
  BEFORE UPDATE ON projection_slate_contents
  FOR EACH ROW EXECUTE FUNCTION prevent_projection_slate_history_update();

DROP TRIGGER IF EXISTS projection_slate_entries_immutable
  ON projection_slate_entries;
CREATE TRIGGER projection_slate_entries_immutable
  BEFORE UPDATE ON projection_slate_entries
  FOR EACH ROW EXECUTE FUNCTION prevent_projection_slate_history_update();

DROP TRIGGER IF EXISTS projection_slate_observations_immutable
  ON projection_slate_observations;
CREATE TRIGGER projection_slate_observations_immutable
  BEFORE UPDATE ON projection_slate_observations
  FOR EACH ROW EXECUTE FUNCTION prevent_projection_slate_history_update();

ALTER TABLE pregame_projection_runs
  ADD COLUMN IF NOT EXISTS projection_slate_observation_id uuid
    REFERENCES projection_slate_observations(id);

CREATE INDEX IF NOT EXISTS pregame_projection_runs_slate_observation_idx
  ON pregame_projection_runs (projection_slate_observation_id)
  WHERE projection_slate_observation_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS current_pregame_projection_candidates (
  nfl_game_id uuid NOT NULL,
  scoring_entity_id uuid NOT NULL,
  scoring_profile_id uuid NOT NULL,
  projection_provider text NOT NULL,
  model_version text NOT NULL,
  projection_run_id uuid NOT NULL,
  source_fetched_at timestamptz NOT NULL,
  source_run_created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (
    nfl_game_id, scoring_entity_id, scoring_profile_id,
    projection_provider, model_version
  ),
  FOREIGN KEY (
    projection_run_id, nfl_game_id, scoring_entity_id, scoring_profile_id
  ) REFERENCES pregame_projection_candidates(
    projection_run_id, nfl_game_id, scoring_entity_id, scoring_profile_id
  ),
  FOREIGN KEY (projection_run_id, projection_provider, model_version)
    REFERENCES pregame_projection_runs(id, provider, model_version)
);

CREATE INDEX IF NOT EXISTS current_pregame_candidates_run_idx
  ON current_pregame_projection_candidates (projection_run_id);

-- Backfill the pointer from existing immutable candidate history. Only complete,
-- kickoff-eligible runs can become the pregame value that will later freeze.
INSERT INTO current_pregame_projection_candidates (
  nfl_game_id, scoring_entity_id, scoring_profile_id,
  projection_provider, model_version, projection_run_id,
  source_fetched_at, source_run_created_at
)
SELECT DISTINCT ON (
    candidate.nfl_game_id, candidate.scoring_entity_id, candidate.scoring_profile_id,
    run.provider, run.model_version
  )
  candidate.nfl_game_id, candidate.scoring_entity_id, candidate.scoring_profile_id,
  run.provider, run.model_version, run.id,
  run.fetched_at, run.created_at
FROM pregame_projection_candidates candidate
JOIN pregame_projection_runs run ON run.id = candidate.projection_run_id
JOIN nfl_games game ON game.id = candidate.nfl_game_id
WHERE run.quality = 'complete'
  AND candidate.quality <> 'invalid'
  AND game.kickoff_at IS NOT NULL
  AND run.fetched_at <= game.kickoff_at
ORDER BY
  candidate.nfl_game_id, candidate.scoring_entity_id, candidate.scoring_profile_id,
  run.provider, run.model_version,
  run.fetched_at DESC, run.created_at DESC, run.id DESC
ON CONFLICT DO NOTHING;
