import type { Metadata } from 'next';
import type { ReactNode } from 'react';

export const metadata: Metadata = {
  title: { default: 'League Two · Fantasy Football', template: '%s · League Two' },
  description: 'The home of League Two fantasy football. Matchups, standings, managers, and team activity.',
};

export default function LeagueTwoLayout({ children }: { children: ReactNode }) {
  return children;
}
