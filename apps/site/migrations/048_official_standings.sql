-- CP13: independent typed standings bound to existing roster capture receipts.
-- No new source request, reservation, resource head, scheduling or core completion.
-- Effective predecessors remain private. Existing migration history is unchanged.


-- Only CP13 season2026 may record absent roster population; supplied mismatches and earlier seasons still reject.
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
    IF (family_value='matchups' OR (family_value='rosters'
      AND (witness->'work'->>'season' IS DISTINCT FROM '2026' OR addition ? 'population')))
      AND addition->'population'->'envelope'->'provenance'->'acquisition' IS DISTINCT FROM witness THEN
      RAISE EXCEPTION 'public capture population group mismatch'; END IF;
  END LOOP;
END; $$;

-- Only CP13 season2026 may record absent roster population; supplied mismatches and earlier seasons still reject.
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
      OR ((family_value='matchups' OR (family_value='rosters'
      AND (witness->'work'->>'season' IS DISTINCT FROM '2026' OR addition ? 'population')))
      AND addition->'population'->'envelope'->'provenance'->'acquisition' IS DISTINCT FROM witness) THEN
      RAISE EXCEPTION 'complete witnessed writer input required'; END IF;
  END LOOP;
END; $$;

-- A witnessed capture without population must not borrow an older count proof.
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
  -- Exact immutable retries above retain their original fence/replay semantics.
  PERFORM public.assert_public_capture_observation(p_input,CASE WHEN league_resource THEN 'settings'
    WHEN manager_resource THEN 'managers' ELSE 'players' END);
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
      AND public.public_capture_after_reservation(provenance,attempt.id);
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
  ELSIF provenance->'acquisition' IS NULL THEN
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

