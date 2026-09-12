-- Additive repair. Migration 010 and existing immutable rows remain unchanged.
-- The dormant old all-player writer fails closed after installation: only the
-- reviewed fenced writer may ingest. Existing readers and other workers remain compatible.

CREATE FUNCTION public.all_player_next_request_at(p_payload jsonb)
RETURNS timestamptz LANGUAGE sql STABLE
SET search_path = pg_catalog, public, pg_temp AS $$
  SELECT GREATEST(max(value::timestamptz) + interval '12 hours',
    CASE WHEN count(*) >= 2 THEN min(value::timestamptz) + interval '24 hours' END)
  FROM jsonb_array_elements_text(COALESCE(p_payload->'requestStarts', '[]'::jsonb)) value
$$;
REVOKE ALL ON FUNCTION public.all_player_next_request_at(jsonb) FROM PUBLIC;

CREATE FUNCTION public.all_player_job_fence_is_live(p_fence jsonb)
RETURNS boolean LANGUAGE sql VOLATILE SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp AS $$
  SELECT COALESCE(EXISTS (
    SELECT 1 FROM public.projection_jobs job
    WHERE job.job_key = 'all-player-ingestion:sleeper'
      AND p_fence->>'jobKey' = job.job_key
      AND job.job_type = 'all-player-ingestion' AND job.state = 'running'
      AND job.lease_owner = p_fence->>'workerId'
      AND job.attempt_count = (p_fence->>'generation')::integer
      AND job.lease_until = (p_fence->>'leaseUntil')::timestamptz
      AND job.lease_until > clock_timestamp()
      AND (job.payload->>'deadlineAt')::timestamptz = (p_fence->>'deadlineAt')::timestamptz
      AND (job.payload->>'deadlineAt')::timestamptz > clock_timestamp()
  ), false)
$$;
REVOKE ALL ON FUNCTION public.all_player_job_fence_is_live(jsonb) FROM PUBLIC;

CREATE FUNCTION public.assert_all_player_job_fence(
  p_fence jsonb, p_period jsonb, p_require_request boolean DEFAULT true
)
RETURNS boolean LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE job public.projection_jobs%ROWTYPE;
BEGIN
  SELECT * INTO job FROM public.projection_jobs
    WHERE job_key = 'all-player-ingestion:sleeper' FOR UPDATE;
  IF NOT FOUND OR public.all_player_job_fence_is_live(p_fence) IS DISTINCT FROM true
    OR job.payload->'period' IS DISTINCT FROM p_period
    OR job.payload->>'mode' = 'shadow'
    OR (p_require_request AND (job.payload->>'requestGeneration')::integer
      IS DISTINCT FROM job.attempt_count) THEN
    RAISE EXCEPTION 'all-player lease, generation, period, request or deadline is invalid';
  END IF;
  RETURN true;
END;
$$;
REVOKE ALL ON FUNCTION public.assert_all_player_job_fence(jsonb, jsonb, boolean) FROM PUBLIC;

CREATE FUNCTION public.claim_all_player_job(
  p_mode text, p_period jsonb, p_worker text, p_lease_seconds integer, p_deadline timestamptz
)
RETURNS TABLE(kind text, generation integer, lease_until text, deadline_at text, next_request_at text)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE job public.projection_jobs%ROWTYPE; next_at timestamptz; started timestamptz;
BEGIN
  IF p_mode IS NULL OR p_mode NOT IN ('shadow', 'backfill', 'recurring')
    OR p_worker IS NULL OR btrim(p_worker) = '' OR p_lease_seconds IS NULL OR p_deadline IS NULL
    OR p_lease_seconds NOT BETWEEN 1 AND 3600 OR p_deadline <= clock_timestamp()
    OR p_deadline > clock_timestamp() + interval '1 hour'
    OR jsonb_typeof(p_period) IS DISTINCT FROM 'object'
    OR jsonb_typeof(p_period->'season') IS DISTINCT FROM 'number'
    OR jsonb_typeof(p_period->'week') IS DISTINCT FROM 'number'
    OR (p_period->>'season')::integer NOT BETWEEN 2026 AND 2200
    OR p_period->>'seasonType' IS DISTINCT FROM 'reg'
    OR (p_period->>'week')::integer NOT BETWEEN 1 AND 18
    OR NOT (p_period ?& ARRAY['season','seasonType','week']) THEN
    RAISE EXCEPTION 'all-player job claim input is invalid';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('all-player-ingestion:sleeper', 0));
  SELECT * INTO job FROM public.projection_jobs
    WHERE job_key = 'all-player-ingestion:sleeper' FOR UPDATE;
  started := clock_timestamp();
  next_at := GREATEST(public.all_player_next_request_at(COALESCE(job.payload, '{}'::jsonb)),
    (job.payload->>'nextAttemptAt')::timestamptz);
  IF job.state = 'running' AND job.lease_until > started THEN
    RETURN QUERY SELECT 'busy'::text, NULL::integer, NULL::text, NULL::text, next_at::text;
    RETURN;
  END IF;
  IF next_at > started THEN
    RETURN QUERY SELECT 'not-due'::text, NULL::integer, NULL::text, NULL::text, next_at::text;
    RETURN;
  END IF;
  IF job.state = 'running' AND job.lease_until <= started THEN
    job.payload := job.payload || jsonb_build_object('lastInterruptedOutcome', jsonb_build_object(
      'outcome','lease-lost','stage','expired-before-completion','period',job.payload->'period',
      'generation',job.attempt_count,'leaseUntil',job.lease_until,'detectedAt',started));
  END IF;
  -- Preserve request starts even after validation/provider failures or lease takeover.
  -- Retain the last outcome and bounded per-period successful/partial metadata.
  INSERT INTO public.projection_jobs AS target (
    job_key, job_type, scheduled_for, state, payload, lease_owner, lease_until,
    attempt_count, updated_at
  ) VALUES (
    'all-player-ingestion:sleeper', 'all-player-ingestion', started, 'running',
    COALESCE(job.payload, '{}'::jsonb) || jsonb_build_object(
      'version', 'all-player-global-v2', 'mode', p_mode, 'period', p_period,
      'deadlineAt', p_deadline, 'requestGeneration', NULL),
    p_worker, started + p_lease_seconds * interval '1 second',
    COALESCE(job.attempt_count, 0) + 1, started
  ) ON CONFLICT (job_key) DO UPDATE SET
    state = EXCLUDED.state, scheduled_for = EXCLUDED.scheduled_for,
    payload = EXCLUDED.payload, lease_owner = EXCLUDED.lease_owner,
    lease_until = EXCLUDED.lease_until, attempt_count = EXCLUDED.attempt_count,
    updated_at = EXCLUDED.updated_at, completed_at = NULL, last_error = NULL
  RETURNING * INTO job;
  RETURN QUERY SELECT 'acquired'::text, job.attempt_count, job.lease_until::text,
    (job.payload->>'deadlineAt')::text, next_at::text;
