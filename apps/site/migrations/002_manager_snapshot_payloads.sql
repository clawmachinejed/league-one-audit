-- Migrate stored matchup snapshots from the retired ownerName property to
-- managerName. Snapshot rows are updated in place so their IDs, history and
-- current_projection_snapshots references remain unchanged.

LOCK TABLE projection_snapshots IN ACCESS EXCLUSIVE MODE;

CREATE OR REPLACE FUNCTION pg_temp.migrate_snapshot_team_manager_name(snapshot_team jsonb)
RETURNS jsonb
LANGUAGE plpgsql
IMMUTABLE
STRICT
AS $$
DECLARE
  has_manager_name boolean := snapshot_team ? 'managerName';
  has_owner_name boolean := snapshot_team ? 'ownerName';
BEGIN
  IF jsonb_typeof(snapshot_team) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'stored snapshot team is not an object';
  END IF;

  IF has_manager_name
    AND jsonb_typeof(snapshot_team -> 'managerName') IS DISTINCT FROM 'string' THEN
    RAISE EXCEPTION 'stored snapshot managerName is not a string';
  END IF;
  IF has_owner_name
    AND jsonb_typeof(snapshot_team -> 'ownerName') IS DISTINCT FROM 'string' THEN
    RAISE EXCEPTION 'stored snapshot ownerName is not a string';
  END IF;
  IF NOT has_manager_name AND NOT has_owner_name THEN
    RAISE EXCEPTION 'stored snapshot team has no participant name';
  END IF;
  IF has_manager_name AND has_owner_name
    AND snapshot_team -> 'managerName' IS DISTINCT FROM snapshot_team -> 'ownerName' THEN
    RAISE EXCEPTION 'stored snapshot team has conflicting managerName and ownerName values';
  END IF;

  IF has_owner_name THEN
    RETURN (snapshot_team - 'ownerName')
      || jsonb_build_object('managerName', snapshot_team -> 'ownerName');
  END IF;
  RETURN snapshot_team;
END;
$$;

CREATE OR REPLACE FUNCTION pg_temp.migrate_snapshot_side_manager_name(snapshot_side jsonb)
RETURNS jsonb
LANGUAGE plpgsql
IMMUTABLE
STRICT
AS $$
BEGIN
  IF jsonb_typeof(snapshot_side) IS DISTINCT FROM 'object'
    OR NOT snapshot_side ? 'team' THEN
    RAISE EXCEPTION 'stored snapshot matchup side is malformed';
  END IF;
  RETURN jsonb_set(
    snapshot_side,
    '{team}',
    pg_temp.migrate_snapshot_team_manager_name(snapshot_side -> 'team'),
    false
  );
END;
$$;

CREATE OR REPLACE FUNCTION pg_temp.migrate_snapshot_matchup_manager_names(snapshot_matchup jsonb)
RETURNS jsonb
LANGUAGE plpgsql
IMMUTABLE
STRICT
AS $$
DECLARE
  migrated_sides jsonb;
BEGIN
  IF jsonb_typeof(snapshot_matchup) IS DISTINCT FROM 'object'
    OR jsonb_typeof(snapshot_matchup -> 'sides') IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'stored snapshot matchup is malformed';
  END IF;

  SELECT COALESCE(
    jsonb_agg(
      pg_temp.migrate_snapshot_side_manager_name(item.value)
      ORDER BY item.ordinality
    ),
    '[]'::jsonb
  )
  INTO migrated_sides
  FROM jsonb_array_elements(snapshot_matchup -> 'sides')
    WITH ORDINALITY AS item(value, ordinality);

  RETURN jsonb_set(snapshot_matchup, '{sides}', migrated_sides, false);
END;
$$;

CREATE OR REPLACE FUNCTION pg_temp.migrate_snapshot_payload_manager_names(snapshot_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
IMMUTABLE
STRICT
AS $$
DECLARE
  migrated_teams jsonb;
  migrated_matchups jsonb;
BEGIN
  IF jsonb_typeof(snapshot_payload) IS DISTINCT FROM 'object'
    OR jsonb_typeof(snapshot_payload -> 'teams') IS DISTINCT FROM 'array'
    OR jsonb_typeof(snapshot_payload -> 'matchups') IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'stored projection snapshot payload is malformed';
  END IF;

  SELECT COALESCE(
    jsonb_agg(
      pg_temp.migrate_snapshot_team_manager_name(item.value)
      ORDER BY item.ordinality
    ),
    '[]'::jsonb
  )
  INTO migrated_teams
  FROM jsonb_array_elements(snapshot_payload -> 'teams')
    WITH ORDINALITY AS item(value, ordinality);

  SELECT COALESCE(
    jsonb_agg(
      pg_temp.migrate_snapshot_matchup_manager_names(item.value)
      ORDER BY item.ordinality
    ),
    '[]'::jsonb
  )
  INTO migrated_matchups
  FROM jsonb_array_elements(snapshot_payload -> 'matchups')
    WITH ORDINALITY AS item(value, ordinality);

  RETURN jsonb_set(
    jsonb_set(snapshot_payload, '{teams}', migrated_teams, false),
    '{matchups}',
    migrated_matchups,
    false
  );
END;
$$;

-- Match the application's recursively sorted, whitespace-free JSON encoding so
-- migrated snapshots retain a truthful content_hash for future deduplication.
CREATE OR REPLACE FUNCTION pg_temp.canonical_snapshot_json(snapshot_value jsonb)
RETURNS text
LANGUAGE sql
IMMUTABLE
STRICT
PARALLEL SAFE
AS $$
  SELECT CASE jsonb_typeof(snapshot_value)
    WHEN 'object' THEN COALESCE(
      (
        SELECT '{' || string_agg(
          to_jsonb(item.key)::text || ':' || pg_temp.canonical_snapshot_json(item.value),
          ',' ORDER BY item.key COLLATE "C"
        ) || '}'
        FROM jsonb_each(snapshot_value) AS item(key, value)
      ),
      '{}'
    )
    WHEN 'array' THEN COALESCE(
      (
        SELECT '[' || string_agg(
          pg_temp.canonical_snapshot_json(item.value),
          ',' ORDER BY item.ordinality
        ) || ']'
        FROM jsonb_array_elements(snapshot_value)
          WITH ORDINALITY AS item(value, ordinality)
      ),
      '[]'
    )
    ELSE snapshot_value::text
  END;
$$;

-- Exercise both payload locations and the safe already-migrated case before
-- touching persistent rows. Any regression aborts the whole migration.
DO $$
DECLARE
  sample jsonb := '{
    "teams": [
      {"id": 1, "ownerName": "Legacy Manager"},
      {"id": 2, "managerName": "Current Manager"}
    ],
    "matchups": [{
      "sides": [
        {"team": {"id": 1, "ownerName": "Legacy Manager"}},
        {"team": {
          "id": 2,
          "managerName": "Current Manager",
          "ownerName": "Current Manager"
        }}
      ]
    }]
  }'::jsonb;
  migrated jsonb;
