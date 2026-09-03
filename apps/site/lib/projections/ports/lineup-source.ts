import type { LeagueConfiguration, LeaguePeriod, LineupShape } from '../domain/contracts';
import type { TimedLineupObservation } from '../domain/lineup-observation';

export type LineupSourcePort = Readonly<{
  getLineup(input: Readonly<{
    configuration: LeagueConfiguration;
    period: LeaguePeriod;
    shape: LineupShape;
  }>, signal?: AbortSignal): Promise<TimedLineupObservation>;
}>;
