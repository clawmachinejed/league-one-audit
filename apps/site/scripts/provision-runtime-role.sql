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

-- Maintained auth grants are checked again below when its schema is installed.

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

DO $$ DECLARE object record; denied_table_privileges text := 'DELETE,TRUNCATE,TRIGGER'; BEGIN
  IF current_setting('server_version_num')::integer >= 170000 THEN
    denied_table_privileges := denied_table_privileges||',MAINTAIN';
  END IF;
  IF to_regnamespace('website_auth') IS NOT NULL THEN
    IF has_schema_privilege('league_one_runtime','website_auth','USAGE,CREATE') THEN
      RAISE EXCEPTION 'worker role can access the auth schema'; END IF;
    FOR object IN SELECT c.oid,c.relkind FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='website_auth' AND c.relkind IN ('r','p','v','m','f','S') LOOP
      IF (CASE WHEN object.relkind='S' THEN has_sequence_privilege('league_one_runtime',object.oid,'SELECT,UPDATE,USAGE')
        ELSE has_any_column_privilege('league_one_runtime',object.oid,'SELECT,INSERT,UPDATE,REFERENCES')
          OR has_table_privilege('league_one_runtime',object.oid,denied_table_privileges) END) THEN
        RAISE EXCEPTION 'worker role has auth object privileges'; END IF;
    END LOOP;
  END IF;
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='league_one_auth') THEN
    IF pg_has_role('league_one_runtime','league_one_auth','MEMBER') THEN
      RAISE EXCEPTION 'worker role can assume the auth role'; END IF;
  END IF;
END; $$;

