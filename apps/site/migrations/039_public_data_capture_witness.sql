-- R039: trusted-collector causality, without comparing application and DB clocks.
-- Existing rows remain NULL. Only future immutable reservations/admissions receive
-- a nonce; retries keep the original nonce and server time. No history is backfilled.
ALTER TABLE public.league_roster_resource_attempts ADD COLUMN capture_nonce uuid;
ALTER TABLE public.league_roster_resource_attempts ALTER COLUMN capture_nonce SET DEFAULT gen_random_uuid();
ALTER TABLE public.public_data_dispatches ADD COLUMN capture_nonce uuid;
ALTER TABLE public.public_data_dispatches ALTER COLUMN capture_nonce SET DEFAULT gen_random_uuid();
ALTER TABLE public.public_data_dispatch_outcomes ADD COLUMN capture_acquisition jsonb;

-- Private derivation uses the exact existing owner/dispatch and complete resource
-- group. Reading the witness cannot renew a lease, reservation or freshness time.
CREATE FUNCTION public.derive_public_data_capture_witness(p_work jsonb,p_mapping jsonb,p_fence jsonb)
RETURNS jsonb LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE dispatch public.public_data_dispatches%ROWTYPE; reserved record;
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
  IF kind IN ('core','users','exact-matchups') THEN
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
    IF kind NOT IN ('core','exact-matchups') OR reserved.source_mapping IS DISTINCT FROM p_mapping
      OR reserved.capture_nonce IS NULL OR reserved.reserved_at<dispatch.admitted_at
      OR reserved.reserved_at>clock_timestamp() THEN
      RAISE EXCEPTION 'public capture reservation mismatch'; END IF;
    role_name:=CASE reserved.identity->'policy'->>'canonicalNormalizerVersion'
      WHEN 'sleeper-league-settings-v1' THEN 'settings'
      WHEN 'sleeper-current-players-v1' THEN 'players'
      WHEN 'sleeper-current-team-managers-v1' THEN 'managers'
      WHEN 'sleeper-current-team-manager-evidence-v2' THEN 'managersV2'
      WHEN 'sleeper-exact-matchups-v1' THEN 'matchups' ELSE NULL END;
    IF role_name IS NULL OR attempts ? role_name
      OR (role_name='matchups' AND reserved.identity->'scope'->>'scoringPeriodId'
        IS DISTINCT FROM 'sleeper:matchup-week:'||(p_work->>'nativeWeek')) THEN
      RAISE EXCEPTION 'public capture resource group mismatch'; END IF;
    attempts:=attempts||jsonb_build_object(role_name,jsonb_build_object('id',reserved.id,'nonce',reserved.capture_nonce));
  END LOOP;
  SELECT COALESCE(array_agg(key ORDER BY key COLLATE "C"),ARRAY[]::text[]) INTO role_names FROM jsonb_object_keys(attempts) key;
  IF (kind='core' AND role_names NOT IN (ARRAY['managers','players','settings'],ARRAY['managers','managersV2','players','settings']))
    OR (kind='exact-matchups' AND role_names<>ARRAY['matchups','settings'])
    OR (kind NOT IN ('core','exact-matchups') AND cardinality(role_names)<>0) THEN
    RAISE EXCEPTION 'complete public capture group required'; END IF;
  -- Recheck after every preceding source/job lock wait. The original DB admission
  -- bounds freshness even when identical content later deduplicates to an old row.
  PERFORM public.assert_public_data_owner(dispatch.intake_id,p_fence);
  IF dispatch.admitted_at<clock_timestamp()-interval '30 seconds' THEN
    RAISE EXCEPTION 'public capture admission expired'; END IF;
  witness:=jsonb_build_object('version','public-network-capture-v1','work',p_work,'fence',p_fence,
    'dispatchNonce',dispatch.capture_nonce,'mapping',p_mapping,'attempts',attempts);
  RETURN witness;
END; $$;

CREATE FUNCTION public.read_public_data_capture_witness(p_work jsonb,p_mapping jsonb,p_fence jsonb)
RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
  SELECT public.derive_public_data_capture_witness(p_work,p_mapping,p_fence);
$$;

