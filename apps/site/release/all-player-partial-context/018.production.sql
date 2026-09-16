-- Reviewed all-player partial-context repair. Installed migrations 001-017 remain untouched.
-- Rendered for neondb/neondb_owner. Obtain release authority and revalidate service identities before execution.
-- Execute from an idle session, outside any existing transaction. The marker is
-- cleared before BEGIN and can survive COMMIT only after every postcondition passes.
SELECT set_config('league_one.partial_context_release_committed','',false) AS partial_context_release_marker_reset;
-- End the reset's implicit transaction even when submitted as one simple-query
-- batch. Otherwise a later error could restore this session's prior success marker.
COMMIT;
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='120s';
SET LOCAL search_path=pg_catalog,public;
SELECT pg_advisory_xact_lock(hashtext('league-one-schema-migrations'));
LOCK TABLE public.app_schema_migrations IN EXCLUSIVE MODE;
LOCK TABLE public.projection_jobs,public.league_week_lineup_watch_states,
  public.projection_period_refresh_states,public.league_week_materialization_states IN SHARE ROW EXCLUSIVE MODE;
DO $partial_context_before$
DECLARE actual_catalog jsonb;
BEGIN
  IF current_database() IS DISTINCT FROM 'neondb' OR current_user IS DISTINCT FROM 'neondb_owner'
    THEN RAISE EXCEPTION 'partial_context release database or owner identity mismatch'; END IF;
  IF current_setting('server_version_num')::integer<>180006
    THEN RAISE EXCEPTION 'partial_context release requires reviewed PostgreSQL 180006 constraint catalog'; END IF;
  IF (SELECT jsonb_agg(jsonb_build_array(name,checksum) ORDER BY name) FROM public.app_schema_migrations) IS DISTINCT FROM '[["001_projection_foundation.sql","eefa3aa224dbc6f0c6bb3edc9e4690425e2d6af7094938f3528059717d205050"],["002_manager_snapshot_payloads.sql","74585dec3e2717eede0579f9281a041a4e3cc0b0cd8378383fe2e3d64fd7214d"],["003_league_period_authority.sql","6f98e09646834cc542a6413e00c0d0c2d84ad4a5ff33905e429aba87c951406e"],["004_durable_projection_slates.sql","8ad48c22dea0d942a0a14027dcb240cda18f1bd728403e41aafa6b76f42f95b9"],["005_future_projection_refresh.sql","02bb6a3c6a183e7074fbea156b5f393d5772619098ab7c07be9dcc5528003c75"],["006_flexed_kickoff_candidate_index.sql","d2c54c4e17439d3773cfab8db8ed68bf332abd1073fe793f62138efa89e1a3b0"],["007_lineup_freshness.sql","1a92f9517294fe289bd25d74923dd042d0cb394d143b5c89d33ed017963c3e47"],["008_additive_write_guards.sql","2447ffac523e1f5536e218887d5c29895c3a095385f89bd6beb55cb7c5e95814"],["009_game_clock_plausibility.sql","86df8afd868bb4fd589a76bf1e1693cdc546037cfc61b54ae972e660fbda056a"],["010_all_player_statistics.sql","f9f2aa0c4dc7a0a3097bf770a7f08ef0719ed7f019307dcf629fa17058af31b4"],["011_all_player_foundation_guards.sql","0eaa96bcc0b65053ac8dab48657eb7bfe22fadbfd41b4f4c78c3472ca8a512b6"],["012_all_player_provider_participation.sql","bea4bd568c05eee7da177811b25a1389180d37329b9061b3e79ee60d546aa4ed"],["013_all_player_participation_assumption.sql","4e03581db2b9a33d0df77110fe32b81745bec7f1ab001a20bfd788c4b4283d80"],["014_all_player_hourly_collection.sql","3aa6e19555c1e38bf7805199d401b0c6acd3ada00716950e04e54573867b1fc3"],["015_all_player_dynasty_publication.sql","f7bf9b74cc14c0ede7a7534257ea956f99edc2615983b5b66ae546f2812fef8a"],["016_portable_league_administration.sql","d662d9e9709153a4e9a6cbc93522bdd4d14c5b0a0c74a7c7ea8648455896596c"],["017_enrolled_all_player_publication.sql","1247dbfbdfbc79f41a448cf3b2e95fb4f9387e951a26f340e9533754e5c9c361"]]'::jsonb
    THEN RAISE EXCEPTION 'partial_context release expected exactly migrations 001-017 and their accepted checksums'; END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='league_one_runtime' AND NOT rolsuper AND NOT rolcreaterole AND NOT rolcreatedb AND NOT rolbypassrls)
    OR EXISTS(SELECT 1 FROM pg_roles WHERE rolname<>'league_one_runtime' AND pg_has_role('league_one_runtime',oid,'SET'))
    THEN RAISE EXCEPTION 'partial_context runtime role is privileged or can assume another role'; END IF;
  IF EXISTS(SELECT 1 FROM public.projection_jobs WHERE state='running' AND lease_until>clock_timestamp())
    OR EXISTS(SELECT 1 FROM public.league_week_lineup_watch_states WHERE active_attempt_id IS NOT NULL AND lease_expires_at>clock_timestamp())
    OR EXISTS(SELECT 1 FROM public.projection_period_refresh_states WHERE active_attempt_id IS NOT NULL AND active_attempt_expires_at>clock_timestamp())
    OR EXISTS(SELECT 1 FROM public.league_week_materialization_states WHERE active_attempt_id IS NOT NULL AND active_attempt_expires_at>clock_timestamp())
    THEN RAISE EXCEPTION 'partial_context release found an active worker owner'; END IF;
  IF (SELECT jsonb_agg(t.relname ORDER BY t.relname) FROM pg_class t WHERE t.relnamespace='public'::regnamespace AND t.relkind IN ('r','p') AND t.relname<>'app_schema_migrations') IS DISTINCT FROM '["all_player_score_sets","all_player_score_verifications","all_player_scores","all_player_stat_contents","all_player_stat_entries","all_player_stat_observations","current_all_player_score_sets","current_pregame_projection_candidates","current_projection_slates","current_projection_snapshots","external_game_ids","external_scoring_entity_ids","game_state_observations","league_administration_contents","league_administration_enrollment_seasons","league_administration_enrollments","league_administration_heads","league_administration_manager_entries","league_administration_memberships","league_administration_observations","league_administration_team_entries","league_administration_transaction_entries","league_configuration_activations","league_configuration_heads","league_configuration_versions","league_period_authorities","league_season_teams","league_seasons","league_source_connection_history","league_source_connections","league_source_manager_accounts","league_week_expected_games","league_week_lineup_watch_states","league_week_materialization_states","league_week_observations","leagues","nfl_games","official_player_point_observations","official_roster_point_observations","pregame_projection_baselines","pregame_projection_candidates","pregame_projection_runs","projection_jobs","projection_period_refresh_states","projection_slate_contents","projection_slate_entries","projection_slate_observations","projection_snapshots","scoring_entities","scoring_profiles"]'::jsonb
    THEN RAISE EXCEPTION 'release protected physical-table inventory mismatch'; END IF;
  SELECT catalog INTO actual_catalog FROM (SELECT jsonb_build_object(
    'tables', COALESCE((SELECT jsonb_agg(jsonb_build_object(
      'name',t.relname,'kind',t.relkind,'owner',owner.rolname,'acl',COALESCE(t.relacl::text,''),
      'rls',t.relrowsecurity,'forceRls',t.relforcerowsecurity,
      'runtimePrivileges',(SELECT jsonb_agg(privilege ORDER BY privilege) FROM unnest(ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) privilege
        WHERE has_table_privilege('league_one_runtime',t.oid,privilege)),
      'publicPrivileges',COALESCE((SELECT jsonb_agg(acl.privilege_type ORDER BY acl.privilege_type)
        FROM aclexplode(COALESCE(t.relacl,acldefault('r',t.relowner))) acl WHERE acl.grantee=0),'[]'::jsonb),
      'columns',columns.n,'columnHash',columns.hash,
      'constraints',constraints.n,'notNullConstraints',constraints.nn,'constraintHash',constraints.hash,
      'indexes',indexes.n,'indexHash',indexes.hash,'policyHash',policies.hash
    ) ORDER BY t.relname) FROM pg_class t JOIN pg_namespace ns ON ns.oid=t.relnamespace
    JOIN pg_roles owner ON owner.oid=t.relowner
    CROSS JOIN LATERAL (SELECT count(*) AS n,md5(COALESCE(string_agg(
      a.attname||chr(31)||format_type(a.atttypid,a.atttypmod)||chr(31)||a.attnotnull::text
      ||chr(31)||COALESCE(a.attacl::text,'')||chr(31)||COALESCE(pg_get_expr(d.adbin,d.adrelid),''),chr(30) ORDER BY a.attnum),'')) AS hash
      FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum
      WHERE a.attrelid=t.oid AND a.attnum>0 AND NOT a.attisdropped) columns
    CROSS JOIN LATERAL (SELECT count(*) AS n,count(*) FILTER(WHERE c.contype='n') AS nn,
      md5(COALESCE(string_agg(c.conname||chr(31)||c.contype::text||chr(31)||c.convalidated::text||chr(31)
      ||pg_get_constraintdef(c.oid,true),chr(30) ORDER BY c.conname),'')) AS hash
      FROM pg_constraint c WHERE c.conrelid=t.oid) constraints
    CROSS JOIN LATERAL (SELECT count(*) AS n,md5(COALESCE(string_agg(i.indexname||chr(31)||i.indexdef,
      chr(30) ORDER BY i.indexname),'')) AS hash FROM pg_indexes i WHERE i.schemaname='public' AND i.tablename=t.relname) indexes
    CROSS JOIN LATERAL (SELECT md5(COALESCE(string_agg(p.polname||chr(31)||p.polcmd::text||chr(31)||p.polpermissive::text
      ||chr(31)||p.polroles::text||chr(31)||COALESCE(pg_get_expr(p.polqual,p.polrelid),'')||chr(31)
      ||COALESCE(pg_get_expr(p.polwithcheck,p.polrelid),''),chr(30) ORDER BY p.polname),'')) AS hash
      FROM pg_policy p WHERE p.polrelid=t.oid) policies
    WHERE ns.nspname='public' AND t.relkind IN ('r','p','v','m','f') AND t.relname =ANY(ARRAY[]::text[])),'[]'::jsonb),
    'constraintTypes',COALESCE((SELECT jsonb_agg(jsonb_build_array(kind,n) ORDER BY kind) FROM (
      SELECT c.contype::text AS kind,count(*) AS n FROM pg_constraint c JOIN pg_class t ON t.oid=c.conrelid
      WHERE t.relnamespace='public'::regnamespace AND t.relname =ANY(ARRAY[]::text[]) GROUP BY c.contype) kinds),'[]'::jsonb),
    'functions',COALESCE((SELECT jsonb_agg(jsonb_build_object('signature',p.proname||'('||replace(oidvectortypes(p.proargtypes),', ',',')||')',
      'definitionHash',md5(pg_get_functiondef(p.oid)),'owner',owner.rolname,'securityDefiner',p.prosecdef,
      'configuration',p.proconfig,'acl',COALESCE(p.proacl::text,''),
      'runtimeExecute',has_function_privilege('league_one_runtime',p.oid,'EXECUTE'),
      'publicExecute',EXISTS(SELECT 1 FROM aclexplode(COALESCE(p.proacl,acldefault('f',p.proowner))) acl
        WHERE acl.grantee=0 AND acl.privilege_type='EXECUTE')) ORDER BY p.proname||'('||replace(oidvectortypes(p.proargtypes),', ',',')||')')
      FROM pg_proc p JOIN pg_roles owner ON owner.oid=p.proowner
      WHERE p.pronamespace='public'::regnamespace AND p.prokind='f' AND p.proname||'('||replace(oidvectortypes(p.proargtypes),', ',',')||')' =ANY(ARRAY['validate_all_player_stat_entry()','finish_all_player_job(jsonb,text,jsonb)']::text[])),'[]'::jsonb),
    'triggers',COALESCE((SELECT jsonb_agg(jsonb_build_object('key',t.relname||'.'||tr.tgname,
      'function',p.proname,'enabled',tr.tgenabled,'definitionHash',md5(pg_get_triggerdef(tr.oid,true))) ORDER BY t.relname,tr.tgname)
      FROM pg_trigger tr JOIN pg_class t ON t.oid=tr.tgrelid JOIN pg_proc p ON p.oid=tr.tgfoid
      WHERE t.relnamespace='public'::regnamespace AND NOT tr.tgisinternal AND (t.relname=ANY(ARRAY[]::text[]) OR (t.relname||'.'||tr.tgname)=ANY(ARRAY[]::text[]))),'[]'::jsonb)

  ) AS catalog) captured;
  IF actual_catalog IS DISTINCT FROM '{"tables":[],"triggers":[],"functions":[{"acl":"{neondb_owner=X/neondb_owner,league_one_runtime=X/neondb_owner}","owner":"neondb_owner","signature":"finish_all_player_job(jsonb,text,jsonb)","configuration":["search_path=pg_catalog, public, pg_temp"],"publicExecute":false,"definitionHash":"f3a85518ccfc0c501c9fe42114b85b04","runtimeExecute":true,"securityDefiner":true},{"acl":"{neondb_owner=X/neondb_owner}","owner":"neondb_owner","signature":"validate_all_player_stat_entry()","configuration":["search_path=pg_catalog, public, pg_temp"],"publicExecute":false,"definitionHash":"7ab2d14d2fd08fa8a0b8aa9a25b9693c","runtimeExecute":false,"securityDefiner":true}],"constraintTypes":[]}'::jsonb
    THEN RAISE EXCEPTION 'partial_context installed 017 catalog, ownership, or grants mismatch'; END IF;
