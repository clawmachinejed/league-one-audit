-- Owner-only, after migration 020. Never use the worker or owner credential for
-- private account requests. Create the role through SQL, not Neon's role API.
-- No password is included: assign a secret outside this file and rerun these
-- fail-closed checks after any control-plane password/role operation.
BEGIN;
DO $$ BEGIN
  IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='league_one_account') THEN
    CREATE ROLE league_one_account LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE
      NOREPLICATION NOINHERIT NOBYPASSRLS;
  END IF;
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='league_one_account'
    AND (NOT rolcanlogin OR rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolinherit OR rolbypassrls))
    OR EXISTS(SELECT 1 FROM pg_auth_members WHERE member='league_one_account'::regrole) THEN
    RAISE EXCEPTION 'league_one_account must be an unprivileged standalone LOGIN role';
  END IF;
  IF EXISTS(SELECT 1 FROM pg_class WHERE relowner='league_one_account'::regrole)
    OR EXISTS(SELECT 1 FROM pg_proc WHERE proowner='league_one_account'::regrole)
    OR EXISTS(SELECT 1 FROM pg_namespace WHERE nspowner='league_one_account'::regrole) THEN
    RAISE EXCEPTION 'league_one_account must not own database objects';
  END IF;
  EXECUTE format('GRANT CONNECT ON DATABASE %I TO league_one_account',current_database());
END; $$;

REVOKE CREATE ON SCHEMA public FROM league_one_account;
GRANT USAGE ON SCHEMA public TO league_one_account;
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM league_one_account;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM league_one_account;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM league_one_account;
-- Table-level REVOKE does not remove old column-level ACLs. Reset those too.
DO $$ DECLARE relation record; BEGIN
  FOR relation IN SELECT c.relname,string_agg(quote_ident(a.attname),',' ORDER BY a.attnum) AS columns
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace JOIN pg_attribute a ON a.attrelid=c.oid
    WHERE n.nspname='public' AND c.relkind IN ('r','p','v','m','f') AND a.attnum>0 AND NOT a.attisdropped
    GROUP BY c.relname LOOP
    EXECUTE format('REVOKE SELECT (%s),INSERT (%s),UPDATE (%s),REFERENCES (%s) ON TABLE public.%I FROM league_one_account',
      relation.columns,relation.columns,relation.columns,relation.columns,relation.relname);
  END LOOP;
END; $$;

GRANT SELECT ON public.app_users,public.app_login_identities,public.app_provider_account_links,
  public.app_user_leagues,public.app_league_groups,public.app_league_group_memberships TO league_one_account;
GRANT UPDATE (display_name,platform_handle) ON public.app_users TO league_one_account;
GRANT INSERT (app_user_id,source_manager_account_id) ON public.app_provider_account_links TO league_one_account;
GRANT UPDATE (revoked_at) ON public.app_provider_account_links TO league_one_account;
GRANT INSERT (app_user_id,league_id,favorite,sort_position,preferred_season_team_id) ON public.app_user_leagues TO league_one_account;
GRANT UPDATE (favorite,sort_position,preferred_season_team_id) ON public.app_user_leagues TO league_one_account;
GRANT DELETE ON public.app_user_leagues TO league_one_account;
GRANT EXECUTE ON FUNCTION public.current_app_actor(),public.resolve_app_login_identity(text,text,text,uuid) TO league_one_account;

-- Read only the accepted-source lineage needed for personal participation and
-- display. No raw roster/content payload, normalized writer input or diagnostics.
GRANT SELECT (id,league_key,name) ON public.leagues TO league_one_account;
GRANT SELECT (id,league_id,season) ON public.league_seasons TO league_one_account;
GRANT SELECT (league_season_id,provider,external_league_id) ON public.league_source_connections TO league_one_account;
GRANT SELECT (league_id,provider,active) ON public.league_administration_enrollments TO league_one_account;
GRANT SELECT (league_id,provider,season) ON public.league_administration_enrollment_seasons TO league_one_account;
GRANT SELECT (id,provider,external_manager_id) ON public.league_source_manager_accounts TO league_one_account;
GRANT SELECT (id,league_season_id,provider,external_league_id,external_roster_id) ON public.league_season_teams TO league_one_account;
GRANT SELECT (content_id,league_season_id,team_id,manager_id,role) ON public.league_administration_memberships TO league_one_account;
GRANT SELECT (league_season_id,family,week,accepted_observation_id,generation,checked_at,verified_at,read_conflict)
  ON public.league_administration_heads TO league_one_account;
GRANT SELECT (id,content_id,league_season_id,family,week,outcome,source_observed_at) ON public.league_administration_observations TO league_one_account;
GRANT SELECT (id,league_season_id,provider,external_league_id,family,week,completeness,normalizer_version,accepted)
  ON public.league_administration_contents TO league_one_account;
GRANT SELECT (content_id,league_season_id,team_id) ON public.league_administration_team_entries TO league_one_account;
GRANT SELECT (content_id,manager_id,source_value) ON public.league_administration_manager_entries TO league_one_account;

