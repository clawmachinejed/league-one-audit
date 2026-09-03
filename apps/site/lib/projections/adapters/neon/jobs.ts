import 'server-only';

import type { DatabaseClient } from '../../../database';
import type { ProjectionStore } from './contracts';
import { json, requiredText, rowNumber, rowText } from './database-values';

type JobMethods = Pick<ProjectionStore,
  | 'acquireJob'
  | 'completeJob'
  | 'failJob'
>;

export function createJobMethods(client: DatabaseClient): JobMethods {
  return {
    async acquireJob(input) {
      if (!Number.isInteger(input.leaseSeconds) || input.leaseSeconds < 1) {
        throw new Error('Job lease must be a positive number of whole seconds.');
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
            AND EXCLUDED.scheduled_for > projection_jobs.scheduled_for)
        RETURNING attempt_count, lease_until::text`, [
        requiredText(input.jobKey, 'Job key'), requiredText(input.jobType, 'Job type'),
        input.scheduledFor, json(input.payload), requiredText(input.workerId, 'Worker ID'),
        input.leaseSeconds,
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
