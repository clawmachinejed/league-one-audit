import type { Metadata } from 'next';
import { LeagueMyTeamPage } from '@/components/league-pages';
import { LEAGUE_IDS } from '@/lib/config';
import { MyTeamTabNavigation } from '@/components/my-team-tabs';

export const metadata: Metadata = { title: 'My Team' };
export const dynamic = 'force-dynamic';

export default function MyTeamPage({ searchParams }: { searchParams: Promise<{ week?: string; view?: string }> }) {
  return <MyTeamTabNavigation><LeagueMyTeamPage leagueKey="dynasty" leagueId={LEAGUE_IDS.dynasty} searchParams={searchParams} /></MyTeamTabNavigation>;
}
