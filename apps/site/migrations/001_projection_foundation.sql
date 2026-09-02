-- Projection persistence foundation.
--
-- The application registers provider identifiers at runtime. In particular, no
-- production Sleeper league identifier belongs in a migration.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS scoring_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rules_hash text NOT NULL UNIQUE,
  rules jsonb NOT NULL CHECK (jsonb_typeof(rules) = 'object'),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION prevent_scoring_profile_change()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'scoring profiles are immutable; create a new profile for revised rules';
END;
$$;

DROP TRIGGER IF EXISTS scoring_profiles_immutable
  ON scoring_profiles;
CREATE TRIGGER scoring_profiles_immutable
  BEFORE UPDATE OF rules_hash, rules ON scoring_profiles
  FOR EACH ROW
  WHEN (OLD.rules_hash IS DISTINCT FROM NEW.rules_hash OR OLD.rules IS DISTINCT FROM NEW.rules)
  EXECUTE FUNCTION prevent_scoring_profile_change();

CREATE TABLE IF NOT EXISTS leagues (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  league_key text NOT NULL UNIQUE,
  name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS league_seasons (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  league_id uuid NOT NULL REFERENCES leagues(id),
  season smallint NOT NULL CHECK (season BETWEEN 1920 AND 2200),
  scoring_profile_id uuid NOT NULL REFERENCES scoring_profiles(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (league_id, season)
);

CREATE TABLE IF NOT EXISTS league_source_connections (
  league_season_id uuid NOT NULL REFERENCES league_seasons(id) ON DELETE CASCADE,
  provider text NOT NULL,
  external_league_id text NOT NULL,
  connected_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (league_season_id, provider),
  UNIQUE (provider, external_league_id)
);

CREATE TABLE IF NOT EXISTS scoring_entities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind text NOT NULL CHECK (kind IN ('player', 'team_defense')),
  display_name text NOT NULL,
  nfl_team text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS external_scoring_entity_ids (
  provider text NOT NULL,
  entity_kind text NOT NULL CHECK (entity_kind IN ('player', 'team_defense')),
  external_id text NOT NULL,
  scoring_entity_id uuid NOT NULL REFERENCES scoring_entities(id),
  mapping_status text NOT NULL DEFAULT 'verified'
    CHECK (mapping_status IN ('verified', 'unverified', 'retired')),
  valid_from timestamptz NOT NULL DEFAULT now(),
  valid_to timestamptz,
  PRIMARY KEY (provider, entity_kind, external_id),
  CHECK (valid_to IS NULL OR valid_to > valid_from)
);

CREATE INDEX IF NOT EXISTS external_scoring_entity_ids_entity_idx
  ON external_scoring_entity_ids (scoring_entity_id, provider);

CREATE TABLE IF NOT EXISTS nfl_games (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  season smallint NOT NULL CHECK (season BETWEEN 1920 AND 2200),
  season_type text NOT NULL CHECK (season_type IN ('pre', 'reg', 'post')),
  week smallint NOT NULL CHECK (week BETWEEN 0 AND 30),
  home_team text NOT NULL,
  away_team text NOT NULL,
  kickoff_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (home_team <> away_team),
  UNIQUE (season, season_type, week, home_team, away_team)
);

CREATE TABLE IF NOT EXISTS external_game_ids (
  provider text NOT NULL,
  external_game_id text NOT NULL,
  nfl_game_id uuid NOT NULL REFERENCES nfl_games(id),
  mapping_status text NOT NULL DEFAULT 'verified'
    CHECK (mapping_status IN ('verified', 'unverified', 'retired')),
  mapped_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (provider, external_game_id)
);

-- Providers may correct an external game identifier after publication. Preserve
-- every alias on the same canonical NFL game instead of rewriting observation history.
ALTER TABLE external_game_ids
  DROP CONSTRAINT IF EXISTS external_game_ids_provider_nfl_game_id_key;

CREATE INDEX IF NOT EXISTS external_game_ids_game_idx
  ON external_game_ids (provider, nfl_game_id, mapped_at DESC);

CREATE TABLE IF NOT EXISTS pregame_projection_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider text NOT NULL,
  season smallint NOT NULL CHECK (season BETWEEN 1920 AND 2200),
  season_type text NOT NULL CHECK (season_type IN ('pre', 'reg', 'post')),
  week smallint NOT NULL CHECK (week BETWEEN 0 AND 30),
  model_version text NOT NULL,
  source_revision text NOT NULL,
  request_started_at timestamptz NOT NULL,
  request_completed_at timestamptz NOT NULL,
  fetched_at timestamptz NOT NULL,
  quality text NOT NULL DEFAULT 'complete'
    CHECK (quality IN ('complete', 'partial', 'invalid')),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (request_completed_at >= request_started_at),
  UNIQUE (id, provider, model_version),
  UNIQUE (provider, season, season_type, week, source_revision, model_version)
);

CREATE TABLE IF NOT EXISTS pregame_projection_candidates (
  projection_run_id uuid NOT NULL REFERENCES pregame_projection_runs(id) ON DELETE CASCADE,
  nfl_game_id uuid NOT NULL REFERENCES nfl_games(id),
  scoring_entity_id uuid NOT NULL REFERENCES scoring_entities(id),
  scoring_profile_id uuid NOT NULL REFERENCES scoring_profiles(id),
  projection_points numeric NOT NULL,
  projected_stats jsonb NOT NULL DEFAULT '{}'::jsonb
    CHECK (jsonb_typeof(projected_stats) = 'object'),
  quality text NOT NULL DEFAULT 'complete'
    CHECK (quality IN ('complete', 'missing', 'invalid')),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (projection_run_id, nfl_game_id, scoring_entity_id, scoring_profile_id)
);

CREATE INDEX IF NOT EXISTS pregame_projection_candidates_lookup_idx
  ON pregame_projection_candidates
  (scoring_profile_id, scoring_entity_id, nfl_game_id, projection_run_id);

CREATE INDEX IF NOT EXISTS pregame_projection_runs_retention_idx
  ON pregame_projection_runs (created_at);

CREATE TABLE IF NOT EXISTS pregame_projection_baselines (
  nfl_game_id uuid NOT NULL REFERENCES nfl_games(id),
  scoring_entity_id uuid NOT NULL REFERENCES scoring_entities(id),
  scoring_profile_id uuid NOT NULL REFERENCES scoring_profiles(id),
  projection_provider text NOT NULL,
  model_version text NOT NULL,
  source_projection_run_id uuid NOT NULL,
  projection_points numeric NOT NULL,
  projected_stats jsonb NOT NULL DEFAULT '{}'::jsonb
    CHECK (jsonb_typeof(projected_stats) = 'object'),
  quality text NOT NULL DEFAULT 'complete'
    CHECK (quality IN ('complete', 'missing', 'invalid')),
  frozen_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (
    nfl_game_id, scoring_entity_id, scoring_profile_id,
    projection_provider, model_version
  ),
  FOREIGN KEY (source_projection_run_id, projection_provider, model_version)
    REFERENCES pregame_projection_runs(id, provider, model_version)
);

CREATE INDEX IF NOT EXISTS pregame_projection_baselines_lookup_idx
  ON pregame_projection_baselines
  (scoring_entity_id, scoring_profile_id, projection_provider, model_version, nfl_game_id);

CREATE OR REPLACE FUNCTION prevent_projection_baseline_update()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'pregame projection baselines are immutable';
END;
$$;

DROP TRIGGER IF EXISTS pregame_projection_baselines_immutable
  ON pregame_projection_baselines;
CREATE TRIGGER pregame_projection_baselines_immutable
  BEFORE UPDATE ON pregame_projection_baselines
  FOR EACH ROW EXECUTE FUNCTION prevent_projection_baseline_update();

CREATE TABLE IF NOT EXISTS game_state_observations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nfl_game_id uuid NOT NULL REFERENCES nfl_games(id),
  provider text NOT NULL,
  source_revision text NOT NULL,
  request_started_at timestamptz NOT NULL,
  request_completed_at timestamptz NOT NULL,
  observed_at timestamptz NOT NULL,
  status_code smallint NOT NULL CHECK (status_code BETWEEN 0 AND 4),
  period text,
  game_clock text,
  home_score numeric,
  away_score numeric,
  source_data jsonb NOT NULL DEFAULT '{}'::jsonb
    CHECK (jsonb_typeof(source_data) = 'object'),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (request_completed_at >= request_started_at),
  UNIQUE (provider, nfl_game_id, source_revision)
);

