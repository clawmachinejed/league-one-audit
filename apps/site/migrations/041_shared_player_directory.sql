-- CP5 shared native directory. No league mapping, roster links, scheduler or activation.
CREATE TABLE public.league_player_directory_heads (
  provider text NOT NULL DEFAULT 'sleeper' CHECK(provider='sleeper'),
  sport text NOT NULL DEFAULT 'nfl' CHECK(sport='nfl'),
  namespace text NOT NULL DEFAULT 'nfl:players' CHECK(namespace='nfl:players'),
  latest_ordinal bigint NOT NULL DEFAULT 0 CHECK(latest_ordinal>=0),
  generation bigint NOT NULL DEFAULT 0 CHECK(generation>=0),
  accepted_version_id uuid,
  last_network_at timestamptz,
  next_network_at timestamptz,
  PRIMARY KEY(provider,sport),
  CHECK((last_network_at IS NULL)=(next_network_at IS NULL)),
  CHECK(next_network_at IS NULL OR next_network_at>=last_network_at)
);
CREATE TABLE public.league_player_directory_attempts (
  id uuid PRIMARY KEY,
  nonce uuid NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  ordinal bigint NOT NULL UNIQUE CHECK(ordinal>0),
  expected_generation bigint NOT NULL CHECK(expected_generation>=0),
  write_fence jsonb NOT NULL,
  reserved_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE public.league_player_directory_contents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  normalizer_version text NOT NULL CHECK(normalizer_version='sleeper-player-directory-v1'),
  content_hash text NOT NULL UNIQUE CHECK(content_hash ~ '^[0-9a-f]{64}$'),
  source_revision text,
  raw_json text,
  row_count integer NOT NULL CHECK(row_count BETWEEN 0 AND 100000),
  duplicate_member_count integer NOT NULL CHECK(duplicate_member_count>=0),
  CHECK(raw_json IS NULL OR octet_length(raw_json)<=16777216),
  CHECK((raw_json IS NULL)=(source_revision IS NULL)),
  CHECK(source_revision IS NULL OR source_revision ~ '^sha256:[0-9a-f]{64}$')
);
CREATE TABLE public.league_player_directory_entries (
  content_id uuid NOT NULL REFERENCES public.league_player_directory_contents(id),
  external_player_id text COLLATE "C" NOT NULL,
  external_player_id_hash text GENERATED ALWAYS AS (encode(digest(external_player_id,'sha256'),'hex')) STORED,
  provider_player_id text, full_name text, first_name text, last_name text,
  position text, team text, active boolean, status text, fantasy_positions text[], injury_status text,
  field_states jsonb NOT NULL, identity_status text NOT NULL CHECK(identity_status IN ('valid','invalid','conflict')),
  reasons jsonb NOT NULL, source jsonb NOT NULL,
  PRIMARY KEY(content_id,external_player_id_hash)
);
CREATE INDEX player_directory_valid_page_idx ON public.league_player_directory_entries(content_id,external_player_id) WHERE identity_status='valid';
CREATE TABLE public.league_player_directory_captures (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  attempt_id uuid NOT NULL UNIQUE REFERENCES public.league_player_directory_attempts(id),
  content_id uuid NOT NULL REFERENCES public.league_player_directory_contents(id),
  evidence_hash text NOT NULL, original_result jsonb NOT NULL,
  status text NOT NULL CHECK(status IN ('complete','partial','invalid','unavailable')),
  reasons jsonb NOT NULL,
  request_started_at timestamptz, request_completed_at timestamptz, source_observed_at timestamptz,
  provider_requests smallint NOT NULL CHECK(provider_requests IN (0,1)),
  recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE(id,content_id),
  CHECK(request_started_at IS NULL OR request_completed_at IS NULL OR request_started_at<=request_completed_at),
  CHECK(source_observed_at IS NULL OR source_observed_at=request_completed_at)
);
CREATE TABLE public.league_player_directory_source_slices (
  capture_id uuid PRIMARY KEY REFERENCES public.league_player_directory_captures(id),
  scope text NOT NULL CHECK(scope='all'), endpoint text NOT NULL CHECK(endpoint='/players/nfl'),
  status text NOT NULL CHECK(status IN ('available','invalid','unavailable')),
  source_revision text, observed_at timestamptz, complete boolean NOT NULL,
  row_count integer NOT NULL CHECK(row_count BETWEEN 0 AND 100000),
  valid_row_count integer NOT NULL CHECK(valid_row_count>=0),
  invalid_row_count integer NOT NULL CHECK(invalid_row_count>=0),
  conflict_row_count integer NOT NULL CHECK(conflict_row_count>=0),
  CHECK(valid_row_count+invalid_row_count+conflict_row_count=row_count)
);
CREATE TABLE public.league_player_directory_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  capture_id uuid NOT NULL UNIQUE,
  content_id uuid NOT NULL,
  generation bigint NOT NULL UNIQUE CHECK(generation>0),
  accepted_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  FOREIGN KEY(capture_id,content_id) REFERENCES public.league_player_directory_captures(id,content_id)
);
ALTER TABLE public.league_player_directory_heads ADD CONSTRAINT player_directory_head_version_fk
  FOREIGN KEY(accepted_version_id) REFERENCES public.league_player_directory_versions(id);

