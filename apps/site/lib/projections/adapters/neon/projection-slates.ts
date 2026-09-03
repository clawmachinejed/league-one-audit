import 'server-only';

import { createHash } from 'node:crypto';
import type { DatabaseClient, DatabaseRow } from '../../../database';
import type {
  ProjectionSlateEntryInput,
  ProjectionSlateInput,
  ProjectionStore,
  StoredProjectionSlate,
} from './contracts';
import {
  deterministicUuid,
  json,
  provider,
  requiredText,
  rowNumber,
  rowObject,
  rowText,
} from './database-values';
export { PROJECTION_SLATE_NORMALIZER_VERSION } from '../../shared/projection-versions';

type ProjectionSlateMethods = Pick<
  ProjectionStore,
  'recordProjectionSlate' | 'readCurrentProjectionSlate'
>;

type NormalizedEntry = ProjectionSlateEntryInput & Readonly<{ ordinal: number }>;

function normalizedSeason(value: number): number {
  if (!Number.isInteger(value) || value < 1920 || value > 2200) {
    throw new Error('Projection slate season is invalid.');
  }
  return value;
}

function normalizedWeek(value: number): number {
  if (!Number.isInteger(value) || value < 1 || value > 18) {
    throw new Error('Projection slate week is invalid.');
  }
  return value;
}

function normalizedStrings(values: readonly string[]): string[] {
  return [...new Set(values.map((value) => requiredText(value, 'Projection slate text')))].sort();
}

function normalizedAliases(
  aliases: readonly ProjectionSlateEntryInput['aliases'][number][],
): ProjectionSlateEntryInput['aliases'] {
  const values = aliases.map((alias) => ({
    provider: provider(alias.provider),
    externalId: requiredText(alias.externalId, 'Projection slate alias ID'),
  }));
  return [...new Map(values.map((value) => [
    JSON.stringify([value.provider, value.externalId]),
    value,
  ])).values()].sort((left, right) => (
    `${left.provider}\0${left.externalId}`.localeCompare(`${right.provider}\0${right.externalId}`)
  ));
}

function normalizeEntries(entries: readonly ProjectionSlateEntryInput[]): NormalizedEntry[] {
  const normalized = entries.map((entry) => ({
    entityKind: entry.entityKind,
    providerExternalId: requiredText(entry.providerExternalId, 'Projection slate provider ID'),
    aliases: normalizedAliases(entry.aliases),
    nflTeam: entry.nflTeam ? requiredText(entry.nflTeam, 'Projection slate NFL team') : null,
    position: entry.position ? requiredText(entry.position, 'Projection slate position') : null,
    stats: entry.stats,
    scoringStats: entry.scoringStats,
    missingFields: normalizedStrings(entry.missingFields),
  }));
  normalized.sort((left, right) => (
    `${left.entityKind}\0${left.providerExternalId}`
      .localeCompare(`${right.entityKind}\0${right.providerExternalId}`)
  ));
  for (let index = 1; index < normalized.length; index += 1) {
    const previous = normalized[index - 1];
    const current = normalized[index];
    if (previous.entityKind === current.entityKind
      && previous.providerExternalId === current.providerExternalId) {
      throw new Error('Projection slate contains a duplicate provider identity.');
    }
  }
  return normalized.map((entry, ordinal) => ({ ...entry, ordinal }));
}

export function projectionSlateSemanticHash(input: ProjectionSlateInput): string {
  const entries = normalizeEntries(input.entries).map((entry) => ({
    entityKind: entry.entityKind,
    providerExternalId: entry.providerExternalId,
    aliases: entry.aliases,
    nflTeam: entry.nflTeam,
    position: entry.position,
    stats: entry.stats,
    scoringStats: entry.scoringStats,
    missingFields: entry.missingFields,
  }));
  const document = {
    provider: provider(input.provider),
    season: normalizedSeason(input.season),
    seasonType: input.seasonType,
    week: normalizedWeek(input.week),
    normalizerVersion: requiredText(input.normalizerVersion, 'Projection slate normalizer version'),
    quality: input.quality,
    coverage: input.coverage,
    warnings: normalizedStrings(input.warnings),
    entries,
  };
  return createHash('sha256').update(json(document)).digest('hex');
}

function jsonArray(row: DatabaseRow, key: string): readonly unknown[] {
  const value = row[key];
  if (Array.isArray(value)) return value;
  if (typeof value === 'string') {
    const parsed: unknown = JSON.parse(value);
    if (Array.isArray(parsed)) return parsed;
  }
  throw new Error(`Database did not return an array for ${key}.`);
}

