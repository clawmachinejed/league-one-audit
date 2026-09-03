import 'server-only';

import type { DatabaseClient } from '../../../database';
import type { ProjectionStore } from './contracts';
import { json, provider, requiredText } from './database-values';
import { materializationTargetValue } from './lineup-publication-values';
import {
  futureRefreshClaim,
  futureRefreshFailureCode,
  futureRefreshLeaseSeconds,
  futureRefreshPeriod,
  futureRefreshTimestamp,
  futureRefreshTransition,
  futureRefreshUuid,
} from './future-refresh-values';

type MaterializationFutureRefreshMethods = Pick<
  ProjectionStore,
  | 'beginFutureMaterializationRefresh'
  | 'failFutureMaterializationRefresh'
>;

export function createMaterializationFutureRefreshMethods(
  client: DatabaseClient,
): MaterializationFutureRefreshMethods {
  return {
    async beginFutureMaterializationRefresh(input) {
      const period = futureRefreshPeriod(input.period);
      const rows = await client.query(`/* projection-store:begin-future-materialization-refresh */
        WITH input_clock AS (SELECT $9::timestamptz AS requested_at),
        authority AS MATERIALIZED (
          SELECT * FROM league_period_authorities WHERE league_key = $1 FOR UPDATE
        ), watch AS MATERIALIZED (
          SELECT watch.* FROM league_week_lineup_watch_states watch
          JOIN authority ON authority.league_key = watch.league_key
          WHERE watch.season = $3 AND watch.season_type = $4 AND watch.week = $5
            AND watch.retired_at IS NULL FOR UPDATE OF watch
        ), valid_target AS (
          SELECT true WHERE EXISTS (SELECT 1 FROM watch JOIN authority USING (league_key)
              WHERE watch.id = ($11::jsonb->>'watchId')::uuid
                AND watch.watch_generation = ($11::jsonb->>'watchGeneration')::bigint
                AND watch.authority_generation = ($11::jsonb->>'authorityGeneration')::bigint
                AND watch.authority_generation = authority.authority_generation
                AND watch.observed_version = ($11::jsonb->>'observedVersion')::bigint
                AND watch.latest_lineup_revision IS NOT DISTINCT FROM $11::jsonb->>'lineupRevision'
                AND watch.materialization_lane = 'future'
                AND authority.source_provider = watch.source_provider
                AND authority.source_external_league_id = watch.external_league_id
                AND authority.verified_at BETWEEN now() - interval '10 minutes' AND now()
                AND authority.source_observed_at BETWEEN now() - interval '10 minutes' AND now()
                AND authority.default_season = watch.season
                AND authority.default_season_type = watch.season_type
                AND ((authority.league_lifecycle = 'preseason' AND watch.week >= authority.default_week)
                  OR (authority.league_lifecycle = 'active' AND watch.week > authority.active_week)))
        ), expired AS (
          UPDATE league_week_materialization_states SET
            active_attempt_id = NULL,
            active_attempt_started_at = NULL,
            active_attempt_expires_at = NULL,
            active_watch_id = NULL, active_watch_generation = NULL,
            active_authority_generation = NULL, active_target_observed_version = NULL,
            active_target_lineup_revision = NULL,
            consecutive_failures = CASE WHEN active_watch_id IS NOT NULL
              AND active_target_observed_version IS DISTINCT FROM ($11::jsonb->>'observedVersion')::bigint
              THEN consecutive_failures ELSE consecutive_failures + 1 END,
            last_failure_code = CASE WHEN active_watch_id IS NOT NULL
              AND active_target_observed_version IS DISTINCT FROM ($11::jsonb->>'observedVersion')::bigint
              THEN last_failure_code ELSE 'deadline-exceeded' END,
            next_refresh_at = now() + CASE
              WHEN active_watch_id IS NOT NULL
                AND active_target_observed_version IS DISTINCT FROM ($11::jsonb->>'observedVersion')::bigint
                THEN interval '0 seconds'
              WHEN consecutive_failures = 0 THEN interval '5 minutes'
              WHEN consecutive_failures = 1 THEN interval '15 minutes'
              WHEN consecutive_failures = 2 THEN interval '1 hour'
              ELSE interval '6 hours'
            END,
            updated_at = now()
          WHERE league_key = $1 AND projection_provider = $2
            AND season = $3 AND season_type = $4 AND week = $5
            AND normalizer_version = $6 AND model_version = $7
            AND active_attempt_id IS NOT NULL
            AND active_attempt_expires_at <= now()
            AND EXISTS (SELECT 1 FROM valid_target)
          RETURNING consecutive_failures, next_refresh_at
        ), claimed AS (
          UPDATE league_week_materialization_states SET
            attempt_count = attempt_count + 1,
            active_attempt_id = $8::uuid,
            active_attempt_started_at = now(),
            active_attempt_expires_at = now() + ($10::integer * interval '1 second'),
            active_watch_id = ($11::jsonb->>'watchId')::uuid,
            active_watch_generation = ($11::jsonb->>'watchGeneration')::bigint,
            active_authority_generation = ($11::jsonb->>'authorityGeneration')::bigint,
            active_target_observed_version = ($11::jsonb->>'observedVersion')::bigint,
            active_target_lineup_revision = $11::jsonb->>'lineupRevision',
            last_attempted_at = now(),
            updated_at = now()
          WHERE league_key = $1 AND projection_provider = $2
            AND season = $3 AND season_type = $4 AND week = $5
            AND normalizer_version = $6 AND model_version = $7
            AND NOT EXISTS (SELECT 1 FROM expired)
            AND EXISTS (SELECT 1 FROM valid_target)
            AND (next_refresh_at <= now() OR ($12::boolean AND EXISTS (
              SELECT 1 FROM projection_jobs WHERE job_key = 'future-projection-sync'
                AND lease_owner = $8::text AND state = 'running' AND lease_until > now())))
            AND active_attempt_id IS NULL
            AND (last_attempted_at IS NULL OR last_attempted_at <= now())
          RETURNING attempt_count, active_attempt_id, active_attempt_expires_at
        )
        SELECT 'acquired'::text AS result_kind,
          attempt_count, active_attempt_id::text AS attempt_id,
          active_attempt_expires_at::text AS lease_until,
          0::integer AS consecutive_failures,
          active_attempt_expires_at::text AS next_refresh_at
        FROM claimed
        UNION ALL
        SELECT 'backed-off'::text AS result_kind,
          0::integer AS attempt_count, NULL::text AS attempt_id,
          NULL::text AS lease_until, consecutive_failures,
          next_refresh_at::text
        FROM expired`, [
        requiredText(input.leagueKey, 'League key'),
        provider(input.projectionProvider),
        period.season,
        period.seasonType,
        period.week,
        requiredText(input.normalizerVersion, 'Projection normalizer version'),
        requiredText(input.modelVersion, 'Projection model version'),
        futureRefreshUuid(input.attemptId, 'Future materialization attempt ID'),
        futureRefreshTimestamp(input.attemptedAt, 'Future materialization attempt time'),
        futureRefreshLeaseSeconds(input.leaseSeconds),
        json(materializationTargetValue(input.target)),
        input.force === true,
      ]);
      return futureRefreshClaim(rows);
    },

    async failFutureMaterializationRefresh(input) {
      const period = futureRefreshPeriod(input.period);
      const rows = await client.query(`/* projection-store:fail-future-materialization-refresh */
        WITH authority AS MATERIALIZED (
          SELECT * FROM league_period_authorities WHERE league_key = $1 FOR UPDATE
        ), watch AS MATERIALIZED (
          SELECT watch.* FROM league_week_lineup_watch_states watch
          JOIN authority USING (league_key)
          WHERE watch.season = $3 AND watch.season_type = $4 AND watch.week = $5
            AND watch.retired_at IS NULL AND watch.materialization_lane = 'future'
            AND watch.authority_generation = authority.authority_generation
            AND authority.source_provider = watch.source_provider
            AND authority.source_external_league_id = watch.external_league_id
            AND authority.verified_at BETWEEN now() - interval '10 minutes' AND now()
            AND authority.source_observed_at BETWEEN now() - interval '10 minutes' AND now()
          FOR UPDATE OF watch
        ), target AS MATERIALIZED (
          SELECT materialization.*, COALESCE(watch.observed_version
            IS DISTINCT FROM materialization.active_target_observed_version, false)
            AND materialization.active_watch_id IS NOT NULL AS newer_lineup
          FROM league_week_materialization_states materialization
          LEFT JOIN watch ON watch.id = materialization.active_watch_id
            AND watch.watch_generation = materialization.active_watch_generation
            AND watch.authority_generation = materialization.active_authority_generation
          WHERE materialization.league_key = $1 AND materialization.projection_provider = $2
            AND materialization.season = $3 AND materialization.season_type = $4
            AND materialization.week = $5 AND materialization.normalizer_version = $6
            AND materialization.model_version = $7 AND materialization.active_attempt_id = $8::uuid
            AND materialization.active_attempt_expires_at > now()
            AND watch.id IS NOT NULL
          FOR UPDATE OF materialization
        ) UPDATE league_week_materialization_states materialization SET
          active_attempt_id = NULL,
          active_attempt_started_at = NULL,
          active_attempt_expires_at = NULL,
            active_watch_id = NULL, active_watch_generation = NULL,
            active_authority_generation = NULL, active_target_observed_version = NULL,
            active_target_lineup_revision = NULL,
          consecutive_failures = CASE WHEN target.newer_lineup THEN materialization.consecutive_failures
            ELSE materialization.consecutive_failures + 1 END,
          last_failure_code = CASE WHEN target.newer_lineup THEN materialization.last_failure_code ELSE $10 END,
          next_refresh_at = now() + CASE
            WHEN target.newer_lineup THEN interval '0 seconds'
            WHEN materialization.consecutive_failures = 0 THEN interval '5 minutes'
            WHEN materialization.consecutive_failures = 1 THEN interval '15 minutes'
            WHEN materialization.consecutive_failures = 2 THEN interval '1 hour'
            ELSE interval '6 hours'
          END,
          updated_at = now()
        FROM target
        WHERE materialization.league_key = target.league_key
          AND materialization.projection_provider = target.projection_provider
          AND materialization.season = target.season AND materialization.season_type = target.season_type
          AND materialization.week = target.week AND materialization.normalizer_version = target.normalizer_version
          AND materialization.model_version = target.model_version
          AND $9::timestamptz IS NOT NULL
        RETURNING materialization.consecutive_failures, materialization.next_refresh_at::text,
          0::integer AS materializations_woken`, [
        requiredText(input.leagueKey, 'League key'),
        provider(input.projectionProvider),
        period.season,
        period.seasonType,
        period.week,
        requiredText(input.normalizerVersion, 'Projection normalizer version'),
        requiredText(input.modelVersion, 'Projection model version'),
        futureRefreshUuid(input.attemptId, 'Future materialization attempt ID'),
        futureRefreshTimestamp(input.failedAt, 'Future materialization failure time'),
        futureRefreshFailureCode(input.failureCode),
      ]);
      return futureRefreshTransition(rows);
    },
  };
}
