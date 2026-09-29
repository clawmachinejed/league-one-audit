-- Shadow current held-player acceptance. No backfill and no v1 head changes.
CREATE TABLE public.league_roster_resource_scopes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  connection_id uuid NOT NULL REFERENCES public.league_source_connections(id),
  league_season_id uuid NOT NULL REFERENCES public.league_seasons(id),
  -- JSON nulls compare equal: nullable entity/period cannot create duplicate heads.
  identity jsonb NOT NULL UNIQUE
);
CREATE TABLE public.league_roster_resource_heads (
  scope_id uuid PRIMARY KEY REFERENCES public.league_roster_resource_scopes(id),
  latest_ordinal bigint NOT NULL DEFAULT 0 CHECK (latest_ordinal>=0),
  generation bigint NOT NULL DEFAULT 0 CHECK (generation>=0),
  accepted_id uuid
);
CREATE TABLE public.league_roster_resource_attempts (
  id uuid PRIMARY KEY,
  scope_id uuid NOT NULL REFERENCES public.league_roster_resource_scopes(id),
  ordinal bigint NOT NULL CHECK (ordinal>0),
  expected_generation bigint NOT NULL CHECK (expected_generation>=0),
  source_mapping jsonb NOT NULL,
  write_fence jsonb,
  reserved_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE(scope_id,ordinal)
);
CREATE TABLE public.league_roster_capture_receipts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  attempt_id uuid NOT NULL UNIQUE REFERENCES public.league_roster_resource_attempts(id),
  content_id uuid NOT NULL REFERENCES public.league_administration_contents(id),
  legacy_observation_id uuid NOT NULL REFERENCES public.league_administration_observations(id),
  evidence_hash text NOT NULL,
  provenance jsonb NOT NULL,
  configuration_content_id uuid REFERENCES public.league_administration_contents(id),
  population_evidence jsonb,
  expected_team_count integer CHECK (expected_team_count>0),
  coverage jsonb NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE public.league_roster_resource_acceptances (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scope_id uuid NOT NULL REFERENCES public.league_roster_resource_scopes(id),
  receipt_id uuid NOT NULL UNIQUE REFERENCES public.league_roster_capture_receipts(id),
  source_mapping_revision_id uuid NOT NULL REFERENCES public.league_source_mapping_revisions(id),
  generation bigint NOT NULL CHECK (generation>0),
  accepted_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE(scope_id,generation)
);
ALTER TABLE public.league_roster_resource_heads ADD CONSTRAINT roster_head_acceptance_fk
  FOREIGN KEY(accepted_id) REFERENCES public.league_roster_resource_acceptances(id);

CREATE TRIGGER roster_scope_immutable BEFORE UPDATE OR DELETE ON public.league_roster_resource_scopes
  FOR EACH ROW EXECUTE FUNCTION public.prevent_league_administration_history_change();
CREATE TRIGGER roster_attempt_immutable BEFORE UPDATE OR DELETE ON public.league_roster_resource_attempts
  FOR EACH ROW EXECUTE FUNCTION public.prevent_league_administration_history_change();
CREATE TRIGGER roster_receipt_immutable BEFORE UPDATE OR DELETE ON public.league_roster_capture_receipts
  FOR EACH ROW EXECUTE FUNCTION public.prevent_league_administration_history_change();
CREATE TRIGGER roster_acceptance_immutable BEFORE UPDATE OR DELETE ON public.league_roster_resource_acceptances
  FOR EACH ROW EXECUTE FUNCTION public.prevent_league_administration_history_change();

