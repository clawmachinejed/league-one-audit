-- CP26 opt-in resource scheduling through the existing singleton DATA batch.
-- This metadata schedules existing intake work; it is not a second capture,
-- acceptance, history, provider, or reader pipeline. No elapsed SLA is qualified.
-- Four minutes is an internal scheduling hypothesis under the frozen five-minute gate.
CREATE FUNCTION public.public_data_resource_schedule_capability() RETURNS text
LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,public,pg_temp AS $$
  SELECT 'public-data-resource-schedule-v1'::text
$$;

ALTER TABLE public.public_data_intakes ADD COLUMN resource_occurrence_id uuid;
CREATE TRIGGER public_intake_resource_scope_immutable BEFORE UPDATE ON public.public_data_intakes
  FOR EACH ROW EXECUTE FUNCTION public.prevent_projection_stable_field_change('resource_occurrence_id');

CREATE TABLE public.public_data_resource_configurations (
  target_id uuid NOT NULL, configuration_revision bigint NOT NULL, active_periods jsonb NOT NULL,
  configured_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY(target_id,configuration_revision),
  FOREIGN KEY(target_id,configuration_revision) REFERENCES public.public_data_refresh_configurations(target_id,revision)
);
CREATE TABLE public.public_data_resources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  connection_id uuid NOT NULL REFERENCES public.league_source_connections(id),
  mapping_revision_id uuid NOT NULL REFERENCES public.league_source_mapping_revisions(id),
  source_mapping jsonb NOT NULL, season integer NOT NULL CHECK(season=2026),
  external_league_id text NOT NULL, kind text NOT NULL CHECK(kind IN ('core','exact-matchups','transactions')),
  native_week integer NOT NULL CHECK(native_week BETWEEN 0 AND 18),
  due_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  last_success_at timestamptz, last_success_receipt_id uuid REFERENCES public.league_roster_capture_receipts(id),
  next_eligible_at timestamptz NOT NULL DEFAULT clock_timestamp(), failure_count integer NOT NULL DEFAULT 0 CHECK(failure_count BETWEEN 0 AND 7),
  last_served_at timestamptz, open_intake_id uuid REFERENCES public.public_data_intakes(id),
  UNIQUE(connection_id,mapping_revision_id,kind,native_week),
  CHECK((kind='core')=(native_week=0)),
  CHECK((last_success_at IS NULL)=(last_success_receipt_id IS NULL))
);
CREATE TABLE public.public_data_resource_authorities (
  resource_id uuid NOT NULL REFERENCES public.public_data_resources(id),
  target_id uuid NOT NULL, configuration_revision bigint NOT NULL,
  origin_intake_id uuid NOT NULL, season integer NOT NULL, external_league_id text NOT NULL,
  active_native_week integer NOT NULL CHECK(active_native_week BETWEEN 1 AND 18),
  PRIMARY KEY(resource_id,target_id,configuration_revision),
  FOREIGN KEY(target_id,configuration_revision) REFERENCES public.public_data_resource_configurations(target_id,configuration_revision),
  FOREIGN KEY(origin_intake_id,season,external_league_id) REFERENCES public.public_data_league_candidates(intake_id,season,external_league_id)
);
CREATE TABLE public.public_data_resource_occurrences (
  id uuid PRIMARY KEY REFERENCES public.public_data_intakes(id) DEFERRABLE INITIALLY DEFERRED,
  resource_id uuid NOT NULL REFERENCES public.public_data_resources(id),
  origin_intake_id uuid NOT NULL, season integer NOT NULL, external_league_id text NOT NULL,
  target_id uuid NOT NULL, configuration_revision bigint NOT NULL,
  source_mapping jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  FOREIGN KEY(origin_intake_id,season,external_league_id) REFERENCES public.public_data_league_candidates(intake_id,season,external_league_id),
  FOREIGN KEY(resource_id,target_id,configuration_revision) REFERENCES public.public_data_resource_authorities(resource_id,target_id,configuration_revision)
);
ALTER TABLE public.public_data_intakes ADD CONSTRAINT public_intake_resource_occurrence
  FOREIGN KEY(resource_occurrence_id) REFERENCES public.public_data_resource_occurrences(id) DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE public.public_data_intakes ADD CONSTRAINT public_intake_resource_identity CHECK(resource_occurrence_id IS NULL OR resource_occurrence_id=id);
CREATE TABLE public.public_data_resource_selections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), worker_id text NOT NULL, generation integer NOT NULL,
  intake_id uuid NOT NULL REFERENCES public.public_data_intakes(id),
  lane text NOT NULL CHECK(lane IN ('active','history')),
  resource_id uuid REFERENCES public.public_data_resources(id), target_id uuid,
  configuration_revision bigint, selected_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE(worker_id,generation),
  FOREIGN KEY(target_id,configuration_revision) REFERENCES public.public_data_refresh_configurations(target_id,revision),
  CHECK((lane='active')=(resource_id IS NOT NULL)),
  CHECK((target_id IS NULL)=(configuration_revision IS NULL)),
  CHECK(lane<>'active' OR target_id IS NOT NULL)
);
CREATE TABLE public.public_data_resource_selection_failures (
  selection_id uuid PRIMARY KEY REFERENCES public.public_data_resource_selections(id),
  reason text NOT NULL CHECK(reason IN ('selection-failed','request-state-failed','admission-unconfirmed')),
  recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(), next_eligible_at timestamptz NOT NULL
);
CREATE TABLE public.public_data_history_service (
  intake_id uuid PRIMARY KEY REFERENCES public.public_data_intakes(id),
  reserved_http bigint NOT NULL DEFAULT 0 CHECK(reserved_http>=0), last_served_at timestamptz,
  next_eligible_at timestamptz NOT NULL DEFAULT clock_timestamp(), failure_count integer NOT NULL DEFAULT 0 CHECK(failure_count BETWEEN 0 AND 7)
);
CREATE TABLE public.public_data_resource_service (
  singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),
  history_credit integer NOT NULL DEFAULT 0 CHECK(history_credit BETWEEN 0 AND 10),
  active_reserved_http bigint NOT NULL DEFAULT 0 CHECK(active_reserved_http>=0),
  history_reserved_http bigint NOT NULL DEFAULT 0 CHECK(history_reserved_http>=0)
);
INSERT INTO public.public_data_resource_service(singleton) VALUES(true);
CREATE INDEX public_data_resources_due ON public.public_data_resources(due_at,last_served_at,id);
CREATE INDEX public_data_resource_selections_request ON public.public_data_resource_selections(intake_id,selected_at);
DO $$ DECLARE name text; BEGIN
  FOREACH name IN ARRAY ARRAY['public_data_resource_configurations','public_data_resource_authorities',
    'public_data_resource_occurrences','public_data_resource_selections','public_data_resource_selection_failures'] LOOP
    EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.prevent_league_administration_history_change()',name||'_immutable',name);
  END LOOP;
END; $$;
CREATE TRIGGER public_resource_identity_immutable BEFORE UPDATE ON public.public_data_resources
  FOR EACH ROW EXECUTE FUNCTION public.prevent_projection_stable_field_change('id','connection_id','mapping_revision_id','source_mapping','season','external_league_id','kind','native_week');
CREATE TRIGGER public_resource_no_delete BEFORE DELETE ON public.public_data_resources
  FOR EACH ROW EXECUTE FUNCTION public.prevent_league_administration_history_change();

CREATE FUNCTION public.public_data_resource_selection_json(p_selection public.public_data_resource_selections) RETURNS jsonb
LANGUAGE sql STABLE SET search_path=pg_catalog,public,pg_temp AS $$
 SELECT jsonb_build_object('status','selected','selectionId',p_selection.id,'requestId',p_selection.intake_id,
   'lane',p_selection.lane,'resourceId',p_selection.resource_id,'configurationRevision',p_selection.configuration_revision)
