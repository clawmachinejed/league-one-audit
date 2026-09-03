import 'server-only';

import { ACTIVE_PROJECTION_SOURCE } from '../../projection-source-config';
import { getDatabase, withDatabaseAbortSignal } from '../../database';
import { createProjectionStore, getProjectionStore } from '../../projection-store';
import { getProjectionCadenceInput, getProjectionSyncInput, getRawLineupMatchups } from '../../sleeper';
import { observeProviderAdapter } from '../../provider-request-telemetry';
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

function projectionServices(shared: ReturnType<typeof createProductionSharedServices>) {
  const leagueSource = createSleeperLeagueSource(getProjectionSyncInput);
  const projectionFeed = productionProjectionFeed();
  const gameStateFeed = createTank01GameStateFeed({
    apiKey: process.env.TANK01_API_KEY ?? null,
    provider: gameStateProvider,
    fetch: globalThis.fetch,
    now: Date.now,
  });
  return {
    leagueSource: { getLeagueWeek: (...args: Parameters<typeof leagueSource.getLeagueWeek>) =>
      observeProviderAdapter(shared.logger, 'sleeper', 'league-week', () => leagueSource.getLeagueWeek(...args)) },
    projectionFeed: {
      getProjectionSlate: (...args: Parameters<typeof projectionFeed.getProjectionSlate>) =>
        observeProviderAdapter(shared.logger, 'tank01', 'projection-slate', () => projectionFeed.getProjectionSlate(...args),
          (result) => result.status === 'available' ? result.slate.quality === 'complete' ? 'available' : 'invalid'
            : result.reason === 'invalid-request' || result.reason === 'invalid-response' ? 'invalid' : 'unavailable'),
      assessProjectionSlate: projectionFeed.assessProjectionSlate,
    },
    gameStateFeed: { getGameStateSlate: (...args: Parameters<typeof gameStateFeed.getGameStateSlate>) =>
      observeProviderAdapter(shared.logger, 'tank01', 'game-states', () => gameStateFeed.getGameStateSlate(...args),
        (result) => result.status === 'available' ? 'available'
          : result.reason === 'invalid-request' || result.reason === 'invalid-response' ? 'invalid' : 'unavailable') },
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
  const calendar = createSleeperNflCalendar(getProjectionCadenceInput);
  const lineup = createSleeperLineupSource(getRawLineupMatchups, shared.clock.now);
  return {
    ...shared,
    ...projectionPersistence(getProjectionStore(), shared),
    ...projectionServices(shared),
    nflCalendar: { getCadenceState: (...args) => observeProviderAdapter(shared.logger, 'sleeper', 'league-calendar',
      () => calendar.getCadenceState(...args)) },
    lineupSource: { getLineup: (...args) => observeProviderAdapter(shared.logger, 'sleeper', 'lineup',
      () => lineup.getLineup(...args), (result) => result.status === 'complete' ? 'available' : result.status) },
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
    ...projectionServices(shared),
    futurePersistence: {
      scope: (signal) => projectionPersistence(
        createProjectionStore(withDatabaseAbortSignal(getDatabase(), signal)), shared,
      ),
    },
  };
}
