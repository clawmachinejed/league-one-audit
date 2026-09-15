import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProjectionCadenceInput } from '../../sleeper';

const calls = vi.hoisted(() => ({ query: vi.fn<(...parameters: unknown[]) => Promise<never[]>>(async () => []),
  cacheFactory: vi.fn((...args: unknown[]) => args[0]),
  cadence: vi.fn<(leagueId: string, evaluatedAt?: string) => Promise<ProjectionCadenceInput>>() }));
vi.mock('server-only', () => ({}));
vi.mock('next/cache', () => ({ unstable_cache: calls.cacheFactory }));
vi.mock('../../database', async (original) => ({
  ...await original<typeof import('../../database')>(),
  getDatabase: () => ({ enabled: true, query: calls.query }),
}));
vi.mock('../../sleeper', async (original) => ({
  ...await original<typeof import('../../sleeper')>(),
  getProjectionCadenceInput: calls.cadence,
}));

import { LEAGUE_IDS } from '../../config';
import { FIRST_MATCHUP_WEEK, LAST_MATCHUP_WEEK } from '../../matchup-week';
import { externalGameRef, providerKey } from '../shared/provider-identity';
import { createProductionLineupObservationDependencies } from './lineup-observation-composition';
import { createProductionProjectionDependencies } from './projection-composition';
import { createProductionFutureProjectionDependencies } from './future-projection-composition';

beforeEach(() => { calls.query.mockClear(); calls.cadence.mockReset(); vi.stubGlobal('fetch', vi.fn()); });
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); vi.restoreAllMocks(); });

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
    expect(current).not.toHaveProperty('persistence');
    expect(current).not.toHaveProperty('projectionStorage');
    expect(future).toHaveProperty('projectionStorage');
    expect(current).not.toHaveProperty('futurePersistence');
    expect(future).not.toHaveProperty('nflCalendar');
    expect(future).not.toHaveProperty('lineupSource');
    expect(future).not.toHaveProperty('persistence');
    expect(future).toHaveProperty('futurePersistence');
    expect(calls.query).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('uses one rollover evaluation instant for both leagues and a fresh instant for the next invocation', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-15T15:59:59.000Z'));
    vi.spyOn(console, 'info').mockImplementation(() => undefined);
    calls.cadence.mockImplementation(async (leagueId, evaluatedAt) => ({
      sleeperLeagueId: leagueId, season: '2026', defaultDisplayWeek: 1, week: 1,
      activeScoringWeek: 1, leagueLifecycle: 'active', leagueStatus: 'in_season', schedule: {},
      matchupShape: { rosterIds: [1], expectedRosterCount: 1, expectedStarterSlotCount: 1, starterSlots: ['QB'] },
      currentNflSeason: '2026', currentNflWeek: 1, currentNflSeasonType: 'regular',
      requestStartedAt: evaluatedAt!, requestCompletedAt: new Date().toISOString(), verifiedAt: new Date().toISOString(),
      siteWeekPolicy: { version: 'schedule-noon-eastern-v1', scheduleRevision: 'fixture-season-schedule',
        nextRolloverAt: '2026-09-15T16:00:00.000Z', evaluatedAt: evaluatedAt! },
    }));
    const first = createProductionProjectionDependencies();
    const [leagueOne, leagueTwo] = first.leagueRegistry.listActiveLeagues();
    await first.nflCalendar.getCadenceState(leagueOne);
    vi.setSystemTime(new Date('2026-09-15T16:00:01.000Z'));
    await first.nflCalendar.getCadenceState(leagueTwo);
    const next = createProductionProjectionDependencies();
    await next.nflCalendar.getCadenceState(leagueOne);
    expect(calls.cadence.mock.calls).toEqual([
      [String(leagueOne.leagueRef.externalId), '2026-09-15T15:59:59.000Z'],
      [String(leagueTwo.leagueRef.externalId), '2026-09-15T15:59:59.000Z'],
      [String(leagueOne.leagueRef.externalId), '2026-09-15T16:00:01.000Z'],
    ]);
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
