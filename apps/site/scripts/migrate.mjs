import { readdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Pool } from '@neondatabase/serverless';
import { migrationChecksum, normalizeMigrationText } from './migration-text.mjs';

const databaseUrl = process.env.MIGRATION_DATABASE_URL?.trim();
if (!databaseUrl) {
  throw new Error('MIGRATION_DATABASE_URL is required to run database migrations.');
}

let parsedDatabaseUrl;
try {
  parsedDatabaseUrl = new URL(databaseUrl);
} catch {
  throw new Error('The migration database URL must be a valid URL.');
}
if (parsedDatabaseUrl.protocol !== 'postgres:' && parsedDatabaseUrl.protocol !== 'postgresql:') {
  throw new Error('The migration database URL must be a PostgreSQL connection URL.');
}
const localDatabaseHosts = new Set(['localhost', '127.0.0.1', '[::1]']);
const sslMode = parsedDatabaseUrl.searchParams.get('sslmode')?.toLowerCase();
if (!localDatabaseHosts.has(parsedDatabaseUrl.hostname.toLowerCase())
  && !['require', 'verify-ca', 'verify-full'].includes(sslMode)) {
  throw new Error('Remote migration database URLs must require TLS with sslmode=require or stronger.');
}

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const migrationsDirectory = join(scriptDirectory, '..', 'migrations');
const migrationNames = (await readdir(migrationsDirectory))
  .filter((name) => /^\d+_[a-z0-9_]+\.sql$/u.test(name))
  .sort((left, right) => left.localeCompare(right));

if (migrationNames.length === 0) {
  throw new Error('No database migrations were found.');
}

const pool = new Pool({ connectionString: databaseUrl, max: 1 });

try {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS app_schema_migrations (
      name text PRIMARY KEY,
      checksum text NOT NULL,
      applied_at timestamptz NOT NULL DEFAULT now()
    )
  `);

  for (const name of migrationNames) {
    const statement = normalizeMigrationText(
      await readFile(join(migrationsDirectory, name), 'utf8'),
    );
    const checksum = migrationChecksum(statement);
    const client = await pool.connect();

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
    } finally {
      client.release();
    }
  }
} finally {
  await pool.end();
}
