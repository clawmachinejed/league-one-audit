-- CP26 opt-in settlement accounting. No request reservation is refunded.
-- Legacy admission, the original 80s/3620s helper and the catalog stay unchanged.
ALTER TABLE public.public_data_dispatches ADD COLUMN request_budget_policy text
  CHECK(request_budget_policy IS NULL OR request_budget_policy='public-data-settled-request-budget-v1');
ALTER TABLE public.public_data_dispatch_outcomes ADD COLUMN settled_request_upper_bound_at timestamptz;

CREATE FUNCTION public.public_data_settled_request_budget_capability() RETURNS text
LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,public,pg_temp AS $$
  SELECT 'public-data-settled-request-budget-v1'::text
$$;

-- Historical checks deliberately do not call live owner/head guards. The exact
-- original witness and every persisted capture are checked once, at settlement.
CREATE FUNCTION public.public_data_settled_capture_upper_bound(
  p_dispatch public.public_data_dispatches,p_outcome public.public_data_dispatch_outcomes)
RETURNS timestamptz LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE acquisition jsonb:=p_outcome.capture_acquisition; fence jsonb; kind text:=p_dispatch.resource;
  role_names text[]; role_name text; expected_attempt jsonb; captures jsonb:='[]'::jsonb; captured jsonb;
  attempt_row public.league_roster_resource_attempts%ROWTYPE; receipt_row public.league_roster_capture_receipts%ROWTYPE;
  identity_row public.public_data_identity_observations%ROWTYPE; list_row public.public_data_league_lists%ROWTYPE;
  candidate_row public.public_data_league_candidates%ROWTYPE; directory_row public.public_data_directory_captures%ROWTYPE;
  accepted_time timestamptz; started_time timestamptz; completed_time timestamptz; checked_time timestamptz;
  observed_time timestamptz; upper_bound timestamptz; reserved_time timestamptz; recorded_time timestamptz;
