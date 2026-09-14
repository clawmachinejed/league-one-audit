'use client';

import { useEffect, useRef, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import type { MatchupPeriodContext } from '../lib/matchup-period';
import { projectStandings } from '../lib/projected-standings';
import type { MatchupsData, StandingsData } from '../lib/types';
import { useLeagueSite } from './league-context';
import { useMatchupSnapshot } from './use-matchup-snapshot';

export type StandingsProjectionSource = Readonly<{
  data: MatchupsData;
  periodContext: MatchupPeriodContext;
  snapshotRevision: string | null;
  verifiedAt: string | null;
}>;

/** One retry when the user enables the view without a usable server-side baseline. */
export function ProjectedStandingsRecovery() {
  const router = useRouter();
  const requested = useRef(false);
  useEffect(() => {
    if (requested.current) return;
    requested.current = true;
    router.refresh();
  }, [router]);
  return null;
}

export function ProjectedStandingsLive({ data, source, enabled, children }: Readonly<{
  data: StandingsData;
  source: StandingsProjectionSource;
  enabled: boolean;
  children: (result: ReturnType<typeof projectStandings>, updatedAt: string) => ReactNode;
}>) {
  const site = useLeagueSite();
  const snapshot = useMatchupSnapshot({ leagueKey: site.key, ...source, enabled, checkOnEnable: true });
  const router = useRouter();
  const refreshedPeriod = useRef<string | null>(null);
  const { activeSeason, activeWeek } = snapshot.periodContext;
  const scopeChanged = Number(data.league.season) !== activeSeason
    || (data.projectionBasis?.kind === 'ready' && data.projectionBasis.week !== activeWeek);

  useEffect(() => {
    if (!enabled || !scopeChanged || activeSeason === null || activeWeek === null) return;
    const period = `${activeSeason}/${activeWeek}`;
    if (refreshedPeriod.current === period) return;
    refreshedPeriod.current = period;
    router.refresh();
  }, [activeSeason, activeWeek, enabled, router, scopeChanged]);

  return children(projectStandings(data, snapshot.data, snapshot.periodContext), snapshot.updatedAt);
}
