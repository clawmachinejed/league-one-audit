import 'server-only';

import type { DatabaseClient, DatabaseRow } from '../../../database';
import type {
  LeaguePeriodAuthorityInput,
  PeriodAuthorityWriteOutcome,
  ProjectionStore,
  SeasonType,
  StoredLeaguePeriodAuthority,
} from './contracts';
import { provider, requiredText, rowNumber, rowText } from './database-values';
import { snapshotFromRow } from './snapshot-codec';

type PeriodMethods = Pick<ProjectionStore,
  'upsertLeaguePeriodAuthority' | 'readMatchupSnapshotByLeagueKey'
>;

const SEASON_TYPES = ['pre', 'reg', 'post'] as const;
const LIFECYCLES = ['preseason', 'active', 'complete'] as const;
const NFL_PHASES = ['preseason', 'regular', 'postseason', 'unknown'] as const;

function member<Value extends string>(
  value: string,
  values: readonly Value[],
  label: string,
): Value {
  if (!values.includes(value as Value)) throw new Error(`Database did not return a valid ${label}.`);
  return value as Value;
}

function wholeNumber(value: number, minimum: number, maximum: number, label: string): number {
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${label} is invalid.`);
  }
  return value;
}

function timestamp(value: string, label: string): string {
  if (!Number.isFinite(Date.parse(value))) throw new Error(`${label} is invalid.`);
  return value;
}

function nullableNumber(row: DatabaseRow, key: string): number | null {
  if (row[key] === null || row[key] === undefined) return null;
  return rowNumber(row, key);
}

function nullableSeasonType(row: DatabaseRow, key: string): SeasonType | null {
  if (row[key] === null || row[key] === undefined) return null;
  return member(rowText(row, key), SEASON_TYPES, key);
}

function authorityFromRow(row: DatabaseRow): StoredLeaguePeriodAuthority {
  const rawActiveSeason = nullableNumber(row, 'active_season');
  const rawActiveWeek = nullableNumber(row, 'active_week');
  const authority: StoredLeaguePeriodAuthority = {
    leagueKey: requiredText(rowText(row, 'league_key'), 'League key'),
    defaultSeason: wholeNumber(rowNumber(row, 'default_season'), 1920, 2200, 'Default season'),
    defaultSeasonType: member(rowText(row, 'default_season_type'), SEASON_TYPES, 'default season type'),
    defaultWeek: wholeNumber(rowNumber(row, 'default_week'), 1, 18, 'Default week'),
    activeSeason: rawActiveSeason === null
      ? null : wholeNumber(rawActiveSeason, 1920, 2200, 'Active season'),
    activeSeasonType: nullableSeasonType(row, 'active_season_type'),
    activeWeek: rawActiveWeek === null
      ? null : wholeNumber(rawActiveWeek, 1, 18, 'Active week'),
    leagueLifecycle: member(rowText(row, 'league_lifecycle'), LIFECYCLES, 'league lifecycle'),
    nflPhase: member(rowText(row, 'nfl_phase'), NFL_PHASES, 'NFL phase'),
    sourceProvider: provider(rowText(row, 'source_provider')),
    sourceRevision: requiredText(rowText(row, 'source_revision'), 'Period source revision'),
    sourceObservedAt: timestamp(rowText(row, 'source_observed_at'), 'Period source observation time'),
    verifiedAt: timestamp(rowText(row, 'period_verified_at'), 'Period verification time'),
  };
  const activeValues = [authority.activeSeason, authority.activeSeasonType, authority.activeWeek];
  const activeCount = activeValues.filter((value) => value !== null).length;
  if (activeCount !== 0 && activeCount !== activeValues.length) {
    throw new Error('Database returned an incomplete active scoring period.');
  }
  if ((authority.leagueLifecycle === 'active') !== (activeCount === activeValues.length)) {
    throw new Error('Database returned an inconsistent league lifecycle.');
  }
  if (Date.parse(authority.verifiedAt) < Date.parse(authority.sourceObservedAt)) {
    throw new Error('Database returned an invalid period verification time.');
  }
  return authority;
}

function validateInput(input: LeaguePeriodAuthorityInput): readonly unknown[] {
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
            $13::timestamptz AS verified_at
        ), upserted AS (
          INSERT INTO league_period_authorities (
            league_key, default_season, default_season_type, default_week,
            active_season, active_season_type, active_week, league_lifecycle,
            nfl_phase, source_provider, source_revision, source_observed_at, verified_at
          ) SELECT league_key, default_season, default_season_type, default_week,
              active_season, active_season_type, active_week, league_lifecycle,
              nfl_phase, source_provider, source_revision, source_observed_at, verified_at
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
            updated_at = now()
          WHERE EXCLUDED.source_observed_at > league_period_authorities.source_observed_at
            OR (
              EXCLUDED.source_observed_at = league_period_authorities.source_observed_at
              AND EXCLUDED.source_revision = league_period_authorities.source_revision
              AND EXCLUDED.verified_at > league_period_authorities.verified_at
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

    async readMatchupSnapshotByLeagueKey(leagueKey, requestedWeek) {
      if (requestedWeek !== undefined) wholeNumber(requestedWeek, 1, 18, 'Requested week');
      const rows = await client.query(`/* projection-store:read-matchup-snapshot-by-league-key */
        WITH target AS (
          SELECT authority.*, COALESCE($2::smallint, authority.default_week) AS target_week
          FROM league_period_authorities authority
          WHERE authority.league_key = $1
        )
        SELECT target.league_key, target.default_season, target.default_season_type,
          target.default_week, target.active_season, target.active_season_type,
          target.active_week, target.league_lifecycle, target.nfl_phase,
          target.source_provider, target.source_revision,
          target.source_observed_at::text, target.verified_at::text AS period_verified_at,
          snapshot.id AS snapshot_id, snapshot.league_season_id, snapshot.week,
          snapshot.model_version, snapshot.revision_key, snapshot.calculated_at::text,
          snapshot.payload, snapshot.activity_windows, current.published_at::text,
          current.verified_at::text, (snapshot.id IS NOT NULL) AS is_current
        FROM target
        LEFT JOIN leagues league ON league.league_key = target.league_key
        LEFT JOIN league_seasons season ON season.league_id = league.id
          AND season.season = target.default_season
        LEFT JOIN current_projection_snapshots current
          ON current.league_season_id = season.id AND current.week = target.target_week
        LEFT JOIN projection_snapshots snapshot ON snapshot.id = current.snapshot_id`, [
        requiredText(leagueKey, 'League key'), requestedWeek ?? null,
      ]);
      const row = rows[0];
      if (!row) return null;
      return {
        authority: authorityFromRow(row),
        snapshot: row.snapshot_id === null || row.snapshot_id === undefined
          ? null : snapshotFromRow(row),
      };
    },
  };
}
