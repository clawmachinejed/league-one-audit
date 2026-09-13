import 'server-only';

import type { DatabaseClient, DatabaseRow } from '../../../database';
import type { ProjectionStore, StoredAllPlayerPlayerMetric } from './contracts';
import { provider, requiredText, rowNumber, rowText } from './database-values';

type AllPlayerMetricMethods = Pick<ProjectionStore, 'readAllPlayerPlayerMetrics'>;

function boundedInteger(value: number, minimum: number, maximum: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${label} is invalid.`);
  }
  return value;
}

function nullableNumber(row: DatabaseRow, key: string): number | null {
  if (row[key] === null || row[key] === undefined) return null;
  return rowNumber(row, key);
}

function metric(row: DatabaseRow): StoredAllPlayerPlayerMetric {
  const totalFantasyPoints = rowNumber(row, 'total_fantasy_points');
  const appearanceGameCount = boundedInteger(
    rowNumber(row, 'appearance_game_count'), 0, 18, 'All-player appearance count',
  );
  const publishedWeekCount = boundedInteger(
    rowNumber(row, 'published_week_count'), 1, 18, 'All-player published week count',
  );
  const pointsPerGame = nullableNumber(row, 'points_per_game');
  const denominatorComplete = row.denominator_complete === true || row.denominator_complete === 'true';
  if (!denominatorComplete) throw new Error('All-player PPG denominator is incomplete.');
  if ((appearanceGameCount === 0) !== (pointsPerGame === null)) {
    throw new Error('All-player PPG denominator and value disagree.');
  }
  if (pointsPerGame !== null
    && Math.abs(pointsPerGame - (totalFantasyPoints / appearanceGameCount)) > 0.0001) {
    throw new Error('All-player PPG arithmetic is inconsistent.');
  }
  return {
    scoringProfileId: rowText(row, 'scoring_profile_id'),
    scoringEntityId: rowText(row, 'scoring_entity_id'),
    providerExternalId: rowText(row, 'provider_external_id'),
    totalFantasyPoints,
    appearanceGameCount,
    publishedWeekCount,
    pointsPerGame,
  };
}

export function createAllPlayerMetricMethods(client: DatabaseClient): AllPlayerMetricMethods {
  return {
    async readAllPlayerPlayerMetrics(input) {
      const leagueKey = requiredText(input.leagueKey, 'League key');
      const normalizedProvider = provider(input.provider);
      const season = boundedInteger(input.season, 1920, 2200, 'All-player season');
      if (!['pre', 'reg', 'post'].includes(input.seasonType)) {
        throw new Error('All-player season type is invalid.');
      }
      const throughWeek = boundedInteger(input.throughWeek, 1, 18, 'All-player through week');
      const scorerVersion = requiredText(input.scorerVersion, 'All-player scorer version');
      const rows = await client.query(`/* projection-store:read-all-player-player-metrics */
        WITH target_profile AS (
          SELECT season.scoring_profile_id
          FROM leagues league
          JOIN league_seasons season ON season.league_id = league.id
          WHERE league.league_key = $1 AND season.season = $3::smallint
        )
        SELECT profile.scoring_profile_id::text AS scoring_profile_id,
          score.scoring_entity_id::text AS scoring_entity_id,
          score.provider_external_id,
          sum(score.fantasy_points)::text AS total_fantasy_points,
          sum(score.appearance_game_count)::integer AS appearance_game_count,
          count(DISTINCT pointer.week)::integer AS published_week_count,
          CASE WHEN sum(score.appearance_game_count) = 0 THEN NULL
            ELSE (sum(score.fantasy_points) / sum(score.appearance_game_count))::text
          END AS points_per_game,
          count(*) = count(score.appearance_game_count) AS denominator_complete
        FROM target_profile profile
        JOIN current_all_player_score_sets pointer
          ON pointer.scoring_profile_id = profile.scoring_profile_id
          AND pointer.provider = $2 AND pointer.season = $3::smallint
          AND pointer.season_type = $4 AND pointer.week <= $5::smallint
          AND pointer.scorer_version = $6
        JOIN all_player_scores score
          ON score.all_player_score_set_id = pointer.all_player_score_set_id
          AND score.entity_kind = 'player'
        GROUP BY profile.scoring_profile_id, score.scoring_entity_id, score.provider_external_id
        ORDER BY score.provider_external_id`, [
        leagueKey, normalizedProvider, season, input.seasonType, throughWeek, scorerVersion,
      ]);
      const metrics = rows.map(metric);
      const entityIds = new Set<string>();
      const providerIds = new Set<string>();
      for (const value of metrics) {
        if (entityIds.has(value.scoringEntityId) || providerIds.has(value.providerExternalId)) {
          throw new Error('All-player PPG rows contain a duplicate player identity.');
        }
        entityIds.add(value.scoringEntityId);
        providerIds.add(value.providerExternalId);
      }
      return metrics;
    },
  };
}
