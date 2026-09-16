import { readFile, writeFile } from 'node:fs/promises';
import { Pool } from '@neondatabase/serverless';
import { integrationEnvironment, prepareIntegrationDatabase, cleanIntegrationDatabase,
  ownerQuery } from '../integration/neon-integration-harness';
import { buildAllPlayerDynastyReleaseWrapper, releaseWrapperSha256,
  type AllPlayerRepairManifest, type ReviewedCatalog } from './all-player-migration-release-wrapper.mjs';
import { ALL_PLAYER_REPAIR_CATALOG_SQL } from './all-player-repair-catalog.mjs';

const env = integrationEnvironment();
const migrationName = '015_all_player_dynasty_publication.sql';
const migrationSql = (await readFile(new URL(`../migrations/${migrationName}`, import.meta.url), 'utf8'))
  .replace(/\r\n?/gu, '\n');
const migrationChecksum = releaseWrapperSha256(migrationSql);
const previousManifest = JSON.parse(await readFile(new URL(
  '../release/014-catalog.integration.json', import.meta.url), 'utf8')) as AllPlayerRepairManifest;
const expectedOwner = decodeURIComponent(new URL(env.ownerDatabaseUrl).username);

async function execute(statement: string) {
  const pool = new Pool({ connectionString: env.ownerDatabaseUrl, max: 1 });
  try {
    const result = await pool.query(statement);
    return (Array.isArray(result) ? result : [result]).flatMap((part) => part.rows);
  } finally { await pool.end(); }
}

try {
  await prepareIntegrationDatabase({ throughMigration: migrationName });
  const version = await ownerQuery<{ version: string }>("SELECT current_setting('server_version_num') AS version");
  if (Number(version[0].version) < 180000 || Number(version[0].version) >= 190000) {
    throw new Error('Migration 015 wrapper validation requires PostgreSQL 18.');
  }
  const catalog = (await ownerQuery<{ catalog: ReviewedCatalog }>(ALL_PLAYER_REPAIR_CATALOG_SQL))[0].catalog;
  const unchanged = ['tables', 'triggers', 'constraintTypes'] as const;
  if (unchanged.some((key) => JSON.stringify(catalog[key]) !== JSON.stringify(previousManifest.catalog[key]))
    || catalog.functions.length !== previousManifest.catalog.functions.length) {
    throw new Error('Migration 015 changed physical storage, triggers, constraints or function cardinality.');
  }
  const changedFunctions = catalog.functions.filter((fn) => {
    const previous = previousManifest.catalog.functions.find((entry) => entry[0] === fn[0] && entry[1] === fn[1]);
    return !previous || JSON.stringify(fn) !== JSON.stringify(previous);
  });
  if (changedFunctions.length !== 2
    || !changedFunctions.some(([name, args, , runtime]) => name === 'all_player_score_set_is_publication_ready'
      && args.includes('p_stat_observation_id') && runtime === false)
    || !changedFunctions.some(([name, args, , runtime]) => name === 'advance_current_all_player_score_set'
      && !args.includes('p_fence') && runtime === true)) {
    throw new Error('Migration 015 must change only the readiness and fenced publication function bodies.');
  }
  const manifest = { migrationName, migrationChecksum, postgresMajor: 18,
    observedAt: new Date().toISOString(), reviewed: false, catalog };
  await writeFile(new URL('../release/015-catalog.integration.json', import.meta.url),
    `${JSON.stringify(manifest, null, 2)}\n`);
  const input = { migrationSql, expectedDatabase: env.expectedDatabase, expectedOwner,
    previousManifest, manifest: { ...manifest, reviewed: true } };
  await prepareIntegrationDatabase({ throughMigration: '014_all_player_hourly_collection.sql' });
  const before = (await ownerQuery<{ catalog: ReviewedCatalog }>(ALL_PLAYER_REPAIR_CATALOG_SQL))[0].catalog;
  const corrupt = structuredClone(input);
  corrupt.manifest.catalog.constraintTypes[0][1] += 1;
  let rejected = false;
  try { await execute(buildAllPlayerDynastyReleaseWrapper(corrupt)); } catch { rejected = true; }
  const rolledBack = (await ownerQuery<{ catalog: ReviewedCatalog }>(ALL_PLAYER_REPAIR_CATALOG_SQL))[0].catalog;
  if (!rejected || JSON.stringify(before) !== JSON.stringify(rolledBack)
    || (await ownerQuery<{ count: number }>(
      'SELECT count(*)::integer AS count FROM app_schema_migrations WHERE name=$1', [migrationName]))[0].count !== 0) {
    throw new Error('The corrupted 015 constraint manifest did not fully roll back the release.');
  }
  const result = await execute(buildAllPlayerDynastyReleaseWrapper(input));
  const sentinel = `ALL_PLAYER_DYNASTY_APPLIED:${migrationName}:${migrationChecksum}`;
  if (!result.some((row) => row.success_sentinel === sentinel)) {
    throw new Error('Migration 015 success sentinel is missing; do not retry an ambiguous release.');
  }
  const compatibility = await ownerQuery<{ readiness_private: boolean; core_granted: boolean; wrapper_granted: boolean }>(`SELECT
    NOT has_function_privilege('league_one_runtime',
      'public.all_player_score_set_is_publication_ready(uuid,jsonb,uuid)','EXECUTE') AS readiness_private,
    has_function_privilege('league_one_runtime',
      'public.advance_current_all_player_score_set(text,smallint,text,smallint,uuid,text,uuid,uuid,timestamptz)',
      'EXECUTE') AS core_granted,
    has_function_privilege('league_one_runtime',
      'public.advance_current_all_player_score_set(text,smallint,text,smallint,uuid,text,uuid,uuid,timestamptz,jsonb)',
      'EXECUTE') AS wrapper_granted`);
  if (JSON.stringify(compatibility[0]) !== JSON.stringify({ readiness_private: true, core_granted: true, wrapper_granted: true })) {
    throw new Error('Migration 015 changed the restricted publication entry points.');
  }
  process.stdout.write(`${JSON.stringify({ outcome: 'passed', migrationChecksum, postgresMajor: 18,
    checks: ['only-readiness-and-fenced-publication-function-bodies', 'unchanged-physical-storage-triggers-constraints-and-acls',
      'corrupt-constraint-manifest-full-catalog-and-ledger-rollback', 'actual-wrapper-commit', 'exact-sentinel',
      'unchanged-runtime-fenced-wrapper-signature'], catalogReview: 'pending-independent-review' })}\n`);
} finally { await cleanIntegrationDatabase(); }
