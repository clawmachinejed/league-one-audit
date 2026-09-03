import type {
  GameStateSlate,
  LeagueConfiguration,
  LeagueWeekState,
} from '../domain/contracts';
import type {
  FutureMaterializationRefreshState,
  FutureProjectionSlateLineage,
  FutureRefreshAttemptId,
  FutureRefreshFailureCode,
  FutureRefreshPlanPeriod,
} from '../ports/future-refresh-repository';
import type { StoredProjectionSlate } from '../ports/projection-repository';
import { sameExternalReference } from '../shared/provider-identity';
import {
  LIVE_PROJECTION_MODEL_VERSION,
  type LiveProjectionWorkerDependencies,
  type LoadedLeague,
  type PersistedGroup,
} from './contracts';
import { assertCompleteGameCoverage } from './game-context';
import { processLeague } from './league-stage';
import { persistProviderGroup } from './provider-stage';
import { createProviderGroupScoringCache } from './scoring-cache';
import type { FutureWorkSelection } from './future-work-policy';
import {
  FUTURE_ATTEMPT_LEASE_SECONDS,
  FutureWorkError,
  assertFutureMayStart,
  assertFutureWithinDeadline,
  futureElapsedMs,
  futureMayStart,
  futureProviderGroup,
  futureTimestamp,
  logFuture,
  mapFutureWithConcurrency,
  nextFutureRefreshAt,
  sameFuturePeriod,
  type FutureWorkTiming,
} from './future-work-runtime';

const LEAGUE_CONCURRENCY = 8;

type ClaimedMaterialization = Readonly<{
  state: FutureMaterializationRefreshState;
  attemptId: FutureRefreshAttemptId;
  configuration: LeagueConfiguration;
}>;

type ReadyMaterialization = ClaimedMaterialization & Readonly<{
  source: LeagueWeekState;
  league: LoadedLeague;
}>;

export type FutureMaterializationStageResult =
  | Readonly<{
      status: 'completed';
      publishedLeagues: number;
      unchangedLeagues: number;
      failedLeagues: number;
      providerGroups: 1;
    }>
  | Readonly<{ status: 'skipped' }>
  | Readonly<{
      status: 'failed';
      failureCode: FutureRefreshFailureCode;
      failedLeagues: number;
    }>;

function sameConfiguration(expected: LeagueConfiguration, actual: LeagueConfiguration): boolean {
  return expected.key === actual.key
    && sameExternalReference(expected.leagueRef, actual.leagueRef);
}

function sameLineage(
  expected: FutureProjectionSlateLineage,
  actual: Readonly<{ observationId: string; contentId: string }>,
): boolean {
  return String(expected.observationId) === String(actual.observationId)
    && String(expected.contentId) === String(actual.contentId);
}

async function failClaim(
  dependencies: LiveProjectionWorkerDependencies,
  selection: FutureWorkSelection,
  claimed: ClaimedMaterialization,
  timing: FutureWorkTiming,
  failureCode: FutureRefreshFailureCode,
): Promise<void> {
  await dependencies.repository.failFutureMaterializationRefresh({
    leagueKey: claimed.state.leagueKey,
    projectionSource: dependencies.projectionStorage.source,
    normalizerVersion: dependencies.projectionStorage.normalizerVersion,
    modelVersion: LIVE_PROJECTION_MODEL_VERSION,
    period: selection.period,
    attemptId: claimed.attemptId,
    failedAt: futureTimestamp(dependencies, timing),
    failureCode,
  }).catch(() => ({ kind: 'stale' as const }));
}

async function failClaims(
  dependencies: LiveProjectionWorkerDependencies,
  selection: FutureWorkSelection,
  claimed: readonly ClaimedMaterialization[],
  timing: FutureWorkTiming,
  failureCode: FutureRefreshFailureCode,
): Promise<void> {
  await mapFutureWithConcurrency(
    claimed,
    LEAGUE_CONCURRENCY,
    (value) => failClaim(dependencies, selection, value, timing, failureCode),
  );
}

function dueMaterializations(
  plan: FutureRefreshPlanPeriod,
): FutureMaterializationRefreshState[] {
  return plan.materializations.filter((state) => state.due);
}

