import { describe, expect, it } from 'vitest';
import { LEAGUE_SITES, leagueSiteForPathname } from './leagues';

describe('league route identity', () => {
  it('uses the dedicated League Two PNG brand asset', () => {
    expect(LEAGUE_SITES.league2.logo).toBe('/league2-logo.png');
  });

  it.each(['/league2', '/league2/matchups', '/league2/managers/3/transactions'])(
    'recognizes %s as League Two',
    (pathname) => expect(leagueSiteForPathname(pathname)).toBe(LEAGUE_SITES.league2),
  );

  it.each(['/', '/matchups', '/managers/3', '/league20/matchups', '/league-two/matchups'])(
    'keeps %s in League One',
    (pathname) => expect(leagueSiteForPathname(pathname)).toBe(LEAGUE_SITES.league1),
  );
});
