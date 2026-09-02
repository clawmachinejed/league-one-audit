'use client';

import Link from 'next/link';
import type { OwnerData, TransactionsData } from '../lib/types';
import { Icon } from './icon';
import { useLeagueSite } from './league-context';
import { Avatar, formatNumber, LeagueMeta, MyTeamButton, teamRecord, Warning } from './league-primitives';
import { useTeamPreferenceContext } from './team-preference';

export function OwnerHeader({ data, active }: { data: OwnerData | TransactionsData; active: 'roster' | 'transactions' }) {
  const site = useLeagueSite();
  const { storageWarning } = useTeamPreferenceContext();
  return <>
    <Link className="back-link" href={`${site.prefix}/owners`}><Icon name="arrow" />All owners</Link>
    <div className="owner-heading"><LeagueMeta league={data.league} /><div className="profile-identity"><Avatar team={data.team} large /><div><h1>{data.team.name}</h1><p>{data.team.ownerName}</p></div></div><MyTeamButton team={data.team} /></div>
    <Warning message={data.warning} />
    <Warning message={storageWarning} />
    <dl className="team-summary"><div><dt>Record</dt><dd>{teamRecord(data.team)}</dd></div><div><dt>Points for</dt><dd>{formatNumber(data.team.pointsFor, 2)}</dd></div><div><dt>Points against</dt><dd>{formatNumber(data.team.pointsAgainst, 2)}</dd></div></dl>
    <nav className="profile-tabs" aria-label="Team pages"><Link href={`${site.prefix}/owners/${data.team.id}`} aria-current={active === 'roster' ? 'page' : undefined}>Roster</Link><Link href={`${site.prefix}/owners/${data.team.id}/transactions`} aria-current={active === 'transactions' ? 'page' : undefined}>Transactions</Link></nav>
  </>;
}
