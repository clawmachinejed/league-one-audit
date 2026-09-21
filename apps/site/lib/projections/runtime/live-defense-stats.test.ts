import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { createSleeperWeeklyStatSource } from '../adapters/sleeper/weekly-stat-source';
import { createLiveDefenseReadMethods } from '../adapters/neon/live-defense-reader';
import { createFakeProjectionDatabase } from '../../projection-store-test-support';
import {
  createLiveDefenseStatCoordinator,
  type LiveDefenseStatCoordinatorDependencies,
} from './live-defense-stats';
type BudgetStore = ReturnType<LiveDefenseStatCoordinatorDependencies['store']>;

const startedAt = Date.parse('2026-09-20T19:00:00.000Z');
const period = { season: 2026, seasonType: 'regular', week: 2 } as const;
const fence = {
  jobKey: 'all-player-ingestion:sleeper', workerId: 'live-defense:test', generation: 7,
  leaseUntil: new Date(startedAt + 60_000).toISOString(), deadlineAt: new Date(startedAt + 50_000).toISOString(),
};
const raw = {
  SEA: { pts_allow: 7, pts_allow_7_13: 1, sack: 2, def_3_and_out: 1, def_4_and_stop: 2, yds_allow: 170, gp: 1, pos_rank_ppr: 4 },
  SF: { pts_allow: 0, pts_allow_0: 1, int: 1 },
  TEAM_SEA: { pts_allow: 7, sack: 2 },
  LA: { pts_allow: 10 },
  '1': { sack: 1 },
};

function setup(overrides: Partial<LiveDefenseStatCoordinatorDependencies> = {}) {
  const fetcher = vi.fn<typeof fetch>(async () => new Response(JSON.stringify(raw), { status: 200 }));
  const store = {
    enabled: true,
    acquireAllPlayerJob: vi.fn<BudgetStore['acquireAllPlayerJob']>(async () => ({ kind: 'acquired', fence })),
    markAllPlayerRequest: vi.fn<BudgetStore['markAllPlayerRequest']>(async () => true),
    finishLiveDefenseStatRequest: vi.fn<BudgetStore['finishLiveDefenseStatRequest']>(async () => true),
    readLiveDefenseStatCapture: vi.fn<NonNullable<BudgetStore['readLiveDefenseStatCapture']>>(async () => null),
  };
  const storeFactory = vi.fn<LiveDefenseStatCoordinatorDependencies['store']>(() => store);
  const enabled = vi.fn(() => true);
  const now = overrides.now ?? (() => startedAt);
  const weekly = createSleeperWeeklyStatSource({ fetch: fetcher, now: () => new Date(now()) });
  const coordinator = createLiveDefenseStatCoordinator(startedAt, {
    now, enabled, store: storeFactory, workerId: () => fence.workerId,
    loadWeeklyStats: weekly.load, ...overrides,
  });
  return { coordinator, fetcher, store, storeFactory, enabled, load: () => coordinator.source.load({ period, statisticsRequired: true }) };
}

afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); delete process.env.ALL_PLAYER_RECURRING_ENABLED; });