END;
$$;
REVOKE ALL ON FUNCTION public.claim_all_player_job(text, jsonb, text, integer, timestamptz) FROM PUBLIC;

CREATE FUNCTION public.mark_all_player_request(p_fence jsonb, p_period jsonb)
RETURNS boolean LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE job public.projection_jobs%ROWTYPE; started timestamptz; starts jsonb;
BEGIN
  SELECT * INTO job FROM public.projection_jobs
    WHERE job_key = 'all-player-ingestion:sleeper' FOR UPDATE;
  IF NOT FOUND OR public.all_player_job_fence_is_live(p_fence) IS DISTINCT FROM true
    OR job.payload->'period' IS DISTINCT FROM p_period
    OR (job.payload->>'requestGeneration')::integer = job.attempt_count THEN RETURN false; END IF;
  started := clock_timestamp();
  IF public.all_player_next_request_at(job.payload) > started THEN RETURN false; END IF;
  SELECT COALESCE(jsonb_agg(value ORDER BY value::timestamptz), '[]'::jsonb) INTO starts
    FROM jsonb_array_elements_text(COALESCE(job.payload->'requestStarts', '[]'::jsonb)) value
    WHERE value::timestamptz > started - interval '24 hours';
  IF jsonb_array_length(starts) >= 2 THEN RETURN false; END IF;
  UPDATE public.projection_jobs SET payload = payload || jsonb_build_object(
    'requestStarts', starts || to_jsonb(started), 'requestGeneration', job.attempt_count,
    'lastRequestPeriod', p_period), updated_at = started
    WHERE job_key = job.job_key;
  RETURN true;
END;
$$;
REVOKE ALL ON FUNCTION public.mark_all_player_request(jsonb, jsonb) FROM PUBLIC;

CREATE FUNCTION public.finish_all_player_job(p_fence jsonb, p_outcome text, p_diagnostic jsonb)
RETURNS boolean LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE job public.projection_jobs%ROWTYPE; completed timestamptz; result jsonb; history jsonb; summary jsonb; prior_final jsonb; publication jsonb;
  stored_final boolean := false; stored_observed_at timestamptz; expected_count integer; actual_count integer;