function storedEntry(value: unknown): ProjectionSlateEntryInput {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Database returned a malformed projection slate entry.');
  }
  const row = value as Record<string, unknown>;
  const entityKind = row.entityKind;
  if (entityKind !== 'player' && entityKind !== 'team_defense') {
    throw new Error('Database returned an invalid projection slate entity kind.');
  }
  const aliases = row.aliases;
  const missingFields = row.missingFields;
  if (!Array.isArray(aliases) || !Array.isArray(missingFields)) {
    throw new Error('Database returned malformed projection slate arrays.');
  }
  return {
    entityKind,
    providerExternalId: requiredText(String(row.providerExternalId ?? ''), 'Projection slate provider ID'),
    aliases: aliases.map((alias) => {
      if (!alias || typeof alias !== 'object' || Array.isArray(alias)) {
        throw new Error('Database returned a malformed projection slate alias.');
      }
      const item = alias as Record<string, unknown>;
      return {
        provider: provider(String(item.provider ?? '')),
        externalId: requiredText(String(item.externalId ?? ''), 'Projection slate alias ID'),
      };
    }),
    nflTeam: typeof row.nflTeam === 'string' ? row.nflTeam : null,
    position: typeof row.position === 'string' ? row.position : null,
    stats: row.stats && typeof row.stats === 'object' && !Array.isArray(row.stats)
      ? row.stats as Readonly<Record<string, unknown>> : {},
    scoringStats: row.scoringStats && typeof row.scoringStats === 'object'
      && !Array.isArray(row.scoringStats)
      ? row.scoringStats as Readonly<Record<string, unknown>> : {},
    missingFields: missingFields.map(String),
  };
}

