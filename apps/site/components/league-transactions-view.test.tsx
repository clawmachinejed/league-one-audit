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
      kind: 'trade', id: 'two-team-trade', timestamp: '2026-09-07T12:00:00.000Z', title: 'Fourth & Long ↔ Sunday Scaries', result: 'Complete',
      lines: [{ label: 'Fourth & Long received', text: 'A.J. Brown (WR · PHI), 2027 round 2' }],
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
      kind: 'trade', id: 'three-team-trade', timestamp: '2026-09-06T12:00:00.000Z', title: 'Three Team Alpha ↔ Three Team Beta ↔ Three Team Gamma', result: 'Complete',
      lines: [{ label: 'Three Team Alpha received', text: 'Unique Player A (QB · IND)' }],
      participants: [
        { id: 3, team: 'Three Team Alpha', receives: [{ type: 'Player', text: 'Unique Player A (QB · IND)' }] },
        { id: 4, team: 'Three Team Beta', receives: [{ type: 'Pick', text: '2028 Round 1' }] },
        { id: 5, team: 'Three Team Gamma', receives: [{ type: 'FAAB', text: '$17' }] },
      ],
      unassigned: [{ type: 'Player', text: 'Destination Unknown Player (TE · KC)' }],
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
    expect(addOnly[0]).toContain('<dt>Added</dt><dd><span class="transaction-movement-player"><strong class="transaction-movement-player-name">Added Player</strong> <span class="transaction-movement-player-details">(WR · GB)</span></span></dd>');
    expect(addOnly[0]).not.toContain('<dt>Dropped</dt>');
    expect(addOnly[0]!.match(/Add Only Team/gu)).toHaveLength(1);
    expect(addOnly[1]).toContain('<dt>Dropped</dt><dd><span class="transaction-movement-player"><strong class="transaction-movement-player-name">Dropped Player</strong> <span class="transaction-movement-player-details">(RB · PHI)</span></span></dd>');
    expect(addOnly[1]).not.toContain('<dt>Added</dt>');
    expect(addOnly[1]!.match(/Drop Only Team/gu)).toHaveLength(1);

    const waiverMoves = html.match(/<article[^>]*data-kind="waiver"[^>]*>.*?<dl class="transaction-lines transaction-movement-rows">(.*?)<\/dl>/u)?.[1] ?? '';
    expect(html).toContain('<div class="transaction-title-row"><p class="transaction-type">Alpha Winners</p><span>Waiver</span></div>');
    expect(waiverMoves).toContain('<dt>Added</dt><dd><span class="transaction-movement-player"><strong class="transaction-movement-player-name">Player One</strong> <span class="transaction-movement-player-details">(WR · IND)</span></span></dd>');
    expect(waiverMoves).toContain('<dt>Dropped</dt><dd><span class="transaction-movement-player"><strong class="transaction-movement-player-name">Player Two</strong> <span class="transaction-movement-player-details">(RB · SEA)</span></span></dd>');
    expect(waiverMoves).not.toContain('Alpha Winners');
  });

  it('uses one movement-row structure and spacing contract for waiver and free-agent cards', () => {
    const html = renderToStaticMarkup(<LeagueTransactionsView state="ready" data={presentationData} error={null} />);
    expect(html.match(/<dl class="transaction-lines transaction-movement-rows">/gu)).toHaveLength(3);
    expect(html).not.toContain('waiver-winning-moves');

    const css = readFileSync(new URL('../app/globals.css', import.meta.url), 'utf8');
    expect(css).toContain('.league-activity-card .transaction-lines{gap:8px}');
    expect(css).toContain('.league-activity-card .transaction-lines>div{grid-template-columns:62px minmax(0,1fr)}');
    expect(css).toContain('.league-activity-card .transaction-lines>div{grid-template-columns:84px minmax(0,1fr)}');
    expect(css).not.toContain('.waiver-winning-moves');
    expect(css).not.toMatch(/\.waiver-card(?:-header|-body)?\{[^}]*padding/gu);
    expect(css).toContain('.league-activity-card .transaction-header{display:block;padding:6px 10px 5px}');
    expect(css).toContain('.league-activity-card .transaction-body{display:block;padding:6px 10px 7px}');
    expect(css).toContain('.league-transactions-list{max-width:none;gap:8px}');
  });

  it('emphasizes every recognized player name without emphasizing details or separators', () => {
    const multiple: LeagueTransactionsData = {
      ...data,
      activities: [{
        kind: 'add_drop', id: 'multiple', timestamp: '2026-09-08T12:00:00.000Z', title: 'Multiple Players',
        type: 'Free agent', result: 'Complete',
        lines: [
          { label: 'Added', text: 'An Exceptionally Long Player Name (RB · PHI), Green Bay Packers (DEF · GB)' },
          { label: 'Dropped', text: 'Tank Bigsby (RB · PHI)' },
        ],
      }],
    };
    const html = renderToStaticMarkup(<LeagueTransactionsView state="ready" data={multiple} error={null} />);
    expect(html.match(/class="transaction-movement-player-name"/gu)).toHaveLength(3);
    expect(html).toContain('<strong class="transaction-movement-player-name">Green Bay Packers</strong> <span class="transaction-movement-player-details">(DEF · GB)</span>');
    expect(html).toContain('</span><span class="transaction-movement-separator">, </span><span class="transaction-movement-player">');
    expect(html).not.toMatch(/<strong[^>]*>[^<]*\(/gu);
    expect(html).not.toMatch(/<strong[^>]*>[^<]*,/gu);

    const css = readFileSync(new URL('../app/globals.css', import.meta.url), 'utf8');
    expect(css).toContain('.transaction-movement-rows dd{min-width:0;font-weight:400}');
    expect(css).toContain('.transaction-movement-player-name{font-weight:600}');
    expect(css).toContain('.transaction-movement-player-details{color:var(--muted)}');
  });

  it('leaves the entire original movement text at normal weight when any player is unsafe to parse', () => {
    const unsafe: LeagueTransactionsData = {
      ...data,
      activities: [{
        kind: 'add_drop', id: 'unsafe', timestamp: '2026-09-08T12:00:00.000Z', title: 'Fallback Team',
        type: 'Free agent', result: 'Complete',
        lines: [{ label: 'Added', text: 'Recognized Player (RB · PHI), incomplete player details' }],
      }],
    };
    const html = renderToStaticMarkup(<LeagueTransactionsView state="ready" data={unsafe} error={null} />);
    expect(html).toContain('<dd>Recognized Player (RB · PHI), incomplete player details</dd>');
    expect(html).not.toContain('transaction-movement-player-name');
    expect(html).not.toContain('<strong');
  });

  it('emphasizes names when the standardized player text contains safe partial metadata', () => {
    const partial: LeagueTransactionsData = {
      ...data,
      activities: [{
        kind: 'add_drop', id: 'partial', timestamp: '2026-09-08T12:00:00.000Z', title: 'Partial Details',
        type: 'Free agent', result: 'Complete',
        lines: [{ label: 'Added', text: 'Position Only (RB), Team Only (IND)' }],
      }],
    };
    const html = renderToStaticMarkup(<LeagueTransactionsView state="ready" data={partial} error={null} />);
    expect(html).toContain('<strong class="transaction-movement-player-name">Position Only</strong> <span class="transaction-movement-player-details">(RB)</span>');
    expect(html).toContain('<strong class="transaction-movement-player-name">Team Only</strong> <span class="transaction-movement-player-details">(IND)</span>');
    expect(html).toContain('</span><span class="transaction-movement-separator">, </span><span class="transaction-movement-player">');
    expect(html.replace(/<[^>]+>/gu, '')).toContain('AddedPosition Only (RB), Team Only (IND)');
  });

  it('states unsuccessful non-waiver outcomes inline without restoring a status badge', () => {
    const failed: LeagueTransactionsData = {
      ...data,
      activities: [
        {
          kind: 'add_drop', id: 'failed-move', timestamp: '2026-09-08T12:00:00.000Z', title: 'Attempted Team',
          type: 'Free agent', result: 'Failed', lines: [{ label: 'Added', text: 'Attempted Player (WR · GB)' }],
        },
        {
          kind: 'trade', id: 'failed-trade', timestamp: '2026-09-07T12:00:00.000Z', title: 'Alpha ↔ Beta', result: 'Failed',
          lines: [{ label: 'Alpha received', text: 'Attempted Player (WR · GB)' }],
          participants: [
            { id: 1, team: 'Alpha', receives: [{ type: 'Player', text: 'Attempted Player (WR · GB)' }] },
            { id: 2, team: 'Beta', receives: [{ type: 'Details', text: 'No received assets reported by Sleeper.' }] },
          ],
        },
      ],
    };
    const html = renderToStaticMarkup(<LeagueTransactionsView state="ready" data={failed} error={null} />);
    expect(html).toContain('Sep 8, 2026 · 8:00 AM ET · Failed');
    expect(html).toContain('<p class="transaction-type">Trade Failed</p>');
    expect(html).not.toContain('<p class="transaction-type">Trade Completed</p>');
    expect(html).not.toContain('result-badge');
  });

  it('renders two-team multi-asset and three-team trades with every receiving asset exactly once', () => {
    const html = renderToStaticMarkup(<LeagueTransactionsView state="ready" data={presentationData} error={null} />);
    for (const team of ['Fourth &amp; Long', 'Sunday Scaries', 'Three Team Alpha', 'Three Team Beta', 'Three Team Gamma']) {
      expect(html.match(new RegExp(`<h3>${team} receives<\\/h3>`, 'gu'))).toHaveLength(1);
    }
    for (const asset of [
      'A.J. Brown (WR · PHI)', '2027 Round 2', 'Drake London (WR · ATL)', '$10',
      'Unique Player A (QB · IND)', '2028 Round 1', '$17',
      'Destination Unknown Player (TE · KC)',
    ]) expect(html.match(new RegExp(asset.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&'), 'gu'))).toHaveLength(1);
    expect(html).toContain('<dt>Player</dt>');
    expect(html).toContain('<dt>Pick</dt>');
    expect(html).toContain('<dt>FAAB</dt>');
    expect(html).toContain('<h3>Recipient not reported</h3>');
    expect(html).not.toContain(' sent');
  });

  it('removes the league-card status column and the divider before the first trade participant in CSS', () => {
    const css = readFileSync(new URL('../app/globals.css', import.meta.url), 'utf8');
    expect(css).toContain('.league-activity-card .transaction-header{display:block;padding:6px 10px 5px}');
    expect(css).toContain('.league-activity-card .transaction-header>div{width:100%}');
    expect(css).toContain('.trade-card .transaction-header{border-bottom:0}');
    expect(css).not.toMatch(/\.trade-receiver:first-child[^}]*border/gu);
  });
});
