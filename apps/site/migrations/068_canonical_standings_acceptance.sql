-- Canonical closure and the sole public dispatcher. No native hash recipe changes.
CREATE FUNCTION public.canonical_native_hash(p_input jsonb) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,public,pg_temp AS $$
  SELECT public.canonical_jsonb_hash(jsonb_build_object('hashVersion',p_input->>'hashVersion','representation','native',
    'nativeKind',p_input->'policy'->>'nativeKind','adapterVersion',p_input->>'adapterVersion','nativePayload',p_input->'nativePayload'));
$$;
CREATE FUNCTION public.canonical_value_hash(p_value jsonb) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,public,pg_temp AS $$
  SELECT public.canonical_jsonb_hash(jsonb_build_object('hashVersion','league-one-jsonb-sha256-v1','representation','canonical',
    'canonicalSchemaVersion','league-one-official-standings-v1','canonicalValue',p_value));
$$;
CREATE FUNCTION public.canonical_attempt_identity(p_attempt public.league_roster_resource_attempts) RETURNS jsonb
LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,public,pg_temp AS $$
  SELECT jsonb_build_object('id',p_attempt.id,'scopeId',p_attempt.scope_id,'ordinal',p_attempt.ordinal,
    'expectedGeneration',p_attempt.expected_generation,'nonce',p_attempt.capture_nonce);
$$;
CREATE FUNCTION public.canonical_receipt_delivery(p_receipt public.league_canonical_resource_receipts) RETURNS jsonb
LANGUAGE sql STABLE SET search_path=pg_catalog,public,pg_temp AS $$
  SELECT jsonb_build_object('contractVersion','league-one-canonical-delivery-v1',
    'canonicalSchemaVersion',content.canonical_schema_version,'hashVersion',content.hash_version,'adapterVersion',content.adapter_version,
    'nativeVerifierVersion',content.native_verifier_version,'canonicalNormalizerVersion',content.canonical_normalizer_version,
    'mapping',p_receipt.source_mapping,'scope',scope.identity->'scope','policy',scope.identity->'policy',
    'attempt',public.canonical_attempt_identity(attempt),'fence',attempt.write_fence,'provenance',p_receipt.provenance,
    'nativePayload',content.native_payload,'canonicalValue',content.canonical_value,'coverage',p_receipt.coverage,
    'nativeSourceRef',p_receipt.native_source_ref,'populationEvidence',p_receipt.population_evidence)
  FROM public.league_canonical_resource_contents content
  JOIN public.league_roster_resource_attempts attempt ON attempt.id=p_receipt.attempt_id
  JOIN public.league_roster_resource_scopes scope ON scope.id=attempt.scope_id WHERE content.id=p_receipt.content_id;
