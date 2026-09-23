import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import type { LeagueCadenceState, LeagueConfiguration, NflWeekSchedule } from '../lib/projections/domain/contracts';
import type { LineupWatchState, LineupWatchTarget } from '../lib/projections/ports/lineup-watch-repository';
import type { LineupPeriodAuthority } from '../lib/projections/ports/period-authority-reader';
import { externalLeagueRef, externalRosterRef } from '../lib/projections/shared/provider-identity';
import { parseLineupCadencePolicy, LINEUP_CADENCE_POLICY_VERSION } from '../lib/projections/shared/lineup-cadence';
import type { LiveProjectionWorkerDependencies } from '../lib/projections/worker/contracts';
import { planCurrentWork } from '../lib/projections/worker/current-work-plan';
import { LINEUP_OBSERVATION_CONCURRENCY } from '../lib/projections/worker/lineup-observation-stage';
import { synchronizeLineupWatches } from '../lib/projections/worker/lineup-watch-context';
import { FUTURE_LINEUP_CATCHUP_LIMIT, LINEUP_MATCHUP_REQUEST_LIMIT, nextLineupCheckAt } from '../lib/projections/worker/lineup-watch-policy';

/** Offline policy measurement only: no provider adapters, database clients or environment files. */
const FLEETS = [3, 10, 20, 50, 100, 300] as const;
const WEEKS = [1, 3, 10, 17] as const;
const START = new Date('2026-09-13T12:00:00.000Z');
const MINUTE_MS = 60_000;
const MINUTES = 360;
const OUTPUT = new URL('../release/collection-capacity/scheduling-policy.json', import.meta.url);
if (process.argv.length !== 2) throw new Error('Scheduling capacity measurement accepts no arguments.');

function watchState(target: LineupWatchTarget): LineupWatchState {
  const { initialNextCheckAt, ...base } = target;
  return { ...base, watchId: `${target.configuration.key}:${target.period.week}`, watchGeneration: 1,
    nextCheckAt: initialNextCheckAt, observedVersion: 0, latestLineupRevision: null,
    acceptedRequestStartedAt: null, acceptedRequestCompletedAt: null, lastCheckedAt: null,
    lastCompleteObservationAt: null, lastMaterializedLineupRevision: null,
    lastMaterializedSnapshotRevision: null, lastMaterializedVerifiedAt: null, pendingSince: null,
    activeAttemptId: null, claimGeneration: 0, leaseOwner: null, attemptStartedAt: null,
    leaseExpiresAt: null, attemptCount: 0, consecutiveFailures: 0, lastFailureCode: null,
    retiredAt: null, retirementReason: null };
}

function authority(configuration: LeagueConfiguration, week: number, preseason: boolean): LineupPeriodAuthority {
  const period = { season: 2026, seasonType: 'regular' as const, week };
  return { configuration, authorityGeneration: 1,
    shape: { expectedRosterCount: 12, expectedStarterSlotCount: 9,
      expectedRosterRefs: Array.from({ length: 12 }, (_, index) => externalRosterRef(configuration.leagueRef, String(index + 1))) },
    defaultPeriodCadence: { isCurrentRegularPeriod: !preseason, games: [] },
    authority: { configuration, defaultDisplayPeriod: period, activeScoringPeriod: preseason ? null : period,
      lifecycle: preseason ? 'preseason' : 'active', nflPhase: preseason ? 'preseason' : 'regular',
      source: configuration.leagueRef.provider, sourceRevision: 'synthetic-policy-authority',
      observedAt: START.toISOString(), verifiedAt: START.toISOString() } };
}

function summarize(values: readonly number[]) {
  return { minimum: Math.min(...values), maximum: Math.max(...values),
    total: values.reduce((sum, value) => sum + value, 0),
    average: values.reduce((sum, value) => sum + value, 0) / values.length };
}

// Only these two planner ports are supplied. Unexpected dependency access fails
// instead of accidentally constructing any runtime provider or database client.
const plannerDependencies = new Proxy({} as LiveProjectionWorkerDependencies, {
  get(_target, key) {
    if (key === 'logger') return { write() { /* No remote logger. */ } };
    if (key === 'repository') return new Proxy({}, {
      get() { throw new Error('Live-window scheduling must not acquire hourly markers or access persistence.'); },
    });
    throw new Error(`Unexpected scheduling dependency: ${String(key)}`);
  },
});

