'use client';

import Link from 'next/link';
import { useId, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import type { LeagueTransactionsData, StandingsData } from '../lib/types';
import { EmptyState, formatNumber, teamRecord, Updated, Warning } from './league-primitives';
import { useLeagueSite } from './league-context';
import matchupStyles from './matchups.module.css';
import { PageIntro } from './page-intro';
import {
  nextStandingsSort,
  rankStandingsTeams,
  sortStandingsTeams,
  type RankedStandingsTeam,
  type StandingsSort,
  type StandingsSortKey,
  type StandingsTableViewName,
  type StandingsViewName,
} from './standings-sort';
import { useTeamPreference } from './team-preference';
import { LeagueTransactionsView } from './league-transactions-view';

type Column = Readonly<{ key: StandingsSortKey; label: string; className: string }>;

const viewOptions: ReadonlyArray<Readonly<{ value: StandingsViewName; label: string }>> = [
  { value: 'standings', label: 'Standings' },
  { value: 'waivers', label: 'Waivers' },
  { value: 'transactions', label: 'Transactions' },
];
const standingsColumns: readonly Column[] = [
  { key: 'rank', label: 'Rank', className: 'rank-cell' },
  { key: 'team', label: 'Team', className: 'team-cell' },
  { key: 'record', label: 'W–L', className: 'metric-cell record-cell' },
  { key: 'pointsFor', label: 'PF', className: 'metric-cell points-cell' },
  { key: 'pointsAgainst', label: 'PA', className: 'metric-cell points-cell' },
];
const waiverColumns: readonly Column[] = [
  { key: 'rank', label: 'Rank', className: 'rank-cell' },
  { key: 'team', label: 'Team', className: 'team-cell' },
  { key: 'record', label: 'W–L', className: 'metric-cell record-cell' },
  { key: 'waiverOrder', label: 'Order', className: 'metric-cell order-cell' },
  { key: 'waiverBudget', label: '$', className: 'metric-cell budget-cell' },
];

export function formatWaiverBalance(value: number | null): string {
  return value === null ? '—' : `$${value}`;
}

function metricValue(team: RankedStandingsTeam, key: StandingsSortKey): string | number {
  switch (key) {
    case 'rank': return team.rank;
    case 'record': return teamRecord(team);
    case 'pointsFor': return formatNumber(team.pointsFor, 2);
    case 'pointsAgainst': return formatNumber(team.pointsAgainst, 2);
    case 'waiverOrder': return team.waiverOrder ?? '—';
    case 'waiverBudget': return formatWaiverBalance(team.waiverBudgetRemaining);
    case 'team': return team.name;
  }
}

export function StandingsView({ data }: { data: StandingsData }) {
  const site = useLeagueSite();
  const { selected } = useTeamPreference(data.teams);
  const [view, setView] = useState<StandingsViewName>('standings');
  const [sorts, setSorts] = useState<Record<StandingsTableViewName, StandingsSort | null>>({ standings: null, waivers: null });
  const [transactionState, setTransactionState] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const [transactionData, setTransactionData] = useState<LeagueTransactionsData | null>(null);
  const [transactionError, setTransactionError] = useState<string | null>(null);
  const transactionRequestStarted = useRef(false);
  const tabRefs = useRef<Record<StandingsViewName, HTMLButtonElement | null>>({ standings: null, waivers: null, transactions: null });
  const id = useId();
  const rankedTeams = useMemo(() => rankStandingsTeams(data.teams), [data.teams]);
  const tableView: StandingsTableViewName = view === 'waivers' ? 'waivers' : 'standings';
  const teams = useMemo(() => sortStandingsTeams(rankedTeams, sorts[tableView]), [rankedTeams, sorts, tableView]);
  const columns = tableView === 'standings' ? standingsColumns : waiverColumns;
  const sectionTitle = view === 'standings' ? 'League table' : 'Waiver table';
  const note = view === 'standings'
    ? 'PF = points for · PA = points against'
    : 'Order = current waiver claim priority · $ = budget remaining';
  const panelId = `${id}-standings-panel`;

  async function loadTransactions() {
    if (transactionRequestStarted.current || transactionState === 'ready') return;
    transactionRequestStarted.current = true;
    setTransactionState('loading');
    setTransactionError(null);
    try {
      const response = await fetch(`/api/transactions/${site.key}`, { headers: { Accept: 'application/json' } });
      const payload = await response.json() as LeagueTransactionsData | { error?: string };
      if (!response.ok || !('activities' in payload)) {
        throw new Error('error' in payload && payload.error ? payload.error : 'League transaction history is temporarily unavailable.');
      }
      setTransactionData(payload);
      setTransactionState('ready');
    } catch (error) {
      transactionRequestStarted.current = false;
      setTransactionError(error instanceof Error ? error.message : 'League transaction history is temporarily unavailable.');
      setTransactionState('error');
    }
  }

  function selectView(next: StandingsViewName) {
    setView(next);
    if (next === 'transactions') void loadTransactions();
  }

  function handleTabKey(event: KeyboardEvent<HTMLButtonElement>, current: StandingsViewName) {
    let next: StandingsViewName | null = null;
    const index = viewOptions.findIndex(option => option.value === current);
    if (event.key === 'ArrowRight') next = viewOptions[(index + 1) % viewOptions.length].value;
    if (event.key === 'ArrowLeft') next = viewOptions[(index - 1 + viewOptions.length) % viewOptions.length].value;
    if (event.key === 'Home') next = 'standings';
    if (event.key === 'End') next = 'transactions';
    if (!next) return;
    event.preventDefault();
    selectView(next);
    tabRefs.current[next]?.focus();
  }

  function sortBy(key: StandingsSortKey) {
    setSorts(current => ({ ...current, [tableView]: nextStandingsSort(current[tableView], key) }));
  }

  return <div className={`${matchupStyles.page} ${matchupStyles.standingsPage}`}>
    <div className={matchupStyles.toolbar}><PageIntro title="Standings" league={data.league} /></div>
    {view !== 'transactions' && <Warning message={data.warning} />}
    {view !== 'transactions' && <div className="section-label"><h2>{sectionTitle}</h2><span>{data.teams.length} teams</span></div>}
    <div className="standings-view-tabs" role="tablist" aria-label="Standings views">
      {viewOptions.map(option => <button
        key={option.value}
        ref={element => { tabRefs.current[option.value] = element; }}
        id={`${id}-${option.value}-tab`}
        type="button"
        role="tab"
        aria-controls={panelId}
        aria-selected={view === option.value}
        tabIndex={view === option.value ? 0 : -1}
        onClick={() => selectView(option.value)}
        onKeyDown={event => handleTabKey(event, option.value)}
      >{option.label}</button>)}
    </div>
    {view === 'transactions' ? <div id={panelId} role="tabpanel" aria-labelledby={`${id}-transactions-tab`}>
      <LeagueTransactionsView state={transactionState === 'idle' ? 'loading' : transactionState} data={transactionData} error={transactionError} />
    </div> : data.teams.length ? <div
      id={panelId}
      className="standings-wrap"
      role="tabpanel"
      aria-labelledby={`${id}-${view}-tab`}
    ><table className="standings-table" data-view={tableView}>
      <caption className="sr-only">{view === 'standings'
        ? 'League standings with official rank, team, record, points for, and points against.'
        : 'Waiver table with official standings rank, team, record, waiver claim priority, and budget remaining.'}</caption>
      <colgroup><col className="standings-rank-column" /><col className="standings-team-column" /><col className="standings-metric-column" /><col className="standings-metric-column" /><col className="standings-metric-column" /></colgroup>
      <thead><tr>{columns.map(column => {
        const activeDirection = sorts[tableView]?.key === column.key ? sorts[tableView]?.direction : null;
        return <th key={column.key} scope="col" className={column.className} aria-sort={activeDirection ?? 'none'}>
          <button type="button" className="standings-sort-button" aria-label={`Sort by ${column.label}`} onClick={() => sortBy(column.key)}>
            <span className="standings-sort-label">{column.label}</span>
            <span className="standings-sort-indicator" data-direction={activeDirection ?? 'neutral'} aria-hidden="true" />
          </button>
        </th>;
      })}</tr></thead>
      <tbody>{teams.map(team => <tr key={team.id} className={selected === team.id ? 'selected-row' : ''}>
        <td className="rank-cell"><span className={team.rank <= 3 ? 'rank-top' : ''}>{team.rank}</span></td>
        <th scope="row" className="team-cell"><Link
          href={`${site.prefix}/managers/${team.id}`}
          className="standings-team"
          aria-label={`${team.name}, managed by ${team.managerName}${selected === team.id ? ', My Team' : ''}`}
        ><span className="team-text"><span className="team-name">{team.name}</span><span className="manager-name">{selected === team.id && <span className="my-team-label">MY TEAM<span aria-hidden="true"> · </span></span>}{team.managerName}</span></span></Link></th>
        {columns.slice(2).map(column => <td key={column.key} className={column.className}>{metricValue(team, column.key)}</td>)}
      </tr>)}</tbody>
    </table></div> : <EmptyState title={`The ${sectionTitle.toLowerCase()} is on its way`}>Teams will appear when Sleeper has league rosters available.</EmptyState>}
    {view !== 'transactions' && <p className="table-note">{note}</p>}
    {view !== 'transactions' && <Updated value={data.updatedAt} />}
  </div>;
}
