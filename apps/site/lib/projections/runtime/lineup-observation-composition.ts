import 'server-only';

import { getDatabase, withDatabaseAbortSignal } from '../../database';
import { ACTIVE_PROJECTION_SOURCE } from '../../projection-source-config';
import { createProjectionStore, getProjectionStore } from '../../projection-store';
import { getRawLineupMatchups } from '../../sleeper';
import { observeProviderAdapter } from '../../provider-request-telemetry';
import { createNeonJobRepository } from '../adapters/neon/job-repository';
import { createNeonLineupRepository } from '../adapters/neon/lineup-repository';
import { createNeonPeriodAuthorityReader } from '../adapters/neon/period-authority-reader';
import { createSleeperLineupSource } from '../adapters/sleeper/lineup-source';
import type { LineupObservationWorkerDependencies } from '../worker/lineup-contracts';
import { createProductionSharedServices } from './shared-services';

/** The observation cron has no path to projection providers, scoring, or snapshot publication. */
export function createProductionLineupObservationDependencies(): LineupObservationWorkerDependencies {
  const shared = createProductionSharedServices('lineup-observation-sync');
  const source = createSleeperLineupSource(getRawLineupMatchups, shared.clock.now);
  const options = {
    projectionSource: ACTIVE_PROJECTION_SOURCE.provider,
    normalizerVersion: ACTIVE_PROJECTION_SOURCE.normalizerVersion,
    modelVersion: ACTIVE_PROJECTION_SOURCE.modelVersion,
  };
  function persistence(store: ReturnType<typeof getProjectionStore>) {
    return {
      repository: createNeonJobRepository(store),
      lineupRepository: createNeonLineupRepository(store, shared.leagueRegistry, options),
      periodAuthorityReader: createNeonPeriodAuthorityReader(store, shared.leagueRegistry, shared.clock),
    };
  }
  return {
    ...shared,
    ...persistence(getProjectionStore()),
    lineupSource: { getLineup: (...args) => observeProviderAdapter(shared.logger, 'sleeper', 'lineup',
      () => source.getLineup(...args), (result) => result.status === 'complete' ? 'available' : result.status) },
    persistence: {
      scope: (signal) => persistence(createProjectionStore(withDatabaseAbortSignal(getDatabase(), signal))),
    },
  };
}
