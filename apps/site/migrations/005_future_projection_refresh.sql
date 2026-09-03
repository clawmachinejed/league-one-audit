-- Durable scheduling state for future-week projection ingestion and league materialization.
--
-- Migration dependencies:
--   003_league_period_authority.sql
--   004_durable_projection_slates.sql
--
-- The tables retain due dates, last-known-good lineage, and bounded retry state across
-- deployments and cold starts. They are deliberately not a distributed work queue.

CREATE TABLE IF NOT EXISTS projection_period_refresh_states (
  projection_provider text NOT NULL,
  season smallint NOT NULL CHECK (season BETWEEN 1920 AND 2200),
  season_type text NOT NULL CHECK (season_type IN ('pre', 'reg', 'post')),
  week smallint NOT NULL CHECK (week BETWEEN 1 AND 18),
  normalizer_version text NOT NULL,
  week_distance smallint NOT NULL CHECK (week_distance BETWEEN 1 AND 18),
  next_refresh_at timestamptz NOT NULL,
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  active_attempt_id uuid,
  active_attempt_started_at timestamptz,
  active_attempt_expires_at timestamptz,
  last_attempted_at timestamptz,
  last_succeeded_at timestamptz,
  last_projection_slate_observation_id uuid,
  last_projection_slate_content_id uuid,
  consecutive_failures integer NOT NULL DEFAULT 0 CHECK (consecutive_failures >= 0),
  last_failure_code text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (
    projection_provider, season, season_type, week, normalizer_version
  ),
  FOREIGN KEY (
    last_projection_slate_observation_id, last_projection_slate_content_id,
    projection_provider, season, season_type, week, normalizer_version
  ) REFERENCES projection_slate_observations (
    id, projection_slate_content_id,
    provider, season, season_type, week, normalizer_version
  ),
  CHECK (
    (active_attempt_id IS NULL
      AND active_attempt_started_at IS NULL
      AND active_attempt_expires_at IS NULL)
    OR (active_attempt_id IS NOT NULL
      AND active_attempt_started_at IS NOT NULL
      AND active_attempt_expires_at > active_attempt_started_at)
  ),
  CHECK (
    (last_attempted_at IS NULL AND attempt_count = 0)
    OR (last_attempted_at IS NOT NULL AND attempt_count > 0)
  ),
  CHECK (
    active_attempt_started_at IS NULL
    OR active_attempt_started_at = last_attempted_at
  ),
  CHECK (last_succeeded_at IS NULL OR last_attempted_at IS NOT NULL),
  CHECK (
    (last_projection_slate_observation_id IS NULL
      AND last_projection_slate_content_id IS NULL
      AND last_succeeded_at IS NULL)
    OR (last_projection_slate_observation_id IS NOT NULL
      AND last_projection_slate_content_id IS NOT NULL
      AND last_succeeded_at IS NOT NULL)
  ),
  CHECK (
    (consecutive_failures = 0 AND last_failure_code IS NULL)
    OR (consecutive_failures > 0 AND last_failure_code IN (
      'provider-unavailable',
      'projection-slate-incomplete',
      'projection-slate-invalid',
      'projection-slate-persistence-failed',
      'projection-slate-unavailable',
      'game-state-unavailable',
      'game-state-incomplete',
      'league-source-unavailable',
      'league-period-mismatch',
      'lineup-not-ready',
      'identity-conflict',
      'scoring-failed',
      'baseline-freeze-incomplete',
      'official-observation-incomplete',
      'snapshot-rejected',
      'snapshot-publication-failed',
      'deadline-exceeded',
      'unexpected'
    ))
  )
);

CREATE INDEX IF NOT EXISTS projection_period_refresh_due_idx
  ON projection_period_refresh_states (
    next_refresh_at, season, season_type, week, projection_provider, normalizer_version
  );

