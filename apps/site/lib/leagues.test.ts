import { describe, expect, it } from 'vitest';
import { LEAGUE_SITES, leagueSiteForPathname } from './leagues';
import { LEAGUE_IDS } from './config';

describe('league route identity', () => {
  it('uses the provided JPEG brand assets for each league', () => {
    expect(LEAGUE_SITES.league1.logo).toBe('/league-one-logo-63ab193e.jpg');
    expect(LEAGUE_SITES.league2.logo).toBe('/league-two-logo-6c951682.jpg');
    expect(LEAGUE_SITES.dynasty.logo).toBe('/dynasty-logo-d0aa2176.png');
  });

  it.each(['/league2', '/league2/matchups', '/league2/managers/3/transactions'])(
    'recognizes %s as League Two',
    (pathname) => expect(leagueSiteForPathname(pathname)).toBe(LEAGUE_SITES.league2),
  );

  it.each(['/dynasty', '/dynasty/my-team', '/dynasty/matchups', '/dynasty/standings', '/dynasty/managers/3/transactions'])(
    'recognizes %s as Dynasty League',
    (pathname) => expect(leagueSiteForPathname(pathname)).toBe(LEAGUE_SITES.dynasty),
  );

  it('uses separate opaque IDs and route prefixes for all registered leagues', () => {
    expect(LEAGUE_IDS.dynasty).toBe('1312138224994385920');
    expect(Object.keys(LEAGUE_IDS).sort()).toEqual(Object.keys(LEAGUE_SITES).sort());
    expect(new Set(Object.values(LEAGUE_IDS)).size).toBe(3);
    expect(new Set(Object.values(LEAGUE_SITES).map(site => site.prefix)).size).toBe(3);
  });

  it.each(['/', '/matchups', '/managers/3', '/league20/matchups', '/league-two/matchups', '/dynasty2/matchups', '/dynasty-league/matchups'])(
    'keeps %s in League One',
    (pathname) => expect(leagueSiteForPathname(pathname)).toBe(LEAGUE_SITES.league1),
  );
});
