-- CP15: explicit complete 2026 transaction history through the existing DATA runner.
-- Existing R033 acceptance and R051 dispatch/receipt witnesses remain authoritative.
-- This migration authors storage only; it does not activate collection or refresh.
CREATE FUNCTION public.canonical_public_data_transaction_history(p_value jsonb,p_seasons integer[]) RETURNS text
LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
  IF p_value IS NULL THEN RETURN NULL; END IF;
  IF p_seasons IS DISTINCT FROM ARRAY[2026] OR jsonb_typeof(p_value) IS DISTINCT FROM 'string'
    OR p_value IS DISTINCT FROM '"sleeper-2026-transaction-history-v1"'::jsonb THEN
    RAISE EXCEPTION 'invalid public transaction history'; END IF;
  RETURN p_value#>>'{}';
END; $$;

CREATE FUNCTION public.public_data_transaction_periods(p_period jsonb,p_history text) RETURNS jsonb
LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
  IF p_history IS NOT NULL THEN
    IF p_history<>'sleeper-2026-transaction-history-v1' OR p_period IS NOT NULL THEN
      RAISE EXCEPTION 'invalid public transaction selection'; END IF;
    RETURN (SELECT jsonb_agg(jsonb_build_object('season',2026,'nativeWeek',native_week) ORDER BY native_week)
      FROM generate_series(0,18) AS periods(native_week));
  END IF;
  RETURN CASE WHEN p_period IS NULL THEN '[]'::jsonb ELSE jsonb_build_array(p_period) END;
END; $$;

ALTER TABLE public.public_data_intakes ADD COLUMN transaction_history text
  CHECK(transaction_history IS NOT DISTINCT FROM public.canonical_public_data_transaction_history(to_jsonb(transaction_history),seasons));
ALTER TABLE public.public_data_intakes ADD CONSTRAINT public_intake_transaction_selection_exclusive
  CHECK(transaction_history IS NULL OR transaction_period IS NULL);
ALTER TABLE public.public_data_refresh_configurations ADD COLUMN transaction_history text
  CHECK(transaction_history IS NOT DISTINCT FROM public.canonical_public_data_transaction_history(to_jsonb(transaction_history),seasons));
CREATE TRIGGER public_intake_transaction_history_immutable BEFORE UPDATE ON public.public_data_intakes
  FOR EACH ROW EXECUTE FUNCTION public.prevent_projection_stable_field_change('transaction_history');
-- Refresh configurations and cycle bindings already have append-only triggers.
-- At most twenty admitted candidates times nineteen requested periods. Excess
-- candidates keep the existing capacity rows, without silently shrinking scope.
ALTER TABLE public.public_data_transaction_tasks DROP CONSTRAINT public_data_transaction_tasks_ordinal_check;
ALTER TABLE public.public_data_transaction_tasks ADD CONSTRAINT public_data_transaction_tasks_ordinal_check
  CHECK(ordinal BETWEEN 1 AND 380);

