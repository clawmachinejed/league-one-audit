import 'server-only';

import type { DatabaseClient } from '../../../database';
import type { LineupWatchMethods } from './lineup-watch-contracts';
import { normalizeIds, provider, requiredText, rowText, rowNumber } from './database-values';
import { lineupInteger, lineupUuid, lineupWatchFromRow, LINEUP_AUTHORITY_FRESH_SQL, LINEUP_WATCH_RETURNING_SQL } from './lineup-watch-values';

type ReadMethods = Pick<LineupWatchMethods, 'readLineupWatchSchedule' | 'readLineupWatchStates' | 'readPendingCurrentLineups' | 'readPendingFutureLineups' | 'wakeFutureProjectionAndMaterialization'>;

export function createLineupWatchReadMethods(client: DatabaseClient): ReadMethods {
  async function read(leagueKeys: readonly string[], lane: 'current' | 'future' | null) {
    const keys = normalizeIds(leagueKeys);
    if (!keys.length) return [];
    const rows = await client.query(`/* projection-store:read-lineup-watch-states */
      SELECT ${LINEUP_WATCH_RETURNING_SQL} FROM league_week_lineup_watch_states w
      JOIN league_period_authorities a ON a.league_key = w.league_key
      WHERE w.league_key = ANY($1::text[]) AND w.retired_at IS NULL
        AND a.authority_generation = w.authority_generation AND a.source_provider = w.source_provider
        AND a.source_external_league_id = w.external_league_id
        AND ${LINEUP_AUTHORITY_FRESH_SQL}
        AND ($2::text IS NULL OR (w.materialization_lane = $2 AND w.pending_since IS NOT NULL))
      ORDER BY w.pending_since NULLS LAST, w.season, w.season_type, w.week, w.league_key`, [keys, lane]);
    return rows.map(lineupWatchFromRow);
  }
  return {
    async readLineupWatchSchedule(leagueKeys) {
      const keys = normalizeIds(leagueKeys);
      if (!keys.length) return [];
      const rows = await client.query(`/* projection-store:read-lineup-watch-schedule */
        SELECT league_key, source_provider, external_league_id, season, season_type, week, watch_class, phase
        FROM league_week_lineup_watch_states
        WHERE league_key = ANY($1::text[]) AND retired_at IS NULL AND watch_class IN ('current', 'future')
        ORDER BY league_key, season, season_type, week`, [keys]);
      return rows.map((row) => {
        const seasonType = rowText(row, 'season_type');
        const watchClass = rowText(row, 'watch_class');
        const phase = lineupInteger(rowNumber(row, 'phase'), 0, 2, 'lineup phase') as 0 | 1 | 2;
        if (!['pre', 'reg', 'post'].includes(seasonType) || !['current', 'future'].includes(watchClass)) throw new Error('Invalid stored lineup schedule.');
        return { leagueKey: rowText(row, 'league_key'), sourceProvider: rowText(row, 'source_provider'),
          externalLeagueId: rowText(row, 'external_league_id'), phase, watchClass: watchClass as 'current' | 'future',
          period: { season: lineupInteger(rowNumber(row, 'season'), 1920, 2200, 'season'),
            seasonType: seasonType as 'pre' | 'reg' | 'post', week: lineupInteger(rowNumber(row, 'week'), 1, 18, 'week') } };
      });
    },
    readLineupWatchStates: (keys) => read(keys, null),
    readPendingCurrentLineups: (keys) => read(keys, 'current'),
    readPendingFutureLineups: (keys) => read(keys, 'future'),
    async wakeFutureProjectionAndMaterialization(input) {
      const rows = await client.query(`/* projection-store:wake-future-projection-and-materialization */
        WITH authority AS MATERIALIZED (
          SELECT a.* FROM league_period_authorities a JOIN league_week_lineup_watch_states source ON source.league_key = a.league_key
          WHERE source.id = $1::uuid FOR UPDATE OF a
        ), target AS MATERIALIZED (
          SELECT w.* FROM league_week_lineup_watch_states w JOIN authority a ON a.league_key = w.league_key
          WHERE w.id = $1::uuid AND w.watch_generation = $2::bigint AND w.authority_generation = $3::bigint
            AND a.authority_generation = w.authority_generation AND a.source_provider = w.source_provider
            AND a.source_external_league_id = w.external_league_id
            AND ${LINEUP_AUTHORITY_FRESH_SQL}
            AND w.materialization_lane = 'future' AND w.retired_at IS NULL AND w.pending_since IS NOT NULL
          FOR UPDATE OF w
        ), projection AS (
          INSERT INTO projection_period_refresh_states AS p (
            projection_provider, season, season_type, week, normalizer_version, week_distance, next_refresh_at)
          SELECT $4, t.season, t.season_type, t.week, $5, $7::integer, now() FROM target t
          WHERE $8::boolean AND (projection_woken_version < observed_version OR NOT EXISTS (
            SELECT 1 FROM projection_period_refresh_states existing WHERE existing.projection_provider = $4
              AND (existing.season, existing.season_type, existing.week) = (t.season, t.season_type, t.week) AND existing.normalizer_version = $5))
          ON CONFLICT (projection_provider, season, season_type, week, normalizer_version) DO UPDATE SET
            next_refresh_at = LEAST(p.next_refresh_at, EXCLUDED.next_refresh_at), updated_at = now()
          WHERE EXISTS (SELECT 1 FROM target WHERE projection_woken_version < observed_version)
          RETURNING week
        ), materialization AS (
          INSERT INTO league_week_materialization_states AS m (
            league_key, projection_provider, season, season_type, week, normalizer_version, model_version, week_distance, next_refresh_at)
          SELECT t.league_key, $4, t.season, t.season_type, t.week, $5, $6, $7::integer, now() FROM target t
          WHERE materialization_woken_version < observed_version OR NOT EXISTS (
            SELECT 1 FROM league_week_materialization_states existing WHERE existing.league_key = t.league_key
              AND existing.projection_provider = $4 AND (existing.season, existing.season_type, existing.week) = (t.season, t.season_type, t.week)
              AND existing.normalizer_version = $5 AND existing.model_version = $6)
          ON CONFLICT (league_key, projection_provider, season, season_type, week, normalizer_version, model_version) DO UPDATE SET
            next_refresh_at = LEAST(m.next_refresh_at, EXCLUDED.next_refresh_at), updated_at = now()
          WHERE EXISTS (SELECT 1 FROM target WHERE materialization_woken_version < observed_version)
          RETURNING week
        ) UPDATE league_week_lineup_watch_states w SET
          materialization_woken_version = w.observed_version,
          projection_woken_version = CASE WHEN $8::boolean THEN w.observed_version ELSE w.projection_woken_version END,
          updated_at = now()
        FROM target t WHERE w.id = t.id AND (SELECT count(*) FROM projection) >= 0 AND (SELECT count(*) FROM materialization) >= 0
        RETURNING w.id`, [lineupUuid(input.watchId), lineupInteger(input.watchGeneration, 1, Number.MAX_SAFE_INTEGER, 'watch generation'),
        lineupInteger(input.authorityGeneration, 1, Number.MAX_SAFE_INTEGER, 'authority generation'), provider(input.projectionProvider),
        requiredText(input.normalizerVersion, 'Normalizer version'), requiredText(input.modelVersion, 'Model version'),
        lineupInteger(input.weekDistance, 1, 18, 'week distance'), input.wakeProjection]);
      return { kind: rows.length ? 'stored' : 'stale' };
    },
  };
}
