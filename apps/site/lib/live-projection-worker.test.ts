import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('next/cache', () => ({ unstable_cache: <Value,>(value: Value) => value }));
vi.mock('next/server', () => ({ after: vi.fn() }));

import type { WeekSchedule } from './nfl-schedule';
import { NFL_TEAMS, type NflTeam } from './nfl-teams';
import {
  createLiveProjectionWorker,
  LIVE_PROJECTION_MODEL_VERSION,
  type LiveProjectionWorkerDependencies,
} from './live-projection-worker';
import type {
  PlayerProjectionRecord,
  ProjectionStore,
  StoredProjectionSnapshot,
} from './projection-store';
import type { ProjectionCadenceInput, ProjectionSyncInput } from './sleeper';
import type { Tank01GameState, Tank01GameStatesAvailable } from './tank01-game-state';
import type {
  Tank01AvailableResult,
  Tank01DefenseProjection,
  Tank01PlayerProjection,
  Tank01PlayerStats,
} from './tank01';
import type { MatchupsData, Player, Team } from './types';

const NOW = new Date('2026-09-13T18:00:10.000Z');
const KICKOFF = '2026-09-13T17:00:00.000Z';

const teams: readonly Team[] = [
  { id: 1, managerName: 'Left Manager', name: 'Left Team', avatar: null, wins: 0, losses: 0, ties: 0, pointsFor: 0, pointsAgainst: 0 },
  { id: 2, managerName: 'Right Manager', name: 'Right Team', avatar: null, wins: 0, losses: 0, ties: 0, pointsFor: 0, pointsAgainst: 0 },
];

function player(
  id: string,
  name: string,
  position: string,
  nflTeam: 'LAC' | 'KC',
  points: number,
): Player {
  return {
    id,
    name,
    position,
    nflTeam,
    injuryStatus: null,
    slot: position,
    points,
    projectedPoints: null,
    game: {
      kind: 'scheduled',
      opponent: nflTeam === 'LAC' ? 'KC' : 'LAC',
      location: nflTeam === 'LAC' ? 'away' : 'home',
      date: '2026-09-13',
      kickoffAt: KICKOFF,
    },
  };
}

const weekTeams = [
  'LAC', 'KC', 'BUF', 'MIA',
  ...NFL_TEAMS.filter((team) => !['LAC', 'KC', 'BUF', 'MIA'].includes(team)),
] as readonly NflTeam[];

function fullWeekSchedule(kickoffAt = KICKOFF): WeekSchedule {
  const value: WeekSchedule = {};
  for (let index = 0; index < weekTeams.length; index += 2) {
    const away = weekTeams[index];
    const home = weekTeams[index + 1];
    value[away] = { kind: 'scheduled', opponent: home, location: 'away', date: '2026-09-13', kickoffAt };
    value[home] = { kind: 'scheduled', opponent: away, location: 'home', date: '2026-09-13', kickoffAt };
  }
  return value;
}

const schedule = fullWeekSchedule();

function matchupData(leftPoints = [8, 2], rightPoints = [6]): MatchupsData {
  return {
    league: { season: '2026', rosterPositions: ['QB', 'FLEX'], week: 1, maxWeek: 18 },
    teams: [...teams],
    updatedAt: '2026-09-13T18:00:01.000Z',
    week: 1,
    matchups: [{
      id: '1',
      status: 'unknown',
      sides: [
        {
          team: teams[0],
          points: leftPoints.reduce((sum, value) => sum + value, 0),
          projectedPoints: null,
          starters: [
            player('p1', 'Quarter Back', 'QB', 'LAC', leftPoints[0]),
            player('p2', 'Running Back', 'RB', 'LAC', leftPoints[1]),
          ],
        },
        {
          team: teams[1],
          points: rightPoints[0],
          projectedPoints: null,
          starters: [player('p3', 'Other Quarterback', 'QB', 'KC', rightPoints[0])],
        },
      ],
    }],
  };
}

function source(leagueId: string, data = matchupData()): ProjectionSyncInput {
  return {
    sleeperLeagueId: leagueId,
    leagueName: leagueId === 'l1' ? 'League One' : 'League Two',
    scoringSettings: { pass_yd: 0.04, rush_yd: 0.1 },
    data,
    rosteredPlayers: data.matchups.flatMap((matchup) => matchup.sides.flatMap((side) => side.starters)),
    schedule,
    requestStartedAt: '2026-09-13T18:00:00.000Z',
    requestCompletedAt: '2026-09-13T18:00:01.000Z',
  };
}