DO $$ DECLARE object record; BEGIN
  IF has_database_privilege('league_one_account',current_database(),'CREATE')
    OR EXISTS(SELECT 1 FROM pg_namespace WHERE nspname NOT LIKE 'pg_temp_%' AND nspname NOT LIKE 'pg_toast_temp_%'
      AND has_schema_privilege('league_one_account',oid,'CREATE')) THEN
    RAISE EXCEPTION 'league_one_account can create database objects'; END IF;
  FOR object IN SELECT c.oid,c.relname,c.relrowsecurity FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relkind IN ('r','p') LOOP
    IF object.relname LIKE 'app\_%' ESCAPE '\' AND object.relname<>'app_schema_migrations' THEN
      IF NOT object.relrowsecurity THEN RAISE EXCEPTION 'account table lacks RLS: %',object.relname; END IF;
      IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='league_one_runtime') THEN
        IF has_any_column_privilege('league_one_runtime',object.oid,'SELECT,INSERT,UPDATE,REFERENCES')
          OR has_table_privilege('league_one_runtime',object.oid,'DELETE,TRUNCATE,TRIGGER') THEN
          RAISE EXCEPTION 'worker has private account privileges: %',object.relname; END IF;
      END IF;
    ELSIF has_any_column_privilege('league_one_account',object.oid,'INSERT,UPDATE,REFERENCES')
      OR has_table_privilege('league_one_account',object.oid,'DELETE,TRUNCATE,TRIGGER') THEN
      RAISE EXCEPTION 'account role can mutate shared data: %',object.relname;
    END IF;
  END LOOP;
  IF has_any_column_privilege('league_one_account','public.app_schema_migrations','SELECT')
    OR has_any_column_privilege('league_one_account','public.app_identity_audit_events','SELECT,INSERT,UPDATE,REFERENCES')
    OR has_table_privilege('league_one_account','public.app_identity_audit_events','DELETE,TRUNCATE,TRIGGER')
    OR has_column_privilege('league_one_account','public.app_users','status','UPDATE')
    OR has_column_privilege('league_one_account','public.app_provider_account_links','assurance','INSERT,UPDATE')
    OR has_any_column_privilege('league_one_account','public.app_login_identities','INSERT,UPDATE')
    OR has_any_column_privilege('league_one_account','public.app_league_groups','INSERT,UPDATE')
    OR has_any_column_privilege('league_one_account','public.app_league_group_memberships','INSERT,UPDATE') THEN
    RAISE EXCEPTION 'account role has excessive private privileges'; END IF;
  -- PUBLIC execution grants on an old SECURITY DEFINER writer would defeat table
  -- ACLs. Refuse the composition instead of silently exposing any such writer.
  FOR object IN SELECT p.oid,p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.prosecdef AND p.oid NOT IN
      ('public.current_app_actor()'::regprocedure,'public.resolve_app_login_identity(text,text,text,uuid)'::regprocedure) LOOP
    IF has_function_privilege('league_one_account',object.oid,'EXECUTE') THEN
      RAISE EXCEPTION 'account role can execute another privileged function: %',object.proname; END IF;
  END LOOP;
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='league_one_runtime') THEN
    IF pg_has_role('league_one_runtime','league_one_account','MEMBER')
      OR has_function_privilege('league_one_runtime','public.current_app_actor()','EXECUTE')
      OR has_function_privilege('league_one_runtime','public.resolve_app_login_identity(text,text,text,uuid)','EXECUTE') THEN
      RAISE EXCEPTION 'worker can assume the account role or execute private identity functions'; END IF;
  END IF;
END; $$;

-- Auth credentials remain a separate runtime boundary even when this script is
-- rerun after the maintained auth role/schema has been installed.
DO $$ DECLARE object record; denied_table_privileges text := 'DELETE,TRUNCATE,TRIGGER'; BEGIN
  IF current_setting('server_version_num')::integer >= 170000 THEN
    denied_table_privileges := denied_table_privileges||',MAINTAIN';
  END IF;
  IF to_regnamespace('website_auth') IS NOT NULL THEN
    IF has_schema_privilege('league_one_account','website_auth','USAGE,CREATE') THEN
      RAISE EXCEPTION 'account role can access the auth schema'; END IF;
    FOR object IN SELECT c.oid,c.relkind FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='website_auth' AND c.relkind IN ('r','p','v','m','f','S') LOOP
      IF (CASE WHEN object.relkind='S' THEN has_sequence_privilege('league_one_account',object.oid,'SELECT,UPDATE,USAGE')
        ELSE has_any_column_privilege('league_one_account',object.oid,'SELECT,INSERT,UPDATE,REFERENCES')
          OR has_table_privilege('league_one_account',object.oid,denied_table_privileges) END) THEN
        RAISE EXCEPTION 'account role has auth object privileges'; END IF;
    END LOOP;
  END IF;
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='league_one_auth') THEN
    IF pg_has_role('league_one_account','league_one_auth','MEMBER') THEN
      RAISE EXCEPTION 'account role can assume the auth role'; END IF;
  END IF;
END; $$;
COMMIT;
