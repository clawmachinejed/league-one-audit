import { lineupFailureRetryDelaysSeconds } from './lineup-watch-policy';
import type { FutureProjectionWorkerDependencies, FutureMaterializationStageResult } from './future-contracts';
import type {
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
import type { LineupWatchState } from '../ports/lineup-watch-repository';
import type { LineupMaterializationTarget, LineupPublicationFence } from '../domain/lineup-publication';
import { sameExternalReference } from '../shared/provider-identity';
import {
  LIVE_PROJECTION_MODEL_VERSION,
  type LoadedLeague,
} from './contracts';
import { completeFutureFullObservation, futureLineupTarget, futurePublicationFence, reserveFutureFullObservation } from './future-lineup-claim';
import type { FutureWorkSelection } from './future-work-policy';
import {
  FUTURE_ATTEMPT_LEASE_SECONDS,
  FutureWorkError,
  assertFutureMayStart,
  assertFutureWithinDeadline,
  futureMayStart,
  futureProviderGroup,
  futureTimestamp,
  logFuture,
  mapFutureWithConcurrency,
  sameFuturePeriod,
  type FutureWorkTiming,
} from './future-work-runtime';

const LEAGUE_CONCURRENCY = 8;

export type ClaimedMaterialization = Readonly<{
  state: FutureMaterializationRefreshState;
  attemptId: FutureRefreshAttemptId;
  configuration: LeagueConfiguration;
  target: LineupMaterializationTarget;
  publicationFence: Extract<LineupPublicationFence, { ownerLane: 'future' }>;
  refresh: FutureWorkSelection['leagueRefresh'][number];
}>;

export type ReadyMaterialization = ClaimedMaterialization & Readonly<{
  source: LeagueWeekState;
  league: LoadedLeague;
}>;

export type PreparedFutureMaterializations =
  | Exclude<FutureMaterializationStageResult, {status:'completed'}>
  | Readonly<{status:'ready';ready:readonly ReadyMaterialization[];stored:StoredProjectionSlate;
      currentLineage:FutureProjectionSlateLineage;failedLeagues:number}>;

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

export async function failClaim(
  dependencies: FutureProjectionWorkerDependencies,
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

export async function failClaims(
  dependencies: FutureProjectionWorkerDependencies,
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
  selection: FutureWorkSelection,
): FutureMaterializationRefreshState[] {
  return plan.materializations.filter((state) => selection.leagueKeys.includes(state.leagueKey)
    && (state.due || selection.cadence === 'forced'));
}

export async function prepareFutureMaterializations(
  dependencies: FutureProjectionWorkerDependencies,
  configurations: readonly LeagueConfiguration[],
  watches: readonly LineupWatchState[],
  selection: FutureWorkSelection,
  plan: FutureRefreshPlanPeriod,
  runId: string,
  timing: FutureWorkTiming,
): Promise<PreparedFutureMaterializations> {
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
  const due = dueMaterializations(plan, selection);
  const claimed: ClaimedMaterialization[] = [];
  let claimFailures = 0;
  const claimStartedAt = dependencies.clock.monotonicNow();
  for (const state of due) {
    if (!futureMayStart(dependencies, timing)) break;
    const configuration = configurationByKey.get(state.leagueKey);
    const watch = watches.find((value) => value.configuration.key === state.leagueKey
      && sameFuturePeriod(value.period, selection.period));
    const refresh = selection.leagueRefresh.find((value) => value.leagueKey === state.leagueKey);
    if (!configuration || !watch || !refresh) {
      claimFailures += 1;
      continue;
    }
    try {
      const target = futureLineupTarget(watch);
      const claim = await dependencies.repository.beginFutureMaterializationRefresh({
        leagueKey: state.leagueKey,
        projectionSource: dependencies.projectionStorage.source,
        normalizerVersion: dependencies.projectionStorage.normalizerVersion,
        modelVersion: LIVE_PROJECTION_MODEL_VERSION,
        period: selection.period,
        attemptId: runId as FutureRefreshAttemptId,
        attemptedAt: futureTimestamp(dependencies, timing),
        leaseSeconds: FUTURE_ATTEMPT_LEASE_SECONDS,
        target,
        ...(selection.cadence === 'forced' ? { force: true as const } : {}),
      });
      if (claim.kind === 'acquired') {
        claimed.push({ state, attemptId: claim.attemptId, configuration, target, refresh,
          publicationFence: futurePublicationFence(dependencies, target, runId, claim.attemptId) });
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
      let reserved: Awaited<ReturnType<typeof reserveFutureFullObservation>> | null = null;
      try {
        reserved = await reserveFutureFullObservation(dependencies, value.publicationFence);
        assertFutureMayStart(dependencies, timing);
        const source = await dependencies.leagueSource.getLeagueWeek(
          value.configuration,
          selection.period,
        );
        assertFutureWithinDeadline(dependencies, timing);
        if (!sameConfiguration(value.configuration, source.configuration)) {
          throw new FutureWorkError('league-source-unavailable');
        }
        if (!sameFuturePeriod(source.period, selection.period)) {
          throw new FutureWorkError('league-period-mismatch');
        }
        await completeFutureFullObservation(dependencies, reserved, source);
        if (!dependencies.projectionFeed.assessProjectionSlate(stored.slate, source.schedule).complete) {
          return { claimed: value, ready: null, failureCode: 'projection-slate-incomplete' };
        }
        return {
          claimed: value,
          ready: {
            ...value,
            source,
            league: { configuration: value.configuration, source, cadence: selection.cadence },
          },
          failureCode: null,
        };
      } catch (error) {
        if (reserved) await dependencies.lineupRepository.failLineupObservation({
          claim: reserved.claim, failureCode: 'source-unavailable',
          retryDelaysSeconds: lineupFailureRetryDelaysSeconds(reserved.state.watchClass),
        }).catch(() => ({ kind: 'stale' as const }));
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

  return { status: 'ready', ready, stored, currentLineage, failedLeagues };
}
