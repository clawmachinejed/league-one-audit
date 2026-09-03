import { LIVE_PROJECTION_MODEL_VERSION, type LiveProjectionSyncResult, type LiveProjectionWorkerDependencies } from './contracts';
import { highestCadence, minuteBoundary } from './cadence';
import { refreshCurrentLineupContext } from './current-lineup-context';
import { planCurrentWork, settleCurrentHourlyMarkers, type CurrentWorkTarget } from './current-work-plan';
import { loadCurrentLeagues } from './current-league-load';
import { runCurrentProjectionStages } from './current-projection-stages';
import { observeCurrentLineups } from './current-lineup-observation';
import { elapsed, safeProjectionLog as log } from './worker-operations';

export type PreparedCurrentPreflight = Readonly<{
  runId: string; now: Date; runStartedAt: number;
  value: Awaited<ReturnType<typeof refreshCurrentLineupContext>>;
}>;

/** Current scoring and current thin observations share one execution lease. */
export async function runWithDependencies(
  dependencies: LiveProjectionWorkerDependencies,
  options: Readonly<{ force?: boolean }> = {},
  prepared?: PreparedCurrentPreflight,
): Promise<LiveProjectionSyncResult> {
  if (!dependencies.repository.enabled) return { status: 'disabled' };
  const now = prepared?.now ?? dependencies.clock.now();
  if (!Number.isFinite(now.getTime())) return { status: 'failed' };
  const runId = prepared?.runId ?? dependencies.idGenerator.generate();
  const runStartedAt = prepared?.runStartedAt ?? dependencies.clock.monotonicNow();
  const calculatedAt = now.toISOString();
  const jobKey = 'live-projection-sync';
  let acquired = false;
  let markers: readonly CurrentWorkTarget[] = [];
  let markersSettled = false;
  let failedPreflightLeagues = 0;
  let stage = 'preflight';
  try {
    const preflight = prepared?.value ?? await refreshCurrentLineupContext(dependencies, runId);
    if (preflight.context.kind === 'disabled') return { status: 'disabled' };
    if (preflight.context.kind === 'capacity-exceeded') {
      log(dependencies, 'warn', { stage: 'lineup-watch-capacity', outcome: 'failed', runId,
        capacityStatus: 'capacity-exceeded' });
      throw new Error('Lineup capacity exceeded.');
    }
    const context = preflight.context;
    const failedPreflightKeys = new Set([...preflight.failedCadenceLeagueKeys, ...context.skippedLeagueKeys]);
    failedPreflightLeagues = failedPreflightKeys.size;
    if (!context.authorities.length && context.skippedLeagueKeys.length) throw new Error('No usable league authority.');
    if (!preflight.cadenceByKey.size && failedPreflightLeagues > 0) throw new Error('No operational cadence could be refreshed.');
    const current = context.states.filter((state) => state.materializationLane === 'current'
      && state.watchClass === 'current' && state.retiredAt === null);
    if (!current.length) {
      if (failedPreflightLeagues > 0) throw new Error('Operational cadence refresh was incomplete.');
      if (options.force) throw new Error('No owned current period is eligible.');
      log(dependencies, 'info', { stage, outcome: 'skipped', runId, cadence: 'idle', totalDurationMs: elapsed(dependencies, runStartedAt) });
      return { status: 'skipped', reason: 'idle', cadence: 'idle' };
    }
    stage = 'lease';
    const lease = await dependencies.repository.acquireJob({ jobKey, jobType: jobKey,
      scheduledFor: options.force ? calculatedAt : minuteBoundary(now),
      payload: { modelVersion: LIVE_PROJECTION_MODEL_VERSION, forced: options.force === true },
      workerId: runId, leaseSeconds: 120 });
    if (lease.kind === 'disabled') return { status: 'disabled' };
    if (lease.kind !== 'acquired') {
      log(dependencies, 'info', { stage, outcome: 'skipped', runId, leaseOutcome: lease.kind });
      return { status: 'skipped', reason: lease.kind, cadence: null };
    }
    acquired = true;
    log(dependencies, 'info', { stage, outcome: 'started', runId, leaseOutcome: 'acquired' });
    const plan = await planCurrentWork(dependencies, current, preflight.cadenceByKey, dependencies.clock.now(), runId, options.force === true);
    markers = plan.full;
    if (plan.thin.length) {
      stage = 'current-lineup-observation';
      const counts = await observeCurrentLineups(dependencies, plan.thin, runId, plan.full.length);
      log(dependencies, counts.failed ? 'warn' : 'info', { stage, outcome: 'completed', runId,
        checked: counts.checked, changed: counts.changed, unchanged: counts.unchanged,
        notReady: counts.notReady, failedLeagues: counts.failed, pending: counts.pending });
    }
    if (!plan.full.length) {
      if (failedPreflightLeagues > 0) throw new Error('Operational cadence refresh was incomplete.');
      if (!await dependencies.repository.completeJob(jobKey, runId)) throw new Error('Current observation lease lost.');
      acquired = false;
      return { status: 'skipped', reason: 'idle', cadence: 'idle' };
    }
    stage = 'league-load';
    const loaded = await loadCurrentLeagues(dependencies, plan.full, runId);
    if (!loaded.sources.length) throw new Error('No complete current league source loaded.');
    stage = 'league-publish';
    const result = await runCurrentProjectionStages(dependencies, loaded.sources, loaded.publicationFences, calculatedAt, runId);
    await settleCurrentHourlyMarkers(dependencies, markers, result.publishedLeagueKeys, runId);
    markersSettled = true;
    const cadence = highestCadence(plan.full.map((target) => target.cadence));
    if (cadence === 'hourly' || cadence === 'forced') {
      await dependencies.repository.pruneHistory({ before: new Date(now.getTime() - 48 * 60 * 60_000).toISOString(),
        keepRecentSnapshotsPerLeagueWeek: 3 }).catch(() => undefined);
    }
    if (!await dependencies.repository.completeJob(jobKey, runId)) throw new Error('Current projection lease lost.');
    acquired = false;
    const failedLeagues = result.failedLeagues + loaded.failedLeagues + failedPreflightLeagues;
    log(dependencies, 'info', { stage: 'run', outcome: 'completed', runId, cadence,
      totalDurationMs: elapsed(dependencies, runStartedAt), loadedLeagues: loaded.sources.length,
      publishedLeagues: result.publishedLeagues, unchangedLeagues: result.unchangedLeagues,
      skippedLeagues: plan.skipped, failedLeagues });
    return { status: 'completed', cadence, publishedLeagues: result.publishedLeagues,
      failedLeagues, providerGroups: result.providerGroups };
  } catch {
    if (!markersSettled) await settleCurrentHourlyMarkers(dependencies, markers, new Set(), runId).catch(() => undefined);
    if (acquired) await dependencies.repository.failJob(jobKey, runId, 'current-projection-failed').catch(() => false);
    log(dependencies, 'error', { stage, outcome: 'failed', runId,
      totalDurationMs: elapsed(dependencies, runStartedAt), failedLeagues: failedPreflightLeagues,
      failureCode: 'current-projection-failed' });
    return { status: 'failed' };
  }
}
