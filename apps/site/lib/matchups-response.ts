import { MATCHUPS_SHAPE, matchesShape } from './matchups-shape';
import type { MatchupsData } from './types';

/** Strict client boundary for replacing a complete, currently rendered matchup snapshot. */
export function isMatchupsData(value: unknown): value is MatchupsData {
  return matchesShape(MATCHUPS_SHAPE, value);
}
