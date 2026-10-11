-- CP12: optional 2026 brackets through the existing ordinary DATA intake and refresh.
-- No old request gains work; no worker, provider budget, deadline, or CP11 value changes.
ALTER TABLE public.public_data_intakes ADD COLUMN playoff_brackets text
  CHECK(playoff_brackets IS NULL OR (playoff_brackets='sleeper-2026-playoff-brackets-v1' AND seasons=ARRAY[2026]));
ALTER TABLE public.public_data_refresh_configurations ADD COLUMN playoff_brackets text
  CHECK(playoff_brackets IS NULL OR (playoff_brackets='sleeper-2026-playoff-brackets-v1' AND seasons=ARRAY[2026]));
CREATE TRIGGER public_intake_bracket_scope_immutable BEFORE UPDATE ON public.public_data_intakes
  FOR EACH ROW EXECUTE FUNCTION public.prevent_projection_stable_field_change('playoff_brackets');

CREATE TABLE public.public_data_bracket_tasks (
  intake_id uuid NOT NULL, ordinal integer NOT NULL CHECK(ordinal BETWEEN 1 AND 20),
  season integer NOT NULL CHECK(season=2026), external_league_id text NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','complete','unavailable')),
  failure_count integer NOT NULL DEFAULT 0 CHECK(failure_count BETWEEN 0 AND 5), reason text,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(), write_fence jsonb NOT NULL CHECK(jsonb_typeof(write_fence)='object'),
  PRIMARY KEY(intake_id,ordinal), UNIQUE(intake_id,season,external_league_id),
  FOREIGN KEY(intake_id,season,external_league_id) REFERENCES public.public_data_league_candidates(intake_id,season,external_league_id),
  CHECK((status='unavailable')=(reason IS NOT NULL)),
  CHECK(reason IS NULL OR reason IN ('bracket-capture-exhausted','bootstrap-unavailable','bootstrap-capacity','discovery-unavailable')),
  CHECK(status<>'pending' OR failure_count<5)
);
CREATE TABLE public.public_data_bracket_checkpoints (
  intake_id uuid NOT NULL, task_ordinal integer NOT NULL,
  worker_id text NOT NULL, generation integer NOT NULL,
  league_season_id uuid NOT NULL REFERENCES public.league_seasons(id), source_mapping jsonb NOT NULL,
  winners_bracket_receipt_id uuid NOT NULL REFERENCES public.league_roster_capture_receipts(id),
  losers_bracket_receipt_id uuid NOT NULL REFERENCES public.league_roster_capture_receipts(id),
  recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY(intake_id,task_ordinal), UNIQUE(worker_id,generation),
  FOREIGN KEY(intake_id,task_ordinal) REFERENCES public.public_data_bracket_tasks(intake_id,ordinal),
  FOREIGN KEY(worker_id,generation) REFERENCES public.public_data_dispatches(worker_id,generation),
  CHECK(winners_bracket_receipt_id<>losers_bracket_receipt_id)
);
CREATE FUNCTION public.validate_public_data_bracket_task() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE candidate_rank integer;
BEGIN
  IF NEW.write_fence->>'jobKey' IS DISTINCT FROM 'league-administration-public-intake' THEN
    RAISE EXCEPTION 'public bracket task requires public owner fence'; END IF;
  PERFORM public.assert_roster_player_link_fence(NEW.write_fence);
  IF TG_OP='UPDATE' AND ((to_jsonb(NEW)-ARRAY['status','failure_count','reason','write_fence']) IS DISTINCT FROM
    (to_jsonb(OLD)-ARRAY['status','failure_count','reason','write_fence']) OR NEW.failure_count<OLD.failure_count
    OR (OLD.status<>'pending' AND NEW IS DISTINCT FROM OLD)) THEN
    RAISE EXCEPTION 'public bracket task identity or terminal state is immutable'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.public_data_intakes request WHERE request.id=NEW.intake_id
    AND request.playoff_brackets='sleeper-2026-playoff-brackets-v1' AND request.seasons=ARRAY[2026]) THEN
    RAISE EXCEPTION 'public bracket task is outside immutable selection'; END IF;
  IF TG_OP='INSERT' THEN
    SELECT ranked.rank INTO candidate_rank FROM (SELECT season,external_league_id,
      row_number() OVER(ORDER BY season,external_league_id)::integer AS rank
      FROM public.public_data_league_candidates WHERE intake_id=NEW.intake_id AND stage<>'capacity') ranked
      WHERE ranked.season=NEW.season AND ranked.external_league_id=NEW.external_league_id;
    IF candidate_rank IS NULL OR candidate_rank<>NEW.ordinal OR candidate_rank NOT BETWEEN 1 AND 20
      OR NEW.status<>'pending' OR NEW.failure_count<>0 OR NEW.reason IS NOT NULL THEN
      RAISE EXCEPTION 'public bracket task requires an admitted pending candidate'; END IF;
  END IF;
  IF NEW.status='complete' AND NOT EXISTS(SELECT 1 FROM public.public_data_bracket_checkpoints checkpoint
    WHERE checkpoint.intake_id=NEW.intake_id AND checkpoint.task_ordinal=NEW.ordinal) THEN
    RAISE EXCEPTION 'public bracket completion requires immutable checkpoint'; END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER public_bracket_task_lineage BEFORE INSERT OR UPDATE ON public.public_data_bracket_tasks
  FOR EACH ROW EXECUTE FUNCTION public.validate_public_data_bracket_task();
-- Each deferred event retains its own mutation fence. A later update in this
-- transaction cannot replace the deadline that authorized an earlier event.
CREATE FUNCTION public.validate_public_data_bracket_task_fence() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
  PERFORM public.assert_roster_player_link_fence(NEW.write_fence);
  RETURN NEW;
END; $$;
CREATE CONSTRAINT TRIGGER public_bracket_task_fence AFTER INSERT OR UPDATE ON public.public_data_bracket_tasks
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.validate_public_data_bracket_task_fence();
CREATE TRIGGER public_bracket_task_no_delete BEFORE DELETE ON public.public_data_bracket_tasks
  FOR EACH ROW EXECUTE FUNCTION public.prevent_league_administration_history_change();
CREATE TRIGGER public_bracket_checkpoint_immutable BEFORE UPDATE OR DELETE ON public.public_data_bracket_checkpoints
  FOR EACH ROW EXECUTE FUNCTION public.prevent_league_administration_history_change();


CREATE OR REPLACE FUNCTION public.submit_public_data_intake(p_input jsonb) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE wanted integer[]; periods jsonb; inventory text; brackets text; retained public.public_data_intakes%ROWTYPE;
BEGIN
  IF jsonb_typeof(p_input->'seasons') IS DISTINCT FROM 'array'
    OR jsonb_array_length(p_input->'seasons') NOT BETWEEN 1 AND 3
    OR (p_input->>'username') !~ '^[a-zA-Z0-9_]{1,100}$' THEN RAISE EXCEPTION 'invalid public intake'; END IF;
  SELECT array_agg(value::integer ORDER BY value::integer) INTO wanted FROM jsonb_array_elements_text(p_input->'seasons');
  IF EXISTS(SELECT 1 FROM unnest(wanted) value WHERE value NOT BETWEEN 1920 AND 2200)
    OR cardinality(wanted)<>(SELECT count(DISTINCT value) FROM unnest(wanted) value) THEN
    RAISE EXCEPTION 'invalid public season scope';
  END IF;
  brackets:=p_input->>'playoffBrackets';
  IF p_input ? 'playoffBrackets' AND (jsonb_typeof(p_input->'playoffBrackets') IS DISTINCT FROM 'string'
    OR brackets<>'sleeper-2026-playoff-brackets-v1' OR wanted IS DISTINCT FROM ARRAY[2026]) THEN
    RAISE EXCEPTION 'invalid public bracket selector'; END IF;
  inventory:=p_input->>'periodInventory';
  IF p_input ? 'periodInventory' THEN
    IF jsonb_typeof(p_input->'periodInventory') IS DISTINCT FROM 'string'
      OR inventory<>'sleeper-2026-native-period-inventory-v1' OR p_input ? 'exactPeriods' THEN RAISE EXCEPTION 'invalid public period inventory selector'; END IF;
    periods:=public.canonical_public_data_period_scope(public.public_data_inventory_periods(),wanted,inventory);
  ELSE
    periods:=public.canonical_public_data_exact_periods(CASE WHEN p_input ? 'exactPeriods' THEN p_input->'exactPeriods' ELSE '[]'::jsonb END,wanted);
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('public-data-intake-admission',0));
  SELECT * INTO retained FROM public.public_data_intakes WHERE id=(p_input->>'id')::uuid;
  IF FOUND THEN
    IF retained.username IS DISTINCT FROM p_input->>'username' OR retained.seasons IS DISTINCT FROM wanted OR retained.exact_periods IS DISTINCT FROM periods OR retained.period_inventory IS DISTINCT FROM inventory OR retained.playoff_brackets IS DISTINCT FROM brackets THEN
      RAISE EXCEPTION 'public intake replay mismatch';
    END IF;
    RETURN;
  END IF;
  IF (SELECT count(*) FROM public.public_data_intakes WHERE NOT terminal)>=16 THEN
    RAISE EXCEPTION 'public intake capacity reached';
  END IF;
  INSERT INTO public.public_data_intakes(id,username,seasons,exact_periods,period_inventory,playoff_brackets) VALUES((p_input->>'id')::uuid,p_input->>'username',wanted,periods,inventory,brackets);
