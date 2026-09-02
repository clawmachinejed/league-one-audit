'use client';

import Link from 'next/link';
import type { OverviewData } from '../lib/types';
import { Icon } from './icon';
import { useLeagueSite } from './league-context';
import { Avatar, EmptyState, formatNumber, MyTeamButton, PageHeading, teamRecord, Updated, Warning } from './league-primitives';
import { useTeamPreference } from './team-preference';

export function OwnersView({ data }: { data: OverviewData }) {
  const site = useLeagueSite();
  const { selected, select, storageWarning } = useTeamPreference(data.teams);
  const myTeam = data.teams.find(team => team.id === selected);
  const teams = [...data.teams].sort((a, b) => a.ownerName.localeCompare(b.ownerName));
  return <>
    <PageHeading title="Owners" description={`The people and teams of ${site.name}.`} league={data.league} />
    <Warning message={data.warning} />
    <Warning message={storageWarning} />
    <div className={`preference-banner ${myTeam ? 'has-preference' : ''}`}><span className="preference-icon"><Icon name={myTeam ? 'check' : 'star'} /></span><div><h2>{myTeam ? `${myTeam.name} is your team` : 'Choose your team.'}</h2><p>{myTeam ? 'Saved in this browser. Highlighted across the league.' : 'Select your team below. We’ll remember it in this browser.'}</p></div>{myTeam && <button type="button" className="text-button" onClick={() => select(null)}>Clear</button>}</div>
    <div className="section-label"><h2>The owners</h2><span>{teams.length} teams</span></div>
    {teams.length ? <div className="owners-grid">{teams.map(team => <article key={team.id} className={`owner-card ${selected === team.id ? 'selected-owner' : ''}`}><Link href={`${site.prefix}/owners/${team.id}`} className="owner-card-link"><div className="owner-card-top"><Avatar team={team} /><span className="owner-card-record">{teamRecord(team)}<small>RECORD</small></span></div><h2>{team.name}</h2><p>{team.ownerName}</p><span className="owner-profile-cta">Roster & transactions<Icon name="arrow" className="arrow-forward" /></span></Link><div className="owner-card-bottom"><MyTeamButton team={team} compact /><span className="owner-pf">{formatNumber(team.pointsFor, 2)} <abbr title="Points for">PF</abbr></span></div></article>)}</div> : <EmptyState title="Owners are on their way">The directory will populate when league rosters are available from Sleeper.</EmptyState>}
    <Updated value={data.updatedAt} />
  </>;
}
