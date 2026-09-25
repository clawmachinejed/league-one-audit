import { notFound, redirect } from 'next/navigation';
import { getCurrentLeagueId } from '@/lib/league-administration/registry';
import { isLeagueRouteKey } from '@/lib/leagues';
import { LeagueMatchupsPage, LeagueMyTeamPage, LeagueStandingsPage, LeagueManagersPage,
  LeagueManagerPage, LeagueTransactionsPage, LeagueManagerSchedulePage } from '@/components/league-pages';
export const dynamic = 'force-dynamic';
export default async function EnrolledLeaguePage({ params, searchParams }: {
  params: Promise<{ league: string; section?: string[] }>; searchParams: Promise<{ week?: string; view?: string }>;
}) {
  const { league, section = [] } = await params;
  if (!isLeagueRouteKey(league) || !league.startsWith('sleeper-')) notFound();
  const leagueId = await getCurrentLeagueId(league).catch(() => null);
  if (!leagueId) notFound();
  if (!section.length) redirect(`/leagues/${league}/my-team`);
  const props = { leagueId, leagueKey: league, searchParams };
  if (section.length === 1) {
    if (section[0] === 'matchups') return <LeagueMatchupsPage {...props} />;
    if (section[0] === 'my-team') return <LeagueMyTeamPage {...props} />;
    if (section[0] === 'standings') return <LeagueStandingsPage {...props} />;
    if (section[0] === 'managers') return <LeagueManagersPage {...props} />;
  }
  if (section[0] === 'managers' && section.length >= 2) {
    const manager = { leagueId, params: Promise.resolve({ id: section[1] }) };
    if (section.length === 2) return <LeagueManagerPage {...manager} />;
    if (section.length === 3 && section[2] === 'transactions') return <LeagueTransactionsPage {...manager} />;
    if (section.length === 3 && section[2] === 'schedule') return <LeagueManagerSchedulePage {...manager} />;
  }
  notFound();
}
