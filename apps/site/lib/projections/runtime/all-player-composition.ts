import 'server-only';

import { ACTIVE_PROJECTION_SOURCE } from '../../projection-source-config';
import { createProjectionStore, getProjectionStore } from '../../projection-store';
import { getDatabase, withDatabaseAbortSignal } from '../../database';
import { getOperatorProjectionSyncInput } from '../../sleeper';
import { loadCompletePlayerCatalog } from '../../sleeper-player-catalog';
import { createNeonProjectionRepository } from '../adapters/neon/repository';
import { createSleeperAllPlayerStatSource } from '../adapters/sleeper/all-player-stats';
import { translateSleeperLeagueWeek } from '../adapters/sleeper/league-source';
import { normalizeSleeperScoringProfile } from '../adapters/sleeper/scoring-profile';
import type { LeaguePeriod } from '../domain/contracts';
import {
  runAllPlayerIngestion,
  type AllPlayerIngestionDependencies,
  type AllPlayerIngestionMode,
  type AllPlayerIngestionResult,
} from './all-player-operation';
import { createProductionSharedServices, officialProvider } from './shared-services';
import { isAllPlayerPollingOpportunity, selectAllPlayerRecurringPeriod } from './all-player-cadence';

const projectionProvider = ACTIVE_PROJECTION_SOURCE.provider;

export const ALL_PLAYER_RECURRING_ENV = 'ALL_PLAYER_RECURRING_ENABLED';

function diagnosticPeriod(value: unknown): LeaguePeriod | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const period = value as Record<string, unknown>;
  return Number.isInteger(period.season) && Number(period.season) >= 2026 && Number(period.season) <= 2200
    && period.seasonType === 'reg' && Number.isInteger(period.week) && Number(period.week) >= 1 && Number(period.week) <= 18
    ? { season: Number(period.season), seasonType: 'regular', week: Number(period.week) } : undefined;
}

export function createProductionAllPlayerDependencies(
  execution?: Readonly<{ signal: AbortSignal; deadlineAt: string }>,
): AllPlayerIngestionDependencies {
  const shared = createProductionSharedServices('all-player-ingestion');
  const store = execution
    ? createProjectionStore(withDatabaseAbortSignal(getDatabase(), execution.signal))
    : getProjectionStore();
  const cleanupMs = execution ? Math.min(54_000, Date.parse(execution.deadlineAt) + 4_000 - Date.now()) : 0;
  const cleanupStore = execution
    ? createProjectionStore(withDatabaseAbortSignal(getDatabase(),
      Number.isFinite(cleanupMs) && cleanupMs > 0 ? AbortSignal.timeout(Math.floor(cleanupMs)) : AbortSignal.abort()))
    : getProjectionStore();
  // Weekly response classification needs every official identity, including
  // out-of-scope rows. Share one existing catalog-boundary load across leagues.
  let sharedCatalog: ReturnType<typeof loadCompletePlayerCatalog> | undefined;
  const loadCatalog = () => {
    sharedCatalog ??= loadCompletePlayerCatalog();
    return sharedCatalog;
  };
  const loadProjectionInput = (leagueId: string, period: LeaguePeriod) => (
    getOperatorProjectionSyncInput(leagueId, period, loadCatalog)
  );
  return {
    ...shared,
    ...execution,
    cleanupStore,
    store,
    projectionRepository: createNeonProjectionRepository(store, {
      officialProvider,
      projectionProvider,
      gameStateProvider: projectionProvider,
      normalizerVersion: ACTIVE_PROJECTION_SOURCE.normalizerVersion,
    }),
    loadLeagueWeek: async (configuration, period) => {
      const source = await loadProjectionInput(
        String(configuration.leagueRef.externalId),
        period,
      );
      return {
        state: await translateSleeperLeagueWeek(source, configuration, period),
        rawMatchups: source.rawMatchups,
        expectedRosterIds: source.matchupShape.rosterIds,
        starterSlots: source.matchupShape.starterSlots,
      };
    },
    loadCatalog,
    allPlayerSource: { access: 'live', ...createSleeperAllPlayerStatSource({
      fetch: globalThis.fetch, now: shared.clock.now,
    }) },
    normalizeScoringProfile: normalizeSleeperScoringProfile,
    officialProvider,
    projectionProvider,
    gameStateProvider: projectionProvider,
  };
}

