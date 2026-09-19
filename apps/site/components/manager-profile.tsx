'use client';

import Link from 'next/link';
import type { OverviewData, Team } from '../lib/types';
import { Icon } from './icon';
import { useLeagueSite } from './league-context';
import { Avatar, formatNumber, LeagueMeta, MyTeamButton, teamRecord, Warning } from './league-primitives';
import { useTeamPreferenceContext } from './team-preference';
import { ManagerName } from './manager-name';

export function ManagerHeader({ data, active }: {
  data: Pick<OverviewData, 'league' | 'warning'> & { team: Team };
  active: 'roster' | 'transactions' | 'schedule';
}) {
  const site = useLeagueSite();
  const { storageWarning } = useTeamPreferenceContext();
  return <>
    <Link className="back-link" href={`${site.prefix}/managers`}><Icon name="arrow" />All managers</Link>
    <div className="manager-heading"><LeagueMeta league={data.league} /><div className="profile-identity"><Avatar team={data.team} large /><div><h1>{data.team.name}</h1><p><ManagerName team={data.team} /></p></div></div><MyTeamButton team={data.team} /></div>
    <Warning message={data.warning} />
    <Warning message={storageWarning} />
    <dl className="team-summary"><div><dt>Record</dt><dd>{teamRecord(data.team)}</dd></div><div><dt>Points for</dt><dd>{formatNumber(data.team.pointsFor, 2)}</dd></div><div><dt>Points against</dt><dd>{formatNumber(data.team.pointsAgainst, 2)}</dd></div></dl>
    <nav className="profile-tabs" aria-label="Team pages">
      <Link href={`${site.prefix}/managers/${data.team.id}`} aria-current={active === 'roster' ? 'page' : undefined}>Roster</Link>
      <Link href={`${site.prefix}/managers/${data.team.id}/transactions`} aria-current={active === 'transactions' ? 'page' : undefined}>Transactions</Link>
      <Link href={`${site.prefix}/managers/${data.team.id}/schedule`} aria-current={active === 'schedule' ? 'page' : undefined}>Schedule</Link>
    </nav>
  </>;
}
