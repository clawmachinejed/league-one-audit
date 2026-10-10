-- CP10: immutable native values supplement the existing exact-matchup acceptance.
-- No backfill, new source input, accepted-head policy, v1 normalization or receipt change.
CREATE FUNCTION public.exact_matchup_native_state(p_row jsonb,p_key text,p_type text)
RETURNS text LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
  IF NOT p_row ? p_key THEN RETURN 'missing'; END IF;
  IF p_row->p_key='null'::jsonb THEN RETURN 'null'; END IF;
  IF jsonb_typeof(p_row->p_key) IS DISTINCT FROM p_type THEN RAISE EXCEPTION 'invalid native matchup field'; END IF;
  RETURN 'supplied';
END; $$;

CREATE TABLE public.league_exact_matchup_value_contents (
  content_id uuid PRIMARY KEY REFERENCES public.league_administration_contents(id),
  first_acceptance_id uuid NOT NULL REFERENCES public.league_roster_resource_acceptances(id),
  value_version text NOT NULL CHECK(value_version='sleeper-exact-matchup-values-v1'),
  team_count integer NOT NULL CHECK(team_count>0)
);
CREATE TABLE public.league_exact_matchup_team_values (
  content_id uuid NOT NULL REFERENCES public.league_exact_matchup_value_contents(content_id),
  team_id uuid NOT NULL, source_ordinal integer NOT NULL CHECK(source_ordinal>0),
  external_roster_id text NOT NULL CHECK(external_roster_id ~ '^[1-9][0-9]*$'),
  matchup_id_state text NOT NULL CHECK(matchup_id_state IN ('missing','null','supplied')),
  native_matchup_id text CHECK(native_matchup_id ~ '^[1-9][0-9]*$'),
  players_state text NOT NULL CHECK(players_state IN ('missing','null','supplied')), players text[],
  starters_state text NOT NULL CHECK(starters_state IN ('missing','null','supplied')), starters text[],
  raw_points_state text NOT NULL CHECK(raw_points_state IN ('missing','null','supplied')), raw_points numeric,
  custom_points_state text NOT NULL CHECK(custom_points_state IN ('missing','null','supplied')), custom_points numeric,
  starter_points_state text NOT NULL CHECK(starter_points_state IN ('missing','null','supplied')),
  starter_points_count integer NOT NULL CHECK(starter_points_count>=0),
  player_points_state text NOT NULL CHECK(player_points_state IN ('missing','null','supplied')),
  player_points_count integer NOT NULL CHECK(player_points_count>=0),
  PRIMARY KEY(content_id,team_id), UNIQUE(content_id,source_ordinal), UNIQUE(content_id,external_roster_id),
  FOREIGN KEY(content_id,team_id) REFERENCES public.league_administration_team_entries(content_id,team_id),
  CHECK((matchup_id_state='supplied')=(native_matchup_id IS NOT NULL)),
  CHECK((players_state='supplied')=(players IS NOT NULL)),
  CHECK((starters_state='supplied')=(starters IS NOT NULL)),
  CHECK((raw_points_state='supplied')=(raw_points IS NOT NULL)),
  CHECK((custom_points_state='supplied')=(custom_points IS NOT NULL)),
  CHECK(starter_points_state='supplied' OR starter_points_count=0),
  CHECK(player_points_state='supplied' OR player_points_count=0),
  CHECK(raw_points IS NULL OR raw_points NOT IN ('NaN'::numeric,'Infinity'::numeric,'-Infinity'::numeric)),
  CHECK(custom_points IS NULL OR custom_points NOT IN ('NaN'::numeric,'Infinity'::numeric,'-Infinity'::numeric))
);
CREATE TABLE public.league_exact_matchup_starter_points (
  content_id uuid NOT NULL,team_id uuid NOT NULL,source_index integer NOT NULL CHECK(source_index>=0),points numeric,
  PRIMARY KEY(content_id,team_id,source_index),
  FOREIGN KEY(content_id,team_id) REFERENCES public.league_exact_matchup_team_values(content_id,team_id),
  CHECK(points IS NULL OR points NOT IN ('NaN'::numeric,'Infinity'::numeric,'-Infinity'::numeric))
);
CREATE TABLE public.league_exact_matchup_player_points (
  content_id uuid NOT NULL,team_id uuid NOT NULL,native_player_id text NOT NULL,
  native_player_id_hash text GENERATED ALWAYS AS (encode(digest(native_player_id,'sha256'),'hex')) STORED,
  points numeric,
  PRIMARY KEY(content_id,team_id,native_player_id_hash),
  FOREIGN KEY(content_id,team_id) REFERENCES public.league_exact_matchup_team_values(content_id,team_id),
  CHECK(points IS NULL OR points NOT IN ('NaN'::numeric,'Infinity'::numeric,'-Infinity'::numeric))
);