export async function runProductionAllPlayerOperation(
  mode: Exclude<AllPlayerIngestionMode, 'recurring'>,
  period: LeaguePeriod,
): Promise<AllPlayerIngestionResult> {
  const deadlineAt = new Date(Date.now() + 50_000).toISOString();
  const signal = AbortSignal.timeout(50_000);
  const dependencies = createProductionAllPlayerDependencies({ signal, deadlineAt });
  return runAllPlayerIngestion(dependencies, {
    mode,
    period,
    requireFinalCoverage: true,
  });
}

/** The existing live-projection cron calls this composition. The flag remains
 * off until a separately authorized activation; no additional cron exists. */
export async function runProductionAllPlayerRecurring(
  invocationStartedAt = Date.now(),
): Promise<AllPlayerIngestionResult> {
  if (process.env[ALL_PLAYER_RECURRING_ENV] !== 'true') {
    return { status: 'disabled', mode: 'recurring' };
  }
  // This logger constructs only shared configuration. Nonpoll invocations log
  // without database work; polling opportunities use the existing bounded job
  // diagnostic helper, independently of ownership and provider request claims.
  const logger = createProductionSharedServices('all-player-ingestion').logger;
  const now = new Date();
  const pollingOpportunity = isAllPlayerPollingOpportunity(now);
  const preclaim = async (
    result: Extract<AllPlayerIngestionResult, { status: 'skipped' | 'unavailable' }>,
    stage: string,
    period?: LeaguePeriod,
    retryAt?: string | null,
  ): Promise<AllPlayerIngestionResult> => {
    const reason = /^[a-z][a-z0-9:-]{0,127}$/u.test(result.reason)
      ? result.reason : 'preclaim-reason-invalid';
    let durability: 'recorded' | 'unchanged' | 'throttled' | 'disabled'
      | 'nonpoll-log-only' | 'deadline-unavailable' | 'persistence-failed' = 'nonpoll-log-only';
    if (pollingOpportunity) {
      // Keep durable handling inside the same invocation, including when earlier
      // work exhausted the ingestion deadline. Cancellation also bounds a slow DB.
      const cleanupMs = Math.min(3_000, invocationStartedAt + 55_000 - Date.now());
      if (!Number.isFinite(cleanupMs) || cleanupMs < 1) durability = 'deadline-unavailable';
      else {
        const signal = AbortSignal.timeout(Math.floor(cleanupMs));
        const outcome = result.status === 'skipped'
          ? result.reason === 'busy' ? 'busy' as const : 'not-due' as const
          : result.reason === 'insufficient-invocation-budget' ? 'timeout' as const : 'validation-failed' as const;
        const retryDisposition = result.status === 'skipped' ? 'after-cooldown' as const
          : /(?:final-capture-overdue|correction-window-closed|source-policy)/u.test(reason)
            ? 'manual-review' as const : 'next-poll' as const;
        let timeout: ReturnType<typeof setTimeout> | undefined;
        try {
          const diagnosticStore = createProjectionStore(withDatabaseAbortSignal(getDatabase(), signal));
          durability = await Promise.race([
            diagnosticStore.recordAllPlayerPreclaimOutcome({
              outcome, stage, reason, retryDisposition,
              ...(period ? { period: { ...period, seasonType: 'reg' as const } } : {}),
              ...(retryAt && Number.isFinite(Date.parse(retryAt))
                ? { retryAt: new Date(retryAt).toISOString() } : {}),
            }),
            new Promise<'persistence-failed'>((resolve) => {
              timeout = setTimeout(() => resolve('persistence-failed'), cleanupMs);
            }),
          ]);
        } catch { durability = 'persistence-failed'; }
        finally { if (timeout) clearTimeout(timeout); }
      }
    }
    const durableFailure = durability === 'persistence-failed' || durability === 'deadline-unavailable';
    logger.write(result.status === 'skipped' && !durableFailure ? 'info' : 'warn', {
      stage: 'all-player-recurring-preclaim', lane: 'all-player', cadence: 'recurring',
      outcome: result.status === 'skipped' ? 'skipped' : 'failed',
      allPlayerFailureStage: stage, allPlayerReason: reason,
      allPlayerDiagnostics: [`preclaim-durability:${durability}`], allPlayerDiagnosticCount: 1,
      allPlayerPersistedObservation: false, allPlayerConfirmedPublication: false,
      allPlayerRetryDisposition: 'global-budget', upstreamRequests: 0,
      ...(period ? { period } : {}),
    });
    return result;
  };
  if (!pollingOpportunity) return preclaim({
    status: 'skipped', mode: 'recurring', reason: 'not-due',
  }, 'polling-opportunity');
  const remainingMs = invocationStartedAt + 50_000 - Date.now();
  if (remainingMs < 10_000) return preclaim({
    status: 'unavailable', mode: 'recurring', reason: 'insufficient-invocation-budget', stage: 'recurring-preflight',
  }, 'invocation-budget');
  let preclaimStage = 'recurring-composition';
  try {
    const dependencies = createProductionAllPlayerDependencies({
      signal: AbortSignal.timeout(remainingMs), deadlineAt: new Date(invocationStartedAt + 50_000).toISOString(),
    });
    preclaimStage = 'global-budget';
    const job = await dependencies.store.readAllPlayerJobState();
    const previousPeriod = diagnosticPeriod(job?.payload.period);
    if (typeof job?.payload.nextAttemptAt === 'string' && Date.parse(job.payload.nextAttemptAt) > now.getTime()) {
      return preclaim({ status: 'skipped', mode: 'recurring', reason: 'not-due' }, 'failure-cooldown', previousPeriod,
        job.payload.nextAttemptAt);
    }
    if (job?.nextRequestAt && Date.parse(job.nextRequestAt) > now.getTime()) {
      return preclaim({ status: 'skipped', mode: 'recurring', reason: 'not-due' }, 'global-budget', previousPeriod,
        job.nextRequestAt);
    }
    if (job?.state === 'running' && job.leaseUntil && Date.parse(job.leaseUntil) > now.getTime()) {
      return preclaim({ status: 'skipped', mode: 'recurring', reason: 'busy' }, 'ownership', previousPeriod,
        job.leaseUntil);
    }
    preclaimStage = 'period-selection';
    const keys = dependencies.leagueRegistry.listActiveLeagues().map((league) => league.key);
    const authorities = await dependencies.store.readLeagueLineupAuthorities(keys);
    const selection = selectAllPlayerRecurringPeriod(authorities, job, now);
    if (selection.kind === 'unavailable') {
      const overdue = /^final-capture-overdue:(\d{4}):regular:(\d{1,2})$/u.exec(selection.reason);
      const period = overdue ? diagnosticPeriod({ season: Number(overdue[1]), seasonType: 'reg', week: Number(overdue[2]) }) : undefined;
      return preclaim({
        status: 'unavailable', mode: 'recurring', reason: selection.reason, stage: 'period-selection',
      }, 'period-selection', period);
    }
    return runAllPlayerIngestion(dependencies, {
      mode: 'recurring',
      period: selection.period,
      requireFinalCoverage: selection.requireFinalCoverage,
    });
  } catch {
    return preclaim({ status: 'unavailable', mode: 'recurring', reason: 'recurring-preflight-failed', stage: 'recurring-preflight' }, preclaimStage);
  }
}