BEGIN
  IF p_dispatch.request_budget_policy IS DISTINCT FROM 'public-data-settled-request-budget-v1'
    OR p_outcome.outcome IS DISTINCT FROM 'checkpoint-committed'
    OR p_outcome.worker_id IS DISTINCT FROM p_dispatch.worker_id OR p_outcome.generation IS DISTINCT FROM p_dispatch.generation
    OR p_dispatch.admitted_at IS NULL OR NOT isfinite(p_dispatch.admitted_at)
    OR p_outcome.recorded_at IS NULL OR NOT isfinite(p_outcome.recorded_at)
    OR p_outcome.recorded_at<p_dispatch.admitted_at OR p_outcome.recorded_at>clock_timestamp()
    OR jsonb_typeof(acquisition) IS DISTINCT FROM 'object'
    OR (SELECT count(*) FROM jsonb_object_keys(acquisition))<>6
    OR NOT(acquisition ?& ARRAY['version','work','fence','dispatchNonce','mapping','attempts'])
    OR acquisition->>'version' IS DISTINCT FROM 'public-network-capture-v1'
    OR acquisition->'work' IS DISTINCT FROM p_dispatch.work
    OR acquisition->>'dispatchNonce' IS DISTINCT FROM p_dispatch.capture_nonce::text
    OR p_dispatch.capture_nonce IS NULL
    OR p_dispatch.work->>'requestId' IS DISTINCT FROM p_dispatch.intake_id::text
    OR p_dispatch.work->>'revision' IS DISTINCT FROM p_dispatch.revision::text
    OR p_dispatch.work->>'kind' IS DISTINCT FROM kind
    OR p_dispatch.max_requests IS DISTINCT FROM (CASE WHEN kind IN ('core','exact-matchups','playoff-brackets') THEN 2 ELSE 1 END)
    THEN RETURN NULL; END IF;
  fence:=acquisition->'fence';
  IF jsonb_typeof(fence) IS DISTINCT FROM 'object' OR (SELECT count(*) FROM jsonb_object_keys(fence))<>4
    OR NOT(fence ?& ARRAY['jobKey','workerId','generation','deadlineAt'])
    OR fence->>'jobKey' IS DISTINCT FROM 'league-administration-public-intake'
    OR fence->>'workerId' IS DISTINCT FROM p_dispatch.worker_id
    OR fence->>'generation' IS DISTINCT FROM p_dispatch.generation::text
    OR jsonb_typeof(fence->'deadlineAt') IS DISTINCT FROM 'string'
    OR NOT isfinite((fence->>'deadlineAt')::timestamptz)
    OR (fence->>'deadlineAt')::timestamptz<=p_dispatch.admitted_at
    OR (fence->>'deadlineAt')::timestamptz>p_dispatch.admitted_at+interval '20 seconds'
    OR jsonb_typeof(acquisition->'attempts') IS DISTINCT FROM 'object' THEN RETURN NULL; END IF;
  role_names:=CASE kind
    WHEN 'core' THEN CASE WHEN acquisition->'attempts' ? 'managersV2' THEN ARRAY['settings','players','managers','managersV2'] ELSE ARRAY['settings','players','managers'] END
    WHEN 'exact-matchups' THEN ARRAY['settings','matchups']
    WHEN 'playoff-brackets' THEN ARRAY['winners_bracket','losers_bracket']
    WHEN 'weekly-report' THEN ARRAY['weekly_report'] WHEN 'transactions' THEN ARRAY['transactions']
    WHEN 'drafts' THEN ARRAY[CASE WHEN p_dispatch.work->>'resource' IN ('catalog','detail') THEN 'draftMetadata'
      WHEN p_dispatch.work->>'resource'='selections' THEN 'draftSelections'
      WHEN p_dispatch.work->>'resource' IN ('league-trades','draft-trades') THEN 'tradedPicks' ELSE NULL END]
    WHEN 'identity' THEN ARRAY[]::text[] WHEN 'leagues' THEN ARRAY[]::text[]
    WHEN 'bootstrap' THEN ARRAY[]::text[] WHEN 'users' THEN ARRAY[]::text[] ELSE NULL END;
  IF role_names IS NULL OR array_position(role_names,NULL) IS NOT NULL
    OR (SELECT count(*) FROM jsonb_object_keys(acquisition->'attempts'))<>cardinality(role_names)
    OR NOT(acquisition->'attempts' ?& role_names)
    OR (SELECT count(DISTINCT value->>'id') FROM jsonb_each(acquisition->'attempts'))<>cardinality(role_names)
    OR (SELECT count(DISTINCT value->>'nonce') FROM jsonb_each(acquisition->'attempts'))<>cardinality(role_names)
    OR (SELECT count(*) FROM public.league_roster_resource_attempts attempt WHERE attempt.write_fence=fence)<>cardinality(role_names)
    THEN RETURN NULL; END IF;
  upper_bound:=greatest(p_dispatch.admitted_at,p_outcome.recorded_at);
  IF cardinality(role_names)>0 THEN
    IF jsonb_typeof(acquisition->'mapping') IS DISTINCT FROM 'object' THEN RETURN NULL; END IF;
    FOREACH role_name IN ARRAY role_names LOOP
      expected_attempt:=acquisition->'attempts'->role_name;
      IF jsonb_typeof(expected_attempt) IS DISTINCT FROM 'object'
        OR (SELECT count(*) FROM jsonb_object_keys(expected_attempt))<>2
        OR NOT(expected_attempt ?& ARRAY['id','nonce']) THEN RETURN NULL; END IF;
      SELECT * INTO attempt_row FROM public.league_roster_resource_attempts WHERE id=(expected_attempt->>'id')::uuid;
      IF NOT FOUND OR attempt_row.write_fence IS DISTINCT FROM fence
        OR attempt_row.capture_nonce::text IS DISTINCT FROM expected_attempt->>'nonce'
        OR attempt_row.source_mapping IS DISTINCT FROM acquisition->'mapping' THEN RETURN NULL; END IF;
      SELECT * INTO receipt_row FROM public.league_roster_capture_receipts WHERE attempt_id=attempt_row.id;
      IF NOT FOUND OR receipt_row.provenance->>'origin' IS DISTINCT FROM 'network'
        OR receipt_row.provenance->'acquisition' IS DISTINCT FROM acquisition THEN RETURN NULL; END IF;
      SELECT accepted_at INTO accepted_time FROM public.league_roster_resource_acceptances
        WHERE receipt_id=receipt_row.id AND source_mapping_revision_id=(acquisition->'mapping'->>'revisionId')::uuid;
      IF NOT FOUND OR accepted_time IS NULL OR NOT isfinite(accepted_time)
        OR accepted_time<receipt_row.recorded_at OR accepted_time>p_outcome.recorded_at THEN RETURN NULL; END IF;
      captures:=captures||jsonb_build_array(jsonb_build_object('started',receipt_row.provenance->>'requestStartedAt',
        'completed',receipt_row.provenance->>'requestCompletedAt','observed',receipt_row.provenance->>'sourceObservedAt',
        'checked',receipt_row.provenance->>'checkedAt','reserved',attempt_row.reserved_at,'recorded',receipt_row.recorded_at));
      upper_bound:=greatest(upper_bound,accepted_time);
    END LOOP;
  ELSIF kind='identity' THEN
    IF acquisition->'mapping' IS DISTINCT FROM 'null'::jsonb THEN RETURN NULL; END IF;
    SELECT * INTO identity_row FROM public.public_data_identity_observations WHERE intake_id=p_dispatch.intake_id;
    IF NOT FOUND THEN RETURN NULL; END IF;
    captures:=jsonb_build_array(jsonb_build_object('started',identity_row.request_started_at,'completed',identity_row.request_completed_at,
      'observed',identity_row.request_completed_at,'checked',identity_row.request_completed_at,'reserved',p_dispatch.admitted_at,'recorded',p_outcome.recorded_at));
  ELSIF kind='leagues' THEN
    IF acquisition->'mapping' IS DISTINCT FROM 'null'::jsonb THEN RETURN NULL; END IF;
    SELECT * INTO list_row FROM public.public_data_league_lists WHERE intake_id=p_dispatch.intake_id AND season=(p_dispatch.work->>'season')::integer;
    IF NOT FOUND THEN RETURN NULL; END IF;
    captures:=jsonb_build_array(jsonb_build_object('started',list_row.request_started_at,'completed',list_row.request_completed_at,
      'observed',list_row.request_completed_at,'checked',list_row.request_completed_at,'reserved',p_dispatch.admitted_at,'recorded',p_outcome.recorded_at));
  ELSIF kind='bootstrap' THEN
    IF acquisition->'mapping' IS DISTINCT FROM 'null'::jsonb THEN RETURN NULL; END IF;
    SELECT * INTO candidate_row FROM public.public_data_league_candidates WHERE intake_id=p_dispatch.intake_id
      AND season=(p_dispatch.work->>'season')::integer AND external_league_id=p_dispatch.work->>'externalLeagueId';
    IF NOT FOUND OR candidate_row.bootstrap_payload IS NULL THEN RETURN NULL; END IF;
    captures:=jsonb_build_array(jsonb_build_object('started',candidate_row.bootstrap_started_at,'completed',candidate_row.bootstrap_completed_at,
      'observed',candidate_row.bootstrap_completed_at,'checked',candidate_row.bootstrap_completed_at,'reserved',p_dispatch.admitted_at,'recorded',p_outcome.recorded_at));
  ELSIF kind='users' THEN
    SELECT * INTO directory_row FROM public.public_data_directory_captures
      WHERE worker_id=p_dispatch.worker_id AND generation=p_dispatch.generation AND intake_id=p_dispatch.intake_id;
    IF NOT FOUND OR directory_row.source_mapping IS DISTINCT FROM acquisition->'mapping'
      OR directory_row.source_mapping->'scope'->>'externalLeagueId' IS DISTINCT FROM p_dispatch.work->>'externalLeagueId'
      THEN RETURN NULL; END IF;
    captures:=jsonb_build_array(jsonb_build_object('started',directory_row.request_started_at,'completed',directory_row.request_completed_at,
      'observed',directory_row.source_observed_at,'checked',directory_row.request_completed_at,'reserved',p_dispatch.admitted_at,'recorded',directory_row.recorded_at));
  ELSE RETURN NULL;
  END IF;
  -- Source and SQL clocks are retained independently. Compare each clock domain's
  -- order; the maximum across both domains is conservative without assuming zero skew.
  FOR captured IN SELECT value FROM jsonb_array_elements(captures) LOOP
    started_time:=(captured->>'started')::timestamptz; completed_time:=(captured->>'completed')::timestamptz;
    observed_time:=(captured->>'observed')::timestamptz; checked_time:=(captured->>'checked')::timestamptz;
    reserved_time:=(captured->>'reserved')::timestamptz; recorded_time:=(captured->>'recorded')::timestamptz;
    IF started_time IS NULL OR completed_time IS NULL OR observed_time IS NULL OR checked_time IS NULL
      OR reserved_time IS NULL OR recorded_time IS NULL
      OR NOT isfinite(started_time) OR NOT isfinite(completed_time) OR NOT isfinite(observed_time) OR NOT isfinite(checked_time)
      OR NOT isfinite(reserved_time) OR NOT isfinite(recorded_time)
      OR started_time>completed_time OR observed_time IS DISTINCT FROM completed_time OR checked_time<completed_time
      OR reserved_time<p_dispatch.admitted_at OR recorded_time<reserved_time OR recorded_time>p_outcome.recorded_at
      THEN RETURN NULL; END IF;
    upper_bound:=greatest(upper_bound,completed_time,checked_time,reserved_time,recorded_time);
  END LOOP;
  IF jsonb_array_length(captures)=0 THEN RETURN NULL; END IF;
  RETURN upper_bound;
