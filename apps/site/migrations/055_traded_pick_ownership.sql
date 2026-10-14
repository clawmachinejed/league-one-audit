-- CP18 source-only additive migration; authoring does not install this in any database.
-- Future years are references within 2026. No enrollment, backfill or scheduler changes.
CREATE FUNCTION public.traded_pick_field(p_row jsonb,p_key text,p_kind text)
RETURNS jsonb LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE raw jsonb:=p_row->p_key; parsed jsonb;
BEGIN
  IF jsonb_typeof(p_row) IS DISTINCT FROM 'object' THEN RETURN jsonb_build_object('state','missing','raw',NULL,'value',NULL); END IF;
  IF p_kind<>'year' THEN RETURN public.draft_metadata_field(p_row,p_key,p_kind); END IF;
  IF jsonb_typeof(p_row) IS DISTINCT FROM 'object' OR NOT p_row ? p_key THEN RETURN jsonb_build_object('state','missing','raw',NULL,'value',NULL); END IF;
  IF raw='null'::jsonb THEN RETURN jsonb_build_object('state','null','raw',NULL,'value',NULL); END IF;
  IF jsonb_typeof(raw)='string' AND raw#>>'{}' ~ '^[0-9]{4}$' AND (raw#>>'{}')::integer BETWEEN 1920 AND 2200 THEN parsed:=raw; END IF;
  RETURN jsonb_build_object('state',CASE WHEN parsed IS NULL THEN 'invalid' ELSE 'supplied' END,'raw',raw,'value',parsed);
END; $$;

CREATE TABLE public.league_traded_pick_assets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),league_season_id uuid NOT NULL REFERENCES public.league_seasons(id),provider text NOT NULL CHECK(provider='sleeper'),
  external_league_id text NOT NULL,endpoint_key text NOT NULL,draft_id uuid REFERENCES public.league_season_drafts(id),
  pick_season text NOT NULL CHECK(pick_season ~ '^[0-9]{4}$' AND pick_season::integer BETWEEN 1920 AND 2200),
  round_value bigint NOT NULL CHECK(round_value BETWEEN 1 AND 9007199254740991),original_roster_id text NOT NULL,
  UNIQUE(league_season_id,provider,external_league_id,endpoint_key,pick_season,round_value,original_roster_id),
  CHECK((endpoint_key='league')=(draft_id IS NULL))
);
CREATE TABLE public.league_traded_pick_contents (
  content_id uuid PRIMARY KEY REFERENCES public.league_administration_contents(id),first_receipt_id uuid NOT NULL REFERENCES public.league_roster_capture_receipts(id),
  capture_transaction xid8 NOT NULL DEFAULT pg_current_xact_id(),value_version text NOT NULL CHECK(value_version='sleeper-traded-picks-v1'),
  kind text NOT NULL CHECK(kind IN ('catalog','league','draft')),external_draft_id text,complete boolean NOT NULL,
  trades_state text CHECK(trades_state IN ('missing','null','empty','invalid','supplied')),total_count integer CHECK(total_count>=0),
  valid_identity_count integer NOT NULL CHECK(valid_identity_count>=0),invalid_identity_count integer NOT NULL CHECK(invalid_identity_count>=0),
  attempted_trade_count integer NOT NULL CHECK(attempted_trade_count BETWEEN 0 AND 8),succeeded_trade_count integer NOT NULL CHECK(succeeded_trade_count BETWEEN 0 AND 8),
  failed_trade_count integer NOT NULL CHECK(failed_trade_count BETWEEN 0 AND 8),unrequested_trade_count integer NOT NULL CHECK(unrequested_trade_count>=0),reason text,
  CHECK((kind='draft')=(external_draft_id IS NOT NULL)),CHECK((kind<>'catalog')=(trades_state IS NOT NULL)),
  CHECK(attempted_trade_count=succeeded_trade_count+failed_trade_count),
  CHECK(kind<>'catalog' OR (COALESCE(total_count,0)=valid_identity_count+invalid_identity_count AND COALESCE(total_count,0)=attempted_trade_count+unrequested_trade_count))
);
CREATE TABLE public.league_traded_pick_catalog_entries (
  content_id uuid NOT NULL REFERENCES public.league_traded_pick_contents(content_id),source_ordinal integer NOT NULL CHECK(source_ordinal>=0),
  identity_state text NOT NULL CHECK(identity_state IN ('valid','invalid')),external_draft_id text,trade_state text NOT NULL CHECK(trade_state IN ('succeeded','failed','unrequested')),
  PRIMARY KEY(content_id,source_ordinal),CHECK(identity_state<>'valid' OR external_draft_id IS NOT NULL)
);
CREATE TABLE public.league_traded_pick_entries (
  content_id uuid NOT NULL REFERENCES public.league_traded_pick_contents(content_id),source_ordinal integer NOT NULL CHECK(source_ordinal BETWEEN 0 AND 9999),
  identity_state text NOT NULL CHECK(identity_state IN ('valid','invalid','conflict')),asset_id uuid REFERENCES public.league_traded_pick_assets(id),
  pick_season text,round_value bigint CHECK(round_value BETWEEN 1 AND 9007199254740991),original_roster_id text,owner_id text,previous_owner_id text,
  ownership_state text NOT NULL CHECK(ownership_state IN ('resolved','unknown','conflict')),current_owner_id text,owner_team_id uuid REFERENCES public.league_season_teams(id),
  previous_owner_state text NOT NULL CHECK(previous_owner_state IN ('resolved','unknown','conflict')),evidenced_previous_owner_id text,
  native_fields jsonb NOT NULL,extensions jsonb NOT NULL,raw jsonb NOT NULL,PRIMARY KEY(content_id,source_ordinal),
  CHECK((identity_state='valid')=(asset_id IS NOT NULL)),CHECK((ownership_state='resolved')=(current_owner_id IS NOT NULL)),
  CHECK((ownership_state='resolved')=(owner_team_id IS NOT NULL)),CHECK((previous_owner_state='resolved')=(evidenced_previous_owner_id IS NOT NULL))
);
CREATE INDEX traded_pick_asset_history_idx ON public.league_traded_pick_entries(asset_id,content_id) WHERE asset_id IS NOT NULL;
CREATE INDEX traded_pick_owner_history_idx ON public.league_traded_pick_entries(owner_team_id,content_id) WHERE owner_team_id IS NOT NULL;
CREATE FUNCTION public.traded_picks_typed_value(p_content uuid)
RETURNS jsonb LANGUAGE sql STABLE SET search_path=pg_catalog,public,pg_temp AS $$
  SELECT jsonb_build_object('kind',h.kind,'season',2026,'complete',h.complete,'totalCount',h.total_count,'reason',h.reason)||
    CASE WHEN h.kind='catalog' THEN jsonb_build_object('validIdentityCount',h.valid_identity_count,'invalidIdentityCount',h.invalid_identity_count,
      'attemptedTradeCount',h.attempted_trade_count,'succeededTradeCount',h.succeeded_trade_count,'failedTradeCount',h.failed_trade_count,
      'unrequestedTradeCount',h.unrequested_trade_count,'entries',(SELECT COALESCE(jsonb_agg(jsonb_build_object('sourceOrdinal',e.source_ordinal,
        'identityState',e.identity_state,'externalDraftId',e.external_draft_id,'tradeState',e.trade_state) ORDER BY e.source_ordinal),'[]')
        FROM public.league_traded_pick_catalog_entries e WHERE e.content_id=h.content_id))
    ELSE jsonb_build_object('externalDraftId',h.external_draft_id,'tradesState',h.trades_state,'entries',(SELECT COALESCE(jsonb_agg(e.native_fields||jsonb_build_object(
      'sourceOrdinal',e.source_ordinal,'identityState',e.identity_state,
      'pickSeason',(e.native_fields->'pickSeason')||jsonb_build_object('value',e.pick_season),'round',(e.native_fields->'round')||jsonb_build_object('value',e.round_value),
      'originalRosterId',(e.native_fields->'originalRosterId')||jsonb_build_object('value',e.original_roster_id),
      'ownerId',(e.native_fields->'ownerId')||jsonb_build_object('value',e.owner_id),'previousOwnerId',(e.native_fields->'previousOwnerId')||jsonb_build_object('value',e.previous_owner_id),
      'ownershipState',e.ownership_state,'currentOwnerId',e.current_owner_id,'previousOwnerState',e.previous_owner_state,
      'evidencedPreviousOwnerId',e.evidenced_previous_owner_id,'extensions',e.extensions,'raw',e.raw) ORDER BY e.source_ordinal),'[]')
      FROM public.league_traded_pick_entries e WHERE e.content_id=h.content_id)) END
  FROM public.league_traded_pick_contents h WHERE h.content_id=p_content
