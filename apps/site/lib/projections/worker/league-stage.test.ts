import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import type {
  CanonicalScoringProfile,
  GameStateObservation,
  LeagueWeekState,
  ProjectionObservation,
} from '../domain/contracts';
import type { NflGameId, ScoringEntityId } from '../ports/identity-crosswalk';
import type {
  LeagueSeasonId,
  ObservationId,
  ProjectionRepositoryPort,
  ProjectionRunId,
  ProjectionSlateContentId,
  ProjectionSlateObservationId,
  ScoringProfileId,
} from '../ports/projection-repository';
import {
  externalGameRef,
  externalLeagueRef,
  externalPlayerRef,
  externalReferenceKey,
  externalMatchupRef,
  externalRosterRef,
  externalTeamDefenseRef,
  providerKey,
} from '../shared/provider-identity';
import { compatibleRevision } from '../shared/revision-compatibility';
import type {
  LiveProjectionWorkerDependencies,
  LoadedLeague,
  PersistedGroup,
  ScoringProfileNormalization,
} from './contracts';
import { processLeague } from './league-stage';
import { createProviderGroupScoringCache } from './scoring-cache';

const officialProvider = providerKey('official-source');
const projectionProvider = providerKey('projection-source');
const gameProvider = providerKey('game-source');
const period = { season: 2026, seasonType: 'regular', week: 1 } as const;
const calculatedAt = '2026-09-13T16:00:30.000Z';
const observedAt = '2026-09-13T16:00:00.000Z';
const leagueRef = externalLeagueRef(officialProvider, 'league-1');
const rosterOne = externalRosterRef(leagueRef, '1');
const rosterTwo = externalRosterRef(leagueRef, '2');
const playerRef = externalPlayerRef(officialProvider, 'player-1');
const defenseRef = externalTeamDefenseRef(officialProvider, 'BUF');
const benchRef = externalPlayerRef(officialProvider, 'bench-1');
const liveGameRef = externalGameRef(gameProvider, 'game-live');
const pregameGameRef = externalGameRef(gameProvider, 'game-pregame');
const leagueSeasonId = 'league-season-id' as LeagueSeasonId;
const scoringProfileId = 'scoring-profile-id' as ScoringProfileId;
const observationId = 'league-observation-id' as ObservationId;

const scoringProfile: CanonicalScoringProfile = {
  rules: { receivingYards: 0.1, sacks: 1 },
  provenance: {
    provider: officialProvider,
    rawRules: { rec_yd: 0.1, sack: 1 },
    supportedSourceKeys: ['rec_yd', 'sack'],
    unsupportedSourceKeys: [],
    aggregateTwoPointConversionSupported: true,
    usesPointsAllowedBucketProxy: false,
  },
};

const player = {
  kind: 'player' as const,
  externalRef: playerRef,
  displayName: 'Player One',
  nflTeam: 'PHI' as const,
  position: 'WR',
  injuryStatus: null,
};
const defense = {
  kind: 'team-defense' as const,
  externalRef: defenseRef,
  displayName: 'Buffalo Defense',
  nflTeam: 'BUF' as const,
  position: 'DEF',
  injuryStatus: null,
};
const bench = {
  kind: 'player' as const,
  externalRef: benchRef,
  displayName: 'Bench Player',
  nflTeam: 'MIA' as const,
  position: 'RB',
  injuryStatus: null,
};

