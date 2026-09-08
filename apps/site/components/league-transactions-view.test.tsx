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
