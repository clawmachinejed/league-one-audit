-- B1 expansion only: the interner is deliberately unbound. Compatible readers
-- precede any separately reviewed forward activation; all current writes stay inline.
CREATE TABLE public.league_roster_population_contents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  league_season_id uuid NOT NULL REFERENCES public.league_seasons(id),
  source_mapping_revision_id uuid NOT NULL REFERENCES public.league_source_mapping_revisions(id),
  configuration_content_id uuid NOT NULL REFERENCES public.league_administration_contents(id),
  proof_version text NOT NULL CHECK(proof_version='roster-population-proof-v1'),
  content_hash text NOT NULL CHECK(content_hash ~ '^[0-9a-f]{64}$'),
  population_evidence jsonb NOT NULL CHECK(jsonb_typeof(population_evidence)='object'),
  first_receipt_id uuid NOT NULL UNIQUE REFERENCES public.league_roster_capture_receipts(id) DEFERRABLE INITIALLY DEFERRED,
  capture_transaction xid8 NOT NULL DEFAULT pg_current_xact_id(),
  UNIQUE(league_season_id,source_mapping_revision_id,configuration_content_id,proof_version,content_hash)
);
ALTER TABLE public.league_roster_capture_receipts
  ADD COLUMN population_storage_format text NOT NULL DEFAULT 'inline-v1' CHECK(population_storage_format IN ('inline-v1','shared-v1')),
  ADD COLUMN population_content_id uuid REFERENCES public.league_roster_population_contents(id),
  ADD CONSTRAINT roster_population_storage_shape CHECK(
    (population_storage_format='inline-v1' AND population_content_id IS NULL) OR
    (population_storage_format='shared-v1' AND population_content_id IS NOT NULL AND population_evidence IS NULL));
CREATE INDEX roster_capture_population_content_idx ON public.league_roster_capture_receipts(population_content_id)
  WHERE population_content_id IS NOT NULL;
CREATE TRIGGER roster_population_content_immutable BEFORE UPDATE OR DELETE ON public.league_roster_population_contents
  FOR EACH ROW EXECUTE FUNCTION public.prevent_league_administration_history_change();

-- Composite input is essential: BEFORE lineage also calls this for NEW. A missing
-- LEFT JOIN receipt is SQL NULL; an existing malformed/shared receipt never falls back.
CREATE FUNCTION public.roster_capture_population_evidence(p_receipt public.league_roster_capture_receipts)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE header public.league_roster_population_contents%ROWTYPE;
  attempt public.league_roster_resource_attempts%ROWTYPE; scope public.league_roster_resource_scopes%ROWTYPE;
