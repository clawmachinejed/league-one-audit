-- Isolated qualification source only; never a production migration. Install only
-- through the existing guarded profile after 001-069. No identity/fact/job seeds.
DO $$ BEGIN
  IF current_setting('server_version_num')::integer NOT BETWEEN 180000 AND 189999 THEN
    RAISE EXCEPTION 'canonical qualification requires PostgreSQL 18'; END IF;
END; $$;

CREATE FUNCTION public.canonical_standings_fixture_registry() RETURNS jsonb
LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE source jsonb; variant jsonb; policy jsonb; registration jsonb; native jsonb; source_ref jsonb;
  result jsonb:='[]'::jsonb; variants jsonb; entry_rows jsonb; capacity_rows jsonb; base jsonb; sleeper_rows jsonb;
BEGIN
  entry_rows:='[{"clubKey":"club:ABC-7","played":{"won":3,"lost":1,"tied":0},"totals":{"for":"123.45","against":"0"},"place":1,"seedNumber":2},
    {"clubKey":"club:XYZ-9","played":{"won":0,"lost":3,"tied":1},"totals":{"for":"0","against":"123.45"},"place":2,"seedNumber":1}]'::jsonb;
  base:=jsonb_build_object('leagueKey','club:ABC-7','seasonTag','2026','updatedAt','2026-01-01T00:00:00.000001Z',
    'teamTotal',2,'page',jsonb_build_object('complete',true,'next',NULL),'entries',entry_rows);
  SELECT jsonb_agg(jsonb_build_object('clubKey','club:CAP-'||i,'played',jsonb_build_object('won',0,'lost',0,'tied',0),
    'totals',jsonb_build_object('for','0','against','0'),'place',i+1,'seedNumber',i+1) ORDER BY i)
    INTO capacity_rows FROM generate_series(0,20) i;
  variants:=jsonb_build_array(
    jsonb_build_object('key','complete','nativePayload',base),
    jsonb_build_object('key','correction','nativePayload',base||jsonb_build_object('updatedAt','2026-01-01T00:00:00.000002Z',
      'entries',jsonb_build_array('{"clubKey":"club:ABC-7","played":{"won":4,"lost":1,"tied":0},"totals":{"for":"124.45","against":"0"},"place":1,"seedNumber":2}'::jsonb,entry_rows->1))),
    jsonb_build_object('key','stale','nativePayload',base||jsonb_build_object('updatedAt','2026-01-01T00:00:00.000000Z')),
    jsonb_build_object('key','conflict','nativePayload',base||jsonb_build_object('updatedAt','2026-01-01T00:00:00.000002Z',
      'entries',jsonb_build_array('{"clubKey":"club:ABC-7","played":{"won":5,"lost":1,"tied":0},"totals":{"for":"125.45","against":"0"},"place":1,"seedNumber":2}'::jsonb,entry_rows->1))),
    jsonb_build_object('key','partial','nativePayload',base||jsonb_build_object('updatedAt','2026-01-01T00:00:00.000003Z','page',jsonb_build_object('complete',false,'next','page:2'),'entries',jsonb_build_array(entry_rows->0))),
    jsonb_build_object('key','unproved','nativePayload',base||jsonb_build_object('updatedAt','2026-01-01T00:00:00.000004Z','teamTotal',NULL)),
    jsonb_build_object('key','matching-unproved','nativePayload',base||jsonb_build_object('updatedAt','2026-01-01T00:00:00.000005Z','page',jsonb_build_object('complete',false,'next','page:2'))),
    jsonb_build_object('key','mismatch','nativePayload',base||jsonb_build_object('updatedAt','2026-01-01T00:00:00.000006Z','teamTotal',3)),
    jsonb_build_object('key','field-states','nativePayload',base||jsonb_build_object('entries',
      '[{"clubKey":"club:ABC-7","played":{"lost":null,"tied":"invalid"},"totals":{"for":"0","against":null},"place":0},
        {"clubKey":"club:XYZ-9","played":{"won":0,"lost":0,"tied":0},"totals":{"for":"01.50","against":"-0.25"},"place":2,"seedNumber":null}]'::jsonb)),
    jsonb_build_object('key','duplicate','nativePayload',base||jsonb_build_object('entries',jsonb_build_array(entry_rows->0,entry_rows->0))),
    jsonb_build_object('key','capacity','nativePayload',base||jsonb_build_object('teamTotal',21,'entries',capacity_rows)),
    jsonb_build_object('key','decimal-capacity','nativePayload',base||jsonb_build_object('entries',jsonb_build_array(
      jsonb_build_object('clubKey','club:ABC-7','played',jsonb_build_object('won',0,'lost',0,'tied',0),
        'totals',jsonb_build_object('for',repeat('1',1025),'against','0'),'place',1,'seedNumber',1),entry_rows->1))));
  sleeper_rows:='[{"roster_id":1,"league_id":"900000000000001","settings":{"wins":0,"losses":2,"ties":0,"fpts":0,"fpts_decimal":0,"fpts_against":100,"fpts_against_decimal":25,"rank":2,"seed":1}},
    {"roster_id":2,"league_id":"900000000000001","settings":{"losses":null,"ties":"invalid","fpts":12,"fpts_decimal":5,"fpts_against":null,"rank":0}}]'::jsonb;
  FOR source IN SELECT value FROM jsonb_array_elements('[
    {"key":"alpha","provider":"fixture-sports","namespace":"league:alpha","nativeId":"club:ABC-7","leagueKey":"standings-fixture-alpha","leagueName":"Fixture Alpha","sourceNamespace":"league:alpha:2026","teamNamespace":"squads:alpha:2026"},
    {"key":"beta","provider":"fixture-sports","namespace":"league:beta","nativeId":"club:ABC-7","leagueKey":"standings-fixture-beta","leagueName":"Fixture Beta","sourceNamespace":"league:beta:2026","teamNamespace":"squads:beta:2026"},
    {"key":"gamma","provider":"fixture-results","namespace":"league:alpha","nativeId":"club:ABC-7","leagueKey":"standings-fixture-gamma","leagueName":"Fixture Gamma","sourceNamespace":"league:alpha:2026","teamNamespace":"squads:gamma:2026"},
    {"key":"sleeper","provider":"sleeper","namespace":"nfl","nativeId":"900000000000001","leagueKey":"standings-fixture-sleeper","leagueName":"Fixture Sleeper","sourceNamespace":"nfl:2026","teamNamespace":"[\"nfl\",2026,\"900000000000001\"]"},
    {"key":"delta","provider":"fixture-sports","namespace":"league:delta","nativeId":"club:ABC-7","leagueKey":"standings-fixture-delta","leagueName":"Fixture Delta","sourceNamespace":"league:delta:2026","teamNamespace":"squads:delta:2026"},
    {"key":"sleeper-membership","provider":"sleeper","namespace":"nfl","nativeId":"900000000000002","leagueKey":"standings-fixture-sleeper-membership","leagueName":"Fixture Sleeper Membership","sourceNamespace":"nfl:2026","teamNamespace":"[\"nfl\",2026,\"900000000000002\"]"},
    {"key":"alpha-remap","provider":"fixture-sports","namespace":"league:remapped","nativeId":"club:ABC-7","leagueKey":"standings-fixture-alpha","leagueName":"Fixture Alpha","sourceNamespace":"league:remapped:2026","teamNamespace":"squads:remapped:2026"}]'::jsonb) LOOP
    source_ref:=jsonb_build_object('provider',source->>'provider','resourceKind','league','nativeNamespace',source->>'namespace','nativeId',source->>'nativeId');
    policy:=jsonb_build_object('contractVersion','league-one-canonical-delivery-v1','canonicalSchemaVersion','league-one-official-standings-v1',
      'hashVersion','league-one-jsonb-sha256-v1','adapterVersion',CASE WHEN source->>'provider'='sleeper' THEN 'sleeper-standings-adapter-v1' ELSE 'fixture-standings-adapter-v1' END,
      'nativeVerifierVersion',CASE WHEN source->>'provider'='sleeper' THEN 'sleeper-standings-sql-v1' ELSE 'fixture-standings-sql-v1' END,
      'canonicalNormalizerVersion',CASE WHEN source->>'provider'='sleeper' THEN 'sleeper-standings-canonical-v1' ELSE 'fixture-standings-canonical-v1' END,
      'validationVersion','canonical-standings-acceptance-v1','audienceId','public','coverageSpecId','official-season-standings-v1',
      'provider',source->>'provider','nativeKind',CASE WHEN source->>'provider'='sleeper' THEN 'sleeper-rosters' ELSE 'fixture-standings' END,
      'teamNamespace',source->>'teamNamespace','originPolicy','fixture-v1');
    registration:=jsonb_build_object('leagueKey',source->>'nativeId','seasonTag','2026','title',source->>'leagueName','teamTotal',2);
    FOR variant IN SELECT value FROM jsonb_array_elements(CASE
      WHEN source->>'key'='alpha' THEN variants
      WHEN source->>'provider'='sleeper' THEN jsonb_build_array(jsonb_build_object('key',CASE WHEN source->>'key'='sleeper' THEN 'parity' ELSE 'complete' END,
        'nativePayload',(SELECT jsonb_agg(value||jsonb_build_object('league_id',source->>'nativeId') ORDER BY ordinal)
          FROM jsonb_array_elements(sleeper_rows) WITH ORDINALITY entry(value,ordinal))))
      ELSE jsonb_build_array(jsonb_build_object('key','complete','nativePayload',base)) END) LOOP
      native:=variant->'nativePayload';
      result:=result||jsonb_build_array(jsonb_build_object('id',(source->>'key')||'-'||(variant->>'key'),
        'sourceLeague',source_ref,'leagueKey',source->>'leagueKey','leagueName',source->>'leagueName','season',2026,
        'sourceNamespace',source->>'sourceNamespace','policy',policy,'registrationPayload',registration,
        'registrationDigest',public.canonical_jsonb_hash(jsonb_build_object('hashVersion','league-one-jsonb-sha256-v1',
          'representation','registration','nativeKind','fixture-club-league','payload',registration)),
        'nativePayload',native,'standingsDigest',public.canonical_jsonb_hash(jsonb_build_object('hashVersion','league-one-jsonb-sha256-v1',
          'representation','native','nativeKind',policy->>'nativeKind','adapterVersion',policy->>'adapterVersion','nativePayload',native))));
    END LOOP;
  END LOOP;
  RETURN result;
