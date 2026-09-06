-- B3 compatibility phase. Existing table/column grants are deliberately unchanged.
-- Functions replace conflict updates without rewriting historical rows. Their
-- separate PL/pgSQL statements obtain fresh READ COMMITTED snapshots after a
-- competing insert, rather than depending on a same-statement fallback SELECT.

CREATE FUNCTION public.prevent_projection_stable_field_change()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  field_name text;
BEGIN
  -- No-op updates remain compatible with callers from before this migration.
  IF NEW IS NOT DISTINCT FROM OLD THEN
    RETURN NEW;
  END IF;
  IF TG_NARGS = 0 THEN
    RAISE EXCEPTION '% history is immutable', TG_TABLE_NAME;
  END IF;
  FOREACH field_name IN ARRAY TG_ARGV LOOP
    IF (to_jsonb(NEW) -> field_name) IS DISTINCT FROM (to_jsonb(OLD) -> field_name) THEN
      RAISE EXCEPTION '% stable identity is immutable', TG_TABLE_NAME;
    END IF;
  END LOOP;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.prevent_projection_stable_field_change() FROM PUBLIC;

CREATE TRIGGER scoring_profiles_history_immutable
  BEFORE UPDATE ON public.scoring_profiles
  FOR EACH ROW EXECUTE FUNCTION public.prevent_projection_stable_field_change();
CREATE TRIGGER game_state_observations_history_immutable
  BEFORE UPDATE ON public.game_state_observations
  FOR EACH ROW EXECUTE FUNCTION public.prevent_projection_stable_field_change();
CREATE TRIGGER leagues_identity_immutable
  BEFORE UPDATE ON public.leagues
  FOR EACH ROW EXECUTE FUNCTION public.prevent_projection_stable_field_change(
    'id', 'league_key', 'created_at');
CREATE TRIGGER league_seasons_identity_immutable
  BEFORE UPDATE ON public.league_seasons
  FOR EACH ROW EXECUTE FUNCTION public.prevent_projection_stable_field_change(
    'id', 'league_id', 'season', 'scoring_profile_id', 'created_at');
CREATE TRIGGER league_source_connections_identity_immutable
  BEFORE UPDATE ON public.league_source_connections
  FOR EACH ROW EXECUTE FUNCTION public.prevent_projection_stable_field_change(
    'league_season_id', 'provider');
CREATE TRIGGER scoring_entities_identity_immutable
  BEFORE UPDATE ON public.scoring_entities
  FOR EACH ROW EXECUTE FUNCTION public.prevent_projection_stable_field_change(
    'id', 'kind', 'created_at');
CREATE TRIGGER nfl_games_identity_immutable
  BEFORE UPDATE ON public.nfl_games
  FOR EACH ROW EXECUTE FUNCTION public.prevent_projection_stable_field_change(
    'id', 'season', 'season_type', 'week', 'home_team', 'away_team', 'created_at');
CREATE TRIGGER current_projection_snapshots_identity_immutable
  BEFORE UPDATE ON public.current_projection_snapshots
  FOR EACH ROW EXECUTE FUNCTION public.prevent_projection_stable_field_change(
    'league_season_id', 'week');
CREATE TRIGGER current_projection_slates_identity_immutable
  BEFORE UPDATE ON public.current_projection_slates
  FOR EACH ROW EXECUTE FUNCTION public.prevent_projection_stable_field_change(
    'provider', 'season', 'season_type', 'week', 'normalizer_version');
CREATE TRIGGER current_pregame_projection_candidates_identity_immutable
  BEFORE UPDATE ON public.current_pregame_projection_candidates
  FOR EACH ROW EXECUTE FUNCTION public.prevent_projection_stable_field_change(
    'nfl_game_id', 'scoring_entity_id', 'scoring_profile_id', 'projection_provider', 'model_version');

