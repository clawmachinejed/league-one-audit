-- R040: explicit bounded multi-week inventory through the existing DATA intake.
-- No automatic history traversal, worker, provider feed or production activation.
-- Existing requests, ordinals, checkpoints, selections and refresh history are retained.
CREATE OR REPLACE FUNCTION public.canonical_public_data_exact_periods(p_value jsonb,p_seasons integer[])
RETURNS jsonb LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE item jsonb; season_value integer; week_value integer; seen text[]:='{}'; result jsonb;
BEGIN
  IF p_seasons IS NULL OR array_position(p_seasons,NULL) IS NOT NULL
    OR jsonb_typeof(p_value) IS DISTINCT FROM 'array' OR jsonb_array_length(p_value)>54 THEN
    RAISE EXCEPTION 'invalid explicit public period scope'; END IF;
  FOR item IN SELECT value FROM jsonb_array_elements(p_value) LOOP
    IF jsonb_typeof(item) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'invalid explicit public period'; END IF;
    IF (SELECT count(*) FROM jsonb_object_keys(item))<>2 OR NOT(item ?& ARRAY['season','nativeWeek'])
      OR jsonb_typeof(item->'season') IS DISTINCT FROM 'number' OR jsonb_typeof(item->'nativeWeek') IS DISTINCT FROM 'number'
      OR item->>'season' !~ '^[1-9][0-9]{3}$' OR item->>'nativeWeek' !~ '^[1-9][0-9]?$' THEN
      RAISE EXCEPTION 'invalid explicit public period'; END IF;
    season_value:=(item->>'season')::integer; week_value:=(item->>'nativeWeek')::integer;
    IF season_value NOT BETWEEN 1920 AND 2200 OR week_value NOT BETWEEN 1 AND 18
      OR NOT(season_value=ANY(p_seasons)) OR (season_value::text||':'||week_value::text)=ANY(seen) THEN
      RAISE EXCEPTION 'explicit period must select a distinct week within a declared season'; END IF;
    seen:=array_append(seen,season_value::text||':'||week_value::text);
  END LOOP;
  SELECT COALESCE(jsonb_agg(value ORDER BY (value->>'season')::integer,(value->>'nativeWeek')::integer),'[]'::jsonb) INTO result FROM jsonb_array_elements(p_value);
  RETURN result;
END; $$;
REVOKE ALL ON FUNCTION public.canonical_public_data_exact_periods(jsonb,integer[]) FROM PUBLIC;

-- Replace only the old per-league uniqueness. The ordinal PK, 1..20 bound and
-- checkpoint/candidate foreign keys remain unchanged; no historical row is rewritten.
DO $$ DECLARE previous_name text; BEGIN
  SELECT constraint_row.conname INTO STRICT previous_name
  FROM pg_catalog.pg_constraint constraint_row
  WHERE constraint_row.conrelid='public.public_data_exact_period_tasks'::regclass
    AND constraint_row.contype='u' AND constraint_row.convalidated
    AND (SELECT array_agg(attribute.attname::text ORDER BY key.ordinality)
      FROM unnest(constraint_row.conkey) WITH ORDINALITY key(attnum,ordinality)
      JOIN pg_catalog.pg_attribute attribute ON attribute.attrelid=constraint_row.conrelid AND attribute.attnum=key.attnum)
      =ARRAY['intake_id','season','external_league_id'];
  EXECUTE format('ALTER TABLE public.public_data_exact_period_tasks DROP CONSTRAINT %I',previous_name);
END; $$;
ALTER TABLE public.public_data_exact_period_tasks ADD CONSTRAINT public_period_task_week_unique
  UNIQUE(intake_id,season,external_league_id,native_week);

