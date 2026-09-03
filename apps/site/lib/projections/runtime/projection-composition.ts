import 'server-only';

import { getProjectionStore } from '../../projection-store';
import { getProjectionCadenceInput, getRawLineupMatchups } from '../../sleeper';
import { observeProviderAdapter } from '../../provider-request-telemetry';
import { createSleeperLineupSource } from '../adapters/sleeper/lineup-source';
import { createSleeperNflCalendar } from '../adapters/sleeper/nfl-calendar';
import type { LiveProjectionWorkerDependencies } from '../worker/contracts';
import { createProductionSharedServices } from './shared-services';
import { createProjectionServices } from './projection-services';
import { createProjectionPersistence } from './projection-persistence';

/** Current work alone receives the calendar source and owns authority refreshes. */
export function createProductionProjectionDependencies(): LiveProjectionWorkerDependencies {
  const shared = createProductionSharedServices('live-projection-sync');
  const calendar = createSleeperNflCalendar(getProjectionCadenceInput);
  const lineup = createSleeperLineupSource(getRawLineupMatchups, shared.clock.now);
  return {
    ...shared,
    ...createProjectionPersistence(getProjectionStore(), shared),
    ...createProjectionServices(shared),
    nflCalendar: { getCadenceState: (...args) => observeProviderAdapter(shared.logger, 'sleeper', 'league-calendar',
      () => calendar.getCadenceState(...args)) },
    lineupSource: { getLineup: (...args) => observeProviderAdapter(shared.logger, 'sleeper', 'lineup',
      () => lineup.getLineup(...args), (result) => result.status === 'complete' ? 'available' : result.status) },
  };
}
