import { createHash } from 'node:crypto';

export const ALL_PLAYER_MIGRATION_NAME = '010_all_player_statistics.sql';
export const ALL_PLAYER_MIGRATION_CHECKSUM =
  'f9f2aa0c4dc7a0a3097bf770a7f08ef0719ed7f019307dcf629fa17058af31b4';
export const ALL_PLAYER_MIGRATION_SENTINEL =
  `ALL_PLAYER_MIGRATION_APPLIED:${ALL_PLAYER_MIGRATION_NAME}:${ALL_PLAYER_MIGRATION_CHECKSUM}`;

export const ACCEPTED_PREVIOUS_MIGRATIONS = Object.freeze([
  ['001_projection_foundation.sql', 'eefa3aa224dbc6f0c6bb3edc9e4690425e2d6af7094938f3528059717d205050'],
  ['002_manager_snapshot_payloads.sql', '74585dec3e2717eede0579f9281a041a4e3cc0b0cd8378383fe2e3d64fd7214d'],
  ['003_league_period_authority.sql', '6f98e09646834cc542a6413e00c0d0c2d84ad4a5ff33905e429aba87c951406e'],
  ['004_durable_projection_slates.sql', '8ad48c22dea0d942a0a14027dcb240cda18f1bd728403e41aafa6b76f42f95b9'],
  ['005_future_projection_refresh.sql', '02bb6a3c6a183e7074fbea156b5f393d5772619098ab7c07be9dcc5528003c75'],
  ['006_flexed_kickoff_candidate_index.sql', 'd2c54c4e17439d3773cfab8db8ed68bf332abd1073fe793f62138efa89e1a3b0'],
  ['007_lineup_freshness.sql', '1a92f9517294fe289bd25d74923dd042d0cb394d143b5c89d33ed017963c3e47'],
  ['008_additive_write_guards.sql', '2447ffac523e1f5536e218887d5c29895c3a095385f89bd6beb55cb7c5e95814'],
  ['009_game_clock_plausibility.sql', '86df8afd868bb4fd589a76bf1e1693cdc546037cfc61b54ae972e660fbda056a'],
]);

export const REVIEWED_ALL_PLAYER_CATALOG = Object.freeze({
  tables: Object.freeze([
    ['all_player_score_sets', 17, 'b37ef90ab355a40ef19257a91b51b50e', 34, 17, 'bc815049013a175e7f635e756a6d58cd', 5, '9353d8cc843cab2ad4405428b2ab081d', true],
    ['all_player_scores', 15, 'da793af1c8eb2dc4d919888adcf5ae56', 29, 12, '60484e2dab05e66dc396c52176521446', 4, 'aa643382ff5f32ec2a0da24e5e0889b9', true],
    ['all_player_stat_contents', 12, 'bae4e3e70ccd8263a2f6fdc8fa4dbaaf', 23, 12, 'c42674c5539abecf2381b9f60fb2df05', 3, '278865b1e926da53f7783cb5525d094f', true],
    ['all_player_stat_entries', 13, '0fe82d3a2278e77e514ea4582fe29892', 23, 9, 'ccea6cee2d37a3b0af620217eaa31410', 3, 'a50142ccf1e6a9ce392d9697d1d91534', true],
    ['all_player_stat_observations', 13, '6c468b76a9004f46979f7ecdc42f5576', 22, 13, 'c6b6f735f4aa8bd29e53a96854432d35', 4, 'f4719cf59e3e87d89e0e248f30b49d8d', true],
    ['current_all_player_score_sets', 11, 'ab985c7f1b316f8ec51052e2d3c37c9b', 20, 11, '42c70d0fd7aa602387283ffa2d948b8e', 1, '5afb7b133b0d448b3ed974426beaac21', false],
  ]),
  constraintTypes: Object.freeze([['c', 50], ['f', 12], ['n', 74], ['p', 6], ['u', 9]]),
  triggers: Object.freeze([
    ['all_player_score_sets_immutable', 'all_player_score_sets', 'prevent_all_player_history_change', 'a04cbd33698748f306a642741e522724'],
    ['all_player_scores_immutable', 'all_player_scores', 'prevent_all_player_history_change', '2190f2dfdd649951146c023a5f34671d'],
    ['all_player_scores_lineage_guard', 'all_player_scores', 'validate_all_player_score_lineage', 'e0d3b99cd73ec95716bb364ca56c483f'],
    ['all_player_stat_contents_immutable', 'all_player_stat_contents', 'prevent_all_player_history_change', '317368db6511931ee9051f122edcb60c'],
    ['all_player_stat_entries_evidence_guard', 'all_player_stat_entries', 'validate_all_player_stat_entry', 'c573f89c7d79fc0343a5f73c6a3827b4'],
    ['all_player_stat_entries_immutable', 'all_player_stat_entries', 'prevent_all_player_history_change', 'daebe37338ccc8ce8644ccb11e3dd6bc'],
    ['all_player_stat_observations_immutable', 'all_player_stat_observations', 'prevent_all_player_history_change', '2698cd497ba819d17bc84364d21927e2'],
    ['league_week_all_player_parity_immutable', 'league_week_observations', 'prevent_all_player_parity_evidence_change', '6a88192e5a0c7d34fb542eb4a0194547'],
    ['official_player_all_player_parity_immutable', 'official_player_point_observations', 'prevent_all_player_parity_evidence_change', '9c32f0e4a4f11773174da2999e7911c7'],
    ['official_roster_all_player_parity_immutable', 'official_roster_point_observations', 'prevent_all_player_parity_evidence_change', '94a8192ee90bad5c5b8e8cc63f98c62d'],
  ]),
  functions: Object.freeze([
    ['advance_current_all_player_score_set', 'p_provider text, p_season smallint, p_season_type text, p_week smallint, p_scoring_profile_id uuid, p_scorer_version text, p_stat_observation_id uuid, p_score_set_id uuid, p_verified_at timestamp with time zone', 'bb15a13f565076eb818d401bec819832', true],
    ['all_player_eligibility_evidence_matches', 'p_evidence jsonb, p_eligible_game_count smallint, p_appearance_game_count smallint', 'dacb070adcd887dfd506ebf2d0b6da61', false],
    ['all_player_score_set_is_publication_ready', 'p_score_set_id uuid, p_expected_profile_ids jsonb', '4216c0e7a85951a78f9b2dfd8d2c1a7d', false],
    ['all_player_scoring_contract_supported', 'p_provider text, p_scorer_version text, p_rules jsonb', 'd9506986a378ca857262374e5396173f', false],
    ['prevent_all_player_history_change', '', '8ad4504ece6aa6bf9bc0f44281b93c73', false],
    ['prevent_all_player_parity_evidence_change', '', '72faead09751eaad9736ea704d104b99', false],
    ['validate_all_player_score_lineage', '', 'f32eb4d3feb633bdbf7eb1c63d644212', false],
    ['validate_all_player_stat_entry', '', '4473e3cb586dedf4ece8be15d53154f2', false],
  ]),
});

