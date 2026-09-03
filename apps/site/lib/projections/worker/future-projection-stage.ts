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
  futureTimestamp,
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
  try {
    assertFutureMayStart(dependencies, timing);
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

    assertFutureMayStart(dependencies, timing);
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
    return { status: 'completed', providerGroups: 1 };
  } catch (error) {
    failureCode = futureFailureCode(error);
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
