-- Native transaction-week acceptance, including Week 0. Existing administration content,
-- v1 observations, IDs and hashes remain authoritative and unchanged.
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
        AND revision.league_season_id=scope.league_season_id AND receipt.coverage->>'completeness'='complete'
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

-- One additive wrapper around the existing writer; no second ingestion or publication path.
ALTER FUNCTION public.record_league_administration_observation(jsonb) RENAME TO record_league_administration_observation_v32;
CREATE FUNCTION public.record_league_administration_observation(p_input jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE result jsonb; addition jsonb:=p_input->'transactionAcceptance'; token jsonb;
  attempt public.league_roster_resource_attempts%ROWTYPE; head public.league_roster_resource_heads%ROWTYPE;
  content public.league_administration_contents%ROWTYPE; receipt public.league_roster_capture_receipts%ROWTYPE;
  provenance jsonb:=p_input->'envelope'->'provenance'; period_value text;
  evidence_hash_value text; covered boolean:=false; acceptance_id uuid; legacy_current boolean:=false;
BEGIN
  IF addition IS NULL THEN RETURN public.record_league_administration_observation_v32(p_input); END IF;
  IF p_input->'envelope'->>'family' IS DISTINCT FROM 'transactions'
    OR (p_input->'envelope'->>'week')::integer IS NULL
    OR (p_input->'envelope'->>'week')::integer NOT BETWEEN 0 AND 18
    OR p_input->'envelope'->'scope' IS DISTINCT FROM p_input->'sourceMapping'->'scope'
    OR p_input->'sourceMapping' IS NULL
    OR provenance->>'origin' IS DISTINCT FROM 'network'
    OR (provenance->>'requestStartedAt')::timestamptz IS NULL
    OR (provenance->>'requestCompletedAt')::timestamptz IS NULL
    OR (provenance->>'sourceObservedAt')::timestamptz IS NULL
    OR (provenance->>'checkedAt')::timestamptz IS NULL
    OR (provenance->>'requestStartedAt')::timestamptz>(provenance->>'requestCompletedAt')::timestamptz
    OR (provenance->>'requestCompletedAt')::timestamptz>(provenance->>'checkedAt')::timestamptz
    OR (provenance->>'sourceObservedAt')::timestamptz>(provenance->>'checkedAt')::timestamptz
    OR (provenance->>'checkedAt')::timestamptz>clock_timestamp()+interval '5 minutes' THEN
    RAISE EXCEPTION 'transaction acceptance requires exact mapped network capture'; END IF;
  -- Existing job/source locks are acquired in their original order. Any later failure
  -- rolls back this statement including all legacy effects.
  result:=public.record_league_administration_observation_v32(p_input-'transactionAcceptance'-'sourceMapping');
  PERFORM public.validate_current_roster_mapping(p_input->'sourceMapping');
  token:=addition->'attempt'; period_value:='sleeper:transaction-week:'||(p_input->'envelope'->>'week');
  SELECT * INTO STRICT attempt FROM public.league_roster_resource_attempts WHERE id=(token->>'id')::uuid;
  IF (provenance->>'requestStartedAt')::timestamptz<attempt.reserved_at THEN
    RAISE EXCEPTION 'transaction request predates reservation'; END IF;
  IF attempt.source_mapping IS DISTINCT FROM p_input->'sourceMapping'
    OR attempt.write_fence IS DISTINCT FROM p_input->'writeFence'
    OR token IS DISTINCT FROM jsonb_build_object('id',attempt.id,'scopeId',attempt.scope_id,
      'ordinal',attempt.ordinal,'expectedGeneration',attempt.expected_generation)
    OR NOT EXISTS(SELECT 1 FROM public.league_roster_resource_scopes scope WHERE scope.id=attempt.scope_id
      AND scope.identity=jsonb_build_object('scope',jsonb_build_object('kind','enrolled-resource',
        'connectionId',attempt.source_mapping->>'connectionId','leagueSeasonId',attempt.source_mapping->>'leagueSeasonId',
        'family','transactions','entityId',NULL,'scoringPeriodId',period_value,'audienceId','public',
        'coverageSpecId','sleeper-native-week-transactions-v1'),
        'policy',jsonb_build_object('audienceId','public','coverageSpecId','sleeper-native-week-transactions-v1',
        'canonicalNormalizerVersion','sleeper-transactions-v1','validationVersion','latest-network-attempt-v1'))) THEN
    RAISE EXCEPTION 'transaction attempt scope mismatch'; END IF;
  SELECT * INTO STRICT head FROM public.league_roster_resource_heads WHERE scope_id=attempt.scope_id FOR UPDATE;
  IF attempt.write_fence IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.projection_jobs job
    WHERE job.job_key=attempt.write_fence->>'jobKey' AND job.state='running'
      AND job.lease_owner=attempt.write_fence->>'workerId'
      AND job.attempt_count=(attempt.write_fence->>'generation')::integer
      AND job.lease_until>clock_timestamp() AND (attempt.write_fence->>'deadlineAt')::timestamptz>clock_timestamp()) THEN
    RAISE EXCEPTION 'transaction writer fence expired'; END IF;
  SELECT * INTO STRICT content FROM public.league_administration_contents stored
    WHERE stored.league_season_id=(attempt.source_mapping->>'leagueSeasonId')::uuid
      AND stored.provider='sleeper' AND stored.external_league_id=attempt.source_mapping->'scope'->>'externalLeagueId'
      AND stored.family='transactions' AND stored.week=(p_input->'envelope'->>'week')::integer
      AND stored.normalizer_version='sleeper-administration-v1' AND stored.content_hash=p_input->>'contentHash'
      AND stored.completeness=p_input->'envelope'->>'completeness'
      AND stored.accepted=(p_input->>'status'='accepted' AND p_input->'envelope'->>'completeness'='complete')
      AND stored.payload=p_input->'envelope'->'payload' AND stored.normalized_value IS NOT DISTINCT FROM p_input->'value';
  -- A reservation does not overrule stale source time, equal-time conflicts or a
  -- rejected legacy document. Complete empty arrays are valid source coverage.
  legacy_current:=result->>'status' IN ('changed','unchanged','replayed') AND EXISTS(
    SELECT 1 FROM public.league_administration_heads legacy
    JOIN public.league_administration_observations observation ON observation.id=legacy.accepted_observation_id
    WHERE legacy.league_season_id=content.league_season_id AND legacy.family='transactions'
      AND legacy.week=content.week AND legacy.read_conflict IS NULL AND observation.content_id=content.id
      AND observation.id=(result->>'observationId')::uuid);
  covered:=content.accepted AND content.completeness='complete' AND jsonb_typeof(content.payload)='array'
    AND jsonb_typeof(content.normalized_value->'transactions')='array'
    AND jsonb_array_length(content.payload)=jsonb_array_length(content.normalized_value->'transactions');
  evidence_hash_value:=encode(digest(convert_to(p_input::text,'UTF8'),'sha256'),'hex');
  SELECT * INTO receipt FROM public.league_roster_capture_receipts WHERE attempt_id=attempt.id;
  IF FOUND THEN
    IF receipt.evidence_hash<>evidence_hash_value THEN RAISE EXCEPTION 'transaction attempt receipt conflict'; END IF;
    RETURN result||jsonb_build_object('transactionAcceptance',jsonb_build_object('status',
      CASE WHEN legacy_current AND attempt.ordinal=head.latest_ordinal AND EXISTS(
        SELECT 1 FROM public.league_roster_resource_acceptances accepted WHERE accepted.id=head.accepted_id
          AND accepted.receipt_id=receipt.id) THEN 'accepted' ELSE 'preserved' END,
      'reason','exact_receipt_replay','receiptId',receipt.id,'acceptedGeneration',head.generation));
  END IF;
  INSERT INTO public.league_roster_capture_receipts(attempt_id,content_id,legacy_observation_id,evidence_hash,provenance,coverage)
  VALUES(attempt.id,content.id,(result->>'observationId')::uuid,evidence_hash_value,provenance,
    jsonb_build_object('periodIds',jsonb_build_array(period_value),'interval',NULL,
      'entitySet',CASE WHEN covered THEN 'full' ELSE 'unknown' END,'fields','["transaction_id"]'::jsonb,
      'pagination','complete','nextCursor',NULL,
      'completeness',CASE WHEN covered THEN 'complete' WHEN content.completeness='partial' THEN 'partial' ELSE 'unknown' END,
      'reasons',CASE WHEN covered THEN '[]'::jsonb ELSE '["complete_transaction_week_unproved"]'::jsonb END))
    RETURNING * INTO receipt;
  IF attempt.ordinal=head.latest_ordinal AND attempt.expected_generation=head.generation AND covered AND legacy_current THEN
    IF attempt.write_fence IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.projection_jobs job
      WHERE job.job_key=attempt.write_fence->>'jobKey' AND job.state='running'
        AND job.lease_owner=attempt.write_fence->>'workerId'
        AND job.attempt_count=(attempt.write_fence->>'generation')::integer
        AND job.lease_until>clock_timestamp() AND (attempt.write_fence->>'deadlineAt')::timestamptz>clock_timestamp()) THEN
      RAISE EXCEPTION 'transaction writer fence expired'; END IF;
    INSERT INTO public.league_roster_resource_acceptances(scope_id,receipt_id,source_mapping_revision_id,generation)
      VALUES(attempt.scope_id,receipt.id,(attempt.source_mapping->>'revisionId')::uuid,head.generation+1)
      RETURNING id INTO acceptance_id;
    UPDATE public.league_roster_resource_heads SET accepted_id=acceptance_id,generation=generation+1
      WHERE scope_id=attempt.scope_id RETURNING * INTO head;
  END IF;
  RETURN result||jsonb_build_object('transactionAcceptance',jsonb_build_object('status',
    CASE WHEN acceptance_id IS NOT NULL THEN 'accepted' ELSE 'preserved' END,
    'reason',CASE WHEN acceptance_id IS NOT NULL THEN NULL
      WHEN attempt.ordinal<>head.latest_ordinal THEN 'newer_network_attempt_reserved'
      WHEN attempt.expected_generation<>head.generation THEN 'accepted_generation_changed'
      WHEN NOT legacy_current THEN 'legacy_transaction_not_current'
      ELSE 'complete_transaction_week_unproved' END,'receiptId',receipt.id,'acceptedGeneration',head.generation));
