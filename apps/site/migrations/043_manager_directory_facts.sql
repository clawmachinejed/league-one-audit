-- CP7: official users.is_owner is a commissioner observation, independent of
-- roster owner_id/co_owners. Reuse the existing users writer and capture receipts.
-- No historical backfill, acceptance policy, acquisition or completion change.
CREATE TABLE public.league_manager_directory_versions (
  content_id uuid NOT NULL REFERENCES public.league_administration_contents(id),
  normalizer_version text NOT NULL CHECK(normalizer_version='sleeper-manager-directory-v1'),
  league_season_id uuid NOT NULL REFERENCES public.league_seasons(id),
  manager_count integer NOT NULL CHECK(manager_count>=0),
  PRIMARY KEY(content_id,normalizer_version),
  UNIQUE(content_id,normalizer_version,league_season_id)
);
CREATE TABLE public.league_manager_directory_entries (
  content_id uuid NOT NULL,
  normalizer_version text NOT NULL CHECK(normalizer_version='sleeper-manager-directory-v1'),
  manager_id uuid NOT NULL REFERENCES public.league_source_manager_accounts(id),
  league_season_id uuid NOT NULL,
  commissioner_state text NOT NULL CHECK(commissioner_state IN ('known','absent','null','invalid')),
  commissioner_value boolean,
  invalid_raw jsonb,
  source_value jsonb NOT NULL CHECK(jsonb_typeof(source_value)='object'),
  PRIMARY KEY(content_id,normalizer_version,manager_id),
  FOREIGN KEY(content_id,normalizer_version,league_season_id)
    REFERENCES public.league_manager_directory_versions(content_id,normalizer_version,league_season_id),
  FOREIGN KEY(content_id,manager_id) REFERENCES public.league_administration_manager_entries(content_id,manager_id),
  CHECK((commissioner_state='known' AND commissioner_value IS NOT NULL AND invalid_raw IS NULL)
    OR (commissioner_state IN ('absent','null') AND commissioner_value IS NULL AND invalid_raw IS NULL)
    OR (commissioner_state='invalid' AND commissioner_value IS NULL AND invalid_raw IS NOT NULL
      AND jsonb_typeof(invalid_raw) NOT IN ('boolean','null')))
);

CREATE FUNCTION public.project_manager_commissioner_fact(raw jsonb) RETURNS jsonb
LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,public,pg_temp AS $$
  SELECT CASE WHEN NOT raw ? 'is_owner' THEN jsonb_build_object('sourcePath','is_owner','state','absent','value',NULL)
    WHEN raw->'is_owner'='null'::jsonb THEN jsonb_build_object('sourcePath','is_owner','state','null','value',NULL)
    WHEN jsonb_typeof(raw->'is_owner')='boolean' THEN
      jsonb_build_object('sourcePath','is_owner','state','known','value',raw->'is_owner')
    ELSE jsonb_build_object('sourcePath','is_owner','state','invalid','value',NULL,'raw',raw->'is_owner') END;
$$;

CREATE FUNCTION public.validate_manager_directory_lineage() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE content public.league_administration_contents%ROWTYPE; native_id text; raw jsonb; fact jsonb;
  whitespace text:=U&'\0009\000A\000B\000C\000D\0020\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF';