BEGIN
  IF p_outcome IS NULL OR p_outcome NOT IN ('published','partial','validation-failed','provider-failed','timeout','lease-lost')
    OR jsonb_typeof(p_diagnostic) IS DISTINCT FROM 'object'
    OR octet_length(p_diagnostic::text) > 16000 THEN
    RAISE EXCEPTION 'all-player durable outcome is invalid';
  END IF;
  SELECT * INTO job FROM public.projection_jobs
    WHERE job_key = 'all-player-ingestion:sleeper' FOR UPDATE;
  -- Deadline expiry can be recorded during reserved handling time; ownership and
  -- lease expiry are always enforced, including failed completion.
  IF NOT FOUND OR jsonb_typeof(p_fence) IS DISTINCT FROM 'object'
    OR NOT (p_fence ?& ARRAY['jobKey','workerId','generation','leaseUntil','deadlineAt'])
    OR job.state IS DISTINCT FROM 'running'
    OR job.lease_owner IS DISTINCT FROM p_fence->>'workerId'
    OR job.attempt_count IS DISTINCT FROM (p_fence->>'generation')::integer
    OR job.lease_until IS DISTINCT FROM (p_fence->>'leaseUntil')::timestamptz
    OR (job.payload->>'deadlineAt')::timestamptz IS DISTINCT FROM (p_fence->>'deadlineAt')::timestamptz
    OR job.lease_until <= clock_timestamp()
    OR p_fence->>'jobKey' IS DISTINCT FROM job.job_key THEN RETURN false; END IF;
  completed := clock_timestamp();
  IF p_outcome = 'published' AND (job.payload->>'deadlineAt')::timestamptz <= completed
    THEN RETURN false; END IF;
  IF p_outcome = 'published' THEN
    publication := job.payload->'lastPublication';
    IF job.payload->>'mode' = 'shadow'
      OR (publication->>'generation')::integer IS DISTINCT FROM job.attempt_count
      OR publication->'period' IS DISTINCT FROM job.payload->'period'
      OR jsonb_typeof(publication->'profileIds') IS DISTINCT FROM 'array' THEN RETURN false; END IF;
    expected_count := jsonb_array_length(publication->'profileIds');
    SELECT count(*), bool_and(COALESCE((content.coverage->>'scheduleFinalityComplete')::boolean,false)),
      min(observation.observed_at)
      INTO actual_count, stored_final, stored_observed_at
      FROM public.current_all_player_score_sets pointer
      JOIN public.all_player_stat_observations observation ON observation.id = pointer.all_player_stat_observation_id
      JOIN public.all_player_stat_contents content ON content.id = observation.all_player_stat_content_id
      WHERE pointer.provider = 'sleeper' AND pointer.season = (job.payload->'period'->>'season')::integer
        AND pointer.season_type = 'reg' AND pointer.week = (job.payload->'period'->>'week')::integer
        AND pointer.scorer_version = publication->>'scorerVersion'
        AND pointer.all_player_stat_observation_id = (publication->>'observationId')::uuid
        AND publication->'profileIds' ? pointer.scoring_profile_id::text
        AND observation.quality = 'complete' AND content.quality = 'complete';
    IF expected_count = 0 OR actual_count <> expected_count THEN RETURN false; END IF;
  END IF;
  result := jsonb_build_object('outcome', p_outcome, 'finishedAt', completed,
    'period', job.payload->'period', 'generation', job.attempt_count, 'diagnostic', p_diagnostic,
    'observedAt', COALESCE(stored_observed_at::text, p_diagnostic->>'observedAt', completed::text),
    'finalCoverage', p_outcome = 'published' AND COALESCE(stored_final,false));
  SELECT value INTO prior_final
    FROM jsonb_array_elements(COALESCE(job.payload->'periodHistory','[]'::jsonb)) value
    WHERE value->'period' = job.payload->'period'
      AND value->>'outcome' = 'published' AND value->>'finalCoverage' = 'true'
    ORDER BY value->>'observedAt' DESC LIMIT 1;
  summary := CASE WHEN prior_final IS NOT NULL AND NOT
      (p_outcome = 'published' AND COALESCE(stored_final,false))
    THEN prior_final || jsonb_build_object('lastAttempt',result)
    ELSE result END;
  -- One summary per requested period for this season; a correction failure never
  -- erases the successful final proof. At most 18 regular-season summaries.
  SELECT COALESCE(jsonb_agg(value ORDER BY (value->'period'->>'week')::integer),'[]'::jsonb)
    INTO history FROM (
      SELECT value FROM jsonb_array_elements(COALESCE(job.payload->'periodHistory','[]'::jsonb)) value
      WHERE value->'period' <> job.payload->'period'
        AND value->'period'->>'season' = job.payload->'period'->>'season'
      UNION ALL SELECT summary
    ) periods;
  UPDATE public.projection_jobs SET
    state = CASE WHEN p_outcome IN ('published','partial') THEN 'completed' ELSE 'failed' END,
    completed_at = completed, lease_owner = NULL, lease_until = NULL, updated_at = completed,
    last_error = CASE WHEN p_outcome IN ('published','partial') THEN NULL ELSE p_outcome END,
    payload = payload || jsonb_build_object('lastOutcome', result, 'periodHistory', history,
      'nextAttemptAt', CASE WHEN (job.payload->>'requestGeneration')::integer IS DISTINCT FROM job.attempt_count
        THEN completed + interval '1 hour' ELSE public.all_player_next_request_at(job.payload) END)
    WHERE job_key = job.job_key;
  RETURN true;
END;
$$;
REVOKE ALL ON FUNCTION public.finish_all_player_job(jsonb, text, jsonb) FROM PUBLIC;

CREATE TABLE public.all_player_score_verifications (
  all_player_stat_observation_id uuid NOT NULL REFERENCES public.all_player_stat_observations(id),
  all_player_score_set_id uuid NOT NULL REFERENCES public.all_player_score_sets(id),
  scoring_profile_id uuid NOT NULL REFERENCES public.scoring_profiles(id),
  coverage jsonb NOT NULL CHECK (jsonb_typeof(coverage) = 'object'),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (all_player_stat_observation_id, all_player_score_set_id),
  UNIQUE (all_player_stat_observation_id, scoring_profile_id)
);
CREATE INDEX all_player_score_verifications_parity_idx
  ON public.all_player_score_verifications USING gin ((coverage->'parity_observation_ids'));
CREATE TRIGGER all_player_score_verifications_immutable
  BEFORE UPDATE OR DELETE ON public.all_player_score_verifications
  FOR EACH ROW EXECUTE FUNCTION public.prevent_all_player_history_change();

CREATE FUNCTION public.validate_all_player_score_verification()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE source_id uuid; profile_id uuid; original_coverage jsonb;
BEGIN
  SELECT score_set.all_player_stat_content_id, score_set.scoring_profile_id, score_set.coverage
    INTO STRICT source_id, profile_id, original_coverage
    FROM public.all_player_score_sets score_set WHERE score_set.id = NEW.all_player_score_set_id;
  IF profile_id <> NEW.scoring_profile_id OR NOT EXISTS (
    SELECT 1 FROM public.all_player_stat_observations observation
    WHERE observation.id = NEW.all_player_stat_observation_id
      AND observation.all_player_stat_content_id = source_id
      AND observation.quality = 'complete'
      AND observation.source_revision = NEW.coverage->>'all_player_source_revision'
  ) OR original_coverage - ARRAY['all_player_source_revision','score_batch_fingerprint',
      'parity_observation_ids','parity_observation_evidence','parity_fingerprint']
    IS DISTINCT FROM NEW.coverage - ARRAY['all_player_source_revision','score_batch_fingerprint',
      'parity_observation_ids','parity_observation_evidence','parity_fingerprint'] THEN
    RAISE EXCEPTION 'all-player score verification does not match material lineage';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.validate_all_player_score_verification() FROM PUBLIC;
