import { vi } from 'vitest';

import type { WeekSchedule } from './nfl-schedule';
import { NFL_TEAMS, type NflTeam } from './nfl-teams';
import type { LiveProjectionWorkerDependencies } from './live-projection-worker';
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

export const NOW = new Date('2026-09-13T18:00:10.000Z');
export const KICKOFF = '2026-09-13T17:00:00.000Z';

const teams: readonly Team[] = [
  { id: 1, managerName: 'Left Manager', name: 'Left Team', avatar: null, wins: 0, losses: 0, ties: 0, pointsFor: 0, pointsAgainst: 0 },
  { id: 2, managerName: 'Right Manager', name: 'Right Team', avatar: null, wins: 0, losses: 0, ties: 0, pointsFor: 0, pointsAgainst: 0 },
];

export function player(
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

export function fullWeekSchedule(kickoffAt = KICKOFF): WeekSchedule {
  const value: WeekSchedule = {};
  for (let index = 0; index < weekTeams.length; index += 2) {
    const away = weekTeams[index];
    const home = weekTeams[index + 1];
    value[away] = { kind: 'scheduled', opponent: home, location: 'away', date: '2026-09-13', kickoffAt };
    value[home] = { kind: 'scheduled', opponent: away, location: 'home', date: '2026-09-13', kickoffAt };
  }
  return value;
}

export const schedule = fullWeekSchedule();

export function matchupData(leftPoints = [8, 2], rightPoints = [6]): MatchupsData {
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

export function source(leagueId: string, data = matchupData()): ProjectionSyncInput {
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

export function cadenceInput(leagueId: string, weeklySchedule = schedule): ProjectionCadenceInput {
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
      passingTouchdowns: 0,
      passingInterceptions: 0,
      rushingYards: projection.rushingYards ?? 0,
      rushingTouchdowns: 0,
      receptions: 0,
      receivingYards: 0,
      receivingTouchdowns: 0,
      twoPointConversions: 0,
      fumblesLost: 0,
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
    scoringProjection: {
      kind: 'defense',
      sacks: 0,
      interceptions: 0,
      fumbleRecoveries: 0,
      defensiveTouchdowns: 0,
      specialTeamsTouchdowns: 0,
      safeties: 0,
      blockedKicks: 0,
      pointsAllowed: 0,
    },
    missingFields: [],
  };
}

export function projectionResult(): Tank01AvailableResult {
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

export function gameState(): Tank01GameState {
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

export function gameStates(game = gameState()): Tank01GameStatesAvailable {
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

export type WorkerStoreOperation =
  | 'acquire-job'
  | 'complete-job'
  | 'fail-job'
  | 'register-league-season'
  | 'upsert-scoring-entities'
  | 'upsert-nfl-games'
  | 'record-game-states'
  | 'record-projection-candidates'
  | 'freeze-latest-baselines'
  | 'read-latest-candidates'
  | 'read-frozen-baselines'
  | 'read-current-snapshot'
  | 'record-league-week-observation'
  | 'publish-snapshot'
  | 'prune-history';

export type CapturedPublishInput = Readonly<{
  leagueSeasonId: string;
  week: number;
  modelVersion: string;
  revisionKey: string;
  calculatedAt: string;
  payload: MatchupsData;
}>;

export type CapturedProjectionCandidate = Readonly<{
  entityId: string;
  projectionPoints: number;
  quality: 'complete' | 'missing' | 'invalid';
}>;

export type FakeStore = Readonly<{
  store: ProjectionStore;
  acquired: ReturnType<typeof vi.fn>;
  completed: ReturnType<typeof vi.fn>;
  failed: ReturnType<typeof vi.fn>;
  frozen: ReturnType<typeof vi.fn>;
  recordedStates: ReturnType<typeof vi.fn>;
  pruned: ReturnType<typeof vi.fn>;
  operations: WorkerStoreOperation[];
  gamesUpserted: Array<Readonly<{ key: string; kickoffAt: string | null }>>;
  candidateBatches: CapturedProjectionCandidate[][];
  published: MatchupsData[];
  publishInputs: CapturedPublishInput[];
  activityWindows: Array<readonly Readonly<{ startsAt: string; endsAt: string }>[]>;
}>;

export function fakeStore(freezeBaselines = true, enabled = true): FakeStore {
  const operations: WorkerStoreOperation[] = [];
  const acquired = vi.fn(async () => {
    operations.push('acquire-job');
    return { kind: 'acquired' as const, attempt: 1, leaseUntil: '2026-09-13T18:02:00.000Z' };
  });
  const completed = vi.fn(async () => {
    operations.push('complete-job');
    return true;
  });
  const failed = vi.fn(async () => {
    operations.push('fail-job');
    return true;
  });
  const frozen = vi.fn();
  const recordedStates = vi.fn(async (input: {
    states: ReadonlyArray<{ externalGameId: string; sourceRevision: string }>;
  }) => {
    operations.push('record-game-states');
    return {
      kind: 'stored' as const,
      value: input.states.map((state) => ({
        externalGameId: state.externalGameId,
        sourceRevision: state.sourceRevision,
        observationId: `observation-${state.externalGameId}`,
      })),
    };
  });
  const pruned = vi.fn(async () => {
    operations.push('prune-history');
    return {
      kind: 'stored' as const,
      value: { snapshotsDeleted: 0, leagueObservationsDeleted: 0, gameObservationsDeleted: 0, projectionRunsDeleted: 0, jobsDeleted: 0 },
    };
  });
  const gamesUpserted: Array<Readonly<{ key: string; kickoffAt: string | null }>> = [];
  const candidateBatches: CapturedProjectionCandidate[][] = [];
  const published: MatchupsData[] = [];
  const publishInputs: CapturedPublishInput[] = [];
  const activityWindows: Array<readonly Readonly<{ startsAt: string; endsAt: string }>[]> = [];
  const entityPlayer = new Map<string, string>();
  const entityIds = new Map<string, string>();
  const gameExternal = new Map<string, string>();
  const leagueProfiles = new Map<string, string>();
  const latest = new Map<string, PlayerProjectionRecord>();
  const baselines = new Map<string, PlayerProjectionRecord>();

  const store = {
    enabled,
    acquireJob: acquired,
    completeJob: completed,
    failJob: failed,
    async registerLeagueSeason(input: { leagueKey: string }) {
      operations.push('register-league-season');
      const leagueSeasonId = `season-${input.leagueKey}`;
      const profile = `profile-${input.leagueKey}`;
      leagueProfiles.set(leagueSeasonId, profile);
      return { kind: 'stored' as const, value: { leagueId: `league-${input.leagueKey}`, leagueSeasonId, scoringProfileId: profile } };
    },
    async upsertScoringEntities(inputs: ReadonlyArray<{ key: string; providerIds: ReadonlyArray<{ provider: string; externalId: string }> }>) {
      operations.push('upsert-scoring-entities');
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
      operations.push('upsert-nfl-games');
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
      operations.push('record-projection-candidates');
      candidateBatches.push(input.candidates.map((candidate) => ({
        entityId: candidate.entityId,
        projectionPoints: candidate.projectionPoints,
        quality: candidate.quality,
      })));
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
      operations.push('read-latest-candidates');
      const profile = leagueProfiles.get(input.leagueSeasonId)!;
      return input.sleeperPlayerIds.flatMap((id) => {
        const record = latest.get(`${profile}:${id}`);
        return record ? [record] : [];
      });
    },
    async freezeLatestBaselines(input: { leagueSeasonId: string; externalGameIds: readonly string[]; frozenAt: string }) {
      operations.push('freeze-latest-baselines');
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
      operations.push('read-frozen-baselines');
      const profile = leagueProfiles.get(input.leagueSeasonId)!;
      return input.sleeperPlayerIds.flatMap((id) => {
        const record = baselines.get(`${profile}:${id}`);
        return record ? [record] : [];
      });
    },
    async readCurrentSnapshot() {
      operations.push('read-current-snapshot');
      return null;
    },
    pruneHistory: pruned,
    async recordLeagueWeekObservation(input: { expectedTank01GameIds: readonly string[] }) {
      operations.push('record-league-week-observation');
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
    async publishSnapshot(input: CapturedPublishInput & Readonly<{
      activityWindows: readonly Readonly<{ startsAt: string; endsAt: string }>[];
    }>) {
      operations.push('publish-snapshot');
      published.push(input.payload);
      publishInputs.push(input);
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
    store, acquired, completed, failed, frozen, recordedStates, pruned, operations,
    gamesUpserted, candidateBatches, published, publishInputs, activityWindows,
  };
}

export function workerDependencies(
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