const source: LeagueWeekState = {
  configuration: { key: 'league-one', displayName: 'League One', leagueRef, matchupWeekRange: { firstWeek: 1, lastWeek: 18 } },
  lineup: { revisionVersion: 'lineup-v1', lineupRevision: 'a'.repeat(64) },
  lineupShape: { expectedRosterCount: 2, expectedStarterSlotCount: 1, expectedRosterRefs: [rosterOne, rosterTwo] },
  leagueName: 'League One 2026',
  period,
  maxWeek: 18,
  rosterPositions: ['WR', 'DEF'],
  participants: [
    {
      rosterRef: rosterOne, managerName: 'Manager One', teamName: 'Team One', avatarUrl: null,
      wins: 0, losses: 0, ties: 0, pointsFor: 0, pointsAgainst: 0,
    },
    {
      rosterRef: rosterTwo, managerName: 'Manager Two', teamName: 'Team Two', avatarUrl: null,
      wins: 0, losses: 0, ties: 0, pointsFor: 0, pointsAgainst: 0,
    },
  ],
  matchups: [{
    matchupRef: externalMatchupRef(leagueRef, period, '1'),
    status: 'live',
    sides: [
      {
        rosterRef: rosterOne, officialPoints: 10,
        starters: [{ kind: 'occupied', slot: 'WR', entity: player, officialPoints: 10 }],
      },
      {
        rosterRef: rosterTwo, officialPoints: 4,
        starters: [{ kind: 'occupied', slot: 'DEF', entity: defense, officialPoints: 4 }],
      },
    ],
  }],
  rosteredEntities: [player, defense, bench],
  schedule: {
    PHI: {
      kind: 'scheduled', opponent: 'DAL', location: 'home', date: '2026-09-13',
      kickoffAt: '2026-09-13T15:00:00.000Z',
    },
    DAL: {
      kind: 'scheduled', opponent: 'PHI', location: 'away', date: '2026-09-13',
      kickoffAt: '2026-09-13T15:00:00.000Z',
    },
    BUF: {
      kind: 'scheduled', opponent: 'MIA', location: 'home', date: '2026-09-14',
      kickoffAt: '2026-09-14T00:00:00.000Z',
    },
    MIA: {
      kind: 'scheduled', opponent: 'BUF', location: 'away', date: '2026-09-14',
      kickoffAt: '2026-09-14T00:00:00.000Z',
    },
  },
  scoringSettings: { provider: officialProvider, rawRules: { rec_yd: 0.1, sack: 1 } },
  requestStartedAt: '2026-09-13T15:59:59.000Z',
  requestCompletedAt: observedAt,
  observedAt,
  sourceRevision: 'official-revision',
  warning: 'fixture warning',
};

const playerProjection: ProjectionObservation = {
  identity: {
    primary: externalPlayerRef(projectionProvider, 'projection-player-1'),
    aliases: [playerRef],
  },
  nflTeam: 'PHI',
  position: 'WR',
  stats: { rawReceivingYards: '50.0' },
  scoringStats: { kind: 'offense', receivingYards: 50 },
  missingFields: [],
};
const defenseProjection: ProjectionObservation = {
  identity: {
    primary: externalTeamDefenseRef(projectionProvider, 'BUF'),
    aliases: [],
  },
  nflTeam: 'BUF',
  position: 'DEF',
  stats: { rawSacks: '3.0' },
  scoringStats: { kind: 'defense', sacks: 3 },
  missingFields: [],
};

function game(
  gameRef: typeof liveGameRef,
  homeTeam: 'PHI' | 'BUF',
  awayTeam: 'DAL' | 'MIA',
  live: boolean,
): GameStateObservation {
  return {
    gameRef,
    period,
    homeTeam,
    awayTeam,
    statusCode: live ? 1 : 0,
    statusText: live ? 'In Progress' : 'Not Started Yet',
    sourcePeriod: live ? 'Q2' : null,
    gameClock: live ? '15:00' : null,
    phase: live ? 'q2' : 'pregame',
    clockSeconds: live ? 900 : null,
    remainingFraction: live ? 0.75 : 1,
    homeScore: live ? 14 : null,
    awayScore: live ? 7 : null,
    requestStartedAt: '2026-09-13T15:59:59.000Z',
    requestCompletedAt: observedAt,
    observedAt,
    sourceRevision: `${String(gameRef.externalId)}-revision`,
  };
}

const league: LoadedLeague = {
  configuration: source.configuration,
  source,
  cadence: 'live-window',
};