-- Optional 034 DATA intake. Earlier schemas retain their existing grants/callers.
DO $$ DECLARE intake_table text; BEGIN
  IF to_regclass('public.public_data_intakes') IS NOT NULL THEN
    REVOKE ALL ON public.public_data_intakes,public.public_data_identity_observations,public.public_data_league_lists,
      public.public_data_league_candidates,public.public_data_collection_reservations,public.public_data_rejections,public.public_data_dispatches,
      public.public_data_dispatch_outcomes,public.public_data_directory_captures FROM league_one_runtime;
    GRANT SELECT ON public.public_data_intakes,public.public_data_identity_observations,public.public_data_league_lists,
      public.public_data_league_candidates,public.public_data_collection_reservations,public.public_data_rejections,public.public_data_dispatches,
      public.public_data_dispatch_outcomes,public.public_data_directory_captures TO league_one_runtime;
    GRANT EXECUTE ON FUNCTION public.submit_public_data_intake(jsonb),public.next_public_data_intake(uuid),
      public.guard_public_data_intake(jsonb,jsonb),public.recover_public_data_dispatch(uuid,jsonb),
      public.admit_public_data_dispatch(jsonb,jsonb),public.checkpoint_public_data_intake(jsonb,jsonb,jsonb) TO league_one_runtime;
    REVOKE ALL ON FUNCTION public.assert_public_data_owner(uuid,jsonb),public.fail_public_data_work(jsonb),
      public.assert_league_collection_capacity(text) FROM league_one_runtime;
    FOREACH intake_table IN ARRAY ARRAY['public_data_intakes','public_data_identity_observations','public_data_league_lists',
      'public_data_league_candidates','public_data_collection_reservations','public_data_rejections','public_data_dispatches','public_data_dispatch_outcomes','public_data_directory_captures'] LOOP
      IF has_table_privilege('league_one_runtime','public.'||intake_table,'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
        OR NOT has_table_privilege('league_one_runtime','public.'||intake_table,'SELECT') THEN
        RAISE EXCEPTION 'league_one_runtime has incorrect public intake privileges';
      END IF;
    END LOOP;
  END IF;
END; $$;

REVOKE CREATE ON SCHEMA public FROM PUBLIC;
REVOKE CREATE ON SCHEMA public FROM league_one_runtime;
GRANT USAGE ON SCHEMA public TO league_one_runtime;

-- Watch history has no runtime deletion or DDL use. Revoke inherited/default grants first.
REVOKE ALL ON TABLE league_week_lineup_watch_states FROM PUBLIC;
REVOKE ALL ON TABLE league_week_lineup_watch_states FROM league_one_runtime;
GRANT SELECT, INSERT, UPDATE ON TABLE league_week_lineup_watch_states TO league_one_runtime;

GRANT SELECT, INSERT, UPDATE ON TABLE
  scoring_profiles,
  leagues,
  league_seasons,
  league_source_connections,
  league_period_authorities,
  current_projection_snapshots,
  current_projection_slates,
  projection_period_refresh_states,
  league_week_materialization_states
TO league_one_runtime;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE
  current_pregame_projection_candidates
TO league_one_runtime;

REVOKE ALL ON TABLE
  all_player_stat_contents,
  all_player_stat_entries,
  all_player_stat_observations,
  all_player_score_sets,
  all_player_scores,
  current_all_player_score_sets
FROM league_one_runtime;

GRANT SELECT, INSERT ON TABLE
  external_scoring_entity_ids,
  external_game_ids,
  pregame_projection_candidates,
  pregame_projection_baselines,
  league_week_expected_games,
  official_player_point_observations,
  official_roster_point_observations,
  all_player_stat_contents,
  all_player_stat_entries,
  all_player_stat_observations,
  all_player_score_sets,
  all_player_scores
TO league_one_runtime;

GRANT SELECT ON TABLE current_all_player_score_sets TO league_one_runtime;
GRANT EXECUTE ON FUNCTION public.advance_current_all_player_score_set(
  text, smallint, text, smallint, uuid, text, uuid, uuid, timestamptz
) TO league_one_runtime;

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
  IF NOT has_table_privilege(
    'league_one_runtime', 'public.current_pregame_projection_candidates', 'DELETE'
  ) THEN
    RAISE EXCEPTION 'league_one_runtime cannot repair pregame candidate pointers';
  END IF;
  IF has_table_privilege('league_one_runtime', 'public.league_week_lineup_watch_states', 'DELETE')
    OR has_table_privilege('league_one_runtime', 'public.league_week_lineup_watch_states', 'TRUNCATE')
    OR has_table_privilege('league_one_runtime', 'public.league_week_lineup_watch_states', 'REFERENCES')
    OR has_table_privilege('league_one_runtime', 'public.league_week_lineup_watch_states', 'TRIGGER') THEN
    RAISE EXCEPTION 'league_one_runtime has excessive lineup-watch privileges';
  END IF;
  IF has_table_privilege('league_one_runtime', 'public.current_all_player_score_sets', 'INSERT')
    OR has_table_privilege('league_one_runtime', 'public.current_all_player_score_sets', 'UPDATE')
    OR has_table_privilege('league_one_runtime', 'public.current_all_player_score_sets', 'DELETE')
    OR has_table_privilege('league_one_runtime', 'public.all_player_stat_contents', 'UPDATE')
    OR has_table_privilege('league_one_runtime', 'public.all_player_stat_contents', 'DELETE')
    OR has_table_privilege('league_one_runtime', 'public.all_player_scores', 'UPDATE')
    OR has_table_privilege('league_one_runtime', 'public.all_player_scores', 'DELETE') THEN
    RAISE EXCEPTION 'league_one_runtime has excessive all-player privileges';
  END IF;
  IF NOT has_table_privilege('league_one_runtime', 'public.all_player_stat_contents', 'SELECT')
    OR NOT has_table_privilege('league_one_runtime', 'public.all_player_stat_contents', 'INSERT')
    OR NOT has_table_privilege('league_one_runtime', 'public.all_player_scores', 'SELECT')
    OR NOT has_table_privilege('league_one_runtime', 'public.all_player_scores', 'INSERT')
    OR NOT has_table_privilege('league_one_runtime', 'public.current_all_player_score_sets', 'SELECT')
    OR NOT has_function_privilege(
      'league_one_runtime',
      'public.advance_current_all_player_score_set(text,smallint,text,smallint,uuid,text,uuid,uuid,timestamptz)',
      'EXECUTE'
    ) THEN
    RAISE EXCEPTION 'league_one_runtime lacks required all-player privileges';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_class c JOIN pg_roles r ON r.oid = c.relowner
    WHERE c.oid = 'public.league_week_lineup_watch_states'::regclass AND r.rolname = 'league_one_runtime')
    OR EXISTS (SELECT 1 FROM pg_proc p JOIN pg_roles r ON r.oid = p.proowner
      WHERE p.proname IN ('prevent_lineup_watch_identity_change', 'valid_lineup_roster_ids')
        AND r.rolname = 'league_one_runtime') THEN
    RAISE EXCEPTION 'league_one_runtime owns protected lineup-watch objects';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_class object JOIN pg_roles owner ON owner.oid = object.relowner
    WHERE object.relname IN (
      'all_player_stat_contents', 'all_player_stat_entries', 'all_player_stat_observations',
      'all_player_score_sets', 'all_player_scores', 'current_all_player_score_sets'
    ) AND owner.rolname = 'league_one_runtime'
  ) OR EXISTS (
    SELECT 1 FROM pg_proc procedure JOIN pg_roles owner ON owner.oid = procedure.proowner
    WHERE procedure.proname IN (
      'prevent_all_player_history_change', 'validate_all_player_score_lineage',
      'advance_current_all_player_score_set'
    ) AND owner.rolname = 'league_one_runtime'
  ) THEN
    RAISE EXCEPTION 'league_one_runtime owns protected all-player objects';
  END IF;
