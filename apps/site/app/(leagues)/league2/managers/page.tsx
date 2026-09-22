import type { Metadata } from 'next';
import { LeagueManagersPage } from '@/components/league-pages';
import { LEAGUE_IDS } from '@/lib/config';

export const metadata: Metadata = { title: 'Managers' };
export const dynamic = 'force-dynamic';

export default function ManagersPage({ searchParams }: { searchParams: Promise<{ view?: string }> }) {
  return <LeagueManagersPage leagueId={LEAGUE_IDS.league2} leagueKey="league2" searchParams={searchParams} />;
}
