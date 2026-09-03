import 'server-only';

import { createHash } from 'node:crypto';
import type { Tank01GameStatesAvailable } from '../../tank01-game-state';
import type { Tank01AvailableResult } from '../../tank01';
import type {
  LiveProjectionWorkerDependencies,
  LoadedLeague,
  PersistedGroup,
  ProviderGroup,
} from './contracts';
import { kickoffForGame } from './game-context';
import { scoringEntities } from './roster-context';

function canonicalValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => [key, canonicalValue(item)]));
  }
  return value;
}

export function revision(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(canonicalValue(value))).digest('hex');
}

export function groupLeagues(leagues: readonly LoadedLeague[]): ProviderGroup[] {
  const groups = new Map<string, { season: string; week: number; leagues: LoadedLeague[] }>();
  for (const league of leagues) {
    const { season } = league.source.data.league;
    const { week } = league.source.data;
    if (!/^20\d{2}$/u.test(season) || !Number.isInteger(week) || week < 1 || week > 18) {
      throw new Error('Sleeper returned an invalid projection season or week.');
    }
    const key = `${season}:${week}`;
    const group = groups.get(key) ?? { season, week, leagues: [] };
    group.leagues.push(league);
    groups.set(key, group);
  }
  return [...groups.values()];
}

export async function persistProviderGroup(
  dependencies: LiveProjectionWorkerDependencies,
  group: ProviderGroup,
  games: Tank01GameStatesAvailable,
  projections: Tank01AvailableResult,
): Promise<PersistedGroup> {
  const storedGames = await dependencies.store.upsertNflGames(games.games.map((game) => ({
    key: game.gameId,
    provider: 'tank01',
    externalGameId: game.gameId,
    season: Number(group.season),
    seasonType: 'reg',
    week: group.week,
    homeTeam: game.homeTeam,
    awayTeam: game.awayTeam,
    kickoffAt: kickoffForGame(game, group.leagues),
  })));
  if (storedGames.kind !== 'stored' || storedGames.value.length !== games.games.length) {
    throw new Error('NFL games could not be persisted completely.');
  }
  const gameIdsByExternalId = new Map(storedGames.value.map((game) => [game.key, game.gameId]));

  const states = await dependencies.store.recordGameStates({
    provider: 'tank01',
    states: games.games.map((game) => ({
      externalGameId: game.gameId,
      sourceRevision: revision({
        gameId: game.gameId,
        fetchedAt: game.fetchedAt,
        statusCode: game.statusCode,
        phase: game.phase,
        clock: game.clock,
        remainingFraction: game.remainingFraction,
      }),
      requestStartedAt: game.requestStartedAt,
      requestCompletedAt: game.requestCompletedAt,
      observedAt: game.fetchedAt,
      statusCode: game.statusCode,
      period: game.period,
      gameClock: game.clock,
      homeScore: null,
      awayScore: null,
      sourceData: {
        statusText: game.statusText,
        phase: game.phase,
        clockSeconds: game.clockSeconds,
        remainingFraction: game.remainingFraction,
      },
    })),
  });
  if (states.kind !== 'stored' || states.value.length !== games.games.length) {
    throw new Error('NFL game states could not be persisted completely.');
  }
  const gameObservationIdsByExternalId = new Map(
    states.value.map((state) => [state.externalGameId, state.observationId]),
  );

  const storedEntities = await dependencies.store.upsertScoringEntities(scoringEntities(group, projections));
  if (storedEntities.kind !== 'stored') {
    throw new Error('Player identities could not be resolved safely.');
  }
  const entityIdsByKey = new Map(storedEntities.value.flatMap((entity) => (
    entity.conflict || !entity.entityId ? [] : [[entity.key, entity.entityId] as const]
  )));
  return {
    games,
    projections,
    gameIdsByExternalId,
    gameObservationIdsByExternalId,
    entityIdsByKey,
    projectionSourceRevision: revision({
      season: group.season,
      week: group.week,
      fetchedAt: projections.fetchedAt,
      coverage: projections.coverage,
      projections: projections.projections,
    }),
  };
}

