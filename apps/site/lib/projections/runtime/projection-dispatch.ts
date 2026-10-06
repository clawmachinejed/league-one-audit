import 'server-only';
import { loadIsolatedAdministrationRegistry as loadAdministrationRegistry } from '../../league-administration/registry';
import type { PublicDataRefreshSelection } from '../../league-administration/public-intake-runtime';
import { runAdministrationMaintenance } from '../../league-administration/maintenance';

import type { LiveProjectionSyncResult } from '../worker/contracts';
import { refreshCurrentLineupContext } from '../worker/current-lineup-context';
import { runFutureWithDependencies } from '../worker/future-orchestrator';
import { runWithDependencies, type PreparedCurrentPreflight } from '../worker/orchestrator';
import { safeProjectionLog } from '../worker/worker-operations';
import {
  createProductionProjectionDependencies,
} from './projection-composition';
import { createProductionFutureProjectionDependencies } from './future-projection-composition';
import { createLiveDefenseStatCoordinator } from './live-defense-stats';

/** Only the established authenticated force operation may hand a preseason default to its future owner. */
export async function runProductionProjectionSync(
  options: Readonly<{ force?: boolean; invocationStartedAt?: number; publicDataRefresh?: PublicDataRefreshSelection;
    defenseStats?: ReturnType<typeof createLiveDefenseStatCoordinator> }> = {},
): Promise<LiveProjectionSyncResult> {
  const invocationStartedAt = options.invocationStartedAt ?? Date.now();
  const { publicDataRefresh, ...projectionOptions } = options;
  let dataLogger: Parameters<typeof safeProjectionLog>[0] | undefined;
  const warnDataFailure = () => {
    const entry = { stage: 'public-data-refresh', outcome: 'failed' } as const;
    if (dataLogger) safeProjectionLog(dataLogger, 'warn', entry);
    else {
      // Registry/setup failure may precede the production logger. Never include
      // request data, provider payloads, exception messages or credentials.
      try { console.warn(JSON.stringify({ service: 'league-administration', ...entry })); } catch { /* Logging cannot replace projection results. */ }
    }
  };
  // Attach a nonthrowing handler immediately: DATA runs even if registry or
  // projection setup rejects, without becoming an unhandled background promise.
  const data = !options.force && publicDataRefresh?.enabled === true
    ? import('../../league-administration/public-intake-runtime')
      .then(runtime => runtime.runSelectedPublicDataRefresh(publicDataRefresh, invocationStartedAt))
      .then(outcome => { if (outcome.status === 'unavailable') warnDataFailure(); return outcome; })
      .catch(() => { warnDataFailure(); })
    : Promise.resolve(undefined);
  try {
    const registry = await loadAdministrationRegistry();
    const defenseStats = options.defenseStats ?? createLiveDefenseStatCoordinator(invocationStartedAt);
    const current = createProductionProjectionDependencies(registry, defenseStats.source);
    dataLogger = current;
    if (!options.force) {
      const result = await runWithDependencies(current, projectionOptions);
      await data;
      // Administration outcomes are durable and separately visible; existing scoring remains isolated.
      await runAdministrationMaintenance(registry, invocationStartedAt).catch(() => {
        current.logger.write('warn', { stage: 'administration-maintenance', outcome: 'failed' });
      });
      return result;
    }
    if (!current.repository.enabled || !current.lineupRepository.enabled) return { status: 'disabled' };
    const now = current.clock.now();
    if (!Number.isFinite(now.getTime())) return { status: 'failed' };
    const runId = current.idGenerator.generate();
    const runStartedAt = current.clock.monotonicNow();
    try {
      const value = await refreshCurrentLineupContext(current, runId);
      if (value.context.kind === 'disabled') return { status: 'disabled' };
      if (value.context.kind !== 'stored' || !value.context.authorities.length) return { status: 'failed' };
      const prepared: PreparedCurrentPreflight = { runId, now, runStartedAt, value };
      const failedPreflightKeys = new Set([...value.failedCadenceLeagueKeys, ...value.context.skippedLeagueKeys]);
      const defaults = value.context.states.filter((state) => state.watchClass === 'current' && state.retiredAt === null
        && !failedPreflightKeys.has(state.configuration.key));
      if (!defaults.length && failedPreflightKeys.size > 0) return { status: 'failed' };
      const currentDefaults = defaults.filter((state) => state.materializationLane === 'current');
      const futureDefaults = defaults.filter((state) => state.materializationLane === 'future');
      if (!futureDefaults.length) return runWithDependencies(current, projectionOptions, prepared);
      // One force request remains one bounded default period, never a future-horizon sweep.
      const period = futureDefaults[0].period;
      if (currentDefaults.length || futureDefaults.some((state) => state.period.season !== period.season
        || state.period.seasonType !== period.seasonType || state.period.week !== period.week)) {
        return { status: 'failed' };
      }
      const result = await runFutureWithDependencies(createProductionFutureProjectionDependencies(registry), {
        period, leagueKeys: futureDefaults.map((state) => state.configuration.key),
        execution: { now, runId, timing: { wallStartedAtMs: now.getTime(), monotonicStartedAt: runStartedAt } },
      });
      if (result.status === 'disabled' || result.status === 'failed') return result;
      if (result.status === 'skipped') return result.reason === 'deadline'
        ? { status: 'failed' }
        : { status: 'skipped', reason: result.reason, cadence: 'forced' };
      const successful = result.publishedLeagues + result.unchangedLeagues;
      if (result.action !== 'materialize' || successful === 0) return { status: 'failed' };
      return { status: 'completed', cadence: 'forced', publishedLeagues: successful,
        failedLeagues: result.failedLeagues + failedPreflightKeys.size, providerGroups: 1 };
    } catch {
      safeProjectionLog(current, 'error', { stage: 'forced-dispatch', outcome: 'failed', runId,
        cadence: 'forced', failureCode: 'current-projection-failed' });
      return { status: 'failed' };
    }
  } finally {
    await data;
  }
}
