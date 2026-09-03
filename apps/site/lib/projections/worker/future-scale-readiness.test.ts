import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('next/cache', () => ({ unstable_cache: <Value,>(value: Value) => value }));

import {
  OFFICIAL_PROVIDER,
  PROJECTION_PROVIDER,
  fakeStore,
  fullWeekSchedule,
  projectionResult,
  workerDependencies,
  type FakeStore,
} from '../../live-projection-worker.fixtures';
import type {
  GameStateObservation,
  GameStateSlate,
  LeagueConfiguration,
  LeaguePeriod,
  LeagueWeekState,
  NflTeam,
  ProjectionSlate,
  ScoringEntity,
} from '../domain/contracts';
import type {
  FutureProjectionSlateContentId,
  FutureProjectionSlateLineage,
  FutureProjectionSlateObservationId,
  FutureRefreshPlanPeriod,
} from '../ports/future-refresh-repository';
import type { PublishSnapshotInput } from '../ports/projection-repository';
import {
  externalLeagueRef,
  externalGameRef,
  externalPlayerRef,
  externalRosterRef,
} from '../shared/provider-identity';
import { compatibleRevision } from '../shared/revision-compatibility';
import { runFutureProjectionStage } from './future-projection-stage';
import { runFutureMaterializationStage } from './future-materialization-stage';
import { futureDependencies } from './future-fixtures';
import { assessLineupWatchCapacity } from './lineup-watch-policy';
import type { FutureProjectionWorkerDependencies } from './future-contracts';
import type { FutureWorkTiming } from './future-work-runtime';

const FLEET_SIZES = [2, 3, 50, 300] as const;
const FUTURE_PERIOD: LeaguePeriod = { season: 2026, seasonType: 'regular', week: 2 };
const NOW = new Date('2026-09-13T18:10:10.000Z');
const FUTURE_KICKOFF = '2026-09-20T17:00:00.000Z';
const FUTURE_SCHEDULE = fullWeekSchedule(FUTURE_KICKOFF);
const NEVER_DUE = '2027-01-01T00:00:00.000Z';
const MANAGER_TEAMS = [
  'ARI', 'ATL', 'BAL', 'BUF', 'CAR', 'CHI',
  'CIN', 'CLE', 'DAL', 'DEN', 'DET', 'GB',
] as const satisfies readonly NflTeam[];
const POSITIONS = ['QB', 'RB', 'WR', 'TE'] as const;
const STORED_LINEAGE: FutureProjectionSlateLineage = {
  observationId: 'projection-slate-observation' as FutureProjectionSlateObservationId,
  contentId: 'projection-slate-content' as FutureProjectionSlateContentId,
};

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

class AsyncMeter {
  readonly counts = new Map<string, number>();
  readonly peaks = new Map<string, number>();
  private readonly active = new Map<string, number>();
  outstanding = 0;
  peakOutstanding = 0;

  async run<Value>(operation: string, action: () => Promise<Value>): Promise<Value> {
    this.counts.set(operation, (this.counts.get(operation) ?? 0) + 1);
    const active = (this.active.get(operation) ?? 0) + 1;
    this.active.set(operation, active);
    this.peaks.set(operation, Math.max(this.peaks.get(operation) ?? 0, active));
    this.outstanding += 1;
    this.peakOutstanding = Math.max(this.peakOutstanding, this.outstanding);
    try {
      return await action();
    } finally {
      this.active.set(operation, (this.active.get(operation) ?? 1) - 1);
      this.outstanding -= 1;
    }
  }

  count(operation: string): number {
    return this.counts.get(operation) ?? 0;
  }

  peak(operation: string): number {
    return this.peaks.get(operation) ?? 0;
  }
}

function configuration(index: number): LeagueConfiguration {
  const suffix = String(index + 1).padStart(3, '0');
  return {
    key: `future-scale-${suffix}`,
    displayName: `Future Scale League ${suffix}`,
    leagueRef: externalLeagueRef(OFFICIAL_PROVIDER, `future-scale-${suffix}`),
    matchupWeekRange: { firstWeek: 1, lastWeek: 18 },
  };
}

