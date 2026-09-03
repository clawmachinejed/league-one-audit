-- Provider-neutral matchup-period authority.
--
-- This table is intentionally keyed by the application's stable league key.
-- Period discovery can therefore run before a league season has been registered,
-- while snapshot lookup still joins through the normalized league tables.

CREATE TABLE IF NOT EXISTS league_period_authorities (
  league_key text PRIMARY KEY,
  default_season smallint NOT NULL CHECK (default_season BETWEEN 1920 AND 2200),
  default_season_type text NOT NULL CHECK (default_season_type IN ('pre', 'reg', 'post')),
  default_week smallint NOT NULL CHECK (default_week BETWEEN 1 AND 18),
  active_season smallint CHECK (active_season BETWEEN 1920 AND 2200),
  active_season_type text CHECK (active_season_type IN ('pre', 'reg', 'post')),
  active_week smallint CHECK (active_week BETWEEN 1 AND 18),
  league_lifecycle text NOT NULL CHECK (league_lifecycle IN ('preseason', 'active', 'complete')),
  nfl_phase text NOT NULL CHECK (nfl_phase IN ('preseason', 'regular', 'postseason', 'unknown')),
  source_provider text NOT NULL,
  source_revision text NOT NULL,
  source_observed_at timestamptz NOT NULL,
  verified_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (
    (active_season IS NULL AND active_season_type IS NULL AND active_week IS NULL)
    OR (active_season IS NOT NULL AND active_season_type IS NOT NULL AND active_week IS NOT NULL)
  ),
  CHECK (
    (league_lifecycle = 'active' AND active_season IS NOT NULL)
    OR (league_lifecycle <> 'active' AND active_season IS NULL)
  ),
  CHECK (verified_at >= source_observed_at)
);

CREATE INDEX IF NOT EXISTS league_period_authorities_verified_idx
  ON league_period_authorities (verified_at DESC);
