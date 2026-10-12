-- CP13 optional exact-week native reports. Existing families and historical migrations stay unchanged.
-- This resource owns generic reservations, receipts and acceptance; report rows are never roster rows.
DO $$ DECLARE table_name text; constraint_name text; found_count integer; BEGIN
  FOREACH table_name IN ARRAY ARRAY['league_administration_contents','league_administration_heads'] LOOP
    EXECUTE format('ALTER TABLE public.%I DROP CONSTRAINT %I',table_name,table_name||'_family_check');
    EXECUTE format('ALTER TABLE public.%I ADD CONSTRAINT %I CHECK (family IN (''league'',''rosters'',''users'',''matchups'',''transactions'',''drafts'',''traded_picks'',''winners_bracket'',''losers_bracket'',''weekly_report''))',table_name,table_name||'_family_check');
    found_count:=0;
    FOR constraint_name IN SELECT conname FROM pg_constraint
      WHERE conrelid=('public.'||table_name)::regclass AND contype='c'
        AND pg_get_constraintdef(oid) ~ '\mfamily\M' AND pg_get_constraintdef(oid) ~ '\mweek\M' LOOP
      found_count:=found_count+1;
      EXECUTE format('ALTER TABLE public.%I DROP CONSTRAINT %I',table_name,constraint_name);
    END LOOP;
    IF found_count<>1 THEN RAISE EXCEPTION 'expected one administration family/week constraint'; END IF;
    EXECUTE format('ALTER TABLE public.%I ADD CONSTRAINT %I CHECK ((family=''matchups'' AND week>0) OR family=''transactions'' OR (family IN (''league'',''rosters'',''users'',''drafts'',''traded_picks'',''winners_bracket'',''losers_bracket'') AND week=0) OR (family=''weekly_report'' AND week BETWEEN 1 AND 18))',table_name,table_name||'_family_week_check');
  END LOOP;
END; $$;

-- Typed report values retain native precision, independent field presence and native metadata clocks.
CREATE TABLE public.league_weekly_report_contents (
  content_id uuid PRIMARY KEY REFERENCES public.league_administration_contents(id),
  first_acceptance_id uuid NOT NULL REFERENCES public.league_roster_resource_acceptances(id),
  capture_transaction xid8 NOT NULL DEFAULT pg_current_xact_id(),
  value_version text NOT NULL CHECK(value_version='sleeper-weekly-report-v1'),
  native_week integer NOT NULL CHECK(native_week BETWEEN 1 AND 18), report_key text NOT NULL,
  publication text NOT NULL CHECK(publication IN ('published','unpublished')),
  native_report_week integer, created_value bigint, last_updated_value bigint,
  metadata_states jsonb NOT NULL CHECK(jsonb_typeof(metadata_states)='object'),
  team_count integer NOT NULL CHECK(team_count BETWEEN 0 AND 20),
  limitations jsonb NOT NULL CHECK(jsonb_typeof(limitations)='array'),
  CHECK((publication='published' AND native_report_week=native_week)
    OR (publication='unpublished' AND native_report_week IS NULL AND team_count=0))
);
CREATE TABLE public.league_weekly_report_teams (
  content_id uuid NOT NULL REFERENCES public.league_weekly_report_contents(content_id),
  external_roster_id text NOT NULL, season_team_id uuid NOT NULL REFERENCES public.league_season_teams(id),
  source_ordinal integer NOT NULL CHECK(source_ordinal BETWEEN 0 AND 19),
  field_states jsonb NOT NULL CHECK(jsonb_typeof(field_states)='object'),
  round bigint, rank bigint, record text, streak text, wins bigint, losses bigint, ties bigint,
  points_for numeric, points_against numeric,
  PRIMARY KEY(content_id,external_roster_id), UNIQUE(content_id,source_ordinal), UNIQUE(content_id,season_team_id)
);

