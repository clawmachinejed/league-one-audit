import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { SITE_LOGO } from '@/lib/leagues';

export const metadata: Metadata = {
  title: { default: 'League Two · Fantasy Football', template: '%s · League Two' },
  description: 'The home of League Two fantasy football. Matchups, standings, managers, and team activity.',
  icons: { icon: SITE_LOGO, apple: SITE_LOGO },
};

export default function LeagueTwoLayout({ children }: { children: ReactNode }) {
  return children;
}
