-- Forward-only identity prerequisites. Run through the existing transactional
-- migration installer. No accepted facts, providers or production selection enabled.
LOCK TABLE public.league_source_connections,public.league_source_mapping_revisions,
  public.league_source_connection_history,public.league_season_teams IN ACCESS EXCLUSIVE MODE;
DO $$ BEGIN
  IF EXISTS(SELECT 1 FROM public.league_source_connections WHERE provider<>'sleeper')
    OR EXISTS(SELECT 1 FROM public.league_source_mapping_revisions WHERE provider<>'sleeper')
    OR EXISTS(SELECT 1 FROM public.league_source_connection_history WHERE provider<>'sleeper')
    OR EXISTS(SELECT 1 FROM public.league_season_teams WHERE provider<>'sleeper') THEN
    RAISE EXCEPTION 'unclassified source identity blocks namespace initialization';
  END IF;
END; $$;

CREATE TEMP TABLE canonical_identity_initialization_before ON COMMIT DROP AS
  SELECT 'team'::text AS kind,id,to_jsonb(team) AS original FROM public.league_season_teams team
  UNION ALL SELECT 'history',id,to_jsonb(history) FROM public.league_source_connection_history history
  UNION ALL SELECT 'connection',id,to_jsonb(connection) FROM public.league_source_connections connection
  UNION ALL SELECT 'revision',id,to_jsonb(revision) FROM public.league_source_mapping_revisions revision;
CREATE FUNCTION public.canonical_legacy_team_namespace(p_season integer,p_external text) RETURNS text
LANGUAGE sql IMMUTABLE STRICT SET search_path=pg_catalog,public,pg_temp AS $$
  SELECT '['||to_jsonb('nfl'::text)::text||','||to_jsonb(p_season)::text||','||to_jsonb(p_external)::text||']'
$$;
-- JSON strings are serialized individually. Never remove whitespace inside an ID.
ALTER TABLE public.league_source_connections ADD COLUMN native_namespace text NOT NULL DEFAULT 'nfl';
ALTER TABLE public.league_source_mapping_revisions ADD COLUMN native_namespace text NOT NULL DEFAULT 'nfl';
ALTER TABLE public.league_source_connection_history ADD COLUMN native_namespace text NOT NULL DEFAULT 'nfl',
  ADD COLUMN previous_native_namespace text;
ALTER TABLE public.league_season_teams ADD COLUMN source_league_namespace text NOT NULL DEFAULT 'nfl',
  ADD COLUMN native_namespace text;
ALTER TABLE public.league_source_connections ALTER COLUMN native_namespace DROP DEFAULT;
ALTER TABLE public.league_source_mapping_revisions ALTER COLUMN native_namespace DROP DEFAULT;
ALTER TABLE public.league_source_connection_history ALTER COLUMN native_namespace DROP DEFAULT;
ALTER TABLE public.league_season_teams ALTER COLUMN source_league_namespace DROP DEFAULT;

CREATE FUNCTION public.guard_canonical_namespace_initialization() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE expected text;
BEGIN
  IF TG_OP<>'UPDATE' THEN RAISE EXCEPTION 'namespace initialization is update-only'; END IF;
  IF TG_TABLE_NAME='league_season_teams' THEN
    SELECT public.canonical_legacy_team_namespace(season.season,OLD.external_league_id) INTO STRICT expected
      FROM public.league_seasons season WHERE season.id=OLD.league_season_id;
    IF OLD.provider<>'sleeper' OR OLD.source_league_namespace<>'nfl' OR OLD.native_namespace IS NOT NULL
      OR NEW.native_namespace IS DISTINCT FROM expected
      OR to_jsonb(NEW)-'native_namespace' IS DISTINCT FROM to_jsonb(OLD)-'native_namespace' THEN
      RAISE EXCEPTION 'team namespace initialization changed original identity'; END IF;
  ELSIF TG_TABLE_NAME='league_source_connection_history' THEN
    expected:=CASE WHEN OLD.previous_external_league_id IS NULL THEN NULL ELSE 'nfl' END;
    IF OLD.provider<>'sleeper' OR OLD.native_namespace<>'nfl' OR OLD.previous_native_namespace IS NOT NULL
      OR NEW.previous_native_namespace IS DISTINCT FROM expected
      OR to_jsonb(NEW)-'previous_native_namespace' IS DISTINCT FROM to_jsonb(OLD)-'previous_native_namespace' THEN
      RAISE EXCEPTION 'history namespace initialization changed original evidence'; END IF;
  ELSE RAISE EXCEPTION 'unexpected namespace initialization relation'; END IF;
  RETURN NEW;
END; $$;
DROP TRIGGER immutable_history ON public.league_season_teams;
CREATE TRIGGER immutable_history BEFORE UPDATE OR DELETE ON public.league_season_teams
  FOR EACH ROW EXECUTE FUNCTION public.guard_canonical_namespace_initialization();
DROP TRIGGER immutable_history ON public.league_source_connection_history;
CREATE TRIGGER immutable_history BEFORE UPDATE OR DELETE ON public.league_source_connection_history
  FOR EACH ROW EXECUTE FUNCTION public.guard_canonical_namespace_initialization();
UPDATE public.league_season_teams team SET native_namespace=public.canonical_legacy_team_namespace(season.season,team.external_league_id)
  FROM public.league_seasons season WHERE season.id=team.league_season_id;
UPDATE public.league_source_connection_history SET previous_native_namespace='nfl' WHERE previous_external_league_id IS NOT NULL;
DO $$ BEGIN
  IF EXISTS((SELECT kind,id,original FROM canonical_identity_initialization_before EXCEPT
    (SELECT 'team',id,to_jsonb(team)-ARRAY['native_namespace','source_league_namespace'] FROM public.league_season_teams team
     UNION ALL SELECT 'history',id,to_jsonb(history)-ARRAY['native_namespace','previous_native_namespace'] FROM public.league_source_connection_history history
     UNION ALL SELECT 'connection',id,to_jsonb(connection)-'native_namespace' FROM public.league_source_connections connection
     UNION ALL SELECT 'revision',id,to_jsonb(revision)-'native_namespace' FROM public.league_source_mapping_revisions revision)))
    OR EXISTS((SELECT 'team',id,to_jsonb(team)-ARRAY['native_namespace','source_league_namespace'] FROM public.league_season_teams team
      UNION ALL SELECT 'history',id,to_jsonb(history)-ARRAY['native_namespace','previous_native_namespace'] FROM public.league_source_connection_history history
      UNION ALL SELECT 'connection',id,to_jsonb(connection)-'native_namespace' FROM public.league_source_connections connection
      UNION ALL SELECT 'revision',id,to_jsonb(revision)-'native_namespace' FROM public.league_source_mapping_revisions revision)
      EXCEPT SELECT kind,id,original FROM canonical_identity_initialization_before) THEN
    RAISE EXCEPTION 'namespace initialization failed original-row equality'; END IF;
END; $$;
DROP TRIGGER immutable_history ON public.league_season_teams;
CREATE TRIGGER immutable_history BEFORE UPDATE OR DELETE ON public.league_season_teams
  FOR EACH ROW EXECUTE FUNCTION public.prevent_league_administration_history_change();
DROP TRIGGER immutable_history ON public.league_source_connection_history;
CREATE TRIGGER immutable_history BEFORE UPDATE OR DELETE ON public.league_source_connection_history
  FOR EACH ROW EXECUTE FUNCTION public.prevent_league_administration_history_change();
DROP FUNCTION public.guard_canonical_namespace_initialization();
ALTER TABLE public.league_season_teams ALTER COLUMN native_namespace SET NOT NULL;
ALTER TABLE public.league_source_connections ADD CHECK (btrim(native_namespace)<>'');
ALTER TABLE public.league_source_mapping_revisions ADD CHECK (btrim(native_namespace)<>'');
ALTER TABLE public.league_source_connection_history ADD CHECK (btrim(native_namespace)<>''),
  ADD CHECK ((previous_native_namespace IS NULL)=(previous_external_league_id IS NULL)),
  ADD CHECK (previous_native_namespace IS NULL OR btrim(previous_native_namespace)<>'');
