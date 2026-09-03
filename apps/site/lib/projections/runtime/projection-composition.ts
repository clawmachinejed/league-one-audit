import 'server-only';

import { randomUUID } from 'node:crypto';
import { LEAGUE_IDS } from '../../config';
import { LEAGUE_SITES, type LeagueKey } from '../../leagues';
import { ACTIVE_PROJECTION_SOURCE } from '../../projection-source-config';
import { getDatabase, withDatabaseAbortSignal } from '../../database';
import { createProjectionStore, getProjectionStore } from '../../projection-store';
import { getProjectionCadenceInput, getProjectionSyncInput } from '../../sleeper';
import { createLeagueRegistry } from '../adapters/configuration/league-registry';
import { createNeonIdentityCrosswalk } from '../adapters/neon/identity-crosswalk';
import { createNeonProjectionRepository } from '../adapters/neon/repository';
import { createSleeperLeagueSource } from '../adapters/sleeper/league-source';
import { createSleeperNflCalendar } from '../adapters/sleeper/nfl-calendar';
import { normalizeSleeperScoringProfile } from '../adapters/sleeper/scoring-profile';
import { createTank01GameStateFeed } from '../adapters/tank01/game-state-feed';
import { createCachedTank01ProjectionFeed } from '../adapters/tank01/projection-feed';
import type { ProjectionLoggerPort } from '../ports/logger';
import type { ProjectionFeedPort } from '../ports/projection-feed';
import { externalLeagueRef, providerKey } from '../shared/provider-identity';
import type { LiveProjectionWorkerDependencies } from '../worker/contracts';

const officialProvider = providerKey('sleeper');
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

function productionLogger(): ProjectionLoggerPort {
  return {
    write(level, context) {
      const entry = JSON.stringify({ service: 'live-projection-sync', ...context });
      if (level === 'error') console.error(entry);
      else if (level === 'warn') console.warn(entry);
      else console.info(entry);
    },
  };
}

/** The sole production composition root for the projection worker. */
export function createProductionProjectionDependencies(): LiveProjectionWorkerDependencies {
  const store = getProjectionStore();
  const repositoryOptions = {
    officialProvider,
    projectionProvider,
    gameStateProvider,
    normalizerVersion: ACTIVE_PROJECTION_SOURCE.normalizerVersion,
  };
  const configurations = (Object.keys(LEAGUE_IDS) as LeagueKey[]).map((key) => ({
    key,
    displayName: LEAGUE_SITES[key].name,
    leagueRef: externalLeagueRef(officialProvider, LEAGUE_IDS[key]),
  }));

  return {
    repository: createNeonProjectionRepository(store, repositoryOptions),
    identityCrosswalk: createNeonIdentityCrosswalk(store),
    futurePersistence: {
      scope(signal) {
        const scopedStore = createProjectionStore(withDatabaseAbortSignal(getDatabase(), signal));
        return {
          repository: createNeonProjectionRepository(scopedStore, repositoryOptions),
          identityCrosswalk: createNeonIdentityCrosswalk(scopedStore),
        };
      },
    },
    leagueRegistry: createLeagueRegistry(configurations),
    nflCalendar: createSleeperNflCalendar(getProjectionCadenceInput),
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
    clock: { now: () => new Date(), monotonicNow: () => performance.now() },
    idGenerator: { generate: randomUUID },
    logger: productionLogger(),
  };
}
