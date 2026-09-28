-- Expand only. Current connections receive a baseline revision; no old
-- observation/history row is assigned inferred historical lineage.
ALTER TABLE public.league_source_connections
  ADD COLUMN id uuid NOT NULL DEFAULT gen_random_uuid(),
  ADD COLUMN mapping_generation bigint NOT NULL DEFAULT 1 CHECK (mapping_generation > 0),
  ADD COLUMN current_mapping_revision_id uuid NOT NULL DEFAULT gen_random_uuid(),
  ADD CONSTRAINT league_source_connection_id_unique UNIQUE (id);

CREATE TABLE public.league_source_mapping_revisions (
  id uuid PRIMARY KEY,
  connection_id uuid NOT NULL REFERENCES public.league_source_connections(id) DEFERRABLE INITIALLY DEFERRED,
  league_season_id uuid NOT NULL REFERENCES public.league_seasons(id),
  provider text NOT NULL,
  external_league_id text NOT NULL CHECK (btrim(external_league_id)<>''),
  source_namespace text NOT NULL,
  generation bigint NOT NULL CHECK (generation>0),
  previous_revision_id uuid REFERENCES public.league_source_mapping_revisions(id),
  history_id uuid REFERENCES public.league_source_connection_history(id),
  evidence text NOT NULL CHECK (btrim(evidence)<>''),
  recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  transaction_id bigint NOT NULL DEFAULT txid_current(),
  UNIQUE (connection_id,generation),
  UNIQUE (connection_id,generation,id)
);
INSERT INTO public.league_source_mapping_revisions
  (id,connection_id,league_season_id,provider,external_league_id,source_namespace,generation,evidence)
SELECT connection.current_mapping_revision_id,connection.id,connection.league_season_id,
  connection.provider,connection.external_league_id,'nfl:'||season.season,1,
  '026: current mapping baseline only; earlier mapping lineage unverified'
FROM public.league_source_connections connection
JOIN public.league_seasons season ON season.id=connection.league_season_id;
ALTER TABLE public.league_source_connections ADD CONSTRAINT league_source_connection_current_revision_fk
  FOREIGN KEY (id,mapping_generation,current_mapping_revision_id)
  REFERENCES public.league_source_mapping_revisions(connection_id,generation,id) DEFERRABLE INITIALLY DEFERRED;

CREATE TABLE public.league_administration_observation_mappings (
  observation_id uuid PRIMARY KEY REFERENCES public.league_administration_observations(id),
  source_mapping_revision_id uuid NOT NULL REFERENCES public.league_source_mapping_revisions(id)
);
CREATE TRIGGER source_mapping_revision_immutable BEFORE UPDATE OR DELETE
  ON public.league_source_mapping_revisions FOR EACH ROW
  EXECUTE FUNCTION public.prevent_league_administration_history_change();
CREATE TRIGGER administration_observation_mapping_immutable BEFORE UPDATE OR DELETE
  ON public.league_administration_observation_mappings FOR EACH ROW
  EXECUTE FUNCTION public.prevent_league_administration_history_change();

CREATE FUNCTION public.validate_administration_observation_mapping()
RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.league_administration_observations observation
    JOIN public.league_administration_contents content ON content.id=observation.content_id
    JOIN public.league_source_mapping_revisions revision ON revision.id=NEW.source_mapping_revision_id
    WHERE observation.id=NEW.observation_id AND observation.family='rosters' AND content.family='rosters'
      AND observation.week=0 AND content.week=0 AND observation.origin='network'
      AND observation.league_season_id=content.league_season_id AND content.league_season_id=revision.league_season_id
      AND content.provider=revision.provider AND content.external_league_id=revision.external_league_id) THEN
    RAISE EXCEPTION 'administration observation mapping lineage mismatch';
  END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER administration_observation_mapping_lineage BEFORE INSERT
  ON public.league_administration_observation_mappings FOR EACH ROW
  EXECUTE FUNCTION public.validate_administration_observation_mapping();

