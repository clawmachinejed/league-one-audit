-- Forward 065 lineage and 056 witness replacement; native branches and witness value preserved.
CREATE OR REPLACE FUNCTION public.validate_current_roster_lineage()
RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE population_proof jsonb;
BEGIN
  -- Only the canonical XOR branch is added; every operative 065 native branch below is retained.
  IF TG_TABLE_NAME='league_roster_resource_acceptances' THEN
  IF NEW.canonical_receipt_id IS NOT NULL THEN
    IF NEW.receipt_id IS NOT NULL OR NOT EXISTS(SELECT 1 FROM public.league_canonical_resource_receipts receipt
      JOIN public.league_roster_resource_attempts attempt ON attempt.id=receipt.attempt_id
      JOIN public.league_roster_resource_scopes scope ON scope.id=attempt.scope_id
      JOIN public.league_source_mapping_revisions revision ON revision.id=NEW.source_mapping_revision_id
      JOIN public.league_roster_resource_heads head ON head.scope_id=scope.id
      WHERE receipt.id=NEW.canonical_receipt_id AND receipt.scope_id=NEW.scope_id AND receipt.qualification='qualified'
        AND receipt.outcome='accepted' AND receipt.source_mapping=attempt.source_mapping
        AND receipt.capture_transaction=pg_current_xact_id()
        AND attempt.source_mapping->>'revisionId'=revision.id::text AND revision.connection_id=scope.connection_id
        AND revision.league_season_id=scope.league_season_id AND NEW.generation=attempt.expected_generation+1
        AND head.generation=attempt.expected_generation AND head.latest_ordinal=attempt.ordinal
        AND scope.identity=jsonb_build_object('scope',public.canonical_standings_scope(attempt.source_mapping),
          'policy',public.canonical_resource_policy(attempt.source_mapping,scope.identity->'policy'))) THEN
      RAISE EXCEPTION 'canonical acceptance lineage mismatch'; END IF;
    PERFORM public.assert_canonical_job_fence(attempt.write_fence)
      FROM public.league_roster_resource_attempts attempt JOIN public.league_canonical_resource_receipts receipt ON receipt.attempt_id=attempt.id
      WHERE receipt.id=NEW.canonical_receipt_id;
    RETURN NEW;
  END IF;
  END IF;
  IF TG_TABLE_NAME='league_roster_capture_receipts' THEN
    PERFORM public.roster_capture_provenance(NEW);
    population_proof:=public.roster_capture_population_evidence(NEW);
    IF NEW.configuration_content_id=NEW.content_id AND NOT EXISTS(SELECT 1
      FROM public.league_roster_resource_attempts attempt
      JOIN public.league_roster_resource_scopes scope ON scope.id=attempt.scope_id
      WHERE attempt.id=NEW.attempt_id AND scope.identity->'scope'->>'family'='league-season') THEN
      RAISE EXCEPTION 'self configuration requires league resource'; END IF;
    IF NOT EXISTS(SELECT 1 FROM public.league_roster_resource_attempts attempt
      JOIN public.league_roster_resource_scopes scope ON scope.id=attempt.scope_id
      JOIN public.league_administration_contents content ON content.id=NEW.content_id
      JOIN public.league_administration_observations observation ON observation.id=NEW.legacy_observation_id
      WHERE attempt.id=NEW.attempt_id AND content.league_season_id=scope.league_season_id
        AND content.provider='sleeper' AND content.family=CASE
          WHEN scope.identity->'scope'->>'family'='league-season' THEN 'league'
          WHEN scope.identity->'scope'->>'family'='drafts' AND scope.identity->'scope'->'scoringPeriodId'='null'::jsonb THEN 'drafts'
          WHEN scope.identity->'scope'->>'family'='playoff-brackets' AND scope.identity->'scope'->>'entityId' IN ('winners_bracket','losers_bracket')
            AND scope.identity->'scope'->'scoringPeriodId'='null'::jsonb THEN scope.identity->'scope'->>'entityId'
          WHEN scope.identity->'scope'->>'family'='weekly-reports' AND scope.identity->'scope'->>'entityId'='league_report' THEN 'weekly_report'
          WHEN scope.identity->'scope'->>'family' IN ('matchups','transactions') THEN scope.identity->'scope'->>'family' ELSE 'rosters' END
        AND content.week=CASE WHEN scope.identity->'scope'->>'family'='weekly-reports'
          THEN substring(scope.identity->'scope'->>'scoringPeriodId' FROM '^sleeper:report-week:([0-9]+)$')::integer
          WHEN scope.identity->'scope'->>'family'='matchups'
          THEN substring(scope.identity->'scope'->>'scoringPeriodId' FROM '^sleeper:matchup-week:([0-9]+)$')::integer
          WHEN scope.identity->'scope'->>'family'='transactions'
          THEN substring(scope.identity->'scope'->>'scoringPeriodId' FROM '^sleeper:transaction-week:([0-9]+)$')::integer ELSE 0 END
        AND content.external_league_id=attempt.source_mapping->'scope'->>'externalLeagueId'
        AND observation.content_id=content.id AND observation.league_season_id=content.league_season_id)
      OR (NEW.configuration_content_id IS NOT NULL AND NEW.configuration_content_id<>NEW.content_id AND NOT EXISTS(SELECT 1
        FROM public.league_administration_contents capture
        JOIN public.league_administration_contents configuration ON configuration.id=NEW.configuration_content_id
        JOIN public.league_administration_observations observation ON observation.id=(population_proof->>'observationId')::uuid
        WHERE capture.id=NEW.content_id AND configuration.league_season_id=capture.league_season_id
          AND configuration.provider=capture.provider AND configuration.external_league_id=capture.external_league_id
          AND configuration.family='league' AND configuration.week=0 AND configuration.accepted
          AND observation.content_id=configuration.id)) THEN RAISE EXCEPTION 'resource receipt lineage mismatch'; END IF;
  ELSIF TG_TABLE_NAME='league_roster_resource_acceptances' THEN
    IF NOT EXISTS(SELECT 1 FROM public.league_roster_capture_receipts receipt
      JOIN public.league_roster_resource_attempts attempt ON attempt.id=receipt.attempt_id
      JOIN public.league_source_mapping_revisions revision ON revision.id=NEW.source_mapping_revision_id
      JOIN public.league_roster_resource_scopes scope ON scope.id=attempt.scope_id
      WHERE receipt.id=NEW.receipt_id AND attempt.scope_id=NEW.scope_id
        AND attempt.source_mapping->>'revisionId'=revision.id::text AND revision.connection_id=scope.connection_id
        AND revision.league_season_id=scope.league_season_id AND (receipt.coverage->>'completeness'='complete' OR (
          receipt.coverage->>'completeness'='partial'
          AND scope.identity->'scope'->>'family'='teams'
          AND scope.identity->'scope'->>'audienceId'='public'
          AND scope.identity->'scope'->>'coverageSpecId'='sleeper-current-all-teams-manager-evidence-v2'
          AND scope.identity->'policy'=jsonb_build_object('audienceId','public',
            'coverageSpecId','sleeper-current-all-teams-manager-evidence-v2',
            'canonicalNormalizerVersion','sleeper-current-team-manager-evidence-v2','validationVersion','latest-network-attempt-v1')
          AND receipt.coverage->>'entitySet'='full' AND receipt.coverage->'fields'='["owner_id","co_owners"]'::jsonb
          AND receipt.coverage->>'pagination'='complete' AND receipt.coverage->'nextCursor'='null'::jsonb
          AND receipt.coverage->'periodIds'='[]'::jsonb AND receipt.coverage->'interval'='null'::jsonb
          AND jsonb_typeof(receipt.coverage->'reasons')='array' AND jsonb_array_length(receipt.coverage->'reasons')>0))
        AND ((scope.identity->'scope'->>'family'='league-season' AND receipt.configuration_content_id=receipt.content_id
          AND receipt.population_evidence IS NULL AND receipt.expected_team_count IS NULL)
          OR (scope.identity->'scope'->>'family' IN ('transactions','playoff-brackets','weekly-reports','drafts') AND receipt.configuration_content_id IS NULL
            AND receipt.population_evidence IS NULL AND receipt.expected_team_count IS NULL)
          OR (scope.identity->'scope'->>'family' NOT IN ('league-season','transactions','playoff-brackets','weekly-reports','drafts') AND receipt.configuration_content_id IS NOT NULL
            AND receipt.expected_team_count>0))
        AND NEW.generation=attempt.expected_generation+1) THEN RAISE EXCEPTION 'resource acceptance lineage mismatch'; END IF;
  ELSIF TG_TABLE_NAME='league_roster_resource_heads' THEN
    IF NEW.accepted_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.league_roster_resource_acceptances accepted
      WHERE accepted.id=NEW.accepted_id AND accepted.scope_id=NEW.scope_id AND accepted.generation=NEW.generation) THEN
      RAISE EXCEPTION 'resource head lineage mismatch'; END IF;
    IF TG_OP='UPDATE' AND (NEW.scope_id<>OLD.scope_id OR NEW.latest_ordinal<OLD.latest_ordinal
      OR NEW.generation<OLD.generation OR (OLD.accepted_id IS NOT NULL AND NEW.accepted_id IS NULL)) THEN
      RAISE EXCEPTION 'resource head cannot regress'; END IF;
  END IF;
  RETURN NEW;
