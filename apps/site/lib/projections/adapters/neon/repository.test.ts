import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import type { CanonicalScoringProfile, GameStateObservation, LeaguePeriod } from '../../domain/contracts';
import type {
  LeagueSeasonId,
  ObservationId,
  ProjectionRunId,
  ScoringProfileId,
} from '../../ports/projection-repository';
import type { NflGameId, ScoringEntityId } from '../../ports/identity-crosswalk';
import {
  externalGameRef,
  externalLeagueRef,
  externalPlayerRef,
  externalRosterRef,
  providerKey,
} from '../../shared/provider-identity';
import type {
  PlayerProjectionRecord,
  StoredProjectionSnapshot as LowLevelSnapshot,
} from './contracts';
import { createNeonProjectionRepository } from './repository';

type RepositoryStore = Parameters<typeof createNeonProjectionRepository>[0];

const officialProvider = providerKey('official-source');
const projectionProvider = providerKey('projection-source');
const gameStateProvider = providerKey('game-state-source');
const options = { officialProvider, projectionProvider, gameStateProvider };
const period: LeaguePeriod = { season: 2026, seasonType: 'regular', week: 1 };
const leagueRef = externalLeagueRef(officialProvider, 'league-opaque');
const rosterRef = externalRosterRef(leagueRef, 'roster-opaque');
const officialEntityRef = externalPlayerRef(officialProvider, 'player-opaque');
const gameRef = externalGameRef(gameStateProvider, 'game-opaque');
const leagueSeasonId = 'league-season-uuid' as LeagueSeasonId;
const scoringProfileId = 'scoring-profile-uuid' as ScoringProfileId;
const entityId = 'entity-uuid' as ScoringEntityId;
const gameId = 'game-uuid' as NflGameId;
const observationId = 'observation-uuid' as ObservationId;
const runId = 'run-uuid' as ProjectionRunId;

const scoringProfile: CanonicalScoringProfile = {
  rules: { passingYards: 0.04, passingTouchdowns: 6 },
  provenance: {
    provider: officialProvider,
    rawRules: { pass_yd: 0.04, pass_td: 6 },
    supportedSourceKeys: ['pass_td', 'pass_yd'],
    unsupportedSourceKeys: [],
    aggregateTwoPointConversionSupported: false,
    usesPointsAllowedBucketProxy: false,
  },
};

const payload = {
  league: { season: '2026', rosterPositions: ['QB'], week: 1, maxWeek: 18 },
  teams: [],
  updatedAt: '2026-09-13T16:00:30.000Z',
  week: 1,
  matchups: [],
};

const lowLevelSnapshot: LowLevelSnapshot = {
  snapshotId: 'snapshot-uuid',
  leagueSeasonId: String(leagueSeasonId),
  week: 1,
  modelVersion: 'clock-v1',
  revisionKey: 'revision-1',
  calculatedAt: '2026-09-13T16:00:30.000Z',
  publishedAt: '2026-09-13T16:00:31.000Z',
  verifiedAt: '2026-09-13T16:00:31.000Z',
  activityWindows: [{ startsAt: '2026-09-13T14:00:00.000Z', endsAt: '2026-09-13T23:00:00.000Z' }],
  isCurrent: true,
  payload,
};

const lowLevelBaseline: PlayerProjectionRecord = {
  sleeperPlayerId: 'player-opaque',
  entityId: String(entityId),
  entityKind: 'player',
  displayName: 'A.J. Example',
  nflTeam: 'PHI',
  gameId: String(gameId),
  tank01GameId: 'game-opaque',
  projectionPoints: 18.25,
  projectedStats: { kind: 'offense', receivingYards: 84 },
  quality: 'complete',
  sourceProjectionRunId: String(runId),
  projectionProvider: String(projectionProvider),
  modelVersion: 'clock-v1',
  fetchedAt: '2026-09-13T15:59:59.000Z',
  frozenAt: null,
};

