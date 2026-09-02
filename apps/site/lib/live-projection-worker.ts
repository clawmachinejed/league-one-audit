import 'server-only';

import { createHash, randomUUID } from 'node:crypto';
import { LEAGUE_IDS } from './config';
import { calculateLiveProjection, type LiveProjectionKind } from './live-projection';
import { LEAGUE_SITES, type LeagueKey } from './leagues';
import {
  addProjectedPoints,
  scoreTank01PlayersPointMap,
  type PregameProjectionPointMapResult,
} from './matchup-projections';
import { canonicalNflTeam } from './nfl-teams';
import { projectionSyncCadenceForSchedule, type ProjectionSyncCadence } from './projection-window';
import {
  getProjectionStore,
  type PlayerProjectionRecord,
  type ProjectionStore,
  type ScoringEntityIdentityInput,
} from './projection-store';
import {
  getProjectionCadenceInput,
  getProjectionSyncInput,
  type ProjectionCadenceInput,
  type ProjectionSyncInput,
} from './sleeper';
import {
  getTank01WeeklyGameStates,
  type Tank01GameState,
  type Tank01GameStatesAvailable,
  type Tank01GameStatesResult,
} from './tank01-game-state';
import {
  getTank01WeeklyProjections,
  type Tank01AvailableResult,
  type Tank01ProjectionResult,
} from './tank01';
import type { Matchup, MatchupsData, Player } from './types';

export const LIVE_PROJECTION_MODEL_VERSION = 'clock-v1';

const JOB_LEASE_SECONDS = 120;
const MAX_SOURCE_SKEW_MS = 90_000;
const LEAGUE_LOAD_CONCURRENCY = 8;
const PROVIDER_GROUP_CONCURRENCY = 4;
const LEAGUE_PROCESS_CONCURRENCY = 8;
const HOURLY_WINDOW_MINUTES = 5;
const ACTIVITY_WINDOW_BEFORE_KICKOFF_MS = 2 * 60 * 60 * 1_000;
const ACTIVITY_WINDOW_AFTER_KICKOFF_MS = 7 * 60 * 60 * 1_000;

export type ProjectionLeagueConfiguration = Readonly<{
  key: LeagueKey;
  sleeperLeagueId: string;
}>;

export type LiveProjectionWorkerDependencies = Readonly<{
  store: ProjectionStore;
  leagues: readonly ProjectionLeagueConfiguration[];
  getProjectionCadenceInput: (leagueId: string) => Promise<ProjectionCadenceInput>;
  getProjectionSyncInput: (leagueId: string) => Promise<ProjectionSyncInput>;
  getWeeklyProjections: (season: string, week: number) => Promise<Tank01ProjectionResult>;
  getWeeklyGameStates: (season: string, week: number) => Promise<Tank01GameStatesResult>;
  now: () => Date;
  workerId: () => string;
}>;

export type LiveProjectionSyncResult =
  | Readonly<{ status: 'disabled' }>
  | Readonly<{ status: 'skipped'; reason: 'busy' | 'completed' | 'idle'; cadence: ProjectionSyncCadence | null }>
  | Readonly<{
      status: 'completed';
      cadence: ProjectionSyncCadence;
      publishedLeagues: number;
      failedLeagues: number;
      providerGroups: number;
    }>
  | Readonly<{ status: 'failed' }>;

type LoadedLeague = Readonly<{
  configuration: ProjectionLeagueConfiguration;
  source: ProjectionSyncInput;
  cadence: ProjectionSyncCadence;
}>;

type ProviderGroup = Readonly<{
  season: string;
  week: number;
  leagues: readonly LoadedLeague[];
}>;

type ActiveStarter = Readonly<{
  rosterId: string;
  player: Player;
}>;

type PersistedGroup = Readonly<{
  games: Tank01GameStatesAvailable;
  projections: Tank01AvailableResult;
  gameIdsByExternalId: ReadonlyMap<string, string>;
  gameObservationIdsByExternalId: ReadonlyMap<string, string>;
  entityIdsByKey: ReadonlyMap<string, string>;
  projectionSourceRevision: string;
}>;