EXCEPTION WHEN invalid_text_representation OR invalid_datetime_format OR datetime_field_overflow OR numeric_value_out_of_range THEN
  RETURN NULL; -- Malformed retained clocks/identities never shorten a reservation.
END; $$;

CREATE FUNCTION public.record_public_data_settled_request_bound() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE dispatch_row public.public_data_dispatches%ROWTYPE;
BEGIN
  -- Never accept a caller-supplied bound. Existing history remains append-only;
  -- pre-R062 rows are not backfilled, even when their old captures look complete.
  NEW.settled_request_upper_bound_at:=NULL;
  SELECT * INTO dispatch_row FROM public.public_data_dispatches
    WHERE worker_id=NEW.worker_id AND generation=NEW.generation;
  IF FOUND THEN NEW.settled_request_upper_bound_at:=public.public_data_settled_capture_upper_bound(dispatch_row,NEW); END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER public_dispatch_settled_request_bound BEFORE INSERT ON public.public_data_dispatch_outcomes
  FOR EACH ROW EXECUTE FUNCTION public.record_public_data_settled_request_bound();

CREATE FUNCTION public.public_data_settled_request_budget(p_cost integer) RETURNS jsonb
LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE budget_now timestamptz:=clock_timestamp(); minute_ready timestamptz; hour_ready timestamptz; retry_at timestamptz;
BEGIN
  IF p_cost IS NULL OR p_cost NOT BETWEEN 1 AND 2 THEN RAISE EXCEPTION 'invalid settled request reservation'; END IF;
  -- Caller owns the same singleton row lock throughout authority, budget and debit.
  -- Retain the complete reservation weight, even when fewer requests were sent.
  -- New status admission operates at 30 reserved HTTP per rolling minute so a
  -- saturated history lane cannot spend the 1800/hour envelope in 45 minutes.
  -- Public acceptance ceilings remain 40/minute and 1800/hour; old callers are
  -- unchanged. Their reservations and the catalog count against this pace too.
  WITH reservations AS (
    SELECT dispatch.max_requests AS cost,
      CASE WHEN dispatch.request_budget_policy='public-data-settled-request-budget-v1'
        AND outcome.outcome='checkpoint-committed' AND isfinite(outcome.settled_request_upper_bound_at)
        AND outcome.settled_request_upper_bound_at>=dispatch.admitted_at
        THEN least(dispatch.admitted_at+interval '80 seconds',outcome.settled_request_upper_bound_at+interval '60 seconds')
        ELSE dispatch.admitted_at+interval '80 seconds' END AS minute_until,
      CASE WHEN dispatch.request_budget_policy='public-data-settled-request-budget-v1'
        AND outcome.outcome='checkpoint-committed' AND isfinite(outcome.settled_request_upper_bound_at)
        AND outcome.settled_request_upper_bound_at>=dispatch.admitted_at
        THEN least(dispatch.admitted_at+interval '3620 seconds',outcome.settled_request_upper_bound_at+interval '3600 seconds')
        ELSE dispatch.admitted_at+interval '3620 seconds' END AS hour_until
    FROM public.public_data_dispatches dispatch LEFT JOIN public.public_data_dispatch_outcomes outcome
      ON outcome.worker_id=dispatch.worker_id AND outcome.generation=dispatch.generation
    WHERE dispatch.admitted_at>budget_now-interval '3620 seconds'
    UNION ALL SELECT 1,attempt.reserved_at+interval '80 seconds',attempt.reserved_at+interval '3620 seconds'
      FROM public.league_player_directory_attempts attempt WHERE attempt.reserved_at>budget_now-interval '3620 seconds'
  ), minute_expiry AS (SELECT minute_until AS expires_at,sum(cost) AS cost FROM reservations WHERE minute_until>budget_now GROUP BY minute_until),
  hour_expiry AS (SELECT hour_until AS expires_at,sum(cost) AS cost FROM reservations WHERE hour_until>budget_now GROUP BY hour_until),
  minute_release AS (SELECT expires_at,sum(cost) OVER(ORDER BY expires_at) AS released FROM minute_expiry),
  hour_release AS (SELECT expires_at,sum(cost) OVER(ORDER BY expires_at) AS released FROM hour_expiry),
  totals AS (SELECT COALESCE((SELECT sum(cost) FROM minute_expiry),0) AS minute_cost,COALESCE((SELECT sum(cost) FROM hour_expiry),0) AS hour_cost)
  SELECT CASE WHEN minute_cost+p_cost<=30 THEN budget_now ELSE (SELECT min(expires_at) FROM minute_release WHERE released>=minute_cost+p_cost-30) END,
    CASE WHEN hour_cost+p_cost<=1800 THEN budget_now ELSE (SELECT min(expires_at) FROM hour_release WHERE released>=hour_cost+p_cost-1800) END
    INTO minute_ready,hour_ready FROM totals;
  IF minute_ready IS NULL OR hour_ready IS NULL THEN RAISE EXCEPTION 'settled request budget has no bounded eligibility'; END IF;
  retry_at:=greatest(minute_ready,hour_ready);
  IF retry_at<=budget_now THEN RETURN jsonb_build_object('status','admitted'); END IF;
  RETURN jsonb_build_object('status','budget-backoff','serverNow',budget_now,'retryAt',retry_at,
    'retryAfterMs',ceil(extract(epoch FROM retry_at-budget_now)*1000)::bigint);
