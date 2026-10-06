-- Optional DATA recurrence. Ordinary intake requests, worker, admission and readers
-- remain the only acquisition path. Bounds are capacity policy, not a freshness SLA.
CREATE TABLE public.public_data_refresh_targets (
  id uuid PRIMARY KEY,
  provider text NOT NULL CHECK (provider='sleeper'),
  source_manager_account_id uuid NOT NULL REFERENCES public.league_source_manager_accounts(id),
  configuration_revision bigint NOT NULL CHECK (configuration_revision BETWEEN 1 AND 9007199254740991),
  current_cycle bigint CHECK (current_cycle BETWEEN 1 AND 9007199254740991),
  next_due_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  last_served_at timestamptz,
  selection_failure_count integer NOT NULL DEFAULT 0 CHECK (selection_failure_count BETWEEN 0 AND 7),
  selection_failed_at timestamptz,
  selection_next_eligible_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE(provider,source_manager_account_id)
);
CREATE TABLE public.public_data_refresh_configurations (
  target_id uuid NOT NULL REFERENCES public.public_data_refresh_targets(id),
  revision bigint NOT NULL CHECK (revision BETWEEN 1 AND 9007199254740991),
  identity_request_id uuid NOT NULL REFERENCES public.public_data_identity_observations(intake_id),
  seasons integer[] NOT NULL CHECK (cardinality(seasons) BETWEEN 1 AND 3
    AND array_position(seasons,NULL) IS NULL AND 1920<=ALL(seasons) AND 2200>=ALL(seasons)),
  cadence_seconds integer NOT NULL CHECK (cadence_seconds BETWEEN 60 AND 604800),
  expires_at timestamptz NOT NULL,
  paused boolean NOT NULL,
  configured_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY(target_id,revision)
);
ALTER TABLE public.public_data_refresh_targets ADD CONSTRAINT public_refresh_current_configuration
  FOREIGN KEY(id,configuration_revision) REFERENCES public.public_data_refresh_configurations(target_id,revision)
  DEFERRABLE INITIALLY DEFERRED;
CREATE TABLE public.public_data_refresh_cycles (
  target_id uuid NOT NULL REFERENCES public.public_data_refresh_targets(id),
  cycle bigint NOT NULL CHECK (cycle BETWEEN 1 AND 9007199254740991),
  configuration_revision bigint NOT NULL,
  intake_id uuid NOT NULL UNIQUE REFERENCES public.public_data_intakes(id),
  due_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY(target_id,cycle),
  FOREIGN KEY(target_id,configuration_revision) REFERENCES public.public_data_refresh_configurations(target_id,revision)
);
ALTER TABLE public.public_data_refresh_targets ADD CONSTRAINT public_refresh_current_cycle
  FOREIGN KEY(id,current_cycle) REFERENCES public.public_data_refresh_cycles(target_id,cycle);
CREATE TABLE public.public_data_refresh_cycle_outcomes (
  target_id uuid NOT NULL,
  cycle bigint NOT NULL,
  disposition text NOT NULL CHECK (disposition IN ('complete','partial','unavailable')),
  recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  next_due_at timestamptz NOT NULL,
  PRIMARY KEY(target_id,cycle),
  FOREIGN KEY(target_id,cycle) REFERENCES public.public_data_refresh_cycles(target_id,cycle)
);
CREATE TABLE public.public_data_refresh_selection_failures (
  worker_id text NOT NULL CHECK (btrim(worker_id)<>''),
  generation integer NOT NULL CHECK (generation>0),
  target_id uuid NOT NULL,
  configuration_revision bigint NOT NULL,
  cycle bigint NOT NULL,
  reason text NOT NULL CHECK (reason IN ('selection-failed','request-state-failed','admission-unconfirmed')),
  recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  next_eligible_at timestamptz NOT NULL,
  PRIMARY KEY(worker_id,generation),
  FOREIGN KEY(target_id,configuration_revision) REFERENCES public.public_data_refresh_configurations(target_id,revision),
  FOREIGN KEY(target_id,cycle) REFERENCES public.public_data_refresh_cycles(target_id,cycle)
);
CREATE TRIGGER public_refresh_target_identity_immutable BEFORE UPDATE ON public.public_data_refresh_targets
  FOR EACH ROW EXECUTE FUNCTION public.prevent_projection_stable_field_change('id','provider','source_manager_account_id','created_at');
