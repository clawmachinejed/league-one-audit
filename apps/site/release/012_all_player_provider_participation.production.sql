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
  IF (SELECT count(*) FROM app_schema_migrations) <> 11
    THEN RAISE EXCEPTION 'release assertion failed: expected exactly migrations 001-011'; END IF;
  
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
  IF (SELECT checksum FROM app_schema_migrations WHERE name = '011_all_player_foundation_guards.sql') IS DISTINCT FROM '0eaa96bcc0b65053ac8dab48657eb7bfe22fadbfd41b4f4c78c3472ca8a512b6'
    THEN RAISE EXCEPTION 'release assertion failed: previous migration 011_all_player_foundation_guards.sql'; END IF;
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
        AND trigger_record.tgname <> ALL (ARRAY['all_player_provider_context_guard', 'all_player_score_sets_immutable', 'all_player_score_verifications_immutable', 'all_player_score_verifications_lineage_guard', 'all_player_scores_append_guard', 'all_player_scores_immutable', 'all_player_scores_lineage_guard', 'all_player_stat_contents_immutable', 'all_player_stat_entries_append_guard', 'all_player_stat_entries_evidence_guard', 'all_player_stat_entries_immutable', 'all_player_stat_observations_immutable', 'current_all_player_score_sets_job_fence', 'league_week_all_player_parity_immutable', 'official_player_all_player_parity_immutable', 'official_roster_all_player_parity_immutable', 'projection_jobs_all_player_budget_guard']::text[])),
    'functions', (SELECT md5(COALESCE(string_agg(
      function_record.proname || chr(31) || pg_get_function_identity_arguments(function_record.oid)
        || chr(31) || owner.rolname || chr(31) || COALESCE(function_record.proacl::text, '')
        || chr(31) || pg_get_functiondef(function_record.oid),
      chr(30) ORDER BY function_record.proname, pg_get_function_identity_arguments(function_record.oid)), ''))
      FROM pg_proc function_record JOIN pg_namespace namespace ON namespace.oid = function_record.pronamespace
      JOIN pg_roles owner ON owner.oid = function_record.proowner
      WHERE namespace.nspname = 'public' AND function_record.proname <> ALL (ARRAY['advance_current_all_player_score_set', 'all_player_eligibility_evidence_matches', 'all_player_job_fence_is_live', 'all_player_next_request_at', 'all_player_score_set_is_publication_ready', 'all_player_scoring_contract_supported', 'assert_all_player_job_fence', 'claim_all_player_job', 'finish_all_player_job', 'guard_all_player_child_insert', 'mark_all_player_request', 'prevent_all_player_history_change', 'prevent_all_player_parity_evidence_change', 'protect_all_player_global_job', 'record_all_player_preclaim_outcome', 'validate_all_player_provider_context', 'validate_all_player_score_lineage', 'validate_all_player_score_verification', 'validate_all_player_stat_entry', 'verify_all_player_pointer_job_fence']::text[])),
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
  SELECT 'current_all_player_score_sets',count(*) FROM current_all_player_score_sets UNION ALL SELECT 'all_player_score_verifications',count(*) FROM all_player_score_verifications;
-- Additive provider participation evidence; installed 010 and 011 remain unchanged.
-- Existing function replacements preserve ownership and ACLs. Context is
-- observation-only: it does not alter raw content or scoring semantic identity.

ALTER TABLE public.all_player_stat_observations ADD COLUMN provider_context jsonb;
ALTER TABLE public.all_player_stat_observations ADD CONSTRAINT all_player_provider_context_shape
  CHECK (provider_context IS NULL OR (jsonb_typeof(provider_context) = 'object'
    AND octet_length(provider_context::text) <= 1200000));

CREATE FUNCTION public.validate_all_player_provider_context()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  context jsonb := NEW.provider_context;
  player jsonb;
  context_observed_at timestamptz;
  text_key text;