CREATE FUNCTION public.assert_public_data_capture_witness(p_witness jsonb,p_fence jsonb,p_family text,p_week integer,p_mapping jsonb DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE work jsonb:=p_witness->'work'; kind text:=work->>'kind'; mapping jsonb:=NULLIF(p_witness->'mapping','null'::jsonb);
BEGIN
  IF jsonb_typeof(p_witness) IS DISTINCT FROM 'object'
    OR p_witness->>'version' IS DISTINCT FROM 'public-network-capture-v1'
    OR p_witness->'fence' IS DISTINCT FROM p_fence
    OR (p_mapping IS NOT NULL AND p_mapping IS DISTINCT FROM mapping)
    OR p_witness IS DISTINCT FROM public.derive_public_data_capture_witness(work,mapping,p_fence) THEN
    RAISE EXCEPTION 'invalid original public capture witness'; END IF;
  IF ((kind='identity' AND p_family='identity' AND p_week IS NULL)
    OR (kind='leagues' AND p_family='leagues' AND p_week IS NULL)
    OR (kind='bootstrap' AND p_family='league' AND p_week IS NULL)
    OR (kind='core' AND p_family IN ('league','rosters') AND p_week IS NULL)
    OR (kind='users' AND p_family='users' AND p_week IS NULL)
    OR (kind='exact-matchups' AND ((p_family='league' AND p_week IS NULL)
      OR (p_family='matchups' AND p_week=(work->>'nativeWeek')::integer)))) IS NOT TRUE THEN
    RAISE EXCEPTION 'public capture family or period mismatch'; END IF;
END; $$;

-- Omission alone keeps the old strict clock comparison. Present invalid evidence
-- raises, including JSON null; it can never silently fall back to the legacy path.
CREATE FUNCTION public.public_capture_after_reservation(p_provenance jsonb,p_attempt uuid)
RETURNS boolean LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE attempt public.league_roster_resource_attempts%ROWTYPE; identity_value jsonb; witness jsonb:=p_provenance->'acquisition';
  family_value text; native_week integer;
BEGIN
  SELECT * INTO STRICT attempt FROM public.league_roster_resource_attempts WHERE id=p_attempt;
  IF witness IS NULL THEN RETURN (p_provenance->>'requestStartedAt')::timestamptz>=attempt.reserved_at; END IF;
  SELECT identity INTO STRICT identity_value FROM public.league_roster_resource_scopes WHERE id=attempt.scope_id;
  family_value:=CASE identity_value->'scope'->>'family' WHEN 'league-season' THEN 'league'
    WHEN 'teams' THEN 'rosters' WHEN 'roster-membership' THEN 'rosters' WHEN 'matchups' THEN 'matchups' ELSE NULL END;
  native_week:=CASE WHEN family_value='matchups' THEN (witness->'work'->>'nativeWeek')::integer ELSE NULL END;
  PERFORM public.assert_public_data_capture_witness(witness,attempt.write_fence,family_value,native_week,attempt.source_mapping);
  IF attempt.capture_nonce IS NULL OR NOT EXISTS(SELECT 1 FROM jsonb_each(witness->'attempts') item
    WHERE item.value=jsonb_build_object('id',attempt.id,'nonce',attempt.capture_nonce)) THEN
    RAISE EXCEPTION 'public capture attempt witness mismatch'; END IF;
  RETURN true;
END; $$;

CREATE FUNCTION public.assert_public_capture_observation(p_input jsonb,p_role text)
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
    WHEN p_role IN ('settings','players','managers','managersV2','matchups') THEN ARRAY[p_role]
    ELSE NULL END;
  IF required_roles IS NULL THEN RAISE EXCEPTION 'public capture writer role mismatch'; END IF;
  FOREACH role_name IN ARRAY required_roles LOOP
    input_key:=CASE role_name WHEN 'settings' THEN 'leagueSettingsAcceptance' WHEN 'players' THEN 'rosterAcceptance'
      WHEN 'managers' THEN 'teamManagerAcceptance' WHEN 'managersV2' THEN 'teamManagerEvidenceAcceptance' ELSE 'matchupAcceptance' END;
    addition:=p_input->input_key;
    IF addition->'attempt'->>'id' IS DISTINCT FROM witness->'attempts'->role_name->>'id'
      OR addition->'attempt'->>'id' IS NULL THEN RAISE EXCEPTION 'public capture writer attempt mismatch'; END IF;
    PERFORM public.public_capture_after_reservation(p_input->'envelope'->'provenance',(addition->'attempt'->>'id')::uuid);
    IF family_value IN ('rosters','matchups') AND addition->'population'->'envelope'->'provenance'->'acquisition' IS DISTINCT FROM witness THEN
      RAISE EXCEPTION 'public capture population group mismatch'; END IF;
  END LOOP;
END; $$;

-- Full-input shape checks run before wrapper fields are stripped, but perform no
-- live admission check. Exact receipt replay still uses its original immutable hash.
CREATE FUNCTION public.assert_public_capture_input_shape(p_input jsonb)
RETURNS void LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE witness jsonb:=p_input->'envelope'->'provenance'->'acquisition'; family_value text:=p_input->'envelope'->>'family';
  roles text[]; role_name text; input_key text; addition jsonb;
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
    OR (family_value<>'users' AND witness->'mapping' IS DISTINCT FROM p_input->'sourceMapping')
    OR p_input->'envelope'->'provenance'->>'origin' IS DISTINCT FROM 'network'
    OR jsonb_typeof(witness->'attempts') IS DISTINCT FROM 'object'
    OR witness->'mapping'->'scope' IS DISTINCT FROM p_input->'envelope'->'scope' THEN
    RAISE EXCEPTION 'invalid public capture shape'; END IF;
  roles:=CASE family_value WHEN 'league' THEN ARRAY['settings']
    WHEN 'rosters' THEN CASE WHEN witness->'attempts' ? 'managersV2' THEN ARRAY['players','managers','managersV2'] ELSE ARRAY['players','managers'] END
    WHEN 'matchups' THEN ARRAY['matchups'] WHEN 'users' THEN ARRAY[]::text[] ELSE NULL END;
  IF roles IS NULL THEN RAISE EXCEPTION 'unsupported witnessed capture'; END IF;
  FOREACH role_name IN ARRAY roles LOOP
    input_key:=CASE role_name WHEN 'settings' THEN 'leagueSettingsAcceptance' WHEN 'players' THEN 'rosterAcceptance'
      WHEN 'managers' THEN 'teamManagerAcceptance' WHEN 'managersV2' THEN 'teamManagerEvidenceAcceptance' ELSE 'matchupAcceptance' END;
    addition:=p_input->input_key;
    IF addition->'attempt'->>'id' IS NULL
      OR addition->'attempt'->>'id' IS DISTINCT FROM witness->'attempts'->role_name->>'id'
      OR (family_value IN ('rosters','matchups') AND addition->'population'->'envelope'->'provenance'->'acquisition' IS DISTINCT FROM witness) THEN
      RAISE EXCEPTION 'complete witnessed writer input required'; END IF;
  END LOOP;
END; $$;

-- Effective acceptance/checkpoint bodies retain all pre-existing guards and replay order.
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

CREATE OR REPLACE FUNCTION public.record_league_administration_observation(p_input jsonb)
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

CREATE OR REPLACE FUNCTION public.record_league_administration_observation_v30(p_input jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE result jsonb; addition jsonb:=p_input->'matchupAcceptance'; token jsonb;
  attempt public.league_roster_resource_attempts%ROWTYPE; head public.league_roster_resource_heads%ROWTYPE;
  content public.league_administration_contents%ROWTYPE; configuration public.league_administration_contents%ROWTYPE;
  receipt public.league_roster_capture_receipts%ROWTYPE;
  provenance jsonb:=p_input->'envelope'->'provenance'; population jsonb;
  evidence_hash_value text; coverage_reason text:='complete_matchup_population_unproved';
  expected_count integer; covered boolean:=false; acceptance_id uuid; period_value text;
BEGIN
  -- Legacy wrapper executes once, with precisely its original input for matchups.
  result:=public.record_league_administration_observation_v29(
    p_input-'matchupAcceptance'-CASE WHEN addition IS NOT NULL THEN 'sourceMapping' ELSE '__no_removed_field__' END);
  IF addition IS NULL THEN RETURN result; END IF;
  token:=addition->'attempt'; population:=addition->'population';
  IF p_input->'envelope'->>'family' IS DISTINCT FROM 'matchups'
    OR p_input->'envelope'->>'week' IS NULL
    OR provenance->>'origin' IS DISTINCT FROM 'network'
    OR (provenance->>'requestStartedAt')::timestamptz IS NULL
    OR (provenance->>'requestCompletedAt')::timestamptz IS NULL
    OR (provenance->>'sourceObservedAt')::timestamptz IS NULL
    OR (provenance->>'checkedAt')::timestamptz IS NULL
    OR (provenance->>'requestStartedAt')::timestamptz>(provenance->>'requestCompletedAt')::timestamptz
    OR (provenance->>'requestCompletedAt')::timestamptz>(provenance->>'checkedAt')::timestamptz
    OR (provenance->>'sourceObservedAt')::timestamptz>(provenance->>'checkedAt')::timestamptz
    OR (provenance->>'checkedAt')::timestamptz>clock_timestamp()+interval '5 minutes'
    OR p_input->'sourceMapping' IS NULL THEN
    RAISE EXCEPTION 'matchup acceptance requires mapped complete network capture'; END IF;
  IF p_input->'envelope'->'scope' IS DISTINCT FROM p_input->'sourceMapping'->'scope' THEN
    RAISE EXCEPTION 'matchup envelope mapping mismatch'; END IF;
  PERFORM public.validate_current_roster_mapping(p_input->'sourceMapping');
  period_value:='sleeper:matchup-week:'||(p_input->'envelope'->>'week');
  SELECT * INTO STRICT attempt FROM public.league_roster_resource_attempts WHERE id=(token->>'id')::uuid;
  IF provenance->'acquisition' IS NULL AND (provenance->>'requestStartedAt')::timestamptz<attempt.reserved_at THEN
    RAISE EXCEPTION 'matchup request predates reservation'; END IF;
  IF attempt.source_mapping IS DISTINCT FROM p_input->'sourceMapping'
    OR attempt.write_fence IS DISTINCT FROM p_input->'writeFence'
    OR token IS DISTINCT FROM jsonb_build_object('id',attempt.id,'scopeId',attempt.scope_id,
      'ordinal',attempt.ordinal,'expectedGeneration',attempt.expected_generation)
    OR NOT EXISTS(SELECT 1 FROM public.league_roster_resource_scopes scope WHERE scope.id=attempt.scope_id
      AND scope.identity=jsonb_build_object('scope',jsonb_build_object('kind','enrolled-resource',
        'connectionId',attempt.source_mapping->>'connectionId','leagueSeasonId',attempt.source_mapping->>'leagueSeasonId',
        'family','matchups','entityId',NULL,'scoringPeriodId',period_value,'audienceId','public',
        'coverageSpecId','sleeper-exact-period-all-teams-matchups-v1'),
        'policy',jsonb_build_object('audienceId','public','coverageSpecId','sleeper-exact-period-all-teams-matchups-v1',
        'canonicalNormalizerVersion','sleeper-exact-matchups-v1','validationVersion','latest-network-attempt-v1'))) THEN
    RAISE EXCEPTION 'matchup attempt scope mismatch'; END IF;
  SELECT * INTO STRICT head FROM public.league_roster_resource_heads WHERE scope_id=attempt.scope_id FOR UPDATE;
  IF attempt.write_fence IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.projection_jobs job
    WHERE job.job_key=attempt.write_fence->>'jobKey' AND job.state='running'
      AND job.lease_owner=attempt.write_fence->>'workerId'
      AND job.attempt_count=(attempt.write_fence->>'generation')::integer
      AND job.lease_until>clock_timestamp() AND (attempt.write_fence->>'deadlineAt')::timestamptz>clock_timestamp()) THEN
    RAISE EXCEPTION 'matchup writer fence expired'; END IF;
  evidence_hash_value:=encode(digest(convert_to(p_input::text,'UTF8'),'sha256'),'hex');
  SELECT * INTO receipt FROM public.league_roster_capture_receipts WHERE attempt_id=attempt.id;
  IF FOUND THEN
    IF receipt.evidence_hash<>evidence_hash_value THEN RAISE EXCEPTION 'matchup attempt receipt conflict'; END IF;
    RETURN result||jsonb_build_object('matchupAcceptance',jsonb_build_object('status',
      CASE WHEN EXISTS(SELECT 1 FROM public.league_roster_resource_acceptances accepted
        WHERE accepted.id=head.accepted_id AND accepted.receipt_id=receipt.id)
        AND attempt.ordinal=head.latest_ordinal THEN 'accepted' ELSE 'preserved' END,
      'reason','exact_receipt_replay','receiptId',receipt.id,'acceptedGeneration',head.generation));
  END IF;
  PERFORM public.assert_public_capture_observation(p_input,'matchups');
  SELECT * INTO STRICT content FROM public.league_administration_contents stored
    WHERE stored.league_season_id=(attempt.source_mapping->>'leagueSeasonId')::uuid
      AND stored.provider='sleeper' AND stored.external_league_id=attempt.source_mapping->'scope'->>'externalLeagueId'
      AND stored.family='matchups' AND stored.week=(p_input->'envelope'->>'week')::integer
      AND stored.normalizer_version='sleeper-administration-v1' AND stored.content_hash=p_input->>'contentHash'
      AND stored.completeness=p_input->'envelope'->>'completeness'
      AND stored.accepted=(p_input->>'status'='accepted' AND p_input->'envelope'->>'completeness'='complete')
      AND stored.payload=p_input->'envelope'->'payload' AND stored.normalized_value IS NOT DISTINCT FROM p_input->'value';
  -- Population must come from a separately stored network league document in this batch.
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
      OR (provenance->'acquisition' IS NULL
        AND (population->'envelope'->'provenance'->>'requestStartedAt')::timestamptz<attempt.reserved_at)
      OR (population->'envelope'->'provenance'->>'sourceObservedAt')::timestamptz IS NULL
      OR (population->'envelope'->'provenance'->>'checkedAt')::timestamptz IS NULL
      OR (population->'envelope'->'provenance'->>'requestStartedAt')::timestamptz
        >(population->'envelope'->'provenance'->>'requestCompletedAt')::timestamptz
      OR (population->'envelope'->'provenance'->>'requestCompletedAt')::timestamptz
        >(population->'envelope'->'provenance'->>'checkedAt')::timestamptz
      OR (population->'envelope'->'provenance'->>'sourceObservedAt')::timestamptz
        >(population->'envelope'->'provenance'->>'checkedAt')::timestamptz
      OR (population->'envelope'->'provenance'->>'checkedAt')::timestamptz>clock_timestamp()+interval '5 minutes' THEN
      RAISE EXCEPTION 'matchup population evidence mismatch'; END IF;
    SELECT * INTO configuration FROM public.league_administration_contents stored
      WHERE stored.league_season_id=content.league_season_id AND stored.provider=content.provider
        AND stored.external_league_id=content.external_league_id AND stored.family='league' AND stored.week=0
        AND stored.normalizer_version='sleeper-administration-v1' AND stored.accepted AND stored.completeness='complete'
        AND stored.content_hash=population->>'contentHash' AND stored.payload=population->'envelope'->'payload'
        AND EXISTS(SELECT 1 FROM public.league_administration_observations observed
          WHERE observed.id=(population->>'observationId')::uuid AND observed.content_id=stored.id
            AND observed.league_season_id=stored.league_season_id AND observed.family='league' AND observed.week=0);
  END IF;
  expected_count:=(configuration.normalized_value->>'totalRosters')::integer;
  IF configuration.payload->>'total_rosters' IS DISTINCT FROM expected_count::text THEN expected_count:=NULL; END IF;
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
        AND (population IS NOT NULL AND settings_receipt.provenance=population->'envelope'->'provenance'
          AND settings_attempt.write_fence IS NOT DISTINCT FROM attempt.write_fence
          AND settings_receipt.legacy_observation_id=(population->>'observationId')::uuid)) THEN
    expected_count:=NULL; END IF;
  covered:=content.accepted AND content.completeness='complete' AND expected_count>0 AND jsonb_typeof(content.payload)='array'
    AND jsonb_typeof(content.normalized_value->'matchups')='array'
    AND jsonb_array_length(content.payload)=expected_count
    AND jsonb_array_length(content.normalized_value->'matchups')=expected_count
    AND (SELECT count(DISTINCT item->>'externalRosterId') FROM jsonb_array_elements(content.normalized_value->'matchups') item)=expected_count
    AND (SELECT count(*) FROM public.league_administration_team_entries entry
      JOIN public.league_season_teams team ON team.id=entry.team_id AND team.league_season_id=entry.league_season_id
      WHERE entry.content_id=content.id AND entry.league_season_id=content.league_season_id
        AND team.provider=content.provider AND team.external_league_id=content.external_league_id)=expected_count;
  INSERT INTO public.league_roster_capture_receipts(attempt_id,content_id,legacy_observation_id,evidence_hash,
    provenance,configuration_content_id,population_evidence,expected_team_count,coverage)
  VALUES(attempt.id,content.id,(result->>'observationId')::uuid,evidence_hash_value,provenance,
    configuration.id,CASE WHEN population IS NOT NULL THEN jsonb_build_object('observationId',population->>'observationId',
      'contentHash',population->>'contentHash','provenance',population->'envelope'->'provenance') ELSE NULL END,
    expected_count,jsonb_build_object('periodIds',jsonb_build_array(period_value),'interval',NULL,
      'entitySet',CASE WHEN covered THEN 'full' ELSE 'unknown' END,
      'fields','["roster_id","matchup_id"]'::jsonb,
      'pagination','complete','nextCursor',NULL,'completeness',CASE WHEN covered THEN 'complete' ELSE 'unknown' END,
      'reasons',CASE WHEN covered THEN '[]'::jsonb ELSE jsonb_build_array(coverage_reason) END))
    RETURNING * INTO receipt;
  IF attempt.ordinal=head.latest_ordinal AND attempt.expected_generation=head.generation AND covered THEN
    IF attempt.write_fence IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.projection_jobs job
      WHERE job.job_key=attempt.write_fence->>'jobKey' AND job.state='running'
        AND job.lease_owner=attempt.write_fence->>'workerId'
        AND job.attempt_count=(attempt.write_fence->>'generation')::integer
        AND job.lease_until>clock_timestamp()
        AND (attempt.write_fence->>'deadlineAt')::timestamptz>clock_timestamp()) THEN
      RAISE EXCEPTION 'matchup writer fence expired'; END IF;
    INSERT INTO public.league_roster_resource_acceptances(scope_id,receipt_id,source_mapping_revision_id,generation)
      VALUES(attempt.scope_id,receipt.id,(attempt.source_mapping->>'revisionId')::uuid,head.generation+1)
      RETURNING id INTO acceptance_id;
    UPDATE public.league_roster_resource_heads SET accepted_id=acceptance_id,generation=generation+1
      WHERE scope_id=attempt.scope_id RETURNING * INTO head;
  END IF;
  RETURN result||jsonb_build_object('matchupAcceptance',jsonb_build_object('status',
    CASE WHEN acceptance_id IS NOT NULL THEN 'accepted' ELSE 'preserved' END,
    'reason',CASE WHEN acceptance_id IS NOT NULL THEN NULL
      WHEN attempt.ordinal<>head.latest_ordinal THEN 'newer_network_attempt_reserved'
      WHEN attempt.expected_generation<>head.generation THEN 'accepted_generation_changed'
      WHEN NOT COALESCE(covered,false) THEN coverage_reason ELSE NULL END,
    'receiptId',receipt.id,'acceptedGeneration',head.generation));
