-- Shared league-season/settings shadow resource. No new storage, backfill or v1 hash change.
-- The existing receipt holds the exact capture; optional fields qualify independently on read.
CREATE OR REPLACE FUNCTION public.validate_current_roster_lineage()
RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
  IF TG_TABLE_NAME='league_roster_capture_receipts' THEN
    IF NEW.configuration_content_id=NEW.content_id AND NOT EXISTS(SELECT 1
      FROM public.league_roster_resource_attempts attempt JOIN public.league_roster_resource_scopes scope ON scope.id=attempt.scope_id
      WHERE attempt.id=NEW.attempt_id AND scope.identity->'scope'->>'family'='league-season') THEN
      RAISE EXCEPTION 'self configuration requires league resource'; END IF;
    IF NOT EXISTS(SELECT 1 FROM public.league_roster_resource_attempts attempt
      JOIN public.league_roster_resource_scopes scope ON scope.id=attempt.scope_id
      JOIN public.league_administration_contents content ON content.id=NEW.content_id
      JOIN public.league_administration_observations observation ON observation.id=NEW.legacy_observation_id
      WHERE attempt.id=NEW.attempt_id AND content.league_season_id=scope.league_season_id
        AND content.provider='sleeper' AND content.family=CASE WHEN scope.identity->'scope'->>'family'='league-season' THEN 'league' ELSE 'rosters' END AND content.week=0
        AND content.external_league_id=attempt.source_mapping->'scope'->>'externalLeagueId'
        AND observation.content_id=content.id AND observation.league_season_id=content.league_season_id)
      OR (NEW.configuration_content_id IS NOT NULL AND NEW.configuration_content_id<>NEW.content_id AND NOT EXISTS(SELECT 1 FROM public.league_administration_contents roster
        JOIN public.league_administration_contents configuration ON configuration.id=NEW.configuration_content_id
        JOIN public.league_administration_observations observation ON observation.id=(NEW.population_evidence->>'observationId')::uuid
        WHERE roster.id=NEW.content_id AND configuration.league_season_id=roster.league_season_id
          AND configuration.provider=roster.provider AND configuration.external_league_id=roster.external_league_id
          AND configuration.family='league' AND configuration.week=0 AND configuration.accepted
          AND observation.content_id=configuration.id)) THEN RAISE EXCEPTION 'current roster receipt lineage mismatch'; END IF;
  ELSIF TG_TABLE_NAME='league_roster_resource_acceptances' THEN
    IF NOT EXISTS(SELECT 1 FROM public.league_roster_capture_receipts receipt
      JOIN public.league_roster_resource_attempts attempt ON attempt.id=receipt.attempt_id
      JOIN public.league_source_mapping_revisions revision ON revision.id=NEW.source_mapping_revision_id
      JOIN public.league_roster_resource_scopes scope ON scope.id=attempt.scope_id
      WHERE receipt.id=NEW.receipt_id AND attempt.scope_id=NEW.scope_id
        AND attempt.source_mapping->>'revisionId'=revision.id::text AND revision.connection_id=scope.connection_id
        AND revision.league_season_id=scope.league_season_id AND receipt.coverage->>'completeness'='complete'
        AND ((scope.identity->'scope'->>'family'='league-season' AND receipt.configuration_content_id=receipt.content_id
          AND receipt.population_evidence IS NULL AND receipt.expected_team_count IS NULL)
          OR (scope.identity->'scope'->>'family'<>'league-season' AND receipt.configuration_content_id IS NOT NULL AND receipt.expected_team_count>0))
        AND NEW.generation=attempt.expected_generation+1) THEN RAISE EXCEPTION 'current roster acceptance lineage mismatch'; END IF;
  ELSIF TG_TABLE_NAME='league_roster_resource_heads' THEN
    IF NEW.accepted_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.league_roster_resource_acceptances accepted
      WHERE accepted.id=NEW.accepted_id AND accepted.scope_id=NEW.scope_id AND accepted.generation=NEW.generation) THEN
      RAISE EXCEPTION 'current roster head lineage mismatch';
    END IF;
    IF TG_OP='UPDATE' AND (NEW.scope_id<>OLD.scope_id OR NEW.latest_ordinal<OLD.latest_ordinal
      OR NEW.generation<OLD.generation OR (OLD.accepted_id IS NOT NULL AND NEW.accepted_id IS NULL)) THEN
      RAISE EXCEPTION 'current roster head cannot regress';
    END IF;
  END IF;
  RETURN NEW;
END; $$;