CREATE FUNCTION public.validate_exact_matchup_value_lineage()
RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE native jsonb; source jsonb; team public.league_exact_matchup_team_values%ROWTYPE;
BEGIN
  IF TG_TABLE_NAME='league_exact_matchup_value_contents' THEN
    IF NOT EXISTS(SELECT 1 FROM public.league_roster_resource_acceptances accepted
      JOIN public.league_roster_capture_receipts receipt ON receipt.id=accepted.receipt_id
      JOIN public.league_roster_resource_scopes scope ON scope.id=accepted.scope_id
      JOIN public.league_administration_contents content ON content.id=receipt.content_id
      WHERE accepted.id=NEW.first_acceptance_id AND content.id=NEW.content_id AND content.family='matchups'
        AND scope.identity->'scope'->>'coverageSpecId'='sleeper-exact-period-all-teams-matchups-v1'
        AND content.accepted AND content.completeness='complete' AND jsonb_typeof(content.payload)='array'
        AND NEW.team_count=jsonb_array_length(content.payload) AND NEW.team_count=receipt.expected_team_count) THEN
      RAISE EXCEPTION 'exact matchup value header lineage mismatch'; END IF;
  ELSIF TG_TABLE_NAME='league_exact_matchup_team_values' THEN
    SELECT content.payload->(NEW.source_ordinal-1),entry.source_value INTO native,source
      FROM public.league_administration_contents content
      JOIN public.league_administration_team_entries entry ON entry.content_id=content.id
      JOIN public.league_season_teams identity ON identity.id=entry.team_id AND identity.league_season_id=content.league_season_id
      WHERE content.id=NEW.content_id AND entry.team_id=NEW.team_id AND entry.league_season_id=content.league_season_id
        AND identity.external_roster_id=NEW.external_roster_id AND identity.provider=content.provider
        AND identity.external_league_id=content.external_league_id;
    IF native IS NULL OR native->>'roster_id' IS DISTINCT FROM NEW.external_roster_id
      OR source IS DISTINCT FROM jsonb_build_object('externalRosterId',NEW.external_roster_id,
        'externalMatchupId',NEW.native_matchup_id,'playerExternalIds',to_jsonb(NEW.players),
        'starterExternalIds',to_jsonb(NEW.starters),'points',NEW.raw_points,'customPoints',NEW.custom_points)
      OR NEW.matchup_id_state IS DISTINCT FROM public.exact_matchup_native_state(native,'matchup_id','number')
      OR NEW.native_matchup_id IS DISTINCT FROM native->>'matchup_id'
      OR NEW.players_state IS DISTINCT FROM public.exact_matchup_native_state(native,'players','array')
      OR to_jsonb(NEW.players) IS DISTINCT FROM NULLIF(native->'players','null'::jsonb)
      OR NEW.starters_state IS DISTINCT FROM public.exact_matchup_native_state(native,'starters','array')
      OR to_jsonb(NEW.starters) IS DISTINCT FROM NULLIF(native->'starters','null'::jsonb)
      OR NEW.raw_points_state IS DISTINCT FROM public.exact_matchup_native_state(native,'points','number')
      OR to_jsonb(NEW.raw_points) IS DISTINCT FROM NULLIF(native->'points','null'::jsonb)
      OR NEW.custom_points_state IS DISTINCT FROM public.exact_matchup_native_state(native,'custom_points','number')
      OR to_jsonb(NEW.custom_points) IS DISTINCT FROM NULLIF(native->'custom_points','null'::jsonb)
      OR NEW.starter_points_state IS DISTINCT FROM public.exact_matchup_native_state(native,'starters_points','array')
      OR NEW.player_points_state IS DISTINCT FROM public.exact_matchup_native_state(native,'players_points','object')
      OR NEW.starter_points_count IS DISTINCT FROM COALESCE(jsonb_array_length(NULLIF(native->'starters_points','null'::jsonb)),0)
      OR NEW.player_points_count IS DISTINCT FROM (SELECT count(*)::integer FROM jsonb_object_keys(COALESCE(NULLIF(native->'players_points','null'::jsonb),'{}'::jsonb))) THEN
      RAISE EXCEPTION 'exact matchup typed team parity mismatch'; END IF;
  ELSE
    SELECT * INTO STRICT team FROM public.league_exact_matchup_team_values
      WHERE content_id=NEW.content_id AND team_id=NEW.team_id;
    SELECT payload->(team.source_ordinal-1) INTO STRICT native FROM public.league_administration_contents WHERE id=NEW.content_id;
    IF TG_TABLE_NAME='league_exact_matchup_starter_points' THEN
      IF team.starter_points_state<>'supplied' OR NEW.source_index>=team.starter_points_count
        OR to_jsonb(NEW.points) IS DISTINCT FROM NULLIF(native->'starters_points'->NEW.source_index,'null'::jsonb) THEN
        RAISE EXCEPTION 'exact matchup starter score lineage mismatch'; END IF;
    ELSE
      IF team.player_points_state<>'supplied' OR NOT native->'players_points' ? NEW.native_player_id
        OR to_jsonb(NEW.points) IS DISTINCT FROM NULLIF(native->'players_points'->NEW.native_player_id,'null'::jsonb) THEN
        RAISE EXCEPTION 'exact matchup player score lineage mismatch'; END IF;
    END IF;
  END IF;
  RETURN NEW;
