import 'server-only';

import type { DatabaseClient } from '../../../database';
import { isMatchupsData } from '../../../matchups-response';
import type { ProjectionStore } from './contracts';
import { json, normalizeIds, requiredText, rowNumber, rowText } from './database-values';
import { publicationFenceJson } from './lineup-publication-values';
import { LINEUP_PUBLICATION_CTES } from './lineup-publication-sql';
import {
  canonicalActivityWindows,
  containsScheduledGame,
  snapshotContentHash,
  snapshotFromRow,
} from './snapshot-codec';

type SnapshotMethods = Pick<ProjectionStore,
  | 'publishSnapshot'
  | 'readCurrentSnapshot'
  | 'readSnapshotSelectionBySleeperLeagueId'
>;

export function createSnapshotMethods(client: DatabaseClient): SnapshotMethods {
  return {
    async publishSnapshot(input) {
      if (!isMatchupsData(input.payload)) {
        throw new Error('Only complete matchup data can be published.');
      }
      const payloadSeason = Number(input.payload.league.season);
      if (!Number.isInteger(payloadSeason)
        || input.payload.week !== input.week
        || input.payload.league.week !== input.week) {
        return { kind: 'rejected', reason: 'payload-context-mismatch' };
      }
      const sourceIds = normalizeIds(input.gameStateObservationIds);
      const activityWindows = canonicalActivityWindows(input.activityWindows);
      if (containsScheduledGame(input.payload)
        && (sourceIds.length === 0 || activityWindows.length === 0)) {
        return { kind: 'rejected', reason: 'incomplete-or-mismatched-sources' };
      }
      const maxSourceSkewSeconds = input.maxSourceSkewSeconds ?? 90;
      if (!Number.isInteger(maxSourceSkewSeconds)
        || maxSourceSkewSeconds < 1 || maxSourceSkewSeconds > 600) {
        throw new Error('Source-time skew must be between 1 and 600 whole seconds.');
      }
      const contentHash = snapshotContentHash(input.payload, activityWindows);
      const rows = await client.query(`/* projection-store:publish-snapshot */
        WITH league_source AS (
          SELECT observation.id, observation.observed_at, observation.request_completed_at,
            observation.expected_game_count, observation.source_data, season.season,
            league.league_key, connection.provider AS source_provider,
            connection.external_league_id, observation.lineup_revision_version,
            observation.lineup_revision
          FROM league_week_observations observation
          JOIN league_seasons season ON season.id = observation.league_season_id
          JOIN leagues league ON league.id = season.league_id
          JOIN league_source_connections connection ON connection.league_season_id = season.id
            AND connection.provider = observation.provider
          WHERE observation.id = $1 AND observation.league_season_id = $2
            AND observation.provider = 'sleeper'
            AND observation.week = $3 AND observation.quality = 'complete'
            AND season.season = $11
            AND (
              observation.expected_game_count > 0
              OR NOT jsonb_path_exists(
                $8::jsonb,
                '$.** ? (@.kind == "scheduled")'::jsonpath
              )
            )
        ), ${LINEUP_PUBLICATION_CTES}, expected_games AS (
          SELECT expected.nfl_game_id
          FROM league_week_expected_games expected
          JOIN league_source ON league_source.id = expected.league_week_observation_id
        ), requested_game_sources AS (
          SELECT unnest($4::uuid[]) AS id
        ), game_sources AS (
          SELECT observation.id, observation.nfl_game_id, observation.observed_at,
            observation.request_completed_at
          FROM requested_game_sources requested
          JOIN game_state_observations observation ON observation.id = requested.id
          JOIN nfl_games game ON game.id = observation.nfl_game_id
          CROSS JOIN league_source
          WHERE observation.provider = 'tank01'
            AND game.season = league_source.season
            AND game.season_type = 'reg'
            AND game.week = $3
        ), source_validation AS (
          SELECT
            EXISTS (SELECT 1 FROM league_source) AS league_ok,
            (SELECT count(*) FROM expected_games)
              = COALESCE((SELECT expected_game_count FROM league_source), -1) AS expected_set_registered,
            (SELECT count(*) FROM requested_game_sources)
              = (SELECT count(*) FROM game_sources) AS every_source_valid,
            (SELECT count(*) FROM game_sources)
              = (SELECT count(*) FROM expected_games) AS complete_count,
            (SELECT count(DISTINCT nfl_game_id) FROM game_sources)
              = (SELECT count(*) FROM expected_games) AS one_source_per_game,
            NOT EXISTS (
              SELECT nfl_game_id FROM expected_games
              EXCEPT SELECT nfl_game_id FROM game_sources
            ) AND NOT EXISTS (
              SELECT nfl_game_id FROM game_sources
              EXCEPT SELECT nfl_game_id FROM expected_games
            ) AS exact_game_set,
            CASE
              WHEN (SELECT count(*) FROM expected_games) = 0 THEN true
              ELSE EXTRACT(EPOCH FROM (
                GREATEST(
                  (SELECT max(request_completed_at) FROM game_sources),
                  (SELECT request_completed_at FROM league_source)
                ) - LEAST(
                  (SELECT min(request_completed_at) FROM game_sources),
                  (SELECT request_completed_at FROM league_source)
                )
              )) <= $10
            END AS source_times_aligned,
            ABS(EXTRACT(EPOCH FROM (
              (SELECT request_completed_at FROM league_source) - $7::timestamptz
            ))) <= $10
              AND NOT EXISTS (
                SELECT 1 FROM game_sources
                WHERE ABS(EXTRACT(EPOCH FROM (
                  game_sources.request_completed_at - $7::timestamptz
                ))) > $10
              ) AS calculation_time_aligned,
            GREATEST(
              (SELECT request_completed_at FROM league_source),
              COALESCE(
                (SELECT max(request_completed_at) FROM game_sources),
                (SELECT request_completed_at FROM league_source)
              )
            ) AS source_verified_at
        ), validated AS (
          SELECT source_verified_at FROM source_validation
          WHERE league_ok AND expected_set_registered AND every_source_valid
            AND complete_count AND one_source_per_game AND exact_game_set
            AND source_times_aligned AND calculation_time_aligned
            AND EXISTS (SELECT 1 FROM publication_lineup_guard)
        ), existing_revision AS (
          SELECT snapshot.* FROM projection_snapshots snapshot
          WHERE snapshot.league_season_id = $2 AND snapshot.week = $3
            AND snapshot.model_version = $5 AND snapshot.revision_key = $6
        ), exact_existing_revision AS (
          SELECT existing_revision.*, validated.source_verified_at,
            'unchanged'::text AS result_kind
          FROM existing_revision
          JOIN current_projection_snapshots current
            ON current.league_season_id = existing_revision.league_season_id
            AND current.week = existing_revision.week
            AND current.snapshot_id = existing_revision.id
          CROSS JOIN validated
          WHERE existing_revision.league_week_observation_id = $1
            AND existing_revision.calculated_at = $7::timestamptz
            AND existing_revision.content_hash = $9
            AND existing_revision.payload = $8::jsonb
            AND existing_revision.activity_windows = $12::jsonb
            AND existing_revision.game_state_observation_ids = $4::uuid[]
        ), unchanged_current AS (
          SELECT snapshot.*, validated.source_verified_at,
            'unchanged'::text AS result_kind
          FROM current_projection_snapshots current
          JOIN projection_snapshots snapshot ON snapshot.id = current.snapshot_id
          CROSS JOIN validated
          WHERE current.league_season_id = $2 AND current.week = $3
            AND snapshot.model_version = $5 AND snapshot.content_hash = $9
            AND snapshot.activity_windows = $12::jsonb
            AND NOT EXISTS (SELECT 1 FROM existing_revision)
        ), inserted AS (
          INSERT INTO projection_snapshots (
            league_season_id, week, model_version, revision_key, content_hash,
            league_week_observation_id, game_state_observation_ids,
            calculated_at, quality, payload, activity_windows
          )
          SELECT $2, $3, $5, $6, $9, $1, $4::uuid[], $7, 'complete',
            $8::jsonb, $12::jsonb
          FROM validated
          WHERE NOT EXISTS (SELECT 1 FROM existing_revision)
            AND NOT EXISTS (SELECT 1 FROM unchanged_current)
            AND NOT EXISTS (
              SELECT 1 FROM current_projection_snapshots current
              WHERE current.league_season_id = $2 AND current.week = $3
                AND current.calculated_at > $7::timestamptz
            )
          ON CONFLICT (league_season_id, week, model_version, revision_key) DO NOTHING
          RETURNING *
        ), selected AS (
          SELECT inserted.*, validated.source_verified_at, 'published'::text AS result_kind
          FROM inserted CROSS JOIN validated
          UNION ALL
          SELECT * FROM exact_existing_revision
          UNION ALL
          SELECT * FROM unchanged_current
          LIMIT 1
        ), published AS (
          INSERT INTO current_projection_snapshots (
            league_season_id, week, snapshot_id, calculated_at, published_at, verified_at,
            verification_source_observation_id
          )
          SELECT $2, $3, selected.id, selected.calculated_at, now(),
            selected.source_verified_at, $1
          FROM selected
          WHERE selected.result_kind = 'published'
          ON CONFLICT (league_season_id, week) DO UPDATE SET
            snapshot_id = EXCLUDED.snapshot_id,
            calculated_at = EXCLUDED.calculated_at,
            published_at = EXCLUDED.published_at,
            verification_source_observation_id = CASE
              WHEN EXCLUDED.snapshot_id IS DISTINCT FROM current_projection_snapshots.snapshot_id
                OR EXCLUDED.verified_at >= current_projection_snapshots.verified_at
                THEN EXCLUDED.verification_source_observation_id
              ELSE current_projection_snapshots.verification_source_observation_id END,
            verified_at = CASE
              WHEN EXCLUDED.snapshot_id IS DISTINCT FROM current_projection_snapshots.snapshot_id
                THEN EXCLUDED.verified_at
              ELSE GREATEST(current_projection_snapshots.verified_at, EXCLUDED.verified_at) END
          WHERE EXCLUDED.calculated_at >= current_projection_snapshots.calculated_at
          RETURNING snapshot_id, published_at, verified_at
        ), verified AS (
          UPDATE current_projection_snapshots current
          SET verified_at = GREATEST(current.verified_at, selected.source_verified_at),
            verification_source_observation_id = CASE
              WHEN selected.source_verified_at >= current.verified_at THEN $1::uuid
              ELSE current.verification_source_observation_id END
          FROM selected
          WHERE selected.result_kind = 'unchanged'
            AND current.league_season_id = selected.league_season_id
            AND current.week = selected.week
            AND current.snapshot_id = selected.id
          RETURNING current.snapshot_id, current.verified_at
        )
        SELECT selected.id AS snapshot_id,
          selected.league_season_id, selected.week, selected.model_version,
          selected.revision_key, selected.calculated_at::text,
          selected.payload, selected.activity_windows,
          COALESCE(published.published_at, current.published_at)::text AS published_at,
          COALESCE(published.verified_at, verified.verified_at, current.verified_at)::text
            AS verified_at,
          COALESCE(published.snapshot_id, current.snapshot_id) = selected.id AS is_current,
          selected.result_kind
        FROM selected
        LEFT JOIN published ON published.snapshot_id = selected.id
        LEFT JOIN verified ON verified.snapshot_id = selected.id
        LEFT JOIN current_projection_snapshots current
          ON current.league_season_id = selected.league_season_id
          AND current.week = selected.week AND current.snapshot_id = selected.id`, [
        input.leagueWeekObservationId, input.leagueSeasonId, input.week, sourceIds,
        requiredText(input.modelVersion, 'Snapshot model version'),
        requiredText(input.revisionKey, 'Snapshot revision key'),
        input.calculatedAt, json(input.payload), contentHash, maxSourceSkewSeconds,
        payloadSeason, json(activityWindows), publicationFenceJson(input.lineupFence),
      ]);
      const row = rows[0];
      if (!row) return { kind: 'rejected', reason: 'incomplete-or-mismatched-sources' };
      return {
        kind: rowText(row, 'result_kind') === 'unchanged' ? 'unchanged' : 'published',
        snapshot: snapshotFromRow(row),
      };
    },

    async readCurrentSnapshot(leagueSeasonId, week) {
      const rows = await client.query(`/* projection-store:read-current-snapshot */
        SELECT snapshot.id AS snapshot_id,
          snapshot.league_season_id, snapshot.week, snapshot.model_version,
          snapshot.revision_key, snapshot.calculated_at::text,
          snapshot.payload, snapshot.activity_windows,
          current.published_at::text, current.verified_at::text,
          true AS is_current
        FROM current_projection_snapshots current
        JOIN projection_snapshots snapshot ON snapshot.id = current.snapshot_id
        WHERE current.league_season_id = $1 AND current.week = $2`, [leagueSeasonId, week]);
      return rows[0] ? snapshotFromRow(rows[0]) : null;
    },

    async readSnapshotSelectionBySleeperLeagueId(sleeperLeagueId, requestedWeek) {
      const rows = await client.query(`/* projection-store:read-snapshot-selection-by-sleeper-id */
        WITH ranked AS (
          SELECT snapshot.id AS snapshot_id,
            snapshot.league_season_id, snapshot.week, snapshot.model_version,
            snapshot.revision_key, snapshot.calculated_at::text,
            snapshot.payload, snapshot.activity_windows,
            current.published_at::text, current.verified_at::text,
            true AS is_current,
            row_number() OVER (
              ORDER BY season.season DESC, current.week DESC, current.calculated_at DESC
            ) AS latest_rank,
            row_number() OVER (
              PARTITION BY current.week
              ORDER BY season.season DESC, current.calculated_at DESC
            ) AS requested_week_rank
          FROM league_source_connections connection
          JOIN league_seasons season ON season.id = connection.league_season_id
          JOIN current_projection_snapshots current
            ON current.league_season_id = season.id
          JOIN projection_snapshots snapshot ON snapshot.id = current.snapshot_id
          WHERE connection.provider = 'sleeper' AND connection.external_league_id = $1
        )
        SELECT * FROM ranked
        WHERE latest_rank = 1
          OR ($2::smallint IS NOT NULL AND week = $2 AND requested_week_rank = 1)`, [
        requiredText(sleeperLeagueId, 'Sleeper league ID'), requestedWeek ?? null,
      ]);
      const parsed = rows.map((row) => ({ row, snapshot: snapshotFromRow(row) }));
      const latest = parsed.find(({ row }) => rowNumber(row, 'latest_rank') === 1)?.snapshot ?? null;
      const selected = requestedWeek === undefined
        ? latest
        : parsed.find(({ row, snapshot }) => (
          snapshot.week === requestedWeek && rowNumber(row, 'requested_week_rank') === 1
        ))?.snapshot ?? null;
      return { selected, latest };
    },
  };
}