CREATE OR REPLACE FUNCTION public.begin_current_roster_attempt(p_mapping jsonb,p_id uuid,p_scope jsonb,p_policy jsonb,p_fence jsonb DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE scope_row public.league_roster_resource_scopes%ROWTYPE;
  attempt public.league_roster_resource_attempts%ROWTYPE;
  head public.league_roster_resource_heads%ROWTYPE;
  identity_value jsonb;
BEGIN
  IF p_id IS NULL OR NOT (
    (p_scope = jsonb_build_object('kind','enrolled-resource',
      'connectionId',p_mapping->>'connectionId','leagueSeasonId',p_mapping->>'leagueSeasonId',
      'family','roster-membership','entityId',NULL,'scoringPeriodId',NULL,
      'audienceId','public','coverageSpecId','sleeper-current-all-teams-players-v1')
      AND p_policy = jsonb_build_object('audienceId','public',
        'coverageSpecId','sleeper-current-all-teams-players-v1',
        'canonicalNormalizerVersion','sleeper-current-players-v1','validationVersion','latest-network-attempt-v1'))
    OR (p_scope = jsonb_build_object('kind','enrolled-resource',
      'connectionId',p_mapping->>'connectionId','leagueSeasonId',p_mapping->>'leagueSeasonId',
      'family','teams','entityId',NULL,'scoringPeriodId',NULL,
      'audienceId','public','coverageSpecId','sleeper-current-all-teams-primary-owners-v1')
      AND p_policy = jsonb_build_object('audienceId','public',
        'coverageSpecId','sleeper-current-all-teams-primary-owners-v1',
        'canonicalNormalizerVersion','sleeper-current-team-managers-v1','validationVersion','latest-network-attempt-v1'))
    OR (p_scope = jsonb_build_object('kind','enrolled-resource',
      'connectionId',p_mapping->>'connectionId','leagueSeasonId',p_mapping->>'leagueSeasonId',
      'family','league-season','entityId',NULL,'scoringPeriodId',NULL,
      'audienceId','public','coverageSpecId','sleeper-league-identity-settings-v1')
      AND p_policy = jsonb_build_object('audienceId','public','coverageSpecId','sleeper-league-identity-settings-v1',
        'canonicalNormalizerVersion','sleeper-league-settings-v1','validationVersion','latest-network-attempt-v1'))
    ) IS TRUE THEN RAISE EXCEPTION 'unqualified current roster scope or policy'; END IF;
  IF p_fence IS NOT NULL THEN
    PERFORM 1 FROM public.projection_jobs job WHERE job.job_key=p_fence->>'jobKey' AND job.state='running'
      AND job.lease_owner=p_fence->>'workerId' AND job.attempt_count=(p_fence->>'generation')::integer
      AND job.lease_until>clock_timestamp() AND (p_fence->>'deadlineAt')::timestamptz>clock_timestamp() FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'current roster reservation writer fence is stale'; END IF;
  END IF;
  PERFORM public.validate_current_roster_mapping(p_mapping);
  identity_value:=jsonb_build_object('scope',p_scope,'policy',p_policy);
  INSERT INTO public.league_roster_resource_scopes(connection_id,league_season_id,identity)
    VALUES((p_mapping->>'connectionId')::uuid,(p_mapping->>'leagueSeasonId')::uuid,identity_value)
    ON CONFLICT DO NOTHING;
  SELECT * INTO STRICT scope_row FROM public.league_roster_resource_scopes WHERE identity=identity_value;
  INSERT INTO public.league_roster_resource_heads(scope_id) VALUES(scope_row.id) ON CONFLICT DO NOTHING;
  SELECT * INTO STRICT head FROM public.league_roster_resource_heads WHERE scope_id=scope_row.id FOR UPDATE;
  IF p_fence IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.projection_jobs job
    WHERE job.job_key=p_fence->>'jobKey' AND job.lease_until>clock_timestamp()
      AND (p_fence->>'deadlineAt')::timestamptz>clock_timestamp()) THEN
    RAISE EXCEPTION 'current roster reservation writer fence expired';
  END IF;
  SELECT * INTO attempt FROM public.league_roster_resource_attempts WHERE id=p_id;
  IF FOUND THEN
    IF attempt.scope_id<>scope_row.id OR attempt.source_mapping IS DISTINCT FROM p_mapping
      OR attempt.write_fence IS DISTINCT FROM p_fence THEN
      RAISE EXCEPTION 'current roster attempt identity conflict';
    END IF;
  ELSE
    UPDATE public.league_roster_resource_heads SET latest_ordinal=latest_ordinal+1
      WHERE scope_id=scope_row.id RETURNING * INTO head;
    INSERT INTO public.league_roster_resource_attempts(id,scope_id,ordinal,expected_generation,source_mapping,write_fence)
      VALUES(p_id,scope_row.id,head.latest_ordinal,head.generation,p_mapping,p_fence) RETURNING * INTO attempt;
  END IF;
  RETURN jsonb_build_object('id',attempt.id,'scopeId',attempt.scope_id,'ordinal',attempt.ordinal,
    'expectedGeneration',attempt.expected_generation);
END; $$;

CREATE OR REPLACE FUNCTION public.record_league_administration_observation(p_input jsonb)
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
  -- Also require that v1's accepted configuration still has this count content;
  -- a known configuration change waits for the next complete network batch.
  IF configuration.id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.league_administration_heads configuration_head
    JOIN public.league_administration_observations observed ON observed.id=configuration_head.accepted_observation_id
    WHERE configuration_head.league_season_id=content.league_season_id AND configuration_head.family='league'
      AND configuration_head.week=0 AND configuration_head.read_conflict IS NULL AND observed.content_id=configuration.id) THEN
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
