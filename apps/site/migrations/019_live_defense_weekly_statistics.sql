-- Additive sharing of the existing Sleeper weekly-statistics request and job.
-- No new table, provider connection, cron, raw-history cadence or scoring writer.
-- Install before deploying live-defense callers. Older hourly callers retain
-- their signatures, window, 13-capture cap, and ownership/publication fences.

-- Live-only request leases cannot authorize all-player raw/score writes.
CREATE OR REPLACE FUNCTION public.assert_all_player_job_fence(
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
    OR job.payload->>'mode' IS NULL OR job.payload->>'mode' NOT IN ('backfill','recurring')
    OR (p_require_request AND (job.payload->>'requestGeneration')::integer
      IS DISTINCT FROM job.attempt_count) THEN
    RAISE EXCEPTION 'all-player lease, generation, period, request or deadline is invalid';
  END IF;
  RETURN true;
END;
$$;
REVOKE ALL ON FUNCTION public.assert_all_player_job_fence(jsonb, jsonb, boolean) FROM PUBLIC;

CREATE FUNCTION public.weekly_stat_next_request_at(p_payload jsonb, p_at timestamptz)
RETURNS timestamptz LANGUAGE sql STABLE
SET search_path = pg_catalog, public, pg_temp AS $$
  SELECT GREATEST(p_at, COALESCE((p_payload->>'lastWeeklyRequestAt')::timestamptz,
    (SELECT max(value::timestamptz) FROM jsonb_array_elements_text(
      COALESCE(p_payload->'requestStarts','[]'::jsonb)) value)) + interval '60 seconds')
$$;
REVOKE ALL ON FUNCTION public.weekly_stat_next_request_at(jsonb,timestamptz) FROM PUBLIC;
-- A minimum 60 seconds between starts also bounds every rolling 24-hour window
-- to 1440 requests. Keep one timestamp instead of a growing minute history.

CREATE FUNCTION public.live_weekly_stat_period_is_current(p_period jsonb)
RETURNS boolean LANGUAGE sql STABLE
SET search_path = pg_catalog, public, pg_temp AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.league_period_authorities authority
    WHERE authority.source_provider='sleeper' AND authority.league_lifecycle='active'
      AND authority.active_season=(p_period->>'season')::integer
      AND authority.active_season_type='reg' AND authority.active_week=(p_period->>'week')::integer
      AND authority.verified_at BETWEEN clock_timestamp()-interval '10 minutes'
        AND clock_timestamp()+interval '30 seconds'
  ) AND EXISTS (
    SELECT 1 FROM public.nfl_games game
    JOIN LATERAL (SELECT state.status_code,state.observed_at
      FROM public.game_state_observations state WHERE state.nfl_game_id=game.id AND state.provider='tank01'
      ORDER BY state.observed_at DESC,state.request_completed_at DESC,state.created_at DESC,state.id DESC LIMIT 1) latest ON true
    WHERE game.season=(p_period->>'season')::integer AND game.season_type='reg'
      AND game.week=(p_period->>'week')::integer AND latest.status_code=1
      AND latest.observed_at BETWEEN clock_timestamp()-interval '90 seconds'
        AND clock_timestamp()+interval '30 seconds'
  )
$$;
REVOKE ALL ON FUNCTION public.live_weekly_stat_period_is_current(jsonb) FROM PUBLIC;

CREATE FUNCTION public.weekly_stat_receipt_is_valid(p_receipt jsonb, p_period jsonb, p_generation integer)
RETURNS boolean LANGUAGE plpgsql STABLE
SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE started timestamptz; completed timestamptz;
BEGIN
  IF jsonb_typeof(p_receipt) IS DISTINCT FROM 'object'
    OR octet_length(p_receipt::text)>4096
    OR jsonb_typeof(p_receipt->'sourceRevision') IS DISTINCT FROM 'string'
    OR jsonb_typeof(p_receipt->'requestStartedAt') IS DISTINCT FROM 'string'
    OR jsonb_typeof(p_receipt->'requestCompletedAt') IS DISTINCT FROM 'string'
    OR p_receipt->'period' IS DISTINCT FROM p_period
    OR jsonb_typeof(p_receipt->'requestGeneration') IS DISTINCT FROM 'number'
    OR (p_receipt->>'requestGeneration')::integer IS DISTINCT FROM p_generation
    OR COALESCE(p_receipt->>'bodyHash','') !~ '^sha256:[0-9a-f]{64}$'
    OR length(COALESCE(p_receipt->>'sourceRevision','')) NOT BETWEEN 1 AND 1024
    OR p_receipt->>'requestStartedAt' IS NULL OR p_receipt->>'requestCompletedAt' IS NULL
    THEN RETURN false; END IF;
  started := (p_receipt->>'requestStartedAt')::timestamptz;
  completed := (p_receipt->>'requestCompletedAt')::timestamptz;
  RETURN isfinite(started) AND isfinite(completed) AND started<=completed
    AND completed<=clock_timestamp()+interval '30 seconds'
    AND started>=clock_timestamp()-interval '90 seconds';