END; $partial_context_before$;
CREATE TEMP TABLE partial_context_release_unaffected_before ON COMMIT DROP AS SELECT jsonb_build_object(
    'tables', COALESCE((SELECT jsonb_agg(jsonb_build_object(
      'name',t.relname,'kind',t.relkind,'owner',owner.rolname,'acl',COALESCE(t.relacl::text,''),
      'rls',t.relrowsecurity,'forceRls',t.relforcerowsecurity,
      'runtimePrivileges',(SELECT jsonb_agg(privilege ORDER BY privilege) FROM unnest(ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) privilege
        WHERE has_table_privilege('league_one_runtime',t.oid,privilege)),
      'publicPrivileges',COALESCE((SELECT jsonb_agg(acl.privilege_type ORDER BY acl.privilege_type)
        FROM aclexplode(COALESCE(t.relacl,acldefault('r',t.relowner))) acl WHERE acl.grantee=0),'[]'::jsonb),
      'columns',columns.n,'columnHash',columns.hash,
      'constraints',constraints.n,'notNullConstraints',constraints.nn,'constraintHash',constraints.hash,
      'indexes',indexes.n,'indexHash',indexes.hash,'policyHash',policies.hash
    ) ORDER BY t.relname) FROM pg_class t JOIN pg_namespace ns ON ns.oid=t.relnamespace
    JOIN pg_roles owner ON owner.oid=t.relowner
    CROSS JOIN LATERAL (SELECT count(*) AS n,md5(COALESCE(string_agg(
      a.attname||chr(31)||format_type(a.atttypid,a.atttypmod)||chr(31)||a.attnotnull::text
      ||chr(31)||COALESCE(a.attacl::text,'')||chr(31)||COALESCE(pg_get_expr(d.adbin,d.adrelid),''),chr(30) ORDER BY a.attnum),'')) AS hash
      FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum
      WHERE a.attrelid=t.oid AND a.attnum>0 AND NOT a.attisdropped) columns
    CROSS JOIN LATERAL (SELECT count(*) AS n,count(*) FILTER(WHERE c.contype='n') AS nn,
      md5(COALESCE(string_agg(c.conname||chr(31)||c.contype::text||chr(31)||c.convalidated::text||chr(31)
      ||pg_get_constraintdef(c.oid,true),chr(30) ORDER BY c.conname),'')) AS hash
      FROM pg_constraint c WHERE c.conrelid=t.oid) constraints
    CROSS JOIN LATERAL (SELECT count(*) AS n,md5(COALESCE(string_agg(i.indexname||chr(31)||i.indexdef,
      chr(30) ORDER BY i.indexname),'')) AS hash FROM pg_indexes i WHERE i.schemaname='public' AND i.tablename=t.relname) indexes
    CROSS JOIN LATERAL (SELECT md5(COALESCE(string_agg(p.polname||chr(31)||p.polcmd::text||chr(31)||p.polpermissive::text
      ||chr(31)||p.polroles::text||chr(31)||COALESCE(pg_get_expr(p.polqual,p.polrelid),'')||chr(31)
      ||COALESCE(pg_get_expr(p.polwithcheck,p.polrelid),''),chr(30) ORDER BY p.polname),'')) AS hash
      FROM pg_policy p WHERE p.polrelid=t.oid) policies
    WHERE ns.nspname='public' AND t.relkind IN ('r','p','v','m','f') AND t.relname <>ALL(ARRAY[]::text[])),'[]'::jsonb),
    'constraintTypes',COALESCE((SELECT jsonb_agg(jsonb_build_array(kind,n) ORDER BY kind) FROM (
      SELECT c.contype::text AS kind,count(*) AS n FROM pg_constraint c JOIN pg_class t ON t.oid=c.conrelid
      WHERE t.relnamespace='public'::regnamespace AND t.relname <>ALL(ARRAY[]::text[]) GROUP BY c.contype) kinds),'[]'::jsonb),
    'functions',COALESCE((SELECT jsonb_agg(jsonb_build_object('signature',p.proname||'('||replace(oidvectortypes(p.proargtypes),', ',',')||')',
      'definitionHash',md5(pg_get_functiondef(p.oid)),'owner',owner.rolname,'securityDefiner',p.prosecdef,
      'configuration',p.proconfig,'acl',COALESCE(p.proacl::text,''),
      'runtimeExecute',has_function_privilege('league_one_runtime',p.oid,'EXECUTE'),
      'publicExecute',EXISTS(SELECT 1 FROM aclexplode(COALESCE(p.proacl,acldefault('f',p.proowner))) acl
        WHERE acl.grantee=0 AND acl.privilege_type='EXECUTE')) ORDER BY p.proname||'('||replace(oidvectortypes(p.proargtypes),', ',',')||')')
      FROM pg_proc p JOIN pg_roles owner ON owner.oid=p.proowner
      WHERE p.pronamespace='public'::regnamespace AND p.prokind='f' AND p.proname||'('||replace(oidvectortypes(p.proargtypes),', ',',')||')' <>ALL(ARRAY['validate_all_player_stat_entry()','finish_all_player_job(jsonb,text,jsonb)']::text[])),'[]'::jsonb),
    'triggers',COALESCE((SELECT jsonb_agg(jsonb_build_object('key',t.relname||'.'||tr.tgname,
      'function',p.proname,'enabled',tr.tgenabled,'definitionHash',md5(pg_get_triggerdef(tr.oid,true))) ORDER BY t.relname,tr.tgname)
      FROM pg_trigger tr JOIN pg_class t ON t.oid=tr.tgrelid JOIN pg_proc p ON p.oid=tr.tgfoid
      WHERE t.relnamespace='public'::regnamespace AND NOT tr.tgisinternal AND (t.relname<>ALL(ARRAY[]::text[]) AND (t.relname||'.'||tr.tgname)<>ALL(ARRAY[]::text[]))),'[]'::jsonb)
    ,
    'schemas',(SELECT md5(COALESCE(string_agg(n.nspname||chr(31)||r.rolname||chr(31)||COALESCE(n.nspacl::text,''),chr(30) ORDER BY n.nspname),''))
      FROM pg_namespace n JOIN pg_roles r ON r.oid=n.nspowner WHERE n.nspname !~ '^pg_(toast_)?temp_'),
    'sequences',(SELECT md5(COALESCE(string_agg(t.relname||chr(31)||r.rolname||chr(31)||COALESCE(t.relacl::text,''),chr(30) ORDER BY t.relname),''))
      FROM pg_class t JOIN pg_roles r ON r.oid=t.relowner WHERE t.relnamespace='public'::regnamespace AND t.relkind='S'),
    'roles',(SELECT md5(COALESCE(string_agg(r.rolname||chr(31)||r.rolsuper::text||chr(31)||r.rolinherit::text||chr(31)
      ||r.rolcreaterole::text||chr(31)||r.rolcreatedb::text||chr(31)||r.rolcanlogin::text||chr(31)||r.rolreplication::text
      ||chr(31)||r.rolbypassrls::text,chr(30) ORDER BY r.rolname),'')) FROM pg_roles r),
    'memberships',(SELECT md5(COALESCE(string_agg(m.rolname||chr(31)||r.rolname||chr(31)||a.admin_option::text
      ||chr(31)||a.inherit_option::text||chr(31)||a.set_option::text,chr(30) ORDER BY m.rolname,r.rolname),''))
      FROM pg_auth_members a JOIN pg_roles m ON m.oid=a.member JOIN pg_roles r ON r.oid=a.roleid),
    'defaultPrivileges',(SELECT md5(COALESCE(string_agg(r.rolname||chr(31)||COALESCE(n.nspname,'')||chr(31)||a.defaclobjtype::text
      ||chr(31)||a.defaclacl::text,chr(30) ORDER BY r.rolname,n.nspname,a.defaclobjtype),''))
      FROM pg_default_acl a JOIN pg_roles r ON r.oid=a.defaclrole LEFT JOIN pg_namespace n ON n.oid=a.defaclnamespace)
  ) AS catalog;
