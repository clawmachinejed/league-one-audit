import 'server-only';

import { createHash } from 'node:crypto';
import type { DatabaseClient } from '../../../database';
import type {
  AllPlayerScore,
  AllPlayerScoreSet,
  AllPlayerStatEntry,
  AllPlayerStatObservation,
} from '../../domain/all-player-statistics';
import { validateAllPlayerEligibility } from '../../domain/all-player-eligibility';
import type { AllPlayerBatchInput, ProjectionStore } from './contracts';
import {
  deterministicUuid,
  json,
  provider,
  requiredText,
  rowNumber,
  rowText,
} from './database-values';

type AllPlayerMethods = Pick<ProjectionStore, 'recordAllPlayerBatch'>;

type NormalizedEntry = AllPlayerStatEntry & Readonly<{ ordinal: number }>;
type NormalizedScore = AllPlayerScore & Readonly<{ ordinal: number }>;
type NormalizedScoreSet = Omit<AllPlayerScoreSet, 'scores'> & Readonly<{
  scoreSetId: string;
  scores: readonly NormalizedScore[];
}>;

function season(value: number): number {
  if (!Number.isInteger(value) || value < 1920 || value > 2200) {
    throw new Error('All-player season is invalid.');
  }
  return value;
}

function week(value: number): number {
  if (!Number.isInteger(value) || value < 1 || value > 18) {
    throw new Error('All-player week is invalid.');
  }
  return value;
}

function finiteStats(stats: Readonly<Record<string, number>>): Readonly<Record<string, number>> {
  for (const [key, value] of Object.entries(stats)) {
    requiredText(key, 'All-player stat key');
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      throw new Error('All-player statistics must be finite numbers.');
    }
  }
  return stats;
}

function sortedWarnings(values: readonly string[]): string[] {
  return [...new Set(values.map((value) => requiredText(value, 'All-player warning')))].sort();
}

function record(value: unknown, label: string): Readonly<Record<string, unknown>> {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).length === 0) {
    throw new Error(`${label} must be a non-empty object.`);
  }
  return value as Readonly<Record<string, unknown>>;
}

function normalizeEntries(values: readonly AllPlayerStatEntry[]): NormalizedEntry[] {
  const entries = values.map((entry) => {
    const providerExternalId = requiredText(entry.providerExternalId, 'All-player provider ID');
    if (entry.eligibleGameCount === null !== (entry.appearanceGameCount === null)
      || (entry.eligibleGameCount !== null && entry.appearanceGameCount !== null
        && entry.appearanceGameCount > entry.eligibleGameCount)) {
      throw new Error(`All-player eligibility is inconsistent for ${providerExternalId}.`);
    }
    if (!validateAllPlayerEligibility(entry)) {
      throw new Error(`All-player eligibility evidence is invalid for ${providerExternalId}.`);
    }
    if (!['player', 'team_defense'].includes(entry.entityKind)
      || !['QB', 'RB', 'WR', 'TE', 'K', 'DEF'].includes(entry.position)
      || (entry.entityKind === 'team_defense') !== (entry.position === 'DEF')
      || !['live', 'final', 'unknown'].includes(entry.gamePhase)) {
      throw new Error(`All-player classification is invalid for ${providerExternalId}.`);
    }
    record(entry.eligibilityEvidence, `All-player eligibility evidence for ${providerExternalId}`);
    return {
      ...entry,
      providerExternalId,
      nflGameId: entry.nflGameId ? requiredText(entry.nflGameId, 'All-player NFL game ID') : null,
      nflTeam: entry.nflTeam ? requiredText(entry.nflTeam, 'All-player NFL team') : null,
      stats: finiteStats(entry.stats),
      eligibilityEvidence: entry.eligibilityEvidence,
    };
  }).sort((left, right) => (
    `${left.entityKind}\0${left.providerExternalId}`
      .localeCompare(`${right.entityKind}\0${right.providerExternalId}`)
  ));
  for (let index = 1; index < entries.length; index += 1) {
    if (entries[index - 1].entityKind === entries[index].entityKind
      && entries[index - 1].providerExternalId === entries[index].providerExternalId) {
      throw new Error('All-player statistics contain a duplicate provider identity.');
    }
  }
  return entries.map((entry, ordinal) => ({ ...entry, ordinal }));
}

