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

-- Fresh directory acquisition is separate from the deduplicated legacy observation.
CREATE TABLE public.public_data_directory_captures (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  intake_id uuid NOT NULL REFERENCES public.public_data_intakes(id),
  worker_id text NOT NULL, generation integer NOT NULL,
  league_season_id uuid NOT NULL REFERENCES public.league_seasons(id),
  source_mapping jsonb NOT NULL,
  content_id uuid NOT NULL REFERENCES public.league_administration_contents(id),
  legacy_observation_id uuid NOT NULL REFERENCES public.league_administration_observations(id),
  request_started_at timestamptz NOT NULL, request_completed_at timestamptz NOT NULL,
  source_observed_at timestamptz NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE(worker_id,generation),
  FOREIGN KEY(worker_id,generation) REFERENCES public.public_data_dispatches(worker_id,generation),
  CHECK(request_started_at<=request_completed_at AND source_observed_at=request_completed_at)
);
CREATE TRIGGER public_directory_capture_immutable BEFORE UPDATE OR DELETE ON public.public_data_directory_captures
  FOR EACH ROW EXECUTE FUNCTION public.prevent_league_administration_history_change();
ALTER TABLE public.public_data_league_candidates ADD COLUMN users_capture_id uuid REFERENCES public.public_data_directory_captures(id);
-- The original season membership remains immutable. Explicit adoption is mutable
-- authorization on the existing enrollment, bounded to individually selected seasons.
ALTER TABLE public.league_administration_enrollments ADD COLUMN data_adopted_seasons integer[] NOT NULL DEFAULT '{}'
  CHECK (1920<=ALL(data_adopted_seasons) AND 2200>=ALL(data_adopted_seasons) AND array_position(data_adopted_seasons,NULL) IS NULL);

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
  dispatch_row public.public_data_dispatches%ROWTYPE; directory jsonb; directory_content uuid; directory_capture_id uuid;
BEGIN
  PERFORM public.guard_public_data_intake(p_work,p_fence);
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
  UPDATE public.league_administration_enrollments SET evidence='account-onboarding-v1',
    data_adopted_seasons=CASE WHEN p_season=ANY(data_adopted_seasons) THEN data_adopted_seasons
      ELSE array_append(data_adopted_seasons,p_season) END
    WHERE league_id=p_league AND evidence IN ('public-data-intake-v1','account-onboarding-v1');
END; $$;

