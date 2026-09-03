import 'server-only';

import type { ProjectionSyncCadence } from '../../projection-window';
import { assessTank01ProjectionSlate } from '../../projection-slate';
import type { ProjectionCadenceInput } from '../../sleeper';
import {
  LIVE_PROJECTION_MODEL_VERSION,
  type LiveProjectionSyncResult,
  type LiveProjectionWorkerDependencies,
  type LoadedLeague,
  type PersistedGroup,
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
import { groupLeagues, persistProviderGroup } from './provider-stage';

const JOB_LEASE_SECONDS = 120;
const LEAGUE_LOAD_CONCURRENCY = 8;
const PROVIDER_GROUP_CONCURRENCY = 4;
const LEAGUE_PROCESS_CONCURRENCY = 8;

function projectionLog(level: 'info' | 'warn' | 'error', context: ProjectionLogContext): void {
  const entry = JSON.stringify({ service: 'live-projection-sync', ...context });
  if (level === 'error') console.error(entry);
  else if (level === 'warn') console.warn(entry);
  else console.info(entry);
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

export async function runWithDependencies(
  dependencies: LiveProjectionWorkerDependencies,
  options: Readonly<{ force?: boolean }> = {},
): Promise<LiveProjectionSyncResult> {
  if (!dependencies.store.enabled) return { status: 'disabled' };
  const now = dependencies.now();
  if (!Number.isFinite(now.getTime())) return { status: 'failed' };
  const workerId = dependencies.workerId();
  const jobKey = 'live-projection-sync';
  let stage = 'preflight';
  let acquired = false;
  try {
    let cadenceInput: ProjectionCadenceInput | null = null;
    let preflightCadence: ProjectionSyncCadence | null = null;
    let staleFallback: Readonly<{
      input: ProjectionCadenceInput;
      cadence: ProjectionSyncCadence;
    }> | null = null;
    for (const configuration of dependencies.leagues) {
      try {
        const candidate = await dependencies.getProjectionCadenceInput(configuration.sleeperLeagueId);
        if (candidate.sleeperLeagueId !== configuration.sleeperLeagueId) continue;
        const candidateCadence = workerCadence(
          candidate.schedule,
          now,
          options.force === true,
          allowsHourlyFallback(candidate, now),
        );
        if (isCurrentNflPeriod(candidate)) {
          // Sleeper's NFL state is global. Once a league points at that same
          // season/week, its complete NFL schedule is a sufficient cheap cadence
          // source for every configured league, including an idle result.
          cadenceInput = candidate;
          preflightCadence = candidateCadence;
          break;
        }
        // A league can temporarily point at an old season or week during annual
        // rollover. Keep it only as a fallback and inspect later configured leagues
        // before deciding that the globally current slate is idle.
        staleFallback ??= { input: candidate, cadence: candidateCadence };
      } catch {
        // Try the next configured league. Normally only the first current-period
        // seed request runs; this fallback keeps one unhealthy league isolated.
        projectionLog('warn', { stage: 'preflight', outcome: 'failed', leagueKey: configuration.key });
      }
    }
    if (!cadenceInput && staleFallback && options.force !== true) {
      cadenceInput = staleFallback.input;
      preflightCadence = staleFallback.cadence;
    }
    if (!cadenceInput || !preflightCadence) {
      throw new Error('No projection cadence source could be loaded.');
    }
    if (preflightCadence === 'idle') {
      projectionLog('info', { stage: 'preflight', outcome: 'skipped' });
      return { status: 'skipped', reason: 'idle', cadence: 'idle' };
    }

    stage = 'lease';
    const scheduledFor = options.force
      ? now.toISOString()
      : preflightCadence === 'hourly' ? hourBoundary(now) : minuteBoundary(now);
    const claim = await dependencies.store.acquireJob({
      jobKey,
      jobType: 'live-projection-sync',
      scheduledFor,
      payload: { modelVersion: LIVE_PROJECTION_MODEL_VERSION, forced: options.force === true },
      workerId,
      leaseSeconds: JOB_LEASE_SECONDS,
    });
    if (claim.kind === 'disabled') return { status: 'disabled' };
    if (claim.kind === 'busy' || claim.kind === 'completed') {
      projectionLog('info', { stage: 'lease', outcome: 'skipped' });
      return { status: 'skipped', reason: claim.kind, cadence: null };
    }
    acquired = true;
    projectionLog('info', { stage: 'lease', outcome: 'started' });

    stage = 'league-load';
    const loadLeague = async (configuration: ProjectionLeagueConfiguration): Promise<LoadedLeague> => {
      const source = await dependencies.getProjectionSyncInput(configuration.sleeperLeagueId);
      if (source.sleeperLeagueId !== configuration.sleeperLeagueId) {
        throw new Error('Sleeper returned data for an unexpected league.');
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
      dependencies.leagues,
      LEAGUE_LOAD_CONCURRENCY,
      async (configuration) => {
        try {
          return { status: 'fulfilled' as const, value: await loadLeague(configuration) };
        } catch {
          projectionLog('warn', { stage: 'league-load', outcome: 'failed', leagueKey: configuration.key });
          return { status: 'rejected' as const };
        }
      },
    );
    const sources = sourceResults.flatMap((result) => result.status === 'fulfilled' ? [result.value] : []);
    let failedLeagues = sourceResults.length - sources.length;
    if (sources.length === 0) throw new Error('No league source could be loaded.');
    const eligibleSources = sources.filter(
      (source) => source.source.data.league.season === cadenceInput.season
        && source.source.data.week === cadenceInput.week,
    );
    for (const source of sources) {
      if (!eligibleSources.includes(source)) {
        failedLeagues += 1;
        projectionLog('info', {
          stage: 'league-load', outcome: 'skipped', leagueKey: source.configuration.key,
          season: source.source.data.league.season, week: source.source.data.week,
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

    stage = 'provider-load';
    const groups = groupLeagues(eligibleSources);
    const providerResults = await mapWithConcurrency(groups, PROVIDER_GROUP_CONCURRENCY, async (group) => {
      try {
        const [projections, games] = await Promise.all([
          dependencies.getWeeklyProjections(group.season, group.week),
          dependencies.getWeeklyGameStates(group.season, group.week),
        ]);
        if (projections.status !== 'available' || games.status !== 'available'
          || projections.season !== group.season || projections.week !== group.week
          || games.season !== group.season || games.week !== group.week) {
          throw new Error('A required Tank01 source is unavailable.');
        }
        if (group.leagues.some(({ source }) => (
          !assessTank01ProjectionSlate(projections, source.schedule).complete
        ))) {
          throw new Error('Tank01 returned an incomplete weekly projection slate.');
        }
        return { status: 'fulfilled' as const, group, projections, games };
      } catch {
        projectionLog('warn', {
          stage: 'provider-load', outcome: 'failed', season: group.season, week: group.week,
        });
        return { status: 'rejected' as const, group };
      }
    });
    const persistedGroups = [] as Array<Readonly<{ group: ProviderGroup; persisted: PersistedGroup }>>;
    for (const provider of providerResults) {
      if (provider.status === 'rejected') {
        failedLeagues += provider.group.leagues.length;
        continue;
      }
      try {
        persistedGroups.push({
          group: provider.group,
          persisted: await persistProviderGroup(
            dependencies,
            provider.group,
            provider.games,
            provider.projections,
          ),
        });
      } catch {
        failedLeagues += provider.group.leagues.length;
        projectionLog('warn', {
          stage: 'provider-persist', outcome: 'failed', season: provider.group.season, week: provider.group.week,
        });
      }
    }

    stage = 'league-publish';
    let publishedLeagues = 0;
    for (const { group, persisted } of persistedGroups) {
      const outcomes = await mapWithConcurrency(
        group.leagues,
        LEAGUE_PROCESS_CONCURRENCY,
        async (league) => {
          try {
            await processLeague(dependencies, league, persisted, now.toISOString());
            return true;
          } catch {
            projectionLog('warn', {
              stage: 'league-publish', outcome: 'failed', leagueKey: league.configuration.key,
              season: group.season, week: group.week,
            });
            return false;
          }
        },
      );
      publishedLeagues += outcomes.filter(Boolean).length;
      failedLeagues += outcomes.filter((published) => !published).length;
    }
    if (publishedLeagues === 0) throw new Error('No complete league snapshot could be published.');
    if (cadence === 'hourly' || cadence === 'forced') {
      await dependencies.store.pruneHistory({
        before: new Date(now.getTime() - (48 * 60 * 60 * 1_000)).toISOString(),
        keepRecentSnapshotsPerLeagueWeek: 3,
      }).catch(() => ({ kind: 'disabled' as const }));
    }
    if (!await dependencies.store.completeJob(jobKey, workerId)) {
      throw new Error('Projection job lease was lost.');
    }
    projectionLog('info', { stage: 'run', outcome: 'completed', publishedLeagues, failedLeagues });
    return {
      status: 'completed', cadence, publishedLeagues, failedLeagues, providerGroups: persistedGroups.length,
    };
  } catch (error) {
    if (acquired) {
      const message = error instanceof Error ? error.message : 'Unknown projection worker failure.';
      await dependencies.store.failJob(jobKey, workerId, message).catch(() => false);
    }
    projectionLog('error', { stage, outcome: 'failed' });
    return { status: 'failed' };
  }
}