CREATE TABLE IF NOT EXISTS league_week_materialization_states (
  league_key text NOT NULL REFERENCES league_period_authorities(league_key),
  projection_provider text NOT NULL,
  season smallint NOT NULL CHECK (season BETWEEN 1920 AND 2200),
  season_type text NOT NULL CHECK (season_type IN ('pre', 'reg', 'post')),
  week smallint NOT NULL CHECK (week BETWEEN 1 AND 18),
  normalizer_version text NOT NULL,
  model_version text NOT NULL,
  week_distance smallint NOT NULL CHECK (week_distance BETWEEN 1 AND 18),
  next_refresh_at timestamptz NOT NULL,
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  active_attempt_id uuid,
  active_attempt_started_at timestamptz,
  active_attempt_expires_at timestamptz,
  last_attempted_at timestamptz,
  last_succeeded_at timestamptz,
  last_source_revision text,
  last_projection_slate_observation_id uuid,
  last_projection_slate_content_id uuid,
  last_snapshot_revision text,
  consecutive_failures integer NOT NULL DEFAULT 0 CHECK (consecutive_failures >= 0),
  last_failure_code text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (
    league_key, projection_provider, season, season_type, week,
    normalizer_version, model_version
  ),
  FOREIGN KEY (
    last_projection_slate_observation_id, last_projection_slate_content_id,
    projection_provider, season, season_type, week, normalizer_version
  ) REFERENCES projection_slate_observations (
    id, projection_slate_content_id,
    provider, season, season_type, week, normalizer_version
  ),
  CHECK (
    (active_attempt_id IS NULL
      AND active_attempt_started_at IS NULL
      AND active_attempt_expires_at IS NULL)
    OR (active_attempt_id IS NOT NULL
      AND active_attempt_started_at IS NOT NULL
      AND active_attempt_expires_at > active_attempt_started_at)
  ),
  CHECK (
    (last_attempted_at IS NULL AND attempt_count = 0)
    OR (last_attempted_at IS NOT NULL AND attempt_count > 0)
  ),
  CHECK (
    active_attempt_started_at IS NULL
    OR active_attempt_started_at = last_attempted_at
  ),
  CHECK (last_succeeded_at IS NULL OR last_attempted_at IS NOT NULL),
  CHECK (
    (last_source_revision IS NULL
      AND last_projection_slate_observation_id IS NULL
      AND last_projection_slate_content_id IS NULL
      AND last_snapshot_revision IS NULL
      AND last_succeeded_at IS NULL)
    OR (last_source_revision IS NOT NULL
      AND last_projection_slate_observation_id IS NOT NULL
      AND last_projection_slate_content_id IS NOT NULL
      AND last_snapshot_revision IS NOT NULL
      AND last_succeeded_at IS NOT NULL)
  ),
  CHECK (
    (consecutive_failures = 0 AND last_failure_code IS NULL)
    OR (consecutive_failures > 0 AND last_failure_code IN (
      'provider-unavailable',
      'projection-slate-incomplete',
      'projection-slate-invalid',
      'projection-slate-persistence-failed',
      'projection-slate-unavailable',
      'game-state-unavailable',
      'game-state-incomplete',
      'league-source-unavailable',
      'league-period-mismatch',
      'lineup-not-ready',
      'identity-conflict',
      'scoring-failed',
      'baseline-freeze-incomplete',
      'official-observation-incomplete',
      'snapshot-rejected',
      'snapshot-publication-failed',
      'deadline-exceeded',
      'unexpected'
    ))
  )
);

CREATE INDEX IF NOT EXISTS league_week_materialization_due_idx
  ON league_week_materialization_states (
    next_refresh_at, season, season_type, week,
    projection_provider, normalizer_version, model_version, league_key
  );

-- Scheduling identities are immutable even though due dates and attempt state are mutable.
CREATE OR REPLACE FUNCTION prevent_future_refresh_identity_change()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_TABLE_NAME = 'projection_period_refresh_states' THEN
    IF OLD.projection_provider IS DISTINCT FROM NEW.projection_provider
      OR OLD.season IS DISTINCT FROM NEW.season
      OR OLD.season_type IS DISTINCT FROM NEW.season_type
      OR OLD.week IS DISTINCT FROM NEW.week
      OR OLD.normalizer_version IS DISTINCT FROM NEW.normalizer_version
      OR OLD.created_at IS DISTINCT FROM NEW.created_at THEN
      RAISE EXCEPTION 'projection refresh identity is immutable';
    END IF;
  ELSE
    IF OLD.league_key IS DISTINCT FROM NEW.league_key
      OR OLD.projection_provider IS DISTINCT FROM NEW.projection_provider
      OR OLD.season IS DISTINCT FROM NEW.season
      OR OLD.season_type IS DISTINCT FROM NEW.season_type
      OR OLD.week IS DISTINCT FROM NEW.week
      OR OLD.normalizer_version IS DISTINCT FROM NEW.normalizer_version
      OR OLD.model_version IS DISTINCT FROM NEW.model_version
      OR OLD.created_at IS DISTINCT FROM NEW.created_at THEN
      RAISE EXCEPTION 'materialization refresh identity is immutable';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS projection_period_refresh_identity_immutable
  ON projection_period_refresh_states;
CREATE TRIGGER projection_period_refresh_identity_immutable
  BEFORE UPDATE ON projection_period_refresh_states
  FOR EACH ROW EXECUTE FUNCTION prevent_future_refresh_identity_change();

DROP TRIGGER IF EXISTS league_week_materialization_identity_immutable
  ON league_week_materialization_states;
CREATE TRIGGER league_week_materialization_identity_immutable
  BEFORE UPDATE ON league_week_materialization_states
  FOR EACH ROW EXECUTE FUNCTION prevent_future_refresh_identity_change();