async function scenario(leagueCount: number, week: number, observerDefaultLeagues = 0) {
  const startedAt = performance.now();
  const configurations: LeagueConfiguration[] = Array.from({ length: leagueCount }, (_, index) => {
    const key = `capacity-league-${String(index + 1).padStart(3, '0')}`;
    return { key, displayName: key, leagueRef: externalLeagueRef('sleeper', `synthetic-${key}`),
      matchupWeekRange: { firstWeek: 1, lastWeek: 18 } };
  });
  const authorities = configurations.map((configuration, index) => authority(configuration, week, index < observerDefaultLeagues));
  const context = await synchronizeLineupWatches({
    readLineupWatchSchedule: async () => [],
    synchronizeLineupWatchStates: async ({ targets }) => ({ kind: 'stored', states: targets.map(watchState) }),
  }, configurations, authorities.map((value) => ({ kind: 'present', leagueKey: value.configuration.key, value })), START);
  assert.equal(context.kind, 'stored');
  if (context.kind !== 'stored') throw new Error('Synthetic policy synchronization was disabled.');
  assert.deepEqual(context.skippedLeagueKeys, []);
  assert.equal(context.states.length, leagueCount * 18);
  assert.equal(context.capacity.currentTargets, leagueCount);
  assert.equal(context.capacity.observerCurrentTargets, observerDefaultLeagues);

  const futureBuckets = new Array<number>(MINUTES).fill(0);
  const tierTargets: Record<string, number> = {};
  for (const state of context.states.filter((value) => value.watchClass === 'future')) {
    const cadence = parseLineupCadencePolicy(state.cadencePolicyVersion, state.watchClass, state.phase);
    tierTargets[cadence.minutes] = (tierTargets[cadence.minutes] ?? 0) + 1;
    let next = state.nextCheckAt;
    let occurrences = 0;
    while (next !== null && Date.parse(next) < START.getTime() + MINUTES * MINUTE_MS) {
      const minute = (Date.parse(next) - START.getTime()) / MINUTE_MS;
      assert.ok(Number.isInteger(minute) && minute >= 0 && minute < MINUTES);
      futureBuckets[minute] += 1;
      occurrences += 1;
      next = nextLineupCheckAt(state.watchClass, state.phase, new Date(next), state.cadencePolicyVersion);
    }
    assert.equal(occurrences, MINUTES / cadence.minutes);
  }
  const combinedDemand = futureBuckets.map((count) => count + leagueCount);
  assert.equal(Math.max(...combinedDemand), context.capacity.requiredMatchupRequestsPerMinute);

  // This synthetic game stays inside the existing live window throughout six
  // hours. It invokes the real current planner without forcing a cadence or
  // replacing its ordering/admission policy. Successful work is instantaneous.
  const schedule: NflWeekSchedule = {
    NE: { kind: 'scheduled', opponent: 'ATL', location: 'home', date: '2026-09-13', kickoffAt: '2026-09-13T11:00:00.000Z' },
    ATL: { kind: 'scheduled', opponent: 'NE', location: 'away', date: '2026-09-13', kickoffAt: '2026-09-13T11:00:00.000Z' },
  };
  const cadenceByKey = new Map<string, LeagueCadenceState>(authorities.map((value) => [value.configuration.key, {
    configuration: value.configuration, period: value.authority.defaultDisplayPeriod,
    periodAuthority: value.authority, currentPeriod: value.authority.defaultDisplayPeriod,
    schedule, lineupShape: value.shape, defaultPeriodCadence: value.defaultPeriodCadence,
  }]));
  let currentStates = context.states.filter((state) => state.watchClass === 'current' && state.materializationLane === 'current');
  const selectedMinutes = new Map(currentStates.map((state) => [state.watchId, [] as number[]]));
  const admittedPerMinute: number[] = [];
  const deferredPerMinute: number[] = [];
  const plannerStartedAt = performance.now();
  for (let minute = 0; minute < MINUTES; minute += 1) {
    const now = new Date(START.getTime() + minute * MINUTE_MS);
    const plan = await planCurrentWork(plannerDependencies, currentStates, cadenceByKey, now,
      `offline-minute-${minute}`, false, context.capacity.maximumCurrentChecks);
    assert.equal(plan.thin.length, 0);
    assert.ok(plan.full.length <= context.capacity.maximumCurrentChecks);
    const selected = new Set(plan.full.map(({ state }) => state.watchId));
    assert.equal(plan.skipped, currentStates.length - selected.size);
    admittedPerMinute.push(selected.size);
    deferredPerMinute.push(plan.skipped);
    currentStates = currentStates.map((state) => {
      if (!selected.has(state.watchId)) return state;
      selectedMinutes.get(state.watchId)!.push(minute);
      return { ...state, lastCheckedAt: now.toISOString(),
        nextCheckAt: nextLineupCheckAt(state.watchClass, state.phase, now, state.cadencePolicyVersion) };
    });
  }
  const plannerWallTimeMs = performance.now() - plannerStartedAt;
  const selections = [...selectedMinutes.values()];
  const intervals = selections.flatMap((minutes) => minutes.slice(1).map((minute, index) => minute - minutes[index]));
  const firstSelection = selections.map((minutes) => minutes[0] ?? MINUTES);
  const firstSweepMinute = firstSelection.length ? Math.max(...firstSelection) : null;
  assert.ok(selections.every((minutes) => minutes.length > 0), 'A healthy active league was never admitted.');
  return {
    policy: {
      leagueCount, activeWeek: week, observerDefaultLeagues,
      horizonWeeks: 18, simulatedMinutes: MINUTES,
      currentTargets: context.capacity.currentTargets, futureTargets: context.capacity.futureTargets,
      completedTargets: context.states.filter((state) => state.watchClass === 'completed').length,
      futureTargetsByCadenceMinutes: tierTargets, capacity: context.capacity,
      nominalFutureChecksPerMinute: summarize(futureBuckets),
      nominalAllLineupChecksPerMinute: summarize(combinedDemand),
      worstNominalBucketMinuteOffsets: combinedDemand.flatMap((count, minute) => count === Math.max(...combinedDemand) ? [minute] : []),
      bucketsAboveSharedAllowance: combinedDemand.filter((count) => count > LINEUP_MATCHUP_REQUEST_LIMIT).length,
      futureBucketsAboveObserverFutureCap: futureBuckets.filter((count) => count > context.capacity.maximumFutureChecks).length,
      nominalFutureChecksAboveSameMinuteCap: futureBuckets.reduce((sum, count) => sum + Math.max(0, count - context.capacity.maximumFutureChecks), 0),
      observerTotalRemainingAllocation: LINEUP_MATCHUP_REQUEST_LIMIT - context.capacity.maximumCurrentChecks,
      currentPlanner: {
        mode: 'healthy active live-window; instantaneous successful completion; no provider or database work',
        admittedPerMinute: summarize(admittedPerMinute), deferredPerMinute: summarize(deferredPerMinute),
        firstSweepMinuteOffset: firstSweepMinute,
        observedReselectionIntervalMinutes: intervals.length ? summarize(intervals) : null,
        minimumChecksPerActiveLeague: selections.length ? Math.min(...selections.map((minutes) => minutes.length)) : 0,
        maximumChecksPerActiveLeague: selections.length ? Math.max(...selections.map((minutes) => minutes.length)) : 0,
        neverAdmitted: selections.filter((minutes) => minutes.length === 0).length,
      },
    },
    localAlgorithmTiming: { synchronizationAndMeasurementWallTimeMs: performance.now() - startedAt, plannerWallTimeMs },
  };
}