-- Validate lineage even for trusted fixture/owner insertions; runtime has no
-- table mutation privileges. History remains readable after a later remap.
CREATE FUNCTION public.validate_current_roster_lineage()
RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
  IF TG_TABLE_NAME='league_roster_capture_receipts' THEN
    IF NOT EXISTS(SELECT 1 FROM public.league_roster_resource_attempts attempt
      JOIN public.league_roster_resource_scopes scope ON scope.id=attempt.scope_id
      JOIN public.league_administration_contents content ON content.id=NEW.content_id
      JOIN public.league_administration_observations observation ON observation.id=NEW.legacy_observation_id
      WHERE attempt.id=NEW.attempt_id AND content.league_season_id=scope.league_season_id
        AND content.provider='sleeper' AND content.family='rosters' AND content.week=0
        AND content.external_league_id=attempt.source_mapping->'scope'->>'externalLeagueId'
        AND observation.content_id=content.id AND observation.league_season_id=content.league_season_id)
      OR (NEW.configuration_content_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.league_administration_contents roster
        JOIN public.league_administration_contents configuration ON configuration.id=NEW.configuration_content_id
        JOIN public.league_administration_observations observation ON observation.id=(NEW.population_evidence->>'observationId')::uuid
        WHERE roster.id=NEW.content_id AND configuration.league_season_id=roster.league_season_id
          AND configuration.provider=roster.provider AND configuration.external_league_id=roster.external_league_id
          AND configuration.family='league' AND configuration.week=0 AND configuration.accepted
          AND observation.content_id=configuration.id)) THEN RAISE EXCEPTION 'current roster receipt lineage mismatch'; END IF;
  ELSIF TG_TABLE_NAME='league_roster_resource_acceptances' THEN
    IF NOT EXISTS(SELECT 1 FROM public.league_roster_capture_receipts receipt
      JOIN public.league_roster_resource_attempts attempt ON attempt.id=receipt.attempt_id
      JOIN public.league_source_mapping_revisions revision ON revision.id=NEW.source_mapping_revision_id
      JOIN public.league_roster_resource_scopes scope ON scope.id=attempt.scope_id
      WHERE receipt.id=NEW.receipt_id AND attempt.scope_id=NEW.scope_id
        AND attempt.source_mapping->>'revisionId'=revision.id::text AND revision.connection_id=scope.connection_id
        AND revision.league_season_id=scope.league_season_id AND receipt.coverage->>'completeness'='complete'
        AND receipt.configuration_content_id IS NOT NULL AND receipt.expected_team_count>0
        AND NEW.generation=attempt.expected_generation+1) THEN RAISE EXCEPTION 'current roster acceptance lineage mismatch'; END IF;
  ELSIF TG_TABLE_NAME='league_roster_resource_heads' THEN
    IF NEW.accepted_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.league_roster_resource_acceptances accepted
      WHERE accepted.id=NEW.accepted_id AND accepted.scope_id=NEW.scope_id AND accepted.generation=NEW.generation) THEN
      RAISE EXCEPTION 'current roster head lineage mismatch';
    END IF;
    IF TG_OP='UPDATE' AND (NEW.scope_id<>OLD.scope_id OR NEW.latest_ordinal<OLD.latest_ordinal
      OR NEW.generation<OLD.generation OR (OLD.accepted_id IS NOT NULL AND NEW.accepted_id IS NULL)) THEN
      RAISE EXCEPTION 'current roster head cannot regress';
    END IF;
  END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER roster_receipt_lineage BEFORE INSERT ON public.league_roster_capture_receipts
  FOR EACH ROW EXECUTE FUNCTION public.validate_current_roster_lineage();
CREATE TRIGGER roster_acceptance_lineage BEFORE INSERT ON public.league_roster_resource_acceptances
  FOR EACH ROW EXECUTE FUNCTION public.validate_current_roster_lineage();
CREATE TRIGGER roster_head_lineage BEFORE INSERT OR UPDATE ON public.league_roster_resource_heads
  FOR EACH ROW EXECUTE FUNCTION public.validate_current_roster_lineage();

