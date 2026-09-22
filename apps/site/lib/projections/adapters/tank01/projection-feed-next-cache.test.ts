import type { AsyncLocalStorage } from 'node:async_hooks';
import { createRequire } from 'node:module';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('next/cache', async () => {
  // Next installs this global in its server bootstrap. Use its real cache and
  // async stores, with only the persistence/HTTP boundaries replaced below.
  const { AsyncLocalStorage } = await import('node:async_hooks');
  Object.assign(globalThis, { AsyncLocalStorage });
  return vi.importActual('next/cache');
});

import { unstable_cache } from 'next/cache';
import { NFL_TEAMS } from '../../../nfl-teams';
import type { LeaguePeriod } from '../../domain/contracts';
import { providerKey } from '../../shared/provider-identity';
import { createCachedTank01ProjectionFeed } from './projection-feed';

const require = createRequire(import.meta.url);
type CacheValue = { kind: 'FETCH'; data: { body: string }; revalidate: number };
type CacheEntry = { value: CacheValue; isStale: boolean };
type RequestStore = { type: 'request'; phase: 'action'; url: { pathname: string; search: string } };
type WorkStore = {
  incrementalCache: ReturnType<typeof cacheHarness>['cache'];
  route: string; isStaticGeneration: false; isDraftMode: false;
  nextFetchId: number; pendingRevalidates: Record<string, Promise<unknown>>;
};
const { workAsyncStorage } = require('next/dist/server/app-render/work-async-storage.external') as {
  workAsyncStorage: AsyncLocalStorage<WorkStore>;
};
const { workUnitAsyncStorage } = require('next/dist/server/app-render/work-unit-async-storage.external') as {
  workUnitAsyncStorage: AsyncLocalStorage<RequestStore>;
};

function cacheHarness() {
  const entries = new Map<string, CacheEntry>();
  const cache = {
    isOnDemandRevalidate: false,
    generateSimpleCacheKey: async (key: string) => key,
    get: async (key: string) => entries.get(key) ?? null,
    set: async (key: string, value: CacheValue) => { entries.set(key, { value, isStale: false }); },
  };
  const start = <T>(action: () => Promise<T>) => {
    const store: WorkStore = { incrementalCache: cache, route: '/api/cron/live-projections',
      isStaticGeneration: false, isDraftMode: false, nextFetchId: 1, pendingRevalidates: {} };
    const result = workAsyncStorage.run(store, () => workUnitAsyncStorage.run({
      type: 'request', phase: 'action', url: { pathname: store.route, search: '' },
    }, action));
    return { result, settle: async () => {
      await result;
      await Promise.all(Object.values(store.pendingRevalidates));
    } };
  };
  const read = async <T>(action: () => Promise<T>) => {
    const request = start(action);
    const result = await request.result;
    await request.settle();
    return result;
  };
  const select = (namespace: string) => [...entries.entries()].filter(([key]) => key.includes(namespace));
  return { cache, entries, start, read, select,
    stale: (namespace: string) => select(namespace).forEach(([, entry]) => { entry.isStale = true; }),
    drop: (namespace: string) => select(namespace).forEach(([key]) => { entries.delete(key); }),
  };
}

