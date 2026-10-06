-- Additive DATA lineage after 001-033. No account claim/session or projection activation.
-- Source only until separately qualified with actual restricted PostgreSQL roles.
CREATE TABLE public.public_data_intakes (
  id uuid PRIMARY KEY,
  username text NOT NULL CHECK (username ~ '^[a-zA-Z0-9_]{1,100}$'),
  seasons integer[] NOT NULL CHECK (cardinality(seasons) BETWEEN 1 AND 3),
  revision integer NOT NULL DEFAULT 0 CHECK (revision>=0),
  failure_count integer NOT NULL DEFAULT 0 CHECK (failure_count>=0),
  terminal boolean NOT NULL DEFAULT false,
  next_attempt_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE public.public_data_identity_observations (
  intake_id uuid PRIMARY KEY REFERENCES public.public_data_intakes(id),
  source_manager_account_id uuid NOT NULL REFERENCES public.league_source_manager_accounts(id),
  username text NOT NULL,
  display_name text NOT NULL,
  avatar_url text,
  payload jsonb NOT NULL,
  request_started_at timestamptz NOT NULL,
  request_completed_at timestamptz NOT NULL,
  normalizer_version text NOT NULL DEFAULT 'sleeper-public-intake-v1'
    CHECK (normalizer_version='sleeper-public-intake-v1'),
  CHECK (request_started_at<=request_completed_at)
);
CREATE TABLE public.public_data_league_lists (
  intake_id uuid NOT NULL REFERENCES public.public_data_identity_observations(intake_id),
  season integer NOT NULL CHECK (season BETWEEN 1920 AND 2200),
  payload jsonb NOT NULL CHECK (jsonb_typeof(payload)='array'),
  request_started_at timestamptz NOT NULL,
  request_completed_at timestamptz NOT NULL,
  normalizer_version text NOT NULL DEFAULT 'sleeper-public-intake-v1'
    CHECK (normalizer_version='sleeper-public-intake-v1'),
  PRIMARY KEY (intake_id,season),
  CHECK (request_started_at<=request_completed_at)
);
CREATE TABLE public.public_data_league_candidates (
  intake_id uuid NOT NULL,
  season integer NOT NULL,
  external_league_id text NOT NULL CHECK (external_league_id ~ '^[1-9][0-9]{0,31}$'),
  name text NOT NULL CHECK (length(name) BETWEEN 1 AND 200),
  stage text NOT NULL DEFAULT 'bootstrap' CHECK (stage IN ('bootstrap','core','users','complete','unavailable','capacity')),
  league_season_id uuid REFERENCES public.league_seasons(id),
  bootstrap_payload jsonb,
  bootstrap_started_at timestamptz,
  bootstrap_completed_at timestamptz,
  league_observation_id uuid REFERENCES public.league_administration_observations(id),
  roster_observation_id uuid REFERENCES public.league_administration_observations(id),
  users_observation_id uuid REFERENCES public.league_administration_observations(id),
  settings_receipt_id uuid REFERENCES public.league_roster_capture_receipts(id),
  players_receipt_id uuid REFERENCES public.league_roster_capture_receipts(id),
  managers_receipt_id uuid REFERENCES public.league_roster_capture_receipts(id),
  PRIMARY KEY (intake_id,season,external_league_id),
  FOREIGN KEY (intake_id,season) REFERENCES public.public_data_league_lists(intake_id,season),
  CHECK ((bootstrap_started_at IS NULL)=(bootstrap_completed_at IS NULL)),
  CHECK (bootstrap_started_at<=bootstrap_completed_at)
);
CREATE INDEX public_data_candidates_work ON public.public_data_league_candidates(intake_id,stage,season,external_league_id);
CREATE TABLE public.public_data_rejections (
  intake_id uuid NOT NULL REFERENCES public.public_data_intakes(id),
  revision integer NOT NULL,
  resource text NOT NULL,
  source_scope jsonb NOT NULL,
  payload jsonb NOT NULL,
  request_started_at timestamptz NOT NULL,
  request_completed_at timestamptz NOT NULL,
  reason text NOT NULL CHECK (reason='invalid-source'),
  PRIMARY KEY(intake_id,revision),
  CHECK(request_started_at<=request_completed_at)
);
CREATE TRIGGER public_identity_history_immutable BEFORE UPDATE OR DELETE ON public.public_data_identity_observations
  FOR EACH ROW EXECUTE FUNCTION public.prevent_league_administration_history_change();
CREATE TRIGGER public_list_history_immutable BEFORE UPDATE OR DELETE ON public.public_data_league_lists
  FOR EACH ROW EXECUTE FUNCTION public.prevent_league_administration_history_change();
CREATE TRIGGER public_rejection_history_immutable BEFORE UPDATE OR DELETE ON public.public_data_rejections
  FOR EACH ROW EXECUTE FUNCTION public.prevent_league_administration_history_change();
-- Reservations serialize capacity with existing account/operator enrollment. They
-- remain after a failed bootstrap for explicit recovery; never silently free a slot.
CREATE TABLE public.public_data_collection_reservations (
  external_league_id text PRIMARY KEY CHECK (external_league_id ~ '^[1-9][0-9]{0,31}$'),
  intake_id uuid NOT NULL REFERENCES public.public_data_intakes(id),
  reserved_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE public.public_data_dispatches (
  worker_id text NOT NULL CHECK (btrim(worker_id)<>''),
  generation integer NOT NULL CHECK (generation>0),
  intake_id uuid NOT NULL REFERENCES public.public_data_intakes(id),
  revision integer NOT NULL,
  resource text NOT NULL,
  work jsonb NOT NULL,
  max_requests integer NOT NULL CHECK (max_requests BETWEEN 1 AND 2),
  admitted_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY(worker_id,generation)
);
CREATE INDEX public_data_dispatches_recent ON public.public_data_dispatches(admitted_at DESC);
CREATE TRIGGER public_dispatch_history_immutable BEFORE UPDATE OR DELETE ON public.public_data_dispatches
  FOR EACH ROW EXECUTE FUNCTION public.prevent_league_administration_history_change();
CREATE TABLE public.public_data_dispatch_outcomes (
  worker_id text NOT NULL,
  generation integer NOT NULL,
  outcome text NOT NULL CHECK (outcome IN ('checkpoint-committed','failed','recovered')),
  recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY(worker_id,generation),
  FOREIGN KEY(worker_id,generation) REFERENCES public.public_data_dispatches(worker_id,generation)
);
CREATE TRIGGER public_dispatch_outcome_immutable BEFORE UPDATE OR DELETE ON public.public_data_dispatch_outcomes
  FOR EACH ROW EXECUTE FUNCTION public.prevent_league_administration_history_change();

CREATE FUNCTION public.submit_public_data_intake(p_input jsonb) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE wanted integer[]; retained public.public_data_intakes%ROWTYPE;
BEGIN
  IF jsonb_typeof(p_input->'seasons') IS DISTINCT FROM 'array'
    OR jsonb_array_length(p_input->'seasons') NOT BETWEEN 1 AND 3
    OR (p_input->>'username') !~ '^[a-zA-Z0-9_]{1,100}$' THEN RAISE EXCEPTION 'invalid public intake'; END IF;
  SELECT array_agg(value::integer ORDER BY value::integer) INTO wanted FROM jsonb_array_elements_text(p_input->'seasons');
  IF EXISTS(SELECT 1 FROM unnest(wanted) value WHERE value NOT BETWEEN 1920 AND 2200)
    OR cardinality(wanted)<>(SELECT count(DISTINCT value) FROM unnest(wanted) value) THEN
    RAISE EXCEPTION 'invalid public season scope';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('public-data-intake-admission',0));
  SELECT * INTO retained FROM public.public_data_intakes WHERE id=(p_input->>'id')::uuid;
  IF FOUND THEN
    IF retained.username IS DISTINCT FROM p_input->>'username' OR retained.seasons IS DISTINCT FROM wanted THEN
      RAISE EXCEPTION 'public intake replay mismatch';
    END IF;
    RETURN;
  END IF;
  IF (SELECT count(*) FROM public.public_data_intakes WHERE NOT terminal)>=16 THEN
    RAISE EXCEPTION 'public intake capacity reached';
  END IF;
  INSERT INTO public.public_data_intakes(id,username,seasons) VALUES((p_input->>'id')::uuid,p_input->>'username',wanted);
END; $$;

CREATE FUNCTION public.next_public_data_intake(p_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE request public.public_data_intakes%ROWTYPE; manager text; missing_season integer;
  candidate public.public_data_league_candidates%ROWTYPE; base jsonb;
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
  SELECT * INTO candidate FROM public.public_data_league_candidates WHERE intake_id=p_id AND stage IN ('bootstrap','core','users')
    ORDER BY CASE stage WHEN 'users' THEN 1 ELSE 0 END,season,external_league_id LIMIT 1;
  IF NOT FOUND THEN
    IF EXISTS(SELECT 1 FROM public.public_data_league_candidates WHERE intake_id=p_id AND stage IN ('unavailable','capacity')) THEN
      RETURN '"partial"'::jsonb;
    END IF;
    RETURN '"complete"'::jsonb;
  END IF;
  RETURN base||jsonb_build_object('kind',candidate.stage,'externalLeagueId',candidate.external_league_id,'season',candidate.season);
END; $$;

-- Every caller uses this same lock and counts outstanding DATA reservations.
-- A reservation for the exact source can be consumed by its existing import path.
CREATE FUNCTION public.assert_league_collection_capacity(p_external text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('account-league-enrollment',0));
  IF EXISTS(SELECT 1 FROM public.public_data_collection_reservations WHERE external_league_id=p_external)
    OR EXISTS(SELECT 1 FROM public.league_source_connections connection
      JOIN public.league_seasons season ON season.id=connection.league_season_id
      JOIN public.league_administration_enrollments enrollment ON enrollment.league_id=season.league_id
      WHERE connection.provider='sleeper' AND connection.external_league_id=p_external) THEN RETURN; END IF;
  IF (SELECT count(*) FROM public.league_administration_enrollments)
    +(SELECT count(*) FROM public.public_data_collection_reservations reservation WHERE NOT EXISTS(
      SELECT 1 FROM public.league_source_connections connection JOIN public.league_seasons season ON season.id=connection.league_season_id
      JOIN public.league_administration_enrollments enrollment ON enrollment.league_id=season.league_id
      WHERE connection.provider='sleeper' AND connection.external_league_id=reservation.external_league_id))>=16 THEN
    RAISE EXCEPTION 'league collection capacity reached';
  END IF;
END; $$;

CREATE FUNCTION public.assert_public_data_owner(p_request uuid,p_fence jsonb) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
  IF p_fence->>'jobKey' IS DISTINCT FROM 'league-administration-public-intake' THEN RAISE EXCEPTION 'wrong public intake owner'; END IF;
  PERFORM 1 FROM public.projection_jobs WHERE job_key=p_fence->>'jobKey' AND state='running'
    AND lease_owner=p_fence->>'workerId' AND attempt_count=(p_fence->>'generation')::integer
    AND lease_until>clock_timestamp() AND (p_fence->>'deadlineAt')::timestamptz>clock_timestamp()
    AND payload->>'requestId'=p_request::text FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'public intake lease lost'; END IF;
  IF (p_fence->>'deadlineAt')::timestamptz<=clock_timestamp() OR NOT EXISTS(
    SELECT 1 FROM public.projection_jobs WHERE job_key=p_fence->>'jobKey' AND lease_until>clock_timestamp()) THEN
    RAISE EXCEPTION 'public intake lease lost';
  END IF;
END; $$;

-- This guard is also the lock statement around the EXISTING identity writer.
-- Job and request locks live only for a database transaction, never a provider GET.
CREATE FUNCTION public.guard_public_data_intake(p_work jsonb,p_fence jsonb) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE request public.public_data_intakes%ROWTYPE; native text:=p_work->>'externalLeagueId';
BEGIN
  PERFORM public.assert_public_data_owner((p_work->>'requestId')::uuid,p_fence);
  SELECT * INTO STRICT request FROM public.public_data_intakes WHERE id=(p_work->>'requestId')::uuid FOR UPDATE;
  PERFORM public.assert_public_data_owner(request.id,p_fence);
  IF public.next_public_data_intake(request.id) IS DISTINCT FROM p_work THEN RAISE EXCEPTION 'public intake checkpoint changed'; END IF;
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

CREATE FUNCTION public.admit_public_data_dispatch(p_work jsonb,p_fence jsonb) RETURNS boolean
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
      p_work->>'kind',p_work,CASE WHEN p_work->>'kind'='core' THEN 2 ELSE 1 END);
  RETURN true;
END; $$;

-- Private transition shared by explicit failure and a replacement live owner's
-- recovery. The caller locks the request and supplies retained exact work.
CREATE FUNCTION public.fail_public_data_work(p_work jsonb) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE request_id uuid:=(p_work->>'requestId')::uuid; failures integer;
BEGIN
  UPDATE public.public_data_intakes SET failure_count=failure_count+1,revision=revision+1,
    next_attempt_at=clock_timestamp()+make_interval(secs=>least(3600,60*(2^least(failure_count,5))::integer))
    WHERE id=request_id AND revision=(p_work->>'revision')::integer RETURNING failure_count INTO failures;
  IF NOT FOUND THEN RAISE EXCEPTION 'public intake checkpoint changed'; END IF;
  IF failures>=5 THEN
    IF p_work->>'kind' IN ('bootstrap','core','users') THEN
      UPDATE public.public_data_league_candidates SET stage='unavailable' WHERE intake_id=request_id
        AND season=(p_work->>'season')::integer AND external_league_id=p_work->>'externalLeagueId';
      UPDATE public.public_data_intakes SET failure_count=0,next_attempt_at=clock_timestamp() WHERE id=request_id;
      IF public.next_public_data_intake(request_id) IN ('"complete"'::jsonb,'"partial"'::jsonb) THEN
        UPDATE public.public_data_intakes SET terminal=true WHERE id=request_id;
      END IF;
    ELSE UPDATE public.public_data_intakes SET terminal=true WHERE id=request_id; END IF;
  END IF;
END; $$;

CREATE FUNCTION public.recover_public_data_dispatch(p_selected uuid,p_fence jsonb) RETURNS void
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
    PERFORM public.fail_public_data_work(prior.work); disposition:='recovered';
  ELSIF retained_revision>prior.revision THEN disposition:='checkpoint-committed';
  ELSE RAISE EXCEPTION 'public dispatch revision regressed'; END IF;
  PERFORM public.assert_public_data_owner(p_selected,p_fence);
  INSERT INTO public.public_data_dispatch_outcomes(worker_id,generation,outcome) VALUES(prior.worker_id,prior.generation,disposition);
END; $$;

CREATE FUNCTION public.checkpoint_public_data_intake(p_work jsonb,p_capture jsonb,p_fence jsonb) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE request_id uuid:=(p_work->>'requestId')::uuid; kind text:=p_work->>'kind';
  value jsonb:=p_capture->'value'; native text; manager_id uuid; started timestamptz; completed timestamptz;
  v_league_id uuid; season_id uuid; connection_id uuid; item jsonb; count_selected integer;
  observation uuid; v_family text; mapping jsonb; receipt_key text; wanted_receipt_id uuid;
BEGIN
  PERFORM public.guard_public_data_intake(p_work,p_fence);
  IF NOT EXISTS(SELECT 1 FROM public.public_data_dispatches dispatch WHERE dispatch.worker_id=p_fence->>'workerId'
    AND dispatch.generation=(p_fence->>'generation')::integer AND dispatch.work=p_work AND NOT EXISTS(
      SELECT 1 FROM public.public_data_dispatch_outcomes outcome WHERE outcome.worker_id=dispatch.worker_id AND outcome.generation=dispatch.generation)) THEN
    RAISE EXCEPTION 'matching admitted public dispatch required';
  END IF;
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
  ELSIF kind='bootstrap' THEN
    IF p_capture->>'capacity'='roster-count-unqualified' THEN
      UPDATE public.public_data_league_candidates SET stage='capacity',bootstrap_payload=p_capture->'payload',
        bootstrap_started_at=started,bootstrap_completed_at=completed WHERE intake_id=request_id
        AND season=(p_work->>'season')::integer AND external_league_id=p_work->>'externalLeagueId';
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
  ELSIF kind IN ('core','users') THEN
    mapping:=p_capture->'mapping'; season_id:=(mapping->>'leagueSeasonId')::uuid; connection_id:=(mapping->>'connectionId')::uuid;
    IF NOT EXISTS(SELECT 1 FROM public.league_source_connections connection
      JOIN public.public_data_league_candidates candidate ON candidate.league_season_id=connection.league_season_id
      WHERE candidate.intake_id=request_id AND candidate.season=(p_work->>'season')::integer
        AND candidate.external_league_id=p_work->>'externalLeagueId' AND connection.id=connection_id
        AND connection.league_season_id=season_id AND connection.provider='sleeper'
        AND connection.external_league_id=candidate.external_league_id
        AND connection.current_mapping_revision_id=(mapping->>'revisionId')::uuid
        AND connection.mapping_generation=(mapping->>'generation')::integer) THEN RAISE EXCEPTION 'public source mapping changed'; END IF;
    IF kind='core' AND (p_capture->'observations'->>'league' IS NULL OR p_capture->'observations'->>'rosters' IS NULL)
      OR kind='users' AND p_capture->'observations'->>'users' IS NULL THEN RAISE EXCEPTION 'public resource checkpoint incomplete'; END IF;
    FOR v_family,observation IN SELECT entries.key,entries.value::uuid FROM jsonb_each_text(p_capture->'observations') entries LOOP
      IF v_family NOT IN ('league','rosters','users') OR NOT EXISTS(SELECT 1 FROM public.league_administration_observations observed
        JOIN public.league_administration_contents content ON content.id=observed.content_id
        WHERE observed.id=observation AND observed.league_season_id=season_id AND observed.family=v_family AND observed.week=0
          AND observed.origin='network' AND observed.outcome IN ('changed','unchanged')
          AND content.accepted AND content.completeness='complete' AND content.provider='sleeper'
          AND observed.request_started_at>=clock_timestamp()-interval '30 seconds'
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
            AND receipt.legacy_observation_id=(p_capture->'observations'->>CASE WHEN receipt_key='settings' THEN 'league' ELSE 'rosters' END)::uuid
            AND resource.identity->'policy'->>'canonicalNormalizerVersion'=CASE receipt_key
              WHEN 'settings' THEN 'sleeper-league-settings-v1' WHEN 'players' THEN 'sleeper-current-players-v1'
              ELSE 'sleeper-current-team-managers-v1' END) THEN
          RAISE EXCEPTION 'current typed public resource receipt required';
        END IF;
      END LOOP;
    END IF;
    UPDATE public.public_data_league_candidates SET
      league_observation_id=coalesce((p_capture->'observations'->>'league')::uuid,league_observation_id),
      roster_observation_id=coalesce((p_capture->'observations'->>'rosters')::uuid,roster_observation_id),
      users_observation_id=coalesce((p_capture->'observations'->>'users')::uuid,users_observation_id),
      settings_receipt_id=coalesce((p_capture->'receipts'->>'settings')::uuid,settings_receipt_id),
      players_receipt_id=coalesce((p_capture->'receipts'->>'players')::uuid,players_receipt_id),
      managers_receipt_id=coalesce((p_capture->'receipts'->>'managers')::uuid,managers_receipt_id),
      stage=CASE WHEN p_capture->'observations'->>'users' IS NULL THEN 'users' ELSE 'complete' END
      WHERE intake_id=request_id AND season=(p_work->>'season')::integer AND external_league_id=p_work->>'externalLeagueId';
  ELSE RAISE EXCEPTION 'invalid public checkpoint kind'; END IF;
  PERFORM public.assert_public_data_owner(request_id,p_fence);
  UPDATE public.public_data_intakes SET revision=revision+1,failure_count=0,next_attempt_at=clock_timestamp() WHERE id=request_id;
  IF public.next_public_data_intake(request_id) IN ('"complete"'::jsonb,'"partial"'::jsonb) THEN
    UPDATE public.public_data_intakes SET terminal=true WHERE id=request_id;
  END IF;
  INSERT INTO public.public_data_dispatch_outcomes(worker_id,generation,outcome)
    VALUES(p_fence->>'workerId',(p_fence->>'generation')::integer,'checkpoint-committed');
END; $$;

-- Additive compatibility for the already-shipped import caller. Installed 025 is
-- immutable. Only explicit preparation adopts an inactive DATA membership; its
-- existing activation still requires all three fresh official heads. No DATA
-- intake request calls these account-named legacy entry points or activates work.
CREATE OR REPLACE FUNCTION public.prepare_account_league_enrollment(p_league uuid,p_season integer,p_external text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('account-league-enrollment',0));
  IF NOT EXISTS (
    SELECT 1 FROM public.leagues league
    JOIN public.league_seasons season ON season.league_id=league.id AND season.season=p_season
    JOIN public.league_source_connections connection ON connection.league_season_id=season.id
    WHERE league.id=p_league AND league.league_key='sleeper-'||p_external
      AND p_external ~ '^[1-9][0-9]{0,31}$' AND connection.provider='sleeper'
      AND connection.external_league_id=p_external
  ) THEN RAISE EXCEPTION 'onboarding registration mismatch'; END IF;
  IF EXISTS (SELECT 1 FROM public.league_administration_enrollments WHERE league_id=p_league
    AND evidence<>'account-onboarding-v1' AND NOT(evidence='public-data-intake-v1' AND NOT active)) THEN
    RAISE EXCEPTION 'enrollment is operator managed'; END IF;
  PERFORM public.assert_league_collection_capacity(p_external);
  INSERT INTO public.league_administration_enrollments(league_id,provider,active,evidence)
    VALUES(p_league,'sleeper',false,'account-onboarding-v1') ON CONFLICT DO NOTHING;
  INSERT INTO public.league_administration_enrollment_seasons(league_id,season,provider,evidence)
    VALUES(p_league,p_season,'sleeper','account-onboarding-v1') ON CONFLICT DO NOTHING;
  UPDATE public.league_administration_enrollments SET evidence='account-onboarding-v1'
    WHERE league_id=p_league AND evidence='public-data-intake-v1' AND NOT active;
  UPDATE public.league_administration_enrollment_seasons SET evidence='account-onboarding-v1'
    WHERE league_id=p_league AND season=p_season AND provider='sleeper' AND evidence='public-data-intake-v1';
END; $$;

REVOKE ALL ON public.public_data_intakes,public.public_data_identity_observations,public.public_data_league_lists,
  public.public_data_league_candidates,public.public_data_collection_reservations,public.public_data_rejections,public.public_data_dispatches,
  public.public_data_dispatch_outcomes FROM PUBLIC;
REVOKE ALL ON FUNCTION public.assert_public_data_owner(uuid,jsonb),public.fail_public_data_work(jsonb),
  public.assert_league_collection_capacity(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.submit_public_data_intake(jsonb),public.next_public_data_intake(uuid),
  public.guard_public_data_intake(jsonb,jsonb),public.recover_public_data_dispatch(uuid,jsonb),
  public.admit_public_data_dispatch(jsonb,jsonb),public.checkpoint_public_data_intake(jsonb,jsonb,jsonb) FROM PUBLIC;
DO $$ BEGIN
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='league_one_runtime') THEN
    REVOKE ALL ON FUNCTION public.assert_public_data_owner(uuid,jsonb),public.fail_public_data_work(jsonb),
      public.assert_league_collection_capacity(text) FROM league_one_runtime;
    GRANT SELECT ON public.public_data_intakes,public.public_data_identity_observations,public.public_data_league_lists,
      public.public_data_league_candidates,public.public_data_collection_reservations,public.public_data_rejections,public.public_data_dispatches,
      public.public_data_dispatch_outcomes TO league_one_runtime;
    GRANT EXECUTE ON FUNCTION public.submit_public_data_intake(jsonb),public.next_public_data_intake(uuid),
      public.guard_public_data_intake(jsonb,jsonb),public.recover_public_data_dispatch(uuid,jsonb),
      public.admit_public_data_dispatch(jsonb,jsonb),public.checkpoint_public_data_intake(jsonb,jsonb,jsonb) TO league_one_runtime;
  END IF;
END; $$;
