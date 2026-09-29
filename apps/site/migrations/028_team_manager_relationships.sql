-- Primary-owner coverage with independently qualified optional co-manager groups.
-- Reuses 027 scopes, attempts, receipts, heads and the sole writer. No backfill.
CREATE TABLE public.league_team_manager_entries (
  content_id uuid NOT NULL REFERENCES public.league_administration_contents(id),
  normalizer_version text NOT NULL,
  league_season_id uuid NOT NULL,
  team_id uuid NOT NULL,
  source_value jsonb NOT NULL CHECK (jsonb_typeof(source_value)='object'),
  PRIMARY KEY(content_id,normalizer_version,team_id),
  FOREIGN KEY(team_id,league_season_id) REFERENCES public.league_season_teams(id,league_season_id)
);
CREATE TRIGGER team_manager_entry_immutable BEFORE UPDATE OR DELETE ON public.league_team_manager_entries
  FOR EACH ROW EXECUTE FUNCTION public.prevent_league_administration_history_change();
CREATE TABLE public.league_team_manager_memberships (
  content_id uuid NOT NULL,
  normalizer_version text NOT NULL,
  league_season_id uuid NOT NULL,
  team_id uuid NOT NULL,
  manager_id uuid NOT NULL REFERENCES public.league_source_manager_accounts(id),
  role text NOT NULL CHECK(role IN ('owner','co_owner')),
  PRIMARY KEY(content_id,normalizer_version,team_id,manager_id,role),
  FOREIGN KEY(content_id,normalizer_version,team_id) REFERENCES public.league_team_manager_entries(content_id,normalizer_version,team_id),
  FOREIGN KEY(team_id,league_season_id) REFERENCES public.league_season_teams(id,league_season_id)
);
CREATE TRIGGER team_manager_membership_immutable BEFORE UPDATE OR DELETE ON public.league_team_manager_memberships
  FOR EACH ROW EXECUTE FUNCTION public.prevent_league_administration_history_change();

-- Defense in depth: validate the new projection against exact raw identity/fields.
-- Optional unknown co-managers cannot assert absence; complete covers owner_id only.
CREATE FUNCTION public.qualify_team_manager_projection(payload jsonb,projection jsonb,source_league text,expected_count integer)
RETURNS boolean LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE team jsonb; raw jsonb; owner_value jsonb; co_group jsonb; ids jsonb; valid_co boolean;
BEGIN
  IF projection->>'version' IS DISTINCT FROM 'sleeper-current-team-managers-v1'
    OR (projection->>'status' IN ('complete','partial')) IS NOT TRUE
    OR jsonb_typeof(projection->'teams') IS DISTINCT FROM 'array'
    OR jsonb_typeof(payload) IS DISTINCT FROM 'array' OR expected_count IS NULL OR expected_count<1 THEN RETURN false; END IF;
  IF jsonb_array_length(payload)<>expected_count OR jsonb_array_length(projection->'teams')<>expected_count
    OR (SELECT count(DISTINCT t->>'externalRosterId') FROM jsonb_array_elements(projection->'teams') t)<>expected_count
    OR (SELECT count(DISTINCT r->>'roster_id') FROM jsonb_array_elements(payload) r)<>expected_count THEN RETURN false; END IF;
  FOR team IN SELECT value FROM jsonb_array_elements(projection->'teams') LOOP
    SELECT value INTO raw FROM jsonb_array_elements(payload) WHERE value->>'roster_id'=team->>'externalRosterId';
    IF raw IS NULL OR jsonb_typeof(raw->'roster_id') IS DISTINCT FROM 'number'
      OR raw->>'roster_id' !~ '^[1-9][0-9]*$' OR (raw->>'roster_id')::numeric>9007199254740991
      OR (raw ? 'league_id' AND raw->'league_id' IS DISTINCT FROM to_jsonb(source_league)) THEN RETURN false; END IF;
    owner_value:=team->'primaryOwner';
    IF raw->'owner_id'='null'::jsonb THEN
      IF owner_value IS DISTINCT FROM '{"state":"unowned","externalManagerId":null}'::jsonb THEN RETURN false; END IF;
    ELSIF jsonb_typeof(raw->'owner_id')='string' AND raw->>'owner_id'<>''
      AND btrim(raw->>'owner_id',U&'\0009\000A\000B\000C\000D\0020\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF')=raw->>'owner_id'
      AND raw->>'owner_id' !~ U&'[\0001-\001F\007F]' THEN
      IF owner_value IS DISTINCT FROM jsonb_build_object('state','owned','externalManagerId',raw->>'owner_id') THEN RETURN false; END IF;
    ELSE RETURN false; END IF;
    ids:=raw->'co_owners'; valid_co:=false;
    IF jsonb_typeof(ids)='array' THEN
      valid_co:=NOT EXISTS(SELECT 1 FROM jsonb_array_elements(ids) v WHERE jsonb_typeof(v)<>'string'
        OR v#>>'{}'='' OR btrim(v#>>'{}',U&'\0009\000A\000B\000C\000D\0020\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF')<>v#>>'{}'
        OR v#>>'{}' ~ U&'[\0001-\001F\007F]'
        OR v=raw->'owner_id') AND (SELECT count(DISTINCT v) FROM jsonb_array_elements(ids) v)=jsonb_array_length(ids);
    END IF;
    co_group:=CASE WHEN valid_co THEN jsonb_build_object('state','known','externalManagerIds',ids)
      ELSE jsonb_build_object('state','unknown','externalManagerIds',NULL,'reason',
        CASE WHEN NOT raw ? 'co_owners' THEN 'co_managers_absent' WHEN ids='null'::jsonb THEN 'co_managers_null'
          ELSE 'co_managers_invalid' END) END;
    IF team IS DISTINCT FROM jsonb_build_object('externalRosterId',raw->>'roster_id',
      'primaryOwner',owner_value,'coManagers',co_group) THEN RETURN false; END IF;
  END LOOP;
  RETURN true;
