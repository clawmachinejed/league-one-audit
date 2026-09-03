import type { LeagueConfiguration } from '../domain/contracts';

export type LeagueRegistryPort = Readonly<{
  listActiveLeagues: () => readonly LeagueConfiguration[];
}>;
