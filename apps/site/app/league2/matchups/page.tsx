import type { Metadata } from 'next';
import { LeagueMatchupsPage } from '@/components/league-pages';
import { LEAGUE_IDS } from '@/lib/config';

export const metadata: Metadata = { title: 'Matchups' };
export const dynamic = 'force-dynamic';

export default function MatchupsPage({ searchParams }: { searchParams: Promise<{ week?: string }> }) {
  return <LeagueMatchupsPage leagueKey="league2" leagueId={LEAGUE_IDS.league2} searchParams={searchParams} />;
}
