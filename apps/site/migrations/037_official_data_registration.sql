-- R037: retain official preconfiguration data without fabricating calculation rules.
-- No existing season is backfilled. The original foreign key and immutable season
-- profile/source identity guards remain installed, including NULL <-> profile.
ALTER TABLE public.league_seasons ALTER COLUMN scoring_profile_id DROP NOT NULL;

-- Exact effective R026 body, renamed by R027. Only the profile join is nullable;
-- R028-R036 wrappers, source lineage, leases, parity and versioning stay intact.
-- CREATE OR REPLACE preserves the existing owner and ACL; no new grant.
CREATE OR REPLACE FUNCTION public.record_league_administration_observation_v1(p_input jsonb)
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
  LEFT JOIN public.scoring_profiles profile ON profile.id=season.scoring_profile_id
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
    AND (NOT exact_mapping OR EXISTS (SELECT 1 FROM public.league_administration_observation_mappings observed_mapping
      WHERE observed_mapping.observation_id=head.accepted_observation_id
        AND observed_mapping.source_mapping_revision_id=mapping_revision_id)) THEN
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

-- Exact effective R017 bodies: only intended_leagues changes. Exclusion requires
-- immutable exact-season DATA evidence AND a NULL-profile canonical season AND
-- that season's matching provider connection. Missing/wrong source or ordinary
-- enrollment remains intended and fails closed. Mutable active/adoption state is
-- not authority. Existing publication SHARE locks cover all classifier tables.
-- The other equality/IN profile comparisons already exclude NULL in SQL and are
-- deliberately unchanged. An all-DATA/NULL population still fails the original
-- zero-intended-leagues check; it never qualifies an empty score publication.
CREATE OR REPLACE FUNCTION public.all_player_score_set_is_publication_ready(
  p_score_set_id uuid,
  p_expected_profile_ids jsonb,
  p_stat_observation_id uuid
)
RETURNS boolean
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  candidate record;
  verification_coverage jsonb;
  provided_observation_count integer;
  expected_observation_count integer;
  intended_league_count integer;
  registered_league_count integer;
  enrolled_profile_ids jsonb;
  matched_observation_count integer;
  matched_league_count integer;
  evidence_mismatch_count integer;
  parity_row_count integer;
  parity_nonnull_count integer;
  parity_entity_count integer;
  parity_conflict_count integer;
  parity_score_mismatch_count integer;
