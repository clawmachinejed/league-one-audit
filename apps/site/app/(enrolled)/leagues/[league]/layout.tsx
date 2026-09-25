import { notFound } from 'next/navigation';
import { AppShell } from '@/components/league-shell';
import { getLeagueSite, getPublicLeagueSites } from '@/lib/league-sites';
import { getCurrentLeagueId } from '@/lib/league-administration/registry';
import { getAccountAuthAvailability } from '@/lib/accounts/auth';
import { isLeagueRouteKey, siteForLeague, SITE_LOGO } from '@/lib/leagues';
export const dynamic = 'force-dynamic';
export const metadata = { icons: { icon: SITE_LOGO, apple: SITE_LOGO } };
export default async function EnrolledLayout({ children, params }: { children: React.ReactNode; params: Promise<{ league: string }> }) {
  const { league } = await params;
  if (!isLeagueRouteKey(league) || !league.startsWith('sleeper-')) notFound();
  const id = await getCurrentLeagueId(league).catch(() => null);
  if (!id) notFound();
  const [site, sites] = await Promise.all([
    getLeagueSite(league).catch(() => siteForLeague(league, 'Sleeper league')!), getPublicLeagueSites(),
  ]);
  return <AppShell activeSite={site} sites={[...sites, site]} leagueIds={{ [league]: id }}
    accountsEnabled={getAccountAuthAvailability() === 'available'}>{children}</AppShell>;
}