END; $$;

CREATE FUNCTION public.validate_exact_matchup_value_cardinality()
RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
  IF TG_TABLE_NAME='league_exact_matchup_value_contents' THEN
    IF (SELECT count(*) FROM public.league_exact_matchup_team_values WHERE content_id=NEW.content_id)<>NEW.team_count THEN
      RAISE EXCEPTION 'incomplete exact matchup team values'; END IF;
  ELSE
    IF (SELECT count(*) FROM public.league_exact_matchup_starter_points WHERE content_id=NEW.content_id AND team_id=NEW.team_id)<>NEW.starter_points_count
      OR (SELECT count(*) FROM public.league_exact_matchup_player_points WHERE content_id=NEW.content_id AND team_id=NEW.team_id)<>NEW.player_points_count THEN
      RAISE EXCEPTION 'incomplete exact matchup native points'; END IF;
  END IF;
  RETURN NEW;
END; $$;
CREATE CONSTRAINT TRIGGER exact_matchup_value_team_count AFTER INSERT ON public.league_exact_matchup_value_contents
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.validate_exact_matchup_value_cardinality();
CREATE CONSTRAINT TRIGGER exact_matchup_value_point_count AFTER INSERT ON public.league_exact_matchup_team_values
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.validate_exact_matchup_value_cardinality();
DO $$ DECLARE name text; BEGIN
  FOREACH name IN ARRAY ARRAY['league_exact_matchup_value_contents','league_exact_matchup_team_values',
    'league_exact_matchup_starter_points','league_exact_matchup_player_points'] LOOP
    EXECUTE format('CREATE TRIGGER exact_matchup_values_immutable BEFORE UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.prevent_league_administration_history_change()',name);
    EXECUTE format('CREATE TRIGGER exact_matchup_values_lineage BEFORE INSERT ON public.%I FOR EACH ROW EXECUTE FUNCTION public.validate_exact_matchup_value_lineage()',name);
  END LOOP;
END; $$;

CREATE FUNCTION public.capture_exact_matchup_values()
RETURNS trigger LANGUAGE plpgsql VOLATILE SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE scope public.league_roster_resource_scopes%ROWTYPE;
  receipt public.league_roster_capture_receipts%ROWTYPE; attempt public.league_roster_resource_attempts%ROWTYPE;
  content public.league_administration_contents%ROWTYPE; raw jsonb; ordinal bigint; team_id_value uuid;
  field_name text; state_value text; created uuid;
  -- ECMAScript trim whitespace, excluding ASCII controls rejected separately; never rewrite a native ID.
  edge_space text:='['||chr(32)||chr(160)||chr(5760)||chr(8192)||'-'||chr(8202)||chr(8232)||chr(8233)
    ||chr(8239)||chr(8287)||chr(12288)||chr(65279)||']';
