-- Opt-in latest manager evidence, independently scoped from complete-primary v1.
-- Existing raw content, v1 hashes, primary heads and the effective034 writer remain intact.
-- No backfill, account association, entitlement, new table or second acquisition path.

-- Exact JS identifier/field semantics. Unknown primary does not discard valid co-managers.
CREATE FUNCTION public.project_team_manager_evidence_fields(raw jsonb,source_league text)
RETURNS jsonb LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE primary_value jsonb; co_value jsonb; member jsonb; native_id text;
  ids jsonb:='[]'::jsonb; partial_members boolean:=false;
  whitespace text:=U&'\0009\000A\000B\000C\000D\0020\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF';
BEGIN
  IF jsonb_typeof(raw) IS DISTINCT FROM 'object' OR jsonb_typeof(raw->'roster_id') IS DISTINCT FROM 'number'
    OR raw->>'roster_id' !~ '^[1-9][0-9]*$' OR (raw->>'roster_id')::numeric>9007199254740991
    OR (raw ? 'league_id' AND raw->'league_id' IS DISTINCT FROM to_jsonb(source_league)) THEN RETURN NULL; END IF;
  IF NOT raw ? 'owner_id' THEN
    primary_value:=jsonb_build_object('state','unknown','externalManagerId',NULL,'reason','primary_owner_absent');
  ELSIF raw->'owner_id'='null'::jsonb THEN
    primary_value:=jsonb_build_object('state','unowned','externalManagerId',NULL);
  ELSIF jsonb_typeof(raw->'owner_id')='string' AND raw->>'owner_id'<>''
    AND btrim(raw->>'owner_id',whitespace)=raw->>'owner_id' AND raw->>'owner_id' !~ U&'[\0001-\001F\007F]' THEN
    primary_value:=jsonb_build_object('state','owned','externalManagerId',raw->>'owner_id');
  ELSE primary_value:=jsonb_build_object('state','unknown','externalManagerId',NULL,'reason','primary_owner_invalid'); END IF;
  IF jsonb_typeof(raw->'co_owners')='array' THEN
    FOR member IN SELECT value FROM jsonb_array_elements(raw->'co_owners') LOOP
      native_id:=member#>>'{}';
      IF jsonb_typeof(member)='string' AND native_id<>'' AND btrim(native_id,whitespace)=native_id
        AND native_id !~ U&'[\0001-\001F\007F]' THEN
        IF ids ? native_id OR (primary_value->>'state'='owned' AND primary_value->>'externalManagerId'=native_id) THEN
          partial_members:=true;
        ELSE ids:=ids||jsonb_build_array(native_id); END IF;
      ELSE partial_members:=true; END IF;
    END LOOP;
    co_value:=jsonb_build_object('state',CASE WHEN partial_members THEN 'partial' ELSE 'known' END,'externalManagerIds',ids);
    IF partial_members THEN co_value:=co_value||jsonb_build_object('reason','co_managers_invalid_members'); END IF;
  ELSE
    co_value:=jsonb_build_object('state','unknown','externalManagerIds',NULL,'reason',
      CASE WHEN NOT raw ? 'co_owners' THEN 'co_managers_absent' WHEN raw->'co_owners'='null'::jsonb THEN 'co_managers_null'
        ELSE 'co_managers_invalid' END);
  END IF;
  RETURN jsonb_build_object('externalRosterId',raw->>'roster_id','primaryOwner',primary_value,'coManagers',co_value);
END; $$;

