-- CP8: opt-in bounded 2026 native-period inventory in the existing DATA runner.
-- Source only until separately qualified. Migrations001-043 remain unchanged.
-- Baseline weeks are requested coverage; they do not assert provider availability.
ALTER TABLE public.public_data_intakes ADD COLUMN period_inventory text;
ALTER TABLE public.public_data_refresh_configurations ADD COLUMN period_inventory text;

CREATE FUNCTION public.public_data_inventory_periods() RETURNS jsonb
LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,public,pg_temp AS $$
  SELECT jsonb_agg(jsonb_build_object('season',2026,'nativeWeek',week) ORDER BY week) FROM generate_series(1,18) week
$$;
CREATE FUNCTION public.canonical_public_data_period_scope(p_value jsonb,p_seasons integer[],p_mode text)
RETURNS jsonb LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
  IF p_mode IS NULL THEN RETURN public.canonical_public_data_exact_periods(p_value,p_seasons); END IF;
  IF p_mode<>'sleeper-2026-native-period-inventory-v1' OR p_seasons IS DISTINCT FROM ARRAY[2026]
    OR p_value IS DISTINCT FROM public.public_data_inventory_periods() THEN RAISE EXCEPTION 'invalid public period inventory scope'; END IF;
  RETURN p_value;
END; $$;
-- Replace only the two old scope CHECKs; retain their canonical helper unchanged.
DO $$ DECLARE relation text; constraint_name text; matches integer; BEGIN
  FOREACH relation IN ARRAY ARRAY['public_data_intakes','public_data_refresh_configurations'] LOOP
    SELECT count(*),min(conname::text) INTO matches,constraint_name FROM pg_constraint
      WHERE conrelid=('public.'||relation)::regclass AND contype='c'
        AND pg_get_constraintdef(oid) LIKE '%canonical_public_data_exact_periods%';
    IF matches<>1 THEN RAISE EXCEPTION 'expected original exact-period scope constraint'; END IF;
    EXECUTE format('ALTER TABLE public.%I DROP CONSTRAINT %I',relation,constraint_name);
    EXECUTE format('ALTER TABLE public.%I ADD CONSTRAINT %I CHECK(exact_periods=public.canonical_public_data_period_scope(exact_periods,seasons,period_inventory))',relation,relation||'_period_inventory_scope');
  END LOOP;
END; $$;
CREATE TRIGGER public_intake_inventory_scope_immutable BEFORE UPDATE ON public.public_data_intakes
  FOR EACH ROW EXECUTE FUNCTION public.prevent_projection_stable_field_change('period_inventory');

ALTER TABLE public.public_data_exact_period_tasks DROP CONSTRAINT public_data_exact_period_tasks_ordinal_check;
ALTER TABLE public.public_data_exact_period_tasks ADD CONSTRAINT public_period_task_ordinal_bound CHECK(ordinal BETWEEN 1 AND 360);
DO $$ DECLARE constraint_name text; matches integer; BEGIN
  SELECT count(*),min(conname::text) INTO matches,constraint_name FROM pg_constraint
    WHERE conrelid='public.public_data_exact_period_tasks'::regclass AND contype='u'
      AND conkey=ARRAY[(SELECT attnum FROM pg_attribute WHERE attrelid='public.public_data_exact_period_tasks'::regclass AND attname='intake_id'),
        (SELECT attnum FROM pg_attribute WHERE attrelid='public.public_data_exact_period_tasks'::regclass AND attname='season'),
        (SELECT attnum FROM pg_attribute WHERE attrelid='public.public_data_exact_period_tasks'::regclass AND attname='external_league_id')]::smallint[];
  IF matches<>1 THEN RAISE EXCEPTION 'expected original public period candidate uniqueness'; END IF;
  EXECUTE format('ALTER TABLE public.public_data_exact_period_tasks DROP CONSTRAINT %I',constraint_name);
END; $$;
ALTER TABLE public.public_data_exact_period_tasks ADD CONSTRAINT public_period_task_native_scope UNIQUE(intake_id,season,external_league_id,native_week);

