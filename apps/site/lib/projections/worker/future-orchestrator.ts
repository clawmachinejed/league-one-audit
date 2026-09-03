import type {
  LeagueConfiguration,
  LeaguePeriodAuthority,
} from '../domain/contracts';
import type {
  FutureRefreshFailureCode,
  FutureRefreshPlanPeriod,
} from '../ports/future-refresh-repository';
import {
  LIVE_PROJECTION_MODEL_VERSION,
  type LiveProjectionSyncResult,
  type LiveProjectionWorkerDependencies,
  type ProjectionLogContext,
} from './contracts';
import { minuteBoundary } from './cadence';
import { runFutureMaterializationStage } from './future-materialization-stage';
import { runFutureProjectionStage } from './future-projection-stage';
import {
  futurePeriodsForAuthorities,
  futureWeekDistance,
  selectFutureWork,
  type FutureRefreshPlan,
} from './future-work-policy';
import {
  FUTURE_DEADLINE_CLEANUP_MS,
  FutureWorkError,
  createFutureWorkDeadline,
  futureElapsedMs,
  futureMayStart,
  type FutureWorkTiming,
} from './future-work-runtime';

// A separate key prevents the minute-scoped future claim from colliding with
// the already-completed current-period hourly claim at the top of the hour.
const GLOBAL_JOB_KEY = 'future-projection-sync';
const GLOBAL_JOB_LEASE_SECONDS = 120;

function log(
  dependencies: Pick<LiveProjectionWorkerDependencies, 'logger'>,
  level: 'info' | 'warn' | 'error',
  context: ProjectionLogContext,
): void {
  try {
    dependencies.logger.write(level, context);
  } catch {
    // Operational logging must never change projection behavior.
  }
}

function policyPlan(plan: FutureRefreshPlanPeriod): FutureRefreshPlan {
  return {
    period: plan.period,
    projectionNextRefreshAt: plan.projection.nextRefreshAt,
    projectionLastSucceededAt: plan.projection.lastSucceededAt,
    projectionConsecutiveFailures: plan.projection.consecutiveFailures,
    currentProjectionSlateContentId: plan.projection.currentSlate
      ? String(plan.projection.currentSlate.contentId)
      : null,
    projectionDue: plan.projection.due,
    materializations: plan.materializations.map((state) => ({
      leagueKey: state.leagueKey,
      nextRefreshAt: state.nextRefreshAt,
      lastSucceededAt: state.lastSucceededAt,
      lastProjectionSlateContentId: state.lastSlate ? String(state.lastSlate.contentId) : null,
      consecutiveFailures: state.consecutiveFailures,
      due: state.due,
    })),
  };
}

function planForSelection(
  plans: readonly FutureRefreshPlanPeriod[],
  selection: Readonly<{ period: FutureRefreshPlanPeriod['period'] }>,
): FutureRefreshPlanPeriod | null {
  return plans.find((plan) => (
    plan.period.season === selection.period.season
    && plan.period.seasonType === selection.period.seasonType
    && plan.period.week === selection.period.week
  )) ?? null;
}

async function failGlobalJob(
  dependencies: LiveProjectionWorkerDependencies,
  runId: string,
  failureCode: FutureRefreshFailureCode,
): Promise<void> {
  await dependencies.repository.failJob(
    GLOBAL_JOB_KEY,
    runId,
    `future-refresh:${failureCode}`,
  ).catch(() => false);
}

async function releaseTimedOutGlobalJob(
  dependencies: LiveProjectionWorkerDependencies,
  runId: string,
): Promise<void> {
  const controller = new AbortController();
  let releaseWait: (() => void) | null = null;
  const timeout = new Promise<void>((resolve) => {
    releaseWait = resolve;
  });
  const timer = setTimeout(() => {
    controller.abort(new FutureWorkError('deadline-exceeded'));
    releaseWait?.();
  }, FUTURE_DEADLINE_CLEANUP_MS);
  timer.unref?.();
  try {
    const scoped = dependencies.futurePersistence.scope(controller.signal);
    await Promise.race([
      scoped.repository.failJob(
        GLOBAL_JOB_KEY,
        runId,
        'future-refresh:deadline-exceeded',
      ).then(() => undefined, () => undefined),
      timeout,
    ]);
  } finally {
    clearTimeout(timer);
  }
}