END; $$;

-- The sole fact writer and two guarded identity/reservation entry points are the complete public surface.
-- Apply both here and in provisioning so rename/default/inherited ACLs cannot reopen an inner writer.
DO $$ DECLARE function_entry record; role_name text; relation_name text; signature text; public_entry boolean;
  denied text:='INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER';
BEGIN
  IF current_setting('server_version_num')::integer>=170000 THEN denied:=denied||',MAINTAIN'; END IF;
  -- Exact bounded inventory; historical wrappers were already private under
  -- 027/030/031/032/033/035/043/046/048/049/053/054/055. Reassert only that denial.
  FOREACH signature IN ARRAY ARRAY[
    'public.canonical_legacy_team_namespace(integer,text)',
    'public.canonical_jsonb_hash(jsonb)',
    'public.assert_canonical_job_fence(jsonb)',
    'public.canonical_source_namespace_policy(jsonb,integer)',
    'public.guard_canonical_source_connection_identity()',
    'public.fill_canonical_legacy_identity_namespaces()',
    'public.guard_canonical_team_identity()',
    'public.guard_canonical_enrollment_identity()',
    'public.validate_canonical_enrollment_parent()',
    'public.validate_canonical_registration_commit()',
    'public.revise_canonical_source_connection(uuid,text,uuid,text,text,text)',
    'public.validate_canonical_resource_mapping(jsonb)',
    'public.canonical_registration_policy(jsonb,jsonb,jsonb)',
    'public.resolve_canonical_season_teams(jsonb,jsonb,jsonb,jsonb)',
    'public.register_canonical_official_source(jsonb,jsonb,jsonb)',
    'public.canonical_exact_keys(jsonb,text[])',
    'public.canonical_standings_scope(jsonb)',
    'public.canonical_legacy_mapping(jsonb)',
    'public.canonical_resource_policy(jsonb,jsonb)',
    'public.canonical_fixture_job_context(jsonb,jsonb,jsonb)',
    'public.begin_canonical_resource_attempt(jsonb,uuid,jsonb,jsonb,jsonb)',
    'public.canonical_standings_fact_valid(jsonb,text)',
    'public.canonical_standings_reasons_valid(jsonb,boolean)',
    'public.validate_canonical_standings_value(jsonb,text,text)',
    'public.canonical_standings_coverage(jsonb,integer,boolean,boolean)',
    'public.verify_sleeper_standings_delivery(jsonb)',
    'public.verify_registered_canonical_delivery(jsonb,jsonb)',
    'public.canonical_native_hash(jsonb)',
    'public.canonical_value_hash(jsonb)',
    'public.canonical_attempt_identity(public.league_roster_resource_attempts)',
    'public.canonical_receipt_delivery(public.league_canonical_resource_receipts)',
    'public.canonical_receipt_evidence_hash(public.league_canonical_resource_receipts)',
    'public.assert_canonical_delivery_context(jsonb,boolean)',
    'public.canonical_standings_typed_value(uuid)',
    'public.materialize_canonical_standings(uuid,jsonb)',
    'public.guard_canonical_resource_insert()',
    'public.validate_canonical_standings_complete()',
    'public.validate_canonical_resource_receipt()',
    'public.canonical_resource_write_result(public.league_canonical_resource_receipts,boolean)',
    'public.accept_canonical_resource(jsonb,jsonb)',
    'public.record_league_administration_observation(jsonb)',
    'public.record_league_administration_observation_legacy_v65(jsonb)',
    'public.record_league_administration_observation_v54(jsonb)',
    'public.record_league_administration_observation_v53(jsonb)',
    'public.record_league_administration_observation_v52(jsonb)',
    'public.record_league_administration_observation_v48(jsonb)',
    'public.record_league_administration_observation_v47(jsonb)',
    'public.record_league_administration_observation_v45(jsonb)',
    'public.record_league_administration_observation_v42(jsonb)',
    'public.record_league_administration_observation_v34(jsonb)',
    'public.record_league_administration_observation_v32(jsonb)',
    'public.record_league_administration_observation_v31(jsonb)',
    'public.record_league_administration_observation_v30(jsonb)',
    'public.record_league_administration_observation_v29(jsonb)',
    'public.record_league_administration_observation_v1(jsonb)'] LOOP
    IF to_regprocedure(signature) IS NULL THEN RAISE EXCEPTION 'missing canonical function: %',signature; END IF;
    SELECT proc.oid,proc.proname,proc.proowner INTO STRICT function_entry FROM pg_proc proc WHERE proc.oid=to_regprocedure(signature);
    public_entry:=function_entry.proname IN ('record_league_administration_observation','begin_canonical_resource_attempt','register_canonical_official_source');
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC',signature);
    -- Preserve every existing inner writer's execution mode.
    FOREACH role_name IN ARRAY ARRAY['league_one_runtime','league_one_account','league_one_auth'] LOOP
      IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=role_name) THEN
        EXECUTE format('REVOKE ALL ON FUNCTION %s FROM %I',signature,role_name);
        IF public_entry AND role_name='league_one_runtime' THEN EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO %I',signature,role_name); END IF;
        IF has_function_privilege(role_name,function_entry.oid,'EXECUTE') IS DISTINCT FROM (public_entry AND role_name='league_one_runtime') THEN
          RAISE EXCEPTION 'incorrect canonical function effective privilege: % / %',role_name,signature; END IF;
        IF pg_has_role(role_name,function_entry.proowner,'MEMBER') THEN RAISE EXCEPTION 'restricted role can inherit or assume canonical function owner'; END IF;
        IF has_schema_privilege(role_name,'public','CREATE') THEN RAISE EXCEPTION 'restricted role can replace public schema objects'; END IF;
      END IF;
    END LOOP;
    IF EXISTS(SELECT 1 FROM pg_proc proc,LATERAL aclexplode(COALESCE(proc.proacl,acldefault('f',proc.proowner))) privilege
      WHERE proc.oid=function_entry.oid AND privilege.grantee=0 AND privilege.privilege_type='EXECUTE') THEN
      RAISE EXCEPTION 'public can execute canonical or inner writer function'; END IF;
  END LOOP;
  FOREACH relation_name IN ARRAY ARRAY['league_canonical_resource_contents','league_canonical_resource_receipts','league_canonical_standings_teams'] LOOP
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM PUBLIC',relation_name);
    FOREACH role_name IN ARRAY ARRAY['league_one_runtime','league_one_account','league_one_auth'] LOOP
      IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=role_name) THEN
        EXECUTE format('REVOKE ALL ON TABLE public.%I FROM %I',relation_name,role_name);
        IF role_name='league_one_runtime' THEN EXECUTE format('GRANT SELECT ON TABLE public.%I TO %I',relation_name,role_name); END IF;
        IF has_table_privilege(role_name,'public.'||relation_name,denied)
          OR has_any_column_privilege(role_name,'public.'||relation_name,'INSERT,UPDATE,REFERENCES')
          OR has_table_privilege(role_name,'public.'||relation_name,'SELECT') IS DISTINCT FROM (role_name='league_one_runtime') THEN
          RAISE EXCEPTION 'incorrect canonical evidence effective privileges'; END IF;
      END IF;
    END LOOP;
  END LOOP;
