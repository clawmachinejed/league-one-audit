-- Additive league-scoped acceptance. Legacy material, functions and pointers remain intact.
-- Score content v2 changes parity lineage placement, not sleeper-actual-v1 arithmetic.
CREATE TABLE public.all_player_league_acceptances (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  league_season_id uuid NOT NULL REFERENCES public.league_seasons(id),
  provider text NOT NULL,
  season smallint NOT NULL,
  season_type text NOT NULL,
  week smallint NOT NULL,
  scoring_profile_id uuid NOT NULL REFERENCES public.scoring_profiles(id),
  scorer_version text NOT NULL,
  all_player_stat_observation_id uuid NOT NULL REFERENCES public.all_player_stat_observations(id),
  all_player_stat_content_id uuid NOT NULL REFERENCES public.all_player_stat_contents(id),
  all_player_score_set_id uuid NOT NULL REFERENCES public.all_player_score_sets(id),
  official_observation_id uuid NOT NULL REFERENCES public.league_week_observations(id),
  parity_evidence jsonb NOT NULL CHECK (jsonb_typeof(parity_evidence) = 'object'),
  source_external_league_id text NOT NULL,
  fence_generation integer NOT NULL CHECK (fence_generation > 0),
  observed_at timestamptz NOT NULL,
  verified_at timestamptz NOT NULL CHECK (verified_at >= observed_at),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (league_season_id, all_player_stat_observation_id, all_player_score_set_id,
    official_observation_id, fence_generation),
  UNIQUE (id, league_season_id, provider, season, season_type, week, scorer_version),
  FOREIGN KEY(all_player_score_set_id, all_player_stat_content_id, provider, season, season_type, week,
    scoring_profile_id, scorer_version) REFERENCES public.all_player_score_sets
    (id, all_player_stat_content_id, provider, season, season_type, week, scoring_profile_id, scorer_version)
);
CREATE INDEX all_player_league_acceptances_official_idx
  ON public.all_player_league_acceptances(official_observation_id);
CREATE INDEX all_player_league_acceptances_scores_idx
  ON public.all_player_league_acceptances(all_player_score_set_id);
CREATE TRIGGER all_player_league_acceptances_immutable
  BEFORE UPDATE OR DELETE ON public.all_player_league_acceptances
  FOR EACH ROW EXECUTE FUNCTION public.prevent_all_player_history_change();
CREATE TABLE public.current_all_player_league_scores (
  league_season_id uuid NOT NULL,
  provider text NOT NULL,
  season smallint NOT NULL,
  season_type text NOT NULL,
  week smallint NOT NULL,
  scorer_version text NOT NULL,
  acceptance_id uuid NOT NULL,
  verified_at timestamptz NOT NULL,
  material_changed_at timestamptz NOT NULL,
  PRIMARY KEY(league_season_id, provider, season, season_type, week, scorer_version),
  FOREIGN KEY(acceptance_id, league_season_id, provider, season, season_type, week, scorer_version)
    REFERENCES public.all_player_league_acceptances
      (id, league_season_id, provider, season, season_type, week, scorer_version)
);
REVOKE ALL ON TABLE public.all_player_league_acceptances, public.current_all_player_league_scores FROM PUBLIC;

-- Keep global-budget mutation owner-only, including successful raw-only captures.
CREATE FUNCTION public.record_all_player_capture(p_fence jsonb, p_observation_id uuid)
RETURNS boolean LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE capture public.all_player_stat_observations%ROWTYPE; period jsonb;
BEGIN
  SELECT * INTO STRICT capture FROM public.all_player_stat_observations WHERE id = p_observation_id;
  period := jsonb_build_object('season',capture.season,'seasonType',capture.season_type,'week',capture.week);
  PERFORM public.assert_all_player_job_fence(p_fence, period, true);
  IF capture.provider <> 'sleeper' OR capture.quality NOT IN ('complete','partial')
    OR NOT EXISTS (SELECT 1 FROM public.all_player_stat_contents content
      WHERE content.id = capture.all_player_stat_content_id AND content.quality = capture.quality
        AND content.entry_count = (SELECT count(*) FROM public.all_player_stat_entries entry
          WHERE entry.all_player_stat_content_id = content.id)) THEN
    RAISE EXCEPTION 'all-player capture is incomplete or invalid';
  END IF;
  UPDATE public.projection_jobs SET payload = payload || jsonb_build_object('lastCapture',
    jsonb_build_object('generation',(p_fence->>'generation')::integer,
      'observationId',p_observation_id,'period',period,'capturedAt',clock_timestamp()))
    WHERE job_key = 'all-player-ingestion:sleeper';
  RETURN true;