function literal(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

function sqlArray(values) {
  return `ARRAY[${values.map(literal).join(', ')}]::text[]`;
}

export function normalizeMigrationText(value) {
  return value.replace(/\r\n?/gu, '\n');
}

export function releaseWrapperSha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

export function cloneReviewedCatalog() {
  return structuredClone(REVIEWED_ALL_PLAYER_CATALOG);
}

function unaffectedCatalogFunction(tableNames, triggerNames, functionNames) {
  const tables = sqlArray(tableNames);
  const triggers = sqlArray(triggerNames);
  const functions = sqlArray(functionNames);
  return `
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
        AND relation.relname <> ALL (${tables})),
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
        AND relation.relname <> ALL (${tables})
        AND attribute.attnum > 0 AND NOT attribute.attisdropped),
    'constraints', (SELECT md5(COALESCE(string_agg(
      relation.relname || chr(31) || constraint_record.conname || chr(31)
        || constraint_record.contype::text || chr(31) || constraint_record.convalidated::text
        || chr(31) || pg_get_constraintdef(constraint_record.oid, true),
      chr(30) ORDER BY relation.relname, constraint_record.conname), ''))
      FROM pg_constraint constraint_record JOIN pg_class relation ON relation.oid = constraint_record.conrelid
      JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
      WHERE namespace.nspname = 'public' AND relation.relname <> ALL (${tables})),
    'indexes', (SELECT md5(COALESCE(string_agg(
      table_record.tablename || chr(31) || table_record.indexname || chr(31) || table_record.indexdef,
      chr(30) ORDER BY table_record.tablename, table_record.indexname), ''))
      FROM pg_indexes table_record WHERE table_record.schemaname = 'public'
        AND table_record.tablename <> ALL (${tables})),
    'triggers', (SELECT md5(COALESCE(string_agg(
      relation.relname || chr(31) || trigger_record.tgname || chr(31)
        || pg_get_triggerdef(trigger_record.oid, true),
      chr(30) ORDER BY relation.relname, trigger_record.tgname), ''))
      FROM pg_trigger trigger_record JOIN pg_class relation ON relation.oid = trigger_record.tgrelid
      JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
      WHERE namespace.nspname = 'public' AND NOT trigger_record.tgisinternal
        AND trigger_record.tgname <> ALL (${triggers})),
    'functions', (SELECT md5(COALESCE(string_agg(
      function_record.proname || chr(31) || pg_get_function_identity_arguments(function_record.oid)
        || chr(31) || owner.rolname || chr(31) || COALESCE(function_record.proacl::text, '')
        || chr(31) || pg_get_functiondef(function_record.oid),
      chr(30) ORDER BY function_record.proname, pg_get_function_identity_arguments(function_record.oid)), ''))
      FROM pg_proc function_record JOIN pg_namespace namespace ON namespace.oid = function_record.pronamespace
      JOIN pg_roles owner ON owner.oid = function_record.proowner
      WHERE namespace.nspname = 'public' AND function_record.proname <> ALL (${functions})),
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
`;
}

function tableAssertions(table, expectedOwner, runtimeRole, requireEmpty = true) {
  const [name, columnCount, columnFingerprint, constraintCount, notNullCount,
    constraintFingerprint, indexCount, indexFingerprint, runtimeInsert, ownerOverride] = table;
  const tableName = literal(name);
  const runtime = literal(runtimeRole);
  const owner = literal(ownerOverride ?? expectedOwner);
  return `
  IF (SELECT count(*) FROM pg_class relation JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
      WHERE namespace.nspname = 'public' AND relation.relkind = 'r' AND relation.relname = ${tableName}) <> 1 THEN
    RAISE EXCEPTION 'release assertion failed: table ${name}'; END IF;
  IF (SELECT role.rolname FROM pg_class relation JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
      JOIN pg_roles role ON role.oid = relation.relowner
      WHERE namespace.nspname = 'public' AND relation.relname = ${tableName}) IS DISTINCT FROM ${owner} THEN
    RAISE EXCEPTION 'release assertion failed: owner ${name}'; END IF;
  SELECT count(*)::integer, md5(string_agg(
      attribute.attname || chr(31) || format_type(attribute.atttypid, attribute.atttypmod)
        || chr(31) || attribute.attnotnull::text || chr(31)
        || COALESCE(pg_get_expr(default_record.adbin, default_record.adrelid), ''),
      chr(30) ORDER BY attribute.attnum)) INTO actual_count, actual_fingerprint
    FROM pg_class relation JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
    JOIN pg_attribute attribute ON attribute.attrelid = relation.oid
    LEFT JOIN pg_attrdef default_record ON default_record.adrelid = relation.oid
      AND default_record.adnum = attribute.attnum
    WHERE namespace.nspname = 'public' AND relation.relname = ${tableName}
      AND attribute.attnum > 0 AND NOT attribute.attisdropped;
  IF actual_count <> ${columnCount} OR actual_fingerprint IS DISTINCT FROM ${literal(columnFingerprint)} THEN
    RAISE EXCEPTION 'release assertion failed: columns ${name} expected count ${columnCount} fingerprint ${columnFingerprint}, actual count % fingerprint %', actual_count, actual_fingerprint; END IF;
  SELECT count(*)::integer, count(*) FILTER (WHERE constraint_record.contype = 'n')::integer,
      md5(string_agg(constraint_record.conname || chr(31) || constraint_record.contype::text
        || chr(31) || pg_get_constraintdef(constraint_record.oid, true),
        chr(30) ORDER BY constraint_record.conname))
    INTO actual_count, actual_not_null_count, actual_fingerprint
    FROM pg_constraint constraint_record JOIN pg_class relation ON relation.oid = constraint_record.conrelid
    JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
    WHERE namespace.nspname = 'public' AND relation.relname = ${tableName};
  IF actual_count <> ${constraintCount} OR actual_not_null_count <> ${notNullCount}
      OR actual_fingerprint IS DISTINCT FROM ${literal(constraintFingerprint)} THEN
    RAISE EXCEPTION 'release assertion failed: constraints ${name} expected count ${constraintCount} not-null ${notNullCount} fingerprint ${constraintFingerprint}, actual count % not-null % fingerprint %', actual_count, actual_not_null_count, actual_fingerprint; END IF;
  SELECT count(*)::integer, md5(string_agg(index_record.indexname || chr(31) || index_record.indexdef,
      chr(30) ORDER BY index_record.indexname)) INTO actual_count, actual_fingerprint
    FROM pg_indexes index_record WHERE index_record.schemaname = 'public'
      AND index_record.tablename = ${tableName};
  IF actual_count <> ${indexCount} OR actual_fingerprint IS DISTINCT FROM ${literal(indexFingerprint)} THEN
    RAISE EXCEPTION 'release assertion failed: indexes ${name} expected count ${indexCount} fingerprint ${indexFingerprint}, actual count % fingerprint %', actual_count, actual_fingerprint; END IF;
  IF has_table_privilege('public', 'public.${name}',
        'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN')
      OR has_table_privilege('public', 'public.${name}',
        'SELECT WITH GRANT OPTION,INSERT WITH GRANT OPTION,UPDATE WITH GRANT OPTION,DELETE WITH GRANT OPTION,TRUNCATE WITH GRANT OPTION,REFERENCES WITH GRANT OPTION,TRIGGER WITH GRANT OPTION,MAINTAIN WITH GRANT OPTION')
      OR has_any_column_privilege('public', 'public.${name}', 'SELECT,INSERT,UPDATE,REFERENCES')
      OR has_any_column_privilege('public', 'public.${name}',
        'SELECT WITH GRANT OPTION,INSERT WITH GRANT OPTION,UPDATE WITH GRANT OPTION,REFERENCES WITH GRANT OPTION')
      OR NOT has_table_privilege(${runtime}, 'public.${name}', 'SELECT')
      OR has_table_privilege(${runtime}, 'public.${name}', 'INSERT') IS DISTINCT FROM ${runtimeInsert}
      OR has_table_privilege(${runtime}, 'public.${name}',
        'UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN')
      OR has_table_privilege(${runtime}, 'public.${name}',
        'SELECT WITH GRANT OPTION,INSERT WITH GRANT OPTION,UPDATE WITH GRANT OPTION,DELETE WITH GRANT OPTION,TRUNCATE WITH GRANT OPTION,REFERENCES WITH GRANT OPTION,TRIGGER WITH GRANT OPTION,MAINTAIN WITH GRANT OPTION')
      OR has_any_column_privilege(${runtime}, 'public.${name}', 'INSERT')
          IS DISTINCT FROM ${runtimeInsert}
      OR has_any_column_privilege(${runtime}, 'public.${name}', 'UPDATE,REFERENCES')
      OR has_any_column_privilege(${runtime}, 'public.${name}',
        'SELECT WITH GRANT OPTION,INSERT WITH GRANT OPTION,UPDATE WITH GRANT OPTION,REFERENCES WITH GRANT OPTION') THEN
    RAISE EXCEPTION 'release assertion failed: ACL ${name}'; END IF;
  EXECUTE 'SELECT count(*) FROM public.' || quote_ident(${tableName}) INTO actual_rows;
  ${requireEmpty ? `IF actual_rows <> 0 THEN RAISE EXCEPTION 'release assertion failed: empty table ${name}'; END IF;` : ''}
`;
}

function triggerAssertions(trigger, expectedOwner) {
  const [name, table, functionName, fingerprint] = trigger;
  return `
  SELECT count(*)::integer, min(md5(pg_get_triggerdef(trigger_record.oid, true))),
      min(table_owner.rolname), min(function_owner.rolname)
    INTO actual_count, actual_fingerprint, actual_table_owner, actual_function_owner
    FROM pg_trigger trigger_record JOIN pg_class relation ON relation.oid = trigger_record.tgrelid
    JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
    JOIN pg_roles table_owner ON table_owner.oid = relation.relowner
    JOIN pg_proc function_record ON function_record.oid = trigger_record.tgfoid
    JOIN pg_roles function_owner ON function_owner.oid = function_record.proowner
    WHERE namespace.nspname = 'public' AND NOT trigger_record.tgisinternal
      AND trigger_record.tgname = ${literal(name)} AND relation.relname = ${literal(table)}
      AND function_record.proname = ${literal(functionName)};
  IF actual_count <> 1 OR actual_fingerprint IS DISTINCT FROM ${literal(fingerprint)}
      OR actual_table_owner IS DISTINCT FROM ${literal(expectedOwner)}
      OR actual_function_owner IS DISTINCT FROM ${literal(expectedOwner)} THEN
    RAISE EXCEPTION 'release assertion failed: trigger ${name}'; END IF;
`;
}

function functionAssertions(functionRecord, expectedOwner, runtimeRole) {
  const [name, argumentsText, fingerprint, runtimeExecute] = functionRecord;
  return `
  SELECT count(*)::integer, min(md5(pg_get_functiondef(function_record.oid))), min(owner.rolname),
      bool_or(has_function_privilege('public', function_record.oid, 'EXECUTE')),
      bool_or(has_function_privilege(${literal(runtimeRole)}, function_record.oid, 'EXECUTE')),
      bool_or(has_function_privilege('public', function_record.oid, 'EXECUTE WITH GRANT OPTION')),
      bool_or(has_function_privilege(${literal(runtimeRole)}, function_record.oid, 'EXECUTE WITH GRANT OPTION'))
    INTO actual_count, actual_fingerprint, actual_function_owner, actual_public_execute, actual_runtime_execute,
      actual_public_grant_execute, actual_runtime_grant_execute
    FROM pg_proc function_record JOIN pg_namespace namespace ON namespace.oid = function_record.pronamespace
    JOIN pg_roles owner ON owner.oid = function_record.proowner
    WHERE namespace.nspname = 'public' AND function_record.proname = ${literal(name)}
      AND pg_get_function_identity_arguments(function_record.oid) = ${literal(argumentsText)};
  IF actual_count <> 1 OR actual_fingerprint IS DISTINCT FROM ${literal(fingerprint)}
      OR actual_function_owner IS DISTINCT FROM ${literal(expectedOwner)} THEN
    RAISE EXCEPTION 'release assertion failed: function ${name}(${argumentsText})'; END IF;
  IF actual_public_execute IS DISTINCT FROM false
      OR actual_runtime_execute IS DISTINCT FROM ${runtimeExecute}
      OR actual_public_grant_execute IS DISTINCT FROM false
      OR actual_runtime_grant_execute IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'release assertion failed: function ACL ${name}(${argumentsText})'; END IF;
`;
}

export function buildAllPlayerMigrationReleaseWrapper({
  migrationSql,
  expectedDatabase,
  expectedOwner,
  runtimeRole = 'league_one_runtime',
  catalog = cloneReviewedCatalog(),
}) {
  const normalizedMigration = normalizeMigrationText(migrationSql);
  const checksum = releaseWrapperSha256(normalizedMigration);
  if (checksum !== ALL_PLAYER_MIGRATION_CHECKSUM) {
    throw new Error(`Migration 010 checksum mismatch: expected ${ALL_PLAYER_MIGRATION_CHECKSUM}, actual ${checksum}.`);
  }
  for (const [label, value] of Object.entries({ expectedDatabase, expectedOwner, runtimeRole })) {
    if (typeof value !== 'string' || !/^[a-z_][a-z0-9_]*$/u.test(value)) {
      throw new Error(`${label} is not a safe PostgreSQL identifier.`);
    }
  }
  const tableNames = catalog.tables.map(([name]) => name);
  const triggerNames = catalog.triggers.map(([name]) => name);
  const functionNames = catalog.functions.map(([name]) => name);
  const preflightMigrations = ACCEPTED_PREVIOUS_MIGRATIONS.map(([name, expectedChecksum]) => `
  IF (SELECT count(*) FROM public.app_schema_migrations WHERE name = ${literal(name)}) <> 1 THEN
    RAISE EXCEPTION 'release assertion failed: migration ledger row ${name}'; END IF;
  IF (SELECT checksum FROM public.app_schema_migrations WHERE name = ${literal(name)})
      IS DISTINCT FROM ${literal(expectedChecksum)} THEN
    RAISE EXCEPTION 'release assertion failed: migration checksum ${name}'; END IF;`).join('');
  const postflightTables = catalog.tables
    .map((table) => tableAssertions(table, expectedOwner, runtimeRole)).join('');
  const postflightTriggers = catalog.triggers
    .map((trigger) => triggerAssertions(trigger, expectedOwner)).join('');
  const postflightFunctions = catalog.functions
    .map((functionRecord) => functionAssertions(functionRecord, expectedOwner, runtimeRole)).join('');
  const constraintTypeChecks = catalog.constraintTypes.map(([type, count]) => `
  IF (SELECT count(*) FROM pg_constraint constraint_record JOIN pg_class relation
      ON relation.oid = constraint_record.conrelid JOIN pg_namespace namespace
      ON namespace.oid = relation.relnamespace WHERE namespace.nspname = 'public'
      AND relation.relname = ANY(${sqlArray(tableNames)}) AND constraint_record.contype = ${literal(type)}) <> ${count} THEN
    RAISE EXCEPTION 'release assertion failed: constraint type ${type} expected ${count}'; END IF;`).join('');
  const unaffectedChecks = [
    ['schemas', 'preexisting schemas'], ['tables', 'preexisting tables, sequences, owners, or ACLs'],
    ['columns', 'preexisting columns or column ACLs'], ['constraints', 'preexisting constraints'],
    ['indexes', 'preexisting indexes'], ['triggers', 'preexisting triggers'],
    ['functions', 'preexisting functions, owners, or ACLs'], ['roles', 'roles'],
    ['memberships', 'role memberships'], ['default_privileges', 'default privileges'],
  ].map(([key, label]) => `
  IF before_catalog->>${literal(key)} IS DISTINCT FROM after_catalog->>${literal(key)} THEN
    RAISE EXCEPTION 'release assertion failed: unchanged ${label}'; END IF;`).join('');
  const runtimeSetRoleAssertion = `
  SELECT min(role.rolname) INTO actual_reachable_role FROM pg_roles role
  WHERE role.rolname <> ${literal(runtimeRole)}
    AND pg_has_role(${literal(runtimeRole)}, role.oid, 'SET');
  IF actual_reachable_role IS NOT NULL THEN
    RAISE EXCEPTION 'release assertion failed: runtime SET ROLE reachability to %', actual_reachable_role; END IF;`;

  return normalizeMigrationText(`-- Deterministic, secret-free release wrapper for migration 010.
-- Generated by apps/site/scripts/all-player-migration-release-wrapper.mjs.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '120s';
SELECT pg_advisory_xact_lock(hashtext('league-one-schema-migrations'));

DO $all_player_preflight$
DECLARE
  actual_reachable_role text;
BEGIN
  IF current_database() IS DISTINCT FROM ${literal(expectedDatabase)} THEN
    RAISE EXCEPTION 'release assertion failed: database identity expected ${expectedDatabase}, actual %', current_database(); END IF;
  IF current_user IS DISTINCT FROM ${literal(expectedOwner)} THEN
    RAISE EXCEPTION 'release assertion failed: migration owner expected ${expectedOwner}, actual %', current_user; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = ${literal(runtimeRole)}) THEN
    RAISE EXCEPTION 'release assertion failed: runtime role ${runtimeRole}'; END IF;
${runtimeSetRoleAssertion}
  IF to_regclass('public.app_schema_migrations') IS NULL THEN
    RAISE EXCEPTION 'release assertion failed: migration ledger missing'; END IF;
  IF (SELECT count(*) FROM public.app_schema_migrations) <> 9 THEN
    RAISE EXCEPTION 'release assertion failed: migration ledger expected 9 rows before 010'; END IF;
  ${preflightMigrations}
  IF EXISTS (SELECT 1 FROM public.app_schema_migrations WHERE name = ${literal(ALL_PLAYER_MIGRATION_NAME)}) THEN
    RAISE EXCEPTION 'release assertion failed: migration 010 must be absent'; END IF;
  IF EXISTS (SELECT 1 FROM pg_class relation JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
      WHERE namespace.nspname = 'public' AND relation.relname = ANY(${sqlArray(tableNames)})) THEN
    RAISE EXCEPTION 'release assertion failed: migration 010 table must be absent'; END IF;
  IF EXISTS (SELECT 1 FROM pg_trigger WHERE NOT tgisinternal AND tgname = ANY(${sqlArray(triggerNames)})) THEN
    RAISE EXCEPTION 'release assertion failed: migration 010 trigger must be absent'; END IF;
  IF EXISTS (SELECT 1 FROM pg_proc function_record JOIN pg_namespace namespace
      ON namespace.oid = function_record.pronamespace WHERE namespace.nspname = 'public'
      AND function_record.proname = ANY(${sqlArray(functionNames)})) THEN
    RAISE EXCEPTION 'release assertion failed: migration 010 function must be absent'; END IF;
END
$all_player_preflight$;
${unaffectedCatalogFunction(tableNames, triggerNames, functionNames)}
-- Exact reviewed migration; checksum is asserted by the generator before execution.
${normalizedMigration.trimEnd()}

INSERT INTO public.app_schema_migrations(name, checksum)
VALUES (${literal(ALL_PLAYER_MIGRATION_NAME)}, ${literal(ALL_PLAYER_MIGRATION_CHECKSUM)});

DO $all_player_postflight$
DECLARE
  actual_count integer;
  actual_not_null_count integer;
  actual_rows bigint;
  actual_fingerprint text;
  actual_table_owner text;
  actual_function_owner text;
  actual_public_execute boolean;
  actual_runtime_execute boolean;
  actual_public_grant_execute boolean;
  actual_runtime_grant_execute boolean;
  actual_reachable_role text;
  before_catalog jsonb;
  after_catalog jsonb;
BEGIN
  SELECT fingerprint INTO STRICT before_catalog FROM all_player_release_before;
  after_catalog := pg_temp.all_player_release_unaffected_catalog();
  IF (SELECT count(*) FROM public.app_schema_migrations WHERE name = ${literal(ALL_PLAYER_MIGRATION_NAME)}
      AND checksum = ${literal(ALL_PLAYER_MIGRATION_CHECKSUM)}) <> 1 THEN
    RAISE EXCEPTION 'release assertion failed: migration 010 ledger checksum'; END IF;
  IF (SELECT count(*) FROM public.app_schema_migrations) <> 10 THEN
    RAISE EXCEPTION 'release assertion failed: migration ledger expected 10 rows after 010'; END IF;
  ${preflightMigrations}
  ${postflightTables}
  ${constraintTypeChecks}
  ${postflightTriggers}
  ${postflightFunctions}
${runtimeSetRoleAssertion}
  IF (SELECT count(*) FROM pg_trigger WHERE NOT tgisinternal AND tgname = ANY(${sqlArray(triggerNames)})) <> ${triggerNames.length} THEN
    RAISE EXCEPTION 'release assertion failed: exact migration 010 trigger set'; END IF;
  IF (SELECT count(*) FROM pg_proc function_record JOIN pg_namespace namespace ON namespace.oid = function_record.pronamespace
      WHERE namespace.nspname = 'public' AND function_record.proname = ANY(${sqlArray(functionNames)})) <> ${functionNames.length} THEN
    RAISE EXCEPTION 'release assertion failed: exact migration 010 function set'; END IF;
  ${unaffectedChecks}
END
$all_player_postflight$;

COMMIT;
SELECT ${literal(ALL_PLAYER_MIGRATION_SENTINEL)} AS success_sentinel;
`);
}

export function requireAllPlayerMigrationSentinel(rows) {
  const sentinel = rows?.find?.((row) => row?.success_sentinel)?.success_sentinel;
  if (sentinel !== ALL_PLAYER_MIGRATION_SENTINEL) {
    throw new Error(`Migration 010 success sentinel is absent or incorrect; expected ${ALL_PLAYER_MIGRATION_SENTINEL}.`);
  }
  return sentinel;
}


/** The 011 catalog must be captured from guarded PostgreSQL 18 integration,
 * independently reviewed, and bound to the exact migration checksum. Missing
 * catalog evidence deliberately prevents producing an executable release. */
export function buildAllPlayerRepairReleaseWrapper({
  migrationSql, expectedDatabase, expectedOwner, runtimeRole = 'league_one_runtime', manifest,
}) {
  const normalizedMigration = normalizeMigrationText(migrationSql);
  const checksum = releaseWrapperSha256(normalizedMigration);
  if (!manifest || manifest.migrationName !== '011_all_player_foundation_guards.sql'
    || manifest.migrationChecksum !== checksum || manifest.postgresMajor !== 18
    || manifest.reviewed !== true || !manifest.catalog?.tables?.length
    || !manifest.catalog?.functions?.length || !manifest.catalog?.triggers?.length) {
    throw new Error('Migration 011 requires its exact independently reviewed PostgreSQL 18 catalog manifest.');
  }
  for (const [label, value] of Object.entries({ expectedDatabase, expectedOwner, runtimeRole })) {
    if (typeof value !== 'string' || !/^[a-z_][a-z0-9_]*$/u.test(value)) {
      throw new Error(`${label} is not a safe PostgreSQL identifier.`);
    }
  }
  const catalog = manifest.catalog;
  const tableNames = catalog.tables.map(([name]) => name);
  const triggerNames = catalog.triggers.map(([name]) => name);
  const functionNames = [...new Set(catalog.functions.map(([name]) => name))];
  const expectedMigrations = [...ACCEPTED_PREVIOUS_MIGRATIONS,
    [ALL_PLAYER_MIGRATION_NAME, ALL_PLAYER_MIGRATION_CHECKSUM]];
  const ledgerChecks = expectedMigrations.map(([name, hash]) => `
  IF (SELECT checksum FROM app_schema_migrations WHERE name = ${literal(name)}) IS DISTINCT FROM ${literal(hash)}
    THEN RAISE EXCEPTION 'release assertion failed: previous migration ${name}'; END IF;`).join('');
  const declared = `actual_count integer; actual_not_null_count integer; actual_rows bigint;
  actual_fingerprint text; actual_table_owner text; actual_function_owner text;
  actual_public_execute boolean; actual_runtime_execute boolean; actual_public_grant_execute boolean;
  actual_runtime_grant_execute boolean; before_catalog jsonb; after_catalog jsonb;`;
  const beforeChecks = REVIEWED_ALL_PLAYER_CATALOG.tables.map((table) =>
    tableAssertions(table, expectedOwner, runtimeRole, false)).join('')
    + REVIEWED_ALL_PLAYER_CATALOG.triggers.map((trigger) => triggerAssertions(trigger, expectedOwner)).join('')
    + REVIEWED_ALL_PLAYER_CATALOG.functions.map((fn) => functionAssertions(fn, expectedOwner, runtimeRole)).join('');
  const exactObjectChecks = (expected, label) => `
  IF (SELECT count(*) FROM pg_class relation WHERE relation.relnamespace = 'public'::regnamespace
      AND relation.relkind = 'r'
      AND (relation.relname LIKE 'all_player_%' OR relation.relname = 'current_all_player_score_sets'))
      <> ${expected.tables.length}
    THEN RAISE EXCEPTION 'release assertion failed: exact ${label} table set'; END IF;
  IF (SELECT count(*) FROM pg_trigger trigger_record
      JOIN pg_class relation ON relation.oid = trigger_record.tgrelid
      JOIN pg_proc function_record ON function_record.oid = trigger_record.tgfoid
      WHERE relation.relnamespace = 'public'::regnamespace AND NOT trigger_record.tgisinternal
        AND (trigger_record.tgname LIKE '%all_player%' OR function_record.proname LIKE '%all_player%'))
      <> ${expected.triggers.length}
    THEN RAISE EXCEPTION 'release assertion failed: exact ${label} trigger set'; END IF;
  IF (SELECT count(*) FROM pg_proc function_record
      WHERE function_record.pronamespace = 'public'::regnamespace
        AND function_record.proname LIKE '%all_player%') <> ${expected.functions.length}
    THEN RAISE EXCEPTION 'release assertion failed: exact ${label} function set'; END IF;`;
  const afterChecks = catalog.tables.map((table) => tableAssertions(table, expectedOwner, runtimeRole,
    table[0] === 'all_player_score_verifications')).join('')
    + catalog.triggers.map((trigger) => triggerAssertions(trigger, expectedOwner)).join('')
    + catalog.functions.map((fn) => functionAssertions(fn, expectedOwner, runtimeRole)).join('');
  const constraintChecks = catalog.constraintTypes.map(([type, count]) => `
  IF (SELECT count(*) FROM pg_constraint c JOIN pg_class t ON t.oid = c.conrelid
    WHERE t.relnamespace = 'public'::regnamespace AND t.relname = ANY(${sqlArray(tableNames)})
      AND c.contype = ${literal(type)}) <> ${count}
    THEN RAISE EXCEPTION 'release assertion failed: PostgreSQL 18 constraint type ${type}'; END IF;`).join('');
  const unaffectedChecks = ['schemas','tables','columns','constraints','indexes','triggers','functions',
    'roles','memberships','default_privileges'].map((key) => `
  IF before_catalog->>${literal(key)} IS DISTINCT FROM after_catalog->>${literal(key)}
    THEN RAISE EXCEPTION 'release assertion failed: unrelated ${key} changed'; END IF;`).join('');
  const sentinel = `ALL_PLAYER_REPAIR_APPLIED:011_all_player_foundation_guards.sql:${checksum}`;
  return normalizeMigrationText(`-- Reviewed additive all-player repair; never apply migration 010 again.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '120s';
SELECT pg_advisory_xact_lock(hashtext('league-one-schema-migrations'));
-- Old period-scoped job claims do not use the migration advisory lock. Hold
-- their ordinary row mutations until the ownership check and install commit.
LOCK TABLE public.projection_jobs IN SHARE ROW EXCLUSIVE MODE;
DO $repair_before$
DECLARE ${declared}
BEGIN
  IF current_database() <> ${literal(expectedDatabase)} OR current_user <> ${literal(expectedOwner)}
    THEN RAISE EXCEPTION 'release assertion failed: database or owner identity'; END IF;
  IF current_setting('server_version_num')::integer NOT BETWEEN 180000 AND 189999
    THEN RAISE EXCEPTION 'release assertion failed: reviewed PostgreSQL 18 required'; END IF;
  IF (SELECT count(*) FROM app_schema_migrations) <> 10
    THEN RAISE EXCEPTION 'release assertion failed: expected exactly migrations 001-010'; END IF;
  ${ledgerChecks}
  IF EXISTS (SELECT 1 FROM pg_roles role WHERE role.rolname <> ${literal(runtimeRole)}
      AND pg_has_role(${literal(runtimeRole)},role.oid,'SET'))
    THEN RAISE EXCEPTION 'release assertion failed: runtime role can assume another role'; END IF;
  IF EXISTS (SELECT 1 FROM projection_jobs WHERE job_type = 'all-player-ingestion'
      AND state = 'running' AND lease_until > clock_timestamp())
    THEN RAISE EXCEPTION 'release assertion failed: all-player owner is active'; END IF;
  ${beforeChecks}
  ${exactObjectChecks(REVIEWED_ALL_PLAYER_CATALOG, 'migration 010')}
END; $repair_before$;
${unaffectedCatalogFunction(tableNames, triggerNames, functionNames)}
CREATE TEMP TABLE all_player_repair_before_counts ON COMMIT DROP AS
  SELECT 'all_player_stat_contents' AS name,count(*) AS rows FROM all_player_stat_contents UNION ALL
  SELECT 'all_player_stat_entries',count(*) FROM all_player_stat_entries UNION ALL
  SELECT 'all_player_stat_observations',count(*) FROM all_player_stat_observations UNION ALL
  SELECT 'all_player_score_sets',count(*) FROM all_player_score_sets UNION ALL
  SELECT 'all_player_scores',count(*) FROM all_player_scores UNION ALL
  SELECT 'current_all_player_score_sets',count(*) FROM current_all_player_score_sets;
${normalizedMigration.trimEnd()}
INSERT INTO app_schema_migrations(name,checksum)
  VALUES ('011_all_player_foundation_guards.sql',${literal(checksum)});
DO $repair_after$
DECLARE ${declared} old_count record;
BEGIN
  ${ledgerChecks}
  ${afterChecks}
  ${exactObjectChecks(catalog, 'migration 011')}
  ${constraintChecks}
  IF (SELECT count(*) FROM app_schema_migrations) <> 11
    THEN RAISE EXCEPTION 'release assertion failed: migration ledger count'; END IF;
  IF (SELECT checksum FROM app_schema_migrations WHERE name = '011_all_player_foundation_guards.sql')
    IS DISTINCT FROM ${literal(checksum)} THEN RAISE EXCEPTION 'release assertion failed: 011 checksum'; END IF;
  FOR old_count IN SELECT * FROM all_player_repair_before_counts LOOP
    EXECUTE format('SELECT count(*) FROM public.%I',old_count.name) INTO actual_rows;
    IF actual_rows <> old_count.rows THEN RAISE EXCEPTION 'release assertion failed: history count changed'; END IF;
  END LOOP;
  SELECT fingerprint INTO STRICT before_catalog FROM all_player_release_before;
  after_catalog := pg_temp.all_player_release_unaffected_catalog();
  ${unaffectedChecks}
END; $repair_after$;
COMMIT;
SELECT ${literal(sentinel)} AS success_sentinel;
`);
}
