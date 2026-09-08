import { beforeEach, describe, expect, it, vi } from 'vitest';

const getLeagueTransactions = vi.hoisted(() => vi.fn());
vi.mock('server-only', () => ({}));
vi.mock('./sleeper', () => ({ getLeagueTransactions }));

import { LEAGUE_IDS } from './config';
import { handleLeagueTransactionsRequest } from './league-transactions-http';

describe('league transaction HTTP boundary', () => {
  beforeEach(() => getLeagueTransactions.mockReset());

  it('rejects arbitrary league IDs without invoking Sleeper', async () => {
    const response = await handleLeagueTransactionsRequest('1378850182409490432');
    expect(response.status).toBe(404);
    expect(getLeagueTransactions).not.toHaveBeenCalled();
  });

  it.each([
    ['league1', LEAGUE_IDS.league1], ['league2', LEAGUE_IDS.league2],
  ])('maps %s through the canonical registry', async (key, leagueId) => {
    getLeagueTransactions.mockResolvedValue({ activities: [] });
    const response = await handleLeagueTransactionsRequest(key, getLeagueTransactions);
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(getLeagueTransactions).toHaveBeenCalledWith(leagueId, key);
  });

  it('returns a safe inline-compatible unavailable response on total failure', async () => {
    const failingLoader = vi.fn(async () => {
      throw new Error('raw provider detail');
    });
    const response = await handleLeagueTransactionsRequest('league1', failingLoader);
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: 'League transaction history is temporarily unavailable. Please try again.' });
  });
});
