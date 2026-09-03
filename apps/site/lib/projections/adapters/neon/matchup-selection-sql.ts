import 'server-only';

/** Shared authority, pointer and provider-lineage selection; columns are static repository SQL. */
export function matchupSnapshotSelectionSql(payloadColumns: string): string {
  return `WITH target AS (
    SELECT authority.*, COALESCE($2::smallint, authority.default_week) AS target_week
    FROM league_period_authorities authority WHERE authority.league_key = $1
  )
  SELECT target.league_key, target.default_season, target.default_season_type,
    target.default_week, target.active_season, target.active_season_type,
    target.active_week, target.league_lifecycle, target.nfl_phase,
    target.source_provider, target.source_revision, target.source_observed_at::text,
    target.verified_at::text AS period_verified_at,
    snapshot.id AS snapshot_id, snapshot.league_season_id, snapshot.week,
    snapshot.model_version, snapshot.revision_key, snapshot.calculated_at::text,
    snapshot.activity_windows, current.published_at::text, current.verified_at::text,
    (snapshot.id IS NOT NULL) AS is_current,
    ${payloadColumns},
    future.next_refresh_at::text AS future_next_refresh_at,
    future.last_succeeded_at::text AS future_last_succeeded_at,
    future.active_attempt_expires_at::text AS future_attempt_expires_at,
    future.last_projection_slate_content_id::text AS future_last_slate_content_id,
    future.current_projection_slate_content_id::text AS future_current_slate_content_id,
    future.last_snapshot_revision AS future_last_snapshot_revision
  FROM target
  LEFT JOIN leagues league ON league.league_key = target.league_key
  LEFT JOIN league_seasons season ON season.league_id = league.id AND season.season = target.default_season
  LEFT JOIN current_projection_snapshots current
    ON current.league_season_id = season.id AND current.week = target.target_week
  LEFT JOIN projection_snapshots snapshot ON snapshot.id = current.snapshot_id AND snapshot.model_version = $5
  LEFT JOIN LATERAL (
    SELECT material.next_refresh_at, material.last_succeeded_at,
      material.active_attempt_expires_at, material.last_projection_slate_content_id,
      slate.projection_slate_content_id AS current_projection_slate_content_id,
      material.last_snapshot_revision
    FROM league_week_materialization_states material
    LEFT JOIN current_projection_slates slate
      ON slate.provider = material.projection_provider AND slate.season = material.season
      AND slate.season_type = material.season_type AND slate.week = material.week
      AND slate.normalizer_version = material.normalizer_version
    WHERE material.league_key = target.league_key AND material.season = target.default_season
      AND material.season_type = target.default_season_type AND material.week = target.target_week
      AND material.projection_provider = $3 AND material.normalizer_version = $4
      AND material.model_version = snapshot.model_version AND material.model_version = $5
    LIMIT 1
  ) future ON snapshot.id IS NOT NULL`;
}
