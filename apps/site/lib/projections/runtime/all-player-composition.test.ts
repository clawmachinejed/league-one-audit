import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
const { store, canonicalOperation } = vi.hoisted(() => ({
  store: { enabled: true, readLeagueLineupAuthorities: vi.fn() },
  canonicalOperation: vi.fn(),
}));
const catalogLoaders = vi.hoisted(() => ({
  cached: vi.fn(),
  neutral: vi.fn(),
  cachedProjectionInput: vi.fn(),
  neutralProjectionInput: vi.fn(),
}));
vi.mock('../../projection-store', () => ({ getProjectionStore: () => store }));
vi.mock('./all-player-operation', async (original) => ({
  ...await original<typeof import('./all-player-operation')>(),
  runAllPlayerIngestion: canonicalOperation,
}));
vi.mock('../adapters/neon/repository', () => ({ createNeonProjectionRepository: () => ({}) }));
vi.mock('../../sleeper', () => ({
  getFantasyPlayerCatalog: catalogLoaders.cached,
  getProjectionSyncInput: catalogLoaders.cachedProjectionInput,
  getOperatorProjectionSyncInput: catalogLoaders.neutralProjectionInput,
}));
vi.mock('../../sleeper-player-catalog', () => ({
  loadFantasyPlayerCatalog: catalogLoaders.neutral,
}));

import {
  createProductionAllPlayerDependencies,
  runProductionAllPlayerRecurring,
} from './all-player-composition';

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

  it('keeps recurring work on the Next.js-cached catalog and league-week path', async () => {
    const dependencies = createProductionAllPlayerDependencies();
    expect(dependencies.loadCatalog).toBe(catalogLoaders.cached);
    await expect(dependencies.loadLeagueWeek(
      { leagueRef: { externalId: 'league' } } as never,
      {} as never,
    )).rejects.toThrow();
    expect(catalogLoaders.cachedProjectionInput).toHaveBeenCalledOnce();
    expect(catalogLoaders.neutralProjectionInput).not.toHaveBeenCalled();
  });

  it('wires every explicit operator catalog read to the cache-neutral path', async () => {
    catalogLoaders.neutral.mockResolvedValue({
      catalog: {}, complete: true, sourceRevision: 'revision',
    });
    const dependencies = createProductionAllPlayerDependencies('cache-neutral');
    void dependencies.loadCatalog();
    void dependencies.loadCatalog();
    expect(catalogLoaders.neutral).toHaveBeenCalledOnce();
    await expect(dependencies.loadLeagueWeek(
      { leagueRef: { externalId: 'league' } } as never,
      {} as never,
    )).rejects.toThrow();
    expect(catalogLoaders.neutralProjectionInput).toHaveBeenCalledOnce();
    expect(catalogLoaders.neutralProjectionInput.mock.calls[0]?.[2])
      .toBe(dependencies.loadCatalog);
    expect(catalogLoaders.cachedProjectionInput).not.toHaveBeenCalled();
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
