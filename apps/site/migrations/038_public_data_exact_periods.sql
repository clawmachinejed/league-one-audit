-- R038: explicit native matchup periods through the existing bounded DATA intake.
-- Source only. No scheduler, provider feed, projection activation or SQL qualification.
-- Empty scope preserves old requests/configurations; no old request gains work.
CREATE FUNCTION public.canonical_public_data_exact_periods(p_value jsonb,p_seasons integer[])
RETURNS jsonb LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE item jsonb; season_value integer; week_value integer; seen integer[]:='{}'; result jsonb;
BEGIN
  IF p_seasons IS NULL OR array_position(p_seasons,NULL) IS NOT NULL
    OR jsonb_typeof(p_value) IS DISTINCT FROM 'array' OR jsonb_array_length(p_value)>3 THEN
    RAISE EXCEPTION 'invalid explicit public period scope'; END IF;
  FOR item IN SELECT value FROM jsonb_array_elements(p_value) LOOP
    IF jsonb_typeof(item) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'invalid explicit public period'; END IF;
    IF (SELECT count(*) FROM jsonb_object_keys(item))<>2 OR NOT(item ?& ARRAY['season','nativeWeek'])
      OR jsonb_typeof(item->'season') IS DISTINCT FROM 'number' OR jsonb_typeof(item->'nativeWeek') IS DISTINCT FROM 'number'
      OR item->>'season' !~ '^[1-9][0-9]{3}$' OR item->>'nativeWeek' !~ '^[1-9][0-9]?$' THEN
      RAISE EXCEPTION 'invalid explicit public period'; END IF;
    season_value:=(item->>'season')::integer; week_value:=(item->>'nativeWeek')::integer;
    IF season_value NOT BETWEEN 1920 AND 2200 OR week_value NOT BETWEEN 1 AND 18
      OR NOT(season_value=ANY(p_seasons)) OR season_value=ANY(seen) THEN
      RAISE EXCEPTION 'explicit period must select one week per declared season'; END IF;
    seen:=array_append(seen,season_value);
  END LOOP;
  SELECT COALESCE(jsonb_agg(value ORDER BY (value->>'season')::integer),'[]'::jsonb) INTO result FROM jsonb_array_elements(p_value);
  RETURN result;
END; $$;
REVOKE ALL ON FUNCTION public.canonical_public_data_exact_periods(jsonb,integer[]) FROM PUBLIC;
ALTER TABLE public.public_data_intakes ADD COLUMN exact_periods jsonb NOT NULL DEFAULT '[]'
  CHECK(exact_periods=public.canonical_public_data_exact_periods(exact_periods,seasons));
ALTER TABLE public.public_data_refresh_configurations ADD COLUMN exact_periods jsonb NOT NULL DEFAULT '[]'
  CHECK(exact_periods=public.canonical_public_data_exact_periods(exact_periods,seasons));
CREATE TRIGGER public_intake_period_scope_immutable BEFORE UPDATE ON public.public_data_intakes
  FOR EACH ROW EXECUTE FUNCTION public.prevent_projection_stable_field_change('exact_periods');

CREATE TABLE public.public_data_exact_period_tasks (
  intake_id uuid NOT NULL, ordinal integer NOT NULL CHECK(ordinal BETWEEN 1 AND 20),
  season integer NOT NULL, external_league_id text NOT NULL, native_week integer NOT NULL CHECK(native_week BETWEEN 1 AND 18),
  status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','complete','unavailable')),
  failure_count integer NOT NULL DEFAULT 0 CHECK(failure_count BETWEEN 0 AND 5), reason text,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY(intake_id,ordinal), UNIQUE(intake_id,season,external_league_id),
  FOREIGN KEY(intake_id,season,external_league_id) REFERENCES public.public_data_league_candidates(intake_id,season,external_league_id),
  CHECK((status='unavailable')=(reason IS NOT NULL)), CHECK(reason IS NULL OR btrim(reason)<>''),
  CHECK(status<>'pending' OR failure_count<5)
);
CREATE TABLE public.public_data_exact_period_checkpoints (
  intake_id uuid NOT NULL, task_ordinal integer NOT NULL,
  worker_id text NOT NULL, generation integer NOT NULL,
  league_season_id uuid NOT NULL REFERENCES public.league_seasons(id), source_mapping jsonb NOT NULL,
  settings_receipt_id uuid NOT NULL REFERENCES public.league_roster_capture_receipts(id),
  matchups_receipt_id uuid NOT NULL REFERENCES public.league_roster_capture_receipts(id),
  recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY(intake_id,task_ordinal), UNIQUE(worker_id,generation),
  FOREIGN KEY(intake_id,task_ordinal) REFERENCES public.public_data_exact_period_tasks(intake_id,ordinal),
  FOREIGN KEY(worker_id,generation) REFERENCES public.public_data_dispatches(worker_id,generation)
);
CREATE FUNCTION public.validate_public_data_exact_period_task() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
  IF TG_OP='UPDATE' AND ((to_jsonb(NEW)-ARRAY['status','failure_count','reason']) IS DISTINCT FROM
      (to_jsonb(OLD)-ARRAY['status','failure_count','reason']) OR NEW.failure_count<OLD.failure_count
      OR (OLD.status<>'pending' AND NEW IS DISTINCT FROM OLD)) THEN
    RAISE EXCEPTION 'public period task identity or terminal state is immutable'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.public_data_intakes request
    WHERE request.id=NEW.intake_id AND request.exact_periods @> jsonb_build_array(jsonb_build_object('season',NEW.season,'nativeWeek',NEW.native_week))) THEN
    RAISE EXCEPTION 'public period task is outside immutable selection'; END IF;
  IF NEW.status='complete' AND NOT EXISTS(SELECT 1 FROM public.public_data_exact_period_checkpoints checkpoint
    WHERE checkpoint.intake_id=NEW.intake_id AND checkpoint.task_ordinal=NEW.ordinal) THEN
    RAISE EXCEPTION 'public period completion requires immutable checkpoint'; END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER public_period_task_lineage BEFORE INSERT OR UPDATE ON public.public_data_exact_period_tasks
  FOR EACH ROW EXECUTE FUNCTION public.validate_public_data_exact_period_task();
CREATE TRIGGER public_period_task_no_delete BEFORE DELETE ON public.public_data_exact_period_tasks
  FOR EACH ROW EXECUTE FUNCTION public.prevent_league_administration_history_change();
CREATE TRIGGER public_period_checkpoint_immutable BEFORE UPDATE OR DELETE ON public.public_data_exact_period_checkpoints
  FOR EACH ROW EXECUTE FUNCTION public.prevent_league_administration_history_change();

-- Live checkpoint validation is installed as a trigger too: owner fixture inserts
-- cannot forge accepted lineage. Historical reads need no currently selected settings head.
CREATE FUNCTION public.validate_public_data_exact_period_checkpoint() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE task public.public_data_exact_period_tasks%ROWTYPE; dispatch public.public_data_dispatches%ROWTYPE;
  settings public.league_roster_capture_receipts%ROWTYPE; matchups public.league_roster_capture_receipts%ROWTYPE;
  settings_attempt public.league_roster_resource_attempts%ROWTYPE; matchup_attempt public.league_roster_resource_attempts%ROWTYPE;
  wanted uuid; is_settings boolean; identity_value jsonb; reserved timestamptz;
