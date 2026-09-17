import type { Metadata } from 'next';
import { LeagueManagerSchedulePage } from '@/components/league-pages';
import { LEAGUE_IDS } from '@/lib/config';

export const metadata: Metadata = { title: 'Team schedule' };
export const dynamic = 'force-dynamic';

export default function ManagerSchedulePage({ params }: { params: Promise<{ id: string }> }) {
  return <LeagueManagerSchedulePage leagueId={LEAGUE_IDS.dynasty} params={params} />;
}
