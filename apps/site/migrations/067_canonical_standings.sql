-- First canonical family. Existing native history, jobs and ordering state remain owners.
-- Production selection is separately disabled in the application until qualification.
ALTER TABLE public.league_roster_resource_scopes ADD CONSTRAINT canonical_scope_parent_key UNIQUE(id,connection_id,league_season_id);
ALTER TABLE public.league_roster_resource_attempts ADD CONSTRAINT canonical_attempt_scope_key UNIQUE(id,scope_id);
ALTER TABLE public.league_roster_resource_attempts ADD COLUMN canonical_reservation_context jsonb;

CREATE TABLE public.league_canonical_resource_contents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  connection_id uuid NOT NULL REFERENCES public.league_source_connections(id),
  league_season_id uuid NOT NULL REFERENCES public.league_seasons(id),
  provider text NOT NULL,source_league_namespace text NOT NULL,external_league_id text NOT NULL,source_namespace text NOT NULL,
  family text NOT NULL CHECK(family='standings'),native_kind text NOT NULL,
  canonical_schema_version text NOT NULL CHECK(canonical_schema_version='league-one-official-standings-v1'),
  adapter_version text NOT NULL,native_verifier_version text NOT NULL,canonical_normalizer_version text NOT NULL,
  hash_version text NOT NULL CHECK(hash_version='league-one-jsonb-sha256-v1'),
  native_payload jsonb NOT NULL,canonical_value jsonb NOT NULL,native_hash text NOT NULL,canonical_hash text NOT NULL,
  first_receipt_id uuid NOT NULL,capture_transaction xid8 NOT NULL DEFAULT pg_current_xact_id(),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CHECK(native_hash ~ '^sha256:[0-9a-f]{64}$' AND canonical_hash ~ '^sha256:[0-9a-f]{64}$'),
  UNIQUE(id,connection_id,league_season_id),
  UNIQUE(id,league_season_id,provider,source_league_namespace,external_league_id),
  UNIQUE(connection_id,league_season_id,provider,source_league_namespace,external_league_id,source_namespace,
    family,native_kind,canonical_schema_version,adapter_version,native_verifier_version,canonical_normalizer_version,
    hash_version,native_hash,canonical_hash)
);
CREATE TABLE public.league_canonical_resource_receipts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),attempt_id uuid NOT NULL UNIQUE,scope_id uuid NOT NULL,
  connection_id uuid NOT NULL,league_season_id uuid NOT NULL,content_id uuid NOT NULL,
  source_mapping jsonb NOT NULL,provenance jsonb NOT NULL,native_source_ref jsonb NOT NULL,
  legacy_roster_receipt_id uuid REFERENCES public.league_roster_capture_receipts(id),population_evidence jsonb,
  coverage jsonb NOT NULL,expected_team_count integer CHECK(expected_team_count>0),
  population text NOT NULL CHECK(population IN ('proven','unproved','mismatch')),
  record_completeness text NOT NULL CHECK(record_completeness IN ('complete','partial','unknown')),
  qualification text NOT NULL CHECK(qualification IN ('qualified','invalid','capacity')),
  outcome text NOT NULL CHECK(outcome IN ('accepted','preserved-stale','preserved-conflict','preserved-generation','invalid','capacity')),
  reasons jsonb NOT NULL,evidence_version text NOT NULL CHECK(evidence_version='league-one-jsonb-sha256-v1'),
  evidence_hash text NOT NULL CHECK(evidence_hash ~ '^sha256:[0-9a-f]{64}$'),
  recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),capture_transaction xid8 NOT NULL DEFAULT pg_current_xact_id(),
  UNIQUE(id,scope_id),UNIQUE(id,scope_id,connection_id,league_season_id),
  FOREIGN KEY(attempt_id,scope_id) REFERENCES public.league_roster_resource_attempts(id,scope_id),
  FOREIGN KEY(scope_id,connection_id,league_season_id) REFERENCES public.league_roster_resource_scopes(id,connection_id,league_season_id),
  FOREIGN KEY(content_id,connection_id,league_season_id) REFERENCES public.league_canonical_resource_contents(id,connection_id,league_season_id),
  CHECK((native_source_ref->>'kind'='sleeper-roster-bridge-v1' AND legacy_roster_receipt_id IS NOT NULL)
    OR (native_source_ref->>'kind'='fixture-standalone-v1' AND legacy_roster_receipt_id IS NULL))
);
ALTER TABLE public.league_canonical_resource_contents ADD CONSTRAINT canonical_content_first_receipt_fk
  FOREIGN KEY(first_receipt_id) REFERENCES public.league_canonical_resource_receipts(id) DEFERRABLE INITIALLY DEFERRED;
