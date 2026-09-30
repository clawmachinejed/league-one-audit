-- Additive calculation input history. This records consumption of actual inputs,
-- not acceptance, provider freshness, historical slot applicability or a backfill.
CREATE TABLE public.league_calculation_source_captures (
  id uuid PRIMARY KEY,
  connection_id uuid NOT NULL REFERENCES public.league_source_connections(id),
  league_season_id uuid NOT NULL REFERENCES public.league_seasons(id),
  source_mapping_revision_id uuid NOT NULL REFERENCES public.league_source_mapping_revisions(id),
  week smallint NOT NULL CHECK (week BETWEEN 1 AND 18),
  reserved_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE public.league_calculation_capture_inputs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  capture_id uuid NOT NULL REFERENCES public.league_calculation_source_captures(id),
  family text NOT NULL CHECK (family IN ('league','matchups')),
  observation_id uuid NOT NULL REFERENCES public.league_administration_observations(id),
  content_id uuid NOT NULL REFERENCES public.league_administration_contents(id),
  configuration_version_id uuid REFERENCES public.league_configuration_versions(id),
  provenance jsonb NOT NULL,
  retained_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (capture_id,family)
);
CREATE INDEX calculation_capture_source ON public.league_calculation_source_captures
  (league_season_id,source_mapping_revision_id,week);
CREATE TRIGGER calculation_capture_immutable BEFORE UPDATE OR DELETE ON public.league_calculation_source_captures
  FOR EACH ROW EXECUTE FUNCTION public.prevent_league_administration_history_change();
CREATE TRIGGER calculation_input_immutable BEFORE UPDATE OR DELETE ON public.league_calculation_capture_inputs
  FOR EACH ROW EXECUTE FUNCTION public.prevent_league_administration_history_change();