function cadenceInput(leagueId: string, weeklySchedule = schedule): ProjectionCadenceInput {
  return {
    sleeperLeagueId: leagueId,
    season: '2026',
    week: 1,
    schedule: weeklySchedule,
    currentNflSeason: '2026',
    currentNflWeek: 1,
    currentNflSeasonType: 'regular',
  };
}

function emptyStats(): Tank01PlayerStats {
  return {
    passing: { attempts: null, completions: null, yards: null, touchdowns: null, interceptions: null },
    rushing: { carries: null, yards: null, touchdowns: null },
    receiving: { targets: null, receptions: null, yards: null, touchdowns: null },
    kicking: { fieldGoalsMade: null, fieldGoalsMissed: null, extraPointsMade: null, extraPointsMissed: null },
    twoPointConversions: null,
    fumblesLost: null,
  };
}

function tankPlayer(
  sleeperPlayerId: string,
  team: NflTeam,
  position: 'QB' | 'RB' | 'WR' | 'TE',
  projection: Readonly<{ passingYards?: number; rushingYards?: number }>,
): Tank01PlayerProjection {
  const stats = emptyStats();
  return {
    tank01PlayerId: `tank-${sleeperPlayerId}`,
    sleeperPlayerId,
    team,
    position,
    stats: {
      ...stats,
      passing: { ...stats.passing, yards: projection.passingYards ?? 0 },
      rushing: { ...stats.rushing, yards: projection.rushingYards ?? 0 },
    },
    scoringProjection: {
      kind: 'offense',
      passingYards: projection.passingYards ?? 0,
      rushingYards: projection.rushingYards ?? 0,
    },
    missingFields: [],
  };
}

function tankDefense(team: NflTeam): Tank01DefenseProjection {
  return {
    team,
    stats: {
      returnTouchdowns: 0, defensiveTouchdowns: 0, safeties: 0, fumbleRecoveries: 0,
      pointsAllowed: 0, interceptions: 0, sacks: 0, blockedKicks: 0,
    },
    scoringProjection: { kind: 'defense' },
    missingFields: [],
  };
}

function projectionResult(): Tank01AvailableResult {
  const coveragePlayers = Object.fromEntries(weekTeams.flatMap((team) => (
    (['QB', 'RB', 'WR', 'TE'] as const).map((position) => {
      const id = `coverage-${team}-${position}`;
      return [id, tankPlayer(id, team, position, {})] as const;
    })
  )));
  const defenses = Object.fromEntries(weekTeams.map((team) => [team, tankDefense(team)] as const));
  const players = {
    ...coveragePlayers,
    p1: tankPlayer('p1', 'LAC', 'QB', { passingYards: 250 }),
    p2: tankPlayer('p2', 'LAC', 'RB', { rushingYards: 50 }),
    p3: tankPlayer('p3', 'KC', 'QB', { passingYards: 250 }),
  };
  return {
    status: 'available',
    season: '2026',
    week: 1,
    fetchedAt: '2026-09-13T16:59:59.000Z',
    projections: {
      bySleeperId: players,
      byDefenseTeam: defenses,
    },
    coverage: {
      playerListRows: Object.keys(players).length,
      crosswalkEntries: Object.keys(players).length,
      malformedPlayerListRows: 0,
      ambiguousPlayerListRows: 0,
      playerProjectionRows: Object.keys(players).length,
      matchedPlayerProjections: Object.keys(players).length,
      unmatchedPlayerProjections: 0,
      malformedPlayerProjections: 0,
      incompletePlayerProjections: 0,
      defenseProjectionRows: Object.keys(defenses).length,
      usableDefenseProjections: Object.keys(defenses).length,
      malformedDefenseProjections: 0,
      incompleteDefenseProjections: 0,
    },
    warnings: [],
  };
}

function gameState(): Tank01GameState {
  return {
    gameId: 'game-1',
    season: '2026',
    week: 1,
    homeTeam: 'KC',
    awayTeam: 'LAC',
    statusCode: 1,
    statusText: 'Halftime',
    period: 'Halftime',
    clock: null,
    phase: 'halftime',
    clockSeconds: null,
    remainingFraction: 0.5,
    requestStartedAt: '2026-09-13T18:00:01.000Z',
    requestCompletedAt: '2026-09-13T18:00:02.000Z',
    fetchedAt: '2026-09-13T18:00:02.000Z',
  };
}

function gameStates(game = gameState()): Tank01GameStatesAvailable {
  return {
    status: 'available',
    season: '2026',
    week: 1,
    requestStartedAt: game.requestStartedAt,
    requestCompletedAt: game.requestCompletedAt,
    fetchedAt: game.fetchedAt,
    games: [game],
    byTeam: { [game.homeTeam]: game, [game.awayTeam]: game },
  };
}

