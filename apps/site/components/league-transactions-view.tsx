'use client';

import { Fragment, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import type {
  LeagueMoveActivity,
  LeagueTradeActivity,
  LeagueTransactionActivity,
  LeagueTransactionsData,
  LeagueWaiverActivity,
  TransactionPlayer,
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

function playerDetails(player: TransactionPlayer) {
  const details = [player.position === '—' ? null : player.position, player.nflTeam].filter(Boolean).join(' · ');
  return details ? `(${details})` : null;
}

function formatPlayer(player: NonNullable<LeagueWaiverActivity['player']>) {
  const details = playerDetails(player);
  return `${player.name}${details ? ` ${details}` : ''}`;
}

interface MovementRow {
  key: string;
  label: string;
  text?: string;
  players?: readonly TransactionPlayer[];
  parseText?: boolean;
}

interface MovementPlayerDisplay {
  key: string;
  name: string;
  details: string | null;
}

function parseMovementPlayerText(text: string): MovementPlayerDisplay[] | null {
  const players: MovementPlayerDisplay[] = [];
  let offset = 0;
  while (offset < text.length) {
    const match = /^([^(),\r\n]+?) (\([A-Z][A-Z0-9/-]* · [A-Z]{2,3}\))(?:, |$)/u.exec(text.slice(offset));
    if (!match) return null;
    players.push({ key: `${offset}-${match[1]}`, name: match[1], details: match[2] });
    offset += match[0].length;
  }
  return players.length ? players : null;
}

function MovementPlayers({ players }: { players: readonly MovementPlayerDisplay[] }) {
  return players.map((player, index) => <Fragment key={player.key}>
    {index > 0 ? <span className="transaction-movement-separator">, </span> : null}
    <span className="transaction-movement-player"><strong className="transaction-movement-player-name">{player.name}</strong>{player.details ? <> <span className="transaction-movement-player-details">{player.details}</span></> : null}</span>
  </Fragment>);
}

function StructuredMovementPlayers({ players }: { players: readonly TransactionPlayer[] }) {
  return <MovementPlayers players={players.map((player, index) => ({
    key: `${player.id}-${index}`,
    name: player.name,
    details: playerDetails(player),
  }))} />;
}

function MovementText({ text }: { text: string }) {
  const players = parseMovementPlayerText(text);
  return players ? <MovementPlayers players={players} /> : text;
}

function MovementRows({ rows }: { rows: readonly MovementRow[] }) {
  return <dl className="transaction-lines transaction-movement-rows">{rows.map(row => <div key={row.key} className={transactionMovementClass(row.label)}>
    <dt>{row.label}</dt><dd>{row.players?.length ? <StructuredMovementPlayers players={row.players} />
      : row.parseText && row.text ? <MovementText text={row.text} /> : row.text}</dd>
  </div>)}</dl>;
}

function MoveCard({ activity }: { activity: LeagueMoveActivity }) {
  const outcome = resultClass(activity.result);
  const outcomeLabel = activity.result === 'Failed' ? 'Failed' : activity.result === 'Unknown' ? 'Outcome unavailable' : null;
  const rows = activity.lines.map((line, index): MovementRow => ({
    key: `${index}-${line.label}`,
    ...line,
    parseText: line.label === 'Added' || line.label === 'Dropped',
  }));
  return <article className={`transaction-card league-activity-card result-${outcome}`} data-kind="add_drop">
    <div className="transaction-header"><div><div className="transaction-title-row"><p className="transaction-type">{activity.title}</p><span>{activity.type}</span></div><p className="transaction-date">{transactionDateLabel(activity.timestamp)}{outcomeLabel ? ` · ${outcomeLabel}` : ''}</p></div></div>
    <div className="transaction-body"><MovementRows rows={rows} /></div>
  </article>;
}

function TradeCard({ activity }: { activity: LeagueTradeActivity }) {
  const outcome = resultClass(activity.result);
  const heading = activity.result === 'Complete' ? 'Trade Completed' : activity.result === 'Failed' ? 'Trade Failed' : 'Trade Outcome Unknown';
  return <article className={`transaction-card league-activity-card trade-card result-${outcome}`} data-kind="trade">
    <div className="transaction-header"><div><p className="transaction-type">{heading}</p><p className="transaction-date">{transactionDateLabel(activity.timestamp)}</p></div></div>
    <div className="transaction-body trade-card-body"><div className="trade-receivers" data-participants={activity.participants.length}>
      {activity.participants.map(participant => <section key={participant.id} className="trade-receiver" aria-label={`${participant.team} receives`}>
        <h3>{participant.team} receives</h3>
        <dl className="trade-assets">{participant.receives.map((asset, index) => <div key={`${asset.type}-${index}-${asset.text}`}><dt>{asset.type}</dt><dd>{asset.text}</dd></div>)}</dl>
      </section>)}
    </div>{activity.unassigned?.length ? <section className="trade-receiver trade-unassigned" aria-label="Assets without a reported recipient">
      <h3>Recipient not reported</h3>
      <dl className="trade-assets">{activity.unassigned.map((asset, index) => <div key={`${asset.type}-${index}-${asset.text}`}><dt>{asset.type}</dt><dd>{asset.text}</dd></div>)}</dl>
    </section> : null}</div>
  </article>;
}

function WaiverCard({ activity }: { activity: LeagueWaiverActivity }) {
  const allBidsKnown = activity.claims.every(claim => claim.bid !== null);
  const countLabel = `${activity.claims.length} reported ${allBidsKnown ? (activity.claims.length === 1 ? 'bid' : 'bids') : (activity.claims.length === 1 ? 'claim' : 'claims')}`;
  const hasWinner = activity.winners.length > 0;
  const winningTeams = [...new Set(activity.winners.map(winner => winner.team))];
  const title = winningTeams.join(', ') || (activity.player ? formatPlayer(activity.player) : 'No winning team reported');
  const rows = activity.winners.flatMap((winner): MovementRow[] => [
    ...(winner.added.length ? [{ key: `${winner.id}-added`, label: 'Added', players: winner.added }] : []),
    ...(winner.dropped.length ? [{ key: `${winner.id}-dropped`, label: 'Dropped', players: winner.dropped }] : []),
  ]);
  return <article className={`transaction-card league-activity-card waiver-card result-${hasWinner ? 'positive' : 'negative'}`} data-kind="waiver">
    <div className="transaction-header waiver-card-header"><div><div className="transaction-title-row"><p className="transaction-type">{title}</p><span>Waiver</span></div><p className="transaction-date">{transactionDateLabel(activity.processedAt)} · {countLabel}</p></div></div>
    <div className="transaction-body waiver-card-body">
      {hasWinner ? <MovementRows rows={rows} /> : <p className="waiver-no-winner">No winning claim reported</p>}
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
