-- CP17 opt-in draft selections. No intake, scheduler, deployment or backfill.
-- Canonical selection identity is draft + native pick_no; source ordinal is evidence.
CREATE FUNCTION public.draft_selection_field(p_row jsonb,p_key text,p_kind text)
RETURNS jsonb LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE raw jsonb:=p_row->p_key; parsed jsonb;
  js_whitespace text:=E' \t\n\r\f'||chr(11)||chr(160)||chr(5760)||chr(8192)||chr(8193)||chr(8194)||chr(8195)||chr(8196)||chr(8197)||chr(8198)||chr(8199)||chr(8200)||chr(8201)||chr(8202)||chr(8232)||chr(8233)||chr(8239)||chr(8287)||chr(12288)||chr(65279);
BEGIN
  IF jsonb_typeof(p_row) IS DISTINCT FROM 'object' OR NOT p_row ? p_key THEN RETURN jsonb_build_object('state','missing','raw',NULL,'value',NULL); END IF;
  IF raw='null'::jsonb THEN RETURN jsonb_build_object('state','null','raw',NULL,'value',NULL); END IF;
  IF p_kind='boolean' AND jsonb_typeof(raw)='boolean' THEN parsed:=raw;
  ELSIF p_kind='player' AND jsonb_typeof(raw)='string' AND length(raw#>>'{}') BETWEEN 1 AND 128
    AND btrim(raw#>>'{}',js_whitespace)=raw#>>'{}' AND raw#>>'{}' !~ E'[\\x01-\\x1f\\x7f]' THEN parsed:=raw;
  ELSIF p_kind='draft' AND jsonb_typeof(raw)='string' AND raw#>>'{}' ~ '^[A-Za-z0-9_-]{1,128}$' THEN parsed:=raw;
  ELSIF p_kind NOT IN ('boolean','player','draft') THEN RETURN public.draft_metadata_field(p_row,p_key,p_kind); END IF;
  RETURN jsonb_build_object('state',CASE WHEN parsed IS NULL THEN 'invalid' ELSE 'supplied' END,'raw',raw,'value',parsed);
END; $$;
CREATE FUNCTION public.draft_selection_facts(p_row jsonb,p_ordinal integer,p_draft text,p_league text,p_duplicate boolean)
RETURNS jsonb LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE pick_field jsonb:=public.draft_selection_field(p_row,'pick_no','slot'); state_value text;
BEGIN
  state_value:=CASE WHEN jsonb_typeof(p_row)='object' AND ((p_row ? 'draft_id' AND p_row->'draft_id' IS DISTINCT FROM to_jsonb(p_draft))
      OR (p_row ? 'league_id' AND p_row->'league_id' IS DISTINCT FROM to_jsonb(p_league))
      OR (p_row ? 'season' AND p_row->'season' IS DISTINCT FROM '"2026"'::jsonb)
      OR (p_row ? 'sport' AND p_row->'sport' IS DISTINCT FROM '"nfl"'::jsonb)) THEN 'conflict'
    WHEN jsonb_typeof(p_row) IS DISTINCT FROM 'object' OR pick_field->>'state'<>'supplied' THEN 'invalid'
    WHEN p_duplicate THEN 'duplicate' ELSE 'valid' END;
  RETURN jsonb_build_object('sourceOrdinal',p_ordinal,'identityState',state_value,'externalDraftId',p_draft,
    'pickNumber',pick_field,'round',public.draft_selection_field(p_row,'round','slot'),'draftSlot',public.draft_selection_field(p_row,'draft_slot','slot'),
    'playerId',public.draft_selection_field(p_row,'player_id','player'),'rosterId',public.draft_selection_field(p_row,'roster_id','roster'),
    'pickedBy',public.draft_selection_field(p_row,'picked_by','text'),'isKeeper',public.draft_selection_field(p_row,'is_keeper','boolean'),
    'metadata',public.draft_selection_field(p_row,'metadata','object'),'nativeDraftId',public.draft_selection_field(p_row,'draft_id','draft'),
    'extensions',CASE WHEN jsonb_typeof(p_row)='object' THEN p_row-ARRAY['pick_no','round','draft_slot','player_id','roster_id','picked_by','is_keeper','metadata','draft_id'] ELSE '{}'::jsonb END,'raw',p_row);
END; $$;
CREATE FUNCTION public.project_draft_selections_native(p_payload jsonb,p_league text,p_complete boolean)
RETURNS jsonb LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE row_value jsonb; entries jsonb:='[]'; outcomes jsonb:='{}'; frequencies jsonb:='{}'; native_id text;
  total integer; valid_count integer:=0; succeeded integer:=0; failed integer:=0; complete boolean; result jsonb;
  source_body jsonb; node_count integer; deepest integer; picks_state text; reason_value text;
BEGIN
  IF p_payload->>'selectionsVersion' IS DISTINCT FROM 'sleeper-draft-selections-v1' OR octet_length(p_payload::text)>8454144 THEN RETURN NULL; END IF;
  FOR source_body IN SELECT p_payload->'catalog' UNION ALL SELECT p_payload->'picks' WHERE p_payload->>'kind'='selections' LOOP
    WITH RECURSIVE nodes(value,depth) AS (
      SELECT source_body,1 UNION ALL
      SELECT child.value,nodes.depth+1 FROM nodes CROSS JOIN LATERAL (
        SELECT value FROM jsonb_array_elements(CASE WHEN jsonb_typeof(nodes.value)='array' THEN nodes.value ELSE '[]'::jsonb END)
        UNION ALL SELECT value FROM jsonb_each(CASE WHEN jsonb_typeof(nodes.value)='object' THEN nodes.value ELSE '{}'::jsonb END)
      ) child WHERE nodes.depth<65
    ) SELECT count(*),max(depth) INTO node_count,deepest FROM (SELECT depth FROM nodes LIMIT 250001) bounded;
    IF node_count>250000 OR deepest>64 THEN RETURN NULL; END IF;
  END LOOP;
  IF p_payload->>'kind'='selections' THEN
    native_id:=p_payload->>'externalDraftId';
    IF jsonb_typeof(p_payload->'externalDraftId') IS DISTINCT FROM 'string' OR native_id !~ '^[A-Za-z0-9_-]{1,128}$'
      OR NOT public.draft_metadata_owns(p_payload->'catalog',p_league,native_id) THEN RETURN NULL; END IF;
    picks_state:=CASE WHEN NOT p_payload ? 'picks' THEN 'missing' WHEN p_payload->'picks'='null'::jsonb THEN 'null'
      WHEN jsonb_typeof(p_payload->'picks')<>'array' THEN 'invalid' WHEN jsonb_array_length(p_payload->'picks')=0 THEN 'empty' ELSE 'supplied' END;
    IF jsonb_typeof(p_payload->'picks')='array' THEN
      total:=jsonb_array_length(p_payload->'picks');
      IF total>10000 THEN RETURN NULL; END IF;
      SELECT COALESCE(jsonb_agg(public.draft_selection_facts(value,(ordinality-1)::integer,native_id,p_league,frequency>1) ORDER BY ordinality),'[]') INTO entries
        FROM (SELECT value,ordinality,count(*) OVER(PARTITION BY public.draft_selection_field(value,'pick_no','slot')->'value') AS frequency
          FROM jsonb_array_elements(p_payload->'picks') WITH ORDINALITY) native_entries;
      SELECT count(*) INTO valid_count FROM jsonb_array_elements(entries) entry WHERE entry->>'identityState'='valid';
    END IF;
    complete:=total IS NOT NULL AND total=valid_count AND p_complete;
    reason_value:=CASE WHEN total IS NULL THEN 'draft-selections-invalid-picks' WHEN valid_count<>total THEN 'draft-selections-invalid-identities'
      WHEN NOT p_complete THEN 'draft-selections-source-partial' ELSE NULL END;
    result:=jsonb_build_object('kind','selections','season',2026,'externalDraftId',native_id,'complete',complete,'picksState',picks_state,
      'totalCount',total,'entries',entries,'reason',reason_value,'tradedPicks','not-requested');
  ELSIF p_payload->>'kind'='catalog' THEN
    IF jsonb_typeof(p_payload->'selections') IS DISTINCT FROM 'array' OR jsonb_array_length(p_payload->'selections')>8
      OR NOT COALESCE(p_payload->'reason'='null'::jsonb OR jsonb_typeof(p_payload->'reason')='string',false) THEN RETURN NULL; END IF;
    IF jsonb_typeof(p_payload->'catalog')='array' THEN
      total:=jsonb_array_length(p_payload->'catalog');
      SELECT COALESCE(jsonb_object_agg(counts.id,counts.amount),'{}') INTO frequencies FROM (
        SELECT candidate->>'draft_id' AS id,count(*) AS amount FROM jsonb_array_elements(p_payload->'catalog') candidate
          WHERE public.draft_metadata_owns(candidate,p_league) GROUP BY candidate->>'draft_id') counts;
    END IF;
    FOR row_value IN SELECT value FROM jsonb_array_elements(p_payload->'selections') LOOP
      native_id:=row_value->>'externalDraftId';
      IF jsonb_typeof(row_value->'externalDraftId') IS DISTINCT FROM 'string' OR native_id !~ '^[A-Za-z0-9_-]{1,128}$'
        OR outcomes ? native_id OR row_value->>'state' IS NULL OR row_value->>'state' NOT IN ('succeeded','failed','unrequested')
        OR total IS NULL OR COALESCE((frequencies->>native_id)::integer,0)<>1
        OR (total>8 AND row_value->>'state'<>'unrequested') THEN RETURN NULL; END IF;
      outcomes:=outcomes||jsonb_build_object(native_id,row_value->'state');
    END LOOP;
    IF total IS NOT NULL THEN
      SELECT COALESCE(jsonb_agg(jsonb_build_object('sourceOrdinal',ordinality-1,'identityState',CASE WHEN valid THEN 'valid' ELSE 'invalid' END,
        'externalDraftId',id,'selectionState',CASE WHEN valid THEN COALESCE(outcomes->>id,'unrequested') ELSE 'unrequested' END) ORDER BY ordinality),'[]') INTO entries
      FROM (SELECT value,ordinality,CASE WHEN jsonb_typeof(value->'draft_id')='string' AND value->>'draft_id' ~ '^[A-Za-z0-9_-]{1,128}$' THEN value->>'draft_id' END AS id,
        public.draft_metadata_owns(value,p_league) AND COALESCE((frequencies->>(value->>'draft_id'))::integer,0)=1 AS valid
        FROM jsonb_array_elements(p_payload->'catalog') WITH ORDINALITY) native_entries;
      SELECT count(*) FILTER(WHERE value->>'identityState'='valid'),count(*) FILTER(WHERE value->>'selectionState'='succeeded'),count(*) FILTER(WHERE value->>'selectionState'='failed')
        INTO valid_count,succeeded,failed FROM jsonb_array_elements(entries);
    END IF;
    complete:=total IS NOT NULL AND total<=8 AND total=valid_count AND p_complete;
    IF complete AND p_payload->'reason'<>'null'::jsonb AND p_payload->>'reason'<>'metadata-source-partial' THEN RETURN NULL; END IF;
    result:=jsonb_build_object('kind','catalog','season',2026,'complete',complete,'totalCount',total,'validIdentityCount',valid_count,
      'invalidIdentityCount',COALESCE(total,0)-valid_count,'attemptedSelectionCount',succeeded+failed,'succeededSelectionCount',succeeded,'failedSelectionCount',failed,
      'unrequestedSelectionCount',COALESCE(total,0)-succeeded-failed,'entries',entries,'reason',p_payload->'reason','tradedPicks','not-requested');
  END IF;
  IF octet_length(result::text)>33488896 THEN RETURN NULL; END IF;
  RETURN result;
END; $$;

CREATE TABLE public.league_draft_selections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),draft_id uuid NOT NULL REFERENCES public.league_season_drafts(id),
  native_pick_number bigint NOT NULL CHECK(native_pick_number BETWEEN 1 AND 9007199254740991),UNIQUE(draft_id,native_pick_number)
);
CREATE TABLE public.league_draft_selection_contents (
  content_id uuid PRIMARY KEY REFERENCES public.league_administration_contents(id),first_receipt_id uuid NOT NULL REFERENCES public.league_roster_capture_receipts(id),
  capture_transaction xid8 NOT NULL DEFAULT pg_current_xact_id(),value_version text NOT NULL CHECK(value_version='sleeper-draft-selections-v1'),
  kind text NOT NULL CHECK(kind IN ('catalog','selections')),external_draft_id text,complete boolean NOT NULL,
  picks_state text CHECK(picks_state IN ('missing','null','empty','invalid','supplied')),total_count integer CHECK(total_count>=0),
  valid_identity_count integer NOT NULL CHECK(valid_identity_count>=0),invalid_identity_count integer NOT NULL CHECK(invalid_identity_count>=0),
  attempted_selection_count integer NOT NULL CHECK(attempted_selection_count BETWEEN 0 AND 8),succeeded_selection_count integer NOT NULL CHECK(succeeded_selection_count BETWEEN 0 AND 8),
  failed_selection_count integer NOT NULL CHECK(failed_selection_count BETWEEN 0 AND 8),unrequested_selection_count integer NOT NULL CHECK(unrequested_selection_count>=0),reason text,
  CHECK((kind='selections')=(external_draft_id IS NOT NULL)),CHECK((kind='selections')=(picks_state IS NOT NULL)),
  CHECK(attempted_selection_count=succeeded_selection_count+failed_selection_count),
  CHECK(kind='selections' OR (COALESCE(total_count,0)=valid_identity_count+invalid_identity_count AND COALESCE(total_count,0)=attempted_selection_count+unrequested_selection_count))
);
CREATE TABLE public.league_draft_selection_catalog_entries (
  content_id uuid NOT NULL REFERENCES public.league_draft_selection_contents(content_id),source_ordinal integer NOT NULL CHECK(source_ordinal>=0),
  identity_state text NOT NULL CHECK(identity_state IN ('valid','invalid')),external_draft_id text,selection_state text NOT NULL CHECK(selection_state IN ('succeeded','failed','unrequested')),
  PRIMARY KEY(content_id,source_ordinal),CHECK(identity_state<>'valid' OR external_draft_id IS NOT NULL)
);
CREATE TABLE public.league_draft_selection_entries (
  content_id uuid NOT NULL REFERENCES public.league_draft_selection_contents(content_id),source_ordinal integer NOT NULL CHECK(source_ordinal BETWEEN 0 AND 9999),
  identity_state text NOT NULL CHECK(identity_state IN ('valid','invalid','duplicate','conflict')),external_draft_id text NOT NULL,
  draft_id uuid NOT NULL REFERENCES public.league_season_drafts(id),selection_id uuid REFERENCES public.league_draft_selections(id),
  pick_number bigint CHECK(pick_number BETWEEN 1 AND 9007199254740991),round_value bigint CHECK(round_value BETWEEN 1 AND 9007199254740991),
  draft_slot bigint CHECK(draft_slot BETWEEN 1 AND 9007199254740991),player_id text,external_roster_id text,season_team_id uuid REFERENCES public.league_season_teams(id),
  picked_by text,is_keeper boolean,native_fields jsonb NOT NULL,metadata jsonb NOT NULL,extensions jsonb NOT NULL,raw jsonb NOT NULL,
  PRIMARY KEY(content_id,source_ordinal),UNIQUE(content_id,selection_id),
  CHECK((identity_state='valid')=(selection_id IS NOT NULL)),CHECK((identity_state='valid' AND external_roster_id IS NOT NULL)=(season_team_id IS NOT NULL))
);
CREATE INDEX draft_selection_team_idx ON public.league_draft_selection_entries(season_team_id,content_id) WHERE season_team_id IS NOT NULL;
CREATE INDEX draft_selection_identity_history_idx ON public.league_draft_selection_entries(selection_id,content_id) WHERE selection_id IS NOT NULL;
CREATE FUNCTION public.draft_selections_typed_value(p_content uuid)
RETURNS jsonb LANGUAGE sql STABLE SET search_path=pg_catalog,public,pg_temp AS $$
  SELECT jsonb_build_object('kind',h.kind,'season',2026,'complete',h.complete,'totalCount',h.total_count,'reason',h.reason,'tradedPicks','not-requested')||
    CASE WHEN h.kind='catalog' THEN jsonb_build_object('validIdentityCount',h.valid_identity_count,'invalidIdentityCount',h.invalid_identity_count,
      'attemptedSelectionCount',h.attempted_selection_count,'succeededSelectionCount',h.succeeded_selection_count,'failedSelectionCount',h.failed_selection_count,
      'unrequestedSelectionCount',h.unrequested_selection_count,'entries',(SELECT COALESCE(jsonb_agg(jsonb_build_object('sourceOrdinal',e.source_ordinal,
        'identityState',e.identity_state,'externalDraftId',e.external_draft_id,'selectionState',e.selection_state) ORDER BY e.source_ordinal),'[]')
        FROM public.league_draft_selection_catalog_entries e WHERE e.content_id=h.content_id))
    ELSE jsonb_build_object('externalDraftId',h.external_draft_id,'picksState',h.picks_state,'entries',(SELECT COALESCE(jsonb_agg(e.native_fields||jsonb_build_object(
      'sourceOrdinal',e.source_ordinal,'identityState',e.identity_state,'externalDraftId',e.external_draft_id,
      'pickNumber',(e.native_fields->'pickNumber')||jsonb_build_object('value',e.pick_number),
      'round',(e.native_fields->'round')||jsonb_build_object('value',e.round_value),
      'draftSlot',(e.native_fields->'draftSlot')||jsonb_build_object('value',e.draft_slot),
      'playerId',(e.native_fields->'playerId')||jsonb_build_object('value',e.player_id),
      'rosterId',(e.native_fields->'rosterId')||jsonb_build_object('value',e.external_roster_id),
      'pickedBy',(e.native_fields->'pickedBy')||jsonb_build_object('value',e.picked_by),
      'isKeeper',(e.native_fields->'isKeeper')||jsonb_build_object('value',e.is_keeper),
      'metadata',e.metadata,'extensions',e.extensions,'raw',e.raw) ORDER BY e.source_ordinal),'[]')
      FROM public.league_draft_selection_entries e WHERE e.content_id=h.content_id)) END
  FROM public.league_draft_selection_contents h WHERE h.content_id=p_content