ALTER TABLE public.league_season_teams ADD CHECK (btrim(source_league_namespace)<>'' AND btrim(native_namespace)<>'');
DO $$ DECLARE item record; BEGIN
  FOR item IN SELECT conname,conrelid::regclass AS relation FROM pg_constraint
    WHERE contype='u' AND ((conrelid='public.league_source_connections'::regclass
      AND conkey=ARRAY[(SELECT attnum FROM pg_attribute WHERE attrelid=conrelid AND attname='provider'),
        (SELECT attnum FROM pg_attribute WHERE attrelid=conrelid AND attname='external_league_id')]::smallint[])
      OR (conrelid='public.league_season_teams'::regclass
        AND conkey=ARRAY[(SELECT attnum FROM pg_attribute WHERE attrelid=conrelid AND attname='league_season_id'),
          (SELECT attnum FROM pg_attribute WHERE attrelid=conrelid AND attname='provider'),
          (SELECT attnum FROM pg_attribute WHERE attrelid=conrelid AND attname='external_league_id'),
          (SELECT attnum FROM pg_attribute WHERE attrelid=conrelid AND attname='external_roster_id')]::smallint[]))
  LOOP EXECUTE format('ALTER TABLE %s DROP CONSTRAINT %I',item.relation,item.conname); END LOOP;
END; $$;
ALTER TABLE public.league_source_connections ADD CONSTRAINT canonical_source_qualified_key
  UNIQUE(provider,native_namespace,external_league_id);
ALTER TABLE public.league_season_teams ADD CONSTRAINT canonical_team_qualified_key
  UNIQUE(league_season_id,provider,source_league_namespace,external_league_id,native_namespace,external_roster_id),
  ADD CONSTRAINT canonical_team_content_identity_key
  UNIQUE(id,league_season_id,provider,source_league_namespace,external_league_id,native_namespace,external_roster_id);
ALTER TABLE public.league_administration_enrollments DROP CONSTRAINT league_administration_enrollments_provider_check,
  ADD CHECK(provider ~ '^[a-z][a-z0-9-]{0,63}$');
ALTER TABLE public.league_administration_enrollment_seasons DROP CONSTRAINT league_administration_enrollment_seasons_provider_check,
  ADD CHECK(provider ~ '^[a-z][a-z0-9-]{0,63}$');
ALTER TABLE public.league_season_teams DROP CONSTRAINT league_season_teams_provider_check,
  ADD CHECK(provider ~ '^[a-z][a-z0-9-]{0,63}$');
-- I06: retained server-verified registration context belongs to each actual new
-- mutation. Old rows remain NULL; no context is copied onto historical rows.
ALTER TABLE public.league_source_connections ADD COLUMN canonical_registration_context jsonb;
ALTER TABLE public.league_administration_enrollments ADD COLUMN canonical_registration_context jsonb;
ALTER TABLE public.league_administration_enrollment_seasons ADD COLUMN canonical_registration_context jsonb;

CREATE FUNCTION public.canonical_jsonb_hash(p_domain jsonb) RETURNS text
LANGUAGE sql IMMUTABLE STRICT SET search_path=pg_catalog,public,pg_temp AS $$
  SELECT 'sha256:'||encode(public.digest(convert_to(p_domain::text,'UTF8'),'sha256'),'hex')
$$;
CREATE FUNCTION public.assert_canonical_job_fence(p_fence jsonb) RETURNS void
LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
  IF jsonb_typeof(p_fence) IS DISTINCT FROM 'object'
    OR p_fence-ARRAY['jobKey','workerId','generation','deadlineAt']<>'{}'::jsonb
    OR NOT p_fence ?& ARRAY['jobKey','workerId','generation','deadlineAt']
    OR jsonb_typeof(p_fence->'jobKey') IS DISTINCT FROM 'string' OR btrim(p_fence->>'jobKey')=''
    OR jsonb_typeof(p_fence->'workerId') IS DISTINCT FROM 'string' OR btrim(p_fence->>'workerId')=''
    OR jsonb_typeof(p_fence->'generation') IS DISTINCT FROM 'number' OR (p_fence->>'generation') !~ '^[1-9][0-9]*$'
    OR jsonb_typeof(p_fence->'deadlineAt') IS DISTINCT FROM 'string' THEN RAISE EXCEPTION 'invalid canonical job fence'; END IF;
  PERFORM 1 FROM public.projection_jobs job WHERE job.job_key=p_fence->>'jobKey' AND job.state='running'
    AND job.lease_owner=p_fence->>'workerId' AND job.attempt_count=(p_fence->>'generation')::integer
    AND job.lease_until>clock_timestamp() AND (p_fence->>'deadlineAt')::timestamptz>clock_timestamp() FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'canonical job fence is stale'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.projection_jobs job WHERE job.job_key=p_fence->>'jobKey' AND job.state='running'
    AND job.lease_owner=p_fence->>'workerId' AND job.attempt_count=(p_fence->>'generation')::integer
    AND job.lease_until>clock_timestamp() AND (p_fence->>'deadlineAt')::timestamptz>clock_timestamp()) THEN
    RAISE EXCEPTION 'canonical job fence expired after wait'; END IF;
END; $$;
-- Deployment-owned policy. An isolated source-pinned overlay may enumerate other
-- exact tuples; there is no caller flag, runtime registry or provider wildcard.
CREATE FUNCTION public.canonical_source_namespace_policy(p_source jsonb,p_season integer) RETURNS jsonb
LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
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

CREATE FUNCTION public.guard_canonical_source_connection_identity() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE season_value integer; owner_name name;
BEGIN
  IF TG_OP='UPDATE' THEN
    IF NEW.canonical_registration_context IS DISTINCT FROM OLD.canonical_registration_context THEN
      RAISE EXCEPTION 'source registration context is immutable'; END IF;
  ELSIF NEW.canonical_registration_context IS NOT NULL THEN
    SELECT pg_get_userbyid(proowner) INTO STRICT owner_name FROM pg_proc
      WHERE oid='public.register_canonical_official_source(jsonb,jsonb,jsonb)'::regprocedure;
    IF current_user<>owner_name THEN RAISE EXCEPTION 'registration context requires the guarded owner entry'; END IF;
  END IF;
  IF TG_OP='INSERT' AND NEW.provider='sleeper' AND NEW.native_namespace IS NULL THEN NEW.native_namespace:='nfl'; END IF;
  -- The invoker branch must not execute a private helper under runtime rights.
  IF NEW.provider='sleeper' AND NEW.native_namespace='nfl' THEN
    IF btrim(NEW.external_league_id)='' OR NEW.external_league_id ~ '[[:cntrl:]]' THEN
      RAISE EXCEPTION 'invalid legacy source identity text'; END IF;
    RETURN NEW;
  END IF;
  SELECT season INTO STRICT season_value FROM public.league_seasons WHERE id=NEW.league_season_id;
  PERFORM public.canonical_source_namespace_policy(jsonb_build_object('provider',NEW.provider,'resourceKind','league',
    'nativeNamespace',NEW.native_namespace,'nativeId',NEW.external_league_id),season_value);
  SELECT pg_get_userbyid(proowner) INTO STRICT owner_name FROM pg_proc
    WHERE oid='public.register_canonical_official_source(jsonb,jsonb,jsonb)'::regprocedure;
  IF current_user<>owner_name THEN
    RAISE EXCEPTION 'nonlegacy source requires guarded registration owner'; END IF;
  IF TG_OP='INSERT' AND NEW.canonical_registration_context IS NULL THEN
    RAISE EXCEPTION 'nonlegacy source requires retained registration context'; END IF;
  RETURN NEW;
