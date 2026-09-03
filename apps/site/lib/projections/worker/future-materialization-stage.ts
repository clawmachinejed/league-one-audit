import type { GameStateSlate, LeagueConfiguration } from '../domain/contracts';
import type { FutureRefreshPlanPeriod } from '../ports/future-refresh-repository';
import type { LineupWatchState } from '../ports/lineup-watch-repository';
import { LIVE_PROJECTION_MODEL_VERSION, type PersistedGroup } from './contracts';
import type { FutureProjectionWorkerDependencies, FutureMaterializationStageResult } from './future-contracts';
import { prepareFutureMaterializations, failClaim, failClaims, type ReadyMaterialization } from './future-materialization-source';
import { assertCompleteGameCoverage } from './game-context';
import { processLeague } from './league-stage';
import { persistProviderGroup } from './provider-stage';
import { createProviderGroupScoringCache } from './scoring-cache';
import type { FutureWorkSelection } from './future-work-policy';
import { FutureWorkError, assertFutureMayStart, assertFutureWithinDeadline, futureElapsedMs, futureMayStart,
  futureProviderGroup, futureTimestamp, logFuture, mapFutureWithConcurrency, nextFutureRefreshAt,
  sameFuturePeriod, type FutureWorkTiming } from './future-work-runtime';

const LEAGUE_CONCURRENCY = 8;