function defaultDependencies(): LiveProjectionWorkerDependencies {
  return {
    store: getProjectionStore(),
    leagues: (Object.keys(LEAGUE_IDS) as LeagueKey[]).map((key) => ({
      key,
      sleeperLeagueId: LEAGUE_IDS[key],
    })),
    getProjectionCadenceInput,
    getProjectionSyncInput,
    getWeeklyProjections: getTank01WeeklyProjections,
    getWeeklyGameStates: getTank01WeeklyGameStates,
    now: () => new Date(),
    workerId: randomUUID,
  };
}

function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isEmptySlot(player: Player): boolean {
  return player.id.startsWith('empty-');
}

function isDefense(player: Player): boolean {
  return player.position.trim().toUpperCase() === 'DEF' || player.slot.trim().toUpperCase() === 'DEF';
}

function projectionKind(player: Player): LiveProjectionKind {
  if (isDefense(player)) return 'defense';
  return player.position.trim().toUpperCase() === 'K' ? 'kicker' : 'offense';
}

function entityKind(player: Player): 'player' | 'team_defense' {
  return isDefense(player) ? 'team_defense' : 'player';
}

function entityKey(player: Player): string {
  return `${entityKind(player)}:${player.id}`;
}

function activeStarters(data: MatchupsData): ActiveStarter[] {
  return data.matchups.flatMap((matchup) => matchup.sides.flatMap((side) => side.starters
    .filter((player) => !isEmptySlot(player))
    .map((player) => ({ rosterId: String(side.team.id), player }))));
}

function projectionPlayers(source: ProjectionSyncInput): Player[] {
  const players = new Map<string, Player>();
  for (const player of source.rosteredPlayers) {
    if (!isEmptySlot(player)) players.set(player.id, player);
  }
  for (const { player } of activeStarters(source.data)) players.set(player.id, player);
  return [...players.values()];
}

function assertUniqueStarters(starters: readonly ActiveStarter[]): void {
  const seen = new Set<string>();
  for (const { player } of starters) {
    if (seen.has(player.id)) throw new Error('Sleeper returned a duplicate starter.');
    seen.add(player.id);
  }
}

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

function revision(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(canonicalValue(value))).digest('hex');
}

function minuteBoundary(now: Date): string {
  const value = new Date(now);
  value.setUTCSeconds(0, 0);
  return value.toISOString();
}

function hourBoundary(now: Date): string {
  const value = new Date(now);
  value.setUTCMinutes(0, 0, 0);
  return value.toISOString();
}

function workerCadence(
  schedule: ProjectionCadenceInput['schedule'],
  now: Date,
  force: boolean,
): ProjectionSyncCadence {
  const cadence = projectionSyncCadenceForSchedule(schedule, now, force);
  if (cadence !== 'idle') return cadence;
  return now.getUTCMinutes() < HOURLY_WINDOW_MINUTES ? 'hourly' : 'idle';
}

function isCurrentNflPeriod(input: ProjectionCadenceInput): boolean {
  return input.currentNflSeason !== null
    && input.currentNflWeek !== null
    && input.season === input.currentNflSeason
    && input.week === input.currentNflWeek;
}

function activityWindowsForSchedule(schedule: ProjectionSyncInput['schedule']): Array<Readonly<{
  startsAt: string;
  endsAt: string;
}>> {
  const windows = new Map<string, Readonly<{ startsAt: string; endsAt: string }>>();
  for (const game of Object.values(schedule)) {
    if (game.kind !== 'scheduled' || !game.kickoffAt) continue;
    const kickoff = Date.parse(game.kickoffAt);
    if (!Number.isFinite(kickoff)) continue;
    const window = {
      startsAt: new Date(kickoff - ACTIVITY_WINDOW_BEFORE_KICKOFF_MS).toISOString(),
      endsAt: new Date(kickoff + ACTIVITY_WINDOW_AFTER_KICKOFF_MS).toISOString(),
    };
    windows.set(`${window.startsAt}:${window.endsAt}`, window);
  }
  return [...windows.values()].sort((left, right) => left.startsAt.localeCompare(right.startsAt));
}

type ProjectionLogContext = Readonly<{
  stage: string;
  outcome: 'started' | 'completed' | 'skipped' | 'failed';
  leagueKey?: LeagueKey;
  season?: string;
  week?: number;
  publishedLeagues?: number;
  failedLeagues?: number;
}>;

function projectionLog(level: 'info' | 'warn' | 'error', context: ProjectionLogContext): void {
  const entry = JSON.stringify({ service: 'live-projection-sync', ...context });
  if (level === 'error') console.error(entry);
  else if (level === 'warn') console.warn(entry);
  else console.info(entry);
}

