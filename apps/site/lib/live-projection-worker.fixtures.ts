import { vi } from 'vitest';

import type {
  GameStateObservation,
  GameStateSlate,
  LeagueCadenceState,
  LeagueConfiguration,
  LeaguePeriod,
  LeagueWeekState,
  NflTeam,
  NflWeekSchedule,
  ProjectionObservation,
  ProjectionSlate,
  ScoringEntity,
} from './projections/domain/contracts';
import { normalizeSleeperScoringProfile } from './projections/adapters/sleeper/scoring-profile';
import { assessProjectionSlate } from './projections/adapters/tank01/slate-validation';
import type { LiveProjectionWorkerDependencies } from './live-projection-worker';
import type {
  IdentityCrosswalkPort,
  NflGameId,
  ScoringEntityId,
} from './projections/ports/identity-crosswalk';
import type {
  LeagueSeasonId,
  ObservationId,
  ProjectionBaselineRecord,
  ProjectionRepositoryPort,
  ProjectionRunId,
  ProjectionSlateContentId,
  ProjectionSlateObservationId,
  PublishSnapshotInput,
  ScoringProfileId,
  StoredProjectionSnapshot,
} from './projections/ports/projection-repository';
import {
  externalGameRef,
  externalLeagueRef,
  externalPlayerRef,
  externalReferenceKey,
  externalRosterRef,
  externalTeamDefenseRef,
  providerKey,
} from './projections/shared/provider-identity';
import { compatibleRevision } from './projections/shared/revision-compatibility';
import { NFL_TEAMS } from './nfl-teams';
import type { MatchupsData, Player, Team } from './types';

export const NOW = new Date('2026-09-13T18:00:10.000Z');
export const KICKOFF = '2026-09-13T17:00:00.000Z';
export const PERIOD: LeaguePeriod = { season: 2026, seasonType: 'regular', week: 1 };
export const OFFICIAL_PROVIDER = providerKey('sleeper');
export const PROJECTION_PROVIDER = providerKey('tank01');
export const GAME_STATE_PROVIDER = PROJECTION_PROVIDER;

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

