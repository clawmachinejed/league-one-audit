-- Additive native-week identity proof. No backfill, historical slot inference,
-- current-calendar pointer, or changes to the existing administration writer.
CREATE TABLE public.league_native_period_calendar_evidence (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  connection_id uuid NOT NULL REFERENCES public.league_source_connections(id),
  league_season_id uuid NOT NULL REFERENCES public.league_seasons(id),
  source_mapping_revision_id uuid NOT NULL REFERENCES public.league_source_mapping_revisions(id),
  configuration_content_id uuid NOT NULL REFERENCES public.league_administration_contents(id),
  observation_id uuid NOT NULL REFERENCES public.league_administration_observations(id),
  mapping_policy_version text NOT NULL CHECK (mapping_policy_version='sleeper-native-week-to-nfl-regular-v1'),
  schedule_revision text NOT NULL CHECK (schedule_revision ~ '^[0-9a-f]{64}$'),
  evidence_hash text NOT NULL CHECK (evidence_hash ~ '^[0-9a-f]{64}$'),
  evidence jsonb NOT NULL,
  retained_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE(source_mapping_revision_id,configuration_content_id,mapping_policy_version,schedule_revision)
);
CREATE INDEX native_period_calendar_lineage ON public.league_native_period_calendar_evidence
  (connection_id,league_season_id,source_mapping_revision_id,configuration_content_id,retained_at,id);
CREATE TRIGGER native_period_calendar_immutable BEFORE UPDATE OR DELETE
  ON public.league_native_period_calendar_evidence FOR EACH ROW
  EXECUTE FUNCTION public.prevent_league_administration_history_change();

-- The application reuses the established full/date validator and recomputes the
-- schedule revision. SQL independently guards the retained DTO and full coverage.
CREATE FUNCTION public.validate_native_period_calendar_evidence(p_evidence jsonb,p_season text)
RETURNS void LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE game_value jsonb; game_date date; prior_week integer:=0; game_week integer;
  evaluated_at timestamptz; started_at timestamptz; completed_at timestamptz;
  teams text[]:=ARRAY['ARI','ATL','BAL','BUF','CAR','CHI','CIN','CLE','DAL','DEN','DET','GB','HOU','IND','JAX','KC',
    'LAC','LAR','LV','MIA','MIN','NE','NO','NYG','NYJ','PHI','PIT','SEA','SF','TB','TEN','WAS'];