CREATE TEMP TABLE partial_context_release_history_before ON COMMIT DROP AS SELECT 'all_player_score_sets' AS name,count(*)::bigint AS rows FROM public.all_player_score_sets
UNION ALL
SELECT 'all_player_score_verifications' AS name,count(*)::bigint AS rows FROM public.all_player_score_verifications
UNION ALL
SELECT 'all_player_scores' AS name,count(*)::bigint AS rows FROM public.all_player_scores
UNION ALL
SELECT 'all_player_stat_contents' AS name,count(*)::bigint AS rows FROM public.all_player_stat_contents
UNION ALL
SELECT 'all_player_stat_entries' AS name,count(*)::bigint AS rows FROM public.all_player_stat_entries
UNION ALL
SELECT 'all_player_stat_observations' AS name,count(*)::bigint AS rows FROM public.all_player_stat_observations
UNION ALL
SELECT 'current_all_player_score_sets' AS name,count(*)::bigint AS rows FROM public.current_all_player_score_sets
UNION ALL
SELECT 'current_pregame_projection_candidates' AS name,count(*)::bigint AS rows FROM public.current_pregame_projection_candidates
UNION ALL
SELECT 'current_projection_slates' AS name,count(*)::bigint AS rows FROM public.current_projection_slates
UNION ALL
SELECT 'current_projection_snapshots' AS name,count(*)::bigint AS rows FROM public.current_projection_snapshots
UNION ALL
SELECT 'external_game_ids' AS name,count(*)::bigint AS rows FROM public.external_game_ids
UNION ALL
SELECT 'external_scoring_entity_ids' AS name,count(*)::bigint AS rows FROM public.external_scoring_entity_ids
UNION ALL
SELECT 'game_state_observations' AS name,count(*)::bigint AS rows FROM public.game_state_observations
UNION ALL
SELECT 'league_administration_contents' AS name,count(*)::bigint AS rows FROM public.league_administration_contents
UNION ALL
SELECT 'league_administration_enrollment_seasons' AS name,count(*)::bigint AS rows FROM public.league_administration_enrollment_seasons
UNION ALL
SELECT 'league_administration_enrollments' AS name,count(*)::bigint AS rows FROM public.league_administration_enrollments
UNION ALL
SELECT 'league_administration_heads' AS name,count(*)::bigint AS rows FROM public.league_administration_heads
UNION ALL
SELECT 'league_administration_manager_entries' AS name,count(*)::bigint AS rows FROM public.league_administration_manager_entries
UNION ALL
SELECT 'league_administration_memberships' AS name,count(*)::bigint AS rows FROM public.league_administration_memberships
UNION ALL
SELECT 'league_administration_observations' AS name,count(*)::bigint AS rows FROM public.league_administration_observations
UNION ALL
SELECT 'league_administration_team_entries' AS name,count(*)::bigint AS rows FROM public.league_administration_team_entries
UNION ALL
SELECT 'league_administration_transaction_entries' AS name,count(*)::bigint AS rows FROM public.league_administration_transaction_entries
UNION ALL
SELECT 'league_configuration_activations' AS name,count(*)::bigint AS rows FROM public.league_configuration_activations
UNION ALL
SELECT 'league_configuration_heads' AS name,count(*)::bigint AS rows FROM public.league_configuration_heads
UNION ALL
SELECT 'league_configuration_versions' AS name,count(*)::bigint AS rows FROM public.league_configuration_versions
UNION ALL
SELECT 'league_period_authorities' AS name,count(*)::bigint AS rows FROM public.league_period_authorities
UNION ALL
SELECT 'league_season_teams' AS name,count(*)::bigint AS rows FROM public.league_season_teams
UNION ALL
SELECT 'league_seasons' AS name,count(*)::bigint AS rows FROM public.league_seasons
UNION ALL
SELECT 'league_source_connection_history' AS name,count(*)::bigint AS rows FROM public.league_source_connection_history
UNION ALL
SELECT 'league_source_connections' AS name,count(*)::bigint AS rows FROM public.league_source_connections
UNION ALL
SELECT 'league_source_manager_accounts' AS name,count(*)::bigint AS rows FROM public.league_source_manager_accounts
UNION ALL
SELECT 'league_week_expected_games' AS name,count(*)::bigint AS rows FROM public.league_week_expected_games
UNION ALL
SELECT 'league_week_lineup_watch_states' AS name,count(*)::bigint AS rows FROM public.league_week_lineup_watch_states
UNION ALL
SELECT 'league_week_materialization_states' AS name,count(*)::bigint AS rows FROM public.league_week_materialization_states
UNION ALL
SELECT 'league_week_observations' AS name,count(*)::bigint AS rows FROM public.league_week_observations
UNION ALL
SELECT 'leagues' AS name,count(*)::bigint AS rows FROM public.leagues
UNION ALL
SELECT 'nfl_games' AS name,count(*)::bigint AS rows FROM public.nfl_games
UNION ALL
SELECT 'official_player_point_observations' AS name,count(*)::bigint AS rows FROM public.official_player_point_observations
UNION ALL
SELECT 'official_roster_point_observations' AS name,count(*)::bigint AS rows FROM public.official_roster_point_observations
UNION ALL
SELECT 'pregame_projection_baselines' AS name,count(*)::bigint AS rows FROM public.pregame_projection_baselines
UNION ALL
SELECT 'pregame_projection_candidates' AS name,count(*)::bigint AS rows FROM public.pregame_projection_candidates
UNION ALL
SELECT 'pregame_projection_runs' AS name,count(*)::bigint AS rows FROM public.pregame_projection_runs
UNION ALL
SELECT 'projection_jobs' AS name,count(*)::bigint AS rows FROM public.projection_jobs
UNION ALL
SELECT 'projection_period_refresh_states' AS name,count(*)::bigint AS rows FROM public.projection_period_refresh_states
UNION ALL
SELECT 'projection_slate_contents' AS name,count(*)::bigint AS rows FROM public.projection_slate_contents
UNION ALL
SELECT 'projection_slate_entries' AS name,count(*)::bigint AS rows FROM public.projection_slate_entries
UNION ALL
SELECT 'projection_slate_observations' AS name,count(*)::bigint AS rows FROM public.projection_slate_observations
UNION ALL
SELECT 'projection_snapshots' AS name,count(*)::bigint AS rows FROM public.projection_snapshots
UNION ALL
SELECT 'scoring_entities' AS name,count(*)::bigint AS rows FROM public.scoring_entities
UNION ALL
SELECT 'scoring_profiles' AS name,count(*)::bigint AS rows FROM public.scoring_profiles;

-- Retain valid unresolved player observations; record verified pregame no-data outcomes.
-- Additive correction only. Installed 001-017, immutable rows and pointer guards remain intact.
-- Both replacements preserve their existing owners, SECURITY DEFINER and execute privileges.