END; $$;
-- Invoker context is essential: direct runtime DML must not look like the owner.
CREATE TRIGGER a_guard_canonical_source_identity BEFORE INSERT OR UPDATE ON public.league_source_connections
  FOR EACH ROW EXECUTE FUNCTION public.guard_canonical_source_connection_identity();

CREATE FUNCTION public.fill_canonical_legacy_identity_namespaces() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE season_value integer; expected text;
BEGIN
  IF NEW.provider='sleeper' THEN
    IF TG_TABLE_NAME='league_season_teams' THEN
      SELECT season INTO STRICT season_value FROM public.league_seasons WHERE id=NEW.league_season_id;
      expected:=public.canonical_legacy_team_namespace(season_value,NEW.external_league_id);
      IF NEW.source_league_namespace IS NULL THEN NEW.source_league_namespace:='nfl'; END IF;
      IF NEW.native_namespace IS NULL AND NEW.source_league_namespace='nfl' THEN NEW.native_namespace:=expected; END IF;
    ELSE
      IF NEW.native_namespace IS NULL THEN NEW.native_namespace:='nfl'; END IF;
      IF TG_TABLE_NAME='league_source_connection_history' THEN
        IF NEW.previous_external_league_id IS NOT NULL AND NEW.previous_native_namespace IS NULL THEN
          NEW.previous_native_namespace:='nfl'; END IF;
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER a_fill_canonical_legacy_namespaces BEFORE INSERT ON public.league_season_teams
  FOR EACH ROW EXECUTE FUNCTION public.fill_canonical_legacy_identity_namespaces();
CREATE TRIGGER a_fill_canonical_legacy_namespaces BEFORE INSERT ON public.league_source_mapping_revisions
  FOR EACH ROW EXECUTE FUNCTION public.fill_canonical_legacy_identity_namespaces();
CREATE TRIGGER a_fill_canonical_legacy_namespaces BEFORE INSERT ON public.league_source_connection_history
  FOR EACH ROW EXECUTE FUNCTION public.fill_canonical_legacy_identity_namespaces();

CREATE FUNCTION public.guard_canonical_team_identity() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE season_value integer; policy jsonb; owner_name name;
BEGIN
  SELECT season INTO STRICT season_value FROM public.league_seasons WHERE id=NEW.league_season_id;
  policy:=public.canonical_source_namespace_policy(jsonb_build_object('provider',NEW.provider,'resourceKind','league',
    'nativeNamespace',NEW.source_league_namespace,'nativeId',NEW.external_league_id),season_value);
  IF NEW.native_namespace IS DISTINCT FROM policy->>'teamNamespace' THEN RAISE EXCEPTION 'team namespace policy mismatch'; END IF;
  SELECT pg_get_userbyid(proowner) INTO STRICT owner_name FROM pg_proc
    WHERE oid='public.register_canonical_official_source(jsonb,jsonb,jsonb)'::regprocedure;
  IF (NEW.provider<>'sleeper' OR NEW.source_league_namespace<>'nfl') AND current_user<>owner_name THEN
    RAISE EXCEPTION 'nonlegacy team requires verified owner materialization'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.league_source_mapping_revisions revision
    WHERE revision.league_season_id=NEW.league_season_id AND revision.provider=NEW.provider
      AND revision.native_namespace=NEW.source_league_namespace AND revision.external_league_id=NEW.external_league_id) THEN
    RAISE EXCEPTION 'team has no matching source revision'; END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER b_guard_canonical_team_identity BEFORE INSERT ON public.league_season_teams
  FOR EACH ROW EXECUTE FUNCTION public.guard_canonical_team_identity();

CREATE FUNCTION public.guard_canonical_enrollment_identity() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE owner_name name;
BEGIN
  SELECT pg_get_userbyid(proowner) INTO STRICT owner_name FROM pg_proc
    WHERE oid='public.register_canonical_official_source(jsonb,jsonb,jsonb)'::regprocedure;
  IF TG_OP='UPDATE' THEN
    IF NEW.canonical_registration_context IS DISTINCT FROM OLD.canonical_registration_context
      OR NEW.league_id IS DISTINCT FROM OLD.league_id OR NEW.provider IS DISTINCT FROM OLD.provider THEN
      RAISE EXCEPTION 'enrollment identity and registration context are immutable'; END IF;
  ELSIF NEW.canonical_registration_context IS NOT NULL AND current_user<>owner_name THEN
    RAISE EXCEPTION 'enrollment registration context requires the guarded owner entry';
  END IF;
  IF NEW.provider<>'sleeper' AND current_user<>owner_name THEN RAISE EXCEPTION 'nonlegacy enrollment requires guarded owner'; END IF;
  IF TG_OP='INSERT' AND (NEW.provider<>'sleeper' OR NEW.evidence='canonical-official-data-v1')
    AND NEW.canonical_registration_context IS NULL THEN RAISE EXCEPTION 'official enrollment requires retained registration context'; END IF;
  IF TG_TABLE_NAME='league_administration_enrollments' THEN
    IF NEW.evidence='canonical-official-data-v1' AND NEW.active THEN
      RAISE EXCEPTION 'official-only enrollment cannot activate publication'; END IF;
  END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER guard_canonical_enrollment_identity BEFORE INSERT OR UPDATE ON public.league_administration_enrollments
  FOR EACH ROW EXECUTE FUNCTION public.guard_canonical_enrollment_identity();
CREATE TRIGGER guard_canonical_enrollment_identity BEFORE INSERT ON public.league_administration_enrollment_seasons
  FOR EACH ROW EXECUTE FUNCTION public.guard_canonical_enrollment_identity();
CREATE FUNCTION public.validate_canonical_enrollment_parent() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE connection record; matched boolean:=false;
BEGIN
  FOR connection IN SELECT source.*,season.season FROM public.league_source_connections source
    JOIN public.league_seasons season ON season.id=source.league_season_id
    WHERE season.league_id=NEW.league_id AND source.provider=NEW.provider
      AND (TG_TABLE_NAME='league_administration_enrollments' OR season.season=(to_jsonb(NEW)->>'season')::integer)
  LOOP
    PERFORM public.canonical_source_namespace_policy(jsonb_build_object('provider',connection.provider,'resourceKind','league',
      'nativeNamespace',connection.native_namespace,'nativeId',connection.external_league_id),connection.season);
    matched:=true;
  END LOOP;
  -- Legacy intended membership may precede its source (strict readers report that
  -- unavailable state). A new nonlegacy identity must have its final parent.
  IF NEW.provider<>'sleeper' AND NOT matched THEN RAISE EXCEPTION 'canonical enrollment has no matching source'; END IF;
  RETURN NEW;
END; $$;
CREATE CONSTRAINT TRIGGER canonical_enrollment_identity AFTER INSERT OR UPDATE ON public.league_administration_enrollments
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.validate_canonical_enrollment_parent();
CREATE CONSTRAINT TRIGGER canonical_enrollment_identity AFTER INSERT ON public.league_administration_enrollment_seasons
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.validate_canonical_enrollment_parent();