-- Private aggregate only. Include every discovered candidate, including capacity
-- entries, so an excluded candidate cannot silently reduce the requested inventory.
-- VOLATILE deliberately sees discovery/task writes made earlier in the checkpoint.
CREATE FUNCTION public.public_data_exact_period_inventory_v40(p_id uuid)
RETURNS TABLE(expected_count integer,stored_count integer,missing_count integer,extra_count integer,unfinished_count integer)
LANGUAGE sql VOLATILE SECURITY INVOKER SET search_path=pg_catalog,public,pg_temp AS $$
  WITH expected AS (
    SELECT candidate.season,candidate.external_league_id,(period->>'nativeWeek')::integer AS native_week
    FROM public.public_data_league_candidates candidate
    JOIN public.public_data_intakes request ON request.id=candidate.intake_id
    CROSS JOIN LATERAL jsonb_array_elements(request.exact_periods) period
    WHERE candidate.intake_id=p_id AND (period->>'season')::integer=candidate.season
  ), stored AS (
    SELECT task.season,task.external_league_id,task.native_week,task.status
    FROM public.public_data_exact_period_tasks task WHERE task.intake_id=p_id
  )
  SELECT (SELECT count(*)::integer FROM expected),(SELECT count(*)::integer FROM stored),
    (SELECT count(*)::integer FROM (SELECT season,external_league_id,native_week FROM expected
      EXCEPT SELECT season,external_league_id,native_week FROM stored) missing),
    (SELECT count(*)::integer FROM (SELECT season,external_league_id,native_week FROM stored
      EXCEPT SELECT season,external_league_id,native_week FROM expected) extra),
    (SELECT count(*)::integer FROM stored WHERE status<>'complete');
$$;
REVOKE ALL ON FUNCTION public.public_data_exact_period_inventory_v40(uuid) FROM PUBLIC;
DO $$ BEGIN
  IF EXISTS(SELECT 1 FROM pg_catalog.pg_roles WHERE rolname='league_one_runtime') THEN
    REVOKE ALL ON FUNCTION public.public_data_exact_period_inventory_v40(uuid) FROM league_one_runtime;
    IF has_function_privilege('league_one_runtime','public.public_data_exact_period_inventory_v40(uuid)','EXECUTE')
      OR EXISTS(SELECT 1 FROM pg_catalog.pg_proc routine JOIN pg_catalog.pg_roles owner ON owner.oid=routine.proowner
        WHERE routine.oid='public.public_data_exact_period_inventory_v40(uuid)'::regprocedure AND owner.rolname='league_one_runtime') THEN
      RAISE EXCEPTION 'league_one_runtime can execute or owns private inventory helper'; END IF;
  END IF;
END; $$;