$$;
CREATE FUNCTION public.capture_draft_selections_typed(p_content uuid,p_receipt uuid,p_value jsonb)
RETURNS void LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE created uuid; draft_identity uuid; content public.league_administration_contents%ROWTYPE;
BEGIN
  SELECT * INTO STRICT content FROM public.league_administration_contents WHERE id=p_content;
  INSERT INTO public.league_draft_selection_contents(content_id,first_receipt_id,value_version,kind,external_draft_id,complete,picks_state,total_count,
    valid_identity_count,invalid_identity_count,attempted_selection_count,succeeded_selection_count,failed_selection_count,unrequested_selection_count,reason)
  VALUES(p_content,p_receipt,'sleeper-draft-selections-v1',p_value->>'kind',p_value->>'externalDraftId',(p_value->>'complete')::boolean,p_value->>'picksState',(p_value->>'totalCount')::integer,
    COALESCE((p_value->>'validIdentityCount')::integer,0),COALESCE((p_value->>'invalidIdentityCount')::integer,0),COALESCE((p_value->>'attemptedSelectionCount')::integer,0),
    COALESCE((p_value->>'succeededSelectionCount')::integer,0),COALESCE((p_value->>'failedSelectionCount')::integer,0),COALESCE((p_value->>'unrequestedSelectionCount')::integer,0),p_value->>'reason')
    ON CONFLICT DO NOTHING RETURNING content_id INTO created;
  IF created IS NOT NULL THEN
    IF p_value->>'kind'='catalog' THEN
      INSERT INTO public.league_draft_selection_catalog_entries(content_id,source_ordinal,identity_state,external_draft_id,selection_state)
        SELECT p_content,(entry->>'sourceOrdinal')::integer,entry->>'identityState',entry->>'externalDraftId',entry->>'selectionState' FROM jsonb_array_elements(p_value->'entries') entry;
    ELSE
      INSERT INTO public.league_season_drafts(league_season_id,provider,external_league_id,external_draft_id)
        VALUES(content.league_season_id,content.provider,content.external_league_id,p_value->>'externalDraftId') ON CONFLICT DO NOTHING;
      SELECT id INTO STRICT draft_identity FROM public.league_season_drafts WHERE league_season_id=content.league_season_id
        AND provider=content.provider AND external_league_id=content.external_league_id AND external_draft_id=p_value->>'externalDraftId';
      -- Materialize bounded batches; canonical keys never include correction fields or source order.
      -- Ambiguous/foreign rows retain native roster facts without creating or binding local teams.
      INSERT INTO public.league_draft_selections(draft_id,native_pick_number)
        SELECT draft_identity,(item->'pickNumber'->>'value')::bigint FROM jsonb_array_elements(p_value->'entries') item
          WHERE item->>'identityState'='valid' ON CONFLICT DO NOTHING;
      INSERT INTO public.league_season_teams(league_season_id,provider,external_league_id,external_roster_id)
        SELECT DISTINCT content.league_season_id,content.provider,content.external_league_id,item->'rosterId'->>'value'
          FROM jsonb_array_elements(p_value->'entries') item WHERE item->>'identityState'='valid' AND item->'rosterId'->>'value' IS NOT NULL ON CONFLICT DO NOTHING;
      INSERT INTO public.league_draft_selection_entries(content_id,source_ordinal,identity_state,external_draft_id,draft_id,selection_id,pick_number,round_value,draft_slot,
        player_id,external_roster_id,season_team_id,picked_by,is_keeper,native_fields,metadata,extensions,raw)
        SELECT p_content,(item->>'sourceOrdinal')::integer,item->>'identityState',item->>'externalDraftId',draft_identity,selection.id,(item->'pickNumber'->>'value')::bigint,
          (item->'round'->>'value')::bigint,(item->'draftSlot'->>'value')::bigint,item->'playerId'->>'value',item->'rosterId'->>'value',team.id,
          item->'pickedBy'->>'value',(item->'isKeeper'->>'value')::boolean,item-ARRAY['sourceOrdinal','identityState','externalDraftId','metadata','extensions','raw'],item->'metadata',item->'extensions',item->'raw'
        FROM jsonb_array_elements(p_value->'entries') item LEFT JOIN public.league_draft_selections selection
          ON item->>'identityState'='valid' AND selection.draft_id=draft_identity AND selection.native_pick_number=(item->'pickNumber'->>'value')::bigint
        LEFT JOIN public.league_season_teams team ON item->>'identityState'='valid' AND team.league_season_id=content.league_season_id AND team.provider=content.provider
          AND team.external_league_id=content.external_league_id AND team.external_roster_id=item->'rosterId'->>'value';
    END IF;
  END IF;
  IF public.draft_selections_typed_value(p_content) IS DISTINCT FROM p_value THEN RAISE EXCEPTION 'draft selections typed materialization mismatch'; END IF;