$$;
CREATE FUNCTION public.capture_traded_picks_typed(p_content uuid,p_receipt uuid,p_value jsonb)
RETURNS void LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE created uuid; draft_identity uuid; endpoint text; content public.league_administration_contents%ROWTYPE;
BEGIN
  SELECT * INTO STRICT content FROM public.league_administration_contents WHERE id=p_content;
  INSERT INTO public.league_traded_pick_contents(content_id,first_receipt_id,value_version,kind,external_draft_id,complete,trades_state,total_count,
    valid_identity_count,invalid_identity_count,attempted_trade_count,succeeded_trade_count,failed_trade_count,unrequested_trade_count,reason)
  VALUES(p_content,p_receipt,'sleeper-traded-picks-v1',p_value->>'kind',p_value->>'externalDraftId',(p_value->>'complete')::boolean,p_value->>'tradesState',(p_value->>'totalCount')::integer,
    COALESCE((p_value->>'validIdentityCount')::integer,0),COALESCE((p_value->>'invalidIdentityCount')::integer,0),COALESCE((p_value->>'attemptedTradeCount')::integer,0),
    COALESCE((p_value->>'succeededTradeCount')::integer,0),COALESCE((p_value->>'failedTradeCount')::integer,0),COALESCE((p_value->>'unrequestedTradeCount')::integer,0),p_value->>'reason')
    ON CONFLICT DO NOTHING RETURNING content_id INTO created;
  IF created IS NOT NULL THEN
    IF p_value->>'kind'='catalog' THEN
      INSERT INTO public.league_traded_pick_catalog_entries(content_id,source_ordinal,identity_state,external_draft_id,trade_state)
        SELECT p_content,(entry->>'sourceOrdinal')::integer,entry->>'identityState',entry->>'externalDraftId',entry->>'tradeState' FROM jsonb_array_elements(p_value->'entries') entry;
    ELSE
      endpoint:=CASE WHEN p_value->>'kind'='league' THEN 'league' ELSE 'draft:'||(p_value->>'externalDraftId')||':traded-picks' END;
      IF p_value->>'kind'='draft' THEN
        INSERT INTO public.league_season_drafts(league_season_id,provider,external_league_id,external_draft_id)
          VALUES(content.league_season_id,content.provider,content.external_league_id,p_value->>'externalDraftId') ON CONFLICT DO NOTHING;
        SELECT id INTO STRICT draft_identity FROM public.league_season_drafts WHERE league_season_id=content.league_season_id
          AND provider=content.provider AND external_league_id=content.external_league_id AND external_draft_id=p_value->>'externalDraftId';
      END IF;
      INSERT INTO public.league_traded_pick_assets(league_season_id,provider,external_league_id,endpoint_key,draft_id,pick_season,round_value,original_roster_id)
        SELECT DISTINCT content.league_season_id,content.provider,content.external_league_id,endpoint,draft_identity,
          item->'pickSeason'->>'value',(item->'round'->>'value')::bigint,item->'originalRosterId'->>'value'
        FROM jsonb_array_elements(p_value->'entries') item WHERE item->>'identityState'='valid' ON CONFLICT DO NOTHING;
      INSERT INTO public.league_season_teams(league_season_id,provider,external_league_id,external_roster_id)
        SELECT DISTINCT content.league_season_id,content.provider,content.external_league_id,item->>'currentOwnerId'
        FROM jsonb_array_elements(p_value->'entries') item WHERE item->>'ownershipState'='resolved' ON CONFLICT DO NOTHING;
      INSERT INTO public.league_traded_pick_entries(content_id,source_ordinal,identity_state,asset_id,pick_season,round_value,original_roster_id,owner_id,previous_owner_id,
        ownership_state,current_owner_id,owner_team_id,previous_owner_state,evidenced_previous_owner_id,native_fields,extensions,raw)
        SELECT p_content,(item->>'sourceOrdinal')::integer,item->>'identityState',asset.id,item->'pickSeason'->>'value',(item->'round'->>'value')::bigint,
          item->'originalRosterId'->>'value',item->'ownerId'->>'value',item->'previousOwnerId'->>'value',item->>'ownershipState',item->>'currentOwnerId',team.id,
          item->>'previousOwnerState',item->>'evidencedPreviousOwnerId',item-ARRAY['sourceOrdinal','identityState','ownershipState','currentOwnerId','previousOwnerState','evidencedPreviousOwnerId','extensions','raw'],item->'extensions',item->'raw'
        FROM jsonb_array_elements(p_value->'entries') item LEFT JOIN public.league_traded_pick_assets asset ON item->>'identityState'='valid'
          AND asset.league_season_id=content.league_season_id AND asset.provider=content.provider AND asset.external_league_id=content.external_league_id
          AND asset.endpoint_key=endpoint AND asset.pick_season=item->'pickSeason'->>'value' AND asset.round_value=(item->'round'->>'value')::bigint
          AND asset.original_roster_id=item->'originalRosterId'->>'value'
        LEFT JOIN public.league_season_teams team ON item->>'ownershipState'='resolved' AND team.league_season_id=content.league_season_id AND team.provider=content.provider
          AND team.external_league_id=content.external_league_id AND team.external_roster_id=item->>'currentOwnerId';
    END IF;
  END IF;
  IF public.traded_picks_typed_value(p_content) IS DISTINCT FROM p_value THEN RAISE EXCEPTION 'traded picks typed materialization mismatch'; END IF;
