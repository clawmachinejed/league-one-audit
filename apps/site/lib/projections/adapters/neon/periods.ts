import 'server-only';

import { matchupSnapshotSelectionSql } from './matchup-selection-sql';

import type { DatabaseClient } from '../../../database';
import type {
  LeaguePeriodAuthorityInput,
  PeriodAuthorityWriteOutcome,
  ProjectionStore,
} from './contracts';
import { provider, requiredText, rowText } from './database-values';
import { snapshotFromRow } from './snapshot-codec';
import { normalizeAuthorityLineupShape } from './period-shape';
import { normalizePeriodCadenceTiming } from './period-cadence-values';
import { authorityFromRow, futureFreshnessFromRow, projectionIdentityValues, wholeNumber, member, timestamp, SEASON_TYPES, LIFECYCLES, NFL_PHASES } from './period-values';

type PeriodMethods = Pick<ProjectionStore,
  'upsertLeaguePeriodAuthority' | 'readMatchupSnapshotByLeagueKey'
>;

function validateInput(input: LeaguePeriodAuthorityInput): readonly unknown[] {
  if (input.defaultPeriodCadence !== undefined && input.lineupShape === undefined) {
    throw new Error('Period cadence requires authoritative lineup shape.');
  }
  const defaultSeason = wholeNumber(input.defaultSeason, 1920, 2200, 'Default season');
  const defaultWeek = wholeNumber(input.defaultWeek, 1, 18, 'Default week');
  const activeValues = [input.activeSeason, input.activeSeasonType, input.activeWeek];
  const activeCount = activeValues.filter((value) => value !== null).length;
  if (activeCount !== 0 && activeCount !== activeValues.length) {
    throw new Error('Active scoring period must be complete or absent.');
  }
  if ((input.leagueLifecycle === 'active') !== (activeCount === activeValues.length)) {
    throw new Error('Active lifecycle requires an active scoring period.');
  }
  const activeSeason = input.activeSeason === null
    ? null : wholeNumber(input.activeSeason, 1920, 2200, 'Active season');
  const activeWeek = input.activeWeek === null
    ? null : wholeNumber(input.activeWeek, 1, 18, 'Active week');
  const observedAt = timestamp(input.sourceObservedAt, 'Period source observation time');
  const verifiedAt = timestamp(input.verifiedAt, 'Period verification time');
  if (Date.parse(verifiedAt) < Date.parse(observedAt)) {
    throw new Error('Period verification cannot precede its source observation.');
  }
  return [
    requiredText(input.leagueKey, 'League key'),
    defaultSeason,
    member(input.defaultSeasonType, SEASON_TYPES, 'default season type'),
    defaultWeek,
    activeSeason,
    input.activeSeasonType === null
      ? null : member(input.activeSeasonType, SEASON_TYPES, 'active season type'),
    activeWeek,
    member(input.leagueLifecycle, LIFECYCLES, 'league lifecycle'),
    member(input.nflPhase, NFL_PHASES, 'NFL phase'),
    provider(input.sourceProvider),
    requiredText(input.sourceRevision, 'Period source revision'),
    observedAt,
    verifiedAt,
    input.lineupShape ? JSON.stringify({ ...normalizeAuthorityLineupShape(input.lineupShape),
      ...(input.defaultPeriodCadence ? { defaultPeriodCadence: normalizePeriodCadenceTiming(input.defaultPeriodCadence) } : {}),
    }) : null,
  ];
}

