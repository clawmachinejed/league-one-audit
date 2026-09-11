-- Immutable all-player weekly statistics and per-profile scoring foundation.
--
-- This migration is intentionally additive. Retrieval and backfill activation are
-- separate release stages; applying the schema does not call a provider or move a
-- current pointer.

CREATE TABLE IF NOT EXISTS public.all_player_stat_contents (
  id uuid PRIMARY KEY,
  provider text NOT NULL,
  season smallint NOT NULL CHECK (season BETWEEN 1920 AND 2200),
  season_type text NOT NULL CHECK (season_type IN ('pre', 'reg', 'post')),
  week smallint NOT NULL CHECK (week BETWEEN 1 AND 18),
  normalizer_version text NOT NULL,
  semantic_hash text NOT NULL CHECK (semantic_hash ~ '^[0-9a-f]{64}$'),
  quality text NOT NULL CHECK (quality IN ('complete', 'partial', 'invalid')),
  coverage jsonb NOT NULL CHECK (jsonb_typeof(coverage) = 'object'),
  warnings jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(warnings) = 'array'),
  entry_count integer NOT NULL CHECK (entry_count > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider, season, season_type, week, normalizer_version, semantic_hash),
  UNIQUE (id, provider, season, season_type, week, normalizer_version)
);

CREATE TABLE IF NOT EXISTS public.all_player_stat_entries (
  all_player_stat_content_id uuid NOT NULL
    REFERENCES public.all_player_stat_contents(id),
  entity_kind text NOT NULL CHECK (entity_kind IN ('player', 'team_defense')),
  provider_external_id text NOT NULL,
  nfl_game_id uuid REFERENCES public.nfl_games(id),
  nfl_team text,
  position text NOT NULL CHECK (position IN ('QB', 'RB', 'WR', 'TE', 'K', 'DEF')),
  stats jsonb NOT NULL CHECK (jsonb_typeof(stats) = 'object'),
  eligibility_evidence jsonb NOT NULL CHECK (
    jsonb_typeof(eligibility_evidence) = 'object' AND eligibility_evidence <> '{}'::jsonb
  ),
  eligible_game_count smallint CHECK (eligible_game_count BETWEEN 0 AND 1),
  appearance_game_count smallint CHECK (appearance_game_count BETWEEN 0 AND 1),
  game_phase text NOT NULL CHECK (game_phase IN ('live', 'final', 'unknown')),
  ordinal integer NOT NULL CHECK (ordinal >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (all_player_stat_content_id, entity_kind, provider_external_id),
  UNIQUE (all_player_stat_content_id, ordinal),
  CHECK (
    (eligible_game_count IS NULL AND appearance_game_count IS NULL)
    OR (eligible_game_count IS NOT NULL AND appearance_game_count IS NOT NULL
      AND appearance_game_count <= eligible_game_count)
  ),
  CHECK (
    (entity_kind = 'team_defense' AND position = 'DEF')
    OR (entity_kind = 'player' AND position IN ('QB', 'RB', 'WR', 'TE', 'K'))
  )
);

CREATE INDEX IF NOT EXISTS all_player_stat_entries_game_idx
  ON public.all_player_stat_entries (nfl_game_id, all_player_stat_content_id);

CREATE FUNCTION public.all_player_eligibility_evidence_matches(
  p_evidence jsonb,
  p_eligible_game_count smallint,
  p_appearance_game_count smallint
)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  evidence_kind text;
  active_count smallint;
  appearance_count smallint;
BEGIN
  IF jsonb_typeof(p_evidence) IS DISTINCT FROM 'object' THEN RETURN false; END IF;
  evidence_kind := p_evidence->>'kind';
  IF evidence_kind = 'weekly-stat' THEN
    IF p_evidence - ARRAY['kind', 'source', 'gmsActive', 'appearances'] <> '{}'::jsonb
      OR p_evidence->>'source' IS DISTINCT FROM 'weekly-stat-provider'
      OR (p_evidence ? 'gmsActive' AND (
        jsonb_typeof(p_evidence->'gmsActive') IS DISTINCT FROM 'number'
        OR p_evidence->>'gmsActive' NOT IN ('0', '1')
      ))
      OR (p_evidence ? 'appearances' AND (
        jsonb_typeof(p_evidence->'appearances') IS DISTINCT FROM 'number'
        OR p_evidence->>'appearances' NOT IN ('0', '1')
      )) THEN RETURN false; END IF;
    active_count := CASE WHEN p_evidence ? 'gmsActive'
      THEN (p_evidence->>'gmsActive')::smallint ELSE NULL END;
    appearance_count := CASE WHEN p_evidence ? 'appearances'
      THEN (p_evidence->>'appearances')::smallint ELSE NULL END;
    IF active_count = 0 AND COALESCE(appearance_count, 0) = 0 THEN
      RETURN COALESCE(p_eligible_game_count = 0 AND p_appearance_game_count = 0, false);
    ELSIF active_count = 1 THEN
      RETURN COALESCE(p_eligible_game_count = 1
        AND p_appearance_game_count = COALESCE(appearance_count, 0), false);
    ELSIF active_count IS NULL AND appearance_count = 1 THEN
      RETURN COALESCE(p_eligible_game_count = 1 AND p_appearance_game_count = 1, false);
    END IF;
    RETURN p_eligible_game_count IS NULL AND p_appearance_game_count IS NULL;
  ELSIF evidence_kind = 'explicit-ineligible' THEN
    RETURN COALESCE(
      p_evidence - ARRAY['kind', 'reason', 'source', 'sourceRevision'] = '{}'::jsonb
      AND p_evidence->>'reason' IN ('inactive', 'suspended', 'reserve', 'bye', 'teamless', 'other')
      AND p_evidence->>'source' IN ('player-status-provider', 'schedule', 'manual-review')
      AND btrim(COALESCE(p_evidence->>'sourceRevision', '')) <> ''
      AND p_eligible_game_count = 0 AND p_appearance_game_count = 0,
      false
    );
  ELSIF evidence_kind IN ('combined-ineligible', 'conflict') THEN
    IF p_evidence - ARRAY['kind', 'weekly', 'ineligibility'] <> '{}'::jsonb
      OR public.all_player_eligibility_evidence_matches(
        p_evidence->'ineligibility', 0::smallint, 0::smallint
      ) IS DISTINCT FROM true THEN RETURN false; END IF;
    IF evidence_kind = 'combined-ineligible' THEN
      RETURN COALESCE((
        public.all_player_eligibility_evidence_matches(
          p_evidence->'weekly', 0::smallint, 0::smallint
        ) OR public.all_player_eligibility_evidence_matches(
          p_evidence->'weekly', NULL::smallint, NULL::smallint
        )
      ) AND p_eligible_game_count = 0 AND p_appearance_game_count = 0, false);
    END IF;
    RETURN COALESCE((
      public.all_player_eligibility_evidence_matches(
        p_evidence->'weekly', 1::smallint, 0::smallint
      ) OR public.all_player_eligibility_evidence_matches(
        p_evidence->'weekly', 1::smallint, 1::smallint
      )
    ) AND p_eligible_game_count IS NULL AND p_appearance_game_count IS NULL, false);
  ELSIF evidence_kind = 'missing-provider-row' THEN
    RETURN p_evidence - ARRAY['kind', 'inventoryFingerprint'] = '{}'::jsonb
      AND COALESCE(p_evidence->>'inventoryFingerprint', '') ~ '^sha256:[0-9a-f]{64}$'
      AND p_eligible_game_count IS NULL AND p_appearance_game_count IS NULL;
  ELSIF evidence_kind = 'unknown-weekly-stat' THEN
    RETURN p_evidence = '{"kind":"unknown-weekly-stat","source":"weekly-stat-provider"}'::jsonb
      AND p_eligible_game_count IS NULL AND p_appearance_game_count IS NULL;
  END IF;
  RETURN false;
END;
$$;
REVOKE ALL ON FUNCTION public.all_player_eligibility_evidence_matches(
  jsonb, smallint, smallint
) FROM PUBLIC;

CREATE FUNCTION public.validate_all_player_stat_entry()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  content_context record;
  game_context record;
BEGIN
  IF public.all_player_eligibility_evidence_matches(
    NEW.eligibility_evidence, NEW.eligible_game_count, NEW.appearance_game_count
  ) IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'all-player eligibility evidence does not support its counts';
  END IF;
  SELECT season, season_type, week INTO STRICT content_context
  FROM public.all_player_stat_contents WHERE id = NEW.all_player_stat_content_id;
  IF NEW.eligible_game_count = 1 AND NEW.nfl_game_id IS NULL THEN
    RAISE EXCEPTION 'eligible all-player entry requires an NFL game';
  END IF;
  IF NEW.nfl_game_id IS NOT NULL THEN
    SELECT season, season_type, week, home_team, away_team INTO STRICT game_context
    FROM public.nfl_games WHERE id = NEW.nfl_game_id;
    IF NEW.nfl_team IS NULL
      OR game_context.season <> content_context.season
      OR game_context.season_type <> content_context.season_type
      OR game_context.week <> content_context.week
      OR NEW.nfl_team NOT IN (game_context.home_team, game_context.away_team) THEN
      RAISE EXCEPTION 'all-player NFL game does not match its content period and team';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.validate_all_player_stat_entry() FROM PUBLIC;
CREATE TRIGGER all_player_stat_entries_evidence_guard
  BEFORE INSERT ON public.all_player_stat_entries
  FOR EACH ROW EXECUTE FUNCTION public.validate_all_player_stat_entry();

CREATE TABLE IF NOT EXISTS public.all_player_stat_observations (
  id uuid PRIMARY KEY,
  all_player_stat_content_id uuid NOT NULL,
  provider text NOT NULL,
  season smallint NOT NULL CHECK (season BETWEEN 1920 AND 2200),
  season_type text NOT NULL CHECK (season_type IN ('pre', 'reg', 'post')),
  week smallint NOT NULL CHECK (week BETWEEN 1 AND 18),
  normalizer_version text NOT NULL,
  source_revision text NOT NULL,
  request_started_at timestamptz NOT NULL,
  request_completed_at timestamptz NOT NULL,
  observed_at timestamptz NOT NULL,
  quality text NOT NULL CHECK (quality IN ('complete', 'partial', 'invalid')),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (request_completed_at >= request_started_at),
  FOREIGN KEY (
    all_player_stat_content_id, provider, season, season_type, week, normalizer_version
  ) REFERENCES public.all_player_stat_contents(
    id, provider, season, season_type, week, normalizer_version
  ),
  UNIQUE (
    provider, season, season_type, week, normalizer_version, source_revision, observed_at
  ),
  UNIQUE (
    id, all_player_stat_content_id, provider, season, season_type, week, normalizer_version
  )
);

CREATE INDEX IF NOT EXISTS all_player_stat_observations_period_idx
  ON public.all_player_stat_observations
  (provider, season, season_type, week, normalizer_version, observed_at DESC);

CREATE TABLE IF NOT EXISTS public.all_player_score_sets (
  id uuid PRIMARY KEY,
  all_player_stat_content_id uuid NOT NULL
    REFERENCES public.all_player_stat_contents(id),
  provider text NOT NULL,
  season smallint NOT NULL CHECK (season BETWEEN 1920 AND 2200),
  season_type text NOT NULL CHECK (season_type IN ('pre', 'reg', 'post')),
  week smallint NOT NULL CHECK (week BETWEEN 1 AND 18),
  scoring_profile_id uuid NOT NULL REFERENCES public.scoring_profiles(id),
  scorer_version text NOT NULL,
  semantic_hash text NOT NULL CHECK (semantic_hash ~ '^[0-9a-f]{64}$'),
  quality text NOT NULL CHECK (quality IN ('complete', 'partial', 'invalid')),
  scored_entity_count integer NOT NULL CHECK (scored_entity_count >= 0),
  eligible_game_count integer NOT NULL CHECK (eligible_game_count >= 0),
  parity_comparison_count integer NOT NULL CHECK (parity_comparison_count >= 0),
  parity_mismatch_count integer NOT NULL CHECK (
    parity_mismatch_count >= 0 AND parity_mismatch_count <= parity_comparison_count
  ),
  coverage jsonb NOT NULL CHECK (jsonb_typeof(coverage) = 'object'),
  warnings jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(warnings) = 'array'),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (
    all_player_stat_content_id, scoring_profile_id, scorer_version, semantic_hash
  ),
  UNIQUE (id, all_player_stat_content_id),
  UNIQUE (
    id, all_player_stat_content_id, provider, season, season_type, week,
    scoring_profile_id, scorer_version
  )
);

