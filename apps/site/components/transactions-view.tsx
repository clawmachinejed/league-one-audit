'use client';

import { useState } from 'react';
import type { Transaction, TransactionsData } from '../lib/types';
import { Icon } from './icon';
import { EmptyState, formatNumber, Updated } from './league-primitives';
import { OwnerHeader } from './owner-profile';
import { useTeamPreference } from './team-preference';
import { transactionDateLabel, transactionMovementClass, transactionTypeLabel } from './transaction-format';

function TransactionCard({ transaction }: { transaction: Transaction }) {
  const resultClass = transaction.result === 'Won' || transaction.result === 'Complete' ? 'positive' : transaction.result === 'Lost' || transaction.result === 'Failed' ? 'negative' : 'neutral';
  return <article className={`transaction-card result-${resultClass}`}>
    <div className="transaction-header"><div><p className="transaction-type">{transactionTypeLabel(transaction.type)}</p><p className="transaction-date">{transactionDateLabel(transaction.date)}</p></div><span className={`result-badge ${resultClass}`}>{transaction.result === 'Won' && <Icon name="check" />}{transaction.result}</span></div>
    <div className="transaction-body"><dl className="transaction-lines">{transaction.lines.map((line, index) => <div key={`${index}-${line.label}`} className={transactionMovementClass(line.label)}><dt>{line.label}</dt><dd>{line.text}</dd></div>)}</dl>{transaction.bid !== null && <div className="faab-bid"><span>FAAB bid</span><strong>${formatNumber(transaction.bid, 0)}</strong></div>}</div>
  </article>;
}

export function TransactionsView({ data }: { data: TransactionsData }) {
  useTeamPreference(data.teams);
  const [filter, setFilter] = useState('all');
  const types = [...new Set(data.transactions.map(transaction => transaction.type))].sort();
  const filtered = filter === 'all' ? data.transactions : data.transactions.filter(transaction => transaction.type === filter);
  return <><OwnerHeader data={data} active="transactions" />
    <div className="transactions-heading"><div className="section-label"><h2>Team activity</h2><span>{filtered.length} {filtered.length === 1 ? 'move' : 'moves'}</span></div>{types.length > 1 && <label className="transaction-filter"><span className="sr-only">Filter transaction type</span><select value={filter} onChange={event => setFilter(event.target.value)}><option value="all">All moves</option>{types.map(type => <option key={type} value={type}>{transactionTypeLabel(type)}</option>)}</select><Icon name="chevron" /></label>}</div>
    {filtered.length ? <div className="transactions-list">{filtered.map(transaction => <TransactionCard key={transaction.id} transaction={transaction} />)}</div> : <EmptyState title={filter === 'all' ? 'A fresh season. A clean slate.' : 'No moves of this type'}>{filter === 'all' ? 'Waivers, free agents, and trades will appear here when Sleeper reports them.' : 'Choose All moves to see the rest of this team’s activity.'}</EmptyState>}
    <Updated value={data.updatedAt} /><p className="refresh-note">Results and FAAB bids are reported by Sleeper.</p>
  </>;
}
