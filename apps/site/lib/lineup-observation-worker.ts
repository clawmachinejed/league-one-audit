import 'server-only';
import { loadAdministrationRegistry } from './league-administration/registry';

import { createProductionLineupObservationDependencies } from './projections/runtime/lineup-observation-composition';
import type { LineupObservationSyncResult } from './projections/worker/lineup-contracts';
import { runLineupObservation } from './projections/worker/lineup-orchestrator';

export type { LineupObservationSyncResult } from './projections/worker/lineup-contracts';

export async function runLineupObservationSync(): Promise<LineupObservationSyncResult> {
  return runLineupObservation(createProductionLineupObservationDependencies(await loadAdministrationRegistry()));
}
