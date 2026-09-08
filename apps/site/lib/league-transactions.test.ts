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

  it('renders every multi-team trade participant and each received player, pick, and FAAB asset once', () => {
    const rows = normalizeLeagueTransactions([transaction({
      transaction_id: 'trade', type: 'trade', roster_ids: [1, 2, 3],
      adds: { p1: 1, p2: 2, p3: 3 }, drops: { p1: 2, p2: 3, p3: 1 }, settings: null,
      draft_picks: [{ season: '2027', round: 2, roster_id: 3, previous_owner_id: 2, owner_id: 1 }],
      waiver_budget: [{ sender: 1, receiver: 3, amount: 15 }],
    })], 'league1', teams, catalog);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ kind: 'trade', id: 'trade', title: 'Alpha ↔ Beta ↔ Gamma' });
    if (rows[0].kind === 'trade') {
      expect(rows[0].lines).toEqual([
        { label: 'Alpha received', text: 'Player One (WR · IND), 2027 round 2 (Gamma original pick)' },
        { label: 'Alpha sent', text: 'Player Three (TE · BUF), $15 FAAB' },
        { label: 'Beta received', text: 'Player Two (RB · SEA)' },
        { label: 'Beta sent', text: 'Player One (WR · IND), 2027 round 2 (Gamma original pick)' },
        { label: 'Gamma received', text: 'Player Three (TE · BUF), $15 FAAB' },
        { label: 'Gamma sent', text: 'Player Two (RB · SEA)' },
      ]);
      expect(rows[0].participants).toEqual([
        { id: 1, team: 'Alpha', receives: [
          { type: 'Player', text: 'Player One (WR · IND)' },
          { type: 'Pick', text: '2027 Round 2 (Gamma original pick)' },
        ] },
        { id: 2, team: 'Beta', receives: [{ type: 'Player', text: 'Player Two (RB · SEA)' }] },
        { id: 3, team: 'Gamma', receives: [
          { type: 'Player', text: 'Player Three (TE · BUF)' },
          { type: 'FAAB', text: '$15' },
        ] },
      ]);
      const assets = rows[0].participants.flatMap(participant => participant.receives);
      expect(assets).toHaveLength(5);
      expect(new Set(assets.map(asset => `${asset.type}:${asset.text}`)).size).toBe(5);
      expect(rows[0].unassigned).toEqual([]);
    }
  });

  it('keeps a trade player visible once when Sleeper omits its receiving roster', () => {
    const [row] = normalizeLeagueTransactions([transaction({
      transaction_id: 'incomplete-trade', type: 'trade', roster_ids: [1, 2],
      adds: { p1: 1 }, drops: { p1: 2, p2: 1 }, settings: null,
    })], 'league1', teams, catalog);
    expect(row.kind).toBe('trade');
    if (row.kind === 'trade') {
      expect(row.participants.find(participant => participant.team === 'Alpha')?.receives)
        .toEqual([{ type: 'Player', text: 'Player One (WR · IND)' }]);
      expect(row.unassigned).toEqual([{ type: 'Player', text: 'Player Two (RB · SEA)' }]);
      const presentationAssets = [...row.participants.flatMap(participant => participant.receives), ...(row.unassigned ?? [])];
      expect(presentationAssets.filter(asset => asset.text.includes('Player Two'))).toHaveLength(1);
      expect(row.lines).toContainEqual({ label: 'Alpha sent', text: 'Player Two (RB · SEA)' });
    }
  });

  it('keeps completed free-agent adds and drops together with an accurate result', () => {
    const [row] = normalizeLeagueTransactions([transaction({
      type: 'free_agent', adds: { p1: 2, p2: 2 }, drops: { p3: 2 }, roster_ids: [2], settings: null,
    })], 'league1', teams, catalog);
    expect(row).toMatchObject({ kind: 'add_drop', title: 'Beta', type: 'Free agent', result: 'Complete' });
    if (row.kind === 'add_drop') {
      expect(row.lines).toEqual([
        { label: 'Added', text: 'Player One (WR · IND), Player Two (RB · SEA)' },
        { label: 'Dropped', text: 'Player Three (TE · BUF)' },
      ]);
      expect(row.movementPlayers).toEqual({
        added: [
          { id: 'p1', name: 'Player One', position: 'WR', nflTeam: 'IND' },
          { id: 'p2', name: 'Player Two', position: 'RB', nflTeam: 'SEA' },
        ],
        dropped: [{ id: 'p3', name: 'Player Three', position: 'TE', nflTeam: 'BUF' }],
      });
      expect(row.lines.map(line => line.text).join(' ')).not.toContain('Beta');
    }
  });

  it('keeps add-only and drop-only moves valid without empty movement rows', () => {
    const rows = normalizeLeagueTransactions([
      transaction({ transaction_id: 'add-only', type: 'free_agent', adds: { p1: 1 }, drops: null, settings: null }),
      transaction({ transaction_id: 'drop-only', type: 'free_agent', adds: null, drops: { p2: 2 }, roster_ids: [2], settings: null }),
    ], 'league1', teams, catalog);
    const addOnly = rows.find(row => row.id === 'add-only');
    const dropOnly = rows.find(row => row.id === 'drop-only');
    expect(addOnly?.kind === 'add_drop' ? addOnly.lines : []).toEqual([{ label: 'Added', text: 'Player One (WR · IND)' }]);
    expect(dropOnly?.kind === 'add_drop' ? dropOnly.lines : []).toEqual([{ label: 'Dropped', text: 'Player Two (RB · SEA)' }]);
    expect(addOnly?.kind === 'add_drop' ? addOnly.movementPlayers : null).toEqual({
      added: [{ id: 'p1', name: 'Player One', position: 'WR', nflTeam: 'IND' }], dropped: [],
    });
    expect(dropOnly?.kind === 'add_drop' ? dropOnly.movementPlayers : null).toEqual({
      added: [], dropped: [{ id: 'p2', name: 'Player Two', position: 'RB', nflTeam: 'SEA' }],
    });
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