END;
$$;

-- Migration-first bootstrap leaves these new functions owner-only when the
-- runtime role does not yet exist. Grant only the B3 compatibility entry points
-- after the role's existing privilege and ownership postconditions pass.
GRANT EXECUTE ON FUNCTION public.get_or_create_scoring_profile(text, jsonb) TO league_one_runtime;
GRANT EXECUTE ON FUNCTION public.record_game_state_observations(text, jsonb) TO league_one_runtime;
GRANT EXECUTE ON FUNCTION public.get_or_create_projection_run(
  text, smallint, text, smallint, text, text, timestamptz, timestamptz, timestamptz, text, uuid
) TO league_one_runtime;

-- Keep bootstrap compatible with a database intentionally migrated only through
-- 010, while granting the exact repaired entry points after 011 is installed.
DO $$ BEGIN
  IF to_regclass('public.all_player_score_verifications') IS NOT NULL THEN
    REVOKE ALL ON TABLE public.all_player_score_verifications FROM league_one_runtime;
    GRANT SELECT, INSERT ON TABLE public.all_player_score_verifications TO league_one_runtime;
    GRANT EXECUTE ON FUNCTION public.all_player_next_request_at(jsonb),
      public.all_player_job_fence_is_live(jsonb),
      public.assert_all_player_job_fence(jsonb,jsonb,boolean),
      public.claim_all_player_job(text,jsonb,text,integer,timestamptz),
      public.mark_all_player_request(jsonb,jsonb),
      public.finish_all_player_job(jsonb,text,jsonb),
      public.record_all_player_preclaim_outcome(jsonb),
      public.advance_current_all_player_score_set(
        text,smallint,text,smallint,uuid,text,uuid,uuid,timestamptz,jsonb)
      TO league_one_runtime;
    IF has_table_privilege('league_one_runtime','public.all_player_score_verifications','UPDATE')
      OR has_table_privilege('league_one_runtime','public.all_player_score_verifications','DELETE')
      OR has_table_privilege('league_one_runtime','public.all_player_score_verifications','TRUNCATE')
      OR has_table_privilege('league_one_runtime','public.all_player_score_verifications','REFERENCES')
      OR has_table_privilege('league_one_runtime','public.all_player_score_verifications','TRIGGER')
      OR has_table_privilege('league_one_runtime','public.all_player_score_verifications','MAINTAIN')
      OR NOT has_table_privilege('league_one_runtime','public.all_player_score_verifications','SELECT')
      OR NOT has_table_privilege('league_one_runtime','public.all_player_score_verifications','INSERT')
      OR NOT has_function_privilege('league_one_runtime',
        'public.record_all_player_preclaim_outcome(jsonb)','EXECUTE')
      OR NOT has_function_privilege('league_one_runtime',
        'public.advance_current_all_player_score_set(text,smallint,text,smallint,uuid,text,uuid,uuid,timestamptz,jsonb)',
        'EXECUTE') THEN
      RAISE EXCEPTION 'league_one_runtime has incorrect repaired all-player privileges';
    END IF;
  END IF;