$$;
CREATE FUNCTION public.assert_public_data_resource_owner(p_fence jsonb) RETURNS void
LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
  PERFORM public.assert_public_data_batch_owner(p_fence);
  IF NOT EXISTS(SELECT 1 FROM public.projection_jobs WHERE job_key=p_fence->>'jobKey'
    AND payload->>'schedulingPolicy'='public-data-resource-schedule-v1' AND payload->>'batchMode'='recurring') THEN
    RAISE EXCEPTION 'explicit public resource scheduling owner required'; END IF;
END; $$;
CREATE FUNCTION public.begin_public_data_resource_batch(p_worker text,p_invocation_started_at timestamptz) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE result jsonb;
BEGIN
  result:=public.begin_public_data_batch(p_worker,p_invocation_started_at,NULL);
  IF result->>'kind'='acquired' THEN
    UPDATE public.projection_jobs SET payload=payload||jsonb_build_object('schedulingPolicy','public-data-resource-schedule-v1')
      WHERE job_key='league-administration-public-intake' AND lease_owner=p_worker AND attempt_count=(result->'fence'->>'generation')::integer;
    PERFORM public.assert_public_data_resource_owner(result->'fence');
  END IF;
  RETURN result;
END; $$;

-- Current provider activity is evidence, not calendar inference. A changed or
-- unknown period leaves this authority ineligible until an explicit new approval.
CREATE FUNCTION public.public_data_resource_authority_valid(p_resource uuid,p_target uuid,p_revision bigint) RETURNS boolean
LANGUAGE sql STABLE SET search_path=pg_catalog,public,pg_temp AS $$
 SELECT EXISTS(SELECT 1 FROM public.public_data_resource_authorities authority
 JOIN public.public_data_resources resource ON resource.id=authority.resource_id
 JOIN public.public_data_refresh_targets target ON target.id=authority.target_id AND target.configuration_revision=authority.configuration_revision
 JOIN public.public_data_refresh_configurations configuration ON configuration.target_id=target.id AND configuration.revision=target.configuration_revision
 JOIN public.league_source_connections connection ON connection.id=resource.connection_id AND connection.current_mapping_revision_id=resource.mapping_revision_id
 JOIN public.league_administration_heads head ON head.league_season_id=connection.league_season_id AND head.family='league' AND head.week=0
 JOIN public.league_administration_observations observed ON observed.id=head.accepted_observation_id
 JOIN public.league_administration_contents content ON content.id=observed.content_id
 WHERE authority.resource_id=p_resource AND authority.target_id=p_target AND authority.configuration_revision=p_revision
 AND NOT configuration.paused AND configuration.expires_at>clock_timestamp()
 AND head.read_conflict IS NULL AND content.accepted AND content.completeness='complete'
 AND content.payload->>'status'='in_season'
 AND content.payload->'settings'->>'leg'=authority.active_native_week::text)
$$;

