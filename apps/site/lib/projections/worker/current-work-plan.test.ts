import { describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
vi.mock('next/cache', () => ({ unstable_cache: <Value,>(value: Value) => value }));
import { cadenceInput, fakeStore, workerDependencies } from '../../live-projection-worker.fixtures';
import { planCurrentWork, settleCurrentHourlyMarkers } from './current-work-plan';
import { lineupState } from './lineup-observation.fixtures';

function setup(now = new Date('2026-09-13T12:02:00.000Z')) {
  const store = fakeStore();
  const dependencies = workerDependencies(store, { now });
  const cadence = cadenceInput('l1');
  const state = lineupState({ configuration: cadence.configuration, period: cadence.period, shape: cadence.lineupShape,
    authorityGeneration: 1, lineupRevisionVersion: 'lineup-v1', cadencePolicyVersion: 'lineup-cadence-v1',
    watchClass: 'current', materializationLane: 'current', phase: 0, initialNextCheckAt: now.toISOString() });
  return { store, dependencies, cadence, state, now, cadenceMap: new Map([[cadence.configuration.key, cadence]]) };
}

describe('current minute work and hourly completion markers', () => {
  it('uses a minute current lease separately from the hourly routine marker', async () => {
    const h = setup();
    const result = await planCurrentWork(h.dependencies, [h.state], h.cadenceMap, h.now, 'worker-1', false);
    expect(result.full).toHaveLength(1); expect(result.thin).toHaveLength(0);
    expect(result.full[0]).toMatchObject({ cadence: 'hourly', hourlyMarker: 'current-projection-hourly:league1:2026:regular:1' });
    expect(h.store.acquired).toHaveBeenCalledWith(expect.objectContaining({ scheduledFor: '2026-09-13T12:00:00.000Z', leaseSeconds: 120 }));
  });
  it('uses a thin observation after the routine hourly marker has completed', async () => {
    const h = setup(); h.store.acquired.mockResolvedValue({ kind: 'completed' });
    const result = await planCurrentWork(h.dependencies, [h.state], h.cadenceMap, h.now, 'worker-1', false);
    expect(result.full).toHaveLength(0); expect(result.thin).toEqual([h.state]);
  });
  it('bypasses the completed hourly marker for a newer pending lineup', async () => {
    const h = setup(); h.store.acquired.mockResolvedValue({ kind: 'completed' });
    const result = await planCurrentWork(h.dependencies, [{ ...h.state, pendingSince: h.now.toISOString() }], h.cadenceMap, h.now, 'worker-1', false);
    expect(result.full).toHaveLength(1); expect(result.full[0].hourlyMarker).toBeNull(); expect(result.thin).toHaveLength(0);
  });
  it('never performs a thin fallback while the routine marker is busy', async () => {
    const h = setup(); h.store.acquired.mockResolvedValue({ kind: 'busy' });
    const result = await planCurrentWork(h.dependencies, [h.state], h.cadenceMap, h.now, 'worker-1', false);
    expect(result).toMatchObject({ full: [], thin: [], skipped: 1 });
  });
  it('settles successful and failed hourly targets independently', async () => {
    const h = setup();
    const plan = await planCurrentWork(h.dependencies, [h.state], h.cadenceMap, h.now, 'worker-1', false);
    await settleCurrentHourlyMarkers(h.dependencies, plan.full, new Set([h.state.configuration.key]), 'worker-1');
    expect(h.store.completed).toHaveBeenCalledWith(plan.full[0].hourlyMarker, 'worker-1');
    await settleCurrentHourlyMarkers(h.dependencies, plan.full, new Set(), 'worker-1');
    expect(h.store.failed).toHaveBeenCalledWith(plan.full[0].hourlyMarker, 'worker-1', 'current-materialization-failed');
  });
  it('keeps preseason default ownership entirely out of the current lane', async () => {
    const h = setup();
    const result = await planCurrentWork(h.dependencies, [{ ...h.state, materializationLane: 'future' }], h.cadenceMap, h.now, 'worker-1', true);
    expect(result.full).toHaveLength(0); expect(result.thin).toHaveLength(0); expect(h.store.acquired).not.toHaveBeenCalled();
  });
  it('honors failed-row backoff even with pending work, without claiming an hourly marker', async () => {
    const h = setup();
    const blocked = { ...h.state, pendingSince: h.now.toISOString(), consecutiveFailures: 2,
      nextCheckAt: new Date(h.now.getTime() + 300_000).toISOString() };
    expect(await planCurrentWork(h.dependencies, [blocked], h.cadenceMap, h.now, 'worker-1', false))
      .toEqual({ full: [], thin: [], skipped: 1 });
    expect(h.store.acquired).not.toHaveBeenCalled();
    expect((await planCurrentWork(h.dependencies, [blocked], h.cadenceMap, h.now, 'worker-1', true)).full).toHaveLength(1);
  });
});