BEGIN
  IF p_receipt IS NULL THEN RETURN NULL; END IF;
  IF p_receipt.id IS NULL THEN RAISE EXCEPTION 'invalid roster population receipt'; END IF;
  IF p_receipt.population_storage_format='inline-v1' AND p_receipt.population_content_id IS NULL THEN
    RETURN p_receipt.population_evidence;
  END IF;
  IF p_receipt.population_storage_format IS DISTINCT FROM 'shared-v1'
    OR p_receipt.population_content_id IS NULL OR p_receipt.population_evidence IS NOT NULL
    OR p_receipt.configuration_content_id IS NULL OR p_receipt.expected_team_count IS NULL THEN
    RAISE EXCEPTION 'invalid roster population storage shape'; END IF;
  SELECT * INTO STRICT header FROM public.league_roster_population_contents WHERE id=p_receipt.population_content_id;
  SELECT * INTO STRICT attempt FROM public.league_roster_resource_attempts WHERE id=p_receipt.attempt_id;
  SELECT * INTO STRICT scope FROM public.league_roster_resource_scopes WHERE id=attempt.scope_id;
  IF header.league_season_id IS DISTINCT FROM scope.league_season_id
    OR header.source_mapping_revision_id::text IS DISTINCT FROM attempt.source_mapping->>'revisionId'
    OR header.configuration_content_id IS DISTINCT FROM p_receipt.configuration_content_id
    OR header.proof_version IS DISTINCT FROM 'roster-population-proof-v1'
    OR p_receipt.expected_team_count<=0 OR NOT (scope.identity IN (SELECT jsonb_build_object('scope',jsonb_build_object(
      'kind','enrolled-resource','connectionId',scope.connection_id,'leagueSeasonId',scope.league_season_id,
      'family',policy.family,'entityId',NULL,'scoringPeriodId',NULL,'audienceId','public','coverageSpecId',policy.coverage),
      'policy',jsonb_build_object('audienceId','public','coverageSpecId',policy.coverage,
        'canonicalNormalizerVersion',policy.normalizer,'validationVersion','latest-network-attempt-v1'))
    FROM (VALUES ('roster-membership','sleeper-current-all-teams-players-v1','sleeper-current-players-v1'),
      ('teams','sleeper-current-all-teams-primary-owners-v1','sleeper-current-team-managers-v1'),
      ('teams','sleeper-current-all-teams-manager-evidence-v2','sleeper-current-team-manager-evidence-v2'))
      AS policy(family,coverage,normalizer))) THEN
    RAISE EXCEPTION 'shared roster population context mismatch'; END IF;
  IF jsonb_typeof(header.population_evidence) IS DISTINCT FROM 'object'
    OR NOT (header.population_evidence ?& ARRAY['observationId','contentHash','provenance'])
    OR header.population_evidence-ARRAY['observationId','contentHash','provenance'] IS DISTINCT FROM '{}'::jsonb
    OR jsonb_typeof(header.population_evidence->'observationId') IS DISTINCT FROM 'string'
    OR (header.population_evidence->>'observationId') !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
    OR jsonb_typeof(header.population_evidence->'contentHash') IS DISTINCT FROM 'string'
    OR (header.population_evidence->>'contentHash') !~ '^(sha256:)?[0-9a-f]{64}$'
    OR jsonb_typeof(header.population_evidence->'provenance') IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'invalid shared roster population proof'; END IF;
  IF NOT COALESCE(header.population_evidence->'provenance'->'acquisition' IS NOT DISTINCT FROM p_receipt.provenance->'acquisition'
    AND (p_receipt.provenance->'acquisition' IS NOT NULL
      OR (header.population_evidence->'provenance'->>'requestStartedAt')::timestamptz>=attempt.reserved_at),false) THEN
    RAISE EXCEPTION 'shared roster population acquisition unproved'; END IF;
  IF encode(digest(convert_to(header.population_evidence::text,'UTF8'),'sha256'),'hex') IS DISTINCT FROM header.content_hash
    OR NOT EXISTS(SELECT 1 FROM public.league_administration_contents configuration
    JOIN public.league_administration_contents capture ON capture.id=p_receipt.content_id
    JOIN public.league_administration_observations observation ON observation.id=(header.population_evidence->>'observationId')::uuid
    JOIN public.league_source_mapping_revisions revision ON revision.id=(attempt.source_mapping->>'revisionId')::uuid
    WHERE configuration.id=p_receipt.configuration_content_id AND configuration.league_season_id=scope.league_season_id
      AND configuration.provider='sleeper' AND configuration.external_league_id=attempt.source_mapping->'scope'->>'externalLeagueId'
      AND configuration.family='league' AND configuration.week=0 AND configuration.normalizer_version='sleeper-administration-v1'
      AND configuration.accepted AND configuration.completeness='complete' AND configuration.content_hash=header.population_evidence->>'contentHash'
      AND capture.league_season_id=scope.league_season_id AND capture.provider=configuration.provider
      AND capture.external_league_id=configuration.external_league_id AND capture.family='rosters' AND capture.week=0
      AND observation.content_id=configuration.id AND observation.league_season_id=configuration.league_season_id
      AND observation.family='league' AND observation.week=0
      AND revision.connection_id=scope.connection_id AND revision.league_season_id=scope.league_season_id
      AND revision.provider='sleeper' AND revision.external_league_id=configuration.external_league_id) THEN
    RAISE EXCEPTION 'shared roster population proof binding mismatch'; END IF;
  -- Only the creating NEW receipt may precede its own INSERT. No future receipt,
  -- current head or current mapping can stand in for immutable first-reference proof.
  IF NOT COALESCE(header.capture_transaction=pg_current_xact_id_if_assigned() AND header.first_receipt_id=p_receipt.id,false)
    AND NOT EXISTS(SELECT 1 FROM public.league_roster_capture_receipts first_receipt
      JOIN public.league_roster_resource_attempts first_attempt ON first_attempt.id=first_receipt.attempt_id
      JOIN public.league_roster_resource_scopes first_scope ON first_scope.id=first_attempt.scope_id
      WHERE first_receipt.id=header.first_receipt_id AND first_receipt.population_storage_format='shared-v1'
        AND first_receipt.population_content_id=header.id AND first_receipt.population_evidence IS NULL
        AND first_receipt.configuration_content_id=header.configuration_content_id AND first_receipt.expected_team_count>0
        AND first_scope.league_season_id=header.league_season_id
        AND first_attempt.source_mapping->>'revisionId'=header.source_mapping_revision_id::text) THEN
    RAISE EXCEPTION 'shared roster population first receipt missing'; END IF;
  RETURN header.population_evidence;
