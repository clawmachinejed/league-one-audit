import 'server-only';

import { safeJsonArray } from './matchups-shape-sql';

/**
 * Only repository-owned aliases and bind positions enter this shared predicate.
 * The current pointer supplies the snapshot; missing/empty snapshots retain normal
 * seeding. A current-model unavailable result is current, not another retry trigger.
 */
export function futureProbabilityRefreshNeededSql(context: 'plan' | 'claim'): string {
  const material = context === 'plan' ? 'material' : 'materialization';
  const version = context === 'plan' ? '$7::text' : '$13::text';
  return `(${version} IS NOT NULL AND EXISTS (
    SELECT 1
    FROM leagues probability_league
    JOIN league_seasons probability_season
      ON probability_season.league_id = probability_league.id
      AND probability_season.season = ${material}.season
    JOIN league_period_authorities probability_authority
      ON probability_authority.league_key = probability_league.league_key
      AND probability_authority.default_season = ${material}.season
      AND probability_authority.default_season_type = ${material}.season_type
    JOIN league_source_connections probability_connection
      ON probability_connection.league_season_id = probability_season.id
      AND probability_connection.provider = probability_authority.source_provider
      AND probability_connection.external_league_id = probability_authority.source_external_league_id
    JOIN current_projection_snapshots probability_current
      ON probability_current.league_season_id = probability_season.id
      AND probability_current.week = ${material}.week
    JOIN projection_snapshots probability_snapshot
      ON probability_snapshot.id = probability_current.snapshot_id
      AND probability_snapshot.league_season_id = probability_current.league_season_id
      AND probability_snapshot.week = probability_current.week
      AND probability_snapshot.model_version = ${material}.model_version
    WHERE probability_league.league_key = ${material}.league_key
      AND EXISTS (
        SELECT 1 FROM jsonb_array_elements(${safeJsonArray("probability_snapshot.payload -> 'matchups'")}) probability_matchup(value)
        WHERE probability_matchup.value #>> '{winProbability,modelVersion}' IS DISTINCT FROM ${version}
      )
  ))`;
}