-- Private helper: same lock order/source identity as 026. No clock inference.
CREATE FUNCTION public.validate_current_roster_mapping(p_mapping jsonb)
RETURNS void LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
  IF p_mapping->>'connectionId' IS DISTINCT FROM ((p_mapping->>'connectionId')::uuid)::text
    OR p_mapping->>'leagueSeasonId' IS DISTINCT FROM ((p_mapping->>'leagueSeasonId')::uuid)::text
    OR p_mapping->>'revisionId' IS DISTINCT FROM ((p_mapping->>'revisionId')::uuid)::text THEN
    RAISE EXCEPTION 'current roster mapping UUIDs must be canonical';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('league-configuration:'||((p_mapping->>'leagueSeasonId')::uuid)::text,0));
  PERFORM 1 FROM public.league_source_connections connection
    JOIN public.league_seasons season ON season.id=connection.league_season_id
    JOIN public.leagues league ON league.id=season.league_id
    JOIN public.league_administration_enrollment_seasons enrollment
      ON enrollment.league_id=league.id AND enrollment.season=season.season AND enrollment.provider=connection.provider
    WHERE connection.id=(p_mapping->>'connectionId')::uuid
      AND connection.league_season_id=(p_mapping->>'leagueSeasonId')::uuid
      AND connection.current_mapping_revision_id=(p_mapping->>'revisionId')::uuid
      AND connection.mapping_generation=(p_mapping->>'generation')::bigint
      AND connection.provider='sleeper'
      AND p_mapping->'scope'=jsonb_build_object('leagueKey',league.league_key,'season',season.season,
        'provider',connection.provider,'externalLeagueId',connection.external_league_id) FOR SHARE OF connection;
  IF NOT FOUND THEN RAISE EXCEPTION 'current roster source mapping is stale or invalid'; END IF;
END; $$;

CREATE FUNCTION public.begin_current_roster_attempt(p_mapping jsonb,p_id uuid,p_scope jsonb,p_policy jsonb,p_fence jsonb DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE scope_row public.league_roster_resource_scopes%ROWTYPE;
  attempt public.league_roster_resource_attempts%ROWTYPE;
  head public.league_roster_resource_heads%ROWTYPE;
  identity_value jsonb;
BEGIN
  IF p_id IS NULL OR p_scope IS DISTINCT FROM jsonb_build_object('kind','enrolled-resource',
    'connectionId',p_mapping->>'connectionId','leagueSeasonId',p_mapping->>'leagueSeasonId',
    'family','roster-membership','entityId',NULL,'scoringPeriodId',NULL,
    'audienceId','public','coverageSpecId','sleeper-current-all-teams-players-v1')
    OR p_policy IS DISTINCT FROM jsonb_build_object('audienceId','public',
      'coverageSpecId','sleeper-current-all-teams-players-v1',
      'canonicalNormalizerVersion','sleeper-current-players-v1','validationVersion','latest-network-attempt-v1') THEN
    RAISE EXCEPTION 'unqualified current roster scope or policy';
  END IF;
  IF p_fence IS NOT NULL THEN
    PERFORM 1 FROM public.projection_jobs job WHERE job.job_key=p_fence->>'jobKey' AND job.state='running'
      AND job.lease_owner=p_fence->>'workerId' AND job.attempt_count=(p_fence->>'generation')::integer
      AND job.lease_until>clock_timestamp() AND (p_fence->>'deadlineAt')::timestamptz>clock_timestamp() FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'current roster reservation writer fence is stale'; END IF;
  END IF;
  PERFORM public.validate_current_roster_mapping(p_mapping);
  identity_value:=jsonb_build_object('scope',p_scope,'policy',p_policy);
  INSERT INTO public.league_roster_resource_scopes(connection_id,league_season_id,identity)
    VALUES((p_mapping->>'connectionId')::uuid,(p_mapping->>'leagueSeasonId')::uuid,identity_value)
    ON CONFLICT DO NOTHING;
  SELECT * INTO STRICT scope_row FROM public.league_roster_resource_scopes WHERE identity=identity_value;
  INSERT INTO public.league_roster_resource_heads(scope_id) VALUES(scope_row.id) ON CONFLICT DO NOTHING;
  SELECT * INTO STRICT head FROM public.league_roster_resource_heads WHERE scope_id=scope_row.id FOR UPDATE;
  IF p_fence IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.projection_jobs job
    WHERE job.job_key=p_fence->>'jobKey' AND job.lease_until>clock_timestamp()
      AND (p_fence->>'deadlineAt')::timestamptz>clock_timestamp()) THEN
    RAISE EXCEPTION 'current roster reservation writer fence expired';
  END IF;
  SELECT * INTO attempt FROM public.league_roster_resource_attempts WHERE id=p_id;
  IF FOUND THEN
    IF attempt.scope_id<>scope_row.id OR attempt.source_mapping IS DISTINCT FROM p_mapping
      OR attempt.write_fence IS DISTINCT FROM p_fence THEN
      RAISE EXCEPTION 'current roster attempt identity conflict';
    END IF;
  ELSE
    UPDATE public.league_roster_resource_heads SET latest_ordinal=latest_ordinal+1
      WHERE scope_id=scope_row.id RETURNING * INTO head;
    INSERT INTO public.league_roster_resource_attempts(id,scope_id,ordinal,expected_generation,source_mapping,write_fence)
      VALUES(p_id,scope_row.id,head.latest_ordinal,head.generation,p_mapping,p_fence) RETURNING * INTO attempt;
  END IF;
  RETURN jsonb_build_object('id',attempt.id,'scopeId',attempt.scope_id,'ordinal',attempt.ordinal,
    'expectedGeneration',attempt.expected_generation);