export function allPlayerStatSemanticHash(
  observation: AllPlayerStatObservation,
  entries = normalizeEntries(observation.entries),
): string {
  return createHash('sha256').update(json({
    provider: provider(observation.provider),
    season: season(observation.season),
    seasonType: observation.seasonType,
    week: week(observation.week),
    normalizerVersion: requiredText(observation.normalizerVersion, 'All-player normalizer version'),
    quality: observation.quality,
    coverage: observation.coverage,
    warnings: sortedWarnings(observation.warnings),
    entries: entries.map((entry) => {
      const { ordinal, ...value } = entry;
      void ordinal;
      return value;
    }),
  })).digest('hex');
}

function normalizeScores(
  entries: readonly NormalizedEntry[],
  values: readonly AllPlayerScore[],
): NormalizedScore[] {
  const entryKeys = new Set(entries.map((entry) => (
    `${entry.entityKind}\0${entry.providerExternalId}`
  )));
  const scores = values.map((score) => {
    const providerExternalId = requiredText(score.providerExternalId, 'All-player score provider ID');
    if (!entryKeys.has(`${score.entityKind}\0${providerExternalId}`)) {
      throw new Error(`All-player score has no matching raw entry: ${providerExternalId}.`);
    }
    if (!Number.isFinite(score.fantasyPoints)) throw new Error('All-player points must be finite.');
    if (score.appearanceGameCount !== null
      && score.appearanceGameCount > score.eligibleGameCount) {
      throw new Error(`All-player score eligibility is inconsistent for ${providerExternalId}.`);
    }
    if ((score.appearanceGameCount === 0 || score.eligibleGameCount === 0)
      && score.fantasyPoints !== 0) {
      throw new Error(`A non-appearing or ineligible entity must have zero points: ${providerExternalId}.`);
    }
    return { ...score, providerExternalId };
  }).sort((left, right) => (
    `${left.entityKind}\0${left.providerExternalId}`
      .localeCompare(`${right.entityKind}\0${right.providerExternalId}`)
  ));
  if (new Set(scores.map((score) => score.scoringEntityId)).size !== scores.length) {
    throw new Error('All-player scores contain a duplicate canonical identity.');
  }
  return scores.map((score, ordinal) => ({ ...score, ordinal }));
}

export function allPlayerScoreSemanticHash(
  scoreSet: Pick<AllPlayerScoreSet, 'scoringProfileId' | 'scoringRulesHash' | 'scorerVersion'>,
  scores: readonly AllPlayerScore[],
): string {
  return createHash('sha256').update(json({
    scoringProfileId: scoreSet.scoringProfileId,
    scoringRulesHash: scoreSet.scoringRulesHash,
    scorerVersion: scoreSet.scorerVersion,
    scores: scores.map((score) => {
      const { ...value } = score;
      return value;
    }),
  })).digest('hex');
}