END; $$;
CREATE FUNCTION public.traded_pick_facts(p_row jsonb,p_ordinal integer,p_draft text,p_league text)
RETURNS jsonb LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE season_field jsonb:=public.traded_pick_field(p_row,'season','year'); round_field jsonb:=public.traded_pick_field(p_row,'round','slot');
  roster_field jsonb:=public.traded_pick_field(p_row,'roster_id','roster'); state_value text;
BEGIN
  state_value:=CASE WHEN jsonb_typeof(p_row)='object' AND ((p_row ? 'league_id' AND p_row->'league_id' IS DISTINCT FROM to_jsonb(p_league))
    OR (p_row ? 'sport' AND p_row->'sport' IS DISTINCT FROM '"nfl"'::jsonb)
    OR (p_draft IS NOT NULL AND p_row ? 'draft_id' AND p_row->'draft_id' IS DISTINCT FROM to_jsonb(p_draft))) THEN 'conflict'
    WHEN jsonb_typeof(p_row) IS DISTINCT FROM 'object' OR season_field->>'state'<>'supplied' OR round_field->>'state'<>'supplied'
      OR roster_field->>'state'<>'supplied' THEN 'invalid' ELSE 'valid' END;
  RETURN jsonb_build_object('sourceOrdinal',p_ordinal,'identityState',state_value,'pickSeason',season_field,'round',round_field,'originalRosterId',roster_field,
    'ownerId',public.traded_pick_field(p_row,'owner_id','roster'),'previousOwnerId',public.traded_pick_field(p_row,'previous_owner_id','roster'),
    'ownershipState','unknown','currentOwnerId',NULL,'previousOwnerState','unknown','evidencedPreviousOwnerId',NULL,
    'extensions',CASE WHEN jsonb_typeof(p_row)='object' THEN p_row-ARRAY['season','round','roster_id','owner_id','previous_owner_id'] ELSE '{}'::jsonb END,'raw',p_row);
END; $$;

CREATE FUNCTION public.project_traded_picks_native(p_payload jsonb,p_league text,p_complete boolean)
RETURNS jsonb LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE row_value jsonb; entries jsonb:='[]'; outcomes jsonb:='{}'; frequencies jsonb:='{}'; native_id text;
  total integer; valid_count integer:=0; succeeded integer:=0; failed integer:=0; complete boolean; result jsonb;
  source_body jsonb; node_count integer; deepest integer; trades_state text; reason_value text;
