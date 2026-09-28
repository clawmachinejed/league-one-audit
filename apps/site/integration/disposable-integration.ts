import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { isAbsolute } from 'node:path';
import { Pool, type PoolClient } from '@neondatabase/serverless';
import { DisposableNeonApi, NeonApiError, type DisposableNeonConfig } from './disposable-neon-api';
import { assertSafeIntegrationDatabase, cleanIntegrationDatabase, integrationEnvironment } from './neon-integration-harness';
import { INTEGRATION_MUTEX, INTEGRATION_OWNER_ENV, assertIntegrationOwner } from './integration-database-ownership';
import { superviseCapacityChild } from './collection-capacity-supervision';
import { spawnIntegrationChild, stopIntegrationChildTree, verifyIntegrationChildTreeClosed } from './integration-child-process';
import { createIntegrationArtifactDirectory, INTEGRATION_ARTIFACT_DIRECTORY_ENV } from './integration-artifacts';

export const DISPOSABLE_AUTHORIZATION = 'I_AUTHORIZE_DISPOSABLE_TEST_BRANCHES';
const protectedIdentities = ['solitary-base-99261075', 'br-rapid-boat-avgeevye', 'br-still-breeze-avaibago',
  'main', 'production', 'neondb', 'projection_refactor_test', 'account_reset_integration_test'];

export function disposableConfiguration(env: Record<string, string | undefined>): DisposableNeonConfig {
  if (env.NEON_TEST_AUTHORIZATION !== DISPOSABLE_AUTHORIZATION) throw new Error('Explicit disposable test-branch authorization is required.');
  const required = (name: string) => {
    const value = env[name]?.trim();
    if (!value) throw new Error(`Missing ${name}. See integration/README.md.`);
    return value;
  };
  required('NEON_TEST_API_KEY');
  const config = {
    projectId: required('NEON_TEST_PROJECT_ID'), projectName: required('NEON_TEST_PROJECT_NAME'),
    parentBranchId: required('NEON_TEST_PARENT_BRANCH_ID'), parentBranchName: required('NEON_TEST_PARENT_BRANCH_NAME'),
    databaseName: required('NEON_TEST_DATABASE'), ownerRoleName: required('NEON_TEST_OWNER_ROLE'),
  };
  if (config.projectId === 'solitary-base-99261075' || protectedIdentities.includes(config.parentBranchId)
    || !/(?:^|[-_])test(?:s|[-_]|$)/iu.test(config.projectName)
    || !/(?:^|[-_])test(?:s|[-_]|$)/iu.test(config.parentBranchName)
    || !/^[a-z][a-z0-9_]{0,62}$/u.test(config.databaseName) || !/(?:^|_)test(?:_|$)/u.test(config.databaseName)
    || protectedIdentities.includes(config.databaseName)
    || !/^[a-z_][a-z0-9_]*$/u.test(config.ownerRoleName)
    || ['league_one_runtime', 'league_one_auth', 'league_one_account'].includes(config.ownerRoleName)) {
    throw new Error('Disposable integration requires a separate, explicitly named test-only project and empty test parent/database.');
  }
  return config;
}

/** Control-plane, application, provider, NODE_OPTIONS and unrelated DB secrets
 * never enter the test subprocess. Test code must still be reviewed/trusted. */
export function integrationChildEnvironment(source: Record<string, string | undefined>, artifactDirectory?: string): NodeJS.ProcessEnv {
  if (artifactDirectory !== undefined && !isAbsolute(artifactDirectory)) throw new Error('Integration artifact directory must be absolute.');
  const allow = new Set(['path', 'systemroot', 'windir', 'comspec', 'temp', 'tmp', 'tmpdir', 'home', 'userprofile',
    'localappdata', 'appdata', 'pathext', 'lang', 'lc_all', 'tz', 'ci', 'term', 'no_color', 'force_color']);
  return { ...Object.fromEntries(Object.entries(source).filter(([name]) => allow.has(name.toLowerCase()))), NODE_ENV: 'test',
    ...(artifactDirectory === undefined ? {} : { [INTEGRATION_ARTIFACT_DIRECTORY_ENV]: artifactDirectory }) };
}

export function integrationCancellationReason(reason: unknown): NonNullable<IntegrationRunReceipt['cancellationReason']> {
  return reason === 'deadline' || reason === 'sigint' || reason === 'sigterm' || reason === 'ownership-lost' ? reason : 'requested';
}

