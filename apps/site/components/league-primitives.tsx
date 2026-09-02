'use client';

import Image from 'next/image';
import { useState, type ReactNode } from 'react';
import type { League, Team } from '../lib/types';
import { Icon } from './icon';
import { useTeamPreferenceContext } from './team-preference';

export function formatNumber(value: number | null | undefined, digits = 2) {
  return typeof value === 'number' && Number.isFinite(value)
    ? value.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits }) : '—';
}

export function teamRecord(team: Team) {
  return `${team.wins}–${team.losses}${team.ties ? `–${team.ties}` : ''}`;
}

export function Avatar({ team, large = false }: { team: Team; large?: boolean }) {
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const failed = failedUrl === team.avatar;
  const initials = (team.managerName || team.name).split(/\s+/).filter(Boolean).slice(0, 2).map(part => part[0]).join('').toUpperCase();
  return <span className={`avatar ${large ? 'avatar-large' : ''}`} aria-hidden="true">
    {team.avatar && !failed ? <Image src={team.avatar} alt="" width={large ? 64 : 40} height={large ? 64 : 40} unoptimized onError={() => setFailedUrl(team.avatar)} /> : <span>{initials || 'FF'}</span>}
  </span>;
}

export function LeagueMeta({ league }: { league: League }) {
  return <p className="eyebrow">{league.season} season</p>;
}

export function PageHeading({ title, description, league }: { title: string; description: string; league: League }) {
  return <div className="page-heading"><LeagueMeta league={league} /><div className="heading-row"><div><h1>{title}</h1><p className="page-description">{description}</p></div></div></div>;
}

export function Warning({ message }: { message?: string }) {
  return message ? <div className="data-warning" role="status"><span className="warning-symbol" aria-hidden="true">!</span><p>{message}</p></div> : null;
}

export function Updated({ value, refreshing = false }: { value: string; refreshing?: boolean }) {
  const date = new Date(value);
  const time = Number.isNaN(date.getTime()) ? null : date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York' });
  return <p className="updated" aria-live="polite">{refreshing ? 'Checking Sleeper for updates…' : time ? <>Page refreshed {time} ET · Sleeper data may be cached</> : 'Data from Sleeper may be cached'}</p>;
}

export function EmptyState({ title, children }: { title: string; children: ReactNode }) {
  return <div className="empty-state"><span className="empty-mark" aria-hidden="true"><Icon name="matchups" /></span><h2>{title}</h2><p>{children}</p></div>;
}

export function MyTeamButton({ team, compact = false }: { team: Team; compact?: boolean }) {
  const { selected, select } = useTeamPreferenceContext();
  const active = selected === team.id;
  return <button type="button" className={`my-team-button ${active ? 'is-selected' : ''} ${compact ? 'compact' : ''}`} onClick={() => select(active ? null : team.id)} aria-pressed={active} aria-label={active ? `Clear ${team.name} as My Team` : `Select ${team.name} as My Team`}><Icon name={active ? 'check' : 'star'} />{active ? 'My Team' : 'Select my team'}</button>;
}