export function createPeriodMethods(client: DatabaseClient): PeriodMethods {
  return {
    async upsertLeaguePeriodAuthority(input): Promise<PeriodAuthorityWriteOutcome> {
      const parameters = validateInput(input);
      const rows = await client.query(`/* projection-store:upsert-league-period-authority */
        WITH incoming AS (
          SELECT $1::text AS league_key, $2::smallint AS default_season,
            $3::text AS default_season_type, $4::smallint AS default_week,
            $5::smallint AS active_season, $6::text AS active_season_type,
            $7::smallint AS active_week, $8::text AS league_lifecycle,
            $9::text AS nfl_phase, $10::text AS source_provider,
            $11::text AS source_revision, $12::timestamptz AS source_observed_at,
            $13::timestamptz AS verified_at,
            $14::jsonb->>'sourceExternalLeagueId' AS source_external_league_id,
            ($14::jsonb->>'expectedRosterCount')::integer AS expected_roster_count,
            ($14::jsonb->>'expectedStarterSlotCount')::integer AS expected_starter_slot_count,
            CASE WHEN $14::jsonb IS NULL THEN NULL ELSE ARRAY(
              SELECT jsonb_array_elements_text($14::jsonb->'expectedRosterIds')
            ) END AS expected_roster_ids,
            $14::jsonb->'defaultPeriodCadence' AS default_period_cadence
        ), upserted AS (
          INSERT INTO league_period_authorities (
            league_key, default_season, default_season_type, default_week,
            active_season, active_season_type, active_week, league_lifecycle,
            nfl_phase, source_provider, source_revision, source_observed_at, verified_at,
            source_external_league_id, expected_roster_count, expected_starter_slot_count,
            expected_roster_ids, default_period_cadence
          ) SELECT league_key, default_season, default_season_type, default_week,
              active_season, active_season_type, active_week, league_lifecycle,
              nfl_phase, source_provider, source_revision, source_observed_at, verified_at,
              source_external_league_id, expected_roster_count, expected_starter_slot_count,
              expected_roster_ids, default_period_cadence
            FROM incoming
          ON CONFLICT (league_key) DO UPDATE SET
            default_season = EXCLUDED.default_season,
            default_season_type = EXCLUDED.default_season_type,
            default_week = EXCLUDED.default_week,
            active_season = EXCLUDED.active_season,
            active_season_type = EXCLUDED.active_season_type,
            active_week = EXCLUDED.active_week,
            league_lifecycle = EXCLUDED.league_lifecycle,
            nfl_phase = EXCLUDED.nfl_phase,
            source_provider = EXCLUDED.source_provider,
            source_revision = EXCLUDED.source_revision,
            source_observed_at = EXCLUDED.source_observed_at,
            verified_at = GREATEST(league_period_authorities.verified_at, EXCLUDED.verified_at),
            source_external_league_id = COALESCE(EXCLUDED.source_external_league_id, league_period_authorities.source_external_league_id),
            expected_roster_count = COALESCE(EXCLUDED.expected_roster_count, league_period_authorities.expected_roster_count),
            expected_starter_slot_count = COALESCE(EXCLUDED.expected_starter_slot_count, league_period_authorities.expected_starter_slot_count),
            expected_roster_ids = COALESCE(EXCLUDED.expected_roster_ids, league_period_authorities.expected_roster_ids),
            default_period_cadence = COALESCE(EXCLUDED.default_period_cadence, league_period_authorities.default_period_cadence),
            authority_generation = league_period_authorities.authority_generation + CASE WHEN ROW(
              league_period_authorities.default_season, league_period_authorities.default_season_type,
              league_period_authorities.default_week, league_period_authorities.active_season,
              league_period_authorities.active_season_type, league_period_authorities.active_week,
              league_period_authorities.league_lifecycle, league_period_authorities.source_provider,
              league_period_authorities.source_external_league_id, league_period_authorities.expected_roster_count,
              league_period_authorities.expected_starter_slot_count, league_period_authorities.expected_roster_ids
            ) IS DISTINCT FROM ROW(
              EXCLUDED.default_season, EXCLUDED.default_season_type, EXCLUDED.default_week,
              EXCLUDED.active_season, EXCLUDED.active_season_type, EXCLUDED.active_week,
              EXCLUDED.league_lifecycle, EXCLUDED.source_provider,
              COALESCE(EXCLUDED.source_external_league_id, league_period_authorities.source_external_league_id),
              COALESCE(EXCLUDED.expected_roster_count, league_period_authorities.expected_roster_count),
              COALESCE(EXCLUDED.expected_starter_slot_count, league_period_authorities.expected_starter_slot_count),
              COALESCE(EXCLUDED.expected_roster_ids, league_period_authorities.expected_roster_ids)
            ) THEN 1 ELSE 0 END,
            updated_at = now()
          WHERE (EXCLUDED.source_observed_at > league_period_authorities.source_observed_at
            OR (
              EXCLUDED.source_observed_at = league_period_authorities.source_observed_at
              AND EXCLUDED.source_revision = league_period_authorities.source_revision
              AND EXCLUDED.verified_at > league_period_authorities.verified_at
              AND (EXCLUDED.source_external_league_id IS NULL OR ROW(
                EXCLUDED.source_external_league_id, EXCLUDED.expected_roster_count,
                EXCLUDED.expected_starter_slot_count, EXCLUDED.expected_roster_ids
              ) IS NOT DISTINCT FROM ROW(
                league_period_authorities.source_external_league_id, league_period_authorities.expected_roster_count,
                league_period_authorities.expected_starter_slot_count, league_period_authorities.expected_roster_ids
              ))
            )) AND (
              EXCLUDED.source_provider <> league_period_authorities.source_provider
              OR (EXCLUDED.source_external_league_id IS NOT NULL
                AND league_period_authorities.source_external_league_id IS NOT NULL
                AND EXCLUDED.source_external_league_id <> league_period_authorities.source_external_league_id)
              OR EXCLUDED.default_season > league_period_authorities.default_season
              OR (EXCLUDED.default_season = league_period_authorities.default_season
                AND EXCLUDED.default_season_type = league_period_authorities.default_season_type
                AND EXCLUDED.default_week >= league_period_authorities.default_week
                AND array_position(ARRAY['preseason','active','complete'], EXCLUDED.league_lifecycle)
                  >= array_position(ARRAY['preseason','active','complete'], league_period_authorities.league_lifecycle)
                AND (EXCLUDED.active_week IS NULL OR league_period_authorities.active_week IS NULL
                  OR EXCLUDED.active_week >= league_period_authorities.active_week))
            )
          RETURNING *, 'stored'::text AS result_kind
        ), selected AS (
          SELECT * FROM upserted
          UNION ALL
          SELECT existing.*,
            CASE
              WHEN existing.source_observed_at > incoming.source_observed_at THEN 'ignored'
              WHEN existing.source_observed_at = incoming.source_observed_at
                AND existing.source_revision <> incoming.source_revision THEN 'conflict'
              WHEN existing.source_observed_at < incoming.source_observed_at THEN 'conflict'
              WHEN incoming.source_external_league_id IS NOT NULL AND ROW(
                existing.source_external_league_id, existing.expected_roster_count,
                existing.expected_starter_slot_count, existing.expected_roster_ids
              ) IS DISTINCT FROM ROW(
                incoming.source_external_league_id, incoming.expected_roster_count,
                incoming.expected_starter_slot_count, incoming.expected_roster_ids
              ) THEN 'conflict'
              ELSE 'verified'
            END AS result_kind
          FROM league_period_authorities existing
          CROSS JOIN incoming
          WHERE existing.league_key = incoming.league_key
            AND NOT EXISTS (SELECT 1 FROM upserted)
          LIMIT 1
        )
        SELECT league_key, default_season, default_season_type, default_week,
          active_season, active_season_type, active_week, league_lifecycle,
          nfl_phase, source_provider, source_revision, source_observed_at::text,
          verified_at::text AS period_verified_at, result_kind
        FROM selected`, parameters);
      const row = rows[0];
      if (!row || rowText(row, 'result_kind') === 'conflict') return { kind: 'conflict' };
      const resultKind = rowText(row, 'result_kind');
      if (resultKind !== 'stored' && resultKind !== 'verified' && resultKind !== 'ignored') {
        throw new Error('Database returned an invalid period write result.');
      }
      return { kind: resultKind, value: authorityFromRow(row) };
    },

    async readMatchupSnapshotByLeagueKey(leagueKey, requestedWeek, projectionIdentity) {
      if (requestedWeek !== undefined) wholeNumber(requestedWeek, 1, 18, 'Requested week');
      const [projectionProvider, normalizerVersion, modelVersion] = projectionIdentityValues(
        projectionIdentity,
      );
      const rows = await client.query(`/* projection-store:read-matchup-snapshot-by-league-key */
        ${matchupSnapshotSelectionSql('snapshot.payload')}`, [
        requiredText(leagueKey, 'League key'), requestedWeek ?? null,
        projectionProvider, normalizerVersion, modelVersion,
      ]);
      const row = rows[0];
      if (!row) return null;
      return {
        authority: authorityFromRow(row),
        snapshot: row.snapshot_id === null || row.snapshot_id === undefined
          ? null : snapshotFromRow(row),
        futureRefresh: futureFreshnessFromRow(row),
      };
    },
  };
}
