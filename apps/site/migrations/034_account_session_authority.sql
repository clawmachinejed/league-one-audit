-- BC-M1 ENG01 target authority. DRAFT: not compatible with unchanged legacy
-- public account callers. Do not apply outside the isolated qualification
-- harness until receipt composition and activation sequencing are qualified.
-- No epoch is activated by installation.
-- Existing account commands must supply the maintained auth receipt.
-- The helper itself always authenticates; there is no feature-flag bypass.
CREATE TABLE website_auth.admission_epoch (
  slot smallint PRIMARY KEY CHECK (slot=1),
  revision bigint NOT NULL CHECK (revision>0),
  config_hash text NOT NULL CHECK (config_hash ~ '^[0-9a-f]{64}$'),
  issuer text COLLATE "C" NOT NULL CHECK (btrim(issuer)<>''),
  clock_domain text COLLATE "C" NOT NULL CHECK (btrim(clock_domain)<>''),
  activated_at timestamptz NOT NULL DEFAULT clock_timestamp() CHECK (isfinite(activated_at))
);
REVOKE ALL ON website_auth.admission_epoch FROM PUBLIC;

-- Refuse a shadowed or relocated crypto function instead of trusting search_path.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension e JOIN pg_depend d
    ON d.refclassid='pg_extension'::regclass AND d.refobjid=e.oid AND d.deptype='e'
    JOIN pg_proc p ON d.classid='pg_proc'::regclass AND d.objid=p.oid
    JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE e.extname='pgcrypto' AND n.nspname='public'
      AND p.oid=to_regprocedure('public.digest(bytea,text)')) THEN
    RAISE EXCEPTION 'account authority requires the verified pgcrypto digest';
  END IF;
END; $$;

CREATE FUNCTION website_auth.guard_admission_authority_v2() RETURNS trigger
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,website_auth,pg_temp AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(19740517,1);
  RETURN NULL;
END; $$;
REVOKE ALL ON FUNCTION website_auth.guard_admission_authority_v2() FROM PUBLIC;
CREATE TRIGGER auth_user_gate_v2 BEFORE INSERT OR UPDATE OR DELETE ON website_auth."user"
  FOR EACH STATEMENT EXECUTE FUNCTION website_auth.guard_admission_authority_v2();
CREATE TRIGGER auth_session_gate_v2 BEFORE INSERT OR UPDATE OR DELETE ON website_auth.session
  FOR EACH STATEMENT EXECUTE FUNCTION website_auth.guard_admission_authority_v2();
CREATE TRIGGER auth_epoch_gate_v2 BEFORE INSERT OR UPDATE OR DELETE ON website_auth.admission_epoch
  FOR EACH STATEMENT EXECUTE FUNCTION website_auth.guard_admission_authority_v2();

CREATE FUNCTION website_auth.read_admission_epoch_locked_v1(p_expected_hash text,p_expected_issuer text)
RETURNS TABLE(revision bigint,config_hash text,issuer text,clock_domain text)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,website_auth,pg_temp AS $$
DECLARE epoch website_auth.admission_epoch;
BEGIN
  IF p_expected_hash IS NULL OR p_expected_hash !~ '^[0-9a-f]{64}$'
    OR p_expected_issuer IS NULL OR btrim(p_expected_issuer)='' THEN
    RAISE EXCEPTION USING ERRCODE='P4101',MESSAGE='account authority unavailable';
  END IF;
  PERFORM pg_advisory_xact_lock_shared(19740517,1);
  SELECT * INTO epoch FROM website_auth.admission_epoch WHERE slot=1 FOR SHARE;
  IF NOT FOUND OR epoch.config_hash<>p_expected_hash OR epoch.issuer<>p_expected_issuer
    OR epoch.activated_at>clock_timestamp() THEN
    RAISE EXCEPTION USING ERRCODE='P4101',MESSAGE='account authority unavailable';
  END IF;
  RETURN QUERY SELECT epoch.revision,epoch.config_hash,epoch.issuer,epoch.clock_domain;
END; $$;
REVOKE ALL ON FUNCTION website_auth.read_admission_epoch_locked_v1(text,text) FROM PUBLIC;

CREATE FUNCTION public.lock_account_session_authority_v2(p_session_receipt jsonb)
RETURNS TABLE(session_expires_at timestamptz,admission_epoch_revision bigint,
  db_sample_at timestamptz,session_created_at timestamptz)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,website_auth,public,pg_temp AS $$