EXCEPTION WHEN invalid_text_representation OR invalid_datetime_format OR datetime_field_overflow
  OR numeric_value_out_of_range THEN RETURN false;
END;
$$;
REVOKE ALL ON FUNCTION public.weekly_stat_receipt_is_valid(jsonb,jsonb,integer) FROM PUBLIC;

CREATE FUNCTION public.claim_weekly_stat_job(
  p_mode text,p_period jsonb,p_worker text,p_lease_seconds integer,p_deadline timestamptz,p_capture jsonb
)
RETURNS TABLE(kind text,generation integer,lease_until text,deadline_at text,next_request_at text)
LANGUAGE plpgsql VOLATILE
SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE job public.projection_jobs%ROWTYPE; next_at timestamptz; started timestamptz; schedule_at timestamptz;
BEGIN
  IF p_mode IS NULL OR p_mode NOT IN ('shadow','backfill','recurring','live-defense')
    OR p_worker IS NULL OR btrim(p_worker)='' OR p_lease_seconds IS NULL OR p_deadline IS NULL
    OR p_lease_seconds NOT BETWEEN 1 AND 3600 OR p_deadline<=clock_timestamp()
    OR p_deadline>clock_timestamp()+interval '1 hour'
    OR jsonb_typeof(p_period) IS DISTINCT FROM 'object'
    OR jsonb_typeof(p_period->'season') IS DISTINCT FROM 'number'
    OR jsonb_typeof(p_period->'week') IS DISTINCT FROM 'number'
    OR (p_period->>'season')::integer NOT BETWEEN 2026 AND 2200
    OR p_period->>'seasonType' IS DISTINCT FROM 'reg'
    OR (p_period->>'week')::integer NOT BETWEEN 1 AND 18
    OR NOT (p_period ?& ARRAY['season','seasonType','week'])
    OR (p_capture IS NOT NULL AND p_mode<>'recurring') THEN
    RAISE EXCEPTION 'weekly statistics job claim input is invalid';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('all-player-ingestion:sleeper',0));
  SELECT * INTO job FROM public.projection_jobs WHERE job_key='all-player-ingestion:sleeper' FOR UPDATE;
  started:=clock_timestamp(); schedule_at:=public.all_player_request_clock();
  next_at:=CASE WHEN p_mode='live-defense'
    THEN public.weekly_stat_next_request_at(COALESCE(job.payload,'{}'::jsonb),schedule_at)
    ELSE GREATEST(public.all_player_hourly_request_at(COALESCE(job.payload,'{}'::jsonb),schedule_at),
      (job.payload->>'nextAttemptAt')::timestamptz,
      CASE WHEN p_capture IS NULL THEN public.weekly_stat_next_request_at(
        COALESCE(job.payload,'{}'::jsonb),schedule_at) ELSE NULL END) END;
  IF job.state='running' AND job.lease_until>started THEN
    RETURN QUERY SELECT 'busy'::text,NULL::integer,NULL::text,NULL::text,next_at::text; RETURN;
  END IF;
  IF p_capture IS NOT NULL AND (
    p_capture IS DISTINCT FROM job.payload->'lastWeeklyCapture'
    OR NOT public.weekly_stat_receipt_is_valid(p_capture,p_period,(p_capture->>'requestGeneration')::integer)
  ) THEN RAISE EXCEPTION 'shared weekly statistics receipt is unavailable'; END IF;
  IF p_mode='live-defense' AND (
    NOT public.live_weekly_stat_period_is_current(p_period)
    OR (extract(minute FROM schedule_at AT TIME ZONE 'America/New_York') IN (0,1)
      AND GREATEST(public.all_player_hourly_request_at(COALESCE(job.payload,'{}'::jsonb),schedule_at),
        (job.payload->>'nextAttemptAt')::timestamptz)<=schedule_at)
  ) THEN
    -- Minutes zero and one belong to a due hourly capture/correction. This protects the
    -- existing finite previous-week correction selection from live starvation.
    RETURN QUERY SELECT 'not-due'::text,NULL::integer,NULL::text,NULL::text,
      (date_trunc('minute',schedule_at)+interval '1 minute')::text; RETURN;
  END IF;
  IF next_at>schedule_at THEN
    RETURN QUERY SELECT 'not-due'::text,NULL::integer,NULL::text,NULL::text,next_at::text; RETURN;
  END IF;
  IF job.state='running' AND job.lease_until<=started THEN
    job.payload:=job.payload||jsonb_build_object('lastInterruptedOutcome',jsonb_build_object(
      'outcome','lease-lost','stage','expired-before-completion','period',job.payload->'period',
      'generation',job.attempt_count,'leaseUntil',job.lease_until,'detectedAt',started));
  END IF;
  INSERT INTO public.projection_jobs AS target(
    job_key,job_type,scheduled_for,state,payload,lease_owner,lease_until,attempt_count,updated_at
  ) VALUES (
    'all-player-ingestion:sleeper','all-player-ingestion',started,'running',
    COALESCE(job.payload,'{}'::jsonb)||jsonb_build_object('version','shared-weekly-statistics-v1',
      'mode',p_mode,'period',p_period,'deadlineAt',p_deadline,'requestGeneration',NULL,
      'sharedCaptureReceipt',p_capture),p_worker,started+p_lease_seconds*interval '1 second',
    COALESCE(job.attempt_count,0)+1,started
  ) ON CONFLICT(job_key) DO UPDATE SET state=EXCLUDED.state,scheduled_for=EXCLUDED.scheduled_for,
    payload=EXCLUDED.payload,lease_owner=EXCLUDED.lease_owner,lease_until=EXCLUDED.lease_until,
    attempt_count=EXCLUDED.attempt_count,updated_at=EXCLUDED.updated_at,completed_at=NULL,last_error=NULL
  RETURNING * INTO job;
  RETURN QUERY SELECT 'acquired'::text,job.attempt_count,job.lease_until::text,
    (job.payload->>'deadlineAt')::text,next_at::text;
