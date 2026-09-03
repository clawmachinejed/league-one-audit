import 'server-only';

import type { LeagueKey } from '../../leagues';
import type { ProjectionSyncCadence } from '../../projection-window';
import type { ProjectionStore } from '../../projection-store';
import type { ProjectionCadenceInput, ProjectionSyncInput } from '../../sleeper';
import type { Tank01GameStatesAvailable, Tank01GameStatesResult } from '../../tank01-game-state';
import type { Tank01AvailableResult, Tank01ProjectionResult } from '../../tank01';
import type { Player } from '../../types';

export const LIVE_PROJECTION_MODEL_VERSION = 'clock-v1';

export type ProjectionLeagueConfiguration = Readonly<{
  key: LeagueKey;
  sleeperLeagueId: string;
}>;

export type LiveProjectionWorkerDependencies = Readonly<{
  store: ProjectionStore;
  leagues: readonly ProjectionLeagueConfiguration[];
  getProjectionCadenceInput: (leagueId: string) => Promise<ProjectionCadenceInput>;
  getProjectionSyncInput: (leagueId: string) => Promise<ProjectionSyncInput>;
  getWeeklyProjections: (season: string, week: number) => Promise<Tank01ProjectionResult>;
  getWeeklyGameStates: (season: string, week: number) => Promise<Tank01GameStatesResult>;
  now: () => Date;
  workerId: () => string;
}>;

export type LiveProjectionSyncResult =
  | Readonly<{ status: 'disabled' }>
  | Readonly<{ status: 'skipped'; reason: 'busy' | 'completed' | 'idle'; cadence: ProjectionSyncCadence | null }>
  | Readonly<{
      status: 'completed';
      cadence: ProjectionSyncCadence;
      publishedLeagues: number;
      failedLeagues: number;
      providerGroups: number;
    }>
  | Readonly<{ status: 'failed' }>;

export type LoadedLeague = Readonly<{
  configuration: ProjectionLeagueConfiguration;
  source: ProjectionSyncInput;
  cadence: ProjectionSyncCadence;
}>;

export type ProviderGroup = Readonly<{
  season: string;
  week: number;
  leagues: readonly LoadedLeague[];
}>;

export type ActiveStarter = Readonly<{
  rosterId: string;
  player: Player;
}>;

export type PersistedGroup = Readonly<{
  games: Tank01GameStatesAvailable;
  projections: Tank01AvailableResult;
  gameIdsByExternalId: ReadonlyMap<string, string>;
  gameObservationIdsByExternalId: ReadonlyMap<string, string>;
  entityIdsByKey: ReadonlyMap<string, string>;
  projectionSourceRevision: string;
}>;

export type ProjectionLogContext = Readonly<{
  stage: string;
  outcome: 'started' | 'completed' | 'skipped' | 'failed';
  leagueKey?: LeagueKey;
  season?: string;
  week?: number;
  publishedLeagues?: number;
  failedLeagues?: number;
}>;
