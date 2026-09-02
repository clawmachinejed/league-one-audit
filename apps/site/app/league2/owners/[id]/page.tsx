import type { Metadata } from 'next';
import { LeagueOwnerPage } from '@/components/league-pages';
import { LEAGUE_IDS } from '@/lib/config';

export const metadata: Metadata = { title: 'Team roster' };
export const dynamic = 'force-dynamic';

export default function OwnerPage({ params }: { params: Promise<{ id: string }> }) {
  return <LeagueOwnerPage leagueId={LEAGUE_IDS.league2} params={params} />;
}
