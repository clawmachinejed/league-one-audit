'use client';

import Link from 'next/link';
import type { ManagersData } from '../lib/types';
import { useLeagueSite } from './league-context';
import { Avatar, EmptyState, teamRecord, Updated, Warning } from './league-primitives';
import matchupStyles from './matchups.module.css';
import { PageIntro } from './page-intro';
import { ManagerName } from './manager-name';
import { useTeamPreference } from './team-preference';
import { useSiteWeekRollover, type SiteWeekRollover } from './use-site-week-rollover';

export function ManagersView({ data, rollover }: { data: ManagersData; rollover?: SiteWeekRollover | null }) {
  useSiteWeekRollover(rollover);
  const site = useLeagueSite();
  const { selected, storageWarning } = useTeamPreference(data.teams);
  const teams = [...data.teams].sort((a, b) => a.managerName.localeCompare(b.managerName));
  return <div className={matchupStyles.page}>
    <div className={matchupStyles.toolbar}><PageIntro title="Managers" league={data.league} /></div>
    <Warning message={data.warning} />
    <Warning message={storageWarning} />
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
    <Updated value={data.updatedAt} />
  </div>;
}
