import 'server-only';

import type { DatabaseClient } from '../../../database';
import type { AllPlayerJobFence, ProjectionStore } from './contracts';
import { json, requiredText, rowNullableText, rowNumber, rowObject, rowText } from './database-values';

export const ALL_PLAYER_JOB_KEY = 'all-player-ingestion:sleeper';

export function validateAllPlayerFenceShape(fence: AllPlayerJobFence): void {
  if (fence.jobKey !== ALL_PLAYER_JOB_KEY || !fence.workerId.trim()
    || !Number.isInteger(fence.generation) || fence.generation < 1
    || !Number.isFinite(Date.parse(fence.leaseUntil))
    || !Number.isFinite(Date.parse(fence.deadlineAt))) {
    throw new Error('All-player job fence is invalid.');
  }
}

type JobMethods = Pick<ProjectionStore,
  | 'acquireJob'
  | 'completeJob'
  | 'failJob'
  | 'acquireAllPlayerJob'
  | 'readAllPlayerJobState'
  | 'validateAllPlayerJobFence'
  | 'markAllPlayerRequest'
  | 'finishAllPlayerJob'
  | 'recordAllPlayerPreclaimOutcome'
>;

export function createJobMethods(client: DatabaseClient): JobMethods {
  return {
    async recordAllPlayerPreclaimOutcome(input) {
      if (!['not-due','busy','validation-failed','timeout'].includes(input.outcome)
        || !input.stage.trim() || input.stage.length > 96
        || !input.reason.trim() || input.reason.length > 192
        || !['next-poll','after-cooldown','manual-review'].includes(input.retryDisposition)
        || (input.retryAt != null && (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(input.retryAt)
          || !Number.isFinite(Date.parse(input.retryAt))))
        || (input.period && (!Number.isInteger(input.period.season)
          || input.period.season < 2026 || input.period.season > 2200
          || input.period.seasonType !== 'reg' || !Number.isInteger(input.period.week)
          || input.period.week < 1 || input.period.week > 18))) {
        throw new Error('All-player preclaim outcome is invalid.');
      }
      const rows = await client.query(`/* projection-store:record-all-player-preclaim-outcome */
        SELECT public.record_all_player_preclaim_outcome($1::jsonb) AS disposition`, [json(input)]);
      const disposition = rowText(rows[0] ?? {}, 'disposition');
      if (!['recorded','unchanged','throttled'].includes(disposition)) {
        throw new Error('All-player preclaim outcome result is invalid.');
      }
      return disposition as 'recorded' | 'unchanged' | 'throttled';
    },
    async acquireAllPlayerJob(input) {
      if (!Number.isInteger(input.leaseSeconds) || input.leaseSeconds < 1
        || input.leaseSeconds > 3_600 || !Number.isFinite(Date.parse(input.deadlineAt))) {
        throw new Error('All-player lease and deadline are invalid.');
      }
      const rows = await client.query(`/* projection-store:acquire-all-player-job */
        SELECT * FROM public.claim_all_player_job($1, $2::jsonb, $3, $4, $5::timestamptz)`, [
        input.mode, json(input.period), requiredText(input.workerId, 'Worker ID'),
        input.leaseSeconds, input.deadlineAt,
      ]);
      const row = rows[0];
      if (!row || !['acquired', 'busy', 'not-due'].includes(String(row.kind))) {
        throw new Error('All-player claim result is invalid.');
      }
      if (row.kind !== 'acquired') return {
        kind: row.kind as 'busy' | 'not-due', nextRequestAt: rowNullableText(row, 'next_request_at'),
      };
      return { kind: 'acquired', fence: {
        jobKey: ALL_PLAYER_JOB_KEY, workerId: input.workerId,
        generation: rowNumber(row, 'generation'),
        leaseUntil: rowText(row, 'lease_until'), deadlineAt: rowText(row, 'deadline_at'),
      } };
    },
    async readAllPlayerJobState() {
      const rows = await client.query(`/* projection-store:read-all-player-job */
        SELECT state, lease_owner, attempt_count, lease_until::text, payload,
          public.all_player_next_request_at(payload)::text AS next_request_at
        FROM projection_jobs WHERE job_key = $1`, [ALL_PLAYER_JOB_KEY]);
      const row = rows[0];
      if (!row) return null;
      if (!['pending', 'running', 'completed', 'failed'].includes(String(row.state))) {
        throw new Error('All-player job state is invalid.');
      }
      return {
        state: row.state as 'pending' | 'running' | 'completed' | 'failed',
        workerId: rowNullableText(row, 'lease_owner'), generation: rowNumber(row, 'attempt_count'),
        leaseUntil: rowNullableText(row, 'lease_until'), payload: rowObject(row, 'payload'),
        nextRequestAt: rowNullableText(row, 'next_request_at'),
      };
    },
    async validateAllPlayerJobFence(fence) {
      validateAllPlayerFenceShape(fence);
      const rows = await client.query(`/* projection-store:validate-all-player-fence */
        SELECT public.all_player_job_fence_is_live($1::jsonb) AS live`, [json(fence)]);
      return rows[0]?.live === true;
    },
    async markAllPlayerRequest(input) {
      validateAllPlayerFenceShape(input.fence);
      const rows = await client.query(`/* projection-store:mark-all-player-request */
        SELECT public.mark_all_player_request($1::jsonb, $2::jsonb) AS marked`, [
        json(input.fence), json(input.period),
      ]);
      return rows[0]?.marked === true;
    },
    async finishAllPlayerJob(input) {
      validateAllPlayerFenceShape(input.fence);
      const rows = await client.query(`/* projection-store:finish-all-player-job */
        SELECT public.finish_all_player_job($1::jsonb, $2, $3::jsonb) AS finished`, [
        json(input.fence), input.outcome, json(input.diagnostic),
      ]);
      return rows[0]?.finished === true;
    },
    async acquireJob(input) {
      if (!Number.isInteger(input.leaseSeconds) || input.leaseSeconds < 1) {
        throw new Error('Job lease must be a positive number of whole seconds.');
      }
      if (input.minimumIntervalSeconds !== undefined
        && (!Number.isInteger(input.minimumIntervalSeconds)
          || input.minimumIntervalSeconds < 1)) {
        throw new Error('Job minimum interval must be a positive number of whole seconds.');
      }
      const rows = await client.query(`/* projection-store:acquire-job */
        INSERT INTO projection_jobs (
          job_key, job_type, scheduled_for, state, payload,
          lease_owner, lease_until, attempt_count, updated_at
        ) VALUES (
          $1, $2, $3, 'running', $4::jsonb,
          $5, now() + ($6 * interval '1 second'), 1, now()
        )
        ON CONFLICT (job_key) DO UPDATE SET
          job_type = EXCLUDED.job_type,
          scheduled_for = EXCLUDED.scheduled_for,
          state = 'running',
          payload = EXCLUDED.payload,
          lease_owner = EXCLUDED.lease_owner,
          lease_until = EXCLUDED.lease_until,
          attempt_count = projection_jobs.attempt_count + 1,
          last_error = NULL,
          completed_at = NULL,
          updated_at = now()
        WHERE (projection_jobs.state IN ('pending', 'failed')
            AND EXCLUDED.scheduled_for >= projection_jobs.scheduled_for)
          OR (projection_jobs.state = 'running' AND projection_jobs.lease_until < now()
            AND EXCLUDED.scheduled_for >= projection_jobs.scheduled_for)
          OR (projection_jobs.state = 'completed'
            AND EXCLUDED.scheduled_for > projection_jobs.scheduled_for
            AND ($7::integer IS NULL OR projection_jobs.completed_at
              <= now() - ($7 * interval '1 second')))
        RETURNING attempt_count, lease_until::text`, [
        requiredText(input.jobKey, 'Job key'), requiredText(input.jobType, 'Job type'),
        input.scheduledFor, json(input.payload), requiredText(input.workerId, 'Worker ID'),
        input.leaseSeconds, input.minimumIntervalSeconds ?? null,
      ]);
      const acquired = rows[0];
      if (acquired) {
        return {
          kind: 'acquired',
          attempt: rowNumber(acquired, 'attempt_count'),
          leaseUntil: rowText(acquired, 'lease_until'),
        };
      }
      const existing = await client.query(`/* projection-store:read-job-state */
        SELECT state FROM projection_jobs WHERE job_key = $1`, [input.jobKey]);
      return { kind: existing[0]?.state === 'completed' ? 'completed' : 'busy' };
    },

    async completeJob(jobKey, workerId) {
      const rows = await client.query(`/* projection-store:complete-job */
        UPDATE projection_jobs SET
          state = 'completed', completed_at = now(), lease_owner = NULL,
          lease_until = NULL, updated_at = now()
        WHERE job_key = $1 AND state = 'running' AND lease_owner = $2
          AND lease_until > clock_timestamp()
        RETURNING job_key`, [jobKey, workerId]);
      return rows.length === 1;
    },

    async failJob(jobKey, workerId, message) {
      const rows = await client.query(`/* projection-store:fail-job */
        UPDATE projection_jobs SET
          state = 'failed', last_error = left($3, 2000), lease_owner = NULL,
          lease_until = NULL, updated_at = now()
        WHERE job_key = $1 AND state = 'running' AND lease_owner = $2
        RETURNING job_key`, [jobKey, workerId, message]);
      return rows.length === 1;
    },

  };
}
