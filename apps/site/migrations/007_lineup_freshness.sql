-- Additive lineage and coordination only. Existing revisions and payloads are unchanged.
CREATE FUNCTION valid_lineup_roster_ids(ids text[], expected_count integer)
RETURNS boolean LANGUAGE sql IMMUTABLE STRICT AS $$
  SELECT array_ndims(ids) = 1 AND cardinality(ids) = expected_count
    AND expected_count > 0 AND NOT EXISTS (
      SELECT 1 FROM unnest(ids) id WHERE id IS NULL OR btrim(id) = '' OR id <> btrim(id)
    ) AND (SELECT count(DISTINCT id) FROM unnest(ids) id) = expected_count
$$;

ALTER TABLE league_period_authorities
  ADD COLUMN source_external_league_id text,
  ADD COLUMN expected_roster_count integer,
  ADD COLUMN expected_starter_slot_count integer,
  ADD COLUMN expected_roster_ids text[],
  ADD COLUMN default_period_cadence jsonb CHECK (default_period_cadence IS NULL OR jsonb_typeof(default_period_cadence) = 'object'),
  ADD COLUMN authority_generation bigint NOT NULL DEFAULT 1,
  ADD CONSTRAINT league_authority_generation_positive CHECK (authority_generation > 0),
  ADD CONSTRAINT league_authority_lineup_shape CHECK (
    (source_external_league_id IS NULL AND expected_roster_count IS NULL
      AND expected_starter_slot_count IS NULL AND expected_roster_ids IS NULL)
    OR (source_external_league_id IS NOT NULL AND btrim(source_external_league_id) <> ''
      AND expected_roster_count IS NOT NULL AND expected_starter_slot_count IS NOT NULL
      AND expected_roster_count BETWEEN 1 AND 1000
      AND expected_starter_slot_count BETWEEN 1 AND 100
      AND expected_roster_ids IS NOT NULL
      AND valid_lineup_roster_ids(expected_roster_ids, expected_roster_count))
  );

ALTER TABLE league_week_observations
  ADD COLUMN lineup_revision_version text,
  ADD COLUMN lineup_revision text,
  ADD CONSTRAINT league_observation_lineup_lineage CHECK (
    (lineup_revision_version IS NULL AND lineup_revision IS NULL)
    OR (lineup_revision_version IS NOT NULL AND btrim(lineup_revision_version) <> ''
      AND lineup_revision IS NOT NULL AND lineup_revision ~ '^[0-9a-f]{64}$')
  );

ALTER TABLE current_projection_snapshots
  ADD COLUMN verification_source_observation_id uuid,
  ADD CONSTRAINT current_snapshot_verification_source_fk
    FOREIGN KEY (verification_source_observation_id, league_season_id, week)
    REFERENCES league_week_observations (id, league_season_id, week);
CREATE INDEX current_snapshot_verification_source_idx
  ON current_projection_snapshots (verification_source_observation_id)
  WHERE verification_source_observation_id IS NOT NULL;

