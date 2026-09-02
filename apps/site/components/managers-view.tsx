'use client';

import Link from 'next/link';
import type { OverviewData } from '../lib/types';
import { Icon } from './icon';
import { useLeagueSite } from './league-context';
import { Avatar, EmptyState, formatNumber, MyTeamButton, PageHeading, teamRecord, Updated, Warning } from './league-primitives';
import { useTeamPreference } from './team-preference';

export function ManagersView({ data }: { data: OverviewData }) {
  const site = useLeagueSite();
  const { selected, select, storageWarning } = useTeamPreference(data.teams);
  const myTeam = data.teams.find(team => team.id === selected);
  const teams = [...data.teams].sort((a, b) => a.managerName.localeCompare(b.managerName));
  return <>
    <PageHeading title="Managers" description={`The people and teams of ${site.name}.`} league={data.league} />
    <Warning message={data.warning} />
    <Warning message={storageWarning} />
    <div className={`preference-banner ${myTeam ? 'has-preference' : ''}`}><span className="preference-icon"><Icon name={myTeam ? 'check' : 'star'} /></span><div><h2>{myTeam ? `${myTeam.name} is your team` : 'Choose your team.'}</h2><p>{myTeam ? 'Saved in this browser. Highlighted across the league.' : 'Select your team below. We’ll remember it in this browser.'}</p></div>{myTeam && <button type="button" className="text-button" onClick={() => select(null)}>Clear</button>}</div>
    <div className="section-label"><h2>The managers</h2><span>{teams.length} teams</span></div>
    {teams.length ? <div className="managers-grid">{teams.map(team => <article key={team.id} className={`manager-card ${selected === team.id ? 'selected-manager' : ''}`}><Link href={`${site.prefix}/managers/${team.id}`} className="manager-card-link"><div className="manager-card-top"><Avatar team={team} /><span className="manager-card-record">{teamRecord(team)}<small>RECORD</small></span></div><h2>{team.name}</h2><p>{team.managerName}</p><span className="manager-profile-cta">Roster & transactions<Icon name="arrow" className="arrow-forward" /></span></Link><div className="manager-card-bottom"><MyTeamButton team={team} compact /><span className="manager-pf">{formatNumber(team.pointsFor, 2)} <abbr title="Points for">PF</abbr></span></div></article>)}</div> : <EmptyState title="Managers are on their way">The directory will populate when league rosters are available from Sleeper.</EmptyState>}
    <Updated value={data.updatedAt} />
  </>;
}