BEGIN
  SELECT * INTO STRICT scope FROM public.league_roster_resource_scopes WHERE id=NEW.scope_id;
  IF scope.identity->'scope'->>'family'<>'matchups' THEN RETURN NEW; END IF;
  IF scope.identity->'scope'->>'coverageSpecId'<>'sleeper-exact-period-all-teams-matchups-v1' THEN RETURN NEW; END IF;
  SELECT * INTO STRICT receipt FROM public.league_roster_capture_receipts WHERE id=NEW.receipt_id;
  SELECT * INTO STRICT attempt FROM public.league_roster_resource_attempts WHERE id=receipt.attempt_id;
  IF attempt.write_fence IS NOT NULL THEN PERFORM public.assert_roster_player_link_fence(attempt.write_fence); END IF;
  SELECT * INTO STRICT content FROM public.league_administration_contents WHERE id=receipt.content_id;
  INSERT INTO public.league_exact_matchup_value_contents(content_id,first_acceptance_id,value_version,team_count)
    VALUES(content.id,NEW.id,'sleeper-exact-matchup-values-v1',receipt.expected_team_count)
    ON CONFLICT DO NOTHING RETURNING content_id INTO created;
  IF created IS NOT NULL THEN
    FOR raw,ordinal IN SELECT value,ordinality FROM jsonb_array_elements(content.payload) WITH ORDINALITY LOOP
      IF jsonb_typeof(raw) IS DISTINCT FROM 'object' OR jsonb_typeof(raw->'roster_id') IS DISTINCT FROM 'number'
        OR (raw->>'roster_id') !~ '^[1-9][0-9]*$' OR (raw->>'roster_id')::numeric>9007199254740991 THEN
        RAISE EXCEPTION 'invalid exact matchup native roster identity'; END IF;
      state_value:=public.exact_matchup_native_state(raw,'matchup_id','number');
      IF state_value='supplied' AND ((raw->>'matchup_id') !~ '^[1-9][0-9]*$' OR (raw->>'matchup_id')::numeric>9007199254740991) THEN
        RAISE EXCEPTION 'invalid exact matchup native group identity'; END IF;
      FOREACH field_name IN ARRAY ARRAY['players','starters'] LOOP
        state_value:=public.exact_matchup_native_state(raw,field_name,'array');
        IF state_value='supplied' AND (EXISTS(SELECT 1 FROM jsonb_array_elements(raw->field_name) item
          WHERE jsonb_typeof(item)<>'string' OR item#>>'{}'='' OR item#>>'{}' ~ ('^'||edge_space||'|'||edge_space||'$')
            OR item#>>'{}' ~ ('['||chr(1)||'-'||chr(31)||chr(127)||']'))
          OR (SELECT count(*) FROM jsonb_array_elements_text(raw->field_name) item WHERE field_name<>'starters' OR item<>'0')
            <>(SELECT count(DISTINCT item) FROM jsonb_array_elements_text(raw->field_name) item WHERE field_name<>'starters' OR item<>'0')) THEN
          RAISE EXCEPTION 'invalid exact matchup native lineup'; END IF;
      END LOOP;
      PERFORM public.exact_matchup_native_state(raw,'points','number');
      PERFORM public.exact_matchup_native_state(raw,'custom_points','number');
      state_value:=public.exact_matchup_native_state(raw,'starters_points','array');
      IF state_value='supplied' AND (EXISTS(SELECT 1 FROM jsonb_array_elements(raw->'starters_points') item WHERE jsonb_typeof(item) NOT IN ('number','null'))
        OR (jsonb_typeof(raw->'starters')='array' AND jsonb_array_length(raw->'starters')<>jsonb_array_length(raw->'starters_points'))) THEN
        RAISE EXCEPTION 'invalid exact matchup native starter scores'; END IF;
      state_value:=public.exact_matchup_native_state(raw,'players_points','object');
      IF state_value='supplied' AND EXISTS(SELECT 1 FROM jsonb_each(raw->'players_points') item
        WHERE jsonb_typeof(item.value) NOT IN ('number','null') OR item.key='' OR item.key ~ ('^'||edge_space||'|'||edge_space||'$')
          OR item.key ~ ('['||chr(1)||'-'||chr(31)||chr(127)||']')) THEN
        RAISE EXCEPTION 'invalid exact matchup native player scores'; END IF;
      SELECT identity.id INTO STRICT team_id_value FROM public.league_administration_team_entries entry
        JOIN public.league_season_teams identity ON identity.id=entry.team_id
        WHERE entry.content_id=content.id AND identity.external_roster_id=raw->>'roster_id';
      INSERT INTO public.league_exact_matchup_team_values(content_id,team_id,source_ordinal,external_roster_id,
        matchup_id_state,native_matchup_id,players_state,players,starters_state,starters,
        raw_points_state,raw_points,custom_points_state,custom_points,starter_points_state,starter_points_count,player_points_state,player_points_count)
      VALUES(content.id,team_id_value,ordinal,raw->>'roster_id',public.exact_matchup_native_state(raw,'matchup_id','number'),raw->>'matchup_id',
        public.exact_matchup_native_state(raw,'players','array'),CASE WHEN jsonb_typeof(raw->'players')='array' THEN ARRAY(SELECT jsonb_array_elements_text(raw->'players')) END,
        public.exact_matchup_native_state(raw,'starters','array'),CASE WHEN jsonb_typeof(raw->'starters')='array' THEN ARRAY(SELECT jsonb_array_elements_text(raw->'starters')) END,
        public.exact_matchup_native_state(raw,'points','number'),(raw->>'points')::numeric,
        public.exact_matchup_native_state(raw,'custom_points','number'),(raw->>'custom_points')::numeric,
        public.exact_matchup_native_state(raw,'starters_points','array'),COALESCE(jsonb_array_length(NULLIF(raw->'starters_points','null'::jsonb)),0),
        public.exact_matchup_native_state(raw,'players_points','object'),(SELECT count(*) FROM jsonb_object_keys(COALESCE(NULLIF(raw->'players_points','null'::jsonb),'{}'::jsonb))));
      INSERT INTO public.league_exact_matchup_starter_points(content_id,team_id,source_index,points)
        SELECT content.id,team_id_value,index-1,(value#>>'{}')::numeric
        FROM jsonb_array_elements(COALESCE(NULLIF(raw->'starters_points','null'::jsonb),'[]'::jsonb)) WITH ORDINALITY item(value,index);
      INSERT INTO public.league_exact_matchup_player_points(content_id,team_id,native_player_id,points)
        SELECT content.id,team_id_value,key,(value#>>'{}')::numeric
        FROM jsonb_each(COALESCE(NULLIF(raw->'players_points','null'::jsonb),'{}'::jsonb));
    END LOOP;
  END IF;
  -- The accepting owner checks before INSERT; this guard also covers waits in the supplemental writes.
  IF attempt.write_fence IS NOT NULL THEN PERFORM public.assert_roster_player_link_fence(attempt.write_fence); END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER exact_matchup_values_after_acceptance AFTER INSERT ON public.league_roster_resource_acceptances
  FOR EACH ROW EXECUTE FUNCTION public.capture_exact_matchup_values();

REVOKE ALL ON public.league_exact_matchup_value_contents,public.league_exact_matchup_team_values,
  public.league_exact_matchup_starter_points,public.league_exact_matchup_player_points FROM PUBLIC;
REVOKE ALL ON FUNCTION public.exact_matchup_native_state(jsonb,text,text),public.validate_exact_matchup_value_lineage(),
  public.validate_exact_matchup_value_cardinality(),public.capture_exact_matchup_values() FROM PUBLIC;
DO $$ BEGIN
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='league_one_runtime') THEN
    REVOKE ALL ON public.league_exact_matchup_value_contents,public.league_exact_matchup_team_values,
      public.league_exact_matchup_starter_points,public.league_exact_matchup_player_points FROM league_one_runtime;
    GRANT SELECT ON public.league_exact_matchup_value_contents,public.league_exact_matchup_team_values,
      public.league_exact_matchup_starter_points,public.league_exact_matchup_player_points TO league_one_runtime;
    REVOKE ALL ON FUNCTION public.exact_matchup_native_state(jsonb,text,text),public.validate_exact_matchup_value_lineage(),
      public.validate_exact_matchup_value_cardinality(),public.capture_exact_matchup_values() FROM league_one_runtime;
  END IF;
END; $$;