END; $$;

CREATE FUNCTION public.validate_roster_population_content()
RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE first_receipt public.league_roster_capture_receipts%ROWTYPE;
BEGIN
  IF NEW.capture_transaction<>pg_current_xact_id() THEN RAISE EXCEPTION 'roster population creation transaction mismatch'; END IF;
  SELECT * INTO STRICT first_receipt FROM public.league_roster_capture_receipts
    WHERE id=NEW.first_receipt_id AND population_storage_format='shared-v1' AND population_content_id=NEW.id;
  IF public.roster_capture_population_evidence(first_receipt) IS DISTINCT FROM NEW.population_evidence THEN
    RAISE EXCEPTION 'roster population first receipt mismatch'; END IF;
  RETURN NEW;
END; $$;
CREATE CONSTRAINT TRIGGER roster_population_content_complete AFTER INSERT ON public.league_roster_population_contents
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.validate_roster_population_content();

-- Private candidate only. A local owner may bind this BEFORE receipt lineage for
-- isolated qualification; this migration contains no interner trigger or cutover.
CREATE FUNCTION public.intern_roster_population_evidence()
RETURNS trigger LANGUAGE plpgsql VOLATILE SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE attempt public.league_roster_resource_attempts%ROWTYPE; scope public.league_roster_resource_scopes%ROWTYPE;
  proof jsonb:=NEW.population_evidence; digest_value text; created_id uuid; content_id_value uuid; stored_proof jsonb;