$$;
CREATE FUNCTION public.canonical_receipt_evidence_hash(p_receipt public.league_canonical_resource_receipts) RETURNS text
LANGUAGE sql STABLE SET search_path=pg_catalog,public,pg_temp AS $$
  SELECT public.canonical_jsonb_hash(jsonb_build_object('hashVersion','league-one-jsonb-sha256-v1','representation','receipt',
    'attempt',public.canonical_attempt_identity(attempt),'reservedAt',to_char(attempt.reserved_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    'fence',attempt.write_fence,'canonicalReservationContext',attempt.canonical_reservation_context,
    'mapping',p_receipt.source_mapping,'scope',scope.identity->'scope','policy',scope.identity->'policy',
    'content',jsonb_build_object('id',content.id,'nativeHash',content.native_hash,'canonicalHash',content.canonical_hash,
      'nativeKind',content.native_kind,'canonicalSchemaVersion',content.canonical_schema_version,'adapterVersion',content.adapter_version,
      'nativeVerifierVersion',content.native_verifier_version,'canonicalNormalizerVersion',content.canonical_normalizer_version,'hashVersion',content.hash_version),
    'provenance',p_receipt.provenance,'nativeSourceRef',p_receipt.native_source_ref,'legacyRosterReceiptId',p_receipt.legacy_roster_receipt_id,
    'legacyEvidenceHash',legacy.evidence_hash,'populationEvidence',p_receipt.population_evidence,'coverage',p_receipt.coverage,
    'expectedTeamCount',p_receipt.expected_team_count,'population',p_receipt.population,'recordCompleteness',p_receipt.record_completeness,
    'qualification',p_receipt.qualification,'outcome',p_receipt.outcome,'reasons',p_receipt.reasons))
  FROM public.league_roster_resource_attempts attempt JOIN public.league_roster_resource_scopes scope ON scope.id=attempt.scope_id
  JOIN public.league_canonical_resource_contents content ON content.id=p_receipt.content_id
  LEFT JOIN public.league_roster_capture_receipts legacy ON legacy.id=p_receipt.legacy_roster_receipt_id WHERE attempt.id=p_receipt.attempt_id;
$$;

CREATE FUNCTION public.assert_canonical_delivery_context(p_input jsonb,p_require_legacy_input boolean) RETURNS void
LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE attempt public.league_roster_resource_attempts%ROWTYPE; native_attempt public.league_roster_resource_attempts%ROWTYPE;
  policy jsonb; provenance jsonb:=p_input->'provenance'; field text; instant timestamptz; context_value jsonb;
  keys text[]:=ARRAY['contractVersion','canonicalSchemaVersion','hashVersion','adapterVersion','nativeVerifierVersion',
    'canonicalNormalizerVersion','mapping','scope','policy','attempt','fence','provenance','nativePayload','canonicalValue','coverage','nativeSourceRef','populationEvidence'];
BEGIN
  IF p_require_legacy_input AND p_input->'nativeSourceRef'->>'kind'='sleeper-roster-bridge-v1' THEN keys:=keys||ARRAY['legacyInput']; END IF;
  IF NOT public.canonical_exact_keys(p_input,keys) THEN RAISE EXCEPTION 'canonical delivery has mixed or unknown fields'; END IF;
  PERFORM public.assert_canonical_job_fence(p_input->'fence');
  PERFORM public.validate_canonical_resource_mapping(p_input->'mapping');
  policy:=public.canonical_resource_policy(p_input->'mapping',p_input);
  IF p_input->'policy' IS DISTINCT FROM policy OR p_input->'scope' IS DISTINCT FROM public.canonical_standings_scope(p_input->'mapping') THEN
    RAISE EXCEPTION 'canonical delivery scope or policy mismatch'; END IF;
  SELECT * INTO STRICT attempt FROM public.league_roster_resource_attempts WHERE id=(p_input->'attempt'->>'id')::uuid;
  IF p_input->'attempt' IS DISTINCT FROM public.canonical_attempt_identity(attempt)
    OR attempt.source_mapping IS DISTINCT FROM p_input->'mapping' OR attempt.write_fence IS DISTINCT FROM p_input->'fence'
    OR NOT EXISTS(SELECT 1 FROM public.league_roster_resource_scopes scope WHERE scope.id=attempt.scope_id
      AND scope.connection_id=(p_input->'mapping'->>'connectionId')::uuid AND scope.league_season_id=(p_input->'mapping'->>'leagueSeasonId')::uuid
      AND scope.identity=jsonb_build_object('scope',p_input->'scope','policy',policy)) THEN RAISE EXCEPTION 'canonical delivery attempt mismatch'; END IF;
  IF NOT public.canonical_exact_keys(provenance,ARRAY['captureId','origin','requestStartedAt','requestCompletedAt','sourceObservedAt',
    'checkedAt','normalizedAt','sourceUpdatedAt','nativeRevision','acquisition'])
    OR jsonb_typeof(provenance->'captureId') IS DISTINCT FROM 'string'
    OR (provenance->>'captureId')::uuid::text IS DISTINCT FROM provenance->>'captureId'
    OR jsonb_typeof(provenance->'checkedAt') IS DISTINCT FROM 'string' OR jsonb_typeof(provenance->'normalizedAt') IS DISTINCT FROM 'string'
    OR NOT(jsonb_typeof(provenance->'nativeRevision') IN ('null','string'))
    OR (provenance->'nativeRevision'<>'null'::jsonb AND (btrim(provenance->>'nativeRevision')='' OR (provenance->>'nativeRevision') ~ '[[:cntrl:]]')) THEN
    RAISE EXCEPTION 'invalid canonical capture shape'; END IF;
  FOREACH field IN ARRAY ARRAY['requestStartedAt','requestCompletedAt','sourceObservedAt','checkedAt','normalizedAt','sourceUpdatedAt'] LOOP
    IF provenance->field<>'null'::jsonb THEN
      IF jsonb_typeof(provenance->field)<>'string' OR (provenance->>field) !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.[0-9]{1,6})?Z$' THEN
        RAISE EXCEPTION 'canonical timestamp must be UTC'; END IF;
      instant:=(provenance->>field)::timestamptz;
      IF NOT isfinite(instant) THEN RAISE EXCEPTION 'nonfinite canonical timestamp'; END IF;
    END IF;
  END LOOP;
  IF (provenance->'requestStartedAt'='null'::jsonb) IS DISTINCT FROM (provenance->'requestCompletedAt'='null'::jsonb)
    OR (provenance->>'checkedAt')::timestamptz>(provenance->>'normalizedAt')::timestamptz
    OR (provenance->>'normalizedAt')::timestamptz>clock_timestamp()+interval '5 minutes'
    OR (provenance->>'sourceObservedAt')::timestamptz>(provenance->>'checkedAt')::timestamptz
    OR (provenance->>'sourceUpdatedAt')::timestamptz>(provenance->>'checkedAt')::timestamptz
    OR (provenance->>'requestStartedAt')::timestamptz>(provenance->>'requestCompletedAt')::timestamptz
    OR (provenance->>'requestCompletedAt')::timestamptz>(provenance->>'checkedAt')::timestamptz THEN
    RAISE EXCEPTION 'canonical capture chronology mismatch'; END IF;
  -- Original witness/nonce binding below proves reservation causality without
  -- introducing an application-clock versus database-clock ordering requirement.
  IF policy->>'originPolicy'='network-bridge-v1' THEN
    IF NOT public.canonical_exact_keys(p_input->'nativeSourceRef',ARRAY['kind','nativeAttemptId'])
      OR p_input->'nativeSourceRef'->>'kind' IS DISTINCT FROM 'sleeper-roster-bridge-v1'
      OR jsonb_typeof(p_input->'nativeSourceRef'->'nativeAttemptId') IS DISTINCT FROM 'string'
      OR (p_input->'nativeSourceRef'->>'nativeAttemptId')::uuid::text IS DISTINCT FROM p_input->'nativeSourceRef'->>'nativeAttemptId'
      OR provenance->>'origin' IS DISTINCT FROM 'network' OR provenance->'requestStartedAt'='null'::jsonb
      OR provenance->'requestCompletedAt'='null'::jsonb OR provenance->'sourceObservedAt'='null'::jsonb
      OR provenance->'sourceUpdatedAt'<>'null'::jsonb OR provenance->'nativeRevision'<>'null'::jsonb
      OR attempt.canonical_reservation_context IS NOT NULL THEN RAISE EXCEPTION 'invalid canonical native bridge'; END IF;
    SELECT * INTO STRICT native_attempt FROM public.league_roster_resource_attempts WHERE id=(p_input->'nativeSourceRef'->>'nativeAttemptId')::uuid;
    IF native_attempt.source_mapping IS DISTINCT FROM public.canonical_legacy_mapping(p_input->'mapping')
      OR native_attempt.write_fence IS DISTINCT FROM attempt.write_fence OR native_attempt.reserved_at<attempt.reserved_at
      OR NOT EXISTS(SELECT 1 FROM public.league_roster_resource_scopes scope WHERE scope.id=native_attempt.scope_id
        AND scope.identity->'policy'->>'coverageSpecId'='sleeper-current-all-teams-players-v1')
      OR provenance->'acquisition'->'attempts'->'players' IS DISTINCT FROM jsonb_build_object('id',native_attempt.id,'nonce',native_attempt.capture_nonce) THEN
      RAISE EXCEPTION 'canonical companion/native reservation mismatch'; END IF;
    PERFORM public.assert_public_data_capture_witness(provenance->'acquisition',attempt.write_fence,'rosters',NULL,native_attempt.source_mapping);
    IF p_require_legacy_input AND (jsonb_typeof(p_input->'legacyInput') IS DISTINCT FROM 'object'
      OR p_input->'legacyInput'->'sourceMapping' IS DISTINCT FROM native_attempt.source_mapping
      OR p_input->'legacyInput'->'writeFence' IS DISTINCT FROM attempt.write_fence
      OR p_input->'legacyInput'->'rosterAcceptance'->'attempt'->>'id' IS DISTINCT FROM native_attempt.id::text
      OR p_input->'legacyInput'->'envelope'->'payload' IS DISTINCT FROM p_input->'nativePayload'
      OR p_input->'legacyInput'->'envelope'->'provenance' IS DISTINCT FROM provenance-ARRAY['captureId','normalizedAt','sourceUpdatedAt','nativeRevision']
      OR NULLIF(p_input->'legacyInput'->'rosterAcceptance'->'population','null'::jsonb) IS DISTINCT FROM NULLIF(p_input->'populationEvidence','null'::jsonb)) THEN
      RAISE EXCEPTION 'canonical bridge legacy submission mismatch'; END IF;
  ELSIF policy->>'originPolicy'='fixture-v1' THEN
    context_value:=public.canonical_fixture_job_context(p_input->'mapping',policy,attempt.write_fence);
    IF attempt.canonical_reservation_context IS NULL OR attempt.canonical_reservation_context IS DISTINCT FROM context_value
      OR provenance->>'origin' IS DISTINCT FROM 'fixture' OR p_input ? 'legacyInput'
      OR NOT public.canonical_exact_keys(p_input->'nativeSourceRef',ARRAY['kind','fixtureId','fixtureRevision','sourceDigest'])
      OR p_input->'nativeSourceRef'->>'kind' IS DISTINCT FROM 'fixture-standalone-v1'
      OR jsonb_typeof(p_input->'nativeSourceRef'->'fixtureId') IS DISTINCT FROM 'string'
      OR jsonb_typeof(p_input->'nativeSourceRef'->'fixtureRevision') IS DISTINCT FROM 'string'
      OR btrim(p_input->'nativeSourceRef'->>'fixtureId')='' OR btrim(p_input->'nativeSourceRef'->>'fixtureRevision')=''
      OR (p_input->'nativeSourceRef'->>'fixtureId') ~ '[[:cntrl:]]' OR (p_input->'nativeSourceRef'->>'fixtureRevision') ~ '[[:cntrl:]]'
      OR jsonb_typeof(p_input->'nativeSourceRef'->'sourceDigest') IS DISTINCT FROM 'string'
      OR p_input->'nativeSourceRef'->>'sourceDigest' IS DISTINCT FROM context_value->>'standingsDigest'
      OR public.canonical_native_hash(p_input) IS DISTINCT FROM context_value->>'standingsDigest'
      OR provenance->'acquisition' IS DISTINCT FROM jsonb_build_object('version','canonical-fixture-capture-v1',
        'jobKey',attempt.write_fence->>'jobKey','generation',attempt.write_fence->'generation','attemptId',attempt.id,
        'nonce',attempt.capture_nonce,'sourceDigest',context_value->>'standingsDigest') THEN
      RAISE EXCEPTION 'canonical fixture immutable acquisition mismatch'; END IF;
  ELSE RAISE EXCEPTION 'unregistered canonical capture origin'; END IF;
  PERFORM public.assert_canonical_job_fence(attempt.write_fence);
