import { readdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Pool } from '@neondatabase/serverless';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { migrationChecksum, normalizeMigrationText, validateMigrationSequence } from './migration-text.mjs';
import { accountTransitionApproval, accountTransitionState, installAccountTransition, migrationOwnerUrl,
  migrationDatabaseIdentity, verifyMigrationDatabaseIdentity } from './account-transition-preflight.mjs';

const databaseUrl = migrationOwnerUrl(process.env.MIGRATION_DATABASE_URL, { allowLocal: true });
let expectedIdentity;
try { expectedIdentity=migrationDatabaseIdentity(JSON.parse(process.env.ACCOUNTS_MIGRATION_DATABASE_IDENTITY ?? '')); }
catch { throw new Error('Independently approved migration database identity is required before connection.'); }
if (process.argv.length > 3 || (process.argv[2] && process.argv[2] !== '--reconcile-account-transition')) {
  throw new Error('Unknown migration operation.');
}

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const migrationsDirectory = join(scriptDirectory, '..', 'migrations');
const migrationNames = validateMigrationSequence((await readdir(migrationsDirectory))
  .filter((name) => /^\d+_[a-z0-9_]+\.sql$/u.test(name))
  .sort((left, right) => left.localeCompare(right)));

if (migrationNames.length === 0) {
  throw new Error('No database migrations were found.');
}

const pool = new Pool({ connectionString: databaseUrl, max: 1, connectionTimeoutMillis: 5000,
  query_timeout: 60000, statement_timeout: 55000 });
pool.on('error', () => { /* Never print credential-bearing driver errors. */ });
let client;

try {
  // Retain one actual connection through proof, drain gate, every migration and
  // cleanup. A lost connection aborts; the pool must never silently reacquire.
  client = await pool.connect();
  client.on('error', () => { process.exitCode = 1; });
  await verifyMigrationDatabaseIdentity(client, expectedIdentity);
  // Prevent automatic discovery from silently applying a mandatory-guard
  // cutover to receiptless callers. No schema write precedes this preflight.
  const transitionNames = migrationNames.filter(name => /^03[456]_/.test(name));
  const transitionMigrations = await Promise.all(transitionNames.map(async name => {
    const statement = normalizeMigrationText(await readFile(join(migrationsDirectory, name), 'utf8'));
    return { name, statement, checksum: migrationChecksum(statement) };
  }));
  const ledger = await client.query("SELECT to_regclass('public.app_schema_migrations') IS NOT NULL AS present");
  const appliedRows = ledger.rows[0]?.present
    ? (await client.query('SELECT name, checksum FROM public.app_schema_migrations')).rows : [];
  const transitionState = accountTransitionState(transitionMigrations, appliedRows);
  if (process.argv[2] === '--reconcile-account-transition') {
    // Deliberately read-only and non-authorizing. The ledger is only one part of
    // reconciliation; an owner must separately inspect catalog and real canaries.
    process.stdout.write(JSON.stringify({ status: transitionState,
      migrations: transitionMigrations.map(({ name, checksum }) => ({ name, expectedChecksum: checksum,
        observedChecksum: appliedRows.find(row => row.name === name)?.checksum ?? null })),
      catalogQualified: false, privateMaintenanceRequired: true }) + '\n');
  } else {
  if (transitionState === 'partial' || transitionState === 'drift') {
    throw new Error('Partial or drifted account transition requires independent catalog reconciliation.');
  }
  if (transitionState === 'absent') {
    const checksums = Object.fromEntries(transitionMigrations.map(({ name, checksum }) => [name, checksum]));
    const approval = accountTransitionApproval(process.env.ACCOUNTS_AUTHORITY_INSTALL_APPROVAL, checksums);
    if (JSON.stringify(approval.databaseIdentity)!==JSON.stringify(expectedIdentity)) {
      throw new Error('Transition approval does not bind this migration destination.');
    }
    const run = promisify(execFile);
    const [head, status] = await Promise.all([
      run('git', ['rev-parse', 'HEAD'], { cwd: scriptDirectory }),
      run('git', ['status', '--porcelain'], { cwd: scriptDirectory }),
    ]);
    if (head.stdout.trim() !== approval.reviewedSha || status.stdout.trim()) {
      throw new Error('Account transition requires the clean reviewed source commit.');
    }
    if (process.env.ACCOUNTS_PRIVATE_MAINTENANCE !== 'true') throw new Error('Private account maintenance must be confirmed before the transition.');
    await client.query("SELECT set_config('lock_timeout','5000',false),set_config('statement_timeout','15000',false)");
    // The explicitly pinned connection retains this session gate. It
    // drains participating transactions. Old pre-034 writers do not obey this
    // gate: independently verified service maintenance/drain remains mandatory.
    await client.query('SELECT pg_advisory_lock(19740517,1)');
    const activity = await client.query(`SELECT count(*)::integer AS count FROM pg_stat_activity
      WHERE usename IN ('league_one_auth','league_one_account') AND pid<>pg_backend_pid()`);
    if (activity.rows[0]?.count !== 0) throw new Error('Private account connections have not drained.');
  }
  await client.query(`
    CREATE TABLE IF NOT EXISTS app_schema_migrations (
      name text PRIMARY KEY,
      checksum text NOT NULL,
      applied_at timestamptz NOT NULL DEFAULT now()
    )
  `);

  for (const name of migrationNames) {
    if (transitionNames.includes(name)) {
      if (name === transitionNames[0]) {
          const outcome = await installAccountTransition(client, transitionMigrations, expectedIdentity);
          for (const migration of transitionMigrations) process.stdout.write(`${outcome === 'already-applied' ? 'Already applied' : 'Applied'} ${migration.name}\n`);
      }
      continue;
    }
    const statement = normalizeMigrationText(
      await readFile(join(migrationsDirectory, name), 'utf8'),
    );
    const checksum = migrationChecksum(statement);
    try {
      await client.query('BEGIN');
      await client.query("SELECT pg_advisory_xact_lock(hashtext('league-one-schema-migrations'))");
      const applied = await client.query(
        'SELECT checksum FROM app_schema_migrations WHERE name = $1',
        [name],
      );

      if (applied.rows.length > 0) {
        if (applied.rows[0].checksum !== checksum) {
          throw new Error(`Applied migration ${name} has been modified.`);
        }
        await client.query('COMMIT');
        process.stdout.write(`Already applied ${name}\n`);
        continue;
      }

      await client.query(statement);
      await client.query(
        'INSERT INTO app_schema_migrations (name, checksum) VALUES ($1, $2)',
        [name, checksum],
      );
      await client.query('COMMIT');
      process.stdout.write(`Applied ${name}\n`);
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }
  }
  }
} catch {
  process.stderr.write('Migration execution was not acknowledged as complete. Keep private maintenance enabled. Reconcile the reviewed checksums and actual catalog before another operation; do not assume rollback or retry. No credentials or driver diagnostics are emitted.\n');
  process.exitCode = 1;
} finally {
  // Destroy instead of returning a session-level advisory gate to the pool.
  try { client?.release(true); } catch { process.exitCode = 1; }
  try { await pool.end(); } catch { process.exitCode = 1; }
}
