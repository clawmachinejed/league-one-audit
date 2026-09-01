import type { Matchup, Player } from './types';
import {
  auditProjectionScoringSettings,
  scoreTank01Projection,
  type SleeperScoringSettings,
} from './projection-scoring';
import type { Tank01PlayerProjection, Tank01ProjectionResult } from './tank01';

export type PlayerProjectionPoints = Readonly<Record<string, number>>;

export type ProjectionDecoration = Readonly<{
  matchups: Matchup[];
  warning?: string;
}>;

const defenseAliases: Readonly<Record<string, string>> = {
  JAC: 'JAX',
  LA: 'LAR',
  WSH: 'WAS',
};

function isProjection(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isEmptySlot(player: Player): boolean {
  return player.id.startsWith('empty-');
}

function defenseTeam(player: Player): string | null {
  if (player.position !== 'DEF' && player.slot !== 'DEF') return null;
  const value = (player.nflTeam ?? player.id).trim().toUpperCase();
  return (defenseAliases[value] ?? value) || null;
}

function canonicalTeam(value: string | null): string | null {
  if (!value) return null;
  const normalized = value.trim().toUpperCase();
  return (defenseAliases[normalized] ?? normalized) || null;
}

function canonicalPosition(value: string | null): string | null {
  if (!value) return null;
  const normalized = value.trim().toUpperCase();
  if (normalized === 'PK') return 'K';
  if (normalized === 'D/ST' || normalized === 'DST') return 'DEF';
  return normalized || null;
}

function matchesSleeperPlayer(player: Player, projection: Tank01PlayerProjection): boolean {
  const sleeperTeam = canonicalTeam(player.nflTeam);
  const sleeperPosition = canonicalPosition(player.position);
  const tankTeam = canonicalTeam(projection.team);
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
 * Scores only the real starters displayed in these matchups. Sleeper remains the
 * source of truth for lineups and official scores; Tank01 contributes stat
 * projections only. When an available Tank01 slate lacks a usable projection
 * for a starter, that starter contributes zero so every complete lineup still
 * receives a team total. Provider outages remain unavailable.
 */
export function addTank01ProjectedPoints(
  matchups: Matchup[],
  result: Tank01ProjectionResult,
  scoringSettings: SleeperScoringSettings | null | undefined,
): ProjectionDecoration {
  const starters = matchups.flatMap((matchup) => matchup.sides)
    .flatMap((side) => side.starters)
    .filter((player) => !isEmptySlot(player));
  if (!starters.length) return { matchups };

  if (result.status === 'unavailable') {
    return {
      matchups,
      warning: result.reason === 'missing-api-key'
        ? 'Projected scores are not configured.'
        : 'Projected scores are temporarily unavailable.',
    };
  }
  if (!scoringSettings || Object.keys(scoringSettings).length === 0) {
    return {
      matchups,
      warning: 'Projected scores are unavailable because Sleeper league scoring settings could not be loaded.',
    };
  }
  if (auditProjectionScoringSettings(scoringSettings).invalidScoringKeys.length > 0) {
    return {
      matchups,
      warning: 'Projected scores are unavailable because Sleeper league scoring settings were invalid.',
    };
  }

  const pointsByPlayer = Object.create(null) as Record<string, number>;
  let invalidScoringSettings = false;
  const starterCounts = new Map<string, number>();
  starters.forEach((player) => starterCounts.set(player.id, (starterCounts.get(player.id) ?? 0) + 1));
  const processedIds = new Set<string>();
  for (const player of starters) {
    if (processedIds.has(player.id)) continue;
    processedIds.add(player.id);
    if ((starterCounts.get(player.id) ?? 0) > 1) {
      continue;
    }
    const team = defenseTeam(player);
    const defenseProjection = team ? result.projections.byDefenseTeam[team] : undefined;
    const playerProjection = team ? undefined : result.projections.bySleeperId[player.id];
    if ((!team && !playerProjection) || (team && !defenseProjection)) {
      pointsByPlayer[player.id] = 0;
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
      }
      continue;
    }
    pointsByPlayer[player.id] = score.points;
  }

  return {
    matchups: addProjectedPoints(matchups, pointsByPlayer),
    warning: invalidScoringSettings
      ? 'Some projected scores are unavailable because Sleeper league scoring settings were invalid.'
      : undefined,
  };
}