CREATE OR REPLACE FUNCTION public.validate_public_data_transaction_task() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE candidate_rank integer; requested_periods jsonb;
BEGIN
  IF NEW.write_fence->>'jobKey' IS DISTINCT FROM 'league-administration-public-intake' THEN
    RAISE EXCEPTION 'public transaction task requires public owner fence'; END IF;
  PERFORM public.assert_roster_player_link_fence(NEW.write_fence);
  IF TG_OP='UPDATE' AND ((to_jsonb(NEW)-ARRAY['status','failure_count','reason','write_fence']) IS DISTINCT FROM
    (to_jsonb(OLD)-ARRAY['status','failure_count','reason','write_fence']) OR NEW.failure_count<OLD.failure_count
    OR (OLD.status<>'pending' AND NEW IS DISTINCT FROM OLD)) THEN
    RAISE EXCEPTION 'public transaction task identity or terminal state is immutable'; END IF;
  SELECT public.public_data_transaction_periods(request.transaction_period,request.transaction_history)
    INTO requested_periods FROM public.public_data_intakes request
    WHERE request.id=NEW.intake_id AND request.seasons=ARRAY[2026];
  IF requested_periods IS NULL OR NOT (requested_periods
    @> jsonb_build_array(jsonb_build_object('season',NEW.season,'nativeWeek',NEW.native_week))) THEN
    RAISE EXCEPTION 'public transaction task is outside immutable selection'; END IF;
  IF TG_OP='INSERT' THEN
    SELECT ranked.rank INTO candidate_rank FROM (
      SELECT candidate.season,candidate.external_league_id,(period->>'nativeWeek')::integer AS native_week,
        row_number() OVER(ORDER BY candidate.season,candidate.external_league_id,(period->>'nativeWeek')::integer)::integer AS rank
      FROM public.public_data_league_candidates candidate
      CROSS JOIN jsonb_array_elements(requested_periods) period
      WHERE candidate.intake_id=NEW.intake_id AND candidate.stage<>'capacity') ranked
      WHERE ranked.season=NEW.season AND ranked.external_league_id=NEW.external_league_id AND ranked.native_week=NEW.native_week;
    IF candidate_rank IS NULL OR candidate_rank<>NEW.ordinal OR candidate_rank NOT BETWEEN 1 AND 20*jsonb_array_length(requested_periods)
      OR NEW.status<>'pending' OR NEW.failure_count<>0 OR NEW.reason IS NOT NULL THEN
      RAISE EXCEPTION 'public transaction task requires an admitted pending candidate'; END IF;
  END IF;
  IF NEW.status='complete' AND NOT EXISTS(SELECT 1 FROM public.public_data_transaction_checkpoints checkpoint
    WHERE checkpoint.intake_id=NEW.intake_id AND checkpoint.task_ordinal=NEW.ordinal) THEN
    RAISE EXCEPTION 'public transaction completion requires immutable checkpoint'; END IF;
  RETURN NEW;
END; $$;

CREATE OR REPLACE FUNCTION public.submit_public_data_intake(p_input jsonb) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE wanted integer[]; periods jsonb; inventory text; brackets text; reports jsonb; transaction_period_value jsonb; history text; retained public.public_data_intakes%ROWTYPE;
BEGIN
  IF jsonb_typeof(p_input->'seasons') IS DISTINCT FROM 'array'
    OR jsonb_array_length(p_input->'seasons') NOT BETWEEN 1 AND 3
    OR (p_input->>'username') !~ '^[a-zA-Z0-9_]{1,100}$' THEN RAISE EXCEPTION 'invalid public intake'; END IF;
  SELECT array_agg(value::integer ORDER BY value::integer) INTO wanted FROM jsonb_array_elements_text(p_input->'seasons');
  IF EXISTS(SELECT 1 FROM unnest(wanted) value WHERE value NOT BETWEEN 1920 AND 2200)
    OR cardinality(wanted)<>(SELECT count(DISTINCT value) FROM unnest(wanted) value) THEN
    RAISE EXCEPTION 'invalid public season scope';
  END IF;
  history:=public.canonical_public_data_transaction_history(p_input->'transactionHistory',wanted);
  IF p_input ? 'transactionHistory' AND p_input ? 'transactionPeriod' THEN
    RAISE EXCEPTION 'public transaction selectors are mutually exclusive'; END IF;
  transaction_period_value:=public.canonical_public_data_transaction_period(p_input->'transactionPeriod',wanted);
  reports:=public.canonical_public_data_weekly_reports(CASE WHEN p_input ? 'weeklyReports' THEN p_input->'weeklyReports' ELSE '[]'::jsonb END,wanted);
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
    IF retained.username IS DISTINCT FROM p_input->>'username' OR retained.seasons IS DISTINCT FROM wanted OR retained.exact_periods IS DISTINCT FROM periods OR retained.period_inventory IS DISTINCT FROM inventory OR retained.playoff_brackets IS DISTINCT FROM brackets OR retained.weekly_reports IS DISTINCT FROM reports OR retained.transaction_period IS DISTINCT FROM transaction_period_value OR retained.transaction_history IS DISTINCT FROM history THEN
      RAISE EXCEPTION 'public intake replay mismatch';
    END IF;
    RETURN;
  END IF;
  IF (SELECT count(*) FROM public.public_data_intakes WHERE NOT terminal)>=16 THEN
    RAISE EXCEPTION 'public intake capacity reached';
  END IF;
  INSERT INTO public.public_data_intakes(id,username,seasons,exact_periods,period_inventory,playoff_brackets,weekly_reports,transaction_period,transaction_history) VALUES((p_input->>'id')::uuid,p_input->>'username',wanted,periods,inventory,brackets,reports,transaction_period_value,history);