function futureSource(configuration: LeagueConfiguration): LeagueWeekState {
  const requestStartedAt = '2026-09-13T18:10:05.000Z';
  const requestCompletedAt = '2026-09-13T18:10:06.000Z';
  const participants = MANAGER_TEAMS.map((team, index) => ({
    rosterRef: externalRosterRef(configuration.leagueRef, String(index + 1)),
    managerName: `${configuration.key} Manager ${index + 1}`,
    teamName: `${configuration.key} ${team} Team`,
    avatarUrl: null,
    wins: 0,
    losses: 0,
    ties: 0,
    pointsFor: 0,
    pointsAgainst: 0,
  }));
  const rosteredEntities: ScoringEntity[] = MANAGER_TEAMS.map((team, index) => {
    const position = POSITIONS[index % POSITIONS.length];
    return {
      kind: 'player',
      externalRef: externalPlayerRef(
        OFFICIAL_PROVIDER,
        `coverage-${team}-${position}`,
      ),
      displayName: `${team} ${position}`,
      nflTeam: team,
      position,
      injuryStatus: null,
    };
  });
  return {
    configuration,
    lineup: { revisionVersion: 'lineup-v1', lineupRevision: `lineup-${configuration.key}` },
    lineupShape: { expectedRosterCount: 12, expectedStarterSlotCount: 1,
      expectedRosterRefs: participants.map((participant) => participant.rosterRef) },
    leagueName: configuration.displayName,
    period: FUTURE_PERIOD,
    maxWeek: 18,
    rosterPositions: [...POSITIONS],
    participants,
    matchups: Array.from({ length: MANAGER_TEAMS.length / 2 }, (_, matchupIndex) => ({
      matchupId: String(matchupIndex + 1),
      status: 'unknown' as const,
      sides: [matchupIndex * 2, (matchupIndex * 2) + 1].map((index) => ({
        rosterRef: participants[index].rosterRef,
        officialPoints: 0,
        starters: [{
          kind: 'occupied' as const,
          slot: rosteredEntities[index].position,
          entity: rosteredEntities[index],
          officialPoints: 0,
        }],
      })),
    })),
    rosteredEntities,
    schedule: FUTURE_SCHEDULE,
    scoringSettings: {
      provider: OFFICIAL_PROVIDER,
      rawRules: { pass_yd: 0.04, rush_yd: 0.1, rec: 0.5, rec_yd: 0.1 },
    },
    requestStartedAt,
    requestCompletedAt,
    observedAt: requestCompletedAt,
    sourceRevision: compatibleRevision({
      leagueKey: configuration.key,
      period: FUTURE_PERIOD,
      requestStartedAt,
      requestCompletedAt,
    }),
  };
}

function futureGameStates(period = FUTURE_PERIOD): GameStateSlate {
  const games: GameStateObservation[] = [];
  for (const [team, schedule] of Object.entries(FUTURE_SCHEDULE)) {
    if (!schedule || schedule.kind !== 'scheduled' || schedule.location !== 'home') continue;
    const homeTeam = team as NflTeam;
    const gameId = `${schedule.opponent}-${homeTeam}`;
    games.push({
      gameRef: externalGameRef(PROJECTION_PROVIDER, gameId),
      period,
      homeTeam,
      awayTeam: schedule.opponent,
      statusCode: 0,
      statusText: 'Scheduled',
      sourcePeriod: null,
      gameClock: null,
      phase: 'pregame',
      clockSeconds: null,
      remainingFraction: 1,
      homeScore: null,
      awayScore: null,
      requestStartedAt: '2026-09-13T18:10:06.000Z',
      requestCompletedAt: '2026-09-13T18:10:07.000Z',
      observedAt: '2026-09-13T18:10:07.000Z',
      sourceRevision: compatibleRevision({ gameId, period, phase: 'pregame' }),
    });
  }
  return {
    source: PROJECTION_PROVIDER,
    period,
    requestStartedAt: '2026-09-13T18:10:06.000Z',
    requestCompletedAt: '2026-09-13T18:10:07.000Z',
    observedAt: '2026-09-13T18:10:07.000Z',
    games,
  };
}

