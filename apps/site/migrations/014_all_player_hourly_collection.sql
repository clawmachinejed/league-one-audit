-- Additive hourly collection policy. Existing immutable observations, scores,
-- pointers, identity guards and live publication fences remain unchanged.
-- Keep recurrence disabled while installing and releasing compatible callers.

-- Production always derives time internally. The owner-only function permits
-- the isolated harness to control schedule time without changing real lease or
-- deadline clocks. There is no runtime setting, parameter or grant to override it.
CREATE FUNCTION public.all_player_request_clock()
RETURNS timestamptz LANGUAGE sql VOLATILE
SET search_path = pg_catalog, public, pg_temp AS $$
  SELECT clock_timestamp()
$$;
REVOKE ALL ON FUNCTION public.all_player_request_clock() FROM PUBLIC;

CREATE FUNCTION public.all_player_hourly_request_at(p_payload jsonb, p_at timestamptz)
RETURNS timestamptz LANGUAGE plpgsql STABLE
SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE candidate timestamptz; latest timestamptz; thirteenth_latest timestamptz;
  eastern timestamp; local_hour integer;
BEGIN
  IF p_at IS NULL THEN RAISE EXCEPTION 'all-player schedule time is required'; END IF;
  SELECT max(value::timestamptz) INTO latest
    FROM jsonb_array_elements_text(COALESCE(p_payload->'requestStarts', '[]'::jsonb)) value;
  -- A slot is the Eastern clock hour, not a sliding 60-minute cooldown. This
  -- prevents a few seconds of cron jitter from skipping every following hour.
  -- Return the slot opening when already due. Returning the server's current
  -- timestamp would always be later than a caller's pre-query clock and cause
  -- that caller to postpone a request indefinitely.
  candidate := GREATEST(date_trunc('hour', p_at, 'America/New_York'),
    date_trunc('hour', latest, 'America/New_York') + interval '1 hour');
  SELECT value::timestamptz INTO thirteenth_latest
    FROM jsonb_array_elements_text(COALESCE(p_payload->'requestStarts', '[]'::jsonb)) value
    ORDER BY value::timestamptz DESC OFFSET 12 LIMIT 1;
  -- Actual request timestamps, rather than rounded slot timestamps, enforce a
  -- strict rolling-24-hour cap even when yesterday's noon request was delayed.
  candidate := GREATEST(candidate, thirteenth_latest + interval '24 hours');
  eastern := candidate AT TIME ZONE 'America/New_York';
  local_hour := extract(hour FROM eastern)::integer;
  IF local_hour BETWEEN 1 AND 11 THEN
    candidate := (date_trunc('day', eastern) + interval '12 hours') AT TIME ZONE 'America/New_York';
  END IF;
  RETURN candidate;
END;
$$;
REVOKE ALL ON FUNCTION public.all_player_hourly_request_at(jsonb, timestamptz) FROM PUBLIC;

-- Preserve the existing read signature and exact runtime grant. Its two pure
-- schedule helpers remain owner-only; this function reads no database objects.
CREATE OR REPLACE FUNCTION public.all_player_next_request_at(p_payload jsonb)
RETURNS timestamptz LANGUAGE sql VOLATILE SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp AS $$
  SELECT public.all_player_hourly_request_at(p_payload, public.all_player_request_clock())
$$;
REVOKE ALL ON FUNCTION public.all_player_next_request_at(jsonb) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.claim_all_player_job(
  p_mode text, p_period jsonb, p_worker text, p_lease_seconds integer, p_deadline timestamptz
)
RETURNS TABLE(kind text, generation integer, lease_until text, deadline_at text, next_request_at text)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE job public.projection_jobs%ROWTYPE; next_at timestamptz; started timestamptz; schedule_at timestamptz;
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
  schedule_at := public.all_player_request_clock();
  next_at := GREATEST(public.all_player_hourly_request_at(COALESCE(job.payload, '{}'::jsonb), schedule_at),
    (job.payload->>'nextAttemptAt')::timestamptz);
  IF job.state = 'running' AND job.lease_until > started THEN
    RETURN QUERY SELECT 'busy'::text, NULL::integer, NULL::text, NULL::text, next_at::text;
    RETURN;
  END IF;
  IF next_at > schedule_at THEN
    RETURN QUERY SELECT 'not-due'::text, NULL::integer, NULL::text, NULL::text, next_at::text;
    RETURN;
  END IF;
  IF job.state = 'running' AND job.lease_until <= started THEN
    job.payload := job.payload || jsonb_build_object('lastInterruptedOutcome', jsonb_build_object(
      'outcome','lease-lost','stage','expired-before-completion','period',job.payload->'period',
      'generation',job.attempt_count,'leaseUntil',job.lease_until,'detectedAt',started));
  END IF;
  INSERT INTO public.projection_jobs AS target (
    job_key, job_type, scheduled_for, state, payload, lease_owner, lease_until,
    attempt_count, updated_at
  ) VALUES (
    'all-player-ingestion:sleeper', 'all-player-ingestion', started, 'running',
    COALESCE(job.payload, '{}'::jsonb) || jsonb_build_object(
      'version', 'all-player-global-hourly-v3', 'mode', p_mode, 'period', p_period,
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

CREATE OR REPLACE FUNCTION public.mark_all_player_request(p_fence jsonb, p_period jsonb)
RETURNS boolean LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE job public.projection_jobs%ROWTYPE; started timestamptz; starts jsonb;
BEGIN
  SELECT * INTO job FROM public.projection_jobs
    WHERE job_key = 'all-player-ingestion:sleeper' FOR UPDATE;
  IF NOT FOUND OR public.all_player_job_fence_is_live(p_fence) IS DISTINCT FROM true
    OR job.payload->'period' IS DISTINCT FROM p_period
    OR (job.payload->>'requestGeneration')::integer = job.attempt_count THEN RETURN false; END IF;
  started := public.all_player_request_clock();
  IF public.all_player_hourly_request_at(job.payload, started) > started THEN RETURN false; END IF;
  SELECT COALESCE(jsonb_agg(value ORDER BY value::timestamptz), '[]'::jsonb) INTO starts
    FROM jsonb_array_elements_text(COALESCE(job.payload->'requestStarts', '[]'::jsonb)) value
    WHERE value::timestamptz > started - interval '24 hours';
  IF jsonb_array_length(starts) >= 13 THEN RETURN false; END IF;
  UPDATE public.projection_jobs SET payload = payload || jsonb_build_object(
    'requestStarts', starts || to_jsonb(started), 'requestGeneration', job.attempt_count,
    'lastRequestPeriod', p_period), updated_at = clock_timestamp()
    WHERE job_key = job.job_key;
  RETURN true;
END;
$$;
REVOKE ALL ON FUNCTION public.mark_all_player_request(jsonb, jsonb) FROM PUBLIC;
