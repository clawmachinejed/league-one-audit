import type { Metadata } from 'next';
import { StandingsView } from '@/components/standings-view';
import { getOverview } from '@/lib/sleeper';
export const metadata: Metadata = { title: 'Standings' };
export const dynamic = 'force-dynamic';
export default async function StandingsPage() { return <StandingsView data={await getOverview()} />; }
