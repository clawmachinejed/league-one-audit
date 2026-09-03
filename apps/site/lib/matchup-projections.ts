import type { Matchup, Player } from './types';
import { canonicalNflTeam } from './nfl-teams';
import {
  auditProjectionScoringSettings,
  scoreTank01Projection,
  type SleeperScoringSettings,
} from './projection-scoring';
import type { Tank01PlayerProjection, Tank01ProjectionResult } from './tank01';

export type PlayerProjectionPoints = Readonly<Record<string, number>>;

export type PregameProjectionPointQuality = 'complete' | 'missing';

export type PregameProjectionPointMapResult = Readonly<{
  status: 'available' | 'unavailable' | 'empty';
  pointsByPlayer: PlayerProjectionPoints;
  qualityByPlayer: Readonly<Record<string, PregameProjectionPointQuality>>;
  warning?: string;
}>;

function isProjection(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isEmptySlot(player: Player): boolean {
  return player.id.startsWith('empty-');
}

function defenseTeam(player: Player): string | null {
  if (player.position !== 'DEF' && player.slot !== 'DEF') return null;
  return canonicalNflTeam(player.nflTeam ?? player.id);
}

function canonicalPosition(value: string | null): string | null {
  if (!value) return null;
  const normalized = value.trim().toUpperCase();
  if (normalized === 'PK') return 'K';
  if (normalized === 'D/ST' || normalized === 'DST') return 'DEF';
  return normalized || null;
}

function matchesSleeperPlayer(player: Player, projection: Tank01PlayerProjection): boolean {
  const sleeperTeam = canonicalNflTeam(player.nflTeam);
  const sleeperPosition = canonicalPosition(player.position);
  const tankTeam = canonicalNflTeam(projection.team);
  const tankPosition = canonicalPosition(projection.position);
  return sleeperTeam !== null && tankTeam === sleeperTeam
    && sleeperPosition !== null && tankPosition === sleeperPosition;
}

export function addProjectedPoints(
  matchups: Matchup[],
  projections: PlayerProjectionPoints,
): Matchup[] {
  return matchups.map((matchup) => ({
    ...matchup,
    sides: matchup.sides.map((side) => {
      const starters = side.starters.map((player) => ({
        ...player,
        projectedPoints: isProjection(projections[player.id]) ? projections[player.id] : null,
      }));
      const realStarters = starters.filter((player) => !isEmptySlot(player));
      const uniqueStarterIds = new Set(realStarters.map((player) => player.id));
      const complete = realStarters.length > 0
        && uniqueStarterIds.size === realStarters.length
        && realStarters.every((player) => isProjection(player.projectedPoints));
      return {
        ...side,
        starters,
        projectedPoints: complete
          ? realStarters.reduce((total, player) => total + player.projectedPoints!, 0)
          : null,
      };
    }),
  }));
}

/**
 * Scores a caller-selected set of Sleeper players. Sleeper remains the source
 * of truth for identity and league scoring; Tank01 contributes projected stats.
 * A missing usable projection is an explicit zero with missing quality, while
 * provider outages remain unavailable.
 */
export function scoreTank01PlayersPointMap(
  players: readonly Player[],
  result: Tank01ProjectionResult,
  scoringSettings: SleeperScoringSettings | null | undefined,
): PregameProjectionPointMapResult {
  const realPlayers = players.filter((player) => !isEmptySlot(player));
  const emptyPoints = Object.create(null) as Record<string, number>;
  const emptyQuality = Object.create(null) as Record<string, PregameProjectionPointQuality>;
  if (!realPlayers.length) {
    return { status: 'empty', pointsByPlayer: emptyPoints, qualityByPlayer: emptyQuality };
  }

  if (result.status === 'unavailable') {
    return {
      status: 'unavailable',
      pointsByPlayer: emptyPoints,
      qualityByPlayer: emptyQuality,
      warning: result.reason === 'missing-api-key'
        ? 'Projected scores are not configured.'
        : 'Projected scores are temporarily unavailable.',
    };
  }
  if (!scoringSettings || Object.keys(scoringSettings).length === 0) {
    return {
      status: 'unavailable',
      pointsByPlayer: emptyPoints,
      qualityByPlayer: emptyQuality,
      warning: 'Projected scores are unavailable because Sleeper league scoring settings could not be loaded.',
    };
  }
  if (auditProjectionScoringSettings(scoringSettings).invalidScoringKeys.length > 0) {
    return {
      status: 'unavailable',
      pointsByPlayer: emptyPoints,
      qualityByPlayer: emptyQuality,
      warning: 'Projected scores are unavailable because Sleeper league scoring settings were invalid.',
    };
  }

  const pointsByPlayer = Object.create(null) as Record<string, number>;
  const qualityByPlayer = Object.create(null) as Record<string, PregameProjectionPointQuality>;
  let invalidScoringSettings = false;
  const playerCounts = new Map<string, number>();
  realPlayers.forEach((player) => playerCounts.set(player.id, (playerCounts.get(player.id) ?? 0) + 1));
  const processedIds = new Set<string>();
  for (const player of realPlayers) {
    if (processedIds.has(player.id)) continue;
    processedIds.add(player.id);
    if ((playerCounts.get(player.id) ?? 0) > 1) {
      continue;
    }
    const team = defenseTeam(player);
    const defenseProjection = team ? result.projections.byDefenseTeam[team] : undefined;
    const playerProjection = team ? undefined : result.projections.bySleeperId[player.id];
    if ((!team && !playerProjection) || (team && !defenseProjection)) {
      pointsByPlayer[player.id] = 0;
      qualityByPlayer[player.id] = 'missing';
      continue;
    }
    // A row that conflicts with Sleeper's current identity is an unsafe ID match,
    // not a missing projection. Keep it unavailable instead of scoring the wrong player.
    if (!team && !matchesSleeperPlayer(player, playerProjection!)) continue;
    const projection = defenseProjection ?? playerProjection!;
    const score = scoreTank01Projection(projection.scoringProjection, scoringSettings);
    if (!score.available || !isProjection(score.points)) {
      if (score.invalidScoringKeys.length > 0) {
        invalidScoringSettings = true;
      } else {
        pointsByPlayer[player.id] = 0;
        qualityByPlayer[player.id] = 'missing';
      }
      continue;
    }
    pointsByPlayer[player.id] = score.points;
    qualityByPlayer[player.id] = 'complete';
  }

  return {
    status: 'available',
    pointsByPlayer,
    qualityByPlayer,
    warning: invalidScoringSettings
      ? 'Some projected scores are unavailable because Sleeper league scoring settings were invalid.'
      : undefined,
  };
}