DECLARE epoch website_auth.admission_epoch; auth_user website_auth."user";
  auth_session website_auth.session; expiry timestamptz; revision_value bigint; sampled_at timestamptz;
BEGIN
  IF p_session_receipt IS NULL OR jsonb_typeof(p_session_receipt) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION USING ERRCODE='P4101',MESSAGE='account authority unavailable';
  END IF;
  IF (SELECT array_agg(key ORDER BY key) FROM jsonb_object_keys(p_session_receipt) AS keys(key))
    IS DISTINCT FROM ARRAY['admissionEpochRevision','admittedEmailDigest','clockDomain','configHash',
      'expiresAt','issuer','sessionId','sessionTokenDigest','subject']::text[]
    OR EXISTS (SELECT 1 FROM jsonb_each(p_session_receipt) WHERE jsonb_typeof(value)<>'string')
    OR p_session_receipt->>'admissionEpochRevision' !~ '^[1-9][0-9]{0,18}$'
    OR p_session_receipt->>'configHash' !~ '^[0-9a-f]{64}$'
    OR p_session_receipt->>'admittedEmailDigest' !~ '^[0-9a-f]{64}$'
    OR p_session_receipt->>'sessionTokenDigest' !~ '^[0-9a-f]{64}$'
    OR btrim(p_session_receipt->>'sessionId')=''
    OR btrim(p_session_receipt->>'subject')=''
    OR btrim(p_session_receipt->>'issuer')=''
    OR btrim(p_session_receipt->>'clockDomain')=''
    OR p_session_receipt->>'expiresAt' !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?Z$' THEN
    RAISE EXCEPTION USING ERRCODE='P4101',MESSAGE='account authority unavailable';
  END IF;
  BEGIN
    expiry := (p_session_receipt->>'expiresAt')::timestamptz;
    revision_value := (p_session_receipt->>'admissionEpochRevision')::bigint;
  EXCEPTION WHEN invalid_datetime_format OR datetime_field_overflow OR numeric_value_out_of_range THEN
    RAISE EXCEPTION USING ERRCODE='P4101',MESSAGE='account authority unavailable';
  END;
  PERFORM pg_advisory_xact_lock_shared(19740517,1);
  SELECT * INTO epoch FROM website_auth.admission_epoch WHERE slot=1 FOR SHARE;
  IF NOT FOUND OR epoch.revision<>revision_value OR epoch.config_hash<>p_session_receipt->>'configHash'
    OR epoch.issuer<>p_session_receipt->>'issuer' OR epoch.clock_domain<>p_session_receipt->>'clockDomain' THEN
    RAISE EXCEPTION USING ERRCODE='P4101',MESSAGE='account authority unavailable';
  END IF;
  SELECT * INTO auth_user FROM website_auth."user" WHERE id=p_session_receipt->>'subject' FOR SHARE;
  IF NOT FOUND OR auth_user."emailVerified" IS NOT TRUE
    OR pg_catalog.encode(public.digest(pg_catalog.convert_to(auth_user.email,'UTF8'),'sha256'),'hex')
      <>p_session_receipt->>'admittedEmailDigest' THEN
    RAISE EXCEPTION USING ERRCODE='P4101',MESSAGE='account authority unavailable';
  END IF;
  SELECT * INTO auth_session FROM website_auth.session WHERE id=p_session_receipt->>'sessionId' FOR SHARE;
  sampled_at := clock_timestamp();
  IF NOT FOUND OR auth_session."userId"<>auth_user.id OR auth_session."expiresAt"<>expiry
    OR NOT isfinite(expiry) OR expiry<=sampled_at OR epoch.activated_at>sampled_at
    OR NOT isfinite(auth_session."createdAt") OR auth_session."createdAt">sampled_at
    OR pg_catalog.encode(public.digest(pg_catalog.convert_to(auth_session.token,'UTF8'),'sha256'),'hex')
      <>p_session_receipt->>'sessionTokenDigest' THEN
    RAISE EXCEPTION USING ERRCODE='P4101',MESSAGE='account authority unavailable';
  END IF;
  RETURN QUERY SELECT auth_session."expiresAt",epoch.revision,sampled_at,auth_session."createdAt";
