import type {
  FutureRefreshAttemptId,
  FutureRefreshFailureCode,
} from '../ports/future-refresh-repository';
import type { LiveProjectionWorkerDependencies } from './contracts';
import type { FutureWorkSelection } from './future-work-policy';
import {
  FUTURE_ATTEMPT_LEASE_SECONDS,
  FutureWorkError,
  assertFutureMayStart,
  assertFutureWithinDeadline,
  futureFailureCode,
  futureMayStart,
  futureElapsedMs,
  futureProviderGroup,
  futureTimestamp,
  logFuture,
  nextFutureRefreshAt,
  sameFuturePeriod,
  type FutureWorkTiming,
} from './future-work-runtime';

export type FutureProjectionStageResult =
  | Readonly<{ status: 'completed'; providerGroups: 1 }>
  | Readonly<{ status: 'skipped' }>
  | Readonly<{ status: 'failed'; failureCode: FutureRefreshFailureCode }>;

function unavailableFailureCode(reason: string): FutureRefreshFailureCode {
  return reason === 'invalid-request' || reason === 'invalid-response'
    ? 'projection-slate-invalid'
    : 'provider-unavailable';
}

export async function runFutureProjectionStage(
  dependencies: LiveProjectionWorkerDependencies,
  selection: FutureWorkSelection,
  runId: string,
  timing: FutureWorkTiming,
): Promise<FutureProjectionStageResult> {
  if (!futureMayStart(dependencies, timing)) {
    return { status: 'failed', failureCode: 'deadline-exceeded' };
  }

  const attemptedAt = futureTimestamp(dependencies, timing);
  const claim = await dependencies.repository.beginFutureProjectionRefresh({
    projectionSource: dependencies.projectionStorage.source,
    normalizerVersion: dependencies.projectionStorage.normalizerVersion,
    period: selection.period,
    attemptId: runId as FutureRefreshAttemptId,
    attemptedAt,
    leaseSeconds: FUTURE_ATTEMPT_LEASE_SECONDS,
  });
  if (claim.kind !== 'acquired') return { status: 'skipped' };

  let failureCode: FutureRefreshFailureCode = 'unexpected';
  let activeStage = 'future-projection-feed';
  let activeStageStartedAt = dependencies.clock.monotonicNow();
  try {
    assertFutureMayStart(dependencies, timing);
    activeStageStartedAt = dependencies.clock.monotonicNow();
    const result = await dependencies.projectionFeed.getProjectionSlate(selection.period)
      .catch(() => {
        throw new FutureWorkError('provider-unavailable');
      });
    assertFutureWithinDeadline(dependencies, timing);
    if (result.status !== 'available') {
      throw new FutureWorkError(unavailableFailureCode(result.reason));
    }
    if (result.slate.source !== dependencies.projectionStorage.source
      || !sameFuturePeriod(result.slate.period, selection.period)) {
      throw new FutureWorkError('projection-slate-invalid');
    }
    if (result.slate.quality !== 'complete') {
      throw new FutureWorkError('projection-slate-incomplete');
    }
    logFuture(dependencies, 'info', {
      stage: activeStage,
      outcome: 'completed',
      runId,
      futureAction: selection.kind,
      weekDistance: selection.weekDistance,
      period: selection.period,
      providerGroup: futureProviderGroup(selection.period),
      providerDurationMs: Math.max(
        0,
        dependencies.clock.monotonicNow() - activeStageStartedAt,
      ),
      providerOutcome: 'available',
      projectionRows: result.slate.coverage.playerRows + result.slate.coverage.defenseRows,
      matchedProjectionRows: result.slate.coverage.matchedPlayers
        + result.slate.coverage.usableDefenses,
    });

    assertFutureMayStart(dependencies, timing);
    activeStage = 'future-projection-persist';
    activeStageStartedAt = dependencies.clock.monotonicNow();
    const stored = await dependencies.repository.recordProjectionSlate(result.slate)
      .catch(() => {
        throw new FutureWorkError('projection-slate-persistence-failed');
      });
    assertFutureWithinDeadline(dependencies, timing);
    if (stored.kind !== 'stored'
      || stored.value.entryCount !== result.slate.projections.length
      || !['advanced', 'verified'].includes(stored.value.pointerOutcome)) {
      throw new FutureWorkError('projection-slate-persistence-failed');
    }

    const completedAt = futureTimestamp(dependencies, timing);
    const completed = await dependencies.repository.completeFutureProjectionRefresh({
      projectionSource: dependencies.projectionStorage.source,
      normalizerVersion: dependencies.projectionStorage.normalizerVersion,
      period: selection.period,
      attemptId: claim.attemptId,
      completedAt,
      nextRefreshAt: nextFutureRefreshAt(completedAt, 'projection', selection.weekDistance),
      slate: {
        observationId: stored.value.observationId,
        contentId: stored.value.contentId,
      },
    }).catch(() => {
      throw new FutureWorkError('projection-slate-persistence-failed');
    });
    if (completed.kind !== 'updated') {
      throw new FutureWorkError('projection-slate-persistence-failed');
    }
    logFuture(dependencies, 'info', {
      stage: activeStage,
      outcome: 'completed',
      runId,
      futureAction: selection.kind,
      weekDistance: selection.weekDistance,
      period: selection.period,
      providerGroup: futureProviderGroup(selection.period),
      stageDurationMs: Math.max(
        0,
        dependencies.clock.monotonicNow() - activeStageStartedAt,
      ),
      projectionRows: stored.value.entryCount,
    });
    return { status: 'completed', providerGroups: 1 };
  } catch (error) {
    failureCode = futureFailureCode(error);
    logFuture(dependencies, 'warn', {
      stage: activeStage,
      outcome: 'failed',
      runId,
      futureAction: selection.kind,
      weekDistance: selection.weekDistance,
      period: selection.period,
      providerGroup: futureProviderGroup(selection.period),
      ...(activeStage === 'future-projection-feed'
        ? {
            providerDurationMs: Math.max(
              0,
              dependencies.clock.monotonicNow() - activeStageStartedAt,
            ),
            providerOutcome: failureCode === 'provider-unavailable'
              ? 'unavailable' as const : 'invalid' as const,
          }
        : {
            stageDurationMs: Math.max(
              0,
              dependencies.clock.monotonicNow() - activeStageStartedAt,
            ),
          }),
      totalDurationMs: futureElapsedMs(dependencies, timing),
      failureCode,
    });
  }

  const failedAt = futureTimestamp(dependencies, timing);
  await dependencies.repository.failFutureProjectionRefresh({
    projectionSource: dependencies.projectionStorage.source,
    normalizerVersion: dependencies.projectionStorage.normalizerVersion,
    period: selection.period,
    attemptId: claim.attemptId,
    failedAt,
    failureCode,
  }).catch(() => ({ kind: 'stale' as const }));
  return { status: 'failed', failureCode };
}
