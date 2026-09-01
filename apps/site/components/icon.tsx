import type { ReactNode } from 'react';

export type IconName = 'matchups' | 'standings' | 'owners' | 'chevron' | 'arrow' | 'refresh' | 'check' | 'star';

export function Icon({ name, className = '' }: { name: IconName; className?: string }) {
  const paths: Record<IconName, ReactNode> = {
    matchups: <><path d="M5 4v16M19 4v16M3 7h6m6 10h6M9 4v6m6 4v6M9 7h6m-6 10h6" /></>,
    standings: <><path d="M4 20V10h4v10m2 0V4h4v16m2 0v-7h4v7M2 20h20" /></>,
    owners: <><circle cx="9" cy="8" r="3" /><path d="M3 20v-2a6 6 0 0 1 12 0v2m2-15a3 3 0 0 1 0 6m1 3a5 5 0 0 1 3 4v2" /></>,
    chevron: <path d="m6 9 6 6 6-6" />,
    arrow: <path d="m14 6-6 6 6 6" />,
    refresh: <><path d="M20 7v5h-5M4 17v-5h5" /><path d="M6 6a8 8 0 0 1 13 3M5 15a8 8 0 0 0 13 3" /></>,
    check: <path d="m5 12 4 4L19 6" />,
    star: <path d="m12 3 2.8 5.7 6.3.9-4.5 4.4 1.1 6.2-5.7-3-5.7 3 1.1-6.2L3.2 9.6l6.3-.9L12 3Z" />,
  };
  return <svg className={`icon ${className}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>;
}
