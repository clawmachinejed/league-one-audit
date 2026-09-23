-- Shared capture completion is independent of league acceptance. Existing
-- callers and the legacy coordinated-publication contract remain unchanged.
CREATE FUNCTION public.finish_all_player_scoped_job(
  p_fence jsonb, p_outcome text, p_diagnostic jsonb, p_observation_id uuid
) RETURNS boolean LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  job public.projection_jobs%ROWTYPE;
  capture public.all_player_stat_observations%ROWTYPE;
  content public.all_player_stat_contents%ROWTYPE;
  accepted_count integer;
  accepted_profiles integer;
  completed timestamptz;
  result jsonb;
  prior_final jsonb;
  summary jsonb;
  history jsonb;
  final_capture boolean;
BEGIN
  IF p_observation_id IS NULL OR p_outcome IS NULL
    OR p_outcome NOT IN ('published','partial','validation-failed','provider-failed','timeout','lease-lost')
    OR jsonb_typeof(p_diagnostic) IS DISTINCT FROM 'object'
    OR octet_length(p_diagnostic::text) > 16000 THEN
    RAISE EXCEPTION 'scoped all-player completion is invalid';
  END IF;
  SELECT * INTO job FROM public.projection_jobs
    WHERE job_key='all-player-ingestion:sleeper' FOR UPDATE;
  IF NOT FOUND OR jsonb_typeof(p_fence) IS DISTINCT FROM 'object'
    OR NOT (p_fence ?& ARRAY['jobKey','workerId','generation','leaseUntil','deadlineAt'])
    OR p_fence->>'jobKey' IS DISTINCT FROM job.job_key
    OR job.state IS DISTINCT FROM 'running'
    OR job.lease_owner IS DISTINCT FROM p_fence->>'workerId'
    OR job.attempt_count IS DISTINCT FROM (p_fence->>'generation')::integer
    OR job.lease_until IS DISTINCT FROM (p_fence->>'leaseUntil')::timestamptz
    OR (job.payload->>'deadlineAt')::timestamptz IS DISTINCT FROM (p_fence->>'deadlineAt')::timestamptz
    OR job.lease_until <= clock_timestamp()
    OR (job.payload->>'requestGeneration')::integer IS DISTINCT FROM job.attempt_count
    OR (job.payload->'lastCapture'->>'generation')::integer IS DISTINCT FROM job.attempt_count
    OR (job.payload->'lastCapture'->>'observationId')::uuid IS DISTINCT FROM p_observation_id
    OR job.payload->'lastCapture'->'period' IS DISTINCT FROM job.payload->'period'
    THEN RETURN false; END IF;

  SELECT * INTO capture FROM public.all_player_stat_observations WHERE id=p_observation_id;
  IF NOT FOUND THEN RETURN false; END IF;
  SELECT * INTO content FROM public.all_player_stat_contents WHERE id=capture.all_player_stat_content_id;
  IF NOT FOUND OR capture.provider IS DISTINCT FROM 'sleeper'
    OR content.provider IS DISTINCT FROM capture.provider
    OR capture.season IS DISTINCT FROM (job.payload->'period'->>'season')::integer
    OR capture.season_type IS DISTINCT FROM 'reg'
    OR capture.week IS DISTINCT FROM (job.payload->'period'->>'week')::integer
    OR content.season IS DISTINCT FROM capture.season
    OR content.season_type IS DISTINCT FROM capture.season_type
    OR content.week IS DISTINCT FROM capture.week
    OR content.quality IS DISTINCT FROM capture.quality
    THEN RETURN false; END IF;

  -- These are verified acceptance records created under this exact fenced
  -- attempt. Caller diagnostics cannot manufacture publication success.
  SELECT count(DISTINCT acceptance.league_season_id), count(DISTINCT acceptance.scoring_profile_id)
    INTO accepted_count, accepted_profiles
    FROM public.all_player_league_acceptances acceptance
    JOIN public.current_all_player_league_scores pointer ON pointer.acceptance_id=acceptance.id
    WHERE acceptance.fence_generation=job.attempt_count
      AND acceptance.all_player_stat_observation_id=p_observation_id;
  final_capture := capture.quality='complete' AND content.quality='complete'
    AND content.coverage->'complete'='true'::jsonb
    AND content.coverage->'scheduleFinalityComplete'='true'::jsonb;

  -- Reuse existing ownership release and request-budget scheduling. A league
  -- rejection never introduces the pre-request global failure cooldown.
  IF NOT public.finish_all_player_job(p_fence,'partial',p_diagnostic) THEN RETURN false; END IF;
  completed := clock_timestamp();
  result := jsonb_build_object(
    'outcome', CASE WHEN capture.quality='complete' THEN 'captured' ELSE 'partial' END,
    'finishedAt',completed,'period',job.payload->'period','generation',job.attempt_count,
    'observationId',p_observation_id,'observedAt',capture.observed_at,
    'finalCoverage',COALESCE(final_capture,false),'captureQuality',capture.quality,
    'acceptedLeagueCount',accepted_count,'acceptedProfileCount',accepted_profiles,
    'processingOutcome',p_outcome,'diagnostic',p_diagnostic);
  SELECT value INTO prior_final
    FROM jsonb_array_elements(COALESCE(job.payload->'periodHistory','[]'::jsonb)) value
    WHERE value->'period'=job.payload->'period'
      AND value->>'outcome' IN ('published','captured')
      AND value->>'finalCoverage'='true'
    ORDER BY value->>'observedAt' DESC LIMIT 1;
  summary := CASE WHEN prior_final IS NOT NULL AND (NOT COALESCE(final_capture,false)
    OR (prior_final->>'observedAt')::timestamptz > capture.observed_at)
    THEN prior_final || jsonb_build_object('lastAttempt',result) ELSE result END;
  SELECT COALESCE(jsonb_agg(value ORDER BY (value->'period'->>'week')::integer),'[]'::jsonb)
    INTO history FROM (
      SELECT value FROM jsonb_array_elements(COALESCE(job.payload->'periodHistory','[]'::jsonb)) value
      WHERE value->'period' <> job.payload->'period'
        AND value->'period'->>'season'=job.payload->'period'->>'season'
      UNION ALL SELECT summary
    ) periods;
  UPDATE public.projection_jobs SET payload=payload || jsonb_build_object(
    'lastOutcome',result,'periodHistory',history)
    WHERE job_key=job.job_key AND attempt_count=job.attempt_count;
  RETURN FOUND;
