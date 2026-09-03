import type { LiveProjectionWorkerDependencies, LoadedLeague, ProviderGroup } from './contracts';
import type { LineupPublicationFence } from '../domain/lineup-publication';
import { processLeague } from './league-stage';
import { groupLeagues, loadProviderGroup, persistProviderGroup } from './provider-stage';
import { createProviderGroupScoringCache } from './scoring-cache';
import { mapWithConcurrency, safeProjectionLog as log, elapsed } from './worker-operations';
import { LIVE_PROJECTION_MODEL_VERSION } from './contracts';

const PROVIDER_GROUP_CONCURRENCY = 4;
const LEAGUE_PROCESS_CONCURRENCY = 8;
const providerGroupName = (group: ProviderGroup) => `${group.period.season}:${group.period.seasonType}:${group.period.week}`;

export async function runCurrentProjectionStages(
  dependencies: LiveProjectionWorkerDependencies,
  eligibleSources: readonly LoadedLeague[],
  publicationFences: ReadonlyMap<string, LineupPublicationFence>,
  calculatedAt: string,
  runId: string,
) {
  let failedLeagues = 0;
  const publishedLeagueKeys = new Set<string>();

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


  let publishedLeagues = 0;
  let unchangedLeagues = 0;
  for (const { group, persisted } of persistedGroups) {
    const scoringCache = createProviderGroupScoringCache(
      persisted.projections,
      dependencies.normalizeScoringProfile,
    );
    const outcomes = await mapWithConcurrency(
      group.leagues,
      LEAGUE_PROCESS_CONCURRENCY,
      async (league) => {
        const leagueStartedAt = dependencies.clock.monotonicNow();
        try {
          const publicationFence = publicationFences.get(league.configuration.key);
          if (!publicationFence || publicationFence.ownerLane !== 'current') throw new Error('Current publication ownership is missing.');
          const result = await processLeague(
            dependencies,
            league,
            persisted,
            calculatedAt,
            scoringCache,
            { publicationFence, actualLineup: league.source.lineup },
          );
          const acknowledged = await dependencies.lineupRepository.acknowledgeCurrentLineup({
            leagueKey: league.configuration.key, period: league.source.period,
            fence: publicationFence, modelVersion: LIVE_PROJECTION_MODEL_VERSION,
            sourceRevision: league.source.sourceRevision, actualLineup: league.source.lineup,
            snapshotRevision: result.snapshotRevision,
          });
          if (acknowledged.kind !== 'updated') throw new Error('Current lineup acknowledgment was rejected.');
          publishedLeagueKeys.add(league.configuration.key);
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


  return { publishedLeagues, unchangedLeagues, failedLeagues, providerGroups: persistedGroups.length, publishedLeagueKeys };
}
