import 'server-only';

import type { ProjectionStore, PlayerProjectionRecord, StoredProjectionSnapshot as StoreSnapshot } from './contracts';
import { NFL_TEAM_CODES, type NflTeam } from '../../domain/contracts';
import type {
  LeagueSeasonId,
  ObservationId,
  ProjectionBaselineRecord,
  ProjectionRepositoryPort,
  ProjectionRunId,
  ScoringProfileId,
  StoredProjectionSnapshot,
} from '../../ports/projection-repository';
import type { NflGameId, ScoringEntityId } from '../../ports/identity-crosswalk';
import {
  externalGameRef,
  externalPlayerRef,
  externalTeamDefenseRef,
  type ExternalGameRef,
  type ExternalLeagueRef,
  type ExternalScoringEntityRef,
  type ProviderKey,
} from '../../shared/provider-identity';

type RepositoryStore = Pick<ProjectionStore,
  | 'enabled'
  | 'registerLeagueSeason'
  | 'recordProjectionCandidates'
  | 'readLatestCandidatesBySleeperIds'
  | 'freezeLatestBaselines'
  | 'readFrozenBaselinesBySleeperIds'
  | 'recordGameStates'
  | 'recordLeagueWeekObservation'
  | 'acquireJob'
  | 'completeJob'
  | 'failJob'
  | 'publishSnapshot'
  | 'pruneHistory'
  | 'readCurrentSnapshot'
  | 'readSnapshotSelectionBySleeperLeagueId'
>;

export type NeonProjectionRepositoryOptions = Readonly<{
  officialProvider: ProviderKey;
  projectionProvider: ProviderKey;
  gameStateProvider: ProviderKey;
}>;

function storeSeasonType(value: 'preseason' | 'regular' | 'postseason'): 'pre' | 'reg' | 'post' {
  return value === 'preseason' ? 'pre' : value === 'postseason' ? 'post' : 'reg';
}

function assertProvider(reference: { provider: ProviderKey }, expected: ProviderKey, label: string): void {
  if (reference.provider !== expected) throw new Error(`${label} belongs to an unexpected provider.`);
}

function officialEntityRef(
  provider: ProviderKey,
  externalId: string,
  kind: 'player' | 'team_defense',
): ExternalScoringEntityRef {
  return kind === 'team_defense'
    ? externalTeamDefenseRef(provider, externalId)
    : externalPlayerRef(provider, externalId);
}

function canonicalBaseline(
  record: PlayerProjectionRecord,
  officialProvider: ProviderKey,
  projectionProvider: ProviderKey,
  gameProvider: ProviderKey,
): ProjectionBaselineRecord {
  if (record.projectionProvider !== projectionProvider) {
    throw new Error('Stored projection baseline belongs to an unexpected provider.');
  }
  if (record.nflTeam !== null && !NFL_TEAM_CODES.includes(record.nflTeam as NflTeam)) {
    throw new Error('Stored projection baseline has an invalid NFL team.');
  }
  return {
    officialEntityRef: officialEntityRef(
      officialProvider,
      record.sleeperPlayerId,
      record.entityKind,
    ),
    entityId: record.entityId as ScoringEntityId,
    entityKind: record.entityKind === 'team_defense' ? 'team-defense' : 'player',
    displayName: record.displayName,
    nflTeam: record.nflTeam as NflTeam | null,
    gameId: record.gameId as NflGameId,
    projectionGameRef: record.tank01GameId
      ? externalGameRef(gameProvider, record.tank01GameId)
      : null,
    projectionPoints: record.projectionPoints,
    projectedStats: record.projectedStats,
    quality: record.quality,
    sourceProjectionRunId: record.sourceProjectionRunId as ProjectionRunId,
    projectionSource: projectionProvider,
    modelVersion: record.modelVersion,
    observedAt: record.fetchedAt,
    frozenAt: record.frozenAt,
  };
}

