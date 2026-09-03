import 'server-only';

import type { DatabaseClient } from '../../../database';
import type { ProjectionStore } from './contracts';
import { provider, requiredText } from './database-values';
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

type ProjectionFutureRefreshMethods = Pick<
  ProjectionStore,
  | 'beginFutureProjectionRefresh'
  | 'completeFutureProjectionRefresh'
  | 'failFutureProjectionRefresh'
>;

export function createProjectionFutureRefreshMethods(
  client: DatabaseClient,
): ProjectionFutureRefreshMethods {
  return {
    async beginFutureProjectionRefresh(input) {
      const period = futureRefreshPeriod(input.period);
      const rows = await client.query(`/* projection-store:begin-future-projection-refresh */
        WITH expired AS (
          UPDATE projection_period_refresh_states SET
            active_attempt_id = NULL,
            active_attempt_started_at = NULL,
            active_attempt_expires_at = NULL,
            consecutive_failures = consecutive_failures + 1,
            last_failure_code = 'deadline-exceeded',
            next_refresh_at = $7::timestamptz + CASE
              WHEN consecutive_failures = 0 THEN interval '5 minutes'
              WHEN consecutive_failures = 1 THEN interval '15 minutes'
              WHEN consecutive_failures = 2 THEN interval '1 hour'
              ELSE interval '6 hours'
            END,
            updated_at = now()
          WHERE projection_provider = $1 AND season = $2 AND season_type = $3
            AND week = $4 AND normalizer_version = $5
            AND active_attempt_id IS NOT NULL
            AND active_attempt_expires_at <= $7::timestamptz
          RETURNING consecutive_failures, next_refresh_at
        ), claimed AS (
          UPDATE projection_period_refresh_states SET
            attempt_count = attempt_count + 1,
            active_attempt_id = $6::uuid,
            active_attempt_started_at = $7::timestamptz,
            active_attempt_expires_at = $7::timestamptz + ($8::integer * interval '1 second'),
            last_attempted_at = $7::timestamptz,
            updated_at = now()
          WHERE projection_provider = $1 AND season = $2 AND season_type = $3
            AND week = $4 AND normalizer_version = $5
            AND NOT EXISTS (SELECT 1 FROM expired)
            AND next_refresh_at <= $7::timestamptz
            AND active_attempt_id IS NULL
            AND (last_attempted_at IS NULL OR last_attempted_at <= $7::timestamptz)
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
        provider(input.projectionProvider),
        period.season,
        period.seasonType,
        period.week,
        requiredText(input.normalizerVersion, 'Projection normalizer version'),
        futureRefreshUuid(input.attemptId, 'Future projection attempt ID'),
        futureRefreshTimestamp(input.attemptedAt, 'Future projection attempt time'),
        futureRefreshLeaseSeconds(input.leaseSeconds),
      ]);
      return futureRefreshClaim(rows);
    },

    async completeFutureProjectionRefresh(input) {
      const period = futureRefreshPeriod(input.period);
      const completedAt = futureRefreshTimestamp(
        input.completedAt,
        'Future projection completion time',
      );
      const rows = await client.query(`/* projection-store:complete-future-projection-refresh */
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
          WHERE current.provider = $1 AND current.season = $2
            AND current.season_type = $3 AND current.week = $4
            AND current.normalizer_version = $5
            AND current.projection_slate_observation_id = $9::uuid
            AND current.projection_slate_content_id = $10::uuid
            AND observation.quality = 'complete'
        ), completed AS (
          UPDATE projection_period_refresh_states refresh SET
            active_attempt_id = NULL,
            active_attempt_started_at = NULL,
            active_attempt_expires_at = NULL,
            last_succeeded_at = $7::timestamptz,
            last_projection_slate_observation_id
              = slate.projection_slate_observation_id,
            last_projection_slate_content_id = slate.projection_slate_content_id,
            consecutive_failures = 0,
            last_failure_code = NULL,
            next_refresh_at = $8::timestamptz,
            updated_at = now()
          FROM valid_slate slate
          WHERE refresh.projection_provider = $1 AND refresh.season = $2
            AND refresh.season_type = $3 AND refresh.week = $4
            AND refresh.normalizer_version = $5
            AND refresh.active_attempt_id = $6::uuid
            AND refresh.active_attempt_started_at <= $7::timestamptz
            AND refresh.active_attempt_expires_at >= $7::timestamptz
            AND (refresh.last_succeeded_at IS NULL
              OR refresh.last_succeeded_at <= $7::timestamptz)
          RETURNING refresh.next_refresh_at
        ), woken AS (
          UPDATE league_week_materialization_states materialization SET
            next_refresh_at = LEAST(materialization.next_refresh_at, $7::timestamptz),
            updated_at = now()
          FROM completed
          WHERE materialization.projection_provider = $1
            AND materialization.season = $2
            AND materialization.season_type = $3
            AND materialization.week = $4
            AND materialization.normalizer_version = $5
            AND materialization.last_projection_slate_content_id IS DISTINCT FROM $10::uuid
          RETURNING materialization.league_key
        )
        SELECT 0::integer AS consecutive_failures,
          completed.next_refresh_at::text,
          (SELECT count(*) FROM woken)::integer AS materializations_woken
        FROM completed`, [
        provider(input.projectionProvider),
        period.season,
        period.seasonType,
        period.week,
        requiredText(input.normalizerVersion, 'Projection normalizer version'),
        futureRefreshUuid(input.attemptId, 'Future projection attempt ID'),
        completedAt,
        futureRefreshNextAfter(input.nextRefreshAt, completedAt),
        futureRefreshUuid(input.slate.observationId, 'Projection slate observation ID'),
        futureRefreshUuid(input.slate.contentId, 'Projection slate content ID'),
      ]);
      return futureRefreshTransition(rows);
    },

    async failFutureProjectionRefresh(input) {
      const period = futureRefreshPeriod(input.period);
      const rows = await client.query(`/* projection-store:fail-future-projection-refresh */
        UPDATE projection_period_refresh_states SET
          active_attempt_id = NULL,
          active_attempt_started_at = NULL,
          active_attempt_expires_at = NULL,
          consecutive_failures = consecutive_failures + 1,
          last_failure_code = $8,
          next_refresh_at = $7::timestamptz + CASE
            WHEN consecutive_failures = 0 THEN interval '5 minutes'
            WHEN consecutive_failures = 1 THEN interval '15 minutes'
            WHEN consecutive_failures = 2 THEN interval '1 hour'
            ELSE interval '6 hours'
          END,
          updated_at = now()
        WHERE projection_provider = $1 AND season = $2 AND season_type = $3
          AND week = $4 AND normalizer_version = $5
          AND active_attempt_id = $6::uuid
          AND active_attempt_started_at <= $7::timestamptz
          AND active_attempt_expires_at >= $7::timestamptz
        RETURNING consecutive_failures, next_refresh_at::text,
          0::integer AS materializations_woken`, [
        provider(input.projectionProvider),
        period.season,
        period.seasonType,
        period.week,
        requiredText(input.normalizerVersion, 'Projection normalizer version'),
        futureRefreshUuid(input.attemptId, 'Future projection attempt ID'),
        futureRefreshTimestamp(input.failedAt, 'Future projection failure time'),
        futureRefreshFailureCode(input.failureCode),
      ]);
      return futureRefreshTransition(rows);
    },
  };
}