BEGIN
  SELECT * INTO STRICT task FROM public.public_data_exact_period_tasks WHERE intake_id=NEW.intake_id AND ordinal=NEW.task_ordinal;
  SELECT * INTO STRICT dispatch FROM public.public_data_dispatches WHERE worker_id=NEW.worker_id AND generation=NEW.generation;
  SELECT * INTO STRICT settings FROM public.league_roster_capture_receipts WHERE id=NEW.settings_receipt_id;
  SELECT * INTO STRICT matchups FROM public.league_roster_capture_receipts WHERE id=NEW.matchups_receipt_id;
  SELECT * INTO STRICT settings_attempt FROM public.league_roster_resource_attempts WHERE id=settings.attempt_id;
  SELECT * INTO STRICT matchup_attempt FROM public.league_roster_resource_attempts WHERE id=matchups.attempt_id;
  IF task.status<>'pending' OR dispatch.intake_id<>NEW.intake_id OR dispatch.resource<>'exact-matchups' OR dispatch.max_requests<>2
    OR dispatch.work->>'requestId' IS DISTINCT FROM NEW.intake_id::text
    OR dispatch.work->>'season' IS DISTINCT FROM task.season::text
    OR dispatch.work->>'nativeWeek' IS DISTINCT FROM task.native_week::text
    OR dispatch.work->>'externalLeagueId' IS DISTINCT FROM task.external_league_id
    OR settings_attempt.write_fence->>'workerId' IS DISTINCT FROM NEW.worker_id
    OR settings_attempt.write_fence->>'generation' IS DISTINCT FROM NEW.generation::text
    OR matchup_attempt.write_fence IS DISTINCT FROM settings_attempt.write_fence
    OR settings_attempt.source_mapping IS DISTINCT FROM NEW.source_mapping
    OR matchup_attempt.source_mapping IS DISTINCT FROM NEW.source_mapping
    OR NEW.source_mapping->>'leagueSeasonId' IS DISTINCT FROM NEW.league_season_id::text
    OR NOT EXISTS(SELECT 1 FROM public.public_data_league_candidates candidate WHERE candidate.intake_id=task.intake_id
      AND candidate.season=task.season AND candidate.external_league_id=task.external_league_id AND candidate.league_season_id=NEW.league_season_id)
    OR EXISTS(SELECT 1 FROM public.public_data_dispatch_outcomes outcome WHERE outcome.worker_id=NEW.worker_id AND outcome.generation=NEW.generation) THEN
    RAISE EXCEPTION 'public period checkpoint dispatch or task mismatch'; END IF;
  PERFORM public.guard_public_data_intake(dispatch.work,settings_attempt.write_fence);
  PERFORM public.validate_current_roster_mapping(NEW.source_mapping);
  PERFORM public.assert_public_data_owner(NEW.intake_id,settings_attempt.write_fence);
  reserved:=GREATEST(settings_attempt.reserved_at,matchup_attempt.reserved_at);
  FOREACH is_settings IN ARRAY ARRAY[true,false] LOOP
    wanted:=CASE WHEN is_settings THEN settings.id ELSE matchups.id END;
    identity_value:=jsonb_build_object('scope',jsonb_build_object('kind','enrolled-resource',
      'connectionId',NEW.source_mapping->>'connectionId','leagueSeasonId',NEW.league_season_id::text,
      'family',CASE WHEN is_settings THEN 'league-season' ELSE 'matchups' END,'entityId',NULL,
      'scoringPeriodId',CASE WHEN is_settings THEN NULL ELSE 'sleeper:matchup-week:'||task.native_week END,'audienceId','public',
      'coverageSpecId',CASE WHEN is_settings THEN 'sleeper-league-identity-settings-v1' ELSE 'sleeper-exact-period-all-teams-matchups-v1' END),
      'policy',jsonb_build_object('audienceId','public','coverageSpecId',CASE WHEN is_settings THEN 'sleeper-league-identity-settings-v1' ELSE 'sleeper-exact-period-all-teams-matchups-v1' END,
      'canonicalNormalizerVersion',CASE WHEN is_settings THEN 'sleeper-league-settings-v1' ELSE 'sleeper-exact-matchups-v1' END,
      'validationVersion','latest-network-attempt-v1'));
    IF NOT EXISTS(SELECT 1 FROM public.league_roster_resource_acceptances accepted
      JOIN public.league_roster_capture_receipts receipt ON receipt.id=accepted.receipt_id
      JOIN public.league_roster_resource_attempts attempt ON attempt.id=receipt.attempt_id
      JOIN public.league_roster_resource_scopes scope ON scope.id=attempt.scope_id AND scope.identity=identity_value
      JOIN public.league_roster_resource_heads head ON head.scope_id=scope.id AND head.accepted_id=accepted.id AND head.generation=accepted.generation
      JOIN public.league_administration_contents content ON content.id=receipt.content_id
      JOIN public.league_administration_observations observed ON observed.id=receipt.legacy_observation_id AND observed.content_id=content.id
      WHERE receipt.id=wanted AND accepted.scope_id=scope.id AND accepted.source_mapping_revision_id=(NEW.source_mapping->>'revisionId')::uuid
        AND attempt.source_mapping=NEW.source_mapping AND attempt.write_fence=settings_attempt.write_fence
        AND attempt.ordinal=head.latest_ordinal AND attempt.reserved_at>=dispatch.admitted_at
        AND content.league_season_id=NEW.league_season_id AND content.provider='sleeper' AND content.external_league_id=task.external_league_id
        AND content.family=CASE WHEN is_settings THEN 'league' ELSE 'matchups' END
        AND content.week=CASE WHEN is_settings THEN 0 ELSE task.native_week END AND content.accepted AND content.completeness='complete'
        AND receipt.coverage->>'completeness'='complete' AND receipt.provenance->>'origin'='network'
        AND receipt.coverage->'periodIds'=CASE WHEN is_settings THEN '[]'::jsonb ELSE jsonb_build_array('sleeper:matchup-week:'||task.native_week) END
        AND (receipt.provenance->>'requestStartedAt')::timestamptz>=reserved
        AND (receipt.provenance->>'requestStartedAt')::timestamptz>=clock_timestamp()-interval '30 seconds'
        AND (receipt.provenance->>'requestCompletedAt')::timestamptz BETWEEN (receipt.provenance->>'requestStartedAt')::timestamptz AND clock_timestamp()
        AND (receipt.provenance->>'sourceObservedAt')::timestamptz=(receipt.provenance->>'requestCompletedAt')::timestamptz) THEN
      RAISE EXCEPTION 'current dispatch-bound exact period receipt required'; END IF;
  END LOOP;
  IF settings.configuration_content_id IS DISTINCT FROM settings.content_id
    OR matchups.configuration_content_id IS DISTINCT FROM settings.content_id
    OR matchups.population_evidence->>'observationId' IS DISTINCT FROM settings.legacy_observation_id::text
    OR matchups.population_evidence->'provenance' IS DISTINCT FROM settings.provenance
    OR matchups.population_evidence->>'contentHash' IS DISTINCT FROM (SELECT content_hash FROM public.league_administration_contents WHERE id=settings.content_id) THEN
    RAISE EXCEPTION 'exact period population does not bind its settings receipt'; END IF;
  PERFORM public.assert_public_data_owner(NEW.intake_id,settings_attempt.write_fence);
  RETURN NEW;
END; $$;
CREATE TRIGGER public_period_checkpoint_lineage BEFORE INSERT ON public.public_data_exact_period_checkpoints
  FOR EACH ROW EXECUTE FUNCTION public.validate_public_data_exact_period_checkpoint();