END; $$;

CREATE FUNCTION public.validate_draft_selections_typed_lineage()
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
      AND scope.identity->'scope'->>'family'='drafts' AND scope.identity->'scope'->>'entityId'=CASE WHEN NEW.kind='catalog' THEN 'catalog' ELSE 'draft:'||NEW.external_draft_id||':selections' END
      AND scope.identity->'scope'->'scoringPeriodId'='null'::jsonb
      AND scope.identity->'policy'=jsonb_build_object('audienceId','public','coverageSpecId','sleeper-draft-selections-v1','canonicalNormalizerVersion','sleeper-draft-selections-v1','validationVersion','latest-network-attempt-v1')
      AND content.provider='sleeper' AND content.family='drafts' AND content.week=0 AND content.normalizer_version='sleeper-administration-v1') THEN
    RAISE EXCEPTION 'draft selections typed receipt lineage mismatch'; END IF;
  expected:=public.project_draft_selections_native(content.payload,content.external_league_id,content.completeness='complete');
  IF expected IS NULL OR public.draft_selections_typed_value(content.id) IS DISTINCT FROM expected THEN RAISE EXCEPTION 'draft selections native parity mismatch'; END IF;
  IF EXISTS(SELECT 1 FROM public.league_draft_selection_entries entry JOIN public.league_season_drafts draft ON draft.id=entry.draft_id
    LEFT JOIN public.league_draft_selections selection ON selection.id=entry.selection_id
    LEFT JOIN public.league_season_teams team ON team.id=entry.season_team_id
    WHERE entry.content_id=content.id AND (draft.league_season_id<>content.league_season_id OR draft.provider<>content.provider
      OR draft.external_league_id<>content.external_league_id OR draft.external_draft_id<>entry.external_draft_id
      OR selection.draft_id<>draft.id OR selection.native_pick_number<>entry.pick_number
      OR team.league_season_id<>content.league_season_id OR team.provider<>content.provider
      OR team.external_league_id<>content.external_league_id OR team.external_roster_id<>entry.external_roster_id)) THEN
    RAISE EXCEPTION 'draft selection canonical identity mismatch'; END IF;
  IF fence IS NOT NULL THEN PERFORM public.assert_roster_player_link_fence(fence); END IF;
  RETURN NEW;
END; $$;
CREATE FUNCTION public.guard_draft_selections_child_insert()
RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
  IF NOT EXISTS(SELECT 1 FROM public.league_draft_selection_contents header WHERE header.content_id=NEW.content_id
    AND header.capture_transaction=pg_current_xact_id()) THEN RAISE EXCEPTION 'draft selections history cannot gain later facts'; END IF;
  RETURN NEW;
END; $$;
CREATE CONSTRAINT TRIGGER draft_selections_typed_lineage AFTER INSERT ON public.league_draft_selection_contents
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.validate_draft_selections_typed_lineage();
DO $$ DECLARE name text; BEGIN
  FOREACH name IN ARRAY ARRAY['league_draft_selections','league_draft_selection_contents','league_draft_selection_catalog_entries','league_draft_selection_entries'] LOOP
    EXECUTE format('CREATE TRIGGER draft_selections_history_immutable BEFORE UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.prevent_league_administration_history_change()',name);
    IF name NOT IN ('league_draft_selections','league_draft_selection_contents') THEN
      EXECUTE format('CREATE TRIGGER draft_selections_child_insert BEFORE INSERT ON public.%I FOR EACH ROW EXECUTE FUNCTION public.guard_draft_selections_child_insert()',name);
    END IF;
  END LOOP;
END; $$;
CREATE FUNCTION public.validate_draft_selections_fence()
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
CREATE CONSTRAINT TRIGGER draft_selections_receipt_fence AFTER INSERT ON public.league_roster_capture_receipts
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.validate_draft_selections_fence();
CREATE CONSTRAINT TRIGGER draft_selections_acceptance_fence AFTER INSERT ON public.league_roster_resource_acceptances
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.validate_draft_selections_fence();