function projectionState(
  mode: 'ingest' | 'materialize' | 'idle',
): FutureRefreshPlanPeriod['projection'] {
  return {
    nextRefreshAt: mode === 'ingest' ? NOW.toISOString() : NEVER_DUE,
    lastAttemptedAt: null,
    lastSucceededAt: mode === 'materialize' ? '2026-09-13T18:00:00.000Z' : null,
    consecutiveFailures: 0,
    lastFailureCode: null,
    activeAttemptExpiresAt: null,
    lastSlate: mode === 'materialize' ? STORED_LINEAGE : null,
    currentSlate: mode === 'materialize' ? STORED_LINEAGE : null,
    due: mode === 'ingest',
  };
}

function materializationState(
  leagueKey: string,
  due: boolean,
): FutureRefreshPlanPeriod['materializations'][number] {
  return {
    leagueKey,
    nextRefreshAt: due ? NOW.toISOString() : NEVER_DUE,
    lastAttemptedAt: null,
    lastSucceededAt: null,
    lastSourceRevision: null,
    lastSlate: null,
    lastSnapshotRevision: null,
    consecutiveFailures: 0,
    lastFailureCode: null,
    activeAttemptExpiresAt: null,
    due,
  };
}

function futurePlans(
  configurations: readonly LeagueConfiguration[],
  action: 'ingest' | 'materialize',
): FutureRefreshPlanPeriod[] {
  return Array.from({ length: 17 }, (_, index) => {
    const week = index + 2;
    const selected = week === FUTURE_PERIOD.week;
    const materializations = configurations.map((candidate) => (
      materializationState(candidate.key, selected && action === 'materialize')
    ));
    return {
      period: { season: 2026, seasonType: 'regular', week },
      weekDistance: index + 1,
      projection: projectionState(selected ? action : 'idle'),
      materializations,
      successfulMaterializations: 0,
      expectedMaterializations: configurations.length,
    };
  });
}

function timing(): FutureWorkTiming {
  return {
    wallStartedAtMs: NOW.getTime(),
    monotonicStartedAt: 0,
  };
}

