import type {
  LeagueConfiguration,
  LeaguePeriod,
  LeagueWeekState,
} from '../domain/contracts';

export type LeagueSourcePort = Readonly<{
  getLeagueWeek: (
    configuration: LeagueConfiguration,
    targetPeriod: LeaguePeriod,
  ) => Promise<LeagueWeekState>;
}>;