function createStore(overrides: Partial<RepositoryStore> = {}): RepositoryStore {
  return {
    enabled: true,
    registerLeagueSeason: vi.fn(async () => ({
      kind: 'stored' as const,
      value: {
        leagueId: 'league-uuid',
        leagueSeasonId: String(leagueSeasonId),
        scoringProfileId: String(scoringProfileId),
      },
    })),
    recordProjectionCandidates: vi.fn(async () => ({
      kind: 'stored' as const,
      value: { runId: String(runId), candidatesStored: 1, candidateCount: 1 },
    })),
    readLatestCandidatesBySleeperIds: vi.fn(async () => [lowLevelBaseline]),
    freezeLatestBaselines: vi.fn(async () => ({ kind: 'stored' as const, value: [lowLevelBaseline] })),
    readFrozenBaselinesBySleeperIds: vi.fn(async () => [lowLevelBaseline]),
    recordGameStates: vi.fn(async () => ({
      kind: 'stored' as const,
      value: [{
        externalGameId: 'game-opaque', sourceRevision: 'game-revision', observationId: String(observationId),
      }],
    })),
    recordLeagueWeekObservation: vi.fn(async () => ({
      kind: 'stored' as const,
      value: {
        observationId: String(observationId),
        playerPointsStored: 1,
        rosterPointsStored: 1,
        unmappedSleeperPlayerIds: ['player-opaque'],
        expectedGamesStored: 1,
        unmappedTank01GameIds: ['game-opaque'],
      },
    })),
    acquireJob: vi.fn(async () => ({ kind: 'acquired' as const, attempt: 1, leaseUntil: '2026-09-13T16:01:00.000Z' })),
    completeJob: vi.fn(async () => true),
    failJob: vi.fn(async () => true),
    publishSnapshot: vi.fn(async () => ({ kind: 'published' as const, snapshot: lowLevelSnapshot })),
    pruneHistory: vi.fn(async () => ({
      kind: 'stored' as const,
      value: {
        snapshotsDeleted: 1,
        leagueObservationsDeleted: 2,
        gameObservationsDeleted: 3,
        projectionRunsDeleted: 4,
        jobsDeleted: 5,
      },
    })),
    readCurrentSnapshot: vi.fn(async () => lowLevelSnapshot),
    readSnapshotSelectionBySleeperLeagueId: vi.fn(async () => ({
      selected: lowLevelSnapshot,
      latest: lowLevelSnapshot,
    })),
    ...overrides,
  };
}