function normalizeScoreSets(
  contentId: string,
  entries: readonly NormalizedEntry[],
  scoreSets: readonly AllPlayerScoreSet[],
): NormalizedScoreSet[] {
  const profileIds = new Set<string>();
  return scoreSets.map((scoreSet) => {
    const scoringProfileId = requiredText(scoreSet.scoringProfileId, 'Scoring profile ID');
    if (profileIds.has(scoringProfileId)) throw new Error('All-player scoring profile is duplicated.');
    profileIds.add(scoringProfileId);
    if (!/^[0-9a-f]{64}$/u.test(scoreSet.scoringRulesHash)
      || scoreSet.coverage.scoring_rules_hash !== scoreSet.scoringRulesHash) {
      throw new Error('All-player scoring rules hash is invalid.');
    }
    const scorerVersion = requiredText(scoreSet.scorerVersion, 'All-player scorer version');
    const scores = normalizeScores(entries, scoreSet.scores);
    const semanticHash = allPlayerScoreSemanticHash(
      { scoringProfileId, scoringRulesHash: scoreSet.scoringRulesHash, scorerVersion },
      scores.map((score) => {
        const { ordinal, ...value } = score;
        void ordinal;
        return value;
      }),
    );
    if (semanticHash !== scoreSet.semanticHash) {
      throw new Error('All-player score set semantic hash is invalid.');
    }
    if (scoreSet.scoredEntityCount !== scores.length
      || scoreSet.scoredEntityCount !== entries.length
      || scoreSet.eligibleGameCount !== scores.reduce(
        (total, score) => total + score.eligibleGameCount, 0,
      )) throw new Error('All-player score set counts are invalid.');
    if (scoreSet.quality !== 'complete'
      || scoreSet.parityComparisonCount < 1
      || scoreSet.parityMismatchCount !== 0) {
      throw new Error('All-player score set parity is invalid.');
    }
    if (scoreSet.coverage.complete !== true
      || scoreSet.coverage.identity_complete !== true
      || scoreSet.coverage.scoring_rules_complete !== true
      || scoreSet.coverage.parity_expected_entity_count !== scoreSet.parityComparisonCount
      || !Array.isArray(scoreSet.coverage.parity_observation_ids)
      || scoreSet.coverage.parity_observation_ids.length === 0
      || new Set(scoreSet.coverage.parity_observation_ids).size
        !== scoreSet.coverage.parity_observation_ids.length
      || scoreSet.coverage.parity_observation_ids.some((id) => (
        typeof id !== 'string'
        || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(id)
      ))
      || typeof scoreSet.coverage.parity_fingerprint !== 'string'
      || !/^sha256:[0-9a-f]{64}$/u.test(scoreSet.coverage.parity_fingerprint)
      || typeof scoreSet.coverage.score_batch_fingerprint !== 'string'
      || !/^sha256:[0-9a-f]{64}$/u.test(scoreSet.coverage.score_batch_fingerprint)
      || !Array.isArray(scoreSet.coverage.expected_scoring_profile_ids)
      || !scoreSet.coverage.parity_observation_evidence
      || typeof scoreSet.coverage.parity_observation_evidence !== 'object'
      || Array.isArray(scoreSet.coverage.parity_observation_evidence)) {
      throw new Error('All-player score set coverage is invalid.');
    }
    const observationIds = [...scoreSet.coverage.parity_observation_ids as string[]].sort();
    const parityEvidence = scoreSet.coverage.parity_observation_evidence as Record<string, unknown>;
    if (json(Object.keys(parityEvidence).sort()) !== json(observationIds)
      || Object.values(parityEvidence).some((value) => {
        if (!value || typeof value !== 'object' || Array.isArray(value)) return true;
        const evidence = value as Record<string, unknown>;
        return evidence.version !== 'players-points-v1'
          || !Number.isInteger(evidence.expectedEntityCount)
          || Number(evidence.expectedEntityCount) < 1
          || !Number.isInteger(evidence.expectedRosterCount)
          || Number(evidence.expectedRosterCount) < 1
          || !Array.isArray(evidence.expectedRosterIds)
          || evidence.expectedRosterIds.length !== evidence.expectedRosterCount
          || evidence.expectedRosterIds.some((id) => typeof id !== 'string' || !id.trim())
          || new Set(evidence.expectedRosterIds).size !== evidence.expectedRosterIds.length
          || json([...evidence.expectedRosterIds].sort()) !== json(evidence.expectedRosterIds)
          || typeof evidence.fingerprint !== 'string'
          || !/^sha256:[0-9a-f]{64}$/u.test(evidence.fingerprint);
      })) {
      throw new Error('All-player official parity evidence is invalid.');
    }
    return {
      ...scoreSet,
      scoringProfileId,
      scorerVersion,
      semanticHash,
      warnings: sortedWarnings(scoreSet.warnings),
      scoreSetId: deterministicUuid(
        'all-player-score-set',
        `${contentId}\0${scoringProfileId}\0${scorerVersion}\0${semanticHash}`,
      ),
      scores,
    };
  }).sort((left, right) => left.scoringProfileId.localeCompare(right.scoringProfileId));
}

