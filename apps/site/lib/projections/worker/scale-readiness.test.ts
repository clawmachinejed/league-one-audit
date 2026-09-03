import { createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { describe, expect, it } from 'vitest';

import {
  GAME_STATE_PROVIDER,
  NOW,
  OFFICIAL_PROVIDER,
  PERIOD,
  fakeStore,
  fullWeekSchedule,
  projectionResult,
} from '../../live-projection-worker.fixtures';
import { NFL_TEAM_CODES } from '../domain/contracts';
import type {
  GameStateObservation,
  GameStateSlate,
  LeagueCadenceState,
  LeagueConfiguration,
  LeagueWeekState,
  NflTeam,
  ScoringEntity,
} from '../domain/contracts';
import { normalizeSleeperScoringProfile } from '../adapters/sleeper/scoring-profile';
import { assessProjectionSlate } from '../adapters/tank01/slate-validation';
import type { IdentityCrosswalkPort } from '../ports/identity-crosswalk';
import type { ProjectionLogEntry, LogLevel } from '../ports/logger';
import type { ProjectionRepositoryPort, PublishSnapshotInput } from '../ports/projection-repository';
import {
  externalGameRef,
  externalLeagueRef,
  externalPlayerRef,
  externalRosterRef,
} from '../shared/provider-identity';
import { compatibleRevision } from '../shared/revision-compatibility';
import type { LiveProjectionSyncResult, LiveProjectionWorkerDependencies } from './contracts';
import { runWithDependencies } from './orchestrator';

const SCALE_POINTS = [3, 50, 300] as const;
const MANAGER_TEAMS = [
  'ARI', 'ATL', 'BAL', 'BUF', 'CAR', 'CHI',
  'CIN', 'CLE', 'DAL', 'DEN', 'DET', 'GB',
] as const satisfies readonly NflTeam[];
const POSITIONS = ['QB', 'RB', 'WR', 'TE'] as const;
const REQUEST_STARTED_AT = '2026-09-13T18:00:00.000Z';
const REQUEST_COMPLETED_AT = '2026-09-13T18:00:01.000Z';
const GAME_OBSERVED_AT = '2026-09-13T18:00:02.000Z';

type TraceEntry = `${string}:${'start' | 'finish'}`;

class OneShotBarrier {
  private arrivals = 0;
  private released = false;
  private readonly release: () => void;
  private readonly waiting: Promise<void>;

  constructor(private readonly target: number) {
    let release!: () => void;
    this.waiting = new Promise<void>((resolve) => {
      release = resolve;
    });
    this.release = release;
  }

  async wait(): Promise<void> {
    if (this.released) return;
    this.arrivals += 1;
    if (this.arrivals === this.target) {
      this.released = true;
      this.release();
    }
    await this.waiting;
  }
}

class AsyncOperationMeter {
  readonly counts = new Map<string, number>();
  readonly activeByOperation = new Map<string, number>();
  readonly peakByOperation = new Map<string, number>();
  readonly trace: TraceEntry[] = [];
  outstanding = 0;
  peakOutstanding = 0;

  async run<Value>(operation: string, action: () => Promise<Value>): Promise<Value> {
    this.counts.set(operation, (this.counts.get(operation) ?? 0) + 1);
    const active = (this.activeByOperation.get(operation) ?? 0) + 1;
    this.activeByOperation.set(operation, active);
    this.peakByOperation.set(operation, Math.max(this.peakByOperation.get(operation) ?? 0, active));
    this.outstanding += 1;
    this.peakOutstanding = Math.max(this.peakOutstanding, this.outstanding);
    this.trace.push(`${operation}:start`);
    // A deterministic yield makes bounded parallel work observable without wall-clock delays.
    await Promise.resolve();
    try {
      return await action();
    } finally {
      this.trace.push(`${operation}:finish`);
      this.activeByOperation.set(operation, (this.activeByOperation.get(operation) ?? 1) - 1);
      this.outstanding -= 1;
    }
  }

  count(operation: string): number {
    return this.counts.get(operation) ?? 0;
  }

  peak(operation: string): number {
    return this.peakByOperation.get(operation) ?? 0;
  }
}

function scaleConfiguration(index: number): LeagueConfiguration {
  const suffix = String(index + 1).padStart(3, '0');
  return {
    key: `scale-${suffix}`,
    displayName: `Scale League ${suffix}`,
    leagueRef: externalLeagueRef(OFFICIAL_PROVIDER, `scale-${suffix}`),
  };
}

function scaleSource(configuration: LeagueConfiguration): LeagueWeekState {
  const participants = MANAGER_TEAMS.map((team, index) => {
    const rosterRef = externalRosterRef(configuration.leagueRef, String(index + 1));
    return {
      rosterRef,
      managerName: `${configuration.key} Manager ${index + 1}`,
      teamName: `${configuration.key} ${team} Team`,
      avatarUrl: null,
      wins: 0,
      losses: 0,
      ties: 0,
      pointsFor: 0,
      pointsAgainst: 0,
    };
  });
  const entities: ScoringEntity[] = MANAGER_TEAMS.map((team, index) => {
    const position = POSITIONS[index % POSITIONS.length];
    return {
      kind: 'player',
      externalRef: externalPlayerRef(OFFICIAL_PROVIDER, `coverage-${team}-${position}`),
      displayName: `${team} ${position}`,
      nflTeam: team,
      position,
      injuryStatus: null,
    };
  });
  const matchups = Array.from({ length: MANAGER_TEAMS.length / 2 }, (_, matchupIndex) => ({
    matchupId: String(matchupIndex + 1),
    status: 'live' as const,
    sides: [matchupIndex * 2, (matchupIndex * 2) + 1].map((index) => ({
      rosterRef: participants[index].rosterRef,
      officialPoints: index + 0.5,
      starters: [{
        kind: 'occupied' as const,
        slot: entities[index].position,
        entity: entities[index],
        officialPoints: index + 0.5,
      }],
    })),
  }));
  return {
    configuration,
    leagueName: configuration.displayName,
    period: PERIOD,
    maxWeek: 18,
    rosterPositions: [...POSITIONS],
    participants,
    matchups,
    rosteredEntities: entities,
    schedule: fullWeekSchedule(),
    scoringSettings: {
      provider: OFFICIAL_PROVIDER,
      rawRules: { pass_yd: 0.04, rush_yd: 0.1, rec: 0.5, rec_yd: 0.1 },
    },
    requestStartedAt: REQUEST_STARTED_AT,
    requestCompletedAt: REQUEST_COMPLETED_AT,
    observedAt: REQUEST_COMPLETED_AT,
    sourceRevision: compatibleRevision({ leagueKey: configuration.key, period: PERIOD }),
    warning: undefined,
  };
}

function scaleCadence(configuration: LeagueConfiguration): LeagueCadenceState {
  return {
    configuration,
    period: PERIOD,
    currentPeriod: { season: PERIOD.season, week: PERIOD.week, seasonType: PERIOD.seasonType },
    schedule: fullWeekSchedule(),
  };
}

function scaleGameStates(): GameStateSlate {
  const schedule = fullWeekSchedule();
  const games: GameStateObservation[] = [];
  for (const homeTeam of NFL_TEAM_CODES) {
    const game = schedule[homeTeam];
    if (game?.kind !== 'scheduled' || game.location !== 'home') continue;
    const gameId = `${game.opponent}-${homeTeam}`;
    games.push({
      gameRef: externalGameRef(GAME_STATE_PROVIDER, gameId),
      period: PERIOD,
      homeTeam,
      awayTeam: game.opponent,
      statusCode: 1,
      statusText: 'Halftime',
      sourcePeriod: 'Halftime',
      gameClock: null,
      phase: 'halftime',
      clockSeconds: null,
      remainingFraction: 0.5,
      homeScore: null,
      awayScore: null,
      requestStartedAt: REQUEST_COMPLETED_AT,
      requestCompletedAt: GAME_OBSERVED_AT,
      observedAt: GAME_OBSERVED_AT,
      sourceRevision: compatibleRevision({ gameId, phase: 'halftime' }),
    });
  }
  return {
    source: GAME_STATE_PROVIDER,
    period: PERIOD,
    requestStartedAt: REQUEST_COMPLETED_AT,
    requestCompletedAt: GAME_OBSERVED_AT,
    observedAt: GAME_OBSERVED_AT,
    games,
  };
}

type ScaleMetrics = Readonly<{
  meter: AsyncOperationMeter;
  leaguePeak: number;
  peakProviderGroupConcurrency: number;
  peakRetainedGroupSlates: number;
  clockCalls: number;
  idCalls: number;
  assessmentCalls: number;
  normalizationCalls: number;
  logs: readonly Readonly<{ level: LogLevel; entry: ProjectionLogEntry }>[];
}>;

type ScaleRun = Readonly<{
  result: LiveProjectionSyncResult;
  metrics: ScaleMetrics;
  executionDurationMs: number;
  operationCount: number;
  publishInputs: readonly PublishSnapshotInput[];
  gameResolutionBatchSizes: readonly number[];
  gameStateBatchSizes: readonly number[];
  entityResolutionBatchSizes: readonly number[];
  candidateBatchSizes: readonly number[];
  digest: string;
}>;

function stablePublishDigest(inputs: readonly PublishSnapshotInput[]): string {
  const ordered = [...inputs].sort((left, right) => (
    String(left.leagueSeasonId).localeCompare(String(right.leagueSeasonId))
  ));
  return createHash('sha256').update(JSON.stringify(ordered)).digest('hex');
}

function firstStart(trace: readonly TraceEntry[], operation: string): number {
  return trace.indexOf(`${operation}:start`);
}

function lastFinish(trace: readonly TraceEntry[], operation: string): number {
  return trace.lastIndexOf(`${operation}:finish`);
}

async function runScaleScenario(leagueCount: number): Promise<ScaleRun> {
  const configurations = Array.from({ length: leagueCount }, (_, index) => scaleConfiguration(index));
  const sources = new Map(configurations.map((configuration) => [
    configuration.key,
    scaleSource(configuration),
  ]));
  const games = scaleGameStates();
  const projections = projectionResult();
  const fake = fakeStore();
  const meter = new AsyncOperationMeter();
  const parallelLeagues = Math.min(leagueCount, 8);
  const sourceWave = new OneShotBarrier(parallelLeagues);
  const leagueWave = new OneShotBarrier(parallelLeagues);
  const readWave = new OneShotBarrier(parallelLeagues * 3);
  const providerPair = new OneShotBarrier(2);
  const logs: Array<Readonly<{ level: LogLevel; entry: ProjectionLogEntry }>> = [];
  const activeProviderParts = new Map<string, number>();
  const completedProviderParts = new Map<string, number>();
  const retainedGroups = new Set<string>();
  let peakProviderGroupConcurrency = 0;
  let peakRetainedGroupSlates = 0;
  let activeLeagues = 0;
  let leaguePeak = 0;
  let clockCalls = 0;
  let idCalls = 0;
  let assessmentCalls = 0;
  let normalizationCalls = 0;
  const gameResolutionBatchSizes: number[] = [];
  const gameStateBatchSizes: number[] = [];
  const entityResolutionBatchSizes: number[] = [];

  const providerGroupKey = () => JSON.stringify([PERIOD.season, PERIOD.seasonType, PERIOD.week]);
  const markProviderPartStart = () => {
    const group = providerGroupKey();
    activeProviderParts.set(group, (activeProviderParts.get(group) ?? 0) + 1);
    peakProviderGroupConcurrency = Math.max(
      peakProviderGroupConcurrency,
      activeProviderParts.size,
    );
  };
  const markProviderPartComplete = () => {
    const group = providerGroupKey();
    const remaining = (activeProviderParts.get(group) ?? 1) - 1;
    if (remaining === 0) activeProviderParts.delete(group);
    else activeProviderParts.set(group, remaining);
    const completed = (completedProviderParts.get(group) ?? 0) + 1;
    completedProviderParts.set(group, completed);
    if (completed === 2) {
      retainedGroups.add(group);
      peakRetainedGroupSlates = Math.max(peakRetainedGroupSlates, retainedGroups.size);
    }
  };

  const repository: ProjectionRepositoryPort = {
    ...fake.repository,
    acquireJob: (input) => meter.run('repository.acquireJob', () => fake.repository.acquireJob(input)),
    completeJob: (jobKey, workerId) => meter.run(
      'repository.completeJob',
      () => fake.repository.completeJob(jobKey, workerId),
    ),
    failJob: (jobKey, workerId, message) => meter.run(
      'repository.failJob',
      () => fake.repository.failJob(jobKey, workerId, message),
    ),
    registerLeagueSeason: async (input) => {
      activeLeagues += 1;
      leaguePeak = Math.max(leaguePeak, activeLeagues);
      try {
        return await meter.run(
          'repository.registerLeagueSeason',
          async () => {
            await leagueWave.wait();
            return fake.repository.registerLeagueSeason(input);
          },
        );
      } catch (error) {
        activeLeagues -= 1;
        throw error;
      }
    },
    recordProjectionCandidates: (input) => meter.run(
      'repository.recordProjectionCandidates',
      () => fake.repository.recordProjectionCandidates(input),
    ),
    readLatestCandidates: (input) => meter.run(
      'repository.readLatestCandidates',
      async () => {
        await readWave.wait();
        return fake.repository.readLatestCandidates(input);
      },
    ),
    freezeLatestBaselines: (input) => meter.run(
      'repository.freezeLatestBaselines',
      () => fake.repository.freezeLatestBaselines(input),
    ),
    readFrozenBaselines: (input) => meter.run(
      'repository.readFrozenBaselines',
      async () => {
        await readWave.wait();
        return fake.repository.readFrozenBaselines(input);
      },
    ),
    recordGameStates: (input) => meter.run(
      'repository.recordGameStates',
      async () => {
        gameStateBatchSizes.push(input.states.length);
        return fake.repository.recordGameStates(input);
      },
    ),
    recordProjectionSlate: (input) => meter.run(
      'repository.recordProjectionSlate',
      () => fake.repository.recordProjectionSlate(input),
    ),
    recordLeagueWeekObservation: (input) => meter.run(
      'repository.recordLeagueWeekObservation',
      () => fake.repository.recordLeagueWeekObservation(input),
    ),
    publishSnapshot: async (input) => {
      try {
        return await meter.run(
          'repository.publishSnapshot',
          () => fake.repository.publishSnapshot(input),
        );
      } finally {
        activeLeagues -= 1;
      }
    },
    pruneHistory: (input) => meter.run(
      'repository.pruneHistory',
      () => fake.repository.pruneHistory(input),
    ),
    readCurrentSnapshot: (leagueSeasonId, period) => meter.run(
      'repository.readCurrentSnapshot',
      async () => {
        await readWave.wait();
        return fake.repository.readCurrentSnapshot(leagueSeasonId, period);
      },
    ),
  };
  const identityCrosswalk: IdentityCrosswalkPort = {
    ...fake.identityCrosswalk,
    resolveNflGames: (inputs) => meter.run(
      'identity.resolveNflGames',
      async () => {
        gameResolutionBatchSizes.push(inputs.length);
        return fake.identityCrosswalk.resolveNflGames(inputs);
      },
    ),
    resolveScoringEntities: (inputs) => meter.run(
      'identity.resolveScoringEntities',
      async () => {
        entityResolutionBatchSizes.push(inputs.length);
        return fake.identityCrosswalk.resolveScoringEntities(inputs);
      },
    ),
  };
  const dependencies: LiveProjectionWorkerDependencies = {
    repository,
    identityCrosswalk,
    leagueRegistry: { listActiveLeagues: () => configurations },
    nflCalendar: {
      getCadenceState: (configuration) => meter.run(
        'calendar.getCadenceState',
        async () => scaleCadence(configuration),
      ),
    },
    leagueSource: {
      getLeagueWeek: (configuration) => meter.run(
        'leagueSource.getLeagueWeek',
        async () => {
          await sourceWave.wait();
          return sources.get(configuration.key)!;
        },
      ),
    },
    projectionFeed: {
      getProjectionSlate: (period) => {
        markProviderPartStart();
        return meter.run('feed.getProjectionSlate', async () => {
          await providerPair.wait();
          return { status: 'available' as const, slate: { ...projections, period } };
        }).finally(markProviderPartComplete);
      },
      assessProjectionSlate: (slate, schedule) => {
        assessmentCalls += 1;
        return assessProjectionSlate(slate, schedule);
      },
    },
    gameStateFeed: {
      getGameStateSlate: (period) => {
        markProviderPartStart();
        return meter.run('feed.getGameStateSlate', async () => {
          await providerPair.wait();
          return { status: 'available' as const, slate: { ...games, period } };
        }).finally(markProviderPartComplete);
      },
    },
    normalizeScoringProfile: (settings) => {
      normalizationCalls += 1;
      return normalizeSleeperScoringProfile(settings);
    },
    clock: {
      now: () => {
        clockCalls += 1;
        return new Date(NOW);
      },
      monotonicNow: (() => {
        let value = 0;
        return () => {
          value += 1;
          return value;
        };
      })(),
    },
    idGenerator: {
      generate: () => {
        idCalls += 1;
        return 'scale-worker';
      },
    },
    logger: {
      write: (level, entry) => logs.push({ level, entry }),
    },
  };

  const executionStartedAt = performance.now();
  const result = await runWithDependencies(dependencies);
  const executionDurationMs = performance.now() - executionStartedAt;
  return {
    result,
    metrics: {
      meter,
      leaguePeak,
      peakProviderGroupConcurrency,
      peakRetainedGroupSlates,
      clockCalls,
      idCalls,
      assessmentCalls,
      normalizationCalls,
      logs,
    },
    executionDurationMs,
    operationCount: fake.operations.length,
    publishInputs: fake.publishInputs,
    gameResolutionBatchSizes,
    gameStateBatchSizes,
    entityResolutionBatchSizes,
    candidateBatchSizes: fake.candidateBatches.map((batch) => batch.length),
    digest: stablePublishDigest(fake.publishInputs),
  };
}

/**
 * These synthetic cases prove bounded orchestration and deterministic work growth.
 * They do not benchmark provider latency, Neon throughput, or Vercel runtime capacity.
 * Each 12-manager league uses one starter per manager so the suite isolates
 * orchestration and sharing behavior rather than claiming a full-roster CPU benchmark.
 * The 300-league case still exceeds a safe single 60-second function/120-second
 * lease design under ordinary remote latency; sharding and lease renewal remain
 * deferred scale architecture rather than a failure patched by this test.
 */
describe.each(SCALE_POINTS)('canonical worker scale readiness: %i leagues', (leagueCount) => {
  it('bounds shared feeds and parallel league work while preserving deterministic output', async () => {
    const first = await runScaleScenario(leagueCount);
    const second = await runScaleScenario(leagueCount);
    const expectedParallelLeagues = Math.min(leagueCount, 8);
    const expectedOutstanding = expectedParallelLeagues * 3;

    expect(first.result).toEqual({
      status: 'completed',
      cadence: 'live-window',
      publishedLeagues: leagueCount,
      failedLeagues: 0,
      providerGroups: 1,
    });
    expect(second.result).toEqual(first.result);
    expect(first.digest).toBe(second.digest);
    expect(first.publishInputs).toEqual(second.publishInputs);
    expect([...first.metrics.meter.counts].sort()).toEqual([...second.metrics.meter.counts].sort());
    expect(Number.isFinite(first.executionDurationMs)).toBe(true);
    expect(first.executionDurationMs).toBeGreaterThanOrEqual(0);
    expect(first.publishInputs.map((input) => input.revisionKey).sort()).toEqual(
      second.publishInputs.map((input) => input.revisionKey).sort(),
    );
    expect(first.publishInputs).toHaveLength(leagueCount);
    expect(new Set(first.publishInputs.map((input) => String(input.leagueSeasonId))).size)
      .toBe(leagueCount);
    expect(new Set(first.publishInputs.map((input) => input.revisionKey)).size)
      .toBe(leagueCount);
    expect(new Set(first.publishInputs.map((input) => input.payload.teams[0]?.name)).size)
      .toBe(leagueCount);
    expect(first.publishInputs.every((input) => (
      input.payload.teams.length === 12
      && input.payload.matchups.length === 6
      && input.payload.matchups.every((matchup) => matchup.sides.length === 2)
    ))).toBe(true);

    const { meter } = first.metrics;
    expect(meter.count('calendar.getCadenceState')).toBe(1);
    expect(meter.count('leagueSource.getLeagueWeek')).toBe(leagueCount);
    // This port-level harness observes one shared projection slate and one shared
    // game slate. Tank adapter tests independently lock cold-cache HTTP calls at
    // two endpoints and warm-cache HTTP calls at zero; network caching is not
    // simulated here.
    expect(meter.count('feed.getProjectionSlate')).toBe(1);
    expect(meter.count('feed.getGameStateSlate')).toBe(1);
    expect(first.metrics.assessmentCalls).toBe(leagueCount);
    expect(first.metrics.normalizationCalls).toBe(leagueCount);
    expect(first.metrics.clockCalls).toBe(1);
    expect(first.metrics.idCalls).toBe(1);

    expect(meter.count('identity.resolveNflGames')).toBe(1);
    expect(meter.count('identity.resolveScoringEntities')).toBe(1);
    expect(first.gameResolutionBatchSizes).toEqual([16]);
    expect(first.gameStateBatchSizes).toEqual([16]);
    expect(first.entityResolutionBatchSizes).toEqual([12]);
    expect(first.candidateBatchSizes).toHaveLength(leagueCount);
    expect(first.candidateBatchSizes.every((size) => size === 12)).toBe(true);
    expect(meter.count('repository.acquireJob')).toBe(1);
    expect(meter.count('repository.recordGameStates')).toBe(1);
    expect(meter.count('repository.recordProjectionSlate')).toBe(1);
    expect(meter.count('repository.completeJob')).toBe(1);
    expect(meter.count('repository.failJob')).toBe(0);
    expect(meter.count('repository.pruneHistory')).toBe(0);
    for (const operation of [
      'repository.registerLeagueSeason',
      'repository.recordProjectionCandidates',
      'repository.freezeLatestBaselines',
      'repository.readLatestCandidates',
      'repository.readFrozenBaselines',
      'repository.readCurrentSnapshot',
      'repository.recordLeagueWeekObservation',
      'repository.publishSnapshot',
    ]) {
      expect(meter.count(operation), operation).toBe(leagueCount);
    }
    expect(first.operationCount).toBe((8 * leagueCount) + 6);

    expect(meter.peak('leagueSource.getLeagueWeek')).toBe(expectedParallelLeagues);
    expect(first.metrics.leaguePeak).toBe(expectedParallelLeagues);
    expect(meter.peak('feed.getProjectionSlate')).toBe(1);
    expect(meter.peak('feed.getGameStateSlate')).toBe(1);
    expect(first.metrics.peakProviderGroupConcurrency).toBe(1);
    expect(Math.max(
      firstStart(meter.trace, 'feed.getProjectionSlate'),
      firstStart(meter.trace, 'feed.getGameStateSlate'),
    )).toBeLessThan(Math.min(
      lastFinish(meter.trace, 'feed.getProjectionSlate'),
      lastFinish(meter.trace, 'feed.getGameStateSlate'),
    ));
    // All eligible sources are constrained to the selected NFL period, so only
    // one group-slate pair can be retained by this canonical run.
    expect(first.metrics.peakRetainedGroupSlates).toBe(1);
    expect(meter.peakOutstanding).toBe(expectedOutstanding);
    expect(meter.outstanding).toBe(0);

    const trace = meter.trace;
    expect(lastFinish(trace, 'calendar.getCadenceState'))
      .toBeLessThan(firstStart(trace, 'repository.acquireJob'));
    expect(lastFinish(trace, 'repository.acquireJob'))
      .toBeLessThan(firstStart(trace, 'leagueSource.getLeagueWeek'));
    expect(lastFinish(trace, 'leagueSource.getLeagueWeek'))
      .toBeLessThan(firstStart(trace, 'feed.getProjectionSlate'));
    expect(Math.max(
      lastFinish(trace, 'feed.getProjectionSlate'),
      lastFinish(trace, 'feed.getGameStateSlate'),
    )).toBeLessThan(firstStart(trace, 'identity.resolveNflGames'));
    expect(lastFinish(trace, 'identity.resolveNflGames'))
      .toBeLessThan(firstStart(trace, 'repository.recordGameStates'));
    expect(lastFinish(trace, 'repository.recordGameStates'))
      .toBeLessThan(firstStart(trace, 'identity.resolveScoringEntities'));
    expect(lastFinish(trace, 'identity.resolveScoringEntities'))
      .toBeLessThan(firstStart(trace, 'repository.recordProjectionSlate'));
    expect(lastFinish(trace, 'repository.recordProjectionSlate'))
      .toBeLessThan(firstStart(trace, 'repository.registerLeagueSeason'));
    expect(lastFinish(trace, 'repository.publishSnapshot'))
      .toBeLessThan(firstStart(trace, 'repository.completeJob'));

    const completedStages = first.metrics.logs
      .filter(({ entry }) => entry.outcome === 'completed')
      .reduce<Record<string, number>>((counts, { entry }) => {
        counts[entry.stage] = (counts[entry.stage] ?? 0) + 1;
        return counts;
      }, {});
    expect(completedStages).toEqual({
      'league-load': 1,
      'provider-load': 1,
      'provider-persist': 1,
      'league-publish': leagueCount,
      run: 1,
    });
    const leagueLoadLog = first.metrics.logs.find(({ entry }) => (
      entry.stage === 'league-load' && entry.outcome === 'completed'
    ));
    const providerLoadLog = first.metrics.logs.find(({ entry }) => (
      entry.stage === 'provider-load' && entry.outcome === 'completed'
    ));
    const runLog = first.metrics.logs.find(({ entry }) => (
      entry.stage === 'run' && entry.outcome === 'completed'
    ));
    expect(leagueLoadLog?.entry.stageDurationMs).toEqual(expect.any(Number));
    expect(providerLoadLog?.entry.providerDurationMs).toEqual(expect.any(Number));
    expect(runLog?.entry.totalDurationMs).toEqual(expect.any(Number));
    expect(leagueLoadLog!.entry.stageDurationMs!).toBeGreaterThanOrEqual(0);
    expect(providerLoadLog!.entry.providerDurationMs!).toBeGreaterThanOrEqual(0);
    expect(runLog!.entry.totalDurationMs!).toBeGreaterThanOrEqual(0);
    expect(first.metrics.logs.filter(({ level }) => level === 'warn' || level === 'error'))
      .toEqual([]);
  }, 20_000);
});