CREATE FUNCTION public.configure_public_data_resource_schedule(p_input jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE target public.public_data_refresh_targets%ROWTYPE; configuration public.public_data_refresh_configurations%ROWTYPE;
  item jsonb; canonical jsonb; retained jsonb; candidate public.public_data_league_candidates%ROWTYPE;
  mapping jsonb; kind_value text; resource_id_value uuid; current_week integer; target_id_value uuid; revision_value bigint;
BEGIN
  IF jsonb_typeof(p_input) IS DISTINCT FROM 'object' OR (SELECT count(*) FROM jsonb_object_keys(p_input))<>3
    OR NOT(p_input ?& ARRAY['targetId','expectedRevision','activePeriods'])
    OR jsonb_typeof(p_input->'targetId') IS DISTINCT FROM 'string'
    OR jsonb_typeof(p_input->'expectedRevision') IS DISTINCT FROM 'number'
    OR p_input->>'expectedRevision' !~ '^[1-9][0-9]*$'
    OR jsonb_typeof(p_input->'activePeriods') IS DISTINCT FROM 'array'
    OR jsonb_array_length(p_input->'activePeriods')>20 THEN RAISE EXCEPTION 'invalid public resource configuration'; END IF;
  target_id_value:=(p_input->>'targetId')::uuid; revision_value:=(p_input->>'expectedRevision')::bigint;
  SELECT * INTO STRICT target FROM public.public_data_refresh_targets WHERE id=target_id_value FOR UPDATE;
  IF target.configuration_revision<>revision_value THEN RAISE EXCEPTION 'public resource approval changed'; END IF;
  SELECT * INTO STRICT configuration FROM public.public_data_refresh_configurations WHERE target_id=target.id AND revision=revision_value;
  IF configuration.paused OR configuration.expires_at<=clock_timestamp() OR EXISTS(
    SELECT 1 FROM public.public_data_intakes WHERE id=configuration.identity_request_id AND resource_occurrence_id IS NOT NULL) THEN
    RAISE EXCEPTION 'current ordinary public approval required'; END IF;
  FOR item IN SELECT value FROM jsonb_array_elements(p_input->'activePeriods') LOOP
    IF jsonb_typeof(item) IS DISTINCT FROM 'object' OR (SELECT count(*) FROM jsonb_object_keys(item))<>3
      OR NOT(item ?& ARRAY['season','externalLeagueId','nativeWeek']) OR item->'season' IS DISTINCT FROM '2026'::jsonb
      OR jsonb_typeof(item->'externalLeagueId') IS DISTINCT FROM 'string' OR item->>'externalLeagueId' !~ '^[1-9][0-9]{0,31}$'
      OR jsonb_typeof(item->'nativeWeek') IS DISTINCT FROM 'number' OR item->>'nativeWeek' !~ '^([1-9]|1[0-8])$'
      OR NOT(2026=ANY(configuration.seasons))
      OR NOT(configuration.exact_periods @> jsonb_build_array(jsonb_build_object('season',2026,'nativeWeek',(item->>'nativeWeek')::integer)))
      OR configuration.transaction_history IS NULL THEN RAISE EXCEPTION 'active period outside approved public source scope'; END IF;
  END LOOP;
  IF (SELECT count(*) FROM jsonb_array_elements(p_input->'activePeriods'))<>(SELECT count(DISTINCT value->>'externalLeagueId') FROM jsonb_array_elements(p_input->'activePeriods')) THEN
    RAISE EXCEPTION 'duplicate active public league'; END IF;
  SELECT COALESCE(jsonb_agg(value ORDER BY value->>'externalLeagueId'),'[]'::jsonb) INTO canonical FROM jsonb_array_elements(p_input->'activePeriods');
  SELECT active_periods INTO retained FROM public.public_data_resource_configurations WHERE target_id=target.id AND configuration_revision=revision_value;
  IF FOUND THEN
    IF retained IS DISTINCT FROM canonical THEN RAISE EXCEPTION 'public resource configuration replay mismatch'; END IF;
    RETURN jsonb_build_object('targetId',target.id,'configurationRevision',revision_value);
  END IF;
  INSERT INTO public.public_data_resource_configurations(target_id,configuration_revision,active_periods) VALUES(target.id,revision_value,canonical);
  FOR item IN SELECT value FROM jsonb_array_elements(canonical) LOOP
    SELECT * INTO STRICT candidate FROM public.public_data_league_candidates WHERE intake_id=configuration.identity_request_id
      AND season=2026 AND external_league_id=item->>'externalLeagueId' AND stage IN ('users','complete')
      AND settings_receipt_id IS NOT NULL AND players_receipt_id IS NOT NULL AND managers_receipt_id IS NOT NULL;
    IF NOT EXISTS(SELECT 1 FROM public.public_data_league_lists list, LATERAL jsonb_array_elements(list.payload) entry
      WHERE list.intake_id=candidate.intake_id AND list.season=candidate.season AND entry->>'league_id'=candidate.external_league_id
      AND entry->>'season'=candidate.season::text AND entry->>'sport'='nfl') THEN RAISE EXCEPTION 'accepted public discovery required'; END IF;
    SELECT jsonb_build_object('connectionId',connection.id,'leagueSeasonId',season.id,
      'revisionId',connection.current_mapping_revision_id,'generation',connection.mapping_generation,
      'scope',jsonb_build_object('leagueKey',league.league_key,'season',season.season,'provider','sleeper','externalLeagueId',connection.external_league_id))
      INTO STRICT mapping FROM public.league_source_connections connection JOIN public.league_seasons season ON season.id=connection.league_season_id
      JOIN public.leagues league ON league.id=season.league_id
      WHERE connection.provider='sleeper' AND connection.league_season_id=candidate.league_season_id AND connection.external_league_id=candidate.external_league_id;
    PERFORM public.validate_current_roster_mapping(mapping);
    current_week:=(item->>'nativeWeek')::integer;
    FOREACH kind_value IN ARRAY ARRAY['core','exact-matchups','transactions'] LOOP
      INSERT INTO public.public_data_resources(connection_id,mapping_revision_id,source_mapping,season,external_league_id,kind,native_week)
        VALUES((mapping->>'connectionId')::uuid,(mapping->>'revisionId')::uuid,mapping,2026,candidate.external_league_id,kind_value,
          CASE WHEN kind_value='core' THEN 0 ELSE current_week END)
        ON CONFLICT(connection_id,mapping_revision_id,kind,native_week) DO NOTHING;
      SELECT id INTO STRICT resource_id_value FROM public.public_data_resources WHERE connection_id=(mapping->>'connectionId')::uuid
        AND mapping_revision_id=(mapping->>'revisionId')::uuid AND kind=kind_value AND native_week=CASE WHEN kind_value='core' THEN 0 ELSE current_week END;
      INSERT INTO public.public_data_resource_authorities(resource_id,target_id,configuration_revision,origin_intake_id,season,external_league_id,active_native_week)
        VALUES(resource_id_value,target.id,revision_value,candidate.intake_id,2026,candidate.external_league_id,current_week);
      IF NOT public.public_data_resource_authority_valid(resource_id_value,target.id,revision_value) THEN
        RAISE EXCEPTION 'provider activity unknown, dormant, or current period changed'; END IF;
    END LOOP;
  END LOOP;
  -- Configuring/replaying/changing approval NEVER resets canonical due clocks or service debt.
  RETURN jsonb_build_object('targetId',target.id,'configurationRevision',revision_value);
END; $$;


-- Existing tables need dependency rows for their FK graph. These placeholders
-- contain NO provider response: immutable origin FKs resolve the real payloads.
-- They never enter ordinary readers, identity approval, backlog or capture credit.
CREATE FUNCTION public.validate_public_data_resource_occurrence() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE occurrence public.public_data_resource_occurrences%ROWTYPE; origin public.public_data_league_candidates%ROWTYPE;
  resource public.public_data_resources%ROWTYPE; identity_row public.public_data_identity_observations%ROWTYPE;
  original_identity public.public_data_identity_observations%ROWTYPE; list_row public.public_data_league_lists%ROWTYPE;
  original_list public.public_data_league_lists%ROWTYPE;
BEGIN
  IF NEW.resource_occurrence_id IS NULL THEN RETURN NEW; END IF;
  SELECT * INTO STRICT occurrence FROM public.public_data_resource_occurrences WHERE id=NEW.id;
  SELECT * INTO STRICT origin FROM public.public_data_league_candidates WHERE intake_id=occurrence.origin_intake_id
    AND season=occurrence.season AND external_league_id=occurrence.external_league_id;
  SELECT * INTO STRICT resource FROM public.public_data_resources WHERE id=occurrence.resource_id;
  SELECT * INTO STRICT identity_row FROM public.public_data_identity_observations WHERE intake_id=NEW.id;
  SELECT * INTO STRICT original_identity FROM public.public_data_identity_observations WHERE intake_id=origin.intake_id;
  SELECT * INTO STRICT list_row FROM public.public_data_league_lists WHERE intake_id=NEW.id AND season=origin.season;
  SELECT * INTO STRICT original_list FROM public.public_data_league_lists WHERE intake_id=origin.intake_id AND season=origin.season;
  IF NEW.id<>NEW.resource_occurrence_id OR occurrence.source_mapping IS DISTINCT FROM resource.source_mapping
    OR NEW.seasons IS DISTINCT FROM ARRAY[origin.season]
    OR EXISTS(SELECT 1 FROM public.public_data_intakes WHERE id=origin.intake_id AND resource_occurrence_id IS NOT NULL)
    OR original_identity.source_manager_account_id IS DISTINCT FROM identity_row.source_manager_account_id
    OR identity_row.payload IS DISTINCT FROM jsonb_build_object('inheritedFromIntakeId',origin.intake_id,'resourceOccurrenceId',NEW.id)
    OR identity_row.request_started_at IS DISTINCT FROM original_identity.request_started_at
    OR identity_row.request_completed_at IS DISTINCT FROM original_identity.request_completed_at
    OR list_row.payload IS DISTINCT FROM '[]'::jsonb
    OR list_row.request_started_at IS DISTINCT FROM original_list.request_started_at
    OR list_row.request_completed_at IS DISTINCT FROM original_list.request_completed_at
    OR (SELECT count(*) FROM public.public_data_league_candidates WHERE intake_id=NEW.id)<>1
    OR NOT EXISTS(SELECT 1 FROM public.public_data_league_candidates WHERE intake_id=NEW.id
      AND season=origin.season AND external_league_id=origin.external_league_id AND league_season_id=origin.league_season_id)
    OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(original_list.payload) entry
      WHERE entry->>'league_id'=origin.external_league_id AND entry->>'season'=origin.season::text AND entry->>'sport'='nfl')
    THEN RAISE EXCEPTION 'invalid inherited public resource occurrence'; END IF;
  RETURN NEW;
END; $$;
CREATE CONSTRAINT TRIGGER public_resource_occurrence_lineage AFTER INSERT ON public.public_data_intakes
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.validate_public_data_resource_occurrence();

