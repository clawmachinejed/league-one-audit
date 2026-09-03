import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Pool } from '@neondatabase/serverless';

const AUTHORIZATION = 'I_ACKNOWLEDGE_THIS_RESETS_AN_ISOLATED_DATABASE';
const COMMENT_PURPOSE = 'league-one-projection-store-integration';
const ENV_FILE_MARKER = '.env.integration.local';
const SAFE_NAME_PATTERN = /(?:^|[-_])(integration|test)(?:$|[-_])/iu;
const FORBIDDEN_NAMES = new Set(['main', 'neondb', 'postgres', 'prod', 'production']);

export type IntegrationEnvironment = Readonly<{
  ownerDatabaseUrl: string;
  runtimeDatabaseUrl: string;
  expectedDatabase: string;
  expectedBranchId: string;
  expectedBranchName: string;
  databaseSentinel: string;
  productionDenylist: ReadonlySet<string>;
}>;

type QueryRow = Record<string, unknown>;

type DatabaseComment = Readonly<{
  purpose: string;
  sentinel: string;
  branchId: string;
  branchName: string;
}>;

type ConnectionIdentity = Readonly<{
  database: string;
  user: string;
  comment: DatabaseComment;
}>;

type UrlIdentity = Readonly<{
  database: string;
  endpoint: string;
  host: string;
  target: string;
  user: string;
}>;

export type IndependentDatabase = Readonly<{
  database: Readonly<{
    enabled: true;
    query: <Row extends Readonly<Record<string, unknown>> = Readonly<Record<string, unknown>>>(
      statement: string,
      parameters?: readonly unknown[],
    ) => Promise<readonly Row[]>;
  }>;
  close: () => Promise<void>;
}>;

