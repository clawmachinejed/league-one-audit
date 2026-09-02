'use client';

import { createContext, useContext, type ReactNode } from 'react';
import type { LeagueSite } from '../lib/leagues';

const LeagueSiteContext = createContext<LeagueSite | null>(null);

export function LeagueSiteProvider({ children, site }: { children: ReactNode; site: LeagueSite }) {
  return <LeagueSiteContext.Provider value={site}>{children}</LeagueSiteContext.Provider>;
}

export function useLeagueSite(): LeagueSite {
  const site = useContext(LeagueSiteContext);
  if (!site) throw new Error('useLeagueSite must be used within LeagueSiteProvider.');
  return site;
}