CREATE FUNCTION public.bind_public_data_inventory_task() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE mode_value text; candidate_rank integer;
BEGIN
  SELECT period_inventory INTO STRICT mode_value FROM public.public_data_intakes WHERE id=NEW.intake_id;
  IF mode_value IS NULL THEN
    IF NEW.ordinal NOT BETWEEN 1 AND 20 THEN RAISE EXCEPTION 'legacy public period task capacity exceeded'; END IF;
    RETURN NEW;
  END IF;
  IF TG_OP='INSERT' THEN
    SELECT ranked.rank INTO candidate_rank FROM (SELECT season,external_league_id,
      row_number() OVER(ORDER BY season,external_league_id)::integer AS rank
      FROM public.public_data_league_candidates WHERE intake_id=NEW.intake_id AND stage<>'capacity') ranked
      WHERE ranked.season=NEW.season AND ranked.external_league_id=NEW.external_league_id;
    IF candidate_rank IS NULL OR candidate_rank NOT BETWEEN 1 AND 20 OR NEW.season<>2026 THEN
      RAISE EXCEPTION 'inventory task requires an admitted 2026 candidate'; END IF;
    NEW.ordinal:=(candidate_rank-1)*18+NEW.native_week;
  END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER public_period_inventory_task_ordinal BEFORE INSERT OR UPDATE ON public.public_data_exact_period_tasks
  FOR EACH ROW EXECUTE FUNCTION public.bind_public_data_inventory_task();

-- Existing intake/configuration/selection owners; only opt-in scope copying and replay comparisons change.
CREATE OR REPLACE FUNCTION public.submit_public_data_intake(p_input jsonb) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE wanted integer[]; periods jsonb; inventory text; retained public.public_data_intakes%ROWTYPE;
BEGIN
  IF jsonb_typeof(p_input->'seasons') IS DISTINCT FROM 'array'
    OR jsonb_array_length(p_input->'seasons') NOT BETWEEN 1 AND 3
    OR (p_input->>'username') !~ '^[a-zA-Z0-9_]{1,100}$' THEN RAISE EXCEPTION 'invalid public intake'; END IF;
  SELECT array_agg(value::integer ORDER BY value::integer) INTO wanted FROM jsonb_array_elements_text(p_input->'seasons');
  IF EXISTS(SELECT 1 FROM unnest(wanted) value WHERE value NOT BETWEEN 1920 AND 2200)
    OR cardinality(wanted)<>(SELECT count(DISTINCT value) FROM unnest(wanted) value) THEN
    RAISE EXCEPTION 'invalid public season scope';
  END IF;
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
    IF retained.username IS DISTINCT FROM p_input->>'username' OR retained.seasons IS DISTINCT FROM wanted OR retained.exact_periods IS DISTINCT FROM periods OR retained.period_inventory IS DISTINCT FROM inventory THEN
      RAISE EXCEPTION 'public intake replay mismatch';
    END IF;
    RETURN;
  END IF;
  IF (SELECT count(*) FROM public.public_data_intakes WHERE NOT terminal)>=16 THEN
    RAISE EXCEPTION 'public intake capacity reached';
  END IF;
  INSERT INTO public.public_data_intakes(id,username,seasons,exact_periods,period_inventory) VALUES((p_input->>'id')::uuid,p_input->>'username',wanted,periods,inventory);
END; $$;

