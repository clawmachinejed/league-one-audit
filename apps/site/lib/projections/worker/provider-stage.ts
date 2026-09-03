import type {
  GameStateSlate,
  LeaguePeriod,
  ProjectionSlate,
} from '../domain/contracts';
import type { IdentityCrosswalkPort } from '../ports/identity-crosswalk';
import type { ProjectionRepositoryPort } from '../ports/projection-repository';
import {
  externalReferenceKey,
  type ExternalGameRef,
} from '../shared/provider-identity';
import type {
  LiveProjectionWorkerDependencies,
  LoadedLeague,
  PersistedGroup,
  ProviderGroup,
} from './contracts';
import { kickoffForGame } from './game-context';
import { scoringIdentityInputs } from './roster-context';

type ProviderLoadDependencies = Pick<
  LiveProjectionWorkerDependencies,
  'projectionFeed' | 'gameStateFeed'
>;

type ProviderPersistenceDependencies = Readonly<{
  repository: Pick<ProjectionRepositoryPort, 'recordGameStates' | 'recordProjectionSlate'>;
  identityCrosswalk: Pick<
    IdentityCrosswalkPort,
    'resolveNflGames' | 'resolveScoringEntities'
  >;
}>;

export type LoadedProviderGroup = Readonly<{
  projections: ProjectionSlate;
  games: GameStateSlate;
}>;

function validPeriod(period: LeaguePeriod): boolean {
  return /^20\d{2}$/u.test(String(period.season))
    && Number.isInteger(period.week)
    && period.week >= 1
    && period.week <= 18
    && ['preseason', 'regular', 'postseason'].includes(period.seasonType);
}

function samePeriod(left: LeaguePeriod, right: LeaguePeriod): boolean {
  return left.season === right.season
    && left.seasonType === right.seasonType
    && left.week === right.week;
}

export function groupLeagues(leagues: readonly LoadedLeague[]): ProviderGroup[] {
  const groups = new Map<string, { period: LeaguePeriod; leagues: LoadedLeague[] }>();
  for (const league of leagues) {
    const { period } = league.source;
    if (!validPeriod(period)) {
      throw new Error('The official league source returned an invalid projection period.');
    }
    const key = JSON.stringify([period.season, period.seasonType, period.week]);
    const group = groups.get(key) ?? { period, leagues: [] };
    group.leagues.push(league);
    groups.set(key, group);
  }
  return [...groups.values()];
}

/** Loads each shared provider feed exactly once and validates it for every league schedule. */
export async function loadProviderGroup(
  dependencies: ProviderLoadDependencies,
  group: ProviderGroup,
): Promise<LoadedProviderGroup> {
  const [projectionResult, gameStateResult] = await Promise.all([
    dependencies.projectionFeed.getProjectionSlate(group.period),
    dependencies.gameStateFeed.getGameStateSlate(group.period),
  ]);
  if (projectionResult.status !== 'available' || gameStateResult.status !== 'available') {
    throw new Error('A required projection provider source is unavailable.');
  }

  const projections = projectionResult.slate;
  const games = gameStateResult.slate;
  if (!samePeriod(projections.period, group.period) || !samePeriod(games.period, group.period)) {
    throw new Error('A provider returned data for an unexpected projection period.');
  }
  if (group.leagues.some(({ source }) => (
    !dependencies.projectionFeed.assessProjectionSlate(projections, source.schedule).complete
  ))) {
    throw new Error('The projection provider returned an incomplete weekly projection slate.');
  }

  return { projections, games };
}

function gameIdentityKey(reference: ExternalGameRef): string {
  return externalReferenceKey(reference);
}

/**
 * Persists shared provider state once per period. Projection candidates remain a
 * per-league operation because they require that league's scoring profile.
 */
export async function persistProviderGroup(
  dependencies: ProviderPersistenceDependencies,
  group: ProviderGroup,
  games: GameStateSlate,
  projections: ProjectionSlate,
): Promise<PersistedGroup> {
  const gameInputs = games.games.map((game) => ({
    key: gameIdentityKey(game.gameRef),
    primaryRef: game.gameRef,
    aliasRefs: [],
    period: group.period,
    homeTeam: game.homeTeam,
    awayTeam: game.awayTeam,
    kickoffAt: kickoffForGame(game, group.leagues),
  }));
  const resolvedGames = await dependencies.identityCrosswalk.resolveNflGames(gameInputs);
  if (resolvedGames.kind !== 'resolved' || resolvedGames.value.length !== games.games.length
    || resolvedGames.value.some((game) => game.status !== 'known')) {
    throw new Error('NFL games could not be persisted completely.');
  }
  const gameIdsByReferenceKey = new Map(resolvedGames.value.map((game) => {
    if (game.status !== 'known') throw new Error('NFL games could not be persisted completely.');
    return [game.key, game.gameId] as const;
  }));

  const storedStates = await dependencies.repository.recordGameStates({
    source: games.source,
    states: games.games,
  });
  if (storedStates.kind !== 'stored' || storedStates.value.length !== games.games.length) {
    throw new Error('NFL game states could not be persisted completely.');
  }
  const gameObservationIdsByReferenceKey = new Map(storedStates.value.map((state) => [
    gameIdentityKey(state.gameRef),
    state.observationId,
  ]));

  const identityInputs = scoringIdentityInputs(group, projections);
  const resolvedEntities = await dependencies.identityCrosswalk.resolveScoringEntities(identityInputs);
  if (resolvedEntities.kind !== 'resolved') {
    throw new Error('Scoring identities could not be resolved.');
  }
  const entityIdsByReferenceKey = new Map(resolvedEntities.value.flatMap((entity) => (
    entity.status === 'known' ? [[entity.key, entity.entityId] as const] : []
  )));

  const storedProjectionSlate = await dependencies.repository.recordProjectionSlate(projections);
  if (storedProjectionSlate.kind !== 'stored'
    || storedProjectionSlate.value.entryCount !== projections.projections.length) {
    throw new Error('The provider projection slate could not be persisted completely.');
  }

  return {
    games,
    projections,
    gameIdsByReferenceKey,
    gameObservationIdsByReferenceKey,
    entityIdsByReferenceKey,
    identityConflictCount: resolvedEntities.value.filter((entity) => entity.status !== 'known').length,
    projectionSourceRevision: projections.sourceRevision,
    projectionSlateObservationId: storedProjectionSlate.value.observationId,
  };
}
