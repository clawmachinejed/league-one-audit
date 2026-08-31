import type { Metadata, Viewport } from 'next';
import { AppShell } from '@/components/league-ui';
import { LEAGUE_ID } from '@/lib/config';
import './globals.css';
export const metadata: Metadata = {
  title: { default: 'League One · Fantasy Football', template: '%s · League One' },
  description: 'Your league. Your team. Every matchup. The home of League One fantasy football.',
  robots: process.env.VERCEL_ENV && process.env.VERCEL_ENV !== 'production' ? { index: false, follow: false } : { index: true, follow: true },
};
export const viewport: Viewport = { width: 'device-width', initialScale: 1, themeColor: '#f6f5f0' };
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body><AppShell leagueId={LEAGUE_ID}>{children}</AppShell></body></html>;
}
