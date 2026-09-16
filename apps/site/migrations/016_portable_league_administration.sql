-- Portable Sleeper administration. Source evidence and applicability are distinct;
-- this migration never changes an existing season's scoring profile or snapshots.
CREATE TABLE public.league_administration_enrollments (
  league_id uuid PRIMARY KEY REFERENCES public.leagues(id),
  provider text NOT NULL CHECK (provider = 'sleeper'),
  active boolean NOT NULL DEFAULT true,
  evidence text NOT NULL CHECK (btrim(evidence) <> ''),
  enrolled_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
INSERT INTO public.league_administration_enrollments (league_id,provider,evidence)
SELECT DISTINCT league.id,'sleeper','016: existing registered Sleeper connection'
FROM public.leagues league JOIN public.league_seasons season ON season.league_id=league.id
JOIN public.league_source_connections connection ON connection.league_season_id=season.id
WHERE league.league_key IN ('league1','league2','dynasty') AND connection.provider='sleeper';

-- Intended season membership is independent of registration completeness. A
-- missing profile/connection must fail a group, never silently shrink it.
CREATE TABLE public.league_administration_enrollment_seasons (
  league_id uuid NOT NULL REFERENCES public.leagues(id),
  season smallint NOT NULL CHECK (season BETWEEN 1920 AND 2200),
  provider text NOT NULL CHECK (provider='sleeper'),
  evidence text NOT NULL CHECK (btrim(evidence)<>''),
  recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (league_id,season)
);
INSERT INTO public.league_administration_enrollment_seasons(league_id,season,provider,evidence)
SELECT season.league_id,season.season,'sleeper','016: existing registered season membership'
FROM public.league_seasons season JOIN public.league_administration_enrollments enrollment
  ON enrollment.league_id=season.league_id JOIN public.league_source_connections connection
  ON connection.league_season_id=season.id AND connection.provider='sleeper';

CREATE TABLE public.league_source_connection_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  league_season_id uuid NOT NULL REFERENCES public.league_seasons(id),
  provider text NOT NULL,
  previous_external_league_id text,
  external_league_id text NOT NULL CHECK (btrim(external_league_id) <> ''),
  evidence text NOT NULL CHECK (btrim(evidence) <> ''),
  recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  transaction_id bigint NOT NULL DEFAULT txid_current()
);
INSERT INTO public.league_source_connection_history
  (league_season_id,provider,external_league_id,evidence)
SELECT league_season_id,provider,external_league_id,'016: existing registered connection'
FROM public.league_source_connections;

