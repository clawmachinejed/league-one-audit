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
  scoringEntityId: string | null;
  providerExternalId: string;
  entityKind: ScoringEntityKind;
  position: Position;
  totalFantasyPoints: number;
  rankUnits: bigint;
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

// Match PostgreSQL numeric(14,4) for each weekly score. Decimal strings avoid
// binary rounding differences; PostgreSQL rounds halfway away from zero.
function rankUnits(value: number | string): bigint {
  const match = /^([+-]?)(\d+)(?:\.(\d*))?(?:e([+-]?\d+))?$/iu.exec(String(value));
  if (match === null) throw new Error('All-player rank score is invalid.');
  const fraction = match[3] ?? '';
  const coefficient = BigInt(`${match[2]}${fraction}`);
  if (coefficient === 0n) return 0n;
  const shift = 4 + Number(match[4] ?? 0) - fraction.length;
  let units: bigint;
  if (shift >= 0) {
    units = coefficient * (10n ** BigInt(shift));
  } else {
    const divisor = 10n ** BigInt(-shift);
    units = coefficient / divisor;
    if ((coefficient % divisor) * 2n >= divisor) units += 1n;
  }
  return match[1] === '-' ? -units : units;
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
    rankUnits: rankUnits(rowText(row, 'total_fantasy_points')),
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
  rankUnavailablePositions: Set<string>,
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
  if (!scored.available || scored.points === null || !Number.isFinite(scored.points)) {
    rankUnavailablePositions.add(metricPosition);
    return false;
  }

  const eligible = nullableBoundedInteger(row, 'eligible_game_count', 0, 1, 'All-player eligibility count');
  const appearance = nullableBoundedInteger(row, 'appearance_game_count', 0, 1, 'All-player appearance count');
  const partialConfirmed = eligible === 1 && appearance === 1;
  if (scored.points === 0 && !partialConfirmed) return false;
  if (eligible === 0 || appearance === 0) {
    rankUnavailablePositions.add(metricPosition);
    return false;
  }

  const scoringProfileId = rowText(row, 'scoring_profile_id');
  const scoringEntityId = rowNullableText(row, 'scoring_entity_id');
  const current = candidates.get(key);
  if (current && (current.scoringProfileId !== scoringProfileId
    || (current.scoringEntityId !== null && scoringEntityId !== null
      && current.scoringEntityId !== scoringEntityId)
    || current.position !== metricPosition)) {
    throw new Error('All-player published and partial identities disagree.');
  }
  const totalFantasyPoints = (current?.totalFantasyPoints ?? 0) + scored.points;
  const ppgFantasyPoints = (current?.ppgFantasyPoints ?? 0) + (partialConfirmed ? scored.points : 0);
  if (!Number.isFinite(totalFantasyPoints) || !Number.isFinite(ppgFantasyPoints)) {
    rankUnavailablePositions.add(metricPosition);
    return false;
  }
  candidates.set(key, {
    scoringProfileId,
    scoringEntityId: scoringEntityId ?? current?.scoringEntityId ?? null,
    providerExternalId,
    entityKind: kind,
    position: metricPosition,
    totalFantasyPoints,
    rankUnits: (current?.rankUnits ?? 0n) + rankUnits(scored.points),
    ppgFantasyPoints,
    appearanceGameCount: (current?.appearanceGameCount ?? 0) + (partialConfirmed ? 1 : 0),
    publishedWeekCount: current?.publishedWeekCount ?? 0,
  });
  return true;
}