END; $$;

CREATE FUNCTION public.canonical_standings_fixture_job_payload(p_fixture jsonb) RETURNS jsonb
LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,public,pg_temp AS $$
  SELECT jsonb_build_object('fixturePolicyVersion','canonical-standings-fixture-policy-v1','policy',p_fixture->'policy',
    'sourceLeague',p_fixture->'sourceLeague','intendedLeagueKey',p_fixture->>'leagueKey','season',p_fixture->'season',
    'registrationDigest',p_fixture->>'registrationDigest','standingsDigest',p_fixture->>'standingsDigest');
$$;
CREATE FUNCTION public.canonical_standings_fixture_job(p_fence jsonb) RETURNS jsonb
LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE job public.projection_jobs%ROWTYPE; fixture jsonb;
BEGIN
  PERFORM public.assert_canonical_job_fence(p_fence);
  SELECT * INTO STRICT job FROM public.projection_jobs WHERE job_key=p_fence->>'jobKey';
  IF job.job_type IS DISTINCT FROM 'canonical-fixture-standings-v1' THEN RAISE EXCEPTION 'unregistered fixture job type'; END IF;
  SELECT value INTO fixture FROM jsonb_array_elements(public.canonical_standings_fixture_registry())
    WHERE public.canonical_standings_fixture_job_payload(value)=job.payload;
  IF NOT FOUND THEN RAISE EXCEPTION 'unregistered fixture job payload'; END IF;
  RETURN fixture;