const persisted: PersistedGroup = {
  games: {
    source: gameProvider,
    period,
    requestStartedAt: '2026-09-13T15:59:59.000Z',
    requestCompletedAt: observedAt,
    observedAt,
    games: [game(liveGameRef, 'PHI', 'DAL', true), game(pregameGameRef, 'BUF', 'MIA', false)],
  },
  projections: {
    source: projectionProvider,
    period,
    quality: 'complete',
    requestStartedAt: observedAt,
    requestCompletedAt: observedAt,
    observedAt,
    sourceRevision: 'feed-revision',
    projections: [playerProjection, defenseProjection],
    coverage: {
      crosswalkRows: 100, crosswalkEntries: 100, malformedCrosswalkRows: 0,
      ambiguousCrosswalkRows: 0, playerRows: 100, matchedPlayers: 100,
      unmatchedPlayers: 0, malformedPlayers: 0, incompletePlayers: 0,
      defenseRows: 32, usableDefenses: 32, malformedDefenses: 0, incompleteDefenses: 0,
    },
    warnings: [],
  },
  gameIdsByReferenceKey: new Map([
    [externalReferenceKey(liveGameRef), 'live-game-id' as NflGameId],
    [externalReferenceKey(pregameGameRef), 'pregame-game-id' as NflGameId],
  ]),
  gameObservationIdsByReferenceKey: new Map([
    [externalReferenceKey(liveGameRef), 'live-observation-id' as ObservationId],
    [externalReferenceKey(pregameGameRef), 'pregame-observation-id' as ObservationId],
  ]),
  entityIdsByReferenceKey: new Map([
    [externalReferenceKey(playerRef), 'player-entity-id' as ScoringEntityId],
    [externalReferenceKey(defenseRef), 'defense-entity-id' as ScoringEntityId],
    [externalReferenceKey(benchRef), 'bench-entity-id' as ScoringEntityId],
  ]),
  identityConflictCount: 0,
  projectionSourceRevision: 'projection-revision',
  projectionSlateObservationId: 'projection-slate-observation' as ProjectionSlateObservationId,
  projectionSlateContentId: 'projection-slate-content' as ProjectionSlateContentId,
};

function repositoryHarness() {
  const operations: string[] = [];
  const registerLeagueSeason = vi.fn(async () => {
    operations.push('register');
    return {
      kind: 'stored' as const,
      value: { leagueSeasonId, scoringProfileId, leagueRef },
    };
  });
  const recordProjectionCandidates = vi.fn(async (input: { candidates: readonly unknown[] }) => {
    operations.push('candidates');
    return {
      kind: 'stored' as const,
      value: {
        runId: 'projection-run-id' as ProjectionRunId,
        candidatesStored: input.candidates.length,
        candidateCount: input.candidates.length,
      },
    };
  });
  const freezeLatestBaselines = vi.fn(async () => {
    operations.push('freeze');
    return { kind: 'stored' as const, value: [] };
  });
  const readLatestCandidates = vi.fn(async () => {
    operations.push('read-latest');
    return [{
      officialEntityRef: defenseRef,
      entityId: 'defense-entity-id' as ScoringEntityId,
      entityKind: 'team-defense' as const,
      displayName: 'Buffalo Defense',
      nflTeam: 'BUF' as const,
      gameId: 'pregame-game-id' as NflGameId,
      projectionGameRef: pregameGameRef,
      projectionPoints: 6,
      projectedStats: { rawSacks: '3.0' },
      quality: 'complete' as const,
      sourceProjectionRunId: 'projection-run-id' as ProjectionRunId,
      projectionSource: projectionProvider,
      modelVersion: 'clock-v1',
      observedAt,
      frozenAt: null,
    }];
  });
  const readFrozenBaselines = vi.fn(async (): Promise<Awaited<
    ReturnType<ProjectionRepositoryPort['readFrozenBaselines']>
  >> => {
    operations.push('read-frozen');
    return [];
  });
  const readCurrentSnapshot = vi.fn(async () => {
    operations.push('read-prior');
    return null;
  });
  const recordLeagueWeekObservation = vi.fn(async (): Promise<Awaited<
    ReturnType<ProjectionRepositoryPort['recordLeagueWeekObservation']>
  >> => {
    operations.push('observation');
    return {
      kind: 'stored' as const,
      value: {
        observationId,
        entityPointsStored: 2,
        rosterPointsStored: 2,
        unmappedEntityRefs: [],
        expectedGamesStored: 2,
        unmappedGameRefs: [],
      },
    };
  });
  const publishSnapshot = vi.fn(async (
    input: Parameters<ProjectionRepositoryPort['publishSnapshot']>[0],
  ): Promise<Awaited<ReturnType<ProjectionRepositoryPort['publishSnapshot']>>> => {
    void input;
    operations.push('publish');
    return { kind: 'published' as const, snapshot: {} as never };
  });
  const repository = {
    enabled: true,
    registerLeagueSeason,
    recordProjectionCandidates,
    readLatestCandidates,
    freezeLatestBaselines,
    readFrozenBaselines,
    recordGameStates: vi.fn(),
    recordLeagueWeekObservation,
    acquireJob: vi.fn(),
    completeJob: vi.fn(),
    failJob: vi.fn(),
    publishSnapshot,
    pruneHistory: vi.fn(),
    readCurrentSnapshot,
    readSnapshotSelection: vi.fn(),
  } as unknown as ProjectionRepositoryPort;
  return {
    repository,
    operations,
    mocks: {
      registerLeagueSeason,
      recordProjectionCandidates,
      freezeLatestBaselines,
      readLatestCandidates,
      readFrozenBaselines,
      readCurrentSnapshot,
      recordLeagueWeekObservation,
      publishSnapshot,
    },
  };
}

