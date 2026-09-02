export const NFL_TEAMS = [
  'ARI', 'ATL', 'BAL', 'BUF', 'CAR', 'CHI', 'CIN', 'CLE',
  'DAL', 'DEN', 'DET', 'GB', 'HOU', 'IND', 'JAX', 'KC',
  'LAC', 'LAR', 'LV', 'MIA', 'MIN', 'NE', 'NO', 'NYG',
  'NYJ', 'PHI', 'PIT', 'SEA', 'SF', 'TB', 'TEN', 'WAS',
] as const;

export type NflTeam = (typeof NFL_TEAMS)[number];

export const NFL_TEAM_COUNT = NFL_TEAMS.length;

const nflTeamSet = new Set<string>(NFL_TEAMS);

const teamAliases: Readonly<Record<string, NflTeam>> = {
  JAC: 'JAX',
  LA: 'LAR',
  WSH: 'WAS',
};

/** Returns true only for the site's canonical uppercase NFL abbreviations. */
export function isNflTeam(value: unknown): value is NflTeam {
  return typeof value === 'string' && nflTeamSet.has(value);
}

/**
 * Converts provider abbreviations to one stable representation. Unknown teams are
 * rejected rather than being allowed to create permanent external-ID mappings.
 */
export function canonicalNflTeam(value: unknown): NflTeam | null {
  if (typeof value !== 'string') return null;
  const abbreviation = value.trim().toUpperCase();
  if (!abbreviation) return null;
  const canonical = teamAliases[abbreviation] ?? abbreviation;
  return isNflTeam(canonical) ? canonical : null;
}
