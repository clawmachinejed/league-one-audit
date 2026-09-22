import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { LEAGUE_SITES } from '@/lib/leagues';

export const metadata: Metadata = {
  title: { default: 'League Two · Fantasy Football', template: '%s · League Two' },
  description: 'The home of League Two fantasy football. Matchups, standings, managers, and team activity.',
  icons: { icon: LEAGUE_SITES.league2.logo, apple: LEAGUE_SITES.league2.logo },
};

export default function LeagueTwoLayout({ children }: { children: ReactNode }) {
  return children;
}
