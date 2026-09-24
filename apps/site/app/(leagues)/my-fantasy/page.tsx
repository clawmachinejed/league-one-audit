import type { Metadata } from 'next';
import { connection } from 'next/server';
import { MyFantasyView } from '@/components/my-fantasy-view';
import { loadMyFantasyLeagues } from '@/lib/my-fantasy-source';
import { parseMatchupWeek } from '@/lib/matchup-week';

export const metadata: Metadata = { title: 'My Fantasy' };

export default async function MyFantasyPage({ searchParams }: { searchParams: Promise<{ week?: string | string[] }> }) {
  // A result-triggered route refresh must reread accepted standings rather
  // than reuse a prerendered page; shared provider caches stay unchanged.
  await connection();
  const { week } = await searchParams;
  const requestedWeek = parseMatchupWeek(typeof week === 'string' ? week : undefined) ?? undefined;
  const leagues = await loadMyFantasyLeagues(requestedWeek);
  return <MyFantasyView
    leagues={leagues}
    evaluatedAt={new Date().toISOString()}
    requestedWeek={requestedWeek}
  />;
}
