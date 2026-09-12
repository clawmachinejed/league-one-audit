-- Reviewed additive all-player repair; never apply migration 010 again.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '120s';
SELECT pg_advisory_xact_lock(hashtext('league-one-schema-migrations'));
-- Old period-scoped job claims do not use the migration advisory lock. Hold
-- their ordinary row mutations until the ownership check and install commit.
LOCK TABLE public.projection_jobs IN SHARE ROW EXCLUSIVE MODE;
DO $repair_before$
DECLARE actual_count integer; actual_not_null_count integer; actual_rows bigint;
  actual_fingerprint text; actual_table_owner text; actual_function_owner text;
  actual_public_execute boolean; actual_runtime_execute boolean; actual_public_grant_execute boolean;
  actual_runtime_grant_execute boolean; before_catalog jsonb; after_catalog jsonb;
BEGIN
  IF current_database() <> 'neondb' OR current_user <> 'neondb_owner'
    THEN RAISE EXCEPTION 'release assertion failed: database or owner identity'; END IF;
  IF current_setting('server_version_num')::integer NOT BETWEEN 180000 AND 189999
    THEN RAISE EXCEPTION 'release assertion failed: reviewed PostgreSQL 18 required'; END IF;
  IF (SELECT count(*) FROM app_schema_migrations) <> 10
    THEN RAISE EXCEPTION 'release assertion failed: expected exactly migrations 001-010'; END IF;
  
  IF (SELECT checksum FROM app_schema_migrations WHERE name = '001_projection_foundation.sql') IS DISTINCT FROM 'eefa3aa224dbc6f0c6bb3edc9e4690425e2d6af7094938f3528059717d205050'
    THEN RAISE EXCEPTION 'release assertion failed: previous migration 001_projection_foundation.sql'; END IF;
  IF (SELECT checksum FROM app_schema_migrations WHERE name = '002_manager_snapshot_payloads.sql') IS DISTINCT FROM '74585dec3e2717eede0579f9281a041a4e3cc0b0cd8378383fe2e3d64fd7214d'
    THEN RAISE EXCEPTION 'release assertion failed: previous migration 002_manager_snapshot_payloads.sql'; END IF;
  IF (SELECT checksum FROM app_schema_migrations WHERE name = '003_league_period_authority.sql') IS DISTINCT FROM '6f98e09646834cc542a6413e00c0d0c2d84ad4a5ff33905e429aba87c951406e'
    THEN RAISE EXCEPTION 'release assertion failed: previous migration 003_league_period_authority.sql'; END IF;
  IF (SELECT checksum FROM app_schema_migrations WHERE name = '004_durable_projection_slates.sql') IS DISTINCT FROM '8ad48c22dea0d942a0a14027dcb240cda18f1bd728403e41aafa6b76f42f95b9'
    THEN RAISE EXCEPTION 'release assertion failed: previous migration 004_durable_projection_slates.sql'; END IF;
  IF (SELECT checksum FROM app_schema_migrations WHERE name = '005_future_projection_refresh.sql') IS DISTINCT FROM '02bb6a3c6a183e7074fbea156b5f393d5772619098ab7c07be9dcc5528003c75'
    THEN RAISE EXCEPTION 'release assertion failed: previous migration 005_future_projection_refresh.sql'; END IF;
  IF (SELECT checksum FROM app_schema_migrations WHERE name = '006_flexed_kickoff_candidate_index.sql') IS DISTINCT FROM 'd2c54c4e17439d3773cfab8db8ed68bf332abd1073fe793f62138efa89e1a3b0'
    THEN RAISE EXCEPTION 'release assertion failed: previous migration 006_flexed_kickoff_candidate_index.sql'; END IF;
  IF (SELECT checksum FROM app_schema_migrations WHERE name = '007_lineup_freshness.sql') IS DISTINCT FROM '1a92f9517294fe289bd25d74923dd042d0cb394d143b5c89d33ed017963c3e47'
    THEN RAISE EXCEPTION 'release assertion failed: previous migration 007_lineup_freshness.sql'; END IF;
  IF (SELECT checksum FROM app_schema_migrations WHERE name = '008_additive_write_guards.sql') IS DISTINCT FROM '2447ffac523e1f5536e218887d5c29895c3a095385f89bd6beb55cb7c5e95814'
    THEN RAISE EXCEPTION 'release assertion failed: previous migration 008_additive_write_guards.sql'; END IF;
  IF (SELECT checksum FROM app_schema_migrations WHERE name = '009_game_clock_plausibility.sql') IS DISTINCT FROM '86df8afd868bb4fd589a76bf1e1693cdc546037cfc61b54ae972e660fbda056a'
    THEN RAISE EXCEPTION 'release assertion failed: previous migration 009_game_clock_plausibility.sql'; END IF;
  IF (SELECT checksum FROM app_schema_migrations WHERE name = '010_all_player_statistics.sql') IS DISTINCT FROM 'f9f2aa0c4dc7a0a3097bf770a7f08ef0719ed7f019307dcf629fa17058af31b4'
    THEN RAISE EXCEPTION 'release assertion failed: previous migration 010_all_player_statistics.sql'; END IF;
  IF EXISTS (SELECT 1 FROM pg_roles role WHERE role.rolname <> 'league_one_runtime'
      AND pg_has_role('league_one_runtime',role.oid,'SET'))
    THEN RAISE EXCEPTION 'release assertion failed: runtime role can assume another role'; END IF;
  IF EXISTS (SELECT 1 FROM projection_jobs WHERE job_type = 'all-player-ingestion'
      AND state = 'running' AND lease_until > clock_timestamp())
    THEN RAISE EXCEPTION 'release assertion failed: all-player owner is active'; END IF;
  
  IF (SELECT count(*) FROM pg_class relation JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
      WHERE namespace.nspname = 'public' AND relation.relkind = 'r' AND relation.relname = 'all_player_score_sets') <> 1 THEN
    RAISE EXCEPTION 'release assertion failed: table all_player_score_sets'; END IF;
  IF (SELECT role.rolname FROM pg_class relation JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
      JOIN pg_roles role ON role.oid = relation.relowner
      WHERE namespace.nspname = 'public' AND relation.relname = 'all_player_score_sets') IS DISTINCT FROM 'neondb_owner' THEN
    RAISE EXCEPTION 'release assertion failed: owner all_player_score_sets'; END IF;
  SELECT count(*)::integer, md5(string_agg(
      attribute.attname || chr(31) || format_type(attribute.atttypid, attribute.atttypmod)
        || chr(31) || attribute.attnotnull::text || chr(31)
        || COALESCE(pg_get_expr(default_record.adbin, default_record.adrelid), ''),
      chr(30) ORDER BY attribute.attnum)) INTO actual_count, actual_fingerprint
    FROM pg_class relation JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
    JOIN pg_attribute attribute ON attribute.attrelid = relation.oid
    LEFT JOIN pg_attrdef default_record ON default_record.adrelid = relation.oid
      AND default_record.adnum = attribute.attnum
    WHERE namespace.nspname = 'public' AND relation.relname = 'all_player_score_sets'
      AND attribute.attnum > 0 AND NOT attribute.attisdropped;
  IF actual_count <> 17 OR actual_fingerprint IS DISTINCT FROM 'b37ef90ab355a40ef19257a91b51b50e' THEN
    RAISE EXCEPTION 'release assertion failed: columns all_player_score_sets expected count 17 fingerprint b37ef90ab355a40ef19257a91b51b50e, actual count % fingerprint %', actual_count, actual_fingerprint; END IF;
  SELECT count(*)::integer, count(*) FILTER (WHERE constraint_record.contype = 'n')::integer,
      md5(string_agg(constraint_record.conname || chr(31) || constraint_record.contype::text
        || chr(31) || pg_get_constraintdef(constraint_record.oid, true),
        chr(30) ORDER BY constraint_record.conname))
    INTO actual_count, actual_not_null_count, actual_fingerprint
    FROM pg_constraint constraint_record JOIN pg_class relation ON relation.oid = constraint_record.conrelid
    JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
    WHERE namespace.nspname = 'public' AND relation.relname = 'all_player_score_sets';
  IF actual_count <> 34 OR actual_not_null_count <> 17
      OR actual_fingerprint IS DISTINCT FROM 'bc815049013a175e7f635e756a6d58cd' THEN
    RAISE EXCEPTION 'release assertion failed: constraints all_player_score_sets expected count 34 not-null 17 fingerprint bc815049013a175e7f635e756a6d58cd, actual count % not-null % fingerprint %', actual_count, actual_not_null_count, actual_fingerprint; END IF;
  SELECT count(*)::integer, md5(string_agg(index_record.indexname || chr(31) || index_record.indexdef,
      chr(30) ORDER BY index_record.indexname)) INTO actual_count, actual_fingerprint
    FROM pg_indexes index_record WHERE index_record.schemaname = 'public'
      AND index_record.tablename = 'all_player_score_sets';
  IF actual_count <> 5 OR actual_fingerprint IS DISTINCT FROM '9353d8cc843cab2ad4405428b2ab081d' THEN
    RAISE EXCEPTION 'release assertion failed: indexes all_player_score_sets expected count 5 fingerprint 9353d8cc843cab2ad4405428b2ab081d, actual count % fingerprint %', actual_count, actual_fingerprint; END IF;
  IF has_table_privilege('public', 'public.all_player_score_sets',
        'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN')
      OR has_table_privilege('public', 'public.all_player_score_sets',
        'SELECT WITH GRANT OPTION,INSERT WITH GRANT OPTION,UPDATE WITH GRANT OPTION,DELETE WITH GRANT OPTION,TRUNCATE WITH GRANT OPTION,REFERENCES WITH GRANT OPTION,TRIGGER WITH GRANT OPTION,MAINTAIN WITH GRANT OPTION')
      OR has_any_column_privilege('public', 'public.all_player_score_sets', 'SELECT,INSERT,UPDATE,REFERENCES')
      OR has_any_column_privilege('public', 'public.all_player_score_sets',
        'SELECT WITH GRANT OPTION,INSERT WITH GRANT OPTION,UPDATE WITH GRANT OPTION,REFERENCES WITH GRANT OPTION')
      OR NOT has_table_privilege('league_one_runtime', 'public.all_player_score_sets', 'SELECT')
      OR has_table_privilege('league_one_runtime', 'public.all_player_score_sets', 'INSERT') IS DISTINCT FROM true
      OR has_table_privilege('league_one_runtime', 'public.all_player_score_sets',
        'UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN')
      OR has_table_privilege('league_one_runtime', 'public.all_player_score_sets',
        'SELECT WITH GRANT OPTION,INSERT WITH GRANT OPTION,UPDATE WITH GRANT OPTION,DELETE WITH GRANT OPTION,TRUNCATE WITH GRANT OPTION,REFERENCES WITH GRANT OPTION,TRIGGER WITH GRANT OPTION,MAINTAIN WITH GRANT OPTION')
      OR has_any_column_privilege('league_one_runtime', 'public.all_player_score_sets', 'INSERT')
          IS DISTINCT FROM true
      OR has_any_column_privilege('league_one_runtime', 'public.all_player_score_sets', 'UPDATE,REFERENCES')
      OR has_any_column_privilege('league_one_runtime', 'public.all_player_score_sets',
        'SELECT WITH GRANT OPTION,INSERT WITH GRANT OPTION,UPDATE WITH GRANT OPTION,REFERENCES WITH GRANT OPTION') THEN
    RAISE EXCEPTION 'release assertion failed: ACL all_player_score_sets'; END IF;
  EXECUTE 'SELECT count(*) FROM public.' || quote_ident('all_player_score_sets') INTO actual_rows;
  

  IF (SELECT count(*) FROM pg_class relation JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
      WHERE namespace.nspname = 'public' AND relation.relkind = 'r' AND relation.relname = 'all_player_scores') <> 1 THEN
    RAISE EXCEPTION 'release assertion failed: table all_player_scores'; END IF;
  IF (SELECT role.rolname FROM pg_class relation JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
      JOIN pg_roles role ON role.oid = relation.relowner
      WHERE namespace.nspname = 'public' AND relation.relname = 'all_player_scores') IS DISTINCT FROM 'neondb_owner' THEN
    RAISE EXCEPTION 'release assertion failed: owner all_player_scores'; END IF;
  SELECT count(*)::integer, md5(string_agg(
      attribute.attname || chr(31) || format_type(attribute.atttypid, attribute.atttypmod)
        || chr(31) || attribute.attnotnull::text || chr(31)
        || COALESCE(pg_get_expr(default_record.adbin, default_record.adrelid), ''),
      chr(30) ORDER BY attribute.attnum)) INTO actual_count, actual_fingerprint
    FROM pg_class relation JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
    JOIN pg_attribute attribute ON attribute.attrelid = relation.oid
    LEFT JOIN pg_attrdef default_record ON default_record.adrelid = relation.oid
      AND default_record.adnum = attribute.attnum
    WHERE namespace.nspname = 'public' AND relation.relname = 'all_player_scores'
      AND attribute.attnum > 0 AND NOT attribute.attisdropped;
  IF actual_count <> 15 OR actual_fingerprint IS DISTINCT FROM 'da793af1c8eb2dc4d919888adcf5ae56' THEN
    RAISE EXCEPTION 'release assertion failed: columns all_player_scores expected count 15 fingerprint da793af1c8eb2dc4d919888adcf5ae56, actual count % fingerprint %', actual_count, actual_fingerprint; END IF;
  SELECT count(*)::integer, count(*) FILTER (WHERE constraint_record.contype = 'n')::integer,
      md5(string_agg(constraint_record.conname || chr(31) || constraint_record.contype::text
        || chr(31) || pg_get_constraintdef(constraint_record.oid, true),
        chr(30) ORDER BY constraint_record.conname))
    INTO actual_count, actual_not_null_count, actual_fingerprint
    FROM pg_constraint constraint_record JOIN pg_class relation ON relation.oid = constraint_record.conrelid
    JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
    WHERE namespace.nspname = 'public' AND relation.relname = 'all_player_scores';
  IF actual_count <> 29 OR actual_not_null_count <> 12
      OR actual_fingerprint IS DISTINCT FROM '60484e2dab05e66dc396c52176521446' THEN
    RAISE EXCEPTION 'release assertion failed: constraints all_player_scores expected count 29 not-null 12 fingerprint 60484e2dab05e66dc396c52176521446, actual count % not-null % fingerprint %', actual_count, actual_not_null_count, actual_fingerprint; END IF;
  SELECT count(*)::integer, md5(string_agg(index_record.indexname || chr(31) || index_record.indexdef,
      chr(30) ORDER BY index_record.indexname)) INTO actual_count, actual_fingerprint
    FROM pg_indexes index_record WHERE index_record.schemaname = 'public'
      AND index_record.tablename = 'all_player_scores';
  IF actual_count <> 4 OR actual_fingerprint IS DISTINCT FROM 'aa643382ff5f32ec2a0da24e5e0889b9' THEN
    RAISE EXCEPTION 'release assertion failed: indexes all_player_scores expected count 4 fingerprint aa643382ff5f32ec2a0da24e5e0889b9, actual count % fingerprint %', actual_count, actual_fingerprint; END IF;
  IF has_table_privilege('public', 'public.all_player_scores',
        'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN')
      OR has_table_privilege('public', 'public.all_player_scores',
        'SELECT WITH GRANT OPTION,INSERT WITH GRANT OPTION,UPDATE WITH GRANT OPTION,DELETE WITH GRANT OPTION,TRUNCATE WITH GRANT OPTION,REFERENCES WITH GRANT OPTION,TRIGGER WITH GRANT OPTION,MAINTAIN WITH GRANT OPTION')
      OR has_any_column_privilege('public', 'public.all_player_scores', 'SELECT,INSERT,UPDATE,REFERENCES')
      OR has_any_column_privilege('public', 'public.all_player_scores',
        'SELECT WITH GRANT OPTION,INSERT WITH GRANT OPTION,UPDATE WITH GRANT OPTION,REFERENCES WITH GRANT OPTION')
      OR NOT has_table_privilege('league_one_runtime', 'public.all_player_scores', 'SELECT')
      OR has_table_privilege('league_one_runtime', 'public.all_player_scores', 'INSERT') IS DISTINCT FROM true
      OR has_table_privilege('league_one_runtime', 'public.all_player_scores',
        'UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN')
      OR has_table_privilege('league_one_runtime', 'public.all_player_scores',
        'SELECT WITH GRANT OPTION,INSERT WITH GRANT OPTION,UPDATE WITH GRANT OPTION,DELETE WITH GRANT OPTION,TRUNCATE WITH GRANT OPTION,REFERENCES WITH GRANT OPTION,TRIGGER WITH GRANT OPTION,MAINTAIN WITH GRANT OPTION')
      OR has_any_column_privilege('league_one_runtime', 'public.all_player_scores', 'INSERT')
          IS DISTINCT FROM true
      OR has_any_column_privilege('league_one_runtime', 'public.all_player_scores', 'UPDATE,REFERENCES')
      OR has_any_column_privilege('league_one_runtime', 'public.all_player_scores',
        'SELECT WITH GRANT OPTION,INSERT WITH GRANT OPTION,UPDATE WITH GRANT OPTION,REFERENCES WITH GRANT OPTION') THEN
    RAISE EXCEPTION 'release assertion failed: ACL all_player_scores'; END IF;
  EXECUTE 'SELECT count(*) FROM public.' || quote_ident('all_player_scores') INTO actual_rows;
  

  IF (SELECT count(*) FROM pg_class relation JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
      WHERE namespace.nspname = 'public' AND relation.relkind = 'r' AND relation.relname = 'all_player_stat_contents') <> 1 THEN
    RAISE EXCEPTION 'release assertion failed: table all_player_stat_contents'; END IF;
  IF (SELECT role.rolname FROM pg_class relation JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
      JOIN pg_roles role ON role.oid = relation.relowner
      WHERE namespace.nspname = 'public' AND relation.relname = 'all_player_stat_contents') IS DISTINCT FROM 'neondb_owner' THEN
    RAISE EXCEPTION 'release assertion failed: owner all_player_stat_contents'; END IF;
  SELECT count(*)::integer, md5(string_agg(
      attribute.attname || chr(31) || format_type(attribute.atttypid, attribute.atttypmod)
        || chr(31) || attribute.attnotnull::text || chr(31)
        || COALESCE(pg_get_expr(default_record.adbin, default_record.adrelid), ''),
      chr(30) ORDER BY attribute.attnum)) INTO actual_count, actual_fingerprint
    FROM pg_class relation JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
    JOIN pg_attribute attribute ON attribute.attrelid = relation.oid
    LEFT JOIN pg_attrdef default_record ON default_record.adrelid = relation.oid
      AND default_record.adnum = attribute.attnum
    WHERE namespace.nspname = 'public' AND relation.relname = 'all_player_stat_contents'
      AND attribute.attnum > 0 AND NOT attribute.attisdropped;
  IF actual_count <> 12 OR actual_fingerprint IS DISTINCT FROM 'bae4e3e70ccd8263a2f6fdc8fa4dbaaf' THEN
    RAISE EXCEPTION 'release assertion failed: columns all_player_stat_contents expected count 12 fingerprint bae4e3e70ccd8263a2f6fdc8fa4dbaaf, actual count % fingerprint %', actual_count, actual_fingerprint; END IF;
  SELECT count(*)::integer, count(*) FILTER (WHERE constraint_record.contype = 'n')::integer,
      md5(string_agg(constraint_record.conname || chr(31) || constraint_record.contype::text
        || chr(31) || pg_get_constraintdef(constraint_record.oid, true),
        chr(30) ORDER BY constraint_record.conname))
    INTO actual_count, actual_not_null_count, actual_fingerprint
    FROM pg_constraint constraint_record JOIN pg_class relation ON relation.oid = constraint_record.conrelid
    JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
    WHERE namespace.nspname = 'public' AND relation.relname = 'all_player_stat_contents';
  IF actual_count <> 23 OR actual_not_null_count <> 12
      OR actual_fingerprint IS DISTINCT FROM 'c42674c5539abecf2381b9f60fb2df05' THEN
    RAISE EXCEPTION 'release assertion failed: constraints all_player_stat_contents expected count 23 not-null 12 fingerprint c42674c5539abecf2381b9f60fb2df05, actual count % not-null % fingerprint %', actual_count, actual_not_null_count, actual_fingerprint; END IF;
  SELECT count(*)::integer, md5(string_agg(index_record.indexname || chr(31) || index_record.indexdef,
      chr(30) ORDER BY index_record.indexname)) INTO actual_count, actual_fingerprint
    FROM pg_indexes index_record WHERE index_record.schemaname = 'public'
      AND index_record.tablename = 'all_player_stat_contents';
  IF actual_count <> 3 OR actual_fingerprint IS DISTINCT FROM '278865b1e926da53f7783cb5525d094f' THEN
    RAISE EXCEPTION 'release assertion failed: indexes all_player_stat_contents expected count 3 fingerprint 278865b1e926da53f7783cb5525d094f, actual count % fingerprint %', actual_count, actual_fingerprint; END IF;
  IF has_table_privilege('public', 'public.all_player_stat_contents',
        'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN')
      OR has_table_privilege('public', 'public.all_player_stat_contents',
        'SELECT WITH GRANT OPTION,INSERT WITH GRANT OPTION,UPDATE WITH GRANT OPTION,DELETE WITH GRANT OPTION,TRUNCATE WITH GRANT OPTION,REFERENCES WITH GRANT OPTION,TRIGGER WITH GRANT OPTION,MAINTAIN WITH GRANT OPTION')
      OR has_any_column_privilege('public', 'public.all_player_stat_contents', 'SELECT,INSERT,UPDATE,REFERENCES')
      OR has_any_column_privilege('public', 'public.all_player_stat_contents',
        'SELECT WITH GRANT OPTION,INSERT WITH GRANT OPTION,UPDATE WITH GRANT OPTION,REFERENCES WITH GRANT OPTION')
      OR NOT has_table_privilege('league_one_runtime', 'public.all_player_stat_contents', 'SELECT')
      OR has_table_privilege('league_one_runtime', 'public.all_player_stat_contents', 'INSERT') IS DISTINCT FROM true
      OR has_table_privilege('league_one_runtime', 'public.all_player_stat_contents',
        'UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN')
      OR has_table_privilege('league_one_runtime', 'public.all_player_stat_contents',
        'SELECT WITH GRANT OPTION,INSERT WITH GRANT OPTION,UPDATE WITH GRANT OPTION,DELETE WITH GRANT OPTION,TRUNCATE WITH GRANT OPTION,REFERENCES WITH GRANT OPTION,TRIGGER WITH GRANT OPTION,MAINTAIN WITH GRANT OPTION')
      OR has_any_column_privilege('league_one_runtime', 'public.all_player_stat_contents', 'INSERT')
          IS DISTINCT FROM true
      OR has_any_column_privilege('league_one_runtime', 'public.all_player_stat_contents', 'UPDATE,REFERENCES')
      OR has_any_column_privilege('league_one_runtime', 'public.all_player_stat_contents',
        'SELECT WITH GRANT OPTION,INSERT WITH GRANT OPTION,UPDATE WITH GRANT OPTION,REFERENCES WITH GRANT OPTION') THEN
    RAISE EXCEPTION 'release assertion failed: ACL all_player_stat_contents'; END IF;
  EXECUTE 'SELECT count(*) FROM public.' || quote_ident('all_player_stat_contents') INTO actual_rows;
  

  IF (SELECT count(*) FROM pg_class relation JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
      WHERE namespace.nspname = 'public' AND relation.relkind = 'r' AND relation.relname = 'all_player_stat_entries') <> 1 THEN
    RAISE EXCEPTION 'release assertion failed: table all_player_stat_entries'; END IF;
  IF (SELECT role.rolname FROM pg_class relation JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
      JOIN pg_roles role ON role.oid = relation.relowner
      WHERE namespace.nspname = 'public' AND relation.relname = 'all_player_stat_entries') IS DISTINCT FROM 'neondb_owner' THEN
    RAISE EXCEPTION 'release assertion failed: owner all_player_stat_entries'; END IF;
  SELECT count(*)::integer, md5(string_agg(
      attribute.attname || chr(31) || format_type(attribute.atttypid, attribute.atttypmod)
        || chr(31) || attribute.attnotnull::text || chr(31)
        || COALESCE(pg_get_expr(default_record.adbin, default_record.adrelid), ''),
      chr(30) ORDER BY attribute.attnum)) INTO actual_count, actual_fingerprint
    FROM pg_class relation JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
    JOIN pg_attribute attribute ON attribute.attrelid = relation.oid
    LEFT JOIN pg_attrdef default_record ON default_record.adrelid = relation.oid
      AND default_record.adnum = attribute.attnum
    WHERE namespace.nspname = 'public' AND relation.relname = 'all_player_stat_entries'
      AND attribute.attnum > 0 AND NOT attribute.attisdropped;
  IF actual_count <> 13 OR actual_fingerprint IS DISTINCT FROM '0fe82d3a2278e77e514ea4582fe29892' THEN
    RAISE EXCEPTION 'release assertion failed: columns all_player_stat_entries expected count 13 fingerprint 0fe82d3a2278e77e514ea4582fe29892, actual count % fingerprint %', actual_count, actual_fingerprint; END IF;
  SELECT count(*)::integer, count(*) FILTER (WHERE constraint_record.contype = 'n')::integer,
      md5(string_agg(constraint_record.conname || chr(31) || constraint_record.contype::text
        || chr(31) || pg_get_constraintdef(constraint_record.oid, true),
        chr(30) ORDER BY constraint_record.conname))
    INTO actual_count, actual_not_null_count, actual_fingerprint
    FROM pg_constraint constraint_record JOIN pg_class relation ON relation.oid = constraint_record.conrelid
    JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
    WHERE namespace.nspname = 'public' AND relation.relname = 'all_player_stat_entries';
  IF actual_count <> 23 OR actual_not_null_count <> 9
      OR actual_fingerprint IS DISTINCT FROM 'ccea6cee2d37a3b0af620217eaa31410' THEN
    RAISE EXCEPTION 'release assertion failed: constraints all_player_stat_entries expected count 23 not-null 9 fingerprint ccea6cee2d37a3b0af620217eaa31410, actual count % not-null % fingerprint %', actual_count, actual_not_null_count, actual_fingerprint; END IF;
  SELECT count(*)::integer, md5(string_agg(index_record.indexname || chr(31) || index_record.indexdef,
      chr(30) ORDER BY index_record.indexname)) INTO actual_count, actual_fingerprint
    FROM pg_indexes index_record WHERE index_record.schemaname = 'public'
      AND index_record.tablename = 'all_player_stat_entries';
  IF actual_count <> 3 OR actual_fingerprint IS DISTINCT FROM 'a50142ccf1e6a9ce392d9697d1d91534' THEN
    RAISE EXCEPTION 'release assertion failed: indexes all_player_stat_entries expected count 3 fingerprint a50142ccf1e6a9ce392d9697d1d91534, actual count % fingerprint %', actual_count, actual_fingerprint; END IF;
  IF has_table_privilege('public', 'public.all_player_stat_entries',
        'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN')
      OR has_table_privilege('public', 'public.all_player_stat_entries',
        'SELECT WITH GRANT OPTION,INSERT WITH GRANT OPTION,UPDATE WITH GRANT OPTION,DELETE WITH GRANT OPTION,TRUNCATE WITH GRANT OPTION,REFERENCES WITH GRANT OPTION,TRIGGER WITH GRANT OPTION,MAINTAIN WITH GRANT OPTION')
      OR has_any_column_privilege('public', 'public.all_player_stat_entries', 'SELECT,INSERT,UPDATE,REFERENCES')
      OR has_any_column_privilege('public', 'public.all_player_stat_entries',
        'SELECT WITH GRANT OPTION,INSERT WITH GRANT OPTION,UPDATE WITH GRANT OPTION,REFERENCES WITH GRANT OPTION')
      OR NOT has_table_privilege('league_one_runtime', 'public.all_player_stat_entries', 'SELECT')
      OR has_table_privilege('league_one_runtime', 'public.all_player_stat_entries', 'INSERT') IS DISTINCT FROM true
      OR has_table_privilege('league_one_runtime', 'public.all_player_stat_entries',
        'UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN')
      OR has_table_privilege('league_one_runtime', 'public.all_player_stat_entries',
        'SELECT WITH GRANT OPTION,INSERT WITH GRANT OPTION,UPDATE WITH GRANT OPTION,DELETE WITH GRANT OPTION,TRUNCATE WITH GRANT OPTION,REFERENCES WITH GRANT OPTION,TRIGGER WITH GRANT OPTION,MAINTAIN WITH GRANT OPTION')
      OR has_any_column_privilege('league_one_runtime', 'public.all_player_stat_entries', 'INSERT')
          IS DISTINCT FROM true
      OR has_any_column_privilege('league_one_runtime', 'public.all_player_stat_entries', 'UPDATE,REFERENCES')
      OR has_any_column_privilege('league_one_runtime', 'public.all_player_stat_entries',
        'SELECT WITH GRANT OPTION,INSERT WITH GRANT OPTION,UPDATE WITH GRANT OPTION,REFERENCES WITH GRANT OPTION') THEN
    RAISE EXCEPTION 'release assertion failed: ACL all_player_stat_entries'; END IF;
  EXECUTE 'SELECT count(*) FROM public.' || quote_ident('all_player_stat_entries') INTO actual_rows;
  

  IF (SELECT count(*) FROM pg_class relation JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
      WHERE namespace.nspname = 'public' AND relation.relkind = 'r' AND relation.relname = 'all_player_stat_observations') <> 1 THEN
    RAISE EXCEPTION 'release assertion failed: table all_player_stat_observations'; END IF;
  IF (SELECT role.rolname FROM pg_class relation JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
      JOIN pg_roles role ON role.oid = relation.relowner
      WHERE namespace.nspname = 'public' AND relation.relname = 'all_player_stat_observations') IS DISTINCT FROM 'neondb_owner' THEN
    RAISE EXCEPTION 'release assertion failed: owner all_player_stat_observations'; END IF;
  SELECT count(*)::integer, md5(string_agg(
      attribute.attname || chr(31) || format_type(attribute.atttypid, attribute.atttypmod)
        || chr(31) || attribute.attnotnull::text || chr(31)
        || COALESCE(pg_get_expr(default_record.adbin, default_record.adrelid), ''),
      chr(30) ORDER BY attribute.attnum)) INTO actual_count, actual_fingerprint
    FROM pg_class relation JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
    JOIN pg_attribute attribute ON attribute.attrelid = relation.oid
    LEFT JOIN pg_attrdef default_record ON default_record.adrelid = relation.oid
      AND default_record.adnum = attribute.attnum
    WHERE namespace.nspname = 'public' AND relation.relname = 'all_player_stat_observations'
      AND attribute.attnum > 0 AND NOT attribute.attisdropped;
  IF actual_count <> 13 OR actual_fingerprint IS DISTINCT FROM '6c468b76a9004f46979f7ecdc42f5576' THEN
    RAISE EXCEPTION 'release assertion failed: columns all_player_stat_observations expected count 13 fingerprint 6c468b76a9004f46979f7ecdc42f5576, actual count % fingerprint %', actual_count, actual_fingerprint; END IF;
  SELECT count(*)::integer, count(*) FILTER (WHERE constraint_record.contype = 'n')::integer,
      md5(string_agg(constraint_record.conname || chr(31) || constraint_record.contype::text
        || chr(31) || pg_get_constraintdef(constraint_record.oid, true),
        chr(30) ORDER BY constraint_record.conname))
    INTO actual_count, actual_not_null_count, actual_fingerprint
    FROM pg_constraint constraint_record JOIN pg_class relation ON relation.oid = constraint_record.conrelid
    JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
    WHERE namespace.nspname = 'public' AND relation.relname = 'all_player_stat_observations';
  IF actual_count <> 22 OR actual_not_null_count <> 13
      OR actual_fingerprint IS DISTINCT FROM 'c6b6f735f4aa8bd29e53a96854432d35' THEN
    RAISE EXCEPTION 'release assertion failed: constraints all_player_stat_observations expected count 22 not-null 13 fingerprint c6b6f735f4aa8bd29e53a96854432d35, actual count % not-null % fingerprint %', actual_count, actual_not_null_count, actual_fingerprint; END IF;
  SELECT count(*)::integer, md5(string_agg(index_record.indexname || chr(31) || index_record.indexdef,
      chr(30) ORDER BY index_record.indexname)) INTO actual_count, actual_fingerprint
    FROM pg_indexes index_record WHERE index_record.schemaname = 'public'
      AND index_record.tablename = 'all_player_stat_observations';
  IF actual_count <> 4 OR actual_fingerprint IS DISTINCT FROM 'f4719cf59e3e87d89e0e248f30b49d8d' THEN
    RAISE EXCEPTION 'release assertion failed: indexes all_player_stat_observations expected count 4 fingerprint f4719cf59e3e87d89e0e248f30b49d8d, actual count % fingerprint %', actual_count, actual_fingerprint; END IF;
  IF has_table_privilege('public', 'public.all_player_stat_observations',
        'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN')
      OR has_table_privilege('public', 'public.all_player_stat_observations',
        'SELECT WITH GRANT OPTION,INSERT WITH GRANT OPTION,UPDATE WITH GRANT OPTION,DELETE WITH GRANT OPTION,TRUNCATE WITH GRANT OPTION,REFERENCES WITH GRANT OPTION,TRIGGER WITH GRANT OPTION,MAINTAIN WITH GRANT OPTION')
      OR has_any_column_privilege('public', 'public.all_player_stat_observations', 'SELECT,INSERT,UPDATE,REFERENCES')
      OR has_any_column_privilege('public', 'public.all_player_stat_observations',
        'SELECT WITH GRANT OPTION,INSERT WITH GRANT OPTION,UPDATE WITH GRANT OPTION,REFERENCES WITH GRANT OPTION')
      OR NOT has_table_privilege('league_one_runtime', 'public.all_player_stat_observations', 'SELECT')
      OR has_table_privilege('league_one_runtime', 'public.all_player_stat_observations', 'INSERT') IS DISTINCT FROM true
      OR has_table_privilege('league_one_runtime', 'public.all_player_stat_observations',
        'UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN')
      OR has_table_privilege('league_one_runtime', 'public.all_player_stat_observations',
        'SELECT WITH GRANT OPTION,INSERT WITH GRANT OPTION,UPDATE WITH GRANT OPTION,DELETE WITH GRANT OPTION,TRUNCATE WITH GRANT OPTION,REFERENCES WITH GRANT OPTION,TRIGGER WITH GRANT OPTION,MAINTAIN WITH GRANT OPTION')
      OR has_any_column_privilege('league_one_runtime', 'public.all_player_stat_observations', 'INSERT')
          IS DISTINCT FROM true
      OR has_any_column_privilege('league_one_runtime', 'public.all_player_stat_observations', 'UPDATE,REFERENCES')
      OR has_any_column_privilege('league_one_runtime', 'public.all_player_stat_observations',
        'SELECT WITH GRANT OPTION,INSERT WITH GRANT OPTION,UPDATE WITH GRANT OPTION,REFERENCES WITH GRANT OPTION') THEN
    RAISE EXCEPTION 'release assertion failed: ACL all_player_stat_observations'; END IF;
  EXECUTE 'SELECT count(*) FROM public.' || quote_ident('all_player_stat_observations') INTO actual_rows;
  

  IF (SELECT count(*) FROM pg_class relation JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
      WHERE namespace.nspname = 'public' AND relation.relkind = 'r' AND relation.relname = 'current_all_player_score_sets') <> 1 THEN
    RAISE EXCEPTION 'release assertion failed: table current_all_player_score_sets'; END IF;
  IF (SELECT role.rolname FROM pg_class relation JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
      JOIN pg_roles role ON role.oid = relation.relowner
      WHERE namespace.nspname = 'public' AND relation.relname = 'current_all_player_score_sets') IS DISTINCT FROM 'neondb_owner' THEN
    RAISE EXCEPTION 'release assertion failed: owner current_all_player_score_sets'; END IF;
  SELECT count(*)::integer, md5(string_agg(
      attribute.attname || chr(31) || format_type(attribute.atttypid, attribute.atttypmod)
        || chr(31) || attribute.attnotnull::text || chr(31)
        || COALESCE(pg_get_expr(default_record.adbin, default_record.adrelid), ''),
      chr(30) ORDER BY attribute.attnum)) INTO actual_count, actual_fingerprint
    FROM pg_class relation JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
    JOIN pg_attribute attribute ON attribute.attrelid = relation.oid
    LEFT JOIN pg_attrdef default_record ON default_record.adrelid = relation.oid
      AND default_record.adnum = attribute.attnum
    WHERE namespace.nspname = 'public' AND relation.relname = 'current_all_player_score_sets'
      AND attribute.attnum > 0 AND NOT attribute.attisdropped;
  IF actual_count <> 11 OR actual_fingerprint IS DISTINCT FROM 'ab985c7f1b316f8ec51052e2d3c37c9b' THEN
    RAISE EXCEPTION 'release assertion failed: columns current_all_player_score_sets expected count 11 fingerprint ab985c7f1b316f8ec51052e2d3c37c9b, actual count % fingerprint %', actual_count, actual_fingerprint; END IF;
  SELECT count(*)::integer, count(*) FILTER (WHERE constraint_record.contype = 'n')::integer,
      md5(string_agg(constraint_record.conname || chr(31) || constraint_record.contype::text
        || chr(31) || pg_get_constraintdef(constraint_record.oid, true),
        chr(30) ORDER BY constraint_record.conname))
    INTO actual_count, actual_not_null_count, actual_fingerprint
    FROM pg_constraint constraint_record JOIN pg_class relation ON relation.oid = constraint_record.conrelid
    JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
    WHERE namespace.nspname = 'public' AND relation.relname = 'current_all_player_score_sets';
  IF actual_count <> 20 OR actual_not_null_count <> 11
      OR actual_fingerprint IS DISTINCT FROM '42c70d0fd7aa602387283ffa2d948b8e' THEN
    RAISE EXCEPTION 'release assertion failed: constraints current_all_player_score_sets expected count 20 not-null 11 fingerprint 42c70d0fd7aa602387283ffa2d948b8e, actual count % not-null % fingerprint %', actual_count, actual_not_null_count, actual_fingerprint; END IF;
  SELECT count(*)::integer, md5(string_agg(index_record.indexname || chr(31) || index_record.indexdef,
      chr(30) ORDER BY index_record.indexname)) INTO actual_count, actual_fingerprint
    FROM pg_indexes index_record WHERE index_record.schemaname = 'public'
      AND index_record.tablename = 'current_all_player_score_sets';
  IF actual_count <> 1 OR actual_fingerprint IS DISTINCT FROM '5afb7b133b0d448b3ed974426beaac21' THEN
    RAISE EXCEPTION 'release assertion failed: indexes current_all_player_score_sets expected count 1 fingerprint 5afb7b133b0d448b3ed974426beaac21, actual count % fingerprint %', actual_count, actual_fingerprint; END IF;
  IF has_table_privilege('public', 'public.current_all_player_score_sets',
        'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN')
      OR has_table_privilege('public', 'public.current_all_player_score_sets',
        'SELECT WITH GRANT OPTION,INSERT WITH GRANT OPTION,UPDATE WITH GRANT OPTION,DELETE WITH GRANT OPTION,TRUNCATE WITH GRANT OPTION,REFERENCES WITH GRANT OPTION,TRIGGER WITH GRANT OPTION,MAINTAIN WITH GRANT OPTION')
      OR has_any_column_privilege('public', 'public.current_all_player_score_sets', 'SELECT,INSERT,UPDATE,REFERENCES')
      OR has_any_column_privilege('public', 'public.current_all_player_score_sets',
        'SELECT WITH GRANT OPTION,INSERT WITH GRANT OPTION,UPDATE WITH GRANT OPTION,REFERENCES WITH GRANT OPTION')
      OR NOT has_table_privilege('league_one_runtime', 'public.current_all_player_score_sets', 'SELECT')
      OR has_table_privilege('league_one_runtime', 'public.current_all_player_score_sets', 'INSERT') IS DISTINCT FROM false
      OR has_table_privilege('league_one_runtime', 'public.current_all_player_score_sets',
        'UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN')
      OR has_table_privilege('league_one_runtime', 'public.current_all_player_score_sets',
        'SELECT WITH GRANT OPTION,INSERT WITH GRANT OPTION,UPDATE WITH GRANT OPTION,DELETE WITH GRANT OPTION,TRUNCATE WITH GRANT OPTION,REFERENCES WITH GRANT OPTION,TRIGGER WITH GRANT OPTION,MAINTAIN WITH GRANT OPTION')
      OR has_any_column_privilege('league_one_runtime', 'public.current_all_player_score_sets', 'INSERT')
          IS DISTINCT FROM false
      OR has_any_column_privilege('league_one_runtime', 'public.current_all_player_score_sets', 'UPDATE,REFERENCES')
      OR has_any_column_privilege('league_one_runtime', 'public.current_all_player_score_sets',
        'SELECT WITH GRANT OPTION,INSERT WITH GRANT OPTION,UPDATE WITH GRANT OPTION,REFERENCES WITH GRANT OPTION') THEN
    RAISE EXCEPTION 'release assertion failed: ACL current_all_player_score_sets'; END IF;
  EXECUTE 'SELECT count(*) FROM public.' || quote_ident('current_all_player_score_sets') INTO actual_rows;
  

  SELECT count(*)::integer, min(md5(pg_get_triggerdef(trigger_record.oid, true))),
      min(table_owner.rolname), min(function_owner.rolname)
    INTO actual_count, actual_fingerprint, actual_table_owner, actual_function_owner
    FROM pg_trigger trigger_record JOIN pg_class relation ON relation.oid = trigger_record.tgrelid
    JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
    JOIN pg_roles table_owner ON table_owner.oid = relation.relowner
    JOIN pg_proc function_record ON function_record.oid = trigger_record.tgfoid
    JOIN pg_roles function_owner ON function_owner.oid = function_record.proowner
    WHERE namespace.nspname = 'public' AND NOT trigger_record.tgisinternal
      AND trigger_record.tgname = 'all_player_score_sets_immutable' AND relation.relname = 'all_player_score_sets'
      AND function_record.proname = 'prevent_all_player_history_change';
  IF actual_count <> 1 OR actual_fingerprint IS DISTINCT FROM 'a04cbd33698748f306a642741e522724'
      OR actual_table_owner IS DISTINCT FROM 'neondb_owner'
      OR actual_function_owner IS DISTINCT FROM 'neondb_owner' THEN
    RAISE EXCEPTION 'release assertion failed: trigger all_player_score_sets_immutable'; END IF;

  SELECT count(*)::integer, min(md5(pg_get_triggerdef(trigger_record.oid, true))),
      min(table_owner.rolname), min(function_owner.rolname)
    INTO actual_count, actual_fingerprint, actual_table_owner, actual_function_owner
    FROM pg_trigger trigger_record JOIN pg_class relation ON relation.oid = trigger_record.tgrelid
    JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
    JOIN pg_roles table_owner ON table_owner.oid = relation.relowner
    JOIN pg_proc function_record ON function_record.oid = trigger_record.tgfoid
    JOIN pg_roles function_owner ON function_owner.oid = function_record.proowner
    WHERE namespace.nspname = 'public' AND NOT trigger_record.tgisinternal
      AND trigger_record.tgname = 'all_player_scores_immutable' AND relation.relname = 'all_player_scores'
      AND function_record.proname = 'prevent_all_player_history_change';
  IF actual_count <> 1 OR actual_fingerprint IS DISTINCT FROM '2190f2dfdd649951146c023a5f34671d'
      OR actual_table_owner IS DISTINCT FROM 'neondb_owner'
      OR actual_function_owner IS DISTINCT FROM 'neondb_owner' THEN
    RAISE EXCEPTION 'release assertion failed: trigger all_player_scores_immutable'; END IF;

  SELECT count(*)::integer, min(md5(pg_get_triggerdef(trigger_record.oid, true))),
      min(table_owner.rolname), min(function_owner.rolname)
    INTO actual_count, actual_fingerprint, actual_table_owner, actual_function_owner
    FROM pg_trigger trigger_record JOIN pg_class relation ON relation.oid = trigger_record.tgrelid
    JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
    JOIN pg_roles table_owner ON table_owner.oid = relation.relowner
    JOIN pg_proc function_record ON function_record.oid = trigger_record.tgfoid
    JOIN pg_roles function_owner ON function_owner.oid = function_record.proowner
    WHERE namespace.nspname = 'public' AND NOT trigger_record.tgisinternal
      AND trigger_record.tgname = 'all_player_scores_lineage_guard' AND relation.relname = 'all_player_scores'
      AND function_record.proname = 'validate_all_player_score_lineage';
  IF actual_count <> 1 OR actual_fingerprint IS DISTINCT FROM 'e0d3b99cd73ec95716bb364ca56c483f'
      OR actual_table_owner IS DISTINCT FROM 'neondb_owner'
      OR actual_function_owner IS DISTINCT FROM 'neondb_owner' THEN
    RAISE EXCEPTION 'release assertion failed: trigger all_player_scores_lineage_guard'; END IF;

  SELECT count(*)::integer, min(md5(pg_get_triggerdef(trigger_record.oid, true))),
      min(table_owner.rolname), min(function_owner.rolname)
    INTO actual_count, actual_fingerprint, actual_table_owner, actual_function_owner
    FROM pg_trigger trigger_record JOIN pg_class relation ON relation.oid = trigger_record.tgrelid
    JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
    JOIN pg_roles table_owner ON table_owner.oid = relation.relowner
    JOIN pg_proc function_record ON function_record.oid = trigger_record.tgfoid
    JOIN pg_roles function_owner ON function_owner.oid = function_record.proowner
    WHERE namespace.nspname = 'public' AND NOT trigger_record.tgisinternal
      AND trigger_record.tgname = 'all_player_stat_contents_immutable' AND relation.relname = 'all_player_stat_contents'
      AND function_record.proname = 'prevent_all_player_history_change';
  IF actual_count <> 1 OR actual_fingerprint IS DISTINCT FROM '317368db6511931ee9051f122edcb60c'
      OR actual_table_owner IS DISTINCT FROM 'neondb_owner'
      OR actual_function_owner IS DISTINCT FROM 'neondb_owner' THEN
    RAISE EXCEPTION 'release assertion failed: trigger all_player_stat_contents_immutable'; END IF;

  SELECT count(*)::integer, min(md5(pg_get_triggerdef(trigger_record.oid, true))),
      min(table_owner.rolname), min(function_owner.rolname)
    INTO actual_count, actual_fingerprint, actual_table_owner, actual_function_owner
    FROM pg_trigger trigger_record JOIN pg_class relation ON relation.oid = trigger_record.tgrelid
    JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
    JOIN pg_roles table_owner ON table_owner.oid = relation.relowner
    JOIN pg_proc function_record ON function_record.oid = trigger_record.tgfoid
    JOIN pg_roles function_owner ON function_owner.oid = function_record.proowner
    WHERE namespace.nspname = 'public' AND NOT trigger_record.tgisinternal
      AND trigger_record.tgname = 'all_player_stat_entries_evidence_guard' AND relation.relname = 'all_player_stat_entries'
      AND function_record.proname = 'validate_all_player_stat_entry';
  IF actual_count <> 1 OR actual_fingerprint IS DISTINCT FROM 'c573f89c7d79fc0343a5f73c6a3827b4'
      OR actual_table_owner IS DISTINCT FROM 'neondb_owner'
      OR actual_function_owner IS DISTINCT FROM 'neondb_owner' THEN
    RAISE EXCEPTION 'release assertion failed: trigger all_player_stat_entries_evidence_guard'; END IF;

  SELECT count(*)::integer, min(md5(pg_get_triggerdef(trigger_record.oid, true))),
      min(table_owner.rolname), min(function_owner.rolname)
    INTO actual_count, actual_fingerprint, actual_table_owner, actual_function_owner
    FROM pg_trigger trigger_record JOIN pg_class relation ON relation.oid = trigger_record.tgrelid
    JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
    JOIN pg_roles table_owner ON table_owner.oid = relation.relowner
    JOIN pg_proc function_record ON function_record.oid = trigger_record.tgfoid
    JOIN pg_roles function_owner ON function_owner.oid = function_record.proowner
    WHERE namespace.nspname = 'public' AND NOT trigger_record.tgisinternal
      AND trigger_record.tgname = 'all_player_stat_entries_immutable' AND relation.relname = 'all_player_stat_entries'
      AND function_record.proname = 'prevent_all_player_history_change';
  IF actual_count <> 1 OR actual_fingerprint IS DISTINCT FROM 'daebe37338ccc8ce8644ccb11e3dd6bc'
      OR actual_table_owner IS DISTINCT FROM 'neondb_owner'
      OR actual_function_owner IS DISTINCT FROM 'neondb_owner' THEN
    RAISE EXCEPTION 'release assertion failed: trigger all_player_stat_entries_immutable'; END IF;

  SELECT count(*)::integer, min(md5(pg_get_triggerdef(trigger_record.oid, true))),
      min(table_owner.rolname), min(function_owner.rolname)
    INTO actual_count, actual_fingerprint, actual_table_owner, actual_function_owner
    FROM pg_trigger trigger_record JOIN pg_class relation ON relation.oid = trigger_record.tgrelid
    JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
    JOIN pg_roles table_owner ON table_owner.oid = relation.relowner
    JOIN pg_proc function_record ON function_record.oid = trigger_record.tgfoid
    JOIN pg_roles function_owner ON function_owner.oid = function_record.proowner
    WHERE namespace.nspname = 'public' AND NOT trigger_record.tgisinternal
      AND trigger_record.tgname = 'all_player_stat_observations_immutable' AND relation.relname = 'all_player_stat_observations'
      AND function_record.proname = 'prevent_all_player_history_change';
  IF actual_count <> 1 OR actual_fingerprint IS DISTINCT FROM '2698cd497ba819d17bc84364d21927e2'
      OR actual_table_owner IS DISTINCT FROM 'neondb_owner'
      OR actual_function_owner IS DISTINCT FROM 'neondb_owner' THEN
    RAISE EXCEPTION 'release assertion failed: trigger all_player_stat_observations_immutable'; END IF;

  SELECT count(*)::integer, min(md5(pg_get_triggerdef(trigger_record.oid, true))),
      min(table_owner.rolname), min(function_owner.rolname)
    INTO actual_count, actual_fingerprint, actual_table_owner, actual_function_owner
    FROM pg_trigger trigger_record JOIN pg_class relation ON relation.oid = trigger_record.tgrelid
    JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
    JOIN pg_roles table_owner ON table_owner.oid = relation.relowner
    JOIN pg_proc function_record ON function_record.oid = trigger_record.tgfoid
    JOIN pg_roles function_owner ON function_owner.oid = function_record.proowner
    WHERE namespace.nspname = 'public' AND NOT trigger_record.tgisinternal
      AND trigger_record.tgname = 'league_week_all_player_parity_immutable' AND relation.relname = 'league_week_observations'
      AND function_record.proname = 'prevent_all_player_parity_evidence_change';
  IF actual_count <> 1 OR actual_fingerprint IS DISTINCT FROM '6a88192e5a0c7d34fb542eb4a0194547'
      OR actual_table_owner IS DISTINCT FROM 'neondb_owner'
      OR actual_function_owner IS DISTINCT FROM 'neondb_owner' THEN
    RAISE EXCEPTION 'release assertion failed: trigger league_week_all_player_parity_immutable'; END IF;

  SELECT count(*)::integer, min(md5(pg_get_triggerdef(trigger_record.oid, true))),
      min(table_owner.rolname), min(function_owner.rolname)
    INTO actual_count, actual_fingerprint, actual_table_owner, actual_function_owner
    FROM pg_trigger trigger_record JOIN pg_class relation ON relation.oid = trigger_record.tgrelid
    JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
    JOIN pg_roles table_owner ON table_owner.oid = relation.relowner
    JOIN pg_proc function_record ON function_record.oid = trigger_record.tgfoid
    JOIN pg_roles function_owner ON function_owner.oid = function_record.proowner
    WHERE namespace.nspname = 'public' AND NOT trigger_record.tgisinternal
      AND trigger_record.tgname = 'official_player_all_player_parity_immutable' AND relation.relname = 'official_player_point_observations'
      AND function_record.proname = 'prevent_all_player_parity_evidence_change';
  IF actual_count <> 1 OR actual_fingerprint IS DISTINCT FROM '9c32f0e4a4f11773174da2999e7911c7'
      OR actual_table_owner IS DISTINCT FROM 'neondb_owner'
      OR actual_function_owner IS DISTINCT FROM 'neondb_owner' THEN
    RAISE EXCEPTION 'release assertion failed: trigger official_player_all_player_parity_immutable'; END IF;

  SELECT count(*)::integer, min(md5(pg_get_triggerdef(trigger_record.oid, true))),
      min(table_owner.rolname), min(function_owner.rolname)
    INTO actual_count, actual_fingerprint, actual_table_owner, actual_function_owner
    FROM pg_trigger trigger_record JOIN pg_class relation ON relation.oid = trigger_record.tgrelid
    JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
    JOIN pg_roles table_owner ON table_owner.oid = relation.relowner
    JOIN pg_proc function_record ON function_record.oid = trigger_record.tgfoid
    JOIN pg_roles function_owner ON function_owner.oid = function_record.proowner
    WHERE namespace.nspname = 'public' AND NOT trigger_record.tgisinternal
      AND trigger_record.tgname = 'official_roster_all_player_parity_immutable' AND relation.relname = 'official_roster_point_observations'
      AND function_record.proname = 'prevent_all_player_parity_evidence_change';
  IF actual_count <> 1 OR actual_fingerprint IS DISTINCT FROM '94a8192ee90bad5c5b8e8cc63f98c62d'
      OR actual_table_owner IS DISTINCT FROM 'neondb_owner'
      OR actual_function_owner IS DISTINCT FROM 'neondb_owner' THEN
    RAISE EXCEPTION 'release assertion failed: trigger official_roster_all_player_parity_immutable'; END IF;

  SELECT count(*)::integer, min(md5(pg_get_functiondef(function_record.oid))), min(owner.rolname),
      bool_or(has_function_privilege('public', function_record.oid, 'EXECUTE')),
      bool_or(has_function_privilege('league_one_runtime', function_record.oid, 'EXECUTE')),
      bool_or(has_function_privilege('public', function_record.oid, 'EXECUTE WITH GRANT OPTION')),
      bool_or(has_function_privilege('league_one_runtime', function_record.oid, 'EXECUTE WITH GRANT OPTION'))
    INTO actual_count, actual_fingerprint, actual_function_owner, actual_public_execute, actual_runtime_execute,
      actual_public_grant_execute, actual_runtime_grant_execute
    FROM pg_proc function_record JOIN pg_namespace namespace ON namespace.oid = function_record.pronamespace
    JOIN pg_roles owner ON owner.oid = function_record.proowner
    WHERE namespace.nspname = 'public' AND function_record.proname = 'advance_current_all_player_score_set'
      AND pg_get_function_identity_arguments(function_record.oid) = 'p_provider text, p_season smallint, p_season_type text, p_week smallint, p_scoring_profile_id uuid, p_scorer_version text, p_stat_observation_id uuid, p_score_set_id uuid, p_verified_at timestamp with time zone';
  IF actual_count <> 1 OR actual_fingerprint IS DISTINCT FROM 'bb15a13f565076eb818d401bec819832'
      OR actual_function_owner IS DISTINCT FROM 'neondb_owner' THEN
    RAISE EXCEPTION 'release assertion failed: function advance_current_all_player_score_set(p_provider text, p_season smallint, p_season_type text, p_week smallint, p_scoring_profile_id uuid, p_scorer_version text, p_stat_observation_id uuid, p_score_set_id uuid, p_verified_at timestamp with time zone)'; END IF;
  IF actual_public_execute IS DISTINCT FROM false
      OR actual_runtime_execute IS DISTINCT FROM true
      OR actual_public_grant_execute IS DISTINCT FROM false
      OR actual_runtime_grant_execute IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'release assertion failed: function ACL advance_current_all_player_score_set(p_provider text, p_season smallint, p_season_type text, p_week smallint, p_scoring_profile_id uuid, p_scorer_version text, p_stat_observation_id uuid, p_score_set_id uuid, p_verified_at timestamp with time zone)'; END IF;

  SELECT count(*)::integer, min(md5(pg_get_functiondef(function_record.oid))), min(owner.rolname),
      bool_or(has_function_privilege('public', function_record.oid, 'EXECUTE')),
      bool_or(has_function_privilege('league_one_runtime', function_record.oid, 'EXECUTE')),
      bool_or(has_function_privilege('public', function_record.oid, 'EXECUTE WITH GRANT OPTION')),
      bool_or(has_function_privilege('league_one_runtime', function_record.oid, 'EXECUTE WITH GRANT OPTION'))
    INTO actual_count, actual_fingerprint, actual_function_owner, actual_public_execute, actual_runtime_execute,
      actual_public_grant_execute, actual_runtime_grant_execute
    FROM pg_proc function_record JOIN pg_namespace namespace ON namespace.oid = function_record.pronamespace
    JOIN pg_roles owner ON owner.oid = function_record.proowner
    WHERE namespace.nspname = 'public' AND function_record.proname = 'all_player_eligibility_evidence_matches'
      AND pg_get_function_identity_arguments(function_record.oid) = 'p_evidence jsonb, p_eligible_game_count smallint, p_appearance_game_count smallint';
  IF actual_count <> 1 OR actual_fingerprint IS DISTINCT FROM 'dacb070adcd887dfd506ebf2d0b6da61'
      OR actual_function_owner IS DISTINCT FROM 'neondb_owner' THEN
    RAISE EXCEPTION 'release assertion failed: function all_player_eligibility_evidence_matches(p_evidence jsonb, p_eligible_game_count smallint, p_appearance_game_count smallint)'; END IF;
  IF actual_public_execute IS DISTINCT FROM false
      OR actual_runtime_execute IS DISTINCT FROM false
      OR actual_public_grant_execute IS DISTINCT FROM false
      OR actual_runtime_grant_execute IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'release assertion failed: function ACL all_player_eligibility_evidence_matches(p_evidence jsonb, p_eligible_game_count smallint, p_appearance_game_count smallint)'; END IF;

  SELECT count(*)::integer, min(md5(pg_get_functiondef(function_record.oid))), min(owner.rolname),
      bool_or(has_function_privilege('public', function_record.oid, 'EXECUTE')),
      bool_or(has_function_privilege('league_one_runtime', function_record.oid, 'EXECUTE')),
      bool_or(has_function_privilege('public', function_record.oid, 'EXECUTE WITH GRANT OPTION')),
      bool_or(has_function_privilege('league_one_runtime', function_record.oid, 'EXECUTE WITH GRANT OPTION'))
    INTO actual_count, actual_fingerprint, actual_function_owner, actual_public_execute, actual_runtime_execute,
      actual_public_grant_execute, actual_runtime_grant_execute
    FROM pg_proc function_record JOIN pg_namespace namespace ON namespace.oid = function_record.pronamespace
    JOIN pg_roles owner ON owner.oid = function_record.proowner
    WHERE namespace.nspname = 'public' AND function_record.proname = 'all_player_score_set_is_publication_ready'
      AND pg_get_function_identity_arguments(function_record.oid) = 'p_score_set_id uuid, p_expected_profile_ids jsonb';
  IF actual_count <> 1 OR actual_fingerprint IS DISTINCT FROM '4216c0e7a85951a78f9b2dfd8d2c1a7d'
      OR actual_function_owner IS DISTINCT FROM 'neondb_owner' THEN
    RAISE EXCEPTION 'release assertion failed: function all_player_score_set_is_publication_ready(p_score_set_id uuid, p_expected_profile_ids jsonb)'; END IF;
  IF actual_public_execute IS DISTINCT FROM false
      OR actual_runtime_execute IS DISTINCT FROM false
      OR actual_public_grant_execute IS DISTINCT FROM false
      OR actual_runtime_grant_execute IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'release assertion failed: function ACL all_player_score_set_is_publication_ready(p_score_set_id uuid, p_expected_profile_ids jsonb)'; END IF;

  SELECT count(*)::integer, min(md5(pg_get_functiondef(function_record.oid))), min(owner.rolname),
      bool_or(has_function_privilege('public', function_record.oid, 'EXECUTE')),
      bool_or(has_function_privilege('league_one_runtime', function_record.oid, 'EXECUTE')),
      bool_or(has_function_privilege('public', function_record.oid, 'EXECUTE WITH GRANT OPTION')),
      bool_or(has_function_privilege('league_one_runtime', function_record.oid, 'EXECUTE WITH GRANT OPTION'))
    INTO actual_count, actual_fingerprint, actual_function_owner, actual_public_execute, actual_runtime_execute,
      actual_public_grant_execute, actual_runtime_grant_execute
    FROM pg_proc function_record JOIN pg_namespace namespace ON namespace.oid = function_record.pronamespace
    JOIN pg_roles owner ON owner.oid = function_record.proowner
    WHERE namespace.nspname = 'public' AND function_record.proname = 'all_player_scoring_contract_supported'
      AND pg_get_function_identity_arguments(function_record.oid) = 'p_provider text, p_scorer_version text, p_rules jsonb';
  IF actual_count <> 1 OR actual_fingerprint IS DISTINCT FROM 'd9506986a378ca857262374e5396173f'
      OR actual_function_owner IS DISTINCT FROM 'neondb_owner' THEN
    RAISE EXCEPTION 'release assertion failed: function all_player_scoring_contract_supported(p_provider text, p_scorer_version text, p_rules jsonb)'; END IF;
  IF actual_public_execute IS DISTINCT FROM false
      OR actual_runtime_execute IS DISTINCT FROM false
      OR actual_public_grant_execute IS DISTINCT FROM false
      OR actual_runtime_grant_execute IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'release assertion failed: function ACL all_player_scoring_contract_supported(p_provider text, p_scorer_version text, p_rules jsonb)'; END IF;

  SELECT count(*)::integer, min(md5(pg_get_functiondef(function_record.oid))), min(owner.rolname),
      bool_or(has_function_privilege('public', function_record.oid, 'EXECUTE')),
      bool_or(has_function_privilege('league_one_runtime', function_record.oid, 'EXECUTE')),
      bool_or(has_function_privilege('public', function_record.oid, 'EXECUTE WITH GRANT OPTION')),
      bool_or(has_function_privilege('league_one_runtime', function_record.oid, 'EXECUTE WITH GRANT OPTION'))
    INTO actual_count, actual_fingerprint, actual_function_owner, actual_public_execute, actual_runtime_execute,
      actual_public_grant_execute, actual_runtime_grant_execute
    FROM pg_proc function_record JOIN pg_namespace namespace ON namespace.oid = function_record.pronamespace
    JOIN pg_roles owner ON owner.oid = function_record.proowner
    WHERE namespace.nspname = 'public' AND function_record.proname = 'prevent_all_player_history_change'
      AND pg_get_function_identity_arguments(function_record.oid) = '';
  IF actual_count <> 1 OR actual_fingerprint IS DISTINCT FROM '8ad4504ece6aa6bf9bc0f44281b93c73'
      OR actual_function_owner IS DISTINCT FROM 'neondb_owner' THEN
    RAISE EXCEPTION 'release assertion failed: function prevent_all_player_history_change()'; END IF;
  IF actual_public_execute IS DISTINCT FROM false
      OR actual_runtime_execute IS DISTINCT FROM false
      OR actual_public_grant_execute IS DISTINCT FROM false
      OR actual_runtime_grant_execute IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'release assertion failed: function ACL prevent_all_player_history_change()'; END IF;

  SELECT count(*)::integer, min(md5(pg_get_functiondef(function_record.oid))), min(owner.rolname),
      bool_or(has_function_privilege('public', function_record.oid, 'EXECUTE')),
      bool_or(has_function_privilege('league_one_runtime', function_record.oid, 'EXECUTE')),
      bool_or(has_function_privilege('public', function_record.oid, 'EXECUTE WITH GRANT OPTION')),
      bool_or(has_function_privilege('league_one_runtime', function_record.oid, 'EXECUTE WITH GRANT OPTION'))
    INTO actual_count, actual_fingerprint, actual_function_owner, actual_public_execute, actual_runtime_execute,
      actual_public_grant_execute, actual_runtime_grant_execute
    FROM pg_proc function_record JOIN pg_namespace namespace ON namespace.oid = function_record.pronamespace
    JOIN pg_roles owner ON owner.oid = function_record.proowner
    WHERE namespace.nspname = 'public' AND function_record.proname = 'prevent_all_player_parity_evidence_change'
      AND pg_get_function_identity_arguments(function_record.oid) = '';
  IF actual_count <> 1 OR actual_fingerprint IS DISTINCT FROM '72faead09751eaad9736ea704d104b99'
      OR actual_function_owner IS DISTINCT FROM 'neondb_owner' THEN
    RAISE EXCEPTION 'release assertion failed: function prevent_all_player_parity_evidence_change()'; END IF;
  IF actual_public_execute IS DISTINCT FROM false
      OR actual_runtime_execute IS DISTINCT FROM false
      OR actual_public_grant_execute IS DISTINCT FROM false
      OR actual_runtime_grant_execute IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'release assertion failed: function ACL prevent_all_player_parity_evidence_change()'; END IF;

  SELECT count(*)::integer, min(md5(pg_get_functiondef(function_record.oid))), min(owner.rolname),
      bool_or(has_function_privilege('public', function_record.oid, 'EXECUTE')),
      bool_or(has_function_privilege('league_one_runtime', function_record.oid, 'EXECUTE')),
      bool_or(has_function_privilege('public', function_record.oid, 'EXECUTE WITH GRANT OPTION')),
      bool_or(has_function_privilege('league_one_runtime', function_record.oid, 'EXECUTE WITH GRANT OPTION'))
    INTO actual_count, actual_fingerprint, actual_function_owner, actual_public_execute, actual_runtime_execute,
      actual_public_grant_execute, actual_runtime_grant_execute
    FROM pg_proc function_record JOIN pg_namespace namespace ON namespace.oid = function_record.pronamespace
    JOIN pg_roles owner ON owner.oid = function_record.proowner
    WHERE namespace.nspname = 'public' AND function_record.proname = 'validate_all_player_score_lineage'
      AND pg_get_function_identity_arguments(function_record.oid) = '';
  IF actual_count <> 1 OR actual_fingerprint IS DISTINCT FROM 'f32eb4d3feb633bdbf7eb1c63d644212'
      OR actual_function_owner IS DISTINCT FROM 'neondb_owner' THEN
    RAISE EXCEPTION 'release assertion failed: function validate_all_player_score_lineage()'; END IF;
  IF actual_public_execute IS DISTINCT FROM false
      OR actual_runtime_execute IS DISTINCT FROM false
      OR actual_public_grant_execute IS DISTINCT FROM false
      OR actual_runtime_grant_execute IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'release assertion failed: function ACL validate_all_player_score_lineage()'; END IF;

  SELECT count(*)::integer, min(md5(pg_get_functiondef(function_record.oid))), min(owner.rolname),
      bool_or(has_function_privilege('public', function_record.oid, 'EXECUTE')),
      bool_or(has_function_privilege('league_one_runtime', function_record.oid, 'EXECUTE')),
      bool_or(has_function_privilege('public', function_record.oid, 'EXECUTE WITH GRANT OPTION')),
      bool_or(has_function_privilege('league_one_runtime', function_record.oid, 'EXECUTE WITH GRANT OPTION'))
    INTO actual_count, actual_fingerprint, actual_function_owner, actual_public_execute, actual_runtime_execute,
      actual_public_grant_execute, actual_runtime_grant_execute
    FROM pg_proc function_record JOIN pg_namespace namespace ON namespace.oid = function_record.pronamespace
    JOIN pg_roles owner ON owner.oid = function_record.proowner
    WHERE namespace.nspname = 'public' AND function_record.proname = 'validate_all_player_stat_entry'
      AND pg_get_function_identity_arguments(function_record.oid) = '';
  IF actual_count <> 1 OR actual_fingerprint IS DISTINCT FROM '4473e3cb586dedf4ece8be15d53154f2'
      OR actual_function_owner IS DISTINCT FROM 'neondb_owner' THEN
    RAISE EXCEPTION 'release assertion failed: function validate_all_player_stat_entry()'; END IF;
  IF actual_public_execute IS DISTINCT FROM false
      OR actual_runtime_execute IS DISTINCT FROM false
      OR actual_public_grant_execute IS DISTINCT FROM false
      OR actual_runtime_grant_execute IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'release assertion failed: function ACL validate_all_player_stat_entry()'; END IF;

  
  IF (SELECT count(*) FROM pg_class relation WHERE relation.relnamespace = 'public'::regnamespace
      AND relation.relkind = 'r'
      AND (relation.relname LIKE 'all_player_%' OR relation.relname = 'current_all_player_score_sets'))
      <> 6
    THEN RAISE EXCEPTION 'release assertion failed: exact migration 010 table set'; END IF;
  IF (SELECT count(*) FROM pg_trigger trigger_record
      JOIN pg_class relation ON relation.oid = trigger_record.tgrelid
      JOIN pg_proc function_record ON function_record.oid = trigger_record.tgfoid
      WHERE relation.relnamespace = 'public'::regnamespace AND NOT trigger_record.tgisinternal
        AND (trigger_record.tgname LIKE '%all_player%' OR function_record.proname LIKE '%all_player%'))
      <> 10
    THEN RAISE EXCEPTION 'release assertion failed: exact migration 010 trigger set'; END IF;
  IF (SELECT count(*) FROM pg_proc function_record
      WHERE function_record.pronamespace = 'public'::regnamespace
        AND function_record.proname LIKE '%all_player%') <> 8
    THEN RAISE EXCEPTION 'release assertion failed: exact migration 010 function set'; END IF;