END; $$;
REVOKE ALL ON FUNCTION public.lock_account_session_authority_v2(jsonb) FROM PUBLIC;

-- R001/R003 stored-read composition: raw SELECT cannot have a statement trigger.
-- Bind the actor before private SQL without granting account UPDATE on login rows.
CREATE FUNCTION public.lock_account_actor_authority_v2(p_session_receipt jsonb,p_write boolean) RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,public,website_auth,pg_temp AS $$
DECLARE actor uuid;
BEGIN
  IF p_write IS NULL THEN RAISE EXCEPTION USING ERRCODE='P4101',MESSAGE='account authority unavailable'; END IF;
  PERFORM public.lock_account_session_authority_v2(p_session_receipt);
  BEGIN actor := nullif(current_setting('app.actor_user_id',true),'')::uuid;
  EXCEPTION WHEN invalid_text_representation THEN
    RAISE EXCEPTION USING ERRCODE='P4101',MESSAGE='account authority unavailable'; END;
  IF p_write THEN
    PERFORM 1 FROM public.app_users WHERE id=actor AND status='active' FOR UPDATE;
  ELSE
    PERFORM 1 FROM public.app_users WHERE id=actor AND status='active' FOR SHARE;
  END IF;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='P4101',MESSAGE='account authority unavailable'; END IF;
  PERFORM 1 FROM public.app_login_identities WHERE app_user_id=actor
    AND issuer=p_session_receipt->>'issuer' AND subject=p_session_receipt->>'subject' AND revoked_at IS NULL FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='P4101',MESSAGE='account authority unavailable'; END IF;
  IF (p_session_receipt->>'expiresAt')::timestamptz<=clock_timestamp() THEN
    RAISE EXCEPTION USING ERRCODE='P4101',MESSAGE='account authority unavailable'; END IF;
END; $$;
REVOKE ALL ON FUNCTION public.lock_account_actor_authority_v2(jsonb,boolean) FROM PUBLIC;