CREATE OR REPLACE FUNCTION public.submit_public_data_intake(p_input jsonb) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE wanted integer[]; periods jsonb; retained public.public_data_intakes%ROWTYPE;
BEGIN
  IF jsonb_typeof(p_input->'seasons') IS DISTINCT FROM 'array'
    OR jsonb_array_length(p_input->'seasons') NOT BETWEEN 1 AND 3
    OR (p_input->>'username') !~ '^[a-zA-Z0-9_]{1,100}$' THEN RAISE EXCEPTION 'invalid public intake'; END IF;
  SELECT array_agg(value::integer ORDER BY value::integer) INTO wanted FROM jsonb_array_elements_text(p_input->'seasons');
  IF EXISTS(SELECT 1 FROM unnest(wanted) value WHERE value NOT BETWEEN 1920 AND 2200)
    OR cardinality(wanted)<>(SELECT count(DISTINCT value) FROM unnest(wanted) value) THEN
    RAISE EXCEPTION 'invalid public season scope';
  END IF;
  periods:=public.canonical_public_data_exact_periods(CASE WHEN p_input ? 'exactPeriods' THEN p_input->'exactPeriods' ELSE '[]'::jsonb END,wanted);
  PERFORM pg_advisory_xact_lock(hashtextextended('public-data-intake-admission',0));
  SELECT * INTO retained FROM public.public_data_intakes WHERE id=(p_input->>'id')::uuid;
  IF FOUND THEN
    IF retained.username IS DISTINCT FROM p_input->>'username' OR retained.seasons IS DISTINCT FROM wanted OR retained.exact_periods IS DISTINCT FROM periods THEN
      RAISE EXCEPTION 'public intake replay mismatch';
    END IF;
    RETURN;
  END IF;
  IF (SELECT count(*) FROM public.public_data_intakes WHERE NOT terminal)>=16 THEN
    RAISE EXCEPTION 'public intake capacity reached';
  END IF;
  INSERT INTO public.public_data_intakes(id,username,seasons,exact_periods) VALUES((p_input->>'id')::uuid,p_input->>'username',wanted,periods);
END; $$;

CREATE OR REPLACE FUNCTION public.next_public_data_intake(p_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE request public.public_data_intakes%ROWTYPE; manager text; missing_season integer;
  candidate public.public_data_league_candidates%ROWTYPE; task public.public_data_exact_period_tasks%ROWTYPE; base jsonb;
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
    RETURN '"complete"'::jsonb;
  END IF;
  RETURN base||jsonb_build_object('kind',candidate.stage,'externalLeagueId',candidate.external_league_id,'season',candidate.season);
END; $$;

CREATE OR REPLACE FUNCTION public.fail_public_data_work(p_work jsonb) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE request_id uuid:=(p_work->>'requestId')::uuid; failures integer; periods_selected boolean;
BEGIN
  UPDATE public.public_data_intakes SET failure_count=failure_count+1,revision=revision+1,
    next_attempt_at=clock_timestamp()+make_interval(secs=>least(3600,60*(2^least(failure_count,5))::integer))
    WHERE id=request_id AND revision=(p_work->>'revision')::integer
    RETURNING failure_count,exact_periods<>'[]'::jsonb INTO failures,periods_selected;
  IF NOT FOUND THEN RAISE EXCEPTION 'public intake checkpoint changed'; END IF;
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
      p_work->>'kind',p_work,CASE WHEN p_work->>'kind' IN ('core','exact-matchups') THEN 2 ELSE 1 END);
  RETURN true;
END; $$;

CREATE OR REPLACE FUNCTION public.checkpoint_public_data_intake(p_work jsonb,p_capture jsonb,p_fence jsonb) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE request_id uuid:=(p_work->>'requestId')::uuid; kind text:=p_work->>'kind';
  value jsonb:=p_capture->'value'; native text; manager_id uuid; started timestamptz; completed timestamptz;
  v_league_id uuid; season_id uuid; connection_id uuid; item jsonb; count_selected integer;
  observation uuid; v_family text; mapping jsonb; receipt_key text; wanted_receipt_id uuid;
  dispatch_row public.public_data_dispatches%ROWTYPE; directory jsonb; directory_content uuid; directory_capture_id uuid; task public.public_data_exact_period_tasks%ROWTYPE; period_scope jsonb;