END; $$;

CREATE FUNCTION public.validate_team_manager_entry()
RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
  IF NOT EXISTS(SELECT 1 FROM public.league_administration_contents content
    JOIN public.league_season_teams team ON team.id=NEW.team_id
    WHERE content.id=NEW.content_id AND content.league_season_id=NEW.league_season_id
      AND NEW.normalizer_version='sleeper-current-team-managers-v1'
      AND content.family='rosters' AND content.week=0 AND content.provider=team.provider
      AND content.external_league_id=team.external_league_id AND team.league_season_id=NEW.league_season_id
      AND NEW.source_value->>'externalRosterId'=team.external_roster_id
      AND public.qualify_team_manager_projection(
        (SELECT jsonb_agg(value) FROM jsonb_array_elements(content.payload) WHERE value->>'roster_id'=team.external_roster_id),
        jsonb_build_object('version','sleeper-current-team-managers-v1','status','partial','teams',jsonb_build_array(NEW.source_value)),
        content.external_league_id,1)) THEN RAISE EXCEPTION 'team manager entry lineage mismatch'; END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER team_manager_entry_lineage BEFORE INSERT ON public.league_team_manager_entries
  FOR EACH ROW EXECUTE FUNCTION public.validate_team_manager_entry();

CREATE FUNCTION public.validate_team_manager_membership()
RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
  IF NOT EXISTS(SELECT 1 FROM public.league_team_manager_entries entry
    JOIN public.league_administration_contents content ON content.id=entry.content_id
    JOIN public.league_source_manager_accounts manager ON manager.id=NEW.manager_id AND manager.provider=content.provider
    WHERE entry.content_id=NEW.content_id AND entry.normalizer_version=NEW.normalizer_version
      AND entry.team_id=NEW.team_id AND entry.league_season_id=NEW.league_season_id
      AND ((NEW.role='owner' AND entry.source_value->'primaryOwner'->>'state'='owned'
        AND entry.source_value->'primaryOwner'->>'externalManagerId'=manager.external_manager_id)
      OR (NEW.role='co_owner' AND entry.source_value->'coManagers'->>'state'='known'
        AND entry.source_value->'coManagers'->'externalManagerIds' ? manager.external_manager_id))) THEN
    RAISE EXCEPTION 'team manager membership lineage mismatch';
  END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER team_manager_membership_lineage BEFORE INSERT ON public.league_team_manager_memberships
  FOR EACH ROW EXECUTE FUNCTION public.validate_team_manager_membership();

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
  fields_value jsonb; coverage_reason text; manager_resource boolean;
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
  result:=public.record_league_administration_observation_v1(p_input-'rosterAcceptance'-'teamManagerAcceptance'-'teamManagers');
  FOREACH resource_key IN ARRAY ARRAY['rosterAcceptance','teamManagerAcceptance'] LOOP
  addition:=p_input->resource_key;
  IF addition IS NULL THEN CONTINUE; END IF;
  token:=addition->'attempt';
  manager_resource:=resource_key='teamManagerAcceptance';
  fields_value:=CASE WHEN manager_resource THEN '["owner_id"]'::jsonb ELSE '["players"]'::jsonb END;
  coverage_reason:=CASE WHEN manager_resource THEN 'complete_primary_owner_population_unproved' ELSE 'complete_players_population_unproved' END;
  population:=addition->'population'; population_proof:=NULL; configuration:=NULL;
  covered:=false; expected_count:=NULL; observed_count:=NULL; reason_value:=NULL;
  IF p_input->'envelope'->>'family' IS DISTINCT FROM 'rosters'
    OR p_input->'envelope'->'week' IS DISTINCT FROM 'null'::jsonb
    OR provenance->>'origin' IS DISTINCT FROM 'network'
    OR p_input->'sourceMapping' IS NULL THEN RAISE EXCEPTION 'current roster requires mapped network capture'; END IF;
  PERFORM public.validate_current_roster_mapping(p_input->'sourceMapping');
  SELECT * INTO STRICT attempt FROM public.league_roster_resource_attempts WHERE id=(token->>'id')::uuid;
  IF attempt.source_mapping IS DISTINCT FROM p_input->'sourceMapping'
    OR attempt.write_fence IS DISTINCT FROM p_input->'writeFence'
    OR token IS DISTINCT FROM jsonb_build_object('id',attempt.id,'scopeId',attempt.scope_id,
      'ordinal',attempt.ordinal,'expectedGeneration',attempt.expected_generation) THEN
    RAISE EXCEPTION 'current roster attempt scope mismatch';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM public.league_roster_resource_scopes scope WHERE scope.id=attempt.scope_id
    AND scope.identity->'scope'->>'coverageSpecId'=CASE WHEN manager_resource
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
      AND stored.family='rosters' AND stored.week=0 AND stored.normalizer_version='sleeper-administration-v1'
      AND stored.content_hash=p_input->>'contentHash'
      AND stored.completeness=p_input->'envelope'->>'completeness'
      AND stored.accepted=(p_input->>'status'='accepted' AND p_input->'envelope'->>'completeness'='complete')
      AND stored.payload=p_input->'envelope'->'payload' AND stored.normalized_value IS NOT DISTINCT FROM p_input->'value';
  -- Prefer the independently captured network league document from this batch.
  -- Its mapping token was captured before that batch; retain its real provenance.
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

REVOKE ALL ON public.league_team_manager_entries,public.league_team_manager_memberships FROM PUBLIC;
REVOKE ALL ON FUNCTION public.qualify_team_manager_projection(jsonb,jsonb,text,integer),
  public.validate_team_manager_entry(),public.validate_team_manager_membership() FROM PUBLIC;
DO $$ BEGIN
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='league_one_runtime') THEN
    REVOKE ALL ON public.league_team_manager_entries,public.league_team_manager_memberships FROM league_one_runtime;
    REVOKE ALL ON FUNCTION public.qualify_team_manager_projection(jsonb,jsonb,text,integer),
      public.validate_team_manager_entry(),public.validate_team_manager_membership() FROM league_one_runtime;
    GRANT SELECT ON public.league_team_manager_entries,public.league_team_manager_memberships TO league_one_runtime;
  END IF;
END; $$;
