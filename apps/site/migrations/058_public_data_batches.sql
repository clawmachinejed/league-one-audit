-- CP26 first increment: bounded sequential DATA work under the existing singleton.
-- Source authoring only. This does not qualify active-resource cadence, throughput,
-- other provider owners, installation, or production activation.
-- Each task keeps the existing (worker_id,generation) identity and capture witness.
-- No historical acceptance, receipt, task identity, or prior migration is rewritten.

CREATE FUNCTION public.public_data_batch_capability() RETURNS text
LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,public,pg_temp AS $$
  SELECT 'public-data-batch-v1'::text
$$;

CREATE FUNCTION public.public_data_batch_claim_result(p_job public.projection_jobs) RETURNS jsonb
LANGUAGE sql STABLE SET search_path=pg_catalog,public,pg_temp AS $$
  SELECT jsonb_build_object('kind','acquired','fence',jsonb_build_object(
    'jobKey',p_job.job_key,'workerId',p_job.lease_owner,'generation',p_job.attempt_count,
    'deadlineAt',p_job.payload->>'batchWorkDeadlineAt'),'leaseUntil',p_job.lease_until,
    'admissionDeadlineAt',p_job.payload->>'batchAdmissionDeadlineAt',
    'cleanupDeadlineAt',p_job.payload->>'batchCleanupDeadlineAt')
$$;

CREATE FUNCTION public.assert_public_data_batch_owner(p_fence jsonb) RETURNS void
LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE job public.projection_jobs%ROWTYPE; origin timestamptz;
BEGIN
  IF p_fence IS NULL OR jsonb_typeof(p_fence) IS DISTINCT FROM 'object'
    OR p_fence->>'jobKey' IS DISTINCT FROM 'league-administration-public-intake'
    OR jsonb_typeof(p_fence->'workerId') IS DISTINCT FROM 'string'
    OR p_fence->>'workerId' !~ '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$'
    OR jsonb_typeof(p_fence->'generation') IS DISTINCT FROM 'number'
    OR p_fence->>'generation' !~ '^[1-9][0-9]*$'
    OR (SELECT count(*) FROM jsonb_object_keys(p_fence))<>4
    OR jsonb_typeof(p_fence->'deadlineAt') IS DISTINCT FROM 'string' THEN
    RAISE EXCEPTION 'public batch owner required';
  END IF;
  SELECT * INTO STRICT job FROM public.projection_jobs
    WHERE job_key='league-administration-public-intake' FOR UPDATE;
  origin:=(job.payload->>'batchInvocationStartedAt')::timestamptz;
  IF job.state<>'running' OR job.lease_owner IS DISTINCT FROM p_fence->>'workerId'
    OR job.attempt_count IS DISTINCT FROM (p_fence->>'generation')::integer
    OR job.payload->>'batchPolicy' IS DISTINCT FROM 'public-data-batch-v1'
    OR COALESCE(job.payload->>'batchMode','') NOT IN ('direct','recurring') OR origin IS NULL
    OR NOT isfinite(origin) OR origin>clock_timestamp()
    OR job.lease_until IS DISTINCT FROM origin+interval '25 seconds'
    OR (job.payload->>'batchAdmissionDeadlineAt')::timestamptz IS DISTINCT FROM origin+interval '10 seconds'
    OR (job.payload->>'batchWorkDeadlineAt')::timestamptz IS DISTINCT FROM origin+interval '20 seconds'
    OR (job.payload->>'batchCleanupDeadlineAt')::timestamptz IS DISTINCT FROM origin+interval '22 seconds'
    OR (p_fence->>'deadlineAt')::timestamptz IS DISTINCT FROM origin+interval '20 seconds'
    OR job.lease_until<=clock_timestamp() OR origin+interval '20 seconds'<=clock_timestamp()
    OR (job.payload->>'batchMode'='direct' AND (job.payload->>'policy' IS DISTINCT FROM 'public-data-intake-v1'
      OR job.payload->>'requestId' IS NULL))
    OR (job.payload->>'batchMode'='recurring' AND (job.payload->>'policy' IS DISTINCT FROM 'public-data-refresh-v1'
      OR job.payload->>'mode' IS DISTINCT FROM 'recurring')) THEN
    RAISE EXCEPTION 'public batch owner lost or bounds changed';
  END IF;
