'use client';

import { useId, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import type {
  LeagueMoveActivity,
  LeagueTradeActivity,
  LeagueTransactionActivity,
  LeagueTransactionsData,
  LeagueWaiverActivity,
  TransactionResult,
} from '../lib/types';
import { EmptyState, Updated, Warning } from './league-primitives';
import { formatTransactionBid, transactionDateLabel, transactionMovementClass } from './transaction-format';

type Filter = 'all' | 'add_drop' | 'waiver' | 'trade';
type LoadState = 'loading' | 'ready' | 'error';

const filters: ReadonlyArray<Readonly<{ value: Filter; label: string }>> = [
  { value: 'all', label: 'All' },
  { value: 'add_drop', label: 'Adds & Drops' },
  { value: 'waiver', label: 'Waivers' },
  { value: 'trade', label: 'Trades' },
];

function resultClass(result: TransactionResult) {
  return result === 'Won' || result === 'Complete' ? 'positive'
    : result === 'Lost' || result === 'Failed' ? 'negative' : 'neutral';
}

function formatPlayer(player: NonNullable<LeagueWaiverActivity['player']>) {
  const details = [player.position === '—' ? null : player.position, player.nflTeam].filter(Boolean).join(' · ');
  return `${player.name}${details ? ` (${details})` : ''}`;
}

function MoveCard({ activity }: { activity: LeagueMoveActivity }) {
  const outcome = resultClass(activity.result);
  return <article className={`transaction-card league-activity-card result-${outcome}`} data-kind="add_drop">
    <div className="transaction-header"><div><div className="transaction-title-row"><p className="transaction-type">{activity.title}</p><span>{activity.type}</span></div><p className="transaction-date">{transactionDateLabel(activity.timestamp)}</p></div></div>
    <div className="transaction-body"><dl className="transaction-lines">{activity.lines.map((line, index) => <div key={`${index}-${line.label}`} className={transactionMovementClass(line.label)}><dt>{line.label}</dt><dd>{line.text}</dd></div>)}</dl></div>
  </article>;
}

function TradeCard({ activity }: { activity: LeagueTradeActivity }) {
  const outcome = resultClass(activity.result);
  return <article className={`transaction-card league-activity-card trade-card result-${outcome}`} data-kind="trade">
    <div className="transaction-header"><div><p className="transaction-type">Trade Completed</p><p className="transaction-date">{transactionDateLabel(activity.timestamp)}</p></div></div>
    <div className="transaction-body trade-card-body"><div className="trade-receivers" data-participants={activity.participants.length}>
      {activity.participants.map(participant => <section key={participant.id} className="trade-receiver" aria-label={`${participant.team} receives`}>
        <h3>{participant.team} receives</h3>
        <dl className="trade-assets">{participant.receives.map((asset, index) => <div key={`${asset.type}-${index}-${asset.text}`}><dt>{asset.type}</dt><dd>{asset.text}</dd></div>)}</dl>
      </section>)}
    </div></div>
  </article>;
}

function WaiverCard({ activity }: { activity: LeagueWaiverActivity }) {
  const allBidsKnown = activity.claims.every(claim => claim.bid !== null);
  const countLabel = `${activity.claims.length} reported ${allBidsKnown ? (activity.claims.length === 1 ? 'bid' : 'bids') : (activity.claims.length === 1 ? 'claim' : 'claims')}`;
  const hasWinner = activity.winners.length > 0;
  const winningTeams = [...new Set(activity.winners.map(winner => winner.team))];
  const title = winningTeams.join(', ') || (activity.player ? formatPlayer(activity.player) : 'No winning team reported');
  return <article className={`transaction-card league-activity-card waiver-card result-${hasWinner ? 'positive' : 'negative'}`} data-kind="waiver">
    <div className="transaction-header waiver-card-header"><div><div className="transaction-title-row"><p className="transaction-type">{title}</p><span>Waiver</span></div><p className="transaction-date">{transactionDateLabel(activity.processedAt)} · {countLabel}</p></div></div>
    <div className="transaction-body waiver-card-body">
      {hasWinner ? <dl className="transaction-lines waiver-winning-moves">{activity.winners.flatMap(winner => {
        const rows = [];
        if (winner.added.length) rows.push(<div key={`${winner.id}-added`} className="movement-add"><dt>Added</dt><dd>{winner.added.map(formatPlayer).join(', ')}</dd></div>);
        if (winner.dropped.length) rows.push(<div key={`${winner.id}-dropped`} className="movement-drop"><dt>Dropped</dt><dd>{winner.dropped.map(formatPlayer).join(', ')}</dd></div>);
        return rows;
      })}</dl> : <p className="waiver-no-winner">No winning claim reported</p>}
      <div className="waiver-bid-list" aria-label={`Reported claims for ${activity.player?.name ?? 'Unknown player'}`}>
        <div className="waiver-bid-heading" aria-hidden="true"><span>Team</span><span>Bid</span><span>Result</span></div>
        {activity.claims.map(claim => <div key={claim.id} className={`waiver-bid-row result-${resultClass(claim.result)}`}>
          <span className="waiver-bid-team" title={claim.team}>{claim.team}</span><span className="waiver-bid-amount">{formatTransactionBid(claim.bid)}</span><span className="waiver-bid-result">{claim.result}</span>
        </div>)}
      </div>
    </div>
  </article>;
}

export function LeagueTransactionsView({ state, data, error }: {
  state: LoadState;
  data: LeagueTransactionsData | null;
  error: string | null;
}) {
  const [filter, setFilter] = useState<Filter>('all');
  const tabRefs = useRef<Record<Filter, HTMLButtonElement | null>>({ all: null, add_drop: null, waiver: null, trade: null });
  const id = useId();
  const filtered = useMemo(() => data?.activities.filter(activity => filter === 'all' || activity.kind === filter) ?? [], [data, filter]);

  function selectFilter(next: Filter) {
    setFilter(next);
  }

  function handleFilterKey(event: KeyboardEvent<HTMLButtonElement>, current: Filter) {
    const index = filters.findIndex(option => option.value === current);
    let nextIndex: number | null = null;
    if (event.key === 'ArrowRight') nextIndex = (index + 1) % filters.length;
    if (event.key === 'ArrowLeft') nextIndex = (index - 1 + filters.length) % filters.length;
    if (event.key === 'Home') nextIndex = 0;
    if (event.key === 'End') nextIndex = filters.length - 1;
    if (nextIndex === null) return;
    event.preventDefault();
    const next = filters[nextIndex].value;
    selectFilter(next);
    tabRefs.current[next]?.focus();
  }

  return <div className="league-transactions-panel">
    <div className="league-activity-heading"><div><h2>League Activity</h2><p>Newest transactions first</p></div>{data && <span>{data.activities.length} {data.activities.length === 1 ? 'item' : 'items'}</span>}</div>
    {state === 'loading' && <div className="transactions-inline-state" role="status" aria-live="polite">Loading league activity…</div>}
    {state === 'error' && <div aria-live="polite"><EmptyState title="League transactions unavailable">{error ?? 'Transaction history could not be loaded. Standings and Waivers remain available.'}</EmptyState></div>}
    {state === 'ready' && data && <>
      <p className="sr-only" role="status">League activity loaded.</p>
      <Warning message={data.warning} />
      <div className="transaction-filters" role="tablist" aria-label="Transaction filters">{filters.map(option => <button
        key={option.value}
        ref={element => { tabRefs.current[option.value] = element; }}
        id={`${id}-${option.value}-filter`}
        type="button"
        role="tab"
        aria-controls={`${id}-activity-list`}
        aria-selected={filter === option.value}
        tabIndex={filter === option.value ? 0 : -1}
        onClick={() => selectFilter(option.value)}
        onKeyDown={event => handleFilterKey(event, option.value)}
      >{option.label}</button>)}</div>
      <div id={`${id}-activity-list`} role="tabpanel" aria-labelledby={`${id}-${filter}-filter`}>
        {filtered.length ? <div className="transactions-list league-transactions-list">{filtered.map((activity: LeagueTransactionActivity) => activity.kind === 'waiver'
          ? <WaiverCard key={activity.id} activity={activity} />
          : activity.kind === 'trade' ? <TradeCard key={activity.id} activity={activity} />
            : <MoveCard key={activity.id} activity={activity} />)}</div>
          : <EmptyState title={filter === 'all' ? 'No league transactions yet' : 'No transactions in this filter'}>{filter === 'all' ? 'Finalized Sleeper activity will appear here.' : 'Choose another filter to see finalized league activity.'}</EmptyState>}
      </div>
      <Updated value={data.updatedAt} />
      <p className="refresh-note">Claims are grouped for presentation by player and league calendar day. Sleeper does not identify a single waiver processing event.</p>
    </>}
  </div>;
}