-- Existing runtime registration has table INSERT/UPDATE rights. A caller must
-- never choose an identity or edit a pointer using those inherited privileges.
CREATE FUNCTION public.guard_source_mapping_pointer()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE revision public.league_source_mapping_revisions%ROWTYPE;
BEGIN
  IF TG_OP='INSERT' THEN
    NEW.id:=gen_random_uuid(); NEW.mapping_generation:=1; NEW.current_mapping_revision_id:=gen_random_uuid();
    RETURN NEW;
  END IF;
  IF NEW.id IS DISTINCT FROM OLD.id THEN RAISE EXCEPTION 'source connection identity is immutable'; END IF;
  IF NEW.mapping_generation IS NOT DISTINCT FROM OLD.mapping_generation
    AND NEW.current_mapping_revision_id IS NOT DISTINCT FROM OLD.current_mapping_revision_id
    AND NEW.external_league_id IS NOT DISTINCT FROM OLD.external_league_id THEN RETURN NEW; END IF;
  SELECT * INTO revision FROM public.league_source_mapping_revisions
    WHERE id=NEW.current_mapping_revision_id AND transaction_id=txid_current();
  IF revision.id IS NULL OR revision.connection_id<>OLD.id
    OR revision.league_season_id<>OLD.league_season_id OR revision.provider<>OLD.provider
    OR revision.external_league_id<>NEW.external_league_id
    OR revision.generation<>OLD.mapping_generation+1 OR NEW.mapping_generation<>revision.generation
    OR revision.previous_revision_id IS DISTINCT FROM OLD.current_mapping_revision_id THEN
    RAISE EXCEPTION 'source mapping pointer requires an evidenced owner revision';
  END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER guard_source_mapping_pointer BEFORE INSERT OR UPDATE
  ON public.league_source_connections FOR EACH ROW EXECUTE FUNCTION public.guard_source_mapping_pointer();

-- Runs after the existing registration/history guard. A new annual connection
-- has a new UUID; the old owner continuity evidence is preserved verbatim. No
-- exact predecessor revision across seasons is asserted by this slice.
CREATE FUNCTION public.record_initial_source_mapping_revision()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE history_row public.league_source_connection_history%ROWTYPE; history_count integer; season_value smallint;
BEGIN
  SELECT count(*) INTO history_count FROM public.league_source_connection_history
    WHERE league_season_id=NEW.league_season_id AND provider=NEW.provider
      AND external_league_id=NEW.external_league_id AND transaction_id=txid_current();
  IF history_count<>1 THEN RAISE EXCEPTION 'initial mapping history is ambiguous'; END IF;
  SELECT * INTO STRICT history_row FROM public.league_source_connection_history
    WHERE league_season_id=NEW.league_season_id AND provider=NEW.provider
      AND external_league_id=NEW.external_league_id AND transaction_id=txid_current();
  SELECT season INTO STRICT season_value FROM public.league_seasons WHERE id=NEW.league_season_id;
  INSERT INTO public.league_source_mapping_revisions
    (id,connection_id,league_season_id,provider,external_league_id,source_namespace,generation,history_id,evidence)
  VALUES (NEW.current_mapping_revision_id,NEW.id,NEW.league_season_id,NEW.provider,NEW.external_league_id,
    'nfl:'||season_value,1,history_row.id,history_row.evidence);
  RETURN NEW;
END; $$;
CREATE TRIGGER z_record_initial_source_mapping_revision AFTER INSERT
  ON public.league_source_connections FOR EACH ROW EXECUTE FUNCTION public.record_initial_source_mapping_revision();