CREATE TABLE public.league_canonical_standings_teams (
  content_id uuid NOT NULL,league_season_id uuid NOT NULL,season_team_id uuid NOT NULL,
  provider text NOT NULL,source_league_namespace text NOT NULL,external_league_id text NOT NULL,
  native_namespace text NOT NULL,external_team_id text NOT NULL,source_ordinal integer NOT NULL CHECK(source_ordinal BETWEEN 0 AND 19),
  field_states jsonb NOT NULL,wins bigint,losses bigint,ties bigint,rank bigint,seed bigint,
  points_for_value text,points_against_value text,
  PRIMARY KEY(content_id,provider,native_namespace,external_team_id),UNIQUE(content_id,source_ordinal),UNIQUE(content_id,season_team_id),
  FOREIGN KEY(content_id,league_season_id,provider,source_league_namespace,external_league_id)
    REFERENCES public.league_canonical_resource_contents(id,league_season_id,provider,source_league_namespace,external_league_id),
  FOREIGN KEY(season_team_id,league_season_id,provider,source_league_namespace,external_league_id,native_namespace,external_team_id)
    REFERENCES public.league_season_teams(id,league_season_id,provider,source_league_namespace,external_league_id,native_namespace,external_roster_id)
);
ALTER TABLE public.league_roster_resource_acceptances ALTER COLUMN receipt_id DROP NOT NULL;
ALTER TABLE public.league_roster_resource_acceptances ADD COLUMN canonical_receipt_id uuid UNIQUE;
ALTER TABLE public.league_roster_resource_acceptances ADD CONSTRAINT canonical_acceptance_xor_receipt
  CHECK((receipt_id IS NOT NULL)::integer+(canonical_receipt_id IS NOT NULL)::integer=1);
ALTER TABLE public.league_roster_resource_acceptances ADD CONSTRAINT canonical_acceptance_receipt_scope_fk
  FOREIGN KEY(canonical_receipt_id,scope_id) REFERENCES public.league_canonical_resource_receipts(id,scope_id);

CREATE FUNCTION public.canonical_exact_keys(p_value jsonb,p_keys text[]) RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,public,pg_temp AS $$
  SELECT CASE WHEN jsonb_typeof(p_value)='object' THEN
    (SELECT array_agg(key ORDER BY key COLLATE "C") FROM jsonb_object_keys(p_value) key)
      IS NOT DISTINCT FROM (SELECT array_agg(key ORDER BY key COLLATE "C") FROM unnest(p_keys) key)
    ELSE false END;
$$;
CREATE FUNCTION public.canonical_standings_scope(p_mapping jsonb) RETURNS jsonb
LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,public,pg_temp AS $$
  SELECT jsonb_build_object('kind','enrolled-resource','connectionId',p_mapping->>'connectionId',
    'leagueSeasonId',p_mapping->>'leagueSeasonId','family','standings','entityId',NULL,'scoringPeriodId',NULL,
    'audienceId','public','coverageSpecId','official-season-standings-v1');
