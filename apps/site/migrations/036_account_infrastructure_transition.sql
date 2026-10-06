-- Coordinated private-account cutover only. No epoch/configuration is seeded.
-- 034/035 and their mandatory authority guards remain unchanged.
-- Neon upstream pgxn/neon/libpagestore.c defines these identity GUCs as
-- PGC_POSTMASTER. Missing/older/mutable settings fail closed, never use a URL.
-- Source verified 2026-10-06, neondatabase/neon commit
-- 1dce2a9e746edf7b93ce1048ebf63bf5c1395c18 (not deployed-runtime evidence).
CREATE FUNCTION website_auth.account_server_identity_v1() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,website_auth,pg_temp AS $$
DECLARE project text; branch text; tenant text; timeline text; db_oid text;
BEGIN
  IF (SELECT count(*) FROM pg_settings WHERE name IN
    ('neon.project_id','neon.branch_id','neon.tenant_id','neon.timeline_id')
    AND context='postmaster' AND setting<>'' AND NOT pending_restart)<>4 THEN
    RAISE EXCEPTION USING ERRCODE='P4101',MESSAGE='account infrastructure unavailable';
  END IF;
  project:=current_setting('neon.project_id'); branch:=current_setting('neon.branch_id');
  tenant:=current_setting('neon.tenant_id'); timeline:=current_setting('neon.timeline_id');
  SELECT oid::text INTO db_oid FROM pg_database WHERE datname=current_database();
  IF project !~ '^[a-z0-9]+(-[a-z0-9]+)+$' OR branch !~ '^br-[a-z0-9-]+$'
    OR tenant !~ '^[a-f0-9]{32}$' OR timeline !~ '^[a-f0-9]{32}$' OR db_oid IS NULL THEN
    RAISE EXCEPTION USING ERRCODE='P4101',MESSAGE='account infrastructure unavailable';
  END IF;
  RETURN jsonb_build_object('projectId',project,'branchId',branch,'tenantId',tenant,
    'timelineId',timeline,'databaseName',current_database(),'databaseOid',db_oid,
    'clockDomain','neon:'||tenant||':'||timeline||':'||db_oid);
END; $$;
REVOKE ALL ON FUNCTION website_auth.account_server_identity_v1() FROM PUBLIC;

CREATE FUNCTION website_auth.require_restricted_infrastructure_v1(p_expected jsonb,p_role text) RETURNS void
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,website_auth,pg_temp AS $$
BEGIN
  IF p_role NOT IN ('league_one_auth','league_one_account') OR session_user<>p_role
    OR current_setting('role') NOT IN ('none',session_user)
    OR NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname=session_user AND rolcanlogin
      AND NOT (rolsuper OR rolbypassrls OR rolcreatedb OR rolcreaterole OR rolreplication OR rolinherit))
    OR EXISTS(SELECT 1 FROM pg_auth_members WHERE member=session_user::regrole)
    OR EXISTS(SELECT 1 FROM pg_class WHERE relowner=session_user::regrole)
    OR EXISTS(SELECT 1 FROM pg_proc WHERE proowner=session_user::regrole)
    OR EXISTS(SELECT 1 FROM pg_namespace WHERE nspowner=session_user::regrole)
    OR EXISTS(SELECT 1 FROM pg_database WHERE datdba=session_user::regrole)
    OR has_database_privilege(session_user,current_database(),'CREATE')
    OR EXISTS(SELECT 1 FROM pg_namespace WHERE nspname NOT LIKE 'pg_temp_%' AND nspname NOT LIKE 'pg_toast_temp_%'
      AND has_schema_privilege(session_user,oid,'CREATE'))
    OR (p_role='league_one_account' AND has_schema_privilege(session_user,'website_auth','USAGE,CREATE'))
    OR (p_role='league_one_auth' AND has_schema_privilege(session_user,'public','USAGE,CREATE'))
    OR p_expected IS DISTINCT FROM website_auth.account_server_identity_v1() THEN
    RAISE EXCEPTION USING ERRCODE='P4101',MESSAGE='account infrastructure unavailable';
  END IF;
END; $$;
REVOKE ALL ON FUNCTION website_auth.require_restricted_infrastructure_v1(jsonb,text) FROM PUBLIC;

CREATE FUNCTION website_auth.require_auth_infrastructure_v1(p_expected jsonb) RETURNS void
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,website_auth,pg_temp AS $$
  SELECT website_auth.require_restricted_infrastructure_v1(p_expected,'league_one_auth');
$$;
CREATE FUNCTION public.require_account_infrastructure_v1(p_expected jsonb) RETURNS void
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,website_auth,pg_temp AS $$
  SELECT website_auth.require_restricted_infrastructure_v1(p_expected,'league_one_account');