const scenarios = [];
for (const leagueCount of FLEETS) for (const week of WEEKS) scenarios.push(await scenario(leagueCount, week));
const observerDefaultSensitivity = [];
for (const leagueCount of FLEETS) {
  observerDefaultSensitivity.push(await scenario(leagueCount, 1, 1));
  observerDefaultSensitivity.push(await scenario(leagueCount, 1, leagueCount));
}
const sources = [
  'domain/period-classification.ts', 'shared/lineup-cadence.ts', 'worker/lineup-watch-context.ts',
  'worker/lineup-watch-policy.ts', 'worker/current-work-plan.ts', 'worker/cadence.ts',
  'worker/lineup-observation-stage.ts', 'worker/lineup-orchestrator.ts',
];
const policySourceHashes = Object.fromEntries(await Promise.all(sources.map(async (path) => [path,
  createHash('sha256').update(await readFile(new URL(`../lib/projections/${path}`, import.meta.url))).digest('hex')])));
const fingerprint = createHash('sha256').update(JSON.stringify({
  scenarios: scenarios.map(({ policy }) => policy),
  observerDefaultSensitivity: observerDefaultSensitivity.map(({ policy }) => policy), policySourceHashes,
})).digest('hex');
const report = {
  kind: 'offline-collection-scheduling-policy-measurement', measuredAt: new Date().toISOString(),
  sourceCommit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8', windowsHide: true }).trim(),
  nodeVersion: process.version, policyVersion: LINEUP_CADENCE_POLICY_VERSION,
  deterministicPolicySha256: fingerprint, policySourceHashes,
  externalRequests: { provider: 0, database: 0, production: 0 },
  scope: 'Actual exported watch synchronization, cadence, due-time and current admission functions with synthetic identities and in-memory ports.',
  constants: { sharedLineupChecksPerMinute: LINEUP_MATCHUP_REQUEST_LIMIT,
    observerFutureCatchupLimit: FUTURE_LINEUP_CATCHUP_LIMIT, observerSourceConcurrency: LINEUP_OBSERVATION_CONCURRENCY },
  assumptions: [
    'The six-hour observation cycle covers every offset for 1-, 15-, 60- and 360-minute policies.',
    'League keys and source references are synthetic and stable as fleet size grows; other identities can produce different offset collisions.',
    'The planner simulation acknowledges selected current work immediately and assumes every invocation runs, with no failure, lease, latency or authority-refresh cost.',
    'Nominal future demand is measured without executing or duplicating PostgreSQL observer claiming. Excess same-minute demand can be delayed; it is not a count of permanently lost checks.',
    'Observer-default sensitivity includes one preseason-default league or every league in preseason. It exercises real target ownership and admission accounting, not observer queue fairness.',
  ],
  exclusions: [
    'No remote throughput, provider quota, Vercel duration or maximum supported fleet claim.',
    'Lineup check counts omit league/calendar/users/rosters endpoints, metadata maintenance, shared statistics/projections and browser traffic; they are not total HTTP requests.',
    'No observer claim SQL, future action queue, real execution delay, retries, failure backoff or maintenance fairness simulation.',
    'Local algorithm timings are single process measurements, not p95/p99 or production service-level evidence.',
  ],
  scenarios, observerDefaultSensitivity,
};
await mkdir(new URL('../release/collection-capacity/', import.meta.url), { recursive: true });
await writeFile(OUTPUT, `${JSON.stringify(report, null, 2)}\n`);
process.stdout.write(`${JSON.stringify({ outcome: 'measured', output: 'release/collection-capacity/scheduling-policy.json',
  regularScenarios: scenarios.length, observerSensitivityScenarios: observerDefaultSensitivity.length,
  deterministicPolicySha256: fingerprint, externalRequests: report.externalRequests,
  summary: scenarios.map(({ policy }) => ({ leagues: policy.leagueCount, week: policy.activeWeek,
    averageNominalChecks: policy.nominalAllLineupChecksPerMinute.average,
    worstNominalMinute: policy.nominalAllLineupChecksPerMinute.maximum,
    activeCurrentCap: policy.capacity.maximumCurrentChecks, futureCap: policy.capacity.maximumFutureChecks,
    deferredCurrentEachMinute: policy.currentPlanner.deferredPerMinute.maximum,
    idealCurrentGapMinutes: policy.currentPlanner.observedReselectionIntervalMinutes?.maximum,
    diagnostic: policy.capacity.status })) })}\n`);