type FakeStore = Readonly<{
  store: ProjectionStore;
  acquired: ReturnType<typeof vi.fn>;
  completed: ReturnType<typeof vi.fn>;
  failed: ReturnType<typeof vi.fn>;
  frozen: ReturnType<typeof vi.fn>;
  recordedStates: ReturnType<typeof vi.fn>;
  pruned: ReturnType<typeof vi.fn>;
  gamesUpserted: Array<Readonly<{ key: string; kickoffAt: string | null }>>;
  published: MatchupsData[];
  activityWindows: Array<readonly Readonly<{ startsAt: string; endsAt: string }>[]>;
}>;

function fakeStore(freezeBaselines = true): FakeStore {
  const acquired = vi.fn(async () => ({ kind: 'acquired' as const, attempt: 1, leaseUntil: '2026-09-13T18:02:00.000Z' }));
  const completed = vi.fn(async () => true);
  const failed = vi.fn(async () => true);
  const frozen = vi.fn();
  const recordedStates = vi.fn(async (input: {
    states: ReadonlyArray<{ externalGameId: string; sourceRevision: string }>;
  }) => ({
    kind: 'stored' as const,
    value: input.states.map((state) => ({
      externalGameId: state.externalGameId,
      sourceRevision: state.sourceRevision,
      observationId: `observation-${state.externalGameId}`,
    })),
  }));
  const pruned = vi.fn(async () => ({
    kind: 'stored' as const,
    value: { snapshotsDeleted: 0, leagueObservationsDeleted: 0, gameObservationsDeleted: 0, projectionRunsDeleted: 0, jobsDeleted: 0 },
  }));
  const gamesUpserted: Array<Readonly<{ key: string; kickoffAt: string | null }>> = [];
  const published: MatchupsData[] = [];
  const activityWindows: Array<readonly Readonly<{ startsAt: string; endsAt: string }>[]> = [];
  const entityPlayer = new Map<string, string>();
  const entityIds = new Map<string, string>();
  const gameExternal = new Map<string, string>();
  const leagueProfiles = new Map<string, string>();
  const latest = new Map<string, PlayerProjectionRecord>();
  const baselines = new Map<string, PlayerProjectionRecord>();

  const store = {
    enabled: true,
    acquireJob: acquired,
    completeJob: completed,
    failJob: failed,
    async registerLeagueSeason(input: { leagueKey: string }) {
      const leagueSeasonId = `season-${input.leagueKey}`;
      const profile = `profile-${input.leagueKey}`;
      leagueProfiles.set(leagueSeasonId, profile);
      return { kind: 'stored' as const, value: { leagueId: `league-${input.leagueKey}`, leagueSeasonId, scoringProfileId: profile } };
    },
    async upsertScoringEntities(inputs: ReadonlyArray<{ key: string; providerIds: ReadonlyArray<{ provider: string; externalId: string }> }>) {
      return {
        kind: 'stored' as const,
        value: inputs.map((input) => {
          const id = entityIds.get(input.key) ?? `entity-${input.key}`;
          entityIds.set(input.key, id);
          const sleeper = input.providerIds.find((provider) => provider.provider === 'sleeper');
          if (sleeper) entityPlayer.set(id, sleeper.externalId);
          return { key: input.key, entityId: id, conflict: false };
        }),
      };
    },
    async upsertNflGames(inputs: ReadonlyArray<{ key: string; kickoffAt: string | null }>) {
      gamesUpserted.push(...inputs);
      return {
        kind: 'stored' as const,
        value: inputs.map((input) => {
          const gameId = `stored-${input.key}`;
          gameExternal.set(gameId, input.key);
          return { key: input.key, gameId };
        }),
      };
    },
    recordGameStates: recordedStates,
    async recordProjectionCandidates(input: {
      modelVersion: string;
      fetchedAt: string;
      candidates: ReadonlyArray<{
        gameId: string;
        entityId: string;
        scoringProfileId: string;
        projectionPoints: number;
        projectedStats: Readonly<Record<string, unknown>>;
        quality: 'complete' | 'missing' | 'invalid';
      }>;
    }) {
      input.candidates.forEach((candidate) => {
        const sleeperPlayerId = entityPlayer.get(candidate.entityId)!;
        const key = `${candidate.scoringProfileId}:${sleeperPlayerId}`;
        latest.set(key, {
          sleeperPlayerId,
          entityId: candidate.entityId,
          entityKind: candidate.entityId.includes('team_defense') ? 'team_defense' : 'player',
          displayName: sleeperPlayerId,
          nflTeam: sleeperPlayerId === 'p3' ? 'KC' : 'LAC',
          gameId: candidate.gameId,
          tank01GameId: gameExternal.get(candidate.gameId) ?? null,
          projectionProvider: 'tank01',
          projectionPoints: candidate.projectionPoints,
          projectedStats: candidate.projectedStats,
          quality: candidate.quality,
          sourceProjectionRunId: 'run-1',
          modelVersion: input.modelVersion,
          fetchedAt: input.fetchedAt,
          frozenAt: null,
        });
      });
      return { kind: 'stored' as const, value: { runId: 'run-1', candidatesStored: input.candidates.length, candidateCount: input.candidates.length } };
    },
    async readLatestCandidatesBySleeperIds(input: { leagueSeasonId: string; sleeperPlayerIds: readonly string[] }) {
      const profile = leagueProfiles.get(input.leagueSeasonId)!;
      return input.sleeperPlayerIds.flatMap((id) => {
        const record = latest.get(`${profile}:${id}`);
        return record ? [record] : [];
      });
    },
    async freezeLatestBaselines(input: { leagueSeasonId: string; externalGameIds: readonly string[]; frozenAt: string }) {
      frozen(input);
      const profile = leagueProfiles.get(input.leagueSeasonId)!;
      if (freezeBaselines) {
        for (const [key, record] of latest) {
          if (key.startsWith(`${profile}:`) && record.tank01GameId && input.externalGameIds.includes(record.tank01GameId)) {
            baselines.set(key, { ...record, frozenAt: input.frozenAt });
          }
        }
      }
      return { kind: 'stored' as const, value: [...baselines.values()] };
    },
    async readFrozenBaselinesBySleeperIds(input: { leagueSeasonId: string; sleeperPlayerIds: readonly string[] }) {
      const profile = leagueProfiles.get(input.leagueSeasonId)!;
      return input.sleeperPlayerIds.flatMap((id) => {
        const record = baselines.get(`${profile}:${id}`);
        return record ? [record] : [];
      });
    },
    async readCurrentSnapshot() { return null; },
    pruneHistory: pruned,
    async recordLeagueWeekObservation(input: { expectedTank01GameIds: readonly string[] }) {
      return {
        kind: 'stored' as const,
        value: {
          observationId: 'league-observation',
          playerPointsStored: 3,
          rosterPointsStored: 2,
          unmappedSleeperPlayerIds: [],
          expectedGamesStored: input.expectedTank01GameIds.length,
          unmappedTank01GameIds: [],
        },
      };
    },
    async publishSnapshot(input: {
      payload: MatchupsData;
      leagueSeasonId: string;
      week: number;
      modelVersion: string;
      revisionKey: string;
      calculatedAt: string;
      activityWindows: readonly Readonly<{ startsAt: string; endsAt: string }>[];
    }) {
      published.push(input.payload);
      activityWindows.push(input.activityWindows);
      const snapshot: StoredProjectionSnapshot = {
        snapshotId: `snapshot-${published.length}`,
        leagueSeasonId: input.leagueSeasonId,
        week: input.week,
        modelVersion: input.modelVersion,
        revisionKey: input.revisionKey,
        calculatedAt: input.calculatedAt,
        publishedAt: input.calculatedAt,
        verifiedAt: input.calculatedAt,
        activityWindows: input.activityWindows,
        isCurrent: true,
        payload: input.payload,
      };
      return { kind: 'published' as const, snapshot };
    },
  } as unknown as ProjectionStore;
  return {
    store, acquired, completed, failed, frozen, recordedStates, pruned,
    gamesUpserted, published, activityWindows,
  };
}

