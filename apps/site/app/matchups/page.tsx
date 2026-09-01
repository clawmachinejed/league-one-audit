import type { Metadata } from 'next';
import { MatchupsView } from '@/components/matchups-view';
import { getMatchups } from '@/lib/sleeper';
export const metadata: Metadata = { title: 'Matchups' };
export const dynamic = 'force-dynamic';
export default async function MatchupsPage({ searchParams }: { searchParams: Promise<{ week?: string }> }) {
  const { week } = await searchParams;
  const parsed = week && /^\d{1,2}$/.test(week) ? Number(week) : undefined;
  return <MatchupsView data={await getMatchups(parsed)} />;
}
