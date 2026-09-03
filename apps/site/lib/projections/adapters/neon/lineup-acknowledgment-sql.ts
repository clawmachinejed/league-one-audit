import 'server-only';

/** Authority, watch, attempt and exact verified source are locked/proven in the same statement. */
export const LINEUP_ACKNOWLEDGMENT_CTES = `
  context AS (SELECT $1::jsonb AS value),
  authority AS MATERIALIZED (
    SELECT authority.* FROM league_period_authorities authority, context
    WHERE authority.league_key = context.value->>'leagueKey'
    FOR UPDATE OF authority
  ), watch AS MATERIALIZED (
    SELECT watch.* FROM league_week_lineup_watch_states watch
    JOIN authority USING (league_key) CROSS JOIN context
    WHERE watch.id = (context.value->>'watchId')::uuid
      AND watch.watch_generation = (context.value->>'watchGeneration')::bigint
      AND watch.authority_generation = (context.value->>'authorityGeneration')::bigint
      AND watch.authority_generation = authority.authority_generation
      AND watch.season = (context.value->>'season')::smallint
      AND watch.season_type = context.value->>'seasonType'
      AND watch.week = (context.value->>'week')::smallint
      AND watch.materialization_lane = context.value->>'ownerLane'
      AND watch.retired_at IS NULL
      AND watch.lineup_revision_version = context.value->>'lineupRevisionVersion'
      AND watch.source_provider = authority.source_provider
      AND watch.external_league_id = authority.source_external_league_id
      AND authority.default_season = watch.season
      AND authority.default_season_type = watch.season_type
      AND authority.verified_at BETWEEN now() - interval '10 minutes' AND now()
      AND authority.source_observed_at BETWEEN now() - interval '10 minutes' AND now()
      AND ((watch.materialization_lane = 'current' AND authority.league_lifecycle = 'active'
          AND authority.active_week = watch.week)
        OR (watch.materialization_lane = 'future'
          AND ((authority.league_lifecycle = 'preseason' AND watch.week >= authority.default_week)
            OR (authority.league_lifecycle = 'active' AND watch.week > authority.active_week))))
    FOR UPDATE OF watch
  ), job AS MATERIALIZED (
    SELECT job.* FROM projection_jobs job CROSS JOIN context CROSS JOIN watch
    WHERE job.job_key = CASE watch.materialization_lane
      WHEN 'current' THEN 'live-projection-sync' ELSE 'future-projection-sync' END
      AND job.state = 'running' AND job.lease_owner = context.value->>'runId'
      AND job.lease_until > now()
    FOR SHARE OF job
  ), attempt AS MATERIALIZED (
    SELECT materialization.* FROM league_week_materialization_states materialization
    JOIN watch ON watch.league_key = materialization.league_key
      AND watch.season = materialization.season AND watch.season_type = materialization.season_type
      AND watch.week = materialization.week CROSS JOIN context
    WHERE watch.materialization_lane = 'future'
      AND materialization.projection_provider = context.value->>'projectionProvider'
      AND materialization.normalizer_version = context.value->>'normalizerVersion'
      AND materialization.model_version = context.value->>'modelVersion'
      AND materialization.active_attempt_id = (context.value->>'attemptId')::uuid
      AND materialization.active_attempt_expires_at > now()
      AND materialization.active_watch_id = watch.id
      AND materialization.active_watch_generation = watch.watch_generation
      AND materialization.active_authority_generation = watch.authority_generation
      AND materialization.active_target_observed_version = (context.value->>'observedVersion')::bigint
      AND materialization.active_target_lineup_revision IS NOT DISTINCT FROM context.value->>'targetLineupRevision'
    FOR UPDATE OF materialization
  ), verified_source AS MATERIALIZED (
    SELECT source.id, source.observed_at, current.verified_at, snapshot.revision_key
    FROM current_projection_snapshots current
    JOIN projection_snapshots snapshot ON snapshot.id = current.snapshot_id
      AND snapshot.league_season_id = current.league_season_id AND snapshot.week = current.week
    JOIN league_week_observations source ON source.id = current.verification_source_observation_id
      AND source.league_season_id = current.league_season_id AND source.week = current.week
    JOIN league_seasons season ON season.id = source.league_season_id
    JOIN leagues league ON league.id = season.league_id
    JOIN league_source_connections connection ON connection.league_season_id = season.id
      AND connection.provider = source.provider
    JOIN watch ON watch.league_key = league.league_key AND watch.season = season.season
      AND watch.week = source.week AND watch.source_provider = connection.provider
      AND watch.external_league_id = connection.external_league_id
    CROSS JOIN context
    WHERE source.quality = 'complete'
      AND source.source_revision = context.value->>'sourceRevision'
      AND source.lineup_revision_version = context.value->>'lineupRevisionVersion'
      AND source.lineup_revision = context.value->>'lineupRevision'
      AND snapshot.model_version = context.value->>'modelVersion'
      AND snapshot.revision_key = context.value->>'snapshotRevision'
      AND current.verified_at >= source.request_completed_at
      AND (watch.last_materialized_verified_at IS NULL
        OR current.verified_at >= watch.last_materialized_verified_at)
    FOR SHARE OF current
  ), valid_slate AS (
    SELECT current.projection_slate_observation_id, current.projection_slate_content_id
    FROM current_projection_slates current
    JOIN projection_slate_observations observation ON observation.id = current.projection_slate_observation_id
      AND observation.projection_slate_content_id = current.projection_slate_content_id
      AND observation.provider = current.provider AND observation.season = current.season
      AND observation.season_type = current.season_type AND observation.week = current.week
      AND observation.normalizer_version = current.normalizer_version
    CROSS JOIN context
    WHERE current.provider = context.value->>'projectionProvider'
      AND current.season = (context.value->>'season')::smallint
      AND current.season_type = context.value->>'seasonType'
      AND current.week = (context.value->>'week')::smallint
      AND current.normalizer_version = context.value->>'normalizerVersion'
      AND current.projection_slate_observation_id = (context.value->>'slateObservationId')::uuid
      AND current.projection_slate_content_id = (context.value->>'slateContentId')::uuid
      AND observation.quality = 'complete'
  ), acknowledged AS (
    UPDATE league_week_lineup_watch_states state SET
      last_materialized_lineup_revision = context.value->>'lineupRevision',
      last_materialized_snapshot_revision = context.value->>'snapshotRevision',
      last_materialized_verified_at = source.verified_at,
      pending_since = CASE
        WHEN state.latest_lineup_revision IS NULL
          OR state.latest_lineup_revision = context.value->>'lineupRevision' THEN NULL
        ELSE COALESCE(state.pending_since, state.last_complete_observation_at, now()) END,
      updated_at = now()
    FROM watch, context, verified_source source
    WHERE state.id = watch.id AND EXISTS (SELECT 1 FROM job)
      AND (watch.materialization_lane = 'current'
        OR (EXISTS (SELECT 1 FROM attempt) AND EXISTS (SELECT 1 FROM valid_slate)))
    RETURNING state.id, state.pending_since, source.verified_at
  )`;
