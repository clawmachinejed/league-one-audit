import type {
  CanonicalScoringProfile,
  ProjectionObservation,
  ProjectionSlate,
  ScoringEntity,
} from '../domain/contracts';
import { scoreProjection } from '../domain/scoring';
import type { ProjectionRepositoryPort } from '../ports/projection-repository';
import {
  externalReferenceKey,
  sameExternalReference,
  type ExternalGameRef,
} from '../shared/provider-identity';
import { compatibleRevision } from '../shared/revision-compatibility';
import type {
  LiveProjectionWorkerDependencies,
  LeagueStageResult,
  LoadedLeague,
  PersistedGroup,
  PregameProjectionSet,
} from './contracts';
import { LIVE_PROJECTION_MODEL_VERSION } from './contracts';
import { activityWindowsForSchedule } from './cadence';
import {
  applicableSourceSkewSeconds,
  assertCompleteGameCoverage,
  MAX_SOURCE_SKEW_MS,
  startedGame,
  stateForEntity,
} from './game-context';
import {
  activeStarters,
  assertUniqueStarters,
  finite,
  projectionEntities,
  projectionObservationForEntity,
  projectionStats,
} from './roster-context';
import { baselineMap, buildSnapshot } from './snapshot-builder';

type LeagueStageDependencies = Readonly<{
  repository: Pick<ProjectionRepositoryPort,
    | 'registerLeagueSeason'
    | 'recordProjectionCandidates'
    | 'freezeLatestBaselines'
    | 'readLatestCandidates'
    | 'readFrozenBaselines'
    | 'readCurrentSnapshot'
    | 'recordLeagueWeekObservation'
    | 'publishSnapshot'
  >;
  normalizeScoringProfile: LiveProjectionWorkerDependencies['normalizeScoringProfile'];
}>;

function observationReferences(
  observation: ProjectionObservation,
): readonly ProjectionObservation['identity']['primary'][] {
  return [observation.identity.primary, ...observation.identity.aliases];
}

function unsafeUnmatchedProjection(
  entity: ScoringEntity,
  slate: ProjectionSlate,
): boolean {
  if (slate.projections.some((observation) => observationReferences(observation)
    .some((reference) => sameExternalReference(reference, entity.externalRef)))) {
    return true;
  }
  if (entity.kind !== 'team-defense') return false;
  return slate.projections.filter((observation) => (
    observation.identity.primary.entityKind === 'team-defense'
    && observation.nflTeam === entity.nflTeam
  )).length > 1;
}

function scorePregameProjections(
  entities: readonly ScoringEntity[],
  slate: ProjectionSlate,
  profile: CanonicalScoringProfile,
): PregameProjectionSet {
  if (entities.length === 0) return { status: 'empty', projections: [] };
  if (slate.quality !== 'complete') {
    return {
      status: 'unavailable',
      projections: [],
      warning: 'The projection feed did not provide a complete weekly slate.',
    };
  }

  const projections: PregameProjectionSet['projections'][number][] = [];
  for (const entity of entities) {
    const observation = projectionObservationForEntity(entity, slate);
    if (!observation) {
      if (!unsafeUnmatchedProjection(entity, slate)) {
        projections.push({ entityRef: entity.externalRef, points: 0, quality: 'missing' });
      }
      continue;
    }
    const scored = scoreProjection(observation.scoringStats, profile.rules);
    if (!scored.available || !finite(scored.points)) {
      projections.push({ entityRef: entity.externalRef, points: 0, quality: 'missing' });
      continue;
    }
    projections.push({ entityRef: entity.externalRef, points: scored.points, quality: 'complete' });
  }
  return { status: 'available', projections };
}

function uniqueRelevantGames(
  league: LoadedLeague,
  persisted: PersistedGroup,
): ExternalGameRef[] {
  const games = new Map<string, ExternalGameRef>();
  for (const { starter } of activeStarters(league.source)) {
    const game = stateForEntity(starter.entity, persisted.games, league.source.schedule);
    if (game) games.set(externalReferenceKey(game.gameRef), game.gameRef);
  }
  return [...games.values()];
}

