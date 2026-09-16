import type { Metadata } from 'next';
import { LeagueMyTeamPage } from '@/components/league-pages';
import { LEAGUE_IDS } from '@/lib/config';

export const metadata: Metadata = { title: 'My Team' };
export const dynamic = 'force-dynamic';

export default function MyTeamPage({ searchParams }: { searchParams: Promise<{ week?: string }> }) {
  return <LeagueMyTeamPage leagueKey="league1" leagueId={LEAGUE_IDS.league1} searchParams={searchParams} />;
}
