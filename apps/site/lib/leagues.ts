export type LeagueKey = 'league1' | 'league2' | 'dynasty';

export interface LeagueSite {
  key: LeagueKey;
  name: 'League One' | 'League Two' | 'Dynasty League';
  brand: 'LEAGUE ONE' | 'LEAGUE TWO' | 'DYNASTY LEAGUE';
  prefix: '' | '/league2' | '/dynasty';
  logo: '/league-one-logo-63ab193e.jpg' | '/league-two-logo-6c951682.jpg' | '/dynasty-logo-d0aa2176.png';
}

export const LEAGUE_SITES: Record<LeagueKey, LeagueSite> = {
  league1: {
    key: 'league1',
    name: 'League One',
    brand: 'LEAGUE ONE',
    prefix: '',
    logo: '/league-one-logo-63ab193e.jpg',
  },
  league2: {
    key: 'league2',
    name: 'League Two',
    brand: 'LEAGUE TWO',
    prefix: '/league2',
    logo: '/league-two-logo-6c951682.jpg',
  },
  dynasty: {
    key: 'dynasty',
    name: 'Dynasty League',
    brand: 'DYNASTY LEAGUE',
    prefix: '/dynasty',
    logo: '/dynasty-logo-d0aa2176.png',
  },
};

export function leagueSiteForPathname(pathname: string): LeagueSite {
  return Object.values(LEAGUE_SITES).find(site => site.prefix
    && (pathname === site.prefix || pathname.startsWith(`${site.prefix}/`)))
    ?? LEAGUE_SITES.league1;
}
