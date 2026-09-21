import { describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
import { createFakeProjectionDatabase } from '../../../projection-store-test-support';
import { createJobMethods } from './jobs';
import type { SleeperWeeklyStatReceipt } from './contracts';

const period = { season: 2026, seasonType: 'reg', week: 2 } as const;
const fence = { jobKey: 'all-player-ingestion:sleeper', workerId: 'worker', generation: 7,
  leaseUntil: '2026-09-20T20:02:00.000Z', deadlineAt: '2026-09-20T20:01:00.000Z' };
const receipt: SleeperWeeklyStatReceipt = { period, sourceRevision: 'etag:weekly', bodyHash: `sha256:${'a'.repeat(64)}`,
  requestStartedAt: '2026-09-20T20:00:00.000Z', requestCompletedAt: '2026-09-20T20:00:01.000Z', requestGeneration: 7 };
const input = { period, workerId: fence.workerId, leaseSeconds: 120, deadlineAt: fence.deadlineAt };

it('keeps legacy claim parameters and uses the same job fence for live and captured-response claims', async () => {
  const db = createFakeProjectionDatabase(() => [{ kind: 'acquired', generation: 7,
    lease_until: fence.leaseUntil, deadline_at: fence.deadlineAt }]);
  const jobs = createJobMethods(db.database);
  expect(await jobs.acquireAllPlayerJob({ ...input, mode: 'recurring' })).toEqual({ kind: 'acquired', fence });
  expect(db.calls[0].statement).toContain('public.claim_all_player_job(');
  expect(db.calls[0].parameters).toEqual(['recurring', JSON.stringify(period), 'worker', 120, fence.deadlineAt]);
  expect(await jobs.acquireAllPlayerJob({ ...input, mode: 'live-defense' })).toEqual({ kind: 'acquired', fence });
  expect(db.calls[1].statement).toContain('public.claim_live_defense_stat_job(');
  expect(await jobs.acquireAllPlayerJob({ ...input, mode: 'recurring', captureReceipt: receipt }))
    .toEqual({ kind: 'acquired', fence });
  expect(db.calls[2].statement).toContain('public.claim_shared_all_player_job(');
  expect(JSON.parse(String(db.calls[2].parameters[4]))).toEqual(receipt);
});

describe('capture bookkeeping rejects invalid evidence before the database boundary', () => {
  it.each([
    { bodyHash: 'not-a-hash' }, { requestGeneration: 0 }, { sourceRevision: '' },
    { requestStartedAt: '2026-09-20T20:00:02.000Z' }, { requestCompletedAt: 'invalid' },
    { period: { ...period, week: 19 } },
  ])('rejects malformed receipt %j', async (patch) => {
    const db = createFakeProjectionDatabase(); const jobs = createJobMethods(db.database);
    await expect(jobs.acquireAllPlayerJob({ ...input, mode: 'recurring', captureReceipt: { ...receipt, ...patch } }))
      .rejects.toThrow('capture receipt is invalid');
    expect(db.calls).toHaveLength(0);
  });
  it('never replays a capture through an operator or permits evidence-free successful completion', async () => {
    const db = createFakeProjectionDatabase(); const jobs = createJobMethods(db.database);
    await expect(jobs.acquireAllPlayerJob({ ...input, mode: 'backfill', captureReceipt: receipt })).rejects.toThrow('Only recurring');
    await expect(jobs.finishLiveDefenseStatRequest({ fence, outcome: 'captured' })).rejects.toThrow('matching evidence');
    await expect(jobs.finishLiveDefenseStatRequest({ fence, outcome: 'timeout', captureReceipt: receipt }))
      .rejects.toThrow('matching evidence');
    expect(db.calls).toHaveLength(0);
  });
  it('persists only the bounded receipt and preserves a denied completion result', async () => {
    const db = createFakeProjectionDatabase(() => [{ finished: false }]); const jobs = createJobMethods(db.database);
    expect(await jobs.finishLiveDefenseStatRequest({ fence, outcome: 'captured', captureReceipt: receipt })).toBe(false);
    expect(db.calls[0].statement).toContain('public.finish_live_defense_stat_request(');
    expect(JSON.parse(String(db.calls[0].parameters[0]))).toEqual(fence);
    expect(db.calls[0].parameters[1]).toBe('captured');
    expect(JSON.parse(String(db.calls[0].parameters[2]))).toEqual(receipt);
  });
});