CREATE TABLE league_week_lineup_watch_states (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  league_key text NOT NULL REFERENCES league_period_authorities (league_key),
  source_provider text NOT NULL CHECK (source_provider = lower(btrim(source_provider)) AND source_provider <> ''),
  external_league_id text NOT NULL CHECK (btrim(external_league_id) <> ''),
  season smallint NOT NULL CHECK (season BETWEEN 1920 AND 2200),
  season_type text NOT NULL CHECK (season_type IN ('pre', 'reg', 'post')),
  week smallint NOT NULL CHECK (week BETWEEN 1 AND 18),
  lineup_revision_version text NOT NULL CHECK (btrim(lineup_revision_version) <> ''),
  cadence_policy_version text NOT NULL CHECK (btrim(cadence_policy_version) <> ''),
  authority_generation bigint NOT NULL CHECK (authority_generation > 0),
  watch_generation bigint NOT NULL DEFAULT 1 CHECK (watch_generation > 0),
  watch_class text NOT NULL CHECK (watch_class IN ('current', 'future', 'completed')),
  materialization_lane text CHECK (materialization_lane IN ('current', 'future')),
  phase smallint NOT NULL CHECK (phase BETWEEN 0 AND 2),
  expected_roster_count integer NOT NULL CHECK (expected_roster_count BETWEEN 1 AND 1000),
  expected_starter_slot_count integer NOT NULL CHECK (expected_starter_slot_count BETWEEN 1 AND 100),
  expected_roster_ids text[] NOT NULL,
  next_check_at timestamptz,
  observed_version bigint NOT NULL DEFAULT 0 CHECK (observed_version >= 0),
  materialization_woken_version bigint NOT NULL DEFAULT 0 CHECK (materialization_woken_version >= 0),
  projection_woken_version bigint NOT NULL DEFAULT 0 CHECK (projection_woken_version >= 0),
  latest_lineup_revision text CHECK (latest_lineup_revision ~ '^[0-9a-f]{64}$'),
  accepted_request_started_at timestamptz,
  accepted_request_completed_at timestamptz,
  last_checked_at timestamptz,
  last_complete_observation_at timestamptz,
  last_materialized_lineup_revision text CHECK (last_materialized_lineup_revision ~ '^[0-9a-f]{64}$'),
  last_materialized_snapshot_revision text,
  last_materialized_verified_at timestamptz,
  pending_since timestamptz,
  active_attempt_id uuid,
  claim_generation bigint NOT NULL DEFAULT 0 CHECK (claim_generation >= 0),
  lease_owner text,
  attempt_started_at timestamptz,
  lease_expires_at timestamptz,
  attempt_count bigint NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  consecutive_failures integer NOT NULL DEFAULT 0 CHECK (consecutive_failures >= 0),
  last_failure_code text,
  retired_at timestamptz,
  retirement_reason text CHECK (retirement_reason IN (
    'completed', 'source-replaced', 'revision-version-replaced', 'season-replaced',
    'out-of-horizon', 'league-removed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT lineup_watch_roster_shape CHECK (valid_lineup_roster_ids(expected_roster_ids, expected_roster_count)),
  CONSTRAINT lineup_watch_wake_versions CHECK (materialization_woken_version <= observed_version AND projection_woken_version <= observed_version),
  CONSTRAINT lineup_watch_accepted_lineage CHECK (
    (latest_lineup_revision IS NULL AND accepted_request_started_at IS NULL
      AND accepted_request_completed_at IS NULL AND last_complete_observation_at IS NULL AND observed_version = 0)
    OR (latest_lineup_revision IS NOT NULL AND accepted_request_started_at IS NOT NULL
      AND accepted_request_completed_at IS NOT NULL
      AND accepted_request_completed_at >= accepted_request_started_at
      AND last_complete_observation_at IS NOT NULL AND observed_version > 0)),
  CONSTRAINT lineup_watch_materialized_lineage CHECK (
    (last_materialized_lineup_revision IS NULL AND last_materialized_snapshot_revision IS NULL AND last_materialized_verified_at IS NULL)
    OR (last_materialized_lineup_revision IS NOT NULL AND last_materialized_snapshot_revision IS NOT NULL AND last_materialized_verified_at IS NOT NULL)),
  CONSTRAINT lineup_watch_claim CHECK (
    (active_attempt_id IS NULL AND lease_owner IS NULL AND attempt_started_at IS NULL AND lease_expires_at IS NULL)
    OR (active_attempt_id IS NOT NULL AND lease_owner IS NOT NULL AND btrim(lease_owner) <> ''
      AND attempt_started_at IS NOT NULL AND lease_expires_at IS NOT NULL AND lease_expires_at > attempt_started_at)),
  CONSTRAINT lineup_watch_retirement CHECK (
    (retired_at IS NULL AND retirement_reason IS NULL AND watch_class <> 'completed'
      AND materialization_lane IS NOT NULL AND next_check_at IS NOT NULL)
    OR (retired_at IS NOT NULL AND retirement_reason IS NOT NULL AND next_check_at IS NULL
      AND materialization_lane IS NULL AND active_attempt_id IS NULL AND pending_since IS NULL)),
  CONSTRAINT lineup_watch_pending CHECK (retired_at IS NOT NULL OR
    ((pending_since IS NOT NULL) = (latest_lineup_revision IS NOT NULL
      AND latest_lineup_revision IS DISTINCT FROM last_materialized_lineup_revision)))
);
CREATE UNIQUE INDEX lineup_watch_active_identity_idx
  ON league_week_lineup_watch_states (league_key, season, season_type, week)
  WHERE retired_at IS NULL;
CREATE INDEX lineup_watch_due_idx ON league_week_lineup_watch_states (materialization_lane, next_check_at, phase)
  WHERE retired_at IS NULL;
CREATE INDEX lineup_watch_pending_idx ON league_week_lineup_watch_states (materialization_lane, pending_since, season, season_type, week)
  WHERE retired_at IS NULL AND pending_since IS NOT NULL;

CREATE FUNCTION prevent_lineup_watch_identity_change()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF ROW(NEW.id, NEW.league_key, NEW.source_provider, NEW.external_league_id,
    NEW.season, NEW.season_type, NEW.week, NEW.lineup_revision_version, NEW.created_at)
    IS DISTINCT FROM ROW(OLD.id, OLD.league_key, OLD.source_provider, OLD.external_league_id,
    OLD.season, OLD.season_type, OLD.week, OLD.lineup_revision_version, OLD.created_at) THEN
    RAISE EXCEPTION 'Lineup watch identity is immutable';
  END IF;
  IF OLD.retired_at IS NOT NULL AND NEW IS DISTINCT FROM OLD THEN
    RAISE EXCEPTION 'Retired lineup watch state is immutable';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER lineup_watch_identity_immutable BEFORE UPDATE ON league_week_lineup_watch_states
  FOR EACH ROW EXECUTE FUNCTION prevent_lineup_watch_identity_change();
REVOKE ALL ON TABLE league_week_lineup_watch_states FROM PUBLIC;

ALTER TABLE league_week_materialization_states
  ADD COLUMN active_watch_id uuid REFERENCES league_week_lineup_watch_states (id),
  ADD COLUMN active_watch_generation bigint,
  ADD COLUMN active_authority_generation bigint,
  ADD COLUMN active_target_observed_version bigint,
  ADD COLUMN active_target_lineup_revision text,
  ADD CONSTRAINT materialization_lineup_claim CHECK (
    (active_watch_id IS NULL AND active_watch_generation IS NULL AND active_authority_generation IS NULL
      AND active_target_observed_version IS NULL AND active_target_lineup_revision IS NULL)
    OR (active_attempt_id IS NOT NULL AND active_watch_id IS NOT NULL
      AND active_watch_generation IS NOT NULL AND active_authority_generation IS NOT NULL
      AND active_target_observed_version IS NOT NULL
      AND active_watch_generation > 0 AND active_authority_generation > 0
      AND active_target_observed_version >= 0
      AND (active_target_lineup_revision IS NULL OR active_target_lineup_revision ~ '^[0-9a-f]{64}$'))
  );