BEGIN
  migrated := pg_temp.migrate_snapshot_payload_manager_names(sample);
  IF migrated #>> '{teams,0,managerName}' IS DISTINCT FROM 'Legacy Manager'
    OR migrated #> '{teams,0,ownerName}' IS NOT NULL
    OR migrated #>> '{teams,1,managerName}' IS DISTINCT FROM 'Current Manager'
    OR migrated #>> '{matchups,0,sides,0,team,managerName}' IS DISTINCT FROM 'Legacy Manager'
    OR migrated #> '{matchups,0,sides,1,team,ownerName}' IS NOT NULL THEN
    RAISE EXCEPTION 'manager snapshot migration self-check failed';
  END IF;

  BEGIN
    PERFORM pg_temp.migrate_snapshot_team_manager_name(
      '{"managerName":"One","ownerName":"Two"}'::jsonb
    );
    RAISE EXCEPTION 'conflicting participant names were not rejected';
  EXCEPTION
    WHEN raise_exception THEN
      IF SQLERRM IS DISTINCT FROM
        'stored snapshot team has conflicting managerName and ownerName values' THEN
        RAISE;
      END IF;
  END;
END;
$$;

CREATE TEMPORARY TABLE manager_snapshot_payload_migration
ON COMMIT DROP
AS
SELECT
  snapshot.id,
  migrated.payload,
  encode(
    digest(
      convert_to(
        pg_temp.canonical_snapshot_json(
          jsonb_build_object(
            'materialPayload', migrated.payload - 'updatedAt',
            'activityWindows', snapshot.activity_windows
          )
        ),
        'UTF8'
      ),
      'sha256'
    ),
    'hex'
  ) AS content_hash
FROM projection_snapshots AS snapshot
CROSS JOIN LATERAL (
  SELECT pg_temp.migrate_snapshot_payload_manager_names(snapshot.payload) AS payload
) AS migrated
WHERE migrated.payload IS DISTINCT FROM snapshot.payload;

DROP TRIGGER IF EXISTS projection_snapshots_immutable
  ON projection_snapshots;

UPDATE projection_snapshots AS snapshot
SET payload = migration.payload,
  content_hash = migration.content_hash
FROM manager_snapshot_payload_migration AS migration
WHERE snapshot.id = migration.id;

CREATE TRIGGER projection_snapshots_immutable
  BEFORE UPDATE ON projection_snapshots
  FOR EACH ROW EXECUTE FUNCTION prevent_projection_snapshot_update();

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM manager_snapshot_payload_migration AS migration
    JOIN projection_snapshots AS snapshot ON snapshot.id = migration.id
    WHERE snapshot.payload IS DISTINCT FROM migration.payload
      OR snapshot.content_hash IS DISTINCT FROM migration.content_hash
  ) THEN
    RAISE EXCEPTION 'stored projection snapshots were not migrated completely';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM current_projection_snapshots AS current
    LEFT JOIN projection_snapshots AS snapshot
      ON snapshot.id = current.snapshot_id
      AND snapshot.league_season_id = current.league_season_id
      AND snapshot.week = current.week
    WHERE snapshot.id IS NULL
  ) THEN
    RAISE EXCEPTION 'current projection snapshot pointers were not preserved';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM projection_snapshots AS snapshot
    CROSS JOIN LATERAL jsonb_array_elements(snapshot.payload -> 'teams') AS team(value)
    WHERE team.value ? 'ownerName'
      OR jsonb_typeof(team.value -> 'managerName') IS DISTINCT FROM 'string'
  ) THEN
    RAISE EXCEPTION 'a root snapshot team was not migrated to managerName';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM projection_snapshots AS snapshot
    CROSS JOIN LATERAL jsonb_array_elements(snapshot.payload -> 'matchups') AS matchup(value)
    CROSS JOIN LATERAL jsonb_array_elements(matchup.value -> 'sides') AS side(value)
    WHERE side.value -> 'team' ? 'ownerName'
      OR jsonb_typeof(side.value #> '{team,managerName}') IS DISTINCT FROM 'string'
  ) THEN
    RAISE EXCEPTION 'a matchup-side snapshot team was not migrated to managerName';
  END IF;
END;
$$;
