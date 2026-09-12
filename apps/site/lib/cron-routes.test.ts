import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';

const runners = vi.hoisted(() => ({
  current: vi.fn(),
  lineup: vi.fn(),
  future: vi.fn(),
  allPlayer: vi.fn(),
  after: vi.fn(),
}));
vi.mock('server-only', () => ({}));
vi.mock('next/server', () => ({ after: runners.after }));
vi.mock('./live-projection-worker', () => ({ runLiveProjectionSync: runners.current }));
vi.mock('./lineup-observation-worker', () => ({ runLineupObservationSync: runners.lineup }));
vi.mock('./future-projection-worker', () => ({ runFutureProjectionSync: runners.future }));
vi.mock('./projections/runtime/all-player-composition', () => ({
  runProductionAllPlayerRecurring: runners.allPlayer,
}));

import * as current from '../app/api/cron/live-projections/route';
import * as lineup from '../app/api/cron/lineup-observations/route';
import * as future from '../app/api/cron/future-projections/route';

afterEach(() => { vi.unstubAllEnvs(); vi.resetAllMocks(); });

describe('production cron route wiring', () => {
  it('schedules each independent lane once per minute with the unchanged execution limit', () => {
    const config = JSON.parse(readFileSync(new URL('../vercel.json', import.meta.url), 'utf8'));
    expect(config.crons).toEqual([
      { path: '/api/cron/live-projections', schedule: '* * * * *' },
      { path: '/api/cron/lineup-observations', schedule: '* * * * *' },
      { path: '/api/cron/future-projections', schedule: '* * * * *' },
    ]);
    for (const route of [current, lineup, future]) {
      expect(route.dynamic).toBe('force-dynamic');
      expect(route.runtime).toBe('nodejs');
      expect(route.maxDuration).toBe(60);
    }
  });

  it('routes each request to only its own worker and preserves current-only force support', async () => {
    vi.stubEnv('CRON_SECRET', 'route-secret');
    runners.current.mockResolvedValue({ status: 'skipped', reason: 'idle', cadence: 'idle' });
    runners.lineup.mockResolvedValue({ status: 'skipped', reason: 'idle' });
    runners.future.mockResolvedValue({ status: 'skipped', reason: 'idle' });
    for (const [name, route] of [['live-projections', current], ['lineup-observations', lineup], ['future-projections', future]] as const) {
      const response = await route.GET(new Request(`https://example.test/api/cron/${name}?force=1`, {
        headers: { authorization: 'Bearer route-secret' },
      }));
      expect(response.status).toBe(200);
      expect(response.headers.get('Cache-Control')).toBe('no-store');
    }
    expect(runners.current.mock.calls).toEqual([[{ force: true }]]);
    expect(runners.lineup.mock.calls).toEqual([[]]);
    expect(runners.future.mock.calls).toEqual([[]]);
    expect(runners.after).not.toHaveBeenCalled();
    expect(runners.allPlayer).not.toHaveBeenCalled();
  });

  it('runs the all-player lane after the authorized normal response without blocking matchups', async () => {
    vi.stubEnv('CRON_SECRET', 'route-secret');
    runners.current.mockResolvedValue({
      status: 'completed', cadence: 'live', publishedLeagues: 2,
      failedLeagues: 0, providerGroups: 1,
    });
    runners.allPlayer.mockRejectedValueOnce(new Error('all-player unavailable'));
    const response = await current.GET(new Request(
      'https://example.test/api/cron/live-projections',
      { headers: { authorization: 'Bearer route-secret' } },
    ));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      status: 'completed', publishedLeagues: 2,
    });
    expect(runners.after).toHaveBeenCalledOnce();
    expect(runners.allPlayer).not.toHaveBeenCalled();
    const callback = runners.after.mock.calls[0][0] as () => Promise<void>;
    await expect(callback()).resolves.toBeUndefined();
    expect(runners.allPlayer).toHaveBeenCalledOnce();
  });

  it('does not schedule the all-player lane for unauthorized requests', async () => {
    vi.stubEnv('CRON_SECRET', 'route-secret');
    const response = await current.GET(new Request(
      'https://example.test/api/cron/live-projections',
    ));
    expect(response.status).toBe(401);
    expect(runners.after).not.toHaveBeenCalled();
  });
});