CREATE FUNCTION public.begin_league_calculation_source_capture(p_mapping jsonb,p_week integer,p_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE capture public.league_calculation_source_captures%ROWTYPE;
BEGIN
  IF p_id IS NULL OR p_week IS NULL OR p_week NOT BETWEEN 1 AND 18 THEN
    RAISE EXCEPTION 'invalid calculation capture identity'; END IF;
  PERFORM public.validate_current_roster_mapping(p_mapping);
  INSERT INTO public.league_calculation_source_captures(id,connection_id,league_season_id,source_mapping_revision_id,week)
  VALUES(p_id,(p_mapping->>'connectionId')::uuid,(p_mapping->>'leagueSeasonId')::uuid,
    (p_mapping->>'revisionId')::uuid,p_week) ON CONFLICT DO NOTHING;
  SELECT * INTO STRICT capture FROM public.league_calculation_source_captures WHERE id=p_id;
  IF capture.connection_id IS DISTINCT FROM (p_mapping->>'connectionId')::uuid
    OR capture.league_season_id IS DISTINCT FROM (p_mapping->>'leagueSeasonId')::uuid
    OR capture.source_mapping_revision_id IS DISTINCT FROM (p_mapping->>'revisionId')::uuid
    OR capture.week<>p_week THEN RAISE EXCEPTION 'calculation capture identity conflict'; END IF;
  RETURN jsonb_build_object('id',capture.id,'reservedAt',capture.reserved_at);
END; $$;

-- Validate retained relationships independently of the wrapper, including owner
-- fixture writes. The original v1 observation can have older equal-content
-- provenance; the input keeps the actual consumption provenance separately.
CREATE FUNCTION public.validate_calculation_input_lineage()
RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE capture public.league_calculation_source_captures%ROWTYPE; started_at timestamptz;
  completed_at timestamptz; checked_at timestamptz; observed_at timestamptz;
BEGIN
  SELECT * INTO STRICT capture FROM public.league_calculation_source_captures WHERE id=NEW.capture_id;
  IF jsonb_typeof(NEW.provenance) IS DISTINCT FROM 'object'
    OR NEW.provenance-ARRAY['origin','requestStartedAt','requestCompletedAt','sourceObservedAt','checkedAt']<>'{}'::jsonb
    OR jsonb_typeof(NEW.provenance->'requestStartedAt') IS DISTINCT FROM 'string'
    OR jsonb_typeof(NEW.provenance->'requestCompletedAt') IS DISTINCT FROM 'string'
    OR jsonb_typeof(NEW.provenance->'checkedAt') IS DISTINCT FROM 'string'
    OR (NEW.family='matchups' AND NEW.provenance->>'origin' IS DISTINCT FROM 'network')
    OR (NEW.family='league' AND COALESCE(NEW.provenance->>'origin','') NOT IN ('network','cache'))
    OR (NEW.provenance->>'origin'='network' AND jsonb_typeof(NEW.provenance->'sourceObservedAt') IS DISTINCT FROM 'string')
    OR (NEW.provenance->>'origin'='cache' AND NEW.provenance->'sourceObservedAt' IS DISTINCT FROM 'null'::jsonb) THEN
    RAISE EXCEPTION 'invalid calculation input provenance'; END IF;
  started_at:=(NEW.provenance->>'requestStartedAt')::timestamptz;
  completed_at:=(NEW.provenance->>'requestCompletedAt')::timestamptz;
  checked_at:=(NEW.provenance->>'checkedAt')::timestamptz;
  observed_at:=(NEW.provenance->>'sourceObservedAt')::timestamptz;
  IF NOT isfinite(started_at) OR NOT isfinite(completed_at) OR NOT isfinite(checked_at)
    OR (observed_at IS NOT NULL AND NOT isfinite(observed_at))
    OR (NEW.provenance->>'origin'='network' AND started_at<capture.reserved_at)
    OR completed_at<started_at OR checked_at<completed_at OR checked_at<capture.reserved_at
    OR (observed_at IS NOT NULL AND (observed_at<started_at OR observed_at>completed_at))
    OR observed_at>checked_at OR checked_at>clock_timestamp()+interval '5 minutes' THEN
    RAISE EXCEPTION 'calculation input predates reservation or has invalid time'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.league_source_mapping_revisions revision
    JOIN public.league_administration_contents content ON content.id=NEW.content_id
    JOIN public.league_administration_observations observation ON observation.id=NEW.observation_id
    WHERE revision.id=capture.source_mapping_revision_id AND revision.connection_id=capture.connection_id
      AND revision.league_season_id=capture.league_season_id AND revision.provider='sleeper'
      AND content.league_season_id=capture.league_season_id AND content.provider=revision.provider
      AND content.external_league_id=revision.external_league_id AND content.family=NEW.family
      AND content.week=CASE NEW.family WHEN 'league' THEN 0 ELSE capture.week END
      AND content.accepted AND content.completeness='complete' AND content.normalizer_version='sleeper-administration-v1'
      AND content.configuration_version_id IS NOT DISTINCT FROM NEW.configuration_version_id
      AND (NEW.family<>'league' OR NEW.configuration_version_id IS NOT NULL)
      AND observation.content_id=content.id AND observation.league_season_id=content.league_season_id
      AND observation.family=content.family AND observation.week=content.week AND observation.outcome IN ('changed','unchanged')) THEN
    RAISE EXCEPTION 'calculation input lineage mismatch'; END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER calculation_input_lineage BEFORE INSERT ON public.league_calculation_capture_inputs
  FOR EACH ROW EXECUTE FUNCTION public.validate_calculation_input_lineage();

