import { describe, expect, it, vi } from 'vitest';
import { runLineupObservation } from './lineup-orchestrator';
import { lineupAuthority, lineupAuthorityResult, lineupHarness, lineupNow } from './lineup-observation.fixtures';

describe('independent lineup observation worker', () => {
  it('stops before registry and provider work with disabled persistence', async () => {
    const h = lineupHarness();
    h.lineupRepository.enabled = false;
    expect(await runLineupObservation(h.dependencies)).toEqual({ status: 'unavailable' });
    expect(h.dependencies.leagueRegistry.listActiveLeagues).not.toHaveBeenCalled();
    expect(h.lineupSource.getLineup).not.toHaveBeenCalled();
  });
  it('holds a minute job and processes at most 18 future requests with batches of eight', async () => {
    const h = lineupHarness();
    let concurrency = 0; let peak = 0;
    const original = h.lineupSource.getLineup.getMockImplementation()!;
    h.lineupSource.getLineup.mockImplementation(async (input) => {
      concurrency += 1; peak = Math.max(peak, concurrency);
      await Promise.resolve(); const output = await original(input); concurrency -= 1; return output;
    });
    expect(await runLineupObservation(h.dependencies)).toEqual({ status: 'completed', checked: 18, changed: 18,
      unchanged: 0, notReady: 0, skipped: 0, failed: 0, pending: 18 });
    expect(peak).toBe(8);
    expect(h.lineupRepository.claimDueLineupObservations.mock.calls.map(([input]) => input.limit)).toEqual([8, 8, 2]);
    expect(h.lineupSource.getLineup.mock.calls.every(([input]) => input.period.week > 1)).toBe(true);
    expect(h.repository.acquireJob).toHaveBeenCalledWith(expect.objectContaining({ jobKey: 'lineup-observation-sync', leaseSeconds: 120,
      scheduledFor: lineupNow.toISOString(), workerId: 'run-1' }));
    expect(h.repository.completeJob).toHaveBeenCalledExactlyOnceWith('lineup-observation-sync', 'run-1');
    expect(h.lineupRepository.wakeFutureProjectionAndMaterialization).toHaveBeenCalledTimes(18);
    expect(h.lineupRepository.wakeFutureProjectionAndMaterialization.mock.calls.every(([input]) => input.wakeProjection === false)).toBe(true);
  });
  it('includes two preseason default checks while preserving 18 future/20 total request limits', async () => {
    const h = lineupHarness();
    h.periodAuthorityReader.readAuthorities.mockResolvedValue(h.configurations.map((configuration) => lineupAuthorityResult(lineupAuthority(configuration, 'preseason'))));
    const result = await runLineupObservation(h.dependencies);
    expect(result).toMatchObject({ status: 'completed', checked: 20, changed: 20 });
    expect(h.lineupSource.getLineup.mock.calls.filter(([input]) => input.period.week === 1)).toHaveLength(2);
    expect(h.lineupSource.getLineup.mock.calls.filter(([input]) => input.period.week > 1)).toHaveLength(18);
  });
  it('does not acquire row claims while the global minute lease is busy', async () => {
    const h = lineupHarness();
    h.repository.acquireJob.mockResolvedValue({ kind: 'busy' } as never);
    expect(await runLineupObservation(h.dependencies)).toEqual({ status: 'skipped', reason: 'busy' });
    expect(h.lineupRepository.claimDueLineupObservations).not.toHaveBeenCalled();
    expect(h.lineupSource.getLineup).not.toHaveBeenCalled();
  });
  it('reports unavailable rather than successful idle when every durable authority is unusable', async () => {
    const h = lineupHarness();
    h.periodAuthorityReader.readAuthorities.mockResolvedValue(h.configurations.map((configuration) => ({ kind: 'stale', leagueKey: configuration.key })));
    expect(await runLineupObservation(h.dependencies)).toEqual({ status: 'unavailable' });
    expect(h.lineupRepository.claimDueLineupObservations).not.toHaveBeenCalled();
    expect(h.lineupSource.getLineup).not.toHaveBeenCalled();
    expect(h.repository.completeJob).not.toHaveBeenCalled();
  });
  it('isolates unavailable rows and uses normal cadence as first failure backoff', async () => {
    const h = lineupHarness();
    h.lineupSource.getLineup.mockResolvedValueOnce({ status: 'unavailable', reason: 'source-unavailable',
      requestStartedAt: lineupNow.toISOString(), requestCompletedAt: lineupNow.toISOString() } as never);
    expect(await runLineupObservation(h.dependencies)).toMatchObject({ status: 'partial', checked: 18, changed: 17, failed: 1 });
    expect(h.lineupRepository.failLineupObservation).toHaveBeenCalledWith(expect.objectContaining({ retryDelaysSeconds: [180, 300, 900, 3600] }));
    expect(h.repository.completeJob).toHaveBeenCalledTimes(1);
  });
  it('treats an unpopulated week as healthy not-ready without a wake or projection write', async () => {
    const h = lineupHarness();
    h.lineupSource.getLineup.mockResolvedValueOnce({ status: 'not-ready', reason: 'empty',
      requestStartedAt: lineupNow.toISOString(), requestCompletedAt: lineupNow.toISOString() } as never);
    expect(await runLineupObservation(h.dependencies)).toMatchObject({ status: 'completed', notReady: 1, failed: 0 });
    expect(h.lineupRepository.recordLineupObservationNotReady).toHaveBeenCalledTimes(1);
    expect(h.lineupRepository.wakeFutureProjectionAndMaterialization).toHaveBeenCalledTimes(17);
  });
  it('reports a failed wake without discarding the alreadyaccepted durable revision', async () => {
    const h = lineupHarness();
    h.lineupRepository.wakeFutureProjectionAndMaterialization.mockRejectedValueOnce(new Error('private database error'));
    const result = await runLineupObservation(h.dependencies);
    expect(result).toMatchObject({ status: 'partial', changed: 18, failed: 1, pending: 18 });
    expect(h.lineupRepository.failLineupObservation).not.toHaveBeenCalled();
    expect(JSON.stringify(vi.mocked(h.dependencies.logger.write).mock.calls)).not.toContain('private database error');
  });
  it('does not start another batch after the start deadline', async () => {
    const h = lineupHarness();
    const original = h.lineupSource.getLineup.getMockImplementation()!;
    h.lineupSource.getLineup.mockImplementation(async (input) => { h.setElapsed(31_000); return original(input); });
    expect(await runLineupObservation(h.dependencies)).toMatchObject({ status: 'completed', checked: 8, skipped: 26 });
    expect(h.lineupRepository.claimDueLineupObservations).toHaveBeenCalledTimes(1);
  });
  it('returns fatal failure for a lost completion lease without exposing exception contents', async () => {
    const h = lineupHarness(); h.repository.completeJob.mockResolvedValue(false);
    expect(await runLineupObservation(h.dependencies)).toEqual({ status: 'failed' });
    expect(h.repository.failJob).toHaveBeenCalledWith('lineup-observation-sync', 'run-1', 'lineup-observation-failed');
    expect(JSON.stringify(vi.mocked(h.dependencies.logger.write).mock.calls)).not.toContain('Error');
  });
  it('cancels in-flight requests at the completion deadline and cannot publish a late observation', async () => {
    vi.useFakeTimers();
    try {
      const h = lineupHarness();
      const signals: AbortSignal[] = [];
      const getLineup = vi.fn<typeof h.dependencies.lineupSource.getLineup>(async (_input, signal) => {
        if (!signal) throw new Error('Expected cancellation signal.');
        signals.push(signal);
        return new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(new Error('Cancelled')), { once: true }));
      });
      const result = runLineupObservation({ ...h.dependencies, lineupSource: { getLineup } });
      await vi.waitFor(() => expect(getLineup).toHaveBeenCalledTimes(8));
      await vi.advanceTimersByTimeAsync(44_000);
      expect(await result).toEqual({ status: 'failed' });
      expect(signals.every((signal) => signal.aborted)).toBe(true);
      expect(h.lineupRepository.completeLineupObservation).not.toHaveBeenCalled();
      expect(h.repository.completeJob).not.toHaveBeenCalled();
      expect(h.repository.failJob).toHaveBeenCalledTimes(1);
    } finally { vi.useRealTimers(); }
  });
});