const period: LeaguePeriod = { season: 2026, seasonType: 'regular', week: 1 };
const crosswalkKey = 'tank01-normalized-player-crosswalk-v1';
const captureKey = 'tank01-normalized-projection-capture-v4';
const players = NFL_TEAMS.flatMap(team => ['QB', 'RB', 'WR', 'TE'].map(pos => ({
  playerID: `tank-${team}-${pos}`, team, pos,
  Passing: { passAttempts: '30', passCompletions: '20', passYds: '250', passTD: '2', int: '1' },
  Rushing: { carries: '4', rushYds: '12', rushTD: '.2' },
  Receiving: { targets: '2', receptions: '1', recYds: '10', recTD: '.1' },
  twoPointConversion: '.05', fumblesLost: '.1',
})));
const projectionEnvelope = { statusCode: 200, body: {
  playerProjections: Object.fromEntries(players.map(row => [row.playerID, row])),
  teamDefenseProjections: Object.fromEntries(NFL_TEAMS.map(team => [team, {
    teamAbv: team, returnTD: '.1', defTD: '.2', safeties: '.05', fumbleRecoveries: '.8',
    ptsAgainst: '20', interceptions: '1', sacks: '2', blockKick: '.1',
  }])),
} };
function providerFixture() {
  const state = { clock: Date.parse('2026-09-01T12:00:00Z'), mapping: 'original', failStats: false,
    crosswalkResponse: undefined as (() => Promise<Response>) | undefined };
  const request = vi.fn(async (input: string | URL | Request) => {
    if (new URL(String(input)).pathname === '/getNFLProjections') {
      return state.failStats ? new Response(null, { status: 503 }) : Response.json(projectionEnvelope);
    }
    if (state.crosswalkResponse) return state.crosswalkResponse();
    return Response.json({ statusCode: 200, body: players.map((row, index) => ({
      playerID: row.playerID, sleeperBotID: `${state.mapping}-${index}`,
    })) });
  });
  const options = { apiKey: () => 'fixture-secret', provider: providerKey('tank01'),
    officialProvider: providerKey('sleeper'), fetch: request as typeof fetch, now: () => state.clock };
  return { state, request, options, feed: createCachedTank01ProjectionFeed(options) };
}

