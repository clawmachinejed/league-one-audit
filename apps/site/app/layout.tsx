import type { Metadata, Viewport } from 'next';
import { AppShell } from '@/components/league-shell';
import { LEAGUE_ID } from '@/lib/config';
import './globals.css';
export const metadata: Metadata = {
  title: { default: 'League One · Fantasy Football', template: '%s · League One' },
  description: 'The home of League One fantasy football. Matchups, standings, owners, and team activity.',
  robots: process.env.VERCEL_ENV && process.env.VERCEL_ENV !== 'production' ? { index: false, follow: false } : { index: true, follow: true },
};
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#f6f5f0' },
    { media: '(prefers-color-scheme: dark)', color: '#0e1511' },
  ],
};
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en" data-scroll-behavior="smooth"><body><AppShell leagueId={LEAGUE_ID}>{children}</AppShell></body></html>;
}
