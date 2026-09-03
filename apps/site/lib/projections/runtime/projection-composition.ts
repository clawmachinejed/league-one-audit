import 'server-only';

import { ACTIVE_PROJECTION_SOURCE } from '../../projection-source-config';
import { getDatabase, withDatabaseAbortSignal } from '../../database';
import { createProjectionStore, getProjectionStore } from '../../projection-store';
import { getProjectionCadenceInput, getProjectionSyncInput, getRawLineupMatchups } from '../../sleeper';
import { createNeonIdentityCrosswalk } from '../adapters/neon/identity-crosswalk';
import { createNeonProjectionRepository } from '../adapters/neon/repository';
import { createNeonLineupRepository } from '../adapters/neon/lineup-repository';
import { createNeonPeriodAuthorityReader } from '../adapters/neon/period-authority-reader';
import { createSleeperLeagueSource } from '../adapters/sleeper/league-source';
import { createSleeperLineupSource } from '../adapters/sleeper/lineup-source';
import { createSleeperNflCalendar } from '../adapters/sleeper/nfl-calendar';
import { normalizeSleeperScoringProfile } from '../adapters/sleeper/scoring-profile';
import { createTank01GameStateFeed } from '../adapters/tank01/game-state-feed';
import { createCachedTank01ProjectionFeed } from '../adapters/tank01/projection-feed';
import type { ProjectionFeedPort } from '../ports/projection-feed';
import type { LiveProjectionWorkerDependencies } from '../worker/contracts';
import type { FuturePersistence, FutureProjectionWorkerDependencies } from '../worker/future-contracts';
import { createProductionSharedServices, officialProvider } from './shared-services';

const projectionProvider = ACTIVE_PROJECTION_SOURCE.provider;
const gameStateProvider = projectionProvider;
let cachedProjectionFeed: ProjectionFeedPort | null = null;

function productionProjectionFeed(): ProjectionFeedPort {
  cachedProjectionFeed ??= createCachedTank01ProjectionFeed({
    apiKey: () => process.env.TANK01_API_KEY ?? null,
    provider: projectionProvider,
    officialProvider,
    fetch: globalThis.fetch,
    now: Date.now,
  });
  return cachedProjectionFeed;
}

function projectionPersistence(
  store: ReturnType<typeof getProjectionStore>,
  shared: ReturnType<typeof createProductionSharedServices>,
): FuturePersistence {
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

function projectionServices() {
  return {
    leagueSource: createSleeperLeagueSource(getProjectionSyncInput),
    projectionFeed: productionProjectionFeed(),
    gameStateFeed: createTank01GameStateFeed({
      apiKey: process.env.TANK01_API_KEY ?? null,
      provider: gameStateProvider,
      fetch: globalThis.fetch,
      now: Date.now,
    }),
    projectionStorage: {
      source: projectionProvider,
      normalizerVersion: ACTIVE_PROJECTION_SOURCE.normalizerVersion,
    },
    normalizeScoringProfile: normalizeSleeperScoringProfile,
  };
}

/** Current work alone receives the calendar source and owns authority refreshes. */
export function createProductionProjectionDependencies(): LiveProjectionWorkerDependencies {
  const shared = createProductionSharedServices('live-projection-sync');
  return {
    ...shared,
    ...projectionPersistence(getProjectionStore(), shared),
    ...projectionServices(),
    nflCalendar: createSleeperNflCalendar(getProjectionCadenceInput),
    lineupSource: createSleeperLineupSource(getRawLineupMatchups, shared.clock.now),
    persistence: {
      scope(signal) {
        const scoped = projectionPersistence(
          createProjectionStore(withDatabaseAbortSignal(getDatabase(), signal)), shared,
        );
        return {
          repository: scoped.repository,
          lineupRepository: scoped.lineupRepository,
          periodAuthorityReader: scoped.periodAuthorityReader,
        };
      },
    },
  };
}

/** Future work receives persisted authority, never a calendar-fetch capability. */
export function createProductionFutureProjectionDependencies(): FutureProjectionWorkerDependencies {
  const shared = createProductionSharedServices('future-projection-sync');
  return {
    ...shared,
    ...projectionPersistence(getProjectionStore(), shared),
    ...projectionServices(),
    futurePersistence: {
      scope: (signal) => projectionPersistence(
        createProjectionStore(withDatabaseAbortSignal(getDatabase(), signal)), shared,
      ),
    },
  };
}
