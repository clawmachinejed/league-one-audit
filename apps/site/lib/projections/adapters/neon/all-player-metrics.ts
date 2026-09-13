import 'server-only';

import type { DatabaseClient, DatabaseRow } from '../../../database';
import { SLEEPER_ALL_PLAYER_SCORING_RULE_KEYS } from '../sleeper/scoring-profile';
import type {
  AllPlayerMetricReader,
  AllPlayerMetricSparseScorer,
  ScoringEntityKind,
  StoredAllPlayerMetricRead,
  StoredAllPlayerPlayerMetric,
} from './contracts';
import {
  provider,
  requiredText,
  rowNullableText,
  rowNumber,
  rowObject,
  rowText,
} from './database-values';

type Position = StoredAllPlayerPlayerMetric['position'];

type MetricCandidate = {
  scoringProfileId: string;
  scoringEntityId: string;
  providerExternalId: string;
  entityKind: ScoringEntityKind;
  position: Position;
  totalFantasyPoints: number;
  ppgFantasyPoints: number;
  appearanceGameCount: number;
  publishedWeekCount: number;
};

const POSITIONS: ReadonlySet<string> = new Set(['QB', 'RB', 'WR', 'TE', 'K', 'DEF']);

function boundedInteger(value: number, minimum: number, maximum: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${label} is invalid.`);
  }
  return value;
}

function nullableBoundedInteger(
  row: DatabaseRow,
  key: string,
  minimum: number,
  maximum: number,
  label: string,
): number | null {
  if (row[key] === null || row[key] === undefined) return null;
  return boundedInteger(rowNumber(row, key), minimum, maximum, label);
}

function entityKind(row: DatabaseRow): ScoringEntityKind {
  const value = rowText(row, 'entity_kind');
  if (value !== 'player' && value !== 'team_defense') {
    throw new Error('All-player metric entity kind is invalid.');
  }
  return value;
}

function position(row: DatabaseRow): Position {
  const value = rowText(row, 'position');
  if (!POSITIONS.has(value)) throw new Error('All-player metric position is invalid.');
  return value as Position;
}

function validIdentityShape(kind: ScoringEntityKind, value: Position): boolean {
  return kind === 'team_defense' ? value === 'DEF' : value !== 'DEF';
}

function isoTimestamp(value: string | null, label: string): string | null {
  if (value === null) return null;
  const timestamp = new Date(value);
  if (!Number.isFinite(timestamp.getTime())) throw new Error(`${label} is invalid.`);
  return timestamp.toISOString();
}

function laterTimestamp(left: string | null, right: string | null): string | null {
  if (left === null) return right;
  if (right === null) return left;
  return Date.parse(right) > Date.parse(left) ? right : left;
}

function identityKey(kind: ScoringEntityKind, providerExternalId: string): string {
  return `${kind}:${providerExternalId}`;
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function publishedCandidate(row: DatabaseRow): MetricCandidate {
  const kind = entityKind(row);
  const metricPosition = position(row);
  if (!validIdentityShape(kind, metricPosition)) {
    throw new Error('All-player metric identity and position disagree.');
  }
  return {
    scoringProfileId: rowText(row, 'scoring_profile_id'),
    scoringEntityId: rowText(row, 'scoring_entity_id'),
    providerExternalId: rowText(row, 'provider_external_id'),
    entityKind: kind,
    position: metricPosition,
    totalFantasyPoints: rowNumber(row, 'total_fantasy_points'),
    ppgFantasyPoints: rowNumber(row, 'ppg_fantasy_points'),
    appearanceGameCount: boundedInteger(
      rowNumber(row, 'appearance_game_count'), 0, 18, 'All-player appearance count',
    ),
    publishedWeekCount: boundedInteger(
      rowNumber(row, 'published_week_count'), 1, 18, 'All-player published week count',
    ),
  };
}

function combinePartial(
  row: DatabaseRow,
  rules: Readonly<Record<string, unknown>>,
  candidates: Map<string, MetricCandidate>,
  invalidIdentities: Set<string>,
  scorePartialStatistics: AllPlayerMetricSparseScorer,
): boolean {
  const kind = entityKind(row);
  const metricPosition = position(row);
  const providerExternalId = rowText(row, 'provider_external_id');
  const key = identityKey(kind, providerExternalId);
  if (!validIdentityShape(kind, metricPosition)) {
    invalidIdentities.add(key);
    candidates.delete(key);
    return false;
  }
  const scored = scorePartialStatistics(
    rowObject(row, 'stats') as Readonly<Record<string, number>>,
    rules,
    SLEEPER_ALL_PLAYER_SCORING_RULE_KEYS,
  );
  if (!scored.available || scored.points === null || scored.points === 0) return false;

  const eligible = nullableBoundedInteger(row, 'eligible_game_count', 0, 1, 'All-player eligibility count');
  const appearance = nullableBoundedInteger(row, 'appearance_game_count', 0, 1, 'All-player appearance count');
  if (((eligible !== null || appearance !== null)
      && (eligible === null || appearance === null || appearance > eligible))
    || eligible === 0 || appearance === 0) {
    invalidIdentities.add(key);
    candidates.delete(key);
    return false;
  }

  const scoringProfileId = rowText(row, 'scoring_profile_id');
  const scoringEntityId = rowText(row, 'scoring_entity_id');
  const current = candidates.get(key);
  if (current && (current.scoringProfileId !== scoringProfileId
    || current.scoringEntityId !== scoringEntityId
    || current.position !== metricPosition)) {
    invalidIdentities.add(key);
    candidates.delete(key);
    return false;
  }
  const partialConfirmed = appearance === 1;
  candidates.set(key, {
    scoringProfileId,
    scoringEntityId,
    providerExternalId,
    entityKind: kind,
    position: metricPosition,
    totalFantasyPoints: (current?.totalFantasyPoints ?? 0) + scored.points,
    ppgFantasyPoints: (current?.ppgFantasyPoints ?? 0) + (partialConfirmed ? scored.points : 0),
    appearanceGameCount: (current?.appearanceGameCount ?? 0) + (partialConfirmed ? 1 : 0),
    publishedWeekCount: current?.publishedWeekCount ?? 0,
  });
  return true;
}

function rankCandidates(candidates: Iterable<MetricCandidate>): StoredAllPlayerPlayerMetric[] {
  const byPosition = new Map<Position, MetricCandidate[]>();
  for (const candidate of candidates) {
    if (!Number.isFinite(candidate.totalFantasyPoints) || candidate.totalFantasyPoints === 0) continue;
    const values = byPosition.get(candidate.position) ?? [];
    values.push(candidate);
    byPosition.set(candidate.position, values);
  }
  const metrics: StoredAllPlayerPlayerMetric[] = [];
  for (const values of byPosition.values()) {
    values.sort((left, right) => right.totalFantasyPoints - left.totalFantasyPoints
      || compareText(left.providerExternalId, right.providerExternalId));
    let rank = 0;
    let previousTotal: number | null = null;
    values.forEach((candidate, index) => {
      if (previousTotal === null || candidate.totalFantasyPoints !== previousTotal) rank = index + 1;
      const pointsPerGame = candidate.appearanceGameCount > 0 && candidate.ppgFantasyPoints !== 0
        ? candidate.ppgFantasyPoints / candidate.appearanceGameCount : null;
      metrics.push({
        scoringProfileId: candidate.scoringProfileId,
        scoringEntityId: candidate.scoringEntityId,
        providerExternalId: candidate.providerExternalId,
        entityKind: candidate.entityKind,
        position: candidate.position,
        totalFantasyPoints: candidate.totalFantasyPoints,
        appearanceGameCount: candidate.appearanceGameCount,
        publishedWeekCount: candidate.publishedWeekCount,
        pointsPerGame,
        positionRank: rank,
      });
      previousTotal = candidate.totalFantasyPoints;
    });
  }
  return metrics.sort((left, right) => compareText(left.position, right.position)
    || left.positionRank - right.positionRank
    || compareText(left.providerExternalId, right.providerExternalId));
}

function unavailable(rowsRead = 0): StoredAllPlayerMetricRead {
  return { status: 'unavailable', observedAt: null, throughWeek: null, rowsRead, metrics: [] };
}

export function createAllPlayerMetricMethods(client: DatabaseClient): AllPlayerMetricReader {
  return {
    async readAllPlayerPlayerMetrics(input, scorePartialStatistics) {
      const leagueKey = requiredText(input.leagueKey, 'League key');
      const normalizedProvider = provider(input.provider);
      const season = boundedInteger(input.season, 1920, 2200, 'All-player season');
      if (!['pre', 'reg', 'post'].includes(input.seasonType)) {
        throw new Error('All-player season type is invalid.');
      }
      const throughWeek = boundedInteger(input.throughWeek, 1, 18, 'All-player through week');
      const provisionalWeek = input.provisionalWeek === null ? null
        : boundedInteger(input.provisionalWeek, 1, 18, 'All-player provisional week');
      if (provisionalWeek !== null && provisionalWeek > throughWeek) {
        throw new Error('All-player provisional week exceeds the through-week boundary.');
      }
      const scorerVersion = requiredText(input.scorerVersion, 'All-player scorer version');
      const rows = await client.query(`/* projection-store:read-all-player-player-metrics */
        WITH target_profile AS (
          SELECT season.scoring_profile_id, profile.rules
          FROM leagues league
          JOIN league_seasons season ON season.league_id = league.id
          JOIN scoring_profiles profile ON profile.id = season.scoring_profile_id
          WHERE league.league_key = $1 AND season.season = $3::smallint
        ), published_pointers AS (
          SELECT pointer.*
          FROM target_profile profile
          JOIN current_all_player_score_sets pointer
            ON pointer.scoring_profile_id = profile.scoring_profile_id
            AND pointer.provider = $2 AND pointer.season = $3::smallint
            AND pointer.season_type = $4 AND pointer.week <= $5::smallint
            AND pointer.scorer_version = $6
        ), published_summary AS (
          SELECT count(*)::integer AS published_week_count,
            max(week)::integer AS published_through_week,
            max(observed_at)::text AS published_observed_at
          FROM published_pointers
        ), published_metrics AS (
          SELECT profile.scoring_profile_id::text AS scoring_profile_id,
            score.scoring_entity_id::text AS scoring_entity_id,
            score.entity_kind, score.provider_external_id, score.position,
            sum(score.fantasy_points)::text AS total_fantasy_points,
            COALESCE(sum(score.fantasy_points)
              FILTER (WHERE score.appearance_game_count = 1), 0)::text AS ppg_fantasy_points,
            count(*) FILTER (WHERE score.appearance_game_count = 1)::integer AS appearance_game_count,
            summary.published_week_count
          FROM target_profile profile
          JOIN published_summary summary ON true
          JOIN published_pointers pointer ON true
          JOIN all_player_scores score
            ON score.all_player_score_set_id = pointer.all_player_score_set_id
            AND (score.fantasy_points <> 0 OR score.appearance_game_count = 1)
          GROUP BY profile.scoring_profile_id, score.scoring_entity_id, score.entity_kind,
            score.provider_external_id, score.position, summary.published_week_count
          HAVING sum(score.fantasy_points) <> 0
        ), latest_partial AS (
          SELECT observation.*
          FROM all_player_stat_observations observation
          JOIN all_player_stat_contents content
            ON content.id = observation.all_player_stat_content_id
            AND content.quality = 'partial'
          WHERE $7::smallint IS NOT NULL
            AND observation.provider = $2 AND observation.season = $3::smallint
            AND observation.season_type = $4 AND observation.week = $7::smallint
            AND observation.quality = 'partial'
            AND NOT EXISTS (
              SELECT 1 FROM published_pointers pointer WHERE pointer.week = observation.week
            )
          ORDER BY observation.observed_at DESC, observation.request_completed_at DESC,
            observation.created_at DESC, observation.id DESC
          LIMIT 1
        ), partial_metrics AS (
          SELECT profile.scoring_profile_id::text AS scoring_profile_id,
            mapping.scoring_entity_id::text AS scoring_entity_id,
            entry.entity_kind, entry.provider_external_id, entry.position, entry.stats,
            entry.eligible_game_count, entry.appearance_game_count
          FROM latest_partial observation
          JOIN target_profile profile ON true
          JOIN all_player_stat_entries entry
            ON entry.all_player_stat_content_id = observation.all_player_stat_content_id
          JOIN external_scoring_entity_ids mapping
            ON mapping.provider = observation.provider
            AND mapping.entity_kind = entry.entity_kind
            AND mapping.external_id = entry.provider_external_id
            AND mapping.mapping_status = 'verified'
            AND mapping.valid_from <= observation.observed_at
            AND (mapping.valid_to IS NULL OR mapping.valid_to > observation.observed_at)
          JOIN scoring_entities entity
            ON entity.id = mapping.scoring_entity_id AND entity.kind = entry.entity_kind
          WHERE EXISTS (
            SELECT 1
            FROM jsonb_each(entry.stats) stat
            JOIN jsonb_each(profile.rules) rule ON rule.key = stat.key
            WHERE jsonb_typeof(stat.value) = 'number'
              AND jsonb_typeof(rule.value) = 'number'
              AND (stat.value #>> '{}')::numeric <> 0
              AND (rule.value #>> '{}')::numeric <> 0
          )
        )
        SELECT 'metadata'::text AS row_kind,
          profile.scoring_profile_id::text AS scoring_profile_id, profile.rules,
          summary.published_week_count, summary.published_through_week,
          summary.published_observed_at,
          partial.week::integer AS partial_week, partial.observed_at::text AS partial_observed_at,
          NULL::text AS scoring_entity_id, NULL::text AS entity_kind,
          NULL::text AS provider_external_id, NULL::text AS position,
          NULL::text AS total_fantasy_points, NULL::text AS ppg_fantasy_points,
          NULL::integer AS appearance_game_count,
          NULL::jsonb AS stats, NULL::integer AS eligible_game_count
        FROM target_profile profile
        JOIN published_summary summary ON true
        LEFT JOIN latest_partial partial ON true
        UNION ALL
        SELECT 'published', metric.scoring_profile_id, NULL, metric.published_week_count, NULL, NULL, NULL, NULL,
          metric.scoring_entity_id, metric.entity_kind, metric.provider_external_id, metric.position,
          metric.total_fantasy_points, metric.ppg_fantasy_points,
          metric.appearance_game_count, NULL, NULL
        FROM published_metrics metric
        UNION ALL
        SELECT 'partial', metric.scoring_profile_id, NULL, NULL, NULL, NULL, NULL, NULL,
          metric.scoring_entity_id, metric.entity_kind, metric.provider_external_id, metric.position,
          NULL, NULL, metric.appearance_game_count, metric.stats, metric.eligible_game_count
        FROM partial_metrics metric`, [
        leagueKey, normalizedProvider, season, input.seasonType, throughWeek, scorerVersion, provisionalWeek,
      ]);
      const metadata = rows.filter((row) => row.row_kind === 'metadata');
      if (metadata.length === 0) return unavailable(rows.length);
      if (metadata.length !== 1) throw new Error('All-player metric metadata is ambiguous.');
      const profileId = rowText(metadata[0], 'scoring_profile_id');
      const rules = rowObject(metadata[0], 'rules');
      const publishedWeekCount = boundedInteger(
        rowNumber(metadata[0], 'published_week_count'), 0, 18, 'All-player published week count',
      );
      const publishedThroughWeek = nullableBoundedInteger(
        metadata[0], 'published_through_week', 1, 18, 'All-player published through week',
      );
      const partialThroughWeek = nullableBoundedInteger(
        metadata[0], 'partial_week', 1, 18, 'All-player partial week',
      );
      const publishedObservedAt = isoTimestamp(
        rowNullableText(metadata[0], 'published_observed_at'), 'All-player published observation time',
      );
      const partialObservedAt = isoTimestamp(
        rowNullableText(metadata[0], 'partial_observed_at'), 'All-player partial observation time',
      );

      const candidates = new Map<string, MetricCandidate>();
      const invalidIdentities = new Set<string>();
      for (const row of rows.filter((value) => value.row_kind === 'published')) {
        const candidate = publishedCandidate(row);
        if (candidate.scoringProfileId !== profileId) {
          throw new Error('All-player metric scoring profiles disagree.');
        }
        const key = identityKey(candidate.entityKind, candidate.providerExternalId);
        if (candidates.has(key)) {
          invalidIdentities.add(key);
          candidates.delete(key);
        } else if (!invalidIdentities.has(key)) {
          candidates.set(key, candidate);
        }
      }
      let usablePartial = false;
      for (const row of rows.filter((value) => value.row_kind === 'partial')) {
        const key = identityKey(entityKind(row), rowText(row, 'provider_external_id'));
        if (!invalidIdentities.has(key)) {
          usablePartial = combinePartial(
            row, rules, candidates, invalidIdentities, scorePartialStatistics,
          ) || usablePartial;
        }
      }
      for (const key of invalidIdentities) candidates.delete(key);
      const hasPublished = publishedWeekCount > 0 && publishedThroughWeek !== null
        && publishedObservedAt !== null;
      const hasProvisional = usablePartial && partialThroughWeek !== null && partialObservedAt !== null;
      return {
        status: hasProvisional ? 'provisional' : hasPublished ? 'published' : 'unavailable',
        observedAt: hasProvisional
          ? laterTimestamp(publishedObservedAt, partialObservedAt) : hasPublished ? publishedObservedAt : null,
        throughWeek: hasProvisional ? partialThroughWeek : hasPublished ? publishedThroughWeek : null,
        rowsRead: rows.length,
        metrics: rankCandidates(candidates.values()),
      };
    },
  };
}