function canonicalSnapshot(
  snapshot: StoreSnapshot,
  seasonType: 'preseason' | 'regular' | 'postseason' = 'regular',
): StoredProjectionSnapshot {
  const season = Number(snapshot.payload.league.season);
  if (!Number.isInteger(season)) throw new Error('Stored projection snapshot has an invalid season.');
  return {
    snapshotId: snapshot.snapshotId as StoredProjectionSnapshot['snapshotId'],
    leagueSeasonId: snapshot.leagueSeasonId as LeagueSeasonId,
    period: { season, seasonType, week: snapshot.week },
    modelVersion: snapshot.modelVersion,
    revisionKey: snapshot.revisionKey,
    calculatedAt: snapshot.calculatedAt,
    publishedAt: snapshot.publishedAt,
    verifiedAt: snapshot.verifiedAt,
    activityWindows: snapshot.activityWindows,
    isCurrent: snapshot.isCurrent,
    payload: snapshot.payload,
  };
}

function createDisabledRepository(): ProjectionRepositoryPort {
  return {
    enabled: false,
    async registerLeagueSeason() { return { kind: 'disabled' }; },
    async recordProjectionCandidates() { return { kind: 'disabled' }; },
    async readLatestCandidates() { return []; },
    async freezeLatestBaselines() { return { kind: 'disabled' }; },
    async readFrozenBaselines() { return []; },
    async recordGameStates() { return { kind: 'disabled' }; },
    async recordLeagueWeekObservation() { return { kind: 'disabled' }; },
    async acquireJob() { return { kind: 'disabled' }; },
    async completeJob() { return false; },
    async failJob() { return false; },
    async publishSnapshot() { return { kind: 'disabled' }; },
    async pruneHistory() { return { kind: 'disabled' }; },
    async readCurrentSnapshot() { return null; },
    async readSnapshotSelection() { return { selected: null, latest: null }; },
  };
}

function externalIds(
  references: readonly ExternalScoringEntityRef[],
  provider: ProviderKey,
): string[] {
  return references.map((reference) => {
    assertProvider(reference, provider, 'Scoring entity reference');
    return String(reference.externalId);
  });
}

function externalGameIds(references: readonly ExternalGameRef[], provider: ProviderKey): string[] {
  return references.map((reference) => {
    assertProvider(reference, provider, 'NFL game reference');
    return String(reference.externalId);
  });
}

/**
 * Canonical projection persistence adapter over the stable low-level Neon store.
 * It owns translation only: SQL, schema behavior, and environment configuration
 * remain in the existing store package.
 */