END; $$;

-- Original production namespace branch follows the finite fixture lookup.
CREATE OR REPLACE FUNCTION public.canonical_source_namespace_policy(p_source jsonb,p_season integer) RETURNS jsonb
LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE fixture jsonb;
BEGIN
  SELECT value INTO fixture FROM jsonb_array_elements(public.canonical_standings_fixture_registry())
    WHERE value->'sourceLeague'=p_source AND value->'season'=to_jsonb(p_season) LIMIT 1;
  IF FOUND THEN RETURN jsonb_build_object('sourceNamespace',fixture->>'sourceNamespace','teamNamespace',fixture->'policy'->>'teamNamespace'); END IF;
  IF p_source IS NULL OR jsonb_typeof(p_source) IS DISTINCT FROM 'object'
    OR NOT p_source ?& ARRAY['provider','resourceKind','nativeNamespace','nativeId']
    OR p_source-ARRAY['provider','resourceKind','nativeNamespace','nativeId']<>'{}'::jsonb
    OR p_source->>'provider' IS DISTINCT FROM 'sleeper' OR p_source->>'resourceKind' IS DISTINCT FROM 'league'
    OR p_source->>'nativeNamespace' IS DISTINCT FROM 'nfl' OR jsonb_typeof(p_source->'nativeId') IS DISTINCT FROM 'string'
    OR btrim(p_source->>'nativeId')='' OR (p_source->>'nativeId') ~ '[[:cntrl:]]'
    OR p_season IS NULL OR p_season NOT BETWEEN 1920 AND 2200 THEN
    RAISE EXCEPTION 'unregistered canonical source namespace'; END IF;
  RETURN jsonb_build_object('sourceNamespace','nfl:'||p_season,
    'teamNamespace',public.canonical_legacy_team_namespace(p_season,p_source->>'nativeId'));