CREATE OR REPLACE FUNCTION public.validate_all_player_stat_entry()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  content_context record;
  game_context record;
  period_evidence jsonb;
  weekly_evidence jsonb;
  raw_key text;
  evidence_key text;
  expected_raw jsonb;
BEGIN
  IF public.all_player_eligibility_evidence_matches(NEW.eligibility_evidence,
    NEW.eligible_game_count,NEW.appearance_game_count) IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'all-player eligibility evidence does not support its counts';
  END IF;
  SELECT season,season_type,week,normalizer_version,quality INTO STRICT content_context
  FROM public.all_player_stat_contents WHERE id = NEW.all_player_stat_content_id;
  IF NEW.eligibility_evidence->>'kind' = 'assumed-nonparticipation' THEN
    IF content_context.normalizer_version NOT LIKE '%-weekly-stats-v4'
      OR NEW.entity_kind IS DISTINCT FROM 'player' THEN
      RAISE EXCEPTION 'all-player participation assumption requires a v4 player observation';
    END IF;
    IF NEW.eligibility_evidence->'basis'->>'kind' = 'missing-provider-row' AND NEW.stats <> '{}'::jsonb THEN
      RAISE EXCEPTION 'all-player missing-row participation assumption requires empty statistics';
    END IF;
  END IF;
  weekly_evidence := CASE WHEN NEW.eligibility_evidence->>'kind' = 'weekly-stat'
    THEN NEW.eligibility_evidence
    WHEN NEW.eligibility_evidence->>'kind' = 'assumed-nonparticipation'
      AND NEW.eligibility_evidence->'basis'->>'kind' = 'weekly-stat' THEN NEW.eligibility_evidence->'basis'
    ELSE NEW.eligibility_evidence->'weekly' END;
  IF (content_context.normalizer_version LIKE '%-weekly-stats-v3' OR content_context.normalizer_version LIKE '%-weekly-stats-v4')
    AND weekly_evidence IS NULL AND NEW.stats ?| ARRAY['gms_active','gp','off_snp','def_snp','st_snp'] THEN
    RAISE EXCEPTION 'all-player retained participation statistics require weekly evidence';
  END IF;
  IF weekly_evidence IS NOT NULL THEN
    FOREACH raw_key IN ARRAY ARRAY['gms_active','gp'] LOOP
      evidence_key := CASE WHEN raw_key = 'gms_active' THEN 'gmsActive' ELSE 'appearances' END;
      IF weekly_evidence->'rawFlags' ? raw_key THEN
        expected_raw := CASE WHEN jsonb_typeof(weekly_evidence->'rawFlags'->raw_key) = 'number'
          THEN weekly_evidence->'rawFlags'->raw_key ELSE NULL END;
      ELSE expected_raw := weekly_evidence->evidence_key;
      END IF;
      IF NEW.stats->raw_key IS DISTINCT FROM expected_raw THEN
        RAISE EXCEPTION 'all-player weekly eligibility flag disagrees with retained statistics';
      END IF;
    END LOOP;
    IF weekly_evidence ? 'individualSnaps'
      OR COALESCE(weekly_evidence->'rawFlags' ?| ARRAY['off_snp','def_snp','st_snp'],false) THEN
      IF NEW.entity_kind IS DISTINCT FROM 'player' THEN
        RAISE EXCEPTION 'all-player individual snap evidence requires a player identity';
      END IF;
    END IF;
    -- v2 observations may already retain snap statistics without using them as
    -- participation evidence. Preserve those exact historical replays. v3
    -- and any caller using the new evidence must bind every retained snap key.
    IF content_context.normalizer_version LIKE '%-weekly-stats-v3' OR content_context.normalizer_version LIKE '%-weekly-stats-v4'
      OR weekly_evidence ? 'individualSnaps'
      OR COALESCE(weekly_evidence->'rawFlags' ?| ARRAY['off_snp','def_snp','st_snp'],false) THEN
      FOREACH raw_key IN ARRAY ARRAY['off_snp','def_snp','st_snp'] LOOP
        IF weekly_evidence->'rawFlags' ? raw_key THEN
          expected_raw := CASE WHEN jsonb_typeof(weekly_evidence->'rawFlags'->raw_key) = 'number'
            THEN weekly_evidence->'rawFlags'->raw_key ELSE NULL END;
        ELSE expected_raw := weekly_evidence->'individualSnaps'->raw_key;
        END IF;
        IF NEW.stats->raw_key IS DISTINCT FROM expected_raw THEN
          RAISE EXCEPTION 'all-player individual snap evidence disagrees with retained statistics';
        END IF;
      END LOOP;
    END IF;
  END IF;
  period_evidence := CASE WHEN NEW.eligibility_evidence->>'kind' IN ('combined-ineligible','conflict')
    THEN NEW.eligibility_evidence->'ineligibility'
    WHEN NEW.eligibility_evidence->>'kind' IN ('explicit-ineligible','period-participation','assumed-nonparticipation')
    THEN NEW.eligibility_evidence ELSE NULL END;
  IF period_evidence IS NOT NULL AND (
    (period_evidence->'effectivePeriod'->>'season')::integer IS DISTINCT FROM content_context.season
    OR period_evidence->'effectivePeriod'->>'seasonType' IS DISTINCT FROM content_context.season_type
    OR (period_evidence->'effectivePeriod'->>'week')::integer IS DISTINCT FROM content_context.week
  ) THEN RAISE EXCEPTION 'all-player eligibility evidence does not match its content period'; END IF;
  IF NEW.eligible_game_count = 1 AND NEW.nfl_game_id IS NULL
    AND NOT (content_context.quality = 'partial' AND NEW.entity_kind = 'player'
      AND NEW.game_phase = 'unknown') THEN
    RAISE EXCEPTION 'eligible all-player entry requires an NFL game';
  END IF;
  IF NEW.nfl_game_id IS NOT NULL THEN
    SELECT season,season_type,week,home_team,away_team INTO STRICT game_context
    FROM public.nfl_games WHERE id = NEW.nfl_game_id;
    IF NEW.nfl_team IS NULL OR game_context.season <> content_context.season
      OR game_context.season_type <> content_context.season_type OR game_context.week <> content_context.week
      OR NEW.nfl_team NOT IN (game_context.home_team,game_context.away_team) THEN
      RAISE EXCEPTION 'all-player NFL game does not match its content period and team';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.finish_all_player_job(p_fence jsonb, p_outcome text, p_diagnostic jsonb)
RETURNS boolean LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE job public.projection_jobs%ROWTYPE; completed timestamptz; result jsonb; history jsonb; summary jsonb; prior_final jsonb; publication jsonb;
  response jsonb; pregame jsonb; proof_at timestamptz; first_kickoff timestamptz; game_count integer;
  stored_final boolean := false; stored_observed_at timestamptz; expected_count integer; actual_count integer;