CREATE FUNCTION public.player_directory_native_row(p_id text,p_source jsonb) RETURNS jsonb
LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE fields text[]:=ARRAY['player_id','full_name','first_name','last_name','position','team','active','status','fantasy_positions','injury_status'];
  names text[]:=ARRAY['providerPlayerId','fullName','firstName','lastName','position','team','active','status','fantasyPositions','injuryStatus'];
  states jsonb:='{}'; values_json jsonb:='{}'; reasons_json jsonb:='[]'; state text; field text; i integer;
  conflict boolean:=false; id_length integer;
BEGIN
  IF length(p_id)>256 THEN id_length:=257; ELSE
    SELECT coalesce(sum(CASE WHEN octet_length(letter)>3 THEN 2 ELSE 1 END),0)::integer INTO id_length
      FROM regexp_split_to_table(p_id,'') AS letter;
  END IF;
  IF p_id='' OR p_id<>btrim(p_id,E' \t\n\r\f'||chr(11)||chr(160)||chr(5760)||chr(8192)||chr(8193)||chr(8194)||chr(8195)||chr(8196)||chr(8197)||chr(8198)||chr(8199)||chr(8200)||chr(8201)||chr(8202)||chr(8232)||chr(8233)||chr(8239)||chr(8287)||chr(12288)||chr(65279))
    OR p_id ~ ('['||chr(1)||'-'||chr(31)||chr(127)||']') OR id_length>256 THEN reasons_json:=reasons_json||'"invalid-native-id"'::jsonb; END IF;
  IF jsonb_typeof(p_source) IS DISTINCT FROM 'object' THEN reasons_json:=reasons_json||'"invalid-player-row"'::jsonb; END IF;
  FOR i IN 1..array_length(fields,1) LOOP
    field:=fields[i];
    IF jsonb_typeof(p_source) IS DISTINCT FROM 'object' OR NOT(p_source ? field) THEN state:='missing';
    ELSIF p_source->field='null'::jsonb THEN state:='null';
    ELSIF field='active' THEN state:=CASE WHEN jsonb_typeof(p_source->field)='boolean' THEN 'supplied' ELSE 'invalid' END;
    ELSIF field='fantasy_positions' THEN
      IF jsonb_typeof(p_source->field)='array' AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(
        CASE WHEN jsonb_typeof(p_source->field)='array' THEN p_source->field ELSE '[]'::jsonb END) value
        WHERE jsonb_typeof(value)<>'string') THEN state:='supplied'; ELSE state:='invalid'; END IF;
    ELSE state:=CASE WHEN jsonb_typeof(p_source->field)='string' THEN 'supplied' ELSE 'invalid' END; END IF;
    states:=states||jsonb_build_object(field,state);
    values_json:=values_json||jsonb_build_object(names[i],CASE WHEN state='supplied' THEN p_source->field ELSE 'null'::jsonb END);
    IF state='invalid' THEN reasons_json:=reasons_json||jsonb_build_array('invalid-field:'||field); END IF;
  END LOOP;
  conflict:=states->>'player_id'='supplied' AND p_source->>'player_id'<>p_id;
  IF conflict THEN reasons_json:=reasons_json||'"player-id-conflict"'::jsonb; END IF;
  RETURN values_json||jsonb_build_object('externalPlayerId',p_id,'fieldStates',states,'source',p_source,
    'identityStatus',CASE WHEN conflict THEN 'conflict' WHEN jsonb_array_length(reasons_json)>0 THEN 'invalid' ELSE 'valid' END,'reasons',reasons_json);
END; $$;