BEGIN
  IF p_payload->>'tradedPicksVersion' IS DISTINCT FROM 'sleeper-traded-picks-v1' OR octet_length(p_payload::text)>8454144 THEN RETURN NULL; END IF;
  FOR source_body IN SELECT p_payload->'catalog' UNION ALL SELECT p_payload->'tradedPicks' LOOP
    WITH RECURSIVE nodes(value,depth) AS (
      SELECT source_body,1 UNION ALL
      SELECT child.value,nodes.depth+1 FROM nodes CROSS JOIN LATERAL (
        SELECT value FROM jsonb_array_elements(CASE WHEN jsonb_typeof(nodes.value)='array' THEN nodes.value ELSE '[]'::jsonb END)
        UNION ALL SELECT value FROM jsonb_each(CASE WHEN jsonb_typeof(nodes.value)='object' THEN nodes.value ELSE '{}'::jsonb END)
      ) child WHERE nodes.depth<65
    ) SELECT count(*),max(depth) INTO node_count,deepest FROM (SELECT depth FROM nodes LIMIT 250001) bounded;
    IF node_count>250000 OR deepest>64 THEN RETURN NULL; END IF;
  END LOOP;
  IF p_payload->>'kind' IN ('league','draft') THEN
    IF p_payload->>'kind'='draft' THEN
      native_id:=p_payload->>'externalDraftId';
      IF jsonb_typeof(p_payload->'externalDraftId') IS DISTINCT FROM 'string' OR native_id !~ '^[A-Za-z0-9_-]{1,128}$'
        OR NOT public.draft_metadata_owns(p_payload->'catalog',p_league,native_id) THEN RETURN NULL; END IF;
    ELSIF p_payload ?| ARRAY['catalog','externalDraftId'] THEN RETURN NULL; END IF;
    trades_state:=CASE WHEN NOT p_payload ? 'tradedPicks' THEN 'missing' WHEN p_payload->'tradedPicks'='null'::jsonb THEN 'null'
      WHEN jsonb_typeof(p_payload->'tradedPicks')<>'array' THEN 'invalid' WHEN jsonb_array_length(p_payload->'tradedPicks')=0 THEN 'empty' ELSE 'supplied' END;
    IF jsonb_typeof(p_payload->'tradedPicks')='array' THEN
      total:=jsonb_array_length(p_payload->'tradedPicks'); IF total>10000 THEN RETURN NULL; END IF;
      WITH native AS MATERIALIZED (
        SELECT public.traded_pick_facts(value,(ordinality-1)::integer,native_id,p_league) AS fact FROM jsonb_array_elements(p_payload->'tradedPicks') WITH ORDINALITY
      ), groups AS (
        SELECT fact->'pickSeason'->>'value' AS year,fact->'round'->>'value' AS round,fact->'originalRosterId'->>'value' AS roster,
          count(*) AS total,count(fact->'ownerId'->>'value') AS owner_count,count(DISTINCT fact->'ownerId'->>'value') AS owners,
          min(fact->'ownerId'->>'value') AS owner,count(fact->'previousOwnerId'->>'value') AS previous_count,
          count(DISTINCT fact->'previousOwnerId'->>'value') AS previous_owners,min(fact->'previousOwnerId'->>'value') AS previous_owner
        FROM native WHERE fact->>'identityState'='valid' GROUP BY 1,2,3
      ) SELECT COALESCE(jsonb_agg(fact||CASE WHEN g.total IS NULL THEN '{}'::jsonb ELSE jsonb_build_object(
        'ownershipState',CASE WHEN g.owners>1 THEN 'conflict' WHEN g.owner_count<>g.total THEN 'unknown' ELSE 'resolved' END,
        'currentOwnerId',CASE WHEN g.owners=1 AND g.owner_count=g.total THEN g.owner END,
        'previousOwnerState',CASE WHEN g.previous_owners>1 THEN 'conflict' WHEN g.previous_count<>g.total THEN 'unknown' ELSE 'resolved' END,
        'evidencedPreviousOwnerId',CASE WHEN g.previous_owners=1 AND g.previous_count=g.total THEN g.previous_owner END) END ORDER BY (fact->>'sourceOrdinal')::integer),'[]') INTO entries
        FROM native LEFT JOIN groups g ON fact->>'identityState'='valid' AND g.year=fact->'pickSeason'->>'value'
          AND g.round=fact->'round'->>'value' AND g.roster=fact->'originalRosterId'->>'value';
      SELECT count(*) INTO valid_count FROM jsonb_array_elements(entries) entry WHERE entry->>'identityState'='valid';
    END IF;
    complete:=total IS NOT NULL AND total=valid_count AND p_complete;
    reason_value:=CASE WHEN total IS NULL THEN 'traded-picks-invalid-array' WHEN valid_count<>total THEN 'traded-picks-invalid-identities'
      WHEN NOT p_complete THEN 'traded-picks-source-partial' ELSE NULL END;
    result:=jsonb_build_object('kind',p_payload->>'kind','season',2026,'externalDraftId',native_id,'complete',complete,'tradesState',trades_state,
      'totalCount',total,'entries',entries,'reason',reason_value);
  ELSIF p_payload->>'kind'='catalog' THEN
    IF jsonb_typeof(p_payload->'trades') IS DISTINCT FROM 'array' OR jsonb_array_length(p_payload->'trades')>8
      OR NOT COALESCE(p_payload->'reason'='null'::jsonb OR jsonb_typeof(p_payload->'reason')='string',false) THEN RETURN NULL; END IF;
    IF jsonb_typeof(p_payload->'catalog')='array' THEN
      total:=jsonb_array_length(p_payload->'catalog');
      SELECT COALESCE(jsonb_object_agg(counts.id,counts.amount),'{}') INTO frequencies FROM (
        SELECT candidate->>'draft_id' AS id,count(*) AS amount FROM jsonb_array_elements(p_payload->'catalog') candidate
          WHERE public.draft_metadata_owns(candidate,p_league) GROUP BY candidate->>'draft_id') counts;
    END IF;
    FOR row_value IN SELECT value FROM jsonb_array_elements(p_payload->'trades') LOOP
      native_id:=row_value->>'externalDraftId';
      IF jsonb_typeof(row_value->'externalDraftId') IS DISTINCT FROM 'string' OR native_id !~ '^[A-Za-z0-9_-]{1,128}$'
        OR outcomes ? native_id OR row_value->>'state' IS NULL OR row_value->>'state' NOT IN ('succeeded','failed','unrequested')
        OR total IS NULL OR COALESCE((frequencies->>native_id)::integer,0)<>1
        OR (total>8 AND row_value->>'state'<>'unrequested') THEN RETURN NULL; END IF;
      outcomes:=outcomes||jsonb_build_object(native_id,row_value->'state');
    END LOOP;
    IF total IS NOT NULL THEN
      SELECT COALESCE(jsonb_agg(jsonb_build_object('sourceOrdinal',ordinality-1,'identityState',CASE WHEN valid THEN 'valid' ELSE 'invalid' END,
        'externalDraftId',id,'tradeState',CASE WHEN valid THEN COALESCE(outcomes->>id,'unrequested') ELSE 'unrequested' END) ORDER BY ordinality),'[]') INTO entries
      FROM (SELECT value,ordinality,CASE WHEN jsonb_typeof(value->'draft_id')='string' AND value->>'draft_id' ~ '^[A-Za-z0-9_-]{1,128}$' THEN value->>'draft_id' END AS id,
        public.draft_metadata_owns(value,p_league) AND COALESCE((frequencies->>(value->>'draft_id'))::integer,0)=1 AS valid
        FROM jsonb_array_elements(p_payload->'catalog') WITH ORDINALITY) native_entries;
      SELECT count(*) FILTER(WHERE value->>'identityState'='valid'),count(*) FILTER(WHERE value->>'tradeState'='succeeded'),count(*) FILTER(WHERE value->>'tradeState'='failed')
        INTO valid_count,succeeded,failed FROM jsonb_array_elements(entries);
    END IF;
    complete:=total IS NOT NULL AND total<=8 AND total=valid_count AND p_complete;
    IF complete AND p_payload->'reason'<>'null'::jsonb AND p_payload->>'reason'<>'metadata-source-partial' THEN RETURN NULL; END IF;
    result:=jsonb_build_object('kind','catalog','season',2026,'complete',complete,'totalCount',total,'validIdentityCount',valid_count,
      'invalidIdentityCount',COALESCE(total,0)-valid_count,'attemptedTradeCount',succeeded+failed,'succeededTradeCount',succeeded,'failedTradeCount',failed,
      'unrequestedTradeCount',COALESCE(total,0)-succeeded-failed,'entries',entries,'reason',p_payload->'reason');
  END IF;
  IF octet_length(result::text)>33488896 THEN RETURN NULL; END IF;
  RETURN result;
