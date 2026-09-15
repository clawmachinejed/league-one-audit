'use client';

import { useRouter } from 'next/navigation';
import { useMemo } from 'react';
import { useMatchupSnapshot } from './use-matchup-snapshot';
import { useMatchupBoxScores } from './use-matchup-box-scores';
import { playerBoxScoreKey } from '../lib/matchup-box-scores';
import {
  currentMatchupWeek,
  type MatchupPeriodContext,
} from '../lib/matchup-period';
import type { Matchup, MatchupsData } from '../lib/types';
import { WeekSelector } from './week-selector';
import { useLeagueSite } from './league-context';
import { Avatar, EmptyState, Warning } from './league-primitives';
import { MatchupBoard } from './matchup-board';
import matchupStyles from './matchups.module.css';
import { PageIntro } from './page-intro';
import { useTeamPreference } from './team-preference';

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

function MatchupsWithBoxScores({ matchups, selected, leagueKey, season, week, refreshAutomatically }: {
  matchups: Matchup[]; selected: number | null; leagueKey: string; season: string; week: number;
  refreshAutomatically: boolean;
}) {
  const lineupKey = [...new Set(matchups.flatMap(matchup => matchup.sides.flatMap(side => side.starters
    .filter(player => player.id).map(playerBoxScoreKey))))].sort().join(',');
  const boxScores = useMatchupBoxScores({ leagueKey, season, week, lineupKey, refreshAutomatically });
  return <MatchupBoard matchups={matchups} selected={selected} avatar={team => <Avatar team={team} />}
    boxScores={boxScores.data} boxScoresLoading={boxScores.loading} onBoxScoreOpen={boxScores.request} />;
}

export function MatchupsView({
  data: initialData,
  periodContext: initialPeriodContext,
  snapshotRevision,
  verifiedAt,
}: {
  data: MatchupsData;
  periodContext: MatchupPeriodContext;
  snapshotRevision: string | null;
  verifiedAt: string | null;
}) {
  const site = useLeagueSite();
  const matchupsPath = `${site.prefix}/matchups`;
  const { data, periodContext, updatedAt, refreshing } = useMatchupSnapshot({
    leagueKey: site.key, data: initialData, periodContext: initialPeriodContext, snapshotRevision, verifiedAt,
  });
  const { selected } = useTeamPreference(data.teams);
  const router = useRouter();
  const automaticallyUpdating = periodContext.temporalState !== 'past';
  const matchups = useMemo(() => [...data.matchups].sort((a, b) => Number(b.sides.some(side => side.team.id === selected)) - Number(a.sides.some(side => side.team.id === selected))), [data.matchups, selected]);
  return <div className={matchupStyles.page}>
    <div className={matchupStyles.toolbar}>
      <PageIntro title="Matchups" league={data.league} />
      <WeekSelector label="Matchup week" week={data.week} currentWeek={currentMatchupWeek(periodContext)}
        maxWeek={data.league.maxWeek} onChange={week => router.push(`${matchupsPath}?week=${week}`)}
        hrefForWeek={week => `${matchupsPath}?week=${week}`} />
    </div>
    <Warning message={data.warning} />
    {matchups.length ? <MatchupsWithBoxScores key={`${site.key}:${data.league.season}:${data.week}`}
      matchups={matchups} selected={selected} leagueKey={site.key} season={data.league.season}
      week={data.week} refreshAutomatically={periodContext.temporalState === 'active'} />
      : <EmptyState title="No matchups posted yet">Week {data.week} matchups will appear when Sleeper publishes the schedule. You can still browse teams and standings.</EmptyState>}
    <SnapshotUpdated value={updatedAt} refreshing={refreshing} />
    {automaticallyUpdating && <p className="refresh-note">Checks for a newer matchup snapshot every minute while this page is open.</p>}
  </div>;
}