END; $$;

-- Portable administration uses one atomic writer; immutable evidence and heads
-- are SELECT-only. Remapping and historical activation remain owner-only.
DO $$ DECLARE object_name text; BEGIN
  IF to_regclass('public.league_administration_enrollments') IS NOT NULL THEN
    FOREACH object_name IN ARRAY ARRAY['league_administration_enrollments','league_administration_enrollment_seasons','league_source_connection_history',
      'league_configuration_versions','league_administration_contents','league_administration_observations',
      'league_administration_heads','league_configuration_activations','league_configuration_heads',
      'league_season_teams','league_source_manager_accounts','league_administration_team_entries',
      'league_administration_manager_entries','league_administration_memberships','league_administration_transaction_entries'] LOOP
      EXECUTE format('REVOKE ALL ON TABLE public.%I FROM league_one_runtime',object_name);
      EXECUTE format('GRANT SELECT ON TABLE public.%I TO league_one_runtime',object_name);
      IF EXISTS (SELECT 1 FROM pg_class object JOIN pg_namespace namespace ON namespace.oid=object.relnamespace
        JOIN pg_roles owner ON owner.oid=object.relowner WHERE namespace.nspname='public'
          AND object.relname=object_name AND owner.rolname='league_one_runtime') THEN
        RAISE EXCEPTION 'league_one_runtime owns protected administration object'; END IF;
    END LOOP;
    REVOKE ALL ON FUNCTION public.remap_league_source_connection(uuid,text,text,text,text) FROM league_one_runtime;
    REVOKE ALL ON FUNCTION public.connect_league_administration_season(uuid,smallint,text,text,text,jsonb,text) FROM league_one_runtime;
    REVOKE ALL ON FUNCTION public.activate_league_configuration_component(uuid,text,text,smallint,smallint,text,bigint) FROM league_one_runtime;
    GRANT EXECUTE ON FUNCTION public.record_league_administration_observation(jsonb) TO league_one_runtime;
  END IF;
END; $$;

-- Shared score content uses existing immutable INSERT rights; only guarded
-- functions may create league acceptances, capture receipts or current pointers.
DO $$ BEGIN
  IF to_regclass('public.league_source_mapping_revisions') IS NOT NULL THEN
    REVOKE ALL ON public.league_source_mapping_revisions,public.league_administration_observation_mappings FROM league_one_runtime;
    GRANT SELECT ON public.league_source_mapping_revisions,public.league_administration_observation_mappings TO league_one_runtime;
    REVOKE ALL ON FUNCTION public.guard_source_mapping_pointer(),public.record_initial_source_mapping_revision(),
      public.revise_league_source_connection(uuid,text,uuid,text,text),public.validate_administration_observation_mapping() FROM league_one_runtime;
  END IF;
END; $$;