-- Explicit revision CAS also supports a same-source correction. An exact retry
-- returns its original revision; it never treats a later A->B->A as a retry.
CREATE FUNCTION public.revise_league_source_connection(
  p_season_id uuid,p_provider text,p_expected_revision_id uuid,p_external_id text,p_evidence text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE connection public.league_source_connections%ROWTYPE; prior public.league_source_mapping_revisions%ROWTYPE;
  revision_id uuid:=gen_random_uuid(); history_id uuid; season_value smallint;
BEGIN
  IF btrim(COALESCE(p_evidence,''))='' OR btrim(COALESCE(p_external_id,''))='' OR p_expected_revision_id IS NULL THEN
    RAISE EXCEPTION 'source revision requires evidence and target'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('league-configuration:'||p_season_id::text,0));
  SELECT * INTO STRICT connection FROM public.league_source_connections
    WHERE league_season_id=p_season_id AND provider=p_provider FOR UPDATE;
  IF connection.current_mapping_revision_id IS DISTINCT FROM p_expected_revision_id THEN
    SELECT * INTO STRICT prior FROM public.league_source_mapping_revisions WHERE id=connection.current_mapping_revision_id;
    IF prior.previous_revision_id=p_expected_revision_id AND prior.external_league_id=p_external_id AND prior.evidence=p_evidence THEN
      RETURN prior.id;
    END IF;
    RAISE EXCEPTION 'source revision compare-and-swap conflict';
  END IF;
  INSERT INTO public.league_source_connection_history
    (league_season_id,provider,previous_external_league_id,external_league_id,evidence)
  VALUES(p_season_id,p_provider,connection.external_league_id,p_external_id,p_evidence) RETURNING id INTO history_id;
  SELECT season INTO STRICT season_value FROM public.league_seasons WHERE id=p_season_id;
  INSERT INTO public.league_source_mapping_revisions
    (id,connection_id,league_season_id,provider,external_league_id,source_namespace,generation,previous_revision_id,history_id,evidence)
  VALUES(revision_id,connection.id,p_season_id,p_provider,p_external_id,'nfl:'||season_value,
    connection.mapping_generation+1,connection.current_mapping_revision_id,history_id,p_evidence);
  UPDATE public.league_source_connections SET external_league_id=p_external_id,connected_at=clock_timestamp(),
    mapping_generation=connection.mapping_generation+1,current_mapping_revision_id=revision_id
    WHERE league_season_id=p_season_id AND provider=p_provider;
  UPDATE public.league_administration_heads SET read_conflict='source_connection_remapped',generation=generation+1
    WHERE league_season_id=p_season_id;
  RETURN revision_id;
END; $$;

-- Keep the old owner API and its same-target no-op behavior. New owner tools
-- should use exact revision CAS above; legacy external-ID CAS cannot prove ABA.
CREATE OR REPLACE FUNCTION public.remap_league_source_connection(
  p_season_id uuid,p_provider text,p_expected_external_id text,p_external_id text,p_evidence text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE connection public.league_source_connections%ROWTYPE;
BEGIN
  IF btrim(COALESCE(p_evidence,''))='' OR btrim(COALESCE(p_external_id,''))='' THEN
    RAISE EXCEPTION 'source remap requires evidence and target'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('league-configuration:'||p_season_id::text,0));
  SELECT * INTO STRICT connection FROM public.league_source_connections
    WHERE league_season_id=p_season_id AND provider=p_provider FOR UPDATE;
  IF connection.external_league_id IS DISTINCT FROM p_expected_external_id THEN RAISE EXCEPTION 'source remap compare-and-swap conflict'; END IF;
  IF connection.external_league_id=p_external_id THEN RETURN; END IF;
  PERFORM public.revise_league_source_connection(p_season_id,p_provider,connection.current_mapping_revision_id,p_external_id,p_evidence);
END; $$;

REVOKE ALL ON public.league_source_mapping_revisions,public.league_administration_observation_mappings FROM PUBLIC;
REVOKE ALL ON FUNCTION public.guard_source_mapping_pointer(),public.record_initial_source_mapping_revision(),
  public.revise_league_source_connection(uuid,text,uuid,text,text),public.validate_administration_observation_mapping() FROM PUBLIC;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='league_one_runtime') THEN
    REVOKE ALL ON public.league_source_mapping_revisions,public.league_administration_observation_mappings FROM league_one_runtime;
    GRANT SELECT ON public.league_source_mapping_revisions,public.league_administration_observation_mappings TO league_one_runtime;
    REVOKE ALL ON FUNCTION public.guard_source_mapping_pointer(),public.record_initial_source_mapping_revision(),
      public.revise_league_source_connection(uuid,text,uuid,text,text),public.validate_administration_observation_mapping() FROM league_one_runtime;
  END IF;
END; $$;