CREATE TRIGGER public_refresh_target_no_delete BEFORE DELETE ON public.public_data_refresh_targets
  FOR EACH ROW EXECUTE FUNCTION public.prevent_league_administration_history_change();
CREATE TRIGGER public_refresh_configuration_immutable BEFORE UPDATE OR DELETE ON public.public_data_refresh_configurations
  FOR EACH ROW EXECUTE FUNCTION public.prevent_league_administration_history_change();
CREATE TRIGGER public_refresh_cycle_immutable BEFORE UPDATE OR DELETE ON public.public_data_refresh_cycles
  FOR EACH ROW EXECUTE FUNCTION public.prevent_league_administration_history_change();
CREATE TRIGGER public_refresh_outcome_immutable BEFORE UPDATE OR DELETE ON public.public_data_refresh_cycle_outcomes
  FOR EACH ROW EXECUTE FUNCTION public.prevent_league_administration_history_change();
CREATE TRIGGER public_refresh_failure_immutable BEFORE UPDATE OR DELETE ON public.public_data_refresh_selection_failures
  FOR EACH ROW EXECUTE FUNCTION public.prevent_league_administration_history_change();

CREATE FUNCTION public.configure_public_data_refresh(p_input jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE target public.public_data_refresh_targets%ROWTYPE; configuration public.public_data_refresh_configurations%ROWTYPE;
  target_id uuid:=(p_input->>'id')::uuid; identity_id uuid:=(p_input->>'identityRequestId')::uuid;
  expected bigint:=(p_input->>'expectedRevision')::bigint; manager_id uuid; wanted integer[];
  cadence integer:=(p_input->>'cadenceSeconds')::integer; expiry timestamptz:=(p_input->>'expiresAt')::timestamptz;
  paused_value boolean; next_revision bigint; current_request public.public_data_intakes%ROWTYPE;
BEGIN
  IF target_id IS NULL OR identity_id IS NULL OR expected IS NULL OR expected NOT BETWEEN 0 AND 9007199254740990
    OR jsonb_typeof(p_input->'expectedRevision') IS DISTINCT FROM 'number'
    OR (p_input->>'expectedRevision') !~ '^(0|[1-9][0-9]*)$'
    OR jsonb_typeof(p_input->'cadenceSeconds') IS DISTINCT FROM 'number'
    OR (p_input->>'cadenceSeconds') !~ '^[1-9][0-9]*$' OR cadence NOT BETWEEN 60 AND 604800
    OR jsonb_typeof(p_input->'paused') IS DISTINCT FROM 'boolean'
    OR jsonb_typeof(p_input->'seasons') IS DISTINCT FROM 'array'
    OR jsonb_array_length(p_input->'seasons') NOT BETWEEN 1 AND 3
    OR expiry IS NULL OR NOT isfinite(expiry) OR expiry>clock_timestamp()+interval '90 days' THEN
    RAISE EXCEPTION 'invalid public refresh configuration'; END IF;
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(p_input->'seasons') entry
    WHERE jsonb_typeof(entry)<>'number' OR entry::text !~ '^[1-9][0-9]*$') THEN
    RAISE EXCEPTION 'invalid public refresh seasons'; END IF;
  SELECT array_agg(value::integer ORDER BY value::integer) INTO wanted FROM jsonb_array_elements_text(p_input->'seasons');
  IF EXISTS(SELECT 1 FROM unnest(wanted) season WHERE season NOT BETWEEN 1920 AND 2200)
    OR cardinality(wanted)<>(SELECT count(DISTINCT season) FROM unnest(wanted) season) THEN
    RAISE EXCEPTION 'invalid public refresh seasons'; END IF;
  paused_value:=(p_input->>'paused')::boolean;
  SELECT account.id INTO STRICT manager_id FROM public.public_data_identity_observations identity
    JOIN public.league_source_manager_accounts account ON account.id=identity.source_manager_account_id
    WHERE identity.intake_id=identity_id AND account.provider='sleeper'
      AND account.external_manager_id ~ '^[1-9][0-9]{0,31}$';
  -- Serializes total target capacity and canonical stable-manager uniqueness.
  PERFORM pg_advisory_xact_lock(hashtextextended('public-data-refresh-configuration',0));
  SELECT * INTO target FROM public.public_data_refresh_targets WHERE id=target_id FOR UPDATE;
  IF FOUND THEN
    IF target.source_manager_account_id<>manager_id THEN RAISE EXCEPTION 'refresh target identity is immutable'; END IF;
    SELECT * INTO STRICT configuration FROM public.public_data_refresh_configurations
      WHERE public_data_refresh_configurations.target_id=target.id AND revision=target.configuration_revision;
    IF target.configuration_revision=expected+1 AND configuration.identity_request_id=identity_id
      AND configuration.seasons=wanted AND configuration.cadence_seconds=cadence
      AND configuration.expires_at=expiry AND configuration.paused=paused_value THEN
      RETURN jsonb_build_object('status','replayed','targetId',target.id,'configurationRevision',target.configuration_revision);
    END IF;
    IF target.configuration_revision<>expected THEN RAISE EXCEPTION 'refresh configuration revision changed'; END IF;
    SELECT request.* INTO current_request FROM public.public_data_refresh_cycles cycle
      JOIN public.public_data_intakes request ON request.id=cycle.intake_id
      WHERE cycle.target_id=target.id AND cycle.cycle=target.current_cycle;
    IF FOUND AND NOT current_request.terminal AND current_request.seasons IS DISTINCT FROM wanted THEN
      RAISE EXCEPTION 'unfinished refresh cycle retains its explicit season scope'; END IF;
  ELSE
    IF expected<>0 THEN RAISE EXCEPTION 'refresh configuration revision changed'; END IF;
    IF (SELECT count(*) FROM public.public_data_refresh_targets)>=16 THEN RAISE EXCEPTION 'public refresh target capacity reached'; END IF;
    IF EXISTS(SELECT 1 FROM public.public_data_refresh_targets WHERE provider='sleeper' AND source_manager_account_id=manager_id) THEN
      RAISE EXCEPTION 'public manager already has a refresh target'; END IF;
    INSERT INTO public.public_data_refresh_targets(id,provider,source_manager_account_id,configuration_revision)
      VALUES(target_id,'sleeper',manager_id,1);
  END IF;
  IF expiry<=clock_timestamp() THEN RAISE EXCEPTION 'public refresh approval expired'; END IF;
  next_revision:=expected+1;
  INSERT INTO public.public_data_refresh_configurations(target_id,revision,identity_request_id,seasons,cadence_seconds,expires_at,paused)
    VALUES(target_id,next_revision,identity_id,wanted,cadence,expiry,paused_value);
  UPDATE public.public_data_refresh_targets SET configuration_revision=next_revision,
    selection_failure_count=0,selection_failed_at=NULL,selection_next_eligible_at=clock_timestamp()
    WHERE id=target_id;
  RETURN jsonb_build_object('status','configured','targetId',target_id,'configurationRevision',next_revision);