-- A witnessed capture without population must not borrow an older count proof.
CREATE OR REPLACE FUNCTION public.record_league_administration_observation_v42(p_input jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE result jsonb; addition jsonb:=p_input->'teamManagerEvidenceAcceptance'; token jsonb;
  projection jsonb:=p_input->'teamManagerEvidence'; provenance jsonb:=p_input->'envelope'->'provenance';
  population jsonb; population_proof jsonb; expected_count integer; covered boolean;
  attempt public.league_roster_resource_attempts%ROWTYPE; head public.league_roster_resource_heads%ROWTYPE;
  content public.league_administration_contents%ROWTYPE; configuration public.league_administration_contents%ROWTYPE;
  receipt public.league_roster_capture_receipts%ROWTYPE;
  evidence_hash_value text; reason_value text; reasons_value jsonb; acceptance_id uuid;
  projected_team jsonb; team_identity uuid; manager_key text; manager_identity uuid;
BEGIN
  PERFORM public.assert_public_capture_input_shape(p_input);
  IF p_input->'envelope'->>'family'='users' THEN
    PERFORM public.assert_public_capture_observation(p_input,NULL);
  END IF;
  result:=public.record_league_administration_observation_v34(p_input-'teamManagerEvidenceAcceptance'-'teamManagerEvidence');
  IF addition IS NULL THEN RETURN result; END IF;
  token:=addition->'attempt'; population:=addition->'population';
  IF p_input->'envelope'->>'family' IS DISTINCT FROM 'rosters'
    OR p_input->'envelope'->'week' IS DISTINCT FROM 'null'::jsonb
    OR provenance->>'origin' IS DISTINCT FROM 'network' OR p_input->'sourceMapping' IS NULL THEN
    RAISE EXCEPTION 'manager evidence requires mapped network capture'; END IF;
  IF p_input->'envelope'->'scope' IS DISTINCT FROM p_input->'sourceMapping'->'scope' THEN
    RAISE EXCEPTION 'manager evidence envelope mapping mismatch'; END IF;
  PERFORM public.validate_current_roster_mapping(p_input->'sourceMapping');
  SELECT * INTO STRICT attempt FROM public.league_roster_resource_attempts WHERE id=(token->>'id')::uuid;
  IF attempt.source_mapping IS DISTINCT FROM p_input->'sourceMapping' OR attempt.write_fence IS DISTINCT FROM p_input->'writeFence'
    OR token IS DISTINCT FROM jsonb_build_object('id',attempt.id,'scopeId',attempt.scope_id,'ordinal',attempt.ordinal,
      'expectedGeneration',attempt.expected_generation) THEN RAISE EXCEPTION 'manager evidence attempt scope mismatch'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.league_roster_resource_scopes scope WHERE scope.id=attempt.scope_id
    AND scope.identity->'scope'->>'family'='teams'
    AND scope.identity->'scope'->>'coverageSpecId'='sleeper-current-all-teams-manager-evidence-v2'
    AND scope.identity->'policy'=jsonb_build_object('audienceId','public','coverageSpecId','sleeper-current-all-teams-manager-evidence-v2',
      'canonicalNormalizerVersion','sleeper-current-team-manager-evidence-v2','validationVersion','latest-network-attempt-v1')) THEN
    RAISE EXCEPTION 'manager evidence resource attempt policy mismatch'; END IF;
  SELECT * INTO STRICT head FROM public.league_roster_resource_heads WHERE scope_id=attempt.scope_id FOR UPDATE;
  IF attempt.write_fence IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.projection_jobs job
    WHERE job.job_key=attempt.write_fence->>'jobKey' AND job.state='running' AND job.lease_owner=attempt.write_fence->>'workerId'
      AND job.attempt_count=(attempt.write_fence->>'generation')::integer AND job.lease_until>clock_timestamp()
      AND (attempt.write_fence->>'deadlineAt')::timestamptz>clock_timestamp()) THEN
    RAISE EXCEPTION 'manager evidence writer fence expired'; END IF;
  evidence_hash_value:=encode(digest(convert_to(p_input::text,'UTF8'),'sha256'),'hex');
  SELECT * INTO receipt FROM public.league_roster_capture_receipts WHERE attempt_id=attempt.id;
  IF FOUND THEN
    IF receipt.evidence_hash<>evidence_hash_value THEN RAISE EXCEPTION 'manager evidence attempt receipt conflict'; END IF;
    RETURN result||jsonb_build_object('teamManagerEvidenceAcceptance',jsonb_build_object('status',
      CASE WHEN EXISTS(SELECT 1 FROM public.league_roster_resource_acceptances accepted
        WHERE accepted.id=head.accepted_id AND accepted.receipt_id=receipt.id) AND attempt.ordinal=head.latest_ordinal
        THEN 'accepted' ELSE 'preserved' END,'reason','exact_receipt_replay','receiptId',receipt.id,'acceptedGeneration',head.generation));
  END IF;
  PERFORM public.assert_public_capture_observation(p_input,'managersV2');
  SELECT * INTO STRICT content FROM public.league_administration_contents stored
    WHERE stored.league_season_id=(attempt.source_mapping->>'leagueSeasonId')::uuid AND stored.provider='sleeper'
      AND stored.external_league_id=attempt.source_mapping->'scope'->>'externalLeagueId'
      AND stored.family='rosters' AND stored.week=0 AND stored.normalizer_version='sleeper-administration-v1'
      AND stored.content_hash=p_input->>'contentHash' AND stored.completeness=p_input->'envelope'->>'completeness'
      AND stored.accepted=(p_input->>'status'='accepted' AND p_input->'envelope'->>'completeness'='complete')
      AND stored.payload=p_input->'envelope'->'payload' AND stored.normalized_value IS NOT DISTINCT FROM p_input->'value';
  -- The same population proof and effective034 official-settings correction as existing v1.
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
  ELSIF provenance->'acquisition' IS NULL THEN
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

  covered:=COALESCE(content.completeness='complete' AND expected_count>0
    AND public.public_capture_after_reservation(provenance,attempt.id)
    AND (provenance->>'sourceObservedAt')::timestamptz IS NOT NULL
    AND public.qualify_team_manager_evidence_projection(content.payload,projection,content.external_league_id,expected_count),false);
  IF covered THEN
    FOR projected_team IN SELECT value FROM jsonb_array_elements(projection->'teams') LOOP
      INSERT INTO public.league_season_teams(league_season_id,provider,external_league_id,external_roster_id)
        VALUES(content.league_season_id,content.provider,content.external_league_id,projected_team->>'externalRosterId') ON CONFLICT DO NOTHING;
      SELECT id INTO STRICT team_identity FROM public.league_season_teams WHERE league_season_id=content.league_season_id
        AND provider=content.provider AND external_league_id=content.external_league_id AND external_roster_id=projected_team->>'externalRosterId';
      INSERT INTO public.league_team_manager_entries(content_id,normalizer_version,league_season_id,team_id,source_value)
        VALUES(content.id,'sleeper-current-team-manager-evidence-v2',content.league_season_id,team_identity,projected_team) ON CONFLICT DO NOTHING;
      IF NOT EXISTS(SELECT 1 FROM public.league_team_manager_entries WHERE content_id=content.id
        AND normalizer_version='sleeper-current-team-manager-evidence-v2' AND team_id=team_identity AND source_value=projected_team) THEN
        RAISE EXCEPTION 'team manager evidence content conflict'; END IF;
      FOR manager_key IN SELECT value FROM (
        SELECT projected_team->'primaryOwner'->>'externalManagerId' AS value WHERE projected_team->'primaryOwner'->>'state'='owned'
        UNION ALL SELECT jsonb_array_elements_text(projected_team->'coManagers'->'externalManagerIds')
          WHERE projected_team->'coManagers'->>'state' IN ('known','partial')
      ) managers LOOP
        INSERT INTO public.league_source_manager_accounts(provider,external_manager_id) VALUES(content.provider,manager_key) ON CONFLICT DO NOTHING;
        SELECT id INTO STRICT manager_identity FROM public.league_source_manager_accounts WHERE provider=content.provider AND external_manager_id=manager_key;
        INSERT INTO public.league_team_manager_memberships(content_id,normalizer_version,league_season_id,team_id,manager_id,role)
          VALUES(content.id,'sleeper-current-team-manager-evidence-v2',content.league_season_id,team_identity,manager_identity,
            CASE WHEN manager_key=projected_team->'primaryOwner'->>'externalManagerId' THEN 'owner' ELSE 'co_owner' END) ON CONFLICT DO NOTHING;
      END LOOP;
    END LOOP;
    SELECT COALESCE(jsonb_agg(code ORDER BY code COLLATE "C"),'[]'::jsonb) INTO reasons_value
      FROM (SELECT DISTINCT value->>'code' AS code FROM jsonb_array_elements(projection->'diagnostics')) reasons;
  ELSE reasons_value:='["complete_manager_evidence_population_unproved"]'::jsonb; END IF;
  reason_value:=CASE WHEN attempt.ordinal<>head.latest_ordinal THEN 'newer_network_attempt_reserved'
    WHEN attempt.expected_generation<>head.generation THEN 'accepted_generation_changed'
    WHEN NOT covered THEN 'complete_manager_evidence_population_unproved' ELSE NULL END;
  INSERT INTO public.league_roster_capture_receipts(attempt_id,content_id,legacy_observation_id,evidence_hash,
    provenance,configuration_content_id,population_evidence,expected_team_count,coverage)
    VALUES(attempt.id,content.id,(result->>'observationId')::uuid,evidence_hash_value,provenance,configuration.id,population_proof,expected_count,
      jsonb_build_object('periodIds','[]'::jsonb,'interval',NULL,'entitySet',CASE WHEN covered THEN 'full' ELSE 'unknown' END,
        'fields','["owner_id","co_owners"]'::jsonb,'pagination','complete','nextCursor',NULL,
        'completeness',CASE WHEN covered THEN projection->>'status' ELSE 'unknown' END,'reasons',reasons_value)) RETURNING * INTO receipt;
  IF reason_value IS NULL THEN
    IF attempt.write_fence IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.projection_jobs job
      WHERE job.job_key=attempt.write_fence->>'jobKey' AND job.state='running' AND job.lease_owner=attempt.write_fence->>'workerId'
        AND job.attempt_count=(attempt.write_fence->>'generation')::integer AND job.lease_until>clock_timestamp()
        AND (attempt.write_fence->>'deadlineAt')::timestamptz>clock_timestamp()) THEN
      RAISE EXCEPTION 'manager evidence writer fence expired'; END IF;
    INSERT INTO public.league_roster_resource_acceptances(scope_id,receipt_id,source_mapping_revision_id,generation)
      VALUES(attempt.scope_id,receipt.id,(attempt.source_mapping->>'revisionId')::uuid,head.generation+1) RETURNING id INTO acceptance_id;
    UPDATE public.league_roster_resource_heads SET accepted_id=acceptance_id,generation=generation+1
      WHERE scope_id=attempt.scope_id RETURNING * INTO head;
  END IF;
  RETURN result||jsonb_build_object('teamManagerEvidenceAcceptance',jsonb_build_object('status',
    CASE WHEN reason_value IS NULL THEN 'accepted' ELSE 'preserved' END,'reason',reason_value,'receiptId',receipt.id,'acceptedGeneration',head.generation));