CREATE OR REPLACE FUNCTION public.next_public_data_intake(p_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE request public.public_data_intakes%ROWTYPE; manager text; missing_season integer;
  candidate public.public_data_league_candidates%ROWTYPE; task public.public_data_exact_period_tasks%ROWTYPE; base jsonb; inventory record;
BEGIN
  SELECT * INTO STRICT request FROM public.public_data_intakes WHERE id=p_id;
  IF request.exact_periods<>'[]'::jsonb THEN
    SELECT * INTO STRICT inventory FROM public.public_data_exact_period_inventory_v40(p_id);
  END IF;
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
      IF inventory.expected_count>20 OR inventory.stored_count<>inventory.expected_count
        OR inventory.missing_count<>0 OR inventory.extra_count<>0 OR inventory.unfinished_count<>0 THEN
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
  -- Capacity or incomplete inventory blocks period acquisition only. Existing
  -- core/directory work retains its normal bounded path and eventual partial state.
  IF request.exact_periods<>'[]'::jsonb THEN
    IF inventory.expected_count<=20 AND inventory.stored_count=inventory.expected_count
      AND inventory.missing_count=0 AND inventory.extra_count=0 THEN
    SELECT * INTO candidate FROM public.public_data_league_candidates WHERE intake_id=p_id AND stage='bootstrap'
      ORDER BY season,external_league_id LIMIT 1;
    IF FOUND THEN RETURN base||jsonb_build_object('kind','bootstrap','externalLeagueId',candidate.external_league_id,'season',candidate.season); END IF;
    SELECT pending.* INTO task FROM public.public_data_exact_period_tasks pending JOIN public.public_data_league_candidates eligible
      ON eligible.intake_id=pending.intake_id AND eligible.season=pending.season AND eligible.external_league_id=pending.external_league_id
      WHERE pending.intake_id=p_id AND pending.status='pending' AND eligible.league_season_id IS NOT NULL ORDER BY pending.ordinal LIMIT 1;
    IF FOUND THEN RETURN base||jsonb_build_object('kind','exact-matchups','externalLeagueId',task.external_league_id,'season',task.season,'nativeWeek',task.native_week); END IF;
    END IF;
  END IF;
  SELECT * INTO candidate FROM public.public_data_league_candidates WHERE intake_id=p_id AND stage IN ('bootstrap','core','users')
    ORDER BY CASE stage WHEN 'users' THEN 1 ELSE 0 END,season,external_league_id LIMIT 1;
  IF NOT FOUND THEN
    IF EXISTS(SELECT 1 FROM public.public_data_league_candidates WHERE intake_id=p_id AND stage IN ('unavailable','capacity')) THEN
      RETURN '"partial"'::jsonb;
    END IF;
    IF request.exact_periods<>'[]'::jsonb THEN
      IF inventory.expected_count>20 OR inventory.stored_count<>inventory.expected_count
        OR inventory.missing_count<>0 OR inventory.extra_count<>0 OR inventory.unfinished_count<>0 THEN
        RETURN '"partial"'::jsonb;
      END IF;
    END IF;
    RETURN '"complete"'::jsonb;
  END IF;
  RETURN base||jsonb_build_object('kind',candidate.stage,'externalLeagueId',candidate.external_league_id,'season',candidate.season);
END; $$;

-- Retain the effective R039 witness, reservation, acceptance and checkpoint guards.
CREATE OR REPLACE FUNCTION public.checkpoint_public_data_intake(p_work jsonb,p_capture jsonb,p_fence jsonb) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE request_id uuid:=(p_work->>'requestId')::uuid; kind text:=p_work->>'kind';
  acquisition jsonb;
  value jsonb:=p_capture->'value'; native text; manager_id uuid; started timestamptz; completed timestamptz;
  v_league_id uuid; season_id uuid; connection_id uuid; item jsonb; count_selected integer;
  observation uuid; v_family text; mapping jsonb; receipt_key text; wanted_receipt_id uuid;
  dispatch_row public.public_data_dispatches%ROWTYPE; directory jsonb; directory_content uuid; directory_capture_id uuid; task public.public_data_exact_period_tasks%ROWTYPE; period_scope jsonb; inventory record; last_ordinal integer;
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
    acquisition:=p_capture->'acquisition';
    IF acquisition IS NOT NULL THEN
      PERFORM public.assert_public_data_capture_witness(acquisition,p_fence,
        CASE WHEN kind='bootstrap' THEN 'league' ELSE kind END,NULL);
    END IF;
    IF started IS NULL OR completed IS NULL OR started>completed
      OR (acquisition IS NULL AND (completed>clock_timestamp() OR started<clock_timestamp()-interval '30 seconds')) THEN
      RAISE EXCEPTION 'invalid public capture timing'; END IF;
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
    -- Discovery is retained for every declared season before any expansion.
    -- Existing R038 partial-discovery tasks keep their ordinals; append only missing
    -- week-inclusive identities. Terminal requests are never backfilled by migration.
    IF period_scope<>'[]'::jsonb AND NOT EXISTS(
      SELECT 1 FROM public.public_data_intakes request CROSS JOIN LATERAL unnest(request.seasons) wanted(season)
      WHERE request.id=request_id AND NOT EXISTS(SELECT 1 FROM public.public_data_league_lists list
        WHERE list.intake_id=request_id AND list.season=wanted.season)) THEN
      SELECT * INTO STRICT inventory FROM public.public_data_exact_period_inventory_v40(request_id);
      SELECT COALESCE(max(ordinal),0) INTO last_ordinal FROM public.public_data_exact_period_tasks WHERE intake_id=request_id;
      IF inventory.expected_count>20 OR inventory.extra_count<>0 OR last_ordinal+inventory.missing_count>20 THEN
        -- No first-twenty truncation: the immutable selection and full retained
        -- discovery define every unavailable requested pair for the reader.
        UPDATE public.public_data_exact_period_tasks SET status='unavailable',reason='period-inventory-capacity'
          WHERE intake_id=request_id AND status='pending';
      ELSE
        INSERT INTO public.public_data_exact_period_tasks(intake_id,ordinal,season,external_league_id,native_week,status,reason)
        SELECT request_id,last_ordinal+row_number() OVER(ORDER BY candidate.season,candidate.external_league_id COLLATE "C",(period->>'nativeWeek')::integer),
          candidate.season,candidate.external_league_id,(period->>'nativeWeek')::integer,
          CASE WHEN candidate.stage IN ('capacity','unavailable') THEN 'unavailable' ELSE 'pending' END,
          CASE WHEN candidate.stage='capacity' THEN 'bootstrap-capacity' WHEN candidate.stage='unavailable' THEN 'bootstrap-unavailable' ELSE NULL END
        FROM public.public_data_league_candidates candidate JOIN public.public_data_intakes request ON request.id=candidate.intake_id
        CROSS JOIN LATERAL jsonb_array_elements(request.exact_periods) period
        WHERE candidate.intake_id=request_id AND (period->>'season')::integer=candidate.season
          AND NOT EXISTS(SELECT 1 FROM public.public_data_exact_period_tasks retained WHERE retained.intake_id=request_id
            AND retained.season=candidate.season AND retained.external_league_id=candidate.external_league_id
            AND retained.native_week=(period->>'nativeWeek')::integer);
      END IF;
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
      INSERT INTO public.public_data_dispatch_outcomes(worker_id,generation,outcome,capture_acquisition)
        VALUES(p_fence->>'workerId',(p_fence->>'generation')::integer,'checkpoint-committed',acquisition);
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
    SELECT provenance->'acquisition' INTO acquisition FROM public.league_roster_capture_receipts
      WHERE id=(p_capture->'receipts'->>'settings')::uuid;
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
      SELECT provenance->'acquisition' INTO acquisition FROM public.league_roster_capture_receipts
        WHERE id=(p_capture->'receipts'->>'settings')::uuid;
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
            AND receipt.provenance->'acquisition' IS NOT DISTINCT FROM acquisition
            AND CASE WHEN acquisition IS NULL THEN
              (receipt.provenance->>'requestStartedAt')::timestamptz>=dispatch_row.admitted_at
              AND (receipt.provenance->>'requestStartedAt')::timestamptz>=clock_timestamp()-interval '30 seconds'
              AND (receipt.provenance->>'requestCompletedAt')::timestamptz BETWEEN
                (receipt.provenance->>'requestStartedAt')::timestamptz AND clock_timestamp()
            ELSE public.public_capture_after_reservation(receipt.provenance,attempt.id)
              AND receipt.recorded_at BETWEEN attempt.reserved_at AND clock_timestamp()
              AND (receipt.provenance->>'requestStartedAt')::timestamptz<=(receipt.provenance->>'requestCompletedAt')::timestamptz END
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
      acquisition:=directory->'acquisition';
      IF acquisition IS NOT NULL THEN
        PERFORM public.assert_public_data_capture_witness(acquisition,p_fence,'users',NULL,mapping);
      END IF;
      started:=(directory->>'requestStartedAt')::timestamptz;
      completed:=(directory->>'requestCompletedAt')::timestamptz;
      IF directory->>'family' IS DISTINCT FROM 'users' OR directory->'week' IS DISTINCT FROM 'null'::jsonb
        OR directory->>'origin' IS DISTINCT FROM 'network'
        OR COALESCE(directory->>'completeness','complete')<>'complete'
        OR started IS NULL OR completed IS NULL OR started>completed
        OR (acquisition IS NULL AND (completed>clock_timestamp()
          OR started<dispatch_row.admitted_at OR started<clock_timestamp()-interval '30 seconds'))
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
  INSERT INTO public.public_data_dispatch_outcomes(worker_id,generation,outcome,capture_acquisition)
    VALUES(p_fence->>'workerId',(p_fence->>'generation')::integer,'checkpoint-committed',acquisition);
END; $$;