CREATE OR REPLACE FUNCTION public.guard_league_source_connection_history() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'source connections require an evidenced owner remap'; END IF;
  IF TG_OP='UPDATE' AND (NEW.league_season_id IS DISTINCT FROM OLD.league_season_id OR NEW.provider IS DISTINCT FROM OLD.provider) THEN
    RAISE EXCEPTION 'source connection season and provider are immutable'; END IF;
  IF TG_OP='UPDATE' AND (NEW.external_league_id IS DISTINCT FROM OLD.external_league_id
    OR NEW.native_namespace IS DISTINCT FROM OLD.native_namespace) THEN
    IF NOT EXISTS(SELECT 1 FROM public.league_source_connection_history history
      WHERE history.league_season_id=OLD.league_season_id AND history.provider=OLD.provider
        AND history.previous_external_league_id=OLD.external_league_id AND history.previous_native_namespace=OLD.native_namespace
        AND history.external_league_id=NEW.external_league_id AND history.native_namespace=NEW.native_namespace
        AND history.transaction_id=txid_current()) THEN RAISE EXCEPTION 'source connections require an evidenced owner remap'; END IF;
  ELSIF TG_OP='INSERT' THEN
    IF EXISTS(SELECT 1 FROM public.league_seasons season
      JOIN public.league_administration_enrollments enrollment ON enrollment.league_id=season.league_id
      WHERE season.id=NEW.league_season_id)
      AND NOT EXISTS(SELECT 1 FROM public.league_source_connection_history history
        WHERE history.league_season_id=NEW.league_season_id AND history.provider=NEW.provider
          AND history.external_league_id=NEW.external_league_id AND history.native_namespace=NEW.native_namespace
          AND history.transaction_id=txid_current()) THEN
      RAISE EXCEPTION 'enrolled league annual source requires evidenced owner continuity approval'; END IF;
    IF EXISTS(SELECT 1 FROM public.league_source_connection_history history
      WHERE history.league_season_id=NEW.league_season_id AND history.provider=NEW.provider
        AND history.external_league_id=NEW.external_league_id AND history.native_namespace=NEW.native_namespace
        AND history.transaction_id=txid_current()) THEN RETURN NEW; END IF;
    INSERT INTO public.league_source_connection_history(league_season_id,provider,native_namespace,external_league_id,evidence)
      VALUES(NEW.league_season_id,NEW.provider,NEW.native_namespace,NEW.external_league_id,'registered season source connection');
  END IF;
  RETURN NEW;
END; $$;
CREATE OR REPLACE FUNCTION public.guard_source_mapping_pointer() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE revision public.league_source_mapping_revisions%ROWTYPE;
BEGIN
  IF TG_OP='INSERT' THEN
    NEW.id:=gen_random_uuid(); NEW.mapping_generation:=1; NEW.current_mapping_revision_id:=gen_random_uuid(); RETURN NEW;
  END IF;
  IF NEW.id IS DISTINCT FROM OLD.id THEN RAISE EXCEPTION 'source connection identity is immutable'; END IF;
  IF NEW.mapping_generation IS NOT DISTINCT FROM OLD.mapping_generation
    AND NEW.current_mapping_revision_id IS NOT DISTINCT FROM OLD.current_mapping_revision_id
    AND NEW.external_league_id IS NOT DISTINCT FROM OLD.external_league_id
    AND NEW.native_namespace IS NOT DISTINCT FROM OLD.native_namespace THEN RETURN NEW; END IF;
  SELECT * INTO revision FROM public.league_source_mapping_revisions
    WHERE id=NEW.current_mapping_revision_id AND transaction_id=txid_current();
  IF revision.id IS NULL OR revision.connection_id<>OLD.id OR revision.league_season_id<>OLD.league_season_id
    OR revision.provider<>OLD.provider OR revision.external_league_id<>NEW.external_league_id
    OR revision.native_namespace<>NEW.native_namespace OR revision.generation<>OLD.mapping_generation+1
    OR NEW.mapping_generation<>revision.generation OR revision.previous_revision_id IS DISTINCT FROM OLD.current_mapping_revision_id THEN
    RAISE EXCEPTION 'source mapping pointer requires an evidenced owner revision'; END IF;
  RETURN NEW;
END; $$;
CREATE OR REPLACE FUNCTION public.record_initial_source_mapping_revision() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE history_row public.league_source_connection_history%ROWTYPE; history_count integer; season_value integer; policy jsonb;
BEGIN
  SELECT count(*) INTO history_count FROM public.league_source_connection_history
    WHERE league_season_id=NEW.league_season_id AND provider=NEW.provider AND native_namespace=NEW.native_namespace
      AND external_league_id=NEW.external_league_id AND transaction_id=txid_current();
  IF history_count<>1 THEN RAISE EXCEPTION 'initial mapping history is ambiguous'; END IF;
  SELECT * INTO STRICT history_row FROM public.league_source_connection_history
    WHERE league_season_id=NEW.league_season_id AND provider=NEW.provider AND native_namespace=NEW.native_namespace
      AND external_league_id=NEW.external_league_id AND transaction_id=txid_current();
  SELECT season INTO STRICT season_value FROM public.league_seasons WHERE id=NEW.league_season_id;
  policy:=public.canonical_source_namespace_policy(jsonb_build_object('provider',NEW.provider,'resourceKind','league',
    'nativeNamespace',NEW.native_namespace,'nativeId',NEW.external_league_id),season_value);
  INSERT INTO public.league_source_mapping_revisions
    (id,connection_id,league_season_id,provider,native_namespace,external_league_id,source_namespace,generation,history_id,evidence)
  VALUES(NEW.current_mapping_revision_id,NEW.id,NEW.league_season_id,NEW.provider,NEW.native_namespace,NEW.external_league_id,
    policy->>'sourceNamespace',1,history_row.id,history_row.evidence);
  RETURN NEW;
END; $$;

CREATE FUNCTION public.revise_canonical_source_connection(p_season_id uuid,p_provider text,p_expected_revision_id uuid,
  p_native_namespace text,p_external_id text,p_evidence text) RETURNS uuid
LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE connection public.league_source_connections%ROWTYPE; prior public.league_source_mapping_revisions%ROWTYPE;
  revision_id uuid:=gen_random_uuid(); history_id uuid; season_value integer; policy jsonb;
BEGIN
  IF btrim(COALESCE(p_evidence,''))='' OR btrim(COALESCE(p_external_id,''))='' OR p_expected_revision_id IS NULL THEN
    RAISE EXCEPTION 'source revision requires evidence and target'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('league-configuration:'||p_season_id::text,0));
  SELECT * INTO STRICT connection FROM public.league_source_connections
    WHERE league_season_id=p_season_id AND provider=p_provider FOR UPDATE;
  SELECT season INTO STRICT season_value FROM public.league_seasons WHERE id=p_season_id;
  policy:=public.canonical_source_namespace_policy(jsonb_build_object('provider',p_provider,'resourceKind','league',
    'nativeNamespace',p_native_namespace,'nativeId',p_external_id),season_value);
  IF connection.current_mapping_revision_id IS DISTINCT FROM p_expected_revision_id THEN
    SELECT * INTO STRICT prior FROM public.league_source_mapping_revisions WHERE id=connection.current_mapping_revision_id;
    IF prior.previous_revision_id=p_expected_revision_id AND prior.external_league_id=p_external_id
      AND prior.native_namespace=p_native_namespace AND prior.evidence=p_evidence THEN RETURN prior.id; END IF;
    RAISE EXCEPTION 'source revision compare-and-swap conflict';
  END IF;
  INSERT INTO public.league_source_connection_history
    (league_season_id,provider,previous_external_league_id,previous_native_namespace,external_league_id,native_namespace,evidence)
  VALUES(p_season_id,p_provider,connection.external_league_id,connection.native_namespace,p_external_id,p_native_namespace,p_evidence)
    RETURNING id INTO history_id;
  INSERT INTO public.league_source_mapping_revisions
    (id,connection_id,league_season_id,provider,native_namespace,external_league_id,source_namespace,generation,
      previous_revision_id,history_id,evidence)
  VALUES(revision_id,connection.id,p_season_id,p_provider,p_native_namespace,p_external_id,policy->>'sourceNamespace',
    connection.mapping_generation+1,connection.current_mapping_revision_id,history_id,p_evidence);
  UPDATE public.league_source_connections SET external_league_id=p_external_id,native_namespace=p_native_namespace,
    connected_at=clock_timestamp(),mapping_generation=connection.mapping_generation+1,current_mapping_revision_id=revision_id
    WHERE league_season_id=p_season_id AND provider=p_provider;
  UPDATE public.league_administration_heads SET read_conflict='source_connection_remapped',generation=generation+1
    WHERE league_season_id=p_season_id;
  RETURN revision_id;