ALTER FUNCTION public.next_public_data_intake(uuid) RENAME TO next_public_data_intake_v58;
CREATE FUNCTION public.next_public_data_intake(p_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE request public.public_data_intakes%ROWTYPE; resource public.public_data_resources%ROWTYPE;
  candidate public.public_data_league_candidates%ROWTYPE; task_status text; result jsonb;
BEGIN
 SELECT * INTO STRICT request FROM public.public_data_intakes WHERE id=p_id;
 IF request.resource_occurrence_id IS NULL THEN RETURN public.next_public_data_intake_v58(p_id); END IF;
 SELECT resource_row.* INTO STRICT resource FROM public.public_data_resource_occurrences occurrence
   JOIN public.public_data_resources resource_row ON resource_row.id=occurrence.resource_id WHERE occurrence.id=p_id;
 SELECT * INTO STRICT candidate FROM public.public_data_league_candidates WHERE intake_id=p_id;
 IF resource.kind='core' THEN
   task_status:=CASE candidate.stage WHEN 'core' THEN 'pending' WHEN 'users' THEN 'complete' ELSE 'unavailable' END;
 ELSIF resource.kind='exact-matchups' THEN
   SELECT status INTO STRICT task_status FROM public.public_data_exact_period_tasks WHERE intake_id=p_id AND ordinal=1;
 ELSE
   SELECT status INTO STRICT task_status FROM public.public_data_transaction_tasks WHERE intake_id=p_id AND ordinal=1;
 END IF;
 IF task_status='complete' THEN RETURN '"complete"'::jsonb; END IF;
 -- Keep the existing fail/checkpoint terminalization contract: exhausted scope is partial.
 IF task_status<>'pending' OR request.terminal THEN RETURN '"partial"'::jsonb; END IF;
 IF request.next_attempt_at>clock_timestamp() THEN RETURN '"backoff"'::jsonb; END IF;
 result:=jsonb_build_object('requestId',p_id,'revision',request.revision,'kind',resource.kind,
   'externalLeagueId',resource.external_league_id,'season',resource.season);
 IF resource.kind<>'core' THEN result:=result||jsonb_build_object('nativeWeek',resource.native_week); END IF;
 -- No identity, discovery, bootstrap, users or sibling family is fabricated.
 RETURN result;
END; $$;

CREATE FUNCTION public.seed_public_data_resource_occurrence(p_resource uuid,p_target uuid,p_revision bigint,p_fence jsonb) RETURNS uuid
LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE resource public.public_data_resources%ROWTYPE; authority public.public_data_resource_authorities%ROWTYPE;
  origin public.public_data_league_candidates%ROWTYPE; request_id uuid:=gen_random_uuid();
BEGIN
 PERFORM public.assert_public_data_resource_owner(p_fence);
 SELECT * INTO STRICT resource FROM public.public_data_resources WHERE id=p_resource FOR UPDATE;
 SELECT * INTO STRICT authority FROM public.public_data_resource_authorities
   WHERE resource_id=p_resource AND target_id=p_target AND configuration_revision=p_revision;
 IF NOT public.public_data_resource_authority_valid(p_resource,p_target,p_revision) THEN RAISE EXCEPTION 'resource authority changed'; END IF;
 IF resource.open_intake_id IS NOT NULL AND EXISTS(SELECT 1 FROM public.public_data_intakes WHERE id=resource.open_intake_id AND NOT terminal) THEN
   RETURN resource.open_intake_id; END IF;
 SELECT * INTO STRICT origin FROM public.public_data_league_candidates WHERE intake_id=authority.origin_intake_id
   AND season=authority.season AND external_league_id=authority.external_league_id;
 IF EXISTS(SELECT 1 FROM public.public_data_intakes WHERE id=origin.intake_id AND resource_occurrence_id IS NOT NULL) THEN
   RAISE EXCEPTION 'resource occurrence cannot be an origin'; END IF;
 PERFORM public.validate_current_roster_mapping(resource.source_mapping);
 INSERT INTO public.public_data_resource_occurrences(id,resource_id,origin_intake_id,season,external_league_id,target_id,configuration_revision,source_mapping)
   VALUES(request_id,resource.id,origin.intake_id,origin.season,origin.external_league_id,p_target,p_revision,resource.source_mapping);
 INSERT INTO public.public_data_intakes(id,username,seasons,exact_periods,transaction_period,resource_occurrence_id)
   SELECT request_id,username,ARRAY[origin.season],
     CASE WHEN resource.kind='exact-matchups' THEN jsonb_build_array(jsonb_build_object('season',origin.season,'nativeWeek',resource.native_week)) ELSE '[]'::jsonb END,
     CASE WHEN resource.kind='transactions' THEN jsonb_build_object('season',origin.season,'nativeWeek',resource.native_week) ELSE NULL END,request_id
   FROM public.public_data_intakes WHERE id=origin.intake_id;
 INSERT INTO public.public_data_identity_observations(intake_id,source_manager_account_id,username,display_name,avatar_url,payload,request_started_at,request_completed_at)
   SELECT request_id,source_manager_account_id,username,display_name,avatar_url,
     jsonb_build_object('inheritedFromIntakeId',origin.intake_id,'resourceOccurrenceId',request_id),request_started_at,request_completed_at
   FROM public.public_data_identity_observations WHERE intake_id=origin.intake_id;
 INSERT INTO public.public_data_league_lists(intake_id,season,payload,request_started_at,request_completed_at)
   SELECT request_id,season,'[]'::jsonb,request_started_at,request_completed_at FROM public.public_data_league_lists
     WHERE intake_id=origin.intake_id AND season=origin.season;
 INSERT INTO public.public_data_league_candidates(intake_id,season,external_league_id,name,stage,league_season_id,bootstrap_started_at,bootstrap_completed_at)
   VALUES(request_id,origin.season,origin.external_league_id,origin.name,CASE WHEN resource.kind='core' THEN 'core' ELSE 'complete' END,
     origin.league_season_id,origin.bootstrap_started_at,origin.bootstrap_completed_at);
 IF resource.kind='exact-matchups' THEN
   INSERT INTO public.public_data_exact_period_tasks(intake_id,ordinal,season,external_league_id,native_week)
     VALUES(request_id,1,origin.season,origin.external_league_id,resource.native_week);
 ELSIF resource.kind='transactions' THEN
   INSERT INTO public.public_data_transaction_tasks(intake_id,ordinal,season,external_league_id,native_week,write_fence)
     VALUES(request_id,1,origin.season,origin.external_league_id,resource.native_week,p_fence);
 END IF;
 UPDATE public.public_data_resources SET open_intake_id=request_id WHERE id=resource.id;
 RETURN request_id;
END; $$;

-- Reconcile only existing checkpoint/receipt identities. No new acceptance receipt
-- is created, and inherited identity/list timestamps never influence due clocks.
CREATE FUNCTION public.reconcile_public_data_resource_request(p_request uuid) RETURNS void
LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE occurrence public.public_data_resource_occurrences%ROWTYPE; resource public.public_data_resources%ROWTYPE;
  request public.public_data_intakes%ROWTYPE; receipt_id uuid; observed_at timestamptz;
BEGIN
 SELECT * INTO occurrence FROM public.public_data_resource_occurrences WHERE id=p_request;
 IF NOT FOUND THEN RETURN; END IF;
 SELECT * INTO STRICT request FROM public.public_data_intakes WHERE id=p_request;
 SELECT * INTO STRICT resource FROM public.public_data_resources WHERE id=occurrence.resource_id FOR UPDATE;
 IF resource.open_intake_id IS DISTINCT FROM p_request THEN RETURN; END IF;
 IF public.next_public_data_intake(p_request)='"complete"'::jsonb THEN
   IF resource.kind='core' THEN SELECT players_receipt_id INTO receipt_id FROM public.public_data_league_candidates WHERE intake_id=p_request;
   ELSIF resource.kind='exact-matchups' THEN SELECT matchups_receipt_id INTO receipt_id FROM public.public_data_exact_period_checkpoints WHERE intake_id=p_request AND task_ordinal=1;
   ELSE SELECT transaction_receipt_id INTO receipt_id FROM public.public_data_transaction_checkpoints WHERE intake_id=p_request AND task_ordinal=1; END IF;
   SELECT (receipt.provenance->>'sourceObservedAt')::timestamptz INTO STRICT observed_at FROM public.league_roster_capture_receipts receipt
     JOIN public.league_roster_resource_attempts attempt ON attempt.id=receipt.attempt_id
     JOIN public.public_data_dispatches dispatch ON dispatch.worker_id=attempt.write_fence->>'workerId'
       AND dispatch.generation=(attempt.write_fence->>'generation')::integer AND dispatch.intake_id=p_request
     JOIN public.public_data_dispatch_outcomes outcome ON outcome.worker_id=dispatch.worker_id AND outcome.generation=dispatch.generation AND outcome.outcome='checkpoint-committed'
     WHERE receipt.id=receipt_id AND attempt.source_mapping=resource.source_mapping AND receipt.provenance->>'origin'='network'
       AND receipt.provenance->>'sourceObservedAt'=receipt.provenance->>'requestCompletedAt';
   IF observed_at IS NULL OR NOT isfinite(observed_at) OR observed_at>clock_timestamp() THEN RAISE EXCEPTION 'resource successful source clock required'; END IF;
   UPDATE public.public_data_resources SET last_success_at=observed_at,last_success_receipt_id=receipt_id,
     due_at=observed_at+interval '4 minutes',next_eligible_at=clock_timestamp(),failure_count=0,open_intake_id=NULL WHERE id=resource.id;
 ELSIF request.terminal THEN
   UPDATE public.public_data_resources SET open_intake_id=NULL,failure_count=least(7,failure_count+1),
     next_eligible_at=clock_timestamp()+interval '60 seconds' WHERE id=resource.id;
 ELSE
   UPDATE public.public_data_resources SET next_eligible_at=request.next_attempt_at,failure_count=least(7,request.failure_count) WHERE id=resource.id;
 END IF;
END; $$;

ALTER FUNCTION public.checkpoint_public_data_intake(jsonb,jsonb,jsonb) RENAME TO checkpoint_public_data_intake_v58;
CREATE FUNCTION public.checkpoint_public_data_intake(p_work jsonb,p_capture jsonb,p_fence jsonb) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
 PERFORM public.checkpoint_public_data_intake_v58(p_work,p_capture,p_fence);
 PERFORM public.reconcile_public_data_resource_request((p_work->>'requestId')::uuid);
END; $$;
ALTER FUNCTION public.recover_public_data_dispatch(uuid,jsonb) RENAME TO recover_public_data_dispatch_v58;
CREATE FUNCTION public.recover_public_data_dispatch(p_selected uuid,p_fence jsonb) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE prior_request uuid;
BEGIN
 SELECT intake_id INTO prior_request FROM public.public_data_dispatches dispatch WHERE NOT EXISTS(
   SELECT 1 FROM public.public_data_dispatch_outcomes outcome WHERE outcome.worker_id=dispatch.worker_id AND outcome.generation=dispatch.generation)
   ORDER BY admitted_at,worker_id,generation LIMIT 1;
 PERFORM public.recover_public_data_dispatch_v58(p_selected,p_fence);
 IF prior_request IS NOT NULL THEN PERFORM public.reconcile_public_data_resource_request(prior_request); END IF;
END; $$;



CREATE FUNCTION public.public_data_history_authority_valid(p_request uuid) RETURNS boolean
LANGUAGE sql STABLE SET search_path=pg_catalog,public,pg_temp AS $$
 SELECT EXISTS(SELECT 1 FROM public.public_data_intakes request
 LEFT JOIN public.public_data_refresh_cycles cycle ON cycle.intake_id=request.id
 LEFT JOIN public.public_data_refresh_targets target ON target.id=cycle.target_id
 LEFT JOIN public.public_data_refresh_configurations current_config ON current_config.target_id=target.id AND current_config.revision=target.configuration_revision
 LEFT JOIN public.public_data_refresh_configurations cycle_config ON cycle_config.target_id=cycle.target_id AND cycle_config.revision=cycle.configuration_revision
 WHERE request.id=p_request AND request.resource_occurrence_id IS NULL
 AND (cycle.intake_id IS NULL OR (
   target.current_cycle=cycle.cycle AND NOT current_config.paused AND current_config.expires_at>clock_timestamp()
   AND target.selection_next_eligible_at<=clock_timestamp()
   AND request.username=(SELECT external_manager_id FROM public.league_source_manager_accounts WHERE id=target.source_manager_account_id AND provider=target.provider)
   AND request.seasons=current_config.seasons AND request.seasons=cycle_config.seasons
   AND request.transaction_period IS NULL
   AND request.exact_periods=current_config.exact_periods AND request.exact_periods=cycle_config.exact_periods
   AND request.period_inventory IS NOT DISTINCT FROM current_config.period_inventory AND request.period_inventory IS NOT DISTINCT FROM cycle_config.period_inventory
   AND request.playoff_brackets IS NOT DISTINCT FROM current_config.playoff_brackets AND request.playoff_brackets IS NOT DISTINCT FROM cycle_config.playoff_brackets
   AND request.weekly_reports=current_config.weekly_reports AND request.weekly_reports=cycle_config.weekly_reports
   AND request.transaction_history IS NOT DISTINCT FROM current_config.transaction_history AND request.transaction_history IS NOT DISTINCT FROM cycle_config.transaction_history
   AND request.draft_picks IS NOT DISTINCT FROM current_config.draft_picks AND request.draft_picks IS NOT DISTINCT FROM cycle_config.draft_picks)))
$$;


-- Only scheduling metadata: each invalid legacy target is journaled under the
-- actual owner, so one bad target cannot poison the rest of the bounded loop.
CREATE TABLE public.public_data_resource_target_failures (
 worker_id text NOT NULL,generation integer NOT NULL,target_id uuid NOT NULL,configuration_revision bigint NOT NULL,
 cycle bigint NOT NULL,reason text NOT NULL CHECK(reason='invalid-cycle-scope'),write_fence jsonb NOT NULL,
 recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),next_eligible_at timestamptz NOT NULL,
 PRIMARY KEY(worker_id,generation,target_id),
 FOREIGN KEY(target_id,configuration_revision) REFERENCES public.public_data_refresh_configurations(target_id,revision),
 FOREIGN KEY(target_id,cycle) REFERENCES public.public_data_refresh_cycles(target_id,cycle)
);
CREATE TRIGGER public_resource_target_failure_immutable BEFORE UPDATE OR DELETE ON public.public_data_resource_target_failures
 FOR EACH ROW EXECUTE FUNCTION public.prevent_league_administration_history_change();