END; $$;

CREATE FUNCTION public.begin_public_data_batch(p_worker text,p_invocation_started_at timestamptz,p_request uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE job public.projection_jobs%ROWTYPE; state_payload jsonb; current_time_value timestamptz:=clock_timestamp();
BEGIN
  IF p_worker IS NULL OR p_worker !~ '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$'
    OR p_invocation_started_at IS NULL OR NOT isfinite(p_invocation_started_at)
    OR p_invocation_started_at>current_time_value THEN RAISE EXCEPTION 'invalid public batch origin'; END IF;
  -- Same >=15s initial work admission rule as the existing runtime; no rebased clock.
  IF p_invocation_started_at+interval '5 seconds'<current_time_value THEN RETURN jsonb_build_object('kind','deadline'); END IF;
  IF p_request IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.public_data_intakes WHERE id=p_request) THEN
    RAISE EXCEPTION 'public batch request missing';
  END IF;
  IF EXISTS(SELECT 1 FROM public.public_data_dispatches WHERE worker_id=p_worker)
    OR EXISTS(SELECT 1 FROM public.public_data_refresh_selection_failures WHERE worker_id=p_worker) THEN
    RAISE EXCEPTION 'public batch worker identity reused';
  END IF;
  state_payload:=CASE WHEN p_request IS NULL THEN jsonb_build_object('policy','public-data-refresh-v1','mode','recurring','batchMode','recurring')
    ELSE jsonb_build_object('policy','public-data-intake-v1','requestId',p_request,'batchMode','direct') END
    ||jsonb_build_object('batchPolicy','public-data-batch-v1','batchInvocationStartedAt',p_invocation_started_at,
      'batchAdmissionDeadlineAt',p_invocation_started_at+interval '10 seconds',
      'batchWorkDeadlineAt',p_invocation_started_at+interval '20 seconds',
      'batchCleanupDeadlineAt',p_invocation_started_at+interval '22 seconds');
  INSERT INTO public.projection_jobs(job_key,job_type,scheduled_for,state,payload,lease_owner,lease_until,attempt_count,updated_at)
    VALUES('league-administration-public-intake','league-administration-public-intake',
      date_trunc('minute',p_invocation_started_at),'running',state_payload,p_worker,
      p_invocation_started_at+interval '25 seconds',1,clock_timestamp())
    ON CONFLICT(job_key) DO UPDATE SET job_type=EXCLUDED.job_type,scheduled_for=EXCLUDED.scheduled_for,
      state='running',payload=EXCLUDED.payload,lease_owner=EXCLUDED.lease_owner,lease_until=EXCLUDED.lease_until,
      attempt_count=projection_jobs.attempt_count+1,last_error=NULL,completed_at=NULL,updated_at=clock_timestamp()
    WHERE (projection_jobs.state IN ('pending','failed') AND EXCLUDED.scheduled_for>=projection_jobs.scheduled_for)
      OR (projection_jobs.state='running' AND projection_jobs.lease_until<clock_timestamp()
        AND EXCLUDED.scheduled_for>=projection_jobs.scheduled_for)
      OR (projection_jobs.state='completed' AND EXCLUDED.scheduled_for>projection_jobs.scheduled_for)
    RETURNING * INTO job;
  IF NOT FOUND THEN RETURN jsonb_build_object('kind','busy'); END IF;
  -- A preceding row-lock wait may exhaust the ORIGINAL admission budget.
  IF p_invocation_started_at+interval '10 seconds'<=clock_timestamp() THEN
    RAISE EXCEPTION 'public batch admission deadline elapsed';
  END IF;
  PERFORM public.assert_public_data_batch_owner(public.public_data_batch_claim_result(job)->'fence');
  RETURN public.public_data_batch_claim_result(job);
