import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { Pool } from '@neondatabase/serverless';
import {
  cleanIntegrationDatabase,
  integrationEnvironment,
  ownerQuery,
  prepareIntegrationDatabase,
} from '../integration/neon-integration-harness';
import {
  ALL_PLAYER_MIGRATION_CHECKSUM,
  buildAllPlayerMigrationReleaseWrapper,
  cloneReviewedCatalog,
  releaseWrapperSha256,
  requireAllPlayerMigrationSentinel,
} from './all-player-migration-release-wrapper.mjs';

type Catalog = ReturnType<typeof cloneReviewedCatalog>;

const migrationSql = await readFile(
  fileURLToPath(new URL('../migrations/010_all_player_statistics.sql', import.meta.url)),
  'utf8',
);
const environment = integrationEnvironment();

function build(catalog: Catalog = cloneReviewedCatalog()) {
  return buildAllPlayerMigrationReleaseWrapper({
    migrationSql,
    expectedDatabase: environment.expectedDatabase,
    expectedOwner: 'neondb_owner',
    catalog,
  });
}

async function executeWrapper(statement: string): Promise<readonly Record<string, unknown>[]> {
  const pool = new Pool({ connectionString: environment.ownerDatabaseUrl, max: 1 });
  try {
    const result = await pool.query(statement);
    const results = Array.isArray(result) ? result : [result];
    return results.flatMap((entry) => entry.rows as Record<string, unknown>[]);
  } finally {
    await pool.end();
  }
}

async function assertRolledBack(label: string) {
  const rows = await ownerQuery<{
    migration_count: number;
    table_count: number;
    function_count: number;
    trigger_count: number;
  }>(`
    SELECT
      (SELECT count(*)::integer FROM app_schema_migrations
        WHERE name = '010_all_player_statistics.sql') AS migration_count,
      (SELECT count(*)::integer FROM pg_class relation
        JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
        WHERE namespace.nspname = 'public' AND relation.relkind = 'r'
          AND relation.relname IN (
            'all_player_stat_contents', 'all_player_stat_entries',
            'all_player_stat_observations', 'all_player_score_sets',
            'all_player_scores', 'current_all_player_score_sets'
          )) AS table_count,
      (SELECT count(*)::integer FROM pg_proc function_record
        JOIN pg_namespace namespace ON namespace.oid = function_record.pronamespace
        WHERE namespace.nspname = 'public' AND function_record.proname LIKE '%all_player%') AS function_count,
      (SELECT count(*)::integer FROM pg_trigger
        WHERE NOT tgisinternal AND tgname LIKE '%all_player%') AS trigger_count
  `);
  const row = rows[0];
  if (!row || Number(row.migration_count) !== 0 || Number(row.table_count) !== 0
    || Number(row.function_count) !== 0 || Number(row.trigger_count) !== 0) {
    throw new Error(`${label} did not roll back migration 010 completely.`);
  }
}

async function expectFailure(
  label: string,
  expectedMessage: string,
  mutate: (catalog: Catalog) => void,
  transformWrapper: (wrapper: string) => string = (wrapper) => wrapper,
) {
  const catalog = cloneReviewedCatalog();
  mutate(catalog);
  let message = '';
  try {
    await executeWrapper(transformWrapper(build(catalog)));
  } catch (error) {
    message = error instanceof Error ? error.message : String(error);
  }
  if (!message.includes(expectedMessage)) {
    throw new Error(`${label} expected "${expectedMessage}" but received "${message}".`);
  }
  await assertRolledBack(label);
  process.stdout.write(`negative:${label}:rolled-back:${expectedMessage}\n`);
}

