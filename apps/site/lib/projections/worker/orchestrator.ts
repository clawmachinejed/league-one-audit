import type { Cadence, LeagueCadenceState, LeaguePeriod } from '../domain/contracts';
import { sameExternalReference } from '../shared/provider-identity';
import {
  LIVE_PROJECTION_MODEL_VERSION,
  type LiveProjectionSyncResult,
  type LiveProjectionWorkerDependencies,
  type LoadedLeague,
  type ProjectionLeagueConfiguration,
  type ProjectionLogContext,
  type ProviderGroup,
} from './contracts';
import {
  allowsHourlyFallback,
  highestCadence,
  hourBoundary,
  isCurrentNflPeriod,
  minuteBoundary,
  workerCadence,
} from './cadence';
import { processLeague } from './league-stage';
import { groupLeagues, loadProviderGroup, persistProviderGroup } from './provider-stage';

const JOB_LEASE_SECONDS = 120;
const LEAGUE_LOAD_CONCURRENCY = 8;
const PROVIDER_GROUP_CONCURRENCY = 4;
const LEAGUE_PROCESS_CONCURRENCY = 8;

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

async function mapWithConcurrency<Input, Output>(
  values: readonly Input[],
  concurrency: number,
  transform: (value: Input) => Promise<Output>,
): Promise<Output[]> {
  const results = new Array<Output>(values.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(concurrency, values.length) }, async () => {
    while (cursor < values.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await transform(values[index]);
    }
  });
  await Promise.all(workers);
  return results;
}

function sameConfiguration(
  expected: ProjectionLeagueConfiguration,
  actual: ProjectionLeagueConfiguration,
): boolean {
  return expected.key === actual.key
    && sameExternalReference(expected.leagueRef, actual.leagueRef);
}

function samePeriod(left: LeaguePeriod, right: LeaguePeriod): boolean {
  return left.season === right.season
    && left.seasonType === right.seasonType
    && left.week === right.week;
}

function providerGroupName(group: ProviderGroup): string {
  return `${group.period.season}:${group.period.seasonType}:${group.period.week}`;
}

function elapsed(
  dependencies: Pick<LiveProjectionWorkerDependencies, 'clock'>,
  startedAt: number,
): number {
  return Math.max(0, dependencies.clock.monotonicNow() - startedAt);
}

