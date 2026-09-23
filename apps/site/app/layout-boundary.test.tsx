import type { ComponentProps, ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  pathname: '/matchups',
  getCurrentLeagueIds: vi.fn(),
  fetch: vi.fn(async () => { throw new Error('Unexpected provider request'); }),
}));

vi.mock('server-only', () => ({}));
vi.mock('@/lib/league-administration/registry', () => ({ getCurrentLeagueIds: mocks.getCurrentLeagueIds }));
vi.mock('next/navigation', () => ({ usePathname: () => mocks.pathname }));
vi.mock('next/link', () => ({ default: ({ children, prefetch, ...props }: ComponentProps<'a'> & { prefetch?: boolean }) => { void prefetch; return <a {...props}>{children}</a>; } }));
vi.mock('next/image', () => ({ default: () => <span aria-hidden="true" /> }));

import RootLayout, { metadata as rootMetadata } from './layout';
import RootLoading from './loading';
import RootError from './error';
import RootNotFound from './not-found';
import LeagueLayout, { metadata as leagueMetadata } from './(leagues)/layout';
import LeagueNotFound from './(leagues)/not-found';
import { useLeagueConnectionId, useLeagueSite } from '@/components/league-context';

const acceptedIds = { league1: 'accepted-one', league2: 'accepted-two', dynasty: 'accepted-dynasty' } as const;

function renderRoot(children: ReactNode) {
  return renderToStaticMarkup(<RootLayout>{children}</RootLayout>);
}

function ConnectionProbe() {
  const site = useLeagueSite();
  return <p>{site.name}:{useLeagueConnectionId()}</p>;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.pathname = '/matchups';
  mocks.getCurrentLeagueIds.mockRejectedValue(new Error('League enrollment is unavailable'));
  vi.stubGlobal('fetch', mocks.fetch);
});

afterEach(() => {
  expect(mocks.fetch).not.toHaveBeenCalled();
  vi.unstubAllGlobals();
});

describe('platform and public league layout boundary', () => {
  it('renders a platform child without resolving league enrollment or mounting league controls', () => {
    const html = renderRoot(<main><h1>Account area</h1></main>);
    expect(html).toContain('<html lang="en" data-scroll-behavior="smooth">');
    expect(html).toContain('<main><h1>Account area</h1></main>');
    expect(html).not.toContain('Main navigation');
    expect(html).not.toContain('Choose league');
    expect(mocks.getCurrentLeagueIds).not.toHaveBeenCalled();
  });

  it('keeps enrollment failure inside the public league layout', async () => {
    await expect(LeagueLayout({ children: <ConnectionProbe /> })).rejects.toThrow('League enrollment is unavailable');
    expect(renderRoot(<main>Independent page</main>)).toContain('Independent page');
    expect(mocks.getCurrentLeagueIds).toHaveBeenCalledOnce();
  });

  it('renders a healthy league when another routed league registration is missing', async () => {
    mocks.getCurrentLeagueIds.mockResolvedValue({ league1: 'accepted-one' });
    const html = renderRoot(await LeagueLayout({ children: <ConnectionProbe /> }));
    expect(html).toContain('League One:accepted-one');
    expect(html).toContain('aria-label="Main navigation"');
    mocks.pathname = '/league2/matchups';
    const unavailable = renderRoot(await LeagueLayout({ children: <ConnectionProbe /> }));
    expect(unavailable).toContain('League Two:');
    expect(unavailable).not.toContain('accepted-one');
  });

  it('renders root loading and recovery without a league context or provider-specific claim', () => {
    const loading = renderRoot(<RootLoading />);
    const error = renderRoot(<RootError retry={() => undefined} />);
    expect(loading).toContain('role="status"');
    expect(error).toContain('We couldn’t load this page.');
    expect(error).toContain('href="/"');
    expect(loading + error).not.toContain('Sleeper');
    expect(mocks.getCurrentLeagueIds).not.toHaveBeenCalled();
  });

  it.each([
    ['/matchups', 'League One', 'accepted-one', '/my-team'],
    ['/league2/matchups', 'League Two', 'accepted-two', '/league2/my-team'],
    ['/dynasty/matchups', 'Dynasty League', 'accepted-dynasty', '/dynasty/my-team'],
  ])('retains accepted connection and public navigation for %s', async (pathname, name, id, teamHref) => {
    mocks.pathname = pathname;
    mocks.getCurrentLeagueIds.mockResolvedValue(acceptedIds);
    const html = renderRoot(await LeagueLayout({ children: <ConnectionProbe /> }));
    expect(html).toContain(`${name}:${id}`);
    expect(html).toContain(`href="${teamHref}"`);
    expect(html).toContain('aria-label="Main navigation"');
    expect(html).toContain('aria-label="Mobile navigation"');
    expect(mocks.getCurrentLeagueIds).toHaveBeenCalledOnce();
  });

  it.each([
    ['/this-page-does-not-exist', 'League One', '/managers'],
    ['/league2/this-page-does-not-exist', 'League Two', '/league2/managers'],
    ['/dynasty/this-page-does-not-exist', 'Dynasty League', '/dynasty/managers'],
  ])('retains source-independent not-found navigation for %s', (pathname, name, href) => {
    mocks.pathname = pathname;
    const html = renderRoot(<RootNotFound />);
    expect(html).toContain(`This manager or page isn’t part of ${name}.`);
    expect(html).toContain(`href="${href}" class="text-button not-found-link">Back to managers`);
    expect(html).toContain('aria-label="Main navigation"');
    expect(mocks.getCurrentLeagueIds).not.toHaveBeenCalled();
  });

  it('keeps manager not-found content inside the existing league shell without duplicating navigation', async () => {
    mocks.getCurrentLeagueIds.mockResolvedValue(acceptedIds);
    const html = renderRoot(await LeagueLayout({ children: <LeagueNotFound /> }));
    expect(html).toContain('Back to managers');
    expect(html.match(/aria-label="Main navigation"/gu)).toHaveLength(1);
  });

  it.each(['/account/missing', '/my-leagues/missing', '/sign-in/missing'])('keeps %s outside league navigation', pathname => {
    mocks.pathname = pathname;
    const html = renderRoot(<RootNotFound />);
    expect(html).toContain('Back to my leagues');
    expect(html).toContain('aria-label="Account navigation"');
    expect(html).not.toContain('Back to managers');
    expect(mocks.getCurrentLeagueIds).not.toHaveBeenCalled();
  });

  it('keeps league-specific metadata in the public group', () => {
    expect(leagueMetadata.description).toContain('The home of League One fantasy football.');
    expect(leagueMetadata.icons).toEqual({ icon: '/league-one-logo-63ab193e.jpg', apple: '/league-one-logo-63ab193e.jpg' });
    expect(rootMetadata.description).not.toContain('managers');
  });
});
