import 'server-only';

import type { DatabaseClient } from '../../../database';
import type { LineupWatchMethods } from './lineup-watch-contracts';
import { normalizeIds, requiredText } from './database-values';
import { lineupInteger, lineupWatchFromRow, LINEUP_AUTHORITY_FRESH_SQL, LINEUP_WATCH_RETURNING_SQL } from './lineup-watch-values';

export function createLineupWatchClaimMethods(client: DatabaseClient): Pick<LineupWatchMethods, 'claimDueLineupObservations'> {
  return {
    async claimDueLineupObservations(input) {
      const leagueKeys = normalizeIds(input.leagueKeys);
      if (!leagueKeys.length) return [];
      if (!['current', 'future'].includes(input.materializationLane)) throw new Error('Invalid materialization lane.');
      const rows = await client.query(`/* projection-store:claim-due-lineup-observations */
        WITH authorities AS MATERIALIZED (
          SELECT a.* FROM league_period_authorities a WHERE a.league_key = ANY($1::text[])
            AND ${LINEUP_AUTHORITY_FRESH_SQL}
          ORDER BY a.league_key FOR UPDATE OF a
        ), ranked AS MATERIALIZED (
          SELECT w.id, w.watch_class, w.next_check_at, w.league_key, w.season, w.season_type, w.week,
            row_number() OVER (PARTITION BY w.watch_class ORDER BY w.next_check_at, w.league_key, w.season, w.season_type, w.week) AS class_rank
          FROM league_week_lineup_watch_states w JOIN authorities a ON a.league_key = w.league_key
          WHERE w.retired_at IS NULL AND w.materialization_lane = $2
            AND w.authority_generation = a.authority_generation AND w.source_provider = a.source_provider
            AND w.external_league_id = a.source_external_league_id
            AND w.next_check_at <= now() AND (w.active_attempt_id IS NULL OR w.lease_expires_at <= now())
            AND (w.watch_class = 'current' OR w.phase = mod(floor(extract(epoch FROM now()) / 60)::bigint, 3)
              OR ($7::boolean AND w.next_check_at < date_trunc('minute', now()) - interval '2 minutes'))
        ), selected AS MATERIALIZED (
          SELECT w.id FROM league_week_lineup_watch_states w JOIN ranked r ON r.id = w.id
          WHERE (r.watch_class = 'current' OR r.class_rank <= $6::integer)
            AND w.retired_at IS NULL AND w.materialization_lane = $2 AND w.next_check_at <= now()
            AND (w.active_attempt_id IS NULL OR w.lease_expires_at <= now())
            AND (w.watch_class = 'current' OR w.phase = mod(floor(extract(epoch FROM now()) / 60)::bigint, 3)
              OR ($7::boolean AND w.next_check_at < date_trunc('minute', now()) - interval '2 minutes'))
          ORDER BY CASE WHEN r.watch_class = 'current' THEN 0 ELSE 1 END,
            r.next_check_at, r.league_key, r.season, r.season_type, r.week
          LIMIT $5::integer FOR UPDATE OF w SKIP LOCKED
        ) UPDATE league_week_lineup_watch_states w SET
          active_attempt_id = gen_random_uuid(), claim_generation = w.claim_generation + 1,
          lease_owner = $3, attempt_started_at = now(), lease_expires_at = now() + $4::integer * interval '1 second',
          attempt_count = w.attempt_count + 1, updated_at = now()
        FROM selected s WHERE w.id = s.id AND w.retired_at IS NULL AND w.materialization_lane = $2
          AND w.next_check_at <= now() AND (w.active_attempt_id IS NULL OR w.lease_expires_at <= now())
        RETURNING ${LINEUP_WATCH_RETURNING_SQL}`, [
        leagueKeys, input.materializationLane, requiredText(input.workerId, 'Worker ID'),
        lineupInteger(input.leaseSeconds, 1, 3600, 'lease seconds'),
        lineupInteger(input.limit, 1, 20, 'batch limit'), lineupInteger(input.futureLimit, 0, 18, 'future batch limit'), input.catchUp,
      ]);
      return rows.map(lineupWatchFromRow);
    },
  };
}
