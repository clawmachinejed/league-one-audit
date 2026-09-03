import 'server-only';

import type { LineupSourcePort } from '../../ports/lineup-source';
import { validLineupShape } from '../../domain/lineup-observation';
import { sameExternalReference } from '../../shared/provider-identity';
import { translateSleeperLineupObservation } from './lineup-observation';
import { InvalidRawSleeperMatchupsError, type RawSleeperMatchupObservation } from './raw-matchups';

export type SleeperLineupLoader = (leagueId: string, week: number, signal?: AbortSignal) => Promise<RawSleeperMatchupObservation>;

/** One uncached matchup request; no player catalog, users, schedule, scoring or projection work. */
export function createSleeperLineupSource(
  load: SleeperLineupLoader,
  now: () => Date,
): LineupSourcePort {
  return {
    async getLineup({ configuration, period, shape }, signal) {
      const requestStartedAt = now().toISOString();
      const ended = () => ({ requestStartedAt, requestCompletedAt: now().toISOString() });
      if (!validLineupShape(shape)) return { status: 'invalid', reason: 'shape-unavailable', ...ended() };
      if (shape.expectedRosterRefs.some((ref) => ref.provider !== configuration.leagueRef.provider
        || !sameExternalReference(ref.league, configuration.leagueRef))) {
        return { status: 'invalid', reason: 'identity-invalid', ...ended() };
      }
      if (period.seasonType !== 'regular' || !Number.isInteger(period.season)
        || period.season < 1920 || period.season > 2200 || !Number.isInteger(period.week)
        || period.week < configuration.matchupWeekRange.firstWeek || period.week > configuration.matchupWeekRange.lastWeek) {
        return { status: 'invalid', reason: 'period-invalid', ...ended() };
      }
      try {
        const source = await load(String(configuration.leagueRef.externalId), period.week, signal);
        return { ...translateSleeperLineupObservation(configuration.leagueRef, period, shape, source.rows),
          requestStartedAt: source.requestStartedAt, requestCompletedAt: source.requestCompletedAt };
      } catch (error) {
        return error instanceof InvalidRawSleeperMatchupsError
          ? { status: 'invalid', reason: 'roster-population-incomplete', ...ended() }
          : { status: 'unavailable', reason: 'source-unavailable', ...ended() };
      }
    },
  };
}
