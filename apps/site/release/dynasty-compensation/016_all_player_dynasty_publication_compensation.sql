-- Forward compensation for 015, pending separate rollback approval and review.
-- Restores the exact two publication function bodies from installed migration 011.
-- Leaves 001-015, all history, mappings, league registrations and pointers intact.
-- Requires the original two-league application and recurrence disabled beforehand.
-- After approval, commit this exact file as migration 016 before executing its
-- reviewed wrapper. A later reactivation requires another forward migration.

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

  provided_observation_count := jsonb_array_length(
    candidate.coverage->'parity_observation_ids'
  );
  SELECT count(*) INTO expected_observation_count
  FROM public.leagues league
  JOIN public.league_seasons season ON season.league_id = league.id
  WHERE league.league_key IN ('league1', 'league2')
    AND season.season = candidate.season
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
      AND league.league_key IN ('league1', 'league2')
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

  WITH canonical_leagues AS (
    SELECT season.id AS league_season_id, season.scoring_profile_id
    FROM public.leagues league
    JOIN public.league_seasons season ON season.league_id = league.id
    WHERE league.league_key IN ('league1', 'league2') AND season.season = p_season
  ), expected_profiles AS (
    SELECT DISTINCT scoring_profile_id FROM canonical_leagues
  )
  SELECT
    (SELECT count(*) FROM canonical_leagues),
    (SELECT count(*) FROM expected_profiles),
    (SELECT jsonb_agg(scoring_profile_id::text ORDER BY scoring_profile_id::text)
      FROM expected_profiles),
    (SELECT count(*) FROM canonical_leagues
      WHERE scoring_profile_id = p_scoring_profile_id)
  INTO expected_league_count, expected_profile_count, expected_profile_ids,
    expected_parity_league_count;
  IF expected_league_count <> 2 OR expected_profile_count = 0
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
      FROM public.leagues league
      JOIN public.league_seasons season ON season.league_id = league.id
      WHERE league.league_key IN ('league1', 'league2') AND season.season = p_season
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
      AND league.league_key IN ('league1', 'league2')
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
REVOKE ALL ON FUNCTION public.all_player_score_set_is_publication_ready(uuid,jsonb,uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.advance_current_all_player_score_set(text,smallint,text,smallint,uuid,text,uuid,uuid,timestamptz) FROM PUBLIC;
