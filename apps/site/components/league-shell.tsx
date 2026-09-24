'use client';

import Image from 'next/image';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { LEAGUE_SITES, leagueSiteForPathname, type LeagueKey, type LeagueSite } from '../lib/leagues';
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

function LeagueSwitcher({ activeSite, pathname, placement }: {
  activeSite: LeagueSite;
  pathname: string;
  placement: 'mobile' | 'desktop';
}) {
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
      <Image src={activeSite.logo} width={30} height={30} alt="" />
    </button>
    {open && <div className="league-switcher-panel" id={menuId} aria-label="Choose a league" ref={menuRef}>
      {(Object.values(LEAGUE_SITES) as LeagueSite[]).map(site => <Link
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
      ><Image src={site.logo} width={30} height={30} alt="" /><span className="sr-only">{site.name}</span></Link>)}
    </div>}
  </div>;
}

/** Public navigation also serves unknown URLs without requiring a source connection. */
export function LeagueShellFrame({ children, site, pathname }: { children: ReactNode; site: LeagueSite; pathname: string }) {
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
        <Link className="brand" href={leagueHref(site, '/matchups')} aria-label={`${site.name} home`}>
          <Image src={site.logo} width={42} height={42} alt="" className="brand-mark" priority />
          <span><span className="brand-name">{site.brand}<span className="brand-period">.</span></span><span className="brand-caption">FANTASY FOOTBALL</span></span>
        </Link>
        <div className="header-actions">
          <LeagueSwitcher activeSite={site} pathname={pathname} placement="desktop" />
          <nav className="desktop-nav" aria-label="Main navigation">
            {nav.map(item => <Link key={item.href} href={item.href} aria-current={isCurrent(item.href) ? 'page' : undefined}><Icon name={item.icon} />{item.label}</Link>)}
          </nav>
        </div>
      </div>
    </header>
    <main id="main-content" className={`main-content ${compactMain ? 'matchups-main' : ''}`} tabIndex={-1}>{children}</main>
    <nav className="mobile-nav" aria-label="Mobile navigation">
      <LeagueSwitcher activeSite={site} pathname={pathname} placement="mobile" />
      {nav.map(item => <Link key={item.href} href={item.href} aria-current={isCurrent(item.href) ? 'page' : undefined}><Icon name={item.icon} /><span>{item.label}</span></Link>)}
    </nav>
  </>;
}

export function AppShell({ children, leagueIds }: { children: ReactNode; leagueIds: Readonly<Partial<Record<LeagueKey, string>>> }) {
  const pathname = usePathname();
  const site = leagueSiteForPathname(pathname);
  const leagueId = leagueIds[site.key];
  const frame = <LeagueShellFrame site={site} pathname={pathname}>{children}</LeagueShellFrame>;
  return <LeagueSiteProvider site={site} leagueId={leagueId ?? null}>{leagueId
    ? <TeamPreferenceProvider key={leagueId} leagueId={leagueId}>{frame}</TeamPreferenceProvider>
    : frame}</LeagueSiteProvider>;
}
