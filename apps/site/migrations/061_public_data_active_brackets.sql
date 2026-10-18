-- CP26: active brackets reuse the existing paired ordinary capture and checkpoint.
-- Explicit existing bracket approval plus resource configuration is required.
-- No existing declaration gains work until its explicit configure/replay call.
-- Twelve minutes is an internal scheduling policy, not proof of the frozen15m gate.
-- Existing HTTP reservations, cost fairness, singleton and10/20/22/25s fences remain.
ALTER TABLE public.public_data_resources DROP CONSTRAINT public_data_resources_kind_check;
ALTER TABLE public.public_data_resources ADD CONSTRAINT public_data_resources_kind_check
  CHECK(kind IN ('core','exact-matchups','transactions','playoff-brackets'));
ALTER TABLE public.public_data_resources DROP CONSTRAINT public_data_resources_check;
ALTER TABLE public.public_data_resources ADD CONSTRAINT public_data_resources_period_scope_check
  CHECK((kind IN ('core','playoff-brackets'))=(native_week=0));

CREATE OR REPLACE FUNCTION public.public_data_resource_authority_valid(p_resource uuid,p_target uuid,p_revision bigint) RETURNS boolean
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
 AND (resource.kind<>'playoff-brackets' OR configuration.playoff_brackets='sleeper-2026-playoff-brackets-v1')
 AND head.read_conflict IS NULL AND content.accepted AND content.completeness='complete'
 AND content.payload->>'status'='in_season'
 AND content.payload->'settings'->>'leg'=authority.active_native_week::text)
$$;