END; $$;

-- Preserve each existing authority/current-work check before inspecting budget.
-- These new entrypoints leave all historical boolean entrypoints unchanged.
CREATE FUNCTION public.admit_public_data_settled_direct_status(p_work jsonb,p_fence jsonb) RETURNS jsonb
LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE job public.projection_jobs%ROWTYPE; cycle_row public.public_data_refresh_cycles%ROWTYPE;
  target public.public_data_refresh_targets%ROWTYPE; configuration public.public_data_refresh_configurations%ROWTYPE;
  selected jsonb; request_cost integer;
  budget_status jsonb;
BEGIN
  PERFORM public.assert_public_data_batch_owner(p_fence);
  PERFORM public.guard_public_data_intake(p_work,p_fence);
  SELECT * INTO STRICT job FROM public.projection_jobs WHERE job_key=p_fence->>'jobKey';
  IF (job.payload->>'batchAdmissionDeadlineAt')::timestamptz<=clock_timestamp() THEN RETURN jsonb_build_object('status','deadline'); END IF;
  IF EXISTS(SELECT 1 FROM public.public_data_dispatches WHERE worker_id=p_fence->>'workerId'
    AND generation=(p_fence->>'generation')::integer) THEN RETURN jsonb_build_object('status','denied'); END IF;
  SELECT * INTO cycle_row FROM public.public_data_refresh_cycles WHERE intake_id=(p_work->>'requestId')::uuid;
  IF FOUND THEN
    IF job.payload->>'batchMode'<>'recurring' THEN RAISE EXCEPTION 'recurring batch selection required'; END IF;
    PERFORM public.assert_public_refresh_owner(p_fence);
    selected:=job.payload->'refreshSelection';
    SELECT * INTO STRICT target FROM public.public_data_refresh_targets WHERE id=cycle_row.target_id FOR UPDATE;
    PERFORM public.assert_public_data_batch_owner(p_fence);
    IF selected IS DISTINCT FROM jsonb_build_object('status','selected','targetId',target.id,
      'configurationRevision',target.configuration_revision,'cycleConfigurationRevision',cycle_row.configuration_revision,
      'cycle',cycle_row.cycle,'requestId',cycle_row.intake_id) OR target.current_cycle<>cycle_row.cycle THEN RETURN jsonb_build_object('status','denied'); END IF;
    SELECT * INTO STRICT configuration FROM public.public_data_refresh_configurations
      WHERE target_id=target.id AND revision=target.configuration_revision;
    IF configuration.paused OR configuration.expires_at<=clock_timestamp()
      OR target.selection_next_eligible_at>clock_timestamp() THEN RETURN jsonb_build_object('status','denied'); END IF;
  ELSIF job.payload->>'batchMode'<>'direct' THEN RAISE EXCEPTION 'direct batch request required'; END IF;
  IF EXISTS(SELECT 1 FROM public.public_data_dispatches dispatch WHERE NOT EXISTS(
    SELECT 1 FROM public.public_data_dispatch_outcomes outcome WHERE outcome.worker_id=dispatch.worker_id AND outcome.generation=dispatch.generation)) THEN
    RAISE EXCEPTION 'public dispatch recovery required';
  END IF;
  request_cost:=CASE WHEN p_work->>'kind' IN ('core','exact-matchups','playoff-brackets') THEN 2 ELSE 1 END;
  budget_status:=public.public_data_settled_request_budget(request_cost);
  PERFORM public.assert_public_data_batch_owner(p_fence);
  IF (job.payload->>'batchAdmissionDeadlineAt')::timestamptz<=clock_timestamp() THEN RETURN jsonb_build_object('status','deadline'); END IF;
  IF cycle_row.intake_id IS NOT NULL AND configuration.expires_at<=clock_timestamp() THEN RETURN jsonb_build_object('status','denied'); END IF;
  IF budget_status->>'status'='budget-backoff' THEN RETURN budget_status; END IF;
  INSERT INTO public.public_data_dispatches(worker_id,generation,intake_id,revision,resource,work,max_requests,request_budget_policy)
    VALUES(p_fence->>'workerId',(p_fence->>'generation')::integer,(p_work->>'requestId')::uuid,
      (p_work->>'revision')::integer,p_work->>'kind',p_work,request_cost,'public-data-settled-request-budget-v1');
  IF cycle_row.intake_id IS NOT NULL THEN
    IF configuration.expires_at<=clock_timestamp() THEN RAISE EXCEPTION 'public refresh approval expired during admission'; END IF;
    UPDATE public.public_data_refresh_targets SET last_served_at=clock_timestamp(),selection_failure_count=0,
      selection_failed_at=NULL,selection_next_eligible_at=clock_timestamp() WHERE id=target.id;
  END IF;
  PERFORM public.assert_public_data_batch_owner(p_fence);
  RETURN jsonb_build_object('status','admitted');