BEGIN
  IF p_season IS NULL OR p_season !~ '^20[0-9]{2}$'
    OR jsonb_typeof(p_evidence) IS DISTINCT FROM 'object'
    OR p_evidence->>'schemaVersion' IS DISTINCT FROM 'sleeper-calendar-evidence-v1'
    OR p_evidence->>'mappingPolicyVersion' IS DISTINCT FROM 'sleeper-native-week-to-nfl-regular-v1'
    OR p_evidence->'source' IS DISTINCT FROM jsonb_build_object('provider','sleeper','resource','schedule/nfl/regular','season',p_season)
    OR p_evidence->>'policyVersion' IS DISTINCT FROM 'nfl-complete-next-day-eastern-noon-v1'
    OR COALESCE(p_evidence->>'scheduleRevision','') !~ '^[0-9a-f]{64}$'
    OR p_evidence->'sourceObservedAt' IS DISTINCT FROM 'null'::jsonb
    OR jsonb_typeof(p_evidence->'schedule') IS DISTINCT FROM 'array'
    OR p_evidence-ARRAY['schemaVersion','mappingPolicyVersion','source','policyVersion','scheduleRevision',
      'evaluatedAt','retrievalStartedAt','retrievalCompletedAt','sourceObservedAt','schedule'] IS DISTINCT FROM '{}'::jsonb THEN
    RAISE EXCEPTION 'invalid native period calendar evidence';
  END IF;
  IF jsonb_array_length(p_evidence->'schedule')<>272 THEN
    RAISE EXCEPTION 'native period calendar requires complete schedule';
  END IF;
  IF jsonb_typeof(p_evidence->'evaluatedAt') IS DISTINCT FROM 'string'
    OR jsonb_typeof(p_evidence->'retrievalStartedAt') IS DISTINCT FROM 'string'
    OR jsonb_typeof(p_evidence->'retrievalCompletedAt') IS DISTINCT FROM 'string'
    OR p_evidence->>'evaluatedAt' !~ 'T.*(Z|[+-][0-9]{2}:[0-9]{2})$'
    OR p_evidence->>'retrievalStartedAt' !~ 'T.*(Z|[+-][0-9]{2}:[0-9]{2})$'
    OR p_evidence->>'retrievalCompletedAt' !~ 'T.*(Z|[+-][0-9]{2}:[0-9]{2})$' THEN
    RAISE EXCEPTION 'invalid native period calendar provenance';
  END IF;
  evaluated_at:=(p_evidence->>'evaluatedAt')::timestamptz;
  started_at:=(p_evidence->>'retrievalStartedAt')::timestamptz;
  completed_at:=(p_evidence->>'retrievalCompletedAt')::timestamptz;
  IF NOT isfinite(evaluated_at) OR NOT isfinite(started_at) OR NOT isfinite(completed_at)
    OR evaluated_at>completed_at OR started_at>completed_at OR completed_at>clock_timestamp()+interval '5 minutes' THEN
    RAISE EXCEPTION 'invalid native period calendar provenance';
  END IF;
  FOR game_value IN SELECT value FROM jsonb_array_elements(p_evidence->'schedule') LOOP
    IF jsonb_typeof(game_value) IS DISTINCT FROM 'object'
      OR game_value-ARRAY['game_id','week','home','away','date','status'] IS DISTINCT FROM '{}'::jsonb
      OR jsonb_typeof(game_value->'game_id') IS DISTINCT FROM 'string' OR btrim(game_value->>'game_id')=''
      OR btrim(game_value->>'game_id') IS DISTINCT FROM game_value->>'game_id'
      OR jsonb_typeof(game_value->'week') IS DISTINCT FROM 'number' OR COALESCE(game_value->>'week','') !~ '^[0-9]+$'
      OR jsonb_typeof(game_value->'home') IS DISTINCT FROM 'string' OR NOT (game_value->>'home'=ANY(teams))
      OR jsonb_typeof(game_value->'away') IS DISTINCT FROM 'string' OR NOT (game_value->>'away'=ANY(teams))
      OR game_value->>'home'=game_value->>'away'
      OR jsonb_typeof(game_value->'date') IS DISTINCT FROM 'string' OR game_value->>'date' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
      OR jsonb_typeof(game_value->'status') IS NULL OR jsonb_typeof(game_value->'status') NOT IN ('string','null')
      OR game_value->>'status'='canceled' THEN RAISE EXCEPTION 'invalid native period calendar game'; END IF;
    game_week:=(game_value->>'week')::integer;
    game_date:=(game_value->>'date')::date;
    IF game_week<1 OR game_week>18 OR game_week<prior_week
      OR to_char(game_date,'YYYY-MM-DD') IS DISTINCT FROM game_value->>'date'
      OR NOT (extract(year FROM game_date)=p_season::integer
        OR (extract(year FROM game_date)=p_season::integer+1 AND extract(month FROM game_date)<=2)) THEN
      RAISE EXCEPTION 'native period calendar week or season mismatch';
    END IF;
    prior_week:=game_week;
  END LOOP;
  IF (SELECT count(DISTINCT game->>'game_id') FROM jsonb_array_elements(p_evidence->'schedule') game)<>272
    OR (SELECT count(DISTINCT game->>'week') FROM jsonb_array_elements(p_evidence->'schedule') game)<>18
    OR EXISTS(SELECT 1 FROM jsonb_array_elements(p_evidence->'schedule') game GROUP BY game->>'week' HAVING count(*) NOT BETWEEN 13 AND 16)
    OR EXISTS(WITH appearances AS (
      SELECT game->>'week' AS week,game->>'home' AS team FROM jsonb_array_elements(p_evidence->'schedule') game
      UNION ALL SELECT game->>'week',game->>'away' FROM jsonb_array_elements(p_evidence->'schedule') game)
      SELECT 1 FROM appearances GROUP BY week,team HAVING count(*)<>1)
    OR EXISTS(WITH appearances AS (
      SELECT game->>'home' AS team FROM jsonb_array_elements(p_evidence->'schedule') game
      UNION ALL SELECT game->>'away' FROM jsonb_array_elements(p_evidence->'schedule') game)
      SELECT 1 FROM appearances GROUP BY team HAVING count(*)<>17) THEN
    RAISE EXCEPTION 'native period calendar coverage conflict';
  END IF;
END; $$;

