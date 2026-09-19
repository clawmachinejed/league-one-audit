'use client';

import Link from 'next/link';
import Image from 'next/image';
import type { ManagersData } from '../lib/types';
import { useLeagueSite } from './league-context';
import { Avatar, EmptyState, teamRecord, Updated, Warning } from './league-primitives';
import matchupStyles from './matchups.module.css';
import { PageIntro } from './page-intro';
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
            <h2><span className="manager-card-name">{team.managerName}</span>
              {team.championshipYears.length > 0 && <span className="manager-championships" role="img"
                aria-label={`${team.championshipYears.length} League One championship${team.championshipYears.length === 1 ? '' : 's'}: ${team.championshipYears.join(', ')}`}
                title={`League One Trophy Bowl champion: ${team.championshipYears.join(', ')}`}>
                {team.championshipYears.map(year => <Image key={year} src="/league-one-champion-v1.png"
                  alt="" width={17} height={20} sizes="17px" className="manager-championship-trophy" />)}
              </span>}
            </h2>
            <p className="manager-card-meta"><span className="manager-card-team">{team.name}</span>{selected === team.id && <span className="manager-card-selected">My Team</span>}</p>
          </div>
          <span className="manager-card-record">{teamRecord(team)}<small>RECORD</small></span>
        </Link>
      </article>)}</div> : <EmptyState title="Managers are on their way">The directory will populate when league rosters are available from Sleeper.</EmptyState>}
    <Updated value={data.updatedAt} />
  </div>;
}
