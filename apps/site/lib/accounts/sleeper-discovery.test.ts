import { afterEach, describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
vi.mock('../sleeper', () => ({ getSleeperDiscoverySeason: vi.fn(), getSleeperUserLeagues: vi.fn() }));
import { getSleeperDiscoverySeason, getSleeperUserLeagues } from '../sleeper';
import { discoverSleeperLeagues } from './sleeper-discovery';
import type { LinkedSleeperProfile } from './contracts';

function profile(id: number): LinkedSleeperProfile {
  return { linkId: `link-${id}`, revision: 1, sourceManagerAccountId: `manager-${id}`,
    externalId: String(id), displayName: `Profile ${id}` };
}
const one = { id: '12000000000000000001', name: 'First league', season: '2026' };
afterEach(() => vi.resetAllMocks());

describe('private account discovery orchestration', () => {
  it('does not call Sleeper without any association', async () => {
    expect(await discoverSleeperLeagues([])).toEqual({ season: null, status: 'complete', profiles: [], leagues: [] });
    expect(getSleeperDiscoverySeason).not.toHaveBeenCalled();
    expect(getSleeperUserLeagues).not.toHaveBeenCalled();
  });
  it('deduplicates leagues across associations and constructs only fixed-origin links', async () => {
    vi.mocked(getSleeperDiscoverySeason).mockResolvedValue('2026');
    vi.mocked(getSleeperUserLeagues).mockResolvedValue([one]);
    const result = await discoverSleeperLeagues([profile(1), profile(2)]);
    expect(result.status).toBe('complete');
    expect(result.leagues).toEqual([{ ...one, url: `https://sleeper.com/leagues/${one.id}`,
      sourceManagerAccountIds: ['manager-1', 'manager-2'] }]);
    expect(getSleeperUserLeagues).toHaveBeenCalledWith('1', '2026', expect.any(AbortSignal));
  });
  it('retains successful profiles and marks failed profiles explicitly', async () => {
    vi.mocked(getSleeperDiscoverySeason).mockResolvedValue('2026');
    vi.mocked(getSleeperUserLeagues).mockResolvedValueOnce([one]).mockRejectedValueOnce(new Error('private raw failure'));
    const result = await discoverSleeperLeagues([profile(1), profile(2)]);
    expect(result.status).toBe('partial');
    expect(result.profiles.map(value => value.status)).toEqual(['complete', 'unavailable']);
    expect(result.leagues).toHaveLength(1);
    expect(JSON.stringify(result)).not.toContain('private raw failure');
  });
  it('distinguishes an empty successful list from total provider failure', async () => {
    vi.mocked(getSleeperDiscoverySeason).mockResolvedValue('2026');
    vi.mocked(getSleeperUserLeagues).mockResolvedValueOnce([]).mockRejectedValueOnce(new Error());
    expect((await discoverSleeperLeagues([profile(1)])).status).toBe('complete');
    expect((await discoverSleeperLeagues([profile(1)])).status).toBe('unavailable');
  });
  it('fails discovery honestly without an authoritative season and never requests a user list', async () => {
    vi.mocked(getSleeperDiscoverySeason).mockRejectedValue(new Error());
    expect(await discoverSleeperLeagues([profile(1)])).toMatchObject({ season: null, status: 'unavailable', leagues: [] });
    expect(getSleeperUserLeagues).not.toHaveBeenCalled();
  });
  it('rejects contradictory league metadata across associated profiles', async () => {
    vi.mocked(getSleeperDiscoverySeason).mockResolvedValue('2026');
    vi.mocked(getSleeperUserLeagues).mockResolvedValueOnce([one]).mockResolvedValueOnce([{ ...one, name: 'Different' }]);
    expect(await discoverSleeperLeagues([profile(1), profile(2)])).toMatchObject({ status: 'unavailable', leagues: [] });
  });
  it('caps concurrency at four within the twenty-association bound', async () => {
    vi.mocked(getSleeperDiscoverySeason).mockResolvedValue('2026');
    let active = 0; let peak = 0;
    vi.mocked(getSleeperUserLeagues).mockImplementation(async () => {
      active += 1; peak = Math.max(peak, active);
      await Promise.resolve();
      active -= 1;
      return [];
    });
    expect((await discoverSleeperLeagues(Array.from({ length: 20 }, (_, index) => profile(index + 1)))).status).toBe('complete');
    expect(peak).toBe(4);
    expect(getSleeperUserLeagues).toHaveBeenCalledTimes(20);
    await expect(discoverSleeperLeagues(Array.from({ length: 21 }, (_, index) => profile(index + 1)))).rejects.toThrow();
    expect(getSleeperUserLeagues).toHaveBeenCalledTimes(20);
  });
  it('propagates request cancellation without returning a successful stale mapping', async () => {
    vi.mocked(getSleeperDiscoverySeason).mockResolvedValue('2026');
    const controller = new AbortController();
    vi.mocked(getSleeperUserLeagues).mockImplementation(async (_id, _season, signal) => {
      controller.abort();
      signal?.throwIfAborted();
      return [];
    });
    await expect(discoverSleeperLeagues([profile(1)], controller.signal)).rejects.toThrow();
  });
});