END; $$;

CREATE OR REPLACE FUNCTION public.canonical_registration_policy(p_input jsonb,p_work jsonb,p_fence jsonb) RETURNS jsonb
LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE capture jsonb:=p_input->'registrationCapture'; payload jsonb:=capture->'payload'; source jsonb:=p_input->'sourceLeague';
  started timestamptz; completed timestamptz; wanted_key text; fixture jsonb;
BEGIN
  PERFORM public.assert_canonical_job_fence(p_fence);
  IF capture->>'origin'='fixture' THEN
    fixture:=public.canonical_standings_fixture_job(p_fence);
    IF p_work IS DISTINCT FROM public.canonical_standings_fixture_job_payload(fixture)
      OR p_input->>'mode' IS DISTINCT FROM 'official-data' OR p_input->'season' IS DISTINCT FROM fixture->'season'
      OR p_input->'sourceLeague' IS DISTINCT FROM fixture->'sourceLeague'
      OR p_input->>'leagueKey' IS DISTINCT FROM fixture->>'leagueKey' OR p_input->>'leagueName' IS DISTINCT FROM fixture->>'leagueName'
      OR NULLIF(p_input->'scoringRules','null'::jsonb) IS NOT NULL
      OR capture IS DISTINCT FROM jsonb_build_object('version','fixture-league-registration-v1','nativeKind','fixture-club-league','origin','fixture',
        'payload',fixture->'registrationPayload','sourceDigest',fixture->>'registrationDigest','requestStartedAt',NULL,'requestCompletedAt',NULL,
        'acquisition',jsonb_build_object('version','canonical-fixture-registration-v1','jobKey',p_fence->>'jobKey',
          'generation',p_fence->'generation','sourceDigest',fixture->>'registrationDigest')) THEN
      RAISE EXCEPTION 'unregistered fixture registration source or capture'; END IF;
    RETURN public.canonical_standings_fixture_job_payload(fixture);
  END IF;
  IF p_input->>'mode' IS DISTINCT FROM 'official-data' OR p_input->>'season' IS DISTINCT FROM '2026'
    OR source IS DISTINCT FROM jsonb_build_object('provider','sleeper','resourceKind','league','nativeNamespace','nfl',
      'nativeId',p_work->>'externalLeagueId') OR p_work->>'kind' IS DISTINCT FROM 'bootstrap'
    OR p_work->>'season' IS DISTINCT FROM '2026'
    OR capture->>'version' IS DISTINCT FROM 'sleeper-league-registration-v1'
    OR capture->>'nativeKind' IS DISTINCT FROM 'sleeper-league' OR capture->>'origin' IS DISTINCT FROM 'network'
    OR jsonb_typeof(payload) IS DISTINCT FROM 'object' OR payload->>'league_id' IS DISTINCT FROM source->>'nativeId'
    OR payload->>'season' IS DISTINCT FROM '2026' OR payload->>'sport' IS DISTINCT FROM 'nfl'
    OR jsonb_typeof(payload->'name') IS DISTINCT FROM 'string' OR btrim(payload->>'name')=''
    OR p_input->>'leagueName' IS DISTINCT FROM payload->>'name'
    OR jsonb_typeof(payload->'total_rosters') IS DISTINCT FROM 'number' OR (payload->>'total_rosters') !~ '^[1-9][0-9]*$'
    OR (payload->>'total_rosters')::integer NOT BETWEEN 1 AND 20
    OR (p_input ? 'scoringRules') IS DISTINCT FROM (payload ? 'scoring_settings')
    OR p_input->'scoringRules' IS DISTINCT FROM payload->'scoring_settings' THEN
    RAISE EXCEPTION 'unregistered or mismatched canonical registration capture'; END IF;
  PERFORM public.guard_public_data_intake(p_work,p_fence||jsonb_build_object('reserveCollection',true));
  PERFORM public.assert_public_data_capture_witness(capture->'acquisition',p_fence,'league',NULL);
  IF capture->'acquisition'->'work' IS DISTINCT FROM p_work OR capture->'acquisition'->'mapping' IS DISTINCT FROM 'null'::jsonb THEN
    RAISE EXCEPTION 'registration capture requires its original pre-mapping work'; END IF;
  started:=(capture->>'requestStartedAt')::timestamptz; completed:=(capture->>'requestCompletedAt')::timestamptz;
  IF started IS NULL OR completed IS NULL OR NOT isfinite(started) OR NOT isfinite(completed)
    OR started>completed OR completed>clock_timestamp()+interval '5 minutes' THEN
    RAISE EXCEPTION 'invalid original registration capture timing'; END IF;
  SELECT league.league_key INTO wanted_key FROM public.league_source_connections connection
    JOIN public.league_seasons season ON season.id=connection.league_season_id
    JOIN public.leagues league ON league.id=season.league_id
    WHERE connection.provider='sleeper' AND connection.native_namespace='nfl' AND connection.external_league_id=source->>'nativeId';
  wanted_key:=COALESCE(wanted_key,'sleeper-'||(source->>'nativeId'));
  IF p_input->>'leagueKey' IS DISTINCT FROM wanted_key THEN RAISE EXCEPTION 'canonical registration league key is not admitted'; END IF;
  PERFORM public.guard_public_data_intake(p_work,p_fence);
  RETURN jsonb_build_object('sourceLeague',source,'intendedLeagueKey',wanted_key,'season',2026,'registrationDigest',capture->>'sourceDigest');