CREATE FUNCTION public.begin_draft_selections_attempt(p_mapping jsonb,p_resource jsonb,p_id uuid,p_fence jsonb DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE scope_row public.league_roster_resource_scopes%ROWTYPE;
  attempt public.league_roster_resource_attempts%ROWTYPE;
  head public.league_roster_resource_heads%ROWTYPE;
  identity_value jsonb;
BEGIN
  IF p_id IS NULL OR p_resource IS NULL OR NOT COALESCE(p_resource=jsonb_build_object('kind','catalog') OR (jsonb_typeof(p_resource->'externalDraftId')='string' AND p_resource->>'externalDraftId' ~ '^[A-Za-z0-9_-]{1,128}$' AND p_resource=jsonb_build_object('kind','selections','externalDraftId',p_resource->>'externalDraftId')),false) OR p_mapping->'scope'->>'season' IS DISTINCT FROM '2026' THEN RAISE EXCEPTION 'invalid current-season draft selections scope'; END IF;
  IF p_fence IS NOT NULL THEN
    PERFORM 1 FROM public.projection_jobs job WHERE job.job_key=p_fence->>'jobKey' AND job.state='running'
      AND job.lease_owner=p_fence->>'workerId' AND job.attempt_count=(p_fence->>'generation')::integer
      AND job.lease_until>clock_timestamp() AND (p_fence->>'deadlineAt')::timestamptz>clock_timestamp() FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'draft selections reservation writer fence is stale'; END IF;
  END IF;
  PERFORM public.validate_current_roster_mapping(p_mapping);
  identity_value:=jsonb_build_object('scope',jsonb_build_object('kind','enrolled-resource',
    'connectionId',p_mapping->>'connectionId','leagueSeasonId',p_mapping->>'leagueSeasonId',
    'family','drafts','entityId',CASE WHEN p_resource->>'kind'='catalog' THEN 'catalog' ELSE 'draft:'||(p_resource->>'externalDraftId')||':selections' END,'scoringPeriodId',NULL,
    'audienceId','public','coverageSpecId','sleeper-draft-selections-v1'),
    'policy',jsonb_build_object('audienceId','public','coverageSpecId','sleeper-draft-selections-v1',
    'canonicalNormalizerVersion','sleeper-draft-selections-v1','validationVersion','latest-network-attempt-v1'));
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
    RAISE EXCEPTION 'draft selections reservation writer fence expired'; END IF;
  SELECT * INTO attempt FROM public.league_roster_resource_attempts WHERE id=p_id;
  IF FOUND THEN
    IF attempt.scope_id<>scope_row.id OR attempt.source_mapping IS DISTINCT FROM p_mapping
      OR attempt.write_fence IS DISTINCT FROM p_fence THEN RAISE EXCEPTION 'draft selections attempt identity conflict'; END IF;
  ELSE
    UPDATE public.league_roster_resource_heads SET latest_ordinal=latest_ordinal+1
      WHERE scope_id=scope_row.id RETURNING * INTO head;
    INSERT INTO public.league_roster_resource_attempts(id,scope_id,ordinal,expected_generation,source_mapping,write_fence)
      VALUES(p_id,scope_row.id,head.latest_ordinal,head.generation,p_mapping,p_fence) RETURNING * INTO attempt;
  END IF;
  RETURN jsonb_build_object('id',attempt.id,'scopeId',attempt.scope_id,'ordinal',attempt.ordinal,
    'expectedGeneration',attempt.expected_generation);
END; $$;


-- Explicit CP17 source-only extension; older calls delegate unchanged.
ALTER FUNCTION public.record_league_administration_observation(jsonb) RENAME TO record_league_administration_observation_v53;
CREATE FUNCTION public.record_league_administration_observation(p_input jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE addition jsonb:=p_input->'draftSelectionsAcceptance'; projection jsonb:=p_input->'draftSelectionsProjection'; result jsonb; expected jsonb; token jsonb;
  attempt public.league_roster_resource_attempts%ROWTYPE; head public.league_roster_resource_heads%ROWTYPE;
  content public.league_administration_contents%ROWTYPE; receipt public.league_roster_capture_receipts%ROWTYPE;
  provenance jsonb:=p_input->'envelope'->'provenance'; resource_entity text; evidence_hash_value text;
  covered boolean:=false; acceptance_id uuid; prior_provenance jsonb; prior_content uuid; source_current boolean:=true; clock_key text;
BEGIN
  IF addition IS NULL THEN
    IF p_input ? 'draftSelectionsProjection' THEN RAISE EXCEPTION 'draft projection requires selections acceptance'; END IF;
    RETURN public.record_league_administration_observation_v53(p_input);
  END IF;
  IF p_input ?| ARRAY['rosterAcceptance','teamManagerAcceptance','teamManagerEvidenceAcceptance','leagueSettingsAcceptance','matchupAcceptance',
      'calendarEvidence','calculationCapture','transactionAcceptance','bracketAcceptance','bracketProjection','weeklyReportAcceptance','weeklyReportProjection','officialStandings','draftMetadataAcceptance','draftMetadataProjection']
    OR provenance ? 'acquisition' OR octet_length(p_input::text)>33488896 THEN RAISE EXCEPTION 'mixed or oversized draft selections acceptance'; END IF;
  -- Timestamp casts alone admit locale/space forms rejected by the unchanged
  -- TypeScript normalizer. Require explicit ISO network clocks independently.
  IF jsonb_typeof(provenance) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'invalid draft selections provenance'; END IF;
  FOREACH clock_key IN ARRAY ARRAY['requestStartedAt','requestCompletedAt','checkedAt','sourceObservedAt'] LOOP
    IF clock_key='sourceObservedAt' AND provenance->clock_key='null'::jsonb THEN CONTINUE; END IF;
    IF jsonb_typeof(provenance->clock_key) IS DISTINCT FROM 'string'
      OR provenance->>clock_key !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T([01][0-9]|2[0-4]):[0-5][0-9]:[0-5][0-9](\.[0-9]+)?(Z|[+-][0-9]{2}:[0-9]{2})$' THEN
      RAISE EXCEPTION 'invalid draft selections ISO clock'; END IF;
    IF NOT isfinite((provenance->>clock_key)::timestamptz) THEN RAISE EXCEPTION 'nonfinite draft selections clock'; END IF;
  END LOOP;
  IF p_input->'envelope'->>'family' IS DISTINCT FROM 'drafts' OR p_input->'envelope'->'week' IS DISTINCT FROM 'null'::jsonb
    OR p_input->'envelope'->'scope'->>'season' IS DISTINCT FROM '2026'
    OR p_input->'envelope'->'scope' IS DISTINCT FROM p_input->'sourceMapping'->'scope' OR p_input->'sourceMapping' IS NULL
    OR projection->>'version' IS DISTINCT FROM 'sleeper-draft-selections-v1' OR projection->>'status' IS NULL OR projection->>'status' NOT IN ('accepted','rejected')
    OR p_input->'envelope'->'payload'->>'selectionsVersion' IS DISTINCT FROM 'sleeper-draft-selections-v1'
    OR p_input->'envelope'->'payload'->>'kind' IS NULL OR p_input->'envelope'->'payload'->>'kind' NOT IN ('catalog','selections')
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
    OR (provenance->>'checkedAt')::timestamptz>clock_timestamp()+interval '5 minutes' THEN RAISE EXCEPTION 'invalid mapped draft selections network capture'; END IF;
  resource_entity:=CASE WHEN p_input->'envelope'->'payload'->>'kind'='catalog' THEN 'catalog' ELSE 'draft:'||(p_input->'envelope'->'payload'->>'externalDraftId')||':selections' END;
  IF resource_entity IS NULL THEN RAISE EXCEPTION 'missing draft resource identity'; END IF;
  -- Expanded JSON text bounds native and typed reader evidence. Reserve a separate
  -- 8 MiB for frozen player links before delegated writes; actual link materialization
  -- enforces that same bound. Per-entry framing covers relational IDs and column
  -- names; native league/draft strings are measured separately to prevent row amplification.
  IF octet_length((p_input->'envelope'->'payload')::text)+octet_length((projection->'value')::text)
    +octet_length((p_input->'sourceMapping')::text)+octet_length(provenance::text)+65536
    +COALESCE(jsonb_array_length(projection->'value'->'entries'),0)*(1536
      +2*COALESCE(octet_length((p_input->'envelope'->'scope'->'externalLeagueId')::text),0)
      +2*COALESCE(octet_length((p_input->'envelope'->'payload'->'externalDraftId')::text),0))+8388608>33554432 THEN
    RAISE EXCEPTION 'draft selections persistence budget exceeded'; END IF;
  -- The prior writer owns job -> league/source -> legacy-head locking. Preserve
  -- that order before obtaining the typed resource head; all later failures roll
  -- back this same SQL transaction, including the delegated legacy observation.
  result:=public.record_league_administration_observation_v53(p_input-'draftSelectionsAcceptance'-'draftSelectionsProjection'-'sourceMapping');
  PERFORM public.validate_current_roster_mapping(p_input->'sourceMapping');
  token:=addition->'attempt';
  SELECT * INTO STRICT attempt FROM public.league_roster_resource_attempts WHERE id=(token->>'id')::uuid;
  IF (provenance->>'requestStartedAt')::timestamptz<attempt.reserved_at THEN RAISE EXCEPTION 'draft request predates reservation'; END IF;
  IF attempt.source_mapping IS DISTINCT FROM p_input->'sourceMapping' OR attempt.write_fence IS DISTINCT FROM p_input->'writeFence'
    OR token IS DISTINCT FROM jsonb_build_object('id',attempt.id,'scopeId',attempt.scope_id,'ordinal',attempt.ordinal,'expectedGeneration',attempt.expected_generation)
    OR NOT EXISTS(SELECT 1 FROM public.league_roster_resource_scopes scope WHERE scope.id=attempt.scope_id
      AND scope.identity=jsonb_build_object('scope',jsonb_build_object('kind','enrolled-resource','connectionId',attempt.source_mapping->>'connectionId',
        'leagueSeasonId',attempt.source_mapping->>'leagueSeasonId','family','drafts','entityId',resource_entity,'scoringPeriodId',NULL,
        'audienceId','public','coverageSpecId','sleeper-draft-selections-v1'),'policy',jsonb_build_object('audienceId','public','coverageSpecId','sleeper-draft-selections-v1',
        'canonicalNormalizerVersion','sleeper-draft-selections-v1','validationVersion','latest-network-attempt-v1'))) THEN RAISE EXCEPTION 'draft selections attempt scope mismatch'; END IF;
  SELECT * INTO STRICT head FROM public.league_roster_resource_heads WHERE scope_id=attempt.scope_id FOR UPDATE;
  IF attempt.write_fence IS NOT NULL THEN PERFORM public.assert_roster_player_link_fence(attempt.write_fence); END IF;
  evidence_hash_value:=encode(digest(convert_to(p_input::text,'UTF8'),'sha256'),'hex');
  SELECT * INTO receipt FROM public.league_roster_capture_receipts WHERE attempt_id=attempt.id;
  IF FOUND AND receipt.evidence_hash<>evidence_hash_value THEN RAISE EXCEPTION 'draft selections attempt receipt conflict'; END IF;
  IF attempt.write_fence IS NOT NULL THEN PERFORM public.assert_roster_player_link_fence(attempt.write_fence); END IF;
  SELECT * INTO STRICT content FROM public.league_administration_contents stored
    WHERE stored.league_season_id=(attempt.source_mapping->>'leagueSeasonId')::uuid AND stored.provider='sleeper'
      AND stored.external_league_id=attempt.source_mapping->'scope'->>'externalLeagueId' AND stored.family='drafts' AND stored.week=0
      AND stored.normalizer_version='sleeper-administration-v1' AND stored.content_hash=p_input->>'contentHash'
      AND stored.completeness=p_input->'envelope'->>'completeness' AND NOT stored.accepted
      AND stored.payload=p_input->'envelope'->'payload' AND stored.normalized_value IS NOT DISTINCT FROM p_input->'value';
  IF projection->>'status'='accepted' THEN
    expected:=public.project_draft_selections_native(content.payload,content.external_league_id,content.completeness='complete');
    IF expected IS NULL OR projection->'value' IS DISTINCT FROM expected OR projection->'diagnostics' IS DISTINCT FROM '[]'::jsonb THEN RAISE EXCEPTION 'draft selections projection mismatch'; END IF;
    covered:=(expected->>'complete')::boolean;
  ELSIF projection->'value' IS DISTINCT FROM 'null'::jsonb OR jsonb_typeof(projection->'diagnostics') IS DISTINCT FROM 'array'
    OR jsonb_array_length(projection->'diagnostics')=0 THEN RAISE EXCEPTION 'invalid draft selections rejection evidence'; END IF;
  IF receipt.id IS NOT NULL THEN
    IF receipt.content_id<>content.id THEN RAISE EXCEPTION 'draft replay content mismatch'; END IF;
    IF attempt.write_fence IS NOT NULL THEN PERFORM public.assert_roster_player_link_fence(attempt.write_fence); END IF;
    RETURN result||jsonb_build_object('draftSelectionsAcceptance',jsonb_build_object('status',CASE WHEN EXISTS(
      SELECT 1 FROM public.league_roster_resource_acceptances accepted WHERE accepted.id=head.accepted_id AND accepted.receipt_id=receipt.id)
      THEN 'accepted' ELSE 'preserved' END,'reason','exact_receipt_replay','receiptId',receipt.id,'acceptedGeneration',head.generation));
  END IF;
  INSERT INTO public.league_roster_capture_receipts(attempt_id,content_id,legacy_observation_id,evidence_hash,provenance,coverage)
    VALUES(attempt.id,content.id,(result->>'observationId')::uuid,evidence_hash_value,provenance,
      jsonb_build_object('periodIds','[]'::jsonb,'interval',NULL,'entitySet',CASE WHEN covered THEN 'full' ELSE 'unknown' END,
        'fields','["draft_id","pick_no","round","draft_slot","player_id","roster_id","picked_by","is_keeper","metadata"]'::jsonb,
        'pagination',CASE WHEN covered THEN 'complete' ELSE 'unknown' END,'nextCursor',NULL,
        'completeness',CASE WHEN covered THEN 'complete' ELSE 'partial' END,
        'reasons',CASE WHEN covered THEN '[]'::jsonb ELSE '["draft_selections_incomplete"]'::jsonb END)) RETURNING * INTO receipt;
  IF expected IS NOT NULL THEN PERFORM public.capture_draft_selections_typed(content.id,receipt.id,expected); END IF;
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
  RETURN result||jsonb_build_object('draftSelectionsAcceptance',jsonb_build_object('status',CASE WHEN acceptance_id IS NULL THEN 'preserved' ELSE 'accepted' END,
    'reason',CASE WHEN acceptance_id IS NOT NULL THEN NULL WHEN attempt.ordinal<>head.latest_ordinal THEN 'newer_network_attempt_reserved'
      WHEN attempt.expected_generation<>head.generation THEN 'accepted_generation_changed' WHEN NOT covered THEN 'draft_selections_incomplete' ELSE 'draft_selections_source_not_newer' END,
    'receiptId',receipt.id,'acceptedGeneration',head.generation));
END; $$;


CREATE TABLE public.league_draft_selection_link_receipts (
  selection_acceptance_id uuid PRIMARY KEY REFERENCES public.league_roster_resource_acceptances(id),
  selection_receipt_id uuid NOT NULL UNIQUE REFERENCES public.league_roster_capture_receipts(id),
  league_season_id uuid NOT NULL REFERENCES public.league_seasons(id),source_mapping_revision_id uuid NOT NULL REFERENCES public.league_source_mapping_revisions(id),
  selection_content_id uuid NOT NULL REFERENCES public.league_draft_selection_contents(content_id),
  link_version text NOT NULL CHECK(link_version='sleeper-draft-selection-player-links-v1'),
  directory_version_id uuid REFERENCES public.league_player_directory_versions(id),resolved_at timestamptz NOT NULL,mapping_evaluated_at timestamptz NOT NULL,
  outcome text NOT NULL CHECK(outcome IN ('complete','partial','capacity_exceeded','owner_unqualified')),reasons jsonb NOT NULL CHECK(jsonb_typeof(reasons)='array'),
  selection_count integer NOT NULL CHECK(selection_count BETWEEN 0 AND 10000),resolved_count integer NOT NULL CHECK(resolved_count>=0),
  unresolved_count integer NOT NULL CHECK(unresolved_count>=0),conflict_count integer NOT NULL CHECK(conflict_count>=0),
  capture_transaction xid8 NOT NULL DEFAULT pg_current_xact_id(),CHECK(selection_count=resolved_count+unresolved_count+conflict_count)
);
CREATE TABLE public.league_draft_selection_player_links (
  selection_acceptance_id uuid NOT NULL REFERENCES public.league_draft_selection_link_receipts(selection_acceptance_id),
  source_ordinal integer NOT NULL CHECK(source_ordinal BETWEEN 0 AND 9999),selection_id uuid NOT NULL REFERENCES public.league_draft_selections(id),native_player_id text,
  entity_kind text CHECK(entity_kind IN ('player','team_defense')),identity_state text NOT NULL CHECK(identity_state IN ('resolved','unresolved','conflict')),
  reasons jsonb NOT NULL CHECK(jsonb_typeof(reasons)='array'),directory_identity_status text NOT NULL CHECK(directory_identity_status IN ('valid','invalid','conflict','missing')),
  kind_evidence jsonb CHECK(kind_evidence IS NULL OR jsonb_typeof(kind_evidence)='object'),canonical_entity_id uuid REFERENCES public.scoring_entities(id),
  mapping_proof jsonb NOT NULL CHECK(jsonb_typeof(mapping_proof)='array' AND jsonb_array_length(mapping_proof)<=2),
  PRIMARY KEY(selection_acceptance_id,source_ordinal),UNIQUE(selection_acceptance_id,selection_id),
  CHECK((identity_state='resolved')=(canonical_entity_id IS NOT NULL)),CHECK(identity_state<>'resolved' OR (entity_kind IS NOT NULL AND reasons='[]'::jsonb))
);
CREATE INDEX draft_selection_link_canonical_history_idx ON public.league_draft_selection_player_links(canonical_entity_id) WHERE canonical_entity_id IS NOT NULL;
CREATE FUNCTION public.validate_draft_selection_link_lineage()
RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
  IF TG_TABLE_NAME='league_draft_selection_link_receipts' THEN
    IF NEW.capture_transaction<>pg_current_xact_id() OR NOT EXISTS(SELECT 1 FROM public.league_roster_resource_acceptances accepted
      JOIN public.league_roster_capture_receipts receipt ON receipt.id=accepted.receipt_id
      JOIN public.league_roster_resource_scopes scope ON scope.id=accepted.scope_id
      JOIN public.league_draft_selection_contents content ON content.content_id=receipt.content_id
      WHERE accepted.id=NEW.selection_acceptance_id AND receipt.id=NEW.selection_receipt_id AND content.content_id=NEW.selection_content_id
        AND content.kind='selections' AND content.complete AND content.total_count=NEW.selection_count
        AND scope.league_season_id=NEW.league_season_id AND accepted.source_mapping_revision_id=NEW.source_mapping_revision_id
        AND scope.identity->'scope'->>'coverageSpecId'='sleeper-draft-selections-v1') THEN RAISE EXCEPTION 'draft selection link receipt lineage mismatch'; END IF;
  ELSE
    IF NOT EXISTS(SELECT 1 FROM public.league_draft_selection_link_receipts header
      JOIN public.league_draft_selection_entries entry ON entry.content_id=header.selection_content_id AND entry.source_ordinal=NEW.source_ordinal
      WHERE header.selection_acceptance_id=NEW.selection_acceptance_id AND header.capture_transaction=pg_current_xact_id()
        AND header.outcome IN ('complete','partial') AND entry.identity_state='valid' AND entry.selection_id=NEW.selection_id
        AND entry.player_id IS NOT DISTINCT FROM NEW.native_player_id) THEN RAISE EXCEPTION 'draft selection player lineage mismatch'; END IF;
  END IF;
  RETURN NEW;
END; $$;
CREATE FUNCTION public.validate_draft_selection_link_counts()
RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE total integer; resolved integer; conflicts integer;
BEGIN
  SELECT count(*),count(*) FILTER(WHERE identity_state='resolved'),count(*) FILTER(WHERE identity_state='conflict')
    INTO total,resolved,conflicts FROM public.league_draft_selection_player_links WHERE selection_acceptance_id=NEW.selection_acceptance_id;
  IF (NEW.outcome IN ('complete','partial') AND (total<>NEW.selection_count OR resolved<>NEW.resolved_count OR conflicts<>NEW.conflict_count))
    OR (NEW.outcome NOT IN ('complete','partial') AND (total<>0 OR NEW.resolved_count<>0 OR NEW.conflict_count<>0))
    OR (NEW.outcome='complete' AND NEW.resolved_count<>NEW.selection_count) THEN RAISE EXCEPTION 'draft selection link count mismatch'; END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER draft_selection_link_receipt_lineage BEFORE INSERT ON public.league_draft_selection_link_receipts
  FOR EACH ROW EXECUTE FUNCTION public.validate_draft_selection_link_lineage();
CREATE TRIGGER draft_selection_player_link_lineage BEFORE INSERT ON public.league_draft_selection_player_links
  FOR EACH ROW EXECUTE FUNCTION public.validate_draft_selection_link_lineage();
CREATE CONSTRAINT TRIGGER draft_selection_link_counts AFTER INSERT ON public.league_draft_selection_link_receipts
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.validate_draft_selection_link_counts();
CREATE TRIGGER draft_selection_link_receipt_immutable BEFORE UPDATE OR DELETE ON public.league_draft_selection_link_receipts
  FOR EACH ROW EXECUTE FUNCTION public.prevent_league_administration_history_change();
CREATE TRIGGER draft_selection_player_link_immutable BEFORE UPDATE OR DELETE ON public.league_draft_selection_player_links
  FOR EACH ROW EXECUTE FUNCTION public.prevent_league_administration_history_change();
CREATE FUNCTION public.capture_draft_selection_player_links()
RETURNS trigger LANGUAGE plpgsql VOLATILE SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE scope public.league_roster_resource_scopes%ROWTYPE;receipt public.league_roster_capture_receipts%ROWTYPE;
  attempt public.league_roster_resource_attempts%ROWTYPE;content public.league_administration_contents%ROWTYPE;
  directory_version uuid;directory_content uuid;selection_count_value integer;resolved_count_value integer:=0;conflict_count_value integer:=0;
  estimated_bytes numeric:=0;candidates jsonb:='[]';identity_inputs jsonb;owner_results jsonb;owner_result jsonb;links jsonb:='[]';
  outcome_value text;reasons_value jsonb:='[]';evaluated_at timestamptz:=statement_timestamp();
  js_whitespace text:=E' \t\n\r\f'||chr(11)||chr(160)||chr(5760)||chr(8192)||chr(8193)||chr(8194)||chr(8195)||chr(8196)||chr(8197)||chr(8198)||chr(8199)||chr(8200)||chr(8201)||chr(8202)||chr(8232)||chr(8233)||chr(8239)||chr(8287)||chr(12288)||chr(65279);
BEGIN
  SELECT * INTO STRICT scope FROM public.league_roster_resource_scopes WHERE id=NEW.scope_id;
  IF scope.identity->'scope'->>'coverageSpecId' IS DISTINCT FROM 'sleeper-draft-selections-v1'
    OR scope.identity->'scope'->>'entityId'='catalog' THEN RETURN NEW; END IF;
  SELECT * INTO STRICT receipt FROM public.league_roster_capture_receipts WHERE id=NEW.receipt_id;
  SELECT * INTO STRICT attempt FROM public.league_roster_resource_attempts WHERE id=receipt.attempt_id;
  SELECT * INTO STRICT content FROM public.league_administration_contents WHERE id=receipt.content_id;
  SELECT version.id,version.content_id INTO directory_version,directory_content FROM public.league_player_directory_heads head
    JOIN public.league_player_directory_versions version ON version.id=head.accepted_version_id WHERE head.provider='sleeper' AND head.sport='nfl';
  SELECT count(*) INTO selection_count_value FROM public.league_draft_selection_entries WHERE content_id=content.id;
  IF attempt.write_fence IS NULL THEN outcome_value:='owner_unqualified';reasons_value:='["owner_unqualified"]';
  ELSE
    PERFORM public.assert_roster_player_link_fence(attempt.write_fence);
    -- Bound immutable proof expansion before acquiring identity locks or writing identities.
    SELECT COALESCE(sum(2048+3*octet_length(COALESCE(to_jsonb(pick.player_id)::text,'null'))
      +octet_length(COALESCE(jsonb_build_object('position',entry.position,'fantasyPositions',entry.fantasy_positions,
        'positionState',entry.field_states->'position','fantasyPositionsState',entry.field_states->'fantasy_positions')::text,'null'))),0)
      INTO estimated_bytes FROM public.league_draft_selection_entries pick LEFT JOIN public.league_player_directory_entries entry
        ON entry.content_id=directory_content AND entry.external_player_id_hash=encode(digest(pick.player_id,'sha256'),'hex') AND entry.external_player_id=pick.player_id
      WHERE pick.content_id=content.id;
    IF estimated_bytes>8388608 THEN outcome_value:='capacity_exceeded';reasons_value:='["capacity_exceeded"]';
    ELSE
      PERFORM pg_advisory_xact_lock(hashtextextended('scoring-native:'||jsonb_build_array('sleeper',held.native_id)::text,0))
        FROM (SELECT DISTINCT player_id COLLATE "C" AS native_id FROM public.league_draft_selection_entries
          WHERE content_id=content.id AND player_id IS NOT NULL ORDER BY native_id) held;
      PERFORM public.assert_roster_player_link_fence(attempt.write_fence);
      WITH held AS (
        SELECT DISTINCT player_id AS native_id FROM public.league_draft_selection_entries WHERE content_id=content.id AND player_id IS NOT NULL
      ), native AS (
        SELECT held.native_id,entry.identity_status,
          CASE WHEN octet_length(entry.full_name)<=1024 THEN entry.full_name END AS full_name,
          CASE WHEN octet_length(concat_ws(' ',entry.first_name,entry.last_name))<=1024 THEN concat_ws(' ',entry.first_name,entry.last_name) END AS combined_name,
          CASE WHEN octet_length(entry.team)<=64 THEN entry.team END AS team,
          CASE WHEN entry.external_player_id IS NULL THEN NULL ELSE jsonb_build_object('position',entry.position,
            'fantasyPositions',entry.fantasy_positions,'positionState',entry.field_states->'position',
            'fantasyPositionsState',entry.field_states->'fantasy_positions') END AS kind_evidence,
          CASE WHEN entry.external_player_id IS NOT NULL THEN
            (SELECT COALESCE(bool_or(translate(btrim(kind_clue.value,js_whitespace),'def','DEF')='DEF'),false) FROM unnest(ARRAY[entry.position]||COALESCE(entry.fantasy_positions,'{}'::text[])) AS kind_clue(value) WHERE btrim(kind_clue.value,js_whitespace)<>'') ELSE false END AS has_def,
          CASE WHEN entry.external_player_id IS NOT NULL THEN
            (SELECT COALESCE(bool_or(translate(btrim(kind_clue.value,js_whitespace),'def','DEF')<>'DEF'),false) FROM unnest(ARRAY[entry.position]||COALESCE(entry.fantasy_positions,'{}'::text[])) AS kind_clue(value) WHERE btrim(kind_clue.value,js_whitespace)<>'') ELSE false END AS has_player,
          -- Reuse CP5's exact native-ID validation, including UTF-16 and JS whitespace.
          CASE WHEN length(held.native_id)>256 THEN false ELSE
            NOT (public.player_directory_native_row(held.native_id,'{}'::jsonb)->'reasons' ? 'invalid-native-id') END AS valid_id
        FROM held LEFT JOIN public.league_player_directory_entries entry ON entry.content_id=directory_content
          AND entry.external_player_id_hash=encode(digest(held.native_id,'sha256'),'hex') AND entry.external_player_id=held.native_id
      ), classified AS (
        SELECT native.*,CASE WHEN has_def AND NOT has_player THEN 'team_defense' WHEN has_player AND NOT has_def THEN 'player' END AS entity_kind,
          CASE WHEN native_id='0' THEN 'vacancy_marker_not_player' WHEN NOT valid_id THEN 'native_player_id_invalid'
            WHEN directory_version IS NULL THEN 'directory_unavailable' WHEN identity_status IS NULL THEN 'directory_player_missing'
            WHEN identity_status='invalid' THEN 'directory_identity_invalid' WHEN identity_status='conflict' THEN 'directory_identity_conflict'
            WHEN has_def AND has_player THEN 'kind_conflict' WHEN NOT has_def AND NOT has_player THEN 'kind_unavailable' END AS native_reason
        FROM native
      ), decisions AS (
        SELECT classified.*,CASE WHEN native_reason IS NOT NULL THEN native_reason
          WHEN EXISTS(SELECT 1 FROM public.external_scoring_entity_ids mapping WHERE mapping.provider='sleeper'
            AND mapping.external_id=native_id AND mapping.entity_kind=CASE classified.entity_kind WHEN 'player' THEN 'team_defense' ELSE 'player' END) THEN 'canonical_kind_conflict'
          WHEN mapping.scoring_entity_id IS NOT NULL AND entity.kind IS DISTINCT FROM classified.entity_kind THEN 'canonical_identity_conflict' END AS reason
        FROM classified LEFT JOIN public.external_scoring_entity_ids mapping ON mapping.provider='sleeper'
          AND mapping.external_id=native_id AND mapping.entity_kind=classified.entity_kind
        LEFT JOIN public.scoring_entities entity ON entity.id=mapping.scoring_entity_id
      ) SELECT COALESCE(jsonb_agg(to_jsonb(decisions) ORDER BY native_id COLLATE "C"),'[]'::jsonb) INTO candidates FROM decisions;
      SELECT COALESCE(jsonb_agg(jsonb_build_object('ordinal',candidate.ordinal-1,
        'proposed_id',public.scoring_identity_uuid('scoring-entity:'||(candidate.value->>'entity_kind'),(candidate.value->>'entity_kind')||':'||(candidate.value->>'native_id')),
        'input_key',(candidate.value->>'entity_kind')||':'||(candidate.value->>'native_id'),'kind',candidate.value->>'entity_kind',
        'display_name',COALESCE(NULLIF(btrim(candidate.value->>'full_name'),''),NULLIF(btrim(candidate.value->>'combined_name'),''),candidate.value->>'native_id'),
        'nfl_team',NULLIF(btrim(candidate.value->>'team'),''),'preserve_existing_metadata',true,
        'provider_ids',jsonb_build_array(jsonb_build_object('provider','sleeper','external_id',candidate.value->>'native_id')))
        ORDER BY candidate.ordinal),'[]') INTO identity_inputs FROM jsonb_array_elements(candidates) WITH ORDINALITY candidate(value,ordinal)
        WHERE candidate.value->>'reason' IS NULL;
      owner_result:=public.upsert_scoring_entity_identities(identity_inputs);owner_results:=owner_result->'rows';evaluated_at:=(owner_result->>'evaluatedAt')::timestamptz;
      PERFORM public.assert_roster_player_link_fence(attempt.write_fence);
      WITH enriched AS (
        SELECT pick.source_ordinal,pick.selection_id,pick.player_id AS native_player_id,candidate.value->>'entity_kind' AS entity_kind,
          COALESCE(candidate.value->>'identity_status','missing') AS directory_identity_status,NULLIF(candidate.value->'kind_evidence','null'::jsonb) AS kind_evidence,
          result.value->>'entity_id' AS resolved_id,
          CASE WHEN pick.player_id IS NULL THEN 'native_player_id_'||(pick.native_fields->'playerId'->>'state')
            WHEN candidate.value->>'reason' IS NOT NULL THEN candidate.value->>'reason'
            WHEN mapping.mapping_status='unverified' THEN 'canonical_mapping_unverified' WHEN mapping.mapping_status='retired' THEN 'canonical_mapping_retired'
            WHEN mapping.valid_from>evaluated_at THEN 'canonical_mapping_not_yet_valid' WHEN mapping.valid_to<=evaluated_at THEN 'canonical_mapping_expired'
            WHEN result.value->>'entity_id' IS NULL OR (result.value->>'conflict')::boolean THEN 'canonical_identity_conflict' END AS reason,
          COALESCE((SELECT jsonb_agg(jsonb_build_object('provider',mapping.provider,'entityKind',mapping.entity_kind,'externalId',mapping.external_id,
            'scoringEntityId',mapping.scoring_entity_id,'mappingStatus',mapping.mapping_status,'validFrom',mapping.valid_from,'validTo',mapping.valid_to,'canonicalKind',entity.kind)
            ORDER BY mapping.entity_kind) FROM public.external_scoring_entity_ids mapping JOIN public.scoring_entities entity ON entity.id=mapping.scoring_entity_id
              WHERE mapping.provider='sleeper' AND mapping.external_id=pick.player_id AND mapping.entity_kind IN ('player','team_defense')),'[]') AS mapping_proof
        FROM public.league_draft_selection_entries pick LEFT JOIN jsonb_array_elements(candidates) candidate(value) ON candidate.value->>'native_id'=pick.player_id
        LEFT JOIN jsonb_array_elements(owner_results) result(value) ON result.value->>'input_key'=(candidate.value->>'entity_kind')||':'||pick.player_id
        LEFT JOIN public.external_scoring_entity_ids mapping ON mapping.provider='sleeper' AND mapping.external_id=pick.player_id AND mapping.entity_kind=candidate.value->>'entity_kind'
        WHERE pick.content_id=content.id
      ) SELECT COALESCE(jsonb_agg(jsonb_build_object('source_ordinal',source_ordinal,'selection_id',selection_id,'native_player_id',native_player_id,
        'entity_kind',entity_kind,'directory_identity_status',directory_identity_status,'kind_evidence',kind_evidence,'mapping_proof',mapping_proof,
        'canonical_entity_id',CASE WHEN reason IS NULL THEN resolved_id END,
        'identity_state',CASE WHEN reason IS NULL THEN 'resolved' WHEN reason IN ('kind_conflict','directory_identity_conflict','canonical_kind_conflict','canonical_identity_conflict') THEN 'conflict' ELSE 'unresolved' END,
        'reasons',CASE WHEN reason IS NULL THEN '[]'::jsonb ELSE jsonb_build_array(reason) END) ORDER BY source_ordinal),'[]') INTO links FROM enriched;
      IF jsonb_array_length(links)<>selection_count_value OR octet_length(links::text)>8388608 THEN RAISE EXCEPTION 'draft selection link snapshot bound mismatch'; END IF;
      SELECT count(*) FILTER(WHERE value->>'identity_state'='resolved'),count(*) FILTER(WHERE value->>'identity_state'='conflict')
        INTO resolved_count_value,conflict_count_value FROM jsonb_array_elements(links);
      outcome_value:=CASE WHEN resolved_count_value=selection_count_value THEN 'complete' ELSE 'partial' END;
      IF outcome_value='partial' THEN reasons_value:='["unresolved_player_links"]'; END IF;
    END IF;
  END IF;
  INSERT INTO public.league_draft_selection_link_receipts(selection_acceptance_id,selection_receipt_id,league_season_id,source_mapping_revision_id,
    selection_content_id,link_version,directory_version_id,resolved_at,mapping_evaluated_at,outcome,reasons,selection_count,resolved_count,unresolved_count,conflict_count)
  VALUES(NEW.id,receipt.id,scope.league_season_id,NEW.source_mapping_revision_id,content.id,'sleeper-draft-selection-player-links-v1',directory_version,
    clock_timestamp(),evaluated_at,outcome_value,reasons_value,selection_count_value,resolved_count_value,selection_count_value-resolved_count_value-conflict_count_value,conflict_count_value);
  INSERT INTO public.league_draft_selection_player_links(selection_acceptance_id,source_ordinal,selection_id,native_player_id,entity_kind,identity_state,reasons,
    directory_identity_status,kind_evidence,canonical_entity_id,mapping_proof)
    SELECT NEW.id,(value->>'source_ordinal')::integer,(value->>'selection_id')::uuid,value->>'native_player_id',value->>'entity_kind',value->>'identity_state',value->'reasons',
      value->>'directory_identity_status',NULLIF(value->'kind_evidence','null'::jsonb),(value->>'canonical_entity_id')::uuid,value->'mapping_proof' FROM jsonb_array_elements(links);
  IF attempt.write_fence IS NOT NULL THEN PERFORM public.assert_roster_player_link_fence(attempt.write_fence); END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER draft_selection_player_links_after_acceptance AFTER INSERT ON public.league_roster_resource_acceptances
  FOR EACH ROW EXECUTE FUNCTION public.capture_draft_selection_player_links();

-- DATA-CP17-2026-10-14-IDENTITY-HISTORY-SCOPE: exact CP6 body plus one immutable-reference guard.
CREATE OR REPLACE FUNCTION public.upsert_scoring_entity_identities(p_inputs jsonb)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY INVOKER
SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE written_count bigint; resolved_rows jsonb; resolved_at_value timestamptz;
BEGIN
  IF jsonb_typeof(p_inputs) IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'invalid scoring identity input'; END IF;
  IF jsonb_array_length(p_inputs)=0 THEN RETURN jsonb_build_object('evaluatedAt',clock_timestamp(),'rows','[]'::jsonb); END IF;
  -- These are the existing prepared identity inputs, not caller assertions of a resolved crosswalk.
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(p_inputs) AS input_item(value)
    WHERE jsonb_typeof(input_item.value) IS DISTINCT FROM 'object'
      OR input_item.value->>'kind' NOT IN ('player','team_defense') OR input_item.value->>'kind' IS NULL
      OR jsonb_typeof(input_item.value->'ordinal') IS DISTINCT FROM 'number'
      OR (input_item.value->>'ordinal') !~ '^(0|[1-9][0-9]*)$' OR (input_item.value->>'ordinal')::numeric>2147483647
      OR jsonb_typeof(input_item.value->'input_key') IS DISTINCT FROM 'string' OR btrim(input_item.value->>'input_key')=''
      OR jsonb_typeof(input_item.value->'display_name') IS DISTINCT FROM 'string' OR btrim(input_item.value->>'display_name')=''
      OR (input_item.value->>'proposed_id')::uuid IS DISTINCT FROM public.scoring_identity_uuid('scoring-entity:'||(input_item.value->>'kind'),input_item.value->>'input_key')
      OR jsonb_typeof(input_item.value->'provider_ids') IS DISTINCT FROM 'array' OR jsonb_array_length(input_item.value->'provider_ids')=0)
    OR (SELECT count(*) FROM jsonb_array_elements(p_inputs) AS input_item(value))<>(SELECT count(DISTINCT input_item.value->>'input_key') FROM jsonb_array_elements(p_inputs) AS input_item(value))
    OR (SELECT count(*) FROM jsonb_array_elements(p_inputs) AS input_item(value))<>(SELECT count(DISTINCT input_item.value->>'ordinal') FROM jsonb_array_elements(p_inputs) AS input_item(value))
    OR EXISTS(SELECT 1 FROM jsonb_array_elements(p_inputs) AS input_item(value) CROSS JOIN LATERAL jsonb_array_elements(input_item.value->'provider_ids') AS provider_id(value)
      WHERE jsonb_typeof(provider_id.value->'provider') IS DISTINCT FROM 'string' OR btrim(provider_id.value->>'provider')=''
        OR jsonb_typeof(provider_id.value->'external_id') IS DISTINCT FROM 'string' OR btrim(provider_id.value->>'external_id')='')
    OR EXISTS(SELECT 1 FROM jsonb_array_elements(p_inputs) AS input_item(value) CROSS JOIN LATERAL jsonb_array_elements(input_item.value->'provider_ids') AS provider_id(value)
      GROUP BY provider_id.value->>'provider',input_item.value->>'kind',provider_id.value->>'external_id' HAVING count(*)>1) THEN
    RAISE EXCEPTION 'invalid or duplicate scoring identity input';
  END IF;
  -- Serialize shared provider identities across kinds; all callers use a stable lock order.
  PERFORM pg_advisory_xact_lock(hashtextextended('scoring-native:'||jsonb_build_array(keys.provider,keys.external_id)::text,0))
    FROM (SELECT DISTINCT (provider_id.value->>'provider') COLLATE "C" AS provider,(provider_id.value->>'external_id') COLLATE "C" AS external_id
      FROM jsonb_array_elements(p_inputs) AS input_item(value) CROSS JOIN LATERAL jsonb_array_elements(input_item.value->'provider_ids') AS provider_id(value)
      ORDER BY provider,external_id) keys;
  WITH input AS (
          SELECT * FROM jsonb_to_recordset(p_inputs) AS value(
            ordinal integer, proposed_id uuid, input_key text, kind text,
            display_name text, nfl_team text, preserve_existing_metadata boolean,
            provider_ids jsonb
          )
        ), expanded AS (
          SELECT input.*, ids.provider, ids.external_id
          FROM input
          CROSS JOIN LATERAL jsonb_to_recordset(input.provider_ids) AS ids(
            provider text, external_id text
          )
        ), existing AS (
          SELECT expanded.ordinal,
            COALESCE(array_agg(DISTINCT mapping.scoring_entity_id)
              FILTER (WHERE mapping.scoring_entity_id IS NOT NULL), '{}'::uuid[]) AS entity_ids,
            COALESCE(bool_or(mapping.scoring_entity_id IS NOT NULL AND (
              mapping.mapping_status <> 'verified' OR mapping.valid_from > statement_timestamp()
              OR mapping.valid_to <= statement_timestamp() OR entity.kind <> expanded.kind
            )), false) AS unusable
          FROM expanded
          LEFT JOIN external_scoring_entity_ids mapping
            ON mapping.provider = expanded.provider
            AND mapping.entity_kind = expanded.kind
            AND mapping.external_id = expanded.external_id
          LEFT JOIN scoring_entities entity ON entity.id = mapping.scoring_entity_id
          GROUP BY expanded.ordinal
        ), proposed_targets AS (
          SELECT input.*,
            CASE
              WHEN cardinality(existing.entity_ids) = 1 THEN existing.entity_ids[1]
              ELSE input.proposed_id
            END AS target_id,
            cardinality(existing.entity_ids) > 1 OR existing.unusable AS conflict
          FROM input JOIN existing USING (ordinal)
        ), targets AS (
          SELECT proposed_targets.*,
            count(*) OVER (PARTITION BY target_id) > 1 AS target_collision
          FROM proposed_targets
        ), upserted_entities AS (
          INSERT INTO scoring_entities (id, kind, display_name, nfl_team)
          SELECT DISTINCT ON (target_id) target_id, kind, display_name, nfl_team
          FROM targets WHERE NOT conflict AND NOT target_collision
          ORDER BY target_id, ordinal
          ON CONFLICT (id) DO UPDATE SET
            display_name = CASE WHEN EXISTS (
              SELECT 1 FROM targets target
              WHERE target.target_id = EXCLUDED.id AND target.preserve_existing_metadata
            ) THEN scoring_entities.display_name ELSE EXCLUDED.display_name END,
            nfl_team = CASE WHEN EXISTS (
              SELECT 1 FROM targets target
              WHERE target.target_id = EXCLUDED.id AND target.preserve_existing_metadata
            ) THEN scoring_entities.nfl_team ELSE EXCLUDED.nfl_team END,
            updated_at = now()
          RETURNING id
        ), inserted_mappings AS (
          INSERT INTO external_scoring_entity_ids
            (provider, entity_kind, external_id, scoring_entity_id)
          SELECT expanded.provider, expanded.kind, expanded.external_id, targets.target_id
          FROM expanded
          JOIN targets USING (ordinal)
          JOIN upserted_entities ON upserted_entities.id = targets.target_id
          WHERE NOT targets.conflict AND NOT targets.target_collision
          ON CONFLICT (provider, entity_kind, external_id) DO NOTHING
          RETURNING scoring_entity_id
        )
        SELECT count(*) INTO written_count FROM inserted_mappings;

  -- Preserve the old fresh resolve command's post-wait validity instant. Internal
  -- statement_timestamp() would still be the outer call start after contention.
  resolved_at_value:=clock_timestamp();
  -- A separate VOLATILE statement obtains the post-conflict READ COMMITTED snapshot.
  SELECT COALESCE(jsonb_agg(to_jsonb(result) ORDER BY input_order.ordinal),'[]'::jsonb) INTO resolved_rows FROM (
    WITH input AS (
          SELECT * FROM jsonb_to_recordset(p_inputs) AS value(
            ordinal integer, proposed_id uuid, input_key text, kind text,
            display_name text, nfl_team text, provider_ids jsonb
          )
        ), expanded AS (
          SELECT input.ordinal, input.input_key, input.proposed_id,
            ids.provider, input.kind, ids.external_id
          FROM input
          CROSS JOIN LATERAL jsonb_to_recordset(input.provider_ids) AS ids(
            provider text, external_id text
          )
        ), resolved AS (
          SELECT expanded.ordinal, expanded.input_key, expanded.proposed_id,
            COALESCE(array_agg(DISTINCT mapping.scoring_entity_id)
              FILTER (WHERE mapping.scoring_entity_id IS NOT NULL), '{}'::uuid[]) AS entity_ids,
            COALESCE(bool_or(mapping.scoring_entity_id IS NULL
              OR mapping.mapping_status <> 'verified' OR mapping.valid_from > resolved_at_value
              OR mapping.valid_to <= resolved_at_value OR entity.kind <> expanded.kind
            ), false) AS unusable
          FROM expanded
          LEFT JOIN external_scoring_entity_ids mapping
            ON mapping.provider = expanded.provider
            AND mapping.entity_kind = expanded.kind
            AND mapping.external_id = expanded.external_id
          LEFT JOIN scoring_entities entity ON entity.id = mapping.scoring_entity_id
          GROUP BY expanded.ordinal, expanded.input_key, expanded.proposed_id
        ), validated AS (
          SELECT resolved.*, cardinality(entity_ids) > 1 OR unusable
            OR (cardinality(entity_ids) = 1
              AND count(*) OVER (PARTITION BY entity_ids[1]) > 1) AS conflict
          FROM resolved
        )
        SELECT input_key,
          CASE WHEN cardinality(entity_ids) = 1 AND NOT conflict THEN entity_ids[1] END AS entity_id,
          conflict,
          proposed_id
        FROM validated ORDER BY ordinal
  ) result JOIN jsonb_to_recordset(p_inputs) AS input_order(input_key text,ordinal integer) ON input_order.input_key=result.input_key;

  -- Preserve proposed-ID orphan cleanup while retaining identities referenced by immutable CP6 history.
  DELETE FROM public.scoring_entities entity
    WHERE entity.id IN (SELECT (resolved_item.value->>'proposed_id')::uuid FROM jsonb_array_elements(resolved_rows) AS resolved_item(value)
      WHERE resolved_item.value->>'entity_id' IS DISTINCT FROM resolved_item.value->>'proposed_id')
      AND NOT EXISTS(SELECT 1 FROM public.external_scoring_entity_ids mapping WHERE mapping.scoring_entity_id=entity.id)
      AND NOT EXISTS(SELECT 1 FROM public.league_roster_player_links historical WHERE historical.canonical_entity_id=entity.id)
      AND NOT EXISTS(SELECT 1 FROM public.league_draft_selection_player_links historical WHERE historical.canonical_entity_id=entity.id);
  RETURN jsonb_build_object('evaluatedAt',resolved_at_value,'rows',resolved_rows);
END; $$;

REVOKE ALL ON public.league_draft_selections,public.league_draft_selection_contents,public.league_draft_selection_catalog_entries,public.league_draft_selection_entries,public.league_draft_selection_link_receipts,public.league_draft_selection_player_links FROM PUBLIC;
REVOKE ALL ON FUNCTION public.draft_selection_field(jsonb,text,text),public.draft_selection_facts(jsonb,integer,text,text,boolean),public.project_draft_selections_native(jsonb,text,boolean),public.draft_selections_typed_value(uuid),public.capture_draft_selections_typed(uuid,uuid,jsonb),public.validate_draft_selections_typed_lineage(),public.guard_draft_selections_child_insert(),public.validate_draft_selections_fence(),public.validate_draft_selection_link_lineage(),public.validate_draft_selection_link_counts(),public.capture_draft_selection_player_links(),public.record_league_administration_observation_v53(jsonb),public.begin_draft_selections_attempt(jsonb,jsonb,uuid,jsonb),public.record_league_administration_observation(jsonb) FROM PUBLIC;
DO $$ BEGIN
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='league_one_runtime') THEN
    REVOKE ALL ON public.league_draft_selections,public.league_draft_selection_contents,public.league_draft_selection_catalog_entries,public.league_draft_selection_entries,public.league_draft_selection_link_receipts,public.league_draft_selection_player_links FROM league_one_runtime;
    GRANT SELECT ON public.league_draft_selections,public.league_draft_selection_contents,public.league_draft_selection_catalog_entries,public.league_draft_selection_entries,public.league_draft_selection_link_receipts,public.league_draft_selection_player_links TO league_one_runtime;
    REVOKE ALL ON FUNCTION public.draft_selection_field(jsonb,text,text),public.draft_selection_facts(jsonb,integer,text,text,boolean),public.project_draft_selections_native(jsonb,text,boolean),public.draft_selections_typed_value(uuid),public.capture_draft_selections_typed(uuid,uuid,jsonb),public.validate_draft_selections_typed_lineage(),public.guard_draft_selections_child_insert(),public.validate_draft_selections_fence(),public.validate_draft_selection_link_lineage(),public.validate_draft_selection_link_counts(),public.capture_draft_selection_player_links(),public.record_league_administration_observation_v53(jsonb) FROM league_one_runtime;
    GRANT EXECUTE ON FUNCTION public.begin_draft_selections_attempt(jsonb,jsonb,uuid,jsonb),public.record_league_administration_observation(jsonb) TO league_one_runtime;
  END IF;
END; $$;
