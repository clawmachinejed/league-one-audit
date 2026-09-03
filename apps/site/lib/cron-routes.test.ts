import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';

const runners = vi.hoisted(() => ({ current: vi.fn(), lineup: vi.fn(), future: vi.fn() }));
vi.mock('server-only', () => ({}));
vi.mock('./live-projection-worker', () => ({ runLiveProjectionSync: runners.current }));
vi.mock('./lineup-observation-worker', () => ({ runLineupObservationSync: runners.lineup }));
vi.mock('./future-projection-worker', () => ({ runFutureProjectionSync: runners.future }));

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
  });
});