BEGIN
  SELECT * INTO STRICT content FROM public.league_administration_contents WHERE id=NEW.content_id;
  IF content.family<>'users' OR content.week<>0 OR NOT content.accepted OR content.completeness<>'complete'
    OR content.provider<>'sleeper' OR content.normalizer_version<>'sleeper-administration-v1'
    OR NEW.league_season_id<>content.league_season_id OR jsonb_typeof(content.payload)<>'array' THEN
    RAISE EXCEPTION 'manager directory content lineage mismatch'; END IF;
  IF TG_TABLE_NAME='league_manager_directory_versions' THEN
    IF NEW.manager_count<>jsonb_array_length(content.payload)
      OR NEW.manager_count<>(SELECT count(*) FROM public.league_administration_manager_entries WHERE content_id=content.id)
      OR NEW.manager_count<>(SELECT count(DISTINCT value->>'user_id') FROM jsonb_array_elements(content.payload))
      OR EXISTS(SELECT 1 FROM jsonb_array_elements(content.payload) WHERE jsonb_typeof(value) IS DISTINCT FROM 'object'
        OR jsonb_typeof(value->'user_id') IS DISTINCT FROM 'string' OR value->>'user_id'=''
        OR btrim(value->>'user_id',whitespace) IS DISTINCT FROM value->>'user_id'
        OR value->>'user_id' ~ U&'[\0001-\001F\007F]') THEN
      RAISE EXCEPTION 'manager directory population mismatch'; END IF;
  ELSE
    SELECT external_manager_id INTO STRICT native_id FROM public.league_source_manager_accounts
      WHERE id=NEW.manager_id AND provider=content.provider;
    SELECT value INTO STRICT raw FROM jsonb_array_elements(content.payload) WHERE value->>'user_id'=native_id;
    fact:=public.project_manager_commissioner_fact(raw);
    IF NEW.commissioner_state IS DISTINCT FROM fact->>'state'
      OR to_jsonb(NEW.commissioner_value) IS DISTINCT FROM NULLIF(fact->'value','null'::jsonb)
      OR NEW.invalid_raw IS DISTINCT FROM fact->'raw'
      OR NEW.source_value IS DISTINCT FROM jsonb_build_object('externalManagerId',native_id,'commissioner',fact) THEN
      RAISE EXCEPTION 'manager directory commissioner evidence mismatch'; END IF;
  END IF;
  RETURN NEW;
END; $$;
CREATE FUNCTION public.validate_manager_directory_population() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
  IF NEW.manager_count<>(SELECT count(*) FROM public.league_manager_directory_entries
    WHERE content_id=NEW.content_id AND normalizer_version=NEW.normalizer_version) THEN
    RAISE EXCEPTION 'manager directory typed population incomplete'; END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER manager_directory_version_lineage BEFORE INSERT ON public.league_manager_directory_versions
  FOR EACH ROW EXECUTE FUNCTION public.validate_manager_directory_lineage();
CREATE TRIGGER manager_directory_entry_lineage BEFORE INSERT ON public.league_manager_directory_entries
  FOR EACH ROW EXECUTE FUNCTION public.validate_manager_directory_lineage();
-- Deferred until the existing writer has inserted every fact in the same transaction.
CREATE CONSTRAINT TRIGGER manager_directory_complete_population AFTER INSERT ON public.league_manager_directory_versions
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.validate_manager_directory_population();
CREATE TRIGGER manager_directory_version_immutable BEFORE UPDATE OR DELETE ON public.league_manager_directory_versions
  FOR EACH ROW EXECUTE FUNCTION public.prevent_league_administration_history_change();
CREATE TRIGGER manager_directory_entry_immutable BEFORE UPDATE OR DELETE ON public.league_manager_directory_entries
  FOR EACH ROW EXECUTE FUNCTION public.prevent_league_administration_history_change();