-- Effective029 lives behind the existing030-033 wrappers. Replace only that
-- installed inner function; applied migration files and outer wrappers stay intact.
CREATE OR REPLACE FUNCTION public.record_league_administration_observation_v29(p_input jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE result jsonb; addition jsonb; token jsonb; resource_key text;
  fields_value jsonb; coverage_reason text; manager_resource boolean; league_resource boolean;
  projected_team jsonb; team_identity uuid; manager_key text; manager_identity uuid;
  attempt public.league_roster_resource_attempts%ROWTYPE; head public.league_roster_resource_heads%ROWTYPE;
  content public.league_administration_contents%ROWTYPE;
  configuration public.league_administration_contents%ROWTYPE;
  receipt public.league_roster_capture_receipts%ROWTYPE;
  population jsonb; provenance jsonb:=p_input->'envelope'->'provenance';
  population_proof jsonb; evidence_hash_value text; reason_value text; acceptance_id uuid;
  expected_count integer; covered boolean:=false; observed_count integer; teams jsonb;
BEGIN
  -- Acquire the original job/source locks in their original order. Any subsequent
  -- qualification error rolls this call back, including its v1 effects.
  result:=public.record_league_administration_observation_v1(
    (p_input-'rosterAcceptance'-'teamManagerAcceptance'-'teamManagers'-'leagueSettingsAcceptance'-'leagueSettings')
      - CASE WHEN p_input->'envelope'->>'family'='league' THEN 'sourceMapping' ELSE '__no_removed_field__' END);
  FOREACH resource_key IN ARRAY ARRAY['rosterAcceptance','teamManagerAcceptance','leagueSettingsAcceptance'] LOOP
  addition:=p_input->resource_key;
  IF addition IS NULL THEN CONTINUE; END IF;
  token:=addition->'attempt';
  manager_resource:=resource_key='teamManagerAcceptance';
  league_resource:=resource_key='leagueSettingsAcceptance';
  fields_value:=CASE WHEN league_resource THEN '["league_id","season","sport"]'::jsonb WHEN manager_resource THEN '["owner_id"]'::jsonb ELSE '["players"]'::jsonb END;
  coverage_reason:=CASE WHEN league_resource THEN 'complete_league_identity_unproved' WHEN manager_resource THEN 'complete_primary_owner_population_unproved' ELSE 'complete_players_population_unproved' END;
  population:=addition->'population'; population_proof:=NULL; configuration:=NULL;
  covered:=false; expected_count:=NULL; observed_count:=NULL; reason_value:=NULL;
  IF p_input->'envelope'->>'family' IS DISTINCT FROM (CASE WHEN league_resource THEN 'league' ELSE 'rosters' END)
    OR p_input->'envelope'->'week' IS DISTINCT FROM 'null'::jsonb
    OR provenance->>'origin' IS DISTINCT FROM 'network'
    OR p_input->'sourceMapping' IS NULL THEN RAISE EXCEPTION 'current roster requires mapped network capture'; END IF;
  IF p_input->'envelope'->'scope' IS DISTINCT FROM p_input->'sourceMapping'->'scope' THEN
    RAISE EXCEPTION 'resource envelope mapping mismatch'; END IF;
  PERFORM public.validate_current_roster_mapping(p_input->'sourceMapping');
  SELECT * INTO STRICT attempt FROM public.league_roster_resource_attempts WHERE id=(token->>'id')::uuid;
  IF attempt.source_mapping IS DISTINCT FROM p_input->'sourceMapping'
    OR attempt.write_fence IS DISTINCT FROM p_input->'writeFence'
    OR token IS DISTINCT FROM jsonb_build_object('id',attempt.id,'scopeId',attempt.scope_id,
      'ordinal',attempt.ordinal,'expectedGeneration',attempt.expected_generation) THEN
    RAISE EXCEPTION 'current roster attempt scope mismatch';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM public.league_roster_resource_scopes scope WHERE scope.id=attempt.scope_id
    AND scope.identity->'scope'->>'coverageSpecId'=CASE WHEN league_resource THEN 'sleeper-league-identity-settings-v1' WHEN manager_resource
      THEN 'sleeper-current-all-teams-primary-owners-v1' ELSE 'sleeper-current-all-teams-players-v1' END) THEN
    RAISE EXCEPTION 'current roster resource attempt policy mismatch';
  END IF;
  SELECT * INTO STRICT head FROM public.league_roster_resource_heads WHERE scope_id=attempt.scope_id FOR UPDATE;
  -- v1 can replay before its final fence check. Recheck after every blocking lock.
  IF p_input->'writeFence' IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.projection_jobs job
    WHERE job.job_key=p_input->'writeFence'->>'jobKey' AND job.state='running'
      AND job.lease_owner=p_input->'writeFence'->>'workerId'
      AND job.attempt_count=(p_input->'writeFence'->>'generation')::integer
      AND job.lease_until>clock_timestamp()
      AND (p_input->'writeFence'->>'deadlineAt')::timestamptz>clock_timestamp()) THEN
    RAISE EXCEPTION 'current roster writer fence expired';
  END IF;
  evidence_hash_value:=encode(digest(convert_to(p_input::text,'UTF8'),'sha256'),'hex');
  SELECT * INTO receipt FROM public.league_roster_capture_receipts WHERE attempt_id=attempt.id;
  IF FOUND THEN
    IF receipt.evidence_hash<>evidence_hash_value THEN RAISE EXCEPTION 'current roster attempt receipt conflict'; END IF;
    result:=result||jsonb_build_object(resource_key,jsonb_build_object('status',
      CASE WHEN EXISTS(SELECT 1 FROM public.league_roster_resource_acceptances accepted
        WHERE accepted.id=head.accepted_id AND accepted.receipt_id=receipt.id)
        AND attempt.ordinal=head.latest_ordinal THEN 'accepted' ELSE 'preserved' END,
      'reason','exact_receipt_replay','receiptId',receipt.id,'acceptedGeneration',head.generation));
    CONTINUE;
  END IF;
  -- Bind exact content, never the possibly OLD observation ID returned by v1.
  SELECT * INTO STRICT content FROM public.league_administration_contents stored
    WHERE stored.league_season_id=(attempt.source_mapping->>'leagueSeasonId')::uuid
      AND stored.provider='sleeper' AND stored.external_league_id=attempt.source_mapping->'scope'->>'externalLeagueId'
      AND stored.family=CASE WHEN league_resource THEN 'league' ELSE 'rosters' END AND stored.week=0 AND stored.normalizer_version='sleeper-administration-v1'
      AND stored.content_hash=p_input->>'contentHash'
      AND stored.completeness=p_input->'envelope'->>'completeness'
      AND stored.accepted=(p_input->>'status'='accepted' AND p_input->'envelope'->>'completeness'='complete')
      AND stored.payload=p_input->'envelope'->'payload' AND stored.normalized_value IS NOT DISTINCT FROM p_input->'value';
  -- Prefer the independently captured network league document from this batch.
  -- Its mapping token was captured before that batch; retain its real provenance.
  IF league_resource THEN
    IF population IS NOT NULL THEN RAISE EXCEPTION 'league resource cannot borrow population'; END IF;
    configuration:=content;
    covered:=content.completeness='complete' AND jsonb_typeof(content.payload)='object'
      AND content.payload->'league_id'=to_jsonb(content.external_league_id)
      AND content.payload->'season'=to_jsonb(attempt.source_mapping->'scope'->>'season')
      AND content.payload->'sport'='"nfl"'::jsonb
      AND (provenance->>'sourceObservedAt')::timestamptz IS NOT NULL
      AND (provenance->>'requestStartedAt')::timestamptz>=attempt.reserved_at;
  ELSE
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
      OR (population->'envelope'->'provenance'->>'sourceObservedAt')::timestamptz IS NULL
      OR (population->'envelope'->'provenance'->>'checkedAt')::timestamptz IS NULL
      OR (population->'envelope'->'provenance'->>'requestStartedAt')::timestamptz>(population->'envelope'->'provenance'->>'requestCompletedAt')::timestamptz
      OR (population->'envelope'->'provenance'->>'requestCompletedAt')::timestamptz>(population->'envelope'->'provenance'->>'checkedAt')::timestamptz
      OR (population->'envelope'->'provenance'->>'sourceObservedAt')::timestamptz>(population->'envelope'->'provenance'->>'checkedAt')::timestamptz
      OR (population->'envelope'->'provenance'->>'checkedAt')::timestamptz>clock_timestamp()+interval '5 minutes' THEN
      RAISE EXCEPTION 'current roster population evidence scope mismatch';
    END IF;
    SELECT * INTO configuration FROM public.league_administration_contents stored
      WHERE stored.league_season_id=content.league_season_id AND stored.provider=content.provider
        AND stored.external_league_id=content.external_league_id AND stored.family='league' AND stored.week=0
        AND stored.normalizer_version='sleeper-administration-v1' AND stored.accepted AND stored.completeness='complete'
        AND stored.content_hash=population->>'contentHash' AND stored.payload=population->'envelope'->'payload'
        AND EXISTS(SELECT 1 FROM public.league_administration_observations observed
          WHERE observed.id=(population->>'observationId')::uuid AND observed.content_id=stored.id
            AND observed.league_season_id=stored.league_season_id AND observed.family='league' AND observed.week=0);
    population_proof:=jsonb_build_object('observationId',population->>'observationId',
      'contentHash',population->>'contentHash','provenance',population->'envelope'->'provenance');
  ELSE
    -- Existing changed-cache network verification may reuse independently retained
    -- count evidence only from an earlier exact receipt for this SAME revision.
    SELECT stored.* INTO configuration
      FROM public.league_roster_resource_acceptances accepted
      JOIN public.league_roster_capture_receipts prior ON prior.id=accepted.receipt_id
      JOIN public.league_administration_contents stored ON stored.id=prior.configuration_content_id
      WHERE accepted.id=head.accepted_id AND accepted.source_mapping_revision_id=(attempt.source_mapping->>'revisionId')::uuid;
    SELECT prior.population_evidence INTO population_proof FROM public.league_roster_resource_acceptances accepted
      JOIN public.league_roster_capture_receipts prior ON prior.id=accepted.receipt_id WHERE accepted.id=head.accepted_id
        AND accepted.source_mapping_revision_id=(attempt.source_mapping->>'revisionId')::uuid;
  END IF;
  expected_count:=(configuration.normalized_value->>'totalRosters')::integer;
  IF configuration.payload->>'total_rosters' IS DISTINCT FROM expected_count::text THEN expected_count:=NULL; END IF;
  -- Preserve existing calculation-compatible population. An independently accepted
  -- official settings receipt also qualifies a current scoring correction without
  -- changing the immutable calculation profile or clearing its legacy conflict.
  -- Other source conflicts, stale captures and remaps never gain this exception.
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
        AND (population IS NULL OR (settings_receipt.provenance=population_proof->'provenance'
          AND settings_attempt.write_fence IS NOT DISTINCT FROM attempt.write_fence
          AND settings_receipt.legacy_observation_id=(population_proof->>'observationId')::uuid))) THEN
    expected_count:=NULL;
  END IF;
  IF manager_resource THEN
    teams:=p_input->'teamManagers'->'teams';
    covered:=content.completeness='complete' AND expected_count>0
      AND public.qualify_team_manager_projection(content.payload,p_input->'teamManagers',
        content.external_league_id,expected_count);
    IF covered THEN
      -- Reuse canonical identities and immutable membership history, including when
      -- unrelated v1 player fields rejected this exact raw capture.
      FOR projected_team IN SELECT value FROM jsonb_array_elements(teams) LOOP
        INSERT INTO public.league_season_teams(league_season_id,provider,external_league_id,external_roster_id)
          VALUES(content.league_season_id,content.provider,content.external_league_id,projected_team->>'externalRosterId')
          ON CONFLICT DO NOTHING;
        SELECT id INTO STRICT team_identity FROM public.league_season_teams
          WHERE league_season_id=content.league_season_id AND provider=content.provider
            AND external_league_id=content.external_league_id AND external_roster_id=projected_team->>'externalRosterId';
        INSERT INTO public.league_team_manager_entries(content_id,normalizer_version,league_season_id,team_id,source_value)
          VALUES(content.id,'sleeper-current-team-managers-v1',content.league_season_id,team_identity,projected_team) ON CONFLICT DO NOTHING;
        IF NOT EXISTS(SELECT 1 FROM public.league_team_manager_entries WHERE content_id=content.id
          AND normalizer_version='sleeper-current-team-managers-v1' AND team_id=team_identity AND source_value=projected_team) THEN
          RAISE EXCEPTION 'team manager projection content conflict';
        END IF;
        FOR manager_key IN SELECT value FROM (
          SELECT projected_team->'primaryOwner'->>'externalManagerId' AS value
          WHERE projected_team->'primaryOwner'->>'state'='owned'
          UNION ALL SELECT jsonb_array_elements_text(projected_team->'coManagers'->'externalManagerIds')
          WHERE projected_team->'coManagers'->>'state'='known'
        ) managers LOOP
          INSERT INTO public.league_source_manager_accounts(provider,external_manager_id)
            VALUES(content.provider,manager_key) ON CONFLICT DO NOTHING;
          SELECT id INTO STRICT manager_identity FROM public.league_source_manager_accounts
            WHERE provider=content.provider AND external_manager_id=manager_key;
          INSERT INTO public.league_team_manager_memberships(content_id,normalizer_version,league_season_id,team_id,manager_id,role)
            VALUES(content.id,'sleeper-current-team-managers-v1',content.league_season_id,team_identity,manager_identity,
              CASE WHEN manager_key=projected_team->'primaryOwner'->>'externalManagerId' THEN 'owner' ELSE 'co_owner' END)
            ON CONFLICT DO NOTHING;
        END LOOP;
      END LOOP;
    END IF;
  ELSE
  teams:=content.normalized_value->'teams';
  IF content.accepted AND content.completeness='complete' AND expected_count>0 AND jsonb_typeof(teams)='array'
    AND jsonb_typeof(content.payload)='array' THEN
    observed_count:=jsonb_array_length(teams);
    covered:=observed_count=expected_count AND jsonb_array_length(content.payload)=expected_count
      AND (SELECT count(DISTINCT team->>'externalRosterId') FROM jsonb_array_elements(teams) team)=expected_count
      AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(teams) team
        WHERE jsonb_typeof(team->'playerExternalIds') IS DISTINCT FROM 'array'
          OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(content.payload) raw
            WHERE raw->>'roster_id'=team->>'externalRosterId' AND jsonb_typeof(raw->'players')='array'
              AND raw->'players'=team->'playerExternalIds'))
      AND (SELECT count(*) FROM public.league_administration_team_entries entry
        JOIN public.league_season_teams team ON team.id=entry.team_id AND team.league_season_id=entry.league_season_id
        WHERE entry.content_id=content.id AND entry.league_season_id=content.league_season_id
          AND team.provider=content.provider AND team.external_league_id=content.external_league_id
          AND entry.source_value=ANY(ARRAY(SELECT value FROM jsonb_array_elements(teams))))=expected_count;
  END IF;
  END IF;
  END IF; -- population qualification remains exclusive to roster policies
  reason_value:=CASE WHEN attempt.ordinal<>head.latest_ordinal THEN 'newer_network_attempt_reserved'
    WHEN attempt.expected_generation<>head.generation THEN 'accepted_generation_changed'
    WHEN NOT COALESCE(covered,false) THEN coverage_reason ELSE NULL END;
  INSERT INTO public.league_roster_capture_receipts(attempt_id,content_id,legacy_observation_id,evidence_hash,
    provenance,configuration_content_id,population_evidence,expected_team_count,coverage)
  VALUES(attempt.id,content.id,(result->>'observationId')::uuid,evidence_hash_value,provenance,
    configuration.id,population_proof,expected_count,
    jsonb_build_object('periodIds','[]'::jsonb,'interval',NULL,'entitySet',CASE WHEN covered THEN 'full' ELSE 'unknown' END,
      'fields',fields_value,'pagination','complete','nextCursor',NULL,
      'completeness',CASE WHEN covered THEN 'complete' ELSE 'unknown' END,
      'reasons',CASE WHEN covered THEN '[]'::jsonb ELSE jsonb_build_array(coverage_reason) END))
    RETURNING * INTO receipt;
  IF reason_value IS NULL THEN
    IF attempt.write_fence IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.projection_jobs job
      WHERE job.job_key=attempt.write_fence->>'jobKey' AND job.lease_until>clock_timestamp()
        AND (attempt.write_fence->>'deadlineAt')::timestamptz>clock_timestamp()) THEN
      RAISE EXCEPTION 'current roster writer fence expired';
    END IF;
    INSERT INTO public.league_roster_resource_acceptances(scope_id,receipt_id,source_mapping_revision_id,generation)
      VALUES(attempt.scope_id,receipt.id,(attempt.source_mapping->>'revisionId')::uuid,head.generation+1)
      RETURNING id INTO acceptance_id;
    UPDATE public.league_roster_resource_heads SET accepted_id=acceptance_id,generation=generation+1
      WHERE scope_id=attempt.scope_id RETURNING * INTO head;
  END IF;
  result:=result||jsonb_build_object(resource_key,jsonb_build_object('status',
    CASE WHEN reason_value IS NULL THEN 'accepted' ELSE 'preserved' END,'reason',reason_value,
    'receiptId',receipt.id,'acceptedGeneration',head.generation));
  END LOOP;
  RETURN result;
END; $$;

REVOKE ALL ON public.public_data_intakes,public.public_data_identity_observations,public.public_data_league_lists,
  public.public_data_league_candidates,public.public_data_collection_reservations,public.public_data_rejections,public.public_data_dispatches,
  public.public_data_dispatch_outcomes,public.public_data_directory_captures FROM PUBLIC;
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
      public.public_data_dispatch_outcomes,public.public_data_directory_captures TO league_one_runtime;
    GRANT EXECUTE ON FUNCTION public.submit_public_data_intake(jsonb),public.next_public_data_intake(uuid),
      public.guard_public_data_intake(jsonb,jsonb),public.recover_public_data_dispatch(uuid,jsonb),
      public.admit_public_data_dispatch(jsonb,jsonb),public.checkpoint_public_data_intake(jsonb,jsonb,jsonb) TO league_one_runtime;
  END IF;
END; $$;
