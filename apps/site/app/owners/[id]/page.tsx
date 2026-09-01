import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { OwnerView } from '@/components/owner-view';
import { getOwner } from '@/lib/sleeper';
export const metadata: Metadata = { title: 'Team roster' };
export const dynamic = 'force-dynamic';
export default async function OwnerPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^\d+$/.test(id)) notFound();
  const data = await getOwner(Number(id));
  if (!data) notFound();
  return <OwnerView data={data} />;
}
