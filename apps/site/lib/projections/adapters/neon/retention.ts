import 'server-only';

import type { DatabaseClient } from '../../../database';
import type { ProjectionStore } from './contracts';

type RetentionMethods = Pick<ProjectionStore, 'pruneHistory'>;

export function createRetentionMethods(client: DatabaseClient): RetentionMethods {
  return {
    async pruneHistory(input) {
      const keep = input.keepRecentSnapshotsPerLeagueWeek ?? 3;
      if (!Number.isInteger(keep) || keep < 1 || keep > 100) {
        throw new Error('Snapshot retention count must be between 1 and 100.');
      }

      // Each deletion is independently safe and idempotent. Source observations
      // referenced by surviving immutable snapshots and all frozen baselines remain.
      const snapshots = await client.query(`/* projection-store:prune-snapshots */
        WITH ranked AS (
          SELECT snapshot.id,
            row_number() OVER (
              PARTITION BY snapshot.league_season_id, snapshot.week, snapshot.model_version
              ORDER BY snapshot.calculated_at DESC, snapshot.created_at DESC
            ) AS retention_rank
          FROM projection_snapshots snapshot
        )
        DELETE FROM projection_snapshots snapshot
        USING ranked
        WHERE snapshot.id = ranked.id
          AND snapshot.created_at < $1::timestamptz
          AND ranked.retention_rank > $2
          AND NOT EXISTS (
            SELECT 1 FROM current_projection_snapshots current
            WHERE current.snapshot_id = snapshot.id
          )
        RETURNING snapshot.id`, [input.before, keep]);
      const leagueObservations = await client.query(`/* projection-store:prune-league-observations */
        DELETE FROM league_week_observations observation
        WHERE observation.created_at < $1::timestamptz
          AND NOT EXISTS (
            SELECT 1 FROM projection_snapshots snapshot
            WHERE snapshot.league_week_observation_id = observation.id
          )
        RETURNING observation.id`, [input.before]);
      const gameObservations = await client.query(`/* projection-store:prune-game-observations */
        DELETE FROM game_state_observations observation
        WHERE observation.created_at < $1::timestamptz
          AND NOT EXISTS (
            SELECT 1 FROM projection_snapshots snapshot
            WHERE snapshot.game_state_observation_ids @> ARRAY[observation.id]::uuid[]
          )
        RETURNING observation.id`, [input.before]);
      const projectionRuns = await client.query(`/* projection-store:prune-projection-runs */
        DELETE FROM pregame_projection_runs run
        WHERE run.created_at < $1::timestamptz
          AND NOT EXISTS (
            SELECT 1 FROM pregame_projection_baselines baseline
            WHERE baseline.source_projection_run_id = run.id
          )
          AND NOT EXISTS (
            SELECT 1 FROM current_pregame_projection_candidates current
            WHERE current.projection_run_id = run.id
          )
        RETURNING run.id`, [input.before]);
      const projectionSlateObservations = await client.query(`/* projection-store:prune-projection-slate-observations */
        DELETE FROM projection_slate_observations observation
        WHERE observation.created_at < $1::timestamptz
          AND NOT EXISTS (
            SELECT 1 FROM current_projection_slates current
            WHERE current.projection_slate_observation_id = observation.id
          )
          AND NOT EXISTS (
            SELECT 1 FROM pregame_projection_runs run
            WHERE run.projection_slate_observation_id = observation.id
          )
        RETURNING observation.id`, [input.before]);
      const projectionSlateContents = await client.query(`/* projection-store:prune-projection-slate-contents */
        DELETE FROM projection_slate_contents content
        WHERE content.created_at < $1::timestamptz
          AND NOT EXISTS (
            SELECT 1 FROM projection_slate_observations observation
            WHERE observation.projection_slate_content_id = content.id
          )
          AND NOT EXISTS (
            SELECT 1 FROM current_projection_slates current
            WHERE current.projection_slate_content_id = content.id
          )
        RETURNING content.id`, [input.before]);
      const jobs = await client.query(`/* projection-store:prune-jobs */
        DELETE FROM projection_jobs job
        WHERE job.updated_at < $1::timestamptz AND job.state = 'completed'
        RETURNING job.job_key`, [input.before]);

      return {
        kind: 'stored',
        value: {
          snapshotsDeleted: snapshots.length,
          leagueObservationsDeleted: leagueObservations.length,
          gameObservationsDeleted: gameObservations.length,
          projectionRunsDeleted: projectionRuns.length,
          projectionSlateObservationsDeleted: projectionSlateObservations.length,
          projectionSlateContentsDeleted: projectionSlateContents.length,
          jobsDeleted: jobs.length,
        },
      };
    },

  };
}
