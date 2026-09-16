-- Retain valid unresolved player observations; record verified pregame no-data outcomes.
-- Additive correction only. Installed 001-017, immutable rows and pointer guards remain intact.
-- Both replacements preserve their existing owners, SECURITY DEFINER and execute privileges.

CREATE OR REPLACE FUNCTION public.validate_all_player_stat_entry()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  content_context record;
  game_context record;
  period_evidence jsonb;
  weekly_evidence jsonb;
  raw_key text;
  evidence_key text;
  expected_raw jsonb;
BEGIN
  IF public.all_player_eligibility_evidence_matches(NEW.eligibility_evidence,
    NEW.eligible_game_count,NEW.appearance_game_count) IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'all-player eligibility evidence does not support its counts';
  END IF;
  SELECT season,season_type,week,normalizer_version,quality INTO STRICT content_context
  FROM public.all_player_stat_contents WHERE id = NEW.all_player_stat_content_id;
  IF NEW.eligibility_evidence->>'kind' = 'assumed-nonparticipation' THEN
    IF content_context.normalizer_version NOT LIKE '%-weekly-stats-v4'
      OR NEW.entity_kind IS DISTINCT FROM 'player' THEN
      RAISE EXCEPTION 'all-player participation assumption requires a v4 player observation';
    END IF;
    IF NEW.eligibility_evidence->'basis'->>'kind' = 'missing-provider-row' AND NEW.stats <> '{}'::jsonb THEN
      RAISE EXCEPTION 'all-player missing-row participation assumption requires empty statistics';
    END IF;
  END IF;
  weekly_evidence := CASE WHEN NEW.eligibility_evidence->>'kind' = 'weekly-stat'
    THEN NEW.eligibility_evidence
    WHEN NEW.eligibility_evidence->>'kind' = 'assumed-nonparticipation'
      AND NEW.eligibility_evidence->'basis'->>'kind' = 'weekly-stat' THEN NEW.eligibility_evidence->'basis'
    ELSE NEW.eligibility_evidence->'weekly' END;
  IF (content_context.normalizer_version LIKE '%-weekly-stats-v3' OR content_context.normalizer_version LIKE '%-weekly-stats-v4')
    AND weekly_evidence IS NULL AND NEW.stats ?| ARRAY['gms_active','gp','off_snp','def_snp','st_snp'] THEN
    RAISE EXCEPTION 'all-player retained participation statistics require weekly evidence';
  END IF;
  IF weekly_evidence IS NOT NULL THEN
    FOREACH raw_key IN ARRAY ARRAY['gms_active','gp'] LOOP
      evidence_key := CASE WHEN raw_key = 'gms_active' THEN 'gmsActive' ELSE 'appearances' END;
      IF weekly_evidence->'rawFlags' ? raw_key THEN
        expected_raw := CASE WHEN jsonb_typeof(weekly_evidence->'rawFlags'->raw_key) = 'number'
          THEN weekly_evidence->'rawFlags'->raw_key ELSE NULL END;
      ELSE expected_raw := weekly_evidence->evidence_key;
      END IF;
      IF NEW.stats->raw_key IS DISTINCT FROM expected_raw THEN
        RAISE EXCEPTION 'all-player weekly eligibility flag disagrees with retained statistics';
      END IF;
    END LOOP;
    IF weekly_evidence ? 'individualSnaps'
      OR COALESCE(weekly_evidence->'rawFlags' ?| ARRAY['off_snp','def_snp','st_snp'],false) THEN
      IF NEW.entity_kind IS DISTINCT FROM 'player' THEN
        RAISE EXCEPTION 'all-player individual snap evidence requires a player identity';
      END IF;
    END IF;
    -- v2 observations may already retain snap statistics without using them as
    -- participation evidence. Preserve those exact historical replays. v3
    -- and any caller using the new evidence must bind every retained snap key.
    IF content_context.normalizer_version LIKE '%-weekly-stats-v3' OR content_context.normalizer_version LIKE '%-weekly-stats-v4'
      OR weekly_evidence ? 'individualSnaps'
      OR COALESCE(weekly_evidence->'rawFlags' ?| ARRAY['off_snp','def_snp','st_snp'],false) THEN
      FOREACH raw_key IN ARRAY ARRAY['off_snp','def_snp','st_snp'] LOOP
        IF weekly_evidence->'rawFlags' ? raw_key THEN
          expected_raw := CASE WHEN jsonb_typeof(weekly_evidence->'rawFlags'->raw_key) = 'number'
            THEN weekly_evidence->'rawFlags'->raw_key ELSE NULL END;
        ELSE expected_raw := weekly_evidence->'individualSnaps'->raw_key;
        END IF;
        IF NEW.stats->raw_key IS DISTINCT FROM expected_raw THEN
          RAISE EXCEPTION 'all-player individual snap evidence disagrees with retained statistics';
        END IF;
      END LOOP;
    END IF;
  END IF;
  period_evidence := CASE WHEN NEW.eligibility_evidence->>'kind' IN ('combined-ineligible','conflict')
    THEN NEW.eligibility_evidence->'ineligibility'
    WHEN NEW.eligibility_evidence->>'kind' IN ('explicit-ineligible','period-participation','assumed-nonparticipation')
    THEN NEW.eligibility_evidence ELSE NULL END;
  IF period_evidence IS NOT NULL AND (
    (period_evidence->'effectivePeriod'->>'season')::integer IS DISTINCT FROM content_context.season
    OR period_evidence->'effectivePeriod'->>'seasonType' IS DISTINCT FROM content_context.season_type
    OR (period_evidence->'effectivePeriod'->>'week')::integer IS DISTINCT FROM content_context.week
  ) THEN RAISE EXCEPTION 'all-player eligibility evidence does not match its content period'; END IF;
  IF NEW.eligible_game_count = 1 AND NEW.nfl_game_id IS NULL
    AND NOT (content_context.quality = 'partial' AND NEW.entity_kind = 'player'
      AND NEW.game_phase = 'unknown') THEN
    RAISE EXCEPTION 'eligible all-player entry requires an NFL game';
  END IF;
  IF NEW.nfl_game_id IS NOT NULL THEN
    SELECT season,season_type,week,home_team,away_team INTO STRICT game_context
    FROM public.nfl_games WHERE id = NEW.nfl_game_id;
    IF NEW.nfl_team IS NULL OR game_context.season <> content_context.season
      OR game_context.season_type <> content_context.season_type OR game_context.week <> content_context.week
      OR NEW.nfl_team NOT IN (game_context.home_team,game_context.away_team) THEN
      RAISE EXCEPTION 'all-player NFL game does not match its content period and team';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

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
  IF NOT FOUND OR jsonb_typeof(p_fence) IS DISTINCT FROM 'object'
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
      IF NOT EXISTS (SELECT 1 FROM public.league_administration_enrollment_seasons
          WHERE provider='sleeper' AND season=(job.payload->'period'->>'season')::integer)
        OR EXISTS (
          SELECT 1 FROM public.league_administration_enrollment_seasons enrollment
          JOIN public.leagues league ON league.id=enrollment.league_id
          LEFT JOIN public.league_seasons season ON season.league_id=enrollment.league_id
            AND season.season=enrollment.season
          LEFT JOIN public.league_source_connections connection ON connection.league_season_id=season.id
            AND connection.provider='sleeper'
          LEFT JOIN public.league_period_authorities authority ON authority.league_key=league.league_key
          WHERE enrollment.provider='sleeper' AND enrollment.season=(job.payload->'period'->>'season')::integer
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