END; $$;

CREATE OR REPLACE FUNCTION public.derive_public_data_capture_witness(p_work jsonb,p_mapping jsonb,p_fence jsonb)
RETURNS jsonb LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE dispatch public.public_data_dispatches%ROWTYPE; reserved record; companion_id uuid; companion_reserved_at timestamptz; native_players_reserved_at timestamptz;
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
  IF kind IN ('core','users','exact-matchups','playoff-brackets','weekly-report','transactions','drafts') THEN
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
    -- Exhaustive partition; the one checked companion is absent from the native v1 witness.
    IF reserved.identity->'scope'->>'family'='standings' THEN
      IF companion_id IS NOT NULL OR kind<>'core' OR reserved.capture_nonce IS NULL
        OR reserved.reserved_at<dispatch.admitted_at OR reserved.reserved_at>clock_timestamp()
        OR reserved.canonical_reservation_context IS NOT NULL
        OR reserved.source_mapping->'scope'->>'provider' IS DISTINCT FROM 'sleeper'
        OR public.canonical_legacy_mapping(reserved.source_mapping) IS DISTINCT FROM p_mapping
        OR reserved.identity IS DISTINCT FROM jsonb_build_object('scope',public.canonical_standings_scope(reserved.source_mapping),
          'policy',public.canonical_resource_policy(reserved.source_mapping,reserved.identity->'policy'))
        OR reserved.identity->'policy'->>'originPolicy' IS DISTINCT FROM 'network-bridge-v1' THEN
        RAISE EXCEPTION 'public capture canonical companion mismatch'; END IF;
      companion_id:=reserved.id;companion_reserved_at:=reserved.reserved_at;
      CONTINUE;
    END IF;
    IF kind NOT IN ('core','exact-matchups','playoff-brackets','weekly-report','transactions','drafts') OR reserved.source_mapping IS DISTINCT FROM p_mapping
      OR reserved.capture_nonce IS NULL OR reserved.reserved_at<dispatch.admitted_at
      OR reserved.reserved_at>clock_timestamp() THEN
      RAISE EXCEPTION 'public capture reservation mismatch'; END IF;
    role_name:=CASE reserved.identity->'policy'->>'canonicalNormalizerVersion'
      WHEN 'sleeper-league-settings-v1' THEN 'settings'
      WHEN 'sleeper-current-players-v1' THEN 'players'
      WHEN 'sleeper-current-team-managers-v1' THEN 'managers'
      WHEN 'sleeper-current-team-manager-evidence-v2' THEN 'managersV2'
      WHEN 'sleeper-exact-matchups-v1' THEN 'matchups'
      WHEN 'sleeper-transactions-v1' THEN CASE WHEN reserved.identity->'scope'->>'family'='transactions'
        AND reserved.identity->'scope'->'entityId'='null'::jsonb
        AND reserved.identity->'scope'->>'scoringPeriodId'='sleeper:transaction-week:'||(p_work->>'nativeWeek') THEN 'transactions' END
      WHEN 'sleeper-weekly-report-v1' THEN CASE WHEN reserved.identity->'scope'->>'family'='weekly-reports'
        AND reserved.identity->'scope'->>'entityId'='league_report'
        AND reserved.identity->'scope'->>'scoringPeriodId'='sleeper:report-week:'||(p_work->>'nativeWeek') THEN 'weekly_report' END
      WHEN 'sleeper-playoff-brackets-v1' THEN CASE WHEN reserved.identity->'scope'->>'family'='playoff-brackets'
        AND reserved.identity->'scope'->>'entityId' IN ('winners_bracket','losers_bracket')
        AND reserved.identity->'scope'->'scoringPeriodId'='null'::jsonb THEN reserved.identity->'scope'->>'entityId' END
      WHEN 'sleeper-draft-metadata-v1' THEN CASE WHEN kind='drafts'
        AND reserved.identity=public.public_data_draft_identity(p_work,p_mapping) THEN 'draftMetadata' END
      WHEN 'sleeper-draft-selections-v1' THEN CASE WHEN kind='drafts'
        AND reserved.identity=public.public_data_draft_identity(p_work,p_mapping) THEN 'draftSelections' END
      WHEN 'sleeper-traded-picks-v1' THEN CASE WHEN kind='drafts'
        AND reserved.identity=public.public_data_draft_identity(p_work,p_mapping) THEN 'tradedPicks' END
      ELSE NULL END;
    IF role_name IS NULL OR attempts ? role_name
      OR (role_name='matchups' AND reserved.identity->'scope'->>'scoringPeriodId'
        IS DISTINCT FROM 'sleeper:matchup-week:'||(p_work->>'nativeWeek')) THEN
      RAISE EXCEPTION 'public capture resource group mismatch'; END IF;
    IF role_name='players' THEN native_players_reserved_at:=reserved.reserved_at; END IF;
    attempts:=attempts||jsonb_build_object(role_name,jsonb_build_object('id',reserved.id,'nonce',reserved.capture_nonce));
  END LOOP;
  SELECT COALESCE(array_agg(key ORDER BY key COLLATE "C"),ARRAY[]::text[]) INTO role_names FROM jsonb_object_keys(attempts) key;
  IF (kind='core' AND role_names NOT IN (ARRAY['managers','players','settings'],ARRAY['managers','managersV2','players','settings']))
    OR (kind='exact-matchups' AND role_names<>ARRAY['matchups','settings'])
    OR (kind='playoff-brackets' AND role_names<>ARRAY['losers_bracket','winners_bracket'])
    OR (kind='weekly-report' AND role_names<>ARRAY['weekly_report'])
    OR (kind='transactions' AND role_names<>ARRAY['transactions'])
    OR (kind='drafts' AND (dispatch.max_requests<>1 OR role_names<>CASE p_work->>'resource'
      WHEN 'catalog' THEN ARRAY['draftMetadata'] WHEN 'detail' THEN ARRAY['draftMetadata'] WHEN 'selections' THEN ARRAY['draftSelections']
      WHEN 'league-trades' THEN ARRAY['tradedPicks'] WHEN 'draft-trades' THEN ARRAY['tradedPicks'] ELSE ARRAY[]::text[] END))
    OR (kind NOT IN ('core','exact-matchups','playoff-brackets','weekly-report','transactions','drafts') AND cardinality(role_names)<>0) THEN
    RAISE EXCEPTION 'complete public capture group required'; END IF;
  IF companion_id IS NOT NULL AND (native_players_reserved_at IS NULL OR companion_reserved_at>native_players_reserved_at) THEN
    RAISE EXCEPTION 'canonical companion must precede native players reservation'; END IF;
  -- Recheck after every preceding source/job lock wait. The original DB admission
  -- bounds freshness even when identical content later deduplicates to an old row.
  PERFORM public.assert_public_data_owner(dispatch.intake_id,p_fence);
  IF dispatch.admitted_at<clock_timestamp()-interval '30 seconds' THEN
    RAISE EXCEPTION 'public capture admission expired'; END IF;
  witness:=jsonb_build_object('version','public-network-capture-v1','work',p_work,'fence',p_fence,
    'dispatchNonce',dispatch.capture_nonce,'mapping',p_mapping,'attempts',attempts);
  RETURN witness;
END; $$;
