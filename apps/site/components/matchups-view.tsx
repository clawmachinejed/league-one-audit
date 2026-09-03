'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from 'react';
import { isMatchupsData } from '../lib/matchups-response';
import {
  matchupPeriodContextFromHeaders,
  type MatchupPeriodContext,
} from '../lib/matchup-period';
import type { MatchupsData } from '../lib/types';
import { Icon } from './icon';
import { useLeagueSite } from './league-context';
import { Avatar, EmptyState, Warning } from './league-primitives';
import { MatchupBoard } from './matchup-board';
import matchupStyles from './matchups.module.css';
import { useTeamPreference } from './team-preference';

const SNAPSHOT_REQUEST_TIMEOUT_MS = 15_000;

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
}: {
  data: MatchupsData;
  periodContext: MatchupPeriodContext;
}) {
  const site = useLeagueSite();
  const matchupsPath = `${site.prefix}/matchups`;
  const [polledData, setPolledData] = useState<MatchupsData | null>(null);
  const [polledPeriodContext, setPolledPeriodContext] = useState<MatchupPeriodContext | null>(null);
  const polledDataMatchesRoute = polledData?.week === initialData.week
    && polledData.league.season === initialData.league.season;
  const periodContext = polledDataMatchesRoute
    ? polledPeriodContext ?? initialPeriodContext
    : initialPeriodContext;
  const data = useMemo(() => {
    if (!polledDataMatchesRoute || !polledData) return initialData;
    return Date.parse(polledData.updatedAt) >= Date.parse(initialData.updatedAt)
      ? polledData
      : initialData;
  }, [initialData, polledData, polledDataMatchesRoute]);
  const { selected } = useTeamPreference(data.teams);
  const router = useRouter();
  const [fetching, setFetching] = useState(false);
  const [routeRefreshing, startTransition] = useTransition();
  const requestSequence = useRef(0);
  const activeRequest = useRef<AbortController | null>(null);
  const refreshing = fetching || routeRefreshing;

  const fetchSnapshot = useCallback(async (background: boolean): Promise<boolean> => {
    if (background && activeRequest.current) return true;
    activeRequest.current?.abort();
    const controller = new AbortController();
    activeRequest.current = controller;
    const sequence = ++requestSequence.current;
    let timedOut = false;
    const timeout = window.setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, SNAPSHOT_REQUEST_TIMEOUT_MS);
    setFetching(true);
    try {
      const response = await fetch(`/api/matchups/${site.key}?week=${data.week}`, {
        headers: { accept: 'application/json' },
        signal: controller.signal,
      });
      if (!response.ok) return false;
      const snapshot: unknown = await response.json();
      if (!isMatchupsData(snapshot) || snapshot.week !== data.week) return false;
      if (sequence === requestSequence.current) {
        setPolledData(snapshot);
        setPolledPeriodContext(matchupPeriodContextFromHeaders(
          response.headers,
          initialPeriodContext,
        ));
      }
      return true;
    } catch (error) {
      // A superseded or unmounted request needs no fallback. A timeout does:
      // let the caller refresh the server page and recover official Sleeper data.
      return error instanceof DOMException && error.name === 'AbortError' && !timedOut;
    } finally {
      window.clearTimeout(timeout);
      if (sequence === requestSequence.current) {
        activeRequest.current = null;
        setFetching(false);
      }
    }
  }, [data.week, initialPeriodContext, site.key]);

  const refreshRoute = useCallback(() => {
    startTransition(() => router.refresh());
  }, [router]);

  const refresh = useCallback(async () => {
    if (await fetchSnapshot(false)) return;
    refreshRoute();
  }, [fetchSnapshot, refreshRoute]);

  const activeWeek = periodContext.temporalState === 'active';
  useEffect(() => {
    if (!activeWeek) return;
    let active = true;
    const timer = window.setInterval(() => {
      if (document.visibilityState !== 'visible') return;
      void fetchSnapshot(true).then((available) => {
        // A missing or stale compact snapshot means the projection pipeline is
        // degraded. Refresh the server page so official scores come directly
        // from Sleeper instead of leaving the last database score on screen.
        if (active && !available && document.visibilityState === 'visible') refreshRoute();
      });
    }, 60000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [activeWeek, fetchSnapshot, refreshRoute]);
  useEffect(() => () => activeRequest.current?.abort(), []);
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
    <SnapshotUpdated value={data.updatedAt} refreshing={refreshing} />
    {activeWeek && <p className="refresh-note">Checks for a newer matchup snapshot every minute while this page is open.</p>}
  </div>;
}
