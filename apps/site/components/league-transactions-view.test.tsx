import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { LeagueTransactionsData } from '../lib/types';
import { LeagueTransactionsView } from './league-transactions-view';

const data: LeagueTransactionsData = {
  league: { season: '2026', week: 1, maxWeek: 18, rosterPositions: [] },
  updatedAt: '2026-09-09T12:30:00.000Z',
  activities: [{
    kind: 'waiver',
    id: 'league1:waiver:p1:2026-09-09',
    timestamp: '2026-09-09T12:00:00.000Z',
    processedAt: '2026-09-09T12:00:00.000Z',
    day: '2026-09-09',
    player: { id: 'p1', name: 'Player One', position: 'WR', nflTeam: 'IND' },
    winners: [{ id: 'winner', team: 'Alpha', added: [{ id: 'p1', name: 'Player One', position: 'WR', nflTeam: 'IND' }], dropped: [] }],
    claims: [
      { id: 'winner', team: 'Alpha', bid: 0, result: 'Won' },
      { id: 'loser', team: 'A very long losing team name', bid: 7, result: 'Lost' },
    ],
  }],
};

const presentationData: LeagueTransactionsData = {
  ...data,
  activities: [
    {
      kind: 'waiver',
      id: 'league1:waiver:p1:2026-09-09',
      timestamp: '2026-09-09T12:00:00.000Z',
      processedAt: '2026-09-09T12:00:00.000Z',
      day: '2026-09-09',
      player: { id: 'p1', name: 'Player One', position: 'WR', nflTeam: 'IND' },
      winners: [{
        id: 'winner', team: 'Alpha Winners',
        added: [{ id: 'p1', name: 'Player One', position: 'WR', nflTeam: 'IND' }],
        dropped: [{ id: 'p2', name: 'Player Two', position: 'RB', nflTeam: 'SEA' }],
      }],
      claims: [
        { id: 'winner', team: 'Alpha Winners', bid: 0, result: 'Won' },
        { id: 'loser', team: 'Long Losing Team', bid: 7, result: 'Lost' },
      ],
    },
    {
      kind: 'add_drop', id: 'add-only', timestamp: '2026-09-08T12:00:00.000Z', title: 'Add Only Team',
      type: 'Free agent', result: 'Complete', lines: [{ label: 'Added', text: 'Added Player (WR · GB)' }],
    },
    {
      kind: 'add_drop', id: 'drop-only', timestamp: '2026-09-08T11:00:00.000Z', title: 'Drop Only Team',
      type: 'Free agent', result: 'Complete', lines: [{ label: 'Dropped', text: 'Dropped Player (RB · PHI)' }],
    },
    {
      kind: 'trade', id: 'two-team-trade', timestamp: '2026-09-07T12:00:00.000Z', title: 'Trade Completed', result: 'Complete',
      participants: [
        { id: 1, team: 'Fourth & Long', receives: [
          { type: 'Player', text: 'A.J. Brown (WR · PHI)' },
          { type: 'Pick', text: '2027 Round 2' },
        ] },
        { id: 2, team: 'Sunday Scaries', receives: [
          { type: 'Player', text: 'Drake London (WR · ATL)' },
          { type: 'FAAB', text: '$10' },
        ] },
      ],
    },
    {
      kind: 'trade', id: 'three-team-trade', timestamp: '2026-09-06T12:00:00.000Z', title: 'Trade Completed', result: 'Complete',
      participants: [
        { id: 3, team: 'Three Team Alpha', receives: [{ type: 'Player', text: 'Unique Player A (QB · IND)' }] },
        { id: 4, team: 'Three Team Beta', receives: [{ type: 'Pick', text: '2028 Round 1' }] },
        { id: 5, team: 'Three Team Gamma', receives: [{ type: 'FAAB', text: '$17' }] },
      ],
    },
  ],
};

