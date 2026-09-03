import 'server-only';
import type { DatabaseClient } from '../../../database';
import type { StoreAcknowledgeCurrentLineupInput, StoreCompleteFutureLineupInput, LineupAcknowledgmentMethods } from './lineup-publication-contracts';
import { json, provider, requiredText } from './database-values';
import { futureRefreshNextAfter, futureRefreshPeriod, futureRefreshTimestamp, futureRefreshTransition, futureRefreshUuid } from './future-refresh-values';
import { materializationTargetValue, observationLineupValues, publicationFenceJson } from './lineup-publication-values';
import { LINEUP_ACKNOWLEDGMENT_CTES } from './lineup-acknowledgment-sql';

function actualLineage(input: StoreAcknowledgeCurrentLineupInput | StoreCompleteFutureLineupInput) {
  const [lineupRevisionVersion, lineupRevision] = observationLineupValues(input.lineupRevisionVersion, input.lineupRevision);
  return {
    leagueKey: requiredText(input.leagueKey, 'League key'),
    ...futureRefreshPeriod(input.period),
    modelVersion: requiredText(input.modelVersion, 'Projection model version'),
    sourceRevision: requiredText(input.sourceRevision, 'League source revision'),
    snapshotRevision: requiredText(input.snapshotRevision, 'Snapshot revision'),
    lineupRevisionVersion, lineupRevision,
  };
}

export function createLineupAcknowledgmentMethods(client: DatabaseClient): LineupAcknowledgmentMethods {
  return {
    async acknowledgeCurrentLineup(input) {
      const fence = publicationFenceJson(input.fence);
      const rows = await client.query(`/* projection-store:acknowledge-current-lineup */
        WITH ${LINEUP_ACKNOWLEDGMENT_CTES}
        SELECT id FROM acknowledged`, [json({ ...actualLineage(input), ...JSON.parse(fence!) })]);
      return { kind: rows.length ? 'updated' : 'stale' };
    },
    async completeFutureMaterializationAndAcknowledgeLineup(input) {
      const target = materializationTargetValue(input.target);
      const completedAt = futureRefreshTimestamp(input.completedAt, 'Materialization completion time');
      const rows = await client.query(`/* projection-store:complete-future-materialization-and-acknowledge-lineup */
        WITH ${LINEUP_ACKNOWLEDGMENT_CTES}, completed AS (
          UPDATE league_week_materialization_states materialization SET
            active_attempt_id = NULL, active_attempt_started_at = NULL, active_attempt_expires_at = NULL,
            active_watch_id = NULL, active_watch_generation = NULL, active_authority_generation = NULL,
            active_target_observed_version = NULL, active_target_lineup_revision = NULL,
            last_succeeded_at = now(), last_source_revision = context.value->>'sourceRevision',
            last_projection_slate_observation_id = slate.projection_slate_observation_id,
            last_projection_slate_content_id = slate.projection_slate_content_id,
            last_snapshot_revision = context.value->>'snapshotRevision',
            consecutive_failures = 0, last_failure_code = NULL,
            next_refresh_at = CASE WHEN acknowledged.pending_since IS NOT NULL THEN now()
              ELSE GREATEST(now(), (context.value->>'nextRefreshAt')::timestamptz) END,
            updated_at = now()
          FROM acknowledged, attempt, context, valid_slate slate
          WHERE materialization.league_key = attempt.league_key
            AND materialization.projection_provider = attempt.projection_provider
            AND materialization.season = attempt.season AND materialization.season_type = attempt.season_type
            AND materialization.week = attempt.week AND materialization.normalizer_version = attempt.normalizer_version
            AND materialization.model_version = attempt.model_version
          RETURNING materialization.next_refresh_at
        ) SELECT 0::integer AS consecutive_failures, next_refresh_at::text,
          0::integer AS materializations_woken FROM completed`, [json({
        ...actualLineage(input), ...target,
        // Actual full observation is deliberately independent of the claim's target.
        lineupRevision: input.lineupRevision, targetLineupRevision: target.lineupRevision,
        ownerLane: 'future', runId: requiredText(input.runId, 'Worker run ID'),
        projectionProvider: provider(input.projectionProvider),
        normalizerVersion: requiredText(input.normalizerVersion, 'Projection normalizer version'),
        attemptId: futureRefreshUuid(input.attemptId, 'Materialization attempt ID'),
        nextRefreshAt: futureRefreshNextAfter(input.nextRefreshAt, completedAt),
        slateObservationId: futureRefreshUuid(input.slate.observationId, 'Slate observation ID'),
        slateContentId: futureRefreshUuid(input.slate.contentId, 'Slate content ID'),
      })]);
      return futureRefreshTransition(rows);
    },
  };
}
