import { describe, expect, it } from 'vitest';
import {
  currentWeek,
  involvesRoster,
  lineup,
  matchupStatus,
  normalizeLeague,
  normalizeMatchups,
  normalizeTeams,
  normalizeTransactions,
  numberOrNull,
  ownerLineup,
  safeAvatar,
  seasonPoints,
  transactionEndWeek,
  transactionResult,
  waiverBid,
  type SleeperLeague,
  type SleeperTransaction,
} from './transform';

const rawLeague: SleeperLeague = {
  league_id: '1378850182409490432',
  name: 'League One',
  season: '2026',
  status: 'in_season',
  roster_positions: ['QB', 'RB', 'FLEX', 'FLEX', 'DEF', 'BN'],
  settings: { waiver_budget: 100, playoff_week_start: 0, leg: 1 },
  scoring_settings: { rec: 0.5 },
};
const state = { season: '2026', season_type: 'regular', leg: 1, display_week: 1, season_start_date: '2026-09-09' };
const league = normalizeLeague(rawLeague, state);
const teams = normalizeTeams([
  { roster_id: 1, owner_id: 'owner-1', settings: { wins: 2, losses: 1, fpts: 310, fpts_decimal: 42 } },
  { roster_id: 2, owner_id: 'owner-2', settings: { wins: 1, losses: 2, fpts: 299, fpts_decimal: 81 } },
  { roster_id: 3, owner_id: 'owner-3' },
], [
  { user_id: 'owner-1', display_name: 'Alex', metadata: { team_name: 'The Owls' } },
  { user_id: 'owner-2', display_name: 'Sam', metadata: { team_name: 'The Bears' } },
  { user_id: 'owner-3', display_name: 'Jo', metadata: { team_name: 'The Foxes' } },
], league);
const catalog = {
  qb: { full_name: 'Quarter Back', position: 'QB', team: 'IND' },
  rb: { full_name: 'Running Back', position: 'RB', team: 'SEA' },
  wr: { full_name: 'Wide Receiver', position: 'WR', team: 'BUF' },
  reserve: { full_name: 'Reserve Player', position: 'TE', team: 'KC' },
  taxi: { full_name: 'Taxi Player', position: 'RB', team: 'CAR' },
};
const transaction = (overrides: Partial<SleeperTransaction> = {}): SleeperTransaction => ({
  transaction_id: '1000', type: 'waiver', status: 'complete', roster_ids: [1],
  ...overrides,
});

describe('league timing and configuration', () => {
  it('reads scoring, FAAB and slots without interpreting playoff week zero as a range', () => {
    expect(league).toMatchObject({ id: rawLeague.league_id, scoringLabel: 'Half PPR', faabBudget: 100, maxWeek: 18 });
    expect(league.rosterPositions).toEqual(rawLeague.roster_positions);
  });

  it('chooses the right season when the global NFL state moves on', () => {
    expect(currentWeek(rawLeague, { season: '2027', week: 4 })).toBe(18);
    expect(currentWeek(rawLeague, { season: '2025', week: 17 })).toBe(1);
    expect(currentWeek(rawLeague, { ...state, season_type: 'post', week: 2 })).toBe(18);
    expect(currentWeek(rawLeague, { ...state, season_type: 'pre', week: 3 })).toBe(1);
  });

  it('keeps displayed weeks in the NFL range', () => {
    expect(currentWeek(rawLeague, { ...state, display_week: 22 })).toBe(18);
    expect(currentWeek(rawLeague, { ...state, display_week: 0 })).toBe(1);
    expect(currentWeek(rawLeague, null)).toBe(1);
  });

  it('loads weeks through league activity and checks all history when state is unavailable', () => {
    expect(transactionEndWeek(rawLeague, state)).toBe(1);
    expect(transactionEndWeek({ ...rawLeague, settings: { leg: 4, last_scored_leg: 5 } }, state)).toBe(5);
    expect(transactionEndWeek(rawLeague, null)).toBe(18);
  });

  it('does not claim live football before the published season start', () => {
    expect(matchupStatus(rawLeague, state, 1, Date.parse('2026-08-31T12:00:00Z'))).toBe('upcoming');
  });

  it('does not guess a live game from a calendar window or advance finality with display_week', () => {
    const now = Date.parse('2026-09-27T18:00:00Z');
    const week = { ...state, leg: 3, display_week: 4 };
    expect(matchupStatus(rawLeague, week, 2, now)).toBe('final');
    expect(matchupStatus(rawLeague, week, 3, now)).toBe('unknown');
    expect(matchupStatus(rawLeague, week, 4, now)).toBe('upcoming');
    expect(matchupStatus(rawLeague, null, 1, now)).toBe('unknown');
  });
});

