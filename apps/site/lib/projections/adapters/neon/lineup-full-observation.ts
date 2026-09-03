import 'server-only';

import type { DatabaseClient } from '../../../database';
import type { LineupWatchMethods } from './lineup-watch-contracts';
import { json, requiredText } from './database-values';
import { publicationFenceJson } from './lineup-publication-values';
import { lineupInteger, lineupWatchFromRow, LINEUP_AUTHORITY_FRESH_SQL, LINEUP_WATCH_RETURNING_SQL } from './lineup-watch-values';

/** Reserve before network work; a full load supersedes any older thin claim. */
export function createFullLineupObservationMethods(client: DatabaseClient): Pick<LineupWatchMethods, 'reserveFullLineupObservation'> {
  return {
    async reserveFullLineupObservation(input) {
      const fence = JSON.parse(publicationFenceJson(input.fence)!);
      const rows = await client.query(`/* projection-store:reserve-full-lineup-observation */
        WITH context AS (SELECT $1::jsonb AS value), authority AS MATERIALIZED (
          SELECT a.* FROM league_period_authorities a
          JOIN league_week_lineup_watch_states source ON source.league_key = a.league_key
          CROSS JOIN context WHERE source.id = (value->>'watchId')::uuid FOR UPDATE OF a
        ), watch AS MATERIALIZED (
          SELECT w.* FROM league_week_lineup_watch_states w JOIN authority a ON a.league_key = w.league_key
          CROSS JOIN context WHERE w.id = (value->>'watchId')::uuid
            AND w.watch_generation = (value->>'watchGeneration')::bigint
            AND w.authority_generation = (value->>'authorityGeneration')::bigint
            AND w.authority_generation = a.authority_generation
            AND w.source_provider = a.source_provider AND w.external_league_id = a.source_external_league_id
            AND ${LINEUP_AUTHORITY_FRESH_SQL} AND w.retired_at IS NULL
            AND w.materialization_lane = value->>'ownerLane'
            AND w.season = a.default_season AND w.season_type = a.default_season_type
            AND ((w.materialization_lane = 'current' AND a.league_lifecycle = 'active' AND w.week = a.active_week)
              OR (w.materialization_lane = 'future' AND
                ((a.league_lifecycle = 'preseason' AND w.week >= a.default_week)
                  OR (a.league_lifecycle = 'active' AND w.week > a.active_week))))
          FOR UPDATE OF w
        ), execution AS MATERIALIZED (
          SELECT j.* FROM projection_jobs j CROSS JOIN watch w CROSS JOIN context
          WHERE j.job_key = CASE w.materialization_lane WHEN 'current' THEN 'live-projection-sync' ELSE 'future-projection-sync' END
            AND j.state = 'running' AND j.lease_owner = value->>'runId' AND j.lease_until > now()
          FOR SHARE OF j
        ), materialization AS MATERIALIZED (
          SELECT m.* FROM league_week_materialization_states m CROSS JOIN watch w CROSS JOIN context
          WHERE w.materialization_lane = 'future' AND m.league_key = w.league_key
            AND (m.season, m.season_type, m.week) = (w.season, w.season_type, w.week)
            AND m.projection_provider = value->>'projectionProvider'
            AND m.normalizer_version = value->>'normalizerVersion' AND m.model_version = value->>'modelVersion'
            AND m.active_attempt_id = (value->>'materializationAttemptId')::uuid
            AND m.active_watch_id = w.id AND m.active_watch_generation = w.watch_generation
            AND m.active_authority_generation = w.authority_generation AND m.active_attempt_expires_at > now()
          FOR UPDATE OF m
        ) UPDATE league_week_lineup_watch_states w SET
          active_attempt_id = gen_random_uuid(), claim_generation = w.claim_generation + 1,
          lease_owner = value->>'runId', attempt_started_at = now(),
          lease_expires_at = LEAST(now() + (value->>'leaseSeconds')::integer * interval '1 second',
            execution.lease_until, (SELECT active_attempt_expires_at FROM materialization)),
          attempt_count = w.attempt_count + 1, updated_at = now()
        FROM watch, execution, context WHERE w.id = watch.id
          AND (watch.materialization_lane = 'current' OR EXISTS (SELECT 1 FROM materialization))
        RETURNING ${LINEUP_WATCH_RETURNING_SQL}`, [json({
        ...fence, modelVersion: requiredText(input.modelVersion, 'Projection model version'),
        leaseSeconds: lineupInteger(input.leaseSeconds, 1, 120, 'full observation lease'),
      })]);
      return rows[0] ? { kind: 'stored', state: lineupWatchFromRow(rows[0]) } : { kind: 'stale' };
    },
  };
}