CREATE TABLE public.league_configuration_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  league_season_id uuid NOT NULL REFERENCES public.league_seasons(id),
  dialect text NOT NULL CHECK (dialect='sleeper-nfl-v1'),
  normalizer_version text NOT NULL,
  semantic_hash text NOT NULL CHECK (semantic_hash ~ '^(sha256:)?[0-9a-f]{64}$'),
  scoring_profile_id uuid REFERENCES public.scoring_profiles(id),
  total_rosters integer CHECK (total_rosters > 0),
  components jsonb NOT NULL CHECK (jsonb_typeof(components)='array'),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (league_season_id,normalizer_version,semantic_hash),
  UNIQUE (id,league_season_id)
);
CREATE TABLE public.league_administration_contents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  league_season_id uuid NOT NULL REFERENCES public.league_seasons(id),
  provider text NOT NULL CHECK (provider='sleeper'),
  external_league_id text NOT NULL,
  family text NOT NULL CHECK (family IN ('league','rosters','users','matchups','transactions','drafts','traded_picks','winners_bracket','losers_bracket')),
  week smallint NOT NULL CHECK (week BETWEEN 0 AND 30),
  normalizer_version text NOT NULL,
  content_hash text NOT NULL CHECK (content_hash ~ '^(sha256:)?[0-9a-f]{64}$'),
  semantic_hash text CHECK (semantic_hash ~ '^(sha256:)?[0-9a-f]{64}$'),
  completeness text NOT NULL CHECK (completeness IN ('complete','partial')),
  accepted boolean NOT NULL,
  payload jsonb NOT NULL,
  normalized_value jsonb,
  diagnostics jsonb NOT NULL CHECK (jsonb_typeof(diagnostics)='array'),
  configuration_version_id uuid,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CHECK ((family='matchups' AND week>0) OR family='transactions'
    OR (family IN ('league','rosters','users','drafts','traded_picks','winners_bracket','losers_bracket') AND week=0)),
  FOREIGN KEY (configuration_version_id,league_season_id)
    REFERENCES public.league_configuration_versions(id,league_season_id),
  UNIQUE (league_season_id,provider,external_league_id,family,week,normalizer_version,content_hash,completeness,accepted),
  UNIQUE (id,league_season_id,family,week)
);
CREATE TABLE public.league_administration_observations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  league_season_id uuid NOT NULL REFERENCES public.league_seasons(id),
  family text NOT NULL,
  week smallint NOT NULL,
  content_id uuid NOT NULL,
  origin text NOT NULL CHECK (origin IN ('network','cache','bootstrap')),
  request_started_at timestamptz,
  request_completed_at timestamptz,
  source_observed_at timestamptz,
  checked_at timestamptz NOT NULL,
  ordering_at timestamptz NOT NULL,
  replay_key text NOT NULL,
  diagnostics jsonb NOT NULL CHECK (jsonb_typeof(diagnostics)='array'),
  outcome text NOT NULL CHECK (outcome IN ('changed','unchanged','stale','rejected')),
  recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  FOREIGN KEY (content_id,league_season_id,family,week)
    REFERENCES public.league_administration_contents(id,league_season_id,family,week),
  CHECK (request_started_at IS NULL OR request_completed_at IS NULL OR request_started_at<=request_completed_at),
  UNIQUE (league_season_id,family,week,replay_key),
  UNIQUE (id,league_season_id),
  UNIQUE (id,league_season_id,family,week)
);
CREATE TABLE public.league_administration_heads (
  league_season_id uuid NOT NULL REFERENCES public.league_seasons(id),
  family text NOT NULL CHECK (family IN ('league','rosters','users','matchups','transactions','drafts','traded_picks','winners_bracket','losers_bracket')),
  week smallint NOT NULL,
  latest_observation_id uuid,
  accepted_observation_id uuid,
  generation bigint NOT NULL DEFAULT 0 CHECK (generation>=0),
  ordering_at timestamptz,
  checked_at timestamptz,
  verified_at timestamptz,
  attempted_at timestamptz,
  read_conflict text,
  CHECK (verified_at IS NULL OR (checked_at IS NOT NULL AND verified_at<=checked_at)),
  PRIMARY KEY (league_season_id,family,week),
  FOREIGN KEY (latest_observation_id,league_season_id,family,week)
    REFERENCES public.league_administration_observations(id,league_season_id,family,week),
  FOREIGN KEY (accepted_observation_id,league_season_id,family,week)
    REFERENCES public.league_administration_observations(id,league_season_id,family,week),
  CHECK ((family='matchups' AND week>0) OR family='transactions'
    OR (family IN ('league','rosters','users','drafts','traded_picks','winners_bracket','losers_bracket') AND week=0)),
  CHECK (week BETWEEN 0 AND 30)
);
CREATE TABLE public.league_configuration_activations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  league_season_id uuid NOT NULL REFERENCES public.league_seasons(id),
  configuration_version_id uuid NOT NULL,
  observation_id uuid,
  component text NOT NULL CHECK (component IN ('scoring','roster','competition','display','extensions')),
  component_hash text NOT NULL CHECK (component_hash ~ '^(sha256:)?[0-9a-f]{64}$'),
  applicability text NOT NULL CHECK (applicability IN ('observed_current','evidenced_period')),
  season_type text,
  from_week smallint,
  through_week smallint,
  evidence text NOT NULL CHECK (btrim(evidence) <> ''),
  generation bigint NOT NULL CHECK (generation > 0),
  recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  FOREIGN KEY (configuration_version_id,league_season_id)
    REFERENCES public.league_configuration_versions(id,league_season_id),
  FOREIGN KEY (observation_id,league_season_id)
    REFERENCES public.league_administration_observations(id,league_season_id),
  CHECK ((applicability='observed_current' AND season_type IS NULL AND from_week IS NULL AND through_week IS NULL)
    OR (applicability='evidenced_period' AND season_type IS NOT NULL AND from_week IS NOT NULL AND through_week IS NOT NULL
      AND btrim(season_type)<>'' AND from_week BETWEEN 1 AND 30
      AND through_week BETWEEN from_week AND 30)),
  UNIQUE (league_season_id,component,generation),
  UNIQUE (id,league_season_id,component)
);
CREATE INDEX league_configuration_period_lookup ON public.league_configuration_activations
  (league_season_id,component,season_type,from_week,through_week,generation DESC)
  WHERE applicability='evidenced_period';