CREATE OR REPLACE FUNCTION public.configure_public_data_resource_schedule(p_input jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE target public.public_data_refresh_targets%ROWTYPE; configuration public.public_data_refresh_configurations%ROWTYPE;
  item jsonb; canonical jsonb; retained jsonb; candidate public.public_data_league_candidates%ROWTYPE;
  mapping jsonb; kind_value text; resource_id_value uuid; current_week integer; target_id_value uuid; revision_value bigint;
  replayed boolean:=false; kinds text[];
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
    replayed:=true;
    -- Legacy declarations without brackets keep their exact replay behavior.
    IF configuration.playoff_brackets IS NULL THEN
      RETURN jsonb_build_object('targetId',target.id,'configurationRevision',revision_value); END IF;
  ELSE
    INSERT INTO public.public_data_resource_configurations(target_id,configuration_revision,active_periods) VALUES(target.id,revision_value,canonical);
  END IF;
  kinds:=CASE WHEN replayed THEN ARRAY['playoff-brackets']::text[]
    ELSE ARRAY['core','exact-matchups','transactions']::text[]
      || CASE WHEN configuration.playoff_brackets='sleeper-2026-playoff-brackets-v1' THEN ARRAY['playoff-brackets']::text[] ELSE ARRAY[]::text[] END END;
  FOR item IN SELECT value FROM jsonb_array_elements(canonical) LOOP
    -- An explicit replay upgrades only a missing bracket authority. It never resets
    -- existing resources, service debt, occurrences or immutable declarations.
    IF replayed AND EXISTS(SELECT 1 FROM public.public_data_resource_authorities authority
      JOIN public.public_data_resources resource ON resource.id=authority.resource_id
      WHERE authority.target_id=target.id AND authority.configuration_revision=revision_value
        AND resource.kind='playoff-brackets' AND resource.external_league_id=item->>'externalLeagueId'
        AND resource.season=2026 AND resource.native_week=0) THEN CONTINUE; END IF;
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
    FOREACH kind_value IN ARRAY kinds LOOP
      INSERT INTO public.public_data_resources(connection_id,mapping_revision_id,source_mapping,season,external_league_id,kind,native_week)
        VALUES((mapping->>'connectionId')::uuid,(mapping->>'revisionId')::uuid,mapping,2026,candidate.external_league_id,kind_value,
          CASE WHEN kind_value IN ('core','playoff-brackets') THEN 0 ELSE current_week END)
        ON CONFLICT(connection_id,mapping_revision_id,kind,native_week) DO NOTHING;
      SELECT id INTO STRICT resource_id_value FROM public.public_data_resources WHERE connection_id=(mapping->>'connectionId')::uuid
        AND mapping_revision_id=(mapping->>'revisionId')::uuid AND kind=kind_value AND native_week=CASE WHEN kind_value IN ('core','playoff-brackets') THEN 0 ELSE current_week END;
      INSERT INTO public.public_data_resource_authorities(resource_id,target_id,configuration_revision,origin_intake_id,season,external_league_id,active_native_week)
        VALUES(resource_id_value,target.id,revision_value,candidate.intake_id,2026,candidate.external_league_id,current_week);
      IF NOT public.public_data_resource_authority_valid(resource_id_value,target.id,revision_value) THEN
        RAISE EXCEPTION 'provider activity unknown, dormant, or current period changed'; END IF;
    END LOOP;
  END LOOP;
  -- Configuring/replaying/changing approval NEVER resets canonical due clocks or service debt.
  RETURN jsonb_build_object('targetId',target.id,'configurationRevision',revision_value);
END; $$;

CREATE OR REPLACE FUNCTION public.next_public_data_intake(p_id uuid) RETURNS jsonb
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
 ELSIF resource.kind='playoff-brackets' THEN
   SELECT status INTO STRICT task_status FROM public.public_data_bracket_tasks WHERE intake_id=p_id AND ordinal=1;
 ELSE
   SELECT status INTO STRICT task_status FROM public.public_data_transaction_tasks WHERE intake_id=p_id AND ordinal=1;
 END IF;
 IF task_status='complete' THEN RETURN '"complete"'::jsonb; END IF;
 -- Keep the existing fail/checkpoint terminalization contract: exhausted scope is partial.
 IF task_status<>'pending' OR request.terminal THEN RETURN '"partial"'::jsonb; END IF;
 IF request.next_attempt_at>clock_timestamp() THEN RETURN '"backoff"'::jsonb; END IF;
 result:=jsonb_build_object('requestId',p_id,'revision',request.revision,'kind',resource.kind,
   'externalLeagueId',resource.external_league_id,'season',resource.season);
 IF resource.kind IN ('exact-matchups','transactions') THEN result:=result||jsonb_build_object('nativeWeek',resource.native_week); END IF;
 -- No identity, discovery, bootstrap, users or sibling family is fabricated.
 RETURN result;
END; $$;

CREATE OR REPLACE FUNCTION public.seed_public_data_resource_occurrence(p_resource uuid,p_target uuid,p_revision bigint,p_fence jsonb) RETURNS uuid
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
 INSERT INTO public.public_data_intakes(id,username,seasons,exact_periods,transaction_period,playoff_brackets,resource_occurrence_id)
   SELECT request_id,username,ARRAY[origin.season],
     CASE WHEN resource.kind='exact-matchups' THEN jsonb_build_array(jsonb_build_object('season',origin.season,'nativeWeek',resource.native_week)) ELSE '[]'::jsonb END,
     CASE WHEN resource.kind='transactions' THEN jsonb_build_object('season',origin.season,'nativeWeek',resource.native_week) ELSE NULL END,
     CASE WHEN resource.kind='playoff-brackets' THEN 'sleeper-2026-playoff-brackets-v1' ELSE NULL END,request_id
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
 ELSIF resource.kind='playoff-brackets' THEN
   INSERT INTO public.public_data_bracket_tasks(intake_id,ordinal,season,external_league_id,write_fence)
     VALUES(request_id,1,origin.season,origin.external_league_id,p_fence);
 ELSIF resource.kind='transactions' THEN
   INSERT INTO public.public_data_transaction_tasks(intake_id,ordinal,season,external_league_id,native_week,write_fence)
     VALUES(request_id,1,origin.season,origin.external_league_id,resource.native_week,p_fence);
 END IF;
 UPDATE public.public_data_resources SET open_intake_id=request_id WHERE id=resource.id;
 RETURN request_id;
END; $$;

CREATE OR REPLACE FUNCTION public.reconcile_public_data_resource_request(p_request uuid) RETURNS void
LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE occurrence public.public_data_resource_occurrences%ROWTYPE; resource public.public_data_resources%ROWTYPE;
  request public.public_data_intakes%ROWTYPE; receipt_id uuid; observed_at timestamptz;
  bracket public.public_data_bracket_checkpoints%ROWTYPE; paired_receipt uuid; paired_at timestamptz;
  cadence interval:=interval '4 minutes';
BEGIN
 SELECT * INTO occurrence FROM public.public_data_resource_occurrences WHERE id=p_request;
 IF NOT FOUND THEN RETURN; END IF;
 SELECT * INTO STRICT request FROM public.public_data_intakes WHERE id=p_request;
 SELECT * INTO STRICT resource FROM public.public_data_resources WHERE id=occurrence.resource_id FOR UPDATE;
 IF resource.open_intake_id IS DISTINCT FROM p_request THEN RETURN; END IF;
 IF public.next_public_data_intake(p_request)='"complete"'::jsonb THEN
   IF resource.kind='playoff-brackets' THEN
     SELECT * INTO STRICT bracket FROM public.public_data_bracket_checkpoints WHERE intake_id=p_request AND task_ordinal=1;
     IF bracket.source_mapping IS DISTINCT FROM resource.source_mapping THEN RAISE EXCEPTION 'bracket resource mapping changed'; END IF;
     -- Both immutable accepted receipts must belong to the SAME committed paired
     -- dispatch. The older successful observation bounds the whole resource age.
     FOREACH paired_receipt IN ARRAY ARRAY[bracket.winners_bracket_receipt_id,bracket.losers_bracket_receipt_id] LOOP
       SELECT (receipt.provenance->>'sourceObservedAt')::timestamptz INTO STRICT paired_at
         FROM public.league_roster_capture_receipts receipt
         JOIN public.league_roster_resource_attempts attempt ON attempt.id=receipt.attempt_id
         JOIN public.league_roster_resource_scopes scope ON scope.id=attempt.scope_id
         JOIN public.public_data_dispatches dispatch ON dispatch.worker_id=attempt.write_fence->>'workerId'
           AND dispatch.generation=(attempt.write_fence->>'generation')::integer
         JOIN public.public_data_dispatch_outcomes outcome ON outcome.worker_id=dispatch.worker_id
           AND outcome.generation=dispatch.generation AND outcome.outcome='checkpoint-committed'
         WHERE receipt.id=paired_receipt AND attempt.source_mapping=resource.source_mapping
           AND dispatch.worker_id=bracket.worker_id AND dispatch.generation=bracket.generation
           AND dispatch.intake_id=p_request AND dispatch.resource='playoff-brackets' AND dispatch.max_requests=2
           AND scope.identity->'scope'->>'family'='playoff-brackets'
           AND scope.identity->'scope'->>'entityId'=CASE WHEN paired_receipt=bracket.winners_bracket_receipt_id
             THEN 'winners_bracket' ELSE 'losers_bracket' END
           AND receipt.provenance->'acquisition'=outcome.capture_acquisition
           AND receipt.provenance->>'origin'='network'
           AND receipt.provenance->>'sourceObservedAt'=receipt.provenance->>'requestCompletedAt';
       IF paired_at IS NULL OR NOT isfinite(paired_at) OR paired_at>clock_timestamp() THEN
         RAISE EXCEPTION 'paired bracket successful source clocks required'; END IF;
       IF observed_at IS NULL OR paired_at<observed_at THEN observed_at:=paired_at; receipt_id:=paired_receipt; END IF;
     END LOOP;
     cadence:=interval '12 minutes';
   ELSE
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
   END IF;
   IF observed_at IS NULL OR NOT isfinite(observed_at) OR observed_at>clock_timestamp() THEN RAISE EXCEPTION 'resource successful source clock required'; END IF;
   UPDATE public.public_data_resources SET last_success_at=observed_at,last_success_receipt_id=receipt_id,
     due_at=observed_at+cadence,next_eligible_at=clock_timestamp(),failure_count=0,open_intake_id=NULL WHERE id=resource.id;
 ELSIF request.terminal THEN
   UPDATE public.public_data_resources SET open_intake_id=NULL,failure_count=least(7,failure_count+1),
     next_eligible_at=clock_timestamp()+interval '60 seconds' WHERE id=resource.id;
 ELSE
   UPDATE public.public_data_resources SET next_eligible_at=request.next_attempt_at,failure_count=least(7,request.failure_count) WHERE id=resource.id;
 END IF;
END; $$;
-- CREATE OR REPLACE preserves the five existing signatures, owners and ACLs.
-- No new callable helper or grant exists; existing and late-created-role
-- provisioning retains its reviewed private-helper deny and public-entry grants.
