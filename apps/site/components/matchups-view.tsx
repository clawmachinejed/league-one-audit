'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useRef } from 'react';
import { useSiteWeekRollover, type SiteWeekRollover } from './use-site-week-rollover';
import { useMatchupSnapshot } from './use-matchup-snapshot';
import { useMatchupBoxScores } from './use-matchup-box-scores';
import { playerBoxScoreKey } from '../lib/matchup-box-scores';
import { matchupBoxScoreActivity } from '../lib/matchup-box-score-refresh';
import {
  currentMatchupWeek,
  type MatchupPeriodContext,
} from '../lib/matchup-period';
import type { Matchup, MatchupsData } from '../lib/types';
import type { CurrentStandings } from '../lib/current-standings';
import { displayedMatchupManagers } from '../lib/manager-display';
import { matchupWithTeamOnLeft, selectMyTeamMatchup } from '../lib/my-team-matchup';
import { WeekSelector } from './week-selector';
import { useLeagueSite } from './league-context';
import { Avatar, EmptyState, Warning } from './league-primitives';
import { MatchupBoard, type MatchupSummaryProps } from './matchup-board';
import matchupStyles from './matchups.module.css';
import { PageIntro } from './page-intro';
import { useTeamPreference } from './team-preference';
import { MyTeamTabs } from './my-team-tabs';
import { ManagerHonorsSeason } from './manager-honors';

function SnapshotUpdated({ value, refreshing }: { value: string; refreshing: boolean }) {
  const date = new Date(value);
  const time = Number.isNaN(date.getTime()) ? null : date.toLocaleTimeString('en-US', {
    hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York',
  });
  return <p className="updated" aria-live="polite">
    {refreshing
      ? 'Checking for matchup updates…'
      : time ? <>Latest matchup update {time} ET · Source data may be cached</> : 'Matchup data may be delayed'}
  </p>;
}

export function MatchupsWithBoxScores({ matchups, selected, leagueKey, season, week, refreshAutomatically, showBench, standings,
  observedAt, renderSummary, summaryClassName, expandedOverride, onToggle, benchExpandable, showManagerTrophies, singleColumn }: {
  matchups: Matchup[]; selected: number | null; leagueKey: string; season: string; week: number;
  refreshAutomatically: boolean;
  showBench: boolean;
  standings: CurrentStandings | null;
  observedAt: string;
} & MatchupSummaryProps) {
  const players = matchups.flatMap(matchup => matchup.sides.flatMap(side =>
    [...side.starters, ...(showBench ? side.bench ?? [] : [])]));
  const lineupKey = [...new Set(players.filter(player => player.id).map(playerBoxScoreKey))].sort().join(',');
  const boxScores = useMatchupBoxScores({ leagueKey, season, week, lineupKey, refreshAutomatically,
    activity: matchupBoxScoreActivity(players) });
  return <MatchupBoard matchups={matchups} selected={selected} avatar={team => <Avatar team={team} />}
    renderSummary={renderSummary} summaryClassName={summaryClassName} expandedOverride={expandedOverride} onToggle={onToggle}
    benchExpandable={benchExpandable} showManagerTrophies={showManagerTrophies} singleColumn={singleColumn}
    showBench={showBench} standings={standings} observedAt={observedAt}
    boxScores={boxScores.data} boxScoresLoading={boxScores.loading} onBoxScoreOpen={boxScores.request} />;
}

export function MatchupsView({
  data: initialData,
  periodContext: initialPeriodContext,
  snapshotRevision,
  verifiedAt,
  rollover,
  followCurrent = false,
  mode = 'matchups',
  standings = null,
}: {
  data: MatchupsData;
  periodContext: MatchupPeriodContext;
  snapshotRevision: string | null;
  verifiedAt: string | null;
  rollover?: SiteWeekRollover | null;
  followCurrent?: boolean;
  mode?: 'matchups' | 'my-team';
  standings?: CurrentStandings | null;
}) {
  useSiteWeekRollover(rollover);
  const site = useLeagueSite();
  const matchupsPath = `${site.prefix}/${mode}`;
  const { data: snapshotData, periodContext, updatedAt, refreshing } = useMatchupSnapshot({
    leagueKey: site.key, data: initialData, periodContext: initialPeriodContext, snapshotRevision, verifiedAt,
  });
  const data = useMemo(() => displayedMatchupManagers(site.key, snapshotData), [site.key, snapshotData]);
  const { selected } = useTeamPreference(data.teams);
  const router = useRouter();
  const observedCurrentWeek = currentMatchupWeek(periodContext);
  const currentWeek = rollover?.week ?? observedCurrentWeek;
  const refreshedPeriod = useRef<string | null>(null);
  useEffect(() => {
    if (!followCurrent || data.week === observedCurrentWeek) return;
    const target = `${site.key}:${periodContext.defaultSeason}:${observedCurrentWeek}`;
    if (refreshedPeriod.current === target) return;
    refreshedPeriod.current = target;
    router.refresh();
  }, [observedCurrentWeek, data.week, followCurrent, periodContext.defaultSeason, router, site.key]);
  const automaticallyUpdating = periodContext.temporalState !== 'past';
  const myTeamView = mode === 'my-team';
  const myTeam = useMemo(() => selectMyTeamMatchup(data.teams, data.matchups, selected), [data.teams, data.matchups, selected]);
  const matchups = useMemo(() => myTeamView ? (myTeam.matchup ? [myTeam.matchup] : [])
    : [...data.matchups]
      .sort((a, b) => Number(b.sides.some(side => side.team.id === selected)) - Number(a.sides.some(side => side.team.id === selected)))
      .map(matchup => matchupWithTeamOnLeft(matchup, selected)), [data.matchups, myTeamView, myTeam.matchup, selected]);
  return <ManagerHonorsSeason season={data.league.season}><div className={matchupStyles.page}>
    <div className={matchupStyles.toolbar}>
      <PageIntro title={myTeamView ? 'My Team' : 'Matchups'} league={data.league} />
      <WeekSelector label="Matchup week" week={data.week} currentWeek={currentWeek}
        maxWeek={data.league.maxWeek} onChange={week => router.push(week === currentWeek ? matchupsPath : `${matchupsPath}?week=${week}`)}
        hrefForWeek={week => `${matchupsPath}?week=${week}`} currentHref={matchupsPath} />
    </div>
    {myTeamView ? <MyTeamTabs view="my-team" week={followCurrent ? undefined : data.week}>{renderMatchup()}</MyTeamTabs> : renderMatchup()}
  </div></ManagerHonorsSeason>;

  function renderMatchup() {
    return <><Warning message={data.warning} />
    {matchups.length ? <MatchupsWithBoxScores key={`${site.key}:${data.league.season}:${data.week}`}
      matchups={matchups} selected={myTeamView ? myTeam.team?.id ?? null : selected} leagueKey={site.key} season={data.league.season}
      showBench={myTeamView} observedAt={data.updatedAt}
      standings={standings?.season === data.league.season ? standings : null}
      week={data.week} refreshAutomatically={periodContext.temporalState === 'active'} />
      : <EmptyState title="No matchups posted yet">{myTeamView && myTeam.team
        ? `${myTeam.team.name} has no posted Week ${data.week} matchup yet.`
        : `Week ${data.week} matchups will appear when Sleeper publishes the schedule.`} You can still browse teams and standings.</EmptyState>}
    <SnapshotUpdated value={updatedAt} refreshing={refreshing} />
    {automaticallyUpdating && <p className="refresh-note">Checks for a newer matchup snapshot every minute while this page is open.</p>}
    </>;
  }
}