describe('shared live defense statistics coordinator', () => {
  it('shares one budgeted bulk response across simultaneous league loads and exposes its fenced receipt for hourly reuse', async () => {
    const test = setup();
    const [first, second, third] = await Promise.all([test.load(), test.load(), test.load()]);
    expect(first).toEqual(second);
    expect(second).toEqual(third);
    expect(first.status).toBe('available');
    expect(test.store.acquireAllPlayerJob).toHaveBeenCalledTimes(1);
    expect(test.store.markAllPlayerRequest).toHaveBeenCalledTimes(1);
    expect(test.fetcher).toHaveBeenCalledTimes(1);
    expect(test.store.readLiveDefenseStatCapture).not.toHaveBeenCalled();
    expect(test.store.markAllPlayerRequest.mock.invocationCallOrder[0]).toBeLessThan(test.fetcher.mock.invocationCallOrder[0]);
    expect(test.store.finishLiveDefenseStatRequest).toHaveBeenCalledExactlyOnceWith({
      fence, outcome: 'captured', captureReceipt: expect.objectContaining({
        period: { season: 2026, seasonType: 'reg', week: 2 }, requestGeneration: 7,
      }),
    });
    expect(test.coordinator.getCapture(period)?.capture.raw).toEqual(raw);
    expect(test.coordinator.getCapture(period)?.receipt.bodyHash).toMatch(/^sha256:[0-9a-f]{64}$/u);
  });

  it('classifies only canonical bare defenses and retains only scoring and points-allowed evidence', async () => {
    const test = setup();
    const result = await test.load();
    if (result.status !== 'available') throw new Error('Expected capture');
    expect(result.capture.entries).toEqual([
      { team: 'SEA', stats: { pts_allow: 7, pts_allow_7_13: 1, sack: 2, def_3_and_out: 1, def_4_and_stop: 2 } },
      { team: 'SF', stats: { pts_allow: 0, pts_allow_0: 1, int: 1 } },
    ]);
    expect(result.mapping.pointsAllowedBuckets.pointsAllowedZero).toBe('pts_allow_0');
    expect(JSON.stringify(result.capture)).not.toMatch(/TEAM_SEA|yds_allow|pos_rank_ppr|"gp"/u);
  });

  it('never starts another period in the same invocation, including after a successful shared capture', async () => {
    const test = setup();
    await test.load();
    const other = { ...period, week: 3 };
    expect(await test.coordinator.source.load({ period: other, statisticsRequired: true }))
      .toMatchObject({ status: 'unavailable', reason: 'period-not-selected' });
    expect(test.coordinator.getCapture(other)).toBeUndefined();
    expect(test.fetcher).toHaveBeenCalledTimes(1);
  });

  it('reuses the already validated shared response for later league processing without another deadline-bound request', async () => {
    let now = startedAt;
    const test = setup({ now: () => now });
    const first = await test.load();
    now += 42_000;
    expect(await test.load()).toEqual(first);
    expect(test.fetcher).toHaveBeenCalledTimes(1);
  });

  it('does no database or provider work for profiles without points-allowed scoring', async () => {
    const test = setup();
    expect(await test.coordinator.source.load({ period, statisticsRequired: false }))
      .toMatchObject({ status: 'unavailable', reason: 'not-required', mapping: expect.any(Object) });
    expect(test.enabled).not.toHaveBeenCalled();
    expect(test.storeFactory).not.toHaveBeenCalled();
    expect(test.fetcher).not.toHaveBeenCalled();
    // A no-work profile must not reserve the one period or suppress a league that needs the evidence.
    expect((await test.load()).status).toBe('available');
  });

  it('defaults to disabled before touching either database or provider', async () => {
    const test = setup({ enabled: () => process.env.ALL_PLAYER_RECURRING_ENABLED === 'true' });
    expect(await test.load()).toMatchObject({ status: 'unavailable', reason: 'disabled' });
    expect(test.storeFactory).not.toHaveBeenCalled();
    expect(test.fetcher).not.toHaveBeenCalled();
  });

  it.each(['busy', 'not-due'] as const)('honors the durable %s budget decision without a provider request', async (kind) => {
    const test = setup();
    test.store.acquireAllPlayerJob.mockResolvedValue({ kind, nextRequestAt: null });
    expect(await test.load()).toMatchObject({ status: 'unavailable', reason: kind });
    expect(test.store.markAllPlayerRequest).not.toHaveBeenCalled();
    expect(test.fetcher).not.toHaveBeenCalled();
    expect(test.store.finishLiveDefenseStatRequest).not.toHaveBeenCalled();
  });

  it.each(['busy', 'not-due'] as const)('reuses fresh compact evidence on %s without making a new request or hourly receipt', async (kind) => {
    const test = setup();
    test.store.acquireAllPlayerJob.mockResolvedValue({ kind, nextRequestAt: null });
    const at = new Date(startedAt - 60_000).toISOString();
    const capture = { period, requestStartedAt: at, requestCompletedAt: at, observedAt: at,
      sourceRevision: 'sha256:previous-minute', entries: [{ team: 'SEA' as const,
        stats: { pts_allow: 7, pts_allow_7_13: 1, sack: 2 } }] };
    test.store.readLiveDefenseStatCapture.mockResolvedValue(capture);
    const [first, second] = await Promise.all([test.load(), test.load()]);
    expect(first).toMatchObject({ status: 'available', capture });
    expect(second).toEqual(first);
    expect(test.store.readLiveDefenseStatCapture).toHaveBeenCalledExactlyOnceWith(period);
    expect(test.store.markAllPlayerRequest).not.toHaveBeenCalled();
    expect(test.fetcher).not.toHaveBeenCalled();
    expect(test.coordinator.getCapture(period)).toBeUndefined();
  });

  it('can reuse prior fresh evidence after durably recording a failed provider request', async () => {
    const test = setup();
    test.fetcher.mockRejectedValue(new Error('provider unavailable'));
    const at = new Date(startedAt - 65_000).toISOString();
    const capture = { period, requestStartedAt: at, requestCompletedAt: at, observedAt: at,
      sourceRevision: 'sha256:previous-minute', entries: [{ team: 'SF' as const, stats: { pts_allow_0: 1 } }] };
    test.store.readLiveDefenseStatCapture.mockResolvedValue(capture);
    expect(await test.load()).toMatchObject({ status: 'available', capture });
    expect(test.store.finishLiveDefenseStatRequest).toHaveBeenCalledExactlyOnceWith({ fence, outcome: 'provider-failed' });
    expect(test.fetcher).toHaveBeenCalledTimes(1);
    expect(test.coordinator.getCapture(period)).toBeUndefined();
  });

  it.each(['stale', 'wrong-period', 'malformed'])('keeps the scoped fallback when persisted evidence is %s', async (kind) => {
    const test = setup();
    test.store.acquireAllPlayerJob.mockResolvedValue({ kind: 'not-due', nextRequestAt: null });
    const at = new Date(startedAt - (kind === 'stale' ? 90_001 : 60_000)).toISOString();
    const fake = createFakeProjectionDatabase(() => [{ database_now_ms: startedAt, evidence: {
      version: 'defense-components-v1', status: 'available',
      period: kind === 'wrong-period' ? { ...period, week: 1 } : period,
      requestStartedAt: at, requestCompletedAt: at, observedAt: at, sourceRevision: 'sha256:previous',
      entries: [{ team: 'SEA', stats: { pts_allow: kind === 'malformed' ? '7' : 7 } }],
    } }]);
    test.store.readLiveDefenseStatCapture.mockImplementation(createLiveDefenseReadMethods(fake.database).readLiveDefenseStatCapture);
    expect(await test.load()).toMatchObject({ status: 'unavailable', reason: 'not-due' });
    expect(fake.calls).toHaveLength(1);
    expect(test.fetcher).not.toHaveBeenCalled();
    expect(test.coordinator.getCapture(period)).toBeUndefined();
  });

  it('requires a successful durable request mark before the HTTP request', async () => {
    const test = setup();
    test.store.markAllPlayerRequest.mockResolvedValue(false);
    expect(await test.load()).toMatchObject({ status: 'unavailable', reason: 'request-budget-unavailable' });
    expect(test.fetcher).not.toHaveBeenCalled();
    expect(test.store.finishLiveDefenseStatRequest).toHaveBeenCalledExactlyOnceWith({ fence, outcome: 'validation-failed' });
  });

  it('will not expose source data or an hourly receipt when completion loses ownership', async () => {
    const test = setup();
    test.store.finishLiveDefenseStatRequest.mockResolvedValue(false);
    expect(await test.load()).toMatchObject({ status: 'unavailable', reason: 'lease-lost' });
    expect(test.coordinator.getCapture(period)).toBeUndefined();
    await test.load();
    expect(test.fetcher).toHaveBeenCalledTimes(1);
  });

  it('records a sanitized provider failure and consumes no additional request on subsequent loads', async () => {
    const test = setup();
    test.fetcher.mockRejectedValue(new Error('credential=must-not-escape'));
    const result = await test.load();
    expect(result).toMatchObject({ status: 'unavailable', reason: 'provider-failed' });
    expect(test.store.finishLiveDefenseStatRequest).toHaveBeenCalledExactlyOnceWith({ fence, outcome: 'provider-failed' });
    expect(JSON.stringify(result)).not.toContain('credential');
    expect(test.coordinator.getCapture(period)).toBeUndefined();
    await test.load();
    expect(test.fetcher).toHaveBeenCalledTimes(1);
  });

  it.each([{}, [], { SEA: { pts_allow: '7' } }])('rejects malformed or empty response evidence without creating an empty-defense zero %#', async (body) => {
    const test = setup();
    test.fetcher.mockResolvedValue(new Response(JSON.stringify(body), { status: 200 }));
    expect(await test.load()).toMatchObject({ status: 'unavailable', reason: 'validation-failed' });
    expect(test.store.finishLiveDefenseStatRequest).toHaveBeenCalledExactlyOnceWith({ fence, outcome: 'validation-failed' });
    expect(test.coordinator.getCapture(period)).toBeUndefined();
  });

  it('times out even if a provider ignores cancellation and preserves a fresh signal for durable cleanup', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(startedAt);
    let sourceSignal: AbortSignal | undefined;
    const test = setup({ now: Date.now, loadWeeklyStats: async ({ signal }) => {
      sourceSignal = signal;
      return new Promise(() => {});
    } });
    const pending = test.load();
    await vi.advanceTimersByTimeAsync(10_001);
    expect(await pending).toMatchObject({ status: 'unavailable', reason: 'timeout' });
    expect(sourceSignal?.aborted).toBe(true);
    expect(test.store.finishLiveDefenseStatRequest).toHaveBeenCalledExactlyOnceWith({ fence, outcome: 'timeout' });
    expect(test.storeFactory.mock.calls.at(-1)?.[0]?.aborted).toBe(false);
    expect(test.coordinator.getCapture(period)).toBeUndefined();
  });

  it('refuses late requests and invalid periods before any database or HTTP operation', async () => {
    const late = setup({ now: () => startedAt + 40_000 });
    expect(await late.load()).toMatchObject({ status: 'unavailable', reason: 'timeout' });
    expect(late.storeFactory).not.toHaveBeenCalled();
    expect(late.fetcher).not.toHaveBeenCalled();
    const invalid = setup();
    expect(await invalid.coordinator.source.load({ period: { ...period, seasonType: 'postseason' }, statisticsRequired: true }))
      .toMatchObject({ status: 'unavailable', reason: 'invalid-period' });
    expect(invalid.storeFactory).not.toHaveBeenCalled();
  });

  it('caps provider work at 40 seconds of invocation time, leaving at least 15 seconds after cleanup', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(startedAt + 38_000);
    const test = setup({ now: Date.now, loadWeeklyStats: async () => new Promise(() => {}) });
    const pending = test.load();
    await vi.advanceTimersByTimeAsync(2_001);
    expect(await pending).toMatchObject({ status: 'unavailable', reason: 'timeout' });
    expect(test.store.finishLiveDefenseStatRequest).toHaveBeenCalledExactlyOnceWith({ fence, outcome: 'timeout' });
    expect(test.store.acquireAllPlayerJob.mock.calls[0]?.[0]).toMatchObject({
      leaseSeconds: 60, deadlineAt: new Date(startedAt + 50_000).toISOString(),
    });
  });
});
