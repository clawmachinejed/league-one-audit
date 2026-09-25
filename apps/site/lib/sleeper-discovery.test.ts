import { afterEach, describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
vi.mock('next/cache', () => ({ unstable_cache: <T,>(fn: T) => fn }));
import { getSleeperDiscoverySeason, getSleeperUserLeagues } from './sleeper';

const userId = '79600000000000000001';
const league = { league_id: '12900000000000000001', name: 'Public league', sport: 'nfl', season: '2026' };
afterEach(() => vi.unstubAllGlobals());

describe('Sleeper account discovery metadata', () => {
  it('uses league_season during an offseason rollover, independently of current scoring season', async () => {
    const request = vi.fn<typeof fetch>(async () => Response.json({ season: '2025', league_season: '2026', season_type: 'off' }));
    vi.stubGlobal('fetch', request);
    expect(await getSleeperDiscoverySeason()).toBe('2026');
    expect(request.mock.calls[0][0]).toBe('https://api.sleeper.app/v1/state/nfl');
  });
  it.each([null, {}, { season: '2026' }, { season: '2026', league_season: 2026 },
    { season: 'wrong', league_season: '2026' }, { season: '2026', league_season: '../2026' }])(
    'refuses unproved league-season state %j without substituting the system year', async state => {
      vi.stubGlobal('fetch', vi.fn(async () => Response.json(state)));
      await expect(getSleeperDiscoverySeason()).rejects.toThrow();
    });
  it('reads only the fixed public user-leagues endpoint, retaining opaque numeric strings and shared caching', async () => {
    const request = vi.fn<typeof fetch>(async () => Response.json([{ ...league, settings: { unsupported_future_format: true } }]));
    vi.stubGlobal('fetch', request);
    const controller = new AbortController();
    expect(await getSleeperUserLeagues(userId, '2026', controller.signal)).toEqual([
      { id: league.league_id, name: league.name, season: '2026', avatar: null, capabilities: expect.objectContaining({ status: 'unverified' }) },
    ]);
    expect(request).toHaveBeenCalledTimes(1);
    expect(request.mock.calls[0][0]).toBe(`https://api.sleeper.app/v1/user/${userId}/leagues/nfl/2026`);
    expect(request.mock.calls[0][1]).toMatchObject({ next: { revalidate: 60 }, headers: { Accept: 'application/json' } });
    controller.abort();
    expect(request.mock.calls[0][1]?.signal?.aborted).toBe(true);
  });
  it.each(['../another-user', '0', '01', '12?query', '1'.repeat(33)])('rejects unsafe user ID %s before fetching', async id => {
    const request = vi.fn();
    vi.stubGlobal('fetch', request);
    await expect(getSleeperUserLeagues(id, '2026')).rejects.toThrow();
    expect(request).not.toHaveBeenCalled();
  });
  it.each([null, {}, [{ ...league, league_id: 123 }], [{ ...league, league_id: 'https://untrusted.test' }],
    [{ ...league, name: '' }], [{ ...league, sport: 'nba' }], [{ ...league, season: '2025' }],
    [{ ...league, season: 2026 }], [{ ...league, name: 'x'.repeat(201) }]])(
    'rejects malformed or wrong-period responses atomically %j', async rows => {
      vi.stubGlobal('fetch', vi.fn(async () => Response.json(rows)));
      await expect(getSleeperUserLeagues(userId, '2026')).rejects.toThrow();
    });
  it('fails an oversized result explicitly and never silently truncates it', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json(Array.from({ length: 1_001 }, () => league))));
    await expect(getSleeperUserLeagues(userId, '2026')).rejects.toThrow();
  });
  it('deduplicates identical entries but rejects conflicting identities', async () => {
    const request = vi.fn()
      .mockResolvedValueOnce(Response.json([league, league]))
      .mockResolvedValueOnce(Response.json([league, { ...league, name: 'Conflicting name' }]));
    vi.stubGlobal('fetch', request);
    expect(await getSleeperUserLeagues(userId, '2026')).toHaveLength(1);
    await expect(getSleeperUserLeagues(userId, '2026')).rejects.toThrow();
  });
  it('does no work when already cancelled', async () => {
    const request = vi.fn();
    vi.stubGlobal('fetch', request);
    await expect(getSleeperDiscoverySeason(AbortSignal.abort())).rejects.toThrow();
    await expect(getSleeperUserLeagues(userId, '2026', AbortSignal.abort())).rejects.toThrow();
    expect(request).not.toHaveBeenCalled();
  });
  it.each([12, null])('keeps a discoverable league when complete or incomplete settings conflict (%s teams)', async total_rosters => {
    const first = { ...league, season_type: 'regular', total_rosters, roster_positions: ['QB', 'BN'],
      scoring_settings: { rec: 0.5 }, settings: { type: 0, max_subs: 0, start_week: 1, best_ball: 0, league_average_match: 0, playoff_week_start: 15 } };
    vi.stubGlobal('fetch', vi.fn(async () => Response.json([first, { ...first, scoring_settings: { rec: 1 } }, first])));
    const result = await getSleeperUserLeagues(userId, '2026');
    expect(result).toHaveLength(1);
    expect(result[0].capabilities).toMatchObject({ status: 'unverified', configurationRevision: null });
    expect(result[0].capabilities?.features.every(item => item.status === 'unverified')).toBe(true);
  });
});
