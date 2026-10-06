import { describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
import { createAcquisitionJobMethods } from './jobs';
import { createNeonAcquisitionJobRepository } from './job-repository';
import type { DatabaseClient } from '../../../database';
const id = '10000000-0000-4000-8000-000000000001';
const claim = () => ({ status: 'claimed', demandId: id,
  fence: { jobKey: `acquisition:${id}`, workerId: 'worker-a', attemptCount: 2, leaseUntil: '2026-10-06T18:00:00.000Z' },
  work: { kind: 'discover', nativeAccountId: '99999999999999999999', scanId: id, requiredSeasons: [2021, 2024, 2025, 2026] } });
function fixture(value: unknown) {
  const query = vi.fn(async () => [{ result: value }]);
  const repository = createNeonAcquisitionJobRepository(createAcquisitionJobMethods({ enabled: true, query } as DatabaseClient));
  return { query, repository };
}
describe('existing durable acquisition job owner', () => {
  it('delegates one atomic claim with only trusted worker identity, preserving opaque native IDs', async () => {
    const f = fixture(claim());
    expect(await f.repository.claimAccountAcquisition('worker-a')).toEqual(claim());
    expect(f.query).toHaveBeenCalledExactlyOnceWith(expect.stringContaining('public.claim_account_acquisition_v1($1)'), ['worker-a']);
  });
  it.each([{ kind: 'identify', username: 'alice' }, { kind: 'calendar-state' }])('accepts prerequisite work %j', async work => {
    const result = { ...claim(), work }; expect(await fixture(result).repository.claimAccountAcquisition('worker-a')).toEqual(result);
  });
  it.each(['idle', 'limited'])('preserves %s without creating another job', async status => {
    const result = { status, retryAfterSeconds: 30 };
    expect(await fixture(result).repository.claimAccountAcquisition('worker-a')).toEqual(result);
  });
  it.each([
    { ...claim(), actorId: id }, { ...claim(), demandId: '' },
    { ...claim(), fence: { ...claim().fence, workerId: 'worker-b' } },
    { ...claim(), fence: { ...claim().fence, attemptCount: 0 } },
    { ...claim(), work: { ...claim().work, requiredSeasons: [2024, 2024, 2026] } },
    { ...claim(), work: { ...claim().work, nativeAccountId: 123 } },
    { ...claim(), work: { kind: 'identify', username: '../escape' } },
    { ...claim(), work: { kind: 'calendar-state', guessedYear: 2026 } },
    { status: 'idle', retryAfterSeconds: 0 }, { status: 'limited', retryAfterSeconds: 61 },
  ])('fails closed on malformed/foreign retained claims %j', async value => {
    await expect(fixture(value).repository.claimAccountAcquisition('worker-a')).rejects.toThrow('invalid');
  });
  it('never dispatches a fabricated claim after unknown commit acknowledgement and never retries', async () => {
    const f = fixture(claim()); f.query.mockRejectedValue(new Error('ack lost'));
    await expect(f.repository.claimAccountAcquisition('worker-a')).rejects.toThrow();
    expect(f.query).toHaveBeenCalledTimes(1);
  });
  it.each(['', ' ', 'a'.repeat(101)])('rejects invalid worker before SQL', async worker => {
    const f = fixture(claim()); await expect(f.repository.claimAccountAcquisition(worker)).rejects.toThrow();
    expect(f.query).not.toHaveBeenCalled();
  });
});
