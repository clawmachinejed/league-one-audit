import 'server-only';

import { ACTIVE_PROJECTION_SOURCE } from '../../projection-source-config';
import type { ProjectionStore } from '../../projection-store';
import { createNeonIdentityCrosswalk } from '../adapters/neon/identity-crosswalk';
import { createNeonProjectionRepository } from '../adapters/neon/repository';
import { createNeonLineupRepository } from '../adapters/neon/lineup-repository';
import { createNeonPeriodAuthorityReader } from '../adapters/neon/period-authority-reader';
import { type createProductionSharedServices, officialProvider } from './shared-services';

const projectionProvider = ACTIVE_PROJECTION_SOURCE.provider;
const gameStateProvider = projectionProvider;

export function createProjectionPersistence(
  store: ProjectionStore,
  shared: ReturnType<typeof createProductionSharedServices>,
) {
  return {
    repository: createNeonProjectionRepository(store, {
      officialProvider,
      projectionProvider,
      gameStateProvider,
      normalizerVersion: ACTIVE_PROJECTION_SOURCE.normalizerVersion,
    }),
    identityCrosswalk: createNeonIdentityCrosswalk(store),
    lineupRepository: createNeonLineupRepository(store, shared.leagueRegistry, {
      projectionSource: projectionProvider,
      normalizerVersion: ACTIVE_PROJECTION_SOURCE.normalizerVersion,
      modelVersion: ACTIVE_PROJECTION_SOURCE.modelVersion,
    }),
    periodAuthorityReader: createNeonPeriodAuthorityReader(store, shared.leagueRegistry, shared.clock),
  };
}