END; $$;

CREATE FUNCTION public.canonical_standings_typed_value(p_content_id uuid) RETURNS jsonb
LANGUAGE sql STABLE SET search_path=pg_catalog,public,pg_temp AS $$
  SELECT jsonb_build_object('schemaVersion',content.canonical_schema_version,'status',content.canonical_value->>'status',
    'reasons',content.canonical_value->'reasons','teams',COALESCE((SELECT jsonb_agg(jsonb_build_object(
      'sourceTeam',jsonb_build_object('provider',team.provider,'resourceKind','team','nativeNamespace',team.native_namespace,'nativeId',team.external_team_id),
      'sourceOrdinal',team.source_ordinal,'record',jsonb_build_object(
        'wins',jsonb_build_object('state',team.field_states->>'wins','value',team.wins),
        'losses',jsonb_build_object('state',team.field_states->>'losses','value',team.losses),
        'ties',jsonb_build_object('state',team.field_states->>'ties','value',team.ties)),
      'pointsFor',jsonb_build_object('state',team.field_states->>'pointsFor','value',team.points_for_value),
      'pointsAgainst',jsonb_build_object('state',team.field_states->>'pointsAgainst','value',team.points_against_value),
      'providerRank',jsonb_build_object('state',team.field_states->>'providerRank','value',team.rank),
      'providerSeed',jsonb_build_object('state',team.field_states->>'providerSeed','value',team.seed)) ORDER BY team.source_ordinal)
      FROM public.league_canonical_standings_teams team WHERE team.content_id=content.id),'[]'::jsonb))
  FROM public.league_canonical_resource_contents content WHERE content.id=p_content_id;
