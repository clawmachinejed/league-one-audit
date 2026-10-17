-- CP26: admit newly due correction cycles to the existing history service lane.
-- R059 is preserved. One bounded metadata pass precedes normal cost arbitration;
-- it is not another worker, queue, capture path or elapsed-SLA qualification.
-- The private shared implementation preserves the legacy selector in mode=false.
CREATE FUNCTION public.select_public_data_refresh_mode(p_fence jsonb,p_prepare_only boolean) RETURNS jsonb
LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE target public.public_data_refresh_targets%ROWTYPE; configuration public.public_data_refresh_configurations%ROWTYPE;
  cycle_row public.public_data_refresh_cycles%ROWTYPE; request public.public_data_intakes%ROWTYPE;
  selected jsonb; disposition jsonb; request_id uuid; cycle_number bigint; native text; due timestamptz;
  next_due timestamptz; terminal_time timestamptz; has_backoff boolean:=false; has_capacity boolean:=false; checked integer:=0; created_cycles integer:=0; admission_deadline timestamptz;
BEGIN
  IF p_prepare_only IS NULL THEN RAISE EXCEPTION 'public refresh preparation mode required'; END IF;
  IF p_prepare_only THEN
    PERFORM public.assert_public_data_resource_owner(p_fence);
    SELECT (payload->>'batchAdmissionDeadlineAt')::timestamptz INTO STRICT admission_deadline
      FROM public.projection_jobs WHERE job_key=p_fence->>'jobKey';
    IF admission_deadline<=clock_timestamp() THEN RAISE EXCEPTION 'public correction preparation admission deadline elapsed'; END IF;
  END IF;
  -- Lock order: global public job, shared intake-capacity lock, target, request.
  -- Configuration never locks the job/request; ordinary submit only takes capacity.
  PERFORM public.assert_public_refresh_owner(p_fence);
  SELECT payload->'refreshSelection' INTO selected FROM public.projection_jobs WHERE job_key=p_fence->>'jobKey';
  IF p_prepare_only AND selected IS NOT NULL THEN
    RAISE EXCEPTION 'public correction preparation cannot replace a refresh selection';
  END IF;
  IF selected IS NOT NULL THEN
    -- Unknown acknowledgement: the same owner receives the exact durable binding.
    -- Admission still rechecks the latest approval; this is never another cycle.
    PERFORM public.assert_public_refresh_owner(p_fence);
    RETURN selected;
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('public-data-intake-admission',0));
  PERFORM public.assert_public_refresh_owner(p_fence);
  FOR target IN SELECT candidate.* FROM public.public_data_refresh_targets candidate
    ORDER BY candidate.last_served_at NULLS FIRST,candidate.created_at,candidate.id LIMIT 16 FOR UPDATE SKIP LOCKED LOOP
    checked:=checked+1;
    IF p_prepare_only THEN
      PERFORM public.assert_public_data_resource_owner(p_fence);
      IF admission_deadline<=clock_timestamp() THEN RAISE EXCEPTION 'public correction preparation admission deadline elapsed'; END IF;
    END IF;
    PERFORM public.assert_public_refresh_owner(p_fence);
    SELECT * INTO STRICT configuration FROM public.public_data_refresh_configurations
      WHERE target_id=target.id AND revision=target.configuration_revision;
    IF configuration.paused OR configuration.expires_at<=clock_timestamp() THEN CONTINUE; END IF;
    IF target.selection_next_eligible_at>clock_timestamp() THEN has_backoff:=true; CONTINUE; END IF;
    cycle_row:=NULL; request:=NULL;
    IF target.current_cycle IS NOT NULL THEN
      SELECT * INTO STRICT cycle_row FROM public.public_data_refresh_cycles WHERE target_id=target.id AND cycle=target.current_cycle;
      SELECT * INTO request FROM public.public_data_intakes WHERE id=cycle_row.intake_id FOR UPDATE SKIP LOCKED;
      IF NOT FOUND THEN has_backoff:=true; CONTINUE; END IF;
      IF request.terminal THEN
        IF NOT EXISTS(SELECT 1 FROM public.public_data_refresh_cycle_outcomes WHERE target_id=target.id AND cycle=cycle_row.cycle) THEN
          disposition:=public.next_public_data_intake(request.id);
          IF disposition NOT IN ('"complete"'::jsonb,'"partial"'::jsonb,'"unavailable"'::jsonb) THEN
            RAISE EXCEPTION 'terminal public refresh cycle has no terminal disposition'; END IF;
          -- Store once: recomputing a future slot on every poll would never run.
          terminal_time:=clock_timestamp();
          next_due:=cycle_row.due_at+make_interval(secs=>
            (floor(greatest(0,extract(epoch FROM terminal_time-cycle_row.due_at))/configuration.cadence_seconds)+1)*configuration.cadence_seconds);
          INSERT INTO public.public_data_refresh_cycle_outcomes(target_id,cycle,disposition,recorded_at,next_due_at)
            VALUES(target.id,cycle_row.cycle,disposition#>>'{}',terminal_time,next_due);
          UPDATE public.public_data_refresh_targets SET next_due_at=next_due WHERE id=target.id;
          target.next_due_at:=next_due;
        END IF;
        request:=NULL;
      ELSIF request.next_attempt_at>clock_timestamp() THEN has_backoff:=true; CONTINUE;
      END IF;
    END IF;
    IF request.id IS NULL THEN
      -- Preparation continues reconciling later targets after its one creation.
      IF p_prepare_only AND created_cycles>=1 THEN CONTINUE; END IF;
      IF target.next_due_at>clock_timestamp() THEN has_backoff:=true; CONTINUE; END IF;
      IF (SELECT count(*) FROM public.public_data_intakes WHERE NOT terminal AND resource_occurrence_id IS NULL)>=16 THEN has_capacity:=true; CONTINUE; END IF;
      SELECT external_manager_id INTO STRICT native FROM public.league_source_manager_accounts
        WHERE id=target.source_manager_account_id AND provider=target.provider;
      request_id:=gen_random_uuid(); cycle_number:=COALESCE(target.current_cycle,0)+1;
      IF p_prepare_only AND admission_deadline<=clock_timestamp() THEN
        RAISE EXCEPTION 'public correction preparation admission deadline elapsed'; END IF;
      -- One new ordinary request. No reset or mutation of previous cycle evidence.
      PERFORM public.submit_public_data_intake(jsonb_build_object('id',request_id,'username',native,'seasons',configuration.seasons)||CASE WHEN configuration.period_inventory IS NULL THEN jsonb_build_object('exactPeriods',configuration.exact_periods) ELSE jsonb_build_object('periodInventory',configuration.period_inventory) END||CASE WHEN configuration.playoff_brackets IS NULL THEN '{}'::jsonb ELSE jsonb_build_object('playoffBrackets',configuration.playoff_brackets) END||CASE WHEN configuration.weekly_reports='[]'::jsonb THEN '{}'::jsonb ELSE jsonb_build_object('weeklyReports',configuration.weekly_reports) END||CASE WHEN configuration.transaction_history IS NULL THEN '{}'::jsonb ELSE jsonb_build_object('transactionHistory',configuration.transaction_history) END||CASE WHEN configuration.draft_picks IS NULL THEN '{}'::jsonb ELSE jsonb_build_object('draftPicks',configuration.draft_picks) END);
      due:=target.next_due_at+make_interval(secs=>
        floor(greatest(0,extract(epoch FROM clock_timestamp()-target.next_due_at))/configuration.cadence_seconds)*configuration.cadence_seconds);
      INSERT INTO public.public_data_refresh_cycles(target_id,cycle,configuration_revision,intake_id,due_at)
        VALUES(target.id,cycle_number,target.configuration_revision,request_id,due) RETURNING * INTO cycle_row;
      created_cycles:=created_cycles+1;
      UPDATE public.public_data_refresh_targets SET current_cycle=cycle_number WHERE id=target.id;
      SELECT * INTO STRICT request FROM public.public_data_intakes WHERE id=request_id;
    END IF;
    IF request.username IS DISTINCT FROM (SELECT external_manager_id FROM public.league_source_manager_accounts
      WHERE id=target.source_manager_account_id AND provider=target.provider)
      OR request.seasons IS DISTINCT FROM configuration.seasons OR request.exact_periods IS DISTINCT FROM configuration.exact_periods
      OR request.draft_picks IS DISTINCT FROM configuration.draft_picks
      OR request.draft_picks IS DISTINCT FROM (SELECT draft_picks FROM public.public_data_refresh_configurations
        WHERE target_id=target.id AND revision=cycle_row.configuration_revision)
      OR request.transaction_period IS NOT NULL
      OR request.transaction_history IS DISTINCT FROM configuration.transaction_history
      OR request.transaction_history IS DISTINCT FROM (SELECT transaction_history FROM public.public_data_refresh_configurations
        WHERE target_id=target.id AND revision=cycle_row.configuration_revision)
      OR request.weekly_reports IS DISTINCT FROM configuration.weekly_reports
      OR request.weekly_reports IS DISTINCT FROM (SELECT weekly_reports FROM public.public_data_refresh_configurations
        WHERE target_id=target.id AND revision=cycle_row.configuration_revision)
      OR request.playoff_brackets IS DISTINCT FROM configuration.playoff_brackets
      OR request.playoff_brackets IS DISTINCT FROM (SELECT playoff_brackets FROM public.public_data_refresh_configurations
        WHERE target_id=target.id AND revision=cycle_row.configuration_revision)
      OR request.period_inventory IS DISTINCT FROM configuration.period_inventory
      OR request.period_inventory IS DISTINCT FROM (SELECT period_inventory FROM public.public_data_refresh_configurations
        WHERE target_id=target.id AND revision=cycle_row.configuration_revision)
      OR request.exact_periods IS DISTINCT FROM (SELECT exact_periods FROM public.public_data_refresh_configurations
        WHERE target_id=target.id AND revision=cycle_row.configuration_revision) THEN
      IF EXISTS(SELECT 1 FROM public.projection_jobs WHERE job_key=p_fence->>'jobKey'
        AND payload->>'schedulingPolicy'='public-data-resource-schedule-v1') THEN
        PERFORM public.record_public_data_resource_target_failure(target.id,target.configuration_revision,cycle_row.cycle,p_fence);
        has_backoff:=true;
        CONTINUE;
      END IF;
      RAISE EXCEPTION 'refresh request scope changed';
    END IF;
    IF p_prepare_only THEN
      -- A current unfinished cycle is eligible history, not a reason to hide
      -- later due targets. Its complete current/original scope was checked above.
      IF configuration.expires_at<=clock_timestamp() THEN RAISE EXCEPTION 'public refresh approval expired during preparation'; END IF;
      CONTINUE;
    END IF;
    selected:=jsonb_build_object('status','selected','targetId',target.id,'configurationRevision',target.configuration_revision,
      'cycleConfigurationRevision',cycle_row.configuration_revision,'cycle',cycle_row.cycle,'requestId',request.id);
    PERFORM public.assert_public_refresh_owner(p_fence);
    IF configuration.expires_at<=clock_timestamp() THEN RAISE EXCEPTION 'public refresh approval expired during selection'; END IF;
    UPDATE public.projection_jobs SET payload=payload||jsonb_build_object('requestId',request.id,'refreshSelection',selected)
      WHERE job_key=p_fence->>'jobKey';
    PERFORM public.assert_public_data_owner(request.id,p_fence);
    RETURN selected;
  END LOOP;
  PERFORM public.assert_public_refresh_owner(p_fence);
  IF p_prepare_only THEN
    PERFORM public.assert_public_data_resource_owner(p_fence);
    IF admission_deadline<=clock_timestamp() THEN RAISE EXCEPTION 'public correction preparation admission deadline elapsed'; END IF;
    RETURN jsonb_build_object('status',CASE WHEN created_cycles>0 THEN 'prepared' WHEN has_capacity THEN 'capacity' WHEN has_backoff THEN 'backoff' ELSE 'idle' END,
      'checkedTargets',checked,'createdCycles',created_cycles);
  END IF;
  RETURN jsonb_build_object('status',CASE WHEN has_capacity THEN 'capacity' WHEN has_backoff THEN 'backoff' ELSE 'idle' END,
    'checkedTargets',checked);
END; $$;
CREATE OR REPLACE FUNCTION public.select_public_data_refresh(p_fence jsonb) RETURNS jsonb
LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
  SELECT public.select_public_data_refresh_mode(p_fence,false)
$$;
CREATE OR REPLACE FUNCTION public.select_public_data_resource_work(p_fence jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE job public.projection_jobs%ROWTYPE; selected public.public_data_resource_selections%ROWTYPE;
  active_resource public.public_data_resources%ROWTYPE; authority public.public_data_resource_authorities%ROWTYPE;
  history_request uuid; history_work jsonb; history_target uuid; history_revision bigint;
  request_id uuid; credit integer; history_cost integer; chosen_lane text;
BEGIN
 PERFORM public.assert_public_data_resource_owner(p_fence);
 SELECT * INTO STRICT job FROM public.projection_jobs WHERE job_key=p_fence->>'jobKey';
 SELECT * INTO selected FROM public.public_data_resource_selections WHERE worker_id=p_fence->>'workerId' AND generation=(p_fence->>'generation')::integer;
 IF FOUND THEN
   IF job.payload->'resourceSelection' IS DISTINCT FROM public.public_data_resource_selection_json(selected) THEN
     RAISE EXCEPTION 'public resource selection binding changed'; END IF;
   RETURN public.public_data_resource_selection_json(selected);
 END IF;
 IF (job.payload->>'batchAdmissionDeadlineAt')::timestamptz<=clock_timestamp() THEN
   RETURN jsonb_build_object('status','backoff','reason','invocation-admission-deadline'); END IF;

 -- Recovery authority is distinct from fresh admission permission. Bind the
 -- abandoned request even after expiry/revocation/period change; ordinary recovery
 -- closes its original immutable dispatch before any new HTTP is considered.
 SELECT dispatch.intake_id INTO request_id FROM public.public_data_dispatches dispatch
   WHERE NOT EXISTS(SELECT 1 FROM public.public_data_dispatch_outcomes outcome
     WHERE outcome.worker_id=dispatch.worker_id AND outcome.generation=dispatch.generation)
   ORDER BY dispatch.admitted_at,dispatch.worker_id,dispatch.generation LIMIT 1;
 IF request_id IS NOT NULL THEN
   SELECT resource.* INTO active_resource FROM public.public_data_resource_occurrences occurrence
     JOIN public.public_data_resources resource ON resource.id=occurrence.resource_id WHERE occurrence.id=request_id;
   IF FOUND THEN
     SELECT permission.* INTO STRICT authority FROM public.public_data_resource_authorities permission
       JOIN public.public_data_resource_occurrences occurrence ON occurrence.resource_id=permission.resource_id
         AND occurrence.target_id=permission.target_id AND occurrence.configuration_revision=permission.configuration_revision
       WHERE occurrence.id=request_id;
     INSERT INTO public.public_data_resource_selections(worker_id,generation,intake_id,lane,resource_id,target_id,configuration_revision)
       VALUES(p_fence->>'workerId',(p_fence->>'generation')::integer,request_id,'active',active_resource.id,authority.target_id,authority.configuration_revision)
       RETURNING * INTO selected;
   ELSE
     SELECT cycle.target_id,cycle.configuration_revision INTO history_target,history_revision FROM public.public_data_refresh_cycles cycle WHERE cycle.intake_id=request_id;
     INSERT INTO public.public_data_resource_selections(worker_id,generation,intake_id,lane,target_id,configuration_revision)
       VALUES(p_fence->>'workerId',(p_fence->>'generation')::integer,request_id,'history',history_target,history_revision)
       RETURNING * INTO selected;
   END IF;
   UPDATE public.projection_jobs SET payload=payload||jsonb_build_object('requestId',selected.intake_id,
     'resourceSelection',public.public_data_resource_selection_json(selected)) WHERE job_key=job.job_key;
   RETURN public.public_data_resource_selection_json(selected);
 END IF;

 -- Materialize due correction history before candidate arbitration, even when
 -- active work or ordinary imports remain continuously eligible. This bounded
 -- metadata pass does not bind work, reserve HTTP or spend service credit.
 PERFORM public.select_public_data_refresh_mode(p_fence,true);

 SELECT resource.* INTO active_resource FROM public.public_data_resources resource
   WHERE resource.due_at<=clock_timestamp() AND resource.next_eligible_at<=clock_timestamp()
     AND (resource.open_intake_id IS NULL OR EXISTS(SELECT 1 FROM public.public_data_intakes request
       WHERE request.id=resource.open_intake_id AND request.next_attempt_at<=clock_timestamp()))
     AND EXISTS(SELECT 1 FROM public.public_data_resource_authorities permission
       WHERE permission.resource_id=resource.id AND public.public_data_resource_authority_valid(resource.id,permission.target_id,permission.configuration_revision))
   ORDER BY resource.due_at,resource.last_served_at NULLS FIRST,resource.id LIMIT 1 FOR UPDATE;
 SELECT request.id,work.value,cycle.target_id,target.configuration_revision
   INTO history_request,history_work,history_target,history_revision
   FROM public.public_data_intakes request
   LEFT JOIN public.public_data_history_service service ON service.intake_id=request.id
   LEFT JOIN public.public_data_refresh_cycles cycle ON cycle.intake_id=request.id
   LEFT JOIN public.public_data_refresh_targets target ON target.id=cycle.target_id
   LEFT JOIN public.public_data_refresh_configurations configuration ON configuration.target_id=target.id AND configuration.revision=target.configuration_revision
   CROSS JOIN LATERAL (SELECT public.next_public_data_intake(request.id) AS value) work
   WHERE NOT request.terminal AND request.resource_occurrence_id IS NULL AND request.next_attempt_at<=clock_timestamp()
     AND COALESCE(service.next_eligible_at,'-infinity'::timestamptz)<=clock_timestamp()
     AND jsonb_typeof(work.value)='object' AND public.public_data_history_authority_valid(request.id)
     AND (cycle.intake_id IS NULL OR (target.current_cycle=cycle.cycle AND NOT configuration.paused
       AND configuration.expires_at>clock_timestamp() AND target.selection_next_eligible_at<=clock_timestamp()))
   ORDER BY service.last_served_at NULLS FIRST,request.created_at,request.id LIMIT 1 FOR UPDATE OF request;

 SELECT history_credit INTO STRICT credit FROM public.public_data_resource_service WHERE singleton FOR UPDATE;
 history_cost:=CASE WHEN history_work->>'kind' IN ('core','exact-matchups','playoff-brackets') THEN 2 ELSE 1 END;
 chosen_lane:=CASE WHEN history_request IS NOT NULL AND (active_resource.id IS NULL OR credit>=4*history_cost) THEN 'history'
   WHEN active_resource.id IS NOT NULL THEN 'active' ELSE NULL END;
 IF chosen_lane IS NULL THEN
   IF EXISTS(SELECT 1 FROM public.public_data_intakes WHERE NOT terminal AND resource_occurrence_id IS NULL)
     OR EXISTS(SELECT 1 FROM public.public_data_resources WHERE due_at<=clock_timestamp()) THEN
     RETURN jsonb_build_object('status','backoff','reason','no-current-eligible-resource-or-history');
   END IF;
   RETURN jsonb_build_object('status','idle','reason','no-current-active-authority-or-history');
 END IF;
 IF chosen_lane='active' THEN
   SELECT * INTO STRICT authority FROM public.public_data_resource_authorities permission
     WHERE permission.resource_id=active_resource.id AND public.public_data_resource_authority_valid(permission.resource_id,permission.target_id,permission.configuration_revision)
     ORDER BY permission.target_id,permission.configuration_revision LIMIT 1;
   request_id:=public.seed_public_data_resource_occurrence(active_resource.id,authority.target_id,authority.configuration_revision,p_fence);
   INSERT INTO public.public_data_resource_selections(worker_id,generation,intake_id,lane,resource_id,target_id,configuration_revision)
     VALUES(p_fence->>'workerId',(p_fence->>'generation')::integer,request_id,'active',active_resource.id,authority.target_id,authority.configuration_revision)
     RETURNING * INTO selected;
 ELSE
   INSERT INTO public.public_data_resource_selections(worker_id,generation,intake_id,lane,target_id,configuration_revision)
     VALUES(p_fence->>'workerId',(p_fence->>'generation')::integer,history_request,'history',history_target,history_revision)
     RETURNING * INTO selected;
 END IF;
 PERFORM public.assert_public_data_resource_owner(p_fence);
 UPDATE public.projection_jobs SET payload=payload||jsonb_build_object('requestId',selected.intake_id,
   'resourceSelection',public.public_data_resource_selection_json(selected)) WHERE job_key=job.job_key;
 RETURN public.public_data_resource_selection_json(selected);
END; $$;
-- The shared helper is reachable only through the existing definer entry points.
REVOKE ALL ON FUNCTION public.select_public_data_refresh_mode(jsonb,boolean) FROM PUBLIC;
DO $$ DECLARE role_name text; BEGIN
  FOREACH role_name IN ARRAY ARRAY['league_one_runtime','league_one_account','league_one_auth'] LOOP
    IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=role_name) THEN
      EXECUTE format('REVOKE ALL ON FUNCTION public.select_public_data_refresh_mode(jsonb,boolean) FROM %I',role_name);
      IF has_function_privilege(role_name,'public.select_public_data_refresh_mode(jsonb,boolean)','EXECUTE') THEN
        RAISE EXCEPTION 'restricted role can execute private correction preparation helper'; END IF;
    END IF;
  END LOOP;
END; $$;
