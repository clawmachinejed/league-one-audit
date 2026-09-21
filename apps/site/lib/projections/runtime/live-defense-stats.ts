import 'server-only';

import { randomUUID } from 'node:crypto';
import { getDatabase, withDatabaseAbortSignal } from '../../database';
import { createProjectionStore } from '../../projection-store';
import type { AllPlayerJobFence, ProjectionStore, SleeperWeeklyStatReceipt } from '../adapters/neon/contracts';
import { SLEEPER_LIVE_DEFENSE_MAPPING, SLEEPER_LIVE_DEFENSE_STAT_KEYS } from '../adapters/sleeper/scoring-profile';
import {
  createSleeperWeeklyStatSource,
  type SleeperWeeklyStatCapture,
} from '../adapters/sleeper/weekly-stat-source';
import { NFL_TEAM_CODES, type LeaguePeriod } from '../domain/contracts';
import type { LiveDefenseStatResult, LiveDefenseStatSourcePort } from '../ports/live-defense-stat-source';

type BudgetStore = Pick<ProjectionStore,
  'enabled' | 'acquireAllPlayerJob' | 'markAllPlayerRequest' | 'finishLiveDefenseStatRequest' | 'readLiveDefenseStatCapture'>;
type WeeklySource = ReturnType<typeof createSleeperWeeklyStatSource>;
export type LiveDefenseStatCoordinatorDependencies = Readonly<{
  now: () => number;
  enabled: () => boolean;
  workerId: () => string;
  store: (signal: AbortSignal) => BudgetStore;
  loadWeeklyStats: WeeklySource['load'];
}>;
export type SharedSleeperWeeklyCapture = Readonly<{
  capture: SleeperWeeklyStatCapture;
  receipt: SleeperWeeklyStatReceipt;
}>;

const mapping = SLEEPER_LIVE_DEFENSE_MAPPING;
const retainedKeys = SLEEPER_LIVE_DEFENSE_STAT_KEYS;

class DefenseStatDeadline extends Error {
  constructor() { super('Live defense statistics deadline reached.'); }
}

function key(period: LeaguePeriod): string {
  return `${period.season}:${period.seasonType}:${period.week}`;
}

function validPeriod(period: LeaguePeriod): boolean {
  return Number.isInteger(period.season) && period.season >= 2026 && period.season <= 2200
    && period.seasonType === 'regular' && Number.isInteger(period.week) && period.week >= 1 && period.week <= 18;
}

function unavailable(reason: string): LiveDefenseStatResult {
  return { status: 'unavailable', reason, mapping };
}