describe('paired projection captures with the installed Next App Router cache', () => {
  afterEach(() => { vi.restoreAllMocks(); });

  it('demonstrates why nesting the shared crosswalk lookup inside another cache would bypass its warm value', async () => {
    const harness = cacheHarness();
    let crosswalkLoads = 0;
    const inner = unstable_cache(async () => ++crosswalkLoads, ['nested-control'], { revalidate: 3600 });
    const outer = unstable_cache(async (week: number) => ({ week, value: await inner() }), ['outer-control']);
    expect(await harness.read(inner)).toBe(1);
    expect(await harness.read(() => outer(1))).toEqual({ week: 1, value: 2 });
    expect(await harness.read(() => outer(2))).toEqual({ week: 2, value: 3 });
    expect(crosswalkLoads).toBe(3);
  });

  it('shares the global crosswalk across cold periods and keeps factory keys stable', async () => {
    const harness = cacheHarness();
    const { feed, request, options } = providerFixture();
    const first = await harness.read(() => feed.getProjectionSlate(period));
    expect(first.status).toBe('available');
    const otherFeed = createCachedTank01ProjectionFeed(options);
    expect(await harness.read(() => otherFeed.getProjectionSlate(period))).toEqual(first);
    // Concurrent cold periods with a warm global crosswalk do not multiply player-list reads.
    const otherPeriods = await harness.read(() => Promise.all([2, 3].map(week => feed.getProjectionSlate({ ...period, week }))));
    expect(otherPeriods.map(result => result.status)).toEqual(['available', 'available']);
    expect(request.mock.calls.filter(([input]) => String(input).includes('/getNFLPlayerList'))).toHaveLength(1);
    expect(request.mock.calls.filter(([input]) => String(input).includes('/getNFLProjections'))).toHaveLength(3);
    expect(harness.select(captureKey)).toHaveLength(3);
    expect(harness.select(crosswalkKey)).toHaveLength(1);
    expect([...harness.entries.keys()].join('')).not.toContain('fixture-secret');
  });

  it('holds the full original slate through crosswalk SWR and adopts refreshed aliases only with a fresh stats capture', async () => {
    const harness = cacheHarness();
    const { feed, state, request } = providerFixture();
    const first = await harness.read(() => feed.getProjectionSlate(period));
    state.clock += 120_000; state.mapping = 'updated'; harness.stale(crosswalkKey);
    expect(await harness.read(() => feed.getProjectionSlate(period))).toEqual(first);
    expect(await harness.read(() => feed.getProjectionSlate(period))).toEqual(first);
    expect(request).toHaveBeenCalledTimes(3);
    state.clock += 120_000; harness.stale(captureKey);
    // Actual App Router semantics return the old pair while revalidating in the background.
    expect(await harness.read(() => feed.getProjectionSlate(period))).toEqual(first);
    const refreshed = await harness.read(() => feed.getProjectionSlate(period));
    expect(request).toHaveBeenCalledTimes(4);
    if (first.status !== 'available' || refreshed.status !== 'available') throw new Error('Expected valid fixture');
    expect(first.slate.observedAt).toBe('2026-09-01T12:00:00.000Z');
    expect(refreshed.slate.observedAt).toBe('2026-09-01T12:04:00.000Z');
    expect(refreshed.slate.sourceRevision).not.toBe(first.slate.sourceRevision);
    expect(refreshed.slate.projections.find(row => row.identity.primary.entityKind === 'player')?.identity.aliases[0].externalId)
      .toMatch(/^updated-/u);
  });

  it('preserves the original pair when background stats revalidation fails', async () => {
    const harness = cacheHarness();
    const { feed, state, request } = providerFixture();
    const first = await harness.read(() => feed.getProjectionSlate(period));
    state.clock += 120_000; state.failStats = true; harness.stale(captureKey);
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(await harness.read(() => feed.getProjectionSlate(period))).toEqual(first);
    expect(request).toHaveBeenCalledTimes(3);
    expect(log).toHaveBeenCalledTimes(1);
    expect(JSON.parse(harness.select(captureKey)[0][1].value.data.body).slate.fetchedAtMs)
      .toBe(Date.parse('2026-09-01T12:00:00Z'));
    // Next owns background retry behavior; the existing feed backoff applies to
    // foreground failures, not framework-swallowed SWR errors.
    state.failStats = false; state.clock += 120_000;
    expect(await harness.read(() => feed.getProjectionSlate(period))).toEqual(first);
    const recovered = await harness.read(() => feed.getProjectionSlate(period));
    expect(recovered.status).toBe('available');
    if (recovered.status !== 'available') throw new Error('Expected valid fixture');
    expect(recovered.slate.observedAt).toBe('2026-09-01T12:04:00.000Z');
  });

  it('does not spend stats requests on repeated stale-capture retries with an unusable cold crosswalk', async () => {
    const harness = cacheHarness();
    const { feed, state, request } = providerFixture();
    const first = await harness.read(() => feed.getProjectionSlate(period));
    harness.stale(captureKey); harness.drop(crosswalkKey);
    state.crosswalkResponse = async () => new Response(null, { status: 503 });
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    for (let attempt = 0; attempt < 2; attempt += 1) {
      state.clock += 60_000;
      expect(await harness.read(() => feed.getProjectionSlate(period))).toEqual(first);
    }
    expect(request.mock.calls.filter(([input]) => String(input).includes('/getNFLProjections'))).toHaveLength(1);
    expect(request.mock.calls.filter(([input]) => String(input).includes('/getNFLPlayerList'))).toHaveLength(3);
    expect(log).toHaveBeenCalledTimes(2);
    expect(harness.select(crosswalkKey)).toHaveLength(0);
  });

  it.each(['success', 'failure'] as const)('settles a delayed cold crosswalk %s before returning a warm pair', async outcome => {
    const harness = cacheHarness();
    const { feed, state, request } = providerFixture();
    const first = await harness.read(() => feed.getProjectionSlate(period));
    harness.drop(crosswalkKey);
    let complete!: (response: Response) => void;
    let started!: () => void;
    const loaderStarted = new Promise<void>(resolve => { started = resolve; });
    state.crosswalkResponse = () => new Promise<Response>(resolve => { complete = resolve; started(); });
    let returned = false;
    const pending = harness.start(() => feed.getProjectionSlate(period).then(result => { returned = true; return result; }));
    await loaderStarted;
    // Give the warm capture all microtasks it needs; the started cold loader is
    // deliberately unresolved and must remain in this invocation's lifetime.
    await new Promise<void>(resolve => setImmediate(resolve));
    expect(returned).toBe(false);
    complete(outcome === 'failure' ? new Response(null, { status: 503 }) : Response.json({
      statusCode: 200, body: players.map((row, index) => ({ playerID: row.playerID, sleeperBotID: `updated-${index}` })),
    }));
    expect(await pending.result).toEqual(first);
    await pending.settle();
    expect(request).toHaveBeenCalledTimes(3);
    expect(harness.select(crosswalkKey)).toHaveLength(outcome === 'failure' ? 0 : 1);
  });
});
