import 'server-only';
import { createProductionFutureProjectionDependencies } from './projections/runtime/future-projection-composition';
import type { ForcedFuturePeriod, FutureProjectionSyncResult, FutureProjectionWorkerDependencies } from './projections/worker/future-contracts';
import { runFutureWithDependencies } from './projections/worker/future-orchestrator';

export type { FutureProjectionSyncResult, FutureProjectionWorkerDependencies } from './projections/worker/future-contracts';

export function createFutureProjectionWorker(dependencies: FutureProjectionWorkerDependencies): Readonly<{
  run: (forced?: ForcedFuturePeriod) => Promise<FutureProjectionSyncResult>;
}> {
  return { run: (forced) => runFutureWithDependencies(dependencies, forced) };
}

export async function runFutureProjectionSync(): Promise<FutureProjectionSyncResult> {
  return runFutureWithDependencies(createProductionFutureProjectionDependencies());
}
