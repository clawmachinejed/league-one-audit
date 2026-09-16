import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { Pool } from '@neondatabase/serverless';
import { integrationEnvironment, prepareIntegrationDatabase, cleanIntegrationDatabase, ownerQuery } from '../integration/neon-integration-harness';
import { ADMINISTRATION_POSTGRES_VERSION, leagueAdministrationCatalogSql } from './league-administration-catalog.mjs';
import { ADMINISTRATION_MIGRATIONS, ADMINISTRATION_INSTALLED_LEDGER, administrationMigrationChecksum,
  buildLeagueAdministrationReleaseWrapper, requireAdministrationReleaseSentinel,
  type AdministrationCatalog, type AdministrationReleaseManifest } from './league-administration-release-wrapper.mjs';

const env = integrationEnvironment();
const expectedOwner = decodeURIComponent(new URL(env.ownerDatabaseUrl).username);
const migrations = await Promise.all(ADMINISTRATION_MIGRATIONS.map(async (name) => ({ name,
  sql: await readFile(new URL(`../migrations/${name}`, import.meta.url), 'utf8') })));
for (const [name, checksum] of ADMINISTRATION_INSTALLED_LEDGER) {
  if (administrationMigrationChecksum(await readFile(new URL(`../migrations/${name}`, import.meta.url), 'utf8')) !== checksum) {
    throw new Error(`Installed migration ${name} was modified.`);
  }
}

async function execute(statement: string): Promise<Record<string, unknown>[]> {
  const pool = new Pool({ connectionString: env.ownerDatabaseUrl, max: 1 });
  try {
    const result = await pool.query(statement);
    return (Array.isArray(result) ? result : [result]).flatMap((part) => part.rows);
  } finally { await pool.end(); }
}
const catalog = async (affected = true): Promise<AdministrationCatalog> => (
  await ownerQuery<{ catalog: AdministrationCatalog }>(leagueAdministrationCatalogSql({ affected }))
)[0].catalog;
const ledger = async () => ownerQuery<{ name: string; checksum: string }>('SELECT name,checksum FROM public.app_schema_migrations ORDER BY name');
let prepared = false;
try {
  await prepareIntegrationDatabase({ throughMigration: ADMINISTRATION_INSTALLED_LEDGER.at(-1)![0] });
  prepared = true;
  const version = await ownerQuery<{ version: string }>("SELECT current_setting('server_version_num') AS version");
  if (Number(version[0].version) !== ADMINISTRATION_POSTGRES_VERSION) throw new Error('Administration release capture requires PostgreSQL 180006.');
  const before = await catalog();
  const unaffectedBefore = await catalog(false);
  const beforeLedger = await ledger();
  await prepareIntegrationDatabase({ throughMigration: ADMINISTRATION_MIGRATIONS[1] });
  const after = await catalog();
  if (JSON.stringify(await catalog(false)) !== JSON.stringify(unaffectedBefore)) {
    throw new Error('Administration migrations changed an unexpected existing catalog object or ACL.');
  }
  const manifest: AdministrationReleaseManifest = {
    format: 'league-administration-release-v1', postgresVersion: ADMINISTRATION_POSTGRES_VERSION,
    expectedOwner, observedAt: new Date().toISOString(), reviewed: false,
    migrations: migrations.map(({ name, sql }) => ({ name, checksum: administrationMigrationChecksum(sql) })), before, after,
  };
  await mkdir(new URL('../release/league-administration/', import.meta.url), { recursive: true });
  await writeFile(new URL('../release/league-administration/catalog.integration.json', import.meta.url), `${JSON.stringify(manifest, null, 2)}\n`);
  // This transient true value permits exercising the exact SQL only in the guarded
  // isolated harness; the durable capture remains reviewed:false for independent review.
  const input = { migrations, expectedDatabase: env.expectedDatabase, expectedOwner, manifest: { ...manifest, reviewed: true } };
  await prepareIntegrationDatabase({ throughMigration: ADMINISTRATION_INSTALLED_LEDGER.at(-1)![0] });
  const corrupted = structuredClone(input);
  corrupted.manifest.after.tables[0].notNullConstraints += 1;
  let refused = false;
  try { await execute(buildLeagueAdministrationReleaseWrapper(corrupted)); } catch { refused = true; }
  if (!refused || JSON.stringify(await catalog()) !== JSON.stringify(before)
    || JSON.stringify(await catalog(false)) !== JSON.stringify(unaffectedBefore)
    || JSON.stringify(await ledger()) !== JSON.stringify(beforeLedger)) {
    throw new Error('A corrupt administration constraint capture failed to roll back catalog and ledger atomically.');
  }
  const rows = await execute(buildLeagueAdministrationReleaseWrapper(input));
  const sentinel = requireAdministrationReleaseSentinel(rows, migrations);
  if (JSON.stringify(await catalog()) !== JSON.stringify(after)
    || JSON.stringify(await catalog(false)) !== JSON.stringify(unaffectedBefore)) {
    throw new Error('The actual administration release wrapper produced a different catalog.');
  }
  let replayRefused = false;
  try { await execute(buildLeagueAdministrationReleaseWrapper(input)); } catch { replayRefused = true; }
  if (!replayRefused || JSON.stringify(await catalog()) !== JSON.stringify(after)) {
    throw new Error('An already installed administration bundle was not refused without changes.');
  }
  const evidence = { outcome: 'passed', postgresVersion: ADMINISTRATION_POSTGRES_VERSION,
    migrations: manifest.migrations, sentinel, catalogReview: 'pending-independent-review',
    checks: ['exact-001-through-015-ledger', 'postgres-180006-not-null-constraint-catalog',
      'unaffected-catalog-and-acls', 'corrupt-manifest-full-rollback', 'actual-wrapper-commit',
      'exact-success-sentinel', 'installed-bundle-replay-refused'] };
  await writeFile(new URL('../release/league-administration/wrapper-verification.integration.json', import.meta.url), `${JSON.stringify(evidence, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify(evidence)}\n`);
} finally {
  if (prepared) await cleanIntegrationDatabase();
}
