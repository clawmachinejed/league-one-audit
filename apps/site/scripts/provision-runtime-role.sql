-- Run this file once in the Neon SQL Editor as the schema-owner role, and rerun
-- it after adding application tables. It is deliberately separate from schema
-- migrations so a compromised runtime credential cannot run DDL.
--
-- The script creates the LOGIN role through SQL so Neon does not automatically
-- grant it membership in neon_superuser. Do not create this role with the Neon
-- Console, CLI, or API: roles created by those paths inherit neon_superuser.
--
-- After this script succeeds, use Neon's Reset password action on this already-created
-- role and keep the generated secret outside source control. Rerun this entire script
-- afterward so the fail-closed postconditions verify the role again after that
-- control-plane action. Then put the role's pooled connection string in DATABASE_URL.
-- Keep the schema-owner direct connection only in MIGRATION_DATABASE_URL.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'league_one_runtime') THEN
    EXECUTE 'CREATE ROLE league_one_runtime '
      || 'LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION';
  END IF;

  -- Repair an accidentally Console-created role, then fail closed below if the
  -- elevated membership could not be removed.
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'neon_superuser') THEN
    IF pg_has_role('league_one_runtime', 'neon_superuser', 'MEMBER') THEN
      EXECUTE 'REVOKE neon_superuser FROM league_one_runtime';
    END IF;
  END IF;
END;
$$;

DO $$
BEGIN
  EXECUTE format('GRANT CONNECT ON DATABASE %I TO league_one_runtime', current_database());
END;
$$;

REVOKE CREATE ON SCHEMA public FROM PUBLIC;
REVOKE CREATE ON SCHEMA public FROM league_one_runtime;
GRANT USAGE ON SCHEMA public TO league_one_runtime;

GRANT SELECT, INSERT, UPDATE ON TABLE
  scoring_profiles,
  leagues,
  league_seasons,
  league_source_connections,
  current_projection_snapshots,
  current_projection_slates,
  current_pregame_projection_candidates
TO league_one_runtime;

GRANT SELECT, INSERT ON TABLE
  external_scoring_entity_ids,
  external_game_ids,
  pregame_projection_candidates,
  pregame_projection_baselines,
  league_week_expected_games,
  official_player_point_observations,
  official_roster_point_observations
TO league_one_runtime;

GRANT SELECT, INSERT, DELETE ON TABLE
  league_week_observations,
  projection_snapshots,
  projection_slate_contents,
  projection_slate_entries,
  projection_slate_observations
TO league_one_runtime;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE
  scoring_entities,
  nfl_games,
  pregame_projection_runs,
  game_state_observations,
  projection_jobs
TO league_one_runtime;

DO $$
DECLARE
  runtime_role record;
BEGIN
  SELECT rolcanlogin, rolsuper, rolcreatedb, rolcreaterole, rolreplication
  INTO runtime_role
  FROM pg_roles WHERE rolname = 'league_one_runtime';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'league_one_runtime was not created';
  END IF;
  IF NOT runtime_role.rolcanlogin
    OR runtime_role.rolsuper OR runtime_role.rolcreatedb OR runtime_role.rolcreaterole
    OR runtime_role.rolreplication THEN
    RAISE EXCEPTION 'league_one_runtime is not an unprivileged LOGIN role';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'neon_superuser') THEN
    IF pg_has_role('league_one_runtime', 'neon_superuser', 'MEMBER') THEN
      RAISE EXCEPTION 'league_one_runtime still inherits neon_superuser';
    END IF;
  END IF;
  -- These privilege checks are the negative DDL postcondition: the runtime role
  -- must be unable to create objects in the application schema or database.
  IF has_schema_privilege('league_one_runtime', 'public', 'CREATE')
    OR has_database_privilege('league_one_runtime', current_database(), 'CREATE') THEN
    RAISE EXCEPTION 'league_one_runtime still has object-creation privileges';
  END IF;
  IF has_table_privilege(
    'league_one_runtime', 'public.app_schema_migrations', 'SELECT'
  ) THEN
    RAISE EXCEPTION 'league_one_runtime can read the migration ledger';
  END IF;
END;
$$;