END; $repair_before$;

CREATE FUNCTION pg_temp.all_player_release_unaffected_catalog()
RETURNS jsonb LANGUAGE sql AS $catalog$
  SELECT jsonb_build_object(
    'schemas', (SELECT md5(COALESCE(string_agg(
      namespace.nspname || chr(31) || owner.rolname || chr(31) || COALESCE(namespace.nspacl::text, ''),
      chr(30) ORDER BY namespace.nspname), ''))
      FROM pg_namespace namespace JOIN pg_roles owner ON owner.oid = namespace.nspowner
      WHERE namespace.nspname !~ '^pg_temp_' AND namespace.nspname !~ '^pg_toast_temp_'),
    'tables', (SELECT md5(COALESCE(string_agg(
      namespace.nspname || chr(31) || relation.relname || chr(31) || relation.relkind::text
        || chr(31) || owner.rolname || chr(31) || COALESCE(relation.relacl::text, '')
        || chr(31) || relation.relrowsecurity::text || chr(31) || relation.relforcerowsecurity::text,
      chr(30) ORDER BY namespace.nspname, relation.relname), ''))
      FROM pg_class relation JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
      JOIN pg_roles owner ON owner.oid = relation.relowner
      WHERE namespace.nspname = 'public' AND relation.relkind IN ('r', 'p', 'v', 'm', 'S', 'f')
        AND relation.relname <> ALL (ARRAY['all_player_score_sets', 'all_player_score_verifications', 'all_player_scores', 'all_player_stat_contents', 'all_player_stat_entries', 'all_player_stat_observations', 'current_all_player_score_sets']::text[])),
    'columns', (SELECT md5(COALESCE(string_agg(
      relation.relname || chr(31) || attribute.attnum::text || chr(31) || attribute.attname
        || chr(31) || format_type(attribute.atttypid, attribute.atttypmod)
        || chr(31) || attribute.attnotnull::text || chr(31) || COALESCE(attribute.attacl::text, '')
        || chr(31) || COALESCE(pg_get_expr(default_record.adbin, default_record.adrelid), ''),
      chr(30) ORDER BY relation.relname, attribute.attnum), ''))
      FROM pg_class relation JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
      JOIN pg_attribute attribute ON attribute.attrelid = relation.oid
      LEFT JOIN pg_attrdef default_record ON default_record.adrelid = relation.oid
        AND default_record.adnum = attribute.attnum
      WHERE namespace.nspname = 'public' AND relation.relkind IN ('r', 'p', 'v', 'm', 'S', 'f')
        AND relation.relname <> ALL (ARRAY['all_player_score_sets', 'all_player_score_verifications', 'all_player_scores', 'all_player_stat_contents', 'all_player_stat_entries', 'all_player_stat_observations', 'current_all_player_score_sets']::text[])
        AND attribute.attnum > 0 AND NOT attribute.attisdropped),
    'constraints', (SELECT md5(COALESCE(string_agg(
      relation.relname || chr(31) || constraint_record.conname || chr(31)
        || constraint_record.contype::text || chr(31) || constraint_record.convalidated::text
        || chr(31) || pg_get_constraintdef(constraint_record.oid, true),
      chr(30) ORDER BY relation.relname, constraint_record.conname), ''))
      FROM pg_constraint constraint_record JOIN pg_class relation ON relation.oid = constraint_record.conrelid
      JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
      WHERE namespace.nspname = 'public' AND relation.relname <> ALL (ARRAY['all_player_score_sets', 'all_player_score_verifications', 'all_player_scores', 'all_player_stat_contents', 'all_player_stat_entries', 'all_player_stat_observations', 'current_all_player_score_sets']::text[])),
    'indexes', (SELECT md5(COALESCE(string_agg(
      table_record.tablename || chr(31) || table_record.indexname || chr(31) || table_record.indexdef,
      chr(30) ORDER BY table_record.tablename, table_record.indexname), ''))
      FROM pg_indexes table_record WHERE table_record.schemaname = 'public'
        AND table_record.tablename <> ALL (ARRAY['all_player_score_sets', 'all_player_score_verifications', 'all_player_scores', 'all_player_stat_contents', 'all_player_stat_entries', 'all_player_stat_observations', 'current_all_player_score_sets']::text[])),
    'triggers', (SELECT md5(COALESCE(string_agg(
      relation.relname || chr(31) || trigger_record.tgname || chr(31)
        || pg_get_triggerdef(trigger_record.oid, true),
      chr(30) ORDER BY relation.relname, trigger_record.tgname), ''))
      FROM pg_trigger trigger_record JOIN pg_class relation ON relation.oid = trigger_record.tgrelid
      JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
      WHERE namespace.nspname = 'public' AND NOT trigger_record.tgisinternal
        AND trigger_record.tgname <> ALL (ARRAY['all_player_score_sets_immutable', 'all_player_score_verifications_immutable', 'all_player_score_verifications_lineage_guard', 'all_player_scores_append_guard', 'all_player_scores_immutable', 'all_player_scores_lineage_guard', 'all_player_stat_contents_immutable', 'all_player_stat_entries_append_guard', 'all_player_stat_entries_evidence_guard', 'all_player_stat_entries_immutable', 'all_player_stat_observations_immutable', 'current_all_player_score_sets_job_fence', 'league_week_all_player_parity_immutable', 'official_player_all_player_parity_immutable', 'official_roster_all_player_parity_immutable', 'projection_jobs_all_player_budget_guard']::text[])),
    'functions', (SELECT md5(COALESCE(string_agg(
      function_record.proname || chr(31) || pg_get_function_identity_arguments(function_record.oid)
        || chr(31) || owner.rolname || chr(31) || COALESCE(function_record.proacl::text, '')
        || chr(31) || pg_get_functiondef(function_record.oid),
      chr(30) ORDER BY function_record.proname, pg_get_function_identity_arguments(function_record.oid)), ''))
      FROM pg_proc function_record JOIN pg_namespace namespace ON namespace.oid = function_record.pronamespace
      JOIN pg_roles owner ON owner.oid = function_record.proowner
      WHERE namespace.nspname = 'public' AND function_record.proname <> ALL (ARRAY['advance_current_all_player_score_set', 'all_player_eligibility_evidence_matches', 'all_player_job_fence_is_live', 'all_player_next_request_at', 'all_player_score_set_is_publication_ready', 'all_player_scoring_contract_supported', 'assert_all_player_job_fence', 'claim_all_player_job', 'finish_all_player_job', 'guard_all_player_child_insert', 'mark_all_player_request', 'prevent_all_player_history_change', 'prevent_all_player_parity_evidence_change', 'protect_all_player_global_job', 'record_all_player_preclaim_outcome', 'validate_all_player_score_lineage', 'validate_all_player_score_verification', 'validate_all_player_stat_entry', 'verify_all_player_pointer_job_fence']::text[])),
    'roles', (SELECT md5(COALESCE(string_agg(
      role.rolname || chr(31) || role.rolsuper::text || chr(31) || role.rolinherit::text
        || chr(31) || role.rolcreaterole::text || chr(31) || role.rolcreatedb::text
        || chr(31) || role.rolcanlogin::text || chr(31) || role.rolreplication::text,
      chr(30) ORDER BY role.rolname), '')) FROM pg_roles role),
    'memberships', (SELECT md5(COALESCE(string_agg(
      member_role.rolname || chr(31) || granted_role.rolname || chr(31)
        || membership.admin_option::text || chr(31) || membership.inherit_option::text
        || chr(31) || membership.set_option::text,
      chr(30) ORDER BY member_role.rolname, granted_role.rolname), ''))
      FROM pg_auth_members membership JOIN pg_roles member_role ON member_role.oid = membership.member
      JOIN pg_roles granted_role ON granted_role.oid = membership.roleid),
    'default_privileges', (SELECT md5(COALESCE(string_agg(
      owner.rolname || chr(31) || namespace.nspname || chr(31) || defaults.defaclobjtype::text
        || chr(31) || defaults.defaclacl::text,
      chr(30) ORDER BY owner.rolname, namespace.nspname, defaults.defaclobjtype), ''))
      FROM pg_default_acl defaults JOIN pg_roles owner ON owner.oid = defaults.defaclrole
      LEFT JOIN pg_namespace namespace ON namespace.oid = defaults.defaclnamespace)
  )
