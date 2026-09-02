export type LeagueKey = 'league1' | 'league2';

export interface LeagueSite {
  key: LeagueKey;
  name: 'League One' | 'League Two';
  brand: 'LEAGUE ONE' | 'LEAGUE TWO';
  prefix: '' | '/league2';
  logo: '/logo.png' | '/league2-logo.jpg';
}

export const LEAGUE_SITES: Record<LeagueKey, LeagueSite> = {
  league1: {
    key: 'league1',
    name: 'League One',
    brand: 'LEAGUE ONE',
    prefix: '',
    logo: '/logo.png',
  },
  league2: {
    key: 'league2',
    name: 'League Two',
    brand: 'LEAGUE TWO',
    prefix: '/league2',
    logo: '/league2-logo.jpg',
  },
};

export function leagueSiteForPathname(pathname: string): LeagueSite {
  const leagueTwoPrefix = LEAGUE_SITES.league2.prefix;
  return pathname === leagueTwoPrefix || pathname.startsWith(`${leagueTwoPrefix}/`)
    ? LEAGUE_SITES.league2
    : LEAGUE_SITES.league1;
}
