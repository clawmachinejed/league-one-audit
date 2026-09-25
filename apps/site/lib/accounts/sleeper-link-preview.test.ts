import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
const sleeper = vi.hoisted(() => ({
  getSleeperUserIdentity: vi.fn(), getSleeperDiscoverySeason: vi.fn(), getSleeperUserLeagues: vi.fn(),
  getOfficialAdministrationObservation: vi.fn(), getFantasyPlayerCatalog: vi.fn(),
}));
vi.mock('../sleeper', () => sleeper);
import { previewSleeperLink } from './sleeper-link-preview';

const account = { id: '11111111-1111-4111-8111-111111111111', provider: 'sleeper' as const,
  externalId: '123456789', displayName: 'Member', username: 'member' };

beforeEach(() => {
  vi.clearAllMocks();
  sleeper.getSleeperUserIdentity.mockResolvedValue({ userId: account.externalId, username: 'renamed',
    displayName: 'Member', avatarUrl: null });
  sleeper.getSleeperDiscoverySeason.mockResolvedValue('2026');
  sleeper.getSleeperUserLeagues.mockResolvedValue([
    { id: '111', name: 'League One', season: '2026' }, { id: '222', name: 'League Two', season: '2026' },
  ]);
  sleeper.getOfficialAdministrationObservation.mockImplementation(async (leagueId: string, family: string) => ({
    payload: family === 'users' ? [{ user_id: account.externalId, metadata: { team_name: 'Questionable Decisions' } }]
      : leagueId === '111' ? [{ roster_id: 1, owner_id: account.externalId, starters: ['qb', 'wr'] },
        { roster_id: 2, owner_id: 'someone-else', starters: ['other'] }]
        : [{ roster_id: 3, owner_id: 'someone-else', starters: ['other'] }],
  }));
  sleeper.getFantasyPlayerCatalog.mockResolvedValue({ catalog: {
    qb: { full_name: 'Josh Allen' }, wr: { full_name: 'Puka Nacua' },
  }, complete: true, sourceRevision: 'fixture' });
});

describe('Sleeper profile recognition evidence', () => {
  it('uses the stable user ID and official roster owner to show only the selected profile’s team', async () => {
    const result = await previewSleeperLink(account);
    expect(result.username).toBe('renamed');
    expect(result.leagues).toEqual([{ id: '111', name: 'League One' }, { id: '222', name: 'League Two' }]);
    expect(result.teams).toEqual([{ leagueId: '111', leagueName: 'League One', rosterId: 1,
      teamName: 'Questionable Decisions', players: ['Josh Allen', 'Puka Nacua'] }]);
    expect(sleeper.getOfficialAdministrationObservation).toHaveBeenCalledWith('111', 'rosters', null, 60, expect.any(AbortSignal));
  });
  it('keeps the association preview usable when player names are unavailable', async () => {
    sleeper.getFantasyPlayerCatalog.mockRejectedValue(new Error('catalog unavailable'));
    const result = await previewSleeperLink(account);
    expect(result.teams[0]).toMatchObject({ teamName: 'Questionable Decisions', players: [] });
  });
  it('rejects invalid source IDs without provider requests', async () => {
    await expect(previewSleeperLink({ ...account, externalId: 'not-numeric' })).rejects.toThrow('Invalid');
    expect(sleeper.getSleeperUserIdentity).not.toHaveBeenCalled();
  });
});