$$;
CREATE FUNCTION public.canonical_legacy_mapping(p_mapping jsonb) RETURNS jsonb
LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
  PERFORM public.validate_canonical_resource_mapping(p_mapping);
  IF p_mapping->'scope'->>'provider'<>'sleeper' OR p_mapping->'scope'->>'nativeNamespace'<>'nfl'
    OR p_mapping->>'sourceNamespace'<>'nfl:'||(p_mapping->'scope'->>'season') THEN
    RAISE EXCEPTION 'canonical mapping has no legacy Sleeper projection'; END IF;
  RETURN (p_mapping-'sourceNamespace')||jsonb_build_object('scope',(p_mapping->'scope')-'nativeNamespace');
END; $$;

-- These are fixed allowlist branches, never executable names supplied by callers.
CREATE FUNCTION public.canonical_resource_policy(p_mapping jsonb,p_delivery jsonb) RETURNS jsonb
LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE source_policy jsonb; policy jsonb;
BEGIN
  PERFORM public.validate_canonical_resource_mapping(p_mapping);
  source_policy:=public.canonical_source_namespace_policy(jsonb_build_object('provider',p_mapping->'scope'->>'provider',
    'resourceKind','league','nativeNamespace',p_mapping->'scope'->>'nativeNamespace',
    'nativeId',p_mapping->'scope'->>'externalLeagueId'),(p_mapping->'scope'->>'season')::integer);
  IF p_mapping->'scope'->>'provider' IS DISTINCT FROM 'sleeper' OR p_mapping->'scope'->>'season' IS DISTINCT FROM '2026' THEN
    RAISE EXCEPTION 'unregistered canonical standings source'; END IF;
  policy:=jsonb_build_object('contractVersion','league-one-canonical-delivery-v1',
    'canonicalSchemaVersion','league-one-official-standings-v1','adapterVersion','sleeper-standings-adapter-v1',
    'nativeVerifierVersion','sleeper-standings-sql-v1','canonicalNormalizerVersion','sleeper-standings-canonical-v1',
    'hashVersion','league-one-jsonb-sha256-v1','validationVersion','canonical-standings-acceptance-v1',
    'audienceId','public','coverageSpecId','official-season-standings-v1','provider','sleeper','nativeKind','sleeper-rosters',
    'teamNamespace',source_policy->>'teamNamespace','originPolicy','network-bridge-v1');
  IF p_delivery IS NOT NULL AND EXISTS(SELECT 1 FROM jsonb_each(policy) item
    WHERE item.key IN ('contractVersion','canonicalSchemaVersion','adapterVersion','nativeVerifierVersion','canonicalNormalizerVersion','hashVersion')
      AND p_delivery->item.key IS DISTINCT FROM item.value) THEN RAISE EXCEPTION 'unregistered canonical standings codec'; END IF;
  RETURN policy;
END; $$;

-- An isolated source-pinned overlay replaces this closed admission branch.
-- Production contains no fixture provider, digest tuple, verifier or origin enablement.
CREATE FUNCTION public.canonical_fixture_job_context(p_mapping jsonb,p_policy jsonb,p_fence jsonb) RETURNS jsonb
LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
  RAISE EXCEPTION 'fixture canonical admission is not installed';
END; $$;

