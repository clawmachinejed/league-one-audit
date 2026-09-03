import type { LeagueCadenceState, LeagueConfiguration } from '../domain/contracts';

export type NflCalendarPort = Readonly<{
  getCadenceState: (configuration: LeagueConfiguration) => Promise<LeagueCadenceState>;
}>;
