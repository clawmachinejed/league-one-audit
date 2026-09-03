import 'server-only';

import { randomUUID } from 'node:crypto';
import { LEAGUE_IDS } from './config';
import type { LeagueKey } from './leagues';
import { getProjectionStore } from './projection-store';
import { getProjectionCadenceInput, getProjectionSyncInput } from './sleeper';
import { getTank01WeeklyGameStates } from './tank01-game-state';
import { getTank01WeeklyProjections } from './tank01';
import type {
  LiveProjectionSyncResult,
  LiveProjectionWorkerDependencies,
} from './projections/worker/contracts';
import { runWithDependencies } from './projections/worker/orchestrator';

export { LIVE_PROJECTION_MODEL_VERSION } from './projections/worker/contracts';
export type {
  LiveProjectionSyncResult,
  LiveProjectionWorkerDependencies,
  ProjectionLeagueConfiguration,
} from './projections/worker/contracts';

function defaultDependencies(): LiveProjectionWorkerDependencies {
  return {
    store: getProjectionStore(),
    leagues: (Object.keys(LEAGUE_IDS) as LeagueKey[]).map((key) => ({
      key,
      sleeperLeagueId: LEAGUE_IDS[key],
    })),
    getProjectionCadenceInput,
    getProjectionSyncInput,
    getWeeklyProjections: getTank01WeeklyProjections,
    getWeeklyGameStates: getTank01WeeklyGameStates,
    now: () => new Date(),
    workerId: randomUUID,
  };
}

export function createLiveProjectionWorker(dependencies: LiveProjectionWorkerDependencies): Readonly<{
  run: (options?: Readonly<{ force?: boolean }>) => Promise<LiveProjectionSyncResult>;
}> {
  return { run: (options) => runWithDependencies(dependencies, options) };
}

export async function runLiveProjectionSync(
  options: Readonly<{ force?: boolean }> = {},
): Promise<LiveProjectionSyncResult> {
  return runWithDependencies(defaultDependencies(), options);
}
