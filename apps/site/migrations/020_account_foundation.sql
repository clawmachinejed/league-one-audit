-- Private website identity and personalization. Shared source identities, league
-- enrollment, workers and public datasets remain independent and unchanged.
CREATE TABLE public.app_users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  display_name text NOT NULL CHECK (char_length(display_name) BETWEEN 1 AND 100 AND display_name=btrim(display_name)),
  platform_handle text CHECK (platform_handle ~ '^[A-Za-z][A-Za-z0-9_]{2,29}$'),
  normalized_handle text GENERATED ALWAYS AS (lower(platform_handle COLLATE "C")) STORED,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','disabled','deleted')),
  revision bigint NOT NULL DEFAULT 1 CHECK (revision > 0),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE UNIQUE INDEX app_users_handle_unique ON public.app_users(normalized_handle) WHERE normalized_handle IS NOT NULL;

CREATE TABLE public.app_login_identities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  app_user_id uuid NOT NULL REFERENCES public.app_users(id),
  issuer text COLLATE "C" NOT NULL CHECK (char_length(issuer) BETWEEN 1 AND 500 AND issuer=btrim(issuer)),
  subject text COLLATE "C" NOT NULL CHECK (char_length(subject) BETWEEN 1 AND 500 AND subject=btrim(subject)),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  revoked_at timestamptz CHECK (revoked_at >= created_at),
  UNIQUE (issuer,subject)
);
CREATE INDEX app_login_identities_user ON public.app_login_identities(app_user_id);

CREATE TABLE public.app_provider_account_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  app_user_id uuid NOT NULL REFERENCES public.app_users(id),
  source_manager_account_id uuid NOT NULL REFERENCES public.league_source_manager_accounts(id),
  assurance text NOT NULL DEFAULT 'user_asserted' CHECK (assurance='user_asserted'),
  origin text NOT NULL DEFAULT 'self_association' CHECK (origin IN ('self_association','operator_assisted')),
  linked_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  revoked_at timestamptz CHECK (revoked_at >= linked_at),
  revision bigint NOT NULL DEFAULT 1 CHECK (revision > 0),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
-- Public username claims are not exclusive and cannot reserve another user's identity.
CREATE UNIQUE INDEX app_provider_account_links_active_unique
  ON public.app_provider_account_links(app_user_id,source_manager_account_id) WHERE revoked_at IS NULL;
CREATE INDEX app_provider_account_links_source ON public.app_provider_account_links(source_manager_account_id);

CREATE TABLE public.app_user_leagues (
  app_user_id uuid NOT NULL REFERENCES public.app_users(id),
  league_id uuid NOT NULL REFERENCES public.leagues(id),
  favorite boolean NOT NULL DEFAULT false,
  sort_position integer NOT NULL DEFAULT 0 CHECK (sort_position BETWEEN 0 AND 1000000),
  preferred_season_team_id uuid REFERENCES public.league_season_teams(id),
  saved_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  revision bigint NOT NULL DEFAULT 1 CHECK (revision > 0),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (app_user_id,league_id)
);
CREATE INDEX app_user_leagues_order ON public.app_user_leagues(app_user_id,sort_position,league_id);
CREATE INDEX app_user_leagues_team ON public.app_user_leagues(preferred_season_team_id) WHERE preferred_season_team_id IS NOT NULL;

