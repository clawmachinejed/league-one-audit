import 'server-only';

import { ACTIVE_PROJECTION_SOURCE } from '../../projection-source-config';
import { getProjectionSyncInput } from '../../sleeper';
import { observeProviderAdapter } from '../../provider-request-telemetry';
import { createSleeperLeagueSource } from '../adapters/sleeper/league-source';
import { normalizeSleeperScoringProfile } from '../adapters/sleeper/scoring-profile';
import { createTank01GameStateFeed } from '../adapters/tank01/game-state-feed';
import { createCachedTank01ProjectionFeed } from '../adapters/tank01/projection-feed';
import type { ProjectionFeedPort } from '../ports/projection-feed';
import { type createProductionSharedServices, officialProvider } from './shared-services';

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

export function createProjectionServices(shared: ReturnType<typeof createProductionSharedServices>) {
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
    normalizeScoringProfile: normalizeSleeperScoringProfile,
  };
}