export function fullWeekSchedule(kickoffAt = KICKOFF): NflWeekSchedule {
  const value: Partial<Record<NflTeam, NflWeekSchedule[NflTeam]>> = {};
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

export function configuration(leagueId: string): LeagueConfiguration {
  const key = leagueId === 'l1' ? 'league1' : 'league2';
  return {
    key,
    displayName: leagueId === 'l1' ? 'League One' : 'League Two',
    leagueRef: externalLeagueRef(OFFICIAL_PROVIDER, leagueId),
  };
}

export function scoringEntity(value: Player): ScoringEntity {
  const nflTeam = value.nflTeam as NflTeam | null;
  if (value.position.toUpperCase() === 'DEF' && nflTeam) {
    return {
      kind: 'team-defense',
      externalRef: externalTeamDefenseRef(OFFICIAL_PROVIDER, value.id),
      displayName: value.name,
      nflTeam,
      position: value.position,
      injuryStatus: value.injuryStatus,
    };
  }
  return {
    kind: 'player',
    externalRef: externalPlayerRef(OFFICIAL_PROVIDER, value.id),
    displayName: value.name,
    nflTeam,
    position: value.position,
    injuryStatus: value.injuryStatus,
  };
}

export function source(leagueId: string, data = matchupData()): LeagueWeekState {
  const leagueConfiguration = configuration(leagueId);
  const participantByRoster = new Map(data.teams.map((team) => [
    team.id,
    externalRosterRef(leagueConfiguration.leagueRef, String(team.id)),
  ]));
  const rosteredEntities = new Map<string, ScoringEntity>();
  const matchups = data.matchups.map((matchup) => ({
    matchupId: matchup.id,
    status: matchup.status,
    sides: matchup.sides.map((side) => ({
      rosterRef: participantByRoster.get(side.team.id)!,
      officialPoints: side.points,
      starters: side.starters.map((starter) => {
        const entity = scoringEntity(starter);
        rosteredEntities.set(externalReferenceKey(entity.externalRef), entity);
        return {
          kind: 'occupied' as const,
          slot: starter.slot,
          entity,
          officialPoints: starter.points,
        };
      }),
    })),
  }));
  const requestStartedAt = '2026-09-13T18:00:00.000Z';
  const requestCompletedAt = '2026-09-13T18:00:01.000Z';
  return {
    configuration: leagueConfiguration,
    leagueName: leagueConfiguration.displayName,
    period: PERIOD,
    maxWeek: data.league.maxWeek,
    rosterPositions: data.league.rosterPositions,
    participants: data.teams.map((team) => ({
      rosterRef: participantByRoster.get(team.id)!,
      managerName: team.managerName,
      teamName: team.name,
      avatarUrl: team.avatar,
      wins: team.wins,
      losses: team.losses,
      ties: team.ties,
      pointsFor: team.pointsFor,
      pointsAgainst: team.pointsAgainst,
    })),
    matchups,
    rosteredEntities: [...rosteredEntities.values()],
    schedule,
    scoringSettings: {
      provider: OFFICIAL_PROVIDER,
      rawRules: { pass_yd: 0.04, rush_yd: 0.1 },
    },
    requestStartedAt,
    requestCompletedAt,
    observedAt: requestCompletedAt,
    sourceRevision: compatibleRevision({ requestStartedAt, requestCompletedAt, data }),
    ...(data.warning ? { warning: data.warning } : {}),
  };
}

export function cadenceInput(
  leagueId: string,
  weeklySchedule = schedule,
): LeagueCadenceState {
  return {
    configuration: configuration(leagueId),
    period: PERIOD,
    currentPeriod: { season: 2026, week: 1, seasonType: 'regular' },
    schedule: weeklySchedule,
  };
}

function offenseStats(
  projection: Readonly<{ passingYards?: number; rushingYards?: number }>,
): Extract<ProjectionObservation['scoringStats'], { kind: 'offense' }> {
  return {
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
  };
}

function projectionPlayer(
  officialPlayerId: string,
  team: NflTeam,
  position: 'QB' | 'RB' | 'WR' | 'TE',
  projection: Readonly<{ passingYards?: number; rushingYards?: number }>,
): ProjectionObservation {
  const scoringStats = offenseStats(projection);
  return {
    identity: {
      primary: externalPlayerRef(PROJECTION_PROVIDER, `tank-${officialPlayerId}`),
      aliases: [externalPlayerRef(OFFICIAL_PROVIDER, officialPlayerId)],
    },
    nflTeam: team,
    position,
    stats: {
      passing: { yards: scoringStats.passingYards },
      rushing: { yards: scoringStats.rushingYards },
    },
    scoringStats,
    missingFields: [],
  };
}

function projectionDefense(team: NflTeam): ProjectionObservation {
  return {
    identity: {
      primary: externalTeamDefenseRef(PROJECTION_PROVIDER, team),
      aliases: [],
    },
    nflTeam: team,
    position: 'DEF',
    stats: {
      returnTouchdowns: 0,
      defensiveTouchdowns: 0,
      safeties: 0,
      fumbleRecoveries: 0,
      pointsAllowed: 0,
      interceptions: 0,
      sacks: 0,
      blockedKicks: 0,
    },
    scoringStats: {
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

export function projectionResult(
  sourcePeriod: LeaguePeriod = PERIOD,
): ProjectionSlate {
  const coveragePlayers = weekTeams.flatMap((team) => (
    (['QB', 'RB', 'WR', 'TE'] as const).map((position) => {
      const id = `coverage-${team}-${position}`;
      return projectionPlayer(id, team, position, {});
    })
  ));
  const projections = [
    ...coveragePlayers,
    ...weekTeams.map(projectionDefense),
    projectionPlayer('p1', 'LAC', 'QB', { passingYards: 250 }),
    projectionPlayer('p2', 'LAC', 'RB', { rushingYards: 50 }),
    projectionPlayer('p3', 'KC', 'QB', { passingYards: 250 }),
  ];
  return {
    source: PROJECTION_PROVIDER,
    period: sourcePeriod,
    quality: 'complete',
    requestStartedAt: '2026-09-13T16:59:59.000Z',
    requestCompletedAt: '2026-09-13T16:59:59.000Z',
    observedAt: '2026-09-13T16:59:59.000Z',
    sourceRevision: '7c9136b166b67d9cda4c0658cd98bdc621ea150ac96c8ccf4b129a6a1f6a015e',
    projections,
    coverage: {
      crosswalkRows: projections.length,
      crosswalkEntries: projections.length,
      malformedCrosswalkRows: 0,
      ambiguousCrosswalkRows: 0,
      playerRows: coveragePlayers.length + 3,
      matchedPlayers: coveragePlayers.length + 3,
      unmatchedPlayers: 0,
      malformedPlayers: 0,
      incompletePlayers: 0,
      defenseRows: weekTeams.length,
      usableDefenses: weekTeams.length,
      malformedDefenses: 0,
      incompleteDefenses: 0,
    },
    warnings: [],
  };
}

export function gameState(
  sourcePeriod: LeaguePeriod = PERIOD,
): GameStateObservation {
  return {
    gameRef: externalGameRef(GAME_STATE_PROVIDER, 'game-1'),
    period: sourcePeriod,
    homeTeam: 'KC',
    awayTeam: 'LAC',
    statusCode: 1,
    statusText: 'Halftime',
    sourcePeriod: 'Halftime',
    gameClock: null,
    phase: 'halftime',
    clockSeconds: null,
    remainingFraction: 0.5,
    homeScore: null,
    awayScore: null,
    requestStartedAt: '2026-09-13T18:00:01.000Z',
    requestCompletedAt: '2026-09-13T18:00:02.000Z',
    observedAt: '2026-09-13T18:00:02.000Z',
    sourceRevision: '448be1f64c4fe89b075678410679c3d2095db9fbf0aacc7c54ef53c6e9395cb9',
  };
}

export function gameStates(game = gameState()): GameStateSlate {
  return {
    source: GAME_STATE_PROVIDER,
    period: game.period,
    requestStartedAt: game.requestStartedAt,
    requestCompletedAt: game.requestCompletedAt,
    observedAt: game.observedAt,
    games: [game],
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
  | 'record-projection-slate'
  | 'record-projection-candidates'
  | 'freeze-latest-baselines'
  | 'read-latest-candidates'
  | 'read-frozen-baselines'
  | 'read-current-snapshot'
  | 'record-league-week-observation'
  | 'publish-snapshot'
  | 'prune-history';

export type CapturedPublishInput = PublishSnapshotInput;

export type CapturedProjectionCandidate = Readonly<{
  entityId: string;
  projectionPoints: number;
  quality: 'complete' | 'missing' | 'invalid';
}>;

export type FakeStore = Readonly<{
  repository: ProjectionRepositoryPort;
  /** Compatibility name retained for tests that spy on repository operations. */
  store: ProjectionRepositoryPort;
  identityCrosswalk: IdentityCrosswalkPort;
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
  const recordedStates = vi.fn(async (
    input: Parameters<ProjectionRepositoryPort['recordGameStates']>[0],
  ) => {
    operations.push('record-game-states');
    return {
      kind: 'stored' as const,
      value: input.states.map((state) => ({
        gameRef: state.gameRef,
        sourceRevision: state.sourceRevision,
        observationId: `observation-${String(state.gameRef.externalId)}` as ObservationId,
      })),
    };
  });
  const pruned = vi.fn(async () => {
    operations.push('prune-history');
    return {
      kind: 'stored' as const,
      value: {
        snapshotsDeleted: 0,
        leagueObservationsDeleted: 0,
        gameObservationsDeleted: 0,
        projectionRunsDeleted: 0,
        projectionSlateObservationsDeleted: 0,
        projectionSlateContentsDeleted: 0,
        jobsDeleted: 0,
      },
    };
  });
  const gamesUpserted: Array<Readonly<{ key: string; kickoffAt: string | null }>> = [];
  const candidateBatches: CapturedProjectionCandidate[][] = [];
  const published: MatchupsData[] = [];
  const publishInputs: CapturedPublishInput[] = [];
  const activityWindows: Array<readonly Readonly<{ startsAt: string; endsAt: string }>[]> = [];
  const entitiesById = new Map<ScoringEntityId, ScoringEntity>();
  const gameRefsById = new Map<NflGameId, ReturnType<typeof externalGameRef>>();
  const leagueProfiles = new Map<LeagueSeasonId, ScoringProfileId>();
  const latest = new Map<string, ProjectionBaselineRecord>();
  const baselines = new Map<string, ProjectionBaselineRecord>();

  const resolveScoringEntitiesImplementation: IdentityCrosswalkPort['resolveScoringEntities'] = async (inputs) => {
    operations.push('upsert-scoring-entities');
    return {
      kind: 'resolved',
      value: inputs.map((input) => {
        const kind = input.entity.kind === 'team-defense' ? 'team_defense' : 'player';
        const entityId = `entity-${kind}:${String(input.entity.externalRef.externalId)}` as ScoringEntityId;
        entitiesById.set(entityId, input.entity);
        return { key: input.key, status: 'known' as const, entityId };
      }),
    };
  };
  const resolveScoringEntities = vi.fn(resolveScoringEntitiesImplementation);
  const resolveNflGamesImplementation: IdentityCrosswalkPort['resolveNflGames'] = async (inputs) => {
    operations.push('upsert-nfl-games');
    gamesUpserted.push(...inputs.map((input) => ({
      key: String(input.primaryRef.externalId),
      kickoffAt: input.kickoffAt,
    })));
    return {
      kind: 'resolved',
      value: inputs.map((input) => {
        const gameId = `stored-${String(input.primaryRef.externalId)}` as NflGameId;
        gameRefsById.set(gameId, input.primaryRef);
        return { key: input.key, status: 'known' as const, gameId };
      }),
    };
  };
  const resolveNflGames = vi.fn(resolveNflGamesImplementation);
  const identityCrosswalk: IdentityCrosswalkPort = {
    enabled,
    resolveScoringEntities,
    resolveNflGames,
  };

  const repository: ProjectionRepositoryPort = {
    enabled,
    acquireJob: acquired,
    completeJob: completed,
    failJob: failed,
    async registerLeagueSeason(input) {
      operations.push('register-league-season');
      const leagueSeasonId = `season-${input.configuration.key}` as LeagueSeasonId;
      const scoringProfileId = `profile-${input.configuration.key}` as ScoringProfileId;
      leagueProfiles.set(leagueSeasonId, scoringProfileId);
      return {
        kind: 'stored',
        value: { leagueSeasonId, scoringProfileId, leagueRef: input.configuration.leagueRef },
      };
    },
    async recordProjectionSlate(input) {
      operations.push('record-projection-slate');
      return {
        kind: 'stored',
        value: {
          observationId: 'projection-slate-observation' as ProjectionSlateObservationId,
          contentId: 'projection-slate-content' as ProjectionSlateContentId,
          semanticHash: 'semantic-hash',
          entriesStored: input.projections.length,
          entryCount: input.projections.length,
          pointerOutcome: 'advanced',
        },
      };
    },
    async readCurrentProjectionSlate() {
      return null;
    },
    async recordProjectionCandidates(input) {
      operations.push('record-projection-candidates');
      candidateBatches.push(input.candidates.map((candidate) => ({
        entityId: String(candidate.entityId),
        projectionPoints: candidate.projectionPoints,
        quality: candidate.quality,
      })));
      for (const candidate of input.candidates) {
        const entity = entitiesById.get(candidate.entityId)!;
        const projectionGameRef = gameRefsById.get(candidate.gameId) ?? null;
        const key = `${String(candidate.scoringProfileId)}:${externalReferenceKey(entity.externalRef)}`;
        latest.set(key, {
          officialEntityRef: entity.externalRef,
          entityId: candidate.entityId,
          entityKind: entity.kind,
          displayName: entity.displayName,
          nflTeam: entity.nflTeam,
          gameId: candidate.gameId,
          projectionGameRef,
          projectionPoints: candidate.projectionPoints,
          projectedStats: candidate.projectedStats,
          quality: candidate.quality,
          sourceProjectionRunId: 'run-1' as ProjectionRunId,
          projectionSource: input.source,
          modelVersion: input.modelVersion,
          observedAt: input.observedAt,
          frozenAt: null,
        });
      }
      return {
        kind: 'stored',
        value: {
          runId: 'run-1' as ProjectionRunId,
          candidatesStored: input.candidates.length,
          candidateCount: input.candidates.length,
        },
      };
    },
    async readLatestCandidates(input) {
      operations.push('read-latest-candidates');
      const profile = leagueProfiles.get(input.leagueSeasonId)!;
      return input.officialEntityRefs.flatMap((reference) => {
        const record = latest.get(`${String(profile)}:${externalReferenceKey(reference)}`);
        return record ? [record] : [];
      });
    },
    async freezeLatestBaselines(input) {
      operations.push('freeze-latest-baselines');
      frozen(input);
      const profile = leagueProfiles.get(input.leagueSeasonId)!;
      const gameKeys = new Set(input.gameRefs.map(externalReferenceKey));
      if (freezeBaselines) {
        for (const [key, record] of latest) {
          if (key.startsWith(`${String(profile)}:`)
            && record.projectionGameRef
            && gameKeys.has(externalReferenceKey(record.projectionGameRef))) {
            baselines.set(key, { ...record, frozenAt: input.frozenAt });
          }
        }
      }
      return { kind: 'stored', value: [...baselines.values()] };
    },
    async readFrozenBaselines(input) {
      operations.push('read-frozen-baselines');
      const profile = leagueProfiles.get(input.leagueSeasonId)!;
      return input.officialEntityRefs.flatMap((reference) => {
        const record = baselines.get(`${String(profile)}:${externalReferenceKey(reference)}`);
        return record ? [record] : [];
      });
    },
    recordGameStates: recordedStates,
    async recordLeagueWeekObservation(input) {
      operations.push('record-league-week-observation');
      return {
        kind: 'stored',
        value: {
          observationId: 'league-observation' as ObservationId,
          entityPointsStored: input.entityPoints.length,
          rosterPointsStored: input.rosterPoints.length,
          unmappedEntityRefs: [],
          expectedGamesStored: input.expectedGameRefs.length,
          unmappedGameRefs: [],
        },
      };
    },
    async publishSnapshot(input) {
      operations.push('publish-snapshot');
      published.push(input.payload);
      publishInputs.push(input);
      activityWindows.push(input.activityWindows);
      const snapshot: StoredProjectionSnapshot = {
        snapshotId: `snapshot-${published.length}` as StoredProjectionSnapshot['snapshotId'],
        leagueSeasonId: input.leagueSeasonId,
        period: input.period,
        modelVersion: input.modelVersion,
        revisionKey: input.revisionKey,
        calculatedAt: input.calculatedAt,
        publishedAt: input.calculatedAt,
        verifiedAt: input.calculatedAt,
        activityWindows: input.activityWindows,
        isCurrent: true,
        payload: input.payload,
      };
      return { kind: 'published', snapshot };
    },
    pruneHistory: pruned,
    async readCurrentSnapshot() {
      operations.push('read-current-snapshot');
      return null;
    },
    async readSnapshotSelection() {
      return { selected: null, latest: null };
    },
  };
  return {
    repository,
    store: repository,
    identityCrosswalk,
    acquired,
    completed,
    failed,
    frozen,
    recordedStates,
    pruned,
    operations,
    gamesUpserted,
    candidateBatches,
    published,
    publishInputs,
    activityWindows,
  };
}

export type WorkerTestDependencies = LiveProjectionWorkerDependencies & Readonly<{
  cadenceMock: ReturnType<typeof vi.fn>;
  sourceMock: ReturnType<typeof vi.fn>;
  projectionMock: ReturnType<typeof vi.fn>;
  gamesMock: ReturnType<typeof vi.fn>;
  assessmentMock: ReturnType<typeof vi.fn>;
  clockMock: ReturnType<typeof vi.fn>;
  monotonicMock: ReturnType<typeof vi.fn>;
  workerIdMock: ReturnType<typeof vi.fn>;
  loggerMock: ReturnType<typeof vi.fn>;
}>;

export function workerDependencies(
  fake: FakeStore,
  options: Readonly<{
    cadence?: LeagueCadenceState;
    games?: GameStateSlate;
    projections?: ProjectionSlate;
    now?: Date;
  }> = {},
): WorkerTestDependencies {
  const configurations = [configuration('l1'), configuration('l2')];
  const cadenceMock = vi.fn(async (leagueConfiguration: LeagueConfiguration) => (
    options.cadence ?? cadenceInput(String(leagueConfiguration.leagueRef.externalId))
  ));
  const sourceMock = vi.fn(async (
    leagueConfiguration: LeagueConfiguration,
    targetPeriod: LeaguePeriod,
  ) => {
    void targetPeriod;
    return source(String(leagueConfiguration.leagueRef.externalId));
  });
  const projectionMock = vi.fn(async () => ({
    status: 'available' as const,
    slate: options.projections ?? projectionResult(),
  }));
  const gamesMock = vi.fn(async () => ({
    status: 'available' as const,
    slate: options.games ?? gameStates(),
  }));
  const assessmentMock = vi.fn(assessProjectionSlate);
  const clockMock = vi.fn(() => new Date(options.now ?? NOW));
  let monotonicValue = 0;
  const monotonicMock = vi.fn(() => {
    monotonicValue += 1;
    return monotonicValue;
  });
  const workerIdMock = vi.fn(() => 'worker-1');
  const loggerMock = vi.fn((level: 'info' | 'warn' | 'error', entry: Parameters<LiveProjectionWorkerDependencies['logger']['write']>[1]) => {
    const line = JSON.stringify({ service: 'live-projection-sync', ...entry });
    if (level === 'error') console.error(line);
    else if (level === 'warn') console.warn(line);
    else console.info(line);
  });
  return {
    repository: fake.repository,
    identityCrosswalk: fake.identityCrosswalk,
    leagueRegistry: { listActiveLeagues: () => configurations },
    nflCalendar: { getCadenceState: cadenceMock },
    leagueSource: { getLeagueWeek: sourceMock },
    projectionFeed: { getProjectionSlate: projectionMock, assessProjectionSlate: assessmentMock },
    gameStateFeed: { getGameStateSlate: gamesMock },
    normalizeScoringProfile: normalizeSleeperScoringProfile,
    clock: { now: clockMock, monotonicNow: monotonicMock },
    idGenerator: { generate: workerIdMock },
    logger: { write: loggerMock },
    cadenceMock,
    sourceMock,
    projectionMock,
    gamesMock,
    assessmentMock,
    clockMock,
    monotonicMock,
    workerIdMock,
    loggerMock,
  };
}