CREATE FUNCTION public.qualify_team_manager_evidence_projection(payload jsonb,projection jsonb,source_league text,expected_count integer)
RETURNS boolean LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE raw jsonb; team jsonb; teams jsonb:='[]'::jsonb; diagnostics jsonb:='[]'::jsonb; index_value integer:=0; path_value text;
BEGIN
  IF jsonb_typeof(payload) IS DISTINCT FROM 'array' OR expected_count IS NULL OR expected_count<1 THEN RETURN false; END IF;
  IF jsonb_array_length(payload)<>expected_count
    OR (SELECT count(DISTINCT value->>'roster_id') FROM jsonb_array_elements(payload))<>expected_count THEN RETURN false; END IF;
  FOR raw IN SELECT value FROM jsonb_array_elements(payload) LOOP
    team:=public.project_team_manager_evidence_fields(raw,source_league);
    IF team IS NULL THEN RETURN false; END IF;
    teams:=teams||jsonb_build_array(team); path_value:='payload['||index_value::text||']';
    IF team->'primaryOwner'->>'state'='unknown' THEN
      diagnostics:=diagnostics||jsonb_build_array(jsonb_build_object('code',team->'primaryOwner'->>'reason',
        'path',path_value||'.owner_id','message','Primary ownership is unknown; valid co-managers remain independent provider observations.'));
    END IF;
    IF team->'coManagers'->>'state'<>'known' THEN
      diagnostics:=diagnostics||jsonb_build_array(jsonb_build_object('code',team->'coManagers'->>'reason',
        'path',path_value||'.co_owners','message','Co-manager inventory is incomplete; retained IDs do not prove the absence of other co-managers.'));
    END IF;
    index_value:=index_value+1;
  END LOOP;
  RETURN projection IS NOT DISTINCT FROM jsonb_build_object('version','sleeper-current-team-manager-evidence-v2',
    'status',CASE WHEN jsonb_array_length(diagnostics)=0 THEN 'complete' ELSE 'partial' END,'teams',teams,'diagnostics',diagnostics);
END; $$;

-- v1 qualification stays exact; only the separate v2 normalizer admits unknown primary/partial co groups.
CREATE OR REPLACE FUNCTION public.validate_team_manager_entry()
RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
  IF NOT EXISTS(SELECT 1 FROM public.league_administration_contents content
    JOIN public.league_season_teams team ON team.id=NEW.team_id
    WHERE content.id=NEW.content_id AND content.league_season_id=NEW.league_season_id
      AND content.family='rosters' AND content.week=0 AND content.provider=team.provider
      AND content.external_league_id=team.external_league_id AND team.league_season_id=NEW.league_season_id
      AND NEW.source_value->>'externalRosterId'=team.external_roster_id
      AND ((NEW.normalizer_version='sleeper-current-team-managers-v1' AND public.qualify_team_manager_projection(
        (SELECT jsonb_agg(value) FROM jsonb_array_elements(content.payload) WHERE value->>'roster_id'=team.external_roster_id),
        jsonb_build_object('version','sleeper-current-team-managers-v1','status','partial','teams',jsonb_build_array(NEW.source_value)),
        content.external_league_id,1))
      OR (NEW.normalizer_version='sleeper-current-team-manager-evidence-v2' AND NEW.source_value=public.project_team_manager_evidence_fields(
        (SELECT CASE WHEN count(*)=1 THEN jsonb_agg(value)->0 ELSE NULL END
          FROM jsonb_array_elements(content.payload) WHERE value->>'roster_id'=team.external_roster_id),content.external_league_id)))) THEN
    RAISE EXCEPTION 'team manager entry lineage mismatch'; END IF;
  RETURN NEW;
END; $$;

CREATE OR REPLACE FUNCTION public.validate_team_manager_membership()
RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
  IF NOT EXISTS(SELECT 1 FROM public.league_team_manager_entries entry
    JOIN public.league_administration_contents content ON content.id=entry.content_id
    JOIN public.league_source_manager_accounts manager ON manager.id=NEW.manager_id AND manager.provider=content.provider
    WHERE entry.content_id=NEW.content_id AND entry.normalizer_version=NEW.normalizer_version
      AND entry.team_id=NEW.team_id AND entry.league_season_id=NEW.league_season_id
      AND ((NEW.role='owner' AND entry.source_value->'primaryOwner'->>'state'='owned'
        AND entry.source_value->'primaryOwner'->>'externalManagerId'=manager.external_manager_id)
      OR (NEW.role='co_owner' AND (entry.source_value->'coManagers'->>'state'='known'
        OR (NEW.normalizer_version='sleeper-current-team-manager-evidence-v2' AND entry.source_value->'coManagers'->>'state'='partial'))
        AND entry.source_value->'coManagers'->'externalManagerIds' ? manager.external_manager_id))) THEN
    RAISE EXCEPTION 'team manager membership lineage mismatch'; END IF;
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
    OR (p_scope = jsonb_build_object('kind','enrolled-resource',
      'connectionId',p_mapping->>'connectionId','leagueSeasonId',p_mapping->>'leagueSeasonId',
      'family','teams','entityId',NULL,'scoringPeriodId',NULL,
      'audienceId','public','coverageSpecId','sleeper-current-all-teams-manager-evidence-v2')
      AND p_policy = jsonb_build_object('audienceId','public',
        'coverageSpecId','sleeper-current-all-teams-manager-evidence-v2',
        'canonicalNormalizerVersion','sleeper-current-team-manager-evidence-v2','validationVersion','latest-network-attempt-v1'))
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