CREATE FUNCTION public.validate_native_period_calendar_lineage()
RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE season_value text;
BEGIN
  SELECT season.season::text INTO season_value FROM public.league_seasons season WHERE season.id=NEW.league_season_id;
  PERFORM public.validate_native_period_calendar_evidence(NEW.evidence,season_value);
  IF NEW.mapping_policy_version IS DISTINCT FROM NEW.evidence->>'mappingPolicyVersion'
    OR NEW.schedule_revision IS DISTINCT FROM NEW.evidence->>'scheduleRevision'
    OR NEW.evidence_hash IS DISTINCT FROM encode(digest(convert_to((NEW.evidence-
      ARRAY['evaluatedAt','retrievalStartedAt','retrievalCompletedAt'])::text,'UTF8'),'sha256'),'hex')
    OR NOT EXISTS(SELECT 1 FROM public.league_source_mapping_revisions revision
      JOIN public.league_administration_contents content ON content.id=NEW.configuration_content_id
      JOIN public.league_administration_observations observation ON observation.id=NEW.observation_id
      WHERE revision.id=NEW.source_mapping_revision_id AND revision.connection_id=NEW.connection_id
        AND revision.league_season_id=NEW.league_season_id AND revision.provider='sleeper'
        AND content.league_season_id=NEW.league_season_id AND content.provider=revision.provider
        AND content.external_league_id=revision.external_league_id AND content.family='league' AND content.week=0
        AND content.normalizer_version='sleeper-administration-v1' AND content.accepted AND content.completeness='complete'
        AND content.payload->'league_id'=to_jsonb(revision.external_league_id)
        AND content.payload->'season'=to_jsonb(season_value)
        AND content.payload->'sport'='"nfl"'::jsonb AND content.payload->'season_type'='"regular"'::jsonb
        AND observation.content_id=content.id AND observation.league_season_id=content.league_season_id
        AND observation.family='league' AND observation.week=0 AND observation.outcome IN ('changed','unchanged')) THEN
    RAISE EXCEPTION 'native period calendar lineage mismatch';
  END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER native_period_calendar_lineage BEFORE INSERT ON public.league_native_period_calendar_evidence
  FOR EACH ROW EXECUTE FUNCTION public.validate_native_period_calendar_lineage();

