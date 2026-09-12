import 'server-only';

import { ACTIVE_PROJECTION_SOURCE } from '../../projection-source-config';
import { getProjectionStore } from '../../projection-store';
import {
  getFantasyPlayerCatalog,
  getOperatorProjectionSyncInput,
  getProjectionSyncInput,
} from '../../sleeper';
import { loadFantasyPlayerCatalog } from '../../sleeper-player-catalog';
import { createNeonProjectionRepository } from '../adapters/neon/repository';
import { createSleeperAllPlayerStatSource } from '../adapters/sleeper/all-player-stats';
import { translateSleeperLeagueWeek } from '../adapters/sleeper/league-source';
import { normalizeSleeperScoringProfile } from '../adapters/sleeper/scoring-profile';
import type { LeaguePeriod } from '../domain/contracts';
import {
  runAllPlayerIngestion,
  type AllPlayerIngestionDependencies,
  type AllPlayerIngestionMode,
  type AllPlayerIngestionResult,
} from './all-player-operation';
import { createProductionSharedServices, officialProvider } from './shared-services';

const projectionProvider = ACTIVE_PROJECTION_SOURCE.provider;

export const ALL_PLAYER_RECURRING_ENV = 'ALL_PLAYER_RECURRING_ENABLED';

export function createProductionAllPlayerDependencies(
  catalogMode: 'next-cached' | 'cache-neutral' = 'next-cached',
): AllPlayerIngestionDependencies {
  const shared = createProductionSharedServices('all-player-ingestion');
  const store = getProjectionStore();
  let neutralCatalog: ReturnType<typeof loadFantasyPlayerCatalog> | undefined;
  const loadCatalog = catalogMode === 'cache-neutral'
    ? () => {
        neutralCatalog ??= loadFantasyPlayerCatalog();
        return neutralCatalog;
      }
    : getFantasyPlayerCatalog;
  const loadProjectionInput = catalogMode === 'cache-neutral'
    ? (leagueId: string, period: LeaguePeriod) => (
        getOperatorProjectionSyncInput(leagueId, period, loadCatalog)
      )
    : getProjectionSyncInput;
  return {
    ...shared,
    store,
    projectionRepository: createNeonProjectionRepository(store, {
      officialProvider,
      projectionProvider,
      gameStateProvider: projectionProvider,
      normalizerVersion: ACTIVE_PROJECTION_SOURCE.normalizerVersion,
    }),
    loadLeagueWeek: async (configuration, period) => {
      const source = await loadProjectionInput(
        String(configuration.leagueRef.externalId),
        period,
      );
      return {
        state: await translateSleeperLeagueWeek(source, configuration, period),
        rawMatchups: source.rawMatchups,
        expectedRosterIds: source.matchupShape.rosterIds,
        starterSlots: source.matchupShape.starterSlots,
      };
    },
    loadCatalog,
    allPlayerSource: createSleeperAllPlayerStatSource({
      fetch: globalThis.fetch,
      now: shared.clock.now,
    }),
    normalizeScoringProfile: normalizeSleeperScoringProfile,
    officialProvider,
    projectionProvider,
    gameStateProvider: projectionProvider,
  };
}

export async function runProductionAllPlayerOperation(
  mode: Exclude<AllPlayerIngestionMode, 'recurring'>,
  period: LeaguePeriod,
): Promise<AllPlayerIngestionResult> {
  return runAllPlayerIngestion(createProductionAllPlayerDependencies('cache-neutral'), {
    mode,
    period,
    requireFinalCoverage: true,
  });
}

function sharedActivePeriod(
  authorities: Awaited<ReturnType<ReturnType<typeof getProjectionStore>['readLeagueLineupAuthorities']>>,
): LeaguePeriod | null {
  if (authorities.length !== 2 || authorities.some((row) => row.kind !== 'available')) return null;
  const available = authorities.filter((row) => row.kind === 'available');
  const first = available[0]?.authority;
  if (!first || first.leagueLifecycle !== 'active'
    || first.activeSeason === null || first.activeSeasonType !== 'reg'
    || first.activeWeek === null || first.activeSeason < 2026) return null;
  if (available.some((row) => row.authority.leagueLifecycle !== 'active'
    || row.authority.activeSeason !== first.activeSeason
    || row.authority.activeSeasonType !== first.activeSeasonType
    || row.authority.activeWeek !== first.activeWeek)) return null;
  return { season: first.activeSeason, seasonType: 'regular', week: first.activeWeek };
}

/** The existing live-projection cron calls this composition. The flag remains
 * off until a separately authorized activation; no additional cron exists. */
export async function runProductionAllPlayerRecurring(): Promise<AllPlayerIngestionResult> {
  if (process.env[ALL_PLAYER_RECURRING_ENV] !== 'true') {
    return { status: 'disabled', mode: 'recurring' };
  }
  const dependencies = createProductionAllPlayerDependencies();
  try {
    const keys = dependencies.leagueRegistry.listActiveLeagues().map((league) => league.key);
    const authorities = await getProjectionStore().readLeagueLineupAuthorities(keys);
    const period = sharedActivePeriod(authorities);
    if (!period) return { status: 'disabled', mode: 'recurring' };
    return runAllPlayerIngestion(dependencies, {
      mode: 'recurring',
      period,
      requireFinalCoverage: false,
    });
  } catch {
    dependencies.logger.write('warn', {
      stage: 'all-player-recurring-preflight', lane: 'all-player', outcome: 'failed',
      failureCode: 'all-player-preflight-unavailable',
    });
    return { status: 'disabled', mode: 'recurring' };
  }
}
