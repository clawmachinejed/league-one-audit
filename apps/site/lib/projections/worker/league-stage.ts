import 'server-only';

import { LEAGUE_SITES } from '../../leagues';
import { scoreTank01PlayersPointMap } from '../../matchup-projections';
import type { LiveProjectionWorkerDependencies, LoadedLeague, PersistedGroup } from './contracts';
import { LIVE_PROJECTION_MODEL_VERSION } from './contracts';
import { activityWindowsForSchedule } from './cadence';
import { assertCompleteGameCoverage, MAX_SOURCE_SKEW_MS, startedGame, stateForPlayer } from './game-context';
import { revision } from './provider-stage';
import {
  activeStarters,
  assertUniqueStarters,
  entityKey,
  entityKind,
  finite,
  numericScoringRules,
  projectionPlayers,
  projectionStats,
} from './roster-context';
import { baselineMap, buildSnapshot } from './snapshot-builder';

export async function processLeague(
  dependencies: LiveProjectionWorkerDependencies,
  league: LoadedLeague,
  persisted: PersistedGroup,
  calculatedAt: string,
): Promise<void> {
  const { source, configuration } = league;
  assertCompleteGameCoverage(league, persisted.games);
  const season = Number(source.data.league.season);
  const { week } = source.data;
  const scoringRules = numericScoringRules(source.scoringSettings);
  const leagueSeason = await dependencies.store.registerLeagueSeason({
    leagueKey: configuration.key,
    leagueName: source.leagueName || LEAGUE_SITES[configuration.key].name,
    season,
    sleeperLeagueId: configuration.sleeperLeagueId,
    scoringRules,
  });
  if (leagueSeason.kind !== 'stored') throw new Error('League season could not be persisted.');

  const starters = activeStarters(source.data);
  assertUniqueStarters(starters);
  const candidatePlayers = projectionPlayers(source);
  const scored = scoreTank01PlayersPointMap(candidatePlayers, persisted.projections, source.scoringSettings);
  if (candidatePlayers.length > 0 && scored.status !== 'available') {
    throw new Error('Pregame fantasy projections could not be scored.');
  }
  for (const { player } of starters) {
    if (!finite(scored.pointsByPlayer[player.id]) || !scored.qualityByPlayer[player.id]) {
      throw new Error('A starter projection could not be matched safely.');
    }
  }

  const candidates = candidatePlayers.flatMap((player) => {
    if (!finite(scored.pointsByPlayer[player.id]) || !scored.qualityByPlayer[player.id]) return [];
    const state = stateForPlayer(player, persisted.games);
    if (!state) return [];
    const gameId = persisted.gameIdsByExternalId.get(state.gameId);
    const entityId = persisted.entityIdsByKey.get(entityKey(player));
    if (!gameId || !entityId) throw new Error('A projection candidate identity is missing.');
    return [{
      gameId,
      entityId,
      scoringProfileId: leagueSeason.value.scoringProfileId,
      projectionPoints: scored.pointsByPlayer[player.id],
      projectedStats: projectionStats(player, persisted.projections),
      quality: scored.qualityByPlayer[player.id],
    }];
  });
  const projectionSourceRevision = persisted.projectionSourceRevision;
  const storedRun = await dependencies.store.recordProjectionCandidates({
    provider: 'tank01',
    season,
    seasonType: 'reg',
    week,
    modelVersion: LIVE_PROJECTION_MODEL_VERSION,
    sourceRevision: projectionSourceRevision,
    requestStartedAt: persisted.projections.fetchedAt,
    requestCompletedAt: persisted.projections.fetchedAt,
    fetchedAt: persisted.projections.fetchedAt,
    quality: 'complete',
    candidates,
  });
  if (storedRun.kind !== 'stored' || storedRun.value.candidateCount < candidates.length) {
    throw new Error('Pregame projection candidates could not be persisted completely.');
  }

  const sleeperPlayerIds = starters.map(({ player }) => player.id);
  const startedExternalGameIds = persisted.games.games
    .filter(startedGame)
    .map((game) => game.gameId);
  if (startedExternalGameIds.length > 0) {
    const frozen = await dependencies.store.freezeLatestBaselines({
      leagueSeasonId: leagueSeason.value.leagueSeasonId,
      season,
      seasonType: 'reg',
      week,
      modelVersion: LIVE_PROJECTION_MODEL_VERSION,
      projectionProvider: 'tank01',
      gameProvider: 'tank01',
      externalGameIds: startedExternalGameIds,
      frozenAt: calculatedAt,
    });
    if (frozen.kind !== 'stored') throw new Error('Pregame projection baselines could not be frozen.');
  }
  const [latest, frozen, prior] = await Promise.all([
    dependencies.store.readLatestCandidatesBySleeperIds({
      leagueSeasonId: leagueSeason.value.leagueSeasonId,
      season,
      seasonType: 'reg',
      week,
      provider: 'tank01',
      modelVersion: LIVE_PROJECTION_MODEL_VERSION,
      sleeperPlayerIds,
    }),
    dependencies.store.readFrozenBaselinesBySleeperIds({
      leagueSeasonId: leagueSeason.value.leagueSeasonId,
      season,
      seasonType: 'reg',
      week,
      provider: 'tank01',
      modelVersion: LIVE_PROJECTION_MODEL_VERSION,
      sleeperPlayerIds,
    }),
    dependencies.store.readCurrentSnapshot(leagueSeason.value.leagueSeasonId, week),
  ]);

  const sourceRevision = revision({
    requestStartedAt: source.requestStartedAt,
    requestCompletedAt: source.requestCompletedAt,
    data: source.data,
  });
  const relevantExternalGameIds = [...new Set(starters.flatMap(({ player }) => {
    const game = stateForPlayer(player, persisted.games);
    return game ? [game.gameId] : [];
  }))];
  const frozenByPlayer = baselineMap(frozen);
  const missingFrozenBaselineCount = starters.filter(({ player }) => {
    const game = stateForPlayer(player, persisted.games);
    return game && startedGame(game) && !frozenByPlayer.has(player.id);
  }).length;
  const rosterPoints = source.data.matchups.flatMap((matchup) => matchup.sides.map((side) => ({
    externalRosterId: String(side.team.id),
    points: finite(side.points) ? side.points : null,
  })));
  const observation = await dependencies.store.recordLeagueWeekObservation({
    leagueSeasonId: leagueSeason.value.leagueSeasonId,
    week,
    sourceRevision,
    requestStartedAt: source.requestStartedAt,
    requestCompletedAt: source.requestCompletedAt,
    observedAt: source.requestCompletedAt,
    quality: 'complete',
    sourceData: {
      leagueKey: configuration.key,
      season: source.data.league.season,
      week,
      updatedAt: source.data.updatedAt,
      matchupCount: source.data.matchups.length,
      rosteredPlayerCount: candidatePlayers.length,
      missingFrozenBaselineCount,
      missingBaselinePolicy: 'zero',
      rosterIds: source.data.matchups.flatMap((matchup) => matchup.sides.map((side) => String(side.team.id))),
      warning: source.data.warning ?? null,
    },
    expectedTank01GameIds: relevantExternalGameIds,
    playerPoints: starters.map(({ rosterId, player }) => ({
      sleeperPlayerId: player.id,
      entityKind: entityKind(player),
      externalRosterId: rosterId,
      points: finite(player.points) ? player.points : null,
      isStarter: true,
      lineupSlot: player.slot || null,
    })),
    rosterPoints,
  });
  if (observation.kind !== 'stored'
    || observation.value.playerPointsStored !== starters.length
    || observation.value.rosterPointsStored !== rosterPoints.length
    || observation.value.unmappedSleeperPlayerIds.length > 0
    || observation.value.unmappedTank01GameIds.length > 0
    || observation.value.expectedGamesStored !== relevantExternalGameIds.length) {
    throw new Error('Official Sleeper observations could not be persisted completely.');
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
  const gameStateObservationIds = relevantExternalGameIds.map((externalId) => {
    const observationId = persisted.gameObservationIdsByExternalId.get(externalId);
    if (!observationId) throw new Error('A relevant game-state observation is missing.');
    return observationId;
  });
  const published = await dependencies.store.publishSnapshot({
    leagueSeasonId: leagueSeason.value.leagueSeasonId,
    week,
    modelVersion: LIVE_PROJECTION_MODEL_VERSION,
    revisionKey: revision({
      modelVersion: LIVE_PROJECTION_MODEL_VERSION,
      sourceRevision,
      projectionSourceRevision,
      missingFrozenBaselineCount,
      games: relevantExternalGameIds.map((id) => ({
        id,
        observationId: persisted.gameObservationIdsByExternalId.get(id),
      })),
    }),
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
}