BEGIN
  IF p_outcome IS NULL OR p_outcome NOT IN ('published','partial','no-statistics-yet','validation-failed','provider-failed','timeout','lease-lost')
    OR jsonb_typeof(p_diagnostic) IS DISTINCT FROM 'object'
    OR octet_length(p_diagnostic::text) > 16000 THEN
    RAISE EXCEPTION 'all-player durable outcome is invalid';
  END IF;
  SELECT * INTO job FROM public.projection_jobs
    WHERE job_key = 'all-player-ingestion:sleeper' FOR UPDATE;
  -- Deadline expiry can be recorded during reserved handling time; ownership and
  -- lease expiry are always enforced, including failed completion.
  IF NOT FOUND OR jsonb_typeof(p_fence) IS DISTINCT FROM 'object'
    OR NOT (p_fence ?& ARRAY['jobKey','workerId','generation','leaseUntil','deadlineAt'])
    OR job.state IS DISTINCT FROM 'running'
    OR job.lease_owner IS DISTINCT FROM p_fence->>'workerId'
    OR job.attempt_count IS DISTINCT FROM (p_fence->>'generation')::integer
    OR job.lease_until IS DISTINCT FROM (p_fence->>'leaseUntil')::timestamptz
    OR (job.payload->>'deadlineAt')::timestamptz IS DISTINCT FROM (p_fence->>'deadlineAt')::timestamptz
    OR job.lease_until <= clock_timestamp()
    OR p_fence->>'jobKey' IS DISTINCT FROM job.job_key THEN RETURN false; END IF;
  completed := clock_timestamp();
  IF p_outcome IN ('published','no-statistics-yet') AND (job.payload->>'deadlineAt')::timestamptz <= completed
    THEN RETURN false; END IF;
  IF p_outcome = 'no-statistics-yet' THEN
    BEGIN
    response := p_diagnostic->'responseEvidence'; pregame := p_diagnostic->'pregameEvidence';
    IF job.payload->>'mode' IS DISTINCT FROM 'recurring'
      OR (job.payload->>'requestGeneration')::integer IS DISTINCT FROM job.attempt_count
      OR (job.payload->'lastPublication'->>'generation')::integer = job.attempt_count
      OR p_diagnostic->>'reason' IS DISTINCT FROM 'no-statistics-yet'
      OR p_diagnostic->>'stage' IS DISTINCT FROM 'no-statistics-yet'
      OR p_diagnostic->'period' IS DISTINCT FROM jsonb_build_object('season',job.payload->'period'->'season',
        'seasonType','regular','week',job.payload->'period'->'week')
      OR p_diagnostic->'finalCoverage' IS DISTINCT FROM 'false'::jsonb
      OR p_diagnostic->>'retryDisposition' IS DISTINCT FROM 'global-budget'
      OR jsonb_typeof(response) IS DISTINCT FROM 'object'
      OR response->>'bodyShape' IS DISTINCT FROM 'object'
      OR response->'topLevelCount' IS DISTINCT FROM '0'::jsonb
      OR jsonb_typeof(response->'httpStatus') IS DISTINCT FROM 'number'
      OR (response->>'httpStatus')::integer NOT BETWEEN 200 AND 299
      OR COALESCE(response->>'bodyHash','') !~ '^sha256:[0-9a-f]{64}$'
      OR jsonb_typeof(pregame) IS DISTINCT FROM 'object'
      OR pregame->>'policy' IS DISTINCT FROM 'exact-period-pregame-v1'
      OR jsonb_typeof(pregame->'scheduledGameCount') IS DISTINCT FROM 'number'
      OR COALESCE(pregame->>'scheduleRevision','') !~ '^sha256:[0-9a-f]{64}$'
      OR p_diagnostic->'entryCount' IS DISTINCT FROM '0'::jsonb
      OR p_diagnostic->'scoringProfileCount' IS DISTINCT FROM '0'::jsonb
      THEN RETURN false; END IF;
      proof_at := (pregame->>'verifiedAt')::timestamptz;
      IF proof_at IS NULL OR NOT isfinite(proof_at) OR proof_at > completed
        OR proof_at < completed - interval '90 seconds'
        OR (response->>'requestStartedAt')::timestamptz IS NULL
        OR (response->>'requestCompletedAt')::timestamptz IS NULL
        OR NOT isfinite((response->>'requestStartedAt')::timestamptz)
        OR NOT isfinite((response->>'requestCompletedAt')::timestamptz)
        OR (response->>'requestStartedAt')::timestamptz > (response->>'requestCompletedAt')::timestamptz
        OR (response->>'requestCompletedAt')::timestamptz > proof_at
        OR (response->>'requestCompletedAt')::timestamptz < completed - interval '90 seconds'
        THEN RETURN false; END IF;
      -- A healthy pregame result belongs only to the currently active period
      -- of every enrolled league. Missing registration/authority fails closed.
      IF NOT EXISTS (SELECT 1 FROM public.league_administration_enrollment_seasons
          WHERE provider='sleeper' AND season=(job.payload->'period'->>'season')::integer)
        OR EXISTS (
          SELECT 1 FROM public.league_administration_enrollment_seasons enrollment
          JOIN public.leagues league ON league.id=enrollment.league_id
          LEFT JOIN public.league_seasons season ON season.league_id=enrollment.league_id
            AND season.season=enrollment.season
          LEFT JOIN public.league_source_connections connection ON connection.league_season_id=season.id
            AND connection.provider='sleeper'
          LEFT JOIN public.league_period_authorities authority ON authority.league_key=league.league_key
          WHERE enrollment.provider='sleeper' AND enrollment.season=(job.payload->'period'->>'season')::integer
            AND (authority.source_provider IS DISTINCT FROM 'sleeper'
              OR connection.external_league_id IS NULL
              OR authority.source_external_league_id IS DISTINCT FROM connection.external_league_id
              OR authority.league_lifecycle IS DISTINCT FROM 'active'
              OR authority.active_season IS DISTINCT FROM enrollment.season
              OR authority.active_season_type IS DISTINCT FROM 'reg'
              OR authority.active_week IS DISTINCT FROM (job.payload->'period'->>'week')::integer
              OR authority.verified_at IS NULL OR authority.verified_at < completed-interval '10 minutes'
              OR authority.verified_at > completed+interval '30 seconds'))
        THEN RETURN false; END IF;
      SELECT count(*),min(game.kickoff_at) INTO game_count,first_kickoff
        FROM public.nfl_games game
        WHERE game.season=(job.payload->'period'->>'season')::integer
          AND game.season_type='reg' AND game.week=(job.payload->'period'->>'week')::integer;
      IF game_count = 0 OR game_count IS DISTINCT FROM (pregame->>'scheduledGameCount')::integer
        OR first_kickoff IS NULL OR first_kickoff <= completed
        OR first_kickoff IS DISTINCT FROM (pregame->>'firstKickoffAt')::timestamptz
        OR EXISTS (SELECT 1 FROM public.nfl_games game
          WHERE game.season=(job.payload->'period'->>'season')::integer
            AND game.season_type='reg' AND game.week=(job.payload->'period'->>'week')::integer
            AND (game.kickoff_at IS NULL OR EXISTS (
              SELECT 1 FROM public.game_state_observations state WHERE state.nfl_game_id=game.id
                AND state.provider='tank01' AND state.status_code IN (1,2,4))))
        THEN RETURN false; END IF;
    EXCEPTION WHEN invalid_text_representation OR invalid_datetime_format OR datetime_field_overflow
      OR numeric_value_out_of_range THEN RETURN false;
    END;
  END IF;
  IF p_outcome = 'published' THEN
    publication := job.payload->'lastPublication';
    IF job.payload->>'mode' = 'shadow'
      OR (publication->>'generation')::integer IS DISTINCT FROM job.attempt_count
      OR publication->'period' IS DISTINCT FROM job.payload->'period'
      OR jsonb_typeof(publication->'profileIds') IS DISTINCT FROM 'array' THEN RETURN false; END IF;
    expected_count := jsonb_array_length(publication->'profileIds');
    SELECT count(*), bool_and(COALESCE((content.coverage->>'scheduleFinalityComplete')::boolean,false)),
      min(observation.observed_at)
      INTO actual_count, stored_final, stored_observed_at
      FROM public.current_all_player_score_sets pointer
      JOIN public.all_player_stat_observations observation ON observation.id = pointer.all_player_stat_observation_id
      JOIN public.all_player_stat_contents content ON content.id = observation.all_player_stat_content_id
      WHERE pointer.provider = 'sleeper' AND pointer.season = (job.payload->'period'->>'season')::integer
        AND pointer.season_type = 'reg' AND pointer.week = (job.payload->'period'->>'week')::integer
        AND pointer.scorer_version = publication->>'scorerVersion'
        AND pointer.all_player_stat_observation_id = (publication->>'observationId')::uuid
        AND publication->'profileIds' ? pointer.scoring_profile_id::text
        AND observation.quality = 'complete' AND content.quality = 'complete';
    IF expected_count = 0 OR actual_count <> expected_count THEN RETURN false; END IF;
  END IF;
  result := jsonb_build_object('outcome', p_outcome, 'finishedAt', completed,
    'period', job.payload->'period', 'generation', job.attempt_count, 'diagnostic', p_diagnostic,
    'observedAt', COALESCE(stored_observed_at::text, p_diagnostic->>'observedAt', completed::text),
    'finalCoverage', p_outcome = 'published' AND COALESCE(stored_final,false));
  SELECT value INTO prior_final
    FROM jsonb_array_elements(COALESCE(job.payload->'periodHistory','[]'::jsonb)) value
    WHERE value->'period' = job.payload->'period'
      AND value->>'outcome' = 'published' AND value->>'finalCoverage' = 'true'
    ORDER BY value->>'observedAt' DESC LIMIT 1;
  summary := CASE WHEN prior_final IS NOT NULL AND NOT
      (p_outcome = 'published' AND COALESCE(stored_final,false))
    THEN prior_final || jsonb_build_object('lastAttempt',result)
    ELSE result END;
  -- One summary per requested period for this season; a correction failure never
  -- erases the successful final proof. At most 18 regular-season summaries.
  SELECT COALESCE(jsonb_agg(value ORDER BY (value->'period'->>'week')::integer),'[]'::jsonb)
    INTO history FROM (
      SELECT value FROM jsonb_array_elements(COALESCE(job.payload->'periodHistory','[]'::jsonb)) value
      WHERE value->'period' <> job.payload->'period'
        AND value->'period'->>'season' = job.payload->'period'->>'season'
      UNION ALL SELECT summary
    ) periods;
  UPDATE public.projection_jobs SET
    state = CASE WHEN p_outcome IN ('published','partial','no-statistics-yet') THEN 'completed' ELSE 'failed' END,
    completed_at = completed, lease_owner = NULL, lease_until = NULL, updated_at = completed,
    last_error = CASE WHEN p_outcome IN ('published','partial','no-statistics-yet') THEN NULL ELSE p_outcome END,
    payload = payload || jsonb_build_object('lastOutcome', result, 'periodHistory', history,
      'nextAttemptAt', CASE WHEN (job.payload->>'requestGeneration')::integer IS DISTINCT FROM job.attempt_count
        THEN completed + interval '1 hour' ELSE public.all_player_next_request_at(job.payload) END)
    WHERE job_key = job.job_key
      AND (p_outcome <> 'no-statistics-yet' OR (clock_timestamp() < first_kickoff
        AND clock_timestamp() < (job.payload->>'deadlineAt')::timestamptz
        AND clock_timestamp() < job.lease_until));
  RETURN FOUND;
END;
$$;
INSERT INTO public.app_schema_migrations(name,checksum) VALUES ('018_all_player_partial_context.sql','d8ceba13b99a862a13de74bfa51f27bd2c0afbc16f93e4e9b67b6f79997390cc');