END; $$;


CREATE FUNCTION public.validate_traded_picks_typed_lineage()
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
      AND scope.identity->'scope'->>'family'='drafts' AND scope.identity->'scope'->>'entityId'=CASE WHEN NEW.kind='draft' THEN 'draft:'||NEW.external_draft_id||':traded-picks' ELSE NEW.kind END
      AND scope.identity->'scope'->'scoringPeriodId'='null'::jsonb
      AND scope.identity->'policy'=jsonb_build_object('audienceId','public','coverageSpecId','sleeper-traded-picks-v1','canonicalNormalizerVersion','sleeper-traded-picks-v1','validationVersion','latest-network-attempt-v1')
      AND content.provider='sleeper' AND content.family='drafts' AND content.week=0 AND content.normalizer_version='sleeper-administration-v1') THEN
    RAISE EXCEPTION 'traded picks typed receipt lineage mismatch'; END IF;
  expected:=public.project_traded_picks_native(content.payload,content.external_league_id,content.completeness='complete');
  IF expected IS NULL OR public.traded_picks_typed_value(content.id) IS DISTINCT FROM expected THEN RAISE EXCEPTION 'traded picks native parity mismatch'; END IF;
  IF EXISTS(SELECT 1 FROM public.league_traded_pick_entries entry JOIN public.league_traded_pick_assets asset ON asset.id=entry.asset_id
    LEFT JOIN public.league_season_drafts draft ON draft.id=asset.draft_id LEFT JOIN public.league_season_teams team ON team.id=entry.owner_team_id
    WHERE entry.content_id=content.id AND (asset.league_season_id<>content.league_season_id OR asset.provider<>content.provider
      OR asset.external_league_id<>content.external_league_id OR asset.endpoint_key<>CASE WHEN NEW.kind='draft' THEN 'draft:'||NEW.external_draft_id||':traded-picks' ELSE NEW.kind END
      OR asset.pick_season<>entry.pick_season OR asset.round_value<>entry.round_value OR asset.original_roster_id<>entry.original_roster_id
      OR (NEW.kind='draft' AND (draft.league_season_id<>content.league_season_id OR draft.provider<>content.provider
        OR draft.external_league_id<>content.external_league_id OR draft.external_draft_id<>NEW.external_draft_id))
      OR team.league_season_id<>content.league_season_id OR team.provider<>content.provider
      OR team.external_league_id<>content.external_league_id OR team.external_roster_id<>entry.current_owner_id)) THEN
    RAISE EXCEPTION 'traded pick canonical identity mismatch'; END IF;
  IF fence IS NOT NULL THEN PERFORM public.assert_roster_player_link_fence(fence); END IF;
  RETURN NEW;
END; $$;
CREATE FUNCTION public.guard_traded_picks_child_insert()
RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
  IF NOT EXISTS(SELECT 1 FROM public.league_traded_pick_contents header WHERE header.content_id=NEW.content_id
    AND header.capture_transaction=pg_current_xact_id()) THEN RAISE EXCEPTION 'traded picks history cannot gain later facts'; END IF;
  RETURN NEW;
END; $$;
CREATE CONSTRAINT TRIGGER traded_picks_typed_lineage AFTER INSERT ON public.league_traded_pick_contents
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.validate_traded_picks_typed_lineage();
DO $$ DECLARE name text; BEGIN
  FOREACH name IN ARRAY ARRAY['league_traded_pick_assets','league_traded_pick_contents','league_traded_pick_catalog_entries','league_traded_pick_entries'] LOOP
    EXECUTE format('CREATE TRIGGER traded_picks_history_immutable BEFORE UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.prevent_league_administration_history_change()',name);
    IF name NOT IN ('league_traded_pick_assets','league_traded_pick_contents') THEN
      EXECUTE format('CREATE TRIGGER traded_picks_child_insert BEFORE INSERT ON public.%I FOR EACH ROW EXECUTE FUNCTION public.guard_traded_picks_child_insert()',name);
    END IF;
  END LOOP;
END; $$;