END; $$;

CREATE FUNCTION public.admit_public_data_batch_dispatch_status(p_work jsonb,p_fence jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE job public.projection_jobs%ROWTYPE; selected public.public_data_resource_selections%ROWTYPE;
  configuration public.public_data_refresh_configurations%ROWTYPE; target public.public_data_refresh_targets%ROWTYPE;
  request_cost integer; admitted_time timestamptz;
  budget_status jsonb;
BEGIN
 PERFORM public.assert_public_data_batch_owner(p_fence);
 SELECT * INTO STRICT job FROM public.projection_jobs WHERE job_key=p_fence->>'jobKey';
 IF job.payload->>'schedulingPolicy' IS DISTINCT FROM 'public-data-resource-schedule-v1' THEN
   RETURN public.admit_public_data_settled_direct_status(p_work,p_fence); END IF;
 PERFORM public.assert_public_data_resource_owner(p_fence);
 PERFORM public.guard_public_data_intake(p_work,p_fence);
 IF (job.payload->>'batchAdmissionDeadlineAt')::timestamptz<=clock_timestamp() THEN RETURN jsonb_build_object('status','deadline'); END IF;
 IF EXISTS(SELECT 1 FROM public.public_data_dispatches WHERE worker_id=p_fence->>'workerId' AND generation=(p_fence->>'generation')::integer) THEN RETURN jsonb_build_object('status','denied'); END IF;
 SELECT * INTO STRICT selected FROM public.public_data_resource_selections WHERE worker_id=p_fence->>'workerId' AND generation=(p_fence->>'generation')::integer;
 IF job.payload->'resourceSelection' IS DISTINCT FROM public.public_data_resource_selection_json(selected)
   OR selected.intake_id::text IS DISTINCT FROM p_work->>'requestId' THEN RAISE EXCEPTION 'public resource admitted selection changed'; END IF;
 IF selected.target_id IS NOT NULL THEN
   SELECT * INTO STRICT target FROM public.public_data_refresh_targets WHERE id=selected.target_id FOR UPDATE;
   IF target.configuration_revision<>selected.configuration_revision THEN RETURN jsonb_build_object('status','denied'); END IF;
   SELECT * INTO STRICT configuration FROM public.public_data_refresh_configurations WHERE target_id=target.id AND revision=target.configuration_revision;
   IF configuration.paused OR configuration.expires_at<=clock_timestamp() THEN RETURN jsonb_build_object('status','denied'); END IF;
 END IF;
 IF selected.lane='active' THEN
   IF NOT public.public_data_resource_authority_valid(selected.resource_id,selected.target_id,selected.configuration_revision)
     OR NOT EXISTS(SELECT 1 FROM public.public_data_resource_occurrences occurrence JOIN public.public_data_resources resource ON resource.id=occurrence.resource_id
       WHERE occurrence.id=selected.intake_id AND resource.id=selected.resource_id AND resource.open_intake_id=occurrence.id
       AND occurrence.source_mapping=resource.source_mapping) THEN RETURN jsonb_build_object('status','denied'); END IF;
   PERFORM public.validate_current_roster_mapping((SELECT source_mapping FROM public.public_data_resources WHERE id=selected.resource_id));
 ELSIF NOT public.public_data_history_authority_valid(selected.intake_id) THEN RETURN jsonb_build_object('status','denied');
 ELSIF EXISTS(SELECT 1 FROM public.public_data_intakes WHERE id=selected.intake_id AND resource_occurrence_id IS NOT NULL) THEN
   RAISE EXCEPTION 'internal occurrence is not ordinary history';
 ELSIF selected.target_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.public_data_refresh_cycles cycle
   WHERE cycle.target_id=selected.target_id AND cycle.intake_id=selected.intake_id AND cycle.cycle=target.current_cycle) THEN RETURN jsonb_build_object('status','denied');
 END IF;
 IF EXISTS(SELECT 1 FROM public.public_data_dispatches dispatch WHERE NOT EXISTS(SELECT 1 FROM public.public_data_dispatch_outcomes outcome
   WHERE outcome.worker_id=dispatch.worker_id AND outcome.generation=dispatch.generation)) THEN RAISE EXCEPTION 'public dispatch recovery required'; END IF;
 request_cost:=CASE WHEN p_work->>'kind' IN ('core','exact-matchups','playoff-brackets') THEN 2 ELSE 1 END;
 budget_status:=public.public_data_settled_request_budget(request_cost);
 PERFORM public.assert_public_data_resource_owner(p_fence);
 IF (job.payload->>'batchAdmissionDeadlineAt')::timestamptz<=clock_timestamp() THEN RETURN jsonb_build_object('status','deadline'); END IF;
 IF selected.target_id IS NOT NULL AND configuration.expires_at<=clock_timestamp() THEN RETURN jsonb_build_object('status','denied'); END IF;
 IF budget_status->>'status'='budget-backoff' THEN RETURN budget_status; END IF;
  INSERT INTO public.public_data_dispatches(worker_id,generation,intake_id,revision,resource,work,max_requests,request_budget_policy)
   VALUES(p_fence->>'workerId',(p_fence->>'generation')::integer,selected.intake_id,(p_work->>'revision')::integer,p_work->>'kind',p_work,request_cost,'public-data-settled-request-budget-v1')
   RETURNING admitted_at INTO admitted_time;
 -- Debit once, in the same transaction as immutable admission. Failures, crashes
 -- and unused HTTP reservations are charged. No refund or retry double-charge.
 -- With both lanes continuously eligible, history receives >=20% of reserved
 -- HTTP asymptotically, with at most bounded initial/rounding debt. Carry the
 -- threshold overshoot: cap10 cannot discard the <=9 credit reached while a
 -- 1..2 HTTP history task is eligible. Idle accumulation alone is bounded.
 IF selected.lane='active' THEN
   UPDATE public.public_data_resource_service SET history_credit=least(10,history_credit+request_cost),
     active_reserved_http=active_reserved_http+request_cost WHERE singleton;
   UPDATE public.public_data_resources SET last_served_at=admitted_time WHERE id=selected.resource_id;
 ELSE
   UPDATE public.public_data_resource_service SET history_credit=greatest(0,history_credit-4*request_cost),
     history_reserved_http=history_reserved_http+request_cost WHERE singleton;
   INSERT INTO public.public_data_history_service(intake_id,reserved_http,last_served_at)
     VALUES(selected.intake_id,request_cost,admitted_time)
     ON CONFLICT(intake_id) DO UPDATE SET reserved_http=public_data_history_service.reserved_http+request_cost,
       last_served_at=admitted_time,next_eligible_at=admitted_time,failure_count=0;
 END IF;
 IF selected.lane='history' AND selected.target_id IS NOT NULL THEN
   UPDATE public.public_data_refresh_targets SET last_served_at=admitted_time,selection_failure_count=0,
     selection_failed_at=NULL,selection_next_eligible_at=admitted_time WHERE id=selected.target_id;
 END IF;
 PERFORM public.assert_public_data_resource_owner(p_fence);
 RETURN jsonb_build_object('status','admitted');