/** One current-period request shared by every league and the existing hourly collector. */
export function createLiveDefenseStatCoordinator(
  invocationStartedAt = Date.now(),
  overrides: Partial<LiveDefenseStatCoordinatorDependencies> = {},
): Readonly<{
  source: LiveDefenseStatSourcePort;
  getCapture: (period: LeaguePeriod) => SharedSleeperWeeklyCapture | undefined;
}> {
  const dependencies: LiveDefenseStatCoordinatorDependencies = {
    now: Date.now,
    enabled: () => process.env.ALL_PLAYER_RECURRING_ENABLED === 'true',
    workerId: () => `live-defense:${randomUUID()}`,
    store: (signal) => createProjectionStore(withDatabaseAbortSignal(getDatabase(), signal)),
    loadWeeklyStats: (input) => createSleeperWeeklyStatSource({
      fetch: globalThis.fetch, now: () => new Date(dependencies.now()),
    }).load(input),
    ...overrides,
  };
  // Provider work ends at 40s. Cleanup ends at 45s, preserving at least 15s of
  // the existing 60s route for league snapshot publication and final handling.
  const workDeadline = invocationStartedAt + 40_000;
  const cleanupDeadline = invocationStartedAt + 45_000;
  const fenceDeadline = invocationStartedAt + 50_000;
  const loads = new Map<string, Promise<LiveDefenseStatResult>>();
  const captures = new Map<string, SharedSleeperWeeklyCapture>();
  let selectedPeriod: string | undefined;

  async function bounded<T>(deadline: number, operation: (signal: AbortSignal) => Promise<T>): Promise<T> {
    const remaining = Math.floor(deadline - dependencies.now());
    if (remaining <= 0) throw new DefenseStatDeadline();
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => {
            controller.abort();
            reject(new DefenseStatDeadline());
          }, remaining);
        }),
        operation(controller.signal),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  async function loadSelected(period: LeaguePeriod): Promise<LiveDefenseStatResult> {
    let fence: AllPlayerJobFence | undefined;
    let stage: 'claim' | 'mark' | 'provider' | 'finish' = 'claim';
    const dbPeriod = { season: period.season, seasonType: 'reg', week: period.week } as const;
    async function finish(outcome: 'captured' | 'provider-failed' | 'validation-failed' | 'timeout', captureReceipt?: SleeperWeeklyStatReceipt) {
      stage = 'finish';
      return bounded(Math.min(cleanupDeadline, dependencies.now() + 5_000), (signal) => dependencies.store(signal)
        .finishLiveDefenseStatRequest({ fence: fence!, outcome, ...(captureReceipt ? { captureReceipt } : {}) }));
    }
    try {
      const claim = await bounded(Math.min(workDeadline, dependencies.now() + 5_000), async (signal) => {
        const store = dependencies.store(signal);
        if (!store.enabled) return { kind: 'disabled' } as const;
        return store.acquireAllPlayerJob({
          mode: 'live-defense', period: dbPeriod, workerId: dependencies.workerId(),
          leaseSeconds: 60, deadlineAt: new Date(fenceDeadline).toISOString(),
        });
      });
      if (claim.kind !== 'acquired') return unavailable(claim.kind);
      fence = claim.fence;
      stage = 'mark';
      const marked = await bounded(Math.min(workDeadline, dependencies.now() + 5_000), (signal) => dependencies.store(signal)
        .markAllPlayerRequest({ fence: fence!, period: dbPeriod }));
      if (!marked) {
        await finish('validation-failed');
        return unavailable('request-budget-unavailable');
      }
      stage = 'provider';
      const loaded = await bounded(Math.min(workDeadline, dependencies.now() + 10_000), (signal) => (
        dependencies.loadWeeklyStats({ ...dbPeriod, signal })
      ));
      if (dependencies.now() >= workDeadline) throw new DefenseStatDeadline();
      if (loaded.status !== 'available') {
        const outcome = loaded.status === 'unavailable' && loaded.reason === 'http' ? 'provider-failed' : 'validation-failed';
        await finish(outcome);
        return unavailable(outcome);
      }
      const capture = loaded.capture;
      const response = capture.responseEvidence;
      if (capture.period.season !== period.season || capture.period.seasonType !== 'reg' || capture.period.week !== period.week
        || !response.bodyHash || !/^sha256:[0-9a-f]{64}$/u.test(response.bodyHash)
        || !capture.sourceRevision.trim() || capture.sourceRevision.length > 1024
        || !Number.isFinite(Date.parse(response.requestStartedAt))
        || !Number.isFinite(Date.parse(response.requestCompletedAt))
        || Date.parse(response.requestStartedAt) > Date.parse(response.requestCompletedAt)
        || Date.parse(response.requestCompletedAt) > dependencies.now()) {
        await finish('validation-failed');
        return unavailable('invalid-capture');
      }
      const entries = NFL_TEAM_CODES.flatMap((team) => {
        const row = capture.rows[team];
        if (!row) return [];
        const stats = Object.fromEntries(Object.entries(row.stats).filter(([stat]) => retainedKeys.has(stat)));
        return [{ team, stats }];
      });
      const receipt: SleeperWeeklyStatReceipt = {
        period: dbPeriod, sourceRevision: capture.sourceRevision, bodyHash: response.bodyHash,
        requestStartedAt: response.requestStartedAt, requestCompletedAt: response.requestCompletedAt,
        requestGeneration: fence.generation,
      };
      stage = 'finish';
      if (!await finish('captured', receipt)) return unavailable('lease-lost');
      if (dependencies.now() >= cleanupDeadline) return unavailable('timeout');
      captures.set(key(period), { capture, receipt });
      return { status: 'available', mapping, capture: {
        period, requestStartedAt: receipt.requestStartedAt, requestCompletedAt: receipt.requestCompletedAt,
        observedAt: receipt.requestCompletedAt, sourceRevision: capture.sourceRevision, entries,
      } };
    } catch (error) {
      const outcome = error instanceof DefenseStatDeadline ? 'timeout'
        : stage === 'provider' ? 'provider-failed' : 'validation-failed';
      if (fence && stage !== 'finish' && dependencies.now() < cleanupDeadline) {
        try { await finish(outcome); } catch { /* The owned lease expires; no capture can escape. */ }
      }
      return unavailable(stage === 'finish' && outcome !== 'timeout' ? 'completion-failed' : outcome);
    }
  }

  async function reuseStored(period: LeaguePeriod, result: LiveDefenseStatResult): Promise<LiveDefenseStatResult> {
    if (result.status === 'available' || result.reason === 'disabled'
      || dependencies.now() >= cleanupDeadline) return result;
    try {
      const capture = await bounded(Math.min(cleanupDeadline, dependencies.now() + 2_000), (signal) => {
        const store = dependencies.store(signal);
        return store.enabled && store.readLiveDefenseStatCapture
          ? store.readLiveDefenseStatCapture(period) : Promise.resolve(null);
      });
      // The database reader checks the original timestamps against database time.
      // This reuse cannot create a full raw capture or a new request receipt.
      if (capture) return { status: 'available', mapping, capture };
    } catch { /* Keep the original bounded failure; stale evidence cannot become fresh. */ }
    return result;
  }

  const source: LiveDefenseStatSourcePort = {
    async load({ period, statisticsRequired }) {
      if (!statisticsRequired) return unavailable('not-required');
      if (!dependencies.enabled()) return unavailable('disabled');
      if (!validPeriod(period)) return unavailable('invalid-period');
      const periodKey = key(period);
      const existing = loads.get(periodKey);
      if (existing) return existing;
      if (!Number.isFinite(invocationStartedAt) || dependencies.now() >= workDeadline) return unavailable('timeout');
      if (selectedPeriod && selectedPeriod !== periodKey) return unavailable('period-not-selected');
      selectedPeriod = periodKey;
      const pending = loadSelected(period).then((result) => reuseStored(period, result));
      loads.set(periodKey, pending);
      return pending;
    },
  };
  return { source, getCapture: (period) => captures.get(key(period)) };
}