CREATE TABLE public.app_league_groups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_key text NOT NULL UNIQUE CHECK (group_key ~ '^[a-z][a-z0-9-]{2,79}$'),
  name text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 100),
  description text CHECK (char_length(description) <= 500),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','archived')),
  revision bigint NOT NULL DEFAULT 1 CHECK (revision > 0),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE public.app_league_group_memberships (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id uuid NOT NULL REFERENCES public.app_league_groups(id),
  league_id uuid NOT NULL REFERENCES public.leagues(id),
  started_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  ended_at timestamptz CHECK (ended_at >= started_at),
  revision bigint NOT NULL DEFAULT 1 CHECK (revision > 0),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE UNIQUE INDEX app_league_group_memberships_active_unique
  ON public.app_league_group_memberships(group_id,league_id) WHERE ended_at IS NULL;
CREATE INDEX app_league_group_memberships_league ON public.app_league_group_memberships(league_id,group_id) WHERE ended_at IS NULL;

CREATE TABLE public.app_identity_audit_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  occurred_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  actor_kind text NOT NULL CHECK (actor_kind IN ('user','authentication','operator')),
  actor_user_id uuid REFERENCES public.app_users(id),
  operation text NOT NULL CHECK (operation IN ('insert','update','delete')),
  subject_type text NOT NULL CHECK (subject_type IN ('app_users','app_login_identities','app_provider_account_links',
    'app_user_leagues','app_league_groups','app_league_group_memberships')),
  subject_id uuid NOT NULL,
  subject_user_id uuid REFERENCES public.app_users(id),
  request_id uuid NOT NULL,
  -- Only the database trigger supplies revision metadata. No names, emails,
  -- provider payloads, credentials or arbitrary caller-controlled JSON is retained.
  metadata jsonb NOT NULL CHECK (jsonb_typeof(metadata)='object' AND pg_column_size(metadata)<=128)
);
CREATE INDEX app_identity_audit_subject ON public.app_identity_audit_events(subject_type,subject_id,occurred_at);
CREATE INDEX app_identity_audit_actor ON public.app_identity_audit_events(actor_user_id,occurred_at);

CREATE FUNCTION public.current_app_actor() RETURNS uuid
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE actor_id uuid;
BEGIN
  BEGIN actor_id := nullif(current_setting('app.actor_user_id',true),'')::uuid;
  EXCEPTION WHEN invalid_text_representation THEN RETURN NULL; END;
  -- Owner execution avoids recursion through app_users' own RLS policy. The
  -- account role must neither own this function nor inherit/assume its owner.
  RETURN (SELECT id FROM public.app_users WHERE id=actor_id AND status='active');
END; $$;

CREATE FUNCTION public.guard_app_account_record() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
  IF TG_TABLE_NAME='app_users' THEN
    IF NEW.id<>OLD.id OR NEW.created_at<>OLD.created_at
      OR (OLD.status='deleted' AND NEW.status<>'deleted') THEN
      RAISE EXCEPTION 'account identity and deleted lifecycle are immutable'; END IF;
  ELSIF TG_TABLE_NAME='app_login_identities' THEN
    IF (NEW.id,NEW.app_user_id,NEW.issuer,NEW.subject,NEW.created_at)
      IS DISTINCT FROM (OLD.id,OLD.app_user_id,OLD.issuer,OLD.subject,OLD.created_at)
      OR (OLD.revoked_at IS NOT NULL AND NEW.revoked_at IS DISTINCT FROM OLD.revoked_at) THEN
      RAISE EXCEPTION 'login identity cannot be reassigned or reactivated'; END IF;
    RETURN NEW;
  ELSIF TG_TABLE_NAME='app_provider_account_links' THEN
    IF (NEW.id,NEW.app_user_id,NEW.source_manager_account_id,NEW.assurance,NEW.origin,NEW.linked_at)
      IS DISTINCT FROM (OLD.id,OLD.app_user_id,OLD.source_manager_account_id,OLD.assurance,OLD.origin,OLD.linked_at)
      OR (OLD.revoked_at IS NOT NULL AND NEW.revoked_at IS DISTINCT FROM OLD.revoked_at) THEN
      RAISE EXCEPTION 'provider association cannot be reassigned or reactivated'; END IF;
  ELSIF TG_TABLE_NAME='app_user_leagues' THEN
    IF (NEW.app_user_id,NEW.league_id,NEW.saved_at) IS DISTINCT FROM (OLD.app_user_id,OLD.league_id,OLD.saved_at) THEN
      RAISE EXCEPTION 'saved league identity is immutable'; END IF;
  ELSIF TG_TABLE_NAME='app_league_groups' THEN
    IF (NEW.id,NEW.group_key,NEW.created_at) IS DISTINCT FROM (OLD.id,OLD.group_key,OLD.created_at) THEN
      RAISE EXCEPTION 'group identity is immutable'; END IF;
  ELSIF TG_TABLE_NAME='app_league_group_memberships' THEN
    IF (NEW.id,NEW.group_id,NEW.league_id,NEW.started_at) IS DISTINCT FROM (OLD.id,OLD.group_id,OLD.league_id,OLD.started_at)
      OR (OLD.ended_at IS NOT NULL AND NEW.ended_at IS DISTINCT FROM OLD.ended_at) THEN
      RAISE EXCEPTION 'affiliation history is immutable'; END IF;
  END IF;
  NEW.revision := OLD.revision+1;
  NEW.updated_at := clock_timestamp();
  RETURN NEW;
