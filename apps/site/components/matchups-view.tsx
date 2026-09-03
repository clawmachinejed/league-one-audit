'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMemo } from 'react';
import { useMatchupSnapshot } from './use-matchup-snapshot';
import {
  type MatchupPeriodContext,
} from '../lib/matchup-period';
import type { MatchupsData } from '../lib/types';
import { Icon } from './icon';
import { useLeagueSite } from './league-context';
import { Avatar, EmptyState, Warning } from './league-primitives';
import { MatchupBoard } from './matchup-board';
import matchupStyles from './matchups.module.css';
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
  const { data, periodContext, updatedAt, refreshing, refresh } = useMatchupSnapshot({
    leagueKey: site.key, data: initialData, periodContext: initialPeriodContext, snapshotRevision, verifiedAt,
  });
  const { selected } = useTeamPreference(data.teams);
  const router = useRouter();
  const activeWeek = periodContext.temporalState === 'active';
  const matchups = useMemo(() => [...data.matchups].sort((a, b) => Number(b.sides.some(side => side.team.id === selected)) - Number(a.sides.some(side => side.team.id === selected))), [data.matchups, selected]);
  return <div className={matchupStyles.page}>
    <div className={matchupStyles.toolbar}>
      <div className={matchupStyles.heading}><h1>Matchups</h1><p className={matchupStyles.season}>{data.league.season} season</p></div>
      <div className={matchupStyles.weekControl}>
        {data.week > 1 ? <Link className={matchupStyles.weekArrow} href={`${matchupsPath}?week=${data.week - 1}`} aria-label={`Previous week, week ${data.week - 1}`}><Icon name="arrow" /></Link> : <span className={`${matchupStyles.weekArrow} disabled`} aria-hidden="true"><Icon name="arrow" /></span>}
        <label className={matchupStyles.weekSelect}><span className="sr-only">Matchup week</span><select value={data.week} onChange={event => router.push(`${matchupsPath}?week=${event.target.value}`)}>{Array.from({ length: data.league.maxWeek }, (_, index) => <option key={index + 1} value={index + 1}>Week {index + 1}</option>)}</select><Icon name="chevron" /></label>
        {data.week < data.league.maxWeek ? <Link className={matchupStyles.weekArrow} href={`${matchupsPath}?week=${data.week + 1}`} aria-label={`Next week, week ${data.week + 1}`}><Icon name="arrow" className="arrow-forward" /></Link> : <span className={`${matchupStyles.weekArrow} disabled`} aria-hidden="true"><Icon name="arrow" className="arrow-forward" /></span>}
      </div>
      <button className={matchupStyles.refresh} type="button" onClick={() => void refresh()} disabled={refreshing} aria-label={refreshing ? 'Refreshing matchups' : 'Refresh matchups'}><Icon name="refresh" className={refreshing ? 'spinning' : ''} /></button>
    </div>
    {data.week !== periodContext.defaultWeek && <Link className={matchupStyles.backToCurrent} href={`${matchupsPath}?week=${periodContext.defaultWeek}`}>Back to current</Link>}
    <Warning message={data.warning} />
    {matchups.length ? <MatchupBoard key={data.week} matchups={matchups} selected={selected} avatar={team => <Avatar team={team} />} /> : <EmptyState title="No matchups posted yet">Week {data.week} matchups will appear when Sleeper publishes the schedule. You can still browse teams and standings.</EmptyState>}
    <SnapshotUpdated value={updatedAt} refreshing={refreshing} />
    {activeWeek && <p className="refresh-note">Checks for a newer matchup snapshot every minute while this page is open.</p>}
  </div>;
}
