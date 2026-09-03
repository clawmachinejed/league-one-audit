import 'server-only';

import type { DatabaseClient } from '../../../database';
import type { LineupWatchMethods } from './lineup-watch-contracts';
import { json, normalizeIds } from './database-values';
import { lineupTargetRow, lineupWatchFromRow, LINEUP_AUTHORITY_FRESH_SQL, LINEUP_WATCH_RETURNING_SQL } from './lineup-watch-values';

export function createLineupWatchSyncMethods(client: DatabaseClient): Pick<LineupWatchMethods, 'synchronizeLineupWatchStates'> {
  return {
    async synchronizeLineupWatchStates(input) {
      const leagueKeys = normalizeIds(input.registeredLeagueKeys);
      if (leagueKeys.length !== input.registeredLeagueKeys.length) throw new Error('Registry league keys must be unique and nonblank.');
      const targets = input.targets.map(lineupTargetRow);
      const keys = targets.map((target) => json([target.league_key, target.season, target.season_type, target.week]));
      if (new Set(keys).size !== keys.length || targets.some((target) => !leagueKeys.includes(String(target.league_key)))) throw new Error('Invalid lineup target set.');
      const rows = await client.query(`/* projection-store:synchronize-lineup-watch-states */
        WITH sync_lock AS MATERIALIZED (
          SELECT pg_advisory_xact_lock(hashtextextended('lineup-watch-synchronization', 0))
        ), incoming AS MATERIALIZED (
          SELECT i.* FROM sync_lock, jsonb_to_recordset($2::jsonb) AS i(
            league_key text, source_provider text, external_league_id text, season smallint,
            season_type text, week smallint, lineup_revision_version text, cadence_policy_version text,
            authority_generation bigint, watch_class text, materialization_lane text, phase smallint,
            expected_roster_count integer, expected_starter_slot_count integer, expected_roster_ids text[], next_check_at timestamptz)
        ), authorities AS MATERIALIZED (
          SELECT a.* FROM league_period_authorities a, sync_lock
          WHERE a.league_key = ANY($1::text[]) ORDER BY a.league_key FOR UPDATE OF a
        ), eligible AS MATERIALIZED (
          SELECT i.* FROM incoming i JOIN authorities a ON a.league_key = i.league_key
          WHERE a.authority_generation = i.authority_generation
            AND a.source_provider = i.source_provider AND a.source_external_league_id = i.external_league_id
            AND a.expected_roster_count = i.expected_roster_count AND a.expected_starter_slot_count = i.expected_starter_slot_count
            AND a.expected_roster_ids @> i.expected_roster_ids AND a.expected_roster_ids <@ i.expected_roster_ids
            AND ${LINEUP_AUTHORITY_FRESH_SQL}
        ), retire_targets AS MATERIALIZED (
          SELECT w.id, CASE
            WHEN NOT (w.league_key = ANY($1::text[])) THEN 'league-removed'
            WHEN e.watch_class = 'completed' THEN 'completed'
            WHEN e.league_key IS NOT NULL AND (e.source_provider IS DISTINCT FROM w.source_provider OR e.external_league_id IS DISTINCT FROM w.external_league_id) THEN 'source-replaced'
            WHEN e.league_key IS NOT NULL AND e.lineup_revision_version IS DISTINCT FROM w.lineup_revision_version THEN 'revision-version-replaced'
            WHEN NOT EXISTS (SELECT 1 FROM eligible s WHERE s.league_key = w.league_key AND s.season = w.season AND s.season_type = w.season_type) THEN 'season-replaced'
            ELSE 'out-of-horizon' END AS reason
          FROM league_week_lineup_watch_states w
          LEFT JOIN eligible e ON (e.league_key, e.season, e.season_type, e.week) = (w.league_key, w.season, w.season_type, w.week)
          WHERE w.retired_at IS NULL AND (
            NOT (w.league_key = ANY($1::text[])) OR (
              EXISTS (SELECT 1 FROM eligible h WHERE h.league_key = w.league_key) AND (
                e.league_key IS NULL OR e.watch_class = 'completed'
                OR (e.source_provider, e.external_league_id, e.lineup_revision_version)
                  IS DISTINCT FROM (w.source_provider, w.external_league_id, w.lineup_revision_version))))
        ), retired AS (
          UPDATE league_week_lineup_watch_states w SET retired_at = now(), retirement_reason = r.reason,
            next_check_at = NULL, materialization_lane = NULL, pending_since = NULL,
            active_attempt_id = NULL, lease_owner = NULL, attempt_started_at = NULL, lease_expires_at = NULL,
            watch_class = CASE WHEN r.reason = 'completed' THEN 'completed' ELSE w.watch_class END,
            watch_generation = w.watch_generation + 1, updated_at = now()
          FROM retire_targets r WHERE w.id = r.id AND w.retired_at IS NULL RETURNING w.id, w.watch_generation
        ), upserted AS (
          INSERT INTO league_week_lineup_watch_states AS w (
            league_key, source_provider, external_league_id, season, season_type, week,
            lineup_revision_version, cadence_policy_version, authority_generation, watch_class,
            materialization_lane, phase, expected_roster_count, expected_starter_slot_count, expected_roster_ids, next_check_at)
          SELECT e.league_key, e.source_provider, e.external_league_id, e.season, e.season_type, e.week,
            e.lineup_revision_version, e.cadence_policy_version, e.authority_generation, e.watch_class,
            e.materialization_lane, e.phase, e.expected_roster_count, e.expected_starter_slot_count, e.expected_roster_ids, e.next_check_at
          FROM eligible e WHERE e.watch_class <> 'completed' AND (SELECT count(*) FROM retired) >= 0
          ON CONFLICT (league_key, season, season_type, week) WHERE retired_at IS NULL DO UPDATE SET
            cadence_policy_version = EXCLUDED.cadence_policy_version,
            authority_generation = EXCLUDED.authority_generation,
            watch_class = EXCLUDED.watch_class, materialization_lane = EXCLUDED.materialization_lane,
            phase = EXCLUDED.phase, expected_roster_count = EXCLUDED.expected_roster_count,
            expected_starter_slot_count = EXCLUDED.expected_starter_slot_count, expected_roster_ids = EXCLUDED.expected_roster_ids,
            watch_generation = w.watch_generation + CASE WHEN (w.authority_generation, w.watch_class, w.materialization_lane)
              IS DISTINCT FROM (EXCLUDED.authority_generation, EXCLUDED.watch_class, EXCLUDED.materialization_lane) THEN 1 ELSE 0 END,
            next_check_at = CASE WHEN (w.watch_class, w.materialization_lane)
              IS DISTINCT FROM (EXCLUDED.watch_class, EXCLUDED.materialization_lane) THEN LEAST(w.next_check_at, EXCLUDED.next_check_at) ELSE w.next_check_at END,
            active_attempt_id = CASE WHEN w.authority_generation = EXCLUDED.authority_generation AND w.watch_class = EXCLUDED.watch_class AND w.materialization_lane = EXCLUDED.materialization_lane THEN w.active_attempt_id END,
            lease_owner = CASE WHEN w.authority_generation = EXCLUDED.authority_generation AND w.watch_class = EXCLUDED.watch_class AND w.materialization_lane = EXCLUDED.materialization_lane THEN w.lease_owner END,
            attempt_started_at = CASE WHEN w.authority_generation = EXCLUDED.authority_generation AND w.watch_class = EXCLUDED.watch_class AND w.materialization_lane = EXCLUDED.materialization_lane THEN w.attempt_started_at END,
            lease_expires_at = CASE WHEN w.authority_generation = EXCLUDED.authority_generation AND w.watch_class = EXCLUDED.watch_class AND w.materialization_lane = EXCLUDED.materialization_lane THEN w.lease_expires_at END,
            updated_at = now()
          RETURNING ${LINEUP_WATCH_RETURNING_SQL}
        ), invalidated AS (
          UPDATE league_week_materialization_states m SET active_attempt_id = NULL,
            active_attempt_started_at = NULL, active_attempt_expires_at = NULL,
            active_watch_id = NULL, active_watch_generation = NULL, active_authority_generation = NULL,
            active_target_observed_version = NULL, active_target_lineup_revision = NULL,
            next_refresh_at = LEAST(m.next_refresh_at, now()), updated_at = now()
          WHERE m.active_watch_id IN (SELECT id FROM retired)
            OR EXISTS (SELECT 1 FROM upserted u WHERE m.active_watch_id = u.id::uuid
              AND (m.active_watch_generation <> u.watch_generation OR m.active_authority_generation <> u.authority_generation))
          RETURNING m.league_key
        ) SELECT * FROM upserted ORDER BY league_key, season, season_type, week`, [leagueKeys, json(targets)]);
      return { kind: 'stored', states: rows.map(lineupWatchFromRow) };
    },
  };
}