END; $$;

CREATE OR REPLACE FUNCTION public.checkpoint_public_data_intake(p_work jsonb,p_capture jsonb,p_fence jsonb) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE request_id uuid:=(p_work->>'requestId')::uuid; kind text:=p_work->>'kind';
  acquisition jsonb;
  value jsonb:=p_capture->'value'; native text; manager_id uuid; started timestamptz; completed timestamptz;
  v_league_id uuid; season_id uuid; connection_id uuid; item jsonb; count_selected integer;
  observation uuid; v_family text; mapping jsonb; receipt_key text; wanted_receipt_id uuid;
  dispatch_row public.public_data_dispatches%ROWTYPE; directory jsonb; directory_content uuid; directory_capture_id uuid; task public.public_data_exact_period_tasks%ROWTYPE; period_scope jsonb;
BEGIN
  PERFORM public.guard_public_data_intake(p_work,p_fence);
  SELECT exact_periods INTO STRICT period_scope FROM public.public_data_intakes WHERE id=request_id;
  IF NOT EXISTS(SELECT 1 FROM public.public_data_dispatches dispatch WHERE dispatch.worker_id=p_fence->>'workerId'
    AND dispatch.generation=(p_fence->>'generation')::integer AND dispatch.work=p_work AND NOT EXISTS(
      SELECT 1 FROM public.public_data_dispatch_outcomes outcome WHERE outcome.worker_id=dispatch.worker_id AND outcome.generation=dispatch.generation)) THEN
    RAISE EXCEPTION 'matching admitted public dispatch required';
  END IF;
  SELECT * INTO STRICT dispatch_row FROM public.public_data_dispatches
    WHERE worker_id=p_fence->>'workerId' AND generation=(p_fence->>'generation')::integer;
  IF p_capture->'failed'='true'::jsonb THEN
    PERFORM public.fail_public_data_work(p_work);
    PERFORM public.assert_public_data_owner(request_id,p_fence);
    INSERT INTO public.public_data_dispatch_outcomes(worker_id,generation,outcome)
      VALUES(p_fence->>'workerId',(p_fence->>'generation')::integer,'failed');
    RETURN;
  END IF;
  IF kind IN ('identity','leagues','bootstrap') THEN
    started:=(p_capture->>'requestStartedAt')::timestamptz; completed:=(p_capture->>'requestCompletedAt')::timestamptz;
    acquisition:=p_capture->'acquisition';
    IF acquisition IS NOT NULL THEN
      PERFORM public.assert_public_data_capture_witness(acquisition,p_fence,
        CASE WHEN kind='bootstrap' THEN 'league' ELSE kind END,NULL);
    END IF;
    IF started IS NULL OR completed IS NULL OR started>completed
      OR (acquisition IS NULL AND (completed>clock_timestamp() OR started<clock_timestamp()-interval '30 seconds')) THEN
      RAISE EXCEPTION 'invalid public capture timing'; END IF;
  END IF;
  IF p_capture->>'diagnostic'='invalid-source' THEN
    INSERT INTO public.public_data_rejections(intake_id,revision,resource,source_scope,payload,request_started_at,request_completed_at,reason)
      VALUES(request_id,(p_work->>'revision')::integer,kind,p_work,p_capture->'payload',started,completed,'invalid-source');
    PERFORM public.checkpoint_public_data_intake(p_work,'{"failed":true}'::jsonb,p_fence);
    RETURN;
  END IF;
  IF kind='identity' THEN
    native:=value->>'userId';
    IF native IS NULL OR native !~ '^[1-9][0-9]{0,31}$' OR p_capture->'payload'->>'user_id' IS DISTINCT FROM native
      OR btrim(p_capture->'payload'->>'username') IS DISTINCT FROM value->>'username'
      OR length(value->>'username') NOT BETWEEN 1 AND 100 OR length(value->>'displayName') NOT BETWEEN 1 AND 100
      OR (p_work->>'username' ~ '^[1-9][0-9]{0,31}$' AND native<>p_work->>'username') THEN
      RAISE EXCEPTION 'invalid public identity capture'; END IF;
    INSERT INTO public.league_source_manager_accounts(provider,external_manager_id) VALUES('sleeper',native) ON CONFLICT DO NOTHING;
    SELECT id INTO STRICT manager_id FROM public.league_source_manager_accounts WHERE provider='sleeper' AND external_manager_id=native;
    INSERT INTO public.public_data_identity_observations(intake_id,source_manager_account_id,username,display_name,avatar_url,payload,request_started_at,request_completed_at)
      VALUES(request_id,manager_id,value->>'username',value->>'displayName',value->>'avatarUrl',p_capture->'payload',started,completed);
  ELSIF kind='leagues' THEN
    IF jsonb_typeof(value) IS DISTINCT FROM 'array' OR jsonb_array_length(value)>1000
      OR jsonb_typeof(p_capture->'payload') IS DISTINCT FROM 'array' OR jsonb_array_length(p_capture->'payload')>1000 THEN
      RAISE EXCEPTION 'invalid public list'; END IF;
    INSERT INTO public.public_data_league_lists(intake_id,season,payload,request_started_at,request_completed_at)
      VALUES(request_id,(p_work->>'season')::integer,p_capture->'payload',started,completed);
    SELECT count(*) INTO count_selected FROM public.public_data_league_candidates WHERE intake_id=request_id AND stage<>'capacity';
    FOR item IN SELECT entry FROM jsonb_array_elements(value) entry LOOP
      IF item->>'id' IS NULL OR item->>'id' !~ '^[1-9][0-9]{0,31}$' OR item->>'season' IS DISTINCT FROM p_work->>'season'
        OR length(item->>'name') NOT BETWEEN 1 AND 200 OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(p_capture->'payload') raw
          WHERE raw->>'league_id'=item->>'id' AND raw->>'season'=p_work->>'season' AND raw->>'sport'='nfl'
            AND btrim(raw->>'name')=item->>'name') THEN RAISE EXCEPTION 'invalid public list member'; END IF;
      INSERT INTO public.public_data_league_candidates(intake_id,season,external_league_id,name,stage)
        VALUES(request_id,(p_work->>'season')::integer,item->>'id',item->>'name',CASE WHEN count_selected<20 THEN 'bootstrap' ELSE 'capacity' END);
      count_selected:=count_selected+1;
    END LOOP;
    IF EXISTS(SELECT 1 FROM jsonb_array_elements(p_capture->'payload') raw WHERE NOT EXISTS(
      SELECT 1 FROM public.public_data_league_candidates candidate WHERE candidate.intake_id=request_id
        AND candidate.season=(p_work->>'season')::integer AND candidate.external_league_id=raw->>'league_id')) THEN
      RAISE EXCEPTION 'public list silently omitted a source member'; END IF;
    IF period_scope<>'[]'::jsonb THEN
      INSERT INTO public.public_data_exact_period_tasks(intake_id,ordinal,season,external_league_id,native_week)
      SELECT request_id,(SELECT count(*) FROM public.public_data_exact_period_tasks WHERE intake_id=request_id)
        +row_number() OVER(ORDER BY candidate.season,candidate.external_league_id),candidate.season,candidate.external_league_id,(period->>'nativeWeek')::integer
      FROM public.public_data_league_candidates candidate JOIN public.public_data_intakes request ON request.id=candidate.intake_id
      CROSS JOIN LATERAL jsonb_array_elements(request.exact_periods) period
      WHERE candidate.intake_id=request_id AND candidate.season=(p_work->>'season')::integer AND candidate.stage<>'capacity'
        AND (period->>'season')::integer=candidate.season;
    END IF;
  ELSIF kind='bootstrap' THEN
    IF p_capture->>'capacity'='roster-count-unqualified' THEN
      UPDATE public.public_data_league_candidates SET stage='capacity',bootstrap_payload=p_capture->'payload',
        bootstrap_started_at=started,bootstrap_completed_at=completed WHERE intake_id=request_id
        AND season=(p_work->>'season')::integer AND external_league_id=p_work->>'externalLeagueId';
      IF period_scope<>'[]'::jsonb THEN
        UPDATE public.public_data_exact_period_tasks SET status='unavailable',reason='bootstrap-capacity' WHERE intake_id=request_id
          AND season=(p_work->>'season')::integer AND external_league_id=p_work->>'externalLeagueId' AND status='pending';
      END IF;
      UPDATE public.public_data_intakes SET revision=revision+1,failure_count=0 WHERE id=request_id;
      IF public.next_public_data_intake(request_id) IN ('"complete"'::jsonb,'"partial"'::jsonb) THEN
        UPDATE public.public_data_intakes SET terminal=true WHERE id=request_id;
      END IF;
      PERFORM public.assert_public_data_owner(request_id,p_fence);
      INSERT INTO public.public_data_dispatch_outcomes(worker_id,generation,outcome,capture_acquisition)
        VALUES(p_fence->>'workerId',(p_fence->>'generation')::integer,'checkpoint-committed',acquisition);
      RETURN;
    END IF;
    season_id:=(p_capture->>'leagueSeasonId')::uuid; v_league_id:=(p_capture->>'leagueId')::uuid;
    IF NOT EXISTS(SELECT 1 FROM public.league_source_connections connection JOIN public.league_seasons season ON season.id=connection.league_season_id
      WHERE season.id=season_id AND season.league_id=v_league_id AND season.season=(p_work->>'season')::integer
        AND connection.provider='sleeper' AND connection.external_league_id=p_work->>'externalLeagueId')
      OR p_capture->'payload'->>'league_id' IS DISTINCT FROM p_work->>'externalLeagueId'
      OR p_capture->'payload'->>'season' IS DISTINCT FROM p_work->>'season'
      OR p_capture->'payload'->>'sport' IS DISTINCT FROM 'nfl' THEN RAISE EXCEPTION 'public registration mismatch'; END IF;
    PERFORM public.assert_league_collection_capacity(p_work->>'externalLeagueId');
    PERFORM public.assert_public_data_owner(request_id,p_fence);
    INSERT INTO public.league_administration_enrollments(league_id,provider,active,evidence)
      VALUES(v_league_id,'sleeper',false,'public-data-intake-v1') ON CONFLICT DO NOTHING;
    INSERT INTO public.league_administration_enrollment_seasons(league_id,season,provider,evidence)
      VALUES(v_league_id,(p_work->>'season')::integer,'sleeper','public-data-intake-v1') ON CONFLICT DO NOTHING;
    UPDATE public.public_data_league_candidates SET league_season_id=season_id,bootstrap_payload=p_capture->'payload',
      bootstrap_started_at=started,bootstrap_completed_at=completed,stage='core'
      WHERE intake_id=request_id AND season=(p_work->>'season')::integer AND external_league_id=p_work->>'externalLeagueId';
  ELSIF kind='exact-matchups' THEN
    IF period_scope='[]'::jsonb THEN RAISE EXCEPTION 'explicit public period scope required'; END IF;
    IF jsonb_typeof(p_capture->'observations') IS DISTINCT FROM 'object' OR jsonb_typeof(p_capture->'receipts') IS DISTINCT FROM 'object' THEN
      RAISE EXCEPTION 'exact period checkpoint incomplete'; END IF;
    IF (SELECT count(*) FROM jsonb_object_keys(p_capture->'observations'))<>2
      OR NOT(p_capture->'observations' ?& ARRAY['league','matchups'])
      OR (SELECT count(*) FROM jsonb_object_keys(p_capture->'receipts'))<>2
      OR NOT(p_capture->'receipts' ?& ARRAY['settings','matchups']) THEN RAISE EXCEPTION 'exact period checkpoint incomplete'; END IF;
    SELECT * INTO STRICT task FROM public.public_data_exact_period_tasks WHERE intake_id=request_id
      AND season=(p_work->>'season')::integer AND external_league_id=p_work->>'externalLeagueId'
      AND native_week=(p_work->>'nativeWeek')::integer AND status='pending';
    IF NOT EXISTS(SELECT 1 FROM public.league_roster_capture_receipts receipt
      JOIN public.league_roster_resource_attempts attempt ON attempt.id=receipt.attempt_id
      WHERE receipt.id=(p_capture->'receipts'->>'settings')::uuid AND attempt.write_fence=p_fence
        AND receipt.legacy_observation_id=(p_capture->'observations'->>'league')::uuid)
      OR NOT EXISTS(SELECT 1 FROM public.league_roster_capture_receipts receipt
      JOIN public.league_roster_resource_attempts attempt ON attempt.id=receipt.attempt_id
      WHERE receipt.id=(p_capture->'receipts'->>'matchups')::uuid AND attempt.write_fence=p_fence
        AND receipt.legacy_observation_id=(p_capture->'observations'->>'matchups')::uuid) THEN RAISE EXCEPTION 'exact period observation mismatch'; END IF;
    INSERT INTO public.public_data_exact_period_checkpoints(intake_id,task_ordinal,worker_id,generation,league_season_id,
      source_mapping,settings_receipt_id,matchups_receipt_id)
      VALUES(request_id,task.ordinal,p_fence->>'workerId',(p_fence->>'generation')::integer,(p_capture->'mapping'->>'leagueSeasonId')::uuid,
        p_capture->'mapping',(p_capture->'receipts'->>'settings')::uuid,(p_capture->'receipts'->>'matchups')::uuid);
    SELECT provenance->'acquisition' INTO acquisition FROM public.league_roster_capture_receipts
      WHERE id=(p_capture->'receipts'->>'settings')::uuid;
    PERFORM public.assert_public_data_owner(request_id,p_fence);
    UPDATE public.public_data_exact_period_tasks SET status='complete' WHERE intake_id=request_id AND ordinal=task.ordinal;
  ELSIF kind IN ('core','users') THEN
    mapping:=p_capture->'mapping'; season_id:=(mapping->>'leagueSeasonId')::uuid; connection_id:=(mapping->>'connectionId')::uuid;
    PERFORM public.validate_current_roster_mapping(mapping);
    IF NOT EXISTS(SELECT 1 FROM public.league_source_connections connection
      JOIN public.public_data_league_candidates candidate ON candidate.league_season_id=connection.league_season_id
      WHERE candidate.intake_id=request_id AND candidate.season=(p_work->>'season')::integer
        AND candidate.external_league_id=p_work->>'externalLeagueId' AND connection.id=connection_id
        AND connection.league_season_id=season_id AND connection.provider='sleeper'
        AND connection.external_league_id=candidate.external_league_id
        AND connection.current_mapping_revision_id=(mapping->>'revisionId')::uuid
        AND connection.mapping_generation=(mapping->>'generation')::integer) THEN RAISE EXCEPTION 'public source mapping changed'; END IF;
    IF jsonb_typeof(p_capture->'observations') IS DISTINCT FROM 'object'
      OR (kind='core' AND (p_capture->'observations'->>'league' IS NULL OR p_capture->'observations'->>'rosters' IS NULL
        OR (SELECT count(*) FROM jsonb_object_keys(p_capture->'observations'))<>2))
      OR (kind='users' AND (p_capture->'observations'->>'users' IS NULL
        OR (SELECT count(*) FROM jsonb_object_keys(p_capture->'observations'))<>1 OR p_capture ? 'receipts')) THEN
      RAISE EXCEPTION 'public resource checkpoint incomplete'; END IF;
    FOR v_family,observation IN SELECT entries.key,entries.value::uuid FROM jsonb_each_text(p_capture->'observations') entries LOOP
      IF v_family NOT IN ('league','rosters','users') OR NOT EXISTS(SELECT 1 FROM public.league_administration_observations observed
        JOIN public.league_administration_contents content ON content.id=observed.content_id
        WHERE observed.id=observation AND observed.league_season_id=season_id AND observed.family=v_family AND observed.week=0
          AND (v_family='league' OR observed.outcome IN ('changed','unchanged'))
          AND content.accepted AND content.completeness='complete' AND content.provider='sleeper'
          AND content.external_league_id=p_work->>'externalLeagueId') THEN RAISE EXCEPTION 'public resource lineage mismatch'; END IF;
    END LOOP;
    IF kind='core' THEN
      SELECT provenance->'acquisition' INTO acquisition FROM public.league_roster_capture_receipts
        WHERE id=(p_capture->'receipts'->>'settings')::uuid;
      FOREACH receipt_key IN ARRAY ARRAY['settings','players','managers'] LOOP
        wanted_receipt_id:=(p_capture->'receipts'->>receipt_key)::uuid;
        IF wanted_receipt_id IS NULL OR NOT EXISTS(SELECT 1 FROM public.league_roster_resource_acceptances accepted
          JOIN public.league_roster_capture_receipts receipt ON receipt.id=accepted.receipt_id
          JOIN public.league_roster_resource_attempts attempt ON attempt.id=receipt.attempt_id
          JOIN public.league_roster_resource_scopes resource ON resource.id=attempt.scope_id
          JOIN public.league_roster_resource_heads head ON head.scope_id=resource.id AND head.accepted_id=accepted.id
          WHERE receipt.id=wanted_receipt_id AND accepted.source_mapping_revision_id=(mapping->>'revisionId')::uuid
            AND attempt.source_mapping=mapping AND attempt.write_fence=p_fence
            AND attempt.ordinal=head.latest_ordinal AND attempt.reserved_at>=dispatch_row.admitted_at
            AND receipt.provenance->>'origin'='network'
            AND receipt.provenance->'acquisition' IS NOT DISTINCT FROM acquisition
            AND CASE WHEN acquisition IS NULL THEN
              (receipt.provenance->>'requestStartedAt')::timestamptz>=dispatch_row.admitted_at
              AND (receipt.provenance->>'requestStartedAt')::timestamptz>=clock_timestamp()-interval '30 seconds'
              AND (receipt.provenance->>'requestCompletedAt')::timestamptz BETWEEN
                (receipt.provenance->>'requestStartedAt')::timestamptz AND clock_timestamp()
            ELSE public.public_capture_after_reservation(receipt.provenance,attempt.id)
              AND receipt.recorded_at BETWEEN attempt.reserved_at AND clock_timestamp()
              AND (receipt.provenance->>'requestStartedAt')::timestamptz<=(receipt.provenance->>'requestCompletedAt')::timestamptz END
            AND (receipt.provenance->>'sourceObservedAt')::timestamptz=(receipt.provenance->>'requestCompletedAt')::timestamptz
            AND receipt.coverage->>'completeness'='complete'
            AND receipt.legacy_observation_id=(p_capture->'observations'->>CASE WHEN receipt_key='settings' THEN 'league' ELSE 'rosters' END)::uuid
            AND resource.identity->'policy'->>'canonicalNormalizerVersion'=CASE receipt_key
              WHEN 'settings' THEN 'sleeper-league-settings-v1' WHEN 'players' THEN 'sleeper-current-players-v1'
              ELSE 'sleeper-current-team-managers-v1' END) THEN
          RAISE EXCEPTION 'current typed public resource receipt required';
        END IF;
      END LOOP;
    END IF;
    IF kind='users' THEN
      directory:=p_capture->'directoryCapture';
      acquisition:=directory->'acquisition';
      IF acquisition IS NOT NULL THEN
        PERFORM public.assert_public_data_capture_witness(acquisition,p_fence,'users',NULL,mapping);
      END IF;
      started:=(directory->>'requestStartedAt')::timestamptz;
      completed:=(directory->>'requestCompletedAt')::timestamptz;
      IF directory->>'family' IS DISTINCT FROM 'users' OR directory->'week' IS DISTINCT FROM 'null'::jsonb
        OR directory->>'origin' IS DISTINCT FROM 'network'
        OR COALESCE(directory->>'completeness','complete')<>'complete'
        OR started IS NULL OR completed IS NULL OR started>completed
        OR (acquisition IS NULL AND (completed>clock_timestamp()
          OR started<dispatch_row.admitted_at OR started<clock_timestamp()-interval '30 seconds'))
        OR COALESCE(directory->>'sourceObservedAt',directory->>'requestCompletedAt')::timestamptz IS DISTINCT FROM completed THEN
        RAISE EXCEPTION 'fresh dispatch-bound directory capture required';
      END IF;
      SELECT content.id INTO directory_content FROM public.league_administration_observations observed
        JOIN public.league_administration_contents content ON content.id=observed.content_id
        JOIN public.league_administration_heads head ON head.league_season_id=observed.league_season_id
          AND head.family='users' AND head.week=0 AND head.accepted_observation_id=observed.id
        WHERE observed.id=(p_capture->'observations'->>'users')::uuid AND observed.league_season_id=season_id
          AND observed.family='users' AND observed.week=0
          AND observed.outcome IN ('changed','unchanged') AND content.accepted AND content.completeness='complete'
          AND content.provider='sleeper' AND content.external_league_id=p_work->>'externalLeagueId'
          AND content.payload=directory->'payload' AND content.normalizer_version='sleeper-administration-v1'
          AND head.read_conflict IS NULL AND head.verified_at=completed AND head.ordering_at=completed;
      IF directory_content IS NULL THEN RAISE EXCEPTION 'directory capture content or freshness mismatch'; END IF;
      INSERT INTO public.public_data_directory_captures(intake_id,worker_id,generation,league_season_id,source_mapping,
        content_id,legacy_observation_id,request_started_at,request_completed_at,source_observed_at)
        VALUES(request_id,p_fence->>'workerId',(p_fence->>'generation')::integer,season_id,mapping,directory_content,
          (p_capture->'observations'->>'users')::uuid,started,completed,completed) RETURNING id INTO directory_capture_id;
    END IF;
    UPDATE public.public_data_league_candidates SET
      league_observation_id=coalesce((p_capture->'observations'->>'league')::uuid,league_observation_id),
      roster_observation_id=coalesce((p_capture->'observations'->>'rosters')::uuid,roster_observation_id),
      users_observation_id=coalesce((p_capture->'observations'->>'users')::uuid,users_observation_id),
      users_capture_id=coalesce(directory_capture_id,users_capture_id),
      settings_receipt_id=coalesce((p_capture->'receipts'->>'settings')::uuid,settings_receipt_id),
      players_receipt_id=coalesce((p_capture->'receipts'->>'players')::uuid,players_receipt_id),
      managers_receipt_id=coalesce((p_capture->'receipts'->>'managers')::uuid,managers_receipt_id),
      stage=CASE WHEN kind='core' THEN 'users' ELSE 'complete' END
      WHERE intake_id=request_id AND season=(p_work->>'season')::integer AND external_league_id=p_work->>'externalLeagueId';
  ELSE RAISE EXCEPTION 'invalid public checkpoint kind'; END IF;
  PERFORM public.assert_public_data_owner(request_id,p_fence);
  UPDATE public.public_data_intakes SET revision=revision+1,failure_count=0,next_attempt_at=clock_timestamp() WHERE id=request_id;
  IF public.next_public_data_intake(request_id) IN ('"complete"'::jsonb,'"partial"'::jsonb) THEN
    UPDATE public.public_data_intakes SET terminal=true WHERE id=request_id;
  END IF;
  PERFORM public.assert_public_data_owner(request_id,p_fence);
  INSERT INTO public.public_data_dispatch_outcomes(worker_id,generation,outcome,capture_acquisition)
    VALUES(p_fence->>'workerId',(p_fence->>'generation')::integer,'checkpoint-committed',acquisition);
