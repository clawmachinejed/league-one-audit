import type {
  LeagueConfiguration,
  LeagueWeekState,
} from '../domain/contracts';

export type LeagueSourcePort = Readonly<{
  getLeagueWeek: (configuration: LeagueConfiguration) => Promise<LeagueWeekState>;
}>;
