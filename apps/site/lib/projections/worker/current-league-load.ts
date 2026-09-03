import type { LineupPublicationFence } from '../domain/lineup-publication';
import { sameLineupShape } from '../domain/lineup-observation';
import type { LineupObservationClaim } from '../ports/lineup-watch-repository';
import { sameExternalReference } from '../shared/provider-identity';
import { LIVE_PROJECTION_MODEL_VERSION, type LiveProjectionWorkerDependencies, type LoadedLeague } from './contracts';
import type { CurrentWorkTarget } from './current-work-plan';
import { lineupObservationClaim } from './lineup-watch-context';
import { nextLineupCheckAt } from './lineup-watch-policy';
import { elapsed, mapWithConcurrency, safeProjectionLog } from './worker-operations';

/** The full weekly response is this minute's observation; no separate thin request. */
export async function loadCurrentLeagues(
  dependencies: LiveProjectionWorkerDependencies, targets: readonly CurrentWorkTarget[], runId: string,
) {
  const startedAt = dependencies.clock.monotonicNow();
  const outcomes = await mapWithConcurrency(targets, 8, async (target) => {
    const { state } = target;
    const fence: Extract<LineupPublicationFence, { ownerLane: 'current' }> = {
      watchId: state.watchId, watchGeneration: state.watchGeneration,
      authorityGeneration: state.authorityGeneration, ownerLane: 'current', runId,
    };
    let claim: LineupObservationClaim | null = null;
    try {
      const reservation = await dependencies.lineupRepository.reserveFullLineupObservation({
        fence, modelVersion: LIVE_PROJECTION_MODEL_VERSION, leaseSeconds: 120,
      });
      if (reservation.kind !== 'stored') throw new Error('Full lineup observation reservation failed.');
      claim = lineupObservationClaim(reservation.state, runId);
      const source = await dependencies.leagueSource.getLeagueWeek(state.configuration, state.period);
      if (source.configuration.key !== state.configuration.key
        || !sameExternalReference(source.configuration.leagueRef, state.configuration.leagueRef)
        || source.period.season !== state.period.season || source.period.seasonType !== state.period.seasonType
        || source.period.week !== state.period.week
        || source.maxWeek < state.configuration.matchupWeekRange.lastWeek
        || !sameLineupShape(source.lineupShape, reservation.state.shape)) throw new Error('Full league context mismatch.');
      const accepted = await dependencies.lineupRepository.completeLineupObservation({
        claim, actualLineup: source.lineup, requestStartedAt: source.requestStartedAt,
        requestCompletedAt: source.requestCompletedAt,
        nextCheckAt: nextLineupCheckAt('current', state.phase, new Date(source.requestCompletedAt))!,
      });
      if (accepted.kind !== 'stored') throw new Error('Full lineup observation was superseded.');
      claim = null;
      const league: LoadedLeague = { configuration: state.configuration, source, cadence: target.cadence };
      return { league, fence };
    } catch {
      if (claim) await dependencies.lineupRepository.failLineupObservation({ claim,
        failureCode: 'full-league-source-unavailable', retryDelaysSeconds: [60, 300, 900, 3600] }).catch(() => undefined);
      safeProjectionLog(dependencies, 'warn', { stage: 'league-load', outcome: 'failed', runId,
        leagueKey: state.configuration.key, failureCode: 'league-source-unavailable' });
      return null;
    }
  });
  const loaded = outcomes.filter((result): result is NonNullable<typeof result> => result !== null);
  safeProjectionLog(dependencies, 'info', { stage: 'league-load', outcome: 'completed', runId,
    stageDurationMs: elapsed(dependencies, startedAt), loadedLeagues: loaded.length,
    failedLeagues: targets.length - loaded.length });
  return { sources: loaded.map((result) => result.league),
    publicationFences: new Map(loaded.map((result) => [result.league.configuration.key, result.fence])),
    failedLeagues: targets.length - loaded.length };
}
