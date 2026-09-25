import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { SITE_LOGO } from '@/lib/leagues';

export const metadata: Metadata = {
  title: { default: 'Dynasty League · Fantasy Football', template: '%s · Dynasty League' },
  description: 'The home of Dynasty League fantasy football. Matchups, standings, managers, and team activity.',
  icons: { icon: SITE_LOGO, apple: SITE_LOGO },
};

export default function DynastyLayout({ children }: { children: ReactNode }) {
  return children;
}