END; $$;

-- Same source, job and head lock order as the prior scoped reservations.
CREATE FUNCTION public.begin_transaction_attempt(p_mapping jsonb,p_id uuid,p_week integer,p_fence jsonb DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE scope_row public.league_roster_resource_scopes%ROWTYPE;
  attempt public.league_roster_resource_attempts%ROWTYPE;
  head public.league_roster_resource_heads%ROWTYPE;
  identity_value jsonb;
BEGIN
  IF p_id IS NULL OR p_week IS NULL OR p_week NOT BETWEEN 0 AND 18 THEN RAISE EXCEPTION 'invalid native transaction week'; END IF;
  IF p_fence IS NOT NULL THEN
    PERFORM 1 FROM public.projection_jobs job WHERE job.job_key=p_fence->>'jobKey' AND job.state='running'
      AND job.lease_owner=p_fence->>'workerId' AND job.attempt_count=(p_fence->>'generation')::integer
      AND job.lease_until>clock_timestamp() AND (p_fence->>'deadlineAt')::timestamptz>clock_timestamp() FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'transaction reservation writer fence is stale'; END IF;
  END IF;
  PERFORM public.validate_current_roster_mapping(p_mapping);
  identity_value:=jsonb_build_object('scope',jsonb_build_object('kind','enrolled-resource',
    'connectionId',p_mapping->>'connectionId','leagueSeasonId',p_mapping->>'leagueSeasonId',
    'family','transactions','entityId',NULL,'scoringPeriodId','sleeper:transaction-week:'||p_week,
    'audienceId','public','coverageSpecId','sleeper-native-week-transactions-v1'),
    'policy',jsonb_build_object('audienceId','public','coverageSpecId','sleeper-native-week-transactions-v1',
    'canonicalNormalizerVersion','sleeper-transactions-v1','validationVersion','latest-network-attempt-v1'));
  INSERT INTO public.league_roster_resource_scopes(connection_id,league_season_id,identity)
    VALUES((p_mapping->>'connectionId')::uuid,(p_mapping->>'leagueSeasonId')::uuid,identity_value)
    ON CONFLICT DO NOTHING;
  SELECT * INTO STRICT scope_row FROM public.league_roster_resource_scopes WHERE identity=identity_value;
  INSERT INTO public.league_roster_resource_heads(scope_id) VALUES(scope_row.id) ON CONFLICT DO NOTHING;
  SELECT * INTO STRICT head FROM public.league_roster_resource_heads WHERE scope_id=scope_row.id FOR UPDATE;
  IF p_fence IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.projection_jobs job
    WHERE job.job_key=p_fence->>'jobKey' AND job.state='running' AND job.lease_owner=p_fence->>'workerId'
      AND job.attempt_count=(p_fence->>'generation')::integer AND job.lease_until>clock_timestamp()
      AND (p_fence->>'deadlineAt')::timestamptz>clock_timestamp()) THEN
    RAISE EXCEPTION 'transaction reservation writer fence expired'; END IF;
  SELECT * INTO attempt FROM public.league_roster_resource_attempts WHERE id=p_id;
  IF FOUND THEN
    IF attempt.scope_id<>scope_row.id OR attempt.source_mapping IS DISTINCT FROM p_mapping
      OR attempt.write_fence IS DISTINCT FROM p_fence THEN RAISE EXCEPTION 'transaction attempt identity conflict'; END IF;
  ELSE
    UPDATE public.league_roster_resource_heads SET latest_ordinal=latest_ordinal+1
      WHERE scope_id=scope_row.id RETURNING * INTO head;
    INSERT INTO public.league_roster_resource_attempts(id,scope_id,ordinal,expected_generation,source_mapping,write_fence)
      VALUES(p_id,scope_row.id,head.latest_ordinal,head.generation,p_mapping,p_fence) RETURNING * INTO attempt;
  END IF;
  RETURN jsonb_build_object('id',attempt.id,'scopeId',attempt.scope_id,'ordinal',attempt.ordinal,
    'expectedGeneration',attempt.expected_generation);
END; $$;

REVOKE ALL ON FUNCTION public.begin_transaction_attempt(jsonb,uuid,integer,jsonb),
  public.record_league_administration_observation_v32(jsonb),
  public.record_league_administration_observation(jsonb) FROM PUBLIC;
DO $$ BEGIN
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='league_one_runtime') THEN
    REVOKE ALL ON FUNCTION public.record_league_administration_observation_v32(jsonb) FROM league_one_runtime;
    GRANT EXECUTE ON FUNCTION public.begin_transaction_attempt(jsonb,uuid,integer,jsonb),
      public.record_league_administration_observation(jsonb) TO league_one_runtime;
  END IF;
END; $$;
