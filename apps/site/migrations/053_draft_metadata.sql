-- CP16 opt-in metadata, independent of legacy complete picks/trades normalization.
-- No intake selector, scheduler, provider configuration, backfill or activation.
CREATE FUNCTION public.draft_metadata_owns(p_row jsonb,p_league text,p_id text DEFAULT NULL)
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,public,pg_temp AS $$
  SELECT COALESCE(jsonb_typeof(p_row)='object' AND jsonb_typeof(p_row->'draft_id')='string'
    AND p_row->>'draft_id' ~ '^[A-Za-z0-9_-]{1,128}$' AND (p_id IS NULL OR p_row->>'draft_id'=p_id)
    AND p_row->'league_id'=to_jsonb(p_league) AND p_row->'season'='"2026"'::jsonb
    AND (NOT p_row ? 'sport' OR p_row->'sport'='"nfl"'::jsonb),false)
$$;
CREATE FUNCTION public.draft_metadata_field(p_row jsonb,p_key text,p_kind text)
RETURNS jsonb LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE raw jsonb:=p_row->p_key; parsed jsonb; state_value text;
BEGIN
  IF NOT p_row ? p_key THEN RETURN jsonb_build_object('state','missing','raw',NULL,'value',NULL); END IF;
  IF raw='null'::jsonb THEN RETURN jsonb_build_object('state','null','raw',NULL,'value',NULL); END IF;
  IF p_kind='text' AND jsonb_typeof(raw)='string' OR p_kind='object' AND jsonb_typeof(raw)='object' THEN parsed:=raw;
  ELSIF p_kind IN ('timestamp','slot') AND jsonb_typeof(raw)='number' THEN
    IF (raw#>>'{}')::numeric=trunc((raw#>>'{}')::numeric) AND (raw#>>'{}')::numeric BETWEEN CASE WHEN p_kind='slot' THEN 1 ELSE 0 END AND 9007199254740991 THEN parsed:=raw; END IF;
  ELSIF p_kind='roster' THEN
    IF jsonb_typeof(raw)='string' AND raw#>>'{}' ~ '^[1-9][0-9]{0,31}$' THEN parsed:=raw;
    ELSIF jsonb_typeof(raw)='number' AND (raw#>>'{}')::numeric=trunc((raw#>>'{}')::numeric)
      AND (raw#>>'{}')::numeric BETWEEN 1 AND 9007199254740991 THEN parsed:=to_jsonb((raw#>>'{}')::bigint::text); END IF;
  END IF;
  state_value:=CASE WHEN parsed IS NULL THEN 'invalid' WHEN raw IN ('""'::jsonb,'{}'::jsonb,'[]'::jsonb) THEN 'empty' ELSE 'supplied' END;
  RETURN jsonb_build_object('state',state_value,'raw',raw,'value',parsed);
END; $$;
CREATE FUNCTION public.draft_metadata_facts(p_row jsonb)
RETURNS jsonb LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE user_slots jsonb:='[]'; slot_rosters jsonb:='[]';
BEGIN
  IF jsonb_typeof(p_row->'draft_order')='object' THEN
    SELECT COALESCE(jsonb_agg(jsonb_build_object('externalUserId',key,'slot',public.draft_metadata_field(p_row->'draft_order',key,'slot')) ORDER BY key COLLATE "C"),'[]')
      INTO user_slots FROM jsonb_each(p_row->'draft_order');
  END IF;
  IF jsonb_typeof(p_row->'slot_to_roster_id')='object' THEN
    SELECT COALESCE(jsonb_agg(jsonb_build_object('slotKey',key,'externalRosterId',public.draft_metadata_field(p_row->'slot_to_roster_id',key,'roster')) ORDER BY key COLLATE "C"),'[]')
      INTO slot_rosters FROM jsonb_each(p_row->'slot_to_roster_id');
  END IF;
  RETURN jsonb_build_object('externalDraftId',p_row->'draft_id','externalLeagueId',p_row->'league_id','season',2026,
    'type',public.draft_metadata_field(p_row,'type','text'),'status',public.draft_metadata_field(p_row,'status','text'),
    'sport',public.draft_metadata_field(p_row,'sport','text'),'settings',public.draft_metadata_field(p_row,'settings','object'),
    'metadata',public.draft_metadata_field(p_row,'metadata','object'),'startTime',public.draft_metadata_field(p_row,'start_time','timestamp'),
    'created',public.draft_metadata_field(p_row,'created','timestamp'),'lastPicked',public.draft_metadata_field(p_row,'last_picked','timestamp'),
    'draftOrder',public.draft_metadata_field(p_row,'draft_order','object'),'slotToRosterId',public.draft_metadata_field(p_row,'slot_to_roster_id','object'),
    'userSlots',user_slots,'slotRosters',slot_rosters,
    'extensions',p_row-ARRAY['draft_id','league_id','season','type','status','sport','settings','metadata','start_time','created','last_picked','draft_order','slot_to_roster_id']);
END; $$;
CREATE FUNCTION public.project_draft_metadata_native(p_payload jsonb,p_league text,p_complete boolean)
RETURNS jsonb LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE row_value jsonb; entries jsonb:='[]'; outcomes jsonb:='{}'; frequencies jsonb:='{}'; native_id text;
  total integer; valid_count integer:=0; succeeded integer:=0; failed integer:=0; detail_state text; complete boolean; result jsonb;
  source_body jsonb; node_count integer; deepest integer;
BEGIN
  IF p_payload->>'metadataVersion' IS DISTINCT FROM 'sleeper-draft-metadata-v1' OR octet_length(p_payload::text)>8454144 THEN RETURN NULL; END IF;
  -- Match the existing transport's per-native-body value/depth bound even for
  -- direct restricted-writer submissions. Stop recursive expansion at depth65
  -- and cap the consumed rows before aggregating their count.
  FOR source_body IN SELECT p_payload->'catalog' UNION ALL SELECT p_payload->'draft' WHERE p_payload->>'kind'='detail' LOOP
    WITH RECURSIVE nodes(value,depth) AS (
      SELECT source_body,1
      UNION ALL
      SELECT child.value,nodes.depth+1 FROM nodes CROSS JOIN LATERAL (
        SELECT value FROM jsonb_array_elements(CASE WHEN jsonb_typeof(nodes.value)='array' THEN nodes.value ELSE '[]'::jsonb END)
        UNION ALL SELECT value FROM jsonb_each(CASE WHEN jsonb_typeof(nodes.value)='object' THEN nodes.value ELSE '{}'::jsonb END)
      ) child WHERE nodes.depth<65
    ) SELECT count(*),max(depth) INTO node_count,deepest FROM (SELECT depth FROM nodes LIMIT 250001) bounded;
    IF node_count>250000 OR deepest>64 THEN RETURN NULL; END IF;
  END LOOP;
  IF p_payload->>'kind'='detail' THEN
    native_id:=p_payload->>'externalDraftId';
    IF NOT p_complete OR jsonb_typeof(p_payload->'externalDraftId') IS DISTINCT FROM 'string' OR native_id !~ '^[A-Za-z0-9_-]{1,128}$'
      OR NOT public.draft_metadata_owns(p_payload->'catalog',p_league,native_id) OR NOT public.draft_metadata_owns(p_payload->'draft',p_league,native_id) THEN RETURN NULL; END IF;
    result:=jsonb_build_object('kind','detail','season',2026,'complete',true,'externalDraftId',native_id,
      'catalog',public.draft_metadata_facts(p_payload->'catalog'),'detail',public.draft_metadata_facts(p_payload->'draft'),'picks','not-requested','tradedPicks','not-requested');
  ELSIF p_payload->>'kind'='catalog' THEN
    IF jsonb_typeof(p_payload->'details') IS DISTINCT FROM 'array' OR jsonb_array_length(p_payload->'details')>8
      OR NOT COALESCE(p_payload->'reason'='null'::jsonb OR jsonb_typeof(p_payload->'reason')='string',false) THEN RETURN NULL; END IF;
    IF jsonb_typeof(p_payload->'catalog')='array' THEN
      total:=jsonb_array_length(p_payload->'catalog');
      SELECT COALESCE(jsonb_object_agg(counts.id,counts.amount),'{}') INTO frequencies FROM (
        SELECT candidate->>'draft_id' AS id,count(*) AS amount FROM jsonb_array_elements(p_payload->'catalog') candidate
          WHERE public.draft_metadata_owns(candidate,p_league) GROUP BY candidate->>'draft_id') counts;
    END IF;
    FOR row_value IN SELECT value FROM jsonb_array_elements(p_payload->'details') LOOP
      native_id:=row_value->>'externalDraftId';
      IF jsonb_typeof(row_value->'externalDraftId') IS DISTINCT FROM 'string' OR native_id !~ '^[A-Za-z0-9_-]{1,128}$'
        OR outcomes ? native_id OR row_value->>'state' IS NULL OR row_value->>'state' NOT IN ('succeeded','failed','unrequested')
        OR total IS NULL OR COALESCE((frequencies->>native_id)::integer,0)<>1
        OR (total>8 AND row_value->>'state'<>'unrequested') THEN RETURN NULL; END IF;
      outcomes:=outcomes||jsonb_build_object(native_id,row_value->'state');
    END LOOP;
    IF total IS NOT NULL THEN
      SELECT COALESCE(jsonb_agg(jsonb_build_object('sourceOrdinal',ordinality-1,'identityState',CASE WHEN valid THEN 'valid' ELSE 'invalid' END,
        'externalDraftId',id,'metadata',CASE WHEN valid AND total<=8 THEN public.draft_metadata_facts(value) END,
        'detailState',CASE WHEN valid THEN COALESCE(outcomes->>id,'unrequested') ELSE 'unrequested' END) ORDER BY ordinality),'[]') INTO entries
      FROM (SELECT value,ordinality,CASE WHEN jsonb_typeof(value->'draft_id')='string' AND value->>'draft_id' ~ '^[A-Za-z0-9_-]{1,128}$' THEN value->>'draft_id' END AS id,
        public.draft_metadata_owns(value,p_league) AND COALESCE((frequencies->>(value->>'draft_id'))::integer,0)=1 AS valid
        FROM jsonb_array_elements(p_payload->'catalog') WITH ORDINALITY) native_entries;
      SELECT count(*) FILTER(WHERE value->>'identityState'='valid'),count(*) FILTER(WHERE value->>'detailState'='succeeded'),count(*) FILTER(WHERE value->>'detailState'='failed')
        INTO valid_count,succeeded,failed FROM jsonb_array_elements(entries);
    END IF;
    complete:=total IS NOT NULL AND total<=8 AND total=valid_count AND p_complete;
    IF complete AND p_payload->'reason'<>'null'::jsonb AND p_payload->>'reason'<>'metadata-source-partial' THEN RETURN NULL; END IF;
    result:=jsonb_build_object('kind','catalog','season',2026,'complete',complete,'totalCount',total,'validIdentityCount',valid_count,
      'invalidIdentityCount',COALESCE(total,0)-valid_count,'attemptedDetailCount',succeeded+failed,'succeededDetailCount',succeeded,'failedDetailCount',failed,
      'unrequestedDetailCount',COALESCE(total,0)-succeeded-failed,'entries',entries,'reason',p_payload->'reason','picks','not-requested','tradedPicks','not-requested');
  END IF;
  IF octet_length(result::text)>33488896 THEN RETURN NULL; END IF;
  RETURN result;
END; $$;

CREATE TABLE public.league_season_drafts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), league_season_id uuid NOT NULL REFERENCES public.league_seasons(id),
  provider text NOT NULL CHECK(provider='sleeper'), external_league_id text NOT NULL, external_draft_id text NOT NULL CHECK(external_draft_id ~ '^[A-Za-z0-9_-]{1,128}$'),
  UNIQUE(league_season_id,provider,external_league_id,external_draft_id), UNIQUE(id,league_season_id)
);
CREATE TABLE public.league_draft_metadata_contents (
  content_id uuid PRIMARY KEY REFERENCES public.league_administration_contents(id), first_receipt_id uuid NOT NULL REFERENCES public.league_roster_capture_receipts(id),
  capture_transaction xid8 NOT NULL DEFAULT pg_current_xact_id(), value_version text NOT NULL CHECK(value_version='sleeper-draft-metadata-v1'),
  kind text NOT NULL CHECK(kind IN ('catalog','detail')), external_draft_id text, complete boolean NOT NULL,
  total_count integer CHECK(total_count>=0), valid_identity_count integer NOT NULL CHECK(valid_identity_count>=0),
  invalid_identity_count integer NOT NULL CHECK(invalid_identity_count>=0), attempted_detail_count integer NOT NULL CHECK(attempted_detail_count BETWEEN 0 AND 8),
  succeeded_detail_count integer NOT NULL CHECK(succeeded_detail_count BETWEEN 0 AND 8), failed_detail_count integer NOT NULL CHECK(failed_detail_count BETWEEN 0 AND 8),
  unrequested_detail_count integer NOT NULL CHECK(unrequested_detail_count>=0), reason text,
  CHECK((kind='detail')=(external_draft_id IS NOT NULL)), CHECK(attempted_detail_count=succeeded_detail_count+failed_detail_count),
  CHECK(kind='detail' OR (COALESCE(total_count,0)=valid_identity_count+invalid_identity_count AND COALESCE(total_count,0)=attempted_detail_count+unrequested_detail_count))
);
CREATE TABLE public.league_draft_metadata_entries (
  content_id uuid NOT NULL REFERENCES public.league_draft_metadata_contents(content_id), source_ordinal integer NOT NULL CHECK(source_ordinal>=0),
  identity_state text NOT NULL CHECK(identity_state IN ('valid','invalid')), external_draft_id text,
  detail_state text NOT NULL CHECK(detail_state IN ('succeeded','failed','unrequested')),
  PRIMARY KEY(content_id,source_ordinal), CHECK(identity_state<>'valid' OR external_draft_id IS NOT NULL)
);
CREATE TABLE public.league_draft_metadata_facts (
  content_id uuid NOT NULL REFERENCES public.league_draft_metadata_contents(content_id), source_kind text NOT NULL CHECK(source_kind IN ('catalog','detail')),
  external_draft_id text NOT NULL, draft_id uuid NOT NULL REFERENCES public.league_season_drafts(id), external_league_id text NOT NULL, season integer NOT NULL CHECK(season=2026),
  type_state text NOT NULL, type_value text, status_state text NOT NULL, status_value text,
  settings jsonb NOT NULL, metadata jsonb NOT NULL, native_fields jsonb NOT NULL, extensions jsonb NOT NULL,
  PRIMARY KEY(content_id,source_kind,external_draft_id)
);
CREATE TABLE public.league_draft_metadata_user_slots (
  content_id uuid NOT NULL, source_kind text NOT NULL, external_draft_id text NOT NULL, external_user_id text NOT NULL,
  field_state text NOT NULL CHECK(field_state IN ('missing','null','empty','invalid','supplied')), raw_value jsonb NOT NULL,
  draft_slot bigint CHECK(draft_slot BETWEEN 1 AND 9007199254740991),
  PRIMARY KEY(content_id,source_kind,external_draft_id,external_user_id),
  FOREIGN KEY(content_id,source_kind,external_draft_id) REFERENCES public.league_draft_metadata_facts(content_id,source_kind,external_draft_id),
  CHECK((field_state='supplied')=(draft_slot IS NOT NULL))
);
CREATE TABLE public.league_draft_metadata_slot_rosters (
  content_id uuid NOT NULL, source_kind text NOT NULL, external_draft_id text NOT NULL, slot_key text NOT NULL,
  field_state text NOT NULL CHECK(field_state IN ('missing','null','empty','invalid','supplied')), raw_value jsonb NOT NULL, external_roster_id text,
  PRIMARY KEY(content_id,source_kind,external_draft_id,slot_key),
  FOREIGN KEY(content_id,source_kind,external_draft_id) REFERENCES public.league_draft_metadata_facts(content_id,source_kind,external_draft_id),
  CHECK((field_state='supplied')=(external_roster_id IS NOT NULL))
);

CREATE FUNCTION public.draft_metadata_stored_facts(p_content uuid,p_kind text,p_id text)
RETURNS jsonb LANGUAGE sql STABLE SET search_path=pg_catalog,public,pg_temp AS $$
  SELECT f.native_fields||jsonb_build_object('externalDraftId',f.external_draft_id,'externalLeagueId',f.external_league_id,'season',f.season,
    'type',jsonb_build_object('state',f.type_state,'raw',f.native_fields->'type'->'raw','value',f.type_value),
    'status',jsonb_build_object('state',f.status_state,'raw',f.native_fields->'status'->'raw','value',f.status_value),
    'settings',f.settings,'metadata',f.metadata,'extensions',f.extensions,
    'userSlots',(SELECT COALESCE(jsonb_agg(jsonb_build_object('externalUserId',u.external_user_id,'slot',jsonb_build_object('state',u.field_state,'raw',u.raw_value,'value',u.draft_slot)) ORDER BY u.external_user_id COLLATE "C"),'[]') FROM public.league_draft_metadata_user_slots u WHERE u.content_id=f.content_id AND u.source_kind=f.source_kind AND u.external_draft_id=f.external_draft_id),
    'slotRosters',(SELECT COALESCE(jsonb_agg(jsonb_build_object('slotKey',r.slot_key,'externalRosterId',jsonb_build_object('state',r.field_state,'raw',r.raw_value,'value',r.external_roster_id)) ORDER BY r.slot_key COLLATE "C"),'[]') FROM public.league_draft_metadata_slot_rosters r WHERE r.content_id=f.content_id AND r.source_kind=f.source_kind AND r.external_draft_id=f.external_draft_id))
  FROM public.league_draft_metadata_facts f WHERE f.content_id=p_content AND f.source_kind=p_kind AND f.external_draft_id=p_id
$$;
CREATE FUNCTION public.draft_metadata_typed_value(p_content uuid)
RETURNS jsonb LANGUAGE sql STABLE SET search_path=pg_catalog,public,pg_temp AS $$
  SELECT jsonb_build_object('kind',h.kind,'season',2026,'complete',h.complete,'picks','not-requested','tradedPicks','not-requested')||
    CASE WHEN h.kind='detail' THEN jsonb_build_object('externalDraftId',h.external_draft_id,
      'catalog',public.draft_metadata_stored_facts(h.content_id,'catalog',h.external_draft_id),'detail',public.draft_metadata_stored_facts(h.content_id,'detail',h.external_draft_id))
    ELSE jsonb_build_object('totalCount',h.total_count,'validIdentityCount',h.valid_identity_count,'invalidIdentityCount',h.invalid_identity_count,
      'attemptedDetailCount',h.attempted_detail_count,'succeededDetailCount',h.succeeded_detail_count,'failedDetailCount',h.failed_detail_count,'unrequestedDetailCount',h.unrequested_detail_count,'reason',h.reason,
      'entries',(SELECT COALESCE(jsonb_agg(jsonb_build_object('sourceOrdinal',e.source_ordinal,'identityState',e.identity_state,'externalDraftId',e.external_draft_id,
        'metadata',CASE WHEN e.identity_state='valid' THEN public.draft_metadata_stored_facts(e.content_id,'catalog',e.external_draft_id) END,'detailState',e.detail_state) ORDER BY e.source_ordinal),'[]') FROM public.league_draft_metadata_entries e WHERE e.content_id=h.content_id)) END
  FROM public.league_draft_metadata_contents h WHERE h.content_id=p_content
$$;

CREATE FUNCTION public.capture_draft_metadata_typed(p_content uuid,p_receipt uuid,p_value jsonb)
RETURNS void LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE created uuid; item jsonb; fact jsonb; link jsonb; source_kind text; draft_identity uuid;
  content public.league_administration_contents%ROWTYPE;
BEGIN
  SELECT * INTO STRICT content FROM public.league_administration_contents WHERE id=p_content;
  INSERT INTO public.league_draft_metadata_contents(content_id,first_receipt_id,value_version,kind,external_draft_id,complete,total_count,
    valid_identity_count,invalid_identity_count,attempted_detail_count,succeeded_detail_count,failed_detail_count,unrequested_detail_count,reason)
    VALUES(p_content,p_receipt,'sleeper-draft-metadata-v1',p_value->>'kind',p_value->>'externalDraftId',(p_value->>'complete')::boolean,(p_value->>'totalCount')::integer,
      COALESCE((p_value->>'validIdentityCount')::integer,0),COALESCE((p_value->>'invalidIdentityCount')::integer,0),COALESCE((p_value->>'attemptedDetailCount')::integer,0),
      COALESCE((p_value->>'succeededDetailCount')::integer,0),COALESCE((p_value->>'failedDetailCount')::integer,0),COALESCE((p_value->>'unrequestedDetailCount')::integer,0),p_value->>'reason')
    ON CONFLICT DO NOTHING RETURNING content_id INTO created;
  IF created IS NOT NULL THEN
    IF p_value->>'kind'='catalog' THEN
      INSERT INTO public.league_draft_metadata_entries(content_id,source_ordinal,identity_state,external_draft_id,detail_state)
        SELECT p_content,(entry->>'sourceOrdinal')::integer,entry->>'identityState',entry->>'externalDraftId',entry->>'detailState'
        FROM jsonb_array_elements(p_value->'entries') entry;
    END IF;
    FOR item IN SELECT jsonb_build_object('source','catalog','fact',entry->'metadata') FROM jsonb_array_elements(COALESCE(p_value->'entries','[]')) entry WHERE entry->'metadata'<>'null'::jsonb
      UNION ALL SELECT jsonb_build_object('source',name,'fact',p_value->name) FROM unnest(ARRAY['catalog','detail']) name WHERE p_value->>'kind'='detail' LOOP
      fact:=item->'fact'; source_kind:=item->>'source';
      INSERT INTO public.league_season_drafts(league_season_id,provider,external_league_id,external_draft_id)
        VALUES(content.league_season_id,content.provider,content.external_league_id,fact->>'externalDraftId') ON CONFLICT DO NOTHING;
      SELECT id INTO STRICT draft_identity FROM public.league_season_drafts WHERE league_season_id=content.league_season_id
        AND provider=content.provider AND external_league_id=content.external_league_id AND external_draft_id=fact->>'externalDraftId';
      INSERT INTO public.league_draft_metadata_facts(content_id,source_kind,external_draft_id,draft_id,external_league_id,season,type_state,type_value,status_state,status_value,settings,metadata,native_fields,extensions)
        VALUES(p_content,source_kind,fact->>'externalDraftId',draft_identity,fact->>'externalLeagueId',2026,fact->'type'->>'state',fact->'type'->>'value',
          fact->'status'->>'state',fact->'status'->>'value',fact->'settings',fact->'metadata',
          fact-ARRAY['externalDraftId','externalLeagueId','season','settings','metadata','extensions','userSlots','slotRosters'],fact->'extensions');
      FOR link IN SELECT value FROM jsonb_array_elements(fact->'userSlots') LOOP
        INSERT INTO public.league_draft_metadata_user_slots(content_id,source_kind,external_draft_id,external_user_id,field_state,raw_value,draft_slot)
          VALUES(p_content,source_kind,fact->>'externalDraftId',link->>'externalUserId',link->'slot'->>'state',link->'slot'->'raw',(link->'slot'->>'value')::bigint);
      END LOOP;
      FOR link IN SELECT value FROM jsonb_array_elements(fact->'slotRosters') LOOP
        INSERT INTO public.league_draft_metadata_slot_rosters(content_id,source_kind,external_draft_id,slot_key,field_state,raw_value,external_roster_id)
          VALUES(p_content,source_kind,fact->>'externalDraftId',link->>'slotKey',link->'externalRosterId'->>'state',link->'externalRosterId'->'raw',link->'externalRosterId'->>'value');
      END LOOP;
    END LOOP;
  END IF;
  IF public.draft_metadata_typed_value(p_content) IS DISTINCT FROM p_value THEN RAISE EXCEPTION 'draft metadata typed materialization mismatch'; END IF;
END; $$;
CREATE FUNCTION public.validate_draft_metadata_typed_lineage()
RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE content public.league_administration_contents%ROWTYPE; expected jsonb; fence jsonb;
BEGIN
  SELECT * INTO STRICT content FROM public.league_administration_contents WHERE id=NEW.content_id;
  SELECT attempt.write_fence INTO STRICT fence FROM public.league_roster_capture_receipts receipt
    JOIN public.league_roster_resource_attempts attempt ON attempt.id=receipt.attempt_id WHERE receipt.id=NEW.first_receipt_id;
  IF fence IS NOT NULL THEN PERFORM public.assert_roster_player_link_fence(fence); END IF;
  IF NEW.capture_transaction<>pg_current_xact_id() OR NOT EXISTS(SELECT 1 FROM public.league_roster_capture_receipts receipt
    JOIN public.league_roster_resource_attempts attempt ON attempt.id=receipt.attempt_id
    JOIN public.league_roster_resource_scopes scope ON scope.id=attempt.scope_id
    JOIN public.league_seasons season ON season.id=scope.league_season_id
    WHERE receipt.id=NEW.first_receipt_id AND receipt.content_id=content.id AND scope.league_season_id=content.league_season_id AND season.season=2026
      AND scope.identity->'scope'->>'family'='drafts' AND scope.identity->'scope'->>'entityId'=CASE WHEN NEW.kind='catalog' THEN 'catalog' ELSE 'draft:'||NEW.external_draft_id END
      AND scope.identity->'scope'->'scoringPeriodId'='null'::jsonb
      AND scope.identity->'policy'=jsonb_build_object('audienceId','public','coverageSpecId','sleeper-draft-metadata-v1','canonicalNormalizerVersion','sleeper-draft-metadata-v1','validationVersion','latest-network-attempt-v1')
      AND content.provider='sleeper' AND content.family='drafts' AND content.week=0 AND content.normalizer_version='sleeper-administration-v1') THEN
    RAISE EXCEPTION 'draft metadata typed receipt lineage mismatch'; END IF;
  expected:=public.project_draft_metadata_native(content.payload,content.external_league_id,content.completeness='complete');
  IF expected IS NULL OR public.draft_metadata_typed_value(content.id) IS DISTINCT FROM expected THEN RAISE EXCEPTION 'draft metadata native parity mismatch'; END IF;
  IF EXISTS(SELECT 1 FROM public.league_draft_metadata_facts fact JOIN public.league_season_drafts identity ON identity.id=fact.draft_id
    WHERE fact.content_id=content.id AND (identity.league_season_id<>content.league_season_id OR identity.provider<>content.provider
      OR identity.external_league_id<>content.external_league_id OR identity.external_draft_id<>fact.external_draft_id)) THEN
    RAISE EXCEPTION 'draft canonical identity mismatch'; END IF;
  IF fence IS NOT NULL THEN PERFORM public.assert_roster_player_link_fence(fence); END IF;
  RETURN NEW;
END; $$;
CREATE FUNCTION public.guard_draft_metadata_child_insert()
RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
  IF NOT EXISTS(SELECT 1 FROM public.league_draft_metadata_contents header WHERE header.content_id=NEW.content_id
    AND header.capture_transaction=pg_current_xact_id()) THEN RAISE EXCEPTION 'draft metadata history cannot gain later facts'; END IF;
  RETURN NEW;
END; $$;
CREATE CONSTRAINT TRIGGER draft_metadata_typed_lineage AFTER INSERT ON public.league_draft_metadata_contents
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.validate_draft_metadata_typed_lineage();
DO $$ DECLARE name text; BEGIN
  FOREACH name IN ARRAY ARRAY['league_season_drafts','league_draft_metadata_contents','league_draft_metadata_entries','league_draft_metadata_facts','league_draft_metadata_user_slots','league_draft_metadata_slot_rosters'] LOOP
    EXECUTE format('CREATE TRIGGER draft_metadata_history_immutable BEFORE UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.prevent_league_administration_history_change()',name);
    IF name NOT IN ('league_season_drafts','league_draft_metadata_contents') THEN
      EXECUTE format('CREATE TRIGGER draft_metadata_child_insert BEFORE INSERT ON public.%I FOR EACH ROW EXECUTE FUNCTION public.guard_draft_metadata_child_insert()',name);
    END IF;
  END LOOP;
END; $$;
CREATE FUNCTION public.validate_draft_metadata_fence()
RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE fence jsonb; receipt_id uuid;
BEGIN
  IF TG_TABLE_NAME='league_roster_capture_receipts' THEN receipt_id:=NEW.id; ELSE receipt_id:=NEW.receipt_id; END IF;
  SELECT attempt.write_fence INTO fence FROM public.league_roster_capture_receipts receipt
    JOIN public.league_roster_resource_attempts attempt ON attempt.id=receipt.attempt_id JOIN public.league_roster_resource_scopes scope ON scope.id=attempt.scope_id
    WHERE receipt.id=receipt_id AND scope.identity->'scope'->>'family'='drafts';
  IF FOUND AND fence IS NOT NULL THEN PERFORM public.assert_roster_player_link_fence(fence); END IF;
  RETURN NEW;
END; $$;
CREATE CONSTRAINT TRIGGER draft_metadata_receipt_fence AFTER INSERT ON public.league_roster_capture_receipts
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.validate_draft_metadata_fence();
CREATE CONSTRAINT TRIGGER draft_metadata_acceptance_fence AFTER INSERT ON public.league_roster_resource_acceptances
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.validate_draft_metadata_fence();

-- Latest shared lineage body from 049: only draft mapping and two no-configuration family lists are extended.
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

CREATE FUNCTION public.begin_draft_metadata_attempt(p_mapping jsonb,p_resource jsonb,p_id uuid,p_fence jsonb DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE scope_row public.league_roster_resource_scopes%ROWTYPE;
  attempt public.league_roster_resource_attempts%ROWTYPE;
  head public.league_roster_resource_heads%ROWTYPE;
  identity_value jsonb;
BEGIN
  IF p_id IS NULL OR p_resource IS NULL OR NOT COALESCE(p_resource=jsonb_build_object('kind','catalog') OR (jsonb_typeof(p_resource->'externalDraftId')='string' AND p_resource->>'externalDraftId' ~ '^[A-Za-z0-9_-]{1,128}$' AND p_resource=jsonb_build_object('kind','detail','externalDraftId',p_resource->>'externalDraftId')),false) OR p_mapping->'scope'->>'season' IS DISTINCT FROM '2026' THEN RAISE EXCEPTION 'invalid current-season draft metadata scope'; END IF;
  IF p_fence IS NOT NULL THEN
    PERFORM 1 FROM public.projection_jobs job WHERE job.job_key=p_fence->>'jobKey' AND job.state='running'
      AND job.lease_owner=p_fence->>'workerId' AND job.attempt_count=(p_fence->>'generation')::integer
      AND job.lease_until>clock_timestamp() AND (p_fence->>'deadlineAt')::timestamptz>clock_timestamp() FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'draft metadata reservation writer fence is stale'; END IF;
  END IF;
  PERFORM public.validate_current_roster_mapping(p_mapping);
  identity_value:=jsonb_build_object('scope',jsonb_build_object('kind','enrolled-resource',
    'connectionId',p_mapping->>'connectionId','leagueSeasonId',p_mapping->>'leagueSeasonId',
    'family','drafts','entityId',CASE WHEN p_resource->>'kind'='catalog' THEN 'catalog' ELSE 'draft:'||(p_resource->>'externalDraftId') END,'scoringPeriodId',NULL,
    'audienceId','public','coverageSpecId','sleeper-draft-metadata-v1'),
    'policy',jsonb_build_object('audienceId','public','coverageSpecId','sleeper-draft-metadata-v1',
    'canonicalNormalizerVersion','sleeper-draft-metadata-v1','validationVersion','latest-network-attempt-v1'));
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
    RAISE EXCEPTION 'draft metadata reservation writer fence expired'; END IF;
  SELECT * INTO attempt FROM public.league_roster_resource_attempts WHERE id=p_id;
  IF FOUND THEN
    IF attempt.scope_id<>scope_row.id OR attempt.source_mapping IS DISTINCT FROM p_mapping
      OR attempt.write_fence IS DISTINCT FROM p_fence THEN RAISE EXCEPTION 'draft metadata attempt identity conflict'; END IF;
  ELSE
    UPDATE public.league_roster_resource_heads SET latest_ordinal=latest_ordinal+1
      WHERE scope_id=scope_row.id RETURNING * INTO head;
    INSERT INTO public.league_roster_resource_attempts(id,scope_id,ordinal,expected_generation,source_mapping,write_fence)
      VALUES(p_id,scope_row.id,head.latest_ordinal,head.generation,p_mapping,p_fence) RETURNING * INTO attempt;
  END IF;
  RETURN jsonb_build_object('id',attempt.id,'scopeId',attempt.scope_id,'ordinal',attempt.ordinal,
    'expectedGeneration',attempt.expected_generation);
END; $$;

-- Explicit CP16 source-only extension; older calls delegate unchanged.
ALTER FUNCTION public.record_league_administration_observation(jsonb) RENAME TO record_league_administration_observation_v52;
CREATE FUNCTION public.record_league_administration_observation(p_input jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE addition jsonb:=p_input->'draftMetadataAcceptance'; projection jsonb:=p_input->'draftMetadataProjection'; result jsonb; expected jsonb; token jsonb;
  attempt public.league_roster_resource_attempts%ROWTYPE; head public.league_roster_resource_heads%ROWTYPE;
  content public.league_administration_contents%ROWTYPE; receipt public.league_roster_capture_receipts%ROWTYPE;
  provenance jsonb:=p_input->'envelope'->'provenance'; resource_entity text; evidence_hash_value text;
  covered boolean:=false; acceptance_id uuid; prior_provenance jsonb; prior_content uuid; source_current boolean:=true; clock_key text;
BEGIN
  IF addition IS NULL THEN
    IF p_input ? 'draftMetadataProjection' THEN RAISE EXCEPTION 'draft projection requires metadata acceptance'; END IF;
    RETURN public.record_league_administration_observation_v52(p_input);
  END IF;
  IF p_input ?| ARRAY['rosterAcceptance','teamManagerAcceptance','teamManagerEvidenceAcceptance','leagueSettingsAcceptance','matchupAcceptance',
      'calendarEvidence','calculationCapture','transactionAcceptance','bracketAcceptance','bracketProjection','weeklyReportAcceptance','weeklyReportProjection','officialStandings']
    OR provenance ? 'acquisition' OR octet_length(p_input::text)>33488896 THEN RAISE EXCEPTION 'mixed or oversized draft metadata acceptance'; END IF;
  -- Timestamp casts alone admit locale/space forms rejected by the unchanged
  -- TypeScript normalizer. Require explicit ISO network clocks independently.
  IF jsonb_typeof(provenance) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'invalid draft metadata provenance'; END IF;
  FOREACH clock_key IN ARRAY ARRAY['requestStartedAt','requestCompletedAt','checkedAt','sourceObservedAt'] LOOP
    IF clock_key='sourceObservedAt' AND provenance->clock_key='null'::jsonb THEN CONTINUE; END IF;
    IF jsonb_typeof(provenance->clock_key) IS DISTINCT FROM 'string'
      OR provenance->>clock_key !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T([01][0-9]|2[0-4]):[0-5][0-9]:[0-5][0-9](\.[0-9]+)?(Z|[+-][0-9]{2}:[0-9]{2})$' THEN
      RAISE EXCEPTION 'invalid draft metadata ISO clock'; END IF;
    IF NOT isfinite((provenance->>clock_key)::timestamptz) THEN RAISE EXCEPTION 'nonfinite draft metadata clock'; END IF;
  END LOOP;
  IF p_input->'envelope'->>'family' IS DISTINCT FROM 'drafts' OR p_input->'envelope'->'week' IS DISTINCT FROM 'null'::jsonb
    OR p_input->'envelope'->'scope'->>'season' IS DISTINCT FROM '2026'
    OR p_input->'envelope'->'scope' IS DISTINCT FROM p_input->'sourceMapping'->'scope' OR p_input->'sourceMapping' IS NULL
    OR projection->>'version' IS DISTINCT FROM 'sleeper-draft-metadata-v1' OR projection->>'status' IS NULL OR projection->>'status' NOT IN ('accepted','rejected')
    OR p_input->'envelope'->'payload'->>'metadataVersion' IS DISTINCT FROM 'sleeper-draft-metadata-v1'
    OR p_input->'envelope'->'payload'->>'kind' IS NULL OR p_input->'envelope'->'payload'->>'kind' NOT IN ('catalog','detail')
    OR p_input->>'status' IS DISTINCT FROM 'rejected' OR p_input->'value' IS DISTINCT FROM 'null'::jsonb OR p_input->'semanticHash' IS DISTINCT FROM 'null'::jsonb
    OR jsonb_typeof(p_input->'diagnostics') IS DISTINCT FROM 'array' OR jsonb_array_length(p_input->'diagnostics')<>1
    OR p_input->'diagnostics'->0->>'code' IS DISTINCT FROM 'invalid_array' OR p_input->'diagnostics'->0->>'path' IS DISTINCT FROM 'payload'
    OR provenance->>'origin' IS DISTINCT FROM 'network'
    OR (provenance->>'requestStartedAt')::timestamptz IS NULL OR (provenance->>'requestCompletedAt')::timestamptz IS NULL
    OR ((provenance->>'sourceObservedAt')::timestamptz IS NULL AND projection->>'status'='accepted' AND projection->'value'->>'complete'='true')
    OR (provenance->>'checkedAt')::timestamptz IS NULL
    OR (provenance->>'requestStartedAt')::timestamptz>(provenance->>'requestCompletedAt')::timestamptz
    OR (provenance->>'requestCompletedAt')::timestamptz>(provenance->>'checkedAt')::timestamptz
    OR (provenance->>'sourceObservedAt')::timestamptz>(provenance->>'requestCompletedAt')::timestamptz
    OR (provenance->>'sourceObservedAt')::timestamptz<(provenance->>'requestStartedAt')::timestamptz
    OR (provenance->>'checkedAt')::timestamptz>clock_timestamp()+interval '5 minutes' THEN RAISE EXCEPTION 'invalid mapped draft metadata network capture'; END IF;
  resource_entity:=CASE WHEN p_input->'envelope'->'payload'->>'kind'='catalog' THEN 'catalog' ELSE 'draft:'||(p_input->'envelope'->'payload'->>'externalDraftId') END;
  IF resource_entity IS NULL THEN RAISE EXCEPTION 'missing draft resource identity'; END IF;
  -- Expanded JSON text conservatively bounds the compact stored reader. Tuple
  -- children are smaller than projected children; <=8 facts add bounded UUID,
  -- native-ID and header framing. Account separately for native league strings.
  IF octet_length((p_input->'envelope'->'payload')::text)+octet_length((projection->'value')::text)
    +octet_length((p_input->'sourceMapping')::text)+octet_length(provenance::text)+65536
    +8*octet_length((p_input->'envelope'->'scope'->'externalLeagueId')::text)>33554432 THEN
    RAISE EXCEPTION 'draft metadata persistence budget exceeded'; END IF;
  -- The prior writer owns job -> league/source -> legacy-head locking. Preserve
  -- that order before obtaining the typed resource head; all later failures roll
  -- back this same SQL transaction, including the delegated legacy observation.
  result:=public.record_league_administration_observation_v52(p_input-'draftMetadataAcceptance'-'draftMetadataProjection'-'sourceMapping');
  PERFORM public.validate_current_roster_mapping(p_input->'sourceMapping');
  token:=addition->'attempt';
  SELECT * INTO STRICT attempt FROM public.league_roster_resource_attempts WHERE id=(token->>'id')::uuid;
  IF (provenance->>'requestStartedAt')::timestamptz<attempt.reserved_at THEN RAISE EXCEPTION 'draft request predates reservation'; END IF;
  IF attempt.source_mapping IS DISTINCT FROM p_input->'sourceMapping' OR attempt.write_fence IS DISTINCT FROM p_input->'writeFence'
    OR token IS DISTINCT FROM jsonb_build_object('id',attempt.id,'scopeId',attempt.scope_id,'ordinal',attempt.ordinal,'expectedGeneration',attempt.expected_generation)
    OR NOT EXISTS(SELECT 1 FROM public.league_roster_resource_scopes scope WHERE scope.id=attempt.scope_id
      AND scope.identity=jsonb_build_object('scope',jsonb_build_object('kind','enrolled-resource','connectionId',attempt.source_mapping->>'connectionId',
        'leagueSeasonId',attempt.source_mapping->>'leagueSeasonId','family','drafts','entityId',resource_entity,'scoringPeriodId',NULL,
        'audienceId','public','coverageSpecId','sleeper-draft-metadata-v1'),'policy',jsonb_build_object('audienceId','public','coverageSpecId','sleeper-draft-metadata-v1',
        'canonicalNormalizerVersion','sleeper-draft-metadata-v1','validationVersion','latest-network-attempt-v1'))) THEN RAISE EXCEPTION 'draft metadata attempt scope mismatch'; END IF;
  SELECT * INTO STRICT head FROM public.league_roster_resource_heads WHERE scope_id=attempt.scope_id FOR UPDATE;
  IF attempt.write_fence IS NOT NULL THEN PERFORM public.assert_roster_player_link_fence(attempt.write_fence); END IF;
  evidence_hash_value:=encode(digest(convert_to(p_input::text,'UTF8'),'sha256'),'hex');
  SELECT * INTO receipt FROM public.league_roster_capture_receipts WHERE attempt_id=attempt.id;
  IF FOUND AND receipt.evidence_hash<>evidence_hash_value THEN RAISE EXCEPTION 'draft metadata attempt receipt conflict'; END IF;
  IF attempt.write_fence IS NOT NULL THEN PERFORM public.assert_roster_player_link_fence(attempt.write_fence); END IF;
  SELECT * INTO STRICT content FROM public.league_administration_contents stored
    WHERE stored.league_season_id=(attempt.source_mapping->>'leagueSeasonId')::uuid AND stored.provider='sleeper'
      AND stored.external_league_id=attempt.source_mapping->'scope'->>'externalLeagueId' AND stored.family='drafts' AND stored.week=0
      AND stored.normalizer_version='sleeper-administration-v1' AND stored.content_hash=p_input->>'contentHash'
      AND stored.completeness=p_input->'envelope'->>'completeness' AND NOT stored.accepted
      AND stored.payload=p_input->'envelope'->'payload' AND stored.normalized_value IS NOT DISTINCT FROM p_input->'value';
  IF projection->>'status'='accepted' THEN
    expected:=public.project_draft_metadata_native(content.payload,content.external_league_id,content.completeness='complete');
    IF expected IS NULL OR projection->'value' IS DISTINCT FROM expected OR projection->'diagnostics' IS DISTINCT FROM '[]'::jsonb THEN RAISE EXCEPTION 'draft metadata projection mismatch'; END IF;
    covered:=(expected->>'complete')::boolean;
  ELSIF projection->'value' IS DISTINCT FROM 'null'::jsonb OR jsonb_typeof(projection->'diagnostics') IS DISTINCT FROM 'array'
    OR jsonb_array_length(projection->'diagnostics')=0 THEN RAISE EXCEPTION 'invalid draft metadata rejection evidence'; END IF;
  IF receipt.id IS NOT NULL THEN
    IF receipt.content_id<>content.id THEN RAISE EXCEPTION 'draft replay content mismatch'; END IF;
    IF attempt.write_fence IS NOT NULL THEN PERFORM public.assert_roster_player_link_fence(attempt.write_fence); END IF;
    RETURN result||jsonb_build_object('draftMetadataAcceptance',jsonb_build_object('status',CASE WHEN EXISTS(
      SELECT 1 FROM public.league_roster_resource_acceptances accepted WHERE accepted.id=head.accepted_id AND accepted.receipt_id=receipt.id)
      THEN 'accepted' ELSE 'preserved' END,'reason','exact_receipt_replay','receiptId',receipt.id,'acceptedGeneration',head.generation));
  END IF;
  INSERT INTO public.league_roster_capture_receipts(attempt_id,content_id,legacy_observation_id,evidence_hash,provenance,coverage)
    VALUES(attempt.id,content.id,(result->>'observationId')::uuid,evidence_hash_value,provenance,
      jsonb_build_object('periodIds','[]'::jsonb,'interval',NULL,'entitySet',CASE WHEN covered THEN 'full' ELSE 'unknown' END,
        'fields','["draft_id","league_id","season","type","status","settings","draft_order","slot_to_roster_id","metadata","start_time","created","last_picked"]'::jsonb,
        'pagination',CASE WHEN covered THEN 'complete' ELSE 'unknown' END,'nextCursor',NULL,
        'completeness',CASE WHEN covered THEN 'complete' ELSE 'partial' END,
        'reasons',CASE WHEN covered THEN '[]'::jsonb ELSE '["draft_metadata_incomplete"]'::jsonb END)) RETURNING * INTO receipt;
  IF expected IS NOT NULL THEN PERFORM public.capture_draft_metadata_typed(content.id,receipt.id,expected); END IF;
  IF attempt.write_fence IS NOT NULL THEN PERFORM public.assert_roster_player_link_fence(attempt.write_fence); END IF;
  SELECT previous.provenance,previous.content_id INTO prior_provenance,prior_content FROM public.league_roster_resource_acceptances accepted
    JOIN public.league_roster_capture_receipts previous ON previous.id=accepted.receipt_id WHERE accepted.id=head.accepted_id;
  IF FOUND THEN source_current:=(provenance->>'sourceObservedAt')::timestamptz>(prior_provenance->>'sourceObservedAt')::timestamptz
    OR ((provenance->>'sourceObservedAt')::timestamptz=(prior_provenance->>'sourceObservedAt')::timestamptz AND content.id=prior_content); END IF;
  IF attempt.ordinal=head.latest_ordinal AND attempt.expected_generation=head.generation AND covered AND source_current THEN
    INSERT INTO public.league_roster_resource_acceptances(scope_id,receipt_id,source_mapping_revision_id,generation)
      VALUES(attempt.scope_id,receipt.id,(attempt.source_mapping->>'revisionId')::uuid,head.generation+1) RETURNING id INTO acceptance_id;
    UPDATE public.league_roster_resource_heads SET accepted_id=acceptance_id,generation=generation+1 WHERE scope_id=attempt.scope_id RETURNING * INTO head;
  END IF;
  IF attempt.write_fence IS NOT NULL THEN PERFORM public.assert_roster_player_link_fence(attempt.write_fence); END IF;
  RETURN result||jsonb_build_object('draftMetadataAcceptance',jsonb_build_object('status',CASE WHEN acceptance_id IS NULL THEN 'preserved' ELSE 'accepted' END,
    'reason',CASE WHEN acceptance_id IS NOT NULL THEN NULL WHEN attempt.ordinal<>head.latest_ordinal THEN 'newer_network_attempt_reserved'
      WHEN attempt.expected_generation<>head.generation THEN 'accepted_generation_changed' WHEN NOT covered THEN 'draft_metadata_incomplete' ELSE 'draft_metadata_source_not_newer' END,
    'receiptId',receipt.id,'acceptedGeneration',head.generation));
END; $$;

REVOKE ALL ON public.league_season_drafts,public.league_draft_metadata_contents,public.league_draft_metadata_entries,public.league_draft_metadata_facts,public.league_draft_metadata_user_slots,public.league_draft_metadata_slot_rosters FROM PUBLIC;
REVOKE ALL ON FUNCTION public.draft_metadata_owns(jsonb,text,text),public.draft_metadata_field(jsonb,text,text),public.draft_metadata_facts(jsonb),public.project_draft_metadata_native(jsonb,text,boolean),public.draft_metadata_stored_facts(uuid,text,text),public.draft_metadata_typed_value(uuid),public.capture_draft_metadata_typed(uuid,uuid,jsonb),public.validate_draft_metadata_typed_lineage(),public.guard_draft_metadata_child_insert(),public.validate_draft_metadata_fence(),public.record_league_administration_observation_v52(jsonb),public.begin_draft_metadata_attempt(jsonb,jsonb,uuid,jsonb),public.record_league_administration_observation(jsonb) FROM PUBLIC;
DO $$ BEGIN
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='league_one_runtime') THEN
    REVOKE ALL ON public.league_season_drafts,public.league_draft_metadata_contents,public.league_draft_metadata_entries,public.league_draft_metadata_facts,public.league_draft_metadata_user_slots,public.league_draft_metadata_slot_rosters FROM league_one_runtime;
    GRANT SELECT ON public.league_season_drafts,public.league_draft_metadata_contents,public.league_draft_metadata_entries,public.league_draft_metadata_facts,public.league_draft_metadata_user_slots,public.league_draft_metadata_slot_rosters TO league_one_runtime;
    REVOKE ALL ON FUNCTION public.draft_metadata_owns(jsonb,text,text),public.draft_metadata_field(jsonb,text,text),public.draft_metadata_facts(jsonb),public.project_draft_metadata_native(jsonb,text,boolean),public.draft_metadata_stored_facts(uuid,text,text),public.draft_metadata_typed_value(uuid),public.capture_draft_metadata_typed(uuid,uuid,jsonb),public.validate_draft_metadata_typed_lineage(),public.guard_draft_metadata_child_insert(),public.validate_draft_metadata_fence(),public.record_league_administration_observation_v52(jsonb) FROM league_one_runtime;
    GRANT EXECUTE ON FUNCTION public.begin_draft_metadata_attempt(jsonb,jsonb,uuid,jsonb),public.record_league_administration_observation(jsonb) TO league_one_runtime;
  END IF;
END; $$;
