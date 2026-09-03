import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ProjectionLogEntry } from './projections/ports/logger';
vi.mock('server-only', () => ({}));
vi.mock('next/cache', () => ({ unstable_cache: (callback: unknown) => callback }));
import { observeProviderAdapter, recordProviderCache, sleeperEndpointFamily, startProviderHttp } from './provider-request-telemetry';
import { getRawLineupMatchups, getCurrentLeagueWeek } from './sleeper';

const logger = () => ({ write: vi.fn<(level: string, entry: ProjectionLogEntry) => void>() });
const entries = (value: ReturnType<typeof logger>) => value.write.mock.calls.map(([, entry]) => entry);
afterEach(() => { vi.unstubAllGlobals(); });

describe('safe provider request telemetry', () => {
  it('counts adapter and HTTP starts once, with outcomes and measured duration on separate completion events', async () => {
    const output = logger();
    const value = await observeProviderAdapter(output, 'sleeper', 'lineup', async () => {
      const finish = startProviderHttp('sleeper', 'weekly-matchups', 'bypass');
      finish('available');
      return 'same-value';
    });
    expect(value).toBe('same-value');
    expect(entries(output).reduce((sum, entry) => sum + (entry.providerAdapterInvocations ?? 0), 0)).toBe(1);
    expect(entries(output).reduce((sum, entry) => sum + (entry.upstreamRequests ?? 0), 0)).toBe(1);
    expect(entries(output).find((entry) => entry.requestMetric === 'http' && entry.outcome === 'completed'))
      .toMatchObject({ endpointFamily: 'weekly-matchups', providerOutcome: 'available', providerDurationMs: expect.any(Number) });
  });
  it('represents inaccessible framework cache counts as null, never inferred zero or an upstream request', async () => {
    const output = logger();
    await observeProviderAdapter(output, 'sleeper', 'league-calendar', async () => {
      recordProviderCache('sleeper', 'league', 'framework-managed');
      startProviderHttp('sleeper', 'league', 'framework-managed')('available');
    });
    expect(entries(output).find((entry) => entry.requestMetric === 'cache')).toMatchObject({ cacheHits: null, cacheMisses: null });
    expect(entries(output).find((entry) => entry.requestMetric === 'http' && entry.outcome === 'started'))
      .toMatchObject({ upstreamRequests: null, fetchInvocations: 1 });
  });
  it.each(['available', 'not-ready', 'invalid', 'unavailable'] as const)('preserves %s adapter outcome without exposing payloads', async (outcome) => {
    const output = logger();
    const result = { outcome, secret: 'raw-private-response' };
    expect(await observeProviderAdapter(output, 'sleeper', 'lineup', async () => result, (value) => value.outcome)).toBe(result);
    expect(entries(output).at(-1)?.providerOutcome).toBe(outcome);
    expect(JSON.stringify(entries(output))).not.toContain('raw-private-response');
  });
  it('contains logger failures and preserves the original provider failure without logging its message', async () => {
    const output = logger();
    const failure = new Error('Bearer api-key postgres://private');
    await expect(observeProviderAdapter(output, 'sleeper', 'lineup', async () => { throw failure; })).rejects.toBe(failure);
    expect(JSON.stringify(entries(output))).not.toMatch(/api-key|postgres|Bearer/);
    await expect(observeProviderAdapter({ write() { throw new Error('logger failed'); } }, 'sleeper', 'lineup', async () => 7)).resolves.toBe(7);
  });
  it('isolates parallel request loggers and does nothing outside an instrumented runtime context', async () => {
    const first = logger(); const second = logger();
    await Promise.all([
      observeProviderAdapter(first, 'sleeper', 'lineup', async () => { await Promise.resolve(); startProviderHttp('sleeper', 'weekly-matchups', 'bypass')('available'); }),
      observeProviderAdapter(second, 'tank01', 'game-states', async () => { await Promise.resolve(); startProviderHttp('tank01', 'game-states', 'bypass')('available'); }),
    ]);
    expect(entries(first).every((entry) => entry.provider === 'sleeper')).toBe(true);
    expect(entries(second).every((entry) => entry.provider === 'tank01')).toBe(true);
    const count = first.write.mock.calls.length + second.write.mock.calls.length;
    startProviderHttp('sleeper', 'league', 'bypass')('available');
    expect(first.write.mock.calls.length + second.write.mock.calls.length).toBe(count);
  });
  it('records one exact uncached thin matchup attempt without changing fetch options or adding requests', async () => {
    const request = vi.fn(async () => Response.json([]));
    vi.stubGlobal('fetch', request);
    const output = logger();
    await observeProviderAdapter(output, 'sleeper', 'lineup', () => getRawLineupMatchups('private-league-id', 5));
    expect(request).toHaveBeenCalledTimes(1);
    expect(request).toHaveBeenCalledWith('https://api.sleeper.app/v1/league/private-league-id/matchups/5', {
      cache: 'no-store', signal: expect.any(AbortSignal), headers: { Accept: 'application/json' },
    });
    expect(entries(output).filter((entry) => entry.upstreamRequests === 1)).toHaveLength(1);
    expect(JSON.stringify(entries(output))).not.toMatch(/private-league-id|https:|\/matchups/);
  });
  it('does not describe a cached metadata fetch as a known network request', async () => {
    const request = vi.fn(async () => new Response(null, { status: 503 }));
    vi.stubGlobal('fetch', request);
    const output = logger();
    await expect(observeProviderAdapter(output, 'sleeper', 'league-calendar', () => getCurrentLeagueWeek('private-league-id'))).rejects.toThrow();
    expect(request.mock.calls.length).toBeGreaterThan(0);
    expect(entries(output).filter((entry) => entry.requestMetric === 'http' && entry.outcome === 'started')
      .every((entry) => entry.upstreamRequests === null && entry.cacheStatus === 'framework-managed')).toBe(true);
    expect(JSON.stringify(entries(output))).not.toContain('private-league-id');
  });
  it('reduces paths containing opaque identifiers to a closed endpoint-family set', () => {
    expect(sleeperEndpointFamily('/league/private-id/matchups/5')).toBe('weekly-matchups');
    expect(sleeperEndpointFamily('/league/private-id/rosters')).toBe('rosters');
    expect(sleeperEndpointFamily('/league/private-id')).toBe('league');
    expect(sleeperEndpointFamily('/unknown/private-id')).toBe('other');
  });
});