ALTER FUNCTION public.record_league_administration_observation(jsonb) RENAME TO record_league_administration_observation_v42;
CREATE FUNCTION public.record_league_administration_observation(p_input jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE result jsonb; projection jsonb:=p_input->'managerDirectory'; expected jsonb; source_row jsonb;
  content public.league_administration_contents%ROWTYPE; manager_identity uuid; fact jsonb;
BEGIN
  -- Original source locks, mapping, witness, fence, acceptance and CP6 triggers run
  -- first. Any commissioner mismatch rolls back that same transaction.
  result:=public.record_league_administration_observation_v42(p_input-'managerDirectory');
  IF projection IS NULL THEN RETURN result; END IF;
  IF p_input->'envelope'->>'family' IS DISTINCT FROM 'users' THEN
    RAISE EXCEPTION 'manager directory requires users evidence'; END IF;
  -- Failed/partial directory evidence cannot create or erase complete typed facts.
  IF p_input->>'status' IS DISTINCT FROM 'accepted'
    OR p_input->'envelope'->>'completeness' IS DISTINCT FROM 'complete' THEN RETURN result; END IF;
  SELECT * INTO STRICT content FROM public.league_administration_contents stored
    WHERE stored.league_season_id=(result->>'leagueSeasonId')::uuid AND stored.provider='sleeper'
      AND stored.external_league_id=p_input->'envelope'->'scope'->>'externalLeagueId'
      AND stored.family='users' AND stored.week=0 AND stored.normalizer_version='sleeper-administration-v1'
      AND stored.accepted AND stored.completeness='complete' AND stored.content_hash=p_input->>'contentHash'
      AND stored.payload=p_input->'envelope'->'payload' AND stored.normalized_value IS NOT DISTINCT FROM p_input->'value';
  SELECT jsonb_build_object('version','sleeper-manager-directory-v1','status','complete',
    'managers',COALESCE(jsonb_agg(jsonb_build_object('externalManagerId',item.value->>'user_id',
      'commissioner',public.project_manager_commissioner_fact(item.value)) ORDER BY item.ordinal),'[]'::jsonb),
    'diagnostics','[]'::jsonb) INTO expected FROM jsonb_array_elements(content.payload) WITH ORDINALITY item(value,ordinal);
  IF projection IS DISTINCT FROM expected THEN RAISE EXCEPTION 'manager directory projection mismatch'; END IF;
  INSERT INTO public.league_manager_directory_versions(content_id,normalizer_version,league_season_id,manager_count)
    VALUES(content.id,'sleeper-manager-directory-v1',content.league_season_id,jsonb_array_length(content.payload)) ON CONFLICT DO NOTHING;
  IF NOT EXISTS(SELECT 1 FROM public.league_manager_directory_versions WHERE content_id=content.id
    AND normalizer_version='sleeper-manager-directory-v1' AND league_season_id=content.league_season_id
    AND manager_count=jsonb_array_length(content.payload)) THEN RAISE EXCEPTION 'manager directory version conflict'; END IF;
  FOR source_row IN SELECT value FROM jsonb_array_elements(projection->'managers') LOOP
    SELECT manager.id INTO STRICT manager_identity FROM public.league_source_manager_accounts manager
      JOIN public.league_administration_manager_entries entry ON entry.manager_id=manager.id AND entry.content_id=content.id
      WHERE manager.provider=content.provider AND manager.external_manager_id=source_row->>'externalManagerId';
    fact:=source_row->'commissioner';
    INSERT INTO public.league_manager_directory_entries(content_id,normalizer_version,manager_id,league_season_id,
      commissioner_state,commissioner_value,invalid_raw,source_value)
    VALUES(content.id,'sleeper-manager-directory-v1',manager_identity,content.league_season_id,
      fact->>'state',(fact->>'value')::boolean,fact->'raw',source_row) ON CONFLICT DO NOTHING;
    IF NOT EXISTS(SELECT 1 FROM public.league_manager_directory_entries WHERE content_id=content.id
      AND normalizer_version='sleeper-manager-directory-v1' AND manager_id=manager_identity
      AND league_season_id=content.league_season_id AND source_value=source_row) THEN
      RAISE EXCEPTION 'manager directory entry conflict'; END IF;
  END LOOP;
  IF jsonb_array_length(content.payload)<>(SELECT count(*) FROM public.league_manager_directory_entries
    WHERE content_id=content.id AND normalizer_version='sleeper-manager-directory-v1') THEN
    RAISE EXCEPTION 'manager directory typed population incomplete'; END IF;
  IF p_input->'writeFence' IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.projection_jobs job
    WHERE job.job_key=p_input->'writeFence'->>'jobKey' AND job.state='running'
      AND job.lease_owner=p_input->'writeFence'->>'workerId'
      AND job.attempt_count=(p_input->'writeFence'->>'generation')::integer
      AND job.lease_until>clock_timestamp()
      AND (p_input->'writeFence'->>'deadlineAt')::timestamptz>clock_timestamp()) THEN
    RAISE EXCEPTION 'manager directory writer fence expired'; END IF;
  RETURN result;
END; $$;

REVOKE ALL ON public.league_manager_directory_versions,public.league_manager_directory_entries FROM PUBLIC;
REVOKE ALL ON FUNCTION public.project_manager_commissioner_fact(jsonb),public.validate_manager_directory_lineage(),
  public.validate_manager_directory_population(),public.record_league_administration_observation_v42(jsonb),
  public.record_league_administration_observation(jsonb) FROM PUBLIC;
DO $$ BEGIN
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='league_one_runtime') THEN
    REVOKE ALL ON public.league_manager_directory_versions,public.league_manager_directory_entries FROM league_one_runtime;
    GRANT SELECT ON public.league_manager_directory_versions,public.league_manager_directory_entries TO league_one_runtime;
    REVOKE ALL ON FUNCTION public.project_manager_commissioner_fact(jsonb),public.validate_manager_directory_lineage(),
      public.validate_manager_directory_population(),public.record_league_administration_observation_v42(jsonb) FROM league_one_runtime;
    GRANT EXECUTE ON FUNCTION public.record_league_administration_observation(jsonb) TO league_one_runtime;
  END IF;
END; $$;