export async function runFutureMaterializationStage(
  dependencies: FutureProjectionWorkerDependencies,
  configurations: readonly LeagueConfiguration[],
  watches: readonly LineupWatchState[],
  selection: FutureWorkSelection,
  plan: FutureRefreshPlanPeriod,
  runId: string,
  calculatedAt: string,
  timing: FutureWorkTiming,
): Promise<FutureMaterializationStageResult> {
  const prepared = await prepareFutureMaterializations(dependencies, configurations, watches, selection, plan, runId, timing);
  if (prepared.status !== 'ready') return prepared;
  const { ready, stored, currentLineage } = prepared;
  let { failedLeagues } = prepared;
  let games: GameStateSlate;
  const gameFeedStartedAt = dependencies.clock.monotonicNow();
  try {
    assertFutureMayStart(dependencies, timing);
    const result = await dependencies.gameStateFeed.getGameStateSlate(selection.period);
    assertFutureWithinDeadline(dependencies, timing);
    if (result.status !== 'available') throw new FutureWorkError('game-state-unavailable');
    if (!sameFuturePeriod(result.slate.period, selection.period)) {
      throw new FutureWorkError('game-state-incomplete');
    }
    games = result.slate;
    logFuture(dependencies, 'info', {
      stage: 'future-game-state-feed',
      outcome: 'completed',
      runId,
      futureAction: selection.kind,
      weekDistance: selection.weekDistance,
      period: selection.period,
      providerGroup: futureProviderGroup(selection.period),
      providerDurationMs: Math.max(
        0,
        dependencies.clock.monotonicNow() - gameFeedStartedAt,
      ),
      providerOutcome: 'available',
      gameCount: games.games.length,
    });
  } catch (error) {
    const failureCode = error instanceof FutureWorkError
      ? error.failureCode
      : 'game-state-unavailable';
    await failClaims(dependencies, selection, ready, timing, failureCode);
    logFuture(dependencies, 'warn', {
      stage: 'future-game-state-feed',
      outcome: 'failed',
      runId,
      futureAction: selection.kind,
      weekDistance: selection.weekDistance,
      period: selection.period,
      providerGroup: futureProviderGroup(selection.period),
      providerDurationMs: Math.max(
        0,
        dependencies.clock.monotonicNow() - gameFeedStartedAt,
      ),
      providerOutcome: failureCode === 'game-state-unavailable'
        ? 'unavailable' : 'invalid',
      failureCode,
    });
    return {
      status: 'failed',
      failureCode,
      failedLeagues: failedLeagues + ready.length,
    };
  }

  const gameReady: ReadyMaterialization[] = [];
  for (const value of ready) {
    try {
      assertCompleteGameCoverage(value.league, games);
      gameReady.push(value);
    } catch {
      failedLeagues += 1;
      await failClaim(dependencies, selection, value, timing, 'game-state-incomplete');
    }
  }
  if (gameReady.length === 0) {
    return {
      status: 'failed',
      failureCode: 'game-state-incomplete',
      failedLeagues,
    };
  }

  let persisted: PersistedGroup;
  const providerPersistStartedAt = dependencies.clock.monotonicNow();
  try {
    assertFutureMayStart(dependencies, timing);
    const group = { period: selection.period, leagues: gameReady.map((value) => value.league) };
    persisted = await persistProviderGroup(
      dependencies,
      group,
      games,
      stored.slate,
      {
        kind: 'stored',
        observationId: stored.observationId,
        contentId: stored.contentId,
      },
    );
    assertFutureWithinDeadline(dependencies, timing);
    logFuture(dependencies, 'info', {
      stage: 'future-provider-persist',
      outcome: 'completed',
      runId,
      futureAction: selection.kind,
      weekDistance: selection.weekDistance,
      period: selection.period,
      providerGroup: futureProviderGroup(selection.period),
      stageDurationMs: Math.max(
        0,
        dependencies.clock.monotonicNow() - providerPersistStartedAt,
      ),
      projectionRows: stored.slate.coverage.playerRows + stored.slate.coverage.defenseRows,
      matchedProjectionRows: stored.slate.coverage.matchedPlayers
        + stored.slate.coverage.usableDefenses,
      gameCount: games.games.length,
      identityConflictCount: persisted.identityConflictCount,
    });
  } catch (error) {
    const failureCode = error instanceof FutureWorkError
      ? error.failureCode
      : 'unexpected';
    await failClaims(dependencies, selection, gameReady, timing, failureCode);
    logFuture(dependencies, 'warn', {
      stage: 'future-provider-persist',
      outcome: 'failed',
      runId,
      futureAction: selection.kind,
      weekDistance: selection.weekDistance,
      period: selection.period,
      providerGroup: futureProviderGroup(selection.period),
      stageDurationMs: Math.max(
        0,
        dependencies.clock.monotonicNow() - providerPersistStartedAt,
      ),
      failureCode,
    });
    return {
      status: 'failed',
      failureCode,
      failedLeagues: failedLeagues + gameReady.length,
    };
  }

  const scoringCache = createProviderGroupScoringCache(
    stored.slate,
    dependencies.normalizeScoringProfile,
  );
  const outcomes = await mapFutureWithConcurrency(
    gameReady,
    LEAGUE_CONCURRENCY,
    async (value) => {
      const leagueStartedAt = dependencies.clock.monotonicNow();
      try {
        if (!futureMayStart(dependencies, timing)) {
          throw new FutureWorkError('deadline-exceeded');
        }
        const result = await processLeague(
          dependencies,
          value.league,
          persisted,
          calculatedAt,
          scoringCache,
          { publicationFence: value.publicationFence, actualLineup: value.source.lineup },
        );
        assertFutureWithinDeadline(dependencies, timing);
        const completedAt = futureTimestamp(dependencies, timing);
        const completed = await dependencies.lineupRepository.completeFutureMaterializationAndAcknowledgeLineup({
          leagueKey: value.state.leagueKey,
          projectionSource: dependencies.projectionStorage.source,
          normalizerVersion: dependencies.projectionStorage.normalizerVersion,
          modelVersion: LIVE_PROJECTION_MODEL_VERSION,
          period: selection.period,
          attemptId: value.attemptId,
          completedAt,
          nextRefreshAt: nextFutureRefreshAt(
            completedAt,
            'materialization',
            value.refresh.weekDistance,
            value.refresh,
          ),
          target: value.target,
          sourceRevision: result.sourceRevision,
          actualLineup: value.source.lineup,
          slate: currentLineage,
          snapshotRevision: result.snapshotRevision,
          runId,
        });
        if (completed.kind !== 'updated') {
          throw new FutureWorkError('snapshot-publication-failed');
        }
        logFuture(dependencies, 'info', {
          stage: 'future-league-publish',
          outcome: 'completed',
          runId,
          futureAction: selection.kind,
          weekDistance: value.refresh.weekDistance,
          leagueKey: value.configuration.key,
          period: selection.period,
          providerGroup: futureProviderGroup(selection.period),
          stageDurationMs: Math.max(
            0,
            dependencies.clock.monotonicNow() - leagueStartedAt,
          ),
          starterCount: result.starterCount,
          candidateCount: result.candidateCount,
          frozenBaselineCount: result.frozenBaselineCount,
          missingBaselineCount: result.missingBaselineCount,
          ...(result.applicableSourceSkewSeconds === null
            ? {}
            : { applicableSourceSkewSeconds: result.applicableSourceSkewSeconds }),
          identityConflictCount: persisted.identityConflictCount,
          snapshotRevision: result.snapshotRevision,
          publicationOutcome: result.publicationOutcome,
        });
        return { status: 'completed' as const, publicationOutcome: result.publicationOutcome };
      } catch (error) {
        const failureCode = error instanceof FutureWorkError
          ? error.failureCode
          : 'snapshot-rejected';
        await failClaim(dependencies, selection, value, timing, failureCode);
        logFuture(dependencies, 'warn', {
          stage: 'future-league-publish',
          outcome: 'failed',
          runId,
          futureAction: selection.kind,
          weekDistance: value.refresh.weekDistance,
          leagueKey: value.configuration.key,
          period: selection.period,
          providerGroup: futureProviderGroup(selection.period),
          stageDurationMs: Math.max(
            0,
            dependencies.clock.monotonicNow() - leagueStartedAt,
          ),
          publicationOutcome: 'rejected',
          totalDurationMs: futureElapsedMs(dependencies, timing),
          failureCode,
        });
        return { status: 'failed' as const, failureCode };
      }
    },
  );
  const publishedLeagues = outcomes.filter((outcome) => outcome.status === 'completed').length;
  const stageFailures = outcomes.length - publishedLeagues;
  failedLeagues += stageFailures;
  if (publishedLeagues === 0) {
    return {
      status: 'failed',
      failureCode: outcomes.some((outcome) => (
        outcome.status === 'failed' && outcome.failureCode === 'deadline-exceeded'
      )) ? 'deadline-exceeded' : 'snapshot-rejected',
      failedLeagues,
    };
  }
  return {
    status: 'completed',
    publishedLeagues,
    unchangedLeagues: outcomes.filter((outcome) => (
      outcome.status === 'completed' && outcome.publicationOutcome === 'unchanged'
    )).length,
    failedLeagues,
    providerGroups: 1,
  };
}
