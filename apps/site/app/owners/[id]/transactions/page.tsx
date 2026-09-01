import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { TransactionsView } from '@/components/transactions-view';
import { getTransactions } from '@/lib/sleeper';
export const metadata: Metadata = { title: 'Transactions' };
export const dynamic = 'force-dynamic';
export default async function TransactionsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^\d+$/.test(id)) notFound();
  const data = await getTransactions(Number(id));
  if (!data) notFound();
  return <TransactionsView data={data} />;
}