END; $$;

-- Selection precedes the existing request-specific owner guard. It has exactly
-- the same job identity, real lease/generation/deadline, plus explicit opt-in.
CREATE FUNCTION public.assert_public_refresh_owner(p_fence jsonb) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
  IF p_fence->>'jobKey' IS DISTINCT FROM 'league-administration-public-intake' THEN RAISE EXCEPTION 'wrong public refresh owner'; END IF;
  PERFORM 1 FROM public.projection_jobs WHERE job_key=p_fence->>'jobKey' AND state='running'
    AND lease_owner=p_fence->>'workerId' AND attempt_count=(p_fence->>'generation')::integer
    AND lease_until>clock_timestamp() AND (p_fence->>'deadlineAt')::timestamptz>clock_timestamp()
    AND payload->>'policy'='public-data-refresh-v1' AND payload->>'mode'='recurring' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'public refresh lease lost'; END IF;
  IF (p_fence->>'deadlineAt')::timestamptz<=clock_timestamp() OR NOT EXISTS(SELECT 1 FROM public.projection_jobs
    WHERE job_key=p_fence->>'jobKey' AND lease_until>clock_timestamp()) THEN RAISE EXCEPTION 'public refresh lease lost'; END IF;
END; $$;

CREATE FUNCTION public.select_public_data_refresh(p_fence jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE target public.public_data_refresh_targets%ROWTYPE; configuration public.public_data_refresh_configurations%ROWTYPE;
  cycle_row public.public_data_refresh_cycles%ROWTYPE; request public.public_data_intakes%ROWTYPE;
  selected jsonb; disposition jsonb; request_id uuid; cycle_number bigint; native text; due timestamptz;
  next_due timestamptz; terminal_time timestamptz; has_backoff boolean:=false; has_capacity boolean:=false; checked integer:=0;
BEGIN
  -- Lock order: global public job, shared intake-capacity lock, target, request.
  -- Configuration never locks the job/request; ordinary submit only takes capacity.
  PERFORM public.assert_public_refresh_owner(p_fence);
  SELECT payload->'refreshSelection' INTO selected FROM public.projection_jobs WHERE job_key=p_fence->>'jobKey';
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
      IF target.next_due_at>clock_timestamp() THEN has_backoff:=true; CONTINUE; END IF;
      IF (SELECT count(*) FROM public.public_data_intakes WHERE NOT terminal)>=16 THEN has_capacity:=true; CONTINUE; END IF;
      SELECT external_manager_id INTO STRICT native FROM public.league_source_manager_accounts
        WHERE id=target.source_manager_account_id AND provider=target.provider;
      request_id:=gen_random_uuid(); cycle_number:=COALESCE(target.current_cycle,0)+1;
      -- One new ordinary request. No reset or mutation of previous cycle evidence.
      PERFORM public.submit_public_data_intake(jsonb_build_object('id',request_id,'username',native,'seasons',configuration.seasons));
      due:=target.next_due_at+make_interval(secs=>
        floor(greatest(0,extract(epoch FROM clock_timestamp()-target.next_due_at))/configuration.cadence_seconds)*configuration.cadence_seconds);
      INSERT INTO public.public_data_refresh_cycles(target_id,cycle,configuration_revision,intake_id,due_at)
        VALUES(target.id,cycle_number,target.configuration_revision,request_id,due) RETURNING * INTO cycle_row;
      UPDATE public.public_data_refresh_targets SET current_cycle=cycle_number WHERE id=target.id;
      SELECT * INTO STRICT request FROM public.public_data_intakes WHERE id=request_id;
    END IF;
    IF request.username IS DISTINCT FROM (SELECT external_manager_id FROM public.league_source_manager_accounts
      WHERE id=target.source_manager_account_id AND provider=target.provider)
      OR request.seasons IS DISTINCT FROM configuration.seasons THEN RAISE EXCEPTION 'refresh request scope changed'; END IF;
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
  RETURN jsonb_build_object('status',CASE WHEN has_capacity THEN 'capacity' WHEN has_backoff THEN 'backoff' ELSE 'idle' END,
    'checkedTargets',checked);
END; $$;

CREATE FUNCTION public.record_public_data_refresh_selection_failure(p_selection jsonb,p_fence jsonb,p_reason text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE selected jsonb; target public.public_data_refresh_targets%ROWTYPE; retained public.public_data_refresh_selection_failures%ROWTYPE;
  failures integer; retry_at timestamptz;
BEGIN
  IF p_reason IS NULL OR p_reason NOT IN ('selection-failed','request-state-failed','admission-unconfirmed') THEN
    RAISE EXCEPTION 'invalid public refresh selection failure'; END IF;
  PERFORM public.assert_public_refresh_owner(p_fence);
  SELECT payload->'refreshSelection' INTO selected FROM public.projection_jobs WHERE job_key=p_fence->>'jobKey';
  IF selected IS NULL THEN RETURN jsonb_build_object('status','unbound'); END IF;
  IF p_selection IS NOT NULL AND p_selection<>'null'::jsonb AND p_selection IS DISTINCT FROM selected THEN
    RAISE EXCEPTION 'public refresh selection changed'; END IF;
  -- Unknown admission/checkpoint acknowledgement is resolved against durable
  -- dispatch evidence before a failure counter, backoff or fairness change.
  IF EXISTS(SELECT 1 FROM public.public_data_dispatches WHERE worker_id=p_fence->>'workerId'
    AND generation=(p_fence->>'generation')::integer AND intake_id=(selected->>'requestId')::uuid) THEN
    RETURN jsonb_build_object('status','admitted'); END IF;
  SELECT * INTO STRICT target FROM public.public_data_refresh_targets WHERE id=(selected->>'targetId')::uuid FOR UPDATE;
  PERFORM public.assert_public_refresh_owner(p_fence);
  IF target.configuration_revision<>(selected->>'configurationRevision')::bigint OR target.current_cycle<>(selected->>'cycle')::bigint
    OR NOT EXISTS(SELECT 1 FROM public.public_data_refresh_cycles WHERE target_id=target.id AND cycle=target.current_cycle
      AND configuration_revision=(selected->>'cycleConfigurationRevision')::bigint AND intake_id=(selected->>'requestId')::uuid) THEN
    RETURN jsonb_build_object('status','superseded'); END IF;
  SELECT * INTO retained FROM public.public_data_refresh_selection_failures
    WHERE worker_id=p_fence->>'workerId' AND generation=(p_fence->>'generation')::integer;
  IF FOUND THEN RETURN jsonb_build_object('status','already-recorded','retryAt',retained.next_eligible_at); END IF;
  failures:=least(7,target.selection_failure_count+1);
  retry_at:=clock_timestamp()+make_interval(secs=>least(3600,60*(2^(failures-1))::integer));
  INSERT INTO public.public_data_refresh_selection_failures(worker_id,generation,target_id,configuration_revision,cycle,reason,next_eligible_at)
    VALUES(p_fence->>'workerId',(p_fence->>'generation')::integer,target.id,target.configuration_revision,target.current_cycle,p_reason,retry_at);
  UPDATE public.public_data_refresh_targets SET selection_failure_count=failures,selection_failed_at=clock_timestamp(),
    selection_next_eligible_at=retry_at WHERE id=target.id;
  -- last_served_at is deliberately untouched: no HTTP work was admitted.
  PERFORM public.assert_public_refresh_owner(p_fence);
  RETURN jsonb_build_object('status','recorded','retryAt',retry_at);
END; $$;

ALTER FUNCTION public.admit_public_data_dispatch(jsonb,jsonb) RENAME TO admit_public_data_dispatch_v34;
CREATE FUNCTION public.admit_public_data_dispatch(p_work jsonb,p_fence jsonb) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE cycle_row public.public_data_refresh_cycles%ROWTYPE; target public.public_data_refresh_targets%ROWTYPE;
  configuration public.public_data_refresh_configurations%ROWTYPE; selected jsonb; admitted boolean; admitted_time timestamptz;
BEGIN
  PERFORM public.assert_public_data_owner((p_work->>'requestId')::uuid,p_fence);
  SELECT * INTO cycle_row FROM public.public_data_refresh_cycles WHERE intake_id=(p_work->>'requestId')::uuid;
  IF NOT FOUND THEN RETURN public.admit_public_data_dispatch_v34(p_work,p_fence); END IF;
  PERFORM public.assert_public_refresh_owner(p_fence);
  SELECT payload->'refreshSelection' INTO selected FROM public.projection_jobs WHERE job_key=p_fence->>'jobKey';
  SELECT * INTO STRICT target FROM public.public_data_refresh_targets WHERE id=cycle_row.target_id FOR UPDATE;
  PERFORM public.assert_public_refresh_owner(p_fence);
  IF selected IS DISTINCT FROM jsonb_build_object('status','selected','targetId',target.id,
    'configurationRevision',target.configuration_revision,'cycleConfigurationRevision',cycle_row.configuration_revision,
    'cycle',cycle_row.cycle,'requestId',cycle_row.intake_id) OR target.current_cycle<>cycle_row.cycle THEN RETURN false; END IF;
  SELECT * INTO STRICT configuration FROM public.public_data_refresh_configurations
    WHERE target_id=target.id AND revision=target.configuration_revision;
  IF configuration.paused OR configuration.expires_at<=clock_timestamp()
    OR target.selection_next_eligible_at>clock_timestamp() THEN RETURN false; END IF;
  -- A second admission acknowledgement never authorizes a second HTTP attempt.
  IF EXISTS(SELECT 1 FROM public.public_data_dispatches WHERE worker_id=p_fence->>'workerId'
    AND generation=(p_fence->>'generation')::integer) THEN RETURN false; END IF;
  admitted:=public.admit_public_data_dispatch_v34(p_work,p_fence);
  IF admitted THEN
    PERFORM public.assert_public_refresh_owner(p_fence);
    IF configuration.expires_at<=clock_timestamp() THEN RAISE EXCEPTION 'public refresh approval expired during admission'; END IF;
    SELECT admitted_at INTO STRICT admitted_time FROM public.public_data_dispatches WHERE worker_id=p_fence->>'workerId'
      AND generation=(p_fence->>'generation')::integer AND intake_id=cycle_row.intake_id;
    UPDATE public.public_data_refresh_targets SET last_served_at=admitted_time,selection_failure_count=0,
      selection_failed_at=NULL,selection_next_eligible_at=admitted_time WHERE id=target.id;
    PERFORM public.assert_public_refresh_owner(p_fence);
  END IF;
  -- Checkpoint/cleanup uses the original034 guard. Pausing after admission does
  -- not invalidate its already bounded capture or mutate earlier evidence.
  RETURN admitted;
END; $$;

REVOKE ALL ON public.public_data_refresh_targets,public.public_data_refresh_configurations,public.public_data_refresh_cycles,
  public.public_data_refresh_cycle_outcomes,public.public_data_refresh_selection_failures FROM PUBLIC;
REVOKE ALL ON FUNCTION public.configure_public_data_refresh(jsonb),public.select_public_data_refresh(jsonb),
  public.record_public_data_refresh_selection_failure(jsonb,jsonb,text),public.assert_public_refresh_owner(jsonb),
  public.admit_public_data_dispatch_v34(jsonb,jsonb),public.admit_public_data_dispatch(jsonb,jsonb) FROM PUBLIC;
DO $$ BEGIN
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='league_one_runtime') THEN
    REVOKE ALL ON public.public_data_refresh_targets,public.public_data_refresh_configurations,public.public_data_refresh_cycles,
      public.public_data_refresh_cycle_outcomes,public.public_data_refresh_selection_failures FROM league_one_runtime;
    GRANT SELECT ON public.public_data_refresh_targets,public.public_data_refresh_configurations,public.public_data_refresh_cycles,
      public.public_data_refresh_cycle_outcomes,public.public_data_refresh_selection_failures TO league_one_runtime;
    GRANT EXECUTE ON FUNCTION public.configure_public_data_refresh(jsonb),public.select_public_data_refresh(jsonb),
      public.record_public_data_refresh_selection_failure(jsonb,jsonb,text),public.admit_public_data_dispatch(jsonb,jsonb) TO league_one_runtime;
    REVOKE ALL ON FUNCTION public.assert_public_refresh_owner(jsonb),public.admit_public_data_dispatch_v34(jsonb,jsonb) FROM league_one_runtime;
  END IF;
END; $$;