DO $$ BEGIN
  IF to_regprocedure('public.prepare_account_league_enrollment(uuid,integer,text)') IS NOT NULL THEN
    GRANT EXECUTE ON FUNCTION public.prepare_account_league_enrollment(uuid,integer,text),
      public.activate_account_league_enrollment(text,integer,text) TO league_one_runtime;
  END IF;
END; $$;

-- 027 may be migrated before the runtime role is first provisioned. Preserve
-- the same narrow grants as expansion with an already-existing runtime role.
DO $$ DECLARE object_name text; BEGIN
  IF to_regclass('public.league_roster_resource_scopes') IS NOT NULL THEN
    FOREACH object_name IN ARRAY ARRAY['league_roster_resource_scopes','league_roster_resource_heads',
      'league_roster_resource_attempts','league_roster_capture_receipts','league_roster_resource_acceptances'] LOOP
      EXECUTE format('REVOKE ALL ON TABLE public.%I FROM league_one_runtime',object_name);
      EXECUTE format('GRANT SELECT ON TABLE public.%I TO league_one_runtime',object_name);
      IF EXISTS(SELECT 1 FROM pg_class object JOIN pg_namespace namespace ON namespace.oid=object.relnamespace
        JOIN pg_roles owner ON owner.oid=object.relowner WHERE namespace.nspname='public'
          AND object.relname=object_name AND owner.rolname='league_one_runtime') THEN
        RAISE EXCEPTION 'league_one_runtime owns protected roster acceptance object';
      END IF;
    END LOOP;
    REVOKE ALL ON FUNCTION public.record_league_administration_observation_v1(jsonb),
      public.validate_current_roster_mapping(jsonb),public.validate_current_roster_lineage() FROM league_one_runtime;
    GRANT EXECUTE ON FUNCTION public.begin_current_roster_attempt(jsonb,uuid,jsonb,jsonb,jsonb),
      public.record_league_administration_observation(jsonb) TO league_one_runtime;
  END IF;
END; $$;

-- 028 relationship evidence remains SELECT-only, including late role bootstrap.
DO $$ BEGIN
  IF to_regclass('public.league_team_manager_entries') IS NOT NULL THEN
    REVOKE ALL ON public.league_team_manager_entries,public.league_team_manager_memberships FROM league_one_runtime;
    GRANT SELECT ON public.league_team_manager_entries,public.league_team_manager_memberships TO league_one_runtime;
    REVOKE ALL ON FUNCTION public.qualify_team_manager_projection(jsonb,jsonb,text,integer),
      public.validate_team_manager_entry(),public.validate_team_manager_membership() FROM league_one_runtime;
    IF has_table_privilege('league_one_runtime','public.league_team_manager_entries','INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN')
      OR has_table_privilege('league_one_runtime','public.league_team_manager_memberships','INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN') THEN
      RAISE EXCEPTION 'league_one_runtime has incorrect team manager privileges';
    END IF;
  END IF;
END; $$;

DO $$ BEGIN
  IF to_regclass('public.all_player_league_acceptances') IS NOT NULL THEN
    REVOKE ALL ON public.all_player_league_acceptances, public.current_all_player_league_scores FROM league_one_runtime;
    GRANT SELECT ON public.all_player_league_acceptances, public.current_all_player_league_scores TO league_one_runtime;
    GRANT EXECUTE ON FUNCTION public.record_all_player_capture(jsonb,uuid),
      public.accept_all_player_league_score(jsonb,uuid,uuid,uuid,uuid,timestamptz) TO league_one_runtime;
  END IF;
  IF to_regprocedure('public.finish_all_player_scoped_job(jsonb,text,jsonb,uuid)') IS NOT NULL THEN
    GRANT EXECUTE ON FUNCTION public.finish_all_player_scoped_job(jsonb,text,jsonb,uuid) TO league_one_runtime;
  END IF;
  IF to_regprocedure('public.finish_all_player_shared_pregame_job(jsonb,jsonb)') IS NOT NULL THEN
    GRANT EXECUTE ON FUNCTION public.finish_all_player_shared_pregame_job(jsonb,jsonb) TO league_one_runtime;
  END IF;