export function createAllPlayerStatisticMethods(client: DatabaseClient): AllPlayerMethods {
  return {
    async recordAllPlayerBatch(input: AllPlayerBatchInput) {
      const observation = input.observation;
      const normalizedProvider = provider(observation.provider);
      const normalizedSeason = season(observation.season);
      const normalizedWeek = week(observation.week);
      const normalizerVersion = requiredText(
        observation.normalizerVersion,
        'All-player normalizer version',
      );
      const sourceRevision = requiredText(observation.sourceRevision, 'All-player source revision');
      const entries = normalizeEntries(observation.entries);
      if (entries.length === 0) throw new Error('All-player observations must contain entries.');
      if (observation.quality === 'complete' && entries.some((entry) => (
        entry.eligibleGameCount === null || entry.appearanceGameCount === null
      ))) {
        throw new Error('A complete all-player observation requires complete eligibility.');
      }
      const warnings = sortedWarnings(observation.warnings);
      const semanticHash = allPlayerStatSemanticHash(observation, entries);
      const contextKey = json([
        normalizedProvider, normalizedSeason, observation.seasonType,
        normalizedWeek, normalizerVersion,
      ]);
      const contentId = deterministicUuid(
        'all-player-stat-content',
        `${contextKey}\0${semanticHash}`,
      );
      const observationId = deterministicUuid(
        'all-player-stat-observation',
        `${contextKey}\0${sourceRevision}\0${observation.observedAt}`,
      );
      const scoreSets = normalizeScoreSets(contentId, entries, input.scoreSets);
      if (scoreSets.length > 0) {
        const actualProfileIds = scoreSets.map((scoreSet) => scoreSet.scoringProfileId);
        const expectedProfileIds = scoreSets[0].coverage.expected_scoring_profile_ids;
        const batchFingerprint = scoreSets[0].coverage.score_batch_fingerprint;
        if (!Array.isArray(expectedProfileIds)
          || json(expectedProfileIds) !== json(actualProfileIds)
          || scoreSets.some((scoreSet) => (
            json(scoreSet.coverage.expected_scoring_profile_ids) !== json(expectedProfileIds)
            || scoreSet.coverage.score_batch_fingerprint !== batchFingerprint
            || scoreSet.scorerVersion !== scoreSets[0].scorerVersion
          ))) {
          throw new Error('All-player batch does not contain its exact scoring profile inventory.');
        }
      }
      if (scoreSets.length > 0) {
        const actualProfileIds = scoreSets.map((scoreSet) => scoreSet.scoringProfileId).sort();
        const expectedProfileIds = scoreSets[0].coverage.expected_scoring_profile_ids;
        const batchFingerprint = scoreSets[0].coverage.score_batch_fingerprint;
        if (!Array.isArray(expectedProfileIds)
          || expectedProfileIds.some((id) => typeof id !== 'string')
          || json(actualProfileIds) !== json(expectedProfileIds)
          || scoreSets.some((scoreSet) => (
            scoreSet.scorerVersion !== scoreSets[0].scorerVersion
            || scoreSet.coverage.score_batch_fingerprint !== batchFingerprint
            || json(scoreSet.coverage.expected_scoring_profile_ids) !== json(expectedProfileIds)
          ))) {
          throw new Error('All-player score set batch is incomplete.');
        }
      }
      if (scoreSets.length > 0 && observation.quality !== 'complete') {
        throw new Error('A partial all-player observation cannot publish score sets.');
      }
      if (scoreSets.length > 0 && observation.coverage.complete !== true) {
        throw new Error('An incomplete all-player observation cannot publish score sets.');
      }
      const scoreRows = scoreSets.flatMap((scoreSet) => scoreSet.scores.map((score) => ({
        score_set_id: scoreSet.scoreSetId,
        content_id: contentId,
        scoring_entity_id: score.scoringEntityId,
        entity_kind: score.entityKind,
        provider_external_id: score.providerExternalId,
        nfl_game_id: score.nflGameId,
        nfl_team: score.nflTeam,
        position: score.position,
        fantasy_points: score.fantasyPoints,
        eligible_game_count: score.eligibleGameCount,
        appearance_game_count: score.appearanceGameCount,
        game_phase: score.gamePhase,
        scoring_breakdown: score.scoringBreakdown,
        ordinal: score.ordinal,
      })));
      const rows = await client.query(`/* projection-store:record-all-player-batch */
        WITH context_lock AS (
          SELECT pg_advisory_xact_lock(hashtextextended($2 || ':' || $3::smallint::text || ':'
            || $4 || ':' || $5::smallint::text || ':' || $6, 0))
        ), inserted_content AS (
          INSERT INTO all_player_stat_contents (
            id, provider, season, season_type, week, normalizer_version,
            semantic_hash, quality, coverage, warnings, entry_count
          )
          SELECT $1, $2, $3::smallint, $4, $5::smallint, $6,
            $7, $8, $9::jsonb, $10::jsonb, $11
          FROM context_lock
          ON CONFLICT (provider, season, season_type, week, normalizer_version, semantic_hash)
          DO NOTHING RETURNING *
        ), content AS (
          SELECT * FROM inserted_content
          UNION ALL
          SELECT existing.* FROM all_player_stat_contents existing, context_lock
          WHERE existing.provider = $2 AND existing.season = $3::smallint
            AND existing.season_type = $4 AND existing.week = $5::smallint
            AND existing.normalizer_version = $6 AND existing.semantic_hash = $7
          LIMIT 1
        ), valid_content AS (
          SELECT * FROM content WHERE id = $1 AND quality = $8
            AND coverage = $9::jsonb AND warnings = $10::jsonb AND entry_count = $11
        ), entry_input AS (
          SELECT * FROM jsonb_to_recordset($12::jsonb) AS value(
            entity_kind text, provider_external_id text, nfl_game_id uuid,
            nfl_team text, position text, stats jsonb, eligibility_evidence jsonb,
            eligible_game_count smallint, appearance_game_count smallint,
            game_phase text, ordinal integer
          )
        ), prior_entry_count AS (
          SELECT count(*)::integer AS value FROM all_player_stat_entries entry
          JOIN valid_content content ON content.id = entry.all_player_stat_content_id
        ), inserted_entries AS (
          INSERT INTO all_player_stat_entries (
            all_player_stat_content_id, entity_kind, provider_external_id,
            nfl_game_id, nfl_team, position, stats, eligibility_evidence,
            eligible_game_count, appearance_game_count, game_phase, ordinal
          )
          SELECT content.id, entry.entity_kind, entry.provider_external_id,
            entry.nfl_game_id, entry.nfl_team, entry.position, entry.stats,
            entry.eligibility_evidence, entry.eligible_game_count,
            entry.appearance_game_count, entry.game_phase, entry.ordinal
          FROM entry_input entry CROSS JOIN valid_content content
          ON CONFLICT DO NOTHING RETURNING all_player_stat_content_id
        ), inserted_observation AS (
          INSERT INTO all_player_stat_observations (
            id, all_player_stat_content_id, provider, season, season_type, week,
            normalizer_version, source_revision, request_started_at,
            request_completed_at, observed_at, quality
          )
          SELECT $13, content.id, $2, $3::smallint, $4, $5::smallint, $6,
            $14, $15::timestamptz, $16::timestamptz, $17::timestamptz, $8
          FROM valid_content content
          ON CONFLICT (
            provider, season, season_type, week, normalizer_version, source_revision, observed_at
          ) DO NOTHING RETURNING *
        ), observation AS (
          SELECT * FROM inserted_observation
          UNION ALL
          SELECT existing.* FROM all_player_stat_observations existing, context_lock
          WHERE existing.provider = $2 AND existing.season = $3::smallint
            AND existing.season_type = $4 AND existing.week = $5::smallint
            AND existing.normalizer_version = $6 AND existing.source_revision = $14
            AND existing.observed_at = $17::timestamptz
          LIMIT 1
        ), valid_observation AS (
          SELECT observation.* FROM observation JOIN valid_content content
            ON content.id = observation.all_player_stat_content_id
          WHERE observation.id = $13
            AND observation.request_started_at = $15::timestamptz
            AND observation.request_completed_at = $16::timestamptz
            AND observation.quality = $8
        ), score_set_input AS (
          SELECT * FROM jsonb_to_recordset($18::jsonb) AS value(
            id uuid, scoring_profile_id uuid, scorer_version text, semantic_hash text,
            quality text, scored_entity_count integer, eligible_game_count integer,
            parity_comparison_count integer, parity_mismatch_count integer,
            coverage jsonb, warnings jsonb
          )
        ), inserted_score_sets AS (
          INSERT INTO all_player_score_sets (
            id, all_player_stat_content_id, provider, season, season_type, week,
            scoring_profile_id, scorer_version, semantic_hash, quality,
            scored_entity_count, eligible_game_count, parity_comparison_count,
            parity_mismatch_count, coverage, warnings
          )
          SELECT input.id, content.id, $2, $3::smallint, $4, $5::smallint,
            input.scoring_profile_id, input.scorer_version, input.semantic_hash,
            input.quality, input.scored_entity_count, input.eligible_game_count,
            input.parity_comparison_count, input.parity_mismatch_count,
            input.coverage, input.warnings
          FROM score_set_input input CROSS JOIN valid_content content
          ON CONFLICT (
            all_player_stat_content_id, scoring_profile_id, scorer_version, semantic_hash
          ) DO NOTHING RETURNING *
        ), score_sets AS (
          SELECT * FROM inserted_score_sets
          UNION ALL
          SELECT existing.* FROM all_player_score_sets existing
          JOIN score_set_input input ON input.id = existing.id
          WHERE NOT EXISTS (
            SELECT 1 FROM inserted_score_sets inserted WHERE inserted.id = existing.id
          )
        ), valid_score_sets AS (
          SELECT stored.* FROM score_sets stored JOIN score_set_input input ON input.id = stored.id
          JOIN valid_content content ON content.id = stored.all_player_stat_content_id
          WHERE stored.provider = $2 AND stored.season = $3::smallint
            AND stored.season_type = $4 AND stored.week = $5::smallint
            AND stored.scoring_profile_id = input.scoring_profile_id
            AND stored.scorer_version = input.scorer_version
            AND stored.semantic_hash = input.semantic_hash AND stored.quality = input.quality
            AND stored.scored_entity_count = input.scored_entity_count
            AND stored.eligible_game_count = input.eligible_game_count
            AND stored.parity_comparison_count = input.parity_comparison_count
            AND stored.parity_mismatch_count = input.parity_mismatch_count
            AND stored.coverage = input.coverage AND stored.warnings = input.warnings
        ), score_input AS (
          SELECT * FROM jsonb_to_recordset($19::jsonb) AS value(
            score_set_id uuid, content_id uuid, scoring_entity_id uuid,
            entity_kind text, provider_external_id text, nfl_game_id uuid,
            nfl_team text, position text, fantasy_points numeric,
            eligible_game_count smallint, appearance_game_count smallint,
            game_phase text, scoring_breakdown jsonb, ordinal integer
          )
        ), prior_score_count AS (
          SELECT count(*)::integer AS value FROM all_player_scores score
          JOIN valid_score_sets score_set ON score_set.id = score.all_player_score_set_id
        ), inserted_scores AS (
          INSERT INTO all_player_scores (
            all_player_score_set_id, all_player_stat_content_id, scoring_entity_id,
            entity_kind, provider_external_id, nfl_game_id, nfl_team, position,
            fantasy_points, eligible_game_count, appearance_game_count, game_phase,
            scoring_breakdown, ordinal
          )
          SELECT input.score_set_id, input.content_id, input.scoring_entity_id,
            input.entity_kind, input.provider_external_id, input.nfl_game_id,
            input.nfl_team, input.position, input.fantasy_points,
            input.eligible_game_count, input.appearance_game_count, input.game_phase,
            input.scoring_breakdown, input.ordinal
          FROM score_input input JOIN valid_score_sets score_set
            ON score_set.id = input.score_set_id
            AND score_set.all_player_stat_content_id = input.content_id
          ON CONFLICT DO NOTHING RETURNING all_player_score_set_id
        ), valid_batch AS (
          SELECT observation.id FROM valid_observation observation
          WHERE (SELECT value FROM prior_entry_count)
              + (SELECT count(*) FROM inserted_entries) = $11
            AND (SELECT count(*) FROM valid_score_sets)
              = jsonb_array_length($18::jsonb)
            AND (SELECT value FROM prior_score_count)
              + (SELECT count(*) FROM inserted_scores) = jsonb_array_length($19::jsonb)
        ), batch_assertion AS MATERIALIZED (
          SELECT 1 / count(*)::integer AS valid FROM valid_batch
        ), pointers AS (
          SELECT score_set.id AS score_set_id, score_set.scoring_profile_id,
            public.advance_current_all_player_score_set(
              $2, $3::smallint, $4, $5::smallint, score_set.scoring_profile_id,
              score_set.scorer_version, observation.id, score_set.id, $20::timestamptz
            ) AS pointer_outcome
          FROM valid_score_sets score_set CROSS JOIN valid_observation observation
          CROSS JOIN valid_batch CROSS JOIN batch_assertion
        )
        SELECT (SELECT observation.id FROM valid_observation observation) AS observation_id,
          (SELECT observation.all_player_stat_content_id
            FROM valid_observation observation) AS content_id,
          $7::text AS semantic_hash,
          (SELECT count(*) FROM inserted_entries)::integer AS entries_stored,
          $11::integer AS entry_count,
          COALESCE((SELECT jsonb_agg(jsonb_build_object(
            'scoreSetId', pointer.score_set_id,
            'scoringProfileId', pointer.scoring_profile_id,
            'pointerOutcome', pointer.pointer_outcome
          ) ORDER BY pointer.scoring_profile_id) FROM pointers pointer), '[]'::jsonb) AS pointers
        FROM batch_assertion`, [
        contentId,
        normalizedProvider,
        normalizedSeason,
        observation.seasonType,
        normalizedWeek,
        normalizerVersion,
        semanticHash,
        observation.quality,
        json(observation.coverage),
        json(warnings),
        entries.length,
        json(entries.map((entry) => ({
          entity_kind: entry.entityKind,
          provider_external_id: entry.providerExternalId,
          nfl_game_id: entry.nflGameId,
          nfl_team: entry.nflTeam,
          position: entry.position,
          stats: entry.stats,
          eligibility_evidence: entry.eligibilityEvidence,
          eligible_game_count: entry.eligibleGameCount,
          appearance_game_count: entry.appearanceGameCount,
          game_phase: entry.gamePhase,
          ordinal: entry.ordinal,
        }))),
        observationId,
        sourceRevision,
        observation.requestStartedAt,
        observation.requestCompletedAt,
        observation.observedAt,
        json(scoreSets.map((scoreSet) => ({
          id: scoreSet.scoreSetId,
          scoring_profile_id: scoreSet.scoringProfileId,
          scorer_version: scoreSet.scorerVersion,
          semantic_hash: scoreSet.semanticHash,
          quality: scoreSet.quality,
          scored_entity_count: scoreSet.scoredEntityCount,
          eligible_game_count: scoreSet.eligibleGameCount,
          parity_comparison_count: scoreSet.parityComparisonCount,
          parity_mismatch_count: scoreSet.parityMismatchCount,
          coverage: scoreSet.coverage,
          warnings: scoreSet.warnings,
        }))),
        json(scoreRows),
        input.verifiedAt,
      ]);
      const row = rows[0];
      if (!row) throw new Error('All-player batch could not be persisted consistently.');
      const pointerValue = row.pointers;
      const pointers: unknown = typeof pointerValue === 'string'
        ? JSON.parse(pointerValue) : pointerValue;
      if (!Array.isArray(pointers)) throw new Error('All-player pointer results were malformed.');
      const storedScoreSets = pointers.map((value) => {
        if (!value || typeof value !== 'object' || Array.isArray(value)) {
          throw new Error('All-player pointer result was malformed.');
        }
        const pointer = value as Record<string, unknown>;
        const pointerOutcome = String(pointer.pointerOutcome ?? '');
        if (!['advanced', 'verified', 'superseded'].includes(pointerOutcome)) {
          throw new Error('All-player pointer outcome was invalid.');
        }
        return {
          scoreSetId: requiredText(String(pointer.scoreSetId ?? ''), 'All-player score set ID'),
          scoringProfileId: requiredText(
            String(pointer.scoringProfileId ?? ''),
            'All-player scoring profile ID',
          ),
          pointerOutcome: pointerOutcome as 'advanced' | 'verified' | 'superseded',
        };
      });
      if (storedScoreSets.length !== scoreSets.length) {
        throw new Error('All-player score set pointers were incomplete.');
      }
      return {
        kind: 'stored',
        value: {
          statContentId: rowText(row, 'content_id'),
          statObservationId: rowText(row, 'observation_id'),
          semanticHash: rowText(row, 'semantic_hash'),
          entriesStored: rowNumber(row, 'entries_stored'),
          entryCount: rowNumber(row, 'entry_count'),
          scoreSets: storedScoreSets,
        },
      };
    },
  };
}