describe('standings, avatars and scores', () => {
  it('keeps real decimal totals and represents missing numeric values without inventing zero', () => {
    expect(seasonPoints(1670, 32)).toBe(1670.32);
    expect(seasonPoints(12, 8)).toBe(12.08);
    expect(numberOrNull(null)).toBeNull();
    expect(numberOrNull('')).toBeNull();
    expect(numberOrNull(false)).toBeNull();
    expect(numberOrNull('0')).toBe(0);
  });

  it('uses ties in win percentage and points as the tie break', () => {
    const rows = normalizeTeams([
      { roster_id: 1, settings: { wins: 2, losses: 1, ties: 1, fpts: 50, fpts_decimal: 2 } },
      { roster_id: 2, settings: { wins: 2, losses: 2, ties: 0, fpts: 1000 } },
      { roster_id: 3, settings: { wins: 2, losses: 1, ties: 1, fpts: 50, fpts_decimal: 3 } },
    ], [], league);
    expect(rows.map((row) => row.id)).toEqual([3, 1, 2]);
  });

  it('resolves team names and keeps an unavailable budget distinct from an exhausted one', () => {
    expect(teams[0]).toMatchObject({ name: 'The Owls', ownerName: 'Alex', pointsFor: 310.42, faabRemaining: null });
    const rows = normalizeTeams([{ roster_id: 4, settings: { waiver_budget_used: 100 } }], [], league);
    expect(rows[0].faabRemaining).toBe(0);
    expect(rows[0].ownerId).toBeNull();
  });

  it('accepts Sleeper hashes and HTTPS avatars but rejects active and insecure URLs', () => {
    expect(safeAvatar('a1b2c3')).toBe('https://sleepercdn.com/avatars/thumbs/a1b2c3');
    expect(safeAvatar('https://images.example.com/team.png')).toBe('https://images.example.com/team.png');
    expect(safeAvatar('javascript:alert(1)')).toBeNull();
    expect(safeAvatar('http://images.example.com/team.png')).toBeNull();
    expect(safeAvatar('https://user:pass@images.example.com/team.png')).toBeNull();
    expect(safeAvatar(null)).toBeNull();
  });
});

describe('rosters and matchups', () => {
  it('keeps the actual player position separate from the FLEX lineup slot', () => {
    const players = lineup(['qb', 'rb', 'wr', '0', 'PIT'], league.rosterPositions, catalog, [20.42, 0, -1.2, null, 7]);
    expect(players).toHaveLength(5);
    expect(players[2]).toMatchObject({ name: 'Wide Receiver', position: 'WR', slot: 'FLEX', points: -1.2 });
    expect(players[3]).toMatchObject({ name: 'Empty slot', slot: 'FLEX', points: null });
    expect(players[4]).toMatchObject({ name: 'PIT Defense', position: 'DEF', nflTeam: 'PIT' });
  });

  it('fills missing starter slots and preserves explicit unknown scores', () => {
    const players = lineup(['qb', 'rb'], ['QB', 'RB', 'FLEX'], catalog, [null, 0], { qb: 8, rb: 2 });
    expect(players[0].points).toBeNull();
    expect(players[1].points).toBe(0);
    expect(players[2].name).toBe('Empty slot');
    expect(lineup(['qb'], ['QB'], catalog, undefined, { qb: 12.34 })[0].points).toBe(12.34);
  });

  it('keeps IR and taxi players out of the bench and preserves their labels', () => {
    const result = ownerLineup({ roster_id: 1, starters: ['qb'], players: ['qb', 'rb', 'reserve', 'taxi'], reserve: ['reserve'], taxi: ['taxi'] }, league, catalog);
    expect(result.bench.map((player) => player.id)).toEqual(['rb']);
    expect(result.reserve.map((player) => player.slot)).toEqual(['IR', 'TAXI']);
  });

  it('honors custom zero points, never groups separate unpaired teams, and omits duplicate entries', () => {
    const groups = normalizeMatchups([
      { roster_id: 1, matchup_id: 3, points: 20, custom_points: 0, starters: ['qb'] },
      { roster_id: 2, matchup_id: null, points: null },
      { roster_id: 3, matchup_id: null, points: 0 },
      { roster_id: 1, matchup_id: 3, points: 20 },
    ], teams, league, catalog, 'unknown');
    expect(groups).toHaveLength(3);
    expect(groups[0].sides[0].points).toBe(0);
    expect(groups[1].sides[0].points).toBeNull();
    expect(groups[1].id).not.toBe(groups[2].id);
  });
});