CREATE TABLE public.league_configuration_heads (
  league_season_id uuid NOT NULL REFERENCES public.league_seasons(id),
  component text NOT NULL,
  activation_id uuid NOT NULL,
  PRIMARY KEY (league_season_id,component),
  FOREIGN KEY (activation_id,league_season_id,component)
    REFERENCES public.league_configuration_activations(id,league_season_id,component)
);

-- Canonical team identity is season scoped. Provider manager accounts are not
-- app login accounts or inferred cross-provider people/franchises.
CREATE TABLE public.league_season_teams (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  league_season_id uuid NOT NULL REFERENCES public.league_seasons(id),
  provider text NOT NULL CHECK (provider='sleeper'),
  external_league_id text NOT NULL,
  external_roster_id text NOT NULL CHECK (btrim(external_roster_id)<>''),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (league_season_id,provider,external_league_id,external_roster_id),
  UNIQUE (id,league_season_id)
);
CREATE TABLE public.league_source_manager_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider text NOT NULL CHECK (provider='sleeper'),
  external_manager_id text NOT NULL CHECK (btrim(external_manager_id)<>''),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (provider,external_manager_id)
);
CREATE TABLE public.league_administration_team_entries (
  content_id uuid NOT NULL REFERENCES public.league_administration_contents(id),
  league_season_id uuid NOT NULL,
  team_id uuid NOT NULL,
  source_value jsonb NOT NULL CHECK (jsonb_typeof(source_value)='object'),
  PRIMARY KEY (content_id,team_id),
  FOREIGN KEY (team_id,league_season_id) REFERENCES public.league_season_teams(id,league_season_id)
);
CREATE TABLE public.league_administration_manager_entries (
  content_id uuid NOT NULL REFERENCES public.league_administration_contents(id),
  manager_id uuid NOT NULL REFERENCES public.league_source_manager_accounts(id),
  source_value jsonb NOT NULL CHECK (jsonb_typeof(source_value)='object'),
  PRIMARY KEY (content_id,manager_id)
);
CREATE TABLE public.league_administration_memberships (
  content_id uuid NOT NULL REFERENCES public.league_administration_contents(id),
  league_season_id uuid NOT NULL,
  team_id uuid NOT NULL,
  manager_id uuid NOT NULL REFERENCES public.league_source_manager_accounts(id),
  role text NOT NULL CHECK (role IN ('owner','co_owner')),
  PRIMARY KEY (content_id,team_id,manager_id,role),
  FOREIGN KEY (team_id,league_season_id) REFERENCES public.league_season_teams(id,league_season_id)
);
CREATE TABLE public.league_administration_transaction_entries (
  content_id uuid NOT NULL REFERENCES public.league_administration_contents(id),
  external_transaction_id text NOT NULL CHECK (btrim(external_transaction_id)<>''),
  source_value jsonb NOT NULL CHECK (jsonb_typeof(source_value)='object'),
  PRIMARY KEY (content_id,external_transaction_id)
);

CREATE FUNCTION public.prevent_league_administration_history_change()
RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN RAISE EXCEPTION 'league administration history is immutable'; END; $$;
DO $$ DECLARE object_name text; BEGIN
  FOREACH object_name IN ARRAY ARRAY['league_administration_enrollment_seasons','league_source_connection_history','league_configuration_versions',
    'league_administration_contents','league_administration_observations','league_configuration_activations',
    'league_season_teams','league_source_manager_accounts','league_administration_team_entries',
    'league_administration_manager_entries','league_administration_memberships','league_administration_transaction_entries']
  LOOP
    EXECUTE format('CREATE TRIGGER immutable_history BEFORE UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.prevent_league_administration_history_change()',object_name);
  END LOOP;