END; $$;

CREATE OR REPLACE FUNCTION public.canonical_resource_policy(p_mapping jsonb,p_delivery jsonb) RETURNS jsonb
LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE source_policy jsonb; policy jsonb; fixture jsonb;
BEGIN
  PERFORM public.validate_canonical_resource_mapping(p_mapping);
  SELECT value INTO fixture FROM jsonb_array_elements(public.canonical_standings_fixture_registry())
    WHERE value->'sourceLeague'=jsonb_build_object('provider',p_mapping->'scope'->>'provider','resourceKind','league',
      'nativeNamespace',p_mapping->'scope'->>'nativeNamespace','nativeId',p_mapping->'scope'->>'externalLeagueId')
      AND value->>'leagueKey'=p_mapping->'scope'->>'leagueKey' AND value->'season'=p_mapping->'scope'->'season'
      AND value->>'sourceNamespace'=p_mapping->>'sourceNamespace' LIMIT 1;
  IF FOUND THEN policy:=fixture->'policy';
  ELSE
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
  END IF;
  IF p_delivery IS NOT NULL AND EXISTS(SELECT 1 FROM jsonb_each(policy) item
    WHERE item.key IN ('contractVersion','canonicalSchemaVersion','adapterVersion','nativeVerifierVersion','canonicalNormalizerVersion','hashVersion')
      AND p_delivery->item.key IS DISTINCT FROM item.value) THEN RAISE EXCEPTION 'unregistered canonical standings codec'; END IF;
  RETURN policy;