END; $$;

CREATE OR REPLACE FUNCTION public.configure_public_data_refresh(p_input jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE target public.public_data_refresh_targets%ROWTYPE; configuration public.public_data_refresh_configurations%ROWTYPE;
  target_id uuid:=(p_input->>'id')::uuid; identity_id uuid:=(p_input->>'identityRequestId')::uuid;
  periods jsonb; inventory text; brackets text; reports jsonb; history text; expected bigint:=(p_input->>'expectedRevision')::bigint; manager_id uuid; wanted integer[];
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
  history:=public.canonical_public_data_transaction_history(p_input->'transactionHistory',wanted);
  IF p_input ? 'transactionHistory' AND p_input ? 'transactionPeriod' THEN
    RAISE EXCEPTION 'public transaction selectors are mutually exclusive'; END IF;
  reports:=public.canonical_public_data_weekly_reports(CASE WHEN p_input ? 'weeklyReports' THEN p_input->'weeklyReports' ELSE '[]'::jsonb END,wanted);
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
      AND configuration.seasons=wanted AND configuration.exact_periods=periods AND configuration.period_inventory IS NOT DISTINCT FROM inventory AND configuration.playoff_brackets IS NOT DISTINCT FROM brackets AND configuration.weekly_reports=reports AND configuration.transaction_history IS NOT DISTINCT FROM history AND configuration.cadence_seconds=cadence
      AND configuration.expires_at=expiry AND configuration.paused=paused_value THEN
      RETURN jsonb_build_object('status','replayed','targetId',target.id,'configurationRevision',target.configuration_revision);
    END IF;
    IF target.configuration_revision<>expected THEN RAISE EXCEPTION 'refresh configuration revision changed'; END IF;
    SELECT request.* INTO current_request FROM public.public_data_refresh_cycles cycle
      JOIN public.public_data_intakes request ON request.id=cycle.intake_id
      WHERE cycle.target_id=target.id AND cycle.cycle=target.current_cycle;
    IF FOUND AND NOT current_request.terminal AND (current_request.seasons IS DISTINCT FROM wanted OR current_request.exact_periods IS DISTINCT FROM periods OR current_request.period_inventory IS DISTINCT FROM inventory OR current_request.playoff_brackets IS DISTINCT FROM brackets OR current_request.weekly_reports IS DISTINCT FROM reports OR current_request.transaction_history IS DISTINCT FROM history) THEN
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
  INSERT INTO public.public_data_refresh_configurations(target_id,revision,identity_request_id,seasons,cadence_seconds,expires_at,paused,exact_periods,period_inventory,playoff_brackets,weekly_reports,transaction_history)
    VALUES(target_id,next_revision,identity_id,wanted,cadence,expiry,paused_value,periods,inventory,brackets,reports,history);
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
      PERFORM public.submit_public_data_intake(jsonb_build_object('id',request_id,'username',native,'seasons',configuration.seasons)||CASE WHEN configuration.period_inventory IS NULL THEN jsonb_build_object('exactPeriods',configuration.exact_periods) ELSE jsonb_build_object('periodInventory',configuration.period_inventory) END||CASE WHEN configuration.playoff_brackets IS NULL THEN '{}'::jsonb ELSE jsonb_build_object('playoffBrackets',configuration.playoff_brackets) END||CASE WHEN configuration.weekly_reports='[]'::jsonb THEN '{}'::jsonb ELSE jsonb_build_object('weeklyReports',configuration.weekly_reports) END||CASE WHEN configuration.transaction_history IS NULL THEN '{}'::jsonb ELSE jsonb_build_object('transactionHistory',configuration.transaction_history) END);
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
  candidate public.public_data_league_candidates%ROWTYPE; task public.public_data_exact_period_tasks%ROWTYPE; bracket_task public.public_data_bracket_tasks%ROWTYPE; report_task public.public_data_report_tasks%ROWTYPE; transaction_task public.public_data_transaction_tasks%ROWTYPE; base jsonb;
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
    IF (request.transaction_period IS NOT NULL OR request.transaction_history IS NOT NULL) AND EXISTS(SELECT 1 FROM public.public_data_transaction_tasks
      WHERE intake_id=p_id AND status<>'complete') THEN RETURN '"partial"'::jsonb; END IF;
    IF request.weekly_reports<>'[]'::jsonb AND EXISTS(SELECT 1 FROM public.public_data_report_tasks
      WHERE intake_id=p_id AND status<>'complete') THEN RETURN '"partial"'::jsonb; END IF;
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
  IF (request.transaction_period IS NOT NULL OR request.transaction_history IS NOT NULL) THEN
    SELECT * INTO candidate FROM public.public_data_league_candidates WHERE intake_id=p_id AND stage='bootstrap'
      ORDER BY season,external_league_id LIMIT 1;
    IF FOUND THEN RETURN base||jsonb_build_object('kind','bootstrap','externalLeagueId',candidate.external_league_id,'season',candidate.season); END IF;
    SELECT pending.* INTO transaction_task FROM public.public_data_transaction_tasks pending JOIN public.public_data_league_candidates eligible
      ON eligible.intake_id=pending.intake_id AND eligible.season=pending.season AND eligible.external_league_id=pending.external_league_id
      WHERE pending.intake_id=p_id AND pending.status='pending' AND eligible.league_season_id IS NOT NULL ORDER BY pending.ordinal LIMIT 1;
    IF FOUND THEN RETURN base||jsonb_build_object('kind','transactions','externalLeagueId',transaction_task.external_league_id,
      'season',transaction_task.season,'nativeWeek',transaction_task.native_week); END IF;
  END IF;
  IF request.weekly_reports<>'[]'::jsonb THEN
    SELECT * INTO candidate FROM public.public_data_league_candidates WHERE intake_id=p_id AND stage='bootstrap'
      ORDER BY season,external_league_id LIMIT 1;
    IF FOUND THEN RETURN base||jsonb_build_object('kind','bootstrap','externalLeagueId',candidate.external_league_id,'season',candidate.season); END IF;
    SELECT pending.* INTO report_task FROM public.public_data_report_tasks pending JOIN public.public_data_league_candidates eligible
      ON eligible.intake_id=pending.intake_id AND eligible.season=pending.season AND eligible.external_league_id=pending.external_league_id
      WHERE pending.intake_id=p_id AND pending.status='pending' AND eligible.league_season_id IS NOT NULL ORDER BY pending.ordinal LIMIT 1;
    IF FOUND THEN RETURN base||jsonb_build_object('kind','weekly-report','externalLeagueId',report_task.external_league_id,
      'season',report_task.season,'nativeWeek',report_task.native_week); END IF;
  END IF;
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
    IF (request.transaction_period IS NOT NULL OR request.transaction_history IS NOT NULL) AND EXISTS(SELECT 1 FROM public.public_data_transaction_tasks
      WHERE intake_id=p_id AND status<>'complete') THEN RETURN '"partial"'::jsonb; END IF;
    IF request.weekly_reports<>'[]'::jsonb AND EXISTS(SELECT 1 FROM public.public_data_report_tasks
      WHERE intake_id=p_id AND status<>'complete') THEN RETURN '"partial"'::jsonb; END IF;
    IF request.playoff_brackets IS NOT NULL AND EXISTS(SELECT 1 FROM public.public_data_bracket_tasks
      WHERE intake_id=p_id AND status<>'complete') THEN RETURN '"partial"'::jsonb; END IF;
    RETURN '"complete"'::jsonb;
  END IF;
  RETURN base||jsonb_build_object('kind',candidate.stage,'externalLeagueId',candidate.external_league_id,'season',candidate.season);
END; $$;

CREATE OR REPLACE FUNCTION public.fail_public_data_transaction_work(p_work jsonb,p_fence jsonb) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE request_id uuid:=(p_work->>'requestId')::uuid; failures integer;
BEGIN
  PERFORM public.assert_roster_player_link_fence(p_fence);
  IF p_work->>'kind' IS DISTINCT FROM 'transactions' THEN
    SELECT failure_count+1 INTO STRICT failures FROM public.public_data_intakes WHERE id=request_id;
    IF failures>=5 AND p_work->>'kind' IN ('bootstrap','identity','leagues') THEN
      UPDATE public.public_data_transaction_tasks SET write_fence=p_fence,status='unavailable',
        reason=CASE WHEN p_work->>'kind'='bootstrap' THEN 'bootstrap-unavailable' ELSE 'discovery-unavailable' END
      WHERE intake_id=request_id AND status='pending' AND (p_work->>'kind'<>'bootstrap'
        OR (season=(p_work->>'season')::integer AND external_league_id=p_work->>'externalLeagueId'));
    END IF;
    PERFORM public.fail_public_data_report_work(p_work,p_fence);
    RETURN;
  END IF;
  UPDATE public.public_data_intakes SET failure_count=failure_count+1,revision=revision+1,
    next_attempt_at=clock_timestamp()+make_interval(secs=>least(3600,60*(2^least(failure_count,5))::integer))
    WHERE id=request_id AND revision=(p_work->>'revision')::integer AND (transaction_period IS NOT NULL OR transaction_history IS NOT NULL)
    RETURNING failure_count INTO failures;
  IF NOT FOUND THEN RAISE EXCEPTION 'public transaction intake checkpoint changed'; END IF;
  UPDATE public.public_data_transaction_tasks SET write_fence=p_fence,failure_count=failures,
    status=CASE WHEN failures>=5 THEN 'unavailable' ELSE 'pending' END,
    reason=CASE WHEN failures>=5 THEN 'transaction-capture-exhausted' ELSE NULL END
    WHERE intake_id=request_id AND season=(p_work->>'season')::integer AND external_league_id=p_work->>'externalLeagueId'
      AND native_week=(p_work->>'nativeWeek')::integer AND status='pending';
  IF NOT FOUND THEN RAISE EXCEPTION 'public transaction task changed'; END IF;
  IF failures>=5 THEN
    UPDATE public.public_data_intakes SET failure_count=0,next_attempt_at=clock_timestamp() WHERE id=request_id;
    IF public.next_public_data_intake(request_id) IN ('"complete"'::jsonb,'"partial"'::jsonb) THEN
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
    IF EXISTS(SELECT 1 FROM public.public_data_intakes WHERE id=prior.intake_id AND (transaction_period IS NOT NULL OR transaction_history IS NOT NULL)) THEN
      PERFORM public.fail_public_data_transaction_work(prior.work,p_fence);
    ELSIF EXISTS(SELECT 1 FROM public.public_data_intakes WHERE id=prior.intake_id AND weekly_reports<>'[]'::jsonb) THEN
      PERFORM public.fail_public_data_report_work(prior.work,p_fence);
    ELSIF EXISTS(SELECT 1 FROM public.public_data_intakes WHERE id=prior.intake_id AND playoff_brackets IS NOT NULL) THEN
      PERFORM public.fail_public_data_bracket_work(prior.work,p_fence);
    ELSE PERFORM public.fail_public_data_work(prior.work); END IF;
    disposition:='recovered';
  ELSIF retained_revision>prior.revision THEN disposition:='checkpoint-committed';
  ELSE RAISE EXCEPTION 'public dispatch revision regressed'; END IF;
  PERFORM public.assert_public_data_owner(p_selected,p_fence);
  INSERT INTO public.public_data_dispatch_outcomes(worker_id,generation,outcome) VALUES(prior.worker_id,prior.generation,disposition);
END; $$;

CREATE OR REPLACE FUNCTION public.checkpoint_public_data_intake(p_work jsonb,p_capture jsonb,p_fence jsonb) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE request_id uuid:=(p_work->>'requestId')::uuid; transactions jsonb;
  task public.public_data_transaction_tasks%ROWTYPE; acquisition jsonb;
BEGIN
  SELECT public.public_data_transaction_periods(transaction_period,transaction_history) INTO STRICT transactions FROM public.public_data_intakes WHERE id=request_id;
  IF transactions<>'[]'::jsonb AND p_capture->'failed'='true'::jsonb THEN
    PERFORM public.guard_public_data_intake(p_work,p_fence);
    IF NOT EXISTS(SELECT 1 FROM public.public_data_dispatches dispatch WHERE dispatch.worker_id=p_fence->>'workerId'
      AND dispatch.generation=(p_fence->>'generation')::integer AND dispatch.work=p_work AND NOT EXISTS(
        SELECT 1 FROM public.public_data_dispatch_outcomes outcome WHERE outcome.worker_id=dispatch.worker_id AND outcome.generation=dispatch.generation)) THEN
      RAISE EXCEPTION 'matching admitted public dispatch required'; END IF;
    PERFORM public.fail_public_data_transaction_work(p_work,p_fence);
    PERFORM public.assert_public_data_owner(request_id,p_fence);
    INSERT INTO public.public_data_dispatch_outcomes(worker_id,generation,outcome)
      VALUES(p_fence->>'workerId',(p_fence->>'generation')::integer,'failed');
    RETURN;
  END IF;
  IF p_work->>'kind' IS DISTINCT FROM 'transactions' OR p_capture->'failed'='true'::jsonb THEN
    PERFORM public.checkpoint_public_data_intake_v50(p_work,p_capture,p_fence);
    IF transactions='[]'::jsonb THEN RETURN; END IF;
    IF p_work->>'kind'='leagues' AND p_capture->'failed' IS DISTINCT FROM 'true'::jsonb
      AND p_capture->>'diagnostic' IS DISTINCT FROM 'invalid-source' THEN
      INSERT INTO public.public_data_transaction_tasks(intake_id,ordinal,season,external_league_id,native_week,write_fence)
        SELECT request_id,row_number() OVER(ORDER BY candidate.season,candidate.external_league_id,(period->>'nativeWeek')::integer),
          candidate.season,candidate.external_league_id,(period->>'nativeWeek')::integer,p_fence
        FROM public.public_data_league_candidates candidate CROSS JOIN jsonb_array_elements(transactions) period
        WHERE candidate.intake_id=request_id AND candidate.stage<>'capacity';
    ELSIF p_work->>'kind'='bootstrap' AND p_capture->>'capacity'='roster-count-unqualified' THEN
      UPDATE public.public_data_transaction_tasks SET write_fence=p_fence,status='unavailable',reason='bootstrap-capacity'
        WHERE intake_id=request_id AND season=(p_work->>'season')::integer
          AND external_league_id=p_work->>'externalLeagueId' AND status='pending';
    END IF;
    PERFORM public.assert_public_data_owner(request_id,p_fence);
    RETURN;
  END IF;
  PERFORM public.guard_public_data_intake(p_work,p_fence);
  IF NOT (transactions @> jsonb_build_array(jsonb_build_object('season',(p_work->>'season')::integer,
    'nativeWeek',(p_work->>'nativeWeek')::integer))) THEN RAISE EXCEPTION 'explicit public transaction scope required'; END IF;
  IF jsonb_typeof(p_capture) IS DISTINCT FROM 'object' OR (SELECT count(*) FROM jsonb_object_keys(p_capture))<>3
    OR NOT(p_capture ?& ARRAY['mapping','observations','receipts'])
    OR jsonb_typeof(p_capture->'observations') IS DISTINCT FROM 'object'
    OR jsonb_typeof(p_capture->'receipts') IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'public transaction checkpoint incomplete'; END IF;
  IF (SELECT count(*) FROM jsonb_object_keys(p_capture->'observations'))<>1 OR NOT(p_capture->'observations' ? 'transactions')
    OR (SELECT count(*) FROM jsonb_object_keys(p_capture->'receipts'))<>1 OR NOT(p_capture->'receipts' ? 'transactions') THEN
    RAISE EXCEPTION 'public transaction checkpoint incomplete'; END IF;
  SELECT * INTO STRICT task FROM public.public_data_transaction_tasks WHERE intake_id=request_id
    AND season=(p_work->>'season')::integer AND external_league_id=p_work->>'externalLeagueId'
    AND native_week=(p_work->>'nativeWeek')::integer AND status='pending';
  IF NOT EXISTS(SELECT 1 FROM public.league_roster_capture_receipts receipt
    JOIN public.league_roster_resource_attempts attempt ON attempt.id=receipt.attempt_id
    JOIN public.league_roster_resource_scopes scope ON scope.id=attempt.scope_id
    WHERE receipt.id=(p_capture->'receipts'->>'transactions')::uuid AND attempt.write_fence=p_fence
      AND receipt.legacy_observation_id=(p_capture->'observations'->>'transactions')::uuid
      AND scope.identity->'scope'->>'family'='transactions' AND scope.identity->'scope'->'entityId'='null'::jsonb
      AND scope.identity->'scope'->>'scoringPeriodId'='sleeper:transaction-week:'||task.native_week) THEN
    RAISE EXCEPTION 'public transaction observation mismatch'; END IF;
  INSERT INTO public.public_data_transaction_checkpoints(intake_id,task_ordinal,worker_id,generation,league_season_id,source_mapping,transaction_receipt_id)
    VALUES(request_id,task.ordinal,p_fence->>'workerId',(p_fence->>'generation')::integer,(p_capture->'mapping'->>'leagueSeasonId')::uuid,
      p_capture->'mapping',(p_capture->'receipts'->>'transactions')::uuid);
  SELECT provenance->'acquisition' INTO STRICT acquisition FROM public.league_roster_capture_receipts
    WHERE id=(p_capture->'receipts'->>'transactions')::uuid;
  PERFORM public.assert_public_data_owner(request_id,p_fence);
  UPDATE public.public_data_transaction_tasks SET write_fence=p_fence,status='complete' WHERE intake_id=request_id AND ordinal=task.ordinal;
  UPDATE public.public_data_intakes SET revision=revision+1,failure_count=0,next_attempt_at=clock_timestamp() WHERE id=request_id;
  IF public.next_public_data_intake(request_id) IN ('"complete"'::jsonb,'"partial"'::jsonb) THEN
    UPDATE public.public_data_intakes SET terminal=true WHERE id=request_id; END IF;
  INSERT INTO public.public_data_dispatch_outcomes(worker_id,generation,outcome,capture_acquisition)
    VALUES(p_fence->>'workerId',(p_fence->>'generation')::integer,'checkpoint-committed',acquisition);
  PERFORM public.assert_public_data_owner(request_id,p_fence);
END; $$;

-- CREATE OR REPLACE preserves existing function ownership and ACLs. Only the
-- two new private helpers need revocation; no new runtime entry point is added.
REVOKE ALL ON FUNCTION public.canonical_public_data_transaction_history(jsonb,integer[]),
  public.public_data_transaction_periods(jsonb,text) FROM PUBLIC;
DO $$ BEGIN
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='league_one_runtime') THEN
    REVOKE ALL ON FUNCTION public.canonical_public_data_transaction_history(jsonb,integer[]),
      public.public_data_transaction_periods(jsonb,text) FROM league_one_runtime;
    IF has_function_privilege('league_one_runtime','public.canonical_public_data_transaction_history(jsonb,integer[])','EXECUTE')
      OR has_function_privilege('league_one_runtime','public.public_data_transaction_periods(jsonb,text)','EXECUTE') THEN
      RAISE EXCEPTION 'runtime can execute private public transaction history helper'; END IF;
  END IF;
END; $$;