END;
$$;
REVOKE ALL ON FUNCTION public.record_all_player_capture(jsonb,uuid) FROM PUBLIC;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'league_one_runtime') THEN
    GRANT EXECUTE ON FUNCTION public.record_all_player_capture(jsonb,uuid) TO league_one_runtime;
  END IF;
END; $$;

CREATE FUNCTION public.accept_all_player_league_score(
  p_fence jsonb, p_stat_observation_id uuid, p_score_set_id uuid,
  p_league_season_id uuid, p_official_observation_id uuid, p_verified_at timestamptz
) RETURNS TABLE(acceptance_id uuid, pointer_outcome text)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  candidate record;
  binding record;
  official record;
  physical record;
  roster_physical record;
  prior record;
  accepted_id uuid;
  result text;
  period jsonb;
BEGIN
  SELECT observation.observed_at, observation.source_revision,
    observation.quality AS observation_quality,
    observation.all_player_stat_content_id,
    content.quality AS content_quality, content.coverage AS content_coverage,
    content.entry_count, score_set.*,
    profile.rules AS scoring_rules, profile.rules_hash AS scoring_rules_hash
  INTO STRICT candidate
  FROM public.all_player_stat_observations observation
  JOIN public.all_player_stat_contents content ON content.id = observation.all_player_stat_content_id
  JOIN public.all_player_score_sets score_set
    ON score_set.id = p_score_set_id AND score_set.all_player_stat_content_id = content.id
    AND score_set.provider = observation.provider AND score_set.season = observation.season
    AND score_set.season_type = observation.season_type AND score_set.week = observation.week
  JOIN public.scoring_profiles profile ON profile.id = score_set.scoring_profile_id
  WHERE observation.id = p_stat_observation_id;
  period := jsonb_build_object('season', candidate.season, 'seasonType', candidate.season_type,
    'week', candidate.week);
  PERFORM public.assert_all_player_job_fence(p_fence, period, true);
  IF candidate.provider <> 'sleeper' OR candidate.season < 2026 OR candidate.season_type <> 'reg'
    OR p_verified_at IS NULL OR p_verified_at < candidate.observed_at
    OR p_verified_at > clock_timestamp() + interval '30 seconds' THEN
    RAISE EXCEPTION 'invalid league acceptance period or verification time';
  END IF;
  IF candidate.observation_quality <> 'complete'
    OR candidate.content_quality <> 'complete'
    OR NOT candidate.content_coverage @> '{"complete":true}'::jsonb
    OR candidate.content_coverage->>'expectedInventoryFingerprint' IS NULL
    OR candidate.content_coverage->>'expectedInventoryFingerprint' !~ '^sha256:[0-9a-f]{64}$'
    OR btrim(COALESCE(candidate.content_coverage->>'catalogRevision', '')) = ''
    OR btrim(COALESCE(candidate.content_coverage->>'scheduleRevision', '')) = ''
    OR COALESCE(candidate.content_coverage->>'rosterInventoryFingerprint', '')
      !~ '^sha256:[0-9a-f]{64}$'
    OR COALESCE(candidate.content_coverage->>'projectionInventoryFingerprint', '')
      !~ '^sha256:[0-9a-f]{64}$'
    OR COALESCE(candidate.content_coverage->>'byeInventoryFingerprint', '')
      !~ '^sha256:[0-9a-f]{64}$'
    OR jsonb_typeof(candidate.content_coverage->'expectedEntityCount') IS DISTINCT FROM 'number'
    OR jsonb_typeof(candidate.content_coverage->'expectedPlayerCount') IS DISTINCT FROM 'number'
    OR jsonb_typeof(candidate.content_coverage->'providerPresentEntityCount') IS DISTINCT FROM 'number'
    OR jsonb_typeof(candidate.content_coverage->'providerMissingEntityCount') IS DISTINCT FROM 'number'
    OR candidate.content_coverage->>'expectedTeamDefenseCount' IS DISTINCT FROM '32'
    OR candidate.content_coverage->>'expectedEntityCount' IS DISTINCT FROM candidate.entry_count::text
    OR candidate.content_coverage->>'fantasyEntityCount' IS DISTINCT FROM candidate.entry_count::text
    OR candidate.content_coverage->>'unknownEligibilityCount' IS DISTINCT FROM '0'
    OR candidate.content_coverage->>'unmappedGameCount' IS DISTINCT FROM '0'
    OR candidate.content_coverage->>'unexpectedResponseEntityCount' IS DISTINCT FROM '0'
    OR (candidate.content_coverage->>'providerPresentEntityCount')::integer
      + (candidate.content_coverage->>'providerMissingEntityCount')::integer
      <> candidate.entry_count
    OR candidate.quality <> 'complete' OR candidate.parity_comparison_count <> 0
    OR candidate.parity_mismatch_count <> 0
    OR candidate.coverage IS DISTINCT FROM (candidate.content_coverage || jsonb_build_object(
      'complete', true, 'identity_complete', true, 'scoring_rules_complete', true,
      'scoring_rules_hash', candidate.scoring_rules_hash,
      'material_contract', 'all-player-score-content-v2'))
    OR public.all_player_scoring_contract_supported(candidate.provider, candidate.scorer_version,
      candidate.scoring_rules) IS DISTINCT FROM true
    OR candidate.entry_count <> (SELECT count(*) FROM public.all_player_stat_entries
      WHERE all_player_stat_content_id = candidate.all_player_stat_content_id)
    OR 32 <> (SELECT count(*) FROM public.all_player_stat_entries
      WHERE all_player_stat_content_id = candidate.all_player_stat_content_id AND entity_kind = 'team_defense')
    OR (candidate.content_coverage->>'expectedPlayerCount')::integer <> (
      SELECT count(*) FROM public.all_player_stat_entries
      WHERE all_player_stat_content_id = candidate.all_player_stat_content_id AND entity_kind = 'player')
    OR candidate.scored_entity_count <> candidate.entry_count
    OR candidate.scored_entity_count <> (SELECT count(*) FROM public.all_player_scores
      WHERE all_player_score_set_id = candidate.id)
    OR candidate.eligible_game_count <> (SELECT COALESCE(sum(eligible_game_count), 0)
      FROM public.all_player_scores WHERE all_player_score_set_id = candidate.id)
    OR EXISTS (SELECT 1 FROM public.all_player_scores score
      WHERE score.all_player_score_set_id = candidate.id
        AND (score.eligible_game_count IS NULL OR score.appearance_game_count IS NULL
          OR (score.eligible_game_count = 1 AND score.nfl_game_id IS NULL)
          OR NOT EXISTS (SELECT 1 FROM public.external_scoring_entity_ids mapping
            JOIN public.scoring_entities entity ON entity.id = mapping.scoring_entity_id
              AND entity.kind = score.entity_kind
            WHERE mapping.provider = candidate.provider AND mapping.entity_kind = score.entity_kind
              AND mapping.external_id = score.provider_external_id
              AND mapping.scoring_entity_id = score.scoring_entity_id
              AND mapping.mapping_status = 'verified' AND mapping.valid_from <= clock_timestamp()
              AND (mapping.valid_to IS NULL OR mapping.valid_to > clock_timestamp())))) THEN
    RAISE EXCEPTION 'shared all-player content is not acceptance eligible';
  END IF;

  -- Only the target registration is locked and required; peer registration cannot veto acceptance.
  SELECT connection.external_league_id, authority.expected_roster_count,
    (SELECT jsonb_agg(roster_id ORDER BY roster_id)
      FROM unnest(authority.expected_roster_ids) roster_id) AS expected_roster_ids
  INTO STRICT binding
  FROM public.league_seasons season
  JOIN public.leagues league ON league.id = season.league_id
  JOIN public.league_source_connections connection ON connection.league_season_id = season.id
    AND connection.provider = candidate.provider
  JOIN public.league_administration_enrollment_seasons enrollment
    ON enrollment.league_id = season.league_id AND enrollment.season = season.season
      AND enrollment.provider = candidate.provider
  JOIN public.league_period_authorities authority ON authority.league_key = league.league_key
    AND authority.source_provider = candidate.provider
    AND authority.source_external_league_id = connection.external_league_id
    AND authority.default_season = candidate.season
  WHERE season.id = p_league_season_id AND season.season = candidate.season
    AND season.scoring_profile_id = candidate.scoring_profile_id
  FOR SHARE OF season, connection, enrollment, authority;
  SELECT observation.*, observation.source_data->'officialPlayersPointsEvidence' AS evidence
  INTO STRICT official FROM public.league_week_observations observation
  WHERE observation.id = p_official_observation_id
    AND observation.league_season_id = p_league_season_id
    AND observation.provider = candidate.provider AND observation.week = candidate.week
    AND observation.quality = 'complete'
    AND observation.source_data->>'allPlayerSourceRevision' = candidate.source_revision
  FOR UPDATE OF observation;

  SELECT count(points.*)::integer AS player_count,
    count(points.points)::integer AS nonnull_count,
    count(score.provider_external_id)::integer AS mapped_count,
    count(DISTINCT points.scoring_entity_id)::integer AS unique_count,
    count(DISTINCT points.external_roster_id)::integer AS roster_count,
    count(*) FILTER (WHERE score.scoring_entity_id IS NULL
      OR abs(score.fantasy_points - points.points) > 0.0001)::integer AS mismatch_count,
    ('sha256:' || encode(digest(convert_to(COALESCE(string_agg(
      score.provider_external_id || chr(31) || points.points::text,
      chr(10) ORDER BY score.provider_external_id), ''), 'UTF8'), 'sha256'), 'hex')) AS fingerprint
  INTO physical FROM public.official_player_point_observations points
  LEFT JOIN public.all_player_scores score ON score.all_player_score_set_id = candidate.id
    AND score.scoring_entity_id = points.scoring_entity_id
  WHERE points.league_week_observation_id = official.id;
  SELECT count(*)::integer AS roster_count,
    COALESCE(jsonb_agg(external_roster_id ORDER BY external_roster_id), '[]'::jsonb) AS roster_ids
  INTO roster_physical FROM public.official_roster_point_observations
  WHERE league_week_observation_id = official.id;
  IF jsonb_typeof(official.evidence) IS DISTINCT FROM 'object'
    OR official.evidence->>'version' IS DISTINCT FROM 'players-points-v1'
    OR official.evidence->>'expectedEntityCount' IS DISTINCT FROM physical.player_count::text
    OR official.evidence->>'expectedRosterCount' IS DISTINCT FROM binding.expected_roster_count::text
    OR official.evidence->'expectedRosterIds' IS DISTINCT FROM binding.expected_roster_ids
    OR official.evidence->>'fingerprint' IS DISTINCT FROM physical.fingerprint
    OR physical.player_count = 0 OR physical.player_count <> physical.nonnull_count
    OR physical.player_count <> physical.mapped_count OR physical.player_count <> physical.unique_count
    OR physical.roster_count <> binding.expected_roster_count
    OR physical.mismatch_count <> 0
    OR roster_physical.roster_count <> binding.expected_roster_count
    OR roster_physical.roster_ids IS DISTINCT FROM binding.expected_roster_ids
    OR EXISTS (SELECT 1 FROM public.official_player_point_observations point
      WHERE point.league_week_observation_id = official.id AND NOT EXISTS (
        SELECT 1 FROM public.official_roster_point_observations roster
        WHERE roster.league_week_observation_id = official.id
          AND roster.external_roster_id = point.external_roster_id)) THEN
    RAISE EXCEPTION 'league all-player parity is incomplete or mismatched';
  END IF;

  SELECT pointer.*, acceptance.observed_at, acceptance.all_player_stat_observation_id,
    acceptance.all_player_score_set_id INTO prior
  FROM public.current_all_player_league_scores pointer
  JOIN public.all_player_league_acceptances acceptance ON acceptance.id = pointer.acceptance_id
  WHERE pointer.league_season_id = p_league_season_id AND pointer.provider = candidate.provider
    AND pointer.season = candidate.season AND pointer.season_type = candidate.season_type
    AND pointer.week = candidate.week AND pointer.scorer_version = candidate.scorer_version
  FOR UPDATE OF pointer;
  IF FOUND AND candidate.observed_at = prior.observed_at
    AND (p_stat_observation_id <> prior.all_player_stat_observation_id
      OR p_score_set_id <> prior.all_player_score_set_id) THEN
    RAISE EXCEPTION 'league pointer conflict at equal observation time';
  END IF;
  result := CASE WHEN prior.acceptance_id IS NULL THEN 'advanced'
    WHEN candidate.observed_at < prior.observed_at THEN 'superseded'
    WHEN p_score_set_id = prior.all_player_score_set_id THEN 'verified' ELSE 'advanced' END;
  PERFORM public.assert_all_player_job_fence(p_fence, period, true);
  INSERT INTO public.all_player_league_acceptances (
    league_season_id, provider, season, season_type, week, scoring_profile_id, scorer_version,
    all_player_stat_observation_id, all_player_stat_content_id, all_player_score_set_id,
    official_observation_id, parity_evidence, source_external_league_id, fence_generation,
    observed_at, verified_at
  ) VALUES (p_league_season_id, candidate.provider, candidate.season, candidate.season_type,
    candidate.week, candidate.scoring_profile_id, candidate.scorer_version, p_stat_observation_id,
    candidate.all_player_stat_content_id, p_score_set_id, p_official_observation_id,
    official.evidence, binding.external_league_id, (p_fence->>'generation')::integer,
    candidate.observed_at, p_verified_at)
  ON CONFLICT DO NOTHING RETURNING id INTO accepted_id;
  IF accepted_id IS NULL THEN
    SELECT id INTO STRICT accepted_id FROM public.all_player_league_acceptances
    WHERE league_season_id = p_league_season_id AND all_player_stat_observation_id = p_stat_observation_id
      AND all_player_score_set_id = p_score_set_id AND official_observation_id = p_official_observation_id
      AND fence_generation = (p_fence->>'generation')::integer;
  END IF;
  IF result <> 'superseded' THEN
    INSERT INTO public.current_all_player_league_scores AS target (
      league_season_id, provider, season, season_type, week, scorer_version, acceptance_id,
      verified_at, material_changed_at
    ) VALUES (p_league_season_id, candidate.provider, candidate.season, candidate.season_type,
      candidate.week, candidate.scorer_version, accepted_id, p_verified_at, p_verified_at)
    ON CONFLICT (league_season_id, provider, season, season_type, week, scorer_version)
    DO UPDATE SET acceptance_id = EXCLUDED.acceptance_id,
      verified_at = GREATEST(target.verified_at, EXCLUDED.verified_at),
      material_changed_at = CASE WHEN result = 'verified' THEN target.material_changed_at
        ELSE EXCLUDED.material_changed_at END;
  END IF;
  PERFORM public.assert_all_player_job_fence(p_fence, period, true);
  RETURN QUERY SELECT accepted_id, result;
