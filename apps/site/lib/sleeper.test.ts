import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('react', () => ({ cache: <T,>(fn: T) => fn }));
vi.mock('next/cache', () => ({ unstable_cache: <T,>(fn: T) => fn }));
vi.mock('./config', () => ({ LEAGUE_ID: '1378850182409490432' }));

import { getMatchups, getOverview, getOwner, getTransactions } from './sleeper';

const leaguePath = '/league/1378850182409490432';
let failures: Set<string>;
let seasonType: string;
let invalidLeague: boolean;
let activeTransactionRequests: number;
let maxTransactionRequests: number;

function valueFor(path: string): unknown {
  if (path === leaguePath) return invalidLeague ? null : {
    league_id: '1378850182409490432', name: 'League One', season: '2026', status: 'in_season',
    roster_positions: ['QB', 'BN'], settings: { waiver_budget: 100, leg: 3 }, scoring_settings: { rec: 0.5 },
  };
  if (path === `${leaguePath}/rosters`) return [{ roster_id: 1, owner_id: 'member-1', players: ['qb'], starters: ['qb'] }];
  if (path === `${leaguePath}/users`) return [{ user_id: 'member-1', display_name: 'Alex' }];
  if (path === '/state/nfl') return { season: '2026', season_type: seasonType, leg: 3, week: 3, display_week: 3 };
  if (path === '/players/nfl') return { qb: { full_name: 'Quarter Back', position: 'QB', team: 'IND' } };
  if (path.startsWith(`${leaguePath}/matchups/`)) return [{ roster_id: 1, matchup_id: null, points: null, starters: ['qb'] }];
  if (path.startsWith(`${leaguePath}/transactions/`)) {
    const week = Number(path.split('/').at(-1));
    return week === 0 ? [{ transaction_id: 'week-zero', type: 'waiver', status: 'failed', roster_ids: [1], adds: { qb: 1 }, settings: { waiver_bid: 7 } }] : [];
  }
  throw new Error(`Unexpected test endpoint: ${path}`);
}

beforeEach(() => {
  failures = new Set();
  seasonType = 'regular';
  invalidLeague = false;
  activeTransactionRequests = 0;
  maxTransactionRequests = 0;
  vi.stubGlobal('fetch', vi.fn(async (input: string) => {
    const path = new URL(input).pathname.replace(/^\/v1/, '');
    const transactionRequest = path.includes('/transactions/');
    if (transactionRequest) {
      activeTransactionRequests += 1;
      maxTransactionRequests = Math.max(maxTransactionRequests, activeTransactionRequests);
      await new Promise((resolve) => setTimeout(resolve, 1));
      activeTransactionRequests -= 1;
    }
    if (failures.has(path) || (transactionRequest && failures.has('all-transactions'))) return new Response('Unavailable', { status: 503 });
    return Response.json(valueFor(path));
  }));
});

afterEach(() => vi.unstubAllGlobals());

describe('Sleeper service error handling', () => {
  it('loads preseason week zero transactions and makes partial history visible', async () => {
    failures.add(`${leaguePath}/transactions/1`);
    const data = await getTransactions(1);
    expect(data?.partial).toBe(true);
    expect(data?.warning).toContain('weeks 1');
    expect(data?.transactions).toHaveLength(1);
    expect(data?.transactions[0]).toMatchObject({ id: 'week-zero', result: 'Lost', bid: 7 });
  });

  it('fails visibly instead of returning an empty activity feed when every history request fails', async () => {
    failures.add('all-transactions');
    await expect(getTransactions(1)).rejects.toThrow('transaction history is temporarily unavailable');
  });

  it('caps concurrent history calls while still checking the full completed NFL season', async () => {
    seasonType = 'post';
    const data = await getTransactions(1);
    const calls = vi.mocked(fetch).mock.calls.filter(([url]) => String(url).includes('/transactions/'));
    expect(calls).toHaveLength(19);
    expect(maxTransactionRequests).toBeLessThanOrEqual(4);
    expect(data?.partial).toBe(false);
  });

  it('retains the roster with a visible player-catalog warning', async () => {
    failures.add('/players/nfl');
    const data = await getOwner(1);
    expect(data?.warning).toContain('Player names are temporarily unavailable');
    expect(data?.starters[0]).toMatchObject({ id: 'qb', name: 'Player qb', slot: 'QB' });
  });

  it('does not fall back to invented teams when the configured league is invalid', async () => {
    invalidLeague = true;
    await expect(getOverview()).rejects.toThrow('valid league');
  });

  it('rejects invalid owner IDs without network requests and returns null for absent owners', async () => {
    expect(await getOwner(0)).toBeNull();
    expect(await getTransactions(NaN)).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
    expect(await getOwner(999)).toBeNull();
  });

  it('falls back to a bounded display week when a query contains an invalid week', async () => {
    const data = await getMatchups(Infinity);
    expect(data.week).toBe(3);
    expect(data.matchups[0].sides[0].points).toBeNull();
    expect(vi.mocked(fetch).mock.calls.some(([url]) => String(url).endsWith('/matchups/3'))).toBe(true);
  });

  it('warns when state is missing and avoids asserting a live or final matchup', async () => {
    failures.add('/state/nfl');
    const data = await getMatchups(1);
    expect(data.warning).toContain('NFL week information is temporarily unavailable');
    expect(data.matchups[0].status).toBe('unknown');
  });
});
