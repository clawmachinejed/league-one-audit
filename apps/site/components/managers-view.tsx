'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, type KeyboardEvent } from 'react';
import type { ManagersData } from '../lib/types';
import { useLeagueSite } from './league-context';
import { Avatar, EmptyState, teamRecord, Updated, Warning } from './league-primitives';
import matchupStyles from './matchups.module.css';
import tabStyles from './my-team-schedule.module.css';
import { PageIntro } from './page-intro';
import { ManagerName } from './manager-name';
import { useTeamPreference } from './team-preference';
import { useSiteWeekRollover, type SiteWeekRollover } from './use-site-week-rollover';

export function ManagersView({ data, rollover }: { data: ManagersData; rollover?: SiteWeekRollover | null }) {
  useSiteWeekRollover(rollover);
  const site = useLeagueSite();
  const router = useRouter();
  const view = data.history ? 'history' : 'season';
  const refs = useRef<Partial<Record<'history' | 'season', HTMLButtonElement | null>>>({});
  const pendingFocus = useRef<string | null>(null);
  useEffect(() => {
    if (pendingFocus.current !== view) return;
    refs.current[view]?.focus();
    pendingFocus.current = null;
  }, [view]);
  function select(next: 'history' | 'season') {
    if (next === view) return;
    pendingFocus.current = next;
    router.push(`${site.prefix}/managers${next === 'history' ? '?view=history' : ''}`, { scroll: false });
  }
  function onKey(event: KeyboardEvent<HTMLButtonElement>) {
    const next = event.key === 'Home' ? 'season' : event.key === 'End' ? 'history'
      : event.key === 'ArrowLeft' || event.key === 'ArrowRight' ? (view === 'history' ? 'season' : 'history') : null;
    if (next) { event.preventDefault(); select(next); }
  }
  const { selected, storageWarning } = useTeamPreference(data.teams);
  const teams = [...data.teams].sort((a, b) => a.managerName.localeCompare(b.managerName));
  const currentSeason = Number(data.league.season);
  const historyManagers = [...(data.history?.managers ?? [])].sort((a, b) =>
    Number(b.seasons.includes(currentSeason)) - Number(a.seasons.includes(currentSeason)));
  return <div className={matchupStyles.page}>
    <div className={matchupStyles.toolbar}><PageIntro title="Managers" league={data.league} /></div>
    <div className={`standings-view-tabs ${tabStyles.tabs}`} role="tablist" aria-label="Manager views">
      {(['season', 'history'] as const).map(option => <button key={option} type="button" role="tab"
        ref={element => { refs.current[option] = element; }}
        id={`managers-${option}-tab`} aria-controls="managers-view-panel" aria-selected={view === option}
        tabIndex={view === option ? 0 : -1} onClick={() => select(option)} onKeyDown={onKey}>
        {option === 'history' ? 'History' : data.league.season}
      </button>)}
    </div>
    <Warning message={data.warning} />
    <Warning message={storageWarning} />
    <div id="managers-view-panel" role="tabpanel" aria-labelledby={`managers-${view}-tab`}>
    {data.history ? <>
      <p className="manager-history-scope">{data.history.label}</p>
      <Warning message={data.history.warning} />
      <div className="managers-grid">{historyManagers.map(manager => {
        const former = !manager.seasons.includes(currentSeason);
        const content = <>
          <Avatar team={{ ...manager, name: manager.managerName }} />
          <div className="manager-card-identity">
            <h2><ManagerName team={{ id: manager.currentTeamId ?? 0, managerName: manager.managerName }}
              className="manager-card-name" championshipYears={manager.championshipYears}
              promotionChampionshipYears={manager.promotionChampionshipYears} /></h2>
            <p className="manager-card-meta">{manager.seasons.join(' · ')}</p>
          </div>
          <span className="manager-card-record" title={manager.wins === null ? 'Complete history unavailable' : 'Regular-season record'}>
            {manager.wins === null ? '—' : `${manager.wins}–${manager.losses}${manager.ties ? `–${manager.ties}` : ''}`}<small>RECORD</small>
          </span>
        </>;
        return <article key={manager.ownerId} className={`manager-card ${former ? 'former-manager' : ''} ${manager.currentTeamId !== null && selected === manager.currentTeamId ? 'selected-manager' : ''}`}>
          {manager.currentTeamId === null ? <div className="manager-card-link">{content}</div>
            : <Link href={`${site.prefix}/managers/${manager.currentTeamId}`} className="manager-card-link">{content}</Link>}
        </article>;
      })}</div>
    </> : <>
    {teams.length ? <div className="managers-grid">{teams.map(team =>
      <article key={team.id} className={`manager-card ${selected === team.id ? 'selected-manager' : ''}`}>
        <Link href={`${site.prefix}/managers/${team.id}`} className="manager-card-link">
          <Avatar team={team} />
          <div className="manager-card-identity">
            <h2><ManagerName team={team} className="manager-card-name" championshipYears={team.championshipYears}
              promotionChampionshipYears={team.promotionChampionshipYears} /></h2>
            <p className="manager-card-meta"><span className="manager-card-team">{team.name}</span>{selected === team.id && <span className="manager-card-selected">My Team</span>}</p>
          </div>
          <span className="manager-card-record">{teamRecord(team)}<small>RECORD</small></span>
        </Link>
      </article>)}</div> : <EmptyState title="Managers are on their way">The directory will populate when league rosters are available from Sleeper.</EmptyState>}
    </>}
    </div>
    <Updated value={data.updatedAt} />
  </div>;
}
