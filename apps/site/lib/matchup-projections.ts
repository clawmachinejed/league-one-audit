import type { Matchup, Player } from './types';
import { scoreTank01Projection, type SleeperScoringSettings } from './projection-scoring';
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

function limitationWarning(unsupportedKeys: Set<string>, usesPointsAllowedProxy: boolean): string | undefined {
  const limitations: string[] = [];
  if ([...unsupportedKeys].some((key) => key.endsWith('_td_40p'))) {
    limitations.push('40+ yard touchdown bonuses');
  }
  if (unsupportedKeys.has('fum_rec') || unsupportedKeys.has('fum_rec_td')) {
    limitations.push('player fumble-recovery scoring');
  }
  if (unsupportedKeys.has('def_3_and_out') || unsupportedKeys.has('def_4_and_stop')) {
    limitations.push('defensive stops');
  }
  if (unsupportedKeys.has('def_2pt')) limitations.push('defensive two-point returns');
  if (unsupportedKeys.has('st_td')) limitations.push('individual special-teams touchdowns');
  if ([...unsupportedKeys].some((key) => key.startsWith('fgm_') || key.startsWith('bonus_fg'))) {
    limitations.push('field-goal distance scoring');
  }
  const known = new Set([
    'pass_td_40p', 'rush_td_40p', 'rec_td_40p', 'fum_rec', 'fum_rec_td',
    'def_3_and_out', 'def_4_and_stop', 'def_2pt', 'st_td', 'fgm_yds_over_30',
  ]);
  if ([...unsupportedKeys].some((key) => !known.has(key))) limitations.push('other specialty scoring rules');

  const parts: string[] = [];
  if (limitations.length) {
    parts.push(`Projected scores exclude ${limitations.join(', ')} because Tank01 does not project those events.`);
  }
  if (usesPointsAllowedProxy) {
    parts.push("Defense points-allowed scoring uses Tank01's projection rounded to the nearest whole point.");
  }
  return parts.join(' ') || undefined;
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
 * projections only. Partial projections never become a partial team total.
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

  const pointsByPlayer = Object.create(null) as Record<string, number>;
  const unsupportedKeys = new Set<string>();
  let usesPointsAllowedProxy = false;
  let incompleteStarters = 0;
  let invalidScoringSettings = false;
  const starterCounts = new Map<string, number>();
  starters.forEach((player) => starterCounts.set(player.id, (starterCounts.get(player.id) ?? 0) + 1));
  const processedIds = new Set<string>();
  for (const player of starters) {
    if (processedIds.has(player.id)) continue;
    processedIds.add(player.id);
    if ((starterCounts.get(player.id) ?? 0) > 1) {
      incompleteStarters += 1;
      continue;
    }
    const team = defenseTeam(player);
    const defenseProjection = team ? result.projections.byDefenseTeam[team] : undefined;
    const playerProjection = team ? undefined : result.projections.bySleeperId[player.id];
    if ((!team && (!playerProjection || !matchesSleeperPlayer(player, playerProjection)))
      || (team && !defenseProjection)) {
      incompleteStarters += 1;
      continue;
    }
    const projection = defenseProjection ?? playerProjection!;
    const score = scoreTank01Projection(projection.scoringProjection, scoringSettings);
    score.unsupportedScoringKeys.forEach((key) => unsupportedKeys.add(key));
    usesPointsAllowedProxy ||= score.pointsAllowedProxy !== null;
    if (!score.available || !isProjection(score.points)) {
      invalidScoringSettings ||= score.invalidScoringKeys.length > 0;
      if (score.invalidScoringKeys.length === 0 || score.missingStats.length > 0 || score.invalidStats.length > 0) {
        incompleteStarters += 1;
      }
      continue;
    }
    pointsByPlayer[player.id] = score.points;
  }

  return {
    matchups: addProjectedPoints(matchups, pointsByPlayer),
    warning: [
      invalidScoringSettings
        ? 'Some projected scores are unavailable because Sleeper league scoring settings were invalid.'
        : undefined,
      incompleteStarters > 0
        ? 'Some projected scores are unavailable because Tank01 did not provide complete statistics for every starter.'
        : undefined,
      limitationWarning(unsupportedKeys, usesPointsAllowedProxy),
    ].filter(Boolean).join(' ') || undefined,
  };
}