export function createProjectionSlateMethods(client: DatabaseClient): ProjectionSlateMethods {
  return {
    async recordProjectionSlate(input) {
      const normalizedProvider = provider(input.provider);
      const season = normalizedSeason(input.season);
      const week = normalizedWeek(input.week);
      const normalizerVersion = requiredText(
        input.normalizerVersion,
        'Projection slate normalizer version',
      );
      const entries = normalizeEntries(input.entries);
      const warnings = normalizedStrings(input.warnings);
      const semanticHash = projectionSlateSemanticHash({ ...input, entries, warnings });
      const contextKey = json([
        normalizedProvider,
        season,
        input.seasonType,
        week,
        normalizerVersion,
      ]);
      const contentId = deterministicUuid(
        'projection-slate-content',
        `${contextKey}\0${semanticHash}`,
      );
      const sourceRevision = requiredText(input.sourceRevision, 'Projection slate source revision');
      const observationId = deterministicUuid(
        'projection-slate-observation',
        `${contextKey}\0${sourceRevision}`,
      );
      const rows = await client.query(`/* projection-store:record-projection-slate */
        WITH context_lock AS (
          SELECT pg_advisory_xact_lock(hashtextextended($2 || ':' || $3::text || ':'
            || $4 || ':' || $5::text || ':' || $6, 0))
        ), inserted_content AS (
          INSERT INTO projection_slate_contents (
            id, provider, season, season_type, week, normalizer_version,
            semantic_hash, quality, coverage, warnings, entry_count
          )
          SELECT $1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10::jsonb, $11
          FROM context_lock
          ON CONFLICT (provider, season, season_type, week, normalizer_version, semantic_hash)
          DO NOTHING
          RETURNING *
        ), content AS (
          SELECT * FROM inserted_content
          UNION ALL
          SELECT existing.* FROM projection_slate_contents existing, context_lock
          WHERE existing.provider = $2 AND existing.season = $3
            AND existing.season_type = $4 AND existing.week = $5
            AND existing.normalizer_version = $6 AND existing.semantic_hash = $7
          LIMIT 1
        ), valid_content AS (
          SELECT * FROM content
          WHERE id = $1 AND quality = $8 AND coverage = $9::jsonb
            AND warnings = $10::jsonb AND entry_count = $11
        ), entry_input AS (
          SELECT * FROM jsonb_to_recordset($12::jsonb) AS value(
            entity_kind text, provider_external_id text, aliases jsonb,
            nfl_team text, position text, stats jsonb, scoring_stats jsonb,
            missing_fields jsonb, ordinal integer
          )
        ), existing_entry_count AS (
          SELECT count(*)::integer AS value
          FROM projection_slate_entries entry
          JOIN valid_content content ON content.id = entry.projection_slate_content_id
        ), inserted_entries AS (
          INSERT INTO projection_slate_entries (
            projection_slate_content_id, entity_kind, provider_external_id, aliases,
            nfl_team, position, stats, scoring_stats, missing_fields, ordinal
          )
          SELECT content.id, entry.entity_kind, entry.provider_external_id, entry.aliases,
            entry.nfl_team, entry.position, entry.stats, entry.scoring_stats,
            entry.missing_fields, entry.ordinal
          FROM entry_input entry CROSS JOIN valid_content content
          ON CONFLICT DO NOTHING
          RETURNING projection_slate_content_id
        ), inserted_observation AS (
          INSERT INTO projection_slate_observations (
            id, projection_slate_content_id, provider, season, season_type, week,
            normalizer_version, source_revision, request_started_at,
            request_completed_at, observed_at, quality
          )
          SELECT $13, content.id, $2, $3, $4, $5, $6, $14, $15, $16, $17, $8
          FROM valid_content content
          ON CONFLICT (provider, season, season_type, week, normalizer_version, source_revision)
          DO NOTHING
          RETURNING *
        ), observation AS (
          SELECT * FROM inserted_observation
          UNION ALL
          SELECT existing.* FROM projection_slate_observations existing, context_lock
          WHERE existing.provider = $2 AND existing.season = $3
            AND existing.season_type = $4 AND existing.week = $5
            AND existing.normalizer_version = $6 AND existing.source_revision = $14
          LIMIT 1
        ), valid_observation AS (
          SELECT observation.* FROM observation
          JOIN valid_content content ON content.id = observation.projection_slate_content_id
          WHERE observation.id = $13
            AND observation.request_started_at = $15::timestamptz
            AND observation.request_completed_at = $16::timestamptz
            AND observation.observed_at = $17::timestamptz
            AND observation.quality = $8
        ), old_pointer AS (
          SELECT current.* FROM current_projection_slates current, context_lock
          WHERE current.provider = $2 AND current.season = $3
            AND current.season_type = $4 AND current.week = $5
            AND current.normalizer_version = $6
        ), pointer AS (
          INSERT INTO current_projection_slates (
            provider, season, season_type, week, normalizer_version,
            projection_slate_observation_id, projection_slate_content_id, observed_at
          )
          SELECT $2, $3, $4, $5, $6, observation.id,
            observation.projection_slate_content_id, observation.observed_at
          FROM valid_observation observation
          LEFT JOIN old_pointer current ON true
          WHERE observation.quality = 'complete'
            AND (current.provider IS NULL OR projection_slate_pointer_may_advance(
              current.observed_at, current.projection_slate_content_id,
              observation.observed_at, observation.projection_slate_content_id
            ))
          ON CONFLICT (provider, season, season_type, week, normalizer_version)
          DO UPDATE SET
            projection_slate_observation_id = EXCLUDED.projection_slate_observation_id,
            projection_slate_content_id = EXCLUDED.projection_slate_content_id,
            observed_at = EXCLUDED.observed_at,
            verified_at = now(),
            material_changed_at = CASE
              WHEN current_projection_slates.projection_slate_content_id
                = EXCLUDED.projection_slate_content_id
              THEN current_projection_slates.material_changed_at
              ELSE now()
            END
          WHERE projection_slate_pointer_may_advance(
            current_projection_slates.observed_at,
            current_projection_slates.projection_slate_content_id,
            EXCLUDED.observed_at,
            EXCLUDED.projection_slate_content_id
          )
          RETURNING projection_slate_observation_id
        )
        SELECT observation.id AS observation_id,
          observation.projection_slate_content_id AS content_id,
          $7::text AS semantic_hash,
          (SELECT count(*) FROM inserted_entries)::integer AS entries_stored,
          $11::integer AS entry_count,
          CASE
            WHEN observation.quality <> 'complete' THEN 'ineligible'
            WHEN observation.observed_at < (SELECT observed_at FROM old_pointer)
              THEN 'superseded'
            WHEN NOT EXISTS (SELECT 1 FROM old_pointer) THEN 'advanced'
            WHEN (SELECT projection_slate_content_id FROM old_pointer) =
              observation.projection_slate_content_id THEN 'verified'
            ELSE 'advanced'
          END AS pointer_outcome,
          (SELECT value FROM existing_entry_count)
            + (SELECT count(*) FROM inserted_entries)::integer AS persisted_entry_count
        FROM valid_observation observation`, [
        contentId,
        normalizedProvider,
        season,
        input.seasonType,
        week,
        normalizerVersion,
        semanticHash,
        input.quality,
        json(input.coverage),
        json(warnings),
        entries.length,
        json(entries.map((entry) => ({
          entity_kind: entry.entityKind,
          provider_external_id: entry.providerExternalId,
          aliases: entry.aliases,
          nfl_team: entry.nflTeam,
          position: entry.position,
          stats: entry.stats,
          scoring_stats: entry.scoringStats,
          missing_fields: entry.missingFields,
          ordinal: entry.ordinal,
        }))),
        observationId,
        sourceRevision,
        input.requestStartedAt,
        input.requestCompletedAt,
        input.observedAt,
      ]);
      const row = rows[0];
      if (!row || rowNumber(row, 'persisted_entry_count') !== entries.length) {
        throw new Error('Projection slate could not be persisted consistently.');
      }
      const pointerOutcome = rowText(row, 'pointer_outcome');
      if (!['advanced', 'verified', 'superseded', 'ineligible'].includes(pointerOutcome)) {
        throw new Error('Projection slate returned an invalid pointer outcome.');
      }
      return {
        kind: 'stored',
        value: {
          observationId: rowText(row, 'observation_id'),
          contentId: rowText(row, 'content_id'),
          semanticHash: rowText(row, 'semantic_hash'),
          entriesStored: rowNumber(row, 'entries_stored'),
          entryCount: rowNumber(row, 'entry_count'),
          pointerOutcome: pointerOutcome as 'advanced' | 'verified' | 'superseded' | 'ineligible',
        },
      };
    },

    async readCurrentProjectionSlate(input) {
      const rows = await client.query(`/* projection-store:read-current-projection-slate */
        SELECT observation.id AS observation_id, content.id AS content_id,
          content.provider, content.season, content.season_type,
          content.week, content.normalizer_version, content.semantic_hash,
          observation.source_revision, observation.request_started_at::text,
          observation.request_completed_at::text, observation.observed_at::text,
          observation.quality, content.coverage, content.warnings,
          current.verified_at::text, current.material_changed_at::text,
          COALESCE(jsonb_agg(jsonb_build_object(
            'entityKind', entry.entity_kind,
            'providerExternalId', entry.provider_external_id,
            'aliases', entry.aliases,
            'nflTeam', entry.nfl_team,
            'position', entry.position,
            'stats', entry.stats,
            'scoringStats', entry.scoring_stats,
            'missingFields', entry.missing_fields
          ) ORDER BY entry.ordinal) FILTER (WHERE entry.ordinal IS NOT NULL), '[]'::jsonb) AS entries
        FROM current_projection_slates current
        JOIN projection_slate_observations observation
          ON observation.id = current.projection_slate_observation_id
        JOIN projection_slate_contents content
          ON content.id = current.projection_slate_content_id
        LEFT JOIN projection_slate_entries entry
          ON entry.projection_slate_content_id = content.id
        WHERE current.provider = $1 AND current.season = $2
          AND current.season_type = $3 AND current.week = $4
          AND current.normalizer_version = $5
        GROUP BY observation.id, content.id, current.verified_at, current.material_changed_at`, [
        provider(input.provider),
        normalizedSeason(input.season),
        input.seasonType,
        normalizedWeek(input.week),
        requiredText(input.normalizerVersion, 'Projection slate normalizer version'),
      ]);
      const row = rows[0];
      if (!row) return null;
      const warningValues = jsonArray(row, 'warnings');
      return {
        observationId: rowText(row, 'observation_id'),
        contentId: rowText(row, 'content_id'),
        provider: rowText(row, 'provider'),
        season: rowNumber(row, 'season'),
        seasonType: rowText(row, 'season_type') as StoredProjectionSlate['seasonType'],
        week: rowNumber(row, 'week'),
        normalizerVersion: rowText(row, 'normalizer_version'),
        semanticHash: rowText(row, 'semantic_hash'),
        sourceRevision: rowText(row, 'source_revision'),
        requestStartedAt: rowText(row, 'request_started_at'),
        requestCompletedAt: rowText(row, 'request_completed_at'),
        observedAt: rowText(row, 'observed_at'),
        quality: rowText(row, 'quality') as StoredProjectionSlate['quality'],
        coverage: rowObject(row, 'coverage'),
        warnings: warningValues.map(String),
        entries: jsonArray(row, 'entries').map(storedEntry),
        verifiedAt: rowText(row, 'verified_at'),
        materialChangedAt: rowText(row, 'material_changed_at'),
      };
    },
  };
}
