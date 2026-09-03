import 'server-only';

import { neon } from '@neondatabase/serverless';

export type DatabaseRow = Readonly<Record<string, unknown>>;

export type DatabaseQueryOptions = Readonly<{
  signal?: AbortSignal;
}>;

export type DatabaseClient = Readonly<{
  enabled: true;
  query: <Row extends DatabaseRow = DatabaseRow>(
    statement: string,
    parameters?: readonly unknown[],
    options?: DatabaseQueryOptions,
  ) => Promise<readonly Row[]>;
}>;

export type DisabledDatabase = Readonly<{
  enabled: false;
  reason: 'missing-database-url' | 'invalid-database-url';
}>;

export type Database = DatabaseClient | DisabledDatabase;

function configuredUrl(value: string | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function isLocalDatabaseHost(hostname: string): boolean {
  const normalized = hostname.toLowerCase();
  return normalized === 'localhost' || normalized === '127.0.0.1' || normalized === '[::1]';
}

function isSecurePostgresUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== 'postgres:' && parsed.protocol !== 'postgresql:') return false;
    if (!parsed.hostname) return false;
    if (isLocalDatabaseHost(parsed.hostname)) return true;

    const sslMode = parsed.searchParams.get('sslmode')?.toLowerCase();
    return sslMode === 'require' || sslMode === 'verify-ca' || sslMode === 'verify-full';
  } catch {
    return false;
  }
}

/**
 * Creates a Neon HTTP client without opening a connection. A missing database is
 * an expected local/deployment state while the persistence feature is dormant.
 */
export function createDatabase(databaseUrl: string | undefined = process.env.DATABASE_URL): Database {
  const url = configuredUrl(databaseUrl);
  if (!url) return { enabled: false, reason: 'missing-database-url' };
  if (!isSecurePostgresUrl(url)) return { enabled: false, reason: 'invalid-database-url' };

  const sql = neon(url);
  return {
    enabled: true,
    async query<Row extends DatabaseRow = DatabaseRow>(
      statement: string,
      parameters: readonly unknown[] = [],
      options: DatabaseQueryOptions = {},
    ) {
      const rows = await sql.query(
        statement,
        [...parameters],
        options.signal ? { fetchOptions: { signal: options.signal } } : {},
      );
      return rows as readonly Row[];
    },
  };
}

/** Applies one operation deadline to every query made through this database view. */
export function withDatabaseAbortSignal(database: Database, signal: AbortSignal): Database {
  if (!database.enabled) return database;
  return {
    enabled: true,
    query(statement, parameters, options = {}) {
      const querySignal = options.signal
        ? AbortSignal.any([signal, options.signal])
        : signal;
      return database.query(statement, parameters, { signal: querySignal });
    },
  };
}

let cachedUrl: string | undefined;
let cachedDatabase: Database | undefined;

/** Uses the current environment value and refreshes the singleton if it changes. */
export function getDatabase(): Database {
  const databaseUrl = process.env.DATABASE_URL;
  if (!cachedDatabase || cachedUrl !== databaseUrl) {
    cachedUrl = databaseUrl;
    cachedDatabase = createDatabase(databaseUrl);
  }
  return cachedDatabase;
}