BEGIN
  SELECT score_set.*, content.entry_count, profile.rules AS scoring_rules,
    profile.rules_hash AS scoring_rules_hash
  INTO candidate
  FROM public.all_player_score_sets score_set
  JOIN public.all_player_stat_contents content
    ON content.id = score_set.all_player_stat_content_id
  JOIN public.scoring_profiles profile ON profile.id = score_set.scoring_profile_id
  WHERE score_set.id = p_score_set_id;
  IF NOT FOUND THEN RETURN false; END IF;
  SELECT coverage INTO verification_coverage FROM public.all_player_score_verifications
    WHERE all_player_stat_observation_id = p_stat_observation_id
      AND all_player_score_set_id = p_score_set_id;
  IF NOT FOUND THEN RETURN false; END IF;
  candidate.coverage := verification_coverage;
  IF NOT EXISTS (SELECT 1 FROM public.current_all_player_score_sets pointer
    JOIN public.all_player_stat_observations observed ON observed.id = p_stat_observation_id
    WHERE pointer.provider = candidate.provider AND pointer.season = candidate.season
      AND pointer.season_type = candidate.season_type AND pointer.week = candidate.week
      AND pointer.scoring_profile_id = candidate.scoring_profile_id
      AND pointer.scorer_version = candidate.scorer_version
      AND observed.observed_at <= pointer.observed_at)
    AND EXISTS (SELECT 1 FROM public.all_player_scores score
      WHERE score.all_player_score_set_id = p_score_set_id AND NOT EXISTS (
        SELECT 1 FROM public.external_scoring_entity_ids mapping
        JOIN public.scoring_entities entity ON entity.id = mapping.scoring_entity_id
          AND entity.kind = score.entity_kind
        WHERE mapping.provider = candidate.provider AND mapping.entity_kind = score.entity_kind
          AND mapping.external_id = score.provider_external_id
          AND mapping.scoring_entity_id = score.scoring_entity_id
          AND mapping.mapping_status = 'verified' AND mapping.valid_from <= clock_timestamp()
          AND (mapping.valid_to IS NULL OR mapping.valid_to > clock_timestamp())
      )) THEN RETURN false; END IF;


  IF candidate.quality <> 'complete'
    OR candidate.scored_entity_count <> candidate.entry_count
    OR candidate.parity_comparison_count = 0
    OR candidate.parity_mismatch_count <> 0
    OR NOT candidate.coverage @> '{"complete":true,"identity_complete":true,"scoring_rules_complete":true}'::jsonb
    OR candidate.coverage->>'scoring_rules_hash' IS DISTINCT FROM candidate.scoring_rules_hash
    OR candidate.coverage->'expected_scoring_profile_ids' IS DISTINCT FROM p_expected_profile_ids
    OR btrim(COALESCE(candidate.coverage->>'all_player_source_revision', '')) = ''
    OR COALESCE(candidate.coverage->>'score_batch_fingerprint', '')
      !~ '^sha256:[0-9a-f]{64}$'
    OR jsonb_typeof(candidate.coverage->'parity_observation_ids') IS DISTINCT FROM 'array'
    OR jsonb_typeof(candidate.coverage->'parity_observation_evidence') IS DISTINCT FROM 'object'
    OR jsonb_typeof(candidate.coverage->'parity_expected_entity_count') IS DISTINCT FROM 'number'
    OR COALESCE(candidate.coverage->>'parity_fingerprint', '')
      !~ '^sha256:[0-9a-f]{64}$'
    OR public.all_player_scoring_contract_supported(
      candidate.provider, candidate.scorer_version, candidate.scoring_rules
    ) IS DISTINCT FROM true
    OR candidate.scored_entity_count <> (
      SELECT count(*) FROM public.all_player_scores score
      WHERE score.all_player_score_set_id = candidate.id
    )
    OR candidate.eligible_game_count <> COALESCE((
      SELECT sum(score.eligible_game_count) FROM public.all_player_scores score
      WHERE score.all_player_score_set_id = candidate.id
    ), 0)
    OR EXISTS (
      SELECT 1 FROM public.all_player_scores score
      WHERE score.all_player_score_set_id = candidate.id
        AND score.eligible_game_count = 1 AND score.nfl_game_id IS NULL
    ) THEN
    RETURN false;
  END IF;

  WITH intended_leagues AS (
    SELECT enrollment.league_id FROM public.league_administration_enrollment_seasons enrollment
    WHERE enrollment.season = candidate.season AND enrollment.provider = candidate.provider
      AND NOT EXISTS (
        SELECT 1 FROM public.league_seasons official_season
        JOIN public.league_source_connections official_connection
          ON official_connection.league_season_id = official_season.id
          AND official_connection.provider = enrollment.provider
        WHERE enrollment.evidence = 'public-data-intake-v1'
          AND official_season.league_id = enrollment.league_id
          AND official_season.season = enrollment.season
          AND official_season.scoring_profile_id IS NULL
      )
  ), registered_leagues AS (
    SELECT season.scoring_profile_id
    FROM intended_leagues enrollment
    JOIN public.league_seasons season ON season.league_id = enrollment.league_id
      AND season.season = candidate.season
    JOIN public.league_source_connections connection ON connection.league_season_id = season.id
      AND connection.provider = candidate.provider
    JOIN public.scoring_profiles profile ON profile.id = season.scoring_profile_id
  ), expected_profiles AS (
    SELECT DISTINCT scoring_profile_id FROM registered_leagues
  )
  SELECT (SELECT count(*) FROM intended_leagues), (SELECT count(*) FROM registered_leagues),
    (SELECT jsonb_agg(scoring_profile_id::text ORDER BY scoring_profile_id::text) FROM expected_profiles)
  INTO intended_league_count, registered_league_count, enrolled_profile_ids;
  IF intended_league_count = 0 OR registered_league_count <> intended_league_count
    OR enrolled_profile_ids IS DISTINCT FROM p_expected_profile_ids THEN RETURN false; END IF;

  provided_observation_count := jsonb_array_length(
    candidate.coverage->'parity_observation_ids'
  );
  SELECT count(*) INTO expected_observation_count
  FROM public.league_administration_enrollment_seasons enrollment
  JOIN public.league_seasons season ON season.league_id = enrollment.league_id
    AND season.season = enrollment.season
  WHERE enrollment.provider = candidate.provider AND enrollment.season = candidate.season
    AND season.scoring_profile_id = candidate.scoring_profile_id;

  WITH provided AS (
    SELECT value::uuid AS observation_id
    FROM jsonb_array_elements_text(candidate.coverage->'parity_observation_ids') value
  ), matched AS (
    SELECT observation.id, observation.league_season_id
    FROM provided
    JOIN public.league_week_observations observation
      ON observation.id = provided.observation_id
    JOIN public.league_seasons season ON season.id = observation.league_season_id
    JOIN public.leagues league ON league.id = season.league_id
    JOIN public.league_source_connections connection
      ON connection.league_season_id = season.id
      AND connection.provider = candidate.provider
    JOIN public.league_period_authorities authority
      ON authority.league_key = league.league_key
      AND authority.source_provider = candidate.provider
      AND authority.source_external_league_id = connection.external_league_id
      AND authority.default_season = candidate.season
    WHERE observation.provider = candidate.provider
      AND observation.week = candidate.week
      AND observation.quality = 'complete'
      AND season.season = candidate.season
      AND season.scoring_profile_id = candidate.scoring_profile_id
      AND EXISTS (SELECT 1 FROM public.league_administration_enrollment_seasons enrollment
        WHERE enrollment.league_id = season.league_id AND enrollment.season = season.season
          AND enrollment.provider = candidate.provider)
      AND observation.source_data->>'allPlayerSourceRevision'
        = candidate.coverage->>'all_player_source_revision'
  )
  SELECT count(*), count(DISTINCT league_season_id)
  INTO matched_observation_count, matched_league_count
  FROM matched;
  IF provided_observation_count = 0
    OR provided_observation_count <> expected_observation_count
    OR provided_observation_count <> matched_observation_count
    OR matched_observation_count <> matched_league_count THEN
    RETURN false;
  END IF;

  WITH provided AS (
    SELECT value::uuid AS observation_id
    FROM jsonb_array_elements_text(candidate.coverage->'parity_observation_ids') value
  ), matched AS (
    SELECT observation.id, observation.source_data,
      candidate.coverage->'parity_observation_evidence'->observation.id::text
        AS score_evidence,
      authority.expected_roster_count,
      (SELECT jsonb_agg(roster_id ORDER BY roster_id)
        FROM unnest(authority.expected_roster_ids) roster_id) AS expected_roster_ids
    FROM provided
    JOIN public.league_week_observations observation
      ON observation.id = provided.observation_id
    JOIN public.league_seasons season ON season.id = observation.league_season_id
    JOIN public.leagues league ON league.id = season.league_id
    JOIN public.league_source_connections connection
      ON connection.league_season_id = season.id
      AND connection.provider = candidate.provider
    JOIN public.league_period_authorities authority
      ON authority.league_key = league.league_key
      AND authority.source_provider = candidate.provider
      AND authority.source_external_league_id = connection.external_league_id
      AND authority.default_season = candidate.season
    WHERE season.scoring_profile_id = candidate.scoring_profile_id
  ), physical AS (
    SELECT matched.id,
      count(points.*)::integer AS player_count,
      count(points.points)::integer AS nonnull_player_count,
      count(score.provider_external_id)::integer AS mapped_player_count,
      count(DISTINCT points.scoring_entity_id)::integer AS unique_player_count,
      count(DISTINCT points.external_roster_id)::integer AS player_roster_count,
      ('sha256:' || encode(digest(convert_to(COALESCE(string_agg(
        score.provider_external_id || chr(31) || points.points::text,
        chr(10) ORDER BY score.provider_external_id
      ), ''), 'UTF8'), 'sha256'), 'hex')) AS fingerprint
    FROM matched
    LEFT JOIN public.official_player_point_observations points
      ON points.league_week_observation_id = matched.id
    LEFT JOIN public.all_player_scores score
      ON score.all_player_score_set_id = candidate.id
      AND score.scoring_entity_id = points.scoring_entity_id
    GROUP BY matched.id
  ), roster_physical AS (
    SELECT matched.id, count(rosters.*)::integer AS roster_count,
      COALESCE(jsonb_agg(rosters.external_roster_id ORDER BY rosters.external_roster_id)
        FILTER (WHERE rosters.external_roster_id IS NOT NULL), '[]'::jsonb) AS roster_ids
    FROM matched
    LEFT JOIN public.official_roster_point_observations rosters
      ON rosters.league_week_observation_id = matched.id
    GROUP BY matched.id
  )
  SELECT count(*) INTO evidence_mismatch_count
  FROM matched
  JOIN physical ON physical.id = matched.id
  JOIN roster_physical ON roster_physical.id = matched.id
  WHERE jsonb_typeof(matched.score_evidence) IS DISTINCT FROM 'object'
    OR matched.source_data->>'allPlayerSourceRevision'
      IS DISTINCT FROM candidate.coverage->>'all_player_source_revision'
    OR matched.source_data->'officialPlayersPointsEvidence' IS DISTINCT FROM matched.score_evidence
    OR matched.score_evidence->>'version' IS DISTINCT FROM 'players-points-v1'
    OR matched.score_evidence->>'expectedEntityCount' IS DISTINCT FROM physical.player_count::text
    OR matched.score_evidence->>'expectedRosterCount' IS DISTINCT FROM matched.expected_roster_count::text
    OR matched.score_evidence->'expectedRosterIds' IS DISTINCT FROM matched.expected_roster_ids
    OR matched.score_evidence->>'fingerprint' IS DISTINCT FROM physical.fingerprint
    OR physical.player_count = 0
    OR physical.player_count <> physical.nonnull_player_count
    OR physical.player_count <> physical.mapped_player_count
    OR physical.player_count <> physical.unique_player_count
    OR physical.player_roster_count <> matched.expected_roster_count
    OR roster_physical.roster_count <> matched.expected_roster_count
    OR roster_physical.roster_ids IS DISTINCT FROM matched.expected_roster_ids
    OR EXISTS (
      SELECT 1 FROM public.official_player_point_observations player_point
      WHERE player_point.league_week_observation_id = matched.id
        AND NOT EXISTS (
          SELECT 1 FROM public.official_roster_point_observations roster_point
          WHERE roster_point.league_week_observation_id = matched.id
            AND roster_point.external_roster_id = player_point.external_roster_id
        )
    );
  IF evidence_mismatch_count <> 0 THEN RETURN false; END IF;

  WITH provided AS (
    SELECT value::uuid AS observation_id
    FROM jsonb_array_elements_text(candidate.coverage->'parity_observation_ids') value
  ), official AS (
    SELECT points.scoring_entity_id, points.points
    FROM provided
    JOIN public.official_player_point_observations points
      ON points.league_week_observation_id = provided.observation_id
  ), grouped AS (
    SELECT scoring_entity_id, min(points) AS points, count(DISTINCT points) AS point_values
    FROM official GROUP BY scoring_entity_id
  )
  SELECT
    (SELECT count(*) FROM official),
    (SELECT count(*) FROM official WHERE points IS NOT NULL),
    (SELECT count(*) FROM grouped),
    (SELECT count(*) FROM grouped WHERE point_values <> 1),
    (SELECT count(*) FROM grouped
      LEFT JOIN public.all_player_scores score
        ON score.all_player_score_set_id = candidate.id
        AND score.scoring_entity_id = grouped.scoring_entity_id
      WHERE score.scoring_entity_id IS NULL
        OR abs(score.fantasy_points - grouped.points) > 0.0001)
  INTO parity_row_count, parity_nonnull_count, parity_entity_count,
    parity_conflict_count, parity_score_mismatch_count;
  RETURN parity_row_count > 0
    AND parity_row_count = parity_nonnull_count
    AND parity_entity_count = candidate.parity_comparison_count
    AND parity_entity_count = (candidate.coverage->>'parity_expected_entity_count')::integer
    AND parity_conflict_count = 0
    AND parity_score_mismatch_count = 0;
