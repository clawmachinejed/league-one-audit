'use client';

import { usePathname } from 'next/navigation';
import { LeagueSiteProvider } from '@/components/league-context';
import { LeagueNotFound } from '@/components/league-not-found';
import { LeagueShellFrame } from '@/components/league-shell';
import { leagueSiteForPathname } from '@/lib/leagues';
import { AccountShell } from '@/components/account-shell';
import { AccountNotFound } from '@/components/account-not-found';

export default function NotFound() {
  const pathname = usePathname();
  if (['/account', '/my-leagues', '/sign-in'].some(path => pathname === path || pathname.startsWith(`${path}/`))) {
    return <AccountShell><AccountNotFound /></AccountShell>;
  }
  const site = leagueSiteForPathname(pathname);
  return <LeagueSiteProvider site={site}>
    <LeagueShellFrame site={site} pathname={pathname}><LeagueNotFound /></LeagueShellFrame>
  </LeagueSiteProvider>;
}