END; $$;

CREATE FUNCTION public.validate_app_user_league() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
  IF TG_OP='INSERT' AND NOT EXISTS (SELECT 1 FROM public.league_administration_enrollments WHERE league_id=NEW.league_id AND active) THEN
    RAISE EXCEPTION 'saved league is not an active approved enrollment'; END IF;
  -- Preserve old preferences as historical values at rollover, but validate
  -- every newly selected team against the intended current source and roster.
  IF NEW.preferred_season_team_id IS NOT NULL AND
    (TG_OP='INSERT' OR NEW.preferred_season_team_id IS DISTINCT FROM OLD.preferred_season_team_id) THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.league_season_teams team
      JOIN public.league_seasons season ON season.id=team.league_season_id
      JOIN public.league_administration_enrollments enrollment ON enrollment.league_id=season.league_id AND enrollment.active
      JOIN public.league_source_connections connection ON connection.league_season_id=season.id AND connection.provider=enrollment.provider
      JOIN public.league_administration_heads head ON head.league_season_id=season.id AND head.family='rosters' AND head.week=0
      JOIN public.league_administration_observations observation ON observation.id=head.accepted_observation_id
      JOIN public.league_administration_contents content ON content.id=observation.content_id
      JOIN public.league_administration_team_entries entry ON entry.content_id=content.id AND entry.team_id=team.id
      WHERE team.id=NEW.preferred_season_team_id AND season.league_id=NEW.league_id
        AND season.season=(SELECT max(intended.season) FROM public.league_administration_enrollment_seasons intended
          WHERE intended.league_id=season.league_id AND intended.provider=enrollment.provider)
        AND team.provider=connection.provider AND team.external_league_id=connection.external_league_id
        AND content.league_season_id=season.id AND content.provider=connection.provider
        AND content.external_league_id=connection.external_league_id AND content.family='rosters' AND content.week=0
        AND content.accepted AND content.completeness='complete' AND content.normalizer_version='sleeper-administration-v1'
        AND observation.outcome IN ('changed','unchanged') AND head.read_conflict IS NULL
    ) THEN RAISE EXCEPTION 'preferred team is not in the approved current league roster'; END IF;
  END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER app_user_leagues_validate BEFORE INSERT OR UPDATE ON public.app_user_leagues
  FOR EACH ROW EXECUTE FUNCTION public.validate_app_user_league();

CREATE FUNCTION public.audit_app_identity_change() RETURNS trigger
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE row_value jsonb; actor_id uuid; request_uuid uuid; subject_uuid uuid; user_uuid uuid; actor_type text;
  rate_window_start timestamptz;
