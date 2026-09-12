import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { Pool } from '@neondatabase/serverless';
import { integrationEnvironment, prepareIntegrationDatabase, cleanIntegrationDatabase,
  ownerQuery } from '../integration/neon-integration-harness';
import { buildAllPlayerRepairReleaseWrapper, releaseWrapperSha256, type ReviewedCatalog }
  from './all-player-migration-release-wrapper.mjs';
import { ALL_PLAYER_REPAIR_CATALOG_SQL } from './all-player-repair-catalog.mjs';

const env = integrationEnvironment();
const migrationSql = (await readFile(fileURLToPath(new URL(
  '../migrations/011_all_player_foundation_guards.sql', import.meta.url)), 'utf8')).replace(/\r\n?/gu, '\n');
const migrationChecksum = releaseWrapperSha256(migrationSql);
const expectedOwner = decodeURIComponent(new URL(env.ownerDatabaseUrl).username);
async function execute(statement: string) {
  const pool = new Pool({ connectionString: env.ownerDatabaseUrl, max: 1 });
  try {
    const result = await pool.query(statement);
    return (Array.isArray(result) ? result : [result]).flatMap((part) => part.rows);
  } finally { await pool.end(); }
}

try {
  await prepareIntegrationDatabase();
  const version = await ownerQuery<{ version: string }>("SELECT current_setting('server_version_num') AS version");
  if (Number(version[0].version) < 180000 || Number(version[0].version) >= 190000) {
    throw new Error('Migration 011 wrapper validation requires PostgreSQL 18.');
  }
  const rows = await ownerQuery<{ catalog: ReviewedCatalog }>(ALL_PLAYER_REPAIR_CATALOG_SQL);
  const manifest = { migrationName: '011_all_player_foundation_guards.sql', migrationChecksum,
    postgresMajor: 18, observedAt: new Date().toISOString(), reviewed: false, catalog: rows[0].catalog };
  await writeFile(fileURLToPath(new URL('../release/011-catalog.integration.json', import.meta.url)),
    `${JSON.stringify(manifest, null, 2)}\n`);
  // Only this isolated test uses the measured catalog as expected assertions.
  // The saved manifest deliberately stays unreviewed, blocking production rendering.
  const input = { migrationSql, expectedDatabase: env.expectedDatabase, expectedOwner,
    manifest: { ...manifest, reviewed: true } };
  await prepareIntegrationDatabase({ throughMigration: '010_all_player_statistics.sql' });
  const corrupt = structuredClone(input);
  const constraints = corrupt.manifest.catalog.constraintTypes as Array<[string, number]>;
  constraints[0][1] += 1;
  let rejected = false;
  try { await execute(buildAllPlayerRepairReleaseWrapper(corrupt)); } catch { rejected = true; }
  if (!rejected || (await ownerQuery<{ found: string | null }>(
    "SELECT to_regclass('public.all_player_score_verifications')::text AS found"))[0].found !== null) {
    throw new Error('The corrupted 011 constraint manifest did not roll back the release.');
  }
  const result = await execute(buildAllPlayerRepairReleaseWrapper(input));
  const sentinel = `ALL_PLAYER_REPAIR_APPLIED:011_all_player_foundation_guards.sql:${migrationChecksum}`;
  if (!result.some((row) => row.success_sentinel === sentinel)) {
    throw new Error('Migration 011 success sentinel is missing; do not retry an ambiguous release.');
  }
  process.stdout.write(`${JSON.stringify({ outcome: 'passed', migrationChecksum, postgresMajor: 18,
    checks: ['corrupt-constraint-manifest-rollback', 'actual-wrapper-commit', 'exact-sentinel'],
    catalogReview: 'pending-independent-review' })}\n`);
} finally { await cleanIntegrationDatabase(); }
