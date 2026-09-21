import { describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
vi.mock('next/cache', () => ({ unstable_cache: <Value,>(value: Value) => value }));
import { fakeStore, source, workerDependencies } from '../../live-projection-worker.fixtures';
import { refreshCurrentLineupContext } from './current-lineup-context';
import { loadCurrentLeagues } from './current-league-load';
import { completeFutureFullObservation, futureLineupTarget, futurePublicationFence, reserveFutureFullObservation } from './future-lineup-claim';
import { futureDependencies } from './future-fixtures';
import { prepareFuturePlan } from './future-plan';

describe('full observations share the persisted cadence policy', () => {
  it('keeps current full loads on the next minute without a second thin request', async () => {
    const dependencies = workerDependencies(fakeStore());
    const { context } = await refreshCurrentLineupContext(dependencies, 'worker-1');
    if (context.kind !== 'stored') throw new Error('Expected stored context.');
    const state = context.states.find((row) => row.watchClass === 'current')!;
    const complete = vi.spyOn(dependencies.lineupRepository, 'completeLineupObservation');
    const result = await loadCurrentLeagues(dependencies, [{ state, cadence: 'live-window', hourlyMarker: null }], 'worker-1');
    expect(result.sources).toHaveLength(1);
    expect(dependencies.sourceMock).toHaveBeenCalledTimes(1);
    expect(dependencies.lineupSource.getLineup).not.toHaveBeenCalled();
    const completedAt = Date.parse(source('l1').requestCompletedAt);
    expect(complete).toHaveBeenCalledWith(expect.objectContaining({ nextCheckAt:
      new Date((Math.floor(completedAt / 60_000) + 1) * 60_000).toISOString() }));
  });
  it('refuses invalid reserved current policy before loading its full provider source', async () => {
    const dependencies = workerDependencies(fakeStore());
    const { context } = await refreshCurrentLineupContext(dependencies, 'worker-1');
    if (context.kind !== 'stored') throw new Error('Expected stored context.');
    const state = context.states.find((row) => row.watchClass === 'current')!;
    const reservationMock = vi.spyOn(dependencies.lineupRepository, 'reserveFullLineupObservation');
    const reserve = reservationMock.getMockImplementation()!;
    reservationMock.mockImplementation(async (input) => {
      const result = await reserve(input);
      return result.kind === 'stored' ? { ...result, state: { ...result.state, cadencePolicyVersion: 'lineup-cadence-v2:60:0' } } : result;
    });
    expect(await loadCurrentLeagues(dependencies, [{ state, cadence: 'live-window', hourlyMarker: null }], 'worker-1'))
      .toMatchObject({ sources: [], failedLeagues: 1 });
    expect(dependencies.sourceMock).not.toHaveBeenCalled();
    expect(reservationMock).toHaveBeenCalledTimes(1);
  });
  it('full future materialization advances the same six-hour observation schedule', async () => {
    const store = fakeStore();
    const dependencies = futureDependencies(workerDependencies(store), store);
    const prepared = await prepareFuturePlan(dependencies, dependencies.clock.now());
    if (prepared === 'disabled') throw new Error('Expected future plan.');
    const state = prepared.watches.find((row) => row.watchClass === 'future')!;
    const fence = futurePublicationFence(dependencies, futureLineupTarget(state), 'worker-1', 'materialization-1');
    dependencies.states.set(state.watchId, { ...state, cadencePolicyVersion: 'lineup-cadence-v2:360:0' });
    const reservation = await reserveFutureFullObservation(dependencies, fence);
    await completeFutureFullObservation(dependencies, reservation, { ...source('l1'),
      requestCompletedAt: '2026-09-03T12:01:10Z' });
    expect(dependencies.lineupRepository.completeLineupObservation).toHaveBeenCalledWith(expect.objectContaining({
      nextCheckAt: '2026-09-03T18:00:00.000Z' }));
    dependencies.states.set(state.watchId, { ...state, cadencePolicyVersion: 'lineup-cadence-v2:360:600' });
    await expect(reserveFutureFullObservation(dependencies, fence)).rejects.toThrow('cadence');
  });
});