BEGIN
  PERFORM public.guard_public_data_intake(p_work,p_fence);
  SELECT exact_periods INTO STRICT period_scope FROM public.public_data_intakes WHERE id=request_id;
  IF NOT EXISTS(SELECT 1 FROM public.public_data_dispatches dispatch WHERE dispatch.worker_id=p_fence->>'workerId'
    AND dispatch.generation=(p_fence->>'generation')::integer AND dispatch.work=p_work AND NOT EXISTS(
      SELECT 1 FROM public.public_data_dispatch_outcomes outcome WHERE outcome.worker_id=dispatch.worker_id AND outcome.generation=dispatch.generation)) THEN
    RAISE EXCEPTION 'matching admitted public dispatch required';
  END IF;
  SELECT * INTO STRICT dispatch_row FROM public.public_data_dispatches
    WHERE worker_id=p_fence->>'workerId' AND generation=(p_fence->>'generation')::integer;
  IF p_capture->'failed'='true'::jsonb THEN
    PERFORM public.fail_public_data_work(p_work);
    PERFORM public.assert_public_data_owner(request_id,p_fence);
    INSERT INTO public.public_data_dispatch_outcomes(worker_id,generation,outcome)
      VALUES(p_fence->>'workerId',(p_fence->>'generation')::integer,'failed');
    RETURN;
  END IF;
  IF kind IN ('identity','leagues','bootstrap') THEN
    started:=(p_capture->>'requestStartedAt')::timestamptz; completed:=(p_capture->>'requestCompletedAt')::timestamptz;
    IF started IS NULL OR completed IS NULL OR started>completed OR completed>clock_timestamp()
      OR started<clock_timestamp()-interval '30 seconds' THEN RAISE EXCEPTION 'invalid public capture timing'; END IF;
  END IF;
  IF p_capture->>'diagnostic'='invalid-source' THEN
    INSERT INTO public.public_data_rejections(intake_id,revision,resource,source_scope,payload,request_started_at,request_completed_at,reason)
      VALUES(request_id,(p_work->>'revision')::integer,kind,p_work,p_capture->'payload',started,completed,'invalid-source');
    PERFORM public.checkpoint_public_data_intake(p_work,'{"failed":true}'::jsonb,p_fence);
    RETURN;
  END IF;
  IF kind='identity' THEN
    native:=value->>'userId';
    IF native IS NULL OR native !~ '^[1-9][0-9]{0,31}$' OR p_capture->'payload'->>'user_id' IS DISTINCT FROM native
      OR btrim(p_capture->'payload'->>'username') IS DISTINCT FROM value->>'username'
      OR length(value->>'username') NOT BETWEEN 1 AND 100 OR length(value->>'displayName') NOT BETWEEN 1 AND 100
      OR (p_work->>'username' ~ '^[1-9][0-9]{0,31}$' AND native<>p_work->>'username') THEN
      RAISE EXCEPTION 'invalid public identity capture'; END IF;
    INSERT INTO public.league_source_manager_accounts(provider,external_manager_id) VALUES('sleeper',native) ON CONFLICT DO NOTHING;
    SELECT id INTO STRICT manager_id FROM public.league_source_manager_accounts WHERE provider='sleeper' AND external_manager_id=native;
    INSERT INTO public.public_data_identity_observations(intake_id,source_manager_account_id,username,display_name,avatar_url,payload,request_started_at,request_completed_at)
      VALUES(request_id,manager_id,value->>'username',value->>'displayName',value->>'avatarUrl',p_capture->'payload',started,completed);
  ELSIF kind='leagues' THEN
    IF jsonb_typeof(value) IS DISTINCT FROM 'array' OR jsonb_array_length(value)>1000
      OR jsonb_typeof(p_capture->'payload') IS DISTINCT FROM 'array' OR jsonb_array_length(p_capture->'payload')>1000 THEN
      RAISE EXCEPTION 'invalid public list'; END IF;
    INSERT INTO public.public_data_league_lists(intake_id,season,payload,request_started_at,request_completed_at)
      VALUES(request_id,(p_work->>'season')::integer,p_capture->'payload',started,completed);
    SELECT count(*) INTO count_selected FROM public.public_data_league_candidates WHERE intake_id=request_id AND stage<>'capacity';
    FOR item IN SELECT entry FROM jsonb_array_elements(value) entry LOOP
      IF item->>'id' IS NULL OR item->>'id' !~ '^[1-9][0-9]{0,31}$' OR item->>'season' IS DISTINCT FROM p_work->>'season'
        OR length(item->>'name') NOT BETWEEN 1 AND 200 OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(p_capture->'payload') raw
          WHERE raw->>'league_id'=item->>'id' AND raw->>'season'=p_work->>'season' AND raw->>'sport'='nfl'
            AND btrim(raw->>'name')=item->>'name') THEN RAISE EXCEPTION 'invalid public list member'; END IF;
      INSERT INTO public.public_data_league_candidates(intake_id,season,external_league_id,name,stage)
        VALUES(request_id,(p_work->>'season')::integer,item->>'id',item->>'name',CASE WHEN count_selected<20 THEN 'bootstrap' ELSE 'capacity' END);
      count_selected:=count_selected+1;
    END LOOP;
    IF EXISTS(SELECT 1 FROM jsonb_array_elements(p_capture->'payload') raw WHERE NOT EXISTS(
      SELECT 1 FROM public.public_data_league_candidates candidate WHERE candidate.intake_id=request_id
        AND candidate.season=(p_work->>'season')::integer AND candidate.external_league_id=raw->>'league_id')) THEN
      RAISE EXCEPTION 'public list silently omitted a source member'; END IF;
    IF period_scope<>'[]'::jsonb THEN
      INSERT INTO public.public_data_exact_period_tasks(intake_id,ordinal,season,external_league_id,native_week)
      SELECT request_id,(SELECT count(*) FROM public.public_data_exact_period_tasks WHERE intake_id=request_id)
        +row_number() OVER(ORDER BY candidate.season,candidate.external_league_id),candidate.season,candidate.external_league_id,(period->>'nativeWeek')::integer
      FROM public.public_data_league_candidates candidate JOIN public.public_data_intakes request ON request.id=candidate.intake_id
      CROSS JOIN LATERAL jsonb_array_elements(request.exact_periods) period
      WHERE candidate.intake_id=request_id AND candidate.season=(p_work->>'season')::integer AND candidate.stage<>'capacity'
        AND (period->>'season')::integer=candidate.season;
    END IF;
  ELSIF kind='bootstrap' THEN
    IF p_capture->>'capacity'='roster-count-unqualified' THEN
      UPDATE public.public_data_league_candidates SET stage='capacity',bootstrap_payload=p_capture->'payload',
        bootstrap_started_at=started,bootstrap_completed_at=completed WHERE intake_id=request_id
        AND season=(p_work->>'season')::integer AND external_league_id=p_work->>'externalLeagueId';
      IF period_scope<>'[]'::jsonb THEN
        UPDATE public.public_data_exact_period_tasks SET status='unavailable',reason='bootstrap-capacity' WHERE intake_id=request_id
          AND season=(p_work->>'season')::integer AND external_league_id=p_work->>'externalLeagueId' AND status='pending';
      END IF;
      UPDATE public.public_data_intakes SET revision=revision+1,failure_count=0 WHERE id=request_id;
      IF public.next_public_data_intake(request_id) IN ('"complete"'::jsonb,'"partial"'::jsonb) THEN
        UPDATE public.public_data_intakes SET terminal=true WHERE id=request_id;
      END IF;
      PERFORM public.assert_public_data_owner(request_id,p_fence);
      INSERT INTO public.public_data_dispatch_outcomes(worker_id,generation,outcome)
        VALUES(p_fence->>'workerId',(p_fence->>'generation')::integer,'checkpoint-committed');
      RETURN;
    END IF;
    season_id:=(p_capture->>'leagueSeasonId')::uuid; v_league_id:=(p_capture->>'leagueId')::uuid;
    IF NOT EXISTS(SELECT 1 FROM public.league_source_connections connection JOIN public.league_seasons season ON season.id=connection.league_season_id
      WHERE season.id=season_id AND season.league_id=v_league_id AND season.season=(p_work->>'season')::integer
        AND connection.provider='sleeper' AND connection.external_league_id=p_work->>'externalLeagueId')
      OR p_capture->'payload'->>'league_id' IS DISTINCT FROM p_work->>'externalLeagueId'
      OR p_capture->'payload'->>'season' IS DISTINCT FROM p_work->>'season'
      OR p_capture->'payload'->>'sport' IS DISTINCT FROM 'nfl' THEN RAISE EXCEPTION 'public registration mismatch'; END IF;
    PERFORM public.assert_league_collection_capacity(p_work->>'externalLeagueId');
    PERFORM public.assert_public_data_owner(request_id,p_fence);
    INSERT INTO public.league_administration_enrollments(league_id,provider,active,evidence)
      VALUES(v_league_id,'sleeper',false,'public-data-intake-v1') ON CONFLICT DO NOTHING;
    INSERT INTO public.league_administration_enrollment_seasons(league_id,season,provider,evidence)
      VALUES(v_league_id,(p_work->>'season')::integer,'sleeper','public-data-intake-v1') ON CONFLICT DO NOTHING;
    UPDATE public.public_data_league_candidates SET league_season_id=season_id,bootstrap_payload=p_capture->'payload',
      bootstrap_started_at=started,bootstrap_completed_at=completed,stage='core'
      WHERE intake_id=request_id AND season=(p_work->>'season')::integer AND external_league_id=p_work->>'externalLeagueId';
  ELSIF kind='exact-matchups' THEN
    IF period_scope='[]'::jsonb THEN RAISE EXCEPTION 'explicit public period scope required'; END IF;
    IF jsonb_typeof(p_capture->'observations') IS DISTINCT FROM 'object' OR jsonb_typeof(p_capture->'receipts') IS DISTINCT FROM 'object' THEN
      RAISE EXCEPTION 'exact period checkpoint incomplete'; END IF;
    IF (SELECT count(*) FROM jsonb_object_keys(p_capture->'observations'))<>2
      OR NOT(p_capture->'observations' ?& ARRAY['league','matchups'])
      OR (SELECT count(*) FROM jsonb_object_keys(p_capture->'receipts'))<>2
      OR NOT(p_capture->'receipts' ?& ARRAY['settings','matchups']) THEN RAISE EXCEPTION 'exact period checkpoint incomplete'; END IF;
    SELECT * INTO STRICT task FROM public.public_data_exact_period_tasks WHERE intake_id=request_id
      AND season=(p_work->>'season')::integer AND external_league_id=p_work->>'externalLeagueId'
      AND native_week=(p_work->>'nativeWeek')::integer AND status='pending';
    IF NOT EXISTS(SELECT 1 FROM public.league_roster_capture_receipts receipt
      JOIN public.league_roster_resource_attempts attempt ON attempt.id=receipt.attempt_id
      WHERE receipt.id=(p_capture->'receipts'->>'settings')::uuid AND attempt.write_fence=p_fence
        AND receipt.legacy_observation_id=(p_capture->'observations'->>'league')::uuid)
      OR NOT EXISTS(SELECT 1 FROM public.league_roster_capture_receipts receipt
      JOIN public.league_roster_resource_attempts attempt ON attempt.id=receipt.attempt_id
      WHERE receipt.id=(p_capture->'receipts'->>'matchups')::uuid AND attempt.write_fence=p_fence
        AND receipt.legacy_observation_id=(p_capture->'observations'->>'matchups')::uuid) THEN RAISE EXCEPTION 'exact period observation mismatch'; END IF;
    INSERT INTO public.public_data_exact_period_checkpoints(intake_id,task_ordinal,worker_id,generation,league_season_id,
      source_mapping,settings_receipt_id,matchups_receipt_id)
      VALUES(request_id,task.ordinal,p_fence->>'workerId',(p_fence->>'generation')::integer,(p_capture->'mapping'->>'leagueSeasonId')::uuid,
        p_capture->'mapping',(p_capture->'receipts'->>'settings')::uuid,(p_capture->'receipts'->>'matchups')::uuid);
    PERFORM public.assert_public_data_owner(request_id,p_fence);
    UPDATE public.public_data_exact_period_tasks SET status='complete' WHERE intake_id=request_id AND ordinal=task.ordinal;
  ELSIF kind IN ('core','users') THEN
    mapping:=p_capture->'mapping'; season_id:=(mapping->>'leagueSeasonId')::uuid; connection_id:=(mapping->>'connectionId')::uuid;
    PERFORM public.validate_current_roster_mapping(mapping);
    IF NOT EXISTS(SELECT 1 FROM public.league_source_connections connection
      JOIN public.public_data_league_candidates candidate ON candidate.league_season_id=connection.league_season_id
      WHERE candidate.intake_id=request_id AND candidate.season=(p_work->>'season')::integer
        AND candidate.external_league_id=p_work->>'externalLeagueId' AND connection.id=connection_id
        AND connection.league_season_id=season_id AND connection.provider='sleeper'
        AND connection.external_league_id=candidate.external_league_id
        AND connection.current_mapping_revision_id=(mapping->>'revisionId')::uuid
        AND connection.mapping_generation=(mapping->>'generation')::integer) THEN RAISE EXCEPTION 'public source mapping changed'; END IF;
    IF jsonb_typeof(p_capture->'observations') IS DISTINCT FROM 'object'
      OR (kind='core' AND (p_capture->'observations'->>'league' IS NULL OR p_capture->'observations'->>'rosters' IS NULL
        OR (SELECT count(*) FROM jsonb_object_keys(p_capture->'observations'))<>2))
      OR (kind='users' AND (p_capture->'observations'->>'users' IS NULL
        OR (SELECT count(*) FROM jsonb_object_keys(p_capture->'observations'))<>1 OR p_capture ? 'receipts')) THEN
      RAISE EXCEPTION 'public resource checkpoint incomplete'; END IF;
    FOR v_family,observation IN SELECT entries.key,entries.value::uuid FROM jsonb_each_text(p_capture->'observations') entries LOOP
      IF v_family NOT IN ('league','rosters','users') OR NOT EXISTS(SELECT 1 FROM public.league_administration_observations observed
        JOIN public.league_administration_contents content ON content.id=observed.content_id
        WHERE observed.id=observation AND observed.league_season_id=season_id AND observed.family=v_family AND observed.week=0
          AND (v_family='league' OR observed.outcome IN ('changed','unchanged'))
          AND content.accepted AND content.completeness='complete' AND content.provider='sleeper'
          AND content.external_league_id=p_work->>'externalLeagueId') THEN RAISE EXCEPTION 'public resource lineage mismatch'; END IF;
    END LOOP;
    IF kind='core' THEN
      FOREACH receipt_key IN ARRAY ARRAY['settings','players','managers'] LOOP
        wanted_receipt_id:=(p_capture->'receipts'->>receipt_key)::uuid;
        IF wanted_receipt_id IS NULL OR NOT EXISTS(SELECT 1 FROM public.league_roster_resource_acceptances accepted
          JOIN public.league_roster_capture_receipts receipt ON receipt.id=accepted.receipt_id
          JOIN public.league_roster_resource_attempts attempt ON attempt.id=receipt.attempt_id
          JOIN public.league_roster_resource_scopes resource ON resource.id=attempt.scope_id
          JOIN public.league_roster_resource_heads head ON head.scope_id=resource.id AND head.accepted_id=accepted.id
          WHERE receipt.id=wanted_receipt_id AND accepted.source_mapping_revision_id=(mapping->>'revisionId')::uuid
            AND attempt.source_mapping=mapping AND attempt.write_fence=p_fence
            AND attempt.ordinal=head.latest_ordinal AND attempt.reserved_at>=dispatch_row.admitted_at
            AND receipt.provenance->>'origin'='network'
            AND (receipt.provenance->>'requestStartedAt')::timestamptz>=dispatch_row.admitted_at
            AND (receipt.provenance->>'requestStartedAt')::timestamptz>=clock_timestamp()-interval '30 seconds'
            AND (receipt.provenance->>'requestCompletedAt')::timestamptz BETWEEN
              (receipt.provenance->>'requestStartedAt')::timestamptz AND clock_timestamp()
            AND (receipt.provenance->>'sourceObservedAt')::timestamptz=(receipt.provenance->>'requestCompletedAt')::timestamptz
            AND receipt.coverage->>'completeness'='complete'
            AND receipt.legacy_observation_id=(p_capture->'observations'->>CASE WHEN receipt_key='settings' THEN 'league' ELSE 'rosters' END)::uuid
            AND resource.identity->'policy'->>'canonicalNormalizerVersion'=CASE receipt_key
              WHEN 'settings' THEN 'sleeper-league-settings-v1' WHEN 'players' THEN 'sleeper-current-players-v1'
              ELSE 'sleeper-current-team-managers-v1' END) THEN
          RAISE EXCEPTION 'current typed public resource receipt required';
        END IF;
      END LOOP;
    END IF;
    IF kind='users' THEN
      directory:=p_capture->'directoryCapture';
      started:=(directory->>'requestStartedAt')::timestamptz;
      completed:=(directory->>'requestCompletedAt')::timestamptz;
      IF directory->>'family' IS DISTINCT FROM 'users' OR directory->'week' IS DISTINCT FROM 'null'::jsonb
        OR directory->>'origin' IS DISTINCT FROM 'network'
        OR COALESCE(directory->>'completeness','complete')<>'complete'
        OR started IS NULL OR completed IS NULL OR started>completed OR completed>clock_timestamp()
        OR started<dispatch_row.admitted_at OR started<clock_timestamp()-interval '30 seconds'
        OR COALESCE(directory->>'sourceObservedAt',directory->>'requestCompletedAt')::timestamptz IS DISTINCT FROM completed THEN
        RAISE EXCEPTION 'fresh dispatch-bound directory capture required';
      END IF;
      SELECT content.id INTO directory_content FROM public.league_administration_observations observed
        JOIN public.league_administration_contents content ON content.id=observed.content_id
        JOIN public.league_administration_heads head ON head.league_season_id=observed.league_season_id
          AND head.family='users' AND head.week=0 AND head.accepted_observation_id=observed.id
        WHERE observed.id=(p_capture->'observations'->>'users')::uuid AND observed.league_season_id=season_id
          AND observed.family='users' AND observed.week=0
          AND observed.outcome IN ('changed','unchanged') AND content.accepted AND content.completeness='complete'
          AND content.provider='sleeper' AND content.external_league_id=p_work->>'externalLeagueId'
          AND content.payload=directory->'payload' AND content.normalizer_version='sleeper-administration-v1'
          AND head.read_conflict IS NULL AND head.verified_at=completed AND head.ordering_at=completed;
      IF directory_content IS NULL THEN RAISE EXCEPTION 'directory capture content or freshness mismatch'; END IF;
      INSERT INTO public.public_data_directory_captures(intake_id,worker_id,generation,league_season_id,source_mapping,
        content_id,legacy_observation_id,request_started_at,request_completed_at,source_observed_at)
        VALUES(request_id,p_fence->>'workerId',(p_fence->>'generation')::integer,season_id,mapping,directory_content,
          (p_capture->'observations'->>'users')::uuid,started,completed,completed) RETURNING id INTO directory_capture_id;
    END IF;
    UPDATE public.public_data_league_candidates SET
      league_observation_id=coalesce((p_capture->'observations'->>'league')::uuid,league_observation_id),
      roster_observation_id=coalesce((p_capture->'observations'->>'rosters')::uuid,roster_observation_id),
      users_observation_id=coalesce((p_capture->'observations'->>'users')::uuid,users_observation_id),
      users_capture_id=coalesce(directory_capture_id,users_capture_id),
      settings_receipt_id=coalesce((p_capture->'receipts'->>'settings')::uuid,settings_receipt_id),
      players_receipt_id=coalesce((p_capture->'receipts'->>'players')::uuid,players_receipt_id),
      managers_receipt_id=coalesce((p_capture->'receipts'->>'managers')::uuid,managers_receipt_id),
      stage=CASE WHEN kind='core' THEN 'users' ELSE 'complete' END
      WHERE intake_id=request_id AND season=(p_work->>'season')::integer AND external_league_id=p_work->>'externalLeagueId';
  ELSE RAISE EXCEPTION 'invalid public checkpoint kind'; END IF;
  PERFORM public.assert_public_data_owner(request_id,p_fence);
  UPDATE public.public_data_intakes SET revision=revision+1,failure_count=0,next_attempt_at=clock_timestamp() WHERE id=request_id;
  IF public.next_public_data_intake(request_id) IN ('"complete"'::jsonb,'"partial"'::jsonb) THEN
    UPDATE public.public_data_intakes SET terminal=true WHERE id=request_id;
  END IF;
  PERFORM public.assert_public_data_owner(request_id,p_fence);
  INSERT INTO public.public_data_dispatch_outcomes(worker_id,generation,outcome)
    VALUES(p_fence->>'workerId',(p_fence->>'generation')::integer,'checkpoint-committed');
