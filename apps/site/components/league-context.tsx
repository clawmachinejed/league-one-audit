'use client';

import { createContext, useContext, type ReactNode } from 'react';
import type { LeagueSite } from '../lib/leagues';

const LeagueSiteContext = createContext<LeagueSite | null>(null);
const LeagueConnectionContext = createContext<string | null>(null);

export function LeagueSiteProvider({ children, site, leagueId = null }: { children: ReactNode; site: LeagueSite; leagueId?: string | null }) {
  return <LeagueSiteContext.Provider value={site}><LeagueConnectionContext.Provider value={leagueId}>
    {children}
  </LeagueConnectionContext.Provider></LeagueSiteContext.Provider>;
}

export function useLeagueConnectionId() { return useContext(LeagueConnectionContext); }

export function useLeagueSite(): LeagueSite {
  const site = useContext(LeagueSiteContext);
  if (!site) throw new Error('useLeagueSite must be used within LeagueSiteProvider.');
  return site;
}
