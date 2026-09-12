import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
const { runProjection } = vi.hoisted(() => ({ runProjection: vi.fn() }));
vi.mock('./projections/runtime/projection-dispatch', () => ({
  runProductionProjectionSync: runProjection,
}));
import { runLiveProjectionSync } from './live-projection-worker';

describe('production live projection worker', () => {
  beforeEach(() => {
    runProjection.mockReset();
  });

  it('returns the established matchup result without awaiting the all-player lane', async () => {
    const result = {
      status: 'completed' as const, cadence: 'live' as const,
      publishedLeagues: 2, failedLeagues: 0, providerGroups: 1,
    };
    runProjection.mockResolvedValueOnce(result);
    await expect(runLiveProjectionSync()).resolves.toEqual(result);
    expect(runProjection).toHaveBeenCalledOnce();
  });

  it('preserves the existing forced projection operation', async () => {
    runProjection.mockResolvedValueOnce({ status: 'skipped', reason: 'idle', cadence: 'forced' });
    await runLiveProjectionSync({ force: true });
    expect(runProjection).toHaveBeenCalledWith({ force: true });
  });
});