type FutureWorkInput = Readonly<{
  configurations: readonly LeagueConfiguration[];
  authorities: readonly LeaguePeriodAuthority[];
  now: Date;
  calculatedAt: string;
  runId: string;
  timing: FutureWorkTiming;
}>;

async function runFutureWorkWithinDeadline(
  dependencies: LiveProjectionWorkerDependencies,
  input: FutureWorkInput,
  periods: readonly FutureRefreshPlanPeriod['period'][],
): Promise<LiveProjectionSyncResult | null> {
  const expectedLeagueKeys = input.configurations.map((configuration) => configuration.key);
  let globalJobAcquired = false;
  try {
    const targets = periods.map((period) => ({
      period,
      weekDistance: futureWeekDistance(period, periods),
    }));
    const ensured = await dependencies.repository.ensureFutureRefreshStates({
      projectionSource: dependencies.projectionStorage.source,
      normalizerVersion: dependencies.projectionStorage.normalizerVersion,
      modelVersion: LIVE_PROJECTION_MODEL_VERSION,
      targets,
      leagueKeys: expectedLeagueKeys,
      seededAt: input.calculatedAt,
    });
    if (ensured.kind === 'disabled') return { status: 'disabled' };
    const plans = await dependencies.repository.readFutureRefreshPlan({
      projectionSource: dependencies.projectionStorage.source,
      normalizerVersion: dependencies.projectionStorage.normalizerVersion,
      modelVersion: LIVE_PROJECTION_MODEL_VERSION,
      targets,
      leagueKeys: expectedLeagueKeys,
      asOf: input.calculatedAt,
    });
    const selection = selectFutureWork(
      plans.map(policyPlan),
      periods,
      expectedLeagueKeys,
      input.now,
    );
    if (!selection || !futureMayStart(dependencies, input.timing)) return null;
    const selectedPlan = planForSelection(plans, selection);
    if (!selectedPlan) return { status: 'failed' };

    const claim = await dependencies.repository.acquireJob({
      jobKey: GLOBAL_JOB_KEY,
      jobType: 'future-projection-sync',
      scheduledFor: minuteBoundary(input.now),
      payload: {
        modelVersion: LIVE_PROJECTION_MODEL_VERSION,
        future: true,
        action: selection.kind,
        season: selection.period.season,
        seasonType: selection.period.seasonType,
        week: selection.period.week,
      },
      workerId: input.runId,
      leaseSeconds: GLOBAL_JOB_LEASE_SECONDS,
    });
    if (claim.kind === 'disabled') return { status: 'disabled' };
    if (claim.kind === 'busy' || claim.kind === 'completed') {
      return { status: 'skipped', reason: claim.kind, cadence: null };
    }
    globalJobAcquired = true;

    log(dependencies, 'info', {
      stage: 'future-lease',
      outcome: 'started',
      runId: input.runId,
      cadence: 'hourly',
      futureAction: selection.kind,
      weekDistance: selection.weekDistance,
      period: selection.period,
      modelVersion: LIVE_PROJECTION_MODEL_VERSION,
      leaseOutcome: 'acquired',
    });

    const stage = selection.kind === 'projection-ingest'
      ? await runFutureProjectionStage(dependencies, selection, input.runId, input.timing)
      : await runFutureMaterializationStage(
          dependencies,
          input.configurations,
          selection,
          selectedPlan,
          input.runId,
          input.calculatedAt,
          input.timing,
        );

    if (stage.status === 'failed') {
      const failedLeagues = 'failedLeagues' in stage && typeof stage.failedLeagues === 'number'
        ? stage.failedLeagues
        : 0;
      await failGlobalJob(dependencies, input.runId, stage.failureCode);
      globalJobAcquired = false;
      log(dependencies, 'warn', {
        stage: selection.kind === 'projection-ingest'
          ? 'future-projection' : 'future-materialization',
        outcome: 'failed',
        runId: input.runId,
        cadence: 'hourly',
        futureAction: selection.kind,
        weekDistance: selection.weekDistance,
        period: selection.period,
        failedLeagues,
        totalDurationMs: futureElapsedMs(dependencies, input.timing),
        failureCode: stage.failureCode,
      });
      return { status: 'failed' };
    }

    if (!await dependencies.repository.completeJob(GLOBAL_JOB_KEY, input.runId)) {
      await failGlobalJob(dependencies, input.runId, 'unexpected');
      globalJobAcquired = false;
      log(dependencies, 'error', {
        stage: 'future-lease',
        outcome: 'failed',
        runId: input.runId,
        period: selection.period,
        leaseOutcome: 'lost',
        failureCode: 'lease-lost',
      });
      return { status: 'failed' };
    }
    globalJobAcquired = false;

    if (stage.status === 'skipped') {
      return { status: 'skipped', reason: 'busy', cadence: null };
    }
    const publishedLeagues = 'publishedLeagues' in stage
      && typeof stage.publishedLeagues === 'number' ? stage.publishedLeagues : 0;
    const failedLeagues = 'failedLeagues' in stage
      && typeof stage.failedLeagues === 'number' ? stage.failedLeagues : 0;
    const unchangedLeagues = 'unchangedLeagues' in stage
      && typeof stage.unchangedLeagues === 'number' ? stage.unchangedLeagues : 0;
    log(dependencies, 'info', {
      stage: 'future-run',
      outcome: 'completed',
      runId: input.runId,
      cadence: 'hourly',
      futureAction: selection.kind,
      weekDistance: selection.weekDistance,
      period: selection.period,
      modelVersion: LIVE_PROJECTION_MODEL_VERSION,
      totalDurationMs: futureElapsedMs(dependencies, input.timing),
      publishedLeagues,
      unchangedLeagues,
      failedLeagues,
    });
    return {
      status: 'completed',
      cadence: 'hourly',
      publishedLeagues,
      failedLeagues,
      providerGroups: stage.providerGroups,
    };
  } catch {
    if (globalJobAcquired) {
      await failGlobalJob(dependencies, input.runId, 'unexpected');
    }
    log(dependencies, 'error', {
      stage: 'future-plan',
      outcome: 'failed',
      runId: input.runId,
      modelVersion: LIVE_PROJECTION_MODEL_VERSION,
      totalDurationMs: futureElapsedMs(dependencies, input.timing),
      failureCode: 'unexpected',
    });
    return { status: 'failed' };
  }
}

