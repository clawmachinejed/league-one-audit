import 'server-only';

import { notFound } from 'next/navigation';
import { parseMatchupWeek } from '@/lib/matchup-week';
import type { MatchupPeriodContext } from '@/lib/matchup-period';
import { readStoredMatchups } from '@/lib/projection-reader';
import type { LeagueKey } from '@/lib/leagues';
import { getCurrentMatchupPeriodContext, getOfficialMatchups, getOverview, getManager, getTransactions } from '@/lib/sleeper';
import { MatchupsView } from './matchups-view';
import { ManagerView } from './manager-view';
import { ManagersView } from './managers-view';
import { StandingsView } from './standings-view';
import { TransactionsView } from './transactions-view';

type MatchupSearchParams = Promise<{ week?: string }>;
type ManagerParams = Promise<{ id: string }>;

export async function LeagueMatchupsPage({
  leagueId,
  leagueKey,
  searchParams,
}: {
  leagueId: string;
  leagueKey: LeagueKey;
  searchParams: MatchupSearchParams;
}) {
  const { week } = await searchParams;
  const requestedWeek = parseMatchupWeek(week) ?? undefined;
  const persisted = await readStoredMatchups(leagueKey, requestedWeek);
  if (persisted.kind === 'usable') {
    return <MatchupsView data={persisted.payload} periodContext={persisted.context}
      snapshotRevision={persisted.snapshotRevision} verifiedAt={persisted.verifiedAt} />;
  }

  let periodContext: MatchupPeriodContext | undefined = 'context' in persisted
    ? persisted.context : undefined;
  if (!periodContext) {
    try {
      periodContext = await getCurrentMatchupPeriodContext(leagueId, requestedWeek);
    } catch {
      // The complete Sleeper matchup load below remains the final safe fallback.
    }
  }
  const selectedWeek = requestedWeek ?? periodContext?.defaultWeek;
  const data = await getOfficialMatchups(leagueId, selectedWeek);
  periodContext ??= {
    defaultSeason: Number(data.league.season),
    defaultWeek: data.league.week,
    activeSeason: Number(data.league.season),
    activeWeek: data.league.week,
    lifecycle: 'active',
    nflPhase: 'unknown',
    temporalState: data.week < data.league.week ? 'past'
      : data.week > data.league.week ? 'future' : 'active',
    refreshDue: false,
  };
  return <MatchupsView data={data} periodContext={periodContext} snapshotRevision={null} verifiedAt={null} />;
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