END; $$;

-- 031 retains optional calendar evidence with the same permissions when the
-- runtime role is provisioned after migrations. The existing public writer is
-- already granted above; its private delegate and validators stay inaccessible.
DO $$ BEGIN
  IF to_regclass('public.league_native_period_calendar_evidence') IS NOT NULL THEN
    REVOKE ALL ON public.league_native_period_calendar_evidence FROM league_one_runtime;
    GRANT SELECT ON public.league_native_period_calendar_evidence TO league_one_runtime;
    REVOKE ALL ON FUNCTION public.validate_native_period_calendar_evidence(jsonb,text),
      public.validate_native_period_calendar_lineage(),
      public.record_league_administration_observation_v30(jsonb) FROM league_one_runtime;
    IF has_table_privilege('league_one_runtime','public.league_native_period_calendar_evidence',
      'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN') THEN
      RAISE EXCEPTION 'league_one_runtime has incorrect calendar evidence privileges';
    END IF;
  END IF;
END; $$;

-- 032 consumes retained inputs without granting independent history writes.
DO $$ BEGIN
  IF to_regclass('public.league_calculation_source_captures') IS NOT NULL THEN
    REVOKE ALL ON public.league_calculation_source_captures,public.league_calculation_capture_inputs FROM league_one_runtime;
    GRANT SELECT ON public.league_calculation_source_captures,public.league_calculation_capture_inputs TO league_one_runtime;
    REVOKE ALL ON FUNCTION public.validate_calculation_input_lineage(),public.validate_calculation_source_lineage(),
      public.guard_calculation_source_association(),public.record_league_administration_observation_v31(jsonb) FROM league_one_runtime;
    GRANT EXECUTE ON FUNCTION public.begin_league_calculation_source_capture(jsonb,integer,uuid),
      public.record_league_administration_observation(jsonb) TO league_one_runtime;
    IF has_table_privilege('league_one_runtime','public.league_calculation_source_captures',
      'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN')
      OR has_table_privilege('league_one_runtime','public.league_calculation_capture_inputs',
        'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN') THEN
      RAISE EXCEPTION 'league_one_runtime has incorrect calculation history privileges';
    END IF;
  END IF;
END; $$;