END; $$;

REVOKE ALL ON FUNCTION public.public_data_settled_capture_upper_bound(public.public_data_dispatches,public.public_data_dispatch_outcomes),
  public.record_public_data_settled_request_bound(),public.public_data_settled_request_budget(integer),
  public.admit_public_data_settled_direct_status(jsonb,jsonb),public.public_data_settled_request_budget_capability(),
  public.admit_public_data_batch_dispatch_status(jsonb,jsonb) FROM PUBLIC;
DO $$ DECLARE role_name text; helper text; BEGIN
  FOREACH role_name IN ARRAY ARRAY['league_one_runtime','league_one_account','league_one_auth'] LOOP
    IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=role_name) THEN
      FOREACH helper IN ARRAY ARRAY[
        'public.public_data_settled_capture_upper_bound(public.public_data_dispatches,public.public_data_dispatch_outcomes)',
        'public.record_public_data_settled_request_bound()','public.public_data_settled_request_budget(integer)',
        'public.admit_public_data_settled_direct_status(jsonb,jsonb)',
        'public.public_data_settled_request_budget_capability()','public.admit_public_data_batch_dispatch_status(jsonb,jsonb)'] LOOP
        EXECUTE format('REVOKE ALL ON FUNCTION %s FROM %I',helper,role_name);
      END LOOP;
    END IF;
  END LOOP;
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='league_one_runtime') THEN
    GRANT EXECUTE ON FUNCTION public.public_data_settled_request_budget_capability(),
      public.admit_public_data_batch_dispatch_status(jsonb,jsonb) TO league_one_runtime;
  END IF;
END; $$;