END;
$$;
REVOKE ALL ON FUNCTION public.accept_all_player_league_score(jsonb,uuid,uuid,uuid,uuid,timestamptz) FROM PUBLIC;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'league_one_runtime') THEN
    GRANT SELECT ON public.all_player_league_acceptances, public.current_all_player_league_scores TO league_one_runtime;
    GRANT EXECUTE ON FUNCTION public.accept_all_player_league_score(jsonb,uuid,uuid,uuid,uuid,timestamptz) TO league_one_runtime;
  END IF;
END; $$;

CREATE OR REPLACE FUNCTION public.guard_all_player_child_insert()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE expected_count integer; existing jsonb;
BEGIN
  IF TG_TABLE_NAME = 'all_player_stat_entries' THEN
    SELECT entry_count INTO STRICT expected_count FROM public.all_player_stat_contents
      WHERE id = NEW.all_player_stat_content_id FOR UPDATE;
    SELECT to_jsonb(entry) - 'created_at' INTO existing FROM public.all_player_stat_entries entry
      WHERE entry.all_player_stat_content_id = NEW.all_player_stat_content_id
        AND entry.entity_kind = NEW.entity_kind AND entry.provider_external_id = NEW.provider_external_id;
    IF existing = to_jsonb(NEW) - 'created_at' THEN RETURN NEW; END IF;
    IF NEW.ordinal >= expected_count OR EXISTS (
      SELECT 1 FROM public.all_player_stat_observations observation
        WHERE observation.all_player_stat_content_id = NEW.all_player_stat_content_id
    ) THEN RAISE EXCEPTION 'all-player raw child history is sealed'; END IF;
  ELSE
    SELECT scored_entity_count INTO STRICT expected_count FROM public.all_player_score_sets
      WHERE id = NEW.all_player_score_set_id FOR UPDATE;
    SELECT to_jsonb(score) - 'created_at' INTO existing FROM public.all_player_scores score
      WHERE score.all_player_score_set_id = NEW.all_player_score_set_id
        AND score.scoring_entity_id = NEW.scoring_entity_id;
    IF existing = to_jsonb(NEW) - 'created_at' THEN RETURN NEW; END IF;
    IF NEW.ordinal >= expected_count OR EXISTS (
      SELECT 1 FROM public.all_player_score_verifications verification
        WHERE verification.all_player_score_set_id = NEW.all_player_score_set_id
    ) OR EXISTS (
      SELECT 1 FROM public.current_all_player_score_sets pointer
        WHERE pointer.all_player_score_set_id = NEW.all_player_score_set_id
    ) OR EXISTS (SELECT 1 FROM public.all_player_league_acceptances acceptance
      WHERE acceptance.all_player_score_set_id = NEW.all_player_score_set_id
    ) THEN RAISE EXCEPTION 'all-player score child history is sealed'; END IF;
  END IF;
  IF existing IS NOT NULL THEN RAISE EXCEPTION 'all-player child replay conflicts'; END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.guard_all_player_child_insert() FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.prevent_all_player_parity_evidence_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  observation_id uuid;