$catalog$;
CREATE TEMP TABLE all_player_release_before ON COMMIT DROP AS
  SELECT pg_temp.all_player_release_unaffected_catalog() AS fingerprint;

CREATE TEMP TABLE all_player_repair_before_counts ON COMMIT DROP AS
  SELECT 'all_player_stat_contents' AS name,count(*) AS rows FROM all_player_stat_contents UNION ALL
  SELECT 'all_player_stat_entries',count(*) FROM all_player_stat_entries UNION ALL
  SELECT 'all_player_stat_observations',count(*) FROM all_player_stat_observations UNION ALL
  SELECT 'all_player_score_sets',count(*) FROM all_player_score_sets UNION ALL
  SELECT 'all_player_scores',count(*) FROM all_player_scores UNION ALL
  SELECT 'current_all_player_score_sets',count(*) FROM current_all_player_score_sets;
-- Additive repair. Migration 010 and existing immutable rows remain unchanged.
-- The dormant old all-player writer fails closed after installation: only the
-- reviewed fenced writer may ingest. Existing readers and other workers remain compatible.

CREATE FUNCTION public.all_player_next_request_at(p_payload jsonb)
RETURNS timestamptz LANGUAGE sql STABLE
SET search_path = pg_catalog, public, pg_temp AS $$
  SELECT GREATEST(max(value::timestamptz) + interval '12 hours',
    CASE WHEN count(*) >= 2 THEN min(value::timestamptz) + interval '24 hours' END)
  FROM jsonb_array_elements_text(COALESCE(p_payload->'requestStarts', '[]'::jsonb)) value
$$;
REVOKE ALL ON FUNCTION public.all_player_next_request_at(jsonb) FROM PUBLIC;

CREATE FUNCTION public.all_player_job_fence_is_live(p_fence jsonb)
RETURNS boolean LANGUAGE sql VOLATILE SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp AS $$
  SELECT COALESCE(EXISTS (
    SELECT 1 FROM public.projection_jobs job
    WHERE job.job_key = 'all-player-ingestion:sleeper'
      AND p_fence->>'jobKey' = job.job_key
      AND job.job_type = 'all-player-ingestion' AND job.state = 'running'
      AND job.lease_owner = p_fence->>'workerId'
      AND job.attempt_count = (p_fence->>'generation')::integer
      AND job.lease_until = (p_fence->>'leaseUntil')::timestamptz
      AND job.lease_until > clock_timestamp()
      AND (job.payload->>'deadlineAt')::timestamptz = (p_fence->>'deadlineAt')::timestamptz
      AND (job.payload->>'deadlineAt')::timestamptz > clock_timestamp()
  ), false)
$$;
REVOKE ALL ON FUNCTION public.all_player_job_fence_is_live(jsonb) FROM PUBLIC;

CREATE FUNCTION public.assert_all_player_job_fence(
  p_fence jsonb, p_period jsonb, p_require_request boolean DEFAULT true
)
RETURNS boolean LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE job public.projection_jobs%ROWTYPE;
BEGIN
  SELECT * INTO job FROM public.projection_jobs
    WHERE job_key = 'all-player-ingestion:sleeper' FOR UPDATE;
  IF NOT FOUND OR public.all_player_job_fence_is_live(p_fence) IS DISTINCT FROM true
    OR job.payload->'period' IS DISTINCT FROM p_period
    OR job.payload->>'mode' = 'shadow'
    OR (p_require_request AND (job.payload->>'requestGeneration')::integer
      IS DISTINCT FROM job.attempt_count) THEN
    RAISE EXCEPTION 'all-player lease, generation, period, request or deadline is invalid';
  END IF;
  RETURN true;
END;
$$;
REVOKE ALL ON FUNCTION public.assert_all_player_job_fence(jsonb, jsonb, boolean) FROM PUBLIC;

CREATE FUNCTION public.claim_all_player_job(
  p_mode text, p_period jsonb, p_worker text, p_lease_seconds integer, p_deadline timestamptz
)
RETURNS TABLE(kind text, generation integer, lease_until text, deadline_at text, next_request_at text)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE job public.projection_jobs%ROWTYPE; next_at timestamptz; started timestamptz;
BEGIN
  IF p_mode IS NULL OR p_mode NOT IN ('shadow', 'backfill', 'recurring')
    OR p_worker IS NULL OR btrim(p_worker) = '' OR p_lease_seconds IS NULL OR p_deadline IS NULL
    OR p_lease_seconds NOT BETWEEN 1 AND 3600 OR p_deadline <= clock_timestamp()
    OR p_deadline > clock_timestamp() + interval '1 hour'
    OR jsonb_typeof(p_period) IS DISTINCT FROM 'object'
    OR jsonb_typeof(p_period->'season') IS DISTINCT FROM 'number'
    OR jsonb_typeof(p_period->'week') IS DISTINCT FROM 'number'
    OR (p_period->>'season')::integer NOT BETWEEN 2026 AND 2200
    OR p_period->>'seasonType' IS DISTINCT FROM 'reg'
    OR (p_period->>'week')::integer NOT BETWEEN 1 AND 18
    OR NOT (p_period ?& ARRAY['season','seasonType','week']) THEN
    RAISE EXCEPTION 'all-player job claim input is invalid';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('all-player-ingestion:sleeper', 0));
  SELECT * INTO job FROM public.projection_jobs
    WHERE job_key = 'all-player-ingestion:sleeper' FOR UPDATE;
  started := clock_timestamp();
  next_at := GREATEST(public.all_player_next_request_at(COALESCE(job.payload, '{}'::jsonb)),
    (job.payload->>'nextAttemptAt')::timestamptz);
  IF job.state = 'running' AND job.lease_until > started THEN
    RETURN QUERY SELECT 'busy'::text, NULL::integer, NULL::text, NULL::text, next_at::text;
    RETURN;
  END IF;
  IF next_at > started THEN
    RETURN QUERY SELECT 'not-due'::text, NULL::integer, NULL::text, NULL::text, next_at::text;
    RETURN;
  END IF;
  IF job.state = 'running' AND job.lease_until <= started THEN
    job.payload := job.payload || jsonb_build_object('lastInterruptedOutcome', jsonb_build_object(
      'outcome','lease-lost','stage','expired-before-completion','period',job.payload->'period',
      'generation',job.attempt_count,'leaseUntil',job.lease_until,'detectedAt',started));
  END IF;
  -- Preserve request starts even after validation/provider failures or lease takeover.
  -- Retain the last outcome and bounded per-period successful/partial metadata.
  INSERT INTO public.projection_jobs AS target (
    job_key, job_type, scheduled_for, state, payload, lease_owner, lease_until,
    attempt_count, updated_at
  ) VALUES (
    'all-player-ingestion:sleeper', 'all-player-ingestion', started, 'running',
    COALESCE(job.payload, '{}'::jsonb) || jsonb_build_object(
      'version', 'all-player-global-v2', 'mode', p_mode, 'period', p_period,
      'deadlineAt', p_deadline, 'requestGeneration', NULL),
    p_worker, started + p_lease_seconds * interval '1 second',
    COALESCE(job.attempt_count, 0) + 1, started
  ) ON CONFLICT (job_key) DO UPDATE SET
    state = EXCLUDED.state, scheduled_for = EXCLUDED.scheduled_for,
    payload = EXCLUDED.payload, lease_owner = EXCLUDED.lease_owner,
    lease_until = EXCLUDED.lease_until, attempt_count = EXCLUDED.attempt_count,
    updated_at = EXCLUDED.updated_at, completed_at = NULL, last_error = NULL
  RETURNING * INTO job;
  RETURN QUERY SELECT 'acquired'::text, job.attempt_count, job.lease_until::text,
    (job.payload->>'deadlineAt')::text, next_at::text;
END;
$$;
REVOKE ALL ON FUNCTION public.claim_all_player_job(text, jsonb, text, integer, timestamptz) FROM PUBLIC;

CREATE FUNCTION public.mark_all_player_request(p_fence jsonb, p_period jsonb)
RETURNS boolean LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE job public.projection_jobs%ROWTYPE; started timestamptz; starts jsonb;
BEGIN
  SELECT * INTO job FROM public.projection_jobs
    WHERE job_key = 'all-player-ingestion:sleeper' FOR UPDATE;
  IF NOT FOUND OR public.all_player_job_fence_is_live(p_fence) IS DISTINCT FROM true
    OR job.payload->'period' IS DISTINCT FROM p_period
    OR (job.payload->>'requestGeneration')::integer = job.attempt_count THEN RETURN false; END IF;
  started := clock_timestamp();
  IF public.all_player_next_request_at(job.payload) > started THEN RETURN false; END IF;
  SELECT COALESCE(jsonb_agg(value ORDER BY value::timestamptz), '[]'::jsonb) INTO starts
    FROM jsonb_array_elements_text(COALESCE(job.payload->'requestStarts', '[]'::jsonb)) value
    WHERE value::timestamptz > started - interval '24 hours';
  IF jsonb_array_length(starts) >= 2 THEN RETURN false; END IF;
  UPDATE public.projection_jobs SET payload = payload || jsonb_build_object(
    'requestStarts', starts || to_jsonb(started), 'requestGeneration', job.attempt_count,
    'lastRequestPeriod', p_period), updated_at = started
    WHERE job_key = job.job_key;
  RETURN true;
END;
$$;
REVOKE ALL ON FUNCTION public.mark_all_player_request(jsonb, jsonb) FROM PUBLIC;

CREATE FUNCTION public.finish_all_player_job(p_fence jsonb, p_outcome text, p_diagnostic jsonb)
RETURNS boolean LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE job public.projection_jobs%ROWTYPE; completed timestamptz; result jsonb; history jsonb; summary jsonb; prior_final jsonb; publication jsonb;
  stored_final boolean := false; stored_observed_at timestamptz; expected_count integer; actual_count integer;
BEGIN
  IF p_outcome IS NULL OR p_outcome NOT IN ('published','partial','validation-failed','provider-failed','timeout','lease-lost')
    OR jsonb_typeof(p_diagnostic) IS DISTINCT FROM 'object'
    OR octet_length(p_diagnostic::text) > 16000 THEN
    RAISE EXCEPTION 'all-player durable outcome is invalid';
  END IF;
  SELECT * INTO job FROM public.projection_jobs
    WHERE job_key = 'all-player-ingestion:sleeper' FOR UPDATE;
  -- Deadline expiry can be recorded during reserved handling time; ownership and
  -- lease expiry are always enforced, including failed completion.
  IF NOT FOUND OR jsonb_typeof(p_fence) IS DISTINCT FROM 'object'
    OR NOT (p_fence ?& ARRAY['jobKey','workerId','generation','leaseUntil','deadlineAt'])
    OR job.state IS DISTINCT FROM 'running'
    OR job.lease_owner IS DISTINCT FROM p_fence->>'workerId'
    OR job.attempt_count IS DISTINCT FROM (p_fence->>'generation')::integer
    OR job.lease_until IS DISTINCT FROM (p_fence->>'leaseUntil')::timestamptz
    OR (job.payload->>'deadlineAt')::timestamptz IS DISTINCT FROM (p_fence->>'deadlineAt')::timestamptz
    OR job.lease_until <= clock_timestamp()
    OR p_fence->>'jobKey' IS DISTINCT FROM job.job_key THEN RETURN false; END IF;
  completed := clock_timestamp();
  IF p_outcome = 'published' AND (job.payload->>'deadlineAt')::timestamptz <= completed
    THEN RETURN false; END IF;
  IF p_outcome = 'published' THEN
    publication := job.payload->'lastPublication';
    IF job.payload->>'mode' = 'shadow'
      OR (publication->>'generation')::integer IS DISTINCT FROM job.attempt_count
      OR publication->'period' IS DISTINCT FROM job.payload->'period'
      OR jsonb_typeof(publication->'profileIds') IS DISTINCT FROM 'array' THEN RETURN false; END IF;
    expected_count := jsonb_array_length(publication->'profileIds');
    SELECT count(*), bool_and(COALESCE((content.coverage->>'scheduleFinalityComplete')::boolean,false)),
      min(observation.observed_at)
      INTO actual_count, stored_final, stored_observed_at
      FROM public.current_all_player_score_sets pointer
      JOIN public.all_player_stat_observations observation ON observation.id = pointer.all_player_stat_observation_id
      JOIN public.all_player_stat_contents content ON content.id = observation.all_player_stat_content_id
      WHERE pointer.provider = 'sleeper' AND pointer.season = (job.payload->'period'->>'season')::integer
        AND pointer.season_type = 'reg' AND pointer.week = (job.payload->'period'->>'week')::integer
        AND pointer.scorer_version = publication->>'scorerVersion'
        AND pointer.all_player_stat_observation_id = (publication->>'observationId')::uuid
        AND publication->'profileIds' ? pointer.scoring_profile_id::text
        AND observation.quality = 'complete' AND content.quality = 'complete';
    IF expected_count = 0 OR actual_count <> expected_count THEN RETURN false; END IF;
  END IF;
  result := jsonb_build_object('outcome', p_outcome, 'finishedAt', completed,
    'period', job.payload->'period', 'generation', job.attempt_count, 'diagnostic', p_diagnostic,
    'observedAt', COALESCE(stored_observed_at::text, p_diagnostic->>'observedAt', completed::text),
    'finalCoverage', p_outcome = 'published' AND COALESCE(stored_final,false));
  SELECT value INTO prior_final
    FROM jsonb_array_elements(COALESCE(job.payload->'periodHistory','[]'::jsonb)) value
    WHERE value->'period' = job.payload->'period'
      AND value->>'outcome' = 'published' AND value->>'finalCoverage' = 'true'
    ORDER BY value->>'observedAt' DESC LIMIT 1;
  summary := CASE WHEN prior_final IS NOT NULL AND NOT
      (p_outcome = 'published' AND COALESCE(stored_final,false))
    THEN prior_final || jsonb_build_object('lastAttempt',result)
    ELSE result END;
  -- One summary per requested period for this season; a correction failure never
  -- erases the successful final proof. At most 18 regular-season summaries.
  SELECT COALESCE(jsonb_agg(value ORDER BY (value->'period'->>'week')::integer),'[]'::jsonb)
    INTO history FROM (
      SELECT value FROM jsonb_array_elements(COALESCE(job.payload->'periodHistory','[]'::jsonb)) value
      WHERE value->'period' <> job.payload->'period'
        AND value->'period'->>'season' = job.payload->'period'->>'season'
      UNION ALL SELECT summary
    ) periods;
  UPDATE public.projection_jobs SET
    state = CASE WHEN p_outcome IN ('published','partial') THEN 'completed' ELSE 'failed' END,
    completed_at = completed, lease_owner = NULL, lease_until = NULL, updated_at = completed,
    last_error = CASE WHEN p_outcome IN ('published','partial') THEN NULL ELSE p_outcome END,
    payload = payload || jsonb_build_object('lastOutcome', result, 'periodHistory', history,
      'nextAttemptAt', CASE WHEN (job.payload->>'requestGeneration')::integer IS DISTINCT FROM job.attempt_count
        THEN completed + interval '1 hour' ELSE public.all_player_next_request_at(job.payload) END)
    WHERE job_key = job.job_key;
  RETURN true;
END;
$$;
REVOKE ALL ON FUNCTION public.finish_all_player_job(jsonb, text, jsonb) FROM PUBLIC;

CREATE TABLE public.all_player_score_verifications (
  all_player_stat_observation_id uuid NOT NULL REFERENCES public.all_player_stat_observations(id),
  all_player_score_set_id uuid NOT NULL REFERENCES public.all_player_score_sets(id),
  scoring_profile_id uuid NOT NULL REFERENCES public.scoring_profiles(id),
  coverage jsonb NOT NULL CHECK (jsonb_typeof(coverage) = 'object'),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (all_player_stat_observation_id, all_player_score_set_id),
  UNIQUE (all_player_stat_observation_id, scoring_profile_id)
);
CREATE INDEX all_player_score_verifications_parity_idx
  ON public.all_player_score_verifications USING gin ((coverage->'parity_observation_ids'));
CREATE TRIGGER all_player_score_verifications_immutable
  BEFORE UPDATE OR DELETE ON public.all_player_score_verifications
  FOR EACH ROW EXECUTE FUNCTION public.prevent_all_player_history_change();

CREATE FUNCTION public.validate_all_player_score_verification()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE source_id uuid; profile_id uuid; original_coverage jsonb;
BEGIN
  SELECT score_set.all_player_stat_content_id, score_set.scoring_profile_id, score_set.coverage
    INTO STRICT source_id, profile_id, original_coverage
    FROM public.all_player_score_sets score_set WHERE score_set.id = NEW.all_player_score_set_id;
  IF profile_id <> NEW.scoring_profile_id OR NOT EXISTS (
    SELECT 1 FROM public.all_player_stat_observations observation
    WHERE observation.id = NEW.all_player_stat_observation_id
      AND observation.all_player_stat_content_id = source_id
      AND observation.quality = 'complete'
      AND observation.source_revision = NEW.coverage->>'all_player_source_revision'
  ) OR original_coverage - ARRAY['all_player_source_revision','score_batch_fingerprint',
      'parity_observation_ids','parity_observation_evidence','parity_fingerprint']
    IS DISTINCT FROM NEW.coverage - ARRAY['all_player_source_revision','score_batch_fingerprint',
      'parity_observation_ids','parity_observation_evidence','parity_fingerprint'] THEN
    RAISE EXCEPTION 'all-player score verification does not match material lineage';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.validate_all_player_score_verification() FROM PUBLIC;
CREATE TRIGGER all_player_score_verifications_lineage_guard
  BEFORE INSERT ON public.all_player_score_verifications
  FOR EACH ROW EXECUTE FUNCTION public.validate_all_player_score_verification();

CREATE FUNCTION public.guard_all_player_child_insert()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE expected_count integer; existing jsonb;
BEGIN
  IF TG_TABLE_NAME = 'all_player_stat_entries' THEN
    SELECT entry_count INTO STRICT expected_count FROM public.all_player_stat_contents
      WHERE id = NEW.all_player_stat_content_id FOR UPDATE;
    SELECT to_jsonb(entry) - 'created_at' INTO existing FROM public.all_player_stat_entries entry
      WHERE entry.all_player_stat_content_id = NEW.all_player_stat_content_id
        AND entry.entity_kind = NEW.entity_kind AND entry.provider_external_id = NEW.provider_external_id;
    IF existing = to_jsonb(NEW) - 'created_at' THEN RETURN NEW; END IF;
    IF NEW.ordinal >= expected_count OR EXISTS (
      SELECT 1 FROM public.all_player_stat_observations observation
        WHERE observation.all_player_stat_content_id = NEW.all_player_stat_content_id
    ) THEN RAISE EXCEPTION 'all-player raw child history is sealed'; END IF;
  ELSE
    SELECT scored_entity_count INTO STRICT expected_count FROM public.all_player_score_sets
      WHERE id = NEW.all_player_score_set_id FOR UPDATE;
    SELECT to_jsonb(score) - 'created_at' INTO existing FROM public.all_player_scores score
      WHERE score.all_player_score_set_id = NEW.all_player_score_set_id
        AND score.scoring_entity_id = NEW.scoring_entity_id;
    IF existing = to_jsonb(NEW) - 'created_at' THEN RETURN NEW; END IF;
    IF NEW.ordinal >= expected_count OR EXISTS (
      SELECT 1 FROM public.all_player_score_verifications verification
        WHERE verification.all_player_score_set_id = NEW.all_player_score_set_id
    ) OR EXISTS (
      SELECT 1 FROM public.current_all_player_score_sets pointer
        WHERE pointer.all_player_score_set_id = NEW.all_player_score_set_id
    ) THEN RAISE EXCEPTION 'all-player score child history is sealed'; END IF;
  END IF;
  IF existing IS NOT NULL THEN RAISE EXCEPTION 'all-player child replay conflicts'; END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.guard_all_player_child_insert() FROM PUBLIC;
CREATE TRIGGER all_player_stat_entries_append_guard BEFORE INSERT ON public.all_player_stat_entries
  FOR EACH ROW EXECUTE FUNCTION public.guard_all_player_child_insert();
CREATE TRIGGER all_player_scores_append_guard BEFORE INSERT ON public.all_player_scores
  FOR EACH ROW EXECUTE FUNCTION public.guard_all_player_child_insert();

REVOKE ALL ON TABLE public.all_player_score_verifications FROM PUBLIC;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'league_one_runtime') THEN
    GRANT SELECT, INSERT ON public.all_player_score_verifications TO league_one_runtime;
    GRANT EXECUTE ON FUNCTION public.all_player_next_request_at(jsonb),
      public.all_player_job_fence_is_live(jsonb),
      public.assert_all_player_job_fence(jsonb,jsonb,boolean),
      public.claim_all_player_job(text,jsonb,text,integer,timestamptz),
      public.mark_all_player_request(jsonb,jsonb), public.finish_all_player_job(jsonb,text,jsonb)
      TO league_one_runtime;
  END IF;
END; $$;


CREATE OR REPLACE FUNCTION public.validate_all_player_score_lineage()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  score_provider text;
  score_scorer_version text;
  score_rules jsonb;
  breakdown_total numeric;
  raw_entry public.all_player_stat_entries%ROWTYPE;