BEGIN
  request_uuid := nullif(current_setting('app.request_id',true),'')::uuid;
  IF request_uuid IS NULL THEN RAISE EXCEPTION 'account change requires transaction-local request context'; END IF;
  row_value := CASE WHEN TG_OP='DELETE' THEN to_jsonb(OLD) ELSE to_jsonb(NEW) END;
  actor_id := public.current_app_actor();
  subject_uuid := coalesce((row_value->>'id')::uuid,(row_value->>'league_id')::uuid);
  user_uuid := CASE WHEN TG_TABLE_NAME='app_users' THEN subject_uuid ELSE (row_value->>'app_user_id')::uuid END;
  actor_type := CASE WHEN TG_OP='INSERT' AND TG_TABLE_NAME IN ('app_users','app_login_identities') THEN 'authentication'
    WHEN actor_id IS NOT NULL THEN 'user' ELSE 'operator' END;
  IF actor_type='user' THEN
    -- The shared per-actor lock covers direct SQL as well as the store's own
    -- serialized writes. A rejection rolls back the data/revision and audit
    -- together; authentication and deliberate operator maintenance are separate.
    IF current_setting('transaction_isolation')<>'read committed' THEN
      RAISE EXCEPTION USING ERRCODE='P4290', MESSAGE='account writes require read committed isolation';
    END IF;
    IF NOT pg_try_advisory_xact_lock(hashtextextended('app:mutation-rate:'||actor_id::text,0)) THEN
      RAISE EXCEPTION USING ERRCODE='P4290', MESSAGE='account write is already in progress';
    END IF;
    rate_window_start := clock_timestamp()-interval '60 seconds';
    IF (SELECT count(*) FROM (SELECT 1 FROM public.app_identity_audit_events
      WHERE actor_user_id=actor_id AND actor_kind='user' AND occurred_at>=rate_window_start LIMIT 60) recent)>=60 THEN
      RAISE EXCEPTION USING ERRCODE='P4290', MESSAGE='account write rate limit exceeded';
    END IF;
  END IF;
  INSERT INTO public.app_identity_audit_events(actor_kind,actor_user_id,operation,subject_type,subject_id,subject_user_id,request_id,metadata)
  VALUES(actor_type,actor_id,lower(TG_OP),TG_TABLE_NAME,subject_uuid,user_uuid,request_uuid,
    CASE WHEN row_value ? 'revision' THEN jsonb_build_object('revision',(row_value->>'revision')::bigint) ELSE '{}'::jsonb END);
  RETURN CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END;
END; $$;
CREATE FUNCTION public.prevent_app_audit_change() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN RAISE EXCEPTION 'account audit events are append-only'; END; $$;
CREATE TRIGGER app_identity_audit_immutable BEFORE UPDATE OR DELETE ON public.app_identity_audit_events
  FOR EACH ROW EXECUTE FUNCTION public.prevent_app_audit_change();

DO $$ DECLARE table_name text; BEGIN
  FOREACH table_name IN ARRAY ARRAY['app_users','app_login_identities','app_provider_account_links',
    'app_user_leagues','app_league_groups','app_league_group_memberships'] LOOP
    EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.guard_app_account_record()',table_name||'_guard',table_name);
    EXECUTE format('CREATE TRIGGER %I AFTER INSERT OR UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.audit_app_identity_change()',table_name||'_audit',table_name);
  END LOOP;
END; $$;