CREATE FUNCTION public.begin_canonical_resource_attempt(p_mapping jsonb,p_id uuid,p_scope jsonb,p_policy jsonb,p_fence jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE scope_row public.league_roster_resource_scopes%ROWTYPE; attempt public.league_roster_resource_attempts%ROWTYPE;
  head public.league_roster_resource_heads%ROWTYPE; context_value jsonb;
BEGIN
  PERFORM public.assert_canonical_job_fence(p_fence);
  PERFORM public.validate_canonical_resource_mapping(p_mapping);
  IF p_id IS NULL OR p_scope IS DISTINCT FROM public.canonical_standings_scope(p_mapping)
    OR p_policy IS DISTINCT FROM public.canonical_resource_policy(p_mapping,p_policy) THEN
    RAISE EXCEPTION 'unregistered canonical reservation'; END IF;
  IF p_policy->>'originPolicy'='fixture-v1' THEN
    context_value:=public.canonical_fixture_job_context(p_mapping,p_policy,p_fence);
  ELSIF p_policy->>'originPolicy' IS DISTINCT FROM 'network-bridge-v1' THEN RAISE EXCEPTION 'unknown canonical origin policy'; END IF;
  INSERT INTO public.league_roster_resource_scopes(connection_id,league_season_id,identity)
    VALUES((p_mapping->>'connectionId')::uuid,(p_mapping->>'leagueSeasonId')::uuid,jsonb_build_object('scope',p_scope,'policy',p_policy))
    ON CONFLICT DO NOTHING;
  SELECT * INTO STRICT scope_row FROM public.league_roster_resource_scopes WHERE identity=jsonb_build_object('scope',p_scope,'policy',p_policy);
  INSERT INTO public.league_roster_resource_heads(scope_id) VALUES(scope_row.id) ON CONFLICT DO NOTHING;
  SELECT * INTO STRICT head FROM public.league_roster_resource_heads WHERE scope_id=scope_row.id FOR UPDATE;
  PERFORM public.assert_canonical_job_fence(p_fence);
  IF p_policy->>'originPolicy'='fixture-v1' AND context_value IS DISTINCT FROM public.canonical_fixture_job_context(p_mapping,p_policy,p_fence) THEN
    RAISE EXCEPTION 'fixture job changed during canonical reservation'; END IF;
  SELECT * INTO attempt FROM public.league_roster_resource_attempts WHERE id=p_id;
  IF FOUND THEN
    IF attempt.scope_id<>scope_row.id OR attempt.source_mapping IS DISTINCT FROM p_mapping
      OR attempt.write_fence IS DISTINCT FROM p_fence OR attempt.canonical_reservation_context IS DISTINCT FROM context_value THEN
      RAISE EXCEPTION 'canonical reservation identity conflict'; END IF;
  ELSE
    UPDATE public.league_roster_resource_heads SET latest_ordinal=latest_ordinal+1 WHERE scope_id=scope_row.id RETURNING * INTO head;
    INSERT INTO public.league_roster_resource_attempts(id,scope_id,ordinal,expected_generation,source_mapping,write_fence,canonical_reservation_context)
      VALUES(p_id,scope_row.id,head.latest_ordinal,head.generation,p_mapping,p_fence,context_value) RETURNING * INTO attempt;
  END IF;
  IF attempt.capture_nonce IS NULL THEN RAISE EXCEPTION 'canonical reservation requires database nonce'; END IF;
  RETURN jsonb_build_object('id',attempt.id,'scopeId',attempt.scope_id,'ordinal',attempt.ordinal,
    'expectedGeneration',attempt.expected_generation,'nonce',attempt.capture_nonce);
END; $$;

CREATE FUNCTION public.canonical_standings_fact_valid(p_fact jsonb,p_kind text) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE amount numeric; value text;
BEGIN
  IF NOT public.canonical_exact_keys(p_fact,ARRAY['state','value']) OR p_fact->>'state' IS NULL
    OR p_fact->>'state' NOT IN ('known','absent','null','invalid') THEN RETURN false; END IF;
  IF p_fact->>'state'<>'known' THEN RETURN p_fact->'value'='null'::jsonb; END IF;
  value:=p_fact->>'value';
  IF p_kind='points' THEN
    RETURN jsonb_typeof(p_fact->'value')='string' AND length(value)<=1024
      AND value ~ '^-?(0|[1-9][0-9]*)(\.[0-9]*[1-9])?$' AND value<>'-0';
  END IF;
  IF jsonb_typeof(p_fact->'value') IS DISTINCT FROM 'number' THEN RETURN false; END IF;
  amount:=value::numeric;
  RETURN amount=trunc(amount) AND amount BETWEEN CASE WHEN p_kind='rank' THEN 1 ELSE 0 END AND 9007199254740991;
END; $$;
CREATE FUNCTION public.canonical_standings_reasons_valid(p_value jsonb,p_outcome boolean DEFAULT false) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE allowed text[]:=ARRAY['standings_identity_invalid','standings_team_limit_exceeded','standings_byte_limit_exceeded',
  'standings_decimal_limit_exceeded','standings_population_unproved','standings_population_mismatch','standings_capture_partial',
  'standings_record_fields_incomplete'];
BEGIN
  IF p_outcome THEN allowed:=allowed||ARRAY['source-time-stale','source-time-conflict','generation-or-ordinal-preserved']; END IF;
  IF jsonb_typeof(p_value) IS DISTINCT FROM 'array' OR jsonb_array_length(p_value)>32 THEN RETURN false; END IF;
  RETURN NOT EXISTS(SELECT 1 FROM jsonb_array_elements(p_value) item WHERE jsonb_typeof(item)<>'string' OR NOT(item#>>'{}'=ANY(allowed)))
    AND p_value=(SELECT COALESCE(jsonb_agg(value ORDER BY value COLLATE "C"),'[]'::jsonb)
      FROM (SELECT DISTINCT value FROM jsonb_array_elements_text(p_value)) codes);
END; $$;
CREATE FUNCTION public.validate_canonical_standings_value(p_facts jsonb,p_provider text,p_team_namespace text) RETURNS void
LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE item record; team jsonb; ref jsonb;
BEGIN
  IF NOT public.canonical_exact_keys(p_facts,ARRAY['schemaVersion','status','teams','reasons'])
    OR p_facts->>'schemaVersion' IS DISTINCT FROM 'league-one-official-standings-v1'
    OR p_facts->>'status' IS NULL OR p_facts->>'status' NOT IN ('qualified','invalid','capacity')
    OR jsonb_typeof(p_facts->'teams') IS DISTINCT FROM 'array'
    OR jsonb_array_length(p_facts->'teams')>20 OR octet_length(convert_to(p_facts::text,'UTF8'))>1048576
    OR NOT public.canonical_standings_reasons_valid(p_facts->'reasons') THEN RAISE EXCEPTION 'invalid canonical standings shape'; END IF;
  IF p_facts->>'status'<>'qualified' AND (p_facts->'teams'<>'[]'::jsonb OR p_facts->'reasons'='[]'::jsonb) THEN
    RAISE EXCEPTION 'invalid canonical rejected projection'; END IF;
  IF p_facts->>'status'='qualified' AND p_facts->'reasons'<>'[]'::jsonb THEN
    RAISE EXCEPTION 'qualified canonical projection has structural reasons'; END IF;
  FOR item IN SELECT value,ordinality FROM jsonb_array_elements(p_facts->'teams') WITH ORDINALITY LOOP
    team:=item.value;ref:=team->'sourceTeam';
    IF NOT public.canonical_exact_keys(team,ARRAY['sourceTeam','sourceOrdinal','record','pointsFor','pointsAgainst','providerRank','providerSeed'])
      OR NOT public.canonical_exact_keys(ref,ARRAY['provider','resourceKind','nativeNamespace','nativeId'])
      OR ref->>'provider' IS DISTINCT FROM p_provider OR ref->>'resourceKind' IS DISTINCT FROM 'team'
      OR ref->>'nativeNamespace' IS DISTINCT FROM p_team_namespace OR jsonb_typeof(ref->'nativeId') IS DISTINCT FROM 'string'
      OR length(ref->>'nativeId')<1 OR btrim(ref->>'nativeId')='' OR (ref->>'nativeId') ~ '[[:cntrl:]]'
      OR team->'sourceOrdinal' IS DISTINCT FROM to_jsonb(item.ordinality-1)
      OR NOT public.canonical_exact_keys(team->'record',ARRAY['wins','losses','ties'])
      OR NOT public.canonical_standings_fact_valid(team->'record'->'wins','record')
      OR NOT public.canonical_standings_fact_valid(team->'record'->'losses','record')
      OR NOT public.canonical_standings_fact_valid(team->'record'->'ties','record')
      OR NOT public.canonical_standings_fact_valid(team->'pointsFor','points')
      OR NOT public.canonical_standings_fact_valid(team->'pointsAgainst','points')
      OR NOT public.canonical_standings_fact_valid(team->'providerRank','rank')
      OR NOT public.canonical_standings_fact_valid(team->'providerSeed','rank') THEN RAISE EXCEPTION 'invalid canonical standings team'; END IF;
  END LOOP;
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(p_facts->'teams') AS duplicate_team(value) GROUP BY duplicate_team.value->'sourceTeam' HAVING count(*)>1) THEN
    RAISE EXCEPTION 'duplicate canonical standings team'; END IF;
END; $$;

CREATE FUNCTION public.canonical_standings_coverage(p_facts jsonb,p_expected integer,p_capture_complete boolean,p_population_qualified boolean)
RETURNS jsonb LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE population text; entity text; records text; reasons jsonb:=p_facts->'reasons'; fields jsonb; count_value integer:=jsonb_array_length(p_facts->'teams');
BEGIN
  population:=CASE WHEN p_expected IS NULL THEN 'unproved' WHEN p_facts->>'status'<>'qualified' OR p_expected<>count_value THEN 'mismatch'
    WHEN NOT p_population_qualified THEN 'unproved' ELSE 'proven' END;
  entity:=CASE WHEN p_facts->>'status'='qualified' AND p_capture_complete AND population='proven' THEN 'full'
    WHEN p_facts->>'status'='qualified' AND (population='mismatch' OR NOT p_capture_complete) THEN 'subset' ELSE 'unknown' END;
  SELECT COALESCE(jsonb_agg(field ORDER BY field COLLATE "C"),'[]'::jsonb) INTO fields
    FROM unnest(ARRAY['wins','losses','ties','pointsFor','pointsAgainst','providerRank','providerSeed']) field
    WHERE count_value>0 AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(p_facts->'teams') team
      WHERE CASE WHEN field IN ('wins','losses','ties') THEN team->'record'->field->>'state' ELSE team->field->>'state' END IS DISTINCT FROM 'known');
  records:=CASE WHEN p_facts->>'status'<>'qualified' OR count_value=0 THEN 'unknown'
    WHEN fields ?& ARRAY['wins','losses','ties','pointsFor','pointsAgainst'] THEN 'complete' ELSE 'partial' END;
  IF population<>'proven' THEN reasons:=reasons||jsonb_build_array('standings_population_'||population); END IF;
  IF NOT p_capture_complete THEN reasons:=reasons||'["standings_capture_partial"]'::jsonb; END IF;
  IF records<>'complete' THEN reasons:=reasons||'["standings_record_fields_incomplete"]'::jsonb; END IF;
  SELECT COALESCE(jsonb_agg(value ORDER BY value COLLATE "C"),'[]'::jsonb) INTO reasons FROM (SELECT DISTINCT value FROM jsonb_array_elements_text(reasons)) codes;
  RETURN jsonb_build_object('expectedTeamCount',p_expected,'population',population,'recordCompleteness',records,'qualification',p_facts->>'status','reasons',reasons,
    'coverage',jsonb_build_object('periodIds','[]'::jsonb,'interval',NULL,'entitySet',entity,'fields',fields,
      'pagination',CASE WHEN p_capture_complete THEN 'complete' ELSE 'unknown' END,'nextCursor',NULL,
      'completeness',CASE WHEN p_facts->>'status'<>'qualified' THEN 'unknown' WHEN entity='full' AND records='complete' THEN 'complete' ELSE 'partial' END,'reasons',reasons));
END; $$;

CREATE FUNCTION public.verify_sleeper_standings_delivery(p_input jsonb) RETURNS jsonb
LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE mapping jsonb:=p_input->'mapping'; policy jsonb:=p_input->'policy'; native_value jsonb; facts jsonb; teams jsonb; reasons jsonb;
  receipt public.league_roster_capture_receipts%ROWTYPE; native_content public.league_administration_contents%ROWTYPE;
  population_value jsonb; expected integer; capture_complete boolean:=true; result jsonb;
BEGIN
  native_value:=public.project_official_standings_native(p_input->'nativePayload',mapping->'scope'->>'externalLeagueId');
  SELECT COALESCE(jsonb_agg(jsonb_build_object('sourceTeam',jsonb_build_object('provider',mapping->'scope'->>'provider',
      'resourceKind','team','nativeNamespace',policy->>'teamNamespace','nativeId',team->>'externalRosterId'),
    'sourceOrdinal',team->'sourceOrdinal','record',jsonb_build_object(
      'wins',jsonb_build_object('state',team->'record'->'wins'->>'state','value',(team->'record'->'wins'->>'value')::bigint),
      'losses',jsonb_build_object('state',team->'record'->'losses'->>'state','value',(team->'record'->'losses'->>'value')::bigint),
      'ties',jsonb_build_object('state',team->'record'->'ties'->>'state','value',(team->'record'->'ties'->>'value')::bigint)),
    'pointsFor',jsonb_build_object('state',team->'pointsFor'->>'state','value',team->'pointsFor'->'value'),
    'pointsAgainst',jsonb_build_object('state',team->'pointsAgainst'->>'state','value',team->'pointsAgainst'->'value'),
    'providerRank',jsonb_build_object('state',team->'providerRank'->>'state','value',(team->'providerRank'->>'value')::bigint),
    'providerSeed',jsonb_build_object('state',team->'providerSeed'->>'state','value',(team->'providerSeed'->>'value')::bigint)) ORDER BY ordinal),'[]'::jsonb)
    INTO teams FROM jsonb_array_elements(native_value->'teams') WITH ORDINALITY AS entry(team,ordinal);
  SELECT COALESCE(jsonb_agg(code ORDER BY code COLLATE "C"),'[]'::jsonb) INTO reasons FROM (
    SELECT DISTINCT CASE value WHEN 'invalid_roster_identity' THEN 'standings_identity_invalid' ELSE value END code
    FROM jsonb_array_elements_text(native_value->'reasons')) codes;
  facts:=jsonb_build_object('schemaVersion','league-one-official-standings-v1','status',native_value->>'status','teams',teams,'reasons',reasons);
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(teams) team
    WHERE length(team->'pointsFor'->>'value')>1024 OR length(team->'pointsAgainst'->>'value')>1024) THEN
    facts:=jsonb_build_object('schemaVersion','league-one-official-standings-v1','status','capacity','teams','[]'::jsonb,
      'reasons','["standings_decimal_limit_exceeded"]'::jsonb);
  ELSIF octet_length(convert_to(facts::text,'UTF8'))>1048576 THEN
    facts:=jsonb_build_object('schemaVersion','league-one-official-standings-v1','status','capacity','teams','[]'::jsonb,
      'reasons','["standings_byte_limit_exceeded"]'::jsonb);
  END IF;
  IF policy->>'originPolicy'='network-bridge-v1' THEN
    SELECT * INTO STRICT receipt FROM public.league_roster_capture_receipts
      WHERE attempt_id=(p_input->'nativeSourceRef'->>'nativeAttemptId')::uuid;
    SELECT * INTO STRICT native_content FROM public.league_administration_contents WHERE id=receipt.content_id;
    IF native_content.payload IS DISTINCT FROM p_input->'nativePayload' OR native_content.provider<>'sleeper'
      OR native_content.family<>'rosters' OR native_content.week<>0
      OR native_content.league_season_id<>(mapping->>'leagueSeasonId')::uuid
      OR native_content.external_league_id IS DISTINCT FROM mapping->'scope'->>'externalLeagueId'
      OR public.roster_capture_population_evidence(receipt) IS DISTINCT FROM (CASE
        WHEN NULLIF(p_input->'populationEvidence','null'::jsonb) IS NULL THEN NULL ELSE jsonb_build_object(
          'observationId',p_input->'populationEvidence'->>'observationId','contentHash',p_input->'populationEvidence'->>'contentHash',
          'provenance',p_input->'populationEvidence'->'envelope'->'provenance') END)
      OR (NULLIF(p_input->'populationEvidence','null'::jsonb) IS NOT NULL AND NOT EXISTS(
        SELECT 1 FROM public.league_administration_contents configuration WHERE configuration.id=receipt.configuration_content_id
          AND configuration.payload=p_input->'populationEvidence'->'envelope'->'payload'
          AND configuration.content_hash=p_input->'populationEvidence'->>'contentHash'
          AND p_input->'populationEvidence'=jsonb_build_object('observationId',public.roster_capture_population_evidence(receipt)->>'observationId',
            'contentHash',configuration.content_hash,'envelope',jsonb_build_object('schemaVersion','league-administration-v1',
              'normalizerVersion',configuration.normalizer_version,'dialect','sleeper-nfl-v1','scope',public.canonical_legacy_mapping(mapping)->'scope',
              'family','league','week',NULL,'provenance',public.roster_capture_population_evidence(receipt)->'provenance',
              'completeness',configuration.completeness,'payload',configuration.payload))))
      OR public.roster_capture_provenance(receipt) IS DISTINCT FROM (p_input->'provenance')-ARRAY['captureId','nativeRevision','normalizedAt','sourceUpdatedAt']
      OR public.official_standings_typed_value(native_content.id) IS DISTINCT FROM native_value THEN
      RAISE EXCEPTION 'canonical bridge native evidence mismatch'; END IF;
    population_value:=public.official_standings_receipt_coverage(receipt.id);
    expected:=(population_value->>'expectedTeamCount')::integer;
    capture_complete:=native_content.completeness='complete';
  ELSIF policy->>'originPolicy'='fixture-v1' THEN
    IF NULLIF(p_input->'populationEvidence','null'::jsonb) IS NOT NULL THEN RAISE EXCEPTION 'standalone fixture population must be native'; END IF;
    -- A retained rosters-only translation sample has no independently proven population.
    expected:=NULL;
  ELSE RAISE EXCEPTION 'unregistered Sleeper canonical origin'; END IF;
  PERFORM public.validate_canonical_standings_value(facts,mapping->'scope'->>'provider',policy->>'teamNamespace');
  result:=public.canonical_standings_coverage(facts,expected,capture_complete,true);
  IF p_input->'canonicalValue' IS DISTINCT FROM facts OR p_input->'coverage' IS DISTINCT FROM result->'coverage' THEN
    RAISE EXCEPTION 'canonical standings native parity mismatch'; END IF;
  RETURN result||jsonb_build_object('canonicalValue',facts,'nativeSourceRef',p_input->'nativeSourceRef','legacyRosterReceiptId',receipt.id);