END;
$$;
REVOKE ALL ON FUNCTION public.claim_weekly_stat_job(text,jsonb,text,integer,timestamptz,jsonb) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.claim_all_player_job(
  p_mode text,p_period jsonb,p_worker text,p_lease_seconds integer,p_deadline timestamptz
)
RETURNS TABLE(kind text,generation integer,lease_until text,deadline_at text,next_request_at text)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  IF p_mode NOT IN ('shadow','backfill','recurring') THEN RAISE EXCEPTION 'all-player job mode is invalid'; END IF;
  RETURN QUERY SELECT * FROM public.claim_weekly_stat_job(p_mode,p_period,p_worker,p_lease_seconds,p_deadline,NULL);
END;
$$;
REVOKE ALL ON FUNCTION public.claim_all_player_job(text,jsonb,text,integer,timestamptz) FROM PUBLIC;

CREATE FUNCTION public.claim_live_defense_stat_job(p_period jsonb,p_worker text,p_lease_seconds integer,p_deadline timestamptz)
RETURNS TABLE(kind text,generation integer,lease_until text,deadline_at text,next_request_at text)
LANGUAGE sql VOLATILE SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp AS $$
  SELECT * FROM public.claim_weekly_stat_job('live-defense',p_period,p_worker,p_lease_seconds,p_deadline,NULL)
$$;
REVOKE ALL ON FUNCTION public.claim_live_defense_stat_job(jsonb,text,integer,timestamptz) FROM PUBLIC;

