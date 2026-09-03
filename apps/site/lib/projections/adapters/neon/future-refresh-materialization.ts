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
        WITH expired AS (
          UPDATE league_week_materialization_states SET
            active_attempt_id = NULL,
            active_attempt_started_at = NULL,
            active_attempt_expires_at = NULL,
            consecutive_failures = consecutive_failures + 1,
            last_failure_code = 'deadline-exceeded',
            next_refresh_at = $9::timestamptz + CASE
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
            AND active_attempt_expires_at <= $9::timestamptz
          RETURNING consecutive_failures, next_refresh_at
        ), claimed AS (
          UPDATE league_week_materialization_states SET
            attempt_count = attempt_count + 1,
            active_attempt_id = $8::uuid,
            active_attempt_started_at = $9::timestamptz,
            active_attempt_expires_at = $9::timestamptz + ($10::integer * interval '1 second'),
            last_attempted_at = $9::timestamptz,
            updated_at = now()
          WHERE league_key = $1 AND projection_provider = $2
            AND season = $3 AND season_type = $4 AND week = $5
            AND normalizer_version = $6 AND model_version = $7
            AND NOT EXISTS (SELECT 1 FROM expired)
            AND next_refresh_at <= $9::timestamptz
            AND active_attempt_id IS NULL
            AND (last_attempted_at IS NULL OR last_attempted_at <= $9::timestamptz)
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
          SELECT observation.id
          FROM league_week_observations observation
          JOIN league_seasons season ON season.id = observation.league_season_id
          JOIN leagues league ON league.id = season.league_id
          WHERE league.league_key = $1 AND season.season = $3
            AND observation.week = $5 AND observation.source_revision = $11
            AND observation.quality = 'complete'
          LIMIT 1
        ), valid_snapshot AS (
          SELECT snapshot.id
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
          LIMIT 1
        )
        UPDATE league_week_materialization_states materialization SET
          active_attempt_id = NULL,
          active_attempt_started_at = NULL,
          active_attempt_expires_at = NULL,
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
        FROM valid_slate slate, valid_league_source, valid_snapshot
        WHERE materialization.league_key = $1
          AND materialization.projection_provider = $2
          AND materialization.season = $3 AND materialization.season_type = $4
          AND materialization.week = $5 AND materialization.normalizer_version = $6
          AND materialization.model_version = $7
          AND materialization.active_attempt_id = $8::uuid
          AND materialization.active_attempt_started_at <= $9::timestamptz
          AND materialization.active_attempt_expires_at >= $9::timestamptz
          AND (materialization.last_succeeded_at IS NULL
            OR materialization.last_succeeded_at <= $9::timestamptz)
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
        UPDATE league_week_materialization_states SET
          active_attempt_id = NULL,
          active_attempt_started_at = NULL,
          active_attempt_expires_at = NULL,
          consecutive_failures = consecutive_failures + 1,
          last_failure_code = $10,
          next_refresh_at = $9::timestamptz + CASE
            WHEN consecutive_failures = 0 THEN interval '5 minutes'
            WHEN consecutive_failures = 1 THEN interval '15 minutes'
            WHEN consecutive_failures = 2 THEN interval '1 hour'
            ELSE interval '6 hours'
          END,
          updated_at = now()
        WHERE league_key = $1 AND projection_provider = $2
          AND season = $3 AND season_type = $4 AND week = $5
          AND normalizer_version = $6 AND model_version = $7
          AND active_attempt_id = $8::uuid
          AND active_attempt_started_at <= $9::timestamptz
          AND active_attempt_expires_at >= $9::timestamptz
        RETURNING consecutive_failures, next_refresh_at::text,
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