CREATE INDEX IF NOT EXISTS all_player_score_sets_period_idx
  ON public.all_player_score_sets
  (provider, season, season_type, week, scoring_profile_id, scorer_version, created_at DESC);

CREATE TABLE IF NOT EXISTS public.all_player_scores (
  all_player_score_set_id uuid NOT NULL,
  all_player_stat_content_id uuid NOT NULL,
  scoring_entity_id uuid NOT NULL REFERENCES public.scoring_entities(id),
  entity_kind text NOT NULL CHECK (entity_kind IN ('player', 'team_defense')),
  provider_external_id text NOT NULL,
  nfl_game_id uuid REFERENCES public.nfl_games(id),
  nfl_team text,
  position text NOT NULL CHECK (position IN ('QB', 'RB', 'WR', 'TE', 'K', 'DEF')),
  fantasy_points numeric(14, 4) NOT NULL,
  eligible_game_count smallint NOT NULL CHECK (eligible_game_count BETWEEN 0 AND 1),
  appearance_game_count smallint CHECK (appearance_game_count BETWEEN 0 AND 1),
  game_phase text NOT NULL CHECK (game_phase IN ('live', 'final', 'unknown')),
  scoring_breakdown jsonb NOT NULL CHECK (jsonb_typeof(scoring_breakdown) = 'object'),
  ordinal integer NOT NULL CHECK (ordinal >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (all_player_score_set_id, scoring_entity_id),
  UNIQUE (all_player_score_set_id, ordinal),
  FOREIGN KEY (all_player_score_set_id, all_player_stat_content_id)
    REFERENCES public.all_player_score_sets(id, all_player_stat_content_id),
  FOREIGN KEY (all_player_stat_content_id, entity_kind, provider_external_id)
    REFERENCES public.all_player_stat_entries(
      all_player_stat_content_id, entity_kind, provider_external_id
    ),
  CHECK (appearance_game_count IS NULL OR appearance_game_count <= eligible_game_count),
  CHECK (eligible_game_count <> 0 OR fantasy_points = 0),
  CHECK (appearance_game_count IS DISTINCT FROM 0 OR fantasy_points = 0),
  CHECK (
    (entity_kind = 'team_defense' AND position = 'DEF')
    OR (entity_kind = 'player' AND position IN ('QB', 'RB', 'WR', 'TE', 'K'))
  )
);

CREATE INDEX IF NOT EXISTS all_player_scores_weekly_read_idx
  ON public.all_player_scores (scoring_entity_id, all_player_score_set_id);
CREATE INDEX IF NOT EXISTS all_player_scores_position_read_idx
  ON public.all_player_scores (position, fantasy_points DESC, scoring_entity_id);

CREATE FUNCTION public.all_player_scoring_contract_supported(
  p_provider text,
  p_scorer_version text,
  p_rules jsonb
)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = pg_catalog, public, pg_temp
AS $$
  SELECT p_provider = 'sleeper'
    AND p_scorer_version = 'sleeper-actual-v1'
    AND jsonb_typeof(p_rules) = 'object'
    AND EXISTS (
      SELECT 1 FROM jsonb_each(p_rules) rule
      WHERE jsonb_typeof(rule.value) = 'number'
        AND (rule.value #>> '{}')::numeric <> 0
    )
    AND NOT EXISTS (
      SELECT 1 FROM jsonb_each(p_rules) rule
      WHERE jsonb_typeof(rule.value) IS DISTINCT FROM 'number'
        OR ((rule.value #>> '{}')::numeric <> 0 AND rule.key <> ALL (ARRAY[
          'pass_yd', 'pass_td', 'pass_int', 'rush_yd', 'rush_td', 'rec', 'rec_yd',
          'rec_td', 'pass_2pt', 'rush_2pt', 'rec_2pt', 'fum_lost', 'sack', 'int',
          'def_st_fum_rec', 'def_td', 'def_st_td', 'safe', 'blk_kick', 'pts_allow_0',
          'pts_allow_1_6', 'pts_allow_7_13', 'pts_allow_14_20', 'pts_allow_21_27',
          'pts_allow_28_34', 'pts_allow_35p', 'fgm', 'fgmiss', 'xpm', 'xpmiss',
          'pass_td_40p', 'rush_td_40p', 'rec_td_40p', 'fum_rec', 'fum_rec_td',
          'st_td', 'def_2pt', 'def_3_and_out', 'def_4_and_stop', 'fgm_yds_over_30'
        ]::text[]))
    )
$$;
REVOKE ALL ON FUNCTION public.all_player_scoring_contract_supported(
  text, text, jsonb
) FROM PUBLIC;

CREATE FUNCTION public.validate_all_player_score_lineage()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  score_provider text;
  score_scorer_version text;
  score_rules jsonb;
  breakdown_total numeric;
  raw_entry public.all_player_stat_entries%ROWTYPE;
BEGIN
  SELECT score_set.provider, score_set.scorer_version, profile.rules
  INTO STRICT score_provider, score_scorer_version, score_rules
  FROM public.all_player_score_sets score_set
  JOIN public.scoring_profiles profile ON profile.id = score_set.scoring_profile_id
  WHERE score_set.id = NEW.all_player_score_set_id
    AND score_set.all_player_stat_content_id = NEW.all_player_stat_content_id;

  SELECT entry.* INTO STRICT raw_entry
  FROM public.all_player_stat_entries entry
  WHERE entry.all_player_stat_content_id = NEW.all_player_stat_content_id
    AND entry.entity_kind = NEW.entity_kind
    AND entry.provider_external_id = NEW.provider_external_id;

  IF raw_entry.nfl_game_id IS DISTINCT FROM NEW.nfl_game_id
    OR raw_entry.nfl_team IS DISTINCT FROM NEW.nfl_team
    OR raw_entry.position IS DISTINCT FROM NEW.position
    OR raw_entry.eligible_game_count IS DISTINCT FROM NEW.eligible_game_count
    OR raw_entry.appearance_game_count IS DISTINCT FROM NEW.appearance_game_count
    OR raw_entry.game_phase IS DISTINCT FROM NEW.game_phase THEN
    RAISE EXCEPTION 'all-player score lineage does not match its raw stat entry';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.external_scoring_entity_ids mapping
    WHERE mapping.provider = score_provider
      AND mapping.entity_kind = NEW.entity_kind
      AND mapping.external_id = NEW.provider_external_id
      AND mapping.scoring_entity_id = NEW.scoring_entity_id
      AND mapping.mapping_status = 'verified'
  ) THEN
    RAISE EXCEPTION 'all-player score identity is not verified';
  END IF;
  IF NOT public.all_player_scoring_contract_supported(
    score_provider, score_scorer_version, score_rules
  ) THEN
    RAISE EXCEPTION 'all-player scoring profile is unsupported by this scorer contract';
  END IF;
  IF EXISTS (
    SELECT 1 FROM jsonb_each(score_rules) rule
    WHERE (rule.value #>> '{}')::numeric <> 0
      AND NOT (NEW.scoring_breakdown ? rule.key)
  ) THEN
    RAISE EXCEPTION 'all-player scoring breakdown omits an active profile rule';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM jsonb_each(NEW.scoring_breakdown) breakdown
    LEFT JOIN LATERAL (
      SELECT rule.value FROM jsonb_each(score_rules) rule WHERE rule.key = breakdown.key
    ) profile_rule ON true
    WHERE profile_rule.value IS NULL
      OR jsonb_typeof(profile_rule.value) IS DISTINCT FROM 'number'
      OR (profile_rule.value #>> '{}')::numeric = 0
      OR jsonb_typeof(breakdown.value) IS DISTINCT FROM 'object'
      OR jsonb_typeof(breakdown.value->'stat') IS DISTINCT FROM 'number'
      OR jsonb_typeof(breakdown.value->'weight') IS DISTINCT FROM 'number'
      OR jsonb_typeof(breakdown.value->'points') IS DISTINCT FROM 'number'
      OR (raw_entry.stats ? breakdown.key
        AND jsonb_typeof(raw_entry.stats->breakdown.key) IS DISTINCT FROM 'number')
      OR abs((breakdown.value->>'weight')::numeric
        - (profile_rule.value #>> '{}')::numeric) > 0.000001
      OR abs((breakdown.value->>'stat')::numeric
        - COALESCE((raw_entry.stats->>breakdown.key)::numeric, 0)) > 0.000001
      OR abs((breakdown.value->>'points')::numeric
        - (breakdown.value->>'stat')::numeric
          * (breakdown.value->>'weight')::numeric) > 0.000001
  ) THEN
    RAISE EXCEPTION 'all-player scoring breakdown does not match its profile or statistics';
  END IF;
  SELECT COALESCE(sum((breakdown.value->>'points')::numeric), 0)
  INTO breakdown_total
  FROM jsonb_each(NEW.scoring_breakdown) breakdown;
  IF abs(breakdown_total - NEW.fantasy_points) > 0.0001 THEN
    RAISE EXCEPTION 'all-player score does not equal its scoring breakdown';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.validate_all_player_score_lineage() FROM PUBLIC;
CREATE TRIGGER all_player_scores_lineage_guard
  BEFORE INSERT ON public.all_player_scores
  FOR EACH ROW EXECUTE FUNCTION public.validate_all_player_score_lineage();

CREATE TABLE IF NOT EXISTS public.current_all_player_score_sets (
  provider text NOT NULL,
  season smallint NOT NULL CHECK (season BETWEEN 1920 AND 2200),
  season_type text NOT NULL CHECK (season_type IN ('pre', 'reg', 'post')),
  week smallint NOT NULL CHECK (week BETWEEN 1 AND 18),
  scoring_profile_id uuid NOT NULL REFERENCES public.scoring_profiles(id),
  scorer_version text NOT NULL,
  all_player_stat_observation_id uuid NOT NULL,
  all_player_score_set_id uuid NOT NULL,
  observed_at timestamptz NOT NULL,
  verified_at timestamptz NOT NULL,
  material_changed_at timestamptz NOT NULL,
  PRIMARY KEY (
    provider, season, season_type, week, scoring_profile_id, scorer_version
  ),
  FOREIGN KEY (all_player_stat_observation_id) REFERENCES public.all_player_stat_observations(id),
  FOREIGN KEY (all_player_score_set_id) REFERENCES public.all_player_score_sets(id),
  CHECK (verified_at >= observed_at),
  CHECK (material_changed_at <= verified_at)
);

CREATE FUNCTION public.prevent_all_player_history_change()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
  RAISE EXCEPTION '% history is immutable', TG_TABLE_NAME;
END;
$$;
REVOKE ALL ON FUNCTION public.prevent_all_player_history_change() FROM PUBLIC;

CREATE TRIGGER all_player_stat_contents_immutable
  BEFORE UPDATE OR DELETE ON public.all_player_stat_contents
  FOR EACH ROW EXECUTE FUNCTION public.prevent_all_player_history_change();
CREATE TRIGGER all_player_stat_entries_immutable
  BEFORE UPDATE OR DELETE ON public.all_player_stat_entries
  FOR EACH ROW EXECUTE FUNCTION public.prevent_all_player_history_change();
CREATE TRIGGER all_player_stat_observations_immutable
  BEFORE UPDATE OR DELETE ON public.all_player_stat_observations
  FOR EACH ROW EXECUTE FUNCTION public.prevent_all_player_history_change();
CREATE TRIGGER all_player_score_sets_immutable
  BEFORE UPDATE OR DELETE ON public.all_player_score_sets
  FOR EACH ROW EXECUTE FUNCTION public.prevent_all_player_history_change();
CREATE TRIGGER all_player_scores_immutable
  BEFORE UPDATE OR DELETE ON public.all_player_scores
  FOR EACH ROW EXECUTE FUNCTION public.prevent_all_player_history_change();

CREATE FUNCTION public.prevent_all_player_parity_evidence_change()
RETURNS trigger
LANGUAGE plpgsql
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
  IF EXISTS (
    SELECT 1 FROM public.all_player_score_sets score_set
    WHERE score_set.coverage->'parity_observation_ids' ? observation_id::text
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
REVOKE ALL ON FUNCTION public.prevent_all_player_parity_evidence_change() FROM PUBLIC;
CREATE TRIGGER league_week_all_player_parity_immutable
  BEFORE UPDATE OR DELETE ON public.league_week_observations
  FOR EACH ROW EXECUTE FUNCTION public.prevent_all_player_parity_evidence_change();
CREATE TRIGGER official_player_all_player_parity_immutable
  BEFORE INSERT OR UPDATE OR DELETE ON public.official_player_point_observations
  FOR EACH ROW EXECUTE FUNCTION public.prevent_all_player_parity_evidence_change();
CREATE TRIGGER official_roster_all_player_parity_immutable
  BEFORE INSERT OR UPDATE OR DELETE ON public.official_roster_point_observations
  FOR EACH ROW EXECUTE FUNCTION public.prevent_all_player_parity_evidence_change();

CREATE FUNCTION public.all_player_score_set_is_publication_ready(
  p_score_set_id uuid,
  p_expected_profile_ids jsonb
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  candidate record;
  provided_observation_count integer;
  expected_observation_count integer;
  matched_observation_count integer;
  matched_league_count integer;
  evidence_mismatch_count integer;
  parity_row_count integer;
  parity_nonnull_count integer;
  parity_entity_count integer;
  parity_conflict_count integer;
  parity_score_mismatch_count integer;
BEGIN
  SELECT score_set.*, content.entry_count, profile.rules AS scoring_rules,
    profile.rules_hash AS scoring_rules_hash
  INTO candidate
  FROM public.all_player_score_sets score_set
  JOIN public.all_player_stat_contents content
    ON content.id = score_set.all_player_stat_content_id
  JOIN public.scoring_profiles profile ON profile.id = score_set.scoring_profile_id
  WHERE score_set.id = p_score_set_id;
  IF NOT FOUND THEN RETURN false; END IF;

  IF candidate.quality <> 'complete'
    OR candidate.scored_entity_count <> candidate.entry_count
    OR candidate.parity_comparison_count = 0
    OR candidate.parity_mismatch_count <> 0
    OR NOT candidate.coverage @> '{"complete":true,"identity_complete":true,"scoring_rules_complete":true}'::jsonb
    OR candidate.coverage->>'scoring_rules_hash' IS DISTINCT FROM candidate.scoring_rules_hash
    OR candidate.coverage->'expected_scoring_profile_ids' IS DISTINCT FROM p_expected_profile_ids
    OR btrim(COALESCE(candidate.coverage->>'all_player_source_revision', '')) = ''
    OR COALESCE(candidate.coverage->>'score_batch_fingerprint', '')
      !~ '^sha256:[0-9a-f]{64}$'
    OR jsonb_typeof(candidate.coverage->'parity_observation_ids') IS DISTINCT FROM 'array'
    OR jsonb_typeof(candidate.coverage->'parity_observation_evidence') IS DISTINCT FROM 'object'
    OR jsonb_typeof(candidate.coverage->'parity_expected_entity_count') IS DISTINCT FROM 'number'
    OR COALESCE(candidate.coverage->>'parity_fingerprint', '')
      !~ '^sha256:[0-9a-f]{64}$'
    OR public.all_player_scoring_contract_supported(
      candidate.provider, candidate.scorer_version, candidate.scoring_rules
    ) IS DISTINCT FROM true
    OR candidate.scored_entity_count <> (
      SELECT count(*) FROM public.all_player_scores score
      WHERE score.all_player_score_set_id = candidate.id
    )
    OR candidate.eligible_game_count <> COALESCE((
      SELECT sum(score.eligible_game_count) FROM public.all_player_scores score
      WHERE score.all_player_score_set_id = candidate.id
    ), 0)
    OR EXISTS (
      SELECT 1 FROM public.all_player_scores score
      WHERE score.all_player_score_set_id = candidate.id
        AND score.eligible_game_count = 1 AND score.nfl_game_id IS NULL
    ) THEN
    RETURN false;
  END IF;

  provided_observation_count := jsonb_array_length(
    candidate.coverage->'parity_observation_ids'
  );
  SELECT count(*) INTO expected_observation_count
  FROM public.leagues league
  JOIN public.league_seasons season ON season.league_id = league.id
  WHERE league.league_key IN ('league1', 'league2')
    AND season.season = candidate.season
    AND season.scoring_profile_id = candidate.scoring_profile_id;

  WITH provided AS (
    SELECT value::uuid AS observation_id
    FROM jsonb_array_elements_text(candidate.coverage->'parity_observation_ids') value
  ), matched AS (
    SELECT observation.id, observation.league_season_id
    FROM provided
    JOIN public.league_week_observations observation
      ON observation.id = provided.observation_id
    JOIN public.league_seasons season ON season.id = observation.league_season_id
    JOIN public.leagues league ON league.id = season.league_id
    JOIN public.league_source_connections connection
      ON connection.league_season_id = season.id
      AND connection.provider = candidate.provider
    JOIN public.league_period_authorities authority
      ON authority.league_key = league.league_key
      AND authority.source_provider = candidate.provider
      AND authority.source_external_league_id = connection.external_league_id
      AND authority.default_season = candidate.season
    WHERE observation.provider = candidate.provider
      AND observation.week = candidate.week
      AND observation.quality = 'complete'
      AND season.season = candidate.season
      AND season.scoring_profile_id = candidate.scoring_profile_id
      AND league.league_key IN ('league1', 'league2')
      AND observation.source_data->>'allPlayerSourceRevision'
        = candidate.coverage->>'all_player_source_revision'
  )
  SELECT count(*), count(DISTINCT league_season_id)
  INTO matched_observation_count, matched_league_count
  FROM matched;
  IF provided_observation_count = 0
    OR provided_observation_count <> expected_observation_count
    OR provided_observation_count <> matched_observation_count
    OR matched_observation_count <> matched_league_count THEN
    RETURN false;
  END IF;

  WITH provided AS (
    SELECT value::uuid AS observation_id
    FROM jsonb_array_elements_text(candidate.coverage->'parity_observation_ids') value
  ), matched AS (
    SELECT observation.id, observation.source_data,
      candidate.coverage->'parity_observation_evidence'->observation.id::text
        AS score_evidence,
      authority.expected_roster_count,
      (SELECT jsonb_agg(roster_id ORDER BY roster_id)
        FROM unnest(authority.expected_roster_ids) roster_id) AS expected_roster_ids
    FROM provided
    JOIN public.league_week_observations observation
      ON observation.id = provided.observation_id
    JOIN public.league_seasons season ON season.id = observation.league_season_id
    JOIN public.leagues league ON league.id = season.league_id
    JOIN public.league_source_connections connection
      ON connection.league_season_id = season.id
      AND connection.provider = candidate.provider
    JOIN public.league_period_authorities authority
      ON authority.league_key = league.league_key
      AND authority.source_provider = candidate.provider
      AND authority.source_external_league_id = connection.external_league_id
      AND authority.default_season = candidate.season
    WHERE season.scoring_profile_id = candidate.scoring_profile_id
  ), physical AS (
    SELECT matched.id,
      count(points.*)::integer AS player_count,
      count(points.points)::integer AS nonnull_player_count,
      count(score.provider_external_id)::integer AS mapped_player_count,
      count(DISTINCT points.scoring_entity_id)::integer AS unique_player_count,
      count(DISTINCT points.external_roster_id)::integer AS player_roster_count,
      ('sha256:' || encode(digest(convert_to(COALESCE(string_agg(
        score.provider_external_id || chr(31) || points.points::text,
        chr(10) ORDER BY score.provider_external_id
      ), ''), 'UTF8'), 'sha256'), 'hex')) AS fingerprint
    FROM matched
    LEFT JOIN public.official_player_point_observations points
      ON points.league_week_observation_id = matched.id
    LEFT JOIN public.all_player_scores score
      ON score.all_player_score_set_id = candidate.id
      AND score.scoring_entity_id = points.scoring_entity_id
    GROUP BY matched.id
  ), roster_physical AS (
    SELECT matched.id, count(rosters.*)::integer AS roster_count,
      COALESCE(jsonb_agg(rosters.external_roster_id ORDER BY rosters.external_roster_id)
        FILTER (WHERE rosters.external_roster_id IS NOT NULL), '[]'::jsonb) AS roster_ids
    FROM matched
    LEFT JOIN public.official_roster_point_observations rosters
      ON rosters.league_week_observation_id = matched.id
    GROUP BY matched.id
  )
  SELECT count(*) INTO evidence_mismatch_count
  FROM matched
  JOIN physical ON physical.id = matched.id
  JOIN roster_physical ON roster_physical.id = matched.id
  WHERE jsonb_typeof(matched.score_evidence) IS DISTINCT FROM 'object'
    OR matched.source_data->>'allPlayerSourceRevision'
      IS DISTINCT FROM candidate.coverage->>'all_player_source_revision'
    OR matched.source_data->'officialPlayersPointsEvidence' IS DISTINCT FROM matched.score_evidence
    OR matched.score_evidence->>'version' IS DISTINCT FROM 'players-points-v1'
    OR matched.score_evidence->>'expectedEntityCount' IS DISTINCT FROM physical.player_count::text
    OR matched.score_evidence->>'expectedRosterCount' IS DISTINCT FROM matched.expected_roster_count::text
    OR matched.score_evidence->'expectedRosterIds' IS DISTINCT FROM matched.expected_roster_ids
    OR matched.score_evidence->>'fingerprint' IS DISTINCT FROM physical.fingerprint
    OR physical.player_count = 0
    OR physical.player_count <> physical.nonnull_player_count
    OR physical.player_count <> physical.mapped_player_count
    OR physical.player_count <> physical.unique_player_count
    OR physical.player_roster_count <> matched.expected_roster_count
    OR roster_physical.roster_count <> matched.expected_roster_count
    OR roster_physical.roster_ids IS DISTINCT FROM matched.expected_roster_ids
    OR EXISTS (
      SELECT 1 FROM public.official_player_point_observations player_point
      WHERE player_point.league_week_observation_id = matched.id
        AND NOT EXISTS (
          SELECT 1 FROM public.official_roster_point_observations roster_point
          WHERE roster_point.league_week_observation_id = matched.id
            AND roster_point.external_roster_id = player_point.external_roster_id
        )
    );
  IF evidence_mismatch_count <> 0 THEN RETURN false; END IF;

  WITH provided AS (
    SELECT value::uuid AS observation_id
    FROM jsonb_array_elements_text(candidate.coverage->'parity_observation_ids') value
  ), official AS (
    SELECT points.scoring_entity_id, points.points
    FROM provided
    JOIN public.official_player_point_observations points
      ON points.league_week_observation_id = provided.observation_id
  ), grouped AS (
    SELECT scoring_entity_id, min(points) AS points, count(DISTINCT points) AS point_values
    FROM official GROUP BY scoring_entity_id
  )
  SELECT
    (SELECT count(*) FROM official),
    (SELECT count(*) FROM official WHERE points IS NOT NULL),
    (SELECT count(*) FROM grouped),
    (SELECT count(*) FROM grouped WHERE point_values <> 1),
    (SELECT count(*) FROM grouped
      LEFT JOIN public.all_player_scores score
        ON score.all_player_score_set_id = candidate.id
        AND score.scoring_entity_id = grouped.scoring_entity_id
      WHERE score.scoring_entity_id IS NULL
        OR abs(score.fantasy_points - grouped.points) > 0.0001)
  INTO parity_row_count, parity_nonnull_count, parity_entity_count,
    parity_conflict_count, parity_score_mismatch_count;
  RETURN parity_row_count > 0
    AND parity_row_count = parity_nonnull_count
    AND parity_entity_count = candidate.parity_comparison_count
    AND parity_entity_count = (candidate.coverage->>'parity_expected_entity_count')::integer
    AND parity_conflict_count = 0
    AND parity_score_mismatch_count = 0;
EXCEPTION WHEN OTHERS THEN
  RETURN false;
END;
$$;
REVOKE ALL ON FUNCTION public.all_player_score_set_is_publication_ready(uuid, jsonb)
  FROM PUBLIC;

CREATE FUNCTION public.advance_current_all_player_score_set(
  p_provider text,
  p_season smallint,
  p_season_type text,
  p_week smallint,
  p_scoring_profile_id uuid,
  p_scorer_version text,
  p_stat_observation_id uuid,
  p_score_set_id uuid,
  p_verified_at timestamptz
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  candidate record;
  current_pointer public.current_all_player_score_sets%ROWTYPE;
  current_semantic_hash text;
  provided_parity_observation_count integer;
  matched_parity_observation_count integer;
  matched_parity_league_count integer;
  parity_row_count integer;
  parity_nonnull_count integer;
  parity_entity_count integer;
  parity_conflict_count integer;
  parity_score_mismatch_count integer;
  parity_evidence_mismatch_count integer;
  expected_league_count integer;
  expected_profile_count integer;
  expected_profile_ids jsonb;
  expected_parity_league_count integer;
  coordinated_score_set_count integer;
  result text;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(
    p_provider || ':' || p_season::text || ':' || p_season_type || ':' || p_week::text
      || ':' || p_scoring_profile_id::text || ':' || p_scorer_version,
    0
  ));

  SELECT observation.observed_at, observation.source_revision,
    observation.quality AS observation_quality,
    observation.all_player_stat_content_id,
    content.quality AS content_quality, content.coverage AS content_coverage,
    content.entry_count,
    score_set.semantic_hash, score_set.quality AS score_quality,
    score_set.scored_entity_count, score_set.eligible_game_count,
    score_set.parity_comparison_count, score_set.parity_mismatch_count,
    score_set.coverage, profile.rules_hash AS scoring_rules_hash,
    profile.rules AS scoring_rules
  INTO STRICT candidate
  FROM public.all_player_stat_observations observation
  JOIN public.all_player_stat_contents content
    ON content.id = observation.all_player_stat_content_id
  JOIN public.all_player_score_sets score_set
    ON score_set.id = p_score_set_id
    AND score_set.all_player_stat_content_id = observation.all_player_stat_content_id
  JOIN public.scoring_profiles profile ON profile.id = score_set.scoring_profile_id
  WHERE observation.id = p_stat_observation_id
    AND observation.provider = p_provider
    AND observation.season = p_season
    AND observation.season_type = p_season_type
    AND observation.week = p_week
    AND score_set.provider = p_provider
    AND score_set.season = p_season
    AND score_set.season_type = p_season_type
    AND score_set.week = p_week
    AND score_set.scoring_profile_id = p_scoring_profile_id
    AND score_set.scorer_version = p_scorer_version;

  IF p_season < 2026 OR p_season_type <> 'reg' THEN
    RAISE EXCEPTION 'all-player publication is limited to 2026+ regular seasons';
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
    OR candidate.score_quality <> 'complete'
    OR candidate.parity_comparison_count = 0
    OR candidate.parity_mismatch_count <> 0
    OR NOT candidate.coverage @> '{"complete":true,"identity_complete":true,"scoring_rules_complete":true}'::jsonb
    OR candidate.coverage->>'scoring_rules_hash' IS DISTINCT FROM candidate.scoring_rules_hash
    OR candidate.coverage->>'all_player_source_revision' IS DISTINCT FROM candidate.source_revision
    OR jsonb_typeof(candidate.coverage->'parity_observation_ids') IS DISTINCT FROM 'array'
    OR jsonb_typeof(candidate.coverage->'parity_observation_evidence') IS DISTINCT FROM 'object'
    OR jsonb_typeof(candidate.coverage->'expected_scoring_profile_ids') IS DISTINCT FROM 'array'
    OR COALESCE(candidate.coverage->>'score_batch_fingerprint', '')
      !~ '^sha256:[0-9a-f]{64}$'
    OR jsonb_typeof(candidate.coverage->'parity_expected_entity_count') IS DISTINCT FROM 'number'
    OR candidate.coverage->>'parity_fingerprint' IS NULL
    OR candidate.coverage->>'parity_fingerprint' !~ '^sha256:[0-9a-f]{64}$'
    OR candidate.entry_count <> (
      SELECT count(*) FROM public.all_player_stat_entries entry
      WHERE entry.all_player_stat_content_id = candidate.all_player_stat_content_id
    )
    OR 32 <> (
      SELECT count(*) FROM public.all_player_stat_entries entry
      WHERE entry.all_player_stat_content_id = candidate.all_player_stat_content_id
        AND entry.entity_kind = 'team_defense' AND entry.position = 'DEF'
    )
    OR (candidate.content_coverage->>'expectedPlayerCount')::integer <> (
      SELECT count(*) FROM public.all_player_stat_entries entry
      WHERE entry.all_player_stat_content_id = candidate.all_player_stat_content_id
        AND entry.entity_kind = 'player'
    )
    OR EXISTS (
      SELECT 1 FROM public.all_player_stat_entries entry
      WHERE entry.all_player_stat_content_id = candidate.all_player_stat_content_id
        AND (entry.eligible_game_count IS NULL OR entry.appearance_game_count IS NULL)
    )
    OR candidate.scored_entity_count <> (
      SELECT count(*) FROM public.all_player_scores score
      WHERE score.all_player_score_set_id = p_score_set_id
    )
    OR candidate.scored_entity_count <> candidate.entry_count
    OR EXISTS (
      SELECT 1 FROM public.all_player_scores score
      WHERE score.all_player_score_set_id = p_score_set_id
        AND score.eligible_game_count = 1 AND score.nfl_game_id IS NULL
    )
    OR candidate.eligible_game_count <> COALESCE((
      SELECT sum(score.eligible_game_count) FROM public.all_player_scores score
      WHERE score.all_player_score_set_id = p_score_set_id
    ), 0) THEN
    RAISE EXCEPTION 'all-player score set is not publication eligible';
  END IF;
  IF public.all_player_scoring_contract_supported(
    p_provider, p_scorer_version, candidate.scoring_rules
  ) IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'all-player scoring profile is unsupported by this scorer contract';
  END IF;

  WITH canonical_leagues AS (
    SELECT season.id AS league_season_id, season.scoring_profile_id
    FROM public.leagues league
    JOIN public.league_seasons season ON season.league_id = league.id
    WHERE league.league_key IN ('league1', 'league2') AND season.season = p_season
  ), expected_profiles AS (
    SELECT DISTINCT scoring_profile_id FROM canonical_leagues
  )
  SELECT
    (SELECT count(*) FROM canonical_leagues),
    (SELECT count(*) FROM expected_profiles),
    (SELECT jsonb_agg(scoring_profile_id::text ORDER BY scoring_profile_id::text)
      FROM expected_profiles),
    (SELECT count(*) FROM canonical_leagues
      WHERE scoring_profile_id = p_scoring_profile_id)
  INTO expected_league_count, expected_profile_count, expected_profile_ids,
    expected_parity_league_count;
  IF expected_league_count <> 2 OR expected_profile_count = 0
    OR expected_parity_league_count = 0
    OR candidate.coverage->'expected_scoring_profile_ids' IS DISTINCT FROM expected_profile_ids THEN
    RAISE EXCEPTION 'all-player score batch does not cover the canonical league scoring profiles';
  END IF;
  SELECT count(DISTINCT coordinated.scoring_profile_id) INTO coordinated_score_set_count
  FROM public.all_player_score_sets coordinated
  WHERE coordinated.all_player_stat_content_id = candidate.all_player_stat_content_id
    AND coordinated.provider = p_provider
    AND coordinated.season = p_season
    AND coordinated.season_type = p_season_type
    AND coordinated.week = p_week
    AND coordinated.scorer_version = p_scorer_version
    AND coordinated.quality = 'complete'
    AND coordinated.coverage->>'score_batch_fingerprint'
      = candidate.coverage->>'score_batch_fingerprint'
    AND coordinated.coverage->>'all_player_source_revision' = candidate.source_revision
    AND coordinated.coverage->'expected_scoring_profile_ids' = expected_profile_ids
    AND public.all_player_score_set_is_publication_ready(
      coordinated.id, expected_profile_ids
    ) IS TRUE
    AND coordinated.scoring_profile_id IN (
      SELECT DISTINCT season.scoring_profile_id
      FROM public.leagues league
      JOIN public.league_seasons season ON season.league_id = league.id
      WHERE league.league_key IN ('league1', 'league2') AND season.season = p_season
    );
  IF coordinated_score_set_count <> expected_profile_count THEN
    RAISE EXCEPTION 'all-player score batch is missing a canonical scoring profile';
  END IF;

  SELECT jsonb_array_length(candidate.coverage->'parity_observation_ids')
  INTO provided_parity_observation_count;
  WITH provided AS (
    SELECT value::uuid AS observation_id
    FROM jsonb_array_elements_text(candidate.coverage->'parity_observation_ids') value
  ), matched AS (
    SELECT observation.id, observation.league_season_id, observation.source_data
    FROM provided
    JOIN public.league_week_observations observation
      ON observation.id = provided.observation_id
    JOIN public.league_seasons season ON season.id = observation.league_season_id
    JOIN public.leagues league ON league.id = season.league_id
    JOIN public.league_source_connections connection
      ON connection.league_season_id = season.id AND connection.provider = p_provider
    JOIN public.league_period_authorities authority
      ON authority.league_key = league.league_key
      AND authority.source_provider = p_provider
      AND authority.source_external_league_id = connection.external_league_id
      AND authority.default_season = p_season
    WHERE observation.provider = p_provider AND observation.week = p_week
      AND observation.quality = 'complete' AND season.season = p_season
      AND season.scoring_profile_id = p_scoring_profile_id
      AND league.league_key IN ('league1', 'league2')
      AND observation.source_data->>'allPlayerSourceRevision' = candidate.source_revision
  )
  SELECT count(*), count(DISTINCT league_season_id)
  INTO matched_parity_observation_count, matched_parity_league_count
  FROM matched;
  IF provided_parity_observation_count = 0
    OR provided_parity_observation_count <> matched_parity_observation_count
    OR matched_parity_observation_count <> matched_parity_league_count
    OR matched_parity_league_count <> expected_parity_league_count THEN
    RAISE EXCEPTION 'all-player parity observations are incomplete';
  END IF;

  WITH provided AS (
    SELECT value::uuid AS observation_id
    FROM jsonb_array_elements_text(candidate.coverage->'parity_observation_ids') value
  ), matched AS (
    SELECT observation.id, observation.source_data,
      candidate.coverage->'parity_observation_evidence'->observation.id::text
        AS score_evidence,
      authority.expected_roster_count,
      (SELECT jsonb_agg(roster_id ORDER BY roster_id)
        FROM unnest(authority.expected_roster_ids) roster_id) AS expected_roster_ids
    FROM provided
    JOIN public.league_week_observations observation
      ON observation.id = provided.observation_id
    JOIN public.league_seasons season ON season.id = observation.league_season_id
    JOIN public.leagues league ON league.id = season.league_id
    JOIN public.league_source_connections connection
      ON connection.league_season_id = season.id AND connection.provider = p_provider
    JOIN public.league_period_authorities authority
      ON authority.league_key = league.league_key
      AND authority.source_provider = p_provider
      AND authority.source_external_league_id = connection.external_league_id
      AND authority.default_season = p_season
    WHERE season.scoring_profile_id = p_scoring_profile_id
  ), physical AS (
    SELECT matched.id,
      count(points.*)::integer AS player_count,
      count(points.points)::integer AS nonnull_player_count,
      count(score.provider_external_id)::integer AS mapped_player_count,
      count(DISTINCT points.scoring_entity_id)::integer AS unique_player_count,
      count(DISTINCT points.external_roster_id)::integer AS player_roster_count,
      ('sha256:' || encode(digest(convert_to(COALESCE(string_agg(
        score.provider_external_id || chr(31) || points.points::text,
        chr(10) ORDER BY score.provider_external_id
      ), ''), 'UTF8'), 'sha256'), 'hex')) AS fingerprint
    FROM matched
    LEFT JOIN public.official_player_point_observations points
      ON points.league_week_observation_id = matched.id
    LEFT JOIN public.all_player_scores score
      ON score.all_player_score_set_id = p_score_set_id
      AND score.scoring_entity_id = points.scoring_entity_id
    GROUP BY matched.id
  ), roster_physical AS (
    SELECT matched.id, count(rosters.*)::integer AS roster_count,
      COALESCE(jsonb_agg(rosters.external_roster_id ORDER BY rosters.external_roster_id)
        FILTER (WHERE rosters.external_roster_id IS NOT NULL), '[]'::jsonb) AS roster_ids
    FROM matched
    LEFT JOIN public.official_roster_point_observations rosters
      ON rosters.league_week_observation_id = matched.id
    GROUP BY matched.id
  )
  SELECT count(*) INTO parity_evidence_mismatch_count
  FROM matched
  JOIN physical ON physical.id = matched.id
  JOIN roster_physical ON roster_physical.id = matched.id
  WHERE jsonb_typeof(matched.score_evidence) IS DISTINCT FROM 'object'
    OR matched.source_data->>'allPlayerSourceRevision' IS DISTINCT FROM candidate.source_revision
    OR matched.source_data->'officialPlayersPointsEvidence' IS DISTINCT FROM matched.score_evidence
    OR matched.score_evidence->>'version' IS DISTINCT FROM 'players-points-v1'
    OR matched.score_evidence->>'expectedEntityCount' IS DISTINCT FROM physical.player_count::text
    OR matched.score_evidence->>'expectedRosterCount' IS DISTINCT FROM matched.expected_roster_count::text
    OR matched.score_evidence->'expectedRosterIds' IS DISTINCT FROM matched.expected_roster_ids
    OR matched.score_evidence->>'fingerprint' IS DISTINCT FROM physical.fingerprint
    OR physical.player_count = 0
    OR physical.player_count <> physical.nonnull_player_count
    OR physical.player_count <> physical.mapped_player_count
    OR physical.player_count <> physical.unique_player_count
    OR physical.player_roster_count <> matched.expected_roster_count
    OR roster_physical.roster_count <> matched.expected_roster_count
    OR roster_physical.roster_ids IS DISTINCT FROM matched.expected_roster_ids
    OR EXISTS (
      SELECT 1 FROM public.official_player_point_observations player_point
      WHERE player_point.league_week_observation_id = matched.id
        AND NOT EXISTS (
          SELECT 1 FROM public.official_roster_point_observations roster_point
          WHERE roster_point.league_week_observation_id = matched.id
            AND roster_point.external_roster_id = player_point.external_roster_id
        )
    );
  IF parity_evidence_mismatch_count <> 0 THEN
    RAISE EXCEPTION 'all-player parity evidence is stale, partial, or malformed';
  END IF;

  WITH provided AS (
    SELECT value::uuid AS observation_id
    FROM jsonb_array_elements_text(candidate.coverage->'parity_observation_ids') value
  ), official AS (
    SELECT points.scoring_entity_id, points.points
    FROM provided
    JOIN public.official_player_point_observations points
      ON points.league_week_observation_id = provided.observation_id
  ), grouped AS (
    SELECT scoring_entity_id, min(points) AS points, count(DISTINCT points) AS point_values
    FROM official GROUP BY scoring_entity_id
  )
  SELECT
    (SELECT count(*) FROM official),
    (SELECT count(*) FROM official WHERE points IS NOT NULL),
    (SELECT count(*) FROM grouped),
    (SELECT count(*) FROM grouped WHERE point_values <> 1),
    (SELECT count(*) FROM grouped
      LEFT JOIN public.all_player_scores score
        ON score.all_player_score_set_id = p_score_set_id
        AND score.scoring_entity_id = grouped.scoring_entity_id
      WHERE score.scoring_entity_id IS NULL
        OR abs(score.fantasy_points - grouped.points) > 0.0001)
  INTO parity_row_count, parity_nonnull_count, parity_entity_count,
    parity_conflict_count, parity_score_mismatch_count;
  IF parity_row_count = 0 OR parity_row_count <> parity_nonnull_count
    OR parity_entity_count <> candidate.parity_comparison_count
    OR parity_entity_count <> (candidate.coverage->>'parity_expected_entity_count')::integer
    OR parity_conflict_count <> 0 OR parity_score_mismatch_count <> 0 THEN
    RAISE EXCEPTION 'all-player rostered scoring parity is incomplete or mismatched';
  END IF;
  IF p_verified_at < candidate.observed_at THEN
    RAISE EXCEPTION 'all-player verification precedes its observation';
  END IF;

  SELECT pointer.* INTO current_pointer
  FROM public.current_all_player_score_sets pointer
  WHERE pointer.provider = p_provider AND pointer.season = p_season
    AND pointer.season_type = p_season_type AND pointer.week = p_week
    AND pointer.scoring_profile_id = p_scoring_profile_id
    AND pointer.scorer_version = p_scorer_version
  FOR UPDATE;

  IF FOUND AND candidate.observed_at < current_pointer.observed_at THEN
    RETURN 'superseded';
  END IF;
  IF FOUND AND candidate.observed_at = current_pointer.observed_at
    AND (p_stat_observation_id <> current_pointer.all_player_stat_observation_id
      OR p_score_set_id <> current_pointer.all_player_score_set_id) THEN
    RAISE EXCEPTION 'all-player pointer conflict: equal observation time has different content';
  END IF;

  IF FOUND THEN
    SELECT score_set.semantic_hash INTO STRICT current_semantic_hash
    FROM public.all_player_score_sets score_set
    WHERE score_set.id = current_pointer.all_player_score_set_id;
    result := CASE WHEN current_semantic_hash = candidate.semantic_hash
      THEN 'verified' ELSE 'advanced' END;
  ELSE
    result := 'advanced';
  END IF;

  INSERT INTO public.current_all_player_score_sets (
    provider, season, season_type, week, scoring_profile_id, scorer_version,
    all_player_stat_observation_id, all_player_score_set_id, observed_at,
    verified_at, material_changed_at
  ) VALUES (
    p_provider, p_season, p_season_type, p_week, p_scoring_profile_id, p_scorer_version,
    p_stat_observation_id, p_score_set_id, candidate.observed_at,
    p_verified_at, p_verified_at
  )
  ON CONFLICT (provider, season, season_type, week, scoring_profile_id, scorer_version)
  DO UPDATE SET
    all_player_stat_observation_id = EXCLUDED.all_player_stat_observation_id,
    all_player_score_set_id = EXCLUDED.all_player_score_set_id,
    observed_at = EXCLUDED.observed_at,
    verified_at = GREATEST(
      public.current_all_player_score_sets.verified_at, EXCLUDED.verified_at
    ),
    material_changed_at = CASE
      WHEN result = 'verified'
      THEN public.current_all_player_score_sets.material_changed_at
      ELSE EXCLUDED.material_changed_at
    END;
  RETURN result;
END;
$$;
REVOKE ALL ON FUNCTION public.advance_current_all_player_score_set(
  text, smallint, text, smallint, uuid, text, uuid, uuid, timestamptz
) FROM PUBLIC;

REVOKE ALL ON TABLE
  public.all_player_stat_contents,
  public.all_player_stat_entries,
  public.all_player_stat_observations,
  public.all_player_score_sets,
  public.all_player_scores,
  public.current_all_player_score_sets
FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'league_one_runtime') THEN
    REVOKE ALL ON TABLE
      public.all_player_stat_contents,
      public.all_player_stat_entries,
      public.all_player_stat_observations,
      public.all_player_score_sets,
      public.all_player_scores,
      public.current_all_player_score_sets
    FROM league_one_runtime;
    GRANT SELECT, INSERT ON TABLE
      public.all_player_stat_contents,
      public.all_player_stat_entries,
      public.all_player_stat_observations,
      public.all_player_score_sets,
      public.all_player_scores
    TO league_one_runtime;
    GRANT SELECT ON TABLE public.current_all_player_score_sets TO league_one_runtime;
    GRANT EXECUTE ON FUNCTION public.advance_current_all_player_score_set(
      text, smallint, text, smallint, uuid, text, uuid, uuid, timestamptz
    ) TO league_one_runtime;
  END IF;
END;
$$;
