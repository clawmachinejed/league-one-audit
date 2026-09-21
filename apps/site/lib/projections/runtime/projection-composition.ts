import 'server-only';

import { getProjectionStore } from '../../projection-store';
import { getProjectionCadenceInput, getRawLineupMatchups } from '../../sleeper';
import { recordCapturedAdministration } from '../../league-administration/runtime';
import { observeProviderAdapter } from '../../provider-request-telemetry';
import { createSleeperLineupSource } from '../adapters/sleeper/lineup-source';
import { createSleeperNflCalendar } from '../adapters/sleeper/nfl-calendar';
import type { LiveProjectionWorkerDependencies } from '../worker/contracts';
import { createProductionSharedServices } from './shared-services';
import { createProjectionServices } from './projection-services';
import { createProjectionPersistence } from './projection-persistence';
import type { LeagueRegistryPort } from '../ports/league-registry';
import type { LiveDefenseStatSourcePort } from '../ports/live-defense-stat-source';

/** Current work alone receives the calendar source and owns authority refreshes. */
export function createProductionProjectionDependencies(
  registry?: LeagueRegistryPort,
  liveDefenseStatSource?: LiveDefenseStatSourcePort,
): LiveProjectionWorkerDependencies {
  const shared = createProductionSharedServices('live-projection-sync', registry);
  // This composition is created once per invocation. Both leagues must evaluate
  // the rollover at the same instant even when their source loads straddle noon.
  const evaluatedAt = shared.clock.now().toISOString();
  const calendar = createSleeperNflCalendar(async (leagueId) => {
    const source = await getProjectionCadenceInput(leagueId, evaluatedAt);
    if (source.administrationObservations?.length) {
      const configuration = shared.leagueRegistry.listActiveLeagues()
        .find((league) => String(league.leagueRef.externalId) === leagueId);
      if (!configuration) throw new Error('Administration collection has no enrolled league.');
      // Capture valid administration independently of optional full projection work.
      // Durable heads use their own monotonic/CAS protection before the projection lease.
      const captured = await recordCapturedAdministration({ leagueKey: configuration.key,
        provider: 'sleeper', externalLeagueId: leagueId, season: Number(source.season) },
      source.administrationObservations, { now: shared.clock.now });
      if (captured.status === 'unavailable') throw new Error('League administration observation was not accepted.');
    }
    return source;
  });
  const lineup = createSleeperLineupSource(getRawLineupMatchups, shared.clock.now);
  return {
    ...shared,
    ...createProjectionPersistence(getProjectionStore(), shared),
    ...createProjectionServices(shared),
    ...(liveDefenseStatSource ? { liveDefenseStatSource } : {}),
    nflCalendar: { getCadenceState: (...args) => observeProviderAdapter(shared.logger, 'sleeper', 'league-calendar',
      () => calendar.getCadenceState(...args)) },
    lineupSource: { getLineup: (...args) => observeProviderAdapter(shared.logger, 'sleeper', 'lineup',
      () => lineup.getLineup(...args), (result) => result.status === 'complete' ? 'available' : result.status) },
  };
}
