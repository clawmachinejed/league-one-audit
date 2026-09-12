import { expect } from 'vitest';
import { createProjectionStore, type ProjectionStore } from '../lib/projection-store';
import type { AllPlayerJobFence } from '../lib/projections/adapters/neon/contracts';
import { createIndependentDatabase, ownerQuery, runtimeQuery } from './neon-integration-harness';

const JOB_KEY = 'all-player-ingestion:sleeper';
type JobRow = Record<string, unknown> & { payload: Record<string, unknown> };
const readJob = async () => (await ownerQuery<{ job: JobRow }>(
  'SELECT to_jsonb(job) AS job FROM projection_jobs job WHERE job_key = $1', [JOB_KEY]))[0].job;
async function restoreJob(job: JobRow) {
  // Only owner fixture setup inside the guarded isolated harness may restore the
  // exact prior job row. Runtime code cannot perform either of these mutations.
  await ownerQuery('DELETE FROM projection_jobs WHERE job_key = $1', [JOB_KEY]);
  await ownerQuery('INSERT INTO projection_jobs SELECT * FROM jsonb_populate_record(NULL::projection_jobs,$1::jsonb)',
    [JSON.stringify(job)]);
}
function protectedFields(job: JobRow) {
  const result = structuredClone(job);
  delete result.updated_at;
  delete result.payload.lastPreclaimOutcome;
  delete result.payload.nextPreclaimOutcomeAt;
  return result;
}

export async function verifyAllPlayerPreclaimDiagnostics(store: ProjectionStore) {
  const initial = await readJob();
  const diagnostic = { outcome: 'busy' as const, stage: 'claim', reason: 'live-owner',
    period: { season: 2199, seasonType: 'reg' as const, week: 1 },
    retryDisposition: 'next-poll' as const };
  try {
    expect(await store.recordAllPlayerPreclaimOutcome(diagnostic)).toBe('recorded');
    const recorded = await readJob();
    expect(protectedFields(recorded)).toEqual(protectedFields(initial));
    expect(await store.recordAllPlayerPreclaimOutcome(diagnostic)).toBe('unchanged');
    expect(await readJob()).toEqual(recorded);
    expect(await store.recordAllPlayerPreclaimOutcome({ ...diagnostic, reason: 'changed-owner-context' }))
      .toBe('throttled');
    expect(await readJob()).toEqual(recorded);
    await ownerQuery(`UPDATE projection_jobs SET payload = jsonb_set(payload,'{nextPreclaimOutcomeAt}',
      to_jsonb((clock_timestamp()-interval '1 second')::text)) WHERE job_key = $1`, [JOB_KEY]);
    const peer = createIndependentDatabase();
    const peerStore = createProjectionStore(peer.database);
    const outcomes = await Promise.allSettled([
      store.recordAllPlayerPreclaimOutcome({ ...diagnostic, reason: 'concurrent-first' }),
      peerStore.recordAllPlayerPreclaimOutcome({ ...diagnostic, reason: 'concurrent-second' }),
    ]).finally(() => peer.close());
    const dispositions = outcomes.map((outcome) => {
      if (outcome.status !== 'fulfilled') throw outcome.reason;
      return outcome.value;
    });
    expect(dispositions.sort()).toEqual(['recorded','throttled']);
    expect(protectedFields(await readJob())).toEqual(protectedFields(initial));
    await expect(runtimeQuery("UPDATE projection_jobs SET payload = '{}'::jsonb WHERE job_key = $1", [JOB_KEY]))
      .rejects.toThrow(/dedicated job functions/iu);
    for (const malformed of [null, {}, { ...diagnostic, period: null },
      { ...diagnostic, retryAt: 'not-a-timestamp' }, { ...diagnostic, unexpected: 'payload' }]) {
      await expect(runtimeQuery('SELECT public.record_all_player_preclaim_outcome($1::jsonb)',
        [JSON.stringify(malformed)])).rejects.toThrow(/preclaim/iu);
    }
    await ownerQuery('DELETE FROM projection_jobs WHERE job_key = $1', [JOB_KEY]);
    expect(await store.recordAllPlayerPreclaimOutcome({ outcome: 'validation-failed',
      stage: 'period-selection', reason: 'authority-unavailable', retryDisposition: 'manual-review' }))
      .toBe('recorded');
    const pending = await readJob();
    expect(pending).toMatchObject({ state: 'pending', attempt_count: 0, lease_owner: null, lease_until: null });
    expect(pending.payload).not.toHaveProperty('period');
    expect(pending.payload).not.toHaveProperty('requestStarts');
    expect(pending.payload).not.toHaveProperty('requestGeneration');
  } finally { await restoreJob(initial); }
}

export async function verifyAllPlayerJobRecovery(store: ProjectionStore, fence: AllPlayerJobFence) {
  const initial = await readJob();
  try {
    // This success must be justified by real preceding pointer publications;
    // no test injects a lastPublication marker or caller-supplied final proof.
    expect(await store.finishAllPlayerJob({ fence, outcome: 'published', diagnostic: {} })).toBe(true);
    const completed = await store.readAllPlayerJobState();
    expect(completed?.payload.periodHistory).toEqual(expect.arrayContaining([
      expect.objectContaining({ outcome: 'published', finalCoverage: true,
        period: { season: 2199, seasonType: 'reg', week: 1 } }),
    ]));
    await ownerQuery(`UPDATE projection_jobs SET state='running', lease_owner=$2,
      lease_until=clock_timestamp()-interval '1 second',
      payload=payload || jsonb_build_object('requestStarts',
        jsonb_build_array(clock_timestamp()-interval '13 hours'),'nextAttemptAt',NULL)
      WHERE job_key=$1`, [JOB_KEY, fence.workerId]);
    const claim = await store.acquireAllPlayerJob({ mode: 'backfill',
      period: { season: 2199, seasonType: 'reg', week: 1 }, workerId: 'integration-takeover',
      leaseSeconds: 60, deadlineAt: new Date(Date.now()+50_000).toISOString() });
    if (claim.kind !== 'acquired') throw new Error('The overdue isolated claim was not acquired.');
    expect(claim.fence.generation).toBe(fence.generation + 1);
    const active = await store.readAllPlayerJobState();
    expect(active?.payload.lastInterruptedOutcome).toMatchObject({ outcome: 'lease-lost',
      stage: 'expired-before-completion', generation: fence.generation,
      period: { season: 2199, seasonType: 'reg', week: 1 } });
    expect(await store.finishAllPlayerJob({ fence, outcome: 'partial', diagnostic: {} })).toBe(false);
    expect(await store.finishAllPlayerJob({ fence: claim.fence, outcome: 'published',
      diagnostic: { finalCoverage: true } })).toBe(false);
    expect(await store.finishAllPlayerJob({ fence: claim.fence, outcome: 'provider-failed',
      diagnostic: { reason: 'synthetic-correction-failure', finalCoverage: false } })).toBe(true);
    const failed = await store.readAllPlayerJobState();
    expect(failed?.state).toBe('failed');
    expect(failed?.payload.lastOutcome).toMatchObject({ outcome: 'provider-failed', finalCoverage: false });
    expect(failed?.payload.periodHistory).toEqual(expect.arrayContaining([
      expect.objectContaining({ outcome: 'published', finalCoverage: true,
        lastAttempt: expect.objectContaining({ outcome: 'provider-failed', finalCoverage: false }) }),
    ]));
  } finally { await restoreJob(initial); }
}