function rankCandidates(
  candidates: Iterable<MetricCandidate>,
  rankUnavailablePositions: ReadonlySet<string>,
): StoredAllPlayerPlayerMetric[] {
  const byPosition = new Map<Position, MetricCandidate[]>();
  for (const candidate of candidates) {
    if (!Number.isFinite(candidate.totalFantasyPoints)
      || (candidate.totalFantasyPoints === 0 && candidate.rankUnits === 0n)) continue;
    const values = byPosition.get(candidate.position) ?? [];
    values.push(candidate);
    byPosition.set(candidate.position, values);
  }
  const metrics: StoredAllPlayerPlayerMetric[] = [];
  for (const values of byPosition.values()) {
    values.sort((left, right) => (left.rankUnits > right.rankUnits ? -1 : left.rankUnits < right.rankUnits ? 1 : 0)
      || compareText(left.providerExternalId, right.providerExternalId));
    let rank = 0;
    let rankedCount = 0;
    let previousUnits: bigint | null = null;
    values.forEach((candidate) => {
      if (candidate.rankUnits !== 0n) {
        rankedCount += 1;
        if (previousUnits === null || candidate.rankUnits !== previousUnits) rank = rankedCount;
        previousUnits = candidate.rankUnits;
      }
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
        positionRank: candidate.rankUnits === 0n || rankUnavailablePositions.has(candidate.position) ? null : rank,
      });
    });
  }
  return metrics.sort((left, right) => compareText(left.position, right.position)
    || (left.positionRank ?? 0) - (right.positionRank ?? 0)
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
        ), latest_partial AS (
          SELECT DISTINCT ON (observation.week) observation.*
          FROM all_player_stat_observations observation
          JOIN all_player_stat_contents content
            ON content.id = observation.all_player_stat_content_id
            AND content.quality = 'partial'
          WHERE observation.provider = $2 AND observation.season = $3::smallint
            AND observation.season_type = $4 AND observation.week <= $5::smallint
            AND observation.quality = 'partial'
            AND NOT EXISTS (
              SELECT 1 FROM published_pointers pointer WHERE pointer.week = observation.week
            )
          ORDER BY observation.week, observation.observed_at DESC, observation.request_completed_at DESC,
            observation.created_at DESC, observation.id DESC
        ), partial_summary AS (
          SELECT max(week)::integer AS partial_week,
            max(observed_at)::text AS partial_observed_at
          FROM latest_partial
        ), missing_periods AS (
          SELECT count(*)::integer AS missing_prior_week_count
          FROM generate_series(1, $5::integer) requested(week)
          WHERE requested.week IS DISTINCT FROM $7::smallint
            AND NOT EXISTS (SELECT 1 FROM published_pointers pointer WHERE pointer.week = requested.week)
            AND NOT EXISTS (SELECT 1 FROM latest_partial partial WHERE partial.week = requested.week)
        ), mapping_inventory AS (
          SELECT external_id, count(*) AS mapping_count
          FROM external_scoring_entity_ids
          WHERE provider = $2
          GROUP BY external_id
        ), partial_metrics AS (
          SELECT profile.scoring_profile_id::text AS scoring_profile_id,
            entity.id::text AS scoring_entity_id,
            entry.entity_kind, entry.provider_external_id, entry.position, entry.stats,
            entry.eligible_game_count, entry.appearance_game_count, observation.week,
            CASE WHEN inventory.mapping_count IS NULL THEN 'absent'
              WHEN inventory.mapping_count = 1 AND entity.id IS NOT NULL
                AND mapping.mapping_status = 'verified'
                AND mapping.valid_from <= CURRENT_TIMESTAMP
                AND (mapping.valid_to IS NULL OR mapping.valid_to > CURRENT_TIMESTAMP)
                THEN 'usable'
              ELSE 'unusable' END AS mapping_state
          FROM latest_partial observation
          JOIN target_profile profile ON true
          JOIN all_player_stat_entries entry
            ON entry.all_player_stat_content_id = observation.all_player_stat_content_id
          LEFT JOIN mapping_inventory inventory ON inventory.external_id = entry.provider_external_id
          LEFT JOIN external_scoring_entity_ids mapping
            ON mapping.provider = observation.provider
            AND mapping.entity_kind = entry.entity_kind
            AND mapping.external_id = entry.provider_external_id
          LEFT JOIN scoring_entities entity
            ON entity.id = mapping.scoring_entity_id AND entity.kind = entry.entity_kind
          WHERE entry.appearance_game_count = 1 OR EXISTS (
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
          partial.partial_week, partial.partial_observed_at,
          NULL::text AS scoring_entity_id, NULL::text AS entity_kind,
          NULL::text AS provider_external_id, NULL::text AS position,
          NULL::text AS total_fantasy_points, NULL::text AS ppg_fantasy_points,
          NULL::integer AS appearance_game_count,
          NULL::jsonb AS stats, NULL::integer AS eligible_game_count,
          NULL::text AS mapping_state,
          missing.missing_prior_week_count
        FROM target_profile profile
        JOIN published_summary summary ON true
        JOIN partial_summary partial ON true
        JOIN missing_periods missing ON true
        UNION ALL
        SELECT 'published', metric.scoring_profile_id, NULL, metric.published_week_count, NULL, NULL, NULL, NULL,
          metric.scoring_entity_id, metric.entity_kind, metric.provider_external_id, metric.position,
          metric.total_fantasy_points, metric.ppg_fantasy_points,
          metric.appearance_game_count, NULL, NULL, 'usable'::text, NULL::integer
        FROM published_metrics metric
        UNION ALL
        SELECT 'partial', metric.scoring_profile_id, NULL, NULL, NULL, NULL, metric.week::integer, NULL,
          metric.scoring_entity_id, metric.entity_kind, metric.provider_external_id, metric.position,
          NULL, NULL, metric.appearance_game_count, metric.stats, metric.eligible_game_count,
          metric.mapping_state, NULL::integer
        FROM partial_metrics metric
        ORDER BY row_kind, partial_week, provider_external_id`, [
        leagueKey, normalizedProvider, season, input.seasonType, throughWeek, scorerVersion, provisionalWeek,
      ]);
      const metadata = rows.filter((row) => row.row_kind === 'metadata');
      if (metadata.length === 0) return unavailable(rows.length);
      if (metadata.length !== 1) throw new Error('All-player metric metadata is ambiguous.');
      const profileId = rowText(metadata[0], 'scoring_profile_id');
      const rules = rowObject(metadata[0], 'rules');
      // Projection-only coverage does not determine actual-stat position ranks.
      const rankUnavailablePositions = new Set<string>();
      const missingPriorWeekCount = boundedInteger(
        rowNumber(metadata[0], 'missing_prior_week_count'), 0, throughWeek, 'All-player missing prior week count',
      );
      if (missingPriorWeekCount > 0) {
        for (const metricPosition of POSITIONS) rankUnavailablePositions.add(metricPosition);
      }
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
      const canonicalOwners = new Map<string, string>();
      const officialKinds = new Map<string, ScoringEntityKind>();
      const identityTargets = new Map<string, Readonly<{
        canonicalId: string | null; position: Position; scoringProfileId: string;
      }>>();
      const partialIdentities = new Set<string>();
      for (const row of rows.filter((value) => value.row_kind !== 'metadata')) {
        if (rowText(row, 'scoring_profile_id') !== profileId) {
          throw new Error('All-player metric scoring profiles disagree.');
        }
        const kind = entityKind(row);
        const metricPosition = position(row);
        const officialId = rowText(row, 'provider_external_id');
        const key = identityKey(kind, officialId);
        const existingKind = officialKinds.get(officialId);
        if (existingKind !== undefined && existingKind !== kind) {
          throw new Error('All-player official identity kinds disagree across periods.');
        }
        officialKinds.set(officialId, kind);
        const scoringProfileId = rowText(row, 'scoring_profile_id');
        const existingTarget = identityTargets.get(key);
        if (existingTarget !== undefined && (existingTarget.position !== metricPosition
          || existingTarget.scoringProfileId !== scoringProfileId)) {
          throw new Error('All-player identities disagree across periods.');
        }
        identityTargets.set(key, { canonicalId: existingTarget?.canonicalId ?? null,
          position: metricPosition, scoringProfileId });
        if (row.row_kind === 'partial') {
          const week = boundedInteger(rowNumber(row, 'partial_week'), 1, throughWeek, 'All-player partial week');
          const periodIdentity = `${week}:${key}`;
          if (partialIdentities.has(periodIdentity)) throw new Error('All-player partial identity is duplicated.');
          partialIdentities.add(periodIdentity);
        }
        const canonicalId = rowNullableText(row, 'scoring_entity_id');
        const mappingState = row.row_kind === 'partial' ? rowText(row, 'mapping_state') : 'usable';
        if (!['absent', 'usable', 'unusable'].includes(mappingState)
          || (mappingState === 'absent' && canonicalId !== null)) {
          throw new Error('All-player metric mapping state is invalid.');
        }
        const sourceOnly = row.row_kind === 'partial' && normalizedProvider === 'sleeper'
          && kind === 'player' && mappingState === 'absent' && /^[1-9]\d*$/u.test(officialId);
        if (!validIdentityShape(kind, metricPosition)
          || (!sourceOnly && (mappingState !== 'usable' || canonicalId === null))) {
          rankUnavailablePositions.add(metricPosition);
          invalidIdentities.add(key);
          continue;
        }
        if (canonicalId !== null) {
          const owner = canonicalOwners.get(canonicalId);
          if (owner !== undefined && owner !== key) {
            throw new Error('Distinct all-player identities share one canonical target.');
          }
          canonicalOwners.set(canonicalId, key);
        }
        if (existingTarget !== undefined && existingTarget.canonicalId !== null && canonicalId !== null
          && existingTarget.canonicalId !== canonicalId) {
          throw new Error('All-player identities disagree across periods.');
        }
        identityTargets.set(key, { canonicalId: canonicalId ?? existingTarget?.canonicalId ?? null,
          position: metricPosition, scoringProfileId });
      }
      for (const row of rows.filter((value) => value.row_kind === 'published')) {
        const candidate = publishedCandidate(row);
        if (candidate.scoringProfileId !== profileId) {
          throw new Error('All-player metric scoring profiles disagree.');
        }
        const key = identityKey(candidate.entityKind, candidate.providerExternalId);
        if (candidates.has(key)) {
          throw new Error('All-player published identity is duplicated.');
        } else if (!invalidIdentities.has(key)) {
          candidates.set(key, candidate);
        }
      }
      let usablePartial = false;
      for (const row of rows.filter((value) => value.row_kind === 'partial')) {
        const key = identityKey(entityKind(row), rowText(row, 'provider_external_id'));
        if (!invalidIdentities.has(key)) {
          usablePartial = combinePartial(
            row, rules, candidates, invalidIdentities, rankUnavailablePositions, scorePartialStatistics,
          ) || usablePartial;
        }
      }
      for (const key of invalidIdentities) candidates.delete(key);
      const hasPublished = publishedWeekCount > 0 && publishedThroughWeek !== null
        && publishedObservedAt !== null;
      const hasPartialEvidence = partialThroughWeek !== null && partialObservedAt !== null;
      const hasAvailable = hasPublished || (usablePartial && hasPartialEvidence);
      const hasProvisional = hasAvailable && (hasPartialEvidence || missingPriorWeekCount > 0);
      return {
        status: hasProvisional ? 'provisional' : hasPublished ? 'published' : 'unavailable',
        observedAt: hasAvailable ? laterTimestamp(publishedObservedAt, partialObservedAt) : null,
        throughWeek: hasAvailable ? Math.max(partialThroughWeek ?? 0, publishedThroughWeek ?? 0) : null,
        rowsRead: rows.length,
        metrics: rankCandidates(candidates.values(), rankUnavailablePositions),
      };
    },
  };
}