CREATE FUNCTION public.claim_shared_all_player_job(
  p_period jsonb,p_worker text,p_lease_seconds integer,p_deadline timestamptz,p_capture jsonb
)
RETURNS TABLE(kind text,generation integer,lease_until text,deadline_at text,next_request_at text)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  IF p_capture IS NULL THEN RAISE EXCEPTION 'shared weekly statistics receipt is required'; END IF;
  RETURN QUERY SELECT * FROM public.claim_weekly_stat_job('recurring',p_period,p_worker,p_lease_seconds,p_deadline,p_capture);
END;
$$;
REVOKE ALL ON FUNCTION public.claim_shared_all_player_job(jsonb,text,integer,timestamptz,jsonb) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.mark_all_player_request(p_fence jsonb,p_period jsonb)
RETURNS boolean LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE job public.projection_jobs%ROWTYPE; started timestamptz; starts jsonb; capture jsonb; live boolean;
BEGIN
  SELECT * INTO job FROM public.projection_jobs WHERE job_key='all-player-ingestion:sleeper' FOR UPDATE;
  IF NOT FOUND OR public.all_player_job_fence_is_live(p_fence) IS DISTINCT FROM true
    OR job.payload->'period' IS DISTINCT FROM p_period
    OR (job.payload->>'requestGeneration')::integer=job.attempt_count THEN RETURN false; END IF;
  started:=public.all_player_request_clock(); live:=job.payload->>'mode'='live-defense';
  capture:=NULLIF(job.payload->'sharedCaptureReceipt','null'::jsonb);
  IF live AND (NOT public.live_weekly_stat_period_is_current(p_period)
    OR (extract(minute FROM started AT TIME ZONE 'America/New_York') IN (0,1)
      AND GREATEST(public.all_player_hourly_request_at(job.payload,started),
        (job.payload->>'nextAttemptAt')::timestamptz)<=started)) THEN RETURN false; END IF;
  IF capture IS NOT NULL THEN
    IF capture IS DISTINCT FROM job.payload->'lastWeeklyCapture'
      OR NOT public.weekly_stat_receipt_is_valid(capture,p_period,(capture->>'requestGeneration')::integer)
      THEN RETURN false; END IF;
  ELSIF public.weekly_stat_next_request_at(job.payload,started)>started THEN RETURN false; END IF;
  IF NOT live THEN
    IF public.all_player_hourly_request_at(job.payload,started)>started THEN RETURN false; END IF;
    SELECT COALESCE(jsonb_agg(value ORDER BY value::timestamptz),'[]'::jsonb) INTO starts
      FROM jsonb_array_elements_text(COALESCE(job.payload->'requestStarts','[]'::jsonb)) value
      WHERE value::timestamptz>started-interval '24 hours';
    IF jsonb_array_length(starts)>=13 THEN RETURN false; END IF;
  END IF;
  UPDATE public.projection_jobs SET payload=payload||jsonb_build_object(
    'requestGeneration',job.attempt_count,'lastRequestPeriod',p_period)
    ||CASE WHEN live THEN '{}'::jsonb ELSE jsonb_build_object('requestStarts',starts||to_jsonb(started)) END
    ||CASE WHEN capture IS NULL THEN jsonb_build_object('lastWeeklyRequestAt',started,
        'lastWeeklyRequestGeneration',job.attempt_count,'lastWeeklyRequestPeriod',p_period)
      ELSE '{}'::jsonb END,updated_at=clock_timestamp() WHERE job_key=job.job_key;
  RETURN true;
END;
$$;
REVOKE ALL ON FUNCTION public.mark_all_player_request(jsonb,jsonb) FROM PUBLIC;

