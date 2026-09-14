import { describe, expect, it } from 'vitest';
import { LEAGUE_SITES, leagueSiteForPathname } from './leagues';

describe('league route identity', () => {
  it('uses the provided JPEG brand assets for each league', () => {
    expect(LEAGUE_SITES.league1.logo).toBe('/league-one-logo-63ab193e.jpg');
    expect(LEAGUE_SITES.league2.logo).toBe('/league-two-logo-6c951682.jpg');
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
