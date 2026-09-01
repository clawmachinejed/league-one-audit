'use client';

import Image from 'next/image';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import { Icon, type IconName } from './icon';
import { TeamPreferenceProvider } from './team-preference';

export function AppShell({ children, leagueId }: { children: ReactNode; leagueId: string }) {
  const pathname = usePathname();
  const compactMatchups = pathname === '/matchups';
  const nav: { href: string; label: string; icon: IconName }[] = [
    { href: '/matchups', label: 'Matchups', icon: 'matchups' },
    { href: '/standings', label: 'Standings', icon: 'standings' },
    { href: '/owners', label: 'Owners', icon: 'owners' },
  ];

  return <TeamPreferenceProvider leagueId={leagueId}>
    <a className="skip-link" href="#main-content">Skip to content</a>
    <header className="site-header">
      <div className="header-inner">
        <Link className="brand" href="/matchups" aria-label="League One home">
          <Image src="/logo.png" width={42} height={42} alt="" className="brand-mark" priority />
          <span><span className="brand-name">LEAGUE ONE<span className="brand-period">.</span></span><span className="brand-caption">FANTASY FOOTBALL</span></span>
        </Link>
        <nav className="desktop-nav" aria-label="Main navigation">
          {nav.map(item => <Link key={item.href} href={item.href} aria-current={pathname.startsWith(item.href) ? 'page' : undefined}><Icon name={item.icon} />{item.label}</Link>)}
        </nav>
      </div>
    </header>
    <main id="main-content" className={`main-content ${compactMatchups ? 'matchups-main' : ''}`} tabIndex={-1}>{children}</main>
    <nav className={`mobile-nav ${compactMatchups ? 'matchups-mobile-nav' : ''}`} aria-label="Mobile navigation">
      {nav.map(item => <Link key={item.href} href={item.href} aria-current={pathname.startsWith(item.href) ? 'page' : undefined}><Icon name={item.icon} /><span>{item.label}</span></Link>)}
    </nav>
  </TeamPreferenceProvider>;
}
