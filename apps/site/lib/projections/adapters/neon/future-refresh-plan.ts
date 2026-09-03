import 'server-only';

import type { DatabaseClient, DatabaseRow } from '../../../database';
import type {
  ProjectionStore,
  StoreFutureProjectionSlateLineage,
  StoreFutureRefreshPlanPeriod,
} from './contracts';
import { json, provider, requiredText, rowBoolean, rowNumber, rowText } from './database-values';
import {
  futureRefreshTargets,
  futureRefreshFailureCode,
  futureRefreshTexts,
  futureRefreshTimestamp,
  nullableRowText,
} from './future-refresh-values';

type FutureRefreshPlanMethods = Pick<
  ProjectionStore,
  'ensureFutureRefreshStates' | 'readFutureRefreshPlan'
>;

function lineage(
  row: DatabaseRow,
  observationKey: string,
  contentKey: string,
): StoreFutureProjectionSlateLineage | null {
  const observationId = nullableRowText(row, observationKey);
  const contentId = nullableRowText(row, contentKey);
  if (observationId === null && contentId === null) return null;
  if (observationId === null || contentId === null) {
    throw new Error('Database returned incomplete projection slate lineage.');
  }
  return { observationId, contentId };
}

function failureCode(row: DatabaseRow, key: string) {
  const value = nullableRowText(row, key);
  return value === null ? null : futureRefreshFailureCode(value);
}

