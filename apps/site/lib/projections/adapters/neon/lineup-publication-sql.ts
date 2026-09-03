import 'server-only';

/** Part of the existing atomic publication statement, never a separate preflight query. */
export const LINEUP_PUBLICATION_CTES = `
        publication_authority AS MATERIALIZED (
          SELECT authority.* FROM league_period_authorities authority
          JOIN league_source source ON source.league_key = authority.league_key
          FOR UPDATE OF authority
        ), publication_watch AS MATERIALIZED (
          SELECT watch.* FROM league_week_lineup_watch_states watch
          JOIN publication_authority authority ON authority.league_key = watch.league_key
          JOIN league_source source ON source.league_key = watch.league_key
          WHERE watch.season = source.season AND watch.season_type = 'reg'
            AND watch.week = $3 AND watch.retired_at IS NULL
          FOR UPDATE OF watch
        ), publication_job AS MATERIALIZED (
          SELECT job.* FROM projection_jobs job
          CROSS JOIN publication_watch watch
          WHERE job.job_key = CASE $13::jsonb->>'ownerLane'
            WHEN 'current' THEN 'live-projection-sync' ELSE 'future-projection-sync' END
            AND job.state = 'running' AND job.lease_owner = $13::jsonb->>'runId'
            AND job.lease_until > now()
          FOR SHARE OF job
        ), publication_materialization AS MATERIALIZED (
          SELECT materialization.* FROM league_week_materialization_states materialization
          CROSS JOIN publication_watch watch
          WHERE $13::jsonb->>'ownerLane' = 'future'
            AND materialization.league_key = watch.league_key
            AND materialization.season = watch.season
            AND materialization.season_type = watch.season_type
            AND materialization.week = watch.week
            AND materialization.projection_provider = $13::jsonb->>'projectionProvider'
            AND materialization.normalizer_version = $13::jsonb->>'normalizerVersion'
            AND materialization.model_version = $5
            AND materialization.active_attempt_id = ($13::jsonb->>'materializationAttemptId')::uuid
            AND materialization.active_watch_id = watch.id
            AND materialization.active_watch_generation = watch.watch_generation
            AND materialization.active_authority_generation = watch.authority_generation
            AND materialization.active_attempt_expires_at > now()
          FOR UPDATE OF materialization
        ), publication_lineup_guard AS (
          SELECT true AS accepted WHERE EXISTS (
              SELECT 1 FROM publication_watch watch
              JOIN publication_authority authority ON authority.league_key = watch.league_key
              JOIN league_source source ON source.league_key = watch.league_key
              WHERE watch.id = ($13::jsonb->>'watchId')::uuid
                AND watch.watch_generation = ($13::jsonb->>'watchGeneration')::bigint
                AND watch.authority_generation = ($13::jsonb->>'authorityGeneration')::bigint
                AND authority.authority_generation = watch.authority_generation
                AND authority.source_provider = watch.source_provider
                AND authority.source_external_league_id = watch.external_league_id
                AND source.source_provider = watch.source_provider
                AND source.external_league_id = watch.external_league_id
                AND source.lineup_revision_version = watch.lineup_revision_version
                AND source.lineup_revision IS NOT NULL
                AND authority.verified_at BETWEEN now() - interval '10 minutes' AND now()
                AND authority.source_observed_at BETWEEN now() - interval '10 minutes' AND now()
                AND watch.materialization_lane = $13::jsonb->>'ownerLane'
                AND authority.default_season = watch.season
                AND authority.default_season_type = watch.season_type
                AND ((watch.materialization_lane = 'current'
                  AND authority.league_lifecycle = 'active'
                  AND authority.active_week = watch.week)
                OR (watch.materialization_lane = 'future'
                  AND ((authority.league_lifecycle = 'preseason' AND watch.week >= authority.default_week)
                    OR (authority.league_lifecycle = 'active' AND watch.week > authority.active_week))))
                AND EXISTS (SELECT 1 FROM publication_job)
                AND (watch.materialization_lane = 'current'
                  OR EXISTS (SELECT 1 FROM publication_materialization))
            )
        )`;
