import type { LeagueKey } from './leagues';

// Sleeper IDs exceed JavaScript's safe integer range. Always keep them as strings.
export const LEAGUE_IDS: Readonly<Record<LeagueKey, string>> = {
  league1: process.env.SLEEPER_LEAGUE_ID?.trim() || '1378850182409490432',
  league2: process.env.SLEEPER_LEAGUE_2_ID?.trim() || '1188632897157021696',
};

/** League One remains the default for existing routes and callers. */
export const LEAGUE_ID = LEAGUE_IDS.league1;
