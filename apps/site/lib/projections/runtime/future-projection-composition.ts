import 'server-only';

import { ACTIVE_PROJECTION_SOURCE } from '../../projection-source-config';
import { getDatabase, withDatabaseAbortSignal } from '../../database';
import { createProjectionStore, getProjectionStore } from '../../projection-store';
import type { FutureProjectionWorkerDependencies } from '../worker/future-contracts';
import { createProductionSharedServices } from './shared-services';
import { createProjectionServices } from './projection-services';
import { createProjectionPersistence } from './projection-persistence';

/** Future work receives persisted authority, never a calendar-fetch capability. */
export function createProductionFutureProjectionDependencies(): FutureProjectionWorkerDependencies {
  const shared = createProductionSharedServices('future-projection-sync');
  return {
    ...shared,
    ...createProjectionPersistence(getProjectionStore(), shared),
    ...createProjectionServices(shared),
    projectionStorage: {
      source: ACTIVE_PROJECTION_SOURCE.provider,
      normalizerVersion: ACTIVE_PROJECTION_SOURCE.normalizerVersion,
    },
    futurePersistence: {
      scope: (signal) => createProjectionPersistence(
        createProjectionStore(withDatabaseAbortSignal(getDatabase(), signal)), shared,
      ),
    },
  };
}