$$;
CREATE FUNCTION public.materialize_canonical_standings(p_content_id uuid,p_facts jsonb) RETURNS void
LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE content public.league_canonical_resource_contents%ROWTYPE; team jsonb; team_id uuid;
BEGIN
  SELECT * INTO STRICT content FROM public.league_canonical_resource_contents WHERE id=p_content_id;
  IF content.capture_transaction<>pg_current_xact_id() OR content.canonical_value IS DISTINCT FROM p_facts THEN
    RAISE EXCEPTION 'canonical materialization requires original content transaction'; END IF;
  FOR team IN SELECT value FROM jsonb_array_elements(p_facts->'teams') LOOP
    SELECT id INTO STRICT team_id FROM public.league_season_teams WHERE league_season_id=content.league_season_id
      AND provider=content.provider AND source_league_namespace=content.source_league_namespace AND external_league_id=content.external_league_id
      AND native_namespace=team->'sourceTeam'->>'nativeNamespace' AND external_roster_id=team->'sourceTeam'->>'nativeId';
    INSERT INTO public.league_canonical_standings_teams(content_id,league_season_id,season_team_id,provider,source_league_namespace,
      external_league_id,native_namespace,external_team_id,source_ordinal,field_states,wins,losses,ties,rank,seed,points_for_value,points_against_value)
    VALUES(content.id,content.league_season_id,team_id,content.provider,content.source_league_namespace,content.external_league_id,
      team->'sourceTeam'->>'nativeNamespace',team->'sourceTeam'->>'nativeId',(team->>'sourceOrdinal')::integer,
      jsonb_build_object('wins',team->'record'->'wins'->>'state','losses',team->'record'->'losses'->>'state','ties',team->'record'->'ties'->>'state',
        'pointsFor',team->'pointsFor'->>'state','pointsAgainst',team->'pointsAgainst'->>'state',
        'providerRank',team->'providerRank'->>'state','providerSeed',team->'providerSeed'->>'state'),
      (team->'record'->'wins'->>'value')::bigint,(team->'record'->'losses'->>'value')::bigint,(team->'record'->'ties'->>'value')::bigint,
      (team->'providerRank'->>'value')::bigint,(team->'providerSeed'->>'value')::bigint,team->'pointsFor'->>'value',team->'pointsAgainst'->>'value');
  END LOOP;
  IF public.canonical_standings_typed_value(content.id) IS DISTINCT FROM p_facts THEN RAISE EXCEPTION 'canonical typed materialization mismatch'; END IF;
END; $$;

CREATE FUNCTION public.guard_canonical_resource_insert() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE content public.league_canonical_resource_contents%ROWTYPE; mapping jsonb; policy jsonb; receipt public.league_canonical_resource_receipts%ROWTYPE;
BEGIN
  IF TG_TABLE_NAME='league_canonical_resource_contents' THEN
    IF NEW.capture_transaction<>pg_current_xact_id() OR NEW.created_at>clock_timestamp() THEN RAISE EXCEPTION 'canonical content transaction mismatch'; END IF;
    SELECT attempt.source_mapping,scope.identity->'policy' INTO STRICT mapping,policy
      FROM public.league_roster_resource_attempts attempt JOIN public.league_roster_resource_scopes scope ON scope.id=attempt.scope_id
      WHERE scope.connection_id=NEW.connection_id AND scope.league_season_id=NEW.league_season_id
        AND scope.identity->'policy'->>'canonicalNormalizerVersion'=NEW.canonical_normalizer_version
        AND attempt.source_mapping->'scope'->>'provider'=NEW.provider AND attempt.source_mapping->'scope'->>'nativeNamespace'=NEW.source_league_namespace
        AND attempt.source_mapping->'scope'->>'externalLeagueId'=NEW.external_league_id
        AND attempt.source_mapping->>'sourceNamespace'=NEW.source_namespace ORDER BY attempt.reserved_at DESC LIMIT 1;
    PERFORM public.validate_canonical_resource_mapping(mapping);
    PERFORM public.validate_canonical_standings_value(NEW.canonical_value,NEW.provider,policy->>'teamNamespace');
    IF NEW.native_hash IS DISTINCT FROM public.canonical_native_hash(jsonb_build_object('hashVersion',NEW.hash_version,
      'adapterVersion',NEW.adapter_version,'nativePayload',NEW.native_payload,'policy',jsonb_build_object('nativeKind',NEW.native_kind)))
      OR NEW.canonical_hash IS DISTINCT FROM public.canonical_value_hash(NEW.canonical_value) THEN RAISE EXCEPTION 'canonical content hash mismatch'; END IF;
  ELSIF TG_TABLE_NAME='league_canonical_standings_teams' THEN
    SELECT * INTO STRICT content FROM public.league_canonical_resource_contents WHERE id=NEW.content_id;
    IF content.capture_transaction<>pg_current_xact_id() OR content.canonical_value->>'status'<>'qualified'
      OR NOT public.canonical_exact_keys(NEW.field_states,ARRAY['wins','losses','ties','pointsFor','pointsAgainst','providerRank','providerSeed']) THEN
      RAISE EXCEPTION 'canonical typed child transaction or state mismatch'; END IF;
    -- Exact child equality and every state/value bound are checked again at deferred closure.
    IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(content.canonical_value->'teams') team
      WHERE (team->>'sourceOrdinal')::integer=NEW.source_ordinal AND team->'sourceTeam'=jsonb_build_object(
        'provider',NEW.provider,'resourceKind','team','nativeNamespace',NEW.native_namespace,'nativeId',NEW.external_team_id)) THEN
      RAISE EXCEPTION 'canonical typed child source mismatch'; END IF;
  ELSE
    IF NEW.capture_transaction<>pg_current_xact_id() OR NEW.recorded_at>clock_timestamp()
      OR NOT public.canonical_standings_reasons_valid(NEW.reasons,true) THEN RAISE EXCEPTION 'canonical receipt transaction or reasons mismatch'; END IF;
    SELECT * INTO STRICT content FROM public.league_canonical_resource_contents WHERE id=NEW.content_id;
    IF NEW.evidence_hash IS DISTINCT FROM public.canonical_receipt_evidence_hash(NEW) THEN RAISE EXCEPTION 'canonical receipt hash mismatch'; END IF;
  END IF;
  RETURN NEW;
END; $$;