END; $$;

CREATE OR REPLACE FUNCTION public.configure_public_data_refresh(p_input jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE target public.public_data_refresh_targets%ROWTYPE; configuration public.public_data_refresh_configurations%ROWTYPE;
  target_id uuid:=(p_input->>'id')::uuid; identity_id uuid:=(p_input->>'identityRequestId')::uuid;
  periods jsonb; inventory text; brackets text; expected bigint:=(p_input->>'expectedRevision')::bigint; manager_id uuid; wanted integer[];
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
  brackets:=p_input->>'playoffBrackets';
  IF p_input ? 'playoffBrackets' AND (jsonb_typeof(p_input->'playoffBrackets') IS DISTINCT FROM 'string'
    OR brackets<>'sleeper-2026-playoff-brackets-v1' OR wanted IS DISTINCT FROM ARRAY[2026]) THEN
    RAISE EXCEPTION 'invalid public bracket selector'; END IF;
  inventory:=p_input->>'periodInventory';
  IF p_input ? 'periodInventory' THEN
    IF jsonb_typeof(p_input->'periodInventory') IS DISTINCT FROM 'string'
      OR inventory<>'sleeper-2026-native-period-inventory-v1' OR p_input ? 'exactPeriods' THEN RAISE EXCEPTION 'invalid public period inventory selector'; END IF;
    periods:=public.canonical_public_data_period_scope(public.public_data_inventory_periods(),wanted,inventory);
  ELSE
    periods:=public.canonical_public_data_exact_periods(CASE WHEN p_input ? 'exactPeriods' THEN p_input->'exactPeriods' ELSE '[]'::jsonb END,wanted);
  END IF;
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
      AND configuration.seasons=wanted AND configuration.exact_periods=periods AND configuration.period_inventory IS NOT DISTINCT FROM inventory AND configuration.playoff_brackets IS NOT DISTINCT FROM brackets AND configuration.cadence_seconds=cadence
      AND configuration.expires_at=expiry AND configuration.paused=paused_value THEN
      RETURN jsonb_build_object('status','replayed','targetId',target.id,'configurationRevision',target.configuration_revision);
    END IF;
    IF target.configuration_revision<>expected THEN RAISE EXCEPTION 'refresh configuration revision changed'; END IF;
    SELECT request.* INTO current_request FROM public.public_data_refresh_cycles cycle
      JOIN public.public_data_intakes request ON request.id=cycle.intake_id
      WHERE cycle.target_id=target.id AND cycle.cycle=target.current_cycle;
    IF FOUND AND NOT current_request.terminal AND (current_request.seasons IS DISTINCT FROM wanted OR current_request.exact_periods IS DISTINCT FROM periods OR current_request.period_inventory IS DISTINCT FROM inventory OR current_request.playoff_brackets IS DISTINCT FROM brackets) THEN
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
  INSERT INTO public.public_data_refresh_configurations(target_id,revision,identity_request_id,seasons,cadence_seconds,expires_at,paused,exact_periods,period_inventory,playoff_brackets)
    VALUES(target_id,next_revision,identity_id,wanted,cadence,expiry,paused_value,periods,inventory,brackets);
  UPDATE public.public_data_refresh_targets SET configuration_revision=next_revision,
    selection_failure_count=0,selection_failed_at=NULL,selection_next_eligible_at=clock_timestamp()
    WHERE id=target_id;
  RETURN jsonb_build_object('status','configured','targetId',target_id,'configurationRevision',next_revision);
END; $$;

CREATE OR REPLACE FUNCTION public.select_public_data_refresh(p_fence jsonb) RETURNS jsonb
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
      PERFORM public.submit_public_data_intake(jsonb_build_object('id',request_id,'username',native,'seasons',configuration.seasons)||CASE WHEN configuration.period_inventory IS NULL THEN jsonb_build_object('exactPeriods',configuration.exact_periods) ELSE jsonb_build_object('periodInventory',configuration.period_inventory) END||CASE WHEN configuration.playoff_brackets IS NULL THEN '{}'::jsonb ELSE jsonb_build_object('playoffBrackets',configuration.playoff_brackets) END);
      due:=target.next_due_at+make_interval(secs=>
        floor(greatest(0,extract(epoch FROM clock_timestamp()-target.next_due_at))/configuration.cadence_seconds)*configuration.cadence_seconds);
      INSERT INTO public.public_data_refresh_cycles(target_id,cycle,configuration_revision,intake_id,due_at)
        VALUES(target.id,cycle_number,target.configuration_revision,request_id,due) RETURNING * INTO cycle_row;
      UPDATE public.public_data_refresh_targets SET current_cycle=cycle_number WHERE id=target.id;
      SELECT * INTO STRICT request FROM public.public_data_intakes WHERE id=request_id;
    END IF;
    IF request.username IS DISTINCT FROM (SELECT external_manager_id FROM public.league_source_manager_accounts
      WHERE id=target.source_manager_account_id AND provider=target.provider)
      OR request.seasons IS DISTINCT FROM configuration.seasons OR request.exact_periods IS DISTINCT FROM configuration.exact_periods
      OR request.playoff_brackets IS DISTINCT FROM configuration.playoff_brackets
      OR request.playoff_brackets IS DISTINCT FROM (SELECT playoff_brackets FROM public.public_data_refresh_configurations
        WHERE target_id=target.id AND revision=cycle_row.configuration_revision)
      OR request.period_inventory IS DISTINCT FROM configuration.period_inventory
      OR request.period_inventory IS DISTINCT FROM (SELECT period_inventory FROM public.public_data_refresh_configurations
        WHERE target_id=target.id AND revision=cycle_row.configuration_revision)
      OR request.exact_periods IS DISTINCT FROM (SELECT exact_periods FROM public.public_data_refresh_configurations
        WHERE target_id=target.id AND revision=cycle_row.configuration_revision) THEN RAISE EXCEPTION 'refresh request scope changed'; END IF;
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

CREATE OR REPLACE FUNCTION public.next_public_data_intake(p_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE request public.public_data_intakes%ROWTYPE; manager text; missing_season integer;
  candidate public.public_data_league_candidates%ROWTYPE; task public.public_data_exact_period_tasks%ROWTYPE; bracket_task public.public_data_bracket_tasks%ROWTYPE; base jsonb;
BEGIN
  SELECT * INTO STRICT request FROM public.public_data_intakes WHERE id=p_id;
  IF request.terminal THEN
    IF NOT EXISTS(SELECT 1 FROM public.public_data_identity_observations WHERE intake_id=p_id)
      OR EXISTS(SELECT 1 FROM unnest(request.seasons) AS wanted(season) WHERE NOT EXISTS(
        SELECT 1 FROM public.public_data_league_lists list WHERE list.intake_id=p_id AND list.season=wanted.season)) THEN
      RETURN '"unavailable"'::jsonb;
    END IF;
    IF EXISTS(SELECT 1 FROM public.public_data_league_candidates WHERE intake_id=p_id AND stage IN ('unavailable','capacity')) THEN
      RETURN '"partial"'::jsonb;
    END IF;
    IF request.exact_periods<>'[]'::jsonb THEN
      IF EXISTS(SELECT 1 FROM public.public_data_exact_period_tasks WHERE intake_id=p_id AND status<>'complete') THEN
        RETURN '"partial"'::jsonb;
      END IF;
    END IF;
    IF request.playoff_brackets IS NOT NULL AND EXISTS(SELECT 1 FROM public.public_data_bracket_tasks
      WHERE intake_id=p_id AND status<>'complete') THEN RETURN '"partial"'::jsonb; END IF;
    RETURN '"complete"'::jsonb;
  END IF;
  IF request.next_attempt_at>clock_timestamp() THEN RETURN '"backoff"'::jsonb; END IF;
  base:=jsonb_build_object('requestId',p_id,'revision',request.revision);
  SELECT account.external_manager_id INTO manager FROM public.public_data_identity_observations identity
    JOIN public.league_source_manager_accounts account ON account.id=identity.source_manager_account_id
    WHERE identity.intake_id=p_id AND account.provider='sleeper';
  IF manager IS NULL THEN RETURN base||jsonb_build_object('kind','identity','username',request.username); END IF;
  SELECT wanted.season INTO missing_season FROM unnest(request.seasons) AS wanted(season)
    WHERE NOT EXISTS(SELECT 1 FROM public.public_data_league_lists list WHERE list.intake_id=p_id AND list.season=wanted.season)
    ORDER BY wanted.season LIMIT 1;
  IF missing_season IS NOT NULL THEN RETURN base||jsonb_build_object('kind','leagues','userId',manager,'season',missing_season); END IF;
  IF request.playoff_brackets IS NOT NULL THEN
    SELECT * INTO candidate FROM public.public_data_league_candidates WHERE intake_id=p_id AND stage='bootstrap'
      ORDER BY season,external_league_id LIMIT 1;
    IF FOUND THEN RETURN base||jsonb_build_object('kind','bootstrap','externalLeagueId',candidate.external_league_id,'season',candidate.season); END IF;
    SELECT pending.* INTO bracket_task FROM public.public_data_bracket_tasks pending JOIN public.public_data_league_candidates eligible
      ON eligible.intake_id=pending.intake_id AND eligible.season=pending.season AND eligible.external_league_id=pending.external_league_id
      WHERE pending.intake_id=p_id AND pending.status='pending' AND eligible.league_season_id IS NOT NULL ORDER BY pending.ordinal LIMIT 1;
    IF FOUND THEN RETURN base||jsonb_build_object('kind','playoff-brackets','externalLeagueId',bracket_task.external_league_id,'season',bracket_task.season); END IF;
  END IF;
  IF request.exact_periods<>'[]'::jsonb THEN
    SELECT * INTO candidate FROM public.public_data_league_candidates WHERE intake_id=p_id AND stage='bootstrap'
      ORDER BY season,external_league_id LIMIT 1;
    IF FOUND THEN RETURN base||jsonb_build_object('kind','bootstrap','externalLeagueId',candidate.external_league_id,'season',candidate.season); END IF;
    SELECT pending.* INTO task FROM public.public_data_exact_period_tasks pending JOIN public.public_data_league_candidates eligible
      ON eligible.intake_id=pending.intake_id AND eligible.season=pending.season AND eligible.external_league_id=pending.external_league_id
      WHERE pending.intake_id=p_id AND pending.status='pending' AND eligible.league_season_id IS NOT NULL ORDER BY pending.ordinal LIMIT 1;
    IF FOUND THEN RETURN base||jsonb_build_object('kind','exact-matchups','externalLeagueId',task.external_league_id,'season',task.season,'nativeWeek',task.native_week); END IF;
  END IF;
  SELECT * INTO candidate FROM public.public_data_league_candidates WHERE intake_id=p_id AND stage IN ('bootstrap','core','users')
    ORDER BY CASE stage WHEN 'users' THEN 1 ELSE 0 END,season,external_league_id LIMIT 1;
  IF NOT FOUND THEN
    IF EXISTS(SELECT 1 FROM public.public_data_league_candidates WHERE intake_id=p_id AND stage IN ('unavailable','capacity')) THEN
      RETURN '"partial"'::jsonb;
    END IF;
    IF request.exact_periods<>'[]'::jsonb THEN
      IF EXISTS(SELECT 1 FROM public.public_data_exact_period_tasks WHERE intake_id=p_id AND status<>'complete') THEN
        RETURN '"partial"'::jsonb;
      END IF;
    END IF;
    IF request.playoff_brackets IS NOT NULL AND EXISTS(SELECT 1 FROM public.public_data_bracket_tasks
      WHERE intake_id=p_id AND status<>'complete') THEN RETURN '"partial"'::jsonb; END IF;
    RETURN '"complete"'::jsonb;
  END IF;
  RETURN base||jsonb_build_object('kind',candidate.stage,'externalLeagueId',candidate.external_league_id,'season',candidate.season);
END; $$;

CREATE FUNCTION public.fail_public_data_bracket_work(p_work jsonb,p_fence jsonb) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE request_id uuid:=(p_work->>'requestId')::uuid; failures integer; periods_selected boolean; brackets_selected boolean;
BEGIN
  PERFORM public.assert_roster_player_link_fence(p_fence);
  UPDATE public.public_data_intakes SET failure_count=failure_count+1,revision=revision+1,
    next_attempt_at=clock_timestamp()+make_interval(secs=>least(3600,60*(2^least(failure_count,5))::integer))
    WHERE id=request_id AND revision=(p_work->>'revision')::integer
    RETURNING failure_count,exact_periods<>'[]'::jsonb,playoff_brackets IS NOT NULL INTO failures,periods_selected,brackets_selected;
  IF NOT FOUND THEN RAISE EXCEPTION 'public intake checkpoint changed'; END IF;
  IF p_work->>'kind'='playoff-brackets' THEN
    IF NOT brackets_selected THEN RAISE EXCEPTION 'explicit public bracket scope required'; END IF;
    UPDATE public.public_data_bracket_tasks SET write_fence=p_fence,failure_count=failures,
      status=CASE WHEN failures>=5 THEN 'unavailable' ELSE 'pending' END,
      reason=CASE WHEN failures>=5 THEN 'bracket-capture-exhausted' ELSE NULL END
      WHERE intake_id=request_id AND season=(p_work->>'season')::integer
        AND external_league_id=p_work->>'externalLeagueId' AND status='pending';
    IF NOT FOUND THEN RAISE EXCEPTION 'public bracket task changed'; END IF;
    IF failures>=5 THEN
      UPDATE public.public_data_intakes SET failure_count=0,next_attempt_at=clock_timestamp() WHERE id=request_id;
      IF public.next_public_data_intake(request_id) IN ('"complete"'::jsonb,'"partial"'::jsonb) THEN
        UPDATE public.public_data_intakes SET terminal=true WHERE id=request_id; END IF;
    END IF;
    RETURN;
  END IF;
  IF failures>=5 AND brackets_selected THEN
    IF p_work->>'kind'='bootstrap' THEN
      UPDATE public.public_data_bracket_tasks SET write_fence=p_fence,status='unavailable',reason='bootstrap-unavailable'
        WHERE intake_id=request_id AND season=(p_work->>'season')::integer
          AND external_league_id=p_work->>'externalLeagueId' AND status='pending';
    ELSIF p_work->>'kind' IN ('identity','leagues') THEN
      UPDATE public.public_data_bracket_tasks SET write_fence=p_fence,status='unavailable',reason='discovery-unavailable'
        WHERE intake_id=request_id AND status='pending';
    END IF;
  END IF;
  IF NOT periods_selected THEN
    IF p_work->>'kind'='exact-matchups' THEN RAISE EXCEPTION 'explicit public period scope required'; END IF;
  END IF;
  IF periods_selected THEN
    IF p_work->>'kind'='exact-matchups' THEN
      UPDATE public.public_data_exact_period_tasks SET failure_count=failures,
      status=CASE WHEN failures>=5 THEN 'unavailable' ELSE 'pending' END,
      reason=CASE WHEN failures>=5 THEN 'period-capture-exhausted' ELSE NULL END
      WHERE intake_id=request_id AND season=(p_work->>'season')::integer AND external_league_id=p_work->>'externalLeagueId'
        AND native_week=(p_work->>'nativeWeek')::integer AND status='pending';
      IF NOT FOUND THEN RAISE EXCEPTION 'public period task changed'; END IF;
    END IF;
  END IF;
  IF failures>=5 THEN
    IF p_work->>'kind'='exact-matchups' THEN
      UPDATE public.public_data_intakes SET failure_count=0,next_attempt_at=clock_timestamp() WHERE id=request_id;
      IF public.next_public_data_intake(request_id) IN ('"complete"'::jsonb,'"partial"'::jsonb) THEN
        UPDATE public.public_data_intakes SET terminal=true WHERE id=request_id; END IF;
    ELSIF p_work->>'kind' IN ('bootstrap','core','users') THEN
      UPDATE public.public_data_league_candidates SET stage='unavailable' WHERE intake_id=request_id
        AND season=(p_work->>'season')::integer AND external_league_id=p_work->>'externalLeagueId';
      IF periods_selected THEN
        IF p_work->>'kind'='bootstrap' THEN
          UPDATE public.public_data_exact_period_tasks SET status='unavailable',reason='bootstrap-unavailable' WHERE intake_id=request_id
            AND season=(p_work->>'season')::integer AND external_league_id=p_work->>'externalLeagueId' AND status='pending';
        END IF;
      END IF;
      UPDATE public.public_data_intakes SET failure_count=0,next_attempt_at=clock_timestamp() WHERE id=request_id;
      IF public.next_public_data_intake(request_id) IN ('"complete"'::jsonb,'"partial"'::jsonb) THEN
        UPDATE public.public_data_intakes SET terminal=true WHERE id=request_id;
      END IF;
    ELSE
      IF periods_selected THEN
        UPDATE public.public_data_exact_period_tasks SET status='unavailable',reason='discovery-unavailable' WHERE intake_id=request_id AND status='pending';
      END IF;
      UPDATE public.public_data_intakes SET terminal=true WHERE id=request_id; END IF;
  END IF;
END; $$;

CREATE OR REPLACE FUNCTION public.recover_public_data_dispatch(p_selected uuid,p_fence jsonb) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE prior public.public_data_dispatches%ROWTYPE; retained_revision integer; disposition text;
BEGIN
  PERFORM public.assert_public_data_owner(p_selected,p_fence);
  SELECT dispatch.* INTO prior FROM public.public_data_dispatches dispatch WHERE NOT EXISTS(
    SELECT 1 FROM public.public_data_dispatch_outcomes outcome WHERE outcome.worker_id=dispatch.worker_id AND outcome.generation=dispatch.generation)
    ORDER BY dispatch.admitted_at LIMIT 1 FOR UPDATE;
  IF NOT FOUND THEN RETURN; END IF;
  IF prior.worker_id=p_fence->>'workerId' AND prior.generation=(p_fence->>'generation')::integer THEN
    RAISE EXCEPTION 'current public dispatch cannot recover itself';
  END IF;
  SELECT revision INTO STRICT retained_revision FROM public.public_data_intakes WHERE id=prior.intake_id FOR UPDATE;
  PERFORM public.assert_public_data_owner(p_selected,p_fence);
  IF retained_revision=prior.revision THEN
    -- Recovery mutates the abandoned request under this new cleanup owner's
    -- original fence, never under the old dispatch's already expired fence.
    IF EXISTS(SELECT 1 FROM public.public_data_intakes WHERE id=prior.intake_id AND playoff_brackets IS NOT NULL) THEN
      PERFORM public.fail_public_data_bracket_work(prior.work,p_fence);
    ELSE PERFORM public.fail_public_data_work(prior.work); END IF;
    disposition:='recovered';
  ELSIF retained_revision>prior.revision THEN disposition:='checkpoint-committed';
  ELSE RAISE EXCEPTION 'public dispatch revision regressed'; END IF;
  PERFORM public.assert_public_data_owner(p_selected,p_fence);
  INSERT INTO public.public_data_dispatch_outcomes(worker_id,generation,outcome) VALUES(prior.worker_id,prior.generation,disposition);
END; $$;

CREATE OR REPLACE FUNCTION public.admit_public_data_dispatch_v34(p_work jsonb,p_fence jsonb) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
  PERFORM public.guard_public_data_intake(p_work,p_fence);
  -- The shared job lock serializes this check even after another request failed.
  -- A crash consumes its admitted interval; reclaim cannot multiply HTTP work.
  IF EXISTS(SELECT 1 FROM public.public_data_dispatches WHERE admitted_at>clock_timestamp()-interval '60 seconds') THEN RETURN false; END IF;
  IF EXISTS(SELECT 1 FROM public.public_data_dispatches dispatch WHERE NOT EXISTS(
    SELECT 1 FROM public.public_data_dispatch_outcomes outcome WHERE outcome.worker_id=dispatch.worker_id AND outcome.generation=dispatch.generation)) THEN
    RAISE EXCEPTION 'public dispatch recovery required';
  END IF;
  INSERT INTO public.public_data_dispatches(worker_id,generation,intake_id,revision,resource,work,max_requests)
    VALUES(p_fence->>'workerId',(p_fence->>'generation')::integer,(p_work->>'requestId')::uuid,(p_work->>'revision')::integer,
      p_work->>'kind',p_work,CASE WHEN p_work->>'kind' IN ('core','exact-matchups','playoff-brackets') THEN 2 ELSE 1 END);
  RETURN true;
END; $$;

-- Extend original acquisition witnesses without changing their existing roles.

CREATE OR REPLACE FUNCTION public.derive_public_data_capture_witness(p_work jsonb,p_mapping jsonb,p_fence jsonb)
RETURNS jsonb LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE dispatch public.public_data_dispatches%ROWTYPE; reserved record;
  role_name text; attempts jsonb:='{}'::jsonb; role_names text[]; kind text:=p_work->>'kind'; witness jsonb;
BEGIN
  IF p_fence->>'jobKey' IS DISTINCT FROM 'league-administration-public-intake'
    OR jsonb_typeof(p_fence) IS DISTINCT FROM 'object'
    OR (SELECT count(*) FROM jsonb_object_keys(p_fence))<>4
    OR NOT(p_fence ?& ARRAY['jobKey','workerId','generation','deadlineAt']) THEN
    RAISE EXCEPTION 'public capture requires exact owner fence'; END IF;
  PERFORM public.guard_public_data_intake(p_work,p_fence);
  SELECT * INTO STRICT dispatch FROM public.public_data_dispatches
    WHERE worker_id=p_fence->>'workerId' AND generation=(p_fence->>'generation')::integer;
  IF dispatch.work IS DISTINCT FROM p_work OR dispatch.capture_nonce IS NULL
    OR dispatch.intake_id IS DISTINCT FROM (p_work->>'requestId')::uuid
    OR dispatch.resource IS DISTINCT FROM kind
    OR dispatch.admitted_at>clock_timestamp() OR dispatch.admitted_at<clock_timestamp()-interval '30 seconds'
    OR EXISTS(SELECT 1 FROM public.public_data_dispatch_outcomes outcome
      WHERE outcome.worker_id=dispatch.worker_id AND outcome.generation=dispatch.generation) THEN
    RAISE EXCEPTION 'current original public dispatch required'; END IF;
  IF kind IN ('core','users','exact-matchups','playoff-brackets') THEN
    IF p_mapping IS NULL OR jsonb_typeof(p_mapping) IS DISTINCT FROM 'object'
      OR p_mapping->'scope'->>'externalLeagueId' IS DISTINCT FROM p_work->>'externalLeagueId'
      OR p_mapping->'scope'->>'season' IS DISTINCT FROM p_work->>'season' THEN
      RAISE EXCEPTION 'public capture mapping mismatch'; END IF;
    PERFORM public.validate_current_roster_mapping(p_mapping);
  ELSIF kind IN ('identity','leagues','bootstrap') THEN
    IF p_mapping IS NOT NULL THEN RAISE EXCEPTION 'unmapped public capture expected'; END IF;
  ELSE RAISE EXCEPTION 'unsupported public capture kind'; END IF;
  FOR reserved IN SELECT attempt.*,scope.identity FROM public.league_roster_resource_attempts attempt
    JOIN public.league_roster_resource_scopes scope ON scope.id=attempt.scope_id
    WHERE attempt.write_fence=p_fence ORDER BY attempt.id LOOP
    IF kind NOT IN ('core','exact-matchups','playoff-brackets') OR reserved.source_mapping IS DISTINCT FROM p_mapping
      OR reserved.capture_nonce IS NULL OR reserved.reserved_at<dispatch.admitted_at
      OR reserved.reserved_at>clock_timestamp() THEN
      RAISE EXCEPTION 'public capture reservation mismatch'; END IF;
    role_name:=CASE reserved.identity->'policy'->>'canonicalNormalizerVersion'
      WHEN 'sleeper-league-settings-v1' THEN 'settings'
      WHEN 'sleeper-current-players-v1' THEN 'players'
      WHEN 'sleeper-current-team-managers-v1' THEN 'managers'
      WHEN 'sleeper-current-team-manager-evidence-v2' THEN 'managersV2'
      WHEN 'sleeper-exact-matchups-v1' THEN 'matchups'
      WHEN 'sleeper-playoff-brackets-v1' THEN CASE WHEN reserved.identity->'scope'->>'family'='playoff-brackets'
        AND reserved.identity->'scope'->>'entityId' IN ('winners_bracket','losers_bracket')
        AND reserved.identity->'scope'->'scoringPeriodId'='null'::jsonb THEN reserved.identity->'scope'->>'entityId' END
      ELSE NULL END;
    IF role_name IS NULL OR attempts ? role_name
      OR (role_name='matchups' AND reserved.identity->'scope'->>'scoringPeriodId'
        IS DISTINCT FROM 'sleeper:matchup-week:'||(p_work->>'nativeWeek')) THEN
      RAISE EXCEPTION 'public capture resource group mismatch'; END IF;
    attempts:=attempts||jsonb_build_object(role_name,jsonb_build_object('id',reserved.id,'nonce',reserved.capture_nonce));
  END LOOP;
  SELECT COALESCE(array_agg(key ORDER BY key COLLATE "C"),ARRAY[]::text[]) INTO role_names FROM jsonb_object_keys(attempts) key;
  IF (kind='core' AND role_names NOT IN (ARRAY['managers','players','settings'],ARRAY['managers','managersV2','players','settings']))
    OR (kind='exact-matchups' AND role_names<>ARRAY['matchups','settings'])
    OR (kind='playoff-brackets' AND role_names<>ARRAY['losers_bracket','winners_bracket'])
    OR (kind NOT IN ('core','exact-matchups','playoff-brackets') AND cardinality(role_names)<>0) THEN
    RAISE EXCEPTION 'complete public capture group required'; END IF;
  -- Recheck after every preceding source/job lock wait. The original DB admission
  -- bounds freshness even when identical content later deduplicates to an old row.
  PERFORM public.assert_public_data_owner(dispatch.intake_id,p_fence);
  IF dispatch.admitted_at<clock_timestamp()-interval '30 seconds' THEN
    RAISE EXCEPTION 'public capture admission expired'; END IF;
  witness:=jsonb_build_object('version','public-network-capture-v1','work',p_work,'fence',p_fence,
    'dispatchNonce',dispatch.capture_nonce,'mapping',p_mapping,'attempts',attempts);
  RETURN witness;
END; $$;

CREATE OR REPLACE FUNCTION public.assert_public_data_capture_witness(p_witness jsonb,p_fence jsonb,p_family text,p_week integer,p_mapping jsonb DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE work jsonb:=p_witness->'work'; kind text:=work->>'kind'; mapping jsonb:=NULLIF(p_witness->'mapping','null'::jsonb);
BEGIN
  IF jsonb_typeof(p_witness) IS DISTINCT FROM 'object'
    OR p_witness->>'version' IS DISTINCT FROM 'public-network-capture-v1'
    OR p_witness->'fence' IS DISTINCT FROM p_fence
    OR (p_mapping IS NOT NULL AND p_mapping IS DISTINCT FROM mapping)
    OR p_witness IS DISTINCT FROM public.derive_public_data_capture_witness(work,mapping,p_fence) THEN
    RAISE EXCEPTION 'invalid original public capture witness'; END IF;
  IF ((kind='identity' AND p_family='identity' AND p_week IS NULL)
    OR (kind='leagues' AND p_family='leagues' AND p_week IS NULL)
    OR (kind='bootstrap' AND p_family='league' AND p_week IS NULL)
    OR (kind='core' AND p_family IN ('league','rosters') AND p_week IS NULL)
    OR (kind='users' AND p_family='users' AND p_week IS NULL)
    OR (kind='playoff-brackets' AND p_family IN ('winners_bracket','losers_bracket') AND p_week IS NULL)
    OR (kind='exact-matchups' AND ((p_family='league' AND p_week IS NULL)
      OR (p_family='matchups' AND p_week=(work->>'nativeWeek')::integer)))) IS NOT TRUE THEN
    RAISE EXCEPTION 'public capture family or period mismatch'; END IF;
END; $$;

CREATE OR REPLACE FUNCTION public.public_capture_after_reservation(p_provenance jsonb,p_attempt uuid)
RETURNS boolean LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE attempt public.league_roster_resource_attempts%ROWTYPE; identity_value jsonb; witness jsonb:=p_provenance->'acquisition';
  family_value text; native_week integer;
BEGIN
  SELECT * INTO STRICT attempt FROM public.league_roster_resource_attempts WHERE id=p_attempt;
  IF witness IS NULL THEN RETURN (p_provenance->>'requestStartedAt')::timestamptz>=attempt.reserved_at; END IF;
  SELECT identity INTO STRICT identity_value FROM public.league_roster_resource_scopes WHERE id=attempt.scope_id;
  family_value:=CASE identity_value->'scope'->>'family' WHEN 'league-season' THEN 'league'
    WHEN 'teams' THEN 'rosters' WHEN 'roster-membership' THEN 'rosters' WHEN 'matchups' THEN 'matchups'
    WHEN 'playoff-brackets' THEN identity_value->'scope'->>'entityId' ELSE NULL END;
  native_week:=CASE WHEN family_value='matchups' THEN (witness->'work'->>'nativeWeek')::integer ELSE NULL END;
  PERFORM public.assert_public_data_capture_witness(witness,attempt.write_fence,family_value,native_week,attempt.source_mapping);
  IF attempt.capture_nonce IS NULL OR NOT EXISTS(SELECT 1 FROM jsonb_each(witness->'attempts') item
    WHERE item.value=jsonb_build_object('id',attempt.id,'nonce',attempt.capture_nonce)) THEN
    RAISE EXCEPTION 'public capture attempt witness mismatch'; END IF;
  RETURN true;
END; $$;

CREATE OR REPLACE FUNCTION public.assert_public_capture_observation(p_input jsonb,p_role text)
RETURNS void LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE witness jsonb:=p_input->'envelope'->'provenance'->'acquisition'; family_value text:=p_input->'envelope'->>'family';
  role_name text; input_key text; addition jsonb; required_roles text[];
BEGIN
  IF witness IS NULL THEN RETURN; END IF;
  PERFORM public.assert_public_data_capture_witness(witness,p_input->'writeFence',family_value,
    (p_input->'envelope'->>'week')::integer,p_input->'sourceMapping');
  IF witness->'mapping'->'scope' IS DISTINCT FROM p_input->'envelope'->'scope' THEN
    RAISE EXCEPTION 'public capture envelope mapping mismatch'; END IF;
  required_roles:=CASE WHEN p_role IS NULL AND family_value='users' THEN ARRAY[]::text[]
    WHEN p_role IN ('settings','players','managers','managersV2','matchups','winners_bracket','losers_bracket') THEN ARRAY[p_role]
    ELSE NULL END;
  IF p_role IN ('winners_bracket','losers_bracket') AND p_role IS DISTINCT FROM family_value THEN
    RAISE EXCEPTION 'public bracket writer family mismatch'; END IF;
  IF required_roles IS NULL THEN RAISE EXCEPTION 'public capture writer role mismatch'; END IF;
  FOREACH role_name IN ARRAY required_roles LOOP
    input_key:=CASE role_name WHEN 'settings' THEN 'leagueSettingsAcceptance' WHEN 'players' THEN 'rosterAcceptance'
      WHEN 'managers' THEN 'teamManagerAcceptance' WHEN 'managersV2' THEN 'teamManagerEvidenceAcceptance'
      WHEN 'winners_bracket' THEN 'bracketAcceptance' WHEN 'losers_bracket' THEN 'bracketAcceptance' ELSE 'matchupAcceptance' END;
    addition:=p_input->input_key;
    IF addition->'attempt'->>'id' IS DISTINCT FROM witness->'attempts'->role_name->>'id'
      OR addition->'attempt'->>'id' IS NULL THEN RAISE EXCEPTION 'public capture writer attempt mismatch'; END IF;
    PERFORM public.public_capture_after_reservation(p_input->'envelope'->'provenance',(addition->'attempt'->>'id')::uuid);
    IF family_value IN ('rosters','matchups') AND addition->'population'->'envelope'->'provenance'->'acquisition' IS DISTINCT FROM witness THEN
      RAISE EXCEPTION 'public capture population group mismatch'; END IF;
  END LOOP;
END; $$;

CREATE OR REPLACE FUNCTION public.assert_public_capture_input_shape(p_input jsonb)
RETURNS void LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE witness jsonb:=p_input->'envelope'->'provenance'->'acquisition'; family_value text:=p_input->'envelope'->>'family';
  roles text[]; role_name text; input_key text; addition jsonb;
  internal_bracket boolean:=family_value IN ('winners_bracket','losers_bracket')
    AND NOT(p_input ?| ARRAY['bracketAcceptance','bracketProjection','sourceMapping']);
BEGIN
  IF witness IS NULL THEN
    IF EXISTS(SELECT 1 FROM jsonb_each(p_input) entry WHERE entry.key IN
      ('rosterAcceptance','teamManagerAcceptance','teamManagerEvidenceAcceptance','matchupAcceptance')
      AND entry.value->'population'->'envelope'->'provenance'->'acquisition' IS NOT NULL) THEN
      RAISE EXCEPTION 'unwitnessed capture cannot borrow witnessed population'; END IF;
    RETURN;
  END IF;
  IF jsonb_typeof(witness) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'invalid public capture shape'; END IF;
  IF witness->>'version' IS DISTINCT FROM 'public-network-capture-v1'
    OR (SELECT count(*) FROM jsonb_object_keys(witness))<>6
    OR NOT(witness ?& ARRAY['version','work','fence','dispatchNonce','mapping','attempts'])
    OR witness->'fence' IS DISTINCT FROM p_input->'writeFence'
    OR (family_value<>'users' AND NOT internal_bracket AND witness->'mapping' IS DISTINCT FROM p_input->'sourceMapping')
    OR p_input->'envelope'->'provenance'->>'origin' IS DISTINCT FROM 'network'
    OR jsonb_typeof(witness->'attempts') IS DISTINCT FROM 'object'
    OR witness->'mapping'->'scope' IS DISTINCT FROM p_input->'envelope'->'scope' THEN
    RAISE EXCEPTION 'invalid public capture shape'; END IF;
  roles:=CASE family_value WHEN 'league' THEN ARRAY['settings']
    WHEN 'rosters' THEN CASE WHEN witness->'attempts' ? 'managersV2' THEN ARRAY['players','managers','managersV2'] ELSE ARRAY['players','managers'] END
    WHEN 'matchups' THEN ARRAY['matchups'] WHEN 'users' THEN ARRAY[]::text[]
    WHEN 'winners_bracket' THEN ARRAY['winners_bracket'] WHEN 'losers_bracket' THEN ARRAY['losers_bracket'] ELSE NULL END;
  IF family_value IN ('winners_bracket','losers_bracket') AND (
    witness->'work'->>'kind' IS DISTINCT FROM 'playoff-brackets'
    OR witness->'work'->>'season' IS DISTINCT FROM '2026'
    OR witness->'work'->>'externalLeagueId' IS DISTINCT FROM p_input->'envelope'->'scope'->>'externalLeagueId'
    OR p_input->'envelope'->'week' IS DISTINCT FROM 'null'::jsonb
    OR (SELECT count(*) FROM jsonb_object_keys(witness->'attempts'))<>2
    OR NOT(witness->'attempts' ?& ARRAY['winners_bracket','losers_bracket'])) THEN
    RAISE EXCEPTION 'complete witnessed bracket group required'; END IF;
  IF roles IS NULL THEN RAISE EXCEPTION 'unsupported witnessed capture'; END IF;
  FOREACH role_name IN ARRAY roles LOOP
    -- Only revoked predecessor functions receive this stripped legacy form.
    -- The public entry validates its full addition first; acquisition is retained.
    IF internal_bracket THEN CONTINUE; END IF;
    input_key:=CASE role_name WHEN 'settings' THEN 'leagueSettingsAcceptance' WHEN 'players' THEN 'rosterAcceptance'
      WHEN 'managers' THEN 'teamManagerAcceptance' WHEN 'managersV2' THEN 'teamManagerEvidenceAcceptance'
      WHEN 'winners_bracket' THEN 'bracketAcceptance' WHEN 'losers_bracket' THEN 'bracketAcceptance' ELSE 'matchupAcceptance' END;
    addition:=p_input->input_key;
    IF addition->'attempt'->>'id' IS NULL
      OR addition->'attempt'->>'id' IS DISTINCT FROM witness->'attempts'->role_name->>'id'
      OR (family_value IN ('rosters','matchups') AND addition->'population'->'envelope'->'provenance'->'acquisition' IS DISTINCT FROM witness) THEN
      RAISE EXCEPTION 'complete witnessed writer input required'; END IF;
  END LOOP;
END; $$;

CREATE OR REPLACE FUNCTION public.record_league_administration_observation(p_input jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE result jsonb; addition jsonb:=p_input->'bracketAcceptance'; projection jsonb:=p_input->'bracketProjection'; expected jsonb; token jsonb;
  attempt public.league_roster_resource_attempts%ROWTYPE; head public.league_roster_resource_heads%ROWTYPE;
  content public.league_administration_contents%ROWTYPE; receipt public.league_roster_capture_receipts%ROWTYPE;
  provenance jsonb:=p_input->'envelope'->'provenance'; family_value text:=p_input->'envelope'->>'family';
  evidence_hash_value text; covered boolean:=false; acceptance_id uuid; legacy_current boolean:=false;
BEGIN
  IF addition IS NULL THEN
    IF family_value IN ('winners_bracket','losers_bracket') AND provenance ? 'acquisition' THEN
      RAISE EXCEPTION 'witnessed public bracket requires typed acceptance'; END IF;
    RETURN public.record_league_administration_observation_v45(p_input);
  END IF;
  -- Shape precedes internal delegation; replay never borrows a different witness.
  PERFORM public.assert_public_capture_input_shape(p_input);
  IF family_value NOT IN ('winners_bracket','losers_bracket') OR family_value IS NULL
    OR p_input->'envelope'->'week' IS DISTINCT FROM 'null'::jsonb
    OR p_input->'envelope'->'scope'->>'season' IS DISTINCT FROM '2026'
    OR p_input->'envelope'->'scope' IS DISTINCT FROM p_input->'sourceMapping'->'scope'
    OR p_input->'sourceMapping' IS NULL OR projection->>'version' IS DISTINCT FROM 'sleeper-playoff-brackets-v1'
    OR projection->>'status' IS NULL OR projection->>'status' NOT IN ('accepted','rejected')
    OR provenance->>'origin' IS DISTINCT FROM 'network'
    OR (provenance->>'requestStartedAt')::timestamptz IS NULL OR (provenance->>'requestCompletedAt')::timestamptz IS NULL
    OR ((provenance->>'sourceObservedAt')::timestamptz IS NULL AND projection->>'status'='accepted')
    OR (provenance->>'checkedAt')::timestamptz IS NULL
    OR (provenance->>'requestStartedAt')::timestamptz>(provenance->>'requestCompletedAt')::timestamptz
    OR (provenance->>'requestCompletedAt')::timestamptz>(provenance->>'checkedAt')::timestamptz
    OR (provenance->>'sourceObservedAt')::timestamptz>(provenance->>'checkedAt')::timestamptz
    OR (provenance->>'checkedAt')::timestamptz>clock_timestamp()+interval '5 minutes' THEN
    RAISE EXCEPTION 'bracket acceptance requires exact mapped network capture'; END IF;
  result:=public.record_league_administration_observation_v45(p_input-'bracketAcceptance'-'bracketProjection'-'sourceMapping');
  PERFORM public.validate_current_roster_mapping(p_input->'sourceMapping');
  token:=addition->'attempt';
  SELECT * INTO STRICT attempt FROM public.league_roster_resource_attempts WHERE id=(token->>'id')::uuid;
  IF provenance->'acquisition' IS NULL AND (provenance->>'requestStartedAt')::timestamptz<attempt.reserved_at THEN
    RAISE EXCEPTION 'bracket request predates reservation'; END IF;
  IF attempt.source_mapping IS DISTINCT FROM p_input->'sourceMapping' OR attempt.write_fence IS DISTINCT FROM p_input->'writeFence'
    OR token IS DISTINCT FROM jsonb_build_object('id',attempt.id,'scopeId',attempt.scope_id,'ordinal',attempt.ordinal,'expectedGeneration',attempt.expected_generation)
    OR NOT EXISTS(SELECT 1 FROM public.league_roster_resource_scopes scope WHERE scope.id=attempt.scope_id
      AND scope.identity=jsonb_build_object('scope',jsonb_build_object('kind','enrolled-resource','connectionId',attempt.source_mapping->>'connectionId',
        'leagueSeasonId',attempt.source_mapping->>'leagueSeasonId','family','playoff-brackets','entityId',family_value,'scoringPeriodId',NULL,
        'audienceId','public','coverageSpecId','sleeper-playoff-brackets-v1'),'policy',jsonb_build_object('audienceId','public',
        'coverageSpecId','sleeper-playoff-brackets-v1','canonicalNormalizerVersion','sleeper-playoff-brackets-v1','validationVersion','latest-network-attempt-v1'))) THEN
    RAISE EXCEPTION 'bracket attempt scope mismatch'; END IF;
  SELECT * INTO STRICT head FROM public.league_roster_resource_heads WHERE scope_id=attempt.scope_id FOR UPDATE;
  IF attempt.write_fence IS NOT NULL THEN PERFORM public.assert_roster_player_link_fence(attempt.write_fence); END IF;
  SELECT * INTO STRICT content FROM public.league_administration_contents stored
    WHERE stored.league_season_id=(attempt.source_mapping->>'leagueSeasonId')::uuid AND stored.provider='sleeper'
      AND stored.external_league_id=attempt.source_mapping->'scope'->>'externalLeagueId' AND stored.family=family_value AND stored.week=0
      AND stored.normalizer_version='sleeper-administration-v1' AND stored.content_hash=p_input->>'contentHash'
      AND stored.completeness=p_input->'envelope'->>'completeness'
      AND stored.accepted=(p_input->>'status'='accepted' AND p_input->'envelope'->>'completeness'='complete')
      AND stored.payload=p_input->'envelope'->'payload' AND stored.normalized_value IS NOT DISTINCT FROM p_input->'value';
  legacy_current:=result->>'status' IN ('changed','unchanged','replayed') AND EXISTS(SELECT 1 FROM public.league_administration_heads legacy
    JOIN public.league_administration_observations observation ON observation.id=legacy.accepted_observation_id
    WHERE legacy.league_season_id=content.league_season_id AND legacy.family=family_value AND legacy.week=0 AND legacy.read_conflict IS NULL
      AND observation.content_id=content.id AND observation.id=(result->>'observationId')::uuid);
  IF projection->>'status'='accepted' THEN
    IF NOT content.accepted OR content.completeness<>'complete' OR projection->'diagnostics' IS DISTINCT FROM '[]'::jsonb THEN
      RAISE EXCEPTION 'unproved bracket projection'; END IF;
    expected:=public.project_bracket_native(content.payload,content.family,content.normalized_value);
    IF projection->'value' IS DISTINCT FROM expected THEN RAISE EXCEPTION 'bracket projection mismatch'; END IF;
    covered:=true;
  ELSIF projection->'value' IS DISTINCT FROM 'null'::jsonb OR jsonb_typeof(projection->'diagnostics') IS DISTINCT FROM 'array'
    OR jsonb_array_length(projection->'diagnostics')=0 THEN RAISE EXCEPTION 'invalid bracket rejection evidence'; END IF;
  evidence_hash_value:=encode(digest(convert_to(p_input::text,'UTF8'),'sha256'),'hex');
  SELECT * INTO receipt FROM public.league_roster_capture_receipts WHERE attempt_id=attempt.id;
  IF FOUND THEN
    IF receipt.evidence_hash<>evidence_hash_value THEN RAISE EXCEPTION 'bracket attempt receipt conflict'; END IF;
    IF attempt.write_fence IS NOT NULL THEN PERFORM public.assert_roster_player_link_fence(attempt.write_fence); END IF;
    RETURN result||jsonb_build_object('bracketAcceptance',jsonb_build_object('status',CASE WHEN attempt.ordinal=head.latest_ordinal AND EXISTS(
      SELECT 1 FROM public.league_roster_resource_acceptances accepted WHERE accepted.id=head.accepted_id AND accepted.receipt_id=receipt.id)
      THEN 'accepted' ELSE 'preserved' END,'reason','exact_receipt_replay','receiptId',receipt.id,'acceptedGeneration',head.generation));
  END IF;
  -- Live dispatch derivation is required only for a new receipt. Exact immutable
  -- replay above retains the original input hash and fence after dispatch settlement.
  IF provenance ? 'acquisition' THEN PERFORM public.assert_public_capture_observation(p_input,family_value); END IF;
  INSERT INTO public.league_roster_capture_receipts(attempt_id,content_id,legacy_observation_id,evidence_hash,provenance,coverage)
    VALUES(attempt.id,content.id,(result->>'observationId')::uuid,evidence_hash_value,provenance,
      jsonb_build_object('periodIds','[]'::jsonb,'interval',NULL,'entitySet',CASE WHEN covered THEN 'full' ELSE 'unknown' END,
        'fields','["r","m","t1","t2","t1_from","t2_from","w","l","p"]'::jsonb,'pagination','complete','nextCursor',NULL,
        'completeness',CASE WHEN covered THEN 'complete' WHEN content.completeness='partial' THEN 'partial' ELSE 'unknown' END,
        'reasons',CASE WHEN covered THEN '[]'::jsonb ELSE '["complete_bracket_structure_unproved"]'::jsonb END)) RETURNING * INTO receipt;
  IF attempt.ordinal=head.latest_ordinal AND attempt.expected_generation=head.generation AND covered AND legacy_current THEN
    IF attempt.write_fence IS NOT NULL THEN PERFORM public.assert_roster_player_link_fence(attempt.write_fence); END IF;
    INSERT INTO public.league_roster_resource_acceptances(scope_id,receipt_id,source_mapping_revision_id,generation)
      VALUES(attempt.scope_id,receipt.id,(attempt.source_mapping->>'revisionId')::uuid,head.generation+1) RETURNING id INTO acceptance_id;
    PERFORM public.capture_bracket_typed(content.id,acceptance_id,expected);
    IF attempt.write_fence IS NOT NULL THEN PERFORM public.assert_roster_player_link_fence(attempt.write_fence); END IF;
    UPDATE public.league_roster_resource_heads SET accepted_id=acceptance_id,generation=generation+1 WHERE scope_id=attempt.scope_id RETURNING * INTO head;
  END IF;
  IF attempt.write_fence IS NOT NULL THEN PERFORM public.assert_roster_player_link_fence(attempt.write_fence); END IF;
  RETURN result||jsonb_build_object('bracketAcceptance',jsonb_build_object('status',CASE WHEN acceptance_id IS NOT NULL THEN 'accepted' ELSE 'preserved' END,
    'reason',CASE WHEN acceptance_id IS NOT NULL THEN NULL WHEN attempt.ordinal<>head.latest_ordinal THEN 'newer_network_attempt_reserved'
      WHEN attempt.expected_generation<>head.generation THEN 'accepted_generation_changed' WHEN NOT covered THEN 'complete_bracket_structure_unproved'
      WHEN NOT legacy_current THEN 'legacy_bracket_not_current' END,'receiptId',receipt.id,'acceptedGeneration',head.generation));
END; $$;

-- Current paired checkpoint must bind two fresh accepted resources from one dispatch.
-- Neither an earlier family head nor a receipt from another attempt can complete it.
CREATE FUNCTION public.validate_public_data_bracket_checkpoint() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE task public.public_data_bracket_tasks%ROWTYPE; dispatch public.public_data_dispatches%ROWTYPE;
  winner public.league_roster_capture_receipts%ROWTYPE; loser public.league_roster_capture_receipts%ROWTYPE;
  winner_attempt public.league_roster_resource_attempts%ROWTYPE; loser_attempt public.league_roster_resource_attempts%ROWTYPE;
  family_value text; wanted uuid; identity_value jsonb; reserved timestamptz; acquisition jsonb;
BEGIN
  SELECT * INTO STRICT task FROM public.public_data_bracket_tasks WHERE intake_id=NEW.intake_id AND ordinal=NEW.task_ordinal;
  SELECT * INTO STRICT dispatch FROM public.public_data_dispatches WHERE worker_id=NEW.worker_id AND generation=NEW.generation;
  SELECT * INTO STRICT winner FROM public.league_roster_capture_receipts WHERE id=NEW.winners_bracket_receipt_id;
  SELECT * INTO STRICT loser FROM public.league_roster_capture_receipts WHERE id=NEW.losers_bracket_receipt_id;
  SELECT * INTO STRICT winner_attempt FROM public.league_roster_resource_attempts WHERE id=winner.attempt_id;
  SELECT * INTO STRICT loser_attempt FROM public.league_roster_resource_attempts WHERE id=loser.attempt_id;
  acquisition:=winner.provenance->'acquisition';
  IF task.status<>'pending' OR dispatch.intake_id<>NEW.intake_id OR dispatch.resource<>'playoff-brackets' OR dispatch.max_requests<>2
    OR dispatch.work IS DISTINCT FROM jsonb_build_object('requestId',NEW.intake_id,'revision',dispatch.revision,
      'kind','playoff-brackets','season',task.season,'externalLeagueId',task.external_league_id)
    OR winner_attempt.write_fence->>'workerId' IS DISTINCT FROM NEW.worker_id
    OR winner_attempt.write_fence->>'generation' IS DISTINCT FROM NEW.generation::text
    OR loser_attempt.write_fence IS DISTINCT FROM winner_attempt.write_fence
    OR winner_attempt.source_mapping IS DISTINCT FROM NEW.source_mapping
    OR loser_attempt.source_mapping IS DISTINCT FROM NEW.source_mapping
    OR NEW.source_mapping->>'leagueSeasonId' IS DISTINCT FROM NEW.league_season_id::text
    OR jsonb_typeof(acquisition) IS DISTINCT FROM 'object'
    OR loser.provenance->'acquisition' IS DISTINCT FROM acquisition
    OR NOT EXISTS(SELECT 1 FROM public.public_data_league_candidates candidate WHERE candidate.intake_id=task.intake_id
      AND candidate.season=task.season AND candidate.external_league_id=task.external_league_id AND candidate.league_season_id=NEW.league_season_id)
    OR EXISTS(SELECT 1 FROM public.public_data_dispatch_outcomes outcome WHERE outcome.worker_id=NEW.worker_id AND outcome.generation=NEW.generation) THEN
    RAISE EXCEPTION 'public bracket checkpoint dispatch or task mismatch'; END IF;
  PERFORM public.guard_public_data_intake(dispatch.work,winner_attempt.write_fence);
  PERFORM public.validate_current_roster_mapping(NEW.source_mapping);
  PERFORM public.assert_public_data_owner(NEW.intake_id,winner_attempt.write_fence);
  reserved:=GREATEST(winner_attempt.reserved_at,loser_attempt.reserved_at);
  FOREACH family_value IN ARRAY ARRAY['winners_bracket','losers_bracket'] LOOP
    wanted:=CASE WHEN family_value='winners_bracket' THEN winner.id ELSE loser.id END;
    identity_value:=jsonb_build_object('scope',jsonb_build_object('kind','enrolled-resource',
      'connectionId',NEW.source_mapping->>'connectionId','leagueSeasonId',NEW.league_season_id::text,
      'family','playoff-brackets','entityId',family_value,'scoringPeriodId',NULL,'audienceId','public',
      'coverageSpecId','sleeper-playoff-brackets-v1'),'policy',jsonb_build_object('audienceId','public',
      'coverageSpecId','sleeper-playoff-brackets-v1','canonicalNormalizerVersion','sleeper-playoff-brackets-v1',
      'validationVersion','latest-network-attempt-v1'));
    IF NOT EXISTS(SELECT 1 FROM public.league_roster_resource_acceptances accepted
      JOIN public.league_roster_capture_receipts receipt ON receipt.id=accepted.receipt_id
      JOIN public.league_roster_resource_attempts attempt ON attempt.id=receipt.attempt_id
      JOIN public.league_roster_resource_scopes scope ON scope.id=attempt.scope_id AND scope.identity=identity_value
      JOIN public.league_roster_resource_heads head ON head.scope_id=scope.id AND head.accepted_id=accepted.id AND head.generation=accepted.generation
      JOIN public.league_administration_contents content ON content.id=receipt.content_id
      JOIN public.league_administration_observations observed ON observed.id=receipt.legacy_observation_id AND observed.content_id=content.id
      JOIN public.league_bracket_contents typed ON typed.content_id=content.id AND typed.family=family_value
      WHERE receipt.id=wanted AND accepted.scope_id=scope.id AND accepted.source_mapping_revision_id=(NEW.source_mapping->>'revisionId')::uuid
        AND attempt.source_mapping=NEW.source_mapping AND attempt.write_fence=winner_attempt.write_fence
        AND attempt.ordinal=head.latest_ordinal AND attempt.reserved_at>=dispatch.admitted_at
        AND content.league_season_id=NEW.league_season_id AND content.provider='sleeper' AND content.external_league_id=task.external_league_id
        AND content.family=family_value AND content.week=0 AND content.accepted AND content.completeness='complete'
        AND receipt.configuration_content_id IS NULL AND receipt.population_evidence IS NULL AND receipt.expected_team_count IS NULL
        AND receipt.coverage->>'completeness'='complete' AND receipt.coverage->'periodIds'='[]'::jsonb
        AND receipt.provenance->>'origin'='network' AND receipt.provenance->'acquisition'=acquisition
        AND public.public_capture_after_reservation(receipt.provenance,attempt.id)
        AND receipt.recorded_at BETWEEN reserved AND clock_timestamp()
        AND (receipt.provenance->>'requestStartedAt')::timestamptz<=(receipt.provenance->>'requestCompletedAt')::timestamptz
        AND (receipt.provenance->>'sourceObservedAt')::timestamptz=(receipt.provenance->>'requestCompletedAt')::timestamptz) THEN
      RAISE EXCEPTION 'current dispatch-bound bracket receipt required'; END IF;
  END LOOP;
  PERFORM public.assert_public_data_owner(NEW.intake_id,winner_attempt.write_fence);
  RETURN NEW;
END; $$;
CREATE TRIGGER public_bracket_checkpoint_lineage BEFORE INSERT ON public.public_data_bracket_checkpoints
  FOR EACH ROW EXECUTE FUNCTION public.validate_public_data_bracket_checkpoint();

-- The original worker fence also applies at explicit COMMIT, including a reused
-- typed content header. A caller cannot wait past the deadline after checkpointing.
CREATE FUNCTION public.validate_public_data_bracket_checkpoint_fence() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE fence jsonb;
BEGIN
  SELECT attempt.write_fence INTO STRICT fence FROM public.league_roster_capture_receipts receipt
    JOIN public.league_roster_resource_attempts attempt ON attempt.id=receipt.attempt_id
    WHERE receipt.id=NEW.winners_bracket_receipt_id;
  IF fence IS NULL THEN RAISE EXCEPTION 'public bracket checkpoint requires original fence'; END IF;
  PERFORM public.assert_roster_player_link_fence(fence);
  RETURN NEW;
END; $$;
CREATE CONSTRAINT TRIGGER public_bracket_checkpoint_fence AFTER INSERT ON public.public_data_bracket_checkpoints
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.validate_public_data_bracket_checkpoint_fence();

-- Reuse R044/R039 for every existing kind, including failure/recovery accounting.
ALTER FUNCTION public.checkpoint_public_data_intake(jsonb,jsonb,jsonb) RENAME TO checkpoint_public_data_intake_v46;
CREATE FUNCTION public.checkpoint_public_data_intake(p_work jsonb,p_capture jsonb,p_fence jsonb) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE request_id uuid:=(p_work->>'requestId')::uuid; mode_value text;
  task public.public_data_bracket_tasks%ROWTYPE; acquisition jsonb; family_value text;
BEGIN
  SELECT playoff_brackets INTO STRICT mode_value FROM public.public_data_intakes WHERE id=request_id;
  IF mode_value IS NOT NULL AND p_capture->'failed'='true'::jsonb THEN
    PERFORM public.guard_public_data_intake(p_work,p_fence);
    IF NOT EXISTS(SELECT 1 FROM public.public_data_dispatches dispatch WHERE dispatch.worker_id=p_fence->>'workerId'
      AND dispatch.generation=(p_fence->>'generation')::integer AND dispatch.work=p_work AND NOT EXISTS(
        SELECT 1 FROM public.public_data_dispatch_outcomes outcome WHERE outcome.worker_id=dispatch.worker_id AND outcome.generation=dispatch.generation)) THEN
      RAISE EXCEPTION 'matching admitted public dispatch required'; END IF;
    PERFORM public.fail_public_data_bracket_work(p_work,p_fence);
    PERFORM public.assert_public_data_owner(request_id,p_fence);
    INSERT INTO public.public_data_dispatch_outcomes(worker_id,generation,outcome)
      VALUES(p_fence->>'workerId',(p_fence->>'generation')::integer,'failed');
    RETURN;
  END IF;
  IF p_work->>'kind' IS DISTINCT FROM 'playoff-brackets' OR p_capture->'failed'='true'::jsonb THEN
    PERFORM public.checkpoint_public_data_intake_v46(p_work,p_capture,p_fence);
    SELECT playoff_brackets INTO STRICT mode_value FROM public.public_data_intakes WHERE id=request_id;
    IF mode_value IS NULL THEN RETURN; END IF;
    IF p_work->>'kind'='leagues' AND p_capture->'failed' IS DISTINCT FROM 'true'::jsonb
      AND p_capture->>'diagnostic' IS DISTINCT FROM 'invalid-source' THEN
      INSERT INTO public.public_data_bracket_tasks(intake_id,ordinal,season,external_league_id,write_fence)
        SELECT request_id,row_number() OVER(ORDER BY candidate.season,candidate.external_league_id),candidate.season,candidate.external_league_id,p_fence
        FROM public.public_data_league_candidates candidate WHERE candidate.intake_id=request_id AND candidate.stage<>'capacity';
    ELSIF p_work->>'kind'='bootstrap' AND p_capture->>'capacity'='roster-count-unqualified' THEN
      UPDATE public.public_data_bracket_tasks SET write_fence=p_fence,status='unavailable',reason='bootstrap-capacity'
        WHERE intake_id=request_id AND season=(p_work->>'season')::integer
          AND external_league_id=p_work->>'externalLeagueId' AND status='pending';
    END IF;
    PERFORM public.assert_public_data_owner(request_id,p_fence);
    RETURN;
  END IF;
  PERFORM public.guard_public_data_intake(p_work,p_fence);
  SELECT playoff_brackets INTO STRICT mode_value FROM public.public_data_intakes WHERE id=request_id;
  IF mode_value IS DISTINCT FROM 'sleeper-2026-playoff-brackets-v1' THEN RAISE EXCEPTION 'explicit public bracket scope required'; END IF;
  IF jsonb_typeof(p_capture) IS DISTINCT FROM 'object' OR (SELECT count(*) FROM jsonb_object_keys(p_capture))<>3
    OR NOT(p_capture ?& ARRAY['mapping','observations','receipts'])
    OR jsonb_typeof(p_capture->'observations') IS DISTINCT FROM 'object'
    OR jsonb_typeof(p_capture->'receipts') IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'public bracket checkpoint incomplete'; END IF;
  IF (SELECT count(*) FROM jsonb_object_keys(p_capture->'observations'))<>2
    OR NOT(p_capture->'observations' ?& ARRAY['winners_bracket','losers_bracket'])
    OR (SELECT count(*) FROM jsonb_object_keys(p_capture->'receipts'))<>2
    OR NOT(p_capture->'receipts' ?& ARRAY['winners_bracket','losers_bracket']) THEN RAISE EXCEPTION 'public bracket checkpoint incomplete'; END IF;
  SELECT * INTO STRICT task FROM public.public_data_bracket_tasks WHERE intake_id=request_id
    AND season=(p_work->>'season')::integer AND external_league_id=p_work->>'externalLeagueId' AND status='pending';
  FOREACH family_value IN ARRAY ARRAY['winners_bracket','losers_bracket'] LOOP
    IF NOT EXISTS(SELECT 1 FROM public.league_roster_capture_receipts receipt
      JOIN public.league_roster_resource_attempts attempt ON attempt.id=receipt.attempt_id
      JOIN public.league_roster_resource_scopes scope ON scope.id=attempt.scope_id
      WHERE receipt.id=(p_capture->'receipts'->>family_value)::uuid AND attempt.write_fence=p_fence
        AND receipt.legacy_observation_id=(p_capture->'observations'->>family_value)::uuid
        AND scope.identity->'scope'->>'family'='playoff-brackets' AND scope.identity->'scope'->>'entityId'=family_value) THEN
      RAISE EXCEPTION 'public bracket observation mismatch'; END IF;
  END LOOP;
  INSERT INTO public.public_data_bracket_checkpoints(intake_id,task_ordinal,worker_id,generation,league_season_id,
    source_mapping,winners_bracket_receipt_id,losers_bracket_receipt_id)
    VALUES(request_id,task.ordinal,p_fence->>'workerId',(p_fence->>'generation')::integer,(p_capture->'mapping'->>'leagueSeasonId')::uuid,
      p_capture->'mapping',(p_capture->'receipts'->>'winners_bracket')::uuid,(p_capture->'receipts'->>'losers_bracket')::uuid);
  SELECT provenance->'acquisition' INTO STRICT acquisition FROM public.league_roster_capture_receipts
    WHERE id=(p_capture->'receipts'->>'winners_bracket')::uuid;
  PERFORM public.assert_public_data_owner(request_id,p_fence);
  UPDATE public.public_data_bracket_tasks SET write_fence=p_fence,status='complete' WHERE intake_id=request_id AND ordinal=task.ordinal;
  UPDATE public.public_data_intakes SET revision=revision+1,failure_count=0,next_attempt_at=clock_timestamp() WHERE id=request_id;
  IF public.next_public_data_intake(request_id) IN ('"complete"'::jsonb,'"partial"'::jsonb) THEN
    UPDATE public.public_data_intakes SET terminal=true WHERE id=request_id; END IF;
  INSERT INTO public.public_data_dispatch_outcomes(worker_id,generation,outcome,capture_acquisition)
    VALUES(p_fence->>'workerId',(p_fence->>'generation')::integer,'checkpoint-committed',acquisition);
  PERFORM public.assert_public_data_owner(request_id,p_fence);
END; $$;
REVOKE ALL ON public.public_data_bracket_tasks,public.public_data_bracket_checkpoints FROM PUBLIC;
REVOKE ALL ON FUNCTION public.validate_public_data_bracket_task_fence(),public.fail_public_data_bracket_work(jsonb,jsonb),
  public.validate_public_data_bracket_task(),public.validate_public_data_bracket_checkpoint(),
  public.validate_public_data_bracket_checkpoint_fence(),public.checkpoint_public_data_intake_v46(jsonb,jsonb,jsonb),
  public.checkpoint_public_data_intake(jsonb,jsonb,jsonb) FROM PUBLIC;
DO $$ BEGIN
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='league_one_runtime') THEN
    REVOKE ALL ON public.public_data_bracket_tasks,public.public_data_bracket_checkpoints FROM league_one_runtime;
    GRANT SELECT ON public.public_data_bracket_tasks,public.public_data_bracket_checkpoints TO league_one_runtime;
    REVOKE ALL ON FUNCTION public.validate_public_data_bracket_task_fence(),public.fail_public_data_bracket_work(jsonb,jsonb),
  public.validate_public_data_bracket_task(),public.validate_public_data_bracket_checkpoint(),
      public.validate_public_data_bracket_checkpoint_fence(),public.checkpoint_public_data_intake_v46(jsonb,jsonb,jsonb) FROM league_one_runtime;
    GRANT EXECUTE ON FUNCTION public.checkpoint_public_data_intake(jsonb,jsonb,jsonb) TO league_one_runtime;
  END IF;
END; $$;