DO $partial_context_after$
DECLARE actual_catalog jsonb; old_count record; new_count bigint;
BEGIN
  IF (SELECT jsonb_agg(jsonb_build_array(name,checksum) ORDER BY name) FROM public.app_schema_migrations) IS DISTINCT FROM '[["001_projection_foundation.sql","eefa3aa224dbc6f0c6bb3edc9e4690425e2d6af7094938f3528059717d205050"],["002_manager_snapshot_payloads.sql","74585dec3e2717eede0579f9281a041a4e3cc0b0cd8378383fe2e3d64fd7214d"],["003_league_period_authority.sql","6f98e09646834cc542a6413e00c0d0c2d84ad4a5ff33905e429aba87c951406e"],["004_durable_projection_slates.sql","8ad48c22dea0d942a0a14027dcb240cda18f1bd728403e41aafa6b76f42f95b9"],["005_future_projection_refresh.sql","02bb6a3c6a183e7074fbea156b5f393d5772619098ab7c07be9dcc5528003c75"],["006_flexed_kickoff_candidate_index.sql","d2c54c4e17439d3773cfab8db8ed68bf332abd1073fe793f62138efa89e1a3b0"],["007_lineup_freshness.sql","1a92f9517294fe289bd25d74923dd042d0cb394d143b5c89d33ed017963c3e47"],["008_additive_write_guards.sql","2447ffac523e1f5536e218887d5c29895c3a095385f89bd6beb55cb7c5e95814"],["009_game_clock_plausibility.sql","86df8afd868bb4fd589a76bf1e1693cdc546037cfc61b54ae972e660fbda056a"],["010_all_player_statistics.sql","f9f2aa0c4dc7a0a3097bf770a7f08ef0719ed7f019307dcf629fa17058af31b4"],["011_all_player_foundation_guards.sql","0eaa96bcc0b65053ac8dab48657eb7bfe22fadbfd41b4f4c78c3472ca8a512b6"],["012_all_player_provider_participation.sql","bea4bd568c05eee7da177811b25a1389180d37329b9061b3e79ee60d546aa4ed"],["013_all_player_participation_assumption.sql","4e03581db2b9a33d0df77110fe32b81745bec7f1ab001a20bfd788c4b4283d80"],["014_all_player_hourly_collection.sql","3aa6e19555c1e38bf7805199d401b0c6acd3ada00716950e04e54573867b1fc3"],["015_all_player_dynasty_publication.sql","f7bf9b74cc14c0ede7a7534257ea956f99edc2615983b5b66ae546f2812fef8a"],["016_portable_league_administration.sql","d662d9e9709153a4e9a6cbc93522bdd4d14c5b0a0c74a7c7ea8648455896596c"],["017_enrolled_all_player_publication.sql","1247dbfbdfbc79f41a448cf3b2e95fb4f9387e951a26f340e9533754e5c9c361"],["018_all_player_partial_context.sql","d8ceba13b99a862a13de74bfa51f27bd2c0afbc16f93e4e9b67b6f79997390cc"]]'::jsonb
    THEN RAISE EXCEPTION 'partial_context release final migration ledger mismatch'; END IF;
  SELECT catalog INTO actual_catalog FROM (SELECT jsonb_build_object(
    'tables', COALESCE((SELECT jsonb_agg(jsonb_build_object(
      'name',t.relname,'kind',t.relkind,'owner',owner.rolname,'acl',COALESCE(t.relacl::text,''),
      'rls',t.relrowsecurity,'forceRls',t.relforcerowsecurity,
      'runtimePrivileges',(SELECT jsonb_agg(privilege ORDER BY privilege) FROM unnest(ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) privilege
        WHERE has_table_privilege('league_one_runtime',t.oid,privilege)),
      'publicPrivileges',COALESCE((SELECT jsonb_agg(acl.privilege_type ORDER BY acl.privilege_type)
        FROM aclexplode(COALESCE(t.relacl,acldefault('r',t.relowner))) acl WHERE acl.grantee=0),'[]'::jsonb),
      'columns',columns.n,'columnHash',columns.hash,
      'constraints',constraints.n,'notNullConstraints',constraints.nn,'constraintHash',constraints.hash,
      'indexes',indexes.n,'indexHash',indexes.hash,'policyHash',policies.hash
    ) ORDER BY t.relname) FROM pg_class t JOIN pg_namespace ns ON ns.oid=t.relnamespace
    JOIN pg_roles owner ON owner.oid=t.relowner
    CROSS JOIN LATERAL (SELECT count(*) AS n,md5(COALESCE(string_agg(
      a.attname||chr(31)||format_type(a.atttypid,a.atttypmod)||chr(31)||a.attnotnull::text
      ||chr(31)||COALESCE(a.attacl::text,'')||chr(31)||COALESCE(pg_get_expr(d.adbin,d.adrelid),''),chr(30) ORDER BY a.attnum),'')) AS hash
      FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum
      WHERE a.attrelid=t.oid AND a.attnum>0 AND NOT a.attisdropped) columns
    CROSS JOIN LATERAL (SELECT count(*) AS n,count(*) FILTER(WHERE c.contype='n') AS nn,
      md5(COALESCE(string_agg(c.conname||chr(31)||c.contype::text||chr(31)||c.convalidated::text||chr(31)
      ||pg_get_constraintdef(c.oid,true),chr(30) ORDER BY c.conname),'')) AS hash
      FROM pg_constraint c WHERE c.conrelid=t.oid) constraints
    CROSS JOIN LATERAL (SELECT count(*) AS n,md5(COALESCE(string_agg(i.indexname||chr(31)||i.indexdef,
      chr(30) ORDER BY i.indexname),'')) AS hash FROM pg_indexes i WHERE i.schemaname='public' AND i.tablename=t.relname) indexes
    CROSS JOIN LATERAL (SELECT md5(COALESCE(string_agg(p.polname||chr(31)||p.polcmd::text||chr(31)||p.polpermissive::text
      ||chr(31)||p.polroles::text||chr(31)||COALESCE(pg_get_expr(p.polqual,p.polrelid),'')||chr(31)
      ||COALESCE(pg_get_expr(p.polwithcheck,p.polrelid),''),chr(30) ORDER BY p.polname),'')) AS hash
      FROM pg_policy p WHERE p.polrelid=t.oid) policies
    WHERE ns.nspname='public' AND t.relkind IN ('r','p','v','m','f') AND t.relname =ANY(ARRAY[]::text[])),'[]'::jsonb),
    'constraintTypes',COALESCE((SELECT jsonb_agg(jsonb_build_array(kind,n) ORDER BY kind) FROM (
      SELECT c.contype::text AS kind,count(*) AS n FROM pg_constraint c JOIN pg_class t ON t.oid=c.conrelid
      WHERE t.relnamespace='public'::regnamespace AND t.relname =ANY(ARRAY[]::text[]) GROUP BY c.contype) kinds),'[]'::jsonb),
    'functions',COALESCE((SELECT jsonb_agg(jsonb_build_object('signature',p.proname||'('||replace(oidvectortypes(p.proargtypes),', ',',')||')',
      'definitionHash',md5(pg_get_functiondef(p.oid)),'owner',owner.rolname,'securityDefiner',p.prosecdef,
      'configuration',p.proconfig,'acl',COALESCE(p.proacl::text,''),
      'runtimeExecute',has_function_privilege('league_one_runtime',p.oid,'EXECUTE'),
      'publicExecute',EXISTS(SELECT 1 FROM aclexplode(COALESCE(p.proacl,acldefault('f',p.proowner))) acl
        WHERE acl.grantee=0 AND acl.privilege_type='EXECUTE')) ORDER BY p.proname||'('||replace(oidvectortypes(p.proargtypes),', ',',')||')')
      FROM pg_proc p JOIN pg_roles owner ON owner.oid=p.proowner
      WHERE p.pronamespace='public'::regnamespace AND p.prokind='f' AND p.proname||'('||replace(oidvectortypes(p.proargtypes),', ',',')||')' =ANY(ARRAY['validate_all_player_stat_entry()','finish_all_player_job(jsonb,text,jsonb)']::text[])),'[]'::jsonb),
    'triggers',COALESCE((SELECT jsonb_agg(jsonb_build_object('key',t.relname||'.'||tr.tgname,
      'function',p.proname,'enabled',tr.tgenabled,'definitionHash',md5(pg_get_triggerdef(tr.oid,true))) ORDER BY t.relname,tr.tgname)
      FROM pg_trigger tr JOIN pg_class t ON t.oid=tr.tgrelid JOIN pg_proc p ON p.oid=tr.tgfoid
      WHERE t.relnamespace='public'::regnamespace AND NOT tr.tgisinternal AND (t.relname=ANY(ARRAY[]::text[]) OR (t.relname||'.'||tr.tgname)=ANY(ARRAY[]::text[]))),'[]'::jsonb)

  ) AS catalog) captured;
  IF actual_catalog IS DISTINCT FROM '{"tables":[],"triggers":[],"functions":[{"acl":"{neondb_owner=X/neondb_owner,league_one_runtime=X/neondb_owner}","owner":"neondb_owner","signature":"finish_all_player_job(jsonb,text,jsonb)","configuration":["search_path=pg_catalog, public, pg_temp"],"publicExecute":false,"definitionHash":"09fdfd918445a73e8149fef0d3e7147e","runtimeExecute":true,"securityDefiner":true},{"acl":"{neondb_owner=X/neondb_owner}","owner":"neondb_owner","signature":"validate_all_player_stat_entry()","configuration":["search_path=pg_catalog, public, pg_temp"],"publicExecute":false,"definitionHash":"7398afc4f0cc55902df35d248f95bde5","runtimeExecute":false,"securityDefiner":true}],"constraintTypes":[]}'::jsonb
    THEN RAISE EXCEPTION 'partial_context final catalog, NOT NULL constraints, ownership, or grants mismatch'; END IF;
  SELECT catalog INTO actual_catalog FROM (SELECT jsonb_build_object(
    'tables', COALESCE((SELECT jsonb_agg(jsonb_build_object(
      'name',t.relname,'kind',t.relkind,'owner',owner.rolname,'acl',COALESCE(t.relacl::text,''),
      'rls',t.relrowsecurity,'forceRls',t.relforcerowsecurity,
      'runtimePrivileges',(SELECT jsonb_agg(privilege ORDER BY privilege) FROM unnest(ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) privilege
        WHERE has_table_privilege('league_one_runtime',t.oid,privilege)),
      'publicPrivileges',COALESCE((SELECT jsonb_agg(acl.privilege_type ORDER BY acl.privilege_type)
        FROM aclexplode(COALESCE(t.relacl,acldefault('r',t.relowner))) acl WHERE acl.grantee=0),'[]'::jsonb),
      'columns',columns.n,'columnHash',columns.hash,
      'constraints',constraints.n,'notNullConstraints',constraints.nn,'constraintHash',constraints.hash,
      'indexes',indexes.n,'indexHash',indexes.hash,'policyHash',policies.hash
    ) ORDER BY t.relname) FROM pg_class t JOIN pg_namespace ns ON ns.oid=t.relnamespace
    JOIN pg_roles owner ON owner.oid=t.relowner
    CROSS JOIN LATERAL (SELECT count(*) AS n,md5(COALESCE(string_agg(
      a.attname||chr(31)||format_type(a.atttypid,a.atttypmod)||chr(31)||a.attnotnull::text
      ||chr(31)||COALESCE(a.attacl::text,'')||chr(31)||COALESCE(pg_get_expr(d.adbin,d.adrelid),''),chr(30) ORDER BY a.attnum),'')) AS hash
      FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum
      WHERE a.attrelid=t.oid AND a.attnum>0 AND NOT a.attisdropped) columns
    CROSS JOIN LATERAL (SELECT count(*) AS n,count(*) FILTER(WHERE c.contype='n') AS nn,
      md5(COALESCE(string_agg(c.conname||chr(31)||c.contype::text||chr(31)||c.convalidated::text||chr(31)
      ||pg_get_constraintdef(c.oid,true),chr(30) ORDER BY c.conname),'')) AS hash
      FROM pg_constraint c WHERE c.conrelid=t.oid) constraints
    CROSS JOIN LATERAL (SELECT count(*) AS n,md5(COALESCE(string_agg(i.indexname||chr(31)||i.indexdef,
      chr(30) ORDER BY i.indexname),'')) AS hash FROM pg_indexes i WHERE i.schemaname='public' AND i.tablename=t.relname) indexes
    CROSS JOIN LATERAL (SELECT md5(COALESCE(string_agg(p.polname||chr(31)||p.polcmd::text||chr(31)||p.polpermissive::text
      ||chr(31)||p.polroles::text||chr(31)||COALESCE(pg_get_expr(p.polqual,p.polrelid),'')||chr(31)
      ||COALESCE(pg_get_expr(p.polwithcheck,p.polrelid),''),chr(30) ORDER BY p.polname),'')) AS hash
      FROM pg_policy p WHERE p.polrelid=t.oid) policies
    WHERE ns.nspname='public' AND t.relkind IN ('r','p','v','m','f') AND t.relname <>ALL(ARRAY[]::text[])),'[]'::jsonb),
    'constraintTypes',COALESCE((SELECT jsonb_agg(jsonb_build_array(kind,n) ORDER BY kind) FROM (
      SELECT c.contype::text AS kind,count(*) AS n FROM pg_constraint c JOIN pg_class t ON t.oid=c.conrelid
      WHERE t.relnamespace='public'::regnamespace AND t.relname <>ALL(ARRAY[]::text[]) GROUP BY c.contype) kinds),'[]'::jsonb),
    'functions',COALESCE((SELECT jsonb_agg(jsonb_build_object('signature',p.proname||'('||replace(oidvectortypes(p.proargtypes),', ',',')||')',
      'definitionHash',md5(pg_get_functiondef(p.oid)),'owner',owner.rolname,'securityDefiner',p.prosecdef,
      'configuration',p.proconfig,'acl',COALESCE(p.proacl::text,''),
      'runtimeExecute',has_function_privilege('league_one_runtime',p.oid,'EXECUTE'),
      'publicExecute',EXISTS(SELECT 1 FROM aclexplode(COALESCE(p.proacl,acldefault('f',p.proowner))) acl
        WHERE acl.grantee=0 AND acl.privilege_type='EXECUTE')) ORDER BY p.proname||'('||replace(oidvectortypes(p.proargtypes),', ',',')||')')
      FROM pg_proc p JOIN pg_roles owner ON owner.oid=p.proowner
      WHERE p.pronamespace='public'::regnamespace AND p.prokind='f' AND p.proname||'('||replace(oidvectortypes(p.proargtypes),', ',',')||')' <>ALL(ARRAY['validate_all_player_stat_entry()','finish_all_player_job(jsonb,text,jsonb)']::text[])),'[]'::jsonb),
    'triggers',COALESCE((SELECT jsonb_agg(jsonb_build_object('key',t.relname||'.'||tr.tgname,
      'function',p.proname,'enabled',tr.tgenabled,'definitionHash',md5(pg_get_triggerdef(tr.oid,true))) ORDER BY t.relname,tr.tgname)
      FROM pg_trigger tr JOIN pg_class t ON t.oid=tr.tgrelid JOIN pg_proc p ON p.oid=tr.tgfoid
      WHERE t.relnamespace='public'::regnamespace AND NOT tr.tgisinternal AND (t.relname<>ALL(ARRAY[]::text[]) AND (t.relname||'.'||tr.tgname)<>ALL(ARRAY[]::text[]))),'[]'::jsonb)
    ,
    'schemas',(SELECT md5(COALESCE(string_agg(n.nspname||chr(31)||r.rolname||chr(31)||COALESCE(n.nspacl::text,''),chr(30) ORDER BY n.nspname),''))
      FROM pg_namespace n JOIN pg_roles r ON r.oid=n.nspowner WHERE n.nspname !~ '^pg_(toast_)?temp_'),
    'sequences',(SELECT md5(COALESCE(string_agg(t.relname||chr(31)||r.rolname||chr(31)||COALESCE(t.relacl::text,''),chr(30) ORDER BY t.relname),''))
      FROM pg_class t JOIN pg_roles r ON r.oid=t.relowner WHERE t.relnamespace='public'::regnamespace AND t.relkind='S'),
    'roles',(SELECT md5(COALESCE(string_agg(r.rolname||chr(31)||r.rolsuper::text||chr(31)||r.rolinherit::text||chr(31)
      ||r.rolcreaterole::text||chr(31)||r.rolcreatedb::text||chr(31)||r.rolcanlogin::text||chr(31)||r.rolreplication::text
      ||chr(31)||r.rolbypassrls::text,chr(30) ORDER BY r.rolname),'')) FROM pg_roles r),
    'memberships',(SELECT md5(COALESCE(string_agg(m.rolname||chr(31)||r.rolname||chr(31)||a.admin_option::text
      ||chr(31)||a.inherit_option::text||chr(31)||a.set_option::text,chr(30) ORDER BY m.rolname,r.rolname),''))
      FROM pg_auth_members a JOIN pg_roles m ON m.oid=a.member JOIN pg_roles r ON r.oid=a.roleid),
    'defaultPrivileges',(SELECT md5(COALESCE(string_agg(r.rolname||chr(31)||COALESCE(n.nspname,'')||chr(31)||a.defaclobjtype::text
      ||chr(31)||a.defaclacl::text,chr(30) ORDER BY r.rolname,n.nspname,a.defaclobjtype),''))
      FROM pg_default_acl a JOIN pg_roles r ON r.oid=a.defaclrole LEFT JOIN pg_namespace n ON n.oid=a.defaclnamespace)
  ) AS catalog) captured;
  IF actual_catalog->'constraintTypes' IS DISTINCT FROM '[["c",224],["f",77],["n",417],["p",51],["t",1],["u",39]]'::jsonb
    THEN RAISE EXCEPTION 'release PostgreSQL 180006 constraint manifest mismatch'; END IF;
  IF actual_catalog IS DISTINCT FROM (SELECT catalog FROM partial_context_release_unaffected_before)
    THEN RAISE EXCEPTION 'partial_context release changed unaffected functions, triggers, tables, policies, ACLs, roles, or defaults'; END IF;
  FOR old_count IN SELECT * FROM partial_context_release_history_before LOOP
    EXECUTE format('SELECT count(*)::bigint FROM public.%I',old_count.name) INTO new_count;
    IF new_count IS DISTINCT FROM old_count.rows THEN RAISE EXCEPTION 'partial_context release altered historical row counts for %',old_count.name; END IF;
  END LOOP;
  PERFORM set_config('league_one.partial_context_release_committed','ALL_PLAYER_PARTIAL_CONTEXT_APPLIED:018_all_player_partial_context.sql:d8ceba13b99a862a13de74bfa51f27bd2c0afbc16f93e4e9b67b6f79997390cc',false);