try {
  await prepareIntegrationDatabase({
    throughMigration: '009_game_clock_plausibility.sql',
    provisionRuntimeRole: false,
  });

  await expectFailure('table', 'release assertion failed: table missing_reviewed_table', (catalog) => {
    catalog.tables[0][0] = 'missing_reviewed_table';
  });
  await expectFailure('owner', 'release assertion failed: owner all_player_score_sets', (catalog) => {
    catalog.tables[0][9] = 'wrong_owner';
  });
  await expectFailure('column', 'release assertion failed: columns all_player_score_sets', (catalog) => {
    catalog.tables[0][2] = '00000000000000000000000000000000';
  });
  await expectFailure('constraint', 'release assertion failed: constraints all_player_score_sets', (catalog) => {
    catalog.tables[0][5] = '00000000000000000000000000000000';
  });
  await expectFailure('index', 'release assertion failed: indexes all_player_score_sets', (catalog) => {
    catalog.tables[0][7] = '00000000000000000000000000000000';
  });
  await expectFailure('trigger', 'release assertion failed: trigger all_player_score_sets_immutable', (catalog) => {
    catalog.triggers[0][3] = '00000000000000000000000000000000';
  });
  await expectFailure('function', 'release assertion failed: function advance_current_all_player_score_set', (catalog) => {
    catalog.functions[0][2] = '00000000000000000000000000000000';
  });
  await expectFailure(
    'inherited table ACL',
    'release assertion failed: ACL all_player_score_sets',
    () => undefined,
    (wrapper) => wrapper.replace(
      'DO $all_player_postflight$',
      `CREATE ROLE all_player_release_acl_fixture NOLOGIN;
GRANT all_player_release_acl_fixture TO league_one_runtime;
GRANT TRUNCATE ON public.all_player_score_sets TO all_player_release_acl_fixture;
DO $all_player_postflight$`,
    ),
  );
  await expectFailure(
    'function grant option ACL',
    'release assertion failed: function ACL advance_current_all_player_score_set',
    () => undefined,
    (wrapper) => wrapper.replace(
      'DO $all_player_postflight$',
      `GRANT EXECUTE ON FUNCTION public.advance_current_all_player_score_set(
  text, smallint, text, smallint, uuid, text, uuid, uuid, timestamptz
) TO league_one_runtime WITH GRANT OPTION;
DO $all_player_postflight$`,
    ),
  );

  const wrapper = build();
  const result = await executeWrapper(wrapper);
  const sentinel = requireAllPlayerMigrationSentinel(result);
  const postflight = await ownerQuery<{
    migration_count: number;
    table_count: number;
    history_rows: number;
  }>(`
    SELECT
      (SELECT count(*)::integer FROM app_schema_migrations
        WHERE name = '010_all_player_statistics.sql'
          AND checksum = '${ALL_PLAYER_MIGRATION_CHECKSUM}') AS migration_count,
      (SELECT count(*)::integer FROM pg_class relation
        JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
        WHERE namespace.nspname = 'public' AND relation.relkind = 'r'
          AND relation.relname IN (
            'all_player_stat_contents', 'all_player_stat_entries',
            'all_player_stat_observations', 'all_player_score_sets',
            'all_player_scores', 'current_all_player_score_sets'
          )) AS table_count,
      (SELECT count(*) FROM all_player_stat_contents)
        + (SELECT count(*) FROM all_player_stat_entries)
        + (SELECT count(*) FROM all_player_stat_observations)
        + (SELECT count(*) FROM all_player_score_sets)
        + (SELECT count(*) FROM all_player_scores)
        + (SELECT count(*) FROM current_all_player_score_sets) AS history_rows
  `);
  const verified = postflight[0];
  if (!verified || Number(verified.migration_count) !== 1
    || Number(verified.table_count) !== 6 || Number(verified.history_rows) !== 0) {
    throw new Error('The positive release-wrapper installation did not match its postflight proof.');
  }
  process.stdout.write(`${JSON.stringify({
    result: 'all-player-release-wrapper-verified',
    wrapperSha256: releaseWrapperSha256(wrapper),
    migrationChecksum: ALL_PLAYER_MIGRATION_CHECKSUM,
    successSentinel: sentinel,
    negativeFixtures: 9,
    negativeRollbacks: 9,
    positiveTables: 6,
    positiveRows: 0,
  })}\n`);
} finally {
  await cleanIntegrationDatabase();
}