CREATE FUNCTION public.record_public_data_resource_target_failure(p_target uuid,p_revision bigint,p_cycle bigint,p_fence jsonb) RETURNS void
LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE target public.public_data_refresh_targets%ROWTYPE; failures integer; retry_at timestamptz;
BEGIN
 PERFORM public.assert_public_data_resource_owner(p_fence);
 SELECT * INTO STRICT target FROM public.public_data_refresh_targets WHERE id=p_target FOR UPDATE;
 IF target.configuration_revision<>p_revision OR target.current_cycle IS DISTINCT FROM p_cycle THEN
   RAISE EXCEPTION 'invalid target failure authority'; END IF;
 IF EXISTS(SELECT 1 FROM public.public_data_resource_target_failures WHERE worker_id=p_fence->>'workerId'
   AND generation=(p_fence->>'generation')::integer AND target_id=p_target) THEN RETURN; END IF;
 failures:=least(7,target.selection_failure_count+1);
 retry_at:=clock_timestamp()+make_interval(secs=>least(3600,60*(2^(failures-1))::integer));
 INSERT INTO public.public_data_resource_target_failures(worker_id,generation,target_id,configuration_revision,cycle,reason,write_fence,next_eligible_at)
   VALUES(p_fence->>'workerId',(p_fence->>'generation')::integer,p_target,p_revision,p_cycle,'invalid-cycle-scope',p_fence,retry_at);
 UPDATE public.public_data_refresh_targets SET selection_failure_count=failures,selection_failed_at=clock_timestamp(),
   selection_next_eligible_at=retry_at WHERE id=p_target;
 PERFORM public.assert_public_data_resource_owner(p_fence);
END; $$;