function workerDependencies(
  fake: FakeStore,
  options: Readonly<{
    cadence?: ProjectionCadenceInput;
    games?: Tank01GameStatesAvailable;
    now?: Date;
  }> = {},
): LiveProjectionWorkerDependencies & Readonly<{
  cadenceMock: ReturnType<typeof vi.fn>;
  sourceMock: ReturnType<typeof vi.fn>;
  projectionMock: ReturnType<typeof vi.fn>;
  gamesMock: ReturnType<typeof vi.fn>;
}> {
  const cadenceMock = vi.fn(async (leagueId: string) => options.cadence ?? cadenceInput(leagueId));
  const sourceMock = vi.fn(async (leagueId: string) => source(leagueId));
  const projectionMock = vi.fn(async () => projectionResult());
  const gamesMock = vi.fn(async () => options.games ?? gameStates());
  return {
    store: fake.store,
    leagues: [{ key: 'league1', sleeperLeagueId: 'l1' }, { key: 'league2', sleeperLeagueId: 'l2' }],
    getProjectionCadenceInput: cadenceMock,
    getProjectionSyncInput: sourceMock,
    getWeeklyProjections: projectionMock,
    getWeeklyGameStates: gamesMock,
    now: () => new Date(options.now ?? NOW),
    workerId: () => 'worker-1',
    cadenceMock,
    sourceMock,
    projectionMock,
    gamesMock,
  };
}