CREATE OR REPLACE FUNCTION projection_game_period_rank(value text)
RETURNS smallint
LANGUAGE plpgsql
IMMUTABLE
STRICT
AS $$
DECLARE
  normalized text;
BEGIN
  normalized := regexp_replace(upper(btrim(value)), '\s+', ' ', 'g');
  RETURN CASE
    WHEN normalized IN ('1', 'Q1', '1ST', '1ST QUARTER', 'FIRST QUARTER') THEN 1
    WHEN normalized IN ('2', 'Q2', '2ND', '2ND QUARTER', 'SECOND QUARTER') THEN 2
    WHEN normalized IN ('HALF', 'HALFTIME', 'HALF TIME', 'HT') THEN 3
    WHEN normalized IN ('3', 'Q3', '3RD', '3RD QUARTER', 'THIRD QUARTER') THEN 4
    WHEN normalized IN ('4', 'Q4', '4TH', '4TH QUARTER', 'FOURTH QUARTER') THEN 5
    WHEN normalized IN ('5', 'Q5', 'OT', 'OVERTIME') OR normalized ~ '^OT[0-9]+$' THEN 6
    ELSE NULL
  END;
END;
$$;

CREATE OR REPLACE FUNCTION projection_game_clock_seconds(value text)
RETURNS integer
LANGUAGE plpgsql
IMMUTABLE
STRICT
AS $$
DECLARE
  parts text[];
  minutes integer;
  seconds integer;