export function createFutureRefreshPlanMethods(
  client: DatabaseClient,
): FutureRefreshPlanMethods {
  return {
    async ensureFutureRefreshStates(input) {
      const targets = futureRefreshTargets(input.targets);
      const leagueKeys = futureRefreshTexts(input.leagueKeys, 'League key');
      if (targets.length === 0 || leagueKeys.length === 0) {
        return {
          kind: 'stored',
          value: { projectionPeriodsInserted: 0, materializationsInserted: 0 },
        };
      }
      const rows = await client.query(`/* projection-store:ensure-future-refresh-states */
        WITH periods AS (
          SELECT * FROM jsonb_to_recordset($1::jsonb) AS value(
            season smallint, season_type text, week smallint,
            week_distance smallint
          )
        ), projection_rows AS (
          INSERT INTO projection_period_refresh_states (
            projection_provider, season, season_type, week,
            normalizer_version, week_distance, next_refresh_at
          )
          SELECT $2, season, season_type, week, $3, week_distance,
            $5::timestamptz + ((week_distance - 1) * interval '15 minutes')
          FROM periods
          ON CONFLICT DO NOTHING
          RETURNING projection_provider
        ), projection_rollovers AS (
          UPDATE projection_period_refresh_states refresh SET
            week_distance = period.week_distance,
            next_refresh_at = CASE
              WHEN period.week_distance < refresh.week_distance
              THEN LEAST(refresh.next_refresh_at, $5::timestamptz)
              ELSE refresh.next_refresh_at
            END,
            updated_at = now()
          FROM periods period
          WHERE refresh.projection_provider = $2
            AND refresh.season = period.season
            AND refresh.season_type = period.season_type
            AND refresh.week = period.week
            AND refresh.normalizer_version = $3
            AND refresh.week_distance IS DISTINCT FROM period.week_distance
          RETURNING refresh.projection_provider
        ), materialization_rows AS (
          INSERT INTO league_week_materialization_states (
            league_key, projection_provider, season, season_type, week,
            normalizer_version, model_version, week_distance, next_refresh_at
          )
          SELECT league.league_key, $2, period.season, period.season_type, period.week,
            $3, $4, period.week_distance,
            $5::timestamptz + ((period.week_distance - 1) * interval '15 minutes')
          FROM periods period
          CROSS JOIN unnest($6::text[]) AS league(league_key)
          ON CONFLICT DO NOTHING
          RETURNING league_key
        ), materialization_rollovers AS (
          UPDATE league_week_materialization_states materialization SET
            week_distance = period.week_distance,
            next_refresh_at = CASE
              WHEN period.week_distance < materialization.week_distance
              THEN LEAST(materialization.next_refresh_at, $5::timestamptz)
              ELSE materialization.next_refresh_at
            END,
            updated_at = now()
          FROM periods period
          CROSS JOIN unnest($6::text[]) AS league(league_key)
          WHERE materialization.league_key = league.league_key
            AND materialization.projection_provider = $2
            AND materialization.season = period.season
            AND materialization.season_type = period.season_type
            AND materialization.week = period.week
            AND materialization.normalizer_version = $3
            AND materialization.model_version = $4
            AND materialization.week_distance IS DISTINCT FROM period.week_distance
          RETURNING materialization.league_key
        )
        SELECT (SELECT count(*) FROM projection_rows)::integer AS projection_count,
          (SELECT count(*) FROM materialization_rows)::integer AS materialization_count`, [
        json(targets.map((value) => ({
          season: value.period.season,
          season_type: value.period.seasonType,
          week: value.period.week,
          week_distance: value.weekDistance,
        }))),
        provider(input.projectionProvider),
        requiredText(input.normalizerVersion, 'Projection normalizer version'),
        requiredText(input.modelVersion, 'Projection model version'),
        futureRefreshTimestamp(input.seededAt, 'Future refresh seed time'),
        leagueKeys,
      ]);
      const row = rows[0];
      if (!row) throw new Error('Future refresh state initialization returned no result.');
      return {
        kind: 'stored',
        value: {
          projectionPeriodsInserted: rowNumber(row, 'projection_count'),
          materializationsInserted: rowNumber(row, 'materialization_count'),
        },
      };
    },

    async readFutureRefreshPlan(input) {
      const targets = futureRefreshTargets(input.targets);
      const leagueKeys = futureRefreshTexts(input.leagueKeys, 'League key');
      if (targets.length === 0 || leagueKeys.length === 0) return [];
      const rows = await client.query(`/* projection-store:read-future-refresh-plan */
        WITH requested_periods AS (
          SELECT * FROM jsonb_to_recordset($1::jsonb) AS value(
            season smallint, season_type text, week smallint, week_distance smallint
          )
        ), requested_leagues AS (
          SELECT unnest($5::text[]) AS league_key
        )
        SELECT period.season, period.season_type, period.week, refresh.week_distance,
          refresh.next_refresh_at::text AS projection_next_refresh_at,
          refresh.last_attempted_at::text AS projection_last_attempted_at,
          refresh.last_succeeded_at::text AS projection_last_succeeded_at,
          refresh.consecutive_failures AS projection_consecutive_failures,
          refresh.last_failure_code AS projection_last_failure_code,
          refresh.active_attempt_expires_at::text AS projection_attempt_expires_at,
          refresh.last_projection_slate_observation_id::text AS projection_last_observation_id,
          refresh.last_projection_slate_content_id::text AS projection_last_content_id,
          (refresh.next_refresh_at <= $6::timestamptz
            AND (refresh.active_attempt_id IS NULL
              OR refresh.active_attempt_expires_at <= $6::timestamptz)) AS projection_due,
          current_observation.id::text AS current_observation_id,
          current_observation.projection_slate_content_id::text AS current_content_id,
          material.league_key,
          material.next_refresh_at::text AS materialization_next_refresh_at,
          material.last_attempted_at::text AS materialization_last_attempted_at,
          material.last_succeeded_at::text AS materialization_last_succeeded_at,
          material.last_source_revision,
          material.last_projection_slate_observation_id::text AS materialization_last_observation_id,
          material.last_projection_slate_content_id::text AS materialization_last_content_id,
          material.last_snapshot_revision,
          material.consecutive_failures AS materialization_consecutive_failures,
          material.last_failure_code AS materialization_last_failure_code,
          material.active_attempt_expires_at::text AS materialization_attempt_expires_at,
          (material.next_refresh_at <= $6::timestamptz
            AND (material.active_attempt_id IS NULL
              OR material.active_attempt_expires_at <= $6::timestamptz)) AS materialization_due
        FROM requested_periods period
        JOIN projection_period_refresh_states refresh
          ON refresh.projection_provider = $2
          AND refresh.season = period.season
          AND refresh.season_type = period.season_type
          AND refresh.week = period.week
          AND refresh.normalizer_version = $3
          AND refresh.week_distance = period.week_distance
        CROSS JOIN requested_leagues league
        JOIN league_week_materialization_states material
          ON material.league_key = league.league_key
          AND material.projection_provider = refresh.projection_provider
          AND material.season = refresh.season
          AND material.season_type = refresh.season_type
          AND material.week = refresh.week
          AND material.normalizer_version = refresh.normalizer_version
          AND material.model_version = $4
          AND material.week_distance = refresh.week_distance
        LEFT JOIN current_projection_slates current_slate
          ON current_slate.provider = refresh.projection_provider
          AND current_slate.season = refresh.season
          AND current_slate.season_type = refresh.season_type
          AND current_slate.week = refresh.week
          AND current_slate.normalizer_version = refresh.normalizer_version
        LEFT JOIN projection_slate_observations current_observation
          ON current_observation.id = current_slate.projection_slate_observation_id
          AND current_observation.projection_slate_content_id
            = current_slate.projection_slate_content_id
          AND current_observation.provider = current_slate.provider
          AND current_observation.season = current_slate.season
          AND current_observation.season_type = current_slate.season_type
          AND current_observation.week = current_slate.week
          AND current_observation.normalizer_version = current_slate.normalizer_version
          AND current_observation.quality = 'complete'
        ORDER BY period.week_distance, period.season, period.season_type,
          period.week, material.league_key`, [
        json(targets.map((value) => ({
          season: value.period.season,
          season_type: value.period.seasonType,
          week: value.period.week,
          week_distance: value.weekDistance,
        }))),
        provider(input.projectionProvider),
        requiredText(input.normalizerVersion, 'Projection normalizer version'),
        requiredText(input.modelVersion, 'Projection model version'),
        leagueKeys,
        futureRefreshTimestamp(input.asOf, 'Future refresh plan time'),
      ]);

      const grouped = new Map<string, StoreFutureRefreshPlanPeriod>();
      for (const row of rows) {
        const period = {
          season: rowNumber(row, 'season'),
          seasonType: rowText(row, 'season_type') as StoreFutureRefreshPlanPeriod['period']['seasonType'],
          week: rowNumber(row, 'week'),
        };
        const key = `${period.season}:${period.seasonType}:${period.week}`;
        const currentSlate = lineage(row, 'current_observation_id', 'current_content_id');
        const existing = grouped.get(key);
        const materialization = {
          leagueKey: rowText(row, 'league_key'),
          nextRefreshAt: rowText(row, 'materialization_next_refresh_at'),
          lastAttemptedAt: nullableRowText(row, 'materialization_last_attempted_at'),
          lastSucceededAt: nullableRowText(row, 'materialization_last_succeeded_at'),
          lastSourceRevision: nullableRowText(row, 'last_source_revision'),
          lastSlate: lineage(
            row,
            'materialization_last_observation_id',
            'materialization_last_content_id',
          ),
          lastSnapshotRevision: nullableRowText(row, 'last_snapshot_revision'),
          consecutiveFailures: rowNumber(row, 'materialization_consecutive_failures'),
          lastFailureCode: failureCode(row, 'materialization_last_failure_code'),
          activeAttemptExpiresAt: nullableRowText(row, 'materialization_attempt_expires_at'),
          due: rowBoolean(row, 'materialization_due'),
        };
        if (existing) {
          if (JSON.stringify(existing.projection.currentSlate) !== JSON.stringify(currentSlate)) {
            throw new Error('Database returned inconsistent current projection slate lineage.');
          }
          (existing.materializations as StoreFutureRefreshPlanPeriod['materializations'][number][])
            .push(materialization);
          continue;
        }
        grouped.set(key, {
          period,
          weekDistance: rowNumber(row, 'week_distance'),
          projection: {
            nextRefreshAt: rowText(row, 'projection_next_refresh_at'),
            lastAttemptedAt: nullableRowText(row, 'projection_last_attempted_at'),
            lastSucceededAt: nullableRowText(row, 'projection_last_succeeded_at'),
            consecutiveFailures: rowNumber(row, 'projection_consecutive_failures'),
            lastFailureCode: failureCode(row, 'projection_last_failure_code'),
            activeAttemptExpiresAt: nullableRowText(row, 'projection_attempt_expires_at'),
            lastSlate: lineage(row, 'projection_last_observation_id', 'projection_last_content_id'),
            currentSlate,
            due: rowBoolean(row, 'projection_due'),
          },
          materializations: [materialization],
          successfulMaterializations: 0,
          expectedMaterializations: leagueKeys.length,
        });
      }

      if (grouped.size !== targets.length
        || [...grouped.values()].some((value) => value.materializations.length !== leagueKeys.length)) {
        throw new Error('Future refresh state is incomplete for the requested periods and leagues.');
      }
      return [...grouped.values()].map((value) => ({
        ...value,
        successfulMaterializations: value.materializations.filter(
          (materialization) => materialization.lastSucceededAt !== null,
        ).length,
      }));
    },
  };
}
