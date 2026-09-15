import 'server-only';

import { notFound } from 'next/navigation';
import { parseMatchupWeek } from '@/lib/matchup-week';
import { currentMatchupWeek, type MatchupPeriodContext } from '@/lib/matchup-period';
import { readStoredMatchups } from '@/lib/projection-reader';
import type { LeagueKey } from '@/lib/leagues';
import { getCurrentMatchupPeriodContext, getOfficialMatchups, getOverview, getManager, getStandings, getTransactions, getSiteWeekRollover } from '@/lib/sleeper';
import { MatchupsView } from './matchups-view';
import { ManagerView } from './manager-view';
import { ManagersView } from './managers-view';
import { StandingsView } from './standings-view';
import type { StandingsProjectionSource } from './projected-standings-live';
import { TransactionsView } from './transactions-view';
import type { SiteWeekRollover } from './use-site-week-rollover';

type MatchupSearchParams = Promise<{ week?: string }>;
type ManagerParams = Promise<{ id: string }>;

async function loadRollover(leagueId: string): Promise<SiteWeekRollover | null> {
  try { return await getSiteWeekRollover(leagueId); } catch { return null; }
}

function contextForSelectedWeek(context: MatchupPeriodContext, week: number): MatchupPeriodContext {
  const currentWeek = currentMatchupWeek(context);
  return {
    ...context,
    temporalState: context.lifecycle === 'preseason' ? 'future'
      : context.lifecycle === 'complete' ? 'past'
        : week < currentWeek ? 'past' : week > currentWeek ? 'future' : 'active',
  };
}

export async function LeagueMatchupsPage({
  leagueId,
  leagueKey,
  searchParams,
  mode = 'matchups',
}: {
  leagueId: string;
  leagueKey: LeagueKey;
  searchParams: MatchupSearchParams;
  mode?: 'matchups' | 'my-team';
}) {
  const { week } = await searchParams;
  const requestedWeek = mode === 'my-team' ? undefined : parseMatchupWeek(week) ?? undefined;
  const [rollover, initialStored] = await Promise.all([
    loadRollover(leagueId), readStoredMatchups(leagueKey, requestedWeek),
  ]);
  let persisted = initialStored;
  let periodContext: MatchupPeriodContext | undefined = 'context' in persisted
    ? persisted.context : undefined;
  let selectedWeek = requestedWeek ?? rollover?.week;
  let storedWeek = requestedWeek ?? periodContext?.defaultWeek;
  if (requestedWeek === undefined && periodContext) {
    // Follow a rollover discovered by the first exact read, but bound retries.
    // A newer authority after this budget uses the latest week in official fallback.
    for (let reread = 0; reread < 2; reread += 1) {
      selectedWeek = rollover?.week ?? currentMatchupWeek(periodContext);
      if (selectedWeek === storedWeek) break;
      persisted = await readStoredMatchups(leagueKey, selectedWeek);
      storedWeek = selectedWeek;
      if ('context' in persisted && persisted.context) periodContext = persisted.context;
    }
    selectedWeek = rollover?.week ?? currentMatchupWeek(periodContext);
  }
  const authorityAgrees = !rollover || !periodContext || currentMatchupWeek(periodContext) === rollover.week;
  if (persisted.kind === 'usable' && authorityAgrees
    && (selectedWeek === undefined || persisted.payload.week === selectedWeek)) {
    return <MatchupsView data={persisted.payload} periodContext={persisted.context}
      snapshotRevision={persisted.snapshotRevision} verifiedAt={persisted.verifiedAt}
      rollover={rollover} followCurrent={requestedWeek === undefined} mode={mode} />;
  }

  if (!authorityAgrees) periodContext = undefined;
  if (!periodContext) {
    try {
      periodContext = await getCurrentMatchupPeriodContext(leagueId, selectedWeek);
    } catch {
      // The complete Sleeper matchup load below remains the final safe fallback.
    }
  }
  selectedWeek ??= periodContext ? currentMatchupWeek(periodContext) : undefined;
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
  periodContext = contextForSelectedWeek(periodContext, data.week);
  return <MatchupsView data={data} periodContext={periodContext} snapshotRevision={null} verifiedAt={null}
    rollover={rollover} followCurrent={requestedWeek === undefined} mode={mode} />;
}

export function LeagueMyTeamPage({ leagueId, leagueKey }: { leagueId: string; leagueKey: LeagueKey }) {
  return LeagueMatchupsPage({ leagueId, leagueKey, searchParams: Promise.resolve({}), mode: 'my-team' });
}

export async function LeagueStandingsPage({ leagueId, leagueKey }: { leagueId: string; leagueKey: LeagueKey }) {
  const [data, rollover] = await Promise.all([getStandings(leagueId), loadRollover(leagueId)]);
  let projectionSource: StandingsProjectionSource | null = null;
  if (data.projectionBasis?.kind === 'ready') {
    const week = data.projectionBasis.week;
    const persisted = await readStoredMatchups(leagueKey, week);
    if (persisted.kind === 'usable') {
      projectionSource = { data: persisted.payload, periodContext: persisted.context,
        snapshotRevision: persisted.snapshotRevision, verifiedAt: persisted.verifiedAt };
    } else {
      let periodContext = 'context' in persisted ? persisted.context : undefined;
      if (!periodContext) {
        try { periodContext = await getCurrentMatchupPeriodContext(leagueId, week); } catch { /* Keep official standings usable. */ }
      }
      if (periodContext) {
        // An empty seed is explicitly unavailable until the existing snapshot reader recovers.
        projectionSource = { data: { ...data, week, matchups: [] }, periodContext, snapshotRevision: null, verifiedAt: null };
      }
    }
  }
  return <StandingsView key={leagueKey} data={data} projectionSource={projectionSource} rollover={rollover} />;
}

export async function LeagueManagersPage({ leagueId }: { leagueId: string }) {
  const [data, rollover] = await Promise.all([getOverview(leagueId), loadRollover(leagueId)]);
  return <ManagersView data={data} rollover={rollover} />;
}

export async function LeagueManagerPage({ leagueId, params }: { leagueId: string; params: ManagerParams }) {
  const { id } = await params;
  if (!/^\d+$/u.test(id)) notFound();
  const [data, rollover] = await Promise.all([getManager(leagueId, Number(id)), loadRollover(leagueId)]);
  if (!data) notFound();
  return <ManagerView data={data} rollover={rollover} />;
}

export async function LeagueTransactionsPage({ leagueId, params }: { leagueId: string; params: ManagerParams }) {
  const { id } = await params;
  if (!/^\d+$/u.test(id)) notFound();
  const [data, rollover] = await Promise.all([getTransactions(leagueId, Number(id)), loadRollover(leagueId)]);
  if (!data) notFound();
  return <TransactionsView data={data} rollover={rollover} />;
}
