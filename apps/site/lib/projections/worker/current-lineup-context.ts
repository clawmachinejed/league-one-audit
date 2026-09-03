import type { LeagueCadenceState } from '../domain/contracts';
import { LINEUP_AUTHORITY_MAX_AGE_MS } from '../domain/period-classification';
import { sameExternalReference } from '../shared/provider-identity';
import type { LiveProjectionWorkerDependencies } from './contracts';
import { synchronizeLineupWatches } from './lineup-watch-context';
import { mapWithConcurrency, safeProjectionLog } from './worker-operations';

/** Only the current lane fetches and writes operational league authority. */
export async function refreshCurrentLineupContext(dependencies: LiveProjectionWorkerDependencies, runId: string) {
  const configurations = dependencies.leagueRegistry.listActiveLeagues();
  const cadence = await mapWithConcurrency(configurations, 8, async (configuration): Promise<LeagueCadenceState | null> => {
    try {
      const value = await dependencies.nflCalendar.getCadenceState(configuration);
      if (value.configuration.key !== configuration.key
        || !sameExternalReference(value.configuration.leagueRef, configuration.leagueRef)
        || value.periodAuthority.configuration.key !== configuration.key
        || !sameExternalReference(value.periodAuthority.configuration.leagueRef, configuration.leagueRef)) {
        throw new Error('Operational authority identity mismatch.');
      }
      const stored = await dependencies.repository.upsertPeriodAuthority(value.periodAuthority, {
        shape: value.lineupShape, defaultPeriodCadence: value.defaultPeriodCadence,
      });
      if (stored.kind === 'conflict' || stored.kind === 'disabled') throw new Error('Operational authority rejected.');
      return value;
    } catch {
      safeProjectionLog(dependencies, 'warn', { stage: 'period-authority', outcome: 'failed', runId,
        leagueKey: configuration.key, failureCode: 'period-authority-unavailable' });
      return null;
    }
  });
  const results = await dependencies.periodAuthorityReader.readAuthorities(
    configurations.map((value) => value.key), dependencies.clock.now(), LINEUP_AUTHORITY_MAX_AGE_MS,
  );
  const context = await synchronizeLineupWatches(dependencies.lineupRepository, configurations, results, dependencies.clock.now());
  return { context, cadenceByKey: new Map(cadence.flatMap((value) => value ? [[value.configuration.key, value] as const] : [])) };
}
