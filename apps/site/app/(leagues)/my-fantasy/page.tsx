import type { Metadata } from 'next';
import { MyFantasyView } from '@/components/my-fantasy-view';
import { loadMyFantasyLeagues } from '@/lib/my-fantasy-source';

export const metadata: Metadata = { title: 'My Fantasy' };

export default async function MyFantasyPage() {
  const leagues = await loadMyFantasyLeagues();
  return <MyFantasyView leagues={leagues} evaluatedAt={new Date().toISOString()} />;
}
