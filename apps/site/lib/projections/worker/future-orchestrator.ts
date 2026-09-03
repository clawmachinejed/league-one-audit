import type { FutureProjectionSyncResult, FutureProjectionWorkerDependencies, ForcedFuturePeriod } from './future-contracts';
import { LIVE_PROJECTION_MODEL_VERSION } from './contracts';
import { minuteBoundary } from './cadence';
import { prepareFuturePlan, refreshPreparedFuturePlan, type FuturePreparedPlan } from './future-plan';
import { runFutureMaterializationStage } from './future-materialization-stage';
import { runFutureProjectionStage } from './future-projection-stage';
import { selectFutureWork, type FutureWorkSelection } from './future-work-policy';
import {
  FUTURE_DEADLINE_CLEANUP_MS, FutureWorkError, createFutureWorkDeadline, futureElapsedMs,
  futureMayStart, futureTimestamp, logFuture, sameFuturePeriod, type FutureWorkTiming,
} from './future-work-runtime';

const GLOBAL_JOB_KEY = 'future-projection-sync';
const GLOBAL_JOB_LEASE_SECONDS = 120;

function forcedSelection(prepared: FuturePreparedPlan, forced: ForcedFuturePeriod): FutureWorkSelection | null {
  const plan = prepared.policy.find((candidate) => sameFuturePeriod(candidate.state.period, forced.period));
  const leagues = plan?.leagues.filter((league) => forced.leagueKeys.includes(league.watch.configuration.key));
  if (!leagues?.length) return null;
  return { kind: 'projection-ingest', period: forced.period, leagueKeys: leagues.map((league) => league.watch.configuration.key),
    weekDistance: plan!.state.weekDistance, dirty: false,
    leagueRefresh: leagues.map((league) => ({ leagueKey: league.watch.configuration.key, weekDistance: league.weekDistance,
      defaultPeriod: league.defaultPeriodCadence !== null, cadence: 'forced' })),
    defaultPeriod: leagues.some((league) => league.defaultPeriodCadence !== null), cadence: 'forced' };
}

async function performSelectedWork(
  dependencies: FutureProjectionWorkerDependencies, prepared: FuturePreparedPlan,
  selection: FutureWorkSelection, runId: string, calculatedAt: string, timing: FutureWorkTiming,
): Promise<FutureProjectionSyncResult> {
  const plan = prepared.plans.find((value) => sameFuturePeriod(value.period, selection.period));
  if (!plan) return { status: 'failed' };
  const stage = selection.kind === 'projection-ingest'
    ? await runFutureProjectionStage(dependencies, selection, runId, timing)
    : await runFutureMaterializationStage(dependencies, prepared.configurations, prepared.watches,
        selection, plan, runId, calculatedAt, timing);
  if (stage.status === 'failed') {
    logFuture(dependencies, 'warn', { stage: selection.kind === 'projection-ingest' ? 'future-projection' : 'future-materialization',
      outcome: 'failed', runId, period: selection.period, futureAction: selection.kind,
      failureCode: stage.failureCode, ...('failedLeagues' in stage && typeof stage.failedLeagues === 'number' ? { failedLeagues: stage.failedLeagues } : {}) });
    return { status: 'failed' };
  }
  if (stage.status === 'skipped') return { status: 'skipped', reason: 'busy' };
  const published = 'publishedLeagues' in stage && typeof stage.publishedLeagues === 'number' ? stage.publishedLeagues : 0;
  const unchanged = 'unchangedLeagues' in stage && typeof stage.unchangedLeagues === 'number' ? stage.unchangedLeagues : 0;
  const failed = 'failedLeagues' in stage && typeof stage.failedLeagues === 'number' ? stage.failedLeagues : 0;
  return {
    status: 'completed', action: selection.kind, period: selection.period,
    publishedLeagues: published - unchanged, unchangedLeagues: unchanged, failedLeagues: failed + prepared.unavailableAuthorityCount,
  };
}