CREATE FUNCTION public.finish_live_defense_stat_request(p_fence jsonb,p_outcome text,p_capture jsonb)
RETURNS boolean LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE job public.projection_jobs%ROWTYPE; completed timestamptz;
BEGIN
  IF p_outcome IS NULL OR p_outcome NOT IN ('captured','provider-failed','validation-failed','timeout')
    OR (p_outcome='captured') IS DISTINCT FROM (p_capture IS NOT NULL)
    THEN RAISE EXCEPTION 'live defense capture outcome is invalid'; END IF;
  SELECT * INTO job FROM public.projection_jobs WHERE job_key='all-player-ingestion:sleeper' FOR UPDATE;
  -- A timeout may be recorded during reserved handling time after the operation
  -- deadline. An expired or replaced lease can never record completion.
  IF NOT FOUND OR job.payload->>'mode' IS DISTINCT FROM 'live-defense'
    OR jsonb_typeof(p_fence) IS DISTINCT FROM 'object'
    OR NOT (p_fence ?& ARRAY['jobKey','workerId','generation','leaseUntil','deadlineAt'])
    OR job.state IS DISTINCT FROM 'running' OR job.lease_owner IS DISTINCT FROM p_fence->>'workerId'
    OR job.attempt_count IS DISTINCT FROM (p_fence->>'generation')::integer
    OR job.lease_until IS DISTINCT FROM (p_fence->>'leaseUntil')::timestamptz
    OR (job.payload->>'deadlineAt')::timestamptz IS DISTINCT FROM (p_fence->>'deadlineAt')::timestamptz
    OR job.lease_until<=clock_timestamp() OR p_fence->>'jobKey' IS DISTINCT FROM job.job_key
    THEN RETURN false; END IF;
  completed:=clock_timestamp();
  -- Ownership/order is proved by the atomic request generation and caller's
  -- awaited reservation, not millisecond alignment of separate host clocks.
  -- Source timestamps remain ordered and within the bounded freshness window.
  IF p_outcome='captured' AND (
    (job.payload->>'deadlineAt')::timestamptz<=completed
    OR (job.payload->>'requestGeneration')::integer IS DISTINCT FROM job.attempt_count
    OR NOT public.weekly_stat_receipt_is_valid(p_capture,job.payload->'period',job.attempt_count)
  ) THEN RETURN false; END IF;
  UPDATE public.projection_jobs SET state=CASE WHEN p_outcome='captured' THEN 'completed' ELSE 'failed' END,
    completed_at=completed,lease_owner=NULL,lease_until=NULL,updated_at=completed,
    last_error=CASE WHEN p_outcome='captured' THEN NULL ELSE p_outcome END,
    payload=payload||jsonb_build_object('lastLiveDefenseOutcome',jsonb_build_object('outcome',p_outcome,
      'finishedAt',completed,'period',job.payload->'period','generation',job.attempt_count))
      ||CASE WHEN p_outcome='captured' THEN jsonb_build_object('lastWeeklyCapture',p_capture,
          'lastWeeklyRequestAt',GREATEST((job.payload->>'lastWeeklyRequestAt')::timestamptz,
            (p_capture->>'requestStartedAt')::timestamptz))
        ELSE '{}'::jsonb END
    WHERE job_key=job.job_key;
  RETURN true;
END;
$$;
REVOKE ALL ON FUNCTION public.finish_live_defense_stat_request(jsonb,text,jsonb) FROM PUBLIC;

-- Preserve the installed durable hourly outcome contract while refusing a
-- live-only request fence; its separate completion cannot rewrite periodHistory.
CREATE OR REPLACE FUNCTION public.finish_all_player_job(p_fence jsonb, p_outcome text, p_diagnostic jsonb)
RETURNS boolean LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE job public.projection_jobs%ROWTYPE; completed timestamptz; result jsonb; history jsonb; summary jsonb; prior_final jsonb; publication jsonb;
  response jsonb; pregame jsonb; proof_at timestamptz; first_kickoff timestamptz; game_count integer;
  stored_final boolean := false; stored_observed_at timestamptz; expected_count integer; actual_count integer;