-- Final internal authority timing after protected work, before transaction commit.
-- Membership/resource readers must additionally intersect their own expiries.
CREATE FUNCTION public.read_account_authority_timing_v2(p_session_receipt jsonb) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,public,website_auth,pg_temp AS $$
DECLARE sampled_at timestamptz; expiry timestamptz; remaining_ms bigint;
BEGIN
  PERFORM public.lock_account_actor_authority_v2(p_session_receipt,false);
  sampled_at := clock_timestamp();
  expiry := (p_session_receipt->>'expiresAt')::timestamptz;
  remaining_ms := floor(extract(epoch FROM (expiry-sampled_at))*1000)::bigint;
  IF remaining_ms<=0 THEN RAISE EXCEPTION USING ERRCODE='P4101',MESSAGE='account authority unavailable'; END IF;
  RETURN jsonb_build_object(
    'dbSampleAt',to_char(sampled_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'minimumAuthorityExpiresAt',to_char(expiry AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'remainingLifetimeMs',remaining_ms::text);
END; $$;
REVOKE ALL ON FUNCTION public.read_account_authority_timing_v2(jsonb) FROM PUBLIC;

-- The owner maintenance branch requires an authenticated owner session which
-- has not assumed a restricted role. SET ROLE fixtures therefore exercise the
-- account branch; the role setting cannot be forged without PostgreSQL role rights.
CREATE FUNCTION public.guard_account_session_statement_v2() RETURNS trigger
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,public,website_auth,pg_temp AS $$
DECLARE receipt jsonb; actor uuid; owner_oid oid;
BEGIN
  SELECT proowner INTO owner_oid FROM pg_proc
    WHERE oid='public.guard_account_session_statement_v2()'::regprocedure;
  IF (SELECT oid FROM pg_roles WHERE rolname=session_user)=owner_oid
    AND current_setting('role') IN ('none',session_user) THEN
    PERFORM pg_advisory_xact_lock(19740517,1);
    BEGIN actor := nullif(current_setting('app.actor_user_id',true),'')::uuid;
    EXCEPTION WHEN invalid_text_representation THEN
      RAISE EXCEPTION USING ERRCODE='P4101',MESSAGE='account authority unavailable'; END;
    IF actor IS NOT NULL THEN
      PERFORM 1 FROM public.app_users WHERE id=actor FOR UPDATE;
      IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='P4101',MESSAGE='account authority unavailable'; END IF;
      PERFORM 1 FROM public.app_login_identities WHERE app_user_id=actor ORDER BY id FOR UPDATE;
    END IF;
    RETURN NULL;
  END IF;
  IF TG_TABLE_NAME='app_login_identities' THEN
    RAISE EXCEPTION USING ERRCODE='P4101',MESSAGE='account authority unavailable';
  END IF;
  IF current_setting('transaction_isolation')<>'read committed' THEN
    RAISE EXCEPTION USING ERRCODE='P4290',MESSAGE='account writes require read committed isolation';
  END IF;
  BEGIN
    receipt := nullif(current_setting('app.session_receipt_v2',true),'')::jsonb;
    actor := nullif(current_setting('app.actor_user_id',true),'')::uuid;
  EXCEPTION WHEN invalid_text_representation THEN
    RAISE EXCEPTION USING ERRCODE='P4101',MESSAGE='account authority unavailable';
  END;
  PERFORM public.lock_account_session_authority_v2(receipt);
  PERFORM 1 FROM public.app_users WHERE id=actor AND status='active' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='P4101',MESSAGE='account authority unavailable'; END IF;
  PERFORM 1 FROM public.app_login_identities WHERE app_user_id=actor
    AND issuer=receipt->>'issuer' AND subject=receipt->>'subject' AND revoked_at IS NULL FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='P4101',MESSAGE='account authority unavailable'; END IF;
  IF (receipt->>'expiresAt')::timestamptz<=clock_timestamp() THEN
    RAISE EXCEPTION USING ERRCODE='P4101',MESSAGE='account authority unavailable'; END IF;
  RETURN NULL;
END; $$;
REVOKE ALL ON FUNCTION public.guard_account_session_statement_v2() FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.resolve_app_login_identity(p_issuer text,p_subject text,p_display_name text,p_request_id uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,website_auth,pg_temp AS $$
DECLARE receipt jsonb; identity_row public.app_login_identities; user_id uuid; previous_actor text; previous_request text;
BEGIN
  BEGIN receipt := nullif(current_setting('app.session_receipt_v2',true),'')::jsonb;
  EXCEPTION WHEN invalid_text_representation THEN
    RAISE EXCEPTION USING ERRCODE='P4101',MESSAGE='account authority unavailable'; END;
  PERFORM public.lock_account_session_authority_v2(receipt);
  IF p_issuer IS DISTINCT FROM receipt->>'issuer' OR p_subject IS DISTINCT FROM receipt->>'subject'
    OR p_display_name IS NULL OR p_request_id IS NULL
    OR char_length(p_issuer) NOT BETWEEN 1 AND 500 OR p_issuer<>btrim(p_issuer)
    OR char_length(p_subject) NOT BETWEEN 1 AND 500 OR p_subject<>btrim(p_subject)
    OR char_length(btrim(p_display_name)) NOT BETWEEN 1 AND 100 THEN
    RAISE EXCEPTION USING ERRCODE='P4101',MESSAGE='account authority unavailable'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(jsonb_build_array(p_issuer,p_subject)::text,0));
  -- Immutable ownership can be read before locks; actual authority is reread
  -- after taking Actor then login, never the legacy reversed order.
  SELECT app_user_id INTO user_id FROM public.app_login_identities WHERE issuer=p_issuer AND subject=p_subject;
  IF FOUND THEN
    PERFORM 1 FROM public.app_users WHERE id=user_id AND status='active' FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'website account is unavailable'; END IF;
    SELECT * INTO identity_row FROM public.app_login_identities WHERE issuer=p_issuer AND subject=p_subject FOR SHARE;
    IF NOT FOUND OR identity_row.app_user_id<>user_id OR identity_row.revoked_at IS NOT NULL THEN
      RAISE EXCEPTION 'website account is unavailable'; END IF;
    IF (receipt->>'expiresAt')::timestamptz<=clock_timestamp() THEN
      RAISE EXCEPTION USING ERRCODE='P4101',MESSAGE='account authority unavailable'; END IF;
    RETURN user_id;
  END IF;
  user_id := gen_random_uuid();
  previous_actor := current_setting('app.actor_user_id',true);
  previous_request := current_setting('app.request_id',true);
  PERFORM set_config('app.actor_user_id',user_id::text,true),set_config('app.request_id',p_request_id::text,true);
  INSERT INTO public.app_users(id,display_name) VALUES(user_id,btrim(p_display_name));
  INSERT INTO public.app_login_identities(app_user_id,issuer,subject) VALUES(user_id,p_issuer,p_subject);
  IF (receipt->>'expiresAt')::timestamptz<=clock_timestamp() THEN
    RAISE EXCEPTION USING ERRCODE='P4101',MESSAGE='account authority unavailable'; END IF;
  PERFORM set_config('app.actor_user_id',coalesce(previous_actor,''),true),set_config('app.request_id',coalesce(previous_request,''),true);
  RETURN user_id;
END; $$;

CREATE FUNCTION public.guard_login_insert_authority_v2() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,website_auth,pg_temp AS $$
DECLARE receipt jsonb;
BEGIN
  BEGIN receipt := nullif(current_setting('app.session_receipt_v2',true),'')::jsonb;
  EXCEPTION WHEN invalid_text_representation THEN
    RAISE EXCEPTION USING ERRCODE='P4101',MESSAGE='account authority unavailable'; END;
  PERFORM public.lock_account_session_authority_v2(receipt);
  RETURN NULL;
END; $$;
CREATE FUNCTION public.guard_login_insert_binding_v2() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,website_auth,pg_temp AS $$
DECLARE receipt jsonb;
BEGIN
  receipt := current_setting('app.session_receipt_v2',true)::jsonb;
  IF NEW.app_user_id IS DISTINCT FROM public.current_app_actor()
    OR NEW.issuer IS DISTINCT FROM receipt->>'issuer' OR NEW.subject IS DISTINCT FROM receipt->>'subject' THEN
    RAISE EXCEPTION USING ERRCODE='P4101',MESSAGE='account authority unavailable'; END IF;
  RETURN NEW;
END; $$;
REVOKE ALL ON FUNCTION public.guard_login_insert_authority_v2(),public.guard_login_insert_binding_v2() FROM PUBLIC;
CREATE TRIGGER account_association_session_v2 BEFORE INSERT OR UPDATE OR DELETE ON public.app_provider_account_links
  FOR EACH STATEMENT EXECUTE FUNCTION public.guard_account_session_statement_v2();
CREATE TRIGGER account_preference_session_v2 BEFORE INSERT OR UPDATE OR DELETE ON public.app_user_leagues
  FOR EACH STATEMENT EXECUTE FUNCTION public.guard_account_session_statement_v2();
CREATE TRIGGER account_profile_session_v2 BEFORE UPDATE ON public.app_users
  FOR EACH STATEMENT EXECUTE FUNCTION public.guard_account_session_statement_v2();
CREATE TRIGGER login_insert_authority_v2 BEFORE INSERT ON public.app_login_identities
  FOR EACH STATEMENT EXECUTE FUNCTION public.guard_login_insert_authority_v2();
CREATE TRIGGER login_insert_binding_v2 BEFORE INSERT ON public.app_login_identities
  FOR EACH ROW EXECUTE FUNCTION public.guard_login_insert_binding_v2();
CREATE TRIGGER login_mutation_operator_v2 BEFORE UPDATE OR DELETE ON public.app_login_identities
  FOR EACH STATEMENT EXECUTE FUNCTION public.guard_account_session_statement_v2();

CREATE FUNCTION public.disable_app_actor_v1(p_actor_id uuid,p_request_id uuid) RETURNS boolean
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,public,website_auth,pg_temp AS $$
DECLARE owner_oid oid; actor_status text; previous_actor text; previous_request text;
BEGIN
  SELECT proowner INTO owner_oid FROM pg_proc WHERE oid='public.disable_app_actor_v1(uuid,uuid)'::regprocedure;
  IF (SELECT oid FROM pg_roles WHERE rolname=session_user) IS DISTINCT FROM owner_oid
    OR p_actor_id IS NULL OR p_request_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE='P4101',MESSAGE='account authority unavailable';
  END IF;
  PERFORM pg_advisory_xact_lock(19740517,1);
  SELECT status INTO actor_status FROM public.app_users WHERE id=p_actor_id FOR UPDATE;
  IF NOT FOUND OR actor_status='deleted' THEN RETURN false; END IF;
  PERFORM 1 FROM public.app_login_identities WHERE app_user_id=p_actor_id ORDER BY id FOR UPDATE;
  IF actor_status='disabled' THEN RETURN true; END IF;
  previous_actor := current_setting('app.actor_user_id',true);
  previous_request := current_setting('app.request_id',true);
  PERFORM set_config('app.actor_user_id','',true),set_config('app.request_id',p_request_id::text,true);
  UPDATE public.app_users SET status='disabled' WHERE id=p_actor_id;
  PERFORM set_config('app.actor_user_id',coalesce(previous_actor,''),true),
    set_config('app.request_id',coalesce(previous_request,''),true);
  RETURN true;
END; $$;
REVOKE ALL ON FUNCTION public.disable_app_actor_v1(uuid,uuid) FROM PUBLIC;

CREATE FUNCTION public.revoke_app_login_identity_v1(p_login_identity_id uuid,p_request_id uuid) RETURNS boolean
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,public,website_auth,pg_temp AS $$
DECLARE owner_oid oid; actor_id uuid; identity_row public.app_login_identities;
  previous_actor text; previous_request text;
BEGIN
  SELECT proowner INTO owner_oid FROM pg_proc WHERE oid='public.revoke_app_login_identity_v1(uuid,uuid)'::regprocedure;
  IF (SELECT oid FROM pg_roles WHERE rolname=session_user) IS DISTINCT FROM owner_oid
    OR p_login_identity_id IS NULL OR p_request_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE='P4101',MESSAGE='account authority unavailable';
  END IF;
  PERFORM pg_advisory_xact_lock(19740517,1);
  SELECT app_user_id INTO actor_id FROM public.app_login_identities WHERE id=p_login_identity_id;
  IF NOT FOUND THEN RETURN false; END IF;
  PERFORM 1 FROM public.app_users WHERE id=actor_id AND status<>'deleted' FOR UPDATE;
  IF NOT FOUND THEN RETURN false; END IF;
  SELECT * INTO identity_row FROM public.app_login_identities WHERE id=p_login_identity_id FOR UPDATE;
  IF NOT FOUND OR identity_row.app_user_id<>actor_id THEN RETURN false; END IF;
  IF identity_row.revoked_at IS NOT NULL THEN RETURN true; END IF;
  previous_actor := current_setting('app.actor_user_id',true);
  previous_request := current_setting('app.request_id',true);
  PERFORM set_config('app.actor_user_id','',true),set_config('app.request_id',p_request_id::text,true);
  UPDATE public.app_login_identities SET revoked_at=clock_timestamp() WHERE id=p_login_identity_id;
  PERFORM set_config('app.actor_user_id',coalesce(previous_actor,''),true),
    set_config('app.request_id',coalesce(previous_request,''),true);
  RETURN true;
END; $$;
REVOKE ALL ON FUNCTION public.revoke_app_login_identity_v1(uuid,uuid) FROM PUBLIC;

-- Existing roles may not exist in a fresh migration install. Provisioning scripts
-- repeat this exact allowlist after their blanket revokes, including late roles.
DO $$ DECLARE role_name text; BEGIN
  FOREACH role_name IN ARRAY ARRAY['league_one_account','league_one_auth','league_one_runtime'] LOOP
    IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=role_name) THEN
      EXECUTE format('REVOKE ALL ON TABLE website_auth.admission_epoch FROM %I',role_name);
      EXECUTE format('REVOKE ALL ON FUNCTION public.lock_account_session_authority_v2(jsonb), public.lock_account_actor_authority_v2(jsonb,boolean), public.read_account_authority_timing_v2(jsonb), public.guard_account_session_statement_v2(), public.guard_login_insert_authority_v2(), public.guard_login_insert_binding_v2(), public.disable_app_actor_v1(uuid,uuid), public.revoke_app_login_identity_v1(uuid,uuid), website_auth.guard_admission_authority_v2(), website_auth.read_admission_epoch_locked_v1(text,text) FROM %I',role_name);
    END IF;
  END LOOP;
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='league_one_account') THEN
    GRANT EXECUTE ON FUNCTION public.lock_account_session_authority_v2(jsonb),public.lock_account_actor_authority_v2(jsonb,boolean),public.read_account_authority_timing_v2(jsonb) TO league_one_account;
  END IF;
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='league_one_auth') THEN
    GRANT EXECUTE ON FUNCTION website_auth.read_admission_epoch_locked_v1(text,text) TO league_one_auth;
  END IF;
END; $$;