BEGIN
  IF NEW.population_storage_format IS DISTINCT FROM 'inline-v1' OR NEW.population_content_id IS NOT NULL THEN
    RAISE EXCEPTION 'roster population interner requires inline input'; END IF;
  -- Unsupported/unproved inputs retain their original exact inline representation.
  IF NEW.configuration_content_id IS NULL OR NEW.expected_team_count IS NULL OR NEW.expected_team_count<=0
    OR proof IS NULL THEN RETURN NEW; END IF;
  IF jsonb_typeof(proof) IS DISTINCT FROM 'object'
    OR NOT (proof ?& ARRAY['observationId','contentHash','provenance'])
    OR proof-ARRAY['observationId','contentHash','provenance'] IS DISTINCT FROM '{}'::jsonb
    OR jsonb_typeof(proof->'observationId') IS DISTINCT FROM 'string'
    OR (proof->>'observationId') !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
    OR jsonb_typeof(proof->'contentHash') IS DISTINCT FROM 'string'
    OR (proof->>'contentHash') !~ '^(sha256:)?[0-9a-f]{64}$'
    OR jsonb_typeof(proof->'provenance') IS DISTINCT FROM 'object' THEN RETURN NEW; END IF;
  SELECT * INTO STRICT attempt FROM public.league_roster_resource_attempts WHERE id=NEW.attempt_id;
  SELECT * INTO STRICT scope FROM public.league_roster_resource_scopes WHERE id=attempt.scope_id;
  IF NOT (scope.identity IN (SELECT jsonb_build_object('scope',jsonb_build_object(
      'kind','enrolled-resource','connectionId',scope.connection_id,'leagueSeasonId',scope.league_season_id,
      'family',policy.family,'entityId',NULL,'scoringPeriodId',NULL,'audienceId','public','coverageSpecId',policy.coverage),
      'policy',jsonb_build_object('audienceId','public','coverageSpecId',policy.coverage,
        'canonicalNormalizerVersion',policy.normalizer,'validationVersion','latest-network-attempt-v1'))
    FROM (VALUES ('roster-membership','sleeper-current-all-teams-players-v1','sleeper-current-players-v1'),
      ('teams','sleeper-current-all-teams-primary-owners-v1','sleeper-current-team-managers-v1'),
      ('teams','sleeper-current-all-teams-manager-evidence-v2','sleeper-current-team-manager-evidence-v2'))
      AS policy(family,coverage,normalizer))) OR NOT EXISTS(SELECT 1 FROM public.league_administration_contents configuration
    JOIN public.league_administration_contents capture ON capture.id=NEW.content_id
    JOIN public.league_administration_observations observation ON observation.id=(proof->>'observationId')::uuid
    JOIN public.league_source_mapping_revisions revision ON revision.id=(attempt.source_mapping->>'revisionId')::uuid
    WHERE configuration.id=NEW.configuration_content_id AND configuration.league_season_id=scope.league_season_id
      AND configuration.provider='sleeper' AND configuration.external_league_id=attempt.source_mapping->'scope'->>'externalLeagueId'
      AND configuration.family='league' AND configuration.week=0 AND configuration.normalizer_version='sleeper-administration-v1'
      AND configuration.accepted AND configuration.completeness='complete' AND configuration.content_hash=proof->>'contentHash'
      AND capture.league_season_id=scope.league_season_id AND capture.provider=configuration.provider
      AND capture.external_league_id=configuration.external_league_id AND capture.family='rosters' AND capture.week=0
      AND observation.content_id=configuration.id AND observation.league_season_id=configuration.league_season_id
      AND observation.family='league' AND observation.week=0
      AND revision.connection_id=scope.connection_id AND revision.league_season_id=scope.league_season_id
      AND revision.provider='sleeper' AND revision.external_league_id=configuration.external_league_id) THEN RETURN NEW; END IF;
  -- Use the existing048 native population acquisition/time distinction only for
  -- storage eligibility. Old or malformed unproved evidence remains verbatim inline.
  IF proof->'provenance'->'acquisition' IS DISTINCT FROM NEW.provenance->'acquisition' THEN RETURN NEW; END IF;
  IF NEW.provenance->'acquisition' IS NULL THEN
    BEGIN
      IF proof->'provenance'->>'requestStartedAt' IS NULL
        OR (proof->'provenance'->>'requestStartedAt')::timestamptz<attempt.reserved_at THEN RETURN NEW; END IF;
    EXCEPTION WHEN invalid_datetime_format OR datetime_field_overflow THEN RETURN NEW;
    END;
  END IF;
  IF attempt.write_fence IS NOT NULL THEN PERFORM public.assert_roster_player_link_fence(attempt.write_fence); END IF;
  digest_value:=encode(digest(convert_to(proof::text,'UTF8'),'sha256'),'hex');
  INSERT INTO public.league_roster_population_contents(league_season_id,source_mapping_revision_id,configuration_content_id,
    proof_version,content_hash,population_evidence,first_receipt_id)
  VALUES(scope.league_season_id,(attempt.source_mapping->>'revisionId')::uuid,NEW.configuration_content_id,
    'roster-population-proof-v1',digest_value,proof,NEW.id)
  ON CONFLICT(league_season_id,source_mapping_revision_id,configuration_content_id,proof_version,content_hash)
    DO NOTHING RETURNING id INTO created_id;
  IF created_id IS NULL THEN
    -- VOLATILE separate statement observes a committed unique-key winner after
    -- waiting. A snapshot unable to establish that winner fails closed.
    SELECT id,population_evidence INTO STRICT content_id_value,stored_proof FROM public.league_roster_population_contents
      WHERE league_season_id=scope.league_season_id AND source_mapping_revision_id=(attempt.source_mapping->>'revisionId')::uuid
        AND configuration_content_id=NEW.configuration_content_id AND proof_version='roster-population-proof-v1' AND content_hash=digest_value;
  ELSE content_id_value:=created_id; stored_proof:=proof;
  END IF;
  IF stored_proof IS DISTINCT FROM proof THEN RAISE EXCEPTION 'roster population digest collision'; END IF;
  IF attempt.write_fence IS NOT NULL THEN PERFORM public.assert_roster_player_link_fence(attempt.write_fence); END IF;
  NEW.population_storage_format:='shared-v1'; NEW.population_content_id:=content_id_value; NEW.population_evidence:=NULL;
  IF public.roster_capture_population_evidence(NEW) IS DISTINCT FROM proof THEN
    RAISE EXCEPTION 'roster population reconstruction mismatch'; END IF;
  RETURN NEW;
END; $$;

