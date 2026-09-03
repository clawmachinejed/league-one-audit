import 'server-only';

import { randomUUID } from 'node:crypto';
import { LEAGUE_IDS } from '../../config';
import { LEAGUE_SITES, type LeagueKey } from '../../leagues';
import { getProjectionStore } from '../../projection-store';
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
const projectionProvider = providerKey('tank01');
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
  const configurations = (Object.keys(LEAGUE_IDS) as LeagueKey[]).map((key) => ({
    key,
    displayName: LEAGUE_SITES[key].name,
    leagueRef: externalLeagueRef(officialProvider, LEAGUE_IDS[key]),
  }));

  return {
    repository: createNeonProjectionRepository(store, {
      officialProvider,
      projectionProvider,
      gameStateProvider,
    }),
    identityCrosswalk: createNeonIdentityCrosswalk(store),
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
    normalizeScoringProfile: normalizeSleeperScoringProfile,
    clock: { now: () => new Date(), monotonicNow: Date.now },
    idGenerator: { generate: randomUUID },
    logger: productionLogger(),
  };
}
