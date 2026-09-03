import 'server-only';

import type { DatabaseRow } from '../../../database';
import type { PlayerProjectionRecord, ProjectionQuality, ScoringEntityKind } from './contracts';
import { rowNullableText, rowNumber, rowObject, rowText } from './database-values';

export function asPlayerProjection(row: DatabaseRow): PlayerProjectionRecord {
  return {
    sleeperPlayerId: rowText(row, 'sleeper_player_id'),
    entityId: rowText(row, 'entity_id'),
    entityKind: rowText(row, 'entity_kind') as ScoringEntityKind,
    displayName: rowText(row, 'display_name'),
    nflTeam: rowNullableText(row, 'nfl_team'),
    gameId: rowText(row, 'game_id'),
    tank01GameId: rowNullableText(row, 'tank01_game_id'),
    projectionPoints: rowNumber(row, 'projection_points'),
    projectedStats: rowObject(row, 'projected_stats'),
    quality: rowText(row, 'quality') as ProjectionQuality,
    sourceProjectionRunId: rowText(row, 'source_projection_run_id'),
    projectionProvider: rowText(row, 'projection_provider'),
    modelVersion: rowText(row, 'model_version'),
    fetchedAt: rowText(row, 'fetched_at'),
    frozenAt: rowNullableText(row, 'frozen_at'),
  };
}
