import 'server-only';

import type { DatabaseClient } from '../../../database';
import type { ProjectionStore } from './contracts';
import { json, provider, requiredText } from './database-values';
import { materializationTargetValue } from './lineup-publication-values';
import {
  futureRefreshClaim,
  futureRefreshFailureCode,
  futureRefreshLeaseSeconds,
  futureRefreshNextAfter,
  futureRefreshPeriod,
  futureRefreshTimestamp,
  futureRefreshTransition,
  futureRefreshUuid,
} from './future-refresh-values';

type MaterializationFutureRefreshMethods = Pick<
  ProjectionStore,
  | 'beginFutureMaterializationRefresh'
  | 'completeFutureMaterializationRefresh'
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
          SELECT true WHERE ($11::jsonb IS NULL AND NOT EXISTS (
            SELECT 1 FROM league_week_lineup_watch_states
            WHERE league_key = $1 AND season = $3 AND season_type = $4 AND week = $5))
            OR EXISTS (SELECT 1 FROM watch JOIN authority USING (league_key)
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
            AND next_refresh_at <= now()
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
        input.target === undefined ? null : json(materializationTargetValue(input.target)),
      ]);
      return futureRefreshClaim(rows);
    },

    async completeFutureMaterializationRefresh(input) {
      const period = futureRefreshPeriod(input.period);
      const completedAt = futureRefreshTimestamp(
        input.completedAt,
        'Future materialization completion time',
      );
      const rows = await client.query(`/* projection-store:complete-future-materialization-refresh */
        WITH valid_slate AS (
          SELECT current.projection_slate_observation_id,
            current.projection_slate_content_id
          FROM current_projection_slates current
          JOIN projection_slate_observations observation
            ON observation.id = current.projection_slate_observation_id
            AND observation.projection_slate_content_id
              = current.projection_slate_content_id
            AND observation.provider = current.provider
            AND observation.season = current.season
            AND observation.season_type = current.season_type
            AND observation.week = current.week
            AND observation.normalizer_version = current.normalizer_version
          WHERE current.provider = $2 AND current.season = $3
            AND current.season_type = $4 AND current.week = $5
            AND current.normalizer_version = $6
            AND current.projection_slate_observation_id = $12::uuid
            AND current.projection_slate_content_id = $13::uuid
            AND observation.quality = 'complete'
        ), valid_league_source AS (
          SELECT observation.id, observation.observed_at
          FROM league_week_observations observation
          JOIN league_seasons season ON season.id = observation.league_season_id
          JOIN leagues league ON league.id = season.league_id
          WHERE league.league_key = $1 AND season.season = $3
            AND observation.week = $5 AND observation.source_revision = $11
            AND observation.provider = 'sleeper'
            AND observation.quality = 'complete'
          LIMIT 1
        ), valid_snapshot AS (
          SELECT snapshot.id, current.verified_at
          FROM projection_snapshots snapshot
          JOIN current_projection_snapshots current
            ON current.snapshot_id = snapshot.id
            AND current.league_season_id = snapshot.league_season_id
            AND current.week = snapshot.week
          JOIN league_seasons season ON season.id = snapshot.league_season_id
          JOIN leagues league ON league.id = season.league_id
          WHERE league.league_key = $1 AND season.season = $3
            AND snapshot.week = $5 AND snapshot.model_version = $7
            AND snapshot.revision_key = $14
            AND current.verification_source_observation_id = (SELECT id FROM valid_league_source)
          LIMIT 1
        )
        UPDATE league_week_materialization_states materialization SET
          active_attempt_id = NULL,
          active_attempt_started_at = NULL,
          active_attempt_expires_at = NULL,
            active_watch_id = NULL, active_watch_generation = NULL,
            active_authority_generation = NULL, active_target_observed_version = NULL,
            active_target_lineup_revision = NULL,
          last_succeeded_at = $9::timestamptz,
          last_source_revision = $11,
          last_projection_slate_observation_id
            = slate.projection_slate_observation_id,
          last_projection_slate_content_id = slate.projection_slate_content_id,
          last_snapshot_revision = $14,
          consecutive_failures = 0,
          last_failure_code = NULL,
          next_refresh_at = $10::timestamptz,
          updated_at = now()
        FROM valid_slate slate, valid_league_source source, valid_snapshot snapshot
        WHERE materialization.league_key = $1
          AND materialization.projection_provider = $2
          AND materialization.season = $3 AND materialization.season_type = $4
          AND materialization.week = $5 AND materialization.normalizer_version = $6
          AND materialization.model_version = $7
          AND materialization.active_attempt_id = $8::uuid
          AND materialization.active_watch_id IS NULL
          AND NOT EXISTS (SELECT 1 FROM league_week_lineup_watch_states watch
            WHERE watch.league_key = materialization.league_key
              AND watch.season = materialization.season
              AND watch.season_type = materialization.season_type
              AND watch.week = materialization.week)
          AND materialization.active_attempt_started_at <= now()
          AND materialization.active_attempt_expires_at > now()
          AND (materialization.last_succeeded_at IS NULL
            OR materialization.last_succeeded_at <= $9::timestamptz)
          AND snapshot.verified_at >= COALESCE(
            materialization.last_succeeded_at, materialization.created_at
          )
          AND snapshot.verified_at >= source.observed_at
          AND (
            materialization.last_projection_slate_content_id IS DISTINCT FROM
              slate.projection_slate_content_id
            OR source.observed_at >= COALESCE(
              materialization.last_succeeded_at, materialization.created_at
            )
          )
        RETURNING 0::integer AS consecutive_failures,
          materialization.next_refresh_at::text,
          0::integer AS materializations_woken`, [
        requiredText(input.leagueKey, 'League key'),
        provider(input.projectionProvider),
        period.season,
        period.seasonType,
        period.week,
        requiredText(input.normalizerVersion, 'Projection normalizer version'),
        requiredText(input.modelVersion, 'Projection model version'),
        futureRefreshUuid(input.attemptId, 'Future materialization attempt ID'),
        completedAt,
        futureRefreshNextAfter(input.nextRefreshAt, completedAt),
        requiredText(input.sourceRevision, 'League source revision'),
        futureRefreshUuid(input.slate.observationId, 'Projection slate observation ID'),
        futureRefreshUuid(input.slate.contentId, 'Projection slate content ID'),
        requiredText(input.snapshotRevision, 'Snapshot revision'),
      ]);
      return futureRefreshTransition(rows);
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
            AND (watch.id IS NOT NULL OR (materialization.active_watch_id IS NULL
              AND NOT EXISTS (SELECT 1 FROM league_week_lineup_watch_states old
                WHERE old.league_key = $1 AND old.season = $3 AND old.season_type = $4 AND old.week = $5)))
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