function requiredEnvironment(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Isolated integration tests require ${name}.`);
  return value;
}

function normalizedHostname(hostname: string): string {
  const labels = hostname.toLowerCase().split('.');
  labels[0] = labels[0].replace(/-pooler$/u, '');
  return labels.join('.');
}

function parseDatabaseUrl(value: string, label: string): UrlIdentity {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`${label} must be a valid PostgreSQL URL.`);
  }
  if (!['postgres:', 'postgresql:'].includes(parsed.protocol) || !parsed.hostname) {
    throw new Error(`${label} must be a valid PostgreSQL URL.`);
  }
  const sslMode = parsed.searchParams.get('sslmode')?.toLowerCase();
  const hostname = parsed.hostname.toLowerCase();
  const isLocal = ['localhost', '127.0.0.1', '[::1]'].includes(hostname);
  if (!isLocal && !['require', 'verify-ca', 'verify-full'].includes(sslMode ?? '')) {
    throw new Error(`${label} must require TLS.`);
  }
  const database = decodeURIComponent(parsed.pathname.replace(/^\//u, '')).toLowerCase();
  const host = normalizedHostname(hostname);
  const endpoint = host.split('.')[0];
  return {
    database,
    endpoint,
    host,
    target: `${host}/${database}`,
    user: decodeURIComponent(parsed.username),
  };
}

function denylistTokens(value: string): ReadonlySet<string> {
  const tokens = new Set<string>();
  for (const item of value.split(',').map((entry) => entry.trim()).filter(Boolean)) {
    try {
      const identity = parseDatabaseUrl(item, 'Production denylist URL');
      tokens.add(identity.database);
      tokens.add(identity.endpoint);
      tokens.add(identity.host);
      tokens.add(identity.target);
    } catch {
      tokens.add(item.toLowerCase());
    }
  }
  if (tokens.size === 0) {
    throw new Error('The production denylist must contain at least one production identity.');
  }
  return tokens;
}

export function integrationEnvironment(): IntegrationEnvironment {
  if (process.env.PROJECTION_INTEGRATION_ENV_FILE !== ENV_FILE_MARKER) {
    throw new Error('Run integration tests only through the .env.integration.local package script.');
  }
  if (process.env.PROJECTION_INTEGRATION_AUTHORIZATION !== AUTHORIZATION) {
    throw new Error('The destructive isolated-database authorization is missing or incorrect.');
  }
  return {
    ownerDatabaseUrl: requiredEnvironment('PROJECTION_INTEGRATION_OWNER_DATABASE_URL'),
    runtimeDatabaseUrl: requiredEnvironment('PROJECTION_INTEGRATION_RUNTIME_DATABASE_URL'),
    expectedDatabase: requiredEnvironment('PROJECTION_INTEGRATION_EXPECTED_DATABASE'),
    expectedBranchId: requiredEnvironment('PROJECTION_INTEGRATION_EXPECTED_BRANCH_ID'),
    expectedBranchName: requiredEnvironment('PROJECTION_INTEGRATION_EXPECTED_BRANCH_NAME'),
    databaseSentinel: requiredEnvironment('PROJECTION_INTEGRATION_DATABASE_SENTINEL'),
    productionDenylist: denylistTokens(
      requiredEnvironment('PROJECTION_INTEGRATION_PRODUCTION_DENYLIST'),
    ),
  };
}

function parseDatabaseComment(value: unknown): DatabaseComment {
  if (typeof value !== 'string') {
    throw new Error('The isolated database has no JSON safety comment.');
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error('The isolated database safety comment is not valid JSON.');
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('The isolated database safety comment has the wrong shape.');
  }
  const comment = parsed as Record<string, unknown>;
  if (typeof comment.purpose !== 'string'
    || typeof comment.sentinel !== 'string'
    || typeof comment.branchId !== 'string'
    || typeof comment.branchName !== 'string') {
    throw new Error('The isolated database safety comment is incomplete.');
  }
  return {
    purpose: comment.purpose,
    sentinel: comment.sentinel,
    branchId: comment.branchId,
    branchName: comment.branchName,
  };
}

async function connectionIdentity(pool: Pool, label: string): Promise<ConnectionIdentity> {
  let rows: readonly QueryRow[];
  try {
    const result = await pool.query(`
      SELECT current_database() AS database_name,
        current_user AS database_user,
        shobj_description(database.oid, 'pg_database') AS database_comment
      FROM pg_database database
      WHERE database.datname = current_database()
    `);
    rows = result.rows as QueryRow[];
  } catch {
    throw new Error(`${label} could not verify the isolated database identity.`);
  }
  const row = rows[0];
  if (!row || typeof row.database_name !== 'string' || typeof row.database_user !== 'string') {
    throw new Error(`${label} did not return a database identity.`);
  }
  return {
    database: row.database_name,
    user: row.database_user,
    comment: parseDatabaseComment(row.database_comment),
  };
}

function assertNotDenied(env: IntegrationEnvironment, values: readonly string[]): void {
  for (const value of values) {
    if (env.productionDenylist.has(value.toLowerCase())) {
      throw new Error('The integration target matches the production denylist.');
    }
  }
}

function assertComment(env: IntegrationEnvironment, identity: ConnectionIdentity): void {
  if (identity.database !== env.expectedDatabase
    || identity.comment.purpose !== COMMENT_PURPOSE
    || identity.comment.sentinel !== env.databaseSentinel
    || identity.comment.branchId !== env.expectedBranchId
    || identity.comment.branchName !== env.expectedBranchName) {
    throw new Error('The database-reported integration identity does not match the expected sentinels.');
  }
}

function productionUrlIdentities(): readonly UrlIdentity[] {
  const identities: UrlIdentity[] = [];
  for (const name of ['DATABASE_URL', 'MIGRATION_DATABASE_URL', 'PRODUCTION_DATABASE_URL']) {
    const value = process.env[name]?.trim();
    if (value) identities.push(parseDatabaseUrl(value, name));
  }
  return identities;
}

export async function assertSafeIntegrationDatabase(
  env = integrationEnvironment(),
): Promise<void> {
  const ownerUrl = parseDatabaseUrl(env.ownerDatabaseUrl, 'Integration owner URL');
  const runtimeUrl = parseDatabaseUrl(env.runtimeDatabaseUrl, 'Integration runtime URL');
  const expectedDatabase = env.expectedDatabase.toLowerCase();
  const expectedBranchName = env.expectedBranchName.toLowerCase();

  if (ownerUrl.target !== runtimeUrl.target || ownerUrl.database !== expectedDatabase) {
    throw new Error('Owner and runtime URLs do not identify the same expected isolated database.');
  }
  if (ownerUrl.user === runtimeUrl.user || runtimeUrl.user !== 'league_one_runtime') {
    throw new Error('Integration tests require distinct owner and league_one_runtime roles.');
  }
  if (!SAFE_NAME_PATTERN.test(expectedDatabase) || !SAFE_NAME_PATTERN.test(expectedBranchName)
    || FORBIDDEN_NAMES.has(expectedDatabase) || FORBIDDEN_NAMES.has(expectedBranchName)) {
    throw new Error('The target database and branch names must explicitly identify a test environment.');
  }

  assertNotDenied(env, [
    expectedDatabase,
    env.expectedBranchId,
    expectedBranchName,
    ownerUrl.database,
    ownerUrl.endpoint,
    ownerUrl.host,
    ownerUrl.target,
  ]);
  for (const production of productionUrlIdentities()) {
    if (production.target === ownerUrl.target) {
      throw new Error('The integration target matches a configured production database URL.');
    }
  }

  const ownerPool = new Pool({ connectionString: env.ownerDatabaseUrl, max: 1 });
  const runtimePool = new Pool({ connectionString: env.runtimeDatabaseUrl, max: 1 });
  try {
    const [ownerIdentity, runtimeIdentity] = await Promise.all([
      connectionIdentity(ownerPool, 'The owner connection'),
      connectionIdentity(runtimePool, 'The runtime connection'),
    ]);
    assertComment(env, ownerIdentity);
    assertComment(env, runtimeIdentity);
    if (ownerIdentity.database !== runtimeIdentity.database
      || ownerIdentity.user === runtimeIdentity.user
      || runtimeIdentity.user !== 'league_one_runtime'
      || JSON.stringify(ownerIdentity.comment) !== JSON.stringify(runtimeIdentity.comment)) {
      throw new Error('Owner and runtime sessions do not share the same isolated database identity.');
    }
    assertNotDenied(env, [
      ownerIdentity.database,
      ownerIdentity.comment.branchId,
      ownerIdentity.comment.branchName,
    ]);
  } finally {
    await Promise.allSettled([ownerPool.end(), runtimePool.end()]);
  }
}

async function resetPublicSchema(pool: Pool): Promise<void> {
  await pool.query('DROP SCHEMA IF EXISTS public CASCADE');
  await pool.query('CREATE SCHEMA public');
  await pool.query('REVOKE CREATE ON SCHEMA public FROM PUBLIC');
}

async function applyMigrations(pool: Pool): Promise<readonly string[]> {
  const migrationsDirectory = fileURLToPath(new URL('../migrations/', import.meta.url));
  const names = (await readdir(migrationsDirectory))
    .filter((name) => /^\d+_[a-z0-9_]+\.sql$/u.test(name))
    .sort((left, right) => left.localeCompare(right));
  if (names.length === 0) throw new Error('No projection migrations were found.');

  await pool.query(`
    CREATE TABLE app_schema_migrations (
      name text PRIMARY KEY,
      checksum text NOT NULL,
      applied_at timestamptz NOT NULL DEFAULT now()
    )
  `);
  for (const name of names) {
    const statement = await readFile(join(migrationsDirectory, name), 'utf8');
    const checksum = createHash('sha256').update(statement).digest('hex');
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query("SELECT pg_advisory_xact_lock(hashtext('league-one-schema-migrations'))");
      await client.query(statement);
      await client.query(
        'INSERT INTO app_schema_migrations (name, checksum) VALUES ($1, $2)',
        [name, checksum],
      );
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
  return names;
}

export async function prepareIntegrationDatabase(): Promise<void> {
  const env = integrationEnvironment();
  await assertSafeIntegrationDatabase(env);
  const ownerPool = new Pool({ connectionString: env.ownerDatabaseUrl, max: 1 });
  try {
    await resetPublicSchema(ownerPool);
    const empty = await ownerPool.query(`
      SELECT count(*)::integer AS relation_count
      FROM pg_class relation
      JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
      WHERE namespace.nspname = 'public'
        AND relation.relkind IN ('r', 'p', 'v', 'm', 'S', 'f')
    `);
    if (Number(empty.rows[0]?.relation_count) !== 0) {
      throw new Error('The isolated public schema was not empty before migration.');
    }
    const migrationNames = await applyMigrations(ownerPool);
    const provisionSql = await readFile(
      fileURLToPath(new URL('../scripts/provision-runtime-role.sql', import.meta.url)),
      'utf8',
    );
    await ownerPool.query(provisionSql);
    process.env.PROJECTION_INTEGRATION_SETUP_PROOF = JSON.stringify({
      emptyBeforeMigration: true,
      migrationNames,
    });
  } finally {
    await ownerPool.end();
  }
  await assertSafeIntegrationDatabase(env);
}

export async function cleanIntegrationDatabase(): Promise<void> {
  const env = integrationEnvironment();
  await assertSafeIntegrationDatabase(env);
  const ownerPool = new Pool({ connectionString: env.ownerDatabaseUrl, max: 1 });
  try {
    await resetPublicSchema(ownerPool);
  } finally {
    await ownerPool.end();
  }
}

export function createIndependentDatabase(
  databaseUrl = integrationEnvironment().runtimeDatabaseUrl,
): IndependentDatabase {
  const pool = new Pool({ connectionString: databaseUrl, max: 1 });
  return {
    database: {
      enabled: true,
      async query<Row extends Readonly<Record<string, unknown>>>(
        statement: string,
        parameters: readonly unknown[] = [],
      ) {
        const result = await pool.query(statement, [...parameters]);
        return result.rows as unknown as readonly Row[];
      },
    },
    close: () => pool.end(),
  };
}

export async function ownerQuery<Row extends QueryRow = QueryRow>(
  statement: string,
  parameters: readonly unknown[] = [],
): Promise<readonly Row[]> {
  const pool = new Pool({
    connectionString: integrationEnvironment().ownerDatabaseUrl,
    max: 1,
  });
  try {
    const result = await pool.query(statement, [...parameters]);
    return result.rows as unknown as readonly Row[];
  } finally {
    await pool.end();
  }
}

export async function runtimeQuery<Row extends QueryRow = QueryRow>(
  statement: string,
  parameters: readonly unknown[] = [],
): Promise<readonly Row[]> {
  const pool = new Pool({
    connectionString: integrationEnvironment().runtimeDatabaseUrl,
    max: 1,
  });
  try {
    const result = await pool.query(statement, [...parameters]);
    return result.rows as unknown as readonly Row[];
  } finally {
    await pool.end();
  }
}