END; $$;

CREATE FUNCTION public.advance_public_data_batch_owner(p_fence jsonb,p_next_worker text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE job public.projection_jobs%ROWTYPE; dispatch public.public_data_dispatches%ROWTYPE; next_payload jsonb;
BEGIN
  PERFORM public.assert_public_data_batch_owner(p_fence);
  SELECT * INTO STRICT job FROM public.projection_jobs WHERE job_key=p_fence->>'jobKey';
  IF (job.payload->>'batchAdmissionDeadlineAt')::timestamptz<=clock_timestamp() THEN RETURN jsonb_build_object('kind','deadline'); END IF;
  IF p_next_worker IS NULL OR p_next_worker !~ '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$'
    OR p_next_worker=job.lease_owner OR EXISTS(SELECT 1 FROM public.public_data_dispatches WHERE worker_id=p_next_worker)
    OR EXISTS(SELECT 1 FROM public.public_data_refresh_selection_failures WHERE worker_id=p_next_worker) THEN
    RAISE EXCEPTION 'fresh public batch worker required';
  END IF;
  SELECT * INTO STRICT dispatch FROM public.public_data_dispatches
    WHERE worker_id=job.lease_owner AND generation=job.attempt_count;
  IF dispatch.intake_id::text IS DISTINCT FROM job.payload->>'requestId'
    OR NOT EXISTS(SELECT 1 FROM public.public_data_dispatch_outcomes outcome
      WHERE outcome.worker_id=dispatch.worker_id AND outcome.generation=dispatch.generation AND outcome.outcome='checkpoint-committed')
    OR EXISTS(SELECT 1 FROM public.league_roster_resource_attempts attempt WHERE attempt.write_fence=p_fence
      AND NOT EXISTS(SELECT 1 FROM public.league_roster_capture_receipts receipt WHERE receipt.attempt_id=attempt.id))
    OR (job.payload->>'batchMode'='recurring' AND (job.payload->'refreshSelection'->>'requestId' IS DISTINCT FROM dispatch.intake_id::text
      OR job.payload->'refreshSelection'->>'status' IS DISTINCT FROM 'selected')) THEN
    RAISE EXCEPTION 'public batch prior task is not fully checkpointed';
  END IF;
  -- Runtime must await every preceding provider/SQL promise before advancing.
  -- A fresh worker UUID also fences generic completeJob/failJob, which match owner.
  next_payload:=CASE WHEN job.payload->>'batchMode'='recurring'
    THEN job.payload-ARRAY['requestId','refreshSelection'] ELSE job.payload END;
  PERFORM public.assert_public_data_batch_owner(p_fence);
  IF (job.payload->>'batchAdmissionDeadlineAt')::timestamptz<=clock_timestamp() THEN RETURN jsonb_build_object('kind','deadline'); END IF;
  UPDATE public.projection_jobs SET lease_owner=p_next_worker,attempt_count=attempt_count+1,
    payload=next_payload,updated_at=clock_timestamp()
    WHERE job_key=job.job_key AND state='running' AND lease_owner=job.lease_owner AND attempt_count=job.attempt_count
    RETURNING * INTO STRICT job;
  RETURN public.public_data_batch_claim_result(job);
END; $$;

-- Conservative reservation accounting, not a replacement source cache or HTTP feed.
-- A call may start up to20s after admission:80s/3620s reservation windows bound
-- actual60s/3600s HTTP windows. Failed, crashed and unused reservations are never refunded.
-- Reports are POST; charging them too is stricter than CP1's unchanged GET wording.
CREATE FUNCTION public.public_data_batch_budget_available(p_cost integer) RETURNS boolean
LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE budget_now timestamptz:=clock_timestamp(); minute_total bigint; hour_total bigint;
BEGIN
  IF p_cost IS NULL OR p_cost NOT BETWEEN 1 AND 2 THEN RAISE EXCEPTION 'invalid public request reservation'; END IF;
  -- Every caller first locks and authenticates the SAME public job row.
  SELECT COALESCE(sum(reserved.cost) FILTER(WHERE reserved.at_time>budget_now-interval '80 seconds'),0),
    COALESCE(sum(reserved.cost),0) INTO minute_total,hour_total
    FROM (SELECT dispatch.admitted_at AS at_time,dispatch.max_requests AS cost FROM public.public_data_dispatches dispatch
      WHERE dispatch.admitted_at>budget_now-interval '3620 seconds'
      UNION ALL SELECT attempt.reserved_at,1 FROM public.league_player_directory_attempts attempt
      WHERE attempt.reserved_at>budget_now-interval '3620 seconds') reserved;
  RETURN minute_total+p_cost<=40 AND hour_total+p_cost<=1800;
END; $$;

CREATE FUNCTION public.next_public_data_batch_intake(p_id uuid) RETURNS jsonb
LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
  -- Preserve the existing task order, including exact-period settings before core.
  -- Reordering those receipts would change the current-head reader contract.
  SELECT public.next_public_data_intake(p_id)
$$;

CREATE OR REPLACE FUNCTION public.guard_public_data_intake(p_work jsonb,p_fence jsonb) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE request public.public_data_intakes%ROWTYPE; native text:=p_work->>'externalLeagueId';
  batch boolean; dispatch public.public_data_dispatches%ROWTYPE;
BEGIN
  PERFORM public.assert_public_data_owner((p_work->>'requestId')::uuid,p_fence);
  SELECT * INTO STRICT request FROM public.public_data_intakes WHERE id=(p_work->>'requestId')::uuid FOR UPDATE;
  PERFORM public.assert_public_data_owner(request.id,p_fence);
  SELECT payload->>'batchPolicy'='public-data-batch-v1' INTO batch FROM public.projection_jobs WHERE job_key=p_fence->>'jobKey';
  IF batch THEN
    -- Shared registration uses this one established guard-only augmentation.
    -- The claim, admission, advance and capture witness retain exactly four keys.
    IF p_fence ? 'reserveCollection' AND (p_work->>'kind' IS DISTINCT FROM 'bootstrap'
      OR p_fence->'reserveCollection' IS DISTINCT FROM 'true'::jsonb) THEN
      RAISE EXCEPTION 'invalid public batch collection guard';
    END IF;
    PERFORM public.assert_public_data_batch_owner(p_fence-'reserveCollection');
    SELECT * INTO dispatch FROM public.public_data_dispatches WHERE worker_id=p_fence->>'workerId'
      AND generation=(p_fence->>'generation')::integer;
    IF FOUND THEN
      IF dispatch.work IS DISTINCT FROM p_work OR dispatch.intake_id<>request.id OR dispatch.revision<>request.revision
        OR EXISTS(SELECT 1 FROM public.public_data_dispatch_outcomes outcome
          WHERE outcome.worker_id=dispatch.worker_id AND outcome.generation=dispatch.generation) THEN
        RAISE EXCEPTION 'public batch admitted work changed';
      END IF;
    ELSIF public.next_public_data_batch_intake(request.id) IS DISTINCT FROM p_work THEN
      RAISE EXCEPTION 'public batch selection changed';
    END IF;
  ELSIF public.next_public_data_intake(request.id) IS DISTINCT FROM p_work THEN RAISE EXCEPTION 'public intake checkpoint changed'; END IF;
  IF p_work->>'kind'='bootstrap' THEN
    PERFORM pg_advisory_xact_lock(hashtextextended('account-league-enrollment',0));
    PERFORM public.assert_public_data_owner(request.id,p_fence);
    IF p_fence->'reserveCollection'='true'::jsonb
      AND NOT EXISTS(SELECT 1 FROM public.public_data_collection_reservations WHERE external_league_id=native)
      AND NOT EXISTS(SELECT 1 FROM public.league_source_connections connection
        JOIN public.league_seasons season ON season.id=connection.league_season_id
        JOIN public.league_administration_enrollments enrollment ON enrollment.league_id=season.league_id
        WHERE connection.provider='sleeper' AND connection.external_league_id=native) THEN
      PERFORM public.assert_league_collection_capacity(native);
      PERFORM public.assert_public_data_owner(request.id,p_fence);
      INSERT INTO public.public_data_collection_reservations(external_league_id,intake_id) VALUES(native,request.id);
    END IF;
  END IF;
  PERFORM public.assert_public_data_owner(request.id,p_fence);
END; $$;

CREATE FUNCTION public.admit_public_data_batch_dispatch(p_work jsonb,p_fence jsonb) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE job public.projection_jobs%ROWTYPE; cycle_row public.public_data_refresh_cycles%ROWTYPE;
  target public.public_data_refresh_targets%ROWTYPE; configuration public.public_data_refresh_configurations%ROWTYPE;
  selected jsonb; request_cost integer;
BEGIN
  PERFORM public.assert_public_data_batch_owner(p_fence);
  PERFORM public.guard_public_data_intake(p_work,p_fence);
  SELECT * INTO STRICT job FROM public.projection_jobs WHERE job_key=p_fence->>'jobKey';
  IF (job.payload->>'batchAdmissionDeadlineAt')::timestamptz<=clock_timestamp() THEN RETURN false; END IF;
  IF EXISTS(SELECT 1 FROM public.public_data_dispatches WHERE worker_id=p_fence->>'workerId'
    AND generation=(p_fence->>'generation')::integer) THEN RETURN false; END IF;
  SELECT * INTO cycle_row FROM public.public_data_refresh_cycles WHERE intake_id=(p_work->>'requestId')::uuid;
  IF FOUND THEN
    IF job.payload->>'batchMode'<>'recurring' THEN RAISE EXCEPTION 'recurring batch selection required'; END IF;
    PERFORM public.assert_public_refresh_owner(p_fence);
    selected:=job.payload->'refreshSelection';
    SELECT * INTO STRICT target FROM public.public_data_refresh_targets WHERE id=cycle_row.target_id FOR UPDATE;
    PERFORM public.assert_public_data_batch_owner(p_fence);
    IF selected IS DISTINCT FROM jsonb_build_object('status','selected','targetId',target.id,
      'configurationRevision',target.configuration_revision,'cycleConfigurationRevision',cycle_row.configuration_revision,
      'cycle',cycle_row.cycle,'requestId',cycle_row.intake_id) OR target.current_cycle<>cycle_row.cycle THEN RETURN false; END IF;
    SELECT * INTO STRICT configuration FROM public.public_data_refresh_configurations
      WHERE target_id=target.id AND revision=target.configuration_revision;
    IF configuration.paused OR configuration.expires_at<=clock_timestamp()
      OR target.selection_next_eligible_at>clock_timestamp() THEN RETURN false; END IF;
  ELSIF job.payload->>'batchMode'<>'direct' THEN RAISE EXCEPTION 'direct batch request required'; END IF;
  IF EXISTS(SELECT 1 FROM public.public_data_dispatches dispatch WHERE NOT EXISTS(
    SELECT 1 FROM public.public_data_dispatch_outcomes outcome WHERE outcome.worker_id=dispatch.worker_id AND outcome.generation=dispatch.generation)) THEN
    RAISE EXCEPTION 'public dispatch recovery required';
  END IF;
  request_cost:=CASE WHEN p_work->>'kind' IN ('core','exact-matchups','playoff-brackets') THEN 2 ELSE 1 END;
  IF NOT public.public_data_batch_budget_available(request_cost) THEN RETURN false; END IF;
  PERFORM public.assert_public_data_batch_owner(p_fence);
  IF (job.payload->>'batchAdmissionDeadlineAt')::timestamptz<=clock_timestamp() THEN RETURN false; END IF;
  INSERT INTO public.public_data_dispatches(worker_id,generation,intake_id,revision,resource,work,max_requests)
    VALUES(p_fence->>'workerId',(p_fence->>'generation')::integer,(p_work->>'requestId')::uuid,
      (p_work->>'revision')::integer,p_work->>'kind',p_work,request_cost);
  IF cycle_row.intake_id IS NOT NULL THEN
    IF configuration.expires_at<=clock_timestamp() THEN RAISE EXCEPTION 'public refresh approval expired during admission'; END IF;
    UPDATE public.public_data_refresh_targets SET last_served_at=clock_timestamp(),selection_failure_count=0,
      selection_failed_at=NULL,selection_next_eligible_at=clock_timestamp() WHERE id=target.id;
  END IF;
  PERFORM public.assert_public_data_batch_owner(p_fence);
  RETURN true;
END; $$;

-- Keep the historical60s dispatch/catalog spacing and24h catalog rule intact.
-- The additional conservative budget check prevents mixed legacy/batch invocations
-- from escaping the budget. It does not alter any other provider owner's behavior.
ALTER FUNCTION public.admit_public_data_dispatch(jsonb,jsonb) RENAME TO admit_public_data_dispatch_v57;
CREATE FUNCTION public.admit_public_data_dispatch(p_work jsonb,p_fence jsonb) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
  PERFORM public.assert_public_data_owner((p_work->>'requestId')::uuid,p_fence);
  IF EXISTS(SELECT 1 FROM public.projection_jobs WHERE job_key=p_fence->>'jobKey'
    AND payload->>'batchPolicy'='public-data-batch-v1') THEN RAISE EXCEPTION 'explicit public batch admission required'; END IF;
  IF NOT public.public_data_batch_budget_available(
    CASE WHEN p_work->>'kind' IN ('core','exact-matchups','playoff-brackets') THEN 2 ELSE 1 END) THEN RETURN false; END IF;
  RETURN public.admit_public_data_dispatch_v57(p_work,p_fence);
END; $$;
ALTER FUNCTION public.begin_player_directory_attempt(uuid,jsonb) RENAME TO begin_player_directory_attempt_v57;
CREATE FUNCTION public.begin_player_directory_attempt(p_id uuid,p_fence jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
  PERFORM public.assert_player_directory_owner(p_fence);
  IF NOT public.public_data_batch_budget_available(1) THEN
    RETURN jsonb_build_object('status','backoff','retryAt',clock_timestamp()+interval '80 seconds');
  END IF;
  RETURN public.begin_player_directory_attempt_v57(p_id,p_fence);
END; $$;

REVOKE ALL ON FUNCTION public.public_data_batch_capability(),public.public_data_batch_claim_result(public.projection_jobs),
  public.assert_public_data_batch_owner(jsonb),public.begin_public_data_batch(text,timestamptz,uuid),
  public.advance_public_data_batch_owner(jsonb,text),public.public_data_batch_budget_available(integer),
  public.next_public_data_batch_intake(uuid),public.admit_public_data_batch_dispatch(jsonb,jsonb),
  public.admit_public_data_dispatch_v57(jsonb,jsonb),public.begin_player_directory_attempt_v57(uuid,jsonb),
  public.admit_public_data_dispatch(jsonb,jsonb),public.begin_player_directory_attempt(uuid,jsonb) FROM PUBLIC;
DO $$ BEGIN
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='league_one_runtime') THEN
    REVOKE ALL ON FUNCTION public.public_data_batch_claim_result(public.projection_jobs),
      public.assert_public_data_batch_owner(jsonb),public.public_data_batch_budget_available(integer),
      public.admit_public_data_dispatch_v57(jsonb,jsonb),public.begin_player_directory_attempt_v57(uuid,jsonb) FROM league_one_runtime;
    GRANT EXECUTE ON FUNCTION public.public_data_batch_capability(),public.begin_public_data_batch(text,timestamptz,uuid),
      public.advance_public_data_batch_owner(jsonb,text),public.next_public_data_batch_intake(uuid),
      public.admit_public_data_batch_dispatch(jsonb,jsonb),public.admit_public_data_dispatch(jsonb,jsonb),
      public.begin_player_directory_attempt(uuid,jsonb) TO league_one_runtime;
  END IF;
END; $$;
