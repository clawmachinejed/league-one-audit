import 'server-only';

import { notFound } from 'next/navigation';
import { parseMatchupWeek } from '@/lib/matchup-week';
import { readStoredMatchups } from '@/lib/projection-reader';
import { getCurrentLeagueWeek, getOfficialMatchups, getOverview, getManager, getTransactions } from '@/lib/sleeper';
import { MatchupsView } from './matchups-view';
import { ManagerView } from './manager-view';
import { ManagersView } from './managers-view';
import { StandingsView } from './standings-view';
import { TransactionsView } from './transactions-view';

type MatchupSearchParams = Promise<{ week?: string }>;
type ManagerParams = Promise<{ id: string }>;

export async function LeagueMatchupsPage({
  leagueId,
  searchParams,
}: {
  leagueId: string;
  searchParams: MatchupSearchParams;
}) {
  const { week } = await searchParams;
  let selectedWeek = parseMatchupWeek(week) ?? undefined;
  if (selectedWeek === undefined) {
    try {
      selectedWeek = await getCurrentLeagueWeek(leagueId);
    } catch {
      // A freshness-checked latest snapshot can keep scores available through a
      // brief Sleeper calendar outage. The full Sleeper path remains the fallback.
    }
  }
  const persisted = await readStoredMatchups(leagueId, selectedWeek);
  const data = persisted.kind === 'usable'
    ? persisted.payload
    : await getOfficialMatchups(leagueId, selectedWeek);
  return <MatchupsView data={data} />;
}

export async function LeagueStandingsPage({ leagueId }: { leagueId: string }) {
  return <StandingsView data={await getOverview(leagueId)} />;
}

export async function LeagueManagersPage({ leagueId }: { leagueId: string }) {
  return <ManagersView data={await getOverview(leagueId)} />;
}

export async function LeagueManagerPage({ leagueId, params }: { leagueId: string; params: ManagerParams }) {
  const { id } = await params;
  if (!/^\d+$/u.test(id)) notFound();
  const data = await getManager(leagueId, Number(id));
  if (!data) notFound();
  return <ManagerView data={data} />;
}

export async function LeagueTransactionsPage({ leagueId, params }: { leagueId: string; params: ManagerParams }) {
  const { id } = await params;
  if (!/^\d+$/u.test(id)) notFound();
  const data = await getTransactions(leagueId, Number(id));
  if (!data) notFound();
  return <TransactionsView data={data} />;
}
