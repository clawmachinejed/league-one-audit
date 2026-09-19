'use client';

import { createContext, useContext, type ReactNode } from 'react';
import type { ManagerHonors } from '../lib/manager-honors';
import type { Team } from '../lib/types';
import { useLeagueConnectionId } from './league-context';

const ManagerHonorsContext = createContext<ManagerHonors | null>(null);
const noChampionships: readonly number[] = [];

/** A page's resolved source connection and season bound the presentation map. */
export function ManagerHonorsProvider({ data, season, children }: {
  data: ManagerHonors | null;
  season: string;
  children: ReactNode;
}) {
  const leagueId = useLeagueConnectionId();
  const scoped = data?.leagueId === leagueId && data.season === season ? data : null;
  return <ManagerHonorsContext.Provider value={scoped}>{children}</ManagerHonorsContext.Provider>;
}

/** Polling can replace a matchup/roster payload independently of the page. */
export function ManagerHonorsSeason({ season, children }: { season: string; children: ReactNode }) {
  const data = useContext(ManagerHonorsContext);
  return <ManagerHonorsContext.Provider value={data?.season === season ? data : null}>{children}</ManagerHonorsContext.Provider>;
}

export function useManagerChampionshipYears(team: Pick<Team, 'id' | 'managerName'>,
  league: 'league1' | 'league2' = 'league1'): readonly number[] {
  const data = useContext(ManagerHonorsContext);
  const manager = data?.managers[team.id];
  if (manager?.managerName !== team.managerName) return noChampionships;
  return (league === 'league1' ? manager.championshipYears : manager.promotionChampionshipYears) ?? noChampionships;
}