BEGIN
  parts := regexp_match(btrim(value), '^([0-9]{1,2}):([0-5][0-9])$');
  IF parts IS NULL THEN RETURN NULL; END IF;
  minutes := parts[1]::integer;
  seconds := parts[2]::integer;
  IF minutes > 15 OR (minutes = 15 AND seconds <> 0) THEN RETURN NULL; END IF;
  RETURN (minutes * 60) + seconds;
END;
$$;

CREATE OR REPLACE FUNCTION prevent_game_state_regression()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  prior_state game_state_observations%ROWTYPE;
  prior_progress game_state_observations%ROWTYPE;
  prior_rank smallint;
  new_rank smallint;
  prior_clock integer;
  new_clock integer;
BEGIN
  -- A transaction-scoped provider/game lock makes the subsequent reads see the
  -- winner of any concurrent insert before validating this candidate.
  PERFORM pg_advisory_xact_lock(
    hashtextextended(NEW.provider || ':' || NEW.nfl_game_id::text, 0)
  );

  SELECT observation.* INTO prior_state
  FROM game_state_observations observation
  WHERE observation.provider = NEW.provider
    AND observation.nfl_game_id = NEW.nfl_game_id
  ORDER BY observation.observed_at DESC, observation.request_completed_at DESC,
    observation.created_at DESC, observation.id DESC
  LIMIT 1;

  IF FOUND THEN
    IF NEW.observed_at < prior_state.observed_at
      OR NEW.request_completed_at < prior_state.request_completed_at THEN
      RAISE EXCEPTION 'game-state regression: source time moved backward';
    END IF;
    IF prior_state.status_code = 2 AND NEW.status_code <> 2 THEN
      RAISE EXCEPTION 'game-state regression: final game became non-final';
    END IF;
    IF (prior_state.status_code = 1
      OR (prior_state.status_code = 4
        AND projection_game_period_rank(prior_state.period) IS NOT NULL))
      AND NEW.status_code = 0 THEN
      RAISE EXCEPTION 'game-state regression: started game became pregame';
    END IF;
    IF prior_state.status_code = 1 AND NEW.status_code = 3 THEN
      RAISE EXCEPTION 'game-state regression: live game became postponed';
    END IF;
    IF (prior_state.status_code = 4 AND NEW.status_code = 3
        AND projection_game_period_rank(prior_state.period) IS NOT NULL)
      OR (prior_state.status_code = 3 AND NEW.status_code = 4
        AND projection_game_period_rank(NEW.period) IS NOT NULL) THEN
      RAISE EXCEPTION 'game-state regression: interruption status changed ambiguously';
    END IF;
  END IF;

  IF NEW.status_code = 1 THEN
    new_rank := projection_game_period_rank(NEW.period);
    IF new_rank IS NULL THEN
      RAISE EXCEPTION 'game-state regression: live period is unavailable';
    END IF;
    IF new_rank IN (1, 2, 4, 5)
      AND projection_game_clock_seconds(NEW.game_clock) IS NULL THEN
      RAISE EXCEPTION 'game-state regression: regulation clock is unavailable';
    END IF;
  END IF;

  SELECT observation.* INTO prior_progress
  FROM game_state_observations observation
  WHERE observation.provider = NEW.provider
    AND observation.nfl_game_id = NEW.nfl_game_id
    AND observation.status_code IN (1, 4)
    AND projection_game_period_rank(observation.period) IS NOT NULL
  ORDER BY observation.observed_at DESC, observation.request_completed_at DESC,
    observation.created_at DESC, observation.id DESC
  LIMIT 1;

  IF FOUND AND NEW.status_code IN (1, 4) THEN
    prior_rank := projection_game_period_rank(prior_progress.period);
    new_rank := projection_game_period_rank(NEW.period);
    IF new_rank IS NOT NULL AND new_rank < prior_rank THEN
      RAISE EXCEPTION 'game-state regression: period moved backward';
    END IF;
    IF new_rank = prior_rank AND new_rank IN (1, 2, 4, 5) THEN
      prior_clock := projection_game_clock_seconds(prior_progress.game_clock);
      new_clock := projection_game_clock_seconds(NEW.game_clock);
      IF prior_clock IS NOT NULL AND new_clock IS NOT NULL AND new_clock > prior_clock THEN
        RAISE EXCEPTION 'game-state regression: regulation clock increased';
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS game_state_observations_no_regression
  ON game_state_observations;