END; $$;

CREATE FUNCTION public.record_league_administration_observation(p_input jsonb)
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
  INSERT INTO public.league_administration_heads(league_season_id,family,week)
    VALUES(season_row.id,family_value,week_value) ON CONFLICT DO NOTHING;
  SELECT * INTO STRICT head FROM public.league_administration_heads
    WHERE league_season_id=season_row.id AND family=family_value AND week=week_value FOR UPDATE;
  order_time:=COALESCE(observed_time,completed_time,checked_time);
  replay_value:=encode(digest(convert_to(jsonb_build_object('content',p_input->>'contentHash',
    'provenance',provenance,'completeness',envelope->>'completeness','status',p_input->>'status',
    'diagnostics',p_input->'diagnostics')::text,'UTF8'),'sha256'),'hex');
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
  IF result_status='unchanged' AND head.read_conflict IS NULL AND old_content.id=content_row.id THEN
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

CREATE FUNCTION public.guard_league_administration_entry()
RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE content_row public.league_administration_contents%ROWTYPE;
BEGIN
  SELECT * INTO STRICT content_row FROM public.league_administration_contents WHERE id=NEW.content_id;
  IF EXISTS (SELECT 1 FROM public.league_administration_observations WHERE content_id=NEW.content_id) THEN
    RAISE EXCEPTION 'observed league administration content is sealed'; END IF;
  IF NOT content_row.accepted THEN RAISE EXCEPTION 'rejected source content cannot have accepted entries'; END IF;
  IF TG_TABLE_NAME IN ('league_administration_team_entries','league_administration_memberships') THEN
    IF (to_jsonb(NEW)->>'league_season_id')::uuid<>content_row.league_season_id THEN
      RAISE EXCEPTION 'administration entry scope mismatch'; END IF;
  END IF;
  IF (TG_TABLE_NAME='league_administration_memberships' AND content_row.family<>'rosters')
    OR (TG_TABLE_NAME='league_administration_team_entries' AND content_row.family NOT IN ('rosters','matchups'))
    OR (TG_TABLE_NAME='league_administration_manager_entries' AND content_row.family<>'users')
    OR (TG_TABLE_NAME='league_administration_transaction_entries' AND content_row.family<>'transactions') THEN
    RAISE EXCEPTION 'administration entry family mismatch'; END IF;
  RETURN NEW;
END; $$;
DO $$ DECLARE object_name text; BEGIN
  FOREACH object_name IN ARRAY ARRAY['league_administration_team_entries','league_administration_manager_entries',
    'league_administration_memberships','league_administration_transaction_entries'] LOOP
    EXECUTE format('CREATE TRIGGER seal_entries BEFORE INSERT ON public.%I FOR EACH ROW EXECUTE FUNCTION public.guard_league_administration_entry()',object_name);
  END LOOP;
END; $$;

CREATE FUNCTION public.validate_official_administration_lineage()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE context_value jsonb:=NEW.source_data->'administration';
BEGIN
  IF context_value IS NULL THEN RETURN NEW; END IF;
  PERFORM 1 FROM public.league_source_connections
    WHERE league_season_id=NEW.league_season_id AND provider=NEW.provider FOR SHARE;
  PERFORM 1 FROM public.league_administration_heads
    WHERE league_season_id=NEW.league_season_id AND family='league' AND week=0 FOR SHARE;
  IF jsonb_typeof(context_value)<>'object' OR NOT EXISTS (
    SELECT 1 FROM public.league_administration_heads head
    JOIN public.league_administration_observations observation ON observation.id=head.accepted_observation_id
    JOIN public.league_administration_contents content ON content.id=observation.content_id
    WHERE head.league_season_id=NEW.league_season_id AND head.family='league' AND head.week=0
      AND head.read_conflict IS NULL AND head.generation=(context_value->>'generation')::bigint
      AND observation.id=(context_value->>'observationId')::uuid
      AND content.configuration_version_id=(context_value->>'configurationVersionId')::uuid
      AND content.accepted AND content.completeness='complete'
      AND content.provider=NEW.provider
      AND EXISTS (SELECT 1 FROM public.league_source_connections connection
        WHERE connection.league_season_id=NEW.league_season_id AND connection.provider=NEW.provider
          AND connection.external_league_id=content.external_league_id)
  ) THEN RAISE EXCEPTION 'official observation administration lineage is stale or mismatched'; END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER official_administration_lineage BEFORE INSERT ON public.league_week_observations
