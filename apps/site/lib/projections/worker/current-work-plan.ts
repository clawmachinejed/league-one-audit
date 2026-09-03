import type { Cadence, LeagueCadenceState } from '../domain/contracts';
import type { LineupWatchState } from '../ports/lineup-watch-repository';
import type { LiveProjectionWorkerDependencies } from './contracts';
import { allowsHourlyFallback, hourBoundary, workerCadence } from './cadence';
import { safeProjectionLog } from './worker-operations';

export type CurrentWorkTarget = Readonly<{
  state: LineupWatchState;
  cadence: Cadence;
  hourlyMarker: string | null;
}>;

/** Called only while this run owns the sole live-projection-sync execution lease. */
export async function planCurrentWork(
  dependencies: LiveProjectionWorkerDependencies,
  states: readonly LineupWatchState[],
  cadenceByKey: ReadonlyMap<string, LeagueCadenceState>,
  now: Date,
  runId: string,
  force: boolean,
) {
  const full: CurrentWorkTarget[] = [];
  const thin: LineupWatchState[] = [];
  let skipped = 0;
  try {
    for (const state of states) {
      if (state.materializationLane !== 'current' || state.watchClass !== 'current' || state.retiredAt !== null) continue;
      if (!force && state.consecutiveFailures > 0 && state.nextCheckAt !== null
        && Date.parse(state.nextCheckAt) > now.getTime()) { skipped += 1; continue; }
      const input = cadenceByKey.get(state.configuration.key);
      if (!input || input.period.season !== state.period.season || input.period.week !== state.period.week
        || input.period.seasonType !== state.period.seasonType) { skipped += 1; continue; }
      const routine = workerCadence(input.schedule, now, false, allowsHourlyFallback(input, now));
      let hourlyMarker: string | null = null;
      let hourlyDue = false;
      if (routine === 'hourly') {
        const marker = `current-projection-hourly:${state.configuration.key}:${state.period.season}:${state.period.seasonType}:${state.period.week}`;
        const result = await dependencies.repository.acquireJob({ jobKey: marker, jobType: 'current-projection-hourly-marker',
          scheduledFor: hourBoundary(now), payload: { leagueKey: state.configuration.key, period: state.period },
          workerId: runId, leaseSeconds: 120 });
        if (result.kind === 'busy' || result.kind === 'disabled') { skipped += 1; continue; }
        hourlyDue = result.kind === 'acquired';
        if (hourlyDue) hourlyMarker = marker;
      }
      if (force || state.pendingSince !== null || routine === 'live-window' || hourlyDue) {
        full.push({ state, cadence: force ? 'forced' : routine === 'idle' ? 'live-window' : routine, hourlyMarker });
      } else {
        thin.push(state);
      }
    }
  } catch (error) {
    await settleCurrentHourlyMarkers(dependencies, full, new Set(), runId).catch(() => undefined);
    throw error;
  }
  safeProjectionLog(dependencies, 'info', { stage: 'current-lineup-plan', outcome: 'completed', runId,
    loadedLeagues: states.length, eligibleLeagues: full.length, skippedLeagues: skipped });
  return { full, thin, skipped };
}

export async function settleCurrentHourlyMarkers(
  dependencies: LiveProjectionWorkerDependencies, targets: readonly CurrentWorkTarget[],
  publishedKeys: ReadonlySet<string>, runId: string,
): Promise<void> {
  let lost = false;
  for (const target of targets) {
    if (!target.hourlyMarker) continue;
    const settled = await (publishedKeys.has(target.state.configuration.key)
      ? dependencies.repository.completeJob(target.hourlyMarker, runId)
      : dependencies.repository.failJob(target.hourlyMarker, runId, 'current-materialization-failed')).catch(() => false);
    if (!settled) lost = true;
  }
  if (lost) throw new Error('Hourly completion marker ownership was lost.');
}