BEGIN
  IF EXISTS (SELECT 1 FROM public.all_player_scores existing
    WHERE existing.all_player_score_set_id = NEW.all_player_score_set_id
      AND existing.scoring_entity_id = NEW.scoring_entity_id
      AND to_jsonb(existing) - 'created_at' = to_jsonb(NEW) - 'created_at')
    THEN RETURN NEW; END IF;
  SELECT score_set.provider, score_set.scorer_version, profile.rules
  INTO STRICT score_provider, score_scorer_version, score_rules
  FROM public.all_player_score_sets score_set
  JOIN public.scoring_profiles profile ON profile.id = score_set.scoring_profile_id
  WHERE score_set.id = NEW.all_player_score_set_id
    AND score_set.all_player_stat_content_id = NEW.all_player_stat_content_id;

  SELECT entry.* INTO STRICT raw_entry
  FROM public.all_player_stat_entries entry
  WHERE entry.all_player_stat_content_id = NEW.all_player_stat_content_id
    AND entry.entity_kind = NEW.entity_kind
    AND entry.provider_external_id = NEW.provider_external_id;

  IF raw_entry.nfl_game_id IS DISTINCT FROM NEW.nfl_game_id
    OR raw_entry.nfl_team IS DISTINCT FROM NEW.nfl_team
    OR raw_entry.position IS DISTINCT FROM NEW.position
    OR raw_entry.eligible_game_count IS DISTINCT FROM NEW.eligible_game_count
    OR raw_entry.appearance_game_count IS DISTINCT FROM NEW.appearance_game_count
    OR raw_entry.game_phase IS DISTINCT FROM NEW.game_phase THEN
    RAISE EXCEPTION 'all-player score lineage does not match its raw stat entry';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.external_scoring_entity_ids mapping
    JOIN public.scoring_entities entity ON entity.id = mapping.scoring_entity_id
      AND entity.kind = NEW.entity_kind
    WHERE mapping.provider = score_provider
      AND mapping.entity_kind = NEW.entity_kind
      AND mapping.external_id = NEW.provider_external_id
      AND mapping.scoring_entity_id = NEW.scoring_entity_id
      AND mapping.mapping_status = 'verified'
      AND mapping.valid_from <= clock_timestamp()
      AND (mapping.valid_to IS NULL OR mapping.valid_to > clock_timestamp())
  ) THEN
    RAISE EXCEPTION 'all-player score identity is not verified';
  END IF;
  IF NOT public.all_player_scoring_contract_supported(
    score_provider, score_scorer_version, score_rules
  ) THEN
    RAISE EXCEPTION 'all-player scoring profile is unsupported by this scorer contract';
  END IF;
  IF EXISTS (
    SELECT 1 FROM jsonb_each(score_rules) rule
    WHERE (rule.value #>> '{}')::numeric <> 0
      AND NOT (NEW.scoring_breakdown ? rule.key)
  ) THEN
    RAISE EXCEPTION 'all-player scoring breakdown omits an active profile rule';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM jsonb_each(NEW.scoring_breakdown) breakdown
    LEFT JOIN LATERAL (
      SELECT rule.value FROM jsonb_each(score_rules) rule WHERE rule.key = breakdown.key
    ) profile_rule ON true
    WHERE profile_rule.value IS NULL
      OR jsonb_typeof(profile_rule.value) IS DISTINCT FROM 'number'
      OR (profile_rule.value #>> '{}')::numeric = 0
      OR jsonb_typeof(breakdown.value) IS DISTINCT FROM 'object'
      OR jsonb_typeof(breakdown.value->'stat') IS DISTINCT FROM 'number'
      OR jsonb_typeof(breakdown.value->'weight') IS DISTINCT FROM 'number'
      OR jsonb_typeof(breakdown.value->'points') IS DISTINCT FROM 'number'
      OR (raw_entry.stats ? breakdown.key
        AND jsonb_typeof(raw_entry.stats->breakdown.key) IS DISTINCT FROM 'number')
      OR abs((breakdown.value->>'weight')::numeric
        - (profile_rule.value #>> '{}')::numeric) > 0.000001
      OR abs((breakdown.value->>'stat')::numeric
        - COALESCE((raw_entry.stats->>breakdown.key)::numeric, 0)) > 0.000001
      OR abs((breakdown.value->>'points')::numeric
        - (breakdown.value->>'stat')::numeric
          * (breakdown.value->>'weight')::numeric) > 0.000001
  ) THEN
    RAISE EXCEPTION 'all-player scoring breakdown does not match its profile or statistics';
  END IF;
  SELECT COALESCE(sum((breakdown.value->>'points')::numeric), 0)
  INTO breakdown_total
  FROM jsonb_each(NEW.scoring_breakdown) breakdown;
  IF abs(breakdown_total - NEW.fantasy_points) > 0.0001 THEN
    RAISE EXCEPTION 'all-player score does not equal its scoring breakdown';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.prevent_all_player_parity_evidence_change()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  observation_id uuid;
BEGIN
  IF TG_OP = 'INSERT' THEN
    observation_id := (to_jsonb(NEW)->>'league_week_observation_id')::uuid;
  ELSE
    observation_id := COALESCE(
      (to_jsonb(OLD)->>'id')::uuid,
      (to_jsonb(OLD)->>'league_week_observation_id')::uuid
    );
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.all_player_score_sets score_set
    WHERE score_set.coverage->'parity_observation_ids' ? observation_id::text
  ) OR EXISTS (SELECT 1 FROM public.all_player_score_verifications verification
    WHERE verification.coverage->'parity_observation_ids' ? observation_id::text
  ) THEN
    IF TG_OP = 'INSERT' THEN
      IF TG_TABLE_NAME = 'official_player_point_observations' THEN
        IF EXISTS (
          SELECT 1 FROM public.official_player_point_observations existing
          WHERE existing.league_week_observation_id = NEW.league_week_observation_id
            AND existing.external_roster_id = NEW.external_roster_id
            AND existing.scoring_entity_id = NEW.scoring_entity_id
            AND existing.points IS NOT DISTINCT FROM NEW.points
            AND existing.is_starter = NEW.is_starter
            AND existing.lineup_slot IS NOT DISTINCT FROM NEW.lineup_slot
        ) THEN RETURN NEW; END IF;
      ELSIF TG_TABLE_NAME = 'official_roster_point_observations' THEN
        IF EXISTS (
          SELECT 1 FROM public.official_roster_point_observations existing
          WHERE existing.league_week_observation_id = NEW.league_week_observation_id
            AND existing.external_roster_id = NEW.external_roster_id
            AND existing.points IS NOT DISTINCT FROM NEW.points
        ) THEN RETURN NEW; END IF;
      END IF;
    END IF;
    RAISE EXCEPTION 'official all-player parity evidence is immutable while referenced';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.all_player_score_set_is_publication_ready(
  p_score_set_id uuid,
  p_expected_profile_ids jsonb,
  p_stat_observation_id uuid
)
RETURNS boolean
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  candidate record;
  verification_coverage jsonb;
  provided_observation_count integer;
  expected_observation_count integer;
  matched_observation_count integer;
  matched_league_count integer;
  evidence_mismatch_count integer;
  parity_row_count integer;
  parity_nonnull_count integer;
  parity_entity_count integer;
  parity_conflict_count integer;
  parity_score_mismatch_count integer;
BEGIN
  SELECT score_set.*, content.entry_count, profile.rules AS scoring_rules,
    profile.rules_hash AS scoring_rules_hash
  INTO candidate
  FROM public.all_player_score_sets score_set
  JOIN public.all_player_stat_contents content
    ON content.id = score_set.all_player_stat_content_id
  JOIN public.scoring_profiles profile ON profile.id = score_set.scoring_profile_id
  WHERE score_set.id = p_score_set_id;
  IF NOT FOUND THEN RETURN false; END IF;
  SELECT coverage INTO verification_coverage FROM public.all_player_score_verifications
    WHERE all_player_stat_observation_id = p_stat_observation_id
      AND all_player_score_set_id = p_score_set_id;
  IF NOT FOUND THEN RETURN false; END IF;
  candidate.coverage := verification_coverage;
  IF NOT EXISTS (SELECT 1 FROM public.current_all_player_score_sets pointer
    JOIN public.all_player_stat_observations observed ON observed.id = p_stat_observation_id
    WHERE pointer.provider = candidate.provider AND pointer.season = candidate.season
      AND pointer.season_type = candidate.season_type AND pointer.week = candidate.week
      AND pointer.scoring_profile_id = candidate.scoring_profile_id
      AND pointer.scorer_version = candidate.scorer_version
      AND observed.observed_at <= pointer.observed_at)
    AND EXISTS (SELECT 1 FROM public.all_player_scores score
      WHERE score.all_player_score_set_id = p_score_set_id AND NOT EXISTS (
        SELECT 1 FROM public.external_scoring_entity_ids mapping
        JOIN public.scoring_entities entity ON entity.id = mapping.scoring_entity_id
          AND entity.kind = score.entity_kind
        WHERE mapping.provider = candidate.provider AND mapping.entity_kind = score.entity_kind
          AND mapping.external_id = score.provider_external_id
          AND mapping.scoring_entity_id = score.scoring_entity_id
          AND mapping.mapping_status = 'verified' AND mapping.valid_from <= clock_timestamp()
          AND (mapping.valid_to IS NULL OR mapping.valid_to > clock_timestamp())
      )) THEN RETURN false; END IF;


  IF candidate.quality <> 'complete'
    OR candidate.scored_entity_count <> candidate.entry_count
    OR candidate.parity_comparison_count = 0
    OR candidate.parity_mismatch_count <> 0
    OR NOT candidate.coverage @> '{"complete":true,"identity_complete":true,"scoring_rules_complete":true}'::jsonb
    OR candidate.coverage->>'scoring_rules_hash' IS DISTINCT FROM candidate.scoring_rules_hash
    OR candidate.coverage->'expected_scoring_profile_ids' IS DISTINCT FROM p_expected_profile_ids
    OR btrim(COALESCE(candidate.coverage->>'all_player_source_revision', '')) = ''
    OR COALESCE(candidate.coverage->>'score_batch_fingerprint', '')
      !~ '^sha256:[0-9a-f]{64}$'
    OR jsonb_typeof(candidate.coverage->'parity_observation_ids') IS DISTINCT FROM 'array'
    OR jsonb_typeof(candidate.coverage->'parity_observation_evidence') IS DISTINCT FROM 'object'
    OR jsonb_typeof(candidate.coverage->'parity_expected_entity_count') IS DISTINCT FROM 'number'
    OR COALESCE(candidate.coverage->>'parity_fingerprint', '')
      !~ '^sha256:[0-9a-f]{64}$'
    OR public.all_player_scoring_contract_supported(
      candidate.provider, candidate.scorer_version, candidate.scoring_rules
    ) IS DISTINCT FROM true
    OR candidate.scored_entity_count <> (
      SELECT count(*) FROM public.all_player_scores score
      WHERE score.all_player_score_set_id = candidate.id
    )
    OR candidate.eligible_game_count <> COALESCE((
      SELECT sum(score.eligible_game_count) FROM public.all_player_scores score
      WHERE score.all_player_score_set_id = candidate.id
    ), 0)
    OR EXISTS (
      SELECT 1 FROM public.all_player_scores score
      WHERE score.all_player_score_set_id = candidate.id
        AND score.eligible_game_count = 1 AND score.nfl_game_id IS NULL
    ) THEN
    RETURN false;
  END IF;

  provided_observation_count := jsonb_array_length(
    candidate.coverage->'parity_observation_ids'
  );
  SELECT count(*) INTO expected_observation_count
  FROM public.leagues league
  JOIN public.league_seasons season ON season.league_id = league.id
  WHERE league.league_key IN ('league1', 'league2')
    AND season.season = candidate.season
    AND season.scoring_profile_id = candidate.scoring_profile_id;

  WITH provided AS (
    SELECT value::uuid AS observation_id
    FROM jsonb_array_elements_text(candidate.coverage->'parity_observation_ids') value
  ), matched AS (
    SELECT observation.id, observation.league_season_id
    FROM provided
    JOIN public.league_week_observations observation
      ON observation.id = provided.observation_id
    JOIN public.league_seasons season ON season.id = observation.league_season_id
    JOIN public.leagues league ON league.id = season.league_id
    JOIN public.league_source_connections connection
      ON connection.league_season_id = season.id
      AND connection.provider = candidate.provider
    JOIN public.league_period_authorities authority
      ON authority.league_key = league.league_key
      AND authority.source_provider = candidate.provider
      AND authority.source_external_league_id = connection.external_league_id
      AND authority.default_season = candidate.season
    WHERE observation.provider = candidate.provider
      AND observation.week = candidate.week
      AND observation.quality = 'complete'
      AND season.season = candidate.season
      AND season.scoring_profile_id = candidate.scoring_profile_id
      AND league.league_key IN ('league1', 'league2')
      AND observation.source_data->>'allPlayerSourceRevision'
        = candidate.coverage->>'all_player_source_revision'
  )
  SELECT count(*), count(DISTINCT league_season_id)
  INTO matched_observation_count, matched_league_count
  FROM matched;
  IF provided_observation_count = 0
    OR provided_observation_count <> expected_observation_count
    OR provided_observation_count <> matched_observation_count
    OR matched_observation_count <> matched_league_count THEN
    RETURN false;
  END IF;

  WITH provided AS (
    SELECT value::uuid AS observation_id
    FROM jsonb_array_elements_text(candidate.coverage->'parity_observation_ids') value
  ), matched AS (
    SELECT observation.id, observation.source_data,
      candidate.coverage->'parity_observation_evidence'->observation.id::text
        AS score_evidence,
      authority.expected_roster_count,
      (SELECT jsonb_agg(roster_id ORDER BY roster_id)
        FROM unnest(authority.expected_roster_ids) roster_id) AS expected_roster_ids
    FROM provided
    JOIN public.league_week_observations observation
      ON observation.id = provided.observation_id
    JOIN public.league_seasons season ON season.id = observation.league_season_id
    JOIN public.leagues league ON league.id = season.league_id
    JOIN public.league_source_connections connection
      ON connection.league_season_id = season.id
      AND connection.provider = candidate.provider
    JOIN public.league_period_authorities authority
      ON authority.league_key = league.league_key
      AND authority.source_provider = candidate.provider
      AND authority.source_external_league_id = connection.external_league_id
      AND authority.default_season = candidate.season
    WHERE season.scoring_profile_id = candidate.scoring_profile_id
  ), physical AS (
    SELECT matched.id,
      count(points.*)::integer AS player_count,
      count(points.points)::integer AS nonnull_player_count,
      count(score.provider_external_id)::integer AS mapped_player_count,
      count(DISTINCT points.scoring_entity_id)::integer AS unique_player_count,
      count(DISTINCT points.external_roster_id)::integer AS player_roster_count,
      ('sha256:' || encode(digest(convert_to(COALESCE(string_agg(
        score.provider_external_id || chr(31) || points.points::text,
        chr(10) ORDER BY score.provider_external_id
      ), ''), 'UTF8'), 'sha256'), 'hex')) AS fingerprint
    FROM matched
    LEFT JOIN public.official_player_point_observations points
      ON points.league_week_observation_id = matched.id
    LEFT JOIN public.all_player_scores score
      ON score.all_player_score_set_id = candidate.id
      AND score.scoring_entity_id = points.scoring_entity_id
    GROUP BY matched.id
  ), roster_physical AS (
    SELECT matched.id, count(rosters.*)::integer AS roster_count,
      COALESCE(jsonb_agg(rosters.external_roster_id ORDER BY rosters.external_roster_id)
        FILTER (WHERE rosters.external_roster_id IS NOT NULL), '[]'::jsonb) AS roster_ids
    FROM matched
    LEFT JOIN public.official_roster_point_observations rosters
      ON rosters.league_week_observation_id = matched.id
    GROUP BY matched.id
  )
  SELECT count(*) INTO evidence_mismatch_count
  FROM matched
  JOIN physical ON physical.id = matched.id
  JOIN roster_physical ON roster_physical.id = matched.id
  WHERE jsonb_typeof(matched.score_evidence) IS DISTINCT FROM 'object'
    OR matched.source_data->>'allPlayerSourceRevision'
      IS DISTINCT FROM candidate.coverage->>'all_player_source_revision'
    OR matched.source_data->'officialPlayersPointsEvidence' IS DISTINCT FROM matched.score_evidence
    OR matched.score_evidence->>'version' IS DISTINCT FROM 'players-points-v1'
    OR matched.score_evidence->>'expectedEntityCount' IS DISTINCT FROM physical.player_count::text
    OR matched.score_evidence->>'expectedRosterCount' IS DISTINCT FROM matched.expected_roster_count::text
    OR matched.score_evidence->'expectedRosterIds' IS DISTINCT FROM matched.expected_roster_ids
    OR matched.score_evidence->>'fingerprint' IS DISTINCT FROM physical.fingerprint
    OR physical.player_count = 0
    OR physical.player_count <> physical.nonnull_player_count
    OR physical.player_count <> physical.mapped_player_count
    OR physical.player_count <> physical.unique_player_count
    OR physical.player_roster_count <> matched.expected_roster_count
    OR roster_physical.roster_count <> matched.expected_roster_count
    OR roster_physical.roster_ids IS DISTINCT FROM matched.expected_roster_ids
    OR EXISTS (
      SELECT 1 FROM public.official_player_point_observations player_point
      WHERE player_point.league_week_observation_id = matched.id
        AND NOT EXISTS (
          SELECT 1 FROM public.official_roster_point_observations roster_point
          WHERE roster_point.league_week_observation_id = matched.id
            AND roster_point.external_roster_id = player_point.external_roster_id
        )
    );
  IF evidence_mismatch_count <> 0 THEN RETURN false; END IF;

  WITH provided AS (
    SELECT value::uuid AS observation_id
    FROM jsonb_array_elements_text(candidate.coverage->'parity_observation_ids') value
  ), official AS (
    SELECT points.scoring_entity_id, points.points
    FROM provided
    JOIN public.official_player_point_observations points
      ON points.league_week_observation_id = provided.observation_id
  ), grouped AS (
    SELECT scoring_entity_id, min(points) AS points, count(DISTINCT points) AS point_values
    FROM official GROUP BY scoring_entity_id
  )
  SELECT
    (SELECT count(*) FROM official),
    (SELECT count(*) FROM official WHERE points IS NOT NULL),
    (SELECT count(*) FROM grouped),
    (SELECT count(*) FROM grouped WHERE point_values <> 1),
    (SELECT count(*) FROM grouped
      LEFT JOIN public.all_player_scores score
        ON score.all_player_score_set_id = candidate.id
        AND score.scoring_entity_id = grouped.scoring_entity_id
      WHERE score.scoring_entity_id IS NULL
        OR abs(score.fantasy_points - grouped.points) > 0.0001)
  INTO parity_row_count, parity_nonnull_count, parity_entity_count,
    parity_conflict_count, parity_score_mismatch_count;
  RETURN parity_row_count > 0
    AND parity_row_count = parity_nonnull_count
    AND parity_entity_count = candidate.parity_comparison_count
    AND parity_entity_count = (candidate.coverage->>'parity_expected_entity_count')::integer
    AND parity_conflict_count = 0
    AND parity_score_mismatch_count = 0;
EXCEPTION WHEN OTHERS THEN
  RETURN false;
END;
$$;

CREATE OR REPLACE FUNCTION public.advance_current_all_player_score_set(
  p_provider text,
  p_season smallint,
  p_season_type text,
  p_week smallint,
  p_scoring_profile_id uuid,
  p_scorer_version text,
  p_stat_observation_id uuid,
  p_score_set_id uuid,
  p_verified_at timestamptz
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  candidate record;
  fence jsonb;
  current_pointer public.current_all_player_score_sets%ROWTYPE;
  current_semantic_hash text;
  provided_parity_observation_count integer;
  matched_parity_observation_count integer;
  matched_parity_league_count integer;
  parity_row_count integer;
  parity_nonnull_count integer;
  parity_entity_count integer;
  parity_conflict_count integer;
  parity_score_mismatch_count integer;
  parity_evidence_mismatch_count integer;
  expected_league_count integer;
  expected_profile_count integer;
  expected_profile_ids jsonb;
  expected_parity_league_count integer;
  coordinated_score_set_count integer;
  result text;
BEGIN
  fence := NULLIF(current_setting('league_one.all_player_fence', true), '')::jsonb;
  PERFORM public.assert_all_player_job_fence(fence,
    jsonb_build_object('season', p_season, 'seasonType', p_season_type, 'week', p_week), true);
  PERFORM pg_advisory_xact_lock(hashtextextended(
    p_provider || ':' || p_season::text || ':' || p_season_type || ':' || p_week::text
      || ':' || p_scoring_profile_id::text || ':' || p_scorer_version,
    0
  ));

  SELECT observation.observed_at, observation.source_revision,
    observation.quality AS observation_quality,
    observation.all_player_stat_content_id,
    content.quality AS content_quality, content.coverage AS content_coverage,
    content.entry_count,
    score_set.semantic_hash, score_set.quality AS score_quality,
    score_set.scored_entity_count, score_set.eligible_game_count,
    score_set.parity_comparison_count, score_set.parity_mismatch_count,
    verification.coverage, profile.rules_hash AS scoring_rules_hash,
    profile.rules AS scoring_rules
  INTO STRICT candidate
  FROM public.all_player_stat_observations observation
  JOIN public.all_player_stat_contents content
    ON content.id = observation.all_player_stat_content_id
  JOIN public.all_player_score_sets score_set
    ON score_set.id = p_score_set_id
    AND score_set.all_player_stat_content_id = observation.all_player_stat_content_id
  JOIN public.all_player_score_verifications verification
    ON verification.all_player_stat_observation_id = observation.id
      AND verification.all_player_score_set_id = score_set.id
  JOIN public.scoring_profiles profile ON profile.id = score_set.scoring_profile_id
  WHERE observation.id = p_stat_observation_id
    AND observation.provider = p_provider
    AND observation.season = p_season
    AND observation.season_type = p_season_type
    AND observation.week = p_week
    AND score_set.provider = p_provider
    AND score_set.season = p_season
    AND score_set.season_type = p_season_type
    AND score_set.week = p_week
    AND score_set.scoring_profile_id = p_scoring_profile_id
    AND score_set.scorer_version = p_scorer_version;

  IF p_season < 2026 OR p_season_type <> 'reg' THEN
    RAISE EXCEPTION 'all-player publication is limited to 2026+ regular seasons';
  END IF;
  IF candidate.observation_quality <> 'complete'
    OR candidate.content_quality <> 'complete'
    OR NOT candidate.content_coverage @> '{"complete":true}'::jsonb
    OR candidate.content_coverage->>'expectedInventoryFingerprint' IS NULL
    OR candidate.content_coverage->>'expectedInventoryFingerprint' !~ '^sha256:[0-9a-f]{64}$'
    OR btrim(COALESCE(candidate.content_coverage->>'catalogRevision', '')) = ''
    OR btrim(COALESCE(candidate.content_coverage->>'scheduleRevision', '')) = ''
    OR COALESCE(candidate.content_coverage->>'rosterInventoryFingerprint', '')
      !~ '^sha256:[0-9a-f]{64}$'
    OR COALESCE(candidate.content_coverage->>'projectionInventoryFingerprint', '')
      !~ '^sha256:[0-9a-f]{64}$'
    OR COALESCE(candidate.content_coverage->>'byeInventoryFingerprint', '')
      !~ '^sha256:[0-9a-f]{64}$'
    OR jsonb_typeof(candidate.content_coverage->'expectedEntityCount') IS DISTINCT FROM 'number'
    OR jsonb_typeof(candidate.content_coverage->'expectedPlayerCount') IS DISTINCT FROM 'number'
    OR jsonb_typeof(candidate.content_coverage->'providerPresentEntityCount') IS DISTINCT FROM 'number'
    OR jsonb_typeof(candidate.content_coverage->'providerMissingEntityCount') IS DISTINCT FROM 'number'
    OR candidate.content_coverage->>'expectedTeamDefenseCount' IS DISTINCT FROM '32'
    OR candidate.content_coverage->>'expectedEntityCount' IS DISTINCT FROM candidate.entry_count::text
    OR candidate.content_coverage->>'fantasyEntityCount' IS DISTINCT FROM candidate.entry_count::text
    OR candidate.content_coverage->>'unknownEligibilityCount' IS DISTINCT FROM '0'
    OR candidate.content_coverage->>'unmappedGameCount' IS DISTINCT FROM '0'
    OR candidate.content_coverage->>'unexpectedResponseEntityCount' IS DISTINCT FROM '0'
    OR (candidate.content_coverage->>'providerPresentEntityCount')::integer
      + (candidate.content_coverage->>'providerMissingEntityCount')::integer
      <> candidate.entry_count
    OR candidate.score_quality <> 'complete'
    OR candidate.parity_comparison_count = 0
    OR candidate.parity_mismatch_count <> 0
    OR NOT candidate.coverage @> '{"complete":true,"identity_complete":true,"scoring_rules_complete":true}'::jsonb
    OR candidate.coverage->>'scoring_rules_hash' IS DISTINCT FROM candidate.scoring_rules_hash
    OR candidate.coverage->>'all_player_source_revision' IS DISTINCT FROM candidate.source_revision
    OR jsonb_typeof(candidate.coverage->'parity_observation_ids') IS DISTINCT FROM 'array'
    OR jsonb_typeof(candidate.coverage->'parity_observation_evidence') IS DISTINCT FROM 'object'
    OR jsonb_typeof(candidate.coverage->'expected_scoring_profile_ids') IS DISTINCT FROM 'array'
    OR COALESCE(candidate.coverage->>'score_batch_fingerprint', '')
      !~ '^sha256:[0-9a-f]{64}$'
    OR jsonb_typeof(candidate.coverage->'parity_expected_entity_count') IS DISTINCT FROM 'number'
    OR candidate.coverage->>'parity_fingerprint' IS NULL
    OR candidate.coverage->>'parity_fingerprint' !~ '^sha256:[0-9a-f]{64}$'
    OR candidate.entry_count <> (
      SELECT count(*) FROM public.all_player_stat_entries entry
      WHERE entry.all_player_stat_content_id = candidate.all_player_stat_content_id
    )
    OR 32 <> (
      SELECT count(*) FROM public.all_player_stat_entries entry
      WHERE entry.all_player_stat_content_id = candidate.all_player_stat_content_id
        AND entry.entity_kind = 'team_defense' AND entry.position = 'DEF'
    )
    OR (candidate.content_coverage->>'expectedPlayerCount')::integer <> (
      SELECT count(*) FROM public.all_player_stat_entries entry
      WHERE entry.all_player_stat_content_id = candidate.all_player_stat_content_id
        AND entry.entity_kind = 'player'
    )
    OR EXISTS (
      SELECT 1 FROM public.all_player_stat_entries entry
      WHERE entry.all_player_stat_content_id = candidate.all_player_stat_content_id
        AND (entry.eligible_game_count IS NULL OR entry.appearance_game_count IS NULL)
    )
    OR candidate.scored_entity_count <> (
      SELECT count(*) FROM public.all_player_scores score
      WHERE score.all_player_score_set_id = p_score_set_id
    )
    OR candidate.scored_entity_count <> candidate.entry_count
    OR EXISTS (
      SELECT 1 FROM public.all_player_scores score
      WHERE score.all_player_score_set_id = p_score_set_id
        AND score.eligible_game_count = 1 AND score.nfl_game_id IS NULL
    )
    OR candidate.eligible_game_count <> COALESCE((
      SELECT sum(score.eligible_game_count) FROM public.all_player_scores score
      WHERE score.all_player_score_set_id = p_score_set_id
    ), 0) THEN
    RAISE EXCEPTION 'all-player score set is not publication eligible';
  END IF;
  IF public.all_player_scoring_contract_supported(
    p_provider, p_scorer_version, candidate.scoring_rules
  ) IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'all-player scoring profile is unsupported by this scorer contract';
  END IF;

  WITH canonical_leagues AS (
    SELECT season.id AS league_season_id, season.scoring_profile_id
    FROM public.leagues league
    JOIN public.league_seasons season ON season.league_id = league.id
    WHERE league.league_key IN ('league1', 'league2') AND season.season = p_season
  ), expected_profiles AS (
    SELECT DISTINCT scoring_profile_id FROM canonical_leagues
  )
  SELECT
    (SELECT count(*) FROM canonical_leagues),
    (SELECT count(*) FROM expected_profiles),
    (SELECT jsonb_agg(scoring_profile_id::text ORDER BY scoring_profile_id::text)
      FROM expected_profiles),
    (SELECT count(*) FROM canonical_leagues
      WHERE scoring_profile_id = p_scoring_profile_id)
  INTO expected_league_count, expected_profile_count, expected_profile_ids,
    expected_parity_league_count;
  IF expected_league_count <> 2 OR expected_profile_count = 0
    OR expected_parity_league_count = 0
    OR candidate.coverage->'expected_scoring_profile_ids' IS DISTINCT FROM expected_profile_ids THEN
    RAISE EXCEPTION 'all-player score batch does not cover the canonical league scoring profiles';
  END IF;
  SELECT count(DISTINCT coordinated.scoring_profile_id) INTO coordinated_score_set_count
  FROM public.all_player_score_sets coordinated
  JOIN public.all_player_score_verifications peer_verification
    ON peer_verification.all_player_score_set_id = coordinated.id
      AND peer_verification.all_player_stat_observation_id = p_stat_observation_id
  WHERE coordinated.all_player_stat_content_id = candidate.all_player_stat_content_id
    AND coordinated.provider = p_provider
    AND coordinated.season = p_season
    AND coordinated.season_type = p_season_type
    AND coordinated.week = p_week
    AND coordinated.scorer_version = p_scorer_version
    AND coordinated.quality = 'complete'
    AND peer_verification.coverage->>'score_batch_fingerprint'
      = candidate.coverage->>'score_batch_fingerprint'
    AND peer_verification.coverage->>'all_player_source_revision' = candidate.source_revision
    AND peer_verification.coverage->'expected_scoring_profile_ids' = expected_profile_ids
    AND public.all_player_score_set_is_publication_ready(
      coordinated.id, expected_profile_ids, p_stat_observation_id
    ) IS TRUE
    AND coordinated.scoring_profile_id IN (
      SELECT DISTINCT season.scoring_profile_id
      FROM public.leagues league
      JOIN public.league_seasons season ON season.league_id = league.id
      WHERE league.league_key IN ('league1', 'league2') AND season.season = p_season
    );
  IF coordinated_score_set_count <> expected_profile_count THEN
    RAISE EXCEPTION 'all-player score batch is missing a canonical scoring profile';
  END IF;

  SELECT jsonb_array_length(candidate.coverage->'parity_observation_ids')
  INTO provided_parity_observation_count;
  WITH provided AS (
    SELECT value::uuid AS observation_id
    FROM jsonb_array_elements_text(candidate.coverage->'parity_observation_ids') value
  ), matched AS (
    SELECT observation.id, observation.league_season_id, observation.source_data
    FROM provided
    JOIN public.league_week_observations observation
      ON observation.id = provided.observation_id
    JOIN public.league_seasons season ON season.id = observation.league_season_id
    JOIN public.leagues league ON league.id = season.league_id
    JOIN public.league_source_connections connection
      ON connection.league_season_id = season.id AND connection.provider = p_provider
    JOIN public.league_period_authorities authority
      ON authority.league_key = league.league_key
      AND authority.source_provider = p_provider
      AND authority.source_external_league_id = connection.external_league_id
      AND authority.default_season = p_season
    WHERE observation.provider = p_provider AND observation.week = p_week
      AND observation.quality = 'complete' AND season.season = p_season
      AND season.scoring_profile_id = p_scoring_profile_id
      AND league.league_key IN ('league1', 'league2')
      AND observation.source_data->>'allPlayerSourceRevision' = candidate.source_revision
  )
  SELECT count(*), count(DISTINCT league_season_id)
  INTO matched_parity_observation_count, matched_parity_league_count
  FROM matched;
  IF provided_parity_observation_count = 0
    OR provided_parity_observation_count <> matched_parity_observation_count
    OR matched_parity_observation_count <> matched_parity_league_count
    OR matched_parity_league_count <> expected_parity_league_count THEN
    RAISE EXCEPTION 'all-player parity observations are incomplete';
  END IF;

  WITH provided AS (
    SELECT value::uuid AS observation_id
    FROM jsonb_array_elements_text(candidate.coverage->'parity_observation_ids') value
  ), matched AS (
    SELECT observation.id, observation.source_data,
      candidate.coverage->'parity_observation_evidence'->observation.id::text
        AS score_evidence,
      authority.expected_roster_count,
      (SELECT jsonb_agg(roster_id ORDER BY roster_id)
        FROM unnest(authority.expected_roster_ids) roster_id) AS expected_roster_ids
    FROM provided
    JOIN public.league_week_observations observation
      ON observation.id = provided.observation_id
    JOIN public.league_seasons season ON season.id = observation.league_season_id
    JOIN public.leagues league ON league.id = season.league_id
    JOIN public.league_source_connections connection
      ON connection.league_season_id = season.id AND connection.provider = p_provider
    JOIN public.league_period_authorities authority
      ON authority.league_key = league.league_key
      AND authority.source_provider = p_provider
      AND authority.source_external_league_id = connection.external_league_id
      AND authority.default_season = p_season
    WHERE season.scoring_profile_id = p_scoring_profile_id
  ), physical AS (
    SELECT matched.id,
      count(points.*)::integer AS player_count,
      count(points.points)::integer AS nonnull_player_count,
      count(score.provider_external_id)::integer AS mapped_player_count,
      count(DISTINCT points.scoring_entity_id)::integer AS unique_player_count,
      count(DISTINCT points.external_roster_id)::integer AS player_roster_count,
      ('sha256:' || encode(digest(convert_to(COALESCE(string_agg(
        score.provider_external_id || chr(31) || points.points::text,
        chr(10) ORDER BY score.provider_external_id
      ), ''), 'UTF8'), 'sha256'), 'hex')) AS fingerprint
    FROM matched
    LEFT JOIN public.official_player_point_observations points
      ON points.league_week_observation_id = matched.id
    LEFT JOIN public.all_player_scores score
      ON score.all_player_score_set_id = p_score_set_id
      AND score.scoring_entity_id = points.scoring_entity_id
    GROUP BY matched.id
  ), roster_physical AS (
    SELECT matched.id, count(rosters.*)::integer AS roster_count,
      COALESCE(jsonb_agg(rosters.external_roster_id ORDER BY rosters.external_roster_id)
        FILTER (WHERE rosters.external_roster_id IS NOT NULL), '[]'::jsonb) AS roster_ids
    FROM matched
    LEFT JOIN public.official_roster_point_observations rosters
      ON rosters.league_week_observation_id = matched.id
    GROUP BY matched.id
  )
  SELECT count(*) INTO parity_evidence_mismatch_count
  FROM matched
  JOIN physical ON physical.id = matched.id
  JOIN roster_physical ON roster_physical.id = matched.id
  WHERE jsonb_typeof(matched.score_evidence) IS DISTINCT FROM 'object'
    OR matched.source_data->>'allPlayerSourceRevision' IS DISTINCT FROM candidate.source_revision
    OR matched.source_data->'officialPlayersPointsEvidence' IS DISTINCT FROM matched.score_evidence
    OR matched.score_evidence->>'version' IS DISTINCT FROM 'players-points-v1'
    OR matched.score_evidence->>'expectedEntityCount' IS DISTINCT FROM physical.player_count::text
    OR matched.score_evidence->>'expectedRosterCount' IS DISTINCT FROM matched.expected_roster_count::text
    OR matched.score_evidence->'expectedRosterIds' IS DISTINCT FROM matched.expected_roster_ids
    OR matched.score_evidence->>'fingerprint' IS DISTINCT FROM physical.fingerprint
    OR physical.player_count = 0
    OR physical.player_count <> physical.nonnull_player_count
    OR physical.player_count <> physical.mapped_player_count
    OR physical.player_count <> physical.unique_player_count
    OR physical.player_roster_count <> matched.expected_roster_count
    OR roster_physical.roster_count <> matched.expected_roster_count
    OR roster_physical.roster_ids IS DISTINCT FROM matched.expected_roster_ids
    OR EXISTS (
      SELECT 1 FROM public.official_player_point_observations player_point
      WHERE player_point.league_week_observation_id = matched.id
        AND NOT EXISTS (
          SELECT 1 FROM public.official_roster_point_observations roster_point
          WHERE roster_point.league_week_observation_id = matched.id
            AND roster_point.external_roster_id = player_point.external_roster_id
        )
    );
  IF parity_evidence_mismatch_count <> 0 THEN
    RAISE EXCEPTION 'all-player parity evidence is stale, partial, or malformed';
  END IF;

  WITH provided AS (
    SELECT value::uuid AS observation_id
    FROM jsonb_array_elements_text(candidate.coverage->'parity_observation_ids') value
  ), official AS (
    SELECT points.scoring_entity_id, points.points
    FROM provided
    JOIN public.official_player_point_observations points
      ON points.league_week_observation_id = provided.observation_id
  ), grouped AS (
    SELECT scoring_entity_id, min(points) AS points, count(DISTINCT points) AS point_values
    FROM official GROUP BY scoring_entity_id
  )
  SELECT
    (SELECT count(*) FROM official),
    (SELECT count(*) FROM official WHERE points IS NOT NULL),
    (SELECT count(*) FROM grouped),
    (SELECT count(*) FROM grouped WHERE point_values <> 1),
    (SELECT count(*) FROM grouped
      LEFT JOIN public.all_player_scores score
        ON score.all_player_score_set_id = p_score_set_id
        AND score.scoring_entity_id = grouped.scoring_entity_id
      WHERE score.scoring_entity_id IS NULL
        OR abs(score.fantasy_points - grouped.points) > 0.0001)
  INTO parity_row_count, parity_nonnull_count, parity_entity_count,
    parity_conflict_count, parity_score_mismatch_count;
  IF parity_row_count = 0 OR parity_row_count <> parity_nonnull_count
    OR parity_entity_count <> candidate.parity_comparison_count
    OR parity_entity_count <> (candidate.coverage->>'parity_expected_entity_count')::integer
    OR parity_conflict_count <> 0 OR parity_score_mismatch_count <> 0 THEN
    RAISE EXCEPTION 'all-player rostered scoring parity is incomplete or mismatched';
  END IF;
  IF p_verified_at < candidate.observed_at THEN
    RAISE EXCEPTION 'all-player verification precedes its observation';
  END IF;

  SELECT pointer.* INTO current_pointer
  FROM public.current_all_player_score_sets pointer
  WHERE pointer.provider = p_provider AND pointer.season = p_season
    AND pointer.season_type = p_season_type AND pointer.week = p_week
    AND pointer.scoring_profile_id = p_scoring_profile_id
    AND pointer.scorer_version = p_scorer_version
  FOR UPDATE;

  IF FOUND AND candidate.observed_at < current_pointer.observed_at THEN
    RETURN 'superseded';
  END IF;
  IF FOUND AND candidate.observed_at = current_pointer.observed_at
    AND (p_stat_observation_id <> current_pointer.all_player_stat_observation_id
      OR p_score_set_id <> current_pointer.all_player_score_set_id) THEN
    RAISE EXCEPTION 'all-player pointer conflict: equal observation time has different content';
  END IF;

  IF FOUND THEN
    SELECT score_set.semantic_hash INTO STRICT current_semantic_hash
    FROM public.all_player_score_sets score_set
    WHERE score_set.id = current_pointer.all_player_score_set_id;
    result := CASE WHEN current_semantic_hash = candidate.semantic_hash
      THEN 'verified' ELSE 'advanced' END;
  ELSE
    result := 'advanced';
  END IF;

  -- Locking prevents takeover during this transaction; check the real clock again
  -- after parity validation so an owner that expired during SQL cannot publish.
  PERFORM public.assert_all_player_job_fence(fence,
    jsonb_build_object('season', p_season, 'seasonType', p_season_type, 'week', p_week), true);
  INSERT INTO public.current_all_player_score_sets (
    provider, season, season_type, week, scoring_profile_id, scorer_version,
    all_player_stat_observation_id, all_player_score_set_id, observed_at,
    verified_at, material_changed_at
  ) VALUES (
    p_provider, p_season, p_season_type, p_week, p_scoring_profile_id, p_scorer_version,
    p_stat_observation_id, p_score_set_id, candidate.observed_at,
    p_verified_at, p_verified_at
  )
  ON CONFLICT (provider, season, season_type, week, scoring_profile_id, scorer_version)
  DO UPDATE SET
    all_player_stat_observation_id = EXCLUDED.all_player_stat_observation_id,
    all_player_score_set_id = EXCLUDED.all_player_score_set_id,
    observed_at = EXCLUDED.observed_at,
    verified_at = GREATEST(
      public.current_all_player_score_sets.verified_at, EXCLUDED.verified_at
    ),
    material_changed_at = CASE
      WHEN result = 'verified'
      THEN public.current_all_player_score_sets.material_changed_at
      ELSE EXCLUDED.material_changed_at
    END;
  UPDATE public.projection_jobs SET payload = payload || jsonb_build_object('lastPublication',
    jsonb_build_object('generation',(fence->>'generation')::integer,
      'period',jsonb_build_object('season',p_season,'seasonType',p_season_type,'week',p_week),
      'observationId',p_stat_observation_id,'scorerVersion',p_scorer_version,
      'profileIds',expected_profile_ids,'publishedAt',clock_timestamp()))
    WHERE job_key = 'all-player-ingestion:sleeper';
  RETURN result;
END;
$$;
REVOKE ALL ON FUNCTION public.all_player_score_set_is_publication_ready(uuid,jsonb,uuid) FROM PUBLIC;

-- Incorporated verbatim into migration 011; this is not an independently installed migration.
CREATE OR REPLACE FUNCTION public.all_player_eligibility_evidence_matches(
  p_evidence jsonb, p_eligible_game_count smallint, p_appearance_game_count smallint
)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  evidence_kind text;
  active_count smallint;
  appearance_count smallint;
  expected_eligible smallint;
  expected_appearance smallint;
  period_evidence jsonb;
  weekly jsonb;
  has_conflict boolean;
  invalid_flags boolean;
BEGIN
  IF jsonb_typeof(p_evidence) IS DISTINCT FROM 'object' THEN RETURN false; END IF;
  evidence_kind := p_evidence->>'kind';
  IF evidence_kind = 'weekly-stat' THEN
    IF p_evidence - ARRAY['kind', 'source', 'gmsActive', 'appearances', 'rawFlags'] <> '{}'::jsonb
      OR p_evidence->>'source' IS DISTINCT FROM 'weekly-stat-provider'
      OR (p_evidence ? 'gmsActive' AND (jsonb_typeof(p_evidence->'gmsActive') IS DISTINCT FROM 'number'
        OR p_evidence->>'gmsActive' NOT IN ('0','1')))
      OR (p_evidence ? 'appearances' AND (jsonb_typeof(p_evidence->'appearances') IS DISTINCT FROM 'number'
        OR p_evidence->>'appearances' NOT IN ('0','1'))) THEN RETURN false; END IF;
    IF p_evidence ? 'rawFlags' THEN
      IF jsonb_typeof(p_evidence->'rawFlags') IS DISTINCT FROM 'object'
        OR p_evidence->'rawFlags' = '{}'::jsonb
        OR (p_evidence->'rawFlags') - ARRAY['gms_active','gp'] <> '{}'::jsonb
        OR EXISTS (SELECT 1 FROM jsonb_each(p_evidence->'rawFlags') AS flag
          WHERE flag.value IN ('0'::jsonb, '1'::jsonb)) THEN RETURN false; END IF;
      RETURN p_eligible_game_count IS NULL AND p_appearance_game_count IS NULL;
    END IF;
    active_count := (p_evidence->>'gmsActive')::smallint;
    appearance_count := (p_evidence->>'appearances')::smallint;
    IF active_count = 0 AND appearance_count = 1 THEN
      RETURN p_eligible_game_count IS NULL AND p_appearance_game_count IS NULL;
    ELSIF active_count = 0 THEN expected_eligible := 0; expected_appearance := 0;
    ELSIF appearance_count = 1 THEN expected_eligible := 1; expected_appearance := 1;
    ELSIF active_count = 1 AND appearance_count = 0 THEN expected_eligible := 1; expected_appearance := 0;
    END IF;
    RETURN p_eligible_game_count IS NOT DISTINCT FROM expected_eligible
      AND p_appearance_game_count IS NOT DISTINCT FROM expected_appearance;
  ELSIF evidence_kind IN ('explicit-ineligible', 'period-participation') THEN
    IF jsonb_typeof(p_evidence->'sourceRevision') IS DISTINCT FROM 'string'
      OR btrim(p_evidence->>'sourceRevision') = ''
      OR jsonb_typeof(p_evidence->'observedAt') IS DISTINCT FROM 'string'
      OR p_evidence->>'observedAt' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z$'
      OR jsonb_typeof(p_evidence->'effectivePeriod') IS DISTINCT FROM 'object'
      OR (p_evidence->'effectivePeriod') - ARRAY['season','seasonType','week'] <> '{}'::jsonb
      OR jsonb_typeof(p_evidence->'effectivePeriod'->'season') IS DISTINCT FROM 'number'
      OR jsonb_typeof(p_evidence->'effectivePeriod'->'week') IS DISTINCT FROM 'number'
      OR p_evidence->'effectivePeriod'->>'seasonType' IS DISTINCT FROM 'reg'
      OR (p_evidence->'effectivePeriod'->>'season') !~ '^[0-9]+$'
      OR (p_evidence->'effectivePeriod'->>'week') !~ '^[0-9]+$'
      OR (p_evidence->'effectivePeriod'->>'season')::integer NOT BETWEEN 2026 AND 2200
      OR (p_evidence->'effectivePeriod'->>'week')::integer NOT BETWEEN 1 AND 18 THEN RETURN false; END IF;
    BEGIN
      IF NOT isfinite((p_evidence->>'observedAt')::timestamptz) THEN RETURN false; END IF;
    EXCEPTION WHEN others THEN RETURN false;
    END;
    IF evidence_kind = 'explicit-ineligible' THEN
      RETURN COALESCE(p_evidence - ARRAY['kind','reason','source','sourceRevision','observedAt','effectivePeriod'] = '{}'::jsonb
        AND p_evidence->>'reason' IN ('inactive','suspended','reserve','bye','teamless','other')
        AND p_evidence->>'source' IN ('player-status-provider','schedule','manual-review')
        AND p_eligible_game_count = 0 AND p_appearance_game_count = 0, false);
    END IF;
    IF p_evidence - ARRAY['kind','decision','source','sourceRevision','observedAt','effectivePeriod','reason','weekly'] <> '{}'::jsonb
      OR COALESCE(p_evidence->>'decision','') NOT IN ('appearance','dressed-unused','ineligible','ambiguous')
      OR COALESCE(p_evidence->>'source','') NOT IN ('gamebook','official-period-roster','manual-review')
      OR jsonb_typeof(p_evidence->'reason') IS DISTINCT FROM 'string'
      OR btrim(p_evidence->>'reason') = '' THEN RETURN false; END IF;
    IF p_evidence ? 'weekly' THEN
      weekly := p_evidence->'weekly';
      IF weekly->>'kind' IS DISTINCT FROM 'weekly-stat' OR NOT (
        public.all_player_eligibility_evidence_matches(weekly,0::smallint,0::smallint)
        OR public.all_player_eligibility_evidence_matches(weekly,1::smallint,0::smallint)
        OR public.all_player_eligibility_evidence_matches(weekly,1::smallint,1::smallint)
        OR public.all_player_eligibility_evidence_matches(weekly,NULL::smallint,NULL::smallint)
      ) THEN RETURN false; END IF;
    END IF;
    IF p_evidence->>'decision' = 'ambiguous' THEN
      RETURN p_eligible_game_count IS NULL AND p_appearance_game_count IS NULL;
    ELSIF p_evidence->>'decision' = 'appearance' THEN expected_eligible := 1; expected_appearance := 1;
    ELSIF p_evidence->>'decision' = 'dressed-unused' THEN expected_eligible := 1; expected_appearance := 0;
    ELSE expected_eligible := 0; expected_appearance := 0;
    END IF;
    IF weekly IS NOT NULL THEN
      invalid_flags := weekly ? 'rawFlags' OR (weekly->>'gmsActive' = '0' AND weekly->>'appearances' = '1');
      has_conflict := NOT public.all_player_eligibility_evidence_matches(weekly,NULL::smallint,NULL::smallint)
        AND NOT public.all_player_eligibility_evidence_matches(weekly,expected_eligible,expected_appearance);
      IF COALESCE(invalid_flags,false) OR has_conflict THEN
        RETURN p_eligible_game_count IS NULL AND p_appearance_game_count IS NULL;
      END IF;
    END IF;
    RETURN p_eligible_game_count IS NOT DISTINCT FROM expected_eligible
      AND p_appearance_game_count IS NOT DISTINCT FROM expected_appearance;
  ELSIF evidence_kind IN ('combined-ineligible','conflict') THEN
    IF p_evidence - ARRAY['kind','weekly','ineligibility'] <> '{}'::jsonb
      OR p_evidence->'ineligibility'->>'kind' IS DISTINCT FROM 'explicit-ineligible'
      OR NOT public.all_player_eligibility_evidence_matches(p_evidence->'ineligibility',0::smallint,0::smallint)
      OR p_evidence->'weekly'->>'kind' IS DISTINCT FROM 'weekly-stat' THEN RETURN false; END IF;
    weekly := p_evidence->'weekly';
    IF NOT (public.all_player_eligibility_evidence_matches(weekly,0::smallint,0::smallint)
      OR public.all_player_eligibility_evidence_matches(weekly,1::smallint,0::smallint)
      OR public.all_player_eligibility_evidence_matches(weekly,1::smallint,1::smallint)
      OR public.all_player_eligibility_evidence_matches(weekly,NULL::smallint,NULL::smallint)) THEN RETURN false; END IF;
    has_conflict := public.all_player_eligibility_evidence_matches(weekly,1::smallint,0::smallint)
      OR public.all_player_eligibility_evidence_matches(weekly,1::smallint,1::smallint)
      OR weekly ? 'rawFlags'
      OR COALESCE(weekly->>'gmsActive' = '0' AND weekly->>'appearances' = '1',false);
    IF evidence_kind = 'conflict' THEN
      RETURN has_conflict AND p_eligible_game_count IS NULL AND p_appearance_game_count IS NULL;
    END IF;
    RETURN COALESCE(NOT has_conflict AND p_eligible_game_count = 0 AND p_appearance_game_count = 0,false);
  ELSIF evidence_kind = 'missing-provider-row' THEN
    RETURN p_evidence - ARRAY['kind','inventoryFingerprint'] = '{}'::jsonb
      AND COALESCE(p_evidence->>'inventoryFingerprint','') ~ '^sha256:[0-9a-f]{64}$'
      AND p_eligible_game_count IS NULL AND p_appearance_game_count IS NULL;
  ELSIF evidence_kind = 'unknown-weekly-stat' THEN
    RETURN p_evidence = '{"kind":"unknown-weekly-stat","source":"weekly-stat-provider"}'::jsonb
      AND p_eligible_game_count IS NULL AND p_appearance_game_count IS NULL;
  END IF;
  RETURN false;
EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN RETURN false;
END;
$$;

CREATE OR REPLACE FUNCTION public.validate_all_player_stat_entry()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  content_context record;
  game_context record;
  period_evidence jsonb;
  weekly_evidence jsonb;
  raw_key text;
  evidence_key text;
  expected_raw jsonb;
BEGIN
  IF public.all_player_eligibility_evidence_matches(NEW.eligibility_evidence,
    NEW.eligible_game_count,NEW.appearance_game_count) IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'all-player eligibility evidence does not support its counts';
  END IF;
  SELECT season,season_type,week INTO STRICT content_context
  FROM public.all_player_stat_contents WHERE id = NEW.all_player_stat_content_id;
  weekly_evidence := CASE WHEN NEW.eligibility_evidence->>'kind' = 'weekly-stat'
    THEN NEW.eligibility_evidence ELSE NEW.eligibility_evidence->'weekly' END;
  IF weekly_evidence IS NOT NULL THEN
    FOREACH raw_key IN ARRAY ARRAY['gms_active','gp'] LOOP
      evidence_key := CASE WHEN raw_key = 'gms_active' THEN 'gmsActive' ELSE 'appearances' END;
      IF weekly_evidence->'rawFlags' ? raw_key THEN
        expected_raw := CASE WHEN jsonb_typeof(weekly_evidence->'rawFlags'->raw_key) = 'number'
          THEN weekly_evidence->'rawFlags'->raw_key ELSE NULL END;
      ELSE expected_raw := weekly_evidence->evidence_key;
      END IF;
      IF NEW.stats->raw_key IS DISTINCT FROM expected_raw THEN
        RAISE EXCEPTION 'all-player weekly eligibility flag disagrees with retained statistics';
      END IF;
    END LOOP;
  END IF;
  period_evidence := CASE WHEN NEW.eligibility_evidence->>'kind' IN ('combined-ineligible','conflict')
    THEN NEW.eligibility_evidence->'ineligibility'
    WHEN NEW.eligibility_evidence->>'kind' IN ('explicit-ineligible','period-participation')
    THEN NEW.eligibility_evidence ELSE NULL END;
  IF period_evidence IS NOT NULL AND (
    (period_evidence->'effectivePeriod'->>'season')::integer IS DISTINCT FROM content_context.season
    OR period_evidence->'effectivePeriod'->>'seasonType' IS DISTINCT FROM content_context.season_type
    OR (period_evidence->'effectivePeriod'->>'week')::integer IS DISTINCT FROM content_context.week
  ) THEN RAISE EXCEPTION 'all-player eligibility evidence does not match its content period'; END IF;
  IF NEW.eligible_game_count = 1 AND NEW.nfl_game_id IS NULL THEN
    RAISE EXCEPTION 'eligible all-player entry requires an NFL game';
  END IF;
  IF NEW.nfl_game_id IS NOT NULL THEN
    SELECT season,season_type,week,home_team,away_team INTO STRICT game_context
    FROM public.nfl_games WHERE id = NEW.nfl_game_id;
    IF NEW.nfl_team IS NULL OR game_context.season <> content_context.season
      OR game_context.season_type <> content_context.season_type OR game_context.week <> content_context.week
      OR NEW.nfl_team NOT IN (game_context.home_team,game_context.away_team) THEN
      RAISE EXCEPTION 'all-player NFL game does not match its content period and team';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

-- Explicit fence overload for application and operator callers. The previous
-- signature remains guarded and fails without a transaction-bound live fence.
CREATE FUNCTION public.advance_current_all_player_score_set(
  p_provider text, p_season smallint, p_season_type text, p_week smallint,
  p_scoring_profile_id uuid, p_scorer_version text, p_stat_observation_id uuid,
  p_score_set_id uuid, p_verified_at timestamptz, p_fence jsonb
)
RETURNS text LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  PERFORM set_config('league_one.all_player_fence', p_fence::text, true);
  RETURN public.advance_current_all_player_score_set(p_provider,p_season,p_season_type,p_week,
    p_scoring_profile_id,p_scorer_version,p_stat_observation_id,p_score_set_id,p_verified_at);
END;
$$;
REVOKE ALL ON FUNCTION public.advance_current_all_player_score_set(
  text,smallint,text,smallint,uuid,text,uuid,uuid,timestamptz,jsonb) FROM PUBLIC;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'league_one_runtime') THEN
    GRANT EXECUTE ON FUNCTION public.advance_current_all_player_score_set(
      text,smallint,text,smallint,uuid,text,uuid,uuid,timestamptz,jsonb) TO league_one_runtime;
  END IF;
END; $$;

-- Direct runtime job DML may serve ordinary jobs, but must never erase the global
-- provider budget. SECURITY INVOKER is deliberate: only the owner, including the
-- reviewed SECURITY DEFINER helpers, may mutate this one existing job row.
CREATE FUNCTION public.protect_all_player_global_job()
RETURNS trigger LANGUAGE plpgsql
SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  IF (TG_OP <> 'DELETE' AND NEW.job_key = 'all-player-ingestion:sleeper')
    OR (TG_OP <> 'INSERT' AND OLD.job_key = 'all-player-ingestion:sleeper') THEN
    IF current_user::regrole::oid IS DISTINCT FROM (
      SELECT relowner FROM pg_class WHERE oid = TG_RELID
    ) THEN RAISE EXCEPTION 'all-player global budget requires the dedicated job functions'; END IF;
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.protect_all_player_global_job() FROM PUBLIC;
CREATE TRIGGER projection_jobs_all_player_budget_guard
  BEFORE INSERT OR UPDATE OR DELETE ON public.projection_jobs
  FOR EACH ROW EXECUTE FUNCTION public.protect_all_player_global_job();

CREATE FUNCTION public.verify_all_player_pointer_job_fence()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  PERFORM public.assert_all_player_job_fence(
    NULLIF(current_setting('league_one.all_player_fence',true),'')::jsonb,
    jsonb_build_object('season',NEW.season,'seasonType',NEW.season_type,'week',NEW.week), true);
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.verify_all_player_pointer_job_fence() FROM PUBLIC;
CREATE CONSTRAINT TRIGGER current_all_player_score_sets_job_fence
  AFTER INSERT OR UPDATE ON public.current_all_player_score_sets DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION public.verify_all_player_pointer_job_fence();

CREATE FUNCTION public.record_all_player_preclaim_outcome(p_input jsonb)
RETURNS text LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE job public.projection_jobs%ROWTYPE; recorded timestamptz; context jsonb; result jsonb;
BEGIN
  IF jsonb_typeof(p_input) IS DISTINCT FROM 'object'
    OR p_input - ARRAY['outcome','stage','reason','period','retryAt','retryDisposition'] <> '{}'::jsonb
    OR jsonb_typeof(p_input->'outcome') IS DISTINCT FROM 'string'
    OR p_input->>'outcome' NOT IN ('not-due','busy','validation-failed','timeout')
    OR jsonb_typeof(p_input->'stage') IS DISTINCT FROM 'string'
    OR length(btrim(p_input->>'stage')) NOT BETWEEN 1 AND 96
    OR jsonb_typeof(p_input->'reason') IS DISTINCT FROM 'string'
    OR length(btrim(p_input->>'reason')) NOT BETWEEN 1 AND 192
    OR jsonb_typeof(p_input->'retryDisposition') IS DISTINCT FROM 'string'
    OR p_input->>'retryDisposition' NOT IN ('next-poll','after-cooldown','manual-review')
    OR octet_length(p_input::text) > 2000 THEN
    RAISE EXCEPTION 'all-player preclaim outcome input is invalid';
  END IF;
  IF p_input ? 'period' AND (jsonb_typeof(p_input->'period') IS DISTINCT FROM 'object'
    OR (p_input->'period') - ARRAY['season','seasonType','week'] <> '{}'::jsonb
    OR jsonb_typeof(p_input->'period'->'season') IS DISTINCT FROM 'number'
    OR jsonb_typeof(p_input->'period'->'week') IS DISTINCT FROM 'number'
    OR p_input->'period'->>'seasonType' IS DISTINCT FROM 'reg'
    OR (p_input->'period'->>'season')::integer NOT BETWEEN 2026 AND 2200
    OR (p_input->'period'->>'week')::integer NOT BETWEEN 1 AND 18) THEN
    RAISE EXCEPTION 'all-player preclaim period is invalid';
  END IF;
  IF p_input ? 'retryAt' AND p_input->'retryAt' <> 'null'::jsonb THEN
    IF jsonb_typeof(p_input->'retryAt') IS DISTINCT FROM 'string'
      OR (p_input->>'retryAt') !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$'
      OR NOT isfinite((p_input->>'retryAt')::timestamptz) THEN
      RAISE EXCEPTION 'all-player preclaim retry time is invalid';
    END IF;
  END IF;
  context := jsonb_strip_nulls(p_input) || jsonb_build_object(
    'stage',btrim(p_input->>'stage'),'reason',btrim(p_input->>'reason'));
  PERFORM pg_advisory_xact_lock(hashtextextended('all-player-ingestion:sleeper',0));
  SELECT * INTO job FROM public.projection_jobs
    WHERE job_key = 'all-player-ingestion:sleeper' FOR UPDATE;
  recorded := clock_timestamp();
  IF FOUND THEN
    IF job.payload->'lastPreclaimOutcome'->'context' = context THEN RETURN 'unchanged'; END IF;
    IF (job.payload->>'nextPreclaimOutcomeAt')::timestamptz > recorded THEN RETURN 'throttled'; END IF;
  END IF;
  result := jsonb_build_object('context',context,'observedAt',recorded);
  IF job.job_key IS NULL THEN
    -- An inert summary is not an ingestion claim or a provider reservation.
    INSERT INTO public.projection_jobs (
      job_key,job_type,scheduled_for,state,payload,attempt_count,updated_at
    ) VALUES ('all-player-ingestion:sleeper','all-player-ingestion',recorded,'pending',
      jsonb_build_object('version','all-player-global-v2','lastPreclaimOutcome',result,
        'nextPreclaimOutcomeAt',recorded + interval '15 minutes'),0,recorded);
  ELSE
    -- The row lock serializes with claim, publication and completion. Preserve
    -- every active ownership, request-budget and final-history field verbatim.
    UPDATE public.projection_jobs SET payload = payload || jsonb_build_object(
      'lastPreclaimOutcome',result,'nextPreclaimOutcomeAt',recorded + interval '15 minutes'),
      updated_at = recorded WHERE job_key = job.job_key;
  END IF;
  RETURN 'recorded';
END;
$$;
REVOKE ALL ON FUNCTION public.record_all_player_preclaim_outcome(jsonb) FROM PUBLIC;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'league_one_runtime') THEN
    GRANT EXECUTE ON FUNCTION public.record_all_player_preclaim_outcome(jsonb) TO league_one_runtime;
  END IF;
END; $$;
INSERT INTO app_schema_migrations(name,checksum)
  VALUES ('011_all_player_foundation_guards.sql','0eaa96bcc0b65053ac8dab48657eb7bfe22fadbfd41b4f4c78c3472ca8a512b6');
DO $repair_after$
DECLARE actual_count integer; actual_not_null_count integer; actual_rows bigint;
  actual_fingerprint text; actual_table_owner text; actual_function_owner text;
  actual_public_execute boolean; actual_runtime_execute boolean; actual_public_grant_execute boolean;
  actual_runtime_grant_execute boolean; before_catalog jsonb; after_catalog jsonb; old_count record;
BEGIN
  
  IF (SELECT checksum FROM app_schema_migrations WHERE name = '001_projection_foundation.sql') IS DISTINCT FROM 'eefa3aa224dbc6f0c6bb3edc9e4690425e2d6af7094938f3528059717d205050'
    THEN RAISE EXCEPTION 'release assertion failed: previous migration 001_projection_foundation.sql'; END IF;
  IF (SELECT checksum FROM app_schema_migrations WHERE name = '002_manager_snapshot_payloads.sql') IS DISTINCT FROM '74585dec3e2717eede0579f9281a041a4e3cc0b0cd8378383fe2e3d64fd7214d'
    THEN RAISE EXCEPTION 'release assertion failed: previous migration 002_manager_snapshot_payloads.sql'; END IF;
  IF (SELECT checksum FROM app_schema_migrations WHERE name = '003_league_period_authority.sql') IS DISTINCT FROM '6f98e09646834cc542a6413e00c0d0c2d84ad4a5ff33905e429aba87c951406e'
    THEN RAISE EXCEPTION 'release assertion failed: previous migration 003_league_period_authority.sql'; END IF;
  IF (SELECT checksum FROM app_schema_migrations WHERE name = '004_durable_projection_slates.sql') IS DISTINCT FROM '8ad48c22dea0d942a0a14027dcb240cda18f1bd728403e41aafa6b76f42f95b9'
    THEN RAISE EXCEPTION 'release assertion failed: previous migration 004_durable_projection_slates.sql'; END IF;
  IF (SELECT checksum FROM app_schema_migrations WHERE name = '005_future_projection_refresh.sql') IS DISTINCT FROM '02bb6a3c6a183e7074fbea156b5f393d5772619098ab7c07be9dcc5528003c75'
    THEN RAISE EXCEPTION 'release assertion failed: previous migration 005_future_projection_refresh.sql'; END IF;
  IF (SELECT checksum FROM app_schema_migrations WHERE name = '006_flexed_kickoff_candidate_index.sql') IS DISTINCT FROM 'd2c54c4e17439d3773cfab8db8ed68bf332abd1073fe793f62138efa89e1a3b0'
    THEN RAISE EXCEPTION 'release assertion failed: previous migration 006_flexed_kickoff_candidate_index.sql'; END IF;
  IF (SELECT checksum FROM app_schema_migrations WHERE name = '007_lineup_freshness.sql') IS DISTINCT FROM '1a92f9517294fe289bd25d74923dd042d0cb394d143b5c89d33ed017963c3e47'
    THEN RAISE EXCEPTION 'release assertion failed: previous migration 007_lineup_freshness.sql'; END IF;
  IF (SELECT checksum FROM app_schema_migrations WHERE name = '008_additive_write_guards.sql') IS DISTINCT FROM '2447ffac523e1f5536e218887d5c29895c3a095385f89bd6beb55cb7c5e95814'
    THEN RAISE EXCEPTION 'release assertion failed: previous migration 008_additive_write_guards.sql'; END IF;
  IF (SELECT checksum FROM app_schema_migrations WHERE name = '009_game_clock_plausibility.sql') IS DISTINCT FROM '86df8afd868bb4fd589a76bf1e1693cdc546037cfc61b54ae972e660fbda056a'
    THEN RAISE EXCEPTION 'release assertion failed: previous migration 009_game_clock_plausibility.sql'; END IF;
  IF (SELECT checksum FROM app_schema_migrations WHERE name = '010_all_player_statistics.sql') IS DISTINCT FROM 'f9f2aa0c4dc7a0a3097bf770a7f08ef0719ed7f019307dcf629fa17058af31b4'
    THEN RAISE EXCEPTION 'release assertion failed: previous migration 010_all_player_statistics.sql'; END IF;
  
  IF (SELECT count(*) FROM pg_class relation JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
      WHERE namespace.nspname = 'public' AND relation.relkind = 'r' AND relation.relname = 'all_player_score_sets') <> 1 THEN
    RAISE EXCEPTION 'release assertion failed: table all_player_score_sets'; END IF;
  IF (SELECT role.rolname FROM pg_class relation JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
      JOIN pg_roles role ON role.oid = relation.relowner
      WHERE namespace.nspname = 'public' AND relation.relname = 'all_player_score_sets') IS DISTINCT FROM 'neondb_owner' THEN
    RAISE EXCEPTION 'release assertion failed: owner all_player_score_sets'; END IF;
  SELECT count(*)::integer, md5(string_agg(
      attribute.attname || chr(31) || format_type(attribute.atttypid, attribute.atttypmod)
        || chr(31) || attribute.attnotnull::text || chr(31)
        || COALESCE(pg_get_expr(default_record.adbin, default_record.adrelid), ''),
      chr(30) ORDER BY attribute.attnum)) INTO actual_count, actual_fingerprint
    FROM pg_class relation JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
    JOIN pg_attribute attribute ON attribute.attrelid = relation.oid
    LEFT JOIN pg_attrdef default_record ON default_record.adrelid = relation.oid
      AND default_record.adnum = attribute.attnum
    WHERE namespace.nspname = 'public' AND relation.relname = 'all_player_score_sets'
      AND attribute.attnum > 0 AND NOT attribute.attisdropped;
  IF actual_count <> 17 OR actual_fingerprint IS DISTINCT FROM 'b37ef90ab355a40ef19257a91b51b50e' THEN
    RAISE EXCEPTION 'release assertion failed: columns all_player_score_sets expected count 17 fingerprint b37ef90ab355a40ef19257a91b51b50e, actual count % fingerprint %', actual_count, actual_fingerprint; END IF;
  SELECT count(*)::integer, count(*) FILTER (WHERE constraint_record.contype = 'n')::integer,
      md5(string_agg(constraint_record.conname || chr(31) || constraint_record.contype::text
        || chr(31) || pg_get_constraintdef(constraint_record.oid, true),
        chr(30) ORDER BY constraint_record.conname))
    INTO actual_count, actual_not_null_count, actual_fingerprint
    FROM pg_constraint constraint_record JOIN pg_class relation ON relation.oid = constraint_record.conrelid
    JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
    WHERE namespace.nspname = 'public' AND relation.relname = 'all_player_score_sets';
  IF actual_count <> 34 OR actual_not_null_count <> 17
      OR actual_fingerprint IS DISTINCT FROM 'bc815049013a175e7f635e756a6d58cd' THEN
    RAISE EXCEPTION 'release assertion failed: constraints all_player_score_sets expected count 34 not-null 17 fingerprint bc815049013a175e7f635e756a6d58cd, actual count % not-null % fingerprint %', actual_count, actual_not_null_count, actual_fingerprint; END IF;
  SELECT count(*)::integer, md5(string_agg(index_record.indexname || chr(31) || index_record.indexdef,
      chr(30) ORDER BY index_record.indexname)) INTO actual_count, actual_fingerprint
    FROM pg_indexes index_record WHERE index_record.schemaname = 'public'
      AND index_record.tablename = 'all_player_score_sets';
  IF actual_count <> 5 OR actual_fingerprint IS DISTINCT FROM '9353d8cc843cab2ad4405428b2ab081d' THEN
    RAISE EXCEPTION 'release assertion failed: indexes all_player_score_sets expected count 5 fingerprint 9353d8cc843cab2ad4405428b2ab081d, actual count % fingerprint %', actual_count, actual_fingerprint; END IF;
  IF has_table_privilege('public', 'public.all_player_score_sets',
        'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN')
      OR has_table_privilege('public', 'public.all_player_score_sets',
        'SELECT WITH GRANT OPTION,INSERT WITH GRANT OPTION,UPDATE WITH GRANT OPTION,DELETE WITH GRANT OPTION,TRUNCATE WITH GRANT OPTION,REFERENCES WITH GRANT OPTION,TRIGGER WITH GRANT OPTION,MAINTAIN WITH GRANT OPTION')
      OR has_any_column_privilege('public', 'public.all_player_score_sets', 'SELECT,INSERT,UPDATE,REFERENCES')
      OR has_any_column_privilege('public', 'public.all_player_score_sets',
        'SELECT WITH GRANT OPTION,INSERT WITH GRANT OPTION,UPDATE WITH GRANT OPTION,REFERENCES WITH GRANT OPTION')
      OR NOT has_table_privilege('league_one_runtime', 'public.all_player_score_sets', 'SELECT')
      OR has_table_privilege('league_one_runtime', 'public.all_player_score_sets', 'INSERT') IS DISTINCT FROM true
      OR has_table_privilege('league_one_runtime', 'public.all_player_score_sets',
        'UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN')
      OR has_table_privilege('league_one_runtime', 'public.all_player_score_sets',
        'SELECT WITH GRANT OPTION,INSERT WITH GRANT OPTION,UPDATE WITH GRANT OPTION,DELETE WITH GRANT OPTION,TRUNCATE WITH GRANT OPTION,REFERENCES WITH GRANT OPTION,TRIGGER WITH GRANT OPTION,MAINTAIN WITH GRANT OPTION')
      OR has_any_column_privilege('league_one_runtime', 'public.all_player_score_sets', 'INSERT')
          IS DISTINCT FROM true
      OR has_any_column_privilege('league_one_runtime', 'public.all_player_score_sets', 'UPDATE,REFERENCES')
      OR has_any_column_privilege('league_one_runtime', 'public.all_player_score_sets',
        'SELECT WITH GRANT OPTION,INSERT WITH GRANT OPTION,UPDATE WITH GRANT OPTION,REFERENCES WITH GRANT OPTION') THEN
    RAISE EXCEPTION 'release assertion failed: ACL all_player_score_sets'; END IF;
  EXECUTE 'SELECT count(*) FROM public.' || quote_ident('all_player_score_sets') INTO actual_rows;
  

  IF (SELECT count(*) FROM pg_class relation JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
      WHERE namespace.nspname = 'public' AND relation.relkind = 'r' AND relation.relname = 'all_player_score_verifications') <> 1 THEN
    RAISE EXCEPTION 'release assertion failed: table all_player_score_verifications'; END IF;
  IF (SELECT role.rolname FROM pg_class relation JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
      JOIN pg_roles role ON role.oid = relation.relowner
      WHERE namespace.nspname = 'public' AND relation.relname = 'all_player_score_verifications') IS DISTINCT FROM 'neondb_owner' THEN
    RAISE EXCEPTION 'release assertion failed: owner all_player_score_verifications'; END IF;
  SELECT count(*)::integer, md5(string_agg(
      attribute.attname || chr(31) || format_type(attribute.atttypid, attribute.atttypmod)
        || chr(31) || attribute.attnotnull::text || chr(31)
        || COALESCE(pg_get_expr(default_record.adbin, default_record.adrelid), ''),
      chr(30) ORDER BY attribute.attnum)) INTO actual_count, actual_fingerprint
    FROM pg_class relation JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
    JOIN pg_attribute attribute ON attribute.attrelid = relation.oid
    LEFT JOIN pg_attrdef default_record ON default_record.adrelid = relation.oid
      AND default_record.adnum = attribute.attnum
    WHERE namespace.nspname = 'public' AND relation.relname = 'all_player_score_verifications'
      AND attribute.attnum > 0 AND NOT attribute.attisdropped;
  IF actual_count <> 5 OR actual_fingerprint IS DISTINCT FROM '0f025df0b9f844287d356518c64d3ceb' THEN
    RAISE EXCEPTION 'release assertion failed: columns all_player_score_verifications expected count 5 fingerprint 0f025df0b9f844287d356518c64d3ceb, actual count % fingerprint %', actual_count, actual_fingerprint; END IF;
  SELECT count(*)::integer, count(*) FILTER (WHERE constraint_record.contype = 'n')::integer,
      md5(string_agg(constraint_record.conname || chr(31) || constraint_record.contype::text
        || chr(31) || pg_get_constraintdef(constraint_record.oid, true),
        chr(30) ORDER BY constraint_record.conname))
    INTO actual_count, actual_not_null_count, actual_fingerprint
    FROM pg_constraint constraint_record JOIN pg_class relation ON relation.oid = constraint_record.conrelid
    JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
    WHERE namespace.nspname = 'public' AND relation.relname = 'all_player_score_verifications';
  IF actual_count <> 11 OR actual_not_null_count <> 5
      OR actual_fingerprint IS DISTINCT FROM '658f5c5d59dd99868fe5ccd560759fd8' THEN
    RAISE EXCEPTION 'release assertion failed: constraints all_player_score_verifications expected count 11 not-null 5 fingerprint 658f5c5d59dd99868fe5ccd560759fd8, actual count % not-null % fingerprint %', actual_count, actual_not_null_count, actual_fingerprint; END IF;
  SELECT count(*)::integer, md5(string_agg(index_record.indexname || chr(31) || index_record.indexdef,
      chr(30) ORDER BY index_record.indexname)) INTO actual_count, actual_fingerprint
    FROM pg_indexes index_record WHERE index_record.schemaname = 'public'
      AND index_record.tablename = 'all_player_score_verifications';
  IF actual_count <> 3 OR actual_fingerprint IS DISTINCT FROM '33f1ee15515a9d83e90b901285628493' THEN
    RAISE EXCEPTION 'release assertion failed: indexes all_player_score_verifications expected count 3 fingerprint 33f1ee15515a9d83e90b901285628493, actual count % fingerprint %', actual_count, actual_fingerprint; END IF;
  IF has_table_privilege('public', 'public.all_player_score_verifications',
        'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN')
      OR has_table_privilege('public', 'public.all_player_score_verifications',
        'SELECT WITH GRANT OPTION,INSERT WITH GRANT OPTION,UPDATE WITH GRANT OPTION,DELETE WITH GRANT OPTION,TRUNCATE WITH GRANT OPTION,REFERENCES WITH GRANT OPTION,TRIGGER WITH GRANT OPTION,MAINTAIN WITH GRANT OPTION')
      OR has_any_column_privilege('public', 'public.all_player_score_verifications', 'SELECT,INSERT,UPDATE,REFERENCES')
      OR has_any_column_privilege('public', 'public.all_player_score_verifications',
        'SELECT WITH GRANT OPTION,INSERT WITH GRANT OPTION,UPDATE WITH GRANT OPTION,REFERENCES WITH GRANT OPTION')
      OR NOT has_table_privilege('league_one_runtime', 'public.all_player_score_verifications', 'SELECT')
      OR has_table_privilege('league_one_runtime', 'public.all_player_score_verifications', 'INSERT') IS DISTINCT FROM true
      OR has_table_privilege('league_one_runtime', 'public.all_player_score_verifications',
        'UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN')
      OR has_table_privilege('league_one_runtime', 'public.all_player_score_verifications',
        'SELECT WITH GRANT OPTION,INSERT WITH GRANT OPTION,UPDATE WITH GRANT OPTION,DELETE WITH GRANT OPTION,TRUNCATE WITH GRANT OPTION,REFERENCES WITH GRANT OPTION,TRIGGER WITH GRANT OPTION,MAINTAIN WITH GRANT OPTION')
      OR has_any_column_privilege('league_one_runtime', 'public.all_player_score_verifications', 'INSERT')
          IS DISTINCT FROM true
      OR has_any_column_privilege('league_one_runtime', 'public.all_player_score_verifications', 'UPDATE,REFERENCES')
      OR has_any_column_privilege('league_one_runtime', 'public.all_player_score_verifications',
        'SELECT WITH GRANT OPTION,INSERT WITH GRANT OPTION,UPDATE WITH GRANT OPTION,REFERENCES WITH GRANT OPTION') THEN
    RAISE EXCEPTION 'release assertion failed: ACL all_player_score_verifications'; END IF;
  EXECUTE 'SELECT count(*) FROM public.' || quote_ident('all_player_score_verifications') INTO actual_rows;
  IF actual_rows <> 0 THEN RAISE EXCEPTION 'release assertion failed: empty table all_player_score_verifications'; END IF;

  IF (SELECT count(*) FROM pg_class relation JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
      WHERE namespace.nspname = 'public' AND relation.relkind = 'r' AND relation.relname = 'all_player_scores') <> 1 THEN
    RAISE EXCEPTION 'release assertion failed: table all_player_scores'; END IF;
  IF (SELECT role.rolname FROM pg_class relation JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
      JOIN pg_roles role ON role.oid = relation.relowner
      WHERE namespace.nspname = 'public' AND relation.relname = 'all_player_scores') IS DISTINCT FROM 'neondb_owner' THEN
    RAISE EXCEPTION 'release assertion failed: owner all_player_scores'; END IF;
  SELECT count(*)::integer, md5(string_agg(
      attribute.attname || chr(31) || format_type(attribute.atttypid, attribute.atttypmod)
        || chr(31) || attribute.attnotnull::text || chr(31)
        || COALESCE(pg_get_expr(default_record.adbin, default_record.adrelid), ''),
      chr(30) ORDER BY attribute.attnum)) INTO actual_count, actual_fingerprint
    FROM pg_class relation JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
    JOIN pg_attribute attribute ON attribute.attrelid = relation.oid
    LEFT JOIN pg_attrdef default_record ON default_record.adrelid = relation.oid
      AND default_record.adnum = attribute.attnum
    WHERE namespace.nspname = 'public' AND relation.relname = 'all_player_scores'
      AND attribute.attnum > 0 AND NOT attribute.attisdropped;
  IF actual_count <> 15 OR actual_fingerprint IS DISTINCT FROM 'da793af1c8eb2dc4d919888adcf5ae56' THEN
    RAISE EXCEPTION 'release assertion failed: columns all_player_scores expected count 15 fingerprint da793af1c8eb2dc4d919888adcf5ae56, actual count % fingerprint %', actual_count, actual_fingerprint; END IF;
  SELECT count(*)::integer, count(*) FILTER (WHERE constraint_record.contype = 'n')::integer,
      md5(string_agg(constraint_record.conname || chr(31) || constraint_record.contype::text
        || chr(31) || pg_get_constraintdef(constraint_record.oid, true),
        chr(30) ORDER BY constraint_record.conname))
    INTO actual_count, actual_not_null_count, actual_fingerprint
    FROM pg_constraint constraint_record JOIN pg_class relation ON relation.oid = constraint_record.conrelid
    JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
    WHERE namespace.nspname = 'public' AND relation.relname = 'all_player_scores';
  IF actual_count <> 29 OR actual_not_null_count <> 12
      OR actual_fingerprint IS DISTINCT FROM '60484e2dab05e66dc396c52176521446' THEN
    RAISE EXCEPTION 'release assertion failed: constraints all_player_scores expected count 29 not-null 12 fingerprint 60484e2dab05e66dc396c52176521446, actual count % not-null % fingerprint %', actual_count, actual_not_null_count, actual_fingerprint; END IF;
  SELECT count(*)::integer, md5(string_agg(index_record.indexname || chr(31) || index_record.indexdef,
      chr(30) ORDER BY index_record.indexname)) INTO actual_count, actual_fingerprint
    FROM pg_indexes index_record WHERE index_record.schemaname = 'public'
      AND index_record.tablename = 'all_player_scores';
  IF actual_count <> 4 OR actual_fingerprint IS DISTINCT FROM 'aa643382ff5f32ec2a0da24e5e0889b9' THEN
    RAISE EXCEPTION 'release assertion failed: indexes all_player_scores expected count 4 fingerprint aa643382ff5f32ec2a0da24e5e0889b9, actual count % fingerprint %', actual_count, actual_fingerprint; END IF;
  IF has_table_privilege('public', 'public.all_player_scores',
        'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN')
      OR has_table_privilege('public', 'public.all_player_scores',
        'SELECT WITH GRANT OPTION,INSERT WITH GRANT OPTION,UPDATE WITH GRANT OPTION,DELETE WITH GRANT OPTION,TRUNCATE WITH GRANT OPTION,REFERENCES WITH GRANT OPTION,TRIGGER WITH GRANT OPTION,MAINTAIN WITH GRANT OPTION')
      OR has_any_column_privilege('public', 'public.all_player_scores', 'SELECT,INSERT,UPDATE,REFERENCES')
      OR has_any_column_privilege('public', 'public.all_player_scores',
        'SELECT WITH GRANT OPTION,INSERT WITH GRANT OPTION,UPDATE WITH GRANT OPTION,REFERENCES WITH GRANT OPTION')
      OR NOT has_table_privilege('league_one_runtime', 'public.all_player_scores', 'SELECT')
      OR has_table_privilege('league_one_runtime', 'public.all_player_scores', 'INSERT') IS DISTINCT FROM true
      OR has_table_privilege('league_one_runtime', 'public.all_player_scores',
        'UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN')
      OR has_table_privilege('league_one_runtime', 'public.all_player_scores',
        'SELECT WITH GRANT OPTION,INSERT WITH GRANT OPTION,UPDATE WITH GRANT OPTION,DELETE WITH GRANT OPTION,TRUNCATE WITH GRANT OPTION,REFERENCES WITH GRANT OPTION,TRIGGER WITH GRANT OPTION,MAINTAIN WITH GRANT OPTION')
      OR has_any_column_privilege('league_one_runtime', 'public.all_player_scores', 'INSERT')
          IS DISTINCT FROM true
      OR has_any_column_privilege('league_one_runtime', 'public.all_player_scores', 'UPDATE,REFERENCES')
      OR has_any_column_privilege('league_one_runtime', 'public.all_player_scores',
        'SELECT WITH GRANT OPTION,INSERT WITH GRANT OPTION,UPDATE WITH GRANT OPTION,REFERENCES WITH GRANT OPTION') THEN
    RAISE EXCEPTION 'release assertion failed: ACL all_player_scores'; END IF;
  EXECUTE 'SELECT count(*) FROM public.' || quote_ident('all_player_scores') INTO actual_rows;
  

  IF (SELECT count(*) FROM pg_class relation JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
      WHERE namespace.nspname = 'public' AND relation.relkind = 'r' AND relation.relname = 'all_player_stat_contents') <> 1 THEN
    RAISE EXCEPTION 'release assertion failed: table all_player_stat_contents'; END IF;
  IF (SELECT role.rolname FROM pg_class relation JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
      JOIN pg_roles role ON role.oid = relation.relowner
      WHERE namespace.nspname = 'public' AND relation.relname = 'all_player_stat_contents') IS DISTINCT FROM 'neondb_owner' THEN
    RAISE EXCEPTION 'release assertion failed: owner all_player_stat_contents'; END IF;
  SELECT count(*)::integer, md5(string_agg(
      attribute.attname || chr(31) || format_type(attribute.atttypid, attribute.atttypmod)
        || chr(31) || attribute.attnotnull::text || chr(31)
        || COALESCE(pg_get_expr(default_record.adbin, default_record.adrelid), ''),
      chr(30) ORDER BY attribute.attnum)) INTO actual_count, actual_fingerprint
    FROM pg_class relation JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
    JOIN pg_attribute attribute ON attribute.attrelid = relation.oid
    LEFT JOIN pg_attrdef default_record ON default_record.adrelid = relation.oid
      AND default_record.adnum = attribute.attnum
    WHERE namespace.nspname = 'public' AND relation.relname = 'all_player_stat_contents'
      AND attribute.attnum > 0 AND NOT attribute.attisdropped;
  IF actual_count <> 12 OR actual_fingerprint IS DISTINCT FROM 'bae4e3e70ccd8263a2f6fdc8fa4dbaaf' THEN
    RAISE EXCEPTION 'release assertion failed: columns all_player_stat_contents expected count 12 fingerprint bae4e3e70ccd8263a2f6fdc8fa4dbaaf, actual count % fingerprint %', actual_count, actual_fingerprint; END IF;
  SELECT count(*)::integer, count(*) FILTER (WHERE constraint_record.contype = 'n')::integer,
      md5(string_agg(constraint_record.conname || chr(31) || constraint_record.contype::text
        || chr(31) || pg_get_constraintdef(constraint_record.oid, true),
        chr(30) ORDER BY constraint_record.conname))
    INTO actual_count, actual_not_null_count, actual_fingerprint
    FROM pg_constraint constraint_record JOIN pg_class relation ON relation.oid = constraint_record.conrelid
    JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
    WHERE namespace.nspname = 'public' AND relation.relname = 'all_player_stat_contents';
  IF actual_count <> 23 OR actual_not_null_count <> 12
      OR actual_fingerprint IS DISTINCT FROM 'c42674c5539abecf2381b9f60fb2df05' THEN
    RAISE EXCEPTION 'release assertion failed: constraints all_player_stat_contents expected count 23 not-null 12 fingerprint c42674c5539abecf2381b9f60fb2df05, actual count % not-null % fingerprint %', actual_count, actual_not_null_count, actual_fingerprint; END IF;
  SELECT count(*)::integer, md5(string_agg(index_record.indexname || chr(31) || index_record.indexdef,
      chr(30) ORDER BY index_record.indexname)) INTO actual_count, actual_fingerprint
    FROM pg_indexes index_record WHERE index_record.schemaname = 'public'
      AND index_record.tablename = 'all_player_stat_contents';
  IF actual_count <> 3 OR actual_fingerprint IS DISTINCT FROM '278865b1e926da53f7783cb5525d094f' THEN
    RAISE EXCEPTION 'release assertion failed: indexes all_player_stat_contents expected count 3 fingerprint 278865b1e926da53f7783cb5525d094f, actual count % fingerprint %', actual_count, actual_fingerprint; END IF;
  IF has_table_privilege('public', 'public.all_player_stat_contents',
        'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN')
      OR has_table_privilege('public', 'public.all_player_stat_contents',
        'SELECT WITH GRANT OPTION,INSERT WITH GRANT OPTION,UPDATE WITH GRANT OPTION,DELETE WITH GRANT OPTION,TRUNCATE WITH GRANT OPTION,REFERENCES WITH GRANT OPTION,TRIGGER WITH GRANT OPTION,MAINTAIN WITH GRANT OPTION')
      OR has_any_column_privilege('public', 'public.all_player_stat_contents', 'SELECT,INSERT,UPDATE,REFERENCES')
      OR has_any_column_privilege('public', 'public.all_player_stat_contents',
        'SELECT WITH GRANT OPTION,INSERT WITH GRANT OPTION,UPDATE WITH GRANT OPTION,REFERENCES WITH GRANT OPTION')
      OR NOT has_table_privilege('league_one_runtime', 'public.all_player_stat_contents', 'SELECT')
      OR has_table_privilege('league_one_runtime', 'public.all_player_stat_contents', 'INSERT') IS DISTINCT FROM true
      OR has_table_privilege('league_one_runtime', 'public.all_player_stat_contents',
        'UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN')
      OR has_table_privilege('league_one_runtime', 'public.all_player_stat_contents',
        'SELECT WITH GRANT OPTION,INSERT WITH GRANT OPTION,UPDATE WITH GRANT OPTION,DELETE WITH GRANT OPTION,TRUNCATE WITH GRANT OPTION,REFERENCES WITH GRANT OPTION,TRIGGER WITH GRANT OPTION,MAINTAIN WITH GRANT OPTION')
      OR has_any_column_privilege('league_one_runtime', 'public.all_player_stat_contents', 'INSERT')
          IS DISTINCT FROM true
      OR has_any_column_privilege('league_one_runtime', 'public.all_player_stat_contents', 'UPDATE,REFERENCES')
      OR has_any_column_privilege('league_one_runtime', 'public.all_player_stat_contents',
        'SELECT WITH GRANT OPTION,INSERT WITH GRANT OPTION,UPDATE WITH GRANT OPTION,REFERENCES WITH GRANT OPTION') THEN
    RAISE EXCEPTION 'release assertion failed: ACL all_player_stat_contents'; END IF;
  EXECUTE 'SELECT count(*) FROM public.' || quote_ident('all_player_stat_contents') INTO actual_rows;
  

  IF (SELECT count(*) FROM pg_class relation JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
      WHERE namespace.nspname = 'public' AND relation.relkind = 'r' AND relation.relname = 'all_player_stat_entries') <> 1 THEN
    RAISE EXCEPTION 'release assertion failed: table all_player_stat_entries'; END IF;
  IF (SELECT role.rolname FROM pg_class relation JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
      JOIN pg_roles role ON role.oid = relation.relowner
      WHERE namespace.nspname = 'public' AND relation.relname = 'all_player_stat_entries') IS DISTINCT FROM 'neondb_owner' THEN
    RAISE EXCEPTION 'release assertion failed: owner all_player_stat_entries'; END IF;
  SELECT count(*)::integer, md5(string_agg(
      attribute.attname || chr(31) || format_type(attribute.atttypid, attribute.atttypmod)
        || chr(31) || attribute.attnotnull::text || chr(31)
        || COALESCE(pg_get_expr(default_record.adbin, default_record.adrelid), ''),
      chr(30) ORDER BY attribute.attnum)) INTO actual_count, actual_fingerprint
    FROM pg_class relation JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
    JOIN pg_attribute attribute ON attribute.attrelid = relation.oid
    LEFT JOIN pg_attrdef default_record ON default_record.adrelid = relation.oid
      AND default_record.adnum = attribute.attnum
    WHERE namespace.nspname = 'public' AND relation.relname = 'all_player_stat_entries'
      AND attribute.attnum > 0 AND NOT attribute.attisdropped;
  IF actual_count <> 13 OR actual_fingerprint IS DISTINCT FROM '0fe82d3a2278e77e514ea4582fe29892' THEN
    RAISE EXCEPTION 'release assertion failed: columns all_player_stat_entries expected count 13 fingerprint 0fe82d3a2278e77e514ea4582fe29892, actual count % fingerprint %', actual_count, actual_fingerprint; END IF;
  SELECT count(*)::integer, count(*) FILTER (WHERE constraint_record.contype = 'n')::integer,
      md5(string_agg(constraint_record.conname || chr(31) || constraint_record.contype::text
        || chr(31) || pg_get_constraintdef(constraint_record.oid, true),
        chr(30) ORDER BY constraint_record.conname))
    INTO actual_count, actual_not_null_count, actual_fingerprint
    FROM pg_constraint constraint_record JOIN pg_class relation ON relation.oid = constraint_record.conrelid
    JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
    WHERE namespace.nspname = 'public' AND relation.relname = 'all_player_stat_entries';
  IF actual_count <> 23 OR actual_not_null_count <> 9
      OR actual_fingerprint IS DISTINCT FROM 'ccea6cee2d37a3b0af620217eaa31410' THEN
    RAISE EXCEPTION 'release assertion failed: constraints all_player_stat_entries expected count 23 not-null 9 fingerprint ccea6cee2d37a3b0af620217eaa31410, actual count % not-null % fingerprint %', actual_count, actual_not_null_count, actual_fingerprint; END IF;
  SELECT count(*)::integer, md5(string_agg(index_record.indexname || chr(31) || index_record.indexdef,
      chr(30) ORDER BY index_record.indexname)) INTO actual_count, actual_fingerprint
    FROM pg_indexes index_record WHERE index_record.schemaname = 'public'
      AND index_record.tablename = 'all_player_stat_entries';
  IF actual_count <> 3 OR actual_fingerprint IS DISTINCT FROM 'a50142ccf1e6a9ce392d9697d1d91534' THEN
    RAISE EXCEPTION 'release assertion failed: indexes all_player_stat_entries expected count 3 fingerprint a50142ccf1e6a9ce392d9697d1d91534, actual count % fingerprint %', actual_count, actual_fingerprint; END IF;
  IF has_table_privilege('public', 'public.all_player_stat_entries',
        'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN')
      OR has_table_privilege('public', 'public.all_player_stat_entries',
        'SELECT WITH GRANT OPTION,INSERT WITH GRANT OPTION,UPDATE WITH GRANT OPTION,DELETE WITH GRANT OPTION,TRUNCATE WITH GRANT OPTION,REFERENCES WITH GRANT OPTION,TRIGGER WITH GRANT OPTION,MAINTAIN WITH GRANT OPTION')
      OR has_any_column_privilege('public', 'public.all_player_stat_entries', 'SELECT,INSERT,UPDATE,REFERENCES')
      OR has_any_column_privilege('public', 'public.all_player_stat_entries',
        'SELECT WITH GRANT OPTION,INSERT WITH GRANT OPTION,UPDATE WITH GRANT OPTION,REFERENCES WITH GRANT OPTION')
      OR NOT has_table_privilege('league_one_runtime', 'public.all_player_stat_entries', 'SELECT')
      OR has_table_privilege('league_one_runtime', 'public.all_player_stat_entries', 'INSERT') IS DISTINCT FROM true
      OR has_table_privilege('league_one_runtime', 'public.all_player_stat_entries',
        'UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN')
      OR has_table_privilege('league_one_runtime', 'public.all_player_stat_entries',
        'SELECT WITH GRANT OPTION,INSERT WITH GRANT OPTION,UPDATE WITH GRANT OPTION,DELETE WITH GRANT OPTION,TRUNCATE WITH GRANT OPTION,REFERENCES WITH GRANT OPTION,TRIGGER WITH GRANT OPTION,MAINTAIN WITH GRANT OPTION')
      OR has_any_column_privilege('league_one_runtime', 'public.all_player_stat_entries', 'INSERT')
          IS DISTINCT FROM true
      OR has_any_column_privilege('league_one_runtime', 'public.all_player_stat_entries', 'UPDATE,REFERENCES')
      OR has_any_column_privilege('league_one_runtime', 'public.all_player_stat_entries',
        'SELECT WITH GRANT OPTION,INSERT WITH GRANT OPTION,UPDATE WITH GRANT OPTION,REFERENCES WITH GRANT OPTION') THEN
    RAISE EXCEPTION 'release assertion failed: ACL all_player_stat_entries'; END IF;
  EXECUTE 'SELECT count(*) FROM public.' || quote_ident('all_player_stat_entries') INTO actual_rows;
  

  IF (SELECT count(*) FROM pg_class relation JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
      WHERE namespace.nspname = 'public' AND relation.relkind = 'r' AND relation.relname = 'all_player_stat_observations') <> 1 THEN
    RAISE EXCEPTION 'release assertion failed: table all_player_stat_observations'; END IF;
  IF (SELECT role.rolname FROM pg_class relation JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
      JOIN pg_roles role ON role.oid = relation.relowner
      WHERE namespace.nspname = 'public' AND relation.relname = 'all_player_stat_observations') IS DISTINCT FROM 'neondb_owner' THEN
    RAISE EXCEPTION 'release assertion failed: owner all_player_stat_observations'; END IF;
  SELECT count(*)::integer, md5(string_agg(
      attribute.attname || chr(31) || format_type(attribute.atttypid, attribute.atttypmod)
        || chr(31) || attribute.attnotnull::text || chr(31)
        || COALESCE(pg_get_expr(default_record.adbin, default_record.adrelid), ''),
      chr(30) ORDER BY attribute.attnum)) INTO actual_count, actual_fingerprint
    FROM pg_class relation JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
    JOIN pg_attribute attribute ON attribute.attrelid = relation.oid
    LEFT JOIN pg_attrdef default_record ON default_record.adrelid = relation.oid
      AND default_record.adnum = attribute.attnum
    WHERE namespace.nspname = 'public' AND relation.relname = 'all_player_stat_observations'
      AND attribute.attnum > 0 AND NOT attribute.attisdropped;
  IF actual_count <> 13 OR actual_fingerprint IS DISTINCT FROM '6c468b76a9004f46979f7ecdc42f5576' THEN
    RAISE EXCEPTION 'release assertion failed: columns all_player_stat_observations expected count 13 fingerprint 6c468b76a9004f46979f7ecdc42f5576, actual count % fingerprint %', actual_count, actual_fingerprint; END IF;
  SELECT count(*)::integer, count(*) FILTER (WHERE constraint_record.contype = 'n')::integer,
      md5(string_agg(constraint_record.conname || chr(31) || constraint_record.contype::text
        || chr(31) || pg_get_constraintdef(constraint_record.oid, true),
        chr(30) ORDER BY constraint_record.conname))
    INTO actual_count, actual_not_null_count, actual_fingerprint
    FROM pg_constraint constraint_record JOIN pg_class relation ON relation.oid = constraint_record.conrelid
    JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
    WHERE namespace.nspname = 'public' AND relation.relname = 'all_player_stat_observations';
  IF actual_count <> 22 OR actual_not_null_count <> 13
      OR actual_fingerprint IS DISTINCT FROM 'c6b6f735f4aa8bd29e53a96854432d35' THEN
    RAISE EXCEPTION 'release assertion failed: constraints all_player_stat_observations expected count 22 not-null 13 fingerprint c6b6f735f4aa8bd29e53a96854432d35, actual count % not-null % fingerprint %', actual_count, actual_not_null_count, actual_fingerprint; END IF;
  SELECT count(*)::integer, md5(string_agg(index_record.indexname || chr(31) || index_record.indexdef,
      chr(30) ORDER BY index_record.indexname)) INTO actual_count, actual_fingerprint
    FROM pg_indexes index_record WHERE index_record.schemaname = 'public'
      AND index_record.tablename = 'all_player_stat_observations';
  IF actual_count <> 4 OR actual_fingerprint IS DISTINCT FROM 'f4719cf59e3e87d89e0e248f30b49d8d' THEN
    RAISE EXCEPTION 'release assertion failed: indexes all_player_stat_observations expected count 4 fingerprint f4719cf59e3e87d89e0e248f30b49d8d, actual count % fingerprint %', actual_count, actual_fingerprint; END IF;
  IF has_table_privilege('public', 'public.all_player_stat_observations',
        'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN')
      OR has_table_privilege('public', 'public.all_player_stat_observations',
        'SELECT WITH GRANT OPTION,INSERT WITH GRANT OPTION,UPDATE WITH GRANT OPTION,DELETE WITH GRANT OPTION,TRUNCATE WITH GRANT OPTION,REFERENCES WITH GRANT OPTION,TRIGGER WITH GRANT OPTION,MAINTAIN WITH GRANT OPTION')
      OR has_any_column_privilege('public', 'public.all_player_stat_observations', 'SELECT,INSERT,UPDATE,REFERENCES')
      OR has_any_column_privilege('public', 'public.all_player_stat_observations',
        'SELECT WITH GRANT OPTION,INSERT WITH GRANT OPTION,UPDATE WITH GRANT OPTION,REFERENCES WITH GRANT OPTION')
      OR NOT has_table_privilege('league_one_runtime', 'public.all_player_stat_observations', 'SELECT')
      OR has_table_privilege('league_one_runtime', 'public.all_player_stat_observations', 'INSERT') IS DISTINCT FROM true
      OR has_table_privilege('league_one_runtime', 'public.all_player_stat_observations',
        'UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN')
      OR has_table_privilege('league_one_runtime', 'public.all_player_stat_observations',
        'SELECT WITH GRANT OPTION,INSERT WITH GRANT OPTION,UPDATE WITH GRANT OPTION,DELETE WITH GRANT OPTION,TRUNCATE WITH GRANT OPTION,REFERENCES WITH GRANT OPTION,TRIGGER WITH GRANT OPTION,MAINTAIN WITH GRANT OPTION')
      OR has_any_column_privilege('league_one_runtime', 'public.all_player_stat_observations', 'INSERT')
          IS DISTINCT FROM true
      OR has_any_column_privilege('league_one_runtime', 'public.all_player_stat_observations', 'UPDATE,REFERENCES')
      OR has_any_column_privilege('league_one_runtime', 'public.all_player_stat_observations',
        'SELECT WITH GRANT OPTION,INSERT WITH GRANT OPTION,UPDATE WITH GRANT OPTION,REFERENCES WITH GRANT OPTION') THEN
    RAISE EXCEPTION 'release assertion failed: ACL all_player_stat_observations'; END IF;
  EXECUTE 'SELECT count(*) FROM public.' || quote_ident('all_player_stat_observations') INTO actual_rows;
  

  IF (SELECT count(*) FROM pg_class relation JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
      WHERE namespace.nspname = 'public' AND relation.relkind = 'r' AND relation.relname = 'current_all_player_score_sets') <> 1 THEN
    RAISE EXCEPTION 'release assertion failed: table current_all_player_score_sets'; END IF;
  IF (SELECT role.rolname FROM pg_class relation JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
      JOIN pg_roles role ON role.oid = relation.relowner
      WHERE namespace.nspname = 'public' AND relation.relname = 'current_all_player_score_sets') IS DISTINCT FROM 'neondb_owner' THEN
    RAISE EXCEPTION 'release assertion failed: owner current_all_player_score_sets'; END IF;
  SELECT count(*)::integer, md5(string_agg(
      attribute.attname || chr(31) || format_type(attribute.atttypid, attribute.atttypmod)
        || chr(31) || attribute.attnotnull::text || chr(31)
        || COALESCE(pg_get_expr(default_record.adbin, default_record.adrelid), ''),
      chr(30) ORDER BY attribute.attnum)) INTO actual_count, actual_fingerprint
    FROM pg_class relation JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
    JOIN pg_attribute attribute ON attribute.attrelid = relation.oid
    LEFT JOIN pg_attrdef default_record ON default_record.adrelid = relation.oid
      AND default_record.adnum = attribute.attnum
    WHERE namespace.nspname = 'public' AND relation.relname = 'current_all_player_score_sets'
      AND attribute.attnum > 0 AND NOT attribute.attisdropped;
  IF actual_count <> 11 OR actual_fingerprint IS DISTINCT FROM 'ab985c7f1b316f8ec51052e2d3c37c9b' THEN
    RAISE EXCEPTION 'release assertion failed: columns current_all_player_score_sets expected count 11 fingerprint ab985c7f1b316f8ec51052e2d3c37c9b, actual count % fingerprint %', actual_count, actual_fingerprint; END IF;
  SELECT count(*)::integer, count(*) FILTER (WHERE constraint_record.contype = 'n')::integer,
      md5(string_agg(constraint_record.conname || chr(31) || constraint_record.contype::text
        || chr(31) || pg_get_constraintdef(constraint_record.oid, true),
        chr(30) ORDER BY constraint_record.conname))
    INTO actual_count, actual_not_null_count, actual_fingerprint
    FROM pg_constraint constraint_record JOIN pg_class relation ON relation.oid = constraint_record.conrelid
    JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
    WHERE namespace.nspname = 'public' AND relation.relname = 'current_all_player_score_sets';
  IF actual_count <> 21 OR actual_not_null_count <> 11
      OR actual_fingerprint IS DISTINCT FROM '1a7309f98d2fa8394653d2a0b911925c' THEN
    RAISE EXCEPTION 'release assertion failed: constraints current_all_player_score_sets expected count 21 not-null 11 fingerprint 1a7309f98d2fa8394653d2a0b911925c, actual count % not-null % fingerprint %', actual_count, actual_not_null_count, actual_fingerprint; END IF;
  SELECT count(*)::integer, md5(string_agg(index_record.indexname || chr(31) || index_record.indexdef,
      chr(30) ORDER BY index_record.indexname)) INTO actual_count, actual_fingerprint
    FROM pg_indexes index_record WHERE index_record.schemaname = 'public'
      AND index_record.tablename = 'current_all_player_score_sets';
  IF actual_count <> 1 OR actual_fingerprint IS DISTINCT FROM '5afb7b133b0d448b3ed974426beaac21' THEN
    RAISE EXCEPTION 'release assertion failed: indexes current_all_player_score_sets expected count 1 fingerprint 5afb7b133b0d448b3ed974426beaac21, actual count % fingerprint %', actual_count, actual_fingerprint; END IF;
  IF has_table_privilege('public', 'public.current_all_player_score_sets',
        'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN')
      OR has_table_privilege('public', 'public.current_all_player_score_sets',
        'SELECT WITH GRANT OPTION,INSERT WITH GRANT OPTION,UPDATE WITH GRANT OPTION,DELETE WITH GRANT OPTION,TRUNCATE WITH GRANT OPTION,REFERENCES WITH GRANT OPTION,TRIGGER WITH GRANT OPTION,MAINTAIN WITH GRANT OPTION')
      OR has_any_column_privilege('public', 'public.current_all_player_score_sets', 'SELECT,INSERT,UPDATE,REFERENCES')
      OR has_any_column_privilege('public', 'public.current_all_player_score_sets',
        'SELECT WITH GRANT OPTION,INSERT WITH GRANT OPTION,UPDATE WITH GRANT OPTION,REFERENCES WITH GRANT OPTION')
      OR NOT has_table_privilege('league_one_runtime', 'public.current_all_player_score_sets', 'SELECT')
      OR has_table_privilege('league_one_runtime', 'public.current_all_player_score_sets', 'INSERT') IS DISTINCT FROM false
      OR has_table_privilege('league_one_runtime', 'public.current_all_player_score_sets',
        'UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN')
      OR has_table_privilege('league_one_runtime', 'public.current_all_player_score_sets',
        'SELECT WITH GRANT OPTION,INSERT WITH GRANT OPTION,UPDATE WITH GRANT OPTION,DELETE WITH GRANT OPTION,TRUNCATE WITH GRANT OPTION,REFERENCES WITH GRANT OPTION,TRIGGER WITH GRANT OPTION,MAINTAIN WITH GRANT OPTION')
      OR has_any_column_privilege('league_one_runtime', 'public.current_all_player_score_sets', 'INSERT')
          IS DISTINCT FROM false
      OR has_any_column_privilege('league_one_runtime', 'public.current_all_player_score_sets', 'UPDATE,REFERENCES')
      OR has_any_column_privilege('league_one_runtime', 'public.current_all_player_score_sets',
        'SELECT WITH GRANT OPTION,INSERT WITH GRANT OPTION,UPDATE WITH GRANT OPTION,REFERENCES WITH GRANT OPTION') THEN
    RAISE EXCEPTION 'release assertion failed: ACL current_all_player_score_sets'; END IF;
  EXECUTE 'SELECT count(*) FROM public.' || quote_ident('current_all_player_score_sets') INTO actual_rows;
  

  SELECT count(*)::integer, min(md5(pg_get_triggerdef(trigger_record.oid, true))),
      min(table_owner.rolname), min(function_owner.rolname)
    INTO actual_count, actual_fingerprint, actual_table_owner, actual_function_owner
    FROM pg_trigger trigger_record JOIN pg_class relation ON relation.oid = trigger_record.tgrelid
    JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
    JOIN pg_roles table_owner ON table_owner.oid = relation.relowner
    JOIN pg_proc function_record ON function_record.oid = trigger_record.tgfoid
    JOIN pg_roles function_owner ON function_owner.oid = function_record.proowner
    WHERE namespace.nspname = 'public' AND NOT trigger_record.tgisinternal
      AND trigger_record.tgname = 'all_player_score_sets_immutable' AND relation.relname = 'all_player_score_sets'
      AND function_record.proname = 'prevent_all_player_history_change';
  IF actual_count <> 1 OR actual_fingerprint IS DISTINCT FROM 'a04cbd33698748f306a642741e522724'
      OR actual_table_owner IS DISTINCT FROM 'neondb_owner'
      OR actual_function_owner IS DISTINCT FROM 'neondb_owner' THEN
    RAISE EXCEPTION 'release assertion failed: trigger all_player_score_sets_immutable'; END IF;

  SELECT count(*)::integer, min(md5(pg_get_triggerdef(trigger_record.oid, true))),
      min(table_owner.rolname), min(function_owner.rolname)
    INTO actual_count, actual_fingerprint, actual_table_owner, actual_function_owner
    FROM pg_trigger trigger_record JOIN pg_class relation ON relation.oid = trigger_record.tgrelid
    JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
    JOIN pg_roles table_owner ON table_owner.oid = relation.relowner
    JOIN pg_proc function_record ON function_record.oid = trigger_record.tgfoid
    JOIN pg_roles function_owner ON function_owner.oid = function_record.proowner
    WHERE namespace.nspname = 'public' AND NOT trigger_record.tgisinternal
      AND trigger_record.tgname = 'all_player_score_verifications_immutable' AND relation.relname = 'all_player_score_verifications'
      AND function_record.proname = 'prevent_all_player_history_change';
  IF actual_count <> 1 OR actual_fingerprint IS DISTINCT FROM 'fac57466a9a7bd2aae5f613706ff6c40'
      OR actual_table_owner IS DISTINCT FROM 'neondb_owner'
      OR actual_function_owner IS DISTINCT FROM 'neondb_owner' THEN
    RAISE EXCEPTION 'release assertion failed: trigger all_player_score_verifications_immutable'; END IF;

  SELECT count(*)::integer, min(md5(pg_get_triggerdef(trigger_record.oid, true))),
      min(table_owner.rolname), min(function_owner.rolname)
    INTO actual_count, actual_fingerprint, actual_table_owner, actual_function_owner
    FROM pg_trigger trigger_record JOIN pg_class relation ON relation.oid = trigger_record.tgrelid
    JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
    JOIN pg_roles table_owner ON table_owner.oid = relation.relowner
    JOIN pg_proc function_record ON function_record.oid = trigger_record.tgfoid
    JOIN pg_roles function_owner ON function_owner.oid = function_record.proowner
    WHERE namespace.nspname = 'public' AND NOT trigger_record.tgisinternal
      AND trigger_record.tgname = 'all_player_score_verifications_lineage_guard' AND relation.relname = 'all_player_score_verifications'
      AND function_record.proname = 'validate_all_player_score_verification';
  IF actual_count <> 1 OR actual_fingerprint IS DISTINCT FROM 'ecdbc1417c873219f1dbee57daadc1ac'
      OR actual_table_owner IS DISTINCT FROM 'neondb_owner'
      OR actual_function_owner IS DISTINCT FROM 'neondb_owner' THEN
    RAISE EXCEPTION 'release assertion failed: trigger all_player_score_verifications_lineage_guard'; END IF;

  SELECT count(*)::integer, min(md5(pg_get_triggerdef(trigger_record.oid, true))),
      min(table_owner.rolname), min(function_owner.rolname)
    INTO actual_count, actual_fingerprint, actual_table_owner, actual_function_owner
    FROM pg_trigger trigger_record JOIN pg_class relation ON relation.oid = trigger_record.tgrelid
    JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
    JOIN pg_roles table_owner ON table_owner.oid = relation.relowner
    JOIN pg_proc function_record ON function_record.oid = trigger_record.tgfoid
    JOIN pg_roles function_owner ON function_owner.oid = function_record.proowner
    WHERE namespace.nspname = 'public' AND NOT trigger_record.tgisinternal
      AND trigger_record.tgname = 'all_player_scores_append_guard' AND relation.relname = 'all_player_scores'
      AND function_record.proname = 'guard_all_player_child_insert';
  IF actual_count <> 1 OR actual_fingerprint IS DISTINCT FROM '0532b43e10652328d78880d150c28a37'
      OR actual_table_owner IS DISTINCT FROM 'neondb_owner'
      OR actual_function_owner IS DISTINCT FROM 'neondb_owner' THEN
    RAISE EXCEPTION 'release assertion failed: trigger all_player_scores_append_guard'; END IF;

  SELECT count(*)::integer, min(md5(pg_get_triggerdef(trigger_record.oid, true))),
      min(table_owner.rolname), min(function_owner.rolname)
    INTO actual_count, actual_fingerprint, actual_table_owner, actual_function_owner
    FROM pg_trigger trigger_record JOIN pg_class relation ON relation.oid = trigger_record.tgrelid
    JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
    JOIN pg_roles table_owner ON table_owner.oid = relation.relowner
    JOIN pg_proc function_record ON function_record.oid = trigger_record.tgfoid
    JOIN pg_roles function_owner ON function_owner.oid = function_record.proowner
    WHERE namespace.nspname = 'public' AND NOT trigger_record.tgisinternal
      AND trigger_record.tgname = 'all_player_scores_immutable' AND relation.relname = 'all_player_scores'
      AND function_record.proname = 'prevent_all_player_history_change';
  IF actual_count <> 1 OR actual_fingerprint IS DISTINCT FROM '2190f2dfdd649951146c023a5f34671d'
      OR actual_table_owner IS DISTINCT FROM 'neondb_owner'
      OR actual_function_owner IS DISTINCT FROM 'neondb_owner' THEN
    RAISE EXCEPTION 'release assertion failed: trigger all_player_scores_immutable'; END IF;

  SELECT count(*)::integer, min(md5(pg_get_triggerdef(trigger_record.oid, true))),
      min(table_owner.rolname), min(function_owner.rolname)
    INTO actual_count, actual_fingerprint, actual_table_owner, actual_function_owner
    FROM pg_trigger trigger_record JOIN pg_class relation ON relation.oid = trigger_record.tgrelid
    JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
    JOIN pg_roles table_owner ON table_owner.oid = relation.relowner
    JOIN pg_proc function_record ON function_record.oid = trigger_record.tgfoid
    JOIN pg_roles function_owner ON function_owner.oid = function_record.proowner
    WHERE namespace.nspname = 'public' AND NOT trigger_record.tgisinternal
      AND trigger_record.tgname = 'all_player_scores_lineage_guard' AND relation.relname = 'all_player_scores'
      AND function_record.proname = 'validate_all_player_score_lineage';
  IF actual_count <> 1 OR actual_fingerprint IS DISTINCT FROM 'e0d3b99cd73ec95716bb364ca56c483f'
      OR actual_table_owner IS DISTINCT FROM 'neondb_owner'
      OR actual_function_owner IS DISTINCT FROM 'neondb_owner' THEN
    RAISE EXCEPTION 'release assertion failed: trigger all_player_scores_lineage_guard'; END IF;

  SELECT count(*)::integer, min(md5(pg_get_triggerdef(trigger_record.oid, true))),
      min(table_owner.rolname), min(function_owner.rolname)
    INTO actual_count, actual_fingerprint, actual_table_owner, actual_function_owner
    FROM pg_trigger trigger_record JOIN pg_class relation ON relation.oid = trigger_record.tgrelid
    JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
    JOIN pg_roles table_owner ON table_owner.oid = relation.relowner
    JOIN pg_proc function_record ON function_record.oid = trigger_record.tgfoid
    JOIN pg_roles function_owner ON function_owner.oid = function_record.proowner
    WHERE namespace.nspname = 'public' AND NOT trigger_record.tgisinternal
      AND trigger_record.tgname = 'all_player_stat_contents_immutable' AND relation.relname = 'all_player_stat_contents'
      AND function_record.proname = 'prevent_all_player_history_change';
  IF actual_count <> 1 OR actual_fingerprint IS DISTINCT FROM '317368db6511931ee9051f122edcb60c'
      OR actual_table_owner IS DISTINCT FROM 'neondb_owner'
      OR actual_function_owner IS DISTINCT FROM 'neondb_owner' THEN
    RAISE EXCEPTION 'release assertion failed: trigger all_player_stat_contents_immutable'; END IF;

  SELECT count(*)::integer, min(md5(pg_get_triggerdef(trigger_record.oid, true))),
      min(table_owner.rolname), min(function_owner.rolname)
    INTO actual_count, actual_fingerprint, actual_table_owner, actual_function_owner
    FROM pg_trigger trigger_record JOIN pg_class relation ON relation.oid = trigger_record.tgrelid
    JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
    JOIN pg_roles table_owner ON table_owner.oid = relation.relowner
    JOIN pg_proc function_record ON function_record.oid = trigger_record.tgfoid
    JOIN pg_roles function_owner ON function_owner.oid = function_record.proowner
    WHERE namespace.nspname = 'public' AND NOT trigger_record.tgisinternal
      AND trigger_record.tgname = 'all_player_stat_entries_append_guard' AND relation.relname = 'all_player_stat_entries'
      AND function_record.proname = 'guard_all_player_child_insert';
  IF actual_count <> 1 OR actual_fingerprint IS DISTINCT FROM '5cd00790b1a02e5fd1b7d59e46a8fabb'
      OR actual_table_owner IS DISTINCT FROM 'neondb_owner'
      OR actual_function_owner IS DISTINCT FROM 'neondb_owner' THEN
    RAISE EXCEPTION 'release assertion failed: trigger all_player_stat_entries_append_guard'; END IF;

  SELECT count(*)::integer, min(md5(pg_get_triggerdef(trigger_record.oid, true))),
      min(table_owner.rolname), min(function_owner.rolname)
    INTO actual_count, actual_fingerprint, actual_table_owner, actual_function_owner
    FROM pg_trigger trigger_record JOIN pg_class relation ON relation.oid = trigger_record.tgrelid
    JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
    JOIN pg_roles table_owner ON table_owner.oid = relation.relowner
    JOIN pg_proc function_record ON function_record.oid = trigger_record.tgfoid
    JOIN pg_roles function_owner ON function_owner.oid = function_record.proowner
    WHERE namespace.nspname = 'public' AND NOT trigger_record.tgisinternal
      AND trigger_record.tgname = 'all_player_stat_entries_evidence_guard' AND relation.relname = 'all_player_stat_entries'
      AND function_record.proname = 'validate_all_player_stat_entry';
  IF actual_count <> 1 OR actual_fingerprint IS DISTINCT FROM 'c573f89c7d79fc0343a5f73c6a3827b4'
      OR actual_table_owner IS DISTINCT FROM 'neondb_owner'
      OR actual_function_owner IS DISTINCT FROM 'neondb_owner' THEN
    RAISE EXCEPTION 'release assertion failed: trigger all_player_stat_entries_evidence_guard'; END IF;

  SELECT count(*)::integer, min(md5(pg_get_triggerdef(trigger_record.oid, true))),
      min(table_owner.rolname), min(function_owner.rolname)
    INTO actual_count, actual_fingerprint, actual_table_owner, actual_function_owner
    FROM pg_trigger trigger_record JOIN pg_class relation ON relation.oid = trigger_record.tgrelid
    JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
    JOIN pg_roles table_owner ON table_owner.oid = relation.relowner
    JOIN pg_proc function_record ON function_record.oid = trigger_record.tgfoid
    JOIN pg_roles function_owner ON function_owner.oid = function_record.proowner
    WHERE namespace.nspname = 'public' AND NOT trigger_record.tgisinternal
      AND trigger_record.tgname = 'all_player_stat_entries_immutable' AND relation.relname = 'all_player_stat_entries'
      AND function_record.proname = 'prevent_all_player_history_change';
  IF actual_count <> 1 OR actual_fingerprint IS DISTINCT FROM 'daebe37338ccc8ce8644ccb11e3dd6bc'
      OR actual_table_owner IS DISTINCT FROM 'neondb_owner'
      OR actual_function_owner IS DISTINCT FROM 'neondb_owner' THEN
    RAISE EXCEPTION 'release assertion failed: trigger all_player_stat_entries_immutable'; END IF;

  SELECT count(*)::integer, min(md5(pg_get_triggerdef(trigger_record.oid, true))),
      min(table_owner.rolname), min(function_owner.rolname)
    INTO actual_count, actual_fingerprint, actual_table_owner, actual_function_owner
    FROM pg_trigger trigger_record JOIN pg_class relation ON relation.oid = trigger_record.tgrelid
    JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
    JOIN pg_roles table_owner ON table_owner.oid = relation.relowner
    JOIN pg_proc function_record ON function_record.oid = trigger_record.tgfoid
    JOIN pg_roles function_owner ON function_owner.oid = function_record.proowner
    WHERE namespace.nspname = 'public' AND NOT trigger_record.tgisinternal
      AND trigger_record.tgname = 'all_player_stat_observations_immutable' AND relation.relname = 'all_player_stat_observations'
      AND function_record.proname = 'prevent_all_player_history_change';
  IF actual_count <> 1 OR actual_fingerprint IS DISTINCT FROM '2698cd497ba819d17bc84364d21927e2'
      OR actual_table_owner IS DISTINCT FROM 'neondb_owner'
      OR actual_function_owner IS DISTINCT FROM 'neondb_owner' THEN
    RAISE EXCEPTION 'release assertion failed: trigger all_player_stat_observations_immutable'; END IF;

  SELECT count(*)::integer, min(md5(pg_get_triggerdef(trigger_record.oid, true))),
      min(table_owner.rolname), min(function_owner.rolname)
    INTO actual_count, actual_fingerprint, actual_table_owner, actual_function_owner
    FROM pg_trigger trigger_record JOIN pg_class relation ON relation.oid = trigger_record.tgrelid
    JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
    JOIN pg_roles table_owner ON table_owner.oid = relation.relowner
    JOIN pg_proc function_record ON function_record.oid = trigger_record.tgfoid
    JOIN pg_roles function_owner ON function_owner.oid = function_record.proowner
    WHERE namespace.nspname = 'public' AND NOT trigger_record.tgisinternal
      AND trigger_record.tgname = 'current_all_player_score_sets_job_fence' AND relation.relname = 'current_all_player_score_sets'
      AND function_record.proname = 'verify_all_player_pointer_job_fence';
  IF actual_count <> 1 OR actual_fingerprint IS DISTINCT FROM 'a5a6a227130b8c66e340744c857d23ec'
      OR actual_table_owner IS DISTINCT FROM 'neondb_owner'
      OR actual_function_owner IS DISTINCT FROM 'neondb_owner' THEN
    RAISE EXCEPTION 'release assertion failed: trigger current_all_player_score_sets_job_fence'; END IF;

  SELECT count(*)::integer, min(md5(pg_get_triggerdef(trigger_record.oid, true))),
      min(table_owner.rolname), min(function_owner.rolname)
    INTO actual_count, actual_fingerprint, actual_table_owner, actual_function_owner
    FROM pg_trigger trigger_record JOIN pg_class relation ON relation.oid = trigger_record.tgrelid
    JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
    JOIN pg_roles table_owner ON table_owner.oid = relation.relowner
    JOIN pg_proc function_record ON function_record.oid = trigger_record.tgfoid
    JOIN pg_roles function_owner ON function_owner.oid = function_record.proowner
    WHERE namespace.nspname = 'public' AND NOT trigger_record.tgisinternal
      AND trigger_record.tgname = 'league_week_all_player_parity_immutable' AND relation.relname = 'league_week_observations'
      AND function_record.proname = 'prevent_all_player_parity_evidence_change';
  IF actual_count <> 1 OR actual_fingerprint IS DISTINCT FROM '6a88192e5a0c7d34fb542eb4a0194547'
      OR actual_table_owner IS DISTINCT FROM 'neondb_owner'
      OR actual_function_owner IS DISTINCT FROM 'neondb_owner' THEN
    RAISE EXCEPTION 'release assertion failed: trigger league_week_all_player_parity_immutable'; END IF;

  SELECT count(*)::integer, min(md5(pg_get_triggerdef(trigger_record.oid, true))),
      min(table_owner.rolname), min(function_owner.rolname)
    INTO actual_count, actual_fingerprint, actual_table_owner, actual_function_owner
    FROM pg_trigger trigger_record JOIN pg_class relation ON relation.oid = trigger_record.tgrelid
    JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
    JOIN pg_roles table_owner ON table_owner.oid = relation.relowner
    JOIN pg_proc function_record ON function_record.oid = trigger_record.tgfoid
    JOIN pg_roles function_owner ON function_owner.oid = function_record.proowner
    WHERE namespace.nspname = 'public' AND NOT trigger_record.tgisinternal
      AND trigger_record.tgname = 'official_player_all_player_parity_immutable' AND relation.relname = 'official_player_point_observations'
      AND function_record.proname = 'prevent_all_player_parity_evidence_change';
  IF actual_count <> 1 OR actual_fingerprint IS DISTINCT FROM '9c32f0e4a4f11773174da2999e7911c7'
      OR actual_table_owner IS DISTINCT FROM 'neondb_owner'
      OR actual_function_owner IS DISTINCT FROM 'neondb_owner' THEN
    RAISE EXCEPTION 'release assertion failed: trigger official_player_all_player_parity_immutable'; END IF;

  SELECT count(*)::integer, min(md5(pg_get_triggerdef(trigger_record.oid, true))),
      min(table_owner.rolname), min(function_owner.rolname)
    INTO actual_count, actual_fingerprint, actual_table_owner, actual_function_owner
    FROM pg_trigger trigger_record JOIN pg_class relation ON relation.oid = trigger_record.tgrelid
    JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
    JOIN pg_roles table_owner ON table_owner.oid = relation.relowner
    JOIN pg_proc function_record ON function_record.oid = trigger_record.tgfoid
    JOIN pg_roles function_owner ON function_owner.oid = function_record.proowner
    WHERE namespace.nspname = 'public' AND NOT trigger_record.tgisinternal
      AND trigger_record.tgname = 'official_roster_all_player_parity_immutable' AND relation.relname = 'official_roster_point_observations'
      AND function_record.proname = 'prevent_all_player_parity_evidence_change';
  IF actual_count <> 1 OR actual_fingerprint IS DISTINCT FROM '94a8192ee90bad5c5b8e8cc63f98c62d'
      OR actual_table_owner IS DISTINCT FROM 'neondb_owner'
      OR actual_function_owner IS DISTINCT FROM 'neondb_owner' THEN
    RAISE EXCEPTION 'release assertion failed: trigger official_roster_all_player_parity_immutable'; END IF;

  SELECT count(*)::integer, min(md5(pg_get_triggerdef(trigger_record.oid, true))),
      min(table_owner.rolname), min(function_owner.rolname)
    INTO actual_count, actual_fingerprint, actual_table_owner, actual_function_owner
    FROM pg_trigger trigger_record JOIN pg_class relation ON relation.oid = trigger_record.tgrelid
    JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
    JOIN pg_roles table_owner ON table_owner.oid = relation.relowner
    JOIN pg_proc function_record ON function_record.oid = trigger_record.tgfoid
    JOIN pg_roles function_owner ON function_owner.oid = function_record.proowner
    WHERE namespace.nspname = 'public' AND NOT trigger_record.tgisinternal
      AND trigger_record.tgname = 'projection_jobs_all_player_budget_guard' AND relation.relname = 'projection_jobs'
      AND function_record.proname = 'protect_all_player_global_job';
  IF actual_count <> 1 OR actual_fingerprint IS DISTINCT FROM '7f8e3dad4cf513caaa1393bf5839a937'
      OR actual_table_owner IS DISTINCT FROM 'neondb_owner'
      OR actual_function_owner IS DISTINCT FROM 'neondb_owner' THEN
    RAISE EXCEPTION 'release assertion failed: trigger projection_jobs_all_player_budget_guard'; END IF;

  SELECT count(*)::integer, min(md5(pg_get_functiondef(function_record.oid))), min(owner.rolname),
      bool_or(has_function_privilege('public', function_record.oid, 'EXECUTE')),
      bool_or(has_function_privilege('league_one_runtime', function_record.oid, 'EXECUTE')),
      bool_or(has_function_privilege('public', function_record.oid, 'EXECUTE WITH GRANT OPTION')),
      bool_or(has_function_privilege('league_one_runtime', function_record.oid, 'EXECUTE WITH GRANT OPTION'))
    INTO actual_count, actual_fingerprint, actual_function_owner, actual_public_execute, actual_runtime_execute,
      actual_public_grant_execute, actual_runtime_grant_execute
    FROM pg_proc function_record JOIN pg_namespace namespace ON namespace.oid = function_record.pronamespace
    JOIN pg_roles owner ON owner.oid = function_record.proowner
    WHERE namespace.nspname = 'public' AND function_record.proname = 'advance_current_all_player_score_set'
      AND pg_get_function_identity_arguments(function_record.oid) = 'p_provider text, p_season smallint, p_season_type text, p_week smallint, p_scoring_profile_id uuid, p_scorer_version text, p_stat_observation_id uuid, p_score_set_id uuid, p_verified_at timestamp with time zone';
  IF actual_count <> 1 OR actual_fingerprint IS DISTINCT FROM '271c4babfefe1516069ce9cb26f21f69'
      OR actual_function_owner IS DISTINCT FROM 'neondb_owner' THEN
    RAISE EXCEPTION 'release assertion failed: function advance_current_all_player_score_set(p_provider text, p_season smallint, p_season_type text, p_week smallint, p_scoring_profile_id uuid, p_scorer_version text, p_stat_observation_id uuid, p_score_set_id uuid, p_verified_at timestamp with time zone)'; END IF;
  IF actual_public_execute IS DISTINCT FROM false
      OR actual_runtime_execute IS DISTINCT FROM true
      OR actual_public_grant_execute IS DISTINCT FROM false
      OR actual_runtime_grant_execute IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'release assertion failed: function ACL advance_current_all_player_score_set(p_provider text, p_season smallint, p_season_type text, p_week smallint, p_scoring_profile_id uuid, p_scorer_version text, p_stat_observation_id uuid, p_score_set_id uuid, p_verified_at timestamp with time zone)'; END IF;

  SELECT count(*)::integer, min(md5(pg_get_functiondef(function_record.oid))), min(owner.rolname),
      bool_or(has_function_privilege('public', function_record.oid, 'EXECUTE')),
      bool_or(has_function_privilege('league_one_runtime', function_record.oid, 'EXECUTE')),
      bool_or(has_function_privilege('public', function_record.oid, 'EXECUTE WITH GRANT OPTION')),
      bool_or(has_function_privilege('league_one_runtime', function_record.oid, 'EXECUTE WITH GRANT OPTION'))
    INTO actual_count, actual_fingerprint, actual_function_owner, actual_public_execute, actual_runtime_execute,
      actual_public_grant_execute, actual_runtime_grant_execute
    FROM pg_proc function_record JOIN pg_namespace namespace ON namespace.oid = function_record.pronamespace
    JOIN pg_roles owner ON owner.oid = function_record.proowner
    WHERE namespace.nspname = 'public' AND function_record.proname = 'advance_current_all_player_score_set'
      AND pg_get_function_identity_arguments(function_record.oid) = 'p_provider text, p_season smallint, p_season_type text, p_week smallint, p_scoring_profile_id uuid, p_scorer_version text, p_stat_observation_id uuid, p_score_set_id uuid, p_verified_at timestamp with time zone, p_fence jsonb';
  IF actual_count <> 1 OR actual_fingerprint IS DISTINCT FROM 'f73efafacb4fd0e628c305e5e2230f43'
      OR actual_function_owner IS DISTINCT FROM 'neondb_owner' THEN
    RAISE EXCEPTION 'release assertion failed: function advance_current_all_player_score_set(p_provider text, p_season smallint, p_season_type text, p_week smallint, p_scoring_profile_id uuid, p_scorer_version text, p_stat_observation_id uuid, p_score_set_id uuid, p_verified_at timestamp with time zone, p_fence jsonb)'; END IF;
  IF actual_public_execute IS DISTINCT FROM false
      OR actual_runtime_execute IS DISTINCT FROM true
      OR actual_public_grant_execute IS DISTINCT FROM false
      OR actual_runtime_grant_execute IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'release assertion failed: function ACL advance_current_all_player_score_set(p_provider text, p_season smallint, p_season_type text, p_week smallint, p_scoring_profile_id uuid, p_scorer_version text, p_stat_observation_id uuid, p_score_set_id uuid, p_verified_at timestamp with time zone, p_fence jsonb)'; END IF;

  SELECT count(*)::integer, min(md5(pg_get_functiondef(function_record.oid))), min(owner.rolname),
      bool_or(has_function_privilege('public', function_record.oid, 'EXECUTE')),
      bool_or(has_function_privilege('league_one_runtime', function_record.oid, 'EXECUTE')),
      bool_or(has_function_privilege('public', function_record.oid, 'EXECUTE WITH GRANT OPTION')),
      bool_or(has_function_privilege('league_one_runtime', function_record.oid, 'EXECUTE WITH GRANT OPTION'))
    INTO actual_count, actual_fingerprint, actual_function_owner, actual_public_execute, actual_runtime_execute,
      actual_public_grant_execute, actual_runtime_grant_execute
    FROM pg_proc function_record JOIN pg_namespace namespace ON namespace.oid = function_record.pronamespace
    JOIN pg_roles owner ON owner.oid = function_record.proowner
    WHERE namespace.nspname = 'public' AND function_record.proname = 'all_player_eligibility_evidence_matches'
      AND pg_get_function_identity_arguments(function_record.oid) = 'p_evidence jsonb, p_eligible_game_count smallint, p_appearance_game_count smallint';
  IF actual_count <> 1 OR actual_fingerprint IS DISTINCT FROM '8de02e93cdf2ecd135f5e00a8ba32460'
      OR actual_function_owner IS DISTINCT FROM 'neondb_owner' THEN
    RAISE EXCEPTION 'release assertion failed: function all_player_eligibility_evidence_matches(p_evidence jsonb, p_eligible_game_count smallint, p_appearance_game_count smallint)'; END IF;
  IF actual_public_execute IS DISTINCT FROM false
      OR actual_runtime_execute IS DISTINCT FROM false
      OR actual_public_grant_execute IS DISTINCT FROM false
      OR actual_runtime_grant_execute IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'release assertion failed: function ACL all_player_eligibility_evidence_matches(p_evidence jsonb, p_eligible_game_count smallint, p_appearance_game_count smallint)'; END IF;

  SELECT count(*)::integer, min(md5(pg_get_functiondef(function_record.oid))), min(owner.rolname),
      bool_or(has_function_privilege('public', function_record.oid, 'EXECUTE')),
      bool_or(has_function_privilege('league_one_runtime', function_record.oid, 'EXECUTE')),
      bool_or(has_function_privilege('public', function_record.oid, 'EXECUTE WITH GRANT OPTION')),
      bool_or(has_function_privilege('league_one_runtime', function_record.oid, 'EXECUTE WITH GRANT OPTION'))
    INTO actual_count, actual_fingerprint, actual_function_owner, actual_public_execute, actual_runtime_execute,
      actual_public_grant_execute, actual_runtime_grant_execute
    FROM pg_proc function_record JOIN pg_namespace namespace ON namespace.oid = function_record.pronamespace
    JOIN pg_roles owner ON owner.oid = function_record.proowner
    WHERE namespace.nspname = 'public' AND function_record.proname = 'all_player_job_fence_is_live'
      AND pg_get_function_identity_arguments(function_record.oid) = 'p_fence jsonb';
  IF actual_count <> 1 OR actual_fingerprint IS DISTINCT FROM 'a10a2f340be85ab789d457a38ca849c5'
      OR actual_function_owner IS DISTINCT FROM 'neondb_owner' THEN
    RAISE EXCEPTION 'release assertion failed: function all_player_job_fence_is_live(p_fence jsonb)'; END IF;
  IF actual_public_execute IS DISTINCT FROM false
      OR actual_runtime_execute IS DISTINCT FROM true
      OR actual_public_grant_execute IS DISTINCT FROM false
      OR actual_runtime_grant_execute IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'release assertion failed: function ACL all_player_job_fence_is_live(p_fence jsonb)'; END IF;

  SELECT count(*)::integer, min(md5(pg_get_functiondef(function_record.oid))), min(owner.rolname),
      bool_or(has_function_privilege('public', function_record.oid, 'EXECUTE')),
      bool_or(has_function_privilege('league_one_runtime', function_record.oid, 'EXECUTE')),
      bool_or(has_function_privilege('public', function_record.oid, 'EXECUTE WITH GRANT OPTION')),
      bool_or(has_function_privilege('league_one_runtime', function_record.oid, 'EXECUTE WITH GRANT OPTION'))
    INTO actual_count, actual_fingerprint, actual_function_owner, actual_public_execute, actual_runtime_execute,
      actual_public_grant_execute, actual_runtime_grant_execute
    FROM pg_proc function_record JOIN pg_namespace namespace ON namespace.oid = function_record.pronamespace
    JOIN pg_roles owner ON owner.oid = function_record.proowner
    WHERE namespace.nspname = 'public' AND function_record.proname = 'all_player_next_request_at'
      AND pg_get_function_identity_arguments(function_record.oid) = 'p_payload jsonb';
  IF actual_count <> 1 OR actual_fingerprint IS DISTINCT FROM '2acc1a0f78d247e94afec1e005a14f12'
      OR actual_function_owner IS DISTINCT FROM 'neondb_owner' THEN
    RAISE EXCEPTION 'release assertion failed: function all_player_next_request_at(p_payload jsonb)'; END IF;
  IF actual_public_execute IS DISTINCT FROM false
      OR actual_runtime_execute IS DISTINCT FROM true
      OR actual_public_grant_execute IS DISTINCT FROM false
      OR actual_runtime_grant_execute IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'release assertion failed: function ACL all_player_next_request_at(p_payload jsonb)'; END IF;

  SELECT count(*)::integer, min(md5(pg_get_functiondef(function_record.oid))), min(owner.rolname),
      bool_or(has_function_privilege('public', function_record.oid, 'EXECUTE')),
      bool_or(has_function_privilege('league_one_runtime', function_record.oid, 'EXECUTE')),
      bool_or(has_function_privilege('public', function_record.oid, 'EXECUTE WITH GRANT OPTION')),
      bool_or(has_function_privilege('league_one_runtime', function_record.oid, 'EXECUTE WITH GRANT OPTION'))
    INTO actual_count, actual_fingerprint, actual_function_owner, actual_public_execute, actual_runtime_execute,
      actual_public_grant_execute, actual_runtime_grant_execute
    FROM pg_proc function_record JOIN pg_namespace namespace ON namespace.oid = function_record.pronamespace
    JOIN pg_roles owner ON owner.oid = function_record.proowner
    WHERE namespace.nspname = 'public' AND function_record.proname = 'all_player_score_set_is_publication_ready'
      AND pg_get_function_identity_arguments(function_record.oid) = 'p_score_set_id uuid, p_expected_profile_ids jsonb';
  IF actual_count <> 1 OR actual_fingerprint IS DISTINCT FROM '4216c0e7a85951a78f9b2dfd8d2c1a7d'
      OR actual_function_owner IS DISTINCT FROM 'neondb_owner' THEN
    RAISE EXCEPTION 'release assertion failed: function all_player_score_set_is_publication_ready(p_score_set_id uuid, p_expected_profile_ids jsonb)'; END IF;
  IF actual_public_execute IS DISTINCT FROM false
      OR actual_runtime_execute IS DISTINCT FROM false
      OR actual_public_grant_execute IS DISTINCT FROM false
      OR actual_runtime_grant_execute IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'release assertion failed: function ACL all_player_score_set_is_publication_ready(p_score_set_id uuid, p_expected_profile_ids jsonb)'; END IF;

  SELECT count(*)::integer, min(md5(pg_get_functiondef(function_record.oid))), min(owner.rolname),
      bool_or(has_function_privilege('public', function_record.oid, 'EXECUTE')),
      bool_or(has_function_privilege('league_one_runtime', function_record.oid, 'EXECUTE')),
      bool_or(has_function_privilege('public', function_record.oid, 'EXECUTE WITH GRANT OPTION')),
      bool_or(has_function_privilege('league_one_runtime', function_record.oid, 'EXECUTE WITH GRANT OPTION'))
    INTO actual_count, actual_fingerprint, actual_function_owner, actual_public_execute, actual_runtime_execute,
      actual_public_grant_execute, actual_runtime_grant_execute
    FROM pg_proc function_record JOIN pg_namespace namespace ON namespace.oid = function_record.pronamespace
    JOIN pg_roles owner ON owner.oid = function_record.proowner
    WHERE namespace.nspname = 'public' AND function_record.proname = 'all_player_score_set_is_publication_ready'
      AND pg_get_function_identity_arguments(function_record.oid) = 'p_score_set_id uuid, p_expected_profile_ids jsonb, p_stat_observation_id uuid';
  IF actual_count <> 1 OR actual_fingerprint IS DISTINCT FROM '7c1eac237640b47dad43678df2a4ec72'
      OR actual_function_owner IS DISTINCT FROM 'neondb_owner' THEN
    RAISE EXCEPTION 'release assertion failed: function all_player_score_set_is_publication_ready(p_score_set_id uuid, p_expected_profile_ids jsonb, p_stat_observation_id uuid)'; END IF;
  IF actual_public_execute IS DISTINCT FROM false
      OR actual_runtime_execute IS DISTINCT FROM false
      OR actual_public_grant_execute IS DISTINCT FROM false
      OR actual_runtime_grant_execute IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'release assertion failed: function ACL all_player_score_set_is_publication_ready(p_score_set_id uuid, p_expected_profile_ids jsonb, p_stat_observation_id uuid)'; END IF;

  SELECT count(*)::integer, min(md5(pg_get_functiondef(function_record.oid))), min(owner.rolname),
      bool_or(has_function_privilege('public', function_record.oid, 'EXECUTE')),
      bool_or(has_function_privilege('league_one_runtime', function_record.oid, 'EXECUTE')),
      bool_or(has_function_privilege('public', function_record.oid, 'EXECUTE WITH GRANT OPTION')),
      bool_or(has_function_privilege('league_one_runtime', function_record.oid, 'EXECUTE WITH GRANT OPTION'))
    INTO actual_count, actual_fingerprint, actual_function_owner, actual_public_execute, actual_runtime_execute,
      actual_public_grant_execute, actual_runtime_grant_execute
    FROM pg_proc function_record JOIN pg_namespace namespace ON namespace.oid = function_record.pronamespace
    JOIN pg_roles owner ON owner.oid = function_record.proowner
    WHERE namespace.nspname = 'public' AND function_record.proname = 'all_player_scoring_contract_supported'
      AND pg_get_function_identity_arguments(function_record.oid) = 'p_provider text, p_scorer_version text, p_rules jsonb';
  IF actual_count <> 1 OR actual_fingerprint IS DISTINCT FROM 'd9506986a378ca857262374e5396173f'
      OR actual_function_owner IS DISTINCT FROM 'neondb_owner' THEN
    RAISE EXCEPTION 'release assertion failed: function all_player_scoring_contract_supported(p_provider text, p_scorer_version text, p_rules jsonb)'; END IF;
  IF actual_public_execute IS DISTINCT FROM false
      OR actual_runtime_execute IS DISTINCT FROM false
      OR actual_public_grant_execute IS DISTINCT FROM false
      OR actual_runtime_grant_execute IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'release assertion failed: function ACL all_player_scoring_contract_supported(p_provider text, p_scorer_version text, p_rules jsonb)'; END IF;

  SELECT count(*)::integer, min(md5(pg_get_functiondef(function_record.oid))), min(owner.rolname),
      bool_or(has_function_privilege('public', function_record.oid, 'EXECUTE')),
      bool_or(has_function_privilege('league_one_runtime', function_record.oid, 'EXECUTE')),
      bool_or(has_function_privilege('public', function_record.oid, 'EXECUTE WITH GRANT OPTION')),
      bool_or(has_function_privilege('league_one_runtime', function_record.oid, 'EXECUTE WITH GRANT OPTION'))
    INTO actual_count, actual_fingerprint, actual_function_owner, actual_public_execute, actual_runtime_execute,
      actual_public_grant_execute, actual_runtime_grant_execute
    FROM pg_proc function_record JOIN pg_namespace namespace ON namespace.oid = function_record.pronamespace
    JOIN pg_roles owner ON owner.oid = function_record.proowner
    WHERE namespace.nspname = 'public' AND function_record.proname = 'assert_all_player_job_fence'
      AND pg_get_function_identity_arguments(function_record.oid) = 'p_fence jsonb, p_period jsonb, p_require_request boolean';
  IF actual_count <> 1 OR actual_fingerprint IS DISTINCT FROM '3033d45120bb6b7995f1c57da1d60ac5'
      OR actual_function_owner IS DISTINCT FROM 'neondb_owner' THEN
    RAISE EXCEPTION 'release assertion failed: function assert_all_player_job_fence(p_fence jsonb, p_period jsonb, p_require_request boolean)'; END IF;
  IF actual_public_execute IS DISTINCT FROM false
      OR actual_runtime_execute IS DISTINCT FROM true
      OR actual_public_grant_execute IS DISTINCT FROM false
      OR actual_runtime_grant_execute IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'release assertion failed: function ACL assert_all_player_job_fence(p_fence jsonb, p_period jsonb, p_require_request boolean)'; END IF;

  SELECT count(*)::integer, min(md5(pg_get_functiondef(function_record.oid))), min(owner.rolname),
      bool_or(has_function_privilege('public', function_record.oid, 'EXECUTE')),
      bool_or(has_function_privilege('league_one_runtime', function_record.oid, 'EXECUTE')),
      bool_or(has_function_privilege('public', function_record.oid, 'EXECUTE WITH GRANT OPTION')),
      bool_or(has_function_privilege('league_one_runtime', function_record.oid, 'EXECUTE WITH GRANT OPTION'))
    INTO actual_count, actual_fingerprint, actual_function_owner, actual_public_execute, actual_runtime_execute,
      actual_public_grant_execute, actual_runtime_grant_execute
    FROM pg_proc function_record JOIN pg_namespace namespace ON namespace.oid = function_record.pronamespace
    JOIN pg_roles owner ON owner.oid = function_record.proowner
    WHERE namespace.nspname = 'public' AND function_record.proname = 'claim_all_player_job'
      AND pg_get_function_identity_arguments(function_record.oid) = 'p_mode text, p_period jsonb, p_worker text, p_lease_seconds integer, p_deadline timestamp with time zone';
  IF actual_count <> 1 OR actual_fingerprint IS DISTINCT FROM 'c5d34e04d8f366c0b724e3ae6f28dd0f'
      OR actual_function_owner IS DISTINCT FROM 'neondb_owner' THEN
    RAISE EXCEPTION 'release assertion failed: function claim_all_player_job(p_mode text, p_period jsonb, p_worker text, p_lease_seconds integer, p_deadline timestamp with time zone)'; END IF;
  IF actual_public_execute IS DISTINCT FROM false
      OR actual_runtime_execute IS DISTINCT FROM true
      OR actual_public_grant_execute IS DISTINCT FROM false
      OR actual_runtime_grant_execute IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'release assertion failed: function ACL claim_all_player_job(p_mode text, p_period jsonb, p_worker text, p_lease_seconds integer, p_deadline timestamp with time zone)'; END IF;

  SELECT count(*)::integer, min(md5(pg_get_functiondef(function_record.oid))), min(owner.rolname),
      bool_or(has_function_privilege('public', function_record.oid, 'EXECUTE')),
      bool_or(has_function_privilege('league_one_runtime', function_record.oid, 'EXECUTE')),
      bool_or(has_function_privilege('public', function_record.oid, 'EXECUTE WITH GRANT OPTION')),
      bool_or(has_function_privilege('league_one_runtime', function_record.oid, 'EXECUTE WITH GRANT OPTION'))
    INTO actual_count, actual_fingerprint, actual_function_owner, actual_public_execute, actual_runtime_execute,
      actual_public_grant_execute, actual_runtime_grant_execute
    FROM pg_proc function_record JOIN pg_namespace namespace ON namespace.oid = function_record.pronamespace
    JOIN pg_roles owner ON owner.oid = function_record.proowner
    WHERE namespace.nspname = 'public' AND function_record.proname = 'finish_all_player_job'
      AND pg_get_function_identity_arguments(function_record.oid) = 'p_fence jsonb, p_outcome text, p_diagnostic jsonb';
  IF actual_count <> 1 OR actual_fingerprint IS DISTINCT FROM 'f3a85518ccfc0c501c9fe42114b85b04'
      OR actual_function_owner IS DISTINCT FROM 'neondb_owner' THEN
    RAISE EXCEPTION 'release assertion failed: function finish_all_player_job(p_fence jsonb, p_outcome text, p_diagnostic jsonb)'; END IF;
  IF actual_public_execute IS DISTINCT FROM false
      OR actual_runtime_execute IS DISTINCT FROM true
      OR actual_public_grant_execute IS DISTINCT FROM false
      OR actual_runtime_grant_execute IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'release assertion failed: function ACL finish_all_player_job(p_fence jsonb, p_outcome text, p_diagnostic jsonb)'; END IF;

  SELECT count(*)::integer, min(md5(pg_get_functiondef(function_record.oid))), min(owner.rolname),
      bool_or(has_function_privilege('public', function_record.oid, 'EXECUTE')),
      bool_or(has_function_privilege('league_one_runtime', function_record.oid, 'EXECUTE')),
      bool_or(has_function_privilege('public', function_record.oid, 'EXECUTE WITH GRANT OPTION')),
      bool_or(has_function_privilege('league_one_runtime', function_record.oid, 'EXECUTE WITH GRANT OPTION'))
    INTO actual_count, actual_fingerprint, actual_function_owner, actual_public_execute, actual_runtime_execute,
      actual_public_grant_execute, actual_runtime_grant_execute
    FROM pg_proc function_record JOIN pg_namespace namespace ON namespace.oid = function_record.pronamespace
    JOIN pg_roles owner ON owner.oid = function_record.proowner
    WHERE namespace.nspname = 'public' AND function_record.proname = 'guard_all_player_child_insert'
      AND pg_get_function_identity_arguments(function_record.oid) = '';
  IF actual_count <> 1 OR actual_fingerprint IS DISTINCT FROM 'da0ef662ef8e9c152c2533a53d44e522'
      OR actual_function_owner IS DISTINCT FROM 'neondb_owner' THEN
    RAISE EXCEPTION 'release assertion failed: function guard_all_player_child_insert()'; END IF;
  IF actual_public_execute IS DISTINCT FROM false
      OR actual_runtime_execute IS DISTINCT FROM false
      OR actual_public_grant_execute IS DISTINCT FROM false
      OR actual_runtime_grant_execute IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'release assertion failed: function ACL guard_all_player_child_insert()'; END IF;

  SELECT count(*)::integer, min(md5(pg_get_functiondef(function_record.oid))), min(owner.rolname),
      bool_or(has_function_privilege('public', function_record.oid, 'EXECUTE')),
      bool_or(has_function_privilege('league_one_runtime', function_record.oid, 'EXECUTE')),
      bool_or(has_function_privilege('public', function_record.oid, 'EXECUTE WITH GRANT OPTION')),
      bool_or(has_function_privilege('league_one_runtime', function_record.oid, 'EXECUTE WITH GRANT OPTION'))
    INTO actual_count, actual_fingerprint, actual_function_owner, actual_public_execute, actual_runtime_execute,
      actual_public_grant_execute, actual_runtime_grant_execute
    FROM pg_proc function_record JOIN pg_namespace namespace ON namespace.oid = function_record.pronamespace
    JOIN pg_roles owner ON owner.oid = function_record.proowner
    WHERE namespace.nspname = 'public' AND function_record.proname = 'mark_all_player_request'
      AND pg_get_function_identity_arguments(function_record.oid) = 'p_fence jsonb, p_period jsonb';
  IF actual_count <> 1 OR actual_fingerprint IS DISTINCT FROM '1aab30aaf8293b7bfb91476ae57da4d9'
      OR actual_function_owner IS DISTINCT FROM 'neondb_owner' THEN
    RAISE EXCEPTION 'release assertion failed: function mark_all_player_request(p_fence jsonb, p_period jsonb)'; END IF;
  IF actual_public_execute IS DISTINCT FROM false
      OR actual_runtime_execute IS DISTINCT FROM true
      OR actual_public_grant_execute IS DISTINCT FROM false
      OR actual_runtime_grant_execute IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'release assertion failed: function ACL mark_all_player_request(p_fence jsonb, p_period jsonb)'; END IF;

  SELECT count(*)::integer, min(md5(pg_get_functiondef(function_record.oid))), min(owner.rolname),
      bool_or(has_function_privilege('public', function_record.oid, 'EXECUTE')),
      bool_or(has_function_privilege('league_one_runtime', function_record.oid, 'EXECUTE')),
      bool_or(has_function_privilege('public', function_record.oid, 'EXECUTE WITH GRANT OPTION')),
      bool_or(has_function_privilege('league_one_runtime', function_record.oid, 'EXECUTE WITH GRANT OPTION'))
    INTO actual_count, actual_fingerprint, actual_function_owner, actual_public_execute, actual_runtime_execute,
      actual_public_grant_execute, actual_runtime_grant_execute
    FROM pg_proc function_record JOIN pg_namespace namespace ON namespace.oid = function_record.pronamespace
    JOIN pg_roles owner ON owner.oid = function_record.proowner
    WHERE namespace.nspname = 'public' AND function_record.proname = 'prevent_all_player_history_change'
      AND pg_get_function_identity_arguments(function_record.oid) = '';
  IF actual_count <> 1 OR actual_fingerprint IS DISTINCT FROM '8ad4504ece6aa6bf9bc0f44281b93c73'
      OR actual_function_owner IS DISTINCT FROM 'neondb_owner' THEN
    RAISE EXCEPTION 'release assertion failed: function prevent_all_player_history_change()'; END IF;
  IF actual_public_execute IS DISTINCT FROM false
      OR actual_runtime_execute IS DISTINCT FROM false
      OR actual_public_grant_execute IS DISTINCT FROM false
      OR actual_runtime_grant_execute IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'release assertion failed: function ACL prevent_all_player_history_change()'; END IF;

  SELECT count(*)::integer, min(md5(pg_get_functiondef(function_record.oid))), min(owner.rolname),
      bool_or(has_function_privilege('public', function_record.oid, 'EXECUTE')),
      bool_or(has_function_privilege('league_one_runtime', function_record.oid, 'EXECUTE')),
      bool_or(has_function_privilege('public', function_record.oid, 'EXECUTE WITH GRANT OPTION')),
      bool_or(has_function_privilege('league_one_runtime', function_record.oid, 'EXECUTE WITH GRANT OPTION'))
    INTO actual_count, actual_fingerprint, actual_function_owner, actual_public_execute, actual_runtime_execute,
      actual_public_grant_execute, actual_runtime_grant_execute
    FROM pg_proc function_record JOIN pg_namespace namespace ON namespace.oid = function_record.pronamespace
    JOIN pg_roles owner ON owner.oid = function_record.proowner
    WHERE namespace.nspname = 'public' AND function_record.proname = 'prevent_all_player_parity_evidence_change'
      AND pg_get_function_identity_arguments(function_record.oid) = '';
  IF actual_count <> 1 OR actual_fingerprint IS DISTINCT FROM 'f636c52991858d6e9eb5ac4ba7bd2ec1'
      OR actual_function_owner IS DISTINCT FROM 'neondb_owner' THEN
    RAISE EXCEPTION 'release assertion failed: function prevent_all_player_parity_evidence_change()'; END IF;
  IF actual_public_execute IS DISTINCT FROM false
      OR actual_runtime_execute IS DISTINCT FROM false
      OR actual_public_grant_execute IS DISTINCT FROM false
      OR actual_runtime_grant_execute IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'release assertion failed: function ACL prevent_all_player_parity_evidence_change()'; END IF;

  SELECT count(*)::integer, min(md5(pg_get_functiondef(function_record.oid))), min(owner.rolname),
      bool_or(has_function_privilege('public', function_record.oid, 'EXECUTE')),
      bool_or(has_function_privilege('league_one_runtime', function_record.oid, 'EXECUTE')),
      bool_or(has_function_privilege('public', function_record.oid, 'EXECUTE WITH GRANT OPTION')),
      bool_or(has_function_privilege('league_one_runtime', function_record.oid, 'EXECUTE WITH GRANT OPTION'))
    INTO actual_count, actual_fingerprint, actual_function_owner, actual_public_execute, actual_runtime_execute,
      actual_public_grant_execute, actual_runtime_grant_execute
    FROM pg_proc function_record JOIN pg_namespace namespace ON namespace.oid = function_record.pronamespace
    JOIN pg_roles owner ON owner.oid = function_record.proowner
    WHERE namespace.nspname = 'public' AND function_record.proname = 'protect_all_player_global_job'
      AND pg_get_function_identity_arguments(function_record.oid) = '';
  IF actual_count <> 1 OR actual_fingerprint IS DISTINCT FROM '436a1595907bd85465d8fe4a9b22b30d'
      OR actual_function_owner IS DISTINCT FROM 'neondb_owner' THEN
    RAISE EXCEPTION 'release assertion failed: function protect_all_player_global_job()'; END IF;
  IF actual_public_execute IS DISTINCT FROM false
      OR actual_runtime_execute IS DISTINCT FROM false
      OR actual_public_grant_execute IS DISTINCT FROM false
      OR actual_runtime_grant_execute IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'release assertion failed: function ACL protect_all_player_global_job()'; END IF;

  SELECT count(*)::integer, min(md5(pg_get_functiondef(function_record.oid))), min(owner.rolname),
      bool_or(has_function_privilege('public', function_record.oid, 'EXECUTE')),
      bool_or(has_function_privilege('league_one_runtime', function_record.oid, 'EXECUTE')),
      bool_or(has_function_privilege('public', function_record.oid, 'EXECUTE WITH GRANT OPTION')),
      bool_or(has_function_privilege('league_one_runtime', function_record.oid, 'EXECUTE WITH GRANT OPTION'))
    INTO actual_count, actual_fingerprint, actual_function_owner, actual_public_execute, actual_runtime_execute,
      actual_public_grant_execute, actual_runtime_grant_execute
    FROM pg_proc function_record JOIN pg_namespace namespace ON namespace.oid = function_record.pronamespace
    JOIN pg_roles owner ON owner.oid = function_record.proowner
    WHERE namespace.nspname = 'public' AND function_record.proname = 'record_all_player_preclaim_outcome'
      AND pg_get_function_identity_arguments(function_record.oid) = 'p_input jsonb';
  IF actual_count <> 1 OR actual_fingerprint IS DISTINCT FROM '11e5dbc387cc1edf4fc78581d66dcd12'
      OR actual_function_owner IS DISTINCT FROM 'neondb_owner' THEN
    RAISE EXCEPTION 'release assertion failed: function record_all_player_preclaim_outcome(p_input jsonb)'; END IF;
  IF actual_public_execute IS DISTINCT FROM false
      OR actual_runtime_execute IS DISTINCT FROM true
      OR actual_public_grant_execute IS DISTINCT FROM false
      OR actual_runtime_grant_execute IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'release assertion failed: function ACL record_all_player_preclaim_outcome(p_input jsonb)'; END IF;

  SELECT count(*)::integer, min(md5(pg_get_functiondef(function_record.oid))), min(owner.rolname),
      bool_or(has_function_privilege('public', function_record.oid, 'EXECUTE')),
      bool_or(has_function_privilege('league_one_runtime', function_record.oid, 'EXECUTE')),
      bool_or(has_function_privilege('public', function_record.oid, 'EXECUTE WITH GRANT OPTION')),
      bool_or(has_function_privilege('league_one_runtime', function_record.oid, 'EXECUTE WITH GRANT OPTION'))
    INTO actual_count, actual_fingerprint, actual_function_owner, actual_public_execute, actual_runtime_execute,
      actual_public_grant_execute, actual_runtime_grant_execute
    FROM pg_proc function_record JOIN pg_namespace namespace ON namespace.oid = function_record.pronamespace
    JOIN pg_roles owner ON owner.oid = function_record.proowner
    WHERE namespace.nspname = 'public' AND function_record.proname = 'validate_all_player_score_lineage'
      AND pg_get_function_identity_arguments(function_record.oid) = '';
  IF actual_count <> 1 OR actual_fingerprint IS DISTINCT FROM '008fa7c58b02462b2a085a9037e49287'
      OR actual_function_owner IS DISTINCT FROM 'neondb_owner' THEN
    RAISE EXCEPTION 'release assertion failed: function validate_all_player_score_lineage()'; END IF;
  IF actual_public_execute IS DISTINCT FROM false
      OR actual_runtime_execute IS DISTINCT FROM false
      OR actual_public_grant_execute IS DISTINCT FROM false
      OR actual_runtime_grant_execute IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'release assertion failed: function ACL validate_all_player_score_lineage()'; END IF;

  SELECT count(*)::integer, min(md5(pg_get_functiondef(function_record.oid))), min(owner.rolname),
      bool_or(has_function_privilege('public', function_record.oid, 'EXECUTE')),
      bool_or(has_function_privilege('league_one_runtime', function_record.oid, 'EXECUTE')),
      bool_or(has_function_privilege('public', function_record.oid, 'EXECUTE WITH GRANT OPTION')),
      bool_or(has_function_privilege('league_one_runtime', function_record.oid, 'EXECUTE WITH GRANT OPTION'))
    INTO actual_count, actual_fingerprint, actual_function_owner, actual_public_execute, actual_runtime_execute,
      actual_public_grant_execute, actual_runtime_grant_execute
    FROM pg_proc function_record JOIN pg_namespace namespace ON namespace.oid = function_record.pronamespace
    JOIN pg_roles owner ON owner.oid = function_record.proowner
    WHERE namespace.nspname = 'public' AND function_record.proname = 'validate_all_player_score_verification'
      AND pg_get_function_identity_arguments(function_record.oid) = '';
  IF actual_count <> 1 OR actual_fingerprint IS DISTINCT FROM '658c0a7c8f8ab40a04086d8242ffb4cb'
      OR actual_function_owner IS DISTINCT FROM 'neondb_owner' THEN
    RAISE EXCEPTION 'release assertion failed: function validate_all_player_score_verification()'; END IF;
  IF actual_public_execute IS DISTINCT FROM false
      OR actual_runtime_execute IS DISTINCT FROM false
      OR actual_public_grant_execute IS DISTINCT FROM false
      OR actual_runtime_grant_execute IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'release assertion failed: function ACL validate_all_player_score_verification()'; END IF;

  SELECT count(*)::integer, min(md5(pg_get_functiondef(function_record.oid))), min(owner.rolname),
      bool_or(has_function_privilege('public', function_record.oid, 'EXECUTE')),
      bool_or(has_function_privilege('league_one_runtime', function_record.oid, 'EXECUTE')),
      bool_or(has_function_privilege('public', function_record.oid, 'EXECUTE WITH GRANT OPTION')),
      bool_or(has_function_privilege('league_one_runtime', function_record.oid, 'EXECUTE WITH GRANT OPTION'))
    INTO actual_count, actual_fingerprint, actual_function_owner, actual_public_execute, actual_runtime_execute,
      actual_public_grant_execute, actual_runtime_grant_execute
    FROM pg_proc function_record JOIN pg_namespace namespace ON namespace.oid = function_record.pronamespace
    JOIN pg_roles owner ON owner.oid = function_record.proowner
    WHERE namespace.nspname = 'public' AND function_record.proname = 'validate_all_player_stat_entry'
      AND pg_get_function_identity_arguments(function_record.oid) = '';
  IF actual_count <> 1 OR actual_fingerprint IS DISTINCT FROM 'ec7279f8883ad68f9ce783de4e597170'
      OR actual_function_owner IS DISTINCT FROM 'neondb_owner' THEN
    RAISE EXCEPTION 'release assertion failed: function validate_all_player_stat_entry()'; END IF;
  IF actual_public_execute IS DISTINCT FROM false
      OR actual_runtime_execute IS DISTINCT FROM false
      OR actual_public_grant_execute IS DISTINCT FROM false
      OR actual_runtime_grant_execute IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'release assertion failed: function ACL validate_all_player_stat_entry()'; END IF;

  SELECT count(*)::integer, min(md5(pg_get_functiondef(function_record.oid))), min(owner.rolname),
      bool_or(has_function_privilege('public', function_record.oid, 'EXECUTE')),
      bool_or(has_function_privilege('league_one_runtime', function_record.oid, 'EXECUTE')),
      bool_or(has_function_privilege('public', function_record.oid, 'EXECUTE WITH GRANT OPTION')),
      bool_or(has_function_privilege('league_one_runtime', function_record.oid, 'EXECUTE WITH GRANT OPTION'))
    INTO actual_count, actual_fingerprint, actual_function_owner, actual_public_execute, actual_runtime_execute,
      actual_public_grant_execute, actual_runtime_grant_execute
    FROM pg_proc function_record JOIN pg_namespace namespace ON namespace.oid = function_record.pronamespace
    JOIN pg_roles owner ON owner.oid = function_record.proowner
    WHERE namespace.nspname = 'public' AND function_record.proname = 'verify_all_player_pointer_job_fence'
      AND pg_get_function_identity_arguments(function_record.oid) = '';
  IF actual_count <> 1 OR actual_fingerprint IS DISTINCT FROM 'e9b63df40a795a09974930c565a1ad56'
      OR actual_function_owner IS DISTINCT FROM 'neondb_owner' THEN
    RAISE EXCEPTION 'release assertion failed: function verify_all_player_pointer_job_fence()'; END IF;
  IF actual_public_execute IS DISTINCT FROM false
      OR actual_runtime_execute IS DISTINCT FROM false
      OR actual_public_grant_execute IS DISTINCT FROM false
      OR actual_runtime_grant_execute IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'release assertion failed: function ACL verify_all_player_pointer_job_fence()'; END IF;

  
  IF (SELECT count(*) FROM pg_class relation WHERE relation.relnamespace = 'public'::regnamespace
      AND relation.relkind = 'r'
      AND (relation.relname LIKE 'all_player_%' OR relation.relname = 'current_all_player_score_sets'))
      <> 7
    THEN RAISE EXCEPTION 'release assertion failed: exact migration 011 table set'; END IF;
  IF (SELECT count(*) FROM pg_trigger trigger_record
      JOIN pg_class relation ON relation.oid = trigger_record.tgrelid
      JOIN pg_proc function_record ON function_record.oid = trigger_record.tgfoid
      WHERE relation.relnamespace = 'public'::regnamespace AND NOT trigger_record.tgisinternal
        AND (trigger_record.tgname LIKE '%all_player%' OR function_record.proname LIKE '%all_player%'))
      <> 16
    THEN RAISE EXCEPTION 'release assertion failed: exact migration 011 trigger set'; END IF;
  IF (SELECT count(*) FROM pg_proc function_record
      WHERE function_record.pronamespace = 'public'::regnamespace
        AND function_record.proname LIKE '%all_player%') <> 21
    THEN RAISE EXCEPTION 'release assertion failed: exact migration 011 function set'; END IF;
  
  IF (SELECT count(*) FROM pg_constraint c JOIN pg_class t ON t.oid = c.conrelid
    WHERE t.relnamespace = 'public'::regnamespace AND t.relname = ANY(ARRAY['all_player_score_sets', 'all_player_score_verifications', 'all_player_scores', 'all_player_stat_contents', 'all_player_stat_entries', 'all_player_stat_observations', 'current_all_player_score_sets']::text[])
      AND c.contype = 'c') <> 51
    THEN RAISE EXCEPTION 'release assertion failed: PostgreSQL 18 constraint type c'; END IF;
  IF (SELECT count(*) FROM pg_constraint c JOIN pg_class t ON t.oid = c.conrelid
    WHERE t.relnamespace = 'public'::regnamespace AND t.relname = ANY(ARRAY['all_player_score_sets', 'all_player_score_verifications', 'all_player_scores', 'all_player_stat_contents', 'all_player_stat_entries', 'all_player_stat_observations', 'current_all_player_score_sets']::text[])
      AND c.contype = 'f') <> 15
    THEN RAISE EXCEPTION 'release assertion failed: PostgreSQL 18 constraint type f'; END IF;
  IF (SELECT count(*) FROM pg_constraint c JOIN pg_class t ON t.oid = c.conrelid
    WHERE t.relnamespace = 'public'::regnamespace AND t.relname = ANY(ARRAY['all_player_score_sets', 'all_player_score_verifications', 'all_player_scores', 'all_player_stat_contents', 'all_player_stat_entries', 'all_player_stat_observations', 'current_all_player_score_sets']::text[])
      AND c.contype = 'n') <> 79
    THEN RAISE EXCEPTION 'release assertion failed: PostgreSQL 18 constraint type n'; END IF;
  IF (SELECT count(*) FROM pg_constraint c JOIN pg_class t ON t.oid = c.conrelid
    WHERE t.relnamespace = 'public'::regnamespace AND t.relname = ANY(ARRAY['all_player_score_sets', 'all_player_score_verifications', 'all_player_scores', 'all_player_stat_contents', 'all_player_stat_entries', 'all_player_stat_observations', 'current_all_player_score_sets']::text[])
      AND c.contype = 'p') <> 7
    THEN RAISE EXCEPTION 'release assertion failed: PostgreSQL 18 constraint type p'; END IF;
  IF (SELECT count(*) FROM pg_constraint c JOIN pg_class t ON t.oid = c.conrelid
    WHERE t.relnamespace = 'public'::regnamespace AND t.relname = ANY(ARRAY['all_player_score_sets', 'all_player_score_verifications', 'all_player_scores', 'all_player_stat_contents', 'all_player_stat_entries', 'all_player_stat_observations', 'current_all_player_score_sets']::text[])
      AND c.contype = 't') <> 1
    THEN RAISE EXCEPTION 'release assertion failed: PostgreSQL 18 constraint type t'; END IF;
  IF (SELECT count(*) FROM pg_constraint c JOIN pg_class t ON t.oid = c.conrelid
    WHERE t.relnamespace = 'public'::regnamespace AND t.relname = ANY(ARRAY['all_player_score_sets', 'all_player_score_verifications', 'all_player_scores', 'all_player_stat_contents', 'all_player_stat_entries', 'all_player_stat_observations', 'current_all_player_score_sets']::text[])
      AND c.contype = 'u') <> 10
    THEN RAISE EXCEPTION 'release assertion failed: PostgreSQL 18 constraint type u'; END IF;
  IF (SELECT count(*) FROM app_schema_migrations) <> 11
    THEN RAISE EXCEPTION 'release assertion failed: migration ledger count'; END IF;
  IF (SELECT checksum FROM app_schema_migrations WHERE name = '011_all_player_foundation_guards.sql')
    IS DISTINCT FROM '0eaa96bcc0b65053ac8dab48657eb7bfe22fadbfd41b4f4c78c3472ca8a512b6' THEN RAISE EXCEPTION 'release assertion failed: 011 checksum'; END IF;
  FOR old_count IN SELECT * FROM all_player_repair_before_counts LOOP
    EXECUTE format('SELECT count(*) FROM public.%I',old_count.name) INTO actual_rows;
    IF actual_rows <> old_count.rows THEN RAISE EXCEPTION 'release assertion failed: history count changed'; END IF;
  END LOOP;
  SELECT fingerprint INTO STRICT before_catalog FROM all_player_release_before;
  after_catalog := pg_temp.all_player_release_unaffected_catalog();
  
  IF before_catalog->>'schemas' IS DISTINCT FROM after_catalog->>'schemas'
    THEN RAISE EXCEPTION 'release assertion failed: unrelated schemas changed'; END IF;
  IF before_catalog->>'tables' IS DISTINCT FROM after_catalog->>'tables'
    THEN RAISE EXCEPTION 'release assertion failed: unrelated tables changed'; END IF;
  IF before_catalog->>'columns' IS DISTINCT FROM after_catalog->>'columns'
    THEN RAISE EXCEPTION 'release assertion failed: unrelated columns changed'; END IF;
  IF before_catalog->>'constraints' IS DISTINCT FROM after_catalog->>'constraints'
    THEN RAISE EXCEPTION 'release assertion failed: unrelated constraints changed'; END IF;
  IF before_catalog->>'indexes' IS DISTINCT FROM after_catalog->>'indexes'
    THEN RAISE EXCEPTION 'release assertion failed: unrelated indexes changed'; END IF;
  IF before_catalog->>'triggers' IS DISTINCT FROM after_catalog->>'triggers'
    THEN RAISE EXCEPTION 'release assertion failed: unrelated triggers changed'; END IF;
  IF before_catalog->>'functions' IS DISTINCT FROM after_catalog->>'functions'
    THEN RAISE EXCEPTION 'release assertion failed: unrelated functions changed'; END IF;
  IF before_catalog->>'roles' IS DISTINCT FROM after_catalog->>'roles'
    THEN RAISE EXCEPTION 'release assertion failed: unrelated roles changed'; END IF;
  IF before_catalog->>'memberships' IS DISTINCT FROM after_catalog->>'memberships'
    THEN RAISE EXCEPTION 'release assertion failed: unrelated memberships changed'; END IF;
  IF before_catalog->>'default_privileges' IS DISTINCT FROM after_catalog->>'default_privileges'
    THEN RAISE EXCEPTION 'release assertion failed: unrelated default_privileges changed'; END IF;
END; $repair_after$;
COMMIT;
SELECT 'ALL_PLAYER_REPAIR_APPLIED:011_all_player_foundation_guards.sql:0eaa96bcc0b65053ac8dab48657eb7bfe22fadbfd41b4f4c78c3472ca8a512b6' AS success_sentinel;
