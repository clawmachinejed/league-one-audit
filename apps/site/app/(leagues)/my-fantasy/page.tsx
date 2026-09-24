import type { Metadata } from 'next';
import { connection } from 'next/server';
import { MyFantasyView } from '@/components/my-fantasy-view';
import { loadMyFantasyLeagues } from '@/lib/my-fantasy-source';

export const metadata: Metadata = { title: 'My Fantasy' };

export default async function MyFantasyPage() {
  // A result-triggered route refresh must reread accepted standings rather
  // than reuse a prerendered page; shared provider caches stay unchanged.
  await connection();
  const leagues = await loadMyFantasyLeagues();
  return <MyFantasyView leagues={leagues} evaluatedAt={new Date().toISOString()} />;
}
