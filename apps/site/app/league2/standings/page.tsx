import type { Metadata } from 'next';
import { LeagueStandingsPage } from '@/components/league-pages';
import { LEAGUE_IDS } from '@/lib/config';

export const metadata: Metadata = { title: 'Standings' };
export const dynamic = 'force-dynamic';

export default function StandingsPage() {
  return <LeagueStandingsPage leagueId={LEAGUE_IDS.league2} />;
}
