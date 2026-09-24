export type RelativeRankBand = 'upper' | 'middle' | 'lower' | 'unknown';

/**
 * Relative league position, independent of playoffs or relegation. The upper
 * third ends at ceil(N / 3); the middle third ends at ceil(2N / 3). Rounding
 * boundary positions upward gives one shared convention for every league size.
 */
export function relativeRankBand(rank: number | null, leagueSize: number): RelativeRankBand {
  if (!Number.isSafeInteger(leagueSize) || leagueSize < 1 || rank === null
    || !Number.isSafeInteger(rank) || rank < 1 || rank > leagueSize) return 'unknown';
  if (rank <= Math.ceil(leagueSize / 3)) return 'upper';
  if (rank <= Math.ceil(2 * leagueSize / 3)) return 'middle';
  return 'lower';
}
