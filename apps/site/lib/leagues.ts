export type LeagueKey = 'league1' | 'league2' | 'dynasty';
export type LeagueRouteKey = LeagueKey | `sleeper-${string}`;
export const SITE_LOGO = '/league-one-site-20260925.png';

export function sleeperLeagueLogo(avatar: unknown): string | null {
  return typeof avatar === 'string' && /^[a-zA-Z0-9_-]{1,128}$/u.test(avatar)
    ? `https://sleepercdn.com/avatars/${avatar}` : null;
}

export function isLeagueRouteKey(key: string): key is LeagueRouteKey {
  return Object.hasOwn(LEAGUE_SITES, key) || /^sleeper-[1-9]\d{0,31}$/u.test(key);
}

export function siteForLeague(key: string, name: string, logo?: string | null): LeagueSite | null {
  if (!isLeagueRouteKey(key)) return null;
  const known = Object.hasOwn(LEAGUE_SITES, key) ? LEAGUE_SITES[key as LeagueKey] : null;
  return { key, name, brand: name.toUpperCase(), prefix: known?.prefix ?? `/leagues/${key}`,
    logo: logo || known?.logo || '/league-placeholder.svg' };
}

export interface LeagueSite {
  key: LeagueRouteKey;
  name: string;
  brand: string;
  prefix: string;
  logo: string;
}

export const LEAGUE_SITES: Record<LeagueKey, LeagueSite & { key: LeagueKey }> = {
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

export function leagueSiteForPathname(pathname: string): LeagueSite & { key: LeagueKey } {
  return Object.values(LEAGUE_SITES).find(site => site.prefix
    && (pathname === site.prefix || pathname.startsWith(`${site.prefix}/`)))
    ?? LEAGUE_SITES.league1;
}