END; $partial_context_after$;
COMMIT;
-- Even a SQL client configured to continue after errors cannot emit success
-- after an aborted invocation: its transactionally committed marker must match.
SELECT 'ALL_PLAYER_PARTIAL_CONTEXT_APPLIED:018_all_player_partial_context.sql:d8ceba13b99a862a13de74bfa51f27bd2c0afbc16f93e4e9b67b6f79997390cc' AS success_sentinel
WHERE current_setting('league_one.partial_context_release_committed',true)='ALL_PLAYER_PARTIAL_CONTEXT_APPLIED:018_all_player_partial_context.sql:d8ceba13b99a862a13de74bfa51f27bd2c0afbc16f93e4e9b67b6f79997390cc'
  AND current_database()='neondb' AND current_user='neondb_owner'
  AND current_setting('server_version_num')::integer=180006
  AND (SELECT jsonb_agg(jsonb_build_array(name,checksum) ORDER BY name) FROM public.app_schema_migrations)='[["001_projection_foundation.sql","eefa3aa224dbc6f0c6bb3edc9e4690425e2d6af7094938f3528059717d205050"],["002_manager_snapshot_payloads.sql","74585dec3e2717eede0579f9281a041a4e3cc0b0cd8378383fe2e3d64fd7214d"],["003_league_period_authority.sql","6f98e09646834cc542a6413e00c0d0c2d84ad4a5ff33905e429aba87c951406e"],["004_durable_projection_slates.sql","8ad48c22dea0d942a0a14027dcb240cda18f1bd728403e41aafa6b76f42f95b9"],["005_future_projection_refresh.sql","02bb6a3c6a183e7074fbea156b5f393d5772619098ab7c07be9dcc5528003c75"],["006_flexed_kickoff_candidate_index.sql","d2c54c4e17439d3773cfab8db8ed68bf332abd1073fe793f62138efa89e1a3b0"],["007_lineup_freshness.sql","1a92f9517294fe289bd25d74923dd042d0cb394d143b5c89d33ed017963c3e47"],["008_additive_write_guards.sql","2447ffac523e1f5536e218887d5c29895c3a095385f89bd6beb55cb7c5e95814"],["009_game_clock_plausibility.sql","86df8afd868bb4fd589a76bf1e1693cdc546037cfc61b54ae972e660fbda056a"],["010_all_player_statistics.sql","f9f2aa0c4dc7a0a3097bf770a7f08ef0719ed7f019307dcf629fa17058af31b4"],["011_all_player_foundation_guards.sql","0eaa96bcc0b65053ac8dab48657eb7bfe22fadbfd41b4f4c78c3472ca8a512b6"],["012_all_player_provider_participation.sql","bea4bd568c05eee7da177811b25a1389180d37329b9061b3e79ee60d546aa4ed"],["013_all_player_participation_assumption.sql","4e03581db2b9a33d0df77110fe32b81745bec7f1ab001a20bfd788c4b4283d80"],["014_all_player_hourly_collection.sql","3aa6e19555c1e38bf7805199d401b0c6acd3ada00716950e04e54573867b1fc3"],["015_all_player_dynasty_publication.sql","f7bf9b74cc14c0ede7a7534257ea956f99edc2615983b5b66ae546f2812fef8a"],["016_portable_league_administration.sql","d662d9e9709153a4e9a6cbc93522bdd4d14c5b0a0c74a7c7ea8648455896596c"],["017_enrolled_all_player_publication.sql","1247dbfbdfbc79f41a448cf3b2e95fb4f9387e951a26f340e9533754e5c9c361"],["018_all_player_partial_context.sql","d8ceba13b99a862a13de74bfa51f27bd2c0afbc16f93e4e9b67b6f79997390cc"]]'::jsonb
  AND (SELECT catalog FROM (SELECT jsonb_build_object(
    'tables', COALESCE((SELECT jsonb_agg(jsonb_build_object(
      'name',t.relname,'kind',t.relkind,'owner',owner.rolname,'acl',COALESCE(t.relacl::text,''),
      'rls',t.relrowsecurity,'forceRls',t.relforcerowsecurity,
      'runtimePrivileges',(SELECT jsonb_agg(privilege ORDER BY privilege) FROM unnest(ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) privilege
        WHERE has_table_privilege('league_one_runtime',t.oid,privilege)),
      'publicPrivileges',COALESCE((SELECT jsonb_agg(acl.privilege_type ORDER BY acl.privilege_type)
        FROM aclexplode(COALESCE(t.relacl,acldefault('r',t.relowner))) acl WHERE acl.grantee=0),'[]'::jsonb),
      'columns',columns.n,'columnHash',columns.hash,
      'constraints',constraints.n,'notNullConstraints',constraints.nn,'constraintHash',constraints.hash,
      'indexes',indexes.n,'indexHash',indexes.hash,'policyHash',policies.hash
    ) ORDER BY t.relname) FROM pg_class t JOIN pg_namespace ns ON ns.oid=t.relnamespace
    JOIN pg_roles owner ON owner.oid=t.relowner
    CROSS JOIN LATERAL (SELECT count(*) AS n,md5(COALESCE(string_agg(
      a.attname||chr(31)||format_type(a.atttypid,a.atttypmod)||chr(31)||a.attnotnull::text
      ||chr(31)||COALESCE(a.attacl::text,'')||chr(31)||COALESCE(pg_get_expr(d.adbin,d.adrelid),''),chr(30) ORDER BY a.attnum),'')) AS hash
      FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum
      WHERE a.attrelid=t.oid AND a.attnum>0 AND NOT a.attisdropped) columns
    CROSS JOIN LATERAL (SELECT count(*) AS n,count(*) FILTER(WHERE c.contype='n') AS nn,
      md5(COALESCE(string_agg(c.conname||chr(31)||c.contype::text||chr(31)||c.convalidated::text||chr(31)
      ||pg_get_constraintdef(c.oid,true),chr(30) ORDER BY c.conname),'')) AS hash
      FROM pg_constraint c WHERE c.conrelid=t.oid) constraints
    CROSS JOIN LATERAL (SELECT count(*) AS n,md5(COALESCE(string_agg(i.indexname||chr(31)||i.indexdef,
      chr(30) ORDER BY i.indexname),'')) AS hash FROM pg_indexes i WHERE i.schemaname='public' AND i.tablename=t.relname) indexes
    CROSS JOIN LATERAL (SELECT md5(COALESCE(string_agg(p.polname||chr(31)||p.polcmd::text||chr(31)||p.polpermissive::text
      ||chr(31)||p.polroles::text||chr(31)||COALESCE(pg_get_expr(p.polqual,p.polrelid),'')||chr(31)
      ||COALESCE(pg_get_expr(p.polwithcheck,p.polrelid),''),chr(30) ORDER BY p.polname),'')) AS hash
      FROM pg_policy p WHERE p.polrelid=t.oid) policies
    WHERE ns.nspname='public' AND t.relkind IN ('r','p','v','m','f') AND t.relname =ANY(ARRAY[]::text[])),'[]'::jsonb),
    'constraintTypes',COALESCE((SELECT jsonb_agg(jsonb_build_array(kind,n) ORDER BY kind) FROM (
      SELECT c.contype::text AS kind,count(*) AS n FROM pg_constraint c JOIN pg_class t ON t.oid=c.conrelid
      WHERE t.relnamespace='public'::regnamespace AND t.relname =ANY(ARRAY[]::text[]) GROUP BY c.contype) kinds),'[]'::jsonb),
    'functions',COALESCE((SELECT jsonb_agg(jsonb_build_object('signature',p.proname||'('||replace(oidvectortypes(p.proargtypes),', ',',')||')',
      'definitionHash',md5(pg_get_functiondef(p.oid)),'owner',owner.rolname,'securityDefiner',p.prosecdef,
      'configuration',p.proconfig,'acl',COALESCE(p.proacl::text,''),
      'runtimeExecute',has_function_privilege('league_one_runtime',p.oid,'EXECUTE'),
      'publicExecute',EXISTS(SELECT 1 FROM aclexplode(COALESCE(p.proacl,acldefault('f',p.proowner))) acl
        WHERE acl.grantee=0 AND acl.privilege_type='EXECUTE')) ORDER BY p.proname||'('||replace(oidvectortypes(p.proargtypes),', ',',')||')')
      FROM pg_proc p JOIN pg_roles owner ON owner.oid=p.proowner
      WHERE p.pronamespace='public'::regnamespace AND p.prokind='f' AND p.proname||'('||replace(oidvectortypes(p.proargtypes),', ',',')||')' =ANY(ARRAY['validate_all_player_stat_entry()','finish_all_player_job(jsonb,text,jsonb)']::text[])),'[]'::jsonb),
    'triggers',COALESCE((SELECT jsonb_agg(jsonb_build_object('key',t.relname||'.'||tr.tgname,
      'function',p.proname,'enabled',tr.tgenabled,'definitionHash',md5(pg_get_triggerdef(tr.oid,true))) ORDER BY t.relname,tr.tgname)
      FROM pg_trigger tr JOIN pg_class t ON t.oid=tr.tgrelid JOIN pg_proc p ON p.oid=tr.tgfoid
      WHERE t.relnamespace='public'::regnamespace AND NOT tr.tgisinternal AND (t.relname=ANY(ARRAY[]::text[]) OR (t.relname||'.'||tr.tgname)=ANY(ARRAY[]::text[]))),'[]'::jsonb)

  ) AS catalog) committed)='{"tables":[],"triggers":[],"functions":[{"acl":"{neondb_owner=X/neondb_owner,league_one_runtime=X/neondb_owner}","owner":"neondb_owner","signature":"finish_all_player_job(jsonb,text,jsonb)","configuration":["search_path=pg_catalog, public, pg_temp"],"publicExecute":false,"definitionHash":"09fdfd918445a73e8149fef0d3e7147e","runtimeExecute":true,"securityDefiner":true},{"acl":"{neondb_owner=X/neondb_owner}","owner":"neondb_owner","signature":"validate_all_player_stat_entry()","configuration":["search_path=pg_catalog, public, pg_temp"],"publicExecute":false,"definitionHash":"7398afc4f0cc55902df35d248f95bde5","runtimeExecute":false,"securityDefiner":true}],"constraintTypes":[]}'::jsonb;
