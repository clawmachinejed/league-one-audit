import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
const mocks = vi.hoisted(() => ({
  identity: vi.fn(), season: vi.fn(), leagues: vi.fn(), roster: vi.fn(), documents: vi.fn(),
  enrollment: vi.fn(), query: vi.fn(), register: vi.fn(), claim: vi.fn(), complete: vi.fn(), fail: vi.fn(),
  capture: vi.fn(), capabilities: vi.fn(),
}));
vi.mock('../sleeper', () => ({ getSleeperUserIdentity: mocks.identity, getSleeperDiscoverySeason: mocks.season,
  getSleeperUserLeagues: mocks.leagues, getOfficialLeagueAdministration: mocks.documents }));
vi.mock('./sleeper-link-preview', () => ({ matchingRoster: mocks.roster }));
vi.mock('../database', () => ({ getDatabase: () => ({ enabled: true, query: mocks.query }), withDatabaseAbortSignal: (db: unknown) => db }));
vi.mock('../projection-store', () => ({ createProjectionStore: () => ({ registerLeagueSeason: mocks.register,
  acquireJob: mocks.claim, completeJob: mocks.complete, failJob: mocks.fail }) }));
vi.mock('../league-administration/store', async importOriginal => ({ ...await importOriginal<typeof import('../league-administration/store')>(),
  getLeagueAdministrationStore: () => ({ readEnrollment: mocks.enrollment }) }));