END; $$;
-- Old owner signatures remain exact Sleeper/nfl wrappers. Generic provider input
-- through an old definer must never become a registration/namespace escape.
CREATE OR REPLACE FUNCTION public.revise_league_source_connection(
  p_season_id uuid,p_provider text,p_expected_revision_id uuid,p_external_id text,p_evidence text) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
  IF p_provider IS DISTINCT FROM 'sleeper' OR NOT EXISTS(SELECT 1 FROM public.league_source_connections
    WHERE league_season_id=p_season_id AND provider='sleeper' AND native_namespace='nfl') THEN
    RAISE EXCEPTION 'legacy source revision requires Sleeper nfl'; END IF;
  RETURN public.revise_canonical_source_connection(p_season_id,p_provider,p_expected_revision_id,'nfl',p_external_id,p_evidence);
END; $$;
CREATE OR REPLACE FUNCTION public.remap_league_source_connection(
  p_season_id uuid,p_provider text,p_expected_external_id text,p_external_id text,p_evidence text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE connection public.league_source_connections%ROWTYPE;
BEGIN
  IF p_provider IS DISTINCT FROM 'sleeper' OR btrim(COALESCE(p_evidence,''))='' OR btrim(COALESCE(p_external_id,''))='' THEN
    RAISE EXCEPTION 'legacy source remap requires Sleeper target and evidence'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('league-configuration:'||p_season_id::text,0));
  SELECT * INTO STRICT connection FROM public.league_source_connections
    WHERE league_season_id=p_season_id AND provider='sleeper' AND native_namespace='nfl' FOR UPDATE;
  IF connection.external_league_id IS DISTINCT FROM p_expected_external_id THEN RAISE EXCEPTION 'source remap compare-and-swap conflict'; END IF;
  IF connection.external_league_id=p_external_id THEN RETURN; END IF;
  PERFORM public.revise_canonical_source_connection(p_season_id,'sleeper',connection.current_mapping_revision_id,'nfl',p_external_id,p_evidence);
END; $$;

CREATE FUNCTION public.validate_canonical_resource_mapping(p_mapping jsonb) RETURNS void
LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE policy jsonb;
BEGIN
  IF jsonb_typeof(p_mapping) IS DISTINCT FROM 'object' OR NOT p_mapping ?& ARRAY['connectionId','leagueSeasonId','revisionId','generation','scope','sourceNamespace']
    OR p_mapping-ARRAY['connectionId','leagueSeasonId','revisionId','generation','scope','sourceNamespace']<>'{}'::jsonb
    OR jsonb_typeof(p_mapping->'scope') IS DISTINCT FROM 'object'
    OR p_mapping->>'connectionId' IS DISTINCT FROM ((p_mapping->>'connectionId')::uuid)::text
    OR p_mapping->>'leagueSeasonId' IS DISTINCT FROM ((p_mapping->>'leagueSeasonId')::uuid)::text
    OR p_mapping->>'revisionId' IS DISTINCT FROM ((p_mapping->>'revisionId')::uuid)::text
    OR jsonb_typeof(p_mapping->'generation') IS DISTINCT FROM 'number' OR (p_mapping->>'generation') !~ '^[1-9][0-9]*$' THEN
    RAISE EXCEPTION 'invalid canonical source mapping'; END IF;
  policy:=public.canonical_source_namespace_policy(jsonb_build_object('provider',p_mapping->'scope'->>'provider','resourceKind','league',
    'nativeNamespace',p_mapping->'scope'->>'nativeNamespace','nativeId',p_mapping->'scope'->>'externalLeagueId'),
    (p_mapping->'scope'->>'season')::integer);
  IF p_mapping->>'sourceNamespace' IS DISTINCT FROM policy->>'sourceNamespace' THEN RAISE EXCEPTION 'mapping season namespace mismatch'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('league-configuration:'||((p_mapping->>'leagueSeasonId')::uuid)::text,0));
  PERFORM 1 FROM public.league_source_connections connection
    JOIN public.league_source_mapping_revisions revision ON revision.id=connection.current_mapping_revision_id
    JOIN public.league_seasons season ON season.id=connection.league_season_id
    JOIN public.leagues league ON league.id=season.league_id
    JOIN public.league_administration_enrollment_seasons enrollment
      ON enrollment.league_id=league.id AND enrollment.season=season.season AND enrollment.provider=connection.provider
    WHERE connection.id=(p_mapping->>'connectionId')::uuid AND connection.league_season_id=(p_mapping->>'leagueSeasonId')::uuid
      AND connection.current_mapping_revision_id=(p_mapping->>'revisionId')::uuid AND connection.mapping_generation=(p_mapping->>'generation')::bigint
      AND revision.connection_id=connection.id AND revision.league_season_id=connection.league_season_id
      AND revision.provider=connection.provider AND revision.native_namespace=connection.native_namespace
      AND revision.external_league_id=connection.external_league_id AND revision.generation=connection.mapping_generation
      AND revision.source_namespace=p_mapping->>'sourceNamespace'
      AND p_mapping->'scope'=jsonb_build_object('leagueKey',league.league_key,'season',season.season,'provider',connection.provider,
        'externalLeagueId',connection.external_league_id,'nativeNamespace',connection.native_namespace) FOR SHARE OF connection;
  IF NOT FOUND THEN RAISE EXCEPTION 'canonical source mapping is stale or invalid'; END IF;
END; $$;

-- Pre-mapping policy/verifier: an existing mapping is neither invented nor
-- required here. The isolated manifest may replace only this fixed dispatch.
CREATE FUNCTION public.canonical_registration_policy(p_input jsonb,p_work jsonb,p_fence jsonb) RETURNS jsonb
LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE capture jsonb:=p_input->'registrationCapture'; payload jsonb:=capture->'payload'; source jsonb:=p_input->'sourceLeague';
  started timestamptz; completed timestamptz; wanted_key text;
BEGIN
  PERFORM public.assert_canonical_job_fence(p_fence);
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
  -- Original DB witness/dispatch establishes causality. Application wall clocks
  -- have ordering and bounded-skew checks, not an invented DB-clock equality.
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
  RETURN jsonb_build_object('sourceLeague',source,'intendedLeagueKey',wanted_key,'season',2026,
    'registrationDigest',capture->>'sourceDigest');
END; $$;

