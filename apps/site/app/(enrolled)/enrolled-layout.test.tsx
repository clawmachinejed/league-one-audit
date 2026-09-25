import { beforeEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ id: vi.fn(), site: vi.fn(), sites: vi.fn() }));
vi.mock('server-only', () => ({}));
vi.mock('next/navigation', () => ({ notFound: () => { throw new Error('not found'); } }));
vi.mock('@/components/league-shell', () => ({ AppShell: () => null }));
vi.mock('@/lib/accounts/auth', () => ({ getAccountAuthAvailability: () => 'disabled' }));
vi.mock('@/lib/league-administration/registry', () => ({ getCurrentLeagueId: mocks.id }));
vi.mock('@/lib/league-sites', () => ({ getLeagueSite: mocks.site, getPublicLeagueSites: mocks.sites }));
import EnrolledLayout from './leagues/[league]/layout';
beforeEach(() => { vi.resetAllMocks(); mocks.id.mockResolvedValue('123'); mocks.site.mockRejectedValue(new Error('Artwork unavailable')); mocks.sites.mockResolvedValue([]); });
it('keeps a registered league reachable when public artwork is unavailable', async () => {
  const result = await EnrolledLayout({ children: <p>League content</p>, params: Promise.resolve({ league: 'sleeper-123' }) });
  expect(result.props.leagueIds).toEqual({ 'sleeper-123': '123' });
  expect(result.props.activeSite).toMatchObject({ key: 'sleeper-123', prefix: '/leagues/sleeper-123', logo: '/league-placeholder.svg' });
});
it('never invents a source connection for an unregistered league', async () => {
  mocks.id.mockRejectedValue(new Error('Unregistered'));
  await expect(EnrolledLayout({ children: null, params: Promise.resolve({ league: 'sleeper-123' }) })).rejects.toThrow('not found');
});