-- Same administration writer, with mapping checks and exact new-observation linkage.
CREATE OR REPLACE FUNCTION public.record_league_administration_observation(p_input jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE
  envelope jsonb:=p_input->'envelope'; scope_value jsonb:=p_input->'envelope'->'scope';
  provenance jsonb:=p_input->'envelope'->'provenance'; normalized jsonb:=p_input->'value';
  family_value text:=envelope->>'family'; week_value smallint:=COALESCE((envelope->>'week')::smallint,0);
  accepted_value boolean:=p_input->>'status'='accepted' AND envelope->>'completeness'='complete';
  season_row record; head public.league_administration_heads%ROWTYPE;
  content_row public.league_administration_contents%ROWTYPE; old_content public.league_administration_contents%ROWTYPE;
  observation_id uuid; version_id uuid; profile_id uuid; activation_id uuid; entity_id uuid; manager_id uuid;
  component_value jsonb; source_value jsonb; next_generation bigint; current_hash text;
  observed_time timestamptz:=(provenance->>'sourceObservedAt')::timestamptz;
  checked_time timestamptz:=(provenance->>'checkedAt')::timestamptz;
  started_time timestamptz:=(provenance->>'requestStartedAt')::timestamptz;
  completed_time timestamptz:=(provenance->>'requestCompletedAt')::timestamptz;
  order_time timestamptz; replay_value text; result_status text; conflict_reason text; new_content boolean;
  mapping jsonb:=p_input->'sourceMapping';
  exact_mapping boolean:=false; mapping_revision_id uuid;
  fence jsonb:=p_input->'writeFence';
  replay_row record; accepted_content_id uuid;
BEGIN
  IF envelope->>'schemaVersion' IS DISTINCT FROM 'league-administration-v1'
    OR envelope->>'normalizerVersion' IS DISTINCT FROM 'sleeper-administration-v1'
    OR envelope->>'dialect' IS DISTINCT FROM 'sleeper-nfl-v1'
    OR scope_value->>'provider' IS DISTINCT FROM 'sleeper'
    OR p_input->>'status' NOT IN ('accepted','rejected')
    OR jsonb_typeof(p_input->'diagnostics') IS DISTINCT FROM 'array'
    OR checked_time IS NULL OR checked_time>clock_timestamp()+interval '5 minutes'
    OR (observed_time IS NOT NULL AND observed_time>checked_time)
    OR (completed_time IS NOT NULL AND completed_time>checked_time)
    OR (started_time IS NOT NULL AND completed_time IS NOT NULL AND started_time>completed_time)
    OR (provenance->>'origin'='network' AND (started_time IS NULL OR completed_time IS NULL
      OR (accepted_value AND observed_time IS NULL)))
    OR (accepted_value AND normalized->>'family' IS DISTINCT FROM family_value) THEN
    RAISE EXCEPTION 'invalid league administration envelope';
  END IF;
  IF fence IS NOT NULL THEN
    PERFORM 1 FROM public.projection_jobs job WHERE job.job_key=fence->>'jobKey'
      AND job.state='running' AND job.lease_owner=fence->>'workerId'
      AND job.attempt_count=(fence->>'generation')::integer AND job.lease_until>clock_timestamp()
      AND (fence->>'deadlineAt')::timestamptz>clock_timestamp() FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'league administration writer fence is stale'; END IF;
  END IF;
  SELECT season.id,season.league_id,season.scoring_profile_id,profile.rules_hash
  INTO STRICT season_row FROM public.league_seasons season
  JOIN public.leagues league ON league.id=season.league_id
  JOIN public.scoring_profiles profile ON profile.id=season.scoring_profile_id
  JOIN public.league_source_connections connection ON connection.league_season_id=season.id
  JOIN public.league_administration_enrollment_seasons enrollment ON enrollment.league_id=league.id AND enrollment.season=season.season
  WHERE league.league_key=scope_value->>'leagueKey' AND season.season=(scope_value->>'season')::smallint
    AND connection.provider=scope_value->>'provider' AND connection.external_league_id=scope_value->>'externalLeagueId'
    AND enrollment.provider=connection.provider;
  PERFORM pg_advisory_xact_lock(hashtextextended('league-configuration:'||season_row.id::text,0));
  -- Lock the verified source identity too: an owner remap cannot race a capture.
  PERFORM 1 FROM public.league_source_connections WHERE league_season_id=season_row.id
    AND provider=scope_value->>'provider' AND external_league_id=scope_value->>'externalLeagueId' FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'league administration source connection changed'; END IF;
  -- Fence before any evidence insertion, replay, unchanged verification or head update.
  -- Legacy callers omit the token and retain explicitly unverified v1 behavior.
  IF mapping IS NOT NULL THEN
    IF family_value IS DISTINCT FROM 'rosters' OR jsonb_typeof(mapping) IS DISTINCT FROM 'object'
      OR mapping->'scope' IS DISTINCT FROM scope_value THEN
      RAISE EXCEPTION 'administration source mapping scope mismatch';
    END IF;
    PERFORM 1 FROM public.league_source_connections connection
      WHERE connection.league_season_id=season_row.id AND connection.provider=scope_value->>'provider'
        AND connection.external_league_id=scope_value->>'externalLeagueId'
        AND connection.id=(mapping->>'connectionId')::uuid
        AND connection.league_season_id=(mapping->>'leagueSeasonId')::uuid
        AND connection.current_mapping_revision_id=(mapping->>'revisionId')::uuid
        AND connection.mapping_generation=(mapping->>'generation')::bigint FOR SHARE;
    IF NOT FOUND THEN RAISE EXCEPTION 'administration source mapping revision is stale'; END IF;
    -- A cache check is fenced but cannot establish original capture lineage.
    exact_mapping:=provenance->>'origin'='network';
    IF exact_mapping THEN
      mapping_revision_id:=(mapping->>'revisionId')::uuid;
    END IF;
  END IF;
  INSERT INTO public.league_administration_heads(league_season_id,family,week)
    VALUES(season_row.id,family_value,week_value) ON CONFLICT DO NOTHING;
  SELECT * INTO STRICT head FROM public.league_administration_heads
    WHERE league_season_id=season_row.id AND family=family_value AND week=week_value FOR UPDATE;
  order_time:=COALESCE(observed_time,completed_time,checked_time);
  replay_value:=encode(digest(convert_to((jsonb_build_object('content',p_input->>'contentHash',
    'provenance',provenance,'completeness',envelope->>'completeness','status',p_input->>'status',
    'diagnostics',p_input->'diagnostics') || CASE WHEN mapping IS NULL THEN '{}'::jsonb
      ELSE jsonb_build_object('sourceMapping',mapping) END)::text,'UTF8'),'sha256'),'hex');
  SELECT observation.id,observation.outcome,content.configuration_version_id INTO replay_row
    FROM public.league_administration_observations observation
    JOIN public.league_administration_contents content ON content.id=observation.content_id
    WHERE observation.league_season_id=season_row.id AND observation.family=family_value
      AND observation.week=week_value AND observation.replay_key=replay_value;
  IF FOUND THEN RETURN jsonb_build_object('status',CASE
    WHEN replay_row.id=head.accepted_observation_id AND head.read_conflict IS NULL THEN 'replayed'
    WHEN replay_row.outcome='rejected' THEN 'rejected' ELSE 'stale' END,
    'observationId',replay_row.id,'versionId',replay_row.configuration_version_id,
    'generation',head.generation,'leagueSeasonId',season_row.id); END IF;
  IF accepted_value AND family_value='league' THEN
    IF normalized->>'externalLeagueId' IS DISTINCT FROM scope_value->>'externalLeagueId'
      OR normalized->>'season' IS DISTINCT FROM scope_value->>'season'
      OR jsonb_typeof(normalized->'components') IS DISTINCT FROM 'array' THEN
      RAISE EXCEPTION 'configuration identity does not match its approved source'; END IF;
    IF normalized->>'rawScoringRulesHash' IS NOT NULL THEN
      profile_id:=public.get_or_create_scoring_profile(normalized->>'rawScoringRulesHash',envelope->'payload'->'scoring_settings');
    END IF;
    INSERT INTO public.league_configuration_versions
      (league_season_id,dialect,normalizer_version,semantic_hash,scoring_profile_id,total_rosters,components)
    VALUES(season_row.id,envelope->>'dialect',envelope->>'normalizerVersion',p_input->>'semanticHash',
      profile_id,(normalized->>'totalRosters')::integer,normalized->'components') ON CONFLICT DO NOTHING;
    SELECT id INTO STRICT version_id FROM public.league_configuration_versions
      WHERE league_season_id=season_row.id AND normalizer_version=envelope->>'normalizerVersion'
        AND semantic_hash=p_input->>'semanticHash';
    IF profile_id IS DISTINCT FROM season_row.scoring_profile_id THEN
      conflict_reason:='scoring_profile_change_requires_explicit_compatibility_and_period_review';
    END IF;
  END IF;
  INSERT INTO public.league_administration_contents
    (league_season_id,provider,external_league_id,family,week,normalizer_version,content_hash,
      semantic_hash,completeness,accepted,payload,normalized_value,diagnostics,configuration_version_id)
  VALUES(season_row.id,scope_value->>'provider',scope_value->>'externalLeagueId',family_value,week_value,
    envelope->>'normalizerVersion',p_input->>'contentHash',p_input->>'semanticHash',envelope->>'completeness',
    accepted_value,envelope->'payload',normalized,p_input->'diagnostics',version_id)
  ON CONFLICT DO NOTHING RETURNING * INTO content_row;
  new_content:=FOUND;
  IF NOT new_content THEN
    SELECT * INTO STRICT content_row FROM public.league_administration_contents
      WHERE league_season_id=season_row.id AND provider=scope_value->>'provider'
        AND external_league_id=scope_value->>'externalLeagueId' AND family=family_value AND week=week_value
        AND normalizer_version=envelope->>'normalizerVersion' AND content_hash=p_input->>'contentHash'
        AND completeness=envelope->>'completeness' AND accepted=accepted_value;
    IF content_row.payload IS DISTINCT FROM envelope->'payload' OR content_row.normalized_value IS DISTINCT FROM normalized THEN
      RAISE EXCEPTION 'league administration content identity conflict'; END IF;
    version_id:=content_row.configuration_version_id;
  END IF;
  IF new_content AND accepted_value THEN
    IF family_value IN ('rosters','matchups') THEN
      FOR source_value IN SELECT value FROM jsonb_array_elements(CASE WHEN family_value='rosters'
        THEN normalized->'teams' ELSE normalized->'matchups' END) LOOP
        INSERT INTO public.league_season_teams(league_season_id,provider,external_league_id,external_roster_id)
        VALUES(season_row.id,'sleeper',scope_value->>'externalLeagueId',source_value->>'externalRosterId') ON CONFLICT DO NOTHING;
        SELECT id INTO STRICT entity_id FROM public.league_season_teams WHERE league_season_id=season_row.id
          AND provider='sleeper' AND external_league_id=scope_value->>'externalLeagueId'
          AND external_roster_id=source_value->>'externalRosterId';
        INSERT INTO public.league_administration_team_entries(content_id,league_season_id,team_id,source_value)
          VALUES(content_row.id,season_row.id,entity_id,source_value);
      END LOOP;
    END IF;
    IF family_value='users' THEN
      FOR source_value IN SELECT value FROM jsonb_array_elements(normalized->'managers') LOOP
        INSERT INTO public.league_source_manager_accounts(provider,external_manager_id)
          VALUES('sleeper',source_value->>'externalManagerId') ON CONFLICT DO NOTHING;
        SELECT id INTO STRICT manager_id FROM public.league_source_manager_accounts
          WHERE provider='sleeper' AND external_manager_id=source_value->>'externalManagerId';
        INSERT INTO public.league_administration_manager_entries(content_id,manager_id,source_value)
          VALUES(content_row.id,manager_id,source_value);
      END LOOP;
    ELSIF family_value='rosters' THEN
      FOR source_value IN SELECT value FROM jsonb_array_elements(normalized->'memberships') LOOP
        INSERT INTO public.league_source_manager_accounts(provider,external_manager_id)
          VALUES('sleeper',source_value->>'externalManagerId') ON CONFLICT DO NOTHING;
        SELECT id INTO STRICT manager_id FROM public.league_source_manager_accounts
          WHERE provider='sleeper' AND external_manager_id=source_value->>'externalManagerId';
        SELECT id INTO STRICT entity_id FROM public.league_season_teams WHERE league_season_id=season_row.id
          AND provider='sleeper' AND external_league_id=scope_value->>'externalLeagueId'
          AND external_roster_id=source_value->>'externalRosterId';
        INSERT INTO public.league_administration_memberships(content_id,league_season_id,team_id,manager_id,role)
          VALUES(content_row.id,season_row.id,entity_id,manager_id,source_value->>'role');
      END LOOP;
    ELSIF family_value='transactions' THEN
      FOR source_value IN SELECT value FROM jsonb_array_elements(normalized->'transactions') LOOP
        INSERT INTO public.league_administration_transaction_entries(content_id,external_transaction_id,source_value)
          VALUES(content_row.id,source_value->>'externalTransactionId',source_value);
      END LOOP;
    END IF;
  END IF;
  SELECT content.* INTO old_content FROM public.league_administration_observations observation
    JOIN public.league_administration_contents content ON content.id=observation.content_id
    WHERE observation.id=head.latest_observation_id;
  SELECT content_id INTO accepted_content_id FROM public.league_administration_observations
    WHERE id=head.accepted_observation_id;
  -- A cache with unknown provider observation time can reuse an identical
  -- accepted document, but cannot refresh its source freshness or ordering.
  IF observed_time IS NULL AND provenance->>'origin'<>'network' AND accepted_value
    AND accepted_content_id=content_row.id AND head.read_conflict IS NULL THEN
    RETURN jsonb_build_object('status','unchanged','observationId',head.accepted_observation_id,
      'versionId',version_id,'generation',head.generation,'leagueSeasonId',season_row.id);
  END IF;
  result_status:=CASE
    WHEN head.ordering_at IS NOT NULL AND (order_time<head.ordering_at
      OR (observed_time IS NULL AND provenance->>'origin'<>'network')) THEN 'stale'
    WHEN NOT accepted_value OR conflict_reason IS NOT NULL THEN 'rejected'
    WHEN old_content.id=content_row.id OR (family_value<>'league' AND old_content.accepted
      AND old_content.semantic_hash=content_row.semantic_hash) THEN 'unchanged' ELSE 'changed' END;
  IF head.ordering_at=order_time AND old_content.id IS DISTINCT FROM content_row.id THEN
    result_status:='rejected'; conflict_reason:='equal_source_time_has_different_content';
  END IF;
  IF NOT accepted_value THEN conflict_reason:=head.read_conflict; END IF;
  -- Identical raw content needs only a freshness update. A reordered collection
  -- retains its distinct raw evidence and observation without a semantic change.
  -- League operational counters still advance raw evidence independently of settings.
  IF result_status='unchanged' AND head.read_conflict IS NULL AND old_content.id=content_row.id
    AND (NOT exact_mapping OR EXISTS (SELECT 1 FROM public.league_administration_observation_mappings
      WHERE observation_id=head.accepted_observation_id AND source_mapping_revision_id=mapping_revision_id)) THEN
    IF fence IS NOT NULL AND (NOT EXISTS (SELECT 1 FROM public.projection_jobs WHERE job_key=fence->>'jobKey'
      AND lease_until>clock_timestamp()) OR (fence->>'deadlineAt')::timestamptz<=clock_timestamp()) THEN
      RAISE EXCEPTION 'league administration writer fence expired'; END IF;
    UPDATE public.league_administration_heads SET checked_at=GREATEST(checked_at,checked_time),
      verified_at=CASE WHEN provenance->>'origin'='network' THEN GREATEST(verified_at,observed_time) ELSE verified_at END,
      attempted_at=GREATEST(attempted_at,checked_time),ordering_at=order_time
      WHERE league_season_id=season_row.id AND family=family_value AND week=week_value;
    RETURN jsonb_build_object('status','unchanged','observationId',head.accepted_observation_id,
      'versionId',version_id,'generation',head.generation,'leagueSeasonId',season_row.id);
  END IF;
  INSERT INTO public.league_administration_observations
    (league_season_id,family,week,content_id,origin,request_started_at,request_completed_at,
      source_observed_at,checked_at,ordering_at,replay_key,diagnostics,outcome)
  VALUES(season_row.id,family_value,week_value,content_row.id,provenance->>'origin',started_time,completed_time,
    observed_time,checked_time,order_time,replay_value,p_input->'diagnostics',result_status) RETURNING id INTO observation_id;
  IF exact_mapping THEN
    INSERT INTO public.league_administration_observation_mappings(observation_id,source_mapping_revision_id)
      VALUES(observation_id,mapping_revision_id);
  END IF;
  IF result_status<>'stale' THEN
    IF fence IS NOT NULL AND (NOT EXISTS (SELECT 1 FROM public.projection_jobs WHERE job_key=fence->>'jobKey'
      AND lease_until>clock_timestamp()) OR (fence->>'deadlineAt')::timestamptz<=clock_timestamp()) THEN
      RAISE EXCEPTION 'league administration writer fence expired'; END IF;
    UPDATE public.league_administration_heads SET latest_observation_id=observation_id,
      accepted_observation_id=CASE WHEN result_status IN ('changed','unchanged') THEN observation_id ELSE accepted_observation_id END,
      generation=generation+CASE WHEN result_status='unchanged' AND head.read_conflict IS NULL THEN 0 ELSE 1 END,
      ordering_at=order_time,attempted_at=GREATEST(attempted_at,checked_time),
      checked_at=CASE WHEN result_status IN ('changed','unchanged') THEN GREATEST(checked_at,checked_time) ELSE checked_at END,
      verified_at=CASE WHEN result_status IN ('changed','unchanged') AND provenance->>'origin'='network'
        THEN GREATEST(verified_at,observed_time)
        WHEN result_status IN ('changed','unchanged') THEN NULL ELSE verified_at END,
      read_conflict=conflict_reason
      WHERE league_season_id=season_row.id AND family=family_value AND week=week_value
      RETURNING generation INTO head.generation;
    IF accepted_value AND family_value='league' AND conflict_reason IS DISTINCT FROM 'equal_source_time_has_different_content' THEN
      FOR component_value IN SELECT value FROM jsonb_array_elements(normalized->'components') LOOP
        IF component_value->>'name'='scoring' AND profile_id IS DISTINCT FROM season_row.scoring_profile_id THEN CONTINUE; END IF;
        SELECT activation.component_hash INTO current_hash FROM public.league_configuration_heads pointer
          JOIN public.league_configuration_activations activation ON activation.id=pointer.activation_id
          WHERE pointer.league_season_id=season_row.id AND pointer.component=component_value->>'name';
        IF current_hash IS NOT DISTINCT FROM component_value->>'hash' THEN CONTINUE; END IF;
        SELECT COALESCE(max(generation),0)+1 INTO next_generation FROM public.league_configuration_activations
          WHERE league_season_id=season_row.id AND component=component_value->>'name';
        INSERT INTO public.league_configuration_activations(league_season_id,configuration_version_id,observation_id,
          component,component_hash,applicability,evidence,generation)
        VALUES(season_row.id,version_id,observation_id,component_value->>'name',component_value->>'hash',
          'observed_current','source observation; historical effective period unknown',next_generation) RETURNING id INTO activation_id;
        INSERT INTO public.league_configuration_heads(league_season_id,component,activation_id)
          VALUES(season_row.id,component_value->>'name',activation_id)
          ON CONFLICT (league_season_id,component) DO UPDATE SET activation_id=EXCLUDED.activation_id;
      END LOOP;
    END IF;
  END IF;
  RETURN jsonb_build_object('status',result_status,'observationId',observation_id,'versionId',version_id,
    'generation',head.generation,'leagueSeasonId',season_row.id,'reason',CASE
      WHEN result_status='stale' AND observed_time IS NULL AND provenance->>'origin'<>'network'
      THEN 'unproven_cache_change' ELSE conflict_reason END);
END; $$;
