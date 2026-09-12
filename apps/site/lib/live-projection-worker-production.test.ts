import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
const { runProjection, runAllPlayer } = vi.hoisted(() => ({
  runProjection: vi.fn(), runAllPlayer: vi.fn(),
}));
vi.mock('./projections/runtime/projection-dispatch', () => ({
  runProductionProjectionSync: runProjection,
}));
vi.mock('./projections/runtime/all-player-composition', () => ({
  runProductionAllPlayerRecurring: runAllPlayer,
}));

import { runLiveProjectionSync } from './live-projection-worker';

describe('production live worker all-player attachment', () => {
  beforeEach(() => {
    runProjection.mockReset();
    runAllPlayer.mockReset();
  });

  it('preserves the established matchup result when recurring all-player ingestion fails', async () => {
    const result = {
      status: 'completed' as const, cadence: 'live' as const,
      publishedLeagues: 2, failedLeagues: 0, providerGroups: 1,
    };
    runProjection.mockResolvedValueOnce(result);
    runAllPlayer.mockRejectedValueOnce(new Error('all-player unavailable'));
    await expect(runLiveProjectionSync()).resolves.toEqual(result);
    expect(runProjection).toHaveBeenCalledOnce();
    expect(runAllPlayer).toHaveBeenCalledOnce();
  });

  it('does not attach all-player ingestion to the existing forced projection operation', async () => {
    runProjection.mockResolvedValueOnce({ status: 'skipped', reason: 'idle', cadence: 'forced' });
    await runLiveProjectionSync({ force: true });
    expect(runAllPlayer).not.toHaveBeenCalled();
  });
});
