import { describe, expect, it } from 'vitest';
import { LEAGUE_SITES, leagueSiteForPathname } from './leagues';

describe('league route identity', () => {
  it.each(['/league2', '/league2/matchups', '/league2/owners/3/transactions'])(
    'recognizes %s as League Two',
    (pathname) => expect(leagueSiteForPathname(pathname)).toBe(LEAGUE_SITES.league2),
  );

  it.each(['/', '/matchups', '/owners/3', '/league20/matchups', '/league-two/matchups'])(
    'keeps %s in League One',
    (pathname) => expect(leagueSiteForPathname(pathname)).toBe(LEAGUE_SITES.league1),
  );
});
