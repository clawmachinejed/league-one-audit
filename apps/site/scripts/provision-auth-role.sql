-- Owner-only, after migration 021. This role serves only maintained Better Auth.
-- Assign its password outside source control; never deploy the schema owner.
BEGIN;
DO $$ BEGIN
  IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='league_one_auth') THEN
    CREATE ROLE league_one_auth LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE
      NOREPLICATION NOINHERIT NOBYPASSRLS;
  END IF;
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='league_one_auth'
    AND (NOT rolcanlogin OR rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolinherit OR rolbypassrls))
    OR EXISTS(SELECT 1 FROM pg_auth_members WHERE member='league_one_auth'::regrole) THEN
    RAISE EXCEPTION 'league_one_auth must be an unprivileged standalone LOGIN role';
  END IF;
  IF EXISTS(SELECT 1 FROM pg_class WHERE relowner='league_one_auth'::regrole)
    OR EXISTS(SELECT 1 FROM pg_proc WHERE proowner='league_one_auth'::regrole)
    OR EXISTS(SELECT 1 FROM pg_namespace WHERE nspowner='league_one_auth'::regrole)
    OR EXISTS(SELECT 1 FROM pg_database WHERE datdba='league_one_auth'::regrole) THEN
    RAISE EXCEPTION 'league_one_auth must not own database objects';
  END IF;
  IF to_regnamespace('website_auth') IS NULL THEN
    RAISE EXCEPTION 'migration 021 must be applied before auth role provisioning';
  END IF;
  EXECUTE format('GRANT CONNECT ON DATABASE %I TO league_one_auth',current_database());
END; $$;

REVOKE ALL ON SCHEMA website_auth FROM PUBLIC;
REVOKE ALL ON ALL TABLES IN SCHEMA website_auth FROM PUBLIC;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA website_auth FROM PUBLIC;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA website_auth FROM PUBLIC;
REVOKE ALL ON SCHEMA website_auth,public FROM league_one_auth;
REVOKE ALL ON ALL TABLES IN SCHEMA website_auth,public FROM league_one_auth;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA website_auth,public FROM league_one_auth;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA website_auth,public FROM league_one_auth;

-- Clear column ACLs as well as table ACLs. Ordinary table REVOKE leaves column
-- grants intact. Remove the inverse app/worker grants before testing isolation.
DO $$ DECLARE relation record; role_name text; BEGIN
  FOR relation IN SELECT n.nspname,c.relname,
      string_agg(quote_ident(a.attname),',' ORDER BY a.attnum) AS columns
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace JOIN pg_attribute a ON a.attrelid=c.oid
    WHERE n.nspname IN ('public','website_auth') AND c.relkind IN ('r','p','v','m','f')
      AND a.attnum>0 AND NOT a.attisdropped GROUP BY n.nspname,c.relname LOOP
    EXECUTE format('REVOKE SELECT (%s),INSERT (%s),UPDATE (%s),REFERENCES (%s) ON TABLE %I.%I FROM league_one_auth',
      relation.columns,relation.columns,relation.columns,relation.columns,relation.nspname,relation.relname);
    IF relation.nspname='website_auth' THEN
      EXECUTE format('REVOKE SELECT (%s),INSERT (%s),UPDATE (%s),REFERENCES (%s) ON TABLE website_auth.%I FROM PUBLIC',
        relation.columns,relation.columns,relation.columns,relation.columns,relation.relname);
      FOREACH role_name IN ARRAY ARRAY['league_one_account','league_one_runtime'] LOOP
        IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=role_name) THEN
          EXECUTE format('REVOKE SELECT (%s),INSERT (%s),UPDATE (%s),REFERENCES (%s) ON TABLE website_auth.%I FROM %I',
            relation.columns,relation.columns,relation.columns,relation.columns,relation.relname,role_name);
        END IF;
      END LOOP;
    END IF;
  END LOOP;
  FOREACH role_name IN ARRAY ARRAY['league_one_account','league_one_runtime'] LOOP
    IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=role_name) THEN
      EXECUTE format('REVOKE ALL ON SCHEMA website_auth FROM %I',role_name);
      EXECUTE format('REVOKE ALL ON ALL TABLES IN SCHEMA website_auth FROM %I',role_name);
      EXECUTE format('REVOKE ALL ON ALL SEQUENCES IN SCHEMA website_auth FROM %I',role_name);
      EXECUTE format('REVOKE ALL ON ALL FUNCTIONS IN SCHEMA website_auth FROM %I',role_name);
    END IF;
  END LOOP;
END; $$;

