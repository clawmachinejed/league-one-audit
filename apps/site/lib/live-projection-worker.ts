import 'server-only';

import { runProductionProjectionSync } from './projections/runtime/projection-dispatch';
import { runProductionAllPlayerRecurring } from './projections/runtime/all-player-composition';
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

export function createLiveProjectionWorker(dependencies: LiveProjectionWorkerDependencies): Readonly<{
  run: (options?: Readonly<{ force?: boolean }>) => Promise<LiveProjectionSyncResult>;
}> {
  return { run: (options) => runWithDependencies(dependencies, options) };
}

export async function runLiveProjectionSync(
  options: Readonly<{ force?: boolean }> = {},
): Promise<LiveProjectionSyncResult> {
  if (options.force) return runProductionProjectionSync(options);
  const [projection] = await Promise.all([
    runProductionProjectionSync(options),
    runProductionAllPlayerRecurring().catch(() => ({ status: 'disabled' as const, mode: 'recurring' as const })),
  ]);
  return projection;
}
