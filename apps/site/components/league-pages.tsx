import 'server-only';
import type { ReactNode } from 'react';
import { resolveCurrentLeagueId } from '@/lib/league-administration/registry';

import { notFound } from 'next/navigation';
import { parseMatchupWeek } from '@/lib/matchup-week';
import { MANAGER_SCHEDULE_WEEKS } from '@/lib/my-team-schedule';
import { loadLeagueMatchups } from '@/lib/league-matchups-source';
import { readStoredMatchups } from '@/lib/projection-reader';
import type { LeagueRouteKey as LeagueKey } from '@/lib/leagues';
import { getCurrentMatchupPeriodContext, getOverview, getManagers, getManagersHistory, getManager, getManagerHonors, getStandings, getTransactions, getSiteWeekRollover, getMyTeamSchedule } from '@/lib/sleeper';
import { MatchupsView } from './matchups-view';
import { ManagerView } from './manager-view';
import { ManagerScheduleView } from './manager-schedule-view';
import { ManagersView } from './managers-view';
import { StandingsView } from './standings-view';
import type { StandingsProjectionSource } from './projected-standings-live';
import { TransactionsView } from './transactions-view';
import type { SiteWeekRollover } from './use-site-week-rollover';
import { MyTeamScheduleView } from './my-team-schedule-view';
import { ManagerHonorsProvider } from './manager-honors';

type MatchupSearchParams = Promise<{ week?: string }>;
type ManagerParams = Promise<{ id: string }>;

async function withManagerHonors(leagueId: string, season: string, children: ReactNode) {
  // Shares the page's cached ownership reads. Unavailable honors must never
  // prevent an otherwise valid stored matchup or official page from rendering.
  const data = await getManagerHonors(leagueId).catch(() => null);
  return <ManagerHonorsProvider data={data} season={season}>{children}</ManagerHonorsProvider>;
}

async function loadRollover(leagueId: string): Promise<SiteWeekRollover | null> {
  try { return await getSiteWeekRollover(leagueId); } catch { return null; }
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
  const requestedWeek = parseMatchupWeek(week) ?? undefined;
  const source = await loadLeagueMatchups(leagueId, leagueKey, requestedWeek);
  return withManagerHonors(source.leagueId, source.data.league.season,
    <MatchupsView data={source.data} periodContext={source.periodContext} standings={source.standings}
      snapshotRevision={source.snapshotRevision} verifiedAt={source.verifiedAt}
      rollover={source.rollover} followCurrent={requestedWeek === undefined} mode={mode} />);
}

export async function LeagueMyTeamPage({ leagueId, leagueKey, searchParams }: {
  leagueId: string; leagueKey: LeagueKey; searchParams: Promise<{ week?: string; view?: string }>;
}) {
  leagueId = await resolveCurrentLeagueId(leagueId);
  const query = await searchParams;
  if (query.view === 'schedule') {
    const [data, rollover] = await Promise.all([getMyTeamSchedule(leagueId), loadRollover(leagueId)]);
    return withManagerHonors(leagueId, data.league.season, <MyTeamScheduleView data={data} rollover={rollover} week={parseMatchupWeek(query.week) ?? undefined} />);
  }
  return LeagueMatchupsPage({ leagueId, leagueKey, searchParams, mode: 'my-team' });
}

export async function LeagueStandingsPage({ leagueId, leagueKey }: { leagueId: string; leagueKey: LeagueKey }) {
  leagueId = await resolveCurrentLeagueId(leagueId);
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
  return withManagerHonors(leagueId, data.league.season, <StandingsView key={leagueKey} data={data} projectionSource={projectionSource} rollover={rollover} />);
}

export async function LeagueManagersPage({ leagueId, leagueKey, searchParams }: {
  leagueId: string; leagueKey: LeagueKey; searchParams: Promise<{ view?: string }>;
}) {
  leagueId = await resolveCurrentLeagueId(leagueId);
  const { view } = await searchParams;
  const [data, rollover] = await Promise.all([
    view === 'history' ? getManagersHistory(leagueId, leagueKey) : getManagers(leagueId), loadRollover(leagueId),
  ]);
  return withManagerHonors(leagueId, data.league.season, <ManagersView data={data} rollover={rollover} />);
}

export async function LeagueManagerPage({ leagueId, params }: { leagueId: string; params: ManagerParams }) {
  leagueId = await resolveCurrentLeagueId(leagueId);
  const { id } = await params;
  if (!/^\d+$/u.test(id)) notFound();
  const [data, rollover] = await Promise.all([getManager(leagueId, Number(id)), loadRollover(leagueId)]);
  if (!data) notFound();
  return withManagerHonors(leagueId, data.league.season, <ManagerView data={data} rollover={rollover} />);
}

export async function LeagueTransactionsPage({ leagueId, params }: { leagueId: string; params: ManagerParams }) {
  leagueId = await resolveCurrentLeagueId(leagueId);
  const { id } = await params;
  if (!/^\d+$/u.test(id)) notFound();
  const [data, rollover] = await Promise.all([getTransactions(leagueId, Number(id)), loadRollover(leagueId)]);
  if (!data) notFound();
  return withManagerHonors(leagueId, data.league.season, <TransactionsView data={data} rollover={rollover} />);
}

export async function LeagueManagerSchedulePage({ leagueId, params }: { leagueId: string; params: ManagerParams }) {
  leagueId = await resolveCurrentLeagueId(leagueId);
  const { id } = await params;
  const rosterId = Number(id);
  if (!/^\d+$/u.test(id) || !Number.isSafeInteger(rosterId) || rosterId < 1) notFound();
  const overview = await getOverview(leagueId);
  const team = overview.teams.find(candidate => candidate.id === rosterId);
  if (!team) notFound();
  const [data, rollover] = await Promise.all([
    getMyTeamSchedule(leagueId, MANAGER_SCHEDULE_WEEKS), loadRollover(leagueId),
  ]);
  return withManagerHonors(leagueId, data.league.season, <ManagerScheduleView data={{ ...data, team }} rollover={rollover} />);
}