CREATE FUNCTION public.select_public_data_resource_work(p_fence jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE job public.projection_jobs%ROWTYPE; selected public.public_data_resource_selections%ROWTYPE;
  active_resource public.public_data_resources%ROWTYPE; authority public.public_data_resource_authorities%ROWTYPE;
  history_request uuid; history_work jsonb; history_target uuid; history_revision bigint;
  request_id uuid; credit integer; history_cost integer; legacy_selection jsonb; chosen_lane text;
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

 -- A malformed legacy target cannot prevent independently eligible active or
 -- submitted work. Only create a whole cycle when those candidates are absent.
 IF active_resource.id IS NULL AND history_request IS NULL THEN
     legacy_selection:=public.select_public_data_refresh(p_fence);
     IF legacy_selection->>'status'='selected' AND public.public_data_history_authority_valid((legacy_selection->>'requestId')::uuid) THEN
       history_request:=(legacy_selection->>'requestId')::uuid;
       history_work:=public.next_public_data_intake(history_request);
       history_target:=(legacy_selection->>'targetId')::uuid;
       history_revision:=(legacy_selection->>'configurationRevision')::bigint;
       IF jsonb_typeof(history_work)<>'object' THEN history_request:=NULL; END IF;
     END IF;

   UPDATE public.projection_jobs SET payload=payload-ARRAY['requestId','refreshSelection'] WHERE job_key=job.job_key;
   PERFORM public.assert_public_data_resource_owner(p_fence);
 END IF;

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

ALTER FUNCTION public.admit_public_data_batch_dispatch(jsonb,jsonb) RENAME TO admit_public_data_batch_dispatch_v58;
CREATE FUNCTION public.admit_public_data_batch_dispatch(p_work jsonb,p_fence jsonb) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE job public.projection_jobs%ROWTYPE; selected public.public_data_resource_selections%ROWTYPE;
  configuration public.public_data_refresh_configurations%ROWTYPE; target public.public_data_refresh_targets%ROWTYPE;
  request_cost integer; admitted_time timestamptz;
BEGIN
 PERFORM public.assert_public_data_batch_owner(p_fence);
 SELECT * INTO STRICT job FROM public.projection_jobs WHERE job_key=p_fence->>'jobKey';
 IF job.payload->>'schedulingPolicy' IS DISTINCT FROM 'public-data-resource-schedule-v1' THEN
   RETURN public.admit_public_data_batch_dispatch_v58(p_work,p_fence); END IF;
 PERFORM public.assert_public_data_resource_owner(p_fence);
 PERFORM public.guard_public_data_intake(p_work,p_fence);
 IF (job.payload->>'batchAdmissionDeadlineAt')::timestamptz<=clock_timestamp() THEN RETURN false; END IF;
 IF EXISTS(SELECT 1 FROM public.public_data_dispatches WHERE worker_id=p_fence->>'workerId' AND generation=(p_fence->>'generation')::integer) THEN RETURN false; END IF;
 SELECT * INTO STRICT selected FROM public.public_data_resource_selections WHERE worker_id=p_fence->>'workerId' AND generation=(p_fence->>'generation')::integer;
 IF job.payload->'resourceSelection' IS DISTINCT FROM public.public_data_resource_selection_json(selected)
   OR selected.intake_id::text IS DISTINCT FROM p_work->>'requestId' THEN RAISE EXCEPTION 'public resource admitted selection changed'; END IF;
 IF selected.target_id IS NOT NULL THEN
   SELECT * INTO STRICT target FROM public.public_data_refresh_targets WHERE id=selected.target_id FOR UPDATE;
   IF target.configuration_revision<>selected.configuration_revision THEN RETURN false; END IF;
   SELECT * INTO STRICT configuration FROM public.public_data_refresh_configurations WHERE target_id=target.id AND revision=target.configuration_revision;
   IF configuration.paused OR configuration.expires_at<=clock_timestamp() THEN RETURN false; END IF;
 END IF;
 IF selected.lane='active' THEN
   IF NOT public.public_data_resource_authority_valid(selected.resource_id,selected.target_id,selected.configuration_revision)
     OR NOT EXISTS(SELECT 1 FROM public.public_data_resource_occurrences occurrence JOIN public.public_data_resources resource ON resource.id=occurrence.resource_id
       WHERE occurrence.id=selected.intake_id AND resource.id=selected.resource_id AND resource.open_intake_id=occurrence.id
       AND occurrence.source_mapping=resource.source_mapping) THEN RETURN false; END IF;
   PERFORM public.validate_current_roster_mapping((SELECT source_mapping FROM public.public_data_resources WHERE id=selected.resource_id));
 ELSIF NOT public.public_data_history_authority_valid(selected.intake_id) THEN RETURN false;
 ELSIF EXISTS(SELECT 1 FROM public.public_data_intakes WHERE id=selected.intake_id AND resource_occurrence_id IS NOT NULL) THEN
   RAISE EXCEPTION 'internal occurrence is not ordinary history';
 ELSIF selected.target_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.public_data_refresh_cycles cycle
   WHERE cycle.target_id=selected.target_id AND cycle.intake_id=selected.intake_id AND cycle.cycle=target.current_cycle) THEN RETURN false;
 END IF;
 IF EXISTS(SELECT 1 FROM public.public_data_dispatches dispatch WHERE NOT EXISTS(SELECT 1 FROM public.public_data_dispatch_outcomes outcome
   WHERE outcome.worker_id=dispatch.worker_id AND outcome.generation=dispatch.generation)) THEN RAISE EXCEPTION 'public dispatch recovery required'; END IF;
 request_cost:=CASE WHEN p_work->>'kind' IN ('core','exact-matchups','playoff-brackets') THEN 2 ELSE 1 END;
 IF NOT public.public_data_batch_budget_available(request_cost) THEN RETURN false; END IF;
 PERFORM public.assert_public_data_resource_owner(p_fence);
 IF (job.payload->>'batchAdmissionDeadlineAt')::timestamptz<=clock_timestamp() THEN RETURN false; END IF;
 IF selected.target_id IS NOT NULL AND configuration.expires_at<=clock_timestamp() THEN RETURN false; END IF;
 INSERT INTO public.public_data_dispatches(worker_id,generation,intake_id,revision,resource,work,max_requests)
   VALUES(p_fence->>'workerId',(p_fence->>'generation')::integer,selected.intake_id,(p_work->>'revision')::integer,p_work->>'kind',p_work,request_cost)
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
 RETURN true;
END; $$;