ALTER FUNCTION public.record_league_administration_observation(jsonb) RENAME TO record_league_administration_observation_v31;
CREATE FUNCTION public.record_league_administration_observation(p_input jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE addition jsonb:=p_input->'calculationCapture'; mapping jsonb:=p_input->'sourceMapping';
  envelope jsonb:=p_input->'envelope'; fence jsonb:=p_input->'writeFence'; delegated jsonb;
  capture public.league_calculation_source_captures%ROWTYPE;
  content public.league_administration_contents%ROWTYPE;
  retained public.league_calculation_capture_inputs%ROWTYPE; result jsonb; inserted boolean;
BEGIN
  IF addition IS NULL THEN RETURN public.record_league_administration_observation_v31(p_input); END IF;
  IF jsonb_typeof(addition) IS DISTINCT FROM 'object' OR addition-ARRAY['id','reservedAt']<>'{}'::jsonb
    OR jsonb_typeof(addition->'id') IS DISTINCT FROM 'string'
    OR jsonb_typeof(addition->'reservedAt') IS DISTINCT FROM 'string'
    OR jsonb_typeof(mapping) IS DISTINCT FROM 'object' OR mapping->'scope' IS DISTINCT FROM envelope->'scope'
    OR COALESCE(envelope->>'family','') NOT IN ('league','matchups')
    OR p_input->>'status' IS DISTINCT FROM 'accepted' OR envelope->>'completeness' IS DISTINCT FROM 'complete' THEN
    RAISE EXCEPTION 'calculation input requires accepted mapped capture'; END IF;
  -- Existing job -> source advisory -> source row -> administration head order.
  IF fence IS NOT NULL THEN
    PERFORM 1 FROM public.projection_jobs job WHERE job.job_key=fence->>'jobKey' AND job.state='running'
      AND job.lease_owner=fence->>'workerId' AND job.attempt_count=(fence->>'generation')::integer
      AND job.lease_until>clock_timestamp() AND (fence->>'deadlineAt')::timestamptz>clock_timestamp() FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'calculation input writer fence is stale'; END IF;
  END IF;
  PERFORM public.validate_current_roster_mapping(mapping);
  SELECT * INTO STRICT capture FROM public.league_calculation_source_captures WHERE id=(addition->>'id')::uuid;
  IF capture.connection_id IS DISTINCT FROM (mapping->>'connectionId')::uuid
    OR capture.league_season_id IS DISTINCT FROM (mapping->>'leagueSeasonId')::uuid
    OR capture.source_mapping_revision_id IS DISTINCT FROM (mapping->>'revisionId')::uuid
    OR capture.reserved_at IS DISTINCT FROM (addition->>'reservedAt')::timestamptz
    OR (envelope->>'family'='league' AND envelope->'week' IS DISTINCT FROM 'null'::jsonb)
    OR (envelope->>'family'='matchups' AND (envelope->>'week')::integer IS DISTINCT FROM capture.week) THEN
    RAISE EXCEPTION 'calculation capture scope mismatch'; END IF;
  delegated:=p_input-'calculationCapture';
  -- The legacy writer accepts mapped league/matchup inputs only through its
  -- existing optional wrappers. Do not alter those options or invoke it twice.
  IF p_input->'calendarEvidence' IS NULL AND p_input->'leagueSettingsAcceptance' IS NULL
    AND p_input->'matchupAcceptance' IS NULL THEN delegated:=delegated-'sourceMapping'; END IF;
  result:=public.record_league_administration_observation_v31(delegated);
  IF result->>'status' NOT IN ('changed','unchanged','replayed') THEN RETURN result; END IF;
  SELECT stored.* INTO content FROM public.league_administration_contents stored
    JOIN public.league_administration_observations observation ON observation.content_id=stored.id
    WHERE observation.id=(result->>'observationId')::uuid AND stored.league_season_id=capture.league_season_id
      AND stored.provider='sleeper' AND stored.external_league_id=mapping->'scope'->>'externalLeagueId'
      AND stored.family=envelope->>'family'
      AND stored.week=CASE WHEN envelope->>'family'='league' THEN 0 ELSE capture.week END
      AND stored.content_hash=p_input->>'contentHash' AND stored.payload=envelope->'payload'
      AND stored.normalized_value IS NOT DISTINCT FROM p_input->'value'
      AND stored.accepted AND stored.completeness='complete';
  IF NOT FOUND THEN RAISE EXCEPTION 'calculation input accepted content mismatch'; END IF;
  INSERT INTO public.league_calculation_capture_inputs(capture_id,family,observation_id,content_id,configuration_version_id,provenance)
  VALUES(capture.id,envelope->>'family',(result->>'observationId')::uuid,content.id,content.configuration_version_id,envelope->'provenance')
  ON CONFLICT DO NOTHING RETURNING * INTO retained;
  inserted:=FOUND;
  IF NOT inserted THEN
    SELECT * INTO STRICT retained FROM public.league_calculation_capture_inputs
      WHERE capture_id=capture.id AND family=envelope->>'family';
    IF retained.observation_id IS DISTINCT FROM (result->>'observationId')::uuid
      OR retained.content_id<>content.id OR retained.configuration_version_id IS DISTINCT FROM content.configuration_version_id
      OR retained.provenance IS DISTINCT FROM envelope->'provenance' THEN
      RAISE EXCEPTION 'calculation input replay conflict'; END IF;
  END IF;
  IF fence IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.projection_jobs job
    WHERE job.job_key=fence->>'jobKey' AND job.state='running' AND job.lease_owner=fence->>'workerId'
      AND job.attempt_count=(fence->>'generation')::integer AND job.lease_until>clock_timestamp()
      AND (fence->>'deadlineAt')::timestamptz>clock_timestamp()) THEN
    RAISE EXCEPTION 'calculation input writer fence expired'; END IF;
  RETURN result||jsonb_build_object('calculationInput',jsonb_build_object('id',retained.id,
    'status',CASE WHEN inserted THEN 'retained' ELSE 'replayed' END));