CREATE FUNCTION public.prevent_projection_run_history_change()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW IS NOT DISTINCT FROM OLD THEN
      RETURN NEW;
    END IF;
    IF (to_jsonb(NEW) - 'projection_slate_observation_id')
        IS DISTINCT FROM (to_jsonb(OLD) - 'projection_slate_observation_id')
      OR OLD.projection_slate_observation_id IS NOT NULL
      OR NEW.projection_slate_observation_id IS NULL
      OR current_user::regrole::oid <> (
        SELECT relation.relowner FROM pg_catalog.pg_class relation
        WHERE relation.oid = 'public.pregame_projection_runs'::regclass
      ) THEN
      RAISE EXCEPTION 'projection run history is immutable; slate enrichment requires its owner-controlled function';
    END IF;
  END IF;

  IF NEW.projection_slate_observation_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.projection_slate_observations observation
    WHERE observation.id = NEW.projection_slate_observation_id
      AND observation.provider = NEW.provider
      AND observation.season = NEW.season
      AND observation.season_type = NEW.season_type
      AND observation.week = NEW.week
      AND observation.source_revision = NEW.source_revision
      AND observation.request_started_at = NEW.request_started_at
      AND observation.request_completed_at = NEW.request_completed_at
      AND observation.observed_at = NEW.fetched_at
  ) THEN
    RAISE EXCEPTION 'projection run slate lineage does not match its immutable source';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.prevent_projection_run_history_change() FROM PUBLIC;
CREATE TRIGGER pregame_projection_runs_history_immutable
  BEFORE INSERT OR UPDATE ON public.pregame_projection_runs
  FOR EACH ROW EXECUTE FUNCTION public.prevent_projection_run_history_change();

CREATE FUNCTION public.prevent_projection_slate_entry_delete()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
  -- Existing retention deletes an unreferenced content parent. Its ON DELETE
  -- CASCADE runs after that parent has been removed and must remain supported.
  -- A direct entry deletion leaves the immutable content parent in place.
  IF EXISTS (
    SELECT 1 FROM public.projection_slate_contents content
    WHERE content.id = OLD.projection_slate_content_id
  ) THEN
    RAISE EXCEPTION 'projection slate entries are immutable while their content exists';
  END IF;
  RETURN OLD;
END;
$$;
REVOKE ALL ON FUNCTION public.prevent_projection_slate_entry_delete() FROM PUBLIC;
CREATE TRIGGER projection_slate_entries_delete_guard
  BEFORE DELETE ON public.projection_slate_entries
  FOR EACH ROW EXECUTE FUNCTION public.prevent_projection_slate_entry_delete();

CREATE FUNCTION public.get_or_create_scoring_profile(p_rules_hash text, p_rules jsonb)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  profile_id uuid;
BEGIN
  INSERT INTO public.scoring_profiles (rules_hash, rules)
  VALUES (p_rules_hash, p_rules)
  ON CONFLICT (rules_hash) DO NOTHING
  RETURNING id INTO profile_id;
  IF profile_id IS NULL THEN
    SELECT profile.id INTO STRICT profile_id
    FROM public.scoring_profiles profile
    WHERE profile.rules_hash = p_rules_hash
    FOR KEY SHARE;
  END IF;
  RETURN profile_id;