END; $$;

-- Preserve the exact 026 implementation behind the same sole public entry point.
-- The private function keeps all v1 shortcuts, ordering, guards and result shapes.
ALTER FUNCTION public.record_league_administration_observation(jsonb) RENAME TO record_league_administration_observation_v1;
CREATE FUNCTION public.record_league_administration_observation(p_input jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE result jsonb; addition jsonb:=p_input->'rosterAcceptance'; token jsonb:=addition->'attempt';
  attempt public.league_roster_resource_attempts%ROWTYPE; head public.league_roster_resource_heads%ROWTYPE;
  content public.league_administration_contents%ROWTYPE;
  configuration public.league_administration_contents%ROWTYPE;
  receipt public.league_roster_capture_receipts%ROWTYPE;
  population jsonb:=addition->'population'; provenance jsonb:=p_input->'envelope'->'provenance';
  population_proof jsonb; evidence_hash_value text; reason_value text; acceptance_id uuid;
  expected_count integer; covered boolean:=false; observed_count integer; teams jsonb;
BEGIN
  -- Acquire the original job/source locks in their original order. Any subsequent
  -- qualification error rolls this call back, including its v1 effects.
  result:=public.record_league_administration_observation_v1(p_input-'rosterAcceptance');
  IF addition IS NULL THEN RETURN result; END IF;
  IF p_input->'envelope'->>'family' IS DISTINCT FROM 'rosters'
    OR p_input->'envelope'->'week' IS DISTINCT FROM 'null'::jsonb
    OR provenance->>'origin' IS DISTINCT FROM 'network'
    OR p_input->'sourceMapping' IS NULL THEN RAISE EXCEPTION 'current roster requires mapped network capture'; END IF;
  PERFORM public.validate_current_roster_mapping(p_input->'sourceMapping');
  SELECT * INTO STRICT attempt FROM public.league_roster_resource_attempts WHERE id=(token->>'id')::uuid;
  IF attempt.source_mapping IS DISTINCT FROM p_input->'sourceMapping'
    OR attempt.write_fence IS DISTINCT FROM p_input->'writeFence'
    OR token IS DISTINCT FROM jsonb_build_object('id',attempt.id,'scopeId',attempt.scope_id,
      'ordinal',attempt.ordinal,'expectedGeneration',attempt.expected_generation) THEN
    RAISE EXCEPTION 'current roster attempt scope mismatch';
  END IF;
  SELECT * INTO STRICT head FROM public.league_roster_resource_heads WHERE scope_id=attempt.scope_id FOR UPDATE;
  -- v1 can replay before its final fence check. Recheck after every blocking lock.
  IF p_input->'writeFence' IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.projection_jobs job
    WHERE job.job_key=p_input->'writeFence'->>'jobKey' AND job.state='running'
      AND job.lease_owner=p_input->'writeFence'->>'workerId'
      AND job.attempt_count=(p_input->'writeFence'->>'generation')::integer
      AND job.lease_until>clock_timestamp()
      AND (p_input->'writeFence'->>'deadlineAt')::timestamptz>clock_timestamp()) THEN
    RAISE EXCEPTION 'current roster writer fence expired';
  END IF;
  evidence_hash_value:=encode(digest(convert_to(p_input::text,'UTF8'),'sha256'),'hex');
  SELECT * INTO receipt FROM public.league_roster_capture_receipts WHERE attempt_id=attempt.id;
  IF FOUND THEN
    IF receipt.evidence_hash<>evidence_hash_value THEN RAISE EXCEPTION 'current roster attempt receipt conflict'; END IF;
    RETURN result||jsonb_build_object('rosterAcceptance',jsonb_build_object('status',
      CASE WHEN EXISTS(SELECT 1 FROM public.league_roster_resource_acceptances accepted
        WHERE accepted.id=head.accepted_id AND accepted.receipt_id=receipt.id)
        AND attempt.ordinal=head.latest_ordinal THEN 'accepted' ELSE 'preserved' END,
      'reason','exact_receipt_replay','receiptId',receipt.id,'acceptedGeneration',head.generation));
  END IF;
  -- Bind exact content, never the possibly OLD observation ID returned by v1.
  SELECT * INTO STRICT content FROM public.league_administration_contents stored
    WHERE stored.league_season_id=(attempt.source_mapping->>'leagueSeasonId')::uuid
      AND stored.provider='sleeper' AND stored.external_league_id=attempt.source_mapping->'scope'->>'externalLeagueId'
      AND stored.family='rosters' AND stored.week=0 AND stored.normalizer_version='sleeper-administration-v1'
      AND stored.content_hash=p_input->>'contentHash'
      AND stored.completeness=p_input->'envelope'->>'completeness'
      AND stored.accepted=(p_input->>'status'='accepted' AND p_input->'envelope'->>'completeness'='complete')
      AND stored.payload=p_input->'envelope'->'payload' AND stored.normalized_value IS NOT DISTINCT FROM p_input->'value';
  -- Prefer the independently captured network league document from this batch.
  -- Its mapping token was captured before that batch; retain its real provenance.
  IF population IS NOT NULL THEN
    IF population->'envelope'->'scope' IS DISTINCT FROM attempt.source_mapping->'scope'
      OR population->'envelope'->>'family' IS DISTINCT FROM 'league'
      OR population->'envelope'->>'completeness' IS DISTINCT FROM 'complete'
      OR population->'envelope'->'provenance'->>'origin' IS DISTINCT FROM 'network'
      OR population->'envelope'->>'normalizerVersion' IS DISTINCT FROM 'sleeper-administration-v1'
      OR population->'envelope'->>'schemaVersion' IS DISTINCT FROM 'league-administration-v1'
      OR population->'envelope'->>'dialect' IS DISTINCT FROM 'sleeper-nfl-v1'
      OR population->'envelope'->'week' IS DISTINCT FROM 'null'::jsonb
      OR (population->'envelope'->'provenance'->>'requestStartedAt')::timestamptz IS NULL
      OR (population->'envelope'->'provenance'->>'requestCompletedAt')::timestamptz IS NULL
      OR (population->'envelope'->'provenance'->>'sourceObservedAt')::timestamptz IS NULL
      OR (population->'envelope'->'provenance'->>'checkedAt')::timestamptz IS NULL
      OR (population->'envelope'->'provenance'->>'requestStartedAt')::timestamptz>(population->'envelope'->'provenance'->>'requestCompletedAt')::timestamptz
      OR (population->'envelope'->'provenance'->>'requestCompletedAt')::timestamptz>(population->'envelope'->'provenance'->>'checkedAt')::timestamptz
      OR (population->'envelope'->'provenance'->>'sourceObservedAt')::timestamptz>(population->'envelope'->'provenance'->>'checkedAt')::timestamptz
      OR (population->'envelope'->'provenance'->>'checkedAt')::timestamptz>clock_timestamp()+interval '5 minutes' THEN
      RAISE EXCEPTION 'current roster population evidence scope mismatch';
    END IF;
    SELECT * INTO configuration FROM public.league_administration_contents stored
      WHERE stored.league_season_id=content.league_season_id AND stored.provider=content.provider
        AND stored.external_league_id=content.external_league_id AND stored.family='league' AND stored.week=0
        AND stored.normalizer_version='sleeper-administration-v1' AND stored.accepted AND stored.completeness='complete'
        AND stored.content_hash=population->>'contentHash' AND stored.payload=population->'envelope'->'payload'
        AND EXISTS(SELECT 1 FROM public.league_administration_observations observed
          WHERE observed.id=(population->>'observationId')::uuid AND observed.content_id=stored.id
            AND observed.league_season_id=stored.league_season_id AND observed.family='league' AND observed.week=0);
    population_proof:=jsonb_build_object('observationId',population->>'observationId',
      'contentHash',population->>'contentHash','provenance',population->'envelope'->'provenance');
  ELSE
    -- Existing changed-cache network verification may reuse independently retained
    -- count evidence only from an earlier exact receipt for this SAME revision.
    SELECT stored.* INTO configuration
      FROM public.league_roster_resource_acceptances accepted
      JOIN public.league_roster_capture_receipts prior ON prior.id=accepted.receipt_id
      JOIN public.league_administration_contents stored ON stored.id=prior.configuration_content_id
      WHERE accepted.id=head.accepted_id AND accepted.source_mapping_revision_id=(attempt.source_mapping->>'revisionId')::uuid;
    SELECT prior.population_evidence INTO population_proof FROM public.league_roster_resource_acceptances accepted
      JOIN public.league_roster_capture_receipts prior ON prior.id=accepted.receipt_id WHERE accepted.id=head.accepted_id
        AND accepted.source_mapping_revision_id=(attempt.source_mapping->>'revisionId')::uuid;
  END IF;
  expected_count:=(configuration.normalized_value->>'totalRosters')::integer;
  IF configuration.payload->>'total_rosters' IS DISTINCT FROM expected_count::text THEN expected_count:=NULL; END IF;
  -- Also require that v1's accepted configuration still has this count content;
  -- a known configuration change waits for the next complete network batch.
  IF configuration.id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.league_administration_heads configuration_head
    JOIN public.league_administration_observations observed ON observed.id=configuration_head.accepted_observation_id
    WHERE configuration_head.league_season_id=content.league_season_id AND configuration_head.family='league'
      AND configuration_head.week=0 AND configuration_head.read_conflict IS NULL AND observed.content_id=configuration.id) THEN
    expected_count:=NULL;
  END IF;
  teams:=content.normalized_value->'teams';
  IF content.accepted AND content.completeness='complete' AND expected_count>0 AND jsonb_typeof(teams)='array'
    AND jsonb_typeof(content.payload)='array' THEN
    observed_count:=jsonb_array_length(teams);
    covered:=observed_count=expected_count AND jsonb_array_length(content.payload)=expected_count
      AND (SELECT count(DISTINCT team->>'externalRosterId') FROM jsonb_array_elements(teams) team)=expected_count
      AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(teams) team
        WHERE jsonb_typeof(team->'playerExternalIds') IS DISTINCT FROM 'array'
          OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(content.payload) raw
            WHERE raw->>'roster_id'=team->>'externalRosterId' AND jsonb_typeof(raw->'players')='array'
              AND raw->'players'=team->'playerExternalIds'))
      AND (SELECT count(*) FROM public.league_administration_team_entries entry
        JOIN public.league_season_teams team ON team.id=entry.team_id AND team.league_season_id=entry.league_season_id
        WHERE entry.content_id=content.id AND entry.league_season_id=content.league_season_id
          AND team.provider=content.provider AND team.external_league_id=content.external_league_id
          AND entry.source_value=ANY(ARRAY(SELECT value FROM jsonb_array_elements(teams))))=expected_count;
  END IF;
  reason_value:=CASE WHEN attempt.ordinal<>head.latest_ordinal THEN 'newer_network_attempt_reserved'
    WHEN attempt.expected_generation<>head.generation THEN 'accepted_generation_changed'
    WHEN NOT COALESCE(covered,false) THEN 'complete_players_population_unproved' ELSE NULL END;
  INSERT INTO public.league_roster_capture_receipts(attempt_id,content_id,legacy_observation_id,evidence_hash,
    provenance,configuration_content_id,population_evidence,expected_team_count,coverage)
  VALUES(attempt.id,content.id,(result->>'observationId')::uuid,evidence_hash_value,provenance,
    configuration.id,population_proof,expected_count,
    jsonb_build_object('periodIds','[]'::jsonb,'interval',NULL,'entitySet',CASE WHEN covered THEN 'full' ELSE 'unknown' END,
      'fields',jsonb_build_array('players'),'pagination','complete','nextCursor',NULL,
      'completeness',CASE WHEN covered THEN 'complete' ELSE 'unknown' END,
      'reasons',CASE WHEN covered THEN '[]'::jsonb ELSE jsonb_build_array('complete_players_population_unproved') END))
    RETURNING * INTO receipt;
  IF reason_value IS NULL THEN
    IF attempt.write_fence IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.projection_jobs job
      WHERE job.job_key=attempt.write_fence->>'jobKey' AND job.lease_until>clock_timestamp()
        AND (attempt.write_fence->>'deadlineAt')::timestamptz>clock_timestamp()) THEN
      RAISE EXCEPTION 'current roster writer fence expired';
    END IF;
    INSERT INTO public.league_roster_resource_acceptances(scope_id,receipt_id,source_mapping_revision_id,generation)
      VALUES(attempt.scope_id,receipt.id,(attempt.source_mapping->>'revisionId')::uuid,head.generation+1)
      RETURNING id INTO acceptance_id;
    UPDATE public.league_roster_resource_heads SET accepted_id=acceptance_id,generation=generation+1
      WHERE scope_id=attempt.scope_id RETURNING * INTO head;
  END IF;
  RETURN result||jsonb_build_object('rosterAcceptance',jsonb_build_object('status',
    CASE WHEN reason_value IS NULL THEN 'accepted' ELSE 'preserved' END,'reason',reason_value,
    'receiptId',receipt.id,'acceptedGeneration',head.generation));