function digest(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function publishedDigest(inputs: readonly PublishSnapshotInput[]): string {
  return digest([...inputs].sort((left, right) => (
    String(left.leagueSeasonId).localeCompare(String(right.leagueSeasonId))
  )));
}

async function runIngestScenario(leagueCount: number) {
  const configurations = Array.from({ length: leagueCount }, (_, index) => configuration(index));
  const store = fakeStore();
  const dependencies = futureDependencies(workerDependencies(store, { now: NOW }), store);
  const recordedSlates: ProjectionSlate[] = [];
  const recordProjectionSlate = store.repository.recordProjectionSlate.bind(store.repository);
  vi.spyOn(store.repository, 'recordProjectionSlate').mockImplementation(async (slate) => {
    recordedSlates.push(slate);
    return recordProjectionSlate(slate);
  });
  store.readFuturePlan.mockResolvedValue(futurePlans(configurations, 'ingest'));
  dependencies.projectionMock.mockResolvedValue({
    status: 'available',
    slate: projectionResult(FUTURE_PERIOD),
  });
  dependencies.loggerMock.mockImplementation(() => undefined);

  const result = await runScaleStage(dependencies, configurations, store, 'projection-ingest');
  return {
    result,
    slateDigest: digest(recordedSlates),
    recordedSlates,
    store,
    dependencies,
    configurations,
  };
}

type MaterializationRun = Readonly<{
  result: Awaited<ReturnType<typeof runScaleStage>>;
  store: FakeStore;
  digest: string;
  meter: AsyncMeter;
  pipelinePeak: number;
  activePipelines: number;
  configurations: readonly LeagueConfiguration[];
  projectionFeedCalls: number;
  gameStateFeedCalls: number;
  assessmentCalls: number;
  currentSlateReads: number;
}>;

async function runMaterializationScenario(leagueCount: number): Promise<MaterializationRun> {
  const configurations = Array.from({ length: leagueCount }, (_, index) => configuration(index));
  const store = fakeStore();
  await store.repository.recordProjectionSlate(projectionResult(FUTURE_PERIOD));
  store.operations.splice(0);
  const dependencies = futureDependencies(workerDependencies(store, { now: NOW }), store);
  const meter = new AsyncMeter();
  const parallelLeagues = Math.min(leagueCount, 8);
  const sourceWave = new OneShotBarrier(parallelLeagues);
  const pipelineWave = new OneShotBarrier(parallelLeagues);
  const readWave = new OneShotBarrier(parallelLeagues * 3);
  let activePipelines = 0;
  let pipelinePeak = 0;
  let currentSlateReads = 0;

  store.readFuturePlan.mockResolvedValue(futurePlans(configurations, 'materialize'));
  dependencies.sourceMock.mockImplementation((candidate: LeagueConfiguration) => (
    meter.run('league-source', async () => {
      await sourceWave.wait();
      return futureSource(candidate);
    })
  ));
  dependencies.projectionMock.mockResolvedValue({
    status: 'available',
    slate: projectionResult(FUTURE_PERIOD),
  });
  dependencies.gamesMock.mockImplementation((period: LeaguePeriod) => (
    meter.run('game-state-feed', async () => ({
      status: 'available' as const,
      slate: futureGameStates(period),
    }))
  ));
  dependencies.loggerMock.mockImplementation(() => undefined);

  const readCurrentProjectionSlate = store.repository.readCurrentProjectionSlate
    .bind(store.repository);
  vi.spyOn(store.repository, 'readCurrentProjectionSlate').mockImplementation((...args) => (
    meter.run('read-current-slate', async () => {
      currentSlateReads += 1;
      return readCurrentProjectionSlate(...args);
    })
  ));

  const resolveNflGames = vi.mocked(store.identityCrosswalk.resolveNflGames);
  const resolveNflGamesImplementation = resolveNflGames.getMockImplementation()!;
  resolveNflGames.mockImplementation((inputs) => (
    meter.run('resolve-games', () => resolveNflGamesImplementation(inputs))
  ));
  const recordGameStatesImplementation = (
    store.recordedStates.getMockImplementation()
  ) as typeof store.repository.recordGameStates;
  store.recordedStates.mockImplementation((input) => (
    meter.run('record-game-states', () => recordGameStatesImplementation(input))
  ));
  const resolveScoringEntities = vi.mocked(store.identityCrosswalk.resolveScoringEntities);
  const resolveScoringEntitiesImplementation = resolveScoringEntities.getMockImplementation()!;
  resolveScoringEntities.mockImplementation((inputs) => (
    meter.run('resolve-entities', () => resolveScoringEntitiesImplementation(inputs))
  ));

  const registerLeagueSeason = store.repository.registerLeagueSeason.bind(store.repository);
  vi.spyOn(store.repository, 'registerLeagueSeason').mockImplementation((input) => (
    meter.run('register-league', async () => {
      activePipelines += 1;
      pipelinePeak = Math.max(pipelinePeak, activePipelines);
      await pipelineWave.wait();
      try {
        return await registerLeagueSeason(input);
      } catch (error) {
        activePipelines -= 1;
        throw error;
      }
    })
  ));

  const recordProjectionCandidates = store.repository.recordProjectionCandidates
    .bind(store.repository);
  vi.spyOn(store.repository, 'recordProjectionCandidates').mockImplementation((input) => (
    meter.run('record-candidates', () => recordProjectionCandidates(input))
  ));
  const readLatestCandidates = store.repository.readLatestCandidates.bind(store.repository);
  vi.spyOn(store.repository, 'readLatestCandidates').mockImplementation((input) => (
    meter.run('read-latest', async () => {
      await readWave.wait();
      return readLatestCandidates(input);
    })
  ));
  const readFrozenBaselines = store.repository.readFrozenBaselines.bind(store.repository);
  vi.spyOn(store.repository, 'readFrozenBaselines').mockImplementation((input) => (
    meter.run('read-frozen', async () => {
      await readWave.wait();
      return readFrozenBaselines(input);
    })
  ));
  const readCurrentSnapshot = store.repository.readCurrentSnapshot.bind(store.repository);
  vi.spyOn(store.repository, 'readCurrentSnapshot').mockImplementation((...args) => (
    meter.run('read-snapshot', async () => {
      await readWave.wait();
      return readCurrentSnapshot(...args);
    })
  ));
  const recordLeagueWeekObservation = store.repository.recordLeagueWeekObservation
    .bind(store.repository);
  vi.spyOn(store.repository, 'recordLeagueWeekObservation').mockImplementation((input) => (
    meter.run('record-league-observation', () => recordLeagueWeekObservation(input))
  ));
  const publishSnapshot = store.repository.publishSnapshot.bind(store.repository);
  vi.spyOn(store.repository, 'publishSnapshot').mockImplementation((input) => (
    meter.run('publish-snapshot', () => publishSnapshot(input))
  ));
  store.completeFutureMaterialization.mockImplementation(() => (
    meter.run('complete-materialization', async () => {
      activePipelines -= 1;
      return {
        kind: 'updated' as const,
        consecutiveFailures: 0,
        nextRefreshAt: '2026-09-13T19:10:10.000Z',
        materializationsWoken: 0,
      };
    })
  ));

  const result = await runScaleStage(dependencies, configurations, store, 'materialize');

  return {
    result,
    store,
    digest: publishedDigest(store.publishInputs),
    meter,
    pipelinePeak,
    activePipelines,
    configurations,
    projectionFeedCalls: dependencies.projectionMock.mock.calls.length,
    gameStateFeedCalls: dependencies.gamesMock.mock.calls.length,
    assessmentCalls: dependencies.assessmentMock.mock.calls.length,
    currentSlateReads,
  };
}

async function runScaleStage(
  dependencies: FutureProjectionWorkerDependencies, configurations: readonly LeagueConfiguration[], _store: FakeStore,
  kind: 'projection-ingest' | 'materialize',
) {
  const targets = configurations.map((configuration) => ({ configuration, period: FUTURE_PERIOD,
    shape: { expectedRosterCount: 12, expectedStarterSlotCount: 1,
      expectedRosterRefs: Array.from({length:12},(_,index)=>externalRosterRef(configuration.leagueRef,String(index+1))) },
    authorityGeneration: 1, lineupRevisionVersion: 'lineup-v1' as const, cadencePolicyVersion: 'lineup-cadence-v1',
    watchClass: 'future' as const, materializationLane: 'future' as const, phase: 0 as const,
    initialNextCheckAt: NOW.toISOString() }));
  const synchronized = await dependencies.lineupRepository.synchronizeLineupWatchStates({
    registeredLeagueKeys: configurations.map((configuration) => configuration.key), targets,
  });
  if (synchronized.kind !== 'stored') throw new Error('Synthetic work set unavailable');
  const selection = {kind, period:FUTURE_PERIOD, weekDistance:1, leagueKeys:configurations.map((configuration)=>configuration.key),
    dirty:false,defaultPeriod:false,cadence:'hourly' as const,
    leagueRefresh: configurations.map((configuration) => ({leagueKey:configuration.key,weekDistance:1,defaultPeriod:false,cadence:'hourly' as const}))};
  return kind === 'projection-ingest'
    ? runFutureProjectionStage(dependencies,selection,'future-scale-worker',timing())
    : runFutureMaterializationStage(dependencies,configurations,synchronized.states,selection,
        futurePlans(configurations,'materialize')[0],'future-scale-worker',NOW.toISOString(),timing());
}

/**
 * These are deterministic architecture simulations, not production capacity
 * claims. They prove that the future path shares provider work and keeps the
 * number of active league tasks bounded. Remote provider latency, Neon
 * throughput, Vercel duration, rate limits, and distributed execution still
 * require separate operational tests before fleets of 50 or 300 are enabled.
 */
describe.each(FLEET_SIZES)('future-week scale readiness: %i leagues', (leagueCount) => {
  it('ingests one provider projection slate for the period without per-league calls', async () => {
    const first = await runIngestScenario(leagueCount);
    const second = await runIngestScenario(leagueCount);

    expect(first.result).toEqual({
      status: 'completed',
      providerGroups: 1,
    });
    expect(second.result).toEqual(first.result);
    expect(first.slateDigest).toBe(second.slateDigest);
    expect(first.recordedSlates).toHaveLength(1);
    expect(first.dependencies.projectionMock).toHaveBeenCalledOnce();
    expect(first.dependencies.projectionMock).toHaveBeenCalledWith(FUTURE_PERIOD);
    expect(first.dependencies.gamesMock).not.toHaveBeenCalled();
    expect(first.dependencies.sourceMock).not.toHaveBeenCalled();
    expect(first.store.beginFutureProjection).toHaveBeenCalledOnce();
    expect(first.store.completeFutureProjection).toHaveBeenCalledOnce();
    expect(first.store.beginFutureMaterialization).not.toHaveBeenCalled();
  }, 20_000);

  it('materializes every league from one stored slate and one shared game-state call', async () => {
    const first = await runMaterializationScenario(leagueCount);
    const second = await runMaterializationScenario(leagueCount);
    const parallelLeagues = Math.min(leagueCount, 8);

    expect(first.result).toEqual({
      status: 'completed',
      publishedLeagues: leagueCount,
      unchangedLeagues: 0,
      failedLeagues: 0,
      providerGroups: 1,
    });
    expect(second.result).toEqual(first.result);
    expect(first.digest).toBe(second.digest);
    expect(first.store.publishInputs).toHaveLength(leagueCount);
    expect(new Set(first.store.publishInputs.map((input) => String(input.leagueSeasonId))).size)
      .toBe(leagueCount);
    expect(first.store.publishInputs.map((input) => input.revisionKey).sort()).toEqual(
      second.store.publishInputs.map((input) => input.revisionKey).sort(),
    );
    expect(first.store.publishInputs.every((input) => (
      input.payload.teams.length === 12
      && input.payload.matchups.length === 6
      && input.payload.matchups.every((matchup) => matchup.sides.length === 2)
    ))).toBe(true);

    expect(first.projectionFeedCalls).toBe(0);
    expect(first.gameStateFeedCalls).toBe(1);
    expect(first.currentSlateReads).toBe(1);
    expect(first.assessmentCalls).toBe(leagueCount);
    expect(first.store.beginFutureProjection).not.toHaveBeenCalled();
    expect(first.store.beginFutureMaterialization).toHaveBeenCalledTimes(leagueCount);
    expect(first.store.completeFutureMaterialization).toHaveBeenCalledTimes(leagueCount);
    expect(first.store.failFutureMaterialization).not.toHaveBeenCalled();
    expect(first.store.operations.filter((operation) => operation === 'record-projection-slate'))
      .toHaveLength(0);
    expect(first.meter.count('resolve-games')).toBe(1);
    expect(first.meter.count('record-game-states')).toBe(1);
    expect(first.meter.count('resolve-entities')).toBe(1);
    expect(first.meter.count('league-source')).toBe(leagueCount);
    expect(first.meter.count('register-league')).toBe(leagueCount);
    expect(first.meter.count('record-candidates')).toBe(leagueCount);
    expect(first.meter.count('read-latest')).toBe(leagueCount);
    expect(first.meter.count('read-frozen')).toBe(leagueCount);
    expect(first.meter.count('read-snapshot')).toBe(leagueCount);
    expect(first.meter.count('record-league-observation')).toBe(leagueCount);
    expect(first.meter.count('publish-snapshot')).toBe(leagueCount);
    expect(first.meter.count('complete-materialization')).toBe(leagueCount);

    expect(first.meter.peak('league-source')).toBe(parallelLeagues);
    expect(first.meter.peak('register-league')).toBe(parallelLeagues);
    expect(first.pipelinePeak).toBe(parallelLeagues);
    expect(first.activePipelines).toBe(0);
    expect(first.meter.peakOutstanding).toBe(parallelLeagues * 3);
    expect(first.meter.outstanding).toBe(0);
  }, 20_000);
});

describe.each([50,300])('production watcher capacity guard for %i leagues', (count) => {
  it('refuses to promise one- and three-minute coverage beyond the fixed request budget', () => {
    expect(assessLineupWatchCapacity(count,count*17).status).toBe('capacity-exceeded');
  });
});