FOR EACH ROW EXECUTE FUNCTION public.validate_official_administration_lineage();

-- Publication rechecks the verification observation, which may be newer than
-- an immutable snapshot reused because its displayed content is unchanged.
CREATE FUNCTION public.validate_published_administration_lineage()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE source_row public.league_week_observations%ROWTYPE; context_value jsonb;
BEGIN
  SELECT observation.* INTO source_row FROM public.league_week_observations observation
    WHERE observation.id=COALESCE(NEW.verification_source_observation_id,
      (SELECT league_week_observation_id FROM public.projection_snapshots WHERE id=NEW.snapshot_id))
      AND observation.league_season_id=NEW.league_season_id AND observation.week=NEW.week;
  IF NOT FOUND THEN RAISE EXCEPTION 'published snapshot administration lineage has a mismatched source scope'; END IF;
  context_value:=source_row.source_data->'administration';
  IF context_value IS NULL THEN RETURN NEW; END IF;
  PERFORM 1 FROM public.league_source_connections
    WHERE league_season_id=NEW.league_season_id AND provider=source_row.provider FOR SHARE;
  PERFORM 1 FROM public.league_administration_heads
    WHERE league_season_id=NEW.league_season_id AND family='league' AND week=0 FOR SHARE;
  IF jsonb_typeof(context_value)<>'object' OR NOT EXISTS (
    SELECT 1 FROM public.league_administration_heads head
    JOIN public.league_administration_observations observation ON observation.id=head.accepted_observation_id
    JOIN public.league_administration_contents content ON content.id=observation.content_id
    WHERE head.league_season_id=NEW.league_season_id AND head.family='league' AND head.week=0
      AND head.read_conflict IS NULL AND head.generation=(context_value->>'generation')::bigint
      AND observation.id=(context_value->>'observationId')::uuid
      AND content.configuration_version_id=(context_value->>'configurationVersionId')::uuid
      AND content.accepted AND content.completeness='complete' AND content.provider=source_row.provider
      AND EXISTS (SELECT 1 FROM public.league_source_connections connection
        WHERE connection.league_season_id=NEW.league_season_id AND connection.provider=source_row.provider
          AND connection.external_league_id=content.external_league_id)
  ) THEN RAISE EXCEPTION 'published snapshot administration lineage is stale or mismatched'; END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER published_administration_lineage BEFORE INSERT OR UPDATE ON public.current_projection_snapshots
FOR EACH ROW EXECUTE FUNCTION public.validate_published_administration_lineage();

CREATE FUNCTION public.guard_league_source_connection_history()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'source connections require an evidenced owner remap'; END IF;
  IF TG_OP='UPDATE' AND (NEW.league_season_id IS DISTINCT FROM OLD.league_season_id OR NEW.provider IS DISTINCT FROM OLD.provider) THEN
    RAISE EXCEPTION 'source connection season and provider are immutable'; END IF;
  IF TG_OP='UPDATE' AND NEW.external_league_id IS DISTINCT FROM OLD.external_league_id THEN
    IF NOT EXISTS (SELECT 1 FROM public.league_source_connection_history history
      WHERE history.league_season_id=OLD.league_season_id AND history.provider=OLD.provider
        AND history.previous_external_league_id=OLD.external_league_id
        AND history.external_league_id=NEW.external_league_id AND history.transaction_id=txid_current()) THEN
      RAISE EXCEPTION 'source connections require an evidenced owner remap';
    END IF;
  ELSIF TG_OP='INSERT' THEN
    IF EXISTS (SELECT 1 FROM public.league_seasons season
      JOIN public.league_administration_enrollments enrollment ON enrollment.league_id=season.league_id
      WHERE season.id=NEW.league_season_id)
      AND NOT EXISTS (SELECT 1 FROM public.league_source_connection_history history
        WHERE history.league_season_id=NEW.league_season_id AND history.provider=NEW.provider
          AND history.external_league_id=NEW.external_league_id AND history.transaction_id=txid_current()) THEN
      RAISE EXCEPTION 'enrolled league annual source requires evidenced owner continuity approval';
    END IF;
    IF EXISTS (SELECT 1 FROM public.league_source_connection_history history
      WHERE history.league_season_id=NEW.league_season_id AND history.provider=NEW.provider
        AND history.external_league_id=NEW.external_league_id AND history.transaction_id=txid_current()) THEN RETURN NEW; END IF;
    INSERT INTO public.league_source_connection_history
      (league_season_id,provider,external_league_id,evidence)
    VALUES (NEW.league_season_id,NEW.provider,NEW.external_league_id,'registered season source connection');
  END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER guard_administration_connection BEFORE UPDATE OR DELETE