CREATE FUNCTION public.weekly_report_native_fact(p_row jsonb,p_key text,p_path text,p_kind text,p_minimum integer DEFAULT 0)
RETURNS jsonb LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE state_value text; raw jsonb:=p_row->p_key; amount numeric; value_json jsonb;
BEGIN
  IF jsonb_typeof(p_row) IS DISTINCT FROM 'object' THEN state_value:='invalid';
  ELSIF NOT p_row ? p_key THEN state_value:='absent';
  ELSIF raw='null'::jsonb THEN state_value:='null';
  ELSIF p_kind='string' THEN state_value:=CASE WHEN jsonb_typeof(raw)='string' THEN 'known' ELSE 'invalid' END;
  ELSIF jsonb_typeof(raw) IS DISTINCT FROM 'number' THEN state_value:='invalid';
  ELSE
    amount:=(raw#>>'{}')::numeric;
    state_value:=CASE WHEN abs(amount)>1.7976931348623157e308::numeric
      OR (p_kind='integer' AND (amount<>trunc(amount) OR amount<p_minimum OR amount>9007199254740991))
      THEN 'invalid' ELSE 'known' END;
  END IF;
  IF state_value='known' THEN value_json:=CASE WHEN p_kind='decimal' THEN to_jsonb(trim_scale(amount)::text) ELSE raw END; END IF;
  RETURN jsonb_build_object('state',state_value,'value',value_json,'sourcePath',p_path);
END; $$;

-- Independent SQL native projection. Identity and GraphQL errors are structural;
-- malformed optional facts remain typed invalid fields rather than invented defaults.
CREATE FUNCTION public.project_weekly_report_native(p_payload jsonb,p_external_league_id text,p_week integer,p_normalized jsonb)
RETURNS jsonb LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE metadata jsonb; report jsonb; row_value jsonb; item record; prefix text; native_id text;
  seen text[]:=ARRAY[]::text[]; teams jsonb:='[]'::jsonb; result jsonb; publication text;
BEGIN
  IF p_week IS NULL OR p_week NOT BETWEEN 1 AND 18 OR p_external_league_id IS NULL
    OR p_external_league_id !~ '^[1-9][0-9]{0,31}$' OR jsonb_typeof(p_payload) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'invalid report native scope'; END IF;
  -- PostgreSQL JSONB text includes formatting; this is a conservative stored-byte
  -- admission bound, not an assertion of exact JSON.stringify maximum parity.
  IF octet_length(convert_to(p_payload::text,'UTF8'))>8388608 THEN RAISE EXCEPTION 'report payload byte limit exceeded'; END IF;
  IF p_payload ? 'errors' THEN
    IF jsonb_typeof(p_payload->'errors') IS DISTINCT FROM 'array' OR jsonb_array_length(p_payload->'errors')<>0 THEN
      RAISE EXCEPTION 'report GraphQL errors'; END IF;
  END IF;
  IF jsonb_typeof(p_payload->'data') IS DISTINCT FROM 'object' OR NOT(p_payload->'data' ? 'metadata') THEN
    RAISE EXCEPTION 'missing report metadata'; END IF;
  metadata:=p_payload->'data'->'metadata';
  IF metadata='null'::jsonb THEN publication:='unpublished';metadata:='{}'::jsonb;
  ELSE
    publication:='published';
    IF jsonb_typeof(metadata) IS DISTINCT FROM 'object' OR metadata->>'type' IS DISTINCT FROM 'league_report'
      OR metadata->>'key' IS DISTINCT FROM p_external_league_id||'_'||p_week::text THEN RAISE EXCEPTION 'report native identity mismatch'; END IF;
    report:=metadata->'data';
    IF jsonb_typeof(report) IS DISTINCT FROM 'object' OR report->'week' IS DISTINCT FROM to_jsonb(p_week)
      OR jsonb_typeof(report->'standings') IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'report native week or standings mismatch'; END IF;
    IF jsonb_array_length(report->'standings')>20 THEN RAISE EXCEPTION 'report team limit exceeded'; END IF;
    FOR item IN SELECT value,ordinality FROM jsonb_array_elements(report->'standings') WITH ORDINALITY LOOP
      row_value:=item.value;prefix:='data.metadata.data.standings['||(item.ordinality-1)::text||']';
      IF jsonb_typeof(row_value) IS DISTINCT FROM 'object' OR jsonb_typeof(row_value->'roster_id') IS DISTINCT FROM 'number' THEN
        RAISE EXCEPTION 'invalid report roster identity'; END IF;
      IF (row_value->>'roster_id')::numeric NOT BETWEEN 1 AND 9007199254740991
        OR (row_value->>'roster_id')::numeric<>trunc((row_value->>'roster_id')::numeric) THEN RAISE EXCEPTION 'invalid report roster identity'; END IF;
      native_id:=((row_value->>'roster_id')::numeric)::bigint::text;
      IF native_id=ANY(seen) THEN RAISE EXCEPTION 'duplicate report roster identity'; END IF;
      seen:=array_append(seen,native_id);
      teams:=teams||jsonb_build_array(jsonb_build_object('externalRosterId',native_id,'sourceOrdinal',item.ordinality-1,
        'round',public.weekly_report_native_fact(row_value,'round',prefix||'.round','integer'),
        'providerRank',public.weekly_report_native_fact(row_value,'rank',prefix||'.rank','integer',1),
        'record',public.weekly_report_native_fact(row_value,'record',prefix||'.record','string'),
        'streak',public.weekly_report_native_fact(row_value,'streak',prefix||'.streak','string'),
        'wins',public.weekly_report_native_fact(row_value,'wins',prefix||'.wins','integer'),
        'losses',public.weekly_report_native_fact(row_value,'losses',prefix||'.losses','integer'),
        'ties',public.weekly_report_native_fact(row_value,'ties',prefix||'.ties','integer'),
        'pointsFor',public.weekly_report_native_fact(row_value,'points',prefix||'.points','decimal'),
        'pointsAgainst',public.weekly_report_native_fact(row_value,'points_against',prefix||'.points_against','decimal')));
    END LOOP;
  END IF;
  result:=jsonb_build_object('family','weekly_report','season',2026,'nativeWeek',p_week,'reportKey',p_external_league_id||'_'||p_week::text,
    'publication',publication,'nativeReportWeek',CASE WHEN publication='published' THEN p_week END,
    'metadata',jsonb_build_object('created',public.weekly_report_native_fact(metadata,'created','data.metadata.created','integer'),
      'lastUpdated',public.weekly_report_native_fact(metadata,'last_updated','data.metadata.last_updated','integer')),
    'teams',teams,'limitations','["report_population_unproved","record_sequence_uninterpreted","report_update_semantics_unproved"]'::jsonb);
  IF octet_length(convert_to(result::text,'UTF8'))>1048576 THEN RAISE EXCEPTION 'report value byte limit exceeded'; END IF;
  IF p_normalized IS DISTINCT FROM jsonb_build_object('family','weekly_report','report',result) THEN
    RAISE EXCEPTION 'report legacy normalization mismatch'; END IF;
  RETURN result;
END; $$;

CREATE FUNCTION public.weekly_report_typed_value(p_content_id uuid)
RETURNS jsonb LANGUAGE sql STABLE SET search_path=pg_catalog,public,pg_temp AS $$
  SELECT jsonb_build_object('family','weekly_report','season',2026,'nativeWeek',header.native_week,'reportKey',header.report_key,
    'publication',header.publication,'nativeReportWeek',header.native_report_week,
    'metadata',jsonb_build_object('created',jsonb_build_object('state',header.metadata_states->'created','value',header.created_value,'sourcePath','data.metadata.created'),
      'lastUpdated',jsonb_build_object('state',header.metadata_states->'last_updated','value',header.last_updated_value,'sourcePath','data.metadata.last_updated')),
    'teams',(SELECT COALESCE(jsonb_agg(jsonb_build_object('externalRosterId',team.external_roster_id,'sourceOrdinal',team.source_ordinal,
      'round',jsonb_build_object('state',team.field_states->'round','value',team.round,'sourcePath','data.metadata.data.standings['||team.source_ordinal||'].round'),
      'providerRank',jsonb_build_object('state',team.field_states->'rank','value',team.rank,'sourcePath','data.metadata.data.standings['||team.source_ordinal||'].rank'),
      'record',jsonb_build_object('state',team.field_states->'record','value',team.record,'sourcePath','data.metadata.data.standings['||team.source_ordinal||'].record'),
      'streak',jsonb_build_object('state',team.field_states->'streak','value',team.streak,'sourcePath','data.metadata.data.standings['||team.source_ordinal||'].streak'),
      'wins',jsonb_build_object('state',team.field_states->'wins','value',team.wins,'sourcePath','data.metadata.data.standings['||team.source_ordinal||'].wins'),
      'losses',jsonb_build_object('state',team.field_states->'losses','value',team.losses,'sourcePath','data.metadata.data.standings['||team.source_ordinal||'].losses'),
      'ties',jsonb_build_object('state',team.field_states->'ties','value',team.ties,'sourcePath','data.metadata.data.standings['||team.source_ordinal||'].ties'),
      'pointsFor',jsonb_build_object('state',team.field_states->'points','value',trim_scale(team.points_for)::text,'sourcePath','data.metadata.data.standings['||team.source_ordinal||'].points'),
      'pointsAgainst',jsonb_build_object('state',team.field_states->'points_against','value',trim_scale(team.points_against)::text,'sourcePath','data.metadata.data.standings['||team.source_ordinal||'].points_against')) ORDER BY team.source_ordinal),'[]'::jsonb)
      FROM public.league_weekly_report_teams team WHERE team.content_id=header.content_id),'limitations',header.limitations)
  FROM public.league_weekly_report_contents header WHERE header.content_id=p_content_id;
$$;

CREATE FUNCTION public.capture_weekly_report_typed(p_content_id uuid,p_acceptance_id uuid,p_value jsonb)
RETURNS void LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE created uuid; item jsonb; identity_value uuid; content public.league_administration_contents%ROWTYPE;
BEGIN
  SELECT * INTO STRICT content FROM public.league_administration_contents WHERE id=p_content_id;
  INSERT INTO public.league_weekly_report_contents(content_id,first_acceptance_id,value_version,native_week,report_key,publication,native_report_week,
    created_value,last_updated_value,metadata_states,team_count,limitations)
    VALUES(p_content_id,p_acceptance_id,'sleeper-weekly-report-v1',(p_value->>'nativeWeek')::integer,p_value->>'reportKey',p_value->>'publication',
      (p_value->>'nativeReportWeek')::integer,(p_value->'metadata'->'created'->>'value')::bigint,(p_value->'metadata'->'lastUpdated'->>'value')::bigint,
      jsonb_build_object('created',p_value->'metadata'->'created'->>'state','last_updated',p_value->'metadata'->'lastUpdated'->>'state'),
      jsonb_array_length(p_value->'teams'),p_value->'limitations') ON CONFLICT DO NOTHING RETURNING content_id INTO created;
  IF created IS NOT NULL THEN
    FOR item IN SELECT value FROM jsonb_array_elements(p_value->'teams') LOOP
      INSERT INTO public.league_season_teams(league_season_id,provider,external_league_id,external_roster_id)
        VALUES(content.league_season_id,content.provider,content.external_league_id,item->>'externalRosterId') ON CONFLICT DO NOTHING;
      SELECT id INTO STRICT identity_value FROM public.league_season_teams WHERE league_season_id=content.league_season_id
        AND provider=content.provider AND external_league_id=content.external_league_id AND external_roster_id=item->>'externalRosterId';
      INSERT INTO public.league_weekly_report_teams(content_id,external_roster_id,season_team_id,source_ordinal,field_states,
        round,rank,record,streak,wins,losses,ties,points_for,points_against)
      VALUES(p_content_id,item->>'externalRosterId',identity_value,(item->>'sourceOrdinal')::integer,
        jsonb_build_object('round',item->'round'->>'state','rank',item->'providerRank'->>'state','record',item->'record'->>'state',
          'streak',item->'streak'->>'state','wins',item->'wins'->>'state','losses',item->'losses'->>'state','ties',item->'ties'->>'state',
          'points',item->'pointsFor'->>'state','points_against',item->'pointsAgainst'->>'state'),
        (item->'round'->>'value')::bigint,(item->'providerRank'->>'value')::bigint,item->'record'->>'value',item->'streak'->>'value',
        (item->'wins'->>'value')::bigint,(item->'losses'->>'value')::bigint,(item->'ties'->>'value')::bigint,
        (item->'pointsFor'->>'value')::numeric,(item->'pointsAgainst'->>'value')::numeric);
    END LOOP;
  END IF;
  IF public.weekly_report_typed_value(p_content_id) IS DISTINCT FROM p_value THEN RAISE EXCEPTION 'report typed materialization mismatch'; END IF;
END; $$;

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
          OR (scope.identity->'scope'->>'family' IN ('transactions','playoff-brackets','weekly-reports') AND receipt.configuration_content_id IS NULL
            AND receipt.population_evidence IS NULL AND receipt.expected_team_count IS NULL)
          OR (scope.identity->'scope'->>'family' NOT IN ('league-season','transactions','playoff-brackets','weekly-reports') AND receipt.configuration_content_id IS NOT NULL
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

CREATE FUNCTION public.validate_weekly_report_typed_lineage()
RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE content public.league_administration_contents%ROWTYPE; header public.league_weekly_report_contents%ROWTYPE;
  expected jsonb; fence jsonb;
BEGIN
  SELECT * INTO STRICT header FROM public.league_weekly_report_contents WHERE content_id=NEW.content_id;
  SELECT * INTO STRICT content FROM public.league_administration_contents WHERE id=NEW.content_id;
  SELECT attempt.write_fence INTO STRICT fence FROM public.league_roster_resource_acceptances accepted
    JOIN public.league_roster_capture_receipts receipt ON receipt.id=accepted.receipt_id
    JOIN public.league_roster_resource_attempts attempt ON attempt.id=receipt.attempt_id WHERE accepted.id=header.first_acceptance_id;
  IF fence IS NOT NULL THEN PERFORM public.assert_roster_player_link_fence(fence); END IF;
  IF header.capture_transaction<>pg_current_xact_id() OR NOT EXISTS(SELECT 1 FROM public.league_roster_resource_acceptances accepted
    JOIN public.league_roster_capture_receipts receipt ON receipt.id=accepted.receipt_id
    JOIN public.league_roster_resource_scopes scope ON scope.id=accepted.scope_id
    JOIN public.league_seasons season ON season.id=scope.league_season_id
    WHERE accepted.id=header.first_acceptance_id AND receipt.content_id=content.id
      AND scope.league_season_id=content.league_season_id AND season.season=2026
      AND scope.identity->'scope'->>'family'='weekly-reports' AND scope.identity->'scope'->>'entityId'='league_report'
      AND scope.identity->'scope'->>'scoringPeriodId'='sleeper:report-week:'||content.week::text
      AND scope.identity->'policy'=jsonb_build_object('audienceId','public','coverageSpecId','sleeper-weekly-report-v1',
        'canonicalNormalizerVersion','sleeper-weekly-report-v1','validationVersion','latest-network-attempt-v1')
      AND content.provider='sleeper' AND content.family='weekly_report' AND content.week=header.native_week
      AND content.normalizer_version='sleeper-administration-v1' AND content.accepted AND content.completeness='complete') THEN
    RAISE EXCEPTION 'report typed acceptance lineage mismatch'; END IF;
  expected:=public.project_weekly_report_native(content.payload,content.external_league_id,content.week,content.normalized_value);
  IF public.weekly_report_typed_value(content.id) IS DISTINCT FROM expected OR header.team_count<>jsonb_array_length(expected->'teams') THEN
    RAISE EXCEPTION 'report typed native parity mismatch'; END IF;
  IF EXISTS(SELECT 1 FROM public.league_weekly_report_teams team
    JOIN public.league_season_teams identity ON identity.id=team.season_team_id
    WHERE team.content_id=content.id AND (identity.league_season_id<>content.league_season_id OR identity.provider<>content.provider
      OR identity.external_league_id<>content.external_league_id OR identity.external_roster_id<>team.external_roster_id)) THEN
    RAISE EXCEPTION 'report canonical team identity mismatch'; END IF;
  IF fence IS NOT NULL THEN PERFORM public.assert_roster_player_link_fence(fence); END IF;
  RETURN NEW;
END; $$;
CREATE FUNCTION public.guard_weekly_report_team_insert()
RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
  IF NOT EXISTS(SELECT 1 FROM public.league_weekly_report_contents header WHERE header.content_id=NEW.content_id
    AND header.capture_transaction=pg_current_xact_id()) THEN RAISE EXCEPTION 'report child requires original capture transaction'; END IF;
  RETURN NEW;
END; $$;
CREATE CONSTRAINT TRIGGER weekly_report_typed_lineage AFTER INSERT ON public.league_weekly_report_contents
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.validate_weekly_report_typed_lineage();
CREATE TRIGGER weekly_report_team_insert BEFORE INSERT ON public.league_weekly_report_teams
  FOR EACH ROW EXECUTE FUNCTION public.guard_weekly_report_team_insert();
CREATE TRIGGER weekly_report_content_immutable BEFORE UPDATE OR DELETE ON public.league_weekly_report_contents
  FOR EACH ROW EXECUTE FUNCTION public.prevent_league_administration_history_change();
CREATE TRIGGER weekly_report_team_immutable BEFORE UPDATE OR DELETE ON public.league_weekly_report_teams
  FOR EACH ROW EXECUTE FUNCTION public.prevent_league_administration_history_change();

-- Every receipt event retains its original immutable attempt fence, including
-- rejected observations and changed/equal content accepted in later transactions.
CREATE FUNCTION public.validate_weekly_report_receipt_fence()
RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE fence jsonb;
BEGIN
  SELECT attempt.write_fence INTO fence FROM public.league_roster_resource_attempts attempt
    JOIN public.league_roster_resource_scopes scope ON scope.id=attempt.scope_id
    WHERE attempt.id=NEW.attempt_id AND scope.identity->'scope'->>'family'='weekly-reports';
  IF FOUND AND fence IS NOT NULL THEN PERFORM public.assert_roster_player_link_fence(fence); END IF;
  RETURN NEW;
END; $$;
CREATE CONSTRAINT TRIGGER weekly_report_receipt_fence AFTER INSERT ON public.league_roster_capture_receipts
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.validate_weekly_report_receipt_fence();
CREATE FUNCTION public.validate_weekly_report_acceptance_fence()
RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE fence jsonb;
BEGIN
  IF NOT EXISTS(SELECT 1 FROM public.league_roster_resource_scopes scope WHERE scope.id=NEW.scope_id
    AND scope.identity->'scope'->>'family'='weekly-reports') THEN RETURN NEW; END IF;
  SELECT attempt.write_fence INTO STRICT fence FROM public.league_roster_capture_receipts receipt
    JOIN public.league_roster_resource_attempts attempt ON attempt.id=receipt.attempt_id WHERE receipt.id=NEW.receipt_id;
  IF fence IS NOT NULL THEN PERFORM public.assert_roster_player_link_fence(fence); END IF;
  RETURN NEW;
END; $$;
CREATE CONSTRAINT TRIGGER weekly_report_acceptance_fence AFTER INSERT ON public.league_roster_resource_acceptances
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.validate_weekly_report_acceptance_fence();


CREATE FUNCTION public.begin_weekly_report_attempt(p_mapping jsonb,p_week integer,p_id uuid,p_fence jsonb DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE scope_row public.league_roster_resource_scopes%ROWTYPE;
  attempt public.league_roster_resource_attempts%ROWTYPE;
  head public.league_roster_resource_heads%ROWTYPE;
  identity_value jsonb;
BEGIN
  IF p_id IS NULL OR p_week IS NULL OR p_week NOT BETWEEN 1 AND 18 OR p_mapping->'scope'->>'season' IS DISTINCT FROM '2026' THEN RAISE EXCEPTION 'invalid current-season report scope'; END IF;
  IF p_fence IS NOT NULL THEN
    PERFORM 1 FROM public.projection_jobs job WHERE job.job_key=p_fence->>'jobKey' AND job.state='running'
      AND job.lease_owner=p_fence->>'workerId' AND job.attempt_count=(p_fence->>'generation')::integer
      AND job.lease_until>clock_timestamp() AND (p_fence->>'deadlineAt')::timestamptz>clock_timestamp() FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'report reservation writer fence is stale'; END IF;
  END IF;
  PERFORM public.validate_current_roster_mapping(p_mapping);
  identity_value:=jsonb_build_object('scope',jsonb_build_object('kind','enrolled-resource',
    'connectionId',p_mapping->>'connectionId','leagueSeasonId',p_mapping->>'leagueSeasonId',
    'family','weekly-reports','entityId','league_report','scoringPeriodId','sleeper:report-week:'||p_week::text,
    'audienceId','public','coverageSpecId','sleeper-weekly-report-v1'),
    'policy',jsonb_build_object('audienceId','public','coverageSpecId','sleeper-weekly-report-v1',
    'canonicalNormalizerVersion','sleeper-weekly-report-v1','validationVersion','latest-network-attempt-v1'));
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
    RAISE EXCEPTION 'report reservation writer fence expired'; END IF;
  SELECT * INTO attempt FROM public.league_roster_resource_attempts WHERE id=p_id;
  IF FOUND THEN
    IF attempt.scope_id<>scope_row.id OR attempt.source_mapping IS DISTINCT FROM p_mapping
      OR attempt.write_fence IS DISTINCT FROM p_fence THEN RAISE EXCEPTION 'report attempt identity conflict'; END IF;
  ELSE
    UPDATE public.league_roster_resource_heads SET latest_ordinal=latest_ordinal+1
      WHERE scope_id=scope_row.id RETURNING * INTO head;
    INSERT INTO public.league_roster_resource_attempts(id,scope_id,ordinal,expected_generation,source_mapping,write_fence)
      VALUES(p_id,scope_row.id,head.latest_ordinal,head.generation,p_mapping,p_fence) RETURNING * INTO attempt;
  END IF;
  RETURN jsonb_build_object('id',attempt.id,'scopeId',attempt.scope_id,'ordinal',attempt.ordinal,
    'expectedGeneration',attempt.expected_generation);
END; $$;


ALTER FUNCTION public.record_league_administration_observation(jsonb) RENAME TO record_league_administration_observation_v48;
CREATE FUNCTION public.record_league_administration_observation(p_input jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE result jsonb; addition jsonb:=p_input->'weeklyReportAcceptance'; projection jsonb:=p_input->'weeklyReportProjection'; expected jsonb; token jsonb;
  attempt public.league_roster_resource_attempts%ROWTYPE; head public.league_roster_resource_heads%ROWTYPE;
  content public.league_administration_contents%ROWTYPE; receipt public.league_roster_capture_receipts%ROWTYPE;
  provenance jsonb:=p_input->'envelope'->'provenance'; family_value text:=p_input->'envelope'->>'family';
  evidence_hash_value text; covered boolean:=false; acceptance_id uuid; legacy_current boolean:=false;
BEGIN
  -- Bound every report body before generic storage, including rejected evidence
  -- and unwitnessed observations without typed acceptance. Other families retain
  -- their existing admission rules.
  IF family_value='weekly_report'
    AND octet_length(convert_to((p_input->'envelope'->'payload')::text,'UTF8'))>8388608 THEN
    RAISE EXCEPTION 'report payload byte limit exceeded'; END IF;
  IF addition IS NULL THEN
    IF family_value='weekly_report' AND provenance ? 'acquisition' THEN
      RAISE EXCEPTION 'witnessed public report requires typed acceptance'; END IF;
    RETURN public.record_league_administration_observation_v48(p_input);
  END IF;
  IF p_input ?| ARRAY['rosterAcceptance','teamManagerAcceptance','teamManagerEvidenceAcceptance','leagueSettingsAcceptance',
    'matchupAcceptance','transactionAcceptance','bracketAcceptance','bracketProjection','officialStandings','calendarEvidence','calculationCapture'] THEN
    RAISE EXCEPTION 'report cannot borrow another resource acceptance'; END IF;
  -- Shape precedes internal delegation; replay never borrows a different witness.
  PERFORM public.assert_public_capture_input_shape(p_input);
  IF family_value IS DISTINCT FROM 'weekly_report'
    OR jsonb_typeof(p_input->'envelope'->'week') IS DISTINCT FROM 'number'
    OR (p_input->'envelope'->>'week')::integer NOT BETWEEN 1 AND 18
    OR p_input->'envelope'->'scope'->>'season' IS DISTINCT FROM '2026'
    OR p_input->'envelope'->'scope' IS DISTINCT FROM p_input->'sourceMapping'->'scope'
    OR p_input->'sourceMapping' IS NULL OR projection->>'version' IS DISTINCT FROM 'sleeper-weekly-report-v1'
    OR projection->>'status' IS NULL OR projection->>'status' NOT IN ('accepted','rejected')
    OR provenance->>'origin' IS DISTINCT FROM 'network'
    OR (provenance->>'requestStartedAt')::timestamptz IS NULL OR (provenance->>'requestCompletedAt')::timestamptz IS NULL
    OR ((provenance->>'sourceObservedAt')::timestamptz IS NULL AND projection->>'status'='accepted')
    OR (provenance->>'checkedAt')::timestamptz IS NULL
    OR (provenance->>'requestStartedAt')::timestamptz>(provenance->>'requestCompletedAt')::timestamptz
    OR (provenance->>'requestCompletedAt')::timestamptz>(provenance->>'checkedAt')::timestamptz
    OR (provenance->>'sourceObservedAt')::timestamptz>(provenance->>'checkedAt')::timestamptz
    OR (provenance->>'checkedAt')::timestamptz>clock_timestamp()+interval '5 minutes' THEN
    RAISE EXCEPTION 'report acceptance requires exact mapped network capture'; END IF;
  result:=public.record_league_administration_observation_v48(p_input-'weeklyReportAcceptance'-'weeklyReportProjection'-'sourceMapping');
  PERFORM public.validate_current_roster_mapping(p_input->'sourceMapping');
  token:=addition->'attempt';
  SELECT * INTO STRICT attempt FROM public.league_roster_resource_attempts WHERE id=(token->>'id')::uuid;
  IF provenance->'acquisition' IS NULL AND (provenance->>'requestStartedAt')::timestamptz<attempt.reserved_at THEN
    RAISE EXCEPTION 'report request predates reservation'; END IF;
  IF attempt.source_mapping IS DISTINCT FROM p_input->'sourceMapping' OR attempt.write_fence IS DISTINCT FROM p_input->'writeFence'
    OR token IS DISTINCT FROM jsonb_build_object('id',attempt.id,'scopeId',attempt.scope_id,'ordinal',attempt.ordinal,'expectedGeneration',attempt.expected_generation)
    OR NOT EXISTS(SELECT 1 FROM public.league_roster_resource_scopes scope WHERE scope.id=attempt.scope_id
      AND scope.identity=jsonb_build_object('scope',jsonb_build_object('kind','enrolled-resource','connectionId',attempt.source_mapping->>'connectionId',
        'leagueSeasonId',attempt.source_mapping->>'leagueSeasonId','family','weekly-reports','entityId','league_report','scoringPeriodId','sleeper:report-week:'||(p_input->'envelope'->>'week'),
        'audienceId','public','coverageSpecId','sleeper-weekly-report-v1'),'policy',jsonb_build_object('audienceId','public',
        'coverageSpecId','sleeper-weekly-report-v1','canonicalNormalizerVersion','sleeper-weekly-report-v1','validationVersion','latest-network-attempt-v1'))) THEN
    RAISE EXCEPTION 'report attempt scope mismatch'; END IF;
  SELECT * INTO STRICT head FROM public.league_roster_resource_heads WHERE scope_id=attempt.scope_id FOR UPDATE;
  IF attempt.write_fence IS NOT NULL THEN PERFORM public.assert_roster_player_link_fence(attempt.write_fence); END IF;
  SELECT * INTO STRICT content FROM public.league_administration_contents stored
    WHERE stored.league_season_id=(attempt.source_mapping->>'leagueSeasonId')::uuid AND stored.provider='sleeper'
      AND stored.external_league_id=attempt.source_mapping->'scope'->>'externalLeagueId' AND stored.family=family_value AND stored.week=(p_input->'envelope'->>'week')::integer
      AND stored.normalizer_version='sleeper-administration-v1' AND stored.content_hash=p_input->>'contentHash'
      AND stored.completeness=p_input->'envelope'->>'completeness'
      AND stored.accepted=(p_input->>'status'='accepted' AND p_input->'envelope'->>'completeness'='complete')
      AND stored.payload=p_input->'envelope'->'payload' AND stored.normalized_value IS NOT DISTINCT FROM p_input->'value';
  legacy_current:=result->>'status' IN ('changed','unchanged','replayed') AND EXISTS(SELECT 1 FROM public.league_administration_heads legacy
    JOIN public.league_administration_observations observation ON observation.id=legacy.accepted_observation_id
    WHERE legacy.league_season_id=content.league_season_id AND legacy.family=family_value AND legacy.week=content.week AND legacy.read_conflict IS NULL
      AND observation.content_id=content.id AND observation.id=(result->>'observationId')::uuid);
  IF projection->>'status'='accepted' THEN
    IF NOT content.accepted OR content.completeness<>'complete' OR projection->'diagnostics' IS DISTINCT FROM '[]'::jsonb THEN
      RAISE EXCEPTION 'unproved report projection'; END IF;
    expected:=public.project_weekly_report_native(content.payload,content.external_league_id,content.week,content.normalized_value);
    IF projection->'value' IS DISTINCT FROM expected THEN RAISE EXCEPTION 'report projection mismatch'; END IF;
    covered:=true;
  ELSIF projection->'value' IS DISTINCT FROM 'null'::jsonb OR jsonb_typeof(projection->'diagnostics') IS DISTINCT FROM 'array'
    OR jsonb_array_length(projection->'diagnostics')=0 THEN RAISE EXCEPTION 'invalid report rejection evidence'; END IF;
  evidence_hash_value:=encode(digest(convert_to(p_input::text,'UTF8'),'sha256'),'hex');
  SELECT * INTO receipt FROM public.league_roster_capture_receipts WHERE attempt_id=attempt.id;
  IF FOUND THEN
    IF receipt.evidence_hash<>evidence_hash_value THEN RAISE EXCEPTION 'report attempt receipt conflict'; END IF;
    IF attempt.write_fence IS NOT NULL THEN PERFORM public.assert_roster_player_link_fence(attempt.write_fence); END IF;
    RETURN result||jsonb_build_object('weeklyReportAcceptance',jsonb_build_object('status',CASE WHEN attempt.ordinal=head.latest_ordinal AND EXISTS(
      SELECT 1 FROM public.league_roster_resource_acceptances accepted WHERE accepted.id=head.accepted_id AND accepted.receipt_id=receipt.id)
      THEN 'accepted' ELSE 'preserved' END,'reason','exact_receipt_replay','receiptId',receipt.id,'acceptedGeneration',head.generation));
  END IF;
  -- Live dispatch derivation is required only for a new receipt. Exact immutable
  -- replay above retains the original input hash and fence after dispatch settlement.
  IF provenance ? 'acquisition' THEN PERFORM public.assert_public_capture_observation(p_input,family_value); END IF;
  INSERT INTO public.league_roster_capture_receipts(attempt_id,content_id,legacy_observation_id,evidence_hash,provenance,coverage)
    VALUES(attempt.id,content.id,(result->>'observationId')::uuid,evidence_hash_value,provenance,
      jsonb_build_object('periodIds',jsonb_build_array('sleeper:report-week:'||content.week::text),'interval',NULL,'entitySet','unknown',
        'fields','["key","type","data.week","data.standings","created","last_updated"]'::jsonb,'pagination','complete','nextCursor',NULL,
        'completeness',CASE WHEN covered THEN 'complete' WHEN content.completeness='partial' THEN 'partial' ELSE 'unknown' END,
        'reasons',CASE WHEN covered THEN '["report_population_unproved"]'::jsonb ELSE '["complete_report_structure_unproved"]'::jsonb END)) RETURNING * INTO receipt;
  IF attempt.ordinal=head.latest_ordinal AND attempt.expected_generation=head.generation AND covered AND legacy_current THEN
    IF attempt.write_fence IS NOT NULL THEN PERFORM public.assert_roster_player_link_fence(attempt.write_fence); END IF;
    INSERT INTO public.league_roster_resource_acceptances(scope_id,receipt_id,source_mapping_revision_id,generation)
      VALUES(attempt.scope_id,receipt.id,(attempt.source_mapping->>'revisionId')::uuid,head.generation+1) RETURNING id INTO acceptance_id;
    PERFORM public.capture_weekly_report_typed(content.id,acceptance_id,expected);
    IF attempt.write_fence IS NOT NULL THEN PERFORM public.assert_roster_player_link_fence(attempt.write_fence); END IF;
    UPDATE public.league_roster_resource_heads SET accepted_id=acceptance_id,generation=generation+1 WHERE scope_id=attempt.scope_id RETURNING * INTO head;
  END IF;
  IF attempt.write_fence IS NOT NULL THEN PERFORM public.assert_roster_player_link_fence(attempt.write_fence); END IF;
  RETURN result||jsonb_build_object('weeklyReportAcceptance',jsonb_build_object('status',CASE WHEN acceptance_id IS NOT NULL THEN 'accepted' ELSE 'preserved' END,
    'reason',CASE WHEN acceptance_id IS NOT NULL THEN NULL WHEN attempt.ordinal<>head.latest_ordinal THEN 'newer_network_attempt_reserved'
      WHEN attempt.expected_generation<>head.generation THEN 'accepted_generation_changed' WHEN NOT covered THEN 'complete_report_structure_unproved'
      WHEN NOT legacy_current THEN 'legacy_report_not_current' END,'receiptId',receipt.id,'acceptedGeneration',head.generation));
END; $$;

REVOKE ALL ON public.league_weekly_report_contents,public.league_weekly_report_teams FROM PUBLIC;
REVOKE ALL ON FUNCTION public.weekly_report_native_fact(jsonb,text,text,text,integer),
  public.project_weekly_report_native(jsonb,text,integer,jsonb),public.weekly_report_typed_value(uuid),
  public.capture_weekly_report_typed(uuid,uuid,jsonb),public.validate_weekly_report_typed_lineage(),
  public.guard_weekly_report_team_insert(),public.validate_weekly_report_receipt_fence(),public.validate_weekly_report_acceptance_fence(),
  public.begin_weekly_report_attempt(jsonb,integer,uuid,jsonb),public.record_league_administration_observation_v48(jsonb),
  public.record_league_administration_observation(jsonb) FROM PUBLIC;
DO $$ BEGIN
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='league_one_runtime') THEN
    REVOKE ALL ON public.league_weekly_report_contents,public.league_weekly_report_teams FROM league_one_runtime;
    GRANT SELECT ON public.league_weekly_report_contents,public.league_weekly_report_teams TO league_one_runtime;
    REVOKE ALL ON FUNCTION public.weekly_report_native_fact(jsonb,text,text,text,integer),
      public.project_weekly_report_native(jsonb,text,integer,jsonb),public.weekly_report_typed_value(uuid),
      public.capture_weekly_report_typed(uuid,uuid,jsonb),public.validate_weekly_report_typed_lineage(),
      public.guard_weekly_report_team_insert(),public.validate_weekly_report_receipt_fence(),public.validate_weekly_report_acceptance_fence(),
      public.record_league_administration_observation_v48(jsonb) FROM league_one_runtime;
    GRANT EXECUTE ON FUNCTION public.begin_weekly_report_attempt(jsonb,integer,uuid,jsonb),
      public.record_league_administration_observation(jsonb) TO league_one_runtime;
  END IF;
END; $$;