function dependencies(
  repository: ProjectionRepositoryPort,
  normalizeScoringProfile = vi.fn((): ScoringProfileNormalization => ({
    status: 'available', profile: scoringProfile,
  })),
): LiveProjectionWorkerDependencies {
  return {
    repository,
    normalizeScoringProfile,
  } as unknown as LiveProjectionWorkerDependencies;
}

function processTestLeague(
  workerDependencies: LiveProjectionWorkerDependencies,
  selectedLeague = league,
  selectedGroup = persisted,
) {
  return processLeague(
    workerDependencies,
    selectedLeague,
    selectedGroup,
    calculatedAt,
    createProviderGroupScoringCache(
      selectedGroup.projections,
      workerDependencies.normalizeScoringProfile,
    ),
    { publicationFence: { ownerLane: 'current', watchId: 'watch-1', watchGeneration: 1,
      authorityGeneration: 1, runId: 'worker-1' }, actualLineup: selectedLeague.source.lineup },
  );
}

describe('canonical league projection stage', () => {
  it('preserves exact candidate and snapshot payloads with cached slate scores', async () => {
    const harness = repositoryHarness();

    await processTestLeague(dependencies(harness.repository));

    expect(harness.operations).toEqual([
      'register', 'candidates', 'freeze',
      'read-latest', 'read-frozen', 'read-prior',
      'observation', 'publish',
    ]);
    expect(harness.mocks.registerLeagueSeason).toHaveBeenCalledWith({
      configuration: source.configuration,
      leagueName: 'League One 2026',
      period,
      scoringProfile,
    });
    expect(harness.mocks.recordProjectionCandidates).toHaveBeenCalledWith({
      source: projectionProvider,
      period,
      modelVersion: 'clock-v1',
      sourceRevision: 'projection-revision',
      requestStartedAt: observedAt,
      requestCompletedAt: observedAt,
      observedAt,
      quality: 'complete',
      projectionSlateObservationId: 'projection-slate-observation',
      candidates: [
        {
          gameId: 'live-game-id', entityId: 'player-entity-id', scoringProfileId,
          projectionPoints: 5, projectedStats: { rawReceivingYards: '50.0' }, quality: 'complete',
        },
        {
          gameId: 'pregame-game-id', entityId: 'defense-entity-id', scoringProfileId,
          projectionPoints: 3, projectedStats: { rawSacks: '3.0' }, quality: 'complete',
        },
        {
          gameId: 'pregame-game-id', entityId: 'bench-entity-id', scoringProfileId,
          projectionPoints: 0, projectedStats: {}, quality: 'missing',
        },
      ],
    });
    expect(harness.mocks.freezeLatestBaselines).toHaveBeenCalledWith({
      leagueSeasonId,
      period,
      modelVersion: 'clock-v1',
      projectionSource: projectionProvider,
      gameStateSource: gameProvider,
      gameRefs: [liveGameRef],
      frozenAt: calculatedAt,
    });
    const baselineRead = {
      leagueSeasonId,
      period,
      source: projectionProvider,
      modelVersion: 'clock-v1',
      officialEntityRefs: [playerRef, defenseRef],
    };
    expect(harness.mocks.readLatestCandidates).toHaveBeenCalledWith(baselineRead);
    expect(harness.mocks.readFrozenBaselines).toHaveBeenCalledWith(baselineRead);
    expect(harness.mocks.readCurrentSnapshot).toHaveBeenCalledWith(leagueSeasonId, period);

    expect(harness.mocks.recordLeagueWeekObservation).toHaveBeenCalledWith({
      lineup: source.lineup,
      leagueSeasonId,
      period,
      sourceRevision: 'official-revision',
      requestStartedAt: '2026-09-13T15:59:59.000Z',
      requestCompletedAt: observedAt,
      observedAt,
      quality: 'complete',
      sourceData: {
        leagueKey: 'league-one',
        season: '2026',
        week: 1,
        updatedAt: observedAt,
        matchupCount: 1,
        rosteredPlayerCount: 3,
        missingFrozenBaselineCount: 1,
        missingBaselinePolicy: 'zero',
        rosterIds: ['1', '2'],
        warning: 'fixture warning',
      },
      expectedGameRefs: [liveGameRef, pregameGameRef],
      entityPoints: [
        {
          entityRef: playerRef, rosterRef: rosterOne, points: 10,
          isStarter: true, lineupSlot: 'WR',
        },
        {
          entityRef: defenseRef, rosterRef: rosterTwo, points: 4,
          isStarter: true, lineupSlot: 'DEF',
        },
      ],
      rosterPoints: [
        { rosterRef: rosterOne, points: 10 },
        { rosterRef: rosterTwo, points: 4 },
      ],
    });

    const expectedRevision = compatibleRevision({
      modelVersion: 'clock-v1',
      sourceRevision: 'official-revision',
      projectionSourceRevision: 'projection-revision',
      missingFrozenBaselineCount: 1,
      games: [
        { id: 'game-live', observationId: 'live-observation-id' },
        { id: 'game-pregame', observationId: 'pregame-observation-id' },
      ],
    });
    expect(harness.mocks.publishSnapshot).toHaveBeenCalledWith(expect.objectContaining({
      leagueSeasonId,
      period,
      modelVersion: 'clock-v1',
      revisionKey: expectedRevision,
      leagueWeekObservationId: observationId,
      gameStateObservationIds: ['live-observation-id', 'pregame-observation-id'],
      calculatedAt,
      maxSourceSkewSeconds: 90,
      activityWindows: [
        { startsAt: '2026-09-13T13:00:00.000Z', endsAt: '2026-09-13T22:00:00.000Z' },
        { startsAt: '2026-09-13T22:00:00.000Z', endsAt: '2026-09-14T07:00:00.000Z' },
      ],
    }));
    const publishInput = harness.mocks.publishSnapshot.mock.calls[0][0] as Parameters<
      ProjectionRepositoryPort['publishSnapshot']
    >[0];
    expect(publishInput.payload).toEqual({
      league: {
        season: '2026',
        rosterPositions: ['WR', 'DEF'],
        week: 1,
        maxWeek: 18,
      },
      teams: [
        {
          id: 1,
          managerName: 'Manager One',
          name: 'Team One',
          avatar: null,
          wins: 0,
          losses: 0,
          ties: 0,
          pointsFor: 0,
          pointsAgainst: 0,
        },
        {
          id: 2,
          managerName: 'Manager Two',
          name: 'Team Two',
          avatar: null,
          wins: 0,
          losses: 0,
          ties: 0,
          pointsFor: 0,
          pointsAgainst: 0,
        },
      ],
      updatedAt: calculatedAt,
      week: 1,
      matchups: [{
        id: '1',
        status: 'live',
        sides: [
          {
            team: {
              id: 1,
              managerName: 'Manager One',
              name: 'Team One',
              avatar: null,
              wins: 0,
              losses: 0,
              ties: 0,
              pointsFor: 0,
              pointsAgainst: 0,
            },
            points: 10,
            projectedPoints: 10,
            starters: [{
              id: 'player-1',
              name: 'Player One',
              position: 'WR',
              nflTeam: 'PHI',
              injuryStatus: null,
              game: {
                kind: 'scheduled',
                opponent: 'DAL',
                location: 'home',
                date: '2026-09-13',
                kickoffAt: '2026-09-13T15:00:00.000Z',
              },
              slot: 'WR',
              points: 10,
              projectedPoints: 10,
            }],
          },
          {
            team: {
              id: 2,
              managerName: 'Manager Two',
              name: 'Team Two',
              avatar: null,
              wins: 0,
              losses: 0,
              ties: 0,
              pointsFor: 0,
              pointsAgainst: 0,
            },
            points: 4,
            projectedPoints: 6,
            starters: [{
              id: 'BUF',
              name: 'Buffalo Defense',
              position: 'DEF',
              nflTeam: 'BUF',
              injuryStatus: null,
              game: {
                kind: 'scheduled',
                opponent: 'MIA',
                location: 'home',
                date: '2026-09-14',
                kickoffAt: '2026-09-14T00:00:00.000Z',
              },
              slot: 'DEF',
              points: 4,
              projectedPoints: 6,
            }],
          },
        ],
      }],
      warning: 'fixture warning',
    });
  });

  it('does not apply the isolated missing-zero policy to an untrusted slate', async () => {
    const harness = repositoryHarness();
    const partial = {
      ...persisted,
      projections: { ...persisted.projections, quality: 'partial' as const },
    };

    await expect(processTestLeague(dependencies(harness.repository), league, partial))
      .rejects.toThrow('Pregame fantasy projections could not be scored.');
    expect(harness.mocks.registerLeagueSeason).toHaveBeenCalledTimes(1);
    expect(harness.mocks.recordProjectionCandidates).not.toHaveBeenCalled();
  });

  it('does not turn a conflicting direct player identity into a missing zero', async () => {
    const harness = repositoryHarness();
    const conflictingProjection = {
      ...playerProjection,
      nflTeam: 'DAL' as const,
    };
    const conflict = {
      ...persisted,
      projections: {
        ...persisted.projections,
        projections: [conflictingProjection, defenseProjection],
      },
    };

    await expect(processTestLeague(dependencies(harness.repository), league, conflict))
      .rejects.toThrow('A starter projection could not be matched safely.');
    expect(harness.mocks.recordProjectionCandidates).not.toHaveBeenCalled();
  });

  it('validates game coverage before normalizing raw scoring settings or writing', async () => {
    const harness = repositoryHarness();
    const normalize = vi.fn((): ScoringProfileNormalization => ({
      status: 'available', profile: scoringProfile,
    }));
    const incompleteGames = {
      ...persisted,
      games: { ...persisted.games, games: [persisted.games.games[1]] },
    };

    await expect(processTestLeague(dependencies(harness.repository, normalize), league, incompleteGames))
      .rejects.toThrow('game-state provider did not provide every active starter game');
    expect(normalize).not.toHaveBeenCalled();
    expect(harness.mocks.registerLeagueSeason).not.toHaveBeenCalled();
  });

  it('waits for latest, frozen, and prior reads before writing the official observation', async () => {
    const harness = repositoryHarness();
    let releaseFrozen!: () => void;
    const frozenGate = new Promise<readonly never[]>((resolve) => { releaseFrozen = () => resolve([]); });
    harness.mocks.readFrozenBaselines.mockImplementationOnce(async () => {
      harness.operations.push('read-frozen-delayed');
      return frozenGate;
    });

    const pending = processTestLeague(dependencies(harness.repository));
    await vi.waitFor(() => {
      expect(harness.mocks.readLatestCandidates).toHaveBeenCalledTimes(1);
      expect(harness.mocks.readFrozenBaselines).toHaveBeenCalledTimes(1);
      expect(harness.mocks.readCurrentSnapshot).toHaveBeenCalledTimes(1);
    });
    expect(harness.mocks.recordLeagueWeekObservation).not.toHaveBeenCalled();
    releaseFrozen();
    await pending;
    expect(harness.mocks.recordLeagueWeekObservation).toHaveBeenCalledTimes(1);
  });

  it('rejects incomplete official persistence and accepts an unchanged publication', async () => {
    const incomplete = repositoryHarness();
    incomplete.mocks.recordLeagueWeekObservation.mockResolvedValueOnce({
      kind: 'stored',
      value: {
        observationId,
        entityPointsStored: 1,
        rosterPointsStored: 2,
        unmappedEntityRefs: [playerRef],
        expectedGamesStored: 2,
        unmappedGameRefs: [],
      },
    });
    await expect(processTestLeague(dependencies(incomplete.repository)))
      .rejects.toThrow('Official source observations could not be persisted completely.');
    expect(incomplete.mocks.publishSnapshot).not.toHaveBeenCalled();

    const unchanged = repositoryHarness();
    unchanged.mocks.publishSnapshot.mockResolvedValueOnce({ kind: 'unchanged', snapshot: {} as never });
    await expect(processTestLeague(dependencies(unchanged.repository)))
      .resolves.toMatchObject({
        publicationOutcome: 'unchanged',
        starterCount: 2,
        candidateCount: 3,
        missingBaselineCount: 1,
      });
  });
});
