'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useTransition } from 'react';
import type { MatchupsData } from '../lib/types';
import { Icon } from './icon';
import { Avatar, EmptyState, Updated, Warning } from './league-primitives';
import { MatchupBoard } from './matchup-board';
import matchupStyles from './matchups.module.css';
import { useTeamPreference } from './team-preference';

export function MatchupsView({ data }: { data: MatchupsData }) {
  const { selected } = useTeamPreference(data.teams);
  const router = useRouter();
  const [refreshing, startTransition] = useTransition();
  const refresh = useCallback(() => startTransition(() => router.refresh()), [router]);
  const currentWeek = data.week === data.league.week;
  useEffect(() => {
    if (!currentWeek) return;
    const timer = window.setInterval(() => { if (document.visibilityState === 'visible') refresh(); }, 60000);
    return () => window.clearInterval(timer);
  }, [currentWeek, refresh]);
  const matchups = useMemo(() => [...data.matchups].sort((a, b) => Number(b.sides.some(side => side.team.id === selected)) - Number(a.sides.some(side => side.team.id === selected))), [data.matchups, selected]);
  return <div className={matchupStyles.page}>
    <div className={matchupStyles.toolbar}>
      <div className={matchupStyles.heading}><h1>Matchups</h1><p className={matchupStyles.season}>{data.league.season} season</p></div>
      <div className={matchupStyles.weekControl}>
        {data.week > 1 ? <Link className={matchupStyles.weekArrow} href={`/matchups?week=${data.week - 1}`} aria-label={`Previous week, week ${data.week - 1}`}><Icon name="arrow" /></Link> : <span className={`${matchupStyles.weekArrow} disabled`} aria-hidden="true"><Icon name="arrow" /></span>}
        <label className={matchupStyles.weekSelect}><span className="sr-only">Matchup week</span><select value={data.week} onChange={event => router.push(`/matchups?week=${event.target.value}`)}>{Array.from({ length: data.league.maxWeek }, (_, index) => <option key={index + 1} value={index + 1}>Week {index + 1}</option>)}</select><Icon name="chevron" /></label>
        {data.week < data.league.maxWeek ? <Link className={matchupStyles.weekArrow} href={`/matchups?week=${data.week + 1}`} aria-label={`Next week, week ${data.week + 1}`}><Icon name="arrow" className="arrow-forward" /></Link> : <span className={`${matchupStyles.weekArrow} disabled`} aria-hidden="true"><Icon name="arrow" className="arrow-forward" /></span>}
      </div>
      <button className={matchupStyles.refresh} type="button" onClick={refresh} disabled={refreshing} aria-label={refreshing ? 'Refreshing matchups' : 'Refresh matchups'}><Icon name="refresh" className={refreshing ? 'spinning' : ''} /></button>
    </div>
    {!currentWeek && <Link className={matchupStyles.backToCurrent} href={`/matchups?week=${data.league.week}`}>Back to current</Link>}
    <Warning message={data.warning} />
    {matchups.length ? <MatchupBoard key={data.week} matchups={matchups} selected={selected} avatar={team => <Avatar team={team} />} /> : <EmptyState title="No matchups posted yet">Week {data.week} matchups will appear when Sleeper publishes the schedule. You can still browse teams and standings.</EmptyState>}
    <Updated value={data.updatedAt} refreshing={refreshing} />
    {currentWeek && <p className="refresh-note">Checks for updated Sleeper data every minute while this page is open.</p>}
  </div>;
}
