-- CP11 typed bracket observations. Opt-in to the existing resource acceptance owner; no backfill or intake scheduling.
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
          WHEN scope.identity->'scope'->>'family'='playoff-brackets' AND scope.identity->'scope'->>'entityId' IN ('winners_bracket','losers_bracket')
            AND scope.identity->'scope'->'scoringPeriodId'='null'::jsonb THEN scope.identity->'scope'->>'entityId'
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
          OR (scope.identity->'scope'->>'family' IN ('transactions','playoff-brackets') AND receipt.configuration_content_id IS NULL
            AND receipt.population_evidence IS NULL AND receipt.expected_team_count IS NULL)
          OR (scope.identity->'scope'->>'family' NOT IN ('league-season','transactions','playoff-brackets') AND receipt.configuration_content_id IS NOT NULL
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

CREATE FUNCTION public.bracket_native_field(p_row jsonb,p_key text,p_kind text)
RETURNS jsonb LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE raw jsonb:=p_row->p_key; value jsonb; outcome text; native_id text;
BEGIN
  IF NOT p_row ? p_key THEN RETURN jsonb_build_object('state','missing','raw',NULL,'value',NULL); END IF;
  IF raw='null'::jsonb THEN RETURN jsonb_build_object('state','null','raw',NULL,'value',NULL); END IF;
  IF p_kind='opaque' THEN value:=raw;
  ELSIF p_kind='reference' OR (p_kind='entrant' AND jsonb_typeof(raw)='object') THEN
    IF jsonb_typeof(raw) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'invalid bracket reference'; END IF;
    IF NULLIF(raw->'w','null'::jsonb) IS NOT NULL AND NULLIF(raw->'l','null'::jsonb) IS NOT NULL THEN RAISE EXCEPTION 'conflicting bracket reference'; END IF;
    outcome:=CASE WHEN NULLIF(raw->'w','null'::jsonb) IS NOT NULL THEN 'winner' WHEN NULLIF(raw->'l','null'::jsonb) IS NOT NULL THEN 'loser' END;
    IF outcome IS NULL THEN RETURN jsonb_build_object('state','unsupported','raw',raw,'value',NULL); END IF;
    native_id:=raw->>CASE WHEN outcome='winner' THEN 'w' ELSE 'l' END;
    IF jsonb_typeof(raw->CASE WHEN outcome='winner' THEN 'w' ELSE 'l' END) IS DISTINCT FROM 'number'
      OR native_id !~ '^[1-9][0-9]*$' OR native_id::numeric>9007199254740991 THEN RAISE EXCEPTION 'invalid bracket reference identity'; END IF;
    value:=jsonb_build_object('outcome',outcome,'externalMatchupId',native_id);
    IF p_kind='entrant' THEN value:=value||jsonb_build_object('kind','advancement'); END IF;
  ELSE
    native_id:=raw#>>'{}';
    IF jsonb_typeof(raw) NOT IN ('number','string') OR native_id !~ '^[1-9][0-9]*$'
      OR native_id::numeric>9007199254740991 THEN RAISE EXCEPTION 'invalid bracket roster identity'; END IF;
    value:=CASE WHEN p_kind='entrant' THEN jsonb_build_object('kind','roster','externalRosterId',native_id) ELSE to_jsonb(native_id) END;
  END IF;
  RETURN jsonb_build_object('state','supplied','raw',raw,'value',value);
END; $$;

CREATE FUNCTION public.project_bracket_native(p_payload jsonb,p_family text,p_normalized jsonb)
RETURNS jsonb LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE raw jsonb; source_ordinal bigint; native_id text; round_value bigint; slot integer;
  entrants jsonb; native_fact jsonb; from_fact jsonb; winner jsonb; loser jsonb; embedded jsonb; explicit_ref jsonb; chosen jsonb;
  matches jsonb:='[]'; edges jsonb:='[]'; rounds jsonb; limitations jsonb:='[]'; normalized_matches jsonb:='[]';
  first_roster text; second_roster text; edge jsonb; source_match jsonb; target_match jsonb; source_result jsonb; target_entrant jsonb; remaining_edges jsonb; next_edges jsonb;
BEGIN
  IF p_family NOT IN ('winners_bracket','losers_bracket') OR p_payload IS NULL THEN RAISE EXCEPTION 'invalid bracket family or payload'; END IF;
  IF p_payload='null'::jsonb THEN
    IF p_normalized IS DISTINCT FROM jsonb_build_object('family',p_family,'matches','[]'::jsonb) THEN RAISE EXCEPTION 'bracket legacy normalization mismatch'; END IF;
    RETURN jsonb_build_object('family',p_family,'season',2026,'publication','unpublished','rounds','[]'::jsonb,'matches','[]'::jsonb,'edges','[]'::jsonb,'limitations','[]'::jsonb);
  END IF;
  -- PostgreSQL expanded JSON text has a separate 16 MiB safety envelope; the caller's compact source cap is 8 MiB.
  IF jsonb_typeof(p_payload)<>'array' OR jsonb_array_length(p_payload)>1024 OR octet_length(p_payload::text)>16777216 THEN RAISE EXCEPTION 'bracket capacity or type exceeded'; END IF;
  FOR raw,source_ordinal IN SELECT item.value,item.ordinality FROM jsonb_array_elements(p_payload) WITH ORDINALITY item LOOP
    native_id:=raw->>'m';
    IF jsonb_typeof(raw)<>'object' OR jsonb_typeof(raw->'m') IS DISTINCT FROM 'number' OR native_id !~ '^[1-9][0-9]*$'
      OR native_id::numeric>9007199254740991 OR jsonb_typeof(raw->'r') IS DISTINCT FROM 'number'
      OR raw->>'r' !~ '^[1-9][0-9]*$' OR (raw->>'r')::numeric>9007199254740991 THEN RAISE EXCEPTION 'invalid native bracket match'; END IF;
    round_value:=(raw->>'r')::bigint;
    IF EXISTS(SELECT 1 FROM jsonb_array_elements(matches) item WHERE item->>'externalMatchupId'=native_id) THEN RAISE EXCEPTION 'duplicate bracket match'; END IF;
    entrants:='[]';
    FOR slot IN 1..2 LOOP
      native_fact:=public.bracket_native_field(raw,'t'||slot,'entrant'); from_fact:=public.bracket_native_field(raw,'t'||slot||'_from','reference');
      embedded:=CASE WHEN native_fact->'value'->>'kind'='advancement' THEN (native_fact->'value')-'kind' END;
      explicit_ref:=CASE WHEN from_fact->>'state'='supplied' THEN from_fact->'value' END;
      IF embedded IS NOT NULL AND explicit_ref IS NOT NULL AND embedded<>explicit_ref THEN RAISE EXCEPTION 'conflicting bracket advancement'; END IF;
      chosen:=COALESCE(explicit_ref,embedded);
      IF chosen->>'externalMatchupId'=native_id THEN RAISE EXCEPTION 'self referencing bracket'; END IF;
      entrants:=entrants||jsonb_build_array(jsonb_build_object('slot',slot,'native',native_fact,'from',from_fact));
      IF native_fact->>'state'='unsupported' OR from_fact->>'state'='unsupported' THEN limitations:=limitations||'"unsupported_entrant_reference"'::jsonb; END IF;
      IF chosen IS NOT NULL THEN
        edges:=edges||jsonb_build_array(jsonb_build_object('targetMatchupId',native_id,'slot',slot,'sourceMatchupId',chosen->>'externalMatchupId',
          'outcome',chosen->>'outcome','origin',CASE WHEN explicit_ref IS NOT NULL AND embedded IS NOT NULL THEN 'both' WHEN explicit_ref IS NOT NULL THEN 'explicit' ELSE 'embedded' END,
          'sourceMatchPresent',EXISTS(SELECT 1 FROM jsonb_array_elements(p_payload) source WHERE source->>'m'=chosen->>'externalMatchupId')));
      END IF;
    END LOOP;
    winner:=public.bracket_native_field(raw,'w','roster'); loser:=public.bracket_native_field(raw,'l','roster');
    first_roster:=entrants->0->'native'->'value'->>'externalRosterId'; second_roster:=entrants->1->'native'->'value'->>'externalRosterId';
    IF first_roster IS NOT NULL AND first_roster=second_roster THEN RAISE EXCEPTION 'duplicate bracket entrants'; END IF;
    IF winner->>'state'='supplied' AND loser->>'state'='supplied' AND winner->'value'=loser->'value' THEN RAISE EXCEPTION 'contradictory bracket results'; END IF;
    IF first_roster IS NOT NULL AND second_roster IS NOT NULL AND ((winner->>'state'='supplied' AND winner->>'value' NOT IN (first_roster,second_roster))
      OR (loser->>'state'='supplied' AND loser->>'value' NOT IN (first_roster,second_roster))) THEN RAISE EXCEPTION 'result outside bracket entrants'; END IF;
    matches:=matches||jsonb_build_array(jsonb_build_object('externalMatchupId',native_id,'round',round_value,'sourceOrdinal',source_ordinal-1,
      'entrants',entrants,'winner',winner,'loser',loser,'nativePosition',public.bracket_native_field(raw,'p','opaque'),
      'extensions',raw-ARRAY['r','m','t1','t2','t1_from','t2_from','w','l','p']));
    normalized_matches:=normalized_matches||jsonb_build_array(jsonb_build_object('externalMatchupId',native_id,'round',round_value,
      'teamOneExternalRosterId',first_roster,'teamTwoExternalRosterId',second_roster,'winnerExternalRosterId',winner->'value','loserExternalRosterId',loser->'value',
      'teamOneFrom',COALESCE(CASE WHEN entrants->0->'from'->>'state'='supplied' THEN entrants->0->'from'->'value' END,
        CASE WHEN entrants->0->'native'->'value'->>'kind'='advancement' THEN (entrants->0->'native'->'value')-'kind' END),
      'teamTwoFrom',COALESCE(CASE WHEN entrants->1->'from'->>'state'='supplied' THEN entrants->1->'from'->'value' END,
        CASE WHEN entrants->1->'native'->'value'->>'kind'='advancement' THEN (entrants->1->'native'->'value')-'kind' END)));
  END LOOP;
  IF p_normalized IS DISTINCT FROM jsonb_build_object('family',p_family,'matches',normalized_matches) THEN RAISE EXCEPTION 'bracket legacy normalization mismatch'; END IF;
  FOR edge IN SELECT value FROM jsonb_array_elements(edges) LOOP
    IF NOT (edge->>'sourceMatchPresent')::boolean THEN limitations:=limitations||'"unresolved_advancement_source"'::jsonb; CONTINUE; END IF;
    SELECT value INTO STRICT source_match FROM jsonb_array_elements(matches) WHERE value->>'externalMatchupId'=edge->>'sourceMatchupId';
    SELECT value INTO STRICT target_match FROM jsonb_array_elements(matches) WHERE value->>'externalMatchupId'=edge->>'targetMatchupId';
    source_result:=source_match->(edge->>'outcome'); target_entrant:=target_match->'entrants'->((edge->>'slot')::integer-1)->'native'->'value';
    IF source_result->>'state'='supplied' AND target_entrant->>'kind'='roster' AND source_result->>'value'<>target_entrant->>'externalRosterId' THEN RAISE EXCEPTION 'resolved advancement conflict'; END IF;
  END LOOP;
  -- Bounded Kahn elimination; no enumeration of all possible graph paths.
  SELECT COALESCE(jsonb_agg(value),'[]'::jsonb) INTO remaining_edges FROM jsonb_array_elements(edges) WHERE (value->>'sourceMatchPresent')::boolean;
  WHILE jsonb_array_length(remaining_edges)>0 LOOP
    SELECT COALESCE(jsonb_agg(e.value),'[]'::jsonb) INTO next_edges FROM jsonb_array_elements(remaining_edges) e
      WHERE EXISTS(SELECT 1 FROM jsonb_array_elements(remaining_edges) predecessor WHERE predecessor->>'targetMatchupId'=e.value->>'sourceMatchupId');
    IF jsonb_array_length(next_edges)=jsonb_array_length(remaining_edges) THEN RAISE EXCEPTION 'cyclic bracket advancement'; END IF;
    remaining_edges:=next_edges;
  END LOOP;
  SELECT COALESCE(jsonb_agg(jsonb_build_object('round',round_number,'externalMatchupIds',ids) ORDER BY round_number),'[]'::jsonb) INTO rounds
    FROM (SELECT (item->>'round')::bigint AS round_number,jsonb_agg(item->'externalMatchupId' ORDER BY (item->>'sourceOrdinal')::integer) AS ids
      FROM jsonb_array_elements(matches) item GROUP BY (item->>'round')::bigint) grouped;
  SELECT COALESCE(jsonb_agg(value ORDER BY value),'[]'::jsonb) INTO limitations FROM (SELECT DISTINCT value FROM jsonb_array_elements(limitations)) unique_limits;
  RETURN jsonb_build_object('family',p_family,'season',2026,'publication','published','rounds',rounds,'matches',matches,'edges',edges,'limitations',limitations);
END; $$;

CREATE TABLE public.league_bracket_contents (
  content_id uuid PRIMARY KEY REFERENCES public.league_administration_contents(id),
  first_acceptance_id uuid NOT NULL REFERENCES public.league_roster_resource_acceptances(id),
  capture_transaction xid8 NOT NULL DEFAULT pg_current_xact_id(),
  value_version text NOT NULL CHECK(value_version='sleeper-playoff-brackets-v1'),
  family text NOT NULL CHECK(family IN ('winners_bracket','losers_bracket')),
  publication text NOT NULL CHECK(publication IN ('published','unpublished')),
  match_count integer NOT NULL CHECK(match_count BETWEEN 0 AND 1024), round_count integer NOT NULL CHECK(round_count BETWEEN 0 AND 1024),
  edge_count integer NOT NULL CHECK(edge_count BETWEEN 0 AND 2048), limitations jsonb NOT NULL CHECK(jsonb_typeof(limitations)='array'),
  CHECK(publication='published' OR (match_count=0 AND round_count=0 AND edge_count=0))
);
CREATE TABLE public.league_bracket_rounds (
  content_id uuid NOT NULL REFERENCES public.league_bracket_contents(content_id), round bigint NOT NULL CHECK(round BETWEEN 1 AND 9007199254740991),
  external_matchup_ids text[] NOT NULL, PRIMARY KEY(content_id,round)
);
CREATE TABLE public.league_bracket_matches (
  content_id uuid NOT NULL REFERENCES public.league_bracket_contents(content_id), external_matchup_id text NOT NULL,
  round bigint NOT NULL, source_ordinal integer NOT NULL CHECK(source_ordinal BETWEEN 0 AND 1023),
  native_position jsonb NOT NULL, extensions jsonb NOT NULL CHECK(jsonb_typeof(extensions)='object'),
  PRIMARY KEY(content_id,external_matchup_id), UNIQUE(content_id,source_ordinal),
  FOREIGN KEY(content_id,round) REFERENCES public.league_bracket_rounds(content_id,round)
);
CREATE TABLE public.league_bracket_entrants (
  content_id uuid NOT NULL, external_matchup_id text NOT NULL, slot smallint NOT NULL CHECK(slot IN (1,2)),
  native_state text NOT NULL CHECK(native_state IN ('missing','null','supplied','unsupported')), native_raw jsonb,
  native_kind text CHECK(native_kind IN ('roster','advancement')), external_roster_id text,
  native_outcome text CHECK(native_outcome IN ('winner','loser')), native_source_matchup_id text,
  from_state text NOT NULL CHECK(from_state IN ('missing','null','supplied','unsupported')), from_raw jsonb,
  from_outcome text CHECK(from_outcome IN ('winner','loser')), from_source_matchup_id text,
  PRIMARY KEY(content_id,external_matchup_id,slot), FOREIGN KEY(content_id,external_matchup_id) REFERENCES public.league_bracket_matches(content_id,external_matchup_id),
  CHECK((native_state='supplied')=(native_kind IS NOT NULL)), CHECK((native_kind='roster') IS NOT DISTINCT FROM (external_roster_id IS NOT NULL) OR native_kind IS NULL AND external_roster_id IS NULL),
  CHECK((native_kind='advancement') IS NOT DISTINCT FROM (native_outcome IS NOT NULL) OR native_kind IS NULL AND native_outcome IS NULL),
  CHECK((native_outcome IS NOT NULL)=(native_source_matchup_id IS NOT NULL)), CHECK((from_state='supplied')=(from_outcome IS NOT NULL)),
  CHECK((from_outcome IS NOT NULL)=(from_source_matchup_id IS NOT NULL))
);
CREATE TABLE public.league_bracket_results (
  content_id uuid NOT NULL, external_matchup_id text NOT NULL, outcome text NOT NULL CHECK(outcome IN ('winner','loser')),
  field_state text NOT NULL CHECK(field_state IN ('missing','null','supplied')), raw_value jsonb, external_roster_id text,
  PRIMARY KEY(content_id,external_matchup_id,outcome), FOREIGN KEY(content_id,external_matchup_id) REFERENCES public.league_bracket_matches(content_id,external_matchup_id),
  CHECK((field_state='supplied')=(external_roster_id IS NOT NULL))
);
CREATE TABLE public.league_bracket_edges (
  content_id uuid NOT NULL, target_matchup_id text NOT NULL, slot smallint NOT NULL CHECK(slot IN (1,2)), source_matchup_id text NOT NULL,
  outcome text NOT NULL CHECK(outcome IN ('winner','loser')), origin text NOT NULL CHECK(origin IN ('embedded','explicit','both')), source_match_present boolean NOT NULL,
  PRIMARY KEY(content_id,target_matchup_id,slot), FOREIGN KEY(content_id,target_matchup_id,slot) REFERENCES public.league_bracket_entrants(content_id,external_matchup_id,slot)
);
CREATE FUNCTION public.bracket_typed_value(p_content_id uuid)
RETURNS jsonb LANGUAGE sql STABLE SET search_path=pg_catalog,public,pg_temp AS $$
  SELECT jsonb_build_object('family',header.family,'season',2026,'publication',header.publication,
    'rounds',(SELECT COALESCE(jsonb_agg(jsonb_build_object('round',r.round,'externalMatchupIds',r.external_matchup_ids) ORDER BY r.round),'[]'::jsonb)
      FROM public.league_bracket_rounds r WHERE r.content_id=header.content_id),
    'matches',(SELECT COALESCE(jsonb_agg(jsonb_build_object('externalMatchupId',m.external_matchup_id,'round',m.round,'sourceOrdinal',m.source_ordinal,
      'entrants',(SELECT COALESCE(jsonb_agg(jsonb_build_object('slot',e.slot,
        'native',jsonb_build_object('state',e.native_state,'raw',e.native_raw,'value',CASE WHEN e.native_kind='roster' THEN jsonb_build_object('kind','roster','externalRosterId',e.external_roster_id)
          WHEN e.native_kind='advancement' THEN jsonb_build_object('kind','advancement','outcome',e.native_outcome,'externalMatchupId',e.native_source_matchup_id) END),
        'from',jsonb_build_object('state',e.from_state,'raw',e.from_raw,'value',CASE WHEN e.from_state='supplied' THEN jsonb_build_object('outcome',e.from_outcome,'externalMatchupId',e.from_source_matchup_id) END)) ORDER BY e.slot),'[]'::jsonb)
        FROM public.league_bracket_entrants e WHERE e.content_id=m.content_id AND e.external_matchup_id=m.external_matchup_id),
      'winner',(SELECT jsonb_build_object('state',r.field_state,'raw',r.raw_value,'value',r.external_roster_id) FROM public.league_bracket_results r WHERE r.content_id=m.content_id AND r.external_matchup_id=m.external_matchup_id AND r.outcome='winner'),
      'loser',(SELECT jsonb_build_object('state',r.field_state,'raw',r.raw_value,'value',r.external_roster_id) FROM public.league_bracket_results r WHERE r.content_id=m.content_id AND r.external_matchup_id=m.external_matchup_id AND r.outcome='loser'),
      'nativePosition',m.native_position,'extensions',m.extensions) ORDER BY m.source_ordinal),'[]'::jsonb) FROM public.league_bracket_matches m WHERE m.content_id=header.content_id),
    'edges',(SELECT COALESCE(jsonb_agg(jsonb_build_object('targetMatchupId',e.target_matchup_id,'slot',e.slot,'sourceMatchupId',e.source_matchup_id,
      'outcome',e.outcome,'origin',e.origin,'sourceMatchPresent',e.source_match_present) ORDER BY m.source_ordinal,e.slot),'[]'::jsonb)
      FROM public.league_bracket_edges e JOIN public.league_bracket_matches m ON m.content_id=e.content_id AND m.external_matchup_id=e.target_matchup_id WHERE e.content_id=header.content_id),
    'limitations',header.limitations) FROM public.league_bracket_contents header WHERE header.content_id=p_content_id
$$;
CREATE FUNCTION public.validate_bracket_typed_lineage()
RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE content public.league_administration_contents%ROWTYPE; header public.league_bracket_contents%ROWTYPE; expected jsonb; fence jsonb;
BEGIN
  SELECT * INTO STRICT header FROM public.league_bracket_contents WHERE content_id=NEW.content_id;
  SELECT * INTO STRICT content FROM public.league_administration_contents WHERE id=NEW.content_id;
  SELECT attempt.write_fence INTO STRICT fence FROM public.league_roster_resource_acceptances accepted
    JOIN public.league_roster_capture_receipts receipt ON receipt.id=accepted.receipt_id
    JOIN public.league_roster_resource_attempts attempt ON attempt.id=receipt.attempt_id WHERE accepted.id=header.first_acceptance_id;
  IF fence IS NOT NULL THEN PERFORM public.assert_roster_player_link_fence(fence); END IF;
  IF NOT EXISTS(SELECT 1 FROM public.league_roster_resource_acceptances accepted
    JOIN public.league_roster_capture_receipts receipt ON receipt.id=accepted.receipt_id
    JOIN public.league_roster_resource_scopes scope ON scope.id=accepted.scope_id
    JOIN public.league_seasons season ON season.id=scope.league_season_id
    WHERE accepted.id=header.first_acceptance_id AND receipt.content_id=content.id
      AND scope.league_season_id=content.league_season_id AND season.season=2026
      AND scope.identity->'scope'->>'family'='playoff-brackets' AND scope.identity->'scope'->>'entityId'=content.family
      AND scope.identity->'scope'->'scoringPeriodId'='null'::jsonb
      AND scope.identity->'policy'=jsonb_build_object('audienceId','public','coverageSpecId','sleeper-playoff-brackets-v1',
        'canonicalNormalizerVersion','sleeper-playoff-brackets-v1','validationVersion','latest-network-attempt-v1')
      AND content.provider='sleeper' AND content.family=header.family AND content.week=0 AND content.accepted AND content.completeness='complete') THEN
    RAISE EXCEPTION 'bracket typed acceptance lineage mismatch'; END IF;
  expected:=public.project_bracket_native(content.payload,content.family,content.normalized_value);
  IF public.bracket_typed_value(content.id) IS DISTINCT FROM expected
    OR header.match_count<>jsonb_array_length(expected->'matches') OR header.round_count<>jsonb_array_length(expected->'rounds')
    OR header.edge_count<>jsonb_array_length(expected->'edges') THEN RAISE EXCEPTION 'bracket typed native parity mismatch'; END IF;
  IF fence IS NOT NULL THEN PERFORM public.assert_roster_player_link_fence(fence); END IF;
  RETURN NEW;
END; $$;
-- Child rows can only be inserted in the transaction that created the immutable header.
-- One deferred header check then validates the entire relational graph at commit.
CREATE FUNCTION public.guard_bracket_child_insert()
RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
  IF NOT EXISTS(SELECT 1 FROM public.league_bracket_contents header WHERE header.content_id=NEW.content_id
    AND header.capture_transaction=pg_current_xact_id()) THEN RAISE EXCEPTION 'bracket history cannot gain later facts'; END IF;
  RETURN NEW;
END; $$;
CREATE CONSTRAINT TRIGGER bracket_typed_lineage AFTER INSERT ON public.league_bracket_contents
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.validate_bracket_typed_lineage();
DO $$ DECLARE name text; BEGIN
  FOREACH name IN ARRAY ARRAY['league_bracket_contents','league_bracket_rounds','league_bracket_matches','league_bracket_entrants','league_bracket_results','league_bracket_edges'] LOOP
    EXECUTE format('CREATE TRIGGER bracket_history_immutable BEFORE UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.prevent_league_administration_history_change()',name);
    IF name<>'league_bracket_contents' THEN EXECUTE format('CREATE TRIGGER bracket_child_insert BEFORE INSERT ON public.%I FOR EACH ROW EXECUTE FUNCTION public.guard_bracket_child_insert()',name); END IF;
  END LOOP;
END; $$;

-- Every new bracket acceptance is fenced at deferred execution, including reused content.
CREATE FUNCTION public.validate_bracket_acceptance_fence()
RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE fence jsonb;
BEGIN
  IF NOT EXISTS(SELECT 1 FROM public.league_roster_resource_scopes scope WHERE scope.id=NEW.scope_id
    AND scope.identity->'scope'->>'family'='playoff-brackets') THEN RETURN NEW; END IF;
  SELECT attempt.write_fence INTO STRICT fence FROM public.league_roster_capture_receipts receipt
    JOIN public.league_roster_resource_attempts attempt ON attempt.id=receipt.attempt_id WHERE receipt.id=NEW.receipt_id;
  IF fence IS NOT NULL THEN PERFORM public.assert_roster_player_link_fence(fence); END IF;
  RETURN NEW;
END; $$;
CREATE CONSTRAINT TRIGGER bracket_acceptance_fence AFTER INSERT ON public.league_roster_resource_acceptances
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.validate_bracket_acceptance_fence();

CREATE FUNCTION public.capture_bracket_typed(p_content_id uuid,p_acceptance_id uuid,p_value jsonb)
RETURNS void LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE created uuid; item jsonb; entrant jsonb; fact jsonb; outcome text;
BEGIN
  INSERT INTO public.league_bracket_contents(content_id,first_acceptance_id,value_version,family,publication,match_count,round_count,edge_count,limitations)
    VALUES(p_content_id,p_acceptance_id,'sleeper-playoff-brackets-v1',p_value->>'family',p_value->>'publication',jsonb_array_length(p_value->'matches'),
      jsonb_array_length(p_value->'rounds'),jsonb_array_length(p_value->'edges'),p_value->'limitations') ON CONFLICT DO NOTHING RETURNING content_id INTO created;
  IF created IS NOT NULL THEN
    FOR item IN SELECT value FROM jsonb_array_elements(p_value->'rounds') LOOP
      INSERT INTO public.league_bracket_rounds(content_id,round,external_matchup_ids) VALUES(p_content_id,(item->>'round')::bigint,
        ARRAY(SELECT jsonb_array_elements_text(item->'externalMatchupIds')));
    END LOOP;
    FOR item IN SELECT value FROM jsonb_array_elements(p_value->'matches') LOOP
      INSERT INTO public.league_bracket_matches(content_id,external_matchup_id,round,source_ordinal,native_position,extensions)
        VALUES(p_content_id,item->>'externalMatchupId',(item->>'round')::bigint,(item->>'sourceOrdinal')::integer,item->'nativePosition',item->'extensions');
      FOR entrant IN SELECT value FROM jsonb_array_elements(item->'entrants') LOOP
        INSERT INTO public.league_bracket_entrants(content_id,external_matchup_id,slot,native_state,native_raw,native_kind,external_roster_id,
          native_outcome,native_source_matchup_id,from_state,from_raw,from_outcome,from_source_matchup_id)
        VALUES(p_content_id,item->>'externalMatchupId',(entrant->>'slot')::smallint,entrant->'native'->>'state',entrant->'native'->'raw',
          entrant->'native'->'value'->>'kind',entrant->'native'->'value'->>'externalRosterId',entrant->'native'->'value'->>'outcome',entrant->'native'->'value'->>'externalMatchupId',
          entrant->'from'->>'state',entrant->'from'->'raw',entrant->'from'->'value'->>'outcome',entrant->'from'->'value'->>'externalMatchupId');
      END LOOP;
      FOREACH outcome IN ARRAY ARRAY['winner','loser'] LOOP
        fact:=item->outcome;
        INSERT INTO public.league_bracket_results(content_id,external_matchup_id,outcome,field_state,raw_value,external_roster_id)
          VALUES(p_content_id,item->>'externalMatchupId',outcome,fact->>'state',fact->'raw',fact->>'value');
      END LOOP;
    END LOOP;
    FOR item IN SELECT value FROM jsonb_array_elements(p_value->'edges') LOOP
      INSERT INTO public.league_bracket_edges(content_id,target_matchup_id,slot,source_matchup_id,outcome,origin,source_match_present)
        VALUES(p_content_id,item->>'targetMatchupId',(item->>'slot')::smallint,item->>'sourceMatchupId',item->>'outcome',item->>'origin',(item->>'sourceMatchPresent')::boolean);
    END LOOP;
  END IF;
  IF public.bracket_typed_value(p_content_id) IS DISTINCT FROM p_value THEN RAISE EXCEPTION 'bracket typed materialization mismatch'; END IF;
END; $$;

CREATE FUNCTION public.begin_bracket_attempt(p_mapping jsonb,p_family text,p_id uuid,p_fence jsonb DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE scope_row public.league_roster_resource_scopes%ROWTYPE;
  attempt public.league_roster_resource_attempts%ROWTYPE;
  head public.league_roster_resource_heads%ROWTYPE;
  identity_value jsonb;
BEGIN
  IF p_id IS NULL OR p_family IS NULL OR p_family NOT IN ('winners_bracket','losers_bracket') OR p_mapping->'scope'->>'season' IS DISTINCT FROM '2026' THEN RAISE EXCEPTION 'invalid current-season bracket scope'; END IF;
  IF p_fence IS NOT NULL THEN
    PERFORM 1 FROM public.projection_jobs job WHERE job.job_key=p_fence->>'jobKey' AND job.state='running'
      AND job.lease_owner=p_fence->>'workerId' AND job.attempt_count=(p_fence->>'generation')::integer
      AND job.lease_until>clock_timestamp() AND (p_fence->>'deadlineAt')::timestamptz>clock_timestamp() FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'bracket reservation writer fence is stale'; END IF;
  END IF;
  PERFORM public.validate_current_roster_mapping(p_mapping);
  identity_value:=jsonb_build_object('scope',jsonb_build_object('kind','enrolled-resource',
    'connectionId',p_mapping->>'connectionId','leagueSeasonId',p_mapping->>'leagueSeasonId',
    'family','playoff-brackets','entityId',p_family,'scoringPeriodId',NULL,
    'audienceId','public','coverageSpecId','sleeper-playoff-brackets-v1'),
    'policy',jsonb_build_object('audienceId','public','coverageSpecId','sleeper-playoff-brackets-v1',
    'canonicalNormalizerVersion','sleeper-playoff-brackets-v1','validationVersion','latest-network-attempt-v1'));
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
    RAISE EXCEPTION 'bracket reservation writer fence expired'; END IF;
  SELECT * INTO attempt FROM public.league_roster_resource_attempts WHERE id=p_id;
  IF FOUND THEN
    IF attempt.scope_id<>scope_row.id OR attempt.source_mapping IS DISTINCT FROM p_mapping
      OR attempt.write_fence IS DISTINCT FROM p_fence THEN RAISE EXCEPTION 'bracket attempt identity conflict'; END IF;
  ELSE
    UPDATE public.league_roster_resource_heads SET latest_ordinal=latest_ordinal+1
      WHERE scope_id=scope_row.id RETURNING * INTO head;
    INSERT INTO public.league_roster_resource_attempts(id,scope_id,ordinal,expected_generation,source_mapping,write_fence)
      VALUES(p_id,scope_row.id,head.latest_ordinal,head.generation,p_mapping,p_fence) RETURNING * INTO attempt;
  END IF;
  RETURN jsonb_build_object('id',attempt.id,'scopeId',attempt.scope_id,'ordinal',attempt.ordinal,
    'expectedGeneration',attempt.expected_generation);
END; $$;

-- This is the sole existing observation entry point. Older calls delegate unchanged.
ALTER FUNCTION public.record_league_administration_observation(jsonb) RENAME TO record_league_administration_observation_v45;
CREATE FUNCTION public.record_league_administration_observation(p_input jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE result jsonb; addition jsonb:=p_input->'bracketAcceptance'; projection jsonb:=p_input->'bracketProjection'; expected jsonb; token jsonb;
  attempt public.league_roster_resource_attempts%ROWTYPE; head public.league_roster_resource_heads%ROWTYPE;
  content public.league_administration_contents%ROWTYPE; receipt public.league_roster_capture_receipts%ROWTYPE;
  provenance jsonb:=p_input->'envelope'->'provenance'; family_value text:=p_input->'envelope'->>'family';
  evidence_hash_value text; covered boolean:=false; acceptance_id uuid; legacy_current boolean:=false;
BEGIN
  IF addition IS NULL THEN RETURN public.record_league_administration_observation_v45(p_input); END IF;
  IF family_value NOT IN ('winners_bracket','losers_bracket') OR family_value IS NULL
    OR p_input->'envelope'->'week' IS DISTINCT FROM 'null'::jsonb
    OR p_input->'envelope'->'scope'->>'season' IS DISTINCT FROM '2026'
    OR p_input->'envelope'->'scope' IS DISTINCT FROM p_input->'sourceMapping'->'scope'
    OR p_input->'sourceMapping' IS NULL OR projection->>'version' IS DISTINCT FROM 'sleeper-playoff-brackets-v1'
    OR projection->>'status' IS NULL OR projection->>'status' NOT IN ('accepted','rejected')
    OR provenance->>'origin' IS DISTINCT FROM 'network'
    OR (provenance->>'requestStartedAt')::timestamptz IS NULL OR (provenance->>'requestCompletedAt')::timestamptz IS NULL
    OR ((provenance->>'sourceObservedAt')::timestamptz IS NULL AND projection->>'status'='accepted')
    OR (provenance->>'checkedAt')::timestamptz IS NULL
    OR (provenance->>'requestStartedAt')::timestamptz>(provenance->>'requestCompletedAt')::timestamptz
    OR (provenance->>'requestCompletedAt')::timestamptz>(provenance->>'checkedAt')::timestamptz
    OR (provenance->>'sourceObservedAt')::timestamptz>(provenance->>'checkedAt')::timestamptz
    OR (provenance->>'checkedAt')::timestamptz>clock_timestamp()+interval '5 minutes' THEN
    RAISE EXCEPTION 'bracket acceptance requires exact mapped network capture'; END IF;
  result:=public.record_league_administration_observation_v45(p_input-'bracketAcceptance'-'bracketProjection'-'sourceMapping');
  PERFORM public.validate_current_roster_mapping(p_input->'sourceMapping');
  token:=addition->'attempt';
  SELECT * INTO STRICT attempt FROM public.league_roster_resource_attempts WHERE id=(token->>'id')::uuid;
  IF (provenance->>'requestStartedAt')::timestamptz<attempt.reserved_at THEN RAISE EXCEPTION 'bracket request predates reservation'; END IF;
  IF attempt.source_mapping IS DISTINCT FROM p_input->'sourceMapping' OR attempt.write_fence IS DISTINCT FROM p_input->'writeFence'
    OR token IS DISTINCT FROM jsonb_build_object('id',attempt.id,'scopeId',attempt.scope_id,'ordinal',attempt.ordinal,'expectedGeneration',attempt.expected_generation)
    OR NOT EXISTS(SELECT 1 FROM public.league_roster_resource_scopes scope WHERE scope.id=attempt.scope_id
      AND scope.identity=jsonb_build_object('scope',jsonb_build_object('kind','enrolled-resource','connectionId',attempt.source_mapping->>'connectionId',
        'leagueSeasonId',attempt.source_mapping->>'leagueSeasonId','family','playoff-brackets','entityId',family_value,'scoringPeriodId',NULL,
        'audienceId','public','coverageSpecId','sleeper-playoff-brackets-v1'),'policy',jsonb_build_object('audienceId','public',
        'coverageSpecId','sleeper-playoff-brackets-v1','canonicalNormalizerVersion','sleeper-playoff-brackets-v1','validationVersion','latest-network-attempt-v1'))) THEN
    RAISE EXCEPTION 'bracket attempt scope mismatch'; END IF;
  SELECT * INTO STRICT head FROM public.league_roster_resource_heads WHERE scope_id=attempt.scope_id FOR UPDATE;
  IF attempt.write_fence IS NOT NULL THEN PERFORM public.assert_roster_player_link_fence(attempt.write_fence); END IF;
  SELECT * INTO STRICT content FROM public.league_administration_contents stored
    WHERE stored.league_season_id=(attempt.source_mapping->>'leagueSeasonId')::uuid AND stored.provider='sleeper'
      AND stored.external_league_id=attempt.source_mapping->'scope'->>'externalLeagueId' AND stored.family=family_value AND stored.week=0
      AND stored.normalizer_version='sleeper-administration-v1' AND stored.content_hash=p_input->>'contentHash'
      AND stored.completeness=p_input->'envelope'->>'completeness'
      AND stored.accepted=(p_input->>'status'='accepted' AND p_input->'envelope'->>'completeness'='complete')
      AND stored.payload=p_input->'envelope'->'payload' AND stored.normalized_value IS NOT DISTINCT FROM p_input->'value';
  legacy_current:=result->>'status' IN ('changed','unchanged','replayed') AND EXISTS(SELECT 1 FROM public.league_administration_heads legacy
    JOIN public.league_administration_observations observation ON observation.id=legacy.accepted_observation_id
    WHERE legacy.league_season_id=content.league_season_id AND legacy.family=family_value AND legacy.week=0 AND legacy.read_conflict IS NULL
      AND observation.content_id=content.id AND observation.id=(result->>'observationId')::uuid);
  IF projection->>'status'='accepted' THEN
    IF NOT content.accepted OR content.completeness<>'complete' OR projection->'diagnostics' IS DISTINCT FROM '[]'::jsonb THEN
      RAISE EXCEPTION 'unproved bracket projection'; END IF;
    expected:=public.project_bracket_native(content.payload,content.family,content.normalized_value);
    IF projection->'value' IS DISTINCT FROM expected THEN RAISE EXCEPTION 'bracket projection mismatch'; END IF;
    covered:=true;
  ELSIF projection->'value' IS DISTINCT FROM 'null'::jsonb OR jsonb_typeof(projection->'diagnostics') IS DISTINCT FROM 'array'
    OR jsonb_array_length(projection->'diagnostics')=0 THEN RAISE EXCEPTION 'invalid bracket rejection evidence'; END IF;
  evidence_hash_value:=encode(digest(convert_to(p_input::text,'UTF8'),'sha256'),'hex');
  SELECT * INTO receipt FROM public.league_roster_capture_receipts WHERE attempt_id=attempt.id;
  IF FOUND THEN
    IF receipt.evidence_hash<>evidence_hash_value THEN RAISE EXCEPTION 'bracket attempt receipt conflict'; END IF;
    IF attempt.write_fence IS NOT NULL THEN PERFORM public.assert_roster_player_link_fence(attempt.write_fence); END IF;
    RETURN result||jsonb_build_object('bracketAcceptance',jsonb_build_object('status',CASE WHEN attempt.ordinal=head.latest_ordinal AND EXISTS(
      SELECT 1 FROM public.league_roster_resource_acceptances accepted WHERE accepted.id=head.accepted_id AND accepted.receipt_id=receipt.id)
      THEN 'accepted' ELSE 'preserved' END,'reason','exact_receipt_replay','receiptId',receipt.id,'acceptedGeneration',head.generation));
  END IF;
  INSERT INTO public.league_roster_capture_receipts(attempt_id,content_id,legacy_observation_id,evidence_hash,provenance,coverage)
    VALUES(attempt.id,content.id,(result->>'observationId')::uuid,evidence_hash_value,provenance,
      jsonb_build_object('periodIds','[]'::jsonb,'interval',NULL,'entitySet',CASE WHEN covered THEN 'full' ELSE 'unknown' END,
        'fields','["r","m","t1","t2","t1_from","t2_from","w","l","p"]'::jsonb,'pagination','complete','nextCursor',NULL,
        'completeness',CASE WHEN covered THEN 'complete' WHEN content.completeness='partial' THEN 'partial' ELSE 'unknown' END,
        'reasons',CASE WHEN covered THEN '[]'::jsonb ELSE '["complete_bracket_structure_unproved"]'::jsonb END)) RETURNING * INTO receipt;
  IF attempt.ordinal=head.latest_ordinal AND attempt.expected_generation=head.generation AND covered AND legacy_current THEN
    IF attempt.write_fence IS NOT NULL THEN PERFORM public.assert_roster_player_link_fence(attempt.write_fence); END IF;
    INSERT INTO public.league_roster_resource_acceptances(scope_id,receipt_id,source_mapping_revision_id,generation)
      VALUES(attempt.scope_id,receipt.id,(attempt.source_mapping->>'revisionId')::uuid,head.generation+1) RETURNING id INTO acceptance_id;
    PERFORM public.capture_bracket_typed(content.id,acceptance_id,expected);
    IF attempt.write_fence IS NOT NULL THEN PERFORM public.assert_roster_player_link_fence(attempt.write_fence); END IF;
    UPDATE public.league_roster_resource_heads SET accepted_id=acceptance_id,generation=generation+1 WHERE scope_id=attempt.scope_id RETURNING * INTO head;
  END IF;
  IF attempt.write_fence IS NOT NULL THEN PERFORM public.assert_roster_player_link_fence(attempt.write_fence); END IF;
  RETURN result||jsonb_build_object('bracketAcceptance',jsonb_build_object('status',CASE WHEN acceptance_id IS NOT NULL THEN 'accepted' ELSE 'preserved' END,
    'reason',CASE WHEN acceptance_id IS NOT NULL THEN NULL WHEN attempt.ordinal<>head.latest_ordinal THEN 'newer_network_attempt_reserved'
      WHEN attempt.expected_generation<>head.generation THEN 'accepted_generation_changed' WHEN NOT covered THEN 'complete_bracket_structure_unproved'
      WHEN NOT legacy_current THEN 'legacy_bracket_not_current' END,'receiptId',receipt.id,'acceptedGeneration',head.generation));
END; $$;
REVOKE ALL ON public.league_bracket_contents,public.league_bracket_rounds,public.league_bracket_matches,
  public.league_bracket_entrants,public.league_bracket_results,public.league_bracket_edges FROM PUBLIC;
REVOKE ALL ON FUNCTION public.bracket_native_field(jsonb,text,text),public.project_bracket_native(jsonb,text,jsonb),public.bracket_typed_value(uuid),
  public.validate_bracket_typed_lineage(),public.validate_bracket_acceptance_fence(),public.guard_bracket_child_insert(),public.capture_bracket_typed(uuid,uuid,jsonb),public.begin_bracket_attempt(jsonb,text,uuid,jsonb),
  public.record_league_administration_observation_v45(jsonb),public.record_league_administration_observation(jsonb) FROM PUBLIC;
DO $$ BEGIN
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='league_one_runtime') THEN
    REVOKE ALL ON public.league_bracket_contents,public.league_bracket_rounds,public.league_bracket_matches,
      public.league_bracket_entrants,public.league_bracket_results,public.league_bracket_edges FROM league_one_runtime;
    GRANT SELECT ON public.league_bracket_contents,public.league_bracket_rounds,public.league_bracket_matches,
      public.league_bracket_entrants,public.league_bracket_results,public.league_bracket_edges TO league_one_runtime;
    REVOKE ALL ON FUNCTION public.bracket_native_field(jsonb,text,text),public.project_bracket_native(jsonb,text,jsonb),public.bracket_typed_value(uuid),
      public.validate_bracket_typed_lineage(),public.validate_bracket_acceptance_fence(),public.guard_bracket_child_insert(),public.capture_bracket_typed(uuid,uuid,jsonb),public.record_league_administration_observation_v45(jsonb) FROM league_one_runtime;
    GRANT EXECUTE ON FUNCTION public.begin_bracket_attempt(jsonb,text,uuid,jsonb),public.record_league_administration_observation(jsonb) TO league_one_runtime;
  END IF;
END; $$;