async function executeFutureWork(
  dependencies: FutureProjectionWorkerDependencies, now: Date, runId: string,
  timing: FutureWorkTiming, forced?: ForcedFuturePeriod,
): Promise<FutureProjectionSyncResult> {
  const loaded = await prepareFuturePlan(dependencies, now);
  if (loaded === 'disabled') return { status: 'disabled' };
  if (loaded === 'capacity-exceeded') {
    logFuture(dependencies, 'warn', { stage: 'lineup-watch-capacity', outcome: 'failed', runId, capacityStatus: 'capacity-exceeded' });
    return { status: 'failed' };
  }
  const prepared = forced ? { ...loaded, unavailableAuthorityCount: forced.leagueKeys.filter((key) =>
    !loaded.authorities.some((authority) => authority.configuration.key === key)).length } : loaded;
  const selection = forced ? forcedSelection(prepared, forced) : selectFutureWork(prepared.policy, now);
  if (!selection) {
    if (prepared.unavailableAuthorityCount > 0) {
      logFuture(dependencies, 'warn', { stage: 'future-authority', outcome: 'failed', runId,
        failedLeagues: prepared.unavailableAuthorityCount });
      return { status: 'failed' };
    }
    return { status: 'skipped', reason: 'idle' };
  }
  if (!futureMayStart(dependencies, timing)) return { status: 'skipped', reason: 'deadline' };
  const claim = await dependencies.repository.acquireJob({
    jobKey: GLOBAL_JOB_KEY, jobType: GLOBAL_JOB_KEY,
    scheduledFor: forced ? now.toISOString() : minuteBoundary(now),
    payload: { modelVersion: LIVE_PROJECTION_MODEL_VERSION, future: true, action: selection.kind,
      season: selection.period.season, seasonType: selection.period.seasonType, week: selection.period.week },
    workerId: runId, leaseSeconds: GLOBAL_JOB_LEASE_SECONDS,
  });
  if (claim.kind === 'disabled') return { status: 'disabled' };
  if (claim.kind !== 'acquired') return { status: 'skipped', reason: 'busy' };
  let completed = false;
  try {
    logFuture(dependencies, 'info', { stage: 'future-lease', outcome: 'started', runId,
      cadence: selection.cadence, period: selection.period, futureAction: selection.kind, leaseOutcome: 'acquired' });
    let result = await performSelectedWork(dependencies, prepared, selection, runId, now.toISOString(), timing);
    // Existing authenticated force maintenance completes one bounded period using the same stages.
    // Scheduled invocations always stop after their single selected action.
    if (forced && result.status === 'completed') {
      const refreshed = await refreshPreparedFuturePlan(dependencies, prepared, futureTimestamp(dependencies, timing));
      result = await performSelectedWork(dependencies, refreshed, { ...selection, kind: 'materialize' },
        runId, now.toISOString(), timing);
    }
    if (result.status === 'failed') return result;
    if (!await dependencies.repository.completeJob(GLOBAL_JOB_KEY, runId)) return { status: 'failed' };
    completed = true;
    logFuture(dependencies, result.status === 'completed' ? 'info' : 'warn', {
      stage: 'future-run', outcome: result.status === 'completed' ? 'completed' : 'skipped', runId,
      cadence: selection.cadence, period: selection.period, futureAction: result.status === 'completed' ? result.action : selection.kind,
      totalDurationMs: futureElapsedMs(dependencies, timing),
      ...(result.status === 'completed' ? { publishedLeagues: result.publishedLeagues,
        unchangedLeagues: result.unchangedLeagues, failedLeagues: result.failedLeagues } : {}),
    });
    return result;
  } finally {
    if (!completed) await dependencies.repository.failJob(GLOBAL_JOB_KEY, runId, 'future-refresh:unexpected').catch(() => false);
  }
}

async function releaseTimedOutJob(dependencies: FutureProjectionWorkerDependencies, runId: string): Promise<void> {
  const controller = new AbortController();
  let release: (() => void) | undefined;
  const timeout = new Promise<void>((resolve) => { release = resolve; });
  const timer = setTimeout(() => { controller.abort(); release?.(); }, FUTURE_DEADLINE_CLEANUP_MS);
  timer.unref?.();
  try {
    const scoped = dependencies.futurePersistence.scope(controller.signal);
    await Promise.race([scoped.repository.failJob(GLOBAL_JOB_KEY, runId, 'future-refresh:deadline-exceeded')
      .then(() => undefined, () => undefined), timeout]);
  } finally { clearTimeout(timer); }
}

/** Independent future lane: durable authority only, one scheduled action and one global lease. */
export async function runFutureWithDependencies(
  dependencies: FutureProjectionWorkerDependencies, forced?: ForcedFuturePeriod,
): Promise<FutureProjectionSyncResult> {
  if (!dependencies.repository.enabled || !dependencies.lineupRepository.enabled) return { status: 'disabled' };
  const now = forced?.execution?.now ?? dependencies.clock.now();
  if (!Number.isFinite(now.getTime())) return { status: 'failed' };
  const runId = forced?.execution?.runId ?? dependencies.idGenerator.generate();
  const timing = forced?.execution?.timing ?? { wallStartedAtMs: now.getTime(), monotonicStartedAt: dependencies.clock.monotonicNow() };
  if (!futureMayStart(dependencies, timing)) return { status: 'skipped', reason: 'deadline' };
  const deadline = createFutureWorkDeadline(dependencies, timing);
  try {
    const scoped = { ...dependencies, ...dependencies.futurePersistence.scope(deadline.signal) };
    return await deadline.run(executeFutureWork(scoped, now, runId, timing, forced));
  } catch (error) {
    if (deadline.signal.aborted) await releaseTimedOutJob(dependencies, runId);
    logFuture(dependencies, 'error', { stage: 'future-run', outcome: 'failed', runId,
      totalDurationMs: futureElapsedMs(dependencies, timing),
      failureCode: error instanceof FutureWorkError ? error.failureCode : 'unexpected' });
    return { status: 'failed' };
  } finally { deadline.dispose(); }
}