END; $$;

CREATE TABLE public.league_official_standings_contents (
  content_id uuid PRIMARY KEY REFERENCES public.league_administration_contents(id),
  value_version text NOT NULL CHECK(value_version='sleeper-official-standings-v1'),
  first_receipt_id uuid NOT NULL REFERENCES public.league_roster_capture_receipts(id),
  capture_transaction xid8 NOT NULL DEFAULT pg_current_xact_id(),
  structural_status text NOT NULL CHECK(structural_status IN ('qualified','invalid','capacity')),
  team_count integer NOT NULL CHECK(team_count BETWEEN 0 AND 20),
  reasons jsonb NOT NULL CHECK(jsonb_typeof(reasons)='array')
);
CREATE TABLE public.league_official_standings_teams (
  content_id uuid NOT NULL REFERENCES public.league_official_standings_contents(content_id),
  external_roster_id text NOT NULL,
  season_team_id uuid NOT NULL REFERENCES public.league_season_teams(id),
  source_ordinal integer NOT NULL CHECK(source_ordinal BETWEEN 0 AND 19),
  field_states jsonb NOT NULL CHECK(jsonb_typeof(field_states)='object'),
  wins bigint, losses bigint, ties bigint,
  fpts numeric, fpts_decimal numeric, fpts_against numeric, fpts_against_decimal numeric,
  rank bigint, seed bigint,
  points_for_state text NOT NULL CHECK(points_for_state IN ('known','absent','null','invalid')),
  points_for_value text,
  points_against_state text NOT NULL CHECK(points_against_state IN ('known','absent','null','invalid')),
  points_against_value text,
  PRIMARY KEY(content_id,external_roster_id), UNIQUE(content_id,source_ordinal), UNIQUE(content_id,season_team_id)
);
CREATE TABLE public.league_official_standings_captures (
  receipt_id uuid PRIMARY KEY REFERENCES public.league_roster_capture_receipts(id),
  content_id uuid NOT NULL REFERENCES public.league_official_standings_contents(content_id),
  value_version text NOT NULL CHECK(value_version='sleeper-official-standings-v1'),
  attempt_id uuid NOT NULL UNIQUE REFERENCES public.league_roster_resource_attempts(id),
  attempt_ordinal bigint NOT NULL CHECK(attempt_ordinal>0),
  source_mapping jsonb NOT NULL,
  expected_team_count integer CHECK(expected_team_count>0),
  population_state text NOT NULL CHECK(population_state IN ('proven','unproved','mismatch')),
  entity_set text NOT NULL CHECK(entity_set IN ('full','partial','unknown')),
  record_completeness text NOT NULL CHECK(record_completeness IN ('complete','partial','unknown')),
  reasons jsonb NOT NULL CHECK(jsonb_typeof(reasons)='array'),
  intake_id uuid REFERENCES public.public_data_intakes(id), worker_id text, generation integer,
  recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  FOREIGN KEY(worker_id,generation) REFERENCES public.public_data_dispatches(worker_id,generation),
  CHECK((intake_id IS NULL AND worker_id IS NULL AND generation IS NULL)
    OR (intake_id IS NOT NULL AND worker_id IS NOT NULL AND generation IS NOT NULL))
);
CREATE INDEX official_standings_capture_intake ON public.league_official_standings_captures(intake_id,attempt_ordinal DESC)
  WHERE intake_id IS NOT NULL;
CREATE INDEX public_data_dispatches_intake_resource_revision ON public.public_data_dispatches(intake_id,resource,revision DESC);