CREATE FUNCTION public.validate_canonical_standings_complete() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE content public.league_canonical_resource_contents%ROWTYPE; receipt public.league_canonical_resource_receipts%ROWTYPE;
BEGIN
  SELECT * INTO STRICT content FROM public.league_canonical_resource_contents
    WHERE id=COALESCE((to_jsonb(NEW)->>'id')::uuid,(to_jsonb(NEW)->>'content_id')::uuid);
  SELECT * INTO STRICT receipt FROM public.league_canonical_resource_receipts WHERE id=content.first_receipt_id;
  IF content.capture_transaction<>pg_current_xact_id() OR receipt.capture_transaction<>content.capture_transaction
    OR receipt.content_id<>content.id OR receipt.connection_id<>content.connection_id OR receipt.league_season_id<>content.league_season_id
    OR public.canonical_standings_typed_value(content.id) IS DISTINCT FROM content.canonical_value THEN
    RAISE EXCEPTION 'canonical first receipt or full typed closure mismatch'; END IF;
  PERFORM public.assert_canonical_delivery_context(public.canonical_receipt_delivery(receipt),false);
  RETURN NEW;
END; $$;

CREATE FUNCTION public.validate_canonical_resource_receipt() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE receipt public.league_canonical_resource_receipts%ROWTYPE; content public.league_canonical_resource_contents%ROWTYPE;
  attempt public.league_roster_resource_attempts%ROWTYPE; input jsonb; verified jsonb; reasons jsonb; native_xid bigint;
BEGIN
  IF TG_TABLE_NAME='league_roster_resource_acceptances' THEN
    SELECT * INTO STRICT receipt FROM public.league_canonical_resource_receipts WHERE id=NEW.canonical_receipt_id;
  ELSE receipt:=NEW; END IF;
  SELECT * INTO STRICT content FROM public.league_canonical_resource_contents WHERE id=receipt.content_id;
  SELECT * INTO STRICT attempt FROM public.league_roster_resource_attempts WHERE id=receipt.attempt_id;
  input:=public.canonical_receipt_delivery(receipt);
  PERFORM public.assert_canonical_delivery_context(input,false);
  verified:=public.verify_registered_canonical_delivery(receipt.source_mapping,input);
  reasons:=verified->'reasons';
  IF receipt.outcome='preserved-stale' THEN reasons:=reasons||'["source-time-stale"]'::jsonb;
  ELSIF receipt.outcome='preserved-conflict' THEN reasons:=reasons||'["source-time-conflict"]'::jsonb;
  ELSIF receipt.outcome='preserved-generation' THEN reasons:=reasons||'["generation-or-ordinal-preserved"]'::jsonb; END IF;
  SELECT COALESCE(jsonb_agg(value ORDER BY value COLLATE "C"),'[]'::jsonb) INTO reasons FROM (SELECT DISTINCT value FROM jsonb_array_elements_text(reasons)) codes;
  IF receipt.source_mapping IS DISTINCT FROM attempt.source_mapping
    OR content.connection_id IS DISTINCT FROM (attempt.source_mapping->>'connectionId')::uuid
    OR content.league_season_id IS DISTINCT FROM (attempt.source_mapping->>'leagueSeasonId')::uuid
    OR content.provider IS DISTINCT FROM attempt.source_mapping->'scope'->>'provider'
    OR content.source_league_namespace IS DISTINCT FROM attempt.source_mapping->'scope'->>'nativeNamespace'
    OR content.external_league_id IS DISTINCT FROM attempt.source_mapping->'scope'->>'externalLeagueId'
    OR content.source_namespace IS DISTINCT FROM attempt.source_mapping->>'sourceNamespace'
    OR content.native_kind IS DISTINCT FROM input->'policy'->>'nativeKind'
    OR content.native_hash IS DISTINCT FROM public.canonical_native_hash(input)
    OR content.canonical_hash IS DISTINCT FROM public.canonical_value_hash(content.canonical_value)
    OR receipt.evidence_hash IS DISTINCT FROM public.canonical_receipt_evidence_hash(receipt)
    OR receipt.coverage IS DISTINCT FROM verified->'coverage'
    OR receipt.expected_team_count IS DISTINCT FROM (verified->>'expectedTeamCount')::integer
    OR receipt.population IS DISTINCT FROM verified->>'population' OR receipt.record_completeness IS DISTINCT FROM verified->>'recordCompleteness'
    OR receipt.qualification IS DISTINCT FROM verified->>'qualification' OR receipt.reasons IS DISTINCT FROM reasons
    OR receipt.native_source_ref IS DISTINCT FROM verified->'nativeSourceRef'
    OR receipt.legacy_roster_receipt_id IS DISTINCT FROM (verified->>'legacyRosterReceiptId')::uuid
    OR public.canonical_standings_typed_value(content.id) IS DISTINCT FROM content.canonical_value THEN
    RAISE EXCEPTION 'canonical retained verifier or typed closure mismatch'; END IF;
  IF receipt.legacy_roster_receipt_id IS NOT NULL THEN
    SELECT xmin::text::bigint INTO STRICT native_xid FROM public.league_roster_capture_receipts WHERE id=receipt.legacy_roster_receipt_id;
    IF native_xid<>mod(receipt.capture_transaction::text::numeric,4294967296)::bigint THEN
      RAISE EXCEPTION 'new canonical bridge requires same-transaction native receipt'; END IF;
  END IF;
  IF (receipt.qualification='qualified') IS DISTINCT FROM (receipt.outcome IN ('accepted','preserved-stale','preserved-conflict','preserved-generation'))
    OR (receipt.qualification<>'qualified' AND receipt.outcome<>receipt.qualification) THEN RAISE EXCEPTION 'canonical qualification/outcome mismatch'; END IF;
  IF receipt.outcome='accepted' THEN
    IF NOT EXISTS(SELECT 1 FROM public.league_roster_resource_acceptances accepted
      WHERE accepted.canonical_receipt_id=receipt.id AND accepted.receipt_id IS NULL AND accepted.scope_id=receipt.scope_id
        AND accepted.source_mapping_revision_id=(attempt.source_mapping->>'revisionId')::uuid
        AND accepted.generation=attempt.expected_generation+1) THEN RAISE EXCEPTION 'canonical accepted receipt has no acceptance'; END IF;
  ELSIF EXISTS(SELECT 1 FROM public.league_roster_resource_acceptances accepted WHERE accepted.canonical_receipt_id=receipt.id) THEN
    RAISE EXCEPTION 'canonical preserved receipt cannot be accepted';
  END IF;
  PERFORM public.assert_canonical_job_fence(attempt.write_fence);
  RETURN NEW;