/**
 * Runs at most one future-period action after the current scoring period has
 * either gone idle or already completed its hourly job.
 */
export async function runFutureWork(
  dependencies: LiveProjectionWorkerDependencies,
  input: FutureWorkInput,
): Promise<LiveProjectionSyncResult | null> {
  const expectedLeagueKeys = input.configurations.map((configuration) => configuration.key);
  const periods = futurePeriodsForAuthorities(input.authorities, expectedLeagueKeys);
  if (!periods || periods.length === 0 || !futureMayStart(dependencies, input.timing)) return null;

  const deadline = createFutureWorkDeadline(dependencies, input.timing);
  const scopedPersistence = dependencies.futurePersistence.scope(deadline.signal);
  const scopedDependencies: LiveProjectionWorkerDependencies = {
    ...dependencies,
    ...scopedPersistence,
  };
  try {
    const result = await deadline.run(runFutureWorkWithinDeadline(
      scopedDependencies,
      input,
      periods,
    ));
    if (!deadline.signal.aborted) return result;
  } catch (error) {
    if (!(error instanceof FutureWorkError) || error.failureCode !== 'deadline-exceeded') {
      throw error;
    }
  } finally {
    deadline.dispose();
  }

  await releaseTimedOutGlobalJob(dependencies, input.runId);
  log(dependencies, 'error', {
    stage: 'future-run',
    outcome: 'failed',
    runId: input.runId,
    modelVersion: LIVE_PROJECTION_MODEL_VERSION,
    totalDurationMs: futureElapsedMs(dependencies, input.timing),
    failureCode: 'deadline-exceeded',
  });
  return { status: 'failed' };
}