BEGIN
  IF context IS NULL THEN RETURN NEW; END IF;
  IF jsonb_typeof(context) IS DISTINCT FROM 'object'
    OR octet_length(context::text) > 1200000
    OR context - ARRAY['version','role','source','sourceRevision','observedAt','effectivePeriod','players'] <> '{}'::jsonb
    OR context->>'version' IS DISTINCT FROM 'catalog-status-context-v1'
    OR context->>'role' IS DISTINCT FROM 'context-only'
    OR context->>'source' IS DISTINCT FROM 'official-player-catalog'
    OR jsonb_typeof(context->'sourceRevision') IS DISTINCT FROM 'string'
    OR context->>'sourceRevision' !~ '^sha256:[0-9a-f]{64}$'
    OR context->'effectivePeriod' IS DISTINCT FROM 'null'::jsonb
    OR jsonb_typeof(context->'observedAt') IS DISTINCT FROM 'string'
    OR context->>'observedAt' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z$'
    OR jsonb_typeof(context->'players') IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'all-player provider context has an invalid shape';
  END IF;
  BEGIN
    context_observed_at := (context->>'observedAt')::timestamptz;
    IF NOT isfinite(context_observed_at)
      OR to_char(context_observed_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
        IS DISTINCT FROM context->>'observedAt'
      OR context_observed_at > NEW.observed_at THEN
      RAISE EXCEPTION 'invalid catalog observation time';
    END IF;
  EXCEPTION WHEN others THEN
    RAISE EXCEPTION 'all-player provider context has an invalid observation time';
  END;
  IF jsonb_array_length(context->'players') > 10000 THEN
    RAISE EXCEPTION 'all-player provider context exceeds its player bound';
  END IF;
  IF (SELECT count(DISTINCT item->>'providerExternalId') FROM jsonb_array_elements(context->'players') item)
    <> jsonb_array_length(context->'players') THEN
    RAISE EXCEPTION 'all-player provider context has duplicate or missing player identities';
  END IF;
  FOR player IN SELECT value FROM jsonb_array_elements(context->'players') LOOP
    IF jsonb_typeof(player) IS DISTINCT FROM 'object'
      OR player - ARRAY['providerExternalId','nflGameId','currentTeam','status','active','injuryStatus'] <> '{}'::jsonb
      OR jsonb_typeof(player->'providerExternalId') IS DISTINCT FROM 'string'
      OR btrim(player->>'providerExternalId') = '' OR length(player->>'providerExternalId') > 128
      OR btrim(player->>'providerExternalId') IS DISTINCT FROM player->>'providerExternalId'
      OR NOT (player ? 'nflGameId')
      OR (player->'nflGameId' <> 'null'::jsonb AND (
        jsonb_typeof(player->'nflGameId') IS DISTINCT FROM 'string'
        OR player->>'nflGameId' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'))
      OR (player ? 'active' AND jsonb_typeof(player->'active') IS DISTINCT FROM 'boolean') THEN
      RAISE EXCEPTION 'all-player provider context has an invalid player';
    END IF;
    FOREACH text_key IN ARRAY ARRAY['currentTeam','status','injuryStatus'] LOOP
      IF player ? text_key AND (jsonb_typeof(player->text_key) IS DISTINCT FROM 'string'
        OR btrim(player->>text_key) = '' OR length(player->>text_key) > 128
        OR btrim(player->>text_key) IS DISTINCT FROM player->>text_key) THEN
        RAISE EXCEPTION 'all-player provider context has invalid player metadata';
      END IF;
    END LOOP;
  END LOOP;
  -- One set-based identity check keeps this bounded bulk metadata operation
  -- from performing a database lookup for every retained catalog player.
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(context->'players') item
    LEFT JOIN public.all_player_stat_entries entry
      ON entry.all_player_stat_content_id = NEW.all_player_stat_content_id
      AND entry.entity_kind = 'player' AND entry.provider_external_id = item->>'providerExternalId'
      AND entry.nfl_game_id IS NOT DISTINCT FROM (item->>'nflGameId')::uuid
    WHERE entry.provider_external_id IS NULL) THEN
    RAISE EXCEPTION 'all-player provider context does not match its observed player and game';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.validate_all_player_provider_context() FROM PUBLIC;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'league_one_runtime') THEN
    REVOKE ALL ON FUNCTION public.validate_all_player_provider_context() FROM league_one_runtime;
  END IF;
END; $$;
CREATE TRIGGER all_player_provider_context_guard
  BEFORE INSERT ON public.all_player_stat_observations
  FOR EACH ROW EXECUTE FUNCTION public.validate_all_player_provider_context();

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
  positive_snaps boolean;
BEGIN
  IF jsonb_typeof(p_evidence) IS DISTINCT FROM 'object' THEN RETURN false; END IF;
  evidence_kind := p_evidence->>'kind';
  IF evidence_kind = 'weekly-stat' THEN
    IF p_evidence - ARRAY['kind', 'source', 'gmsActive', 'appearances', 'rawFlags', 'individualSnaps'] <> '{}'::jsonb
      OR p_evidence->>'source' IS DISTINCT FROM 'weekly-stat-provider'
      OR (p_evidence ? 'gmsActive' AND (jsonb_typeof(p_evidence->'gmsActive') IS DISTINCT FROM 'number'
        OR p_evidence->>'gmsActive' NOT IN ('0','1')))
      OR (p_evidence ? 'appearances' AND (jsonb_typeof(p_evidence->'appearances') IS DISTINCT FROM 'number'
        OR p_evidence->>'appearances' NOT IN ('0','1'))) THEN RETURN false; END IF;
    IF p_evidence ? 'individualSnaps' THEN
      IF jsonb_typeof(p_evidence->'individualSnaps') IS DISTINCT FROM 'object'
        OR p_evidence->'individualSnaps' = '{}'::jsonb
        OR (p_evidence->'individualSnaps') - ARRAY['off_snp','def_snp','st_snp'] <> '{}'::jsonb
        OR EXISTS (SELECT 1 FROM jsonb_each(p_evidence->'individualSnaps') AS snap
          WHERE CASE WHEN jsonb_typeof(snap.value) = 'number' THEN
            (snap.value::text)::numeric NOT BETWEEN 0 AND 9007199254740991
            OR trunc((snap.value::text)::numeric) <> (snap.value::text)::numeric
          ELSE true END) THEN RETURN false; END IF;
    END IF;
    IF p_evidence ? 'rawFlags' THEN
      IF jsonb_typeof(p_evidence->'rawFlags') IS DISTINCT FROM 'object'
        OR p_evidence->'rawFlags' = '{}'::jsonb
        OR (p_evidence->'rawFlags') - ARRAY['gms_active','gp','off_snp','def_snp','st_snp'] <> '{}'::jsonb
        OR EXISTS (SELECT 1 FROM jsonb_each(p_evidence->'rawFlags') AS flag
          WHERE CASE WHEN flag.key IN ('gms_active','gp') THEN
            flag.value IN ('0'::jsonb, '1'::jsonb)
            OR (flag.key = 'gms_active' AND p_evidence ? 'gmsActive')
            OR (flag.key = 'gp' AND p_evidence ? 'appearances')
          ELSE COALESCE(p_evidence->'individualSnaps' ? flag.key,false)
            OR CASE WHEN jsonb_typeof(flag.value) = 'number' THEN
              (flag.value::text)::numeric BETWEEN 0 AND 9007199254740991
              AND trunc((flag.value::text)::numeric) = (flag.value::text)::numeric
            ELSE false END END) THEN RETURN false; END IF;
      RETURN p_eligible_game_count IS NULL AND p_appearance_game_count IS NULL;
    END IF;
    positive_snaps := EXISTS (SELECT 1 FROM jsonb_each(COALESCE(p_evidence->'individualSnaps','{}'::jsonb)) AS snap
      WHERE (snap.value::text)::numeric > 0);
    active_count := (p_evidence->>'gmsActive')::smallint;
    appearance_count := (p_evidence->>'appearances')::smallint;
    IF (active_count = 0 AND appearance_count = 1)
      OR (positive_snaps AND (active_count = 0 OR appearance_count = 0)) THEN
      RETURN p_eligible_game_count IS NULL AND p_appearance_game_count IS NULL;
    ELSIF active_count = 0 THEN expected_eligible := 0; expected_appearance := 0;
    ELSIF appearance_count = 1 OR positive_snaps THEN expected_eligible := 1; expected_appearance := 1;
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
      positive_snaps := EXISTS (SELECT 1 FROM jsonb_each(COALESCE(weekly->'individualSnaps','{}'::jsonb)) AS snap
        WHERE (snap.value::text)::numeric > 0);
      invalid_flags := weekly ? 'rawFlags' OR (weekly->>'gmsActive' = '0' AND weekly->>'appearances' = '1')
        OR (positive_snaps AND (weekly->>'gmsActive' = '0' OR weekly->>'appearances' = '0'));
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
      OR COALESCE(weekly->>'gmsActive' = '0' AND weekly->>'appearances' = '1',false)
      OR (EXISTS (SELECT 1 FROM jsonb_each(COALESCE(weekly->'individualSnaps','{}'::jsonb)) AS snap
        WHERE (snap.value::text)::numeric > 0)
        AND COALESCE(weekly->>'gmsActive' = '0' OR weekly->>'appearances' = '0',false));
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
  SELECT season,season_type,week,normalizer_version INTO STRICT content_context
  FROM public.all_player_stat_contents WHERE id = NEW.all_player_stat_content_id;
  weekly_evidence := CASE WHEN NEW.eligibility_evidence->>'kind' = 'weekly-stat'
    THEN NEW.eligibility_evidence ELSE NEW.eligibility_evidence->'weekly' END;
  IF content_context.normalizer_version LIKE '%-weekly-stats-v3'
    AND weekly_evidence IS NULL AND NEW.stats ?| ARRAY['gms_active','gp','off_snp','def_snp','st_snp'] THEN
    RAISE EXCEPTION 'all-player retained participation statistics require weekly evidence';
  END IF;
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
    IF weekly_evidence ? 'individualSnaps'
      OR COALESCE(weekly_evidence->'rawFlags' ?| ARRAY['off_snp','def_snp','st_snp'],false) THEN
      IF NEW.entity_kind IS DISTINCT FROM 'player' THEN
        RAISE EXCEPTION 'all-player individual snap evidence requires a player identity';
      END IF;
    END IF;
    -- v2 observations may already retain snap statistics without using them as
    -- participation evidence. Preserve those exact historical replays. v3
    -- and any caller using the new evidence must bind every retained snap key.
    IF content_context.normalizer_version LIKE '%-weekly-stats-v3'
      OR weekly_evidence ? 'individualSnaps'
      OR COALESCE(weekly_evidence->'rawFlags' ?| ARRAY['off_snp','def_snp','st_snp'],false) THEN
      FOREACH raw_key IN ARRAY ARRAY['off_snp','def_snp','st_snp'] LOOP
        IF weekly_evidence->'rawFlags' ? raw_key THEN
          expected_raw := CASE WHEN jsonb_typeof(weekly_evidence->'rawFlags'->raw_key) = 'number'
            THEN weekly_evidence->'rawFlags'->raw_key ELSE NULL END;
        ELSE expected_raw := weekly_evidence->'individualSnaps'->raw_key;
        END IF;
        IF NEW.stats->raw_key IS DISTINCT FROM expected_raw THEN
          RAISE EXCEPTION 'all-player individual snap evidence disagrees with retained statistics';
        END IF;
      END LOOP;
    END IF;
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
INSERT INTO app_schema_migrations(name,checksum)
  VALUES ('012_all_player_provider_participation.sql','bea4bd568c05eee7da177811b25a1389180d37329b9061b3e79ee60d546aa4ed');
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
  IF (SELECT checksum FROM app_schema_migrations WHERE name = '011_all_player_foundation_guards.sql') IS DISTINCT FROM '0eaa96bcc0b65053ac8dab48657eb7bfe22fadbfd41b4f4c78c3472ca8a512b6'
    THEN RAISE EXCEPTION 'release assertion failed: previous migration 011_all_player_foundation_guards.sql'; END IF;
  
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
  IF actual_count <> 14 OR actual_fingerprint IS DISTINCT FROM 'f254ee1cba5287889c8cf3fcd5b60756' THEN
    RAISE EXCEPTION 'release assertion failed: columns all_player_stat_observations expected count 14 fingerprint f254ee1cba5287889c8cf3fcd5b60756, actual count % fingerprint %', actual_count, actual_fingerprint; END IF;
  SELECT count(*)::integer, count(*) FILTER (WHERE constraint_record.contype = 'n')::integer,
      md5(string_agg(constraint_record.conname || chr(31) || constraint_record.contype::text
        || chr(31) || pg_get_constraintdef(constraint_record.oid, true),
        chr(30) ORDER BY constraint_record.conname))
    INTO actual_count, actual_not_null_count, actual_fingerprint
    FROM pg_constraint constraint_record JOIN pg_class relation ON relation.oid = constraint_record.conrelid
    JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
    WHERE namespace.nspname = 'public' AND relation.relname = 'all_player_stat_observations';
  IF actual_count <> 23 OR actual_not_null_count <> 13
      OR actual_fingerprint IS DISTINCT FROM '57649e4e904467fe6e69575a73195027' THEN
    RAISE EXCEPTION 'release assertion failed: constraints all_player_stat_observations expected count 23 not-null 13 fingerprint 57649e4e904467fe6e69575a73195027, actual count % not-null % fingerprint %', actual_count, actual_not_null_count, actual_fingerprint; END IF;
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
      AND trigger_record.tgname = 'all_player_provider_context_guard' AND relation.relname = 'all_player_stat_observations'
      AND function_record.proname = 'validate_all_player_provider_context';
  IF actual_count <> 1 OR actual_fingerprint IS DISTINCT FROM '0603c80e0fa260588478a7cb321476b5'
      OR actual_table_owner IS DISTINCT FROM 'neondb_owner'
      OR actual_function_owner IS DISTINCT FROM 'neondb_owner' THEN
    RAISE EXCEPTION 'release assertion failed: trigger all_player_provider_context_guard'; END IF;

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
  IF actual_count <> 1 OR actual_fingerprint IS DISTINCT FROM '5fb6f76f2a7a431b6beb0770a987cd74'
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
    WHERE namespace.nspname = 'public' AND function_record.proname = 'validate_all_player_provider_context'
      AND pg_get_function_identity_arguments(function_record.oid) = '';
  IF actual_count <> 1 OR actual_fingerprint IS DISTINCT FROM '62163559fb8c2bbb108369d620261260'
      OR actual_function_owner IS DISTINCT FROM 'neondb_owner' THEN
    RAISE EXCEPTION 'release assertion failed: function validate_all_player_provider_context()'; END IF;
  IF actual_public_execute IS DISTINCT FROM false
      OR actual_runtime_execute IS DISTINCT FROM false
      OR actual_public_grant_execute IS DISTINCT FROM false
      OR actual_runtime_grant_execute IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'release assertion failed: function ACL validate_all_player_provider_context()'; END IF;

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
  IF actual_count <> 1 OR actual_fingerprint IS DISTINCT FROM '4ee13817e6ee45a1bd61afd3d2dca307'
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
    THEN RAISE EXCEPTION 'release assertion failed: exact migration 012 table set'; END IF;
  IF (SELECT count(*) FROM pg_trigger trigger_record
      JOIN pg_class relation ON relation.oid = trigger_record.tgrelid
      JOIN pg_proc function_record ON function_record.oid = trigger_record.tgfoid
      WHERE relation.relnamespace = 'public'::regnamespace AND NOT trigger_record.tgisinternal
        AND (trigger_record.tgname LIKE '%all_player%' OR function_record.proname LIKE '%all_player%'))
      <> 17
    THEN RAISE EXCEPTION 'release assertion failed: exact migration 012 trigger set'; END IF;
  IF (SELECT count(*) FROM pg_proc function_record
      WHERE function_record.pronamespace = 'public'::regnamespace
        AND function_record.proname LIKE '%all_player%') <> 22
    THEN RAISE EXCEPTION 'release assertion failed: exact migration 012 function set'; END IF;
  
  IF (SELECT count(*) FROM pg_constraint c JOIN pg_class t ON t.oid = c.conrelid
    WHERE t.relnamespace = 'public'::regnamespace AND t.relname = ANY(ARRAY['all_player_score_sets', 'all_player_score_verifications', 'all_player_scores', 'all_player_stat_contents', 'all_player_stat_entries', 'all_player_stat_observations', 'current_all_player_score_sets']::text[])
      AND c.contype = 'c') <> 52
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
  IF (SELECT count(*) FROM app_schema_migrations) <> 12
    THEN RAISE EXCEPTION 'release assertion failed: migration ledger count'; END IF;
  IF (SELECT checksum FROM app_schema_migrations WHERE name = '012_all_player_provider_participation.sql')
    IS DISTINCT FROM 'bea4bd568c05eee7da177811b25a1389180d37329b9061b3e79ee60d546aa4ed' THEN RAISE EXCEPTION 'release assertion failed: 012 checksum'; END IF;
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
SELECT 'ALL_PLAYER_PARTICIPATION_APPLIED:012_all_player_provider_participation.sql:bea4bd568c05eee7da177811b25a1389180d37329b9061b3e79ee60d546aa4ed' AS success_sentinel;