END;
$$;

REVOKE ALL ON FUNCTION public.finish_all_player_scoped_job(jsonb,text,jsonb,uuid) FROM PUBLIC;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='league_one_runtime') THEN
    GRANT EXECUTE ON FUNCTION public.finish_all_player_scoped_job(jsonb,text,jsonb,uuid) TO league_one_runtime;
  END IF;
END $$;

-- An exact empty shared response publishes no fantasy-league data. Prove the
-- canonical NFL period is still wholly pregame without consulting enrollment.
CREATE FUNCTION public.finish_all_player_shared_pregame_job(p_fence jsonb, p_diagnostic jsonb)
RETURNS boolean LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  job public.projection_jobs%ROWTYPE;
  response jsonb;
  pregame jsonb;
  proof_at timestamptz;
  first_kickoff timestamptz;
  game_count integer;
  completed timestamptz;
  result jsonb;
  prior_final jsonb;
  summary jsonb;
  history jsonb;
BEGIN
  IF jsonb_typeof(p_diagnostic) IS DISTINCT FROM 'object'
    OR octet_length(p_diagnostic::text) > 16000 THEN RETURN false; END IF;
  SELECT * INTO job FROM public.projection_jobs
    WHERE job_key='all-player-ingestion:sleeper' FOR UPDATE;
  completed := clock_timestamp();
  IF NOT FOUND OR job.payload->>'mode' IS DISTINCT FROM 'recurring'
    OR jsonb_typeof(p_fence) IS DISTINCT FROM 'object'
    OR NOT (p_fence ?& ARRAY['jobKey','workerId','generation','leaseUntil','deadlineAt'])
    OR p_fence->>'jobKey' IS DISTINCT FROM job.job_key
    OR job.state IS DISTINCT FROM 'running'
    OR job.lease_owner IS DISTINCT FROM p_fence->>'workerId'
    OR job.attempt_count IS DISTINCT FROM (p_fence->>'generation')::integer
    OR job.lease_until IS DISTINCT FROM (p_fence->>'leaseUntil')::timestamptz
    OR (job.payload->>'deadlineAt')::timestamptz IS DISTINCT FROM (p_fence->>'deadlineAt')::timestamptz
    OR job.lease_until <= completed
    OR (job.payload->>'deadlineAt')::timestamptz <= completed
    OR (job.payload->>'requestGeneration')::integer IS DISTINCT FROM job.attempt_count
    OR (job.payload->'lastCapture'->>'generation')::integer = job.attempt_count
    OR (job.payload->'lastPublication'->>'generation')::integer = job.attempt_count
    OR EXISTS (SELECT 1 FROM public.all_player_league_acceptances
      WHERE fence_generation=job.attempt_count)
    THEN RETURN false; END IF;

  response := p_diagnostic->'responseEvidence';
  pregame := p_diagnostic->'pregameEvidence';
  IF p_diagnostic->>'reason' IS DISTINCT FROM 'no-statistics-yet'
    OR p_diagnostic->>'stage' IS DISTINCT FROM 'no-statistics-yet'
    OR p_diagnostic->'period' IS DISTINCT FROM jsonb_build_object(
      'season',job.payload->'period'->'season','seasonType','regular','week',job.payload->'period'->'week')
    OR p_diagnostic->'finalCoverage' IS DISTINCT FROM 'false'::jsonb
    OR p_diagnostic->>'retryDisposition' IS DISTINCT FROM 'global-budget'
    OR jsonb_typeof(response) IS DISTINCT FROM 'object'
    OR response->>'bodyShape' IS DISTINCT FROM 'object'
    OR response->'topLevelCount' IS DISTINCT FROM '0'::jsonb
    OR jsonb_typeof(response->'httpStatus') IS DISTINCT FROM 'number'
    OR (response->>'httpStatus')::integer NOT BETWEEN 200 AND 299
    OR COALESCE(response->>'bodyHash','') !~ '^sha256:[0-9a-f]{64}$'
    OR jsonb_typeof(pregame) IS DISTINCT FROM 'object'
    OR pregame->>'policy' IS DISTINCT FROM 'exact-period-shared-pregame-v1'
    OR jsonb_typeof(pregame->'scheduledGameCount') IS DISTINCT FROM 'number'
    OR COALESCE(pregame->>'scheduleRevision','') !~ '^sha256:[0-9a-f]{64}$'
    OR p_diagnostic->'entryCount' IS DISTINCT FROM '0'::jsonb
    OR p_diagnostic->'scoringProfileCount' IS DISTINCT FROM '0'::jsonb
    THEN RETURN false; END IF;
  proof_at := (pregame->>'verifiedAt')::timestamptz;
  IF proof_at IS NULL OR NOT isfinite(proof_at) OR proof_at > completed
    OR proof_at < completed-interval '90 seconds'
    OR (response->>'requestStartedAt')::timestamptz IS NULL
    OR (response->>'requestCompletedAt')::timestamptz IS NULL
    OR NOT isfinite((response->>'requestStartedAt')::timestamptz)
    OR NOT isfinite((response->>'requestCompletedAt')::timestamptz)
    OR (response->>'requestStartedAt')::timestamptz > (response->>'requestCompletedAt')::timestamptz
    OR (response->>'requestCompletedAt')::timestamptz > proof_at
    OR (response->>'requestCompletedAt')::timestamptz < completed-interval '90 seconds'
    THEN RETURN false; END IF;
  SELECT count(*),min(game.kickoff_at) INTO game_count,first_kickoff
    FROM public.nfl_games game
    WHERE game.season=(job.payload->'period'->>'season')::integer
      AND game.season_type='reg' AND game.week=(job.payload->'period'->>'week')::integer;
  IF game_count=0 OR game_count IS DISTINCT FROM (pregame->>'scheduledGameCount')::integer
    OR first_kickoff IS NULL OR NOT isfinite(first_kickoff) OR first_kickoff <= completed
    OR first_kickoff IS DISTINCT FROM (pregame->>'firstKickoffAt')::timestamptz
    OR EXISTS (SELECT 1 FROM public.nfl_games game
      WHERE game.season=(job.payload->'period'->>'season')::integer
        AND game.season_type='reg' AND game.week=(job.payload->'period'->>'week')::integer
        AND (game.kickoff_at IS NULL OR EXISTS (
          SELECT 1 FROM public.game_state_observations state WHERE state.nfl_game_id=game.id
            AND state.provider='tank01' AND state.status_code IN (1,2,4))))
    THEN RETURN false; END IF;

  result := jsonb_build_object('outcome','no-statistics-yet','finishedAt',completed,
    'period',job.payload->'period','generation',job.attempt_count,'diagnostic',p_diagnostic,
    'observedAt',completed,'finalCoverage',false);
  SELECT value INTO prior_final
    FROM jsonb_array_elements(COALESCE(job.payload->'periodHistory','[]'::jsonb)) value
    WHERE value->'period'=job.payload->'period'
      AND value->>'outcome' IN ('published','captured') AND value->>'finalCoverage'='true'
    ORDER BY value->>'observedAt' DESC LIMIT 1;
  summary := CASE WHEN prior_final IS NOT NULL
    THEN prior_final || jsonb_build_object('lastAttempt',result) ELSE result END;
  SELECT COALESCE(jsonb_agg(value ORDER BY (value->'period'->>'week')::integer),'[]'::jsonb)
    INTO history FROM (
      SELECT value FROM jsonb_array_elements(COALESCE(job.payload->'periodHistory','[]'::jsonb)) value
      WHERE value->'period' <> job.payload->'period'
        AND value->'period'->>'season'=job.payload->'period'->>'season'
      UNION ALL SELECT summary
    ) periods;

  -- Retain the existing release and request-budget calculation under this row
  -- lock. If the final time check fails, the exception rolls this release back.
  IF NOT public.finish_all_player_job(p_fence,'partial',p_diagnostic) THEN RETURN false; END IF;
  UPDATE public.projection_jobs SET payload=payload || jsonb_build_object(
    'lastOutcome',result,'periodHistory',history)
    WHERE job_key=job.job_key AND attempt_count=job.attempt_count AND state='completed'
      AND (payload->>'requestGeneration')::integer=job.attempt_count
      AND clock_timestamp() < first_kickoff
      AND clock_timestamp() < (job.payload->>'deadlineAt')::timestamptz
      AND clock_timestamp() < job.lease_until;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'shared pregame completion expired before release' USING ERRCODE='check_violation';
  END IF;
  RETURN true;
EXCEPTION WHEN invalid_text_representation OR invalid_datetime_format OR datetime_field_overflow
  OR numeric_value_out_of_range OR check_violation THEN RETURN false;
END;
$$;

REVOKE ALL ON FUNCTION public.finish_all_player_shared_pregame_job(jsonb,jsonb) FROM PUBLIC;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='league_one_runtime') THEN
    GRANT EXECUTE ON FUNCTION public.finish_all_player_shared_pregame_job(jsonb,jsonb) TO league_one_runtime;
  END IF;
END $$;
