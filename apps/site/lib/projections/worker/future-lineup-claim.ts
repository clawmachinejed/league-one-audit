import type { LeagueWeekState } from '../domain/contracts';
import { sameLineupShape } from '../domain/lineup-observation';
import type { LineupMaterializationTarget, LineupPublicationFence } from '../domain/lineup-publication';
import type { LineupObservationClaim, LineupWatchState } from '../ports/lineup-watch-repository';
import { LIVE_PROJECTION_MODEL_VERSION } from './contracts';
import type { FutureProjectionWorkerDependencies } from './future-contracts';
import { FutureWorkError, FUTURE_ATTEMPT_LEASE_SECONDS } from './future-work-runtime';
import { lineupObservationClaim } from './lineup-watch-context';
import { nextLineupCheckAt } from './lineup-watch-policy';

export function futureLineupTarget(watch: LineupWatchState): LineupMaterializationTarget {
  return { watchId: watch.watchId, watchGeneration: watch.watchGeneration,
    authorityGeneration: watch.authorityGeneration, observedVersion: watch.observedVersion,
    lineupRevision: watch.latestLineupRevision };
}
export function futurePublicationFence(
  dependencies: Pick<FutureProjectionWorkerDependencies, 'projectionStorage'>,
  target: LineupMaterializationTarget, runId: string, attemptId: string,
): Extract<LineupPublicationFence, { ownerLane: 'future' }> {
  return { watchId: target.watchId, watchGeneration: target.watchGeneration,
    authorityGeneration: target.authorityGeneration, runId, ownerLane: 'future',
    materializationAttemptId: attemptId, projectionSource: dependencies.projectionStorage.source,
    normalizerVersion: dependencies.projectionStorage.normalizerVersion };
}
export async function reserveFutureFullObservation(
  dependencies: Pick<FutureProjectionWorkerDependencies, 'lineupRepository'>,
  fence: LineupPublicationFence,
): Promise<Readonly<{ state: LineupWatchState; claim: LineupObservationClaim }>> {
  const reserved = await dependencies.lineupRepository.reserveFullLineupObservation({
    fence, modelVersion: LIVE_PROJECTION_MODEL_VERSION, leaseSeconds: FUTURE_ATTEMPT_LEASE_SECONDS,
  });
  if (reserved.kind !== 'stored') throw new FutureWorkError('league-source-unavailable');
  return { state: reserved.state, claim: lineupObservationClaim(reserved.state, fence.runId) };
}
export async function completeFutureFullObservation(
  dependencies: Pick<FutureProjectionWorkerDependencies, 'lineupRepository'>,
  reserved: Readonly<{ state: LineupWatchState; claim: LineupObservationClaim }>, source: LeagueWeekState,
): Promise<void> {
  if (!sameLineupShape(source.lineupShape, reserved.state.shape)) throw new FutureWorkError('league-source-unavailable');
  const nextCheckAt = nextLineupCheckAt(reserved.state.watchClass, reserved.state.phase, new Date(source.requestCompletedAt));
  if (!nextCheckAt) throw new FutureWorkError('league-source-unavailable');
  const accepted = await dependencies.lineupRepository.completeLineupObservation({
    claim: reserved.claim, actualLineup: source.lineup, requestStartedAt: source.requestStartedAt,
    requestCompletedAt: source.requestCompletedAt, nextCheckAt,
  });
  if (accepted.kind !== 'stored') throw new FutureWorkError('league-source-unavailable');
}
