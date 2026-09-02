import 'server-only';

import { notFound } from 'next/navigation';
import { selectStoredMatchups } from '@/lib/projection-freshness';
import { getProjectionStore } from '@/lib/projection-store';
import { getCurrentLeagueWeek, getOfficialMatchups, getOverview, getManager, getTransactions } from '@/lib/sleeper';
import type { MatchupsData } from '@/lib/types';
import { MatchupsView } from './matchups-view';
import { ManagerView } from './manager-view';
import { ManagersView } from './managers-view';
import { StandingsView } from './standings-view';
import { TransactionsView } from './transactions-view';

type MatchupSearchParams = Promise<{ week?: string }>;
type ManagerParams = Promise<{ id: string }>;

async function storedMatchups(leagueId: string, week?: number): Promise<MatchupsData | null> {
  try {
    const store = getProjectionStore();
    const [snapshot, latest] = week === undefined
      ? await store.readLatestCurrentSnapshotBySleeperLeagueId(leagueId)
        .then((value) => [value, value] as const)
      : await Promise.all([
        store.readLatestCurrentSnapshotBySleeperLeagueId(leagueId, week),
        store.readLatestCurrentSnapshotBySleeperLeagueId(leagueId),
      ]);
    const selected = selectStoredMatchups(snapshot, latest, week);
    return selected.kind === 'usable' ? selected.payload : null;
  } catch {
    // Neon is an optional read-through layer. Preserve authoritative Sleeper
    // scores when it is unconfigured or temporarily unavailable.
    return null;
  }
}

export async function LeagueMatchupsPage({
  leagueId,
  searchParams,
}: {
  leagueId: string;
  searchParams: MatchupSearchParams;
}) {
  const { week } = await searchParams;
  const parsed = week && /^\d{1,2}$/u.test(week) ? Number(week) : undefined;
  let selectedWeek = parsed;
  if (selectedWeek === undefined) {
    try {
      selectedWeek = await getCurrentLeagueWeek(leagueId);
    } catch {
      // A freshness-checked latest snapshot can keep scores available through a
      // brief Sleeper calendar outage. The full Sleeper path remains the fallback.
    }
  }
  const persisted = await storedMatchups(leagueId, selectedWeek);
  return <MatchupsView data={persisted ?? await getOfficialMatchups(selectedWeek, leagueId)} />;
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
  const data = await getManager(Number(id), leagueId);
  if (!data) notFound();
  return <ManagerView data={data} />;
}

export async function LeagueTransactionsPage({ leagueId, params }: { leagueId: string; params: ManagerParams }) {
  const { id } = await params;
  if (!/^\d+$/u.test(id)) notFound();
  const data = await getTransactions(Number(id), leagueId);
  if (!data) notFound();
  return <TransactionsView data={data} />;
}