vi.mock('../league-administration/runtime', () => ({ recordCapturedAdministration: mocks.capture }));
vi.mock('../league-capabilities', () => ({ assessSleeperLeagueCapabilities: mocks.capabilities }));
import { importSleeperTeam, previewSleeperUsername } from './onboarding';
const signal = () => new AbortController().signal;
beforeEach(() => {
  vi.resetAllMocks();
  mocks.identity.mockResolvedValue({ userId: '123', username: 'member', displayName: 'Member', avatarUrl: null });
  mocks.season.mockResolvedValue('2026');
  mocks.leagues.mockResolvedValue([{ id: '456', name: 'Other league', season: '2026', avatar: 'official_icon', capabilities: { status: 'limited' } }]);
  mocks.roster.mockResolvedValue({ rosterId: 2, teamName: 'Recognizable team' });
  mocks.enrollment.mockResolvedValue({ status: 'missing' });
  mocks.claim.mockResolvedValue({ kind: 'acquired', attempt: 1 });
  mocks.complete.mockResolvedValue(true); mocks.fail.mockResolvedValue(true);
  mocks.register.mockResolvedValue({ kind: 'stored', value: { leagueId: 'permanent', leagueSeasonId: 'season', scoringProfileId: 'profile' } });
  mocks.query.mockResolvedValue([]);
  mocks.capabilities.mockReturnValue({ status: 'limited' });
  mocks.documents.mockResolvedValue([
    { family: 'league', payload: { league_id: '456', season: '2026', name: 'Other league', scoring_settings: { pass_yd: .04 } } },
    { family: 'rosters', payload: [{ roster_id: 2, owner_id: '123' }] }, { family: 'users', payload: [] },
  ]);
  mocks.capture.mockResolvedValue({ status: 'stored' });
});
describe('account-confirmed league onboarding', () => {
  it('resolves a username to a stable ID and shows the official league icon and team', async () => {
    const result = await previewSleeperUsername('member', signal());
    expect(mocks.leagues).toHaveBeenCalledWith('123', '2026', expect.any(AbortSignal));
    expect(result.teams[0]).toMatchObject({ leagueId: '456', rosterId: 2, status: 'ready', logo: 'https://sleepercdn.com/avatars/official_icon' });
    expect(mocks.register).not.toHaveBeenCalled();
  });
  it('keeps unsupported and unavailable discoveries visible without admitting collection', async () => {
    mocks.leagues.mockResolvedValue([{ id: '456', name: 'Unsupported', season: '2026', capabilities: { status: 'unsupported' } }]);
    expect((await previewSleeperUsername('member', signal())).teams[0].status).toBe('unsupported');
    mocks.roster.mockRejectedValue(new Error('Unavailable'));
    expect((await previewSleeperUsername('member', signal())).teams[0].status).toBe('unavailable');
    expect(mocks.register).not.toHaveBeenCalled();
  });
  it('refuses an oversized discovery instead of silently dropping leagues', async () => {
    mocks.leagues.mockResolvedValue(Array.from({ length: 21 }, (_, id) => ({ id: String(id + 1) })));
    await expect(previewSleeperUsername('member', signal())).rejects.toThrow('20');
    expect(mocks.roster).not.toHaveBeenCalled();
  });
  it('reuses an enrolled canonical league without registration or collection writes', async () => {
    mocks.enrollment.mockResolvedValue({ status: 'ready', enrollment: { leagueKey: 'league1', season: 2026 } });
    await importSleeperTeam('123', '456', 2, signal());
    expect(mocks.register).not.toHaveBeenCalled(); expect(mocks.claim).not.toHaveBeenCalled(); expect(mocks.capture).not.toHaveBeenCalled();
  });
  it('registers once, captures through the shared writer, then activates', async () => {
    await importSleeperTeam('123', '456', 2, signal());
    expect(mocks.register).toHaveBeenCalledWith({ leagueKey: 'sleeper-456', leagueName: 'Other league',
      season: 2026, sleeperLeagueId: '456', scoringRules: { pass_yd: .04 } });
    expect(mocks.capture).toHaveBeenCalledWith({ leagueKey: 'sleeper-456', provider: 'sleeper', externalLeagueId: '456', season: 2026 },
      expect.any(Array), expect.objectContaining({ signal: expect.any(AbortSignal), fence: expect.objectContaining({ generation: 1 }) }));
    const activated = mocks.query.mock.calls.find(call => String(call[0]).includes('activate_account'));
    expect(activated?.[1]).toEqual(['sleeper-456', 2026, '456']);
    expect(mocks.query.mock.invocationCallOrder.at(-1)).toBeGreaterThan(mocks.capture.mock.invocationCallOrder[0]);
  });
  it('refuses a client-forged team before database writes', async () => {
    await expect(importSleeperTeam('123', '456', 9, signal())).rejects.toThrow('membership');
    expect(mocks.register).not.toHaveBeenCalled();
  });
  it('rechecks membership in the fresh documents before registration', async () => {
    mocks.documents.mockResolvedValue([
      { family: 'league', payload: { league_id: '456', season: '2026' } },
      { family: 'rosters', payload: [{ roster_id: 2, owner_id: 'someone-else' }] },
    ]);
    await expect(importSleeperTeam('123', '456', 2, signal())).rejects.toThrow('membership changed');
    expect(mocks.register).not.toHaveBeenCalled();
  });
  it('leaves a failed capture inactive and records a bounded failure', async () => {
    mocks.capture.mockResolvedValue({ status: 'unavailable' });
    await expect(importSleeperTeam('123', '456', 2, signal())).rejects.toThrow();
    expect(mocks.query.mock.calls.some(call => String(call[0]).includes('activate_account'))).toBe(false);
    expect(mocks.fail).toHaveBeenCalledWith('account-enrollment:456', expect.any(String), 'Account enrollment incomplete');
  });
  it('explains pilot capacity without retrying or capturing more provider data', async () => {
    mocks.query.mockImplementation(async statement => {
      if (String(statement).includes('prepare_account')) throw new Error('account enrollment capacity reached');
      return [];
    });
    await expect(importSleeperTeam('123', '456', 2, signal())).rejects.toThrow('pilot has reached its league limit');
    expect(mocks.capture).not.toHaveBeenCalled();
  });
  it('refuses a conflicting permanent source identity without remapping it', async () => {
    mocks.query.mockResolvedValue([{ league_key: 'league1' }]);
    await expect(importSleeperTeam('123', '456', 2, signal())).rejects.toThrow('different permanent');
    expect(mocks.register).not.toHaveBeenCalled();
  });
  it('does not admit unsupported settings or a competing import', async () => {
    mocks.capabilities.mockReturnValue({ status: 'unverified' });
    await expect(importSleeperTeam('123', '456', 2, signal())).rejects.toThrow('not supported');
    expect(mocks.register).not.toHaveBeenCalled();
    mocks.claim.mockResolvedValue({ kind: 'busy' });
    await expect(importSleeperTeam('123', '456', 2, signal())).rejects.toThrow('being imported');
  });
});
