import type { LeagueKey } from './leagues';

// Golden source for both public Sleeper league IDs. They exceed JavaScript's safe
// integer range, so keep them as strings and reference this registry everywhere.
export const LEAGUE_IDS = {
  league1: '1378850182409490432',
  league2: '1378850360529014784',
} as const satisfies Readonly<Record<LeagueKey, string>>;

/** League One remains the default for existing routes and callers. */
export const LEAGUE_ID: string = LEAGUE_IDS.league1;