END; $$;
CREATE OR REPLACE FUNCTION public.canonical_fixture_job_context(p_mapping jsonb,p_policy jsonb,p_fence jsonb) RETURNS jsonb
LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE fixture jsonb:=public.canonical_standings_fixture_job(p_fence);
BEGIN
  IF p_policy IS DISTINCT FROM fixture->'policy' OR p_mapping->'scope'->>'provider' IS DISTINCT FROM fixture->'sourceLeague'->>'provider'
    OR p_mapping->'scope'->>'nativeNamespace' IS DISTINCT FROM fixture->'sourceLeague'->>'nativeNamespace'
    OR p_mapping->'scope'->>'externalLeagueId' IS DISTINCT FROM fixture->'sourceLeague'->>'nativeId'
    OR p_mapping->'scope'->>'leagueKey' IS DISTINCT FROM fixture->>'leagueKey' OR p_mapping->'scope'->'season' IS DISTINCT FROM fixture->'season'
    OR p_mapping->>'sourceNamespace' IS DISTINCT FROM fixture->>'sourceNamespace' THEN
    RAISE EXCEPTION 'fixture job source or policy mismatch'; END IF;
  RETURN jsonb_build_object('version','canonical-fixture-reservation-v1','jobType','canonical-fixture-standings-v1')
    ||public.canonical_standings_fixture_job_payload(fixture);
END; $$;