EXCEPTION WHEN OTHERS THEN
  RETURN false;
END;
$$;

CREATE OR REPLACE FUNCTION public.advance_current_all_player_score_set(
  p_provider text,
  p_season smallint,
  p_season_type text,
  p_week smallint,
  p_scoring_profile_id uuid,
  p_scorer_version text,
  p_stat_observation_id uuid,
  p_score_set_id uuid,
  p_verified_at timestamptz
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  candidate record;
  fence jsonb;
  current_pointer public.current_all_player_score_sets%ROWTYPE;
  current_semantic_hash text;
  provided_parity_observation_count integer;
  matched_parity_observation_count integer;
  matched_parity_league_count integer;
  parity_row_count integer;
  parity_nonnull_count integer;
  parity_entity_count integer;
  parity_conflict_count integer;
  parity_score_mismatch_count integer;
  parity_evidence_mismatch_count integer;
  expected_league_count integer;
  registered_league_count integer;
  expected_profile_count integer;
  expected_profile_ids jsonb;
  expected_parity_league_count integer;
  coordinated_score_set_count integer;
  result text;
BEGIN
  fence := NULLIF(current_setting('league_one.all_player_fence', true), '')::jsonb;
  PERFORM public.assert_all_player_job_fence(fence,
    jsonb_build_object('season', p_season, 'seasonType', p_season_type, 'week', p_week), true);
  PERFORM pg_advisory_xact_lock(hashtextextended(
    p_provider || ':' || p_season::text || ':' || p_season_type || ':' || p_week::text
      || ':' || p_scoring_profile_id::text || ':' || p_scorer_version,
    0
  ));

  SELECT observation.observed_at, observation.source_revision,
    observation.quality AS observation_quality,
    observation.all_player_stat_content_id,
    content.quality AS content_quality, content.coverage AS content_coverage,
    content.entry_count,
    score_set.semantic_hash, score_set.quality AS score_quality,
    score_set.scored_entity_count, score_set.eligible_game_count,
    score_set.parity_comparison_count, score_set.parity_mismatch_count,
    verification.coverage, profile.rules_hash AS scoring_rules_hash,
    profile.rules AS scoring_rules
  INTO STRICT candidate
  FROM public.all_player_stat_observations observation
  JOIN public.all_player_stat_contents content
    ON content.id = observation.all_player_stat_content_id
  JOIN public.all_player_score_sets score_set
    ON score_set.id = p_score_set_id
    AND score_set.all_player_stat_content_id = observation.all_player_stat_content_id
  JOIN public.all_player_score_verifications verification
    ON verification.all_player_stat_observation_id = observation.id
      AND verification.all_player_score_set_id = score_set.id
  JOIN public.scoring_profiles profile ON profile.id = score_set.scoring_profile_id
  WHERE observation.id = p_stat_observation_id
    AND observation.provider = p_provider
    AND observation.season = p_season
    AND observation.season_type = p_season_type
    AND observation.week = p_week
    AND score_set.provider = p_provider
    AND score_set.season = p_season
    AND score_set.season_type = p_season_type
    AND score_set.week = p_week
    AND score_set.scoring_profile_id = p_scoring_profile_id
    AND score_set.scorer_version = p_scorer_version;

  IF p_season < 2026 OR p_season_type <> 'reg' THEN
    RAISE EXCEPTION 'all-player publication is limited to 2026+ regular seasons';
  END IF;
  IF candidate.observation_quality <> 'complete'
    OR candidate.content_quality <> 'complete'
    OR NOT candidate.content_coverage @> '{"complete":true}'::jsonb
    OR candidate.content_coverage->>'expectedInventoryFingerprint' IS NULL
    OR candidate.content_coverage->>'expectedInventoryFingerprint' !~ '^sha256:[0-9a-f]{64}$'
    OR btrim(COALESCE(candidate.content_coverage->>'catalogRevision', '')) = ''
    OR btrim(COALESCE(candidate.content_coverage->>'scheduleRevision', '')) = ''
    OR COALESCE(candidate.content_coverage->>'rosterInventoryFingerprint', '')
      !~ '^sha256:[0-9a-f]{64}$'
    OR COALESCE(candidate.content_coverage->>'projectionInventoryFingerprint', '')
      !~ '^sha256:[0-9a-f]{64}$'
    OR COALESCE(candidate.content_coverage->>'byeInventoryFingerprint', '')
      !~ '^sha256:[0-9a-f]{64}$'
    OR jsonb_typeof(candidate.content_coverage->'expectedEntityCount') IS DISTINCT FROM 'number'
    OR jsonb_typeof(candidate.content_coverage->'expectedPlayerCount') IS DISTINCT FROM 'number'
    OR jsonb_typeof(candidate.content_coverage->'providerPresentEntityCount') IS DISTINCT FROM 'number'
    OR jsonb_typeof(candidate.content_coverage->'providerMissingEntityCount') IS DISTINCT FROM 'number'
    OR candidate.content_coverage->>'expectedTeamDefenseCount' IS DISTINCT FROM '32'
    OR candidate.content_coverage->>'expectedEntityCount' IS DISTINCT FROM candidate.entry_count::text
    OR candidate.content_coverage->>'fantasyEntityCount' IS DISTINCT FROM candidate.entry_count::text
    OR candidate.content_coverage->>'unknownEligibilityCount' IS DISTINCT FROM '0'
    OR candidate.content_coverage->>'unmappedGameCount' IS DISTINCT FROM '0'
    OR candidate.content_coverage->>'unexpectedResponseEntityCount' IS DISTINCT FROM '0'
    OR (candidate.content_coverage->>'providerPresentEntityCount')::integer
      + (candidate.content_coverage->>'providerMissingEntityCount')::integer
      <> candidate.entry_count
    OR candidate.score_quality <> 'complete'
    OR candidate.parity_comparison_count = 0
    OR candidate.parity_mismatch_count <> 0
    OR NOT candidate.coverage @> '{"complete":true,"identity_complete":true,"scoring_rules_complete":true}'::jsonb
    OR candidate.coverage->>'scoring_rules_hash' IS DISTINCT FROM candidate.scoring_rules_hash
    OR candidate.coverage->>'all_player_source_revision' IS DISTINCT FROM candidate.source_revision
    OR jsonb_typeof(candidate.coverage->'parity_observation_ids') IS DISTINCT FROM 'array'
    OR jsonb_typeof(candidate.coverage->'parity_observation_evidence') IS DISTINCT FROM 'object'
    OR jsonb_typeof(candidate.coverage->'expected_scoring_profile_ids') IS DISTINCT FROM 'array'
    OR COALESCE(candidate.coverage->>'score_batch_fingerprint', '')
      !~ '^sha256:[0-9a-f]{64}$'
    OR jsonb_typeof(candidate.coverage->'parity_expected_entity_count') IS DISTINCT FROM 'number'
    OR candidate.coverage->>'parity_fingerprint' IS NULL
    OR candidate.coverage->>'parity_fingerprint' !~ '^sha256:[0-9a-f]{64}$'
    OR candidate.entry_count <> (
      SELECT count(*) FROM public.all_player_stat_entries entry
      WHERE entry.all_player_stat_content_id = candidate.all_player_stat_content_id
    )
    OR 32 <> (
      SELECT count(*) FROM public.all_player_stat_entries entry
      WHERE entry.all_player_stat_content_id = candidate.all_player_stat_content_id
        AND entry.entity_kind = 'team_defense' AND entry.position = 'DEF'
    )
    OR (candidate.content_coverage->>'expectedPlayerCount')::integer <> (
      SELECT count(*) FROM public.all_player_stat_entries entry
      WHERE entry.all_player_stat_content_id = candidate.all_player_stat_content_id
        AND entry.entity_kind = 'player'
    )
    OR EXISTS (
      SELECT 1 FROM public.all_player_stat_entries entry
      WHERE entry.all_player_stat_content_id = candidate.all_player_stat_content_id
        AND (entry.eligible_game_count IS NULL OR entry.appearance_game_count IS NULL)
    )
    OR candidate.scored_entity_count <> (
      SELECT count(*) FROM public.all_player_scores score
      WHERE score.all_player_score_set_id = p_score_set_id
    )
    OR candidate.scored_entity_count <> candidate.entry_count
    OR EXISTS (
      SELECT 1 FROM public.all_player_scores score
      WHERE score.all_player_score_set_id = p_score_set_id
        AND score.eligible_game_count = 1 AND score.nfl_game_id IS NULL
    )
    OR candidate.eligible_game_count <> COALESCE((
      SELECT sum(score.eligible_game_count) FROM public.all_player_scores score
      WHERE score.all_player_score_set_id = p_score_set_id
    ), 0) THEN
    RAISE EXCEPTION 'all-player score set is not publication eligible';
  END IF;
  IF public.all_player_scoring_contract_supported(
    p_provider, p_scorer_version, candidate.scoring_rules
  ) IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'all-player scoring profile is unsupported by this scorer contract';
  END IF;

  -- Serialize publication with exact-season enrollment, connection and profile
  -- registration. Intended membership is independent of registration completeness.
  LOCK TABLE public.league_seasons, public.league_source_connections,
    public.league_administration_enrollment_seasons IN SHARE MODE;
  WITH intended_leagues AS (
    SELECT enrollment.league_id FROM public.league_administration_enrollment_seasons enrollment
    WHERE enrollment.season = p_season AND enrollment.provider = p_provider
      AND NOT EXISTS (
        SELECT 1 FROM public.league_seasons official_season
        JOIN public.league_source_connections official_connection
          ON official_connection.league_season_id = official_season.id
          AND official_connection.provider = enrollment.provider
        WHERE enrollment.evidence = 'public-data-intake-v1'
          AND official_season.league_id = enrollment.league_id
          AND official_season.season = enrollment.season
          AND official_season.scoring_profile_id IS NULL
      )
  ), canonical_leagues AS (
    SELECT season.id AS league_season_id, season.scoring_profile_id
    FROM intended_leagues enrollment
    JOIN public.league_seasons season ON season.league_id = enrollment.league_id
      AND season.season = p_season
    JOIN public.league_source_connections connection ON connection.league_season_id = season.id
      AND connection.provider = p_provider
    JOIN public.scoring_profiles profile ON profile.id = season.scoring_profile_id
  ), expected_profiles AS (
    SELECT DISTINCT scoring_profile_id FROM canonical_leagues
  )
  SELECT
    (SELECT count(*) FROM intended_leagues),
    (SELECT count(*) FROM canonical_leagues),
    (SELECT count(*) FROM expected_profiles),
    (SELECT jsonb_agg(scoring_profile_id::text ORDER BY scoring_profile_id::text)
      FROM expected_profiles),
    (SELECT count(*) FROM canonical_leagues
      WHERE scoring_profile_id = p_scoring_profile_id)
  INTO expected_league_count, registered_league_count, expected_profile_count, expected_profile_ids,
    expected_parity_league_count;
  IF expected_league_count = 0 OR registered_league_count <> expected_league_count OR expected_profile_count = 0
    OR expected_parity_league_count = 0
    OR candidate.coverage->'expected_scoring_profile_ids' IS DISTINCT FROM expected_profile_ids THEN
    RAISE EXCEPTION 'all-player score batch does not cover the canonical league scoring profiles';
  END IF;
  SELECT count(DISTINCT coordinated.scoring_profile_id) INTO coordinated_score_set_count
  FROM public.all_player_score_sets coordinated
  JOIN public.all_player_score_verifications peer_verification
    ON peer_verification.all_player_score_set_id = coordinated.id
      AND peer_verification.all_player_stat_observation_id = p_stat_observation_id
  WHERE coordinated.all_player_stat_content_id = candidate.all_player_stat_content_id
    AND coordinated.provider = p_provider
    AND coordinated.season = p_season
    AND coordinated.season_type = p_season_type
    AND coordinated.week = p_week
    AND coordinated.scorer_version = p_scorer_version
    AND coordinated.quality = 'complete'
    AND peer_verification.coverage->>'score_batch_fingerprint'
      = candidate.coverage->>'score_batch_fingerprint'
    AND peer_verification.coverage->>'all_player_source_revision' = candidate.source_revision
    AND peer_verification.coverage->'expected_scoring_profile_ids' = expected_profile_ids
    AND public.all_player_score_set_is_publication_ready(
      coordinated.id, expected_profile_ids, p_stat_observation_id
    ) IS TRUE
    AND coordinated.scoring_profile_id IN (
      SELECT DISTINCT season.scoring_profile_id
      FROM public.league_administration_enrollment_seasons enrollment
      JOIN public.league_seasons season ON season.league_id = enrollment.league_id
        AND season.season = enrollment.season
      WHERE enrollment.season = p_season AND enrollment.provider = p_provider
    );
  IF coordinated_score_set_count <> expected_profile_count THEN
    RAISE EXCEPTION 'all-player score batch is missing a canonical scoring profile';
  END IF;

  SELECT jsonb_array_length(candidate.coverage->'parity_observation_ids')
  INTO provided_parity_observation_count;
  WITH provided AS (
    SELECT value::uuid AS observation_id
    FROM jsonb_array_elements_text(candidate.coverage->'parity_observation_ids') value
  ), matched AS (
    SELECT observation.id, observation.league_season_id, observation.source_data
    FROM provided
    JOIN public.league_week_observations observation
      ON observation.id = provided.observation_id
    JOIN public.league_seasons season ON season.id = observation.league_season_id
    JOIN public.leagues league ON league.id = season.league_id
    JOIN public.league_source_connections connection
      ON connection.league_season_id = season.id AND connection.provider = p_provider
    JOIN public.league_period_authorities authority
      ON authority.league_key = league.league_key
      AND authority.source_provider = p_provider
      AND authority.source_external_league_id = connection.external_league_id
      AND authority.default_season = p_season
    WHERE observation.provider = p_provider AND observation.week = p_week
      AND observation.quality = 'complete' AND season.season = p_season
      AND season.scoring_profile_id = p_scoring_profile_id
      AND EXISTS (SELECT 1 FROM public.league_administration_enrollment_seasons enrollment
        WHERE enrollment.league_id = season.league_id AND enrollment.season = season.season
          AND enrollment.provider = p_provider)
      AND observation.source_data->>'allPlayerSourceRevision' = candidate.source_revision
  )
  SELECT count(*), count(DISTINCT league_season_id)
  INTO matched_parity_observation_count, matched_parity_league_count
  FROM matched;
  IF provided_parity_observation_count = 0
    OR provided_parity_observation_count <> matched_parity_observation_count
    OR matched_parity_observation_count <> matched_parity_league_count
    OR matched_parity_league_count <> expected_parity_league_count THEN
    RAISE EXCEPTION 'all-player parity observations are incomplete';
  END IF;

  WITH provided AS (
    SELECT value::uuid AS observation_id
    FROM jsonb_array_elements_text(candidate.coverage->'parity_observation_ids') value
  ), matched AS (
    SELECT observation.id, observation.source_data,
      candidate.coverage->'parity_observation_evidence'->observation.id::text
        AS score_evidence,
      authority.expected_roster_count,
      (SELECT jsonb_agg(roster_id ORDER BY roster_id)
        FROM unnest(authority.expected_roster_ids) roster_id) AS expected_roster_ids
    FROM provided
    JOIN public.league_week_observations observation
      ON observation.id = provided.observation_id
    JOIN public.league_seasons season ON season.id = observation.league_season_id
    JOIN public.leagues league ON league.id = season.league_id
    JOIN public.league_source_connections connection
      ON connection.league_season_id = season.id AND connection.provider = p_provider
    JOIN public.league_period_authorities authority
      ON authority.league_key = league.league_key
      AND authority.source_provider = p_provider
      AND authority.source_external_league_id = connection.external_league_id
      AND authority.default_season = p_season
    WHERE season.scoring_profile_id = p_scoring_profile_id
  ), physical AS (
    SELECT matched.id,
      count(points.*)::integer AS player_count,
      count(points.points)::integer AS nonnull_player_count,
      count(score.provider_external_id)::integer AS mapped_player_count,
      count(DISTINCT points.scoring_entity_id)::integer AS unique_player_count,
      count(DISTINCT points.external_roster_id)::integer AS player_roster_count,
      ('sha256:' || encode(digest(convert_to(COALESCE(string_agg(
        score.provider_external_id || chr(31) || points.points::text,
        chr(10) ORDER BY score.provider_external_id
      ), ''), 'UTF8'), 'sha256'), 'hex')) AS fingerprint
    FROM matched
    LEFT JOIN public.official_player_point_observations points
      ON points.league_week_observation_id = matched.id
    LEFT JOIN public.all_player_scores score
      ON score.all_player_score_set_id = p_score_set_id
      AND score.scoring_entity_id = points.scoring_entity_id
    GROUP BY matched.id
  ), roster_physical AS (
    SELECT matched.id, count(rosters.*)::integer AS roster_count,
      COALESCE(jsonb_agg(rosters.external_roster_id ORDER BY rosters.external_roster_id)
        FILTER (WHERE rosters.external_roster_id IS NOT NULL), '[]'::jsonb) AS roster_ids
    FROM matched
    LEFT JOIN public.official_roster_point_observations rosters
      ON rosters.league_week_observation_id = matched.id
    GROUP BY matched.id
  )
  SELECT count(*) INTO parity_evidence_mismatch_count
  FROM matched
  JOIN physical ON physical.id = matched.id
  JOIN roster_physical ON roster_physical.id = matched.id
  WHERE jsonb_typeof(matched.score_evidence) IS DISTINCT FROM 'object'
    OR matched.source_data->>'allPlayerSourceRevision' IS DISTINCT FROM candidate.source_revision
    OR matched.source_data->'officialPlayersPointsEvidence' IS DISTINCT FROM matched.score_evidence
    OR matched.score_evidence->>'version' IS DISTINCT FROM 'players-points-v1'
    OR matched.score_evidence->>'expectedEntityCount' IS DISTINCT FROM physical.player_count::text
    OR matched.score_evidence->>'expectedRosterCount' IS DISTINCT FROM matched.expected_roster_count::text
    OR matched.score_evidence->'expectedRosterIds' IS DISTINCT FROM matched.expected_roster_ids
    OR matched.score_evidence->>'fingerprint' IS DISTINCT FROM physical.fingerprint
    OR physical.player_count = 0
    OR physical.player_count <> physical.nonnull_player_count
    OR physical.player_count <> physical.mapped_player_count
    OR physical.player_count <> physical.unique_player_count
    OR physical.player_roster_count <> matched.expected_roster_count
    OR roster_physical.roster_count <> matched.expected_roster_count
    OR roster_physical.roster_ids IS DISTINCT FROM matched.expected_roster_ids
    OR EXISTS (
      SELECT 1 FROM public.official_player_point_observations player_point
      WHERE player_point.league_week_observation_id = matched.id
        AND NOT EXISTS (
          SELECT 1 FROM public.official_roster_point_observations roster_point
          WHERE roster_point.league_week_observation_id = matched.id
            AND roster_point.external_roster_id = player_point.external_roster_id
        )
    );
  IF parity_evidence_mismatch_count <> 0 THEN
    RAISE EXCEPTION 'all-player parity evidence is stale, partial, or malformed';
  END IF;

  WITH provided AS (
    SELECT value::uuid AS observation_id
    FROM jsonb_array_elements_text(candidate.coverage->'parity_observation_ids') value
  ), official AS (
    SELECT points.scoring_entity_id, points.points
    FROM provided
    JOIN public.official_player_point_observations points
      ON points.league_week_observation_id = provided.observation_id
  ), grouped AS (
    SELECT scoring_entity_id, min(points) AS points, count(DISTINCT points) AS point_values
    FROM official GROUP BY scoring_entity_id
  )
  SELECT
    (SELECT count(*) FROM official),
    (SELECT count(*) FROM official WHERE points IS NOT NULL),
    (SELECT count(*) FROM grouped),
    (SELECT count(*) FROM grouped WHERE point_values <> 1),
    (SELECT count(*) FROM grouped
      LEFT JOIN public.all_player_scores score
        ON score.all_player_score_set_id = p_score_set_id
        AND score.scoring_entity_id = grouped.scoring_entity_id
      WHERE score.scoring_entity_id IS NULL
        OR abs(score.fantasy_points - grouped.points) > 0.0001)
  INTO parity_row_count, parity_nonnull_count, parity_entity_count,
    parity_conflict_count, parity_score_mismatch_count;
  IF parity_row_count = 0 OR parity_row_count <> parity_nonnull_count
    OR parity_entity_count <> candidate.parity_comparison_count
    OR parity_entity_count <> (candidate.coverage->>'parity_expected_entity_count')::integer
    OR parity_conflict_count <> 0 OR parity_score_mismatch_count <> 0 THEN
    RAISE EXCEPTION 'all-player rostered scoring parity is incomplete or mismatched';
  END IF;
  IF p_verified_at < candidate.observed_at THEN
    RAISE EXCEPTION 'all-player verification precedes its observation';
  END IF;

  SELECT pointer.* INTO current_pointer
  FROM public.current_all_player_score_sets pointer
  WHERE pointer.provider = p_provider AND pointer.season = p_season
    AND pointer.season_type = p_season_type AND pointer.week = p_week
    AND pointer.scoring_profile_id = p_scoring_profile_id
    AND pointer.scorer_version = p_scorer_version
  FOR UPDATE;

  IF FOUND AND candidate.observed_at < current_pointer.observed_at THEN
    RETURN 'superseded';
  END IF;
  IF FOUND AND candidate.observed_at = current_pointer.observed_at
    AND (p_stat_observation_id <> current_pointer.all_player_stat_observation_id
      OR p_score_set_id <> current_pointer.all_player_score_set_id) THEN
    RAISE EXCEPTION 'all-player pointer conflict: equal observation time has different content';
  END IF;

  IF FOUND THEN
    SELECT score_set.semantic_hash INTO STRICT current_semantic_hash
    FROM public.all_player_score_sets score_set
    WHERE score_set.id = current_pointer.all_player_score_set_id;
    result := CASE WHEN current_semantic_hash = candidate.semantic_hash
      THEN 'verified' ELSE 'advanced' END;
  ELSE
    result := 'advanced';
  END IF;

  -- Locking prevents takeover during this transaction; check the real clock again
  -- after parity validation so an owner that expired during SQL cannot publish.
  PERFORM public.assert_all_player_job_fence(fence,
    jsonb_build_object('season', p_season, 'seasonType', p_season_type, 'week', p_week), true);
  INSERT INTO public.current_all_player_score_sets (
    provider, season, season_type, week, scoring_profile_id, scorer_version,
    all_player_stat_observation_id, all_player_score_set_id, observed_at,
    verified_at, material_changed_at
  ) VALUES (
    p_provider, p_season, p_season_type, p_week, p_scoring_profile_id, p_scorer_version,
    p_stat_observation_id, p_score_set_id, candidate.observed_at,
    p_verified_at, p_verified_at
  )
  ON CONFLICT (provider, season, season_type, week, scoring_profile_id, scorer_version)
  DO UPDATE SET
    all_player_stat_observation_id = EXCLUDED.all_player_stat_observation_id,
    all_player_score_set_id = EXCLUDED.all_player_score_set_id,
    observed_at = EXCLUDED.observed_at,
    verified_at = GREATEST(
      public.current_all_player_score_sets.verified_at, EXCLUDED.verified_at
    ),
    material_changed_at = CASE
      WHEN result = 'verified'
      THEN public.current_all_player_score_sets.material_changed_at
      ELSE EXCLUDED.material_changed_at
    END;
  UPDATE public.projection_jobs SET payload = payload || jsonb_build_object('lastPublication',
    jsonb_build_object('generation',(fence->>'generation')::integer,
      'period',jsonb_build_object('season',p_season,'seasonType',p_season_type,'week',p_week),
      'observationId',p_stat_observation_id,'scorerVersion',p_scorer_version,
      'profileIds',expected_profile_ids,'publishedAt',clock_timestamp()))
    WHERE job_key = 'all-player-ingestion:sleeper';
  RETURN result;
END;
$$;
-- CREATE OR REPLACE retains ownership and privileges. Readiness remains owner
-- only; both existing publication signatures retain their runtime grants and
-- require the same valid job fence. PUBLIC receives no execution rights.
REVOKE ALL ON FUNCTION public.all_player_score_set_is_publication_ready(uuid,jsonb,uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.advance_current_all_player_score_set(text,smallint,text,smallint,uuid,text,uuid,uuid,timestamptz) FROM PUBLIC;

-- Effective R019 legacy completion compatibility only: the same exact immutable
-- DATA/NULL/source classifier applies to eligible-nonempty and invalid-authority
-- predicates. R023/R024 shared pregame completion, all other guards, accounting,
-- function signature, fixed search_path, ownership and ACL remain unchanged.
CREATE OR REPLACE FUNCTION public.finish_all_player_job(p_fence jsonb, p_outcome text, p_diagnostic jsonb)
RETURNS boolean LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE job public.projection_jobs%ROWTYPE; completed timestamptz; result jsonb; history jsonb; summary jsonb; prior_final jsonb; publication jsonb;
  response jsonb; pregame jsonb; proof_at timestamptz; first_kickoff timestamptz; game_count integer;
  stored_final boolean := false; stored_observed_at timestamptz; expected_count integer; actual_count integer;
BEGIN
  IF p_outcome IS NULL OR p_outcome NOT IN ('published','partial','no-statistics-yet','validation-failed','provider-failed','timeout','lease-lost')
    OR jsonb_typeof(p_diagnostic) IS DISTINCT FROM 'object'
    OR octet_length(p_diagnostic::text) > 16000 THEN
    RAISE EXCEPTION 'all-player durable outcome is invalid';
  END IF;
  SELECT * INTO job FROM public.projection_jobs
    WHERE job_key = 'all-player-ingestion:sleeper' FOR UPDATE;
  -- Deadline expiry can be recorded during reserved handling time; ownership and
  -- lease expiry are always enforced, including failed completion.
  IF NOT FOUND OR job.payload->>'mode' IS NULL
    OR job.payload->>'mode' NOT IN ('shadow','backfill','recurring')
    OR jsonb_typeof(p_fence) IS DISTINCT FROM 'object'
    OR NOT (p_fence ?& ARRAY['jobKey','workerId','generation','leaseUntil','deadlineAt'])
    OR job.state IS DISTINCT FROM 'running'
    OR job.lease_owner IS DISTINCT FROM p_fence->>'workerId'
    OR job.attempt_count IS DISTINCT FROM (p_fence->>'generation')::integer
    OR job.lease_until IS DISTINCT FROM (p_fence->>'leaseUntil')::timestamptz
    OR (job.payload->>'deadlineAt')::timestamptz IS DISTINCT FROM (p_fence->>'deadlineAt')::timestamptz
    OR job.lease_until <= clock_timestamp()
    OR p_fence->>'jobKey' IS DISTINCT FROM job.job_key THEN RETURN false; END IF;
  completed := clock_timestamp();
  IF p_outcome IN ('published','no-statistics-yet') AND (job.payload->>'deadlineAt')::timestamptz <= completed
    THEN RETURN false; END IF;
  IF p_outcome = 'no-statistics-yet' THEN
    BEGIN
    response := p_diagnostic->'responseEvidence'; pregame := p_diagnostic->'pregameEvidence';
    IF job.payload->>'mode' IS DISTINCT FROM 'recurring'
      OR (job.payload->>'requestGeneration')::integer IS DISTINCT FROM job.attempt_count
      OR (job.payload->'lastPublication'->>'generation')::integer = job.attempt_count
      OR p_diagnostic->>'reason' IS DISTINCT FROM 'no-statistics-yet'
      OR p_diagnostic->>'stage' IS DISTINCT FROM 'no-statistics-yet'
      OR p_diagnostic->'period' IS DISTINCT FROM jsonb_build_object('season',job.payload->'period'->'season',
        'seasonType','regular','week',job.payload->'period'->'week')
      OR p_diagnostic->'finalCoverage' IS DISTINCT FROM 'false'::jsonb
      OR p_diagnostic->>'retryDisposition' IS DISTINCT FROM 'global-budget'
      OR jsonb_typeof(response) IS DISTINCT FROM 'object'
      OR response->>'bodyShape' IS DISTINCT FROM 'object'
      OR response->'topLevelCount' IS DISTINCT FROM '0'::jsonb
      OR jsonb_typeof(response->'httpStatus') IS DISTINCT FROM 'number'
      OR (response->>'httpStatus')::integer NOT BETWEEN 200 AND 299
      OR COALESCE(response->>'bodyHash','') !~ '^sha256:[0-9a-f]{64}$'
      OR jsonb_typeof(pregame) IS DISTINCT FROM 'object'
      OR pregame->>'policy' IS DISTINCT FROM 'exact-period-pregame-v1'
      OR jsonb_typeof(pregame->'scheduledGameCount') IS DISTINCT FROM 'number'
      OR COALESCE(pregame->>'scheduleRevision','') !~ '^sha256:[0-9a-f]{64}$'
      OR p_diagnostic->'entryCount' IS DISTINCT FROM '0'::jsonb
      OR p_diagnostic->'scoringProfileCount' IS DISTINCT FROM '0'::jsonb
      THEN RETURN false; END IF;
      proof_at := (pregame->>'verifiedAt')::timestamptz;
      IF proof_at IS NULL OR NOT isfinite(proof_at) OR proof_at > completed
        OR proof_at < completed - interval '90 seconds'
        OR (response->>'requestStartedAt')::timestamptz IS NULL
        OR (response->>'requestCompletedAt')::timestamptz IS NULL
        OR NOT isfinite((response->>'requestStartedAt')::timestamptz)
        OR NOT isfinite((response->>'requestCompletedAt')::timestamptz)
        OR (response->>'requestStartedAt')::timestamptz > (response->>'requestCompletedAt')::timestamptz
        OR (response->>'requestCompletedAt')::timestamptz > proof_at
        OR (response->>'requestCompletedAt')::timestamptz < completed - interval '90 seconds'
        THEN RETURN false; END IF;
      -- A healthy pregame result belongs only to the currently active period
      -- of every enrolled league. Missing registration/authority fails closed.
      IF NOT EXISTS (SELECT 1 FROM public.league_administration_enrollment_seasons enrollment
          WHERE provider='sleeper' AND season=(job.payload->'period'->>'season')::integer AND NOT EXISTS (
          SELECT 1 FROM public.league_seasons official_season
          JOIN public.league_source_connections official_connection
            ON official_connection.league_season_id = official_season.id
            AND official_connection.provider = enrollment.provider
          WHERE enrollment.evidence = 'public-data-intake-v1'
            AND official_season.league_id = enrollment.league_id
            AND official_season.season = enrollment.season
            AND official_season.scoring_profile_id IS NULL
        ))
        OR EXISTS (
          SELECT 1 FROM public.league_administration_enrollment_seasons enrollment
          JOIN public.leagues league ON league.id=enrollment.league_id
          LEFT JOIN public.league_seasons season ON season.league_id=enrollment.league_id
            AND season.season=enrollment.season
          LEFT JOIN public.league_source_connections connection ON connection.league_season_id=season.id
            AND connection.provider='sleeper'
          LEFT JOIN public.league_period_authorities authority ON authority.league_key=league.league_key
          WHERE enrollment.provider='sleeper' AND enrollment.season=(job.payload->'period'->>'season')::integer AND NOT EXISTS (
          SELECT 1 FROM public.league_seasons official_season
          JOIN public.league_source_connections official_connection
            ON official_connection.league_season_id = official_season.id
            AND official_connection.provider = enrollment.provider
          WHERE enrollment.evidence = 'public-data-intake-v1'
            AND official_season.league_id = enrollment.league_id
            AND official_season.season = enrollment.season
            AND official_season.scoring_profile_id IS NULL
        )
            AND (authority.source_provider IS DISTINCT FROM 'sleeper'
              OR connection.external_league_id IS NULL
              OR authority.source_external_league_id IS DISTINCT FROM connection.external_league_id
              OR authority.league_lifecycle IS DISTINCT FROM 'active'
              OR authority.active_season IS DISTINCT FROM enrollment.season
              OR authority.active_season_type IS DISTINCT FROM 'reg'
              OR authority.active_week IS DISTINCT FROM (job.payload->'period'->>'week')::integer
              OR authority.verified_at IS NULL OR authority.verified_at < completed-interval '10 minutes'
              OR authority.verified_at > completed+interval '30 seconds'))
        THEN RETURN false; END IF;
      SELECT count(*),min(game.kickoff_at) INTO game_count,first_kickoff
        FROM public.nfl_games game
        WHERE game.season=(job.payload->'period'->>'season')::integer
          AND game.season_type='reg' AND game.week=(job.payload->'period'->>'week')::integer;
      IF game_count = 0 OR game_count IS DISTINCT FROM (pregame->>'scheduledGameCount')::integer
        OR first_kickoff IS NULL OR first_kickoff <= completed
        OR first_kickoff IS DISTINCT FROM (pregame->>'firstKickoffAt')::timestamptz
        OR EXISTS (SELECT 1 FROM public.nfl_games game
          WHERE game.season=(job.payload->'period'->>'season')::integer
            AND game.season_type='reg' AND game.week=(job.payload->'period'->>'week')::integer
            AND (game.kickoff_at IS NULL OR EXISTS (
              SELECT 1 FROM public.game_state_observations state WHERE state.nfl_game_id=game.id
                AND state.provider='tank01' AND state.status_code IN (1,2,4))))
        THEN RETURN false; END IF;
    EXCEPTION WHEN invalid_text_representation OR invalid_datetime_format OR datetime_field_overflow
      OR numeric_value_out_of_range THEN RETURN false;
    END;
  END IF;
  IF p_outcome = 'published' THEN
    publication := job.payload->'lastPublication';
    IF job.payload->>'mode' = 'shadow'
      OR (publication->>'generation')::integer IS DISTINCT FROM job.attempt_count
      OR publication->'period' IS DISTINCT FROM job.payload->'period'
      OR jsonb_typeof(publication->'profileIds') IS DISTINCT FROM 'array' THEN RETURN false; END IF;
    expected_count := jsonb_array_length(publication->'profileIds');
    SELECT count(*), bool_and(COALESCE((content.coverage->>'scheduleFinalityComplete')::boolean,false)),
      min(observation.observed_at)
      INTO actual_count, stored_final, stored_observed_at
      FROM public.current_all_player_score_sets pointer
      JOIN public.all_player_stat_observations observation ON observation.id = pointer.all_player_stat_observation_id
      JOIN public.all_player_stat_contents content ON content.id = observation.all_player_stat_content_id
      WHERE pointer.provider = 'sleeper' AND pointer.season = (job.payload->'period'->>'season')::integer
        AND pointer.season_type = 'reg' AND pointer.week = (job.payload->'period'->>'week')::integer
        AND pointer.scorer_version = publication->>'scorerVersion'
        AND pointer.all_player_stat_observation_id = (publication->>'observationId')::uuid
        AND publication->'profileIds' ? pointer.scoring_profile_id::text
        AND observation.quality = 'complete' AND content.quality = 'complete';
    IF expected_count = 0 OR actual_count <> expected_count THEN RETURN false; END IF;
  END IF;
  result := jsonb_build_object('outcome', p_outcome, 'finishedAt', completed,
    'period', job.payload->'period', 'generation', job.attempt_count, 'diagnostic', p_diagnostic,
    'observedAt', COALESCE(stored_observed_at::text, p_diagnostic->>'observedAt', completed::text),
    'finalCoverage', p_outcome = 'published' AND COALESCE(stored_final,false));
  SELECT value INTO prior_final
    FROM jsonb_array_elements(COALESCE(job.payload->'periodHistory','[]'::jsonb)) value
    WHERE value->'period' = job.payload->'period'
      AND value->>'outcome' = 'published' AND value->>'finalCoverage' = 'true'
    ORDER BY value->>'observedAt' DESC LIMIT 1;
  summary := CASE WHEN prior_final IS NOT NULL AND NOT
      (p_outcome = 'published' AND COALESCE(stored_final,false))
    THEN prior_final || jsonb_build_object('lastAttempt',result)
    ELSE result END;
  -- One summary per requested period for this season; a correction failure never
  -- erases the successful final proof. At most 18 regular-season summaries.
  SELECT COALESCE(jsonb_agg(value ORDER BY (value->'period'->>'week')::integer),'[]'::jsonb)
    INTO history FROM (
      SELECT value FROM jsonb_array_elements(COALESCE(job.payload->'periodHistory','[]'::jsonb)) value
      WHERE value->'period' <> job.payload->'period'
        AND value->'period'->>'season' = job.payload->'period'->>'season'
      UNION ALL SELECT summary
    ) periods;
  UPDATE public.projection_jobs SET
    state = CASE WHEN p_outcome IN ('published','partial','no-statistics-yet') THEN 'completed' ELSE 'failed' END,
    completed_at = completed, lease_owner = NULL, lease_until = NULL, updated_at = completed,
    last_error = CASE WHEN p_outcome IN ('published','partial','no-statistics-yet') THEN NULL ELSE p_outcome END,
    payload = payload || jsonb_build_object('lastOutcome', result, 'periodHistory', history,
      'nextAttemptAt', CASE WHEN (job.payload->>'requestGeneration')::integer IS DISTINCT FROM job.attempt_count
        THEN completed + interval '1 hour' ELSE public.all_player_next_request_at(job.payload) END)
    WHERE job_key = job.job_key
      AND (p_outcome <> 'no-statistics-yet' OR (clock_timestamp() < first_kickoff
        AND clock_timestamp() < (job.payload->>'deadlineAt')::timestamptz
        AND clock_timestamp() < job.lease_until));
  RETURN FOUND;
END;
$$;