END; $$;

CREATE TRIGGER canonical_content_insert_guard BEFORE INSERT ON public.league_canonical_resource_contents
  FOR EACH ROW EXECUTE FUNCTION public.guard_canonical_resource_insert();
CREATE TRIGGER canonical_receipt_insert_guard BEFORE INSERT ON public.league_canonical_resource_receipts
  FOR EACH ROW EXECUTE FUNCTION public.guard_canonical_resource_insert();
CREATE TRIGGER canonical_standings_team_insert_guard BEFORE INSERT ON public.league_canonical_standings_teams
  FOR EACH ROW EXECUTE FUNCTION public.guard_canonical_resource_insert();
CREATE TRIGGER canonical_content_immutable BEFORE UPDATE OR DELETE ON public.league_canonical_resource_contents
  FOR EACH ROW EXECUTE FUNCTION public.prevent_league_administration_history_change();
CREATE TRIGGER canonical_receipt_immutable BEFORE UPDATE OR DELETE ON public.league_canonical_resource_receipts
  FOR EACH ROW EXECUTE FUNCTION public.prevent_league_administration_history_change();
CREATE TRIGGER canonical_standings_team_immutable BEFORE UPDATE OR DELETE ON public.league_canonical_standings_teams
  FOR EACH ROW EXECUTE FUNCTION public.prevent_league_administration_history_change();
CREATE CONSTRAINT TRIGGER canonical_content_complete AFTER INSERT ON public.league_canonical_resource_contents
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.validate_canonical_standings_complete();
CREATE CONSTRAINT TRIGGER canonical_standings_team_complete AFTER INSERT ON public.league_canonical_standings_teams
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.validate_canonical_standings_complete();
CREATE CONSTRAINT TRIGGER canonical_receipt_lineage AFTER INSERT ON public.league_canonical_resource_receipts
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.validate_canonical_resource_receipt();
CREATE CONSTRAINT TRIGGER canonical_acceptance_lineage AFTER INSERT ON public.league_roster_resource_acceptances
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW WHEN(NEW.canonical_receipt_id IS NOT NULL) EXECUTE FUNCTION public.validate_canonical_resource_receipt();

CREATE FUNCTION public.canonical_resource_write_result(p_receipt public.league_canonical_resource_receipts,p_replayed boolean) RETURNS jsonb
LANGUAGE sql STABLE SET search_path=pg_catalog,public,pg_temp AS $$
  SELECT jsonb_build_object('status',CASE WHEN p_replayed THEN 'replayed' ELSE 'recorded' END,'receiptId',p_receipt.id,
    'contentId',p_receipt.content_id,'attemptId',p_receipt.attempt_id,'acceptanceId',accepted.id,
    'acceptedGeneration',accepted.generation,'outcome',p_receipt.outcome)
  FROM (SELECT 1) singleton LEFT JOIN public.league_roster_resource_acceptances accepted ON accepted.canonical_receipt_id=p_receipt.id;
$$;
CREATE FUNCTION public.accept_canonical_resource(p_input jsonb,p_verified jsonb) RETURNS jsonb
LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE attempt public.league_roster_resource_attempts%ROWTYPE; head public.league_roster_resource_heads%ROWTYPE;
  content public.league_canonical_resource_contents%ROWTYPE; receipt public.league_canonical_resource_receipts%ROWTYPE;
  prior public.league_canonical_resource_receipts%ROWTYPE; prior_content public.league_canonical_resource_contents%ROWTYPE;
  native_hash_value text; canonical_hash_value text; new_receipt_id uuid:=gen_random_uuid(); outcome_value text; reasons_value jsonb;
  source_teams jsonb; acceptance_id uuid; context_value jsonb; incoming_time timestamptz; prior_time timestamptz;