-- Only call with a session verified by the selected site's authentication
-- implementation. This server credential is trusted to assert issuer/subject;
-- the function does not itself verify a browser cookie or an external token.
CREATE FUNCTION public.resolve_app_login_identity(p_issuer text,p_subject text,p_display_name text,p_request_id uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE identity_row public.app_login_identities; user_id uuid; previous_actor text; previous_request text;
BEGIN
  IF p_issuer IS NULL OR p_subject IS NULL OR p_display_name IS NULL OR p_request_id IS NULL
    OR char_length(p_issuer) NOT BETWEEN 1 AND 500 OR p_issuer<>btrim(p_issuer)
    OR char_length(p_subject) NOT BETWEEN 1 AND 500 OR p_subject<>btrim(p_subject)
    OR char_length(btrim(p_display_name)) NOT BETWEEN 1 AND 100 THEN
    RAISE EXCEPTION 'invalid verified login identity'; END IF;
  -- A length-delimited JSON pair avoids ambiguous concatenation. Lock hash
  -- collisions only serialize unrelated registrations; uniqueness remains exact.
  PERFORM pg_advisory_xact_lock(hashtextextended(jsonb_build_array(p_issuer,p_subject)::text,0));
  SELECT * INTO identity_row FROM public.app_login_identities WHERE issuer=p_issuer AND subject=p_subject FOR UPDATE;
  IF FOUND THEN
    IF identity_row.revoked_at IS NOT NULL OR NOT EXISTS
      (SELECT 1 FROM public.app_users WHERE id=identity_row.app_user_id AND status='active') THEN
      RAISE EXCEPTION 'website account is unavailable'; END IF;
    RETURN identity_row.app_user_id;
  END IF;
  user_id := gen_random_uuid();
  previous_actor := current_setting('app.actor_user_id',true);
  previous_request := current_setting('app.request_id',true);
  PERFORM set_config('app.actor_user_id',user_id::text,true),set_config('app.request_id',p_request_id::text,true);
  INSERT INTO public.app_users(id,display_name) VALUES(user_id,btrim(p_display_name));
  INSERT INTO public.app_login_identities(app_user_id,issuer,subject) VALUES(user_id,p_issuer,p_subject);
  PERFORM set_config('app.actor_user_id',coalesce(previous_actor,''),true),set_config('app.request_id',coalesce(previous_request,''),true);
  RETURN user_id;
END; $$;

ALTER TABLE public.app_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.app_login_identities ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.app_provider_account_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.app_user_leagues ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.app_league_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.app_league_group_memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.app_identity_audit_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY app_users_own ON public.app_users USING (id=public.current_app_actor()) WITH CHECK (id=public.current_app_actor());
CREATE POLICY app_login_identities_own ON public.app_login_identities USING (app_user_id=public.current_app_actor()) WITH CHECK (app_user_id=public.current_app_actor());
CREATE POLICY app_provider_account_links_own ON public.app_provider_account_links USING (app_user_id=public.current_app_actor()) WITH CHECK (app_user_id=public.current_app_actor());
CREATE POLICY app_user_leagues_own ON public.app_user_leagues USING (app_user_id=public.current_app_actor()) WITH CHECK (app_user_id=public.current_app_actor());
CREATE POLICY app_league_groups_read ON public.app_league_groups FOR SELECT USING (true);
CREATE POLICY app_league_group_memberships_read ON public.app_league_group_memberships FOR SELECT USING (true);
-- Audit has no runtime policy/grant. Readable audit administration is operator-only.

DO $$ DECLARE object_name text; BEGIN
  FOREACH object_name IN ARRAY ARRAY['app_users','app_login_identities','app_provider_account_links','app_user_leagues',
    'app_league_groups','app_league_group_memberships','app_identity_audit_events'] LOOP
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM PUBLIC',object_name);
    IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='league_one_runtime') THEN
      EXECUTE format('REVOKE ALL ON TABLE public.%I FROM league_one_runtime',object_name);
    END IF;
    IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='league_one_account') THEN
      EXECUTE format('REVOKE ALL ON TABLE public.%I FROM league_one_account',object_name);
    END IF;
  END LOOP;
  FOREACH object_name IN ARRAY ARRAY['current_app_actor()','guard_app_account_record()','validate_app_user_league()',
    'audit_app_identity_change()','prevent_app_audit_change()','resolve_app_login_identity(text,text,text,uuid)'] LOOP
    EXECUTE 'REVOKE ALL ON FUNCTION public.'||object_name||' FROM PUBLIC';
    IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='league_one_runtime') THEN
      EXECUTE 'REVOKE ALL ON FUNCTION public.'||object_name||' FROM league_one_runtime';
    END IF;
    IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='league_one_account') THEN
      EXECUTE 'REVOKE ALL ON FUNCTION public.'||object_name||' FROM league_one_account';
    END IF;
  END LOOP;
END; $$;
