import 'server-only';

import type { DatabaseClient } from '../../../database';
import type { LineupWatchMethods, LineupObservationWriteOutcome, FullLineupObservationInput, CompleteLineupObservationInput } from './lineup-watch-contracts';
import { requiredText } from './database-values';
import {
  lineupClaimValues, lineupFenceValues, lineupInteger, lineupRevision, lineupTimestamp,
  lineupWatchFromRow, LINEUP_CLAIM_FENCE_SQL, LINEUP_WATCH_FENCE_SQL, LINEUP_WATCH_RETURNING_SQL,
} from './lineup-watch-values';

type ObservationMethods = Pick<LineupWatchMethods, 'completeLineupObservation' | 'supersedeLineupClaimWithFullObservation' | 'recordLineupObservationNotReady' | 'failLineupObservation'>;

/** Source completion and full-source supersession use the same ordered acceptance statement. */
async function acceptObservation(client: DatabaseClient, input: CompleteLineupObservationInput | FullLineupObservationInput): Promise<LineupObservationWriteOutcome> {
  const thin = !('fence' in input);
  const values = thin ? lineupClaimValues(input.claim) : [...lineupFenceValues(input.fence), null, null, null, null];
  const started = lineupTimestamp(input.requestStartedAt);
  const completed = lineupTimestamp(input.requestCompletedAt);
  if (Date.parse(completed) < Date.parse(started)) throw new Error('Lineup completion precedes its request.');
  const rows = await client.query(`/* projection-store:accept-lineup-observation */
    WITH authority AS MATERIALIZED (
      SELECT a.* FROM league_period_authorities a JOIN league_week_lineup_watch_states source ON source.league_key = a.league_key
      WHERE source.id = $1::uuid FOR UPDATE OF a
    ), accepted AS (
      UPDATE league_week_lineup_watch_states w SET
        observed_version = w.observed_version + CASE WHEN w.latest_lineup_revision IS DISTINCT FROM $10 THEN 1 ELSE 0 END,
        latest_lineup_revision = $10, accepted_request_started_at = $11::timestamptz,
        accepted_request_completed_at = $12::timestamptz,
        last_checked_at = GREATEST(w.last_checked_at, $12::timestamptz), last_complete_observation_at = $12::timestamptz,
        pending_since = CASE WHEN $10 IS DISTINCT FROM w.last_materialized_lineup_revision
          THEN COALESCE(w.pending_since, $12::timestamptz) ELSE NULL END,
        next_check_at = $13::timestamptz, consecutive_failures = 0, last_failure_code = NULL,
        active_attempt_id = CASE WHEN ${thin ? 'TRUE' : 'w.attempt_started_at <= $11::timestamptz'} THEN NULL ELSE w.active_attempt_id END,
        lease_owner = CASE WHEN ${thin ? 'TRUE' : 'w.attempt_started_at <= $11::timestamptz'} THEN NULL ELSE w.lease_owner END,
        attempt_started_at = CASE WHEN ${thin ? 'TRUE' : 'w.attempt_started_at <= $11::timestamptz'} THEN NULL ELSE w.attempt_started_at END,
        lease_expires_at = CASE WHEN ${thin ? 'TRUE' : 'w.attempt_started_at <= $11::timestamptz'} THEN NULL ELSE w.lease_expires_at END, updated_at = now()
      FROM authority a WHERE a.league_key = w.league_key AND ${thin ? LINEUP_CLAIM_FENCE_SQL : `${LINEUP_WATCH_FENCE_SQL} AND $6::uuid IS NULL AND $7::bigint IS NULL AND $8::text IS NULL AND $9::bigint IS NULL`}
        AND (w.accepted_request_started_at IS NULL OR
          ($11::timestamptz, $12::timestamptz) > (w.accepted_request_started_at, w.accepted_request_completed_at))
      RETURNING ${LINEUP_WATCH_RETURNING_SQL}
    ) SELECT * FROM accepted`, [...values, lineupRevision(input.lineupRevision), started, completed, lineupTimestamp(input.nextCheckAt)]);
  return rows[0] ? { kind: 'stored', state: lineupWatchFromRow(rows[0]) } : { kind: 'stale' };
}

export function createLineupWatchObservationMethods(client: DatabaseClient): ObservationMethods {
  return {
    completeLineupObservation: (input) => acceptObservation(client, input),
    supersedeLineupClaimWithFullObservation: (input) => acceptObservation(client, input),
    async recordLineupObservationNotReady(input) {
      const rows = await client.query(`/* projection-store:record-lineup-observation-not-ready */
        WITH authority AS MATERIALIZED (
          SELECT a.* FROM league_period_authorities a JOIN league_week_lineup_watch_states source ON source.league_key = a.league_key
          WHERE source.id = $1::uuid FOR UPDATE OF a
        ) UPDATE league_week_lineup_watch_states w SET
          last_checked_at = GREATEST(w.last_checked_at, $10::timestamptz), next_check_at = $11::timestamptz,
          consecutive_failures = 0, last_failure_code = NULL,
          active_attempt_id = NULL, lease_owner = NULL, attempt_started_at = NULL, lease_expires_at = NULL, updated_at = now()
        FROM authority a WHERE a.league_key = w.league_key AND ${LINEUP_CLAIM_FENCE_SQL}
        RETURNING w.id`, [...lineupClaimValues(input.claim), lineupTimestamp(input.checkedAt), lineupTimestamp(input.nextCheckAt)]);
      return { kind: rows.length ? 'stored' : 'stale' };
    },
    async failLineupObservation(input) {
      const delays = input.retryDelaysSeconds.map((value) => lineupInteger(value, 1, 86_400, 'retry delay'));
      if (delays.length !== 4) throw new Error('Four lineup retry delays are required.');
      const failureCode = requiredText(input.failureCode, 'Failure code');
      if (!/^[a-z][a-z0-9-]{0,79}$/.test(failureCode)) throw new Error('Invalid safe lineup failure code.');
      const rows = await client.query(`/* projection-store:fail-lineup-observation */
        WITH authority AS MATERIALIZED (
          SELECT a.* FROM league_period_authorities a JOIN league_week_lineup_watch_states source ON source.league_key = a.league_key
          WHERE source.id = $1::uuid FOR UPDATE OF a
        ) UPDATE league_week_lineup_watch_states w SET
          consecutive_failures = w.consecutive_failures + CASE WHEN w.observed_version = $9::bigint THEN 1 ELSE 0 END,
          last_failure_code = CASE WHEN w.observed_version = $9::bigint THEN $10 ELSE w.last_failure_code END,
          next_check_at = CASE WHEN w.observed_version = $9::bigint
            THEN now() + ($11::integer[])[LEAST(w.consecutive_failures + 1, 4)] * interval '1 second' ELSE w.next_check_at END,
          active_attempt_id = NULL, lease_owner = NULL, attempt_started_at = NULL, lease_expires_at = NULL, updated_at = now()
        FROM authority a WHERE a.league_key = w.league_key AND ${LINEUP_CLAIM_FENCE_SQL}
        RETURNING w.id`, [...lineupClaimValues(input.claim), failureCode, delays]);
      return { kind: rows.length ? 'stored' : 'stale' };
    },
  };
}