CREATE FUNCTION public.fail_public_data_resource_selection(p_selection jsonb,p_reason text,p_fence jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE selected public.public_data_resource_selections%ROWTYPE; failed public.public_data_resource_selection_failures%ROWTYPE;
  failures integer; retry_at timestamptz;
BEGIN
 PERFORM public.assert_public_data_resource_owner(p_fence);
 IF p_reason IS NULL OR p_reason NOT IN ('selection-failed','request-state-failed','admission-unconfirmed') THEN RAISE EXCEPTION 'invalid resource selection failure'; END IF;
 SELECT * INTO selected FROM public.public_data_resource_selections WHERE worker_id=p_fence->>'workerId' AND generation=(p_fence->>'generation')::integer;
 IF NOT FOUND THEN RETURN jsonb_build_object('status','unbound'); END IF;
 IF p_selection IS NOT NULL AND p_selection IS DISTINCT FROM public.public_data_resource_selection_json(selected) THEN
   RAISE EXCEPTION 'resource failure selection mismatch'; END IF;
 IF EXISTS(SELECT 1 FROM public.public_data_dispatches WHERE worker_id=selected.worker_id AND generation=selected.generation) THEN
   RETURN jsonb_build_object('status','admitted'); END IF;
 SELECT * INTO failed FROM public.public_data_resource_selection_failures WHERE selection_id=selected.id;
 IF FOUND THEN RETURN jsonb_build_object('status','already-recorded','retryAt',failed.next_eligible_at); END IF;
 IF selected.lane='active' THEN
   SELECT least(7,failure_count+1) INTO STRICT failures FROM public.public_data_resources WHERE id=selected.resource_id FOR UPDATE;
 ELSE
   INSERT INTO public.public_data_history_service(intake_id) VALUES(selected.intake_id) ON CONFLICT DO NOTHING;
   SELECT least(7,failure_count+1) INTO STRICT failures FROM public.public_data_history_service WHERE intake_id=selected.intake_id FOR UPDATE;
 END IF;
 retry_at:=clock_timestamp()+make_interval(secs=>least(300,15*power(2,failures-1))::integer);
 INSERT INTO public.public_data_resource_selection_failures(selection_id,reason,next_eligible_at) VALUES(selected.id,p_reason,retry_at);
 IF selected.lane='active' THEN UPDATE public.public_data_resources SET failure_count=failures,next_eligible_at=retry_at WHERE id=selected.resource_id;
 ELSE UPDATE public.public_data_history_service SET failure_count=failures,next_eligible_at=retry_at WHERE intake_id=selected.intake_id; END IF;
 RETURN jsonb_build_object('status','recorded','retryAt',retry_at);
END; $$;


-- An ordinary caller cannot replay, approve, or directly execute an internal
-- occurrence as though it were a new username intake.
ALTER FUNCTION public.configure_public_data_refresh(jsonb) RENAME TO configure_public_data_refresh_v58;
CREATE FUNCTION public.configure_public_data_refresh(p_input jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
 IF EXISTS(SELECT 1 FROM public.public_data_intakes WHERE id=(p_input->>'identityRequestId')::uuid AND resource_occurrence_id IS NOT NULL) THEN
   RAISE EXCEPTION 'internal occurrence cannot authorize public identity'; END IF;
 RETURN public.configure_public_data_refresh_v58(p_input);
END; $$;
ALTER FUNCTION public.begin_public_data_batch(text,timestamptz,uuid) RENAME TO begin_public_data_batch_v58;
CREATE FUNCTION public.begin_public_data_batch(p_worker text,p_invocation_started_at timestamptz,p_request uuid DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
 IF EXISTS(SELECT 1 FROM public.public_data_resource_selections WHERE worker_id=p_worker)
   OR EXISTS(SELECT 1 FROM public.public_data_resource_target_failures WHERE worker_id=p_worker) THEN
   RAISE EXCEPTION 'public resource worker identity reused'; END IF;
 IF p_request IS NOT NULL AND EXISTS(SELECT 1 FROM public.public_data_intakes WHERE id=p_request AND resource_occurrence_id IS NOT NULL) THEN
   RAISE EXCEPTION 'internal occurrence requires scheduled authority'; END IF;
 RETURN public.begin_public_data_batch_v58(p_worker,p_invocation_started_at,p_request);
END; $$;
ALTER FUNCTION public.guard_public_data_intake(jsonb,jsonb) RENAME TO guard_public_data_intake_v58;
CREATE FUNCTION public.guard_public_data_intake(p_work jsonb,p_fence jsonb) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
 IF EXISTS(SELECT 1 FROM public.public_data_intakes WHERE id=(p_work->>'requestId')::uuid AND resource_occurrence_id IS NOT NULL) THEN
   PERFORM public.assert_public_data_resource_owner(p_fence-'reserveCollection');
   IF NOT EXISTS(SELECT 1 FROM public.public_data_resource_selections selection
     WHERE selection.worker_id=p_fence->>'workerId' AND selection.generation=(p_fence->>'generation')::integer
       AND selection.intake_id=(p_work->>'requestId')::uuid AND selection.lane='active') THEN
     RAISE EXCEPTION 'internal occurrence selection required'; END IF;
 END IF;
 -- Permission may change AFTER admission. Immutable admitted work plus the
 -- original bounded owner remains sufficient for checkpoint/recovery cleanup.
 PERFORM public.guard_public_data_intake_v58(p_work,p_fence);
END; $$;

CREATE OR REPLACE FUNCTION public.submit_public_data_intake(p_input jsonb,p_retain_capacity_receipt boolean) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE wanted integer[]; periods jsonb; inventory text; brackets text; reports jsonb; transaction_period_value jsonb; history text; drafts text; retained public.public_data_intakes%ROWTYPE; capacity_reason text;
BEGIN
  IF p_retain_capacity_receipt IS NULL OR jsonb_typeof(p_input) IS DISTINCT FROM 'object'
    OR jsonb_typeof(p_input->'id') IS DISTINCT FROM 'string'
    OR (p_input->>'id') !~* '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$'
    OR jsonb_typeof(p_input->'username') IS DISTINCT FROM 'string'
    OR jsonb_typeof(p_input->'seasons') IS DISTINCT FROM 'array'
    OR jsonb_array_length(p_input->'seasons') NOT BETWEEN 1 AND 3
    OR (p_input->>'username') !~ '^[a-zA-Z0-9_]{1,100}$' THEN RAISE EXCEPTION 'invalid public intake'; END IF;
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(p_input->'seasons') entry
    WHERE jsonb_typeof(entry) IS DISTINCT FROM 'number' OR entry::text !~ '^[1-9][0-9]{3}$') THEN
    RAISE EXCEPTION 'invalid public season scope'; END IF;
  SELECT array_agg(value::integer ORDER BY value::integer) INTO wanted FROM jsonb_array_elements_text(p_input->'seasons');
  IF EXISTS(SELECT 1 FROM unnest(wanted) value WHERE value NOT BETWEEN 1920 AND 2200)
    OR cardinality(wanted)<>(SELECT count(DISTINCT value) FROM unnest(wanted) value) THEN
    RAISE EXCEPTION 'invalid public season scope';
  END IF;
  drafts:=public.canonical_public_data_draft_picks(p_input->'draftPicks',wanted);
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
    IF retained.resource_occurrence_id IS NOT NULL OR retained.username IS DISTINCT FROM p_input->>'username' OR retained.seasons IS DISTINCT FROM wanted OR retained.exact_periods IS DISTINCT FROM periods OR retained.period_inventory IS DISTINCT FROM inventory OR retained.playoff_brackets IS DISTINCT FROM brackets OR retained.weekly_reports IS DISTINCT FROM reports OR retained.transaction_period IS DISTINCT FROM transaction_period_value OR retained.transaction_history IS DISTINCT FROM history OR retained.draft_picks IS DISTINCT FROM drafts THEN
      RAISE EXCEPTION 'public intake replay mismatch';
    END IF;
    IF retained.submission_capacity IS NOT NULL AND NOT p_retain_capacity_receipt THEN
      RAISE EXCEPTION 'public intake capacity reached'; END IF;
    RETURN jsonb_build_object('status',CASE WHEN retained.submission_capacity IS NULL THEN 'retained' ELSE 'capacity' END,'requestId',retained.id);
  END IF;
  IF (SELECT count(*) FROM public.public_data_intakes WHERE NOT terminal AND resource_occurrence_id IS NULL)>=16 THEN
    IF NOT p_retain_capacity_receipt THEN RAISE EXCEPTION 'public intake capacity reached'; END IF;
    capacity_reason:='pending-request-limit';
  END IF;
  INSERT INTO public.public_data_intakes(id,username,seasons,exact_periods,period_inventory,playoff_brackets,weekly_reports,transaction_period,transaction_history,draft_picks,submission_capacity,terminal) VALUES((p_input->>'id')::uuid,p_input->>'username',wanted,periods,inventory,brackets,reports,transaction_period_value,history,drafts,capacity_reason,capacity_reason IS NOT NULL);
  RETURN jsonb_build_object('status',CASE WHEN capacity_reason IS NULL THEN 'retained' ELSE 'capacity' END,'requestId',(p_input->>'id')::uuid);
END; $$;

CREATE OR REPLACE FUNCTION public.submit_public_data_intake(p_input jsonb) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
  PERFORM public.submit_public_data_intake(p_input,false);
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
      IF (SELECT count(*) FROM public.public_data_intakes WHERE NOT terminal AND resource_occurrence_id IS NULL)>=16 THEN has_capacity:=true; CONTINUE; END IF;
      SELECT external_manager_id INTO STRICT native FROM public.league_source_manager_accounts
        WHERE id=target.source_manager_account_id AND provider=target.provider;
      request_id:=gen_random_uuid(); cycle_number:=COALESCE(target.current_cycle,0)+1;
      -- One new ordinary request. No reset or mutation of previous cycle evidence.
      PERFORM public.submit_public_data_intake(jsonb_build_object('id',request_id,'username',native,'seasons',configuration.seasons)||CASE WHEN configuration.period_inventory IS NULL THEN jsonb_build_object('exactPeriods',configuration.exact_periods) ELSE jsonb_build_object('periodInventory',configuration.period_inventory) END||CASE WHEN configuration.playoff_brackets IS NULL THEN '{}'::jsonb ELSE jsonb_build_object('playoffBrackets',configuration.playoff_brackets) END||CASE WHEN configuration.weekly_reports='[]'::jsonb THEN '{}'::jsonb ELSE jsonb_build_object('weeklyReports',configuration.weekly_reports) END||CASE WHEN configuration.transaction_history IS NULL THEN '{}'::jsonb ELSE jsonb_build_object('transactionHistory',configuration.transaction_history) END||CASE WHEN configuration.draft_picks IS NULL THEN '{}'::jsonb ELSE jsonb_build_object('draftPicks',configuration.draft_picks) END);
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


CREATE OR REPLACE FUNCTION public.advance_public_data_batch_owner(p_fence jsonb,p_next_worker text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE job public.projection_jobs%ROWTYPE; dispatch public.public_data_dispatches%ROWTYPE; next_payload jsonb;
BEGIN
  PERFORM public.assert_public_data_batch_owner(p_fence);
  SELECT * INTO STRICT job FROM public.projection_jobs WHERE job_key=p_fence->>'jobKey';
  IF (job.payload->>'batchAdmissionDeadlineAt')::timestamptz<=clock_timestamp() THEN RETURN jsonb_build_object('kind','deadline'); END IF;
  IF p_next_worker IS NULL OR p_next_worker !~ '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$'
    OR p_next_worker=job.lease_owner OR EXISTS(SELECT 1 FROM public.public_data_dispatches WHERE worker_id=p_next_worker)
    OR EXISTS(SELECT 1 FROM public.public_data_refresh_selection_failures WHERE worker_id=p_next_worker) OR EXISTS(SELECT 1 FROM public.public_data_resource_selections WHERE worker_id=p_next_worker) OR EXISTS(SELECT 1 FROM public.public_data_resource_target_failures WHERE worker_id=p_next_worker) THEN
    RAISE EXCEPTION 'fresh public batch worker required';
  END IF;
  SELECT * INTO STRICT dispatch FROM public.public_data_dispatches
    WHERE worker_id=job.lease_owner AND generation=job.attempt_count;
  IF dispatch.intake_id::text IS DISTINCT FROM job.payload->>'requestId'
    OR NOT EXISTS(SELECT 1 FROM public.public_data_dispatch_outcomes outcome
      WHERE outcome.worker_id=dispatch.worker_id AND outcome.generation=dispatch.generation AND outcome.outcome='checkpoint-committed')
    OR EXISTS(SELECT 1 FROM public.league_roster_resource_attempts attempt WHERE attempt.write_fence=p_fence
      AND NOT EXISTS(SELECT 1 FROM public.league_roster_capture_receipts receipt WHERE receipt.attempt_id=attempt.id))
    OR (job.payload->>'batchMode'='recurring' AND ((CASE WHEN job.payload->>'schedulingPolicy'='public-data-resource-schedule-v1' THEN job.payload->'resourceSelection' ELSE job.payload->'refreshSelection' END)->>'requestId' IS DISTINCT FROM dispatch.intake_id::text
      OR (CASE WHEN job.payload->>'schedulingPolicy'='public-data-resource-schedule-v1' THEN job.payload->'resourceSelection' ELSE job.payload->'refreshSelection' END)->>'status' IS DISTINCT FROM 'selected')) THEN
    RAISE EXCEPTION 'public batch prior task is not fully checkpointed';
  END IF;
  -- Runtime must await every preceding provider/SQL promise before advancing.
  -- A fresh worker UUID also fences generic completeJob/failJob, which match owner.
  next_payload:=CASE WHEN job.payload->>'batchMode'='recurring'
    THEN job.payload-ARRAY['requestId','refreshSelection','resourceSelection'] ELSE job.payload END;
  PERFORM public.assert_public_data_batch_owner(p_fence);
  IF (job.payload->>'batchAdmissionDeadlineAt')::timestamptz<=clock_timestamp() THEN RETURN jsonb_build_object('kind','deadline'); END IF;
  UPDATE public.projection_jobs SET lease_owner=p_next_worker,attempt_count=attempt_count+1,
    payload=next_payload,updated_at=clock_timestamp()
    WHERE job_key=job.job_key AND state='running' AND lease_owner=job.lease_owner AND attempt_count=job.attempt_count
    RETURNING * INTO STRICT job;
  RETURN public.public_data_batch_claim_result(job);
END; $$;



-- New functions default to PUBLIC EXECUTE; explicitly close both helpers and
-- renamed legacy entry points, then grant only the reviewed runtime surface.
DO $$ DECLARE name text; BEGIN
 FOREACH name IN ARRAY ARRAY['public.public_data_resource_schedule_capability()','public.begin_public_data_resource_batch(text,timestamptz)','public.configure_public_data_resource_schedule(jsonb)','public.select_public_data_resource_work(jsonb)','public.fail_public_data_resource_selection(jsonb,text,jsonb)','public.next_public_data_intake(uuid)','public.checkpoint_public_data_intake(jsonb,jsonb,jsonb)','public.recover_public_data_dispatch(uuid,jsonb)','public.admit_public_data_batch_dispatch(jsonb,jsonb)','public.configure_public_data_refresh(jsonb)','public.begin_public_data_batch(text,timestamptz,uuid)','public.guard_public_data_intake(jsonb,jsonb)','public.public_data_resource_selection_json(public.public_data_resource_selections)','public.assert_public_data_resource_owner(jsonb)','public.public_data_resource_authority_valid(uuid,uuid,bigint)','public.validate_public_data_resource_occurrence()','public.next_public_data_intake_v58(uuid)','public.seed_public_data_resource_occurrence(uuid,uuid,bigint,jsonb)','public.reconcile_public_data_resource_request(uuid)','public.checkpoint_public_data_intake_v58(jsonb,jsonb,jsonb)','public.recover_public_data_dispatch_v58(uuid,jsonb)','public.public_data_history_authority_valid(uuid)','public.record_public_data_resource_target_failure(uuid,bigint,bigint,jsonb)','public.admit_public_data_batch_dispatch_v58(jsonb,jsonb)','public.configure_public_data_refresh_v58(jsonb)','public.begin_public_data_batch_v58(text,timestamptz,uuid)','public.guard_public_data_intake_v58(jsonb,jsonb)'] LOOP
   EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC',name);
   IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='league_one_runtime') THEN
     EXECUTE format('REVOKE ALL ON FUNCTION %s FROM league_one_runtime',name);
   END IF;
 END LOOP;
 FOREACH name IN ARRAY ARRAY['public_data_resource_configurations','public_data_resources','public_data_resource_authorities','public_data_resource_occurrences','public_data_resource_selections','public_data_resource_selection_failures','public_data_history_service','public_data_resource_service','public_data_resource_target_failures'] LOOP
   EXECUTE format('REVOKE ALL ON TABLE public.%I FROM PUBLIC',name);
   IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='league_one_runtime') THEN
     EXECUTE format('REVOKE ALL ON TABLE public.%I FROM league_one_runtime',name);
     EXECUTE format('GRANT SELECT ON TABLE public.%I TO league_one_runtime',name);
   END IF;
 END LOOP;
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='league_one_runtime') THEN
   FOREACH name IN ARRAY ARRAY['public.public_data_resource_schedule_capability()','public.begin_public_data_resource_batch(text,timestamptz)','public.configure_public_data_resource_schedule(jsonb)','public.select_public_data_resource_work(jsonb)','public.fail_public_data_resource_selection(jsonb,text,jsonb)','public.next_public_data_intake(uuid)','public.checkpoint_public_data_intake(jsonb,jsonb,jsonb)','public.recover_public_data_dispatch(uuid,jsonb)','public.admit_public_data_batch_dispatch(jsonb,jsonb)','public.configure_public_data_refresh(jsonb)','public.begin_public_data_batch(text,timestamptz,uuid)','public.guard_public_data_intake(jsonb,jsonb)'] LOOP
     EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO league_one_runtime',name);
   END LOOP;
 END IF;
END; $$;
