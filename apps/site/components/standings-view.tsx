'use client';

import Link from 'next/link';
import { useId, useRef, useState, type KeyboardEvent } from 'react';
import type { projectStandings } from '../lib/projected-standings';
import type { LeagueTransactionsData, StandingsData, StandingsTeam } from '../lib/types';
import { Avatar, EmptyState, teamRecord, Updated, Warning } from './league-primitives';
import { useLeagueSite } from './league-context';
import matchupStyles from './matchups.module.css';
import { PageIntro } from './page-intro';
import {
  initialStandingsSorts,
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
import { RostersView } from './rosters-view';
import rosterStyles from './rosters.module.css';
import { ProjectedStandingsSwitch } from './projected-standings-switch';
import { ProjectedStandingsLive, ProjectedStandingsRecovery, type StandingsProjectionSource } from './projected-standings-live';
import { useSiteWeekRollover, type SiteWeekRollover } from './use-site-week-rollover';

type Column = Readonly<{ key: StandingsSortKey; label: string; className: string }>;

const viewOptions: ReadonlyArray<Readonly<{ value: StandingsViewName; label: string }>> = [
  { value: 'standings', label: 'Standings' },
  { value: 'waivers', label: 'Waivers' },
  { value: 'transactions', label: 'Transactions' },
  { value: 'rosters', label: 'Rosters' },
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

export function standingsHaveScoringEvidence(teams: readonly StandingsTeam[]): boolean {
  return teams.some(team => {
    const record = [team.wins, team.losses, team.ties];
    const completedRecord = record.every(value => Number.isInteger(value) && value >= 0)
      && record.some(value => value > 0);
    const scoredPoints = [team.pointsFor, team.pointsAgainst]
      .some(value => typeof value === 'number' && Number.isFinite(value) && value !== 0);
    return completedRecord || scoredPoints;
  });
}

export function formatStandingsPoints(value: number | null | undefined, scoringHasBegun: boolean): string {
  return scoringHasBegun && typeof value === 'number' && Number.isFinite(value)
    ? value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '—';
}

function metricValue(team: RankedStandingsTeam, key: StandingsSortKey, scoringHasBegun: boolean): string | number {
  switch (key) {
    case 'rank': return team.rank;
    case 'record': return teamRecord(team);
    case 'pointsFor': return formatStandingsPoints(team.pointsFor, scoringHasBegun);
    case 'pointsAgainst': return formatStandingsPoints(team.pointsAgainst, scoringHasBegun);
    case 'waiverOrder': return Number.isInteger(team.waiverOrder) && team.waiverOrder! > 0 ? team.waiverOrder! : '—';
    case 'waiverBudget': return formatWaiverBalance(team.waiverBudgetRemaining);
    case 'team': return team.name;
  }
}

function StandingsRank({ rank, actualRank }: { rank: number; actualRank?: number }) {
  const movement = actualRank === undefined ? null : actualRank - rank;
  const direction = movement === null || movement === 0 ? 'unchanged' : movement > 0 ? 'up' : 'down';
  const label = movement === 0 ? `No change from actual rank ${actualRank}`
    : `${direction === 'up' ? 'Up' : 'Down'} ${Math.abs(movement ?? 0)} ${Math.abs(movement ?? 0) === 1 ? 'place' : 'places'} from actual rank ${actualRank}`;

  return <span className="standings-rank"><span data-standings-rank>{rank}</span>
    {movement !== null && <span className="standings-rank-movement" data-direction={direction} role="img" aria-label={label}>
      {movement === 0 ? <span aria-hidden="true">—</span> : <>
        <svg aria-hidden="true" viewBox="0 0 10 12" fill="none">
          <path d={movement > 0 ? 'M5 11V1M1 5l4-4 4 4' : 'M5 1v10M1 7l4 4 4-4'} />
        </svg>
        <span aria-hidden="true">{Math.abs(movement)}</span>
      </>}
    </span>}
  </span>;
}

export function StandingsView({ data, projectionSource = null, rollover }: { data: StandingsData; projectionSource?: StandingsProjectionSource | null; rollover?: SiteWeekRollover | null }) {
  useSiteWeekRollover(rollover);
  const site = useLeagueSite();
  const { selected } = useTeamPreference(data.teams);
  const [view, setView] = useState<StandingsViewName>('standings');
  const [projected, setProjected] = useState(false);
  const [rosterControlsTarget, setRosterControlsTarget] = useState<HTMLDivElement | null>(null);
  const [sorts, setSorts] = useState<Record<StandingsTableViewName, StandingsSort | null>>(initialStandingsSorts);
  const [transactionState, setTransactionState] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const [transactionData, setTransactionData] = useState<LeagueTransactionsData | null>(null);
  const [transactionError, setTransactionError] = useState<string | null>(null);
  const transactionRequestStarted = useRef(false);
  const tabRefs = useRef<Record<StandingsViewName, HTMLButtonElement | null>>({ standings: null, waivers: null, transactions: null, rosters: null });
  const id = useId();
  const tableView: StandingsTableViewName = view === 'waivers' ? 'waivers' : 'standings';
  const columns = tableView === 'standings' ? standingsColumns : waiverColumns;
  const emptyTitle = view === 'standings' ? 'League standings are on their way' : 'Waivers are on their way';
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
    if (event.key === 'End') next = 'rosters';
    if (!next) return;
    event.preventDefault();
    selectView(next);
    tabRefs.current[next]?.focus();
  }

  function sortBy(key: StandingsSortKey) {
    setSorts(current => ({ ...current, [tableView]: nextStandingsSort(current[tableView], key) }));
  }

  function renderStandings(projection: ReturnType<typeof projectStandings> | null, projectedUpdatedAt?: string) {
    const displayedProjection = projected && view === 'standings' && projection?.kind === 'projected' ? projection : null;
    const displayedTeams = displayedProjection?.teams ?? data.teams;
    const rankedTeams = rankStandingsTeams(displayedTeams);
    const actualRanks = new Map(rankStandingsTeams(data.teams).map(team => [team.id, team.rank]));
    const scoringHasBegun = standingsHaveScoringEvidence(displayedTeams);
    const teams = sortStandingsTeams(rankedTeams, sorts[tableView]);
    const unresolvedTeamIds = new Set(displayedProjection?.coverage.unresolvedTeamIds ?? []);
    const provisional = unresolvedTeamIds.size > 0;
    const provisionalNote = displayedProjection && provisional
      ? `Provisional: ${displayedProjection.coverage.includedMatchups} of ${displayedProjection.coverage.totalMatchups} Week ${displayedProjection.week} matchups included. Marked teams retain completed-week records and points; all ranks are recalculated.`
      : null;
    const note = view === 'standings'
      ? `${provisionalNote ? `${provisionalNote} ` : displayedProjection ? `Includes Week ${displayedProjection.week} live matchup projections as results · ` : ''}PF = points for · PA = points against`
      : 'Order = current waiver claim priority · $ = budget remaining';
    const unavailableReason = projection?.kind === 'unavailable' ? projection.reason
      : data.projectionBasis?.kind === 'unavailable' ? data.projectionBasis.reason
        : 'Live matchup projections are temporarily unavailable.';
    const status = !projected ? 'Off'
      : displayedProjection ? `Week ${displayedProjection.week} · ${provisional ? 'Provisional' : 'Live'}` : 'Unavailable';

    return <div className={`${matchupStyles.page} ${matchupStyles.standingsPage}`}>
    <div className={matchupStyles.toolbar}><PageIntro title="League" league={data.league} />
      {view === 'standings' && <ProjectedStandingsSwitch checked={projected} onChange={setProjected} status={status} />}
      <div ref={setRosterControlsTarget} className={rosterStyles.headerControls} hidden={view !== 'rosters'} />
    </div>
    {(view === 'standings' || view === 'waivers') && <Warning message={data.warning} />}
    {projected && view === 'standings' && !displayedProjection && <Warning message={`Showing official standings. ${unavailableReason}`} />}
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
    {view === 'transactions' ? <div id={panelId} className="standings-view-panel" role="tabpanel" aria-labelledby={`${id}-transactions-tab`}>
      <LeagueTransactionsView state={transactionState === 'idle' ? 'loading' : transactionState} data={transactionData} error={transactionError} />
    </div> : view === 'rosters' ? null : data.teams.length ? <div
      id={panelId}
      className="standings-view-panel standings-wrap"
      role="tabpanel"
      aria-labelledby={`${id}-${view}-tab`}
    ><table className="standings-table" data-view={tableView} data-projected={Boolean(displayedProjection)} data-provisional={provisional}>
      <caption className="sr-only">{view === 'standings'
        ? provisionalNote ? `Projected standings. ${provisionalNote}`
          : displayedProjection ? `Projected standings including Week ${displayedProjection.week} live matchup projections as results.`
          : 'League standings with official rank, team, record, points for, and points against.'
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
        <td className="rank-cell"><StandingsRank rank={team.rank} actualRank={displayedProjection ? actualRanks.get(team.id) : undefined} /></td>
        <th scope="row" className="team-cell"><Link
          href={`${site.prefix}/managers/${team.id}`}
          className="standings-team"
          aria-label={`${team.name}, managed by ${team.managerName}${selected === team.id ? ', My Team' : ''}${unresolvedTeamIds.has(team.id) ? `, Week ${displayedProjection!.week} not included` : ''}`}
        ><span className="team-text"><span className="team-name">{team.name}</span><span className="manager-meta"><Avatar team={team} />
          <span className="manager-name">{selected === team.id && <span className="my-team-label">MY TEAM<span aria-hidden="true"> · </span></span>}{team.managerName}</span>
        </span>{unresolvedTeamIds.has(team.id) && <span className="manager-name" data-projection-excluded>Week {displayedProjection!.week} not included</span>}</span></Link></th>
        {columns.slice(2).map(column => <td key={column.key} className={column.className}>{metricValue(team, column.key, scoringHasBegun)}</td>)}
      </tr>)}</tbody>
    </table></div> : <div className="standings-view-panel"><EmptyState title={emptyTitle}>Teams will appear when Sleeper has league rosters available.</EmptyState></div>}
    <div id={view === 'rosters' ? panelId : undefined} className="standings-view-panel" role={view === 'rosters' ? 'tabpanel' : undefined} aria-labelledby={view === 'rosters' ? `${id}-rosters-tab` : undefined} hidden={view !== 'rosters'}>
      <RostersView active={view === 'rosters'} league={data.league} selected={selected} controlsTarget={rosterControlsTarget} />
    </div>
    {(view === 'standings' || view === 'waivers') && <p className="table-note">{note}</p>}
    {(view === 'standings' || view === 'waivers') && <Updated value={displayedProjection ? projectedUpdatedAt ?? data.updatedAt : data.updatedAt} />}
  </div>;
  }

  return projectionSource
    ? <ProjectedStandingsLive data={data} source={projectionSource} enabled={projected && view === 'standings'}>{renderStandings}</ProjectedStandingsLive>
    : <>{projected && view === 'standings' && <ProjectedStandingsRecovery />}{renderStandings(null)}</>;
}