END;
$$;
REVOKE ALL ON FUNCTION public.get_or_create_scoring_profile(text, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_or_create_scoring_profile(text, jsonb) TO league_one_runtime;

CREATE FUNCTION public.record_game_state_observations(p_provider text, p_states jsonb)
RETURNS TABLE (external_game_id text, source_revision text, observation_id uuid)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
  INSERT INTO public.game_state_observations (
    nfl_game_id, provider, source_revision, request_started_at,
    request_completed_at, observed_at, status_code, period, game_clock,
    home_score, away_score, source_data
  )
  SELECT mapping.nfl_game_id, p_provider, input.source_revision,
    input.request_started_at, input.request_completed_at, input.observed_at,
    input.status_code, input.period, input.game_clock, input.home_score,
    input.away_score, input.source_data
  FROM jsonb_to_recordset(p_states) AS input(
    external_game_id text, source_revision text,
    request_started_at timestamptz, request_completed_at timestamptz,
    observed_at timestamptz, status_code smallint, period text, game_clock text,
    home_score numeric, away_score numeric, source_data jsonb
  )
  JOIN public.external_game_ids mapping
    ON mapping.provider = p_provider AND mapping.external_game_id = input.external_game_id
  ORDER BY mapping.nfl_game_id
  ON CONFLICT DO NOTHING;

  -- Exact replay returns the original observation without an UPDATE. A
  -- conflicting replay still returns no row, matching the prior write path.
  RETURN QUERY
  SELECT input.external_game_id, observation.source_revision, observation.id
  FROM jsonb_to_recordset(p_states) AS input(
    external_game_id text, source_revision text,
    request_started_at timestamptz, request_completed_at timestamptz,
    observed_at timestamptz, status_code smallint, period text, game_clock text,
    home_score numeric, away_score numeric, source_data jsonb
  )
  JOIN public.external_game_ids mapping
    ON mapping.provider = p_provider AND mapping.external_game_id = input.external_game_id
  JOIN public.game_state_observations observation
    ON observation.provider = p_provider AND observation.nfl_game_id = mapping.nfl_game_id
    AND observation.source_revision = input.source_revision
  WHERE observation.request_started_at = input.request_started_at
    AND observation.request_completed_at = input.request_completed_at
    AND observation.observed_at = input.observed_at
    AND observation.status_code = input.status_code
    AND observation.period IS NOT DISTINCT FROM input.period
    AND observation.game_clock IS NOT DISTINCT FROM input.game_clock
    AND observation.home_score IS NOT DISTINCT FROM input.home_score
    AND observation.away_score IS NOT DISTINCT FROM input.away_score
    AND observation.source_data = input.source_data
  ORDER BY input.external_game_id;
END;
$$;
REVOKE ALL ON FUNCTION public.record_game_state_observations(text, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.record_game_state_observations(text, jsonb) TO league_one_runtime;

CREATE FUNCTION public.get_or_create_projection_run(
  p_provider text, p_season smallint, p_season_type text, p_week smallint,
  p_model_version text, p_source_revision text, p_request_started_at timestamptz,
  p_request_completed_at timestamptz, p_fetched_at timestamptz, p_quality text,
  p_projection_slate_observation_id uuid
)
RETURNS SETOF public.pregame_projection_runs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  stored_run public.pregame_projection_runs%ROWTYPE;
BEGIN
  -- Find a replay before INSERT so incoming replay metadata cannot replace or
  -- accidentally revalidate the stored historical metadata. The prior caller
  -- also kept the first run's timestamps and quality on a matching source key.
  SELECT run.* INTO stored_run
  FROM public.pregame_projection_runs run
  WHERE run.provider = p_provider AND run.season = p_season
    AND run.season_type = p_season_type AND run.week = p_week
    AND run.source_revision = p_source_revision AND run.model_version = p_model_version
  FOR UPDATE;
  IF NOT FOUND THEN
    INSERT INTO public.pregame_projection_runs (
      provider, season, season_type, week, model_version, source_revision,
      request_started_at, request_completed_at, fetched_at, quality,
      projection_slate_observation_id
    ) VALUES (
      p_provider, p_season, p_season_type, p_week, p_model_version, p_source_revision,
      p_request_started_at, p_request_completed_at, p_fetched_at, p_quality,
      p_projection_slate_observation_id
    )
    ON CONFLICT (provider, season, season_type, week, source_revision, model_version) DO NOTHING
    RETURNING * INTO stored_run;
    IF NOT FOUND THEN
      SELECT run.* INTO STRICT stored_run
      FROM public.pregame_projection_runs run
      WHERE run.provider = p_provider AND run.season = p_season
        AND run.season_type = p_season_type AND run.week = p_week
        AND run.source_revision = p_source_revision AND run.model_version = p_model_version
      FOR UPDATE;
    END IF;
  END IF;

  IF stored_run.projection_slate_observation_id IS NULL
    AND p_projection_slate_observation_id IS NOT NULL THEN
    UPDATE public.pregame_projection_runs run
    SET projection_slate_observation_id = p_projection_slate_observation_id
    WHERE run.id = stored_run.id
    RETURNING run.* INTO stored_run;
  ELSIF stored_run.projection_slate_observation_id IS NOT NULL
    AND p_projection_slate_observation_id IS NOT NULL
    AND stored_run.projection_slate_observation_id <> p_projection_slate_observation_id THEN
    RETURN;
  END IF;
  RETURN NEXT stored_run;
END;
$$;
REVOKE ALL ON FUNCTION public.get_or_create_projection_run(
  text, smallint, text, smallint, text, text, timestamptz, timestamptz, timestamptz, text, uuid
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_or_create_projection_run(
  text, smallint, text, smallint, text, text, timestamptz, timestamptz, timestamptz, text, uuid
) TO league_one_runtime;
