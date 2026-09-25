import { beforeEach, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
vi.mock('next/headers', () => ({ headers: vi.fn() }));
const mocks = vi.hoisted(() => ({ season: vi.fn(), source: vi.fn(), standings: vi.fn(), id: vi.fn(), site: vi.fn() }));
vi.mock('../sleeper', () => ({ getSleeperDiscoverySeason: mocks.season, getStandings: mocks.standings }));
vi.mock('../league-sites', () => ({ getLeagueSite: mocks.site }));
vi.mock('../league-matchups-source', () => ({ loadLeagueMatchups: mocks.source }));
vi.mock('../league-administration/registry', () => ({ getCurrentLeagueId: mocks.id }));
import { loadAccountFantasy } from './fantasy';
import { buildAccountView } from './library';
const now = new Date().toISOString();
function account() {
  return buildAccountView({ profile: { id: 'actor', displayName: 'Member', revision: 1 },
    links: [{ id: 'link', sourceManagerAccountId: 'manager', provider: 'sleeper', displayName: 'Member', assurance: 'user_asserted', revision: 1 }],
    saved: [], providerAccounts: [], groups: [{ id: 'pair', name: 'Pair', leagueIds: ['league1', 'league2'] }],
    sources: ['league1', 'league2', 'sleeper-456'].map(key => ({ id: key, key, name: key, season: 2026, valid: true,
      checkedAt: now, verifiedAt: now, observedAt: now, memberships: key === 'league2' ? [] : [
        { teamId: key + '-team', rosterId: '2', sourceManagerAccountId: 'manager', role: 'owner' },
      ] })),
  });
}
beforeEach(() => {
  vi.resetAllMocks(); mocks.season.mockResolvedValue('2026'); mocks.id.mockImplementation(async key => key + '-id');
  mocks.site.mockRejectedValue(new Error('Artwork unavailable')); mocks.standings.mockResolvedValue(null);
  mocks.source.mockResolvedValue({ data: { league: { season: '2026' }, teams: [{ id: 2 }] } });
});
it('automatically includes participating enrolled leagues and excludes linked-only leagues', async () => {
  const result = await loadAccountFantasy(account(), 4);
  expect(result.map(member => member.entry.site.key)).toEqual(expect.arrayContaining(['league1', 'sleeper-456']));
  expect(result).toHaveLength(2);
  expect(result.every(member => member.teamIds[0] === 2)).toBe(true);
  expect(mocks.source).toHaveBeenCalledWith('sleeper-456-id', 'sleeper-456', 4);
});
it('isolates a league failure while retaining its account selection', async () => {
  mocks.source.mockImplementation(async (_id, key) => {
    if (key === 'sleeper-456') throw new Error('Unavailable');
    return { data: { league: { season: '2026' }, teams: [{ id: 2 }] } };
  });
  const result = await loadAccountFantasy(account());
  expect(result.find(member => member.entry.site.key === 'sleeper-456')).toMatchObject({ teamIds: [2], entry: { status: 'unavailable' } });
  expect(result.find(member => member.entry.site.key === 'league1')?.entry.status).toBe('available');
});
it('does not carry previous-season participation into a new season', async () => {
  mocks.season.mockResolvedValue('2027');
  expect(await loadAccountFantasy(account())).toEqual([]);
  expect(mocks.source).not.toHaveBeenCalled();
});