CREATE FUNCTION public.begin_traded_picks_attempt(p_mapping jsonb,p_resource jsonb,p_id uuid,p_fence jsonb DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE scope_row public.league_roster_resource_scopes%ROWTYPE;
  attempt public.league_roster_resource_attempts%ROWTYPE;
  head public.league_roster_resource_heads%ROWTYPE;
  identity_value jsonb;
BEGIN
  IF p_id IS NULL OR p_resource IS NULL OR NOT COALESCE(p_resource IN (jsonb_build_object('kind','catalog'),jsonb_build_object('kind','league')) OR (jsonb_typeof(p_resource->'externalDraftId')='string' AND p_resource->>'externalDraftId' ~ '^[A-Za-z0-9_-]{1,128}$' AND p_resource=jsonb_build_object('kind','draft','externalDraftId',p_resource->>'externalDraftId')),false) OR p_mapping->'scope'->>'season' IS DISTINCT FROM '2026' THEN RAISE EXCEPTION 'invalid current-season traded picks scope'; END IF;
  IF p_fence IS NOT NULL THEN
    PERFORM 1 FROM public.projection_jobs job WHERE job.job_key=p_fence->>'jobKey' AND job.state='running'
      AND job.lease_owner=p_fence->>'workerId' AND job.attempt_count=(p_fence->>'generation')::integer
      AND job.lease_until>clock_timestamp() AND (p_fence->>'deadlineAt')::timestamptz>clock_timestamp() FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'traded picks reservation writer fence is stale'; END IF;
  END IF;
  PERFORM public.validate_current_roster_mapping(p_mapping);
  identity_value:=jsonb_build_object('scope',jsonb_build_object('kind','enrolled-resource',
    'connectionId',p_mapping->>'connectionId','leagueSeasonId',p_mapping->>'leagueSeasonId',
    'family','drafts','entityId',CASE WHEN p_resource->>'kind'='draft' THEN 'draft:'||(p_resource->>'externalDraftId')||':traded-picks' ELSE p_resource->>'kind' END,'scoringPeriodId',NULL,
    'audienceId','public','coverageSpecId','sleeper-traded-picks-v1'),
    'policy',jsonb_build_object('audienceId','public','coverageSpecId','sleeper-traded-picks-v1',
    'canonicalNormalizerVersion','sleeper-traded-picks-v1','validationVersion','latest-network-attempt-v1'));
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
    RAISE EXCEPTION 'traded picks reservation writer fence expired'; END IF;
  SELECT * INTO attempt FROM public.league_roster_resource_attempts WHERE id=p_id;
  IF FOUND THEN
    IF attempt.scope_id<>scope_row.id OR attempt.source_mapping IS DISTINCT FROM p_mapping
      OR attempt.write_fence IS DISTINCT FROM p_fence THEN RAISE EXCEPTION 'traded picks attempt identity conflict'; END IF;
  ELSE
    UPDATE public.league_roster_resource_heads SET latest_ordinal=latest_ordinal+1
      WHERE scope_id=scope_row.id RETURNING * INTO head;
    INSERT INTO public.league_roster_resource_attempts(id,scope_id,ordinal,expected_generation,source_mapping,write_fence)
      VALUES(p_id,scope_row.id,head.latest_ordinal,head.generation,p_mapping,p_fence) RETURNING * INTO attempt;
  END IF;
  RETURN jsonb_build_object('id',attempt.id,'scopeId',attempt.scope_id,'ordinal',attempt.ordinal,
    'expectedGeneration',attempt.expected_generation);
END; $$;



-- Explicit CP18 source-only extension; older calls delegate unchanged.
ALTER FUNCTION public.record_league_administration_observation(jsonb) RENAME TO record_league_administration_observation_v54;
CREATE FUNCTION public.record_league_administration_observation(p_input jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE addition jsonb:=p_input->'tradedPicksAcceptance'; projection jsonb:=p_input->'tradedPicksProjection'; result jsonb; expected jsonb; token jsonb;
  attempt public.league_roster_resource_attempts%ROWTYPE; head public.league_roster_resource_heads%ROWTYPE;
  content public.league_administration_contents%ROWTYPE; receipt public.league_roster_capture_receipts%ROWTYPE;
  provenance jsonb:=p_input->'envelope'->'provenance'; resource_entity text; evidence_hash_value text;
  covered boolean:=false; acceptance_id uuid; prior_provenance jsonb; prior_content uuid; source_current boolean:=true; clock_key text;
BEGIN
  IF addition IS NULL THEN
    IF p_input ? 'tradedPicksProjection' THEN RAISE EXCEPTION 'draft projection requires selections acceptance'; END IF;
    RETURN public.record_league_administration_observation_v54(p_input);
  END IF;
  IF p_input ?| ARRAY['rosterAcceptance','teamManagerAcceptance','teamManagerEvidenceAcceptance','leagueSettingsAcceptance','matchupAcceptance',
      'calendarEvidence','calculationCapture','transactionAcceptance','bracketAcceptance','bracketProjection','weeklyReportAcceptance','weeklyReportProjection','officialStandings','draftMetadataAcceptance','draftMetadataProjection','draftSelectionsAcceptance','draftSelectionsProjection']
    OR provenance ? 'acquisition' OR octet_length(p_input::text)>33488896 THEN RAISE EXCEPTION 'mixed or oversized traded picks acceptance'; END IF;
  -- Timestamp casts alone admit locale/space forms rejected by the unchanged
  -- TypeScript normalizer. Require explicit ISO network clocks independently.
  IF jsonb_typeof(provenance) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'invalid traded picks provenance'; END IF;
  FOREACH clock_key IN ARRAY ARRAY['requestStartedAt','requestCompletedAt','checkedAt','sourceObservedAt'] LOOP
    IF clock_key='sourceObservedAt' AND provenance->clock_key='null'::jsonb THEN CONTINUE; END IF;
    IF jsonb_typeof(provenance->clock_key) IS DISTINCT FROM 'string'
      OR provenance->>clock_key !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9](\.[0-9]{1,6})?(Z|[+-](0[0-9]|1[0-5]):[0-5][0-9])$' THEN
      RAISE EXCEPTION 'invalid traded picks ISO clock'; END IF;
    IF NOT isfinite((provenance->>clock_key)::timestamptz) THEN RAISE EXCEPTION 'nonfinite traded picks clock'; END IF;
  END LOOP;
  IF p_input->'envelope'->>'family' IS DISTINCT FROM 'drafts' OR p_input->'envelope'->'week' IS DISTINCT FROM 'null'::jsonb
    OR p_input->'envelope'->'scope'->>'season' IS DISTINCT FROM '2026'
    OR p_input->'envelope'->'scope' IS DISTINCT FROM p_input->'sourceMapping'->'scope' OR p_input->'sourceMapping' IS NULL
    OR projection->>'version' IS DISTINCT FROM 'sleeper-traded-picks-v1' OR projection->>'status' IS NULL OR projection->>'status' NOT IN ('accepted','rejected')
    OR p_input->'envelope'->'payload'->>'tradedPicksVersion' IS DISTINCT FROM 'sleeper-traded-picks-v1'
    OR p_input->'envelope'->'payload'->>'kind' IS NULL OR p_input->'envelope'->'payload'->>'kind' NOT IN ('catalog','league','draft')
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
    OR (provenance->>'checkedAt')::timestamptz>clock_timestamp()+interval '5 minutes' THEN RAISE EXCEPTION 'invalid mapped traded picks network capture'; END IF;
  resource_entity:=CASE WHEN p_input->'envelope'->'payload'->>'kind'='draft' THEN 'draft:'||(p_input->'envelope'->'payload'->>'externalDraftId')||':traded-picks' ELSE p_input->'envelope'->'payload'->>'kind' END;
  IF resource_entity IS NULL THEN RAISE EXCEPTION 'missing draft resource identity'; END IF;
  -- Expanded JSON budgets raw, typed, mapping and provenance plus per-row relational framing.
  IF octet_length((p_input->'envelope'->'payload')::text)+octet_length((projection->'value')::text)
    +octet_length((p_input->'sourceMapping')::text)+octet_length(provenance::text)+65536
    +COALESCE(jsonb_array_length(projection->'value'->'entries'),0)*(2048
      +2*COALESCE(octet_length((p_input->'envelope'->'scope'->'externalLeagueId')::text),0)
      +2*COALESCE(octet_length((p_input->'envelope'->'payload'->'externalDraftId')::text),0))>33554432 THEN
    RAISE EXCEPTION 'traded picks persistence budget exceeded'; END IF;
  -- The prior writer owns job -> league/source -> legacy-head locking. Preserve
  -- that order before obtaining the typed resource head; all later failures roll
  -- back this same SQL transaction, including the delegated legacy observation.
  result:=public.record_league_administration_observation_v54(p_input-'tradedPicksAcceptance'-'tradedPicksProjection'-'sourceMapping');
  PERFORM public.validate_current_roster_mapping(p_input->'sourceMapping');
  token:=addition->'attempt';
  SELECT * INTO STRICT attempt FROM public.league_roster_resource_attempts WHERE id=(token->>'id')::uuid;
  IF (provenance->>'requestStartedAt')::timestamptz<attempt.reserved_at THEN RAISE EXCEPTION 'draft request predates reservation'; END IF;
  IF attempt.source_mapping IS DISTINCT FROM p_input->'sourceMapping' OR attempt.write_fence IS DISTINCT FROM p_input->'writeFence'
    OR token IS DISTINCT FROM jsonb_build_object('id',attempt.id,'scopeId',attempt.scope_id,'ordinal',attempt.ordinal,'expectedGeneration',attempt.expected_generation)
    OR NOT EXISTS(SELECT 1 FROM public.league_roster_resource_scopes scope WHERE scope.id=attempt.scope_id
      AND scope.identity=jsonb_build_object('scope',jsonb_build_object('kind','enrolled-resource','connectionId',attempt.source_mapping->>'connectionId',
        'leagueSeasonId',attempt.source_mapping->>'leagueSeasonId','family','drafts','entityId',resource_entity,'scoringPeriodId',NULL,
        'audienceId','public','coverageSpecId','sleeper-traded-picks-v1'),'policy',jsonb_build_object('audienceId','public','coverageSpecId','sleeper-traded-picks-v1',
        'canonicalNormalizerVersion','sleeper-traded-picks-v1','validationVersion','latest-network-attempt-v1'))) THEN RAISE EXCEPTION 'traded picks attempt scope mismatch'; END IF;
  SELECT * INTO STRICT head FROM public.league_roster_resource_heads WHERE scope_id=attempt.scope_id FOR UPDATE;
  IF attempt.write_fence IS NOT NULL THEN PERFORM public.assert_roster_player_link_fence(attempt.write_fence); END IF;
  evidence_hash_value:=encode(digest(convert_to(p_input::text,'UTF8'),'sha256'),'hex');
  SELECT * INTO receipt FROM public.league_roster_capture_receipts WHERE attempt_id=attempt.id;
  IF FOUND AND receipt.evidence_hash<>evidence_hash_value THEN RAISE EXCEPTION 'traded picks attempt receipt conflict'; END IF;
  IF attempt.write_fence IS NOT NULL THEN PERFORM public.assert_roster_player_link_fence(attempt.write_fence); END IF;
  SELECT * INTO STRICT content FROM public.league_administration_contents stored
    WHERE stored.league_season_id=(attempt.source_mapping->>'leagueSeasonId')::uuid AND stored.provider='sleeper'
      AND stored.external_league_id=attempt.source_mapping->'scope'->>'externalLeagueId' AND stored.family='drafts' AND stored.week=0
      AND stored.normalizer_version='sleeper-administration-v1' AND stored.content_hash=p_input->>'contentHash'
      AND stored.completeness=p_input->'envelope'->>'completeness' AND NOT stored.accepted
      AND stored.payload=p_input->'envelope'->'payload' AND stored.normalized_value IS NOT DISTINCT FROM p_input->'value';
  IF projection->>'status'='accepted' THEN
    expected:=public.project_traded_picks_native(content.payload,content.external_league_id,content.completeness='complete');
    IF expected IS NULL OR projection->'value' IS DISTINCT FROM expected OR projection->'diagnostics' IS DISTINCT FROM '[]'::jsonb THEN RAISE EXCEPTION 'traded picks projection mismatch'; END IF;
    covered:=(expected->>'complete')::boolean;
  ELSIF projection->'value' IS DISTINCT FROM 'null'::jsonb OR jsonb_typeof(projection->'diagnostics') IS DISTINCT FROM 'array'
    OR jsonb_array_length(projection->'diagnostics')=0 THEN RAISE EXCEPTION 'invalid traded picks rejection evidence'; END IF;
  IF receipt.id IS NOT NULL THEN
    IF receipt.content_id<>content.id THEN RAISE EXCEPTION 'draft replay content mismatch'; END IF;
    IF attempt.write_fence IS NOT NULL THEN PERFORM public.assert_roster_player_link_fence(attempt.write_fence); END IF;
    RETURN result||jsonb_build_object('tradedPicksAcceptance',jsonb_build_object('status',CASE WHEN EXISTS(
      SELECT 1 FROM public.league_roster_resource_acceptances accepted WHERE accepted.id=head.accepted_id AND accepted.receipt_id=receipt.id)
      THEN 'accepted' ELSE 'preserved' END,'reason','exact_receipt_replay','receiptId',receipt.id,'acceptedGeneration',head.generation));
  END IF;
  INSERT INTO public.league_roster_capture_receipts(attempt_id,content_id,legacy_observation_id,evidence_hash,provenance,coverage)
    VALUES(attempt.id,content.id,(result->>'observationId')::uuid,evidence_hash_value,provenance,
      jsonb_build_object('periodIds','[]'::jsonb,'interval',NULL,'entitySet',CASE WHEN covered THEN 'full' ELSE 'unknown' END,
        'fields','["season","round","roster_id","owner_id","previous_owner_id"]'::jsonb,
        'pagination',CASE WHEN covered THEN 'complete' ELSE 'unknown' END,'nextCursor',NULL,
        'completeness',CASE WHEN covered THEN 'complete' ELSE 'partial' END,
        'reasons',CASE WHEN covered THEN '[]'::jsonb ELSE '["traded_picks_incomplete"]'::jsonb END)) RETURNING * INTO receipt;
  IF expected IS NOT NULL THEN PERFORM public.capture_traded_picks_typed(content.id,receipt.id,expected); END IF;
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
  RETURN result||jsonb_build_object('tradedPicksAcceptance',jsonb_build_object('status',CASE WHEN acceptance_id IS NULL THEN 'preserved' ELSE 'accepted' END,
    'reason',CASE WHEN acceptance_id IS NOT NULL THEN NULL WHEN attempt.ordinal<>head.latest_ordinal THEN 'newer_network_attempt_reserved'
      WHEN attempt.expected_generation<>head.generation THEN 'accepted_generation_changed' WHEN NOT covered THEN 'traded_picks_incomplete' ELSE 'traded_picks_source_not_newer' END,
    'receiptId',receipt.id,'acceptedGeneration',head.generation));
END; $$;



-- Existing CP17 deferred receipt/acceptance fence triggers cover all drafts resources.
REVOKE ALL ON FUNCTION public.record_league_administration_observation(jsonb) FROM PUBLIC;
REVOKE ALL ON public.league_traded_pick_assets,public.league_traded_pick_contents,public.league_traded_pick_catalog_entries,public.league_traded_pick_entries FROM PUBLIC;
REVOKE ALL ON FUNCTION public.traded_pick_field(jsonb,text,text),public.traded_pick_facts(jsonb,integer,text,text),public.project_traded_picks_native(jsonb,text,boolean),public.traded_picks_typed_value(uuid),public.capture_traded_picks_typed(uuid,uuid,jsonb),public.validate_traded_picks_typed_lineage(),public.guard_traded_picks_child_insert(),public.record_league_administration_observation_v54(jsonb),public.begin_traded_picks_attempt(jsonb,jsonb,uuid,jsonb) FROM PUBLIC;
DO $$ BEGIN
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='league_one_runtime') THEN
    REVOKE ALL ON public.league_traded_pick_assets,public.league_traded_pick_contents,public.league_traded_pick_catalog_entries,public.league_traded_pick_entries FROM league_one_runtime;
    GRANT SELECT ON public.league_traded_pick_assets,public.league_traded_pick_contents,public.league_traded_pick_catalog_entries,public.league_traded_pick_entries TO league_one_runtime;
    REVOKE ALL ON FUNCTION public.traded_pick_field(jsonb,text,text),public.traded_pick_facts(jsonb,integer,text,text),public.project_traded_picks_native(jsonb,text,boolean),public.traded_picks_typed_value(uuid),public.capture_traded_picks_typed(uuid,uuid,jsonb),public.validate_traded_picks_typed_lineage(),public.guard_traded_picks_child_insert(),public.record_league_administration_observation_v54(jsonb) FROM league_one_runtime;
    GRANT EXECUTE ON FUNCTION public.begin_traded_picks_attempt(jsonb,jsonb,uuid,jsonb),public.record_league_administration_observation(jsonb) TO league_one_runtime;
  END IF;
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='league_one_auth') THEN
    REVOKE ALL ON public.league_traded_pick_assets,public.league_traded_pick_contents,public.league_traded_pick_catalog_entries,public.league_traded_pick_entries FROM league_one_auth;
    REVOKE ALL ON FUNCTION public.traded_pick_field(jsonb,text,text),public.traded_pick_facts(jsonb,integer,text,text),public.project_traded_picks_native(jsonb,text,boolean),public.traded_picks_typed_value(uuid),public.capture_traded_picks_typed(uuid,uuid,jsonb),public.validate_traded_picks_typed_lineage(),public.guard_traded_picks_child_insert(),public.record_league_administration_observation_v54(jsonb),public.begin_traded_picks_attempt(jsonb,jsonb,uuid,jsonb) FROM league_one_auth;
  END IF;
END; $$;
