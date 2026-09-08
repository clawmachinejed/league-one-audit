import { beforeEach, describe, expect, it, vi } from 'vitest';

const getRosters = vi.hoisted(() => vi.fn());
vi.mock('server-only', () => ({}));
vi.mock('./sleeper', () => ({ getRosters }));

import { LEAGUE_IDS } from './config';
import { handleLeagueRostersRequest } from './league-rosters-http';

describe('league rosters HTTP boundary', () => {
  beforeEach(() => getRosters.mockReset());

  it('maps a valid league and exact week through the canonical registry', async () => {
    getRosters.mockResolvedValue({ teams: [], week: 18 });
    const response = await handleLeagueRostersRequest(new Request('https://example.test/api/rosters/league2?week=18'), 'league2');
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(getRosters).toHaveBeenCalledWith(LEAGUE_IDS.league2, 18);
  });

  it.each(['', '0', '19', '1.5', 'abc', '2<script>'])('rejects malformed week %s without provider work', async (week) => {
    const response = await handleLeagueRostersRequest(new Request(`https://example.test/api/rosters/league1?week=${encodeURIComponent(week)}`), 'league1');
    expect(response.status).toBe(400);
    expect(getRosters).not.toHaveBeenCalled();
  });

  it('rejects arbitrary league identifiers without provider work', async () => {
    const response = await handleLeagueRostersRequest(new Request('https://example.test/api/rosters/raw-id?week=1'), 'raw-id');
    expect(response.status).toBe(404);
    expect(getRosters).not.toHaveBeenCalled();
  });

  it('keeps total provider failure local to the inline panel', async () => {
    const failingLoader = vi.fn(async () => { throw new Error('private provider detail'); });
    const response = await handleLeagueRostersRequest(
      new Request('https://example.test/api/rosters/league1?week=1'), 'league1', failingLoader,
    );
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: 'League rosters are temporarily unavailable. Please try again.' });
  });
});