END; $$;

-- The observation owns this association at INSERT. Existing 016 triggers still
-- enforce current head/generation; an update guard below seals linked parents.
CREATE FUNCTION public.validate_calculation_source_lineage()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE context_value jsonb:=NEW.source_data->'administration'; source_value jsonb:=context_value->'sourceCapture';
  matched record;
BEGIN
  IF source_value IS NULL THEN RETURN NEW; END IF;
  IF jsonb_typeof(source_value) IS DISTINCT FROM 'object'
    OR source_value-ARRAY['captureId','leagueInputId','matchupInputId']<>'{}'::jsonb THEN
    RAISE EXCEPTION 'invalid official calculation source association'; END IF;
  SELECT capture.*, league_input.observation_id AS league_observation_id,league_input.configuration_version_id,
    matchup_input.provenance AS matchup_provenance,matchup_content.payload AS matchup_payload,
    revision.provider,revision.external_league_id,season.season,league.league_key INTO matched
  FROM public.league_calculation_source_captures capture
  JOIN public.league_calculation_capture_inputs league_input ON league_input.capture_id=capture.id AND league_input.family='league'
    AND league_input.id=(source_value->>'leagueInputId')::uuid
  JOIN public.league_calculation_capture_inputs matchup_input ON matchup_input.capture_id=capture.id AND matchup_input.family='matchups'
    AND matchup_input.id=(source_value->>'matchupInputId')::uuid
  JOIN public.league_administration_contents matchup_content ON matchup_content.id=matchup_input.content_id
  JOIN public.league_source_mapping_revisions revision ON revision.id=capture.source_mapping_revision_id
    AND revision.connection_id=capture.connection_id AND revision.league_season_id=capture.league_season_id
  JOIN public.league_source_connections connection ON connection.id=capture.connection_id
    AND connection.current_mapping_revision_id=capture.source_mapping_revision_id
    AND connection.league_season_id=capture.league_season_id
  JOIN public.league_seasons season ON season.id=capture.league_season_id
  JOIN public.leagues league ON league.id=season.league_id
  WHERE capture.id=(source_value->>'captureId')::uuid FOR SHARE OF connection;
  IF NOT FOUND OR matched.league_season_id<>NEW.league_season_id OR matched.week<>NEW.week
    OR matched.provider<>NEW.provider OR NEW.quality<>'complete'
    OR matched.league_observation_id IS DISTINCT FROM (context_value->>'observationId')::uuid
    OR matched.configuration_version_id IS DISTINCT FROM (context_value->>'configurationVersionId')::uuid
    OR (matched.matchup_provenance->>'requestStartedAt')::timestamptz IS DISTINCT FROM NEW.request_started_at
    OR (matched.matchup_provenance->>'requestCompletedAt')::timestamptz IS DISTINCT FROM NEW.request_completed_at
    OR (matched.matchup_provenance->>'sourceObservedAt')::timestamptz IS DISTINCT FROM NEW.observed_at
    OR (NEW.source_data ? 'season' AND NEW.source_data->>'season' IS DISTINCT FROM matched.season::text)
    OR (NEW.source_data ? 'week' AND NEW.source_data->>'week' IS DISTINCT FROM NEW.week::text)
    OR (NEW.source_data ? 'leagueKey' AND NEW.source_data->>'leagueKey' IS DISTINCT FROM matched.league_key) THEN
    RAISE EXCEPTION 'official calculation source lineage mismatch'; END IF;
  -- Child official score rows are inserted after this BEFORE trigger. Their
  -- score and ordered-lineup comparison belongs to the exact stored reader.
  IF NEW.source_data ? 'rosterIds' AND (
    jsonb_typeof(NEW.source_data->'rosterIds') IS DISTINCT FROM 'array'
    OR (SELECT jsonb_agg(value ORDER BY value) FROM jsonb_array_elements(NEW.source_data->'rosterIds'))
      IS DISTINCT FROM (SELECT jsonb_agg(to_jsonb(row->>'roster_id') ORDER BY to_jsonb(row->>'roster_id'))
        FROM jsonb_array_elements(matched.matchup_payload) row)) THEN
    RAISE EXCEPTION 'official calculation roster population mismatch'; END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER official_calculation_source_lineage BEFORE INSERT ON public.league_week_observations
  FOR EACH ROW EXECUTE FUNCTION public.validate_calculation_source_lineage();