describe('Neon canonical projection repository', () => {
  it('owns every disabled outcome without invoking or validating the low-level store', async () => {
    const store = createStore({ enabled: false });
    const repository = createNeonProjectionRepository(store, undefined as never);

    expect(repository.enabled).toBe(false);
    await expect(repository.registerLeagueSeason(undefined as never)).resolves.toEqual({ kind: 'disabled' });
    await expect(repository.recordProjectionCandidates(undefined as never)).resolves.toEqual({ kind: 'disabled' });
    await expect(repository.readLatestCandidates(undefined as never)).resolves.toEqual([]);
    await expect(repository.freezeLatestBaselines(undefined as never)).resolves.toEqual({ kind: 'disabled' });
    await expect(repository.readFrozenBaselines(undefined as never)).resolves.toEqual([]);
    await expect(repository.recordGameStates(undefined as never)).resolves.toEqual({ kind: 'disabled' });
    await expect(repository.recordLeagueWeekObservation(undefined as never)).resolves.toEqual({ kind: 'disabled' });
    await expect(repository.acquireJob(undefined as never)).resolves.toEqual({ kind: 'disabled' });
    await expect(repository.completeJob(undefined as never, undefined as never)).resolves.toBe(false);
    await expect(repository.failJob(undefined as never, undefined as never, undefined as never)).resolves.toBe(false);
    await expect(repository.publishSnapshot(undefined as never)).resolves.toEqual({ kind: 'disabled' });
    await expect(repository.pruneHistory(undefined as never)).resolves.toEqual({ kind: 'disabled' });
    await expect(repository.readCurrentSnapshot(undefined as never, undefined as never)).resolves.toBeNull();
    await expect(repository.readSnapshotSelection(undefined as never)).resolves.toEqual({ selected: null, latest: null });

    for (const value of Object.values(store)) {
      if (typeof value === 'function') expect(value).not.toHaveBeenCalled();
    }
  });

  it('translates league, projection, game, and official observation writes exactly', async () => {
    const store = createStore();
    const repository = createNeonProjectionRepository(store, options);

    await expect(repository.registerLeagueSeason({
      configuration: { key: 'league-one', displayName: 'League One', leagueRef },
      leagueName: 'League One 2026', period, scoringProfile,
    })).resolves.toEqual({
      kind: 'stored', value: { leagueSeasonId, scoringProfileId, leagueRef },
    });
    expect(store.registerLeagueSeason).toHaveBeenCalledWith({
      leagueKey: 'league-one',
      leagueName: 'League One 2026',
      season: 2026,
      sleeperLeagueId: 'league-opaque',
      scoringRules: { pass_yd: 0.04, pass_td: 6 },
    });

    await expect(repository.recordProjectionCandidates({
      source: projectionProvider,
      period,
      modelVersion: 'clock-v1',
      sourceRevision: 'projection-revision',
      requestStartedAt: '2026-09-13T15:59:58.000Z',
      requestCompletedAt: '2026-09-13T15:59:59.000Z',
      observedAt: '2026-09-13T15:59:59.000Z',
      quality: 'complete',
      candidates: [{
        gameId, entityId, scoringProfileId, projectionPoints: 18.25,
        projectedStats: { kind: 'offense', receivingYards: 84 }, quality: 'complete',
      }],
    })).resolves.toEqual({
      kind: 'stored', value: { runId, candidatesStored: 1, candidateCount: 1 },
    });
    expect(store.recordProjectionCandidates).toHaveBeenCalledWith({
      provider: 'projection-source',
      season: 2026,
      seasonType: 'reg',
      week: 1,
      modelVersion: 'clock-v1',
      sourceRevision: 'projection-revision',
      requestStartedAt: '2026-09-13T15:59:58.000Z',
      requestCompletedAt: '2026-09-13T15:59:59.000Z',
      fetchedAt: '2026-09-13T15:59:59.000Z',
      quality: 'complete',
      candidates: [{
        gameId: 'game-uuid', entityId: 'entity-uuid', scoringProfileId: 'scoring-profile-uuid',
        projectionPoints: 18.25,
        projectedStats: { kind: 'offense', receivingYards: 84 },
        quality: 'complete',
      }],
    });

    const state: GameStateObservation = {
      gameRef,
      period,
      homeTeam: 'PHI',
      awayTeam: 'DAL',
      statusCode: 1,
      statusText: 'In Progress',
      sourcePeriod: 'Q2',
      gameClock: '12:34',
      phase: 'q2',
      clockSeconds: 754,
      remainingFraction: 0.71,
      homeScore: 14,
      awayScore: 7,
      requestStartedAt: '2026-09-13T16:00:00.000Z',
      requestCompletedAt: '2026-09-13T16:00:01.000Z',
      observedAt: '2026-09-13T16:00:01.000Z',
      sourceRevision: 'game-revision',
    };
    await expect(repository.recordGameStates({ source: gameStateProvider, states: [state] })).resolves.toEqual({
      kind: 'stored', value: [{ gameRef, sourceRevision: 'game-revision', observationId }],
    });
    expect(store.recordGameStates).toHaveBeenCalledWith({
      provider: 'game-state-source',
      states: [{
        externalGameId: 'game-opaque',
        sourceRevision: 'game-revision',
        requestStartedAt: '2026-09-13T16:00:00.000Z',
        requestCompletedAt: '2026-09-13T16:00:01.000Z',
        observedAt: '2026-09-13T16:00:01.000Z',
        statusCode: 1,
        period: 'Q2',
        gameClock: '12:34',
        homeScore: 14,
        awayScore: 7,
        sourceData: {
          statusText: 'In Progress', phase: 'q2', clockSeconds: 754, remainingFraction: 0.71,
        },
      }],
    });

    await expect(repository.recordLeagueWeekObservation({
      leagueSeasonId,
      period,
      sourceRevision: 'official-revision',
      requestStartedAt: '2026-09-13T16:00:00.000Z',
      requestCompletedAt: '2026-09-13T16:00:02.000Z',
      observedAt: '2026-09-13T16:00:02.000Z',
      quality: 'complete',
      sourceData: { source: 'fixture' },
      expectedGameRefs: [gameRef],
      entityPoints: [{
        entityRef: officialEntityRef, rosterRef, points: 12.4, isStarter: true, lineupSlot: 'WR',
      }],
      rosterPoints: [{ rosterRef, points: 84.6 }],
    })).resolves.toEqual({
      kind: 'stored',
      value: {
        observationId,
        entityPointsStored: 1,
        rosterPointsStored: 1,
        unmappedEntityRefs: [officialEntityRef],
        expectedGamesStored: 1,
        unmappedGameRefs: [gameRef],
      },
    });
    expect(store.recordLeagueWeekObservation).toHaveBeenCalledWith({
      leagueSeasonId: 'league-season-uuid',
      week: 1,
      sourceRevision: 'official-revision',
      requestStartedAt: '2026-09-13T16:00:00.000Z',
      requestCompletedAt: '2026-09-13T16:00:02.000Z',
      observedAt: '2026-09-13T16:00:02.000Z',
      quality: 'complete',
      sourceData: { source: 'fixture' },
      expectedTank01GameIds: ['game-opaque'],
      playerPoints: [{
        sleeperPlayerId: 'player-opaque', entityKind: 'player', externalRosterId: 'roster-opaque',
        points: 12.4, isStarter: true, lineupSlot: 'WR',
      }],
      rosterPoints: [{ externalRosterId: 'roster-opaque', points: 84.6 }],
    });
  });

  it('translates latest and frozen baseline reads and freeze parameters exactly', async () => {
    const store = createStore();
    const repository = createNeonProjectionRepository(store, options);
    const readInput = {
      leagueSeasonId, period, source: projectionProvider,
      modelVersion: 'clock-v1', officialEntityRefs: [officialEntityRef],
    };

    const latest = await repository.readLatestCandidates(readInput);
    expect(store.readLatestCandidatesBySleeperIds).toHaveBeenCalledWith({
      leagueSeasonId: 'league-season-uuid', season: 2026, seasonType: 'reg', week: 1,
      provider: 'projection-source', modelVersion: 'clock-v1', sleeperPlayerIds: ['player-opaque'],
    });
    expect(latest).toEqual([{
      officialEntityRef,
      entityId,
      entityKind: 'player',
      displayName: 'A.J. Example',
      nflTeam: 'PHI',
      gameId,
      projectionGameRef: gameRef,
      projectionPoints: 18.25,
      projectedStats: { kind: 'offense', receivingYards: 84 },
      quality: 'complete',
      sourceProjectionRunId: runId,
      projectionSource: projectionProvider,
      modelVersion: 'clock-v1',
      observedAt: '2026-09-13T15:59:59.000Z',
      frozenAt: null,
    }]);

    await repository.readFrozenBaselines(readInput);
    expect(store.readFrozenBaselinesBySleeperIds).toHaveBeenCalledWith({
      leagueSeasonId: 'league-season-uuid', season: 2026, seasonType: 'reg', week: 1,
      provider: 'projection-source', modelVersion: 'clock-v1', sleeperPlayerIds: ['player-opaque'],
    });

    await expect(repository.freezeLatestBaselines({
      leagueSeasonId, period, modelVersion: 'clock-v1', projectionSource: projectionProvider,
      gameStateSource: gameStateProvider, gameRefs: [gameRef], frozenAt: '2026-09-13T16:00:00.000Z',
    })).resolves.toMatchObject({ kind: 'stored', value: [{ officialEntityRef, projectionGameRef: gameRef }] });
    expect(store.freezeLatestBaselines).toHaveBeenCalledWith({
      leagueSeasonId: 'league-season-uuid', season: 2026, seasonType: 'reg', week: 1,
      modelVersion: 'clock-v1', projectionProvider: 'projection-source',
      gameProvider: 'game-state-source', externalGameIds: ['game-opaque'],
      frozenAt: '2026-09-13T16:00:00.000Z',
    });
  });

  it('passes job and retention contracts through without changing values or ordering', async () => {
    const store = createStore();
    const repository = createNeonProjectionRepository(store, options);
    const job = {
      jobKey: 'job-1', jobType: 'refresh', scheduledFor: '2026-09-13T16:00:00.000Z',
      payload: { league: 'one' }, workerId: 'worker-1', leaseSeconds: 60,
    };
    const retention = { before: '2026-08-01T00:00:00.000Z', keepRecentSnapshotsPerLeagueWeek: 2 };

    await expect(repository.acquireJob(job)).resolves.toMatchObject({ kind: 'acquired', attempt: 1 });
    await expect(repository.completeJob('job-1', 'worker-1')).resolves.toBe(true);
    await expect(repository.failJob('job-2', 'worker-1', 'provider failed')).resolves.toBe(true);
    await expect(repository.pruneHistory(retention)).resolves.toMatchObject({
      kind: 'stored', value: { snapshotsDeleted: 1, jobsDeleted: 5 },
    });
    expect(store.acquireJob).toHaveBeenCalledWith(job);
    expect(store.completeJob).toHaveBeenCalledWith('job-1', 'worker-1');
    expect(store.failJob).toHaveBeenCalledWith('job-2', 'worker-1', 'provider failed');
    expect(store.pruneHistory).toHaveBeenCalledWith(retention);
  });

  it('translates published and selected snapshots without leaking the low-level week field', async () => {
    const store = createStore();
    const repository = createNeonProjectionRepository(store, options);
    const publishInput = {
      leagueSeasonId,
      period,
      modelVersion: 'clock-v1',
      revisionKey: 'revision-1',
      leagueWeekObservationId: observationId,
      gameStateObservationIds: [observationId],
      calculatedAt: '2026-09-13T16:00:30.000Z',
      payload,
      activityWindows: lowLevelSnapshot.activityWindows,
      maxSourceSkewSeconds: 90,
    };

    const published = await repository.publishSnapshot(publishInput);
    expect(store.publishSnapshot).toHaveBeenCalledWith({
      leagueSeasonId: 'league-season-uuid', week: 1, modelVersion: 'clock-v1', revisionKey: 'revision-1',
      leagueWeekObservationId: 'observation-uuid', gameStateObservationIds: ['observation-uuid'],
      calculatedAt: '2026-09-13T16:00:30.000Z', payload,
      activityWindows: lowLevelSnapshot.activityWindows, maxSourceSkewSeconds: 90,
    });
    expect(published).toMatchObject({
      kind: 'published',
      snapshot: { snapshotId: 'snapshot-uuid', leagueSeasonId, period, payload },
    });
    if (published.kind === 'published') expect(published.snapshot).not.toHaveProperty('week');

    const current = await repository.readCurrentSnapshot(leagueSeasonId, period);
    expect(store.readCurrentSnapshot).toHaveBeenCalledWith('league-season-uuid', 1);
    expect(current).toMatchObject({ period, payload });
    expect(current).not.toHaveProperty('week');

    const selection = await repository.readSnapshotSelection(leagueRef, 1);
    expect(store.readSnapshotSelectionBySleeperLeagueId).toHaveBeenCalledWith('league-opaque', 1);
    expect(selection.selected).toMatchObject({ period, payload });
    expect(selection.latest).toMatchObject({ period, payload });
    expect(selection.selected).not.toHaveProperty('week');
  });

  it('rejects provider mismatches before calling low-level methods', async () => {
    const store = createStore();
    const repository = createNeonProjectionRepository(store, options);
    const other = providerKey('wrong-source');

    await expect(repository.recordProjectionCandidates({
      source: other, period, modelVersion: 'clock-v1', sourceRevision: 'r',
      requestStartedAt: 'a', requestCompletedAt: 'b', observedAt: 'b', quality: 'complete', candidates: [],
    })).rejects.toThrow('Projection source belongs to an unexpected provider.');
    await expect(repository.readLatestCandidates({
      leagueSeasonId, period, source: projectionProvider, modelVersion: 'clock-v1',
      officialEntityRefs: [externalPlayerRef(other, 'player-opaque')],
    })).rejects.toThrow('Scoring entity reference belongs to an unexpected provider.');
    await expect(repository.recordGameStates({
      source: gameStateProvider,
      states: [{
        gameRef: externalGameRef(other, 'game-opaque'), period, homeTeam: 'PHI', awayTeam: 'DAL',
        statusCode: 0, statusText: null, sourcePeriod: null, gameClock: null, phase: 'pregame',
        clockSeconds: null, remainingFraction: 1, homeScore: null, awayScore: null,
        requestStartedAt: 'a', requestCompletedAt: 'b', observedAt: 'b', sourceRevision: 'r',
      }],
    })).rejects.toThrow('NFL game reference belongs to an unexpected provider.');
    await expect(repository.readSnapshotSelection(externalLeagueRef(other, 'league-opaque')))
      .rejects.toThrow('League reference belongs to an unexpected provider.');

    expect(store.recordProjectionCandidates).not.toHaveBeenCalled();
    expect(store.readLatestCandidatesBySleeperIds).not.toHaveBeenCalled();
    expect(store.recordGameStates).not.toHaveBeenCalled();
    expect(store.readSnapshotSelectionBySleeperLeagueId).not.toHaveBeenCalled();
  });

  it('rejects unexpected providers and malformed teams returned by the low-level store', async () => {
    const wrongProviderStore = createStore({
      readLatestCandidatesBySleeperIds: vi.fn(async () => [{
        ...lowLevelBaseline, projectionProvider: 'unexpected-provider',
      }]),
    });
    const wrongTeamStore = createStore({
      readLatestCandidatesBySleeperIds: vi.fn(async () => [{ ...lowLevelBaseline, nflTeam: 'XXX' }]),
    });
    const input = {
      leagueSeasonId, period, source: projectionProvider,
      modelVersion: 'clock-v1', officialEntityRefs: [officialEntityRef],
    };
    await expect(createNeonProjectionRepository(wrongProviderStore, options).readLatestCandidates(input))
      .rejects.toThrow('Stored projection baseline belongs to an unexpected provider.');
    await expect(createNeonProjectionRepository(wrongTeamStore, options).readLatestCandidates(input))
      .rejects.toThrow('Stored projection baseline has an invalid NFL team.');
  });
});

describe('Neon canonical adapter boundary', () => {
  it('contains translation only: no SQL, environment reads, or store construction', () => {
    const directory = dirname(fileURLToPath(import.meta.url));
    for (const filename of ['repository.ts', 'identity-crosswalk.ts']) {
      const source = readFileSync(join(directory, filename), 'utf8');
      expect(source, filename).not.toMatch(/process\.env/u);
      expect(source, filename).not.toMatch(/\b(?:SELECT|INSERT|UPDATE|DELETE)\s+(?:FROM|INTO|SET|[\w".])/iu);
      expect(source, filename).not.toMatch(/\b(?:createProjectionStore|getProjectionStore|getDatabase)\b/u);
      expect(source, filename).not.toMatch(/from\s+['"][^'"]*(?:database|\.\/identities|\.\/projections|\.\/observations|\.\/snapshots)[^'"]*['"]/u);
    }
  });
});
