import type { LeagueCadenceState, LeaguePeriod, LeaguePeriodAuthority } from '../domain/contracts';
import { LINEUP_AUTHORITY_MAX_AGE_MS } from '../domain/period-classification';
import { sameExternalReference } from '../shared/provider-identity';
import type { LiveProjectionWorkerDependencies } from './contracts';
import { synchronizeLineupWatches } from './lineup-watch-context';
import { mapWithConcurrency, safeProjectionLog } from './worker-operations';

function samePeriod(left: LeaguePeriod | null, right: LeaguePeriod | null): boolean {
  return left === null || right === null ? left === right : left.season === right.season
    && left.seasonType === right.seasonType && left.week === right.week;
}

function regresses(left: LeaguePeriod, right: LeaguePeriod): boolean {
  return left.season < right.season || left.season === right.season
    && left.seasonType === right.seasonType && left.week < right.week;
}

function authorityDisagreement(value: LeagueCadenceState, stored: LeaguePeriodAuthority) {
  const proposed = value.periodAuthority;
  if (proposed.source === stored.source
    && sameExternalReference(proposed.configuration.leagueRef, stored.configuration.leagueRef)
    && proposed.lifecycle === stored.lifecycle
    && samePeriod(proposed.defaultDisplayPeriod, stored.defaultDisplayPeriod)
    && samePeriod(proposed.activeScoringPeriod, stored.activeScoringPeriod)
    && samePeriod(value.period, stored.activeScoringPeriod ?? stored.defaultDisplayPeriod)) return null;
  const lifecycleOrder = { preseason: 0, active: 1, complete: 2 };
  return regresses(proposed.defaultDisplayPeriod, stored.defaultDisplayPeriod)
    || proposed.activeScoringPeriod !== null && stored.activeScoringPeriod !== null
      && regresses(proposed.activeScoringPeriod, stored.activeScoringPeriod)
    || lifecycleOrder[proposed.lifecycle] < lifecycleOrder[stored.lifecycle]
    ? 'period-authority-regression' as const : 'period-authority-conflict' as const;
}

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
      if (stored.kind === 'conflict') {
        safeProjectionLog(dependencies, 'warn', { stage: 'period-authority', outcome: 'failed', runId,
          leagueKey: configuration.key, period: value.period, failureCode: 'period-authority-conflict' });
        return null;
      }
      if (stored.kind === 'disabled') throw new Error('Operational authority rejected.');
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
  const byKey = new Map(results.map((result) => [result.leagueKey, result]));
  // An ignored write or a concurrent advance can leave a newer durable period.
  // Its watch ownership remains authoritative; older local cadence cannot be
  // reported as a healthy idle run or used to calculate that different period.
  const acceptedCadence = cadence.map((value) => {
    if (!value) return null;
    const stored = byKey.get(value.configuration.key);
    const failureCode = stored?.kind === 'present'
      ? authorityDisagreement(value, stored.value.authority) : 'period-authority-unavailable';
    if (!failureCode) return value;
    safeProjectionLog(dependencies, 'warn', { stage: 'period-authority', outcome: 'failed', runId,
      leagueKey: value.configuration.key, period: value.period, failureCode,
      ...(stored?.kind === 'present' ? { storedAuthorityPeriod:
        stored.value.authority.activeScoringPeriod ?? stored.value.authority.defaultDisplayPeriod } : {}) });
    return null;
  });
  const context = await synchronizeLineupWatches(dependencies.lineupRepository, configurations, results, dependencies.clock.now());
  return { context,
    failedCadenceLeagueKeys: configurations.filter((_configuration, index) => acceptedCadence[index] === null).map((configuration) => configuration.key),
    cadenceByKey: new Map(acceptedCadence.flatMap((value) => value ? [[value.configuration.key, value] as const] : [])) };
}