CREATE TRIGGER all_player_score_verifications_lineage_guard
  BEFORE INSERT ON public.all_player_score_verifications
  FOR EACH ROW EXECUTE FUNCTION public.validate_all_player_score_verification();

CREATE FUNCTION public.guard_all_player_child_insert()
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
    ) THEN RAISE EXCEPTION 'all-player score child history is sealed'; END IF;
  END IF;
  IF existing IS NOT NULL THEN RAISE EXCEPTION 'all-player child replay conflicts'; END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.guard_all_player_child_insert() FROM PUBLIC;
CREATE TRIGGER all_player_stat_entries_append_guard BEFORE INSERT ON public.all_player_stat_entries
  FOR EACH ROW EXECUTE FUNCTION public.guard_all_player_child_insert();
CREATE TRIGGER all_player_scores_append_guard BEFORE INSERT ON public.all_player_scores
  FOR EACH ROW EXECUTE FUNCTION public.guard_all_player_child_insert();

REVOKE ALL ON TABLE public.all_player_score_verifications FROM PUBLIC;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'league_one_runtime') THEN
    GRANT SELECT, INSERT ON public.all_player_score_verifications TO league_one_runtime;
    GRANT EXECUTE ON FUNCTION public.all_player_next_request_at(jsonb),
      public.all_player_job_fence_is_live(jsonb),
      public.assert_all_player_job_fence(jsonb,jsonb,boolean),
      public.claim_all_player_job(text,jsonb,text,integer,timestamptz),
      public.mark_all_player_request(jsonb,jsonb), public.finish_all_player_job(jsonb,text,jsonb)
      TO league_one_runtime;
  END IF;
END; $$;


CREATE OR REPLACE FUNCTION public.validate_all_player_score_lineage()
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
  IF EXISTS (SELECT 1 FROM public.all_player_scores existing
    WHERE existing.all_player_score_set_id = NEW.all_player_score_set_id
      AND existing.scoring_entity_id = NEW.scoring_entity_id
      AND to_jsonb(existing) - 'created_at' = to_jsonb(NEW) - 'created_at')
    THEN RETURN NEW; END IF;
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
    JOIN public.scoring_entities entity ON entity.id = mapping.scoring_entity_id
      AND entity.kind = NEW.entity_kind
    WHERE mapping.provider = score_provider
      AND mapping.entity_kind = NEW.entity_kind
      AND mapping.external_id = NEW.provider_external_id
      AND mapping.scoring_entity_id = NEW.scoring_entity_id
      AND mapping.mapping_status = 'verified'
      AND mapping.valid_from <= clock_timestamp()
      AND (mapping.valid_to IS NULL OR mapping.valid_to > clock_timestamp())
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

