import { beforeEach, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
vi.mock('react', () => ({ cache: (fn: unknown) => fn }));
const mocks = vi.hoisted(() => ({ id: vi.fn(), source: vi.fn(), official: vi.fn() }));
vi.mock('./league-administration/registry', () => ({ getCurrentLeagueId: mocks.id }));
vi.mock('./league-administration/store', () => ({ getLeagueAdministrationStore: () => ({ readSourceByConnection: mocks.source }) }));
vi.mock('./sleeper', () => ({ getOfficialAdministrationObservation: mocks.official }));
import { getLeagueSite } from './league-sites';
beforeEach(() => { vi.resetAllMocks(); mocks.id.mockResolvedValue('123'); });
it('uses the exact registered league artwork without confusing it with site branding', async () => {
  mocks.source.mockResolvedValue({ status: 'available', envelope: { payload: { name: 'Imported league', avatar: 'abc_123' } } });
  expect(await getLeagueSite('sleeper-123')).toMatchObject({ key: 'sleeper-123', prefix: '/leagues/sleeper-123', logo: 'https://sleepercdn.com/avatars/abc_123' });
  expect(mocks.source).toHaveBeenCalledWith({ provider: 'sleeper', externalLeagueId: '123', family: 'league', week: null });
  expect(mocks.official).not.toHaveBeenCalled();
});
it('uses official artwork when accepted metadata is missing', async () => {
  mocks.source.mockResolvedValue({ status: 'missing' }); mocks.official.mockResolvedValue({ payload: { name: 'League One', avatar: 'official' } });
  expect((await getLeagueSite('league1')).logo).toBe('https://sleepercdn.com/avatars/official');
  expect(mocks.official).toHaveBeenCalledWith('123', 'league', null, 300);
});
it('uses a generic fallback for absent or unsafe artwork', async () => {
  mocks.source.mockResolvedValue({ status: 'available', envelope: { payload: { name: 'League', avatar: 'https://untrusted.test/image' } } });
  expect((await getLeagueSite('league1')).logo).toBe('/league-placeholder.svg');
});