-- JSON (not JSONB) retains duplicate members. Bound the tree before typed insertion.
CREATE FUNCTION public.player_directory_json_shape(p_raw text) RETURNS jsonb
LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE parsed json; values_count bigint; deepest integer; duplicates bigint;
BEGIN
  BEGIN parsed:=p_raw::json; EXCEPTION WHEN invalid_text_representation THEN
    RETURN jsonb_build_object('valid',false,'values',0,'depth',0,'duplicates',0); END;
  WITH RECURSIVE nodes(value,depth) AS (
    SELECT parsed,1 UNION ALL
    SELECT child.value,parent.depth+1 FROM nodes parent CROSS JOIN LATERAL (
      SELECT value FROM json_each(CASE WHEN json_typeof(parent.value)='object' THEN parent.value ELSE '{}'::json END)
      UNION ALL SELECT value FROM json_array_elements(CASE WHEN json_typeof(parent.value)='array' THEN parent.value ELSE '[]'::json END)
    ) child WHERE parent.depth<=64
  ) SELECT count(*),max(depth),coalesce(sum(CASE WHEN json_typeof(value)='object' THEN
    (SELECT count(*)-count(DISTINCT member.key) FROM json_each(value) member) ELSE 0 END),0)
    INTO values_count,deepest,duplicates FROM nodes;
  RETURN jsonb_build_object('valid',true,'values',values_count,'depth',deepest,'duplicates',duplicates);
END; $$;

CREATE FUNCTION public.assert_player_directory_owner(p_fence jsonb) RETURNS void
LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
  IF p_fence IS NULL OR p_fence->>'jobKey' IS DISTINCT FROM 'league-administration-public-intake'
    OR jsonb_typeof(p_fence->'workerId') IS DISTINCT FROM 'string' OR p_fence->>'workerId'=''
    OR jsonb_typeof(p_fence->'generation') IS DISTINCT FROM 'number'
    OR jsonb_typeof(p_fence->'deadlineAt') IS DISTINCT FROM 'string' THEN RAISE EXCEPTION 'player directory owner required'; END IF;
  PERFORM 1 FROM public.projection_jobs WHERE job_key=p_fence->>'jobKey' AND state='running'
    AND lease_owner=p_fence->>'workerId' AND attempt_count=(p_fence->>'generation')::integer
    AND lease_until>clock_timestamp() AND (p_fence->>'deadlineAt')::timestamptz>clock_timestamp()
    AND payload->>'policy'='public-player-directory-v1' AND payload->>'mode'='player-directory' FOR UPDATE;
  IF NOT FOUND OR (p_fence->>'deadlineAt')::timestamptz<=clock_timestamp()
    OR NOT EXISTS(SELECT 1 FROM public.projection_jobs WHERE job_key=p_fence->>'jobKey' AND lease_until>clock_timestamp()) THEN
    RAISE EXCEPTION 'player directory owner expired'; END IF;
END; $$;