CREATE OR REPLACE FUNCTION public.configure_public_data_refresh(p_input jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE target public.public_data_refresh_targets%ROWTYPE; configuration public.public_data_refresh_configurations%ROWTYPE;
  target_id uuid:=(p_input->>'id')::uuid; identity_id uuid:=(p_input->>'identityRequestId')::uuid;
  periods jsonb; inventory text; expected bigint:=(p_input->>'expectedRevision')::bigint; manager_id uuid; wanted integer[];
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
      AND configuration.seasons=wanted AND configuration.exact_periods=periods AND configuration.period_inventory IS NOT DISTINCT FROM inventory AND configuration.cadence_seconds=cadence
      AND configuration.expires_at=expiry AND configuration.paused=paused_value THEN
      RETURN jsonb_build_object('status','replayed','targetId',target.id,'configurationRevision',target.configuration_revision);
    END IF;
    IF target.configuration_revision<>expected THEN RAISE EXCEPTION 'refresh configuration revision changed'; END IF;
    SELECT request.* INTO current_request FROM public.public_data_refresh_cycles cycle
      JOIN public.public_data_intakes request ON request.id=cycle.intake_id
      WHERE cycle.target_id=target.id AND cycle.cycle=target.current_cycle;
    IF FOUND AND NOT current_request.terminal AND (current_request.seasons IS DISTINCT FROM wanted OR current_request.exact_periods IS DISTINCT FROM periods OR current_request.period_inventory IS DISTINCT FROM inventory) THEN
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
  INSERT INTO public.public_data_refresh_configurations(target_id,revision,identity_request_id,seasons,cadence_seconds,expires_at,paused,exact_periods,period_inventory)
    VALUES(target_id,next_revision,identity_id,wanted,cadence,expiry,paused_value,periods,inventory);
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
      PERFORM public.submit_public_data_intake(jsonb_build_object('id',request_id,'username',native,'seasons',configuration.seasons)||CASE WHEN configuration.period_inventory IS NULL THEN jsonb_build_object('exactPeriods',configuration.exact_periods) ELSE jsonb_build_object('periodInventory',configuration.period_inventory) END);
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

-- Compact inventory accounting: every observed candidate has one immutable plan.
-- Capacity candidates retain their 18 requested scopes without creating HTTP work.
CREATE TABLE public.public_data_period_inventory_plans (
  intake_id uuid NOT NULL, season integer NOT NULL CHECK(season=2026), external_league_id text NOT NULL,
  policy text NOT NULL CHECK(policy='sleeper-2026-native-period-inventory-v1'), admitted boolean NOT NULL,
  worker_id text NOT NULL, generation integer NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY(intake_id,season,external_league_id),
  FOREIGN KEY(intake_id,season,external_league_id) REFERENCES public.public_data_league_candidates(intake_id,season,external_league_id),
  FOREIGN KEY(worker_id,generation) REFERENCES public.public_data_dispatches(worker_id,generation)
);
CREATE TABLE public.public_data_period_inventory_sources (
  intake_id uuid NOT NULL, season integer NOT NULL, external_league_id text NOT NULL,
  source_kind text NOT NULL CHECK(source_kind IN ('leagues','bootstrap')),
  source_ordinal integer NOT NULL CHECK(source_ordinal BETWEEN 1 AND 1000),
  CHECK(source_kind<>'bootstrap' OR source_ordinal=1),
  worker_id text NOT NULL, generation integer NOT NULL,
  native_fields jsonb NOT NULL,
  request_started_at timestamptz NOT NULL, request_completed_at timestamptz NOT NULL,
  acquisition jsonb NOT NULL CHECK(jsonb_typeof(acquisition)='object'),
  recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY(intake_id,season,external_league_id,source_kind,source_ordinal),
  FOREIGN KEY(intake_id,season,external_league_id) REFERENCES public.public_data_period_inventory_plans(intake_id,season,external_league_id),
  FOREIGN KEY(worker_id,generation) REFERENCES public.public_data_dispatches(worker_id,generation),
  CHECK(request_started_at<=request_completed_at)
);
CREATE TRIGGER public_period_inventory_plan_immutable BEFORE UPDATE OR DELETE ON public.public_data_period_inventory_plans
  FOR EACH ROW EXECUTE FUNCTION public.prevent_league_administration_history_change();
CREATE TRIGGER public_period_inventory_source_immutable BEFORE UPDATE OR DELETE ON public.public_data_period_inventory_sources
  FOR EACH ROW EXECUTE FUNCTION public.prevent_league_administration_history_change();

-- Raw evidence projection only. The maintained typed settings normalizer owns
-- interpretation; absent/null/invalid parent settings and own-key absence survive.
CREATE FUNCTION public.public_data_inventory_native_fields(p_payload jsonb) RETURNS jsonb
LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE fields jsonb;
BEGIN
  IF NOT(p_payload ? 'settings') THEN RETURN jsonb_build_object('settingsPresent',false); END IF;
  fields:=p_payload->'settings';
  IF jsonb_typeof(fields)='object' THEN
    SELECT COALESCE(jsonb_object_agg(key,value),'{}'::jsonb) INTO fields FROM jsonb_each(fields)
      WHERE key IN ('leg','last_scored_leg','start_week','playoff_week_start');
  END IF;
  RETURN jsonb_build_object('settingsPresent',true,'settings',fields);
END; $$;

CREATE FUNCTION public.validate_public_data_inventory_plan() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE dispatch public.public_data_dispatches%ROWTYPE; candidate public.public_data_league_candidates%ROWTYPE;
BEGIN
  SELECT * INTO STRICT dispatch FROM public.public_data_dispatches WHERE worker_id=NEW.worker_id AND generation=NEW.generation;
  SELECT * INTO STRICT candidate FROM public.public_data_league_candidates WHERE intake_id=NEW.intake_id
    AND season=NEW.season AND external_league_id=NEW.external_league_id;
  IF NEW.policy IS DISTINCT FROM (SELECT period_inventory FROM public.public_data_intakes WHERE id=NEW.intake_id)
    OR dispatch.intake_id<>NEW.intake_id OR dispatch.resource<>'leagues'
    OR dispatch.work->>'season' IS DISTINCT FROM NEW.season::text
    OR NOT EXISTS(SELECT 1 FROM public.public_data_dispatch_outcomes WHERE worker_id=NEW.worker_id AND generation=NEW.generation
      AND outcome='checkpoint-committed' AND jsonb_typeof(capture_acquisition)='object')
    OR NEW.admitted IS DISTINCT FROM EXISTS(SELECT 1 FROM public.public_data_exact_period_tasks WHERE intake_id=NEW.intake_id
      AND season=NEW.season AND external_league_id=NEW.external_league_id)
    OR (NOT NEW.admitted AND candidate.stage<>'capacity') THEN
    RAISE EXCEPTION 'invalid public period inventory plan lineage'; END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER public_period_inventory_plan_lineage BEFORE INSERT ON public.public_data_period_inventory_plans
  FOR EACH ROW EXECUTE FUNCTION public.validate_public_data_inventory_plan();

CREATE FUNCTION public.validate_public_data_inventory_source() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE dispatch public.public_data_dispatches%ROWTYPE; raw jsonb; started timestamptz; completed timestamptz;
BEGIN
  SELECT * INTO STRICT dispatch FROM public.public_data_dispatches WHERE worker_id=NEW.worker_id AND generation=NEW.generation;
  IF dispatch.intake_id<>NEW.intake_id OR dispatch.resource<>NEW.source_kind
    OR dispatch.work->>'season' IS DISTINCT FROM NEW.season::text
    OR NEW.acquisition IS DISTINCT FROM (SELECT capture_acquisition FROM public.public_data_dispatch_outcomes
      WHERE worker_id=NEW.worker_id AND generation=NEW.generation AND outcome='checkpoint-committed') THEN
    RAISE EXCEPTION 'invalid public period inventory source dispatch'; END IF;
  IF NEW.source_kind='leagues' THEN
    SELECT list.payload->(NEW.source_ordinal-1),list.request_started_at,list.request_completed_at INTO STRICT raw,started,completed
      FROM public.public_data_league_lists list WHERE list.intake_id=NEW.intake_id AND list.season=NEW.season;
    IF raw->>'league_id' IS DISTINCT FROM NEW.external_league_id THEN RAISE EXCEPTION 'inventory raw source ordinal mismatch'; END IF;
    IF NOT EXISTS(SELECT 1 FROM public.public_data_period_inventory_plans WHERE intake_id=NEW.intake_id AND season=NEW.season
      AND external_league_id=NEW.external_league_id AND worker_id=NEW.worker_id AND generation=NEW.generation) THEN
      RAISE EXCEPTION 'inventory source differs from discovery plan'; END IF;
  ELSE
    IF dispatch.work->>'externalLeagueId' IS DISTINCT FROM NEW.external_league_id
      OR NOT EXISTS(SELECT 1 FROM public.public_data_period_inventory_plans WHERE intake_id=NEW.intake_id AND season=NEW.season
        AND external_league_id=NEW.external_league_id AND admitted) THEN RAISE EXCEPTION 'inventory bootstrap candidate mismatch'; END IF;
    SELECT bootstrap_payload,bootstrap_started_at,bootstrap_completed_at INTO STRICT raw,started,completed
      FROM public.public_data_league_candidates WHERE intake_id=NEW.intake_id AND season=NEW.season AND external_league_id=NEW.external_league_id;
  END IF;
  IF raw IS NULL OR NEW.native_fields IS DISTINCT FROM public.public_data_inventory_native_fields(raw)
    OR NEW.request_started_at IS DISTINCT FROM started OR NEW.request_completed_at IS DISTINCT FROM completed THEN
    RAISE EXCEPTION 'public period inventory native evidence mismatch'; END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER public_period_inventory_source_lineage BEFORE INSERT ON public.public_data_period_inventory_sources
  FOR EACH ROW EXECUTE FUNCTION public.validate_public_data_inventory_source();

CREATE FUNCTION public.preserve_public_data_inventory_bootstrap() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
  IF OLD.bootstrap_payload IS NOT NULL AND EXISTS(SELECT 1 FROM public.public_data_intakes WHERE id=OLD.intake_id AND period_inventory IS NOT NULL)
    AND (NEW.bootstrap_payload IS DISTINCT FROM OLD.bootstrap_payload OR NEW.bootstrap_started_at IS DISTINCT FROM OLD.bootstrap_started_at
      OR NEW.bootstrap_completed_at IS DISTINCT FROM OLD.bootstrap_completed_at) THEN RAISE EXCEPTION 'public inventory bootstrap evidence is immutable'; END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER public_period_inventory_bootstrap_immutable BEFORE UPDATE ON public.public_data_league_candidates
  FOR EACH ROW EXECUTE FUNCTION public.preserve_public_data_inventory_bootstrap();

-- Compare the complete key set, not just counts. Deferred evaluation permits the
-- unchanged R039 checkpoint to insert tasks before its wrapper records plans.
CREATE FUNCTION public.validate_public_data_inventory_population() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE request_id uuid:=NEW.intake_id; candidates integer; admitted integer;
BEGIN
  IF NOT EXISTS(SELECT 1 FROM public.public_data_intakes WHERE id=request_id AND period_inventory IS NOT NULL) THEN RETURN NULL; END IF;
  SELECT count(*) INTO candidates FROM public.public_data_league_candidates WHERE intake_id=request_id;
  SELECT count(*) INTO admitted FROM public.public_data_period_inventory_plans WHERE intake_id=request_id AND public_data_period_inventory_plans.admitted;
  IF candidates>1000 OR admitted>20
    OR candidates<>(SELECT count(*) FROM public.public_data_period_inventory_plans WHERE intake_id=request_id)
    OR EXISTS(SELECT 1 FROM public.public_data_league_candidates candidate WHERE candidate.intake_id=request_id AND NOT EXISTS(
      SELECT 1 FROM public.public_data_period_inventory_plans plan WHERE plan.intake_id=candidate.intake_id AND plan.season=candidate.season AND plan.external_league_id=candidate.external_league_id))
    OR EXISTS(SELECT 1 FROM public.public_data_period_inventory_plans plan WHERE plan.intake_id=request_id AND NOT EXISTS(
      SELECT 1 FROM public.public_data_period_inventory_sources source WHERE source.intake_id=plan.intake_id AND source.season=plan.season
        AND source.external_league_id=plan.external_league_id AND source.source_kind='leagues'))
    OR EXISTS(SELECT 1 FROM public.public_data_league_candidates candidate WHERE candidate.intake_id=request_id AND candidate.bootstrap_payload IS NOT NULL AND NOT EXISTS(
      SELECT 1 FROM public.public_data_period_inventory_sources source WHERE source.intake_id=candidate.intake_id AND source.season=candidate.season
        AND source.external_league_id=candidate.external_league_id AND source.source_kind='bootstrap')) THEN
    RAISE EXCEPTION 'public period inventory population incomplete'; END IF;
  IF EXISTS(
    WITH expected AS (SELECT plan.season,plan.external_league_id,week AS native_week,
      ((dense_rank() OVER(ORDER BY plan.season,plan.external_league_id)-1)*18+week)::integer AS ordinal
      FROM public.public_data_period_inventory_plans plan CROSS JOIN generate_series(1,18) week
      WHERE plan.intake_id=request_id AND plan.admitted), actual AS (
      SELECT season,external_league_id,native_week,ordinal FROM public.public_data_exact_period_tasks WHERE intake_id=request_id)
    SELECT 1 FROM ((SELECT * FROM expected EXCEPT SELECT * FROM actual) UNION ALL (SELECT * FROM actual EXCEPT SELECT * FROM expected)) difference
  ) THEN RAISE EXCEPTION 'public period inventory task scope incomplete'; END IF;
  IF EXISTS(
    WITH expected AS (SELECT list.season,entry->>'league_id' AS external_league_id,source_ordinal::integer
      FROM public.public_data_league_lists list CROSS JOIN LATERAL jsonb_array_elements(list.payload) WITH ORDINALITY AS native(entry,source_ordinal)
      WHERE list.intake_id=request_id), actual AS (
      SELECT season,external_league_id,source_ordinal FROM public.public_data_period_inventory_sources WHERE intake_id=request_id AND source_kind='leagues')
    SELECT 1 FROM ((SELECT * FROM expected EXCEPT SELECT * FROM actual) UNION ALL (SELECT * FROM actual EXCEPT SELECT * FROM expected)) difference
  ) THEN RAISE EXCEPTION 'public period inventory source population incomplete'; END IF;
  RETURN NULL;
END; $$;
CREATE CONSTRAINT TRIGGER public_period_inventory_list_population AFTER INSERT ON public.public_data_league_lists
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.validate_public_data_inventory_population();
-- One full validation per sealed list; running it per 1,000 plan/source rows
-- would multiply bounded intake work. Immutable keys and histories prevent later
-- population deletion; bootstrap updates separately require their source witness.
CREATE CONSTRAINT TRIGGER public_period_inventory_bootstrap_population AFTER INSERT OR UPDATE ON public.public_data_league_candidates
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW WHEN (NEW.bootstrap_payload IS NOT NULL)
  EXECUTE FUNCTION public.validate_public_data_inventory_population();

-- Keep the effective R039 owner and all installed witness/receipt validation.
-- Renaming retains the old OID and ACL, so revoke that private predecessor explicitly.
ALTER FUNCTION public.checkpoint_public_data_intake(jsonb,jsonb,jsonb) RENAME TO checkpoint_public_data_intake_v43;
REVOKE ALL ON FUNCTION public.checkpoint_public_data_intake_v43(jsonb,jsonb,jsonb) FROM PUBLIC;
CREATE FUNCTION public.checkpoint_public_data_intake(p_work jsonb,p_capture jsonb,p_fence jsonb) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE request_id uuid:=(p_work->>'requestId')::uuid; candidate_row public.public_data_league_candidates%ROWTYPE;
  mode_value text; acquisition jsonb;
BEGIN
  PERFORM public.checkpoint_public_data_intake_v43(p_work,p_capture,p_fence);
  SELECT period_inventory INTO STRICT mode_value FROM public.public_data_intakes WHERE id=request_id;
  IF mode_value IS NULL THEN RETURN; END IF;
  IF p_work->>'kind' IN ('leagues','bootstrap') AND p_capture->'failed' IS DISTINCT FROM 'true'::jsonb
    AND p_capture->>'diagnostic' IS DISTINCT FROM 'invalid-source' THEN
    SELECT capture_acquisition INTO STRICT acquisition FROM public.public_data_dispatch_outcomes
      WHERE worker_id=p_fence->>'workerId' AND generation=(p_fence->>'generation')::integer AND outcome='checkpoint-committed';
    IF jsonb_typeof(acquisition) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'inventory requires witnessed source capture'; END IF;
    IF p_work->>'kind'='leagues' THEN
      INSERT INTO public.public_data_period_inventory_plans(intake_id,season,external_league_id,policy,admitted,worker_id,generation)
        SELECT candidate.intake_id,candidate.season,candidate.external_league_id,mode_value,candidate.stage<>'capacity',
          p_fence->>'workerId',(p_fence->>'generation')::integer FROM public.public_data_league_candidates candidate
          WHERE candidate.intake_id=request_id AND candidate.season=(p_work->>'season')::integer ORDER BY candidate.season,candidate.external_league_id;
      INSERT INTO public.public_data_period_inventory_sources(intake_id,season,external_league_id,source_kind,source_ordinal,worker_id,generation,
        native_fields,request_started_at,request_completed_at,acquisition)
        SELECT request_id,(p_work->>'season')::integer,entry->>'league_id','leagues',source_ordinal::integer,p_fence->>'workerId',(p_fence->>'generation')::integer,
          public.public_data_inventory_native_fields(entry),list.request_started_at,list.request_completed_at,acquisition
          FROM public.public_data_league_lists list CROSS JOIN LATERAL jsonb_array_elements(list.payload) WITH ORDINALITY AS native(entry,source_ordinal)
          WHERE list.intake_id=request_id AND list.season=(p_work->>'season')::integer;
    ELSE
      SELECT * INTO STRICT candidate_row FROM public.public_data_league_candidates WHERE intake_id=request_id
        AND season=(p_work->>'season')::integer AND external_league_id=p_work->>'externalLeagueId';
      INSERT INTO public.public_data_period_inventory_sources(intake_id,season,external_league_id,source_kind,source_ordinal,worker_id,generation,
        native_fields,request_started_at,request_completed_at,acquisition)
        VALUES(candidate_row.intake_id,candidate_row.season,candidate_row.external_league_id,'bootstrap',1,p_fence->>'workerId',(p_fence->>'generation')::integer,
          public.public_data_inventory_native_fields(candidate_row.bootstrap_payload),candidate_row.bootstrap_started_at,candidate_row.bootstrap_completed_at,acquisition);
    END IF;
  END IF;
  -- Flush the new deferred validation before the final deadline/ownership check.
  -- No new write or deferred inventory event follows this fence.
  SET CONSTRAINTS public_period_inventory_list_population,public_period_inventory_bootstrap_population IMMEDIATE;
  SET CONSTRAINTS public_period_inventory_list_population,public_period_inventory_bootstrap_population DEFERRED;
  PERFORM public.assert_public_data_owner(request_id,p_fence);
END; $$;
REVOKE ALL ON FUNCTION public.checkpoint_public_data_intake(jsonb,jsonb,jsonb) FROM PUBLIC;
REVOKE ALL ON public.public_data_period_inventory_plans,public.public_data_period_inventory_sources FROM PUBLIC;
REVOKE ALL ON FUNCTION public.public_data_inventory_periods(),public.canonical_public_data_period_scope(jsonb,integer[],text),
  public.bind_public_data_inventory_task(),public.public_data_inventory_native_fields(jsonb),public.validate_public_data_inventory_plan(),
  public.validate_public_data_inventory_source(),public.preserve_public_data_inventory_bootstrap(),public.validate_public_data_inventory_population() FROM PUBLIC;
DO $$ BEGIN
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='league_one_runtime') THEN
    REVOKE ALL ON public.public_data_period_inventory_plans,public.public_data_period_inventory_sources FROM league_one_runtime;
    GRANT SELECT ON public.public_data_period_inventory_plans,public.public_data_period_inventory_sources TO league_one_runtime;
    REVOKE ALL ON FUNCTION public.checkpoint_public_data_intake_v43(jsonb,jsonb,jsonb),
      public.public_data_inventory_periods(),public.canonical_public_data_period_scope(jsonb,integer[],text),
      public.bind_public_data_inventory_task(),public.public_data_inventory_native_fields(jsonb),public.validate_public_data_inventory_plan(),
      public.validate_public_data_inventory_source(),public.preserve_public_data_inventory_bootstrap(),public.validate_public_data_inventory_population() FROM league_one_runtime;
    GRANT EXECUTE ON FUNCTION public.checkpoint_public_data_intake(jsonb,jsonb,jsonb) TO league_one_runtime;
  END IF;
END; $$;