export async function runFutureMaterializationStage(
  dependencies: LiveProjectionWorkerDependencies,
  configurations: readonly LeagueConfiguration[],
  selection: FutureWorkSelection,
  plan: FutureRefreshPlanPeriod,
  runId: string,
  calculatedAt: string,
  timing: FutureWorkTiming,
): Promise<FutureMaterializationStageResult> {
  const currentLineage = plan.projection.currentSlate;
  if (!currentLineage) {
    return {
      status: 'failed',
      failureCode: 'projection-slate-unavailable',
      failedLeagues: 0,
    };
  }

  const configurationByKey = new Map(configurations.map((configuration) => [
    configuration.key,
    configuration,
  ]));
  const due = dueMaterializations(plan);
  const claimed: ClaimedMaterialization[] = [];
  let claimFailures = 0;
  const claimStartedAt = dependencies.clock.monotonicNow();
  for (const state of due) {
    if (!futureMayStart(dependencies, timing)) break;
    const configuration = configurationByKey.get(state.leagueKey);
    if (!configuration) {
      claimFailures += 1;
      continue;
    }
    try {
      const claim = await dependencies.repository.beginFutureMaterializationRefresh({
        leagueKey: state.leagueKey,
        projectionSource: dependencies.projectionStorage.source,
        normalizerVersion: dependencies.projectionStorage.normalizerVersion,
        modelVersion: LIVE_PROJECTION_MODEL_VERSION,
        period: selection.period,
        attemptId: runId as FutureRefreshAttemptId,
        attemptedAt: futureTimestamp(dependencies, timing),
        leaseSeconds: FUTURE_ATTEMPT_LEASE_SECONDS,
      });
      if (claim.kind === 'acquired') {
        claimed.push({ state, attemptId: claim.attemptId, configuration });
      } else if (claim.kind !== 'backed-off') {
        claimFailures += 1;
      }
    } catch {
      claimFailures += 1;
    }
  }
  if (claimed.length === 0) {
    if (!futureMayStart(dependencies, timing)) {
      return { status: 'failed', failureCode: 'deadline-exceeded', failedLeagues: claimFailures };
    }
    return claimFailures > 0
      ? { status: 'failed', failureCode: 'unexpected', failedLeagues: claimFailures }
      : { status: 'skipped' };
  }
  logFuture(dependencies, 'info', {
    stage: 'future-materialization-claim',
    outcome: 'completed',
    runId,
    futureAction: selection.kind,
    weekDistance: selection.weekDistance,
    period: selection.period,
    providerGroup: futureProviderGroup(selection.period),
    stageDurationMs: Math.max(0, dependencies.clock.monotonicNow() - claimStartedAt),
    eligibleLeagues: due.length,
    loadedLeagues: claimed.length,
    failedLeagues: claimFailures,
  });

  let stored: StoredProjectionSlate;
  try {
    assertFutureMayStart(dependencies, timing);
    const candidate = await dependencies.repository.readCurrentProjectionSlate(
      dependencies.projectionStorage.source,
      selection.period,
    );
    assertFutureWithinDeadline(dependencies, timing);
    if (!candidate || !sameLineage(currentLineage, candidate)) {
      throw new FutureWorkError('projection-slate-unavailable');
    }
    stored = candidate;
  } catch (error) {
    const failureCode = error instanceof FutureWorkError
      ? error.failureCode
      : 'projection-slate-unavailable';
    await failClaims(dependencies, selection, claimed, timing, failureCode);
    return { status: 'failed', failureCode, failedLeagues: claimed.length };
  }

  const leagueLoadStartedAt = dependencies.clock.monotonicNow();
  const loaded = await mapFutureWithConcurrency(
    claimed,
    LEAGUE_CONCURRENCY,
    async (value): Promise<Readonly<{
      claimed: ClaimedMaterialization;
      ready: ReadyMaterialization | null;
      failureCode: FutureRefreshFailureCode | null;
    }>> => {
      if (!futureMayStart(dependencies, timing)) {
        return { claimed: value, ready: null, failureCode: 'deadline-exceeded' };
      }
      try {
        const source = await dependencies.leagueSource.getLeagueWeek(
          value.configuration,
          selection.period,
        );
        assertFutureWithinDeadline(dependencies, timing);
        if (!sameConfiguration(value.configuration, source.configuration)) {
          return { claimed: value, ready: null, failureCode: 'league-source-unavailable' };
        }
        if (!sameFuturePeriod(source.period, selection.period)) {
          return { claimed: value, ready: null, failureCode: 'league-period-mismatch' };
        }
        if (!dependencies.projectionFeed.assessProjectionSlate(stored.slate, source.schedule).complete) {
          return { claimed: value, ready: null, failureCode: 'projection-slate-incomplete' };
        }
        return {
          claimed: value,
          ready: {
            ...value,
            source,
            league: { configuration: value.configuration, source, cadence: 'hourly' },
          },
          failureCode: null,
        };
      } catch (error) {
        return {
          claimed: value,
          ready: null,
          failureCode: error instanceof FutureWorkError
            ? error.failureCode
            : 'league-source-unavailable',
        };
      }
    },
  );

  let failedLeagues = claimFailures;
  for (const outcome of loaded) {
    if (!outcome.failureCode) continue;
    failedLeagues += 1;
    await failClaim(
      dependencies,
      selection,
      outcome.claimed,
      timing,
      outcome.failureCode,
    );
  }
  const ready = loaded.flatMap((outcome) => outcome.ready ? [outcome.ready] : []);
  logFuture(dependencies, ready.length > 0 ? 'info' : 'warn', {
    stage: 'future-league-load',
    outcome: ready.length > 0 ? 'completed' : 'failed',
    runId,
    futureAction: selection.kind,
    weekDistance: selection.weekDistance,
    period: selection.period,
    providerGroup: futureProviderGroup(selection.period),
    stageDurationMs: Math.max(0, dependencies.clock.monotonicNow() - leagueLoadStartedAt),
    loadedLeagues: ready.length,
    eligibleLeagues: claimed.length,
    failedLeagues,
  });
  if (ready.length === 0) {
    const failureCodes = loaded.flatMap((outcome) => (
      outcome.failureCode ? [outcome.failureCode] : []
    ));
    return {
      status: 'failed',
      failureCode: failureCodes.includes('deadline-exceeded')
        ? 'deadline-exceeded' : failureCodes[0] ?? 'unexpected',
      failedLeagues,
    };
  }

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
        );
        assertFutureWithinDeadline(dependencies, timing);
        const completedAt = futureTimestamp(dependencies, timing);
        const completed = await dependencies.repository.completeFutureMaterializationRefresh({
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
            selection.weekDistance,
          ),
          sourceRevision: value.source.sourceRevision,
          slate: currentLineage,
          snapshotRevision: result.snapshotRevision,
        });
        if (completed.kind !== 'updated') {
          throw new FutureWorkError('snapshot-publication-failed');
        }
        logFuture(dependencies, 'info', {
          stage: 'future-league-publish',
          outcome: 'completed',
          runId,
          futureAction: selection.kind,
          weekDistance: selection.weekDistance,
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
          weekDistance: selection.weekDistance,
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
