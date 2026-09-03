import { LINEUP_AUTHORITY_MAX_AGE_MS } from '../domain/period-classification';
import { synchronizeLineupWatches } from './lineup-watch-context';
import { LINEUP_OBSERVATION_CONCURRENCY, observeLineupClaims } from './lineup-observation-stage';
import { FUTURE_LINEUP_CATCHUP_LIMIT, LINEUP_MATCHUP_REQUEST_LIMIT, LINEUP_CADENCE_POLICY_VERSION } from './lineup-watch-policy';
import { emptyLineupObservationCounts, type LineupObservationSyncResult, type LineupObservationWorkerDependencies } from './lineup-contracts';

export const LINEUP_OBSERVATION_JOB_KEY = 'lineup-observation-sync';
export const LINEUP_OBSERVATION_START_DEADLINE_MS = 30_000;
export const LINEUP_OBSERVATION_DEADLINE_MS = 44_000;
const OBSERVATION_LEASE_SECONDS = 55;

/** Independent thin observer: durable authority only, no live calendar, scoring or projection provider. */
export async function runLineupObservation(
  dependencies: LineupObservationWorkerDependencies,
): Promise<LineupObservationSyncResult> {
  if (!dependencies.lineupRepository.enabled) return { status: 'unavailable' };
  const startedAt = dependencies.clock.monotonicNow();
  const runId = dependencies.idGenerator.generate();
  const elapsed = () => Math.max(0, dependencies.clock.monotonicNow() - startedAt);
  const controller = new AbortController();
  let expire: (() => void) | undefined;
  const expired = new Promise<never>((_resolve, reject) => {
    expire = () => { controller.abort(); reject(new Error('Lineup deadline exceeded.')); };
  });
  const timer = setTimeout(() => expire?.(), LINEUP_OBSERVATION_DEADLINE_MS);
  timer.unref?.();
  const counts = emptyLineupObservationCounts();
  let ownsJob = false;
  let runOutcome: 'completed' | 'skipped' | 'failed' = 'failed';
  const execute = async (): Promise<LineupObservationSyncResult> => {
    const scoped = { ...dependencies, ...dependencies.persistence.scope(controller.signal) };
    const configurations = await scoped.leagueRegistry.listActiveLeagues();
    if (configurations.length === 0) return { status: 'skipped', reason: 'idle' };
    const now = scoped.clock.now();
    const claim = await scoped.repository.acquireJob({ jobKey: LINEUP_OBSERVATION_JOB_KEY,
      jobType: 'lineup-observation', scheduledFor: new Date(Math.floor(now.getTime() / 60_000) * 60_000).toISOString(),
      payload: {}, workerId: runId, leaseSeconds: 120 });
    if (claim.kind === 'disabled') return { status: 'unavailable' };
    if (claim.kind !== 'acquired') return { status: 'skipped', reason: 'busy' };
    ownsJob = true;
    const results = await scoped.periodAuthorityReader.readAuthorities(
      configurations.map((configuration) => configuration.key), now, LINEUP_AUTHORITY_MAX_AGE_MS,
    );
    const context = await synchronizeLineupWatches(scoped.lineupRepository, configurations, results, scoped.clock.now());
    if (context.kind !== 'stored') {
      try { scoped.logger.write('warn', { stage: 'lineup-watch-capacity', outcome: 'skipped', runId,
        capacityStatus: context.kind === 'capacity-exceeded' ? 'capacity-exceeded' : undefined }); } catch { /* Logging is noncritical. */ }
      await scoped.repository.failJob(LINEUP_OBSERVATION_JOB_KEY, runId, 'lineup-authority-unavailable');
      ownsJob = false;
      return { status: 'unavailable' };
    }
    const healthyKeys = context.authorities.map((authority) => authority.configuration.key);
    if (healthyKeys.length === 0 && context.skippedLeagueKeys.length > 0) {
      await scoped.repository.failJob(LINEUP_OBSERVATION_JOB_KEY, runId, 'lineup-authority-unavailable');
      ownsJob = false;
      return { status: 'unavailable' };
    }
    const periodAnchorWeeks = new Map(context.authorities.map((authority) => [authority.configuration.key,
      (authority.authority.activeScoringPeriod ?? authority.authority.defaultDisplayPeriod).week]));
    counts.skipped += context.skippedLeagueKeys.length;
    const active = context.states.filter((state) => state.retiredAt === null && state.watchClass !== 'completed');
    const eligible = active.filter((state) => state.materializationLane === 'future');
    // Active current work runs in the separate current lane and reserves its share of the fixed request budget.
    const reserved = Math.max(0, context.capacity.currentTargets
      - active.filter((state) => state.watchClass === 'current' && state.materializationLane === 'future').length);
    let requestsRemaining = Math.max(0, LINEUP_MATCHUP_REQUEST_LIMIT - reserved);
    let futureRemaining = FUTURE_LINEUP_CATCHUP_LIMIT;
    let claimedCount = 0;
    while (requestsRemaining > 0 && eligible.length > 0 && elapsed() < LINEUP_OBSERVATION_START_DEADLINE_MS) {
      if (controller.signal.aborted) break;
      const states = await scoped.lineupRepository.claimDueLineupObservations({ leagueKeys: healthyKeys,
        materializationLane: 'future', workerId: runId, leaseSeconds: OBSERVATION_LEASE_SECONDS,
        limit: Math.min(LINEUP_OBSERVATION_CONCURRENCY, requestsRemaining), futureLimit: futureRemaining, catchUp: true });
      if (states.length === 0) break;
      if (controller.signal.aborted) break;
      requestsRemaining -= states.length;
      futureRemaining -= states.filter((state) => state.watchClass === 'future').length;
      claimedCount += states.length;
      const batch = await observeLineupClaims(scoped, states, runId, { signal: controller.signal, periodAnchorWeeks });
      for (const key of ['checked', 'changed', 'unchanged', 'notReady', 'skipped', 'failed'] as const) counts[key] += batch[key];
    }
    if (elapsed() >= LINEUP_OBSERVATION_START_DEADLINE_MS) counts.skipped += Math.max(0, eligible.length - claimedCount);
    if (controller.signal.aborted) throw new Error('Lineup deadline exceeded.');
    counts.pending = (await scoped.lineupRepository.readPendingFutureLineups(healthyKeys)).length;
    const completed = await scoped.repository.completeJob(LINEUP_OBSERVATION_JOB_KEY, runId);
    if (!completed) throw new Error('Lineup observation lease lost.');
    ownsJob = false;
    if (counts.checked === 0 && counts.failed === 0 && counts.skipped === 0) return { status: 'skipped', reason: 'idle' };
    return { status: counts.failed > 0 ? 'partial' : 'completed', ...counts };
  };
  try {
    const result = await Promise.race([execute(), expired]);
    runOutcome = result.status === 'completed' ? 'completed' : result.status === 'skipped' ? 'skipped' : 'failed';
    return result;
  } catch {
    // Scoped operations have been cancelled before cleanup uses the independent root connection.
    controller.abort();
    if (ownsJob) {
      const cleanup = new AbortController();
      let stopCleanup: (() => void) | undefined;
      const cleanupExpired = new Promise<void>((resolve) => { stopCleanup = resolve; });
      const cleanupTimer = setTimeout(() => { cleanup.abort(); stopCleanup?.(); }, 4_000);
      cleanupTimer.unref?.();
      try { await Promise.race([dependencies.persistence.scope(cleanup.signal).repository.failJob(
        LINEUP_OBSERVATION_JOB_KEY, runId, 'lineup-observation-failed',
      ), cleanupExpired]); } catch { /* The database lease remains the retry boundary. */ }
      finally { clearTimeout(cleanupTimer); }
    }
    return { status: 'failed' };
  } finally {
    clearTimeout(timer);
    try { dependencies.logger.write(runOutcome === 'failed' ? 'warn' : 'info', {
      stage: 'lineup-observation-run', outcome: runOutcome, runId, lane: 'lineup-observation',
      cadencePolicyVersion: LINEUP_CADENCE_POLICY_VERSION, lineupRevisionVersion: 'lineup-v1',
      totalDurationMs: elapsed(), ...counts }); } catch { /* Logging is noncritical. */ }
  }
}