$$;
REVOKE ALL ON FUNCTION website_auth.require_auth_infrastructure_v1(jsonb),public.require_account_infrastructure_v1(jsonb) FROM PUBLIC;

-- Epoch receipt contains no session/user/token material. Exact request ID and
-- immutable revision record reconcile unknown acknowledgement; never retry an
-- activation blindly or decrement/reuse an epoch.
CREATE TABLE website_auth.admission_epoch_activations (
  revision bigint PRIMARY KEY CHECK(revision>0),
  previous_revision bigint NOT NULL CHECK(previous_revision>=0 AND previous_revision<revision),
  request_id uuid NOT NULL UNIQUE,
  config_hash text NOT NULL CHECK(config_hash ~ '^[a-f0-9]{64}$'),
  issuer text NOT NULL CHECK(btrim(issuer)<>''),
  infrastructure jsonb NOT NULL CHECK(jsonb_typeof(infrastructure)='object'),
  release_evidence_hash text NOT NULL CHECK(release_evidence_hash ~ '^[a-f0-9]{64}$'),
  activated_by name NOT NULL,
  activated_at timestamptz NOT NULL CHECK(isfinite(activated_at))
);
REVOKE ALL ON TABLE website_auth.admission_epoch_activations FROM PUBLIC;

CREATE FUNCTION website_auth.reject_epoch_history_mutation_v1() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,pg_temp AS $$
BEGIN
  RAISE EXCEPTION USING ERRCODE='P4101',MESSAGE='account epoch activation history is immutable';
END; $$;
REVOKE ALL ON FUNCTION website_auth.reject_epoch_history_mutation_v1() FROM PUBLIC;
CREATE TRIGGER epoch_history_immutable_v1 BEFORE UPDATE OR DELETE OR TRUNCATE
ON website_auth.admission_epoch_activations FOR EACH STATEMENT
EXECUTE FUNCTION website_auth.reject_epoch_history_mutation_v1();

CREATE FUNCTION website_auth.activate_admission_epoch_v1(p_previous bigint,p_next bigint,p_config_hash text,
  p_issuer text,p_identity jsonb,p_request_id uuid,p_release_evidence_hash text) RETURNS bigint
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,website_auth,public,pg_temp AS $$
DECLARE owner_oid oid; actual_revision bigint; sampled_at timestamptz; role_name text;
BEGIN
  SELECT proowner INTO owner_oid FROM pg_proc WHERE oid=
    'website_auth.activate_admission_epoch_v1(bigint,bigint,text,text,jsonb,uuid,text)'::regprocedure;
  IF session_user::regrole::oid IS DISTINCT FROM owner_oid OR current_setting('role') NOT IN ('none',session_user)
    OR owner_oid IS DISTINCT FROM (SELECT nspowner FROM pg_namespace WHERE nspname='website_auth')
    OR owner_oid IS DISTINCT FROM (SELECT relowner FROM pg_class WHERE oid='website_auth.admission_epoch'::regclass)
    OR owner_oid IS DISTINCT FROM (SELECT relowner FROM pg_class WHERE oid='website_auth.admission_epoch_activations'::regclass)
    OR p_previous IS NULL OR p_previous<0 OR p_next IS NULL OR p_next<=p_previous
    OR p_config_hash IS NULL OR p_config_hash !~ '^[a-f0-9]{64}$' OR p_issuer IS NULL OR btrim(p_issuer)=''
    OR p_request_id IS NULL OR p_release_evidence_hash IS NULL OR p_release_evidence_hash !~ '^[a-f0-9]{64}$'
    OR p_identity IS DISTINCT FROM website_auth.account_server_identity_v1() THEN
    RAISE EXCEPTION USING ERRCODE='P4101',MESSAGE='account epoch activation unavailable';
  END IF;
  -- Exclusive auth gate precedes every epoch row lock, matching all auth writers.
  PERFORM pg_advisory_xact_lock(19740517,1);
  SELECT revision INTO actual_revision FROM website_auth.admission_epoch WHERE slot=1 FOR UPDATE;
  IF coalesce(actual_revision,0)<>p_previous
    OR EXISTS(SELECT 1 FROM website_auth.admission_epoch_activations WHERE revision>coalesce(actual_revision,0)
      OR revision>=p_next OR request_id=p_request_id) THEN
    RAISE EXCEPTION USING ERRCODE='P4090',MESSAGE='account epoch revision changed';
  END IF;
  FOREACH role_name IN ARRAY ARRAY['league_one_auth','league_one_account'] LOOP
    IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname=role_name AND rolcanlogin
      AND NOT (rolsuper OR rolbypassrls OR rolcreatedb OR rolcreaterole OR rolreplication OR rolinherit))
      OR EXISTS(SELECT 1 FROM pg_auth_members WHERE member=role_name::regrole)
      OR EXISTS(SELECT 1 FROM pg_class WHERE relowner=role_name::regrole)
      OR EXISTS(SELECT 1 FROM pg_proc WHERE proowner=role_name::regrole)
      OR EXISTS(SELECT 1 FROM pg_namespace WHERE nspowner=role_name::regrole)
      OR EXISTS(SELECT 1 FROM pg_database WHERE datdba=role_name::regrole)
      OR has_database_privilege(role_name,current_database(),'CREATE')
      OR EXISTS(SELECT 1 FROM pg_namespace WHERE nspname NOT LIKE 'pg_temp_%' AND nspname NOT LIKE 'pg_toast_temp_%'
        AND has_schema_privilege(role_name,oid,'CREATE'))
      OR has_table_privilege(role_name,'website_auth.admission_epoch','INSERT,UPDATE,DELETE,TRUNCATE')
      OR has_table_privilege(role_name,'website_auth.admission_epoch_activations','INSERT,UPDATE,DELETE,TRUNCATE') THEN
      RAISE EXCEPTION USING ERRCODE='P4101',MESSAGE='account epoch privilege manifest unavailable';
    END IF;
  END LOOP;
  sampled_at:=clock_timestamp();
  INSERT INTO website_auth.admission_epoch(slot,revision,config_hash,issuer,clock_domain,activated_at)
    VALUES(1,p_next,p_config_hash,p_issuer,p_identity->>'clockDomain',sampled_at)
    ON CONFLICT(slot) DO UPDATE SET revision=excluded.revision,config_hash=excluded.config_hash,
      issuer=excluded.issuer,clock_domain=excluded.clock_domain,activated_at=excluded.activated_at;
  INSERT INTO website_auth.admission_epoch_activations VALUES(p_next,p_previous,p_request_id,p_config_hash,
    p_issuer,p_identity,p_release_evidence_hash,session_user,sampled_at);
  RETURN p_next;