-- Legacy rows without this marker retain their existing update behavior. A
-- marker cannot be grafted onto old history, removed or replaced. Linked rows
-- retain every original input field; DELETE remains governed by existing
-- references and pruning policy, with no new retention blockage.
CREATE FUNCTION public.guard_calculation_source_association()
RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
  IF OLD.source_data#>'{administration,sourceCapture}' IS DISTINCT FROM NEW.source_data#>'{administration,sourceCapture}'
    OR (OLD.source_data#>'{administration,sourceCapture}' IS NOT NULL AND NEW IS DISTINCT FROM OLD) THEN
    RAISE EXCEPTION 'official calculation source association is immutable'; END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER official_calculation_source_immutable BEFORE UPDATE ON public.league_week_observations
  FOR EACH ROW EXECUTE FUNCTION public.guard_calculation_source_association();

REVOKE ALL ON public.league_calculation_source_captures,public.league_calculation_capture_inputs FROM PUBLIC;
REVOKE ALL ON FUNCTION public.begin_league_calculation_source_capture(jsonb,integer,uuid),
  public.validate_calculation_input_lineage(),public.validate_calculation_source_lineage(),
  public.guard_calculation_source_association(),
  public.record_league_administration_observation_v31(jsonb),public.record_league_administration_observation(jsonb) FROM PUBLIC;
DO $$ BEGIN
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='league_one_runtime') THEN
    REVOKE ALL ON public.league_calculation_source_captures,public.league_calculation_capture_inputs FROM league_one_runtime;
    GRANT SELECT ON public.league_calculation_source_captures,public.league_calculation_capture_inputs TO league_one_runtime;
    REVOKE ALL ON FUNCTION public.validate_calculation_input_lineage(),public.validate_calculation_source_lineage(),
      public.guard_calculation_source_association(),
      public.record_league_administration_observation_v31(jsonb) FROM league_one_runtime;
    GRANT EXECUTE ON FUNCTION public.begin_league_calculation_source_capture(jsonb,integer,uuid),
      public.record_league_administration_observation(jsonb) TO league_one_runtime;
  END IF;
END; $$;