GRANT USAGE ON SCHEMA website_auth TO league_one_auth;
GRANT SELECT,INSERT,UPDATE,DELETE ON website_auth."user",website_auth.session,
  website_auth.account,website_auth.verification,website_auth."rateLimit" TO league_one_auth;

DO $$ DECLARE object record; role_name text;
  denied_table_privileges text := 'DELETE,TRUNCATE,TRIGGER';
  denied_auth_privileges text := 'TRUNCATE,REFERENCES,TRIGGER';
BEGIN
  IF current_setting('server_version_num')::integer >= 170000 THEN
    denied_table_privileges := denied_table_privileges||',MAINTAIN';
    denied_auth_privileges := denied_auth_privileges||',MAINTAIN';
  END IF;
  -- A direct REVOKE cannot override PUBLIC's inherited schema USAGE. Refuse
  -- that preexisting grant rather than changing unrelated public schema ACLs.
  IF has_schema_privilege('league_one_auth','public','USAGE') THEN
    RAISE EXCEPTION 'auth role inherits access to the public schema';
  END IF;
  IF has_database_privilege('league_one_auth',current_database(),'CREATE')
    OR EXISTS(SELECT 1 FROM pg_namespace WHERE nspname NOT LIKE 'pg_temp_%' AND nspname NOT LIKE 'pg_toast_temp_%'
      AND has_schema_privilege('league_one_auth',oid,'CREATE')) THEN
    RAISE EXCEPTION 'league_one_auth can create permanent database objects';
  END IF;
  IF (SELECT array_agg(c.relname::text ORDER BY c.relname) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='website_auth' AND c.relkind IN ('r','p'))
    IS DISTINCT FROM ARRAY['account','rateLimit','session','user','verification']::text[] THEN
    RAISE EXCEPTION 'unexpected website_auth table manifest';
  END IF;
  FOR object IN SELECT c.oid,n.nspname,c.relname,c.relkind FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname NOT LIKE 'pg_%' AND n.nspname<>'information_schema' AND c.relkind IN ('r','p','v','m','f','S') LOOP
    IF object.relkind='S' THEN
      IF has_sequence_privilege('league_one_auth',object.oid,'SELECT,UPDATE,USAGE') THEN
        RAISE EXCEPTION 'auth role has unexpected sequence access';
      END IF;
    ELSIF object.nspname='website_auth' AND object.relname=ANY(ARRAY['user','session','account','verification','rateLimit']) THEN
      IF NOT has_table_privilege('league_one_auth',object.oid,'SELECT')
        OR NOT has_table_privilege('league_one_auth',object.oid,'INSERT')
        OR NOT has_table_privilege('league_one_auth',object.oid,'UPDATE')
        OR NOT has_table_privilege('league_one_auth',object.oid,'DELETE')
        OR has_table_privilege('league_one_auth',object.oid,denied_auth_privileges) THEN
        RAISE EXCEPTION 'auth role has incorrect auth table privileges';
      END IF;
    ELSIF has_any_column_privilege('league_one_auth',object.oid,'SELECT,INSERT,UPDATE,REFERENCES')
      OR has_table_privilege('league_one_auth',object.oid,denied_table_privileges) THEN
      RAISE EXCEPTION 'auth role has access outside auth tables';
    END IF;
    IF object.nspname='website_auth' THEN
      FOREACH role_name IN ARRAY ARRAY['league_one_account','league_one_runtime'] LOOP
        IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=role_name) THEN
          IF CASE WHEN object.relkind='S' THEN has_sequence_privilege(role_name,object.oid,'SELECT,UPDATE,USAGE')
            ELSE has_any_column_privilege(role_name,object.oid,'SELECT,INSERT,UPDATE,REFERENCES')
              OR has_table_privilege(role_name,object.oid,denied_table_privileges) END THEN
            RAISE EXCEPTION 'account or worker role has auth object access';
          END IF;
        END IF;
      END LOOP;
    END IF;
  END LOOP;
  FOR object IN SELECT p.oid FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname NOT LIKE 'pg_%' AND n.nspname<>'information_schema' AND p.prosecdef LOOP
    IF has_function_privilege('league_one_auth',object.oid,'EXECUTE') THEN
      RAISE EXCEPTION 'auth role can execute a privileged application function';
    END IF;
  END LOOP;
  FOREACH role_name IN ARRAY ARRAY['league_one_account','league_one_runtime'] LOOP
    IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=role_name) THEN
      IF pg_has_role(role_name,'league_one_auth','MEMBER')
        OR has_schema_privilege(role_name,'website_auth','USAGE,CREATE') THEN
        RAISE EXCEPTION 'account or worker role can assume auth role or access auth schema';
      END IF;
    END IF;
  END LOOP;
END; $$;
COMMIT;
