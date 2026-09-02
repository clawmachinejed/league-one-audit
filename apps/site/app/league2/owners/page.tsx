import type { Metadata } from 'next';
import { LeagueOwnersPage } from '@/components/league-pages';
import { LEAGUE_IDS } from '@/lib/config';

export const metadata: Metadata = { title: 'Owners' };
export const dynamic = 'force-dynamic';

export default function OwnersPage() {
  return <LeagueOwnersPage leagueId={LEAGUE_IDS.league2} />;
}