CREATE FUNCTION public.begin_player_directory_attempt(p_id uuid,p_fence jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE head public.league_player_directory_heads%ROWTYPE; attempt public.league_player_directory_attempts%ROWTYPE;
  retry_at timestamptz; admitted_at timestamptz;
BEGIN
  IF p_id IS NULL THEN RAISE EXCEPTION 'player directory attempt identity required'; END IF;
  PERFORM public.assert_player_directory_owner(p_fence);
  INSERT INTO public.league_player_directory_heads(provider,sport) VALUES('sleeper','nfl') ON CONFLICT DO NOTHING;
  SELECT * INTO STRICT head FROM public.league_player_directory_heads WHERE provider='sleeper' AND sport='nfl' FOR UPDATE;
  PERFORM public.assert_player_directory_owner(p_fence);
  SELECT * INTO attempt FROM public.league_player_directory_attempts WHERE id=p_id;
  IF FOUND THEN
    IF attempt.write_fence IS DISTINCT FROM p_fence THEN RAISE EXCEPTION 'player directory attempt conflict'; END IF;
    -- An unknown reservation acknowledgement never authorizes another HTTP call.
    RETURN jsonb_build_object('status','backoff','retryAt',head.next_network_at);
  END IF;
  SELECT max(dispatch.admitted_at)+interval '60 seconds' INTO retry_at FROM public.public_data_dispatches dispatch;
  retry_at:=greatest(retry_at,head.next_network_at);
  IF retry_at>clock_timestamp() THEN RETURN jsonb_build_object('status','backoff','retryAt',retry_at); END IF;
  IF EXISTS(SELECT 1 FROM public.public_data_dispatches dispatch WHERE NOT EXISTS(SELECT 1
    FROM public.public_data_dispatch_outcomes outcome WHERE outcome.worker_id=dispatch.worker_id AND outcome.generation=dispatch.generation)) THEN
    RAISE EXCEPTION 'public dispatch recovery required before directory acquisition'; END IF;
  admitted_at:=clock_timestamp();
  INSERT INTO public.league_player_directory_attempts(id,ordinal,expected_generation,write_fence,reserved_at)
    VALUES(p_id,head.latest_ordinal+1,head.generation,p_fence,admitted_at) RETURNING * INTO attempt;
  UPDATE public.league_player_directory_heads SET latest_ordinal=attempt.ordinal,last_network_at=admitted_at,
    next_network_at=admitted_at+interval '24 hours' WHERE provider='sleeper' AND sport='nfl';
  PERFORM public.assert_player_directory_owner(p_fence);
  RETURN jsonb_build_object('status','reserved','attempt',jsonb_build_object('id',attempt.id,'nonce',attempt.nonce,
    'ordinal',attempt.ordinal,'expectedGeneration',attempt.expected_generation,'reservedAt',attempt.reserved_at));
END; $$;

CREATE FUNCTION public.record_player_directory_capture(p_attempt jsonb,p_capture jsonb,p_fence jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE attempt public.league_player_directory_attempts%ROWTYPE; head public.league_player_directory_heads%ROWTYPE;
  receipt public.league_player_directory_captures%ROWTYPE; content public.league_player_directory_contents%ROWTYPE;
  raw_text text:=p_capture->>'rawJson'; native jsonb; shape jsonb; slice jsonb;
  source_hash text; content_hash_value text; evidence_hash_value text; expected_status text:='complete';
  expected_reasons jsonb:='[]'; row_count_value integer:=0; valid_count integer:=0; invalid_count integer:=0; conflict_count integer:=0;
  mismatches bigint; distinct_ids bigint; raw_count bigint; created_content boolean:=false;
  started timestamptz; completed timestamptz; observed timestamptz; reason_value text; version_id uuid;
BEGIN
  PERFORM public.assert_player_directory_owner(p_fence);
  SELECT * INTO STRICT head FROM public.league_player_directory_heads WHERE provider='sleeper' AND sport='nfl' FOR UPDATE;
  PERFORM public.assert_player_directory_owner(p_fence);
  SELECT * INTO STRICT attempt FROM public.league_player_directory_attempts WHERE id=(p_attempt->>'id')::uuid;
  IF p_attempt-'reservedAt' IS DISTINCT FROM jsonb_build_object('id',attempt.id,'nonce',attempt.nonce,
      'ordinal',attempt.ordinal,'expectedGeneration',attempt.expected_generation)
    OR (p_attempt->>'reservedAt')::timestamptz IS DISTINCT FROM attempt.reserved_at
    OR attempt.write_fence IS DISTINCT FROM p_fence OR p_capture->>'attemptId' IS DISTINCT FROM attempt.id::text
    OR p_capture->>'attemptNonce' IS DISTINCT FROM attempt.nonce::text THEN RAISE EXCEPTION 'player directory reservation mismatch'; END IF;
  IF p_capture->>'schemaVersion' IS DISTINCT FROM 'sleeper-player-directory-v1'
    OR p_capture->>'normalizerVersion' IS DISTINCT FROM 'sleeper-player-directory-v1'
    OR p_capture->>'provider' IS DISTINCT FROM 'sleeper' OR p_capture->>'sport' IS DISTINCT FROM 'nfl'
    OR p_capture->>'namespace' IS DISTINCT FROM 'nfl:players' OR p_capture->>'origin' IS DISTINCT FROM 'network'
    OR octet_length(p_capture::text)>67108864 OR (raw_text IS NOT NULL AND octet_length(raw_text)>16777216)
    OR jsonb_typeof(p_capture->'rows') IS DISTINCT FROM 'array'
    OR jsonb_typeof(p_capture->'sourceSlices') IS DISTINCT FROM 'array' OR jsonb_array_length(p_capture->'sourceSlices')<>1
    OR jsonb_typeof(p_capture->'duplicateMemberPaths') IS DISTINCT FROM 'array' OR jsonb_array_length(p_capture->'duplicateMemberPaths')>128
    OR jsonb_typeof(p_capture->'duplicateMemberPathsTruncated') IS DISTINCT FROM 'boolean'
    OR jsonb_typeof(p_capture->'reasons') IS DISTINCT FROM 'array' OR jsonb_array_length(p_capture->'reasons')>32
    OR jsonb_typeof(p_capture->'providerRequests') IS DISTINCT FROM 'number' OR p_capture->'providerRequests' NOT IN ('0'::jsonb,'1'::jsonb) THEN RAISE EXCEPTION 'invalid player directory envelope'; END IF;
  evidence_hash_value:=encode(digest(convert_to(jsonb_build_object('attempt',p_attempt,'capture',p_capture,'fence',p_fence)::text,'UTF8'),'sha256'),'hex');
  SELECT * INTO receipt FROM public.league_player_directory_captures WHERE attempt_id=attempt.id;
  IF FOUND THEN
    IF receipt.evidence_hash<>evidence_hash_value THEN RAISE EXCEPTION 'player directory receipt conflict'; END IF;
    PERFORM public.assert_player_directory_owner(p_fence);
    RETURN receipt.original_result||jsonb_build_object('status','replayed','reason','exact_receipt_replay');
  END IF;
  started:=(p_capture->>'requestStartedAt')::timestamptz; completed:=(p_capture->>'requestCompletedAt')::timestamptz;
  observed:=(p_capture->>'sourceObservedAt')::timestamptz;
  IF (started IS NOT NULL AND (NOT isfinite(started)))
    OR (completed IS NOT NULL AND (NOT isfinite(completed)))
    OR (observed IS NOT NULL AND NOT isfinite(observed)) OR (started IS NOT NULL AND completed IS NOT NULL AND started>completed) THEN
    RAISE EXCEPTION 'invalid directory capture chronology'; END IF;
  source_hash:=CASE WHEN raw_text IS NULL THEN NULL ELSE 'sha256:'||encode(digest(convert_to(raw_text,'UTF8'),'sha256'),'hex') END;
  IF p_capture->>'sourceRevision' IS DISTINCT FROM source_hash THEN RAISE EXCEPTION 'directory source hash mismatch'; END IF;
  IF raw_text IS NULL OR p_capture->>'status'='unavailable' THEN
    expected_status:='unavailable'; expected_reasons:=p_capture->'reasons';
    IF observed IS NOT NULL OR jsonb_array_length(expected_reasons)=0 OR EXISTS(SELECT 1 FROM jsonb_array_elements(expected_reasons) value
      WHERE jsonb_typeof(value)<>'string' OR length(value#>>'{}')>128) THEN RAISE EXCEPTION 'invalid unavailable directory evidence'; END IF;
    shape:=jsonb_build_object('valid',false,'values',0,'depth',0,'duplicates',0);
  ELSE
    IF started IS NULL OR completed IS NULL OR observed IS DISTINCT FROM completed OR p_capture->'providerRequests'<>'1'::jsonb THEN
      RAISE EXCEPTION 'original directory network times required'; END IF;
    shape:=public.player_directory_json_shape(raw_text);
    IF (shape->>'values')::bigint>2000000 OR (shape->>'depth')::integer>64 THEN RAISE EXCEPTION 'directory source shape exceeds bound'; END IF;
    IF shape->>'valid'='false' THEN expected_status:='invalid'; expected_reasons:='["invalid-json"]';
    ELSE
      native:=raw_text::jsonb;
      IF jsonb_typeof(native)<>'object' THEN expected_status:='invalid'; expected_reasons:='["invalid-root"]';
      ELSE
        SELECT count(*) INTO raw_count FROM jsonb_object_keys(native);
        IF raw_count=0 THEN expected_status:='invalid'; expected_reasons:='["empty-directory"]';
        ELSIF raw_count>100000 THEN expected_status:='invalid'; expected_reasons:='["directory-row-limit"]';
        ELSE row_count_value:=raw_count::integer; END IF;
      END IF;
      IF (shape->>'duplicates')::integer>0 THEN expected_status:='invalid'; expected_reasons:=expected_reasons||'"duplicate-json-members"'::jsonb; END IF;
    END IF;
  END IF;
  IF p_capture->'duplicateMemberCount' IS DISTINCT FROM shape->'duplicates'
    OR ((shape->>'duplicates')::integer=0 AND p_capture->'duplicateMemberPaths'<>'[]'::jsonb)
    OR jsonb_array_length(p_capture->'rows')<>row_count_value THEN RAISE EXCEPTION 'directory native row or duplicate count mismatch'; END IF;
  -- Each key is checked once; unique keys + exact cardinality prove the entire native object.
  SELECT count(DISTINCT row->>'externalPlayerId'),count(*) FILTER(WHERE jsonb_typeof(row->'externalPlayerId') IS DISTINCT FROM 'string'
      OR NOT(native ? (row->>'externalPlayerId'))
      OR row-'source' IS DISTINCT FROM public.player_directory_native_row(row->>'externalPlayerId',native->(row->>'externalPlayerId'))-'source'),
    count(*) FILTER(WHERE row->>'identityStatus'='valid'),count(*) FILTER(WHERE row->>'identityStatus'='invalid'),
    count(*) FILTER(WHERE row->>'identityStatus'='conflict') INTO distinct_ids,mismatches,valid_count,invalid_count,conflict_count
    FROM jsonb_array_elements(p_capture->'rows') row;
  IF distinct_ids<>row_count_value OR mismatches<>0 THEN RAISE EXCEPTION 'directory native typed parity mismatch'; END IF;
  IF invalid_count>0 THEN
    IF expected_status='complete' THEN expected_status:='partial'; END IF;
    expected_reasons:=expected_reasons||'"invalid-player-rows"'::jsonb;
  END IF;
  IF conflict_count>0 THEN
    IF expected_status='complete' THEN expected_status:='partial'; END IF;
    expected_reasons:=expected_reasons||'"conflicting-player-identities"'::jsonb;
  END IF;
  IF p_capture->>'status' IS DISTINCT FROM expected_status OR p_capture->'reasons' IS DISTINCT FROM expected_reasons THEN
    RAISE EXCEPTION 'directory status does not match native evidence'; END IF;
  slice:=p_capture->'sourceSlices'->0;
  IF slice IS DISTINCT FROM jsonb_build_object('scope','all','endpoint','/players/nfl',
      'status',CASE WHEN expected_status='unavailable' THEN 'unavailable' WHEN expected_status='invalid' THEN 'invalid' ELSE 'available' END,
      'sourceRevision',source_hash,'observedAt',p_capture->'sourceObservedAt','complete',expected_status='complete',
      'rowCount',row_count_value,'validRowCount',valid_count,'invalidRowCount',invalid_count,'conflictRowCount',conflict_count) THEN
    RAISE EXCEPTION 'directory source slice mismatch'; END IF;
  content_hash_value:=encode(digest(convert_to(jsonb_build_array('sleeper-player-directory-v1',raw_text,row_count_value,expected_status='unavailable')::text,'UTF8'),'sha256'),'hex');
  INSERT INTO public.league_player_directory_contents(normalizer_version,content_hash,source_revision,raw_json,row_count,duplicate_member_count)
    VALUES('sleeper-player-directory-v1',content_hash_value,source_hash,raw_text,row_count_value,(shape->>'duplicates')::integer)
    ON CONFLICT(content_hash) DO NOTHING RETURNING * INTO content;
  created_content:=FOUND;
  IF NOT created_content THEN
    SELECT * INTO STRICT content FROM public.league_player_directory_contents WHERE content_hash=content_hash_value;
    IF content.raw_json IS DISTINCT FROM raw_text OR content.source_revision IS DISTINCT FROM source_hash
      OR content.row_count<>row_count_value OR content.duplicate_member_count<>(shape->>'duplicates')::integer THEN
      RAISE EXCEPTION 'directory content hash conflict'; END IF;
  ELSE
    INSERT INTO public.league_player_directory_entries(content_id,external_player_id,provider_player_id,full_name,first_name,last_name,
      position,team,active,status,fantasy_positions,injury_status,field_states,identity_status,reasons,source)
      SELECT content.id,row->>'externalPlayerId',row->>'providerPlayerId',row->>'fullName',row->>'firstName',row->>'lastName',
        row->>'position',row->>'team',(row->>'active')::boolean,row->>'status',
        CASE WHEN row->'fantasyPositions'='null'::jsonb THEN NULL ELSE ARRAY(SELECT jsonb_array_elements_text(row->'fantasyPositions')) END,
        row->>'injuryStatus',row->'fieldStates',row->>'identityStatus',row->'reasons',native->(row->>'externalPlayerId')
        FROM jsonb_array_elements(p_capture->'rows') row;
  END IF;
  reason_value:=CASE WHEN expected_status<>'complete' THEN expected_status WHEN attempt.ordinal<>head.latest_ordinal THEN 'stale_attempt'
    WHEN attempt.expected_generation<>head.generation THEN 'generation_conflict' ELSE 'accepted' END;
  version_id:=CASE WHEN reason_value='accepted' THEN gen_random_uuid() ELSE NULL END;
  receipt.id:=gen_random_uuid();
  INSERT INTO public.league_player_directory_captures(id,attempt_id,content_id,evidence_hash,original_result,status,reasons,
    request_started_at,request_completed_at,source_observed_at,provider_requests)
    VALUES(receipt.id,attempt.id,content.id,evidence_hash_value,
      jsonb_build_object('status',CASE WHEN reason_value='accepted' THEN 'accepted' ELSE 'preserved' END,'reason',reason_value,
        'receiptId',receipt.id,'contentId',content.id,'acceptedVersionId',version_id,
        'generation',head.generation+CASE WHEN reason_value='accepted' THEN 1 ELSE 0 END),
      expected_status,expected_reasons,started,completed,observed,(p_capture->>'providerRequests')::smallint)
    RETURNING * INTO receipt;
  INSERT INTO public.league_player_directory_source_slices(capture_id,scope,endpoint,status,source_revision,observed_at,complete,
    row_count,valid_row_count,invalid_row_count,conflict_row_count)
    VALUES(receipt.id,'all','/players/nfl',slice->>'status',source_hash,observed,expected_status='complete',row_count_value,valid_count,invalid_count,conflict_count);
  reason_value:=CASE WHEN expected_status<>'complete' THEN expected_status WHEN attempt.ordinal<>head.latest_ordinal THEN 'stale_attempt'
    WHEN attempt.expected_generation<>head.generation THEN 'generation_conflict' ELSE 'accepted' END;
  IF reason_value='accepted' THEN
    INSERT INTO public.league_player_directory_versions(id,capture_id,content_id,generation)
      VALUES(version_id,receipt.id,content.id,head.generation+1);
    UPDATE public.league_player_directory_heads SET accepted_version_id=version_id,generation=generation+1
      WHERE provider='sleeper' AND sport='nfl' RETURNING * INTO head;
  END IF;
  PERFORM public.assert_player_directory_owner(p_fence);
  RETURN receipt.original_result;
END; $$;

CREATE FUNCTION public.validate_player_directory_lineage() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
  IF TG_TABLE_NAME='league_player_directory_heads' THEN
    IF NEW.accepted_version_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.league_player_directory_versions version
      WHERE version.id=NEW.accepted_version_id AND version.generation=NEW.generation) THEN RAISE EXCEPTION 'directory head lineage mismatch'; END IF;
    IF (NEW.accepted_version_id IS NULL AND NEW.generation<>0)
      OR (NEW.latest_ordinal>0 AND NOT EXISTS(SELECT 1 FROM public.league_player_directory_attempts WHERE ordinal=NEW.latest_ordinal)) THEN
      RAISE EXCEPTION 'directory head has missing lineage'; END IF;
    IF TG_OP='UPDATE' AND (NEW.provider<>OLD.provider OR NEW.sport<>OLD.sport OR NEW.namespace<>OLD.namespace
      OR NEW.latest_ordinal<OLD.latest_ordinal OR NEW.generation<OLD.generation OR NEW.generation>OLD.generation+1
      OR (NEW.generation=OLD.generation AND NEW.accepted_version_id IS DISTINCT FROM OLD.accepted_version_id)
      OR (OLD.accepted_version_id IS NOT NULL AND NEW.accepted_version_id IS NULL)) THEN RAISE EXCEPTION 'directory head cannot regress'; END IF;
  ELSIF TG_TABLE_NAME='league_player_directory_versions' THEN
    IF NOT EXISTS(SELECT 1 FROM public.league_player_directory_captures capture
      JOIN public.league_player_directory_contents content ON content.id=capture.content_id
      JOIN public.league_player_directory_attempts attempt ON attempt.id=capture.attempt_id
      JOIN public.league_player_directory_source_slices slice ON slice.capture_id=capture.id
      JOIN public.league_player_directory_heads head ON head.provider='sleeper' AND head.sport='nfl'
      WHERE capture.id=NEW.capture_id AND capture.content_id=NEW.content_id AND capture.status='complete'
        AND slice.complete AND slice.status='available' AND slice.row_count=content.row_count AND content.row_count>0
        AND slice.valid_row_count=content.row_count AND slice.invalid_row_count=0 AND slice.conflict_row_count=0
        AND content.duplicate_member_count=0 AND capture.source_observed_at IS NOT NULL
        AND attempt.ordinal=head.latest_ordinal AND NEW.generation=head.generation+1 AND NEW.generation=attempt.expected_generation+1
        AND (SELECT count(*) FROM public.league_player_directory_entries WHERE content_id=content.id)=content.row_count
        AND NOT EXISTS(SELECT 1 FROM public.league_player_directory_entries WHERE content_id=content.id AND identity_status<>'valid')) THEN
      RAISE EXCEPTION 'directory version lineage mismatch'; END IF;
  ELSIF TG_TABLE_NAME='league_player_directory_source_slices' THEN
    IF NOT EXISTS(SELECT 1 FROM public.league_player_directory_captures capture
      JOIN public.league_player_directory_contents content ON content.id=capture.content_id
      WHERE capture.id=NEW.capture_id AND NEW.source_revision IS NOT DISTINCT FROM content.source_revision
        AND NEW.observed_at IS NOT DISTINCT FROM capture.source_observed_at AND NEW.row_count=content.row_count
        AND NEW.complete=(capture.status='complete')
        AND NEW.status=CASE WHEN capture.status='unavailable' THEN 'unavailable' WHEN capture.status='invalid' THEN 'invalid' ELSE 'available' END) THEN
      RAISE EXCEPTION 'directory slice lineage mismatch'; END IF;
  END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER player_directory_head_lineage BEFORE INSERT OR UPDATE ON public.league_player_directory_heads
  FOR EACH ROW EXECUTE FUNCTION public.validate_player_directory_lineage();
CREATE TRIGGER player_directory_version_lineage BEFORE INSERT ON public.league_player_directory_versions
  FOR EACH ROW EXECUTE FUNCTION public.validate_player_directory_lineage();
CREATE TRIGGER player_directory_slice_lineage BEFORE INSERT ON public.league_player_directory_source_slices
  FOR EACH ROW EXECUTE FUNCTION public.validate_player_directory_lineage();
DO $$ DECLARE relation text; BEGIN
  FOREACH relation IN ARRAY ARRAY['attempts','contents','entries','captures','source_slices','versions'] LOOP
    EXECUTE format('CREATE TRIGGER player_directory_history_immutable BEFORE UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.prevent_league_administration_history_change()', 'league_player_directory_'||relation);
  END LOOP;
END; $$;

-- Preserve the existing minute admission budget in both directions. The existing
-- owner/work guard runs before a backoff result; no unauthenticated shortcut.
ALTER FUNCTION public.admit_public_data_dispatch(jsonb,jsonb) RENAME TO admit_public_data_dispatch_v40;
CREATE FUNCTION public.admit_public_data_dispatch(p_work jsonb,p_fence jsonb) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
  PERFORM public.assert_public_data_owner((p_work->>'requestId')::uuid,p_fence);
  IF EXISTS(SELECT 1 FROM public.league_player_directory_heads WHERE provider='sleeper' AND sport='nfl'
    AND last_network_at>clock_timestamp()-interval '60 seconds') THEN RETURN false; END IF;
  RETURN public.admit_public_data_dispatch_v40(p_work,p_fence);
END; $$;
REVOKE ALL ON public.league_player_directory_heads,public.league_player_directory_attempts,public.league_player_directory_contents,
  public.league_player_directory_entries,public.league_player_directory_captures,public.league_player_directory_source_slices,
  public.league_player_directory_versions FROM PUBLIC;
REVOKE ALL ON FUNCTION public.player_directory_native_row(text,jsonb),public.player_directory_json_shape(text),
  public.assert_player_directory_owner(jsonb),public.validate_player_directory_lineage(),
  public.begin_player_directory_attempt(uuid,jsonb),public.record_player_directory_capture(jsonb,jsonb,jsonb),
  public.admit_public_data_dispatch_v40(jsonb,jsonb),public.admit_public_data_dispatch(jsonb,jsonb) FROM PUBLIC;
DO $$ DECLARE relation text; helper text; BEGIN
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='league_one_runtime') THEN
    FOREACH relation IN ARRAY ARRAY['heads','attempts','contents','entries','captures','source_slices','versions'] LOOP
      EXECUTE format('REVOKE ALL ON TABLE public.%I FROM league_one_runtime','league_player_directory_'||relation);
      EXECUTE format('GRANT SELECT ON TABLE public.%I TO league_one_runtime','league_player_directory_'||relation);
    END LOOP;
    FOREACH helper IN ARRAY ARRAY['public.player_directory_native_row(text,jsonb)','public.player_directory_json_shape(text)',
      'public.assert_player_directory_owner(jsonb)','public.validate_player_directory_lineage()',
      'public.admit_public_data_dispatch_v40(jsonb,jsonb)'] LOOP
      EXECUTE format('REVOKE ALL ON FUNCTION %s FROM league_one_runtime',helper);
    END LOOP;
    GRANT EXECUTE ON FUNCTION public.begin_player_directory_attempt(uuid,jsonb),public.record_player_directory_capture(jsonb,jsonb,jsonb),
      public.admit_public_data_dispatch(jsonb,jsonb) TO league_one_runtime;
  END IF;
END; $$;