CREATE TRIGGER game_state_observations_no_regression
  BEFORE INSERT ON game_state_observations
  FOR EACH ROW EXECUTE FUNCTION prevent_game_state_regression();

CREATE INDEX IF NOT EXISTS game_state_observations_latest_idx
  ON game_state_observations (nfl_game_id, observed_at DESC, created_at DESC);

CREATE INDEX IF NOT EXISTS game_state_observations_provider_latest_idx
  ON game_state_observations
  (provider, nfl_game_id, observed_at DESC, request_completed_at DESC, created_at DESC);

CREATE INDEX IF NOT EXISTS game_state_observations_retention_idx
  ON game_state_observations (created_at);

CREATE TABLE IF NOT EXISTS league_week_observations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  league_season_id uuid NOT NULL REFERENCES league_seasons(id),
  provider text NOT NULL,
  week smallint NOT NULL CHECK (week BETWEEN 0 AND 30),
  source_revision text NOT NULL,
  request_started_at timestamptz NOT NULL,
  request_completed_at timestamptz NOT NULL,
  observed_at timestamptz NOT NULL,
  quality text NOT NULL CHECK (quality IN ('complete', 'partial', 'invalid')),
  expected_game_count integer NOT NULL DEFAULT 0 CHECK (expected_game_count >= 0),
  source_data jsonb NOT NULL DEFAULT '{}'::jsonb
    CHECK (jsonb_typeof(source_data) = 'object'),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (request_completed_at >= request_started_at),
  UNIQUE (id, league_season_id, week),
  UNIQUE (league_season_id, provider, source_revision)
);

CREATE INDEX IF NOT EXISTS league_week_observations_latest_idx
  ON league_week_observations (league_season_id, week, observed_at DESC, created_at DESC);

CREATE INDEX IF NOT EXISTS league_week_observations_retention_idx
  ON league_week_observations (created_at);

CREATE TABLE IF NOT EXISTS league_week_expected_games (
  league_week_observation_id uuid NOT NULL
    REFERENCES league_week_observations(id) ON DELETE CASCADE,
  nfl_game_id uuid NOT NULL REFERENCES nfl_games(id),
  PRIMARY KEY (league_week_observation_id, nfl_game_id)
);

CREATE TABLE IF NOT EXISTS official_player_point_observations (
  league_week_observation_id uuid NOT NULL
    REFERENCES league_week_observations(id) ON DELETE CASCADE,
  external_roster_id text NOT NULL,
  scoring_entity_id uuid NOT NULL REFERENCES scoring_entities(id),
  points numeric,
  is_starter boolean NOT NULL,
  lineup_slot text,
  PRIMARY KEY (league_week_observation_id, external_roster_id, scoring_entity_id)
);

CREATE TABLE IF NOT EXISTS official_roster_point_observations (
  league_week_observation_id uuid NOT NULL
    REFERENCES league_week_observations(id) ON DELETE CASCADE,
  external_roster_id text NOT NULL,
  points numeric,
  PRIMARY KEY (league_week_observation_id, external_roster_id)
);

CREATE TABLE IF NOT EXISTS projection_jobs (
  job_key text PRIMARY KEY,
  job_type text NOT NULL,
  scheduled_for timestamptz NOT NULL,
  state text NOT NULL DEFAULT 'pending'
    CHECK (state IN ('pending', 'running', 'completed', 'failed')),
  payload jsonb NOT NULL DEFAULT '{}'::jsonb
    CHECK (jsonb_typeof(payload) = 'object'),
  lease_owner text,
  lease_until timestamptz,
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  last_error text,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (
    (state = 'running' AND lease_owner IS NOT NULL AND lease_until IS NOT NULL)
    OR state <> 'running'
  )
);

