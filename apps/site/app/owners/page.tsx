import type { Metadata } from 'next';
import { OwnersView } from '@/components/owners-view';
import { getOverview } from '@/lib/sleeper';
export const metadata: Metadata = { title: 'Owners' };
export const dynamic = 'force-dynamic';
export default async function OwnersPage() { return <OwnersView data={await getOverview()} />; }