-- Optional036: bounded refresh authority/history remains SELECT-only. No new
-- scheduler, worker identity, direct cursor DML or private admission bypass.
DO $$ DECLARE refresh_table text; BEGIN
  IF to_regclass('public.public_data_refresh_targets') IS NOT NULL THEN
    FOREACH refresh_table IN ARRAY ARRAY['public_data_refresh_targets','public_data_refresh_configurations',
      'public_data_refresh_cycles','public_data_refresh_cycle_outcomes','public_data_refresh_selection_failures'] LOOP
      EXECUTE format('REVOKE ALL ON TABLE public.%I FROM league_one_runtime',refresh_table);
      EXECUTE format('GRANT SELECT ON TABLE public.%I TO league_one_runtime',refresh_table);
      IF has_table_privilege('league_one_runtime','public.'||refresh_table,'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
        OR NOT has_table_privilege('league_one_runtime','public.'||refresh_table,'SELECT')
        OR EXISTS(SELECT 1 FROM pg_class object JOIN pg_namespace namespace ON namespace.oid=object.relnamespace
          JOIN pg_roles owner ON owner.oid=object.relowner WHERE namespace.nspname='public'
            AND object.relname=refresh_table AND owner.rolname='league_one_runtime') THEN
        RAISE EXCEPTION 'league_one_runtime has incorrect public refresh privileges'; END IF;
    END LOOP;
    GRANT EXECUTE ON FUNCTION public.configure_public_data_refresh(jsonb),public.select_public_data_refresh(jsonb),
      public.record_public_data_refresh_selection_failure(jsonb,jsonb,text) TO league_one_runtime;
    REVOKE ALL ON FUNCTION public.assert_public_refresh_owner(jsonb),public.admit_public_data_dispatch_v34(jsonb,jsonb) FROM league_one_runtime;
  END IF;
END; $$;

-- BEGIN OPTIONAL EXACT MATCHUP RESERVATION GRANT
-- Exact signature gating keeps late provisioning safe for schemas001..029.
DO $$ BEGIN
  IF to_regprocedure('public.begin_exact_matchup_attempt(jsonb,uuid,integer,jsonb)') IS NOT NULL THEN
    GRANT EXECUTE ON FUNCTION public.begin_exact_matchup_attempt(jsonb,uuid,integer,jsonb) TO league_one_runtime;
    IF NOT has_function_privilege('league_one_runtime','public.begin_exact_matchup_attempt(jsonb,uuid,integer,jsonb)','EXECUTE') THEN
      RAISE EXCEPTION 'league_one_runtime lacks exact matchup reservation privilege';
    END IF;
  END IF;
END; $$;
-- END OPTIONAL EXACT MATCHUP RESERVATION GRANT

-- BEGIN OPTIONAL PUBLIC CAPTURE WITNESS GRANT
-- R039 adds one bounded read of existing immutable admission/reservation rows.
-- Late/repeated provisioning cannot expose its private validators or history DML.
DO $$ DECLARE helper text; BEGIN
  IF to_regprocedure('public.read_public_data_capture_witness(jsonb,jsonb,jsonb)') IS NOT NULL THEN
    GRANT EXECUTE ON FUNCTION public.read_public_data_capture_witness(jsonb,jsonb,jsonb) TO league_one_runtime;
    FOREACH helper IN ARRAY ARRAY['public.derive_public_data_capture_witness(jsonb,jsonb,jsonb)',
      'public.assert_public_data_capture_witness(jsonb,jsonb,text,integer,jsonb)',
      'public.public_capture_after_reservation(jsonb,uuid)',
      'public.assert_public_capture_observation(jsonb,text)','public.assert_public_capture_input_shape(jsonb)'] LOOP
      EXECUTE format('REVOKE ALL ON FUNCTION %s FROM league_one_runtime',helper);
      IF has_function_privilege('league_one_runtime',helper,'EXECUTE') THEN
        RAISE EXCEPTION 'league_one_runtime can execute private capture helper'; END IF;
    END LOOP;
    IF NOT has_function_privilege('league_one_runtime','public.read_public_data_capture_witness(jsonb,jsonb,jsonb)','EXECUTE')
      OR has_table_privilege('league_one_runtime','public.league_roster_resource_attempts','INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN')
      OR has_table_privilege('league_one_runtime','public.public_data_dispatches','INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN')
      OR has_table_privilege('league_one_runtime','public.public_data_dispatch_outcomes','INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN') THEN
      RAISE EXCEPTION 'league_one_runtime has incorrect capture witness privileges'; END IF;
  END IF;
END; $$;
-- END OPTIONAL PUBLIC CAPTURE WITNESS GRANT

-- Optional038 exact-period tasks/checkpoints extend existing public intake only.
-- Their validators remain owner-only; SECURITY DEFINER intake functions evaluate
-- the scope CHECK as their owner. Runtime cannot insert or mutate either table.
DO $$ DECLARE period_table text; BEGIN
  IF to_regclass('public.public_data_exact_period_tasks') IS NOT NULL THEN
    FOREACH period_table IN ARRAY ARRAY['public_data_exact_period_tasks','public_data_exact_period_checkpoints'] LOOP
      EXECUTE format('REVOKE ALL ON TABLE public.%I FROM league_one_runtime',period_table);
      EXECUTE format('GRANT SELECT ON TABLE public.%I TO league_one_runtime',period_table);
      IF has_table_privilege('league_one_runtime','public.'||period_table,'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN')
        OR NOT has_table_privilege('league_one_runtime','public.'||period_table,'SELECT')
        OR EXISTS(SELECT 1 FROM pg_class object JOIN pg_namespace namespace ON namespace.oid=object.relnamespace
          JOIN pg_roles owner ON owner.oid=object.relowner WHERE namespace.nspname='public'
            AND object.relname=period_table AND owner.rolname='league_one_runtime') THEN
        RAISE EXCEPTION 'league_one_runtime has incorrect public exact period privileges'; END IF;
    END LOOP;
    REVOKE ALL ON FUNCTION public.canonical_public_data_exact_periods(jsonb,integer[]),
      public.validate_public_data_exact_period_task(),public.validate_public_data_exact_period_checkpoint(),
      public.admit_public_data_dispatch_v34(jsonb,jsonb),public.fail_public_data_work(jsonb),
      public.record_league_administration_observation_v30(jsonb) FROM league_one_runtime;
  END IF;
END; $$;

-- BEGIN OPTIONAL SHARED PLAYER DIRECTORY GRANTS
-- CP5 is a shared native resource under the existing administration owner. Late
-- provisioning exposes only fenced reservations/acceptance and SELECT readback.
DO $$ DECLARE relation text; helper text; BEGIN
  IF to_regclass('public.league_player_directory_heads') IS NOT NULL THEN
    FOREACH relation IN ARRAY ARRAY['heads','attempts','contents','entries','captures','source_slices','versions'] LOOP
      EXECUTE format('REVOKE ALL ON TABLE public.%I FROM league_one_runtime','league_player_directory_'||relation);
      EXECUTE format('GRANT SELECT ON TABLE public.%I TO league_one_runtime','league_player_directory_'||relation);
      IF has_table_privilege('league_one_runtime','public.league_player_directory_'||relation,'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN')
        OR NOT has_table_privilege('league_one_runtime','public.league_player_directory_'||relation,'SELECT')
        OR EXISTS(SELECT 1 FROM pg_class object JOIN pg_namespace namespace ON namespace.oid=object.relnamespace
          JOIN pg_roles owner ON owner.oid=object.relowner WHERE namespace.nspname='public'
            AND object.relname='league_player_directory_'||relation AND owner.rolname='league_one_runtime') THEN
        RAISE EXCEPTION 'league_one_runtime has incorrect player directory table privileges'; END IF;
    END LOOP;
    FOREACH helper IN ARRAY ARRAY['public.player_directory_native_row(text,jsonb)','public.player_directory_json_shape(text)',
      'public.assert_player_directory_owner(jsonb)','public.validate_player_directory_lineage()',
      'public.admit_public_data_dispatch_v40(jsonb,jsonb)'] LOOP
      EXECUTE format('REVOKE ALL ON FUNCTION %s FROM league_one_runtime',helper);
      IF has_function_privilege('league_one_runtime',helper,'EXECUTE') THEN RAISE EXCEPTION 'runtime can execute private directory helper'; END IF;
    END LOOP;
    GRANT EXECUTE ON FUNCTION public.begin_player_directory_attempt(uuid,jsonb),public.record_player_directory_capture(jsonb,jsonb,jsonb),
      public.admit_public_data_dispatch(jsonb,jsonb) TO league_one_runtime;
    IF NOT has_function_privilege('league_one_runtime','public.begin_player_directory_attempt(uuid,jsonb)','EXECUTE')
      OR NOT has_function_privilege('league_one_runtime','public.record_player_directory_capture(jsonb,jsonb,jsonb)','EXECUTE') THEN
      RAISE EXCEPTION 'runtime lacks required directory entry points'; END IF;
  END IF;
END; $$;
-- END OPTIONAL SHARED PLAYER DIRECTORY GRANTS