export async function processLeague(
  dependencies: LeagueStageDependencies,
  league: LoadedLeague,
  persisted: PersistedGroup,
  calculatedAt: string,
): Promise<LeagueStageResult> {
  const { source, configuration } = league;
  assertCompleteGameCoverage(league, persisted.games);

  const normalized = dependencies.normalizeScoringProfile(source.scoringSettings);
  if (normalized.status !== 'available') {
    throw new Error('League scoring settings could not be normalized.');
  }
  const scoringProfile = normalized.profile;
  const leagueSeason = await dependencies.repository.registerLeagueSeason({
    configuration,
    leagueName: source.leagueName,
    period: source.period,
    scoringProfile,
  });
  if (leagueSeason.kind !== 'stored') throw new Error('League season could not be persisted.');

  const starters = activeStarters(source);
  assertUniqueStarters(starters);
  const candidateEntities = projectionEntities(source);
  const scored = scorePregameProjections(candidateEntities, persisted.projections, scoringProfile);
  if (candidateEntities.length > 0 && scored.status !== 'available') {
    throw new Error('Pregame fantasy projections could not be scored.');
  }
  const scoredByReference = new Map(scored.projections.map((projection) => [
    externalReferenceKey(projection.entityRef),
    projection,
  ]));
  for (const { starter } of starters) {
    if (!scoredByReference.has(externalReferenceKey(starter.entity.externalRef))) {
      throw new Error('A starter projection could not be matched safely.');
    }
  }

  const candidates = candidateEntities.flatMap((entity) => {
    const projection = scoredByReference.get(externalReferenceKey(entity.externalRef));
    if (!projection || !finite(projection.points)) return [];
    const state = stateForEntity(entity, persisted.games, source.schedule);
    if (!state) return [];
    const gameId = persisted.gameIdsByReferenceKey.get(externalReferenceKey(state.gameRef));
    const entityId = persisted.entityIdsByReferenceKey.get(externalReferenceKey(entity.externalRef));
    if (!gameId || !entityId) throw new Error('A projection candidate identity is missing.');
    return [{
      gameId,
      entityId,
      scoringProfileId: leagueSeason.value.scoringProfileId,
      projectionPoints: projection.points,
      projectedStats: projectionStats(entity, persisted.projections),
      quality: projection.quality,
    }];
  });
  const projectionSourceRevision = persisted.projectionSourceRevision;
  const storedRun = await dependencies.repository.recordProjectionCandidates({
    source: persisted.projections.source,
    period: source.period,
    modelVersion: LIVE_PROJECTION_MODEL_VERSION,
    sourceRevision: projectionSourceRevision,
    requestStartedAt: persisted.projections.requestStartedAt,
    requestCompletedAt: persisted.projections.requestCompletedAt,
    observedAt: persisted.projections.observedAt,
    quality: 'complete',
    candidates,
  });
  if (storedRun.kind !== 'stored' || storedRun.value.candidateCount < candidates.length) {
    throw new Error('Pregame projection candidates could not be persisted completely.');
  }

  const officialEntityRefs = starters.map(({ starter }) => starter.entity.externalRef);
  const startedGameRefs = persisted.games.games.filter(startedGame).map((game) => game.gameRef);
  if (startedGameRefs.length > 0) {
    const frozen = await dependencies.repository.freezeLatestBaselines({
      leagueSeasonId: leagueSeason.value.leagueSeasonId,
      period: source.period,
      modelVersion: LIVE_PROJECTION_MODEL_VERSION,
      projectionSource: persisted.projections.source,
      gameStateSource: persisted.games.source,
      gameRefs: startedGameRefs,
      frozenAt: calculatedAt,
    });
    if (frozen.kind !== 'stored') throw new Error('Pregame projection baselines could not be frozen.');
  }
  const [latest, frozen, prior] = await Promise.all([
    dependencies.repository.readLatestCandidates({
      leagueSeasonId: leagueSeason.value.leagueSeasonId,
      period: source.period,
      source: persisted.projections.source,
      modelVersion: LIVE_PROJECTION_MODEL_VERSION,
      officialEntityRefs,
    }),
    dependencies.repository.readFrozenBaselines({
      leagueSeasonId: leagueSeason.value.leagueSeasonId,
      period: source.period,
      source: persisted.projections.source,
      modelVersion: LIVE_PROJECTION_MODEL_VERSION,
      officialEntityRefs,
    }),
    dependencies.repository.readCurrentSnapshot(leagueSeason.value.leagueSeasonId, source.period),
  ]);

  const relevantGameRefs = uniqueRelevantGames(league, persisted);
  const relevantGameReferenceKeys = new Set(relevantGameRefs.map(externalReferenceKey));
  const sourceSkewSeconds = applicableSourceSkewSeconds(
    source.requestCompletedAt,
    persisted.games.games.filter((game) => (
      relevantGameReferenceKeys.has(externalReferenceKey(game.gameRef))
    )),
    calculatedAt,
  );
  const frozenByEntity = baselineMap(frozen);
  const missingFrozenBaselineCount = starters.filter(({ starter }) => {
    const game = stateForEntity(starter.entity, persisted.games, source.schedule);
    return game
      && startedGame(game)
      && !frozenByEntity.has(externalReferenceKey(starter.entity.externalRef));
  }).length;
  const rosterPoints = source.matchups.flatMap((matchup) => matchup.sides.map((side) => ({
    rosterRef: side.rosterRef,
    points: finite(side.officialPoints) ? side.officialPoints : null,
  })));
  const observation = await dependencies.repository.recordLeagueWeekObservation({
    leagueSeasonId: leagueSeason.value.leagueSeasonId,
    period: source.period,
    sourceRevision: source.sourceRevision,
    requestStartedAt: source.requestStartedAt,
    requestCompletedAt: source.requestCompletedAt,
    observedAt: source.observedAt,
    quality: 'complete',
    sourceData: {
      leagueKey: configuration.key,
      season: String(source.period.season),
      week: source.period.week,
      updatedAt: source.observedAt,
      matchupCount: source.matchups.length,
      rosteredPlayerCount: candidateEntities.length,
      missingFrozenBaselineCount,
      missingBaselinePolicy: 'zero',
      rosterIds: source.matchups.flatMap((matchup) => matchup.sides.map((side) => (
        String(side.rosterRef.externalId)
      ))),
      warning: source.warning ?? null,
    },
    expectedGameRefs: relevantGameRefs,
    entityPoints: starters.map(({ rosterRef, starter }) => ({
      entityRef: starter.entity.externalRef,
      rosterRef,
      points: finite(starter.officialPoints) ? starter.officialPoints : null,
      isStarter: true,
      lineupSlot: starter.slot || null,
    })),
    rosterPoints,
  });
  if (observation.kind !== 'stored'
    || observation.value.entityPointsStored !== starters.length
    || observation.value.rosterPointsStored !== rosterPoints.length
    || observation.value.unmappedEntityRefs.length > 0
    || observation.value.unmappedGameRefs.length > 0
    || observation.value.expectedGamesStored !== relevantGameRefs.length) {
    throw new Error('Official source observations could not be persisted completely.');
  }

  const payload = buildSnapshot({
    source,
    games: persisted.games,
    scored,
    latest,
    frozen,
    prior: prior?.payload ?? null,
    calculatedAt,
  });
  const gameStateObservationIds = relevantGameRefs.map((reference) => {
    const observationId = persisted.gameObservationIdsByReferenceKey.get(
      externalReferenceKey(reference),
    );
    if (!observationId) throw new Error('A relevant game-state observation is missing.');
    return observationId;
  });
  const revisionKey = compatibleRevision({
    modelVersion: LIVE_PROJECTION_MODEL_VERSION,
    sourceRevision: source.sourceRevision,
    projectionSourceRevision,
    missingFrozenBaselineCount,
    games: relevantGameRefs.map((reference) => ({
      id: String(reference.externalId),
      observationId: persisted.gameObservationIdsByReferenceKey.get(
        externalReferenceKey(reference),
      ),
    })),
  });
  const published = await dependencies.repository.publishSnapshot({
    leagueSeasonId: leagueSeason.value.leagueSeasonId,
    period: source.period,
    modelVersion: LIVE_PROJECTION_MODEL_VERSION,
    revisionKey,
    leagueWeekObservationId: observation.value.observationId,
    gameStateObservationIds,
    calculatedAt,
    payload,
    activityWindows: activityWindowsForSchedule(source.schedule),
    maxSourceSkewSeconds: MAX_SOURCE_SKEW_MS / 1_000,
  });
  if (published.kind !== 'published' && published.kind !== 'unchanged') {
    throw new Error('The projection snapshot was not published.');
  }
  return {
    publicationOutcome: published.kind,
    starterCount: starters.length,
    candidateCount: candidates.length,
    frozenBaselineCount: frozen.length,
    missingBaselineCount: missingFrozenBaselineCount,
    applicableSourceSkewSeconds: sourceSkewSeconds,
    snapshotRevision: revisionKey,
  };
}
