import { beforeEach, describe, expect, it, vi } from 'vitest';
import { LEAGUE_IDS } from '../config';
import { findCurrentLeagueKey, getCurrentLeagueId, getCurrentLeagueIds, resolveCurrentLeagueId } from './registry';

const store = vi.hoisted(() => ({ enabled: true, readEnrollment: vi.fn(), listEnrollments: vi.fn(), listEnrollmentInventory: vi.fn() }));
vi.mock('server-only', () => ({}));
vi.mock('react', () => ({ cache: (fn: unknown) => fn }));
vi.mock('./store', () => ({ getLeagueAdministrationStore: () => store }));

beforeEach(() => {
  vi.resetAllMocks(); store.enabled = true;
  store.readEnrollment.mockImplementation(async (selector: { leagueKey?: string; externalLeagueId?: string }) => {
    const key = selector.leagueKey ?? (selector.externalLeagueId === 'accepted-one' ? 'league1' : 'missing');
    const intended = { leagueId: key, leagueKey: key, provider: 'sleeper', season: 2027 };
    return key === 'league1' ? { status: 'ready', intended, enrollment: { ...intended,
      leagueSeasonId: 'season', displayName: 'League One', externalLeagueId: 'accepted-one', scoringProfileId: 'profile' } }
      : { status: 'unavailable', intended, reason: 'unregistered-season' };
  });
});

describe('scoped public registration resolution', () => {
  it('resolves a healthy annual connection without consulting the fleet', async () => {
    expect(await getCurrentLeagueId('league1')).toBe('accepted-one');
    expect(await resolveCurrentLeagueId(LEAGUE_IDS.league1)).toBe('accepted-one');
    expect(store.readEnrollment).toHaveBeenCalledWith({ leagueKey: 'league1' });
    expect(store.listEnrollments).not.toHaveBeenCalled();
    expect(store.listEnrollmentInventory).not.toHaveBeenCalled();
  });
  it('preserves healthy shell IDs and never substitutes a bootstrap ID for a failed route', async () => {
    expect(await getCurrentLeagueIds()).toEqual({ league1: 'accepted-one' });
    await expect(getCurrentLeagueId('league2')).rejects.toThrow('requested league');
  });
  it('resolves display/calendar identity by exact current provider connection', async () => {
    expect(await findCurrentLeagueKey('accepted-one')).toBe('league1');
    expect(store.readEnrollment).toHaveBeenCalledWith({ provider: 'sleeper', externalLeagueId: 'accepted-one' });
    store.readEnrollment.mockResolvedValue({ status: 'missing' });
    expect(await findCurrentLeagueKey('historical-connection')).toBeNull();
  });
  it('does not hide a database outage behind bootstrap IDs', async () => {
    store.readEnrollment.mockRejectedValue(new Error('database unavailable'));
    await expect(getCurrentLeagueId('league1')).rejects.toThrow('database unavailable');
  });
  it('retains explicit bootstrap behavior only when persistence is disabled', async () => {
    store.enabled = false;
    expect(await getCurrentLeagueIds()).toEqual(LEAGUE_IDS);
    expect(await getCurrentLeagueId('league1')).toBe(LEAGUE_IDS.league1);
    expect(store.readEnrollment).not.toHaveBeenCalled();
  });
});