-- Compatible SQL consumers. Only logical population access changes; original
-- request hashing, witness checks, provenance, coverage, admission and fences stay.
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
    SELECT public.roster_capture_population_evidence(prior) INTO population_proof FROM public.league_roster_resource_acceptances accepted
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
    SELECT public.roster_capture_population_evidence(prior) INTO population_proof FROM public.league_roster_resource_acceptances accepted
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

CREATE OR REPLACE FUNCTION public.validate_current_roster_lineage()
RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE population_proof jsonb;
BEGIN
  IF TG_TABLE_NAME='league_roster_capture_receipts' THEN
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

CREATE OR REPLACE FUNCTION public.official_standings_receipt_coverage(p_receipt_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE receipt public.league_roster_capture_receipts%ROWTYPE; attempt public.league_roster_resource_attempts%ROWTYPE;
  content public.league_administration_contents%ROWTYPE; header public.league_official_standings_contents%ROWTYPE;
  configuration public.league_administration_contents%ROWTYPE; expected integer; population text; entity text; records text; reasons jsonb;
BEGIN
  SELECT * INTO STRICT receipt FROM public.league_roster_capture_receipts WHERE id=p_receipt_id;
  receipt.population_evidence:=public.roster_capture_population_evidence(receipt);
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

-- BEGIN OPTIONAL ROSTER POPULATION CONTENT GRANTS
DO $$ DECLARE role_name text; helper text; accessor text:='public.roster_capture_population_evidence(public.league_roster_capture_receipts)';
  denied text:='INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'; BEGIN
  IF current_setting('server_version_num')::integer>=170000 THEN denied:=denied||',MAINTAIN'; END IF;
  IF to_regclass('public.league_roster_population_contents') IS NOT NULL THEN
    REVOKE ALL ON TABLE public.league_roster_population_contents FROM PUBLIC;
    FOREACH helper IN ARRAY ARRAY['public.validate_roster_population_content()','public.intern_roster_population_evidence()'] LOOP
      EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC',helper);
      FOREACH role_name IN ARRAY ARRAY['league_one_runtime','league_one_account','league_one_auth'] LOOP
        IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=role_name) THEN
          EXECUTE format('REVOKE ALL ON FUNCTION %s FROM %I',helper,role_name);
          IF has_function_privilege(role_name,helper,'EXECUTE') THEN RAISE EXCEPTION 'restricted role can execute private roster population helper'; END IF;
        END IF;
      END LOOP;
    END LOOP;
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC',accessor);
    FOREACH role_name IN ARRAY ARRAY['league_one_runtime','league_one_account','league_one_auth'] LOOP
      IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=role_name) THEN
        EXECUTE format('REVOKE ALL ON TABLE public.league_roster_population_contents FROM %I',role_name);
        EXECUTE format('REVOKE ALL ON FUNCTION %s FROM %I',accessor,role_name);
        IF role_name='league_one_runtime' THEN
          GRANT SELECT ON TABLE public.league_roster_population_contents TO league_one_runtime;
          EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO league_one_runtime',accessor);
          IF NOT has_table_privilege(role_name,'public.league_roster_population_contents','SELECT')
            OR NOT has_function_privilege(role_name,accessor,'EXECUTE') THEN RAISE EXCEPTION 'runtime cannot read roster population content'; END IF;
        ELSIF has_table_privilege(role_name,'public.league_roster_population_contents','SELECT')
          OR has_function_privilege(role_name,accessor,'EXECUTE') THEN RAISE EXCEPTION 'account role can read roster population content'; END IF;
        IF has_table_privilege(role_name,'public.league_roster_population_contents',denied)
          OR has_any_column_privilege(role_name,'public.league_roster_population_contents','INSERT,UPDATE,REFERENCES') THEN
          RAISE EXCEPTION 'restricted role can write roster population content'; END IF;
      END IF;
    END LOOP;
    IF EXISTS(SELECT 1 FROM pg_proc function_entry,
      LATERAL aclexplode(COALESCE(function_entry.proacl,acldefault('f',function_entry.proowner))) privilege
      WHERE function_entry.oid IN (to_regprocedure(accessor),to_regprocedure('public.validate_roster_population_content()'),
        to_regprocedure('public.intern_roster_population_evidence()')) AND privilege.grantee=0 AND privilege.privilege_type='EXECUTE') THEN
      RAISE EXCEPTION 'public can execute roster population function'; END IF;
  END IF;
END; $$;
-- END OPTIONAL ROSTER POPULATION CONTENT GRANTS
