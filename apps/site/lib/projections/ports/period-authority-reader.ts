import type { LeagueConfiguration, LeaguePeriodAuthority } from '../domain/contracts';
import type { LineupShape } from '../domain/lineup-observation';
import type { PeriodCadenceTiming } from '../domain/period-cadence-timing';

export type LineupPeriodAuthority = Readonly<{
  configuration: LeagueConfiguration;
  authority: LeaguePeriodAuthority;
  authorityGeneration: number;
  shape: LineupShape;
  defaultPeriodCadence: PeriodCadenceTiming;
}>;

export type PeriodAuthorityReadResult =
  | Readonly<{ kind: 'present'; leagueKey: string; value: LineupPeriodAuthority }>
  | Readonly<{ kind: 'missing' | 'malformed' | 'stale' | 'provider-mismatch' | 'database-error'; leagueKey: string }>;

export type PeriodAuthorityReaderPort = Readonly<{
  readAuthorities: (
    leagueKeys: readonly string[], asOf: Date, maxAgeMs: number,
  ) => Promise<readonly PeriodAuthorityReadResult[]>;
}>;