BEGIN
  -- Re-derive; p_verified is an internal optimization result, never a capability.
  PERFORM public.assert_canonical_delivery_context(p_input,p_input ? 'legacyInput');
  IF p_verified IS DISTINCT FROM public.verify_registered_canonical_delivery(p_input->'mapping',p_input) THEN
    RAISE EXCEPTION 'canonical verifier result changed'; END IF;
  SELECT * INTO STRICT attempt FROM public.league_roster_resource_attempts WHERE id=(p_input->'attempt'->>'id')::uuid;
  SELECT * INTO STRICT head FROM public.league_roster_resource_heads WHERE scope_id=attempt.scope_id FOR UPDATE;
  PERFORM public.assert_canonical_job_fence(attempt.write_fence);
  IF attempt.canonical_reservation_context IS NOT NULL AND attempt.canonical_reservation_context IS DISTINCT FROM
    public.canonical_fixture_job_context(attempt.source_mapping,p_input->'policy',attempt.write_fence) THEN RAISE EXCEPTION 'fixture job changed after head lock'; END IF;
  native_hash_value:=public.canonical_native_hash(p_input); canonical_hash_value:=public.canonical_value_hash(p_verified->'canonicalValue');
  SELECT * INTO receipt FROM public.league_canonical_resource_receipts WHERE attempt_id=attempt.id;
  IF FOUND THEN
    IF public.canonical_receipt_delivery(receipt) IS DISTINCT FROM p_input-'legacyInput'
      OR receipt.evidence_hash IS DISTINCT FROM public.canonical_receipt_evidence_hash(receipt)
      OR receipt.legacy_roster_receipt_id IS DISTINCT FROM (p_verified->>'legacyRosterReceiptId')::uuid THEN
      RAISE EXCEPTION 'canonical exact replay mismatch'; END IF;
    RETURN public.canonical_resource_write_result(receipt,true);
  END IF;
  outcome_value:=p_verified->>'qualification';reasons_value:=p_verified->'reasons';
  IF outcome_value='qualified' THEN
    outcome_value:='accepted';
    IF attempt.ordinal<>head.latest_ordinal OR attempt.expected_generation<>head.generation THEN
      outcome_value:='preserved-generation';reasons_value:=reasons_value||'["generation-or-ordinal-preserved"]'::jsonb;
    ELSE
      SELECT selected.* INTO prior FROM public.league_canonical_resource_receipts selected
        JOIN public.league_roster_resource_acceptances accepted ON accepted.canonical_receipt_id=selected.id WHERE accepted.id=head.accepted_id;
      IF FOUND THEN
        SELECT * INTO STRICT prior_content FROM public.league_canonical_resource_contents WHERE id=prior.content_id;
        incoming_time:=(p_input->'provenance'->>'sourceUpdatedAt')::timestamptz;prior_time:=(prior.provenance->>'sourceUpdatedAt')::timestamptz;
        IF incoming_time IS NOT NULL AND prior_time IS NOT NULL AND incoming_time<prior_time THEN
          outcome_value:='preserved-stale';reasons_value:=reasons_value||'["source-time-stale"]'::jsonb;
        ELSIF incoming_time IS NOT NULL AND incoming_time=prior_time AND prior_content.canonical_value IS DISTINCT FROM p_verified->'canonicalValue' THEN
          outcome_value:='preserved-conflict';reasons_value:=reasons_value||'["source-time-conflict"]'::jsonb;
        END IF;
      END IF;
    END IF;
  END IF;
  SELECT COALESCE(jsonb_agg(value ORDER BY value COLLATE "C"),'[]'::jsonb) INTO reasons_value FROM (SELECT DISTINCT value FROM jsonb_array_elements_text(reasons_value)) codes;
  SELECT * INTO content FROM public.league_canonical_resource_contents candidate
    WHERE candidate.connection_id=(p_input->'mapping'->>'connectionId')::uuid AND candidate.league_season_id=(p_input->'mapping'->>'leagueSeasonId')::uuid
      AND candidate.provider=p_input->'mapping'->'scope'->>'provider' AND candidate.source_league_namespace=p_input->'mapping'->'scope'->>'nativeNamespace'
      AND candidate.external_league_id=p_input->'mapping'->'scope'->>'externalLeagueId' AND candidate.source_namespace=p_input->'mapping'->>'sourceNamespace'
      AND candidate.family='standings' AND candidate.native_kind=p_input->'policy'->>'nativeKind'
      AND candidate.canonical_schema_version=p_input->>'canonicalSchemaVersion' AND candidate.adapter_version=p_input->>'adapterVersion'
      AND candidate.native_verifier_version=p_input->>'nativeVerifierVersion' AND candidate.canonical_normalizer_version=p_input->>'canonicalNormalizerVersion'
      AND candidate.hash_version=p_input->>'hashVersion' AND candidate.native_hash=native_hash_value AND candidate.canonical_hash=canonical_hash_value;
  IF FOUND THEN
    IF content.native_payload IS DISTINCT FROM p_input->'nativePayload' OR content.canonical_value IS DISTINCT FROM p_verified->'canonicalValue'
      OR public.canonical_standings_typed_value(content.id) IS DISTINCT FROM content.canonical_value THEN RAISE EXCEPTION 'canonical content hash collision or typed conflict'; END IF;
  ELSE
    INSERT INTO public.league_canonical_resource_contents(connection_id,league_season_id,provider,source_league_namespace,external_league_id,
      source_namespace,family,native_kind,canonical_schema_version,adapter_version,native_verifier_version,canonical_normalizer_version,
      hash_version,native_payload,canonical_value,native_hash,canonical_hash,first_receipt_id)
    VALUES((p_input->'mapping'->>'connectionId')::uuid,(p_input->'mapping'->>'leagueSeasonId')::uuid,p_input->'mapping'->'scope'->>'provider',
      p_input->'mapping'->'scope'->>'nativeNamespace',p_input->'mapping'->'scope'->>'externalLeagueId',p_input->'mapping'->>'sourceNamespace',
      'standings',p_input->'policy'->>'nativeKind',p_input->>'canonicalSchemaVersion',p_input->>'adapterVersion',p_input->>'nativeVerifierVersion',
      p_input->>'canonicalNormalizerVersion',p_input->>'hashVersion',p_input->'nativePayload',p_verified->'canonicalValue',native_hash_value,canonical_hash_value,new_receipt_id)
      RETURNING * INTO content;
    SELECT COALESCE(jsonb_agg(team->'sourceTeam' ORDER BY ordinal),'[]'::jsonb) INTO source_teams
      FROM jsonb_array_elements(content.canonical_value->'teams') WITH ORDINALITY AS entry(team,ordinal);
    context_value:=jsonb_build_object('attemptId',attempt.id,'captureId',p_input->'provenance'->>'captureId','captureNonce',attempt.capture_nonce,
      'scopeId',attempt.scope_id,'policy',p_input->'policy','nativeHash',native_hash_value,'canonicalHash',canonical_hash_value,'canonicalValue',content.canonical_value);
    PERFORM public.resolve_canonical_season_teams(attempt.source_mapping,jsonb_build_object('provider',content.provider,'resourceKind','league',
      'nativeNamespace',content.source_league_namespace,'nativeId',content.external_league_id),source_teams,context_value);
    PERFORM public.materialize_canonical_standings(content.id,content.canonical_value);
  END IF;
  receipt.id:=new_receipt_id;receipt.attempt_id:=attempt.id;receipt.scope_id:=attempt.scope_id;
  receipt.connection_id:=content.connection_id;receipt.league_season_id:=content.league_season_id;receipt.content_id:=content.id;
  receipt.source_mapping:=attempt.source_mapping;receipt.provenance:=p_input->'provenance';receipt.native_source_ref:=p_verified->'nativeSourceRef';
  receipt.legacy_roster_receipt_id:=(p_verified->>'legacyRosterReceiptId')::uuid;receipt.population_evidence:=NULLIF(p_input->'populationEvidence','null'::jsonb);
  receipt.coverage:=p_verified->'coverage';receipt.expected_team_count:=(p_verified->>'expectedTeamCount')::integer;
  receipt.population:=p_verified->>'population';receipt.record_completeness:=p_verified->>'recordCompleteness';receipt.qualification:=p_verified->>'qualification';
  receipt.outcome:=outcome_value;receipt.reasons:=reasons_value;receipt.evidence_version:='league-one-jsonb-sha256-v1';
  receipt.evidence_hash:=public.canonical_receipt_evidence_hash(receipt);receipt.recorded_at:=clock_timestamp();receipt.capture_transaction:=pg_current_xact_id();
  INSERT INTO public.league_canonical_resource_receipts SELECT receipt.*;
  IF outcome_value='accepted' THEN
    PERFORM public.assert_canonical_job_fence(attempt.write_fence);
    INSERT INTO public.league_roster_resource_acceptances(scope_id,canonical_receipt_id,source_mapping_revision_id,generation)
      VALUES(attempt.scope_id,receipt.id,(attempt.source_mapping->>'revisionId')::uuid,head.generation+1) RETURNING id INTO acceptance_id;
    UPDATE public.league_roster_resource_heads SET accepted_id=acceptance_id,generation=generation+1 WHERE scope_id=attempt.scope_id;
  END IF;
  PERFORM public.assert_canonical_job_fence(attempt.write_fence);
  RETURN public.canonical_resource_write_result(receipt,false);