BEGIN
  IF p_outcome IS NULL OR p_outcome NOT IN ('published','partial','no-statistics-yet','validation-failed','provider-failed','timeout','lease-lost')
    OR jsonb_typeof(p_diagnostic) IS DISTINCT FROM 'object'
    OR octet_length(p_diagnostic::text) > 16000 THEN
    RAISE EXCEPTION 'all-player durable outcome is invalid';
  END IF;
  SELECT * INTO job FROM public.projection_jobs
    WHERE job_key = 'all-player-ingestion:sleeper' FOR UPDATE;
  -- Deadline expiry can be recorded during reserved handling time; ownership and
  -- lease expiry are always enforced, including failed completion.
  IF NOT FOUND OR job.payload->>'mode' IS NULL
    OR job.payload->>'mode' NOT IN ('shadow','backfill','recurring')
    OR jsonb_typeof(p_fence) IS DISTINCT FROM 'object'
    OR NOT (p_fence ?& ARRAY['jobKey','workerId','generation','leaseUntil','deadlineAt'])
    OR job.state IS DISTINCT FROM 'running'
    OR job.lease_owner IS DISTINCT FROM p_fence->>'workerId'
    OR job.attempt_count IS DISTINCT FROM (p_fence->>'generation')::integer
    OR job.lease_until IS DISTINCT FROM (p_fence->>'leaseUntil')::timestamptz
    OR (job.payload->>'deadlineAt')::timestamptz IS DISTINCT FROM (p_fence->>'deadlineAt')::timestamptz
    OR job.lease_until <= clock_timestamp()
    OR p_fence->>'jobKey' IS DISTINCT FROM job.job_key THEN RETURN false; END IF;
  completed := clock_timestamp();
  IF p_outcome IN ('published','no-statistics-yet') AND (job.payload->>'deadlineAt')::timestamptz <= completed
    THEN RETURN false; END IF;
  IF p_outcome = 'no-statistics-yet' THEN
    BEGIN
    response := p_diagnostic->'responseEvidence'; pregame := p_diagnostic->'pregameEvidence';
    IF job.payload->>'mode' IS DISTINCT FROM 'recurring'
      OR (job.payload->>'requestGeneration')::integer IS DISTINCT FROM job.attempt_count
      OR (job.payload->'lastPublication'->>'generation')::integer = job.attempt_count
      OR p_diagnostic->>'reason' IS DISTINCT FROM 'no-statistics-yet'
      OR p_diagnostic->>'stage' IS DISTINCT FROM 'no-statistics-yet'
      OR p_diagnostic->'period' IS DISTINCT FROM jsonb_build_object('season',job.payload->'period'->'season',
        'seasonType','regular','week',job.payload->'period'->'week')
      OR p_diagnostic->'finalCoverage' IS DISTINCT FROM 'false'::jsonb
      OR p_diagnostic->>'retryDisposition' IS DISTINCT FROM 'global-budget'
      OR jsonb_typeof(response) IS DISTINCT FROM 'object'
      OR response->>'bodyShape' IS DISTINCT FROM 'object'
      OR response->'topLevelCount' IS DISTINCT FROM '0'::jsonb
      OR jsonb_typeof(response->'httpStatus') IS DISTINCT FROM 'number'
      OR (response->>'httpStatus')::integer NOT BETWEEN 200 AND 299
      OR COALESCE(response->>'bodyHash','') !~ '^sha256:[0-9a-f]{64}$'
      OR jsonb_typeof(pregame) IS DISTINCT FROM 'object'
      OR pregame->>'policy' IS DISTINCT FROM 'exact-period-pregame-v1'
      OR jsonb_typeof(pregame->'scheduledGameCount') IS DISTINCT FROM 'number'
      OR COALESCE(pregame->>'scheduleRevision','') !~ '^sha256:[0-9a-f]{64}$'
      OR p_diagnostic->'entryCount' IS DISTINCT FROM '0'::jsonb
      OR p_diagnostic->'scoringProfileCount' IS DISTINCT FROM '0'::jsonb
      THEN RETURN false; END IF;
      proof_at := (pregame->>'verifiedAt')::timestamptz;
      IF proof_at IS NULL OR NOT isfinite(proof_at) OR proof_at > completed
        OR proof_at < completed - interval '90 seconds'
        OR (response->>'requestStartedAt')::timestamptz IS NULL
        OR (response->>'requestCompletedAt')::timestamptz IS NULL
        OR NOT isfinite((response->>'requestStartedAt')::timestamptz)
        OR NOT isfinite((response->>'requestCompletedAt')::timestamptz)
        OR (response->>'requestStartedAt')::timestamptz > (response->>'requestCompletedAt')::timestamptz
        OR (response->>'requestCompletedAt')::timestamptz > proof_at
        OR (response->>'requestCompletedAt')::timestamptz < completed - interval '90 seconds'
        THEN RETURN false; END IF;
      -- A healthy pregame result belongs only to the currently active period
      -- of every enrolled league. Missing registration/authority fails closed.
      IF NOT EXISTS (SELECT 1 FROM public.league_administration_enrollment_seasons
          WHERE provider='sleeper' AND season=(job.payload->'period'->>'season')::integer)
        OR EXISTS (
          SELECT 1 FROM public.league_administration_enrollment_seasons enrollment
          JOIN public.leagues league ON league.id=enrollment.league_id
          LEFT JOIN public.league_seasons season ON season.league_id=enrollment.league_id
            AND season.season=enrollment.season
          LEFT JOIN public.league_source_connections connection ON connection.league_season_id=season.id
            AND connection.provider='sleeper'
          LEFT JOIN public.league_period_authorities authority ON authority.league_key=league.league_key
          WHERE enrollment.provider='sleeper' AND enrollment.season=(job.payload->'period'->>'season')::integer
            AND (authority.source_provider IS DISTINCT FROM 'sleeper'
              OR connection.external_league_id IS NULL
              OR authority.source_external_league_id IS DISTINCT FROM connection.external_league_id
              OR authority.league_lifecycle IS DISTINCT FROM 'active'
              OR authority.active_season IS DISTINCT FROM enrollment.season
              OR authority.active_season_type IS DISTINCT FROM 'reg'
              OR authority.active_week IS DISTINCT FROM (job.payload->'period'->>'week')::integer
              OR authority.verified_at IS NULL OR authority.verified_at < completed-interval '10 minutes'
              OR authority.verified_at > completed+interval '30 seconds'))
        THEN RETURN false; END IF;
      SELECT count(*),min(game.kickoff_at) INTO game_count,first_kickoff
        FROM public.nfl_games game
        WHERE game.season=(job.payload->'period'->>'season')::integer
          AND game.season_type='reg' AND game.week=(job.payload->'period'->>'week')::integer;
      IF game_count = 0 OR game_count IS DISTINCT FROM (pregame->>'scheduledGameCount')::integer
        OR first_kickoff IS NULL OR first_kickoff <= completed
        OR first_kickoff IS DISTINCT FROM (pregame->>'firstKickoffAt')::timestamptz
        OR EXISTS (SELECT 1 FROM public.nfl_games game
          WHERE game.season=(job.payload->'period'->>'season')::integer
            AND game.season_type='reg' AND game.week=(job.payload->'period'->>'week')::integer
            AND (game.kickoff_at IS NULL OR EXISTS (
              SELECT 1 FROM public.game_state_observations state WHERE state.nfl_game_id=game.id
                AND state.provider='tank01' AND state.status_code IN (1,2,4))))
        THEN RETURN false; END IF;
    EXCEPTION WHEN invalid_text_representation OR invalid_datetime_format OR datetime_field_overflow
      OR numeric_value_out_of_range THEN RETURN false;
    END;
  END IF;
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
    state = CASE WHEN p_outcome IN ('published','partial','no-statistics-yet') THEN 'completed' ELSE 'failed' END,
    completed_at = completed, lease_owner = NULL, lease_until = NULL, updated_at = completed,
    last_error = CASE WHEN p_outcome IN ('published','partial','no-statistics-yet') THEN NULL ELSE p_outcome END,
    payload = payload || jsonb_build_object('lastOutcome', result, 'periodHistory', history,
      'nextAttemptAt', CASE WHEN (job.payload->>'requestGeneration')::integer IS DISTINCT FROM job.attempt_count
        THEN completed + interval '1 hour' ELSE public.all_player_next_request_at(job.payload) END)
    WHERE job_key = job.job_key
      AND (p_outcome <> 'no-statistics-yet' OR (clock_timestamp() < first_kickoff
        AND clock_timestamp() < (job.payload->>'deadlineAt')::timestamptz
        AND clock_timestamp() < job.lease_until));
  RETURN FOUND;
END;
$$;


DO $$ BEGIN
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='league_one_runtime') THEN
    GRANT EXECUTE ON FUNCTION public.claim_live_defense_stat_job(jsonb,text,integer,timestamptz),
      public.claim_shared_all_player_job(jsonb,text,integer,timestamptz,jsonb),
      public.finish_live_defense_stat_request(jsonb,text,jsonb) TO league_one_runtime;
  END IF;
END $$;
