import 'server-only';

import type { LiveProjectionSyncResult } from '../worker/contracts';
import { refreshCurrentLineupContext } from '../worker/current-lineup-context';
import { runFutureWithDependencies } from '../worker/future-orchestrator';
import { runWithDependencies, type PreparedCurrentPreflight } from '../worker/orchestrator';
import { safeProjectionLog } from '../worker/worker-operations';
import {
  createProductionFutureProjectionDependencies,
  createProductionProjectionDependencies,
} from './projection-composition';

/** Only the established authenticated force operation may hand a preseason default to its future owner. */
export async function runProductionProjectionSync(
  options: Readonly<{ force?: boolean }> = {},
): Promise<LiveProjectionSyncResult> {
  const current = createProductionProjectionDependencies();
  if (!options.force) return runWithDependencies(current, options);
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
    if (!futureDefaults.length) return runWithDependencies(current, options, prepared);
    // One force request remains one bounded default period, never a future-horizon sweep.
    const period = futureDefaults[0].period;
    if (currentDefaults.length || futureDefaults.some((state) => state.period.season !== period.season
      || state.period.seasonType !== period.seasonType || state.period.week !== period.week)) {
      return { status: 'failed' };
    }
    const result = await runFutureWithDependencies(createProductionFutureProjectionDependencies(), {
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
}
