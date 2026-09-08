import { describe, expect, it } from 'vitest';
import { normalizeLeagueTransactions } from './league-transactions';
import type { Team } from './types';
import type { PlayerCatalog, SleeperTransaction } from './transform';

const teams: Team[] = [
  { id: 1, name: 'Alpha', managerName: 'A', avatar: null, wins: 0, losses: 0, ties: 0, pointsFor: 0, pointsAgainst: 0 },
  { id: 2, name: 'Beta', managerName: 'B', avatar: null, wins: 0, losses: 0, ties: 0, pointsFor: 0, pointsAgainst: 0 },
  { id: 3, name: 'Gamma', managerName: 'C', avatar: null, wins: 0, losses: 0, ties: 0, pointsFor: 0, pointsAgainst: 0 },
];
const catalog: PlayerCatalog = {
  p1: { full_name: 'Player One', position: 'WR', team: 'IND' },
  p2: { full_name: 'Player Two', position: 'RB', team: 'SEA' },
  p3: { full_name: 'Player Three', position: 'TE', team: 'BUF' },
};
const baseTime = Date.parse('2026-09-09T12:00:00Z');

function transaction(overrides: Partial<SleeperTransaction> = {}): SleeperTransaction {
  return {
    transaction_id: 't1', type: 'waiver', status: 'complete', created: baseTime,
    status_updated: baseTime, roster_ids: [1], consenter_ids: [1], adds: { p1: 1 },
    settings: { waiver_bid: 10 }, ...overrides,
  };
}