CREATE INDEX IF NOT EXISTS projection_jobs_claim_idx
  ON projection_jobs (state, scheduled_for, lease_until);

CREATE INDEX IF NOT EXISTS projection_jobs_retention_idx
  ON projection_jobs (updated_at) WHERE state = 'completed';

CREATE TABLE IF NOT EXISTS projection_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  league_season_id uuid NOT NULL REFERENCES league_seasons(id),
  week smallint NOT NULL CHECK (week BETWEEN 0 AND 30),
  model_version text NOT NULL,
  revision_key text NOT NULL,
  content_hash text NOT NULL,
  league_week_observation_id uuid NOT NULL,
  game_state_observation_ids uuid[] NOT NULL DEFAULT '{}'::uuid[],
  calculated_at timestamptz NOT NULL,
  quality text NOT NULL DEFAULT 'complete' CHECK (quality = 'complete'),
  payload jsonb NOT NULL CHECK (jsonb_typeof(payload) = 'object'),
  activity_windows jsonb NOT NULL DEFAULT '[]'::jsonb
    CHECK (jsonb_typeof(activity_windows) = 'array'
      AND jsonb_array_length(activity_windows) <= 32),
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (league_week_observation_id, league_season_id, week)
    REFERENCES league_week_observations(id, league_season_id, week),
  UNIQUE (id, league_season_id, week),
  UNIQUE (league_season_id, week, model_version, revision_key)
);

CREATE TABLE IF NOT EXISTS current_projection_snapshots (
  league_season_id uuid NOT NULL REFERENCES league_seasons(id),
  week smallint NOT NULL CHECK (week BETWEEN 0 AND 30),
  snapshot_id uuid NOT NULL,
  calculated_at timestamptz NOT NULL,
  published_at timestamptz NOT NULL DEFAULT now(),
  verified_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (league_season_id, week),
  FOREIGN KEY (snapshot_id, league_season_id, week)
    REFERENCES projection_snapshots(id, league_season_id, week)
);

CREATE INDEX IF NOT EXISTS projection_snapshots_history_idx
  ON projection_snapshots (league_season_id, week, calculated_at DESC, created_at DESC);

CREATE INDEX IF NOT EXISTS projection_snapshots_content_idx
  ON projection_snapshots (league_season_id, week, model_version, content_hash);

CREATE INDEX IF NOT EXISTS projection_snapshots_retention_idx
  ON projection_snapshots (created_at, league_season_id, week, model_version);

CREATE INDEX IF NOT EXISTS projection_snapshots_game_sources_idx
  ON projection_snapshots USING gin (game_state_observation_ids);

CREATE OR REPLACE FUNCTION prevent_projection_snapshot_update()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'projection snapshot history is immutable';
END;
$$;

DROP TRIGGER IF EXISTS projection_snapshots_immutable
  ON projection_snapshots;
CREATE TRIGGER projection_snapshots_immutable
  BEFORE UPDATE ON projection_snapshots
  FOR EACH ROW EXECUTE FUNCTION prevent_projection_snapshot_update();

CREATE OR REPLACE FUNCTION prevent_referenced_game_observation_delete()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM projection_snapshots snapshot
    WHERE snapshot.game_state_observation_ids @> ARRAY[OLD.id]::uuid[]
  ) THEN
    RAISE EXCEPTION 'game observation is referenced by an immutable projection snapshot';
  END IF;
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS game_state_observations_referenced
  ON game_state_observations;
CREATE TRIGGER game_state_observations_referenced
  BEFORE DELETE ON game_state_observations
  FOR EACH ROW EXECUTE FUNCTION prevent_referenced_game_observation_delete();

CREATE OR REPLACE FUNCTION prevent_league_season_scoring_profile_change()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION
    'scoring rules are immutable for an existing league season; register a new season for revised rules';
END;
$$;

DROP TRIGGER IF EXISTS league_seasons_scoring_profile_immutable
  ON league_seasons;
CREATE TRIGGER league_seasons_scoring_profile_immutable
  BEFORE UPDATE OF scoring_profile_id ON league_seasons
  FOR EACH ROW
  WHEN (OLD.scoring_profile_id IS DISTINCT FROM NEW.scoring_profile_id)
  EXECUTE FUNCTION prevent_league_season_scoring_profile_change();
