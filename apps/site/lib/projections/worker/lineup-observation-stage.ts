import { sameLineupShape, type TimedLineupObservation } from '../domain/lineup-observation';
import { calculateLineupRevision } from '../domain/lineup-revision';
import type { LineupWatchState } from '../ports/lineup-watch-repository';
import type { ProjectionFailureCode, ProjectionLogOutcome } from '../ports/logger';
import { sameExternalReference } from '../shared/provider-identity';
import { lineupObservationClaim } from './lineup-watch-context';
import { nextLineupCheckAt } from './lineup-watch-policy';
import { emptyLineupObservationCounts, type LineupObservationCounts, type LineupObservationWorkerDependencies } from './lineup-contracts';

export const LINEUP_OBSERVATION_CONCURRENCY = 8;
export type ObserveLineupDependencies = Pick<LineupObservationWorkerDependencies, 'lineupRepository' | 'lineupSource' | 'clock' | 'logger'>;

function matchesClaim(source: TimedLineupObservation, state: LineupWatchState): boolean {
  const start = Date.parse(source.requestStartedAt);
  const end = Date.parse(source.requestCompletedAt);
  if (!Number.isFinite(start) || !Number.isFinite(end) || start > end) return false;
  if (source.status !== 'complete') return true;
  const input = source.observation;
  return sameExternalReference(input.leagueRef, state.configuration.leagueRef)
    && input.period.season === state.period.season && input.period.seasonType === state.period.seasonType
    && input.period.week === state.period.week && sameLineupShape(input.shape, state.shape);
}

/** A claimed batch is bounded before any provider request; current and future use this same observation path. */
export async function observeLineupClaims(
  dependencies: ObserveLineupDependencies,
  states: readonly LineupWatchState[],
  runId: string,
  options: Readonly<{ signal?: AbortSignal; periodAnchorWeeks: ReadonlyMap<string, number> }>,
): Promise<LineupObservationCounts> {
  if (states.length > LINEUP_OBSERVATION_CONCURRENCY) throw new Error('Lineup observation batch exceeds its concurrency bound.');
  const counts = emptyLineupObservationCounts();
  await Promise.all(states.map(async (state) => {
    const claim = lineupObservationClaim(state, runId);
    if (options.signal?.aborted) { counts.skipped += 1; return; }
    let outcome: ProjectionLogOutcome = 'completed';
    let failureCode: ProjectionFailureCode | undefined;
    let accepted = false;
    const failure = async (code: ProjectionFailureCode) => {
      failureCode = code; outcome = 'failed';
      const result = await dependencies.lineupRepository.failLineupObservation({ claim, failureCode: code,
        retryDelaysSeconds: [state.watchClass === 'current' ? 60 : 180, 300, 900, 3600] });
      if (result.kind === 'stored') counts.failed += 1;
      else { counts.skipped += 1; outcome = 'skipped'; failureCode = 'claim-stale'; }
    };
    const startedAt = dependencies.clock.monotonicNow();
    try {
      counts.checked += 1;
      const source = await dependencies.lineupSource.getLineup({ configuration: state.configuration,
        period: state.period, shape: state.shape }, options.signal);
      if (options.signal?.aborted) { counts.skipped += 1; outcome = 'skipped'; failureCode = 'deadline-exceeded'; return; }
      if (!matchesClaim(source, state)) { await failure('lineup-response-invalid'); return; }
      const completedAt = new Date(source.requestCompletedAt);
      const nextCheckAt = nextLineupCheckAt(state.watchClass, state.phase, completedAt);
      if (!nextCheckAt) { counts.skipped += 1; outcome = 'skipped'; failureCode = 'claim-stale'; return; }
      if (source.status === 'not-ready') {
        const result = await dependencies.lineupRepository.recordLineupObservationNotReady({ claim,
          checkedAt: source.requestCompletedAt, nextCheckAt });
        if (result.kind === 'stored') { counts.notReady += 1; failureCode = 'lineup-not-ready'; }
        else { counts.skipped += 1; outcome = 'skipped'; failureCode = 'claim-stale'; }
      } else if (source.status === 'invalid' || source.status === 'unavailable') {
        await failure(source.status === 'invalid' ? 'lineup-response-invalid' : 'lineup-source-unavailable');
      } else {
        const actualLineup = await calculateLineupRevision(source.observation);
        const result = await dependencies.lineupRepository.completeLineupObservation({ claim, actualLineup,
          requestStartedAt: source.requestStartedAt, requestCompletedAt: source.requestCompletedAt, nextCheckAt });
        if (result.kind !== 'stored') { counts.skipped += 1; outcome = 'skipped'; failureCode = 'claim-stale'; return; }
        accepted = true;
        const changed = result.state.latestLineupRevision !== state.latestLineupRevision;
        if (changed) counts.changed += 1; else counts.unchanged += 1;
        if (result.state.pendingSince !== null) counts.pending += 1;
        if (changed && result.state.pendingSince !== null && result.state.materializationLane === 'future') {
          const anchorWeek = options.periodAnchorWeeks.get(state.configuration.key);
          if (anchorWeek === undefined) throw new Error('Lineup authority is missing.');
          // Accepted state is durable first. A wake failure leaves its pending revision available for retry.
          const wake = await dependencies.lineupRepository.wakeFutureProjectionAndMaterialization({ watchId: state.watchId,
            watchGeneration: state.watchGeneration, authorityGeneration: state.authorityGeneration,
            weekDistance: Math.max(1, state.period.week - anchorWeek), wakeProjection: false });
          if (wake.kind === 'disabled') { counts.failed += 1; outcome = 'failed'; }
        }
      }
    } catch {
      if (options.signal?.aborted) { counts.skipped += 1; outcome = 'skipped'; failureCode = 'deadline-exceeded'; }
      else if (accepted) { counts.failed += 1; outcome = 'failed'; failureCode = 'unexpected'; }
      else {
        try { await failure('lineup-source-unavailable'); } catch { counts.failed += 1; }
      }
    } finally {
      try { dependencies.logger.write(outcome === 'failed' ? 'warn' : 'info', { stage: 'lineup-observation', outcome, runId,
        leagueKey: state.configuration.key, period: state.period,
        lane: state.materializationLane ?? undefined, cadencePolicyVersion: state.cadencePolicyVersion,
        lineupRevisionVersion: state.lineupRevisionVersion, watchClass: state.watchClass,
        phase: state.phase, attemptGeneration: state.claimGeneration, providerAdapterInvocations: 1, failureCode,
        stageDurationMs: Math.max(0, dependencies.clock.monotonicNow() - startedAt) }); } catch { /* Logging is noncritical. */ }
    }
  }));
  return counts;
}