-- SQL independently projects the same nine native fields. Null, absent and invalid
-- remain distinct; no default W/L/T, ranking, seed, whole points or missing count.
CREATE FUNCTION public.official_standings_native_fact(p_settings jsonb,p_key text,p_integer boolean DEFAULT false,p_minimum integer DEFAULT 0)
RETURNS jsonb LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE state_value text; raw jsonb:=p_settings->p_key; number_value numeric;
BEGIN
  IF jsonb_typeof(p_settings) IS DISTINCT FROM 'object' THEN state_value:='invalid';
  ELSIF NOT p_settings ? p_key THEN state_value:='absent';
  ELSIF raw='null'::jsonb THEN state_value:='null';
  ELSIF jsonb_typeof(raw) IS DISTINCT FROM 'number' THEN state_value:='invalid';
  ELSE
    number_value:=(raw#>>'{}')::numeric;
    state_value:=CASE WHEN abs(number_value)>1.7976931348623157e308::numeric
      OR (p_integer AND (number_value<>trunc(number_value) OR number_value<p_minimum OR number_value>9007199254740991))
      THEN 'invalid' ELSE 'known' END;
  END IF;
  RETURN jsonb_build_object('state',state_value,'value',CASE WHEN state_value='known' THEN raw ELSE 'null'::jsonb END,
    'sourcePath','settings.'||p_key);
END; $$;
CREATE FUNCTION public.official_standings_native_points(p_settings jsonb,p_whole text,p_fraction text)
RETURNS jsonb LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE whole_fact jsonb:=public.official_standings_native_fact(p_settings,p_whole);
  fraction_fact jsonb:=public.official_standings_native_fact(p_settings,p_fraction); state_value text; amount numeric; decimal_value text;
BEGIN
  state_value:=CASE WHEN whole_fact->>'state'<>'known' THEN whole_fact->>'state'
    WHEN fraction_fact->>'state' IN ('known','absent') THEN 'known' ELSE fraction_fact->>'state' END;
  IF state_value='known' THEN
    amount:=(whole_fact->>'value')::numeric+COALESCE((fraction_fact->>'value')::numeric,0)/100;
    decimal_value:=trim_scale(amount)::text;
  END IF;
  RETURN jsonb_build_object('whole',whole_fact,'fraction',fraction_fact,'state',state_value,'value',decimal_value,
    'policy','sleeper-whole-plus-hundredths-v1');
END; $$;
CREATE FUNCTION public.project_official_standings_native(p_payload jsonb,p_external_league_id text)
RETURNS jsonb LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE item record; raw jsonb; settings jsonb; native_id text; seen text[]:=ARRAY[]::text[]; teams jsonb:='[]'::jsonb;
  reason_value text; status_value text:='qualified';
BEGIN
  IF jsonb_typeof(p_payload) IS DISTINCT FROM 'array' THEN reason_value:='invalid_roster_identity';status_value:='invalid';
  ELSIF jsonb_array_length(p_payload)>20 THEN reason_value:='standings_team_limit_exceeded';status_value:='capacity';
  ELSE
    FOR item IN SELECT value,ordinality FROM jsonb_array_elements(p_payload) WITH ORDINALITY LOOP
      raw:=item.value;
      IF jsonb_typeof(raw) IS DISTINCT FROM 'object' OR jsonb_typeof(raw->'roster_id') IS DISTINCT FROM 'number' THEN
        reason_value:='invalid_roster_identity'; EXIT; END IF;
      IF (raw->>'roster_id')::numeric<1 OR (raw->>'roster_id')::numeric>9007199254740991
        OR (raw->>'roster_id')::numeric<>trunc((raw->>'roster_id')::numeric)
        OR (raw ? 'league_id' AND (jsonb_typeof(raw->'league_id') IS DISTINCT FROM 'string'
          OR raw->>'league_id' IS DISTINCT FROM p_external_league_id)) THEN reason_value:='invalid_roster_identity';EXIT;END IF;
      native_id:=((raw->>'roster_id')::numeric)::bigint::text;
      IF native_id=ANY(seen) THEN reason_value:='invalid_roster_identity';EXIT;END IF;
      seen:=array_append(seen,native_id);
      settings:=CASE WHEN raw ? 'settings' THEN raw->'settings' ELSE '{}'::jsonb END;
      teams:=teams||jsonb_build_array(jsonb_build_object('externalRosterId',native_id,'sourceOrdinal',item.ordinality-1,
        'record',jsonb_build_object('wins',public.official_standings_native_fact(settings,'wins',true),
          'losses',public.official_standings_native_fact(settings,'losses',true),'ties',public.official_standings_native_fact(settings,'ties',true)),
        'pointsFor',public.official_standings_native_points(settings,'fpts','fpts_decimal'),
        'pointsAgainst',public.official_standings_native_points(settings,'fpts_against','fpts_against_decimal'),
        'providerRank',public.official_standings_native_fact(settings,'rank',true,1),
        'providerSeed',public.official_standings_native_fact(settings,'seed',true,1)));
    END LOOP;
    IF reason_value IS NOT NULL THEN status_value:='invalid';teams:='[]'::jsonb; END IF;
  END IF;
  -- Twenty bounded rows/nine fixed fields cannot approach 1 MiB. Keep the transport
  -- ceiling explicit; source payload size belongs to the existing raw capture gate.
  IF reason_value IS NULL AND octet_length(convert_to(teams::text,'UTF8'))>1048576 THEN
    reason_value:='standings_byte_limit_exceeded';status_value:='capacity';teams:='[]'::jsonb; END IF;
  RETURN jsonb_build_object('version','sleeper-official-standings-v1','status',status_value,'teams',teams,
    'reasons',CASE WHEN reason_value IS NULL THEN '[]'::jsonb ELSE jsonb_build_array(reason_value) END);
END; $$;

CREATE FUNCTION public.official_standings_typed_value(p_content_id uuid)
RETURNS jsonb LANGUAGE sql STABLE SET search_path=pg_catalog,public,pg_temp AS $$
  SELECT jsonb_build_object('version',header.value_version,'status',header.structural_status,'reasons',header.reasons,
    'teams',COALESCE((SELECT jsonb_agg(jsonb_build_object('externalRosterId',team.external_roster_id,'sourceOrdinal',team.source_ordinal,
      'record',jsonb_build_object('wins',jsonb_build_object('state',team.field_states->>'wins','value',team.wins,'sourcePath','settings.wins'),
        'losses',jsonb_build_object('state',team.field_states->>'losses','value',team.losses,'sourcePath','settings.losses'),
        'ties',jsonb_build_object('state',team.field_states->>'ties','value',team.ties,'sourcePath','settings.ties')),
      'pointsFor',jsonb_build_object('whole',jsonb_build_object('state',team.field_states->>'fpts','value',team.fpts,'sourcePath','settings.fpts'),
        'fraction',jsonb_build_object('state',team.field_states->>'fpts_decimal','value',team.fpts_decimal,'sourcePath','settings.fpts_decimal'),
        'state',team.points_for_state,'value',team.points_for_value,'policy','sleeper-whole-plus-hundredths-v1'),
      'pointsAgainst',jsonb_build_object('whole',jsonb_build_object('state',team.field_states->>'fpts_against','value',team.fpts_against,'sourcePath','settings.fpts_against'),
        'fraction',jsonb_build_object('state',team.field_states->>'fpts_against_decimal','value',team.fpts_against_decimal,'sourcePath','settings.fpts_against_decimal'),
        'state',team.points_against_state,'value',team.points_against_value,'policy','sleeper-whole-plus-hundredths-v1'),
      'providerRank',jsonb_build_object('state',team.field_states->>'rank','value',team.rank,'sourcePath','settings.rank'),
      'providerSeed',jsonb_build_object('state',team.field_states->>'seed','value',team.seed,'sourcePath','settings.seed')) ORDER BY team.source_ordinal)
      FROM public.league_official_standings_teams team WHERE team.content_id=header.content_id),'[]'::jsonb))
  FROM public.league_official_standings_contents header WHERE header.content_id=p_content_id;
$$;

-- Qualification uses this receipt's immutable population evidence, never a prior
-- accepted players head. Same-source count mismatch retains supplied native facts.
CREATE FUNCTION public.official_standings_receipt_coverage(p_receipt_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE receipt public.league_roster_capture_receipts%ROWTYPE; attempt public.league_roster_resource_attempts%ROWTYPE;
  content public.league_administration_contents%ROWTYPE; header public.league_official_standings_contents%ROWTYPE;
  configuration public.league_administration_contents%ROWTYPE; expected integer; population text; entity text; records text; reasons jsonb;
BEGIN
  SELECT * INTO STRICT receipt FROM public.league_roster_capture_receipts WHERE id=p_receipt_id;
  SELECT * INTO STRICT attempt FROM public.league_roster_resource_attempts WHERE id=receipt.attempt_id;
  SELECT * INTO STRICT content FROM public.league_administration_contents WHERE id=receipt.content_id;
  SELECT * INTO STRICT header FROM public.league_official_standings_contents WHERE content_id=receipt.content_id;
  IF receipt.population_evidence->'provenance'->'acquisition' IS NOT DISTINCT FROM receipt.provenance->'acquisition'
    AND (receipt.provenance->'acquisition' IS NOT NULL
      OR (receipt.population_evidence->'provenance'->>'requestStartedAt')::timestamptz>=attempt.reserved_at) THEN
    -- The legacy expected count is additionally gated by scoring compatibility.
    -- Official native population is independent from those derived-feature gates.
    SELECT * INTO configuration FROM public.league_administration_contents candidate
      WHERE candidate.id=receipt.configuration_content_id AND candidate.league_season_id=content.league_season_id
        AND candidate.provider=content.provider AND candidate.external_league_id=content.external_league_id
        AND candidate.family='league' AND candidate.week=0 AND candidate.normalizer_version='sleeper-administration-v1'
        AND candidate.accepted AND candidate.completeness='complete'
        AND candidate.content_hash=receipt.population_evidence->>'contentHash'
        AND candidate.payload->'league_id'=to_jsonb(content.external_league_id)
        AND candidate.payload->'season'=to_jsonb(attempt.source_mapping->'scope'->>'season')
        AND candidate.payload->'sport'='"nfl"'::jsonb
        AND EXISTS(SELECT 1 FROM public.league_administration_observations observation
          WHERE observation.id=(receipt.population_evidence->>'observationId')::uuid AND observation.content_id=candidate.id
            AND observation.league_season_id=candidate.league_season_id AND observation.family='league' AND observation.week=0);
    IF FOUND AND jsonb_typeof(configuration.payload->'total_rosters')='number'
      AND (configuration.payload->>'total_rosters')::numeric BETWEEN 1 AND 2147483647
      AND (configuration.payload->>'total_rosters')::numeric=trunc((configuration.payload->>'total_rosters')::numeric) THEN
      expected:=(configuration.payload->>'total_rosters')::integer;
    END IF;
  END IF;
  population:=CASE WHEN expected IS NULL THEN 'unproved' WHEN header.structural_status='qualified' AND expected=header.team_count
    THEN 'proven' ELSE 'mismatch' END;
  entity:=CASE WHEN header.structural_status='qualified' AND content.completeness='complete' AND population='proven' THEN 'full'
    WHEN header.structural_status='qualified' AND (population='mismatch' OR content.completeness='partial') THEN 'partial' ELSE 'unknown' END;
  records:=CASE WHEN header.structural_status<>'qualified' OR header.team_count=0 THEN 'unknown'
    WHEN NOT EXISTS(SELECT 1 FROM public.league_official_standings_teams WHERE content_id=content.id
      AND (field_states->>'wins'<>'known' OR field_states->>'losses'<>'known' OR field_states->>'ties'<>'known'
        OR points_for_state<>'known' OR points_against_state<>'known')) THEN 'complete' ELSE 'partial' END;
  reasons:=header.reasons;
  IF population<>'proven' THEN reasons:=reasons||jsonb_build_array('standings_population_'||population); END IF;
  IF content.completeness='partial' THEN reasons:=reasons||'["standings_capture_partial"]'::jsonb; END IF;
  IF records<>'complete' THEN reasons:=reasons||'["standings_record_fields_incomplete"]'::jsonb; END IF;
  RETURN jsonb_build_object('expectedTeamCount',expected,'population',population,'entitySet',entity,'recordCompleteness',records,'reasons',reasons);
END; $$;

CREATE FUNCTION public.guard_official_standings_insert() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE content public.league_administration_contents%ROWTYPE; receipt public.league_roster_capture_receipts%ROWTYPE;
  attempt public.league_roster_resource_attempts%ROWTYPE; witness jsonb; qualified jsonb;
BEGIN
  SELECT * INTO STRICT content FROM public.league_administration_contents WHERE id=NEW.content_id;
  IF content.provider<>'sleeper' OR content.family<>'rosters' OR content.week<>0
    OR content.normalizer_version<>'sleeper-administration-v1' THEN RAISE EXCEPTION 'official standings content scope mismatch'; END IF;
  IF TG_TABLE_NAME='league_official_standings_teams' THEN
    IF NOT EXISTS(SELECT 1 FROM public.league_official_standings_contents header
      WHERE header.content_id=NEW.content_id AND header.capture_transaction=pg_current_xact_id() AND header.structural_status='qualified')
      OR NOT EXISTS(SELECT 1 FROM public.league_season_teams team WHERE team.id=NEW.season_team_id
        AND team.league_season_id=content.league_season_id AND team.provider=content.provider
        AND team.external_league_id=content.external_league_id AND team.external_roster_id=NEW.external_roster_id)
      OR (SELECT array_agg(key ORDER BY key COLLATE "C") FROM jsonb_object_keys(NEW.field_states) key)
        IS DISTINCT FROM ARRAY['fpts','fpts_against','fpts_against_decimal','fpts_decimal','losses','rank','seed','ties','wins'] THEN
      RAISE EXCEPTION 'official standings child lineage mismatch'; END IF;
    RETURN NEW;
  END IF;
  SELECT * INTO STRICT receipt FROM public.league_roster_capture_receipts
    WHERE id=(to_jsonb(NEW)->>CASE WHEN TG_TABLE_NAME='league_official_standings_contents' THEN 'first_receipt_id' ELSE 'receipt_id' END)::uuid;
  SELECT * INTO STRICT attempt FROM public.league_roster_resource_attempts WHERE id=receipt.attempt_id;
  IF receipt.content_id<>NEW.content_id OR NOT EXISTS(SELECT 1 FROM public.league_roster_resource_scopes scope
    WHERE scope.id=attempt.scope_id AND scope.league_season_id=content.league_season_id
      AND scope.identity->'policy'->>'canonicalNormalizerVersion'='sleeper-current-players-v1')
    OR attempt.source_mapping->>'leagueSeasonId' IS DISTINCT FROM content.league_season_id::text
    OR attempt.source_mapping->'scope'->>'season' IS DISTINCT FROM '2026'
    OR attempt.source_mapping->'scope'->>'externalLeagueId' IS DISTINCT FROM content.external_league_id
    OR receipt.provenance->>'origin' IS DISTINCT FROM 'network'
    OR attempt.write_fence IS NULL THEN RAISE EXCEPTION 'official standings capture lineage mismatch'; END IF;
  -- A supplement cannot be inserted in a later transaction for a historic receipt.
  IF NOT EXISTS(SELECT 1 FROM public.league_roster_capture_receipts stored WHERE stored.id=receipt.id
    AND stored.xmin=((pg_current_xact_id()::text::numeric % 4294967296)::text)::xid) THEN
    RAISE EXCEPTION 'official standings requires newly recorded receipt'; END IF;
  PERFORM public.assert_roster_player_link_fence(attempt.write_fence);
  PERFORM public.validate_current_roster_mapping(attempt.source_mapping);
  IF TG_TABLE_NAME='league_official_standings_contents' THEN
    IF NEW.capture_transaction<>pg_current_xact_id() THEN RAISE EXCEPTION 'official standings content transaction mismatch'; END IF;
    RETURN NEW;
  END IF;
  qualified:=public.official_standings_receipt_coverage(receipt.id);
  IF NEW.attempt_id<>attempt.id OR NEW.attempt_ordinal<>attempt.ordinal OR NEW.source_mapping IS DISTINCT FROM attempt.source_mapping
    OR NEW.expected_team_count IS DISTINCT FROM (qualified->>'expectedTeamCount')::integer
    OR NEW.population_state IS DISTINCT FROM qualified->>'population' OR NEW.entity_set IS DISTINCT FROM qualified->>'entitySet'
    OR NEW.record_completeness IS DISTINCT FROM qualified->>'recordCompleteness' OR NEW.reasons IS DISTINCT FROM qualified->'reasons' THEN
    RAISE EXCEPTION 'official standings receipt qualification mismatch'; END IF;
  witness:=receipt.provenance->'acquisition';
  IF witness IS NOT NULL THEN
    PERFORM public.assert_public_data_capture_witness(witness,attempt.write_fence,'rosters',NULL,attempt.source_mapping);
    IF witness->'attempts'->'players' IS DISTINCT FROM jsonb_build_object('id',attempt.id,'nonce',attempt.capture_nonce)
      OR NEW.intake_id::text IS DISTINCT FROM witness->'work'->>'requestId'
      OR NEW.worker_id IS DISTINCT FROM witness->'fence'->>'workerId'
      OR NEW.generation IS DISTINCT FROM (witness->'fence'->>'generation')::integer
      OR witness->'work'->>'kind' IS DISTINCT FROM 'core'
      OR NOT EXISTS(SELECT 1 FROM public.public_data_dispatches dispatch
        JOIN public.public_data_league_candidates candidate ON candidate.intake_id=dispatch.intake_id
          AND candidate.season=(dispatch.work->>'season')::integer
          AND candidate.external_league_id=dispatch.work->>'externalLeagueId'
        WHERE dispatch.worker_id=NEW.worker_id AND dispatch.generation=NEW.generation
          AND dispatch.intake_id=NEW.intake_id AND dispatch.resource='core' AND dispatch.work=witness->'work'
          AND dispatch.capture_nonce::text=witness->>'dispatchNonce'
          AND candidate.league_season_id=content.league_season_id) THEN
      RAISE EXCEPTION 'official standings public receipt binding mismatch'; END IF;
  ELSIF NEW.intake_id IS NOT NULL OR NEW.worker_id IS NOT NULL OR NEW.generation IS NOT NULL THEN
    RAISE EXCEPTION 'unwitnessed official standings cannot bind intake'; END IF;
  RETURN NEW;
END; $$;
CREATE FUNCTION public.validate_official_standings_capture() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE header public.league_official_standings_contents%ROWTYPE; content public.league_administration_contents%ROWTYPE;
  original_fence jsonb;
BEGIN
  SELECT * INTO STRICT header FROM public.league_official_standings_contents WHERE content_id=NEW.content_id;
  SELECT * INTO STRICT content FROM public.league_administration_contents WHERE id=NEW.content_id;
  IF public.official_standings_typed_value(NEW.content_id) IS DISTINCT FROM
      public.project_official_standings_native(content.payload,content.external_league_id)
    OR header.team_count<>(SELECT count(*) FROM public.league_official_standings_teams WHERE content_id=NEW.content_id)
    OR NOT EXISTS(SELECT 1 FROM public.league_official_standings_captures
      WHERE receipt_id=header.first_receipt_id AND content_id=header.content_id) THEN
    RAISE EXCEPTION 'official standings typed population mismatch'; END IF;
  -- Every fresh receipt, including equal content, retains its ORIGINAL commit fence.
  SELECT attempt.write_fence INTO STRICT original_fence FROM public.league_roster_capture_receipts receipt
    JOIN public.league_roster_resource_attempts attempt ON attempt.id=receipt.attempt_id
    WHERE receipt.id=(to_jsonb(NEW)->>CASE WHEN TG_TABLE_NAME='league_official_standings_contents' THEN 'first_receipt_id' ELSE 'receipt_id' END)::uuid;
  PERFORM public.assert_roster_player_link_fence(original_fence);
  RETURN NEW;
END; $$;
CREATE TRIGGER official_standings_content_insert BEFORE INSERT ON public.league_official_standings_contents
  FOR EACH ROW EXECUTE FUNCTION public.guard_official_standings_insert();
CREATE TRIGGER official_standings_team_insert BEFORE INSERT ON public.league_official_standings_teams
  FOR EACH ROW EXECUTE FUNCTION public.guard_official_standings_insert();
CREATE TRIGGER official_standings_capture_insert BEFORE INSERT ON public.league_official_standings_captures
  FOR EACH ROW EXECUTE FUNCTION public.guard_official_standings_insert();
CREATE CONSTRAINT TRIGGER official_standings_content_complete AFTER INSERT ON public.league_official_standings_contents
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.validate_official_standings_capture();
CREATE CONSTRAINT TRIGGER official_standings_capture_fence AFTER INSERT ON public.league_official_standings_captures
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.validate_official_standings_capture();
CREATE TRIGGER official_standings_content_immutable BEFORE UPDATE OR DELETE ON public.league_official_standings_contents
  FOR EACH ROW EXECUTE FUNCTION public.prevent_league_administration_history_change();
CREATE TRIGGER official_standings_team_immutable BEFORE UPDATE OR DELETE ON public.league_official_standings_teams
  FOR EACH ROW EXECUTE FUNCTION public.prevent_league_administration_history_change();
CREATE TRIGGER official_standings_capture_immutable BEFORE UPDATE OR DELETE ON public.league_official_standings_captures
  FOR EACH ROW EXECUTE FUNCTION public.prevent_league_administration_history_change();

ALTER FUNCTION public.record_league_administration_observation(jsonb) RENAME TO record_league_administration_observation_v47;
CREATE FUNCTION public.record_league_administration_observation(p_input jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE result jsonb; projection jsonb:=p_input->'officialStandings'; expected jsonb; row_value jsonb; coverage_value jsonb;
  receipt public.league_roster_capture_receipts%ROWTYPE; attempt public.league_roster_resource_attempts%ROWTYPE;
  content public.league_administration_contents%ROWTYPE; header public.league_official_standings_contents%ROWTYPE;
  identity_value uuid; witness jsonb;
BEGIN
  -- New fields must never alter any predecessor receipt evidence hash.
  result:=public.record_league_administration_observation_v47(p_input-'officialStandings');
  IF projection IS NULL THEN RETURN result; END IF;
  IF p_input->'envelope'->>'family' IS DISTINCT FROM 'rosters'
    OR p_input->'envelope'->'week' IS DISTINCT FROM 'null'::jsonb
    OR p_input->'envelope'->'scope'->>'season' IS DISTINCT FROM '2026'
    OR p_input->'envelope'->'provenance'->>'origin' IS DISTINCT FROM 'network'
    OR p_input->'writeFence' IS NULL OR p_input->'rosterAcceptance' IS NULL
    OR p_input->'envelope'->'scope' IS DISTINCT FROM p_input->'sourceMapping'->'scope'
    OR result->'rosterAcceptance'->>'receiptId' IS NULL THEN
    RAISE EXCEPTION 'official standings requires fenced mapped roster receipt'; END IF;
  SELECT * INTO STRICT receipt FROM public.league_roster_capture_receipts WHERE id=(result->'rosterAcceptance'->>'receiptId')::uuid;
  SELECT * INTO STRICT attempt FROM public.league_roster_resource_attempts WHERE id=receipt.attempt_id;
  SELECT * INTO STRICT content FROM public.league_administration_contents WHERE id=receipt.content_id;
  expected:=public.project_official_standings_native(content.payload,content.external_league_id);
  IF projection IS DISTINCT FROM expected THEN RAISE EXCEPTION 'official standings projection mismatch'; END IF;
  IF EXISTS(SELECT 1 FROM public.league_official_standings_captures WHERE receipt_id=receipt.id) THEN
    IF public.official_standings_typed_value(content.id) IS DISTINCT FROM expected THEN
      RAISE EXCEPTION 'official standings replay conflict'; END IF;
    RETURN result||jsonb_build_object('officialStandings',jsonb_build_object('status','replayed','receiptId',receipt.id,
      'contentId',content.id,'version','sleeper-official-standings-v1'));
  END IF;
  IF result->'rosterAcceptance'->>'reason'='exact_receipt_replay' THEN
    RETURN result||jsonb_build_object('officialStandings',jsonb_build_object('status','legacy-unqualified','receiptId',receipt.id,
      'contentId',content.id,'version','sleeper-official-standings-v1'));
  END IF;
  PERFORM public.assert_roster_player_link_fence(attempt.write_fence);
  SELECT * INTO header FROM public.league_official_standings_contents WHERE content_id=content.id;
  IF NOT FOUND THEN
    INSERT INTO public.league_official_standings_contents(content_id,value_version,first_receipt_id,structural_status,team_count,reasons)
      VALUES(content.id,'sleeper-official-standings-v1',receipt.id,expected->>'status',jsonb_array_length(expected->'teams'),expected->'reasons');
    FOR row_value IN SELECT value FROM jsonb_array_elements(expected->'teams') LOOP
      -- Only canonical team identity is shared. No legacy team/member rows or players acceptance are manufactured.
      INSERT INTO public.league_season_teams(league_season_id,provider,external_league_id,external_roster_id)
        VALUES(content.league_season_id,content.provider,content.external_league_id,row_value->>'externalRosterId') ON CONFLICT DO NOTHING;
      SELECT id INTO STRICT identity_value FROM public.league_season_teams WHERE league_season_id=content.league_season_id
        AND provider=content.provider AND external_league_id=content.external_league_id AND external_roster_id=row_value->>'externalRosterId';
      INSERT INTO public.league_official_standings_teams(content_id,external_roster_id,season_team_id,source_ordinal,field_states,
        wins,losses,ties,fpts,fpts_decimal,fpts_against,fpts_against_decimal,rank,seed,
        points_for_state,points_for_value,points_against_state,points_against_value)
      VALUES(content.id,row_value->>'externalRosterId',identity_value,(row_value->>'sourceOrdinal')::integer,
        jsonb_build_object('wins',row_value->'record'->'wins'->>'state','losses',row_value->'record'->'losses'->>'state',
          'ties',row_value->'record'->'ties'->>'state','fpts',row_value->'pointsFor'->'whole'->>'state',
          'fpts_decimal',row_value->'pointsFor'->'fraction'->>'state','fpts_against',row_value->'pointsAgainst'->'whole'->>'state',
          'fpts_against_decimal',row_value->'pointsAgainst'->'fraction'->>'state','rank',row_value->'providerRank'->>'state',
          'seed',row_value->'providerSeed'->>'state'),
        (row_value->'record'->'wins'->>'value')::bigint,(row_value->'record'->'losses'->>'value')::bigint,
        (row_value->'record'->'ties'->>'value')::bigint,(row_value->'pointsFor'->'whole'->>'value')::numeric,
        (row_value->'pointsFor'->'fraction'->>'value')::numeric,(row_value->'pointsAgainst'->'whole'->>'value')::numeric,
        (row_value->'pointsAgainst'->'fraction'->>'value')::numeric,(row_value->'providerRank'->>'value')::bigint,
        (row_value->'providerSeed'->>'value')::bigint,row_value->'pointsFor'->>'state',row_value->'pointsFor'->>'value',
        row_value->'pointsAgainst'->>'state',row_value->'pointsAgainst'->>'value');
    END LOOP;
  ELSIF public.official_standings_typed_value(content.id) IS DISTINCT FROM expected THEN
    RAISE EXCEPTION 'official standings content conflict';
  END IF;
  coverage_value:=public.official_standings_receipt_coverage(receipt.id);witness:=receipt.provenance->'acquisition';
  INSERT INTO public.league_official_standings_captures(receipt_id,content_id,value_version,attempt_id,attempt_ordinal,source_mapping,
    expected_team_count,population_state,entity_set,record_completeness,reasons,intake_id,worker_id,generation)
  VALUES(receipt.id,content.id,'sleeper-official-standings-v1',attempt.id,attempt.ordinal,attempt.source_mapping,
    (coverage_value->>'expectedTeamCount')::integer,coverage_value->>'population',coverage_value->>'entitySet',
    coverage_value->>'recordCompleteness',coverage_value->'reasons',(witness->'work'->>'requestId')::uuid,
    witness->'fence'->>'workerId',(witness->'fence'->>'generation')::integer);
  PERFORM public.assert_roster_player_link_fence(attempt.write_fence);
  RETURN result||jsonb_build_object('officialStandings',jsonb_build_object('status','recorded','receiptId',receipt.id,
    'contentId',content.id,'version','sleeper-official-standings-v1'));
END; $$;

REVOKE ALL ON public.league_official_standings_contents,public.league_official_standings_teams,public.league_official_standings_captures FROM PUBLIC;
REVOKE ALL ON FUNCTION public.official_standings_native_fact(jsonb,text,boolean,integer),public.official_standings_native_points(jsonb,text,text),
  public.project_official_standings_native(jsonb,text),public.official_standings_typed_value(uuid),public.official_standings_receipt_coverage(uuid),
  public.guard_official_standings_insert(),public.validate_official_standings_capture(),public.record_league_administration_observation_v47(jsonb),
  public.record_league_administration_observation(jsonb) FROM PUBLIC;
DO $$ BEGIN
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='league_one_runtime') THEN
    REVOKE ALL ON public.league_official_standings_contents,public.league_official_standings_teams,public.league_official_standings_captures FROM league_one_runtime;
    GRANT SELECT ON public.league_official_standings_contents,public.league_official_standings_teams,public.league_official_standings_captures TO league_one_runtime;
    REVOKE ALL ON FUNCTION public.official_standings_native_fact(jsonb,text,boolean,integer),public.official_standings_native_points(jsonb,text,text),
      public.project_official_standings_native(jsonb,text),public.official_standings_typed_value(uuid),public.official_standings_receipt_coverage(uuid),
      public.guard_official_standings_insert(),public.validate_official_standings_capture(),public.record_league_administration_observation_v47(jsonb) FROM league_one_runtime;
    GRANT EXECUTE ON FUNCTION public.record_league_administration_observation(jsonb) TO league_one_runtime;
  END IF;
END; $$;
