import type { Metadata } from 'next';
import { AppShell } from '@/components/league-shell';
import { getCurrentLeagueIds } from '@/lib/league-administration/registry';
import { SITE_LOGO } from '@/lib/leagues';
import { getPublicLeagueSites } from '@/lib/league-sites';
import { getAccountAuthAvailability } from '@/lib/accounts/auth';

export const metadata: Metadata = {
  title: { default: 'League One · Fantasy Football', template: '%s · League One' },
  description: 'The home of League One fantasy football. Matchups, standings, managers, and team activity.',
  icons: { icon: SITE_LOGO, apple: SITE_LOGO },
};

export default async function LeagueLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const [leagueIds, sites] = await Promise.all([getCurrentLeagueIds(), getPublicLeagueSites()]);
  return <AppShell leagueIds={leagueIds} sites={sites} accountsEnabled={getAccountAuthAvailability() === 'available'}>{children}</AppShell>;
}