describe('league waiver presentation', () => {
  it('shows one card-level time and explicit compact Won/Lost rows without per-row times or dividers', () => {
    const html = renderToStaticMarkup(<LeagueTransactionsView state="ready" data={data} error={null} />);
    expect(html.match(/class="transaction-date"/gu)).toHaveLength(1);
    const bidRows = [...html.matchAll(/<div class="waiver-bid-row[^>]*>(.*?)<\/div>/gu)].map(match => match[1]);
    expect(bidRows).toHaveLength(2);
    expect(bidRows[0]).toContain('Won');
    expect(bidRows[0]).toContain('$0');
    expect(bidRows[1]).toContain('Lost');
    expect(bidRows.join(' ')).not.toContain('transaction-date');
    expect(html).not.toContain('<hr');
  });

  it('defines tight bid-row spacing and no row border rule', () => {
    const css = readFileSync(new URL('../app/globals.css', import.meta.url), 'utf8');
    const rowRules = [...css.matchAll(/\.waiver-bid-row\{([^}]*)\}/gu)].map(match => match[1]);
    expect(rowRules.some(rule => rule.includes('padding:2px 0'))).toBe(true);
    expect(rowRules.every(rule => !rule.includes('border'))).toBe(true);
  });

  it('keeps the protected bid header, winner-first order, outcome labels, classes, and compact row structure', () => {
    const html = renderToStaticMarkup(<LeagueTransactionsView state="ready" data={presentationData} error={null} />);
    expect(html).toContain('<div class="waiver-bid-heading" aria-hidden="true"><span>Team</span><span>Bid</span><span>Result</span></div>');
    const bidRows = [...html.matchAll(/<div class="waiver-bid-row ([^"]+)">(.*?)<\/div>/gu)];
    expect(bidRows).toHaveLength(2);
    expect(bidRows[0][1]).toBe('result-positive');
    expect(bidRows[0][2]).toContain('Alpha Winners');
    expect(bidRows[0][2]).toContain('Won');
    expect(bidRows[1][1]).toBe('result-negative');
    expect(bidRows[1][2]).toContain('Long Losing Team');
    expect(bidRows[1][2]).toContain('Lost');
    expect(bidRows.map(row => row[2]).join(' ')).not.toContain('transaction-date');
  });

  it('uses reported claims wording when any bid is unavailable', () => {
    const partial = structuredClone(data);
    if (partial.activities[0].kind === 'waiver') partial.activities[0].claims[1].bid = null;
    const html = renderToStaticMarkup(<LeagueTransactionsView state="ready" data={partial} error={null} />);
    expect(html).toContain('2 reported claims');
    expect(html).not.toContain('all bids');
  });

  it('states when Sleeper reports no winner', () => {
    const losing = structuredClone(data);
    if (losing.activities[0].kind === 'waiver') {
      losing.activities[0].winners = [];
      losing.activities[0].claims = [{ id: 'loser', team: 'Beta', bid: 5, result: 'Lost' }];
    }
    const html = renderToStaticMarkup(<LeagueTransactionsView state="ready" data={losing} error={null} />);
    expect(html).toContain('No winning claim reported');
    expect(html).toContain('Lost');
  });
});

describe('league transaction card presentation', () => {
  it('uses the approved exact headings and removes every card-level status badge', () => {
    const html = renderToStaticMarkup(<LeagueTransactionsView state="ready" data={presentationData} error={null} />);
    expect(html).toContain('<h2>League Activity</h2>');
    expect(html).not.toContain('<h2>League activity</h2>');
    expect(html.match(/<p class="transaction-type">Trade Completed<\/p>/gu)).toHaveLength(2);
    expect(html).not.toContain('result-badge');
  });

  it('uses team-first add/drop and waiver headers while keeping player rows team-free', () => {
    const html = renderToStaticMarkup(<LeagueTransactionsView state="ready" data={presentationData} error={null} />);
    expect(html).toContain('<div class="transaction-title-row"><p class="transaction-type">Add Only Team</p><span>Free agent</span></div>');
    expect(html).toContain('<div class="transaction-title-row"><p class="transaction-type">Drop Only Team</p><span>Free agent</span></div>');
    const addOnly = html.match(/<article[^>]*data-kind="add_drop"[^>]*>(.*?)<\/article>/gu) ?? [];
    expect(addOnly).toHaveLength(2);
    expect(addOnly[0]).toContain('<dt>Added</dt><dd>Added Player (WR · GB)</dd>');
    expect(addOnly[0]).not.toContain('<dt>Dropped</dt>');
    expect(addOnly[0]!.match(/Add Only Team/gu)).toHaveLength(1);
    expect(addOnly[1]).toContain('<dt>Dropped</dt><dd>Dropped Player (RB · PHI)</dd>');
    expect(addOnly[1]).not.toContain('<dt>Added</dt>');
    expect(addOnly[1]!.match(/Drop Only Team/gu)).toHaveLength(1);

    const waiverMoves = html.match(/<dl class="transaction-lines waiver-winning-moves">(.*?)<\/dl>/u)?.[1] ?? '';
    expect(html).toContain('<div class="transaction-title-row"><p class="transaction-type">Alpha Winners</p><span>Waiver</span></div>');
    expect(waiverMoves).toContain('<dt>Added</dt><dd>Player One (WR · IND)</dd>');
    expect(waiverMoves).toContain('<dt>Dropped</dt><dd>Player Two (RB · SEA)</dd>');
    expect(waiverMoves).not.toContain('Alpha Winners');
  });

  it('renders two-team multi-asset and three-team trades with every receiving asset exactly once', () => {
    const html = renderToStaticMarkup(<LeagueTransactionsView state="ready" data={presentationData} error={null} />);
    for (const team of ['Fourth &amp; Long', 'Sunday Scaries', 'Three Team Alpha', 'Three Team Beta', 'Three Team Gamma']) {
      expect(html.match(new RegExp(`<h3>${team} receives<\\/h3>`, 'gu'))).toHaveLength(1);
    }
    for (const asset of [
      'A.J. Brown (WR · PHI)', '2027 Round 2', 'Drake London (WR · ATL)', '$10',
      'Unique Player A (QB · IND)', '2028 Round 1', '$17',
    ]) expect(html.match(new RegExp(asset.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&'), 'gu'))).toHaveLength(1);
    expect(html).toContain('<dt>Player</dt>');
    expect(html).toContain('<dt>Pick</dt>');
    expect(html).toContain('<dt>FAAB</dt>');
    expect(html).not.toContain(' sent');
  });

  it('removes the league-card status column and the divider before the first trade participant in CSS', () => {
    const css = readFileSync(new URL('../app/globals.css', import.meta.url), 'utf8');
    expect(css).toContain('.league-activity-card .transaction-header{display:block}');
    expect(css).toContain('.league-activity-card .transaction-header>div{width:100%}');
    expect(css).toContain('.trade-card .transaction-header{border-bottom:0;');
    expect(css).not.toMatch(/\.trade-receiver:first-child[^}]*border/gu);
  });
});