describe('live projection worker', () => {
  it('preflights one seed league and makes no Neon or provider calls while idle', async () => {
    const store = fakeStore();
    const idleSchedule = fullWeekSchedule('2026-09-20T17:00:00.000Z');
    const dependencies = workerDependencies(store, {
      cadence: cadenceInput('l1', idleSchedule),
      now: new Date('2026-09-13T18:10:10.000Z'),
    });

    await expect(createLiveProjectionWorker(dependencies).run()).resolves.toEqual({
      status: 'skipped', reason: 'idle', cadence: 'idle',
    });
    expect(dependencies.cadenceMock).toHaveBeenCalledOnce();
    expect(dependencies.cadenceMock).toHaveBeenCalledWith('l1');
    expect(store.acquired).not.toHaveBeenCalled();
    expect(dependencies.sourceMock).not.toHaveBeenCalled();
    expect(dependencies.projectionMock).not.toHaveBeenCalled();
    expect(dependencies.gamesMock).not.toHaveBeenCalled();
  });

  it('does not use the hourly fallback throughout the offseason', async () => {
    const store = fakeStore();
    const distantWeekOneSchedule: WeekSchedule = {
      LAC: {
        kind: 'scheduled', opponent: 'KC', location: 'away', date: '2026-09-13',
        kickoffAt: '2026-09-13T17:00:00.000Z',
      },
    };
    const dependencies = workerDependencies(store, {
      cadence: {
        ...cadenceInput('l1', distantWeekOneSchedule),
        currentNflSeasonType: 'off',
      },
      now: new Date('2026-03-01T18:00:10.000Z'),
    });

    await expect(createLiveProjectionWorker(dependencies).run()).resolves.toEqual({
      status: 'skipped', reason: 'idle', cadence: 'idle',
    });
    expect(store.acquired).not.toHaveBeenCalled();
    expect(dependencies.sourceMock).not.toHaveBeenCalled();
    expect(dependencies.projectionMock).not.toHaveBeenCalled();
    expect(dependencies.gamesMock).not.toHaveBeenCalled();
  });

  it('does not use a stale rolled-over league as an offseason hourly fallback', async () => {
    const store = fakeStore();
    const staleSchedule: WeekSchedule = {
      LAC: {
        kind: 'scheduled', opponent: 'KC', location: 'away', date: '2025-12-28',
        kickoffAt: '2025-12-28T18:00:00.000Z',
      },
    };
    const dependencies = workerDependencies(store, { now: new Date('2026-03-01T18:00:10.000Z') });
    dependencies.cadenceMock.mockImplementation(async (leagueId: string) => ({
      sleeperLeagueId: leagueId,
      season: '2025',
      week: 18,
      schedule: staleSchedule,
      currentNflSeason: '2026',
      currentNflWeek: 1,
      currentNflSeasonType: 'pre',
    }));

    await expect(createLiveProjectionWorker(dependencies).run()).resolves.toEqual({
      status: 'skipped', reason: 'idle', cadence: 'idle',
    });
    expect(dependencies.cadenceMock).toHaveBeenCalledTimes(2);
    expect(store.acquired).not.toHaveBeenCalled();
    expect(dependencies.sourceMock).not.toHaveBeenCalled();
    expect(dependencies.projectionMock).not.toHaveBeenCalled();
    expect(dependencies.gamesMock).not.toHaveBeenCalled();
  });

  it('refuses a forced run when no configured league matches the current NFL period', async () => {
    const store = fakeStore();
    const dependencies = workerDependencies(store);
    dependencies.cadenceMock.mockImplementation(async (leagueId: string) => ({
      sleeperLeagueId: leagueId,
      season: '2025',
      week: 18,
      schedule: {},
      currentNflSeason: '2026',
      currentNflWeek: 1,
      currentNflSeasonType: 'pre',
    }));

    await expect(createLiveProjectionWorker(dependencies).run({ force: true }))
      .resolves.toEqual({ status: 'failed' });
    expect(dependencies.cadenceMock).toHaveBeenCalledTimes(2);
    expect(store.acquired).not.toHaveBeenCalled();
    expect(dependencies.sourceMock).not.toHaveBeenCalled();
    expect(dependencies.projectionMock).not.toHaveBeenCalled();
    expect(dependencies.gamesMock).not.toHaveBeenCalled();
  });

  it('shares Tank01 calls, freezes kickoff baselines, and publishes exact team sums for both leagues', async () => {
    const store = fakeStore();
    const dependencies = workerDependencies(store);
    const result = await createLiveProjectionWorker(dependencies).run();

    expect(result).toEqual({
      status: 'completed', cadence: 'live-window', publishedLeagues: 2, failedLeagues: 0, providerGroups: 1,
    });
    expect(store.acquired).toHaveBeenCalledWith(expect.objectContaining({ jobKey: 'live-projection-sync' }));
    expect(dependencies.sourceMock).toHaveBeenCalledTimes(2);
    expect(dependencies.projectionMock).toHaveBeenCalledOnce();
    expect(dependencies.gamesMock).toHaveBeenCalledOnce();
    expect(store.frozen).toHaveBeenCalledTimes(2);
    expect(store.published).toHaveLength(2);
    expect(store.activityWindows).toEqual([
      [{ startsAt: '2026-09-13T15:00:00.000Z', endsAt: '2026-09-14T00:00:00.000Z' }],
      [{ startsAt: '2026-09-13T15:00:00.000Z', endsAt: '2026-09-14T00:00:00.000Z' }],
    ]);
    for (const payload of store.published) {
      const [left, right] = payload.matchups[0].sides;
      expect(payload.matchups[0].status).toBe('live');
      expect(left.starters.map((starter) => starter.projectedPoints)).toEqual([13, 4.5]);
      expect(left.projectedPoints).toBe(17.5);
      expect(right.starters[0].projectedPoints).toBe(11);
      expect(right.projectedPoints).toBe(11);
      expect(payload.updatedAt).toBe(NOW.toISOString());
    }
    expect(store.completed).toHaveBeenCalledOnce();
    expect(store.failed).not.toHaveBeenCalled();
    expect(LIVE_PROJECTION_MODEL_VERSION).toBe('clock-v1');
  });

  it('fails closed before persistence when Tank01 returns a broadly truncated projection slate', async () => {
    const store = fakeStore();
    const dependencies = workerDependencies(store);
    const partial = projectionResult();
    dependencies.projectionMock.mockResolvedValue({
      ...partial,
      projections: {
        ...partial.projections,
        bySleeperId: { p1: partial.projections.bySleeperId.p1 },
      },
      coverage: {
        ...partial.coverage,
        playerProjectionRows: 1,
        matchedPlayerProjections: 1,
      },
    });

    await expect(createLiveProjectionWorker(dependencies).run()).resolves.toEqual({ status: 'failed' });
    expect(store.gamesUpserted).toHaveLength(0);
    expect(store.published).toHaveLength(0);
    expect(store.completed).not.toHaveBeenCalled();
    expect(store.failed).toHaveBeenCalledOnce();
  });

  it('persists kickoff time for a game represented only by a rostered bench player', async () => {
    const store = fakeStore();
    const dependencies = workerDependencies(store);
    const benchKickoff = '2026-09-13T20:25:00.000Z';
    const bench: Player = {
      ...player('bench', 'Bench Player', 'RB', 'LAC', 0),
      nflTeam: 'BUF',
      game: {
        kind: 'scheduled', opponent: 'MIA', location: 'home', date: '2026-09-13', kickoffAt: benchKickoff,
      },
    };
    const extendedSchedule: WeekSchedule = {
      ...schedule,
      BUF: bench.game!,
      MIA: {
        kind: 'scheduled', opponent: 'BUF', location: 'away', date: '2026-09-13', kickoffAt: benchKickoff,
      },
    };
    dependencies.sourceMock.mockImplementation(async (leagueId: string) => {
      const value = source(leagueId);
      return { ...value, schedule: extendedSchedule, rosteredPlayers: [...value.rosteredPlayers, bench] };
    });
    const secondGame: Tank01GameState = {
      ...gameState(),
      gameId: 'game-2',
      homeTeam: 'BUF',
      awayTeam: 'MIA',
      statusCode: 0,
      statusText: 'Scheduled',
      period: null,
      clock: null,
      phase: 'pregame',
      clockSeconds: null,
      remainingFraction: 1,
    };
    const firstGame = gameState();
    dependencies.gamesMock.mockResolvedValue({
      ...gameStates(firstGame),
      games: [firstGame, secondGame],
      byTeam: { KC: firstGame, LAC: firstGame, BUF: secondGame, MIA: secondGame },
    });

    await expect(createLiveProjectionWorker(dependencies).run()).resolves.toMatchObject({ status: 'completed' });
    expect(store.gamesUpserted).toContainEqual(expect.objectContaining({
      key: 'game-2', kickoffAt: benchKickoff,
    }));
  });

  it('fails closed and retains the prior snapshot when Tank01 omits a starter game', async () => {
    const store = fakeStore();
    const unrelated: Tank01GameState = {
      ...gameState(), gameId: 'unrelated', homeTeam: 'BUF', awayTeam: 'MIA',
    };
    const dependencies = workerDependencies(store, { games: gameStates(unrelated) });

    await expect(createLiveProjectionWorker(dependencies).run()).resolves.toEqual({ status: 'failed' });
    expect(store.published).toHaveLength(0);
    expect(store.completed).not.toHaveBeenCalled();
    expect(store.failed).toHaveBeenCalledOnce();
  });

  it('retains prior snapshots when persisted game-state transition validation rejects a regression', async () => {
    const store = fakeStore();
    store.recordedStates.mockRejectedValueOnce(new Error('Tank01 game state regressed.'));
    const dependencies = workerDependencies(store);

    await expect(createLiveProjectionWorker(dependencies).run()).resolves.toEqual({ status: 'failed' });
    expect(store.published).toHaveLength(0);
    expect(store.completed).not.toHaveBeenCalled();
    expect(store.failed).toHaveBeenCalledOnce();
  });

  it('does not let a stale idle first league hide the active current NFL period', async () => {
    const store = fakeStore();
    const staleSchedule: WeekSchedule = {
      LAC: {
        kind: 'scheduled', opponent: 'KC', location: 'away', date: '2025-12-28',
        kickoffAt: '2025-12-28T18:00:00.000Z',
      },
    };
    const dependencies = workerDependencies(store);
    dependencies.cadenceMock.mockImplementation(async (leagueId: string) => leagueId === 'l1'
      ? {
          sleeperLeagueId: leagueId,
          season: '2025',
          week: 18,
          schedule: staleSchedule,
          currentNflSeason: '2026',
          currentNflWeek: 1,
          currentNflSeasonType: 'regular',
        }
      : cadenceInput(leagueId));

    await expect(createLiveProjectionWorker(dependencies).run()).resolves.toMatchObject({
      status: 'completed', cadence: 'live-window', publishedLeagues: 2,
    });
    expect(dependencies.cadenceMock).toHaveBeenNthCalledWith(1, 'l1');
    expect(dependencies.cadenceMock).toHaveBeenNthCalledWith(2, 'l2');
    expect(store.acquired).toHaveBeenCalledOnce();
  });

  it('does not call Tank01 for a secondary league that still points to the prior season', async () => {
    const store = fakeStore();
    const dependencies = workerDependencies(store);
    dependencies.sourceMock.mockImplementation(async (leagueId: string) => {
      const value = source(leagueId);
      return leagueId === 'l2'
        ? {
            ...value,
            data: {
              ...value.data,
              league: { ...value.data.league, season: '2025', week: 18 },
              week: 18,
            },
          }
        : value;
    });

    await expect(createLiveProjectionWorker(dependencies).run()).resolves.toEqual({
      status: 'completed', cadence: 'live-window', publishedLeagues: 1,
      failedLeagues: 1, providerGroups: 1,
    });
    expect(dependencies.projectionMock).toHaveBeenCalledOnce();
    expect(dependencies.projectionMock).toHaveBeenCalledWith('2026', 1);
    expect(dependencies.gamesMock).toHaveBeenCalledOnce();
    expect(dependencies.gamesMock).toHaveBeenCalledWith('2026', 1);
    expect(store.published).toHaveLength(1);
  });

  it('publishes a healthy league when another Sleeper league is temporarily unavailable', async () => {
    const store = fakeStore();
    const dependencies = workerDependencies(store);
    dependencies.cadenceMock.mockImplementation(async (leagueId: string) => {
      if (leagueId === 'l1') throw new Error('temporary Sleeper failure');
      return cadenceInput(leagueId);
    });
    dependencies.sourceMock.mockImplementation(async (leagueId: string) => {
      if (leagueId === 'l1') throw new Error('temporary Sleeper failure');
      return source(leagueId);
    });

    await expect(createLiveProjectionWorker(dependencies).run()).resolves.toEqual({
      status: 'completed', cadence: 'live-window', publishedLeagues: 1, failedLeagues: 1, providerGroups: 1,
    });
    expect(dependencies.cadenceMock).toHaveBeenNthCalledWith(1, 'l1');
    expect(dependencies.cadenceMock).toHaveBeenNthCalledWith(2, 'l2');
    expect(store.published).toHaveLength(1);
    expect(store.completed).toHaveBeenCalledOnce();
    expect(store.failed).not.toHaveBeenCalled();
  });

  it('uses the explicit zero baseline after kickoff when no eligible pregame candidate was frozen', async () => {
    const store = fakeStore(false);
    const dependencies = workerDependencies(store);

    const result = await createLiveProjectionWorker(dependencies).run();

    expect(result.status).toBe('completed');
    const [left, right] = store.published[0].matchups[0].sides;
    expect(left.starters.map((starter) => starter.projectedPoints)).toEqual([8, 2]);
    expect(left.projectedPoints).toBe(10);
    expect(right.projectedPoints).toBe(6);
  });

  it('uses one hourly job bucket throughout the startup window and treats pruning as noncritical', async () => {
    const store = fakeStore();
    store.pruned.mockRejectedValueOnce(new Error('maintenance unavailable'));
    const idleSchedule = fullWeekSchedule('2026-09-20T17:00:00.000Z');
    const dependencies = workerDependencies(store, {
      cadence: cadenceInput('l1', idleSchedule),
      now: new Date('2026-09-13T18:03:10.000Z'),
    });
    dependencies.sourceMock.mockImplementation(async (leagueId: string) => ({
      ...source(leagueId), schedule: idleSchedule,
    }));

    const result = await createLiveProjectionWorker(dependencies).run();

    expect(result).toEqual({
      status: 'completed', cadence: 'hourly', publishedLeagues: 2, failedLeagues: 0, providerGroups: 1,
    });
    expect(store.acquired).toHaveBeenCalledWith(expect.objectContaining({
      jobKey: 'live-projection-sync', scheduledFor: '2026-09-13T18:00:00.000Z',
    }));
    expect(store.pruned).toHaveBeenCalledWith({
      before: '2026-09-11T18:03:10.000Z', keepRecentSnapshotsPerLeagueWeek: 3,
    });
    expect(store.completed).toHaveBeenCalledOnce();
  });

  it('allows hourly preparation when a regular-season kickoff is within one week', async () => {
    const store = fakeStore();
    const upcomingSchedule = fullWeekSchedule('2026-09-20T17:00:00.000Z');
    const dependencies = workerDependencies(store, {
      cadence: {
        ...cadenceInput('l1', upcomingSchedule),
        currentNflSeasonType: 'pre',
      },
      now: new Date('2026-09-13T18:03:10.000Z'),
    });
    dependencies.sourceMock.mockImplementation(async (leagueId: string) => ({
      ...source(leagueId), schedule: upcomingSchedule,
    }));

    await expect(createLiveProjectionWorker(dependencies).run()).resolves.toMatchObject({
      status: 'completed', cadence: 'hourly', publishedLeagues: 2,
    });
    expect(dependencies.projectionMock).toHaveBeenCalledOnce();
    expect(dependencies.gamesMock).toHaveBeenCalledOnce();
  });

  it('keeps a forced run on the selected current season and excludes stale loaded leagues', async () => {
    const store = fakeStore();
    const dependencies = workerDependencies(store);
    dependencies.cadenceMock.mockImplementation(async (leagueId: string) => leagueId === 'l1'
      ? {
          sleeperLeagueId: leagueId,
          season: '2025',
          week: 18,
          schedule: {},
          currentNflSeason: '2026',
          currentNflWeek: 1,
          currentNflSeasonType: 'regular',
        }
      : cadenceInput(leagueId));
    dependencies.sourceMock.mockImplementation(async (leagueId: string) => {
      const value = source(leagueId);
      return leagueId === 'l1'
        ? {
            ...value,
            data: {
              ...value.data,
              league: { ...value.data.league, season: '2025', week: 18 },
              week: 18,
            },
          }
        : value;
    });
    await expect(createLiveProjectionWorker(dependencies).run({ force: true })).resolves.toEqual({
      status: 'completed', cadence: 'forced', publishedLeagues: 1,
      failedLeagues: 1, providerGroups: 1,
    });
    expect(dependencies.projectionMock).toHaveBeenCalledOnce();
    expect(dependencies.projectionMock).toHaveBeenCalledWith('2026', 1);
    expect(dependencies.gamesMock).toHaveBeenCalledOnce();
    expect(dependencies.gamesMock).toHaveBeenCalledWith('2026', 1);
    expect(dependencies.cadenceMock).toHaveBeenCalledTimes(2);
    expect(store.published).toHaveLength(1);
    expect(store.completed).toHaveBeenCalledOnce();
  });
});
