'use client';

import Link from 'next/link';
import type { OverviewData } from '../lib/types';
import { Avatar, EmptyState, formatNumber, PageHeading, teamRecord, Updated, Warning } from './league-primitives';
import { useTeamPreference } from './team-preference';

export function StandingsView({ data }: { data: OverviewData }) {
  const { selected } = useTeamPreference(data.teams);
  return <>
    <PageHeading title="Standings" description="The league, at a glance." league={data.league} />
    <Warning message={data.warning} />
    <div className="section-label"><h2>League table</h2><span>{data.teams.length} teams</span></div>
    {data.teams.length ? <div className="standings-wrap"><table className="standings-table">
      <caption className="sr-only">League standings, ordered by record, points scored, then points against. Points against is available on wider screens.</caption>
      <thead><tr><th scope="col" className="rank-cell">#</th><th scope="col">Team</th><th scope="col" className="number-cell"><abbr title="Wins, losses, and ties">W–L</abbr></th><th scope="col" className="number-cell"><abbr title="Points for">PF</abbr></th><th scope="col" className="number-cell standings-extra"><abbr title="Points against">PA</abbr></th></tr></thead>
      <tbody>{data.teams.map((team, index) => <tr key={team.id} className={selected === team.id ? 'selected-row' : ''}>
        <td className="rank-cell"><span className={index < 3 ? 'rank-top' : ''}>{index + 1}</span></td>
        <th scope="row"><Link href={`/owners/${team.id}`} className="standings-team"><Avatar team={team} /><span className="team-text"><span className="team-name">{team.name}</span><span className="owner-name">{selected === team.id && <span className="my-team-label">MY TEAM<span aria-hidden="true"> · </span></span>}{team.ownerName}</span></span></Link></th>
        <td className="number-cell record-cell">{teamRecord(team)}</td><td className="number-cell points-cell">{formatNumber(team.pointsFor, 2)}</td><td className="number-cell standings-extra points-cell">{formatNumber(team.pointsAgainst, 2)}</td>
      </tr>)}</tbody>
    </table></div> : <EmptyState title="The league table is on its way">Teams will appear when Sleeper has league rosters available.</EmptyState>}
    <p className="table-note">Ordered by record, then points for, then points against. <span>PF = points for<span className="standings-extra-inline"> · PA = points against</span>.</span></p>
    <Updated value={data.updatedAt} />
  </>;
}