END; $$;

CREATE OR REPLACE FUNCTION public.validate_public_data_exact_period_checkpoint() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE task public.public_data_exact_period_tasks%ROWTYPE; dispatch public.public_data_dispatches%ROWTYPE;
  settings public.league_roster_capture_receipts%ROWTYPE; matchups public.league_roster_capture_receipts%ROWTYPE;
  settings_attempt public.league_roster_resource_attempts%ROWTYPE; matchup_attempt public.league_roster_resource_attempts%ROWTYPE;
  wanted uuid; is_settings boolean; identity_value jsonb; reserved timestamptz;
BEGIN
  SELECT * INTO STRICT task FROM public.public_data_exact_period_tasks WHERE intake_id=NEW.intake_id AND ordinal=NEW.task_ordinal;
  SELECT * INTO STRICT dispatch FROM public.public_data_dispatches WHERE worker_id=NEW.worker_id AND generation=NEW.generation;
  SELECT * INTO STRICT settings FROM public.league_roster_capture_receipts WHERE id=NEW.settings_receipt_id;
  SELECT * INTO STRICT matchups FROM public.league_roster_capture_receipts WHERE id=NEW.matchups_receipt_id;
  SELECT * INTO STRICT settings_attempt FROM public.league_roster_resource_attempts WHERE id=settings.attempt_id;
  SELECT * INTO STRICT matchup_attempt FROM public.league_roster_resource_attempts WHERE id=matchups.attempt_id;
  IF task.status<>'pending' OR dispatch.intake_id<>NEW.intake_id OR dispatch.resource<>'exact-matchups' OR dispatch.max_requests<>2
    OR dispatch.work->>'requestId' IS DISTINCT FROM NEW.intake_id::text
    OR dispatch.work->>'season' IS DISTINCT FROM task.season::text
    OR dispatch.work->>'nativeWeek' IS DISTINCT FROM task.native_week::text
    OR dispatch.work->>'externalLeagueId' IS DISTINCT FROM task.external_league_id
    OR settings_attempt.write_fence->>'workerId' IS DISTINCT FROM NEW.worker_id
    OR settings_attempt.write_fence->>'generation' IS DISTINCT FROM NEW.generation::text
    OR matchup_attempt.write_fence IS DISTINCT FROM settings_attempt.write_fence
    OR settings_attempt.source_mapping IS DISTINCT FROM NEW.source_mapping
    OR matchup_attempt.source_mapping IS DISTINCT FROM NEW.source_mapping
    OR NEW.source_mapping->>'leagueSeasonId' IS DISTINCT FROM NEW.league_season_id::text
    OR NOT EXISTS(SELECT 1 FROM public.public_data_league_candidates candidate WHERE candidate.intake_id=task.intake_id
      AND candidate.season=task.season AND candidate.external_league_id=task.external_league_id AND candidate.league_season_id=NEW.league_season_id)
    OR EXISTS(SELECT 1 FROM public.public_data_dispatch_outcomes outcome WHERE outcome.worker_id=NEW.worker_id AND outcome.generation=NEW.generation) THEN
    RAISE EXCEPTION 'public period checkpoint dispatch or task mismatch'; END IF;
  PERFORM public.guard_public_data_intake(dispatch.work,settings_attempt.write_fence);
  PERFORM public.validate_current_roster_mapping(NEW.source_mapping);
  PERFORM public.assert_public_data_owner(NEW.intake_id,settings_attempt.write_fence);
  reserved:=GREATEST(settings_attempt.reserved_at,matchup_attempt.reserved_at);
  FOREACH is_settings IN ARRAY ARRAY[true,false] LOOP
    wanted:=CASE WHEN is_settings THEN settings.id ELSE matchups.id END;
    identity_value:=jsonb_build_object('scope',jsonb_build_object('kind','enrolled-resource',
      'connectionId',NEW.source_mapping->>'connectionId','leagueSeasonId',NEW.league_season_id::text,
      'family',CASE WHEN is_settings THEN 'league-season' ELSE 'matchups' END,'entityId',NULL,
      'scoringPeriodId',CASE WHEN is_settings THEN NULL ELSE 'sleeper:matchup-week:'||task.native_week END,'audienceId','public',
      'coverageSpecId',CASE WHEN is_settings THEN 'sleeper-league-identity-settings-v1' ELSE 'sleeper-exact-period-all-teams-matchups-v1' END),
      'policy',jsonb_build_object('audienceId','public','coverageSpecId',CASE WHEN is_settings THEN 'sleeper-league-identity-settings-v1' ELSE 'sleeper-exact-period-all-teams-matchups-v1' END,
      'canonicalNormalizerVersion',CASE WHEN is_settings THEN 'sleeper-league-settings-v1' ELSE 'sleeper-exact-matchups-v1' END,
      'validationVersion','latest-network-attempt-v1'));
    IF NOT EXISTS(SELECT 1 FROM public.league_roster_resource_acceptances accepted
      JOIN public.league_roster_capture_receipts receipt ON receipt.id=accepted.receipt_id
      JOIN public.league_roster_resource_attempts attempt ON attempt.id=receipt.attempt_id
      JOIN public.league_roster_resource_scopes scope ON scope.id=attempt.scope_id AND scope.identity=identity_value
      JOIN public.league_roster_resource_heads head ON head.scope_id=scope.id AND head.accepted_id=accepted.id AND head.generation=accepted.generation
      JOIN public.league_administration_contents content ON content.id=receipt.content_id
      JOIN public.league_administration_observations observed ON observed.id=receipt.legacy_observation_id AND observed.content_id=content.id
      WHERE receipt.id=wanted AND accepted.scope_id=scope.id AND accepted.source_mapping_revision_id=(NEW.source_mapping->>'revisionId')::uuid
        AND attempt.source_mapping=NEW.source_mapping AND attempt.write_fence=settings_attempt.write_fence
        AND attempt.ordinal=head.latest_ordinal AND attempt.reserved_at>=dispatch.admitted_at
        AND content.league_season_id=NEW.league_season_id AND content.provider='sleeper' AND content.external_league_id=task.external_league_id
        AND content.family=CASE WHEN is_settings THEN 'league' ELSE 'matchups' END
        AND content.week=CASE WHEN is_settings THEN 0 ELSE task.native_week END AND content.accepted AND content.completeness='complete'
        AND receipt.coverage->>'completeness'='complete' AND receipt.provenance->>'origin'='network'
        AND receipt.coverage->'periodIds'=CASE WHEN is_settings THEN '[]'::jsonb ELSE jsonb_build_array('sleeper:matchup-week:'||task.native_week) END
        AND CASE WHEN receipt.provenance->'acquisition' IS NULL THEN
          (receipt.provenance->>'requestStartedAt')::timestamptz>=reserved
          AND (receipt.provenance->>'requestStartedAt')::timestamptz>=clock_timestamp()-interval '30 seconds'
          AND (receipt.provenance->>'requestCompletedAt')::timestamptz BETWEEN (receipt.provenance->>'requestStartedAt')::timestamptz AND clock_timestamp()
        ELSE public.public_capture_after_reservation(receipt.provenance,attempt.id)
          AND receipt.recorded_at BETWEEN reserved AND clock_timestamp()
          AND (receipt.provenance->>'requestStartedAt')::timestamptz<=(receipt.provenance->>'requestCompletedAt')::timestamptz END
        AND (receipt.provenance->>'sourceObservedAt')::timestamptz=(receipt.provenance->>'requestCompletedAt')::timestamptz) THEN
      RAISE EXCEPTION 'current dispatch-bound exact period receipt required'; END IF;
  END LOOP;
  IF settings.configuration_content_id IS DISTINCT FROM settings.content_id
    OR matchups.configuration_content_id IS DISTINCT FROM settings.content_id
    OR matchups.population_evidence->>'observationId' IS DISTINCT FROM settings.legacy_observation_id::text
    OR matchups.population_evidence->'provenance' IS DISTINCT FROM settings.provenance
    OR matchups.population_evidence->>'contentHash' IS DISTINCT FROM (SELECT content_hash FROM public.league_administration_contents WHERE id=settings.content_id) THEN
    RAISE EXCEPTION 'exact period population does not bind its settings receipt'; END IF;
  PERFORM public.assert_public_data_owner(NEW.intake_id,settings_attempt.write_fence);
  RETURN NEW;
