import { readFile, writeFile } from 'node:fs/promises';
import { Pool } from '@neondatabase/serverless';
import { integrationEnvironment, prepareIntegrationDatabase, cleanIntegrationDatabase,
  ownerQuery } from '../integration/neon-integration-harness';
import { buildAllPlayerParticipationAssumptionReleaseWrapper, releaseWrapperSha256,
  type AllPlayerRepairManifest, type ReviewedCatalog } from './all-player-migration-release-wrapper.mjs';
import { ALL_PLAYER_REPAIR_CATALOG_SQL } from './all-player-repair-catalog.mjs';

const env = integrationEnvironment();
const migrationName = '013_all_player_participation_assumption.sql';
const migrationSql = (await readFile(new URL(`../migrations/${migrationName}`, import.meta.url), 'utf8'))
  .replace(/\r\n?/gu, '\n');
const migrationChecksum = releaseWrapperSha256(migrationSql);
const previousManifest = JSON.parse(await readFile(new URL(
  '../release/012-catalog.integration.json', import.meta.url), 'utf8')) as AllPlayerRepairManifest;
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
    throw new Error('Migration 013 wrapper validation requires PostgreSQL 18.');
  }
  const rows = await ownerQuery<{ catalog: ReviewedCatalog }>(ALL_PLAYER_REPAIR_CATALOG_SQL);
  const manifest = { migrationName, migrationChecksum, postgresMajor: 18,
    observedAt: new Date().toISOString(), reviewed: false, catalog: rows[0].catalog };
  await writeFile(new URL('../release/013-catalog.integration.json', import.meta.url),
    `${JSON.stringify(manifest, null, 2)}\n`);
  // The isolated assertion expected value may use its fresh capture. Production
  // rendering still requires independent review of the saved false manifest.
  const input = { migrationSql, expectedDatabase: env.expectedDatabase, expectedOwner,
    previousManifest, manifest: { ...manifest, reviewed: true } };
  await prepareIntegrationDatabase({ throughMigration: '012_all_player_provider_participation.sql' });
  const before = (await ownerQuery<{ catalog: ReviewedCatalog }>(ALL_PLAYER_REPAIR_CATALOG_SQL))[0].catalog;
  const corrupt = structuredClone(input);
  corrupt.manifest.catalog.constraintTypes[0][1] += 1;
  let rejected = false;
  try { await execute(buildAllPlayerParticipationAssumptionReleaseWrapper(corrupt)); } catch { rejected = true; }
  const rolledBack = (await ownerQuery<{ catalog: ReviewedCatalog }>(ALL_PLAYER_REPAIR_CATALOG_SQL))[0].catalog;
  if (!rejected || JSON.stringify(before) !== JSON.stringify(rolledBack)
    || (await ownerQuery<{ count: number }>(
      "SELECT count(*)::integer AS count FROM app_schema_migrations WHERE name=$1", [migrationName]))[0].count !== 0) {
    throw new Error('The corrupted 013 constraint manifest did not fully roll back the release.');
  }
  const result = await execute(buildAllPlayerParticipationAssumptionReleaseWrapper(input));
  const sentinel = `ALL_PLAYER_PARTICIPATION_ASSUMPTION_APPLIED:${migrationName}:${migrationChecksum}`;
  if (!result.some((row) => row.success_sentinel === sentinel)) {
    throw new Error('Migration 013 success sentinel is missing; do not retry an ambiguous release.');
  }
  process.stdout.write(`${JSON.stringify({ outcome: 'passed', migrationChecksum, postgresMajor: 18,
    checks: ['corrupt-constraint-manifest-full-catalog-and-ledger-rollback', 'actual-wrapper-commit', 'exact-sentinel'],
    catalogReview: 'pending-independent-review' })}\n`);
} finally { await cleanIntegrationDatabase(); }