/** Provider-neutral application orchestration for the single production pipeline. */
export async function runWithDependencies(
  dependencies: LiveProjectionWorkerDependencies,
  options: Readonly<{ force?: boolean }> = {},
): Promise<LiveProjectionSyncResult> {
  if (!dependencies.repository.enabled) return { status: 'disabled' };

  const now = dependencies.clock.now();
  if (!Number.isFinite(now.getTime())) return { status: 'failed' };

  const runId = dependencies.idGenerator.generate();
  const calculatedAt = now.toISOString();
  const runStartedAt = dependencies.clock.monotonicNow();
  const jobKey = 'live-projection-sync';
  let stage = 'preflight';
  let acquired = false;

  try {
    const configurations = dependencies.leagueRegistry.listActiveLeagues();
    let cadenceInput: LeagueCadenceState | null = null;
    let preflightCadence: Cadence | null = null;
    let staleFallback: Readonly<{
      input: LeagueCadenceState;
      cadence: Cadence;
    }> | null = null;
    const periodAuthorities: LeagueCadenceState['periodAuthority'][] = [];

    for (const configuration of configurations) {
      try {
        const candidate = await dependencies.nflCalendar.getCadenceState(configuration);
        if (!sameConfiguration(configuration, candidate.configuration)) {
          log(dependencies, 'warn', {
            stage: 'preflight', outcome: 'failed', runId,
            leagueKey: configuration.key,
            failureCode: 'cadence-source-unavailable',
          });
          continue;
        }
        periodAuthorities.push(candidate.periodAuthority);
        const candidateCadence = workerCadence(
          candidate.schedule,
          now,
          options.force === true,
          allowsHourlyFallback(candidate, now),
        );
        if (!cadenceInput && isCurrentNflPeriod(candidate)) {
          cadenceInput = candidate;
          preflightCadence = candidateCadence;
        }
        staleFallback ??= { input: candidate, cadence: candidateCadence };
      } catch {
        log(dependencies, 'warn', {
          stage: 'preflight', outcome: 'failed', runId,
          leagueKey: configuration.key,
          failureCode: 'cadence-source-unavailable',
        });
      }
    }

    if (!cadenceInput && staleFallback && options.force !== true) {
      cadenceInput = staleFallback.input;
      preflightCadence = staleFallback.cadence;
    }
    if (!cadenceInput || !preflightCadence) {
      throw new Error('No projection cadence source could be loaded.');
    }
    await mapWithConcurrency(periodAuthorities, LEAGUE_LOAD_CONCURRENCY, async (authority) => {
      try {
        const outcome = await dependencies.repository.upsertPeriodAuthority(authority);
        if (outcome.kind === 'conflict') {
          log(dependencies, 'warn', {
            stage: 'period-authority', outcome: 'failed', runId,
            leagueKey: authority.configuration.key,
            period: authority.defaultDisplayPeriod,
            failureCode: 'period-authority-conflict',
          });
        }
      } catch {
        log(dependencies, 'warn', {
          stage: 'period-authority', outcome: 'failed', runId,
          leagueKey: authority.configuration.key,
          period: authority.defaultDisplayPeriod,
          failureCode: 'period-authority-unavailable',
        });
      }
    });
    if (preflightCadence === 'idle') {
      log(dependencies, 'info', {
        stage: 'preflight', outcome: 'skipped', runId,
        cadence: 'idle', period: cadenceInput.period,
        totalDurationMs: elapsed(dependencies, runStartedAt),
      });
      return { status: 'skipped', reason: 'idle', cadence: 'idle' };
    }

    stage = 'lease';
    const scheduledFor = options.force
      ? calculatedAt
      : preflightCadence === 'hourly' ? hourBoundary(now) : minuteBoundary(now);
    const claim = await dependencies.repository.acquireJob({
      jobKey,
      jobType: 'live-projection-sync',
      scheduledFor,
      payload: { modelVersion: LIVE_PROJECTION_MODEL_VERSION, forced: options.force === true },
      workerId: runId,
      leaseSeconds: JOB_LEASE_SECONDS,
    });
    if (claim.kind === 'disabled') return { status: 'disabled' };
    if (claim.kind === 'busy' || claim.kind === 'completed') {
      log(dependencies, 'info', {
        stage: 'lease', outcome: 'skipped', runId,
        leaseOutcome: claim.kind,
        totalDurationMs: elapsed(dependencies, runStartedAt),
      });
      return { status: 'skipped', reason: claim.kind, cadence: null };
    }
    acquired = true;
    log(dependencies, 'info', {
      stage: 'lease', outcome: 'started', runId,
      cadence: preflightCadence, period: cadenceInput.period,
      modelVersion: LIVE_PROJECTION_MODEL_VERSION,
      leaseOutcome: 'acquired',
    });

    stage = 'league-load';
    const leagueLoadStartedAt = dependencies.clock.monotonicNow();
    const loadLeague = async (
      configuration: ProjectionLeagueConfiguration,
    ): Promise<LoadedLeague> => {
      const source = await dependencies.leagueSource.getLeagueWeek(
        configuration,
        cadenceInput.period,
      );
      if (!sameConfiguration(configuration, source.configuration)) {
        throw new Error('The official source returned data for an unexpected league.');
      }
      return {
        configuration,
        source,
        cadence: workerCadence(
          source.schedule,
          now,
          options.force === true,
          preflightCadence === 'hourly',
        ),
      };
    };
    const sourceResults = await mapWithConcurrency(
      configurations,
      LEAGUE_LOAD_CONCURRENCY,
      async (configuration) => {
        try {
          return { status: 'fulfilled' as const, value: await loadLeague(configuration) };
        } catch {
          log(dependencies, 'warn', {
            stage: 'league-load', outcome: 'failed', runId,
            leagueKey: configuration.key,
            failureCode: 'league-source-unavailable',
          });
          return { status: 'rejected' as const };
        }
      },
    );
    const sources = sourceResults.flatMap((result) => (
      result.status === 'fulfilled' ? [result.value] : []
    ));
    let failedLeagues = sourceResults.length - sources.length;
    if (sources.length === 0) throw new Error('No league source could be loaded.');

    const eligibleSources = sources.filter((source) => (
      samePeriod(source.source.period, cadenceInput.period)
    ));
    for (const source of sources) {
      if (!eligibleSources.includes(source)) {
        failedLeagues += 1;
        log(dependencies, 'info', {
          stage: 'league-load', outcome: 'skipped', runId,
          leagueKey: source.configuration.key,
          period: source.source.period,
        });
      }
    }
    if (eligibleSources.length === 0) {
      throw new Error('No league source matched the selected NFL period.');
    }
    const cadence = highestCadence([
      preflightCadence,
      ...eligibleSources.map((source) => source.cadence),
    ]);
    log(dependencies, 'info', {
      stage: 'league-load', outcome: 'completed', runId,
      cadence, period: cadenceInput.period,
      stageDurationMs: elapsed(dependencies, leagueLoadStartedAt),
      loadedLeagues: sources.length,
      eligibleLeagues: eligibleSources.length,
      skippedLeagues: sources.length - eligibleSources.length,
      failedLeagues,
    });

    stage = 'provider-load';
    const groups = groupLeagues(eligibleSources);
    const providerResults = await mapWithConcurrency(
      groups,
      PROVIDER_GROUP_CONCURRENCY,
      async (group) => {
        const providerStartedAt = dependencies.clock.monotonicNow();
        try {
          const loaded = await loadProviderGroup(dependencies, group);
          log(dependencies, 'info', {
            stage: 'provider-load', outcome: 'completed', runId,
            period: group.period,
            providerGroup: providerGroupName(group),
            providerDurationMs: elapsed(dependencies, providerStartedAt),
            providerOutcome: 'available',
            projectionRows: loaded.projections.coverage.playerRows
              + loaded.projections.coverage.defenseRows,
            matchedProjectionRows: loaded.projections.coverage.matchedPlayers
              + loaded.projections.coverage.usableDefenses,
            gameCount: loaded.games.games.length,
          });
          return { status: 'fulfilled' as const, group, loaded };
        } catch {
          log(dependencies, 'warn', {
            stage: 'provider-load', outcome: 'failed', runId,
            period: group.period,
            providerGroup: providerGroupName(group),
            providerDurationMs: elapsed(dependencies, providerStartedAt),
            providerOutcome: 'invalid',
            failureCode: 'projection-provider-unavailable',
          });
          return { status: 'rejected' as const, group };
        }
      },
    );

    const persistedGroups: Array<Readonly<{
      group: ProviderGroup;
      persisted: Awaited<ReturnType<typeof persistProviderGroup>>;
    }>> = [];
    for (const provider of providerResults) {
      if (provider.status === 'rejected') {
        failedLeagues += provider.group.leagues.length;
        continue;
      }
      const providerPersistStartedAt = dependencies.clock.monotonicNow();
      try {
        const persisted = await persistProviderGroup(
          dependencies,
          provider.group,
          provider.loaded.games,
          provider.loaded.projections,
        );
        persistedGroups.push({
          group: provider.group,
          persisted,
        });
        log(dependencies, 'info', {
          stage: 'provider-persist', outcome: 'completed', runId,
          period: provider.group.period,
          providerGroup: providerGroupName(provider.group),
          stageDurationMs: elapsed(dependencies, providerPersistStartedAt),
          identityConflictCount: persisted.identityConflictCount,
        });
      } catch {
        failedLeagues += provider.group.leagues.length;
        log(dependencies, 'warn', {
          stage: 'provider-persist', outcome: 'failed', runId,
          period: provider.group.period,
          providerGroup: providerGroupName(provider.group),
          stageDurationMs: elapsed(dependencies, providerPersistStartedAt),
          failureCode: 'provider-persistence-failed',
        });
      }
    }

    stage = 'league-publish';
    let publishedLeagues = 0;
    let unchangedLeagues = 0;
    for (const { group, persisted } of persistedGroups) {
      const outcomes = await mapWithConcurrency(
        group.leagues,
        LEAGUE_PROCESS_CONCURRENCY,
        async (league) => {
          const leagueStartedAt = dependencies.clock.monotonicNow();
          try {
            const result = await processLeague(dependencies, league, persisted, calculatedAt);
            log(dependencies, 'info', {
              stage: 'league-publish', outcome: 'completed', runId,
              leagueKey: league.configuration.key,
              period: group.period,
              stageDurationMs: elapsed(dependencies, leagueStartedAt),
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
            return { published: true as const, result };
          } catch {
            log(dependencies, 'warn', {
              stage: 'league-publish', outcome: 'failed', runId,
              leagueKey: league.configuration.key,
              period: group.period,
              stageDurationMs: elapsed(dependencies, leagueStartedAt),
              publicationOutcome: 'rejected',
              failureCode: 'snapshot-rejected',
            });
            return { published: false as const };
          }
        },
      );
      publishedLeagues += outcomes.filter((outcome) => outcome.published).length;
      unchangedLeagues += outcomes.filter((outcome) => (
        outcome.published && outcome.result.publicationOutcome === 'unchanged'
      )).length;
      failedLeagues += outcomes.filter((outcome) => !outcome.published).length;
    }
    if (publishedLeagues === 0) {
      throw new Error('No complete league snapshot could be published.');
    }

    if (cadence === 'hourly' || cadence === 'forced') {
      await dependencies.repository.pruneHistory({
        before: new Date(now.getTime() - (48 * 60 * 60 * 1_000)).toISOString(),
        keepRecentSnapshotsPerLeagueWeek: 3,
      }).catch(() => ({ kind: 'disabled' as const }));
    }
    if (!await dependencies.repository.completeJob(jobKey, runId)) {
      log(dependencies, 'error', {
        stage: 'lease', outcome: 'failed', runId,
        cadence, period: cadenceInput.period,
        leaseOutcome: 'lost', failureCode: 'lease-lost',
      });
      throw new Error('Projection job lease was lost.');
    }
    acquired = false;
    log(dependencies, 'info', {
      stage: 'run', outcome: 'completed', runId,
      cadence, period: cadenceInput.period,
      modelVersion: LIVE_PROJECTION_MODEL_VERSION,
      totalDurationMs: elapsed(dependencies, runStartedAt),
      loadedLeagues: sources.length,
      eligibleLeagues: eligibleSources.length,
      publishedLeagues,
      unchangedLeagues,
      skippedLeagues: sources.length - eligibleSources.length,
      failedLeagues,
    });
    return {
      status: 'completed', cadence, publishedLeagues, failedLeagues,
      providerGroups: persistedGroups.length,
    };
  } catch (error) {
    if (acquired) {
      const message = error instanceof Error
        ? error.message
        : 'Unknown projection worker failure.';
      await dependencies.repository.failJob(jobKey, runId, message).catch(() => false);
    }
    log(dependencies, 'error', {
      stage, outcome: 'failed', runId,
      modelVersion: LIVE_PROJECTION_MODEL_VERSION,
      totalDurationMs: elapsed(dependencies, runStartedAt),
      failureCode: stage === 'preflight'
        ? 'cadence-source-unavailable'
        : 'unexpected-worker-failure',
    });
    return { status: 'failed' };
  }
}