CREATE OR REPLACE FUNCTION public.prevent_all_player_parity_evidence_change()
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
  ) OR EXISTS (SELECT 1 FROM public.all_player_score_verifications verification
    WHERE verification.coverage->'parity_observation_ids' ? observation_id::text
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

CREATE OR REPLACE FUNCTION public.all_player_score_set_is_publication_ready(
  p_score_set_id uuid,
  p_expected_profile_ids jsonb,
  p_stat_observation_id uuid
)
RETURNS boolean
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  candidate record;
  verification_coverage jsonb;
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
  SELECT coverage INTO verification_coverage FROM public.all_player_score_verifications
    WHERE all_player_stat_observation_id = p_stat_observation_id
      AND all_player_score_set_id = p_score_set_id;
  IF NOT FOUND THEN RETURN false; END IF;
  candidate.coverage := verification_coverage;
  IF NOT EXISTS (SELECT 1 FROM public.current_all_player_score_sets pointer
    JOIN public.all_player_stat_observations observed ON observed.id = p_stat_observation_id
    WHERE pointer.provider = candidate.provider AND pointer.season = candidate.season
      AND pointer.season_type = candidate.season_type AND pointer.week = candidate.week
      AND pointer.scoring_profile_id = candidate.scoring_profile_id
      AND pointer.scorer_version = candidate.scorer_version
      AND observed.observed_at <= pointer.observed_at)
    AND EXISTS (SELECT 1 FROM public.all_player_scores score
      WHERE score.all_player_score_set_id = p_score_set_id AND NOT EXISTS (
        SELECT 1 FROM public.external_scoring_entity_ids mapping
        JOIN public.scoring_entities entity ON entity.id = mapping.scoring_entity_id
          AND entity.kind = score.entity_kind
        WHERE mapping.provider = candidate.provider AND mapping.entity_kind = score.entity_kind
          AND mapping.external_id = score.provider_external_id
          AND mapping.scoring_entity_id = score.scoring_entity_id
          AND mapping.mapping_status = 'verified' AND mapping.valid_from <= clock_timestamp()
          AND (mapping.valid_to IS NULL OR mapping.valid_to > clock_timestamp())
      )) THEN RETURN false; END IF;


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

CREATE OR REPLACE FUNCTION public.advance_current_all_player_score_set(
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
  fence jsonb;
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
  fence := NULLIF(current_setting('league_one.all_player_fence', true), '')::jsonb;
  PERFORM public.assert_all_player_job_fence(fence,
    jsonb_build_object('season', p_season, 'seasonType', p_season_type, 'week', p_week), true);
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
    verification.coverage, profile.rules_hash AS scoring_rules_hash,
    profile.rules AS scoring_rules
  INTO STRICT candidate
  FROM public.all_player_stat_observations observation
  JOIN public.all_player_stat_contents content
    ON content.id = observation.all_player_stat_content_id
  JOIN public.all_player_score_sets score_set
    ON score_set.id = p_score_set_id
    AND score_set.all_player_stat_content_id = observation.all_player_stat_content_id
  JOIN public.all_player_score_verifications verification
    ON verification.all_player_stat_observation_id = observation.id
      AND verification.all_player_score_set_id = score_set.id
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
  JOIN public.all_player_score_verifications peer_verification
    ON peer_verification.all_player_score_set_id = coordinated.id
      AND peer_verification.all_player_stat_observation_id = p_stat_observation_id
  WHERE coordinated.all_player_stat_content_id = candidate.all_player_stat_content_id
    AND coordinated.provider = p_provider
    AND coordinated.season = p_season
    AND coordinated.season_type = p_season_type
    AND coordinated.week = p_week
    AND coordinated.scorer_version = p_scorer_version
    AND coordinated.quality = 'complete'
    AND peer_verification.coverage->>'score_batch_fingerprint'
      = candidate.coverage->>'score_batch_fingerprint'
    AND peer_verification.coverage->>'all_player_source_revision' = candidate.source_revision
    AND peer_verification.coverage->'expected_scoring_profile_ids' = expected_profile_ids
    AND public.all_player_score_set_is_publication_ready(
      coordinated.id, expected_profile_ids, p_stat_observation_id
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

  -- Locking prevents takeover during this transaction; check the real clock again
  -- after parity validation so an owner that expired during SQL cannot publish.
  PERFORM public.assert_all_player_job_fence(fence,
    jsonb_build_object('season', p_season, 'seasonType', p_season_type, 'week', p_week), true);
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
  UPDATE public.projection_jobs SET payload = payload || jsonb_build_object('lastPublication',
    jsonb_build_object('generation',(fence->>'generation')::integer,
      'period',jsonb_build_object('season',p_season,'seasonType',p_season_type,'week',p_week),
      'observationId',p_stat_observation_id,'scorerVersion',p_scorer_version,
      'profileIds',expected_profile_ids,'publishedAt',clock_timestamp()))
    WHERE job_key = 'all-player-ingestion:sleeper';
  RETURN result;
END;
$$;
REVOKE ALL ON FUNCTION public.all_player_score_set_is_publication_ready(uuid,jsonb,uuid) FROM PUBLIC;

-- Incorporated verbatim into migration 011; this is not an independently installed migration.
CREATE OR REPLACE FUNCTION public.all_player_eligibility_evidence_matches(
  p_evidence jsonb, p_eligible_game_count smallint, p_appearance_game_count smallint
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
  expected_eligible smallint;
  expected_appearance smallint;
  period_evidence jsonb;
  weekly jsonb;
  has_conflict boolean;
  invalid_flags boolean;
BEGIN
  IF jsonb_typeof(p_evidence) IS DISTINCT FROM 'object' THEN RETURN false; END IF;
  evidence_kind := p_evidence->>'kind';
  IF evidence_kind = 'weekly-stat' THEN
    IF p_evidence - ARRAY['kind', 'source', 'gmsActive', 'appearances', 'rawFlags'] <> '{}'::jsonb
      OR p_evidence->>'source' IS DISTINCT FROM 'weekly-stat-provider'
      OR (p_evidence ? 'gmsActive' AND (jsonb_typeof(p_evidence->'gmsActive') IS DISTINCT FROM 'number'
        OR p_evidence->>'gmsActive' NOT IN ('0','1')))
      OR (p_evidence ? 'appearances' AND (jsonb_typeof(p_evidence->'appearances') IS DISTINCT FROM 'number'
        OR p_evidence->>'appearances' NOT IN ('0','1'))) THEN RETURN false; END IF;
    IF p_evidence ? 'rawFlags' THEN
      IF jsonb_typeof(p_evidence->'rawFlags') IS DISTINCT FROM 'object'
        OR p_evidence->'rawFlags' = '{}'::jsonb
        OR (p_evidence->'rawFlags') - ARRAY['gms_active','gp'] <> '{}'::jsonb
        OR EXISTS (SELECT 1 FROM jsonb_each(p_evidence->'rawFlags') AS flag
          WHERE flag.value IN ('0'::jsonb, '1'::jsonb)) THEN RETURN false; END IF;
      RETURN p_eligible_game_count IS NULL AND p_appearance_game_count IS NULL;
    END IF;
    active_count := (p_evidence->>'gmsActive')::smallint;
    appearance_count := (p_evidence->>'appearances')::smallint;
    IF active_count = 0 AND appearance_count = 1 THEN
      RETURN p_eligible_game_count IS NULL AND p_appearance_game_count IS NULL;
    ELSIF active_count = 0 THEN expected_eligible := 0; expected_appearance := 0;
    ELSIF appearance_count = 1 THEN expected_eligible := 1; expected_appearance := 1;
    ELSIF active_count = 1 AND appearance_count = 0 THEN expected_eligible := 1; expected_appearance := 0;
    END IF;
    RETURN p_eligible_game_count IS NOT DISTINCT FROM expected_eligible
      AND p_appearance_game_count IS NOT DISTINCT FROM expected_appearance;
  ELSIF evidence_kind IN ('explicit-ineligible', 'period-participation') THEN
    IF jsonb_typeof(p_evidence->'sourceRevision') IS DISTINCT FROM 'string'
      OR btrim(p_evidence->>'sourceRevision') = ''
      OR jsonb_typeof(p_evidence->'observedAt') IS DISTINCT FROM 'string'
      OR p_evidence->>'observedAt' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z$'
      OR jsonb_typeof(p_evidence->'effectivePeriod') IS DISTINCT FROM 'object'
      OR (p_evidence->'effectivePeriod') - ARRAY['season','seasonType','week'] <> '{}'::jsonb
      OR jsonb_typeof(p_evidence->'effectivePeriod'->'season') IS DISTINCT FROM 'number'
      OR jsonb_typeof(p_evidence->'effectivePeriod'->'week') IS DISTINCT FROM 'number'
      OR p_evidence->'effectivePeriod'->>'seasonType' IS DISTINCT FROM 'reg'
      OR (p_evidence->'effectivePeriod'->>'season') !~ '^[0-9]+$'
      OR (p_evidence->'effectivePeriod'->>'week') !~ '^[0-9]+$'
      OR (p_evidence->'effectivePeriod'->>'season')::integer NOT BETWEEN 2026 AND 2200
      OR (p_evidence->'effectivePeriod'->>'week')::integer NOT BETWEEN 1 AND 18 THEN RETURN false; END IF;
    BEGIN
      IF NOT isfinite((p_evidence->>'observedAt')::timestamptz) THEN RETURN false; END IF;
    EXCEPTION WHEN others THEN RETURN false;
    END;
    IF evidence_kind = 'explicit-ineligible' THEN
      RETURN COALESCE(p_evidence - ARRAY['kind','reason','source','sourceRevision','observedAt','effectivePeriod'] = '{}'::jsonb
        AND p_evidence->>'reason' IN ('inactive','suspended','reserve','bye','teamless','other')
        AND p_evidence->>'source' IN ('player-status-provider','schedule','manual-review')
        AND p_eligible_game_count = 0 AND p_appearance_game_count = 0, false);
    END IF;
    IF p_evidence - ARRAY['kind','decision','source','sourceRevision','observedAt','effectivePeriod','reason','weekly'] <> '{}'::jsonb
      OR COALESCE(p_evidence->>'decision','') NOT IN ('appearance','dressed-unused','ineligible','ambiguous')
      OR COALESCE(p_evidence->>'source','') NOT IN ('gamebook','official-period-roster','manual-review')
      OR jsonb_typeof(p_evidence->'reason') IS DISTINCT FROM 'string'
      OR btrim(p_evidence->>'reason') = '' THEN RETURN false; END IF;
    IF p_evidence ? 'weekly' THEN
      weekly := p_evidence->'weekly';
      IF weekly->>'kind' IS DISTINCT FROM 'weekly-stat' OR NOT (
        public.all_player_eligibility_evidence_matches(weekly,0::smallint,0::smallint)
        OR public.all_player_eligibility_evidence_matches(weekly,1::smallint,0::smallint)
        OR public.all_player_eligibility_evidence_matches(weekly,1::smallint,1::smallint)
        OR public.all_player_eligibility_evidence_matches(weekly,NULL::smallint,NULL::smallint)
      ) THEN RETURN false; END IF;
    END IF;
    IF p_evidence->>'decision' = 'ambiguous' THEN
      RETURN p_eligible_game_count IS NULL AND p_appearance_game_count IS NULL;
    ELSIF p_evidence->>'decision' = 'appearance' THEN expected_eligible := 1; expected_appearance := 1;
    ELSIF p_evidence->>'decision' = 'dressed-unused' THEN expected_eligible := 1; expected_appearance := 0;
    ELSE expected_eligible := 0; expected_appearance := 0;
    END IF;
    IF weekly IS NOT NULL THEN
      invalid_flags := weekly ? 'rawFlags' OR (weekly->>'gmsActive' = '0' AND weekly->>'appearances' = '1');
      has_conflict := NOT public.all_player_eligibility_evidence_matches(weekly,NULL::smallint,NULL::smallint)
        AND NOT public.all_player_eligibility_evidence_matches(weekly,expected_eligible,expected_appearance);
      IF COALESCE(invalid_flags,false) OR has_conflict THEN
        RETURN p_eligible_game_count IS NULL AND p_appearance_game_count IS NULL;
      END IF;
    END IF;
    RETURN p_eligible_game_count IS NOT DISTINCT FROM expected_eligible
      AND p_appearance_game_count IS NOT DISTINCT FROM expected_appearance;
  ELSIF evidence_kind IN ('combined-ineligible','conflict') THEN
    IF p_evidence - ARRAY['kind','weekly','ineligibility'] <> '{}'::jsonb
      OR p_evidence->'ineligibility'->>'kind' IS DISTINCT FROM 'explicit-ineligible'
      OR NOT public.all_player_eligibility_evidence_matches(p_evidence->'ineligibility',0::smallint,0::smallint)
      OR p_evidence->'weekly'->>'kind' IS DISTINCT FROM 'weekly-stat' THEN RETURN false; END IF;
    weekly := p_evidence->'weekly';
    IF NOT (public.all_player_eligibility_evidence_matches(weekly,0::smallint,0::smallint)
      OR public.all_player_eligibility_evidence_matches(weekly,1::smallint,0::smallint)
      OR public.all_player_eligibility_evidence_matches(weekly,1::smallint,1::smallint)
      OR public.all_player_eligibility_evidence_matches(weekly,NULL::smallint,NULL::smallint)) THEN RETURN false; END IF;
    has_conflict := public.all_player_eligibility_evidence_matches(weekly,1::smallint,0::smallint)
      OR public.all_player_eligibility_evidence_matches(weekly,1::smallint,1::smallint)
      OR weekly ? 'rawFlags'
      OR COALESCE(weekly->>'gmsActive' = '0' AND weekly->>'appearances' = '1',false);
    IF evidence_kind = 'conflict' THEN
      RETURN has_conflict AND p_eligible_game_count IS NULL AND p_appearance_game_count IS NULL;
    END IF;
    RETURN COALESCE(NOT has_conflict AND p_eligible_game_count = 0 AND p_appearance_game_count = 0,false);
  ELSIF evidence_kind = 'missing-provider-row' THEN
    RETURN p_evidence - ARRAY['kind','inventoryFingerprint'] = '{}'::jsonb
      AND COALESCE(p_evidence->>'inventoryFingerprint','') ~ '^sha256:[0-9a-f]{64}$'
      AND p_eligible_game_count IS NULL AND p_appearance_game_count IS NULL;
  ELSIF evidence_kind = 'unknown-weekly-stat' THEN
    RETURN p_evidence = '{"kind":"unknown-weekly-stat","source":"weekly-stat-provider"}'::jsonb
      AND p_eligible_game_count IS NULL AND p_appearance_game_count IS NULL;
  END IF;
  RETURN false;
EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN RETURN false;
END;
$$;

CREATE OR REPLACE FUNCTION public.validate_all_player_stat_entry()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  content_context record;
  game_context record;
  period_evidence jsonb;
  weekly_evidence jsonb;
  raw_key text;
  evidence_key text;
  expected_raw jsonb;
BEGIN
  IF public.all_player_eligibility_evidence_matches(NEW.eligibility_evidence,
    NEW.eligible_game_count,NEW.appearance_game_count) IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'all-player eligibility evidence does not support its counts';
  END IF;
  SELECT season,season_type,week INTO STRICT content_context
  FROM public.all_player_stat_contents WHERE id = NEW.all_player_stat_content_id;
  weekly_evidence := CASE WHEN NEW.eligibility_evidence->>'kind' = 'weekly-stat'
    THEN NEW.eligibility_evidence ELSE NEW.eligibility_evidence->'weekly' END;
  IF weekly_evidence IS NOT NULL THEN
    FOREACH raw_key IN ARRAY ARRAY['gms_active','gp'] LOOP
      evidence_key := CASE WHEN raw_key = 'gms_active' THEN 'gmsActive' ELSE 'appearances' END;
      IF weekly_evidence->'rawFlags' ? raw_key THEN
        expected_raw := CASE WHEN jsonb_typeof(weekly_evidence->'rawFlags'->raw_key) = 'number'
          THEN weekly_evidence->'rawFlags'->raw_key ELSE NULL END;
      ELSE expected_raw := weekly_evidence->evidence_key;
      END IF;
      IF NEW.stats->raw_key IS DISTINCT FROM expected_raw THEN
        RAISE EXCEPTION 'all-player weekly eligibility flag disagrees with retained statistics';
      END IF;
    END LOOP;
  END IF;
  period_evidence := CASE WHEN NEW.eligibility_evidence->>'kind' IN ('combined-ineligible','conflict')
    THEN NEW.eligibility_evidence->'ineligibility'
    WHEN NEW.eligibility_evidence->>'kind' IN ('explicit-ineligible','period-participation')
    THEN NEW.eligibility_evidence ELSE NULL END;
  IF period_evidence IS NOT NULL AND (
    (period_evidence->'effectivePeriod'->>'season')::integer IS DISTINCT FROM content_context.season
    OR period_evidence->'effectivePeriod'->>'seasonType' IS DISTINCT FROM content_context.season_type
    OR (period_evidence->'effectivePeriod'->>'week')::integer IS DISTINCT FROM content_context.week
  ) THEN RAISE EXCEPTION 'all-player eligibility evidence does not match its content period'; END IF;
  IF NEW.eligible_game_count = 1 AND NEW.nfl_game_id IS NULL THEN
    RAISE EXCEPTION 'eligible all-player entry requires an NFL game';
  END IF;
  IF NEW.nfl_game_id IS NOT NULL THEN
    SELECT season,season_type,week,home_team,away_team INTO STRICT game_context
    FROM public.nfl_games WHERE id = NEW.nfl_game_id;
    IF NEW.nfl_team IS NULL OR game_context.season <> content_context.season
      OR game_context.season_type <> content_context.season_type OR game_context.week <> content_context.week
      OR NEW.nfl_team NOT IN (game_context.home_team,game_context.away_team) THEN
      RAISE EXCEPTION 'all-player NFL game does not match its content period and team';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

-- Explicit fence overload for application and operator callers. The previous
-- signature remains guarded and fails without a transaction-bound live fence.
CREATE FUNCTION public.advance_current_all_player_score_set(
  p_provider text, p_season smallint, p_season_type text, p_week smallint,
  p_scoring_profile_id uuid, p_scorer_version text, p_stat_observation_id uuid,
  p_score_set_id uuid, p_verified_at timestamptz, p_fence jsonb
)
RETURNS text LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  PERFORM set_config('league_one.all_player_fence', p_fence::text, true);
  RETURN public.advance_current_all_player_score_set(p_provider,p_season,p_season_type,p_week,
    p_scoring_profile_id,p_scorer_version,p_stat_observation_id,p_score_set_id,p_verified_at);
END;
$$;
REVOKE ALL ON FUNCTION public.advance_current_all_player_score_set(
  text,smallint,text,smallint,uuid,text,uuid,uuid,timestamptz,jsonb) FROM PUBLIC;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'league_one_runtime') THEN
    GRANT EXECUTE ON FUNCTION public.advance_current_all_player_score_set(
      text,smallint,text,smallint,uuid,text,uuid,uuid,timestamptz,jsonb) TO league_one_runtime;
  END IF;
END; $$;

-- Direct runtime job DML may serve ordinary jobs, but must never erase the global
-- provider budget. SECURITY INVOKER is deliberate: only the owner, including the
-- reviewed SECURITY DEFINER helpers, may mutate this one existing job row.
CREATE FUNCTION public.protect_all_player_global_job()
RETURNS trigger LANGUAGE plpgsql
SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  IF (TG_OP <> 'DELETE' AND NEW.job_key = 'all-player-ingestion:sleeper')
    OR (TG_OP <> 'INSERT' AND OLD.job_key = 'all-player-ingestion:sleeper') THEN
    IF current_user::regrole::oid IS DISTINCT FROM (
      SELECT relowner FROM pg_class WHERE oid = TG_RELID
    ) THEN RAISE EXCEPTION 'all-player global budget requires the dedicated job functions'; END IF;
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.protect_all_player_global_job() FROM PUBLIC;
CREATE TRIGGER projection_jobs_all_player_budget_guard
  BEFORE INSERT OR UPDATE OR DELETE ON public.projection_jobs
  FOR EACH ROW EXECUTE FUNCTION public.protect_all_player_global_job();

CREATE FUNCTION public.verify_all_player_pointer_job_fence()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  PERFORM public.assert_all_player_job_fence(
    NULLIF(current_setting('league_one.all_player_fence',true),'')::jsonb,
    jsonb_build_object('season',NEW.season,'seasonType',NEW.season_type,'week',NEW.week), true);
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.verify_all_player_pointer_job_fence() FROM PUBLIC;
CREATE CONSTRAINT TRIGGER current_all_player_score_sets_job_fence
  AFTER INSERT OR UPDATE ON public.current_all_player_score_sets DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION public.verify_all_player_pointer_job_fence();

CREATE FUNCTION public.record_all_player_preclaim_outcome(p_input jsonb)
RETURNS text LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE job public.projection_jobs%ROWTYPE; recorded timestamptz; context jsonb; result jsonb;
BEGIN
  IF jsonb_typeof(p_input) IS DISTINCT FROM 'object'
    OR p_input - ARRAY['outcome','stage','reason','period','retryAt','retryDisposition'] <> '{}'::jsonb
    OR jsonb_typeof(p_input->'outcome') IS DISTINCT FROM 'string'
    OR p_input->>'outcome' NOT IN ('not-due','busy','validation-failed','timeout')
    OR jsonb_typeof(p_input->'stage') IS DISTINCT FROM 'string'
    OR length(btrim(p_input->>'stage')) NOT BETWEEN 1 AND 96
    OR jsonb_typeof(p_input->'reason') IS DISTINCT FROM 'string'
    OR length(btrim(p_input->>'reason')) NOT BETWEEN 1 AND 192
    OR jsonb_typeof(p_input->'retryDisposition') IS DISTINCT FROM 'string'
    OR p_input->>'retryDisposition' NOT IN ('next-poll','after-cooldown','manual-review')
    OR octet_length(p_input::text) > 2000 THEN
    RAISE EXCEPTION 'all-player preclaim outcome input is invalid';
  END IF;
  IF p_input ? 'period' AND (jsonb_typeof(p_input->'period') IS DISTINCT FROM 'object'
    OR (p_input->'period') - ARRAY['season','seasonType','week'] <> '{}'::jsonb
    OR jsonb_typeof(p_input->'period'->'season') IS DISTINCT FROM 'number'
    OR jsonb_typeof(p_input->'period'->'week') IS DISTINCT FROM 'number'
    OR p_input->'period'->>'seasonType' IS DISTINCT FROM 'reg'
    OR (p_input->'period'->>'season')::integer NOT BETWEEN 2026 AND 2200
    OR (p_input->'period'->>'week')::integer NOT BETWEEN 1 AND 18) THEN
    RAISE EXCEPTION 'all-player preclaim period is invalid';
  END IF;
  IF p_input ? 'retryAt' AND p_input->'retryAt' <> 'null'::jsonb THEN
    IF jsonb_typeof(p_input->'retryAt') IS DISTINCT FROM 'string'
      OR (p_input->>'retryAt') !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$'
      OR NOT isfinite((p_input->>'retryAt')::timestamptz) THEN
      RAISE EXCEPTION 'all-player preclaim retry time is invalid';
    END IF;
  END IF;
  context := jsonb_strip_nulls(p_input) || jsonb_build_object(
    'stage',btrim(p_input->>'stage'),'reason',btrim(p_input->>'reason'));
  PERFORM pg_advisory_xact_lock(hashtextextended('all-player-ingestion:sleeper',0));
  SELECT * INTO job FROM public.projection_jobs
    WHERE job_key = 'all-player-ingestion:sleeper' FOR UPDATE;
  recorded := clock_timestamp();
  IF FOUND THEN
    IF job.payload->'lastPreclaimOutcome'->'context' = context THEN RETURN 'unchanged'; END IF;
    IF (job.payload->>'nextPreclaimOutcomeAt')::timestamptz > recorded THEN RETURN 'throttled'; END IF;
  END IF;
  result := jsonb_build_object('context',context,'observedAt',recorded);
  IF job.job_key IS NULL THEN
    -- An inert summary is not an ingestion claim or a provider reservation.
    INSERT INTO public.projection_jobs (
      job_key,job_type,scheduled_for,state,payload,attempt_count,updated_at
    ) VALUES ('all-player-ingestion:sleeper','all-player-ingestion',recorded,'pending',
      jsonb_build_object('version','all-player-global-v2','lastPreclaimOutcome',result,
        'nextPreclaimOutcomeAt',recorded + interval '15 minutes'),0,recorded);
  ELSE
    -- The row lock serializes with claim, publication and completion. Preserve
    -- every active ownership, request-budget and final-history field verbatim.
    UPDATE public.projection_jobs SET payload = payload || jsonb_build_object(
      'lastPreclaimOutcome',result,'nextPreclaimOutcomeAt',recorded + interval '15 minutes'),
      updated_at = recorded WHERE job_key = job.job_key;
  END IF;
  RETURN 'recorded';
END;
$$;
REVOKE ALL ON FUNCTION public.record_all_player_preclaim_outcome(jsonb) FROM PUBLIC;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'league_one_runtime') THEN
    GRANT EXECUTE ON FUNCTION public.record_all_player_preclaim_outcome(jsonb) TO league_one_runtime;
  END IF;
END; $$;
