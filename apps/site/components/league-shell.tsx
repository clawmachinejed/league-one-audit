'use client';

import Image from 'next/image';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { LEAGUE_SITES, SITE_LOGO, siteForLeague, leagueSiteForPathname, type LeagueSite } from '../lib/leagues';
import { AccountNavigationProvider, useNavigationAccount } from './account-navigation';
import { Icon, type IconName } from './icon';
import { LeagueSiteProvider } from './league-context';
import { TeamPreferenceProvider } from './team-preference';

type LeagueSection = '/my-team' | '/matchups' | '/standings' | '/managers';

function currentSection(pathname: string, site: LeagueSite): LeagueSection {
  const localPath = site.prefix && pathname.startsWith(site.prefix)
    ? pathname.slice(site.prefix.length)
    : pathname;
  if (localPath === '/my-team' || localPath.startsWith('/my-team/')) return '/my-team';
  if (localPath === '/standings' || localPath.startsWith('/standings/')) return '/standings';
  if (localPath === '/managers' || localPath.startsWith('/managers/')) return '/managers';
  return '/matchups';
}

function leagueHref(site: LeagueSite, section: LeagueSection) {
  return `${site.prefix}${section}`;
}

function LeagueSwitcher({ activeSite, pathname, placement, sites }: {
  activeSite: LeagueSite;
  pathname: string;
  placement: 'mobile' | 'desktop';
  sites: LeagueSite[];
}) {
  const account = useNavigationAccount();
  const choices = account.status === 'ready' ? account.data.library.leagues
    .filter(league => league.teams.length || league.saved || league.linkedFromLeagueIds.length)
    .map(league => ({ site: siteForLeague(league.key, league.name, league.logo)!,
      relation: league.teams.length ? 'Your league' : league.linkedFromLeagueIds.length ? 'Linked league' : 'Following' }))
    : sites.map(site => ({ site, relation: '' }));
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuId = useId();
  const section = currentSection(pathname, activeSite);

  useEffect(() => {
    if (!open) return;
    menuRef.current?.querySelector<HTMLElement>('[aria-current="page"]')?.focus();
    const closeOutside = (event: PointerEvent) => {
      if (event.target instanceof Node && !rootRef.current?.contains(event.target)) setOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setOpen(false);
      triggerRef.current?.focus();
    };
    document.addEventListener('pointerdown', closeOutside);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('pointerdown', closeOutside);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [open]);

  return <div className={`league-switcher league-switcher-${placement}`} ref={rootRef}>
    <button
      ref={triggerRef}
      className="league-switcher-trigger"
      type="button"
      aria-label={`Choose league, current ${activeSite.name}`}
      aria-expanded={open}
      aria-controls={menuId}
      onClick={() => setOpen(value => !value)}
    >
      <Image src={activeSite.logo} width={30} height={30} alt="" unoptimized />
    </button>
    {open && <div className="league-switcher-panel" id={menuId} aria-label="Choose a league" ref={menuRef}>
      {choices.map(({ site, relation }) => <Link
        key={site.key}
        className="league-switcher-choice"
        href={site.key === activeSite.key ? pathname : leagueHref(site, section)}
        aria-label={`View ${site.name}`}
        aria-current={site.key === activeSite.key ? 'page' : undefined}
        title={site.name}
        onClick={(event) => {
          if (site.key === activeSite.key) event.preventDefault();
          setOpen(false);
        }}
      ><Image src={site.logo} width={30} height={30} alt="" unoptimized /><span>{site.name}{relation && <small>{relation}</small>}</span></Link>)}
      <Link className="league-switcher-choice" href="/account" prefetch={false}>Connect Sleeper</Link>
    </div>}
  </div>;
}

/** Public navigation also serves unknown URLs without requiring a source connection. */
export function LeagueShellFrame({ children, site, pathname, sites = Object.values(LEAGUE_SITES) }: { children: ReactNode; site: LeagueSite; pathname: string; sites?: LeagueSite[] }) {
  const compactMain = pathname === '/my-fantasy' || pathname === leagueHref(site, '/matchups')
    || pathname === leagueHref(site, '/my-team')
    || pathname === leagueHref(site, '/standings')
    || pathname === leagueHref(site, '/managers');
  const nav: { href: string; label: string; icon: IconName }[] = [
    { href: '/my-fantasy', label: 'My Fantasy', icon: 'my-fantasy' },
    { href: leagueHref(site, '/my-team'), label: 'My Team', icon: 'my-team' },
    { href: leagueHref(site, '/matchups'), label: 'Matchups', icon: 'matchups' },
    { href: leagueHref(site, '/standings'), label: 'League', icon: 'standings' },
  ];
  const isCurrent = (href: string) => pathname === href || pathname.startsWith(`${href}/`);

  return <>
    <a className="skip-link" href="#main-content">Skip to content</a>
    <header className="site-header">
      <div className="header-inner">
        <Link className="brand" href="/my-fantasy" aria-label="League One home">
          <Image src={SITE_LOGO} width={42} height={42} alt="" className="brand-mark" priority />
          <span><span className="brand-name">LEAGUE ONE<span className="brand-period">.</span></span><span className="brand-caption">FANTASY FOOTBALL</span></span>
        </Link>
        <div className="header-actions">
          <LeagueSwitcher activeSite={site} pathname={pathname} placement="desktop" sites={sites} />
          <nav className="desktop-nav" aria-label="Main navigation">
            {nav.map(item => <Link key={item.href} href={item.href} aria-current={isCurrent(item.href) ? 'page' : undefined}><Icon name={item.icon} />{item.label}</Link>)}
          </nav>
          <Link href="/account" className="account-entry" prefetch={false}>Account</Link>
        </div>
      </div>
    </header>
    <main id="main-content" className={`main-content ${compactMain ? 'matchups-main' : ''}`} tabIndex={-1}>{children}</main>
    <nav className="mobile-nav" aria-label="Mobile navigation">
      <LeagueSwitcher activeSite={site} pathname={pathname} placement="mobile" sites={sites} />
      {nav.map(item => <Link key={item.href} href={item.href} aria-current={isCurrent(item.href) ? 'page' : undefined}><Icon name={item.icon} /><span>{item.label}</span></Link>)}
    </nav>
  </>;
}

export function AppShell({ children, leagueIds, sites = Object.values(LEAGUE_SITES), activeSite, accountsEnabled = false }: {
  children: ReactNode; leagueIds: Readonly<Record<string, string | undefined>>; sites?: LeagueSite[]; activeSite?: LeagueSite; accountsEnabled?: boolean;
}) {
  const pathname = usePathname();
  const pathSite = leagueSiteForPathname(pathname);
  const site = activeSite ?? sites.find(value => value.key === pathSite.key) ?? pathSite;
  const leagueId = leagueIds[site.key];
  const frame = <LeagueShellFrame site={site} pathname={pathname} sites={sites}>{children}</LeagueShellFrame>;
  return <AccountNavigationProvider enabled={accountsEnabled}><LeagueSiteProvider site={site} leagueId={leagueId ?? null}>{leagueId
    ? <TeamPreferenceProvider key={leagueId} leagueId={leagueId}>{frame}</TeamPreferenceProvider>
    : frame}</LeagueSiteProvider></AccountNavigationProvider>;
}