CREATE FUNCTION public.register_canonical_official_source(p_input jsonb,p_work jsonb,p_fence jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE capture jsonb:=p_input->'registrationCapture'; source jsonb:=p_input->'sourceLeague'; policy jsonb; second_policy jsonb;
  connection public.league_source_connections%ROWTYPE; league_row public.leagues%ROWTYPE; season_row public.league_seasons%ROWTYPE;
  revision public.league_source_mapping_revisions%ROWTYPE; job public.projection_jobs%ROWTYPE;
  profile_id uuid; v_rules jsonb:=NULLIF(p_input->'scoringRules','null'::jsonb); profile_hash text; mapping jsonb; registration_context jsonb;
BEGIN
  IF jsonb_typeof(p_input) IS DISTINCT FROM 'object'
    OR NOT p_input ?& ARRAY['mode','leagueKey','leagueName','season','sourceLeague','registrationCapture']
    OR p_input-ARRAY['mode','leagueKey','leagueName','season','sourceLeague','registrationCapture','scoringRules']<>'{}'::jsonb
    OR p_input->>'mode' IS DISTINCT FROM 'official-data' OR p_input->'season' IS DISTINCT FROM '2026'::jsonb
    OR jsonb_typeof(p_input->'leagueKey') IS DISTINCT FROM 'string' OR btrim(p_input->>'leagueKey')='' OR (p_input->>'leagueKey') ~ '[[:cntrl:]]'
    OR jsonb_typeof(p_input->'leagueName') IS DISTINCT FROM 'string' OR btrim(p_input->>'leagueName')='' OR (p_input->>'leagueName') ~ '[[:cntrl:]]'
    OR jsonb_typeof(capture) IS DISTINCT FROM 'object'
    OR NOT capture ?& ARRAY['version','nativeKind','origin','payload','sourceDigest','requestStartedAt','requestCompletedAt','acquisition']
    OR capture-ARRAY['version','nativeKind','origin','payload','sourceDigest','requestStartedAt','requestCompletedAt','acquisition']<>'{}'::jsonb
    OR jsonb_typeof(capture->'version') IS DISTINCT FROM 'string' OR btrim(capture->>'version')=''
    OR jsonb_typeof(capture->'nativeKind') IS DISTINCT FROM 'string' OR btrim(capture->>'nativeKind')=''
    OR capture->>'origin' NOT IN ('network','fixture')
    OR jsonb_typeof(capture->'sourceDigest') IS DISTINCT FROM 'string'
    OR capture->>'sourceDigest' IS DISTINCT FROM public.canonical_jsonb_hash(jsonb_build_object('hashVersion','league-one-jsonb-sha256-v1',
      'representation','registration','nativeKind',capture->>'nativeKind','payload',capture->'payload'))
    OR v_rules IS NOT NULL AND (jsonb_typeof(v_rules)<>'object'
      OR EXISTS(SELECT 1 FROM jsonb_each(v_rules) field WHERE jsonb_typeof(field.value)<>'number')) THEN
    RAISE EXCEPTION 'invalid canonical official registration'; END IF;
  PERFORM public.assert_canonical_job_fence(p_fence);
  policy:=public.canonical_registration_policy(p_input,p_work,p_fence);
  IF policy->'sourceLeague' IS DISTINCT FROM source OR policy->>'intendedLeagueKey' IS DISTINCT FROM p_input->>'leagueKey'
    OR policy->'season' IS DISTINCT FROM p_input->'season' OR policy->>'registrationDigest' IS DISTINCT FROM capture->>'sourceDigest' THEN
    RAISE EXCEPTION 'canonical registration policy/source mismatch'; END IF;
  SELECT * INTO STRICT job FROM public.projection_jobs WHERE job_key=p_fence->>'jobKey';
  IF capture->>'origin'='fixture' AND (job.job_type<>'canonical-fixture-standings-v1' OR job.payload IS DISTINCT FROM policy
    OR p_work IS DISTINCT FROM job.payload OR NOT policy ?& ARRAY['fixturePolicyVersion','policy','sourceLeague','intendedLeagueKey','season','registrationDigest','standingsDigest']
    OR policy-ARRAY['fixturePolicyVersion','policy','sourceLeague','intendedLeagueKey','season','registrationDigest','standingsDigest']<>'{}'::jsonb) THEN
    RAISE EXCEPTION 'fixture registration does not match stored admitted work'; END IF;
  PERFORM public.canonical_source_namespace_policy(source,(p_input->>'season')::integer);
  -- One key-level lock serializes first creation without guessing a canonical UUID.
  PERFORM pg_advisory_xact_lock(hashtextextended('canonical-league-registration:'||(p_input->>'leagueKey'),0));
  PERFORM public.assert_canonical_job_fence(p_fence);
  second_policy:=public.canonical_registration_policy(p_input,p_work,p_fence);
  IF second_policy IS DISTINCT FROM policy THEN RAISE EXCEPTION 'registration authority changed after wait'; END IF;
  SELECT * INTO connection FROM public.league_source_connections WHERE provider=source->>'provider'
    AND native_namespace=source->>'nativeNamespace' AND external_league_id=source->>'nativeId';
  IF FOUND THEN
    SELECT * INTO STRICT season_row FROM public.league_seasons WHERE id=connection.league_season_id;
    SELECT * INTO STRICT league_row FROM public.leagues WHERE id=season_row.league_id;
    IF league_row.league_key IS DISTINCT FROM p_input->>'leagueKey' OR season_row.season<>(p_input->>'season')::integer THEN
      RAISE EXCEPTION 'qualified source is already bound to another canonical identity'; END IF;
    PERFORM pg_advisory_xact_lock(hashtextextended('league-configuration:'||season_row.id::text,0));
    SELECT * INTO STRICT connection FROM public.league_source_connections WHERE id=connection.id FOR SHARE;
    IF connection.provider IS DISTINCT FROM source->>'provider' OR connection.native_namespace IS DISTINCT FROM source->>'nativeNamespace'
      OR connection.external_league_id IS DISTINCT FROM source->>'nativeId' THEN RAISE EXCEPTION 'registration source changed after wait'; END IF;
  ELSE
    IF EXISTS(SELECT 1 FROM public.leagues WHERE league_key=p_input->>'leagueKey') THEN
      RAISE EXCEPTION 'new qualified source cannot attach to an existing unrelated league key'; END IF;
    INSERT INTO public.leagues(league_key,name) VALUES(p_input->>'leagueKey',p_input->>'leagueName') RETURNING * INTO league_row;
    IF v_rules IS NOT NULL AND v_rules<>'{}'::jsonb THEN
      SELECT id INTO profile_id FROM public.scoring_profiles WHERE rules=v_rules ORDER BY created_at,id LIMIT 1;
      IF profile_id IS NULL THEN
        SELECT encode(public.digest(convert_to('{'||string_agg(to_jsonb(key)::text||':'||value::text,',' ORDER BY key COLLATE "C")||'}','UTF8'),
          'sha256'),'hex') INTO profile_hash FROM jsonb_each(v_rules);
        profile_id:=public.get_or_create_scoring_profile(profile_hash,v_rules);
        IF NOT EXISTS(SELECT 1 FROM public.scoring_profiles WHERE id=profile_id AND rules=v_rules) THEN
          RAISE EXCEPTION 'canonical registration scoring hash collision'; END IF;
      END IF;
    END IF;
    INSERT INTO public.league_seasons(league_id,season,scoring_profile_id) VALUES(league_row.id,(p_input->>'season')::smallint,profile_id)
      RETURNING * INTO season_row;
    PERFORM pg_advisory_xact_lock(hashtextextended('league-configuration:'||season_row.id::text,0));
    registration_context:=jsonb_build_object('version','canonical-registration-context-v1','input',p_input,'work',p_work,
      'policy',policy,'fence',p_fence,'leagueId',league_row.id,'leagueSeasonId',season_row.id);
    INSERT INTO public.league_source_connections(league_season_id,provider,native_namespace,external_league_id,canonical_registration_context)
      VALUES(season_row.id,source->>'provider',source->>'nativeNamespace',source->>'nativeId',registration_context) RETURNING * INTO connection;
  END IF;
  -- Existing configured/account adoption is untouched. New official-only rows
  -- have their own evidence value and cannot enter strict publication inventory.
  registration_context:=jsonb_build_object('version','canonical-registration-context-v1','input',p_input,'work',p_work,
    'policy',policy,'fence',p_fence,'leagueId',league_row.id,'leagueSeasonId',season_row.id);
  INSERT INTO public.league_administration_enrollments(league_id,provider,active,evidence,canonical_registration_context)
    VALUES(league_row.id,source->>'provider',false,'canonical-official-data-v1',registration_context) ON CONFLICT DO NOTHING;
  INSERT INTO public.league_administration_enrollment_seasons(league_id,season,provider,evidence,canonical_registration_context)
    VALUES(league_row.id,season_row.season,source->>'provider','canonical-official-data-v1',registration_context) ON CONFLICT DO NOTHING;
  IF EXISTS(SELECT 1 FROM public.league_administration_enrollments WHERE league_id=league_row.id AND provider<>source->>'provider')
    OR EXISTS(SELECT 1 FROM public.league_administration_enrollment_seasons WHERE league_id=league_row.id AND season=season_row.season
      AND provider<>source->>'provider') THEN RAISE EXCEPTION 'canonical registration enrollment conflict'; END IF;
  SELECT * INTO STRICT revision FROM public.league_source_mapping_revisions WHERE id=connection.current_mapping_revision_id;
  mapping:=jsonb_build_object('connectionId',connection.id,'leagueSeasonId',season_row.id,'revisionId',revision.id,
    'generation',connection.mapping_generation,'scope',jsonb_build_object('provider',connection.provider,'leagueKey',league_row.league_key,
      'externalLeagueId',connection.external_league_id,'season',season_row.season,'nativeNamespace',connection.native_namespace),
    'sourceNamespace',revision.source_namespace);
  PERFORM public.validate_canonical_resource_mapping(mapping);
  PERFORM public.assert_canonical_job_fence(p_fence);
  IF public.canonical_registration_policy(p_input,p_work,p_fence) IS DISTINCT FROM policy THEN
    RAISE EXCEPTION 'canonical registration authority changed before acceptance'; END IF;
  RETURN jsonb_build_object('leagueId',league_row.id,'leagueSeasonId',season_row.id,'scoringProfileId',season_row.scoring_profile_id,'mapping',mapping);
END; $$;

CREATE FUNCTION public.validate_canonical_registration_commit() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE context_value jsonb:=NEW.canonical_registration_context; registration_input jsonb; source jsonb;
  connection public.league_source_connections%ROWTYPE; revision public.league_source_mapping_revisions%ROWTYPE;
  season_row public.league_seasons%ROWTYPE; league_row public.leagues%ROWTYPE; job public.projection_jobs%ROWTYPE;
BEGIN
  IF context_value IS NULL THEN RETURN NEW; END IF;
  IF jsonb_typeof(context_value) IS DISTINCT FROM 'object'
    OR NOT context_value ?& ARRAY['version','input','work','policy','fence','leagueId','leagueSeasonId']
    OR context_value-ARRAY['version','input','work','policy','fence','leagueId','leagueSeasonId']<>'{}'::jsonb
    OR context_value->>'version' IS DISTINCT FROM 'canonical-registration-context-v1'
    OR jsonb_typeof(context_value->'input') IS DISTINCT FROM 'object'
    OR jsonb_typeof(context_value->'policy') IS DISTINCT FROM 'object'
    OR jsonb_typeof(context_value->'leagueId') IS DISTINCT FROM 'string'
    OR jsonb_typeof(context_value->'leagueSeasonId') IS DISTINCT FROM 'string'
    OR context_value->>'leagueId' IS DISTINCT FROM ((context_value->>'leagueId')::uuid)::text
    OR context_value->>'leagueSeasonId' IS DISTINCT FROM ((context_value->>'leagueSeasonId')::uuid)::text THEN
    RAISE EXCEPTION 'invalid retained canonical registration context'; END IF;
  registration_input:=context_value->'input'; source:=registration_input->'sourceLeague';
  PERFORM public.assert_canonical_job_fence(context_value->'fence');
  IF registration_input->'registrationCapture'->>'sourceDigest' IS DISTINCT FROM public.canonical_jsonb_hash(jsonb_build_object(
    'hashVersion','league-one-jsonb-sha256-v1','representation','registration',
    'nativeKind',registration_input->'registrationCapture'->>'nativeKind','payload',registration_input->'registrationCapture'->'payload'))
    OR public.canonical_registration_policy(registration_input,context_value->'work',context_value->'fence') IS DISTINCT FROM context_value->'policy' THEN
    RAISE EXCEPTION 'registration authority or capture changed before commit'; END IF;
  SELECT * INTO STRICT job FROM public.projection_jobs WHERE job_key=context_value->'fence'->>'jobKey';
  IF registration_input->'registrationCapture'->>'origin'='fixture' AND (job.job_type<>'canonical-fixture-standings-v1'
    OR job.payload IS DISTINCT FROM context_value->'policy' OR context_value->'work' IS DISTINCT FROM job.payload) THEN
    RAISE EXCEPTION 'fixture registration work changed before commit'; END IF;
  SELECT * INTO STRICT season_row FROM public.league_seasons WHERE id=(context_value->>'leagueSeasonId')::uuid;
  SELECT * INTO STRICT league_row FROM public.leagues WHERE id=season_row.league_id;
  IF league_row.id IS DISTINCT FROM (context_value->>'leagueId')::uuid OR league_row.league_key IS DISTINCT FROM registration_input->>'leagueKey'
    OR season_row.season IS DISTINCT FROM (registration_input->>'season')::integer THEN
    RAISE EXCEPTION 'registration canonical parent changed before commit'; END IF;
  SELECT * INTO STRICT connection FROM public.league_source_connections WHERE league_season_id=season_row.id
    AND provider=source->>'provider' AND native_namespace=source->>'nativeNamespace' AND external_league_id=source->>'nativeId';
  IF TG_TABLE_NAME='league_source_connections' THEN
    SELECT * INTO STRICT revision FROM public.league_source_mapping_revisions
      WHERE connection_id=NEW.id AND generation=1 AND league_season_id=NEW.league_season_id
        AND provider=NEW.provider AND native_namespace=NEW.native_namespace AND external_league_id=NEW.external_league_id;
    IF NEW.id IS DISTINCT FROM connection.id OR connection.mapping_generation<>1 OR NEW.mapping_generation<>1
      OR NEW.current_mapping_revision_id IS DISTINCT FROM revision.id OR connection.current_mapping_revision_id IS DISTINCT FROM revision.id
      OR connection.canonical_registration_context IS DISTINCT FROM context_value THEN
      RAISE EXCEPTION 'new registration initial revision changed before commit'; END IF;
  ELSIF TG_TABLE_NAME='league_administration_enrollments' THEN
    IF NEW.league_id IS DISTINCT FROM league_row.id OR NEW.provider IS DISTINCT FROM source->>'provider'
      OR NOT EXISTS(SELECT 1 FROM public.league_administration_enrollments enrollment WHERE enrollment.league_id=NEW.league_id
        AND enrollment.provider=NEW.provider AND enrollment.canonical_registration_context=context_value) THEN
      RAISE EXCEPTION 'new registration enrollment changed before commit'; END IF;
  ELSIF TG_TABLE_NAME='league_administration_enrollment_seasons' THEN
    IF NEW.league_id IS DISTINCT FROM league_row.id OR NEW.provider IS DISTINCT FROM source->>'provider' OR NEW.season<>season_row.season
      OR NOT EXISTS(SELECT 1 FROM public.league_administration_enrollment_seasons enrollment WHERE enrollment.league_id=NEW.league_id
        AND enrollment.season=NEW.season AND enrollment.provider=NEW.provider AND enrollment.canonical_registration_context=context_value) THEN
      RAISE EXCEPTION 'new registration season enrollment changed before commit'; END IF;
  ELSE RAISE EXCEPTION 'unexpected canonical registration relation'; END IF;
  PERFORM public.assert_canonical_job_fence(context_value->'fence');
  RETURN NEW;
END; $$;
CREATE CONSTRAINT TRIGGER canonical_registration_commit AFTER INSERT ON public.league_source_connections
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.validate_canonical_registration_commit();
CREATE CONSTRAINT TRIGGER canonical_registration_commit AFTER INSERT ON public.league_administration_enrollments
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.validate_canonical_registration_commit();
CREATE CONSTRAINT TRIGGER canonical_registration_commit AFTER INSERT ON public.league_administration_enrollment_seasons
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.validate_canonical_registration_commit();

CREATE FUNCTION public.resolve_canonical_season_teams(p_mapping jsonb,p_source_league jsonb,p_source_teams jsonb,
  p_verified_capture_context jsonb) RETURNS jsonb
LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE attempt public.league_roster_resource_attempts%ROWTYPE; scope_row public.league_roster_resource_scopes%ROWTYPE;
  source_team jsonb; team_id uuid; result jsonb:='[]'::jsonb; expected_refs jsonb; policy jsonb;
BEGIN
  IF jsonb_typeof(p_verified_capture_context) IS DISTINCT FROM 'object'
    OR NOT p_verified_capture_context ?& ARRAY['attemptId','captureId','captureNonce','scopeId','policy','nativeHash','canonicalHash','canonicalValue']
    OR p_verified_capture_context-ARRAY['attemptId','captureId','captureNonce','scopeId','policy','nativeHash','canonicalHash','canonicalValue']<>'{}'::jsonb
    OR jsonb_typeof(p_verified_capture_context->'captureId') IS DISTINCT FROM 'string'
    OR p_verified_capture_context->>'captureId' IS DISTINCT FROM ((p_verified_capture_context->>'captureId')::uuid)::text
    OR jsonb_typeof(p_verified_capture_context->'nativeHash') IS DISTINCT FROM 'string'
    OR p_verified_capture_context->>'nativeHash' !~ '^sha256:[0-9a-f]{64}$'
    OR p_verified_capture_context->>'canonicalHash' IS DISTINCT FROM public.canonical_jsonb_hash(jsonb_build_object(
      'hashVersion','league-one-jsonb-sha256-v1','representation','canonical','canonicalSchemaVersion','league-one-official-standings-v1',
      'canonicalValue',p_verified_capture_context->'canonicalValue')) THEN RAISE EXCEPTION 'invalid verified team capture context'; END IF;
  SELECT * INTO STRICT attempt FROM public.league_roster_resource_attempts WHERE id=(p_verified_capture_context->>'attemptId')::uuid;
  SELECT * INTO STRICT scope_row FROM public.league_roster_resource_scopes WHERE id=attempt.scope_id;
  PERFORM public.assert_canonical_job_fence(attempt.write_fence);
  IF attempt.source_mapping IS DISTINCT FROM p_mapping OR attempt.scope_id::text IS DISTINCT FROM p_verified_capture_context->>'scopeId'
    OR attempt.capture_nonce::text IS DISTINCT FROM p_verified_capture_context->>'captureNonce'
    OR scope_row.identity->'policy' IS DISTINCT FROM p_verified_capture_context->'policy'
    OR scope_row.identity->'scope'->>'family' IS DISTINCT FROM 'standings'
    OR scope_row.connection_id IS DISTINCT FROM (p_mapping->>'connectionId')::uuid
    OR scope_row.league_season_id IS DISTINCT FROM (p_mapping->>'leagueSeasonId')::uuid THEN
    RAISE EXCEPTION 'verified team capture does not match stored attempt'; END IF;
  PERFORM public.validate_canonical_resource_mapping(p_mapping);
  IF p_source_league IS DISTINCT FROM jsonb_build_object('provider',p_mapping->'scope'->>'provider','resourceKind','league',
    'nativeNamespace',p_mapping->'scope'->>'nativeNamespace','nativeId',p_mapping->'scope'->>'externalLeagueId')
    OR jsonb_typeof(p_source_teams) IS DISTINCT FROM 'array' OR jsonb_array_length(p_source_teams)>20 THEN
    RAISE EXCEPTION 'verified team source scope mismatch'; END IF;
  SELECT COALESCE(jsonb_agg(item->'sourceTeam' ORDER BY ordinal),'[]'::jsonb) INTO expected_refs
    FROM jsonb_array_elements(p_verified_capture_context->'canonicalValue'->'teams') WITH ORDINALITY AS teams(item,ordinal);
  IF expected_refs IS DISTINCT FROM p_source_teams OR (SELECT count(*) FROM jsonb_array_elements(p_source_teams))
    <> (SELECT count(DISTINCT value) FROM jsonb_array_elements(p_source_teams)) THEN
    RAISE EXCEPTION 'duplicate or unverified canonical team references'; END IF;
  policy:=public.canonical_source_namespace_policy(p_source_league,(p_mapping->'scope'->>'season')::integer);
  FOR source_team IN SELECT value FROM jsonb_array_elements(p_source_teams) LOOP
    IF jsonb_typeof(source_team) IS DISTINCT FROM 'object'
      OR NOT source_team ?& ARRAY['provider','resourceKind','nativeNamespace','nativeId']
      OR source_team-ARRAY['provider','resourceKind','nativeNamespace','nativeId']<>'{}'::jsonb
      OR source_team->>'provider' IS DISTINCT FROM p_source_league->>'provider' OR source_team->>'resourceKind' IS DISTINCT FROM 'team'
      OR source_team->>'nativeNamespace' IS DISTINCT FROM policy->>'teamNamespace'
      OR jsonb_typeof(source_team->'nativeId') IS DISTINCT FROM 'string' OR btrim(source_team->>'nativeId')=''
      OR (source_team->>'nativeId') ~ '[[:cntrl:]]' THEN
      RAISE EXCEPTION 'unqualified canonical team reference'; END IF;
    INSERT INTO public.league_season_teams(league_season_id,provider,source_league_namespace,external_league_id,native_namespace,external_roster_id)
      VALUES((p_mapping->>'leagueSeasonId')::uuid,source_team->>'provider',p_source_league->>'nativeNamespace',
        p_source_league->>'nativeId',source_team->>'nativeNamespace',source_team->>'nativeId') ON CONFLICT DO NOTHING;
    SELECT id INTO STRICT team_id FROM public.league_season_teams WHERE league_season_id=(p_mapping->>'leagueSeasonId')::uuid
      AND provider=source_team->>'provider' AND source_league_namespace=p_source_league->>'nativeNamespace'
      AND external_league_id=p_source_league->>'nativeId' AND native_namespace=source_team->>'nativeNamespace'
      AND external_roster_id=source_team->>'nativeId';
    result:=result||jsonb_build_array(jsonb_build_object('sourceTeam',source_team,'seasonTeamId',team_id));
  END LOOP;
  PERFORM public.assert_canonical_job_fence(attempt.write_fence);
  RETURN result;
END; $$;

-- All helper privileges are explicit for both present roles and future role
-- provisioning. Only registration is a new runtime-callable identity entry.
DO $$ DECLARE signature text; role_name text; BEGIN
  FOREACH signature IN ARRAY ARRAY[
    'canonical_legacy_team_namespace(integer,text)','canonical_jsonb_hash(jsonb)','assert_canonical_job_fence(jsonb)',
    'canonical_source_namespace_policy(jsonb,integer)','guard_canonical_source_connection_identity()',
    'fill_canonical_legacy_identity_namespaces()','guard_canonical_team_identity()','guard_canonical_enrollment_identity()',
    'validate_canonical_enrollment_parent()','validate_canonical_registration_commit()',
    'revise_canonical_source_connection(uuid,text,uuid,text,text,text)',
    'validate_canonical_resource_mapping(jsonb)','canonical_registration_policy(jsonb,jsonb,jsonb)',
    'resolve_canonical_season_teams(jsonb,jsonb,jsonb,jsonb)','register_canonical_official_source(jsonb,jsonb,jsonb)'] LOOP
    EXECUTE 'REVOKE ALL ON FUNCTION public.'||signature||' FROM PUBLIC';
    FOREACH role_name IN ARRAY ARRAY['league_one_runtime','league_one_account','league_one_auth'] LOOP
      IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=role_name) THEN
        EXECUTE 'REVOKE ALL ON FUNCTION public.'||signature||' FROM '||quote_ident(role_name);
      END IF;
    END LOOP;
  END LOOP;
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='league_one_runtime') THEN
    GRANT EXECUTE ON FUNCTION public.register_canonical_official_source(jsonb,jsonb,jsonb) TO league_one_runtime;
  END IF;
END; $$;