describe('transaction completeness and outcome', () => {
  it('distinguishes successful and failed waivers from failed trades and unknown states', () => {
    expect(transactionResult(transaction())).toBe('Won');
    expect(transactionResult(transaction({ status: 'failed' }))).toBe('Lost');
    expect(transactionResult(transaction({ type: 'trade', status: 'failed' }))).toBe('Failed');
    expect(transactionResult(transaction({ type: 'free_agent', status: 'complete' }))).toBe('Complete');
    expect(transactionResult(transaction({ status: 'pending' }))).toBe('Pending');
    expect(transactionResult(transaction({ status: 'cancelled' }))).toBe('Failed');
    expect(transactionResult(transaction({ status: 'something_new' }))).toBe('Unknown');
  });

  it('skips absent bids instead of converting them to $0 and retains a genuine zero bid', () => {
    expect(waiverBid(transaction({ settings: { waiver_bid: null }, metadata: { waiver_bid: 17 } }))).toBe(17);
    expect(waiverBid(transaction({ settings: { waiver_bid: '' }, waiver_bid: '5' }))).toBe(5);
    expect(waiverBid(transaction({ settings: { waiver_bid: 0 } }))).toBe(0);
    expect(waiverBid(transaction({ settings: { waiver_bid: null } }))).toBeNull();
    expect(waiverBid(transaction({ type: 'trade', waiver_bid: 12 }))).toBeNull();
  });

  it('includes trades represented only by draft pick or FAAB transfers', () => {
    const pickTrade = transaction({ roster_ids: [], draft_picks: [{ previous_owner_id: 1, owner_id: 2, roster_id: 3 }] });
    const budgetTrade = transaction({ roster_ids: null, waiver_budget: [{ sender: 1, receiver: 2, amount: 20 }] });
    expect(involvesRoster(pickTrade, 1)).toBe(true);
    expect(involvesRoster(pickTrade, 2)).toBe(true);
    expect(involvesRoster(pickTrade, 3)).toBe(false);
    expect(involvesRoster(budgetTrade, 1)).toBe(true);
    expect(involvesRoster(budgetTrade, 2)).toBe(true);
  });

  it('includes add/drop and consent-only participation when roster_ids is absent', () => {
    expect(involvesRoster(transaction({ roster_ids: [], adds: { qb: 2 } }), 2)).toBe(true);
    expect(involvesRoster(transaction({ roster_ids: [], drops: { qb: 2 } }), 2)).toBe(true);
    expect(involvesRoster(transaction({ roster_ids: [], consenter_ids: [2] }), 2)).toBe(true);
  });

  it('renders each trade participant, pick ownership, and FAAB transfer direction', () => {
    const result = normalizeTransactions([transaction({
      type: 'trade', roster_ids: [1, 2], adds: { rb: 1, wr: 2 }, drops: { rb: 2, wr: 1 },
      draft_picks: [{ season: '2027', round: 2, roster_id: 3, previous_owner_id: 2, owner_id: 1 }],
      waiver_budget: [{ sender: 1, receiver: 2, amount: 25 }],
    })], 1, teams, catalog)[0];
    expect(result.lines).toEqual([
      { label: 'The Owls receives', text: 'Running Back (RB · SEA)' },
      { label: 'The Bears receives', text: 'Wide Receiver (WR · BUF)' },
      { label: 'Draft pick', text: '2027 round 2 (The Foxes original pick): The Bears → The Owls' },
      { label: 'FAAB transfer', text: '$25 · The Owls → The Bears' },
    ]);
    expect(result.bid).toBeNull();
  });

  it('retains visible failure explanations and all player add/drop details', () => {
    const result = normalizeTransactions([transaction({ status: 'failed', adds: { qb: 1 }, drops: { wr: 1 }, settings: { waiver_bid: 8 }, metadata: { notes: 'Insufficient FAAB' } })], 1, teams, catalog)[0];
    expect(result).toMatchObject({ result: 'Lost', bid: 8 });
    expect(result.lines.map((line) => line.label)).toEqual(['Add', 'Drop', 'Note']);
    expect(result.lines[2].text).toBe('Insufficient FAAB');
  });

  it('deduplicates across weeks using the newest state and sorts by result time', () => {
    const rows = normalizeTransactions([
      transaction({ transaction_id: 'older', status: 'pending', created: 1000 }),
      transaction({ transaction_id: 'newer', created: 2000 }),
      transaction({ transaction_id: 'older', status: 'complete', created: 1000, status_updated: 3000 }),
      transaction({ transaction_id: 'other-team', created: 4000, roster_ids: [2] }),
    ], 1, teams, catalog);
    expect(rows.map((row) => row.id)).toEqual(['older', 'newer']);
    expect(rows[0].result).toBe('Won');
    expect(rows[0].date).toBe('1970-01-01T00:00:03.000Z');
  });

  it('does not manufacture a transaction date when timestamps are missing or invalid', () => {
    const rows = normalizeTransactions([transaction({ created: -1, status_updated: Infinity })], 1, teams, catalog);
    expect(rows[0].date).toBeNull();
  });
});