END; $$;

REVOKE ALL ON public.league_roster_resource_scopes,public.league_roster_resource_heads,
  public.league_roster_resource_attempts,public.league_roster_capture_receipts,public.league_roster_resource_acceptances FROM PUBLIC;
REVOKE ALL ON FUNCTION public.validate_current_roster_mapping(jsonb),
  public.validate_current_roster_lineage(),
  public.begin_current_roster_attempt(jsonb,uuid,jsonb,jsonb,jsonb),
  public.record_league_administration_observation_v1(jsonb),public.record_league_administration_observation(jsonb) FROM PUBLIC;
DO $$ BEGIN
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='league_one_runtime') THEN
    REVOKE ALL ON public.league_roster_resource_scopes,public.league_roster_resource_heads,
      public.league_roster_resource_attempts,public.league_roster_capture_receipts,public.league_roster_resource_acceptances FROM league_one_runtime;
    REVOKE ALL ON FUNCTION public.record_league_administration_observation_v1(jsonb),
      public.validate_current_roster_mapping(jsonb),public.validate_current_roster_lineage() FROM league_one_runtime;
    GRANT EXECUTE ON FUNCTION public.begin_current_roster_attempt(jsonb,uuid,jsonb,jsonb,jsonb),
      public.record_league_administration_observation(jsonb) TO league_one_runtime;
    GRANT SELECT ON public.league_roster_resource_scopes,public.league_roster_resource_heads,
      public.league_roster_resource_attempts,public.league_roster_capture_receipts,public.league_roster_resource_acceptances TO league_one_runtime;
  END IF;
END; $$;
