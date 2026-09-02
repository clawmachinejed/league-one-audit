import type { Metadata } from 'next';
import { LeagueManagerPage } from '@/components/league-pages';
import { LEAGUE_IDS } from '@/lib/config';
export const metadata: Metadata = { title: 'Team roster' };
export const dynamic = 'force-dynamic';
export default function ManagerPage({ params }: { params: Promise<{ id: string }> }) {
  return <LeagueManagerPage leagueId={LEAGUE_IDS.league1} params={params} />;
}
