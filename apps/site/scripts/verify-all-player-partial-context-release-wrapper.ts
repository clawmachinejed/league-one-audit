import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { Pool } from '@neondatabase/serverless';
import { integrationEnvironment, prepareIntegrationDatabase, cleanIntegrationDatabase, ownerQuery } from '../integration/neon-integration-harness';
import { ADMINISTRATION_POSTGRES_VERSION } from './league-administration-catalog.mjs';
import { administrationMigrationChecksum, type AdministrationCatalog } from './league-administration-release-wrapper.mjs';
import { PARTIAL_CONTEXT_MIGRATIONS, PARTIAL_CONTEXT_INSTALLED_LEDGER, partialContextCatalogSql, partialContextDefinitionsSql,
  buildAllPlayerPartialContextReleaseWrapper, requirePartialContextReleaseSentinel,
  type PartialContextReleaseManifest } from './all-player-partial-context-release-wrapper.mjs';

const env = integrationEnvironment();
const expectedOwner = decodeURIComponent(new URL(env.ownerDatabaseUrl).username);
const migrations = await Promise.all(PARTIAL_CONTEXT_MIGRATIONS.map(async (name) => ({ name,
  sql: await readFile(new URL(`../migrations/${name}`, import.meta.url), 'utf8') })));
for (const [name, checksum] of PARTIAL_CONTEXT_INSTALLED_LEDGER) {
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
async function executeWithContinuingReplayChecks(statement: string, wrongIdentity: string): Promise<Record<string, unknown>[]> {
  const pool = new Pool({ connectionString: env.ownerDatabaseUrl, max: 1 });
  const client = await pool.connect();
  try {
    const committed = await client.query(statement);
    for (const invalid of [statement, wrongIdentity]) {
      let refused = false;
      try { await client.query(invalid); } catch { refused = true; }
      if (!refused) throw new Error('The continuing-client fixture did not encounter its required preflight failure.');
      // SQL editors may continue after the failure. COMMIT on an aborted
      // transaction rolls it back; the later success SELECT must still be empty.
      // Reuse the successful connection to challenge any stale committed marker.
      await client.query('COMMIT');
      const finalSelect = invalid.slice(invalid.lastIndexOf('\nSELECT '));
      const continued = (await client.query(finalSelect)).rows;
      if (continued.some(row => row.success_sentinel)) {
        throw new Error('UNSAFE SUCCESS: a continuing SQL client emitted the commit sentinel after an aborted replay or wrong-target invocation.');
      }
    }
    return (Array.isArray(committed) ? committed : [committed]).flatMap(part => part.rows);
  } finally { client.release(); await pool.end(); }
}
const catalog = async (affected = true): Promise<AdministrationCatalog> => (
  await ownerQuery<{ catalog: AdministrationCatalog }>(partialContextCatalogSql({ affected }))
)[0].catalog;
const ledger = async () => ownerQuery<{ name: string; checksum: string }>('SELECT name,checksum FROM public.app_schema_migrations ORDER BY name');
let prepared = false;
try {
  await prepareIntegrationDatabase({ throughMigration: PARTIAL_CONTEXT_INSTALLED_LEDGER.at(-1)![0] });
  prepared = true;
  const version = await ownerQuery<{ version: string }>("SELECT current_setting('server_version_num') AS version");
  if (Number(version[0].version) !== ADMINISTRATION_POSTGRES_VERSION) throw new Error('Partial-context release capture requires PostgreSQL 180006.');
  const before = await catalog();
  const beforeDefinitions = (await ownerQuery<{ definitions: Record<string, unknown> }>(partialContextDefinitionsSql()))[0].definitions;
  const unaffectedBefore = await catalog(false);
  const beforeLedger = await ledger();
  await prepareIntegrationDatabase({ throughMigration: PARTIAL_CONTEXT_MIGRATIONS[0] });
  const after = await catalog();
  if (JSON.stringify(await catalog(false)) !== JSON.stringify(unaffectedBefore)) {
    throw new Error('Partial-context migration changed an unexpected existing catalog object or ACL.');
  }
  const manifest: PartialContextReleaseManifest = {
    format: 'all-player-partial-context-release-v1', postgresVersion: ADMINISTRATION_POSTGRES_VERSION,
    expectedOwner, observedAt: new Date().toISOString(), reviewed: false,
    migrations: migrations.map(({ name, sql }) => ({ name, checksum: administrationMigrationChecksum(sql) })), before, after,
    protectedTables: unaffectedBefore.tables.filter(row => ['r','p'].includes(row.kind) && row.name !== 'app_schema_migrations').map(row => row.name).sort(),
    unaffectedConstraintTypes: unaffectedBefore.constraintTypes,
  };
  await mkdir(new URL('../release/all-player-partial-context/', import.meta.url), { recursive: true });
  await writeFile(new URL('../release/all-player-partial-context/catalog.integration.json', import.meta.url), `${JSON.stringify(manifest, null, 2)}\n`);
  const definitions = (await ownerQuery<{ definitions: Record<string, unknown> }>(partialContextDefinitionsSql()))[0].definitions;
  await writeFile(new URL('../release/all-player-partial-context/catalog-definitions.integration.json', import.meta.url),
    `${JSON.stringify({ observedAt: manifest.observedAt, postgresVersion: ADMINISTRATION_POSTGRES_VERSION,
      migrations: manifest.migrations, before: beforeDefinitions, after: definitions }, null, 2)}\n`);
  // This transient true value permits exercising the exact SQL only in the guarded
  // isolated harness; the durable capture remains reviewed:false for independent review.
  const input = { migrations, expectedDatabase: env.expectedDatabase, expectedOwner, manifest: { ...manifest, reviewed: true } };
  await prepareIntegrationDatabase({ throughMigration: PARTIAL_CONTEXT_INSTALLED_LEDGER.at(-1)![0] });
  const corrupted = structuredClone(input);
  corrupted.manifest.after.functions[0].definitionHash = '0'.repeat(32);
  let refused = false;
  try { await execute(buildAllPlayerPartialContextReleaseWrapper(corrupted)); } catch { refused = true; }
  if (!refused || JSON.stringify(await catalog()) !== JSON.stringify(before)
    || JSON.stringify(await catalog(false)) !== JSON.stringify(unaffectedBefore)
    || JSON.stringify(await ledger()) !== JSON.stringify(beforeLedger)) {
    throw new Error('A corrupt partial-context function capture failed to roll back catalog and ledger atomically.');
  }
  const corruptConstraints = structuredClone(input);
  corruptConstraints.manifest.unaffectedConstraintTypes.find(([kind]) => kind === 'n')![1] += 1;
  let constraintsRefused = false;
  try { await execute(buildAllPlayerPartialContextReleaseWrapper(corruptConstraints)); } catch { constraintsRefused = true; }
  if (!constraintsRefused || JSON.stringify(await catalog()) !== JSON.stringify(before)
    || JSON.stringify(await catalog(false)) !== JSON.stringify(unaffectedBefore)
    || JSON.stringify(await ledger()) !== JSON.stringify(beforeLedger)) {
    throw new Error('A corrupt PostgreSQL 180006 constraint manifest did not roll back the entire release.');
  }
  const rows = await executeWithContinuingReplayChecks(buildAllPlayerPartialContextReleaseWrapper(input),
    buildAllPlayerPartialContextReleaseWrapper({ ...input, expectedDatabase: `${env.expectedDatabase}_wrong` }));
  const sentinel = requirePartialContextReleaseSentinel(rows, migrations);
  if (JSON.stringify(await catalog()) !== JSON.stringify(after)
    || JSON.stringify(await catalog(false)) !== JSON.stringify(unaffectedBefore)) {
    throw new Error('The actual partial-context release wrapper produced a different catalog.');
  }
  let replayRefused = false;
  try { await execute(buildAllPlayerPartialContextReleaseWrapper(input)); } catch { replayRefused = true; }
  if (!replayRefused || JSON.stringify(await catalog()) !== JSON.stringify(after)) {
    throw new Error('An already installed partial-context migration was not refused without changes.');
  }
  const evidence = { outcome: 'passed', postgresVersion: ADMINISTRATION_POSTGRES_VERSION,
    migrations: manifest.migrations, sentinel, catalogReview: 'pending-independent-review',
    checks: ['exact-001-through-017-ledger', 'postgres-180006-not-null-constraint-catalog',
      'unaffected-catalog-and-acls', 'protected-physical-table-counts', 'corrupt-function-manifest-full-rollback',
      'corrupt-constraint-manifest-full-rollback', 'actual-wrapper-commit',
      'exact-success-sentinel', 'installed-bundle-replay-refused',
      'same-session-continue-after-error-replay-no-success', 'same-session-wrong-target-no-success'] };
  await writeFile(new URL('../release/all-player-partial-context/wrapper-verification.integration.json', import.meta.url), `${JSON.stringify(evidence, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify(evidence)}\n`);
} finally {
  if (prepared) await cleanIntegrationDatabase();
}
