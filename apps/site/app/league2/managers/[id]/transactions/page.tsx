import type { Metadata } from 'next';
import { LeagueTransactionsPage } from '@/components/league-pages';
import { LEAGUE_IDS } from '@/lib/config';

export const metadata: Metadata = { title: 'Transactions' };
export const dynamic = 'force-dynamic';

export default function TransactionsPage({ params }: { params: Promise<{ id: string }> }) {
  return <LeagueTransactionsPage leagueId={LEAGUE_IDS.league2} params={params} />;
}
