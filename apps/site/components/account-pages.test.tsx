import type { ComponentProps } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  availability: 'disabled' as 'disabled' | 'unavailable' | 'available',
  provider: vi.fn(),
  registry: vi.fn(() => { throw new Error('League sources are unavailable'); }),
}));
vi.mock('@/lib/accounts/auth', () => ({ getAccountAuthAvailability: () => mocks.availability }));
vi.mock('@/lib/accounts/auth-client', () => ({ accountAuthClient: {
  signIn: { email: mocks.provider }, signUp: { email: mocks.provider }, signOut: mocks.provider,
  sendVerificationEmail: mocks.provider, emailOtp: { verifyEmail: mocks.provider },
  requestPasswordReset: mocks.provider, resetPassword: mocks.provider,
} }));
vi.mock('@/lib/league-administration/registry', () => ({ getCurrentLeagueIds: mocks.registry }));
vi.mock('next/navigation', () => ({ usePathname: () => '/my-leagues', useRouter: () => ({ replace: vi.fn() }) }));
vi.mock('next/link', () => ({ default: ({ children, prefetch, ...props }: ComponentProps<'a'> & { prefetch?: boolean }) => { void prefetch; return <a {...props}>{children}</a>; } }));
vi.mock('next/image', () => ({ default: () => <span aria-hidden="true" /> }));

import type { LibraryLeague, LibraryView } from '@/lib/accounts/contracts';
import RootLayout from '@/app/layout';
import PlatformLayout from '@/app/(platform)/layout';
import MyLeaguesPage from '@/app/(platform)/my-leagues/page';
import AccountPage from '@/app/(platform)/account/page';
import SignInPage from '@/app/(platform)/sign-in/page';
import { AccountLibrary, leagueRelationship } from './account-library';

const leagues: LibraryLeague[] = [
  { id: 'l1', key: 'league1', name: 'League One', season: 2026, url: '/matchups', logo: '', saved: null,
    teams: [{ id: 'team-a', rosterId: '1', roles: ['owner'], sourceManagerAccountIds: ['source-a'], assurance: 'user_asserted', freshness: 'current', observedAt: '2026-09-22T12:00:00Z' }],
    affiliations: [{ id: 'pair', name: 'League One / League Two' }], linkedFromLeagueIds: [], sourceState: 'current', sourceObservedAt: '2026-09-22T12:00:00Z' },
  { id: 'l2', key: 'league2', name: 'League Two', season: 2026, url: '/league2/matchups', logo: '', saved: null, teams: [],
    affiliations: [{ id: 'pair', name: 'League One / League Two' }], linkedFromLeagueIds: ['l1'], sourceState: 'current', sourceObservedAt: '2026-09-22T12:00:00Z' },
  { id: 'dynasty', key: 'dynasty', name: 'Dynasty League', season: 2026, url: '/dynasty/matchups', logo: '', saved: null, teams: [],
    affiliations: [], linkedFromLeagueIds: [], sourceState: 'unavailable', sourceObservedAt: null },
];

beforeEach(() => { vi.clearAllMocks(); mocks.availability = 'disabled'; });

describe('platform account routes', () => {
  it.each([['my-leagues', MyLeaguesPage], ['account', AccountPage], ['sign-in', SignInPage]] as const)(
    'renders dormant %s with public links and no league or authentication work', (_path, Page) => {
      const html = renderToStaticMarkup(<RootLayout><PlatformLayout><Page /></PlatformLayout></RootLayout>);
      expect(html).toContain('Accounts are being prepared.');
      expect(html).toContain('href="/matchups"');
      expect(html).toContain('href="/league2/matchups"');
      expect(html).toContain('href="/dynasty/matchups"');
      expect(html).toContain('aria-label="Account navigation"');
      expect(html).not.toContain('name="password"');
      expect(mocks.provider).not.toHaveBeenCalled();
      expect(mocks.registry).not.toHaveBeenCalled();
    },
  );

  it('renders unavailable configuration without asking for credentials', () => {
    mocks.availability = 'unavailable';
    const html = renderToStaticMarkup(<SignInPage />);
    expect(html).toContain('Accounts are temporarily unavailable.');
    expect(html).not.toContain('name="password"');
    expect(mocks.provider).not.toHaveBeenCalled();
  });

  it('renders an enabled sign-in form without sending auth requests during rendering', () => {
    mocks.availability = 'available';
    const html = renderToStaticMarkup(<SignInPage />);
    expect(html).toContain('Website password');
    expect(html).toContain('Use your invited email address');
    expect(html).toContain('Your Sleeper password is never needed.');
    expect(html).toContain('Forgot password?');
    expect(mocks.provider).not.toHaveBeenCalled();
  });
});

describe('personal library presentation', () => {
  it('distinguishes participation, direct affiliation and independently available leagues', () => {
    expect(leagues.map(leagueRelationship)).toEqual(['Participating', 'Linked league', 'Available']);
    const library: LibraryView = { leagues, availableProviderAccounts: [] };
    const html = renderToStaticMarkup(<AccountLibrary library={library} busy={false} mutate={async () => true} />);
    expect(html).toContain('Your leagues');
    expect(html).toContain('Linked leagues');
    expect(html).toContain('Available leagues');
    expect(html).toContain('This does not mean you manage a team here.');
    expect(html).toContain('This association is user supplied.');
    expect(html).toContain('Saved follows remain available.');
  });

  it('labels older participation honestly and does not turn a saved follow into ownership', () => {
    const stale: LibraryLeague = { ...leagues[0], sourceState: 'stale', teams: leagues[0].teams.map(team => ({ ...team, freshness: 'stale' })) };
    const following: LibraryLeague = { ...leagues[2], saved: { favorite: false, sortPosition: 0, preferredSeasonTeamId: null, revision: 1 } };
    expect(leagueRelationship(stale)).toBe('Last-known participation');
    expect(leagueRelationship(following)).toBe('Following');
    const linked: LibraryLeague = { ...leagues[1], sourceState: 'stale' };
    const html = renderToStaticMarkup(<AccountLibrary library={{ leagues: [linked], availableProviderAccounts: [] }} busy={false} mutate={async () => true} />);
    expect(html).toContain('League roster information is waiting for a fresh update.');
    expect(html).not.toContain('Participation is last known.');
  });

  it('uses approved legacy destinations rather than a supplied card URL', () => {
    const library: LibraryView = { leagues: [{ ...leagues[0], url: 'https://untrusted.example', logo: 'https://untrusted.example/image' }], availableProviderAccounts: [] };
    const html = renderToStaticMarkup(<AccountLibrary library={library} busy={false} mutate={async () => true} />);
    expect(html).toContain('href="/matchups"');
    expect(html).not.toContain('untrusted.example');
  });
});