END; $$;

REVOKE ALL ON FUNCTION public.derive_public_data_capture_witness(jsonb,jsonb,jsonb),
  public.read_public_data_capture_witness(jsonb,jsonb,jsonb),
  public.assert_public_data_capture_witness(jsonb,jsonb,text,integer,jsonb),
  public.public_capture_after_reservation(jsonb,uuid),public.assert_public_capture_observation(jsonb,text),
  public.assert_public_capture_input_shape(jsonb) FROM PUBLIC;
DO $$ DECLARE helper text; BEGIN
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='league_one_runtime') THEN
    GRANT EXECUTE ON FUNCTION public.read_public_data_capture_witness(jsonb,jsonb,jsonb) TO league_one_runtime;
    FOREACH helper IN ARRAY ARRAY['public.derive_public_data_capture_witness(jsonb,jsonb,jsonb)',
      'public.assert_public_data_capture_witness(jsonb,jsonb,text,integer,jsonb)',
      'public.public_capture_after_reservation(jsonb,uuid)',
      'public.assert_public_capture_observation(jsonb,text)','public.assert_public_capture_input_shape(jsonb)'] LOOP
      EXECUTE format('REVOKE ALL ON FUNCTION %s FROM league_one_runtime',helper);
      IF has_function_privilege('league_one_runtime',helper,'EXECUTE') THEN
        RAISE EXCEPTION 'league_one_runtime can execute private capture helper'; END IF;
    END LOOP;
  END IF;
END; $$;