END; $$;
REVOKE ALL ON FUNCTION website_auth.activate_admission_epoch_v1(bigint,bigint,text,text,jsonb,uuid,text) FROM PUBLIC;

-- A slow provider request may not overwrite an intervening account edit. This
-- check shares the committing mutation's actor lock; failure rolls it all back.
CREATE FUNCTION public.require_account_revision_v2(p_profile_revision bigint,p_links jsonb) RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,public,website_auth,pg_temp AS $$
DECLARE actual_links jsonb; actual_revision bigint; receipt jsonb;
BEGIN
  receipt:=nullif(current_setting('app.session_receipt_v2',true),'')::jsonb;
  PERFORM public.lock_account_actor_authority_v2(receipt,true);
  SELECT revision INTO actual_revision FROM public.app_users WHERE id=public.current_app_actor();
  SELECT coalesce(jsonb_agg(jsonb_build_object('id',id::text,'revision',revision,
    'sourceManagerAccountId',source_manager_account_id::text) ORDER BY id::text),'[]'::jsonb)
    INTO actual_links FROM public.app_provider_account_links
    WHERE app_user_id=public.current_app_actor() AND revoked_at IS NULL;
  IF p_profile_revision IS DISTINCT FROM actual_revision OR p_links IS DISTINCT FROM actual_links THEN
    RAISE EXCEPTION USING ERRCODE='P4090',MESSAGE='account state changed';
  END IF;
END; $$;
REVOKE ALL ON FUNCTION public.require_account_revision_v2(bigint,jsonb) FROM PUBLIC;

DO $$ DECLARE role_name text; BEGIN
  FOREACH role_name IN ARRAY ARRAY['league_one_account','league_one_auth','league_one_runtime'] LOOP
    IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=role_name) THEN
      EXECUTE format('REVOKE ALL ON TABLE website_auth.admission_epoch_activations FROM %I',role_name);
      EXECUTE format('REVOKE ALL ON FUNCTION website_auth.account_server_identity_v1(), website_auth.require_restricted_infrastructure_v1(jsonb,text), website_auth.require_auth_infrastructure_v1(jsonb), public.require_account_infrastructure_v1(jsonb), website_auth.activate_admission_epoch_v1(bigint,bigint,text,text,jsonb,uuid,text), public.require_account_revision_v2(bigint,jsonb) FROM %I',role_name);
    END IF;
  END LOOP;
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='league_one_auth') THEN
    GRANT EXECUTE ON FUNCTION website_auth.require_auth_infrastructure_v1(jsonb) TO league_one_auth;
  END IF;
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='league_one_account') THEN
    GRANT EXECUTE ON FUNCTION public.require_account_infrastructure_v1(jsonb),public.require_account_revision_v2(bigint,jsonb) TO league_one_account;
  END IF;
END; $$;
