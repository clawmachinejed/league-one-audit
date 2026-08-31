import type { Metadata } from 'next';
import { OwnersView } from '@/components/league-ui';
import { getOverview } from '@/lib/sleeper';
export const metadata: Metadata = { title: 'Owners' };
export const dynamic = 'force-dynamic';
export default async function OwnersPage() { return <OwnersView data={await getOverview()} />; }