function highestCadence(values: readonly ProjectionSyncCadence[]): ProjectionSyncCadence {
  if (values.includes('forced')) return 'forced';
  if (values.includes('live-window')) return 'live-window';
  if (values.includes('hourly')) return 'hourly';
  return 'idle';
}

async function mapWithConcurrency<Input, Output>(
  values: readonly Input[],
  concurrency: number,
  transform: (value: Input) => Promise<Output>,
): Promise<Output[]> {
  const results = new Array<Output>(values.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(concurrency, values.length) }, async () => {
    while (cursor < values.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await transform(values[index]);
    }
  });
  await Promise.all(workers);
  return results;
}

function numericScoringRules(value: Readonly<Record<string, unknown>> | null): Readonly<Record<string, number>> {
  if (!value || Object.keys(value).length === 0) {
    throw new Error('Sleeper scoring settings are unavailable.');
  }
  const result: Record<string, number> = Object.create(null) as Record<string, number>;
  for (const [key, points] of Object.entries(value)) {
    if (!finite(points)) throw new Error('Sleeper scoring settings contain an invalid value.');
    result[key] = points;
  }
  return result;
}

function groupLeagues(leagues: readonly LoadedLeague[]): ProviderGroup[] {
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

function stateForPlayer(player: Player, games: Tank01GameStatesAvailable): Tank01GameState | null {
  if (player.game?.kind === 'bye') return null;
  const team = canonicalNflTeam(player.nflTeam);
  return team ? games.byTeam[team] ?? null : null;
}

function assertCompleteGameCoverage(league: LoadedLeague, games: Tank01GameStatesAvailable): void {
  const completionTimes = [Date.parse(games.requestCompletedAt)];
  completionTimes.push(Date.parse(league.source.requestCompletedAt));
  for (const { player } of activeStarters(league.source.data)) {
    const team = canonicalNflTeam(player.nflTeam);
    if (!team) throw new Error('An active starter is missing a canonical NFL team.');
    if (player.game?.kind === 'bye') continue;
    if (player.game?.kind !== 'scheduled') {
      throw new Error('An active starter is missing its NFL schedule.');
    }
    const game = games.byTeam[team];
    const opponent = canonicalNflTeam(player.game.opponent);
    if (!game || !opponent) throw new Error('Tank01 did not provide every active starter game.');
    const expectedOpponent = game.homeTeam === team ? game.awayTeam : game.homeTeam;
    const expectedLocation = game.homeTeam === team ? 'home' : 'away';
    if (opponent !== expectedOpponent || player.game.location !== expectedLocation) {
      throw new Error('Sleeper schedule and Tank01 game identity do not agree.');
    }
    if (game.statusCode === 1 && (game.phase === 'unknown' || game.remainingFraction === null)) {
      throw new Error('Tank01 returned an incomplete live game clock.');
    }
  }
  if (completionTimes.some((value) => !Number.isFinite(value))
    || Math.max(...completionTimes) - Math.min(...completionTimes) > MAX_SOURCE_SKEW_MS) {
    throw new Error('Sleeper and Tank01 observations were not synchronized closely enough.');
  }
}

function kickoffForGame(game: Tank01GameState, leagues: readonly LoadedLeague[]): string | null {
  const values = new Set<string>();
  for (const league of leagues) {
    for (const team of [game.homeTeam, game.awayTeam]) {
      const scheduled = league.source.schedule[team];
      if (scheduled?.kind !== 'scheduled' || !scheduled.kickoffAt) continue;
      const opponent = team === game.homeTeam ? game.awayTeam : game.homeTeam;
      if (canonicalNflTeam(scheduled.opponent) === opponent) values.add(scheduled.kickoffAt);
    }
  }
  return values.size === 1 ? [...values][0] : null;
}

function scoringEntities(group: ProviderGroup, projections: Tank01AvailableResult): ScoringEntityIdentityInput[] {
  const entities = new Map<string, ScoringEntityIdentityInput>();
  for (const league of group.leagues) {
    for (const player of projectionPlayers(league.source)) {
      const key = entityKey(player);
      if (entities.has(key)) continue;
      const kind = entityKind(player);
      const team = canonicalNflTeam(player.nflTeam);
      const tank01Id = kind === 'team_defense'
        ? team
        : projections.projections.bySleeperId[player.id]?.tank01PlayerId ?? null;
      entities.set(key, {
        key,
        kind,
        displayName: player.name,
        nflTeam: team,
        providerIds: [
          { provider: 'sleeper', externalId: player.id },
          ...(tank01Id ? [{ provider: 'tank01', externalId: tank01Id }] : []),
        ],
      });
    }
  }
  return [...entities.values()];
}

function projectionStats(player: Player, result: Tank01AvailableResult): Readonly<Record<string, unknown>> {
  const team = canonicalNflTeam(player.nflTeam);
  const value = isDefense(player)
    ? (team ? result.projections.byDefenseTeam[team] : undefined)
    : result.projections.bySleeperId[player.id];
  return value?.stats ?? {};
}

function startedGame(state: Tank01GameState): boolean {
  return state.statusCode === 1 || state.statusCode === 2 || state.statusCode === 4;
}

function baselineMap(records: readonly PlayerProjectionRecord[]): Map<string, PlayerProjectionRecord> {
  return new Map(records.map((record) => [record.sleeperPlayerId, record]));
}

function priorProjectionMap(data: MatchupsData | null): Map<string, number> {
  const result = new Map<string, number>();
  if (!data) return result;
  for (const { player } of activeStarters(data)) {
    if (finite(player.projectedPoints)) result.set(player.id, player.projectedPoints);
  }
  return result;
}

function matchupStatus(matchup: Matchup, games: Tank01GameStatesAvailable): Matchup['status'] {
  const phases = matchup.sides.flatMap((side) => side.starters)
    .filter((player) => !isEmptySlot(player) && player.game?.kind !== 'bye')
    .map((player) => stateForPlayer(player, games)?.phase ?? 'unknown');
  if (phases.length === 0) return matchup.status;
  if (phases.every((phase) => phase === 'pregame' || phase === 'postponed')) return 'upcoming';
  if (phases.every((phase) => phase === 'final')) return 'final';
  if (phases.some((phase) => phase === 'unknown')) return 'unknown';
  return 'live';
}

function buildSnapshot(input: Readonly<{
  source: ProjectionSyncInput;
  games: Tank01GameStatesAvailable;
  scored: PregameProjectionPointMapResult;
  latest: readonly PlayerProjectionRecord[];
  frozen: readonly PlayerProjectionRecord[];
  prior: MatchupsData | null;
  calculatedAt: string;
}>): MatchupsData {
  const starters = activeStarters(input.source.data);
  const latest = baselineMap(input.latest);
  const frozen = baselineMap(input.frozen);
  const prior = priorProjectionMap(input.prior);
  const points = Object.create(null) as Record<string, number>;

  for (const { player } of starters) {
    const state = stateForPlayer(player, input.games);
    const record = state && startedGame(state) ? frozen.get(player.id) : latest.get(player.id);

    const fallbackPoints = input.scored.pointsByPlayer[player.id];
    const fallbackQuality = input.scored.qualityByPlayer[player.id];
    const baseline = state && startedGame(state) && !record
      ? { points: 0, quality: 'missing' as const }
      : record
      ? {
          points: record.projectionPoints,
          quality: record.quality === 'missing' ? 'missing' as const : 'complete' as const,
        }
      : finite(fallbackPoints) && fallbackQuality
        ? { points: fallbackPoints, quality: fallbackQuality }
        : null;
    const gameState = state
      ? { phase: state.phase, remainingFraction: state.remainingFraction }
      : { phase: 'pregame' as const, remainingFraction: 1 };
    if (state?.phase === 'final' && !finite(player.points)) {
      throw new Error('Sleeper did not provide a final official score for a starter.');
    }
    const calculated = calculateLiveProjection({
      kind: projectionKind(player),
      gameState,
      baseline,
      officialPoints: finite(player.points) ? player.points : null,
      priorProjectedPoints: prior.get(player.id) ?? null,
    });
    if (!finite(calculated.projectedPoints)) {
      throw new Error('A complete player projection could not be calculated.');
    }
    points[player.id] = calculated.projectedPoints;
  }

  const decorated = addProjectedPoints(input.source.data.matchups, points)
    .map((matchup) => ({ ...matchup, status: matchupStatus(matchup, input.games) }));
  for (const matchup of decorated) {
    for (const side of matchup.sides) {
      if (side.starters.some((player) => !isEmptySlot(player)) && !finite(side.projectedPoints)) {
        throw new Error('A complete team projection could not be calculated.');
      }
    }
  }
  return { ...input.source.data, updatedAt: input.calculatedAt, matchups: decorated };
}

async function persistProviderGroup(
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

async function processLeague(
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

async function runWithDependencies(
  dependencies: LiveProjectionWorkerDependencies,
  options: Readonly<{ force?: boolean }> = {},
): Promise<LiveProjectionSyncResult> {
  if (!dependencies.store.enabled) return { status: 'disabled' };
  const now = dependencies.now();
  if (!Number.isFinite(now.getTime())) return { status: 'failed' };
  const workerId = dependencies.workerId();
  const jobKey = 'live-projection-sync';
  let stage = 'preflight';
  let acquired = false;
  try {
    let cadenceInput: ProjectionCadenceInput | null = null;
    let preflightCadence: ProjectionSyncCadence | null = null;
    let staleFallback: Readonly<{
      input: ProjectionCadenceInput;
      cadence: ProjectionSyncCadence;
    }> | null = null;
    for (const configuration of dependencies.leagues) {
      try {
        const candidate = await dependencies.getProjectionCadenceInput(configuration.sleeperLeagueId);
        if (candidate.sleeperLeagueId !== configuration.sleeperLeagueId) continue;
        const candidateCadence = workerCadence(candidate.schedule, now, options.force === true);
        if (options.force === true || isCurrentNflPeriod(candidate)) {
          // Sleeper's NFL state is global. Once a league points at that same
          // season/week, its complete NFL schedule is a sufficient cheap cadence
          // source for every configured league, including an idle result.
          cadenceInput = candidate;
          preflightCadence = candidateCadence;
          break;
        }
        // A league can temporarily point at an old season or week during annual
        // rollover. Keep it only as a fallback and inspect later configured leagues
        // before deciding that the globally current slate is idle.
        staleFallback ??= { input: candidate, cadence: candidateCadence };
      } catch {
        // Try the next configured league. Normally only the first current-period
        // seed request runs; this fallback keeps one unhealthy league isolated.
        projectionLog('warn', { stage: 'preflight', outcome: 'failed', leagueKey: configuration.key });
      }
    }
    if (!cadenceInput && staleFallback) {
      cadenceInput = staleFallback.input;
      preflightCadence = staleFallback.cadence;
    }
    if (!cadenceInput || !preflightCadence) {
      throw new Error('No projection cadence source could be loaded.');
    }
    if (preflightCadence === 'idle') {
      projectionLog('info', { stage: 'preflight', outcome: 'skipped' });
      return { status: 'skipped', reason: 'idle', cadence: 'idle' };
    }

    stage = 'lease';
    const scheduledFor = options.force
      ? now.toISOString()
      : preflightCadence === 'hourly' ? hourBoundary(now) : minuteBoundary(now);
    const claim = await dependencies.store.acquireJob({
      jobKey,
      jobType: 'live-projection-sync',
      scheduledFor,
      payload: { modelVersion: LIVE_PROJECTION_MODEL_VERSION, forced: options.force === true },
      workerId,
      leaseSeconds: JOB_LEASE_SECONDS,
    });
    if (claim.kind === 'disabled') return { status: 'disabled' };
    if (claim.kind === 'busy' || claim.kind === 'completed') {
      projectionLog('info', { stage: 'lease', outcome: 'skipped' });
      return { status: 'skipped', reason: claim.kind, cadence: null };
    }
    acquired = true;
    projectionLog('info', { stage: 'lease', outcome: 'started' });

    stage = 'league-load';
    const loadLeague = async (configuration: ProjectionLeagueConfiguration): Promise<LoadedLeague> => {
      const source = await dependencies.getProjectionSyncInput(configuration.sleeperLeagueId);
      if (source.sleeperLeagueId !== configuration.sleeperLeagueId) {
        throw new Error('Sleeper returned data for an unexpected league.');
      }
      return {
        configuration,
        source,
        cadence: workerCadence(source.schedule, now, options.force === true),
      };
    };
    const sourceResults = await mapWithConcurrency(
      dependencies.leagues,
      LEAGUE_LOAD_CONCURRENCY,
      async (configuration) => {
        try {
          return { status: 'fulfilled' as const, value: await loadLeague(configuration) };
        } catch {
          projectionLog('warn', { stage: 'league-load', outcome: 'failed', leagueKey: configuration.key });
          return { status: 'rejected' as const };
        }
      },
    );
    const sources = sourceResults.flatMap((result) => result.status === 'fulfilled' ? [result.value] : []);
    let failedLeagues = sourceResults.length - sources.length;
    if (sources.length === 0) throw new Error('No league source could be loaded.');
    const cadence = highestCadence([preflightCadence, ...sources.map((source) => source.cadence)]);

    stage = 'provider-load';
    const groups = groupLeagues(sources);
    const providerResults = await mapWithConcurrency(groups, PROVIDER_GROUP_CONCURRENCY, async (group) => {
      try {
        const [projections, games] = await Promise.all([
        dependencies.getWeeklyProjections(group.season, group.week),
        dependencies.getWeeklyGameStates(group.season, group.week),
      ]);
        if (projections.status !== 'available' || games.status !== 'available'
          || projections.season !== group.season || projections.week !== group.week
          || games.season !== group.season || games.week !== group.week) {
          throw new Error('A required Tank01 source is unavailable.');
        }
        return { status: 'fulfilled' as const, group, projections, games };
      } catch {
        projectionLog('warn', {
          stage: 'provider-load', outcome: 'failed', season: group.season, week: group.week,
        });
        return { status: 'rejected' as const, group };
      }
    });
    const persistedGroups = [] as Array<Readonly<{ group: ProviderGroup; persisted: PersistedGroup }>>;
    for (const provider of providerResults) {
      if (provider.status === 'rejected') {
        failedLeagues += provider.group.leagues.length;
        continue;
      }
      try {
        persistedGroups.push({
          group: provider.group,
          persisted: await persistProviderGroup(
            dependencies,
            provider.group,
            provider.games,
            provider.projections,
          ),
        });
      } catch {
        failedLeagues += provider.group.leagues.length;
        projectionLog('warn', {
          stage: 'provider-persist', outcome: 'failed', season: provider.group.season, week: provider.group.week,
        });
      }
    }

    stage = 'league-publish';
    let publishedLeagues = 0;
    for (const { group, persisted } of persistedGroups) {
      const outcomes = await mapWithConcurrency(
        group.leagues,
        LEAGUE_PROCESS_CONCURRENCY,
        async (league) => {
          try {
            await processLeague(dependencies, league, persisted, now.toISOString());
            return true;
          } catch {
            projectionLog('warn', {
              stage: 'league-publish', outcome: 'failed', leagueKey: league.configuration.key,
              season: group.season, week: group.week,
            });
            return false;
          }
        },
      );
      publishedLeagues += outcomes.filter(Boolean).length;
      failedLeagues += outcomes.filter((published) => !published).length;
    }
    if (publishedLeagues === 0) throw new Error('No complete league snapshot could be published.');
    if (cadence === 'hourly' || cadence === 'forced') {
      await dependencies.store.pruneHistory({
        before: new Date(now.getTime() - (48 * 60 * 60 * 1_000)).toISOString(),
        keepRecentSnapshotsPerLeagueWeek: 3,
      }).catch(() => ({ kind: 'disabled' as const }));
    }
    if (!await dependencies.store.completeJob(jobKey, workerId)) {
      throw new Error('Projection job lease was lost.');
    }
    projectionLog('info', { stage: 'run', outcome: 'completed', publishedLeagues, failedLeagues });
    return {
      status: 'completed', cadence, publishedLeagues, failedLeagues, providerGroups: persistedGroups.length,
    };
  } catch (error) {
    if (acquired) {
      const message = error instanceof Error ? error.message : 'Unknown projection worker failure.';
      await dependencies.store.failJob(jobKey, workerId, message).catch(() => false);
    }
    projectionLog('error', { stage, outcome: 'failed' });
    return { status: 'failed' };
  }
}

export function createLiveProjectionWorker(dependencies: LiveProjectionWorkerDependencies): Readonly<{
  run: (options?: Readonly<{ force?: boolean }>) => Promise<LiveProjectionSyncResult>;
}> {
  return { run: (options) => runWithDependencies(dependencies, options) };
}

export async function runLiveProjectionSync(
  options: Readonly<{ force?: boolean }> = {},
): Promise<LiveProjectionSyncResult> {
  return runWithDependencies(defaultDependencies(), options);
}