-- Keep 030 and its older delegate chain byte-for-byte. Absence of the optional
-- sidecar delegates exactly once with the same legacy input and result shape.
ALTER FUNCTION public.record_league_administration_observation(jsonb) RENAME TO record_league_administration_observation_v30;
CREATE FUNCTION public.record_league_administration_observation(p_input jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE addition jsonb:=p_input->'calendarEvidence'; mapping jsonb:=p_input->'sourceMapping';
  fence jsonb:=p_input->'writeFence'; envelope jsonb:=p_input->'envelope'; result jsonb;
  content public.league_administration_contents%ROWTYPE;
  retained public.league_native_period_calendar_evidence%ROWTYPE;
  evidence_hash_value text; inserted boolean;
BEGIN
  IF addition IS NULL THEN RETURN public.record_league_administration_observation_v30(p_input); END IF;
  IF envelope->>'family' IS DISTINCT FROM 'league' OR envelope->'week' IS DISTINCT FROM 'null'::jsonb
    OR jsonb_typeof(mapping) IS DISTINCT FROM 'object' OR envelope->'scope' IS DISTINCT FROM mapping->'scope' THEN
    RAISE EXCEPTION 'native period calendar requires mapped league content';
  END IF;
  -- Match the established job -> source advisory -> source row -> head order.
  IF fence IS NOT NULL THEN
    PERFORM 1 FROM public.projection_jobs job WHERE job.job_key=fence->>'jobKey' AND job.state='running'
      AND job.lease_owner=fence->>'workerId' AND job.attempt_count=(fence->>'generation')::integer
      AND job.lease_until>clock_timestamp() AND (fence->>'deadlineAt')::timestamptz>clock_timestamp() FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'native period calendar writer fence is stale'; END IF;
  END IF;
  PERFORM public.validate_current_roster_mapping(mapping);
  -- A sidecar-only mapping is fenced here; the v1 writer only accepts mappings
  -- for roster documents. Existing league-settings acceptance keeps its token.
  result:=public.record_league_administration_observation_v30((p_input-'calendarEvidence')-
    CASE WHEN p_input->'leagueSettingsAcceptance' IS NULL THEN 'sourceMapping' ELSE '__no_removed_field__' END);
  IF fence IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.projection_jobs job
    WHERE job.job_key=fence->>'jobKey' AND job.state='running' AND job.lease_owner=fence->>'workerId'
      AND job.attempt_count=(fence->>'generation')::integer AND job.lease_until>clock_timestamp()
      AND (fence->>'deadlineAt')::timestamptz>clock_timestamp()) THEN
    RAISE EXCEPTION 'native period calendar writer fence expired';
  END IF;
  IF result->>'status' IN ('stale','rejected') THEN RETURN result; END IF;
  PERFORM public.validate_native_period_calendar_evidence(addition,mapping->'scope'->>'season');
  -- Unchanged/cache results can point to an older accepted observation. Bind its
  -- actual content, not new provenance and not an inferred historical mapping.
  SELECT stored.* INTO content FROM public.league_administration_contents stored
    JOIN public.league_administration_observations observation ON observation.content_id=stored.id
    JOIN public.league_administration_heads head ON head.accepted_observation_id=observation.id
      AND head.league_season_id=stored.league_season_id AND head.family='league' AND head.week=0 AND head.read_conflict IS NULL
    WHERE observation.id=(result->>'observationId')::uuid AND observation.league_season_id=stored.league_season_id
      AND observation.family='league' AND observation.week=0
      AND stored.league_season_id=(mapping->>'leagueSeasonId')::uuid AND stored.provider='sleeper'
      AND stored.external_league_id=mapping->'scope'->>'externalLeagueId' AND stored.family='league' AND stored.week=0
      AND stored.normalizer_version='sleeper-administration-v1' AND stored.accepted AND stored.completeness='complete'
      AND stored.content_hash=p_input->>'contentHash' AND stored.payload=envelope->'payload'
      AND stored.normalized_value IS NOT DISTINCT FROM p_input->'value'
      AND stored.payload->'league_id'=to_jsonb(mapping->'scope'->>'externalLeagueId')
      AND stored.payload->'season'=to_jsonb(mapping->'scope'->>'season')
      AND stored.payload->'sport'='"nfl"'::jsonb AND stored.payload->'season_type'='"regular"'::jsonb;
  IF NOT FOUND THEN RAISE EXCEPTION 'native period calendar accepted content mismatch'; END IF;
  evidence_hash_value:=encode(digest(convert_to((addition-
    ARRAY['evaluatedAt','retrievalStartedAt','retrievalCompletedAt'])::text,'UTF8'),'sha256'),'hex');
  INSERT INTO public.league_native_period_calendar_evidence(connection_id,league_season_id,source_mapping_revision_id,
    configuration_content_id,observation_id,mapping_policy_version,schedule_revision,evidence_hash,evidence)
  VALUES((mapping->>'connectionId')::uuid,(mapping->>'leagueSeasonId')::uuid,(mapping->>'revisionId')::uuid,
    content.id,(result->>'observationId')::uuid,addition->>'mappingPolicyVersion',addition->>'scheduleRevision',evidence_hash_value,addition)
  ON CONFLICT DO NOTHING RETURNING * INTO retained;
  inserted:=FOUND;
  IF NOT inserted THEN
    SELECT * INTO STRICT retained FROM public.league_native_period_calendar_evidence
      WHERE source_mapping_revision_id=(mapping->>'revisionId')::uuid AND configuration_content_id=content.id
        AND mapping_policy_version=addition->>'mappingPolicyVersion' AND schedule_revision=addition->>'scheduleRevision';
    IF retained.evidence_hash IS DISTINCT FROM evidence_hash_value THEN
      RAISE EXCEPTION 'native period calendar evidence identity conflict';
    END IF;
  END IF;
  -- Includes an INSERT unique-index wait: even an immutable replay must not
  -- succeed after the writer's deadline or lease has elapsed.
  IF fence IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.projection_jobs job
    WHERE job.job_key=fence->>'jobKey' AND job.state='running' AND job.lease_owner=fence->>'workerId'
      AND job.attempt_count=(fence->>'generation')::integer AND job.lease_until>clock_timestamp()
      AND (fence->>'deadlineAt')::timestamptz>clock_timestamp()) THEN
    RAISE EXCEPTION 'native period calendar writer fence expired';
  END IF;
  RETURN result||jsonb_build_object('calendarEvidence',jsonb_build_object('id',retained.id,
    'status',CASE WHEN inserted THEN 'retained' ELSE 'replayed' END));
END; $$;

REVOKE ALL ON public.league_native_period_calendar_evidence FROM PUBLIC;
REVOKE ALL ON FUNCTION public.validate_native_period_calendar_evidence(jsonb,text),
  public.validate_native_period_calendar_lineage(),public.record_league_administration_observation_v30(jsonb),
  public.record_league_administration_observation(jsonb) FROM PUBLIC;
DO $$ BEGIN
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='league_one_runtime') THEN
    REVOKE ALL ON public.league_native_period_calendar_evidence FROM league_one_runtime;
    GRANT SELECT ON public.league_native_period_calendar_evidence TO league_one_runtime;
    REVOKE ALL ON FUNCTION public.validate_native_period_calendar_evidence(jsonb,text),
      public.validate_native_period_calendar_lineage(),public.record_league_administration_observation_v30(jsonb) FROM league_one_runtime;
    GRANT EXECUTE ON FUNCTION public.record_league_administration_observation(jsonb) TO league_one_runtime;
  END IF;
END; $$;
