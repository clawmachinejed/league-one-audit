import type { LeagueConfiguration } from '../domain/contracts';

export type LeagueRegistryPort = Readonly<{
  listActiveLeagues: () => readonly LeagueConfiguration[];
  /** Complete intended membership; unavailable registrations must not imply retirement. */
  registration?: Readonly<{ intendedLeagueKeys: readonly string[];
    failures: readonly Readonly<{ leagueKey: string; reason: string }>[] }>;
}>;
