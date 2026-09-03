import 'server-only';

import { calculateLiveProjection } from '../../live-projection';
import { addProjectedPoints, type PregameProjectionPointMapResult } from '../../matchup-projections';
import type { PlayerProjectionRecord } from '../../projection-store';
import type { ProjectionSyncInput } from '../../sleeper';
import type { Tank01GameStatesAvailable } from '../../tank01-game-state';
import type { MatchupsData } from '../../types';
import { matchupStatus, startedGame, stateForPlayer } from './game-context';
import { activeStarters, finite, isEmptySlot, projectionKind } from './roster-context';

export function baselineMap(records: readonly PlayerProjectionRecord[]): Map<string, PlayerProjectionRecord> {
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

export function buildSnapshot(input: Readonly<{
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