describe('league-wide transaction normalization', () => {
  it('deduplicates overlapping copies before grouping and keeps the newest state', () => {
    const rows = normalizeLeagueTransactions([
      transaction({ transaction_id: 'same', status: 'failed', status_updated: baseTime - 1000 }),
      transaction({ transaction_id: 'same', status: 'complete', status_updated: baseTime }),
    ], 'league1', teams, catalog);
    expect(rows).toHaveLength(1);
    expect(rows[0].kind).toBe('waiver');
    if (rows[0].kind === 'waiver') expect(rows[0].claims).toEqual([{ id: 'same', team: 'Alpha', bid: 10, result: 'Won' }]);
  });

  it('renders one multi-team, multi-player trade with picks and FAAB in both directions', () => {
    const rows = normalizeLeagueTransactions([transaction({
      transaction_id: 'trade', type: 'trade', roster_ids: [1, 2, 3],
      adds: { p1: 1, p2: 2, p3: 3 }, drops: { p1: 2, p2: 3, p3: 1 }, settings: null,
      draft_picks: [{ season: '2027', round: 2, roster_id: 3, previous_owner_id: 2, owner_id: 1 }],
      waiver_budget: [{ sender: 1, receiver: 3, amount: 15 }],
    })], 'league1', teams, catalog);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ kind: 'trade', id: 'trade', title: 'Alpha ↔ Beta ↔ Gamma' });
    if (rows[0].kind === 'trade') {
      expect(rows[0].lines).toEqual(expect.arrayContaining([
        expect.objectContaining({ label: 'Alpha received', text: expect.stringContaining('2027 round 2') }),
        expect.objectContaining({ label: 'Alpha sent', text: expect.stringContaining('$15 FAAB') }),
        expect.objectContaining({ label: 'Gamma received', text: expect.stringContaining('$15 FAAB') }),
        expect.objectContaining({ label: 'Beta sent', text: expect.stringContaining('Player One') }),
      ]));
    }
  });

  it('keeps completed free-agent adds and drops together with an accurate result', () => {
    const [row] = normalizeLeagueTransactions([transaction({
      type: 'free_agent', adds: { p1: 2, p2: 2 }, drops: { p3: 2 }, roster_ids: [2], settings: null,
    })], 'league1', teams, catalog);
    expect(row).toMatchObject({ kind: 'add_drop', title: 'Beta', type: 'Free agent', result: 'Complete' });
    if (row.kind === 'add_drop') expect(row.lines.map(line => line.label)).toEqual(['Added', 'Dropped']);
  });

  it('groups one player/day with winners first and losing bids high-to-low deterministically', () => {
    const rows = normalizeLeagueTransactions([
      transaction({ transaction_id: 'winner', roster_ids: [1], adds: { p1: 1 }, drops: { p3: 1 }, settings: { waiver_bid: 0 } }),
      transaction({ transaction_id: 'loss-b', status: 'failed', roster_ids: [2], adds: { p1: 2 }, settings: { waiver_bid: 8 } }),
      transaction({ transaction_id: 'loss-c', status: 'failed', roster_ids: [3], adds: { p1: 3 }, settings: { waiver_bid: 8 } }),
      transaction({ transaction_id: 'loss-missing', status: 'failed', roster_ids: [1], adds: { p1: 1 }, settings: { waiver_bid: null } }),
    ], 'league1', teams, catalog);
    expect(rows).toHaveLength(1);
    const row = rows[0];
    expect(row.kind).toBe('waiver');
    if (row.kind === 'waiver') {
      expect(row.claims.map(claim => [claim.id, claim.bid, claim.result])).toEqual([
        ['winner', 0, 'Won'], ['loss-b', 8, 'Lost'], ['loss-c', 8, 'Lost'], ['loss-missing', null, 'Lost'],
      ]);
      expect(row.winners[0]).toMatchObject({ team: 'Alpha', added: [expect.objectContaining({ id: 'p1' })], dropped: [expect.objectContaining({ id: 'p3' })] });
    }
  });

  it('excludes pending, queued and processing claims before counts or delivery', () => {
    const [row] = normalizeLeagueTransactions([
      transaction({ transaction_id: 'winner' }),
      transaction({ transaction_id: 'pending', status: 'pending', roster_ids: [2], adds: { p1: 2 }, settings: { waiver_bid: 99 } }),
      transaction({ transaction_id: 'queued', status: 'queued', roster_ids: [2], adds: { p1: 2 } }),
      transaction({ transaction_id: 'processing', status: 'processing', roster_ids: [3], adds: { p1: 3 } }),
    ], 'league1', teams, catalog);
    expect(row.kind).toBe('waiver');
    if (row.kind === 'waiver') expect(row.claims).toEqual([{ id: 'winner', team: 'Alpha', bid: 10, result: 'Won' }]);
    expect(JSON.stringify(row)).not.toMatch(/pending|queued|processing|99/u);
  });

  it('separates different players and the same player on different New York days', () => {
    const rows = normalizeLeagueTransactions([
      transaction({ transaction_id: 'p1-day1', adds: { p1: 1 }, status_updated: Date.parse('2026-09-09T03:59:00Z') }),
      transaction({ transaction_id: 'p1-day2', adds: { p1: 1 }, status_updated: Date.parse('2026-09-09T04:01:00Z') }),
      transaction({ transaction_id: 'p2-day2', adds: { p2: 2 }, roster_ids: [2], status_updated: Date.parse('2026-09-09T04:02:00Z') }),
    ], 'league1', teams, catalog);
    expect(rows).toHaveLength(3);
    expect(rows.filter(row => row.kind === 'waiver').map(row => row.id)).toEqual(expect.arrayContaining([
      'league1:waiver:p1:2026-09-08', 'league1:waiver:p1:2026-09-09', 'league1:waiver:p2:2026-09-09',
    ]));
  });

  it('uses New York calendar boundaries across daylight-saving changes', () => {
    const rows = normalizeLeagueTransactions([
      transaction({ transaction_id: 'before', status_updated: Date.parse('2026-03-08T04:59:00Z') }),
      transaction({ transaction_id: 'after', status_updated: Date.parse('2026-03-08T05:01:00Z') }),
      transaction({ transaction_id: 'fall-a', adds: { p2: 2 }, roster_ids: [2], status_updated: Date.parse('2026-11-01T05:30:00Z') }),
      transaction({ transaction_id: 'fall-b', status: 'failed', adds: { p2: 3 }, roster_ids: [3], status_updated: Date.parse('2026-11-01T06:30:00Z') }),
    ], 'league1', teams, catalog);
    expect(rows.map(row => row.id)).toEqual(expect.arrayContaining([
      'league1:waiver:p1:2026-03-07', 'league1:waiver:p1:2026-03-08', 'league1:waiver:p2:2026-11-01',
    ]));
    const fall = rows.find(row => row.id.endsWith('p2:2026-11-01'));
    expect(fall?.kind === 'waiver' ? fall.claims : []).toHaveLength(2);
  });

  it('retains multiple winners and shows losing-only groups without inventing a winner', () => {
    const rows = normalizeLeagueTransactions([
      transaction({ transaction_id: 'winner-a', roster_ids: [1], adds: { p1: 1 } }),
      transaction({ transaction_id: 'winner-b', roster_ids: [2], adds: { p1: 2 }, status_updated: baseTime + 1000 }),
      transaction({ transaction_id: 'loser-only', status: 'failed', roster_ids: [3], adds: { p2: 3 } }),
    ], 'league1', teams, catalog);
    const winners = rows.find(row => row.id.includes(':p1:'));
    const losingOnly = rows.find(row => row.id.includes(':p2:'));
    expect(winners?.kind === 'waiver' ? winners.winners : []).toHaveLength(2);
    expect(losingOnly?.kind === 'waiver' ? losingOnly.winners : []).toEqual([]);
    expect(losingOnly?.kind === 'waiver' ? losingOnly.claims[0].result : null).toBe('Lost');
  });

  it('keeps every unknown-player claim separate', () => {
    const rows = normalizeLeagueTransactions([
      transaction({ transaction_id: 'unknown-a', adds: null }),
      transaction({ transaction_id: 'unknown-b', status: 'failed', adds: {} }),
    ], 'league2', teams, catalog);
    expect(rows.map(row => row.id)).toEqual(expect.arrayContaining([
      'league2:waiver:unknown:unknown-a', 'league2:waiver:unknown:unknown-b',
    ]));
    for (const row of rows) expect(row.kind === 'waiver' ? row.player : 'unexpected').toBeNull();
  });

  it.each([
    [0, 0], [null, null], [-1, null], [1.5, null], ['bad', null], [Number.POSITIVE_INFINITY, null],
  ])('normalizes reported bid %s to %s', (value, expected) => {
    const [row] = normalizeLeagueTransactions([transaction({ settings: { waiver_bid: value } })], 'league1', teams, catalog);
    expect(row.kind === 'waiver' ? row.claims[0].bid : 'unexpected').toBe(expected);
  });

  it('keeps league keys in grouping identities so league data cannot collide', () => {
    const one = normalizeLeagueTransactions([transaction()], 'league1', teams, catalog)[0];
    const two = normalizeLeagueTransactions([transaction()], 'league2', teams, catalog)[0];
    expect(one.id).not.toBe(two.id);
    expect(one.id.startsWith('league1:')).toBe(true);
    expect(two.id.startsWith('league2:')).toBe(true);
  });
});
