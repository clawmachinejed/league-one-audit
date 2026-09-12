import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
const { store, canonicalOperation } = vi.hoisted(() => ({
  store: { enabled: true, readLeagueLineupAuthorities: vi.fn() },
  canonicalOperation: vi.fn(),
}));
vi.mock('../../projection-store', () => ({ getProjectionStore: () => store }));
vi.mock('./all-player-operation', async (original) => ({
  ...await original<typeof import('./all-player-operation')>(),
  runAllPlayerIngestion: canonicalOperation,
}));
vi.mock('../adapters/neon/repository', () => ({ createNeonProjectionRepository: () => ({}) }));
vi.mock('../../sleeper', () => ({
  getFantasyPlayerCatalog: vi.fn(), getProjectionSyncInput: vi.fn(),
}));

import { runProductionAllPlayerRecurring } from './all-player-composition';

describe('production all-player recurring composition', () => {
  afterEach(() => {
    delete process.env.ALL_PLAYER_RECURRING_ENABLED;
    vi.clearAllMocks();
  });

  it('is dormant by default without reading database or provider state', async () => {
    await expect(runProductionAllPlayerRecurring()).resolves.toEqual({
      status: 'disabled', mode: 'recurring',
    });
    expect(store.readLeagueLineupAuthorities).not.toHaveBeenCalled();
    expect(canonicalOperation).not.toHaveBeenCalled();
  });

  it('derives one shared active period and invokes the canonical operation in recurring mode', async () => {
    process.env.ALL_PLAYER_RECURRING_ENABLED = 'true';
    store.readLeagueLineupAuthorities.mockResolvedValueOnce(['league1', 'league2'].map((leagueKey) => ({
      kind: 'available', leagueKey, authority: {
        leagueLifecycle: 'active', activeSeason: 2026, activeSeasonType: 'reg', activeWeek: 1,
      },
    })));
    canonicalOperation.mockResolvedValueOnce({ status: 'completed', mode: 'recurring' });
    await expect(runProductionAllPlayerRecurring()).resolves.toMatchObject({ status: 'completed' });
    expect(canonicalOperation).toHaveBeenCalledOnce();
    expect(canonicalOperation.mock.calls[0][1]).toEqual({
      mode: 'recurring', period: { season: 2026, seasonType: 'regular', week: 1 },
      requireFinalCoverage: false,
    });
  });
});