BEGIN
  IF TG_OP = 'INSERT' THEN
    observation_id := (to_jsonb(NEW)->>'league_week_observation_id')::uuid;
  ELSE
    observation_id := COALESCE(
      (to_jsonb(OLD)->>'id')::uuid,
      (to_jsonb(OLD)->>'league_week_observation_id')::uuid
    );
  END IF;
  IF TG_TABLE_NAME <> 'league_week_observations' THEN
    PERFORM 1 FROM public.league_week_observations WHERE id = observation_id FOR UPDATE;
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.all_player_score_sets score_set
    WHERE score_set.coverage->'parity_observation_ids' ? observation_id::text
  ) OR EXISTS (SELECT 1 FROM public.all_player_score_verifications verification
    WHERE verification.coverage->'parity_observation_ids' ? observation_id::text
  ) OR EXISTS (SELECT 1 FROM public.all_player_league_acceptances acceptance
    WHERE acceptance.official_observation_id = observation_id
  ) THEN
    IF TG_OP = 'INSERT' THEN
      IF TG_TABLE_NAME = 'official_player_point_observations' THEN
        IF EXISTS (
          SELECT 1 FROM public.official_player_point_observations existing
          WHERE existing.league_week_observation_id = NEW.league_week_observation_id
            AND existing.external_roster_id = NEW.external_roster_id
            AND existing.scoring_entity_id = NEW.scoring_entity_id
            AND existing.points IS NOT DISTINCT FROM NEW.points
            AND existing.is_starter = NEW.is_starter
            AND existing.lineup_slot IS NOT DISTINCT FROM NEW.lineup_slot
        ) THEN RETURN NEW; END IF;
      ELSIF TG_TABLE_NAME = 'official_roster_point_observations' THEN
        IF EXISTS (
          SELECT 1 FROM public.official_roster_point_observations existing
          WHERE existing.league_week_observation_id = NEW.league_week_observation_id
            AND existing.external_roster_id = NEW.external_roster_id
            AND existing.points IS NOT DISTINCT FROM NEW.points
        ) THEN RETURN NEW; END IF;
      END IF;
    END IF;
    RAISE EXCEPTION 'official all-player parity evidence is immutable while referenced';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;

