import type { Metadata } from 'next';
import { AppShell } from '@/components/league-shell';
import { getCurrentLeagueIds } from '@/lib/league-administration/registry';
import { LEAGUE_SITES } from '@/lib/leagues';

export const metadata: Metadata = {
  title: { default: 'League One · Fantasy Football', template: '%s · League One' },
  description: 'The home of League One fantasy football. Matchups, standings, managers, and team activity.',
  icons: { icon: LEAGUE_SITES.league1.logo, apple: LEAGUE_SITES.league1.logo },
};

export default async function LeagueLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const leagueIds = await getCurrentLeagueIds();
  return <AppShell leagueIds={leagueIds}>{children}</AppShell>;
}