END; $$;

CREATE OR REPLACE FUNCTION public.configure_public_data_refresh(p_input jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE target public.public_data_refresh_targets%ROWTYPE; configuration public.public_data_refresh_configurations%ROWTYPE;
  target_id uuid:=(p_input->>'id')::uuid; identity_id uuid:=(p_input->>'identityRequestId')::uuid;
  periods jsonb; expected bigint:=(p_input->>'expectedRevision')::bigint; manager_id uuid; wanted integer[];
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
  periods:=public.canonical_public_data_exact_periods(CASE WHEN p_input ? 'exactPeriods' THEN p_input->'exactPeriods' ELSE '[]'::jsonb END,wanted);
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
      AND configuration.seasons=wanted AND configuration.exact_periods=periods AND configuration.cadence_seconds=cadence
      AND configuration.expires_at=expiry AND configuration.paused=paused_value THEN
      RETURN jsonb_build_object('status','replayed','targetId',target.id,'configurationRevision',target.configuration_revision);
    END IF;
    IF target.configuration_revision<>expected THEN RAISE EXCEPTION 'refresh configuration revision changed'; END IF;
    SELECT request.* INTO current_request FROM public.public_data_refresh_cycles cycle
      JOIN public.public_data_intakes request ON request.id=cycle.intake_id
      WHERE cycle.target_id=target.id AND cycle.cycle=target.current_cycle;
    IF FOUND AND NOT current_request.terminal AND (current_request.seasons IS DISTINCT FROM wanted OR current_request.exact_periods IS DISTINCT FROM periods) THEN
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
  INSERT INTO public.public_data_refresh_configurations(target_id,revision,identity_request_id,seasons,cadence_seconds,expires_at,paused,exact_periods)
    VALUES(target_id,next_revision,identity_id,wanted,cadence,expiry,paused_value,periods);
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
      PERFORM public.submit_public_data_intake(jsonb_build_object('id',request_id,'username',native,'seasons',configuration.seasons,'exactPeriods',configuration.exact_periods));
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

-- Exact effective030 body (renamed by031). Only the current official settings
-- scoring-conflict alternate from034 is added, with mandatory supplied population.
CREATE OR REPLACE FUNCTION public.record_league_administration_observation_v30(p_input jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE result jsonb; addition jsonb:=p_input->'matchupAcceptance'; token jsonb;
  attempt public.league_roster_resource_attempts%ROWTYPE; head public.league_roster_resource_heads%ROWTYPE;
  content public.league_administration_contents%ROWTYPE; configuration public.league_administration_contents%ROWTYPE;
  receipt public.league_roster_capture_receipts%ROWTYPE;
  provenance jsonb:=p_input->'envelope'->'provenance'; population jsonb;
  evidence_hash_value text; coverage_reason text:='complete_matchup_population_unproved';
  expected_count integer; covered boolean:=false; acceptance_id uuid; period_value text;
BEGIN
  -- Legacy wrapper executes once, with precisely its original input for matchups.
  result:=public.record_league_administration_observation_v29(
    p_input-'matchupAcceptance'-CASE WHEN addition IS NOT NULL THEN 'sourceMapping' ELSE '__no_removed_field__' END);
  IF addition IS NULL THEN RETURN result; END IF;
  token:=addition->'attempt'; population:=addition->'population';
  IF p_input->'envelope'->>'family' IS DISTINCT FROM 'matchups'
    OR p_input->'envelope'->>'week' IS NULL
    OR provenance->>'origin' IS DISTINCT FROM 'network'
    OR (provenance->>'requestStartedAt')::timestamptz IS NULL
    OR (provenance->>'requestCompletedAt')::timestamptz IS NULL
    OR (provenance->>'sourceObservedAt')::timestamptz IS NULL
    OR (provenance->>'checkedAt')::timestamptz IS NULL
    OR (provenance->>'requestStartedAt')::timestamptz>(provenance->>'requestCompletedAt')::timestamptz
    OR (provenance->>'requestCompletedAt')::timestamptz>(provenance->>'checkedAt')::timestamptz
    OR (provenance->>'sourceObservedAt')::timestamptz>(provenance->>'checkedAt')::timestamptz
    OR (provenance->>'checkedAt')::timestamptz>clock_timestamp()+interval '5 minutes'
    OR p_input->'sourceMapping' IS NULL THEN
    RAISE EXCEPTION 'matchup acceptance requires mapped complete network capture'; END IF;
  IF p_input->'envelope'->'scope' IS DISTINCT FROM p_input->'sourceMapping'->'scope' THEN
    RAISE EXCEPTION 'matchup envelope mapping mismatch'; END IF;
  PERFORM public.validate_current_roster_mapping(p_input->'sourceMapping');
  period_value:='sleeper:matchup-week:'||(p_input->'envelope'->>'week');
  SELECT * INTO STRICT attempt FROM public.league_roster_resource_attempts WHERE id=(token->>'id')::uuid;
  IF (provenance->>'requestStartedAt')::timestamptz<attempt.reserved_at THEN
    RAISE EXCEPTION 'matchup request predates reservation'; END IF;
  IF attempt.source_mapping IS DISTINCT FROM p_input->'sourceMapping'
    OR attempt.write_fence IS DISTINCT FROM p_input->'writeFence'
    OR token IS DISTINCT FROM jsonb_build_object('id',attempt.id,'scopeId',attempt.scope_id,
      'ordinal',attempt.ordinal,'expectedGeneration',attempt.expected_generation)
    OR NOT EXISTS(SELECT 1 FROM public.league_roster_resource_scopes scope WHERE scope.id=attempt.scope_id
      AND scope.identity=jsonb_build_object('scope',jsonb_build_object('kind','enrolled-resource',
        'connectionId',attempt.source_mapping->>'connectionId','leagueSeasonId',attempt.source_mapping->>'leagueSeasonId',
        'family','matchups','entityId',NULL,'scoringPeriodId',period_value,'audienceId','public',
        'coverageSpecId','sleeper-exact-period-all-teams-matchups-v1'),
        'policy',jsonb_build_object('audienceId','public','coverageSpecId','sleeper-exact-period-all-teams-matchups-v1',
        'canonicalNormalizerVersion','sleeper-exact-matchups-v1','validationVersion','latest-network-attempt-v1'))) THEN
    RAISE EXCEPTION 'matchup attempt scope mismatch'; END IF;
  SELECT * INTO STRICT head FROM public.league_roster_resource_heads WHERE scope_id=attempt.scope_id FOR UPDATE;
  IF attempt.write_fence IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.projection_jobs job
    WHERE job.job_key=attempt.write_fence->>'jobKey' AND job.state='running'
      AND job.lease_owner=attempt.write_fence->>'workerId'
      AND job.attempt_count=(attempt.write_fence->>'generation')::integer
      AND job.lease_until>clock_timestamp() AND (attempt.write_fence->>'deadlineAt')::timestamptz>clock_timestamp()) THEN
    RAISE EXCEPTION 'matchup writer fence expired'; END IF;
  evidence_hash_value:=encode(digest(convert_to(p_input::text,'UTF8'),'sha256'),'hex');
  SELECT * INTO receipt FROM public.league_roster_capture_receipts WHERE attempt_id=attempt.id;
  IF FOUND THEN
    IF receipt.evidence_hash<>evidence_hash_value THEN RAISE EXCEPTION 'matchup attempt receipt conflict'; END IF;
    RETURN result||jsonb_build_object('matchupAcceptance',jsonb_build_object('status',
      CASE WHEN EXISTS(SELECT 1 FROM public.league_roster_resource_acceptances accepted
        WHERE accepted.id=head.accepted_id AND accepted.receipt_id=receipt.id)
        AND attempt.ordinal=head.latest_ordinal THEN 'accepted' ELSE 'preserved' END,
      'reason','exact_receipt_replay','receiptId',receipt.id,'acceptedGeneration',head.generation));
  END IF;
  SELECT * INTO STRICT content FROM public.league_administration_contents stored
    WHERE stored.league_season_id=(attempt.source_mapping->>'leagueSeasonId')::uuid
      AND stored.provider='sleeper' AND stored.external_league_id=attempt.source_mapping->'scope'->>'externalLeagueId'
      AND stored.family='matchups' AND stored.week=(p_input->'envelope'->>'week')::integer
      AND stored.normalizer_version='sleeper-administration-v1' AND stored.content_hash=p_input->>'contentHash'
      AND stored.completeness=p_input->'envelope'->>'completeness'
      AND stored.accepted=(p_input->>'status'='accepted' AND p_input->'envelope'->>'completeness'='complete')
      AND stored.payload=p_input->'envelope'->'payload' AND stored.normalized_value IS NOT DISTINCT FROM p_input->'value';
  -- Population must come from a separately stored network league document in this batch.
  IF population IS NOT NULL THEN
    IF population->'envelope'->'scope' IS DISTINCT FROM attempt.source_mapping->'scope'
      OR population->'envelope'->>'family' IS DISTINCT FROM 'league'
      OR population->'envelope'->>'completeness' IS DISTINCT FROM 'complete'
      OR population->'envelope'->'provenance'->>'origin' IS DISTINCT FROM 'network'
      OR population->'envelope'->>'normalizerVersion' IS DISTINCT FROM 'sleeper-administration-v1'
      OR population->'envelope'->>'schemaVersion' IS DISTINCT FROM 'league-administration-v1'
      OR population->'envelope'->>'dialect' IS DISTINCT FROM 'sleeper-nfl-v1'
      OR population->'envelope'->'week' IS DISTINCT FROM 'null'::jsonb
      OR (population->'envelope'->'provenance'->>'requestStartedAt')::timestamptz IS NULL
      OR (population->'envelope'->'provenance'->>'requestCompletedAt')::timestamptz IS NULL
      OR (population->'envelope'->'provenance'->>'requestStartedAt')::timestamptz<attempt.reserved_at
      OR (population->'envelope'->'provenance'->>'sourceObservedAt')::timestamptz IS NULL
      OR (population->'envelope'->'provenance'->>'checkedAt')::timestamptz IS NULL
      OR (population->'envelope'->'provenance'->>'requestStartedAt')::timestamptz
        >(population->'envelope'->'provenance'->>'requestCompletedAt')::timestamptz
      OR (population->'envelope'->'provenance'->>'requestCompletedAt')::timestamptz
        >(population->'envelope'->'provenance'->>'checkedAt')::timestamptz
      OR (population->'envelope'->'provenance'->>'sourceObservedAt')::timestamptz
        >(population->'envelope'->'provenance'->>'checkedAt')::timestamptz
      OR (population->'envelope'->'provenance'->>'checkedAt')::timestamptz>clock_timestamp()+interval '5 minutes' THEN
      RAISE EXCEPTION 'matchup population evidence mismatch'; END IF;
    SELECT * INTO configuration FROM public.league_administration_contents stored
      WHERE stored.league_season_id=content.league_season_id AND stored.provider=content.provider
        AND stored.external_league_id=content.external_league_id AND stored.family='league' AND stored.week=0
        AND stored.normalizer_version='sleeper-administration-v1' AND stored.accepted AND stored.completeness='complete'
        AND stored.content_hash=population->>'contentHash' AND stored.payload=population->'envelope'->'payload'
        AND EXISTS(SELECT 1 FROM public.league_administration_observations observed
          WHERE observed.id=(population->>'observationId')::uuid AND observed.content_id=stored.id
            AND observed.league_season_id=stored.league_season_id AND observed.family='league' AND observed.week=0);
  END IF;
  expected_count:=(configuration.normalized_value->>'totalRosters')::integer;
  IF configuration.payload->>'total_rosters' IS DISTINCT FROM expected_count::text THEN expected_count:=NULL; END IF;
  IF configuration.id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.league_administration_heads configuration_head
    JOIN public.league_administration_observations observed ON observed.id=configuration_head.accepted_observation_id
    WHERE configuration_head.league_season_id=content.league_season_id AND configuration_head.family='league'
      AND configuration_head.week=0 AND configuration_head.read_conflict IS NULL AND observed.content_id=configuration.id)
    AND NOT EXISTS(SELECT 1 FROM public.league_roster_resource_scopes settings_scope
      JOIN public.league_roster_resource_heads settings_head ON settings_head.scope_id=settings_scope.id
      JOIN public.league_roster_resource_acceptances settings_accepted ON settings_accepted.id=settings_head.accepted_id
        AND settings_accepted.scope_id=settings_scope.id AND settings_accepted.generation=settings_head.generation
      JOIN public.league_roster_capture_receipts settings_receipt ON settings_receipt.id=settings_accepted.receipt_id
      JOIN public.league_roster_resource_attempts settings_attempt ON settings_attempt.id=settings_receipt.attempt_id
        AND settings_attempt.scope_id=settings_scope.id AND settings_attempt.ordinal=settings_head.latest_ordinal
      JOIN public.league_administration_heads official_head ON official_head.league_season_id=content.league_season_id
        AND official_head.family='league' AND official_head.week=0
        AND official_head.latest_observation_id=settings_receipt.legacy_observation_id
      JOIN public.league_administration_observations official_observation ON official_observation.id=official_head.latest_observation_id
        AND official_observation.content_id=configuration.id
      WHERE settings_scope.league_season_id=content.league_season_id
        AND settings_scope.connection_id=(attempt.source_mapping->>'connectionId')::uuid
        AND settings_scope.identity->'scope'->>'family'='league-season'
        AND settings_scope.identity->'policy'->>'canonicalNormalizerVersion'='sleeper-league-settings-v1'
        AND settings_accepted.source_mapping_revision_id=(attempt.source_mapping->>'revisionId')::uuid
        AND settings_attempt.source_mapping=attempt.source_mapping
        AND settings_receipt.content_id=configuration.id AND settings_receipt.coverage->>'completeness'='complete'
        AND official_head.read_conflict='scoring_profile_change_requires_explicit_compatibility_and_period_review'
        AND (population IS NOT NULL AND settings_receipt.provenance=population->'envelope'->'provenance'
          AND settings_attempt.write_fence IS NOT DISTINCT FROM attempt.write_fence
          AND settings_receipt.legacy_observation_id=(population->>'observationId')::uuid)) THEN
    expected_count:=NULL; END IF;
  covered:=content.accepted AND content.completeness='complete' AND expected_count>0 AND jsonb_typeof(content.payload)='array'
    AND jsonb_typeof(content.normalized_value->'matchups')='array'
    AND jsonb_array_length(content.payload)=expected_count
    AND jsonb_array_length(content.normalized_value->'matchups')=expected_count
    AND (SELECT count(DISTINCT item->>'externalRosterId') FROM jsonb_array_elements(content.normalized_value->'matchups') item)=expected_count
    AND (SELECT count(*) FROM public.league_administration_team_entries entry
      JOIN public.league_season_teams team ON team.id=entry.team_id AND team.league_season_id=entry.league_season_id
      WHERE entry.content_id=content.id AND entry.league_season_id=content.league_season_id
        AND team.provider=content.provider AND team.external_league_id=content.external_league_id)=expected_count;
  INSERT INTO public.league_roster_capture_receipts(attempt_id,content_id,legacy_observation_id,evidence_hash,
    provenance,configuration_content_id,population_evidence,expected_team_count,coverage)
  VALUES(attempt.id,content.id,(result->>'observationId')::uuid,evidence_hash_value,provenance,
    configuration.id,CASE WHEN population IS NOT NULL THEN jsonb_build_object('observationId',population->>'observationId',
      'contentHash',population->>'contentHash','provenance',population->'envelope'->'provenance') ELSE NULL END,
    expected_count,jsonb_build_object('periodIds',jsonb_build_array(period_value),'interval',NULL,
      'entitySet',CASE WHEN covered THEN 'full' ELSE 'unknown' END,
      'fields','["roster_id","matchup_id"]'::jsonb,
      'pagination','complete','nextCursor',NULL,'completeness',CASE WHEN covered THEN 'complete' ELSE 'unknown' END,
      'reasons',CASE WHEN covered THEN '[]'::jsonb ELSE jsonb_build_array(coverage_reason) END))
    RETURNING * INTO receipt;
  IF attempt.ordinal=head.latest_ordinal AND attempt.expected_generation=head.generation AND covered THEN
    IF attempt.write_fence IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.projection_jobs job
      WHERE job.job_key=attempt.write_fence->>'jobKey' AND job.state='running'
        AND job.lease_owner=attempt.write_fence->>'workerId'
        AND job.attempt_count=(attempt.write_fence->>'generation')::integer
        AND job.lease_until>clock_timestamp()
        AND (attempt.write_fence->>'deadlineAt')::timestamptz>clock_timestamp()) THEN
      RAISE EXCEPTION 'matchup writer fence expired'; END IF;
    INSERT INTO public.league_roster_resource_acceptances(scope_id,receipt_id,source_mapping_revision_id,generation)
      VALUES(attempt.scope_id,receipt.id,(attempt.source_mapping->>'revisionId')::uuid,head.generation+1)
      RETURNING id INTO acceptance_id;
    UPDATE public.league_roster_resource_heads SET accepted_id=acceptance_id,generation=generation+1
      WHERE scope_id=attempt.scope_id RETURNING * INTO head;
  END IF;
  RETURN result||jsonb_build_object('matchupAcceptance',jsonb_build_object('status',
    CASE WHEN acceptance_id IS NOT NULL THEN 'accepted' ELSE 'preserved' END,
    'reason',CASE WHEN acceptance_id IS NOT NULL THEN NULL
      WHEN attempt.ordinal<>head.latest_ordinal THEN 'newer_network_attempt_reserved'
      WHEN attempt.expected_generation<>head.generation THEN 'accepted_generation_changed'
      WHEN NOT COALESCE(covered,false) THEN coverage_reason ELSE NULL END,
    'receiptId',receipt.id,'acceptedGeneration',head.generation));
END; $$;

REVOKE ALL ON public.public_data_exact_period_tasks,public.public_data_exact_period_checkpoints FROM PUBLIC;
REVOKE ALL ON FUNCTION public.validate_public_data_exact_period_task(),public.validate_public_data_exact_period_checkpoint() FROM PUBLIC;
DO $$ BEGIN
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='league_one_runtime') THEN
    REVOKE ALL ON public.public_data_exact_period_tasks,public.public_data_exact_period_checkpoints FROM league_one_runtime;
    GRANT SELECT ON public.public_data_exact_period_tasks,public.public_data_exact_period_checkpoints TO league_one_runtime;
    REVOKE ALL ON FUNCTION public.canonical_public_data_exact_periods(jsonb,integer[]),
      public.validate_public_data_exact_period_task(),public.validate_public_data_exact_period_checkpoint(),
      public.admit_public_data_dispatch_v34(jsonb,jsonb),public.fail_public_data_work(jsonb),
      public.record_league_administration_observation_v30(jsonb) FROM league_one_runtime;
  END IF;
END; $$;
