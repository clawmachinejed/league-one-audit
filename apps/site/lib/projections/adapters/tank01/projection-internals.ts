import type {
  DefenseProjectionStats,
  KickerProjectionStats,
  OffenseProjectionStats,
} from '../../domain/contracts';

export const SUCCESS_CACHE_SECONDS = 60 * 60;
export const FAILURE_BACKOFF_MS = 60 * 1_000;
export const REQUEST_TIMEOUT_MS = 15_000;

export type Tank01PlayerStats = Readonly<{
  passing: Readonly<{
    attempts: number | null;
    completions: number | null;
    yards: number | null;
    touchdowns: number | null;
    interceptions: number | null;
  }>;
  rushing: Readonly<{
    carries: number | null;
    yards: number | null;
    touchdowns: number | null;
  }>;
  receiving: Readonly<{
    targets: number | null;
    receptions: number | null;
    yards: number | null;
    touchdowns: number | null;
  }>;
  kicking: Readonly<{
    fieldGoalsMade: number | null;
    fieldGoalsMissed: number | null;
    extraPointsMade: number | null;
    extraPointsMissed: number | null;
  }>;
  twoPointConversions: number | null;
  fumblesLost: number | null;
}>;

export type Tank01DefenseStats = Readonly<{
  returnTouchdowns: number | null;
  defensiveTouchdowns: number | null;
  safeties: number | null;
  fumbleRecoveries: number | null;
  pointsAllowed: number | null;
  interceptions: number | null;
  sacks: number | null;
  blockedKicks: number | null;
}>;

export type Tank01PlayerProjection = Readonly<{
  tank01PlayerId: string;
  sleeperPlayerId: string;
  team: string | null;
  position: string | null;
  stats: Tank01PlayerStats;
  scoringProjection: OffenseProjectionStats | KickerProjectionStats;
  missingFields: readonly string[];
}>;

export type Tank01DefenseProjection = Readonly<{
  team: string;
  stats: Tank01DefenseStats;
  scoringProjection: DefenseProjectionStats;
  missingFields: readonly string[];
}>;

export type Tank01ProjectionCoverage = Readonly<{
  playerListRows: number;
  crosswalkEntries: number;
  malformedPlayerListRows: number;
  ambiguousPlayerListRows: number;
  playerProjectionRows: number;
  matchedPlayerProjections: number;
  unmatchedPlayerProjections: number;
  malformedPlayerProjections: number;
  incompletePlayerProjections: number;
  defenseProjectionRows: number;
  usableDefenseProjections: number;
  malformedDefenseProjections: number;
  incompleteDefenseProjections: number;
}>;

export type Tank01AvailableResult = Readonly<{
  status: 'available';
  season: string;
  week: number;
  fetchedAt: string;
  projections: Readonly<{
    bySleeperId: Readonly<Record<string, Tank01PlayerProjection>>;
    byDefenseTeam: Readonly<Record<string, Tank01DefenseProjection>>;
  }>;
  coverage: Tank01ProjectionCoverage;
  warnings: readonly string[];
}>;

export type CacheEntry<T> = Readonly<{ value: T; expiresAt: number }>;

export type NormalizedPlayerProjection = Readonly<{
  tank01PlayerId: string;
  team: string | null;
  position: string | null;
  stats: Tank01PlayerStats;
  scoringProjection: OffenseProjectionStats | KickerProjectionStats;
  missingFields: readonly string[];
}>;

export type NormalizedProjectionSlate = Readonly<{
  fetchedAtMs: number;
  playersByTank01Id: Readonly<Record<string, NormalizedPlayerProjection>>;
  defensesByTeam: Readonly<Record<string, Tank01DefenseProjection>>;
  playerProjectionRows: number;
  malformedPlayerProjections: number;
  incompletePlayerProjections: number;
  defenseProjectionRows: number;
  malformedDefenseProjections: number;
  incompleteDefenseProjections: number;
}>;

export type NormalizedCrosswalk = Readonly<{
  sleeperIdByTank01Id: Readonly<Record<string, string>>;
  playerListRows: number;
  malformedPlayerListRows: number;
  ambiguousPlayerListRows: number;
}>;

export class Tank01ProviderFailure extends Error {
  constructor(readonly reason: 'provider-error' | 'invalid-response') {
    super(reason);
    this.name = 'Tank01ProviderFailure';
  }
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function nullRecord<T>(): Record<string, T> {
  return Object.create(null) as Record<string, T>;
}

export function copyToNullRecord<T>(source: Readonly<Record<string, T>>): Record<string, T> {
  const copy = nullRecord<T>();
  for (const [key, value] of Object.entries(source)) copy[key] = value;
  return copy;
}

export function nonEmptyText(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}
