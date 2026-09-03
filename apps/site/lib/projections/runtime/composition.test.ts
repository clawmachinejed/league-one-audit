import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const calls = vi.hoisted(() => ({ query: vi.fn<(...parameters: unknown[]) => Promise<never[]>>(async () => []),
  cacheFactory: vi.fn((...args: unknown[]) => args[0]) }));
vi.mock('server-only', () => ({}));
vi.mock('next/cache', () => ({ unstable_cache: calls.cacheFactory }));
vi.mock('../../database', async (original) => ({
  ...await original<typeof import('../../database')>(),
  getDatabase: () => ({ enabled: true, query: calls.query }),
}));

import { LEAGUE_IDS } from '../../config';
import { FIRST_MATCHUP_WEEK, LAST_MATCHUP_WEEK } from '../../matchup-week';
import { externalGameRef, providerKey } from '../shared/provider-identity';
import { createProductionLineupObservationDependencies } from './lineup-observation-composition';
import { createProductionFutureProjectionDependencies, createProductionProjectionDependencies } from './projection-composition';

beforeEach(() => { calls.query.mockClear(); vi.stubGlobal('fetch', vi.fn()); });
afterEach(() => { vi.unstubAllGlobals(); });

function expectScopedQueries(signal: AbortSignal, minimum: number): void {
  expect(calls.query.mock.calls.length).toBeGreaterThanOrEqual(minimum);
  for (const [, , options] of calls.query.mock.calls) {
    expect(options).toEqual({ signal });
  }
  expect(fetch).not.toHaveBeenCalled();
}

describe('production worker capability composition', () => {
  it('constructs independent thin capabilities without projection, calendar or full-source work', () => {
    const thin = createProductionLineupObservationDependencies();
    expect(Object.keys(thin).sort()).toEqual([
      'clock', 'idGenerator', 'leagueRegistry', 'lineupRepository', 'lineupSource', 'logger',
      'periodAuthorityReader', 'persistence', 'repository',
    ]);
    expect(Object.keys(thin.repository).sort()).toEqual(['acquireJob', 'completeJob', 'failJob']);
    expect(thin.leagueRegistry.listActiveLeagues().map((league) => ({
      key: league.key, externalId: league.leagueRef.externalId, provider: league.leagueRef.provider,
      range: league.matchupWeekRange,
    }))).toEqual(Object.entries(LEAGUE_IDS).map(([key, externalId]) => ({
      key, externalId, provider: 'sleeper', range: { firstWeek: FIRST_MATCHUP_WEEK, lastWeek: LAST_MATCHUP_WEEK },
    })));
    expect(calls.query).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('shares one cached projection feed while isolating current-only and future-only capabilities', () => {
    const current = createProductionProjectionDependencies();
    const future = createProductionFutureProjectionDependencies();
    // Per-lane telemetry wrappers delegate to the same cached feed and assessment implementation.
    expect(current.projectionFeed.assessProjectionSlate).toBe(future.projectionFeed.assessProjectionSlate);
    expect(current.projectionFeed.assessProjectionSlate).toBe(createProductionProjectionDependencies().projectionFeed.assessProjectionSlate);
    expect(calls.cacheFactory.mock.calls.filter(([, keyParts]) => Array.isArray(keyParts)
      && String(keyParts[0]).startsWith('tank01-normalized-'))).toHaveLength(2);
    expect(current).toHaveProperty('nflCalendar');
    expect(current).toHaveProperty('lineupSource');
    expect(current).toHaveProperty('persistence');
    expect(current).not.toHaveProperty('futurePersistence');
    expect(future).not.toHaveProperty('nflCalendar');
    expect(future).not.toHaveProperty('lineupSource');
    expect(future).not.toHaveProperty('persistence');
    expect(future).toHaveProperty('futurePersistence');
    expect(calls.query).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('binds all three thin persistence ports to the same operation deadline', async () => {
    const dependencies = createProductionLineupObservationDependencies();
    const controller = new AbortController();
    const scoped = dependencies.persistence.scope(controller.signal);
    const keys = dependencies.leagueRegistry.listActiveLeagues().map((league) => league.key);
    await scoped.repository.completeJob('lineup-observations:fixture', 'fixture-worker');
    await scoped.lineupRepository.readPendingFutureLineups(keys);
    await scoped.periodAuthorityReader.readAuthorities(keys, new Date('2026-09-03T12:00:00Z'), 180_000);
    expectScopedQueries(controller.signal, 3);
  });

  it('binds current persistence without leaking an identity or future scope capability', async () => {
    const dependencies = createProductionProjectionDependencies();
    const controller = new AbortController();
    const scoped = dependencies.persistence.scope(controller.signal);
    expect(Object.keys(scoped).sort()).toEqual(['lineupRepository', 'periodAuthorityReader', 'repository']);
    const keys = dependencies.leagueRegistry.listActiveLeagues().map((league) => league.key);
    await scoped.repository.completeJob('live-projection-sync:fixture', 'fixture-worker');
    await scoped.lineupRepository.readPendingCurrentLineups(keys);
    await scoped.periodAuthorityReader.readAuthorities(keys, new Date('2026-09-03T12:00:00Z'), 180_000);
    expectScopedQueries(controller.signal, 3);
  });

  it('binds all four future persistence ports including identities and authority to its deadline', async () => {
    const dependencies = createProductionFutureProjectionDependencies();
    const controller = new AbortController();
    const scoped = dependencies.futurePersistence.scope(controller.signal);
    expect(Object.keys(scoped).sort()).toEqual([
      'identityCrosswalk', 'lineupRepository', 'periodAuthorityReader', 'repository',
    ]);
    const keys = dependencies.leagueRegistry.listActiveLeagues().map((league) => league.key);
    await scoped.repository.completeJob('future-projection-sync:fixture', 'fixture-worker');
    await scoped.lineupRepository.readPendingFutureLineups(keys);
    await scoped.periodAuthorityReader.readAuthorities(keys, new Date('2026-09-03T12:00:00Z'), 180_000);
    await scoped.identityCrosswalk.resolveNflGames([{
      key: 'fixture-game', primaryRef: externalGameRef(providerKey('tank01'), 'fixture-game'), aliasRefs: [],
      period: { season: 2026, seasonType: 'regular', week: 5 }, homeTeam: 'LAC', awayTeam: 'KC',
      kickoffAt: '2026-10-04T20:25:00.000Z',
    }]);
    expectScopedQueries(controller.signal, 4);
  });
});