END; $$;

ALTER FUNCTION public.record_league_administration_observation(jsonb) RENAME TO record_league_administration_observation_legacy_v65;
REVOKE ALL ON FUNCTION public.record_league_administration_observation_legacy_v65(jsonb) FROM PUBLIC;
DO $$ DECLARE role_name text; BEGIN
  FOREACH role_name IN ARRAY ARRAY['league_one_runtime','league_one_account','league_one_auth'] LOOP
    IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=role_name) THEN
      EXECUTE format('REVOKE ALL ON FUNCTION public.record_league_administration_observation_legacy_v65(jsonb) FROM %I',role_name);
    END IF;
  END LOOP;
END; $$;
CREATE FUNCTION public.record_league_administration_observation(p_input jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE legacy_result jsonb; verified jsonb; result jsonb; prior public.league_canonical_resource_receipts%ROWTYPE;
  native_before uuid; native_after uuid;
BEGIN
  IF jsonb_typeof(p_input) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'observation object required'; END IF;
  IF NOT p_input ? 'contractVersion' THEN
    IF p_input ?| ARRAY['canonicalSchemaVersion','hashVersion','adapterVersion','nativeVerifierVersion','canonicalNormalizerVersion',
      'mapping','scope','policy','attempt','fence','provenance','nativePayload','canonicalValue','coverage','nativeSourceRef','populationEvidence','legacyInput','verified'] THEN
      RAISE EXCEPTION 'mixed canonical/legacy observation'; END IF;
    RETURN public.record_league_administration_observation_legacy_v65(p_input);
  END IF;
  IF p_input->>'contractVersion' IS DISTINCT FROM 'league-one-canonical-delivery-v1' THEN RAISE EXCEPTION 'unknown canonical delivery version'; END IF;
  PERFORM public.assert_canonical_delivery_context(p_input,true);
  SELECT * INTO prior FROM public.league_canonical_resource_receipts WHERE attempt_id=(p_input->'attempt'->>'id')::uuid;
  IF p_input->'nativeSourceRef'->>'kind'='sleeper-roster-bridge-v1' THEN
    SELECT id INTO native_before FROM public.league_roster_capture_receipts WHERE attempt_id=(p_input->'nativeSourceRef'->>'nativeAttemptId')::uuid;
    IF prior.id IS NULL AND native_before IS NOT NULL THEN RAISE EXCEPTION 'old native receipt cannot become new canonical capture'; END IF;
    IF prior.id IS NOT NULL AND prior.legacy_roster_receipt_id IS DISTINCT FROM native_before THEN RAISE EXCEPTION 'canonical replay native pair mismatch'; END IF;
    legacy_result:=public.record_league_administration_observation_legacy_v65(p_input->'legacyInput');
    SELECT id INTO STRICT native_after FROM public.league_roster_capture_receipts WHERE attempt_id=(p_input->'nativeSourceRef'->>'nativeAttemptId')::uuid;
    IF legacy_result->'rosterAcceptance'->>'receiptId' IS DISTINCT FROM native_after::text THEN RAISE EXCEPTION 'canonical bridge actual native result mismatch'; END IF;
  END IF;
  verified:=public.verify_registered_canonical_delivery(p_input->'mapping',p_input);
  result:=public.accept_canonical_resource(p_input,verified);
  IF legacy_result IS NOT NULL THEN result:=result||jsonb_build_object('legacyResult',legacy_result); END IF;
  RETURN result;
END; $$;

-- New definitions never inherit callable PUBLIC defaults between ordered migrations.
DO $$ DECLARE signature text; role_name text; BEGIN
  FOREACH signature IN ARRAY ARRAY[
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
    'public.record_league_administration_observation(jsonb)'] LOOP
    IF to_regprocedure(signature) IS NULL THEN RAISE EXCEPTION 'missing canonical function: %',signature; END IF;
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC',signature);
    FOREACH role_name IN ARRAY ARRAY['league_one_runtime','league_one_account','league_one_auth'] LOOP
      IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=role_name) THEN
        EXECUTE format('REVOKE ALL ON FUNCTION %s FROM %I',signature,role_name);
      END IF;
    END LOOP;
  END LOOP;
END; $$;