ON public.league_source_connections FOR EACH ROW EXECUTE FUNCTION public.guard_league_source_connection_history();
CREATE TRIGGER record_administration_connection AFTER INSERT
ON public.league_source_connections FOR EACH ROW EXECUTE FUNCTION public.guard_league_source_connection_history();

CREATE FUNCTION public.remap_league_source_connection(
  p_season_id uuid,p_provider text,p_expected_external_id text,p_external_id text,p_evidence text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE existing_id text;
BEGIN
  IF btrim(COALESCE(p_evidence,''))='' OR btrim(COALESCE(p_external_id,''))='' THEN
    RAISE EXCEPTION 'source remap requires evidence and target'; END IF;
  SELECT external_league_id INTO STRICT existing_id FROM public.league_source_connections
    WHERE league_season_id=p_season_id AND provider=p_provider FOR UPDATE;
  IF existing_id IS DISTINCT FROM p_expected_external_id THEN RAISE EXCEPTION 'source remap compare-and-swap conflict'; END IF;
  IF existing_id=p_external_id THEN RETURN; END IF;
  INSERT INTO public.league_source_connection_history
    (league_season_id,provider,previous_external_league_id,external_league_id,evidence)
  VALUES (p_season_id,p_provider,existing_id,p_external_id,p_evidence);
  UPDATE public.league_source_connections SET external_league_id=p_external_id,connected_at=clock_timestamp()
    WHERE league_season_id=p_season_id AND provider=p_provider;
  UPDATE public.league_administration_heads SET read_conflict='source_connection_remapped',generation=generation+1
    WHERE league_season_id=p_season_id;
END; $$;

CREATE FUNCTION public.connect_league_administration_season(
  p_league_id uuid,p_season smallint,p_previous_external_id text,p_external_id text,
  p_rules_hash text,p_rules jsonb,p_evidence text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE previous_id text; previous_season smallint; profile_id uuid; season_id uuid;
BEGIN
  IF btrim(COALESCE(p_evidence,''))='' OR btrim(COALESCE(p_external_id,''))='' THEN
    RAISE EXCEPTION 'annual connection requires evidence and target'; END IF;
  PERFORM 1 FROM public.leagues WHERE id=p_league_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'unknown canonical league'; END IF;
  SELECT connection.external_league_id,season.season INTO STRICT previous_id,previous_season
    FROM public.league_seasons season JOIN public.league_source_connections connection
      ON connection.league_season_id=season.id AND connection.provider='sleeper'
    WHERE season.league_id=p_league_id ORDER BY season.season DESC LIMIT 1;
  IF previous_id IS DISTINCT FROM p_previous_external_id OR p_season<>previous_season+1 THEN
    RAISE EXCEPTION 'annual source continuity compare-and-swap conflict'; END IF;
  profile_id:=public.get_or_create_scoring_profile(p_rules_hash,p_rules);
  INSERT INTO public.league_seasons(league_id,season,scoring_profile_id)
    VALUES(p_league_id,p_season,profile_id) RETURNING id INTO season_id;
  INSERT INTO public.league_source_connection_history
    (league_season_id,provider,previous_external_league_id,external_league_id,evidence)
    VALUES(season_id,'sleeper',previous_id,p_external_id,p_evidence);
  INSERT INTO public.league_source_connections(league_season_id,provider,external_league_id)
    VALUES(season_id,'sleeper',p_external_id);
  INSERT INTO public.league_administration_enrollment_seasons(league_id,season,provider,evidence)
    VALUES(p_league_id,p_season,'sleeper',p_evidence) ON CONFLICT DO NOTHING;
  RETURN season_id;
END; $$;

-- Explicit corrections append a component-specific evidenced range. Overlapping
-- corrections resolve by greatest generation; previous decisions remain intact.
CREATE FUNCTION public.activate_league_configuration_component(
  p_version_id uuid,p_component text,p_season_type text,p_from_week smallint,p_through_week smallint,
  p_evidence text,p_expected_generation bigint)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE version_row public.league_configuration_versions%ROWTYPE; component_value jsonb; next_generation bigint; activation_id uuid;
BEGIN
  SELECT * INTO STRICT version_row FROM public.league_configuration_versions WHERE id=p_version_id;
  PERFORM pg_advisory_xact_lock(hashtextextended('league-configuration:'||version_row.league_season_id::text,0));
  SELECT value INTO STRICT component_value FROM jsonb_array_elements(version_row.components)
    WHERE value->>'name'=p_component;
  SELECT COALESCE(max(generation),0)+1 INTO next_generation FROM public.league_configuration_activations
    WHERE league_season_id=version_row.league_season_id AND component=p_component;
  IF next_generation-1<>p_expected_generation THEN RAISE EXCEPTION 'configuration activation compare-and-swap conflict'; END IF;
  INSERT INTO public.league_configuration_activations
    (league_season_id,configuration_version_id,component,component_hash,applicability,
      season_type,from_week,through_week,evidence,generation)
  VALUES (version_row.league_season_id,p_version_id,p_component,component_value->>'hash','evidenced_period',
    p_season_type,p_from_week,p_through_week,p_evidence,next_generation) RETURNING id INTO activation_id;
  RETURN activation_id;
END; $$;

-- Explicit, exact privileges: history and pointer tables are read-only to the
-- runtime role. Only the atomic source writer is an application entry point.
DO $$ DECLARE object_name text; BEGIN
  FOREACH object_name IN ARRAY ARRAY['league_administration_enrollments','league_administration_enrollment_seasons','league_source_connection_history',
    'league_configuration_versions','league_administration_contents','league_administration_observations',
    'league_administration_heads','league_configuration_activations','league_configuration_heads',
    'league_season_teams','league_source_manager_accounts','league_administration_team_entries',
    'league_administration_manager_entries','league_administration_memberships','league_administration_transaction_entries'] LOOP
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM PUBLIC',object_name);
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='league_one_runtime') THEN
      EXECUTE format('REVOKE ALL ON TABLE public.%I FROM league_one_runtime',object_name);
      EXECUTE format('GRANT SELECT ON TABLE public.%I TO league_one_runtime',object_name);
    END IF;
  END LOOP;
END; $$;
REVOKE ALL ON FUNCTION public.prevent_league_administration_history_change() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.guard_league_source_connection_history() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.guard_league_administration_entry() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.validate_official_administration_lineage() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.validate_published_administration_lineage() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.record_league_administration_observation(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.remap_league_source_connection(uuid,text,text,text,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.connect_league_administration_season(uuid,smallint,text,text,text,jsonb,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.activate_league_configuration_component(uuid,text,text,smallint,smallint,text,bigint) FROM PUBLIC;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='league_one_runtime') THEN
    REVOKE ALL ON FUNCTION public.remap_league_source_connection(uuid,text,text,text,text) FROM league_one_runtime;
    REVOKE ALL ON FUNCTION public.connect_league_administration_season(uuid,smallint,text,text,text,jsonb,text) FROM league_one_runtime;
    REVOKE ALL ON FUNCTION public.activate_league_configuration_component(uuid,text,text,smallint,smallint,text,bigint) FROM league_one_runtime;
    GRANT EXECUTE ON FUNCTION public.record_league_administration_observation(jsonb) TO league_one_runtime;
  END IF;
END; $$;