END; $$;

CREATE FUNCTION public.verify_registered_canonical_delivery(p_mapping jsonb,p_delivery jsonb) RETURNS jsonb
LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
  IF p_delivery->'mapping' IS DISTINCT FROM p_mapping
    OR p_delivery->'policy' IS DISTINCT FROM public.canonical_resource_policy(p_mapping,p_delivery) THEN
    RAISE EXCEPTION 'canonical verifier policy mismatch'; END IF;
  IF p_mapping->'scope'->>'provider'='sleeper' AND p_delivery->'policy'->>'nativeKind'='sleeper-rosters'
    AND p_delivery->'policy'->>'nativeVerifierVersion'='sleeper-standings-sql-v1' THEN
    RETURN public.verify_sleeper_standings_delivery(p_delivery);
  END IF;
  RAISE EXCEPTION 'unregistered canonical verifier';
END; $$;

-- New definitions never inherit callable PUBLIC defaults between ordered migrations.
DO $$ DECLARE signature text; role_name text; BEGIN
  FOREACH signature IN ARRAY ARRAY[
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
    'public.verify_registered_canonical_delivery(jsonb,jsonb)'] LOOP
    IF to_regprocedure(signature) IS NULL THEN RAISE EXCEPTION 'missing canonical function: %',signature; END IF;
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC',signature);
    FOREACH role_name IN ARRAY ARRAY['league_one_runtime','league_one_account','league_one_auth'] LOOP
      IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=role_name) THEN
        EXECUTE format('REVOKE ALL ON FUNCTION %s FROM %I',signature,role_name);
      END IF;
    END LOOP;
  END LOOP;
END; $$;