CREATE FUNCTION public.canonical_standings_fixture_fact(p_parent jsonb,p_key text,p_kind text) RETURNS jsonb
LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE field_value jsonb; amount numeric;
BEGIN
  IF jsonb_typeof(p_parent) IS DISTINCT FROM 'object' THEN RETURN jsonb_build_object('state','invalid','value',NULL); END IF;
  IF NOT p_parent ? p_key THEN RETURN jsonb_build_object('state','absent','value',NULL); END IF;
  field_value:=p_parent->p_key;
  IF field_value='null'::jsonb THEN RETURN jsonb_build_object('state','null','value',NULL); END IF;
  IF p_kind='points' THEN
    IF jsonb_typeof(field_value)='string' AND length(field_value#>>'{}')<=1024
      AND (field_value#>>'{}') ~ '^-?(0|[1-9][0-9]*)(\.[0-9]*[1-9])?$' AND (field_value#>>'{}')<>'-0' THEN
      RETURN jsonb_build_object('state','known','value',field_value); END IF;
  ELSIF jsonb_typeof(field_value)='number' THEN
    amount:=(field_value#>>'{}')::numeric;
    IF amount=trunc(amount) AND amount BETWEEN (CASE WHEN p_kind='rank' THEN 1 ELSE 0 END) AND 9007199254740991 THEN
      RETURN jsonb_build_object('state','known','value',amount::bigint); END IF;
  END IF;
  RETURN jsonb_build_object('state','invalid','value',NULL);
END; $$;

CREATE FUNCTION public.verify_fixture_standings_delivery(p_input jsonb) RETURNS jsonb
LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE fixture jsonb; raw jsonb:=p_input->'nativePayload'; mapping jsonb:=p_input->'mapping'; policy jsonb:=p_input->'policy';
  facts jsonb; result jsonb; teams jsonb:='[]'::jsonb; status_value text:='qualified'; reason text; row_value record;
  entry jsonb; played jsonb; totals jsonb; expected integer; complete boolean; source_ref jsonb;
BEGIN
  SELECT value INTO STRICT fixture FROM jsonb_array_elements(public.canonical_standings_fixture_registry())
    WHERE value->>'id'=p_input->'nativeSourceRef'->>'fixtureId';
  source_ref:=jsonb_build_object('provider',mapping->'scope'->>'provider','resourceKind','league',
    'nativeNamespace',mapping->'scope'->>'nativeNamespace','nativeId',mapping->'scope'->>'externalLeagueId');
  IF p_input->'nativeSourceRef' IS DISTINCT FROM jsonb_build_object('kind','fixture-standalone-v1','fixtureId',fixture->>'id',
      'fixtureRevision','canonical-standings-fixtures-v1','sourceDigest',fixture->>'standingsDigest')
    OR source_ref IS DISTINCT FROM fixture->'sourceLeague' OR policy IS DISTINCT FROM fixture->'policy'
    OR raw IS DISTINCT FROM fixture->'nativePayload' OR public.canonical_native_hash(p_input) IS DISTINCT FROM fixture->>'standingsDigest'
    OR p_input->'populationEvidence' IS DISTINCT FROM 'null'::jsonb OR p_input->'provenance'->'nativeRevision' IS DISTINCT FROM 'null'::jsonb THEN
    RAISE EXCEPTION 'unregistered fixed fixture capture'; END IF;
  IF policy->>'nativeKind'='sleeper-rosters' THEN
    IF p_input->'provenance'->'sourceUpdatedAt' IS DISTINCT FROM 'null'::jsonb THEN RAISE EXCEPTION 'Sleeper fixture has no native update clock'; END IF;
    RETURN public.verify_sleeper_standings_delivery(p_input);
  END IF;
  IF p_input->'provenance'->'sourceUpdatedAt' IS DISTINCT FROM raw->'updatedAt' THEN RAISE EXCEPTION 'fixture native source clock mismatch'; END IF;
  IF jsonb_typeof(raw) IS DISTINCT FROM 'object' OR raw->>'leagueKey' IS DISTINCT FROM fixture->'sourceLeague'->>'nativeId'
    OR raw->>'seasonTag' IS DISTINCT FROM '2026' OR jsonb_typeof(raw->'entries') IS DISTINCT FROM 'array' THEN
    status_value:='invalid';reason:='standings_identity_invalid';
  ELSIF jsonb_array_length(raw->'entries')>20 THEN status_value:='capacity';reason:='standings_team_limit_exceeded';
  ELSIF EXISTS(SELECT 1 FROM jsonb_array_elements(raw->'entries') item WHERE jsonb_typeof(item) IS DISTINCT FROM 'object'
    OR jsonb_typeof(item->'clubKey') IS DISTINCT FROM 'string' OR btrim(item->>'clubKey')='' OR (item->>'clubKey') ~ '[[:cntrl:]]')
    OR EXISTS(SELECT 1 FROM jsonb_array_elements(raw->'entries') item GROUP BY item->>'clubKey' HAVING count(*)>1) THEN
    status_value:='invalid';reason:='standings_identity_invalid';
  ELSIF EXISTS(SELECT 1 FROM jsonb_array_elements(raw->'entries') item CROSS JOIN LATERAL
    jsonb_each(CASE WHEN jsonb_typeof(item->'totals')='object' THEN item->'totals' ELSE '{}'::jsonb END) field
    WHERE jsonb_typeof(field.value)='string' AND length(field.value#>>'{}')>1024) THEN
    status_value:='capacity';reason:='standings_decimal_limit_exceeded';
  ELSE
    FOR row_value IN SELECT value,ordinality FROM jsonb_array_elements(raw->'entries') WITH ORDINALITY LOOP
      entry:=row_value.value;played:=CASE WHEN entry ? 'played' THEN entry->'played' ELSE '{}'::jsonb END;
      totals:=CASE WHEN entry ? 'totals' THEN entry->'totals' ELSE '{}'::jsonb END;
      teams:=teams||jsonb_build_array(jsonb_build_object('sourceTeam',jsonb_build_object('provider',policy->>'provider','resourceKind','team',
          'nativeNamespace',policy->>'teamNamespace','nativeId',entry->>'clubKey'),'sourceOrdinal',row_value.ordinality-1,
        'record',jsonb_build_object('wins',public.canonical_standings_fixture_fact(played,'won','record'),
          'losses',public.canonical_standings_fixture_fact(played,'lost','record'),'ties',public.canonical_standings_fixture_fact(played,'tied','record')),
        'pointsFor',public.canonical_standings_fixture_fact(totals,'for','points'),'pointsAgainst',public.canonical_standings_fixture_fact(totals,'against','points'),
        'providerRank',public.canonical_standings_fixture_fact(entry,'place','rank'),'providerSeed',public.canonical_standings_fixture_fact(entry,'seedNumber','rank')));
    END LOOP;
  END IF;
  facts:=jsonb_build_object('schemaVersion','league-one-official-standings-v1','status',status_value,'teams',teams,
    'reasons',CASE WHEN reason IS NULL THEN '[]'::jsonb ELSE jsonb_build_array(reason) END);
  IF octet_length(convert_to(facts::text,'UTF8'))>1048576 THEN
    facts:=jsonb_build_object('schemaVersion','league-one-official-standings-v1','status','capacity','teams','[]'::jsonb,
      'reasons','["standings_byte_limit_exceeded"]'::jsonb); END IF;
  IF jsonb_typeof(raw->'teamTotal')='number' AND (raw->>'teamTotal')::numeric=trunc((raw->>'teamTotal')::numeric)
    AND (raw->>'teamTotal')::numeric BETWEEN 1 AND 2147483647 THEN expected:=(raw->>'teamTotal')::integer; END IF;
  complete:=COALESCE(raw->'page'->'complete'='true'::jsonb AND raw->'page'->'next'='null'::jsonb,false);
  PERFORM public.validate_canonical_standings_value(facts,policy->>'provider',policy->>'teamNamespace');
  result:=public.canonical_standings_coverage(facts,expected,complete,complete);
  IF p_input->'canonicalValue' IS DISTINCT FROM facts OR p_input->'coverage' IS DISTINCT FROM result->'coverage' THEN
    RAISE EXCEPTION 'fixture independent canonical parity mismatch'; END IF;
  RETURN result||jsonb_build_object('canonicalValue',facts,'nativeSourceRef',p_input->'nativeSourceRef','legacyRosterReceiptId',NULL);
END; $$;

CREATE OR REPLACE FUNCTION public.verify_registered_canonical_delivery(p_mapping jsonb,p_delivery jsonb) RETURNS jsonb
LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
  IF p_delivery->'mapping' IS DISTINCT FROM p_mapping
    OR p_delivery->'policy' IS DISTINCT FROM public.canonical_resource_policy(p_mapping,p_delivery) THEN
    RAISE EXCEPTION 'canonical verifier policy mismatch'; END IF;
  IF p_delivery->'policy'->>'originPolicy'='fixture-v1' THEN RETURN public.verify_fixture_standings_delivery(p_delivery); END IF;
  IF p_mapping->'scope'->>'provider'='sleeper' AND p_delivery->'policy'->>'nativeKind'='sleeper-rosters'
    AND p_delivery->'policy'->>'nativeVerifierVersion'='sleeper-standings-sql-v1' THEN
    RETURN public.verify_sleeper_standings_delivery(p_delivery);
  END IF;
  RAISE EXCEPTION 'unregistered canonical verifier';
END; $$;

-- Every helper and policy remains private, including for roles provisioned later.
DO $$ DECLARE signature text; role_name text; target regprocedure; BEGIN
  FOREACH signature IN ARRAY ARRAY[
    'public.canonical_standings_fixture_registry()', 'public.canonical_standings_fixture_job_payload(jsonb)',
    'public.canonical_standings_fixture_job(jsonb)', 'public.canonical_standings_fixture_fact(jsonb,text,text)',
    'public.verify_fixture_standings_delivery(jsonb)', 'public.canonical_source_namespace_policy(jsonb,integer)',
    'public.canonical_registration_policy(jsonb,jsonb,jsonb)', 'public.canonical_resource_policy(jsonb,jsonb)',
    'public.canonical_fixture_job_context(jsonb,jsonb,jsonb)', 'public.verify_registered_canonical_delivery(jsonb,jsonb)'
  ] LOOP
    target:=to_regprocedure(signature);
    IF target IS NULL THEN RAISE EXCEPTION 'missing isolated fixture helper %',signature; END IF;
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC',target);
    FOREACH role_name IN ARRAY ARRAY['league_one_runtime','league_one_account','league_one_auth'] LOOP
      IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=role_name) THEN
        EXECUTE format('REVOKE ALL ON FUNCTION %s FROM %I',target,role_name);
        IF has_function_privilege(role_name,target,'EXECUTE') THEN RAISE EXCEPTION 'fixture helper is exposed to %',role_name; END IF;
      END IF;
    END LOOP;
  END LOOP;
END; $$;
