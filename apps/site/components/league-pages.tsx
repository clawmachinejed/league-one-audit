import 'server-only';

import { notFound } from 'next/navigation';
import { getMatchups, getOverview, getOwner, getTransactions } from '@/lib/sleeper';
import { MatchupsView } from './matchups-view';
import { OwnerView } from './owner-view';
import { OwnersView } from './owners-view';
import { StandingsView } from './standings-view';
import { TransactionsView } from './transactions-view';

type MatchupSearchParams = Promise<{ week?: string }>;
type OwnerParams = Promise<{ id: string }>;

export async function LeagueMatchupsPage({
  leagueId,
  searchParams,
}: {
  leagueId: string;
  searchParams: MatchupSearchParams;
}) {
  const { week } = await searchParams;
  const parsed = week && /^\d{1,2}$/u.test(week) ? Number(week) : undefined;
  return <MatchupsView data={await getMatchups(parsed, leagueId)} />;
}

export async function LeagueStandingsPage({ leagueId }: { leagueId: string }) {
  return <StandingsView data={await getOverview(leagueId)} />;
}

export async function LeagueOwnersPage({ leagueId }: { leagueId: string }) {
  return <OwnersView data={await getOverview(leagueId)} />;
}

export async function LeagueOwnerPage({ leagueId, params }: { leagueId: string; params: OwnerParams }) {
  const { id } = await params;
  if (!/^\d+$/u.test(id)) notFound();
  const data = await getOwner(Number(id), leagueId);
  if (!data) notFound();
  return <OwnerView data={data} />;
}

export async function LeagueTransactionsPage({ leagueId, params }: { leagueId: string; params: OwnerParams }) {
  const { id } = await params;
  if (!/^\d+$/u.test(id)) notFound();
  const data = await getTransactions(Number(id), leagueId);
  if (!data) notFound();
  return <TransactionsView data={data} />;
}