export function createNeonProjectionRepository(
  store: RepositoryStore,
  options: NeonProjectionRepositoryOptions,
): ProjectionRepositoryPort {
  if (!store.enabled) return createDisabledRepository();
  const { officialProvider, projectionProvider, gameStateProvider } = options;
  return {
    enabled: true,

    async registerLeagueSeason(input) {
      assertProvider(input.configuration.leagueRef, officialProvider, 'League reference');
      const result = await store.registerLeagueSeason({
        leagueKey: input.configuration.key,
        leagueName: input.leagueName,
        season: input.period.season,
        sleeperLeagueId: String(input.configuration.leagueRef.externalId),
        scoringRules: input.scoringProfile.provenance.rawRules,
      });
      if (result.kind === 'disabled') return result;
      return {
        kind: 'stored',
        value: {
          leagueSeasonId: result.value.leagueSeasonId as LeagueSeasonId,
          scoringProfileId: result.value.scoringProfileId as ScoringProfileId,
          leagueRef: input.configuration.leagueRef,
        },
      };
    },

    async recordProjectionCandidates(input) {
      assertProvider({ provider: input.source }, projectionProvider, 'Projection source');
      const result = await store.recordProjectionCandidates({
        provider: String(input.source),
        season: input.period.season,
        seasonType: storeSeasonType(input.period.seasonType),
        week: input.period.week,
        modelVersion: input.modelVersion,
        sourceRevision: input.sourceRevision,
        requestStartedAt: input.requestStartedAt,
        requestCompletedAt: input.requestCompletedAt,
        fetchedAt: input.observedAt,
        quality: input.quality,
        candidates: input.candidates.map((candidate) => ({
          gameId: String(candidate.gameId),
          entityId: String(candidate.entityId),
          scoringProfileId: String(candidate.scoringProfileId),
          projectionPoints: candidate.projectionPoints,
          projectedStats: candidate.projectedStats,
          quality: candidate.quality,
        })),
      });
      if (result.kind === 'disabled') return result;
      return {
        kind: 'stored',
        value: { ...result.value, runId: result.value.runId as ProjectionRunId },
      };
    },

    async readLatestCandidates(input) {
      assertProvider({ provider: input.source }, projectionProvider, 'Projection source');
      const rows = await store.readLatestCandidatesBySleeperIds({
        leagueSeasonId: String(input.leagueSeasonId),
        season: input.period.season,
        seasonType: storeSeasonType(input.period.seasonType),
        week: input.period.week,
        provider: String(input.source),
        modelVersion: input.modelVersion,
        sleeperPlayerIds: externalIds(input.officialEntityRefs, officialProvider),
      });
      return rows.map((row) => canonicalBaseline(
        row,
        officialProvider,
        projectionProvider,
        gameStateProvider,
      ));
    },

    async freezeLatestBaselines(input) {
      assertProvider({ provider: input.projectionSource }, projectionProvider, 'Projection source');
      assertProvider({ provider: input.gameStateSource }, gameStateProvider, 'Game-state source');
      const result = await store.freezeLatestBaselines({
        leagueSeasonId: String(input.leagueSeasonId),
        season: input.period.season,
        seasonType: storeSeasonType(input.period.seasonType),
        week: input.period.week,
        modelVersion: input.modelVersion,
        projectionProvider: String(input.projectionSource),
        gameProvider: String(input.gameStateSource),
        externalGameIds: externalGameIds(input.gameRefs, gameStateProvider),
        frozenAt: input.frozenAt,
      });
      if (result.kind === 'disabled') return result;
      return {
        kind: 'stored',
        value: result.value.map((row) => canonicalBaseline(
          row,
          officialProvider,
          projectionProvider,
          gameStateProvider,
        )),
      };
    },

    async readFrozenBaselines(input) {
      assertProvider({ provider: input.source }, projectionProvider, 'Projection source');
      const rows = await store.readFrozenBaselinesBySleeperIds({
        leagueSeasonId: String(input.leagueSeasonId),
        season: input.period.season,
        seasonType: storeSeasonType(input.period.seasonType),
        week: input.period.week,
        provider: String(input.source),
        modelVersion: input.modelVersion,
        sleeperPlayerIds: externalIds(input.officialEntityRefs, officialProvider),
      });
      return rows.map((row) => canonicalBaseline(
        row,
        officialProvider,
        projectionProvider,
        gameStateProvider,
      ));
    },

    async recordGameStates(input) {
      assertProvider({ provider: input.source }, gameStateProvider, 'Game-state source');
      const result = await store.recordGameStates({
        provider: String(input.source),
        states: input.states.map((state) => {
          assertProvider(state.gameRef, gameStateProvider, 'NFL game reference');
          return {
            externalGameId: String(state.gameRef.externalId),
            sourceRevision: state.sourceRevision,
            requestStartedAt: state.requestStartedAt,
            requestCompletedAt: state.requestCompletedAt,
            observedAt: state.observedAt,
            statusCode: state.statusCode,
            period: state.sourcePeriod,
            gameClock: state.gameClock,
            homeScore: state.homeScore,
            awayScore: state.awayScore,
            sourceData: {
              statusText: state.statusText,
              phase: state.phase,
              clockSeconds: state.clockSeconds,
              remainingFraction: state.remainingFraction,
            },
          };
        }),
      });
      if (result.kind === 'disabled') return result;
      return {
        kind: 'stored',
        value: result.value.map((value) => ({
          gameRef: externalGameRef(gameStateProvider, value.externalGameId),
          sourceRevision: value.sourceRevision,
          observationId: value.observationId as ObservationId,
        })),
      };
    },

    async recordLeagueWeekObservation(input) {
      const entityById = new Map(input.entityPoints.map((point) => [
        String(point.entityRef.externalId), point.entityRef,
      ]));
      const gameById = new Map(input.expectedGameRefs.map((reference) => [
        String(reference.externalId), reference,
      ]));
      const result = await store.recordLeagueWeekObservation({
        leagueSeasonId: String(input.leagueSeasonId),
        week: input.period.week,
        sourceRevision: input.sourceRevision,
        requestStartedAt: input.requestStartedAt,
        requestCompletedAt: input.requestCompletedAt,
        observedAt: input.observedAt,
        quality: input.quality,
        sourceData: input.sourceData,
        expectedTank01GameIds: externalGameIds(input.expectedGameRefs, gameStateProvider),
        playerPoints: input.entityPoints.map((point) => {
          assertProvider(point.entityRef, officialProvider, 'Official scoring entity reference');
          assertProvider(point.rosterRef, officialProvider, 'Official roster reference');
          return {
            sleeperPlayerId: String(point.entityRef.externalId),
            entityKind: point.entityRef.entityKind === 'team-defense' ? 'team_defense' as const : 'player' as const,
            externalRosterId: String(point.rosterRef.externalId),
            points: point.points,
            isStarter: point.isStarter,
            lineupSlot: point.lineupSlot,
          };
        }),
        rosterPoints: input.rosterPoints.map((point) => {
          assertProvider(point.rosterRef, officialProvider, 'Official roster reference');
          return {
            externalRosterId: String(point.rosterRef.externalId),
            points: point.points,
          };
        }),
      });
      if (result.kind === 'disabled') return result;
      return {
        kind: 'stored',
        value: {
          observationId: result.value.observationId as ObservationId,
          entityPointsStored: result.value.playerPointsStored,
          rosterPointsStored: result.value.rosterPointsStored,
          unmappedEntityRefs: result.value.unmappedSleeperPlayerIds.map((id) => (
            entityById.get(id) ?? externalPlayerRef(officialProvider, id)
          )),
          expectedGamesStored: result.value.expectedGamesStored,
          unmappedGameRefs: result.value.unmappedTank01GameIds.map((id) => (
            gameById.get(id) ?? externalGameRef(gameStateProvider, id)
          )),
        },
      };
    },

    acquireJob: (input) => store.acquireJob(input),
    completeJob: (jobKey, workerId) => store.completeJob(jobKey, workerId),
    failJob: (jobKey, workerId, message) => store.failJob(jobKey, workerId, message),

    async publishSnapshot(input) {
      const result = await store.publishSnapshot({
        leagueSeasonId: String(input.leagueSeasonId),
        week: input.period.week,
        modelVersion: input.modelVersion,
        revisionKey: input.revisionKey,
        leagueWeekObservationId: String(input.leagueWeekObservationId),
        gameStateObservationIds: input.gameStateObservationIds.map(String),
        calculatedAt: input.calculatedAt,
        payload: input.payload,
        activityWindows: input.activityWindows,
        maxSourceSkewSeconds: input.maxSourceSkewSeconds,
      });
      if (result.kind === 'disabled' || result.kind === 'rejected') return result;
      return { kind: result.kind, snapshot: canonicalSnapshot(result.snapshot, input.period.seasonType) };
    },

    pruneHistory: (input) => store.pruneHistory(input),

    async readCurrentSnapshot(leagueSeasonId, period) {
      const snapshot = await store.readCurrentSnapshot(String(leagueSeasonId), period.week);
      return snapshot ? canonicalSnapshot(snapshot, period.seasonType) : null;
    },

    async readSnapshotSelection(leagueRef: ExternalLeagueRef, requestedWeek) {
      assertProvider(leagueRef, officialProvider, 'League reference');
      const selection = await store.readSnapshotSelectionBySleeperLeagueId(
        String(leagueRef.externalId),
        requestedWeek,
      );
      return {
        selected: selection.selected ? canonicalSnapshot(selection.selected) : null,
        latest: selection.latest ? canonicalSnapshot(selection.latest) : null,
      };
    },
  } satisfies ProjectionRepositoryPort;
}