-- Preserve the effective033 receipt/head lineage and all non-v2 acceptance rules.
CREATE OR REPLACE FUNCTION public.validate_current_roster_lineage()
RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
  IF TG_TABLE_NAME='league_roster_capture_receipts' THEN
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
          WHEN scope.identity->'scope'->>'family' IN ('matchups','transactions') THEN scope.identity->'scope'->>'family' ELSE 'rosters' END
        AND content.week=CASE WHEN scope.identity->'scope'->>'family'='matchups'
          THEN substring(scope.identity->'scope'->>'scoringPeriodId' FROM '^sleeper:matchup-week:([0-9]+)$')::integer
          WHEN scope.identity->'scope'->>'family'='transactions'
          THEN substring(scope.identity->'scope'->>'scoringPeriodId' FROM '^sleeper:transaction-week:([0-9]+)$')::integer ELSE 0 END
        AND content.external_league_id=attempt.source_mapping->'scope'->>'externalLeagueId'
        AND observation.content_id=content.id AND observation.league_season_id=content.league_season_id)
      OR (NEW.configuration_content_id IS NOT NULL AND NEW.configuration_content_id<>NEW.content_id AND NOT EXISTS(SELECT 1
        FROM public.league_administration_contents capture
        JOIN public.league_administration_contents configuration ON configuration.id=NEW.configuration_content_id
        JOIN public.league_administration_observations observation ON observation.id=(NEW.population_evidence->>'observationId')::uuid
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
          OR (scope.identity->'scope'->>'family'='transactions' AND receipt.configuration_content_id IS NULL
            AND receipt.population_evidence IS NULL AND receipt.expected_team_count IS NULL)
          OR (scope.identity->'scope'->>'family' NOT IN ('league-season','transactions') AND receipt.configuration_content_id IS NOT NULL
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

-- One transaction, one existing writer chain. Its034 private_v29 population correction is not replaced.
ALTER FUNCTION public.record_league_administration_observation(jsonb) RENAME TO record_league_administration_observation_v34;
CREATE FUNCTION public.record_league_administration_observation(p_input jsonb)
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

  covered:=COALESCE(content.completeness='complete' AND expected_count>0
    AND (provenance->>'requestStartedAt')::timestamptz>=attempt.reserved_at
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

-- Only the existing public writer and reservation entry points remain executable by runtime.
REVOKE ALL ON FUNCTION public.project_team_manager_evidence_fields(jsonb,text),
  public.qualify_team_manager_evidence_projection(jsonb,jsonb,text,integer),
  public.record_league_administration_observation_v34(jsonb),public.record_league_administration_observation(jsonb) FROM PUBLIC;
DO $$ BEGIN
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='league_one_runtime') THEN
    REVOKE ALL ON FUNCTION public.project_team_manager_evidence_fields(jsonb,text),
      public.qualify_team_manager_evidence_projection(jsonb,jsonb,text,integer),
      public.record_league_administration_observation_v34(jsonb) FROM league_one_runtime;
    GRANT EXECUTE ON FUNCTION public.record_league_administration_observation(jsonb) TO league_one_runtime;
  END IF;
END; $$;