export function redactIntegrationOutput(value: string, secrets: readonly string[]): string {
  let result = value.replace(/postgres(?:ql)?:\/\/[^\s'"<>]+/giu, '[REDACTED_DATABASE_URL]');
  for (const secret of secrets.filter(Boolean).sort((a, b) => b.length - a.length)) result = result.split(secret).join('[REDACTED]');
  return result;
}

type Query = (sql: string, parameters?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }>;
export async function assertEmptyDisposableDatabase(query: Query, target: { database: string; branch: string; owner: string }) {
  const result = await query(`SELECT current_database() AS database, current_user AS owner,
    session_user AS session, current_setting('neon.branch_id',true) AS branch,
    (SELECT count(*)::int FROM pg_namespace WHERE nspname NOT IN ('public','information_schema')
      AND left(nspname,3) <> 'pg_') AS schemas,
    (SELECT count(*)::int FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='public') AS relations,
    (SELECT count(*)::int FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
      WHERE n.nspname='public') AS functions,
    (SELECT count(*)::int FROM pg_type t JOIN pg_namespace n ON n.oid=t.typnamespace
      WHERE n.nspname='public') AS types,
    (SELECT count(*)::int FROM pg_roles WHERE rolname IN ('league_one_runtime','league_one_auth','league_one_account')) AS roles,
    (SELECT count(*)::int FROM pg_stat_activity WHERE datname=current_database()
      AND pid<>pg_backend_pid() AND backend_type='client backend') AS sessions`);
  assert.deepEqual(result.rows, [{ database: target.database, owner: target.owner, session: target.owner,
    branch: target.branch, schemas: 0, relations: 0, functions: 0, types: 0, roles: 0, sessions: 0 }],
  'Fresh disposable target must prove exact server identity and contain no inherited application/auth data or roles.');
}

export type IntegrationRunReceipt = {
  kind: 'disposable-integration-v1'; runId: string; gitSha: string; startedAt: string; finishedAt?: string;
  projectId: string; parentBranchId: string; branchId?: string; branchName?: string; expiresAt?: string;
  attemptedBranchName?: string;
  provisionStep?: string;
  stage: string; tests: 'not-run' | 'passed' | 'failed'; childClosed: boolean; schemaCleanupVerified: boolean;
  credentialsRevoked: boolean; branchDeletionVerified: boolean; failures: string[]; productionWrites: false;
  diagnostics?: { stage: string; status?: number; code: string; requestId?: string }[];
  childClosureEvidence?: string;
  artifactDirectory?: string;
  cancellationReason?: 'deadline' | 'sigint' | 'sigterm' | 'requested' | 'ownership-lost';
};
type Runtime = {
  provision: () => Promise<void>; execute: () => Promise<{ passed: boolean; closed: boolean }>;
  clean: () => Promise<void>; revoke: () => Promise<void>; close: () => Promise<void>; delete: () => Promise<void>;
};

/** Always delete owned resources even after failed creation/setup; SQL cleanup
 * is allowed only after confirmed child closure. A cleanup failure cannot pass. */
export async function runIntegrationLifecycle(runtime: Runtime, receipt: IntegrationRunReceipt,
  journal: () => Promise<void>, signal?: AbortSignal): Promise<boolean> {
  let provisioned = false;
  const recordCancellation = () => {
    if (!signal?.aborted) return false;
    const previousReason = receipt.cancellationReason;
    receipt.cancellationReason = integrationCancellationReason(signal.reason);
    const newlyFailed = receipt.tests === 'passed' && !receipt.failures.includes('cancelled');
    if (newlyFailed) receipt.failures.push('cancelled');
    return previousReason !== receipt.cancellationReason || newlyFailed;
  };
  const fail = (stage: string, error: unknown) => {
    receipt.failures.push(stage);
    if (error instanceof NeonApiError) (receipt.diagnostics ??= []).push({ stage, status: error.status,
      code: error.code, requestId: error.requestId });
    else if (error && typeof error === 'object' && 'code' in error && typeof error.code === 'string'
      && /^[A-Z0-9_]{1,64}$/u.test(error.code)) (receipt.diagnostics ??= []).push({ stage, code: error.code });
  };
  const attempt = async (stage: string, action: () => Promise<void>) => {
    receipt.stage = stage;
    try { await journal(); } catch (error) { fail('receipt', error); }
    try { await action(); } catch (error) { fail(stage, error); }
  };
  try {
    receipt.stage = 'provision'; await journal(); await runtime.provision(); provisioned = true;
    receipt.stage = 'tests'; await journal();
    const result = await runtime.execute();
    receipt.tests = result.passed ? 'passed' : 'failed'; receipt.childClosed = result.closed;
    if (!result.passed || !result.closed) receipt.failures.push('tests');
  } catch (error) { fail(receipt.stage, error); }
  finally {
    if (provisioned && receipt.childClosed) {
      await attempt('schema-cleanup', async () => { await runtime.clean(); receipt.schemaCleanupVerified = true; });
      await attempt('credential-revocation', async () => { await runtime.revoke(); receipt.credentialsRevoked = true; });
    }
    await attempt('connection-close', runtime.close);
    await attempt('branch-deletion', async () => { await runtime.delete(); receipt.branchDeletionVerified = true; });
    recordCancellation();
    receipt.finishedAt = new Date().toISOString(); receipt.stage = receipt.failures.length ? 'failed' : 'complete';
    try { await journal(); } catch { receipt.failures.push('receipt'); }
    // The deadline can fire while the final asynchronous receipt write is pending.
    const finalCancellationChanged = recordCancellation();
    if (finalCancellationChanged || (receipt.stage === 'complete' && receipt.failures.length)) {
      receipt.stage = 'failed';
      try { await journal(); } catch { receipt.failures.push('receipt'); }
    }
  }
  return receipt.tests === 'passed' && receipt.childClosed && receipt.schemaCleanupVerified
    && receipt.credentialsRevoked && receipt.branchDeletionVerified && receipt.failures.length === 0 && !signal?.aborted;
}

export async function runDisposableIntegration(options: { environment: NodeJS.ProcessEnv; gitSha: string;
  journal: (receipt: IntegrationRunReceipt) => Promise<void>; signal: AbortSignal; output: (text: string) => void }) {
  const config = disposableConfiguration(options.environment);
  const controller = new AbortController();
  const abort = () => controller.abort(integrationCancellationReason(options.signal.reason));
  options.signal.addEventListener('abort', abort, { once: true });
  if (options.signal.aborted) abort();
  const api = new DisposableNeonApi({ apiKey: options.environment.NEON_TEST_API_KEY!, signal: controller.signal });
  const runId = randomUUID();
  const receipt: IntegrationRunReceipt = { kind: 'disposable-integration-v1', runId, gitSha: options.gitSha,
    projectId: config.projectId, parentBranchId: config.parentBranchId, startedAt: new Date().toISOString(),
    stage: 'preflight', tests: 'not-run', childClosed: false, schemaCleanupVerified: false,
    credentialsRevoked: false, branchDeletionVerified: false, failures: [], productionWrites: false };
  const journal = async () => {
    if (controller.signal.aborted) receipt.cancellationReason = integrationCancellationReason(controller.signal.reason);
    await options.journal(receipt);
  };
  let pool: Pool | undefined;
  let client: PoolClient | undefined;
  let proof: string | undefined;
  let childEnvironment: NodeJS.ProcessEnv | undefined;
  const savedEnvironment = { ...process.env };
  const secrets = [options.environment.NEON_TEST_API_KEY!];
  const safeOutput = (value: string) => options.output(redactIntegrationOutput(value, secrets));
  const onLoss = () => { ownerLost = true; controller.abort('ownership-lost'); };
  let ownerLost = false;
  const query = async (sql: string, parameters: unknown[] = []) => {
    if (!client || ownerLost) throw new Error('Disposable owner connection unavailable.');
    if (receipt.stage === 'provision') controller.signal.throwIfAborted();
    return client.query(sql, parameters);
  };
  const verifyOwner = async () => {
    await assertIntegrationOwner(async (sql, params) => (await query(sql, [...(params ?? [])])).rows,
      { database: config.databaseName, branch: receipt.branchId! }, proof, 'ShareLock');
  };
  const runtime: Runtime = {
    async provision() {
      controller.signal.throwIfAborted();
      receipt.provisionStep = 'artifact-directory';
      receipt.artifactDirectory = await createIntegrationArtifactDirectory();
      await journal();
      controller.signal.throwIfAborted();
      receipt.provisionStep = 'api-target-validation';
      await api.validateTarget(config);
      receipt.provisionStep = 'branch-creation';
      const branch = await api.createBranch(config, runId, async intent => {
        controller.signal.throwIfAborted();
        receipt.attemptedBranchName = intent.branchName; receipt.expiresAt = intent.expiresAt;
        await journal();
        controller.signal.throwIfAborted();
      });
      Object.assign(receipt, { branchId: branch.branchId, branchName: branch.branchName, expiresAt: branch.expiresAt });
      await journal();
      controller.signal.throwIfAborted();
      receipt.provisionStep = 'child-owner-rotation';
      await api.rotateOwnerCredentials(config, branch);
      receipt.provisionStep = 'connection-uri';
      const ownerUrl = await api.getOwnerConnectionUri(config, branch);
      controller.signal.throwIfAborted();
      // Child/driver diagnostics can contain either standalone password form.
      const ownerPassword = new URL(ownerUrl).password;
      secrets.push(ownerUrl, ownerPassword, decodeURIComponent(ownerPassword));
      pool = new Pool({ connectionString: ownerUrl, max: 1, connectionTimeoutMillis: 10_000,
        statement_timeout: 15_000, query_timeout: 20_000 });
      receipt.provisionStep = 'owner-connect';
      pool.on('error', onLoss); client = await pool.connect(); client.on('error', onLoss); client.on('end', onLoss);
      controller.signal.throwIfAborted();
      receipt.provisionStep = 'empty-database-verification';
      await assertEmptyDisposableDatabase(query, { database: config.databaseName, branch: branch.branchId, owner: config.ownerRoleName });
      receipt.provisionStep = 'exclusive-admission';
      assert.equal((await query('SELECT pg_try_advisory_lock(hashtextextended($1::text,0)) AS owned', [INTEGRATION_MUTEX])).rows[0].owned, true);
      const applicationName = `integration-owner-${runId}`;
      await query("SELECT set_config('application_name',$1::text,false)", [applicationName]);
      const identity = (await query('SELECT pid,backend_start::text AS "backendStart" FROM pg_stat_activity WHERE pid=pg_backend_pid()')).rows[0];
      const runtimePassword = randomBytes(32).toString('hex'), authPassword = randomBytes(32).toString('hex');
      const sentinel = randomBytes(32).toString('hex'); secrets.push(runtimePassword, authPassword, sentinel);
      receipt.provisionStep = 'restricted-role-bootstrap';
      // Constants and random hex only. SQL parameter placeholders are not allowed in CREATE ROLE PASSWORD.
      await query(`CREATE ROLE league_one_runtime LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS PASSWORD '${runtimePassword}'`);
      await query(`CREATE ROLE league_one_auth LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS PASSWORD '${authPassword}'`);
      const comment = JSON.stringify({ purpose: 'league-one-projection-store-integration', sentinel,
        branchId: branch.branchId, branchName: branch.branchName });
      await query(`COMMENT ON DATABASE "${config.databaseName}" IS '${comment.replaceAll("'", "''")}'`);
      const roleUrl = (role: string, password: string) => { const url = new URL(ownerUrl); url.username = role; url.password = password; return url.href; };
      const generated = {
        PROJECTION_INTEGRATION_ENV_FILE: '.env.integration.local',
        PROJECTION_INTEGRATION_AUTHORIZATION: 'I_ACKNOWLEDGE_THIS_RESETS_AN_ISOLATED_DATABASE',
        PROJECTION_INTEGRATION_OWNER_DATABASE_URL: ownerUrl,
        PROJECTION_INTEGRATION_RUNTIME_DATABASE_URL: roleUrl('league_one_runtime', runtimePassword),
        AUTH_RESET_INTEGRATION_DATABASE_URL: roleUrl('league_one_auth', authPassword),
        PROJECTION_INTEGRATION_EXPECTED_DATABASE: config.databaseName,
        PROJECTION_INTEGRATION_EXPECTED_BRANCH_ID: branch.branchId,
        PROJECTION_INTEGRATION_EXPECTED_BRANCH_NAME: branch.branchName,
        PROJECTION_INTEGRATION_DATABASE_SENTINEL: sentinel,
        PROJECTION_INTEGRATION_PRODUCTION_DENYLIST: [...protectedIdentities, config.parentBranchId, config.parentBranchName].join(','),
      };
      secrets.push(generated.PROJECTION_INTEGRATION_RUNTIME_DATABASE_URL, generated.AUTH_RESET_INTEGRATION_DATABASE_URL);
      Object.assign(process.env, generated);
      receipt.provisionStep = 'guarded-auth-preflight';
      await assertSafeIntegrationDatabase(integrationEnvironment());
      controller.signal.throwIfAborted();
      receipt.provisionStep = 'shared-ownership-transfer';
      await query('SELECT pg_advisory_lock_shared(hashtextextended($1::text,0))', [INTEGRATION_MUTEX]);
      assert.equal((await query('SELECT pg_advisory_unlock(hashtextextended($1::text,0)) AS unlocked', [INTEGRATION_MUTEX])).rows[0].unlocked, true);
      proof = JSON.stringify({ database: config.databaseName, branch: branch.branchId, ...identity, applicationName, lockMode: 'ShareLock' });
      await verifyOwner();
      childEnvironment = { ...integrationChildEnvironment(options.environment, receipt.artifactDirectory), ...generated, [INTEGRATION_OWNER_ENV]: proof };
      receipt.provisionStep = 'complete';
    },
    async execute() {
      controller.signal.throwIfAborted(); await verifyOwner();
      const child = spawnIntegrationChild(process.execPath, [fileURLToPath(new URL('../node_modules/vitest/vitest.mjs', import.meta.url)),
        'run', '--config', fileURLToPath(new URL('../vitest.integration.config.ts', import.meta.url))],
      { cwd: fileURLToPath(new URL('..', import.meta.url)), env: childEnvironment!, stdio: ['ignore', 'pipe', 'pipe'] });
      const supervisor = superviseCapacityChild(child, controller.signal, pid => stopIntegrationChildTree(child, pid));
      // Redact complete lines, including values split across stream chunks.
      for (const stream of [child.stdout, child.stderr]) {
        let pending = '';
        stream?.setEncoding('utf8');
        stream?.on('data', (chunk: string) => {
          pending += chunk;
          const lines = pending.split('\n'); pending = lines.pop()!;
          for (const line of lines) safeOutput(`${line}\n`);
          if (pending.length > 1_000_000) { pending = ''; supervisor.stop(); }
        });
        stream?.on('end', () => { if (pending) safeOutput(pending); });
      }
      const outcome = await supervisor.completion;
      let closed = outcome.closed;
      if (closed) { try { receipt.childClosureEvidence = await verifyIntegrationChildTreeClosed(child); } catch { closed = false; } }
      return { passed: outcome.code === 0 && !outcome.childError && !controller.signal.aborted && !ownerLost, closed };
    },
    async clean() {
      await verifyOwner(); await cleanIntegrationDatabase({ ownerProof: proof }); await verifyOwner();
      const result = await query(`SELECT count(*)::int AS count FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
        WHERE n.nspname IN ('public','website_auth') AND c.relkind IN ('r','p','v','m','S','f')`);
      assert.equal(result.rows[0].count, 0);
    },
    async revoke() {
      await verifyOwner();
      await query('ALTER ROLE league_one_runtime NOLOGIN PASSWORD NULL; ALTER ROLE league_one_auth NOLOGIN PASSWORD NULL');
      const result = await query("SELECT count(*)::int AS count FROM pg_roles WHERE rolname IN ('league_one_runtime','league_one_auth') AND rolcanlogin");
      assert.equal(result.rows[0].count, 0);
    },
    async close() {
      client?.off('error', onLoss); client?.off('end', onLoss); pool?.off('error', onLoss);
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        client?.release(); client = undefined;
        await Promise.race([pool?.end(), new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error('Owner connection close deadline exceeded.')), 25_000);
        })]);
      }
      finally {
        clearTimeout(timer);
        for (const name of Object.keys(process.env)) if (!(name in savedEnvironment)) delete process.env[name];
        Object.assign(process.env, savedEnvironment);
      }
    },
    async delete() {
      const owned = api.ownedReceipts();
      for (const branch of owned) {
        Object.assign(receipt, { branchId: branch.branchId, branchName: branch.branchName, expiresAt: branch.expiresAt });
        await api.deleteBranch(config, branch);
      }
      if (owned.length === 0) throw new Error('No created branch identity; provisioning/deletion remains unverified.');
    },
  };
  try { return { passed: await runIntegrationLifecycle(runtime, receipt, journal, controller.signal), receipt }; }
  finally { options.signal.removeEventListener('abort', abort); }
}
